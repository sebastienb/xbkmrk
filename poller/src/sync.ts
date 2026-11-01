import { env } from "./env.js";
import {
  existingBookmarkIds, upsertAuthor, insertBookmark, insertMedia,
  upsertLinkContent, updateSyncState, bookmarksMissingEmbedding, setEmbedding, pool,
} from "./db.js";
import { getMe, getBookmarksPage, getLikedPage, resetUsage, usageSinceReset, estimateCost, refreshOfficialUsage } from "./xclient.js";
import { downloadMedia } from "./media.js";
import { embed, embeddingInput } from "./embed.js";
import { backfillEnrichment } from "./enrich.js";
import { backfillTags } from "./autotag.js";
import { syncExternalSources, backfillSources } from "./sources/index.js";

interface Collected {
  tweet: any;
  users: Map<string, any>;
  tweets: Map<string, any>;
  media: Map<string, any>;
}

let cachedUserId: string | null = null;

async function resolveUserId(): Promise<string> {
  // read env.xUserId lazily — DB setting overrides load after module init
  cachedUserId ||= env.xUserId || null;
  if (cachedUserId) return cachedUserId;
  const me = await getMe();
  cachedUserId = me.id;
  console.log(`resolved user @${me.username} (${me.id})`);
  return cachedUserId;
}

type Stream = "bookmarked" | "liked";

// Page newest-first, stop as soon as we hit a post already stored for this
// stream. That stop-on-seen cutoff is what keeps Owned Reads costs near zero.
// The likes stream additionally stops at posts older than LIKES_MAX_AGE_DAYS
// (bounds the first backfill; steady state hits stop-on-seen first).
async function collectNewPosts(userId: string, stream: Stream): Promise<Collected[]> {
  const collected: Collected[] = [];
  let paginationToken: string | undefined;
  const fetchPage = stream === "liked" ? getLikedPage : getBookmarksPage;
  const minCreatedAt =
    stream === "liked" ? Date.now() - env.likesMaxAgeDays * 24 * 3600 * 1000 : 0;

  for (let page = 0; ; page++) {
    // X bills per post READ, not per request — a 100-post page costs 100 reads
    // even when stop-on-seen discards all of them. Steady state rarely has
    // >25 new posts, so keep the first page small; deeper pages go full-size.
    const res = await fetchPage(userId, paginationToken, page === 0 ? 25 : 100);
    const tweets = res.data ?? [];
    if (tweets.length === 0) break;

    const users = new Map<string, any>((res.includes?.users ?? []).map((u: any) => [u.id, u]));
    const incTweets = new Map<string, any>((res.includes?.tweets ?? []).map((t: any) => [t.id, t]));
    const media = new Map<string, any>((res.includes?.media ?? []).map((m: any) => [m.media_key, m]));

    const seen = await existingBookmarkIds(tweets.map((t: any) => t.id), stream);
    let stop = false;
    for (const tweet of tweets) {
      if (seen.has(tweet.id)) {
        stop = true; // incremental cutoff — everything older is already stored
        break;
      }
      if (minCreatedAt && new Date(tweet.created_at).getTime() < minCreatedAt) {
        stop = true; // age cutoff for the likes stream
        break;
      }
      collected.push({ tweet, users, tweets: incTweets, media });
    }
    console.log(`${stream} page ${page + 1}: ${tweets.length} posts, ${collected.length} new so far${stop ? " (cutoff, stopping)" : ""}`);

    if (stop || !res.meta?.next_token) break;
    paginationToken = res.meta.next_token;
  }
  return collected;
}

function buildReferenced(tweet: any, incTweets: Map<string, any>, users: Map<string, any>): any[] | null {
  const refs: any[] = tweet.referenced_tweets ?? [];
  if (refs.length === 0) return null;
  return refs.map((ref) => {
    const full = incTweets.get(ref.id);
    const author = full ? users.get(full.author_id) : null;
    return {
      type: ref.type, // quoted | replied_to | retweeted
      id: ref.id,
      text: full?.note_tweet?.text ?? full?.text ?? null,
      author_id: full?.author_id ?? null,
      author_username: author?.username ?? null,
    };
  });
}

