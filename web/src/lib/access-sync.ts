import { pool } from "@/lib/db";

// On-access sync: when someone opens the app and the archive is stale, ask the
// poller to sync (Postgres NOTIFY, same channel as the "Sync now" button).
// This replaces frequent cron polling as the main way X is checked, so credits
// are only spent when the app is actually used.
//
// Throttles: at most one DB staleness check per minute per web process, and at
// most one NOTIFY per 10 minutes — last_run_at is only bumped when a sync
// finishes, so without the second guard a failing sync (e.g. credits depleted)
// would be re-requested on every page load.
let lastCheckAt = 0;
let lastNotifyAt = 0;

export function maybeRequestSync(): void {
  const now = Date.now();
  if (now - lastCheckAt < 60_000) return;
  lastCheckAt = now;
  check().catch((err) => console.error("on-access sync check failed:", err));
}

async function check(): Promise<void> {
  const { rows } = await pool.query(
    `select (select value from app_settings where key = 'SYNC_ON_ACCESS_HOURS') as hours,
            (select last_run_at from sync_state where id = 1) as last_run_at`,
  );
  const hours = parseInt(rows[0]?.hours ?? process.env.SYNC_ON_ACCESS_HOURS ?? "6", 10);
  if (!(hours > 0)) return; // disabled (0, negative, or unparsable)

  const last = rows[0]?.last_run_at ? new Date(rows[0].last_run_at).getTime() : 0;
  if (Date.now() - last < hours * 3600_000) return;
  if (Date.now() - lastNotifyAt < 10 * 60_000) return;
  lastNotifyAt = Date.now();

  console.log("archive stale on app access — requesting sync");
  await pool.query("notify sync_request");
}
