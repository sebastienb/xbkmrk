"use client";

import { useEffect, useRef, useState } from "react";
import { copyText } from "@/lib/copy";

// Read-it-later bookmarklet: saves the page being browsed into the archive.
// Built client-side from window.location.origin, so it targets whatever
// address the user reaches the app at (LAN name, Tailscale, …). Works in any
// browser — Safari included — no extension needed.
export default function BookmarkletSettings() {
  const [code, setCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [appOrigin, setAppOrigin] = useState("");
  const linkRef = useRef<HTMLSpanElement>(null);

  useEffect(() => setAppOrigin(window.location.origin), []);

  useEffect(() => {
    fetch("/api/save-token")
      .then((r) => r.json())
      .then(({ token }) => {
        if (!token) return;
        const js =
          `(()=>{var s=String(window.getSelection?window.getSelection():'').slice(0,1500),` +
          `u='${window.location.origin}/api/save?token=${token}'` +
          `+'&url='+encodeURIComponent(location.href)` +
          `+'&title='+encodeURIComponent(document.title.slice(0,300))` +
          `+(s?'&sel='+encodeURIComponent(s):'');` +
          `window.open(u,'xbmsave','width=420,height=260')})()`;
        setCode(`javascript:${js}`);
      })
      .catch(() => {});
  }, []);

  // React refuses javascript: hrefs in JSX — inject the draggable anchor manually
  useEffect(() => {
    if (!code || !linkRef.current) return;
    const a = document.createElement("a");
    a.href = code;
    a.className = "btn primary";
    a.textContent = "🔖 Save to archive";
    a.title = "Drag me to your bookmarks bar";
    a.onclick = (e) => e.preventDefault(); // clicking here would save this page
    linkRef.current.replaceChildren(a);
  }, [code]);

  const copy = async () => {
    if (!code) return;
    await copyText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <section className="settings-group">
      <h2>Save from the browser</h2>
      <p className="hint">
        Drag the button below to your bookmarks bar. On any page, click it to save that page
        (select text first to capture a quote). Content, thumbnail, and tags are extracted
        automatically. On Safari or mobile: create any bookmark, then edit it and paste the
        copied code as its address.
      </p>
      {code ? (
        <p style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
          <span ref={linkRef} />
          <button className="btn" onClick={copy}>{copied ? "Copied ✓" : "Copy bookmarklet code"}</button>
        </p>
      ) : (
        <p className="hint">Generating token…</p>
      )}
      <p className="hint">
        The bookmarklet points at <code>{appOrigin}</code> —
        re-create it here if you access the archive from a different address.
      </p>
      <p className="hint" style={{ marginTop: "1.25rem" }}>
        Bookmarklets don&apos;t work in some browsers (Arc has no bookmarks bar) — use the browser
        extension instead. It comes pre-configured for the address below; extract the zip, then in{" "}
        <code>chrome://extensions</code> enable Developer mode and <em>Load unpacked</em> the folder.
      </p>
      <p style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
        <span className="setting-input" style={{ flex: "1 1 14rem" }}>
          <input
            type="text"
            value={appOrigin}
            onChange={(e) => setAppOrigin(e.target.value)}
            placeholder="http://your-server:3000"
            aria-label="Archive address baked into the extension"
          />
        </span>
        <a
          className="btn"
          href={`/api/extension?origin=${encodeURIComponent(appOrigin)}`}
          aria-disabled={!appOrigin}
          onClick={(e) => { if (!appOrigin) e.preventDefault(); }}
        >
          ⬇ Download extension
        </a>
      </p>
    </section>
  );
}
