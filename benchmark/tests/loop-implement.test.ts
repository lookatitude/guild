// v1.4.0 — T3b-backend-loops pinning tests for guild:loop-implement (F-3, L3+L4+security-review).
//
// Architect contract: benchmark/plans/v1.4-loop-skill-contracts.md
//   §"Skill 3 — guild:loop-implement".
//
// Verify-done literals pinned in this file:
//   - sentinel `## NO MORE QUESTIONS`
//   - regex literals (re-pinned via the shared helpers)
//   - escalation labels force-pass / extend-cap / rework
//   - cap = 3 (restart cap default)
//   - 5 valid loops_applicable values: none, l3-only, l4-only, both, full

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  getLaneCounter,
  incrementLaneCounter,
} from "../src/counter-store.js";
import {
  activeLayersFor,
  runLoopImplement,
  type RoundFn,
} from "../src/loop-drivers.js";
import { ESCALATION_LABELS } from "../src/loop-escalation.js";
import {
  defaultLoopsApplicable,
  layersFor,
  LOOPS_APPLICABLE_INVALID_ERROR,
  LOOPS_APPLICABLE_VALUES,
  parseLoopsApplicable,
  T6_CARVEOUT_MARKER,
  validatePlanLane,
} from "../src/loop-applicable.js";
import {
  injectSupersededBy,
  isRestartCapHit,
  malformedFindingAssumptionText,
  parseSecurityFindings,
  RESTART_CAP_DEFAULT,
  shouldRestartFromSecurity,
  supersedePriorReceipts,
} from "../src/loop-implement-restart.js";
import { InMemoryLoopJsonlAppender } from "../src/loop-jsonl-stub.js";

let tmpRoot: string;
let runDir: string;
const RUN_ID = "test-run-loop-implement";

beforeEach(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), "guild-loop-implement-"));
  runDir = join(tmpRoot, "runs", RUN_ID);
});

afterEach(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
});

// ──────────────────────────────────────────────────────────────────────────
// loops_applicable enum — five valid values, in canonical order.
// ──────────────────────────────────────────────────────────────────────────

describe("loop-implement / loops_applicable enum", () => {
  it("LOOPS_APPLICABLE_VALUES is exactly [none, l3-only, l4-only, both, full] in order", () => {
    expect(LOOPS_APPLICABLE_VALUES).toEqual([
      "none",
      "l3-only",
      "l4-only",
      "both",
      "full",
    ]);
  });

  it("parseLoopsApplicable accepts each of the 5 valid values (case 1: none)", () => {
    expect(parseLoopsApplicable("none")).toEqual({ ok: true, resolved: "none" });
  });

  it("parseLoopsApplicable accepts each of the 5 valid values (case 2: l3-only)", () => {
    expect(parseLoopsApplicable("l3-only")).toEqual({
      ok: true,
      resolved: "l3-only",
    });
  });

  it("parseLoopsApplicable accepts each of the 5 valid values (case 3: l4-only)", () => {
    expect(parseLoopsApplicable("l4-only")).toEqual({
      ok: true,
      resolved: "l4-only",
    });
  });

  it("parseLoopsApplicable accepts each of the 5 valid values (case 4: both)", () => {
    expect(parseLoopsApplicable("both")).toEqual({ ok: true, resolved: "both" });
  });

  it("parseLoopsApplicable accepts each of the 5 valid values (case 5: full)", () => {
    expect(parseLoopsApplicable("full")).toEqual({ ok: true, resolved: "full" });
  });

  it("parseLoopsApplicable rejects unknown values with the architect's exact stderr line", () => {
    const r = parseLoopsApplicable("L3-Only");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe(LOOPS_APPLICABLE_INVALID_ERROR);
      expect(r.error).toBe(
        "loops_applicable must be one of: none, l3-only, l4-only, both, full",
      );
    }
  });

  it("parseLoopsApplicable rejects empty / whitespace / mixed-case", () => {
    expect(parseLoopsApplicable("").ok).toBe(false);
    expect(parseLoopsApplicable(" full ").ok).toBe(false);
    expect(parseLoopsApplicable("FULL").ok).toBe(false);
    expect(parseLoopsApplicable("yes").ok).toBe(false);
  });

  it("layersFor maps each enum value to the architect's layer-set table", () => {
    expect(layersFor("none")).toEqual({
      L3: false,
      L4: false,
      "security-review": false,
    });
    expect(layersFor("l3-only")).toEqual({
      L3: true,
      L4: false,
      "security-review": false,
    });
    expect(layersFor("l4-only")).toEqual({
      L3: false,
      L4: true,
      "security-review": false,
    });
    expect(layersFor("both")).toEqual({
      L3: true,
      L4: true,
      "security-review": false,
    });
    expect(layersFor("full")).toEqual({
      L3: true,
      L4: true,
      "security-review": true,
    });
  });

  it("activeLayersFor returns ordered ImplLayer[] for each enum value", () => {
    expect(activeLayersFor("none")).toEqual([]);
    expect(activeLayersFor("l3-only")).toEqual(["L3"]);
    expect(activeLayersFor("l4-only")).toEqual(["L4"]);
    expect(activeLayersFor("both")).toEqual(["L3", "L4"]);
    expect(activeLayersFor("full")).toEqual(["L3", "L4", "security-review"]);
  });

  it("defaultLoopsApplicable returns full for backend / frontend / mobile / devops", () => {
    for (const o of ["backend", "frontend", "mobile", "devops"] as const) {
      expect(defaultLoopsApplicable(o)).toBe("full");
    }
  });

  it("defaultLoopsApplicable returns l4-only for qa / technical-writer / copywriter / social-media", () => {
    for (const o of [
      "qa",
      "technical-writer",
      "copywriter",
      "social-media",
    ] as const) {
      expect(defaultLoopsApplicable(o)).toBe("l4-only");
    }
  });

  it("defaultLoopsApplicable returns null for security (must set explicitly)", () => {
    expect(defaultLoopsApplicable("security")).toBeNull();
  });
});

