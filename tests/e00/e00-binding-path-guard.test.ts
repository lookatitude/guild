/**
 * E00-T0 · EAT01-C / CD21 — PreToolUse accident guard: a lane worker's
 * Read / Grep / Glob / Edit / Write / Bash input naming .guild/runs/<run>/binding.json
 * is denied with binding_path_refused. Declared as accident prevention only.
 *
 * Expected red today (no such rule). Controls: the lead session is not refused
 * by this rule, and a lane read of a sibling run file is not refused by it.
 *
 * F7 (round 1): every evaluation first requires a HEALTHY hook run: no spawn
 * error, signal or timeout, exit 0, and no `fatal: [pre-tool-use]` stderr (the
 * fatal handler also exits 0). Native hook contract: an intentional allow is
 * exit 0 with EMPTY stdout (pre-tool-use.ts main() end); any stdout present must
 * parse as a PreToolUse hookSpecificOutput. A deny control on the same harness
 * proves responses are parsed, so an allow can never be a masked failure.
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { spawnSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

import { admitLane } from "../../scripts/lib/host/__tests__/admit-lane";
import { mintRunBinding } from "../../src/domains/lifecycle";
import { hermeticEnv } from "../../hooks/test-support/hermetic-env";
import { PLUGIN, ownedTempDir, teardownOwned } from "./support/e00-harness";

const SCRIPT = path.join(PLUGIN, "hooks", "pre-tool-use.ts");
const RUN_ID = "run-e00-guard";
const INSTANCE = "T1.a1.i-1";

let repo: string;
let runDir: string;

beforeEach(() => {
  const tmp = ownedTempDir("guild-e00-guard-");
  repo = path.join(tmp, "repo");
  fs.mkdirSync(path.join(repo, ".git"), { recursive: true });
  fs.mkdirSync(path.join(repo, ".guild", "wiki", "decisions"), { recursive: true });
  runDir = path.join(repo, ".guild", "runs", RUN_ID);
  mintRunBinding({ root: repo, run_id: RUN_ID });
  fs.mkdirSync(path.join(runDir, "logs"), { recursive: true });
  admitLane(repo, RUN_ID, "T1", INSTANCE, ["Read", "Grep", "Glob", "Bash", "Write", "Edit"]);
});

afterEach(teardownOwned);

type HookOutcome =
  | { kind: "allow_empty" }
  | { kind: "decision"; decision: string; reason: string };

/** Run the real hook; throws (failing the test) unless the run was healthy and its output well-formed. */
function hook(lane: boolean, tool: string, input: Record<string, unknown>): HookOutcome {
  const r = spawnSync("npx", ["tsx", SCRIPT], {
    input: JSON.stringify({ tool_name: tool, tool_input: input, cwd: repo }),
    encoding: "utf8",
    cwd: repo,
    env: {
      ...hermeticEnv(),
      CLAUDE_PLUGIN_ROOT: PLUGIN,
      GUILD_CWD: repo,
      GUILD_RUN_DIR: runDir,
      GUILD_RUN_ID: RUN_ID,
      ...(lane ? { GUILD_TASK_ID: "T1", GUILD_TASK_CELL_INSTANCE_ID: INSTANCE } : {}),
    },
    timeout: 30000,
  });
  if (r.error) throw new Error(`hook spawn error: ${(r.error as NodeJS.ErrnoException).code ?? r.error.message}`);
  if (r.signal !== null) throw new Error(`hook killed by ${r.signal}`);
  if (r.status !== 0) throw new Error(`hook exited ${r.status}`);
  if (/fatal: \[pre-tool-use\]/.test(r.stderr ?? "")) throw new Error("hook hit its fatal handler (exit 0 masks it)");
  const out = (r.stdout ?? "").trim();
  if (out === "") return { kind: "allow_empty" };
  const lines = out.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length !== 1) throw new Error(`hook emitted ${lines.length} stdout lines; expected one JSON response`);
  const h = (JSON.parse(lines[0]) as { hookSpecificOutput?: Record<string, unknown> }).hookSpecificOutput;
  if (!h || h["hookEventName"] !== "PreToolUse" || typeof h["permissionDecision"] !== "string") {
    throw new Error("hook stdout is not a PreToolUse hookSpecificOutput");
  }
  return { kind: "decision", decision: h["permissionDecision"] as string, reason: String(h["permissionDecisionReason"] ?? "") };
}

const bindingRefused = (o: HookOutcome) => o.kind === "decision" && o.decision === "deny" && /binding_path_refused/.test(o.reason);

describe("harness health control (must stay green)", () => {
  it("parses a real deny from the same harness (lane wiki write)", () => {
    const o = hook(true, "Write", { file_path: path.join(repo, ".guild", "wiki", "decisions", "x.md"), content: "# x\n" });
    expect(o.kind).toBe("decision");
    expect(o.kind === "decision" && o.decision === "deny" && /lane_wiki_write_refused/.test(o.reason)).toBe(true);
  });
});

describe("CD21 binding_path_refused for lane workers (expected red)", () => {
  const binding = () => path.join(runDir, "binding.json");
  const cases: Array<[string, string, () => Record<string, unknown>]> = [
    ["Read", "absolute path", () => ({ file_path: binding() })],
    ["Grep", "absolute path", () => ({ pattern: "binding_ref", path: binding() })],
    ["Glob", "glob pattern", () => ({ pattern: ".guild/runs/*/binding.json", path: repo })],
    ["Edit", "absolute path", () => ({ file_path: binding(), old_string: "a", new_string: "b" })],
    ["Write", "absolute path", () => ({ file_path: binding(), content: "{}" })],
    ["Bash", "absolute argument", () => ({ command: `cat ${binding()}` })],
    ["Bash", "relative argument", () => ({ command: `cat .guild/runs/${RUN_ID}/binding.json` })],
  ];
  for (const [tool, label, input] of cases) {
    it(`denies ${tool} (${label}) naming binding.json`, () => {
      expect(bindingRefused(hook(true, tool, input()))).toBe(true);
    });
  }
});

describe("CD21 guard scope controls (healthy run required)", () => {
  it("does not apply binding_path_refused to the lead session", () => {
    const o = hook(false, "Read", { file_path: path.join(runDir, "binding.json") });
    expect(bindingRefused(o)).toBe(false);
  });

  it("allows a lane read of another run file through the native empty-stdout allow", () => {
    fs.writeFileSync(path.join(runDir, "run.yaml"), "run_id: x\n");
    const o = hook(true, "Read", { file_path: path.join(runDir, "run.yaml") });
    expect(o.kind === "allow_empty" || (o.kind === "decision" && o.decision === "allow")).toBe(true);
  });
});
