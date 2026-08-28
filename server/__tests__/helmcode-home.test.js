/**
 * @file Verifies Helm Code home resolution precedence, state-DB path discovery
 * across release/dev layouts, dashboard-only override persistence, and the
 * optional server-runtime descriptor read.
 * @author Michael Buluma <1452922+buluma@users.noreply.github.com>
 */

const { after, before, describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "ccam-helmcode-home-"));
process.env.DASHBOARD_ENV_PATH = path.join(TMP, "config", ".env");
process.env.HELMCODE_HOME = path.join(TMP, "env-helmcode");

const {
  getHelmcodeHome,
  getHelmcodeUserDataDir,
  getHelmcodeStateDbPath,
  getHelmcodeServerRuntime,
  onHelmcodeHomeChanged,
  setHelmcodeHome,
} = require("../lib/helmcode-home");

const SAVED = {
  dashboardHome: process.env.DASHBOARD_HELMCODE_HOME,
  helmcodeHome: process.env.HELMCODE_HOME,
};

before(() => {
  fs.mkdirSync(path.join(TMP, "override", "userdata"), { recursive: true });
  fs.mkdirSync(path.join(TMP, "override", "dev"), { recursive: true });
  fs.mkdirSync(path.join(TMP, "env-helmcode", "userdata"), { recursive: true });
  fs.mkdirSync(path.join(TMP, "env-helmcode", "dev"), { recursive: true });
});

after(() => {
  if (SAVED.dashboardHome === undefined) delete process.env.DASHBOARD_HELMCODE_HOME;
  else process.env.DASHBOARD_HELMCODE_HOME = SAVED.dashboardHome;
  if (SAVED.helmcodeHome === undefined) delete process.env.HELMCODE_HOME;
  else process.env.HELMCODE_HOME = SAVED.helmcodeHome;
  delete process.env.DASHBOARD_ENV_PATH;
  fs.rmSync(TMP, { recursive: true, force: true });
});

describe("Helm Code home resolution", () => {
  it("resolves HELMCODE_HOME then the dashboard-only override, and prefers userdata over dev", () => {
    delete process.env.DASHBOARD_HELMCODE_HOME;
    assert.equal(getHelmcodeHome(), path.resolve(process.env.HELMCODE_HOME));

    // No layout owns state.sqlite yet → release `userdata` wins by default.
    assert.equal(getHelmcodeUserDataDir(), path.join(process.env.HELMCODE_HOME, "userdata"));
    assert.equal(
      getHelmcodeStateDbPath(),
      path.join(process.env.HELMCODE_HOME, "userdata", "state.sqlite")
    );

    // A dev layout that owns the live DB wins over the release default…
    fs.writeFileSync(path.join(TMP, "env-helmcode", "dev", "state.sqlite"), "");
    assert.equal(getHelmcodeUserDataDir(), path.join(TMP, "env-helmcode", "dev"));

    // …and the dashboard override always wins over HELMCODE_HOME.
    process.env.DASHBOARD_HELMCODE_HOME = path.join(TMP, "override");
    assert.equal(getHelmcodeHome(), path.join(TMP, "override"));
    fs.writeFileSync(path.join(TMP, "override", "userdata", "state.sqlite"), "");
    assert.equal(getHelmcodeStateDbPath(), path.join(TMP, "override", "userdata", "state.sqlite"));
  });

  it("persists a dashboard-only override to DASHBOARD_ENV_PATH and notifies listeners", () => {
    const seen = [];
    const unsub = onHelmcodeHomeChanged((next) => seen.push(next));
    const resolved = setHelmcodeHome(path.join(TMP, "override"));
    assert.equal(resolved, path.join(TMP, "override"));
    assert.deepEqual(seen, [path.join(TMP, "override")]);
    assert.match(
      fs.readFileSync(process.env.DASHBOARD_ENV_PATH, "utf8"),
      /^DASHBOARD_HELMCODE_HOME=/m
    );
    unsub();

    assert.throws(() => setHelmcodeHome("relative/home"), /absolute path/);
    assert.throws(() => setHelmcodeHome(path.join(TMP, "does-not-exist")), /does not exist/);
  });

  it("reads the optional server-runtime.json without treating a missing file as an error", () => {
    assert.equal(getHelmcodeServerRuntime(), null);

    fs.writeFileSync(
      path.join(TMP, "override", "userdata", "server-runtime.json"),
      JSON.stringify({
        version: 1,
        pid: 4242,
        host: "127.0.0.1",
        port: 4453,
        origin: "http://127.0.0.1:4453",
        startedAt: "2026-08-01T12:00:00.000Z",
      })
    );
    const runtime = getHelmcodeServerRuntime();
    assert.equal(runtime.port, 4453);
    assert.equal(runtime.pid, 4242);
    assert.equal(runtime.started_at, "2026-08-01T12:00:00.000Z");
  });
});
