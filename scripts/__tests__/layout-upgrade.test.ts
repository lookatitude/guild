/**
 * scripts/__tests__/layout-upgrade.test.ts — U-UPG (T07) acceptance fixtures.
 *
 * One test per named success criterion (R39, R80, KTD22, KTD23, KTD56, KTD70):
 *
 *    1. an unmarked v1 root upgrades to layout 2 with knowledge preserved
 *    2. an already-converted unmarked v2 root is a no-op on the content steps
 *    3. a dirty tracked wiki blocks the durable move and prints the exact paths
 *    4. a hybrid root's settings land in BOTH config files, once
 *    5. a Codex-pinned initiative yaml loses its model ids
 *    6. an existing specialist profile is never replaced by feedstock
 *    7. a child repo is untouched when only the root is activated
 *    8. the journal survives a crash and the resume completes
 *    9. a layout-3 marker refuses writes against CURRENT = 2
 *   10. the glossary is created when missing and kept when present
 *
 * Every fixture injects the dirty probe rather than shelling out to git: what is
 * under test is the BLOCKING RULE, not git's porcelain format.
 */

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { CURRENT_LAYOUT_VERSION, detect, ensureStorageLayout } from "../lib/state/ensure-storage-layout";
import {
  canonicalPolicyKey,
  findHostIdentity,
  isPolicyKey,
} from "../../src/modules/config/workflows/policy-keys";
import {
  createGuildStorage,
  formatUpgradeReport,
  loadJournal,
  runUpgrade,
  upgradeJournalPath,
  validateUpgrade,
  UPGRADE_STEP_IDS,
  type GuildStorage,
} from "../../src/modules/state";

// ── fixtures ─────────────────────────────────────────────────────────────────

interface Fixture {
  root: string;
  guildDir: string;
  external: string;
  storage: GuildStorage;
}

function mkFixture(name: string): Fixture {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), `guild-t07-${name}-`));
  const root = path.join(base, "repo");
  const external = path.join(base, "platform");
  fs.mkdirSync(path.join(root, ".git"), { recursive: true });
  fs.mkdirSync(path.join(root, ".guild"), { recursive: true });
  const storage = createGuildStorage(root, {
    activeRoot: root,
    env: {
      GUILD_STATE_HOME: path.join(external, "state"),
      GUILD_CACHE_HOME: path.join(external, "cache"),
      GUILD_TEMP_HOME: path.join(external, "temp"),
      GUILD_WORKTREE_HOME: path.join(external, "worktrees"),
    },
  });
  return { root, guildDir: path.join(root, ".guild"), external, storage };
}

/**
 * The policy contract the real entry points inject (scripts/lib/state/upgrade-chain).
 * The domain takes it as an argument rather than importing `config`, so the fixtures
 * hand it the SAME implementation production uses — not a stub.
 */
const POLICY = { canonicalPolicyKey, isPolicyKey, findHostIdentity };

function write(abs: string, text: string): void {
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text, "utf8");
}

function run(f: Fixture, opts: { dirty?: string[]; dryRun?: boolean; from?: number | null } = {}) {
  return runUpgrade({
    cwd: f.root,
    storage: f.storage,
    fromVersion: opts.from ?? null,
    toVersion: CURRENT_LAYOUT_VERSION,
    dryRun: opts.dryRun,
    dirtyProbe: () => opts.dirty ?? [],
    policy: POLICY,
    now: () => "2026-01-01T00:00:00.000Z",
    nowMs: () => 1767225600000,
  });
}

function stepStatus(result: ReturnType<typeof run>, id: string): string | undefined {
  return result.journal.entries.find((e) => e.step_id === id)?.status;
}

// ── the catalog itself (spec gap G-b) ────────────────────────────────────────

describe("U-UPG step catalog", () => {
  it("pins the nine step ids, in run order", () => {
    expect(UPGRADE_STEP_IDS).toEqual([
      "v1-content",
      "settings-policy-split",
      "ktd22-host-identity-strip",
      "caches-out",
      "closed-run-receipts",
      "current-run-id-retire",
      "skill-versions-delete",
      "registry-yaml-retire",
      "glossary-create",
    ]);
  });
});

// ── 1 ────────────────────────────────────────────────────────────────────────

describe("1. unmarked v1 root upgrades to layout 2 with knowledge preserved", () => {
  it("stamps the marker and keeps every wiki page", () => {
    const f = mkFixture("v1");
    write(path.join(f.guildDir, "wiki", "index.md"), "# index\n");
    write(path.join(f.guildDir, "wiki", "decisions", "d1.md"), "# a decision we keep\n");
    write(path.join(f.guildDir, "indexes", "codebase-map.json"), "{}\n");
    write(path.join(f.guildDir, "settings.json"), JSON.stringify({ defaults: { agent_mode: "team" } }));

    expect(detect(f.root).state).toBe("unmarked");
    const result = run(f);

    expect(result.state).toBe("committed");
    expect(result.marker_written).toBe(true);
    expect(detect(f.root).state).toBe("current");
    expect(fs.readFileSync(path.join(f.guildDir, "wiki", "decisions", "d1.md"), "utf8")).toBe(
      "# a decision we keep\n",
    );
    // Derived caches left; knowledge did not.
    expect(fs.existsSync(path.join(f.guildDir, "indexes"))).toBe(false);
  });
});

// ── 2 ────────────────────────────────────────────────────────────────────────

