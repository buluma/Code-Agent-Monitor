/**
 * @file macOS Gatekeeper quarantine-attribute stripping for ad-hoc builds.
 *
 * This project ships ad-hoc signed (unsigned by any Developer ID) DMGs by
 * default — `desktop/README.md` already documents `xattr -cr` as the
 * one-line fix a user runs after a manual DMG install. This module runs the
 * same command automatically, best-effort, on our own running app bundle.
 *
 * This is NOT a guaranteed unblock for every launch: Gatekeeper's quarantine
 * check runs before any of our code executes, so if a given launch is
 * actually blocked, this module never gets a chance to run for it. What it
 * does buy: (1) electron-updater's own download goes through Node's `https`
 * module rather than a WebKit/Finder/Safari-style download API, so in
 * practice the auto-swapped bundle after an update usually never picks up
 * `com.apple.quarantine` in the first place; (2) for any launch that DOES
 * get far enough to run our JS, stripping the attribute here self-heals the
 * bundle for every subsequent launch/copy. Real, complete fix: real
 * Developer ID signing + notarization (`electron-builder.yml`'s `afterSign`
 * hook already supports this — it just needs the Apple secrets set in CI).
 * @author Michael Buluma <1452922+buluma@users.noreply.github.com>
 */

import { execFile } from "node:child_process";
import * as path from "node:path";
import { app } from "electron";

import { log } from "./logger";

/**
 * Resolve the `.app` bundle root from the running executable's path:
 * `Code Agent Monitor.app/Contents/MacOS/Code Agent Monitor` → three levels
 * up. Only meaningful on a packaged macOS build; callers must guard on
 * `process.platform === "darwin" && app.isPackaged` before using this.
 */
function resolveAppBundlePath(): string {
  return path.dirname(path.dirname(path.dirname(process.execPath)));
}

/**
 * Best-effort, fire-and-forget `xattr -cr` on our own `.app` bundle. Safe to
 * call unconditionally — it no-ops outside a packaged macOS build and any
 * failure (missing `xattr`, read-only filesystem, permissions) is logged and
 * swallowed rather than surfaced to the user, exactly like the rest of this
 * file's cosmetic/best-effort startup steps (see `main.ts`'s dev dock-icon
 * handling for the same pattern).
 */
export function stripOwnQuarantineAttribute(): void {
  if (process.platform !== "darwin" || !app.isPackaged) return;
  const bundlePath = resolveAppBundlePath();
  execFile("xattr", ["-cr", bundlePath], (err) => {
    if (err) {
      log.warn("xattr -cr on own bundle failed (non-fatal)", { bundlePath, error: String(err) });
    }
  });
}
