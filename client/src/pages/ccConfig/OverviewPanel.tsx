/**
 * @file Overview tab: root-path rows plus a color-coded summary-stat grid
 * that deep-links into each other tab. Extracted out of CcConfig.tsx — see
 * SHA-167 — no behavior change.
 * @author Michael Buluma <1452922+buluma@users.noreply.github.com>
 */

import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  BookOpen,
  FileText,
  FolderTree,
  Keyboard,
  Palette,
  PlugZap,
  Server,
  Settings as SettingsIcon,
  Slash,
  Sparkles,
  Store,
  UserRound,
  Webhook,
} from "lucide-react";
import type { CcOverview } from "../../lib/api";
import type { TabKey } from "./types";
import { SkeletonRows, CopyButton } from "./Widgets";

// ── Overview ──────────────────────────────────────────────────────────

// Tone palette - each tone is { iconBg, iconText, border, accentBar }.
// Used by both root rows and summary stat tiles for a consistent color story.
type Tone =
  | "sky"
  | "emerald"
  | "violet"
  | "amber"
  | "fuchsia"
  | "cyan"
  | "pink"
  | "indigo"
  | "orange"
  | "teal"
  | "slate"
  | "rose";
const TONES: Record<
  Tone,
  { iconBg: string; iconText: string; bar: string; ring: string; hoverBorder: string }
> = {
  sky: {
    iconBg: "bg-sky-500/10",
    iconText: "text-sky-300",
    bar: "bg-sky-500/40",
    ring: "ring-sky-500/20",
    hoverBorder: "hover:border-sky-500/35",
  },
  emerald: {
    iconBg: "bg-emerald-500/10",
    iconText: "text-emerald-300",
    bar: "bg-emerald-500/40",
    ring: "ring-emerald-500/20",
    hoverBorder: "hover:border-emerald-500/35",
  },
  violet: {
    iconBg: "bg-violet-500/10",
    iconText: "text-violet-300",
    bar: "bg-violet-500/40",
    ring: "ring-violet-500/20",
    hoverBorder: "hover:border-violet-500/35",
  },
  amber: {
    iconBg: "bg-amber-500/10",
    iconText: "text-amber-300",
    bar: "bg-amber-500/40",
    ring: "ring-amber-500/20",
    hoverBorder: "hover:border-amber-500/35",
  },
  fuchsia: {
    iconBg: "bg-fuchsia-500/10",
    iconText: "text-fuchsia-300",
    bar: "bg-fuchsia-500/40",
    ring: "ring-fuchsia-500/20",
    hoverBorder: "hover:border-fuchsia-500/35",
  },
  cyan: {
    iconBg: "bg-cyan-500/10",
    iconText: "text-cyan-300",
    bar: "bg-cyan-500/40",
    ring: "ring-cyan-500/20",
    hoverBorder: "hover:border-cyan-500/35",
  },
  pink: {
    iconBg: "bg-pink-500/10",
    iconText: "text-pink-300",
    bar: "bg-pink-500/40",
    ring: "ring-pink-500/20",
    hoverBorder: "hover:border-pink-500/35",
  },
  indigo: {
    iconBg: "bg-indigo-500/10",
    iconText: "text-indigo-300",
    bar: "bg-indigo-500/40",
    ring: "ring-indigo-500/20",
    hoverBorder: "hover:border-indigo-500/35",
  },
  orange: {
    iconBg: "bg-orange-500/10",
    iconText: "text-orange-300",
    bar: "bg-orange-500/40",
    ring: "ring-orange-500/20",
    hoverBorder: "hover:border-orange-500/35",
  },
  teal: {
    iconBg: "bg-teal-500/10",
    iconText: "text-teal-300",
    bar: "bg-teal-500/40",
    ring: "ring-teal-500/20",
    hoverBorder: "hover:border-teal-500/35",
  },
  slate: {
    iconBg: "bg-slate-500/10",
    iconText: "text-slate-300",
    bar: "bg-slate-500/40",
    ring: "ring-slate-500/20",
    hoverBorder: "hover:border-slate-500/35",
  },
  rose: {
    iconBg: "bg-rose-500/10",
    iconText: "text-rose-300",
    bar: "bg-rose-500/40",
    ring: "ring-rose-500/20",
    hoverBorder: "hover:border-rose-500/35",
  },
};

