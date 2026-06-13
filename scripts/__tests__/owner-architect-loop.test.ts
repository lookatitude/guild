/**
 * scripts/__tests__/owner-architect-loop.test.ts
 *
 * Focused tests for scripts/lib/owner-architect-loop.ts — Loop-control state
 * machine for the owner↔architect implementation loop (item 23, v2.x deferred).
 *
 * Coverage:
 *   1. Constants — sentinel value, layer label, default cap, clamp bounds.
 *   2. makeRoundState — factory + cap clamping.
 *   3. shouldRestart — critical/high-unaddressed/low/addressed-high/info paths.
 *   4. terminationReached — sentinel parsing with all hardening rules:
 *      a. Clean termination.
 *      b. No sentinel (loop continues).
 *      c. Duplicate sentinel (malformed).
 *      d. Post-sentinel content (malformed).
 *      e. Empty response.
 *      f. Sentinel embedded in a sentence (inline — not standalone; NOT triggered
 *         if the line as a whole is just the sentinel text).
 *   5. checkRoundCap — within-cap, at-cap, over-cap.
 *   6. checkRestartCap — within-restart, at-restart-cap.
 *   7. checkMalformedStreak — streak tracking and two-consecutive escalation.
 *   8. dismissalTerminates — always false.
 *   9. forcePassAssumptions — shape and content.
 *   10. validateRoundState — valid + all error branches.
 *   11. validateFinding — valid + all error branches.
 *   12. validateEscalationOutcome — valid + invalid.
 *   13. Contract guarantees (no Date.now/Math.random, determinism).
 *   14. Edge cases — malformed/partial inputs.
 *
 * All tests are PURE (no disk I/O). The library has no FS dependency.
 */

import {
  OWNER_ARCHITECT_SENTINEL,
  OWNER_ARCHITECT_LAYER,
  OWNER_ARCHITECT_DEFAULT_CAP,
  OWNER_ARCHITECT_CAP_MIN,
  OWNER_ARCHITECT_CAP_MAX,
  FINDING_SEVERITIES,
  ESCALATION_OUTCOMES,
  makeRoundState,
  shouldRestart,
  terminationReached,
  checkRoundCap,
  checkRestartCap,
  checkMalformedStreak,
  dismissalTerminates,
  forcePassAssumptions,
  validateRoundState,
  validateFinding,
  validateEscalationOutcome,
  type ArchitectFinding,
  type OwnerArchitectRoundState,
  type MalformedStreakState,
} from "../lib/owner-architect-loop";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const FIXED_RUN_ID = "run-oa-test-001";
const FIXED_LANE_ID = "lane-impl-001";

function makeState(overrides?: Partial<OwnerArchitectRoundState>): OwnerArchitectRoundState {
  return makeRoundState({
    round: overrides?.round ?? 1,
    runId: overrides?.runId ?? FIXED_RUN_ID,
    laneId: overrides?.laneId ?? FIXED_LANE_ID,
    cap: overrides?.cap ?? OWNER_ARCHITECT_DEFAULT_CAP,
    restartCount: overrides?.restartCount ?? 0,
    maxRestarts: overrides?.maxRestarts ?? 3,
  });
}

function makeFinding(overrides?: Partial<ArchitectFinding>): ArchitectFinding {
  return {
    id: overrides?.id ?? "F-001",
    severity: overrides?.severity ?? "medium",
    addressed_by_owner: overrides?.addressed_by_owner ?? false,
    description: overrides?.description ?? "test finding",
  };
}

// ── 1. Constants ──────────────────────────────────────────────────────────────

