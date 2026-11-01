-- Live status of the digest printing press (single row, like sync_state).
-- The poller updates it as generation progresses; the web /digest page polls
-- it to show "writing blurbs (12/25)…" instead of a dead button.
create table digest_state (
  id          int primary key default 1,
  running     boolean not null default false,
  note        text,
  started_at  timestamptz,
  updated_at  timestamptz not null default now(),
  constraint digest_state_single_row check (id = 1)
);

insert into digest_state (id) values (1);

grant select on digest_state to bookmarks_ro;
