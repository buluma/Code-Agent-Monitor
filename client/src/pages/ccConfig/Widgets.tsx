/**
 * @file Shared read-only/editing widgets for the Claude Code config explorer:
 * scope badges, copy buttons, empty/skeleton states, the file/editor/confirm
 * -delete/backups modals, the read-only explainer banner, and the inline
 * copyable command snippet. Presentational components extracted out of
 * CcConfig.tsx (see SHA-167) with no behavior change.
 * @author Michael Buluma <1452922+buluma@users.noreply.github.com>
 */

import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  Check,
  Copy,
  FileText,
  X,
  AlertCircle,
  Pencil,
  Save,
  ShieldAlert,
  Trash2,
  Terminal,
  History,
  Lock,
} from "lucide-react";
import { api } from "../../lib/api";
import type { CcFileResponse, CcBackup, CcArtifactType } from "../../lib/api";
import type { EditorState, ConfirmDeleteState, Toast } from "./types";

export function ScopeBadge({ scope }: { scope: string }) {
  const { t } = useTranslation("ccConfig");
  const color =
    scope === "user"
      ? "bg-sky-500/10 text-sky-300 border-sky-500/30"
      : scope === "project"
        ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/30"
        : scope === "project-local"
          ? "bg-violet-500/10 text-violet-300 border-violet-500/30"
          : "bg-surface-3 text-gray-400 border-border";
  const label =
    scope === "project-local"
      ? t("scope.projectLocal")
      : scope === "user"
        ? t("scope.user")
        : scope === "project"
          ? t("scope.project")
          : scope;
  return (
    <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${color}`}>{label}</span>
  );
}

export function CopyButton({ value }: { value: string }) {
  const { t } = useTranslation("ccConfig");
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* clipboard unavailable */
        }
      }}
      className="text-[10px] font-medium px-1.5 py-1 rounded border border-border bg-surface-1 hover:bg-surface-3 text-gray-400 hover:text-gray-200 inline-flex items-center gap-1 flex-shrink-0"
      title={t("common.copyPath")}
    >
      {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
    </button>
  );
}

export function Empty() {
  const { t } = useTranslation("ccConfig");
  return (
    <div className="rounded-lg border border-dashed border-border bg-surface-2 px-4 py-8 text-center text-sm text-gray-500">
      {t("common.empty")}
    </div>
  );
}

export function SkeletonRows({ n }: { n: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} className="h-16 rounded-lg border border-border bg-surface-2 animate-pulse" />
      ))}
    </div>
  );
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// ── File viewer modal ─────────────────────────────────────────────────

export function FileViewer({
  state,
  onClose,
}: {
  state: { path: string; data: CcFileResponse | null; error: string | null };
  onClose: () => void;
}) {
  const { t } = useTranslation("ccConfig");
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      className="fixed inset-0 bg-black/60 z-40 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-4xl max-h-[85vh] rounded-xl border border-border bg-surface-1 flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
          <FileText className="w-4 h-4 text-gray-500" />
          <span className="font-mono text-[12px] text-gray-300 truncate flex-1">{state.path}</span>
          <CopyButton value={state.path} />
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-200 p-1 rounded-md hover:bg-surface-3"
            aria-label={t("common.close")}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="overflow-auto p-4">
          {state.error ? (
            <div className="text-sm text-red-300 inline-flex items-center gap-2">
              <AlertCircle className="w-4 h-4" />
              {state.error}
            </div>
          ) : !state.data ? (
            <div className="text-sm text-gray-500">…</div>
          ) : (
            <pre className="text-[11px] font-mono text-gray-200 whitespace-pre-wrap break-words">
              {state.data.text}
              {state.data.truncated && (
                <span className="text-gray-500 italic">
                  {"\n\n"}
                  {t("common.truncated")}
                </span>
              )}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Editor modal (create + edit) ──────────────────────────────────────

interface EditorModalProps {
  state: NonNullable<EditorState>;
  onClose: () => void;
  onSave: (args: {
    type: CcArtifactType;
    targetScope: "user" | "project" | "auto-memory";
    name: string | undefined;
    content: string;
    project?: string;
  }) => Promise<void>;
}

export function EditorModal({ state, onClose, onSave }: EditorModalProps) {
  const { t } = useTranslation("ccConfig");
  const isCreate = state.mode === "create";
  const isAutoMemory = state.type === "auto-memory";
  const [content, setContent] = useState<string>(isCreate ? state.template : "");
  const [name, setName] = useState<string>("");
  const [targetScope, setTargetScope] = useState<"user" | "project">(
    isCreate ? state.defaultScope : state.scope === "auto-memory" ? "user" : state.scope
  );
  const [loading, setLoading] = useState(!isCreate);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // For edit mode, fetch the actual file content
  useEffect(() => {
    if (state.mode === "edit") {
      setLoading(true);
      api.ccConfig
        .file(state.filePath)
        .then((r) => {
          setContent(r.text);
          setLoading(false);
        })
        .catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : "unknown";
          setError(msg);
          setLoading(false);
        });
    }
  }, [state]);

  // Esc to close
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      if (state.type !== "memory" && state.mode === "create" && !name) {
        setError(t("edit.nameLabel"));
        setSaving(false);
        return;
      }
      // For auto-memory creates, append a .md extension when the user omits it.
      const createName = isAutoMemory && !/\.md$/i.test(name) ? `${name}.md` : name;
      const effectiveName =
        state.mode === "edit" ? state.name : state.type === "memory" ? undefined : createName;
      await onSave({
        type: state.type,
        targetScope: isAutoMemory ? "auto-memory" : targetScope,
        name: effectiveName,
        content,
        project: state.project,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "unknown";
      setError(t("edit.writeError", { message: msg }));
    } finally {
      setSaving(false);
    }
  }, [state, targetScope, name, content, isAutoMemory, onSave, t]);

  const titleText = isCreate
    ? isAutoMemory
      ? t("memory.newFileTitle", { project: state.project ?? "" })
      : t("edit.newTitle", { type: state.type })
    : t("edit.editTitle", { name: state.mode === "edit" ? state.name : "" });

  return (
    <div
      className="fixed inset-0 bg-black/60 z-40 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-4xl max-h-[90vh] rounded-xl border border-border bg-surface-1 flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
          <Pencil className="w-4 h-4 text-gray-500" />
          <span className="text-sm font-medium text-gray-100 flex-1 truncate">{titleText}</span>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-200 p-1 rounded-md hover:bg-surface-3"
            aria-label={t("common.close")}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="overflow-auto p-4 space-y-3">
          {isCreate && state.type !== "memory" && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wider text-gray-500 mb-1">
                  {t("edit.nameLabel")}
                </label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={
                    isAutoMemory ? t("memory.namePlaceholder") : t("edit.namePlaceholder")
                  }
                  pattern={isAutoMemory ? undefined : "[A-Za-z0-9][A-Za-z0-9._-]{0,63}"}
                  className="w-full bg-surface-2 border border-border rounded-md px-3 py-1.5 text-sm font-mono text-gray-100 placeholder:text-gray-500 focus:outline-none focus:border-accent/50"
                />
                <p className="mt-1 text-[10px] text-gray-500">
                  {isAutoMemory ? t("memory.nameHelp") : t("edit.nameHelp")}
                </p>
              </div>
              {isAutoMemory ? (
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-gray-500 mb-1">
                    {t("memory.projectLabel")}
                  </label>
                  <div className="rounded-md border border-border bg-surface-2 px-3 py-1.5 font-mono text-[11px] text-gray-300 truncate">
                    {state.project}
                  </div>
                  <p className="mt-1 text-[10px] text-gray-500">{t("memory.projectHelp")}</p>
                </div>
              ) : (
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-gray-500 mb-1">
                    {t("edit.scopePicker")}
                  </label>
                  <div className="inline-flex rounded-md border border-border bg-surface-2 p-0.5">
                    {(["user", "project"] as const).map((s) => (
                      <button
                        key={s}
                        onClick={() => setTargetScope(s)}
                        className={`px-3 py-1 text-[11px] font-medium rounded ${
                          targetScope === s
                            ? "bg-accent/20 text-accent border border-accent/30"
                            : "text-gray-400 hover:text-gray-200"
                        }`}
                      >
                        {t(`scope.${s}`)}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-gray-500 mb-1">
              {t("edit.contentLabel")}
            </label>
            {loading ? (
              <div className="h-72 rounded-md border border-border bg-surface-2 animate-pulse" />
            ) : (
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                spellCheck={false}
                className="w-full h-72 bg-surface-2 border border-border rounded-md px-3 py-2 text-[11px] font-mono text-gray-100 placeholder:text-gray-500 focus:outline-none focus:border-accent/50 resize-y"
              />
            )}
          </div>

          {error && (
            <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-200 inline-flex items-center gap-2">
              <AlertCircle className="w-3.5 h-3.5" />
              {error}
            </div>
          )}
        </div>

        <div className="border-t border-border px-4 py-3 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="text-[12px] font-medium px-3 py-1.5 rounded-md border border-border bg-surface-2 hover:bg-surface-3 text-gray-300"
          >
            {t("edit.cancel")}
          </button>
          <button
            onClick={handleSave}
            disabled={saving || loading}
            className="text-[12px] font-medium px-3 py-1.5 rounded-md border border-accent/40 bg-accent/15 hover:bg-accent/25 text-accent inline-flex items-center gap-1.5 disabled:opacity-60"
          >
            <Save className="w-3.5 h-3.5" />
            {saving ? t("edit.saving") : t("edit.save")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Confirm-delete modal ──────────────────────────────────────────────

interface ConfirmDeleteModalProps {
  state: NonNullable<ConfirmDeleteState>;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}

export function ConfirmDeleteModal({ state, onCancel, onConfirm }: ConfirmDeleteModalProps) {
  const { t } = useTranslation("ccConfig");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const handleConfirm = useCallback(async () => {
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
    }
  }, [onConfirm]);

  return (
    <div
      className="fixed inset-0 bg-black/60 z-40 flex items-center justify-center p-4"
      onClick={onCancel}
    >
      <div
        className="relative w-full max-w-lg rounded-xl border border-red-500/40 bg-surface-1"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-border px-4 py-2.5 flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 text-red-300" />
          <span className="text-sm font-medium text-gray-100 flex-1">
            {t("edit.confirmDelete")}
          </span>
        </div>
        <div className="p-4 space-y-3">
          <p className="text-xs text-gray-400 leading-relaxed">{t("edit.confirmDeleteBody")}</p>
          <div className="rounded-md border border-border bg-surface-2 px-3 py-2 font-mono text-[11px] text-gray-300 break-all">
            {t("edit.confirmDeletePath", { path: state.path })}
          </div>
        </div>
        <div className="border-t border-border px-4 py-3 flex items-center justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={busy}
            className="text-[12px] font-medium px-3 py-1.5 rounded-md border border-border bg-surface-2 hover:bg-surface-3 text-gray-300 disabled:opacity-60"
          >
            {t("edit.cancel")}
          </button>
          <button
            onClick={handleConfirm}
            disabled={busy}
            className="text-[12px] font-medium px-3 py-1.5 rounded-md border border-red-500/50 bg-red-500/15 hover:bg-red-500/25 text-red-200 inline-flex items-center gap-1.5 disabled:opacity-60"
          >
            <Trash2 className="w-3.5 h-3.5" />
            {busy ? t("edit.deleting") : t("edit.confirmDeleteAction")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Toast (5s auto-dismiss) ───────────────────────────────────────────

export function ToastNotice({
  toast,
  onDismiss,
}: {
  toast: NonNullable<Toast>;
  onDismiss: () => void;
}) {
  const isErr = toast.kind === "error";
  return (
    <div className="fixed bottom-6 right-6 z-50 max-w-md">
      <div
        className={`rounded-lg border px-3 py-2 shadow-lg flex items-start gap-2 ${
          isErr
            ? "border-red-500/50 bg-red-500/15 text-red-100"
            : "border-emerald-500/40 bg-emerald-500/10 text-emerald-100"
        }`}
      >
        {isErr ? (
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
        ) : (
          <Check className="w-4 h-4 flex-shrink-0 mt-0.5" />
        )}
        <span className="text-xs leading-relaxed flex-1 break-all">{toast.message}</span>
        <button
          onClick={onDismiss}
          className="text-current/70 hover:text-current p-0.5"
          aria-label="dismiss"
        >
          <X className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}

// ── Read-only explainer banner ─────────────────────────────────────────

interface ExplainerBannerProps {
  title: string;
  body: string;
  howTo: string;
  commands: { cmd: string; note: string }[];
}

export function ExplainerBanner({ title, body, howTo, commands }: ExplainerBannerProps) {
  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/[0.04] px-4 py-3">
      <div className="flex items-start gap-2">
        <Lock className="w-4 h-4 text-amber-300 flex-shrink-0 mt-0.5" />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="text-sm font-medium text-amber-100">{title}</div>
          <p className="text-xs text-gray-400 leading-relaxed">{body}</p>
          {commands.length > 0 && (
            <div className="pt-1">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 mb-1.5">
                {howTo}
              </div>
              <div className="space-y-1.5">
                {commands.map((c, i) => (
                  <CommandSnippet key={i} command={c.cmd} label={c.note} />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Inline copyable command ────────────────────────────────────────────

export function CommandSnippet({ command, label }: { command: string; label?: string }) {
  const { t } = useTranslation("ccConfig");
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded-md border border-border bg-surface-2 px-2.5 py-1.5 flex items-center gap-2">
      <Terminal className="w-3 h-3 text-gray-500 flex-shrink-0" />
      <code className="font-mono text-[11px] text-gray-200 truncate flex-1">{command}</code>
      {label && (
        <span className="text-[10px] text-gray-500 hidden md:inline truncate">{label}</span>
      )}
      <button
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(command);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          } catch {
            /* clipboard unavailable */
          }
        }}
        className="text-[10px] font-medium px-1.5 py-1 rounded border border-border bg-surface-1 hover:bg-surface-3 text-gray-400 hover:text-gray-200 inline-flex items-center gap-1 flex-shrink-0"
        title={t("snippet.copy")}
      >
        {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
        <span>{copied ? t("snippet.copied") : t("snippet.copy")}</span>
      </button>
    </div>
  );
}

// ── Backups modal ──────────────────────────────────────────────────────

export function BackupsModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation("ccConfig");
  const [items, setItems] = useState<CcBackup[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.ccConfig
      .backups()
      .then((r) => setItems(r.items))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "unknown"));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 bg-black/60 z-40 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-3xl max-h-[85vh] rounded-xl border border-border bg-surface-1 flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
          <History className="w-4 h-4 text-gray-500" />
          <span className="text-sm font-medium text-gray-100 flex-1">{t("backups.title")}</span>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-200 p-1 rounded-md hover:bg-surface-3"
            aria-label={t("common.close")}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="px-4 py-3 border-b border-border">
          <p className="text-[11px] text-gray-500 leading-relaxed">{t("backups.subtitle")}</p>
        </div>
        <div className="overflow-auto p-4 space-y-2">
          {error && (
            <div className="text-sm text-red-300 inline-flex items-center gap-2">
              <AlertCircle className="w-4 h-4" />
              {error}
            </div>
          )}
          {items === null && !error && <SkeletonRows n={4} />}
          {items !== null && items.length === 0 && (
            <div className="rounded-lg border border-dashed border-border bg-surface-2 px-4 py-8 text-center text-sm text-gray-500">
              {t("backups.empty")}
            </div>
          )}
          {items?.map((b) => (
            <BackupRow key={b.backupPath} backup={b} />
          ))}
        </div>
      </div>
    </div>
  );
}

function BackupRow({ backup }: { backup: CcBackup }) {
  const { t } = useTranslation("ccConfig");
  // Heuristic restore: rename the backup back to the active path. We don't
  // shell out from the dashboard for this (too risky to silently overwrite
  // a current active version) - show the user a copyable mv command instead.
  const restoreCmd = `mv ${shellEscape(backup.backupPath)} ${shellEscape(deriveActivePath(backup))}`;
  return (
    <div className="rounded-lg border border-border bg-surface-2 px-3 py-2.5">
      <div className="flex items-center gap-2 flex-wrap">
        <ScopeBadge scope={backup.scope} />
        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-surface-3 text-gray-400 border border-border">
          {backup.type}
        </span>
        <span className="font-mono text-xs text-gray-100 truncate flex-1 min-w-0">
          {backup.name}
        </span>
        <span className="text-[10px] text-gray-500">{new Date(backup.mtime).toLocaleString()}</span>
        {backup.size != null && (
          <span className="text-[10px] text-gray-600">{formatBytes(backup.size)}</span>
        )}
      </div>
      <div className="mt-1.5 font-mono text-[10px] text-gray-600 truncate">{backup.backupPath}</div>
      <div className="mt-2">
        <div className="text-[10px] text-gray-500 mb-1">{t("backups.restoreHint")}</div>
        <CommandSnippet command={restoreCmd} />
      </div>
    </div>
  );
}

// Best-effort: derive the active path the backup would restore to. We strip
// the trailing `.<ISO>.bak` segment from the basename and put the result back
// under the right active subdir. If the format doesn't match, fall back to
// "(unknown)" - the user can still copy the backup path itself.
function deriveActivePath(b: CcBackup): string {
  // Strip ".<ISO>.bak" suffix from the basename.
  const m = b.name.match(/^(.+?)\.[^.]+\.bak$/);
  const baseName = m ? m[1] : b.name;
  const backupDir = b.backupPath.replace(/\/[^/]+$/, ""); // dirname
  // Backups live at <root>/cc-config-backups/<type>/<name>.<ts>.bak
  // Active lives at <root>/<type>/<baseName> (or .../skills/<baseName>/SKILL.md handled at use-time)
  const rootMatch = backupDir.match(/^(.*)\/cc-config-backups\/([^/]+)$/);
  if (rootMatch) {
    const root = rootMatch[1];
    const type = rootMatch[2];
    return `${root}/${type}/${baseName}`;
  }
  // memory backups live at <projectRoot>/.cc-config-backups/memory/<name>.<ts>.bak
  const memMatch = backupDir.match(/^(.*)\/\.cc-config-backups\/memory$/);
  if (memMatch) return `${memMatch[1]}/${baseName}`;
  // auto-memory backups live at <memoryDir>/.cc-config-backups/auto-memory/<name>.<ts>.bak
  const autoMatch = backupDir.match(/^(.*)\/\.cc-config-backups\/auto-memory$/);
  if (autoMatch) return `${autoMatch[1]}/${baseName}`;
  return "<active path>";
}

// Quote for POSIX shells: wrap in single quotes, escape any embedded single quotes.
function shellEscape(s: string): string {
  if (/^[A-Za-z0-9_/.@:=+,-]+$/.test(s)) return s;
  return `'${s.replace(/'/g, `'\\''`)}'`;
}