describe("1. Constants", () => {
  test("OWNER_ARCHITECT_SENTINEL is exactly '## NO MORE QUESTIONS'", () => {
    expect(OWNER_ARCHITECT_SENTINEL).toBe("## NO MORE QUESTIONS");
  });

  test("OWNER_ARCHITECT_SENTINEL is NOT the broker sentinel '## SATISFIED'", () => {
    expect(OWNER_ARCHITECT_SENTINEL).not.toBe("## SATISFIED");
  });

  test("OWNER_ARCHITECT_LAYER is 'L-arch'", () => {
    expect(OWNER_ARCHITECT_LAYER).toBe("L-arch");
  });

  test("OWNER_ARCHITECT_DEFAULT_CAP is 16", () => {
    expect(OWNER_ARCHITECT_DEFAULT_CAP).toBe(16);
  });

  test("OWNER_ARCHITECT_CAP_MIN is 1", () => {
    expect(OWNER_ARCHITECT_CAP_MIN).toBe(1);
  });

  test("OWNER_ARCHITECT_CAP_MAX is 256", () => {
    expect(OWNER_ARCHITECT_CAP_MAX).toBe(256);
  });

  test("FINDING_SEVERITIES has exactly 5 values in order", () => {
    expect([...FINDING_SEVERITIES]).toEqual(["info", "low", "medium", "high", "critical"]);
  });

  test("ESCALATION_OUTCOMES has exactly 3 values in order", () => {
    expect([...ESCALATION_OUTCOMES]).toEqual(["force-pass", "extend-cap", "rework"]);
  });
});

// ── 2. makeRoundState ─────────────────────────────────────────────────────────

describe("2. makeRoundState — factory and cap clamping", () => {
  test("produces correct defaults", () => {
    const state = makeRoundState({ round: 1, runId: FIXED_RUN_ID, laneId: FIXED_LANE_ID });
    expect(state.round).toBe(1);
    expect(state.cap).toBe(OWNER_ARCHITECT_DEFAULT_CAP);
    expect(state.restartCount).toBe(0);
    expect(state.maxRestarts).toBe(3);
    expect(state.runId).toBe(FIXED_RUN_ID);
    expect(state.laneId).toBe(FIXED_LANE_ID);
  });

  test("clamps cap below minimum to OWNER_ARCHITECT_CAP_MIN", () => {
    const state = makeRoundState({ round: 1, runId: FIXED_RUN_ID, laneId: FIXED_LANE_ID, cap: 0 });
    expect(state.cap).toBe(OWNER_ARCHITECT_CAP_MIN);
  });

  test("clamps negative cap to OWNER_ARCHITECT_CAP_MIN", () => {
    const state = makeRoundState({ round: 1, runId: FIXED_RUN_ID, laneId: FIXED_LANE_ID, cap: -5 });
    expect(state.cap).toBe(OWNER_ARCHITECT_CAP_MIN);
  });

  test("clamps cap above maximum to OWNER_ARCHITECT_CAP_MAX", () => {
    const state = makeRoundState({ round: 1, runId: FIXED_RUN_ID, laneId: FIXED_LANE_ID, cap: 999 });
    expect(state.cap).toBe(OWNER_ARCHITECT_CAP_MAX);
  });

  test("accepts any cap within [CAP_MIN, CAP_MAX]", () => {
    const state = makeRoundState({ round: 3, runId: FIXED_RUN_ID, laneId: FIXED_LANE_ID, cap: 8 });
    expect(state.cap).toBe(8);
    expect(state.round).toBe(3);
  });

  test("accepts explicit restartCount and maxRestarts", () => {
    const state = makeRoundState({
      round: 2,
      runId: FIXED_RUN_ID,
      laneId: FIXED_LANE_ID,
      restartCount: 1,
      maxRestarts: 5,
    });
    expect(state.restartCount).toBe(1);
    expect(state.maxRestarts).toBe(5);
  });
});

// ── 3. shouldRestart ──────────────────────────────────────────────────────────

