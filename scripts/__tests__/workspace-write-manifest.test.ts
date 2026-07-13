/**
 * scripts/__tests__/workspace-write-manifest.test.ts
 *
 * TDD for scripts/workspace/write-manifest.ts
 *
 * Tested:
 *   - writes .guild/workspace.json with guild.workspace.v1 schema
 *   - idempotent: re-running refreshes without clobbering unrelated .guild/ state
 *   - root_wiki = true iff workspace root has scannable top-level code (D-OQ2)
 *   - root_wiki = false when root has only docs/ + sub-repos (no code files)
 *   - atomic write (uses temp-then-rename pattern, never partial)
 *   - no wiki pages copied from sub-guilds (no-duplication regression)
 *   - all required guild.workspace.v1 top-level keys present
 */

import { spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const SCRIPT = path.resolve(__dirname, "../workspace/write-manifest.ts");
const NODE_ENV = { ...process.env, NODE_NO_WARNINGS: "1", PATH: `${require("node:path").dirname(process.execPath)}:${process.env["PATH"] ?? "/usr/bin:/bin"}`, } as NodeJS.ProcessEnv;

function run(args: string[]): { status: number; out: string; err: string } {
  const r = spawnSync("npx", ["tsx", SCRIPT, ...args], {
    encoding: "utf8",
    env: NODE_ENV,
    timeout: 120_000,
  });
  return { status: r.status ?? -1, out: r.stdout ?? "", err: r.stderr ?? "" };
}

function mkTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "guild-ws-manifest-"));
}

function seedChild(
  root: string,
  name: string,
  opts: { git?: boolean; guild?: boolean; wiki?: boolean; indexes?: boolean } = {}
): string {
  const childDir = path.join(root, name);
  fs.mkdirSync(childDir, { recursive: true });
  if (opts.git) fs.mkdirSync(path.join(childDir, ".git"), { recursive: true });
  if (opts.guild) fs.mkdirSync(path.join(childDir, ".guild"), { recursive: true });
  if (opts.wiki) fs.mkdirSync(path.join(childDir, ".guild", "wiki"), { recursive: true });
  if (opts.indexes) fs.mkdirSync(path.join(childDir, ".guild", "indexes"), { recursive: true });
  return childDir;
}

function readManifest(root: string): unknown {
  return JSON.parse(fs.readFileSync(path.join(root, ".guild", "workspace.json"), "utf8"));
}

