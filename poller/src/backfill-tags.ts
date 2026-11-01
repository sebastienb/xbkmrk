// One-off: auto-tag all untagged posts in batches until none remain.
// Run: npm run backfill:tags
import { backfillTags } from "./autotag.js";
import { pool } from "./db.js";

let total = 0;
for (;;) {
  const n = await backfillTags(20);
  if (n === 0) break;
  total += n;
  console.log(`tagged ${n} (total ${total})`);
}
const { rows } = await pool.query(
  "select unnest(tags) as tag, count(*)::int as n from bookmarks group by 1 order by 2 desc limit 20",
);
console.table(rows);
await pool.end();
console.log(`done — ${total} posts tagged`);
