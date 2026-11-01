import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const dynamic = "force-dynamic";

// Live setup status for the /welcome checklist. Session-gated by middleware.
export async function GET() {
  try {
    const [settings, counts, oauth, mcp] = await Promise.all([
      pool.query(
        `select key, value from app_settings
         where key in ('X_CLIENT_ID','EMBEDDING_API_URL','TAGGING_MODEL','LLM_PROVIDER',
                       'YOUTUBE_PLAYLISTS','REDDIT_CLIENT_ID','GITHUB_TOKEN')`,
      ),
      pool.query(
        `select count(*)::int as total,
                count(*) filter (where embedding is not null)::int as embedded
         from bookmarks`,
      ),
      pool.query("select 1 from oauth_token limit 1"),
      pool.query("select 1 from mcp_auth where id = 1"),
    ]);

    const s = new Map<string, string>(settings.rows.map((r: { key: string; value: string }) => [r.key, r.value]));
    const has = (key: string) => Boolean(s.get(key)?.trim());

    return NextResponse.json({
      bookmarks: counts.rows[0].total,
      embedded: counts.rows[0].embedded,
      embedding: has("EMBEDDING_API_URL"),
      xCreds: has("X_CLIENT_ID"),
      xAuthed: Boolean(oauth.rows[0]),
      tagging: has("TAGGING_MODEL") || s.get("LLM_PROVIDER") === "codex",
      youtube: has("YOUTUBE_PLAYLISTS"),
      reddit: has("REDDIT_CLIENT_ID"),
      github: has("GITHUB_TOKEN"),
      mcpMinted: Boolean(mcp.rows[0]),
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
