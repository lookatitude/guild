// v1.4.0 F-7 — qa-lane harness orchestration tests.
//
// Lane: T5-qa (per .guild/runs/run-2026-04-27-v1.4.0-adversarial-loops).
//
// These tests pin the THREE injection paths the harness exposes:
//   1. forced-security-fail — proves the F-3 restart chain fires.
//   2. cap-hit at --loop-cap=2 — proves the cap escalation surfaces with
//      the standardized 3-tuple copy verbatim.
//   3. --auto-approve=all — proves the auto-approve tier short-circuits
//      the user gate (no prompt fires; resolution to `force-pass` is
//      automatic).
//
// SHAPE-NOT-CONTENT: assertions are over event types, counters,
// escalation labels, and resolved config. We do NOT assert specific
// specialist message bodies (those are non-deterministic).
//
// PURE: no `claude`, no network, no AskUserQuestion. The only filesystem
// surface is per-test tmpdirs.

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  runV14Harness,
  V14_INJECTIONS,
  type V14Injection,
} from "../src/v1.4-harness.js";
import { ESCALATION_LABELS } from "../src/loop-escalation.js";
import { InMemoryLoopJsonlAppender } from "../src/loop-jsonl-stub.js";

let tmpRoot: string;
let runDir: string;

beforeEach(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), "guild-v14-harness-test-"));
  runDir = join(tmpRoot, "run");
});

afterEach(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
});

// ──────────────────────────────────────────────────────────────────────────
// Surface invariants — module-level
// ──────────────────────────────────────────────────────────────────────────

