/*
 * Part of the SupAir scraper project.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program. If not, see <http://www.gnu.org/licenses/>.
 *
 */

import { serve }        from 'std/server';
import { createClient } from '@supabase/supabase-js';

import * as htmlparser2 from "htmlparser2";
import sanitizeHtml     from 'sanitize-html';
import UserAgent        from 'user-agents';

const abURL    = 'https://www.airbnb.com';
const abAPIKey = 'd306zoyjsyarp7ifhu67rjxn52tv0t20';

const allowedHTMLTags = ['ul', 'li', 'b', 'i', 'strong', 'p', 'br', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'];

serve(async function(req) {
    const json = await req.json();
    const type = json.type;
    const table = json.table;
    const id = json.record.id;
    console.log(`type: ${type}, table: ${table}, id: ${id}`);
    try {
        // Connects to the database with the project's 'service role' API KEY, ...
        // ... which bypases Row Level Security, but it's safe to use here since ...
        // ... this is an edge function, running from Supabase directly.
        const supabase = createClient(
            Deno.env.get('SUPABASE_URL'),
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
        );
        // Scrapes the fields of the listing whose id belongs to the inserted record.
        // This clearly requires an existing webhook for the event 'Insert' which ...
        // ... passes the required record id, but it may be extended for 'Update' ...
        // ... allowing a follow-up scrape of the same listing in a future.
        const ret = await getListingDetails(id);
        if (ret.status) {
            const u = {
                status: ret.message,
                name: ret.listing.name,
                description: ret.listing.description,
                type: ret.listing.type,
                details: ret.listing.details,
                host: ret.listing.host,
                price: ret.listing.price,
                rating: ret.listing.rating,
                amenities: ret.listing.amenities,
                photos: ret.listing.photos,
                location: ret.listing.location
            };
            // Updates the table with the scraped data.
            const { error } = await supabase.from('rooms').update(u).eq('id', id);
            if (error) {
                console.log(`** ${error.message}`);
                throw new Error(error.message);
            }
        } else {
            const u = { status: ret.message };
            // Updates the table with the scraping status message if something went wrong.
            const { error } = await supabase.from('rooms').update(u).eq('id', id);
            console.log(`** ${ret.message}`);
            throw new Error(ret.message);
        }
        console.log(ret);
        // Returns the whole scraping result to the caller, if it was successful.
        return new Response(
            JSON.stringify({ data: ret }),
            { headers: { 'Content-Type': 'application/json' }, status: 200 }
        );
    } catch (error) {
        return new Response(
            JSON.stringify({ error: error.message }),
            { headers: { 'Content-Type': 'application/json' }, status: 400 }
        );
    }
});

/**
 * @brief Loads the listing HTML and finds for the PdpPlatformRoute script URL.
 *
 * @param {string} url     airbnb.com's listing URL.
 * @param {Object} config  options for the listing request.
 *
 * @return {Object}  results.
 * @return {boolean} results.status   true if operation was successful.
 * @return {string}  results.message  error text if operation failed.
 * @return {string}  results.script   URL of the PdpPlatformRoute script.
 */
async function findPlatformRouteScript(url, config) {
    const ret = {
        status: false,
        message: '',
        script: ''
    };
    try {
        const res = await fetch(url, config);
        if (200 != res.status) {
            throw new Error(`Unexpected response code: ${res.status}`);
        } else if (-1 == res.headers.get('content-type').indexOf('text/html')) {
            throw new Error(`Unexpected content type: ${res.headers.get('content-type')}`);
        }
        const parser = new htmlparser2.Parser({
            onopentag(name, attributes) {
                if (name === 'script') {
                    const src = attributes.src;
                    if (src) {
                        if (src.match(/https:\/\/.+\/PdpPlatformRoute\.[0-9a-f]+\.js/)) {
                            ret.script = src;
                            parser.end();
                        }
                    }
                }
            }
        });
        parser.write(await res.text());
        parser.end();
        ret.status = true;
    } catch (err) {
        ret.message = `findPlatformRouteScript() failed [${err.message}]`;
    }
    return ret;
}

/**
 * @brief Makes the API V3 request URL for getting the required listing fields.
 *
 * @param {string} opId      operationId (from PdpPlatformRoute script).
 * @param {string} lisId     airbnb.com's listing id.
 * @param {Array}  sections  array of required listing sections.
 *
 * @return {string}  The API V3 request URL, ready to fetch.
 */
function getAPIStaysPdpSectionsRequestURL(opId, lisId, sections) {
    const opVars = {
        'id': btoa(`StayListing:${lisId}`),
        'pdpSectionsRequest': {
            'layouts': [
                'SIDEBAR'
            ],
            'sectionIds': sections
        }
    };
    const opExts = {
        'persistedQuery': {
            'version': 1,
            'sha256Hash': opId
        }
    };
    const encOpVars = encodeURIComponent(JSON.stringify(opVars));
    const encOpExts = encodeURIComponent(JSON.stringify(opExts));
    const query = `operationName=StaysPdpSections&locale=en&currency=USD&variables=${encOpVars}&extensions=${encOpExts}`;
    return `${abURL}/api/v3/StaysPdpSections?${query}`;
}

/**
 * @brief Scraps the listing fields from airbnb.com for a given id.
 *
 * @note The API V3 of airbnb.com requires that all the requests are sent
 *       using HTTP/2 connections.
 *       For Node.js, an implementation such as 'fetch-h2' may come handy.
 *
 * @note See https://stackoverflow.com/questions/72263805 for a method to get
 *       the persistedQuery.sha256Hash value for the extensions parameter in
 *       the API V3 calls.
 *
 * @param {string} id  airbnb.com's listing id.
 *
 * @return {Object}  results.
 * @return {boolean} results.status   true if operation was successful.
 * @return {string}  results.message  error text if operation failed.
 */
async function getListingDetails(id) {
    const ret = {
        status: false,
        message: '',
        listing: {
            name: '',
            description: '',
            type: '',
            details: [],
            host: '',
            price: {
                value: '',
                qualifier: ''
            },
            rating: 0,
            amenities: [],
            photos: [],
            location: {
                lat: 0,
                lng: 0
            }
        }
    };
    const ua = new UserAgent();
    // Forges all the requests with a made-up User Agent.
    const config = { headers: { 'User-Agent': ua.toString() } };
    try {
        let script = '';
        const r = await findPlatformRouteScript(`${abURL}/rooms/${id}`, config);
        if (!r.status) {
            throw new Error(r.message);
        }
        script = r.script;
        if (!script.length) {
            // Retries the search with the listing as 'plus', if the script was not found.
            const r = await findPlatformRouteScript(`${abURL}/rooms/plus/${id}`, config);
            if (!r.status) {
                throw new Error(r.message);
            }
            script = r.script;
        }
        if (!script.length) {
            // Retries the search with the listing as 'luxe', if the script was not found.
            const r = await findPlatformRouteScript(`${abURL}/luxury/listing/${id}`, config);
            if (!r.status) {
                throw new Error(r.message);
            }
            script = r.script;
        }
        let op = '';
        if (script.length) {
            const res = await fetch(script, config);
            if (200 != res.status) {
                throw new Error(`Unexpected response code: ${res.status}`);
            } else if (-1 == res.headers.get('content-type').indexOf('application/javascript')) {
                throw new Error(`Unexpected content type: ${res.headers.get('content-type')}`);
            }
            // Loads the PdpPlatformRoute script source code and finds for the sha256Hash value.
            op = (await res.text()).match(/name:'StaysPdpSections',type:'query',operationId:'([0-9a-f]+)'/)?.[1];
        } else {
            throw new Error('Unable to find the PdpPlatformRoute script');
        }
        if (!op.length) {
            throw new Error('Unable to find the operationId value');
        }
        config.headers['X-Airbnb-Api-Key'] = abAPIKey;
        let requestedSections = [
            [
                'TITLE_DEFAULT',
                'DESCRIPTION_DEFAULT',
                'DESCRIPTION_LUXE',
                'OVERVIEW_DEFAULT',
                'OVERVIEW_LUXE',
                'LISTING_INFO',
                'HOST_PROFILE_DEFAULT',
                'REVIEWS_DEFAULT',
                'AMENITIES_DEFAULT',
                'HERO_DEFAULT',
                'LOCATION_DEFAULT'
            ],
            [
                'BOOK_IT_SIDEBAR'
            ]
        ];
        // Places an API call for each section 'group'. Plays safe by separating 'BOOK_IT_SIDEBAR' ...
        // ... from the rest, because sometimes it causes an API internal error if it's combined.
        for (const k in requestedSections) {
            let apiReqURL = getAPIStaysPdpSectionsRequestURL(op, id, requestedSections[k]);
            const res = await fetch(apiReqURL, config);
            if (200 != res.status) {
                throw new Error(`Unexpected response code: ${res.status}`);
            } else if (-1 == res.headers.get('content-type').indexOf('application/json')) {
                throw new Error(`Unexpected content type: ${res.headers.get('content-type')}`);
            }
            const json = await res.json();
            const staySections = json.data.presentation.stayProductDetailPage.sections;
            // Checks for the different locations in the API JSON response ...
            // ... where an error condition may be returned.
            if (json.errors) {
                throw new Error(json.errors[0].message);
            } else if (staySections.metadata.errorData) {
                throw new Error(staySections.metadata.errorData.errorMessage.errorMessage);
            }
            const r = parseSections(ret.listing, staySections.sections);
            if (!r.status) {
                throw new Error(r.message);
            }
            ret.listing = r.listing;
        }
        // Verifies that the 'result' object meets the minimum required set of fields.
        if (ret.listing.name.length && ret.listing.price.value.length) {
            ret.status = true;
        } else {
            throw new Error('Unable to find a minimum of listing fields');
        }
    } catch (err) {
        ret.message = `getListingDetails() failed [${err.message}]`;
    }
    return ret;
}

/**
* @brief Fills up an object with the required values found in the JSON response 'sections'
*        of an API V3 StaysPdpSections request.
*
* @param {Object} curListing  object containing the original listing values (to start from).
* @param {Array}  sections    array of section objects (from the StaysPdpSections request).
*
* @return {Object}  results.
* @return {boolean} results.status   true if operation was successful.
* @return {string}  results.message  error text if operation failed.
* @return {Object}  results.listing  object containing additional parsed values (if any).
*/
function parseSections(curListing, sections) {
    const ret = {
        status: false,
        message: '',
        listing: curListing
    };
    try {
        for (const k in sections) {
            if ('TITLE_DEFAULT' === sections[k].sectionId) {
                if ('PdpTitleSection' === sections[k].section.__typename) {
                    ret.listing.name = sections[k].section.title;
                    if (!ret.listing.type.length) {
                        const save = sections[k].section.shareSave;
                        if (save) {
                            if (save.embedData) {
                                ret.listing.type = save.embedData.propertyType;
                            }
                        }
                    }
                }
            } else if ('DESCRIPTION_DEFAULT' === sections[k].sectionId) {
                if ('PdpDescriptionSection' === sections[k].section.__typename) {
                    if (!ret.listing.description.length) {
                        // Strips the unwanted HTML tags from the listing description.
                        ret.listing.description = sanitizeHtml(
                            sections[k].section.htmlDescription.htmlText,
                            {
                                allowedTags: allowedHTMLTags
                            }
                        );
                    }
                }
            } else if ('DESCRIPTION_LUXE' === sections[k].sectionId) {
                if ('LuxeDescriptionSection' === sections[k].section.__typename) {
                    if (!ret.listing.description.length) {
                        // Strips the unwanted HTML tags from the listing description.
                        ret.listing.description = sanitizeHtml(
                            sections[k].section.htmlDescription.htmlText,
                            {
                                allowedTags: allowedHTMLTags
                            }
                        );
                    }
                }
            } else if ('OVERVIEW_DEFAULT' === sections[k].sectionId) {
                if ('PdpOverviewSection' === sections[k].section.__typename) {
                    if (!ret.listing.type.length) {
                        ret.listing.type = sections[k].section.subtitle;
                    }
                    if (!ret.listing.details.length) {
                        const details = sections[k].section.detailItems;
                        for (const k in details) {
                            ret.listing.details.push(details[k].title);
                        }
                    }
                }
            } else if ('OVERVIEW_LUXE' === sections[k].sectionId) {
                if ('PdpOverviewSection' === sections[k].section.__typename) {
                    if (!ret.listing.details.length) {
                        const details = sections[k].section.detailItems;
                        for (const k in details) {
                            ret.listing.details.push(details[k].title);
                        }
                    }
                }
            } else if ('LISTING_INFO' === sections[k].sectionId) {
                if ('ListingInfoSection' === sections[k].section.__typename) {
                    if (!ret.listing.host.length) {
                        ret.listing.host = sections[k].section.profileName;
                    }
                    if (!ret.listing.details.length) {
                        const items = sections[k].section.infoItems;
                        for (const k in items) {
                            const details = items[k].textItems;
                            for (const k in details) {
                                ret.listing.details.push(details[k]);
                            }
                        }
                    }
                }
            } else if ('HOST_PROFILE_DEFAULT' === sections[k].sectionId) {
                if ('HostProfileSection' === sections[k].section.__typename) {
                    if (!ret.listing.host.length) {
                        ret.listing.host = sections[k].section.title.replace(/^hosted by/i, '').trim();
                    }
                }
            } else if ('REVIEWS_DEFAULT' === sections[k].sectionId) {
                if ('StayPdpReviewsSection' === sections[k].section.__typename) {
                    ret.listing.rating = sections[k].section.overallRating;
                }
            } else if ('AMENITIES_DEFAULT' === sections[k].sectionId) {
                if ('AmenitiesSection' === sections[k].section.__typename) {
                    const groups = sections[k].section.seeAllAmenitiesGroups;
                    for (const k in groups) {
                        const amenities = groups[k].amenities;
                        for (const k in amenities) {
                            if (amenities[k].available) {
                                ret.listing.amenities.push(amenities[k].title);
                            }
                        }
                    }
                }
            } else if ('HERO_DEFAULT' === sections[k].sectionId) {
                if ('PdpHeroSection' === sections[k].section.__typename) {
                    const photos = sections[k].section.previewImages;
                    for (const k in photos) {
                        ret.listing.photos.push(photos[k].baseUrl);
                    }
                }
            } else if ('LOCATION_DEFAULT' === sections[k].sectionId) {
                if ('LocationSection' === sections[k].section.__typename) {
                    ret.listing.location.lat = sections[k].section.lat;
                    ret.listing.location.lng = sections[k].section.lng;
                }
            } else if ('BOOK_IT_SIDEBAR' === sections[k].sectionId) {
                if ('BookItSection' === sections[k].section.__typename) {
                    const displayPrice = sections[k].section.structuredDisplayPrice.primaryLine;
                    ret.listing.price.value = displayPrice.price;
                    ret.listing.price.qualifier = displayPrice.qualifier;
                }
            }
        }
        ret.status = true;
    } catch (err) {
        ret.message = `parseSections() failed [${err.message}]`;
    }
    return ret;
}