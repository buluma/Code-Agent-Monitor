/**
 * @file Memory tab: primary CLAUDE.md (user/project, editable) plus the
 * per-project auto-memory index/fact-file browser with cross-linked
 * "jump to fact" navigation. Extracted out of CcConfig.tsx — see SHA-167 —
 * no behavior change.
 * @author Michael Buluma <1452922+buluma@users.noreply.github.com>
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  BookOpen,
  ChevronDown,
  ExternalLink,
  FileText,
  FolderTree,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import type { CcArtifactType, CcMemoryItem } from "../../lib/api";
import { SkeletonRows, ScopeBadge, formatBytes } from "./Widgets";

// ── Memory ────────────────────────────────────────────────────────────

interface MemoryPanelProps {
  items: CcMemoryItem[] | null;
  search: string;
  onOpen: (p: string) => void;
  onEdit: (
    type: CcArtifactType,
    item: { scope: "user" | "project"; name: string; filePath: string }
  ) => void;
  onDelete: (
    type: CcArtifactType,
    scope: "user" | "project",
    name: string | undefined,
    path: string
  ) => void;
  onCreate: (scope: "user" | "project") => void;
  onEditAuto: (item: CcMemoryItem) => void;
  onDeleteAuto: (item: CcMemoryItem) => void;
  onCreateAuto: (project: string) => void;
}

// Strip a leading markdown heading then take a short snippet — used when a
// per-fact memory file has no frontmatter description.
function memoryDescription(m: CcMemoryItem): string {
  return (
    m.frontmatter?.description ||
    m.preview
      .replace(/^#+\s.*\n/, "")
      .trim()
      .slice(0, 200)
  );
}

// Reduce a markdown link target (as written inside MEMORY.md, e.g.
// `./feedback_x.md#section` or `feedback_x.md`) to the bare filename we can
// match against a fact file's `name`. Tolerant of URL-encoding and anchors.
function normalizeMemoryTarget(target: string): string {
  let v = target.trim();
  const hash = v.indexOf("#");
  if (hash >= 0) v = v.slice(0, hash);
  try {
    v = decodeURIComponent(v);
  } catch {
    /* leave as-is when not valid percent-encoding */
  }
  const slash = v.lastIndexOf("/");
  if (slash >= 0) v = v.slice(slash + 1);
  return v.trim();
}

// Render a MEMORY.md preview with its `[label](target.md)` markdown links
// turned into clickable buttons. Everything else is emitted verbatim so the
// surrounding <pre> keeps the original index layout. Clicking a link asks the
// parent to jump to (scroll + highlight) the matching fact file.
function renderMemoryIndex(
  preview: string,
  onJump: (target: string) => void,
  jumpTitle: string
): React.ReactNode {
  const linkRe = /\[([^\]]+)\]\(([^)]+)\)/g;
  const lines = preview.split("\n");
  return lines.map((line, li) => {
    const parts: React.ReactNode[] = [];
    let last = 0;
    let m: RegExpExecArray | null;
    linkRe.lastIndex = 0;
    while ((m = linkRe.exec(line)) !== null) {
      const full = m[0];
      const label = m[1] ?? "";
      const capturedTarget = m[2] ?? "";
      if (m.index > last) parts.push(line.slice(last, m.index));
      parts.push(
        <button
          key={`${li}-${m.index}`}
          type="button"
          onClick={() => onJump(capturedTarget)}
          title={`${jumpTitle}: ${normalizeMemoryTarget(capturedTarget)}`}
          className="text-teal-300 hover:text-teal-200 underline decoration-dotted underline-offset-2 hover:decoration-solid focus:outline-none focus:ring-1 focus:ring-teal-400/60 rounded-sm"
        >
          {label}
        </button>
      );
      last = m.index + full.length;
    }
    if (last < line.length) parts.push(line.slice(last));
    return (
      <span key={li}>
        {parts.length ? parts : line}
        {li < lines.length - 1 ? "\n" : null}
      </span>
    );
  });
}

