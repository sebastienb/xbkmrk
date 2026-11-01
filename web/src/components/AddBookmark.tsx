"use client";

import { useEffect, useRef, useState } from "react";
import { PlusIcon } from "./icons";
import usePanelAnchor from "./usePanelAnchor";

// Header "+" — paste any link (an X post, an article, a repo, …) and it goes
// through the same save path as the bookmarklet: row + NOTIFY now, with the
// poller filling in content/media/tags moments later. Auth: the session-gated
// /api/save-token hands us the same token the bookmarklet embeds.
export default function AddBookmark() {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const tokenRef = useRef<string | null>(null);

  usePanelAnchor(open, wrapRef);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const onDown = (e: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  const save = async () => {
    const target = url.trim();
    if (!target || busy) return;
    setBusy(true);
    setResult(null);
    try {
      if (!tokenRef.current) {
        const r = await fetch("/api/save-token");
        if (!r.ok) throw new Error(`could not get the save token (HTTP ${r.status})`);
        tokenRef.current = (await r.json()).token;
      }
      const res = await fetch("/api/save", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${tokenRef.current}` },
        body: JSON.stringify({ url: target, text: note.trim() || undefined }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setResult({
        ok: true,
        msg: json.status === "already_saved" ? "Already saved — moved back to Saves ✓" : "Saved ✓",
      });
      setUrl("");
      setNote("");
      window.dispatchEvent(new Event("xbm:bookmark-saved"));
      window.setTimeout(() => {
        setOpen(false);
        setResult(null);
      }, 1300);
    } catch (err) {
      setResult({ ok: false, msg: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="status-wrap" ref={wrapRef}>
      <button className="icon-btn" title="Save a link" onClick={() => setOpen((o) => !o)}>
        <PlusIcon />
      </button>
      {open && (
        <div className="status-panel add-panel">
          <div className="status-head"><span>Save a link</span></div>
          <input
            ref={inputRef}
            className="add-input"
            type="url"
            placeholder="Paste a link — post, article, repo…"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && save()}
          />
          <input
            className="add-input"
            type="text"
            placeholder="Note (optional)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && save()}
          />
          <button className="btn primary add-save" onClick={save} disabled={busy || !url.trim()}>
            {busy ? "Saving…" : "Save"}
          </button>
          {result && <div className={`add-result ${result.ok ? "ok" : "err"}`}>{result.msg}</div>}
        </div>
      )}
    </div>
  );
}
