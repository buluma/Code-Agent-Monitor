/**
 * @file Periodic maintenance sweep for the standalone server entry point.
 * Every `SWEEP_INTERVAL_MS` tick it does three things:
 *
 *   1. **Stale session cleanup** — mark sessions that slipped through
 *      event-based detection as abandoned and their non-terminal agents
 *      completed, then evict their transcript-cache entries.
 *   2. **Compaction scanner** — scan active sessions' JSONL files for new
 *      compaction entries (/compact fires no hooks, so compaction agents only
 *      appear on the next hook event without this scanner).
 *   3. **Workflow journal scanner** — ingest Workflow-tool run journals for
 *      active sessions so launch-detected "running" rows flip to "completed"
 *      once their journal lands.
 *
 * Runs only on the standalone `node server/index.js` path (the desktop shell
 * has its own lifecycle).
 * @author Michael Buluma <1452922+buluma@users.noreply.github.com>
 */

const cleanupDb = require("../db");
const { importCompactions } = require("../../scripts/import-history");
const { transcriptCache } = require("../routes/hooks");

function startMaintenanceSweep({ broadcast }) {
  // Stale threshold: configurable via DASHBOARD_STALE_MINUTES env var.
  // Default 180 (3 hours) — long enough that a coffee break, lunch, or even
  // a meeting doesn't cause a Waiting session to flip to Abandoned/Completed
  // out from under the user. The previous 5-min default was the main reason
  // agents appeared to "go straight to completed" the moment Claude finished
  // a turn: any pause longer than 5 min reaped the session, marking its main
  // agent completed and emptying the Waiting column.
  const STALE_MINUTES = (() => {
    const raw = parseInt(process.env.DASHBOARD_STALE_MINUTES, 10);
    return Number.isFinite(raw) && raw > 0 ? raw : 180;
  })();
  // Sweep interval: 1/4 of the stale threshold, clamped to [60s, 5 min].
  // Frequent enough to catch real abandonments quickly, cheap enough that
  // we're not hammering SQLite for nothing.
  const SWEEP_INTERVAL_MS = Math.max(60_000, Math.min(300_000, (STALE_MINUTES * 60_000) / 4));

  // Per-session newest workflow-artifact mtime already ingested by this sweep,
  // so step 3 below skips sessions whose workflow files are unchanged (the same
  // cheap fingerprint startWorkflowPoll uses). Declared once so it persists
  // across sweep ticks.
  const sweepWorkflowSeen = new Map();
  setInterval(() => {
    // 1. Stale session cleanup — batch agent updates to avoid N+1 queries
    const stale = cleanupDb.stmts.findStaleSessions.all(
      "__periodic__",
      STALE_MINUTES,
      STALE_MINUTES,
      STALE_MINUTES
    );
    const now = new Date().toISOString();
    if (stale.length > 0) {
      const staleIds = stale.map((s) => s.id);
      const placeholders = staleIds.map(() => "?").join(",");

      // Batch update all non-terminal agents across all stale sessions
      cleanupDb.db
        .prepare(
          `UPDATE agents SET status = 'completed', ended_at = COALESCE(ended_at, ?), updated_at = ?
           WHERE session_id IN (${placeholders}) AND status NOT IN ('completed', 'error')`
        )
        .run(now, now, ...staleIds);

      for (const s of stale) {
        cleanupDb.stmts.updateSession.run(null, "abandoned", now, null, s.id);
        broadcast("session_updated", cleanupDb.stmts.getSession.get(s.id));

        // Evict transcript cache for abandoned sessions to bound memory growth.
        // Reads transcript_path off the session row (populated by hooks
        // ensureSession + one-time db.js backfill) instead of scanning events.
        const tpRow = cleanupDb.db
          .prepare("SELECT transcript_path AS tp FROM sessions WHERE id = ?")
          .get(s.id);
        if (tpRow?.tp) transcriptCache.invalidate(tpRow.tp);
      }

      // Broadcast updated agents once per stale session (not per-agent)
      for (const s of stale) {
        const agents = cleanupDb.stmts.listAgentsBySession.all(s.id);
        for (const agent of agents) {
          if (agent.status === "completed") {
            broadcast("agent_updated", agent);
          }
        }
      }
    }

    // 2. Scan active sessions for new compaction entries.
    // Reads from sessions.transcript_path (populated by hooks ensureSession +
    // one-time backfill in db.js migration) rather than scanning events —
    // O(active sessions) instead of O(events rows).
    const active = cleanupDb.db
      .prepare(
        "SELECT id AS session_id, transcript_path AS tp FROM sessions WHERE status = 'active' AND transcript_path IS NOT NULL ORDER BY updated_at DESC"
      )
      .all();
    for (const row of active) {
      if (!row.tp) continue;
      try {
        const compactions = transcriptCache.extractCompactions(row.tp);
        if (compactions.length === 0) continue;
        const mainAgentId = `${row.session_id}-main`;
        const created = importCompactions(cleanupDb, row.session_id, mainAgentId, compactions);
        if (created > 0) {
          broadcast(
            "agent_created",
            cleanupDb.stmts.getAgent.get(
              `${row.session_id}-compact-${compactions[compactions.length - 1].uuid}`
            )
          );
        }
      } catch (err) {
        console.warn(
          `[SWEEP] Compaction scan failed for session ${row.session_id}:`,
          err?.message || err
        );
        continue;
      }
    }

    // 3. Scan active sessions for Workflow-tool run journals (issue #167).
    // Catches workflows that complete without a subsequent hook and flips
    // launch-detected "running" rows to "completed" once their journal lands.
    const { ingestWorkflowsForSession, workflowsMaxMtime } = require("./workflow-ingest");
    // Forget fingerprints for sessions that are no longer active so the map
    // can't grow without bound over the process lifetime.
    const activeIds = new Set(active.map((r) => r.session_id));
    for (const id of sweepWorkflowSeen.keys()) {
      if (!activeIds.has(id)) sweepWorkflowSeen.delete(id);
    }
    for (const row of active) {
      if (!row.tp) continue;
      // Skip sessions whose workflow artifacts are unchanged since the last
      // ingest — the same cheap mtime fingerprint startWorkflowPoll uses.
      // Without this the sweep full-re-parses every workflow journal and every
      // inner agent-*.jsonl for every active session every cycle; on a large
      // corpus that re-parse exceeds the sweep interval, sweeps overlap, and
      // the event loop pegs (dashboard stops responding — white page).
      let mtime = 0;
      try {
        mtime = workflowsMaxMtime(row.tp);
      } catch {
        mtime = 0;
      }
      if (mtime === 0 || sweepWorkflowSeen.get(row.session_id) === mtime) continue;
      sweepWorkflowSeen.set(row.session_id, mtime);
      ingestWorkflowsForSession(cleanupDb, { id: row.session_id, transcript_path: row.tp })
        .then((changed) => {
          if (!changed || changed.length === 0) return;
          for (const wf of changed) broadcast("workflow_upserted", wf);
          const sess = cleanupDb.stmts.getSession.get(row.session_id);
          if (sess) broadcast("session_updated", sess);
        })
        .catch((err) => {
          // Forget the fingerprint so the next sweep retries this session
          // instead of skipping it until its artifacts change again.
          sweepWorkflowSeen.delete(row.session_id);
          console.warn(
            `[SWEEP] Workflow scan failed for session ${row.session_id}:`,
            err?.message || err
          );
        });
    }
  }, SWEEP_INTERVAL_MS);
}

module.exports = { startMaintenanceSweep };
