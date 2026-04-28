// v1.4.0 — T3d-backend-platform v1.4-gate-prompt integration tests.
// Pins the binding contract from the architect's audit doc + T3b's
// deferred fallback handoff:
//   - AskUserQuestion happy path (tool returns a valid label).
//   - Tool-unavailable fallback to stdin.
//   - Invalid stdin re-prompt (≤ 3 retries).
//   - 4th invalid stdin → stderr error + abort (exit 2).
//   - Empty / off-enum AskUserQuestion result → stdin fallback.
//   - Unified logging via injected EscalationLogger.

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildQuestionText,
  extractAskUserChoice,
  isToolUnavailable,
  promptUserGate,
  STDIN_MAX_RETRIES,
  STDIN_RETRY_LIMIT_MSG,
  type EscalationLogger,
} from "../src/v1.4-gate-prompt.js";
import { initStableLockfile } from "../src/log-jsonl.js";

let tmpRoot: string;
let runDir: string;
const RUN_ID = "test-run-gate-prompt";

beforeEach(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), "guild-gate-prompt-"));
  runDir = join(tmpRoot, ".guild", "runs", RUN_ID);
  // Pre-init the stable lock so default logger can write without
  // racing on initStableLockfile (test isolation).
  initStableLockfile(runDir);
});

afterEach(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
});

function makeRecordingLogger(): {
  logger: EscalationLogger;
  records: Array<{
    runDir: string;
    ts: string;
    run_id: string;
    lane_id?: string;
    reason: string;
    user_choice: string;
  }>;
} {
  const records: Array<{
    runDir: string;
    ts: string;
    run_id: string;
    lane_id?: string;
    reason: string;
    user_choice: string;
  }> = [];
  const logger: EscalationLogger = (params) => {
    records.push(params);
  };
  return { logger, records };
}

describe("isToolUnavailable", () => {
  it("returns true for ToolNotAvailableError name", () => {
    const err = new Error("oops");
    err.name = "ToolNotAvailableError";
    expect(isToolUnavailable(err)).toBe(true);
  });

  it("returns true for 'tool-not-available' substring (case-insensitive)", () => {
    expect(isToolUnavailable(new Error("Tool-Not-Available"))).toBe(true);
    expect(isToolUnavailable(new Error("tool not available"))).toBe(true);
  });

  it("returns true for 'AskUserQuestion ... unavailable'", () => {
    expect(
      isToolUnavailable(new Error("AskUserQuestion is unavailable in this host")),
    ).toBe(true);
  });

  it("returns false for unrelated errors", () => {
    expect(isToolUnavailable(new Error("network timeout"))).toBe(false);
    expect(isToolUnavailable(null)).toBe(false);
    expect(isToolUnavailable(undefined)).toBe(false);
    expect(isToolUnavailable("not an error object")).toBe(false);
  });
});

describe("extractAskUserChoice", () => {
  it("returns the lowercased label for valid input", () => {
    expect(extractAskUserChoice(["force-pass"])).toBe("force-pass");
    expect(extractAskUserChoice(["EXTEND-CAP"])).toBe("extend-cap");
    expect(extractAskUserChoice(["Rework"])).toBe("rework");
  });

  it("returns null for empty / unknown / non-array inputs", () => {
    expect(extractAskUserChoice([])).toBe(null);
    expect(extractAskUserChoice(["unknown"])).toBe(null);
    // @ts-expect-error: testing defensive path
    expect(extractAskUserChoice(undefined)).toBe(null);
  });
});

describe("buildQuestionText", () => {
  it("includes lane id when provided", () => {
    const q = buildQuestionText({ reason: "cap_hit", lane_id: "T3a" });
    expect(q).toContain("lane 'T3a'");
    expect(q).toContain("hit its cap");
  });

  it("uses 'phase' when no lane id", () => {
    const q = buildQuestionText({ reason: "malformed_termination_x2" });
    expect(q).toContain("phase");
    expect(q).toContain("malformed terminations");
  });

  it("appends optional context", () => {
    const q = buildQuestionText({
      reason: "restart_cap_hit",
      lane_id: "T3b",
      context: "round 4",
    });
    expect(q).toContain("round 4");
  });
});

describe("promptUserGate — AskUserQuestion happy path", () => {
  it("returns the chosen label and emits an escalation event", async () => {
    const { logger, records } = makeRecordingLogger();
    const askUserQuestion = vi.fn(async () => ["force-pass"]);

    const result = await promptUserGate("test question", {
      runDir,
      run_id: RUN_ID,
      lane_id: "T3a",
      reason: "cap_hit",
      askUserQuestion,
      logger,
    });

    expect(result.user_choice).toBe("force-pass");
    expect(result.source).toBe("ask-user-question");
    expect(result.retries).toBe(0);
    expect(askUserQuestion).toHaveBeenCalledOnce();
    expect(records).toHaveLength(1);
    expect(records[0]?.reason).toBe("cap_hit");
    expect(records[0]?.user_choice).toBe("force-pass");
    expect(records[0]?.lane_id).toBe("T3a");
  });
});

