# T3 Integration Spec

Status: **Phase 1 + Phase 2 shipped (v3.5.0)** — read-only monitoring, Config
Explorer, resync, and best-effort cost attribution all implemented. Remote
Sources home and the launch-from-dashboard spawner are skipped (not used). Date:
2026-09-04 Scope owner: monitor backend (`server/`), client, MCP, docs

---

## 1. Context

**T3** (`t3`) is a direct fork of Helm Code on this machine and shares Helm
Code's integration shape almost exactly. Like Helm Code, T3 is a local agent
host/orchestrator that runs agent runtimes as **drivers** and keeps the full
session/message/turn/activity state in a single SQLite database,
`~/.t3/userdata/state.sqlite`, instead of JSONL transcripts. A local server
(`127.0.0.1:<port>` from `~/.t3/userdata/server-runtime.json`) serves its web UI
over WebSocket RPC.

Because T3 is a fork of Helm Code, the dashboard treats it as a **second,
independent instance of the same thread-engine projection schema**: the
`projection_*` tables, `orchestration_events` log, and `usage-model-rates.json`
cost file are structurally identical to Helm Code's, so T3 is monitored through
the same generic engine (`server/lib/thread-provider.js`) parameterized by a
`provider` and an `stmtPrefix`, wrapped by thin T3 modules — rather than a
parallel copy of the Helm Code code.

### Why this is the same integration shape as Helm Code

| Capability                | Claude / Codex today                                            | T3                                     |
| ------------------------- | --------------------------------------------------------------- | -------------------------------------- |
| Transcript files to watch | `~/.claude/projects/**/*.jsonl`, `~/.codex/sessions/**/*.jsonl` | **None** — one SQLite DB               |
| Real-time trigger         | fs.watch on transcript dirs + hook callbacks                    | **No hooks**; `state.sqlite`           |
| Token/cost data inline    | parsed from transcript lines                                    | `usage-model-rates.json` re-derives it |

---

## 2. Goals / Non-goals

### Goals

- Read-only, non-intrusive monitoring of T3 threads as a first-class **`t3`
  provider** in the dashboard, at full parity with the Helm Code provider.
- Sessions, conversation messages, activity/tool feed, turn lifecycle, status,
  and project→cwd mapping, updated in near-real-time by a change-fingerprinted
  poll of `~/.t3/userdata/state.sqlite`.
- Provider filter (`?providers=claude,codex,helmcode,t3`) across the scoped UI
  (`dataScope`), API routes, and MCP.
- A read-only **T3 Config Explorer** under Agent Config
  (`/api/t3-config/overview` + `/api/t3-config/resync`), mirroring the Helm Code
  Config Explorer.
- Best-effort cost attribution from `usage-model-rates.json`, mirroring
  `helmcode-pricing.js`.
- Full doc, i18n, wiki, and test coverage per the repo's doc rules.

### Non-goals

- Launching/resuming T3 threads from the dashboard (no spawner).
- Live WebSocket RPC subscription to T3's event stream.
- Remote Data Sources mirroring for the T3 home.

### Approved decisions

| # | Decision                                                                  | Effect on this spec                                                       |
| - | ------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| 1 | UI label reads **"T3"**                                                   | All client/i18n labels and docs use "T3"; the provider _key_ stays `'t3'` |
| 2 | Deleted/archived threads are **wiped** (session row removed, not flagged) | Lifecycle mapping; sweep wipe pass on `deleted_at`/`archived_at`          |
| 3 | T3 **Config Explorer page** ships with the integration                    | §6 change surface                                                         |
| 4 | **MCP run/import enums advertise `"t3"`**                                 | Provider `z.enum` sites gain `"t3"`                                       |

---

## 3. Data source model

`~/.t3/userdata/state.sqlite` (WAL mode; release builds). Read-only, via the
existing `compat-sqlite.js` wrapper; open with `{ readonly: true }` on every
sweep, never hold the handle.

