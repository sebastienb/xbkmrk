-- Keyword search over stored link content (extracted articles, READMEs,
-- video transcripts). A generated tsvector column keeps it precomputed and
-- GIN-indexable; capped at 100k chars to stay well under tsvector limits
-- (plenty for search — hour-long transcripts run ~60-80k chars).
alter table link_content add column if not exists content_fts tsvector
  generated always as (to_tsvector('english', left(coalesce(content, ''), 100000))) stored;

create index if not exists link_content_fts_idx on link_content using gin (content_fts);
