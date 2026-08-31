/**
 * @file Renders a single run's transcript stream — envelope-type dispatch,
 * turn rendering (user/assistant/thinking/tool-use/tool-result), the empty
 * and status states, and the completed-run footer. Presentational leaf
 * components extracted out of Run.tsx (see SHA-167) with no behavior change.
 * @author Michael Buluma <1452922+buluma@users.noreply.github.com>
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Play,
  Square,
  RefreshCw,
  Sparkles,
  Terminal,
  ChevronDown,
  ChevronRight,
  Wrench,
  CheckCircle2,
  XCircle,
  Clock,
  CircleDollarSign,
  Hash,
} from "lucide-react";
import type { RunMode } from "../../lib/api";
import { MarkdownContent } from "../../components/conversation/MarkdownContent";
import type {
  ContentBlock,
  AssistantMessage,
  UserMessage,
  ResultEnvelope,
  Envelope,
} from "./envelopeTypes";

export function EmptyStream({ isLive }: { isLive: boolean }) {
  const { t } = useTranslation("run");
  if (isLive) {
    return (
      <div className="text-center py-12 text-gray-500 flex flex-col items-center gap-2">
        <RefreshCw className="w-5 h-5 animate-spin" />
        <span className="text-xs">{t("status.spawning")}</span>
      </div>
    );
  }
  return (
    <div className="text-center py-12 flex flex-col items-center gap-2">
      <Sparkles className="w-6 h-6 text-gray-600" />
      <div className="text-sm font-medium text-gray-400">{t("empty.title")}</div>
      <div className="text-xs text-gray-500 max-w-md">{t("empty.body")}</div>
    </div>
  );
}

export function StatusPill({ status }: { status: string }) {
  const { t } = useTranslation("run");
  const idle = { color: "bg-surface-3 text-gray-400 border-border", icon: Clock as typeof Play };
  const config: Record<string, { color: string; icon: typeof Play }> = {
    spawning: { color: "bg-amber-500/15 text-amber-300 border-amber-500/30", icon: RefreshCw },
    running: { color: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30", icon: Sparkles },
    completed: {
      color: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
      icon: CheckCircle2,
    },
    error: { color: "bg-red-500/15 text-red-300 border-red-500/30", icon: XCircle },
    killed: { color: "bg-gray-500/15 text-gray-400 border-gray-500/30", icon: Square },
    abandoned: {
      color: "bg-orange-500/10 text-orange-300 border-orange-500/30",
      icon: Square,
    },
    idle,
  };
  const c = config[status] ?? idle;
  const Icon = c.icon;
  const animate = status === "spawning" || status === "running";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium border ${c.color}`}
    >
      <Icon
        className={`w-3 h-3 ${animate ? (status === "spawning" ? "animate-spin" : "animate-pulse") : ""}`}
      />
      {t(`status.${status}`)}
    </span>
  );
}

export function ModeBadge({ mode }: { mode: RunMode }) {
  const { t } = useTranslation("run");
  return (
    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-surface-3 text-gray-400 border border-border inline-flex items-center gap-1">
      {mode === "conversation" ? (
        <Terminal className="w-3 h-3" />
      ) : (
        <Sparkles className="w-3 h-3" />
      )}
      {t(`mode.${mode}`)}
    </span>
  );
}

// ── Envelope rendering ───────────────────────────────────────────────

export function EnvelopeRow({ envelope }: { envelope: Envelope }) {
  if (!envelope || typeof envelope !== "object") return null;
  switch (envelope.type) {
    case "user":
      return <UserTurn env={envelope as UserMessage} />;
    case "assistant":
      return <AssistantTurn env={envelope as AssistantMessage} />;
    case "system":
      return null; // init metadata is shown in the toolbar
    case "result":
      return null; // shown in the footer
    case "stream_event":
      return null; // kept in state for token accounting only - never rendered
    case "codex_assistant":
      return <CodexAssistantTurn env={envelope as { text?: string; streaming?: boolean }} />;
    case "codex_reasoning":
      return <ThinkingBlock text={String((envelope as { text?: string }).text || "")} />;
    case "codex_tool":
      return <CodexToolEvent env={envelope as Record<string, unknown>} />;
    default:
      // Unknown envelope: render compact JSON for transparency
      return <UnknownTurn env={envelope} />;
  }
}

function CodexAssistantTurn({ env }: { env: { text?: string; streaming?: boolean } }) {
  const { t } = useTranslation("run");
  const text = env.text || "";
  if (!text) return null;
  return (
    <div className="flex gap-3">
      <Avatar tone="accent" letter="G" />
      <div className="min-w-0 flex-1">
        <div className="mb-1 text-[11px] font-semibold text-accent">
          {t("provider.codex.label", "Codex")}
          {env.streaming && (
            <span className="ml-2 text-[10px] font-normal text-gray-500">
              {t("status.running")}
            </span>
          )}
        </div>
        <div className="prose-claude text-sm leading-relaxed text-gray-200">
          <MarkdownContent text={text} />
        </div>
      </div>
    </div>
  );
}

function CodexToolEvent({ env }: { env: Record<string, unknown> }) {
  const [open, setOpen] = useState(false);
  const name = String(env.name || "Tool");
  const command = typeof env.command === "string" ? env.command : "";
  const output = typeof env.output === "string" ? env.output : "";
  const exitCode = typeof env.exitCode === "number" ? env.exitCode : null;
  const details = command || output || JSON.stringify(env.changes || env, null, 2);
  return (
    <div className="rounded-md border border-amber-500/30 bg-amber-500/5">
      <button
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[11px] font-medium text-amber-200 hover:bg-amber-500/10"
      >
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        <Wrench className="h-3 w-3" />
        <span>{name}</span>
        {command && <span className="truncate font-mono text-gray-500">· {command}</span>}
        {exitCode != null && (
          <span className={exitCode === 0 ? "ml-auto text-emerald-300" : "ml-auto text-red-300"}>
            {exitCode === 0 ? "OK" : `Exit ${exitCode}`}
          </span>
        )}
      </button>
      {open && (
        <pre className="max-h-72 overflow-auto border-t border-amber-500/30 px-3 py-2 text-[11px] text-gray-300 whitespace-pre-wrap break-words">
          {details}
        </pre>
      )}
    </div>
  );
}

function extractText(content: ContentBlock[] | string | undefined): string {
  if (!content) return "";
  if (typeof content === "string") return content;
  return content
    .filter((b): b is ContentBlock & { type: "text" } => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}

function UserTurn({ env }: { env: UserMessage }) {
  const { t } = useTranslation("run");
  const content = env.message?.content;

  // Tool results live inside user.message.content as { type: "tool_result", ... }.
  const toolResults = Array.isArray(content)
    ? (content.filter((b) => b.type === "tool_result") as Extract<
        ContentBlock,
        { type: "tool_result" }
      >[])
    : [];
  const text = extractText(content);

  if (toolResults.length > 0 && !text) {
    return (
      <div className="space-y-2">
        {toolResults.map((tr, i) => (
          <ToolResultBlock key={i} result={tr} />
        ))}
      </div>
    );
  }

  return (
    <div className="flex gap-3">
      <Avatar tone="indigo" letter={t("events.you").charAt(0)} />
      <div className="flex-1 min-w-0">
        <div className="text-[11px] font-semibold text-indigo-300 mb-1">{t("events.you")}</div>
        <div className="rounded-lg border border-indigo-500/20 bg-indigo-500/5 px-3 py-2 text-sm text-gray-200 whitespace-pre-wrap break-words">
          {text || "-"}
        </div>
      </div>
    </div>
  );
}

function AssistantTurn({ env }: { env: AssistantMessage }) {
  const { t } = useTranslation("run");
  const content = env.message?.content;
  const blocks = Array.isArray(content)
    ? content
    : content
      ? [{ type: "text", text: content } as ContentBlock]
      : [];
  const text = blocks
    .filter((b): b is ContentBlock & { type: "text" } => b.type === "text")
    .map((b) => b.text)
    .join("\n");
  const toolUses = blocks.filter(
    (b): b is ContentBlock & { type: "tool_use" } => b.type === "tool_use"
  );
  const thinking = blocks.filter(
    (b): b is ContentBlock & { type: "thinking" } => b.type === "thinking"
  );

  return (
    <div className="flex gap-3">
      <Avatar tone="accent" letter="C" />
      <div className="flex-1 min-w-0 space-y-2">
        <div className="text-[11px] font-semibold text-accent mb-1">{t("events.claude")}</div>
        {thinking.map((th, i) => (
          <ThinkingBlock key={`th-${i}`} text={th.thinking || ""} />
        ))}
        {text && (
          <div className="text-sm text-gray-200 leading-relaxed prose-claude">
            <MarkdownContent text={text} />
          </div>
        )}
        {toolUses.map((tu) => (
          <ToolUseBlock key={tu.id} toolUse={tu} />
        ))}
      </div>
    </div>
  );
}

function ThinkingBlock({ text }: { text: string }) {
  const { t } = useTranslation("run");
  const [open, setOpen] = useState(false);
  if (!text) return null;
  return (
    <div className="rounded-md border border-violet-500/20 bg-violet-500/5">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-2.5 py-1.5 text-[11px] font-medium text-violet-300 hover:bg-violet-500/10 transition-colors"
      >
        {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        <Sparkles className="w-3 h-3" />
        {t("events.thinking")}
      </button>
      {open && (
        <pre className="px-3 py-2 text-[11px] font-mono text-violet-200/80 whitespace-pre-wrap break-words border-t border-violet-500/20">
          {text}
        </pre>
      )}
    </div>
  );
}

function ToolUseBlock({ toolUse }: { toolUse: Extract<ContentBlock, { type: "tool_use" }> }) {
  const { t } = useTranslation("run");
  const [open, setOpen] = useState(false);
  const summary = describeToolInput(toolUse.input);
  return (
    <div className="rounded-md border border-amber-500/30 bg-amber-500/5">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-2.5 py-1.5 text-[11px] font-medium hover:bg-amber-500/10 transition-colors text-left"
      >
        {open ? (
          <ChevronDown className="w-3 h-3 text-amber-300 flex-shrink-0" />
        ) : (
          <ChevronRight className="w-3 h-3 text-amber-300 flex-shrink-0" />
        )}
        <Wrench className="w-3 h-3 text-amber-300 flex-shrink-0" />
        <span className="font-mono text-amber-200">{toolUse.name}</span>
        {summary && <span className="text-gray-500 truncate">· {summary}</span>}
        <span className="text-[10px] text-gray-600 ml-auto">{t("events.tool")}</span>
      </button>
      {open && (
        <pre className="px-3 py-2 text-[11px] font-mono text-gray-300 whitespace-pre-wrap break-words border-t border-amber-500/30 max-h-72 overflow-auto">
          {JSON.stringify(toolUse.input, null, 2)}
        </pre>
      )}
    </div>
  );
}

function ToolResultBlock({ result }: { result: Extract<ContentBlock, { type: "tool_result" }> }) {
  const { t } = useTranslation("run");
  const [open, setOpen] = useState(false);
  const text =
    typeof result.content === "string"
      ? result.content
      : Array.isArray(result.content)
        ? result.content
            .map((c) => {
              if (c == null) return "";
              if (typeof c === "string") return c;
              const obj = c as { text?: string };
              return obj.text || JSON.stringify(c);
            })
            .join("\n")
        : JSON.stringify(result.content);
  const lines = text.split("\n").length;
  const tone = result.is_error
    ? "border-red-500/30 bg-red-500/5 text-red-200"
    : "border-emerald-500/20 bg-emerald-500/5 text-emerald-200";
  return (
    <div className={`rounded-md border ${tone}`}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-2.5 py-1.5 text-[11px] font-medium hover:bg-white/5 transition-colors text-left"
      >
        {open ? (
          <ChevronDown className="w-3 h-3 flex-shrink-0" />
        ) : (
          <ChevronRight className="w-3 h-3 flex-shrink-0" />
        )}
        {result.is_error ? (
          <XCircle className="w-3 h-3 flex-shrink-0" />
        ) : (
          <CheckCircle2 className="w-3 h-3 flex-shrink-0" />
        )}
        <span>{t("events.toolResult")}</span>
        <span className="text-[10px] opacity-70">
          ({lines} {lines === 1 ? "line" : "lines"})
        </span>
      </button>
      {open && (
        <pre className="px-3 py-2 text-[11px] font-mono whitespace-pre-wrap break-words border-t border-current/20 max-h-72 overflow-auto opacity-90">
          {text}
        </pre>
      )}
    </div>
  );
}

function UnknownTurn({ env }: { env: Envelope }) {
  return (
    <details className="rounded-md border border-border bg-surface-2 px-2.5 py-1.5">
      <summary className="text-[10px] font-mono text-gray-500 cursor-pointer">
        {(env.type as string) || "?"}
      </summary>
      <pre className="mt-2 text-[10px] font-mono text-gray-400 whitespace-pre-wrap break-words max-h-48 overflow-auto">
        {JSON.stringify(env, null, 2)}
      </pre>
    </details>
  );
}

function Avatar({ tone, letter }: { tone: "accent" | "indigo"; letter: string }) {
  const cls =
    tone === "accent"
      ? "bg-accent/15 text-accent border-accent/30"
      : "bg-indigo-500/15 text-indigo-300 border-indigo-500/30";
  return (
    <div
      className={`w-7 h-7 rounded-md border flex items-center justify-center text-[11px] font-bold flex-shrink-0 ${cls}`}
    >
      {letter}
    </div>
  );
}

function describeToolInput(input: unknown): string {
  if (!input || typeof input !== "object") return "";
  const obj = input as Record<string, unknown>;
  // Common Claude Code tool inputs: file_path, path, command, pattern…
  for (const k of ["file_path", "path", "command", "pattern", "url", "name"]) {
    const v = obj[k];
    if (typeof v === "string" && v) return v.length > 80 ? v.slice(0, 80) + "…" : v;
  }
  return "";
}

export function ResultFooter({ result }: { result: ResultEnvelope }) {
  const { t } = useTranslation("run");
  const isError = result.is_error;
  return (
    <div
      className={`border-t px-4 py-2.5 flex items-center gap-4 flex-wrap text-[11px] ${
        isError
          ? "border-red-500/30 bg-red-500/5 text-red-200"
          : "border-emerald-500/20 bg-emerald-500/5 text-emerald-200"
      }`}
    >
      {isError ? (
        <span className="font-medium inline-flex items-center gap-1.5">
          <XCircle className="w-3.5 h-3.5" />
          {t("status.error")}
        </span>
      ) : (
        <span className="font-medium inline-flex items-center gap-1.5">
          <CheckCircle2 className="w-3.5 h-3.5" />
          {t("status.completed")}
        </span>
      )}
      {typeof result.duration_ms === "number" && (
        <Stat
          icon={Clock}
          label={t("footer.duration")}
          value={`${(result.duration_ms / 1000).toFixed(1)}s`}
        />
      )}
      {typeof result.total_cost_usd === "number" && (
        <Stat
          icon={CircleDollarSign}
          label={t("footer.cost")}
          value={`$${result.total_cost_usd.toFixed(4)}`}
        />
      )}
      {typeof result.num_turns === "number" && (
        <Stat icon={Hash} label={t("footer.turns")} value={String(result.num_turns)} />
      )}
    </div>
  );
}

function Stat({ icon: Icon, label, value }: { icon: typeof Clock; label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <Icon className="w-3 h-3 opacity-70" />
      <span className="opacity-80">{label}:</span>
      <span className="font-mono">{value}</span>
    </span>
  );
}
