-- Track auto-tagging attempts so posts aren't re-tagged (and user tag
-- deletions aren't overridden by the next sync).
alter table bookmarks add column auto_tagged_at timestamptz;
