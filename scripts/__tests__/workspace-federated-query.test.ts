/**
 * scripts/__tests__/workspace-federated-query.test.ts
 *
 * TDD for scripts/workspace/federated-query.ts
 *
 * Tested:
 *   - fan-out plan: given a manifest + query, emits one step per sub_guild where has_wiki
 *   - each step includes the guild-memory invocation shape (tool, cwd, query)
 *   - sub_guilds where has_wiki=false are skipped
 *   - merge step: output includes a merge/tag step describing how to tag by sub_guild.name
 *   - read-only: no files written to workspace .guild/ or sub-guild .guild/
 *   - scoped query: passing --scope <name> restricts fan-out to that sub_guild only
 *   - exits 1 when no manifest found at --cwd
 *   - exits 1 when manifest has no sub_guilds with has_wiki=true (no-op query surfaced)
 */

import { spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const SCRIPT = path.resolve(__dirname, "../workspace/federated-query.ts");
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
  return fs.mkdtempSync(path.join(os.tmpdir(), "guild-ws-fq-"));
}

/** Writes a minimal guild.workspace.v1 manifest to <root>/.guild/workspace.json */
function seedManifest(
  root: string,
  subGuilds: Array<{
    name: string;
    path: string;
    kind: "sub-guild" | "sub-project";
    has_wiki: boolean;
    has_indexes: boolean;
    remote: string | null;
    last_seen_commit: string | null;
  }>
): void {
  fs.mkdirSync(path.join(root, ".guild"), { recursive: true });
  const manifest = {
    schema_version: "guild.workspace.v1",
    is_workspace: true,
    detected_at: new Date().toISOString(),
    detection: { depth: 1, rule: "immediate child has .git/ OR .guild/", mode: "auto" },
    root_wiki: false,
    sub_guilds: subGuilds,
    query_recipe: {
      mechanism: "guild-memory MCP wiki_search/wiki_get/wiki_list with per-call cwd override",
      fan_out: "iterate sub_guilds where has_wiki; merge results, tag each hit with sub_guild.name",
      example: "wiki_search({ query: '<q>', cwd: 'plugin' })",
    },
  };
  fs.writeFileSync(path.join(root, ".guild", "workspace.json"), JSON.stringify(manifest, null, 2));
}

