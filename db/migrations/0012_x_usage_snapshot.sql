-- Latest response from X's official usage endpoint (GET /2/usage/tweets),
-- fetched by the poller when an app bearer token is configured. Single row.
create table if not exists x_usage_snapshot (
  id int primary key default 1 check (id = 1),
  data jsonb not null,
  fetched_at timestamptz not null default now()
);
