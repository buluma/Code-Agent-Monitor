/**
 * @file MCP servers tab: user/project-scoped server lists and their detail
 * cards (stdio command/args/env, or HTTP url/headers). Extracted out of
 * CcConfig.tsx — see SHA-167 — no behavior change.
 * @author Michael Buluma <1452922+buluma@users.noreply.github.com>
 */

import { useTranslation } from "react-i18next";
import type { CcMcpResponse, CcMcpServer } from "../../lib/api";
import { SkeletonRows, ExplainerBanner, CommandSnippet } from "./Widgets";

// ── MCP servers ───────────────────────────────────────────────────────

export function McpPanel({ data, search }: { data: CcMcpResponse | null; search: string }) {
  const { t } = useTranslation("ccConfig");
  if (!data) return <SkeletonRows n={3} />;
  const all = [...data.user, ...data.projectScoped];
  const filter = (arr: CcMcpServer[]) =>
    arr.filter((s) => !search || s.name.toLowerCase().includes(search.toLowerCase()));
  return (
    <div className="space-y-4">
      <ExplainerBanner
        title={t("explain.mcp.title")}
        body={t("explain.mcp.body")}
        howTo={t("explain.mcp.add")}
        commands={[
          { cmd: t("explain.mcp.listCmd"), note: t("explain.mcp.list") },
          { cmd: t("explain.mcp.addCmd"), note: t("explain.mcp.add") },
        ]}
      />
      {all.length === 0 && (
        <div className="rounded-lg border border-border bg-surface-2 px-4 py-6 text-center text-sm text-gray-500">
          {t("mcp.noServers")}
        </div>
      )}
      {data.user.length > 0 && (
        <div>
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 mb-2">
            {t("mcp.userScope")}
          </h3>
          <div className="space-y-2">
            {filter(data.user).map((s) => (
              <McpCard key={`u:${s.name}:${s.source}`} server={s} />
            ))}
          </div>
        </div>
      )}
      {data.projectScoped.length > 0 && (
        <div>
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 mb-2">
            {t("mcp.projectScope")}
          </h3>
          <div className="space-y-2">
            {filter(data.projectScoped).map((s) => (
              <McpCard key={`p:${s.name}:${s.source}`} server={s} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function McpCard({ server }: { server: CcMcpServer }) {
  const { t } = useTranslation("ccConfig");
  return (
    <div className="rounded-lg border border-border bg-surface-2 px-4 py-3">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-mono text-sm text-gray-100">{server.name}</span>
        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-surface-3 text-gray-400 border border-border">
          {server.kind}
        </span>
        <span className="text-[10px] text-gray-500 ml-auto truncate max-w-xs">{server.source}</span>
      </div>
      <div className="mt-2 space-y-1 text-[11px]">
        {server.kind === "stdio" && (
          <>
            <Field label={t("mcp.command")}>
              <span className="font-mono text-gray-300">{server.command}</span>
            </Field>
            {server.args && server.args.length > 0 && (
              <Field label={t("mcp.args")}>
                <span className="font-mono text-gray-400">{server.args.join(" ")}</span>
              </Field>
            )}
            {server.envNames && server.envNames.length > 0 && (
              <Field label={t("mcp.env")}>
                <span className="font-mono text-gray-400">{server.envNames.join(", ")}</span>
              </Field>
            )}
          </>
        )}
        {server.kind === "http" && (
          <>
            <Field label={t("mcp.url")}>
              <span className="font-mono text-gray-300">{server.url}</span>
            </Field>
            {server.headers && server.headers.length > 0 && (
              <Field label={t("mcp.headers")}>
                <span className="font-mono text-gray-400">{server.headers.join(", ")}</span>
              </Field>
            )}
          </>
        )}
      </div>
      <div className="mt-3">
        <CommandSnippet
          command={`claude mcp remove ${server.name}`}
          label={t("explain.mcp.remove")}
        />
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <span className="text-gray-600 min-w-20">{label}:</span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </div>
  );
}
