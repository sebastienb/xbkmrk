-- X API usage log: one row per HTTP request the poller makes, with the number
-- of billable posts it returned (X bills per post read, not per request).
create table if not exists x_api_usage (
  id bigserial primary key,
  ts timestamptz not null default now(),
  endpoint text not null,
  posts_read int not null default 0
);
create index if not exists x_api_usage_ts_idx on x_api_usage (ts);
