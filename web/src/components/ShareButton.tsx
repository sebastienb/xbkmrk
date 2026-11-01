"use client";

import { useEffect, useState } from "react";
import { copyText } from "@/lib/copy";

// Native share sheet via the Web Share API. The API only exists in secure
// contexts (https) — when unavailable (the usual case on a LAN http address)
// the button copies the link instead.
export default function ShareButton({
  title,
  url,
  variant = "act",
}: {
  title: string;
  url: string;
  variant?: "act" | "btn";
}) {
  const [canShare, setCanShare] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setCanShare(typeof navigator !== "undefined" && !!navigator.share);
  }, []);

  const share = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (canShare) {
      try {
        await navigator.share({ title, url });
      } catch {
        /* user dismissed the sheet */
      }
      return;
    }
    await copyText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const tooltip = canShare ? "Share" : "Copy link";

  if (variant === "btn") {
    return (
      <button className="btn" onClick={share} title={tooltip}>
        {canShare ? "⤴ Share" : copied ? "✓ Copied" : "🔗 Copy link"}
      </button>
    );
  }
  return (
    <button className="act" onClick={share} title={copied ? "Copied ✓" : tooltip}>
      {canShare ? "⤴" : copied ? "✓" : "🔗"}
    </button>
  );
}
