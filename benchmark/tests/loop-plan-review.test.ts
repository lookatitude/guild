// v1.4.0 — T3b-backend-loops pinning tests for guild:loop-plan-review (F-2, L2).
//
// Architect contract: benchmark/plans/v1.4-loop-skill-contracts.md
//   §"Skill 2 — guild:loop-plan-review".
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
import { runLoopPlanReview } from "../src/loop-drivers.js";
import {
  ESCALATION_LABELS,
  ESCALATION_DESCRIPTIONS,
  buildEscalationPayload,
} from "../src/loop-escalation.js";
import { InMemoryLoopJsonlAppender } from "../src/loop-jsonl-stub.js";
import {
  detectSentinel,
  POST_SENTINEL_PATTERN_1,
  POST_SENTINEL_PATTERN_2,
  POST_SENTINEL_PATTERN_3,
} from "../src/loop-sentinel.js";

let tmpRoot: string;
let runDir: string;
const RUN_ID = "test-run-loop-plan-review";

beforeEach(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), "guild-loop-plan-review-"));
  runDir = join(tmpRoot, "runs", RUN_ID);
});

afterEach(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
});

// ──────────────────────────────────────────────────────────────────────────
// Same sentinel + post-sentinel regex set as L1 (shared termination contract).
// ──────────────────────────────────────────────────────────────────────────

describe("loop-plan-review / sentinel literal contract is shared with L1", () => {
  it("Pattern 1 verbatim: /^.*\\?\\s*$/m", () => {
    expect(POST_SENTINEL_PATTERN_1.source).toBe("^.*\\?\\s*$");
    expect(POST_SENTINEL_PATTERN_1.flags).toBe("m");
  });

  it("Pattern 2 verbatim: /^\\s*[-*]\\s+(blocker|must fix|cannot proceed|MUST|BLOCKING)\\b/im", () => {
    expect(POST_SENTINEL_PATTERN_2.source).toBe(
      "^\\s*[-*]\\s+(blocker|must fix|cannot proceed|MUST|BLOCKING)\\b",
    );
    expect(POST_SENTINEL_PATTERN_2.flags).toBe("im");
  });

  it("Pattern 3 verbatim: /\\b(TODO|FIXME|XXX)\\b/", () => {
    expect(POST_SENTINEL_PATTERN_3.source).toBe("\\b(TODO|FIXME|XXX)\\b");
    expect(POST_SENTINEL_PATTERN_3.flags).toBe("");
  });

  it("Pattern 2 matches `- MUST review the threat model` (post-sentinel hard-blocker)", () => {
    const body = `Plan review.\n\n## NO MORE QUESTIONS\n\n- MUST review the threat model\n`;
    const r = detectSentinel(body);
    expect(r.kind).toBe("malformed_termination");
    if (r.kind === "malformed_termination") {
      expect(r.reason).toBe("post_sentinel_blocker_bullet");
    }
  });
});

// ──────────────────────────────────────────────────────────────────────────
// L2 happy paths.
// ──────────────────────────────────────────────────────────────────────────

