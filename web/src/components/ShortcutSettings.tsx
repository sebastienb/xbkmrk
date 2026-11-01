"use client";

import { useEffect, useState } from "react";
import { copyText } from "@/lib/copy";

// iOS share-sheet saving via the Shortcuts app: a one-action shortcut that
// POSTs the shared page's URL to /api/save (JSON, token-authed — same
// SAVE_TOKEN the bookmarklet uses). The address is editable because the
// phone must reach the archive on ITS network path (Tailscale name, LAN
// address…), which may differ from the address this page was opened at.
export default function ShortcutSettings() {
  const [token, setToken] = useState<string | null>(null);
  const [appOrigin, setAppOrigin] = useState("");
  const [copied, setCopied] = useState<"url" | "prompt" | null>(null);

  useEffect(() => setAppOrigin(window.location.origin), []);
  useEffect(() => {
    fetch("/api/save-token")
      .then((r) => r.json())
      .then(({ token }) => token && setToken(token))
      .catch(() => {});
  }, []);

  const saveUrl = token ? `${appOrigin.replace(/\/+$/, "")}/api/save?token=${token}` : null;

  // Self-contained natural-language spec (url included) — paste into the
  // Shortcuts app's AI "describe a shortcut" creator and it builds the whole
  // thing; also readable as a recipe by a human or any other assistant.
  const aiPrompt = saveUrl
    ? `Create a shortcut named "Save to Archive".

It is a Share Sheet shortcut: turn on "Show in Share Sheet" and accept URLs and Safari web pages as input.

It has a single action, "Get Contents of URL", configured as:
- URL: ${saveUrl}
- Method: POST
- Request Body: JSON, with exactly one field — key "url", value set to the Shortcut Input variable.

No other actions are needed and it should not display any output. When I share a page from Safari (or a link from any app) and pick "Save to Archive", the shortcut sends that page's URL to my personal bookmark archive, which saves it.`
    : null;

  const copy = async (text: string | null, which: "url" | "prompt") => {
    if (!text) return;
    await copyText(text);
    setCopied(which);
    setTimeout(() => setCopied(null), 1500);
  };

  return (
    <section className="settings-group">
      <h2>Save from iPhone &amp; iPad</h2>
      <p className="hint">
        A one-action Shortcut adds &ldquo;Save to Archive&rdquo; to the iOS share sheet — share any
        page from Safari (or a link from any app) and it lands in your Saves, with content,
        thumbnail, and tags extracted automatically. Your device must be able to reach the
        address below (same Wi&#8209;Fi, or Tailscale on the phone).
      </p>

      <p style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
        <span className="setting-input" style={{ flex: "1 1 14rem" }}>
          <input
            type="text"
            value={appOrigin}
            onChange={(e) => setAppOrigin(e.target.value)}
            placeholder="http://your-server:3020"
            aria-label="Archive address the phone should use"
          />
        </span>
        <button className="btn primary" onClick={() => copy(aiPrompt, "prompt")} disabled={!saveUrl}>
          {copied === "prompt" ? "Copied ✓" : token ? "✨ Copy AI prompt" : "Generating token…"}
        </button>
        <button className="btn" onClick={() => copy(saveUrl, "url")} disabled={!saveUrl}>
          {copied === "url" ? "Copied ✓" : "Copy save URL"}
        </button>
      </p>
      <p className="hint">
        <b>Easiest way</b>: tap <b>✨ Copy AI prompt</b> above, then in the Shortcuts app ask the
        AI to create a shortcut and paste the prompt — it contains everything, including your
        save URL, and the shortcut is built for you. Prefer doing it by hand? Follow the steps
        below with <b>Copy save URL</b>.
      </p>
      {saveUrl && (
        <p className="hint">
          The save URL (address + secret token): <code style={{ overflowWrap: "anywhere" }}>{saveUrl}</code>
        </p>
      )}

      <p className="hint" style={{ marginTop: "1rem", marginBottom: "0.25rem" }}>
        <b>Build the Shortcut</b> (once, ~1 minute):
      </p>
      <ol className="hint" style={{ margin: "0 0 0.5rem", paddingLeft: "1.3rem", lineHeight: 1.7 }}>
        <li>
          Open the <b>Shortcuts</b> app → <b>+</b> to create a new shortcut. Rename it{" "}
          <b>Save to Archive</b> — that name is what appears in the share sheet.
        </li>
        <li>
          Tap the <b>ⓘ</b> info button → turn on <b>Show in Share Sheet</b>. In the{" "}
          <i>Receive input</i> box that appears at the top, limit the types to <b>URLs</b> and{" "}
          <b>Safari web pages</b>.
        </li>
        <li>
          Add the action <b>Get Contents of URL</b> and paste the save URL (copied above) into
          its URL field.
        </li>
        <li>
          Tap <b>Show More</b> on that action: set Method to <b>POST</b>, Request Body to{" "}
          <b>JSON</b>, then add one field — type <b>Text</b>, key <code>url</code>, and for the
          value pick the <b>Shortcut Input</b> variable (tap the value box → select variable).
        </li>
        <li>
          Done. In Safari, tap Share → <b>Save to Archive</b>. A second field with key{" "}
          <code>text</code> is optional — anything in it is saved as a note, like the
          bookmarklet&apos;s captured selection.
        </li>
      </ol>
      <p className="hint">
        The URL embeds the secret token — treat it like a password. It&apos;s the same token the
        bookmarklet uses.
      </p>
    </section>
  );
}
