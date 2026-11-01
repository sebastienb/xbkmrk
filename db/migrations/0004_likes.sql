-- Liked posts share the bookmarks table; flags say which stream(s) a post
-- came from. A post can be both bookmarked and liked (one row, both true).
alter table bookmarks add column bookmarked boolean not null default true;
alter table bookmarks add column liked boolean not null default false;

create index bookmarks_liked on bookmarks (liked) where liked;
