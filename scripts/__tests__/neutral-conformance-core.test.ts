/**
 * __tests__/neutral-conformance-core.test.ts
 *
 * MH-02 (multi-host-runtime-convergence, W1) — scenario definitions, support
 * claim semantics, and the core's own import-closure boundary verdict.
 *
 * Covers MH-02 acceptance 2 (core owns scenario definitions and typed
 * contracts/results) and acceptance 3 (core imports no host adapter, hook,
 * wrapper, launcher, PaneAdapter backend, benchmark, or website
 * implementation) — the latter proven by an import-closure scan over the
 * declared core file set.
 *
 * Repo-wide dependency-boundary enforcement (MHRC-MOD-001..004) is W4/MH-07.
 * What is proven here is narrower and self-contained: the MH-02 core is
 * import-closed, so no direct OR transitive edge can reach a forbidden
 * boundary. The scan therefore needs no dependency-graph tool of its own.
 *
 * The scan reads real repository bytes (that is the point), so this file uses
 * fs/path; the CORE itself is I/O-free and the evaluator it calls is a pure
 * function of {path, source} records.
 */

import * as fs from "fs";
import * as path from "path";

import {
  NEUTRAL_CORE_MEMBERS,
  NEUTRAL_FORBIDDEN_BOUNDARY_MATCHERS,
  evaluateNeutralCoreBoundary,
  extractNeutralImportSpecifiers,
} from "../../src/modules/lifecycle/workflows/neutral-core-boundary";

import {
  NEUTRAL_CORE_SCENARIOS,
  NEUTRAL_CORE_WAVE_OWNER,
  NEUTRAL_EVIDENCE_PROFILES,
  NEUTRAL_REQUIRED_CORE_SCENARIO_IDS,
  NEUTRAL_SCENARIO_SUITE_ID,
  NEUTRAL_SCENARIO_SUITE_VERSION,
  NEUTRAL_SUPPORT_TRANSITIONS,
  NEUTRAL_UNEVALUATED_SUPPORT,
  applyNeutralSupportTransition,
  deriveNeutralSupportClaim,
  evaluateNeutralConformanceDecision,
  validateNeutralScenarioRegistry,
} from "../../src/modules/lifecycle/workflows/neutral-conformance-core";
import type {
  NeutralConformanceEvidence,
  NeutralEvidenceFreshnessVerdict,
  NeutralRuntimeBinding,
  NeutralScenarioResult,
  NeutralSupportRecord,
} from "../../src/modules/lifecycle/workflows/neutral-conformance-core";

import { NEUTRAL_LIFECYCLE_PHASES } from "../../src/modules/lifecycle/workflows/neutral-runtime-contracts";

const CORE_DIR = path.resolve(__dirname, "..", "..", "src", "modules", "lifecycle", "workflows");

function readCoreFiles(): Array<{ path: string; source: string }> {
  return NEUTRAL_CORE_MEMBERS.map((member) => ({
    path: member,
    source: fs.readFileSync(path.join(CORE_DIR, member), "utf8"),
  }));
}

// ---------------------------------------------------------------------------
// Acceptance 3 — the declared core is import-closed
// ---------------------------------------------------------------------------

