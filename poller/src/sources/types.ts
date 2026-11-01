// Pluggable external data sources (YouTube playlists today; RSS feeds,
// podcasts, … tomorrow). A source turns some remote collection into
// ExternalItems; the shared ingest (./ingest.ts) turns those into bookmark
// rows exactly like bookmarklet saves — same id sequence, same downstream
// enrichment (embedding at insert, auto-tags via runBackfills).
//
// Adding a new source:
//   1. create sources/<name>.ts exporting an ExternalSource
//   2. register it in SOURCES (sources/index.ts)
//   3. add its setting key(s) to SETTING_KEYS (settings.ts) and the web
//      Sources group (web/src/lib/settings-schema.ts)
//   4. teach the web UI about the new bookmarks.source value if it should
//      get its own badge/filter (types.ts, Reader.tsx, BookmarkCard.tsx)

export interface ExternalItem {
  url: string; // canonical link — also the per-source dedup key (urls[0])
  title: string;
  description?: string | null;
  siteName?: string | null; // byline shown on cards (channel / feed / site)
  publishedAt?: string | null; // ISO timestamp; falls back to ingest time
  savedAt?: string | null; // when the user saved it remotely (e.g. added to a playlist); falls back to ingest time — drives feed ordering
  thumbnailUrl?: string | null; // stored like an og image → card thumbnail
  kind?: string; // link_content.kind (default "other"; youtube uses "video")
  // full text content (video transcript, article body, …) — stored in
  // link_content.content, folded into the embedding, keyword-searchable,
  // rendered in the reading view, and served over MCP
  content?: string | null;
  raw?: unknown; // source-specific provenance, kept in bookmarks.raw
}

export interface ExternalSource {
  id: string; // bookmarks.source value, e.g. "youtube"
  label: string;
  // Settings that configure this source — the poller re-checks the source
  // when any of them change via the web /settings page.
  settingKeys: readonly string[];
  enabled(): boolean;
  // Return items currently in the remote collection. `known` holds the urls
  // already archived for this source so implementations can skip metadata
  // fetches (and return only new items — ingest re-checks anyway).
  collect(known: ReadonlySet<string>): Promise<ExternalItem[]>;
  // Optional slow-lane pass over ALREADY-archived items (e.g. fetch
  // transcripts for videos ingested before the feature existed, or retry
  // ones that failed). Runs with the other backfills after every sync.
  // Returns how many items it completed.
  backfill?(limit: number): Promise<number>;
}
