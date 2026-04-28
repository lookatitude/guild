// v1.4.0 — T3d-backend-platform pre-compact hook tests.
// Pins the binding contract:
//   - GUILD_RUN_ID unset → graceful fall-through.
//   - Valid PreCompact payload → emits a `hook_event` JSONL line with
//     hook_name: "PreCompact" + status: "ok".

import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";

const HOOK_SCRIPT = resolve(__dirname, "../../hooks/pre-compact.ts");
const RUN_ID = "test-run-pre-compact";

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
let liveLogPath: string;

beforeEach(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), "guild-pre-compact-"));
  runDir = join(tmpRoot, ".guild", "runs", RUN_ID);
  mkdirSync(join(runDir, "logs"), { recursive: true });
  liveLogPath = join(runDir, "logs", "v1.4-events.jsonl");
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe("pre-compact hook — fall-through path", () => {
  it("falls through gracefully when GUILD_RUN_ID is unset", () => {
    const payload = JSON.stringify({
      hook_event_name: "PreCompact",
      payload: { trigger: "auto" },
    });
    const result = runHook(payload, {
      GUILD_RUN_ID: "",
      GUILD_CWD: tmpRoot,
    });
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain("warn:");
    expect(result.stderr).toContain("GUILD_RUN_ID unset");
    expect(existsSync(liveLogPath)).toBe(false);
  });
});

describe("pre-compact hook — log emission", () => {
  it("emits a hook_event JSONL line with hook_name: PreCompact", () => {
    const payload = JSON.stringify({
      hook_event_name: "PreCompact",
      payload: { trigger: "manual" },
    });
    const result = runHook(payload, {
      GUILD_RUN_ID: RUN_ID,
      GUILD_CWD: tmpRoot,
    });
    expect(result.exitCode).toBe(0);
    expect(existsSync(liveLogPath)).toBe(true);
    const text = readFileSync(liveLogPath, "utf8").trim();
    const lines = text.split("\n").filter((l) => l.length > 0);
    expect(lines).toHaveLength(1);
    const event = JSON.parse(lines[0]!);
    expect(event.event).toBe("hook_event");
    expect(event.hook_name).toBe("PreCompact");
    expect(event.status).toBe("ok");
    expect(event.run_id).toBe(RUN_ID);
    expect(event.latency_ms).toBe(0);
    expect(typeof event.payload_excerpt_redacted).toBe("string");
  });

  it("emits a bare event when stdin JSON is invalid (still logs the boundary)", () => {
    const result = runHook("not json", {
      GUILD_RUN_ID: RUN_ID,
      GUILD_CWD: tmpRoot,
    });
    expect(result.exitCode).toBe(0);
    // Even with invalid JSON, the hook STILL emits a bare event so
    // the audit trail captures the compact boundary.
    expect(existsSync(liveLogPath)).toBe(true);
    const event = JSON.parse(readFileSync(liveLogPath, "utf8").trim());
    expect(event.hook_name).toBe("PreCompact");
    expect(result.stderr).toContain("invalid JSON");
  });
});
