/**
 * @file Verifies asynchronous Codex probe coalescing, cache freshness, and failure recovery.
 * @author Michael Buluma <1452922+buluma@users.noreply.github.com>
 */
const { it, after } = require("node:test");
const assert = require("node:assert/strict");
const cp = require("node:child_process");
const installer = require("../../scripts/install-hooks");
const originalExec = cp.execFile;
const originalContainer = installer.isInsideContainer;
const originalEnv = process.env.DASHBOARD_LIVENESS_PROBE;
let calls = 0;
let fail = false;
cp.execFile = (_binary, _args, _options, callback) => {
  calls++;
  setImmediate(() => callback(fail ? new Error("probe failed") : null, "123 unrelated-command\n"));
};
installer.isInsideContainer = () => false;
process.env.DASHBOARD_LIVENESS_PROBE = "1";
const { probeLiveCodexRolloutsAsync: probe } = require("../lib/session-liveness");
after(() => {
  cp.execFile = originalExec;
  installer.isInsideContainer = originalContainer;
  if (originalEnv === undefined) delete process.env.DASHBOARD_LIVENESS_PROBE;
  else process.env.DASHBOARD_LIVENESS_PROBE = originalEnv;
});
it("shares in-flight work, marks cached absence stale, and retries failures", async () => {
  if (process.platform === "win32") return;
  const [a, b] = await Promise.all([probe({ fresh: true }), probe({ fresh: true })]);
  assert.equal(calls, 1);
  assert.equal(a.available, true);
  assert.equal(a.fresh, true);
  assert.equal(b.paths.size, 0);
  const cached = await probe();
  assert.equal(cached.fresh, false);
  assert.equal(calls, 1);
  fail = true;
  assert.equal((await probe({ fresh: true })).available, false);
  fail = false;
  assert.equal((await probe()).fresh, true);
  assert.equal(calls, 3);
  process.env.DASHBOARD_LIVENESS_PROBE = "0";
  assert.equal((await probe()).available, false);
});
