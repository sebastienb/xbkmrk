"use client";

import { useEffect, useState } from "react";
import { SETTING_GROUPS } from "@/lib/settings-schema";
import { SettingRow } from "./SettingField";
import AiSettings from "./AiSettings";

export default function SettingsForm() {
  const [values, setValues] = useState<Record<string, string> | null>(null);
  const [dirty, setDirty] = useState<Record<string, string>>({});
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((d) => setValues(d.values))
      .catch(() => setState("error"));
  }, []);

  if (!values) return <div className="feed-status">{state === "error" ? "Failed to load settings." : "Loading settings…"}</div>;

  const current = (key: string) => dirty[key] ?? values[key] ?? "";
  const change = (key: string, v: string) => {
    setDirty((d) => ({ ...d, [key]: v }));
    setState("idle");
  };

  const save = async () => {
    if (Object.keys(dirty).length === 0) return;
    setState("saving");
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(dirty),
      });
      if (!res.ok) throw new Error();
      setValues((v) => ({ ...v!, ...dirty }));
      setDirty({});
      setState("saved");
    } catch {
      setState("error");
    }
  };

  const dirtyCount = Object.keys(dirty).length;

  return (
    <div className="settings-form">
      {SETTING_GROUPS.map((g) => (
        <div key={g.title}>
          <section className="settings-group">
            <h2>{g.title}</h2>
            {g.blurb && <p className="hint">{g.blurb}</p>}
            {g.defs.map((def) => (
              <SettingRow key={def.key} def={def} value={current(def.key)} onChange={(v) => change(def.key, v)} />
            ))}
          </section>
          {/* the AI sections (provider cards + embeddings) sit after Sync */}
          {g.title === "Sync" && <AiSettings current={current} change={change} dirty={dirtyCount > 0} />}
        </div>
      ))}

      <div className="settings-save">
        <button className="btn primary" onClick={save} disabled={dirtyCount === 0 || state === "saving"}>
          {state === "saving" ? "Saving…" : dirtyCount > 0 ? `Save ${dirtyCount} change${dirtyCount > 1 ? "s" : ""}` : "Saved"}
        </button>
        {state === "saved" && <span className="hint">✓ Saved — the poller reloads instantly; schedules re-arm on the new cron/timezone.</span>}
        {state === "error" && <span className="hint" style={{ color: "var(--danger)" }}>Save failed — check the web container logs.</span>}
      </div>

      <p className="hint settings-foot">
        These values live in the database and override <code>.env</code>. Infrastructure settings (database password,
        ports, media path) remain in <code>.env</code> — they are needed before the database is reachable. The MCP
        server still reads its env at boot: restart it after changing embedding settings.
      </p>
    </div>
  );
}
