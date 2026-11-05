/**
 * K01 — scanned worktree vs publication owner (AT31, AT32).
 *
 * AT31: a lane worktree (.git indirection, packed refs, shared canonical owner)
 * is scanned from ITS bytes; the basis names the lane, the owner resolves to MAIN
 * independently, and a lane publication cannot claim MAIN freshness.
 * AT32: the source basis moves exactly with the declared scan policy across
 * tracked/staged/unstaged/untracked/ignored/rename/delete/branch/rebase edits.
 */
import { publishLearnArtifacts } from "./publish";
import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { execFileSync, spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { guildPaths, resolveMainRepoRoot, computeLearnSourceBasis } from "./paths";
import {
  basisDigest,
  canonicalJson,
  computeSourceBasis,
  freshnessFor,
  readWorktreeHead,
  sourceWorktreeId,
} from "../../../src/domains/knowledge/source-basis";
import { computeFingerprint } from "../../../src/domains/knowledge/working-set";
import { buildImportMap, loadTsAliases } from "./import-map";
import { resolveTsCalls } from "./resolve-calls-ts";
import { loadTsconfigChain, parseJsonc } from "./tsconfig-chain";

let tmp: string;
const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "-c", "commit.gpgsign=false", ...args], {
    cwd,
    encoding: "utf8",
  }).trim();
const write = (root: string, rel: string, body: string) => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), body);
};
const real = (p: string) => fs.realpathSync(p);
const tsx = (script: string, ...args: string[]) =>
  spawnSync("npx", ["tsx", path.resolve(__dirname, "..", script), ...args], { encoding: "utf8", timeout: 60000 });

function seedMain(): string {
  const main = path.join(tmp, "main");
  fs.mkdirSync(main);
  git(main, "init", "-q", "-b", "main");
  write(main, "src/a.ts", "export const a = 'MAIN';\n");
  write(main, "src/b.ts", "export const b = 1;\n");
  write(main, ".guildignore", "ignored/\n");
  git(main, "add", "-A");
  git(main, "commit", "-qm", "seed");
  return main;
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "k01-basis-"));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("C13 canonical basis digest", () => {
  test("RFC 8785 digest matches the frozen A02 knowledge-publication example", () => {
    // contracts/guild-stack/v2/fixtures/examples.json → knowledge-publication.basis
    const H = "sha256:" + "a".repeat(64);
    const basis = {
      commit: "abc",
      tree: H,
      dirty_blob_manifest: H,
      file_inventory: H,
      resolver_policy: H,
      scan_policy: H,
      source_worktree_id: "lane-a",
    };
    expect(basisDigest(basis)).toBe("sha256:a4f6e1546e8312a9107c6e79a5d6d929b9cd47a808e35f5d67cb1e520230fb9b");
    expect(canonicalJson({ b: [1, null, "x"], a: { d: true, c: "é" } })).toBe('{"a":{"c":"é","d":true},"b":[1,null,"x"]}');
  });
});