export function OverviewPanel({
  overview,
  onTabChange,
}: {
  overview: CcOverview | null;
  onTabChange: (tab: TabKey) => void;
}) {
  const { t } = useTranslation("ccConfig");
  const gotoTab = useCallback((nextTab: TabKey) => onTabChange(nextTab), [onTabChange]);
  if (!overview) return <SkeletonRows n={4} />;
  const { roots, counts } = overview;
  return (
    <div className="space-y-5">
      <section>
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 mb-2">
          {t("overview.rootsTitle")}
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <RootRow
            icon={FolderTree}
            tone="sky"
            label={t("overview.claudeHome")}
            value={roots.claudeHome}
          />
          <RootRow
            icon={FolderTree}
            tone="emerald"
            label={t("overview.projectClaudeDir")}
            value={roots.projectClaudeDir}
          />
          <RootRow
            icon={FolderTree}
            tone="violet"
            label={t("overview.projectRoot")}
            value={roots.projectRoot}
          />
          <RootRow
            icon={FileText}
            tone="amber"
            label={t("overview.claudeJson")}
            value={roots.claudeJson}
          />
        </div>
      </section>

      <section>
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 mb-2">
          {t("overview.summary")}
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2">
          <SummaryStat
            tone="fuchsia"
            icon={Sparkles}
            label={t("tabs.skills")}
            onClick={() => gotoTab("skills")}
            user={counts.skills.user}
            project={counts.skills.project}
          />
          <SummaryStat
            tone="sky"
            icon={UserRound}
            label={t("tabs.agents")}
            onClick={() => gotoTab("agents")}
            user={counts.agents.user}
            project={counts.agents.project}
          />
          <SummaryStat
            tone="cyan"
            icon={Slash}
            label={t("tabs.commands")}
            onClick={() => gotoTab("commands")}
            user={counts.commands.user}
            project={counts.commands.project}
          />
          <SummaryStat
            tone="pink"
            icon={Palette}
            label={t("tabs.outputStyles")}
            onClick={() => gotoTab("outputStyles")}
            user={counts.outputStyles.user}
            project={counts.outputStyles.project}
          />
          <SummaryStat
            tone="indigo"
            icon={Server}
            label={t("tabs.mcp")}
            onClick={() => gotoTab("mcp")}
            user={counts.mcpServers.user}
            project={counts.mcpServers.project}
          />
          <SummaryStat
            tone="emerald"
            icon={PlugZap}
            label={t("tabs.plugins")}
            onClick={() => gotoTab("plugins")}
            value={counts.plugins}
          />
          <SummaryStat
            tone="amber"
            icon={Store}
            label={t("tabs.marketplaces")}
            onClick={() => gotoTab("marketplaces")}
            value={counts.marketplaces}
          />
          <SummaryStat
            tone="orange"
            icon={Webhook}
            label={t("tabs.hooks")}
            onClick={() => gotoTab("hooks")}
            value={Object.values(counts.hooks).reduce((a, b) => a + b, 0)}
          />
          <SummaryStat
            tone="rose"
            icon={Keyboard}
            label={t("tabs.keybindings")}
            onClick={() => gotoTab("keybindings")}
            value={counts.keybindings}
          />
          <SummaryStat
            tone="slate"
            icon={SettingsIcon}
            label={t("tabs.settings")}
            onClick={() => gotoTab("settings")}
            value={counts.settingsFiles}
          />
          <SummaryStat
            tone="teal"
            icon={BookOpen}
            label={t("tabs.memory")}
            onClick={() => gotoTab("memory")}
            value={counts.memory}
          />
        </div>
      </section>
    </div>
  );
}

interface SummaryStatProps {
  tone: Tone;
  icon: typeof Sparkles;
  label: string;
  onClick?: () => void;
  // Either a single value, OR a user/project pair (which is summed for the headline number).
  value?: number;
  user?: number;
  project?: number;
}

function SummaryStat({ tone, icon: Icon, label, onClick, value, user, project }: SummaryStatProps) {
  const { t } = useTranslation("ccConfig");
  const T = TONES[tone];
  const total = value !== undefined ? value : (user ?? 0) + (project ?? 0);
  const showBreakdown = user !== undefined && project !== undefined;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group relative w-full text-left rounded-lg border border-border bg-surface-2 overflow-hidden transition-all ${
        onClick
          ? `cursor-pointer ${T.hoverBorder} hover:bg-surface-3 focus:outline-none focus-visible:ring-2 ${T.ring}`
          : "cursor-default"
      }`}
    >
      {/* Left accent bar */}
      <div className={`absolute left-0 top-0 bottom-0 w-1 ${T.bar}`} aria-hidden />
      <div className="pl-3.5 pr-3 py-2.5">
        <div className="flex items-center gap-2">
          <span
            className={`w-6 h-6 rounded-md ${T.iconBg} flex items-center justify-center flex-shrink-0 transition-transform ${
              onClick ? "group-hover:scale-105" : ""
            }`}
          >
            <Icon className={`w-3.5 h-3.5 ${T.iconText}`} />
          </span>
          <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 truncate">
            {label}
          </span>
        </div>
        <div className="mt-1.5 flex items-baseline gap-2">
          <span className="text-xl font-semibold text-gray-100 tabular-nums">{total}</span>
          {showBreakdown && (
            <span className="text-[10px] text-gray-500 truncate">
              {user} {t("overview.user")} · {project} {t("overview.project")}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

function RootRow({
  icon: Icon,
  tone,
  label,
  value,
}: {
  icon: typeof FolderTree;
  tone: Tone;
  label: string;
  value: string;
}) {
  const T = TONES[tone];
  return (
    <div className="relative flex items-center gap-2.5 rounded-lg border border-border bg-surface-2 px-3 py-2 min-w-0 overflow-hidden">
      <div className={`absolute left-0 top-0 bottom-0 w-1 ${T.bar}`} aria-hidden />
      <span
        className={`w-7 h-7 rounded-md ${T.iconBg} flex items-center justify-center flex-shrink-0 ml-1.5`}
      >
        <Icon className={`w-3.5 h-3.5 ${T.iconText}`} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
          {label}
        </div>
        <div className="font-mono text-[11px] text-gray-200 truncate">{value}</div>
      </div>
      <CopyButton value={value} />
    </div>
  );
}
