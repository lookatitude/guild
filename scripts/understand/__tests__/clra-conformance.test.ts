/**
 * understand/__tests__/clra-conformance.test.ts
 *
 * G14 — Shared fixture + SQLite-optional parity conformance gate for the
 * Codebase Learning & Recall Acceleration initiative.
 *
 * This suite is the foundation that makes the other goals' gates non-vacuous.
 * It asserts TWO things that must hold BEFORE any goal wires real extraction:
 *
 *   1. ORACLE SELF-CONSISTENCY — every ground-truth edge/node in
 *      clra-fixture.expected.json references a REAL fixture symbol, and the
 *      internal invariants hold (dead funcs have no callers, cross_file flags
 *      are accurate, etc.). A deliberately-broken oracle entry FAILS the check
 *      (anti-vacuity).
 *
 *   2. PARITY HARNESS — runBothIndexModes() runs a trivial query with
 *      index:off AND index:on (driving the index-cache knob) and returns
 *      identical results, with BOTH modes provably executed (the `on` run
 *      actually engaged SQLite; the `off` run actually did not).
 *
 * The G1/G3/G8/G9 wiring is left as clearly-labeled describe.skip placeholders
 * that activate as those lanes land.
 *
 * Run from plugin/scripts/:  npx jest --no-coverage clra-conformance
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { analyzeSource, type ImportInfo } from "../lib/extract";
import {
  runBothIndexModes,
  deepEqual,
  canonicalize,
  type IndexModeContext,
} from "../lib/parity-harness";
import { ensureKgIndex } from "../../../src/modules/state/workflows/index-cache";
import { extractStructuralGraph } from "../lib/structural";
import { refineCalls } from "../resolve-calls";
import type { GraphEdge } from "../lib/schema";

// ---------------------------------------------------------------------------
// Fixture + oracle loading
// ---------------------------------------------------------------------------

const FIXTURE_ROOT = path.join(__dirname, "fixtures", "clra-fixture");
const ORACLE_PATH = path.join(FIXTURE_ROOT, "clra-fixture.expected.json");

interface Oracle {
  schema: string;
  fixtureRoot: string;
  files: string[];
  calls: Array<{ from: string; to: string; cross_file: boolean }>;
  imports: Array<{ importer: string; source: string; symbols: string[] }>;
  inherits: Array<{ child: string; parent: string }>;
  implements: Array<{ class: string; interface: string }>;
  deadCode: string[];
  entryPoints: string[];
  clonePairs: Array<[string, string]>;
}

function loadOracle(): Oracle {
  return JSON.parse(fs.readFileSync(ORACLE_PATH, "utf8")) as Oracle;
}

// ---------------------------------------------------------------------------
// Node-id parsing  (<type>:<relpath>[:<name>])
// ---------------------------------------------------------------------------

interface ParsedId {
  type: string;
  relpath: string;
  name?: string;
}

/** Parse a graph node id of the LOCKED form <type>:<relpath>[:<name>]. */
function parseNodeId(id: string): ParsedId {
  const parts = id.split(":");
  const type = parts[0];
  if (type === "file") {
    return { type, relpath: parts.slice(1).join(":") };
  }
  return {
    type,
    relpath: parts.slice(1, -1).join(":"),
    name: parts[parts.length - 1],
  };
}

// ---------------------------------------------------------------------------
// Fixture symbol index — grounded in the REAL repo extractor (analyzeSource)
// plus source-level parsing for inheritance/implements (which the structural
// extractor does not surface).
// ---------------------------------------------------------------------------

interface FixtureIndex {
  fileExists: (relpath: string) => boolean;
  hasFunction: (relpath: string, name: string) => boolean;
  hasClass: (relpath: string, name: string) => boolean;
  hasInterface: (relpath: string, name: string) => boolean;
  importsOf: (relpath: string) => ImportInfo[];
  source: (relpath: string) => string;
}

