/**
 * K02 — invalidation and conservative dependency resolution (AT33, AT34).
 *
 * AT33: a missing import that becomes resolvable, and a competing symbol added
 * to an unchanged namespace, rebuild the resolver outputs of UNCHANGED files;
 * incremental parse + global resolution equals a clean rebuild. Negative
 * control: invalidating only direct existing dependency edges diverges.
 * AT34: dropped hooks, an old marker and a verification over budget never yield
 * current; critical acceptance waits for a verified basis; background jobs are
 * bounded and deterministic. Negative control: a cached marker that asserts
 * current without a source comparison is rejected.
 */
import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { execFileSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import {
  assembleStructuralGraph,
  bundlesToCache,
  canonicalize,
  makeBundle,
  mergeStructuralInto,
  refreshStructuralIncremental,
  structuralSubset,
  buildDependencyManifest,
  type FileBundle,
  type StructuralGraph,
} from "./structural";
import {
  planInvalidation,
  DEPENDENCY_MANIFEST_SCHEMA,
  type DependencyManifest,
} from "./dependency-manifest";
import { computeLearnSourceBasis } from "./paths";
import { computeSourceBasis } from "../../../src/domains/knowledge/source-basis";
import {
  admitCritical,
  planBackgroundRefresh,
  reconcileBoundary,
  BACKGROUND_STRUCTURAL_POLICY,
} from "../../../src/domains/knowledge/freshness-boundary";

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "k02-"));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "-c", "commit.gpgsign=false", ...args], {
    cwd,
    encoding: "utf8",
  }).trim();
const write = (root: string, rel: string, body: string) => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), body);
};

type Tree = Record<string, string>;
const bundlesOf = (tree: Tree): FileBundle[] => Object.keys(tree).sort().map((rel) => makeBundle(rel, tree[rel]));
const reader = (root: string, tree: Tree) => (abs: string) => {
  const rel = path.relative(root, abs).split(path.sep).join("/");
  if (!(rel in tree)) throw new Error(`ENOENT ${rel}`);
  return tree[rel];
};
const json = (g: StructuralGraph) => JSON.stringify(canonicalize(g));

/** Prior run: clean build of `prev`, persisted with its dependency manifest. */
function priorCache(root: string, prev: Tree) {
  const bundles = bundlesOf(prev);
  const deps = buildDependencyManifest(root, bundles);
  return { cache: { ...bundlesToCache(bundles), dependencies: deps.manifest }, graph: deps.graph };
}

/**
 * Negative control: the naive selective strategy. Re-resolve only files that
 * changed or whose EXISTING edges point into a changed file; every other file
 * keeps its previous resolver output.
 */
function directEdgeOnly(root: string, prevGraph: StructuralGraph, prev: Tree, next: Tree): { graph: StructuralGraph; rebuilt: string[] } {
  const changed = new Set(Object.keys(next).filter((r) => prev[r] !== next[r]));
  for (const r of Object.keys(prev)) if (!(r in next)) changed.add(r);
  const fileOf = (id: string) => (id.startsWith("file:") ? id.slice(5) : id.split(":")[1]);
  const rebuilt = new Set(changed);
  for (const e of prevGraph.edges) if (changed.has(fileOf(e.target))) rebuilt.add(fileOf(e.source));
  const fresh = assembleStructuralGraph(root, bundlesOf(next));
  const kept = prevGraph.edges.filter((e) => e.type !== "contains" && !rebuilt.has(fileOf(e.source)));
  const redone = fresh.edges.filter((e) => e.type === "contains" || rebuilt.has(fileOf(e.source)));
  return { graph: canonicalize({ nodes: fresh.nodes, edges: [...kept, ...redone] }), rebuilt: [...rebuilt].sort() };
}

