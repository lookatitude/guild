/**
 * G12 R7 — the COMPILED knowledge-links-traverse CLI (runtime/scripts/
 * knowledge-links-traverse.js, compile.ts entry) under node, the way the
 * learning-checkpoint step runs it. Advisory: always exits 0; the JSON
 * `connected` field carries the VC-K2 verdict.
 */

import { describe, it, expect, afterAll } from "bun:test";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const CLI = path.resolve(__dirname, "..", "runtime", "scripts", "knowledge-links-traverse.js");
const TEMP_DIRS: string[] = [];
afterAll(() => {
  for (const d of TEMP_DIRS) fs.rmSync(d, { recursive: true, force: true });
});

interface Link { from: string; to: string; type: string; run_id: string; tombstoned?: boolean }

function repoWith(links: Link[] | null): string {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "guild-kl-traverse-"));
  TEMP_DIRS.push(repo);
  fs.mkdirSync(path.join(repo, ".guild", "indexes"), { recursive: true });
  if (links) {
    fs.writeFileSync(
      path.join(repo, ".guild", "indexes", "knowledge-links.json"),
      JSON.stringify({ schema_version: "guild.knowledge_links.v1", links }),
    );
  }
  return repo;
}

function run(args: string[]): { code: number | null; out: Record<string, unknown> } {
  const r = spawnSync("node", [CLI, ...args], { encoding: "utf8" });
  return { code: r.status, out: JSON.parse(r.stdout.trim()) };
}

const FULL: Link[] = [
  { from: "task:T1", to: "decision:cache", type: "constrains", run_id: "r1" },
  { from: "task:T1", to: "skill:plan", type: "used_for", run_id: "r1" },
  { from: "task:T1", to: "component:recall", type: "touches", run_id: "r1" },
  { from: "component:recall", to: "wiki:recall-page", type: "learned_from", run_id: "r1" },
];

describe("G12 R7 — compiled knowledge-links-traverse CLI", () => {
  it("the compiled entry exists", () => {
    expect(fs.existsSync(CLI)).toBe(true);
  });

  it("reports connected when the task reaches all 4 VC-K2 kinds (wiki via a 2-hop path)", () => {
    const { code, out } = run(["--cwd", repoWith(FULL), "--task-id", "task:T1"]);
    expect(code).toBe(0);
    expect(out.connected).toBe(true);
    expect(out.reachable_kinds).toEqual(["decision", "feature_component", "skill_agent", "wiki"]);
    expect(out.missing_kinds).toEqual([]);
  });

  it("negative: a missing kind is reported, not connected", () => {
    const { out } = run(["--cwd", repoWith(FULL.slice(0, 3)), "--task-id", "task:T1"]);
    expect(out.connected).toBe(false);
    expect(out.missing_kinds).toEqual(["wiki"]);
  });

  it("negative: a tombstoned edge no longer connects its endpoint", () => {
    const links = FULL.map((l) => (l.to === "decision:cache" ? { ...l, tombstoned: true } : l));
    const { out } = run(["--cwd", repoWith(links), "--task-id", "task:T1"]);
    expect(out.connected).toBe(false);
    expect(out.missing_kinds).toEqual(["decision"]);
  });

  it("an unknown task id reaches nothing", () => {
    const { out } = run(["--cwd", repoWith(FULL), "--task-id", "task:nope"]);
    expect(out.connected).toBe(false);
    expect(out.reachable_kinds).toEqual([]);
  });

  it("absent knowledge-links.json → not connected with a note, exit 0", () => {
    const { code, out } = run(["--cwd", repoWith(null), "--task-id", "task:T1"]);
    expect(code).toBe(0);
    expect(out.connected).toBe(false);
    expect(out.note).toBe("no knowledge-links.json found");
  });

  it("missing --task-id → error JSON, still exit 0 (advisory)", () => {
    const { code, out } = run(["--cwd", repoWith(FULL)]);
    expect(code).toBe(0);
    expect(out.error).toBe("missing --task-id");
  });
});
