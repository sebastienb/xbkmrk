// Config resolution: app_settings DB row (set via the web /settings page)
// → container env var → default. settings.ts loads the DB overrides at boot
// and on settings_changed; until then everything falls back to the env.
// Infra config (DATABASE_URL, MEDIA_DIR) is env-only — needed before the DB.
const overrides = new Map<string, string>();

export function applySettingOverrides(values: Map<string, string>): void {
  overrides.clear();
  for (const [k, v] of values) overrides.set(k, v);
}

// A key present in app_settings wins even when empty (clearing a field in
// the UI must be able to disable a feature the env still configures).
function setting(name: string, fallback = ""): string {
  if (overrides.has(name)) return overrides.get(name)!;
  return process.env[name] ?? fallback;
}

// Generic read for code that works over setting keys (e.g. the external
// sources fingerprint) — same resolution order as the typed getters below.
export function settingValue(name: string): string {
  return setting(name);
}

function required(name: string): string {
  const v = setting(name);
  if (!v) throw new Error(`Missing required setting: ${name} (env or app_settings)`);
  return v;
}

function requiredEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export const env = {
  get databaseUrl() { return requiredEnv("DATABASE_URL"); },
  get xClientId() { return required("X_CLIENT_ID"); },
  get xClientSecret() { return setting("X_CLIENT_SECRET"); },
  // numeric or ignored — guards against stray values (e.g. inline comments)
  get xUserId() {
    const v = setting("X_USER_ID").trim();
    return /^\d+$/.test(v) ? v : "";
  },
  get xRedirectUri() { return setting("X_REDIRECT_URI", "http://localhost:3022/callback"); },
  // app-only Bearer Token (dev portal "Keys and tokens") — unlocks the official usage endpoint
  get xBearerToken() { return setting("X_BEARER_TOKEN").trim(); },
  // $ per 1,000 posts read (from the X dev console pricing); 0/blank = don't estimate
  get xCostPer1kPosts() {
    const v = parseFloat(setting("X_COST_PER_1K_POSTS"));
    return Number.isFinite(v) && v > 0 ? v : 0;
  },
  get embeddingApiUrl() { return setting("EMBEDDING_API_URL"); },
  get embeddingApiKey() { return setting("EMBEDDING_API_KEY"); },
  get embeddingModel() { return setting("EMBEDDING_MODEL", "nomic-embed-text"); },
  get embeddingDim() { return parseInt(setting("EMBEDDING_DIM", "768"), 10); },
  // empty string = no scheduled sync (on-access / manual only)
  get syncCron() { return setting("SYNC_CRON", "0 */4 * * *").trim(); },
  // sync when the app is opened and the last run is older than this; <= 0 disables
  get syncOnAccessHours() { return parseInt(setting("SYNC_ON_ACCESS_HOURS", "6"), 10); },
  // Friday 12:30 in `tz` — the edition is ready well before the after-work
  // Friday read
  get digestCron() { return setting("DIGEST_CRON", "30 12 * * 5"); },
  get tz() { return setting("TZ", "America/New_York"); },
  get githubToken() { return setting("GITHUB_TOKEN"); },
  // optional Reddit script-app creds (reddit.com/prefs/apps) — unlock post +
  // top-comments enrichment for reddit links
  get redditClientId() { return setting("REDDIT_CLIENT_ID").trim(); },
  get redditClientSecret() { return setting("REDDIT_CLIENT_SECRET").trim(); },
  // newline/comma-separated playlist urls or bare ids (public or unlisted)
  get youtubePlaylists() { return setting("YOUTUBE_PLAYLISTS"); },
  // optional Data API key — unlocks true added-to-playlist dates + full pagination
  get youtubeApiKey() { return setting("YOUTUBE_API_KEY").trim(); },
  // fetch + store video subtitles/transcripts (default on)
  get youtubeTranscripts() { return setting("YOUTUBE_TRANSCRIPTS", "true") !== "false"; },
  get taggingModel() { return setting("TAGGING_MODEL"); },
  get syncLikes() { return setting("SYNC_LIKES", "true") !== "false"; },
  get likesMaxAgeDays() { return parseInt(setting("LIKES_MAX_AGE_DAYS", "60"), 10); },
  // chat-LLM backend for tagging + digest copy: local LM Studio model, or the
  // Codex CLI (ChatGPT plan; needs ~/.codex mounted — see docker-compose)
  get llmProvider() { return setting("LLM_PROVIDER", "lmstudio") as "lmstudio" | "codex"; },
  get codexModel() { return setting("CODEX_MODEL"); },
  get codexSandbox() { return setting("CODEX_SANDBOX", "read-only"); },
  get mediaDir() { return process.env.MEDIA_DIR || "/app/data/media"; },
};
