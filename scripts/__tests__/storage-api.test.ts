/**
 * scripts/__tests__/storage-api.test.ts — U-STOR (T05) acceptance fixtures.
 *
 * One test per named success criterion (R23, R25–R27, R51, R59, KTD15, KTD16):
 *
 *   1. research working files land under OS temp, never a durable tree
 *   2. an ingested blob lands under definition("sources", <id>)
 *   3. closeRun deletes the run's scratch
 *   4. leftover Guild temp after a simulated reboot is swept by the janitor
 *   5. domain TS with a hardcoded /tmp fails lint
 *   6. the KTD16 run JSONL still resolves at its frozen path
 *   7. no eager empty dirs and no fake registries on the init floor
 */

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  removeContainedTree,
  removeContainedEmptyDir,
  resolveContainedRealDir,
  createGuildStorage,
  runStorageGc,
  scanDurableDebris,
  validateRegistry,
  assertRegistered,
  assertClassPlacement,
  isUnderDurable,
  STORAGE_ARTIFACT_REGISTRY,
  type GuildStorage,
} from "../lib/state/storage";
import {
  eagerEntriesFor,
  lazyEntriesFor,
  requiredEntriesFor,
  scaffoldFor,
} from "../../src/modules/config/workflows/init-scaffold-manifest";

const REPO = path.resolve(__dirname, "..", "..");

let sandbox: string;
let repoRoot: string;
let storage: GuildStorage;

function mkStorage(root: string, external: string): GuildStorage {
  return createGuildStorage(root, {
    activeRoot: root,
    profile: "standalone",
    env: {
      GUILD_STATE_HOME: path.join(external, "state"),
      GUILD_CACHE_HOME: path.join(external, "cache"),
      GUILD_WORKTREE_HOME: path.join(external, "worktrees"),
      GUILD_TEMP_HOME: path.join(external, "temp"),
    } as NodeJS.ProcessEnv,
  });
}

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "guild-storage-test-"));
  repoRoot = path.join(sandbox, "repo");
  fs.mkdirSync(path.join(repoRoot, ".guild"), { recursive: true });
  storage = mkStorage(repoRoot, path.join(sandbox, "external"));
});

afterEach(() => {
  fs.rmSync(sandbox, { recursive: true, force: true });
});

describe("KTD15 — the storage classes decide the home", () => {
  test("the artifact registry is self-consistent and every row is classified", () => {
    expect(validateRegistry()).toEqual([]);
    expect(STORAGE_ARTIFACT_REGISTRY.length).toBeGreaterThan(0);
    for (const row of STORAGE_ARTIFACT_REGISTRY) {
      expect(assertRegistered(row.id)).toBe(row);
    }
    expect(() => assertRegistered("not-a-classified-artifact")).toThrow(/not in guild.storage_artifact_registry/);
  });

  test("the KTD16 freeze is not a blanket exemption for .guild/runs", () => {
    const guildDir = path.join(repoRoot, ".guild");
    // A run RECORD is durable-record and belongs there…
    expect(() =>
      assertClassPlacement("durable-record", path.join(guildDir, "runs", "r1", "run.yaml"), guildDir),
    ).not.toThrow();
    // …but scratch or a cache under the same prefix is still debris.
    for (const cls of ["cache", "temporary", "runtime", "managed-resource"] as const) {
      expect(() => assertClassPlacement(cls, path.join(guildDir, "runs", "r1", "junk"), guildDir)).toThrow(
        /may not resolve beneath/,
      );
    }
  });

  test("a cache/runtime/temporary path beneath .guild is refused", () => {
    const guildDir = path.join(repoRoot, ".guild");
    for (const cls of ["cache", "runtime", "temporary", "managed-resource"] as const) {
      expect(() => assertClassPlacement(cls, path.join(guildDir, "index.sqlite"), guildDir)).toThrow(
        /may not resolve beneath/,
      );
    }
    // …and truth outside the repo is refused just as hard.
    expect(() => assertClassPlacement("canonical", path.join(sandbox, "elsewhere.md"), guildDir)).toThrow(
      /must resolve beneath/,
    );
  });

  test("caches and runtime state resolve OUTSIDE the repo", () => {
    expect(isUnderDurable(storage.cache("index.sqlite"), storage.root.durable)).toBe(false);
    expect(isUnderDurable(storage.runtime("leases", "x.json"), storage.root.durable)).toBe(false);
    expect(isUnderDurable(storage.worktree("run-1", "lane-a"), storage.root.durable)).toBe(false);
  });

  test("a traversal, dot, or absolute segment is refused", () => {
    expect(() => storage.definition("sources", "..")).toThrow(/traversal/);
    expect(() => storage.definition("sources", "a/../../etc")).toThrow(/traversal/);
    expect(() => storage.temporary("run-1", "/etc/passwd")).toThrow(/absolute/);
    expect(() => storage.temporary("run-1", "C:\\Windows")).toThrow(/absolute/);
    // "." would resolve to the scratch ROOT — closeRun(".") must not be a way to
    // delete every run's scratch at once.
    expect(() => storage.temporary(".")).toThrow(/dot segment/);
    expect(() => storage.closeRun(".")).toThrow(/dot segment/);
  });
});

