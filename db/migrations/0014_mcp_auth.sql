-- Bearer token for the MCP server. Lives in its own table rather than
-- app_settings because the MCP server connects as bookmarks_ro, which is
-- deliberately barred from app_settings (API keys and password hashes live
-- there). The web app mints the token (first visit to /connect); the MCP
-- server only ever reads it.
create table if not exists mcp_auth (
  id         int primary key default 1 check (id = 1),
  token      text not null,
  updated_at timestamptz not null default now()
);

grant select on mcp_auth to bookmarks_ro;