describe("3. shouldRestart — restart signal decisions", () => {
  test("critical severity always triggers restart", () => {
    const finding = makeFinding({ severity: "critical", addressed_by_owner: true });
    const result = shouldRestart(finding);
    expect(result.restart).toBe(true);
    if (result.restart) {
      expect(result.reason).toBe("critical_severity");
      expect(result.triggeringFinding).toBe(finding);
    }
  });

  test("critical severity triggers restart even when addressed_by_owner is true", () => {
    const finding = makeFinding({ severity: "critical", addressed_by_owner: true });
    const result = shouldRestart(finding);
    expect(result.restart).toBe(true);
    if (result.restart) {
      expect(result.reason).toBe("critical_severity");
    }
  });

  test("high severity + unaddressed → restart with reason high_severity_unaddressed", () => {
    const finding = makeFinding({ severity: "high", addressed_by_owner: false });
    const result = shouldRestart(finding);
    expect(result.restart).toBe(true);
    if (result.restart) {
      expect(result.reason).toBe("high_severity_unaddressed");
      expect(result.triggeringFinding).toBe(finding);
    }
  });

  test("high severity + addressed → no restart", () => {
    const finding = makeFinding({ severity: "high", addressed_by_owner: true });
    const result = shouldRestart(finding);
    expect(result.restart).toBe(false);
  });

  test("medium severity + unaddressed → no restart", () => {
    const finding = makeFinding({ severity: "medium", addressed_by_owner: false });
    const result = shouldRestart(finding);
    expect(result.restart).toBe(false);
  });

  test("low severity + unaddressed → no restart", () => {
    const finding = makeFinding({ severity: "low", addressed_by_owner: false });
    const result = shouldRestart(finding);
    expect(result.restart).toBe(false);
  });

  test("info severity → no restart", () => {
    const finding = makeFinding({ severity: "info", addressed_by_owner: false });
    const result = shouldRestart(finding);
    expect(result.restart).toBe(false);
  });
});

// ── 4. terminationReached ─────────────────────────────────────────────────────

describe("4. terminationReached — sentinel parsing", () => {
  test("4a. clean termination — sentinel on its own line at end", () => {
    const text = "Here are my findings.\n## NO MORE QUESTIONS";
    const result = terminationReached(text);
    expect(result.terminated).toBe(true);
    expect(result.malformed).toBe(false);
    expect(result.postSentinelText).toBe("");
    expect(result.diagnostic).toBe("");
  });

  test("4a. clean termination — sentinel with trailing newline", () => {
    const text = "Some observations.\n## NO MORE QUESTIONS\n";
    const result = terminationReached(text);
    expect(result.terminated).toBe(true);
    expect(result.malformed).toBe(false);
  });

  test("4a. clean termination — sentinel with leading whitespace on the line (trimmed)", () => {
    const text = "Findings done.\n  ## NO MORE QUESTIONS  \n";
    const result = terminationReached(text);
    expect(result.terminated).toBe(true);
    expect(result.malformed).toBe(false);
  });

  test("4b. no sentinel — loop continues", () => {
    const text = "I still have questions. What about error handling?";
    const result = terminationReached(text);
    expect(result.terminated).toBe(false);
    expect(result.malformed).toBe(false);
    expect(result.diagnostic).toBe("sentinel not found");
  });

  test("4b. empty response", () => {
    const result = terminationReached("");
    expect(result.terminated).toBe(false);
    expect(result.malformed).toBe(false);
    expect(result.diagnostic).toBe("empty response");
  });

  test("4b. whitespace-only response", () => {
    const result = terminationReached("   \n  \n  ");
    expect(result.terminated).toBe(false);
    expect(result.malformed).toBe(false);
    expect(result.diagnostic).toBe("empty response");
  });

  test("4c. duplicate sentinel — malformed", () => {
    const text = "## NO MORE QUESTIONS\n\nSome extra.\n## NO MORE QUESTIONS";
    const result = terminationReached(text);
    expect(result.terminated).toBe(false);
    expect(result.malformed).toBe(true);
    expect(result.diagnostic).toContain("2 times");
  });

  test("4d. post-sentinel content — malformed", () => {
    const text = "## NO MORE QUESTIONS\nWait, one more thing: what about rollback?";
    const result = terminationReached(text);
    expect(result.terminated).toBe(false);
    expect(result.malformed).toBe(true);
    expect(result.postSentinelText).toContain("rollback");
    expect(result.diagnostic).toContain("non-blank content");
  });

  test("4d. post-sentinel blank lines only — clean termination", () => {
    // Blank lines after the sentinel are not 'content' per the contract.
    const text = "## NO MORE QUESTIONS\n\n\n";
    const result = terminationReached(text);
    expect(result.terminated).toBe(true);
    expect(result.malformed).toBe(false);
  });

  test("4e. empty string input", () => {
    const result = terminationReached("");
    expect(result.terminated).toBe(false);
    expect(result.malformed).toBe(false);
  });

  test("4f. sentinel word appears inside a sentence — NOT a valid sentinel (the line as trimmed is not exactly the sentinel)", () => {
    // The line 'Please note ## NO MORE QUESTIONS is not a gate' trims to
    // something other than the sentinel exactly.
    const text = "Please note ## NO MORE QUESTIONS is not a gate marker.";
    const result = terminationReached(text);
    // The trimmed line is NOT exactly "## NO MORE QUESTIONS" so it should NOT match
    expect(result.terminated).toBe(false);
    expect(result.malformed).toBe(false);
  });

  test("4f. sentinel must be exact — partial match does not terminate", () => {
    const text = "## NO MORE QUESTIONS PLEASE";
    const result = terminationReached(text);
    expect(result.terminated).toBe(false);
    expect(result.malformed).toBe(false);
  });

  test("sentinel is case-sensitive — lowercase does not terminate", () => {
    const text = "## no more questions";
    const result = terminationReached(text);
    expect(result.terminated).toBe(false);
    expect(result.malformed).toBe(false);
  });
});

