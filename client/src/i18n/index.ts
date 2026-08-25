/**
 * @file index.ts
 * @description i18next bootstrap for the dashboard client. Registers bundled JSON
 * locale files for English (`en`) only.
 *
 * ## Namespaces
 * Translations are split by feature area (`dashboard`, `sessions`, `settings`,
 * etc.) so pages import only the keys they need via `useTranslation("ns")`.
 * `common` is the default namespace for shared labels and buttons.
 *
 * @author Son Nguyen <hoangson091104@gmail.com>
 */
/* =============================================================================
 * MODULE_GUIDE — extended in-file reference (comments only; safe to read, never executed)
 * =============================================================================
 * **Path:** `/Users/davidnguyen/WebstormProjects/Claude-Code-Agent-Monitor/client/src/i18n/index.ts`
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
 * ## Internal dependencies
 * - `./locales/en/common.json`
 * - `./locales/en/nav.json`
 * - `./locales/en/dashboard.json`
 * - `./locales/en/sessions.json`
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

import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

import common_en from "./locales/en/common.json";
import nav_en from "./locales/en/nav.json";
import dashboard_en from "./locales/en/dashboard.json";
import sessions_en from "./locales/en/sessions.json";
import activity_en from "./locales/en/activity.json";
import analytics_en from "./locales/en/analytics.json";
import workflows_en from "./locales/en/workflows.json";
import settings_en from "./locales/en/settings.json";
import kanban_en from "./locales/en/kanban.json";
import errors_en from "./locales/en/errors.json";
import updates_en from "./locales/en/updates.json";
import ccConfig_en from "./locales/en/ccConfig.json";
import run_en from "./locales/en/run.json";
import alerts_en from "./locales/en/alerts.json";
import splash_en from "./locales/en/splash.json";

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: {
        common: common_en,
        nav: nav_en,
        dashboard: dashboard_en,
        sessions: sessions_en,
        activity: activity_en,
        analytics: analytics_en,
        workflows: workflows_en,
        settings: settings_en,
        kanban: kanban_en,
        errors: errors_en,
        updates: updates_en,
        ccConfig: ccConfig_en,
        run: run_en,
        alerts: alerts_en,
        splash: splash_en,
      },
    },
    supportedLngs: ["en"],
    nonExplicitSupportedLngs: false,
    fallbackLng: "en",
    ns: [
      "common",
      "nav",
      "dashboard",
      "sessions",
      "activity",
      "analytics",
      "workflows",
      "settings",
      "kanban",
      "errors",
      "updates",
      "ccConfig",
      "run",
      "alerts",
      "splash",
    ],
    defaultNS: "common",
    interpolation: { escapeValue: false },
    detection: {
      order: ["localStorage", "navigator"],
      caches: ["localStorage"],
      lookupLocalStorage: "i18nextLng",
    },
  });

/** Configured i18next instance — import side effects run {@link init}. */
export default i18n;