The tables are identical to Helm Code's `projection_*` projection scheme:
`projection_projects`, `projection_threads`, `projection_thread_sessions`,
`projection_thread_messages`, `projection_thread_activities`,
`projection_turns`, and the globally-sequenced `orchestration_events` log (the
durable cursor). `auth_sessions`/`auth_pairing_links` are **not ingested**.

Overrides: honor `DASHBOARD_T3_HOME`, then T3's own env override, then `~/.t3`.
The user-data dir is `<home>/userdata/` for release builds and `<home>/dev/` for
dev builds (see `server-runtime.json` / `environment-id`).

---

## 4. Architecture

T3 rides the **generic thread-engine module** `server/lib/thread-provider.js`
(`createThreadProvider(config)`), which hosts the home resolution, ingest
engine, pricing engine, sync loop, and transcript reader shared with Helm Code.
T3 supplies thin wrappers that pass `{ provider: "t3", stmtPrefix: "t3" }` and
`schema` options:

```
┌──────────────────────────────────────────────────────────────┐
│  t3 (server on 127.0.0.1:<port>)                             │
│  ~/.t3/userdata/state.sqlite  (WAL)                          │
└──────────────────────────┬───────────────────────────────────┘
                           │ read-only opens (compat-sqlite)
┌──────────────────────────▼───────────────────────────────────┐
│  Claude Code Agent Monitor server                             │
│  lib/t3-home.js          → resolve db path + server runtime    │
│  lib/t3-ingest.js        → cursor over orchestration_events,   │
│                            reconcile projections into          │
│                            sessions/events/messages/turns       │
│  lib/t3-sync.js          → startT3Sync(broadcast): fs.watch on  │
│                            state.sqlite/-wal + 4 s safety poll  │
│  lib/thread-provider.js  → shared generic engine (stmtPrefix)   │
└──────────────────────────┬───────────────────────────────────┘
                           │ provider="t3" rows
              DB (sessions, events, messages, agents)
                           │ WS broadcast + scoped REST
                client (dataScope, SessionDetail, Dashboard)
```

### Real-time strategy

Mirror the Helm Code pattern: `fs.watch` the user-data dir and trigger on
`state.sqlite` and `state.sqlite-wal` only — never `-shm` (SQLite touches the
wal-index on every WAL reader open, which self-perpetuates a full-scan loop).
Keep a fingerprint-based 4 s safety-net poll (`DASHBOARD_T3_SYNC_MS`, default
4000, `0` disables). A sweep never enqueues another sweep. Wipes broadcast the
existing `session_removed` WS frame.

### Idempotency / cursor

Persist `t3_sync(thread_id, last_applied_sequence, last_turn_row, updated_at)`
(additive migration). Each sweep reads events with `sequence > cursor` per
thread and reconciles the `projection_*` tables as authoritative current card
state. Failed passes leave the cursor unmoved so the next sweep retries.

---

## 5. Data mapping

### Thread → Session

| CAM field                   | Source                                                                                                                                                                         |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `id`                        | `projection_threads.thread_id`                                                                                                                                                 |
| `name`                      | thread `title`, else `New session - <ts>`                                                                                                                                      |
| `provider`                  | `'t3'`                                                                                                                                                                         |
| `cwd`                       | `projection_projects.workspace_root` (by `project_id`)                                                                                                                         |
| `status`                    | map `projection_thread_sessions.status` (+ `active`/`error` heuristics)                                                                                                        |
| `model`                     | thread `model_selection_json` / project `default_model_selection_json` (best-effort)                                                                                           |
| `started_at` / `updated_at` | `created_at` / `updated_at`                                                                                                                                                    |
| `metadata`                  | JSON: t3-specific extras (`turn_count`, `pending_approval_count`, `interaction_mode`, `runtime_mode`, underlying `provider_name`, `provider_session_id`, pinned/snoozed flags) |

**Lifecycle (wipe):** when `projection_threads.deleted_at` or `archived_at` is
set, the sweep deletes the CAM session row (messages/events cascade) and removes
the `t3_sync` cursor row.