describe("AT33 negative dependency", () => {
  test("missing import becomes resolvable: unchanged importer rebuilt, incremental == clean", () => {
    const prev: Tree = {
      "src/a.ts": 'import { u } from "./util";\nexport function main() {\n  return u();\n}\n',
      "src/b.ts": "export function other() {\n  return 1;\n}\n",
    };
    const next: Tree = { ...prev, "src/util.ts": "export function u() {\n  return 2;\n}\n" };
    const { cache, graph: prevGraph } = priorCache(tmp, prev);

    const clean = assembleStructuralGraph(tmp, bundlesOf(next));
    const inc = refreshStructuralIncremental(tmp, Object.keys(next), reader(tmp, next), cache);
    expect(json(inc.structural)).toBe(json(clean));
    expect(inc.stats.reused).toEqual(["src/a.ts", "src/b.ts"]);

    const inv = inc.stats.invalidation;
    expect(inv.mode).toBe("selective");
    expect(inv.affected_unchanged).toEqual(["src/a.ts"]);
    expect(inv.reasons["src/a.ts"].join(" ")).toContain("missing:src/util.ts");
    expect(inv.selective_equivalence).toBe("proven");
    // The edge an unchanged file now owns is in the rebuilt output.
    expect(clean.edges.some((e) => e.type === "imports" && e.source === "file:src/a.ts" && e.target === "file:src/util.ts")).toBe(true);

    // Negative control: direct-edge-only invalidation misses src/a.ts and diverges.
    const naive = directEdgeOnly(tmp, prevGraph, prev, next);
    expect(naive.rebuilt).not.toContain("src/a.ts");
    expect(json(naive.graph)).not.toBe(json(clean));
  });

  test("competing symbol in an unchanged namespace: unchanged caller and subclass rebuilt", () => {
    const prev: Tree = {
      "src/a.ts": "export function main() {\n  return helper();\n}\nexport class A extends Base {\n}\n",
      "src/b.ts": "export function helper() {\n  return 1;\n}\nexport class Base {\n}\n",
      "src/c.ts": "export const x = 1;\n",
    };
    const next: Tree = {
      ...prev,
      "src/c.ts": "export const x = 1;\nexport function helper() {\n  return 3;\n}\nexport class Base {\n}\n",
    };
    const { cache, graph: prevGraph } = priorCache(tmp, prev);
    expect(prevGraph.edges.some((e) => e.type === "calls" && e.source === "function:src/a.ts:main")).toBe(true);

    const clean = assembleStructuralGraph(tmp, bundlesOf(next));
    const inc = refreshStructuralIncremental(tmp, Object.keys(next), reader(tmp, next), cache);
    expect(json(inc.structural)).toBe(json(clean));
    // helper/Base are now ambiguous: the old edges must be gone.
    expect(clean.edges.some((e) => e.source === "function:src/a.ts:main" && e.type === "calls")).toBe(false);
    expect(clean.edges.some((e) => e.source === "class:src/a.ts:A" && e.type === "inherits")).toBe(false);

    const inv = inc.stats.invalidation;
    expect(inv.mode).toBe("selective");
    expect(inv.affected_unchanged).toContain("src/a.ts");
    expect(inv.reasons["src/a.ts"].join(" ")).toContain("symbol:fn:helper");
    expect(inv.reasons["src/a.ts"].join(" ")).toContain("symbol:class:Base");
    expect(inv.selective_equivalence).toBe("proven");

    const naive = directEdgeOnly(tmp, prevGraph, prev, next);
    expect(naive.rebuilt).not.toContain("src/a.ts");
    expect(json(naive.graph)).not.toBe(json(clean));
  });

  test("deleting a resolved target and python module probes are dependencies too", () => {
    const prev: Tree = {
      "app/main.py": "from pkg import mod\n\ndef run():\n    return 1\n",
      "src/a.ts": 'import { u } from "./util";\nexport function main() {\n  return 1;\n}\n',
      "src/util.ts": "export function u() {\n  return 2;\n}\n",
    };
    const next: Tree = { ...prev, "app/pkg/__init__.py": "def m():\n    return 1\n" };
    delete next["src/util.ts"];
    const { cache } = priorCache(tmp, prev);
    const clean = assembleStructuralGraph(tmp, bundlesOf(next));
    const inc = refreshStructuralIncremental(tmp, Object.keys(next), reader(tmp, next), cache);
    expect(json(inc.structural)).toBe(json(clean));
    expect(inc.stats.invalidation.affected_unchanged).toEqual(["app/main.py", "src/a.ts"]);
    expect(inc.stats.invalidation.selective_equivalence).toBe("proven");
  });

  test("the manifest records file/namespace inventory, negative and competing dependencies", () => {
    const tree: Tree = {
      "src/a.ts": 'import { u } from "./util";\nexport function main() {\n  return helper();\n}\n',
      "src/b.ts": "export function helper() {\n  return 1;\n}\n",
      "src/c.ts": "export function helper() {\n  return 2;\n}\n",
    };
    const { manifest } = buildDependencyManifest(tmp, bundlesOf(tree));
    expect(manifest.schema).toBe(DEPENDENCY_MANIFEST_SCHEMA);
    expect(manifest.inventory).toEqual(["src/a.ts", "src/b.ts", "src/c.ts"]);
    expect(manifest.namespaces["fn:helper"]).toEqual(["function:src/b.ts:helper", "function:src/c.ts:helper"]);
    const a = manifest.files["src/a.ts"];
    expect(a.missing).toContain("src/util.ts");
    expect(a.missing).toContain("src/util/index.ts");
    expect(a.symbols).toContain("fn:helper");
    expect(a.state).toBe("current_for_basis");
  });

  test("unknown dependencies disable selective invalidation", () => {
    const prev: Tree = { "src/a.ts": "export function main() {\n  return 1;\n}\n" };
    const next: Tree = { ...prev, "src/b.ts": "export function b() {\n  return 1;\n}\n" };
    const { manifest } = buildDependencyManifest(tmp, bundlesOf(prev));
    const nextBundles = bundlesOf(next);

    expect(planInvalidation(tmp, null, nextBundles).mode).toBe("global");
    expect(planInvalidation(tmp, { ...manifest, resolver: "other" }, nextBundles).mode).toBe("global");
    const unknown: DependencyManifest = { ...manifest, unknown: ["src/a.ts: unreadable"] };
    expect(planInvalidation(tmp, unknown, nextBundles).mode).toBe("global");

    // An unreadable file has dependencies nobody enumerated: its state is unknown.
    const withUnreadable = buildDependencyManifest(tmp, [...bundlesOf(prev), makeBundle("src/x.ts", null)]).manifest;
    expect(withUnreadable.files["src/x.ts"].state).toBe("unknown");
    expect(withUnreadable.unknown.length).toBe(1);

    // A tsconfig change moves the alias table: every importer is affected.
    write(tmp, "tsconfig.json", '{"compilerOptions":{"baseUrl":".","paths":{"@/*":["src/*"]}}}');
    const plan = planInvalidation(tmp, manifest, nextBundles);
    expect(plan.mode).toBe("global");
    expect(plan.reason).toContain("alias");
  });

  test("real CLI: --incremental after a new file equals a clean full build and reports the invalidation", () => {
    const repo = path.join(tmp, "repo");
    fs.mkdirSync(repo);
    git(repo, "init", "-q", "-b", "main");
    write(repo, ".gitignore", ".guild/\n");
    write(repo, "src/a.ts", 'import { u } from "./util";\nexport function main() {\n  return u();\n}\n');
    write(repo, "src/b.ts", "export function other() {\n  return 1;\n}\n");
    git(repo, "add", "-A");
    git(repo, "commit", "-qm", "seed");
    const cli = path.resolve(__dirname, "..", "extract-structural.ts");
    const run = (...a: string[]) => execFileSync("npx", ["tsx", cli, "--cwd", repo, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 60000 });
    run("--incremental");
    write(repo, "src/util.ts", "export function u() {\n  return 2;\n}\n");
    run("--incremental");
    const kg = path.join(repo, ".guild", "indexes", "knowledge-graph.json");
    const incGraph = structuralSubset(JSON.parse(fs.readFileSync(kg, "utf8")));
    const meta = JSON.parse(fs.readFileSync(`${kg}.meta.json`, "utf8"));
    expect(meta.invalidation.mode).toBe("selective");
    expect(meta.invalidation.affected_unchanged).toEqual(["src/a.ts"]);
    expect(meta.invalidation.selective_equivalence).toBe("proven");

    const cleanOut = path.join(repo, ".guild", "indexes", "clean.json");
    run("--out", cleanOut);
    const cleanGraph = structuralSubset(JSON.parse(fs.readFileSync(cleanOut, "utf8")));
    expect(json(incGraph)).toBe(json(cleanGraph));
  }, 120000);
});

