/**
 * @file Read-only Config Explorer surface for the T3 integration. T3 is a
 * Helm Code fork, so this mirrors the Helm Code Config Explorer route
 * (`/api/helmcode-config/overview`): it never writes to T3's own state
 * database, and the only mutation is `POST /api/t3-config/resync`, which
 * re-runs the idempotent `ingestT3Snapshot` pass against the dashboard's own
 * mirror and is safe to repeat.
 * @author Michael Buluma <1452922+buluma@users.noreply.github.com>
 */

const { Router } = require("express");
const fs = require("fs");
const {
  getT3Home,
  getT3SyncIntervalMs,
  getT3UserDataDir,
  getT3StateDbPath,
  getT3ServerRuntime,
} = require("../lib/t3-home");
const { ingestT3Snapshot, getT3ProjectionCounts } = require("../lib/t3-ingest");
const { broadcast } = require("../websocket");

const router = Router();

function readStateDbStat(stateDbPath) {
  if (!stateDbPath) return { exists: false, size_bytes: null, mtime: null };
  try {
    const st = fs.statSync(stateDbPath);
    return {
      exists: true,
      size_bytes: st.size,
      mtime: st.mtime.toISOString(),
    };
  } catch {
    return { exists: false, size_bytes: null, mtime: null };
  }
}

function envOverrides() {
  const syncInterval = getT3SyncIntervalMs();
  return {
    DASHBOARD_T3_HOME: process.env.DASHBOARD_T3_HOME || null,
    T3_HOME: process.env.T3_HOME || null,
    DASHBOARD_T3_SYNC_MS: process.env.DASHBOARD_T3_SYNC_MS == null ? null : syncInterval,
  };
}

router.get("/overview", (_req, res) => {
  const home = getT3Home();
  const userdataDir = getT3UserDataDir();
  const stateDbPath = getT3StateDbPath();
  const projectionCounts = getT3ProjectionCounts();

  res.json({
    home,
    userdata_dir: userdataDir,
    state_db_path: stateDbPath,
    state_db: readStateDbStat(stateDbPath),
    server_runtime: getT3ServerRuntime(),
    env: envOverrides(),
    sync: {
      poll_ms: getT3SyncIntervalMs(),
    },
    projection_counts: projectionCounts || null,
  });
});

router.post("/resync", (req, res) => {
  const confirmed = req.body && req.body.confirmed === true;
  if (!confirmed) {
    return res.status(400).json({
      error: {
        code: "ENOTCONFIRMED",
        message:
          'Resync requires {"confirmed": true}. The action is idempotent and re-runs the read-only ingest pass against the dashboard mirror; T3 is not modified.',
      },
    });
  }

  const results = ingestT3Snapshot({ confirmedLive: true });
  const summary = {
    scanned: results.length,
    changed: results.filter((r) => r && r.changed && !r.removed).length,
    created: results.filter((r) => r && r.created).length,
    removed: results.filter((r) => r && r.removed).length,
  };

  try {
    broadcast("t3_config_changed", { source: "dashboard", action: "resync", ...summary });
  } catch {
    // The websocket service is optional for isolated route tests.
  }

  return res.json({ ok: true, summary });
});

module.exports = router;
