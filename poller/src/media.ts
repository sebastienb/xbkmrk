import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { env } from "./env.js";

// Media URLs on X rotate/expire — download at ingest and serve our own copy.
// Files land at data/media/<post_id>/<media_key>.<ext>; DB stores the
// path relative to the media root.

function pickUrl(media: any): string | null {
  if (media.type === "photo") {
    return media.url ?? media.preview_image_url ?? null;
  }
  // video / animated_gif: highest-bitrate mp4 variant, NOT the preview image
  const variants: any[] = media.variants ?? [];
  const mp4s = variants
    .filter((v) => v.content_type === "video/mp4" && v.url)
    .sort((a, b) => (b.bit_rate ?? 0) - (a.bit_rate ?? 0));
  return mp4s[0]?.url ?? media.preview_image_url ?? null;
}

function extFor(media: any, url: string): string {
  if (media.type !== "photo") return ".mp4";
  const m = new URL(url).pathname.match(/\.(\w{2,5})$/);
  return m ? `.${m[1]}` : ".jpg";
}

// Remove a deleted bookmark's files: its media directory and its og image.
// Runs here (not in the web app) because web mounts the media dir read-only.
export async function deleteMediaFor(postId: string): Promise<void> {
  if (!/^\d+$/.test(postId)) return; // NOTIFY payload — never trust it in a path
  await rm(path.join(env.mediaDir, postId), { recursive: true, force: true });
  for (const ext of [".jpg", ".png", ".webp", ".gif"]) {
    await rm(path.join(env.mediaDir, "og", `${postId}${ext}`), { force: true });
  }
}

export async function downloadMedia(postId: string, media: any): Promise<string | null> {
  const url = pickUrl(media);
  if (!url) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
    if (!res.ok) {
      console.warn(`media ${media.media_key}: download ${res.status}`);
      return null;
    }
    const relPath = path.join(postId, `${media.media_key}${extFor(media, url)}`);
    const absPath = path.join(env.mediaDir, relPath);
    await mkdir(path.dirname(absPath), { recursive: true });
    await writeFile(absPath, Buffer.from(await res.arrayBuffer()));
    return relPath;
  } catch (err) {
    console.warn(`media ${media.media_key}: ${(err as Error).message}`);
    return null;
  }
}
