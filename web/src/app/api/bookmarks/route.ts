import { NextRequest, NextResponse } from "next/server";
import { listBookmarks } from "@/lib/queries";
import { parseSavedDateRange, type SavedDateRange } from "@/lib/saved-dates";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const unreadParam = sp.get("unread");
  let dates: SavedDateRange;
  try { dates = parseSavedDateRange(sp); }
  catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
  try {
    const result = await listBookmarks({
      ...dates,
      author: sp.get("author") || undefined,
      tag: sp.get("tag") || undefined,
      source: (sp.get("source") as "bookmarks" | "likes" | "web" | "youtube") || undefined,
      content: (sp.get("content") as "video" | "photo" | "article" | "github" | "link" | "text") || undefined,
      unread: unreadParam === null ? undefined : unreadParam === "true",
      cursor: sp.get("cursor") || undefined,
      q: sp.get("q") || undefined,
      mode: (sp.get("mode") as "keyword" | "semantic" | "hybrid") || undefined,
      limit: sp.get("limit") ? parseInt(sp.get("limit")!, 10) : undefined,
    });
    return NextResponse.json({ ...result, saved_date_filter_applied: Boolean(dates.savedFrom || dates.savedBefore) });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
