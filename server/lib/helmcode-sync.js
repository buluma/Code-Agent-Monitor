/**
 * @file Keep Helm Code's `~/.helmcode/userdata/state.sqlite` projection in sync.
 * Helm Code is a read-only provider: its own server already persists durable
 * orchestration events, so this pipeline mirrors those projections
 * (messages/activities/turns) into dashboard rows instead of relying on
 * script-instrumented hooks. Every sweep is cursor-gated and dedupe-keyed, so
 * an unchanged state DB performs no writes and emits no websocket frames — the
 * same no-op property Codex's byte cursor gives its watcher path. Unref'd so it
 * never blocks shutdown.
 * @author Michael Buluma <1452922+buluma@users.noreply.github.com>
 */

const fs = require("fs");
const path = require("path");
const { getHelmcodeUserDataDir, onHelmcodeHomeChanged } = require("./helmcode-home");
const { syncHelmcodeSessions, reconcileHelmcodeLiveness } = require("./helmcode-ingest");
const { makeCoalescedRunner } = require("./sweep-coalescer");

function startHelmcodeSync({ broadcast }) {
  let watcher = null;
  let watchedStateDir = null;

  function publish(result) {
    if (!result?.changed) return;
    if (result.removed) {
      // A deleted/archived Helm Code thread removes its session (and cascades
      // agents/events/messages). Signal the removal explicitly so every board
      // drops the card instead of repainting it at completion.
      broadcast("session_removed", { id: result.id, provider: result.provider });
      return;
    }
    if (!result.session) return;
    broadcast(result.created ? "session_created" : "session_updated", result.session);
    if (result.agent) broadcast(result.created ? "agent_created" : "agent_updated", result.agent);
    for (const event of result.events || []) broadcast("new_event", event);
  }

  const runSweep = makeCoalescedRunner(async () => {
    try {
      watchHelmcodeStateDir();
      // Deleted/archived threads are wiped first so a client that still holds a
      // card for them sees a removal frame, then live drift is republished.
      for (const result of reconcileHelmcodeLiveness()) publish(result);
      for (const result of syncHelmcodeSessions()) publish(result);
    } catch {
      // Helm Code is optional; an unreadable/missing home must not affect
      // startup or the Claude/Codex sync paths.
    }
  });

  const initial = setTimeout(() => void runSweep(), 300);
  if (initial.unref) initial.unref();

  const pollMs = process.env.DASHBOARD_HELMCODE_SYNC_MS
    ? Number(process.env.DASHBOARD_HELMCODE_SYNC_MS)
    : 4_000;
  if (Number.isFinite(pollMs) && pollMs > 0) {
    const timer = setInterval(() => void runSweep(), pollMs);
    if (timer.unref) timer.unref();
  }

  let debounce;
  const schedule = () => {
    if (debounce) return;
    debounce = setTimeout(() => {
      debounce = null;
      void runSweep();
    }, 500);
    if (debounce.unref) debounce.unref();
  };

  /**
   * Should a change under the Helm Code state directory schedule a sweep?
   *
   * Matches only the state database and its WAL — DELIBERATELY NOT the `-shm`
   * sidecar: SQLite touches the wal-index on every WAL-mode reader open,
   * including the sweep's own read-only open of that same database, so treating
   * `-shm` as a trigger makes each sweep schedule the next one. That is a
   * self-sustaining full-scan loop (the Codex twin of this bug measured ~40% of
   * CPU samples; issue #295). Durable changes land in `state.sqlite` or its
   * `-wal`, both of which still match.
   */
  function helmcodeHomeChangeTriggersSweep(filename) {
    const name = filename && path.basename(String(filename));
    if (!name) return true;
    return name === "state.sqlite" || name === "state.sqlite-wal";
  }

  function watchHelmcodeStateDir() {
    const stateDir = getHelmcodeUserDataDir();
    if (stateDir !== watchedStateDir) {
      try {
        watcher?.close();
      } catch {
        // Polling remains the real-time safety net if a watcher cannot close.
      }
      watcher = null;
      watchedStateDir = stateDir;
    }
    if (watcher || !fs.existsSync(stateDir)) return;
    try {
      const nextWatcher = fs.watch(stateDir, { recursive: false }, (_event, filename) => {
        if (helmcodeHomeChangeTriggersSweep(filename)) schedule();
      });
      watcher = nextWatcher;
      nextWatcher.on("error", () => {
        if (watcher !== nextWatcher) return;
        try {
          nextWatcher.close();
        } catch {
          // The polling sweep retries optional attachment.
        }
        watcher = null;
      });
      if (nextWatcher.unref) nextWatcher.unref();
    } catch {
      // The poll remains the sweep safety net.
    }
  }
  watchHelmcodeStateDir();

  // Settings can repoint Helm Code while the dashboard runs. Re-arm the watcher
  // (the state dir may switch between `userdata/` and `dev/`) and sweep after
  // the response is out so a large history never delays the UI action.
  onHelmcodeHomeChanged(() => {
    watchHelmcodeStateDir();
    setImmediate(() => void runSweep());
  });
}

module.exports = { startHelmcodeSync };
