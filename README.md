# SAS - SupAir scraper
Supabase edge function for scraping listings from airbnb.com.


Features
--------

* Detects when a new room/property is added to the database.
* Automatically populates the room details with data scraped from airbnb.com.
* Shows the scraping status/result in a special column.


Known bugs / ToDo's
-------------------

- [x] ~~For some random listings, the script only gets 50x errors. Still figuring out why~~.
<br>*It seems that under some circumnstances the 'BOOK_IT_' sections cannot be combined
<br>with the others in a single query*.
<br>To avoid this, another query is now being requested to separate it from the rest,
<br>which is unfortunate, considering that for most listings this is not necessary.
- [ ] 'Luxe' listings are also causing 50x errors as well, because of a meta-redirection.


Installation
------------

### Pre-requisites:

1. [supabase](https://app.supabase.com/sign-up) account.
2. [supabase CLI](https://supabase.com/docs/guides/cli).
3. [git](https://git-scm.com/downloads).

### @ supabase.com:

* Go to https://app.supabase.com/projects.
    - Click on New project
    - Name: `sas`
    - Click on Create new project
    - In General settings, copy the Reference Id.
    <br>_Let's say it's "thgbgtsuowagtegfoxaa". Replace it with yours accordingly, from now on._
* Go to https://app.supabase.com/account/tokens.
    - Click on Generate new token
    - name: `sas-token`
    - Click on Generate token
    - Copy the generated Access Token.

### @ shell/command-line:

* `cd` to any directory where you want to put the sources in.
    - `git clone https://github.com/quark1482/sas`
    - `cd sas`
    - `supabase init` (_remove ./supabase/config.toml if asked and try again_)
    - `supabase login` _enter the Access Token from the previous step and press \<Enter\>_
    - `supabase link --project-ref thgbgtsuowagtegfoxaa` (_that's the project's Reference Id_)
    - `supabase functions deploy airbnb-webhook`

### again @ supabase.com:

* Go to ` https://app.supabase.com/project/thgbgtsuowagtegfoxaa/functions `.
    - Copy the Edge Function URL for airbnb-webhook.
    <br>_Let's say it's ` https://thgbgtsuowagtegfoxaa.functions.supabase.co/airbnb-webhook `._
* Go to ` https://app.supabase.com/project/thgbgtsuowagtegfoxaa/sql `.
    - Click on New query
    - Open the file "rooms.sql" (in the sources folder) with a text editor and copy the contents.
    - Paste the contents in the query editor
    - Click on Run
* Go to ` https://app.supabase.com/project/thgbgtsuowagtegfoxaa/settings/api `.
    - In Project API keys, copy the Anon/Public key
* Go to ` https://app.supabase.com/project/thgbgtsuowagtegfoxaa/database/hooks `.
    - Click on Create webhook (_enable hooks first if required_)
    - Name: `rooms_webhook`
    - Table: `rooms` (_that should be there by default_)
    - Events: INSERT
    - Method: POST
    - URL: _enter the Edge Function URL_
    - Click on Add new header
    - Header name: `Authorization`
    - Header value: _enter `Bearer`, \<Space\>, and then the Anon/Public key from the previous step_
    - Click on Confirm

### Tests:

* Go to ` https://app.supabase.com/project/tageshxagowtutgbagfo/editor `.
    - At the left pane, click on "rooms"
    - Click on Insert, and then on Insert row
    - Id: _any valid airbnb.com room id_
    - At the end of the form, click on Save
    - Wait a few seconds and click on Refresh
    - Check the collected data for the new record.
    <br>_The "status" value will be EMPTY unless something fails_<br><br>
    ><sup>"room id" is the numerical value following ` https://www.airbnb.com/rooms/ ` for each listing</sup>


Results
-------

According to the installation process, an Edge Function is created and then set up to be
<br>invoked by a Webhook, every time a new record is inserted in our specifically designed table.

As explained before, the only requirement in the "insert form" is filling up the field "id",
<br>since the others will be automatically scraped from airbnb.

The easiest way of understanding what's being scraped, is by looking at the table structure:

```
create table rooms (
  id          text       default ''::text                               primary key,
  status      text       default ''::text                               not null,
  name        text       default ''::text                               not null,
  description text       default ''::text                               not null,
  type        text       default ''::text                               not null,
  details     text array default '{}'::text[]                           not null,
  host        text       default ''::text                               not null,
  price       jsonb      default '{"value": 0, "qualifier": ""}'::jsonb not null,
  rating      real       default '0'::real                              not null,
  amenities   text array default '{}'::text[]                           not null,
  photos      text array default '{}'::text[]                           not null,
  location    jsonb      default '{"lat": 0, "lng": 0}'::jsonb          not null
);
```

><sup>"id" is the airbnb.com room id</sup>

><sup>"status" is where you can quickly verify the scraping result (EMPTY means success)</sup>

><sup>"name" is the room listing title</sup>

><sup>"description", the listing description paragraph(s) which may contain some HTML tags </sup>

><sup>"type", the room type - something like "entire place", "private room", etc. </sup>

><sup>"details", an array of specifics - amount of beds, amount of baths, etc. </sup>

><sup>"host", the name/nickname of the property's host</sup>

><sup>"price", a pair of values - the price itself (in USD) and what's covered by that (a "night", mostly) </sup>

><sup>"rating", the overall property/host rating</sup>

><sup>"amenities", an array of room features, like "hot water", "wifi", "kitchen", etc. </sup>

><sup>"photos", all the listing photos (an array of links)</sup>

><sup>"location", the pair of coordinates (latitude/longitude) of the property's location</sup>

_The bare minimum of fields collected for a scraping to be considered successful is Name and Price._


Dependencies
------------

* [supabase-js](https://github.com/supabase/supabase-js)
<br>The official JavaScript client for Supabase.

* [std/server](https://deno.land/std@0.177.0/http/server.ts)
<br>Deno standard library's HTTP server.

* [htmlparser2](https://github.com/fb55/htmlparser2)
<br>Library for parsing/manipulating HTML.

* [cheerio](https://github.com/cheeriojs/cheerio)
<br>Library for parsing/manipulating HTML.

* [sanitize-html](https://github.com/apostrophecms/sanitize-html)
<br>HTML sanitizer.

* [user-agents](https://github.com/intoli/user-agents)
<br>Random User Agents generator.


<br><br>
_This README file is under construction._