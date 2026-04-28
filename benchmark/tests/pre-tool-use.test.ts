// v1.4.0 — T3d-backend-platform pre-tool-use hook tests.
// Pins the binding contract from the audit doc:
//   - GUILD_RUN_ID unset → graceful fall-through (warn to stderr, exit 0).
//   - Valid PreToolUse payload → sidecar entry written with 4-tuple
//     correlation key (run_id, lane_id, tool, ts_pre).
//   - Off-enum tool name → fall through (no sidecar write).
//   - Invalid JSON → warn + return.

import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";

const HOOK_SCRIPT = resolve(__dirname, "../../hooks/pre-tool-use.ts");
const RUN_ID = "test-run-pre-tool-use";

function runHook(
  stdin: string,
  env: Record<string, string> = {},
): { exitCode: number; stdout: string; stderr: string } {
  const result = spawnSync("npx", ["tsx", HOOK_SCRIPT], {
    input: stdin,
    encoding: "utf8",
    env: { ...process.env, ...env },
    timeout: 15000,
  });
  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

let tmpRoot: string;
let runDir: string;
let sidecarPath: string;

beforeEach(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), "guild-pre-tool-use-"));
  runDir = join(tmpRoot, ".guild", "runs", RUN_ID);
  mkdirSync(join(runDir, "logs"), { recursive: true });
  sidecarPath = join(runDir, "logs", "tool-call-pre.jsonl");
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe("pre-tool-use hook — fall-through paths", () => {
  it("falls through gracefully when GUILD_RUN_ID is unset", () => {
    const payload = JSON.stringify({
      hook_event_name: "PreToolUse",
      tool_name: "Read",
      tool_input: { file_path: "/tmp/x" },
    });
    const result = runHook(payload, {
      // Explicitly UNSET GUILD_RUN_ID by overriding the parent env.
      GUILD_RUN_ID: "",
      GUILD_CWD: tmpRoot,
    });
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain("warn:");
    expect(result.stderr).toContain("GUILD_RUN_ID unset");
    expect(existsSync(sidecarPath)).toBe(false);
  });

  it("falls through silently for off-enum tool names", () => {
    const payload = JSON.stringify({
      hook_event_name: "PreToolUse",
      tool_name: "SomeFutureTool",
      tool_input: {},
    });
    const result = runHook(payload, {
      GUILD_RUN_ID: RUN_ID,
      GUILD_CWD: tmpRoot,
    });
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain("not in closed enum");
    expect(existsSync(sidecarPath)).toBe(false);
  });

  it("falls through on invalid stdin JSON", () => {
    const result = runHook("not valid json", {
      GUILD_RUN_ID: RUN_ID,
      GUILD_CWD: tmpRoot,
    });
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain("invalid JSON");
    expect(existsSync(sidecarPath)).toBe(false);
  });
});

describe("pre-tool-use hook — sidecar lifecycle (write)", () => {
  it("writes a sidecar entry with the 4-tuple correlation key", () => {
    const payload = JSON.stringify({
      hook_event_name: "PreToolUse",
      tool_name: "Read",
      tool_input: { file_path: "/etc/passwd" },
    });
    const result = runHook(payload, {
      GUILD_RUN_ID: RUN_ID,
      GUILD_CWD: tmpRoot,
      GUILD_LANE_ID: "T3d",
    });
    expect(result.exitCode).toBe(0);
    expect(existsSync(sidecarPath)).toBe(true);
    const text = readFileSync(sidecarPath, "utf8").trim();
    const lines = text.split("\n").filter((l) => l.length > 0);
    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0]!);
    // 4-tuple correlation key shape.
    expect(entry.run_id).toBe(RUN_ID);
    expect(entry.lane_id).toBe("T3d");
    expect(entry.tool).toBe("Read");
    expect(typeof entry.ts_pre).toBe("string");
    // ISO-8601 shape (architect-friendly).
    expect(entry.ts_pre).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // command_redacted populated from tool_input.
    expect(typeof entry.command_redacted).toBe("string");
    expect(entry.command_redacted).toContain("Read");
  });

  it("omits lane_id field when GUILD_LANE_ID is absent (orchestrator-side dispatch)", () => {
    const payload = JSON.stringify({
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: { command: "ls" },
    });
    const result = runHook(payload, {
      GUILD_RUN_ID: RUN_ID,
      GUILD_CWD: tmpRoot,
    });
    expect(result.exitCode).toBe(0);
    expect(existsSync(sidecarPath)).toBe(true);
    const entry = JSON.parse(readFileSync(sidecarPath, "utf8").trim());
    expect(entry.lane_id).toBeUndefined();
    expect(entry.run_id).toBe(RUN_ID);
    expect(entry.tool).toBe("Bash");
  });

  it("appends multiple entries (one per invocation)", () => {
    const p1 = JSON.stringify({
      hook_event_name: "PreToolUse",
      tool_name: "Read",
      tool_input: { file_path: "/a" },
    });
    const p2 = JSON.stringify({
      hook_event_name: "PreToolUse",
      tool_name: "Write",
      tool_input: { file_path: "/b", content: "hi" },
    });
    runHook(p1, { GUILD_RUN_ID: RUN_ID, GUILD_CWD: tmpRoot });
    runHook(p2, { GUILD_RUN_ID: RUN_ID, GUILD_CWD: tmpRoot });
    const lines = readFileSync(sidecarPath, "utf8")
      .split("\n")
      .filter((l) => l.length > 0);
    expect(lines).toHaveLength(2);
    const e1 = JSON.parse(lines[0]!);
    const e2 = JSON.parse(lines[1]!);
    expect(e1.tool).toBe("Read");
    expect(e2.tool).toBe("Write");
  });
});
