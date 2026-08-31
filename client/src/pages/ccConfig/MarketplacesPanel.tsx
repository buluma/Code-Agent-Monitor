/**
 * @file Marketplaces tab: known-marketplace manifest path plus a card per
 * registered marketplace (source, owner, install location). Extracted out
 * of CcConfig.tsx — see SHA-167 — no behavior change.
 * @author Michael Buluma <1452922+buluma@users.noreply.github.com>
 */

import { useTranslation } from "react-i18next";
import { FileText, Store } from "lucide-react";
import type { CcMarketplacesResponse } from "../../lib/api";
import { SkeletonRows, CopyButton, ExplainerBanner } from "./Widgets";

// ── Marketplaces ──────────────────────────────────────────────────────

export function MarketplacesPanel({
  data,
  search,
}: {
  data: CcMarketplacesResponse | null;
  search: string;
}) {
  const { t } = useTranslation("ccConfig");
  if (!data) return <SkeletonRows n={3} />;
  const filtered = data.items.filter(
    (m) =>
      !search ||
      m.name.toLowerCase().includes(search.toLowerCase()) ||
      (m.marketplaceName || "").toLowerCase().includes(search.toLowerCase())
  );
  return (
    <div className="space-y-3">
      <ExplainerBanner
        title={t("explain.plugins.title")}
        body={t("explain.plugins.body")}
        howTo={t("marketplaces.manifest")}
        commands={[{ cmd: t("marketplaces.addCmd"), note: "" }]}
      />
      <div className="rounded-lg border border-border bg-surface-2 px-3 py-2 flex items-center gap-2 text-[11px] text-gray-500">
        <FileText className="w-3.5 h-3.5" />
        <span className="font-mono truncate">{data.knownPath}</span>
      </div>
      {filtered.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface-2 px-4 py-6 text-center text-sm text-gray-500">
          {t("marketplaces.noMarketplaces")}
        </div>
      ) : (
        filtered.map((m) => (
          <div key={m.name} className="rounded-lg border border-border bg-surface-2 px-4 py-3">
            <div className="flex items-center gap-2 flex-wrap">
              <Store className="w-3.5 h-3.5 text-gray-500" />
              <span className="font-mono text-sm text-gray-100">{m.name}</span>
              {m.marketplaceName && m.marketplaceName !== m.name && (
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-surface-3 text-gray-400 border border-border">
                  {m.marketplaceName}
                </span>
              )}
              {m.pluginCount != null && (
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-accent/10 text-accent border border-accent/20">
                  {t("marketplaces.pluginCount")}: {m.pluginCount}
                </span>
              )}
            </div>
            {m.marketplaceDescription && (
              <p className="mt-1.5 text-xs text-gray-400 leading-relaxed line-clamp-2">
                {m.marketplaceDescription}
              </p>
            )}
            <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-gray-500">
              {m.source && (
                <div className="col-span-2 truncate">
                  <span className="text-gray-600">{t("marketplaces.source")}:</span>{" "}
                  <span className="font-mono">
                    {m.source.source === "github" && m.source.repo
                      ? `github.com/${m.source.repo}`
                      : m.source.url || m.source.repo || JSON.stringify(m.source)}
                  </span>
                </div>
              )}
              {m.marketplaceOwner?.name && (
                <div>
                  <span className="text-gray-600">{t("marketplaces.owner")}:</span>{" "}
                  {m.marketplaceOwner.name}
                </div>
              )}
              {m.lastUpdated && (
                <div>
                  <span className="text-gray-600">{t("marketplaces.lastUpdated")}:</span>{" "}
                  {new Date(m.lastUpdated).toLocaleString()}
                </div>
              )}
            </div>
            {m.installLocation && (
              <div className="mt-2 flex items-center gap-2">
                <span className="font-mono text-[10px] text-gray-600 truncate flex-1">
                  {m.installLocation}
                </span>
                <CopyButton value={m.installLocation} />
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}
