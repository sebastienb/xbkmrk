"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

interface Status {
  bookmarks: number;
  embedded: number;
  embedding: boolean;
  xCreds: boolean;
  xAuthed: boolean;
  tagging: boolean;
  youtube: boolean;
  reddit: boolean;
  github: boolean;
  mcpMinted: boolean;
}

function Dot({ state }: { state: "done" | "todo" | "opt" }) {
  return <span className={`ob-dot ${state}`}>{state === "done" ? "✓" : state === "todo" ? "•" : "○"}</span>;
}

function Step({
  state,
  title,
  children,
  action,
}: {
  state: "done" | "todo" | "opt";
  title: string;
  children: React.ReactNode;
  action?: { href: string; label: string };
}) {
  return (
    <div className={`ob-step ${state === "done" ? "done" : ""}`}>
      <Dot state={state} />
      <div className="ob-body">
        <div className="ob-title">{title}</div>
        <div className="ob-text">{children}</div>
        {action && (
          <Link className="btn ob-action" href={action.href}>
            {action.label}
          </Link>
        )}
      </div>
    </div>
  );
}

// Setup checklist with live status — refetched on window focus so steps flip
// to done as the user completes them in Settings and comes back.
export default function WelcomeChecklist() {
  const [s, setS] = useState<Status | null>(null);

  const refresh = useCallback(() => {
    fetch("/api/onboarding")
      .then((r) => r.json())
      .then(setS)
      .catch(() => {});
  }, []);

  useEffect(() => {
    refresh();
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [refresh]);

  if (!s) return <p style={{ color: "var(--text-dim)" }}>Checking your setup…</p>;

  const extras: Array<{ ok: boolean; label: string }> = [
    { ok: s.tagging, label: "Auto-tagging (Settings → AI)" },
    { ok: s.github, label: "GitHub token (Settings → Sync)" },
    { ok: s.reddit, label: "Reddit app (Settings → Sync)" },
  ];

  return (
    <div className="ob-list">
      <Step state="done" title="Protect the archive">
        Done — that&apos;s the password you just set. Sessions last ~180 days; change it any
        time in Settings → Security.
      </Step>

      <Step
        state={s.embedding ? "done" : "todo"}
        title="Connect an embedding model"
        action={{ href: "/settings", label: "Open Settings → AI" }}
      >
        Powers semantic search and the digest&apos;s archive picks. Point it at any
        OpenAI-compatible endpoint — LM Studio or Ollama running <code>nomic-embed-text</code>{" "}
        on this machine is perfect. It must be reachable from inside Docker: use{" "}
        <code>host.docker.internal</code>, and make the server listen on the network (LM
        Studio: &quot;Serve on Local Network&quot;; Ollama: <code>OLLAMA_HOST=0.0.0.0</code>).
        {s.embedding && s.bookmarks > 0 && ` ${s.embedded}/${s.bookmarks} bookmarks embedded.`}
      </Step>

      <Step
        state={s.xAuthed ? "done" : s.xCreds ? "todo" : "opt"}
        title="Add the X source"
        action={s.xCreds ? undefined : { href: "/settings", label: "Open Settings → X API" }}
      >
        {s.xAuthed ? (
          <>Connected — your bookmarks and likes sync automatically.</>
        ) : s.xCreds ? (
          <>
            Credentials saved — one step left: authorize once from the server so the poller
            can read your bookmarks. Run{" "}
            <code>docker compose run --rm -p 3022:3022 poller npm run auth</code> and open
            the printed URL.
          </>
        ) : (
          <>
            Optional — syncs your X bookmarks &amp; likes. Create a free app at
            developer.x.com (OAuth 2.0 Web App, callback{" "}
            <code>http://localhost:3022/callback</code>), paste the client ID/secret into
            Settings, then run the one-time login. The README&apos;s &quot;Add the X
            source&quot; section has the full walkthrough.
          </>
        )}
      </Step>

      <Step
        state="opt"
        title="Save from your devices"
        action={{ href: "/settings", label: "Get the save tools" }}
      >
        Grab the bookmarklet, the browser extension, or the iOS share-sheet shortcut from
        Settings — or just use the <b>+</b> button in the header. Any page works; shared X
        posts are enriched for free (author, text, media).
      </Step>

      <Step
        state={s.youtube ? "done" : "opt"}
        title="Archive YouTube playlists"
        action={{ href: "/settings", label: "Open Settings → Sources" }}
      >
        Point the archive at any public or unlisted playlist — every video becomes a
        bookmark with its transcript, searchable like everything else.
      </Step>

      <Step
        state={s.mcpMinted ? "done" : "opt"}
        title="Connect your AI agent"
        action={{ href: "/connect", label: "Open the Connect page" }}
      >
        The MCP server lets Claude (or any MCP client) search and recommend from your
        archive. The Connect page has copy-paste setup for common clients.
      </Step>

      <div className="ob-extras">
        <span className="ob-extras-label">Nice-to-haves:</span>
        {extras.map((e) => (
          <span key={e.label} className={`ob-chip ${e.ok ? "done" : ""}`}>
            {e.ok ? "✓ " : ""}
            {e.label}
          </span>
        ))}
      </div>

      <div className="ob-foot">
        <Link className="btn primary" href="/">
          {s.bookmarks > 0 ? `Go to my archive (${s.bookmarks} bookmarks) →` : "Go to my archive →"}
        </Link>
        <span className="ob-foot-note">You can come back to this page any time at /welcome.</span>
      </div>
    </div>
  );
}
