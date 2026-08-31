/**
 * @file Page header: title, live/offline badge, provider toggle, and the
 * Active Runs switcher (dashboard-runs modal with status/mode filters and
 * search). Also the full-page provider chooser shown before a provider is
 * picked. Extracted out of Run.tsx — see SHA-167 — no behavior change.
 * @author Michael Buluma <1452922+buluma@users.noreply.github.com>
 */

import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import {
  Play,
  RefreshCw,
  ListOrdered,
  Search,
  X,
  Info,
  ExternalLink,
  RotateCcw,
  Eye,
} from "lucide-react";
import type {
  DashboardRunHistoryItem,
  RunListResponse,
  RunMode,
  RunProvider,
  RunStatus,
} from "../../lib/api";
import { StatusPill, ModeBadge } from "./TranscriptView";

// ── Header ────────────────────────────────────────────────────────────

export function Header({
  provider,
  providerLocked,
  onProviderChange,
  activeRuns,
  currentHandleId,
  onAttach,
  wsConnected,
  runHistory,
  onResumeFromHistory,
  onViewFromHistory,
  onRefresh,
}: {
  provider: RunProvider;
  providerLocked: boolean;
  onProviderChange: (provider: RunProvider) => void;
  activeRuns: RunListResponse | null;
  currentHandleId: string | null;
  onAttach: (id: string) => void;
  wsConnected: boolean;
  runHistory: DashboardRunHistoryItem[];
  onResumeFromHistory: (item: DashboardRunHistoryItem) => void;
  onViewFromHistory: (item: DashboardRunHistoryItem) => void;
  onRefresh: () => void;
}) {
  const { t } = useTranslation("run");
  const { t: tCommon } = useTranslation("common");
  return (
    <header className="flex items-start gap-3">
      <div className="w-9 h-9 rounded-xl bg-accent/15 flex items-center justify-center flex-shrink-0">
        <Play className="w-4.5 h-4.5 text-accent" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-semibold text-gray-100">{t("title")}</h1>
          {wsConnected ? (
            <span className="flex items-center gap-1.5 text-[11px] text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse-dot" />
              {tCommon("live")}
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-[11px] text-gray-400 bg-gray-500/10 border border-gray-500/20 px-2 py-0.5 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-gray-400" />
              {tCommon("offline")}
            </span>
          )}
          <RunProviderToggle
            value={provider}
            disabled={providerLocked}
            onChange={onProviderChange}
          />
        </div>
        <p className="text-xs text-gray-500 max-w-3xl">{t(`provider.${provider}.subtitle`)}</p>
      </div>
      <ActiveRunsSwitcher
        activeRuns={activeRuns}
        currentHandleId={currentHandleId}
        onAttach={onAttach}
        runHistory={runHistory}
        onResumeFromHistory={onResumeFromHistory}
        onViewFromHistory={onViewFromHistory}
        onRefresh={onRefresh}
      />
    </header>
  );
}

function RunProviderToggle({
  value,
  disabled,
  onChange,
}: {
  value: RunProvider;
  disabled: boolean;
  onChange: (provider: RunProvider) => void;
}) {
  const { t } = useTranslation("run");
  return (
    <div
      className="inline-flex rounded-full border border-border bg-surface-2 p-0.5"
      aria-label={t("provider.aria", "Run provider")}
    >
      {(["claude", "codex"] as const).map((option) => (
        <button
          key={option}
          disabled={disabled}
          onClick={() => onChange(option)}
          className={`rounded-full px-2 py-px text-[10px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-55 ${value === option ? "bg-accent/20 text-accent" : "text-gray-400 hover:text-gray-200"}`}
        >
          {t(`provider.${option}.label`)}
          {option === "codex" && (
            <span className="ml-1 text-[9px] text-amber-400">{t("provider.beta", "BETA")}</span>
          )}
        </button>
      ))}
    </div>
  );
}