describe("2. already-converted unmarked v2 root is a no-op on the content steps", () => {
  it("every content step reports skipped and the marker is still stamped", () => {
    const f = mkFixture("v2noop");
    write(path.join(f.guildDir, "wiki", "index.md"), "# index\n");
    write(path.join(f.guildDir, "wiki", "glossary.md"), "# ours\n");
    write(path.join(f.guildDir, "config", "project.json"), JSON.stringify({ agent_mode: "auto" }, null, 2) + "\n");

    const result = run(f);

    expect(result.state).toBe("committed");
    for (const id of ["settings-policy-split", "ktd22-host-identity-strip", "caches-out", "closed-run-receipts", "glossary-create"]) {
      expect(stepStatus(result, id)).toBe("skipped");
    }
    expect(fs.readFileSync(path.join(f.guildDir, "wiki", "glossary.md"), "utf8")).toBe("# ours\n");
  });
});

// ── 3 ────────────────────────────────────────────────────────────────────────

describe("3. a dirty tracked wiki blocks the durable move and prints the paths", () => {
  it("blocks durable steps, runs safe-local ones, and never stamps the marker", () => {
    const f = mkFixture("dirty");
    write(path.join(f.guildDir, "wiki", "index.md"), "# index\n");
    write(path.join(f.guildDir, "indexes", "codebase-map.json"), "{}\n");
    write(path.join(f.guildDir, "current-run-id"), "run-77\n");

    const result = run(f, { dirty: [".guild/wiki/index.md"] });

    expect(result.state).toBe("blocked_dirty_durable");
    expect(result.marker_written).toBe(false);
    expect(detect(f.root).state).toBe("unmarked"); // compatibility-read: still v1
    expect(stepStatus(result, "glossary-create")).toBe("blocked_dirty");
    // Safe-local steps are NOT blocked by a dirty tree.
    expect(stepStatus(result, "caches-out")).toBe("completed");
    expect(stepStatus(result, "current-run-id-retire")).toBe("completed");

    const report = formatUpgradeReport(result);
    expect(report).toContain(".guild/wiki/index.md");
    expect(report).toContain("config migrate --mode=migrate");
    // The durable content is exactly where it was.
    expect(fs.existsSync(path.join(f.guildDir, "wiki", "glossary.md"))).toBe(false);
  });
});

// ── 4 ────────────────────────────────────────────────────────────────────────

describe("4. a hybrid root's settings land in both config files, once", () => {
  it("writes project.json and workspace.json and a second run adds nothing", () => {
    const f = mkFixture("hybrid");
    write(path.join(f.guildDir, "wiki", "index.md"), "# index\n");
    write(
      path.join(f.guildDir, "settings.json"),
      JSON.stringify({ defaults: { agent_mode: "team", wiki: { autopromote: false } }, host: "codex-cli" }),
    );
    const hybrid = createGuildStorage(f.root, {
      activeRoot: f.root,
      profile: "hybrid",
      env: {
        GUILD_STATE_HOME: path.join(f.external, "state"),
        GUILD_CACHE_HOME: path.join(f.external, "cache"),
        GUILD_TEMP_HOME: path.join(f.external, "temp"),
        GUILD_WORKTREE_HOME: path.join(f.external, "worktrees"),
      },
    });

    const first = runUpgrade({
      cwd: f.root,
      storage: hybrid,
      fromVersion: null,
      toVersion: CURRENT_LAYOUT_VERSION,
      dirtyProbe: () => [],
      policy: POLICY,
      now: () => "2026-01-01T00:00:00.000Z",
      nowMs: () => 1767225600000,
    });
    expect(first.state).toBe("committed");

    const project = JSON.parse(fs.readFileSync(path.join(f.guildDir, "config", "project.json"), "utf8"));
    const workspace = JSON.parse(fs.readFileSync(path.join(f.guildDir, "config", "workspace.json"), "utf8"));
    expect(project.agent_mode).toBe("team");
    expect(workspace.agent_mode).toBe("team");
    expect(project.wiki.autopromote).toBe(false);
    // KTD22: the inventory key never reaches a durable policy file.
    expect(project.host).toBeUndefined();
    expect(workspace.host).toBeUndefined();
    expect(stepStatus(first, "settings-policy-split")).toBe("completed");

    // ONCE: re-running the STEP itself (journal discarded, so it really executes)
    // over the same legacy file changes nothing.
    const before = fs.readFileSync(path.join(f.guildDir, "config", "project.json"), "utf8");
    fs.rmSync(path.join(f.guildDir, "storage-layout.json"));
    fs.rmSync(upgradeJournalPath((...s: string[]) => hybrid.runtime(...s)), { force: true });
    const second = runUpgrade({
      cwd: f.root,
      storage: hybrid,
      fromVersion: null,
      toVersion: CURRENT_LAYOUT_VERSION,
      dirtyProbe: () => [],
      policy: POLICY,
      now: () => "2026-01-02T00:00:00.000Z",
      nowMs: () => 1767312000000,
    });
    expect(stepStatus(second, "settings-policy-split")).toBe("skipped");
    expect(fs.readFileSync(path.join(f.guildDir, "config", "project.json"), "utf8")).toBe(before);
  });
});

// ── 5 ────────────────────────────────────────────────────────────────────────

describe("5. a Codex-pinned initiative yaml loses its model ids", () => {
  it("strips host and model pins and keeps everything else", () => {
    const f = mkFixture("ktd22");
    write(path.join(f.guildDir, "wiki", "index.md"), "# index\n");
    write(
      path.join(f.guildDir, "initiatives", "active", "feature-x.yaml"),
      [
        "schema_version: guild.initiative.v1",
        "id: feature-x",
        "host: codex-cli",
        "model: gpt-5-codex",
        "tier: powerful",
        "title: ship feature x",
        "",
      ].join("\n"),
    );

    const result = run(f);
    expect(result.state).toBe("committed");
    expect(stepStatus(result, "ktd22-host-identity-strip")).toBe("completed");

    const after = fs.readFileSync(path.join(f.guildDir, "initiatives", "active", "feature-x.yaml"), "utf8");
    expect(after).not.toContain("codex-cli");
    expect(after).not.toContain("gpt-5-codex");
    expect(after).toContain("tier: powerful");
    expect(after).toContain("title: ship feature x");
  });
});

