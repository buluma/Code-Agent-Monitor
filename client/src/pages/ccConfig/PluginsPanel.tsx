/**
 * @file Plugins tab: manifest path summary plus a card per installed plugin
 * (contributions, metadata, uninstall snippet). Extracted out of
 * CcConfig.tsx — see SHA-167 — no behavior change.
 * @author Michael Buluma <1452922+buluma@users.noreply.github.com>
 */

import { useTranslation } from "react-i18next";
import { AlertCircle, CircleDot, CircleSlash, FileText } from "lucide-react";
import type { CcPlugin, CcPluginsResponse } from "../../lib/api";
import {
  SkeletonRows,
  Empty,
  ScopeBadge,
  CopyButton,
  ExplainerBanner,
  CommandSnippet,
} from "./Widgets";

// ── Plugins ───────────────────────────────────────────────────────────

export function PluginsPanel({ data, search }: { data: CcPluginsResponse | null; search: string }) {
  const { t } = useTranslation("ccConfig");
  if (!data) return <SkeletonRows n={4} />;
  const filtered = data.plugins.filter(
    (p) => !search || p.key.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-3">
      <ExplainerBanner
        title={t("explain.plugins.title")}
        body={t("explain.plugins.body")}
        howTo={t("explain.plugins.install")}
        commands={[{ cmd: t("explain.plugins.installCmd"), note: "" }]}
      />
      <div className="rounded-lg border border-border bg-surface-2 px-3 py-2 flex items-center gap-2 text-[11px] text-gray-500">
        <FileText className="w-3.5 h-3.5" />
        <span className="font-mono truncate">{data.manifestPath}</span>
        {!data.manifestExists && (
          <span className="ml-auto text-amber-400">
            {t("plugins.manifestMissing", { path: data.manifestPath })}
          </span>
        )}
      </div>
      {filtered.length === 0 ? (
        <Empty />
      ) : (
        filtered.map((p) => <PluginCard key={p.key} plugin={p} />)
      )}
    </div>
  );
}

function PluginCard({ plugin: p }: { plugin: CcPlugin }) {
  const { t } = useTranslation("ccConfig");
  const meta = p.contributes?.pluginJson;
  const description = meta?.description;
  const contribCounts: { key: string; count: number; label: string }[] = [];
  if (p.contributes) {
    if (p.contributes.skills > 0)
      contribCounts.push({
        key: "skills",
        count: p.contributes.skills,
        label: t("plugins.skills", { count: p.contributes.skills }),
      });
    if (p.contributes.agents > 0)
      contribCounts.push({
        key: "agents",
        count: p.contributes.agents,
        label: t("plugins.agents", { count: p.contributes.agents }),
      });
    if (p.contributes.commands > 0)
      contribCounts.push({
        key: "commands",
        count: p.contributes.commands,
        label: t("plugins.commands", { count: p.contributes.commands }),
      });
    if (p.contributes.outputStyles > 0)
      contribCounts.push({
        key: "outputStyles",
        count: p.contributes.outputStyles,
        label: t("plugins.outputStyles", { count: p.contributes.outputStyles }),
      });
    if (p.contributes.hooks > 0)
      contribCounts.push({
        key: "hooks",
        count: p.contributes.hooks,
        label: t("plugins.hooks", { count: p.contributes.hooks }),
      });
  }
  return (
    <div className="rounded-lg border border-border bg-surface-2 px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-sm text-gray-100">{p.name}</span>
            {p.marketplace && (
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-surface-3 text-gray-400 border border-border">
                {p.marketplace}
              </span>
            )}
            {p.version && (
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-accent/10 text-accent border border-accent/20">
                v{p.version}
              </span>
            )}
            <ScopeBadge scope={p.scope} />
            {p.enabled === true && (
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-300 border border-emerald-500/30 inline-flex items-center gap-1">
                <CircleDot className="w-3 h-3" />
                {t("plugins.enabled")}
              </span>
            )}
            {p.enabled === false && (
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-gray-500/10 text-gray-400 border border-gray-500/30 inline-flex items-center gap-1">
                <CircleSlash className="w-3 h-3" />
                {t("plugins.disabled")}
              </span>
            )}
            {!p.installPathExists && (
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-300 border border-amber-500/30 inline-flex items-center gap-1">
                <AlertCircle className="w-3 h-3" />
                {t("plugins.missing")}
              </span>
            )}
          </div>
          {description && (
            <p className="mt-1.5 text-xs text-gray-400 leading-relaxed">{description}</p>
          )}
          {contribCounts.length > 0 && (
            <div className="mt-2.5">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-1">
                {t("plugins.contributes")}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {contribCounts.map((c) => (
                  <span
                    key={c.key}
                    className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-surface-3 text-gray-300 border border-border"
                  >
                    {c.label}
                  </span>
                ))}
              </div>
            </div>
          )}
          <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-gray-500">
            {meta?.author?.name && (
              <div>
                <span className="text-gray-600">{t("plugins.author")}:</span> {meta.author.name}
              </div>
            )}
            {meta?.license && (
              <div>
                <span className="text-gray-600">{t("plugins.license")}:</span> {meta.license}
              </div>
            )}
            {p.installedAt && (
              <div>
                <span className="text-gray-600">{t("plugins.installedAt")}:</span>{" "}
                {new Date(p.installedAt).toLocaleString()}
              </div>
            )}
            {p.lastUpdated && (
              <div>
                <span className="text-gray-600">{t("plugins.lastUpdated")}:</span>{" "}
                {new Date(p.lastUpdated).toLocaleString()}
              </div>
            )}
            {p.gitCommitSha && (
              <div className="col-span-2">
                <span className="text-gray-600">SHA:</span>{" "}
                <span className="font-mono">{p.gitCommitSha.slice(0, 12)}</span>
              </div>
            )}
            {meta?.homepage && (
              <div className="col-span-2 truncate">
                <span className="text-gray-600">{t("plugins.homepage")}:</span>{" "}
                <a
                  href={meta.homepage}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent hover:underline"
                >
                  {meta.homepage}
                </a>
              </div>
            )}
          </div>
          {p.installPath && (
            <div className="mt-2 flex items-center gap-2">
              <span className="font-mono text-[10px] text-gray-600 truncate flex-1">
                {p.installPath}
              </span>
              <CopyButton value={p.installPath} />
            </div>
          )}
          <div className="mt-3">
            <CommandSnippet
              command={`claude plugin uninstall ${p.key}`}
              label={t("explain.plugins.uninstall")}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