export function ProviderChooser({
  onChoose,
  onCancel,
}: {
  onChoose: (provider: RunProvider) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation("run");
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="run-provider-title"
    >
      <div className="w-full max-w-2xl rounded-2xl border border-border bg-surface-1 p-6 shadow-2xl shadow-black/60">
        <p className="text-center text-[11px] font-semibold uppercase tracking-[0.2em] text-accent">
          {t("provider.kicker", "Run Agent")}
        </p>
        <h2
          id="run-provider-title"
          className="mt-2 text-center text-xl font-semibold text-gray-100"
        >
          {t("provider.chooseTitle", "Which agent would you like to run?")}
        </h2>
        <p className="mx-auto mt-2 max-w-lg text-center text-sm leading-relaxed text-gray-500">
          {t(
            "provider.chooseDescription",
            "Choose an interactive local agent. You can switch before starting a new run."
          )}
        </p>
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          {(["claude", "codex"] as const).map((option) => (
            <button
              key={option}
              onClick={() => onChoose(option)}
              className="group rounded-xl border border-border bg-surface-2 p-5 text-left transition-colors hover:border-accent/50 hover:bg-accent/5 focus:outline-none focus:ring-2 focus:ring-accent/40"
            >
              <div className="flex items-center gap-2">
                <span className="text-base font-semibold text-gray-100">
                  {t(`provider.${option}.label`)}
                </span>
                {option === "codex" && (
                  <span className="rounded-full border border-amber-400/30 bg-amber-400/10 px-1.5 py-0.5 text-[9px] font-semibold text-amber-300">
                    {t("provider.beta", "BETA")}
                  </span>
                )}
              </div>
              <p className="mt-2 text-sm leading-relaxed text-gray-500">
                {t(`provider.${option}.description`)}
              </p>
              <span className="mt-4 inline-flex text-xs font-medium text-accent group-hover:underline">
                {t("provider.choose", "Choose")} →
              </span>
            </button>
          ))}
        </div>
        <div className="mt-5 flex justify-center border-t border-border pt-4">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-border bg-surface-2 px-4 py-2 text-xs font-medium text-gray-300 transition-colors hover:bg-surface-3 hover:text-gray-100"
          >
            {t("provider.cancel", "Cancel")}
          </button>
        </div>
      </div>
    </div>
  );
}

type RunStatusFilter =
  | "all"
  | "running"
  | "spawning"
  | "completed"
  | "error"
  | "killed"
  | "abandoned";
type RunModeFilter = "all" | "conversation" | "headless";

interface UnifiedRunRow {
  id: string;
  sessionId: string | null;
  mode: RunMode;
  cwd: string;
  model: string | null;
  status: RunStatus;
  promptPreview: string;
  startedAt: number;
  endedAt: number | null;
  isLive: boolean;
}