describe("MH-02 acceptance 3 — core import closure", () => {
  it("declares a non-empty core membership whose every file exists on disk", () => {
    expect(NEUTRAL_CORE_MEMBERS.length).toBeGreaterThan(0);
    for (const member of NEUTRAL_CORE_MEMBERS) {
      expect(fs.existsSync(path.join(CORE_DIR, member))).toBe(true);
    }
  });

  it("returns a succeeded boundary outcome for the real core sources", () => {
    const outcome = evaluateNeutralCoreBoundary(readCoreFiles());
    expect(outcome.type).toBe("guild.boundary_outcome.v1");
    expect(outcome.disposition).toBe("succeeded");
    expect(outcome.reason_code).toBeNull();
    expect(outcome.facts.forbidden_edges).toEqual([]);
    expect(outcome.facts.unclassified_edges).toEqual([]);
    expect(outcome.facts.node_count).toBe(NEUTRAL_CORE_MEMBERS.length);
    expect(typeof outcome.facts.edge_count).toBe("number");
  });

  it("proves the closure claim by rejecting each forbidden boundary class", () => {
    const forbidden: Array<[string, string]> = [
      ["host adapter", '../../host-runtime'],
      ["hook implementation", '../../../../hooks/lib/security/scrubbed-write'],
      ["wrapper / launcher", '../../dispatch/workflows/agent-team-launcher'],
      ["pane adapter backend", './pane-adapter-tmux'],
      ["benchmark internals", '../../evals/workflows/benchmark'],
      ["website internals", '../../../../website/lib/render'],
      ["generated mirror", '../resources/module-resources.json'],
      ["node io builtin", 'fs'],
    ];
    for (const [label, specifier] of forbidden) {
      const outcome = evaluateNeutralCoreBoundary([
        { path: NEUTRAL_CORE_MEMBERS[0], source: `import x from "${specifier}";` },
        ...readCoreFiles().slice(1),
      ]);
      expect([label, outcome.disposition]).toEqual([label, "failed"]);
      expect([label, outcome.reason_code]).toEqual([label, "boundary_forbidden_edge"]);
      expect(
        (outcome.facts.forbidden_edges as Array<{ specifier: string }>).some(
          (edge) => edge.specifier === specifier
        )
      ).toBe(true);
    }
  });

  it("fails an unclassified destination rather than passing it (MHRC-MOD-001 rule)", () => {
    const outcome = evaluateNeutralCoreBoundary([
      { path: NEUTRAL_CORE_MEMBERS[0], source: 'import z from "some-npm-package";' },
      ...readCoreFiles().slice(1),
    ]);
    expect(outcome.disposition).toBe("failed");
    expect(outcome.reason_code).toBe("boundary_unclassified_edge");
  });

  it("permits intra-core relative edges only", () => {
    const outcome = evaluateNeutralCoreBoundary([
      {
        path: "neutral-lifecycle-machine.ts",
        source: 'import { neutralOutcome } from "./neutral-runtime-contracts";',
      },
      ...readCoreFiles().filter((f) => f.path !== "neutral-lifecycle-machine.ts"),
    ]);
    expect(outcome.disposition).toBe("succeeded");
  });

  it("fails when declared membership and supplied files disagree", () => {
    const missing = evaluateNeutralCoreBoundary(readCoreFiles().slice(1));
    expect(missing.disposition).toBe("failed");
    expect(missing.reason_code).toBe("boundary_membership_mismatch");

    const extra = evaluateNeutralCoreBoundary([
      ...readCoreFiles(),
      { path: "not-a-member.ts", source: "" },
    ]);
    expect(extra.disposition).toBe("failed");
    expect(extra.reason_code).toBe("boundary_membership_mismatch");
  });

  it("extracts static, type-only, re-export, dynamic, and require specifiers", () => {
    const specifiers = extractNeutralImportSpecifiers(
      [
        'import a from "./a";',
        'import type { B } from "./b";',
        'export * from "./c";',
        'export { d } from "./d";',
        'const e = await import("./e");',
        'const f = require("./f");',
      ].join("\n")
    );
    expect(specifiers.sort()).toEqual(["./a", "./b", "./c", "./d", "./e", "./f"]);
  });

  // -------------------------------------------------------------------------
  // MH-02-R1-B03 — the extractor is lexical, so indentation and comments cannot
  // hide an edge and commented-out code cannot invent one.
  // -------------------------------------------------------------------------

  describe("MH-02-R1-B03 adversarial import syntax", () => {
    /** Forms that MUST yield the specifier. Each was a bypass or is a near-miss. */
    it.each([
      ["leading-indented static", '  import * as fs from "fs";'],
      ["tab-indented static", '\timport * as fs from "fs";'],
      ["multiline static", 'import {\n  readFileSync,\n} from "fs";'],
      ["comment-separated dynamic", 'import /* core */ ("fs")'],
      ["newline-separated dynamic", 'import\n(\n"fs"\n)'],
      ["comment-separated require", 'require /* c */ ("fs")'],
      ["indented bare import", '    import "fs";'],
      ["type-only indented", '  import type { Stats } from "fs";'],
      ["re-export indented", '  export * from "fs";'],
      ["named re-export", '  export { readFileSync } from "fs";'],
      ["default+named", 'import fs, { readFileSync } from "fs";'],
      ["single quotes", "  import fs from 'fs';"],
      ["trailing line comment", 'import fs from "fs"; // the io builtin'],
      ["block comment before statement", '/* header */ import fs from "fs";'],
      ["require inside an expression", 'const x = { fs: require("fs") };'],
      ["dynamic import in a ternary", 'const p = cond ? import("fs") : null;'],
      ["node: prefixed", '  import * as fs from "node:fs";'],
    ])("extracts the specifier from a %s form", (_label, source) => {
      const specifiers = extractNeutralImportSpecifiers(source);
      expect(specifiers.some((s) => s === "fs" || s === "node:fs")).toBe(true);
    });

    /** Forms that MUST NOT yield a specifier: they are comments or strings. */
    it.each([
      ["commented-out require", '// require("fs")'],
      ["commented-out static import", '// import fs from "fs";'],
      ["block-commented import", '/* import fs from "fs"; */'],
      ["jsdoc mentioning an import", '/**\n * imports no host adapter\n * import fs from "fs"\n */'],
      ["import word inside a string", 'const s = "import fs from \\"fs\\"";'],
      ["require word inside a string", 'const s = "require(\\"fs\\")";'],
      ["from word inside a string", 'const s = "from \\"fs\\"";'],
      ["identifier merely prefixed with require", 'const requireish = requireX("fs");'],
      ["regex literal containing a require call", 'const re = /require\\("fs"\\)/;'],
      ["template literal containing an import", 'const t = `import fs from "fs"`;'],
    ])("ignores a %s", (_label, source) => {
      expect(extractNeutralImportSpecifiers(source)).toEqual([]);
    });

    it("does not misread division as a regex literal", () => {
      expect(extractNeutralImportSpecifiers('const r = 10 / 2; const s = a / b;')).toEqual([]);
    });

    it("still sees an edge hidden inside a template interpolation", () => {
      expect(extractNeutralImportSpecifiers('const t = `${require("fs")}`;')).toEqual(["fs"]);
    });

    it("gives a FORBIDDEN verdict for each previously-bypassing form", () => {
      for (const source of [
        '  import * as fs from "fs";',
        'import /* core */ ("fs")',
        'import {\n  readFileSync,\n} from "fs";',
      ]) {
        const files = NEUTRAL_CORE_MEMBERS.map((member, index) => ({
          path: member,
          source: index === 0 ? source : "",
        }));
        const verdict = evaluateNeutralCoreBoundary(files);
        expect(verdict.disposition).toBe("failed");
        expect(verdict.reason_code).toBe("boundary_forbidden_edge");
      }
    });

    it("does NOT report a forbidden edge for a commented-out require", () => {
      const files = NEUTRAL_CORE_MEMBERS.map((member, index) => ({
        path: member,
        source: index === 0 ? '// require("fs")' : "",
      }));
      expect(evaluateNeutralCoreBoundary(files).disposition).toBe("succeeded");
    });
  });

  it("declares a forbidden matcher for every boundary class MH-02 acceptance 3 names", () => {
    const ids = NEUTRAL_FORBIDDEN_BOUNDARY_MATCHERS.map((matcher) => matcher.id);
    for (const required of [
      "host_adapter",
      "hook_implementation",
      "wrapper_or_launcher",
      "execution_transport",
      "benchmark_internals",
      "website_internals",
      "generated_mirror",
      "compatibility_shim",
      "node_io_builtin",
    ]) {
      expect(ids).toContain(required);
    }
  });
});

