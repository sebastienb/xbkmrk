import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const dynamic = "force-dynamic";

// Asks the poller to sync immediately (it LISTENs on this Postgres channel).
export async function POST() {
  try {
    await pool.query("notify sync_request");
    return NextResponse.json({ requested: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
