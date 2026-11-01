// Enriches bookmarks with content from their primary external link:
// og metadata + extracted article HTML, or GitHub README markdown.
// Failures are recorded (status=failed) and not retried in v1.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { JSDOM, VirtualConsole } from "jsdom";
import { Readability } from "@mozilla/readability";
import sanitizeHtml from "sanitize-html";
import { env } from "./env.js";
import { pool, upsertLinkContent, upsertAuthor, insertMedia } from "./db.js";
import { embed, embeddingInput } from "./embed.js";
import { downloadMedia } from "./media.js";
import { redditEnabled, redditPostId, fetchRedditPost } from "./reddit.js";

const FETCH_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const MAX_HTML_BYTES = 3 * 1024 * 1024;
const SKIP_HOSTS = new Set(["x.com", "www.x.com", "twitter.com", "www.twitter.com", "t.co"]);

interface Enrichment {
  url: string;
  kind: "article" | "github" | "x_post" | "reddit" | "other";
  title: string | null;
  site_name: string | null;
  description: string | null;
  og_image_url: string | null;
  content: string | null;
  status: "ok" | "no_content" | "failed";
}

// ---- primary link selection ------------------------------------------------

export function pickPrimaryUrl(urls: Array<{ expanded_url?: string }> | null): string | null {
  for (const u of urls ?? []) {
    if (!u.expanded_url) continue;
    try {
      const host = new URL(u.expanded_url).hostname;
      if (!SKIP_HOSTS.has(host)) return u.expanded_url;
    } catch {
      /* malformed url — skip */
    }
  }
  return null;
}

// ---- x posts saved from the web --------------------------------------------

// SKIP_HOSTS assumes X urls only ever arrive via the API sync, where the post
// data is already complete. Posts saved through the bookmarklet / iOS shortcut
// break that assumption: x.com serves a JS shell to scrapers, so without the
// paid API the only free source of author + text is the oEmbed endpoint.
const X_STATUS_RE = /^https?:\/\/(?:www\.|mobile\.)?(?:x\.com|twitter\.com)\/[A-Za-z0-9_]+\/status(?:es)?\/\d+/;

export function pickXStatusUrl(urls: Array<{ expanded_url?: string }> | null): string | null {
  for (const u of urls ?? []) {
    if (u.expanded_url && X_STATUS_RE.test(u.expanded_url)) return u.expanded_url;
  }
  return null;
}

// Primary path: the syndication endpoint behind X's embedded-tweet widgets.
// Free, no auth — its token is derived from the post id. Returns structured
// JSON incl. media urls and video variants, which oEmbed doesn't have.
function syndicationToken(id: string): string {
  return ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, "");
}

async function fetchSyndication(postId: string): Promise<any> {
  const res = await fetch(
    `https://cdn.syndication.twimg.com/tweet-result?id=${postId}&token=${syndicationToken(postId)}`,
    { headers: { "user-agent": FETCH_UA, accept: "application/json" }, signal: AbortSignal.timeout(15_000) },
  );
  if (!res.ok) throw new Error(`syndication ${res.status}`);
  const json = (await res.json()) as any;
  // tombstones (deleted/protected/withheld) come back without a real tweet body
  if (!json?.id_str || typeof json.text !== "string") throw new Error("post unavailable");
  return json;
}

// syndication text comes HTML-escaped (&gt; etc), unlike the API's
const unescapeHtml = (s: string): string =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");