describe("AT31 · worktree identity", () => {
  test("lane bytes are scanned; owner is MAIN; lane publication cannot claim MAIN freshness", () => {
    const main = seedMain();
    const lane = path.join(tmp, "lane");
    git(main, "worktree", "add", "-q", "-b", "lane", lane);
    write(lane, "src/a.ts", "export const a = 'LANE';\n");
    write(lane, "src/lane-only.ts", "export const l = 2;\n");
    git(lane, "add", "-A");
    git(lane, "commit", "-qm", "lane change");
    git(main, "pack-refs", "--all");
    expect(fs.statSync(path.join(lane, ".git")).isFile()).toBe(true); // .git indirection
    expect(fs.existsSync(path.join(main, ".git", "refs", "heads", "lane"))).toBe(false); // packed

    const gp = guildPaths(lane);
    expect(gp.sourceRoot).toBe(real(lane));
    expect(real(gp.repoRoot)).toBe(real(main)); // canonical owner resolved independently
    expect(gp.guildDir).toBe(path.join(gp.repoRoot, ".guild"));

    const laneBasis = computeLearnSourceBasis(lane);
    const mainBasis = computeLearnSourceBasis(main);
    expect(laneBasis.source_root).toBe(real(lane));
    expect(laneBasis.basis.source_worktree_id).toBe(sourceWorktreeId(lane));
    expect(laneBasis.basis.source_worktree_id).not.toBe(mainBasis.basis.source_worktree_id);
    expect(laneBasis.basis.commit).toBe(git(lane, "rev-parse", "HEAD"));
    expect(laneBasis.inventory.map((e) => e.path)).toContain("src/lane-only.ts");
    expect(mainBasis.inventory.map((e) => e.path)).not.toContain("src/lane-only.ts");
    const aLane = laneBasis.inventory.find((e) => e.path === "src/a.ts")!;
    const aMain = mainBasis.inventory.find((e) => e.path === "src/a.ts")!;
    expect(aLane.sha256).not.toBe(aMain.sha256);

    // Freshness: a lane-built layer is never current for MAIN, even if a caller
    // compares only hashes; same worktree + same basis is current.
    expect(freshnessFor(laneBasis, mainBasis)).toBe("unknown");
    expect(freshnessFor(laneBasis, computeLearnSourceBasis(lane))).toBe("current_for_basis");

    // Working-set HEAD read follows .git indirection + packed refs to the LANE commit.
    expect(readWorktreeHead(lane)).toBe(git(lane, "rev-parse", "HEAD"));
    expect(computeFingerprint({ cwd: lane }).git_head).toBe(git(lane, "rev-parse", "HEAD"));
  });

  test("negative control: resolving the scan root from git-common-dir returns MAIN bytes", () => {
    const main = seedMain();
    const lane = path.join(tmp, "lane");
    git(main, "worktree", "add", "-q", "-b", "lane", lane);
    write(lane, "src/a.ts", "export const a = 'LANE';\n");
    const wrongRoot = resolveMainRepoRoot(lane);
    expect(real(wrongRoot)).toBe(real(main));
    const wrong = computeLearnSourceBasis(wrongRoot);
    const right = computeLearnSourceBasis(lane);
    expect(wrong.basis.source_worktree_id).not.toBe(right.basis.source_worktree_id);
    expect(basisDigest(wrong.basis)).not.toBe(basisDigest(right.basis));
    expect(freshnessFor(wrong, right)).not.toBe("current_for_basis");
  });

  test("scan CLI run from a lane writes the owner index from lane bytes", () => {
    const main = seedMain();
    const lane = path.join(tmp, "lane");
    git(main, "worktree", "add", "-q", "-b", "lane", lane);
    write(lane, "src/lane-only.ts", "export const l = 2;\n");
    const r = spawnSync("npx", ["tsx", path.resolve(__dirname, "..", "scan.ts"), "--cwd", lane], {
      encoding: "utf8",
      timeout: 60000,
    });
    expect(r.status).toBe(0);
    const map = JSON.parse(fs.readFileSync(path.join(main, ".guild", "indexes", "codebase-map.json"), "utf8"));
    const files = (map.files as { path: string }[]).map((f) => f.path);
    expect(files).toContain("src/lane-only.ts");
    expect(fs.existsSync(path.join(lane, ".guild", "indexes", "codebase-map.json"))).toBe(false);
  }, 90000);
});