// X Articles (long-form posts): `text` is just a t.co self-link; the real
// content lives in tweet.article {title, preview_text, plain_text, cover_media}.
export function articleText(t: any): string | null {
  if (!t.article?.title) return null;
  return [t.article.title, t.article.plain_text ?? t.article.preview_text]
    .filter(Boolean)
    .join("\n\n");
}

export async function storeArticleContent(t: any, media: Map<string, any>): Promise<void> {
  if (!t.article?.title) return;
  const articleUrl =
    (t.entities?.urls ?? []).map((u: any) => u.unwound_url ?? u.expanded_url)
      .find((u: string) => u?.includes("/article/")) ?? `https://x.com/i/article/${t.id}`;

  await upsertLinkContent({
    bookmark_id: t.id,
    url: articleUrl,
    kind: "x_article",
    title: t.article.title,
    site_name: "X Article",
    description: t.article.preview_text ?? null,
    content: t.article.plain_text ?? null,
    status: t.article.plain_text ? "ok" : "no_content",
  });

  // cover image as a media row → cards pick it up as the thumbnail.
  // cover_media is a bare media_key string (docs show an object — handle both)
  const coverKey =
    typeof t.article.cover_media === "string" ? t.article.cover_media : t.article.cover_media?.media_key;
  const cover = coverKey ? media.get(coverKey) : null;
  if (cover?.type === "photo") {
    const localPath = await downloadMedia(t.id, cover);
    await insertMedia({
      media_key: cover.media_key,
      bookmark_id: t.id,
      type: cover.type,
      local_path: localPath,
      alt_text: cover.alt_text ?? null,
      width: cover.width ?? null,
      height: cover.height ?? null,
    });
  }
}

async function processPost(c: Collected, stream: Stream): Promise<void> {
  const t = c.tweet;
  const text: string = articleText(t) ?? t.note_tweet?.text ?? t.text;
  const isLong = Boolean(t.article?.title || t.note_tweet?.text);

  const author = c.users.get(t.author_id);
  if (author) await upsertAuthor(author);

  const referenced = buildReferenced(t, c.tweets, c.users);
  const urls = (t.entities?.urls ?? [])
    .map((u: any) => ({ expanded_url: u.expanded_url, display_url: u.display_url }))
    .filter((u: any) => u.expanded_url);

  // media first so alt text can enrich the embedding
  const mediaKeys: string[] = t.attachments?.media_keys ?? [];
  const mediaItems = mediaKeys.map((k) => c.media.get(k)).filter(Boolean);
  const altTexts = mediaItems.map((m: any) => m.alt_text).filter(Boolean);

  const embedding = await embed(embeddingInput(text, referenced, altTexts));

  const inserted = await insertBookmark({
    id: t.id,
    author_id: author ? t.author_id : null,
    text,
    is_long: isLong,
    created_at: t.created_at,
    urls: urls.length ? urls : null,
    referenced,
    metrics: t.public_metrics ?? null,
    lang: t.lang ?? null,
    raw: t,
    embedding,
    bookmarked: stream === "bookmarked",
    liked: stream === "liked",
  });

  if (inserted) {
    await storeArticleContent(t, c.media);
    for (const m of mediaItems) {
      const localPath = await downloadMedia(t.id, m);
      await insertMedia({
        media_key: m.media_key,
        bookmark_id: t.id,
        type: m.type ?? null,
        local_path: localPath,
        alt_text: m.alt_text ?? null,
        width: m.width ?? null,
        height: m.height ?? null,
      });
    }
  }
}

