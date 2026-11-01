-- Web saves: pages captured via the bookmarklet, living alongside X posts.
-- bookmarks.id stays bigint; web saves draw ids from a sequence parked far
-- above X snowflakes (~1.9e18 in 2026, reaching 9e18 only around year 2078).
alter table bookmarks add column if not exists source text not null default 'x';

create sequence if not exists web_save_id start with 9000000000000000000;
