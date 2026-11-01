import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const dynamic = "force-dynamic";

// The bookmarklet's shared secret. Created on first request; not editable via
// the settings form (kept out of ALLOWED_KEYS so a form save can't clear it).
export async function GET() {
  try {
    const existing = await pool.query("select value from app_settings where key = 'SAVE_TOKEN'");
    if (existing.rows[0]?.value) return NextResponse.json({ token: existing.rows[0].value });

    const token = randomBytes(16).toString("hex");
    // on conflict: another request raced us — keep whichever landed first
    await pool.query(
      "insert into app_settings (key, value) values ('SAVE_TOKEN', $1) on conflict (key) do nothing",
      [token],
    );
    const { rows } = await pool.query("select value from app_settings where key = 'SAVE_TOKEN'");
    return NextResponse.json({ token: rows[0].value });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
