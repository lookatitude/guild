/**
 * learn/full-build-freshness.test.ts — I15 (legacy G3) gates, real CLI only.
 *
 * G3-F2: a plain FULL build must use the live walkRepo inventory/ignore
 *        semantics — never trust a stale .guild/indexes/codebase-map.json
 *        (a deleted file's map entry must not become a phantom node).
 * G3-F4: a plain FULL rebuild must PRUNE structural nodes/edges of files that
 *        were deleted or LEFT scope (ignored), while preserving foreign
 *        semantic (LLM-tier) nodes; a foreign edge survives only when both
 *        endpoints resolve, and removed dangling edges are counted in the
 *        sidecar (`dangling_edges_removed`).
 *
 * Every scenario drives the actual extract-structural.ts CLI on disposable
 * git-initialized temp repos (no injected seams), mirroring the FIX-T4.1-2
 * incremental harness one suite up the tree.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execFileSync } from "child_process";

import { structuralSubset } from "./lib/structural";
import type { GraphEdge, GraphNode } from "./lib/schema";

const SCRIPTS_DIR = path.resolve(__dirname, "..");
const CLI = path.join(SCRIPTS_DIR, "learn", "extract-structural.ts");

function tmpRepo(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}
function git(r: string, args: string[]): void {
  execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], { cwd: r, stdio: "ignore" });
}
function runCli(r: string, ...extra: string[]): void {
  execFileSync("npx", ["tsx", CLI, "--cwd", r, ...extra], { cwd: SCRIPTS_DIR, stdio: "ignore" });
}
const KG = (r: string) => path.join(r, ".guild", "indexes", "knowledge-graph.json");
const META = (r: string) => `${KG(r)}.meta.json`;
const MAP = (r: string) => path.join(r, ".guild", "indexes", "codebase-map.json");
const readJ = (p: string) => JSON.parse(fs.readFileSync(p, "utf8"));
const subsetJson = (g: { nodes: GraphNode[]; edges: GraphEdge[] }) =>
  JSON.stringify(structuralSubset(g));

describe("I15 — full build uses the live tree and prunes on rebuild (real CLI)", () => {
  let repo: string;
  let cleanRepo: string;
  let preIds: Set<string>;

  beforeAll(() => {
    repo = tmpRepo("i15-full-");
    fs.mkdirSync(path.join(repo, "src"), { recursive: true });
    // Initial tree: kept.ts calls doomed.ts + descoped.ts; all in scope.
    fs.writeFileSync(path.join(repo, "src", "kept.ts"),
      "import { gone } from './doomed';\nexport function keeper(): number { return gone(); }\n");
    fs.writeFileSync(path.join(repo, "src", "doomed.ts"),
      "export function gone(): number { return 1; }\n");
    fs.writeFileSync(path.join(repo, "src", "descoped.ts"),
      "export function hidden(): number { return 2; }\n");
    fs.writeFileSync(path.join(repo, ".gitignore"), "**/*.structural-cache.json\n");
    git(repo, ["init"]);
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-m", "fixture"]);
    runCli(repo); // seed graph with a FULL run

    // Pre-mutation state assertions live here so every later "absent" claim is
    // non-vacuous: the pruned items PROVABLY existed first (codex F1).
    const g = readJ(KG(repo));
    preIds = new Set((g.nodes as GraphNode[]).map((n) => n.id));

    // Seed a FOREIGN (LLM-tier) node + two foreign edges: one to a surviving
    // structural node (the kept FILE node), one to a node of the soon-deleted
    // file (will dangle).
    g.nodes.push({
      id: "concept:notes:pruning", type: "concept", name: "pruning",
      source_refs: ["src/kept.ts#L1-L2"], confidence: "medium", extractor: "llm-tier",
    });
    g.edges.push(
      { source: "concept:notes:pruning", target: "file:src/kept.ts",
        type: "relates_to", direction: "out", weight: 1 },
      { source: "concept:notes:pruning", target: "function:src/doomed.ts:gone",
        type: "relates_to", direction: "out", weight: 1 },
    );
    fs.writeFileSync(KG(repo), JSON.stringify(g, null, 2));

    // Mutate the live tree: DELETE doomed.ts, DESCOPE descoped.ts (via
    // .guildignore — walkRepo's ignore surface), ADD added.ts, CHANGE kept.ts's
    // callable surface.
    fs.rmSync(path.join(repo, "src", "doomed.ts"));
    fs.writeFileSync(path.join(repo, ".guildignore"), "src/descoped.ts\n");
    fs.writeFileSync(path.join(repo, "src", "added.ts"),
      "export function fresh(): number { return 7; }\n");
    // RENAME the surviving file's callable: keeper is REMOVED, keeper2/keeper3
    // replace it — a stale `keeper` symbol surviving the full rebuild would be
    // the exact G3-F4 union-as-is defect (codex F1).
    fs.writeFileSync(path.join(repo, "src", "kept.ts"),
      "export function keeper2(): number { return 4; }\nexport function keeper3(): number { return 5; }\n");

    // Plant a STALE codebase-map still listing doomed.ts + descoped.ts and
    // missing added.ts — the pre-I15 full build trusted it (G3-F2).
    fs.writeFileSync(
      MAP(repo),
      JSON.stringify({
        version: "guild.codebase_map.v1",
        files: [
          { path: "src/kept.ts" }, { path: "src/doomed.ts" }, { path: "src/descoped.ts" },
        ],
      }),
    );
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-m", "live tree drifts from the stale map"]);
    runCli(repo); // plain FULL run — no --incremental

    // Clean full rebuild of the SAME final tree for the lossless compare.
    cleanRepo = tmpRepo("i15-clean-");
    fs.mkdirSync(path.join(cleanRepo, "src"), { recursive: true });
    fs.copyFileSync(path.join(repo, "src", "kept.ts"), path.join(cleanRepo, "src", "kept.ts"));
    fs.copyFileSync(path.join(repo, "src", "added.ts"), path.join(cleanRepo, "src", "added.ts"));
    fs.copyFileSync(path.join(repo, ".guildignore"), path.join(cleanRepo, ".guildignore"));
    git(cleanRepo, ["init"]);
    git(cleanRepo, ["add", "-A"]);
    git(cleanRepo, ["commit", "-m", "final tree"]);
    runCli(cleanRepo);
  });

  afterAll(() => {
    if (repo) fs.rmSync(repo, { recursive: true, force: true });
    if (cleanRepo) fs.rmSync(cleanRepo, { recursive: true, force: true });
  });

  test("G3-F2: the stale map's phantom entries produce NO nodes (deleted + descoped files)", () => {
    // Non-vacuous: every pruned id existed in the pre-mutation graph.
    for (const id of [
      "file:src/doomed.ts", "function:src/doomed.ts:gone",
      "file:src/descoped.ts", "function:src/descoped.ts:hidden",
      "function:src/kept.ts:keeper",
    ]) expect(preIds.has(id)).toBe(true);
    const nodes = readJ(KG(repo)).nodes as GraphNode[];
    expect(nodes.some((n) => n.id === "file:src/doomed.ts")).toBe(false);
    expect(nodes.some((n) => n.id === "function:src/doomed.ts:gone")).toBe(false);
    expect(nodes.some((n) => n.id === "file:src/descoped.ts")).toBe(false);
    expect(nodes.some((n) => n.id === "function:src/descoped.ts:hidden")).toBe(false);
  });

  test("the ADDED file (absent from the stale map) IS in the full-rebuild graph", () => {
    const nodes = readJ(KG(repo)).nodes as GraphNode[];
    expect(nodes.some((n) => n.id === "function:src/added.ts:fresh")).toBe(true);
  });

  test("G3-F4: the changed callable surface is replaced, not unioned (no stale symbol)", () => {
    const nodes = readJ(KG(repo)).nodes as GraphNode[];
    // The REMOVED callable of a SURVIVING file (existed pre-mutation) is pruned…
    expect(preIds.has("function:src/kept.ts:keeper")).toBe(true);
    expect(nodes.some((n) => n.id === "function:src/kept.ts:keeper")).toBe(false);
    // …and the new surface is present.
    expect(nodes.some((n) => n.id === "function:src/kept.ts:keeper2")).toBe(true);
    expect(nodes.some((n) => n.id === "function:src/kept.ts:keeper3")).toBe(true);
    // The old import edge to doomed.ts must not survive either.
    const edges = readJ(KG(repo)).edges as GraphEdge[];
    expect(edges.some((e) => e.target.includes("doomed"))).toBe(false);
  });

  test("foreign semantic node survives the full rebuild; its dangling edge does not", () => {
    const g = readJ(KG(repo));
    const nodes = g.nodes as GraphNode[];
    const edges = g.edges as GraphEdge[];
    expect(nodes.some((n) => n.id === "concept:notes:pruning")).toBe(true);
    // Edge to the SURVIVING structural endpoint is preserved…
    expect(edges.some(
      (e) => e.source === "concept:notes:pruning" && e.target === "file:src/kept.ts",
    )).toBe(true);
    // …the edge whose endpoint was pruned is gone.
    expect(edges.some(
      (e) => e.source === "concept:notes:pruning" && e.target === "function:src/doomed.ts:gone",
    )).toBe(false);
  });

  test("removed dangling edges are counted in the sidecar", () => {
    const meta = readJ(META(repo));
    expect(typeof meta.dangling_edges_removed).toBe("number");
    expect(meta.dangling_edges_removed).toBeGreaterThanOrEqual(1);
  });

  test("anti-vacuity + lossless: full rebuild structural subset == clean rebuild of the live tree", () => {
    const dirty = readJ(KG(repo));
    const clean = readJ(KG(cleanRepo));
    expect(subsetJson(dirty)).toBe(subsetJson(clean));
    // Anti-vacuity: the clean graph genuinely contains the live symbols.
    expect((clean.nodes as GraphNode[]).some((n) => n.id === "function:src/kept.ts:keeper2")).toBe(true);
  });

  test("determinism: repeating the full run is byte-identical on the structural subset", () => {
    const before = subsetJson(readJ(KG(repo)));
    runCli(repo);
    expect(subsetJson(readJ(KG(repo)))).toBe(before);
  });
});
