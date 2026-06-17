/**
 * scripts/lib/workspace-impact-detector.ts
 *
 * P2-Wave-1 ADDITIVE — the LW1-4 impact DETECTOR + root-PASS aggregation +
 * child-independence writer (ADR migration step 13 / AC33-35, spec SC-W1-4/5/6).
 *
 * Contract authority (SoT):
 *   .guild/spec/universal-host-p2-wave1.md  SC-W1-4 (transitive impact), SC-W1-5 (child
 *     independence), SC-W1-6 (root PASS = AND over affected children or reviewed exception)
 *   .guild/plan/universal-host-p2-wave1.md  lane LW1-4
 *   schemas: scripts/lib/{dependency-graph,workspace-impact}-schema.ts (LW1-1, frozen)
 *
 * Three pieces:
 *   1. detectImpact()       — PURE transitive closure: given a `guild.dependency_graph.v1`
 *                             and a change-set, emit a `guild.workspace_impact.v1` BEFORE
 *                             planning. Edge `from depends-on to` ⇒ a change in `to`
 *                             affects `from`; affected = transitive dependents of the
 *                             change-set. References children by id/path/dependency_reason
 *                             ONLY (the workspace_impact.v1 schema rejects extra keys, so
 *                             child knowledge cannot ride through this map — AC33/F-7).
 *   2. aggregateRootVerdict() — SC-W1-6: root PASS iff every affected child PASS or has a
 *                             recorded reviewed_exception; one fail+no-exception ⇒ FAIL;
 *                             one fail+exception ⇒ PASS_WITH_EXCEPTION (exception surfaced).
 *   3. writeReferenceIndex() — SC-W1-5: writes ONLY a root-side reference index under
 *                             `<root>/.guild/`; `assertRootSideWritePath()` FAILS CLOSED on
 *                             any target outside it, so NO write can land in a child repo.
 *
 * CONTRACT: pure detector/aggregator (no clock, no Math.random(), no I/O); the only I/O is
 * the guarded writer. No module-scope process IO. Returns schema-valid maps + `{valid,
 * errors}`-shaped results (P1 convention).
 *
 * Owned by tooling-engineer (LW1-4). Authoritative tests: LW1-8 (eval-engineer).
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { DependencyGraphV1 } from "./dependency-graph-schema";
import {
  WorkspaceImpactV1,
  AffectedChild,
  WORKSPACE_IMPACT_SCHEMA_VERSION,
  DEPENDENCY_REASON_MAX_LEN,
  validateWorkspaceImpactV1,
} from "./workspace-impact-schema";
import { buildUnifiedGraph, FsReadSeam } from "./dependency-graph-reader";

// ===========================================================================
// 1. Impact detector (PURE)
// ===========================================================================

/** Bound a dependency_reason to the schema rule (single line, ≤max) — never throws. */
function boundReason(s: string): string {
  const oneLine = s.replace(/[\r\n]+/g, " ").trim();
  return oneLine.length > DEPENDENCY_REASON_MAX_LEN ? oneLine.slice(0, DEPENDENCY_REASON_MAX_LEN) : oneLine;
}

/**
 * Compute the transitive workspace impact of a change-set over a dependency graph.
 *
 * Semantics: an edge `from depends-on to` means a change in `to` affects `from`. The
 * affected set is the transitive closure of dependents reachable from the change-set over
 * REVERSED edges, EXCLUDING the changed nodes themselves (they are reported in
 * `changed_set`, not `affected`). `transitive` is true iff at least one affected child was
 * reached at depth ≥2 (a genuinely transitive inclusion, beyond direct dependents).
 *
 * The change-set entries may be node ids OR node paths; both resolve to ids for the walk,
 * while `changed_set` echoes the caller's original strings. Unknown change-set entries are
 * preserved in `changed_set` but affect nothing. Pure: no I/O, no clock.
 */
