/**
 * @file Token / context-window meter — rolls up usage from the in-memory
 * envelope log and renders the live gauge shown under a run's transcript.
 * Extracted out of Run.tsx — see SHA-167 — no behavior change.
 * @author Michael Buluma <1452922+buluma@users.noreply.github.com>
 */

import { useTranslation } from "react-i18next";
import { Activity } from "lucide-react";
import type { ContentBlock, Envelope, ResultEnvelope, SystemInit } from "./envelopeTypes";

// ── Token / context-window meter ──────────────────────────────────────

export interface TokenStats {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUsd: number | null;
  contextWindow: number | null;
}

const DEFAULT_CONTEXT_WINDOW = 200_000;

/**
 * Roll up token usage from the in-memory envelope log. Pulls the latest
 * `usage` block from `stream_event/message_delta` events (live numbers
 * during streaming) and the canonical `result.usage` envelope when the run
 * finishes. The 1M-context Opus variants emit `contextWindow` in
 * `result.modelUsage`; we surface that to size the meter correctly.
 */
export function computeTokens(envelopes: Envelope[]): TokenStats {
  // Per-turn rolling counters (overwritten as each new turn's message_start
  // arrives). The latest message_start's input + cache numbers reflect the
  // current turn's prompt size, which is the right thing to show in the
  // "Context" gauge.
  let inputTokens = 0;
  let cacheReadTokens = 0;
  let cacheCreationTokens = 0;
  // Output is summed across all completed turns plus the running current
  // turn - claude reports output_tokens as a per-turn (per-message) number,
  // not cumulative. Without summing, the meter resets every time a new
  // `message_start` arrives.
  let completedOutputTokens = 0;
  let currentTurnOutput = 0;
  let costUsd: number | null = null;
  let contextWindow: number | null = null;
  let sawMessageStart = false;
  // While we don't have an authoritative output count from message_delta /
  // result, estimate from the char count in the streaming assistant block
  // so the meter ticks live as text appears (claude doesn't emit usage on
  // every text_delta).
  let outputAuthoritativeForCurrent = false;
  let streamingChars = 0;

  const commitTurn = () => {
    completedOutputTokens += currentTurnOutput;
    currentTurnOutput = 0;
    outputAuthoritativeForCurrent = false;
    streamingChars = 0;
  };

  for (const env of envelopes) {
    const e = env as { type?: string };
    if (e.type === "stream_event") {
      const ev = (
        env as {
          event?: {
            type?: string;
            usage?: Record<string, number>;
            message?: { usage?: Record<string, number> };
          };
        }
      ).event;
      if (!ev) continue;
      if (ev.type === "message_start") {
        // Roll the previous turn's running output into the cumulative total
        // before resetting for this new turn.
        if (sawMessageStart) commitTurn();
        sawMessageStart = true;
        const u = ev.message?.usage;
        if (u) {
          inputTokens = u.input_tokens ?? 0;
          cacheReadTokens = u.cache_read_input_tokens ?? 0;
          cacheCreationTokens = u.cache_creation_input_tokens ?? 0;
          currentTurnOutput = u.output_tokens ?? 0;
        }
      } else if (ev.type === "message_delta") {
        const u = ev.usage;
        if (u && typeof u.output_tokens === "number") {
          // Authoritative running output for the current turn.
          currentTurnOutput = u.output_tokens;
          outputAuthoritativeForCurrent = true;
        }
      }
    } else if (e.type === "result") {
      const r = env as ResultEnvelope & {
        modelUsage?: Record<
          string,
          {
            contextWindow?: number;
            inputTokens?: number;
            outputTokens?: number;
            cacheReadInputTokens?: number;
            cacheCreationInputTokens?: number;
          }
        >;
      };
      // Result is end-of-run: commit any in-flight current turn first.
      if (currentTurnOutput > 0) commitTurn();
      if (typeof r.total_cost_usd === "number") costUsd = r.total_cost_usd;
      if (r.modelUsage && typeof r.modelUsage === "object") {
        for (const m of Object.values(r.modelUsage)) {
          if (!m || typeof m !== "object") continue;
          if (typeof m.contextWindow === "number") contextWindow = m.contextWindow;
          // Prefer modelUsage's per-model totals when available - these are
          // the canonical per-run numbers.
          if (typeof m.inputTokens === "number") inputTokens = m.inputTokens;
          if (typeof m.cacheReadInputTokens === "number") cacheReadTokens = m.cacheReadInputTokens;
          if (typeof m.cacheCreationInputTokens === "number")
            cacheCreationTokens = m.cacheCreationInputTokens;
          if (typeof m.outputTokens === "number") {
            // modelUsage.outputTokens is the run total for this model - use
            // it as the canonical cumulative output, replacing our running
            // sum.
            completedOutputTokens = m.outputTokens;
          }
        }
      }
    } else if (e.type === "system" && (env as SystemInit).model) {
      // Heuristic: 1M Opus has [1m] in the model id
      const model = (env as SystemInit).model || "";
      if (/\[1m\]/i.test(model)) contextWindow = 1_000_000;
    } else if (e.type === "assistant") {
      const msg = (
        env as {
          message?: {
            _streaming?: boolean;
            content?: ContentBlock[];
            usage?: {
              input_tokens?: number;
              output_tokens?: number;
              cache_read_input_tokens?: number;
              cache_creation_input_tokens?: number;
            };
          };
        }
      ).message;
      if (msg?._streaming) {
        streamingChars = 0;
        const blocks = msg.content || [];
        for (const b of blocks) {
          if (b.type === "text") {
            streamingChars += ((b as { text?: string }).text || "").length;
          } else if (b.type === "thinking") {
            streamingChars += ((b as { thinking?: string }).thinking || "").length;
          }
        }
      } else if (msg?.usage) {
        // Transcript-derived seed envelopes carry usage but have no
        // `message.id` (transcriptToEnvelopes doesn't set one). Live-stream
        // canonical envelopes always have an id assigned by message_start,
        // and their tokens are already counted via stream_event / commitTurn
        // - folding them here would double-count. Use id-presence as the
        // discriminator: no id → transcript-seeded → fold; id → live → skip.
        const hasId = !!(msg as { id?: string }).id;
        if (!hasId) {
          const u = msg.usage;
          if (typeof u.input_tokens === "number") inputTokens = u.input_tokens;
          if (typeof u.cache_read_input_tokens === "number") {
            cacheReadTokens = u.cache_read_input_tokens;
          }
          if (typeof u.cache_creation_input_tokens === "number") {
            cacheCreationTokens = u.cache_creation_input_tokens;
          }
          if (typeof u.output_tokens === "number") {
            completedOutputTokens += u.output_tokens;
          }
        }
      }
    }
  }

  // While we don't have an authoritative output count for the current turn,
  // surface the char-based estimate so the meter ticks live during streaming.
  if (!outputAuthoritativeForCurrent && streamingChars > 0) {
    const estimate = Math.ceil(streamingChars / 4);
    if (estimate > currentTurnOutput) currentTurnOutput = estimate;
  }

  return {
    inputTokens,
    outputTokens: completedOutputTokens + currentTurnOutput,
    cacheReadTokens,
    cacheCreationTokens,
    costUsd,
    contextWindow,
  };
}