// ── 5. checkRoundCap ─────────────────────────────────────────────────────────

describe("5. checkRoundCap — round cap enforcement", () => {
  test("round 1 with cap 16 — within cap", () => {
    const state = makeState({ round: 1, cap: 16 });
    const result = checkRoundCap(state);
    expect(result.withinCap).toBe(true);
    expect(result.escalation).toBeUndefined();
  });

  test("round 15 with cap 16 — within cap (boundary)", () => {
    const state = makeState({ round: 15, cap: 16 });
    const result = checkRoundCap(state);
    expect(result.withinCap).toBe(true);
  });

  test("round 16 with cap 16 — at cap, escalation triggered", () => {
    const state = makeState({ round: 16, cap: 16 });
    const result = checkRoundCap(state);
    expect(result.withinCap).toBe(false);
    expect(result.escalation).toBeDefined();
    if (result.escalation) {
      expect(result.escalation.roundsConsumed).toBe(16);
      expect(result.escalation.cap).toBe(16);
      expect(ESCALATION_OUTCOMES).toContain(result.escalation.outcome);
    }
  });

  test("round 20 with cap 16 — over cap, escalation triggered", () => {
    const state = makeState({ round: 20, cap: 16 });
    const result = checkRoundCap(state);
    expect(result.withinCap).toBe(false);
    expect(result.escalation).toBeDefined();
  });

  test("custom cap of 5 — round 5 triggers escalation", () => {
    const state = makeState({ round: 5, cap: 5 });
    const result = checkRoundCap(state);
    expect(result.withinCap).toBe(false);
  });

  test("custom cap of 5 — round 4 is within cap", () => {
    const state = makeState({ round: 4, cap: 5 });
    const result = checkRoundCap(state);
    expect(result.withinCap).toBe(true);
  });
});

// ── 6. checkRestartCap ────────────────────────────────────────────────────────

