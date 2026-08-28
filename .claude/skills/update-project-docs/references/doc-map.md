# Documentation Map

Authoritative inventory of this repository's documentation surface: every doc that must be kept in sync, what each contains, and the stable anchors to grep for when placing an edit. Section line numbers drift — grep the anchor strings, don't trust line numbers.

## Tier 1 — primary, always consider

### `README.md` (English, canonical)
The source of truth most other docs mirror. Key sections:
- **Feature table** — rows like `**Kanban Board**`, `**Transcript Cache**`, `**Pre-Existing Session Detection**`, `**Continuous Project Sync**`. Grep a neighboring row label.
- **Data-flow numbered list** — bullets describing hook ingestion, the watchdog, periodic sweep, continuous sync. Grep `Error detection watchdog` / `periodic server sweep`.
- **Agent State Machine** + **Session State Machine** — two `mermaid stateDiagram-v2` blocks. Grep `stateDiagram-v2`.
- **Hook Events table** — `| Hook Type | Trigger | Dashboard Action |`. Lists `SessionStart`…`SessionEnd`, plus synthetic `Compaction`, `APIError`, `TurnDuration`, `ToolError`, `Interrupted`. Grep `## Hook Events`.
- **Configuration / Environment Variables table** — `| Environment Variable | Default | Description |`. Grep `DASHBOARD_PORT` or `DASHBOARD_HOST`.

### `ARCHITECTURE.md`
- **Module responsibility table** — one row per source file (`scripts/import-history.js`, `lib/transcript-cache.js`, `routes/hooks.js`, `server/index.js`, …). Update the row whose file you changed. Grep the file path.
- **Data-flow + sequence diagrams**, **state machines**, **Continuous background sync** prose block (grep `Continuous background sync`).
- **Event types line** — grep `| Event types |`.
- **ERD / schema** mermaid + `event_type "PreToolUse|PostToolUse|Stop|etc"`.

### `index.html` (root landing / marketing)
Feature cards (`<div class="feature-card">`) with concise marketing copy. Light touch only — one sentence in the most relevant existing card. Grep an existing feature headline (e.g. `History import`, `Kanban`).

### `wiki/index.html` + `wiki/script.js` + `wiki/sw.js`
Detailed wiki, English only. Add prose/tables/diagrams directly in `wiki/index.html` (Hook table `<th>Hook Type</th>`, Environment Variables `<th>Variable</th>`, mermaid `stateDiagram-v2` blocks). **Bump the cache** whenever `index.html` or `script.js` changes: increment `CACHE_NAME` in `wiki/sw.js` (e.g. `wiki-v107` → `wiki-v108`) and, if `script.js` changed, its `?v=N` query string in `index.html`. Without this, returning visitors get stale cached content.

## Tier 2 — area-specific

### `server/README.md`
Backend reference: routes table, **Error Detection Watchdog** / **User-Interrupt (Esc) Recovery** / **Continuous Project Sync** sections, Agent/Session lifecycle mermaid diagrams, Environment Variables bash block under `## Deployment`. Update for any backend behavior, route, state, env var, or background service.

### `client/README.md`
Frontend reference: component list, **Event Types** table (WebSocket broadcast message types like `session_created`, `agent_updated`), session/agent status TypeScript unions. Update for new WS message types or client-facing behavior. NOT needed for server-only changes the UI already renders generically.

### `docs/HOOKS.md`
Per-hook deep reference (`### 1. SessionStart` … `### 8. SessionEnd`), the `awaiting_input_since` overlay rules, the "User interrupts (Esc) — no hook fires" section, transcript-derived sync. Update for any hook semantics or state behavior.

### `docs/DATABASE.md`
Schema reference: `sessions` / `agents` / `events` tables, column docs, status CHECK constraints, lifecycle mermaid diagrams. Update for schema or state-machine changes.

### `docs/API.md`
REST API reference (endpoints, params, example responses). Update for route/response changes. Pair with `server/openapi*.js` (code, not docs).

### `docs/PLUGINS.md`
Plugin/marketplace docs incl. an **Event Types** enumeration line — keep it in sync with the canonical event-type list.

### `mcp/README.md` (canonical)
MCP server + tool reference. Update for new/changed MCP tools. `docs/MCP.md`
is a one-line stub pointing here — do not duplicate content into it.

### `docs/I18N.md`
i18n architecture: `supportedLngs` (English only), the active namespaces. Update when adding a namespace. Client UI strings live in `client/src/i18n/locales/en/*.json` (code).

## Tier 3 — situational

- `.env.example` — every env var belongs here with a sane default + comment.
- `INSTALL.md`, `DEPLOYMENT.md` (canonical) — install/run/deploy commands. `SETUP.md` and `docs/DEPLOYMENT.md` are one-line stubs pointing at these — do not duplicate content into them.
- `CLAUDE.md`, `AGENTS.md` — agent working guides; update when commands, file locations, or workflows change.
- `docs/README.md` — docs index; add a link when a new `docs/*.md` is created.
- `desktop/README.md`, `vscode-extension/README.md`, `statusline/README.md` — surface-specific; update only when that surface changes.

## Consistency invariants

- The **event-type set** must match across: `README` hook table, `ARCHITECTURE` Event types line, `docs/PLUGINS.md`, `wiki`. When adding one, grep the existing set (e.g. `TurnDuration`) across all and add everywhere it appears.
- **Env-var set** must match across: `README` table, `server/README.md`, `wiki`, `.env.example`, and any inline `ARCHITECTURE` mention.
- **State-machine diagrams** are duplicated across `README`, `server/README.md`, `docs/DATABASE.md`, `wiki`. A transition change touches all of them.
- Run `scripts/doc-coverage.sh <term>` to confirm a new identifier/var/event reached every doc that should mention it.