function formatNum(n: number): string {
  if (n < 1000) return String(n);
  if (n < 100_000) return (n / 1000).toFixed(1) + "k";
  if (n < 1_000_000) return Math.round(n / 1000) + "k";
  return (n / 1_000_000).toFixed(2) + "M";
}

export function TokenMeter({ stats }: { stats: TokenStats }) {
  const { t } = useTranslation("run");
  const total = stats.inputTokens + stats.cacheReadTokens + stats.cacheCreationTokens;
  const cap =
    stats.contextWindow && stats.contextWindow > 0 ? stats.contextWindow : DEFAULT_CONTEXT_WINDOW;
  const pct = Math.min(100, Math.round((total / cap) * 100));
  const tone = pct >= 95 ? "red" : pct >= 80 ? "amber" : "indigo";
  const barColor =
    tone === "red"
      ? "bg-red-500"
      : tone === "amber"
        ? "bg-amber-500"
        : "bg-gradient-to-r from-cyan-500 to-indigo-500";
  return (
    <div className="border-t border-border px-4 py-2 flex items-center gap-3 text-[11px] text-gray-400 flex-wrap">
      <span className="inline-flex items-center gap-1.5">
        <Activity className="w-3 h-3 text-gray-500" />
        <span className="text-gray-500">{t("tokens.label")}</span>
        <span className="font-mono text-gray-200">
          {formatNum(total)} / {formatNum(cap)}
        </span>
        <span
          className={`font-mono ${tone === "red" ? "text-red-300" : tone === "amber" ? "text-amber-300" : "text-gray-500"}`}
        >
          ({pct}%)
        </span>
      </span>
      <div className="flex-1 min-w-24 h-1.5 bg-surface-3 rounded-full overflow-hidden max-w-xs">
        <div
          className={`h-full ${barColor} transition-all duration-300 rounded-full`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="inline-flex items-center gap-3">
        <span>
          <span className="text-gray-500">{t("tokens.input")}:</span>{" "}
          <span className="font-mono text-gray-300">{formatNum(stats.inputTokens)}</span>
        </span>
        <span>
          <span className="text-gray-500">{t("tokens.output")}:</span>{" "}
          <span className="font-mono text-gray-300">{formatNum(stats.outputTokens)}</span>
        </span>
        {stats.cacheReadTokens > 0 && (
          <span>
            <span className="text-gray-500">{t("tokens.cacheRead")}:</span>{" "}
            <span className="font-mono text-emerald-300">{formatNum(stats.cacheReadTokens)}</span>
          </span>
        )}
        {stats.costUsd != null && (
          <span>
            <span className="text-gray-500">{t("tokens.cost")}:</span>{" "}
            <span className="font-mono text-gray-200">${stats.costUsd.toFixed(4)}</span>
          </span>
        )}
      </span>
    </div>
  );
}
