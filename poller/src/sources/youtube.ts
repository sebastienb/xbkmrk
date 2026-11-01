// YouTube playlist source: every video in the configured playlists becomes a
// bookmark. Works for public AND unlisted playlists with no API key:
//   - the playlist RSS feed (youtube.com/feeds/videos.xml?playlist_id=…)
//     carries full metadata (title, channel, description, publish date,
//     thumbnail) but only ~15 entries — and 404s for UNLISTED playlists,
//     so it's strictly best-effort
//   - the playlist page HTML lists up to 100 video ids (ytInitialData) —
//     the full list for long playlists, and the ONLY listing for unlisted
//     ones; scrape breakage degrades gracefully to feed-only (and so an
//     unlisted playlist needs the scrape to work)
//   - oEmbed fills in metadata for ids the feed didn't cover
// With an OPTIONAL YouTube Data API key (YOUTUBE_API_KEY), the official
// playlistItems endpoint replaces all of the above: full pagination (no ~100
// scrape cap), reliable metadata, and — uniquely — the date each video was
// ADDED to the playlist (snippet.publishedAt), which becomes saved_at so
// imports land in the archive where they belong instead of piling up as
// "newest". Already-archived videos get their dates corrected on the next
// sync after a key is configured. Quota cost is trivial (1 unit per 50
// videos, 10k/day free). API errors fall back to the keyless path.
import { JSDOM } from "jsdom";
import { env } from "../env.js";
import { pool, setEmbedding } from "../db.js";
import { embed } from "../embed.js";
import { backdateExternalItem } from "./ingest.js";
import { fetchTranscript } from "./youtube-transcript.js";
import type { ExternalItem, ExternalSource } from "./types.js";

const FETCH_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const watchUrl = (videoId: string) => `https://www.youtube.com/watch?v=${videoId}`;

// Accepts full playlist/watch urls (anything with a ?list= param) or bare
// playlist ids, separated by newlines or commas.
export function parsePlaylistIds(config: string): string[] {
  const ids = new Set<string>();
  for (const entry of config.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean)) {
    let id: string | null = null;
    try {
      id = new URL(entry).searchParams.get("list");
    } catch {
      if (/^[A-Za-z0-9_-]{10,}$/.test(entry)) id = entry;
    }
    if (id) ids.add(id);
    else console.warn(`youtube: cannot parse playlist "${entry}" — expected a url with ?list= or a bare id`);
  }
  return [...ids];
}

interface FeedVideo {
  videoId: string;
  title: string;
  channel: string | null;
  description: string | null;
  published: string | null;
  thumbnail: string | null;
}

