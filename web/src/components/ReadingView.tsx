"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import type { BookmarkDetail } from "@/lib/types";
import { savedXPostUrl } from "@/lib/xpost";
import AppHeader from "./AppHeader";
import ShareButton from "./ShareButton";
import { fmtCount } from "./BookmarkCard";

// GitHub READMEs use repo-relative paths (assets/x.png, ../../actions/…/badge.svg).
// Resolve them against the repo: raw/HEAD for images, blob/HEAD for links —
// both redirect to the default branch, so we never need to know its name.
function githubUrlTransform(repoUrl: string) {
  const root = repoUrl.replace(/\/+$/, "");
  return (url: string, key: string) => {
    if (!/^(https?:|data:|#|mailto:)/i.test(url)) {
      try {
        url = new URL(url, `${root}/${key === "src" ? "raw" : "blob"}/HEAD/`).toString();
      } catch {
        /* leave as-is */
      }
    }
    return defaultUrlTransform(url);
  };
}

function tsToSeconds(ts: string): number {
  return ts.split(":").reduce((acc, part) => acc * 60 + (parseInt(part, 10) || 0), 0);
}

// Wrap query-term matches in <mark>. The capture group makes matches land on
// odd indices of the split — no stateful regex .test() needed.
function markTerms(text: string, terms: string[]): React.ReactNode {
  if (terms.length === 0) return text;
  const re = new RegExp(`(${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
  return text.split(re).map((part, i) => (i % 2 === 1 ? <mark key={i}>{part}</mark> : part));
}

// Transcript with seekable timecodes. When search terms are present, the
// best-matching paragraph is tinted and scrolled into view; every [m:ss]
// marker jumps the embedded player to that spot.
function VideoTranscript({
  content,
  terms,
  onSeek,
}: {
  content: string;
  terms: string[];
  onSeek: (seconds: number) => void;
}) {
  const bestRef = useRef<HTMLParagraphElement>(null);

  const paras = useMemo(
    () =>
      content.split(/\n+/).map((p) => {
        const m = p.match(/^\[([\d:]+)\]\s*(.*)$/);
        return { ts: m?.[1] ?? null, text: m?.[2] ?? p };
      }),
    [content],
  );

  // best paragraph = most query-term occurrences (0 hits = no highlight —
  // semantic-only matches have nothing literal to mark)
  const bestIdx = useMemo(() => {
    let idx = -1;
    let best = 0;
    if (terms.length > 0) {
      paras.forEach((p, i) => {
        const lower = p.text.toLowerCase();
        const score = terms.reduce((n, t) => n + (lower.split(t).length - 1), 0);
        if (score > best) {
          best = score;
          idx = i;
        }
      });
    }
    return idx;
  }, [paras, terms]);

  useEffect(() => {
    if (bestRef.current) bestRef.current.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [bestIdx]);

  return (
    <>
      {paras.map((p, i) => (
        <p key={i} ref={i === bestIdx ? bestRef : undefined} className={i === bestIdx ? "tr-hit" : undefined}>
          {p.ts && (
            <button className="tr-ts" title="Jump the video here" onClick={() => onSeek(tsToSeconds(p.ts!))}>
              {p.ts}
            </button>
          )}{" "}
          {markTerms(p.text, terms)}
        </p>
      ))}
    </>
  );
}

async function patch(id: string, body: Record<string, unknown>) {
  const res = await fetch(`/api/bookmarks/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`save failed (${res.status})`);
  return res.json();
}

function PostText({ b }: { b: BookmarkDetail }) {
  let text = b.text;
  for (const u of b.urls ?? []) {
    text = text.replace(/https:\/\/t\.co\/\w+/, u.expanded_url);
  }
  const parts = text.split(/(https?:\/\/\S+)/g);
  return (
    <div className="post-text">
      {parts.map((part, i) =>
        /^https?:\/\//.test(part) ? (
          <a key={i} href={part} target="_blank" rel="noopener noreferrer">
            {part.length > 60 ? `${part.slice(0, 57)}…` : part}
          </a>
        ) : (
          part
        ),
      )}
    </div>
  );
}