describe("AT32 · source mutation matrix", () => {
  test("basis moves exactly under the declared scan policy", () => {
    const main = seedMain();
    const h = () => basisDigest(computeLearnSourceBasis(main).basis);
    const b0 = h();
    expect(h()).toBe(b0); // same bytes + policy → deterministic

    // HEAD-only fingerprint is the negative control: it cannot see a dirty edit.
    const head0 = readWorktreeHead(main);
    write(main, "src/a.ts", "export const a = 'EDIT';\n"); // unstaged tracked edit
    const b1 = h();
    expect(b1).not.toBe(b0);
    expect(readWorktreeHead(main)).toBe(head0);
    const dirty = computeLearnSourceBasis(main).dirty;
    expect(dirty.map((d) => d.path)).toEqual(["src/a.ts"]);

    git(main, "add", "src/a.ts"); // staging the same bytes: scan policy reads worktree bytes
    expect(h()).toBe(b1);

    write(main, "src/new.ts", "export const n = 3;\n"); // untracked
    const b2 = h();
    expect(b2).not.toBe(b1);

    write(main, "ignored/x.ts", "export const x = 1;\n"); // excluded by .guildignore
    expect(h()).toBe(b2);
    expect(computeLearnSourceBasis(main).inventory.map((e) => e.path)).not.toContain("ignored/x.ts");

    write(main, ".guildignore", "ignored/\nsrc/new.ts\n"); // policy change
    const pol = computeLearnSourceBasis(main);
    expect(basisDigest(pol.basis)).not.toBe(b2);
    expect(pol.inventory.map((e) => e.path)).not.toContain("src/new.ts");
    write(main, ".guildignore", "ignored/\n");
    expect(h()).toBe(b2);

    git(main, "mv", "src/b.ts", "src/c.ts"); // rename
    const ren = computeLearnSourceBasis(main);
    expect(ren.inventory.map((e) => e.path)).toContain("src/c.ts");
    expect(ren.inventory.map((e) => e.path)).not.toContain("src/b.ts");
    expect(ren.dirty.find((d) => d.path === "src/b.ts")).toEqual({ path: "src/b.ts", sha256: null });
    git(main, "mv", "src/c.ts", "src/b.ts");
    expect(h()).toBe(b2);

    fs.rmSync(path.join(main, "src/b.ts")); // delete removes it from the inventory
    const del = computeLearnSourceBasis(main);
    expect(del.inventory.map((e) => e.path)).not.toContain("src/b.ts");
    expect(basisDigest(del.basis)).not.toBe(b2);
    git(main, "checkout", "--", "src/b.ts");
    expect(h()).toBe(b2);
  });

  test("branch, rebase and same-commit branch switch", () => {
    const main = seedMain();
    const h = () => basisDigest(computeLearnSourceBasis(main).basis);
    const b0 = h();
    git(main, "checkout", "-q", "-b", "alias"); // same commit, same bytes
    expect(h()).toBe(b0);
    git(main, "checkout", "-q", "-b", "feature");
    write(main, "src/f.ts", "export const f = 1;\n");
    git(main, "add", "-A");
    git(main, "commit", "-qm", "feature");
    const bf = h();
    expect(bf).not.toBe(b0);
    git(main, "checkout", "-q", "main");
    expect(h()).toBe(b0);
    write(main, "src/m.ts", "export const m = 1;\n");
    git(main, "add", "-A");
    git(main, "commit", "-qm", "main moves");
    git(main, "checkout", "-q", "feature");
    git(main, "rebase", "-q", "main"); // pull/rebase: new commit, new bytes
    const br = h();
    expect(br).not.toBe(bf);
    expect(computeLearnSourceBasis(main).basis.commit).toBe(git(main, "rev-parse", "HEAD"));
  });

  test("symlinks are not followed out of the source root", () => {
    const main = seedMain();
    const outside = path.join(tmp, "outside.ts");
    fs.writeFileSync(outside, "export const o = 1;\n");
    fs.symlinkSync(outside, path.join(main, "src/link.ts"));
    const b0 = basisDigest(computeLearnSourceBasis(main).basis);
    expect(computeLearnSourceBasis(main).inventory.map((e) => e.path)).not.toContain("src/link.ts");
    fs.writeFileSync(outside, "export const o = 2;\n");
    expect(basisDigest(computeLearnSourceBasis(main).basis)).toBe(b0);
  });

  test("non-git root still yields a deterministic bytes basis", () => {
    const plain = path.join(tmp, "plain");
    write(plain, "a.ts", "export const a = 1;\n");
    const r = computeLearnSourceBasis(plain);
    expect(r.basis.commit).toBeNull();
    expect(basisDigest(computeLearnSourceBasis(plain).basis)).toBe(basisDigest(r.basis));
    write(plain, "a.ts", "export const a = 2;\n");
    expect(basisDigest(computeLearnSourceBasis(plain).basis)).not.toBe(basisDigest(r.basis));
  });
});

describe("K01 review r1 regressions", () => {
  test("F3: traversal and symlinked-directory paths are never read", () => {
    const main = seedMain();
    fs.writeFileSync(path.join(tmp, "outside.ts"), "export const o = 1;\n");
    fs.mkdirSync(path.join(tmp, "outdir"));
    fs.writeFileSync(path.join(tmp, "outdir", "f.ts"), "export const f = 1;\n");
    fs.symlinkSync(path.join(tmp, "outdir"), path.join(main, "linkdir"));
    const r = computeSourceBasis({
      sourceRoot: main,
      files: ["../outside.ts", "linkdir/f.ts", "/etc/hosts", "src/a.ts"],
      inScope: () => true,
      scanPolicy: {},
      resolverPolicy: {},
    });
    expect(r.inventory.map((e) => e.path)).toEqual(["src/a.ts"]);
    expect(r.dirty.map((d) => d.path)).not.toContain("linkdir/f.ts");
  });

  test("F4: index-only state does not move the basis (staged edit, bytes restored)", () => {
    const main = seedMain();
    const h = () => basisDigest(computeLearnSourceBasis(main).basis);
    const b0 = h();
    write(main, "src/a.ts", "export const a = 'EDIT';\n");
    git(main, "add", "src/a.ts");
    write(main, "src/a.ts", "export const a = 'MAIN';\n");
    expect(git(main, "status", "--porcelain")).toContain("MM src/a.ts");
    expect(computeLearnSourceBasis(main).dirty).toEqual([]);
    expect(h()).toBe(b0);
  });

  test("F5: resolver config read outside the inventory is bound into the basis", () => {
    const main = seedMain();
    write(main, ".guildignore", "ignored/\ntsconfig.json\n");
    write(main, "tsconfig.json", '{"compilerOptions":{"paths":{"@a/*":["src/*"]}}}');
    const r0 = computeLearnSourceBasis(main);
    expect(r0.inventory.map((e) => e.path)).not.toContain("tsconfig.json");
    write(main, "tsconfig.json", '{"compilerOptions":{"paths":{"@a/*":["lib/*"]}}}');
    const r1 = computeLearnSourceBasis(main);
    expect(r1.basis.resolver_policy).not.toBe(r0.basis.resolver_policy);
    expect(basisDigest(r1.basis)).not.toBe(basisDigest(r0.basis));
  });

  test("F1: lane analysis ignores a MAIN-rooted owner map and drops deleted/symlinked paths", () => {
    const main = seedMain();
    expect(tsx("scan.ts", "--cwd", main).status).toBe(0); // owner map rooted at MAIN
    const lane = path.join(tmp, "lane");
    git(main, "worktree", "add", "-q", "-b", "lane", lane);
    write(lane, "src/lane-only.ts", "export const l = 2;\n");
    fs.rmSync(path.join(lane, "src/b.ts"));
    const r = tsx("analyze-structural.ts", "--cwd", lane);
    expect(r.status).toBe(0);
    const partial = JSON.parse(fs.readFileSync(path.join(main, ".guild", "indexes", "understand-partial-graph.json"), "utf8"));
    const files = JSON.stringify(partial.nodes);
    expect(files).toContain("src/lane-only.ts");
    expect(files).not.toContain("src/b.ts");
  }, 120000);

  test("F2: a LANE staleness baseline is not fresh for MAIN", () => {
    const main = seedMain();
    const lane = path.join(tmp, "lane");
    git(main, "worktree", "add", "-q", "--detach", lane, "HEAD"); // same commit, same bytes
    expect(tsx("staleness.ts", "--cwd", lane, "--baseline").status).toBe(0);
    const sameLane = JSON.parse(tsx("staleness.ts", "--cwd", lane, "--print").stdout);
    expect(sameLane.freshness).toBe("current_for_basis");
    const fromMain = JSON.parse(tsx("staleness.ts", "--cwd", main, "--print").stdout);
    expect(fromMain.freshness).toBe("unknown");
    expect(fromMain.stale).toBe(true);
    expect(fromMain.state).toBe("FULL");
  }, 120000);
});