describe("6. checkRestartCap — restart counter enforcement", () => {
  test("restartCount 0 with maxRestarts 3 — restart allowed", () => {
    const state = makeState({ restartCount: 0, maxRestarts: 3 });
    expect(checkRestartCap(state)).toBe(true);
  });

  test("restartCount 2 with maxRestarts 3 — restart allowed (boundary)", () => {
    const state = makeState({ restartCount: 2, maxRestarts: 3 });
    expect(checkRestartCap(state)).toBe(true);
  });

  test("restartCount 3 with maxRestarts 3 — cap hit, restart not allowed", () => {
    const state = makeState({ restartCount: 3, maxRestarts: 3 });
    expect(checkRestartCap(state)).toBe(false);
  });

  test("restartCount 4 with maxRestarts 3 — over cap, restart not allowed", () => {
    const state = makeState({ restartCount: 4, maxRestarts: 3 });
    expect(checkRestartCap(state)).toBe(false);
  });
});

// ── 7. checkMalformedStreak ───────────────────────────────────────────────────

describe("7. checkMalformedStreak — consecutive-malformed guard", () => {
  test("streak 0 + clean round → streak stays 0, no escalation", () => {
    const streak: MalformedStreakState = { consecutiveMalformed: 0 };
    const result = checkMalformedStreak(streak, false);
    expect(result.mustEscalate).toBe(false);
    expect(result.consecutiveMalformed).toBe(0);
  });

  test("streak 0 + malformed round → streak becomes 1, no escalation yet", () => {
    const streak: MalformedStreakState = { consecutiveMalformed: 0 };
    const result = checkMalformedStreak(streak, true);
    expect(result.mustEscalate).toBe(false);
    expect(result.consecutiveMalformed).toBe(1);
  });

  test("streak 1 + malformed round → streak becomes 2, must escalate", () => {
    const streak: MalformedStreakState = { consecutiveMalformed: 1 };
    const result = checkMalformedStreak(streak, true);
    expect(result.mustEscalate).toBe(true);
    expect(result.consecutiveMalformed).toBe(2);
  });

  test("streak 1 + clean round → streak resets to 0, no escalation", () => {
    const streak: MalformedStreakState = { consecutiveMalformed: 1 };
    const result = checkMalformedStreak(streak, false);
    expect(result.mustEscalate).toBe(false);
    expect(result.consecutiveMalformed).toBe(0);
  });

  test("streak 2 + malformed round → streak becomes 3, still must escalate", () => {
    const streak: MalformedStreakState = { consecutiveMalformed: 2 };
    const result = checkMalformedStreak(streak, true);
    expect(result.mustEscalate).toBe(true);
    expect(result.consecutiveMalformed).toBe(3);
  });
});

// ── 8. dismissalTerminates ────────────────────────────────────────────────────

describe("8. dismissalTerminates — dismissals never end the loop", () => {
  test("always returns false", () => {
    expect(dismissalTerminates()).toBe(false);
  });

  test("return type is false (literal, not just falsy)", () => {
    const result = dismissalTerminates();
    expect(result).toStrictEqual(false);
  });
});

// ── 9. forcePassAssumptions ───────────────────────────────────────────────────

