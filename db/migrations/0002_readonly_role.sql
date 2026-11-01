-- read-only role for the MCP service. Password is set by the migrate script
-- (ALTER ROLE ... PASSWORD) since SQL files can't read env vars.
do $$
begin
  if not exists (select from pg_roles where rolname = 'bookmarks_ro') then
    create role bookmarks_ro login;
  end if;
end
$$;

grant connect on database bookmarks to bookmarks_ro;
grant usage on schema public to bookmarks_ro;
grant select on all tables in schema public to bookmarks_ro;
alter default privileges in schema public grant select on tables to bookmarks_ro;