export function detectImpact(graph: DependencyGraphV1, changedSet: string[]): WorkspaceImpactV1 {
  // id/path → id resolution.
  const idSet = new Set(graph.nodes.map((n) => n.id));
  const pathToId = new Map(graph.nodes.map((n) => [n.path, n.id] as const));
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n] as const));

  const changedIds = new Set<string>();
  for (const entry of changedSet) {
    if (idSet.has(entry)) changedIds.add(entry);
    else if (pathToId.has(entry)) changedIds.add(pathToId.get(entry)!);
    // else: unknown — recorded in changed_set output, affects nothing.
  }

  // Reverse adjacency: dependents[to] = [from, ...] (who is affected when `to` changes).
  const dependents = new Map<string, string[]>();
  for (const e of graph.edges) {
    if (!dependents.has(e.to)) dependents.set(e.to, []);
    dependents.get(e.to)!.push(e.from);
  }

  // BFS over reversed edges, tracking depth + the changed root each dependent traces to.
  interface Reached {
    depth: number;
    viaChanged: string; // the change-set member this dependency ultimately traces to
    directDep: string; // the node it directly depends on (for the reason string)
  }
  const reached = new Map<string, Reached>();
  let frontier: { id: string; depth: number; viaChanged: string }[] = [];
  for (const c of changedIds) frontier.push({ id: c, depth: 0, viaChanged: c });

  while (frontier.length > 0) {
    const next: typeof frontier = [];
    for (const cur of frontier) {
      for (const dep of dependents.get(cur.id) ?? []) {
        if (changedIds.has(dep)) continue; // a changed node stays in changed_set, not affected
        const depth = cur.depth + 1;
        const existing = reached.get(dep);
        if (!existing || depth < existing.depth) {
          reached.set(dep, { depth, viaChanged: cur.viaChanged, directDep: cur.id });
          next.push({ id: dep, depth, viaChanged: cur.viaChanged });
        }
      }
    }
    frontier = next;
  }

  const affected: AffectedChild[] = [];
  let anyTransitive = false;
  // Deterministic order: by graph node order.
  for (const node of graph.nodes) {
    const r = reached.get(node.id);
    if (!r) continue;
    if (r.depth >= 2) anyTransitive = true;
    const reason =
      r.depth === 1
        ? `depends on ${r.viaChanged} (changed)`
        : `transitively depends on ${r.viaChanged} via ${r.directDep}`;
    affected.push({ id: node.id, path: node.path, dependency_reason: boundReason(reason) });
  }

  const map: WorkspaceImpactV1 = {
    schema_version: WORKSPACE_IMPACT_SCHEMA_VERSION,
    changed_set: [...changedSet],
    affected,
    transitive: anyTransitive,
  };
  return map;
}

/**
 * End-to-end real-path entry: read the root-side sources (guarded against child-wiki
 * reads — F-7), build the unified graph, and detect impact for `changedSet`. The detector
 * itself never touches a child wiki; the reader's guard enforces it deterministically.
 */
export function detectImpactFromWorkspace(
  workspaceRoot: string,
  changedSet: string[],
  fsImpl?: FsReadSeam,
  onWikiDenied?: (deniedPath: string) => void
): { valid: boolean; errors: string[]; impact?: WorkspaceImpactV1; sources: string[] } {
  const read = buildUnifiedGraph(workspaceRoot, fsImpl, onWikiDenied);
  if (!read.valid || !read.graph) return { valid: false, errors: read.errors, sources: read.sources };
  const impact = detectImpact(read.graph, changedSet);
  const v = validateWorkspaceImpactV1(impact);
  if (!v.valid) return { valid: false, errors: v.errors.map((e) => `impact: ${e}`), sources: read.sources };
  return { valid: true, errors: [], impact, sources: read.sources };
}

// ===========================================================================
// 2. Root-PASS aggregation (SC-W1-6)
// ===========================================================================

export type ChildStatus = "PASS" | "FAIL";

