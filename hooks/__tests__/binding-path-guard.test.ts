/**
 * CD21 binding-path guard — the lexical matcher behind binding_path_refused.
 * In-process: the real-hook path is covered by tests/e00 (frozen CD21 + H1-F3).
 */
import { describe, it, expect } from "bun:test";

import { BINDING_GUARD_LIMITS, laneBindingPathTarget } from "../lib/security/binding-path-guard";

const LANE = { GUILD_TASK_ID: "T1" } as NodeJS.ProcessEnv;
const ROOT = "/repo";
const denied = (tool: string, input: Record<string, unknown>, env = LANE) => laneBindingPathTarget(env, tool, input) !== null;

describe("binding-path guard · denies forms that can resolve to a run binding", () => {
  const cases: Array<[string, Record<string, unknown>]> = [
    ["Read", { file_path: "/repo/.guild/runs/r1/binding.json" }],
    ["Read", { file_path: "/repo/.GUILD/Runs/r1/BINDING.JSON" }],
    ["Read", { file_path: "/repo/./.guild//runs/r1/x/../binding.json" }],
    ["Read", { file_path: "C:\\repo\\.guild\\runs\\r1\\binding.json" }],
    ["Write", { file_path: "/repo/.guild/runs/r1/binding.json", content: "{}" }],
    ["Glob", { pattern: "**", path: "/repo/.guild/runs" }],
    ["Glob", { pattern: ".guild/runs/*/{a,b,binding}.json", path: ROOT }],
    ["Glob", { pattern: ".guild/runs/*/[!x]inding.json", path: ROOT }],
    ["Glob", { pattern: "/repo/.guild/runs/r1/b*" }],
    ["Grep", { pattern: "x", path: "/repo/.guild/runs/r1", glob: "*.json" }],
    ["Grep", { pattern: "x", path: ROOT, glob: ".guild/runs/*/binding.*" }],
    ["Bash", { command: "cat '.guild/runs/r1/binding.json'" }],
    ["Bash", { command: 'cat ".guild/runs/r1/"binding.json' }],
    ["Bash", { command: "cat .guild/runs/r1/bind\\ing.json" }],
    ["Bash", { command: "jq . --file=.guild/runs/r1/binding.json" }],
    ["Bash", { command: "cd .guild/runs/r1 && cat binding.json" }],
    ["Bash", { command: "find .guild/runs -name 'binding*'" }],
  ];
  for (const [tool, input] of cases) {
    it(`${tool} ${JSON.stringify(input)}`, () => expect(denied(tool, input)).toBe(true));
  }
});

describe("binding-path guard · leaves near matches and unrelated inputs alone", () => {
  const cases: Array<[string, Record<string, unknown>]> = [
    ["Read", { file_path: "/repo/.guild/runs/r1/binding-notes.md" }],
    ["Read", { file_path: "/repo/.guild/runs/r1/binding.json.bak" }],
    ["Read", { file_path: "/repo/notes/runs/r1/binding.json" }],
    ["Glob", { pattern: ".guild/runs/*/run*.yaml", path: ROOT }],
    ["Glob", { pattern: ".guild/runs/*", path: ROOT }],
    ["Grep", { pattern: "binding.json", path: "/repo/src" }],
    ["Grep", { pattern: "x", path: "/repo/.guild/runs/r1", glob: "*.yaml" }],
    ["Bash", { command: "ls .guild/runs/*" }],
    ["Bash", { command: "cat .guild/runs/*/run.yaml" }],
    ["Bash", { command: "git status" }],
  ];
  for (const [tool, input] of cases) {
    it(`${tool} ${JSON.stringify(input)}`, () => expect(denied(tool, input)).toBe(false));
  }
});

describe("binding-path guard · scope", () => {
  it("only lane workers are guarded", () => {
    expect(denied("Read", { file_path: "/repo/.guild/runs/r1/binding.json" }, {} as NodeJS.ProcessEnv)).toBe(false);
  });

  it("only the six native tools are guarded (no projection widening)", () => {
    expect(denied("NotebookEdit", { notebook_path: "/repo/.guild/runs/r1/binding.json" })).toBe(false);
    expect(denied("WebFetch", { url: "file:///repo/.guild/runs/r1/binding.json" })).toBe(false);
  });

  it("declared limits: variable expansion and interpreters are not resolved", () => {
    expect(denied("Bash", { command: 'f=bind; cat ".guild/runs/r1/${f}ing.json"' })).toBe(false);
    expect(denied("Bash", { command: "python3 -c 'open(chr(46)+\"guild\")'" })).toBe(false);
    expect(BINDING_GUARD_LIMITS).toMatch(/cooperative_local.*substitution.*interpreters.*symlink/);
  });

  it("a brace set past the expansion bound still matches as a superset", () => {
    const many = Array.from({ length: 20 }, (_, i) => `a${i}`).join(",");
    // 21 × 21 alternatives exceed the bound; the only matching expansion (both empty) sorts last.
    expect(denied("Glob", { pattern: `.guild/runs/r1/{${many},}{${many},}binding.json`, path: ROOT })).toBe(true);
    expect(denied("Glob", { pattern: `.guild/runs/r1/{${many}}{${many}}.yaml`, path: ROOT })).toBe(false);
  });
});
