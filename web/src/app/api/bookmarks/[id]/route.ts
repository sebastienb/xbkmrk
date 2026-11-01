import { NextRequest, NextResponse } from "next/server";
import { getBookmarkDetail, updateBookmark } from "@/lib/queries";
import { pool } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  try {
    const bookmark = await getBookmarkDetail(id);
    if (!bookmark) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(bookmark);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  try {
    // tombstone first so a half-failed delete can't lead to an X-sync
    // re-import; media/link_content rows go with the bookmark (FK cascade)
    await pool.query("insert into deleted_bookmarks (id) values ($1) on conflict (id) do nothing", [id]);
    const res = await pool.query("delete from bookmarks where id = $1 returning id", [id]);
    if (!res.rows[0]) return NextResponse.json({ error: "not found" }, { status: 404 });
    // media files live behind a read-only mount here — the poller owns disk cleanup
    await pool.query("select pg_notify('media_cleanup', $1::text)", [id]);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  try {
    const patch = await req.json();
    const updated = await updateBookmark(id, patch);
    if (!updated) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(updated);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
