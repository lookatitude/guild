/**
 * hooks/__tests__/capture-telemetry.test.ts
 *
 * TDD: written before capture-telemetry.ts implementation.
 * Spawns the script with fixture payloads on stdin, verifies:
 *  - exits 0 always
 *  - appends valid NDJSON event to .guild/runs/<run-id>/events.ndjson
 *  - event schema has required fields
 *  - stdout is silent (Claude Code may consume it)
 *  - appends are cumulative (not overwriting)
 */

import { spawnSync } from "child_process";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";

const SCRIPT = path.resolve(__dirname, "../capture-telemetry.ts");
const FIXTURES = path.resolve(__dirname, "../fixtures");

function readFixture(name: string): string {
  return fs.readFileSync(path.join(FIXTURES, name), "utf8");
}

function runScript(
  input: string,
  env: Record<string, string> = {}
): { exitCode: number; stdout: string; stderr: string } {
  const result = spawnSync("npx", ["tsx", SCRIPT], {
    input,
    encoding: "utf8",
    env: { ...process.env, GUILD_RUN_ID: "test-run", ...env },
    timeout: 15000,
  });
  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

describe("capture-telemetry.ts", () => {
  let tmpDir: string;
  let runDir: string;
  let eventsFile: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-telemetry-test-"));
    runDir = path.join(tmpDir, ".guild", "runs", "test-run");
    fs.mkdirSync(runDir, { recursive: true });
    eventsFile = path.join(runDir, "events.ndjson");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("PostToolUse event", () => {
    it("exits 0 always", () => {
      const { exitCode } = runScript(readFixture("post-tool-use.json"), {
        GUILD_CWD: tmpDir,
        GUILD_RUN_ID: "test-run",
      });
      expect(exitCode).toBe(0);
    });

    it("produces no stdout (silent)", () => {
      const { stdout } = runScript(readFixture("post-tool-use.json"), {
        GUILD_CWD: tmpDir,
        GUILD_RUN_ID: "test-run",
      });
      expect(stdout.trim()).toBe("");
    });

    it("appends a valid NDJSON line to events.ndjson", () => {
      runScript(readFixture("post-tool-use.json"), {
        GUILD_CWD: tmpDir,
        GUILD_RUN_ID: "test-run",
      });
      expect(fs.existsSync(eventsFile)).toBe(true);
      const lines = fs
        .readFileSync(eventsFile, "utf8")
        .trim()
        .split("\n")
        .filter(Boolean);
      expect(lines.length).toBe(1);
      const event = JSON.parse(lines[0]);
      expect(event).toMatchObject({
        event: "PostToolUse",
        tool: expect.any(String),
        ok: expect.any(Boolean),
      });
      expect(typeof event.ts).toBe("string");
      // ts must be parseable ISO-8601
      expect(() => new Date(event.ts).toISOString()).not.toThrow();
    });

    it("captures tool name from payload", () => {
      runScript(readFixture("post-tool-use.json"), {
        GUILD_CWD: tmpDir,
        GUILD_RUN_ID: "test-run",
      });
      const lines = fs
        .readFileSync(eventsFile, "utf8")
        .trim()
        .split("\n")
        .filter(Boolean);
      const event = JSON.parse(lines[0]);
      expect(event.tool).toBe("Write");
    });

    it("captures specialist name when present", () => {
      runScript(readFixture("post-tool-use.json"), {
        GUILD_CWD: tmpDir,
        GUILD_RUN_ID: "test-run",
      });
      const lines = fs
        .readFileSync(eventsFile, "utf8")
        .trim()
        .split("\n")
        .filter(Boolean);
      const event = JSON.parse(lines[0]);
      expect(event.specialist).toBe("backend");
    });
  });

  describe("SubagentStop event", () => {
    it("exits 0 always", () => {
      const { exitCode } = runScript(readFixture("subagent-stop.json"), {
        GUILD_CWD: tmpDir,
        GUILD_RUN_ID: "test-run",
      });
      expect(exitCode).toBe(0);
    });

    it("records event as SubagentStop with empty tool field", () => {
      runScript(readFixture("subagent-stop.json"), {
        GUILD_CWD: tmpDir,
        GUILD_RUN_ID: "test-run",
      });
      const lines = fs
        .readFileSync(eventsFile, "utf8")
        .trim()
        .split("\n")
        .filter(Boolean);
      const event = JSON.parse(lines[0]);
      expect(event.event).toBe("SubagentStop");
      expect(event.tool).toBe("");
    });
  });

  describe("append-only behavior", () => {
    it("accumulates multiple events in the file (does not overwrite)", () => {
      // Run twice
      runScript(readFixture("post-tool-use.json"), {
        GUILD_CWD: tmpDir,
        GUILD_RUN_ID: "test-run",
      });
      runScript(readFixture("subagent-stop.json"), {
        GUILD_CWD: tmpDir,
        GUILD_RUN_ID: "test-run",
      });
      const lines = fs
        .readFileSync(eventsFile, "utf8")
        .trim()
        .split("\n")
        .filter(Boolean);
      expect(lines.length).toBe(2);
      const events = lines.map((l) => JSON.parse(l));
      expect(events[0].event).toBe("PostToolUse");
      expect(events[1].event).toBe("SubagentStop");
    });
  });

  describe("error resilience", () => {
    it("exits 0 even when given invalid JSON", () => {
      const { exitCode } = runScript("not valid json at all", {
        GUILD_CWD: tmpDir,
        GUILD_RUN_ID: "test-run",
      });
      expect(exitCode).toBe(0);
    });

    it("exits 0 even when run dir does not pre-exist", () => {
      const { exitCode } = runScript(readFixture("post-tool-use.json"), {
        GUILD_CWD: path.join(tmpDir, "nonexistent"),
        GUILD_RUN_ID: "test-run",
      });
      expect(exitCode).toBe(0);
    });
  });
});
