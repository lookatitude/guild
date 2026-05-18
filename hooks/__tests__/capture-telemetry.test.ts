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

  describe("sentinel-based run scoping", () => {
    it("uses GUILD_RUN_ID env over sentinel", () => {
      // Write sentinel with a different run-id
      const sentinelDir = path.join(tmpDir, ".guild", "runs");
      fs.mkdirSync(sentinelDir, { recursive: true });
      fs.writeFileSync(path.join(sentinelDir, "current-run-id"), "sentinel-run", "utf8");

      runScript(readFixture("post-tool-use.json"), {
        GUILD_CWD: tmpDir,
        GUILD_RUN_ID: "test-run", // env wins
      });
      // Events should be under test-run, not sentinel-run
      expect(fs.existsSync(path.join(tmpDir, ".guild", "runs", "test-run", "events.ndjson"))).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, ".guild", "runs", "sentinel-run", "events.ndjson"))).toBe(false);
    });

    it("uses sentinel file when GUILD_RUN_ID is empty", () => {
      const sentinelDir = path.join(tmpDir, ".guild", "runs");
      fs.mkdirSync(sentinelDir, { recursive: true });
      fs.writeFileSync(path.join(sentinelDir, "current-run-id"), "from-sentinel", "utf8");

      // Pass GUILD_RUN_ID="" to bypass env priority — sentinel should be used
      const result = runScript(readFixture("post-tool-use.json"), {
        GUILD_CWD: tmpDir,
        GUILD_RUN_ID: "", // empty overrides the default "test-run"
      });
      expect(result.exitCode).toBe(0);
      const sentinelEventsFile = path.join(tmpDir, ".guild", "runs", "from-sentinel", "events.ndjson");
      expect(fs.existsSync(sentinelEventsFile)).toBe(true);
      const lines = fs.readFileSync(sentinelEventsFile, "utf8").trim().split("\n").filter(Boolean);
      expect(lines.length).toBe(1);
      expect(JSON.parse(lines[0]).event).toBe("PostToolUse");
    });

    it("falls back to session_id when sentinel is absent and GUILD_RUN_ID is empty", () => {
      // No sentinel, GUILD_RUN_ID="" — payload session_id should be used
      runScript(readFixture("post-tool-use.json"), {
        GUILD_CWD: tmpDir,
        GUILD_RUN_ID: "", // empty — bypasses env priority
        // no sentinel file written
      });
      // post-tool-use.json has session_id: "sess-abc123"
      const sessionEventsFile = path.join(tmpDir, ".guild", "runs", "run-sess-abc123", "events.ndjson");
      expect(fs.existsSync(sessionEventsFile)).toBe(true);
    });
  });

  describe("run scoping", () => {
    it("uses .guild/runs/current-run-id when GUILD_RUN_ID is unset", () => {
      const scopedRunId = "run-sentinel-123";
      const runsRoot = path.join(tmpDir, ".guild", "runs");
      fs.mkdirSync(runsRoot, { recursive: true });
      fs.writeFileSync(path.join(runsRoot, "current-run-id"), scopedRunId, "utf8");

      runScript(readFixture("post-tool-use.json"), {
        GUILD_CWD: tmpDir,
        GUILD_RUN_ID: "",
      });

      const scopedEvents = path.join(runsRoot, scopedRunId, "events.ndjson");
      expect(fs.existsSync(scopedEvents)).toBe(true);
      expect(fs.existsSync(eventsFile)).toBe(false);
    });

    it("uses a new sentinel value for a later /guild invocation in the same session", () => {
      const runsRoot = path.join(tmpDir, ".guild", "runs");
      fs.mkdirSync(runsRoot, { recursive: true });
      const sentinel = path.join(runsRoot, "current-run-id");

      fs.writeFileSync(sentinel, "run-first", "utf8");
      runScript(readFixture("post-tool-use.json"), {
        GUILD_CWD: tmpDir,
        GUILD_RUN_ID: "",
      });

      fs.writeFileSync(sentinel, "run-second", "utf8");
      runScript(readFixture("subagent-stop.json"), {
        GUILD_CWD: tmpDir,
        GUILD_RUN_ID: "",
      });

      expect(fs.existsSync(path.join(runsRoot, "run-first", "events.ndjson"))).toBe(true);
      expect(fs.existsSync(path.join(runsRoot, "run-second", "events.ndjson"))).toBe(true);
      const firstLines = fs.readFileSync(path.join(runsRoot, "run-first", "events.ndjson"), "utf8").trim().split("\n");
      const secondLines = fs.readFileSync(path.join(runsRoot, "run-second", "events.ndjson"), "utf8").trim().split("\n");
      expect(firstLines.length).toBe(1);
      expect(secondLines.length).toBe(1);
    });
  });

  describe("model field", () => {
    it("records model field when present in payload", () => {
      runScript(readFixture("post-tool-use.json"), {
        GUILD_CWD: tmpDir,
        GUILD_RUN_ID: "test-run",
      });
      // post-tool-use.json does not include model; field should be absent
      const lines = fs.readFileSync(eventsFile, "utf8").trim().split("\n").filter(Boolean);
      const event = JSON.parse(lines[0]);
      expect(event.model).toBeUndefined();
    });

    it("records model field from loop_round_start fixture", () => {
      runScript(readFixture("loop-round-start.json"), {
        GUILD_CWD: tmpDir,
        GUILD_RUN_ID: "test-run",
      });
      const lines = fs.readFileSync(eventsFile, "utf8").trim().split("\n").filter(Boolean);
      const event = JSON.parse(lines[0]);
      expect(event.model).toBe("claude-sonnet-4-6");
    });
  });

  describe("loop_round events", () => {
    it("emits loop_round_start with loop_layer and loop_round fields", () => {
      runScript(readFixture("loop-round-start.json"), {
        GUILD_CWD: tmpDir,
        GUILD_RUN_ID: "test-run",
      });
      const lines = fs.readFileSync(eventsFile, "utf8").trim().split("\n").filter(Boolean);
      expect(lines.length).toBe(1);
      const event = JSON.parse(lines[0]);
      expect(event.event).toBe("loop_round_start");
      expect(event.loop_layer).toBe("L1");
      expect(event.loop_round).toBe(1);
      expect(event.loop_gate).toBe("G-spec");
      expect(event.loop_terminated).toBeUndefined();
    });

    it("emits loop_round_end with loop_terminated=false for non-final round", () => {
      runScript(readFixture("loop-round-end.json"), {
        GUILD_CWD: tmpDir,
        GUILD_RUN_ID: "test-run",
      });
      const lines = fs.readFileSync(eventsFile, "utf8").trim().split("\n").filter(Boolean);
      const event = JSON.parse(lines[0]);
      expect(event.event).toBe("loop_round_end");
      expect(event.loop_terminated).toBe(false);
      expect(event.loop_layer).toBe("L1");
    });

    it("emits loop_round_end with loop_terminated=true when sentinel fires", () => {
      runScript(readFixture("loop-round-end-satisfied.json"), {
        GUILD_CWD: tmpDir,
        GUILD_RUN_ID: "test-run",
      });
      const lines = fs.readFileSync(eventsFile, "utf8").trim().split("\n").filter(Boolean);
      const event = JSON.parse(lines[0]);
      expect(event.event).toBe("loop_round_end");
      expect(event.loop_terminated).toBe(true);
      expect(event.loop_round).toBe(3);
      expect(event.loop_gate).toBe("G-plan");
    });

    it("loop_round_start and loop_round_end accumulate in sequence", () => {
      runScript(readFixture("loop-round-start.json"), {
        GUILD_CWD: tmpDir,
        GUILD_RUN_ID: "test-run",
      });
      runScript(readFixture("loop-round-end.json"), {
        GUILD_CWD: tmpDir,
        GUILD_RUN_ID: "test-run",
      });
      const lines = fs.readFileSync(eventsFile, "utf8").trim().split("\n").filter(Boolean);
      expect(lines.length).toBe(2);
      expect(JSON.parse(lines[0]).event).toBe("loop_round_start");
      expect(JSON.parse(lines[1]).event).toBe("loop_round_end");
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
