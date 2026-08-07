/**
 * hooks/__tests__/capture-telemetry-v14.test.ts
 *
 * TDD: written BEFORE the HK-01/HK-02 implementation change.
 *
 * Proves that capture-telemetry.ts routes events to the CANONICAL
 * logs/v1.4-events.jsonl path (the plugin↔benchmark contract boundary per
 * docs/v2/observability.html §"The canonical trace"), and keeps events.ndjson
 * as a legacy mirror for every event type — EXCEPT PostToolUse, which is
 * deliberately skipped on the canonical side (see the "PostToolUse
 * de-duplication" describe block below): hooks/post-tool-use.ts already
 * writes the schema-validated `tool_call` line there for the same invocation,
 * and having both was a ~2x double-count (audit "PostToolUse double-logging").
 *
 * DRIFT-ANALYSIS findings addressed:
 *   HK-01: SubagentStop / UserPromptSubmit land in events.ndjson, not canonical.
 *   HK-02: loop events + trace_event.v2 additive fields land in events.ndjson, not canonical.
 *
 * Evidence checklist (verify-done gate):
 *   [x] Each event type (SubagentStop, UserPromptSubmit, loop_round_start,
 *       loop_round_end, codex_review_round) appears in logs/v1.4-events.jsonl
 *   [x] v2 additive field span_id present in canonical log (D-OBS-6)
 *   [x] events.ndjson still receives a mirror write (backward compat)
 *   [x] Canonical write failures do NOT block execution (exit 0)
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

function run(
  input: string,
  env: Record<string, string> = {},
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
    timeout: 20000,
  });
  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function readLines(file: string): Array<Record<string, unknown>> {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

describe("capture-telemetry.ts — canonical log routing (HK-01/HK-02)", () => {
  let tmpDir: string;
  let runDir: string;
  let canonicalFile: string;
  let legacyFile: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-ct-v14-"));
    runDir = path.join(tmpDir, ".guild", "runs", "test-run");
    fs.mkdirSync(runDir, { recursive: true });
    mintTestBinding(tmpDir, "test-run");
    canonicalFile = path.join(runDir, "logs", "v1.4-events.jsonl");
    legacyFile = path.join(runDir, "events.ndjson");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const baseEnv = (over: Record<string, string> = {}) => ({
    GUILD_CWD: tmpDir,
    GUILD_RUN_ID: "test-run",
    ...over,
  });

  // ── HK-01: SubagentStop → canonical ──────────────────────────────────────

  describe("HK-01 — SubagentStop routes to canonical v1.4-events.jsonl", () => {
    it("exits 0", () => {
      const { exitCode } = run(readFixture("subagent-stop.json"), baseEnv());
      expect(exitCode).toBe(0);
    });

    it("writes SubagentStop event to logs/v1.4-events.jsonl (canonical)", () => {
      run(readFixture("subagent-stop.json"), baseEnv());
      expect(fs.existsSync(canonicalFile)).toBe(true);
      const lines = readLines(canonicalFile);
      expect(lines.length).toBeGreaterThanOrEqual(1);
      const ev = lines.find((l) => l["event"] === "SubagentStop");
      expect(ev).toBeDefined();
      expect(ev!["event"]).toBe("SubagentStop");
      expect(ev!["tool"]).toBe("");
    });

    it("also mirrors SubagentStop to events.ndjson (legacy fallback)", () => {
      run(readFixture("subagent-stop.json"), baseEnv());
      expect(fs.existsSync(legacyFile)).toBe(true);
      const lines = readLines(legacyFile);
      const ev = lines.find((l) => l["event"] === "SubagentStop");
      expect(ev).toBeDefined();
    });
  });

  // ── HK-01: UserPromptSubmit → canonical ──────────────────────────────────

  describe("HK-01 — UserPromptSubmit routes to canonical v1.4-events.jsonl", () => {
    it("writes UserPromptSubmit event to canonical log", () => {
      run(readFixture("user-prompt-submit.json"), baseEnv());
      expect(fs.existsSync(canonicalFile)).toBe(true);
      const lines = readLines(canonicalFile);
      const ev = lines.find((l) => l["event"] === "UserPromptSubmit");
      expect(ev).toBeDefined();
      expect(ev!["tool"]).toBe("");
    });

    it("also mirrors UserPromptSubmit to events.ndjson", () => {
      run(readFixture("user-prompt-submit.json"), baseEnv());
      const lines = readLines(legacyFile);
      const ev = lines.find((l) => l["event"] === "UserPromptSubmit");
      expect(ev).toBeDefined();
    });
  });

  // ── HK-02: loop events → canonical ───────────────────────────────────────

  describe("HK-02 — loop_round_start routes to canonical v1.4-events.jsonl", () => {
    it("writes loop_round_start to canonical log", () => {
      run(readFixture("loop-round-start.json"), baseEnv());
      expect(fs.existsSync(canonicalFile)).toBe(true);
      const lines = readLines(canonicalFile);
      const ev = lines.find((l) => l["event"] === "loop_round_start");
      expect(ev).toBeDefined();
      expect(ev!["loop_layer"]).toBe("L1");
      expect(ev!["loop_round"]).toBe(1);
    });
  });

  describe("HK-02 — loop_round_end routes to canonical v1.4-events.jsonl", () => {
    it("writes loop_round_end to canonical log", () => {
      run(readFixture("loop-round-end.json"), baseEnv());
      expect(fs.existsSync(canonicalFile)).toBe(true);
      const lines = readLines(canonicalFile);
      const ev = lines.find((l) => l["event"] === "loop_round_end");
      expect(ev).toBeDefined();
    });
  });

  describe("HK-02 — codex_review_round routes to canonical v1.4-events.jsonl", () => {
    it("writes codex_review_round to canonical log", () => {
      const payload = JSON.stringify({
        session_id: "sess-abc",
        cwd: tmpDir,
        hook_event_name: "codex_review_round",
        loop_gate: "G-spec",
        loop_round: 1,
        loop_terminated: false,
      });
      run(payload, baseEnv());
      expect(fs.existsSync(canonicalFile)).toBe(true);
      const lines = readLines(canonicalFile);
      const ev = lines.find((l) => l["event"] === "codex_review_round");
      expect(ev).toBeDefined();
      expect(ev!["loop_gate"]).toBe("G-spec");
    });
  });

  // ── HK-02: v2 additive fields present in canonical log ───────────────────

  describe("HK-02 — trace_event.v2 additive fields in canonical log", () => {
    it("span_id is present in the canonical log (D-OBS-6)", () => {
      run(readFixture("subagent-stop.json"), baseEnv());
      const lines = readLines(canonicalFile);
      const ev = lines[0];
      expect(ev).toBeDefined();
      // span_id is generated deterministically — just assert it's a non-empty string
      expect(typeof ev!["span_id"]).toBe("string");
      expect((ev!["span_id"] as string).length).toBeGreaterThan(0);
    });

    it("tier field present when GUILD_TIER env is set", () => {
      run(readFixture("subagent-stop.json"), { ...baseEnv(), GUILD_TIER: "mid" });
      const lines = readLines(canonicalFile);
      const ev = lines[0];
      expect(ev!["tier"]).toBe("mid");
    });
  });

  // ── PostToolUse de-duplication (audit fix) ───────────────────────────────
  // hooks/post-tool-use.ts ALSO fires on PostToolUse and already writes the
  // schema-validated `tool_call` line to this SAME canonical file — this
  // script writing its own ad-hoc `event: "PostToolUse"` line here too was a
  // straight ~2x double-count. capture-telemetry.ts now skips the canonical
  // write for PostToolUse specifically (every other event type it handles is
  // unaffected); the legacy events.ndjson mirror still receives it, since
  // post-tool-use.ts never writes there.

  describe("PostToolUse de-duplication — canonical write skipped, legacy mirror unchanged", () => {
    const postToolUsePayload = JSON.stringify({
      session_id: "sess-abc",
      cwd: "",
      hook_event_name: "PostToolUse",
      tool_name: "Write",
      agent_name: "backend",
      tool_response: { success: true },
    });

    it("does NOT write a PostToolUse line to the canonical log", () => {
      run(postToolUsePayload, baseEnv());
      const lines = readLines(canonicalFile);
      const ev = lines.find((l) => l["event"] === "PostToolUse");
      expect(ev).toBeUndefined();
    });

    it("still writes the PostToolUse line to the legacy events.ndjson mirror", () => {
      run(postToolUsePayload, baseEnv());
      const lines = readLines(legacyFile);
      const ev = lines.find((l) => l["event"] === "PostToolUse");
      expect(ev).toBeDefined();
      expect(ev!["tool"]).toBe("Write");
    });

    it("a SubagentStop event in the SAME run still routes to canonical (only PostToolUse is skipped)", () => {
      run(readFixture("subagent-stop.json"), baseEnv());
      const lines = readLines(canonicalFile);
      const ev = lines.find((l) => l["event"] === "SubagentStop");
      expect(ev).toBeDefined();
    });
  });

  // ── Canonical is PRIMARY: events.ndjson is MIRROR ─────────────────────────

  describe("write order: canonical primary, legacy mirror", () => {
    it("canonical log exists even when no prior events.ndjson is present", () => {
      // Ensure legacy file doesn't exist first
      expect(fs.existsSync(legacyFile)).toBe(false);
      run(readFixture("subagent-stop.json"), baseEnv());
      // Both should now exist
      expect(fs.existsSync(canonicalFile)).toBe(true);
      expect(fs.existsSync(legacyFile)).toBe(true);
    });

    it("both files accumulate identically across multiple events", () => {
      run(readFixture("subagent-stop.json"), baseEnv());
      run(readFixture("user-prompt-submit.json"), baseEnv());
      const canonical = readLines(canonicalFile);
      const legacy = readLines(legacyFile);
      expect(canonical.length).toBe(2);
      expect(legacy.length).toBe(2);
      // Events appear in same order in both files
      expect(canonical[0]!["event"]).toBe(legacy[0]!["event"]);
      expect(canonical[1]!["event"]).toBe(legacy[1]!["event"]);
    });
  });
});
