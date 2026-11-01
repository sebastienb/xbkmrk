"use client";

import { useEffect, useState } from "react";

interface Usage {
  month_posts: number;
  month_requests: number;
  last_posts: number;
  last_requests: number;
  last_at: string | null;
  // X's own numbers for the whole project, when an app bearer token is set
  official: {
    project_cap: number;
    project_usage: number;
    cap_reset_day: number | null;
    fetched_at: string;
  } | null;
  cost_per_1k: number | null;
  monthly_cap: number | null;
}

function dollars(posts: number, per1k: number | null): string | null {
  if (!per1k) return null;
  return `~$${((posts / 1000) * per1k).toFixed(2)}`;
}

// Reads /api/usage. Two data sources, best shown together: X's official
// project usage (authoritative, includes every client of the project, real
// billing cycle) when the app bearer token is configured, plus our own
// per-request log (has last-sync granularity the official numbers lack).
export default function XUsageMeter() {
  const [usage, setUsage] = useState<Usage | null>(null);

  useEffect(() => {
    fetch("/api/usage")
      .then((r) => (r.ok ? r.json() : null))
      .then((u) => u && !u.error && setUsage(u))
      .catch(() => {});
  }, []);

  if (!usage) return null;

  const off = usage.official;
  // official cap wins over the hand-set budget; both drive the same bar
  const barCap = off?.project_cap ?? usage.monthly_cap;
  const barUsed = off ? off.project_usage : usage.month_posts;
  const pct = barCap ? Math.min(100, (barUsed / barCap) * 100) : null;
  const remaining = off ? Math.max(0, off.project_cap - off.project_usage) : null;
  const lastCost = dollars(usage.last_posts, usage.cost_per_1k);

  return (
    <section className="settings-group">
      <h2>X API usage</h2>
      <p className="hint">
        Posts read from the X API — that&apos;s what X bills for, per post, not per request.
        {off && " Balance shown is X's own count for the whole project."}
      </p>
      {!off && !usage.last_at && (
        <p className="hint">
          Nothing recorded yet — numbers appear after the next sync (open the app after a few
          hours away, or use ⟳ in the status menu).
        </p>
      )}
      {pct !== null && (
        <div
          className="usage-bar"
          role="meter"
          aria-valuemin={0}
          aria-valuemax={barCap!}
          aria-valuenow={barUsed}
          aria-label="Posts read this cycle"
        >
          <div
            className={"usage-fill" + (pct >= 100 ? " over" : pct >= 80 ? " warn" : "")}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
      <div className="usage-stats">
        {off ? (
          <>
            <div>
              <b>{remaining!.toLocaleString()}</b>
              <span>posts remaining{dollars(remaining!, usage.cost_per_1k) ? ` · ${dollars(remaining!, usage.cost_per_1k)} left` : ""}</span>
            </div>
            <div>
              <b>{off.project_usage.toLocaleString()}</b>
              <span>
                used of {off.project_cap.toLocaleString()}
                {off.cap_reset_day ? ` · resets day ${off.cap_reset_day}` : ""}
              </span>
            </div>
          </>
        ) : (
          <>
            <div>
              <b>{usage.month_posts.toLocaleString()}</b>
              <span>
                posts this month
                {usage.monthly_cap ? ` of ${usage.monthly_cap.toLocaleString()}` : ""}
                {dollars(usage.month_posts, usage.cost_per_1k) ? ` · ${dollars(usage.month_posts, usage.cost_per_1k)}` : ""}
              </span>
            </div>
            <div>
              <b>{usage.month_requests.toLocaleString()}</b>
              <span>requests this month</span>
            </div>
          </>
        )}
        <div>
          <b>{usage.last_posts.toLocaleString()}</b>
          <span>posts last sync{lastCost ? ` · ${lastCost}` : ""}</span>
        </div>
      </div>
      {!off && (
        <p className="hint">
          Paste your app&apos;s <b>App bearer token</b> in the X API section below to show X&apos;s
          official remaining balance here (exact, all clients, real billing cycle).
          {!usage.monthly_cap && (
            <> Or set <b>Monthly post budget</b> for a gauge bar based on local counting.</>
          )}
          {!usage.cost_per_1k && (
            <> Set <b>Cost per 1,000 posts read</b> to see $ estimates next to each number.</>
          )}
        </p>
      )}
    </section>
  );
}
