-- Tombstones for deleted bookmarks: the X sync treats these ids as already
-- seen, so a deleted post is neither re-imported on the next sync nor breaks
-- the stop-on-seen pagination cutoff. Web saves don't need them (their ids
-- come from a sequence and re-saving the same url is a deliberate act), but
-- tombstoning every deletion is harmless.
create table if not exists deleted_bookmarks (
  id         bigint primary key,
  deleted_at timestamptz not null default now()
);
