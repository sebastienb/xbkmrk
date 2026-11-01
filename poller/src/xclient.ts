import { env } from "./env.js";
import { loadToken, saveToken, recordApiUsage, saveUsageSnapshot } from "./db.js";

const API = "https://api.x.com/2";
const TOKEN_URL = "https://api.x.com/2/oauth2/token";

// ---- token handling ----------------------------------------------------
// Access tokens last ~2h. Refresh tokens ROTATE on every refresh — the new
// one MUST be persisted immediately or the poller locks itself out.

let cachedAccessToken: string | null = null;
let cachedExpiresAt = 0;

function basicAuthHeader(): Record<string, string> {
  // confidential clients authenticate the token endpoint with Basic auth;
  // public clients send client_id in the body instead.
  if (env.xClientSecret) {
    const cred = Buffer.from(`${env.xClientId}:${env.xClientSecret}`).toString("base64");
    return { authorization: `Basic ${cred}` };
  }
  return {};
}

export async function exchangeToken(params: Record<string, string>): Promise<{
  access_token: string; refresh_token: string; expires_in: number;
}> {
  const body = new URLSearchParams(params);
  if (!env.xClientSecret) body.set("client_id", env.xClientId);
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", ...basicAuthHeader() },
    body,
  });
  if (!res.ok) {
    throw new Error(`token endpoint ${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as { access_token: string; refresh_token: string; expires_in: number };
}

export async function getAccessToken(): Promise<string> {
  if (cachedAccessToken && Date.now() < cachedExpiresAt - 60_000) return cachedAccessToken;

  const stored = await loadToken();
  if (!stored) {
    throw new Error("No OAuth token in DB. Run the one-time auth flow first: npm run auth");
  }

  // reuse stored access token if still comfortably valid
  if (stored.access_token && stored.expires_at && new Date(stored.expires_at).getTime() > Date.now() + 5 * 60_000) {
    cachedAccessToken = stored.access_token;
    cachedExpiresAt = new Date(stored.expires_at).getTime();
    return cachedAccessToken;
  }

  const fresh = await exchangeToken({ grant_type: "refresh_token", refresh_token: stored.refresh_token });
  const expiresAt = new Date(Date.now() + fresh.expires_in * 1000);
  await saveToken({ access_token: fresh.access_token, refresh_token: fresh.refresh_token, expires_at: expiresAt });
  cachedAccessToken = fresh.access_token;
  cachedExpiresAt = expiresAt.getTime();
  return cachedAccessToken;
}

// ---- usage accounting --------------------------------------------------
// X bills per post READ. Every successful request is logged to x_api_usage
// with its billable post count; in-memory counters let a sync report what
// the whole run cost.

let runPosts = 0;
let runRequests = 0;

export function resetUsage(): void {
  runPosts = 0;
  runRequests = 0;
}

export function usageSinceReset(): { posts: number; requests: number } {
  return { posts: runPosts, requests: runRequests };
}

export function estimateCost(posts: number): string | null {
  const per1k = env.xCostPer1kPosts;
  if (!per1k) return null;
  return `$${((posts / 1000) * per1k).toFixed(2)}`;
}

// X's own usage numbers for the project (GET /2/usage/tweets): monthly post
// consumption vs cap, across ALL clients of the project — the authoritative
// "remaining balance". Requires the app-only Bearer Token (the user token we
// sync with is explicitly rejected by this endpoint). Costs no post reads.
// Snapshot lands in x_usage_snapshot for the web meter; failures only warn.
export async function refreshOfficialUsage(): Promise<void> {
  if (!env.xBearerToken) return;
  try {
    const res = await fetch(`${API}/usage/tweets?usage.fields=cap_reset_day,project_cap,project_usage`, {
      headers: { authorization: `Bearer ${env.xBearerToken}` },
    });
    if (!res.ok) {
      console.warn(`usage endpoint ${res.status}: ${(await res.text()).slice(0, 300)}`);
      return;
    }
    const json = await res.json();
    if (json?.data) {
      await saveUsageSnapshot(json.data);
      console.log(`X official usage: ${json.data.project_usage}/${json.data.project_cap} posts this cycle`);
    }
  } catch (err) {
    console.warn(`usage refresh failed: ${(err as Error).message}`);
  }
}

// Only post-returning endpoints bill: timelines and tweet lookups.
// User lookups (/users, /users/me) read no posts.
function billablePosts(path: string, json: any): number {
  if (!/^\/tweets|\/bookmarks|\/liked_tweets/.test(path)) return 0;
  if (Array.isArray(json?.data)) return json.data.length;
  return json?.data ? 1 : 0;
}

// ---- API calls ---------------------------------------------------------

async function apiGet(path: string, params: Record<string, string>): Promise<any> {
  const url = new URL(`${API}${path}`);
  for (const [k, v] of Object.entries(params)) if (v) url.searchParams.set(k, v);

  for (let attempt = 0; attempt < 5; attempt++) {
    const token = await getAccessToken();
    const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });

    if (res.status === 429) {
      const reset = parseInt(res.headers.get("x-rate-limit-reset") || "0", 10) * 1000;
      const waitMs = Math.min(Math.max(reset - Date.now(), 5_000), 16 * 60_000);
      console.warn(`429 rate limited; waiting ${Math.round(waitMs / 1000)}s`);
      await new Promise((r) => setTimeout(r, waitMs));
      continue;
    }
    if (res.status === 401) {
      // force a refresh next attempt
      cachedAccessToken = null;
      cachedExpiresAt = 0;
      if (attempt < 4) continue;
    }
    if (!res.ok) {
      throw new Error(`GET ${path} → ${res.status}: ${await res.text()}`);
    }
    const json = await res.json();
    const posts = billablePosts(path, json);
    runPosts += posts;
    runRequests += 1;
    // normalize /tweets/:id and /users/:id/... so the log groups by endpoint
    await recordApiUsage(path.replace(/\/\d+/g, "/:id"), posts);
    return json;
  }
  throw new Error(`GET ${path}: exhausted retries`);
}

export async function getMe(): Promise<{ id: string; username: string }> {
  const json = await apiGet("/users/me", {});
  return json.data;
}

// Bulk user lookup (max 100 ids per call). Suspended/deleted ids are simply
// absent from the result. Used by the banner backfill.
export async function getUsersByIds(ids: string[]): Promise<any[]> {
  const json = await apiGet("/users", {
    ids: ids.join(","),
    "user.fields": "id,username,name,profile_image_url,profile_banner_url,verified,description",
  });
  return json.data ?? [];
}

export interface BookmarksPage {
  data?: any[];
  includes?: { users?: any[]; tweets?: any[]; media?: any[] };
  meta?: { next_token?: string; result_count?: number };
}

// Single-post fetch with the same field set (used by maintenance backfills).
export async function getTweet(id: string): Promise<BookmarksPage> {
  const json = await apiGet(`/tweets/${id}`, {
    expansions:
      "author_id,attachments.media_keys,referenced_tweets.id,referenced_tweets.id.author_id,article.cover_media,article.media_entities",
    "tweet.fields":
      "id,text,created_at,author_id,conversation_id,in_reply_to_user_id,lang,public_metrics,possibly_sensitive,entities,attachments,referenced_tweets,note_tweet,context_annotations,article",
    "media.fields": "media_key,type,url,preview_image_url,alt_text,width,height,duration_ms,variants",
    "user.fields": "id,username,name,profile_image_url,profile_banner_url,verified,description",
  });
  return { data: json.data ? [json.data] : [], includes: json.includes, meta: {} };
}

export async function getBookmarksPage(userId: string, paginationToken?: string, maxResults = 100): Promise<BookmarksPage> {
  return getTimelinePage(`/users/${userId}/bookmarks`, paginationToken, maxResults);
}

export async function getLikedPage(userId: string, paginationToken?: string, maxResults = 100): Promise<BookmarksPage> {
  return getTimelinePage(`/users/${userId}/liked_tweets`, paginationToken, maxResults);
}

function getTimelinePage(path: string, paginationToken?: string, maxResults = 100): Promise<BookmarksPage> {
  return apiGet(path, {
    max_results: String(maxResults),
    pagination_token: paginationToken ?? "",
    expansions:
      "author_id,attachments.media_keys,referenced_tweets.id,referenced_tweets.id.author_id,article.cover_media,article.media_entities",
    "tweet.fields":
      "id,text,created_at,author_id,conversation_id,in_reply_to_user_id,lang,public_metrics,possibly_sensitive,entities,attachments,referenced_tweets,note_tweet,context_annotations,article",
    "media.fields": "media_key,type,url,preview_image_url,alt_text,width,height,duration_ms,variants",
    "user.fields": "id,username,name,profile_image_url,profile_banner_url,verified,description",
  });
}
