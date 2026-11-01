"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import AppHeader from "./AppHeader";
import { copyText } from "@/lib/copy";

function CopyBlock({ label, text }: { label?: string; text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await copyText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="copy-block">
      {label && <div className="copy-label">{label}</div>}
      <pre>{text}</pre>
      <button className="btn copy-btn" onClick={copy}>{copied ? "✓ Copied" : "Copy"}</button>
    </div>
  );
}

// LM Studio one-click install: lmstudio://add_mcp?name=…&config=<url-encoded base64 of the
// server entry> — the object that would sit under "mcpServers": { "<name>": … }
// https://lmstudio.ai/docs/app/mcp
function lmStudioDeeplink(name: string, config: unknown) {
  const json = JSON.stringify(config);
  const b64 = btoa(String.fromCharCode(...new TextEncoder().encode(json)));
  return `lmstudio://add_mcp?name=${encodeURIComponent(name)}&config=${encodeURIComponent(b64)}`;
}

const TOOLS = [
  ["search_bookmarks(query, limit)", "Hybrid keyword + semantic search over every saved post, like, X Article, extracted web article and README."],
  ["get_unread(limit)", "Posts not yet marked read, newest saved first — the reading queue."],
  ["recommend(context, limit)", "Semantic similarity against any context string (e.g. what the user is working on right now)."],
  ["get_bookmark(id)", "One full record by X post id: text, author, tags, personal notes, referenced posts, media paths."],
] as const;

export default function ConnectGuide({ mcpPort }: { mcpPort: string }) {
  // derive the MCP URL from however the user is reaching this page
  // (tailscale hostname, LAN IP, …) — same host, different port
  const [host, setHost] = useState("<this-host>");
  const [token, setToken] = useState("<token — sign in to load>");
  const [tokenReady, setTokenReady] = useState(false);
  useEffect(() => setHost(window.location.hostname), []);
  useEffect(() => {
    fetch("/api/mcp-token")
      .then((r) => r.json())
      .then((d) => {
        if (d.token) {
          setToken(d.token);
          setTokenReady(true);
        }
      })
      .catch(() => {});
  }, []);
  const mcpUrl = `http://${host}:${mcpPort}/mcp`;
  const serverEntry = { url: mcpUrl, headers: { Authorization: `Bearer ${token}` } };
  const lmStudioUrl = lmStudioDeeplink("x-bookmarks", serverEntry);

  const agentInstructions = `You have access to my personal X (Twitter) bookmark archive via MCP tools.

It contains every post I bookmarked or liked: full text (including long-form
X Articles), my personal notes and tags, extracted full-text articles from
linked pages, and GitHub READMEs from linked repos.

Available tools:
- search_bookmarks(query, limit): hybrid keyword + semantic search. Use this
  first for any "did I save something about X?" question.
- get_unread(limit): my unread reading queue, newest first.
- recommend(context, limit): semantically similar saves for a context string.
  Use it to surface relevant saves for whatever I'm currently working on.
- get_bookmark(id): full record for one post, including my notes.

Guidelines:
- Prefer search_bookmarks over recommend for explicit questions; use
  recommend when proactively surfacing related material.
- Results include my "notes" (personal annotations) and "tags" — treat those
  as my own commentary, weigh them highly.
- Each result has the X post id; link posts as https://x.com/i/status/<id>.`;

  return (
    <>
    <AppHeader />
    <div className="reading-wrap connect-page">
      <div className="reading-actions">
        <Link className="btn" href="/">← Back to bookmarks</Link>
      </div>

      <h1>Connect your AI agent</h1>
      <p className="lede">
        This archive runs an <strong>MCP server</strong> your AI agents can query directly —
        search, recommendations, your notes, full article text, all of it.
      </p>

      <h2>What is MCP?</h2>
      <p>
        The <a href="https://modelcontextprotocol.io" target="_blank" rel="noopener noreferrer">Model
        Context Protocol</a> is an open standard that lets AI assistants (Claude, Claude Code,
        and many others) call external tools. Point an MCP-capable agent at the URL below and it
        gains four tools for querying this archive — no API keys, no custom integration code.
      </p>

      <h2>Endpoint</h2>
      <CopyBlock text={mcpUrl} />
      <p className="hint">
        Every request must carry this HTTP header — in clients that ask for a header as a
        key/value pair, use exactly these two strings:
      </p>
      <CopyBlock label="Header name (key)" text="Authorization" />
      <CopyBlock label="Header value" text={`Bearer ${token}`} />
      <p className="hint">
        Streamable HTTP transport, protected by that bearer token — requests without it get a
        401. Reachable from any device that can reach this page (same Tailscale network / LAN).
      </p>

      <h2>Available tools</h2>
      <table className="tools-table">
        <tbody>
          {TOOLS.map(([sig, desc]) => (
            <tr key={sig}>
              <td><code>{sig}</code></td>
              <td>{desc}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Setup</h2>

      <h3>Claude Code (CLI)</h3>
      <CopyBlock text={`claude mcp add --transport http x-bookmarks ${mcpUrl} --header "Authorization: Bearer ${token}"`} />

      <h3>LM Studio</h3>
      <p className="hint">
        One click — LM Studio 0.3.17+ opens with this server pre-filled, you just confirm.
        Works when this page is open on the same machine LM Studio runs on.
      </p>
      <p>
        <a
          className={`btn primary lmstudio-btn${tokenReady ? "" : " disabled"}`}
          href={tokenReady ? lmStudioUrl : undefined}
          aria-disabled={!tokenReady}
        >
          Add to LM Studio
        </a>
      </p>
      <details className="lmstudio-manual">
        <summary>Or paste into LM Studio&apos;s <code>mcp.json</code> by hand</summary>
        <p className="hint">
          Program tab → <code>Install</code> → <code>Edit mcp.json</code>, then add this entry
          inside <code>&quot;mcpServers&quot;</code>:
        </p>
        <CopyBlock
          text={`"x-bookmarks": {
  "url": "${mcpUrl}",
  "headers": {
    "Authorization": "Bearer ${token}"
  }
}`}
        />
      </details>

      <h3>Project config (.mcp.json) / other MCP clients</h3>
      <CopyBlock
        text={`{
  "mcpServers": {
    "x-bookmarks": {
      "type": "http",
      "url": "${mcpUrl}",
      "headers": {
        "Authorization": "Bearer ${token}"
      }
    }
  }
}`}
      />

      <h3>Quick test (no agent needed)</h3>
      <CopyBlock
        text={`curl -s -X POST ${mcpUrl} \\
  -H 'content-type: application/json' \\
  -H 'accept: application/json, text/event-stream' \\
  -H 'authorization: Bearer ${token}' \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"search_bookmarks","arguments":{"query":"ai agents","limit":3}}}'`}
      />

      <h2>Instructions for your agent</h2>
      <p>
        Paste this into your agent's system prompt, <code>CLAUDE.md</code>, or custom
        instructions so it knows when and how to use the archive:
      </p>
      <CopyBlock text={agentInstructions} />
    </div>
    </>
  );
}
