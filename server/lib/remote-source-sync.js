/**
 * @file Periodic pull of Claude Code history from enabled remote (SSH) sources.
 * Each tick rsyncs every enabled source's `~/.claude/projects` into a sandboxed
 * staging dir and feeds it through the shared importer (see
 * server/lib/remote-sync.js), so remote usage appears here in near real time.
 * A first pass runs shortly after boot; thereafter every
 * DASHBOARD_REMOTE_SYNC_MS (default 15s). Set the interval to 0 to disable.
 * Unref'd so it never blocks shutdown; overlapping ticks queue one follow-up
 * sweep (same as local sync).
 * @author Michael Buluma <1452922+buluma@users.noreply.github.com>
 */

function startRemoteSourceSync({ broadcast }) {
  const POLL_MS = process.env.DASHBOARD_REMOTE_SYNC_MS
    ? Number(process.env.DASHBOARD_REMOTE_SYNC_MS)
    : 15_000;
  if (!Number.isFinite(POLL_MS) || POLL_MS <= 0) return;

  const dbModule = require("../db");
  const { syncAllEnabled } = require("./remote-sync");
  const { makeCoalescedRunner } = require("./sweep-coalescer");

  const tick = makeCoalescedRunner(async () => {
    // Cheap gate: skip all SSH work unless the user has an enabled source.
    let count = 0;
    try {
      count = dbModule.stmts.listEnabledRemoteSources.all().length;
    } catch {
      return;
    }
    if (count === 0) return;
    try {
      await syncAllEnabled(dbModule, { broadcast });
    } catch (err) {
      console.warn("remote source sync tick failed:", err?.message || err);
    }
  });

  // First pass 2s after boot (let local import settle), then interval.
  const boot = setTimeout(() => void tick(), 2_000);
  if (boot.unref) boot.unref();
  const timer = setInterval(() => void tick(), POLL_MS);
  if (timer.unref) timer.unref();
}

module.exports = { startRemoteSourceSync };
