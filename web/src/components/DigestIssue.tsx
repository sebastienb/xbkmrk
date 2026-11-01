import Link from "next/link";
import type { DigestIssue, DigestPostRef } from "@/lib/digest";
import type { BookmarkWithLink } from "@/lib/types";
import GenerateDigestButton from "./GenerateDigestButton";

// Server-rendered newspaper front page for one digest edition.

function articleTitle(b: BookmarkWithLink, max = 110): string {
  if (b.link?.title) return b.link.title;
  const line = b.text.replace(/https?:\/\/\S+/g, "").trim();
  return line.length > max ? `${line.slice(0, max - 3)}…` : line || "(media post)";
}

// LLM blurb when we have it, otherwise the post text (unless the title
// already shows all of it).
function articleBlurb(b: BookmarkWithLink, ref: DigestPostRef): string | null {
  if (ref.summary) return ref.summary;
  if (b.link?.title) return b.link.description ?? null;
  const line = b.text.replace(/https?:\/\/\S+/g, "").trim();
  return line.length > 110 ? `${line.slice(0, 280)}${line.length > 280 ? "…" : ""}` : null;
}

function heroMedia(b: BookmarkWithLink) {
  const photo = b.media.find((m) => m.type === "photo" && m.local_path);
  if (photo) return <img className="np-hero" src={`/api/media/${photo.local_path}`} alt={photo.alt_text ?? ""} />;
  const video = b.media.find((m) => (m.type === "video" || m.type === "animated_gif") && m.local_path);
  if (video) {
    // #t=0.001 forces browsers to actually paint the first frame
    return <video className="np-hero" src={`/api/media/${video.local_path}#t=0.001`} preload="metadata" muted playsInline controls />;
  }
  if (b.link?.og_image_path) return <img className="np-hero" src={`/api/media/${b.link.og_image_path}`} alt="" />;
  return null;
}

// Still image for a section article (photos and og cards only — no videos,
// they'd weigh the page down).
function thumbSrc(b: BookmarkWithLink): string | null {
  const photo = b.media.find((m) => m.type === "photo" && m.local_path);
  if (photo) return `/api/media/${photo.local_path}`;
  if (b.link?.og_image_path) return `/api/media/${b.link.og_image_path}`;
  return null;
}

function Byline({ b }: { b: BookmarkWithLink }) {
  const likes = b.metrics?.like_count;
  return (
    <div className="np-byline">
      {b.profile_image_url && <img src={b.profile_image_url} alt="" />}
      <span>
        {b.author_name ?? b.username ?? "unknown"}
        {b.username && <> · @{b.username}</>}
        {typeof likes === "number" && likes > 0 && <> · ♥ {likes.toLocaleString()}</>}
      </span>
    </div>
  );
}

function Article({ b, ref_, lead = false, thumb }: { b: BookmarkWithLink; ref_: DigestPostRef; lead?: boolean; thumb?: string | null }) {
  const blurb = articleBlurb(b, ref_);
  return (
    <article className={lead ? "np-article np-lead-article" : "np-article"}>
      {lead && heroMedia(b)}
      {!lead && thumb && (
        <Link href={`/b/${b.id}`}>
          <img className="np-thumb" src={thumb} alt="" loading="lazy" />
        </Link>
      )}
      <h3 className="np-title">
        <Link href={`/b/${b.id}`}>{articleTitle(b, lead ? 200 : 110)}</Link>
      </h3>
      {blurb && <p className="np-blurb">{blurb}</p>}
      <Byline b={b} />
    </article>
  );
}

function fmtDay(d: string, withYear = false) {
  return new Date(d).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    ...(withYear ? { year: "numeric" } : {}),
  });
}

