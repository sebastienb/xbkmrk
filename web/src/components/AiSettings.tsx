"use client";

import { useState } from "react";
import type { SettingDef } from "@/lib/settings-schema";
import { SettingRow } from "./SettingField";

// AI settings, split by role:
//  - chat model (auto-tags + weekly edition copy): provider cards, then only
//    the selected provider's fields
//  - embeddings (semantic search, related/archive picks): always LM-Studio-
//    style OpenAI endpoint, with a connection test

const LMSTUDIO_DEFS: SettingDef[] = [
  { key: "TAGGING_MODEL", label: "Chat model", type: "text", placeholder: "qwen/qwen3.5-9b",
    hint: "Model id loaded in LM Studio. Blank disables tagging and digest copy. Calls .../v1/chat/completions on the embedding host below." },
];

const CODEX_DEFS: SettingDef[] = [
  { key: "CODEX_MODEL", label: "Model", type: "text", hint: "Blank = Codex default." },
  { key: "CODEX_SANDBOX", label: "Sandbox", type: "select", options: [
      { value: "read-only", label: "read-only" },
      { value: "workspace-write", label: "workspace-write" },
      { value: "danger-full-access", label: "danger-full-access" },
    ] },
];

const EMBEDDING_DEFS: SettingDef[] = [
  { key: "EMBEDDING_API_URL", label: "Endpoint", type: "text", placeholder: "http://host.docker.internal:1234/v1/embeddings" },
  { key: "EMBEDDING_API_KEY", label: "API key", type: "password" },
  { key: "EMBEDDING_MODEL", label: "Model", type: "text", placeholder: "nomic-embed-text" },
  { key: "EMBEDDING_DIM", label: "Dimensions", type: "number",
    hint: "⚠ Must match the DB schema (vector(768)). Changing it requires a column migration + re-embed." },
];

const PROVIDERS = [
  { value: "lmstudio", name: "LM Studio", sub: "Local server · OpenAI-compatible", icon: "🖥" },
  { value: "codex", name: "Codex CLI", sub: "ChatGPT plan · runs inside the poller", icon: "⬢" },
];

interface TestResult { ok: boolean; dims?: number; expected?: number; error?: string }

export default function AiSettings({
  current,
  change,
  dirty,
}: {
  current: (key: string) => string;
  change: (key: string, v: string) => void;
  dirty: boolean;
}) {
  const provider = current("LLM_PROVIDER") || "lmstudio";
  const [test, setTest] = useState<TestResult | "testing" | null>(null);

  const runTest = async () => {
    setTest("testing");
    try {
      const res = await fetch("/api/settings/test-embedding", { method: "POST" });
      setTest((await res.json()) as TestResult);
    } catch {
      setTest({ ok: false, error: "request failed" });
    }
  };

  return (
    <>
      <section className="settings-group">
        <h2>AI — chat model</h2>
        <p className="hint">Writes the auto-tags and the weekly edition&apos;s blurbs, ledes, and editor&apos;s note.</p>
        <div className="provider-cards">
          {PROVIDERS.map((p) => (
            <button
              key={p.value}
              type="button"
              className={`provider-card${provider === p.value ? " selected" : ""}`}
              onClick={() => change("LLM_PROVIDER", p.value)}
            >
              <span className="provider-icon">{p.icon}</span>
              <span className="provider-meta">
                <span className="provider-name">{p.name}</span>
                <span className="provider-sub">{p.sub}</span>
              </span>
              <span className="provider-dot" />
            </button>
          ))}
        </div>
        {(provider === "codex" ? CODEX_DEFS : LMSTUDIO_DEFS).map((def) => (
          <SettingRow key={def.key} def={def} value={current(def.key)} onChange={(v) => change(def.key, v)} />
        ))}
        {provider === "codex" && (
          <p className="hint">Needs a valid <code>codex login</code> on the host — ~/.codex is mounted into the poller container.</p>
        )}
      </section>

      <section className="settings-group">
        <h2>AI — embeddings</h2>
        <p className="hint">Powers semantic search and &quot;fits this week&quot; picks. Independent of the chat model above.</p>
        {EMBEDDING_DEFS.map((def) => (
          <SettingRow key={def.key} def={def} value={current(def.key)} onChange={(v) => change(def.key, v)} />
        ))}
        <div className="setting-test">
          <button type="button" className="btn" onClick={runTest} disabled={test === "testing"}>
            {test === "testing" ? "Testing…" : "Test connection"}
          </button>
          {test && test !== "testing" && (
            <span className="hint" style={test.ok && test.dims === test.expected ? {} : { color: "var(--danger)" }}>
              {test.ok
                ? test.dims === test.expected
                  ? `✓ Connected — ${test.dims} dimensions`
                  : `Connected, but the model returned ${test.dims} dims (expected ${test.expected})`
                : `✗ ${test.error}`}
            </span>
          )}
          {dirty && <span className="hint">Tests the saved values — save your changes first.</span>}
        </div>
      </section>
    </>
  );
}
