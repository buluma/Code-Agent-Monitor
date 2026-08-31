/**
 * @file Settings tab: a resolved "what /config actually set" summary across
 * scopes, the statusline block, and a raw/structured view per settings.json
 * source. Extracted out of CcConfig.tsx — see SHA-167 — no behavior change.
 * @author Michael Buluma <1452922+buluma@users.noreply.github.com>
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ExternalLink, FileText, Info, Settings as SettingsIcon } from "lucide-react";
import type { CcSettingsSource, CcStatusline } from "../../lib/api";
import { SkeletonRows, ScopeBadge, ExplainerBanner, formatBytes } from "./Widgets";

// ── Settings ──────────────────────────────────────────────────────────

// The settings that the TUI's `/config` editor manages, in display order.
// Surfaced as a resolved at-a-glance summary so the user sees what `/config`
// set (model, verbose, theme, …) without hunting through the raw JSON files.
// Keys map 1:1 to settings.json keys per https://code.claude.com/docs/en/settings.
const CONFIG_OPTION_GROUPS: { title: string; keys: { key: string; label: string }[] }[] = [
  {
    title: "Model & reasoning",
    keys: [
      { key: "model", label: "Model" },
      { key: "effortLevel", label: "Effort level" },
      { key: "alwaysThinkingEnabled", label: "Always thinking" },
    ],
  },
  {
    title: "Output & display",
    keys: [
      { key: "outputStyle", label: "Output style" },
      { key: "verbose", label: "Verbose output" },
      { key: "theme", label: "Theme" },
      { key: "language", label: "Language" },
      { key: "spinnerTipsEnabled", label: "Spinner tips" },
      { key: "autoScrollEnabled", label: "Auto-scroll" },
    ],
  },
  {
    title: "Session & input",
    keys: [
      { key: "autoCompactEnabled", label: "Auto-compact" },
      { key: "fileCheckpointingEnabled", label: "File checkpointing" },
      { key: "editorMode", label: "Editor mode" },
      { key: "preferredNotifChannel", label: "Notifications" },
      { key: "awaySummaryEnabled", label: "Away summary" },
    ],
  },
];

/**
 * Resolve each /config option across the settings sources (project-local >
 * project > user precedence - later sources in the array win) and render a
 * compact summary. Unset options show as "default" so the view reflects the
 * effective configuration, not just whatever happens to be written to a file.
 */
