/**
 * @file Open-at-login integration (macOS Login Items).
 *
 * Goes through Electron's first-party `app.*LoginItemSettings` API — no
 * third-party deps, no hand-rolled plist edits. Wraps the modern
 * `SMAppService` / `ServiceManagement` framework (macOS 13+), so the toggle
 * appears in System Settings → General → Login Items where users expect to
 * manage it.
 *
 * Linux has no Electron-supported equivalent, so the toggle is a no-op there.
 * @author Michael Buluma <1452922+buluma@users.noreply.github.com>
 */
/* =============================================================================
 * MODULE_GUIDE — extended in-file reference (comments only; safe to read, never executed)
 * =============================================================================
 * **Path:** `/Users/buluma/Documents/GitHub/Claude-Code-Agent-Monitor/desktop/src/login-item.ts`
 * **Purpose:** Dashboard module consumed by the React client, MCP tools, or desktop shell depending on deployment mode.
 *
 * ## Design constraints
 * - Local-first: no telemetry leaves the machine unless the user configures webhooks.
 * - Fail-safe hooks path on the server must never block Claude Code; UI mirrors that
 *   philosophy by degrading gracefully (empty states, stale badges, reconnect loops).
 * - Destructive flows stay behind explicit confirmation modals and server-side gates.
 * - Internationalization: user-visible strings belong in i18n JSON, not literals here.
 *
 * ## Remote data & SSH
 * Remote Data Sources let operators aggregate multiple machines. SSH entries describe
 * how to reach a peer dashboard; the global data scope (`dataScope.ts`) narrows every
 * scoped GET via `?sources=`. Health checks and import history surface in Settings.
 *
 * ## Observability
 * Prometheus scrapes `GET /api/metrics` (see `monitoring/`). Grafana ships four
 * provisioned boards (overview, sessions, tools, alerts). Native npm scripts and
 * Docker Compose profiles are documented in `monitoring/README.md`.
 *
 * ## Public surface
 * - `isOpenAtLogin` — exported API; see TSDoc on the symbol for behavior.
 * - `setOpenAtLogin` — exported API; see TSDoc on the symbol for behavior.
 * - `toggleOpenAtLogin` — exported API; see TSDoc on the symbol for behavior.
 * - `launchedAtLogin` — exported API; see TSDoc on the symbol for behavior.
 *
 * ## Testing pointers
 * - Prefer colocated `__tests__` with Vitest + Testing Library for UI.
 * - Server contract changes require `npm run test:server` and OpenAPI sync.
 * - MCP edits: `npm run mcp:typecheck` and `npm run mcp:build`.
 *
 * ## Related docs
 * - `ARCHITECTURE.md` — hooks → API → SQLite → WebSocket → UI pipeline.
 * - `docs/API.md` — REST reference.
 * - `.claude/skills/file-headers/` — mandatory `@author` header policy.
 * ============================================================================= */
/* -----------------------------------------------------------------------------
 * EXPORT CATALOG — quick index of symbols defined below (documentation only).
 * -----------------------------------------------------------------------------
 * **isOpenAtLogin**
 *   Part of this module's public contract. Downstream imports should treat
 *   the signature and return type as stable unless release notes say otherwise.
 *   When behavior changes, update the `@file` overview and relevant tests.
 *
 * **setOpenAtLogin**
 *   Part of this module's public contract. Downstream imports should treat
 *   the signature and return type as stable unless release notes say otherwise.
 *   When behavior changes, update the `@file` overview and relevant tests.
 *
 * **toggleOpenAtLogin**
 *   Part of this module's public contract. Downstream imports should treat
 *   the signature and return type as stable unless release notes say otherwise.
 *   When behavior changes, update the `@file` overview and relevant tests.
 *
 * **launchedAtLogin**
 *   Part of this module's public contract. Downstream imports should treat
 *   the signature and return type as stable unless release notes say otherwise.
 *   When behavior changes, update the `@file` overview and relevant tests.
 *
 * ----------------------------------------------------------------------------- */

import { app } from "electron";

/** True on macOS — the only platform Electron can register an auto-start
 * entry for here. Every exported function below is a no-op elsewhere. */
function supported(): boolean {
  return process.platform === "darwin";
}

/**
 * Read the current auto-start state directly from the OS (macOS Login
 * Items), not from any value cached by this module — so it stays correct
 * even if the user disables the entry from outside the app (e.g. macOS
 * System Settings).
 */
export function isOpenAtLogin(): boolean {
  if (!supported()) return false;
  return app.getLoginItemSettings().openAtLogin;
}

/**
 * Enable or disable launching the app at login. Delegates entirely to
 * `app.setLoginItemSettings`, which registers via the modern `SMAppService`
 * API and starts the app hidden (see the `openAsHidden` comment below).
 * No-op on platforms other than macOS, where Electron has no supported
 * mechanism here.
 */
export function setOpenAtLogin(enabled: boolean): void {
  if (!supported()) return;
  app.setLoginItemSettings({
    openAtLogin: enabled,
    // Start hidden — the user just logged in, they didn't ask for a window
    // to appear. The tray icon makes the app's presence obvious.
    openAsHidden: true,
  });
}

/**
 * Flip the auto-start setting and return the new state. Used by both the
 * tray "Open at Login" checkbox and the application menu item — each reads
 * `isOpenAtLogin()` to render its own checked state, then calls this on click.
 */
export function toggleOpenAtLogin(): boolean {
  const next = !isOpenAtLogin();
  setOpenAtLogin(next);
  return next;
}

/**
 * Returns true if the current process was launched at login (as opposed to the
 * user double-clicking the app). When true, we keep the window hidden and only
 * show the tray icon.
 *
 * macOS reports this directly via `wasOpenedAtLogin`.
 */
export function launchedAtLogin(): boolean {
  if (process.platform === "darwin") {
    return app.getLoginItemSettings().wasOpenedAtLogin;
  }
  return false;
}