/** A recorded, reviewed exception that lets an affected FAIL child still roll up to PASS. */
export interface ReviewedException {
  reason: string;
  approved_by?: string;
}

/** Per-child verdict input to the aggregation. */
export interface ChildVerdict {
  id: string;
  status: ChildStatus;
  /** When present + status is FAIL, the child is excused (surfaced in the rollup). */
  reviewed_exception?: ReviewedException;
}

export type RootVerdict = "PASS" | "FAIL" | "PASS_WITH_EXCEPTION";

export interface RootAggregation {
  verdict: RootVerdict;
  /** Affected children that FAILED with no reviewed exception (the blockers). */
  failing: string[];
  /** Affected children with no recorded verdict at all (also block — fail-closed). */
  missing_verdicts: string[];
  /** Affected FAIL children excused by a reviewed exception (surfaced, per SC-W1-6). */
  exercised_exceptions: { id: string; exception: ReviewedException }[];
}

/**
 * Aggregate a ROOT verdict over the affected children (SC-W1-6). Root PASS iff EVERY
 * affected child is PASS or carries a recorded reviewed_exception. Fail-closed: an
 * affected child with no recorded verdict, or any non-PASS status without an exception,
 * blocks (verdict FAIL). When the only non-PASS children are excused by exceptions, the
 * verdict is PASS_WITH_EXCEPTION and every exercised exception is surfaced. Pure.
 */
export function aggregateRootVerdict(
  affected: AffectedChild[],
  verdicts: ChildVerdict[]
): RootAggregation {
  const byId = new Map<string, ChildVerdict>();
  for (const v of verdicts) byId.set(v.id, v);

  const failing: string[] = [];
  const missing_verdicts: string[] = [];
  const exercised_exceptions: { id: string; exception: ReviewedException }[] = [];

  for (const child of affected) {
    const v = byId.get(child.id);
    if (!v) {
      missing_verdicts.push(child.id); // fail-closed: unknown ≠ PASS
      continue;
    }
    if (v.status === "PASS") continue;
    // Non-PASS (FAIL or any unexpected value treated as FAIL).
    if (v.reviewed_exception && typeof v.reviewed_exception.reason === "string" && v.reviewed_exception.reason.trim() !== "") {
      exercised_exceptions.push({ id: child.id, exception: v.reviewed_exception });
    } else {
      failing.push(child.id);
    }
  }

  let verdict: RootVerdict;
  if (failing.length > 0 || missing_verdicts.length > 0) verdict = "FAIL";
  else if (exercised_exceptions.length > 0) verdict = "PASS_WITH_EXCEPTION";
  else verdict = "PASS";

  return { verdict, failing, missing_verdicts, exercised_exceptions };
}

// ===========================================================================
// 3. Child-independence writer (SC-W1-5) — root-side reference index ONLY
// ===========================================================================

/** Minimal write surface (injectable for tests). */
export interface FsWriteSeam {
  mkdirp(absDir: string): void;
  writeFile(absPath: string, contents: string): void;
}

export function realWriteSeam(): FsWriteSeam {
  return {
    mkdirp(absDir: string): void {
      fs.mkdirSync(absDir, { recursive: true });
    },
    writeFile(absPath: string, contents: string): void {
      fs.writeFileSync(absPath, contents, "utf8");
    },
  };
}

/**
 * Resolve symlinks on the DEEPEST EXISTING ancestor of `p`, then re-append the
 * not-yet-created tail. This is what makes the guard symlink-safe: the attack surface is a
 * symlinked DIRECTORY component (the final filename does not exist yet, so it cannot itself
 * be a symlink), and realpath'ing the existing prefix collapses any such escape. Never
 * throws — falls back to the lexical resolve if realpath fails.
 */
