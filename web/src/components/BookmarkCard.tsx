"use client";

import { useRouter } from "next/navigation";
import type { BookmarkWithLink } from "@/lib/types";
import { savedXPostUrl } from "@/lib/xpost";
import ShareButton from "./ShareButton";
import { BookmarkIcon } from "./icons";

type CardMedia =
  | { type: "image"; src: string; alt: string }
  | { type: "video"; src: string }
  | null;

function cardMedia(b: BookmarkWithLink): CardMedia {
  const photo = b.media.find((m) => m.type === "photo" && m.local_path);
  if (photo) return { type: "image", src: `/api/media/${photo.local_path}`, alt: photo.alt_text ?? "" };
  const video = b.media.find((m) => (m.type === "video" || m.type === "animated_gif") && m.local_path);
  if (video) return { type: "video", src: `/api/media/${video.local_path}` };
  if (b.link?.og_image_path) return { type: "image", src: `/api/media/${b.link.og_image_path}`, alt: b.link.title ?? "" };
  return null;
}

function cardTitle(b: BookmarkWithLink): string {
  if (b.link?.title) return b.link.title;
  const line = b.text.replace(/https?:\/\/\S+/g, "").trim();
  return line.length > 90 ? `${line.slice(0, 87)}…` : line || "(media post)";
}

function cardExcerpt(b: BookmarkWithLink): string | null {
  if (b.link?.title) {
    // title came from the link — show the post text as the excerpt
    return b.link.description ?? b.text.replace(/https?:\/\/\S+/g, "").trim() ?? null;
  }
  const line = b.text.replace(/https?:\/\/\S+/g, "").trim();
  return line.length > 90 ? line : null; // title already shows it all
}

export function fmtCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return String(n);
}