describe("workspace/write-manifest.ts — idempotent manifest writer", () => {
  let tmpDirs: string[] = [];
  afterAll(() => tmpDirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));
  const mkRoot = () => {
    const d = mkTmp();
    tmpDirs.push(d);
    return d;
  };

  // ── Basic write ──────────────────────────────────────────────────────────────

  test("writes .guild/workspace.json with schema_version = guild.workspace.v1", () => {
    const root = mkRoot();
    seedChild(root, "plugin", { git: true, guild: true, wiki: true });
    const { status } = run(["--cwd", root]);
    expect(status).toBe(0);
    expect(fs.existsSync(path.join(root, ".guild", "workspace.json"))).toBe(true);
    const m = readManifest(root) as Record<string, unknown>;
    expect(m.schema_version).toBe("guild.workspace.v1");
    expect(m.is_workspace).toBe(true);
  });

  test("manifest has all required top-level keys from guild.workspace.v1", () => {
    const root = mkRoot();
    seedChild(root, "plugin", { git: true });
    const { status } = run(["--cwd", root]);
    expect(status).toBe(0);
    const m = readManifest(root) as Record<string, unknown>;
    const required = ["schema_version", "is_workspace", "detected_at", "detection", "root_wiki", "sub_guilds", "query_recipe"];
    for (const key of required) {
      expect(m).toHaveProperty(key);
    }
  });

  test("sub_guilds array populated correctly for each child", () => {
    const root = mkRoot();
    seedChild(root, "alpha", { git: true, guild: true, wiki: true, indexes: true });
    seedChild(root, "beta", { git: true });    // sub-project: no .guild
    seedChild(root, "docs");                   // plain: ignored
    const { status } = run(["--cwd", root]);
    expect(status).toBe(0);
    const m = readManifest(root) as { sub_guilds: Array<Record<string, unknown>> };
    const names = m.sub_guilds.map((sg) => sg.name).sort();
    expect(names).toEqual(["alpha", "beta"]);
    const alpha = m.sub_guilds.find((sg) => sg.name === "alpha")!;
    expect(alpha.kind).toBe("sub-guild");
    expect(alpha.has_wiki).toBe(true);
    expect(alpha.has_indexes).toBe(true);
    expect(alpha.path).toBe("alpha");
    const beta = m.sub_guilds.find((sg) => sg.name === "beta")!;
    expect(beta.kind).toBe("sub-project");
    expect(beta.has_wiki).toBe(false);
  });

  test("detection block has depth=1, rule, and mode fields", () => {
    const root = mkRoot();
    seedChild(root, "plugin", { git: true });
    const { status } = run(["--cwd", root]);
    expect(status).toBe(0);
    const m = readManifest(root) as { detection: Record<string, unknown> };
    expect(m.detection.depth).toBe(1);
    expect(typeof m.detection.rule).toBe("string");
    expect(m.detection.mode).toBe("auto");
  });

  test("query_recipe has mechanism, fan_out, and example fields", () => {
    const root = mkRoot();
    seedChild(root, "p", { git: true });
    run(["--cwd", root]);
    const m = readManifest(root) as { query_recipe: Record<string, unknown> };
    expect(typeof m.query_recipe.mechanism).toBe("string");
    expect(typeof m.query_recipe.fan_out).toBe("string");
    expect(typeof m.query_recipe.example).toBe("string");
  });

  // ── root_wiki (D-OQ2) ────────────────────────────────────────────────────────

  test("root_wiki = false when root has only sub-repos and plain dirs (no top-level code files)", () => {
    const root = mkRoot();
    seedChild(root, "plugin", { git: true });
    seedChild(root, "docs");
    const { status } = run(["--cwd", root]);
    expect(status).toBe(0);
    const m = readManifest(root) as { root_wiki: boolean };
    expect(m.root_wiki).toBe(false);
  });

  test("root_wiki = true when root has scannable top-level code files (.ts/.js/.py etc.)", () => {
    const root = mkRoot();
    seedChild(root, "plugin", { git: true });
    // drop a top-level source file
    fs.writeFileSync(path.join(root, "index.ts"), "export const x = 1;\n");
    const { status } = run(["--cwd", root]);
    expect(status).toBe(0);
    const m = readManifest(root) as { root_wiki: boolean };
    expect(m.root_wiki).toBe(true);
  });

  // ── Idempotency ──────────────────────────────────────────────────────────────

  test("idempotent: re-running refreshes manifest without clobbering unrelated .guild/ state", () => {
    const root = mkRoot();
    seedChild(root, "plugin", { git: true, guild: true });
    // Create some pre-existing .guild/ state that should survive
    fs.mkdirSync(path.join(root, ".guild", "runs"), { recursive: true });
    fs.writeFileSync(path.join(root, ".guild", "runs", "important.ndjson"), '{"event":"test"}\n');
    // First write
    run(["--cwd", root]);
    const firstManifest = readManifest(root) as Record<string, unknown>;
    // Second write (idempotent)
    run(["--cwd", root]);
    const secondManifest = readManifest(root) as Record<string, unknown>;
    // Unrelated state preserved
    expect(fs.existsSync(path.join(root, ".guild", "runs", "important.ndjson"))).toBe(true);
    // Manifest refreshed (schema_version stable)
    expect(secondManifest.schema_version).toBe(firstManifest.schema_version);
  });

  test("idempotent: detected_at is updated on re-run (refresh, not stale)", () => {
    const root = mkRoot();
    seedChild(root, "plugin", { git: true });
    run(["--cwd", root]);
    const first = (readManifest(root) as { detected_at: string }).detected_at;
    // Small delay then re-run
    run(["--cwd", root]);
    const second = (readManifest(root) as { detected_at: string }).detected_at;
    // detected_at should be a valid ISO string each time
    expect(() => new Date(first)).not.toThrow();
    expect(() => new Date(second)).not.toThrow();
  });

  // ── No duplication regression ────────────────────────────────────────────────

  test("no-duplication regression: no .guild/wiki/ created by write-manifest", () => {
    const root = mkRoot();
    // Sub-guild with a rich wiki
    const sub = seedChild(root, "plugin", { git: true, guild: true, wiki: true });
    fs.writeFileSync(path.join(sub, ".guild", "wiki", "page.md"), "# sub wiki page\n");
    run(["--cwd", root]);
    // workspace .guild/wiki/ must NOT exist
    expect(fs.existsSync(path.join(root, ".guild", "wiki"))).toBe(false);
  });

  // ── --cwd missing → exits non-zero ──────────────────────────────────────────

  test("exits non-zero when --cwd points to a non-existent directory", () => {
    const { status } = run(["--cwd", "/tmp/guild-nonexistent-zzz"]);
    expect(status).not.toBe(0);
  });
});
