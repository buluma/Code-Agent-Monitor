/**
 * @file Run.tsx
 * @description Lets the user run Claude Code or Codex interactively from the
 * dashboard. Claude supports conversation and one-shot modes; Codex uses its
 * native app-server thread protocol for multi-turn conversation, tool events,
 * interruption, and session resumption.
 *   - Conversation: multi-turn, follow-up input box appears once running.
 *     Optionally resumes an existing session via `claude --resume <id>`.
 *   - One-shot (headless): single prompt, single response, stdin closes.
 *
 * Output is rendered as a chat-style stream: user turns, assistant text
 * (markdown), tool uses + their results (collapsible), and a footer banner
 * with cost / duration / session deep-link once the run completes.
 *
 * Includes an Active Runs switcher in the header so the user can attach to
 * any in-flight run (e.g. when they leave one running and start another).
 *
 * Wire-up:
 *   - POST /api/run starts; the response is the initial handle.
 *   - WebSocket "run_stream" pushes parsed stream-json envelopes from the
 *     spawned `claude`. WebSocket "run_status" pushes status transitions.
 *   - POST /api/run/:id/message sends follow-up turns.
 *   - DELETE /api/run/:id stops with SIGTERM.
 *   - GET /api/run/:id?envelopes=1 fetches in-memory history when attaching.
 *
 * @author Michael Buluma <1452922+buluma@users.noreply.github.com>
 */
/* =============================================================================
 * MODULE_GUIDE — extended in-file reference (comments only; safe to read, never executed)
 * =============================================================================
 * **Path:** `/Users/buluma/Documents/GitHub/Claude-Code-Agent-Monitor/client/src/pages/Run.tsx`
 * **Purpose:** Dashboard module consumed by the React client, MCP tools, or desktop shell depending on deployment mode.
 *
 * ## Design constraints
 * - Local-first: no telemetry leaves the machine unless the user configures webhooks.
 * - Fail-safe hooks path on the server must never block Claude Code; UI mirrors that
 *   philosophy by degrading gracefully (empty states, stale badges, reconnect loops).
 * - Destructive flows stay behind explicit confirmation modals and server-side gates.
 * - Internationalization: user-visible strings belong in i18n JSON, not literals here.
 *
 * ## Remote data & SSH
 * Remote Data Sources let operators aggregate multiple machines. SSH entries describe
 * how to reach a peer dashboard; the global data scope (`dataScope.ts`) narrows every
 * scoped GET via `?sources=`. Health checks and import history surface in Settings.
 *
 * ## Observability
 * Prometheus scrapes `GET /api/metrics` (see `monitoring/`). Grafana ships four
 * provisioned boards (overview, sessions, tools, alerts). Native npm scripts and
 * Docker Compose profiles are documented in `monitoring/README.md`.
 *
 * ## Internal dependencies
 * - `../lib/api`
 * - `../lib/types`
 * - `../lib/eventBus`
 * - `./run/envelopeTypes` — shared stream-json envelope shapes
 * - `./run/slashCommands` — slash-command catalog + client-side expansion
 * - `./run/LimitationsBanner`, `./run/RunHeader`, `./run/ConfigForm`,
 *   `./run/RunSession`, `./run/PromptEditor`, `./run/TokenMeter`,
 *   `./run/TranscriptView` — presentational subcomponents, extracted
 *   (SHA-167)
 *
 * ## Public surface
 * - `Run` — exported API; see TSDoc on the symbol for behavior.
 *
 * ## Testing pointers
 * - Prefer colocated `__tests__` with Vitest + Testing Library for UI.
 * - Server contract changes require `npm run test:server` and OpenAPI sync.
 * - MCP edits: `npm run mcp:typecheck` and `npm run mcp:build`.
 *
 * ## Related docs
 * - `ARCHITECTURE.md` — hooks → API → SQLite → WebSocket → UI pipeline.
 * - `docs/API.md` — REST reference.
 * - `.claude/skills/file-headers/` — mandatory `@author` header policy.
 * ============================================================================= */
