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

import { guildRootId, knowledgeIndexReadPath, knowledgeIndexesDir } from "../../../src/domains/state";
import { ensureStorageLayout } from "../../lib/state/ensure-storage-layout";
import { assertNotLegacyIndexTarget, guildPaths } from "./paths";
import { readLearnBase, runGraphStage } from "./publish";
import { writeKnowledgeLinks } from "../write-knowledge-links";
import { detect } from "../../dot-guild/convert/detect";
import { realFs } from "../../dot-guild/convert/seams";
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
  const snapshot = (d: string): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const n of fs.readdirSync(d, { recursive: true }) as string[]) {
      const f = path.join(d, n);
      if (fs.statSync(f).isFile()) out[n] = fs.readFileSync(f, "utf8");
    }
    return out;
  };

  test("a full learn on a legacy-populated layout 2 root publishes into the cache and leaves legacy bytes unchanged", () => {
    const r = legacyPopulatedLayout2();
    const legacy = path.join(r, ".guild", "indexes");
    const before = snapshot(legacy);
    const gp = guildPaths(r);
    // the cache is empty: the base is fresh, so the first publish succeeds
    expect(readLearnBase({ indexesDir: gp.indexesDir, repoRoot: gp.repoRoot, sourceRoot: gp.sourceRoot }).pinned).toBeNull();
    writeKnowledgeLinks({ graph, repoRoot: r });
    expect(fs.existsSync(path.join(gp.indexesDir, "publication", "CURRENT"))).toBe(true);
    expect(snapshot(legacy)).toEqual(before);
  });

  test("a partial stage on a layout 2 root with an empty cache refuses instead of reading legacy or publishing", () => {
    const r = legacyPopulatedLayout2();
    const gp = guildPaths(r);
    expect(() =>
      runGraphStage(gp, { target: null, who: "layers", channels: ["structural_graph"], transform: (g: object) => g }),
    ).toThrow(/full learn pipeline/);
    expect(fs.existsSync(gp.indexesDir)).toBe(false);
  });

  test("readers use the legacy tree until the cache has a publication or graph, then the cache; never a mix", () => {
    const r = mkRoot(2);
    const legacy = path.join(r, ".guild", "indexes");
    fs.mkdirSync(legacy, { recursive: true });
    fs.writeFileSync(path.join(legacy, "knowledge-graph.json"), "{}\n");
    fs.writeFileSync(path.join(legacy, "knowledge-links.json"), "{}\n");
    expect(knowledgeIndexReadPath(r, "knowledge-links.json")).toBe(path.join(legacy, "knowledge-links.json"));
    // cache gets a graph: the cache tree wins whole, even for files only legacy has
    const dest = knowledgeIndexesDir(r);
    fs.mkdirSync(dest, { recursive: true });
    fs.writeFileSync(path.join(dest, "knowledge-graph.json"), "{}\n");
    expect(knowledgeIndexReadPath(r, "knowledge-graph.json")).toBe(path.join(dest, "knowledge-graph.json"));
    expect(knowledgeIndexReadPath(r, "knowledge-links.json")).toBe(path.join(dest, "knowledge-links.json"));
    expect(fs.existsSync(path.join(dest, "knowledge-links.json"))).toBe(false);
  });

  test("staleness on a legacy tree reports freshness unverified, never current_for_basis", () => {
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
    run("staleness.ts", "--baseline");
    fs.writeFileSync(path.join(r, ".guild", "storage-layout.json"), JSON.stringify({ storage_layout_version: 2 }) + "\n");
    const out = JSON.parse(run("staleness.ts", "--print")) as { state: string; freshness: string; publication?: { channels?: unknown; error?: string } };
    expect(out.state).toBe("FULL");
    expect(out.freshness).toBe("unknown");
    expect(out.publication?.error).toBeDefined();
    expect(JSON.stringify(out)).not.toContain("current_for_basis");
  });

  /** A committed one-file TS repo; `cli` runs a learn script against it. */
  function gitRepo(layout: 1 | 2): { r: string; cli: (script: string, ...a: string[]) => string } {
    const r = mkRoot(layout);
    const git = (...a: string[]) => execFileSync("git", ["-C", r, ...a], { stdio: "ignore" });
    git("init", "-q");
    fs.mkdirSync(path.join(r, "src"), { recursive: true });
    fs.writeFileSync(path.join(r, "src", "a.ts"), "export function f() {\n  return 1;\n}\n");
    git("add", "-A");
    git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "seed");
    const cli = (script: string, ...a: string[]) =>
      execFileSync("npx", ["tsx", path.resolve(__dirname, "..", script), "--cwd", r, ...a], { encoding: "utf8", timeout: 90000, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    return { r, cli };
  }
  const stampLayout2 = (r: string) =>
    fs.writeFileSync(path.join(r, ".guild", "storage-layout.json"), JSON.stringify({ storage_layout_version: 2 }) + "\n");

  test("round 4 F1: validate on layout 2 guards against the cache destination only, so a legacy v2 graph does not block it", () => {
    const { r, cli } = gitRepo(1);
    cli("extract-structural.ts");
    const v1 = fs.readFileSync(path.join(r, ".guild", "indexes", "knowledge-graph.json"), "utf8");
    fs.rmSync(path.join(r, ".guild", "indexes"), { recursive: true });
    fs.mkdirSync(path.join(r, ".guild", "indexes"), { recursive: true });
    const legacyGraph = JSON.stringify({ version: "guild.knowledge_graph.v2", nodes: [], edges: [], layers: [], tour: [] });
    fs.writeFileSync(path.join(r, ".guild", "indexes", "knowledge-graph.json"), legacyGraph);
    stampLayout2(r);
    fs.mkdirSync(knowledgeIndexesDir(r), { recursive: true });
    fs.writeFileSync(path.join(knowledgeIndexesDir(r), "understand-partial-graph.json"), v1);
    cli("validate-graph.ts");
    expect(fs.existsSync(path.join(knowledgeIndexesDir(r), "publication", "CURRENT"))).toBe(true);
    expect(fs.readFileSync(path.join(r, ".guild", "indexes", "knowledge-graph.json"), "utf8")).toBe(legacyGraph);
  });

  test("round 4 F2: an explicit --in/--out inside the legacy .guild/indexes is refused on layout 2; other paths still work", () => {
    const { r, cli } = gitRepo(1);
    cli("extract-structural.ts");
    const legacyGraph = path.join(r, ".guild", "indexes", "knowledge-graph.json");
    const before = fs.readFileSync(legacyGraph, "utf8");
    stampLayout2(r);
    const fail = (script: string, ...a: string[]): string => {
      try {
        cli(script, ...a);
      } catch (e) {
        return String((e as { stderr?: string }).stderr ?? e);
      }
      return "";
    };
    expect(fail("assign-layers.ts", "--in", legacyGraph)).toContain(knowledgeIndexesDir(r));
    expect(fail("extract-structural.ts", "--out", legacyGraph)).toContain(knowledgeIndexesDir(r));
    expect(fail("validate-graph.ts", "--in", legacyGraph)).toContain(knowledgeIndexesDir(r));
    expect(fs.readFileSync(legacyGraph, "utf8")).toBe(before);
    // an explicit path elsewhere in the repo keeps working
    cli("extract-structural.ts", "--out", path.join(r, "out", "graph.json"));
    expect(fs.existsSync(path.join(r, "out", "graph.json"))).toBe(true);
  });

  test("round 4 F3: scan on layout 2 writes the cache map even when the legacy map equals the fresh scan", () => {
    const { r, cli } = gitRepo(1);
    cli("scan.ts");
    expect(fs.existsSync(path.join(r, ".guild", "indexes", "codebase-map.json"))).toBe(true);
    stampLayout2(r);
    cli("scan.ts");
    expect(fs.existsSync(path.join(knowledgeIndexesDir(r), "codebase-map.json"))).toBe(true);
  });

  test("round 4 F4: a legacy tree holding only links/map/fingerprint is still the read tree while the cache is empty", () => {
    for (const name of ["knowledge-links.json", "codebase-map.json", "understand-fingerprint.json", "kstage-fingerprint.json"]) {
      const r = mkRoot(2);
      const legacy = path.join(r, ".guild", "indexes");
      fs.mkdirSync(legacy, { recursive: true });
      fs.writeFileSync(path.join(legacy, name), "{}\n");
      expect(knowledgeIndexReadPath(r, name)).toBe(path.join(legacy, name));
      fs.mkdirSync(knowledgeIndexesDir(r), { recursive: true });
      fs.writeFileSync(path.join(knowledgeIndexesDir(r), "codebase-map.json"), "{}\n");
      expect(knowledgeIndexReadPath(r, name)).toBe(path.join(knowledgeIndexesDir(r), name));
    }
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

describe("convert detect on layout 2 (#283)", () => {
  const legacyDir = (r: string) => path.join(r, ".guild", "indexes");
  test("F4: detect prefers a valid cache registry over an obsolete malformed legacy one", () => {
    const r = mkRoot(2);
    fs.mkdirSync(legacyDir(r), { recursive: true });
    fs.writeFileSync(path.join(legacyDir(r), "initiatives-registry.yaml"), "{ this is: [not valid yaml\n");
    fs.writeFileSync(path.join(r, ".guild", "guild.yaml"), "schema_version: guild.config.v2\n");
    fs.mkdirSync(knowledgeIndexesDir(r), { recursive: true });
    fs.writeFileSync(path.join(knowledgeIndexesDir(r), "initiatives-registry.yaml"), "schema_version: guild.initiatives_registry.v2\ninitiatives: []\n");
    const res = detect(realFs, path.join(r, ".guild"));
    expect(res.hasUnparseable).toBe(false);
    expect(res.unparseable.some((u: { path?: string } | string) => JSON.stringify(u).includes("initiatives-registry"))).toBe(false);
  });
});

test("the legacy-target guard treats '..' as a whole path segment (codex r5)", () => {
  const root = mkRoot(2);
  const legacy = path.join(root, ".guild", "indexes");
  fs.mkdirSync(path.join(legacy, "..backup"), { recursive: true });
  // A descendant whose name merely starts with ".." is still inside the legacy tree.
  expect(() =>
    assertNotLegacyIndexTarget(root, path.join(legacy, "..backup", "graph.json"), "t"),
  ).toThrow(/read-only on a layout 2 root/);
  // A real sibling outside it is allowed.
  expect(() => assertNotLegacyIndexTarget(root, path.join(root, "out", "graph.json"), "t")).not.toThrow();
});
