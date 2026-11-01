import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const dynamic = "force-dynamic";

// The MCP server's bearer token — minted on first request, shown on the
// /connect page. Behind the site session (middleware), so only a signed-in
// visitor can read it; the MCP server itself reads the table directly.
export async function GET() {
  try {
    const existing = await pool.query("select token from mcp_auth where id = 1");
    if (existing.rows[0]?.token) return NextResponse.json({ token: existing.rows[0].token });

    const token = randomBytes(24).toString("hex");
    // on conflict: another request raced us — keep whichever landed first
    await pool.query("insert into mcp_auth (id, token) values (1, $1) on conflict (id) do nothing", [token]);
    const { rows } = await pool.query("select token from mcp_auth where id = 1");
    return NextResponse.json({ token: rows[0].token });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