### Messages, Activities, Turns, Costs

Identical to Helm Code §5: `projection_thread_messages` → `messages`
(message_id-keyed), activities → provider-prefixed `t3_*` event types
(`t3_turn_start`, `t3_turn_complete`, `t3_user_message`, `t3_tool_call`,
`t3_task_complete`, `t3_context_compacted`, `t3_error`), turns → turn
bookkeeping, and cumulative `context-window.updated` snapshots → `token_usage`
via `replaceTokenUsage`.

Costing mirrors `helmcode-pricing.js` via the generic engine's `loadModelRates`
/ `resolveModelRate` / pricing calculator, reading `usage-model-rates.json`
directly. `calculateProviderCost` (`server/routes/pricing.js`) now splits token
rows four ways (`provider === "codex"` / `"helmcode"` / `"t3"` / else Claude) so
no provider's rate card is applied to another's tokens. Best-effort: an
unmatched bucket or missing rate file surfaces in `unpriced_models` rather than
pricing at $0 silently.

---

## 6. Change surface

### New server modules

| File                                | Contents                                                                                                                                                                         |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `server/lib/thread-provider.js`     | Generic engine shared by Helm Code and T3: `createThreadProvider(config)` + `stmtPrefix`. Hosts home resolution, ingest engine, pricing engine, sync loop, and `readTranscript`. |
| `server/lib/t3-home.js`             | `getT3Home()` (`DASHBOARD_T3_HOME` → T3 env override → `~/.t3`), `getT3StateDbPath()`, `getT3ServerRuntime()`, `onT3HomeChanged(listener)`, `setT3Home()` (settings persistence) |
| `server/lib/t3-ingest.js`           | `syncT3Sessions()`, `ingestT3Snapshot()`, `reconcileT3Liveness()`, `readT3Transcript()` — thin wrappers over the shared engine                                                   |
| `server/lib/t3-pricing.js`          | `calculateT3Cost()` wrapper over the shared pricing engine                                                                                                                       |
| `server/lib/t3-sync.js`             | `startT3Sync(broadcast)` (watch + 4 s poll + wipe rescan); home-change watcher re-arm                                                                                            |
| `server/routes/t3-config.js`        | Config Explorer overview + resync (`GET /api/t3-config/overview`, `POST /api/t3-config/resync`)                                                                                  |
| `server/openapi-extra/t3-config.js` | OpenAPI fragment for the T3 Config surface                                                                                                                                       |

### Modified server files

| File                                    | Change                                                                                                    |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `server/db.js`                          | additive `t3_sync`, `t3_messages`, `t3_activities` tables + last_turn_row migration + prepared statements |
| `server/lib/provider-filter.js`         | `VALID_PROVIDERS = ["claude","codex","helmcode","t3"]`                                                    |
| `server/routes/sessions.js`             | T3 card_preview CASE, transcript branch, `readT3Transcript` import/export                                 |
| `server/routes/settings.js`             | T3 home override read/write (`/api/settings/t3-home`)                                                     |
| `server/routes/pricing.js`              | `calculateT3Cost` in `calculateProviderCost` four-way split                                               |
| `server/routes/import.js`               | accept `"t3"` in `requestedProvider` (mirrors helmcode; Config resync is the real import path)            |
| `server/openapi.js` / `openapi-extra/*` | provider param enums/descriptions gain `"t3"`                                                             |

### Client

| File                                                                                        | Change                                                        |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `client/src/lib/dataScope.ts`                                                               | `ProviderScope` + parse whitelist add `"t3"`                  |
| `client/src/lib/types.ts` / `api.ts`                                                        | provider union + `t3Config`/`t3Home` API namespaces           |
| `client/src/components/T3ConfigExplorer.tsx`                                                | read-only T3 Config Explorer (mirrors HelmcodeConfigExplorer) |
| `client/src/pages/Settings.tsx`, `CcConfig.tsx`, `ccConfig/Header.tsx`                      | provider options + deep link                                  |
| `client/src/components/{StatusBadge,AgentCard,SplashScreen}.tsx`, `pages/SessionDetail.tsx` | `"t3"` provider labels/badges                                 |
| `client/src/i18n/locales/en/{ccConfig,settings,splash}.json`                                | "T3" labels + section keys (English-only)                     |

