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

import { knowledgeIndexReadPath, knowledgeIndexesDir, knowledgeIndexesReadDir } from "../../../src/domains/state";
import { ensureStorageLayout } from "../../lib/state/ensure-storage-layout";
import { guildPaths } from "./paths";
import { readLearnBase } from "./publish";
import { writeKnowledgeLinks } from "../write-knowledge-links";

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

  test("a legacy .guild/indexes stays readable on layout 2 and is never written", () => {
    const l2 = mkRoot(2);
    const legacy = path.join(l2, ".guild", "indexes");
    fs.mkdirSync(legacy, { recursive: true });
    fs.writeFileSync(path.join(legacy, "knowledge-graph.json"), "{}\n");
    expect(knowledgeIndexReadPath(l2, "knowledge-graph.json")).toBe(path.join(legacy, "knowledge-graph.json"));
    const gp = guildPaths(l2);
    expect(gp.readPath(gp.knowledgeGraph)).toBe(path.join(legacy, "knowledge-graph.json"));
    // seed copies it forward; the legacy file is untouched
    gp.seed(gp.knowledgeGraph);
    expect(fs.readFileSync(gp.knowledgeGraph, "utf8")).toBe("{}\n");
    expect(gp.readPath(gp.knowledgeGraph)).toBe(gp.knowledgeGraph);
    // a publication writes to the cache; legacy gains no new entry
    const before = fs.readdirSync(legacy).sort();
    writeKnowledgeLinks({ graph, repoRoot: l2 });
    expect(fs.readdirSync(legacy).sort()).toEqual(before);
    expect(knowledgeIndexesReadDir(l2)).toBe(knowledgeIndexesDir(l2));
  });

  test("the publication base is read from a legacy store until a cache store exists", () => {
    const l2 = mkRoot(2);
    const legacy = path.join(l2, ".guild", "indexes");
    fs.mkdirSync(legacy, { recursive: true });
    fs.writeFileSync(path.join(legacy, "knowledge-graph.json"), JSON.stringify({ nodes: [], edges: [], version: "x" }));
    const gp = guildPaths(l2);
    const base = readLearnBase({ indexesDir: gp.indexesDir, repoRoot: gp.repoRoot, sourceRoot: gp.sourceRoot });
    expect(base.graph).not.toBeNull();
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
