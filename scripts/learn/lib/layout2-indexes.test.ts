/**
 * Layout 2 (caches-out) keeps derived knowledge indexes off `.guild/` (#283).
 * A learn write on a layout 2 root lands on the platform cache root, verify sees
 * no drift, readers find the moved files, and a legacy `.guild/indexes` stays
 * readable until the upgrade removes it. Layout 1 roots are unchanged.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execFileSync } from "child_process";

import { guildRootId, knowledgeIndexesDir } from "../../../src/domains/state";
import { ensureStorageLayout } from "../../lib/state/ensure-storage-layout";
import { guildPaths } from "./paths";
import { publishLearnArtifacts, readLearnBase } from "./publish";
import { writeKnowledgeLinks } from "../write-knowledge-links";
import { writeInitiativesRegistry } from "../../registry-rollup";
import { loadOrCreateFingerprintSalt } from "../../../src/domains/config";

const TMP: string[] = [];
const savedCache = process.env.GUILD_CACHE_HOME;
let cacheHome: string;

beforeAll(() => {
  cacheHome = fs.mkdtempSync(path.join(os.tmpdir(), "guild-l2-cache-"));
  TMP.push(cacheHome);
  process.env.GUILD_CACHE_HOME = cacheHome;
});
afterAll(() => {
  if (savedCache === undefined) delete process.env.GUILD_CACHE_HOME;
  else process.env.GUILD_CACHE_HOME = savedCache;
  for (const d of TMP) fs.rmSync(d, { recursive: true, force: true });
});

function mkRoot(layout: 1 | 2 | null): string {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "guild-l2-")));
  TMP.push(d);
  fs.mkdirSync(path.join(d, ".guild"), { recursive: true });
  if (layout !== null) {
    fs.writeFileSync(path.join(d, ".guild", "storage-layout.json"), JSON.stringify({ storage_layout_version: layout }) + "\n");
  }
  return d;
}

const graph = { nodes: [{ id: "topic:a", type: "topic", name: "a", source_refs: [], confidence: 1 }], edges: [] } as never;

describe("layout 2 index home (#283)", () => {
  test("knowledgeIndexesDir is off-tree on layout 2 and .guild/indexes on layout 1 / unmarked", () => {
    const l2 = mkRoot(2);
    expect(knowledgeIndexesDir(l2).startsWith(cacheHome)).toBe(true);
    expect(knowledgeIndexesDir(l2).startsWith(path.join(l2, ".guild"))).toBe(false);
    for (const l of [1, null] as const) {
      const r = mkRoot(l);
      expect(knowledgeIndexesDir(r)).toBe(path.join(r, ".guild", "indexes"));
    }
  });

  test("guildPaths resolves every learn index under the cache dir on layout 2", () => {
    const l2 = mkRoot(2);
    const gp = guildPaths(l2);
    for (const p of [gp.codebaseMap, gp.knowledgeGraph, gp.knowledgeLinks, gp.knowledgeRecall, gp.fingerprint, gp.partialGraph]) {
      expect(p.startsWith(knowledgeIndexesDir(l2))).toBe(true);
    }
  });

  test("a learn publication writes nothing under .guild/indexes and verify reports no drift", () => {
    const l2 = mkRoot(2);
    const r = writeKnowledgeLinks({ graph, repoRoot: l2 });
    expect(fs.existsSync(path.join(l2, ".guild", "indexes"))).toBe(false);
    expect(r.linksPath.startsWith(cacheHome)).toBe(true);
    expect(fs.existsSync(r.linksPath)).toBe(true);
    expect(fs.existsSync(r.provenancePath)).toBe(true);
    expect(fs.existsSync(path.join(knowledgeIndexesDir(l2), "publication", "CURRENT"))).toBe(true);
    const status = ensureStorageLayout(l2, { dryRun: true, recheck: true });
    const report = status.upgrade?.report ?? "";
    expect(report).not.toMatch(/caches-out[^\n]*(would|planned|completed|removed)/i);
    expect(fs.existsSync(path.join(l2, ".guild", "indexes"))).toBe(false);
  });

  test("layout 1 root keeps writing .guild/indexes", () => {
    const l1 = mkRoot(1);
    const r = writeKnowledgeLinks({ graph, repoRoot: l1 });
    expect(r.linksPath).toBe(path.join(l1, ".guild", "indexes", "knowledge-recall.json"));
  });

  /** A real K03 legacy store: written on a layout 1 root, then the root is stamped layout 2. */
  function legacyPopulatedLayout2(): string {
    const r = mkRoot(1);
    writeKnowledgeLinks({ graph, repoRoot: r });
    expect(fs.existsSync(path.join(r, ".guild", "indexes", "publication", "CURRENT"))).toBe(true);
    fs.writeFileSync(path.join(r, ".guild", "storage-layout.json"), JSON.stringify({ storage_layout_version: 2 }) + "\n");
    return r;
  }
  const tree = (d: string): string[] => (fs.existsSync(d) ? (fs.readdirSync(d, { recursive: true }) as string[]).sort() : []);

  test("F1: the first publish on a legacy-populated layout 2 root succeeds, keeps recall, and never writes legacy", () => {
    const r = legacyPopulatedLayout2();
    const legacyBefore = tree(path.join(r, ".guild", "indexes"));
    const gp = guildPaths(r);
    // a graph-only stage publishes on top of the adopted generation
    const res = publishLearnArtifacts(
      { indexesDir: gp.indexesDir, repoRoot: gp.repoRoot, sourceRoot: gp.sourceRoot },
      { channels: ["structural_graph"], provenance: { structural_graph: "rebuilt" }, build: () => ({ "knowledge-graph.json": { nodes: [], edges: [], version: "x" } }) },
    );
    expect(res.status).toBe("published");
    expect(tree(path.join(r, ".guild", "indexes"))).toEqual(legacyBefore);
    expect(fs.existsSync(path.join(gp.indexesDir, "knowledge-recall.json"))).toBe(true);
  });

  test("F2: the whole legacy publication (pinned generation + recall layer) is adopted as one unit", () => {
    const r = legacyPopulatedLayout2();
    const gp = guildPaths(r);
    const base = readLearnBase({ indexesDir: gp.indexesDir, repoRoot: gp.repoRoot, sourceRoot: gp.sourceRoot });
    expect(base.pinned).not.toBeNull();
    expect(base.recall).not.toBeNull();
    expect(fs.existsSync(path.join(gp.indexesDir, "publication", "CURRENT"))).toBe(true);
    expect(fs.existsSync(path.join(gp.indexesDir, "publication", "lock"))).toBe(false);
  });

  test("F3: a source edit after a legacy generation reports it stale, not current", () => {
    const r = mkRoot(1);
    const git = (...a: string[]) => execFileSync("git", ["-C", r, ...a], { stdio: "ignore" });
    git("init", "-q");
    fs.mkdirSync(path.join(r, "src"), { recursive: true });
    fs.writeFileSync(path.join(r, "src", "a.ts"), "export function f() {\n  return 1;\n}\n");
    git("add", "-A");
    git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "seed");
    const run = (script: string, ...a: string[]) =>
      execFileSync("npx", ["tsx", path.resolve(__dirname, "..", script), "--cwd", r, ...a], { encoding: "utf8", timeout: 90000, env: process.env, stdio: ["ignore", "pipe", "ignore"] });
    run("extract-structural.ts");
    fs.writeFileSync(path.join(r, ".guild", "storage-layout.json"), JSON.stringify({ storage_layout_version: 2 }) + "\n");
    fs.writeFileSync(path.join(r, "src", "a.ts"), "export function f() {\n  return 2;\n}\nexport function g() {}\n");
    const out = JSON.parse(run("staleness.ts", "--print")) as { publication?: { channels?: Array<{ state: string }>; error?: string } };
    expect(out.publication?.error).toBeUndefined();
    const states = (out.publication?.channels ?? []).map((c) => c.state);
    expect(states.length).toBeGreaterThan(0);
    expect(states).not.toContain("current_for_basis");
  });

  test("layout 1 root still writes .guild/indexes exactly as before", () => {
    const l1 = mkRoot(1);
    const r = writeKnowledgeLinks({ graph, repoRoot: l1 });
    expect(r.provenancePath).toBe(path.join(l1, ".guild", "indexes", "knowledge-recall-provenance.json"));
    expect(fs.existsSync(path.join(l1, ".guild", "indexes", "publication", "CURRENT"))).toBe(true);
    expect(fs.existsSync(path.join(cacheHome, "roots", guildRootId(l1)))).toBe(false);
  });

  test("the extract-structural CLI on a layout 2 root publishes to the cache and leaves .guild/indexes absent", () => {
    const l2 = mkRoot(2);
    const git = (...a: string[]) => execFileSync("git", ["-C", l2, ...a], { stdio: "ignore" });
    git("init", "-q");
    fs.mkdirSync(path.join(l2, "src"), { recursive: true });
    fs.writeFileSync(path.join(l2, "src", "a.ts"), "export function f() {\n  return 1;\n}\n");
    git("add", "-A");
    git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "seed");
    const cli = path.resolve(__dirname, "..", "extract-structural.ts");
    execFileSync("npx", ["tsx", cli, "--cwd", l2], { stdio: "ignore", timeout: 90000, env: process.env });
    expect(fs.existsSync(path.join(l2, ".guild", "indexes"))).toBe(false);
    expect(fs.existsSync(path.join(knowledgeIndexesDir(l2), "knowledge-graph.json"))).toBe(true);
    expect(fs.existsSync(path.join(knowledgeIndexesDir(l2), "publication", "CURRENT"))).toBe(true);
  });
});

