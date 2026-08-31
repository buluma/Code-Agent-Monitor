/**
 * @file Local editor/modal state shapes shared between CcConfig.tsx and its
 * extracted widget components (Widgets.tsx). Extracted verbatim out of
 * CcConfig.tsx — see SHA-167 — no shape changed.
 * @author Michael Buluma <1452922+buluma@users.noreply.github.com>
 */

import type { CcArtifactType } from "../../lib/api";

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
