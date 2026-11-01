"use client";

import { useEffect, useState } from "react";

// Per-accent swatch hexes (mirror the palettes in globals.css)
const ACCENTS = [
  { id: "indigo", name: "Indigo", light: "#5b5bd6", dark: "#8b90ff" },
  { id: "coral", name: "Coral", light: "#d4511e", dark: "#ff8f6d" },
  { id: "sky", name: "Sky", light: "#0b74d1", dark: "#58a6ff" },
  { id: "mono", name: "Mono", light: "#18181b", dark: "#e4e4e7" },
] as const;

// Browser-local appearance prefs (theme + accent), applied instantly via
// <html data-*> and persisted to localStorage — separate from server settings.
export default function AppearanceSettings() {
  const [theme, setTheme] = useState<string | null>(null);
  const [accent, setAccent] = useState<string | null>(null);

  useEffect(() => {
    setTheme(document.documentElement.dataset.theme ?? "dark");
    setAccent(document.documentElement.dataset.accent ?? "indigo");
  }, []);

  const pickTheme = (t: "light" | "dark") => {
    document.documentElement.dataset.theme = t;
    localStorage.setItem("theme", t);
    setTheme(t);
  };

  const pickAccent = (a: string) => {
    document.documentElement.dataset.accent = a;
    localStorage.setItem("accent", a);
    setAccent(a);
  };

  return (
    <section className="settings-group">
      <h2>Appearance</h2>
      <p className="hint">Saved in this browser — not part of the server config.</p>
      <div className="setting-row">
        <label>Theme</label>
        <div className="seg" role="radiogroup" aria-label="Theme">
          {(["light", "dark"] as const).map((t) => (
            <button
              key={t}
              type="button"
              className={t === theme ? "active" : ""}
              aria-pressed={t === theme}
              onClick={() => pickTheme(t)}
            >
              {t === "light" ? "Light" : "Dark"}
            </button>
          ))}
        </div>
      </div>
      <div className="setting-row">
        <label>Accent</label>
        <div className="swatch-row" role="radiogroup" aria-label="Accent color">
          {ACCENTS.map((a) => (
            <button
              key={a.id}
              type="button"
              className={"swatch" + (a.id === accent ? " selected" : "")}
              aria-pressed={a.id === accent}
              onClick={() => pickAccent(a.id)}
            >
              <span
                className="swatch-dot"
                style={{ background: theme === "light" ? a.light : a.dark }}
              />
              {a.name}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
