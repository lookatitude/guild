/**
 * tests/universal-host/p2-w1-sc4-workspace-impact.test.ts
 *
 * SC-W1-4 (AC33/AC34) — AUTHORITATIVE impact-detector tests over a REAL ≥3-child fixture
 * workspace, driving the SHIPPED `detectImpactFromWorkspace()` / `detectImpact()` (LW1-4).
 * Proves: (1) the transitive affected set is correct over a dependency chain; (2)
 * ANTI-VACUOUS isolation (F-7) — an instrumented fs seam records EVERY read and asserts
 * NONE lands under any child `.guild/wiki/**`, AND a positive control proves the guard is
 * not vacuous (a deliberate child-wiki read THROWS); (3) the emitted map carries only
 * ids/paths/dependency_reasons (schema rejects extra keys).
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  detectImpact,
  detectImpactFromWorkspace,
} from "../../scripts/lib/workspace-impact-detector";
import {
  guardChildWikiReads,
  isChildWikiPath,
  type FsReadSeam,
} from "../../scripts/lib/dependency-graph-reader";
import { validateWorkspaceImpactV1 } from "../../scripts/lib/workspace-impact-schema";
import type { DependencyGraphV1 } from "../../scripts/lib/dependency-graph-schema";

const GRAPH: DependencyGraphV1 = {
  schema_version: "guild.dependency_graph.v1",
  nodes: [
    { id: "plugin", path: "plugin" },
    { id: "website", path: "website" },
    { id: "benchmark", path: "benchmark" },
  ],
  edges: [
    { from: "website", to: "plugin" }, // website depends on plugin
    { from: "benchmark", to: "website" }, // benchmark depends on website (→ transitively on plugin)
  ],
};

/** A recording read seam that performs REAL reads but logs every accessed path. */
function recordingSeam(log: string[]): FsReadSeam {
  return {
    exists(p: string): boolean {
      log.push(p);
      return fs.existsSync(p);
    },
    readFile(p: string): string {
      log.push(p);
      return fs.readFileSync(p, "utf8");
    },
  };
}

function mkFixtureWorkspace(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "guild-sc4-"));
  const wsDir = path.join(root, ".guild", "workspace");
  fs.mkdirSync(wsDir, { recursive: true });
  fs.writeFileSync(path.join(wsDir, "dependency-graph.json"), JSON.stringify(GRAPH, null, 2));
  // A child wiki the detector must NEVER read.
  const childWiki = path.join(root, "plugin", ".guild", "wiki", "decisions");
  fs.mkdirSync(childWiki, { recursive: true });
  fs.writeFileSync(path.join(childWiki, "secret.md"), "SECRET CHILD KNOWLEDGE — must not be read");
  return root;
}

describe("SC-W1-4 — transitive impact (pure detector)", () => {
  it("computes the transitive affected set from a dependency chain", () => {
    const impact = detectImpact(GRAPH, ["plugin"]);
    expect(impact.affected.map((a) => a.id).sort()).toEqual(["benchmark", "website"]);
    expect(impact.transitive).toBe(true); // benchmark is reached at depth 2
    expect(validateWorkspaceImpactV1(impact).valid).toBe(true);
  });

  it("emits a 'nothing impacted' map for a change with no dependents", () => {
    const impact = detectImpact(GRAPH, ["benchmark"]); // nothing depends on benchmark
    expect(impact.affected).toEqual([]);
    expect(validateWorkspaceImpactV1(impact).valid).toBe(true);
  });
});

describe("SC-W1-4 — anti-vacuous child-wiki isolation (F-7)", () => {
  let root: string;
  beforeAll(() => {
    root = mkFixtureWorkspace();
  });
  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("detects impact over the fixture WITHOUT reading any child .guild/wiki/** path", () => {
    const log: string[] = [];
    const res = detectImpactFromWorkspace(root, ["plugin"], recordingSeam(log));
    expect(res.valid).toBe(true);
    expect(res.impact?.affected.map((a) => a.id).sort()).toEqual(["benchmark", "website"]);
    // The instrumentation assertion: zero reads under any child wiki.
    const wikiReads = log.filter((p) => isChildWikiPath(p));
    expect(wikiReads).toEqual([]);
    // And it DID read the root-side source (proves the test isn't trivially passing on no reads).
    expect(log.some((p) => p.endsWith(path.join(".guild", "workspace", "dependency-graph.json")))).toBe(true);
  });

  it("POSITIVE CONTROL: the guard is not vacuous — a deliberate child-wiki read THROWS", () => {
    const guarded = guardChildWikiReads(recordingSeam([]));
    const childWiki = path.join(root, "plugin", ".guild", "wiki", "decisions", "secret.md");
    expect(() => guarded.readFile(childWiki)).toThrow(/F-7|isolation/i);
  });

  it("the emitted map carries only id/path/dependency_reason (no smuggled child content)", () => {
    const res = detectImpactFromWorkspace(root, ["plugin"]);
    for (const a of res.impact?.affected ?? []) {
      expect(Object.keys(a).sort()).toEqual(["dependency_reason", "id", "path"]);
      expect(a.dependency_reason).not.toMatch(/SECRET CHILD KNOWLEDGE/);
    }
  });
});
