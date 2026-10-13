/**
 * workflow-graph-load.ts — the LOAD half of "lifecycle owns load/merge/validate"
 * (KTD40/KTD56/R68).
 *
 * One authored graph per class ships as YAML DATA at `src/surfaces/graphs/<class>.yaml`
 * (projected to `graphs/<class>.yaml` in a host package). A project may overlay
 * `.guild/graphs/<class>.yaml`. Neither is a skill, neither is TypeScript, and the
 * authored `loops/registry.yaml` / `workflows/registry.yaml` files are NOT the
 * source of truth for routing — station ids live on the merged graph's nodes.
 *
 * Loading is fail-CLOSED in both directions, which is the only interesting design
 * choice in the file:
 *
 *   - A missing or unparseable PLUGIN default is an error. The five classes are a
 *     closed set the plugin ships; if one cannot be read, the install is broken and
 *     routing a run through a half-graph is worse than refusing.
 *   - A present but INVALID project overlay is also an error, and deliberately not
 *     "ignore the overlay and use the default". A project that authored an overlay
 *     dropping `product.qa` must be told, not silently and invisibly corrected —
 *     the operator would keep believing their overlay is in force.
 *   - A merged graph is validated as a DOCUMENT and as a MERGE. The document check
 *     catches an unauthored class or a dangling edge; the merge check is the KTD42
 *     gate floor, and `applyWorkflowGraphOverlay` throws on a violation.
 */

import * as fs from "node:fs";
import * as path from "node:path";

// The SHARED parser (OD-3). `loadYamlApi` resolves js-yaml plugin-locally first,
// so a generated host package parses graphs with its own vendored copy rather
// than whatever a consumer repo happens to have installed.
import { loadYamlApi, resolvePluginRoot } from "../kernel";
import { createGuildStorage, type GuildStorage } from "../state";
import {
  WORKFLOW_CLASSES,
  applyWorkflowGraphOverlay,
  validateWorkflowGraphDocument,
  type WorkflowClass,
  type WorkflowGraph,
} from "./workflow-graph-overlay";

/** Where the five authored defaults live, relative to a plugin root. */
export const PLUGIN_GRAPH_DIRS = Object.freeze([
  path.join("src", "surfaces", "graphs"),
  "graphs",
] as const);

/** Where a project overlay lives, relative to the durable definition tree. */
export const OVERLAY_GRAPH_SEGMENT = "graphs" as const;

export interface LoadGraphOptions {
  /** Plugin install root. Defaults to the host's advertised plugin root. */
  pluginRoot?: string;
  /** The consuming repo. Used only to resolve the overlay. */
  cwd?: string;
  /** Pre-built storage (tests, or a caller that already has one). */
  storage?: GuildStorage;
  /** Skip the project overlay entirely (plugin self-checks, fixtures). */
  ignoreOverlay?: boolean;
}

export class WorkflowGraphLoadError extends Error {}

function pluginRootFor(explicit?: string): string {
  return explicit ? explicit : resolvePluginRoot(__dirname);
}

function readYamlGraph(file: string): WorkflowGraph {
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (err) {
    throw new WorkflowGraphLoadError(`cannot read class graph at ${file}: ${(err as Error).message}`);
  }
  let parsed: unknown;
  try {
    parsed = loadYamlApi().load(text);
  } catch (err) {
    throw new WorkflowGraphLoadError(`class graph at ${file} is not valid YAML: ${(err as Error).message}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new WorkflowGraphLoadError(`class graph at ${file} is not a mapping`);
  }
  return parsed as WorkflowGraph;
}

/** Absolute path of the plugin default for one class, or null when absent. */
export function pluginGraphPath(klass: WorkflowClass, pluginRoot?: string): string | null {
  const root = pluginRootFor(pluginRoot);
  for (const dir of PLUGIN_GRAPH_DIRS) {
    for (const ext of [".yaml", ".yml"]) {
      const p = path.join(root, dir, `${klass}${ext}`);
      if (fs.existsSync(p)) return p;
    }
  }
  return null;
}

/** Absolute path of the project overlay for one class, or null when absent. */
export function overlayGraphPath(klass: WorkflowClass, opts: LoadGraphOptions = {}): string | null {
  let storage: GuildStorage;
  try {
    storage = opts.storage ?? createGuildStorage(opts.cwd ?? process.cwd());
  } catch {
    return null;
  }
  for (const ext of [".yaml", ".yml"]) {
    const p = storage.definition(OVERLAY_GRAPH_SEGMENT, `${klass}${ext}`);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

export interface LoadedClassGraph {
  class: WorkflowClass;
  graph: WorkflowGraph;
  defaultPath: string;
  overlayPath: string | null;
}

/**
 * Load, merge and validate one class graph. Throws `WorkflowGraphLoadError` on a
 * missing default, and the overlay validator's own error on an illegal overlay.
 */
export function loadClassGraph(klass: WorkflowClass, opts: LoadGraphOptions = {}): LoadedClassGraph {
  if (!(WORKFLOW_CLASSES as readonly string[]).includes(klass)) {
    throw new WorkflowGraphLoadError(`'${klass}' is not one of the five closed classes`);
  }
  const defaultPath = pluginGraphPath(klass, opts.pluginRoot);
  if (!defaultPath) {
    throw new WorkflowGraphLoadError(`plugin ships no default graph for class '${klass}'`);
  }
  const pluginDefault = readYamlGraph(defaultPath);
  const docCheck = validateWorkflowGraphDocument(pluginDefault);
  if (!docCheck.ok) {
    throw new WorkflowGraphLoadError(
      `plugin default graph ${defaultPath} is invalid: ${docCheck.violations.map((v) => v.detail).join("; ")}`,
    );
  }

  const overlayPath = opts.ignoreOverlay ? null : overlayGraphPath(klass, opts);
  if (!overlayPath) {
    return { class: klass, graph: pluginDefault, defaultPath, overlayPath: null };
  }

  const overlay = readYamlGraph(overlayPath);
  // `applyWorkflowGraphOverlay` throws on any KTD42 violation — a dropped gate, a
  // hollowed station, an impersonated role, an ungated release node.
  const merged = applyWorkflowGraphOverlay(pluginDefault, overlay);
  const mergedDoc = validateWorkflowGraphDocument(merged);
  if (!mergedDoc.ok) {
    throw new WorkflowGraphLoadError(
      `merged graph for '${klass}' is invalid: ${mergedDoc.violations.map((v) => v.detail).join("; ")}`,
    );
  }
  return { class: klass, graph: merged, defaultPath, overlayPath };
}

/** Load all five merged class graphs. Used to resolve `change_class` targets. */
export function loadAllClassGraphs(opts: LoadGraphOptions = {}): Record<WorkflowClass, WorkflowGraph> {
  const out = {} as Record<WorkflowClass, WorkflowGraph>;
  for (const klass of WORKFLOW_CLASSES) {
    out[klass] = loadClassGraph(klass, opts).graph;
  }
  return out;
}
