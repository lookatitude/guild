/**
 * hooks/__tests__/pre-tool-use-turn-bound.test.ts
 *
 * G5(d) — PreToolUse per-tool lifecycle bound (v23x-deferred-followups
 * rf-wi-05, origin oir-wi-59), exercised on the REAL hook path (runs
 * pre-tool-use.ts via tsx over stdin, exactly as Claude Code drives it).
 *
 * The gap: the UserPromptSubmit gate (lifecycle-gate.ts) bounds ad-hoc LEAD
 * edit activity ACROSS turns; nothing bounds how many tool calls a SINGLE
 * turn can make. These tests pin that pre-tool-use.ts now emits a soft `ask`
 * once the CURRENT call would cross the per-turn bound, and stays silent
 * (default `allow`) under it — never a hard `deny`.
 */

import { spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const SCRIPT = path.resolve(__dirname, "../pre-tool-use.ts");
const RUN = "test-run";

let tmp: string;

function runHook(
  payload: object,
  env: Record<string, string> = {},
): { exitCode: number; stdout: string; stderr: string } {
  const result = spawnSync("npx", ["tsx", SCRIPT], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    env: {
      ...process.env,
      GUILD_CWD: tmp,
      GUILD_RUN_ID: RUN,
      CMUX_WORKSPACE_ID: "",
      TMUX: "",
      GUILD_ALLOW_UNTIERED_DISPATCH: "",
      GUILD_LANE_ID: "",
      GUILD_TASK_ID: "",
      GUILD_SPECIALIST: "",
      ...env,
    },
    timeout: 20000,
  });
  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function writeEventsLog(lines: string[]): void {
  const dir = path.join(tmp, ".guild", "runs", RUN, "logs");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "v1.4-events.jsonl"), lines.join("\n") + "\n", "utf8");
}

const READ_CALL = { tool_name: "Read", tool_input: { file_path: "/tmp/x.txt" } };

describe("pre-tool-use.ts — G5(d) per-tool lifecycle bound", () => {
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "guild-ptu-turn-"));
    fs.mkdirSync(path.join(tmp, ".git"), { recursive: true });
    fs.mkdirSync(path.join(tmp, ".guild", "runs", RUN), { recursive: true });
  });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it("stays silent (default allow) with no prior tool calls this turn", () => {
    const { exitCode, stdout } = runHook(READ_CALL, { GUILD_TOOL_TURN_MAX: "5" });
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe("");
  });

  it("stays silent when this turn's count is under the threshold", () => {
    writeEventsLog([
      '{"event":"UserPromptSubmit"}',
      '{"event":"tool_call"}',
      '{"event":"tool_call"}',
    ]);
    const { stdout } = runHook(READ_CALL, { GUILD_TOOL_TURN_MAX: "5" });
    expect(stdout.trim()).toBe("");
  });

  it("emits a soft ASK (never deny) once the current call would cross the bound", () => {
    writeEventsLog([
      '{"event":"UserPromptSubmit"}',
      '{"event":"tool_call"}',
      '{"event":"tool_call"}',
    ]);
    const { exitCode, stdout } = runHook(READ_CALL, { GUILD_TOOL_TURN_MAX: "2" });
    expect(exitCode).toBe(0);
    const decision = JSON.parse(stdout) as {
      hookSpecificOutput: { permissionDecision: string; permissionDecisionReason: string };
    };
    expect(decision.hookSpecificOutput.permissionDecision).toBe("ask");
    expect(decision.hookSpecificOutput.permissionDecisionReason).toContain("G5d");
    expect(decision.hookSpecificOutput.permissionDecisionReason).toContain("Read");
  });

  it("resets the count at a new UserPromptSubmit boundary — a new turn is never pre-tripped", () => {
    const lines = ['{"event":"UserPromptSubmit"}'];
    for (let i = 0; i < 10; i++) lines.push('{"event":"tool_call"}'); // prior turn — way over a low bound
    lines.push('{"event":"UserPromptSubmit"}'); // new turn boundary
    writeEventsLog(lines);
    const { stdout } = runHook(READ_CALL, { GUILD_TOOL_TURN_MAX: "3" });
    expect(stdout.trim()).toBe("");
  });

  it("is fail-open: an unresolvable run id never asks (falls through silently)", () => {
    const { exitCode, stdout } = runHook(READ_CALL, {
      GUILD_RUN_ID: "",
      GUILD_TOOL_TURN_MAX: "1",
    });
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe("");
  });
});