export function MemoryPanel({
  items,
  search,
  onOpen,
  onEdit,
  onDelete,
  onCreate,
  onEditAuto,
  onDeleteAuto,
  onCreateAuto,
}: MemoryPanelProps) {
  const { t } = useTranslation("ccConfig");

  const q = search.trim().toLowerCase();

  const { primary, autoFiltered, groups, missingScopes } = useMemo(() => {
    const list = items ?? [];
    const primaryItems = list.filter(
      (m): m is CcMemoryItem & { scope: "user" | "project" } =>
        m.scope === "user" || m.scope === "project"
    );
    const autoItems = list.filter((m) => m.scope === "auto-memory");

    const matchesAuto = (m: CcMemoryItem) => {
      if (!q) return true;
      const blob = [m.name, m.project, m.frontmatter?.description, m.frontmatter?.name, m.preview]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return blob.includes(q);
    };

    // Search applies to the whole tab — match the CLAUDE.md cards on their
    // scope label, path, and body too so the filter is consistent.
    const primaryFilteredItems = primaryItems.filter((m) => {
      if (!q) return true;
      return [m.scope, m.file, m.preview].join(" ").toLowerCase().includes(q);
    });

    const filtered = autoItems.filter(matchesAuto);

    // Group surviving auto-memory files by their project dir.
    const byProject = new Map<string, CcMemoryItem[]>();
    for (const m of filtered) {
      const key = m.project || "(unknown)";
      if (!byProject.has(key)) byProject.set(key, []);
      byProject.get(key)!.push(m);
    }
    const grouped = [...byProject.entries()].sort((a, b) => a[0].localeCompare(b[0]));

    const present = new Set(primaryItems.map((m) => m.scope));
    const missing = (["user", "project"] as const).filter((s) => !present.has(s));

    return {
      primary: primaryFilteredItems,
      autoFiltered: filtered,
      groups: grouped,
      missingScopes: missing,
    };
  }, [items, q]);

  if (!items) return <SkeletonRows n={2} />;

  const totalAuto = items.filter((m) => m.scope === "auto-memory").length;
  // The "create missing CLAUDE.md" prompts only make sense when not filtering.
  const showMissing = !q;

  return (
    <div className="space-y-3">
      {/* Primary CLAUDE.md memory (user + project) — editable */}
      {primary.map((m) => (
        <div key={m.scope} className="rounded-lg border border-border bg-surface-2">
          <div className="border-b border-border px-4 py-2.5 flex items-center gap-2 flex-wrap">
            <ScopeBadge scope={m.scope} />
            <span className="font-mono text-[11px] text-gray-500 truncate flex-1 min-w-0">
              {m.file}
            </span>
            <span className="text-[10px] text-gray-600">{formatBytes(m.size)}</span>
            <button
              onClick={() => onOpen(m.file)}
              className="text-[11px] font-medium px-2 py-1 rounded-md border border-border bg-surface-1 hover:bg-surface-3 text-gray-300 hover:text-gray-100 inline-flex items-center gap-1.5"
            >
              <ExternalLink className="w-3 h-3" />
              {t("common.viewSource")}
            </button>
            <button
              onClick={() => onEdit("memory", { scope: m.scope, name: "", filePath: m.file })}
              className="text-[11px] font-medium px-2 py-1 rounded-md border border-border bg-surface-1 hover:bg-surface-3 text-gray-300 hover:text-gray-100 inline-flex items-center gap-1.5"
            >
              <Pencil className="w-3 h-3" />
              {t("edit.editButton")}
            </button>
            <button
              onClick={() => onDelete("memory", m.scope, undefined, m.file)}
              className="text-[11px] font-medium px-2 py-1 rounded-md border border-red-500/30 bg-red-500/5 hover:bg-red-500/15 text-red-300 inline-flex items-center gap-1.5"
            >
              <Trash2 className="w-3 h-3" />
              {t("edit.deleteButton")}
            </button>
          </div>
          <pre className="p-3 text-[11px] font-mono text-gray-300 whitespace-pre-wrap break-words max-h-72 overflow-auto">
            {m.preview}
            {m.truncated && (
              <span className="text-gray-600 italic">
                {"\n\n"}
                {t("common.truncated")}
              </span>
            )}
          </pre>
        </div>
      ))}

      {showMissing &&
        missingScopes.map((s) => (
          <div
            key={`missing-${s}`}
            className="rounded-lg border border-dashed border-border bg-surface-2 px-4 py-4 flex items-center justify-between gap-3"
          >
            <div className="flex items-center gap-2">
              <ScopeBadge scope={s} />
              <span className="text-xs text-gray-500">{t("memory.missing")}</span>
            </div>
            <button
              onClick={() => onCreate(s)}
              className="text-[11px] font-medium px-2.5 py-1 rounded-md border border-accent/30 bg-accent/10 hover:bg-accent/20 text-accent inline-flex items-center gap-1.5"
            >
              <Plus className="w-3 h-3" />
              {t("edit.newButton")}
            </button>
          </div>
        ))}

      {/* Per-project file-based memory (~/.claude/projects/<slug>/memory/) */}
      {totalAuto > 0 && (
        <section className="pt-1">
          <div className="flex items-center gap-2 mb-1">
            <BookOpen className="w-3.5 h-3.5 text-teal-300" />
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">
              {t("memory.autoTitle")}
            </h3>
            <span className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold bg-surface-3 text-gray-400">
              {q ? `${autoFiltered.length}/${totalAuto}` : totalAuto}
            </span>
          </div>
          <p className="text-[11px] text-gray-500 mb-2.5 leading-relaxed">
            {t("memory.autoSubtitle")}
          </p>

          {groups.length === 0 ? (
            <div className="rounded-lg border border-border bg-surface-2 px-4 py-6 text-center text-sm text-gray-500">
              {t("memory.noMatches")}
            </div>
          ) : (
            <div className="space-y-2">
              {groups.map(([project, files]) => (
                <MemoryProjectGroup
                  key={project}
                  project={project}
                  files={files}
                  onOpen={onOpen}
                  onEditAuto={onEditAuto}
                  onDeleteAuto={onDeleteAuto}
                  onCreateAuto={onCreateAuto}
                  defaultOpen={!!q || groups.length === 1}
                />
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

interface MemoryProjectGroupProps {
  project: string;
  files: CcMemoryItem[];
  onOpen: (p: string) => void;
  onEditAuto: (item: CcMemoryItem) => void;
  onDeleteAuto: (item: CcMemoryItem) => void;
  onCreateAuto: (project: string) => void;
  defaultOpen: boolean;
}

function MemoryProjectGroup({
  project,
  files,
  onOpen,
  onEditAuto,
  onDeleteAuto,
  onCreateAuto,
  defaultOpen,
}: MemoryProjectGroupProps) {
  const { t } = useTranslation("ccConfig");
  const [open, setOpen] = useState(defaultOpen);
  // Re-sync when the search-driven default flips (expand on search, collapse
  // when cleared). User toggles within a stable search state are preserved.
  useEffect(() => {
    setOpen(defaultOpen);
  }, [defaultOpen]);

  const indexFiles = files.filter((f) => f.isIndex);
  const factFiles = files.filter((f) => !f.isIndex);

  // Wiring for "click an index entry → jump to its fact file". Fact rows
  // register their DOM node keyed by filename; the index links look them up.
  const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (highlightTimer.current) clearTimeout(highlightTimer.current);
    },
    []
  );

  const rowKey = useCallback((m: CcMemoryItem) => m.name || normalizeMemoryTarget(m.file), []);

  const handleJump = useCallback(
    (target: string) => {
      const name = normalizeMemoryTarget(target);
      const el = rowRefs.current.get(name);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        setHighlighted(name);
        if (highlightTimer.current) clearTimeout(highlightTimer.current);
        highlightTimer.current = setTimeout(() => setHighlighted(null), 2200);
        return;
      }
      // Target isn't currently in view (e.g. filtered out by search) — open the
      // underlying file directly if we can resolve it within this project.
      const match = files.find((f) => (f.name || normalizeMemoryTarget(f.file)) === name);
      if (match) onOpen(match.file);
    },
    [files, onOpen]
  );

  return (
    <div className="rounded-lg border border-border bg-surface-2 overflow-hidden">
      <div className="flex items-center gap-1 pr-2 hover:bg-surface-3 transition-colors">
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-2 px-3 py-2.5 text-left flex-1 min-w-0"
        >
          <ChevronDown
            className={`w-3.5 h-3.5 text-gray-500 flex-shrink-0 transition-transform ${
              open ? "" : "-rotate-90"
            }`}
          />
          <FolderTree className="w-3.5 h-3.5 text-teal-300 flex-shrink-0" />
          <span className="font-mono text-xs text-gray-200 truncate flex-1 min-w-0">{project}</span>
          <span className="text-[10px] text-gray-500 flex-shrink-0">
            {t("memory.fileCount", { count: files.length })}
          </span>
        </button>
        <button
          onClick={() => onCreateAuto(project)}
          title={t("memory.newFile")}
          className="text-[10px] font-medium px-1.5 py-0.5 rounded border border-accent/30 bg-accent/10 hover:bg-accent/20 text-accent inline-flex items-center gap-1 flex-shrink-0"
        >
          <Plus className="w-2.5 h-2.5" />
          {t("memory.newFile")}
        </button>
      </div>

      {open && (
        <div className="border-t border-border p-2.5 space-y-2.5">
          {indexFiles.length > 0 && (
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-1.5 px-1">
                {t("memory.indexFiles")}
              </div>
              <div className="space-y-1.5">
                {indexFiles.map((m) => (
                  <MemoryIndexCard
                    key={m.file}
                    item={m}
                    onOpen={onOpen}
                    onEditAuto={onEditAuto}
                    onDeleteAuto={onDeleteAuto}
                    onJump={handleJump}
                  />
                ))}
              </div>
            </div>
          )}
          {factFiles.length > 0 && (
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-1.5 px-1">
                {t("memory.factFiles", { count: factFiles.length })}
              </div>
              <div className="space-y-1">
                {factFiles.map((m) => {
                  const key = rowKey(m);
                  return (
                    <MemoryFactRow
                      key={m.file}
                      item={m}
                      onOpen={onOpen}
                      onEditAuto={onEditAuto}
                      onDeleteAuto={onDeleteAuto}
                      highlighted={highlighted === key}
                      rowRef={(el) => {
                        if (el) rowRefs.current.set(key, el);
                        else rowRefs.current.delete(key);
                      }}
                    />
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface MemoryAutoItemProps {
  item: CcMemoryItem;
  onOpen: (p: string) => void;
  onEditAuto: (item: CcMemoryItem) => void;
  onDeleteAuto: (item: CcMemoryItem) => void;
}

// Compact View / Edit / Delete button cluster shared by index + fact rows.
function MemoryAutoActions({ item, onOpen, onEditAuto, onDeleteAuto }: MemoryAutoItemProps) {
  const { t } = useTranslation("ccConfig");
  return (
    <div className="flex items-center gap-1 flex-shrink-0">
      <button
        onClick={() => onOpen(item.file)}
        title={t("common.viewSource")}
        className="text-[10px] font-medium px-1.5 py-0.5 rounded border border-border bg-surface-1 hover:bg-surface-3 text-gray-300 hover:text-gray-100 inline-flex items-center gap-1"
      >
        <ExternalLink className="w-2.5 h-2.5" />
      </button>
      <button
        onClick={() => onEditAuto(item)}
        title={t("edit.editButton")}
        className="text-[10px] font-medium px-1.5 py-0.5 rounded border border-border bg-surface-1 hover:bg-surface-3 text-gray-300 hover:text-gray-100 inline-flex items-center gap-1"
      >
        <Pencil className="w-2.5 h-2.5" />
      </button>
      <button
        onClick={() => onDeleteAuto(item)}
        title={t("edit.deleteButton")}
        className="text-[10px] font-medium px-1.5 py-0.5 rounded border border-red-500/30 bg-red-500/5 hover:bg-red-500/15 text-red-300 inline-flex items-center gap-1"
      >
        <Trash2 className="w-2.5 h-2.5" />
      </button>
    </div>
  );
}

function MemoryIndexCard({
  item,
  onOpen,
  onEditAuto,
  onDeleteAuto,
  onJump,
}: MemoryAutoItemProps & { onJump: (target: string) => void }) {
  const { t } = useTranslation("ccConfig");
  return (
    <div className="rounded-md border border-teal-500/20 bg-teal-500/5">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-teal-500/15">
        <BookOpen className="w-3 h-3 text-teal-300 flex-shrink-0" />
        <span className="font-mono text-[11px] text-gray-200 truncate flex-1 min-w-0">
          {item.name}
        </span>
        <span className="text-[10px] text-gray-600">{formatBytes(item.size)}</span>
        <MemoryAutoActions
          item={item}
          onOpen={onOpen}
          onEditAuto={onEditAuto}
          onDeleteAuto={onDeleteAuto}
        />
      </div>
      <pre className="px-3 py-2 text-[10.5px] font-mono text-gray-400 whitespace-pre-wrap break-words max-h-40 overflow-auto">
        {renderMemoryIndex(item.preview, onJump, t("memory.jumpTo"))}
        {item.truncated && <span className="text-gray-600 italic">{"\n…"}</span>}
      </pre>
    </div>
  );
}

function MemoryFactRow({
  item,
  onOpen,
  onEditAuto,
  onDeleteAuto,
  highlighted,
  rowRef,
}: MemoryAutoItemProps & {
  highlighted?: boolean;
  rowRef?: (el: HTMLDivElement | null) => void;
}) {
  const desc = memoryDescription(item);
  return (
    <div
      ref={rowRef}
      className={`flex items-start gap-2.5 rounded-md border px-3 py-2 transition-colors ${
        highlighted
          ? "border-teal-400/70 bg-teal-500/10 ring-1 ring-teal-400/50"
          : "border-border bg-surface-1 hover:border-border/80"
      }`}
    >
      <FileText className="w-3 h-3 text-gray-500 flex-shrink-0 mt-0.5" />
      <div className="min-w-0 flex-1">
        <span className="font-mono text-[11px] text-gray-200 truncate block">{item.name}</span>
        {desc && (
          <p className="mt-0.5 text-[11px] text-gray-500 leading-snug line-clamp-2">{desc}</p>
        )}
      </div>
      <span className="text-[10px] text-gray-600 flex-shrink-0 mt-0.5">
        {formatBytes(item.size)}
      </span>
      <div className="mt-0.5">
        <MemoryAutoActions
          item={item}
          onOpen={onOpen}
          onEditAuto={onEditAuto}
          onDeleteAuto={onDeleteAuto}
        />
      </div>
    </div>
  );
}