describe("promptUserGate — tool-unavailable fallback to stdin", () => {
  it("falls back to stdin when AskUserQuestion throws ToolNotAvailable", async () => {
    const { logger, records } = makeRecordingLogger();
    const askUserQuestion = vi.fn(async () => {
      const err = new Error("tool-not-available");
      err.name = "ToolNotAvailableError";
      throw err;
    });
    const stderrLines: string[] = [];
    const stderr = { write: (s: string) => void stderrLines.push(s) };
    const readStdinLine = vi.fn(async () => "extend-cap\n");

    const result = await promptUserGate("test question", {
      runDir,
      run_id: RUN_ID,
      reason: "cap_hit",
      askUserQuestion,
      readStdinLine,
      logger,
      stderr,
    });

    expect(result.user_choice).toBe("extend-cap");
    expect(result.source).toBe("stdin-fallback");
    expect(result.retries).toBe(0);
    expect(askUserQuestion).toHaveBeenCalledOnce();
    expect(readStdinLine).toHaveBeenCalledOnce();
    expect(records).toHaveLength(1);
    expect(records[0]?.user_choice).toBe("extend-cap");
    // Stderr lines include the formatted prompt block.
    const joined = stderrLines.join("");
    expect(joined).toContain("force-pass");
    expect(joined).toContain("extend-cap");
    expect(joined).toContain("rework");
  });

  it("falls back to stdin when AskUserQuestion is undefined", async () => {
    const { logger, records } = makeRecordingLogger();
    const stderr = { write: vi.fn() };
    const readStdinLine = vi.fn(async () => "rework");

    const result = await promptUserGate("q", {
      runDir,
      run_id: RUN_ID,
      reason: "malformed_termination_x2",
      readStdinLine,
      logger,
      stderr,
    });

    expect(result.user_choice).toBe("rework");
    expect(result.source).toBe("stdin-fallback");
    expect(records).toHaveLength(1);
  });

  it("falls back when AskUserQuestion returns an off-enum label", async () => {
    const { logger, records } = makeRecordingLogger();
    const askUserQuestion = vi.fn(async () => ["weird-label"]);
    const stderr = { write: vi.fn() };
    const readStdinLine = vi.fn(async () => "force-pass");

    const result = await promptUserGate("q", {
      runDir,
      run_id: RUN_ID,
      reason: "restart_cap_hit",
      askUserQuestion,
      readStdinLine,
      logger,
      stderr,
    });

    expect(result.source).toBe("stdin-fallback");
    expect(result.user_choice).toBe("force-pass");
    expect(records).toHaveLength(1);
  });

  it("re-throws unexpected (non tool-unavailable) errors from AskUserQuestion", async () => {
    const { logger } = makeRecordingLogger();
    const askUserQuestion = vi.fn(async () => {
      throw new Error("network is down");
    });

    await expect(
      promptUserGate("q", {
        runDir,
        run_id: RUN_ID,
        reason: "cap_hit",
        askUserQuestion,
        logger,
      }),
    ).rejects.toThrow("network is down");
  });
});

describe("promptUserGate — stdin re-prompt loop", () => {
  it("re-prompts on invalid input up to 3 retries before aborting", async () => {
    const { logger, records } = makeRecordingLogger();
    const stderrLines: string[] = [];
    const stderr = { write: (s: string) => void stderrLines.push(s) };
    const readStdinLine = vi
      .fn()
      .mockResolvedValueOnce("garbage")
      .mockResolvedValueOnce("also bad")
      .mockResolvedValueOnce("rework"); // third attempt valid

    const result = await promptUserGate("q", {
      runDir,
      run_id: RUN_ID,
      reason: "cap_hit",
      readStdinLine,
      logger,
      stderr,
    });

    expect(result.user_choice).toBe("rework");
    expect(result.source).toBe("stdin-fallback");
    expect(result.retries).toBe(2);
    expect(readStdinLine).toHaveBeenCalledTimes(3);
    expect(records).toHaveLength(1);
    // We re-prompted twice → 2 "Invalid choice." stderr lines.
    const invalidLines = stderrLines.filter((s) => s.startsWith("Invalid choice."));
    expect(invalidLines).toHaveLength(2);
  });

  it("aborts with exit 2 message after 4th invalid input", async () => {
    const { logger, records } = makeRecordingLogger();
    const stderrLines: string[] = [];
    const stderr = { write: (s: string) => void stderrLines.push(s) };
    const readStdinLine = vi.fn(async () => "garbage");
    const abort = vi.fn(() => {
      throw new Error("ABORT_CALLED");
    }) as () => never;

    await expect(
      promptUserGate("q", {
        runDir,
        run_id: RUN_ID,
        reason: "cap_hit",
        readStdinLine,
        logger,
        stderr,
        abort,
      }),
    ).rejects.toThrow("ABORT_CALLED");

    // 1 initial + STDIN_MAX_RETRIES retries = 4 total reads.
    expect(readStdinLine).toHaveBeenCalledTimes(STDIN_MAX_RETRIES + 1);
    expect(abort).toHaveBeenCalledOnce();
    expect(records).toHaveLength(0); // No successful resolution → no log emit.
    // Architect's verbatim stderr message must appear.
    const joined = stderrLines.join("");
    expect(joined).toContain(STDIN_RETRY_LIMIT_MSG);
  });

  it("STDIN_MAX_RETRIES is exactly 3", () => {
    expect(STDIN_MAX_RETRIES).toBe(3);
  });

  it("STDIN_RETRY_LIMIT_MSG includes the architect's exit-2 hint", () => {
    expect(STDIN_RETRY_LIMIT_MSG).toContain("exit 2");
    expect(STDIN_RETRY_LIMIT_MSG).toContain("--loops=none");
  });
});

describe("promptUserGate — error guards", () => {
  it("throws TypeError when both AskUserQuestion and stdin fallback are absent", async () => {
    const { logger } = makeRecordingLogger();
    await expect(
      promptUserGate("q", {
        runDir,
        run_id: RUN_ID,
        reason: "cap_hit",
        logger,
      }),
    ).rejects.toThrow(TypeError);
  });
});