describe("workspace/federated-query.ts — fan-out recall helper", () => {
  let tmpDirs: string[] = [];
  afterAll(() => tmpDirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));
  const mkRoot = () => {
    const d = mkTmp();
    tmpDirs.push(d);
    return d;
  };

  // ── Fan-out plan output ──────────────────────────────────────────────────────

  test("emits one query step per sub_guild where has_wiki=true", () => {
    const root = mkRoot();
    seedManifest(root, [
      { name: "plugin", path: "plugin", kind: "sub-guild", has_wiki: true, has_indexes: true, remote: null, last_seen_commit: null },
      { name: "benchmark", path: "benchmark", kind: "sub-guild", has_wiki: true, has_indexes: false, remote: null, last_seen_commit: null },
      { name: "website", path: "website", kind: "sub-project", has_wiki: false, has_indexes: false, remote: null, last_seen_commit: null },
    ]);
    const { status, out } = run(["--cwd", root, "--query", "architecture decisions"]);
    expect(status).toBe(0);
    const j = JSON.parse(out);
    expect(Array.isArray(j.steps)).toBe(true);
    const querySteps = j.steps.filter((s: { type: string }) => s.type === "query");
    expect(querySteps).toHaveLength(2); // plugin + benchmark (website has_wiki=false → skipped)
    const stepNames = querySteps.map((s: { sub_guild: string }) => s.sub_guild).sort();
    expect(stepNames).toEqual(["benchmark", "plugin"]);
  });

  test("sub_guilds with has_wiki=false are skipped entirely", () => {
    const root = mkRoot();
    seedManifest(root, [
      { name: "noWiki", path: "noWiki", kind: "sub-project", has_wiki: false, has_indexes: false, remote: null, last_seen_commit: null },
    ]);
    const { status, out } = run(["--cwd", root, "--query", "any question"]);
    expect(status).toBe(0);
    const j = JSON.parse(out);
    const querySteps = j.steps.filter((s: { type: string }) => s.type === "query");
    expect(querySteps).toHaveLength(0);
  });

  test("each query step contains tool, cwd (absolute), and query fields", () => {
    const root = mkRoot();
    seedManifest(root, [
      { name: "plugin", path: "plugin", kind: "sub-guild", has_wiki: true, has_indexes: false, remote: null, last_seen_commit: null },
    ]);
    const { out } = run(["--cwd", root, "--query", "init behavior"]);
    const j = JSON.parse(out);
    const step = j.steps.find((s: { type: string }) => s.type === "query");
    expect(step).toBeDefined();
    expect(step.tool).toBe("wiki_search");
    expect(typeof step.cwd).toBe("string");
    expect(step.cwd).toContain("plugin"); // cwd resolves to the sub-guild path
    expect(step.query).toBe("init behavior");
    expect(step.sub_guild).toBe("plugin");
  });

  test("output includes a merge+tag step after query steps", () => {
    const root = mkRoot();
    seedManifest(root, [
      { name: "plugin", path: "plugin", kind: "sub-guild", has_wiki: true, has_indexes: false, remote: null, last_seen_commit: null },
    ]);
    const { out } = run(["--cwd", root, "--query", "q"]);
    const j = JSON.parse(out);
    const mergeStep = j.steps.find((s: { type: string }) => s.type === "merge_and_tag");
    expect(mergeStep).toBeDefined();
    expect(typeof mergeStep.description).toBe("string");
    expect(mergeStep.description).toMatch(/tag|merge/i);
  });

  // ── --scope: restrict to one sub_guild ──────────────────────────────────────

  test("--scope <name> restricts fan-out to that sub_guild only", () => {
    const root = mkRoot();
    seedManifest(root, [
      { name: "plugin", path: "plugin", kind: "sub-guild", has_wiki: true, has_indexes: false, remote: null, last_seen_commit: null },
      { name: "benchmark", path: "benchmark", kind: "sub-guild", has_wiki: true, has_indexes: false, remote: null, last_seen_commit: null },
    ]);
    const { status, out } = run(["--cwd", root, "--query", "q", "--scope", "plugin"]);
    expect(status).toBe(0);
    const j = JSON.parse(out);
    const querySteps = j.steps.filter((s: { type: string }) => s.type === "query");
    expect(querySteps).toHaveLength(1);
    expect(querySteps[0].sub_guild).toBe("plugin");
  });

  test("--scope to unknown name emits warning and zero query steps", () => {
    const root = mkRoot();
    seedManifest(root, [
      { name: "plugin", path: "plugin", kind: "sub-guild", has_wiki: true, has_indexes: false, remote: null, last_seen_commit: null },
    ]);
    const { status, out, err } = run(["--cwd", root, "--query", "q", "--scope", "nonexistent"]);
    expect(status).toBe(0);
    const j = JSON.parse(out);
    const querySteps = j.steps.filter((s: { type: string }) => s.type === "query");
    expect(querySteps).toHaveLength(0);
    expect(err).toMatch(/nonexistent|not found/i);
  });

  // ── Read-only contract ───────────────────────────────────────────────────────

  test("read-only: federated-query writes no files anywhere", () => {
    const root = mkRoot();
    seedManifest(root, [
      { name: "plugin", path: "plugin", kind: "sub-guild", has_wiki: true, has_indexes: false, remote: null, last_seen_commit: null },
    ]);
    const guildBefore = fs.readdirSync(path.join(root, ".guild")).sort();
    run(["--cwd", root, "--query", "anything"]);
    const guildAfter = fs.readdirSync(path.join(root, ".guild")).sort();
    // Only workspace.json should be present — nothing added by federated-query
    expect(guildAfter).toEqual(guildBefore);
  });

  // ── Error paths ──────────────────────────────────────────────────────────────

  test("exits 1 when no workspace.json found at --cwd", () => {
    const root = mkRoot();
    // No manifest seeded
    const { status } = run(["--cwd", root, "--query", "q"]);
    expect(status).toBe(1);
  });

  test("exits 0 but warns when manifest has no sub_guilds with has_wiki=true", () => {
    const root = mkRoot();
    seedManifest(root, [
      { name: "p", path: "p", kind: "sub-project", has_wiki: false, has_indexes: false, remote: null, last_seen_commit: null },
    ]);
    const { status, out, err } = run(["--cwd", root, "--query", "q"]);
    expect(status).toBe(0);
    const j = JSON.parse(out);
    expect(j.steps.filter((s: { type: string }) => s.type === "query")).toHaveLength(0);
    // Should warn that no wikis are available
    expect(err + out).toMatch(/no.*wiki|0.*sub[_-]guild/i);
  });

  test("exits 1 when --query is missing", () => {
    const root = mkRoot();
    seedManifest(root, []);
    const { status } = run(["--cwd", root]); // no --query arg
    expect(status).toBe(1);
  });
});
