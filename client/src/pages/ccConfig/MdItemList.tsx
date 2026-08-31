/**
 * @file Generic markdown-artifact list + card, shared by the skills, agents,
 * commands, and output-styles tabs. Extracted out of CcConfig.tsx — see
 * SHA-167 — no behavior change.
 * @author Michael Buluma <1452922+buluma@users.noreply.github.com>
 */

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ExternalLink, Pencil, Trash2 } from "lucide-react";
import type { CcArtifactType, CcMdItem } from "../../lib/api";
import { SkeletonRows, Empty, ScopeBadge } from "./Widgets";

// ── MD-item generic list (skills/agents/commands/output-styles) ───────

interface MdItemListProps {
  items: CcMdItem[] | null;
  search: string;
  onOpen: (path: string) => void;
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
  kind: "skills" | "agents" | "commands" | "outputStyles";
}

export function MdItemList({ items, search, onOpen, onEdit, onDelete, kind }: MdItemListProps) {
  const filtered = useMemo(() => {
    if (!items) return null;
    const q = search.toLowerCase();
    return items.filter((it) => {
      if (!q) return true;
      const blob = [it.name, it.frontmatter.description, it.frontmatter.name]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return blob.includes(q);
    });
  }, [items, search]);

  if (!filtered) return <SkeletonRows n={6} />;
  if (filtered.length === 0) return <Empty />;

  return (
    <div className="space-y-2">
      {filtered.map((it) => (
        <MdItemCard
          key={`${it.scope}:${it.name}`}
          item={it}
          onOpen={onOpen}
          onEdit={onEdit}
          onDelete={onDelete}
          kind={kind}
        />
      ))}
    </div>
  );
}

interface MdItemCardProps {
  item: CcMdItem;
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
  kind: "skills" | "agents" | "commands" | "outputStyles";
}

function MdItemCard({ item, onOpen, onEdit, onDelete, kind }: MdItemCardProps) {
  const { t } = useTranslation("ccConfig");
  const artifactType: CcArtifactType = kind === "outputStyles" ? "output-styles" : kind;

  const filePath = item.file || `${item.path}/SKILL.md`;
  const description =
    item.frontmatter.description ||
    item.preview
      .replace(/^#+\s.*\n/, "")
      .trim()
      .slice(0, 200);
  return (
    <div className="rounded-lg border border-border bg-surface-2 px-4 py-3 hover:border-border/80 transition-colors">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm text-gray-100 truncate">{item.name}</span>
            <ScopeBadge scope={item.scope} />
            {item.frontmatter.model && (
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-accent/10 text-accent border border-accent/20">
                {item.frontmatter.model}
              </span>
            )}
          </div>
          {description && (
            <p className="mt-1.5 text-xs text-gray-400 leading-relaxed line-clamp-2">
              {description}
            </p>
          )}
          {kind === "agents" && item.frontmatter.tools && (
            <div className="mt-2 text-[11px] text-gray-500">
              <span className="text-gray-500">{t("agents.tools")}:</span>{" "}
              <span className="font-mono text-gray-400">{item.frontmatter.tools}</span>
            </div>
          )}
          <div className="mt-2 font-mono text-[10px] text-gray-600 truncate">{filePath}</div>
        </div>
        <div className="flex flex-col gap-1.5 flex-shrink-0">
          <button
            onClick={() => onOpen(filePath)}
            className="text-[11px] font-medium px-2 py-1 rounded-md border border-border bg-surface-1 hover:bg-surface-3 text-gray-300 hover:text-gray-100 inline-flex items-center gap-1.5"
          >
            <ExternalLink className="w-3 h-3" />
            {t("common.viewSource")}
          </button>
          <button
            onClick={() => onEdit(artifactType, { scope: item.scope, name: item.name, filePath })}
            className="text-[11px] font-medium px-2 py-1 rounded-md border border-border bg-surface-1 hover:bg-surface-3 text-gray-300 hover:text-gray-100 inline-flex items-center gap-1.5"
          >
            <Pencil className="w-3 h-3" />
            {t("edit.editButton")}
          </button>
          <button
            onClick={() => onDelete(artifactType, item.scope, item.name, filePath)}
            className="text-[11px] font-medium px-2 py-1 rounded-md border border-red-500/30 bg-red-500/5 hover:bg-red-500/15 text-red-300 inline-flex items-center gap-1.5"
          >
            <Trash2 className="w-3 h-3" />
            {t("edit.deleteButton")}
          </button>
        </div>
      </div>
    </div>
  );
}
