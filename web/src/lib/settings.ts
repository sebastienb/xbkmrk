import { pool } from "./db";

// app_settings reader with a short TTL cache: web features (e.g. search
// query embedding) pick up UI edits within seconds, without a query per
// request. Falls back to the env var when a key was never stored.
let cache: Map<string, string> | null = null;
let loadedAt = 0;
const TTL_MS = 10_000;

export async function getSettingsMap(): Promise<Map<string, string>> {
  if (!cache || Date.now() - loadedAt > TTL_MS) {
    try {
      const { rows } = await pool.query("select key, value from app_settings");
      cache = new Map(rows.map((r: { key: string; value: string }) => [r.key, r.value]));
    } catch (err) {
      console.warn(`settings: ${(err as Error).message}`);
      cache = cache ?? new Map();
    }
    loadedAt = Date.now();
  }
  return cache;
}

export async function getSetting(key: string, fallback = ""): Promise<string> {
  const map = await getSettingsMap();
  if (map.has(key)) return map.get(key)!;
  return process.env[key] ?? fallback;
}

export function invalidateSettingsCache(): void {
  cache = null;
}