// ──────────────────────────────────────────────────────────────────────────
// validatePlanLane — 4-case decision tree for security-owned lanes + normal
// ──────────────────────────────────────────────────────────────────────────

describe("loop-implement / validatePlanLane — security 4-case decision tree", () => {
  it("CASE 1: security lane omits loops_applicable → reject (must set explicitly)", () => {
    const r = validatePlanLane({
      lane_id: "T6-security",
      owner: "security",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe(
        "security-owned lane T6-security must set loops_applicable explicitly",
      );
    }
  });

  it("CASE 2: security + none + T6 carve-out marker → ACCEPT", () => {
    const r = validatePlanLane({
      lane_id: "T6-security",
      owner: "security",
      loops_applicable: "none",
      loops_applicable_line_comment: T6_CARVEOUT_MARKER,
    });
    expect(r).toEqual({ ok: true, resolved: "none" });
  });

  it("CASE 3: security + none + NO marker → reject (without T6 marker)", () => {
    const r = validatePlanLane({
      lane_id: "T6-security",
      owner: "security",
      loops_applicable: "none",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe(
        "security-owned lane T6-security sets loops_applicable=none without the T6 exemption marker",
      );
    }
  });

  it("CASE 4a: security + l3-only → ACCEPT (normal path)", () => {
    expect(
      validatePlanLane({
        lane_id: "T7",
        owner: "security",
        loops_applicable: "l3-only",
      }),
    ).toEqual({ ok: true, resolved: "l3-only" });
  });

  it("CASE 4b: security + l4-only / both / full → ACCEPT", () => {
    for (const v of ["l4-only", "both", "full"] as const) {
      expect(
        validatePlanLane({
          lane_id: "T7",
          owner: "security",
          loops_applicable: v,
        }),
      ).toEqual({ ok: true, resolved: v });
    }
  });

  it("non-security lane omits loops_applicable → resolves to per-owner default (backend → full)", () => {
    expect(
      validatePlanLane({ lane_id: "T1", owner: "backend" }),
    ).toEqual({ ok: true, resolved: "full" });
  });

  it("non-security lane with invalid loops_applicable → reject with canonical error", () => {
    const r = validatePlanLane({
      lane_id: "T1",
      owner: "backend",
      loops_applicable: "BOTH",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe(LOOPS_APPLICABLE_INVALID_ERROR);
    }
  });

  it("T6 marker is the exact literal string per architect", () => {
    expect(T6_CARVEOUT_MARKER).toBe(
      "# review lane; loops_applicable=none per T6 carve-out",
    );
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Security-finding parsing + restart trigger.
// ──────────────────────────────────────────────────────────────────────────

describe("loop-implement / parseSecurityFindings + shouldRestartFromSecurity", () => {
  const heading = "## Findings\n\n";

  it("severity: high + addressed_by_owner: false → triggers restart", () => {
    const body = `${heading}- severity: high\n  addressed_by_owner: false\n  description: forced-fail injection\n`;
    const parsed = parseSecurityFindings(body);
    expect(parsed.kind).toBe("ok");
    expect(shouldRestartFromSecurity(parsed)).toBe(true);
  });

  it("severity: high + addressed_by_owner: true → does NOT trigger restart", () => {
    const body = `${heading}- severity: high\n  addressed_by_owner: true\n  description: addressed in revision\n`;
    const parsed = parseSecurityFindings(body);
    expect(shouldRestartFromSecurity(parsed)).toBe(false);
  });

  it("severity: medium / low (any addressed value) → no restart", () => {
    const body1 = `${heading}- severity: medium\n  addressed_by_owner: false\n  description: x\n`;
    const body2 = `${heading}- severity: low\n  addressed_by_owner: false\n  description: y\n`;
    expect(shouldRestartFromSecurity(parseSecurityFindings(body1))).toBe(false);
    expect(shouldRestartFromSecurity(parseSecurityFindings(body2))).toBe(false);
  });

  it("findings section absent → no restart", () => {
    const body = `Just security analysis with no Findings heading.\n## NO MORE QUESTIONS\n`;
    const parsed = parseSecurityFindings(body);
    expect(parsed.kind).toBe("no_findings_section");
    expect(shouldRestartFromSecurity(parsed)).toBe(false);
  });

  it("malformed bullet (missing severity) → kind=malformed_bullet, no restart", () => {
    const body = `${heading}- addressed_by_owner: false\n  description: missing severity\n`;
    const parsed = parseSecurityFindings(body);
    expect(parsed.kind).toBe("malformed_bullet");
    expect(shouldRestartFromSecurity(parsed)).toBe(false);
  });

  it("malformed bullet (severity out of vocabulary) → kind=malformed_bullet", () => {
    const body = `${heading}- severity: catastrophic\n  addressed_by_owner: false\n`;
    const parsed = parseSecurityFindings(body);
    expect(parsed.kind).toBe("malformed_bullet");
  });

  it("uses the heading regex /^##\\s+(Findings|Open issues|Blockers)\\b/im — accepts all three headings", () => {
    for (const h of ["## Findings", "## Open issues", "## Blockers"]) {
      const body = `${h}\n\n- severity: high\n  addressed_by_owner: false\n  description: x\n`;
      expect(shouldRestartFromSecurity(parseSecurityFindings(body))).toBe(true);
    }
  });

  it("`BLOCKING:` literal marker WITHOUT the YAML-bullet schema is a NO-OP (regression guard)", () => {
    // The older draft used `BLOCKING:` as the trigger — current parser
    // requires the YAML-bullet format with severity + addressed_by_owner.
    const body = `BLOCKING: forced fail injection\n\n## NO MORE QUESTIONS\n`;
    const parsed = parseSecurityFindings(body);
    expect(parsed.kind).toBe("no_findings_section");
    expect(shouldRestartFromSecurity(parsed)).toBe(false);
  });

  it("malformedFindingAssumptionText returns the architect's literal text", () => {
    expect(malformedFindingAssumptionText("T3b-backend-loops", 5)).toBe(
      "Malformed security finding bullet — treated as no-restart; lane T3b-backend-loops; round 5",
    );
  });

  it("multiple findings — restart fires if ANY single high+unaddressed exists", () => {
    const body = `${heading}- severity: low\n  addressed_by_owner: true\n  description: a\n\n- severity: high\n  addressed_by_owner: false\n  description: b\n\n- severity: medium\n  addressed_by_owner: false\n  description: c\n`;
    const parsed = parseSecurityFindings(body);
    expect(parsed.kind).toBe("ok");
    if (parsed.kind === "ok") expect(parsed.findings).toHaveLength(3);
    expect(shouldRestartFromSecurity(parsed)).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Restart cap = 3 — escalation gate.
// ──────────────────────────────────────────────────────────────────────────

describe("loop-implement / restart cap = 3", () => {
  it("RESTART_CAP_DEFAULT is exactly 3", () => {
    expect(RESTART_CAP_DEFAULT).toBe(3);
  });

  it("isRestartCapHit: counts 0/1/2 are below cap; count 3 is at cap (4th attempt would escalate)", () => {
    expect(isRestartCapHit(0)).toBe(false);
    expect(isRestartCapHit(1)).toBe(false);
    expect(isRestartCapHit(2)).toBe(false);
    expect(isRestartCapHit(3)).toBe(true);
    expect(isRestartCapHit(4)).toBe(true);
  });

  it("isRestartCapHit honors a custom cap (e.g., cap = 2)", () => {
    expect(isRestartCapHit(0, 2)).toBe(false);
    expect(isRestartCapHit(1, 2)).toBe(false);
    expect(isRestartCapHit(2, 2)).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Receipt supersession.
// ──────────────────────────────────────────────────────────────────────────

describe("loop-implement / supersedePriorReceipts + injectSupersededBy", () => {
  it("injectSupersededBy adds frontmatter `superseded_by:` when no frontmatter exists", () => {
    const original = `# Body\nhello\n`;
    const out = injectSupersededBy(original, ".guild/runs/r/handoffs/new.md");
    expect(out).toMatch(/^---\nsuperseded_by: .guild\/runs\/r\/handoffs\/new\.md\n---\n# Body/);
  });

  it("injectSupersededBy appends to existing frontmatter", () => {
    const original = `---\nspecialist: backend\nstatus: complete\n---\n\n# Body\n`;
    const out = injectSupersededBy(original, "newpath.md");
    expect(out).toMatch(/specialist: backend/);
    expect(out).toMatch(/status: complete/);
    expect(out).toMatch(/superseded_by: newpath\.md/);
  });

  it("injectSupersededBy replaces existing `superseded_by:` field on a re-restart", () => {
    const original = `---\nstatus: complete\nsuperseded_by: old.md\n---\n\nbody\n`;
    const out = injectSupersededBy(original, "newer.md");
    expect(out).toMatch(/superseded_by: newer\.md/);
    expect(out).not.toMatch(/superseded_by: old\.md/);
  });

  it("supersedePriorReceipts moves matching receipts to handoffs/superseded/<lane>-restart-<N>/", async () => {
    const handoffsDir = join(runDir, "handoffs");
    await mkdir(handoffsDir, { recursive: true });
    // Plant prior receipts.
    await writeFile(
      join(handoffsDir, "backend-T3b-backend-loops.md"),
      "---\nstatus: complete\n---\n\nold body\n",
      "utf8",
    );
    await writeFile(
      join(handoffsDir, "qa-T3b-backend-loops.md"),
      "---\nstatus: complete\n---\n\nold body\n",
      "utf8",
    );
    // Seed an unrelated receipt that must NOT move.
    await writeFile(
      join(handoffsDir, "backend-T3a-backend-config.md"),
      "---\nstatus: complete\n---\n\nunrelated\n",
      "utf8",
    );

    const result = supersedePriorReceipts({
      runDir,
      laneId: "T3b-backend-loops",
      restartCount: 1,
      newReceiptRelPath: ".guild/runs/r/handoffs/backend-T3b-backend-loops.md",
    });

    expect(result.movedFromTo).toHaveLength(2);
    expect(result.supersededDir).toMatch(/superseded\/T3b-backend-loops-restart-1$/);

    // Moved files have `superseded_by:` injected.
    const moved = await readFile(
      join(result.supersededDir, "backend-T3b-backend-loops.md"),
      "utf8",
    );
    expect(moved).toMatch(/superseded_by:/);

    // Unrelated lane receipt is not moved.
    const stillThere = await readFile(
      join(handoffsDir, "backend-T3a-backend-config.md"),
      "utf8",
    );
    expect(stillThere).toMatch(/unrelated/);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// runLoopImplement — happy paths per layer.
// ──────────────────────────────────────────────────────────────────────────

describe("loop-implement / runLoopImplement happy paths", () => {
  function cleanRound(terminator: string): RoundFn {
    return () => ({
      body: `Layer analysis.\n\n## NO MORE QUESTIONS\n`,
      terminator,
    });
  }

  it("loops_applicable: l3-only → only L3 runs, satisfied in round 1", async () => {
    const jsonl = new InMemoryLoopJsonlAppender();
    const out = await runLoopImplement({
      lane_id: "T-X",
      owner: "backend",
      loops_applicable: "l3-only",
      loops_mode: "implementation",
      cap: 8,
      run_id: RUN_ID,
      task_id: "T-X",
      runDir,
      jsonl,
      roundFns: { L3: cleanRound("qa-property-based-tests") },
      escalationFn: () => "force-pass",
    });
    expect(out.status).toBe("satisfied");
    expect(out.layers_run).toEqual(["L3"]);
    expect(out.rounds_per_layer.L3).toBe(1);
    expect(out.rounds_per_layer.L4).toBeUndefined();
    expect(getLaneCounter(runDir, RUN_ID, "T-X", "L3_round")).toBe(1);
  });

  it("loops_applicable: l4-only → only L4 runs, satisfied in round 1", async () => {
    const jsonl = new InMemoryLoopJsonlAppender();
    const out = await runLoopImplement({
      lane_id: "T-Y",
      owner: "backend",
      loops_applicable: "l4-only",
      loops_mode: "implementation",
      cap: 8,
      run_id: RUN_ID,
      task_id: "T-Y",
      runDir,
      jsonl,
      roundFns: { L4: cleanRound("qa") },
      escalationFn: () => "force-pass",
    });
    expect(out.layers_run).toEqual(["L4"]);
    expect(out.rounds_per_layer.L4).toBe(1);
    expect(getLaneCounter(runDir, RUN_ID, "T-Y", "L4_round")).toBe(1);
  });

  it("loops_applicable: both → L3 then L4 run; security-review skipped", async () => {
    const jsonl = new InMemoryLoopJsonlAppender();
    const out = await runLoopImplement({
      lane_id: "T-B",
      owner: "backend",
      loops_applicable: "both",
      loops_mode: "implementation",
      cap: 8,
      run_id: RUN_ID,
      task_id: "T-B",
      runDir,
      jsonl,
      roundFns: {
        L3: cleanRound("qa-property-based-tests"),
        L4: cleanRound("qa"),
      },
      escalationFn: () => "force-pass",
    });
    expect(out.status).toBe("satisfied");
    expect(out.layers_run).toEqual(["L3", "L4"]);
    expect(out.restart_count).toBe(0);
  });

  it("loops_applicable: full + security passes cleanly → no restart, status satisfied", async () => {
    const jsonl = new InMemoryLoopJsonlAppender();
    const out = await runLoopImplement({
      lane_id: "T-F",
      owner: "backend",
      loops_applicable: "full",
      loops_mode: "implementation",
      cap: 8,
      run_id: RUN_ID,
      task_id: "T-F",
      runDir,
      jsonl,
      roundFns: {
        L3: cleanRound("qa-property-based-tests"),
        L4: cleanRound("qa"),
        "security-review": () => ({
          body: `Security review: no findings.\n\n## NO MORE QUESTIONS\n`,
          terminator: "security",
        }),
      },
      escalationFn: () => "force-pass",
    });
    expect(out.status).toBe("satisfied");
    expect(out.layers_run).toEqual(["L3", "L4", "security-review"]);
    expect(out.restart_count).toBe(0);
  });

  it("loops_applicable: none → no layers run, status satisfied immediately", async () => {
    const jsonl = new InMemoryLoopJsonlAppender();
    const out = await runLoopImplement({
      lane_id: "T-N",
      owner: "researcher",
      loops_applicable: "none",
      loops_mode: "implementation",
      cap: 8,
      run_id: RUN_ID,
      task_id: "T-N",
      runDir,
      jsonl,
      roundFns: {},
      escalationFn: () => "force-pass",
    });
    expect(out.status).toBe("satisfied");
    expect(out.layers_run).toEqual([]);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// runLoopImplement — security restart.
// ──────────────────────────────────────────────────────────────────────────

describe("loop-implement / runLoopImplement security restart", () => {
  function cleanRound(terminator: string): RoundFn {
    return () => ({
      body: `Layer analysis.\n\n## NO MORE QUESTIONS\n`,
      terminator,
    });
  }

  function highUnaddressedSecurity(): RoundFn {
    return () => ({
      body: `## Findings\n\n- severity: high\n  addressed_by_owner: false\n  description: forced-fail injection — backend's redact-log skipped a known token shape.\n\n## NO MORE QUESTIONS\n`,
      terminator: "security",
    });
  }

  it("security finds high+unaddressed → restart fires, restart_count increments", async () => {
    const jsonl = new InMemoryLoopJsonlAppender();
    // Plant prior receipts to simulate completed L3 + L4 receipts.
    await mkdir(join(runDir, "handoffs"), { recursive: true });
    await writeFile(
      join(runDir, "handoffs", "backend-T-R.md"),
      `---\nstatus: complete\n---\n\nbody\n`,
      "utf8",
    );

    let securityCalls = 0;
    const out = await runLoopImplement({
      lane_id: "T-R",
      owner: "backend",
      loops_applicable: "full",
      loops_mode: "implementation",
      cap: 8,
      restart_cap: 2, // small cap so we hit it deterministically
      run_id: RUN_ID,
      task_id: "T-R",
      runDir,
      jsonl,
      roundFns: {
        L3: cleanRound("qa-property-based-tests"),
        L4: cleanRound("qa"),
        "security-review": () => {
          securityCalls += 1;
          // First call surfaces a high+unaddressed finding (restart).
          // Subsequent calls return clean (so restart settles after 1 fire).
          if (securityCalls === 1) {
            return highUnaddressedSecurity()(1, null);
          }
          return cleanRound("security")(1, null);
        },
      },
      escalationFn: () => "force-pass",
    });
    expect(out.restart_count).toBe(1);
    expect(out.superseded_receipts.length).toBeGreaterThan(0);
    expect(out.status).toBe("satisfied");
    // The restart counter persisted in counters.json.
    expect(getLaneCounter(runDir, RUN_ID, "T-R", "restart_count")).toBe(1);
  });

  it("4th restart attempt (restart_cap=2, 3rd fire) → restart_cap_hit escalation", async () => {
    const jsonl = new InMemoryLoopJsonlAppender();
    await mkdir(join(runDir, "handoffs"), { recursive: true });
    await writeFile(
      join(runDir, "handoffs", "backend-T-RC.md"),
      `---\nstatus: complete\n---\n\nbody\n`,
      "utf8",
    );

    const reasons: string[] = [];
    const out = await runLoopImplement({
      lane_id: "T-RC",
      owner: "backend",
      loops_applicable: "full",
      loops_mode: "implementation",
      cap: 8,
      restart_cap: 2,
      run_id: RUN_ID,
      task_id: "T-RC",
      runDir,
      jsonl,
      roundFns: {
        L3: () => ({
          body: `## NO MORE QUESTIONS\n`,
          terminator: "qa-property-based-tests",
        }),
        L4: () => ({ body: `## NO MORE QUESTIONS\n`, terminator: "qa" }),
        "security-review": highUnaddressedSecurity(),
      },
      escalationFn: (reason) => {
        reasons.push(reason);
        return "force-pass";
      },
    });
    expect(reasons).toContain("restart_cap_hit");
    expect(out.status).toBe("restart_cap_hit");
    // restart fires twice (count 1 + 2), then 3rd attempt hits the cap.
    expect(out.restart_count).toBe(2);
    const escs = jsonl.byType("escalation");
    expect(escs.find((e) => e.reason === "restart_cap_hit")?.options_offered).toEqual(
      ESCALATION_LABELS,
    );
  });

  it("malformed security-finding bullet → no restart, assumption logged with literal text", async () => {
    const jsonl = new InMemoryLoopJsonlAppender();
    const out = await runLoopImplement({
      lane_id: "T-M",
      owner: "backend",
      loops_applicable: "full",
      loops_mode: "implementation",
      cap: 8,
      run_id: RUN_ID,
      task_id: "T-M",
      runDir,
      jsonl,
      roundFns: {
        L3: () => ({
          body: `## NO MORE QUESTIONS\n`,
          terminator: "qa-property-based-tests",
        }),
        L4: () => ({ body: `## NO MORE QUESTIONS\n`, terminator: "qa" }),
        "security-review": () => ({
          body: `## Findings\n\n- addressed_by_owner: false\n  description: missing severity\n\n## NO MORE QUESTIONS\n`,
          terminator: "security",
        }),
      },
      escalationFn: () => "force-pass",
    });
    expect(out.status).toBe("satisfied");
    expect(out.restart_count).toBe(0);
    const assumptions = jsonl.byType("assumption_logged");
    expect(
      assumptions.some((a) =>
        a.assumption_text.startsWith("Malformed security finding bullet"),
      ),
    ).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Per-lane counter isolation under parallel restarts.
// ──────────────────────────────────────────────────────────────────────────

describe("loop-implement / per-lane counter isolation", () => {
  it("lane A restart does NOT touch lane B counters", async () => {
    // Pre-seed both lanes' counters using the v1.4 lane-keyed schema.
    incrementLaneCounter(runDir, RUN_ID, "laneA", "L3_round");
    incrementLaneCounter(runDir, RUN_ID, "laneA", "L4_round");
    incrementLaneCounter(runDir, RUN_ID, "laneB", "L3_round", 5);
    incrementLaneCounter(runDir, RUN_ID, "laneB", "L4_round", 5);
    expect(getLaneCounter(runDir, RUN_ID, "laneB", "L3_round")).toBe(5);

    // Plant a prior receipt for laneA.
    await mkdir(join(runDir, "handoffs"), { recursive: true });
    await writeFile(
      join(runDir, "handoffs", "backend-laneA.md"),
      `---\nstatus: complete\n---\n\nbody\n`,
      "utf8",
    );

    let secCalls = 0;
    const jsonl = new InMemoryLoopJsonlAppender();
    await runLoopImplement({
      lane_id: "laneA",
      owner: "backend",
      loops_applicable: "full",
      loops_mode: "implementation",
      cap: 4,
      restart_cap: 3,
      run_id: RUN_ID,
      task_id: "laneA",
      runDir,
      jsonl,
      roundFns: {
        L3: () => ({
          body: `## NO MORE QUESTIONS\n`,
          terminator: "qa-property-based-tests",
        }),
        L4: () => ({ body: `## NO MORE QUESTIONS\n`, terminator: "qa" }),
        "security-review": () => {
          secCalls += 1;
          if (secCalls === 1) {
            return {
              body: `## Findings\n\n- severity: high\n  addressed_by_owner: false\n  description: x\n\n## NO MORE QUESTIONS\n`,
              terminator: "security",
            };
          }
          return { body: `## NO MORE QUESTIONS\n`, terminator: "security" };
        },
      },
      escalationFn: () => "force-pass",
    });

    // laneB counters MUST be unchanged.
    expect(getLaneCounter(runDir, RUN_ID, "laneB", "L3_round")).toBe(5);
    expect(getLaneCounter(runDir, RUN_ID, "laneB", "L4_round")).toBe(5);
    // laneA's L3/L4 counters were reset on restart, then re-incremented for the
    // second pass — count depends on machinery but ≥ 1.
    expect(
      getLaneCounter(runDir, RUN_ID, "laneA", "L3_round"),
    ).toBeGreaterThanOrEqual(1);
    // restart counter for laneA = 1.
    expect(getLaneCounter(runDir, RUN_ID, "laneA", "restart_count")).toBe(1);
    // restart counter for laneB MUST remain 0.
    expect(getLaneCounter(runDir, RUN_ID, "laneB", "restart_count")).toBe(0);
  });
});
