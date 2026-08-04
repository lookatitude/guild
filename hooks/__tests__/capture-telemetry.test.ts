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

// T3b (session_context §5): telemetry writes are binding-gated; fixtures mint
// the run's binding so the authorized write path is exercised.
import { mintTestBinding } from "../test-support/mint-binding";

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
    // Rework F1: writers demand the caller-PRESENTED pair — export the
    // envelope by default ("rb-test-test-run" is mintTestBinding's
    // deterministic nonce for run "test-run"). Tests that override
    // GUILD_RUN_ID away from test-run break the envelope on purpose.
    env: {
      ...process.env,
      GUILD_RUN_ID: "test-run",
      GUILD_RUN_BINDING_REF: "rb-test-test-run",
      ...env,
    },
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
    mintTestBinding(tmpDir, "test-run");
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

    it("does NOT use the sentinel file when GUILD_RUN_ID is empty (T3b §5: fail closed, no write)", () => {
      // CORRECTED (T3b): this test previously ENCODED the retired sentinel
      // scoping (empty env → sentinel resolves the write target). Under
      // session_context §5 the sentinel is intake-only: an empty explicit
      // binding refuses the write entirely — even with a minted open binding
      // for the sentinel-named run.
      const sentinelDir = path.join(tmpDir, ".guild", "runs");
      fs.mkdirSync(sentinelDir, { recursive: true });
      fs.writeFileSync(path.join(sentinelDir, "current-run-id"), "from-sentinel", "utf8");
      mintTestBinding(tmpDir, "from-sentinel");

      const result = runScript(readFixture("post-tool-use.json"), {
        GUILD_CWD: tmpDir,
        GUILD_RUN_ID: "", // empty overrides the default "test-run"
      });
      expect(result.exitCode).toBe(0); // a hook never blocks the session
      const sentinelEventsFile = path.join(tmpDir, ".guild", "runs", "from-sentinel", "events.ndjson");
      expect(fs.existsSync(sentinelEventsFile)).toBe(false);
    });

    it("does NOT fall back to session_id when sentinel is absent and GUILD_RUN_ID is empty (T3b §5)", () => {
      // CORRECTED (T3b): the session_id-derived run dir was a fabricated write
      // identity with no minted binding — refused under §5.
      runScript(readFixture("post-tool-use.json"), {
        GUILD_CWD: tmpDir,
        GUILD_RUN_ID: "", // empty — bypasses env priority
      });
      // post-tool-use.json has session_id: "sess-abc123"
      const sessionEventsFile = path.join(tmpDir, ".guild", "runs", "run-sess-abc123", "events.ndjson");
      expect(fs.existsSync(sessionEventsFile)).toBe(false);
    });
  });

  describe("run scoping", () => {
    it("does NOT scope by .guild/runs/current-run-id when GUILD_RUN_ID is unset (T3b §5: fail closed)", () => {
      // CORRECTED (T3b): sentinel scoping is retired; no explicit binding →
      // no write anywhere (neither the sentinel-named run nor the default).
      const scopedRunId = "run-sentinel-123";
      const runsRoot = path.join(tmpDir, ".guild", "runs");
      fs.mkdirSync(runsRoot, { recursive: true });
      fs.writeFileSync(path.join(runsRoot, "current-run-id"), scopedRunId, "utf8");
      mintTestBinding(tmpDir, scopedRunId);

      runScript(readFixture("post-tool-use.json"), {
        GUILD_CWD: tmpDir,
        GUILD_RUN_ID: "",
      });

      const scopedEvents = path.join(runsRoot, scopedRunId, "events.ndjson");
      expect(fs.existsSync(scopedEvents)).toBe(false);
      expect(fs.existsSync(eventsFile)).toBe(false);
    });

    it("SC-1: moving the sentinel between two hook events redirects NEITHER (both refuse — no binding)", () => {
      // CORRECTED (T3b): previously pinned "each event follows the sentinel of
      // its moment" — the exact concurrent-redirect defect SC-1 forbids. Now:
      // a moved sentinel changes nothing, because no sentinel value ever
      // resolves a writer identity.
      const runsRoot = path.join(tmpDir, ".guild", "runs");
      fs.mkdirSync(runsRoot, { recursive: true });
      const sentinel = path.join(runsRoot, "current-run-id");
      mintTestBinding(tmpDir, "run-first");
      mintTestBinding(tmpDir, "run-second");

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

      expect(fs.existsSync(path.join(runsRoot, "run-first", "events.ndjson"))).toBe(false);
      expect(fs.existsSync(path.join(runsRoot, "run-second", "events.ndjson"))).toBe(false);
    });

    it("[control] the explicitly-bound run keeps writing to ITS run dir while the sentinel moves (SC-1 anti-vacuity)", () => {
      // The positive leg: an explicit binding is move-stable — the write lands
      // under the bound run no matter where the sentinel points.
      const runsRoot = path.join(tmpDir, ".guild", "runs");
      fs.mkdirSync(runsRoot, { recursive: true });
      fs.writeFileSync(path.join(runsRoot, "current-run-id"), "run-elsewhere", "utf8");

      runScript(readFixture("post-tool-use.json"), {
        GUILD_CWD: tmpDir,
        GUILD_RUN_ID: "test-run",
      });
      expect(fs.existsSync(eventsFile)).toBe(true);
      expect(fs.existsSync(path.join(runsRoot, "run-elsewhere", "events.ndjson"))).toBe(false);
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

  describe("guild.trace_event.v2 additive fields (D-OBS-1/6)", () => {
    function lastEvent(file: string): any {
      const lines = fs.readFileSync(file, "utf8").trim().split("\n").filter(Boolean);
      return JSON.parse(lines[lines.length - 1]);
    }

    it("always stamps a deterministic 16-hex span_id", () => {
      runScript(readFixture("post-tool-use.json"), { GUILD_CWD: tmpDir, GUILD_RUN_ID: "test-run" });
      const ev = lastEvent(eventsFile);
      expect(ev.span_id).toMatch(/^[0-9a-f]{16}$/);
    });

    it("re-derives the same span_id for identical (run,event,ts,actor) inputs", () => {
      // span = sha256(run|event|ts|actor); recompute from the emitted ts.
      const crypto = require("crypto");
      runScript(readFixture("post-tool-use.json"), { GUILD_CWD: tmpDir, GUILD_RUN_ID: "test-run" });
      const ev = lastEvent(eventsFile);
      const actor = ev.specialist || "main";
      const expected = crypto
        .createHash("sha256")
        .update(`test-run|PostToolUse|${ev.ts}|${actor}`)
        .digest("hex")
        .slice(0, 16);
      expect(ev.span_id).toBe(expected);
    });

    it("threads parent_span_id and tier from env", () => {
      runScript(readFixture("post-tool-use.json"), {
        GUILD_CWD: tmpDir,
        GUILD_RUN_ID: "test-run",
        GUILD_PARENT_SPAN_ID: "0123456789abcdef",
        GUILD_TIER: "mid",
      });
      const ev = lastEvent(eventsFile);
      expect(ev.parent_span_id).toBe("0123456789abcdef");
      expect(ev.tier).toBe("mid");
    });

    it("prefers GUILD_MODEL env over payload.model", () => {
      runScript(readFixture("subagent-stop-tokens.json"), {
        GUILD_CWD: tmpDir,
        GUILD_RUN_ID: "test-run",
        GUILD_MODEL: "claude-opus-4-6",
      });
      const ev = lastEvent(eventsFile);
      expect(ev.model).toBe("claude-opus-4-6");
    });

    it("omits v2 fields that have no source (absence valid, no nulls)", () => {
      runScript(readFixture("post-tool-use.json"), { GUILD_CWD: tmpDir, GUILD_RUN_ID: "test-run" });
      const ev = lastEvent(eventsFile);
      expect(ev.parent_span_id).toBeUndefined();
      expect(ev.tier).toBeUndefined();
      expect(ev.tokens).toBeUndefined();
      // no field should be null
      for (const v of Object.values(ev)) expect(v).not.toBeNull();
    });

    it("attaches tokens on an LLM-call event (SubagentStop) from payload", () => {
      runScript(readFixture("subagent-stop-tokens.json"), { GUILD_CWD: tmpDir, GUILD_RUN_ID: "test-run" });
      const ev = lastEvent(eventsFile);
      expect(ev.event).toBe("SubagentStop");
      expect(ev.tokens).toEqual({ input: 1200, output: 340, cached: 800, cost_usd: 0.0123 });
    });

    it("never attaches tokens on a non-LLM event (PostToolUse)", () => {
      runScript(readFixture("post-tool-use.json"), { GUILD_CWD: tmpDir, GUILD_RUN_ID: "test-run" });
      const ev = lastEvent(eventsFile);
      expect(ev.tokens).toBeUndefined();
    });
  });

  describe("guild.trace_payload.v1 sidecar (D-OBS-2)", () => {
    function lastEvent(file: string): any {
      const lines = fs.readFileSync(file, "utf8").trim().split("\n").filter(Boolean);
      return JSON.parse(lines[lines.length - 1]);
    }

    it("writes a redacted sidecar and points payload_ref at it", () => {
      runScript(readFixture("post-tool-use.json"), { GUILD_CWD: tmpDir, GUILD_RUN_ID: "test-run" });
      const ev = lastEvent(eventsFile);
      expect(ev.payload_ref).toBe(`logs/payloads/${ev.span_id}.json`);
      const sidecar = path.join(runDir, "logs", "payloads", `${ev.span_id}.json`);
      expect(fs.existsSync(sidecar)).toBe(true);
      const body = JSON.parse(fs.readFileSync(sidecar, "utf8"));
      expect(body.schema_version).toBe("guild.trace_payload.v1");
      expect(body.evt_id).toBe(ev.span_id);
      expect(body.run_id).toBe("test-run");
      expect(body.body.tool).toBe("Write");
      // The structured tool_input is captured; its string leaves pass through
      // the gatekeeper (the long absolute path is high-entropy-redacted — the
      // gatekeeper is intentionally aggressive on slash-paths).
      expect(typeof body.body.tool_input.file_path).toBe("string");
      expect(body.body.tool_input.file_path).toMatch(/\.ts$/);
    });

    it("never stores a raw prompt — only the scrubbed value lands in the sidecar", () => {
      const payload = JSON.stringify({
        session_id: "sess-x",
        cwd: tmpDir,
        hook_event_name: "UserPromptSubmit",
        prompt: "deploy with token=ghp_0123456789012345678901234567890123456789",
      });
      runScript(payload, { GUILD_CWD: tmpDir, GUILD_RUN_ID: "test-run" });
      const ev = lastEvent(eventsFile);
      // event.prompt is scrubbed
      expect(ev.prompt).not.toContain("ghp_0123456789012345678901234567890123456789");
      // sidecar prompt is the scrubbed value too — no raw token anywhere
      const sidecar = path.join(runDir, "logs", "payloads", `${ev.span_id}.json`);
      const body = JSON.parse(fs.readFileSync(sidecar, "utf8"));
      expect(JSON.stringify(body)).not.toContain("ghp_0123456789012345678901234567890123456789");
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