describe("K01 review r2 regressions", () => {
  test("R2-F1: files added after a same-worktree scan are analyzed", () => {
    const main = seedMain();
    expect(tsx("scan.ts", "--cwd", main).status).toBe(0);
    write(main, "src/late.ts", "export const late = 1;\n");
    expect(tsx("analyze-structural.ts", "--cwd", main).status).toBe(0);
    const partial = fs.readFileSync(path.join(main, ".guild", "indexes", "understand-partial-graph.json"), "utf8");
    expect(partial).toContain("src/late.ts");
  }, 120000);

  test("R2-F2: a baseline without source identity is never fresh", () => {
    const main = seedMain();
    expect(tsx("staleness.ts", "--cwd", main, "--baseline").status).toBe(0);
    const fp = path.join(main, ".guild", "indexes", "understand-fingerprint.json");
    const store = JSON.parse(fs.readFileSync(fp, "utf8"));
    delete store.source_basis;
    fs.writeFileSync(fp, JSON.stringify(store));
    const out = JSON.parse(tsx("staleness.ts", "--cwd", main, "--print").stdout);
    expect(out.freshness).toBe("unknown");
    expect(out.state).toBe("FULL");
    expect(out.stale).toBe(true);
  }, 120000);

  test("R2-F3: force-staging a git-ignored scanned file does not move the basis", () => {
    const main = seedMain();
    write(main, ".gitignore", "gen/\n");
    git(main, "add", ".gitignore");
    git(main, "commit", "-qm", "ignore gen");
    write(main, "gen/g.ts", "export const g = 1;\n");
    const r0 = computeLearnSourceBasis(main);
    expect(r0.inventory.map((e) => e.path)).toContain("gen/g.ts");
    git(main, "add", "-f", "gen/g.ts");
    const r1 = computeLearnSourceBasis(main);
    expect(r1.inventory).toEqual(r0.inventory);
    expect(basisDigest(r1.basis)).toBe(basisDigest(r0.basis));
  });

  test("R2-F4: a symlinked root tsconfig is never read", () => {
    const main = seedMain();
    write(main, "src/a.ts", "export function f() { return 1; }\n");
    write(main, "src/use.ts", "import { f } from '@x/a';\nexport function g() { return f(); }\n");
    const outside = path.join(tmp, "outside-tsconfig.json");
    fs.writeFileSync(outside, '{"compilerOptions":{"baseUrl":".","paths":{"@x/*":["src/*"]}}}');
    fs.symlinkSync(outside, path.join(main, "tsconfig.json"));
    expect(loadTsAliases(main)).toEqual([]);
    expect(JSON.stringify(resolveTsCalls(main, ["src/a.ts", "src/use.ts"]))).not.toContain("src/a.ts:f");
  });

  test("R2-F5: resolve-calls in the owner worktree keeps foreign enrichment", () => {
    const main = seedMain();
    expect(tsx("extract-structural.ts", "--cwd", main).status).toBe(0);
    const kg = path.join(main, ".guild", "indexes", "knowledge-graph.json");
    const g = JSON.parse(fs.readFileSync(kg, "utf8"));
    g.nodes.push({ id: "concept:keep-me", type: "concept", name: "keep-me", source_refs: [], confidence: "high" });
    // K03: enrichment arrives through the publisher; a direct export write is never adopted.
    const planted = publishLearnArtifacts(
      { indexesDir: path.dirname(kg), repoRoot: main, sourceRoot: main },
      { channels: ["semantic_graph"], build: () => ({ "knowledge-graph.json": g }) },
    );
    expect(planted.status).toBe("published");
    expect(tsx("resolve-calls.ts", "--cwd", main).status).toBe(0);
    expect(fs.readFileSync(kg, "utf8")).toContain("concept:keep-me");
  }, 120000);
});

