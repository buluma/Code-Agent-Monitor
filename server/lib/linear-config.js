/**
 * @file Stores the user's personal Linear API key on disk, one JSON file under
 * the dashboard's data dir (same pattern as `vapid-keys.json` in
 * server/lib/push.js). The key is never stored in SQLite, is not part of any
 * DB export/import bundle, and is never echoed back verbatim through the API
 * — callers get a redacted `configured: true/false` boolean instead.
 * @author Michael Buluma <1452922+buluma@users.noreply.github.com>
 */

const fs = require("fs");
const path = require("path");
const { getDataDir } = require("./claude-home");

const CONFIG_PATH = path.join(getDataDir(), "linear-config.json");

function readConfig() {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return typeof parsed.apiKey === "string" ? parsed : {};
  } catch {
    return {};
  }
}

/** Whether a Linear API key is currently stored. */
function isConfigured() {
  return typeof readConfig().apiKey === "string" && readConfig().apiKey.length > 0;
}

/** Returns the stored API key, or null if none is set. */
function getApiKey() {
  const cfg = readConfig();
  return cfg.apiKey || null;
}

/** Persists a new API key (overwrites any existing one). */
function setApiKey(apiKey) {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({ apiKey }, null, 2), { mode: 0o600 });
}

/** Removes the stored API key, if any. */
function clearApiKey() {
  try {
    fs.unlinkSync(CONFIG_PATH);
  } catch {
    // Already absent — clearing an unconfigured key is a no-op.
  }
}

module.exports = { isConfigured, getApiKey, setApiKey, clearApiKey, CONFIG_PATH };
