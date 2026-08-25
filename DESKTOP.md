# Claude Code Monitor — Desktop App (macOS)

The dashboard ships with an optional **native desktop app** (built with Electron 35) that wraps the existing server + client into a single application you install once and forget — a macOS `.app` shipped as a `.dmg`. Everything you see in the browser at `localhost:4820` lives inside this window, with native OS lifecycle on top: a menu-bar (tray) icon, a native application menu, auto-start at login, and a single quit button that cleans up the server.

## Why this exists in addition to the PWA

The PWA (added in #144) makes the dashboard installable in Chromium-based browsers, which is great for users who already keep the server running. The desktop app solves the orthogonal problem: **starting and keeping the server running** without a terminal window. Concretely:

| Capability | PWA | Desktop App |
|---|---|---|
| Installs to dock / Applications | ✅ | ✅ |
| Manages the Express server | ❌ — user must `npm start` separately | ✅ — embedded in-process |
| Auto-starts at login | ❌ | ✅ via macOS Login Items |
| Menu-bar (tray) icon for always-on status | ❌ | ✅ |
| Native application menu (⌘ shortcuts, etc.) | ❌ | ✅ |
| Survives browser restart | ⚠️ depends on browser | ✅ |

The two coexist — install whichever fits your workflow.

## Quick install

**Option A — download a pre-built installer** (recommended):

1. Open [**Releases → latest**](https://github.com/buluma/Code-Agent-Monitor/releases/latest) and grab the DMG for your Mac. Every `master` commit that bumps the version in `package.json` cuts a new `vX.Y.Z` release automatically (CI publishes it), so this link always lands on the current build — no GitHub sign-in required.

   | Platform | Asset | Notes |
   |---|---|---|
   | macOS (Apple Silicon) | `ClaudeCodeMonitor-<ver>-arm64.dmg` | drag into `/Applications` |
   | macOS (Intel) | `ClaudeCodeMonitor-<ver>-x64.dmg` | drag into `/Applications` |

2. Want a **per-commit build** instead of waiting for a release? Every green CI run uploads a workflow artifact (sign-in required, 14-day retention) — `ClaudeCodeMonitor-dmg` from the `🍎 macOS Desktop (DMG)` job:
   ```bash
   gh run download <run-id> -R buluma/Code-Agent-Monitor -n ClaudeCodeMonitor-dmg
   ```
3. Double-click the DMG → drag `Claude Code Monitor.app` into your `Applications` folder. Open it; macOS may show a Gatekeeper warning the first time — see [Gatekeeper](#gatekeeper-first-launch) below.

**Option B — build locally:**

```bash
# In the project root, after `git clone`:
npm run setup                # installs root + client + vscode-extension deps
npm run build                # builds the React client
npm run desktop:install      # installs Electron + electron-builder

# Build for macOS — pick one:
npm run desktop:dmg:arm64    # Apple Silicon only — FAST (~1 min); use this for your own Mac
npm run desktop:dmg:x64      # Intel only — FAST
npm run desktop:dmg          # BOTH per-arch DMGs (arm64 + x64) — the release build; slower (packages each arch)
npm run desktop:dmg:universal # ONE merged universal DMG (arm64 + x86_64 in a single file) — optional, slowest

# Open the DMG you just built. desktop:dmg:arm64 / :x64 wipe release/ and emit
# one DMG; desktop:dmg wipes release/ and emits both (…-arm64.dmg + …-x64.dmg).
open desktop/release/ClaudeCodeMonitor-*-arm64.dmg   # …-x64.dmg for the Intel build
```

> **`desktop:dmg` builds both architectures, so it takes longer.** It packages
> and ad-hoc-signs the app **twice** — once for `arm64`, once for `x64` — and
> emits two separate DMGs (`…-arm64.dmg` + `…-x64.dmg`). It does **not** merge
> them into a single universal binary; the release ships the two per-arch DMGs.
> For running on **your own Mac**, use the arch-specific command
> (`desktop:dmg:arm64` / `desktop:dmg:x64`) — half the work, and it finishes in
> about a minute. CI runs `desktop:dmg` for you and uploads both DMGs as the
> `ClaudeCodeMonitor-dmg` artifact, so you rarely need to build them locally.

## What happens when you launch the app

1. The Electron main process picks a free port — preferring **4820**, falling back to 4821–4829, then a random high port if all those are taken.
2. If something already answers `/api/health` on port 4820 (e.g. you ran `npm start` in a terminal), the app **adopts that server** and skips starting a second one. No double-binding, no SQLite contention.
3. Otherwise it `require()`s `server/index.js` directly in-process — same Node runtime as the main process, same memory. Boot is typically under two seconds.
4. On startup the server records its **live port** to `~/.claude/.agent-dashboard.json`. The Claude Code hook handler reads that file, so events still reach the dashboard when the app bound a fallback port instead of 4820.
5. The dashboard window opens — unless the app was launched at login (via macOS Login Items), in which case it stays tray-only.
6. A tray icon appears in the macOS **menu bar**. One click opens a dropdown with a **live status snapshot** (server port, active sessions, working agents, events today — all clickable to jump into the dashboard) plus *Open Dashboard*, *Open in Browser*, *Restart Server*, *Show Logs*, *Open at Login* (toggle), and *Quit*.

## Lifecycle semantics

- **Closing the window hides it.** The server keeps running, the tray icon stays, and the **dock icon stays too** — clicking either re-opens the window. Independent signals that the app is still alive.
- **Quitting** (⌘Q, *Quit* in the application menu, or *Quit* in the tray menu) pops a confirmation dialog — *"Quit Claude Code Monitor? Press ⌘Q again to skip this prompt and quit immediately."* Press **Quit** in the dialog, or **press ⌘Q a second time** to bypass the prompt. Either way the SQLite handle is checkpointed cleanly before the process exits.
- **Tray** — the macOS menu bar. Uses a black template glyph the OS tints for light/dark menu bars. A single click (left or right) opens the dropdown, which shows a **live status snapshot** pulled straight from the embedded SQLite handle each time it opens: server port, active sessions, working agents, and events today. Snapshot rows are clickable — they open the dashboard. The tray's *Open Dashboard* reliably **raises** the window even when it is minimized or behind other windows. (The application menu's *File ▸ Open Dashboard* / ⌘1 does the same.)
- **Window / Dock icon** — the `BrowserWindow` sets its `icon` to the app logo (`icon.png`, the same logo as the macOS Dock, rendered from `assets/icon.svg`), so an unpackaged `desktop:dev` run shows the real app logo in the title bar instead of the generic Electron icon. The dev Dock icon is set too; packaged apps already get theirs from the bundle `.icns`.
- **Open-at-login toggle:** flip *Open at Login* in the tray menu (or the app menu). Goes through Electron's first-party `app.*LoginItemSettings` API, which registers via the `SMAppService` API, so the entry appears under  → *System Settings → General → Login Items*.
- **Single-instance:** double-launching just focuses the existing window. No second server, no port collision.
- **Logs** live at `~/Library/Logs/Claude Code Monitor/desktop.log` (use *Show Logs* in the tray menu to open the folder).
- **Your data** (the SQLite database and VAPID keys) lives outside the app bundle, so it **survives app reinstalls and updates** — `~/Library/Application Support/Claude Code Monitor/data/`. Dragging the `.app` to the Trash never touches your data.
- **The `claude` CLI on PATH.** The app resolves it using your login-shell `PATH`, recovered at startup — so "Run Claude" works even though a Finder/Dock-launched app would otherwise only inherit a minimal `PATH`.
- **Notifications** (including the in-dashboard *Send test notification* button) are delivered as **native OS toasts** when running inside the app — the embedded server calls Electron's `Notification` API directly. Web Push doesn't work reliably inside Electron (Chromium-in-Electron ships without Firebase Cloud Messaging credentials, so `pushManager.subscribe` returns endpoints nothing can deliver to), and this path bypasses it entirely. The web dashboard at `npm start` continues to use Web Push as before.
- **Coexists with the web dashboard.** You can run the desktop app and `npm run dev` (or `npm start`) at the same time. Each server writes its `{port, pid, startedAt, dataDir}` entry to a shared discovery file at `~/.claude/.agent-dashboard.json`, and the Claude Code hook handler POSTs to **one ingest target per unique SQLite data directory** (lowest port wins when both share `~/.claude/agent-dashboard`, so events are never double-ingested). Servers with **different** databases (e.g. the desktop app's Application Support dir alongside `npm run dev`) still each receive hooks and stay real-time.

## File layout (for contributors)

```
desktop/
├── package.json                # Electron + electron-builder
├── tsconfig.json
├── electron-builder.yml        # macOS (dmg) target; signing/notarization hooks
├── assets/                     # icon.svg + generated icon.icns (macOS) + tray PNGs
├── src/
│   ├── main.ts                 # main process entry, lifecycle
│   ├── server-host.ts          # in-process Express boot, port discovery, adopt
│   ├── window.ts               # BrowserWindow + persisted state
│   ├── tray.ts                 # tray icon (template PNG) + context menu
│   ├── menu.ts                 # native application menu
│   ├── login-item.ts           # open-at-login (macOS Login Items)
│   ├── shell-path.ts           # recover the user's shell PATH (find `claude`)
│   ├── preload.ts              # (empty — kept for future renderer bridges)
│   ├── logger.ts               # file logger
│   └── constants.ts            # app name, port, window defaults
├── scripts/
│   ├── install.js              # `desktop:install` wrapper: runs npm install, then prints actionable native-dep help + exits non-zero on failure
│   ├── preflight.js            # shared native-dep check (hasBetterSqliteBinary) + per-OS prerequisite help (printNativeDepHelp)
│   ├── prebuild.js             # ensures root + client are built before tsc; fails fast with setup help when the better-sqlite3 native binary is missing
│   ├── build-icons.sh          # SVG → PNG/ICNS + tray PNGs via qlmanage/sips/iconutil (macOS)
│   └── notarize.js             # electron-builder afterSign hook (opt-in; macOS only)
└── tests/
    └── smoke.test.mjs          # spawn-and-probe /api/health (resolves the real electron binary via createRequire)
```

**Changes outside `desktop/` are deliberately minimal:**

- `server/index.js` — a behavior-preserving refactor: the post-listen bootstrap (one-time legacy-session import, update scheduler, Claude Code config watcher, orphaned-run reconciliation) was extracted into an exported `startBackgroundServices()` so the embedded server runs exactly what `node server/index.js` runs. The standalone server path is functionally unchanged. (The legacy-session import previously sat in the standalone-only `require.main` block, so the desktop dashboard started empty — moving it into `startBackgroundServices()` fixes that.) It also now publishes its live port via `server/lib/server-info.js` on startup.
- `server/lib/server-info.js` *(new)* — writes/reads the `~/.claude/.agent-dashboard.json` port discovery file.
- `scripts/hook-handler.js` — resolves the dashboard port from the discovery file (falling back to `CLAUDE_DASHBOARD_PORT`, then 4820), so hook events reach the server even when it bound a fallback port.

`client/`, `mcp/`, and `vscode-extension/` are untouched. The Electron main process is otherwise just a host for the same code.

## Gatekeeper (first launch)

The DMG is **ad-hoc signed** by default — that's all the project can offer without a paid Apple Developer ID. macOS will warn the first time you open it: *"Apple could not verify…"*.

Two ways past it:

```bash
# Easiest: strip the quarantine attribute from the DMG before opening.
xattr -cr ~/Downloads/ClaudeCodeMonitor-*.dmg
```

Or open  → *System Settings → Privacy & Security*, scroll to the blocked DMG, click *Open Anyway*.

If the quarantine flag survives the drag into `Applications` (or you cleared it on the DMG *after* copying the app out), macOS shows a different, scarier dialog on the installed `.app` itself: *"Claude Code Monitor.app" is damaged and can't be opened. You should move it to the Bin.* This is still Gatekeeper, not corruption — strip the flag from the installed app instead of the DMG:

```bash
xattr -cr "/Applications/Claude Code Monitor.app"
```

### Notarization (for the maintainer)

When you're ready to make this go away for everyone, add these three repository secrets:

| Secret | Where it comes from |
|---|---|
| `APPLE_ID` | Your Apple ID email |
| `APPLE_TEAM_ID` | Your Apple Developer team ID |
| `APPLE_APP_SPECIFIC_PASSWORD` | An app-specific password created at appleid.apple.com |

Optionally, also `CSC_LINK` (base64-encoded `.p12`) and `CSC_KEY_PASSWORD` to provide an explicit Developer ID certificate from outside the runner keychain. The CI workflow picks them up automatically — no code change required. See [`desktop/scripts/notarize.js`](desktop/scripts/notarize.js) for the hook.

> Local builds are **always ad-hoc signed**: the `package` script sets `CSC_IDENTITY_AUTO_DISCOVERY=false`, so a code-signing certificate already in your macOS keychain is never auto-discovered (an Apple Development cert would otherwise be picked up and fail distribution-type signing). Real signing activates only through the explicit `CSC_LINK` certificate above — that path is unaffected by the flag.

## Development workflow

```bash
# Hot-iterate on the main process (rebuilds tsc on save would be next steps;
# v1 ships without watch mode — just re-run desktop:dev after changes):
npm run desktop:dev

# Smoke test (also runs in CI on macOS):
npm run desktop:test

# macOS — single-architecture DMG — fast (~1 min):
npm run desktop:dmg:arm64    # or desktop:dmg:x64 for Intel

# macOS — both per-arch DMGs — slower (builds + signs each architecture):
npm run desktop:dmg

# macOS — one merged universal DMG (arm64 + x86_64 in a single file) — optional, slowest:
npm run desktop:dmg:universal
```

> electron-builder packages for the **host OS** — DMGs must be built on macOS.
> The icns + tray PNGs come from `npm run build:icons`. `better-sqlite3` is
> rebuilt against Electron's Node version by `npm run desktop:install` (its
> postinstall runs `electron-builder install-app-deps`); this needs Xcode
> Command Line Tools (`xcode-select --install`) if no prebuilt binary is
> available for your Node version. If that fetch/rebuild *does* fail, `npm run
> desktop:install` — and any `desktop:*` build, gated by `prebuild.js` —
> prints the exact fix plus a no-toolchain alternative and **fails loudly**
> rather than crashing at runtime:
>
> ```bash
> cd desktop
> npm install --ignore-scripts
> node node_modules/electron/install.js
> npx electron-builder install-app-deps
> ```
>
> A Node LTS (20/22) ships prebuilt `better-sqlite3` binaries and avoids the
> compile entirely.

> After `npm run clean` in `desktop/`, you must `npm run build` again before
> packaging — `clean` removes `out/`, and `electron-builder` only packages, it
> does not compile. The `desktop:dmg*` scripts chain the build for you; a bare
> `electron-builder` call does not, and fails with
> _"entry file out/main.js does not exist"_.

The smoke test does not exercise the BrowserWindow (no display on headless CI). It spawns Electron, waits for the embedded server to answer `/api/health`, then shuts down. Anything that depends on the renderer is part of the manual QA checklist on the PR.

## Known caveats

- **Bundle size** ≈ 80 MB DMG, ≈ 250 MB on disk. The standard Electron tax. Tauri would cut this dramatically but at the cost of a sidecar-process model and a Rust toolchain dependency — fair to revisit in a follow-up PR if bundle size becomes a real complaint.
- **Native modules**: `better-sqlite3` is rebuilt against Electron's Node version automatically via `electron-builder install-app-deps` in the desktop workspace's `postinstall`. If that build *does* fail (or the binary is missing afterward), `npm run desktop:install` — and any `desktop:*` build — prints the exact per-OS fix (macOS: `xcode-select --install`) plus a no-toolchain alternative (`npm install --ignore-scripts` → `node node_modules/electron/install.js` → `npx electron-builder install-app-deps`), and exits non-zero — failing loudly at install/build time rather than crashing at runtime. Even so, if the module is unavailable the server falls back to `node:sqlite` (per #37), so the app still boots.
- **Per-architecture DMGs**: `npm run desktop:dmg` builds **both** macOS DMGs (one `arm64`, one `x64`) — the release build, and slower because it packages each architecture separately. It does **not** produce a merged universal binary; the release ships the two per-arch DMGs. `npm run desktop:dmg:arm64` and `npm run desktop:dmg:x64` build a single architecture instead — much faster, and roughly half the disk. If you specifically want a **single merged universal binary** (both slices in one `.dmg`, `lipo`-fat), `npm run desktop:dmg:universal` produces one via `@electron/universal` — the slowest option, and not what the release ships, but handy for hand-distributing one file that runs on any Mac.
- **Auto-update**: not wired. The current update path is *re-download the latest DMG*. `electron-updater` + GitHub Releases is the natural follow-up.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| "Apple could not verify…" on first launch | Unnotarized DMG | `xattr -cr ~/Downloads/ClaudeCodeMonitor-*.dmg` |
| "…is damaged and can't be opened. You should move it to the Bin." | Quarantine flag survived onto the installed `.app` (not actual corruption) | `xattr -cr "/Applications/Claude Code Monitor.app"`, then reopen |
| macOS prompts to install Rosetta when opening the app | You installed the **x64** build on an Apple Silicon Mac | Check your arch with `uname -m` (`arm64` → Apple Silicon, build with `desktop:dmg:arm64`). The arch-specific `desktop:dmg:arm64` / `desktop:dmg:x64` builds each wipe `release/` and emit a single DMG whose mounted-volume title states the architecture — e.g. *Claude Code Monitor (Apple Silicon)* — so there is no ambiguous window to drag from. (`desktop:dmg` emits both per-arch DMGs at once, for release.) If stale DMGs from an older build linger, clear them with `rm -rf desktop/release` and rebuild |
| Window shows but content is blank | Server didn't boot — check `~/Library/Logs/Claude Code Monitor/desktop.log` | Restart from tray → *Restart Server* |
| Tray icon missing | The OS hides tray icons when the menu bar is full | Move other menu-bar items aside, or look in the overflow chevron |
| App didn't auto-start at login | Login Items entry got revoked by macOS | Toggle *Open at Login* off and on again from the tray menu |
| Desktop build/install fails on `better-sqlite3` / native binary missing | No C++ toolchain, or no prebuilt for your Node version | Run `npm run desktop:install` and follow the printed help, or use the no-toolchain alternative (`npm install --ignore-scripts` → `node node_modules/electron/install.js` → `npx electron-builder install-app-deps`); or use Node LTS 20/22 |
| Port 4820 already in use, app refuses to start | Something other than the dashboard is on 4820 and it doesn't answer `/api/health` | The app will pick a fallback (4821–4829, then a random high port) — check the tray menu's port indicator |
| Dashboard stays empty — 0 sessions, 0 agents, no real-time updates | The app bound a fallback port (4820 was taken), and the Claude Code hooks were posting events to the wrong port | Fixed — the server publishes its live port to `~/.claude/.agent-dashboard.json` and the hook handler reads it. After upgrading from a pre-fix build, **start a new Claude Code session** so the updated hooks take effect |
| `desktop:dmg` seems slow | Not stuck — it packages two architectures back-to-back (`arch=x64` then `arch=arm64`) | Wait it out, or build a single architecture with `desktop:dmg:arm64` / `desktop:dmg:x64` |
| Build fails: `entry file out/main.js does not exist` | `electron-builder` was run without compiling TypeScript first | Build via `npm run desktop:dmg*` (chains the build); don't invoke `electron-builder` bare |
| Signing fails with `Application … could not be found` | A code-signing certificate in your keychain was auto-discovered | Fixed — the `package` script sets `CSC_IDENTITY_AUTO_DISCOVERY=false`; build via `npm run desktop:dmg*` |
| "Run Claude" reports the `claude` CLI isn't on your PATH | A Finder/Dock-launched app inherits launchd's minimal PATH, not your shell PATH | Fixed — the app recovers your login-shell PATH at startup. If it persists, ensure `claude` is a real executable (not a shell alias/function) and on your shell PATH |
| Imported history / sessions vanished after updating the app | Older builds stored the database inside the (replaceable) app bundle | Fixed — data now lives in `~/Library/Application Support/Claude Code Monitor/data/` and survives reinstalls. After upgrading from a pre-fix build, re-run **Import History → Rescan** once |