describe("v1.4-harness / surface", () => {
  it("V14_INJECTIONS exposes exactly 3 modes in canonical order", () => {
    expect(V14_INJECTIONS).toEqual([
      "forced-security-fail",
      "cap-hit",
      "auto-approve-all",
    ]);
  });

  it("escalation labels round-trip through the harness re-export", () => {
    expect(ESCALATION_LABELS).toEqual(["force-pass", "extend-cap", "rework"]);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Injection 1 — forced-security-fail
// ──────────────────────────────────────────────────────────────────────────

describe("v1.4-harness / forced-security-fail injection", () => {
  it("drives ≥ 1 restart attempt — restart_count > 0 after run", async () => {
    const out = await runV14Harness({
      injection: "forced-security-fail",
      runId: "test-fsf-restart",
      runDir,
    });
    // Synthetic security-review always returns high+unaddressed → restart fires.
    // With restart_cap=3 default, we should see restart_count = 3 + 1 = either
    // up to the cap or capped at restart_cap_hit.
    expect(out.loop.restart_count).toBeGreaterThan(0);
  });

  it("superseded_receipts list is well-formed (array; empty when no on-disk handoffs)", async () => {
    const out = await runV14Harness({
      injection: "forced-security-fail",
      runId: "test-fsf-superseded",
      runDir,
    });
    // The synthetic harness does not write real handoff receipts; the
    // restart machinery still fires (proven by restart_count > 0 above)
    // but `supersedePriorReceipts` finds nothing to move. The list must
    // still be present and array-shaped (empty is a valid restart
    // shape when no receipts existed yet).
    expect(Array.isArray(out.loop.superseded_receipts)).toBe(true);
  });

  it("eventually surfaces an escalation event at restart_cap_hit", async () => {
    const out = await runV14Harness({
      injection: "forced-security-fail",
      runId: "test-fsf-escalate",
      runDir,
    });
    // restart_cap=3 → on the 4th restart attempt we hit `restart_cap_hit`,
    // which emits an `escalation` event. The harness's escalationFn returns
    // `force-pass` for that reason, so the loop status terminates with one
    // of the post-escalation states.
    expect(out.sawEscalation).toBe(true);
    expect(out.eventCounts["escalation"]).toBeGreaterThanOrEqual(1);
    expect(["restart_cap_hit", "rework", "satisfied", "escalated"]).toContain(
      out.loop.status,
    );
  });

  it("layers_run records L3 → L4 → security-review at least once each", async () => {
    const out = await runV14Harness({
      injection: "forced-security-fail",
      runId: "test-fsf-layers",
      runDir,
    });
    expect(out.loop.layers_run).toContain("L3");
    expect(out.loop.layers_run).toContain("L4");
    expect(out.loop.layers_run).toContain("security-review");
  });

  it("auto-approve short-circuit DOES NOT fire under default auto-approve=none", async () => {
    const out = await runV14Harness({
      injection: "forced-security-fail",
      runId: "test-fsf-noauto",
      runDir,
    });
    expect(out.autoApprovedAll).toBe(false);
    expect(out.resolvedAutoApprove).toBe("none");
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Injection 2 — cap-hit at --loop-cap=2
// ──────────────────────────────────────────────────────────────────────────

describe("v1.4-harness / cap-hit injection", () => {
  it("resolves cap=2 via the shipped parser path (not free-text fallback)", async () => {
    const out = await runV14Harness({
      injection: "cap-hit",
      runId: "test-caphit-parse",
      runDir,
    });
    expect(out.resolvedCap).toBe(2);
  });

  it("surfaces an escalation event with the verbatim 3-tuple copy", async () => {
    const jsonl = new InMemoryLoopJsonlAppender();
    const out = await runV14Harness({
      injection: "cap-hit",
      runId: "test-caphit-copy",
      runDir,
      jsonl,
    });
    expect(out.sawEscalation).toBe(true);
    const escalations = jsonl.byType("escalation");
    expect(escalations.length).toBeGreaterThanOrEqual(1);
    // Every escalation event MUST offer the architect-contract 3-tuple,
    // verbatim. No paraphrase.
    for (const e of escalations) {
      expect(e.options_offered).toEqual([
        "force-pass",
        "extend-cap",
        "rework",
      ]);
    }
  });

  it("loop terminates without proceeding past cap=2 cleanly", async () => {
    const out = await runV14Harness({
      injection: "cap-hit",
      runId: "test-caphit-no-clean",
      runDir,
    });
    // L3 always-malformed + cap=2 → first hit is malformed_termination_x2,
    // which the harness's default fn maps to `rework`. So loop status is
    // either `rework` or another non-clean state.
    expect(out.loop.status).not.toBe("satisfied");
  });

  it("event order shape: every loop_round_end pairs with a preceding loop_round_start", async () => {
    const out = await runV14Harness({
      injection: "cap-hit",
      runId: "test-caphit-pairs",
      runDir,
    });
    // Walk the eventOrder and ensure that every `loop_round_end`
    // is preceded by a matching `loop_round_start` for the same layer.
    let openStarts = 0;
    for (const ev of out.eventOrder) {
      if (ev === "loop_round_start") openStarts += 1;
      if (ev === "loop_round_end") {
        expect(openStarts).toBeGreaterThan(0);
        openStarts -= 1;
      }
    }
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Injection 3 — auto-approve=all
// ──────────────────────────────────────────────────────────────────────────

describe("v1.4-harness / auto-approve=all injection", () => {
  it("resolves auto-approve=all via the shipped parser path", async () => {
    const out = await runV14Harness({
      injection: "auto-approve-all",
      runId: "test-aaa-parse",
      runDir,
    });
    expect(out.resolvedAutoApprove).toBe("all");
  });

  it("auto-approve short-circuit FIRES — autoApprovedAll = true", async () => {
    const out = await runV14Harness({
      injection: "auto-approve-all",
      runId: "test-aaa-fired",
      runDir,
    });
    // The cap-hit-shaped handoffs guarantee at least one escalation reason,
    // and auto-approve=all flips the sink without ever calling the prompt.
    expect(out.autoApprovedAll).toBe(true);
  });

  it("escalation events surface — short-circuit resolves to force-pass automatically", async () => {
    const jsonl = new InMemoryLoopJsonlAppender();
    const out = await runV14Harness({
      injection: "auto-approve-all",
      runId: "test-aaa-forcepass",
      runDir,
      jsonl,
    });
    expect(out.sawEscalation).toBe(true);
    const escalations = jsonl.byType("escalation");
    // Auto-approve=all forces every escalation to `force-pass`.
    for (const e of escalations) {
      expect(e.user_choice).toBe("force-pass");
    }
  });

  it("auto-approve=all does NOT fire when auto-approve resolves to none", async () => {
    // Override the injection-default auto_approve to prove the sink only
    // flips on the resolved `all` value, NOT on the injection name alone.
    const out = await runV14Harness({
      injection: "auto-approve-all",
      runId: "test-aaa-override-none",
      runDir,
      autoApprove: "none",
    });
    expect(out.autoApprovedAll).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Cross-injection invariants
// ──────────────────────────────────────────────────────────────────────────

describe("v1.4-harness / cross-injection invariants", () => {
  it.each(V14_INJECTIONS)(
    "%s injection produces a non-empty event trail",
    async (injection: V14Injection) => {
      const out = await runV14Harness({
        injection,
        runId: `test-cross-${injection}`,
        runDir: join(tmpRoot, `cross-${injection}`),
      });
      expect(out.eventOrder.length).toBeGreaterThan(0);
    },
  );

  it.each(V14_INJECTIONS)(
    "%s injection records eventCounts as a record keyed by event type",
    async (injection: V14Injection) => {
      const out = await runV14Harness({
        injection,
        runId: `test-counts-${injection}`,
        runDir: join(tmpRoot, `counts-${injection}`),
      });
      const totalFromCounts = Object.values(out.eventCounts).reduce(
        (a, b) => a + b,
        0,
      );
      expect(totalFromCounts).toBe(out.eventOrder.length);
    },
  );
});
