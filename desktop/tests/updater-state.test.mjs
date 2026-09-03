/**
 * @file Unit tests for the pure auto-updater reducers/labels in
 * `updaterState.ts`. Runs against the compiled `out/updaterState.js` under
 * plain `node --test` — no Electron runtime needed, unlike `smoke.test.mjs`,
 * since this module has no `electron`/`electron-updater` import.
 * @author Michael Buluma <1452922+buluma@users.noreply.github.com>
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const {
  createInitialUpdaterState,
  isUpdaterActionInProgress,
  reduceCheckFailure,
  reduceCheckStart,
  reduceDownloadComplete,
  reduceDownloadFailure,
  reduceDownloadProgress,
  reduceDownloadStart,
  reduceInstallFailure,
  reduceUpToDate,
  reduceUpdateAvailable,
  updaterStatusLabel,
} = await import(path.join(__dirname, "..", "out", "updaterState.js"));

describe("createInitialUpdaterState", () => {
  it("starts disabled when the updater is not enabled", () => {
    const state = createInitialUpdaterState("4.0.2", false);
    assert.equal(state.status, "disabled");
    assert.equal(state.currentVersion, "4.0.2");
    assert.equal(updaterStatusLabel(state), null);
  });

  it("starts idle when enabled, with no visible tray row", () => {
    const state = createInitialUpdaterState("4.0.2", true);
    assert.equal(state.status, "idle");
    assert.equal(updaterStatusLabel(state), null);
  });
});

describe("check flow", () => {
  it("checking -> available carries the version and clears any error", () => {
    let state = createInitialUpdaterState("4.0.2", true);
    state = reduceCheckStart(state, "2026-01-01T00:00:00.000Z");
    assert.equal(state.status, "checking");
    state = reduceUpdateAvailable(state, "4.0.3", "2026-01-01T00:00:01.000Z");
    assert.equal(state.status, "available");
    assert.equal(state.availableVersion, "4.0.3");
    assert.equal(state.message, null);
    assert.match(updaterStatusLabel(state), /4\.0\.3/);
  });

  it("checking -> up-to-date clears a stale availableVersion", () => {
    let state = createInitialUpdaterState("4.0.2", true);
    state = reduceUpdateAvailable(state, "4.0.3", "t1");
    state = reduceCheckStart(state, "t2");
    state = reduceUpToDate(state, "t3");
    assert.equal(state.status, "up-to-date");
    assert.equal(state.availableVersion, null);
  });

  it("a completed download survives a background re-check's failure", () => {
    let state = createInitialUpdaterState("4.0.2", true);
    state = reduceUpdateAvailable(state, "4.0.3", "t1");
    state = reduceDownloadStart(state);
    state = reduceDownloadComplete(state, "4.0.3");
    assert.equal(state.status, "downloaded");

    // A poll's background check starting, then failing, must not discard
    // the completed, installable download.
    state = reduceCheckStart(state, "t2");
    assert.equal(state.status, "downloaded", "check-start must not regress a completed download");
    state = reduceCheckFailure(state, "network error", "t3");
    assert.equal(state.status, "downloaded", "check-failure must not discard a completed download");
    assert.equal(state.message, "network error");
  });
});

describe("download flow", () => {
  it("clamps progress into [0, 100] and floors fractional percents", () => {
    let state = createInitialUpdaterState("4.0.2", true);
    state = reduceUpdateAvailable(state, "4.0.3", "t1");
    state = reduceDownloadStart(state);
    state = reduceDownloadProgress(state, 42.9);
    assert.equal(state.downloadPercent, 42);
    state = reduceDownloadProgress(state, 150);
    assert.equal(state.downloadPercent, 100);
    state = reduceDownloadProgress(state, -5);
    assert.equal(state.downloadPercent, 0);
  });

  it("ignores a stray progress event outside the downloading state", () => {
    const idle = createInitialUpdaterState("4.0.2", true);
    const after = reduceDownloadProgress(idle, 50);
    assert.equal(after, idle, "non-downloading state must be returned unchanged");
  });

  it("a download failure with a known available version falls back to available, not error", () => {
    let state = createInitialUpdaterState("4.0.2", true);
    state = reduceUpdateAvailable(state, "4.0.3", "t1");
    state = reduceDownloadStart(state);
    state = reduceDownloadFailure(state, "disk full");
    assert.equal(state.status, "available");
    assert.equal(state.message, "disk full");
    assert.equal(state.downloadPercent, null);
  });
});

describe("install flow", () => {
  it("a failed install keeps the download installable for a retry", () => {
    let state = createInitialUpdaterState("4.0.2", true);
    state = reduceUpdateAvailable(state, "4.0.3", "t1");
    state = reduceDownloadStart(state);
    state = reduceDownloadComplete(state, "4.0.3");
    state = reduceInstallFailure(state, "quit-and-install failed");
    assert.equal(
      state.status,
      "downloaded",
      "install failure must not lose the completed download"
    );
    assert.equal(state.message, "quit-and-install failed");
  });
});

describe("isUpdaterActionInProgress", () => {
  it("is true only while checking or downloading", () => {
    const idle = createInitialUpdaterState("4.0.2", true);
    assert.equal(isUpdaterActionInProgress(idle), false);
    assert.equal(isUpdaterActionInProgress(reduceCheckStart(idle, "t")), true);
    assert.equal(isUpdaterActionInProgress(reduceDownloadStart(idle)), true);
    assert.equal(isUpdaterActionInProgress(reduceUpToDate(idle, "t")), false);
  });
});
