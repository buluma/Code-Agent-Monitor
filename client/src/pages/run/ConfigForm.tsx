/**
 * @file Pre-run configuration card: mode/resume-source pickers, the prompt
 * field, and the advanced-fields grid (cwd, model, permission mode, sandbox,
 * effort) plus their supporting cwd-autocomplete, session-picker, and
 * model-picker widgets. Extracted out of Run.tsx — see SHA-167 — no
 * behavior change.
 * @author Michael Buluma <1452922+buluma@users.noreply.github.com>
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertCircle,
  ChevronDown,
  FolderOpen,
  History as HistoryIcon,
  Home,
  Info,
  Lock,
  Play,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldAlert,
  X,
} from "lucide-react";
import { api, RUN_EFFORT_CHOICES } from "../../lib/api";
import type {
  CodexApprovalPolicy,
  CodexSandbox,
  CwdSuggestion,
  DashboardRunHistoryItem,
  EffortLevel,
  ModelChoice,
  PermissionMode,
  RunListResponse,
  RunMode,
  RunProvider,
} from "../../lib/api";
import type { Session } from "../../lib/types";
import { Select } from "../../components/Select";
import type { SlashCommand } from "./slashCommands";
import { PromptEditor } from "./PromptEditor";

// ── Config card (pre-run) ────────────────────────────────────────────

interface ConfigCardProps {
  provider: RunProvider;
  mode: RunMode;
  onModeChange: (m: RunMode) => void;
  prompt: string;
  onPromptChange: (s: string) => void;
  cwd: string;
  onCwdChange: (s: string) => void;
  cwdSuggestions: CwdSuggestion[];
  model: string;
  onModelChange: (s: string) => void;
  permissionMode: PermissionMode | CodexApprovalPolicy;
  onPermissionModeChange: (m: PermissionMode | CodexApprovalPolicy) => void;
  sandbox: CodexSandbox;
  onSandboxChange: (sandbox: CodexSandbox) => void;
  models: ModelChoice[];
  modelsLoading: boolean;
  modelsSource: string | null;
  effort: EffortLevel;
  onEffortChange: (e: EffortLevel) => void;
  binaryFound: boolean;
  busy: boolean;
  onStart: () => void;
  activeRuns: RunListResponse | null;
  resumeSession: Session | null;
  onResumeSessionChange: (s: Session | null) => void;
  slashCommands: SlashCommand[];
  runHistory: DashboardRunHistoryItem[];
  onResumeFromHistory: (item: DashboardRunHistoryItem) => void;
}

export function ConfigCard(props: ConfigCardProps) {
  const { t } = useTranslation("run");
  const providerLabel = t(
    `provider.${props.provider}.label`,
    props.provider === "codex" ? "Codex" : "Claude Code"
  );
  const atCap =
    props.activeRuns != null && props.activeRuns.activeCount >= props.activeRuns.maxConcurrent;
  const isResume = !!props.resumeSession;
  const selectedModel = props.models.find((item) => item.id === props.model);
  const supportedEfforts =
    props.provider === "codex" && selectedModel?.supportedEfforts?.length
      ? new Set(selectedModel.supportedEfforts)
      : null;
  const effortOptions = RUN_EFFORT_CHOICES.filter((choice) =>
    props.provider === "claude"
      ? choice.id !== "ultra"
      : !supportedEfforts ||
        choice.id === "" ||
        supportedEfforts.has(choice.id as Exclude<EffortLevel, "">)
  );
  const [resumePicked, setResumePicked] = useState(isResume);
  // Keep "resume picked" in sync with the parent. Two cases:
  //  1. Parent set a resume session (e.g. user clicked Resume in the runs
  //     modal) - flip the radio so the picker is shown and the selection
  //     is visible.
  //  2. Parent cleared the session and mode flipped to headless - clear
  //     the radio so the form is honest.
  useEffect(() => {
    if (isResume && !resumePicked) setResumePicked(true);
    else if (!isResume && resumePicked && props.mode === "headless") setResumePicked(false);
  }, [isResume, resumePicked, props.mode]);

  return (
    <div className="rounded-xl border border-border bg-surface-1">
      {/* Claude has a native one-shot mode; Codex's app-server is intentionally
          interactive, so we present that distinction plainly instead of a
          non-functional mode toggle. */}
      {props.provider === "claude" ? (
        <div className="border-b border-border px-4 py-3">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 mb-2">
            {t("mode.label")}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <ModeOption
              active={props.mode === "conversation"}
              label={t("mode.conversation")}
              hint={t("mode.conversationHint")}
              onClick={() => props.onModeChange("conversation")}
            />
            <ModeOption
              active={props.mode === "headless"}
              label={t("mode.headless")}
              hint={t("mode.headlessHint")}
              onClick={() => {
                props.onModeChange("headless");
                props.onResumeSessionChange(null);
                setResumePicked(false);
              }}
            />
          </div>
          {props.mode === "headless" && (
            <p className="mt-2 text-[11px] text-gray-500 leading-relaxed flex items-start gap-1.5">
              <Info className="w-3 h-3 text-gray-500 flex-shrink-0 mt-0.5" />
              {t("hint.headlessExplain")}
            </p>
          )}
        </div>
      ) : (
        <div className="border-b border-border px-4 py-3">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">
            {t("provider.codex.interactiveLabel", "Interactive Codex thread")}
          </div>
          <p className="mt-1 text-xs leading-relaxed text-gray-500">
            {t(
              "provider.codex.interactiveHint",
              "Starts a persistent local thread with live replies, tool activity, cancellation, and follow-up turns."
            )}
          </p>
        </div>
      )}

      {/* Step 2 (only for multi-turn): Source - new vs resume */}
      {props.mode === "conversation" && (
        <div className="border-b border-border px-4 py-3">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 mb-2">
            {t("resume.label")}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <ModeOption
              active={!resumePicked}
              label={t("resume.freshOption")}
              hint={t("resume.freshHintWithProvider", "Start a fresh {{agent}} session.", {
                agent: providerLabel,
              })}
              onClick={() => {
                setResumePicked(false);
                props.onResumeSessionChange(null);
              }}
            />
            <ModeOption
              active={resumePicked}
              label={t("resume.resumeOption")}
              hint={t("resume.resumeHint")}
              onClick={() => setResumePicked(true)}
            />
          </div>
          {resumePicked && (
            <SessionPicker
              provider={props.provider}
              selected={props.resumeSession}
              // Clearing the picker leaves "Resume" selected so the user
              // can pick a different one without re-toggling.
              onSelect={(s) => props.onResumeSessionChange(s)}
            />
          )}
        </div>
      )}

      {/* Prompt */}
      <div className="px-4 py-3 border-b border-border">
        <label className="block text-[11px] font-semibold uppercase tracking-wider text-gray-500 mb-1.5">
          {t("fields.prompt")}
        </label>
        <PromptEditor
          value={props.prompt}
          onChange={props.onPromptChange}
          onSubmit={props.onStart}
          placeholder={t("fields.promptPlaceholderWithProvider", "Ask {{agent}} anything…", {
            agent: providerLabel,
          })}
          rows={5}
          slashCommands={props.slashCommands}
          fileCwd={props.resumeSession?.cwd || props.cwd}
        />
        <div className="mt-1 text-[10px] text-gray-600">
          {t("hint.shortcut")} · {t("hint.slashAndFileHint")}
        </div>
      </div>

      {/* Advanced fields */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 px-4 py-3">
        <Field label={t("fields.cwd")}>
          {isResume && props.resumeSession ? (
            <div className="bg-surface-2 border border-border rounded-md px-3 py-1.5 text-[11px] font-mono text-gray-300 flex items-center gap-2">
              <Lock className="w-3 h-3 text-gray-500 flex-shrink-0" />
              <span className="truncate">{props.resumeSession.cwd}</span>
            </div>
          ) : (
            <CwdAutocomplete
              provider={props.provider}
              value={props.cwd}
              onChange={props.onCwdChange}
              suggestions={props.cwdSuggestions}
            />
          )}
          <p className="mt-1 text-[10px] text-gray-500">
            {isResume ? t("resume.originalCwd") : t("fields.cwdHint")}
          </p>
        </Field>
        <Field label={t("fields.model")}>
          <ModelPicker
            provider={props.provider}
            value={props.model}
            onChange={props.onModelChange}
            models={props.models}
            loading={props.modelsLoading}
          />
          {props.modelsSource && (
            <p className="mt-1 text-[10px] text-gray-500">
              {props.provider === "codex"
                ? t("fields.modelLiveCatalog", "Live catalog from your signed-in Codex CLI")
                : t(
                    "fields.modelCuratedCatalog",
                    "Claude Code does not publish an account model list; choose its stable aliases or enter another model ID."
                  )}
            </p>
          )}
        </Field>
        <Field label={t("fields.permissionMode")}>
          {props.provider === "claude" ? (
            <Select<PermissionMode>
              value={props.permissionMode as PermissionMode}
              onChange={props.onPermissionModeChange}
              options={[
                { value: "acceptEdits", label: t("fields.permissionAcceptEdits") },
                { value: "default", label: t("fields.permissionDefault") },
                { value: "plan", label: t("fields.permissionPlan") },
                { value: "bypassPermissions", label: t("fields.permissionBypass") },
              ]}
            />
          ) : (
            <Select<CodexApprovalPolicy>
              value={props.permissionMode as CodexApprovalPolicy}
              onChange={props.onPermissionModeChange}
              options={[
                { value: "untrusted", label: t("fields.approvalUntrusted", "Untrusted") },
                { value: "on-request", label: t("fields.approvalOnRequest", "On request") },
                { value: "never", label: t("fields.approvalNever", "Never") },
              ]}
            />
          )}
        </Field>
        {props.provider === "codex" && (
          <Field label={t("fields.sandbox", "Sandbox")}>
            <Select<CodexSandbox>
              value={props.sandbox}
              onChange={props.onSandboxChange}
              options={[
                { value: "read-only", label: t("fields.sandboxReadOnly", "Read-only") },
                {
                  value: "workspace-write",
                  label: t("fields.sandboxWorkspaceWrite", "Workspace write"),
                },
                {
                  value: "danger-full-access",
                  label: t("fields.sandboxDanger", "Danger full access"),
                },
              ]}
            />
          </Field>
        )}
        <Field label={t("fields.effort")}>
          <Select<EffortLevel>
            value={props.effort}
            onChange={props.onEffortChange}
            options={effortOptions.map((c) => ({
              value: c.id,
              label: c.label,
              hint: c.hint,
            }))}
          />
          <p className="mt-1 text-[10px] text-gray-500">{t("fields.effortHint")}</p>
        </Field>
      </div>

      {(props.permissionMode === "bypassPermissions" ||
        (props.provider === "codex" && props.sandbox === "danger-full-access")) && (
        <div className="mx-4 mb-3 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-[11px] text-red-200 flex items-start gap-2">
          <ShieldAlert className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
          <span>{t("hint.permissionWarning")}</span>
        </div>
      )}

      {/* Footer: contextual run-state hint + run button */}
      <div className="border-t border-border px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 text-[11px] min-w-0">
          {atCap ? (
            <span className="inline-flex items-center gap-1.5 text-amber-300">
              <AlertCircle className="w-3.5 h-3.5" />
              {t("concurrency.atCap", { max: props.activeRuns?.maxConcurrent ?? 0 })}
            </span>
          ) : props.activeRuns && props.activeRuns.activeCount > 0 ? (
            <span className="inline-flex items-center gap-1.5 text-gray-400">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              {t("concurrency.active", { count: props.activeRuns.activeCount })}
            </span>
          ) : null}
        </div>
        <button
          onClick={props.onStart}
          disabled={
            !props.binaryFound ||
            !props.prompt.trim() ||
            props.busy ||
            atCap ||
            (resumePicked && !props.resumeSession) ||
            // Resume locks cwd to the original session, so allow it then;
            // otherwise require a non-empty cwd so we never spawn at an
            // invisible default.
            (!props.resumeSession && !props.cwd.trim())
          }
          className="inline-flex items-center gap-2 rounded-lg border border-accent/40 bg-accent/15 hover:bg-accent/25 text-accent px-4 py-1.5 text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {props.busy ? (
            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Play className="w-3.5 h-3.5" />
          )}
          {props.busy ? t("actions.starting") : t("actions.start")}
        </button>
      </div>
    </div>
  );
}