/* -----------------------------------------------------------------------------
 * EXPORT CATALOG — quick index of symbols defined below (documentation only).
 * -----------------------------------------------------------------------------
 * **Run**
 *   Part of this module's public contract. Downstream imports should treat
 *   the signature and return type as stable unless release notes say otherwise.
 *   When behavior changes, update the `@file` overview and relevant tests.
 *
 * ----------------------------------------------------------------------------- */

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { flushSync } from "react-dom";
import { useNavigate, useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import { AlertCircle, X } from "lucide-react";
import { api } from "../lib/api";
import type {
  CodexApprovalPolicy,
  CodexSandbox,
  CwdSuggestion,
  DashboardRunHistoryItem,
  EffortLevel,
  ModelChoice,
  PermissionMode,
  RunHandle,
  RunListResponse,
  RunMode,
  RunProvider,
} from "../lib/api";
import type { Session, TranscriptMessage, TranscriptContent } from "../lib/types";
import { eventBus } from "../lib/eventBus";
import type {
  RunInputAckPayload,
  RunStatusPayload,
  RunStreamPayload,
  WSMessage,
} from "../lib/types";
import type { ContentBlock, UserMessage, Envelope, CodexEventEnvelope } from "./run/envelopeTypes";
import type { SlashCommand } from "./run/slashCommands";
import { BUILTIN_SLASH_COMMANDS, maybeExpandSlashCommand } from "./run/slashCommands";
import { LimitationsBanner } from "./run/LimitationsBanner";
import { Header, ProviderChooser } from "./run/RunHeader";
import { ConfigCard } from "./run/ConfigForm";
import { RunSession } from "./run/RunSession";

// Convert past-session transcript messages into envelope shapes so the chat
// view can render the prior conversation alongside live output from the
// resumed run. The shapes are close but not identical (`thinking.text` vs
// `thinking.thinking`, tool_result `id`/`output` vs `tool_use_id`/`content`),
// so each block is mapped individually.
function transcriptToEnvelopes(messages: TranscriptMessage[]): Envelope[] {
  const mapBlock = (b: TranscriptContent): ContentBlock | null => {
    if (b.type === "text") return { type: "text", text: b.text || "" };
    if (b.type === "thinking") return { type: "thinking", thinking: b.text || "" };
    if (b.type === "tool_use") {
      return { type: "tool_use", id: b.id || "", name: b.name || "", input: b.input };
    }
    if (b.type === "tool_result") {
      return {
        type: "tool_result",
        tool_use_id: b.id || "",
        content: b.output || "",
        is_error: !!b.is_error,
      };
    }
    return null;
  };
  const out: Envelope[] = [];
  // Prepend a synthetic system/init envelope carrying the model so the
  // context-window heuristic in computeTokens can size the meter correctly
  // (e.g., [1m] tag → 1M cap) even when no live `system` envelope has
  // arrived yet because the run was loaded from history.
  const firstModel = messages.find((m) => m.type === "assistant" && m.model)?.model;
  if (firstModel) {
    out.push({ type: "system", subtype: "init", model: firstModel } as Envelope);
  }
  for (const m of messages) {
    const content = m.content.map(mapBlock).filter((x): x is ContentBlock => x !== null);
    if (content.length === 0) continue;
    if (m.type === "assistant") {
      out.push({ type: "assistant", message: { content, usage: m.usage } });
    } else {
      out.push({ type: "user", message: { content } });
    }
  }
  return out;
}

// ── Streaming envelope merge ───────────────────────────────────────────
//
// `claude --output-format stream-json --include-partial-messages` emits two
// kinds of assistant output:
//
//   1. `stream_event` envelopes carrying Anthropic Messages API streaming
//      events (`message_start`, `content_block_start`, `content_block_delta`,
//      `content_block_stop`, `message_delta`, `message_stop`).
//   2. Eventually, a single complete `assistant` envelope summarising the turn.
//
// To make the chat actually stream character-by-character we accumulate the
// `stream_event` deltas into a synthetic assistant envelope. When the real
// `assistant` envelope arrives, we replace the synthetic one with it (their
// content is identical at that point, but the final envelope has authoritative
// usage / metadata).

interface StreamEventEnvelope {
  type: "stream_event";
  event?: {
    type: string;
    index?: number;
    delta?: {
      type: string;
      text?: string;
      thinking?: string;
      partial_json?: string;
    };
    content_block?: {
      type: string;
      text?: string;
      thinking?: string;
      id?: string;
      name?: string;
      input?: unknown;
    };
    message?: { id?: string };
  };
}

type StreamingAssistantBlock = ContentBlock & {
  _partialJson?: string;
};

interface StreamingAssistantMessage {
  type: "assistant";
  _streamId?: string;
  message: {
    id?: string;
    content: StreamingAssistantBlock[];
    _streaming?: boolean;
  };
}

function findLastStreamingAssistant(prev: Envelope[]): number {
  for (let i = prev.length - 1; i >= 0; i--) {
    const env = prev[i] as { type?: string; message?: { _streaming?: boolean } };
    if (env?.type === "assistant" && env.message?._streaming) return i;
  }
  return -1;
}

function findLastCodexAssistant(prev: Envelope[], itemId: string): number {
  for (let i = prev.length - 1; i >= 0; i--) {
    const candidate = prev[i] as { type?: string; itemId?: string };
    if (candidate.type === "codex_assistant" && candidate.itemId === itemId) return i;
  }
  return -1;
}

function findAssistantByMessageId(prev: Envelope[], id: string | undefined): number {
  if (!id) return findLastStreamingAssistant(prev);
  for (let i = prev.length - 1; i >= 0; i--) {
    const env = prev[i] as { type?: string; message?: { id?: string } };
    if (env?.type === "assistant" && env.message?.id === id) return i;
  }
  return findLastStreamingAssistant(prev);
}

function mutateAssistantAt(
  prev: Envelope[],
  idx: number,
  fn: (m: StreamingAssistantMessage["message"]) => StreamingAssistantMessage["message"]
): Envelope[] {
  if (idx < 0) return prev;
  const env = prev[idx] as StreamingAssistantMessage;
  const next = [...prev];
  next[idx] = {
    ...env,
    message: fn(env.message || ({ content: [] } as StreamingAssistantMessage["message"])),
  };
  return next;
}

function mergeEnvelope(prev: Envelope[], envelope: Envelope): Envelope[] {
  if (!envelope || typeof envelope !== "object") return prev;
  const env = envelope as { type?: string };

  if (env.type === "codex_event") {
    const codex = envelope as unknown as CodexEventEnvelope;
    const params = codex.params || {};
    const item = params.item as Record<string, unknown> | undefined;
    if (codex.method === "item/agentMessage/delta") {
      const itemId = String(params.itemId || "");
      const delta = String(params.delta || "");
      const index = findLastCodexAssistant(prev, itemId);
      if (index >= 0) {
        const next = [...prev];
        const prior = next[index] as { type: string; text: string };
        next[index] = { ...prior, text: `${prior.text}${delta}` } as Envelope;
        return next;
      }
      return [
        ...prev,
        { type: "codex_assistant", itemId, text: delta, streaming: true } as Envelope,
      ];
    }
    if (codex.method === "item/completed" && item) {
      const itemType = item.type;
      if (itemType === "agentMessage") {
        const itemId = String(item.id || "");
        const index = findLastCodexAssistant(prev, itemId);
        const complete = {
          type: "codex_assistant",
          itemId,
          text: String(item.text || ""),
          streaming: false,
        } as Envelope;
        if (index >= 0) {
          const next = [...prev];
          next[index] = complete;
          return next;
        }
        return [...prev, complete];
      }
      if (itemType === "reasoning") {
        const content = Array.isArray(item.content)
          ? item.content.map((part) => String((part as { text?: string }).text || part)).join("\n")
          : String(item.text || item.summary || "");
        return content ? [...prev, { type: "codex_reasoning", text: content } as Envelope] : prev;
      }
      if (itemType === "commandExecution") {
        return [
          ...prev,
          {
            type: "codex_tool",
            name: "Command",
            command: item.command,
            cwd: item.cwd,
            output: item.aggregatedOutput,
            exitCode: item.exitCode,
            status: item.status,
          } as Envelope,
        ];
      }
      if (itemType === "fileChange") {
        return [
          ...prev,
          {
            type: "codex_tool",
            name: "File changes",
            changes: item.changes || item,
            status: item.status,
          } as Envelope,
        ];
      }
    }
    return prev;
  }

  if (env.type === "stream_event") {
    const sse = envelope as StreamEventEnvelope;
    const evt = sse.event;
    if (!evt) return prev;

    if (evt.type === "message_start") {
      const placeholder: StreamingAssistantMessage = {
        type: "assistant",
        message: {
          id: evt.message?.id,
          content: [],
          _streaming: true,
        },
      };
      // Keep the message_start envelope itself in the array - its
      // `event.message.usage` is the only place we get the initial input /
      // cache token counts during live streaming. Without it, the meter is
      // stuck at zero until the post-reload replay re-injects the same
      // envelopes from the server.
      return [...prev, envelope, placeholder as unknown as Envelope];
    }

    if (evt.type === "content_block_start") {
      const idx = findAssistantByMessageId(prev, evt.message?.id);
      if (idx < 0) return prev;
      const blockIdx = evt.index ?? 0;
      return mutateAssistantAt(prev, idx, (msg) => {
        const blocks = [...(msg.content || [])];
        blocks[blockIdx] = { ...(evt.content_block as ContentBlock) };
        return { ...msg, content: blocks };
      });
    }

    if (evt.type === "content_block_delta") {
      const idx = findAssistantByMessageId(prev, evt.message?.id);
      if (idx < 0) return prev;
      const blockIdx = evt.index ?? 0;
      return mutateAssistantAt(prev, idx, (msg) => {
        const blocks = [...(msg.content || [])];
        const block = (blocks[blockIdx] || {}) as StreamingAssistantBlock;
        const next = { ...block } as StreamingAssistantBlock;
        const delta = evt.delta;
        if (delta?.type === "text_delta") {
          (next as { text?: string }).text =
            ((next as { text?: string }).text || "") + (delta.text || "");
          if (!next.type) (next as { type: string }).type = "text";
        } else if (delta?.type === "thinking_delta") {
          (next as { thinking?: string }).thinking =
            ((next as { thinking?: string }).thinking || "") + (delta.thinking || "");
          if (!next.type) (next as { type: string }).type = "thinking";
        } else if (delta?.type === "input_json_delta") {
          // tool_use input streams as JSON-string fragments; accumulate, parse
          // best-effort whenever the buffer is valid JSON.
          next._partialJson = (next._partialJson || "") + (delta.partial_json || "");
          try {
            (next as { input?: unknown }).input = JSON.parse(next._partialJson);
          } catch {
            /* still incomplete JSON - leave previous parsed value */
          }
        }
        blocks[blockIdx] = next;
        return { ...msg, content: blocks };
      });
    }

    if (evt.type === "message_stop") {
      const idx = findAssistantByMessageId(prev, evt.message?.id);
      if (idx < 0) return prev;
      return mutateAssistantAt(prev, idx, (msg) => ({ ...msg, _streaming: false }));
    }

    if (evt.type === "message_delta") {
      // message_delta carries the canonical per-message usage update (the
      // running output_tokens for this turn). Keep the envelope so
      // computeTokens can read it; otherwise the meter sits at the
      // message_start placeholder value (output_tokens=4 etc) for the
      // entire response.
      return [...prev, envelope];
    }

    // content_block_start/stop and other stream_event subtypes are mutations
    // on the placeholder we already track - no usage info, no need to keep
    // the envelope itself.
    return prev;
  }

  if (env.type === "assistant") {
    // Claude emits the canonical `assistant` envelope BEFORE `message_stop`,
    // so the message is still streaming at this point. Two regressions came
    // out of replacing the placeholder wholesale here:
    //   1. The `_streaming` flag was dropped, making the typewriter snap to
    //      full text the moment this envelope arrived.
    //   2. The final envelope sometimes ships only the `text` content block
    //      (the `thinking` block we accumulated from `thinking_delta`s
    //      disappears), so the thinking section vanished as soon as the
    //      stream finished.
    // Fix: when the placeholder was streaming, keep our delta-accumulated
    // content (it's the authoritative record of every block) and only pull
    // metadata from the incoming envelope. `message_stop` clears `_streaming`
    // and the typewriter then reveals any unrevealed tail instantly.
    const finalMsg = envelope as { message?: { id?: string; _streaming?: boolean } };
    const idx = findAssistantByMessageId(prev, finalMsg.message?.id);
    if (idx >= 0) {
      const prevEnv = prev[idx] as StreamingAssistantMessage;
      const next = [...prev];
      if (prevEnv.message?._streaming) {
        const incoming = envelope as { message?: Record<string, unknown> };
        const incomingMsg = (incoming.message || {}) as Record<string, unknown>;
        const accumulatedContent = prevEnv.message?.content || [];
        const incomingContent = (incomingMsg as { content?: ContentBlock[] }).content;
        // If the canonical envelope happens to carry MORE blocks (e.g. it
        // includes a tool_use we hadn't seen as a stream_event yet), prefer
        // it. Otherwise keep our accumulated blocks so we don't lose a
        // thinking section the canonical envelope omitted.
        const content =
          Array.isArray(incomingContent) && incomingContent.length > accumulatedContent.length
            ? incomingContent
            : accumulatedContent;
        next[idx] = {
          ...envelope,
          message: { ...incomingMsg, content, _streaming: true },
        } as Envelope;
      } else {
        next[idx] = envelope;
      }
      return next;
    }
    return [...prev, envelope];
  }

  return [...prev, envelope];
}

/**
 * Smooth out claude's bursty stream by dripping text/thinking deltas a few
 * characters per frame. Without this, short responses (where claude emits
 * the entire reply in one or two `text_delta` chunks) appear all-at-once.
 * The hook returns a derived envelope list with each actively-streaming
 * text/thinking block clamped to a displayed length that grows toward the
 * server's target via requestAnimationFrame.
 */
function useTypewriterEnvelopes(envelopes: Envelope[]): Envelope[] {
  const lengthsRef = useRef<Map<string, number>>(new Map());
  const envRef = useRef<Envelope[]>(envelopes);
  envRef.current = envelopes;
  const [tick, setTick] = useState(0);
  const rafRef = useRef<number | null>(null);
  const tickFnRef = useRef<(() => void) | null>(null);

  if (!tickFnRef.current) {
    tickFnRef.current = function tickFn() {
      const envs = envRef.current;
      const lengths = lengthsRef.current;
      let needsAnother = false;
      let mutated = false;
      for (let ei = 0; ei < envs.length; ei++) {
        const env = envs[ei];
        if (!env || (env as { type?: string }).type !== "assistant") continue;
        const e = env as StreamingAssistantMessage;
        const streaming = !!e.message?._streaming;
        const blocks = e.message?.content || [];
        for (let bi = 0; bi < blocks.length; bi++) {
          const b = blocks[bi];
          if (!b) continue;
          let key: string;
          let target: string;
          if (b.type === "text") {
            key = `${ei}:${bi}:t`;
            target = (b as { text?: string }).text || "";
          } else if (b.type === "thinking") {
            key = `${ei}:${bi}:th`;
            target = (b as { thinking?: string }).thinking || "";
          } else {
            continue;
          }
          const cur = lengths.get(key) ?? 0;
          if (cur >= target.length) continue;
          if (streaming) {
            // Catch up to target in roughly 0.4s; bigger gaps drip faster.
            const remaining = target.length - cur;
            const step = Math.max(2, Math.ceil(remaining / 24));
            lengths.set(key, Math.min(target.length, cur + step));
            needsAnother = true;
            mutated = true;
          } else {
            // Block is no longer streaming → reveal the rest instantly.
            lengths.set(key, target.length);
            mutated = true;
          }
        }
      }
      if (mutated) setTick((t) => (t + 1) & 0xffff);
      rafRef.current = needsAnother
        ? requestAnimationFrame(tickFnRef.current as FrameRequestCallback)
        : null;
    };
  }

  // Single long-lived RAF loop. Reads envelopes via ref so new server data
  // is picked up without tearing down and rescheduling the loop on every
  // websocket message - a previous version restarted on each envelope
  // change which dropped frames between bursts and hid the streaming.
  useEffect(() => {
    rafRef.current = requestAnimationFrame(tickFnRef.current as FrameRequestCallback);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, []);

  // Wake the loop when new envelopes arrive if it's parked (no pending work).
  useEffect(() => {
    if (rafRef.current == null && envelopes.length > 0) {
      rafRef.current = requestAnimationFrame(tickFnRef.current as FrameRequestCallback);
    }
  }, [envelopes]);

  // Reset lengths when envelopes shrink (e.g., the user starts a new run).
  useEffect(() => {
    if (envelopes.length === 0 && lengthsRef.current.size > 0) {
      lengthsRef.current.clear();
    }
  }, [envelopes.length]);

  return useMemo(() => {
    const lengths = lengthsRef.current;
    return envelopes.map((env, ei) => {
      if (!env || (env as { type?: string }).type !== "assistant") return env;
      const e = env as StreamingAssistantMessage;
      const blocks = e.message?.content || [];
      let changed = false;
      const nextBlocks = blocks.map((b, bi) => {
        if (b.type === "text") {
          const full = (b as { text?: string }).text || "";
          const len = lengths.get(`${ei}:${bi}:t`) ?? full.length;
          if (len < full.length) {
            changed = true;
            return { ...b, text: full.slice(0, len) };
          }
        } else if (b.type === "thinking") {
          const full = (b as { thinking?: string }).thinking || "";
          const len = lengths.get(`${ei}:${bi}:th`) ?? full.length;
          if (len < full.length) {
            changed = true;
            return { ...b, thinking: full.slice(0, len) };
          }
        }
        return b;
      });
      if (!changed) return env;
      return {
        ...e,
        message: { ...e.message, content: nextBlocks },
      } as unknown as Envelope;
    });
    // tick is intentionally a dep so this memo re-runs on each RAF step.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [envelopes, tick]);
}

// ── Page ──────────────────────────────────────────────────────────────

export function Run() {
  const { t } = useTranslation("run");
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const wsConnected = useSyncExternalStore(eventBus.onConnection, () => eventBus.connected);
  // The choice dialog is intentionally shown on every page mount. The header
  // remains a fast switcher once a provider is selected for this visit.
  const [provider, setProvider] = useState<RunProvider | null>(null);
  const [mode, setMode] = useState<RunMode>("conversation");
  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState("");
  const [models, setModels] = useState<ModelChoice[]>([]);
  const [modelsSource, setModelsSource] = useState<string | null>(null);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [permissionMode, setPermissionMode] = useState<PermissionMode | CodexApprovalPolicy>(
    "acceptEdits"
  );
  const [sandbox, setSandbox] = useState<CodexSandbox>("workspace-write");
  const [effort, setEffort] = useState<EffortLevel>("");
  const [cwd, setCwd] = useState("");
  const [resumeSession, setResumeSession] = useState<Session | null>(null);
  const [handle, setHandle] = useState<RunHandle | null>(null);
  const [envelopes, setEnvelopes] = useState<Envelope[]>([]);
  const displayEnvelopes = useTypewriterEnvelopes(envelopes);
  const [followUp, setFollowUp] = useState("");
  const [busy, setBusy] = useState<"start" | "send" | "stop" | "attach" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeRuns, setActiveRuns] = useState<RunListResponse | null>(null);
  const [runHistory, setRunHistory] = useState<DashboardRunHistoryItem[]>([]);
  const [binaryStatus, setBinaryStatus] = useState<{
    found: boolean;
    path: string | null;
    provider: RunProvider;
  } | null>(null);
  const [cwdSuggestions, setCwdSuggestions] = useState<CwdSuggestion[]>([]);
  const [slashCommands, setSlashCommands] = useState<SlashCommand[]>(BUILTIN_SLASH_COMMANDS);

  // Pre-flight: active runs + cwd suggestions on mount. The binary and live
  // model catalog are fetched only after the user chooses a provider.
  useEffect(() => {
    api.run
      .list()
      .then(setActiveRuns)
      .catch(() => undefined);
    api.run
      .history(50)
      .then((r) => setRunHistory(r.items))
      .catch(() => undefined);
    api.run
      .cwds()
      .then((r) => {
        setCwdSuggestions(r.items);
        // Pre-fill cwd with the user's home directory — a neutral default.
        // Spawning in the dashboard's own cwd would make ad-hoc runs inherit
        // this repo's project context (.claude/agents, skills, rules,
        // CLAUDE.md, .mcp.json), which is almost never what an ad-hoc run
        // wants and can bloat the initial request (issue #202). Fall back to
        // the dashboard cwd when no home suggestion exists. The user can
        // change it; we just don't want an invisible default.
        const home = r.items.find((s) => s.kind === "home");
        const dashboard = r.items.find((s) => s.kind === "dashboard");
        const preferred = home || dashboard;
        if (preferred) {
          setCwd((current) => current || preferred.path);
        }
      })
      .catch(() => undefined);
    // Discover user / project / plugin slash commands. The CLI's built-ins
    // are appended client-side.
    Promise.all([api.ccConfig.commands(), api.ccConfig.plugins()])
      .then(([cmdsResp, pluginsResp]) => {
        const userProject = cmdsResp.items.map<SlashCommand>((c) => ({
          name: c.name,
          description: (c.frontmatter?.description as string | undefined) || c.preview.slice(0, 80),
          source: c.scope === "project" ? "project" : "user",
          filePath: c.file,
        }));
        const pluginCmds: SlashCommand[] = [];
        for (const p of pluginsResp.plugins || []) {
          const cmds = p.contributes?.commands ?? 0;
          if (!cmds || !p.installPath) continue;
          // Plugin commands are listed by name only via the plugin's
          // contributions count; we don't enumerate them per-file here. The
          // user can still type the command and the autocomplete from
          // user/project covers most cases. For richer enumeration we'd
          // need a dedicated /plugins/:key/commands endpoint.
        }
        setSlashCommands([...userProject, ...pluginCmds, ...BUILTIN_SLASH_COMMANDS]);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!provider) return;
    setBinaryStatus(null);
    setModels([]);
    setModelsSource(null);
    setModelsLoading(true);
    api.run
      .binary(provider)
      .then(setBinaryStatus)
      .catch(() => setBinaryStatus({ found: false, path: null, provider }));
    api.run
      .models(provider)
      .then((response) => {
        setModels(response.items);
        setModelsSource(response.source);
        const defaultModel = response.items.find((item) => item.isDefault)?.id;
        setModel((current) => current || defaultModel || "");
      })
      .catch(() => setModels([]))
      .finally(() => setModelsLoading(false));
    setMode("conversation");
    setPermissionMode(provider === "codex" ? "on-request" : "acceptEdits");
    setSandbox("workspace-write");
    setResumeSession(null);
  }, [provider]);

  const refreshList = useCallback(() => {
    api.run
      .list()
      .then(setActiveRuns)
      .catch(() => undefined);
    api.run
      .history(50)
      .then((r) => setRunHistory(r.items))
      .catch(() => undefined);
  }, []);

  // Background poll so the run list and history reflect external changes
  // (server-boot reconciliation, sibling tabs, direct DB edits) even when
  // no WS event fires. Lighter than typical WS gaps; aggressive enough that
  // status flips appear within seconds without needing a manual refresh.
  useEffect(() => {
    const tick = setInterval(() => {
      refreshList();
    }, 5000);
    return () => clearInterval(tick);
  }, [refreshList]);

  // Refresh whenever the tab regains focus / visibility - typical when the
  // user comes back from running `claude` in a terminal and wants to see the
  // current state of every run without waiting for the next poll.
  useEffect(() => {
    const onFocus = () => refreshList();
    const onVis = () => {
      if (document.visibilityState === "visible") refreshList();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [refreshList]);

  // Resume a run from the persistent history list. The history item carries
  // the claude session_id; we hydrate it into a Session object via the
  // existing /api/sessions/:id endpoint so the resume picker shows real
  // metadata, then drop the user back into the config card.
  // Resume a past dashboard run. Spawns a fresh `claude --resume <id>` with
  // an empty initial prompt - claude idles on the resumed conversation
  // until the user types a follow-up. The user lands directly in the chat
  // view (the new live handle is attached) instead of being forced back to
  // the config card.
  const onResumeFromHistory = useCallback(
    async (item: DashboardRunHistoryItem) => {
      if (!item.session_id) return;
      if (busy) return;
      setBusy("start");
      setError(null);
      try {
        // Load the past transcript in parallel with spawning so the user
        // doesn't stare at an empty screen - the resumed run starts cold and
        // claude --resume doesn't replay anything over stdout.
        const [fetched, transcript] = await Promise.all([
          api.run.start({
            prompt: "",
            mode: "conversation",
            provider: item.provider,
            cwd: item.cwd || undefined,
            model: item.model || undefined,
            permissionMode: item.permission_mode || undefined,
            sandbox: item.sandbox || undefined,
            effort: item.effort || undefined,
            resumeSessionId: item.session_id,
          }),
          api.sessions
            .transcript(item.session_id, { limit: 200 })
            .catch(() => ({ messages: [] as TranscriptMessage[] })),
        ]);
        setHandle(fetched);
        setProvider(item.provider);
        setEnvelopes(transcriptToEnvelopes(transcript.messages));
        setFollowUp("");
        setResumeSession(null);
        refreshList();
      } catch (err) {
        const msg = err instanceof Error ? err.message : "unknown";
        setError(t("errors.startFailed", { message: msg }));
      } finally {
        setBusy(null);
      }
    },
    [busy, refreshList, t]
  );

  // View a past run inline (no spawn). Headless runs are single-shot, so
  // there's no resume - but the transcript is still worth seeing without
  // navigating away. Seeds the chat view with the past messages and a
  // synthetic completed handle so the UI renders as read-only (no Stop
  // button, no follow-up input - both are gated on isLive).
  const onViewFromHistory = useCallback(
    async (item: DashboardRunHistoryItem) => {
      if (!item.session_id) return;
      if (busy) return;
      setError(null);
      try {
        const transcript = await api.sessions.transcript(item.session_id, { limit: 200 });
        const synthetic: RunHandle = {
          id: item.id,
          provider: item.provider,
          pid: null,
          mode: item.mode,
          cwd: item.cwd,
          model: item.model,
          permissionMode: item.permission_mode || "acceptEdits",
          sandbox: item.sandbox,
          effort: item.effort,
          prompt: item.prompt_preview || "",
          argv: [],
          resumeSessionId: item.resume_session_id,
          status: item.status,
          startedAt: new Date(item.started_at).getTime(),
          endedAt: item.ended_at ? new Date(item.ended_at).getTime() : null,
          exitCode: item.exit_code,
          signal: null,
          error: null,
          sessionId: item.session_id,
          envelopeCount: transcript.messages.length,
          stdoutTail: "",
          stderrTail: "",
        };
        setHandle(synthetic);
        setProvider(item.provider);
        setEnvelopes(transcriptToEnvelopes(transcript.messages));
        setMode(item.mode);
        setFollowUp("");
        setResumeSession(null);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "unknown";
        setError(t("errors.attachFailed", { message: msg }));
      }
    },
    [busy, t]
  );

  // WebSocket subscription - only act on messages for the current handle.
  useEffect(() => {
    return eventBus.subscribe((msg: WSMessage) => {
      if (msg.type === "run_stream") {
        const p = msg.data as RunStreamPayload;
        if (handle && p.id === handle.id) {
          // React auto-batches async setStates, which collapses bursts of
          // stream_event deltas (and the final `assistant` envelope that
          // follows them) into a single render - visually erasing the
          // streaming effect. flushSync forces a commit per envelope so the
          // user sees text_delta / thinking_delta chunks paint as they
          // arrive instead of all at once.
          flushSync(() => {
            setEnvelopes((prev) => mergeEnvelope(prev, p.envelope as Envelope));
          });
        }
      } else if (msg.type === "run_status") {
        const p = msg.data as RunStatusPayload;
        if (handle && p.id === handle.id) {
          setHandle((h) =>
            h
              ? {
                  ...h,
                  status: p.status,
                  endedAt: p.at,
                  exitCode: p.exitCode ?? h.exitCode,
                  sessionId: p.sessionId ?? h.sessionId,
                  error: p.error ?? h.error,
                }
              : h
          );
        }
        refreshList();
      } else if (msg.type === "run_input_ack") {
        const p = msg.data as RunInputAckPayload;
        if (handle && p.id === handle.id) {
          // Optimistically add the user envelope so the chat shows it
          // immediately (the spawned `claude` won't echo our user input
          // back on stdout in stream-json; we own that side).
          setEnvelopes((prev) => [
            ...prev,
            { type: "user", message: { content: followUpRef.current || "" } } as UserMessage,
          ]);
        }
      }
    });
  }, [handle, refreshList]);

  // Keep latest follow-up in a ref so the WS handler can read it without
  // closure staleness during ack injection.
  const followUpRef = useRef("");
  useEffect(() => {
    followUpRef.current = followUp;
  }, [followUp]);

  const start = useCallback(async () => {
    if (!prompt.trim() || busy) return;
    setBusy("start");
    setError(null);
    setEnvelopes([]);
    try {
      // Resume always uses conversation mode (server enforces this too).
      const effectiveMode: RunMode = resumeSession ? "conversation" : mode;
      const effectiveCwd = resumeSession?.cwd || cwd || undefined;
      // Expand /user-or-project slash commands client-side so the model
      // receives the rendered template, matching what the CLI does.
      const expandedPrompt = await maybeExpandSlashCommand(prompt, slashCommands);
      const result = await api.run.start({
        prompt: expandedPrompt,
        mode: effectiveMode,
        cwd: effectiveCwd,
        model: model || undefined,
        permissionMode,
        provider: provider || "claude",
        sandbox: provider === "codex" ? sandbox : undefined,
        resumeSessionId: resumeSession?.id,
        effort: effort || undefined,
      });
      setHandle(result);
      // Optimistic user-turn injection so the chat shows your prompt right away.
      setEnvelopes([{ type: "user", message: { content: prompt } } as UserMessage]);
      refreshList();
    } catch (err: unknown) {
      const m = err instanceof Error ? err.message : "unknown";
      setError(t("errors.startFailed", { message: m }));
    } finally {
      setBusy(null);
    }
  }, [
    prompt,
    mode,
    cwd,
    model,
    permissionMode,
    provider,
    sandbox,
    busy,
    refreshList,
    t,
    resumeSession,
    slashCommands,
  ]);

  const attachToRun = useCallback(
    async (id: string) => {
      if (busy) return;
      setBusy("attach");
      setError(null);
      try {
        const fetched = await api.run.get(id, { envelopes: true });
        const spawnerEnvs = ((fetched.envelopes as Envelope[]) || []).slice();
        let envelopesToUse = spawnerEnvs;

        // The spawner's in-memory envelope log only contains envelopes that
        // came over stdout for this specific spawn. For a resumed run, that
        // means prior history is missing - claude --resume reads the prior
        // transcript as context but doesn't replay it on stdout. Without
        // this, re-attaching to a resumed run after navigating away loses
        // everything from before the resume. The session's JSONL transcript
        // on disk has the full story (prior + current), so we use it
        // whenever it has more user/assistant messages than the spawner has
        // seen; otherwise we keep the spawner's log (which is authoritative
        // for in-progress streaming since stream_event deltas don't land in
        // the transcript file until the turn finishes).
        if (fetched.sessionId) {
          try {
            const transcript = await api.sessions.transcript(fetched.sessionId, { limit: 200 });
            const transcriptEnvs = transcriptToEnvelopes(transcript.messages);
            const spawnerCanonicalCount = spawnerEnvs.filter((e) => {
              const t = (e as { type?: string }).type;
              return t === "user" || t === "assistant";
            }).length;
            if (transcriptEnvs.length > spawnerCanonicalCount) {
              envelopesToUse = transcriptEnvs;
            }
          } catch {
            /* transcript fetch failed - keep the spawner's log */
          }
        }

        setHandle(fetched);
        setProvider(fetched.provider);
        setEnvelopes(envelopesToUse);
        setFollowUp("");
      } catch (err: unknown) {
        const m = err instanceof Error ? err.message : "unknown";
        setError(t("errors.attachFailed", { message: m }));
      } finally {
        setBusy(null);
      }
    },
    [busy, t]
  );

  // Honor `?session=<id>` deep-links from /sessions and /sessions/:id -
  // map the session id to a live run handle and attach to it instead of
  // dropping the user on the new-run config card. Strip the param once
  // consumed so a refresh of the Run page doesn't keep re-attaching.
  const attachAttemptedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const sid = searchParams.get("session");
    if (!sid) return;
    if (handle && handle.sessionId === sid) {
      // Already attached to this session - just clean the URL.
      const next = new URLSearchParams(searchParams);
      next.delete("session");
      setSearchParams(next, { replace: true });
      return;
    }
    if (attachAttemptedRef.current.has(sid)) return;
    attachAttemptedRef.current.add(sid);
    api.run
      .list()
      .then((list) => {
        const target = list.items.find(
          (h) => h.sessionId === sid && (h.status === "running" || h.status === "spawning")
        );
        if (target) {
          void attachToRun(target.id);
        } else {
          setError(
            t(
              "errors.sessionRunNotFound",
              "No active dashboard run is driving this session right now."
            )
          );
        }
      })
      .catch(() => undefined)
      .finally(() => {
        const next = new URLSearchParams(searchParams);
        next.delete("session");
        setSearchParams(next, { replace: true });
      });
  }, [searchParams, setSearchParams, handle, attachToRun, t]);

  // Prefill the prompt box from `?prompt=<text>` (e.g. Tabby's Ask handoff).
  // Apply once, then strip the param so a later refresh doesn't overwrite edits
  // the user has since made to the prompt. When `?autostart=1` is also present
  // (Tabby's "ask" path), arm a pending flag so the run fires automatically
  // once preflight is ready - see the autostart effect below.
  const promptPrefilledRef = useRef(false);
  const pendingAutostartRef = useRef(false);
  useEffect(() => {
    if (promptPrefilledRef.current) return;
    const p = searchParams.get("prompt");
    if (!p) return;
    promptPrefilledRef.current = true;
    if (searchParams.get("autostart") === "1") pendingAutostartRef.current = true;
    setPrompt(p);
    const next = new URLSearchParams(searchParams);
    next.delete("prompt");
    next.delete("autostart");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  // Autostart a deep-linked prompt once preflight has settled. We wait for the
  // binary probe (can't spawn without `claude`), the prefilled prompt, and the
  // defaulted cwd so the spawn matches exactly what the manual Start button
  // would do. Fires at most once; if `claude` isn't found or a run is already
  // in flight, it disarms and leaves the prompt prefilled for a manual Start.
  useEffect(() => {
    if (!pendingAutostartRef.current) return;
    if (binaryStatus === null) return; // probe still pending
    if (!binaryStatus.found) {
      pendingAutostartRef.current = false;
      return;
    }
    if (busy || handle) {
      pendingAutostartRef.current = false;
      return;
    }
    if (!prompt.trim() || !cwd) return; // wait for prefill + cwd default
    pendingAutostartRef.current = false;
    void start();
  }, [binaryStatus, prompt, cwd, busy, handle, start]);

  const send = useCallback(async () => {
    if (!handle || !followUp.trim() || busy) return;
    setBusy("send");
    setError(null);
    try {
      const expanded = await maybeExpandSlashCommand(followUp, slashCommands);
      await api.run.send(handle.id, expanded, handle.provider);
      // The user envelope is appended optimistically when the WS ack arrives
      // (so deduping is consistent with stream order). Clear the input now.
      setFollowUp("");
    } catch (err: unknown) {
      const m = err instanceof Error ? err.message : "unknown";
      setError(t("errors.sendFailed", { message: m }));
    } finally {
      setBusy(null);
    }
  }, [handle, followUp, busy, t, slashCommands]);

  const stop = useCallback(async () => {
    if (!handle || busy) return;
    setBusy("stop");
    setError(null);
    try {
      await api.run.kill(handle.id);
    } catch (err: unknown) {
      const m = err instanceof Error ? err.message : "unknown";
      setError(t("errors.killFailed", { message: m }));
    } finally {
      setBusy(null);
    }
  }, [handle, busy, t]);

  const newRun = useCallback(() => {
    setHandle(null);
    setEnvelopes([]);
    setFollowUp("");
    setPrompt("");
    setResumeSession(null);
    setError(null);
  }, []);

  const status = handle?.status ?? "idle";
  const isLive = status === "spawning" || status === "running";
  const hasFinished = status === "completed" || status === "error" || status === "killed";

  // Only lock the page to the viewport when we're showing a live run session.
  // The config-card screen needs normal page flow so the form is fully
  // reachable on short windows. The run-session screen, however, owns the
  // chat panel and we want long chats to scroll inside the panel - never the
  // page - so we constrain only that case.
  const viewportLocked = !!handle;
  return (
    <div
      className={
        viewportLocked
          ? "h-[calc(100vh-2.5rem)] lg:h-[calc(100vh-3rem)] flex flex-col gap-5"
          : "space-y-5"
      }
    >
      <Header
        provider={provider || "claude"}
        providerLocked={!!handle}
        onProviderChange={(next) => {
          if (handle) return;
          setProvider(next);
          setModel("");
        }}
        activeRuns={activeRuns}
        currentHandleId={handle?.id || null}
        onAttach={attachToRun}
        wsConnected={wsConnected}
        runHistory={runHistory}
        onResumeFromHistory={onResumeFromHistory}
        onViewFromHistory={onViewFromHistory}
        onRefresh={refreshList}
      />

      {provider && binaryStatus && !binaryStatus.found && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span>
            {provider === "codex"
              ? t(
                  "binary.missingCodex",
                  "The `codex` CLI isn't on your PATH. Install Codex CLI or set PATH so the dashboard can spawn it."
                )
              : t("binary.missing")}
          </span>
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span className="flex-1 break-all">{error}</span>
          <button
            onClick={() => setError(null)}
            className="text-red-200/70 hover:text-red-100 p-0.5"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {!provider && (
        <ProviderChooser
          onChoose={setProvider}
          onCancel={() => {
            // A direct deep-link to /run still has the browser's initial
            // about:blank entry. React Router records an `idx` only for
            // actual app navigation, so do not send a first-time visitor
            // back to that blank entry.
            if (Number(window.history.state?.idx) > 0) navigate(-1);
            else navigate("/", { replace: true });
          }}
        />
      )}

      {provider && !handle && <LimitationsBanner />}

      {provider && !handle ? (
        // Config card uses normal page flow - page scrolls if needed.
        <ConfigCard
          provider={provider}
          mode={mode}
          onModeChange={(m) => {
            setMode(m);
            // Headless can't resume - clearing keeps the UI honest if the
            // user had a session pinned and then switched mode.
            if (m === "headless") setResumeSession(null);
          }}
          prompt={prompt}
          onPromptChange={setPrompt}
          cwd={cwd}
          onCwdChange={setCwd}
          cwdSuggestions={cwdSuggestions}
          model={model}
          onModelChange={setModel}
          permissionMode={permissionMode}
          onPermissionModeChange={setPermissionMode}
          sandbox={sandbox}
          onSandboxChange={setSandbox}
          models={models}
          modelsLoading={modelsLoading}
          modelsSource={modelsSource}
          effort={effort}
          onEffortChange={setEffort}
          binaryFound={binaryStatus?.found ?? true}
          busy={busy === "start"}
          onStart={start}
          activeRuns={activeRuns}
          resumeSession={resumeSession}
          onResumeSessionChange={setResumeSession}
          slashCommands={slashCommands}
          runHistory={runHistory}
          onResumeFromHistory={onResumeFromHistory}
        />
      ) : handle ? (
        // Run session is wrapped in a flex container so its inner chat panel
        // can take all remaining viewport height; long chats scroll inside.
        <div className="flex-1 min-h-0 flex flex-col">
          <RunSession
            handle={handle}
            envelopes={displayEnvelopes}
            mode={handle.mode}
            isLive={isLive}
            hasFinished={hasFinished}
            followUp={followUp}
            onFollowUpChange={setFollowUp}
            busy={busy}
            onSend={send}
            onStop={stop}
            onNewRun={newRun}
            slashCommands={slashCommands}
          />
        </div>
      ) : null}
    </div>
  );
}