describe("tsconfig extends chain (lead decision on R2-F4)", () => {
  const ALIAS = '{"compilerOptions":{"baseUrl":".","paths":{"@x/*":["src/*"]}}}';
  const seedCalls = (root: string) => {
    write(root, "src/a.ts", "export function f() { return 1; }\n");
    write(root, "src/use.ts", "import { f } from '@x/a';\nexport function g() { return f(); }\n");
  };
  const calls = (root: string) => JSON.stringify(resolveTsCalls(root, ["src/a.ts", "src/use.ts"]));

  test("chain: aliases from an extended config resolve; every hop is bound", () => {
    const main = seedMain();
    seedCalls(main);
    write(main, "configs/base.json", ALIAS.replace('"baseUrl":"."', '"baseUrl":".."'));
    write(main, "configs/mid.json", '{"extends":"./base"}');
    write(main, "tsconfig.json", '{ // jsonc\n "extends": "./configs/mid.json", }');
    const chain = loadTsconfigChain(main);
    expect(chain.hops.map((h) => h.path)).toEqual(["tsconfig.json", "configs/mid.json", "configs/base.json"]);
    expect(chain.unresolved).toEqual([]);
    expect(loadTsAliases(main)).toEqual([{ prefix: "@x/*", targets: ["src/*"] }]);
    expect(calls(main)).toContain("src/a.ts:f");
    const r0 = computeLearnSourceBasis(main);
    write(main, "configs/base.json", ALIAS.replace('"src/*"', '"lib/*"').replace('"baseUrl":"."', '"baseUrl":".."'));
    const r1 = computeLearnSourceBasis(main);
    expect(r1.basis.resolver_policy).not.toBe(r0.basis.resolver_policy);
    expect(freshnessFor(r0, computeLearnSourceBasis(main))).toBe("stale");
  });

  test("diamond: a shared base is bound once and is not a cycle", () => {
    const main = seedMain();
    write(main, "base.json", ALIAS);
    write(main, "a.json", '{"extends":"./base.json"}');
    write(main, "b.json", '{"extends":"./base.json"}');
    write(main, "tsconfig.json", '{"extends":["./a.json","./b.json"]}');
    const chain = loadTsconfigChain(main);
    expect(chain.unresolved).toEqual([]);
    expect(chain.hops.map((h) => h.path).sort()).toEqual(["a.json", "b.json", "base.json", "tsconfig.json"]);
  });

  test("cycle: detected, never looped, freshness unknown", () => {
    const main = seedMain();
    write(main, "a.json", '{"extends":"./b.json"}');
    write(main, "b.json", '{"extends":"./a.json"}');
    write(main, "tsconfig.json", '{"extends":"./a.json"}');
    const chain = loadTsconfigChain(main);
    expect(chain.unresolved).toEqual(["b.json -> ./a.json: cycle"]);
    const r = computeLearnSourceBasis(main);
    expect(r.resolver_unresolved).toEqual(["b.json -> ./a.json: cycle"]);
    expect(freshnessFor(r, computeLearnSourceBasis(main))).toBe("unknown");
  });

  test("depth bound: more than 8 extends hops is unresolved", () => {
    const main = seedMain();
    for (let i = 0; i < 10; i++) write(main, `c${i}.json`, `{"extends":"./c${i + 1}.json"}`);
    write(main, "c10.json", ALIAS);
    write(main, "tsconfig.json", '{"extends":"./c0.json"}');
    const chain = loadTsconfigChain(main);
    expect(chain.hops).toHaveLength(9);
    expect(chain.unresolved).toEqual(["c7.json -> ./c8.json: depth>8"]);
  });

  test("out-of-worktree extends is refused and unresolved", () => {
    const main = seedMain();
    seedCalls(main);
    fs.writeFileSync(path.join(tmp, "outside.json"), ALIAS);
    write(main, "tsconfig.json", '{"extends":"../outside.json"}');
    const chain = loadTsconfigChain(main);
    expect(chain.hops.map((h) => h.path)).toEqual(["tsconfig.json"]);
    expect(chain.unresolved).toEqual(["tsconfig.json -> ../outside.json: outside worktree"]);
    expect(loadTsAliases(main)).toEqual([]);
    expect(calls(main)).not.toContain("src/a.ts:f");
    const r = computeLearnSourceBasis(main);
    expect(freshnessFor(r, computeLearnSourceBasis(main))).toBe("unknown");
  });

  test("symlinked hop is refused even when its target is inside the worktree", () => {
    const main = seedMain();
    seedCalls(main);
    write(main, "real-base.json", ALIAS);
    fs.symlinkSync(path.join(main, "real-base.json"), path.join(main, "base.json"));
    write(main, "tsconfig.json", '{"extends":"./base.json"}');
    const chain = loadTsconfigChain(main);
    expect(chain.unresolved).toEqual(["tsconfig.json -> ./base.json: not a contained regular file"]);
    expect(calls(main)).not.toContain("src/a.ts:f");
  });

  test("package extends: node_modules inside the worktree is bound; missing or symlinked is unresolved", () => {
    const main = seedMain();
    seedCalls(main);
    write(main, "node_modules/@tsconfig/node22/tsconfig.json", '{"compilerOptions":{"strict":true}}');
    write(main, "tsconfig.json", '{"extends":["@tsconfig/node22/tsconfig.json","./local.json"]}');
    write(main, "local.json", ALIAS);
    const ok = loadTsconfigChain(main);
    expect(ok.hops.map((h) => h.path)).toEqual(["tsconfig.json", "node_modules/@tsconfig/node22/tsconfig.json", "local.json"]);
    expect(ok.unresolved).toEqual([]);
    expect(calls(main)).toContain("src/a.ts:f");

    write(main, "tsconfig.json", '{"extends":"@tsconfig/missing"}');
    expect(loadTsconfigChain(main).unresolved).toEqual(["tsconfig.json -> @tsconfig/missing: not a contained regular file"]);
    expect(freshnessFor(computeLearnSourceBasis(main), computeLearnSourceBasis(main))).toBe("unknown");

    fs.mkdirSync(path.join(tmp, "store/pkg"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "store/pkg/tsconfig.json"), ALIAS);
    fs.symlinkSync(path.join(tmp, "store/pkg"), path.join(main, "node_modules/linked"));
    write(main, "tsconfig.json", '{"extends":"linked/tsconfig.json"}');
    expect(loadTsconfigChain(main).unresolved).toEqual(["tsconfig.json -> linked/tsconfig.json: not a contained regular file"]);
  });
});

