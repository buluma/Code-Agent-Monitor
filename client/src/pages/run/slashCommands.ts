/**
 * @file Slash-command catalog shared between Run.tsx (fetches + holds the
 * live list) and its PromptEditor/ConfigForm subcomponents: the built-in
 * list the CLI handles itself, plus client-side expansion of user/project/
 * plugin commands before a prompt is sent. Extracted out of Run.tsx — see
 * SHA-167 — no behavior change.
 * @author Michael Buluma <1452922+buluma@users.noreply.github.com>
 */

import { api } from "../../lib/api";

export interface SlashCommand {
  name: string;
  description?: string;
  source: "builtin" | "user" | "project" | "plugin";
  filePath?: string;
}

// Built-in commands the CLI handles itself. We surface them in autocomplete
// with a "CLI only" tag so users know they won't actually execute when
// sent over stream-json stdin.
export const BUILTIN_SLASH_COMMANDS: SlashCommand[] = [
  { name: "help", description: "List available commands", source: "builtin" },
  { name: "clear", description: "Clear the conversation", source: "builtin" },
  { name: "config", description: "Open the interactive config menu", source: "builtin" },
  { name: "model", description: "Change model mid-session", source: "builtin" },
  { name: "compact", description: "Compact the conversation context", source: "builtin" },
  { name: "memory", description: "Edit CLAUDE.md", source: "builtin" },
  { name: "hooks", description: "Manage hooks", source: "builtin" },
  { name: "cost", description: "Show session cost", source: "builtin" },
  { name: "agents", description: "List subagents", source: "builtin" },
  { name: "review", description: "Review current changes", source: "builtin" },
  { name: "release-notes", description: "Show CC release notes", source: "builtin" },
  { name: "permissions", description: "Edit permission rules", source: "builtin" },
  { name: "status", description: "Show session status", source: "builtin" },
  { name: "init", description: "Initialise CLAUDE.md from codebase", source: "builtin" },
  { name: "login", description: "Sign in to Claude", source: "builtin" },
  { name: "logout", description: "Sign out", source: "builtin" },
  { name: "exit", description: "Exit the session", source: "builtin" },
  { name: "mcp", description: "Manage MCP servers", source: "builtin" },
  { name: "plugin", description: "Manage plugins", source: "builtin" },
  { name: "output-style", description: "Change output style", source: "builtin" },
];

/**
 * Expand a user/project/plugin slash command client-side. Reads the command
 * markdown body via /api/cc-config/file, strips frontmatter, and substitutes
 * `$ARGUMENTS` with whatever the user typed after the command name. If the
 * command isn't user-defined (built-in or unknown), returns the original
 * text unchanged so it still gets sent (the model will see it as text).
 */
export async function maybeExpandSlashCommand(
  text: string,
  commands: SlashCommand[]
): Promise<string> {
  const trimmed = text.trimStart();
  if (!trimmed.startsWith("/")) return text;
  const m = trimmed.match(/^\/([\w:-]+)(?:\s+([\s\S]*))?$/);
  if (!m) return text;
  const [, name, args = ""] = m;
  const cmd = commands.find((c) => c.name === name);
  if (!cmd || cmd.source === "builtin" || !cmd.filePath) return text;
  try {
    const body = await api.ccConfig.file(cmd.filePath);
    let content = body.text;
    // Strip frontmatter if present
    if (content.startsWith("---")) {
      const end = content.indexOf("\n---", 3);
      if (end >= 0) content = content.slice(end + 4).replace(/^\s*\n/, "");
    }
    return content.replace(/\$ARGUMENTS/g, args);
  } catch {
    return text;
  }
}