async function patchRead(id: string, read: boolean) {
  await fetch(`/api/bookmarks/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ read }),
  });
}

export default function BookmarkCard({
  bookmark: b,
  onArchiveToggle,
  searchQuery,
}: {
  bookmark: BookmarkWithLink;
  onArchiveToggle: (id: string, nowRead: boolean) => void;
  // active search — carried to the reading view so it can highlight and
  // scroll to the matching transcript/content section
  searchQuery?: string;
}) {
  const router = useRouter();
  const unread = !b.read_at;
  const media = cardMedia(b);
  const isExternal = b.source !== "x"; // web save, YouTube, … — no X post behind it
  const isYoutube = b.source === "youtube";
  const replyTo = isExternal ? undefined : (b.referenced ?? []).find((r) => r.type === "replied_to");
  const xSaveUrl = savedXPostUrl(b);
  const pageUrl = b.link?.url || b.urls?.[0]?.expanded_url || "#";
  const postUrl = xSaveUrl ?? (isExternal ? pageUrl : `https://x.com/${b.username ?? "i"}/status/${b.id}`);
  const site =
    b.link?.site_name ??
    ((b.link?.url || (isExternal && b.urls?.[0]?.expanded_url))
      ? new URL(b.link?.url || b.urls![0].expanded_url).hostname.replace(/^www\./, "")
      : null);

  const toggleArchive = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await patchRead(b.id, unread);
    onArchiveToggle(b.id, unread);
  };

  return (
    <article
      className="card"
      onClick={() => router.push(`/b/${b.id}${searchQuery ? `?q=${encodeURIComponent(searchQuery)}` : ""}`)}
    >
      <span
        className="src-badge-mini"
        title={
          isYoutube ? "From a YouTube playlist"
          : xSaveUrl ? "X post saved from the web"
          : isExternal ? "Saved from the web"
          : b.bookmarked ? (b.liked ? "Saved + liked" : "Saved") : "Liked"
        }
      >
        {isYoutube ? "▶" : xSaveUrl ? "🔖" : isExternal ? "🌐" : b.bookmarked ? "🔖" : "♥"}
      </span>
      {media?.type === "image" ? (
        <img className="card-img" src={media.src} alt={media.alt} loading="lazy" />
      ) : media?.type === "video" ? (
        <div className="card-video-wrap">
          {/* #t=0.001 forces browsers to actually paint the first frame
              (bare preload=metadata loads dimensions but renders blank) */}
          <video
            className="card-img"
            src={`${media.src}#t=0.001`}
            preload="metadata"
            muted
            playsInline
            loop
            onMouseEnter={(e) => e.currentTarget.play().catch(() => {})}
            onMouseLeave={(e) => {
              e.currentTarget.pause();
              e.currentTarget.currentTime = 0.001;
            }}
          />
          <span className="play-badge">▶</span>
        </div>
      ) : (
        <div
          className="card-img-placeholder"
          // author's profile banner behind the avatar, dimmed slightly for contrast
          style={
            b.profile_banner_url
              ? { backgroundImage: `linear-gradient(rgba(0,0,0,0.16), rgba(0,0,0,0.16)), url(${b.profile_banner_url}/600x200)` }
              : undefined
          }
        >
          {b.profile_image_url ? (
            <img src={b.profile_image_url.replace("_normal", "_200x200")} alt="" loading="lazy" />
          ) : (
            <span className="card-glyph"><BookmarkIcon size={34} /></span>
          )}
        </div>
      )}

      <div className="card-body">
        {replyTo && (
          <div className="card-reply-hint">
            ↩ replying to {replyTo.author_username ? `@${replyTo.author_username}` : "a post"}
          </div>
        )}
        <div className="card-title">{cardTitle(b)}</div>
        {cardExcerpt(b) && <div className="card-excerpt">{cardExcerpt(b)}</div>}
        {(site || b.link?.kind === "github") && (
          <div className="card-site">
            {b.link?.kind === "github" && <span className="kind-badge">README</span>}
            {b.link?.kind === "article" && b.link.has_content && <span className="kind-badge">Article</span>}
            {b.link?.kind === "x_article" && <span className="kind-badge">X Article</span>}
            {b.link?.kind === "x_post" && <span className="kind-badge">X Post</span>}
            {b.link?.kind === "reddit" && <span className="kind-badge">Reddit</span>}
            {b.link?.kind === "video" && <span className="kind-badge">▶ Video</span>}
            <span>{b.link?.kind === "x_article" || (b.link?.kind === "x_post" && b.username) ? `@${b.username}` : site}</span>
          </div>
        )}
      </div>

      {b.tags.length > 0 && (
        <div className="card-tags">
          {b.tags.map((t) => (
            <span key={t} className="mini-tag">{t}</span>
          ))}
        </div>
      )}

      <div className="card-foot">
        {b.profile_image_url && <img className="avatar" src={b.profile_image_url} alt="" loading="lazy" />}
        <span className="handle">
          {isExternal ? (site ?? b.source) : `@${b.username ?? "unknown"}`} · {new Date(b.created_at).toLocaleDateString()}
        </span>
        <span className="spacer" />
        {b.metrics && (
          <a
            className="metrics"
            href={postUrl}
            target="_blank"
            rel="noopener noreferrer"
            title="Open replies on X"
            onClick={(e) => e.stopPropagation()}
          >
            ♥ {fmtCount(b.metrics.like_count ?? 0)} · 💬 {fmtCount(b.metrics.reply_count ?? 0)}
          </a>
        )}
        <ShareButton title={cardTitle(b)} url={b.link?.kind === "article" || b.link?.kind === "github" ? b.link.url : postUrl} />
        <a
          className="act"
          href={postUrl}
          target="_blank"
          rel="noopener noreferrer"
          title={isYoutube ? "Watch on YouTube" : isExternal ? "Open page" : "Open on X"}
          onClick={(e) => e.stopPropagation()}
        >
          ↗
        </a>
        <button className="act" onClick={toggleArchive} title={unread ? "Archive" : "Move back to Saves"}>
          {unread ? "✓" : "↩"}
        </button>
      </div>
    </article>
  );
}
