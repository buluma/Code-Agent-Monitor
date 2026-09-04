/**
 * @file Page header: title, live/offline badge, provider toggle (Claude Code,
 * Codex, Helm Code, T3), scope toggle, and the backups/refresh actions.
 * Extracted out of CcConfig.tsx — see SHA-167.
 * @author Michael Buluma <1452922+buluma@users.noreply.github.com>
 */

import { useTranslation } from "react-i18next";
import { Boxes, History, RefreshCw } from "lucide-react";
import type { CcScope } from "../../lib/api";

// ── Header ────────────────────────────────────────────────────────────

interface HeaderProps {
  provider: "claude" | "codex" | "helmcode" | "t3";
  onProviderChange: (provider: "claude" | "codex" | "helmcode" | "t3") => void;
  loading: boolean;
  lastUpdated: Date | null;
  scope: CcScope;
  onScopeChange: (s: CcScope) => void;
  onRefresh: () => void;
  onOpenBackups: () => void;
  wsConnected: boolean;
}

export function Header({
  provider,
  onProviderChange,
  loading,
  lastUpdated,
  scope,
  onScopeChange,
  onRefresh,
  onOpenBackups,
  wsConnected,
}: HeaderProps) {
  const { t } = useTranslation("ccConfig");
  const { t: tCommon } = useTranslation("common");
  const formatted = lastUpdated
    ? lastUpdated.toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
    : "-";
  return (
    <header className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
      <div className="flex items-start gap-3 min-w-0 flex-1">
        <div className="w-9 h-9 rounded-xl bg-accent/15 flex items-center justify-center flex-shrink-0">
          <Boxes className="w-4.5 h-4.5 text-accent" />
        </div>
        <div className="min-w-0">
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
            <ProviderToggle value={provider} onChange={onProviderChange} />
          </div>
          <p className="text-xs text-gray-500 max-w-2xl">{t(`provider.${provider}.subtitle`)}</p>
        </div>
      </div>
      <div className="flex flex-col items-stretch lg:items-end gap-2 flex-shrink-0">
        <div className="flex items-center gap-2 justify-end flex-wrap">
          {provider === "claude" && <ScopeToggle value={scope} onChange={onScopeChange} />}
          {provider === "claude" && (
            <button
              onClick={onOpenBackups}
              className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-xs font-medium text-gray-200 hover:bg-surface-3 transition-colors"
            >
              <History className="w-3.5 h-3.5" />
              {t("backups.openButton")}
            </button>
          )}
          {provider === "claude" && (
            <button
              onClick={onRefresh}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-xs font-medium text-gray-200 hover:bg-surface-3 disabled:opacity-60 transition-colors"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
              {loading ? t("refreshing") : t("refresh")}
            </button>
          )}
        </div>
        {provider === "claude" && lastUpdated && (
          <span className="text-[11px] text-gray-500 self-end">
            {t("lastUpdated", { time: formatted })}
          </span>
        )}
      </div>
    </header>
  );
}

function ProviderToggle({
  value,
  onChange,
}: {
  value: "claude" | "codex" | "helmcode" | "t3";
  onChange: (value: "claude" | "codex" | "helmcode" | "t3") => void;
}) {
  const { t } = useTranslation("ccConfig");
  return (
    <div
      className="inline-flex rounded-full border border-border bg-surface-2 p-0.5"
      aria-label={t("provider.aria", "Configuration provider")}
    >
      {(["claude", "codex", "helmcode", "t3"] as const).map((option) => (
        <button
          key={option}
          onClick={() => onChange(option)}
          className={`rounded-full px-2 py-px text-[10px] font-medium transition-colors ${value === option ? "bg-accent/20 text-accent" : "text-gray-400 hover:text-gray-200"}`}
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

function ScopeToggle({ value, onChange }: { value: CcScope; onChange: (s: CcScope) => void }) {
  const { t } = useTranslation("ccConfig");
  const opts: { v: CcScope; label: string }[] = [
    { v: "all", label: t("scope.all") },
    { v: "user", label: t("scope.user") },
    { v: "project", label: t("scope.project") },
  ];
  return (
    <div className="inline-flex rounded-lg border border-border bg-surface-2 p-0.5">
      {opts.map((o) => (
        <button
          key={o.v}
          onClick={() => onChange(o.v)}
          className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors ${
            value === o.v
              ? "bg-accent/20 text-accent border border-accent/30"
              : "text-gray-400 hover:text-gray-200"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