function seedRepo(): string {
  const repo = path.join(tmp, "repo");
  fs.mkdirSync(repo);
  git(repo, "init", "-q", "-b", "main");
  write(repo, "src/a.ts", "export const a = 1;\n");
  write(repo, "src/b.ts", "export const b = 1;\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-qm", "seed");
  return repo;
}
const basisOf = (repo: string) =>
  computeSourceBasis({
    sourceRoot: repo,
    files: fs.readdirSync(path.join(repo, "src")).map((f) => `src/${f}`),
    inScope: (rel) => rel.startsWith("src/"),
    scanPolicy: { p: 1 },
    resolverPolicy: { r: 1 },
  });
const markerOf = (b: ReturnType<typeof basisOf>) => ({
  source_basis: { basis: b.basis, source_basis_hash: b.source_basis_hash, resolver_unresolved: b.resolver_unresolved, inventory: b.inventory },
});
const roomy = { max_files: 1000, max_bytes: 1 << 20 };

describe("AT34 freshness boundary", () => {
  test("dropped hooks: an edit with no hint is detected by the boundary comparison", () => {
    const repo = seedRepo();
    const marker = markerOf(basisOf(repo));
    write(repo, "src/a.ts", "export const a = 2;\n"); // no hook fired
    const v = reconcileBoundary({ marker, hints: [], estimate: { files: 2, bytes: 40 }, budget: roomy, observe: () => basisOf(repo) });
    expect(v.state).toBe("stale");
    expect(v.verified).toBe(true);
    expect(v.drift).toEqual(["src/a.ts"]);
    expect(v.hints_missed).toEqual(["src/a.ts"]);
    expect(admitCritical(v)).toBe(false);
  });

  test("hints never prove freshness: a hint for an untouched path does not mark current without comparison", () => {
    const repo = seedRepo();
    const marker = markerOf(basisOf(repo));
    write(repo, "src/b.ts", "export const b = 9;\n");
    const v = reconcileBoundary({ marker, hints: ["src/a.ts"], estimate: { files: 2, bytes: 40 }, budget: roomy, observe: () => basisOf(repo) });
    expect(v.state).toBe("stale");
    expect(v.hints_missed).toEqual(["src/b.ts"]);
  });

  test("negative control: an old marker that asserts current without a source comparison is rejected", () => {
    const repo = seedRepo();
    const head = git(repo, "rev-parse", "HEAD");
    const oldMarker = { state: "current_for_basis", generated_from_commit: head };
    // The naive reader trusts the marker: the fixture would pass it.
    const naive = (m: { state?: string; generated_from_commit?: string }) =>
      m.state === "current_for_basis" && m.generated_from_commit === git(repo, "rev-parse", "HEAD") ? "current_for_basis" : "stale";
    write(repo, "src/a.ts", "export const a = 3;\n");
    expect(naive(oldMarker)).toBe("current_for_basis");

    let observed = 0;
    const v = reconcileBoundary({ marker: oldMarker, hints: [], estimate: { files: 2, bytes: 40 }, budget: roomy, observe: () => (observed++, basisOf(repo)) });
    expect(v.state).toBe("unknown");
    expect(admitCritical(v)).toBe(false);

    // A marker with a basis but a stale `state` claim: the claim is ignored, bytes decide.
    const withBasis = { ...markerOf(basisOf(seedCopy(repo))), state: "current_for_basis" };
    const v2 = reconcileBoundary({ marker: withBasis, hints: [], estimate: { files: 2, bytes: 40 }, budget: roomy, observe: () => basisOf(repo) });
    expect(v2.state).not.toBe("current_for_basis");
    expect(observed).toBe(0);
  });

  test("verification over budget is pending, never current, and critical acceptance waits", () => {
    const repo = seedRepo();
    const marker = markerOf(basisOf(repo));
    let observed = 0;
    const v = reconcileBoundary({ marker, hints: [], estimate: { files: 5000, bytes: 40 }, budget: { max_files: 100, max_bytes: 1 << 20 }, observe: () => (observed++, basisOf(repo)) });
    expect(v.state).toBe("pending");
    expect(v.verified).toBe(false);
    expect(observed).toBe(0);
    expect(admitCritical(v)).toBe(false);

    const ok = reconcileBoundary({ marker, hints: [], estimate: { files: 2, bytes: 40 }, budget: roomy, observe: () => basisOf(repo) });
    expect(ok.state).toBe("current_for_basis");
    expect(ok.verified).toBe(true);
    expect(admitCritical(ok)).toBe(true);
  });

  test("a scan truncated at max_files leaves the basis unresolved, so freshness is unknown", () => {
    const repo = seedRepo();
    write(repo, "src/c.ts", "export const c = 1;\n");
    const full = computeLearnSourceBasis(repo);
    expect(full.resolver_unresolved).toEqual([]);
    const capped = computeLearnSourceBasis(repo, { maxFiles: 2 });
    expect(capped.resolver_unresolved.join(" ")).toContain("max_files");
    const v = reconcileBoundary({ marker: markerOf(capped as never), hints: [], estimate: { files: 1, bytes: 1 }, budget: roomy, observe: () => capped });
    expect(v.state).toBe("unknown");
  });

  test("background structural jobs are bounded and deterministic; deep learning stays explicit", () => {
    const hints = ["src/d.ts", "src/a.ts", "src/c.ts", "src/a.ts", "src/b.ts", "src/e.ts"];
    const policy = { ...BACKGROUND_STRUCTURAL_POLICY, max_jobs: 2, max_paths_per_job: 2 };
    const p1 = planBackgroundRefresh(hints, policy);
    const p2 = planBackgroundRefresh([...hints].reverse(), policy);
    expect(p1).toEqual(p2);
    expect(p1.jobs.length).toBe(2);
    expect(p1.jobs.every((j) => j.channel === "structural_graph" && j.paths.length <= 2)).toBe(true);
    expect(p1.jobs.flatMap((j) => j.paths)).toEqual(["src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts"]);
    expect(p1.deferred).toEqual(["src/e.ts"]);
    expect(p1.state).toBe("pending");
    expect(() => planBackgroundRefresh(hints, { ...policy, channel: "semantic_graph" as never })).toThrow(/explicit/);
    expect(() => planBackgroundRefresh(hints, { ...policy, max_jobs: 10_000 })).toThrow(/bound/);
  });
});

