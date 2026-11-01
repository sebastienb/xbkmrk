"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { BookmarkWithLink, FilterOptions } from "@/lib/types";
import AppHeader from "./AppHeader";
import BookmarkCard from "./BookmarkCard";
import SavedDateFilter from "./SavedDateFilter";
import type { SavedDateRange } from "@/lib/saved-dates";

type SearchMode = "hybrid" | "keyword" | "semantic";
type Tab = "saves" | "archive" | "all";
type Source = "" | "bookmarks" | "likes" | "web" | "youtube";
type Content = "" | "video" | "photo" | "article" | "github" | "link" | "text";

// results-meta label per content filter ("· 12 articles")
const CONTENT_LABEL: Record<string, string> = {
  video: "videos",
  photo: "photos",
  article: "articles",
  github: "GitHub repos",
  link: "links",
  text: "text posts",
};

export default function Reader() {
  const [bookmarks, setBookmarks] = useState<BookmarkWithLink[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // refs mirror pagination state so the IntersectionObserver never acts on a
  // stale closure (e.g. firing an old deep-scroll cursor right after a filter
  // change empties the grid — which made tag filters return nothing)
  const nextCursorRef = useRef<string | null>(null);
  const loadingRef = useRef(false);

  const [tab, setTab] = useState<Tab>("saves");
  const [query, setQuery] = useState("");
  const [activeQuery, setActiveQuery] = useState("");
  const [mode, setMode] = useState<SearchMode>("hybrid");
  const [author, setAuthor] = useState("");
  const [tag, setTag] = useState("");
  const [source, setSource] = useState<Source>("");
  const [content, setContent] = useState<Content>("");
  const [savedDates, setSavedDates] = useState<SavedDateRange>({});
  const [savedDateLabel, setSavedDateLabel] = useState("");
  const [filters, setFilters] = useState<FilterOptions | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false); // mobile dropdown

  const sentinelRef = useRef<HTMLDivElement>(null);
  const generation = useRef(0);

  const buildParams = useCallback(
    (cursor?: string | null) => {
      const p = new URLSearchParams();
      if (activeQuery) {
        p.set("q", activeQuery);
        p.set("mode", mode);
      }
      if (author) p.set("author", author);
      if (tag) p.set("tag", tag);
      if (source) p.set("source", source);
      if (content) p.set("content", content);
      if (savedDates.savedFrom) p.set("saved_from", savedDates.savedFrom);
      if (savedDates.savedBefore) p.set("saved_before", savedDates.savedBefore);
      if (tab === "saves") p.set("unread", "true");
      if (tab === "archive") p.set("unread", "false");
      if (cursor) p.set("cursor", cursor);
      return p;
    },
    [activeQuery, mode, author, tag, source, content, tab, savedDates],
  );

  const load = useCallback(
    async (cursor?: string | null) => {
      const gen = ++generation.current;
      setLoading(true);
      loadingRef.current = true;
      setError(null);
      try {
        const res = await fetch(`/api/bookmarks?${buildParams(cursor)}`);
        if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`);
        const json = await res.json();
        if (gen !== generation.current) return; // stale response
        setBookmarks((prev) => (cursor ? [...prev, ...json.bookmarks] : json.bookmarks));
        setNextCursor(json.nextCursor);
        nextCursorRef.current = json.nextCursor;
        setTotal(json.total ?? null);
        setDone(!json.nextCursor);
      } catch (err) {
        if (gen === generation.current) setError((err as Error).message);
      } finally {
        if (gen === generation.current) {
          setLoading(false);
          loadingRef.current = false;
        }
      }
    },
    [buildParams],
  );

  useEffect(() => {
    // invalidate any in-flight/queued pagination before fetching fresh
    nextCursorRef.current = null;
    setBookmarks([]);
    setNextCursor(null);
    setDone(false);
    load(null);
  }, [load]);

  // reload when the header's "Save a link" panel adds a bookmark
  useEffect(() => {
    const onSaved = () => {
      nextCursorRef.current = null;
      setNextCursor(null);
      setDone(false);
      load(null);
    };
    window.addEventListener("xbm:bookmark-saved", onSaved);
    return () => window.removeEventListener("xbm:bookmark-saved", onSaved);
  }, [load]);

  useEffect(() => {
    fetch("/api/filters")
      .then((r) => r.json())
      .then(setFilters)
      .catch(() => {});
  }, []);

  // infinite scroll — reads pagination state from refs, never stale closures
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver((entries) => {
      const cursor = nextCursorRef.current;
      if (entries[0].isIntersecting && cursor && !loadingRef.current) load(cursor);
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, [load]);

  const handleArchiveToggle = (id: string, nowRead: boolean) => {
    // in Saves/Archive tabs the item leaves the current view
    if (tab !== "all") {
      setBookmarks((prev) => prev.filter((b) => b.id !== id));
    } else {
      setBookmarks((prev) =>
        prev.map((b) => (b.id === id ? { ...b, read_at: nowRead ? new Date().toISOString() : null } : b)),
      );
    }
  };

  const emptyMessage =
    (savedDates.savedFrom || savedDates.savedBefore) ? "No bookmarks saved in this date range. Try other dates or clear the date filter." :
    activeQuery ? "No results." :
    total === 0 ? (
      // brand-new archive (not just an empty tab) — point at the setup guide
      <>Nothing here yet — <Link href="/welcome">set up your sources</Link> to start archiving.</>
    ) :
    tab === "saves" ? "No unread saves — you're all caught up. 🎉" :
    tab === "archive" ? "Nothing archived yet." :
    "No bookmarks yet — run the poller to sync.";

  const sidebarContent = (
    <>
      <form
        className="search"
        onSubmit={(e) => {
          e.preventDefault();
          setActiveQuery(query.trim());
        }}
      >
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            // emptying the box resets to the full feed without needing Enter
            if (e.target.value.trim() === "") setActiveQuery("");
          }}
          placeholder="Search…"
        />
        <div className="search-row">
          <select value={mode} onChange={(e) => setMode(e.target.value as SearchMode)} title="Search mode">
            <option value="hybrid">Hybrid</option>
            <option value="keyword">Keyword</option>
            <option value="semantic">Semantic</option>
          </select>
          {activeQuery && (
            <button type="button" className="icon-btn" title="Clear search"
              onClick={() => { setQuery(""); setActiveQuery(""); }}>
              ✕
            </button>
          )}
        </div>
      </form>

      <SavedDateFilter onChange={(range, label) => { setSavedDates(range); setSavedDateLabel(label); }} />

      <div className="side-section">Source</div>
      <div className="pill-wrap">
        {([["", "All"], ["bookmarks", "🔖 Bookmarks"], ["likes", "♥ Likes"], ["web", "🌐 Web"], ["youtube", "▶ YouTube"]] as const).map(([val, label]) => (
          <button
            key={val}
            className={`pill ${source === val ? "active" : ""}`}
            onClick={() => setSource(val)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="side-section">Type</div>
      <div className="pill-wrap">
        {([
          ["", "All"],
          ["video", "▶ Video"],
          ["photo", "🖼 Photo"],
          ["article", "📄 Article"],
          ["github", "🐙 GitHub"],
          ["link", "🔗 Link"],
          ["text", "💬 Text"],
        ] as const).map(
          ([val, label]) => (
            <button
              key={val}
              className={`pill ${content === val ? "active" : ""}`}
              onClick={() => setContent(val)}
            >
              {label}
            </button>
          ),
        )}
      </div>

      <div className="side-section">Author</div>
      <select value={author} onChange={(e) => setAuthor(e.target.value)}>
        <option value="">All authors</option>
        {filters?.authors.map((a) => (
          <option key={a.username} value={a.username}>
            @{a.username} ({a.count})
          </option>
        ))}
      </select>

      {filters && filters.tags.length > 0 && (
        <>
          <div className="side-section">Tags</div>
          <div className="pill-wrap">
            {filters.tags.slice(0, 30).map((t) => (
              <button
                key={t.tag}
                className={`pill ${tag === t.tag ? "active" : ""}`}
                onClick={() => setTag(tag === t.tag ? "" : t.tag)}
              >
                {t.tag} <span className="pill-count">{t.count}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </>
  );

  return (
    <>
      <AppHeader
        actions={
          <button
            className={`icon-btn filters-toggle ${filtersOpen ? "active" : ""}`}
            title="Search & filters"
            onClick={() => setFiltersOpen((o) => !o)}
          >
            ☰
          </button>
        }
      >
        <nav className="tabs">
          {(["saves", "archive", "all"] as const).map((t) => (
            <button key={t} className={`tab ${tab === t ? "active" : ""}`} onClick={() => setTab(t)}>
              {t === "saves" ? "Saves" : t === "archive" ? "Archive" : "All"}
            </button>
          ))}
        </nav>
      </AppHeader>

      <div className="layout">
        <aside className={`side ${filtersOpen ? "open" : ""}`}>{sidebarContent}</aside>

        <main className="main-col">
          <div className="results-meta">
            {total ?? bookmarks.length} items
            {content && <> · {CONTENT_LABEL[content]}</>}
            {activeQuery && <> · “{activeQuery}”</>}
            {tag && <> · #{tag}</>}
            {(savedDates.savedFrom || savedDates.savedBefore) && <> · {savedDateLabel}</>}
          </div>
          <div className="grid">
        {bookmarks.map((b) => (
          <BookmarkCard key={b.id} bookmark={b} onArchiveToggle={handleArchiveToggle} searchQuery={activeQuery || undefined} />
        ))}
        {error && <div className="feed-status">⚠ {error}</div>}
        {loading && <div className="feed-status">Loading…</div>}
        {!loading && !error && bookmarks.length === 0 && <div className="feed-status">{emptyMessage}</div>}
            {done && bookmarks.length > 0 && <div className="feed-status">— end —</div>}
            <div ref={sentinelRef} style={{ gridColumn: "1 / -1" }} />
          </div>
        </main>
      </div>
    </>
  );
}
