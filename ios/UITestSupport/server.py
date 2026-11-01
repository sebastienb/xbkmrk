"""Local deterministic fixture server for manual simulator QA; never contacts your archive.

Run: python3 ios/UITestSupport/server.py
Server: http://127.0.0.1:18769   Password: fixture-password
"""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs
from pathlib import Path
import os
import json
import re
import time
from collections import Counter
from datetime import datetime, timezone

MEDIA = Path(os.environ.get("XBKMRK_FIXTURE_MEDIA", "/tmp/xbkmrk-fixture-media"))
VIDEO_REQUESTS = []
SYNC = {"requested_at": None, "last_run_at": "2026-10-24T12:00:00.000Z"}


def bookmark(index, title, source, tags, description, url):
    return {
        "id": str(index), "text": title + "\n\n" + description,
        "saved_at": "2026-10-24T12:00:00.000Z", "read_at": None,
        "notes": "An idea to revisit this weekend." if index == 1 else None,
        "tags": tags, "source": source, "username": None, "author_name": None,
        "urls": [{"expanded_url": url, "display_url": url}], "media": [],
        "link": {"url": url, "kind": "article", "title": title,
                 "site_name": "Fixture library", "description": description,
                 "og_image_path": None, "has_content": True},
        "content": f"<h1>{title}</h1><p>{description}</p><h2>A quieter place to read</h2>"
                   "<p>This article is deterministic test content. It exercises the saved reader, Dynamic Type, and sharing without using private bookmarks.</p>"
                   "<blockquote>Keep the things worth coming back to.</blockquote>"
                   "<p><a href='https://example.org/article'>Read the original</a></p>"
    }


BOOKMARKS = [
    bookmark(1, "A different perspective on our planet", "web", ["space", "inspiration"],
             "Explore the missions, images, and discoveries that bring the universe a little closer.", "https://www.nasa.gov/"),
    bookmark(2, "SwiftUI: a new way to see your content", "web", ["swift", "ios"],
             "Let the content lead, with native navigation, thoughtful typography, and Liquid Glass controls.", "https://developer.apple.com/swiftui/"),
    bookmark(3, "Building a home for your bookmarks", "x", ["selfhosted"],
             "Everything you save, searchable on a server you control.", "https://example.org/bookmarks"),
    bookmark(4, "The architecture of a good weekend", "youtube", ["inspiration"],
             "YouTube's public player demo video.", "https://www.youtube.com/watch?v=M7lc1UVf-VE"),
    bookmark(5, "Streaming test: a moving test pattern", "x", ["video"],
             "Generated locally for playback and seeking checks. No private archive data.", "https://example.org/streaming"),
    bookmark(6, "Unavailable video test", "x", ["video"],
             "Exercises a missing server video and the retry controls.", "https://example.org/missing")
]

BOOKMARKS[0]["link"]["site_name"] = "NASA"
BOOKMARKS[1]["link"]["site_name"] = "Apple Developer"
for index, filename in [(0, "nasa.jpg"), (1, "swiftui.jpg")]:
    if (MEDIA / filename).exists():
        BOOKMARKS[index]["link"]["og_image_path"] = filename
# Exercise the no-image, no-link-description fallback for a text post.
BOOKMARKS[2]["link"] = None
BOOKMARKS[2]["author_name"] = "Alex Chen"
BOOKMARKS[2]["username"] = "alexchen"
BOOKMARKS[3]["link"]["kind"] = "video"
for index, path in [(4, "stream.mp4"), (5, "missing.mp4")]:
    BOOKMARKS[index]["link"] = None
    BOOKMARKS[index]["media"] = [{"media_key": str(index), "type": "video", "local_path": path}]