// Rebuild the bookmark as if it had arrived via the API sync: real text,
// author row, media downloads, metrics, quoted post, post date, embedding.
// Returns the post's first external link (for the normal enrichment pass),
// or null when the post doesn't link out.
async function hydrateXPost(bookmarkId: string, xUrl: string): Promise<string | null> {
  const postId = xUrl.match(/status(?:es)?\/(\d+)/)![1];
  const t = await fetchSyndication(postId);
  const text = unescapeHtml(t.text);

  let authorId: string | null = null;
  if (t.user?.id_str) {
    authorId = t.user.id_str as string;
    await upsertAuthor({
      id: authorId,
      username: t.user.screen_name,
      name: t.user.name,
      profile_image_url: t.user.profile_image_url_https,
    });
  }

  const referenced = t.quoted_tweet?.id_str
    ? [{
        type: "quoted",
        id: t.quoted_tweet.id_str,
        text: t.quoted_tweet.text ? unescapeHtml(t.quoted_tweet.text) : null,
        author_id: t.quoted_tweet.user?.id_str ?? null,
        author_username: t.quoted_tweet.user?.screen_name ?? null,
      }]
    : null;

  // urls[0] must stay the saved X url — it's the web-save dedup key
  const externals: string[] = (t.entities?.urls ?? [])
    .map((u: any) => u.expanded_url)
    .filter((u: string | undefined) => {
      try { return Boolean(u) && !SKIP_HOSTS.has(new URL(u!).hostname); } catch { return false; }
    });
  const urls = [
    { expanded_url: xUrl, display_url: `x.com/…/status/${postId}` },
    ...externals.map((u) => {
      const p = new URL(u);
      return { expanded_url: u, display_url: (p.hostname.replace(/^www\./, "") + p.pathname).slice(0, 60) };
    }),
  ];

  const altTexts: string[] = [];
  for (const [i, m] of ((t.mediaDetails ?? []) as any[]).entries()) {
    // syndication media has no media_key and names bitrate differently —
    // adapt to the shape downloadMedia expects from the API
    const key = `web_${postId}_${i}`;
    const localPath = await downloadMedia(bookmarkId, {
      media_key: key,
      type: m.type,
      url: m.type === "photo" ? `${m.media_url_https}?name=large` : undefined,
      preview_image_url: m.media_url_https,
      variants: (m.video_info?.variants ?? []).map((v: any) => ({
        content_type: v.content_type, bit_rate: v.bitrate, url: v.url,
      })),
    });
    if (m.ext_alt_text) altTexts.push(m.ext_alt_text);
    await insertMedia({
      media_key: key,
      bookmark_id: bookmarkId,
      type: m.type ?? null,
      local_path: localPath,
      alt_text: m.ext_alt_text ?? null,
      width: m.original_info?.width ?? null,
      height: m.original_info?.height ?? null,
    });
  }

  const embedding = await embed(embeddingInput(text, referenced, altTexts));
  await pool.query(
    `update bookmarks set
       author_id = $2, text = $3, created_at = $4::timestamptz, urls = $5::jsonb,
       referenced = $6::jsonb, metrics = $7::jsonb, lang = $8,
       raw = coalesce(raw, '{}'::jsonb) || $9::jsonb,
       embedding = coalesce($10::vector, embedding)
     where id = $1`,
    [
      bookmarkId, authorId, text, t.created_at, JSON.stringify(urls),
      JSON.stringify(referenced), JSON.stringify({ like_count: t.favorite_count ?? 0, reply_count: t.conversation_count ?? 0 }),
      t.lang ?? null, JSON.stringify({ x_post: t }),
      embedding ? `[${embedding.join(",")}]` : null,
    ],
  );

  return externals[0] ?? null;
}

