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

// ---------------------------------------------------------------------------
// Fixture + oracle loading
// ---------------------------------------------------------------------------

const FIXTURE_ROOT = path.join(__dirname, "fixtures", "clra-fixture");
const ORACLE_PATH = path.join(FIXTURE_ROOT, "clra-fixture.expected.json");

interface Oracle {
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

  return violations;
}

// ---------------------------------------------------------------------------
// 1. Oracle self-consistency
// ---------------------------------------------------------------------------

describe("CLRA fixture — oracle self-consistency", () => {
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

  // Seed a tiny .guild/indexes/knowledge-graph.json from the oracle's function
  // nodes so the trivial query has real data to read both ways.
  beforeAll(() => {
    tmpRepo = fs.mkdtempSync(path.join(os.tmpdir(), "clra-parity-"));
    const o = loadOracle();
    const fnIds = new Set<string>();
    for (const c of o.calls) {
      fnIds.add(c.from);
      fnIds.add(c.to);
    }
    for (const ep of o.entryPoints) fnIds.add(ep);
    for (const d of o.deadCode) fnIds.add(d);
    for (const [a, b] of o.clonePairs) {
      fnIds.add(a);
      fnIds.add(b);
    }
    const nodes = [...fnIds].sort().map((id) => {
      const p = parseNodeId(id);
      return {
        id,
        type: "function",
        name: p.name,
        source_refs: [p.relpath],
        confidence: "high",
      };
    });
    const graph = {
      version: "guild.knowledge_graph.v1",
      generated_from_commit: "fixture",
      project: { name: "clra-fixture", description: "" },
      nodes,
      edges: [],
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
   * Trivial query: list the names of all `function` nodes, sorted.
   * - index:on  → ensureKgIndex populates index.sqlite; read names via SQL.
   * - index:off → ensureKgIndex returns null; read names from the JSON.
   * Records whether SQLite was actually engaged so the test can prove neither
   * mode was silently skipped.
   */
  function trivialQuery(observed: Array<{ mode: string; usedSqlite: boolean }>) {
    return (ctx: IndexModeContext): string[] => {
      const res = ensureKgIndex(tmpRepo, ctx.config);
      const usedSqlite = !!(res && res.dbPath);
      observed.push({ mode: ctx.mode, usedSqlite });

      if (usedSqlite) {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { DatabaseSync } = require("node:sqlite") as {
          DatabaseSync: new (p: string) => {
            prepare(sql: string): { all(): Array<{ name: string }> };
            close(): void;
          };
        };
        const db = new DatabaseSync(res!.dbPath!);
        try {
          const rows = db.prepare("SELECT name FROM kg_nodes WHERE type = 'function'").all();
          return rows.map((r) => r.name).sort();
        } finally {
          db.close();
        }
      }
      const kgPath = path.join(tmpRepo, ".guild", "indexes", "knowledge-graph.json");
      const graph = JSON.parse(fs.readFileSync(kgPath, "utf8")) as {
        nodes: Array<{ type: string; name: string }>;
      };
      return graph.nodes.filter((n) => n.type === "function").map((n) => n.name).sort();
    };
  }

  test("runBothIndexModes returns identical results and runs BOTH modes", () => {
    const observed: Array<{ mode: string; usedSqlite: boolean }> = [];
    const outcome = runBothIndexModes(trivialQuery(observed), {
      // Lower thresholds so the tiny fixture graph still triggers the SQLite
      // projection in the `on` mode.
      overrides: { kg_node_threshold: 0, kg_size_threshold_mb: 0 },
    });

    expect(outcome.ranBoth).toBe(true);
    expect(outcome.executed).toEqual(["off", "on"]);
    expect(outcome.identical).toBe(true);
    expect(outcome.off.length).toBeGreaterThan(0);
    expect(outcome.off).toEqual(outcome.on);
  });

  test("BOTH modes actually ran — off bypassed SQLite, on engaged it (not skipped)", () => {
    const observed: Array<{ mode: string; usedSqlite: boolean }> = [];
    runBothIndexModes(trivialQuery(observed), {
      overrides: { kg_node_threshold: 0, kg_size_threshold_mb: 0 },
    });
    expect(observed).toEqual([
      { mode: "off", usedSqlite: false },
      { mode: "on", usedSqlite: true },
    ]);
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

// G1 — model-free structural extraction. Wire: run extract-structural.ts on the
// fixture, assert the emitted calls/imports/inherits/implements subset equals
// the oracle; assert byte-identical across two runs; assert SQLite-off parity.
describe.skip("[G1] structural extraction matches the oracle (WIRE WHEN G1 LANDS)", () => {
  test("placeholder — emitted graph's structural subset equals the oracle", () => {
    // expect(extractStructural(FIXTURE_ROOT)).toMatchOracle(loadOracle());
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