// ---------------------------------------------------------------------------
// The core carries no second phase vocabulary
// ---------------------------------------------------------------------------

describe("phase vocabulary drift guard", () => {
  it("matches the CANONICAL_PHASES literal already declared by run-lifecycle.ts", () => {
    // Read as TEXT, never imported: run-lifecycle.ts depends on hooks and
    // host-runtime, so importing it into the neutral core would break closure.
    const source = fs.readFileSync(path.join(CORE_DIR, "run-lifecycle.ts"), "utf8");
    const match = /export const CANONICAL_PHASES = \[([^\]]*)\]/.exec(source);
    expect(match).not.toBeNull();
    const declared = (match as RegExpExecArray)[1]
      .split(",")
      .map((part) => part.trim().replace(/^"|"$/g, ""))
      .filter((part) => part.length > 0);
    expect(declared).toEqual([...NEUTRAL_LIFECYCLE_PHASES]);
  });
});

// ---------------------------------------------------------------------------
// Scenario definitions
// ---------------------------------------------------------------------------

describe("neutral scenario definitions", () => {
  it("pins the suite identity it was authored against", () => {
    expect(NEUTRAL_SCENARIO_SUITE_ID).toBe("guild.conformance_scenarios.v1");
    expect(NEUTRAL_SCENARIO_SUITE_VERSION).toBe("1.0.0");
    expect(NEUTRAL_CORE_WAVE_OWNER).toEqual({
      wave_id: "W1",
      work_item_id: "MH-02",
      key: "W1/MH-02",
    });
  });

  it("defines exactly the five W1/MH-02-owned scenarios and claims no other owner's work", () => {
    expect(NEUTRAL_CORE_SCENARIOS.map((s) => s.stable_id)).toEqual([
      "MHRC-LIF-001",
      "MHRC-LIF-002",
      "MHRC-LIF-003",
      "MHRC-LIF-004",
      "MHRC-UNS-002",
    ]);
    for (const scenario of NEUTRAL_CORE_SCENARIOS) {
      expect(scenario.implementation_wave_owner).toEqual(NEUTRAL_CORE_WAVE_OWNER);
    }
  });

  it("omits every MH-06 receipt-integrity scenario", () => {
    const ids = NEUTRAL_CORE_SCENARIOS.map((s) => s.stable_id);
    for (const mh06 of [
      "MHRC-RCT-001",
      "MHRC-RCT-002",
      "MHRC-RCT-003",
      "MHRC-RCT-004",
      "MHRC-RCT-005",
    ]) {
      expect(ids).not.toContain(mh06);
    }
  });

  it("satisfies the frozen scenario_field_contract for every scenario", () => {
    const outcome = validateNeutralScenarioRegistry();
    expect(outcome.disposition).toBe("succeeded");
    expect(outcome.facts.scenario_count).toBe(5);
    expect(outcome.facts.unique_stable_ids).toBe(5);
  });

  it("rejects a duplicate stable id", () => {
    const outcome = validateNeutralScenarioRegistry([
      NEUTRAL_CORE_SCENARIOS[0],
      NEUTRAL_CORE_SCENARIOS[0],
    ]);
    expect(outcome.disposition).toBe("failed");
    expect(outcome.reason_code).toBe("scenario_registry_invalid");
    expect(outcome.facts.errors).toContain("duplicate stable_id MHRC-LIF-001");
  });

  it("rejects an empty precondition list, an unknown category, and an unknown profile", () => {
    const base = NEUTRAL_CORE_SCENARIOS[0];
    for (const [patch, needle] of [
      [{ preconditions: [] }, "preconditions"],
      [{ category: "vibes" }, "category"],
      [{ evidence_requirements: [{ profile: "E-NOPE", assertions: ["x"] }] }, "profile"],
      [{ expected_typed_outcome: { ...base.expected_typed_outcome, disposition: "ok" } }, "disposition"],
    ] as Array<[Record<string, unknown>, string]>) {
      const outcome = validateNeutralScenarioRegistry([{ ...base, ...patch } as never]);
      expect(outcome.disposition).toBe("failed");
      expect((outcome.facts.errors as string[]).join(" ")).toContain(needle);
    }
  });

  it("references only declared evidence profiles with non-empty kinds and bindings", () => {
    for (const scenario of NEUTRAL_CORE_SCENARIOS) {
      expect(scenario.evidence_requirements.length).toBeGreaterThan(0);
      for (const requirement of scenario.evidence_requirements) {
        const profile = NEUTRAL_EVIDENCE_PROFILES[requirement.profile];
        expect(profile).toBeDefined();
        expect(profile.required_kinds.length).toBeGreaterThan(0);
        expect(profile.required_bindings.length).toBeGreaterThan(0);
        expect(requirement.assertions.length).toBeGreaterThan(0);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Support claim semantics — six orthogonal dimensions, never collapsed
// ---------------------------------------------------------------------------

describe("neutral support claim", () => {
  it("starts every dimension at not_evaluated", () => {
    expect(NEUTRAL_UNEVALUATED_SUPPORT).toEqual({
      recognized: "not_evaluated",
      rendered: "not_evaluated",
      installed: "not_evaluated",
      activated: "not_evaluated",
      updated: "not_evaluated",
      conformant: "not_evaluated",
    });
  });

  it("declares the five contract transition rules", () => {
    expect(NEUTRAL_SUPPORT_TRANSITIONS.map((t) => t.operation)).toEqual([
      "render",
      "install",
      "activate",
      "update",
      "verify",
    ]);
  });

  it("refuses a transition whose precondition is unproven", () => {
    const { record, outcome } = applyNeutralSupportTransition(
      NEUTRAL_UNEVALUATED_SUPPORT,
      "render",
      { satisfied: true }
    );
    expect(outcome.type).toBe("guild.support_transition_outcome.v1");
    expect(outcome.disposition).toBe("refused");
    expect(outcome.reason_code).toBe("support_precondition_unproven");
    expect(record).toEqual(NEUTRAL_UNEVALUATED_SUPPORT);
  });

  it("promotes one dimension at a time and never implies the next", () => {
    let record: NeutralSupportRecord = {
      ...NEUTRAL_UNEVALUATED_SUPPORT,
      recognized: "satisfied",
    };
    for (const operation of ["render", "install", "activate"] as const) {
      const step = applyNeutralSupportTransition(record, operation, { satisfied: true });
      expect(step.outcome.disposition).toBe("succeeded");
      record = step.record;
    }
    expect(record.rendered).toBe("satisfied");
    expect(record.installed).toBe("satisfied");
    expect(record.activated).toBe("satisfied");
    // recognition/render/install/activate never imply conformance
    expect(record.conformant).toBe("not_evaluated");
    expect(record.updated).toBe("not_evaluated");
  });

  it("records a failed dimension without promoting it", () => {
    const record = { ...NEUTRAL_UNEVALUATED_SUPPORT, recognized: "satisfied" as const };
    const step = applyNeutralSupportTransition(record, "render", { satisfied: false });
    expect(step.outcome.disposition).toBe("failed");
    expect(step.outcome.reason_code).toBe("support_operation_failed");
    expect(step.record.rendered).toBe("failed");
  });

  it("resets activated and conformant when an update lands", () => {
    const record = {
      recognized: "satisfied" as const,
      rendered: "satisfied" as const,
      installed: "satisfied" as const,
      activated: "satisfied" as const,
      updated: "not_evaluated" as const,
      conformant: "satisfied" as const,
    };
    const step = applyNeutralSupportTransition(record, "update", { satisfied: true });
    expect(step.outcome.disposition).toBe("succeeded");
    expect(step.record.updated).toBe("satisfied");
    expect(step.record.activated).toBe("not_evaluated");
    expect(step.record.conformant).toBe("not_evaluated");
  });

  it("never collapses the six dimensions into one supported value", () => {
    const claim = deriveNeutralSupportClaim({
      recognized: "satisfied",
      rendered: "satisfied",
      installed: "failed",
      activated: "not_evaluated",
      updated: "not_evaluated",
      conformant: "unsupported",
    });
    expect(Object.keys(claim.states).sort()).toEqual([
      "activated",
      "conformant",
      "installed",
      "recognized",
      "rendered",
      "updated",
    ]);
    expect(claim.proven).toEqual(["recognized", "rendered"]);
    expect(claim.unproven).toEqual(["installed", "activated", "updated", "conformant"]);
    expect((claim as unknown as Record<string, unknown>).supported).toBeUndefined();
    expect(claim.collapsed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Conformance decision
// ---------------------------------------------------------------------------

describe("neutral conformance decision", () => {
  const required = NEUTRAL_CORE_SCENARIOS.map((s) => s.stable_id);

  const ACTIVATED_RUNTIME: NeutralRuntimeBinding = {
    host_id: "claude-code-cli",
    host_version: "2.2.0",
    runtime_version: "guild-2.2.0",
    release_id: "rel-2026-07-26-a",
    contract_version: 1,
  };

  /** A complete, ordered, receipt-bound, fresh, exactly-bound evidence package. */
  function evidence(
    patch: Partial<NeutralConformanceEvidence> = {},
    perResult: (
      result: NeutralScenarioResult,
      index: number
    ) => NeutralScenarioResult = (r) => r
  ): NeutralConformanceEvidence {
    return {
      suite_id: NEUTRAL_SCENARIO_SUITE_ID,
      suite_version: NEUTRAL_SCENARIO_SUITE_VERSION,
      required_scenario_ids: [...required],
      activated_runtime: ACTIVATED_RUNTIME,
      results: NEUTRAL_CORE_SCENARIOS.map((scenario, index) =>
        perResult(
          {
            stable_id: scenario.stable_id,
            outcome_type: scenario.expected_typed_outcome.type,
            disposition: scenario.expected_typed_outcome.disposition,
            reason_code:
              scenario.expected_typed_outcome.disposition === "succeeded"
                ? null
                : scenario.stable_id === "MHRC-UNS-002"
                  ? "policy_denied"
                  : "gate_unsatisfied",
            receipt_ref: `receipt:run-1#${scenario.stable_id}`,
            runtime_binding: ACTIVATED_RUNTIME,
            evidence_freshness: "fresh",
          },
          index
        )
      ),
      ...patch,
    };
  }

  it("promotes only when every required scenario matched its expected disposition", () => {
    const outcome = evaluateNeutralConformanceDecision(evidence());
    expect(outcome.type).toBe("guild.support_transition_outcome.v1");
    expect(outcome.disposition).toBe("succeeded");
    expect(outcome.facts.may_promote_conformant).toBe(true);
    expect(outcome.facts.activated_runtime).toEqual(ACTIVATED_RUNTIME);
  });

  it("counts an expected refusal as a pass (explicit refusal satisfies the scenario)", () => {
    const pkg = evidence();
    expect(pkg.results.find((r) => r.stable_id === "MHRC-LIF-002")?.disposition).toBe("refused");
    expect(evaluateNeutralConformanceDecision(pkg).disposition).toBe("succeeded");
  });

  it("fails promotion when a required scenario produced the wrong disposition", () => {
    const outcome = evaluateNeutralConformanceDecision(
      evidence({}, (r) =>
        r.stable_id === "MHRC-LIF-001" ? { ...r, disposition: "failed", reason_code: "gate_unsatisfied" } : r
      )
    );
    expect(outcome.disposition).toBe("failed");
    expect(outcome.reason_code).toBe("scenario_result_mismatch");
    expect(outcome.facts.may_promote_conformant).toBe(false);
  });

  it("is deterministic across repeated evaluation", () => {
    const a = evaluateNeutralConformanceDecision(evidence());
    const b = evaluateNeutralConformanceDecision(evidence());
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  // -------------------------------------------------------------------------
  // MH-02-R1-B04 — promotion cannot be obtained without release-bound evidence
  // -------------------------------------------------------------------------

  /** The reviewer's exact probe #1: zero scenarios. */
  it("refuses an entirely empty evidence package", () => {
    const outcome = evaluateNeutralConformanceDecision(
      {} as unknown as NeutralConformanceEvidence
    );
    expect(outcome.disposition).toBe("refused");
    expect(outcome.reason_code).toBe("scenario_suite_version_mismatch");
    expect(outcome.facts.may_promote_conformant).toBe(false);
  });

  it("refuses an empty required scenario set even with the right suite tuple", () => {
    const outcome = evaluateNeutralConformanceDecision(
      evidence({ required_scenario_ids: [], results: [] })
    );
    expect(outcome.disposition).toBe("refused");
    expect(outcome.reason_code).toBe("scenario_required_set_mismatch");
  });

  it("refuses a caller-narrowed required set that omits a core scenario", () => {
    const narrowed = required.slice(0, 2);
    const outcome = evaluateNeutralConformanceDecision(
      evidence({
        required_scenario_ids: narrowed,
        results: evidence().results.slice(0, 2),
      })
    );
    expect(outcome.reason_code).toBe("scenario_required_set_mismatch");
    expect(outcome.facts.omitted_required_scenarios).toEqual(required.slice(2));
  });

  /** The reviewer's exact probe #2: five bare disposition strings. */
  it("refuses bare disposition-only records that carry no typed outcome", () => {
    const bare = {
      suite_id: NEUTRAL_SCENARIO_SUITE_ID,
      suite_version: NEUTRAL_SCENARIO_SUITE_VERSION,
      required_scenario_ids: [...required],
      activated_runtime: ACTIVATED_RUNTIME,
      results: NEUTRAL_CORE_SCENARIOS.map((s) => ({
        stable_id: s.stable_id,
        disposition: s.expected_typed_outcome.disposition,
      })),
    } as unknown as NeutralConformanceEvidence;
    const outcome = evaluateNeutralConformanceDecision(bare);
    expect(outcome.disposition).toBe("refused");
    expect(outcome.reason_code).toBe("scenario_evidence_incomplete");
    expect(outcome.facts.may_promote_conformant).toBe(false);
  });

  it("refuses a suite id or version that is not the pinned tuple", () => {
    expect(evaluateNeutralConformanceDecision(evidence({ suite_version: "9.9.9" })).reason_code).toBe(
      "scenario_suite_version_mismatch"
    );
    expect(evaluateNeutralConformanceDecision(evidence({ suite_id: "other.suite" })).reason_code).toBe(
      "scenario_suite_version_mismatch"
    );
  });

  it("refuses results that are not ordered against the required set", () => {
    const pkg = evidence();
    const shuffled = [pkg.results[1], pkg.results[0], ...pkg.results.slice(2)];
    const outcome = evaluateNeutralConformanceDecision(evidence({ results: shuffled }));
    expect(outcome.reason_code).toBe("scenario_results_unordered");
  });

  it("refuses a result with no receipt reference", () => {
    const outcome = evaluateNeutralConformanceDecision(
      evidence({}, (r) => (r.stable_id === "MHRC-LIF-003" ? { ...r, receipt_ref: "" } : r))
    );
    expect(outcome.reason_code).toBe("scenario_receipt_reference_missing");
    expect(outcome.facts.results_without_receipt_reference).toEqual(["MHRC-LIF-003"]);
  });

  it("refuses a succeeded result that carries a reason code, and a refusal that omits one", () => {
    expect(
      evaluateNeutralConformanceDecision(
        evidence({}, (r) =>
          r.disposition === "succeeded" ? { ...r, reason_code: "gate_unsatisfied" } : r
        )
      ).reason_code
    ).toBe("scenario_evidence_incomplete");
    expect(
      evaluateNeutralConformanceDecision(
        evidence({}, (r) => (r.disposition === "refused" ? { ...r, reason_code: null } : r))
      ).reason_code
    ).toBe("scenario_evidence_incomplete");
  });

  it.each([
    ["host_id", "other-host"],
    ["host_version", "9.9.9"],
    ["runtime_version", "guild-0.0.1"],
    ["release_id", "rel-other"],
  ])("refuses evidence produced by a different %s than the activated runtime", (field, value) => {
    const outcome = evaluateNeutralConformanceDecision(
      evidence({}, (r) =>
        r.stable_id === "MHRC-LIF-001"
          ? { ...r, runtime_binding: { ...ACTIVATED_RUNTIME, [field]: value } }
          : r
      )
    );
    expect(outcome.reason_code).toBe("scenario_runtime_binding_mismatch");
    expect(outcome.facts.misbound_results).toHaveLength(1);
  });

  it("refuses an incomplete activated-runtime binding", () => {
    const outcome = evaluateNeutralConformanceDecision(
      evidence({
        activated_runtime: { ...ACTIVATED_RUNTIME, release_id: "" },
      })
    );
    expect(outcome.reason_code).toBe("scenario_runtime_binding_mismatch");
  });

  it.each(["stale", "unknown"])("refuses %s evidence freshness", (verdict) => {
    const outcome = evaluateNeutralConformanceDecision(
      evidence({}, (r) =>
        r.stable_id === "MHRC-UNS-002"
          ? { ...r, evidence_freshness: verdict as NeutralEvidenceFreshnessVerdict }
          : r
      )
    );
    expect(outcome.disposition).toBe("refused");
    expect(outcome.reason_code).toBe("scenario_evidence_stale");
    expect(outcome.facts.non_fresh_results).toEqual([
      { stable_id: "MHRC-UNS-002", evidence_freshness: verdict },
    ]);
  });

  it("refuses when a required scenario has no result at all", () => {
    const outcome = evaluateNeutralConformanceDecision(
      evidence({ results: evidence().results.slice(0, 4) })
    );
    expect(outcome.disposition).toBe("refused");
    expect(outcome.reason_code).toBe("scenario_evidence_incomplete");
  });

  it("declares the required set itself rather than accepting the caller's", () => {
    expect(NEUTRAL_REQUIRED_CORE_SCENARIO_IDS).toEqual(required);
    expect(NEUTRAL_REQUIRED_CORE_SCENARIO_IDS).toHaveLength(5);
  });
});
