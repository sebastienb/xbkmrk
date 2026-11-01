import { pool } from "./db";
import { embedQuery } from "./embed";
import { savedDateClauses, type SavedDateRange } from "./saved-dates";

export interface ListFilters extends SavedDateRange {
  author?: string; // username
  tag?: string;
  source?: "bookmarks" | "likes" | "web" | "youtube"; // undefined = all
  content?: "video" | "photo" | "article" | "github" | "link" | "text"; // media/content type, undefined = all
  unread?: boolean; // true = unread only, false = read only, undefined = all
  cursor?: string; // base64 "saved_at|id" for list pagination
  q?: string;
  mode?: "keyword" | "semantic" | "hybrid";
  limit?: number;
}

const SELECT_FULL = `
  select b.id::text as id, b.text, b.is_long, b.created_at, b.saved_at, b.read_at,
         b.notes, b.tags, b.urls, b.referenced, b.metrics, b.lang, b.bookmarked, b.liked, b.source,
         b.author_id::text as author_id, a.username, a.name as author_name, a.profile_image_url,
         a.profile_banner_url,
         coalesce(m.items, '[]'::jsonb) as media, l.link
  from bookmarks b
  left join authors a on a.id = b.author_id
  left join lateral (
    select jsonb_agg(jsonb_build_object(
      'media_key', media_key, 'type', type, 'local_path', local_path,
      'alt_text', alt_text, 'width', width, 'height', height)) as items
    from media where bookmark_id = b.id
  ) m on true
  left join lateral (
    select case when lc.status in ('ok', 'no_content') then jsonb_build_object(
      'url', lc.url, 'kind', lc.kind, 'title', lc.title, 'site_name', lc.site_name,
      'description', lc.description, 'og_image_path', lc.og_image_path,
      'has_content', lc.content is not null) end as link
    from link_content lc where lc.bookmark_id = b.id
  ) l on true`;

function filterClauses(f: ListFilters, params: unknown[]): string[] {
  const where = savedDateClauses(f, params);
  if (f.author) {
    params.push(f.author);
    where.push(`a.username = $${params.length}`);
  }
  if (f.tag) {
    params.push(f.tag);
    where.push(`$${params.length} = any(b.tags)`);
  }
  if (f.unread === true) where.push("b.read_at is null");
  if (f.unread === false) where.push("b.read_at is not null");
  if (f.source === "bookmarks") where.push("b.bookmarked");
  if (f.source === "likes") where.push("b.liked");
  if (f.source === "web") where.push("b.source = 'web'");
  if (f.source === "youtube") where.push("b.source = 'youtube'");
  if (f.content === "video") {
    // downloaded X media or an external video link (YouTube, …)
    where.push(`(exists (select 1 from media m where m.bookmark_id = b.id and m.type in ('video','animated_gif'))
      or exists (select 1 from link_content lc where lc.bookmark_id = b.id and lc.kind = 'video'))`);
  }
  if (f.content === "photo") {
    where.push("exists (select 1 from media m where m.bookmark_id = b.id and m.type = 'photo')");
  }
  if (f.content === "article") {
    // extracted external article or long-form X article
    where.push("exists (select 1 from link_content lc where lc.bookmark_id = b.id and lc.kind in ('article','x_article') and lc.status = 'ok')");
  }
  if (f.content === "github") {
    where.push("exists (select 1 from link_content lc where lc.bookmark_id = b.id and lc.kind = 'github' and lc.status = 'ok')");
  }
  if (f.content === "link") {
    // has an enriched external link (article / github / x_article / og card)
    where.push("exists (select 1 from link_content lc where lc.bookmark_id = b.id and lc.status in ('ok','no_content'))");
  }
  if (f.content === "text") {
    // plain post: no media, no external link
    where.push("not exists (select 1 from media m where m.bookmark_id = b.id)");
    where.push("not exists (select 1 from link_content lc where lc.bookmark_id = b.id and lc.status in ('ok','no_content'))");
  }
  return where;
}

export async function listBookmarks(f: ListFilters) {
  if (f.q) return searchBookmarks(f);

  // total for the current filters (ignores pagination cursor)
  const countParams: unknown[] = [];
  const countWhere = filterClauses(f, countParams);
  const countRes = await pool.query(
    `select count(*)::int as total from bookmarks b
     left join authors a on a.id = b.author_id
     ${countWhere.length ? `where ${countWhere.join(" and ")}` : ""}`,
    countParams,
  );
  const total: number = countRes.rows[0].total;

  const params: unknown[] = [];
  const where = filterClauses(f, params);
  if (f.cursor) {
    const [savedAt, id] = Buffer.from(f.cursor, "base64").toString().split("|");
    params.push(savedAt, id);
    where.push(`(b.saved_at, b.id) < ($${params.length - 1}::timestamptz, $${params.length}::bigint)`);
  }
  const limit = Math.min(f.limit ?? 30, 100);
  params.push(limit);

  const { rows } = await pool.query(
    `${SELECT_FULL}
     ${where.length ? `where ${where.join(" and ")}` : ""}
     order by b.saved_at desc, b.id desc
     limit $${params.length}`,
    params,
  );

  let nextCursor: string | null = null;
  if (rows.length === limit) {
    const last = rows[rows.length - 1];
    nextCursor = Buffer.from(`${new Date(last.saved_at).toISOString()}|${last.id}`).toString("base64");
  }
  return { bookmarks: rows, nextCursor, total };
}

