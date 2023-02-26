drop table if exists rooms;

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

alter table rooms enable row level security;