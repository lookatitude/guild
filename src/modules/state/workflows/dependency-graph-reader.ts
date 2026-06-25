/**
 * scripts/lib/dependency-graph-reader.ts
 *
 * P2-Wave-1 ADDITIVE — the workspace dependency-graph READER half of LW1-4 (ADR
 * migration step 13 / AC33, spec SC-W1-4). Reads the two ROOT-SIDE portfolio artifacts
 * and unifies them into one `guild.dependency_graph.v1` the impact detector walks:
 *   - `.guild/workspace/dependency-graph.json`  (guild.dependency_graph.v1, if present)
 *   - `.guild/workspace/product-map.json`        (guild.workspace.product_map.v1)
 *
 * Contract authority (SoT):
 *   .guild/spec/universal-host-p2-wave1.md  SC-W1-4 (+F-2: dependency graph is a
 *     first-class artifact distinct from product-map; the detector reads BOTH)
 *   .guild/plan/universal-host-p2-wave1.md  lane LW1-4
 *   schemas: scripts/lib/dependency-graph-schema.ts (LW1-1, frozen)
 *
 * AC33 / F-7 PHYSICAL ISOLATION (the load-bearing rule): the reader performs NO read
 * under any child `.guild/wiki/**`. This is enforced as DETERMINISTIC CODE on the real
 * path — `guardChildWikiReads()` wraps the fs seam and FAILS CLOSED (throws) on any read
 * whose path contains a `.guild/wiki` segment. The only wikis in a Guild workspace are
 * child wikis (workspace root_wiki:false), and the reader never needs a wiki, so the
 * blanket deny is both safe and correct. The production entrypoint uses the guard by
 * default — not just the tests — so child knowledge cannot bleed in even by accident.
 *
 * CONTRACT: lenient readers (tolerate a missing dependency-graph.json), fail-closed
 * validators (the unified graph is validated with validateDependencyGraphV1 before use),
 * no clock, no Math.random(), no module-scope process IO. Returns `{ valid, errors }`-
 * shaped results matching the P1 convention.
 *
 * Owned by tooling-engineer (LW1-4); consumes LW1-1 schemas; feeds workspace-impact-detector.ts.
 */

import * as fs from "fs";
import * as path from "path";
import {
  DependencyGraphV1,
  DependencyEdge,
  DependencyNode,
  DEPENDENCY_GRAPH_SCHEMA_VERSION,
  REASON_MAX_LEN,
  validateDependencyGraphV1,
} from "./dependency-graph-schema";

// ---------------------------------------------------------------------------
// FS read seam (injectable) + the child-wiki deny guard (F-7, real-path)
// ---------------------------------------------------------------------------

/** Minimal read surface the reader needs. Injectable for tests/instrumentation. */
export interface FsReadSeam {
  exists(absPath: string): boolean;
  readFile(absPath: string): string;
}

/** Real-fs implementation. */
export function realReadSeam(): FsReadSeam {
  return {
    exists(absPath: string): boolean {
      return fs.existsSync(absPath);
    },
    readFile(absPath: string): string {
      return fs.readFileSync(absPath, "utf8");
    },
  };
}

/**
 * True iff `p` resolves under some `.guild/wiki` directory — i.e. a child-wiki path the
 * detector must NEVER read (AC33/F-7). Normalizes separators so it is robust on any OS.
 */
export function isChildWikiPath(p: string): boolean {
  const norm = p.replace(/\\/g, "/");
  return /(^|\/)\.guild\/wiki(\/|$)/.test(norm);
}

/**
 * Wrap an FsReadSeam so ANY read under a `.guild/wiki` directory FAILS CLOSED (throws).
 * This is the deterministic, real-path enforcement of the F-7 isolation rule — the
 * detector physically cannot read child knowledge. `onDeny` (optional) is invoked with
 * the offending path before throwing, so tests can record the attempt.
 */