// ── 6 ────────────────────────────────────────────────────────────────────────

describe("6. an existing specialist profile is never replaced by feedstock", () => {
  it("keeps the project's own body byte-for-byte", () => {
    const f = mkFixture("profiles");
    write(path.join(f.guildDir, "wiki", "index.md"), "# index\n");
    const body = "---\nname: backend\n---\n\nour own backend profile, hand-edited\n";
    write(path.join(f.guildDir, "agents", "backend.md"), body);

    const result = run(f);

    expect(result.state).toBe("committed");
    expect(result.validation_errors).toEqual([]);
    expect(fs.readFileSync(path.join(f.guildDir, "agents", "backend.md"), "utf8")).toBe(body);
  });

  it("fails validation rather than committing if a profile were rewritten", () => {
    const f = mkFixture("profiles-guard");
    write(path.join(f.guildDir, "wiki", "index.md"), "# index\n");
    write(path.join(f.guildDir, "agents", "backend.md"), "original\n");
    // Simulate the defect the validation exists to catch.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const state = require("../../src/modules/state") as typeof import("../../src/modules/state");
    const errors = state.validateUpgrade(f.guildDir, {
      profiles: new Map([["backend.md", "a DIFFERENT original"]]),
      knowledgePages: 1,
    });
    expect(errors.join(" ")).toContain("agents/backend.md was rewritten");
  });
});

// ── 7 ────────────────────────────────────────────────────────────────────────

describe("7. a child repo is untouched when only the root is activated", () => {
  it("never walks into a nested .guild", () => {
    const f = mkFixture("child");
    write(path.join(f.guildDir, "wiki", "index.md"), "# index\n");
    const child = path.join(f.root, "packages", "child");
    write(path.join(child, ".guild", "wiki", "index.md"), "# child knowledge\n");
    write(path.join(child, ".guild", "indexes", "codebase-map.json"), "{}\n");
    write(path.join(child, ".guild", "settings.json"), JSON.stringify({ defaults: { agent_mode: "team" } }));

    const result = run(f);

    expect(result.state).toBe("committed");
    // The child's derived cache, settings and marker are all exactly as they were.
    expect(fs.existsSync(path.join(child, ".guild", "indexes", "codebase-map.json"))).toBe(true);
    expect(fs.existsSync(path.join(child, ".guild", "settings.json"))).toBe(true);
    expect(fs.existsSync(path.join(child, ".guild", "config"))).toBe(false);
    expect(fs.existsSync(path.join(child, ".guild", "storage-layout.json"))).toBe(false);
    expect(fs.existsSync(path.join(child, ".guild", "wiki", "glossary.md"))).toBe(false);
  });
});

// ── 8 ────────────────────────────────────────────────────────────────────────

describe("8. the journal survives a crash and the resume completes", () => {
  it("resumes by step id and does not redo settled steps", () => {
    const f = mkFixture("resume");
    write(path.join(f.guildDir, "wiki", "index.md"), "# index\n");
    write(path.join(f.guildDir, "skill-versions", "old", "snap.md"), "a snapshot nothing else has\n");

    // The unique snapshot blocks on confirmation — a real mid-chain stop.
    const first = run(f);
    expect(first.state).toBe("blocked_confirm");
    expect(first.question).toContain("skill-versions");
    expect(first.marker_written).toBe(false);

    const journalFile = upgradeJournalPath((...s: string[]) => f.storage.runtime(...s));
    const onDisk = loadJournal(journalFile);
    expect(onDisk).not.toBeNull();
    expect(onDisk!.state).toBe("blocked_confirm");
    expect(onDisk!.entries.find((e) => e.step_id === "caches-out")?.status).toBeDefined();

    // The operator answers the question by removing the tree, then retries.
    fs.rmSync(path.join(f.guildDir, "skill-versions"), { recursive: true, force: true });
    const second = run(f);
    expect(second.state).toBe("committed");
    expect(second.marker_written).toBe(true);
    // The already-settled steps were carried over from the journal, not re-run.
    expect(second.journal.entries.length).toBe(UPGRADE_STEP_IDS.length);
  });

  it("a truncated journal is discarded and the idempotent chain still completes", () => {
    const f = mkFixture("resume-truncated");
    write(path.join(f.guildDir, "wiki", "index.md"), "# index\n");
    const journalFile = upgradeJournalPath((...s: string[]) => f.storage.runtime(...s));
    write(journalFile, '{"schema_version":"guild.upgrade_jou');

    const result = run(f);
    expect(result.state).toBe("committed");
  });
});

// ── 9 ────────────────────────────────────────────────────────────────────────

describe("9. a layout-3 marker refuses writes against CURRENT = 2", () => {
  it("fails closed and never down-migrates", () => {
    const f = mkFixture("future");
    write(path.join(f.guildDir, "wiki", "index.md"), "# index\n");
    write(path.join(f.guildDir, "storage-layout.json"), JSON.stringify({ storage_layout_version: 3 }) + "\n");

    expect(detect(f.root).state).toBe("future");
    expect(() => ensureStorageLayout(f.root)).toThrow(/layout 3, this build understands 2/);
    // The marker is untouched: refusing is not rewriting.
    expect(JSON.parse(fs.readFileSync(path.join(f.guildDir, "storage-layout.json"), "utf8"))).toEqual({
      storage_layout_version: 3,
    });
  });
});

// ── 10 ───────────────────────────────────────────────────────────────────────

