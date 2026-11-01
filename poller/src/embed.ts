import { env } from "./env.js";

// Calls an OpenAI-compatible /v1/embeddings endpoint (LM Studio, Ollama, …).
// Returns null on any failure — embedding must never block ingestion; the
// next sync run backfills rows where embedding is null.
export async function embed(text: string): Promise<number[] | null> {
  if (!env.embeddingApiUrl) return null;
  try {
    const res = await fetch(env.embeddingApiUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(env.embeddingApiKey ? { authorization: `Bearer ${env.embeddingApiKey}` } : {}),
      },
      body: JSON.stringify({ model: env.embeddingModel, input: text.slice(0, 8000) }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      console.warn(`embed: endpoint returned ${res.status}`);
      return null;
    }
    const json = (await res.json()) as { data?: Array<{ embedding?: number[] }> };
    const vec = json.data?.[0]?.embedding;
    if (!Array.isArray(vec)) {
      console.warn("embed: malformed response");
      return null;
    }
    if (vec.length !== env.embeddingDim) {
      console.warn(`embed: got ${vec.length} dims, expected ${env.embeddingDim} — check EMBEDDING_DIM/model`);
      return null;
    }
    return vec;
  } catch (err) {
    console.warn(`embed: ${(err as Error).message}`);
    return null;
  }
}

// What we embed: post text + quoted text + media alt text, for richer recall.
export function embeddingInput(text: string, referenced: any, altTexts: string[] = []): string {
  const parts = [text];
  if (Array.isArray(referenced)) {
    for (const ref of referenced) {
      if (ref?.text) parts.push(`[${ref.type ?? "referenced"}] ${ref.text}`);
    }
  }
  for (const alt of altTexts) if (alt) parts.push(`[image] ${alt}`);
  return parts.join("\n\n");
}
