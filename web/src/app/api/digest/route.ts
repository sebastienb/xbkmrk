import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const dynamic = "force-dynamic";

// Press status: is a generation running (and how far along), latest issue id.
export async function GET() {
  try {
    const [state, latest] = await Promise.all([
      pool.query("select running, note, started_at from digest_state where id = 1"),
      pool.query("select id from digests order by id desc limit 1"),
    ]);
    return NextResponse.json({
      running: state.rows[0]?.running ?? false,
      note: state.rows[0]?.note ?? null,
      startedAt: state.rows[0]?.started_at ?? null,
      latestIssueId: latest.rows[0]?.id ?? null,
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

// Asks the poller to generate a digest edition now (it LISTENs on this channel).
export async function POST() {
  try {
    await pool.query("notify digest_request");
    return NextResponse.json({ requested: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
