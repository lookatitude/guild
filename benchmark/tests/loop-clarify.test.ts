// v1.4.0 — T3b-backend-loops pinning tests for guild:loop-clarify (F-1, L1).
//
// Architect contract: benchmark/plans/v1.4-loop-skill-contracts.md
//   §"Skill 1 — guild:loop-clarify".
//
// Verify-done literals pinned in this file:
//   - sentinel `## NO MORE QUESTIONS`
//   - regex literals /^.*\?\s*$/m, /^\s*[-*]\s+(blocker|must fix|cannot proceed|MUST|BLOCKING)\b/im, /\b(TODO|FIXME|XXX)\b/
//   - escalation labels force-pass / extend-cap / rework

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getGlobal } from "../src/counter-store.js";
import { runLoopClarify } from "../src/loop-drivers.js";
import {
  ESCALATION_LABELS,
  buildEscalationPayload,
  buildExtendCapPayload,
  ESCALATION_DESCRIPTIONS,
  formatFallbackPrompt,
  parseCustomExtension,
  parseFallbackChoice,
} from "../src/loop-escalation.js";
import { InMemoryLoopJsonlAppender } from "../src/loop-jsonl-stub.js";
import {
  detectSentinel,
  LOOP_SENTINEL,
  POST_SENTINEL_PATTERNS,
  POST_SENTINEL_PATTERN_1,
  POST_SENTINEL_PATTERN_2,
  POST_SENTINEL_PATTERN_3,
} from "../src/loop-sentinel.js";

let tmpRoot: string;
let runDir: string;
const RUN_ID = "test-run-loop-clarify";

beforeEach(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), "guild-loop-clarify-"));
  runDir = join(tmpRoot, "runs", RUN_ID);
});

afterEach(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
});

// ──────────────────────────────────────────────────────────────────────────
// Sentinel literal — verify-done greps for `## NO MORE QUESTIONS`.
// ──────────────────────────────────────────────────────────────────────────

