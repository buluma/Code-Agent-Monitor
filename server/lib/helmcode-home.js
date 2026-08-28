/**
 * @file Resolves and safely updates the local Helm Code home directory and the
 * SQLite state database it owns. Helm Code keeps every thread/message/turn/
 * activity record in `<home>/userdata/state.sqlite` (or `<home>/dev/` for dev
 * builds) instead of JSONL transcripts, so this module also reads the local
 * `server-runtime.json` for the monitor's optional metadata. A Settings change
 * persists a dashboard-only override and notifies the live synchronizer without
 * mutating the Helm Code CLI.
 * @author Michael Buluma <1452922+buluma@users.noreply.github.com>
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { writeEnvFile } = require("./claude-home");

// The live synchronizer subscribes here instead of the settings route owning a
// second scanner. This keeps a runtime home change immediate while preserving
// the single, idempotent ingest path used by hooks and the background watcher.
const homeChangeListeners = new Set();

function getHelmcodeHome() {
  return path.resolve(
    process.env.DASHBOARD_HELMCODE_HOME ||
      process.env.HELMCODE_HOME ||
      path.join(os.homedir(), ".helmcode")
  );
}

/**
 * The per-build user-data directory. Release builds write to `<home>/userdata`
 * while dev builds use `<home>/dev`; prefer whichever currently holds the state
 * database and fall back to `userdata` (the release default) when neither exists.
 */
function getHelmcodeUserDataDir() {
  const home = getHelmcodeHome();
  const userdata = path.join(home, "userdata");
  const dev = path.join(home, "dev");
  const candidates = [userdata, dev];
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(path.join(candidate, "state.sqlite"))) return candidate;
    } catch {
      // Missing/odd home must not break path resolution; fall through.
    }
  }
  return userdata;
}

/**
 * The Helm Code state database file. Release and dev builds use different
 * layouts, so the concrete path is discovered by checking which directory owns
 * the live `state.sqlite` rather than hard-coding one location.
 */
function getHelmcodeStateDbPath() {
  return path.join(getHelmcodeUserDataDir(), "state.sqlite");
}

/**
 * Read the local Helm Code server's runtime descriptor, if present. Helm Code
 * exposes its web UI over a loopback WebSocket RPC; the descriptor is optional
 * monitor metadata in Phase 1 (a live subscription is a later phase) and is
 * deliberately never treated as a required file.
 */
function getHelmcodeServerRuntime() {
  try {
    const raw = fs.readFileSync(
      path.join(getHelmcodeHome(), "userdata", "server-runtime.json"),
      "utf8"
    );
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return {
      version: typeof parsed.version === "number" ? parsed.version : null,
      pid: typeof parsed.pid === "number" ? parsed.pid : null,
      host: typeof parsed.host === "string" ? parsed.host : null,
      port: typeof parsed.port === "number" ? parsed.port : null,
      origin: typeof parsed.origin === "string" ? parsed.origin : null,
      started_at: typeof parsed.startedAt === "string" ? parsed.startedAt : null,
    };
  } catch {
    // Helm Code may be stopped or mid-install; a missing runtime is not an error.
    return null;
  }
}

/**
 * The Helm Code model-rate cache: a periodically-refreshed litellm price table
 * (`{fetchedAtMs, document: {modelKey: {input_cost_per_token, ...}}}`) that
 * Helm Code itself downloads for its own cost display. Reused here for
 * best-effort cost attribution rather than duplicating a rate table the
 * dashboard would have to maintain for every provider Helm Code can run.
 */
function getHelmcodeUsageModelRatesPath() {
  return path.join(getHelmcodeUserDataDir(), "usage-model-rates.json");
}

/** Subscribe to a successful runtime Helm Code home change. */
function onHelmcodeHomeChanged(listener) {
  homeChangeListeners.add(listener);
  return () => homeChangeListeners.delete(listener);
}

/**
 * Update the Helm Code home without a server restart. `DASHBOARD_HELMCODE_HOME`
 * deliberately wins over `HELMCODE_HOME`: it is the dashboard-specific override
 * users configure from Settings and avoids mutating their broader CLI setup.
 */
function setHelmcodeHome(newPath) {
  const expanded = newPath.replace(/^~(?=\/)/, os.homedir());
  if (!path.isAbsolute(expanded)) {
    throw new Error("Helm Code home must be an absolute path");
  }
  const resolved = path.resolve(expanded);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Directory does not exist: ${resolved}`);
  }
  if (!fs.statSync(resolved).isDirectory()) {
    throw new Error(`Not a directory: ${resolved}`);
  }

  process.env.DASHBOARD_HELMCODE_HOME = resolved;
  writeEnvFile("DASHBOARD_HELMCODE_HOME", resolved);
  for (const listener of homeChangeListeners) {
    try {
      listener(resolved);
    } catch {
      // A listener failure must never make a valid path update fail.
    }
  }
  return resolved;
}

module.exports = {
  getHelmcodeHome,
  getHelmcodeUserDataDir,
  getHelmcodeStateDbPath,
  getHelmcodeServerRuntime,
  getHelmcodeUsageModelRatesPath,
  onHelmcodeHomeChanged,
  setHelmcodeHome,
};