describe("R51 / KTD34 — research working files are OS temp, never durable", () => {
  test("temporary() resolves under the OS temp root and not under .guild", () => {
    const scratch = storage.temporary("run-research", "notes.md");
    expect(scratch.startsWith(storage.root.temp + path.sep)).toBe(true);
    expect(isUnderDurable(scratch, storage.root.durable)).toBe(false);
    // Explicitly: not the retired raw tree, and not anywhere in the durable tree.
    expect(scratch).not.toContain(path.join(".guild", "raw"));
  });

  test("writing a research file leaves the durable tree untouched", () => {
    const scratch = storage.temporary("run-research");
    storage.ensureDir(scratch);
    fs.writeFileSync(path.join(scratch, "experiment.md"), "# scratch\n");
    expect(fs.readdirSync(path.join(repoRoot, ".guild"))).toEqual([]);
  });
});

describe("R59 / KTD47 — ingested blobs are durable sources", () => {
  test("definition(\"sources\", id) lands in the durable tree, not the retired raw tree", () => {
    const blob = storage.definition("sources", "acme-handbook.pdf");
    expect(isUnderDurable(blob, storage.root.durable)).toBe(true);
    expect(blob).toBe(path.join(repoRoot, ".guild", "knowledge", "sources", "acme-handbook.pdf"));
    expect(blob).not.toContain(path.join(".guild", "raw"));
  });

  test("a slash-joined and a segment-joined request resolve to the same home", () => {
    expect(storage.definition("sources/acme.pdf")).toBe(storage.definition("sources", "acme.pdf"));
    expect(storage.definition("agents/backend.md")).toBe(storage.definition("agents", "backend.md"));
  });

  test("other definition segments stay at the definition tree root", () => {
    expect(storage.definition("agents", "backend.md")).toBe(
      path.join(repoRoot, ".guild", "agents", "backend.md"),
    );
  });
});