async function enrichXPostOembed(url: string): Promise<Enrichment & { postDate: string | null }> {
  const res = await fetch(
    `https://publish.x.com/oembed?url=${encodeURIComponent(url)}&omit_script=true&dnt=true`,
    {
      headers: { "user-agent": FETCH_UA, accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
      redirect: "follow",
    },
  );
  if (!res.ok) throw new Error(`oembed ${res.status}`);
  // deleted/protected posts answer with an HTML error page → json() throws → status=failed
  const json = (await res.json()) as { author_name?: string; author_url?: string; html?: string };

  const vc = new VirtualConsole();
  vc.on("error", () => {});
  const doc = new JSDOM(json.html ?? "", { virtualConsole: vc }).window.document;
  const p = doc.querySelector("blockquote p");
  p?.querySelectorAll("br").forEach((br) => br.replaceWith("\n"));
  const text = p?.textContent?.trim() || null;

  const handle = json.author_url?.match(/(?:x|twitter)\.com\/([A-Za-z0-9_]+)/)?.[1] ?? null;
  const author = [json.author_name, handle ? `(@${handle})` : null].filter(Boolean).join(" ");
  // the blockquote's trailing link text is the post date, e.g. "March 21, 2006"
  const postDate = new Date(doc.querySelector("blockquote > a")?.textContent ?? "");

  return {
    url,
    kind: "x_post",
    title: author || "Post on X",
    site_name: "X",
    description: text?.slice(0, 500) ?? null,
    og_image_url: null,
    content: text,
    status: text ? "ok" : "no_content",
    postDate: isNaN(+postDate) ? null : postDate.toISOString(),
  };
}

// Web-saved X post: syndication hydration first (media, author, metrics, real
// text); the post's external link then goes through the normal enrichment so
// the bookmark ends up shaped like an API-synced one. oEmbed (author + text
// only) is the fallback when syndication fails.
async function enrichWebXPost(bookmarkId: string, xUrl: string): Promise<Enrichment> {
  let externalUrl: string | null = null;
  try {
    externalUrl = await hydrateXPost(bookmarkId, xUrl);
  } catch (err) {
    console.warn(`x post ${bookmarkId}: syndication failed (${(err as Error).message}) — oEmbed fallback`);
    const xp = await enrichXPostOembed(xUrl);
    if (xp.status === "ok") {
      // correct the intent-time data: created_at = save time, embedding from
      // the share-sheet title
      if (xp.postDate) {
        await pool.query("update bookmarks set created_at = $2 where id = $1", [bookmarkId, xp.postDate]);
      }
      const vec = await embed([xp.title, xp.content].filter(Boolean).join("\n\n"));
      if (vec) {
        await pool.query("update bookmarks set embedding = $2::vector where id = $1", [bookmarkId, `[${vec.join(",")}]`]);
      }
    }
    return xp;
  }

  if (externalUrl) {
    // source "x": the bookmark was just hydrated from the post — the reddit
    // branch must not re-date/re-embed it as if the save were the thread
    return enrichExternal(bookmarkId, externalUrl, "x");
  }
  // no external link: marker row — records the outcome so the backfill moves
  // on, and identifies the bookmark as an X post to the web UI
  return {
    url: xUrl, kind: "x_post", title: null, site_name: "X", description: null,
    og_image_url: null, content: null, status: "no_content",
  };
}

// ---- github ------------------------------------------------------------------

function parseGithubRepo(url: string): { owner: string; repo: string } | null {
  const m = new URL(url).pathname.match(/^\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
  if (!m) return null;
  const [, owner, repo] = m;
  if (["orgs", "topics", "collections", "trending", "sponsors", "settings", "marketplace"].includes(owner)) return null;
  return { owner, repo };
}

function ghHeaders(accept: string): Record<string, string> {
  return {
    accept,
    "user-agent": "x-bookmark-archive",
    ...(env.githubToken ? { authorization: `Bearer ${env.githubToken}` } : {}),
  };
}

async function enrichGithub(url: string, { owner, repo }: { owner: string; repo: string }): Promise<Enrichment> {
  const base = `https://api.github.com/repos/${owner}/${repo}`;
  const repoRes = await fetch(base, { headers: ghHeaders("application/vnd.github+json"), signal: AbortSignal.timeout(15_000) });
  if (!repoRes.ok) throw new Error(`github repo meta ${repoRes.status}`);
  const meta = (await repoRes.json()) as { full_name: string; description: string | null };

  let readme: string | null = null;
  const readmeRes = await fetch(`${base}/readme`, {
    headers: ghHeaders("application/vnd.github.raw+json"),
    signal: AbortSignal.timeout(15_000),
  });
  if (readmeRes.ok) readme = (await readmeRes.text()).slice(0, 500_000);

  return {
    url,
    kind: "github",
    title: meta.full_name,
    site_name: "GitHub",
    description: meta.description,
    og_image_url: `https://opengraph.githubassets.com/1/${owner}/${repo}`,
    content: readme,
    status: readme ? "ok" : "no_content",
  };
}

// ---- reddit ------------------------------------------------------------------

// Post body + top comments as markdown (rendered like a README in the web
// app). Needs script-app creds; without them reddit urls take the generic
// path (which mostly fails — reddit blocks anonymous server traffic).
async function enrichReddit(bookmarkId: string, url: string, postId: string, source: string): Promise<Enrichment> {
  const p = await fetchRedditPost(postId);

  const parts: string[] = [];
  if (p.selftext) parts.push(p.selftext);
  if (p.externalUrl) parts.push(`**Link:** [${p.externalUrl}](${p.externalUrl})`);
  if (p.comments.length > 0) {
    parts.push("---\n\n**Top comments**");
    for (const c of p.comments) {
      parts.push(`**u/${c.author}** · ${c.score} points\n\n${c.body.split("\n").map((l) => `> ${l}`).join("\n")}`);
    }
  }
  const content = parts.join("\n\n") || null;

  if (source === "web") {
    // saved from the share sheet / bookmarklet: date it like the post, fetch
    // the video (the og image below already covers photo posts), and re-embed
    // now that the real text is known
    await pool.query("update bookmarks set created_at = $2::timestamptz where id = $1", [bookmarkId, p.createdAt]);
    if (p.video) {
      const key = `web_reddit_${postId}`;
      const localPath = await downloadMedia(bookmarkId, { media_key: key, type: "video", variants: [{ content_type: "video/mp4", bit_rate: 1, url: p.video.url }] });
      await insertMedia({
        media_key: key, bookmark_id: bookmarkId, type: "video", local_path: localPath,
        alt_text: null, width: p.video.width, height: p.video.height,
      });
    }
    const vec = await embed(
      [p.title, p.selftext, p.comments.map((c) => c.body).join("\n")].filter(Boolean).join("\n\n"),
    );
    if (vec) {
      await pool.query("update bookmarks set embedding = $2::vector where id = $1", [bookmarkId, `[${vec.join(",")}]`]);
    }
  }

  return {
    url,
    kind: "reddit",
    title: p.title,
    site_name: `r/${p.subreddit}`,
    description: (p.selftext ?? p.externalUrl ?? "").slice(0, 500) || null,
    og_image_url: p.imageUrl,
    content: content?.slice(0, 1_000_000) ?? null,
    status: content ? "ok" : "no_content",
  };
}

// ---- generic pages -----------------------------------------------------------

// Instagram/Facebook serve a blank JS shell to browsers (post urls even stall
// the connection), but must answer Facebook's own link-preview crawler — its
// UA gets complete og tags: caption excerpt, author, and the post image.
const FB_CRAWLER_UA = "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)";
const FB_CRAWLER_HOSTS = /(^|\.)(instagram\.com|facebook\.com|fb\.watch)$/;

function uaFor(url: string): string {
  try {
    return FB_CRAWLER_HOSTS.test(new URL(url).hostname) ? FB_CRAWLER_UA : FETCH_UA;
  } catch {
    return FETCH_UA;
  }
}

async function fetchHtml(url: string): Promise<{ html: string; finalUrl: string } | null> {
  const res = await fetch(url, {
    headers: { "user-agent": uaFor(url), accept: "text/html,application/xhtml+xml" },
    signal: AbortSignal.timeout(15_000),
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`fetch ${res.status}`);
  const ctype = res.headers.get("content-type") ?? "";
  if (!ctype.includes("html")) return null; // pdf, image, … — nothing to extract
  const reader = res.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
    if (total >= MAX_HTML_BYTES) {
      reader.cancel().catch(() => {});
      break;
    }
  }
  return { html: Buffer.concat(chunks).toString("utf8"), finalUrl: res.url || url };
}

function metaContent(doc: Document, ...names: string[]): string | null {
  for (const name of names) {
    const el =
      doc.querySelector(`meta[property="${name}"]`) ?? doc.querySelector(`meta[name="${name}"]`);
    const val = el?.getAttribute("content")?.trim();
    if (val) return val;
  }
  return null;
}

const SANITIZE_OPTS: sanitizeHtml.IOptions = {
  allowedTags: [
    "p", "br", "b", "i", "em", "strong", "u", "s", "a", "blockquote", "code", "pre",
    "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "img", "figure", "figcaption",
    "table", "thead", "tbody", "tr", "th", "td", "hr", "span", "div",
  ],
  allowedAttributes: {
    a: ["href", "title"],
    img: ["src", "alt", "title"],
    "*": [],
  },
  allowedSchemes: ["http", "https"],
};

async function enrichArticle(url: string): Promise<Enrichment> {
  const fetched = await fetchHtml(url);
  const base: Enrichment = {
    url, kind: "other", title: null, site_name: null, description: null,
    og_image_url: null, content: null, status: "no_content",
  };
  if (!fetched) return base;

  // jsdom: suppress css-parse noise from real-world pages
  const vc = new VirtualConsole();
  vc.on("error", () => {});
  const dom = new JSDOM(fetched.html, { url: fetched.finalUrl, virtualConsole: vc });
  const doc = dom.window.document;

  base.title = metaContent(doc, "og:title", "twitter:title") ?? doc.title?.trim() ?? null;
  base.description = metaContent(doc, "og:description", "twitter:description", "description");
  base.site_name = metaContent(doc, "og:site_name") ?? new URL(fetched.finalUrl).hostname.replace(/^www\./, "");
  const ogImage = metaContent(doc, "og:image", "twitter:image");
  base.og_image_url = ogImage ? new URL(ogImage, fetched.finalUrl).href : null;

  try {
    const article = new Readability(doc).parse();
    if (article?.content && (article.textContent?.trim().length ?? 0) > 200) {
      base.kind = "article";
      base.content = sanitizeHtml(article.content, SANITIZE_OPTS).slice(0, 1_000_000);
      base.title = article.title || base.title;
      base.status = "ok";
    }
  } catch {
    /* readability blew up on weird markup — keep og-only enrichment */
  }
  return base;
}

// ---- og image download -------------------------------------------------------

export async function downloadOgImage(bookmarkId: string, url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { "user-agent": FETCH_UA },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return null;
    const ctype = res.headers.get("content-type") ?? "";
    const ext = ctype.includes("png") ? ".png" : ctype.includes("webp") ? ".webp" : ctype.includes("gif") ? ".gif" : ".jpg";
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 100 || buf.length > 15 * 1024 * 1024) return null;
    const relPath = path.join("og", `${bookmarkId}${ext}`);
    const absPath = path.join(env.mediaDir, relPath);
    await mkdir(path.dirname(absPath), { recursive: true });
    await writeFile(absPath, buf);
    return relPath;
  } catch {
    return null;
  }
}