function CurrentConfigPanel({ sources }: { sources: CcSettingsSource[] }) {
  // Build effective map: { key → { value, scope } }. Sources arrive ordered
  // user → project → project-local, so a later hit overrides an earlier one.
  const effective = new Map<string, { value: unknown; scope: CcSettingsSource["scope"] }>();
  for (const src of sources) {
    if (!src.exists || !src.data || typeof src.data !== "object") continue;
    const data = src.data as Record<string, unknown>;
    for (const group of CONFIG_OPTION_GROUPS) {
      for (const { key } of group.keys) {
        if (Object.prototype.hasOwnProperty.call(data, key)) {
          effective.set(key, { value: data[key], scope: src.scope });
        }
      }
    }
  }
  const setCount = effective.size;

  return (
    <div className="rounded-lg border border-border bg-surface-2">
      <div className="border-b border-border px-4 py-2.5 flex items-center gap-2">
        <SettingsIcon className="w-3.5 h-3.5 text-violet-300/80" />
        <span className="text-sm font-medium text-gray-100">Current configuration</span>
        <span className="text-[11px] text-gray-500 ml-auto">
          {setCount} option{setCount !== 1 ? "s" : ""} set · the rest use defaults
        </span>
      </div>
      <div className="p-3 space-y-3">
        {CONFIG_OPTION_GROUPS.map((group) => (
          <div key={group.title}>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-1.5">
              {group.title}
            </div>
            <div className="rounded-md border border-border bg-surface-1 divide-y divide-border">
              {group.keys.map(({ key, label }) => {
                const hit = effective.get(key);
                return (
                  <div
                    key={key}
                    className="px-3 py-1.5 grid grid-cols-[150px_1fr_auto] gap-3 items-center"
                  >
                    <div className="text-[11px] text-gray-300 truncate">{label}</div>
                    <div className="min-w-0">
                      {hit ? (
                        <SettingsValue value={hit.value} />
                      ) : (
                        <span className="text-[10px] text-gray-600 italic">default</span>
                      )}
                    </div>
                    {hit ? (
                      <ScopeBadge scope={hit.scope} />
                    ) : (
                      <span className="text-[10px] text-gray-700">-</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function SettingsPanel({
  sources,
  statusline,
  onOpen,
}: {
  sources: CcSettingsSource[] | null;
  statusline: CcStatusline | null;
  onOpen: (p: string) => void;
}) {
  const { t } = useTranslation("ccConfig");
  if (!sources) return <SkeletonRows n={3} />;
  return (
    <div className="space-y-3">
      <ExplainerBanner
        title={t("explain.settings.title")}
        body={t("explain.settings.body")}
        howTo={t("explain.settings.howTo")}
        commands={[
          { cmd: t("explain.settings.cmd1"), note: t("explain.settings.cmd1Note") },
          { cmd: t("explain.settings.cmd2"), note: t("explain.settings.cmd2Note") },
          { cmd: t("explain.settings.cmd3"), note: t("explain.settings.cmd3Note") },
        ]}
      />
      <CurrentConfigPanel sources={sources} />
      <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-300/90 flex items-center gap-2">
        <Info className="w-3.5 h-3.5 flex-shrink-0" />
        {t("common.redactedNotice")}
      </div>
      {statusline && (statusline.config || statusline.scripts.length > 0) && (
        <StatuslineBlock data={statusline} onOpen={onOpen} />
      )}
      {sources.map((src) => (
        <SettingsBlock key={src.scope} source={src} onOpen={onOpen} />
      ))}
    </div>
  );
}

function StatuslineBlock({ data, onOpen }: { data: CcStatusline; onOpen: (p: string) => void }) {
  const { t } = useTranslation("ccConfig");
  return (
    <div className="rounded-lg border border-border bg-surface-2">
      <div className="border-b border-border px-4 py-2.5">
        <div className="text-sm font-medium text-gray-100">{t("statusline.title")}</div>
      </div>
      <div className="p-3 space-y-3">
        {data.config ? (
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 mb-1.5">
              {t("statusline.configured")}
            </div>
            <div className="rounded-md border border-border bg-surface-1 px-3 py-2 text-[11px] font-mono text-gray-200">
              <span className="text-gray-500">type:</span> {data.config.type ?? "-"}
              {data.config.command && (
                <>
                  <br />
                  <span className="text-gray-500">command:</span> {data.config.command}
                </>
              )}
            </div>
          </div>
        ) : (
          <div className="text-xs text-gray-500">{t("statusline.noStatusline")}</div>
        )}
        {data.scripts.length > 0 && (
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 mb-1.5">
              {t("statusline.scripts")}
            </div>
            <div className="space-y-1.5">
              {data.scripts.map((s) => (
                <button
                  key={s.file}
                  onClick={() => onOpen(s.file)}
                  className="w-full text-left rounded-md border border-border bg-surface-1 hover:bg-surface-3 px-3 py-1.5 inline-flex items-center gap-2"
                >
                  <FileText className="w-3 h-3 text-gray-500 flex-shrink-0" />
                  <span className="font-mono text-[11px] text-gray-200 flex-1 truncate">
                    {s.file}
                  </span>
                  <span className="text-[10px] text-gray-500">{formatBytes(s.size)}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function SettingsBlock({
  source,
  onOpen,
}: {
  source: CcSettingsSource;
  onOpen: (p: string) => void;
}) {
  const { t } = useTranslation("ccConfig");
  const [showRaw, setShowRaw] = useState(false);
  return (
    <div className="rounded-lg border border-border bg-surface-2">
      <div className="border-b border-border px-4 py-2.5 flex items-center gap-2 flex-wrap">
        <ScopeBadge scope={source.scope} />
        <span className="font-mono text-[11px] text-gray-500 truncate flex-1 min-w-0">
          {source.file}
        </span>
        {source.exists ? (
          <>
            <button
              onClick={() => setShowRaw((v) => !v)}
              className="text-[11px] font-medium px-2 py-1 rounded-md border border-border bg-surface-1 hover:bg-surface-3 text-gray-300 hover:text-gray-100"
            >
              {showRaw ? "Structured" : "Raw JSON"}
            </button>
            <button
              onClick={() => onOpen(source.file)}
              className="text-[11px] font-medium px-2 py-1 rounded-md border border-border bg-surface-1 hover:bg-surface-3 text-gray-300 hover:text-gray-100 inline-flex items-center gap-1.5"
            >
              <ExternalLink className="w-3 h-3" />
              {t("common.viewSource")}
            </button>
          </>
        ) : (
          <span className="text-[11px] text-gray-600">{t("settings.fileMissing")}</span>
        )}
      </div>
      {source.exists &&
        (showRaw ? (
          <pre className="p-3 text-[11px] font-mono text-gray-300 overflow-auto max-h-96">
            {JSON.stringify(source.data, null, 2)}
          </pre>
        ) : (
          <SettingsKeyValueList data={source.data as Record<string, unknown> | null | undefined} />
        ))}
    </div>
  );
}

function SettingsKeyValueList({ data }: { data: Record<string, unknown> | null | undefined }) {
  if (!data || typeof data !== "object") {
    return <div className="p-3 text-xs text-gray-500">-</div>;
  }
  const entries = Object.entries(data);
  if (entries.length === 0) {
    return <div className="p-3 text-xs text-gray-500">{"{}"}</div>;
  }
  return (
    <div className="divide-y divide-border">
      {entries.map(([k, v]) => (
        <div
          key={k}
          className="px-3 py-2 grid grid-cols-1 md:grid-cols-[180px_1fr] gap-1 md:gap-3 items-start"
        >
          <div className="font-mono text-[11px] text-gray-400 truncate">{k}</div>
          <div className="min-w-0">
            <SettingsValue value={v} />
          </div>
        </div>
      ))}
    </div>
  );
}

function SettingsValue({ value }: { value: unknown }) {
  if (value === null || value === undefined)
    return <span className="text-[11px] text-gray-600 italic">null</span>;
  if (typeof value === "boolean") {
    return (
      <span
        className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${
          value
            ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/30"
            : "bg-gray-500/10 text-gray-400 border-gray-500/30"
        }`}
      >
        {value ? "true" : "false"}
      </span>
    );
  }
  if (typeof value === "number") {
    return <span className="font-mono text-[11px] text-gray-200">{value}</span>;
  }
  if (typeof value === "string") {
    return <span className="font-mono text-[11px] text-gray-200 break-all">{value}</span>;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-[11px] text-gray-600">[]</span>;
    return (
      <div className="flex flex-wrap gap-1">
        {value.map((item, i) => (
          <span
            key={i}
            className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-surface-3 text-gray-300 border border-border break-all"
          >
            {typeof item === "object" ? JSON.stringify(item) : String(item)}
          </span>
        ))}
      </div>
    );
  }
  // object
  const obj = value as Record<string, unknown>;
  return (
    <div className="space-y-0.5">
      {Object.entries(obj).map(([k, v]) => (
        <div key={k} className="font-mono text-[11px]">
          <span className="text-gray-500">{k}:</span>{" "}
          <span className="text-gray-200 break-all">
            {typeof v === "object" ? JSON.stringify(v) : String(v)}
          </span>
        </div>
      ))}
    </div>
  );
}