describe("K01 review r3 regressions", () => {
  test("R3-F1: MAIN resolve-calls after a LANE run carries no LANE structure", () => {
    const main = seedMain();
    const lane = path.join(tmp, "lane");
    git(main, "worktree", "add", "-q", "-b", "lane", lane);
    write(lane, "src/lane-only.ts", "export function l() { return 2; }\n");
    expect(tsx("resolve-calls.ts", "--cwd", lane).status).toBe(0);
    const kg = path.join(main, ".guild", "indexes", "knowledge-graph.json");
    expect(fs.readFileSync(kg, "utf8")).toContain("src/lane-only.ts");
    expect(tsx("resolve-calls.ts", "--cwd", main).status).toBe(0);
    expect(fs.readFileSync(kg, "utf8")).not.toContain("src/lane-only.ts");
  }, 120000);

  test("R3-F2: the compiler never reads files outside the scanned inventory", () => {
    const main = seedMain();
    write(main, "src/a.ts", "export function f() { return 1; }\n");
    write(main, "src/b.ts", "export function f() { return 2; }\n");
    write(main, "src/use.ts", "import { f } from './barrel';\nexport function g() { return f(); }\n");
    write(main, "src/barrel.ts", "export { f } from './a';\n"); // NOT in the inventory below
    const files = ["src/a.ts", "src/b.ts", "src/use.ts"];
    const r0 = JSON.stringify(resolveTsCalls(main, files));
    write(main, "src/barrel.ts", "export { f } from './b';\n");
    const r1 = JSON.stringify(resolveTsCalls(main, files));
    expect(r1).toBe(r0);
    expect(r0).not.toContain("src/a.ts:f");
    expect(r0).not.toContain("src/b.ts:f");
  });
});

