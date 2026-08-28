/**
 * @file Unit tests for the fail-safe guards in terminal-focus.js: the
 * unsupported-platform short-circuit and the missing-cwd short-circuit. The
 * actual AppleScript/lsof matching only runs on a real macOS desktop with a
 * running terminal app, so it is exercised manually rather than in CI.
 * @author Michael Buluma <1452922+buluma@users.noreply.github.com>
 */

const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const os = require("os");
const { focusTerminalForSession } = require("../terminal-focus");

describe("focusTerminalForSession", () => {
  const originalPlatform = os.platform;

  afterEach(() => {
    os.platform = originalPlatform;
  });

  it("no-ops on a non-macOS platform without touching the OS", async () => {
    os.platform = () => "linux";
    const result = await focusTerminalForSession({ cwd: "/some/project" });
    assert.deepEqual(result, { focused: false, app: null, reason: "unsupported_platform" });
  });

  it("no-ops when the session has no recorded cwd", async () => {
    os.platform = () => "darwin";
    const result = await focusTerminalForSession({ cwd: null });
    assert.deepEqual(result, { focused: false, app: null, reason: "no_cwd" });
  });

  it("no-ops when the session is undefined", async () => {
    os.platform = () => "darwin";
    const result = await focusTerminalForSession(undefined);
    assert.deepEqual(result, { focused: false, app: null, reason: "no_cwd" });
  });
});