describe("9. forcePassAssumptions — shape and content", () => {
  test("basic shape on force-pass", () => {
    const findings: ArchitectFinding[] = [
      makeFinding({ id: "F-001", severity: "high", addressed_by_owner: false, description: "coupling issue" }),
      makeFinding({ id: "F-002", severity: "medium", addressed_by_owner: false, description: "scalability concern" }),
    ];
    const record = forcePassAssumptions(findings, 16, FIXED_LANE_ID);

    expect(record.source).toBe("owner-architect-loop");
    expect(record.layer).toBe("L-arch");
    expect(record.lane_id).toBe(FIXED_LANE_ID);
    expect(record.rounds_consumed).toBe(16);
    expect(record.resolution).toBe("force-pass");
    expect(record.unresolved_findings).toHaveLength(2);
  });

  test("preserves finding ids, severities, addressed_by_owner", () => {
    const findings: ArchitectFinding[] = [
      makeFinding({ id: "critical-1", severity: "critical", addressed_by_owner: false }),
    ];
    const record = forcePassAssumptions(findings, 5, FIXED_LANE_ID);

    expect(record.unresolved_findings[0].id).toBe("critical-1");
    expect(record.unresolved_findings[0].severity).toBe("critical");
    expect(record.unresolved_findings[0].addressed_by_owner).toBe(false);
  });

  test("missing description defaults to empty string", () => {
    const finding: ArchitectFinding = { id: "F-nodesc", severity: "low", addressed_by_owner: true };
    const record = forcePassAssumptions([finding], 3, FIXED_LANE_ID);
    expect(record.unresolved_findings[0].description).toBe("");
  });

  test("empty findings list is valid (force-pass with no open items)", () => {
    const record = forcePassAssumptions([], 16, FIXED_LANE_ID);
    expect(record.unresolved_findings).toHaveLength(0);
    expect(record.resolution).toBe("force-pass");
  });
});

// ── 10. validateRoundState ────────────────────────────────────────────────────

describe("10. validateRoundState — structural validator", () => {
  test("accepts a fully valid state", () => {
    const state = makeState();
    expect(validateRoundState(state)).toEqual({ valid: true });
  });

  test("rejects null", () => {
    const result = validateRoundState(null);
    expect(result.valid).toBe(false);
    expect((result as { valid: false; errors: string[] }).errors.length).toBeGreaterThan(0);
  });

  test("rejects an array", () => {
    const result = validateRoundState([]);
    expect(result.valid).toBe(false);
  });

  test("rejects round < 1", () => {
    const state = { ...makeState(), round: 0 };
    const result = validateRoundState(state);
    expect(result.valid).toBe(false);
    expect(
      (result as { valid: false; errors: string[] }).errors.some((e) => e.includes("round")),
    ).toBe(true);
  });

  test("rejects cap below CAP_MIN", () => {
    const state = { ...makeState(), cap: 0 };
    const result = validateRoundState(state);
    expect(result.valid).toBe(false);
    expect(
      (result as { valid: false; errors: string[] }).errors.some((e) => e.includes("cap")),
    ).toBe(true);
  });

  test("rejects cap above CAP_MAX", () => {
    const state = { ...makeState(), cap: 1000 };
    const result = validateRoundState(state);
    expect(result.valid).toBe(false);
    expect(
      (result as { valid: false; errors: string[] }).errors.some((e) => e.includes("cap")),
    ).toBe(true);
  });

  test("rejects empty runId", () => {
    const state = { ...makeState(), runId: "" };
    const result = validateRoundState(state);
    expect(result.valid).toBe(false);
    expect(
      (result as { valid: false; errors: string[] }).errors.some((e) => e.includes("runId")),
    ).toBe(true);
  });

  test("rejects empty laneId", () => {
    const state = { ...makeState(), laneId: "" };
    const result = validateRoundState(state);
    expect(result.valid).toBe(false);
    expect(
      (result as { valid: false; errors: string[] }).errors.some((e) => e.includes("laneId")),
    ).toBe(true);
  });

  test("rejects restartCount > maxRestarts", () => {
    const state = { ...makeState(), restartCount: 5, maxRestarts: 3 };
    const result = validateRoundState(state);
    expect(result.valid).toBe(false);
    expect(
      (result as { valid: false; errors: string[] }).errors.some((e) => e.includes("restartCount")),
    ).toBe(true);
  });

  test("rejects negative restartCount", () => {
    const state = { ...makeState(), restartCount: -1 };
    const result = validateRoundState(state);
    expect(result.valid).toBe(false);
  });

  test("rejects maxRestarts < 1", () => {
    const state = { ...makeState(), maxRestarts: 0 };
    const result = validateRoundState(state);
    expect(result.valid).toBe(false);
  });

  test("reports all errors simultaneously (does not short-circuit)", () => {
    const state = { round: 0, cap: 0, restartCount: -1, maxRestarts: 0, runId: "", laneId: "" };
    const result = validateRoundState(state);
    expect(result.valid).toBe(false);
    // Multiple distinct violations expected.
    expect((result as { valid: false; errors: string[] }).errors.length).toBeGreaterThan(1);
  });
});