describe("10. the glossary is created when missing and kept when present", () => {
  it("creates .guild/wiki/glossary.md from feedstock when absent", () => {
    const f = mkFixture("glossary-new");
    write(path.join(f.guildDir, "wiki", "index.md"), "# index\n");

    const result = run(f);
    expect(stepStatus(result, "glossary-create")).toBe("completed");
    const text = fs.readFileSync(path.join(f.guildDir, "wiki", "glossary.md"), "utf8");
    expect(text).toContain("schema_version: guild.glossary.v1");
  });

  it("never replaces an existing project glossary", () => {
    const f = mkFixture("glossary-keep");
    write(path.join(f.guildDir, "wiki", "index.md"), "# index\n");
    const mine = "---\nschema_version: guild.glossary.v1\n---\n\n# ours only\n";
    write(path.join(f.guildDir, "wiki", "glossary.md"), mine);

    const result = run(f);
    expect(stepStatus(result, "glossary-create")).toBe("skipped");
    expect(fs.readFileSync(path.join(f.guildDir, "wiki", "glossary.md"), "utf8")).toBe(mine);
  });
});

// ── the constraints, asserted directly ───────────────────────────────────────

describe("U-UPG constraints", () => {
  it("a dry run writes nothing at all — no marker, no journal, no step output", () => {
    const f = mkFixture("dryrun");
    write(path.join(f.guildDir, "wiki", "index.md"), "# index\n");
    write(path.join(f.guildDir, "current-run-id"), "run-9\n");

    const result = run(f, { dryRun: true });

    expect(result.state).toBe("planned");
    expect(result.marker_written).toBe(false);
    expect(fs.existsSync(path.join(f.guildDir, "storage-layout.json"))).toBe(false);
    expect(fs.existsSync(path.join(f.guildDir, "wiki", "glossary.md"))).toBe(false);
    expect(fs.existsSync(path.join(f.guildDir, "current-run-id"))).toBe(true);
    expect(loadJournal(upgradeJournalPath((...s: string[]) => f.storage.runtime(...s)))).toBeNull();
  });

  it("an unreadable git fails CLOSED: durable steps are blocked, not assumed clean", () => {
    const f = mkFixture("git-unknown");
    write(path.join(f.guildDir, "wiki", "index.md"), "# index\n");

    const result = runUpgrade({
      cwd: f.root,
      storage: f.storage,
      fromVersion: null,
      toVersion: CURRENT_LAYOUT_VERSION,
      dirtyProbe: () => null,
      policy: POLICY,
      now: () => "2026-01-01T00:00:00.000Z",
      nowMs: () => 1767225600000,
    });

    expect(result.state).toBe("blocked_dirty_durable");
    expect(result.marker_written).toBe(false);
  });

  it("an authored registry is PRESERVED, never deleted; a derived one is removed", () => {
    const f = mkFixture("registries");
    write(path.join(f.guildDir, "wiki", "index.md"), "# index\n");
    write(path.join(f.guildDir, "loops", "registry.yaml"), "loops:\n  - id: ours\n");
    write(path.join(f.guildDir, "agents", "registry.yaml"), "agents: []\n");

    const result = run(f);
    expect(stepStatus(result, "registry-yaml-retire")).toBe("completed");
    expect(fs.existsSync(path.join(f.guildDir, "agents", "registry.yaml"))).toBe(false);
    expect(fs.existsSync(path.join(f.guildDir, "loops", "registry.yaml"))).toBe(false);
    expect(fs.readFileSync(path.join(f.guildDir, "artifacts", "legacy", "loops-registry.yaml"), "utf8")).toContain(
      "id: ours",
    );
  });

  it("an open run is never falsely closed; a terminal one gets a receipt", () => {
    const f = mkFixture("runs");
    write(path.join(f.guildDir, "wiki", "index.md"), "# index\n");
    write(path.join(f.guildDir, "runs", "run-open", "run.yaml"), "run_id: run-open\nstatus: active\n");
    write(path.join(f.guildDir, "runs", "run-done", "run.yaml"), "run_id: run-done\nstatus: closed\n");

    const result = run(f);
    expect(stepStatus(result, "closed-run-receipts")).toBe("completed");
    expect(fs.existsSync(path.join(f.guildDir, "runs", "run-open", "receipt.json"))).toBe(false);
    const receipt = JSON.parse(fs.readFileSync(path.join(f.guildDir, "runs", "run-done", "receipt.json"), "utf8"));
    expect(receipt.schema_version).toBe("guild.run_receipt.v1");
    // The legacy payload is durable, not derived: it stays.
    expect(fs.existsSync(path.join(f.guildDir, "runs", "run-done", "run.yaml"))).toBe(true);
  });
});

// ── the bundling trap this lane actually hit ─────────────────────────────────

describe("the layout entry never self-executes inside another CLI's bundle", () => {
  const cli = path.join(__dirname, "..", "..", "runtime", "scripts", "migrate-guild.js");
  const maybe = fs.existsSync(cli) ? it : it.skip;

  maybe("`config migrate --root=<other>` leaves the INVOKING cwd alone", () => {
    // `ensure-storage-layout` is imported by this CLI, and esbuild inlines an
    // imported module's top level into the importer's bundle. Guarding its CLI
    // with `require.main === module` made that block fire HERE, upgrading
    // `process.cwd()` and exiting before migrate-guild's own main ran. It
    // rewrote a working tree it was never pointed at. This is the regression.
    // No fake `.git` here: this test runs the REAL dirty probe, and a `.git`
    // directory that is not a repository makes it fail closed (which is correct,
    // but is not what this test is about).
    const target = mkFixture("entry-guard-target");
    fs.rmSync(path.join(target.root, ".git"), { recursive: true, force: true });
    write(path.join(target.guildDir, "wiki", "index.md"), "# target\n");

    const bystander = mkFixture("entry-guard-bystander");
    fs.rmSync(path.join(bystander.root, ".git"), { recursive: true, force: true });
    write(path.join(bystander.guildDir, "wiki", "index.md"), "# bystander\n");
    write(path.join(bystander.guildDir, "current-run-id"), "run-untouched\n");

    execFileSync(process.execPath, [cli, `--root=${target.root}`, "--mode=migrate"], {
      cwd: bystander.root,
      env: { ...process.env, GUILD_STATE_HOME: path.join(target.external, "state") },
      stdio: "ignore",
    });

    expect(fs.existsSync(path.join(target.guildDir, "storage-layout.json"))).toBe(true);
    // The cwd the operator happened to be standing in is NOT a Guild root it may touch.
    expect(fs.existsSync(path.join(bystander.guildDir, "storage-layout.json"))).toBe(false);
    expect(fs.existsSync(path.join(bystander.guildDir, "current-run-id"))).toBe(true);
    expect(fs.existsSync(path.join(bystander.guildDir, "wiki", "glossary.md"))).toBe(false);
  });
});