describe("R25–R27 — closeRun is a resource close", () => {
  test("closeRun deletes the run's scratch and runtime state, idempotently", () => {
    const scratch = storage.ensureDir(storage.temporary("run-1"));
    const runtime = storage.ensureDir(storage.runtime("runs", "run-1"));
    fs.writeFileSync(path.join(scratch, "tmp.txt"), "x");
    fs.writeFileSync(path.join(runtime, "lease.json"), "{}");

    const result = storage.closeRun("run-1");
    expect(fs.existsSync(scratch)).toBe(false);
    expect(fs.existsSync(runtime)).toBe(false);
    expect(result.removed).toEqual(expect.arrayContaining([scratch, runtime]));

    // Idempotent: a second close is a no-op, not a throw.
    expect(storage.closeRun("run-1").removed).toEqual([]);
  });

  test("a populated managed worktree is NEVER deleted by close", () => {
    const lane = storage.ensureDir(storage.worktree("run-1", "lane-a"));
    // Every shape that a cheap "is it clean?" heuristic got wrong: a marker that
    // says clean, and work that the marker never saw.
    fs.writeFileSync(path.join(lane, ".guild-worktree.json"), JSON.stringify({ dirty: false }));
    fs.writeFileSync(path.join(lane, "src.ts"), "// uncommitted work\n");

    const result = storage.closeRun("run-1");
    expect(fs.existsSync(path.join(lane, "src.ts"))).toBe(true);
    expect(result.preserved.map((p) => p.path)).toEqual([lane]);
    expect(result.removed).not.toContain(lane);
  });

  test("an EMPTY managed worktree is reclaimed", () => {
    const lane = storage.ensureDir(storage.worktree("run-2", "lane-a"));
    const result = storage.closeRun("run-2");
    expect(fs.existsSync(lane)).toBe(false);
    expect(result.removed).toContain(lane);
  });

  test("closeRun refuses when an ANCESTOR of its scratch is a symlink", () => {
    // `lstat` on the last component alone passed here: `<temp>/<id>/runs` is the
    // link, `runs/<run-id>` is a real directory inside the victim tree.
    const outside = path.join(sandbox, "outside-ancestor");
    fs.mkdirSync(path.join(outside, "run-7"), { recursive: true });
    fs.writeFileSync(path.join(outside, "run-7", "precious.md"), "not Guild's to delete\n");

    const scratchBase = path.dirname(storage.temporary(undefined));
    fs.mkdirSync(scratchBase, { recursive: true });
    fs.symlinkSync(outside, path.join(scratchBase, "runs"), "dir");

    const result = storage.closeRun("run-7");
    expect(result.removed).toEqual([]);
    expect(fs.existsSync(path.join(outside, "run-7", "precious.md"))).toBe(true);
  });

  test("closeRun never follows a symlink planted where its scratch belongs", () => {
    const outside = path.join(sandbox, "outside-close");
    fs.mkdirSync(outside, { recursive: true });
    fs.writeFileSync(path.join(outside, "precious.md"), "not Guild's to delete\n");

    const scratch = storage.temporary("run-6");
    fs.mkdirSync(path.dirname(scratch), { recursive: true });
    fs.symlinkSync(outside, scratch, "dir");

    const result = storage.closeRun("run-6");
    expect(result.removed).toEqual([]);
    expect(fs.existsSync(path.join(outside, "precious.md"))).toBe(true);
  });

});