// ---- orchestration -----------------------------------------------------------

// Route an external url to its specialized enrichment (github, reddit) or the
// generic article path.
async function enrichExternal(bookmarkId: string, url: string, source: string): Promise<Enrichment> {
  const gh = url.includes("github.com") ? parseGithubRepo(url) : null;
  if (gh) return enrichGithub(url, gh);
  const redditId = redditEnabled() ? redditPostId(url) : null;
  if (redditId) return enrichReddit(bookmarkId, url, redditId, source);
  return enrichArticle(url);
}

export async function enrichBookmark(
  bookmarkId: string,
  urls: Array<{ expanded_url?: string }> | null,
  source = "x",
): Promise<void> {
  const url = pickPrimaryUrl(urls);
  // web-saved X post: no scrapeable url, but oEmbed can still fill the card.
  // API-synced posts never take this path — their data is already complete.
  const xUrl = !url && source === "web" ? pickXStatusUrl(urls) : null;
  if (!url && !xUrl) {
    // record the outcome so backfill doesn't reprocess; card falls back to post media/avatar
    await pool.query(
      `insert into link_content (bookmark_id, url, kind, status) values ($1, '', 'other', 'no_link')
       on conflict (bookmark_id) do nothing`,
      [bookmarkId],
    );
    return;
  }

  let result: Enrichment;
  try {
    if (xUrl) {
      result = await enrichWebXPost(bookmarkId, xUrl);
    } else {
      result = await enrichExternal(bookmarkId, url!, source);
    }
  } catch (err) {
    console.warn(`enrich ${bookmarkId} (${xUrl ?? url}): ${(err as Error).message}`);
    result = {
      url: (xUrl ?? url)!, kind: xUrl ? "x_post" : "other", title: null, site_name: null,
      description: null, og_image_url: null, content: null, status: "failed",
    };
  }

  const ogImagePath = result.og_image_url ? await downloadOgImage(bookmarkId, result.og_image_url) : null;

  await upsertLinkContent({
    bookmark_id: bookmarkId,
    url: result.url,
    kind: result.kind,
    title: result.title,
    site_name: result.site_name,
    description: result.description,
    og_image_path: ogImagePath,
    content: result.content,
    status: result.status,
  });
}

// Backfill: enrich bookmarks that don't have a link_content row yet.
export async function backfillEnrichment(limit = 25): Promise<number> {
  const { rows } = await pool.query(
    `select b.id::text as id, b.urls, b.source
     from bookmarks b
     left join link_content lc on lc.bookmark_id = b.id
     where lc.bookmark_id is null
     order by b.saved_at desc
     limit $1`,
    [limit],
  );
  for (const row of rows) {
    await enrichBookmark(row.id, row.urls, row.source);
  }
  return rows.length;
}