function seedCopy(repo: string): string {
  const other = path.join(tmp, "other");
  fs.cpSync(repo, other, { recursive: true });
  write(other, "src/b.ts", "export const b = 77;\n");
  return other;
}

describe("K02 review r2 regressions", () => {
  test("R2-F1: an unreadable directory leaves the basis unresolved", () => {
    const repo = seedRepo();
    write(repo, "locked/x.ts", "export const x = 1;\n");
    expect(computeLearnSourceBasis(repo).resolver_unresolved).toEqual([]);
    fs.chmodSync(path.join(repo, "locked"), 0o000);
    try {
      const b = computeLearnSourceBasis(repo);
      expect(b.resolver_unresolved.join(" ")).toContain("locked unreadable");
      const v = reconcileBoundary({ marker: markerOf(b as never), hints: [], estimate: { files: 1, bytes: 1 }, budget: roomy, observe: () => b });
      expect(v.state).toBe("unknown");
      expect(admitCritical(v)).toBe(false);
    } finally {
      fs.chmodSync(path.join(repo, "locked"), 0o755);
    }
  });

  test("R2-F2: a published hash that is not the digest of its basis is unknown", () => {
    const repo = seedRepo();
    const o = basisOf(repo);
    const forged = { source_basis: { basis: { ...o.basis, commit: "0".repeat(40) }, source_basis_hash: o.source_basis_hash } };
    const v = reconcileBoundary({ marker: forged, hints: [], estimate: { files: 2, bytes: 40 }, budget: roomy, observe: () => o });
    expect(v.state).toBe("unknown");
    expect(admitCritical(v)).toBe(false);
  });

  test("R2-F4: edge identity survives '|' in paths", () => {
    const prev: Tree = { "a.ts|file:b.ts": 'import "./c";\nexport function f() {\n  return 1;\n}\n', "c.ts": "export const c = 1;\n" };
    const next: Tree = { ...prev, "a.ts": 'import "./b.ts|file:c";\nexport function g() {\n  return 1;\n}\n', "b.ts|file:c.ts": "export const z = 1;\n" };
    const { cache } = priorCache(tmp, prev);
    const clean = assembleStructuralGraph(tmp, bundlesOf(next));
    const imports = clean.edges.filter((e) => e.type === "imports").map((e) => `${e.source} -> ${e.target}`);
    expect(imports).toContain("file:a.ts|file:b.ts -> file:c.ts");
    expect(imports).toContain("file:a.ts -> file:b.ts|file:c.ts");
    const inc = refreshStructuralIncremental(tmp, Object.keys(next), reader(tmp, next), cache);
    expect(json(inc.structural)).toBe(json(clean));
    expect(inc.stats.invalidation.selective_equivalence).toBe("proven");
  });
});

