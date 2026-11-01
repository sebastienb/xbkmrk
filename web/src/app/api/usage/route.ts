import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getSetting } from "@/lib/settings";

export const dynamic = "force-dynamic";

// X API usage, aggregated from x_api_usage (one row per poller request).
// "Last sync" = the burst of requests around the most recent one — syncs are
// hours apart, so a 15-minute window cleanly captures a single run.
export async function GET() {
  try {
    const [agg, snapshot, costPer1k, cap] = await Promise.all([
      pool.query(
        `select
           coalesce(sum(posts_read) filter (where ts >= date_trunc('month', now())), 0)::int as month_posts,
           count(*) filter (where ts >= date_trunc('month', now()))::int as month_requests,
           coalesce(sum(posts_read) filter (where ts >= (select max(ts) from x_api_usage) - interval '15 minutes'), 0)::int as last_posts,
           count(*) filter (where ts >= (select max(ts) from x_api_usage) - interval '15 minutes')::int as last_requests,
           max(ts) as last_at
         from x_api_usage`,
      ),
      pool.query("select data, fetched_at from x_usage_snapshot where id = 1").catch(() => null),
      getSetting("X_COST_PER_1K_POSTS"),
      getSetting("X_MONTHLY_POST_CAP"),
    ]);
    const row = agg.rows[0];

    // X's own project numbers (fetched by the poller with the app bearer token)
    let official = null;
    const snap = snapshot?.rows[0];
    if (snap) {
      const capN = parseInt(snap.data?.project_cap, 10);
      const usageN = parseInt(snap.data?.project_usage, 10);
      if (capN > 0 && usageN >= 0) {
        official = {
          project_cap: capN,
          project_usage: usageN,
          cap_reset_day: parseInt(snap.data?.cap_reset_day, 10) || null,
          fetched_at: snap.fetched_at,
        };
      }
    }

    return NextResponse.json({
      ...row,
      official,
      cost_per_1k: parseFloat(costPer1k) > 0 ? parseFloat(costPer1k) : null,
      monthly_cap: parseInt(cap, 10) > 0 ? parseInt(cap, 10) : null,
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