if os.environ.get("XBKMRK_LINK_FIXTURE") == "1":
    long_post = bookmark(8, "Long post with an article link", "x", ["testing"],
                         "A fixture for the complete-post reader.", "https://example.org/article")
    long_post["text"] = "Long post with an article link\n\n" + "A complete paragraph with <literal text> & punctuation.\n\n" * 10 + "END OF FULL POST https://example.org/article"
    long_post["link"] = None  # The link must remain visible even when enrichment failed.
    long_post["content"] = None
    BOOKMARKS.append(long_post)
    article = bookmark(9, "Plain text X article", "x", ["testing"],
                       "Plain text must not be interpreted as HTML.", "https://x.com/i/article/9000")
    article["link"]["kind"] = "x_article"
    article["content"] = "Literal <article> text & symbols\n\n" + "An unabridged paragraph.\n\n" * 15 + "END OF SAVED ARTICLE"
    BOOKMARKS.append(article)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def send_json(self, value, status=200, headers=None):
        data = json.dumps(value).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        for key, value in (headers or {}).items():
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(data)

    def authorized(self):
        if self.headers.get("Cookie") == "xbm_session=fixture-session":
            return True
        self.send_json({"error": "authentication required"}, 401)
        return False

    def do_GET(self):
        url = urlparse(self.path)
        if url.path == "/api/auth/login":
            return self.send_json({"setup": False, "authed": False})
        if not self.authorized():
            return
        if url.path == "/api/save-token":
            return self.send_json({"token": "fixture-save-token"})
        if url.path == "/api/status":
            if SYNC["requested_at"] and time.monotonic() - SYNC["requested_at"] > 1:
                SYNC["last_run_at"] = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
                SYNC["requested_at"] = None
                if not any(b["id"] == "7" for b in BOOKMARKS):
                    BOOKMARKS.append(bookmark(7, "A freshly fetched bookmark", "web", ["testing"],
                                              "Added by a local fixture sync.", "https://example.org/new"))
            return self.send_json({"last_run_at": SYNC["last_run_at"]})
        if url.path == "/test/video-requests":
            return self.send_json(VIDEO_REQUESTS)
        if url.path == "/test/redirect-target":
            VIDEO_REQUESTS.append({"redirect_followed": True})
            return self.send_json({"error": "must not be followed"}, 500)
        if url.path.startswith("/api/media/"):
            name = url.path.rsplit("/", 1)[-1]
            if name.endswith(".mp4"):
                return self.stream_video(name)
            if name not in ["nasa.jpg", "swiftui.jpg"] or not (MEDIA / name).exists():
                return self.send_json({"error": "not found"}, 404)
            data = (MEDIA / name).read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "image/jpeg")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "max-age=3600")
            self.end_headers()
            self.wfile.write(data)
            return
        if url.path == "/api/filters":
            counts = Counter(tag for b in BOOKMARKS for tag in b["tags"])
            return self.send_json({
                "authors": [{"username": "alexchen", "name": "Alex Chen", "count": 1}],
                "tags": [{"tag": tag, "count": count} for tag, count in sorted(counts.items(), key=lambda item: (-item[1], item[0]))]
            })
        if url.path == "/api/bookmarks":
            query = parse_qs(url.query)
            results = BOOKMARKS
            if query.get("saved_from"):
                results = [b for b in results if b["saved_at"] >= query["saved_from"][0]]
            if query.get("saved_before"):
                results = [b for b in results if b["saved_at"] < query["saved_before"][0]]
            if "unread" in query:
                unread = query["unread"][0] == "true"
                results = [b for b in results if (b["read_at"] is None) == unread]
            if query.get("q"):
                needle = query["q"][0].lower()
                results = [b for b in results if needle in b["text"].lower()]
            if query.get("source") and query["source"][0] in ["web", "youtube"]:
                results = [b for b in results if b["source"] == query["source"][0]]
            elif query.get("source"):
                results = [b for b in results if b["source"] == "x"]
            if query.get("tag"):
                results = [b for b in results if query["tag"][0] in b["tags"]]
            if query.get("author"):
                results = [b for b in results if query["author"][0] == b["username"]]
            if query.get("content"):
                kind = query["content"][0]
                def matches_content(b):
                    if kind == "video":
                        return (b["link"] is not None and b["link"]["kind"] == kind) or any(m["type"] in ["video", "animated_gif"] for m in b["media"])
                    if kind == "text":
                        return not b["link"] and not b["media"]
                    if kind == "link":
                        return b["link"] is not None
                    if kind == "photo":
                        return any(m["type"] == "photo" for m in b["media"])
                    return b["link"] is not None and b["link"]["kind"] == kind
                results = [b for b in results if matches_content(b)]
            total = len(results)
            cursor = int(query.get("cursor", ["0"])[0])
            remaining = [b for b in results if int(b["id"]) > cursor]
            limit = 2
            page = remaining[:limit]
            return self.send_json({"bookmarks": page, "total": total,
                                   "saved_date_filter_applied": bool(query.get("saved_from") or query.get("saved_before")),
                                   "nextCursor": page[-1]["id"] if len(remaining) > limit else None,
                                   "mode": "keyword" if query.get("q") else None})
        if url.path.startswith("/api/bookmarks/"):
            found = next((b for b in BOOKMARKS if b["id"] == url.path.rsplit("/", 1)[-1]), None)
            return self.send_json(found or {"error": "not found"}, 200 if found else 404)
        self.send_json({"error": "not found"}, 404)

    def stream_video(self, name):
        if name == "redirect.mp4":
            return self.send_json({}, 307, {"Location": "http://127.0.0.1:18769/test/redirect-target"})
        path = MEDIA / ("stream.mp4" if name == "slow.mp4" else name)
        if name not in ["stream.mp4", "slow.mp4"] or not path.exists():
            return self.send_json({"error": "not found"}, 404)
        size = path.stat().st_size
        value = self.headers.get("Range", "")
        match = re.fullmatch(r"bytes=(\d+)-(\d*)", value)
        if not match:
            return self.send_json({"error": "range required"}, 416)
        start = int(match[1])
        end = min(int(match[2]) if match[2] else size - 1, size - 1)
        if start > end:
            return self.send_json({"error": "bad range"}, 416)
        print(f"VIDEO range={value} start={start} end={end} total={size}", flush=True)
        record = {"range": value, "start": start, "end": end, "total": size, "sent": 0, "finished": False}
        VIDEO_REQUESTS.append(record)
        self.send_response(206)
        self.send_header("Content-Type", "video/mp4")
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.send_header("Content-Length", str(end - start + 1))
        self.send_header("Cache-Control", "public, max-age=31536000, immutable")
        self.end_headers()
        sent = 0
        try:
            if name == "slow.mp4":
                time.sleep(0.5)
            with path.open("rb") as video:
                video.seek(start)
                while sent < end - start + 1:
                    chunk = video.read(min(65536, end - start + 1 - sent))
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    self.wfile.flush()
                    sent += len(chunk)
                    record["sent"] = sent
                    if len(chunk) > 2:
                        time.sleep(0.02)
        except (BrokenPipeError, ConnectionResetError):
            pass
        print(f"VIDEO sent={sent} of={end-start+1}", flush=True)
        record["finished"] = True

    def do_POST(self):
        payload = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
        if self.path == "/api/auth/login" and payload.get("password") == "fixture-password":
            return self.send_json({"ok": True}, headers={"Set-Cookie": "xbm_session=fixture-session; Path=/; HttpOnly; Max-Age=15552000; SameSite=Lax"})
        if self.path == "/api/sync":
            if not self.authorized():
                return
            SYNC["requested_at"] = time.monotonic()
            return self.send_json({"requested": True})
        self.send_json({"error": "Wrong password."}, 401)

    def do_PATCH(self):
        if not self.authorized():
            return
        payload = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
        found = next((b for b in BOOKMARKS if b["id"] == self.path.rsplit("/", 1)[-1]), None)
        if not found:
            return self.send_json({"error": "not found"}, 404)
        found["read_at"] = "2026-10-24T13:00:00.000Z" if payload.get("read") else None
        self.send_json({k: found[k] for k in ["id", "read_at", "notes", "tags"]})


if __name__ == "__main__":
    print("Fixture server on http://127.0.0.1:18769", flush=True)
    ThreadingHTTPServer(("127.0.0.1", 18769), Handler).serve_forever()
