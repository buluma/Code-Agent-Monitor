/**
 * @file Keep Codex rollout transcripts current with a debounced filesystem
 * watcher plus a small safety-net poll. Codex hooks call the same incremental
 * ingestor, so repeated notifications are harmless: its durable byte cursor
 * means an unchanged file performs no token/event writes and emits no
 * websocket frames. Fresh files are prioritized and the sweep reads Codex's
 * native live-thread index first, so a large historical rollout tree cannot
 * delay a new card. Unref'd so it never blocks shutdown.
 * @author Michael Buluma <1452922+buluma@users.noreply.github.com>
 */

const fs = require("fs");
const path = require("path");
const { getCodexHome, getCodexSessionsDir, onCodexHomeChanged } = require("./codex-home");
const {
  findCodexTranscripts,
  ingestCodexToolEvents,
  ingestCodexTranscript,
  reconcileCodexSessionLiveness,
  refreshCodexSessionTitles,
  syncCodexStateSessions,
} = require("./codex-ingest");
const liveness = require("./session-liveness");
const { makeCoalescedRunner } = require("./sweep-coalescer");

/**
 * Should a change under the Codex home schedule a discovery sweep?
 *
 * Matches the session index and the Codex state database, but DELIBERATELY NOT
 * its `-shm` sidecar: SQLite touches the wal-index on every WAL-mode reader
 * open — including the sweep's own read-only open of that same database — so
 * treating `-shm` as a trigger makes each sweep schedule the next one. That is
 * a self-sustaining full-scan loop (directory walk + state-DB read + a
 * synchronous `ps` probe) which runs forever with no Codex process and no user
 * activity; it measured ~40% of all CPU profile samples (issue #295). Durable
 * changes always land in the main database file or its `-wal`, both of which
 * still match.
 *
 * A null/absent filename (some platforms and filesystems omit it) still
 * triggers, so the watcher never goes blind — the debounce, not this filter,
 * is the platform-independent frequency cap.
 */
function codexHomeChangeTriggersSweep(filename) {
  const name = filename && path.basename(String(filename));
  if (!name) return true;
  return name === "session_index.jsonl" || /^state_\d+\.sqlite(?:-wal)?$/.test(name);
}

