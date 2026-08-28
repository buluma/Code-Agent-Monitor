/**
 * @file Read-only Config Explorer surface for the Helm Code integration. The
 * dashboard never writes to Helm Code's own state database; configuration
 * discovery is therefore limited to inspecting the resolved home, the live
 * `server-runtime.json` descriptor, the env override chain, the watcher /
 * poller state, and a snapshot of the projection counts. The only mutation
 * is `POST /api/helmcode-config/resync`, which re-runs the idempotent
 * `ingestHelmcodeSnapshot` pass against the dashboard's own mirror and is
 * safe to repeat. This mirrors the existing Codex Config Explorer route
 * (`/api/codex-config/overview`) without exposing any text-file edits —
 * Helm Code configuration lives in SQLite which the dashboard treats as
 * read-only, so the redacted-preview rule from `routes/codex-config.js`
 * applies here by construction.
 * @author Michael Buluma <1452922+buluma@users.noreply.github.com>
 */

const { Router } = require("express");
const fs = require("fs");
const path = require("path");
const {
  getHelmcodeHome,
  getHelmcodeUserDataDir,
  getHelmcodeStateDbPath,
  getHelmcodeServerRuntime,
} = require("../lib/helmcode-home");
const { ingestHelmcodeSnapshot, getHelmcodeProjectionCounts } = require("../lib/helmcode-ingest");
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
    // The state DB may be absent (Helm Code never started on this machine);
    // that is a non-error condition the Explorer must surface, not crash on.
    return { exists: false, size_bytes: null, mtime: null };
  }
}

function envOverrides() {
  return {
    DASHBOARD_HELMCODE_HOME: process.env.DASHBOARD_HELMCODE_HOME || null,
    HELMCODE_HOME: process.env.HELMCODE_HOME || null,
    DASHBOARD_HELMCODE_SYNC_MS:
      process.env.DASHBOARD_HELMCODE_SYNC_MS == null
        ? null
        : Number(process.env.DASHBOARD_HELMCODE_SYNC_MS),
  };
}

router.get("/overview", (_req, res) => {
  const home = getHelmcodeHome();
  const userdataDir = getHelmcodeUserDataDir();
  const stateDbPath = getHelmcodeStateDbPath();
  const projectionCounts = getHelmcodeProjectionCounts();

  res.json({
    home,
    userdata_dir: userdataDir,
    state_db_path: stateDbPath,
    state_db: readStateDbStat(stateDbPath),
    server_runtime: getHelmcodeServerRuntime(),
    env: envOverrides(),
    sync: {
      poll_ms:
        process.env.DASHBOARD_HELMCODE_SYNC_MS == null
          ? 4000
          : Number(process.env.DASHBOARD_HELMCODE_SYNC_MS),
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
          'Resync requires {"confirmed": true}. The action is idempotent and re-runs the read-only ingest pass against the dashboard mirror; Helm Code is not modified.',
      },
    });
  }

  const results = ingestHelmcodeSnapshot({ confirmedLive: true });
  const summary = {
    scanned: results.length,
    changed: results.filter((r) => r && r.changed && !r.removed).length,
    created: results.filter((r) => r && r.created).length,
    removed: results.filter((r) => r && r.removed).length,
  };

  try {
    broadcast("helmcode_config_changed", { source: "dashboard", action: "resync", ...summary });
  } catch {
    // The websocket service is optional for isolated route tests.
  }

  return res.json({ ok: true, summary });
});

module.exports = router;
