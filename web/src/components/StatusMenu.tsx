"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { PulseIcon } from "./icons";
import usePanelAnchor from "./usePanelAnchor";

interface Status {
  total: number;
  added_24h: number;
  tagged: number;
  pending_tagging: number;
  embedded: number;
  last_run_at: string | null;
  last_sync_posts: number | null;
  month_posts: number | null;
  cost_per_1k: number | null;
  recent: Array<{ id: string; title: string; saved_at: string; liked: boolean; bookmarked: boolean }>;
}

function fetchCost(status: Status): string | null {
  if (status.last_sync_posts === null || status.month_posts === null) return null;
  const d = (n: number) =>
    status.cost_per_1k ? ` (~$${((n / 1000) * status.cost_per_1k).toFixed(2)})` : "";
  return `last sync read ${status.last_sync_posts} posts${d(status.last_sync_posts)} · ${status.month_posts} this month${d(status.month_posts)}`;
}

function ago(iso: string | null): string {
  if (!iso) return "never";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export default function StatusMenu() {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const [syncRequestedAt, setSyncRequestedAt] = useState<number | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  usePanelAnchor(open, wrapRef);

  const syncing =
    syncRequestedAt !== null &&
    (!status?.last_run_at || new Date(status.last_run_at).getTime() < syncRequestedAt);

  // clear the "syncing" state once a newer sync timestamp shows up
  useEffect(() => {
    if (syncRequestedAt && status?.last_run_at && new Date(status.last_run_at).getTime() >= syncRequestedAt) {
      setSyncRequestedAt(null);
    }
  }, [status, syncRequestedAt]);

  const syncNow = async () => {
    setSyncRequestedAt(Date.now());
    await fetch("/api/sync", { method: "POST" }).catch(() => setSyncRequestedAt(null));
  };

  // fetch on open, refresh every 10s while open (tagging runs in background)
  useEffect(() => {
    if (!open) return;
    const fetchStatus = () =>
      fetch("/api/status").then((r) => r.json()).then(setStatus).catch(() => {});
    fetchStatus();
    const interval = setInterval(fetchStatus, 10_000);
    return () => clearInterval(interval);
  }, [open]);

  // close on outside click (pointerdown, so a tap outside closes it on iOS too)
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  return (
    <div className="status-wrap" ref={wrapRef}>
      <button className="icon-btn" title="Sync status" onClick={() => setOpen((o) => !o)}>
        <PulseIcon />
      </button>
      {open && (
        <div className="status-panel">
          {!status ? (
            <div className="status-loading">Loading…</div>
          ) : (
            <>
              <div className="status-head">
                <span>Status</span>
                <span className="status-sync">last checked {ago(status.last_run_at)}</span>
              </div>
              <button className="btn sync-now" onClick={syncNow} disabled={syncing}>
                {syncing ? "⟳ Syncing…" : "⟳ Check for new posts now"}
              </button>
              {fetchCost(status) && <div className="status-note">{fetchCost(status)}</div>}
              <div className="status-grid">
                <div><b>{status.total}</b><span>posts</span></div>
                <div><b>{status.added_24h}</b><span>added 24h</span></div>
                <div><b>{status.tagged}</b><span>tagged</span></div>
                <div className={status.pending_tagging > 0 ? "pending" : ""}>
                  <b>{status.pending_tagging}</b><span>pending tags</span>
                </div>
                <div><b>{status.embedded}</b><span>embedded</span></div>
              </div>
              {status.pending_tagging > 0 && (
                <div className="status-note">auto-tagging in progress — refreshes live</div>
              )}
              <div className="status-section">Recently added</div>
              {status.recent.map((r) => (
                <Link key={r.id} className="status-recent" href={`/b/${r.id}`} onClick={() => setOpen(false)}>
                  <span className="src">{r.bookmarked ? "🔖" : "♥"}</span>
                  <span className="t">{r.title || "(media post)"}</span>
                  <span className="when">{ago(r.saved_at)}</span>
                </Link>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
