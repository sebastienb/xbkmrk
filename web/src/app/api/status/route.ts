import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getSetting } from "@/lib/settings";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [stats, recent, sync, usage, costPer1k] = await Promise.all([
      pool.query(
        `select count(*)::int as total,
                count(*) filter (where saved_at > now() - interval '24 hours')::int as added_24h,
                count(*) filter (where tags != '{}')::int as tagged,
                count(*) filter (where tags = '{}' and auto_tagged_at is null)::int as pending_tagging,
                count(embedding)::int as embedded
         from bookmarks`,
      ),
      pool.query(
        `select b.id::text as id, b.text, b.saved_at, b.bookmarked, b.liked, lc.title as link_title
         from bookmarks b
         left join link_content lc on lc.bookmark_id = b.id
         order by b.saved_at desc limit 5`,
      ),
      pool.query("select last_run_at from sync_state where id = 1"),
      // last sync = burst of requests around the most recent one (syncs are
      // hours apart, so a 15-minute window captures a single run); tolerate
      // the table not existing yet (poller migration pending)
      pool
        .query(
          `select
             coalesce(sum(posts_read) filter (where ts >= (select max(ts) from x_api_usage) - interval '15 minutes'), 0)::int as last_posts,
             coalesce(sum(posts_read) filter (where ts >= date_trunc('month', now())), 0)::int as month_posts
           from x_api_usage`,
        )
        .catch(() => null),
      getSetting("X_COST_PER_1K_POSTS"),
    ]);
    return NextResponse.json({
      ...stats.rows[0],
      last_run_at: sync.rows[0]?.last_run_at ?? null,
      last_sync_posts: usage?.rows[0]?.last_posts ?? null,
      month_posts: usage?.rows[0]?.month_posts ?? null,
      cost_per_1k: parseFloat(costPer1k) > 0 ? parseFloat(costPer1k) : null,
      recent: recent.rows.map((r) => ({
        id: r.id,
        title: (r.link_title ?? r.text ?? "").replace(/https?:\/\/\S+/g, "").trim().slice(0, 70),
        saved_at: r.saved_at,
        liked: r.liked,
        bookmarked: r.bookmarked,
      })),
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
