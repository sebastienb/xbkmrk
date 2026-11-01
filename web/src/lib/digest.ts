import { pool } from "./db";
import { getBookmarksByIds } from "./queries";
import type { BookmarkWithLink } from "./types";

// Mirrors DigestContent built by poller/src/digest.ts.
export interface DigestPostRef {
  id: string;
  summary: string | null;
}

export interface DigestSection {
  title: string;
  lede: string | null;
  posts: DigestPostRef[];
}

export interface DigestContent {
  headline: string | null;
  editorsNote: string | null;
  lead: DigestPostRef | null;
  sections: DigestSection[];
  likes?: Array<{ id: string }>; // liked-only posts (absent in early editions)
  archive: { id: string } | null;
  stats: {
    total: number;
    bookmarks: number;
    likes: number;
    videos: number;
    photos: number;
    links: number;
    topTags: Array<{ tag: string; count: number }>;
    topAuthor: { username: string; count: number } | null;
  };
  omitted: number;
}

export interface DigestIssue {
  id: number;
  period_start: string;
  period_end: string;
  generated_at: string;
  content: DigestContent;
  posts: Map<string, BookmarkWithLink>; // hydrated rows for every referenced id
  prevId: number | null;
  nextId: number | null;
}

export async function getDigestIssue(id?: number): Promise<DigestIssue | null> {
  const { rows } = id
    ? await pool.query("select id, period_start, period_end, generated_at, content from digests where id = $1", [id])
    : await pool.query("select id, period_start, period_end, generated_at, content from digests order by id desc limit 1");
  const row = rows[0];
  if (!row) return null;

  const content: DigestContent = row.content;
  const ids = [
    ...(content.lead ? [content.lead.id] : []),
    ...content.sections.flatMap((s) => s.posts.map((p) => p.id)),
    ...(content.likes ?? []).map((l) => l.id),
    ...(content.archive ? [content.archive.id] : []),
  ];
  const [posts, nav] = await Promise.all([
    getBookmarksByIds(ids),
    pool.query(
      `select (select max(id) from digests where id < $1) as prev,
              (select min(id) from digests where id > $1) as next`,
      [row.id],
    ),
  ]);

  return {
    id: row.id,
    period_start: row.period_start,
    period_end: row.period_end,
    generated_at: row.generated_at,
    content,
    posts,
    prevId: nav.rows[0].prev,
    nextId: nav.rows[0].next,
  };
}
