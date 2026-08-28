# Helm Code Integration Spec

Status: **Proposed** — for review before implementation Date: 2026-08-28 Scope
owner: monitor backend (`server/`), client, MCP, docs

---

## 1. Context

Helm Code (`helmcode`) is a local agent host/orchestrator on this machine. It
runs agent runtimes as **drivers** (codex, claudeAgent, cursor, grok, opencode,
openrouter, nvidia) and keeps the full session/message/turn/activity state in a
single SQLite database, `~/.helmcode/userdata/state.sqlite`, instead of JSONL
transcripts. A local server (`127.0.0.1:<port>` from
`~/.helmcode/userdata/server-runtime.json`) serves its web UI over WebSocket
RPC.

The user's normal Helm Code workload uses the **opencode** and **grok** drivers,
which the dashboard does not monitor today (Claude Code and Codex transcripts
are covered directly). Monitoring Helm Code therefore adds genuinely new
coverage rather than duplicating existing sessions.

### Why this is a different integration shape

| Capability                | Claude / Codex today                                            | Helm Code                                                                                                                                                                            |
| ------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Transcript files to watch | `~/.claude/projects/**/*.jsonl`, `~/.codex/sessions/**/*.jsonl` | **None** — all state lives in one SQLite DB (WAL mode)                                                                                                                               |
| Real-time trigger         | fs.watch on transcript dirs + hook callbacks                    | **No Claude-Code-style hooks**; live data arrives only in `state.sqlite` (and optionally via the server's WebSocket RPC, authenticated)                                              |
| Token/cost data inline    | parsed from transcript lines                                    | **Not present in the DB** (`usage-model-rates.json` / `usage-scan-cache.json` caches re-derive it from the _underlying_ driver's transcripts — which do not exist for opencode/grok) |

---

## 2. Goals / Non-goals

### Goals (Phase 1 — MVP)

- Read-only, non-intrusive monitoring of Helm Code threads as a first-class
  **`helmcode` provider** in the dashboard.
- Sessions, conversation messages, activity/tool feed, turn lifecycle, status
  (active/waiting/error), and project→cwd mapping, updated in near-real-time by
  a change-fingerprinted poll of `state.sqlite`.
- Provider filter across the existing scoped UI (`dataScope`), API routes, and
  MCP.
- Full doc, i18n, wiki, and test coverage per the repo's doc rules.

### Non-goals (Phase 1)

- Launching/resuming Helm Code threads from the dashboard (no
  `helmcode-run-spawner`).
- Live WebSocket RPC subscription to Helm Code's event stream (auth ceremony,
  phase 3).
- Token usage/cost attribution for Helm Code threads (no source data; phase 2).
- Remote Data Sources mirroring for Helm Code home (phase 2).

### Approved decisions (2026-08-28)

| # | Decision                                                                  | Effect on this spec                                                                    |
| - | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| 1 | UI label reads **"Helm Code"**                                            | All client/i18n labels and docs use "Helm Code"; the provider _key_ stays `'helmcode'` |
| 2 | Deleted/archived threads are **wiped** (session row removed, not flagged) | §5 lifecycle mapping; sweep wipe pass on `deleted_at`/`archived_at`                    |
| 3 | Helm Code **Config Explorer page** ships in Phase 2                       | Added to §7 Phase 2 scope                                                              |
| 4 | **MCP run/import enums advertise `"helmcode"` in Phase 1**                | All 14 `z.enum` sites gain `"helmcode"` now, even though spawning arrives in Phase 2   |

---

## 3. Data source model

`~/.helmcode/userdata/state.sqlite` (WAL mode; ~268 MB here). Read-only, via the
existing `compat-sqlite.js` wrapper (`node:sqlite` DatabaseSync) so no new
native dependency is introduced. Open with `{ readonly: true }` on every sweep;
never hold the handle.

Relevant tables (all projections of an event-sourced `orchestration_events`
log):

| Table                                  | Use for monitor                                                                                                                                                                                   |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `projection_projects`                  | workspace root, name, favicon, default model per project                                                                                                                                          |
| `projection_threads`                   | one row per session: `thread_id`, `project_id`, title, `latest_user_message_at`, `archived_at`, `deleted_at`, `pin`/`snooze` state                                                                |
| `projection_thread_sessions`           | runtime status per thread, provider name, `provider_session_id`, `active_turn_id`, `last_error`, `updated_at`                                                                                     |
| `projection_thread_messages`           | `message_id`, `thread_id`, `turn_id`, `role`, `text`, `is_streaming`, `created_at`, `attachments_json`                                                                                            |
| `projection_thread_activities`         | tone (`tool`/`info`/`error`), `kind` (`tool.started` / `tool.completed` / `tool.updated` / `task.started` / `context-window.updated` / …), `summary`, rich `payload_json` (raw tool input/output) |
| `projection_turns`                     | turn lifecycle, `state`, `checkpoint_turn_count`, `checkpoint_status`, `started_at`/`completed_at`                                                                                                |
| `orchestration_events`                 | globally-sequenced event log; the durable cursor for idempotent incremental ingestion                                                                                                             |
| `auth_sessions` / `auth_pairing_links` | credentials for a possible future WS RPC live path (phase 3) — **do not ingest**                                                                                                                  |

Overrides: honor `DASHBOARD_HELMCODE_HOME`, then Helm Code's own env override,
then `~/.helmcode`. The user-data dir is `<home>/userdata/` for release builds
and `<home>/dev/` for dev builds (see `server-runtime.json` / `environment-id`).

---

## 4. Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  helmcode (server on 127.0.0.1:<port>)                       │
│  state.sqlite  (WAL)  ← written by every helmcode thread     │
└──────────────────────────┬───────────────────────────────────┘
                           │ read-only opens (compat-sqlite)
┌──────────────────────────▼───────────────────────────────────┐
│  Claude Code Agent Monitor server                             │
│  lib/helmcode-home.js     → resolve db path + server runtime   │
│  lib/helmcode-ingest.js   → cursor over orchestration_events,  │
│                             reconcile projections into        │
│                             sessions/events/messages/turns     │
│  index.js                 → startHelmcodeSync(broadcast):      │
│                               fs.watch on state.sqlite/-wal    │
│                               (NOT -shm) + 4 s safety poll     │
└──────────────────────────┬───────────────────────────────────┘
                           │ provider="helmcode" rows
              DB (sessions, events, messages, agents)
                           │ WS broadcast + scoped REST
                client (dataScope, SessionDetail, Dashboard)
```

### Real-time strategy (Phase 1)

Mirror the proven Codex pattern in `server/index.js`
(`codexHomeChangeTriggersSweep`, index.js:660–678), **including its `-shm`
exclusion lesson**:

- `fs.watch` the user-data dir; trigger on `state.sqlite` and `state.sqlite-wal`
  only. Never on `-shm` — SQLite touches the wal-index on every WAL-mode reader
  open, including our own, which self-perpetuates a full-scan loop (issue #295).
- Keep a fingerprint-based 4 s safety-net poll (`setInterval`) so events still
  land when the watcher debounces or misses a rename.
- A sweep never enqueues another sweep (queue-guard `running`/`queued`), same as
  `startCodexSessionSync`.
- **Wipes broadcast a new `session_removed` WS message** (`{id, provider}`): the
  dashboard has no delete event today, so without it a wiped card lingers until
  a manual reload. `Dashboard.tsx`/`Sessions.tsx` drop the card on receipt
  (reuse their existing refetch throttle). New WS message type → documented in
  `client/README.md` (Event Types), `server/README.md`, and the wiki.

### Idempotency / cursor

`orchestration_events` rows are unique per
`(aggregate_kind, stream_id,
stream_version)`. Persist a small bookkeeping table
in the dashboard DB:
`helmcode_sync(thread_id, last_applied_sequence, updated_at)` (additive
migration). Each sweep reads events with `sequence > cursor` per thread and
applies them; the `projection_*` tables are then reconciled as authoritative
_current_ card state (cheap targeted reads, never a full-table scan). Failed
passes leave the cursor unmoved so the next sweep retries — same retry property
as the codex fingerprint path.

---

## 5. Data mapping

### Thread → Session

| CCAM field                  | Source                                                                                                                                                                               |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `id`                        | `projection_threads.thread_id`                                                                                                                                                       |
| `name`                      | thread `title` (which Helm Code regenerates), else `New session - <ts>`                                                                                                              |
| `provider`                  | `'helmcode'`                                                                                                                                                                         |
| `cwd`                       | `projection_projects.workspace_root` (by `project_id`)                                                                                                                               |
| `status`                    | map `projection_thread_sessions.status` (+ `active` when `active_turn_id` set, `error` when `last_error`)                                                                            |
| `model`                     | thread `model_selection_json`/`default_model_selection_json` (best-effort; may be absent)                                                                                            |
| `started_at` / `updated_at` | `created_at` / `updated_at`                                                                                                                                                          |
| `metadata`                  | JSON: helmcode-specific extras (`turn_count`, `pending_approval_count`, `interaction_mode`, `runtime_mode`, underlying `provider_name`, `provider_session_id`, pinned/snoozed flags) |

**Lifecycle (wipe):** when `projection_threads.deleted_at` or `archived_at` is
set, the sweep **deletes the CCAM session row** (and its messages/events cascade
per the dashboard's existing cleanup path) and removes the `helmcode_sync`
cursor row. Wiped threads do not reappear unless the thread is un-archived in
Helm Code and its rows are re-ingested as a new cursor baseline.

### Messages → `messages` rows

`projection_thread_messages` → CCAM `messages` (1:1, `message_id` keyed by
helmcode `message_id`), skipping `is_streaming` rows that never settle.

### Activities → `events` rows

Convention: provider-prefixed `event_type` values (`codex_*` precedent in
db.js:473), e.g. `helmcode_turn_start`, `helmcode_turn_complete`,
`helmcode_user_message`, `helmcode_tool_call`, `helmcode_task_complete`,
`helmcode_context_compacted`, `helmcode_error`. Map from
`projection_thread_activities.kind`/`tone`; the rich `payload_json` (raw
input/output for `tool.*`) feeds `data`/`summary`, mirroring
`codexToolInput`/`codexToolOutput` truncation in `routes/sessions.js`.

### Turns → turn bookkeeping

`projection_turns` → CCAM's existing turn/checkpoint fields (where present) for
duration and lifecycle analytics.

### Costs

**Not available in Phase 1.** `state.sqlite` has no usage/token/cost schema or
event types (verified). The dashboard must not fabricate costs; display Helm
Code sessions without token totals (Phase 2 may derive usage from Helm Code's
`usage-scan-cache.json` / underlying driver transcripts).

---

## 6. Change surface

### New server modules

| File                            | Contents                                                                                                                                                                                                                                                                 |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `server/lib/helmcode-home.js`   | `getHelmcodeHome()` (`DASHBOARD_HELMCODE_HOME` → `HELMCODE_HOME` → `~/.helmcode`), `getHelmcodeStateDbPath()`, `getHelmcodeServerRuntime()` (read `server-runtime.json`), `onHelmcodeHomeChanged(listener)`, `setHelmcodeHome()` (settings persistence)                  |
| `server/lib/helmcode-ingest.js` | `findHelmcodeThreads()`, `applyHelmcodeEvents()` (cursor), `syncHelmcodeSessions()` (projection reconcile), `ingestHelmcodeSnapshot()` (one-shot import), `reconcileHelmcodeLiveness()`; returns `{changed, created, session, agent, events}` shaped like `codex-ingest` |

### Modified server files

| File                                    | Change                                                                                                                                                                                                                                           |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `server/db.js`                          | additive `helmcode_sync` table + stmts; `provider='helmcode'` ingest stmt family (mirror `INSERT ... 'codex'` at db.js:1341); event-type error conventions (`%error%`/`%failed%` already generic)                                                |
| `server/lib/provider-filter.js`         | `VALID_PROVIDERS = ["claude","codex","helmcode"]`                                                                                                                                                                                                |
| `server/routes/sessions.js`             | provider-aware card summary CASE + `includesCodex`-type helpers for `helmcode`; session-detail branch (`routeProviderContent(session)` → helmcode renderer mirroring `codexMessageContent`); distinctProviders already dynamic (sessions.js:454) |
| `server/routes/settings.js`             | Helm Code home override read/write                                                                                                                                                                                                               |
| `server/index.js`                       | `startHelmcodeSync(broadcast)` (watch + 4 s poll + wipe-triggered rescan); home-change watcher re-arm; include `helmcode` in any exhaustive provider enumerations                                                                                |
| `server/websocket.js`                   | new `session_removed` broadcast type (`{id, provider}`) used by the helmcode sweep wipe path                                                                                                                                                     |
| `server/openapi.js` / `openapi-extra/*` | provider param enums/descriptions gain `"helmcode"`                                                                                                                                                                                              |
| `server/routes/hooks.js`                | **No change** — Helm Code has no hook surface; document this explicitly                                                                                                                                                                          |

### Client

| File                                                                                            | Change                                                                                                                                   |
| ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `client/src/lib/dataScope.ts`                                                                   | `ProviderScope = "claude" \| "codex" \| "helmcode" \| "both"` (backward-compatible; `activeProvidersParam` unchanged semantics)          |
| `client/src/lib/types.ts`                                                                       | Session `provider` union + metadata extension                                                                                            |
| `client/src/pages/Sessions.tsx`, `Dashboard.tsx`, `Workflows.tsx`, `SessionDetail.tsx`          | provider selector option + Helm Code content/activity renderer; **`session_removed` handler** drops wiped cards (reuse refetch throttle) |
| `client/src/components/SessionCard.tsx`, `AgentCard.tsx`, `StatusBadge.tsx`, `SplashScreen.tsx` | provider label/badge/icon for `helmcode`                                                                                                 |
| `client/src/i18n/locales/en/{common,settings,splash,sessions?}.json`                            | labels ("Helm Code"), help text; all other locales untouched in Phase 1 (English-only until translations are requested)                  |
| `client/src/lib/api.ts`                                                                         | no change if providers param stays generic                                                                                               |

### MCP

| File                                                                                                                                        | Change                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `mcp/src/tools/domains/{session,event,agent,observability,settings,pricing}-tools.ts`, `run-tools.ts` (`ProviderSchema`), `import-tools.ts` | `z.enum(["claude","codex","helmcode"])` (14 spell sites) |
| `mcp/src/transports/repl.ts`                                                                                                                | provider autocomplete/identity                           |

### Tests

| Area                                       | Plan                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `server/__tests__/helmcode-home.test.js`   | path resolution chain incl. env overrides                                                                                                                                                                                                                                                                                            |
| `server/__tests__/helmcode-ingest.test.js` | build a fixture `state.sqlite` by applying the helmcode migrations + seed events (mirror `codex-ingest.test.js` and `codex-transcript.test.js`); assert cursor idempotency, retry-on-failure, event mapping, **wipe reconciliation** (`deleted_at`/`archived_at` removes the session row + cursor), `-shm`-ignored trigger semantics |
| `server/__tests__/sessions routes`         | provider-filter + detail renderer for `helmcode`                                                                                                                                                                                                                                                                                     |
| `client`                                   | snapshot + Sessions provider filter test (mirror `Workflows.codex.test.tsx`) + `session_removed` handler test                                                                                                                                                                                                                        |
| `mcp`                                      | `npm run mcp:typecheck`                                                                                                                                                                                                                                                                                                              |

### Docs (per `.claude/skills/update-project-docs` map)

README.md (+ VN/CN/KO mirrors), ARCHITECTURE.md, `index.html` landing,
`server/README.md`, `client/README.md` (Event Types incl. new `session_removed`
WS message), `docs/API.md`, `docs/DATABASE.md`, `docs/PLUGINS.md` (new
`helmcode_*` event types), `docs/MCP.md`, `docs/README.md` (index row),
`openapi.yaml`, `.env.example`, wiki `index.html` + `wiki/i18n-content.js`
(zh/vi) + `wiki/sw.js` cache bump. New env var: `DASHBOARD_HELMCODE_HOME`.

---

## 7. Phasing

| Phase                           | Contents                                                                                                                                                                               | Rough effort                                                           |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| **1 — MVP (read-only monitor)** | `helmcode-home` + `helmcode-ingest` (poll + watcher), DB migration, provider filter, session routes/renderer, MCP provider enums, UI selector + labels, tests, full doc set            | 1 focused PR (mirror of the original codex port), `minor` version bump |
| **2 — Operational parity**      | launch-from-dashboard spawner (`helmcode` CLI), `/api/import` rescan + history, Remote Sources home, Config Explorer page, cost attribution from `usage-scan-cache.json` (best-effort) | 2–4 PRs                                                                |
| **3 — Live path**               | WebSocket RPC client for Helm Code's event stream (pairing/auth ceremony via `auth_pairing_links`); genuine real-time instead of 4 s poll                                              | separate PR; needs helmcode API stability check                        |

---

## 8. Risks & mitigations

1. **`-shm` trigger loop** — the exact bug fixed at index.js:660. Mitigation:
   never trigger on `state.sqlite-shm`; include the exclusion in a regression
   test.
2. **Poll CPU tax on a 268 MB DB** — Mitigation: read-only _targeted_ queries
   keyed by cursor/`thread_id`; never a full-table scan per sweep; fingerprint
   gate before touching the DB; `npm run test:server` perf guard if one exists.
3. **WAL read concurrency / `SQLITE_BUSY`** — Mitigation: short-lived read-only
   connections per pass, `busy_timeout`, retry-without-cursor-advance on
   failure.
4. **Schema drift in helmcode state.sqlite** — Mitigation: defensive column
   checks; treat every helmcode read as optional (fail to "no change", never
   crash the sweep); pin behavior to observed tables, document migration risk.
5. **Duplicate coverage** (a thread driven by a claude/codex driver is ALSO on
   the disk as a transcript) — Acceptable: user runs opencode/grok; when overlap
   does occur both views remain valid. Documented, not deduped, in Phase 1.
6. **Experiments / tiny WAL churn while idle** — Mitigation: same debounce
   design as the codex sweep (coalesce, skip no-op passes).

---

## 9. Decisions log

All open questions raised with the reviewer are resolved; see the
[Approved decisions](#approved-decisions-2026-08-28) table in §2.

- **Provider key:** `"helmcode"`, displayed as **Helm Code** everywhere.
- **Wipe semantics:** deleted/archived threads are removed (rows + cursor),
  never flagged.
- **Config Explorer:** scheduled in Phase 2 (already listed).
- **MCP enums:** all 14 sites advertise `"helmcode"` in Phase 1.

Subsequent changes to this spec must be appended here with date and rationale
rather than silently rewritten.
