// Weekly digest ("The Weekly Bookmark"): turns the week's saved posts into a
// newspaper-style edition, stored as one row in `digests`.
//
// Rules:
// - the period starts where the previous edition ended (first edition: 7 days
//   back), so nothing falls through the cracks if a week is missed
// - LLM copy (summaries, ledes, editor's note) is best-effort: any failure
//   falls back to raw excerpts — generation itself never fails on LLM trouble
// - content stores only post ids + editorial copy; the web app re-joins live
//   bookmark data at render time
import { pool } from "./db.js";
import { chatComplete } from "./llm.js";

const MAX_POSTS = 24; // articles per edition, lead excluded (huge backlog weeks get "and N more")

interface WeekPost {
  id: string;
  text: string;
  tags: string[];
  bookmarked: boolean;
  liked: boolean;
  username: string | null;
  author_name: string | null;
  link_title: string | null;
  link_description: string | null;
  like_count: number;
  has_video: boolean;
  has_photo: boolean;
  has_link: boolean;
}

export interface DigestSection {
  title: string;
  lede: string | null;
  posts: Array<{ id: string; summary: string | null }>;
}

export interface DigestContent {
  headline: string | null;
  editorsNote: string | null;
  lead: { id: string; summary: string | null } | null;
  sections: DigestSection[];
  likes: Array<{ id: string }>; // liked-only posts — rail box, not articles
  archive: { id: string } | null;
  stats: {
    total: number;
    bookmarks: number;
    likes: number;
    videos: number;
    photos: number;
    links: number;
    topTags: Array<{ tag: string; count: number }>;
    topAuthor: { username: string; count: number } | null;
  };
  omitted: number;
}

// Progress for the web UI. Best-effort: a failed status write must never
// kill a generation run.
async function setProgress(running: boolean, note: string | null): Promise<void> {
  try {
    await pool.query(
      `insert into digest_state (id, running, note, started_at, updated_at)
       values (1, $1, $2, now(), now())
       on conflict (id) do update set
         running = $1,
         note = $2,
         started_at = case when $1 and not digest_state.running then now() else digest_state.started_at end,
         updated_at = now()`,
      [running, note],
    );
  } catch (err) {
    console.warn(`digest progress: ${(err as Error).message}`);
  }
}

async function weekPosts(start: Date, end: Date): Promise<WeekPost[]> {
  const { rows } = await pool.query(
    `select b.id::text as id, b.text, b.tags, b.bookmarked, b.liked,
            a.username, a.name as author_name,
            lc.title as link_title, lc.description as link_description,
            coalesce((b.metrics->>'like_count')::int, 0) as like_count,
            exists (select 1 from media m where m.bookmark_id = b.id and m.type in ('video','animated_gif')) as has_video,
            exists (select 1 from media m where m.bookmark_id = b.id and m.type = 'photo') as has_photo,
            (lc.bookmark_id is not null) as has_link
     from bookmarks b
     left join authors a on a.id = b.author_id
     left join link_content lc on lc.bookmark_id = b.id and lc.status in ('ok', 'no_content')
     where b.saved_at > $1 and b.saved_at <= $2
     order by b.saved_at desc`,
    [start, end],
  );
  return rows;
}

function postContext(p: WeekPost): string {
  return [
    p.author_name || p.username ? `Author: ${p.author_name ?? ""} ${p.username ? `(@${p.username})` : ""}`.trim() : null,
    p.text,
    p.link_title ? `Linked page: ${p.link_title}` : null,
    p.link_description,
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, 4000);
}

async function summarizePost(p: WeekPost): Promise<string | null> {
  const out = await chatComplete(
    "You write blurbs for a personal weekly digest of posts saved from X. " +
      "Reply with ONLY the blurb: 1-2 plain sentences stating what the post is about and what makes it interesting. " +
      "No quotes, no emojis, no preamble, no markdown.",
    postContext(p),
  );
  if (!out) return null;
  const blurb = out.replace(/^["“]|["”]$/g, "").trim();
  return blurb ? blurb.slice(0, 400) : null;
}

