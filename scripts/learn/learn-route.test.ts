/**
 * learn-route.test.ts — the compiled `/guild:learn` router CLI on real fixture
 * roots: brownfield reaches the full pipeline, greenfield the cheap map, a
 * workspace its fan-out flow, and a sub-verb never reads the root.
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { spawnSync } from "child_process";

import { readLearnTargetFacts } from "./learn-route";

const PLUGIN_ROOT = path.resolve(__dirname, "..", "..");
const BUNDLE = path.join(PLUGIN_ROOT, "runtime", "scripts", "learn-route.js");

let sandbox: string;

function write(file: string, body = "x\n"): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
}

function gitInit(dir: string): void {
  spawnSync("git", ["init", "-q", dir], { stdio: "ignore" });
  spawnSync("git", ["-C", dir, "add", "-A"], { stdio: "ignore" });
}

function route(cwd: string, ...tokens: string[]): { status: number | null; out: Record<string, unknown> } {
  const r = spawnSync("node", [BUNDLE, "--cwd", cwd, "--", ...tokens], { encoding: "utf8" });
  return { status: r.status, out: r.status === 0 ? JSON.parse(r.stdout) : {} };
}

beforeAll(() => {
  sandbox = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "guild-learn-route-")));

  const brown = path.join(sandbox, "brownfield");
  for (let i = 0; i < 8; i++) write(path.join(brown, "src", `m${i}.ts`));
  write(path.join(brown, ".guild", "guild.yaml"), "kind: project\n");
  gitInit(brown);

  fs.mkdirSync(path.join(sandbox, "greenfield"));

  const ws = path.join(sandbox, "workspace");
  write(path.join(ws, "AGENTS.md"));
  write(path.join(ws, "a", ".guild", "guild.yaml"));
  write(path.join(ws, "b", ".guild", "guild.yaml"));

  const planOnly = path.join(sandbox, "plan-only");
  write(path.join(planOnly, "a", ".guild", "guild.yaml"));
  write(path.join(planOnly, ".guild", "workspace.json"), JSON.stringify({ learn_fanout: "plan-only" }));
});

afterAll(() => {
  fs.rmSync(sandbox, { recursive: true, force: true });
});

describe("readLearnTargetFacts", () => {
  it("counts git-tracked files and sees a populated .guild/", () => {
    const f = readLearnTargetFacts(path.join(sandbox, "brownfield"));
    expect(f.has_git).toBe(true);
    expect(f.guild_dir).toBe("populated");
    expect(f.tracked_files).toBeGreaterThan(5);
    expect(f.detection.kind).toBe("regular");
  });

  it("an empty dir is absent .guild/ with zero files", () => {
    const f = readLearnTargetFacts(path.join(sandbox, "greenfield"));
    expect(f).toMatchObject({ has_git: false, guild_dir: "absent", wiki_populated: false, tracked_files: 0 });
  });
});

describe("compiled learn-route CLI", () => {
  it("the bundle is committed", () => {
    expect(fs.existsSync(BUNDLE)).toBe(true);
  });

  it("bare on brownfield -> full_learn reaching K1-K6 after the OQ1 gate", () => {
    const r = route(path.join(sandbox, "brownfield"));
    expect(r.status).toBe(0);
    expect(r.out).toMatchObject({ route: "full_learn", target_kind: "regular_project", knowledge_tier: "after_oq1_gate" });
  });

  it("bare on greenfield -> cheap_map_only", () => {
    const r = route(path.join(sandbox, "greenfield"));
    expect(r.out).toMatchObject({ route: "cheap_map_only", target_kind: "new_or_sparse_project", knowledge_tier: "not_run" });
  });

  it("bare on a workspace -> workspace_full_learn with K1-K6 deferred", () => {
    const r = route(path.join(sandbox, "workspace"));
    expect(r.out).toMatchObject({ route: "workspace_full_learn", target_kind: "workspace", knowledge_tier: "deferred" });
  });

  it("learn_fanout plan-only in workspace.json -> workspace_plan_only", () => {
    expect(route(path.join(sandbox, "plan-only")).out.route).toBe("workspace_plan_only");
  });

  it("inner --cwd overrides the root", () => {
    const r = route(sandbox, "--cwd", "greenfield");
    expect(r.out).toMatchObject({ route: "cheap_map_only", root: path.join(sandbox, "greenfield") });
  });

  it("a sub-verb routes to its chapter even when the root has no facts to read", () => {
    const r = route(path.join(sandbox, "greenfield"), "explain", "src/a.ts");
    expect(r.out).toMatchObject({ route: "chapter", chapter: "explain", chapter_file: "references/learn-explain.md", forward: ["src/a.ts"] });
  });

  it("unknown token -> usage with exit 0", () => {
    const r = route(path.join(sandbox, "brownfield"), "bogus");
    expect(r.status).toBe(0);
    expect(r.out).toMatchObject({ route: "usage", token: "bogus" });
  });

  it("an inner --cwd with no value -> exit 1, never the current root", () => {
    expect(route(path.join(sandbox, "brownfield"), "--cwd").status).toBe(1);
    expect(route(path.join(sandbox, "brownfield"), "--cwd", "", ".").status).toBe(1);
  });

  it("an outer --cwd with no value -> exit 1", () => {
    expect(spawnSync("node", [BUNDLE, "--cwd"], { encoding: "utf8" }).status).toBe(1);
  });

  it("missing root -> exit 1", () => {
    expect(route(path.join(sandbox, "nope")).status).toBe(1);
  });
});