function startCodexSessionSync({ broadcast }) {
  const fingerprints = new Map();
  // The response-item tool-call backfill (ingestCodexToolEvents) keeps its own
  // byte cursor, so semantically it is safe to call every sweep — but its
  // "no-op" early exit still costs a statSync plus two DB lookups per file.
  // Across thousands of historical rollouts every 4s that is a constant CPU
  // tax. Run it for every file once per process (backfill), then only for
  // files whose fingerprint changed — plus any file whose last tool-event
  // ingest threw, so a transient failure retries instead of being skipped
  // until the file happens to grow.
  let toolBackfillDone = false;
  const toolIngestFailed = new Set();
  let watcher = null;
  let watchedSessionsDir = null;
  let homeWatcher = null;
  let watchedCodexHome = null;

  function publish(result) {
    if (!result?.changed || !result.session) return;
    broadcast(result.created ? "session_created" : "session_updated", result.session);
    if (result.agent) broadcast(result.created ? "agent_created" : "agent_updated", result.agent);
    for (const event of result.events || []) broadcast("new_event", event);
  }

  const runSweep = makeCoalescedRunner(async () => {
    try {
      const sessionsDir = getCodexSessionsDir();
      // A newly selected Codex home may not contain `sessions/` yet. Retry
      // watcher attachment on each safety-net sweep so it becomes event-driven
      // as soon as Codex creates the directory instead of polling forever.
      watchSessionsDir();
      watchCodexHome();
      const rolloutProbe = liveness.probeLiveCodexRollouts();
      const liveTranscripts = rolloutProbe.available ? rolloutProbe.paths : null;
      // Hooks are the lowest-latency signal, but Codex may delay a new hook
      // until the user approves it. Its local thread row is written at CLI
      // launch, so use it to create the same Waiting card immediately.
      for (const result of syncCodexStateSessions()) publish(result);
      // `/rename` updates Codex's root-level session index instead of adding a
      // rollout line. Refresh those titles before evaluating transcript bytes
      // so cards change in real time even for an otherwise idle session.
      for (const result of refreshCodexSessionTitles()) publish(result);
      const transcripts = findCodexTranscripts(sessionsDir);
      for (let index = 0; index < transcripts.length; index++) {
        const transcriptPath = transcripts[index];
        let stat;
        try {
          stat = fs.statSync(transcriptPath);
        } catch {
          continue;
        }
        const fingerprint = `${stat.size}:${stat.mtimeMs}`;
        const changed = fingerprints.get(transcriptPath) !== fingerprint;
        if (changed) {
          try {
            // Only retain a successful fingerprint. A temporarily unreadable or
            // malformed rollout must retry on the next sweep rather than being
            // silently skipped until another byte happens to arrive. Two
            // failure shapes exist and BOTH must skip the fingerprint: a thrown
            // error, and an I/O error the ingestor swallows and reports as
            // `failed` (it returns `{changed:false}` for legitimate no-ops too,
            // so the flag is the only way to tell them apart).
            const ingestResult = ingestCodexTranscript(transcriptPath, { liveTranscripts });
            publish(ingestResult);
            if (!ingestResult?.failed) fingerprints.set(transcriptPath, fingerprint);
          } catch (err) {
            console.warn(
              `[CODEX SYNC] Failed to ingest ${path.basename(transcriptPath)}:`,
              err.message
            );
          }
        }
        if (changed || !toolBackfillDone || toolIngestFailed.has(transcriptPath)) {
          try {
            // This independent cursor backfills response-item tool calls from
            // rollouts imported before Workflows understood Codex. It is a
            // no-op after the first pass, and also catches records that arrive
            // without one of Codex's lower-volume lifecycle event messages —
            // hence the full pass once per process, then changed-files-only.
            // A failure re-queues the file so it retries every sweep until it
            // succeeds — the same retry property the main-ingest fingerprint
            // above deliberately keeps. Two shapes of failure exist and BOTH
            // must re-queue: a thrown error (e.g. transient SQLITE_BUSY), and
            // an I/O error the ingestor swallows internally and reports as
            // `failed` (it returns `{changed:false}` for legitimate no-ops
            // too, so the flag is the only way to tell them apart — without it
            // a transient read error would clear the marker and the file's
            // tool calls would stay unindexed until it next grew).
            const toolResult = ingestCodexToolEvents(transcriptPath);
            publish(toolResult);
            if (toolResult?.failed) {
              toolIngestFailed.add(transcriptPath);
            } else {
              toolIngestFailed.delete(transcriptPath);
            }
          } catch (err) {
            toolIngestFailed.add(transcriptPath);
            console.warn(
              `[CODEX SYNC] Failed to index tools for ${path.basename(transcriptPath)}:`,
              err.message
            );
          }
        }
        // Cold history can contain hundreds of large JSONL files. Yielding in
        // modest batches lets fs.watch/hook callbacks and WebSocket delivery
        // run between imports while preserving the single-sweep cursor guard.
        if (index > 0 && index % 12 === 0) {
          await new Promise((resolve) => setImmediate(resolve));
        }
      }
      // Only after one complete pass over every discovered transcript has the
      // backfill actually covered the full corpus.
      toolBackfillDone = true;
      for (const result of reconcileCodexSessionLiveness()) publish(result);
    } catch {
      // Codex is optional; an unreadable/missing home must not affect startup.
    }
  });

  const initial = setTimeout(() => void runSweep(), 300);
  if (initial.unref) initial.unref();

  const pollMs = process.env.DASHBOARD_CODEX_SYNC_MS
    ? Number(process.env.DASHBOARD_CODEX_SYNC_MS)
    : 4_000;
  if (Number.isFinite(pollMs) && pollMs > 0) {
    const timer = setInterval(() => void runSweep(), pollMs);
    if (timer.unref) timer.unref();
  }

  let debounce;
  const schedule = () => {
    if (debounce) return;
    // A live Codex process appends to its WAL near-continuously; each sweep is
    // a full discovery pass (directory walk + state-DB read + `ps` probe), so
    // coalesce watcher bursts to at most ~1 sweep/second rather than one per
    // 150ms. Sub-second card latency isn't worth a background full scan loop.
    debounce = setTimeout(() => {
      debounce = null;
      void runSweep();
    }, 1_000);
    if (debounce.unref) debounce.unref();
  };
  function watchSessionsDir() {
    const sessionsDir = getCodexSessionsDir();
    if (sessionsDir !== watchedSessionsDir) {
      try {
        watcher?.close();
      } catch {
        // A stale watcher is optional; polling remains the real-time safety net.
      }
      watcher = null;
      watchedSessionsDir = sessionsDir;
    }
    if (watcher) return;
    try {
      if (fs.existsSync(sessionsDir)) {
        const recursive = process.platform === "darwin" || process.platform === "win32";
        const nextWatcher = fs.watch(sessionsDir, { recursive }, schedule);
        watcher = nextWatcher;
        nextWatcher.on("error", () => {
          // Only retire this watcher: an error from a recently closed previous
          // directory must not detach a newer watch after a home change.
          if (watcher !== nextWatcher) return;
          try {
            nextWatcher.close();
          } catch {
            // The next polling sweep retries attachment either way.
          }
          watcher = null;
        });
        if (nextWatcher.unref) nextWatcher.unref();
      }
    } catch {
      // The poll remains the fallback on filesystems without watcher support.
    }
  }
  function watchCodexHome() {
    const codexHome = getCodexHome();
    if (codexHome !== watchedCodexHome) {
      try {
        homeWatcher?.close();
      } catch {
        // Polling remains the fallback if a previous watcher cannot close.
      }
      homeWatcher = null;
      watchedCodexHome = codexHome;
    }
    if (homeWatcher || !fs.existsSync(codexHome)) return;
    try {
      const nextWatcher = fs.watch(codexHome, { recursive: false }, (_event, filename) => {
        if (codexHomeChangeTriggersSweep(filename)) schedule();
      });
      homeWatcher = nextWatcher;
      nextWatcher.on("error", () => {
        if (homeWatcher !== nextWatcher) return;
        try {
          nextWatcher.close();
        } catch {
          // The polling sweep will retry this optional watcher.
        }
        homeWatcher = null;
      });
      if (nextWatcher.unref) nextWatcher.unref();
    } catch {
      // The polling sweep remains the title-sync safety net.
    }
  }
  watchSessionsDir();
  watchCodexHome();

  // Settings can repoint Codex while the dashboard is running. Clear old-file
  // fingerprints, re-arm the watcher, and schedule a fresh sweep after the
  // response has been sent so a large history never delays the UI action.
  onCodexHomeChanged(() => {
    fingerprints.clear();
    toolBackfillDone = false; // new home → new corpus needs one full backfill pass
    toolIngestFailed.clear();
    watchSessionsDir();
    watchCodexHome();
    setImmediate(() => void runSweep());
  });
}

module.exports = { codexHomeChangeTriggersSweep, startCodexSessionSync };
