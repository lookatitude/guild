/**
 * K03 (CW-20) — all writers enumerated and upgraded; legacy exports compatible.
 * Disposable git repos only.
 */
import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execFileSync } from "child_process";

import { legacyExportState, readPublication } from "../../../src/domains/knowledge/publication";
import {
  GRAPH_ARTIFACT,
  NON_LAYER_WRITERS,
  PUBLICATION_WRITERS,
  learnTarget,
  ownerArtifactTarget,
  publishLearnArtifacts,
  readLearnBase,
  runGraphStage,
  semanticView,
  structuralView,
} from "./publish";
import { guildPaths } from "./paths";
import { STRUCTURAL_EXTRACTOR } from "./structural";

const PLUGIN = path.resolve(__dirname, "..", "..", "..");
const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) fs.rmSync(r, { recursive: true, force: true });
});

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", "dist", "__tests__", "__fixtures__", "fixtures"].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith(".ts") && !e.name.endsWith(".test.ts") && !e.name.endsWith(".d.ts")) out.push(p);
  }
  return out;
}

const NAMES = /knowledge-graph\.json|knowledge-recall\.json|\bknowledgeGraph\b|\bknowledgeRecall\b|\bGRAPH_ARTIFACT\b|\bRECALL_ARTIFACT\b/;
const WRITES = /writeFileSync|writeJson\(|atomicWrite|renameSync|copyFileSync|appendFileSync|writeContainedFile/;
const DIRECT = /(writeJson|writeFileSync|atomicWrite\w*|writeContainedFile)\(\s*(gp\.knowledgeGraph|gp\.knowledgeRecall|graphPath|linksPath|[^;\n]*?"knowledge-(graph|recall)\.json")/;

describe("K03 all-writer inventory", () => {
  const files = ["scripts", "src", "hooks", "mcp-servers"]
    .filter((d) => fs.existsSync(path.join(PLUGIN, d)))
    .flatMap((d) => walk(path.join(PLUGIN, d)))
    .map((f) => path.relative(PLUGIN, f).split(path.sep).join("/"));
  const listed = new Set([...PUBLICATION_WRITERS.map((w) => w.file), ...NON_LAYER_WRITERS.map((w) => w.file)]);

  test("every module that names a published artifact and writes is inventoried", () => {
    const writers = files.filter((f) => {
      const body = fs.readFileSync(path.join(PLUGIN, f), "utf8");
      return NAMES.test(body) && WRITES.test(body);
    });
    expect(writers.length).toBeGreaterThan(8); // anti-vacuity: the scan sees the learn writers
    expect(writers.filter((f) => !listed.has(f))).toEqual([]);
    for (const f of listed) expect(fs.existsSync(path.join(PLUGIN, f))).toBe(true);
  });

  test("publishers route through the publisher and never write the artifact directly", () => {
    for (const w of PUBLICATION_WRITERS) {
      const body = fs.readFileSync(path.join(PLUGIN, w.file), "utf8");
      expect({ file: w.file, publishes: /publishLearnArtifacts|runGraphStage/.test(body) }).toEqual({ file: w.file, publishes: true });
      expect({ file: w.file, direct: DIRECT.exec(body)?.[0] ?? null }).toEqual({ file: w.file, direct: null });
    }
  });

  test("negative control: the direct-write pattern catches the pre-K03 writer shape", () => {
    expect(DIRECT.test(`writeJson(gp.knowledgeGraph, result.data);`)).toBe(true);
    expect(DIRECT.test(`fs.writeFileSync(graphPath, JSON.stringify(graph));`)).toBe(true);
    expect(DIRECT.test(`fs.writeFileSync(path.join(d, "knowledge-recall.json"), x)`)).toBe(true);
  });
});

function gitRepo(): string {
  const r = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "k03-w-")));
  roots.push(r);
  const g = (...a: string[]) => execFileSync("git", a, { cwd: r, stdio: "ignore" });
  g("init", "-q");
  g("config", "user.email", "t@t");
  g("config", "user.name", "t");
  fs.mkdirSync(path.join(r, "src"));
  fs.writeFileSync(path.join(r, "src", "a.ts"), 'import { b } from "./b";\nexport function a(): number { return b(); }\n');
  fs.writeFileSync(path.join(r, "src", "b.ts"), "export function b(): number { return 1; }\n");
  g("add", "-A");
  g("commit", "-qm", "init");
  return r;
}

function cli(script: string, repo: string): void {
  execFileSync("npx", ["tsx", path.join(PLUGIN, "scripts", "learn", script), "--cwd", repo], { cwd: PLUGIN, stdio: "pipe" });
}