// ── rework-r1: the five data-integrity defects, each pinned ──────────────────

/** Every file under `dir`, repo-relative, with its bytes. The comparison unit. */
function snapshotTree(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (abs: string, rel: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(abs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const next = path.join(abs, e.name);
      const key = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(next, key);
      else if (e.isFile()) out[key] = fs.readFileSync(next, "base64");
    }
  };
  walk(dir, "");
  return out;
}

describe("rework-r1 · P1-1 the converter bridge plans, it does not write", () => {
  it("--mode=dry-run leaves the tree AND the platform state root byte-identical", () => {
    const f = mkFixture("dryrun-pure");
    write(path.join(f.guildDir, "wiki", "index.md"), "# index\n");
    // `config.yml` is the converter's M1 evidence: this root classifies v1, so the
    // legacy dry-run leg is genuinely exercised (it is the leg that wrote a report).
    write(path.join(f.guildDir, "config.yml"), "version: 1\n");
    write(path.join(f.guildDir, "settings.json"), JSON.stringify({ rigor: "standard" }, null, 2));

    // A REAL, clean git repo: the durable dirty gate must let `v1-content` run, or
    // the converter leg this fixture exists to test is never reached.
    const git = (...args: string[]) => execFileSync("git", args, { cwd: f.root, stdio: "ignore" });
    fs.rmSync(path.join(f.root, ".git"), { recursive: true, force: true });
    git("init", "-q");
    git("config", "user.email", "t07@example.invalid");
    git("config", "user.name", "T07");
    git("add", "-A");
    git("-c", "commit.gpgsign=false", "commit", "-q", "-m", "fixture");

    const beforeRepo = snapshotTree(f.root);
    const beforePlatform = snapshotTree(f.external);

    const env = { ...process.env };
    process.env.GUILD_STATE_HOME = path.join(f.external, "state");
    process.env.GUILD_CACHE_HOME = path.join(f.external, "cache");
    process.env.GUILD_TEMP_HOME = path.join(f.external, "temp");
    process.env.GUILD_WORKTREE_HOME = path.join(f.external, "worktrees");
    let report;
    try {
      // The REAL bridge, with the REAL legacy converter wired in — not a stub.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const chain = require("../lib/state/upgrade-chain") as typeof import("../lib/state/upgrade-chain");
      report = chain.runLayoutUpgrade({
        root: f.root,
        fromVersion: null,
        toVersion: CURRENT_LAYOUT_VERSION,
        dryRun: true,
      });
    } finally {
      process.env = env;
    }

    expect(report.marker_written).toBe(false);
    expect(snapshotTree(f.root)).toEqual(beforeRepo);
    expect(snapshotTree(f.external)).toEqual(beforePlatform);
    // Named explicitly: the legacy report file is what used to survive a "plan".
    expect(fs.readdirSync(f.guildDir).filter((n) => /report/i.test(n))).toEqual([]);
  });
});

describe("rework-r1 · P1-2 a converter error is a step FAILURE, never a stamp", () => {
  it("a snapshot-verification error ends the run failed and writes no marker", () => {
    const f = mkFixture("v1-error");
    write(path.join(f.guildDir, "wiki", "index.md"), "# index\n");

    const result = runUpgrade({
      cwd: f.root,
      storage: f.storage,
      fromVersion: null,
      toVersion: CURRENT_LAYOUT_VERSION,
      dirtyProbe: () => [],
      policy: POLICY,
      now: () => "2026-01-01T00:00:00.000Z",
      nowMs: () => 1767225600000,
      v1: () => ({
        classification: "v1",
        action: "migrate",
        changed: 0,
        error: "snapshot verify failed at wiki/index.md — conversion aborted",
      }),
    });

    expect(stepStatus(result, "v1-content")).toBe("failed");
    expect(result.state).toBe("failed");
    expect(result.marker_written).toBe(false);
    expect(fs.existsSync(path.join(f.guildDir, "storage-layout.json"))).toBe(false);
    expect(formatUpgradeReport(result)).toContain("snapshot verify failed");
  });

  it("validateUpgrade refuses to stamp when any recorded step did not settle", () => {
    const f = mkFixture("validate-steps");
    write(path.join(f.guildDir, "wiki", "index.md"), "# index\n");
    const errors = validateUpgrade(
      f.guildDir,
      { profiles: new Map(), knowledgePages: 0 },
      path.join(f.guildDir, "wiki"),
      [
        { step_id: "v1-content", status: "completed" },
        { step_id: "caches-out", status: "skipped" },
        { step_id: "glossary-create", status: "failed" },
      ],
    );
    expect(errors).toContain("step glossary-create did not complete (failed) — refusing to stamp the marker");
  });
});

