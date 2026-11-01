// Registry + runner for external sources. Runs at the start of every sync
// (scheduled, on-access, or "Sync now") and again whenever a source's
// settings change — all local HTTP, no X API credits involved.
import { settingValue } from "../env.js";
import { ingestExternalItem, knownUrls } from "./ingest.js";
import { youtubeSource } from "./youtube.js";
import type { ExternalSource } from "./types.js";

export const SOURCES: ExternalSource[] = [youtubeSource];

// Serialized source config — index.ts compares this across settings reloads
// to re-check sources as soon as e.g. a new playlist is added in the UI.
export function sourcesFingerprint(): string {
  return SOURCES.flatMap((s) => s.settingKeys)
    .map((key) => `${key}=${settingValue(key)}`)
    .join("\n");
}

// Slow-lane passes over already-archived items (transcript fetches, retries).
// Piggybacks on runBackfills so every sync / enrich request advances it.
export async function backfillSources(limit = 25): Promise<void> {
  for (const source of SOURCES) {
    if (!source.enabled() || !source.backfill) continue;
    try {
      const n = await source.backfill(limit);
      if (n > 0) console.log(`${source.label}: backfilled ${n} item(s)`);
    } catch (err) {
      console.error(`${source.label} backfill failed: ${(err as Error).message}`);
    }
  }
}

export async function syncExternalSources(): Promise<number> {
  let added = 0;
  for (const source of SOURCES) {
    if (!source.enabled()) continue;
    try {
      const known = await knownUrls(source.id);
      const items = await source.collect(known);
      let fresh = 0;
      for (const item of items) {
        if (await ingestExternalItem(source, item)) fresh++;
      }
      console.log(`${source.label}: ${fresh} new item(s)`);
      added += fresh;
    } catch (err) {
      console.error(`${source.label} sync failed: ${(err as Error).message}`);
    }
  }
  return added;
}
