/**
 * @file Fast, change-fingerprinted poll that ingests Workflow-tool run journals
 * for active sessions in near real time. Inner agent() calls emit no hooks and
 * the journal lands at workflow completion, so this fills the gap between disk
 * writes and the next hook/sweep. Skips sessions whose workflow artifacts are
 * unchanged since the last ingest (cheap mtime fingerprint). Unref'd so it
 * never blocks shutdown; disable with DASHBOARD_WORKFLOW_POLL_MS=0.
 * @author Michael Buluma <1452922+buluma@users.noreply.github.com>
 */

function startWorkflowPoll({ broadcast }) {
  const POLL_MS = process.env.DASHBOARD_WORKFLOW_POLL_MS
    ? Number(process.env.DASHBOARD_WORKFLOW_POLL_MS)
    : 12_000;
  if (!Number.isFinite(POLL_MS) || POLL_MS <= 0) return;

  const dbModule = require("../db");
  const { ingestWorkflowsForSession, workflowsMaxMtime } = require("./workflow-ingest");
  const lastSeen = new Map(); // sessionId → newest workflow-artifact mtime ingested

  const timer = setInterval(() => {
    let active;
    try {
      active = dbModule.db
        .prepare(
          "SELECT id, transcript_path AS tp FROM sessions WHERE status = 'active' AND transcript_path IS NOT NULL ORDER BY updated_at DESC LIMIT 50"
        )
        .all();
    } catch {
      return;
    }
    // Forget fingerprints for sessions that are no longer active so the map
    // can't grow without bound over the process lifetime (matches the
    // maintenance sweep's sweepWorkflowSeen pruning).
    const activeIds = new Set(active.map((r) => r.id));
    for (const id of lastSeen.keys()) {
      if (!activeIds.has(id)) lastSeen.delete(id);
    }
    for (const row of active) {
      if (!row.tp) continue;
      let mtime = 0;
      try {
        mtime = workflowsMaxMtime(row.tp);
      } catch {
        mtime = 0;
      }
      if (mtime === 0 || lastSeen.get(row.id) === mtime) continue; // none / unchanged
      lastSeen.set(row.id, mtime);
      ingestWorkflowsForSession(dbModule, { id: row.id, transcript_path: row.tp })
        .then((changed) => {
          if (!changed || changed.length === 0) return;
          for (const wf of changed) broadcast("workflow_upserted", wf);
          const sess = dbModule.stmts.getSession.get(row.id); // nudge cost refresh
          if (sess) broadcast("session_updated", sess);
        })
        .catch(() => {
          // Forget the fingerprint so the next poll retries this session
          // instead of skipping it until its artifacts change again.
          lastSeen.delete(row.id);
        });
    }
  }, POLL_MS);

  if (timer.unref) timer.unref();
}

module.exports = { startWorkflowPoll };