describe("R54 — the scratch janitor sweeps leftover temp after a reboot", () => {
  test("scratch older than the TTL is reported, and removed with apply", () => {
    const stale = storage.ensureDir(storage.temporary("run-crashed"));
    fs.writeFileSync(path.join(stale, "half-written.md"), "x");
    const fresh = storage.ensureDir(storage.temporary("run-live"));
    fs.writeFileSync(path.join(fresh, "live.md"), "x");

    // Simulated reboot: the crashed run's scratch survived, aged 48h; closeRun
    // never ran for it. The live run's scratch was touched a minute ago.
    const now = Date.now();
    const old = new Date(now - 48 * 3600_000);
    for (const p of [stale, path.join(stale, "half-written.md")]) fs.utimesSync(p, old, old);

    const dry = runStorageGc(repoRoot, { ...gcOpts(), now });
    expect(dry.applied).toBe(false);
    expect(dry.scratch.map((s) => s.path)).toEqual([stale]);
    expect(dry.scratchRetained.map((s) => s.path)).toEqual([fresh]);
    expect(fs.existsSync(stale)).toBe(true);

    const applied = runStorageGc(repoRoot, { ...gcOpts(), now, apply: true });
    expect(applied.scratch.map((s) => s.path)).toEqual([stale]);
    expect(fs.existsSync(stale)).toBe(false);
    expect(fs.existsSync(fresh)).toBe(true);
  });

  test("a symlinked scratch entry is never swept, even with --apply", () => {
    // The link must point at a tree the UNFIXED scanner would have swept: a
    // directory (not a file) that is older than the TTL. A file-only target made
    // this test pass against the broken scanner too.
    const outside = path.join(sandbox, "outside");
    const victim = path.join(outside, "aged-dir");
    fs.mkdirSync(victim, { recursive: true });
    fs.writeFileSync(path.join(victim, "precious.md"), "not Guild's to delete\n");
    const old = new Date(Date.now() - 48 * 3600_000);
    for (const p of [path.join(victim, "precious.md"), victim, outside]) fs.utimesSync(p, old, old);

    // Point <temp>/<root-id>/runs at a tree outside the scratch root.
    const scratchBase = path.dirname(storage.temporary(undefined));
    fs.mkdirSync(scratchBase, { recursive: true });
    fs.symlinkSync(outside, path.join(scratchBase, "runs"), "dir");

    const report = runStorageGc(repoRoot, { ...gcOpts(), apply: true });
    expect(report.scratch).toEqual([]);
    expect(fs.existsSync(victim)).toBe(true);
    expect(fs.existsSync(path.join(victim, "precious.md"))).toBe(true);
  });

  test("the containment helper refuses every path that resolves outside its root", () => {
    // The mechanism the janitor's delete depends on, tested directly — the
    // ancestor-swap race itself is not reproducible in-process, so the guard that
    // closes it is what gets pinned.
    const tempRoot = path.join(sandbox, "external", "temp");
    const outside = path.join(sandbox, "outside-helper");
    fs.mkdirSync(path.join(outside, "victim"), { recursive: true });
    fs.mkdirSync(tempRoot, { recursive: true });
    fs.symlinkSync(outside, path.join(tempRoot, "link"), "dir");

    // a) an absolute path outside the root
    expect(resolveContainedRealDir(outside, tempRoot)).toBeNull();
    expect(removeContainedTree(outside, tempRoot)).toBeNull();
    // b) a path INSIDE the root whose realpath escapes through a symlink
    const escaped = path.join(tempRoot, "link", "victim");
    expect(resolveContainedRealDir(escaped, tempRoot)).toBeNull();
    expect(removeContainedTree(escaped, tempRoot)).toBeNull();
    // c) the root itself is never removable
    expect(resolveContainedRealDir(tempRoot, tempRoot)).toBeNull();
    expect(fs.existsSync(path.join(outside, "victim"))).toBe(true);
  });

  test("removeContainedEmptyDir removes only an empty directory", () => {
    const root = storage.ensureDir(path.join(sandbox, "external", "temp", "root"));
    const empty = storage.ensureDir(path.join(root, "empty"));
    const full = storage.ensureDir(path.join(root, "full"));
    fs.writeFileSync(path.join(full, "x"), "x");

    expect(removeContainedEmptyDir(full, root)).toBe(false);
    expect(fs.existsSync(path.join(full, "x"))).toBe(true);
    expect(removeContainedEmptyDir(empty, root)).toBe(true);
    expect(fs.existsSync(empty)).toBe(false);
  });

  test("the durable sweep is report-only — it never deletes", () => {
    const guildDir = path.join(repoRoot, ".guild");
    fs.writeFileSync(path.join(guildDir, "index.sqlite"), "");
    fs.mkdirSync(path.join(guildDir, "artifacts"), { recursive: true });

    const findings = scanDurableDebris(guildDir);
    expect(findings.map((f) => f.storageClass).sort()).toEqual(["cache", "empty-dir"]);
    expect(fs.existsSync(path.join(guildDir, "index.sqlite"))).toBe(true);

    const report = runStorageGc(repoRoot, { ...gcOpts(), apply: true });
    expect(report.durable.length).toBeGreaterThan(0);
    expect(fs.existsSync(path.join(guildDir, "index.sqlite"))).toBe(true);
  });
});

describe("KTD16 — the frozen run-record paths still resolve", () => {
  test("the run JSONL resolves at .guild/runs/<run-id>/logs/v1.4-events.jsonl", () => {
    const jsonl = storage.project!.runRecord("run-9b47f4f5", "logs", "v1.4-events.jsonl");
    expect(jsonl).toBe(
      path.join(repoRoot, ".guild", "runs", "run-9b47f4f5", "logs", "v1.4-events.jsonl"),
    );
    expect(isUnderDurable(jsonl, storage.root.durable)).toBe(true);
  });

  test("a run record written through the API is readable at the frozen path", () => {
    const logs = storage.ensureDir(storage.project!.runRecord("run-x", "logs"));
    fs.writeFileSync(path.join(logs, "v1.4-events.jsonl"), '{"event_name":"run_started"}\n');
    const frozen = path.join(repoRoot, ".guild", "runs", "run-x", "logs", "v1.4-events.jsonl");
    expect(JSON.parse(fs.readFileSync(frozen, "utf8").trim()).event_name).toBe("run_started");
  });
});

