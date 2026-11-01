"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { BookmarkIcon } from "./icons";

// The door. Two modes: first run (no password exists — this form creates it)
// and every day after; `setup` comes from the server so the inputs render in
// the initial HTML. On success we hard-navigate so the middleware sees the
// fresh cookie on a clean request.
export default function LoginForm({ setup }: { setup: boolean }) {
  const params = useSearchParams();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (setup && password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      // first run lands on the setup checklist; normal logins go where they were headed
      const next = params.get("next");
      window.location.href = setup ? "/welcome" : next && next.startsWith("/") ? next : "/";
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <div className="login-brand">
          <span className="brand-mark"><BookmarkIcon size={22} /></span> Bookmark Archive
        </div>
        <p className="hint">
          {setup
            ? "First run — choose the password that will protect this archive (8+ characters)."
            : "Enter the archive password."}
        </p>
            {/* hidden username: password managers key the saved credential on
                a username field — without one, saving and autofill are flaky */}
            <input
              type="text"
              name="username"
              autoComplete="username"
              value="archive"
              readOnly
              hidden
            />
            <input
              type="password"
              id="password"
              name={setup ? "new-password" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              autoFocus
              required
              minLength={setup ? 8 : undefined}
              autoComplete={setup ? "new-password" : "current-password"}
            />
            {setup && (
              <input
                type="password"
                id="confirm-password"
                name="confirm-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="Repeat password"
                required
                minLength={8}
                autoComplete="new-password"
              />
            )}
            <button className="btn primary" disabled={busy || !password}>
              {busy ? "…" : setup ? "Set password & sign in" : "Sign in"}
            </button>
        {error && <p className="login-error">{error}</p>}
      </form>
    </div>
  );
}
