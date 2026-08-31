/**
 * @file Stream-json envelope shapes shared across Run.tsx and its transcript
 * rendering subcomponents (the bits of the `claude`/Codex stream-json output
 * the dashboard understands and renders). Extracted verbatim out of Run.tsx —
 * see SHA-167 — no shape changed.
 * @author Michael Buluma <1452922+buluma@users.noreply.github.com>
 */

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "thinking"; thinking?: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: unknown; is_error?: boolean };

export interface AssistantMessage {
  type: "assistant";
  message?: {
    content?: ContentBlock[] | string;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
    };
  };
}
export interface UserMessage {
  type: "user";
  message?: { content?: ContentBlock[] | string };
}
export interface SystemInit {
  type: "system";
  subtype: "init";
  session_id?: string;
  model?: string;
  cwd?: string;
  tools?: string[];
  permissionMode?: string;
}
export interface ResultEnvelope {
  type: "result";
  subtype?: string;
  is_error?: boolean;
  duration_ms?: number;
  duration_api_ms?: number;
  num_turns?: number;
  result?: string;
  session_id?: string;
  total_cost_usd?: number;
  usage?: { input_tokens?: number; output_tokens?: number };
}
export type Envelope =
  | AssistantMessage
  | UserMessage
  | SystemInit
  | ResultEnvelope
  | { type: string; [k: string]: unknown };

export interface CodexEventEnvelope {
  type: "codex_event";
  method: string;
  params?: Record<string, unknown>;
}