async function sectionLede(title: string, posts: Array<{ summary: string | null }>, fallbackTexts: string[]): Promise<string | null> {
  const items = posts.map((p, i) => p.summary ?? fallbackTexts[i]).filter(Boolean).slice(0, 8);
  if (items.length < 3) return null; // a lede over 2 items reads silly
  const out = await chatComplete(
    "You write one-sentence section intros for a personal weekly digest, like a newspaper section lede. " +
      "Reply with ONLY the sentence. Plain text, no quotes, no emojis.",
    `Section: ${title}\nItems:\n${items.map((s) => `- ${s!.slice(0, 200)}`).join("\n")}`,
  );
  return out ? out.slice(0, 300) : null;
}

async function editorial(sections: DigestSection[], leadSummary: string | null): Promise<{ headline: string | null; note: string | null }> {
  const overview = [
    leadSummary ? `Lead story: ${leadSummary}` : null,
    ...sections.map((s) => `Section "${s.title}" (${s.posts.length} items)${s.lede ? `: ${s.lede}` : ""}`),
  ]
    .filter(Boolean)
    .join("\n");
  const out = await chatComplete(
    "You are the editor of a one-reader weekly digest of posts saved from X. " +
      'Reply with ONLY a JSON object: {"headline": "...", "note": "..."}. ' +
      "headline: a short punchy title for this week's edition (max 8 words, no week numbers or dates). " +
      "note: a 2-3 sentence editor's note teasing the week's themes, addressed to the reader as 'you'.",
    overview,
  );
  // take the LAST JSON object in the reply (thinking models may emit several)
  const matches = out?.match(/\{[\s\S]*?\}/g);
  if (matches) {
    try {
      const obj = JSON.parse(matches[matches.length - 1]);
      return {
        headline: typeof obj.headline === "string" ? obj.headline.slice(0, 120) : null,
        note: typeof obj.note === "string" ? obj.note.slice(0, 600) : null,
      };
    } catch {
      /* fall through */
    }
  }
  return { headline: null, note: null };
}

// Section title from a tag: "dev-tools" → "Dev Tools", "ai" → "AI".
function sectionTitle(tag: string): string {
  return tag
    .split("-")
    .map((w) => (w.length <= 2 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1)))
    .join(" ");
}

// Group posts into sections by tag: most frequent tags claim their posts
// first; tags left with a single post pool into "Miscellany".
function groupSections(posts: WeekPost[]): Array<{ title: string; posts: WeekPost[] }> {
  const tagCounts = new Map<string, number>();
  for (const p of posts) for (const t of p.tags) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
  const tagsByFreq = [...tagCounts.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t);

  const assigned = new Set<string>();
  const groups: Array<{ title: string; posts: WeekPost[] }> = [];
  for (const tag of tagsByFreq) {
    const members = posts.filter((p) => !assigned.has(p.id) && p.tags.includes(tag));
    if (members.length < 2) continue;
    members.forEach((p) => assigned.add(p.id));
    groups.push({ title: sectionTitle(tag), posts: members });
  }
  const leftovers = posts.filter((p) => !assigned.has(p.id));
  if (leftovers.length > 0) groups.push({ title: "Miscellany", posts: leftovers });
  return groups.sort((a, b) => b.posts.length - a.posts.length);
}

// One older bookmark thematically closest to this week's centroid.
async function archivePick(start: Date, end: Date): Promise<{ id: string } | null> {
  const { rows } = await pool.query(
    `with wk as (
       select avg(embedding) as c from bookmarks
       where saved_at > $1 and saved_at <= $2 and embedding is not null
     )
     select b.id::text as id
     from bookmarks b, wk
     where wk.c is not null
       and b.embedding is not null
       and b.saved_at < $1::timestamptz - interval '30 days'
     order by b.embedding <=> wk.c
     limit 1`,
    [start, end],
  );
  return rows[0] ? { id: rows[0].id } : null;
}