describe("layout 2 derived indexes beyond learn (#283 F4)", () => {
  test("registry rollup --write and the fingerprint salt write nothing under .guild/indexes", () => {
    const l2 = mkRoot(2);
    const reg = writeInitiativesRegistry(path.join(l2, ".guild"), { schema_version: "x", built_from: [], initiatives: [] } as never);
    expect(reg.startsWith(cacheHome)).toBe(true);
    loadOrCreateFingerprintSalt(l2);
    expect(fs.existsSync(path.join(l2, ".guild", "indexes"))).toBe(false);
  });

  test("a legacy registry and salt stay readable on layout 2; layout 1 still writes .guild/indexes", () => {
    const l2 = mkRoot(2);
    const legacy = path.join(l2, ".guild", "indexes");
    fs.mkdirSync(path.join(legacy, "model-catalog"), { recursive: true });
    fs.writeFileSync(path.join(legacy, "model-catalog", ".fp-salt"), "oldsalt\n");
    expect(loadOrCreateFingerprintSalt(l2)).toBe("oldsalt");
    const l1 = mkRoot(1);
    expect(writeInitiativesRegistry(path.join(l1, ".guild"), { schema_version: "x", built_from: [], initiatives: [] } as never)).toBe(
      path.join(l1, ".guild", "indexes", "initiatives-registry.yaml"),
    );
  });
});
