/**
 * @file Verifies T3's shared provider engine, home resolution precedence,
 * state-DB path discovery across release/dev layouts, dashboard-only override
 * persistence, and optional server-runtime descriptor reads.
 * @author Michael Buluma <1452922+buluma@users.noreply.github.com>
 */

const { after, before, describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "cam-t3-home-"));
process.env.DASHBOARD_ENV_PATH = path.join(TMP, "config", ".env");
process.env.T3_HOME = path.join(TMP, "env-t3");

const {
  engine,
  getT3Home,
  getT3SyncIntervalMs,
  getT3UserDataDir,
  getT3StateDbPath,
  getT3ServerRuntime,
  onT3HomeChanged,
  setT3Home,
} = require("../lib/t3-home");

const SAVED = {
  dashboardHome: process.env.DASHBOARD_T3_HOME,
  t3Home: process.env.T3_HOME,
};

before(() => {
  fs.mkdirSync(path.join(TMP, "override", "userdata"), { recursive: true });
  fs.mkdirSync(path.join(TMP, "override", "dev"), { recursive: true });
  fs.mkdirSync(path.join(TMP, "env-t3", "userdata"), { recursive: true });
  fs.mkdirSync(path.join(TMP, "env-t3", "dev"), { recursive: true });
});

after(() => {
  if (SAVED.dashboardHome === undefined) delete process.env.DASHBOARD_T3_HOME;
  else process.env.DASHBOARD_T3_HOME = SAVED.dashboardHome;
  if (SAVED.t3Home === undefined) delete process.env.T3_HOME;
  else process.env.T3_HOME = SAVED.t3Home;
  delete process.env.DASHBOARD_ENV_PATH;
  fs.rmSync(TMP, { recursive: true, force: true });
});

describe("T3 home resolution", () => {
  it("shares one provider engine across the T3 home, ingest, pricing, and sync surfaces", () => {
    const ingest = require("../lib/t3-ingest");
    const pricing = require("../lib/t3-pricing");
    const sync = require("../lib/t3-sync");

    assert.equal(getT3Home, engine.getHome);
    assert.equal(getT3SyncIntervalMs, engine.getSyncIntervalMs);
    assert.equal(ingest.syncT3Sessions, engine.syncSessions);
    assert.equal(pricing.calculateT3Cost, engine.calculateCost);
    assert.equal(sync.startT3Sync, engine.startSync);
  });

  it("resolves T3_HOME then the dashboard-only override, and prefers userdata over dev", () => {
    delete process.env.DASHBOARD_T3_HOME;
    assert.equal(getT3Home(), path.resolve(process.env.T3_HOME));

    // No layout owns state.sqlite yet → release `userdata` wins by default.
    assert.equal(getT3UserDataDir(), path.join(process.env.T3_HOME, "userdata"));
    assert.equal(getT3StateDbPath(), path.join(process.env.T3_HOME, "userdata", "state.sqlite"));

    // A dev layout that owns the live DB wins over the release default…
    fs.writeFileSync(path.join(TMP, "env-t3", "dev", "state.sqlite"), "");
    assert.equal(getT3UserDataDir(), path.join(TMP, "env-t3", "dev"));

    // …and the dashboard override always wins over T3_HOME.
    process.env.DASHBOARD_T3_HOME = path.join(TMP, "override");
    assert.equal(getT3Home(), path.join(TMP, "override"));
    fs.writeFileSync(path.join(TMP, "override", "userdata", "state.sqlite"), "");
    assert.equal(getT3StateDbPath(), path.join(TMP, "override", "userdata", "state.sqlite"));
  });

  it("persists a dashboard-only override to DASHBOARD_ENV_PATH and notifies listeners", () => {
    const seen = [];
    const unsub = onT3HomeChanged((next) => seen.push(next));
    const resolved = setT3Home(path.join(TMP, "override"));
    assert.equal(resolved, path.join(TMP, "override"));
    assert.deepEqual(seen, [path.join(TMP, "override")]);
    assert.match(fs.readFileSync(process.env.DASHBOARD_ENV_PATH, "utf8"), /^DASHBOARD_T3_HOME=/m);
    unsub();

    assert.throws(() => setT3Home("relative/home"), /absolute path/);
    assert.throws(() => setT3Home(path.join(TMP, "does-not-exist")), /does not exist/);
  });

  it("reads the optional server-runtime.json without treating a missing file as an error", () => {
    assert.equal(getT3ServerRuntime(), null);

    fs.rmSync(path.join(TMP, "override", "userdata", "state.sqlite"), { force: true });
    fs.writeFileSync(path.join(TMP, "override", "dev", "state.sqlite"), "");

    fs.writeFileSync(
      path.join(TMP, "override", "dev", "server-runtime.json"),
      JSON.stringify({
        version: 1,
        pid: 4242,
        host: "127.0.0.1",
        port: 4453,
        origin: "http://127.0.0.1:4453",
        startedAt: "2026-08-01T12:00:00.000Z",
      })
    );
    const runtime = getT3ServerRuntime();
    assert.equal(getT3UserDataDir(), path.join(TMP, "override", "dev"));
    assert.equal(runtime.port, 4453);
    assert.equal(runtime.pid, 4242);
    assert.equal(runtime.started_at, "2026-08-01T12:00:00.000Z");
  });
});