// Search: keyword (FTS), semantic (vector cosine), or hybrid (reciprocal rank fusion).
// Falls back to keyword when the embedding endpoint is unavailable.
export async function searchBookmarks(f: ListFilters) {
  const mode = f.mode ?? "hybrid";
  const limit = Math.min(f.limit ?? 30, 100);
  const q = f.q!;

  let vec: number[] | null = null;
  if (mode !== "keyword") vec = await embedQuery(q);
  const effectiveMode = vec ? mode : "keyword";

  const params: unknown[] = [];
  const where = filterClauses(f, params);
  const filterSql = where.length ? `and ${where.join(" and ")}` : "";

  let rankCte: string;
  if (effectiveMode === "keyword") {
    params.push(q);
    // matches in the post text or the stored content (article, README,
    // transcript — content_fts, migration 0013); content matches weighted
    // slightly below text matches
    rankCte = `
      ranked as (
        select b.id, greatest(
                 ts_rank(to_tsvector('english', b.text), websearch_to_tsquery('english', $${params.length})),
                 coalesce(ts_rank(flc.content_fts, websearch_to_tsquery('english', $${params.length})) * 0.8, 0)
               ) as score
        from bookmarks b
        left join authors a on a.id = b.author_id
        left join link_content flc on flc.bookmark_id = b.id
        where (to_tsvector('english', b.text) @@ websearch_to_tsquery('english', $${params.length})
               or flc.content_fts @@ websearch_to_tsquery('english', $${params.length})) ${filterSql}
        order by score desc
        limit ${limit}
      )`;
  } else if (effectiveMode === "semantic") {
    params.push(`[${vec!.join(",")}]`);
    rankCte = `
      ranked as (
        select b.id, 1 - (b.embedding <=> $${params.length}::vector) as score
        from bookmarks b
        left join authors a on a.id = b.author_id
        where b.embedding is not null ${filterSql}
        order by b.embedding <=> $${params.length}::vector
        limit ${limit}
      )`;
  } else {
    // hybrid: RRF over keyword + vector rankings
    params.push(q);
    const qIdx = params.length;
    params.push(`[${vec!.join(",")}]`);
    const vIdx = params.length;
    rankCte = `
      kw as (
        select b.id, row_number() over (
          order by greatest(
            ts_rank(to_tsvector('english', b.text), websearch_to_tsquery('english', $${qIdx})),
            coalesce(ts_rank(flc.content_fts, websearch_to_tsquery('english', $${qIdx})) * 0.8, 0)
          ) desc) as rn
        from bookmarks b
        left join authors a on a.id = b.author_id
        left join link_content flc on flc.bookmark_id = b.id
        where (to_tsvector('english', b.text) @@ websearch_to_tsquery('english', $${qIdx})
               or flc.content_fts @@ websearch_to_tsquery('english', $${qIdx})) ${filterSql}
        limit 60
      ),
      sem as (
        select b.id, row_number() over (order by b.embedding <=> $${vIdx}::vector) as rn
        from bookmarks b
        left join authors a on a.id = b.author_id
        where b.embedding is not null ${filterSql}
        order by b.embedding <=> $${vIdx}::vector
        limit 60
      ),
      ranked as (
        select coalesce(kw.id, sem.id) as id,
               coalesce(1.0 / (60 + kw.rn), 0) + coalesce(1.0 / (60 + sem.rn), 0) as score
        from kw full outer join sem using (id)
        order by score desc
        limit ${limit}
      )`;
  }

  const { rows } = await pool.query(
    `with ${rankCte}
     ${SELECT_FULL}
     join ranked r on r.id = b.id
     order by r.score desc`,
    params,
  );
  return { bookmarks: rows, nextCursor: null, total: rows.length, mode: effectiveMode };
}

// Hydrate digest post refs: full rows for a set of ids, keyed by id.
export async function getBookmarksByIds(ids: string[]) {
  if (ids.length === 0) return new Map();
  const { rows } = await pool.query(
    `${SELECT_FULL}
     where b.id = any($1::bigint[])`,
    [ids],
  );
  return new Map<string, (typeof rows)[number]>(rows.map((r) => [r.id, r]));
}

export async function getFilterOptions() {
  const [authors, tags] = await Promise.all([
    pool.query(
      `select a.username, a.name, count(*)::int as count
       from bookmarks b join authors a on a.id = b.author_id
       where a.username is not null
       group by a.username, a.name order by count desc, a.username limit 200`,
    ),
    pool.query(`select unnest(tags) as tag, count(*)::int as count from bookmarks group by 1 order by 2 desc, 1`),
  ]);
  return { authors: authors.rows, tags: tags.rows };
}

export async function getBookmarkDetail(id: string) {
  const { rows } = await pool.query(
    `${SELECT_FULL}
     where b.id = $1::bigint`,
    [id],
  );
  if (!rows[0]) return null;
  const { rows: contentRows } = await pool.query(
    "select content from link_content where bookmark_id = $1::bigint and status = 'ok'",
    [id],
  );
  return { ...rows[0], content: contentRows[0]?.content ?? null };
}

export async function updateBookmark(
  id: string,
  patch: { notes?: string | null; tags?: string[]; read?: boolean },
) {
  const sets: string[] = [];
  const params: unknown[] = [id];
  if ("notes" in patch) {
    params.push(patch.notes);
    sets.push(`notes = $${params.length}`);
  }
  if ("tags" in patch && Array.isArray(patch.tags)) {
    params.push(patch.tags);
    sets.push(`tags = $${params.length}`);
  }
  if ("read" in patch) {
    sets.push(patch.read ? "read_at = coalesce(read_at, now())" : "read_at = null");
  }
  if (sets.length === 0) return null;
  const { rows } = await pool.query(
    `update bookmarks set ${sets.join(", ")} where id = $1
     returning id::text as id, notes, tags, read_at`,
    params,
  );
  return rows[0] ?? null;
}
