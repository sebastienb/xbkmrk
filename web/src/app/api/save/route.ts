import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const dynamic = "force-dynamic";

// Two ways in, one save path:
//  - GET  — bookmarklet target: opened as a small popup, responds with a tiny
//    self-closing HTML page (top-level navigation, so no CORS issues).
//  - POST — iOS Shortcut (or any API client): JSON {url, title?, text?},
//    token via ?token=, Authorization: Bearer, or the body. JSON responses.
// Either way the poller's enrichment pipeline fetches the actual page content
// afterwards — this route only records the intent.

function page(title: string, detail: string, autoClose: boolean): Response {
  return new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<body style="margin:0;display:grid;place-items:center;min-height:100vh;font-family:system-ui,sans-serif;background:#111;color:#eee">
<div style="text-align:center;padding:1.5rem;max-width:22rem">
  <div style="font-size:1.6rem;margin-bottom:.4rem">${title}</div>
  <div style="font-size:.85rem;opacity:.7;overflow-wrap:anywhere">${detail}</div>
</div>
${autoClose ? "<script>setTimeout(()=>window.close(),1300)</script>" : ""}`,
    { headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function tokenMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function tokenValid(provided: string): Promise<boolean> {
  if (!provided) return false;
  const { rows } = await pool.query("select value from app_settings where key = 'SAVE_TOKEN'");
  return Boolean(rows[0]?.value) && tokenMatches(provided, rows[0].value);
}

type SaveResult =
  | { outcome: "saved"; label: string }
  | { outcome: "already_saved"; label: string }
  | { outcome: "invalid_url" };

async function saveUrl(url: string, title: string, sel: string, via: string): Promise<SaveResult> {
  let parsed: URL;
  try {
    parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("bad scheme");
  } catch {
    return { outcome: "invalid_url" };
  }

  const dupe = await pool.query(
    `select id::text as id, read_at from bookmarks where source = 'web' and urls->0->>'expanded_url' = $1`,
    [parsed.href],
  );
  if (dupe.rows[0]) {
    // re-saving an archived page surfaces it back in Saves
    if (dupe.rows[0].read_at) await pool.query("update bookmarks set read_at = null where id = $1", [dupe.rows[0].id]);
    return { outcome: "already_saved", label: title || parsed.hostname };
  }

  const display = (parsed.hostname.replace(/^www\./, "") + parsed.pathname).replace(/\/$/, "").slice(0, 60);
  const text = [title || parsed.href, sel].filter(Boolean).join("\n\n");
  await pool.query(
    `insert into bookmarks (id, source, author_id, text, is_long, created_at, urls, bookmarked, liked, raw)
     values (nextval('web_save_id'), 'web', null, $1, false, now(), $2::jsonb, true, false, $3::jsonb)`,
    [
      text,
      JSON.stringify([{ expanded_url: parsed.href, display_url: display }]),
      JSON.stringify({ saved_via: via, url: parsed.href, title, selection: sel || null }),
    ],
  );
  // wake the poller's local pipeline: content fetch, embedding, auto-tags.
  // No X API involved.
  await pool.query("notify enrich_request");
  return { outcome: "saved", label: title || parsed.hostname };
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const token = q.get("token") ?? "";
  const url = q.get("url") ?? "";
  const title = (q.get("title") ?? "").slice(0, 500).trim();
  const sel = (q.get("sel") ?? "").slice(0, 2000).trim();

  try {
    if (!(await tokenValid(token))) {
      return page("Not authorized", "Re-create the bookmarklet from the archive's Settings page.", false);
    }
    const result = await saveUrl(url, title, sel, "bookmarklet");
    if (result.outcome === "invalid_url") {
      return page("Nothing to save", "This page has no saveable web address.", false);
    }
    return page(result.outcome === "saved" ? "Saved ✓" : "Already saved ✓", esc(result.label), true);
  } catch (err) {
    console.error("save failed:", err);
    return page("Save failed", esc((err as Error).message), false);
  }
}

// JSON body: { url, title?, text? } — `text` (or `sel`) becomes the saved
// note/selection, same as the bookmarklet's captured selection.
export async function POST(req: NextRequest) {
  try {
    let body: Record<string, unknown> = {};
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      /* empty or non-JSON body — fall through to validation errors below */
    }

    const token =
      req.nextUrl.searchParams.get("token") ??
      req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
      (typeof body.token === "string" ? body.token : "");
    if (!(await tokenValid(token))) {
      return NextResponse.json({ error: "invalid token — copy the save URL from Settings again" }, { status: 401 });
    }

    const url = typeof body.url === "string" ? body.url.trim() : "";
    const title = typeof body.title === "string" ? body.title.slice(0, 500).trim() : "";
    const sel = typeof (body.text ?? body.sel) === "string" ? ((body.text ?? body.sel) as string).slice(0, 2000).trim() : "";

    const result = await saveUrl(url, title, sel, "ios-shortcut");
    if (result.outcome === "invalid_url") {
      return NextResponse.json({ error: "missing or invalid url" }, { status: 400 });
    }
    return NextResponse.json({ ok: true, status: result.outcome, title: result.label });
  } catch (err) {
    console.error("save failed:", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
