create extension if not exists vector;

-- single-user OAuth token storage. Refresh tokens ROTATE on X, so they must be
-- writable at runtime — store here, not in .env.
create table oauth_token (
  id             int primary key default 1,          -- enforce single row
  access_token   text,
  refresh_token  text not null,
  expires_at     timestamptz,
  updated_at     timestamptz not null default now(),
  constraint oauth_token_single_row check (id = 1)
);

create table authors (
  id                bigint primary key,               -- X user id
  username          text,
  name              text,
  profile_image_url text,
  verified          boolean,
  updated_at        timestamptz not null default now()
);

create table bookmarks (
  id            bigint primary key,                   -- X post id == natural dedup key
  author_id     bigint references authors(id),
  text          text not null,                        -- note_tweet body if long, else text
  is_long       boolean not null default false,
  created_at    timestamptz not null,                 -- when the POST was published
  saved_at      timestamptz not null default now(),   -- when WE ingested it (no bookmarked_at from API)
  read_at       timestamptz,                          -- null = unread
  notes         text,                                 -- your own annotations
  tags          text[] not null default '{}',
  urls          jsonb,                                -- [{expanded_url, display_url}]
  referenced    jsonb,                                -- quote/reply/repost refs incl. quoted text
  metrics       jsonb,                                -- public_metrics at save time
  lang          text,
  raw           jsonb,                                -- full API payload, for later reprocessing
  embedding     vector(768)                           -- DIM MUST MATCH embedding model
);

create table media (
  media_key    text primary key,
  bookmark_id  bigint not null references bookmarks(id) on delete cascade,
  type         text,                                  -- photo | video | animated_gif
  local_path   text,                                  -- rehosted file under data/media
  alt_text     text,
  width        int,
  height       int
);

-- sync bookkeeping (e.g. last successful run, newest-seen id)
create table sync_state (
  id              int primary key default 1,
  last_run_at     timestamptz,
  newest_seen_id  bigint,
  constraint sync_state_single_row check (id = 1)
);

create index bookmarks_embedding_hnsw on bookmarks using hnsw (embedding vector_cosine_ops);
create index bookmarks_saved_at on bookmarks (saved_at desc);
create index bookmarks_read_at on bookmarks (read_at);
create index bookmarks_text_fts on bookmarks using gin (to_tsvector('english', text));
create index bookmarks_tags on bookmarks using gin (tags);
