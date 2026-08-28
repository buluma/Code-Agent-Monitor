/**
 * @file Unit tests for the file-based Linear API key store. Points
 * `DASHBOARD_DATA_DIR` at a temp directory so nothing touches the real
 * dashboard data dir.
 * @author Michael Buluma <1452922+buluma@users.noreply.github.com>
 */

const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");

let tmpDir;
let originalDataDir;
let linearConfig;

describe("linear-config", () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "linear-config-test-"));
    originalDataDir = process.env.DASHBOARD_DATA_DIR;
    process.env.DASHBOARD_DATA_DIR = tmpDir;
    delete require.cache[require.resolve("../linear-config")];
    delete require.cache[require.resolve("../claude-home")];
    linearConfig = require("../linear-config");
  });

  afterEach(() => {
    if (originalDataDir === undefined) delete process.env.DASHBOARD_DATA_DIR;
    else process.env.DASHBOARD_DATA_DIR = originalDataDir;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("reports not configured when no key has been set", () => {
    assert.equal(linearConfig.isConfigured(), false);
    assert.equal(linearConfig.getApiKey(), null);
  });

  it("persists a key across reads", () => {
    linearConfig.setApiKey("lin_api_abc123");
    assert.equal(linearConfig.isConfigured(), true);
    assert.equal(linearConfig.getApiKey(), "lin_api_abc123");
    assert.ok(fs.existsSync(linearConfig.CONFIG_PATH));
  });

  it("overwrites an existing key", () => {
    linearConfig.setApiKey("first-key");
    linearConfig.setApiKey("second-key");
    assert.equal(linearConfig.getApiKey(), "second-key");
  });

  it("clears a stored key", () => {
    linearConfig.setApiKey("some-key");
    linearConfig.clearApiKey();
    assert.equal(linearConfig.isConfigured(), false);
    assert.equal(linearConfig.getApiKey(), null);
  });

  it("clearing an unconfigured key is a no-op, not an error", () => {
    assert.doesNotThrow(() => linearConfig.clearApiKey());
  });
});
