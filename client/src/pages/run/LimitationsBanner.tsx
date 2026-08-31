/**
 * @file "What carries over from the TUI" banner shown above the config card
 * before a run starts, with a minimize/restore state persisted to
 * localStorage. Extracted out of Run.tsx — see SHA-167 — no behavior change.
 * @author Michael Buluma <1452922+buluma@users.noreply.github.com>
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { CheckCircle2, ChevronDown, Lightbulb, Minus, XCircle } from "lucide-react";

// ── Limitations banner (above the config card) ────────────────────────

const LIMITATIONS_MINIMIZED_KEY = "run-limitations-minimized-v1";

export function LimitationsBanner() {
  const { t } = useTranslation("run");
  const [minimized, setMinimized] = useState(() => {
    try {
      return localStorage.getItem(LIMITATIONS_MINIMIZED_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [expanded, setExpanded] = useState(false);
  const persistMinimized = (v: boolean) => {
    try {
      localStorage.setItem(LIMITATIONS_MINIMIZED_KEY, v ? "1" : "0");
    } catch {
      /* ignore */
    }
    setMinimized(v);
  };
  const minimize = () => persistMinimized(true);
  const restore = () => {
    persistMinimized(false);
    setExpanded(false);
  };

  if (minimized) {
    return (
      <button
        type="button"
        onClick={restore}
        className="group w-full flex items-center gap-2 rounded-lg border border-border/70 bg-surface-2/60 hover:bg-surface-2 hover:border-amber-500/30 px-3 py-1.5 text-left transition-colors"
        aria-label={t("limitations.restore", "Show in-browser run notes")}
        title={t("limitations.restore", "Show in-browser run notes")}
      >
        <span className="w-5 h-5 rounded-md bg-amber-500/10 border border-amber-500/30 inline-flex items-center justify-center flex-shrink-0">
          <Lightbulb className="w-3 h-3 text-amber-300" />
        </span>
        <span className="text-[11.5px] text-gray-400 truncate">
          <span className="text-gray-200 font-medium">{t("limitations.title")}</span>
          <span className="text-gray-600 mx-1.5">·</span>
          <span>
            {t(
              "limitations.peek",
              "Most TUI features carry over. A handful of interactive ones don't."
            )}
          </span>
        </span>
        <ChevronDown className="w-3 h-3 text-gray-500 group-hover:text-gray-300 ml-auto flex-shrink-0 transition-colors" />
      </button>
    );
  }
  return (
    <div className="relative rounded-xl border border-border/70 bg-gradient-to-br from-amber-500/[0.04] via-surface-2 to-surface-1 px-5 py-4 shadow-sm shadow-black/10">
      <button
        onClick={minimize}
        className="absolute top-3 right-3 w-6 h-6 rounded-md text-gray-500 hover:text-gray-200 hover:bg-surface-3 inline-flex items-center justify-center transition-colors"
        aria-label={t("limitations.minimize", "Minimize")}
        title={t("limitations.minimize", "Minimize")}
      >
        <Minus className="w-3.5 h-3.5" />
      </button>
      <div className="flex items-start gap-3 pr-8">
        <div className="w-9 h-9 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-center justify-center flex-shrink-0">
          <Lightbulb className="w-4 h-4 text-amber-300" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-gray-100 leading-tight">
            {t("limitations.title")}
          </div>
          <div className="mt-1 inline-flex items-center gap-2 text-[11px] text-gray-500">
            <span className="font-mono px-1.5 py-0.5 rounded border border-border bg-surface-2/60 text-gray-400">
              stream-json
            </span>
            <span className="text-gray-600">·</span>
            <span>{t("limitations.subtitle", "same binary, different surface")}</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 mt-3.5 pl-12 pr-1">
        <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/[0.05] px-3.5 py-2.5">
          <div className="text-[11px] font-semibold text-emerald-300 mb-1.5 inline-flex items-center gap-1.5 uppercase tracking-wide">
            <CheckCircle2 className="w-3.5 h-3.5" />
            {t("limitations.supported")}
          </div>
          <ul className="text-[11.5px] text-gray-300 leading-[1.55] space-y-1 marker:text-emerald-500/40 list-disc pl-4">
            <li>Live streaming output - text, thinking, tool calls, tool results</li>
            <li>Multi-turn conversations &amp; resuming any past session</li>
            <li>User / project / plugin slash commands (template expansion)</li>
            <li>
              <code className="text-[10.5px] text-gray-200">@</code>-references to files in the
              working directory
            </li>
            <li>Live token / context-window meter</li>
            <li>
              Active-runs switcher; full transcripts in{" "}
              <code className="text-[10.5px] text-gray-200">/sessions</code>
            </li>
          </ul>
        </div>
        <div className="rounded-lg border border-rose-500/20 bg-rose-500/[0.05] px-3.5 py-2.5">
          <div className="text-[11px] font-semibold text-rose-300 mb-1.5 inline-flex items-center gap-1.5 uppercase tracking-wide">
            <XCircle className="w-3.5 h-3.5" />
            {t("limitations.limited")}
          </div>
          <ul className="text-[11.5px] text-gray-300 leading-[1.55] space-y-1 marker:text-rose-500/40 list-disc pl-4">
            <li>
              Built-in slash commands (<code className="text-[10.5px] text-gray-200">/help</code>,{" "}
              <code className="text-[10.5px] text-gray-200">/model</code>,{" "}
              <code className="text-[10.5px] text-gray-200">/clear</code>,{" "}
              <code className="text-[10.5px] text-gray-200">/compact</code>) - they mutate CLI-only
              state
            </li>
            <li>Mid-session permission prompts - pick the mode at spawn time</li>
            <li>Compaction prompts mid-conversation</li>
            <li>Mid-session model or effort changes (set them at spawn time)</li>
          </ul>
        </div>
      </div>

      <div className="mt-3 pl-12 pr-1 flex items-center gap-2">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="text-[11px] font-medium px-2.5 py-1 rounded-md border border-border bg-surface-2 hover:bg-surface-3 text-gray-300 inline-flex items-center gap-1.5 transition-colors"
          aria-expanded={expanded}
        >
          <ChevronDown className={`w-3 h-3 transition-transform ${expanded ? "rotate-180" : ""}`} />
          {expanded ? t("limitations.collapse") : t("limitations.why", "Why")}
        </button>
        {!expanded && (
          <span className="text-[10.5px] text-gray-600 truncate">
            {t(
              "limitations.peek",
              "Most TUI features carry over. A handful of interactive ones don't."
            )}
          </span>
        )}
      </div>
      {expanded && (
        <div className="mt-3 pl-12 pr-1 space-y-2 border-t border-border/40 pt-3">
          <p className="text-[11.5px] text-gray-400 leading-relaxed">{t("limitations.intro")}</p>
          <p className="text-[11px] text-gray-500 leading-relaxed">{t("limitations.tldr")}</p>
        </div>
      )}
    </div>
  );
}