describe("K01 review r4 regressions", () => {
  test("R4-F1: an excluded file never shadows an inventoried import target", () => {
    const main = seedMain();
    write(main, "src/use.ts", "import { a } from './a';\nexport const u = a;\n");
    const before = buildImportMap(main, ["src/a.ts", "src/use.ts"]);
    expect(before).toEqual([{ from: "src/use.ts", to: "src/a.ts", kind: "static" }]);
    write(main, "src/a", "not inventoried\n");
    expect(buildImportMap(main, ["src/a.ts", "src/use.ts"])).toEqual(before);
  });

  test("R4-F2: k-stage staleness reads LANE bytes and refuses a MAIN baseline", () => {
    const main = seedMain();
    write(main, "README.md", "# main\n");
    git(main, "add", "-A");
    git(main, "commit", "-qm", "readme");
    expect(tsx("k-stage-staleness.ts", "--cwd", main, "--baseline").status).toBe(0);
    const lane = path.join(tmp, "lane");
    git(main, "worktree", "add", "-q", "-b", "lane", lane);
    const fromLane = JSON.parse(tsx("k-stage-staleness.ts", "--cwd", lane, "--json").stdout);
    expect(fromLane.structuralSkip).toBe(false);
    expect(fromLane.k1).toBe(true);
    expect(tsx("k-stage-staleness.ts", "--cwd", lane, "--baseline").status).toBe(0);
    expect(JSON.parse(tsx("k-stage-staleness.ts", "--cwd", lane, "--json").stdout).k1).toBe(false);
    write(lane, "README.md", "# lane edit\n");
    expect(JSON.parse(tsx("k-stage-staleness.ts", "--cwd", lane, "--json").stdout).k1).toBe(true);
  }, 180000);

  test("R4-F3: a symlinked .guildignore is refused, not followed", () => {
    const main = seedMain();
    fs.rmSync(path.join(main, ".guildignore"));
    const outside = path.join(tmp, "outside-ignore");
    fs.writeFileSync(outside, "src/b.ts\n");
    fs.symlinkSync(outside, path.join(main, ".guildignore"));
    const r = computeLearnSourceBasis(main);
    expect(r.inventory.map((e) => e.path)).toContain("src/b.ts");
    expect(r.resolver_unresolved).toContain(".guildignore: not a contained regular file");
    expect(freshnessFor(r, computeLearnSourceBasis(main))).toBe("unknown");
  });

  test("R4-F4: a symlinked or malformed root tsconfig is unresolved, an absent one is not", () => {
    const main = seedMain();
    const absent = loadTsconfigChain(main);
    expect([absent.hops, absent.unresolved]).toEqual([[], []]);
    write(main, "tsconfig.json", "{ not json");
    expect(loadTsconfigChain(main).unresolved).toEqual(["tsconfig.json: unparseable"]);
    fs.rmSync(path.join(main, "tsconfig.json"));
    fs.writeFileSync(path.join(tmp, "t.json"), "{}");
    fs.symlinkSync(path.join(tmp, "t.json"), path.join(main, "tsconfig.json"));
    expect(loadTsconfigChain(main).unresolved).toEqual(["tsconfig.json: not a contained regular file"]);
    expect(freshnessFor(computeLearnSourceBasis(main), computeLearnSourceBasis(main))).toBe("unknown");
  });

  test("R4-F5: package.json#tsconfig wins over the package's tsconfig.json", () => {
    const main = seedMain();
    write(main, "node_modules/cfg/package.json", '{"name":"cfg","tsconfig":"declared.json"}');
    write(main, "node_modules/cfg/declared.json", '{"compilerOptions":{"paths":{"@d/*":["d/*"]}}}');
    write(main, "node_modules/cfg/tsconfig.json", '{"compilerOptions":{"paths":{"@f/*":["f/*"]}}}');
    write(main, "tsconfig.json", '{"extends":"cfg"}');
    expect(loadTsconfigChain(main).hops.map((h) => h.path)).toEqual(["tsconfig.json", "node_modules/cfg/declared.json"]);
  });
});

describe("K01 review r5 regressions", () => {
  test("R5-F1: package metadata consulted during extends resolution is bound", () => {
    const main = seedMain();
    write(main, "node_modules/cfg/package.json", '{"tsconfig":"a.json"}');
    write(main, "node_modules/cfg/a.json", '{"compilerOptions":{"paths":{"@x/*":["a/*"]}}}');
    write(main, "node_modules/cfg/b.json", '{"compilerOptions":{"paths":{"@x/*":["b/*"]}}}');
    write(main, "tsconfig.json", '{"extends":["cfg/a.json","cfg/b.json","cfg"]}');
    const r0 = computeLearnSourceBasis(main);
    write(main, "node_modules/cfg/package.json", '{"tsconfig":"b.json"}');
    const r1 = computeLearnSourceBasis(main);
    expect(r1.basis.resolver_policy).not.toBe(r0.basis.resolver_policy);
    // a candidate that appears ahead of the current hit moves the basis too
    write(main, "node_modules/cfg/x.json", "{}");
    write(main, "tsconfig.json", '{"extends":"cfg/x"}');
    const r2 = computeLearnSourceBasis(main);
    write(main, "node_modules/cfg/x", "{}");
    expect(computeLearnSourceBasis(main).basis.resolver_policy).not.toBe(r2.basis.resolver_policy);
  });

  test("R5-F3: JSONC keeps string contents and accepts a BOM", () => {
    expect(parseJsonc('\uFEFF{"a":"x,}/*","b":["src,]/*",],}')).toEqual({ a: "x,}/*", b: ["src,]/*"] });
    expect(parseJsonc('{"u":"http://x" /* c */, // d\n "v":1,}')).toEqual({ u: "http://x", v: 1 });
  });
});

