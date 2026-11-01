import { NextRequest, NextResponse } from "next/server";
import { stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import path from "node:path";

const MEDIA_DIR = process.env.MEDIA_DIR || "/app/data/media";

const MIME: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
};

// Streams files with HTTP Range support — required for <video> playback
// (Safari refuses to play without 206 responses; Chrome can't seek).
export async function GET(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path: parts } = await params;
  const rel = path.normalize(parts.join("/"));
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    return NextResponse.json({ error: "bad path" }, { status: 400 });
  }
  const abs = path.join(MEDIA_DIR, rel);

  let size: number;
  try {
    size = (await stat(abs)).size;
  } catch {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const mime = MIME[path.extname(rel).toLowerCase()] ?? "application/octet-stream";
  const baseHeaders: Record<string, string> = {
    "content-type": mime,
    "accept-ranges": "bytes",
    "cache-control": "public, max-age=31536000, immutable",
  };

  const range = req.headers.get("range");
  if (range) {
    const m = range.match(/^bytes=(\d*)-(\d*)$/);
    const start = m?.[1] ? parseInt(m[1], 10) : 0;
    const end = m?.[2] ? Math.min(parseInt(m[2], 10), size - 1) : size - 1;
    if (!m || start > end || start >= size) {
      return new NextResponse(null, {
        status: 416,
        headers: { ...baseHeaders, "content-range": `bytes */${size}` },
      });
    }
    const stream = Readable.toWeb(createReadStream(abs, { start, end })) as ReadableStream;
    return new NextResponse(stream, {
      status: 206,
      headers: {
        ...baseHeaders,
        "content-range": `bytes ${start}-${end}/${size}`,
        "content-length": String(end - start + 1),
      },
    });
  }

  const stream = Readable.toWeb(createReadStream(abs)) as ReadableStream;
  return new NextResponse(stream, {
    status: 200,
    headers: { ...baseHeaders, "content-length": String(size) },
  });
}