describe("rework-r1 · P1-3 a malformed policy target blocks, it is never replaced", () => {
  it("invalid config/project.json stops the step and leaves the file byte-identical", () => {
    const f = mkFixture("bad-policy-target");
    write(path.join(f.guildDir, "wiki", "index.md"), "# index\n");
    write(path.join(f.guildDir, "settings.json"), JSON.stringify({ rigor: "deep" }, null, 2));
    const target = f.storage.project!.config();
    const corrupt = '{ "rigor": "deep",,,\n';
    write(target, corrupt);

    const result = run(f);

    expect(stepStatus(result, "settings-policy-split")).toBe("blocked_confirm");
    expect(result.state).toBe("blocked_confirm");
    expect(result.marker_written).toBe(false);
    expect(fs.readFileSync(target, "utf8")).toBe(corrupt);
    // The operator gets the exact path AND the parser's own message.
    expect(result.question).toContain(".guild/config/project.json");
    expect(result.question).toContain("JSON at position");
    const entry = result.journal.entries.find((e) => e.step_id === "settings-policy-split");
    expect(entry?.detail).toContain("not parseable JSON");
    expect(entry?.paths).toEqual([".guild/config/project.json"]);
  });
});

describe("rework-r1 · P1-4 the KTD22 strip keeps the document's structure", () => {
  it("a sequence of `- host:` entries stays a sequence with the identity removed", () => {
    const f = mkFixture("yaml-sequence");
    write(path.join(f.guildDir, "wiki", "index.md"), "# index\n");
    const teamFile = path.join(f.guildDir, "team", "demo.build.yaml");
    write(
      teamFile,
      [
        "schema_version: guild.team.v1",
        "agents:",
        "  - host: codex-cli",
        "    role: backend",
        "  - host: claude-code",
        "    role: qa",
        "",
      ].join("\n"),
    );

    const result = run(f);
    expect(stepStatus(result, "ktd22-host-identity-strip")).toBe("completed");

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const yaml = require("js-yaml") as { load(t: string): unknown };
    const doc = yaml.load(fs.readFileSync(teamFile, "utf8")) as Record<string, unknown>;
    expect(Array.isArray(doc.agents)).toBe(true);
    expect(doc.agents).toEqual([{ role: "backend" }, { role: "qa" }]);
    expect(doc.schema_version).toBe("guild.team.v1");
  });

  it("a file with nothing to strip round-trips byte-identical", () => {
    const f = mkFixture("yaml-noop");
    write(path.join(f.guildDir, "wiki", "index.md"), "# index\n");
    const initiative = path.join(f.guildDir, "initiatives", "active", "demo.yaml");
    const original = "schema_version: guild.initiative.v1\nid: demo\nstatus: active\n";
    write(initiative, original);

    const result = run(f);
    expect(stepStatus(result, "ktd22-host-identity-strip")).toBe("skipped");
    expect(fs.readFileSync(initiative, "utf8")).toBe(original);
  });

  it("an unparseable YAML file blocks the step instead of rewriting it", () => {
    const f = mkFixture("yaml-bad");
    write(path.join(f.guildDir, "wiki", "index.md"), "# index\n");
    const bad = path.join(f.guildDir, "team", "broken.yaml");
    const original = "agents:\n  - host: codex-cli\n   role: bad-indent\n";
    write(bad, original);

    const result = run(f);
    expect(stepStatus(result, "ktd22-host-identity-strip")).toBe("blocked_confirm");
    expect(result.marker_written).toBe(false);
    expect(fs.readFileSync(bad, "utf8")).toBe(original);
  });
});

describe("rework-r1 · P1-5 terminal detection reads the RUN's own status", () => {
  it("an active run with a nested `status: done` task gets no receipt", () => {
    const f = mkFixture("nested-status");
    write(path.join(f.guildDir, "wiki", "index.md"), "# index\n");
    write(
      path.join(f.guildDir, "runs", "run-active", "run.yaml"),
      ["run_id: run-active", "status: active", "tasks:", "  - id: T01", "    status: done", ""].join("\n"),
    );
    write(path.join(f.guildDir, "runs", "run-closed", "run.yaml"), "run_id: run-closed\nstatus: done\n");

    const result = run(f);
    expect(fs.existsSync(path.join(f.guildDir, "runs", "run-active", "receipt.json"))).toBe(false);
    const receipt = JSON.parse(fs.readFileSync(path.join(f.guildDir, "runs", "run-closed", "receipt.json"), "utf8"));
    expect(receipt.status).toBe("done");
    expect(stepStatus(result, "closed-run-receipts")).toBe("completed");
  });
});

// ── rework-r2: the KTD22 strip is line-surgical ──────────────────────────────

/** Run the real step against one durable YAML file and return the bytes after. */
function stripOne(name: string, relPath: string, body: string) {
  const f = mkFixture(name);
  write(path.join(f.guildDir, "wiki", "index.md"), "# index\n");
  const abs = path.join(f.guildDir, relPath);
  write(abs, body);
  const result = run(f);
  return { f, abs, result, after: fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : null };
}

