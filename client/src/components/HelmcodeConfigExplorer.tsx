/**
 * @file HelmcodeConfigExplorer.tsx
 * @description Read-only Config Explorer tab for the local Helm Code
 * integration. Mirrors the Codex Config Explorer surface in shape but is
 * strictly read-only against Helm Code's state database. The only
 * mutation is a non-destructive Resync that re-runs the idempotent
 * `ingestHelmcodeSnapshot` pass against the dashboard's own mirror.
 * Rendered as the third tab of the multi-provider Config page.
 * @author Michael Buluma <1452922+buluma@users.noreply.github.com>
 */

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertCircle, RefreshCw } from "lucide-react";
import { api, type HelmcodeConfigOverview } from "../lib/api";

type Toast = { kind: "success" | "error"; message: string } | null;

function formatBytes(bytes: number | null): string {
  if (bytes == null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GiB`;
}

export function HelmcodeConfigExplorer() {
  const { t } = useTranslation("ccConfig");
  const [overview, setOverview] = useState<HelmcodeConfigOverview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resyncing, setResyncing] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const [toast, setToast] = useState<Toast>(null);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(id);
  }, [toast]);

  const fetchOverview = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.helmcodeConfig.overview();
      setOverview(data);
      setLastSyncedAt(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchOverview();
  }, [fetchOverview]);

  const handleResync = useCallback(async () => {
    setResyncing(true);
    setError(null);
    try {
      const result = await api.helmcodeConfig.resync();
      setToast({
        kind: "success",
        message: t("helmcode.resyncSuccess", {
          scanned: result.summary.scanned,
          changed: result.summary.changed,
          created: result.summary.created,
          removed: result.summary.removed,
        }),
      });
      await fetchOverview();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setToast({ kind: "error", message: t("helmcode.resyncError") });
    } finally {
      setResyncing(false);
    }
  }, [fetchOverview, t]);

  return (
    <div className="space-y-4" data-testid="helmcode-config-explorer">
      {error && (
        <div
          className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200 flex items-center gap-2"
          role="alert"
        >
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span>{t("loadError", { message: error })}</span>
        </div>
      )}

      {toast && (
        <div
          className={`rounded-lg border px-4 py-3 text-sm flex items-center gap-2 ${
            toast.kind === "success"
              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
              : "border-red-500/40 bg-red-500/10 text-red-200"
          }`}
          role="status"
        >
          <span>{toast.message}</span>
        </div>
      )}

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold text-gray-100">
            {t("helmcode.title", "Helm Code Config Explorer")}
          </h2>
          <p className="text-xs text-gray-500 mt-1">
            {t(
              "helmcode.subtitle",
              "Read-only diagnostic view of the local Helm Code integration. The only mutation is a non-destructive Resync."
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={fetchOverview}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-2 px-3 py-1.5 text-xs text-gray-300 hover:text-gray-100 disabled:opacity-50"
            data-testid="helmcode-refresh"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            {t("helmcode.refresh", "Refresh")}
          </button>
          <button
            type="button"
            onClick={handleResync}
            disabled={resyncing}
            className="inline-flex items-center gap-1.5 rounded-md border border-accent/40 bg-accent/10 px-3 py-1.5 text-xs text-accent hover:bg-accent/20 disabled:opacity-50"
            data-testid="helmcode-resync"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${resyncing ? "animate-spin" : ""}`} />
            {t("helmcode.resync", "Resync now")}
          </button>
        </div>
      </div>

      {lastSyncedAt && (
        <p className="text-[10px] text-gray-500">
          {t("helmcode.lastSynced", "Last refreshed")}: {lastSyncedAt.toLocaleTimeString()}
        </p>
      )}

      {!overview ? (
        loading ? (
          <div className="rounded-xl border border-border bg-surface-1 px-4 py-6 text-sm text-gray-400">
            {t("loading", "Loading…")}
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-surface-1 px-4 py-6 text-sm text-gray-400">
            {t("helmcode.empty", "No data.")}
          </div>
        )
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Section title={t("helmcode.sections.home", "Home & State DB")}>
            <Row label={t("helmcode.home", "Home")} value={overview.home} mono />
            <Row
              label={t("helmcode.userdataDir", "Userdata dir")}
              value={overview.userdata_dir}
              mono
            />
            <Row label={t("helmcode.stateDb", "State DB")} value={overview.state_db_path} mono />
            <Row
              label={t("helmcode.stateDbExists", "State DB present")}
              value={overview.state_db.exists ? t("yes", "Yes") : t("no", "No")}
            />
            <Row
              label={t("helmcode.stateDbSize", "State DB size")}
              value={formatBytes(overview.state_db.size_bytes)}
            />
            <Row
              label={t("helmcode.stateDbMtime", "State DB mtime")}
              value={overview.state_db.mtime ?? "—"}
              mono
            />
          </Section>

          <Section title={t("helmcode.sections.runtime", "Server Runtime")}>
            {overview.server_runtime ? (
              <>
                <Row
                  label={t("helmcode.runtimeVersion", "Version")}
                  value={String(overview.server_runtime.version ?? "—")}
                />
                <Row
                  label={t("helmcode.runtimePid", "PID")}
                  value={String(overview.server_runtime.pid ?? "—")}
                />
                <Row
                  label={t("helmcode.runtimeHost", "Host")}
                  value={overview.server_runtime.host ?? "—"}
                  mono
                />
                <Row
                  label={t("helmcode.runtimePort", "Port")}
                  value={String(overview.server_runtime.port ?? "—")}
                />
                <Row
                  label={t("helmcode.runtimeOrigin", "Origin")}
                  value={overview.server_runtime.origin ?? "—"}
                  mono
                />
                <Row
                  label={t("helmcode.runtimeStarted", "Started")}
                  value={overview.server_runtime.started_at ?? "—"}
                  mono
                />
              </>
            ) : (
              <p className="text-xs text-gray-500 px-1 py-1">
                {t(
                  "helmcode.runtimeAbsent",
                  "No server-runtime.json present (Helm Code may be stopped or not yet installed)."
                )}
              </p>
            )}
          </Section>

          <Section title={t("helmcode.sections.env", "Env Overrides")}>
            <Row
              label="DASHBOARD_HELMCODE_HOME"
              value={overview.env.DASHBOARD_HELMCODE_HOME ?? "—"}
              mono
            />
            <Row label="HELMCODE_HOME" value={overview.env.HELMCODE_HOME ?? "—"} mono />
            <Row
              label="DASHBOARD_HELMCODE_SYNC_MS"
              value={
                overview.env.DASHBOARD_HELMCODE_SYNC_MS == null
                  ? "—"
                  : String(overview.env.DASHBOARD_HELMCODE_SYNC_MS)
              }
            />
            <Row
              label={t("helmcode.pollMs", "Active poll interval")}
              value={`${overview.sync.poll_ms} ms`}
            />
          </Section>

          <Section title={t("helmcode.sections.projections", "Projection Counts")}>
            {overview.projection_counts ? (
              <>
                <Row
                  label={t("helmcode.counts.projects", "Projects")}
                  value={String(overview.projection_counts.projects)}
                />
                <Row
                  label={t("helmcode.counts.threads", "Live threads")}
                  value={String(overview.projection_counts.threads)}
                />
                <Row
                  label={t("helmcode.counts.archived", "Archived")}
                  value={String(overview.projection_counts.archived)}
                />
                <Row
                  label={t("helmcode.counts.deleted", "Deleted")}
                  value={String(overview.projection_counts.deleted)}
                />
                <Row
                  label={t("helmcode.counts.messages", "Messages")}
                  value={String(overview.projection_counts.messages)}
                />
                <Row
                  label={t("helmcode.counts.activities", "Activities")}
                  value={String(overview.projection_counts.activities)}
                />
                <Row
                  label={t("helmcode.counts.turns", "Turns")}
                  value={String(overview.projection_counts.turns)}
                />
              </>
            ) : (
              <p className="text-xs text-gray-500 px-1 py-1">
                {t(
                  "helmcode.countsUnavailable",
                  "State DB is missing or unreadable; projection counts are unavailable."
                )}
              </p>
            )}
          </Section>
        </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-surface-1 p-4">
      <h3 className="text-sm font-semibold text-gray-200 mb-3">{title}</h3>
      <div className="space-y-1.5">{children}</div>
    </section>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-xs">
      <span className="text-gray-500 shrink-0">{label}</span>
      <span
        className={`text-gray-200 text-right break-all ${mono ? "font-mono text-[11px]" : ""}`}
        title={value}
      >
        {value}
      </span>
    </div>
  );
}