export function guardChildWikiReads(
  inner: FsReadSeam,
  onDeny?: (deniedPath: string) => void
): FsReadSeam {
  const deny = (absPath: string): void => {
    if (isChildWikiPath(absPath)) {
      if (onDeny) onDeny(absPath);
      throw new Error(
        `AC33/F-7 isolation violation: refused to read under a child .guild/wiki (${absPath})`
      );
    }
  };
  return {
    exists(absPath: string): boolean {
      deny(absPath);
      return inner.exists(absPath);
    },
    readFile(absPath: string): string {
      deny(absPath);
      return inner.readFile(absPath);
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export interface ReaderResult {
  valid: boolean;
  errors: string[];
  /** The unified, validated graph (present iff valid). */
  graph?: DependencyGraphV1;
  /** Which sources contributed (for --sources-style provenance / debugging). */
  sources: string[];
}

/** Bound a reason to the schema rule (single line, ≤REASON_MAX_LEN) — never throws. */
function boundReason(raw: unknown): string {
  const s = typeof raw === "string" ? raw : "";
  const oneLine = s.replace(/[\r\n]+/g, " ").trim();
  return oneLine.length > REASON_MAX_LEN ? oneLine.slice(0, REASON_MAX_LEN) : oneLine;
}

function parseJsonSafe(text: string): { ok: boolean; value?: unknown; error?: string } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ---------------------------------------------------------------------------
// Source readers (root-side only; guarded against child-wiki reads)
// ---------------------------------------------------------------------------

/**
 * Load `.guild/workspace/dependency-graph.json` as guild.dependency_graph.v1. Lenient on
 * absence (returns graph:null, valid:true); fail-closed on a present-but-invalid file.
 */
export function loadDependencyGraphArtifact(
  workspaceRoot: string,
  seam: FsReadSeam
): { valid: boolean; errors: string[]; graph: DependencyGraphV1 | null } {
  const file = path.join(workspaceRoot, ".guild", "workspace", "dependency-graph.json");
  if (!seam.exists(file)) {
    return { valid: true, errors: [], graph: null };
  }
  const parsed = parseJsonSafe(seam.readFile(file));
  if (!parsed.ok) {
    return { valid: false, errors: [`dependency-graph.json: ${parsed.error}`], graph: null };
  }
  const v = validateDependencyGraphV1(parsed.value);
  if (!v.valid) {
    return { valid: false, errors: v.errors.map((e) => `dependency-graph.json: ${e}`), graph: null };
  }
  return { valid: true, errors: [], graph: parsed.value as DependencyGraphV1 };
}

/**
 * Derive a dependency graph from `product-map.json`'s `products[]` (→ nodes) and
 * `cross_repo_dependencies[]` (→ edges). Lenient reader: tolerates missing optional
 * fields, ignores unknown keys, returns null when the file is absent.
 */
export function deriveGraphFromProductMap(
  workspaceRoot: string,
  seam: FsReadSeam
): { valid: boolean; errors: string[]; graph: DependencyGraphV1 | null } {
  const file = path.join(workspaceRoot, ".guild", "workspace", "product-map.json");
  if (!seam.exists(file)) {
    return { valid: true, errors: [], graph: null };
  }
  const parsed = parseJsonSafe(seam.readFile(file));
  if (!parsed.ok) {
    return { valid: false, errors: [`product-map.json: ${parsed.error}`], graph: null };
  }
  const pm = parsed.value as Record<string, unknown>;
  const products = Array.isArray(pm["products"]) ? (pm["products"] as Record<string, unknown>[]) : [];
  const deps = Array.isArray(pm["cross_repo_dependencies"])
    ? (pm["cross_repo_dependencies"] as Record<string, unknown>[])
    : [];

  const nodes: DependencyNode[] = [];
  for (const p of products) {
    const id = p["id"];
    const repo = p["repo"];
    if (typeof id === "string" && id.trim() !== "" && typeof repo === "string" && repo.trim() !== "") {
      nodes.push({ id, path: repo });
    }
  }
  const nodeIds = new Set(nodes.map((n) => n.id));
  const edges: DependencyEdge[] = [];
  for (const d of deps) {
    const from = d["from"];
    const to = d["to"];
    if (typeof from !== "string" || typeof to !== "string") continue;
    if (!nodeIds.has(from) || !nodeIds.has(to) || from === to) continue; // drop dangling/self
    // Reason is a SHORT reference token ("docs-mirror"/"evaluates") — never the long note.
    const reason = boundReason(d["kind"] ?? d["note"] ?? "depends-on");
    edges.push(reason ? { from, to, reason } : { from, to });
  }
  const graph: DependencyGraphV1 = {
    schema_version: DEPENDENCY_GRAPH_SCHEMA_VERSION,
    nodes,
    edges,
  };
  const v = validateDependencyGraphV1(graph);
  return { valid: v.valid, errors: v.errors.map((e) => `product-map-derived: ${e}`), graph: v.valid ? graph : null };
}

/**
 * Build ONE unified, validated `guild.dependency_graph.v1` from BOTH sources (F-2). The
 * explicit dependency-graph.json (when present) and the product-map-derived graph are
 * merged: nodes deduped by id, edges deduped by `from→to`. Reads are guarded against any
 * child `.guild/wiki` access (F-7). Fail-closed: the merged graph is re-validated.
 *
 * @param onWikiDenied  optional — receives any attempted child-wiki path (for the
 *                      anti-vacuous instrumentation assertion; the guard still throws).
 */
export function buildUnifiedGraph(
  workspaceRoot: string,
  fsImpl?: FsReadSeam,
  onWikiDenied?: (deniedPath: string) => void
): ReaderResult {
  const seam = guardChildWikiReads(fsImpl ?? realReadSeam(), onWikiDenied);
  const sources: string[] = [];
  const errors: string[] = [];

  const fromArtifact = loadDependencyGraphArtifact(workspaceRoot, seam);
  if (!fromArtifact.valid) errors.push(...fromArtifact.errors);
  else if (fromArtifact.graph) sources.push("dependency-graph.json");

  const fromProductMap = deriveGraphFromProductMap(workspaceRoot, seam);
  if (!fromProductMap.valid) errors.push(...fromProductMap.errors);
  else if (fromProductMap.graph) sources.push("product-map.json");

  if (errors.length > 0) return { valid: false, errors, sources };

  const nodeById = new Map<string, DependencyNode>();
  const edgeByKey = new Map<string, DependencyEdge>();
  for (const g of [fromArtifact.graph, fromProductMap.graph]) {
    if (!g) continue;
    for (const n of g.nodes) if (!nodeById.has(n.id)) nodeById.set(n.id, n);
    for (const e of g.edges) {
      const key = `${e.from} ${e.to}`;
      if (!edgeByKey.has(key)) edgeByKey.set(key, e);
    }
  }

  if (nodeById.size === 0) {
    return { valid: false, errors: ["no dependency sources found (neither dependency-graph.json nor product-map.json)"], sources };
  }

  const graph: DependencyGraphV1 = {
    schema_version: DEPENDENCY_GRAPH_SCHEMA_VERSION,
    nodes: [...nodeById.values()],
    edges: [...edgeByKey.values()],
  };
  const v = validateDependencyGraphV1(graph);
  if (!v.valid) return { valid: false, errors: v.errors.map((e) => `unified: ${e}`), sources };
  return { valid: true, errors: [], graph, sources };
}