// ── 11. validateFinding ───────────────────────────────────────────────────────

describe("11. validateFinding — structural validator", () => {
  test("accepts a valid finding", () => {
    const finding = makeFinding();
    expect(validateFinding(finding)).toEqual({ valid: true });
  });

  test("rejects null", () => {
    expect(validateFinding(null).valid).toBe(false);
  });

  test("rejects empty id", () => {
    const result = validateFinding({ ...makeFinding(), id: "" });
    expect(result.valid).toBe(false);
    expect(
      (result as { valid: false; errors: string[] }).errors.some((e) => e.includes("id")),
    ).toBe(true);
  });

  test("rejects unknown severity", () => {
    const result = validateFinding({ ...makeFinding(), severity: "extreme" });
    expect(result.valid).toBe(false);
    expect(
      (result as { valid: false; errors: string[] }).errors.some((e) => e.includes("severity")),
    ).toBe(true);
  });

  test("rejects non-boolean addressed_by_owner", () => {
    const result = validateFinding({ ...makeFinding(), addressed_by_owner: "yes" });
    expect(result.valid).toBe(false);
    expect(
      (result as { valid: false; errors: string[] }).errors.some((e) =>
        e.includes("addressed_by_owner"),
      ),
    ).toBe(true);
  });

  test("accepts all valid severity levels", () => {
    for (const severity of FINDING_SEVERITIES) {
      const finding = { id: "F-X", severity, addressed_by_owner: false };
      expect(validateFinding(finding)).toEqual({ valid: true });
    }
  });
});

// ── 12. validateEscalationOutcome ─────────────────────────────────────────────

describe("12. validateEscalationOutcome — structural validator", () => {
  test("accepts all valid escalation outcomes", () => {
    for (const outcome of ESCALATION_OUTCOMES) {
      expect(validateEscalationOutcome(outcome)).toEqual({ valid: true });
    }
  });

  test("rejects an unknown outcome", () => {
    const result = validateEscalationOutcome("give-up");
    expect(result.valid).toBe(false);
    expect(
      (result as { valid: false; errors: string[] }).errors.length,
    ).toBeGreaterThan(0);
  });

  test("rejects a number", () => {
    expect(validateEscalationOutcome(42).valid).toBe(false);
  });

  test("rejects null", () => {
    expect(validateEscalationOutcome(null).valid).toBe(false);
  });
});

// ── 13. Contract guarantees ───────────────────────────────────────────────────

describe("13. Contract guarantees", () => {
  test("shouldRestart is deterministic — same input always yields same output", () => {
    const finding = makeFinding({ severity: "high", addressed_by_owner: false });
    const r1 = shouldRestart(finding);
    const r2 = shouldRestart(finding);
    expect(r1).toEqual(r2);
  });

  test("terminationReached is deterministic — same input always yields same output", () => {
    const text = "Some questions.\n## NO MORE QUESTIONS";
    const r1 = terminationReached(text);
    const r2 = terminationReached(text);
    expect(r1).toEqual(r2);
  });

  test("checkRoundCap is deterministic — same state always yields same result", () => {
    const state = makeState({ round: 16, cap: 16 });
    const r1 = checkRoundCap(state);
    const r2 = checkRoundCap(state);
    expect(r1).toEqual(r2);
  });

  test("forcePassAssumptions is deterministic — same inputs yield same output", () => {
    const findings = [makeFinding({ id: "F-1", severity: "high", addressed_by_owner: false })];
    const r1 = forcePassAssumptions(findings, 16, FIXED_LANE_ID);
    const r2 = forcePassAssumptions(findings, 16, FIXED_LANE_ID);
    expect(r1).toEqual(r2);
  });

  test("validateRoundState is deterministic", () => {
    const state = makeState();
    expect(validateRoundState(state)).toEqual(validateRoundState(state));
  });

  test("makeRoundState clamps cap without side effects on input", () => {
    const input = { round: 1, runId: FIXED_RUN_ID, laneId: FIXED_LANE_ID, cap: 0 };
    const state = makeRoundState(input);
    // Input object is not mutated.
    expect(input.cap).toBe(0);
    // Output is clamped.
    expect(state.cap).toBe(OWNER_ARCHITECT_CAP_MIN);
  });
});

