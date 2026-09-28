/**
 * src/domains/config/workspace-mode.ts
 *
 * workspace.mode for a root through the full (traced) settings resolver:
 * project settings < local < flags, never inherited. State's workspace
 * `detect` takes this reader by injection, because config sits above state.
 */

import { resolveSettings } from "./settings-resolver";

/** "auto" when the settings cannot be resolved. */
export function resolveWorkspaceMode(root: string): "auto" | "on" | "off" {
  try {
    return resolveSettings({ cwd: root }).config.workspace.mode;
  } catch {
    return "auto";
  }
}