export default function ReadingView({ id }: { id: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const playerRef = useRef<HTMLIFrameElement>(null);
  const [b, setB] = useState<BookmarkDetail | null>(null);

  // search terms carried over from the reader (?q=) — used to highlight the
  // matching transcript section; short words would mark noise
  const query = (searchParams.get("q") ?? "").trim();
  const terms = useMemo(
    () => query.toLowerCase().split(/\s+/).filter((t) => t.length >= 3).slice(0, 8),
    [query],
  );

  // control the embedded player (enablejsapi) without reloading it
  const seekVideo = (seconds: number) => {
    const w = playerRef.current?.contentWindow;
    if (!w) return;
    w.postMessage(JSON.stringify({ event: "command", func: "seekTo", args: [seconds, true] }), "*");
    w.postMessage(JSON.stringify({ event: "command", func: "playVideo", args: [] }), "*");
    playerRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  };
  const [error, setError] = useState<string | null>(null);
  const [notesDraft, setNotesDraft] = useState("");
  const [tagDraft, setTagDraft] = useState("");

  useEffect(() => {
    fetch(`/api/bookmarks/${id}`)
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json()).error ?? `HTTP ${r.status}`);
        return r.json();
      })
      .then((data: BookmarkDetail) => {
        setB(data);
        setNotesDraft(data.notes ?? "");
      })
      .catch((err) => setError(err.message));
  }, [id]);

  if (error) return <><AppHeader /><div className="reading-wrap"><p>⚠ {error}</p></div></>;
  if (!b) return <><AppHeader /><div className="reading-wrap"><p style={{ color: "var(--text-dim)" }}>Loading…</p></div></>;

  const unread = !b.read_at;
  const isExternal = b.source !== "x"; // web save, YouTube, … — no X post behind it
  const isYoutube = b.source === "youtube";
  const xSaveUrl = savedXPostUrl(b); // web save of an X post — hydrated from syndication
  const pageUrl = b.link?.url || b.urls?.[0]?.expanded_url || "#";
  const postUrl = xSaveUrl ?? (isExternal ? pageUrl : `https://x.com/${b.username ?? "i"}/status/${b.id}`);
  const siteName = b.link?.site_name ?? (pageUrl !== "#" ? new URL(pageUrl).hostname.replace(/^www\./, "") : "web");
  const youtubeVideoId = isYoutube && pageUrl !== "#" ? new URL(pageUrl).searchParams.get("v") : null;
  const quoted = (b.referenced ?? []).filter((r) => r.type === "quoted" && r.text);
  const repliedTo = (b.referenced ?? []).filter((r) => r.type === "replied_to");
  // video as the main content deserves more room than article reading width;
  // portrait clips gain nothing from a wider column, so only landscape counts
  const wideVideo =
    Boolean(youtubeVideoId) ||
    b.media.some(
      (m) => (m.type === "video" || m.type === "animated_gif") && (m.width ?? 0) > (m.height ?? 0),
    );

  const toggleArchive = async () => {
    const updated = await patch(b.id, { read: unread });
    setB({ ...b, read_at: updated.read_at });
  };

  const deleteBookmark = async () => {
    if (!window.confirm("Delete this bookmark and its media from the archive? This can't be undone.")) return;
    const res = await fetch(`/api/bookmarks/${b.id}`, { method: "DELETE" });
    if (res.ok) {
      router.push("/");
    } else {
      setError((await res.json()).error ?? `HTTP ${res.status}`);
    }
  };

  const saveNotes = async () => {
    const val = notesDraft.trim() || null;
    if (val === (b.notes ?? null)) return;
    await patch(b.id, { notes: val });
    setB({ ...b, notes: val });
  };

  const addTag = async () => {
    const t = tagDraft.trim().toLowerCase();
    setTagDraft("");
    if (!t || b.tags.includes(t)) return;
    const tags = [...b.tags, t];
    await patch(b.id, { tags });
    setB({ ...b, tags });
  };

  const removeTag = async (t: string) => {
    const tags = b.tags.filter((x) => x !== t);
    await patch(b.id, { tags });
    setB({ ...b, tags });
  };

  return (
    <>
    <AppHeader />
    <div className={"reading-wrap" + (wideVideo ? " wide" : "")}>
      <div className="reading-actions">
        <button className="btn" onClick={() => router.back()}>← Back</button>
        <a className="btn" href={postUrl} target="_blank" rel="noopener noreferrer">
          {isYoutube ? "Watch on YouTube ↗" : isExternal && !xSaveUrl ? "Open page ↗" : "Open on X ↗"}
        </a>
        {/* the post's external link (article, repo, …) when it isn't the post itself */}
        {b.link && (xSaveUrl ? b.link.url !== xSaveUrl : !isExternal) && (
          <a className="btn" href={b.link.url} target="_blank" rel="noopener noreferrer">
            View original ↗
          </a>
        )}
        <ShareButton variant="btn" title={b.link?.title ?? b.text.slice(0, 80)} url={b.link?.kind === "article" || b.link?.kind === "github" ? b.link.url : postUrl} />
        <button className={`btn ${unread ? "primary" : ""}`} onClick={toggleArchive}>
          {unread ? "✓ Archive" : "↩ Re-add to Saves"}
        </button>
        <button className="btn danger" onClick={deleteBookmark} title="Delete this bookmark and its media">
          Delete
        </button>
      </div>

      <div className="post-block">
        {repliedTo.map((r) => (
          <a
            key={r.id}
            className="reply-context"
            href={`https://x.com/${r.author_username ?? "i"}/status/${r.id}`}
            target="_blank"
            rel="noopener noreferrer"
            title="Open the original post on X"
          >
            <span className="rc-label">↩ In reply to {r.author_username ? `@${r.author_username}` : "a post"}</span>
            {r.text ? (
              <span className="rc-text">{r.text}</span>
            ) : (
              <span className="rc-text rc-missing">Original post unavailable (deleted or protected)</span>
            )}
          </a>
        ))}
        <div className="post-head">
          {b.profile_image_url && <img src={b.profile_image_url} alt="" />}
          <div className="who">
            {/* hydrated X-post saves have a real author row — show it like a native post */}
            <span className="name">{isExternal && !b.username ? siteName : (b.author_name ?? b.username ?? "unknown")}</span>
            {b.username && <span className="handle">@{b.username}</span>}
          </div>
          <span className="date">
            {b.source === "web" && (
              <span className="src-badge">{xSaveUrl ? "🔖 Saved from X" : "🌐 Web save"}</span>
            )}
            {isYoutube && <span className="src-badge">▶ YouTube</span>}
            {b.liked && <span className="src-badge">♥ {b.bookmarked ? "Liked + Saved" : "Liked"}</span>}
            {new Date(b.created_at).toLocaleDateString()}
          </span>
        </div>

        {/* x_article: text duplicates the article body (kept for search/embeddings) — content renders below.
            x_post with content = oEmbed fallback, where text is still the noisy share-sheet title;
            hydrated saves (content null) carry the real post text and render it like a native post */}
        {b.link?.kind !== "x_article" && !(b.link?.kind === "x_post" && b.content) && <PostText b={b} />}

        {youtubeVideoId && (
          <div className="video-embed">
            <iframe
              ref={playerRef}
              src={`https://www.youtube-nocookie.com/embed/${youtubeVideoId}?enablejsapi=1`}
              title={b.link?.title ?? "YouTube video"}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
            />
          </div>
        )}

        {b.media.length > 0 && (
          <div className="post-media">
            {b.media.map((m) =>
              m.local_path ? (
                m.type === "photo" ? (
                  <img key={m.media_key} src={`/api/media/${m.local_path}`} alt={m.alt_text ?? ""} />
                ) : (
                  <video
                    key={m.media_key}
                    src={`/api/media/${m.local_path}`}
                    controls
                    preload="metadata"
                    playsInline
                    loop={m.type === "animated_gif"}
                    muted={m.type === "animated_gif"}
                  />
                )
              ) : null,
            )}
          </div>
        )}

        {quoted.map((q) => (
          <div key={q.id} className="quoted">
            {q.author_username && <span className="q-author">@{q.author_username}</span>}
            {q.text}
          </div>
        ))}

        {b.metrics && (
          <a className="post-metrics" href={postUrl} target="_blank" rel="noopener noreferrer"
             title="Open replies on X">
            <span>♥ {fmtCount(b.metrics.like_count ?? 0)}</span>
            <span>💬 {fmtCount(b.metrics.reply_count ?? 0)} replies</span>
            <span>🔁 {fmtCount(b.metrics.retweet_count ?? 0)}</span>
            <span className="read-replies">Read replies on X ↗</span>
          </a>
        )}
      </div>

      {b.content && b.link && (
        <>
          <div className="content-header">
            <span className="src">
              {b.link.kind === "github" ? "README · " : b.link.kind === "video" ? "Transcript · " : b.link.kind === "x_post" || b.link.kind === "reddit" ? "Post · " : "Article · "}
              {b.link.site_name ?? new URL(b.link.url).hostname.replace(/^www\./, "")}
            </span>
            {/* video: the title already heads the post block right above */}
            {b.link.title && b.link.kind !== "video" && <h2>{b.link.title}</h2>}
          </div>
          <div className="reading-content">
            {b.link.kind === "github" ? (
              <ReactMarkdown remarkPlugins={[remarkGfm]} urlTransform={githubUrlTransform(b.link.url)}>
                {b.content}
              </ReactMarkdown>
            ) : b.link.kind === "reddit" ? (
              // post body + top comments, markdown from the reddit API
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{b.content}</ReactMarkdown>
            ) : b.link.kind === "x_article" || b.link.kind === "x_post" ? (
              // plain text (X API plain_text / oEmbed post text) — render paragraphs
              b.content.split(/\n+/).map((p, i) => <p key={i}>{p}</p>)
            ) : b.link.kind === "video" ? (
              <VideoTranscript content={b.content} terms={terms} onSeek={seekVideo} />
            ) : (
              // sanitized at ingest with sanitize-html (poller/src/enrich.ts)
              <div dangerouslySetInnerHTML={{ __html: b.content }} />
            )}
          </div>
        </>
      )}

      <div className="annotations">
        <h3>Tags</h3>
        <div className="tag-row">
          {b.tags.map((t) => (
            <span key={t} className="tag-chip">
              {t}
              <button onClick={() => removeTag(t)} title="remove">×</button>
            </span>
          ))}
          <input
            className="tag-input"
            value={tagDraft}
            onChange={(e) => setTagDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addTag()}
            onBlur={() => tagDraft && addTag()}
            placeholder="+ tag"
          />
        </div>
        <h3>Notes</h3>
        <textarea
          className="notes"
          value={notesDraft}
          onChange={(e) => setNotesDraft(e.target.value)}
          onBlur={saveNotes}
          placeholder="Your notes… (saved when you click away)"
        />
      </div>
    </div>
    </>
  );
}
