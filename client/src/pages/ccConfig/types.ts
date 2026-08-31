/**
 * @file Local editor/modal state shapes and the tab/page-data model shared
 * between CcConfig.tsx and its extracted widget/panel components. Extracted
 * verbatim out of CcConfig.tsx — see SHA-167 — no shape changed.
 * @author Michael Buluma <1452922+buluma@users.noreply.github.com>
 */

import {
  Boxes,
  Sparkles,
  UserRound,
  Slash,
  BookOpen,
  PlugZap,
  Store,
  Server,
  Webhook,
  Keyboard,
  Settings as SettingsIcon,
  Palette,
} from "lucide-react";
import type {
  CcArtifactType,
  CcOverview,
  CcMdItem,
  CcPluginsResponse,
  CcMarketplacesResponse,
  CcMcpResponse,
  CcHookSource,
  CcKeybindings,
  CcSettingsSource,
  CcMemoryItem,
  CcStatusline,
  CcHookScripts,
} from "../../lib/api";

export type TabKey =
  | "overview"
  | "skills"
  | "agents"
  | "commands"
  | "outputStyles"
  | "plugins"
  | "marketplaces"
  | "mcp"
  | "hooks"
  | "keybindings"
  | "settings"
  | "memory";

export interface TabDef {
  key: TabKey;
  icon: typeof Sparkles;
  i18nKey: string;
}

export const TABS: TabDef[] = [
  { key: "overview", icon: Boxes, i18nKey: "tabs.overview" },
  { key: "skills", icon: Sparkles, i18nKey: "tabs.skills" },
  { key: "agents", icon: UserRound, i18nKey: "tabs.agents" },
  { key: "commands", icon: Slash, i18nKey: "tabs.commands" },
  { key: "memory", icon: BookOpen, i18nKey: "tabs.memory" },
  { key: "plugins", icon: PlugZap, i18nKey: "tabs.plugins" },
  { key: "marketplaces", icon: Store, i18nKey: "tabs.marketplaces" },
  { key: "mcp", icon: Server, i18nKey: "tabs.mcp" },
  { key: "hooks", icon: Webhook, i18nKey: "tabs.hooks" },
  { key: "keybindings", icon: Keyboard, i18nKey: "tabs.keybindings" },
  { key: "settings", icon: SettingsIcon, i18nKey: "tabs.settings" },
  { key: "outputStyles", icon: Palette, i18nKey: "tabs.outputStyles" },
];

export interface PageState {
  overview: CcOverview | null;
  skills: CcMdItem[] | null;
  agents: CcMdItem[] | null;
  commands: CcMdItem[] | null;
  outputStyles: CcMdItem[] | null;
  plugins: CcPluginsResponse | null;
  marketplaces: CcMarketplacesResponse | null;
  mcp: CcMcpResponse | null;
  hooks: CcHookSource[] | null;
  keybindings: CcKeybindings | null;
  settings: CcSettingsSource[] | null;
  memory: CcMemoryItem[] | null;
  statusline: CcStatusline | null;
  hookScripts: CcHookScripts | null;
}

export type EditorState =
  | {
      mode: "create";
      type: CcArtifactType;
      defaultScope: "user" | "project";
      template: string;
      project?: string; // set for type === "auto-memory"
    }
  | {
      mode: "edit";
      type: CcArtifactType;
      scope: "user" | "project" | "auto-memory";
      name: string;
      filePath: string;
      project?: string; // set for type === "auto-memory"
    }
  | null;

export type ConfirmDeleteState = {
  type: CcArtifactType;
  scope: "user" | "project" | "auto-memory";
  name?: string;
  path: string;
  project?: string; // set for type === "auto-memory"
} | null;

export type Toast = { kind: "success" | "error"; message: string } | null;
