// DB-backed app settings: seeding (one-time migration of .env values into
// app_settings) and loading overrides into env.ts. The web /settings page
// writes the same table and NOTIFYs settings_changed.
import { pool } from "./db.js";
import { applySettingOverrides } from "./env.js";

// Every key the web UI may manage. Anything else in app_settings is ignored.
export const SETTING_KEYS = [
  "X_CLIENT_ID", "X_CLIENT_SECRET", "X_USER_ID", "X_REDIRECT_URI",
  "X_COST_PER_1K_POSTS", "X_MONTHLY_POST_CAP", "X_BEARER_TOKEN",
  "EMBEDDING_API_URL", "EMBEDDING_API_KEY", "EMBEDDING_MODEL", "EMBEDDING_DIM",
  "SYNC_CRON", "SYNC_ON_ACCESS_HOURS", "SYNC_LIKES", "LIKES_MAX_AGE_DAYS", "GITHUB_TOKEN",
  "REDDIT_CLIENT_ID", "REDDIT_CLIENT_SECRET",
  "YOUTUBE_PLAYLISTS", "YOUTUBE_API_KEY", "YOUTUBE_TRANSCRIPTS",
  "TAGGING_MODEL", "LLM_PROVIDER", "CODEX_MODEL", "CODEX_SANDBOX",
  "DIGEST_CRON", "TZ",
] as const;

// Copy env values for keys not yet in app_settings (first boot after the
// migration; also picks up keys added in later releases). Existing rows are
// never touched — once in the DB, the UI owns the value.
export async function seedSettingsFromEnv(): Promise<void> {
  let seeded = 0;
  for (const key of SETTING_KEYS) {
    const value = process.env[key];
    if (value === undefined) continue;
    const res = await pool.query(
      "insert into app_settings (key, value) values ($1, $2) on conflict (key) do nothing",
      [key, value],
    );
    seeded += res.rowCount ?? 0;
  }
  if (seeded > 0) console.log(`settings: seeded ${seeded} keys from env into app_settings`);
}

export async function loadSettings(): Promise<void> {
  const { rows } = await pool.query("select key, value from app_settings where key = any($1)", [
    SETTING_KEYS as unknown as string[],
  ]);
  applySettingOverrides(new Map(rows.map((r: { key: string; value: string }) => [r.key, r.value])));
}

// Boot-time init. Tolerates a missing table (poller started before the
// migration ran) — everything just falls back to env values.
export async function initSettings(): Promise<void> {
  try {
    await seedSettingsFromEnv();
    await loadSettings();
  } catch (err) {
    console.warn(`settings: init failed (falling back to env): ${(err as Error).message}`);
  }
}
