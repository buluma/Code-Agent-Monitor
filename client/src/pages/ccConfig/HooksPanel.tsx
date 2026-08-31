/**
 * @file Hooks tab: per-scope hook event listing plus any hook script files
 * on disk. Extracted out of CcConfig.tsx — see SHA-167 — no behavior change.
 * @author Michael Buluma <1452922+buluma@users.noreply.github.com>
 */

import { useTranslation } from "react-i18next";
import { ExternalLink, FileText, Wrench } from "lucide-react";
import type { CcHookScripts, CcHookSource } from "../../lib/api";
import { SkeletonRows, ScopeBadge, ExplainerBanner, formatBytes } from "./Widgets";

// ── Hooks ─────────────────────────────────────────────────────────────

export function HooksPanel({
  sources,
  scripts,
  search,
  onOpen,
}: {
  sources: CcHookSource[] | null;
  scripts: CcHookScripts | null;
  search: string;
  onOpen: (p: string) => void;
}) {
  const { t } = useTranslation("ccConfig");
  if (!sources) return <SkeletonRows n={3} />;
  return (
    <div className="space-y-4">
      <ExplainerBanner
        title={t("explain.hooks.title")}
        body={t("explain.hooks.body")}
        howTo={t("explain.hooks.howTo")}
        commands={[
          { cmd: t("explain.hooks.cmd1"), note: t("explain.hooks.cmd1Note") },
          { cmd: t("explain.hooks.cmd2"), note: t("explain.hooks.cmd2Note") },
          { cmd: t("explain.hooks.cmd3"), note: t("explain.hooks.cmd3Note") },
        ]}
      />
      {sources.map((src) => {
        const events = Object.entries(src.hooks);
        const filteredEvents = search
          ? events.filter(([event]) => event.toLowerCase().includes(search.toLowerCase()))
          : events;
        return (
          <div key={src.scope} className="rounded-lg border border-border bg-surface-2">
            <div className="border-b border-border px-4 py-2.5 flex items-center gap-2">
              <ScopeBadge scope={src.scope} />
              <span className="font-mono text-[11px] text-gray-500 truncate flex-1">
                {src.file}
              </span>
              {src.exists ? (
                <button
                  onClick={() => onOpen(src.file)}
                  className="text-[11px] font-medium px-2 py-1 rounded-md border border-border bg-surface-1 hover:bg-surface-3 text-gray-300 hover:text-gray-100 inline-flex items-center gap-1.5"
                >
                  <ExternalLink className="w-3 h-3" />
                  {t("common.viewSource")}
                </button>
              ) : (
                <span className="text-[11px] text-gray-600">{t("hooks.fileMissing")}</span>
              )}
            </div>
            <div className="p-3">
              {filteredEvents.length === 0 ? (
                <div className="text-xs text-gray-500 px-1 py-2">{t("hooks.noHooks")}</div>
              ) : (
                <div className="space-y-3">
                  {filteredEvents.map(([event, entries]) => (
                    <div key={event}>
                      <div className="text-[11px] font-semibold text-gray-300 mb-1.5 inline-flex items-center gap-2">
                        <Wrench className="w-3 h-3 text-gray-500" />
                        {event}
                        <span className="text-[10px] text-gray-600">({entries.length})</span>
                      </div>
                      <div className="space-y-1.5 pl-5">
                        {entries.map((h, idx) => (
                          <div
                            key={`${event}-${idx}`}
                            className="rounded-md border border-border bg-surface-1 px-2.5 py-1.5 text-[11px]"
                          >
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-[10px] text-gray-500">
                                {t("hooks.matcher")}={h.matcher}
                              </span>
                              <span className="text-[10px] text-gray-600">·</span>
                              <span className="font-mono text-[10px] text-gray-500">{h.type}</span>
                              {h.timeout != null && (
                                <span className="text-[10px] text-gray-600">{h.timeout}ms</span>
                              )}
                            </div>
                            {h.command && (
                              <div className="mt-1 font-mono text-[11px] text-gray-300 break-all">
                                {h.command}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      })}

      {scripts && scripts.items.length > 0 && (
        <div className="rounded-lg border border-border bg-surface-2">
          <div className="border-b border-border px-4 py-2.5">
            <div className="text-sm font-medium text-gray-100">{t("hookScripts.title")}</div>
            <p className="mt-1 text-[11px] text-gray-500 leading-relaxed">
              {t("hookScripts.subtitle")}
            </p>
            <div className="mt-1 font-mono text-[10px] text-gray-600">{scripts.dir}</div>
          </div>
          <div className="p-3 space-y-1.5">
            {scripts.items.map((s) => (
              <button
                key={s.file}
                onClick={() => onOpen(s.file)}
                className="w-full text-left rounded-md border border-border bg-surface-1 hover:bg-surface-3 px-3 py-1.5 inline-flex items-center gap-2"
              >
                <FileText className="w-3 h-3 text-gray-500 flex-shrink-0" />
                <span className="font-mono text-[11px] text-gray-200 flex-1 truncate">
                  {s.name}
                </span>
                <span className="text-[10px] text-gray-500">{formatBytes(s.size)}</span>
                <span className="text-[10px] text-gray-600 hidden md:inline">
                  {new Date(s.mtime).toLocaleDateString()}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
