/**
 * scripts/__tests__/workspace-detect.test.ts
 *
 * TDD for scripts/workspace/detect.ts
 *
 * Detection matrix tested:
 *   - regular repo (no children with .git or .guild) → kind: regular
 *   - workspace by .git in child → kind: workspace
 *   - workspace by .guild in child → kind: workspace
 *   - workspace by mixed (some .git, some .guild, some plain) → kind: workspace
 *   - plain dirs (no .git, no .guild) → ignored, not in sub_guilds
 *   - mode: on  → forces workspace regardless of children
 *   - mode: off → forces regular regardless of children
 *   - mode: auto → uses the rule (default)
 *   - sub_guilds entry: kind = "sub-guild" (has .guild/), "sub-project" (has .git, no .guild/)
 *   - sub_guilds entry: has_wiki true iff <child>/.guild/wiki/ exists
 *   - sub_guilds entry: has_indexes true iff <child>/.guild/indexes/ exists
 *   - depth is strictly 1: grandchildren never classified
 */

import { spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const SCRIPT = path.resolve(__dirname, "../workspace/detect.ts");
const NODE_ENV = { ...process.env, NODE_NO_WARNINGS: "1", PATH: "/opt/homebrew/bin:/usr/bin:/bin" } as NodeJS.ProcessEnv;

function run(args: string[]): { status: number; out: string; err: string } {
  const r = spawnSync("npx", ["tsx", SCRIPT, ...args], {
    encoding: "utf8",
    env: NODE_ENV,
    timeout: 30000,
  });
  return { status: r.status ?? -1, out: r.stdout ?? "", err: r.stderr ?? "" };
}

/** Creates a temp dir; caller is responsible for cleanup. */
function mkTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "guild-ws-detect-"));
}

/** Seed a child directory inside root. Options control what markers to drop. */
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

