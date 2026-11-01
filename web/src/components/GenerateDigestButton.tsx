"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

interface PressStatus {
  running: boolean;
  note: string | null;
  latestIssueId: number | null;
}

// "Print a fresh edition" button + live press status. Generation runs the
// local LLM over every post, so it takes minutes: while the poller reports
// running we poll the status endpoint and show its progress note, then
// refresh the page when a new issue lands.
export default function GenerateDigestButton() {
  const router = useRouter();
  const [status, setStatus] = useState<PressStatus | null>(null);
  const [requested, setRequested] = useState(false);
  const [error, setError] = useState(false);
  const seenIssue = useRef<number | null | undefined>(undefined); // undefined = no baseline yet

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/digest");
      if (!res.ok) return;
      const s: PressStatus = await res.json();
      if (seenIssue.current === undefined) {
        seenIssue.current = s.latestIssueId;
      } else if (s.latestIssueId !== seenIssue.current) {
        seenIssue.current = s.latestIssueId;
        router.refresh(); // hot off the press — re-render the edition
      }
      if (s.running) setRequested(false);
      setStatus(s);
    } catch {
      /* transient — next poll retries */
    }
  }, [router]);

  useEffect(() => {
    load();
  }, [load]);

  // poll only while something is (or should be) happening
  const active = Boolean(status?.running) || requested;
  useEffect(() => {
    if (!active) return;
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [active, load]);

  const request = async () => {
    setError(false);
    try {
      const res = await fetch("/api/digest", { method: "POST" });
      if (!res.ok) throw new Error();
      setRequested(true);
    } catch {
      setError(true);
    }
  };

  if (status?.running) {
    return (
      <span className="np-press-note">
        🗞️ The presses are rolling — {status.note ?? "working"}…
      </span>
    );
  }
  if (requested) {
    return <span className="np-press-note">🗞️ Edition requested — waiting for the press to start…</span>;
  }
  return (
    <button className="btn" onClick={request}>
      🗞️ {error ? "Failed — try again" : "Print a fresh edition now"}
    </button>
  );
}
