/**
 * src/modules/config/workflows/workspace-manifest.ts
 *
 * The ONE shared workspace-manifest parser + ancestor-discovery walk (extracted
 * from settings-reader.ts on lane L2 of init-config-goal, §E3/§E8). BOTH the
 * settings resolver (`discoverWorkspace` in settings-reader) and detection
 * (`detectGuildState` in host-open-preflight) bind to THIS single classifier, so
 * the two can never diverge on "what makes a root a workspace root".
 *
 * Kept as a sibling module (not re-exported through settings-reader) so the public
 * settings-resolver shim surface stays unchanged — the parity guard pins that to
 * exactly {resolveSettings, deepMerge, isPlainObject, rigorProfile,
 * initiativeIsWorkspaceScoped}.
 *
 * Module: config — pure detection + node builtins. Crash-free.
 */

import * as fs from "fs";
import * as path from "path";

export interface WorkspaceManifest {
  is_workspace: boolean;
  sub_guilds?: Array<{ name: string; path: string; kind?: string }>;
}

export interface DiscoveredWorkspace {
  /** Absolute path to the workspace root directory. */
  rootDir: string;
  /** The parsed workspace.json manifest. */
  manifest: WorkspaceManifest;
}

/**
 * Classification of a single `.guild/workspace.json` candidate. This is the ONE
 * shared interpretation both the resolver and detection bind to (ADR
 * config-surface-and-inheritance §"Decision 2/6", spec §E8).
 *
 * - `absent`        — no file at this path.
 * - `parse_error`   — file exists but JSON.parse threw (F4: the resolver SKIPs and
 *                     keeps walking; detection at cwd → malformed_workspace_json).
 * - `not_workspace` — parsed but `is_workspace !== true` (false or missing): a
 *                     deliberate opt-out. Resolver STOPs the ancestor walk;
 *                     detection at cwd → malformed_workspace_json (closes the V1
 *                     hole where a present-but-invalid manifest fell through to
 *                     single_project).
 * - `workspace`     — parsed with `is_workspace === true`: a valid workspace root.
 */
export type ParsedWorkspaceManifest =
  | { status: "absent" }
  | { status: "parse_error"; error: string }
  | { status: "not_workspace" }
  | { status: "workspace"; manifest: WorkspaceManifest };

/**
 * Read + classify a single `.guild/workspace.json` candidate, crash-free. The
 * SINGLE source of truth for the workspace-root interpretation shared by the
 * resolver and detection. Callers apply their own control flow (skip vs stop vs
 * needs_repair) on the returned status — but never re-implement the parse/shape
 * decision.
 */
export function parseWorkspaceManifest(manifestPath: string): ParsedWorkspaceManifest {
  let raw: string;
  try {
    if (!fs.existsSync(manifestPath)) return { status: "absent" };
    raw = fs.readFileSync(manifestPath, "utf8");
  } catch (e) {
    // Unreadable file (perms, race) → parse_error: never crash.
    return { status: "parse_error", error: e instanceof Error ? e.message : String(e) };
  }
  let manifest: WorkspaceManifest;
  try {
    manifest = JSON.parse(raw) as WorkspaceManifest;
  } catch (e) {
    return { status: "parse_error", error: e instanceof Error ? e.message : String(e) };
  }
  if (manifest && manifest.is_workspace === true) {
    return { status: "workspace", manifest };
  }
  return { status: "not_workspace" };
}

/**
 * Walk up from `startDir` (EXCLUSIVE of cwd) to find the nearest ancestor with
 * `.guild/workspace.json` where `is_workspace: true`. Returns null when none is
 * found up to the filesystem root.
 *
 * FIX (F4): a malformed workspace.json (parse error) never stops the walk — we
 * continue up. Only `is_workspace: false`/missing (a deliberate opt-out) stops it.
 *
 * Exclusive-of-cwd (§E8): the walk starts at `dirname(startDir)`, so a session
 * started AT a workspace root never discovers its OWN manifest here (it loads its
 * own settings as `project`). Detection's inclusive-of-cwd check lives in
 * `detectGuildState` and shares the SAME `parseWorkspaceManifest` classifier.
 */
export function discoverWorkspace(startDir: string): DiscoveredWorkspace | null {
  let current = path.dirname(startDir);
  const fsRoot = path.parse(current).root;

  while (current !== fsRoot) {
    const manifestPath = path.join(current, ".guild", "workspace.json");
    const parsed = parseWorkspaceManifest(manifestPath);
    if (parsed.status === "workspace") {
      return { rootDir: current, manifest: parsed.manifest };
    }
    if (parsed.status === "not_workspace") {
      // is_workspace false/missing — deliberate stop, do NOT continue (F4 unchanged).
      return null;
    }
    // absent OR parse_error → keep walking up (F4: malformed never stops the walk).
    const parent = path.dirname(current);
    if (parent === current) break; // reached fs root
    current = parent;
  }
  return null;
}
