// Shared ingestion for external-source items. Mirrors what a bookmarklet
// save produces: a bookmarks row with an id from the web_save_id sequence,
// the canonical url in urls[0], plus a ready link_content row (external
// sources bring their own metadata — the generic page-enrichment pass is
// skipped because the row already exists).
import { pool, upsertLinkContent } from "../db.js";
import { embed } from "../embed.js";
import { downloadOgImage } from "../enrich.js";
import type { ExternalItem, ExternalSource } from "./types.js";

// All urls already archived for a source — lets collect() skip metadata
// fetches for items it has seen before. Fine to load whole: one short url
// per saved item.
export async function knownUrls(sourceId: string): Promise<Set<string>> {
  const { rows } = await pool.query(
    `select urls->0->>'expanded_url' as url from bookmarks where source = $1`,
    [sourceId],
  );
  return new Set(rows.map((r: { url: string | null }) => r.url).filter(Boolean) as string[]);
}

// Correct the dates of an already-archived item once better ones turn up
// (e.g. the YouTube API key is added after a keyless import stamped everything
// with the import time). No-op when the stored dates are already right, so
// sources can call this every sync. Returns true when a row changed.
export async function backdateExternalItem(
  sourceId: string,
  url: string,
  savedAt: string,
  createdAt: string | null,
): Promise<boolean> {
  const res = await pool.query(
    `update bookmarks
     set saved_at = $3::timestamptz,
         created_at = coalesce($4::timestamptz, created_at)
     where source = $1 and urls->0->>'expanded_url' = $2
       and (abs(extract(epoch from (saved_at - $3::timestamptz))) > 60
            or ($4::timestamptz is not null and abs(extract(epoch from (created_at - $4::timestamptz))) > 60))`,
    [sourceId, url, savedAt, createdAt],
  );
  return (res.rowCount ?? 0) > 0;
}

export async function ingestExternalItem(source: ExternalSource, item: ExternalItem): Promise<boolean> {
  // re-check right before insert — keeps overlapping runs (settings save
  // racing a scheduled sync) from double-inserting
  const dupe = await pool.query(
    `select 1 from bookmarks where source = $1 and urls->0->>'expanded_url' = $2`,
    [source.id, item.url],
  );
  if (dupe.rows[0]) return false;

  const text = [item.title, item.description?.trim()].filter(Boolean).join("\n\n").slice(0, 8000);
  // full content (transcript, article body) enriches the embedding; embed()
  // truncates its input, so long transcripts contribute their opening
  const embedding = await embed([text, item.content?.trim()].filter(Boolean).join("\n\n"));

  const parsed = new URL(item.url);
  const display = (parsed.hostname.replace(/^www\./, "") + parsed.pathname + parsed.search).slice(0, 60);

  const { rows } = await pool.query(
    `insert into bookmarks (id, source, author_id, text, is_long, created_at, saved_at, urls, raw, embedding, bookmarked, liked)
     values (nextval('web_save_id'), $1, null, $2, false, coalesce($3::timestamptz, now()), coalesce($4::timestamptz, now()), $5::jsonb, $6::jsonb, $7::vector, true, false)
     returning id::text as id`,
    [
      source.id,
      text,
      item.publishedAt ?? null,
      item.savedAt ?? null,
      JSON.stringify([{ expanded_url: item.url, display_url: display }]),
      JSON.stringify(item.raw ?? { source: source.id, url: item.url }),
      embedding ? `[${embedding.join(",")}]` : null,
    ],
  );
  const id: string = rows[0].id;

  const ogImagePath = item.thumbnailUrl ? await downloadOgImage(id, item.thumbnailUrl) : null;
  await upsertLinkContent({
    bookmark_id: id,
    url: item.url,
    kind: item.kind ?? "other",
    title: item.title,
    site_name: item.siteName ?? null,
    description: item.description?.slice(0, 500) ?? null,
    og_image_path: ogImagePath,
    content: item.content?.slice(0, 1_000_000) ?? null,
    status: item.content ? "ok" : "no_content",
  });
  return true;
}
