/**
 * @file Pure state and reducers for the desktop auto-updater.
 *
 * No `electron` or `electron-updater` import on purpose: `updater.ts` wraps
 * `electron-updater`'s `autoUpdater` and calls these reducers in response to
 * its events; keeping the decision logic here (with no Electron runtime
 * dependency) makes it unit-testable under plain `node --test`, the way
 * `constants.ts` is pure but `server-host.ts`/`tray.ts` are not.
 * @author Michael Buluma <1452922+buluma@users.noreply.github.com>
 */

/**
 * - `disabled`   — not a packaged build, or no update feed configured (dev).
 * - `idle`       — configured, no check has run yet this session.
 * - `checking`   — a check is in flight.
 * - `up-to-date` — last check found nothing newer.
 * - `available`  — a newer version exists but has not been downloaded.
 * - `downloading`— download in progress; see `downloadPercent`.
 * - `downloaded` — ready to install; `quitAndInstall` will apply it.
 * - `error`      — the last check/download/install failed; see `message`.
 */
export type UpdaterStatus =
  | "disabled"
  | "idle"
  | "checking"
  | "up-to-date"
  | "available"
  | "downloading"
  | "downloaded"
  | "error";

export interface UpdaterState {
  readonly status: UpdaterStatus;
  readonly currentVersion: string;
  /** Version a check last reported as newer, or `null`. Kept through
   * `downloading`/`downloaded` so the UI can keep naming the version. */
  readonly availableVersion: string | null;
  /** `0`-`100` while `downloading`; `null` otherwise. */
  readonly downloadPercent: number | null;
  /** Error text, or a `null` — cleared by every non-error transition. */
  readonly message: string | null;
  /** ISO timestamp of the last check start/finish, or `null` before the
   * first one. */
  readonly checkedAt: string | null;
}

export function createInitialUpdaterState(currentVersion: string, enabled: boolean): UpdaterState {
  return {
    status: enabled ? "idle" : "disabled",
    currentVersion,
    availableVersion: null,
    downloadPercent: null,
    message: null,
    checkedAt: null,
  };
}

export function reduceCheckStart(state: UpdaterState, checkedAt: string): UpdaterState {
  // A downloaded update survives a background re-check racing in behind it —
  // only clear availableVersion/downloadPercent when we are not already
  // sitting on a completed download.
  if (state.status === "downloaded") {
    return { ...state, checkedAt, message: null };
  }
  return {
    ...state,
    status: "checking",
    checkedAt,
    message: null,
  };
}

export function reduceUpdateAvailable(
  state: UpdaterState,
  version: string,
  checkedAt: string
): UpdaterState {
  if (state.status === "downloaded" || state.status === "downloading") {
    // Already have (or are already fetching) this or a later version —
    // do not regress a live download back to "available".
    return { ...state, checkedAt };
  }
  return {
    ...state,
    status: "available",
    availableVersion: version,
    checkedAt,
    message: null,
  };
}

export function reduceUpToDate(state: UpdaterState, checkedAt: string): UpdaterState {
  if (state.status === "downloaded" || state.status === "downloading") {
    return { ...state, checkedAt };
  }
  return {
    ...state,
    status: "up-to-date",
    availableVersion: null,
    downloadPercent: null,
    checkedAt,
    message: null,
  };
}

export function reduceCheckFailure(
  state: UpdaterState,
  message: string,
  checkedAt: string
): UpdaterState {
  if (state.status === "downloaded") {
    // Keep the completed download installable; surface the background
    // check's failure without discarding it.
    return { ...state, checkedAt, message };
  }
  return { ...state, status: "error", message, checkedAt, downloadPercent: null };
}

export function reduceDownloadStart(state: UpdaterState): UpdaterState {
  return { ...state, status: "downloading", downloadPercent: 0, message: null };
}

export function reduceDownloadProgress(state: UpdaterState, percent: number): UpdaterState {
  if (state.status !== "downloading") return state;
  return { ...state, downloadPercent: Math.max(0, Math.min(100, Math.floor(percent))) };
}

export function reduceDownloadComplete(state: UpdaterState, version: string): UpdaterState {
  return {
    ...state,
    status: "downloaded",
    availableVersion: version,
    downloadPercent: 100,
    message: null,
  };
}

export function reduceDownloadFailure(state: UpdaterState, message: string): UpdaterState {
  return {
    ...state,
    status: state.availableVersion ? "available" : "error",
    downloadPercent: null,
    message,
  };
}

export function reduceInstallFailure(state: UpdaterState, message: string): UpdaterState {
  // The download is still on disk — let the user retry the install rather
  // than losing the download and having to fetch it again.
  return { ...state, status: "downloaded", message };
}

/** True while a check or download holds the single-action reservation
 * `updater.ts` enforces — used to grey out/relabel tray and menu actions
 * rather than let a second click race the first. */
export function isUpdaterActionInProgress(state: UpdaterState): boolean {
  return state.status === "checking" || state.status === "downloading";
}

/** Tray/menu label for the current state. Kept here (not in `tray.ts`) so
 * the exact wording is covered by the same unit tests as the reducers. */
export function updaterStatusLabel(state: UpdaterState): string | null {
  switch (state.status) {
    case "disabled":
    case "idle":
      return null;
    case "checking":
      return "🔄  Checking for updates…";
    case "up-to-date":
      return "✅  Up to date";
    case "available":
      return `⬇️  Update available (v${state.availableVersion})`;
    case "downloading":
      return `⬇️  Downloading update… ${state.downloadPercent ?? 0}%`;
    case "downloaded":
      return `🔁  Restart to update to v${state.availableVersion}`;
    case "error":
      return `⚠️  Update check failed`;
  }
}
