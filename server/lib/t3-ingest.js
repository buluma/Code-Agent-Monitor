/**
 * @file Incremental, idempotent ingest of T3 threads into the dashboard
 * provider model. T3 is a fork of Helm Code with an identical SQLite
 * projection schema, so this reuses the generic thread-provider engine bound
 * to the T3 config. Every T3 read is optional: an unreadable or drifted schema
 * fails to "no change", never crashes a sweep, and a failed pass leaves
 * cursors unmoved so the next sweep retries.
 * @author Michael Buluma <1452922+buluma@users.noreply.github.com>
 */

const { createThreadProvider } = require("./thread-provider");
const { config: T3_CONFIG } = require("./t3-home");

const engine = createThreadProvider(T3_CONFIG);

module.exports = {
  findT3Threads: engine.findThreads,
  syncT3Sessions: engine.syncSessions,
  ingestT3Snapshot: engine.ingestSnapshot,
  reconcileT3Liveness: engine.reconcileLiveness,
  getT3ProjectionCounts: engine.getProjectionCounts,
  readT3Transcript: engine.readTranscript,
  mapStatus: engine.mapStatus,
  activityEventType: engine.activityEventType,
  openStateDb: engine.openStateDb,
  withStateDb: engine.withStateDb,
};
