// What the /settings page can edit. Keys are env-var names; values live in
// app_settings and override the container env (the poller seeds the table
// from .env on first boot). Infra config — DB password, ports, MEDIA_DIR —
// intentionally absent: it must exist before the DB is reachable.

export interface SettingDef {
  key: string;
  label: string;
  type: "text" | "textarea" | "password" | "number" | "boolean" | "select";
  options?: Array<{ value: string; label: string }>;
  hint?: string;
  // external help link rendered after the hint (e.g. "where do I get this key")
  link?: { href: string; label: string };
  placeholder?: string;
}

export interface SettingGroup {
  title: string;
  blurb?: string;
  defs: SettingDef[];
}

export const SETTING_GROUPS: SettingGroup[] = [
  {
    title: "X API",
    blurb: "Credentials of your X developer app. After changing the client, re-run the OAuth flow (npm run auth in the poller).",
    defs: [
      { key: "X_CLIENT_ID", label: "Client ID", type: "text" },
      { key: "X_CLIENT_SECRET", label: "Client secret", type: "password", hint: "Optional — only for confidential X apps." },
      { key: "X_REDIRECT_URI", label: "OAuth redirect URI", type: "text", placeholder: "http://localhost:3022/callback" },
      { key: "X_USER_ID", label: "X user id", type: "text", hint: "Numeric id; leave blank to auto-resolve from the token." },
      {
        key: "X_BEARER_TOKEN",
        label: "App bearer token",
        type: "password",
        hint: "Optional — the app-only Bearer Token from your X app's \"Keys and tokens\" page (not the OAuth client secret). Lets the usage meter show X's official post consumption and remaining balance for the whole project, on the real billing cycle. Updates as soon as you save.",
        link: { href: "https://developer.x.com/en/portal/projects-and-apps", label: "X developer portal → your app → Keys and tokens ↗" },
      },
      { key: "X_MONTHLY_POST_CAP", label: "Monthly post budget", type: "number", hint: "Posts read per month you want to stay under — fills the usage meter above. Unnecessary with an app bearer token (X's own cap is used); blank hides the bar." },
      { key: "X_COST_PER_1K_POSTS", label: "Cost per 1,000 posts read ($)", type: "number", hint: "From your X developer console pricing. Used to estimate spend per sync; blank hides cost estimates." },
    ],
  },
  {
    title: "Sync",
    defs: [
      { key: "SYNC_CRON", label: "Sync schedule (cron)", type: "text", placeholder: "0 */4 * * *", hint: "Five-field cron in the timezone below. Leave blank to disable scheduled polling and rely on sync-on-open (saves X API credits)." },
      { key: "SYNC_ON_ACCESS_HOURS", label: "Sync on app open (hours)", type: "number", hint: "Opening the app triggers a sync if the last one is older than this many hours. 0 disables." },
      { key: "SYNC_LIKES", label: "Also sync liked posts", type: "boolean" },
      { key: "LIKES_MAX_AGE_DAYS", label: "Likes max age (days)", type: "number", hint: "Likes older than this are never backfilled." },
      { key: "GITHUB_TOKEN", label: "GitHub token", type: "password", hint: "Optional — raises rate limits for README enrichment." },
      {
        key: "REDDIT_CLIENT_ID",
        label: "Reddit client ID",
        type: "text",
        hint: "Optional — with an ID + secret, saved reddit links get the post body, image/video, and top comments (reddit blocks anonymous scraping). Create a free app of type \"script\"; the ID is the short string under the app name.",
        link: { href: "https://www.reddit.com/prefs/apps", label: "Create a Reddit app ↗" },
      },
      { key: "REDDIT_CLIENT_SECRET", label: "Reddit client secret", type: "password" },
    ],
  },
  {
    title: "Sources",
    blurb: "Extra places to pull saves from, alongside X and the bookmarklet. Checked on every sync (scheduled, on app open, or Sync now) — and right after you save changes here.",
    defs: [
      {
        key: "YOUTUBE_PLAYLISTS",
        label: "YouTube playlists",
        type: "textarea",
        placeholder: "https://www.youtube.com/playlist?list=PL…",
        hint: "One playlist URL (or bare playlist id) per line. The playlist must be public or unlisted — private ones aren't reachable. Every video becomes a bookmark; new videos are picked up automatically. No YouTube API key needed.",
      },
      {
        key: "YOUTUBE_API_KEY",
        label: "YouTube API key",
        type: "password",
        hint: "Optional — playlists work without it. With a key, videos are dated by when you added them to the playlist (instead of when they were imported), and playlists longer than ~100 videos import fully. Already-imported videos are re-dated on the next sync. To get a free key: enable the YouTube Data API v3 in Google Cloud Console, then create an API key under Credentials.",
        link: { href: "https://console.cloud.google.com/apis/library/youtube.googleapis.com", label: "Get a key (Google Cloud Console) ↗" },
      },
      {
        key: "YOUTUBE_TRANSCRIPTS",
        label: "Video transcripts",
        type: "boolean",
        hint: "Fetch each video's subtitles (manual or auto-generated) and store them with the bookmark — searchable, shown under the player in the reading view, and readable in full by AI agents over MCP. Applies to new videos and backfills already-imported ones; turning it off stops new fetches (stored transcripts stay).",
      },
    ],
  },
  {
    title: "Weekly digest",
    defs: [
      { key: "DIGEST_CRON", label: "Edition schedule (cron)", type: "text", placeholder: "30 12 * * 5", hint: "Default 30 12 * * 5 = Fridays 12:30, ready for the after-work read." },
      { key: "TZ", label: "Timezone", type: "text", placeholder: "America/New_York", hint: "IANA name; applies to both cron schedules." },
    ],
  },
];

// AI keys are rendered by the dedicated AiSettings component (provider cards
// + embeddings section), not via SETTING_GROUPS — but they share the same
// store and whitelist.
export const AI_KEYS = [
  "LLM_PROVIDER", "TAGGING_MODEL", "CODEX_MODEL", "CODEX_SANDBOX",
  "EMBEDDING_API_URL", "EMBEDDING_API_KEY", "EMBEDDING_MODEL", "EMBEDDING_DIM",
];

export const ALLOWED_KEYS = new Set([...SETTING_GROUPS.flatMap((g) => g.defs.map((d) => d.key)), ...AI_KEYS]);