describe("workspace/detect.ts — detection matrix", () => {
  let tmpDirs: string[] = [];
  afterAll(() => tmpDirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));
  const mkRoot = () => {
    const d = mkTmp();
    tmpDirs.push(d);
    return d;
  };

  // ── Regular repo ────────────────────────────────────────────────────────────

  test("regular repo (no children with .git/.guild) → kind: regular, sub_guilds: []", () => {
    const root = mkRoot();
    seedChild(root, "docs"); // plain dir only
    seedChild(root, "src"); // plain dir only
    const { status, out } = run(["--cwd", root]);
    expect(status).toBe(0);
    const j = JSON.parse(out);
    expect(j.kind).toBe("regular");
    expect(j.sub_guilds).toEqual([]);
  });

  test("empty root → kind: regular", () => {
    const root = mkRoot();
    const { status, out } = run(["--cwd", root]);
    expect(status).toBe(0);
    const j = JSON.parse(out);
    expect(j.kind).toBe("regular");
  });

  // ── Workspace by .git in child ───────────────────────────────────────────────

  test("workspace-by-git: one child with .git → kind: workspace, sub_guilds contains it", () => {
    const root = mkRoot();
    seedChild(root, "plugin", { git: true });
    const { status, out } = run(["--cwd", root]);
    expect(status).toBe(0);
    const j = JSON.parse(out);
    expect(j.kind).toBe("workspace");
    expect(j.sub_guilds).toHaveLength(1);
    expect(j.sub_guilds[0].name).toBe("plugin");
    expect(j.sub_guilds[0].path).toBe("plugin");
    expect(j.sub_guilds[0].kind).toBe("sub-project"); // has .git, no .guild
  });

  // ── Workspace by .guild in child ─────────────────────────────────────────────

  test("workspace-by-guild: one child with .guild (no .git) → kind: workspace, kind=sub-guild", () => {
    const root = mkRoot();
    seedChild(root, "pkg", { guild: true });
    const { status, out } = run(["--cwd", root]);
    expect(status).toBe(0);
    const j = JSON.parse(out);
    expect(j.kind).toBe("workspace");
    expect(j.sub_guilds[0].kind).toBe("sub-guild"); // has .guild
    expect(j.sub_guilds[0].name).toBe("pkg");
  });

  // ── Mixed children ───────────────────────────────────────────────────────────

  test("mixed children: .git-only, .guild-only, .git+.guild, plain — plain dirs ignored", () => {
    const root = mkRoot();
    seedChild(root, "a", { git: true });                    // sub-project
    seedChild(root, "b", { guild: true });                  // sub-guild (no git)
    seedChild(root, "c", { git: true, guild: true });       // sub-guild (both)
    seedChild(root, "docs");                                // plain — must be ignored
    const { status, out } = run(["--cwd", root]);
    expect(status).toBe(0);
    const j = JSON.parse(out);
    expect(j.kind).toBe("workspace");
    const names = j.sub_guilds.map((sg: { name: string }) => sg.name).sort();
    expect(names).toEqual(["a", "b", "c"]); // docs excluded
    const byName = Object.fromEntries(j.sub_guilds.map((sg: { name: string; kind: string }) => [sg.name, sg.kind]));
    expect(byName["a"]).toBe("sub-project");
    expect(byName["b"]).toBe("sub-guild");
    expect(byName["c"]).toBe("sub-guild"); // .guild wins if both present
  });

  // ── sub_guilds entry shape ───────────────────────────────────────────────────

  test("sub_guilds entry: has_wiki true iff <child>/.guild/wiki/ exists", () => {
    const root = mkRoot();
    seedChild(root, "withWiki", { git: true, guild: true, wiki: true });
    seedChild(root, "noWiki", { git: true, guild: true });
    const { out } = run(["--cwd", root]);
    const j = JSON.parse(out);
    const byName = Object.fromEntries(j.sub_guilds.map((sg: { name: string; has_wiki: boolean }) => [sg.name, sg.has_wiki]));
    expect(byName["withWiki"]).toBe(true);
    expect(byName["noWiki"]).toBe(false);
  });

  test("sub_guilds entry: has_indexes true iff <child>/.guild/indexes/ exists", () => {
    const root = mkRoot();
    seedChild(root, "withIdx", { git: true, guild: true, indexes: true });
    seedChild(root, "noIdx", { git: true, guild: true });
    const { out } = run(["--cwd", root]);
    const j = JSON.parse(out);
    const byName = Object.fromEntries(
      j.sub_guilds.map((sg: { name: string; has_indexes: boolean }) => [sg.name, sg.has_indexes])
    );
    expect(byName["withIdx"]).toBe(true);
    expect(byName["noIdx"]).toBe(false);
  });

  test("sub_guilds entry: last_seen_commit is string or null (never throws)", () => {
    const root = mkRoot();
    seedChild(root, "p", { git: true });
    const { out } = run(["--cwd", root]);
    const j = JSON.parse(out);
    const sg = j.sub_guilds[0];
    expect(sg.last_seen_commit === null || typeof sg.last_seen_commit === "string").toBe(true);
  });

  test("sub_guilds entry: remote is string or null (best-effort, never throws)", () => {
    const root = mkRoot();
    seedChild(root, "p", { git: true });
    const { out } = run(["--cwd", root]);
    const j = JSON.parse(out);
    const sg = j.sub_guilds[0];
    expect(sg.remote === null || typeof sg.remote === "string").toBe(true);
  });

  // ── mode: on | off | auto ────────────────────────────────────────────────────

  test("mode: on forces workspace even when no children qualify", () => {
    const root = mkRoot();
    seedChild(root, "docs"); // plain, no .git/.guild
    const { status, out } = run(["--cwd", root, "--mode", "on"]);
    expect(status).toBe(0);
    const j = JSON.parse(out);
    expect(j.kind).toBe("workspace");
    expect(j.detection.mode).toBe("on");
  });

  test("mode: off forces regular even when children have .git", () => {
    const root = mkRoot();
    seedChild(root, "plugin", { git: true });
    const { status, out } = run(["--cwd", root, "--mode", "off"]);
    expect(status).toBe(0);
    const j = JSON.parse(out);
    expect(j.kind).toBe("regular");
    expect(j.detection.mode).toBe("off");
  });

  test("mode: auto (default) uses the detection rule", () => {
    const root = mkRoot();
    seedChild(root, "plugin", { git: true });
    const { status, out } = run(["--cwd", root, "--mode", "auto"]);
    expect(status).toBe(0);
    const j = JSON.parse(out);
    expect(j.kind).toBe("workspace");
    expect(j.detection.mode).toBe("auto");
  });

  // ── depth = 1 strictly ───────────────────────────────────────────────────────

  test("depth strictly 1: grandchildren with .git never cause workspace classification", () => {
    const root = mkRoot();
    const child = seedChild(root, "plain"); // plain dir
    // place a grandchild with .git inside plain dir
    fs.mkdirSync(path.join(child, "grandchild", ".git"), { recursive: true });
    const { out } = run(["--cwd", root]);
    const j = JSON.parse(out);
    // plain has no .git/.guild at depth-1 → not in sub_guilds → root is regular
    expect(j.kind).toBe("regular");
    expect(j.sub_guilds).toEqual([]);
  });

  // ── detection output shape ───────────────────────────────────────────────────

  test("detection block has depth=1, rule, and mode fields", () => {
    const root = mkRoot();
    const { out } = run(["--cwd", root]);
    const j = JSON.parse(out);
    expect(j.detection.depth).toBe(1);
    expect(typeof j.detection.rule).toBe("string");
    expect(j.detection.mode).toBe("auto");
  });

  // ── settings.json workspace.mode override ────────────────────────────────────

  test("settings.json workspace.mode=off overrides auto detection (forces regular)", () => {
    const root = mkRoot();
    seedChild(root, "plugin", { git: true });
    fs.mkdirSync(path.join(root, ".guild"), { recursive: true });
    fs.writeFileSync(
      path.join(root, ".guild", "settings.json"),
      JSON.stringify({ workspace: { mode: "off" } }, null, 2)
    );
    const { status, out } = run(["--cwd", root]);
    expect(status).toBe(0);
    const j = JSON.parse(out);
    expect(j.kind).toBe("regular");
    expect(j.detection.mode).toBe("off");
  });

  test("settings.json workspace.mode=on forces workspace even on empty root", () => {
    const root = mkRoot();
    fs.mkdirSync(path.join(root, ".guild"), { recursive: true });
    fs.writeFileSync(
      path.join(root, ".guild", "settings.json"),
      JSON.stringify({ workspace: { mode: "on" } }, null, 2)
    );
    const { status, out } = run(["--cwd", root]);
    expect(status).toBe(0);
    const j = JSON.parse(out);
    expect(j.kind).toBe("workspace");
  });
});
