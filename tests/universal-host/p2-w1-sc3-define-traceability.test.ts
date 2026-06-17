/**
 * tests/universal-host/p2-w1-sc3-define-traceability.test.ts
 *
 * SC-W1-3 (LW1-5) — SMOKE coverage for the AC-id traceability checker. Drives the
 * SHIPPED `checkTraceability()` over a fixture define + plan→receipt→QA→release
 * chain (real path, no seam). The authoritative SC-W1-3 test is LW1-8.
 */
import {
  checkTraceability,
  runSelfCheck,
  TRACE_CHAIN_EXAMPLE,
  TRACE_STAGES,
} from "../../scripts/lib/define-traceability";
import { DEFINE_V1_EXAMPLE } from "../../scripts/lib/define-schema";

const DEFINE = DEFINE_V1_EXAMPLE; // ids: AC-1, AC-2

describe("checkTraceability — happy path (fully traced incl. release gate)", () => {
  it("marks every define id resolved at every stage and ok=true", () => {
    const r = checkTraceability(DEFINE, TRACE_CHAIN_EXAMPLE);
    expect(r.ok).toBe(true);
    expect(r.define_ids).toEqual(["AC-1", "AC-2"]);
    expect(r.unmet).toEqual([]);
    expect(r.orphans).toEqual([]);
    expect(r.release_unmet).toEqual([]);
    for (const row of r.matrix) {
      expect(row.fully_traced).toBe(true);
      for (const stage of TRACE_STAGES) expect(row.status[stage]).toBe("resolved");
    }
  });
});

describe("checkTraceability — release gate is first-class (AC32)", () => {
  it("flags a define id missing from the RELEASE GATE as unmet (incl. release_unmet)", () => {
    const r = checkTraceability(DEFINE, {
      plan: { resolved_ids: ["AC-1", "AC-2"] },
      build_receipt: { resolved_ids: ["AC-1", "AC-2"] },
      qa: { resolved_ids: ["AC-1", "AC-2"] },
      release_gate: { resolved_ids: ["AC-1"] }, // AC-2 withheld at release
    });
    expect(r.ok).toBe(false);
    expect(r.release_unmet).toEqual(["AC-2"]);
    expect(r.unmet).toContainEqual({ id: "AC-2", stage: "release_gate" });
    expect(r.matrix.find((x) => x.id === "AC-2")!.status.release_gate).toBe("unmet");
    // AC-1 is still fully traced
    expect(r.matrix.find((x) => x.id === "AC-1")!.fully_traced).toBe(true);
  });

  it("an explicit unmet_ids assertion at a stage beats presence in resolved_ids", () => {
    const r = checkTraceability(DEFINE, {
      ...TRACE_CHAIN_EXAMPLE,
      qa: { resolved_ids: ["AC-1", "AC-2"], unmet_ids: ["AC-2"] }, // QA ran, AC-2 failed
    });
    expect(r.matrix.find((x) => x.id === "AC-2")!.status.qa).toBe("unmet");
    expect(r.ok).toBe(false);
  });
});

describe("checkTraceability — orphan + missing-stage flagging", () => {
  it("flags an id present in a stage but not in the define artifact as an orphan", () => {
    const r = checkTraceability(DEFINE, {
      ...TRACE_CHAIN_EXAMPLE,
      plan: { resolved_ids: ["AC-1", "AC-2", "AC-ORPHAN"] },
    });
    expect(r.ok).toBe(false);
    expect(r.orphans).toContainEqual({ id: "AC-ORPHAN", stage: "plan" });
    // an orphan does not become a define row
    expect(r.define_ids).not.toContain("AC-ORPHAN");
  });

  it("treats an absent/malformed stage as resolving nothing (fail-closed)", () => {
    const r = checkTraceability(DEFINE, {
      plan: { resolved_ids: ["AC-1", "AC-2"] },
      // build_receipt absent
      qa: "not-an-object" as never,
      release_gate: { resolved_ids: ["AC-1", "AC-2"] },
    });
    expect(r.ok).toBe(false);
    expect(r.unmet).toContainEqual({ id: "AC-1", stage: "build_receipt" });
    expect(r.unmet).toContainEqual({ id: "AC-2", stage: "qa" });
  });
});

describe("checkTraceability — robustness", () => {
  it("never throws on exotic input and reports a structural error for an empty define", () => {
    expect(() => checkTraceability(42 as unknown, null)).not.toThrow();
    const empty = checkTraceability(
      { schema_version: "guild.define.v1", acceptance_criteria: [] },
      TRACE_CHAIN_EXAMPLE
    );
    expect(empty.ok).toBe(false);
    expect(empty.errors.length).toBeGreaterThan(0);
    expect(empty.define_ids).toEqual([]);
  });

  it("is deterministic", () => {
    expect(checkTraceability(DEFINE, TRACE_CHAIN_EXAMPLE)).toEqual(
      checkTraceability(DEFINE, TRACE_CHAIN_EXAMPLE)
    );
  });

  it("self-check passes", () => {
    const { pass, details } = runSelfCheck();
    expect(pass).toBe(true);
    expect(details).toContain("fully-traced=true");
  });
});
