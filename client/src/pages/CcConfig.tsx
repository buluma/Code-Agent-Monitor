/**
 * @file CcConfig.tsx
 * @description Agent configuration explorer. Switches between the complete
 * Claude Code configuration workspace and a backup-backed editable Codex explorer.
 * The Claude workspace surfaces every plugin,
 * skill, subagent, slash command, MCP server, hook, settings file, memory
 * file, marketplace, keybinding, and statusline script Claude Code knows
 * about. Read access for all surfaces; create / edit / delete for the
 * low-risk text-file surfaces (skills, agents, commands, output styles,
 * CLAUDE.md memory, and per-project file-based memory files). Plugins, MCP,
 * hooks-in-settings, and settings.json files stay read-only - those have
 * concurrent-write races with the live CLI.
 * @author Michael Buluma <1452922+buluma@users.noreply.github.com>
 */
/* =============================================================================
 * MODULE_GUIDE — extended in-file reference (comments only; safe to read, never executed)
 * =============================================================================
 * **Path:** `/Users/buluma/Documents/GitHub/Claude-Code-Agent-Monitor/client/src/pages/CcConfig.tsx`
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
 * - `../lib/eventBus`
 * - `../lib/api`
 * - `./ccConfig/types` — shared editor/modal state + tab/page-data model
 * - `./ccConfig/Widgets`, `./ccConfig/Header`, `./ccConfig/Tabs`,
 *   `./ccConfig/TabPanel` and its per-tab panels (OverviewPanel,
 *   MdItemList, PluginsPanel, McpPanel, HooksPanel, SettingsPanel,
 *   MemoryPanel, MarketplacesPanel, KeybindingsPanel) — presentational
 *   subcomponents, extracted (SHA-167)
 *
 * ## Public surface
 * - `CcConfig` — exported API; see TSDoc on the symbol for behavior.
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
 * **CcConfig**
 *   Part of this module's public contract. Downstream imports should treat
 *   the signature and return type as stable unless release notes say otherwise.
 *   When behavior changes, update the `@file` overview and relevant tests.
 *
 * ----------------------------------------------------------------------------- */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router";
import { eventBus } from "../lib/eventBus";
import { AlertCircle, Plus, Search, X } from "lucide-react";
import { api } from "../lib/api";
import { CodexConfigExplorer } from "../components/CodexConfigExplorer";
import { HelmcodeConfigExplorer } from "../components/HelmcodeConfigExplorer";
import { T3ConfigExplorer } from "../components/T3ConfigExplorer";
import type { EditorState, ConfirmDeleteState, Toast, PageState, TabKey } from "./ccConfig/types";
import {
  FileViewer,
  EditorModal,
  ConfirmDeleteModal,
  ToastNotice,
  BackupsModal,
} from "./ccConfig/Widgets";
import { Header } from "./ccConfig/Header";
import { Tabs } from "./ccConfig/Tabs";
import { TabPanel } from "./ccConfig/TabPanel";
import type {
  CcArtifactType,
  CcFileResponse,
  CcMemoryItem,
  CcMutationResult,
  CcScope,
} from "../lib/api";

function isMutable(
  tab: TabKey
): tab is "skills" | "agents" | "commands" | "outputStyles" | "memory" {
  return (
    tab === "skills" ||
    tab === "agents" ||
    tab === "commands" ||
    tab === "outputStyles" ||
    tab === "memory"
  );
}

function tabToArtifactType(
  tab: "skills" | "agents" | "commands" | "outputStyles" | "memory"
): CcArtifactType {
  return tab === "outputStyles" ? "output-styles" : tab;
}

const EMPTY_STATE: PageState = {
  overview: null,
  skills: null,
  agents: null,
  commands: null,
  outputStyles: null,
  plugins: null,
  marketplaces: null,
  mcp: null,
  hooks: null,
  keybindings: null,
  settings: null,
  memory: null,
  statusline: null,
  hookScripts: null,
};

