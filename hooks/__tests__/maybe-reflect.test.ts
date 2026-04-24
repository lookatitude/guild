/**
 * hooks/__tests__/maybe-reflect.test.ts
 *
 * TDD: written before maybe-reflect.ts implementation.
 * Verifies the heuristic gate (§13.2 + §15.2):
 *   GATE PASSES  → ≥ 1 specialist dispatched + ≥ 1 file edited + no error event
 *   GATE FAILS   → any condition missing → no-op (silent, exit 0)
 *
 * The test sets up a temporary .guild/runs/<run-id>/events.ndjson, then
 * spawns maybe-reflect.ts with the Stop fixture on stdin.
 */

import { spawnSync } from "child_process";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";

const SCRIPT = path.resolve(__dirname, "../maybe-reflect.ts");
const FIXTURES = path.resolve(__dirname, "../fixtures");

const SPECIALIST_EVENT = JSON.stringify({
  ts: new Date().toISOString(),
  event: "SubagentStop",
  tool: "",
  specialist: "backend",
  payload_digest: "abc123",
  ok: true,
  ms: 1200,
});

const FILE_EDIT_EVENT = JSON.stringify({
  ts: new Date().toISOString(),
  event: "PostToolUse",
  tool: "Write",
  specialist: "backend",
  payload_digest: "def456",
  ok: true,
  ms: 50,
});

const ERROR_EVENT = JSON.stringify({
  ts: new Date().toISOString(),
  event: "PostToolUse",
  tool: "Bash",
  specialist: "backend",
  payload_digest: "err789",
  ok: false,
  ms: 300,
});

function makeRunDir(tmpDir: string, runId: string, events: string[]): string {
  const runDir = path.join(tmpDir, ".guild", "runs", runId);
  fs.mkdirSync(runDir, { recursive: true });
  if (events.length > 0) {
    fs.writeFileSync(
      path.join(runDir, "events.ndjson"),
      events.join("\n") + "\n",
      "utf8"
    );
  }
  return runDir;
}

function runScript(
  input: string,
  env: Record<string, string> = {}
): { exitCode: number; stdout: string; stderr: string } {
  const result = spawnSync("npx", ["tsx", SCRIPT], {
    input,
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

describe("maybe-reflect.ts — heuristic gate", () => {
  let tmpDir: string;
  const stopPayload = fs
    .readFileSync(path.join(FIXTURES, "stop.json"), "utf8")
    .toString();

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-reflect-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("gate PASSES — specialist + file edit + no error", () => {
    it("emits reflect marker to stdout", () => {
      makeRunDir(tmpDir, "test-run", [SPECIALIST_EVENT, FILE_EDIT_EVENT]);
      const { exitCode, stdout } = runScript(stopPayload, {
        GUILD_CWD: tmpDir,
        GUILD_RUN_ID: "test-run",
      });
      expect(exitCode).toBe(0);
      // Must emit a line telling orchestrator to invoke guild:reflect
      expect(stdout).toMatch(/reflect/i);
      expect(stdout).toMatch(/test-run/);
    });

    it("exits 0", () => {
      makeRunDir(tmpDir, "test-run", [SPECIALIST_EVENT, FILE_EDIT_EVENT]);
      const { exitCode } = runScript(stopPayload, {
        GUILD_CWD: tmpDir,
        GUILD_RUN_ID: "test-run",
      });
      expect(exitCode).toBe(0);
    });
  });

  describe("gate FAILS — no specialist event", () => {
    it("no-ops silently (no reflect marker) when no specialist dispatched", () => {
      // Only a file edit, no specialist
      makeRunDir(tmpDir, "test-run", [FILE_EDIT_EVENT]);
      const { exitCode, stdout } = runScript(stopPayload, {
        GUILD_CWD: tmpDir,
        GUILD_RUN_ID: "test-run",
      });
      expect(exitCode).toBe(0);
      expect(stdout.trim()).toBe("");
    });
  });

  describe("gate FAILS — no file edit", () => {
    it("no-ops silently when no Write/Edit tool used", () => {
      // Only specialist stop, no file edit
      makeRunDir(tmpDir, "test-run", [SPECIALIST_EVENT]);
      const { exitCode, stdout } = runScript(stopPayload, {
        GUILD_CWD: tmpDir,
        GUILD_RUN_ID: "test-run",
      });
      expect(exitCode).toBe(0);
      expect(stdout.trim()).toBe("");
    });
  });

  describe("gate FAILS — error event present", () => {
    it("no-ops silently when an ok:false event is in the log", () => {
      makeRunDir(tmpDir, "test-run", [
        SPECIALIST_EVENT,
        FILE_EDIT_EVENT,
        ERROR_EVENT,
      ]);
      const { exitCode, stdout } = runScript(stopPayload, {
        GUILD_CWD: tmpDir,
        GUILD_RUN_ID: "test-run",
      });
      expect(exitCode).toBe(0);
      expect(stdout.trim()).toBe("");
    });
  });

  describe("gate FAILS — no events.ndjson at all", () => {
    it("no-ops silently when events file is missing", () => {
      // Create run dir but no events file
      const runDir = path.join(tmpDir, ".guild", "runs", "test-run");
      fs.mkdirSync(runDir, { recursive: true });
      const { exitCode, stdout } = runScript(stopPayload, {
        GUILD_CWD: tmpDir,
        GUILD_RUN_ID: "test-run",
      });
      expect(exitCode).toBe(0);
      expect(stdout.trim()).toBe("");
    });
  });

  describe("error resilience", () => {
    it("exits 0 even with invalid JSON on stdin", () => {
      makeRunDir(tmpDir, "test-run", [SPECIALIST_EVENT, FILE_EDIT_EVENT]);
      const { exitCode } = runScript("not valid json", {
        GUILD_CWD: tmpDir,
        GUILD_RUN_ID: "test-run",
      });
      expect(exitCode).toBe(0);
    });
  });
});
