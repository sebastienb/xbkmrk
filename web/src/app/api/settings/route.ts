import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getSettingsMap, invalidateSettingsCache } from "@/lib/settings";
import { ALLOWED_KEYS } from "@/lib/settings-schema";

export const dynamic = "force-dynamic";

// Current value per key: app_settings row if present, else the container env
// (matches the poller's resolution order).
export async function GET() {
  try {
    const stored = await getSettingsMap();
    const values: Record<string, string> = {};
    for (const key of ALLOWED_KEYS) {
      values[key] = stored.has(key) ? stored.get(key)! : (process.env[key] ?? "");
    }
    return NextResponse.json({ values });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

// Upsert the submitted keys, then tell the poller to reload + re-schedule.
export async function PUT(req: Request) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const entries = Object.entries(body).filter(
      (e): e is [string, string] => ALLOWED_KEYS.has(e[0]) && typeof e[1] === "string",
    );
    if (entries.length === 0) {
      return NextResponse.json({ error: "no valid settings in body" }, { status: 400 });
    }
    const client = await pool.connect();
    try {
      await client.query("begin");
      for (const [key, value] of entries) {
        await client.query(
          `insert into app_settings (key, value) values ($1, $2)
           on conflict (key) do update set value = excluded.value, updated_at = now()`,
          [key, value],
        );
      }
      await client.query("commit");
    } catch (err) {
      await client.query("rollback");
      throw err;
    } finally {
      client.release();
    }
    invalidateSettingsCache();
    await pool.query("notify settings_changed");
    return NextResponse.json({ saved: entries.length });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
