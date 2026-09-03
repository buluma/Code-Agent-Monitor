/**
 * @file Auto-updater orchestration: wraps `electron-updater`'s `autoUpdater`,
 * drives the pure reducers in `updaterState.ts`, and exposes a small action +
 * subscription surface `main.ts` wires into the tray and application menu.
 *
 * Feed: GitHub Releases, via the `publish:` block in `electron-builder.yml`
 * (embedded into the packaged app as `app-update.yml`) — no separate feed
 * hosting. Checks run automatically (15s after boot, then every 4 hours);
 * download and install stay user-triggered (`autoDownload = false`), the
 * same manual-download philosophy the t3code reference implementation uses.
 * Disabled entirely for an unpackaged build (`app.isPackaged === false`) —
 * there is no `app-update.yml` to read and `autoUpdater.checkForUpdates()`
 * would just throw — or when `CAM_DESKTOP_DISABLE_AUTO_UPDATE=1` is set.
 * @author Michael Buluma <1452922+buluma@users.noreply.github.com>
 */

import { app } from "electron";
import { autoUpdater } from "electron-updater";

import { log } from "./logger";
import {
  type UpdaterState,
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
} from "./updaterState";

/** Delay before the first automatic check — long enough that it never
 * competes with the embedded server's own boot for CPU/network. */
const STARTUP_CHECK_DELAY_MS = 15_000;
/** CAM ships far less often than a daily-active chat app; a 4-hour poll
 * comfortably catches a new release within a session without adding the
 * network/log noise a t3code-style 4-minute poll would here. */
const POLL_INTERVAL_MS = 4 * 60 * 60 * 1000;

let state: UpdaterState = createInitialUpdaterState(app.getVersion(), false);
let configured = false;
let pollTimer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<(state: UpdaterState) => void>();

const nowIso = (): string => new Date().toISOString();

function setState(next: UpdaterState): void {
  state = next;
  for (const listener of listeners) listener(state);
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Synchronous accessor for the tray/menu's build step — mirrors
 * `server-host.ts`'s `getServerSnapshot()` pattern. */
export function getUpdaterState(): UpdaterState {
  return state;
}

/** Subscribe to every state change; returns an unsubscribe function. */
export function onUpdaterStateChange(listener: (state: UpdaterState) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Wire `autoUpdater`'s events into the reducers and start the background
 * poller. Call once during `boot()`. A no-op (state stays `"disabled"`) for
 * an unpackaged build.
 */
export function configureUpdater(): void {
  const disabledByEnv = process.env.CAM_DESKTOP_DISABLE_AUTO_UPDATE === "1";
  const enabled = app.isPackaged && !disabledByEnv;
  state = createInitialUpdaterState(app.getVersion(), enabled);
  if (!enabled) {
    log.info("auto-updater disabled", {
      reason: disabledByEnv ? "CAM_DESKTOP_DISABLE_AUTO_UPDATE=1" : "unpackaged build",
    });
    return;
  }

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;

  autoUpdater.on("checking-for-update", () => {
    log.info("checking for updates");
  });
  autoUpdater.on("update-available", (info) => {
    log.info("update available", { version: info.version });
    setState(reduceUpdateAvailable(state, info.version, nowIso()));
  });
  autoUpdater.on("update-not-available", () => {
    log.info("no update available");
    setState(reduceUpToDate(state, nowIso()));
  });
  autoUpdater.on("download-progress", (progress) => {
    setState(reduceDownloadProgress(state, progress.percent));
  });
  autoUpdater.on("update-downloaded", (info) => {
    log.info("update downloaded", { version: info.version });
    setState(reduceDownloadComplete(state, info.version));
  });
  // electron-updater emits `error` for check, download, AND install
  // failures alike (there is no separate "install failed" event) — route by
  // the state we were in when it fired, same as the reducers' own guards.
  autoUpdater.on("error", (err) => {
    const message = errorMessage(err);
    log.error("updater error", message);
    if (state.status === "downloading") {
      setState(reduceDownloadFailure(state, message));
    } else if (state.status === "downloaded") {
      setState(reduceInstallFailure(state, message));
    } else {
      setState(reduceCheckFailure(state, message, nowIso()));
    }
  });

  configured = true;
  startPolling();
}

/**
 * Run one check. Safe to call repeatedly — a no-op while a check/download is
 * already in flight (`isUpdaterActionInProgress`) or before `configureUpdater`
 * has run. `checkForUpdates` also emits the `update-available` /
 * `update-not-available` events the state transitions above react to, so a
 * caught rejection here only needs to cover the case where the request never
 * got far enough to emit either.
 */
export async function checkForUpdates(reason: string): Promise<void> {
  if (!configured || isUpdaterActionInProgress(state)) return;
  setState(reduceCheckStart(state, nowIso()));
  log.info("update check starting", { reason });
  try {
    await autoUpdater.checkForUpdates();
  } catch (err) {
    setState(reduceCheckFailure(state, errorMessage(err), nowIso()));
  }
}

/** Download the update a prior check found. No-op unless `status ===
 * "available"` — the tray/menu only ever offer this action in that state. */
export async function downloadUpdate(): Promise<void> {
  if (!configured || state.status !== "available") return;
  setState(reduceDownloadStart(state));
  log.info("downloading update", { version: state.availableVersion });
  try {
    await autoUpdater.downloadUpdate();
  } catch (err) {
    setState(reduceDownloadFailure(state, errorMessage(err)));
  }
}

/**
 * Apply the downloaded update and relaunch. No-op unless `status ===
 * "downloaded"`. `isSilent: false` — unlike a headless server process, this
 * is a user-facing app; showing the native "installing update" progress the
 * OS provides is the expected behavior. `isForceRunAfter: true` relaunches
 * automatically instead of leaving the user to reopen the app themselves.
 */
export function installUpdateAndRestart(): void {
  if (state.status !== "downloaded") return;
  log.info("installing update and restarting", { version: state.availableVersion });
  try {
    autoUpdater.quitAndInstall(false, true);
  } catch (err) {
    setState(reduceInstallFailure(state, errorMessage(err)));
  }
}

function startPolling(): void {
  if (pollTimer) return;
  setTimeout(() => void checkForUpdates("startup"), STARTUP_CHECK_DELAY_MS).unref();
  pollTimer = setInterval(() => void checkForUpdates("poll"), POLL_INTERVAL_MS);
  pollTimer.unref();
}
