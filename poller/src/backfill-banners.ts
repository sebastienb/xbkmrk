// One-off backfill: fetch profile_banner_url for authors synced before the
// field existed (migration 0009). New/updated authors get it during normal
// sync; run this once with: npm run backfill:banners
import { pool, upsertAuthor } from "./db.js";
import { getUsersByIds } from "./xclient.js";

const { rows } = await pool.query(
  `select id::text as id from authors where profile_banner_url is null order by id`,
);
const ids = rows.map((r: { id: string }) => r.id);
console.log(`${ids.length} authors without a banner`);

let updated = 0;
for (let i = 0; i < ids.length; i += 100) {
  const batch = ids.slice(i, i + 100);
  const users = await getUsersByIds(batch);
  for (const u of users) {
    if (!u.profile_banner_url) continue; // author simply has no banner set
    await upsertAuthor(u);
    updated++;
  }
  console.log(`batch ${i / 100 + 1}: ${users.length} found, ${updated} banners so far`);
}

console.log(`done — ${updated} authors updated`);
await pool.end();
