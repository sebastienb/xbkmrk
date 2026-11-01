import pg from "pg";
import { env } from "./env.js";

// X ids exceed Number.MAX_SAFE_INTEGER — keep bigints as strings (pg's default).
export const pool = new pg.Pool({ connectionString: env.databaseUrl });

export interface StoredToken {
  access_token: string | null;
  refresh_token: string;
  expires_at: Date | null;
}

export async function loadToken(): Promise<StoredToken | null> {
  const { rows } = await pool.query("select access_token, refresh_token, expires_at from oauth_token where id = 1");
  return rows[0] ?? null;
}

export async function saveToken(t: { access_token: string; refresh_token: string; expires_at: Date }): Promise<void> {
  await pool.query(
    `insert into oauth_token (id, access_token, refresh_token, expires_at, updated_at)
     values (1, $1, $2, $3, now())
     on conflict (id) do update set
       access_token = excluded.access_token,
       refresh_token = excluded.refresh_token,
       expires_at = excluded.expires_at,
       updated_at = now()`,
    [t.access_token, t.refresh_token, t.expires_at],
  );
}

// Which of these ids are already stored *for the given stream*? A post that
// exists only as a like must not stop the bookmark sync, and vice versa.
export async function existingBookmarkIds(ids: string[], stream: "bookmarked" | "liked"): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const flag = stream === "liked" ? "liked" : "bookmarked";
  const { rows } = await pool.query(
    `select id::text as id from bookmarks where ${flag} and id = any($1::bigint[])
     union
     select id::text as id from deleted_bookmarks where id = any($1::bigint[])`,
    [ids],
  );
  return new Set(rows.map((r: { id: string }) => r.id));
}

export async function upsertAuthor(a: {
  id: string; username?: string; name?: string; profile_image_url?: string;
  profile_banner_url?: string; verified?: boolean;
}): Promise<void> {
  await pool.query(
    `insert into authors (id, username, name, profile_image_url, profile_banner_url, verified, updated_at)
     values ($1, $2, $3, $4, $5, $6, now())
     on conflict (id) do update set
       username = excluded.username,
       name = excluded.name,
       profile_image_url = excluded.profile_image_url,
       profile_banner_url = excluded.profile_banner_url,
       verified = excluded.verified,
       updated_at = now()`,
    [a.id, a.username ?? null, a.name ?? null, a.profile_image_url ?? null,
     a.profile_banner_url ?? null, a.verified ?? null],
  );
}

export async function insertBookmark(b: {
  id: string;
  author_id: string | null;
  text: string;
  is_long: boolean;
  created_at: string;
  urls: unknown;
  referenced: unknown;
  metrics: unknown;
  lang: string | null;
  raw: unknown;
  embedding: number[] | null;
  bookmarked: boolean;
  liked: boolean;
}): Promise<boolean> {
  // on conflict: only merge the stream flags — never clobber notes/tags/read_at
  const res = await pool.query(
    `insert into bookmarks (id, author_id, text, is_long, created_at, urls, referenced, metrics, lang, raw, embedding, bookmarked, liked)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::vector, $12, $13)
     on conflict (id) do update set
       bookmarked = bookmarks.bookmarked or excluded.bookmarked,
       liked = bookmarks.liked or excluded.liked
     returning (xmax = 0) as inserted`,
    [
      b.id, b.author_id, b.text, b.is_long, b.created_at,
      JSON.stringify(b.urls ?? null), JSON.stringify(b.referenced ?? null), JSON.stringify(b.metrics ?? null),
      b.lang, JSON.stringify(b.raw ?? null),
      b.embedding ? `[${b.embedding.join(",")}]` : null,
      b.bookmarked, b.liked,
    ],
  );
  return rowsInserted(res);
}

function rowsInserted(res: pg.QueryResult): boolean {
  return res.rows[0]?.inserted === true;
}

export async function insertMedia(m: {
  media_key: string; bookmark_id: string; type: string | null;
  local_path: string | null; alt_text: string | null; width: number | null; height: number | null;
}): Promise<void> {
  await pool.query(
    `insert into media (media_key, bookmark_id, type, local_path, alt_text, width, height)
     values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (media_key) do update set
       local_path = coalesce(excluded.local_path, media.local_path),
       alt_text = excluded.alt_text`,
    [m.media_key, m.bookmark_id, m.type, m.local_path, m.alt_text, m.width, m.height],
  );
}

export async function upsertLinkContent(lc: {
  bookmark_id: string;
  url: string;
  kind: string;
  title?: string | null;
  site_name?: string | null;
  description?: string | null;
  og_image_path?: string | null;
  content?: string | null;
  status: string;
}): Promise<void> {
  await pool.query(
    `insert into link_content (bookmark_id, url, kind, title, site_name, description, og_image_path, content, status, fetched_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
     on conflict (bookmark_id) do update set
       url = excluded.url, kind = excluded.kind, title = excluded.title,
       site_name = excluded.site_name, description = excluded.description,
       og_image_path = coalesce(excluded.og_image_path, link_content.og_image_path),
       content = excluded.content, status = excluded.status, fetched_at = now()`,
    [lc.bookmark_id, lc.url, lc.kind, lc.title ?? null, lc.site_name ?? null,
     lc.description ?? null, lc.og_image_path ?? null, lc.content ?? null, lc.status],
  );
}

// Usage accounting must never break a fetch — swallow errors (e.g. the
// poller running before the migration applied).
export async function recordApiUsage(endpoint: string, postsRead: number): Promise<void> {
  try {
    await pool.query("insert into x_api_usage (endpoint, posts_read) values ($1, $2)", [endpoint, postsRead]);
  } catch (err) {
    console.warn(`x_api_usage insert failed: ${(err as Error).message}`);
  }
}

export async function saveUsageSnapshot(data: unknown): Promise<void> {
  await pool.query(
    `insert into x_usage_snapshot (id, data, fetched_at) values (1, $1::jsonb, now())
     on conflict (id) do update set data = excluded.data, fetched_at = now()`,
    [JSON.stringify(data)],
  );
}

export async function lastSyncAt(): Promise<Date | null> {
  const { rows } = await pool.query("select last_run_at from sync_state where id = 1");
  return rows[0]?.last_run_at ?? null;
}

export async function updateSyncState(newestSeenId: string | null): Promise<void> {
  await pool.query(
    `insert into sync_state (id, last_run_at, newest_seen_id)
     values (1, now(), $1)
     on conflict (id) do update set
       last_run_at = now(),
       newest_seen_id = coalesce(excluded.newest_seen_id, sync_state.newest_seen_id)`,
    [newestSeenId],
  );
}

export async function bookmarksMissingEmbedding(limit = 200): Promise<Array<{ id: string; text: string; referenced: any }>> {
  const { rows } = await pool.query(
    `select id::text as id, text, referenced from bookmarks where embedding is null order by saved_at desc limit $1`,
    [limit],
  );
  return rows;
}

export async function setEmbedding(id: string, embedding: number[]): Promise<void> {
  await pool.query("update bookmarks set embedding = $2::vector where id = $1", [id, `[${embedding.join(",")}]`]);
}
