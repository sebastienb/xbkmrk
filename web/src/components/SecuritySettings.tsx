"use client";

import { useState } from "react";

export default function SecuritySettings() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const change = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    setBusy(true);
    try {
      const res = await fetch("/api/auth/password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ current, next }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setCurrent("");
      setNext("");
      setMsg({ ok: true, text: "Password changed — every other device was signed out." });
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  };

  return (
    <section className="settings-group">
      <h2>Security</h2>
      <p className="hint">
        The whole site — reader, digest, settings, and data APIs — sits behind this password
        (long-lived session cookie, so each device signs in once). Saving routes keep their own
        token: the bookmarklet, extension, and iOS shortcut are unaffected. The MCP server
        (:{process.env.NEXT_PUBLIC_MCP_PORT ?? "3021"}) requires its own bearer token — shown on
        the Connect page.
      </p>
      <form onSubmit={change} style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
        {/* hidden username keeps the password manager updating the same entry */}
        <input type="text" name="username" autoComplete="username" value="archive" readOnly hidden />
        <span className="setting-input" style={{ flex: "1 1 11rem" }}>
          <input
            type="password"
            id="current-password"
            name="password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            placeholder="Current password"
            autoComplete="current-password"
          />
        </span>
        <span className="setting-input" style={{ flex: "1 1 11rem" }}>
          <input
            type="password"
            id="new-password"
            name="new-password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            placeholder="New password (8+ chars)"
            minLength={8}
            autoComplete="new-password"
          />
        </span>
        <button className="btn" disabled={busy || !current || !next}>
          {busy ? "…" : "Change password"}
        </button>
        <button type="button" className="btn" onClick={signOut}>
          Sign out this device
        </button>
      </form>
      {msg && (
        <p className="hint" style={{ color: msg.ok ? undefined : "var(--danger)" }}>
          {msg.ok ? "✓ " : "⚠ "}
          {msg.text}
        </p>
      )}
    </section>
  );
}