function buildStats(posts: WeekPost[]): DigestContent["stats"] {
  const tagCounts = new Map<string, number>();
  const authorCounts = new Map<string, number>();
  for (const p of posts) {
    for (const t of p.tags) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
    if (p.username) authorCounts.set(p.username, (authorCounts.get(p.username) ?? 0) + 1);
  }
  const topAuthor = [...authorCounts.entries()].sort((a, b) => b[1] - a[1])[0];
  return {
    total: posts.length,
    bookmarks: posts.filter((p) => p.bookmarked).length,
    likes: posts.filter((p) => p.liked).length,
    videos: posts.filter((p) => p.has_video).length,
    photos: posts.filter((p) => p.has_photo).length,
    links: posts.filter((p) => p.has_link).length,
    topTags: [...tagCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([tag, count]) => ({ tag, count })),
    topAuthor: topAuthor ? { username: topAuthor[0], count: topAuthor[1] } : null,
  };
}

function excerpt(p: WeekPost): string {
  const line = (p.link_title ?? p.text).replace(/https?:\/\/\S+/g, "").trim();
  return line.slice(0, 200);
}

// Generate the next edition. Returns the new issue number, or null when
// there was nothing to publish.
export async function generateDigest(): Promise<number | null> {
  await setProgress(true, "collecting the week's posts");
  try {
    const { rows: prev } = await pool.query("select period_end from digests order by id desc limit 1");
    const end = new Date();
    const start: Date = prev[0]?.period_end ?? new Date(end.getTime() - 7 * 24 * 3600 * 1000);

    const all = await weekPosts(start, end);
    if (all.length === 0) {
      console.log("digest: no new posts this period — skipping");
      return null;
    }

    // Articles come from deliberate saves only; casual likes get a rail box.
    const saved = all.filter((p) => p.bookmarked);
    const likedOnly = all
      .filter((p) => p.liked && !p.bookmarked)
      .sort((a, b) => b.like_count - a.like_count);

    // lead story = most engaged bookmark; the rest by engagement up to the cap
    const byEngagement = [...saved].sort((a, b) => b.like_count - a.like_count);
    const lead = byEngagement[0] ?? null;
    const rest = byEngagement.slice(1, 1 + MAX_POSTS);
    const omitted = Math.max(0, saved.length - 1 - rest.length);
    if (omitted > 0) console.log(`digest: ${saved.length} bookmarks this period, including top ${1 + rest.length} (${omitted} omitted)`);

    const total = (lead ? 1 : 0) + rest.length;
    console.log(`digest: summarizing ${total} posts via LLM (${likedOnly.length} liked-only in the rail)`);
    await setProgress(true, `writing blurbs (1/${total})`);
    const leadSummary = lead ? await summarizePost(lead) : null;
    const summaries = new Map<string, string | null>();
    for (const [i, p] of rest.entries()) {
      await setProgress(true, `writing blurbs (${i + 2}/${total})`);
      summaries.set(p.id, await summarizePost(p));
    }

    const sections: DigestSection[] = [];
    for (const g of groupSections(rest)) {
      await setProgress(true, `writing the ${g.title} section`);
      const posts = g.posts.map((p) => ({ id: p.id, summary: summaries.get(p.id) ?? null }));
      const lede = await sectionLede(g.title, posts, g.posts.map(excerpt));
      sections.push({ title: g.title, lede, posts });
    }

    await setProgress(true, "writing the editor's note");
    const { headline, note } = await editorial(sections, leadSummary);

    const content: DigestContent = {
      headline,
      editorsNote: note,
      lead: lead ? { id: lead.id, summary: leadSummary } : null,
      sections,
      likes: likedOnly.map((p) => ({ id: p.id })),
      archive: await archivePick(start, end),
      stats: buildStats(all),
      omitted,
    };

    const { rows } = await pool.query(
      "insert into digests (period_start, period_end, content) values ($1, $2, $3) returning id",
      [start, end, JSON.stringify(content)],
    );
    console.log(`digest: published issue #${rows[0].id} (${all.length} posts, ${sections.length} sections)`);
    return rows[0].id;
  } finally {
    await setProgress(false, null);
  }
}

// True when the latest edition is overdue (poller was down at cron time, or
// no edition exists yet) — checked on boot.
export async function digestOverdue(): Promise<boolean> {
  const { rows } = await pool.query("select generated_at from digests order by id desc limit 1");
  if (!rows[0]) return true;
  return Date.now() - new Date(rows[0].generated_at).getTime() > 7.5 * 24 * 3600 * 1000;
}
