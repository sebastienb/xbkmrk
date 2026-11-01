-- App settings, editable from the web /settings page. Keys are the env-var
-- names; the poller seeds missing keys from the container env on boot, and a
-- key present here overrides the env from then on. Infra-level settings
-- (DATABASE_URL, ports, MEDIA_DIR, DB passwords) stay env-only.
create table app_settings (
  key         text primary key,
  value       text not null,
  updated_at  timestamptz not null default now()
);

-- holds API secrets — keep it away from the read-only MCP role
revoke select on app_settings from bookmarks_ro;