describe("loop-plan-review / runLoopPlanReview — happy paths", () => {
  it("agree-immediately: round 1 returns clean sentinel → status satisfied, next gate-3-plan-approval", async () => {
    const jsonl = new InMemoryLoopJsonlAppender();
    const out = await runLoopPlanReview({
      plan_path: ".guild/plan/test.md",
      spec_path: ".guild/spec/test.md",
      loops_mode: "plan",
      cap: 8,
      run_id: RUN_ID,
      runDir,
      jsonl,
      roundFn: () => ({
        body: `Security: plan is well-scoped; no defects.\n\n## NO MORE QUESTIONS\n`,
        terminator: "security",
      }),
      escalationFn: () => "force-pass",
    });
    expect(out.status).toBe("satisfied");
    expect(out.rounds).toBe(1);
    expect(out.next).toBe("gate-3-plan-approval");
    expect(getGlobal(runDir, RUN_ID, "l2_round")).toBe(1);
  });

  it("3-round-converge: rounds 1-2 raise plan defects, round 3 returns sentinel", async () => {
    const jsonl = new InMemoryLoopJsonlAppender();
    const responses = [
      "Security: lane T2 has overlapping scope with T1 — what's the boundary?",
      "Security: thanks; one more — the autonomy-policy is missing `requires confirmation` on migrations?",
      "Security: plan-defect questions resolved.\n\n## NO MORE QUESTIONS\n",
    ];
    let n = 0;
    const out = await runLoopPlanReview({
      plan_path: ".guild/plan/test.md",
      spec_path: ".guild/spec/test.md",
      loops_mode: "all",
      cap: 8,
      run_id: RUN_ID,
      runDir,
      jsonl,
      roundFn: () => ({ body: responses[n++] as string, terminator: "security" }),
      escalationFn: () => "force-pass",
    });
    expect(out.status).toBe("satisfied");
    expect(out.rounds).toBe(3);
  });

  it("plan-defect-only filter: a code-style review terminates in round 1 with no questions", async () => {
    // Architect contract: "security MUST NOT raise general code-style suggestions".
    // This test simulates the contracted behavior — security agent returns
    // sentinel immediately when only code-style nits exist.
    const jsonl = new InMemoryLoopJsonlAppender();
    const out = await runLoopPlanReview({
      plan_path: ".guild/plan/test.md",
      spec_path: ".guild/spec/test.md",
      loops_mode: "plan",
      cap: 8,
      run_id: RUN_ID,
      runDir,
      jsonl,
      roundFn: () => ({
        body: `Security: out-of-scope code-style nits noted but not raised in this loop.\n\n## NO MORE QUESTIONS\n`,
        terminator: "security",
      }),
      escalationFn: () => "force-pass",
    });
    expect(out.status).toBe("satisfied");
    expect(out.rounds).toBe(1);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// L2 cap-hit + escalation routing.
// ──────────────────────────────────────────────────────────────────────────

describe("loop-plan-review / runLoopPlanReview — cap-hit and escalation", () => {
  it("cap-hit at cap=2 dispatches escalationFn with reason cap_hit", async () => {
    const jsonl = new InMemoryLoopJsonlAppender();
    const reasons: string[] = [];
    const out = await runLoopPlanReview({
      plan_path: ".guild/plan/test.md",
      spec_path: ".guild/spec/test.md",
      loops_mode: "plan",
      cap: 2,
      run_id: RUN_ID,
      runDir,
      jsonl,
      roundFn: () => ({
        body: `Security: still defects — what about the auth on T3?`,
        terminator: "security",
      }),
      escalationFn: (reason) => {
        reasons.push(reason);
        return "force-pass";
      },
    });
    expect(reasons).toEqual(["cap_hit"]);
    expect(out.status).toBe("escalated");
    expect(out.next).toBe("gate-3-plan-approval");
    const escs = jsonl.byType("escalation");
    expect(escs).toHaveLength(1);
    expect(escs[0]?.options_offered).toEqual(ESCALATION_LABELS);
  });

  it("rework choice returns status=rework, next=abort", async () => {
    const jsonl = new InMemoryLoopJsonlAppender();
    const out = await runLoopPlanReview({
      plan_path: ".guild/plan/test.md",
      spec_path: ".guild/spec/test.md",
      loops_mode: "plan",
      cap: 2,
      run_id: RUN_ID,
      runDir,
      jsonl,
      roundFn: () => ({ body: `still asking?`, terminator: "security" }),
      escalationFn: () => "rework",
    });
    expect(out.status).toBe("rework");
    expect(out.next).toBe("abort");
  });

  it("extend-cap choice returns escalated status (orchestrator owns the actual cap-extension re-entry)", async () => {
    const jsonl = new InMemoryLoopJsonlAppender();
    const out = await runLoopPlanReview({
      plan_path: ".guild/plan/test.md",
      spec_path: ".guild/spec/test.md",
      loops_mode: "plan",
      cap: 2,
      run_id: RUN_ID,
      runDir,
      jsonl,
      roundFn: () => ({ body: `defects remain?`, terminator: "security" }),
      escalationFn: () => "extend-cap",
    });
    expect(out.status).toBe("escalated");
    const escs = jsonl.byType("escalation");
    expect(escs[0]?.user_choice).toBe("extend-cap");
  });
});

// ──────────────────────────────────────────────────────────────────────────
// AskUserQuestion payload binding contract — re-pinned for L2 site.
// ──────────────────────────────────────────────────────────────────────────

describe("loop-plan-review / escalation payload at L2 escalation site", () => {
  it("dispatches the same three options with the same descriptions as L1", () => {
    const p = buildEscalationPayload("L2 cap-hit at plan review.");
    const opts = p.questions[0]?.options;
    expect(opts?.map((o) => o.label)).toEqual(ESCALATION_LABELS);
    expect(opts?.find((o) => o.label === "force-pass")?.description).toBe(
      ESCALATION_DESCRIPTIONS["force-pass"],
    );
    expect(opts?.find((o) => o.label === "extend-cap")?.description).toBe(
      ESCALATION_DESCRIPTIONS["extend-cap"],
    );
    expect(opts?.find((o) => o.label === "rework")?.description).toBe(
      ESCALATION_DESCRIPTIONS.rework,
    );
  });
});

// ──────────────────────────────────────────────────────────────────────────
// JSONL events lane_id is `phase:plan` for L2 (synthetic lane).
// ──────────────────────────────────────────────────────────────────────────

describe("loop-plan-review / JSONL events use synthetic lane phase:plan", () => {
  it("loop_round_start + loop_round_end carry lane_id phase:plan and loop_layer L2", async () => {
    const jsonl = new InMemoryLoopJsonlAppender();
    await runLoopPlanReview({
      plan_path: ".guild/plan/test.md",
      spec_path: ".guild/spec/test.md",
      loops_mode: "plan",
      cap: 4,
      run_id: RUN_ID,
      runDir,
      jsonl,
      roundFn: () => ({
        body: `## NO MORE QUESTIONS\n`,
        terminator: "security",
      }),
      escalationFn: () => "force-pass",
    });
    const starts = jsonl.byType("loop_round_start");
    const ends = jsonl.byType("loop_round_end");
    expect(starts[0]?.lane_id).toBe("phase:plan");
    expect(starts[0]?.loop_layer).toBe("L2");
    expect(ends[0]?.terminated).toBe("satisfied");
    expect(ends[0]?.terminator).toBe("security");
  });
});