function buildFixtureIndex(files: string[]): FixtureIndex {
  const fnSet = new Set<string>(); // `${relpath}::${name}`
  const clsSet = new Set<string>();
  const ifaceSet = new Set<string>();
  const importMap = new Map<string, ImportInfo[]>();
  const srcMap = new Map<string, string>();
  const existing = new Set<string>();

  for (const fileId of files) {
    const { relpath } = parseNodeId(fileId);
    const abs = path.join(FIXTURE_ROOT, relpath);
    if (!fs.existsSync(abs)) continue;
    existing.add(relpath);
    const content = fs.readFileSync(abs, "utf8");
    srcMap.set(relpath, content);

    const a = analyzeSource(relpath, content);
    if (a) {
      for (const f of a.functions) fnSet.add(`${relpath}::${f.name}`);
      for (const c of a.classes) clsSet.add(`${relpath}::${c.name}`);
      importMap.set(relpath, a.imports);
    }
    // Interfaces (TS) are not surfaced as classes by analyzeSource — parse them.
    const ifaceRe = /^\s*(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/gm;
    let m: RegExpExecArray | null;
    while ((m = ifaceRe.exec(content)) !== null) {
      ifaceSet.add(`${relpath}::${m[1]}`);
    }
  }

  return {
    fileExists: (relpath) => existing.has(relpath),
    hasFunction: (relpath, name) => fnSet.has(`${relpath}::${name}`),
    hasClass: (relpath, name) => clsSet.has(`${relpath}::${name}`),
    hasInterface: (relpath, name) => ifaceSet.has(`${relpath}::${name}`),
    importsOf: (relpath) => importMap.get(relpath) ?? [],
    source: (relpath) => srcMap.get(relpath) ?? "",
  };
}

// ---------------------------------------------------------------------------
// Oracle consistency checker — pure function returning violations.
// Callable on a MUTATED oracle for anti-vacuity testing.
// ---------------------------------------------------------------------------

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Mask every identifier to `_` and collapse whitespace — a structural fingerprint. */
function normalizeBody(src: string): string {
  return src.replace(/[A-Za-z_$][\w$]*/g, "_").replace(/\s+/g, " ").trim();
}

/** Slice a named function's body out of a source file (via the real extractor). */
function functionBody(idx: FixtureIndex, relpath: string, name: string): string | null {
  const src = idx.source(relpath);
  const a = analyzeSource(relpath, src);
  const fn = a?.functions.find((f) => f.name === name);
  if (!fn) return null;
  return src.split("\n").slice(fn.lineRange[0] - 1, fn.lineRange[1]).join("\n");
}

function checkOracleConsistency(oracle: Oracle): string[] {
  const violations: string[] = [];
  const idx = buildFixtureIndex(oracle.files);

  const resolveSymbol = (id: string, kinds: Array<"function" | "class" | "interface">): void => {
    const p = parseNodeId(id);
    if (!idx.fileExists(p.relpath)) {
      violations.push(`"${id}": file "${p.relpath}" not in fixture`);
      return;
    }
    if (!p.name) {
      violations.push(`"${id}": expected a named symbol`);
      return;
    }
    const ok = kinds.some((k) =>
      k === "function"
        ? idx.hasFunction(p.relpath, p.name!)
        : k === "class"
          ? idx.hasClass(p.relpath, p.name!)
          : idx.hasInterface(p.relpath, p.name!),
    );
    if (!ok) {
      violations.push(`"${id}": ${kinds.join("/")} "${p.name}" not found in "${p.relpath}"`);
    }
  };

  // files exist on disk
  for (const fileId of oracle.files) {
    const p = parseNodeId(fileId);
    if (p.type !== "file") violations.push(`files[]: "${fileId}" is not a file id`);
    else if (!idx.fileExists(p.relpath)) violations.push(`files[]: "${p.relpath}" missing on disk`);
  }

  // calls: endpoints resolve as functions; cross_file flag is accurate
  for (const c of oracle.calls) {
    resolveSymbol(c.from, ["function"]);
    resolveSymbol(c.to, ["function"]);
    const fromRel = parseNodeId(c.from).relpath;
    const toRel = parseNodeId(c.to).relpath;
    const actualCross = fromRel !== toRel;
    if (actualCross !== c.cross_file) {
      violations.push(
        `calls "${c.from}"→"${c.to}": cross_file=${c.cross_file} but files are ${fromRel} vs ${toRel}`,
      );
    }
  }

  // imports: importer resolves and the declared import actually exists in source
  for (const imp of oracle.imports) {
    const p = parseNodeId(imp.importer);
    if (!idx.fileExists(p.relpath)) {
      violations.push(`imports[]: importer file "${p.relpath}" missing`);
      continue;
    }
    const decls = idx.importsOf(p.relpath);
    const decl = decls.find((d) => d.source === imp.source);
    if (!decl) {
      violations.push(`imports[]: "${p.relpath}" has no import from "${imp.source}"`);
      continue;
    }
    for (const sym of imp.symbols) {
      if (!decl.specifiers.includes(sym)) {
        violations.push(`imports[]: "${p.relpath}" import "${imp.source}" lacks symbol "${sym}"`);
      }
    }
  }

  // inherits: both classes resolve + source confirms the relationship
  for (const inh of oracle.inherits) {
    resolveSymbol(inh.child, ["class"]);
    resolveSymbol(inh.parent, ["class"]);
    const childP = parseNodeId(inh.child);
    const parentName = parseNodeId(inh.parent).name;
    const src = idx.source(childP.relpath);
    // TS: `class Child extends Parent` ; Python: `class Child(Parent)`
    const tsRe = new RegExp(`class\\s+${childP.name}\\b[^{]*\\bextends\\s+${parentName}\\b`);
    const pyRe = new RegExp(`class\\s+${childP.name}\\s*\\([^)]*\\b${parentName}\\b`);
    if (!tsRe.test(src) && !pyRe.test(src)) {
      violations.push(`inherits "${inh.child}"→"${inh.parent}": no extends/subclass found in source`);
    }
  }

  // implements: class resolves, interface resolves, source confirms `implements`
  for (const impl of oracle.implements) {
    resolveSymbol(impl.class, ["class"]);
    resolveSymbol(impl.interface, ["interface"]);
    const classP = parseNodeId(impl.class);
    const ifaceName = parseNodeId(impl.interface).name;
    const src = idx.source(classP.relpath);
    const re = new RegExp(`class\\s+${classP.name}\\b[^{]*\\bimplements\\b[^{]*\\b${ifaceName}\\b`);
    if (!re.test(src)) {
      violations.push(`implements "${impl.class}"→"${impl.interface}": no implements clause in source`);
    }
  }

  // entry points resolve as functions
  for (const ep of oracle.entryPoints) resolveSymbol(ep, ["function"]);

  // dead code resolves AND is genuinely dead: not an entry point, not a call target
  const callTargets = new Set(oracle.calls.map((c) => c.to));
  const entrySet = new Set(oracle.entryPoints);
  for (const dead of oracle.deadCode) {
    resolveSymbol(dead, ["function"]);
    if (callTargets.has(dead)) {
      violations.push(`deadCode "${dead}": appears as a call target — not dead`);
    }
    if (entrySet.has(dead)) {
      violations.push(`deadCode "${dead}": is also an entry point — contradiction`);
    }
  }

  // clone pairs: both endpoints resolve as functions and differ
  for (const [aId, bId] of oracle.clonePairs) {
    resolveSymbol(aId, ["function"]);
    resolveSymbol(bId, ["function"]);
    if (aId === bId) violations.push(`clonePairs: pair references the same node "${aId}"`);
  }

  // FIX G14-9 (source-grounded calls): each oracle call must have a real call
  // site for the callee's NAME inside the caller's function body — not merely two
  // functions that happen to exist. Member calls (`x.name(`) don't count.
  for (const c of oracle.calls) {
    const fromP = parseNodeId(c.from);
    const toP = parseNodeId(c.to);
    if (!fromP.name || !toP.name) continue; // already flagged by resolveSymbol
    const body = functionBody(idx, fromP.relpath, fromP.name);
    if (body === null) {
      violations.push(`calls "${c.from}"→"${c.to}": caller body for "${fromP.name}" not found`);
      continue;
    }
    const re = new RegExp(`(?<![.\\w$])${escapeRe(toP.name)}\\s*\\(`);
    if (!re.test(body)) {
      violations.push(`calls "${c.from}"→"${c.to}": no call site for "${toP.name}" in "${fromP.name}" body`);
    }
  }

  // FIX G14-9 (source-grounded clones): a clone pair's bodies must be structural
  // clones — identifier-masked bodies equal. Catches an arbitrary pair of
  // distinct functions falsely labeled clones.
  for (const [aId, bId] of oracle.clonePairs) {
    const aP = parseNodeId(aId);
    const bP = parseNodeId(bId);
    if (!aP.name || !bP.name) continue;
    const aBody = functionBody(idx, aP.relpath, aP.name);
    const bBody = functionBody(idx, bP.relpath, bP.name);
    if (aBody === null || bBody === null) continue; // existence already checked
    if (normalizeBody(aBody) !== normalizeBody(bBody)) {
      violations.push(`clonePairs: "${aId}" and "${bId}" are not structural clones (masked bodies differ)`);
    }
  }

  return violations;
}

// ---------------------------------------------------------------------------
// 1. Oracle self-consistency
// ---------------------------------------------------------------------------

describe("CLRA fixture — oracle self-consistency", () => {
  test("FIX G14-10: oracle carries the exact contract schema + fixtureRoot", () => {
    const o = loadOracle();
    expect(o.schema).toBe("guild.clra_fixture_oracle.v1");
    expect(o.fixtureRoot).toBe(".");
  });

  test("anti-vacuity: a wrong call between two EXISTING functions is caught (source-grounded)", () => {
    const o = loadOracle();
    // main and unusedHelper both exist, but main never calls unusedHelper.
    o.calls.push({
      from: "function:src/a.ts:main",
      to: "function:src/b.ts:unusedHelper",
      cross_file: true,
    });
    expect(checkOracleConsistency(o).some((v) => v.includes("no call site"))).toBe(true);
  });

  test("anti-vacuity: a non-clone pair of existing functions is caught (masked-body check)", () => {
    const o = loadOracle();
    // main vs add: both real functions, NOT structural clones.
    o.clonePairs.push(["function:src/a.ts:main", "function:src/b.ts:add"]);
    expect(checkOracleConsistency(o).some((v) => v.includes("not structural clones"))).toBe(true);
  });

  test("the expected.json oracle parses and has every section", () => {
    const o = loadOracle();
    for (const key of [
      "files", "calls", "imports", "inherits", "implements",
      "deadCode", "entryPoints", "clonePairs",
    ] as const) {
      expect(Array.isArray((o as unknown as Record<string, unknown>)[key])).toBe(true);
    }
    // The fixture is non-trivial: it must actually exercise each labeled shape.
    expect(o.calls.some((c) => c.cross_file)).toBe(true);
    expect(o.deadCode.length).toBeGreaterThanOrEqual(1);
    expect(o.entryPoints.length).toBeGreaterThanOrEqual(1);
    expect(o.clonePairs.length).toBeGreaterThanOrEqual(1);
    expect(o.inherits.length).toBeGreaterThanOrEqual(1);
    expect(o.implements.length).toBeGreaterThanOrEqual(1);
  });

  test("every ground-truth node references a real fixture symbol", () => {
    const violations = checkOracleConsistency(loadOracle());
    expect(violations).toEqual([]);
  });

  // ANTI-VACUITY: the checker must BITE. A deliberately-broken oracle fails.
  test("anti-vacuity: a broken call target is caught", () => {
    const o = loadOracle();
    o.calls.push({
      from: "function:src/a.ts:main",
      to: "function:src/b.ts:doesNotExist",
      cross_file: true,
    });
    expect(checkOracleConsistency(o).length).toBeGreaterThan(0);
  });

  test("anti-vacuity: a dead function that is actually called is caught", () => {
    const o = loadOracle();
    // Make a real dead function appear as a call target → contradiction.
    o.calls.push({
      from: "function:src/a.ts:main",
      to: "function:src/b.ts:unusedHelper",
      cross_file: true,
    });
    const violations = checkOracleConsistency(o);
    expect(violations.some((v) => v.includes("not dead"))).toBe(true);
  });

  test("anti-vacuity: a mislabeled cross_file flag is caught", () => {
    const o = loadOracle();
    // sumList1 is intra-file to main; flip the flag.
    o.calls = o.calls.map((c) =>
      c.to === "function:src/a.ts:sumList1" ? { ...c, cross_file: true } : c,
    );
    expect(checkOracleConsistency(o).some((v) => v.includes("cross_file"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. Parity harness — SQLite-optional, both modes provably run
// ---------------------------------------------------------------------------

describe("CLRA parity harness — index:off vs index:on", () => {
  let tmpRepo: string;

  // FIX G14-8: seed REAL edges (calls/inherits/implements) — not edges:[] — and
  // include every edge endpoint (functions AND classes) as a node, so a broken
  // kg_edges projection cannot pass green. The query below compares nodes AND
  // edges across modes.
  beforeAll(() => {
    tmpRepo = fs.mkdtempSync(path.join(os.tmpdir(), "clra-parity-"));
    const o = loadOracle();

    const edges = [
      ...o.calls.map((c) => ({ source: c.from, target: c.to, type: "calls", direction: "out", weight: 0.9 })),
      ...o.inherits.map((i) => ({ source: i.child, target: i.parent, type: "inherits", direction: "out", weight: 0.9 })),
      ...o.implements.map((i) => ({ source: i.class, target: i.interface, type: "implements", direction: "out", weight: 0.9 })),
    ];

    const ids = new Set<string>();
    for (const e of edges) { ids.add(e.source); ids.add(e.target); }
    for (const ep of o.entryPoints) ids.add(ep);
    for (const d of o.deadCode) ids.add(d);
    for (const [a, b] of o.clonePairs) { ids.add(a); ids.add(b); }

    const nodes = [...ids].sort().map((id) => {
      const p = parseNodeId(id);
      return { id, type: p.type, name: p.name, source_refs: [p.relpath], confidence: "high" };
    });

    const graph = {
      version: "guild.knowledge_graph.v1",
      generated_from_commit: "fixture",
      project: { name: "clra-fixture", description: "" },
      nodes,
      edges,
      layers: [],
      tour: [],
    };
    const idxDir = path.join(tmpRepo, ".guild", "indexes");
    fs.mkdirSync(idxDir, { recursive: true });
    fs.writeFileSync(path.join(idxDir, "knowledge-graph.json"), JSON.stringify(graph), "utf8");
  });

  afterAll(() => {
    if (tmpRepo) fs.rmSync(tmpRepo, { recursive: true, force: true });
  });

  /**
   * Read the FULL graph projection — node ids+types AND edge triples — sorted.
   * - index:on  → ensureKgIndex populates index.sqlite; read from kg_nodes + kg_edges.
   * - index:off → ensureKgIndex returns null; read from the JSON.
   * Reports engagement (FIX G14-7) so the harness can prove off bypassed SQLite
   * and on engaged it; reads edges (FIX G14-8) so a broken edge projection fails.
   */
  function readProjection(ctx: IndexModeContext): { nodes: string[]; edges: string[] } {
    const res = ensureKgIndex(tmpRepo, ctx.config);
    const usedSqlite = !!(res && res.dbPath);
    ctx.reportEngagement(usedSqlite);

    if (usedSqlite) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { DatabaseSync } = require("node:sqlite") as {
        DatabaseSync: new (p: string) => {
          prepare(sql: string): { all(): Array<Record<string, string>> };
          close(): void;
        };
      };
      const db = new DatabaseSync(res!.dbPath!);
      try {
        const nodeRows = db.prepare("SELECT id, type FROM kg_nodes").all();
        const edgeRows = db.prepare("SELECT source, target, type FROM kg_edges").all();
        return {
          nodes: nodeRows.map((r) => `${r.id}|${r.type}`).sort(),
          edges: edgeRows.map((r) => `${r.type}|${r.source}|${r.target}`).sort(),
        };
      } finally {
        db.close();
      }
    }
    const kgPath = path.join(tmpRepo, ".guild", "indexes", "knowledge-graph.json");
    const graph = JSON.parse(fs.readFileSync(kgPath, "utf8")) as {
      nodes: Array<{ id: string; type: string }>;
      edges: Array<{ source: string; target: string; type: string }>;
    };
    return {
      nodes: graph.nodes.map((n) => `${n.id}|${n.type}`).sort(),
      edges: graph.edges.map((e) => `${e.type}|${e.source}|${e.target}`).sort(),
    };
  }

  test("runBothIndexModes: nodes AND edges identical off vs on; engagement PROVEN", () => {
    const outcome = runBothIndexModes(readProjection, {
      // Lower thresholds so the tiny fixture graph still triggers the SQLite
      // projection in the `on` mode.
      overrides: { kg_node_threshold: 0, kg_size_threshold_mb: 0 },
    });

    expect(outcome.ranBoth).toBe(true);
    expect(outcome.executed).toEqual(["off", "on"]);
    expect(outcome.identical).toBe(true);
    expect(outcome.off.nodes.length).toBeGreaterThan(0);
    expect(outcome.off.edges.length).toBeGreaterThan(0); // edges actually projected
    expect(outcome.off).toEqual(outcome.on);
    // FIX G14-7: off must NOT have used SQLite; on MUST have.
    expect(outcome.engagementProven).toBe(true);
    expect(outcome.engagement).toEqual({ off: false, on: true });
  });

  test("deepEqual is key-order-independent but order-sensitive for arrays", () => {
    expect(deepEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
    expect(deepEqual([1, 2, 3], [3, 2, 1])).toBe(false); // ranking order matters
    expect(canonicalize({ b: 1, a: 2 })).toBe(canonicalize({ a: 2, b: 1 }));
  });
});

// ---------------------------------------------------------------------------
// 3. Goal-wiring placeholders — activate as each lane lands.
//
// NOTE: skipped tests ESCAPE the gate. When a lane wires its extraction to the
// shared fixture, it MUST replace the describe.skip with describe and assert
// against the oracle (clra-fixture.expected.json). Leaving these skipped after
// the feature lands is a silent coverage hole.
// ---------------------------------------------------------------------------

// G1 + G2 — model-free structural extraction (G1) + import/type-aware call
// resolution (G2). Wired against the shared oracle: structural
// calls/imports/inherits/implements match expected.json; oracle precision/recall
// meet the G2 thresholds (TS ≥85%, Py ≥80%); SQLite-off parity holds.
describe("[G1+G2] structural extraction + resolved calls match the oracle", () => {
  const REL_FILES = [
    "src/a.ts", "src/b.ts", "src/shapes.ts",
    "py/a.py", "py/b.py", "py/shapes.py",
  ];
  const readFile = (abs: string) => fs.readFileSync(abs, "utf8");

  function buildGraph(): { nodes: Array<Record<string, unknown>>; edges: GraphEdge[] } {
    const base = extractStructuralGraph(FIXTURE_ROOT, REL_FILES, readFile);
    const refined = refineCalls(FIXTURE_ROOT, REL_FILES, readFile, base);
    return { nodes: refined.nodes as unknown as Array<Record<string, unknown>>, edges: refined.edges };
  }

  // module-level function = function:<rel>:<name> with no "." in the name (excludes methods)
  const relOf = (id: string) => {
    const parts = id.split(":");
    return parts[0] === "file" ? parts.slice(1).join(":") : parts.slice(1, -1).join(":");
  };
  const nameOf = (id: string) => id.split(":").slice(2).join(":");
  const isModuleFn = (id: string) => id.startsWith("function:") && !nameOf(id).includes(".");

  function prAndRecall(predicted: Set<string>, oracle: Set<string>) {
    let hit = 0;
    for (const p of predicted) if (oracle.has(p)) hit++;
    const precision = predicted.size === 0 ? 1 : hit / predicted.size;
    const recall = oracle.size === 0 ? 1 : hit / oracle.size;
    return { precision, recall, hit };
  }

  test("calls — oracle precision/recall: TS ≥ 85%, Python ≥ 80% (numbers reported)", () => {
    const o = loadOracle();
    const g = buildGraph();
    const predictedCalls = (g.edges as GraphEdge[]).filter((e) => e.type === "calls");

    const predModuleLevel = (ext: string) =>
      new Set(
        predictedCalls
          .filter((e) => isModuleFn(e.source) && isModuleFn(e.target) && relOf(e.source).endsWith(ext))
          .map((e) => `${e.source}->${e.target}`),
      );
    const oracleFor = (ext: string) =>
      new Set(o.calls.filter((c) => relOf(c.from).endsWith(ext)).map((c) => `${c.from}->${c.to}`));

    const ts = prAndRecall(predModuleLevel(".ts"), oracleFor(".ts"));
    const py = prAndRecall(predModuleLevel(".py"), oracleFor(".py"));

    // eslint-disable-next-line no-console
    console.log(
      `[G2 oracle] TS precision=${(ts.precision * 100).toFixed(1)}% recall=${(ts.recall * 100).toFixed(1)}% | ` +
      `Python precision=${(py.precision * 100).toFixed(1)}% recall=${(py.recall * 100).toFixed(1)}%`,
    );

    expect(ts.precision).toBeGreaterThanOrEqual(0.85);
    expect(ts.recall).toBeGreaterThanOrEqual(0.85);
    expect(py.precision).toBeGreaterThanOrEqual(0.80);
    expect(py.recall).toBeGreaterThanOrEqual(0.80);
  });

  test("every oracle call is present, with the correct (cross-file) target node id", () => {
    const o = loadOracle();
    const g = buildGraph();
    const callSet = new Set((g.edges as GraphEdge[]).filter((e) => e.type === "calls").map((e) => `${e.source}->${e.target}`));
    for (const c of o.calls) {
      expect(callSet.has(`${c.from}->${c.to}`)).toBe(true);
    }
  });

  test("anti-vacuity: a plausible wrong call (main→unusedHelper) is NOT in the real extracted edges", () => {
    const g = buildGraph();
    const callSet = new Set((g.edges as GraphEdge[]).filter((e) => e.type === "calls").map((e) => `${e.source}->${e.target}`));
    // unusedHelper exists and is a valid function, but main never calls it — the
    // real extractor must not invent the edge (proves the oracle-match gate bites).
    expect(callSet.has("function:src/a.ts:main->function:src/b.ts:unusedHelper")).toBe(false);
    expect(callSet.has("function:py/a.py:main->function:py/b.py:unused_helper")).toBe(false);
  });

  test("inherits + implements edges match the oracle", () => {
    const o = loadOracle();
    const g = buildGraph();
    const inh = new Set((g.edges as GraphEdge[]).filter((e) => e.type === "inherits").map((e) => `${e.source}->${e.target}`));
    const impl = new Set((g.edges as GraphEdge[]).filter((e) => e.type === "implements").map((e) => `${e.source}->${e.target}`));
    for (const i of o.inherits) expect(inh.has(`${i.child}->${i.parent}`)).toBe(true);
    for (const i of o.implements) expect(impl.has(`${i.class}->${i.interface}`)).toBe(true);
  });

  test("import edges connect each importer to its resolved target file", () => {
    const g = buildGraph();
    const importEdges = new Set((g.edges as GraphEdge[]).filter((e) => e.type === "imports").map((e) => `${e.source}->${e.target}`));
    // a.ts → b.ts and a.ts → shapes.ts; a.py → b.py and a.py → shapes.py
    expect(importEdges.has("file:src/a.ts->file:src/b.ts")).toBe(true);
    expect(importEdges.has("file:src/a.ts->file:src/shapes.ts")).toBe(true);
    expect(importEdges.has("file:py/a.py->file:py/b.py")).toBe(true);
    expect(importEdges.has("file:py/a.py->file:py/shapes.py")).toBe(true);
  });

  // ── SQLite-off parity: resolved calls identical with index:off and index:on ──
  describe("SQLite-off parity for resolved calls", () => {
    let tmpRepo: string;

    beforeAll(() => {
      tmpRepo = fs.mkdtempSync(path.join(os.tmpdir(), "clra-g2-parity-"));
      const g = buildGraph();
      const graph = {
        version: "guild.knowledge_graph.v1",
        generated_from_commit: "fixture",
        project: { name: "clra-fixture", description: "" },
        nodes: g.nodes,
        edges: g.edges,
        layers: [],
        tour: [],
      };
      const idxDir = path.join(tmpRepo, ".guild", "indexes");
      fs.mkdirSync(idxDir, { recursive: true });
      fs.writeFileSync(path.join(idxDir, "knowledge-graph.json"), JSON.stringify(graph), "utf8");
    });

    afterAll(() => {
      if (tmpRepo) fs.rmSync(tmpRepo, { recursive: true, force: true });
    });

    // Read the FULL refined projection — calls edges WITH confidence, plus
    // every other edge, plus nodes — from SQLite (on) or JSON (off). Comparing
    // nodes AND edges (FIX G14-8) makes a broken edge projection fail; the
    // confidence round-trips through kg_edges.data.
    function readProjection(ctx: IndexModeContext): { nodes: string[]; edges: string[] } {
      const res = ensureKgIndex(tmpRepo, ctx.config);
      const usedSqlite = !!(res && res.dbPath);
      ctx.reportEngagement(usedSqlite);

      if (usedSqlite) {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { DatabaseSync } = require("node:sqlite") as {
          DatabaseSync: new (p: string) => {
            prepare(sql: string): { all(): Array<Record<string, string>> };
            close(): void;
          };
        };
        const db = new DatabaseSync(res!.dbPath!);
        try {
          const nodeRows = db.prepare("SELECT id, type FROM kg_nodes").all();
          const edgeRows = db.prepare("SELECT source, target, type, data FROM kg_edges").all();
          return {
            nodes: nodeRows.map((r) => `${r.id}|${r.type}`).sort(),
            edges: edgeRows.map((r) => {
              const conf = (() => { try { return (JSON.parse(r.data) as { confidence?: string }).confidence ?? "-"; } catch { return "-"; } })();
              return `${r.type}|${r.source}|${r.target}|${conf}`;
            }).sort(),
          };
        } finally {
          db.close();
        }
      }
      const kgPath = path.join(tmpRepo, ".guild", "indexes", "knowledge-graph.json");
      const graph = JSON.parse(fs.readFileSync(kgPath, "utf8")) as {
        nodes: Array<{ id: string; type: string }>;
        edges: GraphEdge[];
      };
      return {
        nodes: graph.nodes.map((n) => `${n.id}|${n.type}`).sort(),
        edges: graph.edges.map((e) => `${e.type}|${e.source}|${e.target}|${(e as Record<string, unknown>).confidence ?? "-"}`).sort(),
      };
    }

    test("resolved graph (nodes+edges, calls confidence) identical off vs on; engagement PROVEN", () => {
      const outcome = runBothIndexModes(readProjection, {
        overrides: { kg_node_threshold: 0, kg_size_threshold_mb: 0 },
      });
      expect(outcome.ranBoth).toBe(true);
      expect(outcome.identical).toBe(true);
      expect(outcome.off.nodes.length).toBeGreaterThan(0);
      expect(outcome.off.edges.some((e) => e.startsWith("calls|"))).toBe(true);
      expect(outcome.off).toEqual(outcome.on);
      expect(outcome.engagementProven).toBe(true);
      expect(outcome.engagement).toEqual({ off: false, on: true });
    });
  });
});

// G3 — structural query API. Wire: kg_trace(inbound) returns the oracle call
// chain; kg_dead_code equals oracle.deadCode (precision & recall = 1.0); query
// results identical with index:off and index:on via runBothIndexModes.
describe.skip("[G3] structural query API matches the oracle (WIRE WHEN G3 LANDS)", () => {
  test("placeholder — dead-code list equals oracle.deadCode (functions only)", () => {
    // const dead = kgDeadCode(graph); expect(new Set(dead)).toEqual(new Set(loadOracle().deadCode));
  });
});

// G8 — local model-free similarity. Wire: kg_similar(cloneA) ranks cloneB #1
// (precision@1 = 1.0 on oracle.clonePairs); deterministic; SQLite-off parity.
describe.skip("[G8] code similarity ranks the clone pair first (WIRE WHEN G8 LANDS)", () => {
  test("placeholder — each clonePair[i][1] is the top neighbor of clonePair[i][0]", () => {
    // for (const [a, b] of loadOracle().clonePairs) expect(kgSimilar(a)[0]).toBe(b);
  });
});

// G9 — impact & architecture recall. Wire: impact(diff touching b.ts) flags the
// reverse-reachable callers (a.ts) and not unrelated files; SQLite-off parity.
describe.skip("[G9] impact analysis flags reverse-reachable callers (WIRE WHEN G9 LANDS)", () => {
  test("placeholder — editing b.ts flags a.ts as impacted, shapes.ts not", () => {
    // expect(impact(["src/b.ts"]).map(n=>n.file)).toContain("src/a.ts");
  });
});