describe("K03 migrated writers publish generations", () => {
  test("each learn stage CLI moves the pointer, keeps the export in sync and carries other layers", () => {
    const r = gitRepo();
    const idx = path.join(r, ".guild", "indexes");
    const seen: string[] = [];
    for (const s of ["extract-structural.ts", "resolve-calls.ts", "assign-layers.ts", "derive-domain.ts", "build-tour.ts"]) {
      cli(s, r);
      const pub = readPublication(idx)!;
      expect(pub).not.toBeNull();
      expect(seen).not.toContain(pub.pointer.generation);
      seen.push(pub.pointer.generation);
      expect(legacyExportState(idx, GRAPH_ARTIFACT).state).toBe("matches_generation");
      const ch = Object.fromEntries(pub.record.channels.map((c) => [c.channel, c.state]));
      expect(ch.structural_graph).toBe("current_for_basis");
    }
    // Layers/tour/domain transform the semantic layer; they never make it current.
    const ch = Object.fromEntries(readPublication(idx)!.record.channels.map((c) => [c.channel, c.state]));
    expect(ch.semantic_graph).toBe("unknown");
  }, 120000);

  test("an explicit --in naming the owner export (any spelling) still publishes", () => {
    const r = gitRepo();
    cli("extract-structural.ts", r);
    const idx = path.join(r, ".guild", "indexes");
    const before = readPublication(idx)!.pointer.generation;
    execFileSync("npx", ["tsx", path.join(PLUGIN, "scripts", "learn", "assign-layers.ts"), "--cwd", r, "--in", ".guild/indexes/../indexes/knowledge-graph.json"], { cwd: PLUGIN, stdio: "pipe" });
    expect(readPublication(idx)!.pointer.generation).not.toBe(before);
    expect(legacyExportState(idx, GRAPH_ARTIFACT).state).toBe("matches_generation");
  }, 60000);

  test("AT35 with real graph layers: a semantic stage that lost the race rebases onto the structural publish", () => {
    const r = gitRepo();
    cli("extract-structural.ts", r);
    const gp = guildPaths(r);
    const t = learnTarget(gp);
    let raced = false;
    const out = runGraphStage<{ nodes: Array<Record<string, unknown>>; edges: unknown[]; layers: unknown[] }>(gp, {
      target: null,
      who: "test",
      channels: ["semantic_graph"],
      transform: (g) => {
        if (!raced) {
          raced = true;
          // A structural writer publishes between this stage's read and its publish.
          const res = publishLearnArtifacts(t, {
            channels: ["structural_graph"],
            build: (b) => ({
              [GRAPH_ARTIFACT]: { ...b.graph, nodes: [...(b.graph!.nodes ?? []), { id: "file:src/new.ts", type: "file", name: "new.ts", extractor: STRUCTURAL_EXTRACTOR, source_refs: ["src/new.ts"] }] },
            }),
          });
          expect(res.status).toBe("published");
        }
        g.nodes.push({ id: "concept:k03", type: "concept", name: "k03", extractor: "llm-tier" });
        return g;
      },
    })!;
    const ids = out.nodes.map((n) => n.id);
    expect(ids).toContain("file:src/new.ts");
    expect(ids).toContain("concept:k03");
    const pub = readPublication(gp.indexesDir)!;
    const g = JSON.parse(pub.artifacts[GRAPH_ARTIFACT]!.toString("utf8"));
    expect(g.nodes.map((n: { id: string }) => n.id)).toEqual(expect.arrayContaining(["file:src/new.ts", "concept:k03"]));
    expect(readLearnBase(t).bypassed_export).toBe(false);
  }, 60000);

  test("negative control: a bypass write at the export path is never adopted once a generation exists", () => {
    const r = gitRepo();
    cli("extract-structural.ts", r);
    const idx = path.join(r, ".guild", "indexes");
    const before = readPublication(idx)!;
    const g = JSON.parse(fs.readFileSync(path.join(idx, GRAPH_ARTIFACT), "utf8"));
    g.nodes = g.nodes.filter((n: { extractor?: string }) => n.extractor !== STRUCTURAL_EXTRACTOR);
    g.source_basis = before.manifest.source_basis; // claims fresh
    fs.writeFileSync(path.join(idx, GRAPH_ARTIFACT), JSON.stringify(g));
    expect(legacyExportState(idx, GRAPH_ARTIFACT).state).toBe("unknown");
    expect(readLearnBase(learnTarget(guildPaths(r))).bypassed_export).toBe(true);
    cli("assign-layers.ts", r);
    const pub = readPublication(idx)!;
    const nodes = JSON.parse(pub.artifacts[GRAPH_ARTIFACT]!.toString("utf8")).nodes as Array<{ extractor?: string }>;
    expect(nodes.some((n) => n.extractor === STRUCTURAL_EXTRACTOR)).toBe(true); // the stale bypass did not erase the layer
    expect(legacyExportState(idx, GRAPH_ARTIFACT).state).toBe("matches_generation");
  }, 60000);

  test("knowledge labels on structural nodes survive a structural rebuild", () => {
    const r = gitRepo();
    cli("extract-structural.ts", r);
    cli("assign-layers.ts", r);
    const idx = path.join(r, ".guild", "indexes");
    const label = (pub: ReturnType<typeof readPublication>) =>
      (JSON.parse(pub!.artifacts[GRAPH_ARTIFACT]!.toString("utf8")).nodes as Array<{ id: string; component?: string }>).find((n) => n.id === "file:src/a.ts")?.component;
    expect(label(readPublication(idx))).toBe("Core");
    cli("extract-structural.ts", r);
    expect(label(readPublication(idx))).toBe("Core");
    const ch = Object.fromEntries(readPublication(idx)!.record.channels.map((c) => [c.channel, c.state]));
    expect(ch.structural_graph).toBe("current_for_basis");
  }, 60000);

  test("a structural job whose output drops a semantic node is refused (undeclared layer change)", () => {
    const r = gitRepo();
    cli("extract-structural.ts", r);
    const gp = guildPaths(r);
    const t = learnTarget(gp);
    runGraphStage<{ nodes: Array<Record<string, unknown>> }>(gp, {
      target: null, who: "seed", channels: ["semantic_graph"],
      transform: (g) => { g.nodes.push({ id: "concept:keep", type: "concept", name: "keep", extractor: "llm-tier" }); return g; },
    });
    const res = publishLearnArtifacts(t, {
      channels: ["structural_graph"],
      build: (b) => ({ [GRAPH_ARTIFACT]: { ...b.graph, nodes: (b.graph!.nodes ?? []).filter((n) => n.id !== "concept:keep") } }),
    });
    expect(res.status === "refused" && res.reason).toBe("undeclared_layer_change");
  }, 60000);

  test("the basis is taken before build inputs: a source edit during the build is refused", () => {
    const r = gitRepo();
    cli("extract-structural.ts", r);
    const gp = guildPaths(r);
    const res = publishLearnArtifacts(learnTarget(gp), {
      channels: ["structural_graph"],
      build: (b) => {
        fs.writeFileSync(path.join(r, "src", "b.ts"), "export function b(): number { return 2; }\n");
        return { [GRAPH_ARTIFACT]: b.graph };
      },
    });
    expect(res.status === "refused" && res.reason).toBe("source_drift");
    expect(() => publishLearnArtifacts(learnTarget(gp), { channels: ["structural_graph"], base: readLearnBase(learnTarget(gp)), build: (b) => ({ [GRAPH_ARTIFACT]: b.graph }) })).toThrow(/basis/);
  }, 60000);

  test("a symlinked owner export is still the owner namespace: published, never written through", () => {
    const r = gitRepo();
    cli("extract-structural.ts", r);
    const gp = guildPaths(r);
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "k03-out-"));
    roots.push(outside);
    fs.writeFileSync(path.join(outside, "victim.json"), "keep");
    fs.rmSync(path.join(gp.indexesDir, GRAPH_ARTIFACT));
    fs.symlinkSync(path.join(outside, "victim.json"), path.join(gp.indexesDir, GRAPH_ARTIFACT));
    expect(ownerArtifactTarget(gp, path.join(gp.indexesDir, GRAPH_ARTIFACT))).toBe("export");
    expect(() => runGraphStage(gp, { target: path.join(gp.indexesDir, GRAPH_ARTIFACT), who: "t", channels: ["semantic_graph"], transform: (g) => g })).toThrow();
    expect(fs.readFileSync(path.join(outside, "victim.json"), "utf8")).toBe("keep");
  }, 60000);

  test("a raw .. in an explicit target is refused (it cannot be classified truthfully)", () => {
    const r = gitRepo();
    cli("extract-structural.ts", r);
    const gp = guildPaths(r);
    expect(ownerArtifactTarget(gp, `${gp.indexesDir}/scratch/jump/../CURRENT`)).toBe("store");
    let code = 0;
    try {
      execFileSync("npx", ["tsx", path.join(PLUGIN, "scripts", "learn", "resolve-calls.ts"), "--cwd", r, "--out", ".guild/indexes/scratch/../publication/CURRENT"], { cwd: PLUGIN, stdio: "pipe" });
    } catch (e) {
      code = (e as { status: number }).status;
    }
    expect(code).not.toBe(0);
    expect(readPublication(gp.indexesDir)).not.toBeNull();
  }, 60000);

  test("layer views: a structural collision stamp does not move the semantic layer", () => {
    const llm = { id: "file:src/a.ts", type: "file", name: "a.ts", extractor: "llm-tier", summary: "x" };
    const stamped = { ...llm, structural: true, sp: { a: 1 }, language: "typescript" };
    expect(semanticView({ nodes: [llm as never], edges: [] })).toEqual(semanticView({ nodes: [stamped as never], edges: [] }));
    expect(structuralView({ nodes: [llm as never], edges: [] })).not.toEqual(structuralView({ nodes: [stamped as never], edges: [] }));
  });
});