### MCP

`dashboard_get_t3_config` tool added; provider `z.enum` sites in
`mcp/src/tools/domains/*-tools.ts` (8 files) gain `"t3"`; `t3_config` added to
the REPL tab-grouping regex in `mcp/src/transports/repl.ts`.

### Tests

| Area                                  | Plan                                                                                       |
| ------------------------------------- | ------------------------------------------------------------------------------------------ |
| `server/__tests__/t3-home.test.js`    | path resolution chain incl. env overrides (3)                                              |
| `server/__tests__/t3-pricing.test.js` | rate resolution + cost split (9)                                                           |
| `server/__tests__/t3-config.test.js`  | overview + resync route behavior (5)                                                       |
| `server/__tests__/t3-ingest.test.js`  | fixture `state.sqlite`, cursor idempotency, event mapping, wipe review, transcript DTO (4) |
| `client`                              | T3ConfigExplorer tests (3)                                                                 |
| `mcp`                                 | `npm run mcp:typecheck` + `npm run mcp:build`                                              |

### Docs (per `.claude/skills/update-project-docs` map)

README.md, ARCHITECTURE.md, `index.html` landing, `server/README.md` (routes +
mirror + pricing + Config Explorer), `client/README.md`, `docs/API.md`,
`docs/DATABASE.md` (`t3_*` tables + event types), `docs/PLUGINS.md` (`t3_*`
event types), `mcp/README.md`, wiki `index.html` + `sw.js` cache bump, and this
spec. New env var: `DASHBOARD_T3_HOME` and `DASHBOARD_T3_SYNC_MS`.

---

## 7. Phasing

| Phase     | Contents                                                                                                                                                                                          |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1 + 2** | Generic `thread-provider.js` refactor shared with Helm Code, `t3-*` wrappers, DB migration, provider filter, routes, MCP enums + tool, UI, Config Explorer, cost attribution, tests, full doc set |

Remote Sources home and the launch-from-dashboard spawner are **explicitly
skipped** (not used — this deployment runs T3 locally and doesn't need either).

---

## 8. Risks & mitigations

1. **`-shm` trigger loop** — never trigger on `state.sqlite-shm`; shared with
   the Helm Code sweep design.
2. **Poll CPU tax** — read-only targeted queries keyed by cursor/`thread_id`;
   fingerprint gate before touching the DB.
3. **WAL read concurrency / `SQLITE_BUSY`** — short-lived read-only connections
   per pass, `busy_timeout`, retry-without-cursor-advance.
4. **Schema drift in the T3 fork** — the generic engine and wrappers read
   defensively (fail to "no change", never crash a sweep); the shared
   `thread-provider.js` engine keeps the two forks in lock-step.
5. **Duplicate coverage** (a thread driven by a claude/codex driver also on disk
   as a transcript) — acceptable; when overlap occurs both views remain valid.
   Documented, not deduped.
6. **Tests share one fixture DB** — `t3_messages` is message_id-keyed, so tests
   that seed multiple sessions must use distinct `message_id`s to avoid PK
   collisions (mirrors the `m-ghost`-style ids in the helmcode suite).

---

## 9. Decisions log

- **Provider key:** `"t3"`, displayed as **T3** everywhere.
- **Generic refactor:** Helm Code and T3 share `server/lib/thread-provider.js`
  (`createThreadProvider` + `stmtPrefix`) rather than maintaining parallel
  modules; T3 ships as thin wrappers.
- **Wipe semantics:** deleted/archived threads are removed (rows + cursor),
  never flagged.
- **MCP enums:** all provider sites advertise `"t3"`.

Subsequent changes to this spec must be appended here with date and rationale
rather than silently rewritten.