// ── 14. Edge cases ────────────────────────────────────────────────────────────

describe("14. Edge cases and malformed inputs", () => {
  test("terminationReached handles a response with only the sentinel", () => {
    const result = terminationReached("## NO MORE QUESTIONS");
    expect(result.terminated).toBe(true);
    expect(result.malformed).toBe(false);
  });

  test("terminationReached handles CRLF line endings", () => {
    const text = "Question answered.\r\n## NO MORE QUESTIONS\r\n";
    const result = terminationReached(text);
    // CRLF: the sentinel line trimmed is "## NO MORE QUESTIONS" (trim removes \r).
    expect(result.terminated).toBe(true);
    expect(result.malformed).toBe(false);
  });

  test("shouldRestart treats a finding with description omitted identically to one with empty description", () => {
    const f1: ArchitectFinding = { id: "F1", severity: "high", addressed_by_owner: false };
    const f2: ArchitectFinding = { id: "F1", severity: "high", addressed_by_owner: false, description: "" };
    expect(shouldRestart(f1).restart).toBe(shouldRestart(f2).restart);
  });

  test("checkMalformedStreak handles streak starting from 0 over multiple rounds", () => {
    let streak: MalformedStreakState = { consecutiveMalformed: 0 };

    // Round 1: malformed
    let res = checkMalformedStreak(streak, true);
    expect(res.mustEscalate).toBe(false);
    streak = { consecutiveMalformed: res.consecutiveMalformed };

    // Round 2: clean — streak resets
    res = checkMalformedStreak(streak, false);
    expect(res.mustEscalate).toBe(false);
    expect(res.consecutiveMalformed).toBe(0);
    streak = { consecutiveMalformed: res.consecutiveMalformed };

    // Round 3: malformed
    res = checkMalformedStreak(streak, true);
    expect(res.mustEscalate).toBe(false);
    streak = { consecutiveMalformed: res.consecutiveMalformed };

    // Round 4: malformed — escalate
    res = checkMalformedStreak(streak, true);
    expect(res.mustEscalate).toBe(true);
  });

  test("validateFinding rejects an array as input", () => {
    expect(validateFinding([]).valid).toBe(false);
  });

  test("validateFinding rejects a primitive as input", () => {
    expect(validateFinding("string").valid).toBe(false);
  });

  test("validateRoundState rejects a primitive as input", () => {
    expect(validateRoundState(42).valid).toBe(false);
  });

  test("checkRoundCap escalation outcome is always a valid ESCALATION_OUTCOMES value", () => {
    const state = makeState({ round: 16, cap: 16 });
    const result = checkRoundCap(state);
    if (!result.withinCap && result.escalation) {
      expect(validateEscalationOutcome(result.escalation.outcome)).toEqual({ valid: true });
    }
  });

  test("forcePassAssumptions roundsConsumed is threaded through verbatim", () => {
    const record = forcePassAssumptions([], 7, FIXED_LANE_ID);
    expect(record.rounds_consumed).toBe(7);
  });
});