function realpathDeepest(p: string): string {
  let cur = path.resolve(p);
  const tail: string[] = [];
  while (!fs.existsSync(cur)) {
    tail.unshift(path.basename(cur));
    const parent = path.dirname(cur);
    if (parent === cur) break; // reached filesystem root
    cur = parent;
  }
  let real: string;
  try {
    real = fs.realpathSync(cur);
  } catch {
    real = cur;
  }
  return tail.length > 0 ? path.join(real, ...tail) : real;
}

/**
 * FAIL CLOSED unless `target` resolves — AFTER following symlinks — strictly inside
 * `<workspaceRoot>/.guild/`. Child repos live at `<workspaceRoot>/<child>/…`, OUTSIDE
 * `<root>/.guild/`, so the writer can never touch a child repo (SC-W1-5 / AC34).
 *
 * SECURITY (codex G-lane): a purely LEXICAL prefix check (`path.resolve` only) is
 * bypassable — a symlink under `<root>/.guild/` pointing into a child repo passes
 * lexically but physically writes into the child. So we `realpathSync` BOTH the allowed
 * root AND the target's deepest existing ancestor before the prefix check; any path that
 * escapes `<root>/.guild/` via a symlink resolves outside `allowedReal` and is rejected.
 * Throws on any violation (incl. `..` traversal and symlink escape).
 */
export function assertRootSideWritePath(workspaceRoot: string, target: string): void {
  const allowedReal = realpathDeepest(path.join(workspaceRoot, ".guild")) + path.sep;
  const targetReal = realpathDeepest(target);
  if (!(targetReal + path.sep).startsWith(allowedReal)) {
    throw new Error(
      `SC-W1-5/AC34 child-independence violation: refused to write outside <root>/.guild/ ` +
        `(target resolves to ${targetReal}; allowed ${allowedReal})`
    );
  }
}

export interface WriteResult {
  written: boolean;
  path?: string;
  error?: string;
}

/**
 * Persist the impact map as a ROOT-SIDE reference index (default
 * `<root>/.guild/workspace/impact-index.json`). Validates the map (fail-closed), asserts
 * the destination is root-side, then writes. NO write ever lands under a child repo.
 * Never throws — returns `{written,error}`.
 */
