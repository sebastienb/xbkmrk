// One-off maintenance: re-fetch bookmarks that are X Articles (raw ? 'article')
// with the article fields, update text/raw, store article content + cover media.
// Costs ~1 read per article bookmark. Run: npm run backfill:articles
import { pool } from "./db.js";
import { getTweet } from "./xclient.js";
import { articleText, storeArticleContent } from "./sync.js";

const { rows } = await pool.query(
  `select b.id::text as id from bookmarks b
   left join link_content lc on lc.bookmark_id = b.id
   where b.raw ? 'article' and (
     lc.kind is distinct from 'x_article'
     or lc.content is null
     or (b.raw->'article'->>'cover_media' is not null and not exists (
       select 1 from media m where m.bookmark_id = b.id and m.media_key = b.raw->'article'->>'cover_media'))
   )
   order by b.saved_at desc`,
);
console.log(`${rows.length} article bookmarks to backfill`);

for (const row of rows) {
  try {
    const res = await getTweet(row.id);
    const t = res.data?.[0];
    if (!t?.article) {
      console.warn(`${row.id}: no article in response — skipped`);
      continue;
    }
    const media = new Map<string, any>((res.includes?.media ?? []).map((m: any) => [m.media_key, m]));
    const text = articleText(t);
    await pool.query(
      "update bookmarks set text = coalesce($2, text), is_long = true, raw = $3, embedding = null where id = $1",
      [t.id, text, JSON.stringify(t)],
    );
    await storeArticleContent(t, media);
    console.log(`${t.id}: "${t.article.title}" (${t.article.plain_text?.length ?? 0} chars)`);
  } catch (err) {
    console.error(`${row.id}: ${(err as Error).message}`);
  }
}
await pool.end();
console.log("done — embeddings reset, next sync re-embeds with article text");