function ActiveRunsSwitcher({
  activeRuns,
  currentHandleId,
  onAttach,
  runHistory,
  onResumeFromHistory,
  onViewFromHistory,
  onRefresh,
}: {
  activeRuns: RunListResponse | null;
  currentHandleId: string | null;
  onAttach: (id: string) => void;
  runHistory: DashboardRunHistoryItem[];
  onResumeFromHistory: (item: DashboardRunHistoryItem) => void;
  onViewFromHistory: (item: DashboardRunHistoryItem) => void;
  onRefresh: () => void;
}) {
  const { t } = useTranslation("run");
  const [open, setOpen] = useState(false);

  // Lock body scroll while the modal is open and let Esc close it.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  // Merge live in-memory handles + persistent history into one row list.
  // Live entries dedupe past-history entries with the same id.
  const rows: UnifiedRunRow[] = useMemo(() => {
    const out: UnifiedRunRow[] = [];
    const seen = new Set<string>();
    if (activeRuns) {
      for (const r of activeRuns.items) {
        seen.add(r.id);
        out.push({
          id: r.id,
          sessionId: r.sessionId,
          mode: r.mode,
          cwd: r.cwd,
          model: r.model,
          status: r.status,
          promptPreview: r.prompt || "",
          startedAt: r.startedAt,
          endedAt: r.endedAt,
          isLive: r.status === "running" || r.status === "spawning",
        });
      }
    }
    for (const h of runHistory) {
      if (seen.has(h.id)) continue;
      seen.add(h.id);
      const startedTs = new Date(h.started_at).getTime() || 0;
      const endedTs = h.ended_at ? new Date(h.ended_at).getTime() : null;
      out.push({
        id: h.id,
        sessionId: h.session_id,
        mode: h.mode,
        cwd: h.cwd,
        model: h.model,
        status: h.status,
        promptPreview: h.prompt_preview || "",
        startedAt: startedTs,
        endedAt: endedTs,
        isLive: h.isLive,
      });
    }
    out.sort((a, b) => b.startedAt - a.startedAt);
    return out;
  }, [activeRuns, runHistory]);

  const liveCount = activeRuns?.activeCount ?? 0;
  const totalCount = rows.length;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        disabled={totalCount === 0}
        className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
          liveCount > 0
            ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/15"
            : "border-border bg-surface-2 text-gray-300 hover:bg-surface-3"
        }`}
      >
        <ListOrdered className="w-3.5 h-3.5" />
        {liveCount > 0 ? (
          <>
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            {t("runs.viewActive", { count: liveCount })}
          </>
        ) : (
          <>
            {t("runs.switcher")}
            {totalCount > 0 && <span className="text-gray-500 font-mono">{totalCount}</span>}
          </>
        )}
      </button>
      {open && (
        <RunsModal
          rows={rows}
          currentHandleId={currentHandleId}
          onAttach={(id) => {
            setOpen(false);
            onAttach(id);
          }}
          onResume={(item) => {
            setOpen(false);
            onResumeFromHistory(item);
          }}
          onView={(item) => {
            setOpen(false);
            onViewFromHistory(item);
          }}
          runHistory={runHistory}
          onClose={() => setOpen(false)}
          onRefresh={onRefresh}
        />
      )}
    </>
  );
}

function RunsModal({
  rows,
  currentHandleId,
  onAttach,
  onResume,
  onView,
  runHistory,
  onClose,
  onRefresh,
}: {
  rows: UnifiedRunRow[];
  currentHandleId: string | null;
  onAttach: (id: string) => void;
  onResume: (item: DashboardRunHistoryItem) => void;
  onView: (item: DashboardRunHistoryItem) => void;
  runHistory: DashboardRunHistoryItem[];
  onClose: () => void;
  onRefresh: () => void;
}) {
  const { t } = useTranslation("run");
  const [statusFilter, setStatusFilter] = useState<RunStatusFilter>("all");
  const [modeFilter, setModeFilter] = useState<RunModeFilter>("all");
  const [search, setSearch] = useState("");

  // Snappy refresh while the modal is the foreground UI: pull immediately
  // on open + every 2 s after that. Combined with the page-level 5 s poll
  // and the WS run_status broadcasts, this guarantees that any state
  // change - lifecycle event, sibling tab, manual DB tweak, boot
  // reconciliation - surfaces here within a couple of seconds.
  useEffect(() => {
    onRefresh();
    const tick = setInterval(onRefresh, 2000);
    return () => clearInterval(tick);
  }, [onRefresh]);

  const counts = useMemo(() => {
    const byStatus: Record<string, number> = { all: rows.length };
    const byMode: Record<string, number> = { all: rows.length };
    for (const r of rows) {
      byStatus[r.status] = (byStatus[r.status] || 0) + 1;
      byMode[r.mode] = (byMode[r.mode] || 0) + 1;
    }
    return { byStatus, byMode };
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (modeFilter !== "all" && r.mode !== modeFilter) return false;
      if (!q) return true;
      const hay =
        r.promptPreview + "\n" + r.cwd + "\n" + (r.sessionId || "") + "\n" + (r.model || "");
      return hay.toLowerCase().includes(q);
    });
  }, [rows, statusFilter, modeFilter, search]);

  const historyById = useMemo(() => {
    const m = new Map<string, DashboardRunHistoryItem>();
    for (const h of runHistory) m.set(h.id, h);
    return m;
  }, [runHistory]);

  const STATUSES: RunStatusFilter[] = [
    "all",
    "running",
    "spawning",
    "completed",
    "error",
    "killed",
    "abandoned",
  ];
  const MODES: RunModeFilter[] = ["all", "conversation", "headless"];

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center px-4 py-10 overflow-y-auto bg-black/60 backdrop-blur-sm animate-fade-in"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-4xl rounded-xl border border-border bg-surface-1 shadow-2xl shadow-black/60 flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-3 border-b border-border flex-shrink-0">
          <div className="w-8 h-8 rounded-lg bg-accent/15 inline-flex items-center justify-center">
            <ListOrdered className="w-4 h-4 text-accent" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold text-gray-100">
              {t("runs.modalTitle", "Dashboard runs")}
            </h2>
            <p className="text-[11px] text-gray-500">
              {t(
                "runs.modalSubtitle",
                "Every run started from this dashboard, regardless of status"
              )}
            </p>
          </div>
          <button
            onClick={onRefresh}
            className="w-7 h-7 rounded-md text-gray-500 hover:text-gray-200 hover:bg-surface-3 inline-flex items-center justify-center"
            aria-label={t("runs.refresh", "Refresh")}
            title={t("runs.refresh", "Refresh")}
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
          <Link
            to="/sessions"
            onClick={onClose}
            className="text-[11px] text-accent hover:text-accent/80 inline-flex items-center gap-1 mr-1"
          >
            {t("runs.allSessionsLink")}
          </Link>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-md text-gray-500 hover:text-gray-200 hover:bg-surface-3 inline-flex items-center justify-center"
            aria-label={t("limitations.dismiss")}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Filter bar */}
        <div className="px-5 py-3 border-b border-border flex flex-col gap-2.5 flex-shrink-0">
          <div className="flex items-center gap-2 bg-surface-2 border border-border rounded-md px-2.5 py-1.5">
            <Search className="w-3.5 h-3.5 text-gray-500 flex-shrink-0" />
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("runs.searchPlaceholder", "Search prompt, cwd, model, or session id…")}
              className="flex-1 bg-transparent text-[12px] text-gray-100 placeholder:text-gray-600 focus:outline-none"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="text-gray-500 hover:text-gray-200 text-[10px]"
                aria-label="Clear"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-3 items-center">
            <FilterChipGroup
              label={t("runs.filterStatus", "Status")}
              value={statusFilter}
              options={STATUSES.map((s) => ({
                value: s,
                label: s === "all" ? t("runs.allLabel", "All") : t(`status.${s}`),
                count: counts.byStatus[s] || 0,
              }))}
              onChange={(v) => setStatusFilter(v as RunStatusFilter)}
            />
            <FilterChipGroup
              label={t("runs.filterMode", "Mode")}
              value={modeFilter}
              options={MODES.map((m) => ({
                value: m,
                label: m === "all" ? t("runs.allLabel", "All") : t(`mode.${m}`),
                count: counts.byMode[m] || 0,
              }))}
              onChange={(v) => setModeFilter(v as RunModeFilter)}
            />
          </div>
        </div>

        {/* List */}
        <div className="flex-1 min-h-0 overflow-auto divide-y divide-border">
          {filtered.length === 0 ? (
            <div className="px-5 py-12 text-center text-[12px] text-gray-500">
              {rows.length === 0
                ? t(
                    "runs.modalEmpty",
                    "No dashboard runs yet. Start one below to populate this list."
                  )
                : t("runs.modalEmptyFiltered", "No runs match these filters.")}
            </div>
          ) : (
            filtered.map((r) => {
              const isCurrent = r.id === currentHandleId;
              return (
                <UnifiedRunRowView
                  key={r.id}
                  row={r}
                  isCurrent={isCurrent}
                  onAttach={() => onAttach(r.id)}
                  onResume={() => {
                    const h = historyById.get(r.id);
                    if (h) onResume(h);
                  }}
                  onView={() => {
                    const h = historyById.get(r.id);
                    if (h) onView(h);
                  }}
                />
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-2.5 border-t border-border bg-surface-2/40 flex items-center gap-2 flex-shrink-0">
          <Info className="w-3 h-3 text-gray-500 flex-shrink-0" />
          <span className="text-[10.5px] text-gray-500 leading-relaxed flex-1">
            {t("runs.scopeNote")}
          </span>
          <span className="text-[10.5px] text-gray-500 font-mono">
            {filtered.length} / {rows.length}
          </span>
        </div>
      </div>
    </div>
  );
}

function FilterChipGroup<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string; count: number }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <span className="text-[10px] uppercase tracking-wider font-semibold text-gray-500 mr-1">
        {label}
      </span>
      {options.map((opt) => {
        const active = value === opt.value;
        const dim = opt.count === 0 && opt.value !== "all";
        return (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            disabled={dim}
            className={`text-[10.5px] font-medium px-2 py-0.5 rounded-full border transition-colors disabled:opacity-40 ${
              active
                ? "bg-accent/15 border-accent/50 text-accent"
                : "bg-surface-2 border-border text-gray-300 hover:bg-surface-3 hover:border-border-strong"
            }`}
          >
            {opt.label}
            <span className="ml-1 text-gray-500 font-mono">{opt.count}</span>
          </button>
        );
      })}
    </div>
  );
}

function UnifiedRunRowView({
  row,
  isCurrent,
  onAttach,
  onResume,
  onView,
}: {
  row: UnifiedRunRow;
  isCurrent: boolean;
  onAttach: () => void;
  onResume: () => void;
  onView: () => void;
}) {
  const { t } = useTranslation("run");
  const startedDate = new Date(row.startedAt);
  const startedLabel = isNaN(startedDate.getTime())
    ? "-"
    : startedDate.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
  const canResume = row.mode === "conversation" && !!row.sessionId && !row.isLive;
  // Headless runs are single-shot, so resume doesn't apply - but the captured
  // transcript is still worth viewing. Link to the Session detail page.
  const canView = row.mode === "headless" && !!row.sessionId && !row.isLive;
  return (
    <div
      className={`px-5 py-3 transition-colors ${
        isCurrent ? "bg-accent/[0.06]" : "hover:bg-surface-2/50"
      }`}
    >
      <div className="flex items-center gap-2 mb-1.5 flex-wrap">
        <StatusPill status={row.status} />
        <ModeBadge mode={row.mode} />
        {row.isLive && (
          <span className="text-[10px] font-semibold text-emerald-300 bg-emerald-500/10 border border-emerald-500/25 px-1.5 py-0.5 rounded-full inline-flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            {t("runs.liveBadge", "live")}
          </span>
        )}
        {isCurrent && (
          <span className="text-[10px] font-semibold text-accent bg-accent/10 border border-accent/25 px-1.5 py-0.5 rounded-full">
            {t("runs.currentBadge", "current")}
          </span>
        )}
        <span className="ml-auto inline-flex items-center gap-1.5">
          {row.isLive && !isCurrent && (
            <button
              onClick={onAttach}
              className="inline-flex items-center gap-1 rounded-md border border-emerald-500/40 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-200 px-2 py-0.5 text-[10.5px] font-medium transition-colors"
            >
              <Play className="w-3 h-3" />
              {t("runs.attachLabel", "Attach")}
            </button>
          )}
          {canResume && (
            <button
              onClick={onResume}
              className="inline-flex items-center gap-1 rounded-md border border-accent/40 bg-accent/15 hover:bg-accent/25 text-accent px-2 py-0.5 text-[10.5px] font-medium transition-colors"
            >
              <RotateCcw className="w-3 h-3" />
              {t("resume.resumeOption", "Resume")}
            </button>
          )}
          {canView && (
            <button
              onClick={onView}
              className="inline-flex items-center gap-1 rounded-md border border-border bg-surface-2 hover:bg-surface-3 text-gray-300 hover:text-gray-100 px-2 py-0.5 text-[10.5px] font-medium transition-colors"
            >
              <Eye className="w-3 h-3" />
              {t("runs.viewLabel", "View")}
            </button>
          )}
        </span>
      </div>
      {row.promptPreview && (
        <div className="text-[12px] text-gray-300 line-clamp-2 leading-snug">
          {row.promptPreview}
        </div>
      )}
      <div className="font-mono text-[10px] text-gray-500 truncate mt-1">{row.cwd}</div>
      <div className="text-[10px] text-gray-600 mt-0.5 flex items-center gap-2 flex-wrap">
        <span>{startedLabel}</span>
        {row.model && <span className="font-mono text-gray-500">· {row.model}</span>}
        {row.sessionId && (
          <Link
            to={`/sessions/${encodeURIComponent(row.sessionId)}`}
            className="inline-flex items-center gap-1 text-gray-500 hover:text-gray-300 transition-colors"
            title={t("actions.viewSession")}
          >
            <ExternalLink className="w-2.5 h-2.5" />
            <span className="font-mono">{row.sessionId.slice(0, 8)}</span>
          </Link>
        )}
      </div>
    </div>
  );
}