export default function DigestIssueView({ issue }: { issue: DigestIssue }) {
  const { content: c, posts } = issue;
  const lead = c.lead ? posts.get(c.lead.id) : null;
  const archive = c.archive ? posts.get(c.archive.id) : null;

  return (
    <div className="np-wrap">
      <header className="np-masthead">
        <div className="np-issue-line">
          <span>Issue №{issue.id}</span>
          <span>
            {fmtDay(issue.period_start)} – {fmtDay(issue.period_end, true)}
          </span>
        </div>
        <h1>The Weekly Bookmark</h1>
        {c.headline && <p className="np-headline">{c.headline}</p>}
        {c.editorsNote && <p className="np-editors-note">{c.editorsNote}</p>}
      </header>

      <div className="np-body">
        <div className="np-main">
          {lead && c.lead && <Article b={lead} ref_={c.lead} lead />}

          {c.sections.map((s) => {
            const items = s.posts.map((p) => ({ p, b: posts.get(p.id) })).filter((x) => x.b);
            if (items.length === 0) return null;
            // give the first couple of illustratable articles a thumbnail —
            // enough to breathe, not enough to turn into a mood board
            let thumbsLeft = 2;
            return (
              <section key={s.title} className="np-section">
                <h2 className="np-section-title">{s.title}</h2>
                {s.lede && <p className="np-lede">{s.lede}</p>}
                <div className="np-columns">
                  {items.map(({ p, b }) => {
                    const thumb = thumbsLeft > 0 ? thumbSrc(b!) : null;
                    if (thumb) thumbsLeft--;
                    return <Article key={p.id} b={b!} ref_={p} thumb={thumb} />;
                  })}
                </div>
              </section>
            );
          })}

          {c.omitted > 0 && (
            <p className="np-omitted">
              …plus {c.omitted} more saved this period — <Link href="/">browse the full feed</Link>.
            </p>
          )}
        </div>

        <aside className="np-rail">
          <div className="np-box">
            <h4>By the numbers</h4>
            <dl>
              <div><dt>{c.stats.total}</dt><dd>posts saved</dd></div>
              <div><dt>{c.stats.bookmarks}</dt><dd>bookmarks</dd></div>
              <div><dt>{c.stats.likes}</dt><dd>likes</dd></div>
              <div><dt>{c.stats.videos}</dt><dd>videos</dd></div>
              <div><dt>{c.stats.photos}</dt><dd>photos</dd></div>
              <div><dt>{c.stats.links}</dt><dd>links</dd></div>
            </dl>
            {c.stats.topTags.length > 0 && (
              <p className="np-box-line">
                Top topics: {c.stats.topTags.map((t) => `${t.tag} (${t.count})`).join(", ")}
              </p>
            )}
            {c.stats.topAuthor && (
              <p className="np-box-line">
                Most saved author: @{c.stats.topAuthor.username} ({c.stats.topAuthor.count})
              </p>
            )}
          </div>

          {(c.likes?.length ?? 0) > 0 && (
            <div className="np-box">
              <h4>Liked this week</h4>
              <ul className="np-likes">
                {c.likes!.slice(0, 10).map((l) => {
                  const b = posts.get(l.id);
                  if (!b) return null;
                  return (
                    <li key={l.id}>
                      <Link href={`/b/${l.id}`}>{articleTitle(b)}</Link>
                      {b.username && <span className="np-like-who"> @{b.username}</span>}
                    </li>
                  );
                })}
              </ul>
              {c.likes!.length > 10 && <p className="np-box-line">…plus {c.likes!.length - 10} more.</p>}
            </div>
          )}

          {archive && c.archive && (
            <div className="np-box">
              <h4>From the archive</h4>
              <Article b={archive} ref_={{ id: c.archive.id, summary: null }} />
              <p className="np-box-line">Saved {fmtDay(archive.saved_at, true)} — resurfaced because it fits this week&apos;s themes.</p>
            </div>
          )}
        </aside>
      </div>

      <footer className="np-footer">
        <div className="np-issue-nav">
          {issue.prevId ? <Link href={`/digest/${issue.prevId}`}>← Issue №{issue.prevId}</Link> : <span />}
          {issue.nextId ? <Link href={`/digest/${issue.nextId}`}>Issue №{issue.nextId} →</Link> : <span />}
        </div>
        <p>
          Printed {new Date(issue.generated_at).toLocaleString("en-US", { dateStyle: "long", timeStyle: "short" })} by the
          resident model. <GenerateDigestButton />
        </p>
      </footer>
    </div>
  );
}