describe("rework-r2 · the KTD22 strip edits lines, it never re-emits the document", () => {
  it("a timestamp, a comment and the quoting style all survive byte-identical", () => {
    const body = [
      "# operator approval: 2026-09-12, see decision cap-loc-D12",
      "schema_version: guild.initiative.v1",
      "id: 'demo'",
      "created_at: 2026-09-15T19:15:00Z",
      "host: codex-cli          # pinned by the old runner",
      'title: "keep   my   spacing"',
      "",
    ].join("\n");
    const { result, after } = stripOne("r2-comments", "initiatives/active/demo.yaml", body);

    expect(stepStatus(result, "ktd22-host-identity-strip")).toBe("completed");
    // Exactly one line gone. Every other byte, including the date's raw form, the
    // single quotes, the double quotes and the standalone comment, is untouched.
    expect(after).toBe(
      [
        "# operator approval: 2026-09-12, see decision cap-loc-D12",
        "schema_version: guild.initiative.v1",
        "id: 'demo'",
        "created_at: 2026-09-15T19:15:00Z",
        // r3: the entry goes, its trailing comment stays at the same indentation.
        "# pinned by the old runner",
        'title: "keep   my   spacing"',
        "",
      ].join("\n"),
    );
    expect(after).toContain("created_at: 2026-09-15T19:15:00Z");
    expect(after).not.toContain("codex-cli");
  });

  it("a `- host:` item that carries nothing else is removed and the sequence stays a sequence", () => {
    const body = ["agents:", "  - host: codex-cli", "  - role: qa", ""].join("\n");
    const { result, after } = stripOne("r2-seq-bare", "team/demo.build.yaml", body);

    expect(stepStatus(result, "ktd22-host-identity-strip")).toBe("completed");
    expect(after).toBe(["agents:", "  - role: qa", ""].join("\n"));
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const yaml = require("js-yaml") as { load(t: string): unknown };
    expect((yaml.load(after!) as { agents: unknown }).agents).toEqual([{ role: "qa" }]);
  });

  it("a `- host:` item that carries more keys keeps them: the dash moves down one line", () => {
    const body = [
      "agents:",
      "  - host: codex-cli",
      "    role: backend   # owns the data layer",
      "  - host: claude-code",
      "    role: qa",
      "",
    ].join("\n");
    const { result, after } = stripOne("r2-seq-promote", "team/demo2.build.yaml", body);

    expect(stepStatus(result, "ktd22-host-identity-strip")).toBe("completed");
    expect(after).toBe(
      ["agents:", "  - role: backend   # owns the data layer", "  - role: qa", ""].join("\n"),
    );
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const yaml = require("js-yaml") as { load(t: string): unknown };
    expect((yaml.load(after!) as { agents: unknown }).agents).toEqual([{ role: "backend" }, { role: "qa" }]);
  });

  it("a mapping that empties gets an explicit `{}` rather than a dangling key", () => {
    const body = ["id: demo", "binding:", "  host: codex-cli", "status: active", ""].join("\n");
    const { after } = stripOne("r2-empty-map", "initiatives/active/b.yaml", body);
    expect(after).toBe(["id: demo", "binding: {}", "status: active", ""].join("\n"));
  });

  it("a sequence that empties gets an explicit `[]`", () => {
    const body = ["agents:", "  - host: codex-cli", "  - host: claude-code", "id: demo", ""].join("\n");
    const { after } = stripOne("r2-empty-seq", "team/c.build.yaml", body);
    expect(after).toBe(["agents: []", "id: demo", ""].join("\n"));
  });

  it("BLOCKS a flow-style mapping carrying identity — it is never rewritten", () => {
    const body = ["id: demo", "binding: {host: codex-cli, tier: mid}", ""].join("\n");
    const { result, after } = stripOne("r2-flow", "initiatives/active/d.yaml", body);

    expect(stepStatus(result, "ktd22-host-identity-strip")).toBe("blocked_confirm");
    expect(result.marker_written).toBe(false);
    expect(after).toBe(body);
    expect(result.question).toContain("flow-style mapping carries host/model identity");
  });

  it("BLOCKS an anchored offending node", () => {
    const body = ["defaults: &d", "  host: codex-cli", "agents:", "  - <<: *d", "    role: qa", ""].join("\n");
    const { result, after } = stripOne("r2-anchor", "team/e.build.yaml", body);

    expect(stepStatus(result, "ktd22-host-identity-strip")).toBe("blocked_confirm");
    expect(after).toBe(body);
    expect(result.question).toContain("anchor or alias");
  });

  it("a block scalar's content is never read as YAML", () => {
    const body = [
      "id: demo",
      "notes: |",
      "  host: codex-cli",
      "  this is prose, not a mapping",
      "host: codex-cli",
      "",
    ].join("\n");
    const { after } = stripOne("r2-block-scalar", "initiatives/active/f.yaml", body);
    expect(after).toBe(
      ["id: demo", "notes: |", "  host: codex-cli", "  this is prose, not a mapping", ""].join("\n"),
    );
  });

  it("a file with no identity is never rewritten at all", () => {
    const body = ["# a comment", "id: demo", "created_at: 2026-09-15T19:15:00Z", "tier: mid", ""].join("\n");
    const { result, after } = stripOne("r2-noop", "initiatives/active/g.yaml", body);
    expect(stepStatus(result, "ktd22-host-identity-strip")).toBe("skipped");
    expect(after).toBe(body);
  });
});

// ── rework-r3: block-scalar indent + comment preservation ────────────────────

describe("rework-r3 · a block scalar's indent comes from its KEY, not the dash", () => {
  it("the codex payload: the pin is removed, the block is byte-identical, the item survives", () => {
    const body = [
      "schema_version: guild.team.v1",
      "agents:",
      "  - notes: |",
      "      the operator pinned this lane to codex in 2026-08.",
      "      host: codex-cli   <- this line is prose, not a mapping",
      "    host: codex-cli",
      "    role: qa",
      "",
    ].join("\n");
    const { result, after } = stripOne("r3-codex", "team/codex.build.yaml", body);

    // r2 took the content indent from the dash column, so `host:` and `role:` at
    // the key column read as scalar text and the step reported `skipped`.
    expect(stepStatus(result, "ktd22-host-identity-strip")).toBe("completed");
    expect(after).toBe(
      [
        "schema_version: guild.team.v1",
        "agents:",
        "  - notes: |",
        "      the operator pinned this lane to codex in 2026-08.",
        "      host: codex-cli   <- this line is prose, not a mapping",
        "    role: qa",
        "",
      ].join("\n"),
    );
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const yaml = require("js-yaml") as { load(t: string): unknown };
    const doc = yaml.load(after!) as { agents: Array<Record<string, unknown>> };
    expect(Array.isArray(doc.agents)).toBe(true);
    expect(doc.agents[0].role).toBe("qa");
    expect(doc.agents[0].host).toBeUndefined();
    expect(doc.agents[0].notes).toContain("host: codex-cli   <- this line is prose");
  });

  it("a block scalar under a plain mapping key still protects only its own body", () => {
    const body = ["notes: |", "  host: codex-cli", "host: codex-cli", ""].join("\n");
    const { result, after } = stripOne("r3-plain-block", "initiatives/active/h.yaml", body);
    expect(stepStatus(result, "ktd22-host-identity-strip")).toBe("completed");
    expect(after).toBe(["notes: |", "  host: codex-cli", ""].join("\n"));
  });

  it("a `>` folded scalar behaves the same", () => {
    const body = ["summary: >", "  wrapped text about codex-cli", "host: codex-cli", ""].join("\n");
    const { after } = stripOne("r3-folded", "initiatives/active/i.yaml", body);
    expect(after).toBe(["summary: >", "  wrapped text about codex-cli", ""].join("\n"));
  });

  it("an explicit indentation indicator (`|2`) is honoured", () => {
    const body = ["notes: |2", "    two-space body", "host: codex-cli", ""].join("\n");
    const { after } = stripOne("r3-indicator", "initiatives/active/j.yaml", body);
    expect(after).toBe(["notes: |2", "    two-space body", ""].join("\n"));
  });
});

