// Reddit post enrichment via the official API with free "script app"
// credentials (reddit.com/prefs/apps). Anonymous .json endpoints are blocked
// for server IPs these days, but application-only OAuth (client_credentials)
// reads public posts fine within the free 100 req/min quota.
import { env } from "./env.js";

// Reddit asks for a descriptive UA; generic browser UAs get blocked faster.
const UA = "x-bookmark-archive/1.0 (self-hosted bookmark archive)";

export function redditEnabled(): boolean {
  return Boolean(env.redditClientId && env.redditClientSecret);
}

// reddit.com/r/<sub>/comments/<id>/…, user-profile post urls, and redd.it/<id>
// short links. Mobile share links (/r/<sub>/s/<code>) can't be resolved
// without cookies — those fall through to the generic enrichment.
const POST_RE = /^https?:\/\/(?:www\.|old\.|new\.|np\.)?reddit\.com\/(?:r|user|u)\/[^/]+\/comments\/([a-z0-9]+)/i;
const SHORT_RE = /^https?:\/\/redd\.it\/([a-z0-9]+)/i;

export function redditPostId(url: string): string | null {
  const m = url.match(POST_RE) ?? url.match(SHORT_RE);
  return m ? m[1].toLowerCase() : null;
}

let cachedToken: { token: string; exp: number } | null = null;

async function accessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.exp) return cachedToken.token;
  const basic = Buffer.from(`${env.redditClientId}:${env.redditClientSecret}`).toString("base64");
  const res = await fetch("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: {
      authorization: `Basic ${basic}`,
      "content-type": "application/x-www-form-urlencoded",
      "user-agent": UA,
    },
    body: "grant_type=client_credentials",
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`reddit token ${res.status} — check the client id/secret`);
  const json = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) throw new Error("reddit token: malformed response");
  cachedToken = { token: json.access_token, exp: Date.now() + ((json.expires_in ?? 3600) - 120) * 1000 };
  return cachedToken.token;
}

export interface RedditPost {
  title: string;
  subreddit: string;
  author: string | null;
  selftext: string | null; // markdown
  createdAt: string; // ISO
  score: number;
  numComments: number;
  externalUrl: string | null; // link posts: where the post points
  imageUrl: string | null; // preview / first gallery image
  video: { url: string; width: number | null; height: number | null } | null;
  comments: Array<{ author: string; score: number; body: string }>; // top-level, by score
}

const REDDIT_MEDIA_HOSTS = /(^|\.)(reddit\.com|redd\.it|redditmedia\.com)$/;

function externalTarget(p: any): string | null {
  const u: string | undefined = p.url_overridden_by_dest;
  if (!u || !/^https?:\/\//.test(u)) return null;
  try {
    return REDDIT_MEDIA_HOSTS.test(new URL(u).hostname) ? null : u;
  } catch {
    return null;
  }
}

function previewImage(p: any): string | null {
  const src = p.preview?.images?.[0]?.source?.url;
  if (src) return src; // raw_json=1 → not HTML-escaped
  // galleries have no preview — take the first item's largest rendition
  if (p.media_metadata) {
    const first: any = Object.values(p.media_metadata)[0];
    return first?.s?.u ?? first?.s?.gif ?? null;
  }
  return null;
}

export async function fetchRedditPost(postId: string): Promise<RedditPost> {
  const token = await accessToken();
  const res = await fetch(
    `https://oauth.reddit.com/comments/${postId}?raw_json=1&limit=25&depth=1&sort=top`,
    { headers: { authorization: `Bearer ${token}`, "user-agent": UA }, signal: AbortSignal.timeout(20_000) },
  );
  if (res.status === 401) {
    cachedToken = null; // token revoked/expired early — refetch next attempt
    throw new Error("reddit 401 (token expired)");
  }
  if (!res.ok) throw new Error(`reddit ${res.status}`);
  const [postListing, commentListing] = (await res.json()) as any[];
  const p = postListing?.data?.children?.[0]?.data;
  if (!p?.title) throw new Error("reddit: post not found");

  const rv = p.secure_media?.reddit_video ?? p.media?.reddit_video;
  const comments = ((commentListing?.data?.children ?? []) as any[])
    .filter((c) => c.kind === "t1")
    .map((c) => c.data)
    .filter((c) => c.body && c.author && c.author !== "AutoModerator" && c.author !== "[deleted]" && !c.stickied)
    .slice(0, 5)
    .map((c) => ({ author: c.author as string, score: (c.score ?? 0) as number, body: c.body as string }));

  return {
    title: p.title,
    subreddit: p.subreddit ?? "reddit",
    author: p.author && p.author !== "[deleted]" ? p.author : null,
    selftext: p.selftext?.trim() || null,
    createdAt: new Date((p.created_utc ?? 0) * 1000).toISOString(),
    score: p.score ?? 0,
    numComments: p.num_comments ?? 0,
    externalUrl: externalTarget(p),
    imageUrl: previewImage(p),
    video: rv?.fallback_url
      ? { url: rv.fallback_url, width: rv.width ?? null, height: rv.height ?? null }
      : null,
    comments,
  };
}