describe("K02 review r1 regressions (K01 F1/F3 fixes)", () => {
  test("R1-F1: a symlinked or malformed package.json is unresolved, never a silent fallback", () => {
    const main = seedMain();
    write(main, "node_modules/cfg/tsconfig.json", '{"compilerOptions":{"paths":{"@f/*":["f/*"]}}}');
    write(main, "tsconfig.json", '{"extends":"cfg"}');
    fs.writeFileSync(path.join(tmp, "pkg.json"), '{"tsconfig":"x.json"}');
    fs.symlinkSync(path.join(tmp, "pkg.json"), path.join(main, "node_modules/cfg/package.json"));
    expect(loadTsconfigChain(main).unresolved.join(" ")).toContain("node_modules/cfg/package.json");
    expect(freshnessFor(computeLearnSourceBasis(main), computeLearnSourceBasis(main))).toBe("unknown");
    fs.rmSync(path.join(main, "node_modules/cfg/package.json"));
    write(main, "node_modules/cfg/package.json", "{not json");
    expect(loadTsconfigChain(main).unresolved.join(" ")).toContain("parseable");
  });

  test("R1-F3: package.json#tsconfig outside the worktree is unresolved", () => {
    const main = seedMain();
    write(main, "node_modules/cfg/package.json", '{"tsconfig":"../../../outside.json"}');
    write(main, "node_modules/cfg/tsconfig.json", "{}");
    write(main, "tsconfig.json", '{"extends":"cfg"}');
    expect(loadTsconfigChain(main).unresolved.join(" ")).toContain("outside worktree");
    expect(freshnessFor(computeLearnSourceBasis(main), computeLearnSourceBasis(main))).toBe("unknown");
  });

  test("R1-F2: line comments end at CR, LS and PS; unterminated strings and comments throw", () => {
    expect(parseJsonc('{\n// c\r"extends":"./b.json"\n}')).toEqual({ extends: "./b.json" });
    expect(parseJsonc('{// c "a":1}')).toEqual({ a: 1 });
    expect(parseJsonc('{// c "a":1}')).toEqual({ a: 1 });
    expect(() => parseJsonc('{"a":1 /* open')).toThrow();
    expect(() => parseJsonc('{"a":"open')).toThrow();
  });
});

describe("K02 review r2 regressions (tsconfig)", () => {
  test("R2-F3: a refused declared tsconfig target does not fall through to the package tsconfig.json", () => {
    const main = seedMain();
    fs.writeFileSync(path.join(tmp, "outside.json"), "{}");
    write(main, "node_modules/cfg/package.json", '{"tsconfig":"declared.json"}');
    fs.symlinkSync(path.join(tmp, "outside.json"), path.join(main, "node_modules/cfg/declared.json"));
    write(main, "node_modules/cfg/tsconfig.json", "{}");
    write(main, "tsconfig.json", '{"extends":"cfg"}');
    const chain = loadTsconfigChain(main);
    expect(chain.unresolved).toEqual(["tsconfig.json -> cfg: not a contained regular file"]);
    expect(chain.hops.map((h) => h.path)).toEqual(["tsconfig.json"]);
    // A package directory named like the specifier is skipped, not refused.
    fs.rmSync(path.join(main, "node_modules/cfg/declared.json"));
    write(main, "node_modules/cfg/package.json", '{"name":"cfg"}');
    expect(loadTsconfigChain(main)).toMatchObject({ unresolved: [], hops: [{ path: "tsconfig.json" }, { path: "node_modules/cfg/tsconfig.json" }] });
  });
});

describe("K02 review r4 regressions (fixed after the final round)", () => {
  test("R4-F1: an inaccessible nearer node_modules is unresolved, not a fallback to an ancestor", () => {
    const main = seedMain();
    write(main, "config/node_modules/cfg/tsconfig.json", "{}");
    write(main, "node_modules/cfg/tsconfig.json", "{}");
    write(main, "config/base.json", '{"extends":"cfg"}');
    write(main, "tsconfig.json", '{"extends":"./config/base.json"}');
    expect(loadTsconfigChain(main).unresolved).toEqual([]);
    fs.chmodSync(path.join(main, "config/node_modules"), 0o000);
    try {
      const u = loadTsconfigChain(main).unresolved;
      expect(u.length).toBe(1);
      expect(u[0].startsWith("config/base.json -> cfg: ")).toBe(true);
    } finally {
      fs.chmodSync(path.join(main, "config/node_modules"), 0o755);
    }
  });
});