async function fetchFeed(playlistId: string): Promise<{ title: string | null; videos: FeedVideo[] }> {
  const res = await fetch(`https://www.youtube.com/feeds/videos.xml?playlist_id=${playlistId}`, {
    headers: { "user-agent": FETCH_UA },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`feed ${res.status} (playlist private or deleted?)`);
  const doc = new JSDOM(await res.text(), { contentType: "text/xml" }).window.document;

  const videos: FeedVideo[] = [];
  for (const entry of Array.from(doc.getElementsByTagName("entry"))) {
    const text = (tag: string) => entry.getElementsByTagName(tag)[0]?.textContent?.trim() || null;
    const videoId = text("yt:videoId");
    const title = text("title");
    if (!videoId || !title) continue;
    videos.push({
      videoId,
      title,
      channel: text("name"), // <author><name> is the first <name> in the entry
      description: text("media:description"),
      published: text("published"),
      thumbnail: entry.getElementsByTagName("media:thumbnail")[0]?.getAttribute("url") ?? null,
    });
  }
  return { title: doc.getElementsByTagName("title")[0]?.textContent?.trim() ?? null, videos };
}

// Best-effort scrape of the playlist page for the full (first ~100) video
// list, in playlist order. Returns no ids on failure — the feed still works.
async function fetchPage(playlistId: string): Promise<{ ids: string[]; title: string | null }> {
  try {
    const res = await fetch(`https://www.youtube.com/playlist?list=${playlistId}`, {
      headers: {
        "user-agent": FETCH_UA,
        "accept-language": "en",
        // pre-answered consent cookie — avoids the EU interstitial page
        cookie: "SOCS=CAI",
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return { ids: [], title: null };
    const html = await res.text();
    // ytInitialData's markup churns (playlistVideoRenderer → lockup view
    // models in 2026) but every listed video still appears as "videoId":"…",
    // in playlist order. A playlist page has no unrelated recommendations,
    // so collecting them all in first-appearance order is safe.
    const ids: string[] = [];
    const seen = new Set<string>();
    for (const m of html.matchAll(/"videoId":"([A-Za-z0-9_-]{11})"/g)) {
      if (!seen.has(m[1])) {
        seen.add(m[1]);
        ids.push(m[1]);
      }
    }
    const title = html.match(/<title>(.*?)(?: - YouTube)?<\/title>/)?.[1]?.trim() || null;
    return { ids, title };
  } catch {
    return { ids: [], title: null };
  }
}

// Metadata for videos the feed window missed. No date/description here —
// title, channel, and thumbnail are enough for a useful card.
async function fetchOembed(videoId: string): Promise<{ title: string; author_name?: string; thumbnail_url?: string } | null> {
  try {
    const res = await fetch(
      `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(watchUrl(videoId))}`,
      { headers: { "user-agent": FETCH_UA }, signal: AbortSignal.timeout(15_000) },
    );
    if (!res.ok) return null; // 401/404 = private or deleted video — skip
    return (await res.json()) as { title: string; author_name?: string; thumbnail_url?: string };
  } catch {
    return null;
  }
}

interface ApiVideo extends FeedVideo {
  addedAt: string | null; // snippet.publishedAt = when the video was added to the playlist
}

const API_BASE = "https://www.googleapis.com/youtube/v3";

async function apiJson(path: string, params: Record<string, string>): Promise<any> {
  const url = new URL(`${API_BASE}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("key", env.youtubeApiKey);
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) {
    // surface the API's reason (keyInvalid, quotaExceeded, playlistNotFound…) without the key
    const reason = (await res.text()).match(/"reason":\s*"([^"]+)"/)?.[1] ?? "";
    throw new Error(`${path} ${res.status}${reason ? ` (${reason})` : ""}`);
  }
  return res.json();
}

// Official API listing: full playlist (paginated past the scrape's ~100 cap)
// with per-video added-to-playlist dates. Works for public and unlisted
// playlists; private ones need OAuth, which a bare key can't do.
async function fetchApiPlaylist(playlistId: string): Promise<{ title: string | null; videos: ApiVideo[] }> {
  const meta = await apiJson("playlists", { part: "snippet", id: playlistId });
  const title = meta.items?.[0]?.snippet?.title ?? null;

  const videos: ApiVideo[] = [];
  let pageToken = "";
  do {
    const json = await apiJson("playlistItems", {
      part: "snippet,contentDetails",
      playlistId,
      maxResults: "50",
      ...(pageToken ? { pageToken } : {}),
    });
    for (const it of json.items ?? []) {
      const sn = it.snippet;
      const videoId = sn?.resourceId?.videoId;
      // private/deleted videos keep a stub entry with no owner channel — skip
      if (!videoId || !sn.videoOwnerChannelTitle) continue;
      videos.push({
        videoId,
        title: sn.title,
        channel: sn.videoOwnerChannelTitle,
        description: sn.description?.trim() || null,
        published: it.contentDetails?.videoPublishedAt ?? null,
        thumbnail: sn.thumbnails?.high?.url ?? sn.thumbnails?.default?.url ?? null,
        addedAt: sn.publishedAt ?? null,
      });
    }
    pageToken = json.nextPageToken ?? "";
  } while (pageToken);
  return { title, videos };
}

// API-key path: one listing gives new items AND authoritative dates for the
// ones already archived (fixes keyless imports that stamped everything with
// the import time).
async function collectPlaylistViaApi(playlistId: string, known: ReadonlySet<string>): Promise<ExternalItem[]> {
  const { title: playlistTitle, videos } = await fetchApiPlaylist(playlistId);

  const items: ExternalItem[] = [];
  let backdated = 0;
  for (const v of videos) {
    const url = watchUrl(v.videoId);
    if (known.has(url)) {
      if (v.addedAt && (await backdateExternalItem("youtube", url, v.addedAt, v.published))) backdated++;
      continue;
    }
    items.push({
      url,
      title: v.title,
      description: v.description,
      siteName: v.channel ?? "YouTube",
      publishedAt: v.published ?? v.addedAt,
      savedAt: v.addedAt,
      thumbnailUrl: v.thumbnail ?? `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`,
      kind: "video",
      raw: {
        source: "youtube",
        video_id: v.videoId,
        playlist_id: playlistId,
        playlist_title: playlistTitle,
        channel: v.channel,
        playlist_added_at: v.addedAt,
      },
    });
  }
  if (backdated > 0) console.log(`youtube: playlist ${playlistId} — corrected dates on ${backdated} archived video(s)`);
  return items;
}

async function collectPlaylist(playlistId: string, known: ReadonlySet<string>): Promise<ExternalItem[]> {
  if (env.youtubeApiKey) {
    try {
      return await collectPlaylistViaApi(playlistId, known);
    } catch (err) {
      console.warn(`youtube: API failed for ${playlistId} (${(err as Error).message}) — falling back to keyless path`);
    }
  }
  return collectPlaylistKeyless(playlistId, known);
}

async function collectPlaylistKeyless(playlistId: string, known: ReadonlySet<string>): Promise<ExternalItem[]> {
  // no feed for unlisted playlists (404) — carry on with the page scrape
  let feed: Awaited<ReturnType<typeof fetchFeed>> = { title: null, videos: [] };
  try {
    feed = await fetchFeed(playlistId);
  } catch (err) {
    console.warn(`youtube: no feed for ${playlistId} (${(err as Error).message}) — unlisted? using page scrape only`);
  }
  const feedById = new Map(feed.videos.map((v) => [v.videoId, v]));

  const page = await fetchPage(playlistId);
  if (page.ids.length === 0 && feed.videos.length === 0) {
    throw new Error("playlist unreachable via both feed and page — private, deleted, or a scrape break");
  }
  const playlistTitle = feed.title ?? page.title;

  // page order when the scrape worked (full list), feed order otherwise;
  // any feed entries the page missed are appended
  const orderedIds = [...page.ids];
  for (const v of feed.videos) if (!orderedIds.includes(v.videoId)) orderedIds.push(v.videoId);

  const items: ExternalItem[] = [];
  for (const videoId of orderedIds) {
    const url = watchUrl(videoId);
    if (known.has(url)) continue;

    let meta = feedById.get(videoId) ?? null;
    if (!meta) {
      const oe = await fetchOembed(videoId);
      if (!oe) {
        console.warn(`youtube: no metadata for ${videoId} (private/deleted?) — skipping`);
        continue;
      }
      meta = { videoId, title: oe.title, channel: oe.author_name ?? null, description: null, published: null, thumbnail: oe.thumbnail_url ?? null };
    }

    items.push({
      url,
      title: meta.title,
      description: meta.description,
      siteName: meta.channel ?? "YouTube",
      publishedAt: meta.published,
      thumbnailUrl: meta.thumbnail ?? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      kind: "video",
      raw: {
        source: "youtube",
        video_id: videoId,
        playlist_id: playlistId,
        playlist_title: playlistTitle,
        channel: meta.channel,
      },
    });
  }
  // reversed so the top of the playlist gets the newest saved_at — the app
  // (saved_at desc) then shows videos in the same order as the playlist page
  return items.reverse();
}

// Attach the transcript to a fresh item. Marks the attempt in raw so the
// backfill knows what's been tried: 'ok' / 'none' are final; a transient
// failure leaves no marker → retried by backfill() on a later run.
async function attachTranscript(item: ExternalItem): Promise<void> {
  const raw = item.raw as Record<string, unknown>;
  const videoId = raw?.video_id as string | undefined;
  if (!videoId) return;
  try {
    const tr = await fetchTranscript(videoId);
    if (tr) {
      item.content = tr.text;
      Object.assign(raw, { transcript: "ok", transcript_lang: tr.lang, transcript_auto: tr.auto });
    } else {
      Object.assign(raw, { transcript: "none" });
    }
  } catch (err) {
    console.warn(`youtube: transcript for ${videoId} failed (${(err as Error).message}) — will retry via backfill`);
  }
}

export const youtubeSource: ExternalSource = {
  id: "youtube",
  label: "YouTube playlists",
  settingKeys: ["YOUTUBE_PLAYLISTS", "YOUTUBE_API_KEY", "YOUTUBE_TRANSCRIPTS"],
  enabled: () => parsePlaylistIds(env.youtubePlaylists).length > 0,

  async collect(known) {
    const items: ExternalItem[] = [];
    for (const playlistId of parsePlaylistIds(env.youtubePlaylists)) {
      try {
        const found = await collectPlaylist(playlistId, known);
        if (found.length > 0) console.log(`youtube: playlist ${playlistId} — ${found.length} new video(s)`);
        items.push(...found);
      } catch (err) {
        console.error(`youtube: playlist ${playlistId} failed: ${(err as Error).message}`);
      }
    }
    if (env.youtubeTranscripts && items.length > 0) {
      for (const item of items) await attachTranscript(item);
      console.log(`youtube: transcripts for ${items.filter((i) => i.content).length}/${items.length} new video(s)`);
    }
    return items;
  },

  // Transcripts for videos archived before the feature existed (or whose
  // fetch failed transiently): raw->>'transcript' is the attempt marker.
  async backfill(limit) {
    if (!env.youtubeTranscripts) return 0;
    const { rows } = await pool.query(
      `select b.id::text as id, b.text, b.raw->>'video_id' as video_id
       from bookmarks b
       join link_content lc on lc.bookmark_id = b.id
       where b.source = 'youtube' and lc.content is null and b.raw->>'transcript' is null
       order by b.saved_at desc
       limit $1`,
      [limit],
    );
    let done = 0;
    for (const row of rows) {
      if (!row.video_id) continue;
      try {
        const tr = await fetchTranscript(row.video_id);
        if (tr) {
          await pool.query(
            `update link_content set content = $2, status = 'ok', fetched_at = now() where bookmark_id = $1`,
            [row.id, tr.text],
          );
          await pool.query(`update bookmarks set raw = raw || $2::jsonb where id = $1`, [
            row.id,
            JSON.stringify({ transcript: "ok", transcript_lang: tr.lang, transcript_auto: tr.auto }),
          ]);
          // re-embed with the transcript folded in (keep the old vector if
          // the endpoint is down — embed() returns null on failure)
          const vec = await embed([row.text, tr.text].join("\n\n"));
          if (vec) await setEmbedding(row.id, vec);
          done++;
        } else {
          await pool.query(`update bookmarks set raw = raw || '{"transcript":"none"}'::jsonb where id = $1`, [row.id]);
        }
      } catch (err) {
        console.warn(`youtube: transcript backfill ${row.video_id} failed (${(err as Error).message}) — will retry`);
      }
    }
    return done;
  },
};
