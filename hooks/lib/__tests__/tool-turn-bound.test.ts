/**
 * hooks/lib/__tests__/tool-turn-bound.test.ts
 *
 * G5(d) — PreToolUse per-tool lifecycle bound (v23x-deferred-followups
 * rf-wi-05, origin oir-wi-59). Pins the pure counting/threshold logic in
 * hooks/lib/tool-turn-bound.ts against a real on-disk `logs/v1.4-events.jsonl`
 * fixture — the exact file capture-telemetry.ts/post-tool-use.ts write to.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import {
  DEFAULT_TOOL_TURN_MAX,
  toolTurnMax,
  countToolCallsThisTurn,
  loadTurnEventLines,
  evaluateToolTurnBound,
  buildToolTurnAskReason,
} from "../tool-turn-bound";

function tmpRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "tool-turn-bound-test-"));
}
function cleanup(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

function writeEventsLog(runDir: string, lines: string[]): void {
  fs.mkdirSync(path.join(runDir, "logs"), { recursive: true });
  fs.writeFileSync(
    path.join(runDir, "logs", "v1.4-events.jsonl"),
    lines.map((l) => JSON.stringify(JSON.parse(l))).join("\n") + "\n",
  );
}

describe("toolTurnMax", () => {
  const ORIGINAL = process.env["GUILD_TOOL_TURN_MAX"];
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env["GUILD_TOOL_TURN_MAX"];
    else process.env["GUILD_TOOL_TURN_MAX"] = ORIGINAL;
  });

  it("defaults to DEFAULT_TOOL_TURN_MAX when unset", () => {
    delete process.env["GUILD_TOOL_TURN_MAX"];
    expect(toolTurnMax(process.env)).toBe(DEFAULT_TOOL_TURN_MAX);
  });

  it("honors a valid GUILD_TOOL_TURN_MAX override", () => {
    expect(toolTurnMax({ GUILD_TOOL_TURN_MAX: "5" })).toBe(5);
  });

  it("ignores a non-numeric/zero/negative override and falls back to the default", () => {
    expect(toolTurnMax({ GUILD_TOOL_TURN_MAX: "not-a-number" })).toBe(DEFAULT_TOOL_TURN_MAX);
    expect(toolTurnMax({ GUILD_TOOL_TURN_MAX: "0" })).toBe(DEFAULT_TOOL_TURN_MAX);
    expect(toolTurnMax({ GUILD_TOOL_TURN_MAX: "-3" })).toBe(DEFAULT_TOOL_TURN_MAX);
  });
});

describe("loadTurnEventLines", () => {
  it("returns [] for a missing file (fail-open)", () => {
    expect(loadTurnEventLines("/no/such/file.jsonl")).toEqual([]);
  });

  it("skips malformed lines without throwing", () => {
    const dir = tmpRoot();
    try {
      const p = path.join(dir, "events.jsonl");
      fs.writeFileSync(p, '{"event":"tool_call"}\nNOT JSON\n{"event":"UserPromptSubmit"}\n');
      const events = loadTurnEventLines(p);
      expect(events).toEqual([{ event: "tool_call" }, { event: "UserPromptSubmit" }]);
    } finally {
      cleanup(dir);
    }
  });
});

describe("countToolCallsThisTurn", () => {
  it("counts every tool call when there is no UserPromptSubmit boundary (run-start default)", () => {
    const events = [{ event: "tool_call" }, { event: "tool_call" }, { event: "PostToolUse" }];
    expect(countToolCallsThisTurn(events)).toBe(3);
  });

  it("counts ONLY tool calls after the most recent UserPromptSubmit", () => {
    const events = [
      { event: "tool_call" }, // before the boundary — must not count
      { event: "tool_call" },
      { event: "UserPromptSubmit" }, // the boundary
      { event: "tool_call" },
      { event: "hook_event" }, // not a tool-call shape — ignored
      { event: "PostToolUse" }, // legacy shape — still counted
    ];
    expect(countToolCallsThisTurn(events)).toBe(2);
  });

  it("returns 0 for an empty log", () => {
    expect(countToolCallsThisTurn([])).toBe(0);
  });
});

describe("evaluateToolTurnBound (G5d)", () => {
  const ORIGINAL = process.env["GUILD_TOOL_TURN_MAX"];
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env["GUILD_TOOL_TURN_MAX"];
    else process.env["GUILD_TOOL_TURN_MAX"] = ORIGINAL;
  });

  it("does not ask when this turn's count is well under threshold", () => {
    const dir = tmpRoot();
    try {
      writeEventsLog(dir, ['{"event":"UserPromptSubmit"}', '{"event":"tool_call"}']);
      const result = evaluateToolTurnBound(dir, { GUILD_TOOL_TURN_MAX: "40" });
      expect(result.ask).toBe(false);
      expect(result.countSoFar).toBe(1);
      expect(result.wouldBeCount).toBe(2);
    } finally {
      cleanup(dir);
    }
  });

  it("asks once the CURRENT call would cross the threshold", () => {
    const dir = tmpRoot();
    try {
      const lines = ['{"event":"UserPromptSubmit"}'];
      for (let i = 0; i < 5; i++) lines.push('{"event":"tool_call"}');
      writeEventsLog(dir, lines);
      // threshold 5: 5 calls so far + 1 pending = 6 > 5 ⇒ ask
      const result = evaluateToolTurnBound(dir, { GUILD_TOOL_TURN_MAX: "5" });
      expect(result.ask).toBe(true);
      expect(result.countSoFar).toBe(5);
      expect(result.wouldBeCount).toBe(6);
      expect(result.threshold).toBe(5);
    } finally {
      cleanup(dir);
    }
  });

  it("does NOT ask at exactly the threshold (over, not at-or-over)", () => {
    const dir = tmpRoot();
    try {
      const lines = ['{"event":"UserPromptSubmit"}'];
      for (let i = 0; i < 4; i++) lines.push('{"event":"tool_call"}');
      writeEventsLog(dir, lines);
      // threshold 5: 4 so far + 1 pending = 5, NOT > 5 ⇒ no ask
      const result = evaluateToolTurnBound(dir, { GUILD_TOOL_TURN_MAX: "5" });
      expect(result.ask).toBe(false);
      expect(result.wouldBeCount).toBe(5);
    } finally {
      cleanup(dir);
    }
  });

  it("is fail-open (never asks) when the run dir / log is missing entirely", () => {
    const result = evaluateToolTurnBound("/no/such/run/dir", { GUILD_TOOL_TURN_MAX: "1" });
    expect(result.ask).toBe(false);
    expect(result.countSoFar).toBe(0);
  });

  it("resets the count on a new UserPromptSubmit boundary (a new turn starts clean)", () => {
    const dir = tmpRoot();
    try {
      const lines = ['{"event":"UserPromptSubmit"}'];
      for (let i = 0; i < 10; i++) lines.push('{"event":"tool_call"}'); // prior turn — would have crossed a low bound
      lines.push('{"event":"UserPromptSubmit"}'); // NEW turn starts here
      lines.push('{"event":"tool_call"}');
      writeEventsLog(dir, lines);
      const result = evaluateToolTurnBound(dir, { GUILD_TOOL_TURN_MAX: "3" });
      expect(result.countSoFar).toBe(1); // only counts since the SECOND UserPromptSubmit
      expect(result.ask).toBe(false);
    } finally {
      cleanup(dir);
    }
  });
});

describe("buildToolTurnAskReason", () => {
  it("names the tool, the count, and the threshold", () => {
    const reason = buildToolTurnAskReason(
      { ask: true, countSoFar: 40, wouldBeCount: 41, threshold: 40 },
      "Bash",
    );
    expect(reason).toContain("Bash");
    expect(reason).toContain("40");
    expect(reason).toContain("41");
  });
});