export function CcConfig() {
  const { t } = useTranslation("ccConfig");
  const [provider, setProvider] = useState<"claude" | "codex" | "helmcode" | "t3">("claude");
  const [tab, setTab] = useState<TabKey>("overview");
  const [scope, setScope] = useState<CcScope>("all");
  const [data, setData] = useState<PageState>(EMPTY_STATE);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [search, setSearch] = useState("");
  const [viewer, setViewer] = useState<{
    path: string;
    data: CcFileResponse | null;
    error: string | null;
  } | null>(null);
  const [editor, setEditor] = useState<EditorState>(null);
  const [confirmDelete, setConfirmDelete] = useState<ConfirmDeleteState>(null);
  const [toast, setToast] = useState<Toast>(null);
  const [backupsOpen, setBackupsOpen] = useState(false);

  // Auto-dismiss toasts after 5s
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(id);
  }, [toast]);

  // Honor a ?provider=claude|codex|helmcode|t3 deep link so Settings and the
  // "Open Config Explorer" link land directly on the right tab.
  const [searchParams] = useSearchParams();
  useEffect(() => {
    const requested = searchParams.get("provider");
    if (
      requested === "helmcode" ||
      requested === "codex" ||
      requested === "claude" ||
      requested === "t3"
    ) {
      setProvider(requested);
    }
  }, [searchParams]);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [
        overview,
        skills,
        agents,
        commands,
        outputStyles,
        plugins,
        marketplaces,
        mcp,
        hooks,
        keybindings,
        settings,
        memory,
        statusline,
        hookScripts,
      ] = await Promise.all([
        api.ccConfig.overview(),
        api.ccConfig.skills(scope),
        api.ccConfig.agents(scope),
        api.ccConfig.commands(scope),
        api.ccConfig.outputStyles(scope),
        api.ccConfig.plugins(),
        api.ccConfig.marketplaces(),
        api.ccConfig.mcp(),
        api.ccConfig.hooks(),
        api.ccConfig.keybindings(),
        api.ccConfig.settings(),
        api.ccConfig.memory(),
        api.ccConfig.statusline(),
        api.ccConfig.hookScripts(),
      ]);
      setData({
        overview,
        skills: skills.items,
        agents: agents.items,
        commands: commands.items,
        outputStyles: outputStyles.items,
        plugins,
        marketplaces,
        mcp,
        hooks: hooks.items,
        keybindings,
        settings: settings.items,
        memory: memory.items,
        statusline,
        hookScripts,
      });
      setLastUpdated(new Date());
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "unknown error";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [scope]);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  // Live updates - refetch whenever the server broadcasts that a config
  // surface has changed (either via dashboard mutations or external file
  // edits picked up by the cc-watcher). Debounced because a single user
  // action can write multiple files (e.g. a skill backup + the skill itself
  // + the file-history snapshot all land within tens of ms).
  const refetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return eventBus.subscribe((msg) => {
      if (msg.type !== "cc_config_changed") return;
      if (refetchTimerRef.current) clearTimeout(refetchTimerRef.current);
      refetchTimerRef.current = setTimeout(() => {
        refetchTimerRef.current = null;
        void fetchAll();
      }, 250);
    });
  }, [fetchAll]);
  useEffect(() => {
    return () => {
      if (refetchTimerRef.current) clearTimeout(refetchTimerRef.current);
    };
  }, []);

  const wsConnected = useSyncExternalStore(eventBus.onConnection, () => eventBus.connected);

  const openViewer = useCallback(async (path: string) => {
    setViewer({ path, data: null, error: null });
    try {
      const file = await api.ccConfig.file(path);
      setViewer({ path, data: file, error: null });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "unknown error";
      setViewer({ path, data: null, error: msg });
    }
  }, []);

  const openCreate = useCallback(
    (type: CcArtifactType, overrideScope?: "user" | "project") => {
      const tplKey = `edit.templates.${type}`;
      const template = t(tplKey);
      const defaultScope: "user" | "project" =
        overrideScope ?? (scope === "project" ? "project" : "user");
      setEditor({ mode: "create", type, defaultScope, template });
    },
    [scope, t]
  );

  const openEdit = useCallback(
    (type: CcArtifactType, item: { scope: "user" | "project"; name: string; filePath: string }) => {
      setEditor({
        mode: "edit",
        type,
        scope: item.scope,
        name: item.name,
        filePath: item.filePath,
      });
    },
    []
  );

  const openDelete = useCallback(
    (
      type: CcArtifactType,
      scopeArg: "user" | "project",
      name: string | undefined,
      path: string
    ) => {
      setConfirmDelete({ type, scope: scopeArg, name, path });
    },
    []
  );

  // ── Auto-memory (per-project file-based memory) create / edit / delete ──
  const openCreateAuto = useCallback(
    (project: string) => {
      setEditor({
        mode: "create",
        type: "auto-memory",
        defaultScope: "user", // unused for auto-memory; scope is fixed
        template: t("edit.templates.auto-memory"),
        project,
      });
    },
    [t]
  );

  const openEditAuto = useCallback((item: CcMemoryItem) => {
    if (!item.project || !item.name) return;
    setEditor({
      mode: "edit",
      type: "auto-memory",
      scope: "auto-memory",
      name: item.name,
      filePath: item.file,
      project: item.project,
    });
  }, []);

  const openDeleteAuto = useCallback((item: CcMemoryItem) => {
    if (!item.project || !item.name) return;
    setConfirmDelete({
      type: "auto-memory",
      scope: "auto-memory",
      name: item.name,
      path: item.file,
      project: item.project,
    });
  }, []);

  const handleSave = useCallback(
    async (args: {
      type: CcArtifactType;
      targetScope: "user" | "project" | "auto-memory";
      name: string | undefined;
      content: string;
      project?: string;
    }) => {
      const result: CcMutationResult = await api.ccConfig.write({
        scope: args.targetScope,
        type: args.type,
        name: args.name,
        content: args.content,
        project: args.project,
      });
      setEditor(null);
      setToast({
        kind: "success",
        message: result.created
          ? t("edit.saveSuccessNew")
          : t("edit.saveSuccess", { path: result.backupPath || "-" }),
      });
      void fetchAll();
    },
    [fetchAll, t]
  );

  const handleDelete = useCallback(async () => {
    if (!confirmDelete) return;
    try {
      const result = await api.ccConfig.delete({
        scope: confirmDelete.scope,
        type: confirmDelete.type,
        name: confirmDelete.name,
        project: confirmDelete.project,
      });
      setConfirmDelete(null);
      setToast({
        kind: "success",
        message: t("edit.deleteSuccess", { path: result.backupPath || "-" }),
      });
      void fetchAll();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "unknown error";
      setConfirmDelete(null);
      setToast({ kind: "error", message: t("edit.deleteError", { message: msg }) });
    }
  }, [confirmDelete, fetchAll, t]);

  return (
    <div className="space-y-5">
      <Header
        provider={provider}
        onProviderChange={setProvider}
        loading={loading}
        lastUpdated={lastUpdated}
        scope={scope}
        onScopeChange={setScope}
        onRefresh={fetchAll}
        onOpenBackups={() => setBackupsOpen(true)}
        wsConnected={wsConnected}
      />

      {provider === "codex" ? (
        <CodexConfigExplorer />
      ) : provider === "helmcode" ? (
        <HelmcodeConfigExplorer />
      ) : provider === "t3" ? (
        <T3ConfigExplorer />
      ) : (
        <>
          {error && (
            <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>{t("loadError", { message: error })}</span>
            </div>
          )}

          <Tabs current={tab} onSelect={setTab} counts={data.overview?.counts} />

          <div className="rounded-xl border border-border bg-surface-1">
            {tab !== "overview" && (
              <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
                <Search className="w-4 h-4 text-gray-500" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t("common.search")}
                  className="h-7 bg-transparent text-sm text-gray-100 placeholder:text-gray-500 focus:outline-none flex-1"
                />
                {search && (
                  <button
                    type="button"
                    onClick={() => setSearch("")}
                    title={t("common.clearSearch")}
                    aria-label={t("common.clearSearch")}
                    className="h-7 w-7 flex-shrink-0 inline-flex items-center justify-center rounded-md text-gray-500 hover:text-gray-200 hover:bg-surface-3 focus:outline-none focus:ring-1 focus:ring-accent/40"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
                {isMutable(tab) && tab !== "memory" && (
                  <button
                    onClick={() => openCreate(tabToArtifactType(tab))}
                    className="h-7 text-[11px] font-medium px-2.5 rounded-md border border-accent/30 bg-accent/10 hover:bg-accent/20 text-accent inline-flex items-center gap-1.5"
                  >
                    <Plus className="w-3 h-3" />
                    {t("edit.newButton")}
                  </button>
                )}
              </div>
            )}
            <div className="p-4">
              <TabPanel
                tab={tab}
                data={data}
                search={search}
                onTabChange={setTab}
                onOpenFile={openViewer}
                onEdit={openEdit}
                onDelete={openDelete}
                onCreateMemory={(s) => openCreate("memory", s)}
                onEditAuto={openEditAuto}
                onDeleteAuto={openDeleteAuto}
                onCreateAuto={openCreateAuto}
                onKeybindingsSaved={fetchAll}
                onToast={setToast}
              />
            </div>
          </div>

          {viewer && <FileViewer state={viewer} onClose={() => setViewer(null)} />}
          {editor && (
            <EditorModal state={editor} onClose={() => setEditor(null)} onSave={handleSave} />
          )}
          {confirmDelete && (
            <ConfirmDeleteModal
              state={confirmDelete}
              onCancel={() => setConfirmDelete(null)}
              onConfirm={handleDelete}
            />
          )}
          {toast && <ToastNotice toast={toast} onDismiss={() => setToast(null)} />}
          {backupsOpen && <BackupsModal onClose={() => setBackupsOpen(false)} />}
        </>
      )}
    </div>
  );
}