describe("loop-clarify / sentinel literal contract", () => {
  it("LOOP_SENTINEL is the exact literal `## NO MORE QUESTIONS`", () => {
    expect(LOOP_SENTINEL).toBe("## NO MORE QUESTIONS");
  });

  it("post-sentinel regex set is the architect's three patterns in order", () => {
    expect(POST_SENTINEL_PATTERNS).toHaveLength(3);
    // Pattern 1 — `/^.*\?\s*$/m`
    expect(POST_SENTINEL_PATTERN_1.source).toBe("^.*\\?\\s*$");
    expect(POST_SENTINEL_PATTERN_1.flags).toBe("m");
    // Pattern 2 — `/^\s*[-*]\s+(blocker|must fix|cannot proceed|MUST|BLOCKING)\b/im`
    expect(POST_SENTINEL_PATTERN_2.source).toBe(
      "^\\s*[-*]\\s+(blocker|must fix|cannot proceed|MUST|BLOCKING)\\b",
    );
    expect(POST_SENTINEL_PATTERN_2.flags).toBe("im");
    // Pattern 3 — `/\b(TODO|FIXME|XXX)\b/`
    expect(POST_SENTINEL_PATTERN_3.source).toBe("\\b(TODO|FIXME|XXX)\\b");
    expect(POST_SENTINEL_PATTERN_3.flags).toBe("");
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Sentinel detection — happy path / boundary / negative.
// ──────────────────────────────────────────────────────────────────────────

describe("loop-clarify / detectSentinel — sentinel cases", () => {
  it("returns `clean` when sentinel appears alone on its own line at end of body", () => {
    const body = `Researcher analysis: brief is clear; constraints align.\n\n## NO MORE QUESTIONS\n`;
    const r = detectSentinel(body);
    expect(r.kind).toBe("clean");
  });

  it("returns `clean` for boundary case: sentinel only, no body before or after", () => {
    const body = `## NO MORE QUESTIONS`;
    const r = detectSentinel(body);
    expect(r.kind).toBe("clean");
    if (r.kind === "clean") {
      expect(r.bodyBeforeSentinel).toBe("");
      expect(r.bodyAfterSentinel).toBe("");
    }
  });

  it("returns `no_sentinel` when the body has no sentinel line", () => {
    const body = `Researcher: still has questions about the brief.\n\nWhat is the target persona?`;
    const r = detectSentinel(body);
    expect(r.kind).toBe("no_sentinel");
  });

  it("does NOT match sentinel as bullet decoration or inline text", () => {
    // Bullet variant - line is `- ## NO MORE QUESTIONS`, trim != sentinel.
    const body1 = `- ## NO MORE QUESTIONS\n`;
    expect(detectSentinel(body1).kind).toBe("no_sentinel");
    // Inline variant - sentinel embedded in a sentence.
    const body2 = `We're not at ## NO MORE QUESTIONS yet.\n`;
    expect(detectSentinel(body2).kind).toBe("no_sentinel");
  });
});

describe("loop-clarify / detectSentinel — malformed-termination cases", () => {
  it("matches Pattern 1 (post-sentinel question) → malformed_termination", () => {
    const body = `Analysis...\n\n## NO MORE QUESTIONS\n\nactually, are you sure?\n`;
    const r = detectSentinel(body);
    expect(r.kind).toBe("malformed_termination");
    if (r.kind === "malformed_termination") {
      expect(r.reason).toBe("post_sentinel_question");
    }
  });

  it("matches Pattern 2 (post-sentinel hard-blocker bullet) → malformed_termination", () => {
    const body = `Analysis...\n\n## NO MORE QUESTIONS\n\n- BLOCKING: review threat model\n`;
    const r = detectSentinel(body);
    expect(r.kind).toBe("malformed_termination");
    if (r.kind === "malformed_termination") {
      expect(r.reason).toBe("post_sentinel_blocker_bullet");
    }
  });

  it("matches Pattern 3 (post-sentinel TODO marker) → malformed_termination", () => {
    const body = `Analysis...\n\n## NO MORE QUESTIONS\n\nTODO: rerun with bigger sample\n`;
    const r = detectSentinel(body);
    expect(r.kind).toBe("malformed_termination");
    if (r.kind === "malformed_termination") {
      expect(r.reason).toBe("post_sentinel_todo_marker");
    }
  });

  it("does NOT false-positive Pattern 3 on words like `Fixmebox` (word-boundary)", () => {
    const body = `Analysis...\n\n## NO MORE QUESTIONS\n\nFixmebox: noted. autofixme: also noted.\n`;
    const r = detectSentinel(body);
    expect(r.kind).toBe("clean");
  });

  it("treats multiple sentinel occurrences as malformed_termination", () => {
    const body = `## NO MORE QUESTIONS\n\nbody\n\n## NO MORE QUESTIONS\n`;
    const r = detectSentinel(body);
    expect(r.kind).toBe("malformed_termination");
    if (r.kind === "malformed_termination") {
      expect(r.reason).toBe("multiple_sentinel_occurrences");
    }
  });

  it("does NOT match the removed `concern|issue|gap|missing|undefined` keyword set (regression guard)", () => {
    // Round-2 Codex review removed this set due to false positives.
    // "no concerns remain" is a legitimate phrasing post-sentinel.
    const body = `Analysis...\n\n## NO MORE QUESTIONS\n\nNo concerns remain. No issues. Nothing missing.\n`;
    const r = detectSentinel(body);
    expect(r.kind).toBe("clean");
  });

  it("Pattern 1 ignores question-marks BEFORE the sentinel (those are legitimate audit trail)", () => {
    const body = `Round 1: what is the persona?\nRound 2: clarified.\n\n## NO MORE QUESTIONS\n`;
    const r = detectSentinel(body);
    expect(r.kind).toBe("clean");
  });
});

// ──────────────────────────────────────────────────────────────────────────
// L1 happy-path / cap-hit / malformed escalation through runLoopClarify.
// ──────────────────────────────────────────────────────────────────────────

describe("loop-clarify / runLoopClarify — happy paths", () => {
  it("agree-immediately: round 1 returns clean sentinel → status satisfied", async () => {
    const jsonl = new InMemoryLoopJsonlAppender();
    const out = await runLoopClarify({
      brief: "Brief about feature X.",
      loops_mode: "spec",
      cap: 8,
      run_id: RUN_ID,
      runDir,
      jsonl,
      roundFn: () => ({
        body: `Researcher: brief is well-scoped.\n\n## NO MORE QUESTIONS\n`,
        terminator: "researcher",
      }),
      escalationFn: () => "force-pass",
    });
    expect(out.status).toBe("satisfied");
    expect(out.rounds).toBe(1);
    expect(out.next).toBe("guild:brainstorm");
    expect(getGlobal(runDir, RUN_ID, "l1_round")).toBe(1);
  });

  it("3-round-converge: rounds 1-2 ask questions, round 3 returns clean sentinel", async () => {
    const jsonl = new InMemoryLoopJsonlAppender();
    const responses = [
      "Researcher: who is the persona?\nWhat is the success metric?",
      "Researcher: thanks for clarifying. One more — is this internal or external?",
      "Researcher: brief is now scoped.\n\n## NO MORE QUESTIONS\n",
    ];
    let n = 0;
    const out = await runLoopClarify({
      brief: "Brief about feature X.",
      loops_mode: "all",
      cap: 8,
      run_id: RUN_ID,
      runDir,
      jsonl,
      roundFn: () => ({ body: responses[n++] as string, terminator: "researcher" }),
      escalationFn: () => "force-pass",
    });
    expect(out.status).toBe("satisfied");
    expect(out.rounds).toBe(3);
    expect(getGlobal(runDir, RUN_ID, "l1_round")).toBe(3);
  });

  it("emits loop_round_start + loop_round_end JSONL events with correct envelope per round", async () => {
    const jsonl = new InMemoryLoopJsonlAppender();
    await runLoopClarify({
      brief: "Brief.",
      loops_mode: "spec",
      cap: 8,
      run_id: RUN_ID,
      runDir,
      jsonl,
      roundFn: () => ({
        body: `## NO MORE QUESTIONS\n`,
        terminator: "researcher",
      }),
      escalationFn: () => "force-pass",
    });
    const starts = jsonl.byType("loop_round_start");
    const ends = jsonl.byType("loop_round_end");
    expect(starts).toHaveLength(1);
    expect(ends).toHaveLength(1);
    expect(starts[0]?.lane_id).toBe("phase:brainstorm");
    expect(starts[0]?.loop_layer).toBe("L1");
    expect(starts[0]?.cap).toBe(8);
    expect(ends[0]?.terminated).toBe("satisfied");
    expect(ends[0]?.terminator).toBe("researcher");
  });
});

describe("loop-clarify / runLoopClarify — cap-hit + escalation routing", () => {
  it("cap-hit at cap=2 dispatches escalationFn with reason cap_hit; force-pass returns escalated/satisfied semantics", async () => {
    const jsonl = new InMemoryLoopJsonlAppender();
    const reasons: string[] = [];
    const out = await runLoopClarify({
      brief: "Brief.",
      loops_mode: "spec",
      cap: 2,
      run_id: RUN_ID,
      runDir,
      jsonl,
      roundFn: () => ({
        body: `Researcher: still many questions remain.\nWhy is the persona unclear?`,
        terminator: "researcher",
      }),
      escalationFn: (reason) => {
        reasons.push(reason);
        return "force-pass";
      },
    });
    expect(reasons).toEqual(["cap_hit"]);
    expect(out.status).toBe("escalated");
    expect(out.next).toBe("guild:brainstorm");
    expect(out.unresolved_questions.length).toBeGreaterThan(0);
    // Escalation event captured.
    const escs = jsonl.byType("escalation");
    expect(escs).toHaveLength(1);
    expect(escs[0]?.reason).toBe("cap_hit");
    expect(escs[0]?.options_offered).toEqual(ESCALATION_LABELS);
    expect(escs[0]?.user_choice).toBe("force-pass");
  });

  it("cap-hit + rework returns status=rework, next=abort", async () => {
    const jsonl = new InMemoryLoopJsonlAppender();
    const out = await runLoopClarify({
      brief: "Brief.",
      loops_mode: "spec",
      cap: 2,
      run_id: RUN_ID,
      runDir,
      jsonl,
      roundFn: () => ({ body: `still asking?`, terminator: "researcher" }),
      escalationFn: () => "rework",
    });
    expect(out.status).toBe("rework");
    expect(out.next).toBe("abort");
  });

  it("two-consecutive-malformed escalates with reason malformed_termination_x2", async () => {
    const jsonl = new InMemoryLoopJsonlAppender();
    const reasons: string[] = [];
    let n = 0;
    const out = await runLoopClarify({
      brief: "Brief.",
      loops_mode: "spec",
      cap: 8,
      run_id: RUN_ID,
      runDir,
      jsonl,
      roundFn: () => {
        n++;
        // Both rounds emit sentinel + post-sentinel question (malformed).
        return {
          body: `Analysis ${n}.\n\n## NO MORE QUESTIONS\n\nis this right?\n`,
          terminator: "researcher",
        };
      },
      escalationFn: (reason) => {
        reasons.push(reason);
        return "force-pass";
      },
    });
    expect(reasons).toEqual(["malformed_termination_x2"]);
    expect(out.status).toBe("escalated");
  });
});

// ──────────────────────────────────────────────────────────────────────────
// AskUserQuestion payload + extend-cap + fallback prompt formatters.
// ──────────────────────────────────────────────────────────────────────────

describe("loop-clarify / AskUserQuestion payload (binding contract)", () => {
  it("buildEscalationPayload emits header `Loop escalation`, multiSelect=false, three options", () => {
    const p = buildEscalationPayload("Cap reached at L1 (16 rounds).");
    expect(p.questions).toHaveLength(1);
    const q = p.questions[0];
    expect(q?.header).toBe("Loop escalation");
    expect(q?.multiSelect).toBe(false);
    expect(q?.options.map((o) => o.label)).toEqual([
      "force-pass",
      "extend-cap",
      "rework",
    ]);
  });

  it("each option's description matches the architect's literal text", () => {
    const p = buildEscalationPayload("...");
    const opts = p.questions[0]?.options;
    expect(opts?.[0]?.description).toBe(
      ESCALATION_DESCRIPTIONS["force-pass"],
    );
    expect(opts?.[1]?.description).toBe(ESCALATION_DESCRIPTIONS["extend-cap"]);
    expect(opts?.[2]?.description).toBe(ESCALATION_DESCRIPTIONS.rework);
  });

  it("buildExtendCapPayload presents 4 options: 4 / 8 / 16 / custom", () => {
    const p = buildExtendCapPayload();
    const labels = p.questions[0]?.options.map((o) => o.label);
    expect(labels).toEqual(["4", "8", "16", "custom"]);
  });

  it("parseCustomExtension accepts positive integers ≤ 256 and rejects out-of-range / non-integer", () => {
    expect(parseCustomExtension("4")).toBe(4);
    expect(parseCustomExtension("256")).toBe(256);
    expect(parseCustomExtension("0")).toBeNull();
    expect(parseCustomExtension("-1")).toBeNull();
    expect(parseCustomExtension("257")).toBeNull();
    expect(parseCustomExtension("1.5")).toBeNull();
    expect(parseCustomExtension("abc")).toBeNull();
    expect(parseCustomExtension("")).toBeNull();
  });
});

describe("loop-clarify / AskUserQuestion-unavailable fallback", () => {
  it("formatFallbackPrompt prints all three labels in order", () => {
    const fp = formatFallbackPrompt("Cap reached.");
    const joined = fp.stderrLines.join("\n");
    expect(joined).toMatch(/force-pass/);
    expect(joined).toMatch(/extend-cap/);
    expect(joined).toMatch(/rework/);
  });

  it("parseFallbackChoice accepts the three labels case-insensitively and trims", () => {
    expect(parseFallbackChoice("force-pass")).toBe("force-pass");
    expect(parseFallbackChoice("  Force-Pass  ")).toBe("force-pass");
    expect(parseFallbackChoice("EXTEND-CAP")).toBe("extend-cap");
    expect(parseFallbackChoice("rework\n")).toBe("rework");
  });

  it("parseFallbackChoice rejects unknown labels", () => {
    expect(parseFallbackChoice("retry")).toBeNull();
    expect(parseFallbackChoice("")).toBeNull();
    expect(parseFallbackChoice("force pass")).toBeNull(); // space, not hyphen
  });
});