// Retry rows whose embedding failed on a previous run (endpoint down, etc).
async function backfillEmbeddings(): Promise<void> {
  if (!env.embeddingApiUrl) return;
  const missing = await bookmarksMissingEmbedding();
  if (missing.length === 0) return;
  console.log(`backfilling ${missing.length} missing embeddings`);
  for (const row of missing) {
    const vec = await embed(embeddingInput(row.text, row.referenced));
    if (!vec) return; // endpoint still down — try again next run
    await setEmbedding(row.id, vec);
  }
}

async function syncStream(userId: string, stream: Stream): Promise<{ ok: number; total: number; newestId: string | null }> {
  const collected = await collectNewPosts(userId, stream);
  console.log(`${collected.length} new ${stream} posts to ingest`);

  // oldest → newest so saved_at ordering matches stream order
  collected.reverse();
  let ok = 0;
  for (const c of collected) {
    try {
      await processPost(c, stream);
      ok++;
    } catch (err) {
      console.error(`post ${c.tweet.id}: ${(err as Error).message}`);
    }
  }
  return { ok, total: collected.length, newestId: collected.at(-1)?.tweet.id ?? null };
}

export async function runSync(): Promise<void> {
  const startedAt = new Date().toISOString();
  console.log(`sync start ${startedAt}`);

  // External sources first (YouTube playlists, …) — local HTTP only, so an
  // X API failure (depleted credits, expired token) must not block them.
  let ext = 0;
  try {
    ext = await syncExternalSources();
  } catch (err) {
    console.error("external sources failed:", err);
  }

  let bm: { ok: number; total: number; newestId: string | null } = { ok: 0, total: 0, newestId: null };
  let liked = { ok: 0, total: 0 };
  let xErr: unknown = null;
  resetUsage();
  try {
    const userId = await resolveUserId();
    bm = await syncStream(userId, "bookmarked");

    if (env.syncLikes) {
      try {
        liked = await syncStream(userId, "liked");
      } catch (err) {
        // likes need the like.read scope — re-run `npm run auth` after upgrading
        console.error(`likes sync failed (missing like.read scope? re-run npm run auth): ${(err as Error).message}`);
      }
    }
  } catch (err) {
    xErr = err; // backfills still run below (fresh source items need tags)
  }

  const usage = usageSinceReset();
  if (usage.requests > 0) {
    const cost = estimateCost(usage.posts);
    console.log(`X API: ${usage.posts} posts read over ${usage.requests} requests${cost ? ` (~${cost})` : ""}`);
  }
  // even (especially) after a credits-depleted failure, the official numbers matter
  await refreshOfficialUsage();

  const newCount = bm.total + liked.total + ext;
  await runBackfills(Math.max(newCount, 25), Math.max(newCount, 30));

  // failed X sync keeps last_run_at untouched so on-access retries later
  if (xErr) throw xErr;

  await updateSyncState(bm.newestId);
  console.log(`sync done: bookmarks ${bm.ok}/${bm.total}, likes ${liked.ok}/${liked.total}, sources ${ext}`);
}

// Local pipeline only — no X API calls. Also runs standalone when the web app
// NOTIFYs enrich_request (bookmarklet saves need content/embedding/tags now,
// not at the next X sync).
export async function runBackfills(enrichLimit = 25, tagLimit = 30): Promise<void> {
  // source-specific passes first (e.g. YouTube transcripts) — they update
  // content + embeddings that the passes below build on
  await backfillSources(enrichLimit);

  await backfillEmbeddings();

  // enrich new posts + up to `enrichLimit` older un-enriched ones (politeness cap)
  try {
    const enriched = await backfillEnrichment(enrichLimit);
    if (enriched > 0) console.log(`enriched ${enriched} posts`);
  } catch (err) {
    console.error("enrichment failed:", err);
  }

  try {
    const tagged = await backfillTags(tagLimit);
    if (tagged > 0) console.log(`auto-tagged ${tagged} posts`);
  } catch (err) {
    console.error("auto-tagging failed:", err);
  }
}

export async function shutdown(): Promise<void> {
  await pool.end();
}