export function writeReferenceIndex(
  workspaceRoot: string,
  impact: WorkspaceImpactV1,
  outRelPath = ".guild/workspace/impact-index.json",
  fsImpl?: FsWriteSeam
): WriteResult {
  const v = validateWorkspaceImpactV1(impact);
  if (!v.valid) return { written: false, error: `invalid impact map: ${v.errors.join("; ")}` };

  const target = path.resolve(workspaceRoot, outRelPath);
  try {
    assertRootSideWritePath(workspaceRoot, target);
    const seam = fsImpl ?? realWriteSeam();
    seam.mkdirp(path.dirname(target));
    seam.writeFile(target, JSON.stringify(impact, null, 2) + "\n");
    return { written: true, path: target };
  } catch (e) {
    return { written: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ===========================================================================
// Import-pure self-check (NO process IO at module scope). LW1-8 owns real tests.
// ===========================================================================

/**
 * Deterministic smoke check. Returns `{ pass, details }`; NO process IO, never exits.
 * Exercises: transitive detection (A→B→C), the SC-W1-6 matrix (all-pass / fail-no-exc /
 * fail-with-exc), the F-7 child-wiki read guard (denies), and the SC-W1-5 root-side write
 * guard (rejects a child path).
 */
export function runSelfCheck(): { pass: boolean; details: string } {
  // Graph: website→plugin, benchmark→website  (so a plugin change transitively hits benchmark).
  const graph: DependencyGraphV1 = {
    schema_version: "guild.dependency_graph.v1",
    nodes: [
      { id: "plugin", path: "plugin" },
      { id: "website", path: "website" },
      { id: "benchmark", path: "benchmark" },
    ],
    edges: [
      { from: "website", to: "plugin" },
      { from: "benchmark", to: "website" },
    ],
  };
  const impact = detectImpact(graph, ["plugin"]);
  const affectedIds = impact.affected.map((a) => a.id).sort();
  const transitiveOk =
    validateWorkspaceImpactV1(impact).valid &&
    affectedIds.join(",") === "benchmark,website" &&
    impact.transitive === true; // benchmark is depth-2

  // SC-W1-6 matrix over the affected set {website, benchmark}.
  const allPass = aggregateRootVerdict(impact.affected, [
    { id: "website", status: "PASS" },
    { id: "benchmark", status: "PASS" },
  ]).verdict;
  const oneFailNoExc = aggregateRootVerdict(impact.affected, [
    { id: "website", status: "FAIL" },
    { id: "benchmark", status: "PASS" },
  ]).verdict;
  const oneFailExc = aggregateRootVerdict(impact.affected, [
    { id: "website", status: "FAIL", reviewed_exception: { reason: "known-flaky, tracked" } },
    { id: "benchmark", status: "PASS" },
  ]).verdict;
  const matrixOk = allPass === "PASS" && oneFailNoExc === "FAIL" && oneFailExc === "PASS_WITH_EXCEPTION";

  // F-7 guard: a read under a child .guild/wiki must throw.
  let wikiDenied = false;
  try {
    const { guardChildWikiReads } = require("./dependency-graph-reader") as typeof import("./dependency-graph-reader");
    const denying = guardChildWikiReads({ exists: () => true, readFile: () => "" });
    denying.readFile("plugin/.guild/wiki/decisions/secret.md");
  } catch {
    wikiDenied = true;
  }

  // SC-W1-5 guard: a write targeting a child repo must throw.
  let childWriteRejected = false;
  try {
    assertRootSideWritePath("/ws", "/ws/plugin/.guild/leak.json");
  } catch {
    childWriteRejected = true;
  }
  // And a legitimate root-side write target must be accepted.
  let rootWriteOk = false;
  try {
    assertRootSideWritePath("/ws", "/ws/.guild/workspace/impact-index.json");
    rootWriteOk = true;
  } catch {
    rootWriteOk = false;
  }

  // SC-W1-5/AC34 SYMLINK bypass (codex G-lane): a symlink UNDER <root>/.guild/ that escapes
  // into a child repo must be REJECTED — the lexical check would pass it. Build a real temp
  // workspace, symlink <root>/.guild/escape -> <root>/child/.guild, and assert a write
  // through it is refused. Deterministic temp name; cleaned up in finally.
  let symlinkRejected = false;
  const tmpBase = path.join(os.tmpdir(), "guild-lw1-4-symlink-selfcheck");
  try {
    fs.rmSync(tmpBase, { recursive: true, force: true });
    const root = path.join(tmpBase, "ws");
    const childGuild = path.join(root, "child", ".guild");
    const rootGuild = path.join(root, ".guild");
    fs.mkdirSync(childGuild, { recursive: true });
    fs.mkdirSync(rootGuild, { recursive: true });
    fs.symlinkSync(childGuild, path.join(rootGuild, "escape")); // dir symlink escaping into the child
    try {
      assertRootSideWritePath(root, path.join(rootGuild, "escape", "leak.json"));
      symlinkRejected = false; // should have thrown
    } catch {
      symlinkRejected = true;
    }
  } catch {
    symlinkRejected = false; // setup failure ⇒ not proven ⇒ fail the check
  } finally {
    try {
      fs.rmSync(tmpBase, { recursive: true, force: true });
    } catch {
      /* ignore cleanup error */
    }
  }

  const pass =
    transitiveOk && matrixOk && wikiDenied && childWriteRejected && rootWriteOk && symlinkRejected;
  return {
    pass,
    details: `transitive=${transitiveOk} root-pass-matrix=${matrixOk} child-wiki-read-denied=${wikiDenied} child-write-rejected=${childWriteRejected} root-write-ok=${rootWriteOk} symlink-escape-rejected=${symlinkRejected}`,
  };
}