describe("K02 review r3 regressions", () => {
  test("R3-F1: a backslash filename on POSIX leaves the basis unresolved", () => {
    const repo = seedRepo();
    write(repo, "odd\\name.ts", "export const o = 1;\n");
    const b = computeLearnSourceBasis(repo);
    expect(b.resolver_unresolved.join(" ")).toContain("backslash");
    const v = reconcileBoundary({ marker: markerOf(b as never), hints: [], estimate: { files: 1, bytes: 1 }, budget: roomy, observe: () => b });
    expect(admitCritical(v)).toBe(false);
  });

  test("R3-F2: merge keeps both '|' path edges", () => {
    const tree: Tree = {
      "a.ts|file:b.ts": 'import "./c";\nexport const q = 1;\n',
      "c.ts": "export const c = 1;\n",
      "a.ts": 'import "./b.ts|file:c";\nexport const r = 1;\n',
      "b.ts|file:c.ts": "export const z = 1;\n",
    };
    const g = assembleStructuralGraph(tmp, bundlesOf(tree));
    const merged = mergeStructuralInto([], [], g);
    const n = (x: StructuralGraph) => x.edges.filter((e) => e.type === "imports").length;
    expect(n(g)).toBe(2);
    expect(n(merged)).toBe(2);
    expect(json(merged)).toBe(json(mergeStructuralInto([], [], { nodes: [...g.nodes].reverse(), edges: [...g.edges].reverse() })));
  });
});

describe("K02 review r4 regressions (fixed after the final round)", () => {
  test("R4-F2: a non-UTF-8 filename leaves the basis unresolved", () => {
    const repo = seedRepo();
    const name = Buffer.concat([Buffer.from(path.join(repo, "src") + "/"), Buffer.from([0xff, 0x2e, 0x74, 0x73])]);
    try {
      fs.writeFileSync(name, "export const z = 1;\n");
    } catch {
      return; // filesystem rejects non-UTF-8 names (APFS): nothing to lose
    }
    expect(computeLearnSourceBasis(repo).resolver_unresolved.join(" ")).toContain("non-UTF-8");
  });
});
