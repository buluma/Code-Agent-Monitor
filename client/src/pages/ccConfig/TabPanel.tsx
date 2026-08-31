/**
 * @file Dispatches the active tab key to its panel component. Extracted out
 * of CcConfig.tsx — see SHA-167 — no behavior change.
 * @author Michael Buluma <1452922+buluma@users.noreply.github.com>
 */

import type { CcArtifactType, CcMemoryItem } from "../../lib/api";
import type { PageState, TabKey } from "./types";
import type { Toast } from "./types";
import { OverviewPanel } from "./OverviewPanel";
import { MdItemList } from "./MdItemList";
import { PluginsPanel } from "./PluginsPanel";
import { MarketplacesPanel } from "./MarketplacesPanel";
import { McpPanel } from "./McpPanel";
import { HooksPanel } from "./HooksPanel";
import { KeybindingsPanel } from "./KeybindingsPanel";
import { SettingsPanel } from "./SettingsPanel";
import { MemoryPanel } from "./MemoryPanel";

// ── Tab panel switch ──────────────────────────────────────────────────

interface TabPanelProps {
  tab: TabKey;
  data: PageState;
  search: string;
  onTabChange: (tab: TabKey) => void;
  onOpenFile: (path: string) => void;
  onEdit: (
    type: CcArtifactType,
    item: { scope: "user" | "project"; name: string; filePath: string }
  ) => void;
  onDelete: (
    type: CcArtifactType,
    scope: "user" | "project",
    name: string | undefined,
    path: string
  ) => void;
  onCreateMemory: (scope: "user" | "project") => void;
  onEditAuto: (item: CcMemoryItem) => void;
  onDeleteAuto: (item: CcMemoryItem) => void;
  onCreateAuto: (project: string) => void;
  onKeybindingsSaved: () => void;
  onToast: (toast: NonNullable<Toast>) => void;
}

export function TabPanel({
  tab,
  data,
  search,
  onTabChange,
  onOpenFile,
  onEdit,
  onDelete,
  onCreateMemory,
  onEditAuto,
  onDeleteAuto,
  onCreateAuto,
  onKeybindingsSaved,
  onToast,
}: TabPanelProps) {
  switch (tab) {
    case "overview":
      return <OverviewPanel overview={data.overview} onTabChange={onTabChange} />;
    case "skills":
      return (
        <MdItemList
          items={data.skills}
          search={search}
          onOpen={onOpenFile}
          onEdit={onEdit}
          onDelete={onDelete}
          kind="skills"
        />
      );
    case "agents":
      return (
        <MdItemList
          items={data.agents}
          search={search}
          onOpen={onOpenFile}
          onEdit={onEdit}
          onDelete={onDelete}
          kind="agents"
        />
      );
    case "commands":
      return (
        <MdItemList
          items={data.commands}
          search={search}
          onOpen={onOpenFile}
          onEdit={onEdit}
          onDelete={onDelete}
          kind="commands"
        />
      );
    case "outputStyles":
      return (
        <MdItemList
          items={data.outputStyles}
          search={search}
          onOpen={onOpenFile}
          onEdit={onEdit}
          onDelete={onDelete}
          kind="outputStyles"
        />
      );
    case "plugins":
      return <PluginsPanel data={data.plugins} search={search} />;
    case "marketplaces":
      return <MarketplacesPanel data={data.marketplaces} search={search} />;
    case "mcp":
      return <McpPanel data={data.mcp} search={search} />;
    case "hooks":
      return (
        <HooksPanel
          sources={data.hooks}
          scripts={data.hookScripts}
          search={search}
          onOpen={onOpenFile}
        />
      );
    case "keybindings":
      return (
        <KeybindingsPanel
          data={data.keybindings}
          search={search}
          onSaved={onKeybindingsSaved}
          onToast={onToast}
        />
      );
    case "settings":
      return (
        <SettingsPanel sources={data.settings} statusline={data.statusline} onOpen={onOpenFile} />
      );
    case "memory":
      return (
        <MemoryPanel
          items={data.memory}
          search={search}
          onOpen={onOpenFile}
          onEdit={onEdit}
          onDelete={onDelete}
          onCreate={onCreateMemory}
          onEditAuto={onEditAuto}
          onDeleteAuto={onDeleteAuto}
          onCreateAuto={onCreateAuto}
        />
      );
    default:
      return null;
  }
}
