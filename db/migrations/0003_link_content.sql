-- Enriched content for the primary external link of each bookmark:
-- og metadata, extracted article HTML, or GitHub README markdown.
create table link_content (
  bookmark_id   bigint primary key references bookmarks(id) on delete cascade,
  url           text not null,            -- primary external link
  kind          text not null,            -- article | github | other
  title         text,
  site_name     text,
  description   text,
  og_image_path text,                     -- local file under data/media/og/
  content       text,                     -- sanitized article HTML, or raw README markdown (kind=github)
  status        text not null,            -- ok | no_content | failed | no_link
  fetched_at    timestamptz not null default now()
);

grant select on link_content to bookmarks_ro;