describe("R23 — the init floor is lazy", () => {
  test("nothing init writes is an empty directory", () => {
    for (const mode of ["single_project", "workspace_root"] as const) {
      for (const entry of eagerEntriesFor(mode)) {
        expect(entry.source).not.toBe("empty-dir");
        expect(entry.kind).toBe("file");
      }
    }
  });

  test("the floor is root identity plus scoped config, and no derived registry", () => {
    expect(eagerEntriesFor("single_project").map((e) => e.path)).toEqual([
      ".guild/guild.yaml",
      ".guild/settings.json",
    ]);
    expect(eagerEntriesFor("workspace_root").map((e) => e.path)).toEqual([
      ".guild/guild.yaml",
      ".guild/settings.json",
      ".guild/workspace.json",
      ".guild/workspace/workspace.yaml",
    ]);
    for (const entry of eagerEntriesFor("workspace_root")) {
      expect(entry.path).not.toMatch(/registry\.yaml$/);
    }
  });

  test("the required floor matches the eager floor — a lazy tree is not a broken install", () => {
    for (const mode of ["single_project", "workspace_root", "workspace_child"] as const) {
      expect(requiredEntriesFor(mode).map((e) => e.path)).toEqual(
        eagerEntriesFor(mode).map((e) => e.path),
      );
    }
  });

  test("every remaining home is still documented, just lazy", () => {
    const all = scaffoldFor("workspace_root");
    expect(lazyEntriesFor("workspace_root").length).toBe(all.length - 4);
    expect(all.map((e) => e.path)).toContain(".guild/knowledge/sources/");
    expect(all.map((e) => e.path)).not.toContain(".guild/raw/");
  });
});

describe("KTD15 / KTD34 — the lint fixtures fail as they must", () => {
  const lintFixture = (name: string): string => {
    const dir = path.join(REPO, "scripts/lint/__tests__/fixtures", name);
    // The lint exits non-zero when it finds a violation — which is the point of a
    // known-positive fixture — so read stdout off the thrown result too.
    try {
      return execFileSync(
        "npx",
        ["tsx", "lint/layout-laws.ts", `--root=${dir}`, `--check=${name.split(".")[0]}`, "--no-baseline", "--json"],
        { cwd: path.join(REPO, "scripts"), encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
      );
    } catch (e) {
      const out = (e as { stdout?: string }).stdout;
      if (typeof out === "string" && out.trim()) return out;
      throw e;
    }
  };

  test("domain TS with a hardcoded /tmp fails lint", () => {
    const out = JSON.parse(lintFixture("no-hardcoded-tmp-in-domain-ts"));
    expect(out.violations.length).toBeGreaterThan(0);
    expect(out.violations[0].detail).toMatch(/GuildStorage\.temporary/);
  });

  test("a direct .guild join outside state storage fails lint, and the allowlisted copy does not", () => {
    const bad = JSON.parse(lintFixture("no-direct-guild-join"));
    expect(bad.violations.length).toBeGreaterThan(0);
    const ok = JSON.parse(lintFixture("no-direct-guild-join.__allowlisted"));
    expect(ok.violations).toEqual([]);
  });
});

function gcOpts() {
  return {
    activeRoot: repoRoot,
    profile: "standalone" as const,
    env: {
      GUILD_STATE_HOME: path.join(sandbox, "external", "state"),
      GUILD_CACHE_HOME: path.join(sandbox, "external", "cache"),
      GUILD_WORKTREE_HOME: path.join(sandbox, "external", "worktrees"),
      GUILD_TEMP_HOME: path.join(sandbox, "external", "temp"),
    } as NodeJS.ProcessEnv,
  };
}
