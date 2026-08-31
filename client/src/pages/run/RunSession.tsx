/**
 * @file Live run session: toolbar (status, mode, model, stop/new-run
 * controls), the transcript stream, token meter, result footer, and the
 * follow-up prompt editor for conversation-mode runs still live. Extracted
 * out of Run.tsx — see SHA-167 — no behavior change.
 * @author Michael Buluma <1452922+buluma@users.noreply.github.com>
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { ExternalLink, Plus, Send, Square } from "lucide-react";
import type { RunHandle, RunMode } from "../../lib/api";
import type { Envelope, ResultEnvelope, SystemInit } from "./envelopeTypes";
import { StatusPill, ModeBadge, EmptyStream, EnvelopeRow, ResultFooter } from "./TranscriptView";
import { TokenMeter, computeTokens } from "./TokenMeter";
import { PromptEditor } from "./PromptEditor";
import type { SlashCommand } from "./slashCommands";

// ── Live run session ─────────────────────────────────────────────────

interface RunSessionProps {
  handle: RunHandle;
  envelopes: Envelope[];
  mode: RunMode;
  isLive: boolean;
  hasFinished: boolean;
  followUp: string;
  onFollowUpChange: (s: string) => void;
  busy: "start" | "send" | "stop" | "attach" | null;
  onSend: () => void;
  onStop: () => void;
  onNewRun: () => void;
  slashCommands: SlashCommand[];
}

export function RunSession(props: RunSessionProps) {
  const { t } = useTranslation("run");
  const providerLabel = t(
    `provider.${props.handle.provider}.label`,
    props.handle.provider === "codex" ? "Codex" : "Claude Code"
  );
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [pinnedToBottom, setPinnedToBottom] = useState(true);

  // Track whether the user has scrolled away - if so, don't yank them back.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const distance = el.scrollHeight - (el.scrollTop + el.clientHeight);
      setPinnedToBottom(distance < 80);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  // Auto-scroll on new envelopes if the user is pinned to bottom.
  useEffect(() => {
    if (!pinnedToBottom) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [props.envelopes.length, pinnedToBottom]);

  const result = useMemo(
    () => props.envelopes.find((e) => e.type === "result") as ResultEnvelope | undefined,
    [props.envelopes]
  );
  const init = useMemo(
    () => props.envelopes.find((e) => e.type === "system") as SystemInit | undefined,
    [props.envelopes]
  );
  const tokenStats = useMemo(() => computeTokens(props.envelopes), [props.envelopes]);

  return (
    // flex-1 + min-h-0 lets us fill the viewport-locked parent, while the
    // inner stream area's overflow-auto keeps long chats scrollable inside
    // the panel - never the page.
    <div className="rounded-xl border border-border bg-surface-1 flex flex-col flex-1 min-h-0">
      {/* Toolbar */}
      <div className="border-b border-border px-4 py-2.5 flex items-center gap-2 flex-wrap">
        <StatusPill status={props.handle.status} />
        <ModeBadge mode={props.mode} />
        {init?.model && (
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-surface-3 text-gray-400 border border-border">
            {init.model}
          </span>
        )}
        {props.handle.sessionId && (
          <span className="text-[10px] font-mono text-gray-500 truncate max-w-xs">
            {props.handle.sessionId.slice(0, 8)}…
          </span>
        )}
        <div className="flex-1" />
        {props.isLive && (
          <button
            onClick={props.onStop}
            disabled={props.busy === "stop"}
            className="inline-flex items-center gap-1.5 rounded-md border border-red-500/40 bg-red-500/10 hover:bg-red-500/20 text-red-200 px-2.5 py-1 text-[11px] font-medium disabled:opacity-60 transition-colors"
          >
            <Square className="w-3 h-3" />
            {props.busy === "stop" ? t("actions.stopping") : t("actions.stop")}
          </button>
        )}
        {props.handle.sessionId && (
          <Link
            to={`/sessions/${encodeURIComponent(props.handle.sessionId)}`}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-2 hover:bg-surface-3 text-gray-300 hover:text-gray-100 px-2.5 py-1 text-[11px] font-medium transition-colors"
          >
            <ExternalLink className="w-3 h-3" />
            {t("actions.viewSession")}
          </Link>
        )}
        {/* Always available - lets the user leave a running run in the
            background and start another one. The original is still in the
            Active Runs dropdown for re-attach. */}
        <button
          onClick={props.onNewRun}
          className="inline-flex items-center gap-1.5 rounded-md border border-accent/40 bg-accent/15 hover:bg-accent/25 text-accent px-2.5 py-1 text-[11px] font-medium transition-colors"
        >
          <Plus className="w-3 h-3" />
          {t("actions.newRun")}
        </button>
      </div>

      {/* Stream area */}
      <div ref={scrollRef} className="flex-1 overflow-auto px-4 py-3 space-y-3 min-h-0">
        {props.envelopes.length === 0 && <EmptyStream isLive={props.isLive} />}
        {props.envelopes.map((env, i) => (
          <EnvelopeRow key={i} envelope={env} />
        ))}
      </div>

      {/* Live token / context-window meter */}
      <TokenMeter stats={tokenStats} />

      {/* Footer banner once finished */}
      {props.hasFinished && result && <ResultFooter result={result} />}

      {/* Follow-up input - only for conversation mode while live */}
      {props.mode === "conversation" && props.isLive && (
        <div className="border-t border-border px-4 py-3">
          <PromptEditor
            value={props.followUp}
            onChange={props.onFollowUpChange}
            onSubmit={props.onSend}
            placeholder={t("fields.promptPlaceholderWithProvider", "Ask {{agent}} anything…", {
              agent: providerLabel,
            })}
            rows={2}
            slashCommands={props.slashCommands}
            fileCwd={props.handle.cwd}
          />
          <div className="mt-2 flex items-center justify-between">
            <div className="text-[10px] text-gray-600">{t("hint.shortcut")} · / · @</div>
            <button
              onClick={props.onSend}
              disabled={!props.followUp.trim() || props.busy === "send"}
              className="inline-flex items-center gap-1.5 rounded-md border border-accent/40 bg-accent/15 hover:bg-accent/25 text-accent px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50"
            >
              <Send className="w-3 h-3" />
              {props.busy === "send" ? t("actions.sending") : t("actions.send")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
