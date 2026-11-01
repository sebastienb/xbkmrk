import { NextResponse } from "next/server";
import { getSetting, invalidateSettingsCache } from "@/lib/settings";

export const dynamic = "force-dynamic";

// Round-trip one embedding with the SAVED settings and report what came back.
export async function POST() {
  invalidateSettingsCache(); // always test what's actually stored right now
  const url = await getSetting("EMBEDDING_API_URL");
  if (!url) return NextResponse.json({ ok: false, error: "no endpoint configured" });
  try {
    const key = await getSetting("EMBEDDING_API_KEY");
    const model = (await getSetting("EMBEDDING_MODEL")) || "nomic-embed-text";
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(key ? { authorization: `Bearer ${key}` } : {}),
      },
      body: JSON.stringify({ model, input: "connection test" }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return NextResponse.json({ ok: false, error: `endpoint returned ${res.status}` });
    const json = (await res.json()) as { data?: Array<{ embedding?: number[] }> };
    const vec = json.data?.[0]?.embedding;
    if (!Array.isArray(vec)) return NextResponse.json({ ok: false, error: "malformed response (no embedding)" });
    const expected = parseInt(await getSetting("EMBEDDING_DIM", "768"), 10);
    return NextResponse.json({ ok: true, dims: vec.length, expected });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message });
  }
}
