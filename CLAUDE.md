# Claude Code Working Guide

## Project mission
- Maintain reliable local-first dashboard for Claude Code session monitoring.
- Preserve real-time behavior (hooks -> API -> SQLite -> WebSocket -> UI).
- Keep MCP integration production-ready for local use (`mcp/`).

## Repo map
- `server/`: Express API, hook ingestion, SQLite access, websocket broadcast (includes optional git upstream checks and `routes/updates.js`, plus `lib/workflow-ingest.js` which ingests on-disk Workflow-tool run journals — fleets emit no hooks).
- `client/`: React + Vite UI.
- `scripts/`: hook installer/handler, import, seed, cleanup utilities. (Update detection lives server-side in `server/lib/update-check.js`; dashboard never restarts itself — users run printed command, surfaced in UI and by `cam update-check`.)
- `mcp/`: local MCP server exposing dashboard ops as tools.

## Non-negotiable engineering rules
- Preserve existing behavior unless explicitly asked to change it.
- Prefer minimal, reversible diffs.
- Never silently weaken safety controls around destructive actions.
- Keep docs updated when behavior, commands, file locations, or workflows change — apply `update-project-docs` skill automatically at end of every change-set altering behavior, config, interfaces, events, schema, CLI commands, or features (don't wait to be asked).
- Apply `push-to-forked-pr` skill whenever updating PR whose head branch lives on fork — `origin` here is upstream, plain `git push origin` updates wrong branch, leaves PR untouched.
- Apply `version-release` skill for every release bump: patch for backward-compatible fixes/small improvements, minor for larger backward-compatible capabilities, major for breaking/fundamental changes; sync root, desktop, OpenAPI, snapshots, generated plugin metadata, create or reuse matching `v<version>` GitHub milestone, assign release PR plus linked closing issues to it.
- Every applicable source file created/updated (`.js/.ts/.tsx/.cjs/.mjs/.py/.sh/.css`) must start with copyright/authorship header — file overview + exact line `@author Michael Buluma <1452922+buluma@users.noreply.github.com>`. Formats and audit script: `.claude/skills/file-headers/` (verify with `bash .claude/skills/file-headers/scripts/check-headers.sh`). Binds every coding agent (Claude Code, Codex, others).

## Commands you should know
- Setup: `npm run setup`
- Dev: `npm run dev`
- Prod build/start: `npm run build` then `npm start`
- Full local gate (headers + format + client typecheck + server typecheck + server + client tests): `npm run verify`
- Server tests: `npm run test:server`
- Client tests: `npm run test:client`
- MCP install/build/start: `npm run mcp:install`, `npm run mcp:build`, `npm run mcp:start`
- MCP typecheck: `npm run mcp:typecheck`
- Token repair: `npm run repair-tokens` — one-time re-derivation of token totals inflated before usage reconciled per `message.id` (dashboard also runs this auto once per database; `DASHBOARD_TOKEN_REPAIR=0` opts out)
- CLI (after setup): `cam <command>` — terminal access to full dashboard surface (`bin/cam.js`; `cam help` lists commands)

## Testing and verification policy
- `npm run verify` runs whole local gate in one command (header audit, format check, client typecheck, server typecheck, server tests, client tests) — fastest way to confirm change-set before opening PR. Includes `tsc -b` since Vitest transpiles without typechecking — test file can pass locally, still break production build.
- Server typecheck (`npm run typecheck:server`, `tsc -p server/tsconfig.json`): gradual JS type-checking via `// @ts-check` file pragmas, not project-wide `checkJs`. Only files with the pragma get checked (currently `server/routes/hooks.js` and `server/routes/sessions.js`); a file a require pulls in in the program for inference but stays undiagnosed unless it also carries the pragma. Add the pragma to a file only alongside enough JSDoc to make it pass — don't add it speculatively.
- Backend changes: run `npm run test:server` before finishing.
- Frontend changes: run `npm run test:client` when relevant. Includes per-screen render snapshots (`client/src/pages/__tests__/screens.snapshot.test.tsx`). If UI change intentional, review snapshot diff, regenerate baselines with `cd client && npx vitest run -u`; never blindly update snapshots to make tests pass.
- MCP changes: run `npm run mcp:typecheck` and `npm run mcp:build`.
- Can't run verification step → state exactly what wasn't run, why.

## Change guidelines by area
- API routes: preserve response shapes unless change requested and documented.
- Database: avoid schema changes without migration-safe logic.
- Hooks: keep fail-safe, non-blocking behavior.
- WebSocket: keep message types stable, backward-compatible.
- Documentation: include exact commands and paths; keep markdown examples runnable.

## Agent behavior
- Explore first, implement after.
- Larger tasks: propose/check short plan before broad edits.
- Use file-specific rules in `.claude/rules/` when working scoped areas.
- Use project skills from `.claude/skills/` for repeatable workflows.
- Use `.claude/agents/` subagents for focused review or investigation passes.