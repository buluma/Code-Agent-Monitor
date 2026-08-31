/**
 * @file Keybindings tab: read-only binding listing plus a full inline editor
 * (add/remove contexts and bindings, client-side validation mirroring the
 * server, save via the keybindings write endpoint). Extracted out of
 * CcConfig.tsx — see SHA-167 — no behavior change.
 * @author Michael Buluma <1452922+buluma@users.noreply.github.com>
 */

import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertCircle, ExternalLink, FileText, Pencil, Plus, Save, Trash2 } from "lucide-react";
import { api } from "../../lib/api";
import type { CcKeybindingGroup, CcKeybindings } from "../../lib/api";
import type { Toast } from "./types";
import { SkeletonRows } from "./Widgets";

// ── Keybindings ───────────────────────────────────────────────────────

export function KeybindingsPanel({
  data,
  search,
  onSaved,
  onToast,
}: {
  data: CcKeybindings | null;
  search: string;
  onSaved: () => void;
  onToast: (toast: NonNullable<Toast>) => void;
}) {
  const { t } = useTranslation("ccConfig");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<CcKeybindingGroup[]>([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const startEdit = useCallback(() => {
    const groups = data?.groups ?? [];
    // Deep clone so edits never mutate the fetched data.
    setDraft(
      groups.map((g) => ({ context: g.context, bindings: g.bindings.map((b) => ({ ...b })) }))
    );
    setErr(null);
    setEditing(true);
  }, [data]);

  const cancelEdit = useCallback(() => {
    setEditing(false);
    setDraft([]);
    setErr(null);
  }, []);

  const updateContext = (gi: number, value: string) =>
    setDraft((d) => d.map((g, i) => (i === gi ? { ...g, context: value } : g)));
  const removeContext = (gi: number) => setDraft((d) => d.filter((_, i) => i !== gi));
  const addContext = () =>
    setDraft((d) => [...d, { context: "", bindings: [{ key: "", action: "" }] }]);
  const updateBinding = (gi: number, bi: number, field: "key" | "action", value: string) =>
    setDraft((d) =>
      d.map((g, i) =>
        i === gi
          ? { ...g, bindings: g.bindings.map((b, j) => (j === bi ? { ...b, [field]: value } : b)) }
          : g
      )
    );
  const removeBinding = (gi: number, bi: number) =>
    setDraft((d) =>
      d.map((g, i) => (i === gi ? { ...g, bindings: g.bindings.filter((_, j) => j !== bi) } : g))
    );
  const addBinding = (gi: number) =>
    setDraft((d) =>
      d.map((g, i) => (i === gi ? { ...g, bindings: [...g.bindings, { key: "", action: "" }] } : g))
    );

  const handleSave = useCallback(async () => {
    const groups: CcKeybindingGroup[] = draft.map((g) => ({
      context: g.context.trim(),
      bindings: g.bindings.map((b) => ({ key: b.key.trim(), action: b.action.trim() })),
    }));
    // Mirror the server-side validation so users get instant, local feedback.
    const seen = new Set<string>();
    for (const g of groups) {
      if (!g.context) return setErr(t("keybindings.errContext"));
      if (seen.has(g.context))
        return setErr(t("keybindings.errDupContext", { context: g.context }));
      seen.add(g.context);
      const keys = new Set<string>();
      for (const b of g.bindings) {
        if (!b.key || !b.action) return setErr(t("keybindings.errEmpty", { context: g.context }));
        if (keys.has(b.key))
          return setErr(t("keybindings.errDupKey", { key: b.key, context: g.context }));
        keys.add(b.key);
      }
    }
    setSaving(true);
    setErr(null);
    try {
      const result = await api.ccConfig.writeKeybindings(groups);
      onToast({
        kind: "success",
        message: result.created
          ? t("edit.saveSuccessNew")
          : t("edit.saveSuccess", { path: result.backupPath || "-" }),
      });
      setEditing(false);
      setDraft([]);
      onSaved();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "unknown error";
      setErr(msg);
      onToast({ kind: "error", message: t("edit.writeError", { message: msg }) });
    } finally {
      setSaving(false);
    }
  }, [draft, onSaved, onToast, t]);

  if (!data) return <SkeletonRows n={3} />;

  const headerBar = (
    <div className="rounded-lg border border-border bg-surface-2 px-3 py-2 flex items-center gap-2 text-[11px] text-gray-500 flex-wrap">
      <FileText className="w-3.5 h-3.5" />
      <span className="font-mono truncate flex-1 min-w-0">{data.file}</span>
      {data.docs && (
        <a
          href={data.docs}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[11px] text-accent hover:underline inline-flex items-center gap-1"
        >
          <ExternalLink className="w-3 h-3" />
          {t("keybindings.docsLink")}
        </a>
      )}
      {editing ? (
        <div className="inline-flex items-center gap-1.5">
          <button
            type="button"
            onClick={cancelEdit}
            disabled={saving}
            className="h-7 text-[11px] font-medium px-2.5 rounded-md border border-border bg-surface-3 hover:bg-surface-1 text-gray-300 disabled:opacity-50"
          >
            {t("edit.cancel")}
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="h-7 text-[11px] font-medium px-2.5 rounded-md border border-accent/30 bg-accent/10 hover:bg-accent/20 text-accent inline-flex items-center gap-1.5 disabled:opacity-50"
          >
            <Save className="w-3 h-3" />
            {saving ? t("edit.saving") : t("edit.save")}
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={startEdit}
          className="h-7 text-[11px] font-medium px-2.5 rounded-md border border-accent/30 bg-accent/10 hover:bg-accent/20 text-accent inline-flex items-center gap-1.5"
        >
          <Pencil className="w-3 h-3" />
          {t("edit.editButton")}
        </button>
      )}
    </div>
  );

  // ── Edit mode ────────────────────────────────────────────────────────
  if (editing) {
    return (
      <div className="space-y-3">
        {headerBar}
        {err && (
          <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-[11px] text-red-200 flex items-center gap-2">
            <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
            <span>{err}</span>
          </div>
        )}
        {draft.map((g, gi) => (
          <div key={gi} className="rounded-lg border border-border bg-surface-2">
            <div className="border-b border-border px-3 py-2 flex items-center gap-2">
              <span className="text-[11px] text-gray-500 flex-shrink-0">
                {t("keybindings.context")}
              </span>
              <input
                value={g.context}
                onChange={(e) => updateContext(gi, e.target.value)}
                placeholder={t("keybindings.contextPlaceholder")}
                className="h-7 flex-1 min-w-0 bg-surface-1 border border-border rounded px-2 text-[11px] font-mono text-gray-100 focus:outline-none focus:ring-1 focus:ring-accent/40"
              />
              <button
                type="button"
                onClick={() => removeContext(gi)}
                title={t("keybindings.removeContext")}
                aria-label={t("keybindings.removeContext")}
                className="h-7 w-7 flex-shrink-0 inline-flex items-center justify-center rounded-md text-gray-500 hover:text-red-300 hover:bg-red-500/10"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="divide-y divide-border">
              {g.bindings.map((b, bi) => (
                <div key={bi} className="px-3 py-1.5 flex items-center gap-2">
                  <input
                    value={b.key}
                    onChange={(e) => updateBinding(gi, bi, "key", e.target.value)}
                    placeholder={t("keybindings.key")}
                    className="h-7 w-40 flex-shrink-0 bg-surface-1 border border-border rounded px-2 text-[11px] font-mono text-gray-100 focus:outline-none focus:ring-1 focus:ring-accent/40"
                  />
                  <span className="text-gray-600 flex-shrink-0">→</span>
                  <input
                    value={b.action}
                    onChange={(e) => updateBinding(gi, bi, "action", e.target.value)}
                    placeholder={t("keybindings.action")}
                    className="h-7 flex-1 min-w-0 bg-surface-1 border border-border rounded px-2 text-[11px] font-mono text-gray-100 focus:outline-none focus:ring-1 focus:ring-accent/40"
                  />
                  <button
                    type="button"
                    onClick={() => removeBinding(gi, bi)}
                    title={t("keybindings.removeBinding")}
                    aria-label={t("keybindings.removeBinding")}
                    className="h-7 w-7 flex-shrink-0 inline-flex items-center justify-center rounded-md text-gray-500 hover:text-red-300 hover:bg-red-500/10"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
              <div className="px-3 py-1.5">
                <button
                  type="button"
                  onClick={() => addBinding(gi)}
                  className="h-7 text-[11px] font-medium px-2.5 rounded-md border border-border bg-surface-3 hover:bg-surface-1 text-gray-300 inline-flex items-center gap-1.5"
                >
                  <Plus className="w-3 h-3" />
                  {t("keybindings.addBinding")}
                </button>
              </div>
            </div>
          </div>
        ))}
        <button
          type="button"
          onClick={addContext}
          className="h-8 w-full text-[11px] font-medium rounded-md border border-dashed border-border bg-surface-2 hover:bg-surface-3 text-gray-400 inline-flex items-center justify-center gap-1.5"
        >
          <Plus className="w-3 h-3" />
          {t("keybindings.addContext")}
        </button>
      </div>
    );
  }

  // ── Read-only mode ───────────────────────────────────────────────────
  if (!data.exists) {
    return (
      <div className="space-y-3">
        {headerBar}
        <div className="rounded-lg border border-border bg-surface-2 px-4 py-6 text-center text-sm text-gray-500">
          {t("keybindings.missing", { path: data.file })}
        </div>
      </div>
    );
  }
  const q = search.toLowerCase();
  return (
    <div className="space-y-3">
      {headerBar}
      {data.groups.map((g) => {
        const filtered = g.bindings.filter(
          (b) =>
            !q ||
            b.key.toLowerCase().includes(q) ||
            b.action.toLowerCase().includes(q) ||
            g.context.toLowerCase().includes(q)
        );
        if (filtered.length === 0) return null;
        return (
          <div key={g.context} className="rounded-lg border border-border bg-surface-2">
            <div className="border-b border-border px-4 py-2 text-xs font-medium text-gray-300">
              {t("keybindings.context")}: <span className="text-gray-100">{g.context}</span>
              <span className="ml-2 text-[10px] text-gray-600">({filtered.length})</span>
            </div>
            <div className="divide-y divide-border">
              {filtered.map((b) => (
                <div key={b.key} className="px-4 py-1.5 flex items-center gap-3">
                  <kbd className="font-mono text-[11px] px-1.5 py-0.5 rounded bg-surface-3 border border-border text-gray-200 min-w-20 text-center">
                    {b.key}
                  </kbd>
                  <span className="font-mono text-[11px] text-gray-400">{b.action}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