function ModeOption({
  active,
  label,
  hint,
  onClick,
}: {
  active: boolean;
  label: string;
  hint: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`text-left rounded-lg border px-3 py-2.5 transition-colors ${
        active ? "border-accent/40 bg-accent/10" : "border-border bg-surface-2 hover:bg-surface-3"
      }`}
    >
      <div className={`text-sm font-medium ${active ? "text-accent" : "text-gray-200"}`}>
        {label}
      </div>
      <div className="text-[11px] text-gray-500 mt-0.5">{hint}</div>
    </button>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-1">
        {label}
      </label>
      {children}
    </div>
  );
}

// ── CWD autocomplete ──────────────────────────────────────────────────

function CwdAutocomplete({
  provider,
  value,
  onChange,
  suggestions,
}: {
  provider: RunProvider;
  value: string;
  onChange: (s: string) => void;
  suggestions: CwdSuggestion[];
}) {
  const { t } = useTranslation("run");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const filtered = useMemo(() => {
    const q = value.toLowerCase().trim();
    const out = suggestions.filter(
      (s) => !q || s.path.toLowerCase().includes(q) || s.label.toLowerCase().includes(q)
    );
    return out;
  }, [value, suggestions]);

  // Group suggestions by kind preserving fixed order — home first, matching
  // the neutral default the page pre-fills (issue #202).
  const groups = useMemo(() => {
    const order: CwdSuggestion["kind"][] = ["home", "dashboard", "recent"];
    return order
      .map((kind) => ({ kind, items: filtered.filter((s) => s.kind === kind) }))
      .filter((g) => g.items.length > 0);
  }, [filtered]);

  // Flat index for keyboard navigation
  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);

  // Keep `active` clamped within bounds
  useEffect(() => {
    if (active >= flat.length) setActive(Math.max(0, flat.length - 1));
  }, [flat.length, active]);

  const choose = (s: CwdSuggestion) => {
    onChange(s.path);
    setOpen(false);
    inputRef.current?.blur();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      setOpen(true);
      e.preventDefault();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(flat.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter") {
      if (open && flat[active]) {
        e.preventDefault();
        choose(flat[active]);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <FolderOpen className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500 pointer-events-none" />
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            setOpen(true);
            setActive(0);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={t("fields.cwdPlaceholder")}
          autoComplete="off"
          spellCheck={false}
          className="w-full bg-surface-2 border border-border rounded-md pl-7 pr-3 py-1.5 text-[11px] font-mono text-gray-100 placeholder:text-gray-500 focus:outline-none focus:border-accent/50"
        />
      </div>
      {open && (
        <div className="absolute z-30 left-0 right-0 mt-1 rounded-md border border-border bg-surface-1 shadow-lg shadow-black/40 max-h-72 overflow-auto py-1">
          {groups.length === 0 ? (
            <div className="px-3 py-2 text-[11px] text-gray-500">{t("fields.cwdNoMatches")}</div>
          ) : (
            groups.map((g) => (
              <div key={g.kind}>
                <div className="px-3 pt-1.5 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-gray-500 flex items-center gap-1.5">
                  {g.kind === "dashboard" ? (
                    <FolderOpen className="w-3 h-3" />
                  ) : g.kind === "home" ? (
                    <Home className="w-3 h-3" />
                  ) : (
                    <HistoryIcon className="w-3 h-3" />
                  )}
                  {g.kind === "recent"
                    ? t("fields.cwdGroups.recentWithProvider", "Recent - used by {{agent}}", {
                        agent: t(
                          `provider.${provider}.label`,
                          provider === "codex" ? "Codex" : "Claude Code"
                        ),
                      })
                    : t(`fields.cwdGroups.${g.kind}`)}
                </div>
                {g.items.map((s) => {
                  const idx = flat.indexOf(s);
                  const isActive = idx === active;
                  return (
                    <button
                      key={s.path}
                      type="button"
                      onMouseDown={(e) => e.preventDefault() /* keep input focused */}
                      onClick={() => choose(s)}
                      onMouseEnter={() => setActive(idx)}
                      className={`w-full text-left px-3 py-1.5 transition-colors ${
                        isActive ? "bg-accent/15" : "hover:bg-surface-3"
                      }`}
                    >
                      <div className="text-[11px] text-gray-200 truncate">{s.label}</div>
                      <div className="font-mono text-[10px] text-gray-500 truncate">{s.path}</div>
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ── Session picker (for resume) ───────────────────────────────────────

function SessionPicker({
  provider,
  selected,
  onSelect,
}: {
  provider: RunProvider;
  selected: Session | null;
  onSelect: (s: Session | null) => void;
}) {
  const { t } = useTranslation("run");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setSessions(null);
    setQuery("");
  }, [provider]);

  // Lazily load sessions when the picker is opened. Guard against a stale
  // response landing after the provider has since changed (list() is keyed
  // by provider, so a slow first request must not clobber a later one).
  useEffect(() => {
    if (!open || sessions !== null) return;
    let cancelled = false;
    api.sessions
      .list({ sort_by: "started_at", sort_desc: true, limit: 100, provider })
      .then((r) => {
        if (!cancelled) setSessions(r.sessions);
      })
      .catch(() => {
        if (!cancelled) setSessions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, provider, sessions]);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const filtered = useMemo(() => {
    if (!sessions) return [];
    const q = query.toLowerCase().trim();
    if (!q) return sessions;
    return sessions.filter(
      (s) =>
        s.id.toLowerCase().includes(q) ||
        (s.cwd || "").toLowerCase().includes(q) ||
        (s.status || "").toLowerCase().includes(q)
    );
  }, [sessions, query]);

  if (selected) {
    return (
      <div className="mt-2 rounded-lg border border-accent/30 bg-accent/5 px-3 py-2 flex items-start gap-2">
        <RotateCcw className="w-3.5 h-3.5 text-accent flex-shrink-0 mt-0.5" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-accent/15 text-accent border border-accent/30">
              {t("resume.selectedBadge")}
            </span>
            <span className="font-mono text-[11px] text-gray-200 truncate">{selected.id}</span>
          </div>
          <div className="font-mono text-[10px] text-gray-500 truncate mt-0.5">{selected.cwd}</div>
        </div>
        <button
          onClick={() => onSelect(null)}
          className="text-[10px] font-medium px-2 py-0.5 rounded border border-border bg-surface-2 hover:bg-surface-3 text-gray-300 inline-flex items-center gap-1 flex-shrink-0"
        >
          <X className="w-3 h-3" />
          {t("resume.clear")}
        </button>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative mt-2">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full text-left rounded-md border border-dashed border-border bg-surface-2 hover:bg-surface-3 px-3 py-2 text-[11px] text-gray-400 inline-flex items-center gap-2"
      >
        <RotateCcw className="w-3.5 h-3.5" />
        {t("resume.pickSession")}
        <ChevronDown className="w-3 h-3 opacity-70 ml-auto" />
      </button>
      {open && (
        <div className="absolute z-30 left-0 right-0 mt-1 rounded-md border border-border bg-surface-1 shadow-lg shadow-black/40 overflow-hidden">
          <div className="px-3 py-2 border-b border-border flex items-center gap-2">
            <Search className="w-3.5 h-3.5 text-gray-500 flex-shrink-0" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("resume.search")}
              className="bg-transparent text-[11px] text-gray-100 placeholder:text-gray-500 focus:outline-none w-full"
            />
          </div>
          <div className="max-h-72 overflow-auto py-1">
            {sessions === null ? (
              <div className="px-3 py-2 text-[11px] text-gray-500">…</div>
            ) : filtered.length === 0 ? (
              <div className="px-3 py-2 text-[11px] text-gray-500">{t("resume.noSessions")}</div>
            ) : (
              filtered.map((s) => (
                <button
                  key={s.id}
                  onClick={() => {
                    onSelect(s);
                    setOpen(false);
                    setQuery("");
                  }}
                  className="w-full text-left px-3 py-2 hover:bg-surface-3 transition-colors"
                >
                  <div className="flex items-center gap-2 mb-0.5">
                    <span
                      className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${
                        s.status === "active"
                          ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/30"
                          : s.status === "completed"
                            ? "bg-sky-500/10 text-sky-300 border-sky-500/30"
                            : s.status === "error"
                              ? "bg-red-500/10 text-red-300 border-red-500/30"
                              : "bg-surface-3 text-gray-400 border-border"
                      }`}
                    >
                      {s.status}
                    </span>
                    {s.name?.trim() && (
                      <span className="text-[11px] text-gray-200 truncate">{s.name.trim()}</span>
                    )}
                    <span className="font-mono text-[11px] text-gray-400 truncate flex-shrink-0">
                      {s.id.slice(0, 12)}…
                    </span>
                    <span className="text-[10px] text-gray-600 ml-auto flex-shrink-0">
                      {new Date(s.started_at).toLocaleString()}
                    </span>
                  </div>
                  <div className="font-mono text-[10px] text-gray-500 truncate">{s.cwd}</div>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// The custom Select dropdown now lives in ../components/Select (shared with the
// webhook settings form). Imported at the top of this file.

// Sentinel option value for "Custom model…". Empty string is already taken by
// the "inherit from settings" choice, so use a non-empty marker.
const MODEL_CUSTOM = "__custom__";

function ModelPicker({
  provider,
  value,
  onChange,
  models,
  loading,
}: {
  provider: RunProvider;
  value: string;
  onChange: (s: string) => void;
  models: ModelChoice[];
  loading: boolean;
}) {
  const { t } = useTranslation("run");
  // "Custom" is selected when the value isn't part of the live/observed
  // response. This keeps advanced CLI model aliases available without making
  // a static client catalog the source of truth.
  const knownIds = useMemo(() => models.map((c) => c.id), [models]);
  const isCustom = value !== "" && !knownIds.includes(value);
  const [showCustom, setShowCustom] = useState(isCustom);
  // At mount the catalog may still be loading (models === []), which makes
  // isCustom latch true for a value that turns out to be a known model once
  // fetched. Reconcile once loading settles, but don't clobber an explicit
  // "Custom…" pick the user made in the meantime.
  const userPickedCustomRef = useRef(false);
  useEffect(() => {
    if (!loading && !userPickedCustomRef.current) setShowCustom(isCustom);
  }, [loading, isCustom]);

  // Reuse the shared Select so the Model dropdown renders identically to the
  // Permission Mode and Effort dropdowns (Tailwind + lucide popover) instead of
  // a browser-native <select>.
  const options = useMemo(
    () => [
      ...models.map((c) => ({
        value: c.id,
        // The empty model ID intentionally omits --model and therefore
        // matches Claude's own "Default (recommended)" behavior.
        label: c.id === "" ? t("fields.modelInheritLabel", "Default (recommended)") : c.label,
        hint: c.hint,
      })),
      { value: MODEL_CUSTOM, label: t("fields.modelCustom"), hint: undefined },
    ],
    [models, t]
  );

  const onSelect = (v: string) => {
    if (v === MODEL_CUSTOM) {
      userPickedCustomRef.current = true;
      setShowCustom(true);
      return;
    }
    userPickedCustomRef.current = false;
    setShowCustom(false);
    onChange(v);
  };

  const selectValue = showCustom || isCustom ? MODEL_CUSTOM : value;
  const selected = options.find((option) => option.value === selectValue);

  return (
    <div className="space-y-1.5">
      <Select<string>
        value={selectValue}
        onChange={onSelect}
        options={options}
        disabled={loading}
      />
      {(showCustom || isCustom) && (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={t("fields.modelCustomPlaceholder")}
          autoComplete="off"
          spellCheck={false}
          className="w-full bg-surface-2 border border-border rounded-md px-3 py-1.5 text-[11px] font-mono text-gray-100 placeholder:text-gray-500 focus:outline-none focus:border-accent/50"
        />
      )}
      {selected?.hint && !(showCustom || isCustom) && (
        <p className="text-[10px] leading-relaxed text-gray-500">{selected.hint}</p>
      )}
      {(showCustom || isCustom) && provider === "claude" && (
        <p className="text-[10px] leading-relaxed text-gray-500">
          {t(
            "fields.modelCustomClaudeHint",
            "For a previous or account-specific Claude model, enter its exact --model value."
          )}
        </p>
      )}
    </div>
  );
}