describe("codex r4 · the trailing-comment scanner honours YAML quoting and tabs", () => {
  const { splitInlineValue } = require("../../src/modules/state/workflows/upgrade-steps") as typeof import("../../src/modules/state/workflows/upgrade-steps");
  it("a doubled apostrophe inside a single-quoted value does not end the value", () => {
    const { value, comment } = splitInlineValue("'codex-cli''s binding' # operator: approval required");
    expect(value).toBe("codex-cli''s binding");
    expect(comment).toBe("# operator: approval required");
  });

  it("a TAB before `#` opens a comment exactly like a space", () => {
    const { value, comment } = splitInlineValue("codex-cli\t# operator: approval required");
    expect(value).toBe("codex-cli");
    expect(comment).toBe("# operator: approval required");
  });
});

describe("rework-r3 · a removed entry's trailing comment survives", () => {
  it("keeps the comment on its own line at the same indentation", () => {
    const body = [
      "id: demo",
      "host: codex-cli # operator: approval required before release",
      "role: qa",
      "",
    ].join("\n");
    const { after } = stripOne("r3-comment", "initiatives/active/k.yaml", body);
    expect(after).toBe(
      ["id: demo", "# operator: approval required before release", "role: qa", ""].join("\n"),
    );
  });

  it("moves the comment ABOVE the parent when the mapping collapses to `{}`", () => {
    const body = ["id: demo", "binding:", "  host: codex-cli # keep me", "status: active", ""].join("\n");
    const { after } = stripOne("r3-comment-empty", "initiatives/active/l.yaml", body);
    expect(after).toBe(["id: demo", "# keep me", "binding: {}", "status: active", ""].join("\n"));
  });

  it("keeps a removed sequence item's comment at the item's indentation", () => {
    const body = ["agents:", "  - host: codex-cli # why it was pinned", "  - role: qa", ""].join("\n");
    const { after } = stripOne("r3-comment-item", "team/m.build.yaml", body);
    expect(after).toBe(["agents:", "  # why it was pinned", "  - role: qa", ""].join("\n"));
  });

  it("a quoted value followed by a comment keeps the comment", () => {
    const body = ['host: "codex-cli"   # quoted then commented', "role: qa", ""].join("\n");
    const { after } = stripOne("r3-comment-quoted", "initiatives/active/n.yaml", body);
    expect(after).toBe(["# quoted then commented", "role: qa", ""].join("\n"));
  });

  it("a line with no comment is removed cleanly, leaving no blank", () => {
    const body = ["id: demo", "host: codex-cli", "role: qa", ""].join("\n");
    const { after } = stripOne("r3-no-comment", "initiatives/active/o.yaml", body);
    expect(after).toBe(["id: demo", "role: qa", ""].join("\n"));
  });
});

describe("rework-r3 · the comment self-check fails the step rather than losing a comment", () => {
  it("reports every comment in the document, block-scalar prose excluded", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const steps = require("../../src/modules/state/workflows/upgrade-steps") as typeof import("../../src/modules/state/workflows/upgrade-steps");
    const text = [
      "# top",
      "notes: |",
      "  # this is prose, not a comment",
      "host: codex-cli # trailing",
      "",
    ].join("\n");
    expect(steps.commentsIn(text)).toEqual(["# top", "# trailing"].sort());
  });

  it("an injected reader that loses a comment makes the strip refuse and report it", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const steps = require("../../src/modules/state/workflows/upgrade-steps") as typeof import("../../src/modules/state/workflows/upgrade-steps");
    const text = ["id: demo", "host: codex-cli # must survive", "role: qa", ""].join("\n");

    // Healthy reader: the strip proceeds and the comment is kept.
    const ok = steps.stripHostIdentityFromYaml(text, POLICY);
    expect(ok.lostComments).toBeUndefined();
    expect(ok.next).toContain("# must survive");

    // A reader that reports nothing after the edit is exactly what a future change
    // that dropped the comment would look like. The strip must refuse.
    let call = 0;
    const lossy = (value: string) => {
      call += 1;
      return call === 1 ? steps.commentsIn(value) : [];
    };
    const bad = steps.stripHostIdentityFromYaml(text, POLICY, lossy);
    expect(bad.lostComments).toEqual(["# must survive"]);
    expect(bad.removed).toEqual([]);
    expect(bad.next).toBe(text);
  });

  it("the parent's own trailing comment survives the `[]` collapse", () => {
    const body = ["agents:   # the lane roster", "  - host: codex-cli", "id: demo", ""].join("\n");
    const { result, after } = stripOne("r3-parent-comment", "team/q.build.yaml", body);
    expect(stepStatus(result, "ktd22-host-identity-strip")).toBe("completed");
    expect(after).toBe(["agents: []   # the lane roster", "id: demo", ""].join("\n"));
  });
});
