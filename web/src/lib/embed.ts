import { getSetting } from "./settings";

// Embed a search query via the OpenAI-compatible endpoint (app_settings,
// falling back to env). Returns null on any failure so search can fall back
// to keyword-only.
export async function embedQuery(text: string): Promise<number[] | null> {
  const url = await getSetting("EMBEDDING_API_URL");
  if (!url) return null;
  try {
    const key = await getSetting("EMBEDDING_API_KEY");
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(key ? { authorization: `Bearer ${key}` } : {}),
      },
      body: JSON.stringify({ model: (await getSetting("EMBEDDING_MODEL")) || "nomic-embed-text", input: text }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { data?: Array<{ embedding?: number[] }> };
    const vec = json.data?.[0]?.embedding;
    return Array.isArray(vec) ? vec : null;
  } catch {
    return null;
  }
}
