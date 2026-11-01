import cron, { ScheduledTask } from "node-cron";
import { env } from "./env.js";
import { pool, lastSyncAt } from "./db.js";
import { runSync, runBackfills, shutdown } from "./sync.js";
import { refreshOfficialUsage } from "./xclient.js";
import { generateDigest, digestOverdue } from "./digest.js";
import { initSettings, loadSettings } from "./settings.js";
import { syncExternalSources, sourcesFingerprint } from "./sources/index.js";
import { deleteMediaFor } from "./media.js";

const once = process.argv.includes("--once");
const digestOnce = process.argv.includes("--digest");

let running = false;
async function guardedSync() {
  if (running) {
    console.warn("previous sync still running — skipping this tick");
    return;
  }
  running = true;
  try {
    await runSync();
  } catch (err) {
    console.error("sync failed:", err);
  } finally {
    running = false;
  }
}

// Local pipeline (enrich/embed/tag) for bookmarklet saves — no X API calls.
// A request landing mid-run marks pending so nothing saved during a run is missed.
let backfillsRunning = false;
let backfillsPending = false;
async function guardedBackfills() {
  if (backfillsRunning) {
    backfillsPending = true;
    return;
  }
  backfillsRunning = true;
  try {
    do {
      backfillsPending = false;
      await runBackfills();
    } while (backfillsPending);
  } catch (err) {
    console.error("backfills failed:", err);
  } finally {
    backfillsRunning = false;
  }
}

// External sources only (no X API) — run when their settings change so a
// playlist added in the UI shows up right away, not at the next sync.
let sourcesFp = "";
let sourcesRunning = false;
async function guardedSourcesSync() {
  if (sourcesRunning) return;
  sourcesRunning = true;
  try {
    await syncExternalSources();
    // always run — source backfills must react to settings changes too
    // (e.g. transcripts toggled on with all videos already ingested)
    await runBackfills();
  } catch (err) {
    console.error("source sync failed:", err);
  } finally {
    sourcesRunning = false;
  }
}

let digestRunning = false;
async function guardedDigest() {
  if (digestRunning) {
    console.warn("digest generation already running — skipping");
    return;
  }
  digestRunning = true;
  try {
    await generateDigest();
  } catch (err) {
    console.error("digest failed:", err);
  } finally {
    digestRunning = false;
  }
}

// Cron tasks are rebuilt whenever settings change (schedule or TZ may have
// moved). An invalid expression keeps the previous task alive.
let syncTask: ScheduledTask | null = null;
let digestTask: ScheduledTask | null = null;

function scheduleTask(prev: ScheduledTask | null, expr: string, fn: () => void, label: string): ScheduledTask | null {
  if (!expr) {
    prev?.stop();
    console.log(`${label} schedule disabled (empty cron) — on-access/manual only`);
    return null;
  }
  if (!cron.validate(expr)) {
    console.error(`invalid ${label} cron "${expr}" — keeping previous schedule`);
    return prev;
  }
  prev?.stop();
  return cron.schedule(expr, fn, { timezone: env.tz });
}

function scheduleAll() {
  syncTask = scheduleTask(syncTask, env.syncCron, guardedSync, "sync");
  digestTask = scheduleTask(digestTask, env.digestCron, guardedDigest, "digest");
}

// The web UI talks to us via Postgres NOTIFY: "Sync now" → sync_request,
// digest "Generate now" → digest_request, settings saved → settings_changed.
async function listenForRequests() {
  const client = await pool.connect();
  await client.query("listen sync_request");
  await client.query("listen digest_request");
  await client.query("listen settings_changed");
  await client.query("listen enrich_request");
  await client.query("listen media_cleanup");
  client.on("notification", (msg) => {
    if (msg.channel === "enrich_request") {
      console.log("enrichment requested (web save)");
      guardedBackfills();
    } else if (msg.channel === "media_cleanup") {
      // a bookmark was deleted in the web app — remove its files
      const id = msg.payload ?? "";
      console.log(`media cleanup requested for ${id}`);
      deleteMediaFor(id).catch((err) => console.error(`media cleanup ${id}:`, err));
    } else if (msg.channel === "digest_request") {
      console.log("digest requested via UI");
      guardedDigest();
    } else if (msg.channel === "settings_changed") {
      console.log("settings changed via UI — reloading");
      loadSettings()
        .then(() => {
          scheduleAll();
          console.log(`schedules now — sync: ${env.syncCron}, digest: ${env.digestCron} (${env.tz})`);
          const fp = sourcesFingerprint();
          if (fp !== sourcesFp) {
            sourcesFp = fp;
            console.log("source config changed — checking external sources now");
            guardedSourcesSync();
          }
          // free call (reads no posts) — a freshly pasted bearer token shows
          // the official balance immediately, no sync needed
          refreshOfficialUsage();
        })
        .catch((err) => console.error("settings reload failed:", err));
    } else {
      console.log("sync requested via UI");
      guardedSync();
    }
  });
  client.on("error", (err) => {
    console.error("request listener lost:", err.message);
    setTimeout(() => listenForRequests().catch(console.error), 5_000);
  });
}

async function main() {
  await initSettings();
  sourcesFp = sourcesFingerprint();

  if (once) {
    await guardedSync();
    return shutdown();
  }
  if (digestOnce) {
    await guardedDigest();
    return shutdown();
  }

  console.log(`poller up — sync: ${env.syncCron || "(on access)"}, digest: ${env.digestCron} (TZ ${env.tz})`);
  // Boot sync only when data is actually stale — a container restart must not
  // spend X API credits (each sync reads posts even when nothing is new).
  lastSyncAt()
    .then((last) => {
      const staleMs = Math.max(env.syncOnAccessHours, 1) * 3600_000;
      if (!last || Date.now() - last.getTime() > staleMs) {
        console.log("sync overdue — running at boot");
        return guardedSync();
      }
      console.log(`skipping boot sync — last run ${last.toISOString()} is recent`);
    })
    .catch((err) => console.error("boot sync check failed:", err));
  scheduleAll();
  refreshOfficialUsage().catch(() => {});
  // catch up if the poller was down at digest time (or no edition exists yet)
  digestOverdue()
    .then((overdue) => {
      if (overdue) {
        console.log("digest overdue — generating now");
        return guardedDigest();
      }
    })
    .catch((err) => console.error("digest catch-up check failed:", err));
  listenForRequests().catch((err) => console.error("request listener failed:", err));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
