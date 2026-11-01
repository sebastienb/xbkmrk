-- Profile banner image (v2 user.field profile_banner_url) — shown behind the
-- avatar on cards when a post has no media of its own.
alter table authors add column if not exists profile_banner_url text;
