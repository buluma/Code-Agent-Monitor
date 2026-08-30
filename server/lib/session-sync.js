/**
 * @file Keep the default `~/.claude/projects` directory in sync via three
 * triggers that share one `mtimeCache` and a single coalesced sweep:
 *
 *   1. **Immediate** — one sweep at startup, so a project the one-time backfill
 *      (`autoImportLegacySessions`, marker-gated) missed surfaces right away
 *      instead of after the first interval.
 *   2. **Watcher** — a debounced `fs.watch` on the projects tree fires a sweep
 *      the instant a *new* session file or project folder appears, so no-hook
 *      sessions show up immediately rather than on the next poll. Events for
 *      files already in `mtimeCache` (active transcripts being appended to) are
 *      ignored, so a busy session never thrashes the importer — the poll picks
 *      up its growth. Recursive watching is used only on macOS/Windows (native,
 *      stable); on Linux, where Node's userland recursive watcher trips on the
 *      high-churn projects tree (see lib/cc-watcher.js), we watch the root plus
 *      each immediate child folder non-recursively instead.
 *   3. **Poll** — a periodic safety-net sweep (watchers can miss events / not
 *      fire on network filesystems). Tunable via `DASHBOARD_SESSION_SYNC_MS`
 *      (default 30 s); `0` disables the poll but leaves the watcher running.
 *
 * Each sweep parses only files whose mtime is new or has advanced, then
 * broadcasts `session_created` for newly imported sessions / `session_updated`
 * for grown ones — the same events hooks emit, so the UI refreshes live. All
 * timers and watchers are `unref`'d and best-effort; nothing here can block
 * shutdown or take down the server.
 * @author Michael Buluma <1452922+buluma@users.noreply.github.com>
 */

const fs = require("fs");
const path = require("path");
const dbModule = require("../db");
const { getProjectsDir } = require("./claude-home");
const { syncDefaultProjects } = require("../../scripts/import-history");
const { makeCoalescedRunner } = require("./sweep-coalescer");

function startSessionSync({ broadcast }) {
  const projectsDir = getProjectsDir();
  const mtimeCache = new Map(); // filePath → newest mtime (ms) already imported

  const runSweep = makeCoalescedRunner(async () => {
    let changed;
    try {
      ({ changed } = await syncDefaultProjects(dbModule, { mtimeCache }));
    } catch {
      return;
    }
    for (const { sessionId, isNew } of changed) {
      let row;
      try {
        row = dbModule.stmts.getSession.get(sessionId);
      } catch {
        continue;
      }
      if (!row) continue;
      broadcast(isNew ? "session_created" : "session_updated", row);
      // Also surface the session's main agent, so a synced session appears
      // live on the Agents board too (not just the Sessions board). Hooks
      // emit both a session and an agent frame; mirror that here.
      try {
        const mainAgent = dbModule.db
          .prepare("SELECT * FROM agents WHERE session_id = ? AND type = 'main' LIMIT 1")
          .get(sessionId);
        if (mainAgent) broadcast(isNew ? "agent_created" : "agent_updated", mainAgent);
      } catch {
        /* best-effort — the session frame already refreshed the UI */
      }
    }
  });

  // 1. Deferred initial sweep — let the HTTP server and WebSocket handshake
  //    come up and serve the first page load before the (potentially heavy)
  //    cold catch-up sweep runs. On a machine with many grown transcripts, the
  //    cold sweep re-parses every file whose mtime is newer than its DB
  //    updated_at; running it inline at startup can monopolize the event loop
  //    long enough that the Vite `/ws` proxy handshake times out ("WebSocket is
  //    closed before the connection is established") and the dashboard looks
  //    stuck for a minute-plus. The sweep itself yields between heavy re-parses
  //    (see syncDefaultProjects), so once it starts it stays cooperative.
  const initialSweep = setTimeout(() => void runSweep(), 250);
  if (initialSweep.unref) initialSweep.unref();

  // 3. Periodic safety net.
  const POLL_MS = process.env.DASHBOARD_SESSION_SYNC_MS
    ? Number(process.env.DASHBOARD_SESSION_SYNC_MS)
    : 30_000;
  if (Number.isFinite(POLL_MS) && POLL_MS > 0) {
    const timer = setInterval(() => void runSweep(), POLL_MS);
    if (timer.unref) timer.unref();
  }

  // 2. Filesystem watcher — debounced, ignoring known-file churn.
  const DEBOUNCE_MS = 800;
  let debounce = null;
  function scheduleSweep() {
    if (debounce) return;
    debounce = setTimeout(() => {
      debounce = null;
      void runSweep();
    }, DEBOUNCE_MS);
    if (debounce.unref) debounce.unref();
  }
  // Only a path we don't already track is interesting (a new session file or a
  // new project folder). Appends to a known active transcript are left to the
  // poll, so the watcher never re-parses a busy session every write.
  function onFsEvent(fullPath) {
    if (fullPath && mtimeCache.has(fullPath)) return;
    scheduleSweep();
  }

  const watchers = [];
  function addWatcher(w) {
    w.on("error", () => {});
    if (w.unref) w.unref();
    watchers.push(w);
  }
  const recursiveOk = process.platform === "darwin" || process.platform === "win32";
  try {
    if (fs.existsSync(projectsDir)) {
      if (recursiveOk) {
        addWatcher(
          fs.watch(projectsDir, { recursive: true }, (_e, filename) => {
            onFsEvent(filename ? path.join(projectsDir, filename) : null);
          })
        );
      } else {
        // Linux: watch the root (new folders) + each immediate child folder
        // (new session files), adding a child watcher when a folder appears.
        // A repeated root event for the same child dir (fs.watch can fire
        // duplicates) must not register a second watcher on it — tracked here
        // rather than left to `watchers` since that array holds live handles,
        // not a lookup keyed by path.
        const watchedDirs = new Set();
        const watchChild = (dir) => {
          if (watchedDirs.has(dir)) return;
          try {
            addWatcher(
              fs.watch(dir, (_e, filename) => onFsEvent(filename ? path.join(dir, filename) : null))
            );
            watchedDirs.add(dir);
          } catch {
            /* best-effort */
          }
        };
        addWatcher(
          fs.watch(projectsDir, (_e, filename) => {
            if (filename) {
              const child = path.join(projectsDir, filename);
              try {
                if (fs.statSync(child).isDirectory()) watchChild(child);
              } catch {
                /* removed before we could stat — ignore */
              }
            }
            onFsEvent(filename ? path.join(projectsDir, filename) : null);
          })
        );
        for (const ent of fs.readdirSync(projectsDir, { withFileTypes: true })) {
          if (ent.isDirectory()) watchChild(path.join(projectsDir, ent.name));
        }
      }
    }
  } catch {
    /* best-effort — the poll still keeps things in sync */
  }
}

module.exports = { startSessionSync };
