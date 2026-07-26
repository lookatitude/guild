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
  NEUTRAL_RECEIPT_REF_SCHEMA,
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

  // -------------------------------------------------------------------------
  // MH-02-R2-B02 — closure FAILS CLOSED on what the scan cannot resolve
  //
  // The round-2 recognizer recorded a call's argument only when it was a string
  // token and silently dropped every other shape, so five valid-source probes
  // extracted zero specifiers and returned `succeeded`. Closure is a universal
  // claim: an edge whose destination the scanner cannot determine is not "no
  // edge", it is "closure unproven".
  // -------------------------------------------------------------------------

  describe("MH-02-R2-B02 unresolvable edges and lexer ambiguity fail closed", () => {
    function verdictFor(source: string) {
      return evaluateNeutralCoreBoundary(
        NEUTRAL_CORE_MEMBERS.map((member, index) => ({
          path: member,
          source: index === 0 ? source : "",
        }))
      );
    }

    /** The reviewer's four extraction probes, plus near neighbours. */
    it.each([
      ["computed require", 'const builtin = "fs"; require(builtin);'],
      ["computed dynamic import", 'const pkg = "fs"; import(pkg);'],
      ["multiline computed import", "import(\n  name\n);"],
      ["template-hole specifier", "require(`${mod}`);"],
      ["concatenated specifier", 'import("f" + "s");'],
      ["conditional specifier", 'import(cond ? "fs" : "path");'],
      ["zero-argument require", "require();"],
      ["empty-string specifier", 'require("");'],
      ["require aliased as a value", "const r = require; r(\"fs\");"],
      ["require invoked through call()", 'require.call(null, "fs");'],
      ["member-accessed require", 'const p = require.resolve("fs");'],
    ])("refuses a %s as an unresolved edge", (_label, source) => {
      const verdict = verdictFor(source);
      expect(verdict.disposition).toBe("failed");
      expect(verdict.reason_code).toBe("boundary_unresolved_edge");
      expect((verdict.facts.unresolved_edges as unknown[]).length).toBeGreaterThan(0);
    });

    /** The reviewer's optional-call probe: previously invisible entirely. */
    it("recognises an optional require call and classifies its destination", () => {
      expect(extractNeutralImportSpecifiers('require?.("fs")')).toEqual(["fs"]);
      const verdict = verdictFor('require?.("fs")');
      expect(verdict.disposition).toBe("failed");
      expect(verdict.reason_code).toBe("boundary_forbidden_edge");
      expect(
        (verdict.facts.forbidden_edges as Array<{ specifier: string; matcher_id: string }>)[0]
      ).toMatchObject({ specifier: "fs", matcher_id: "node_io_builtin" });
    });

    it("refuses an optional call with a COMPUTED specifier as unresolved", () => {
      const verdict = verdictFor("const m = \"fs\"; require?.(m);");
      expect(verdict.reason_code).toBe("boundary_unresolved_edge");
    });

    /**
     * The reviewer's lexer probe. `x++ / require("fs") / y` is valid code and
     * plain division; round 2 read the `/` as a regex start and swallowed the
     * whole call. The `/` is now division, so the call is visible again — AND
     * the undecidable position is recorded, because a parser-free lexer cannot
     * prove which reading was intended.
     */
    it.each([
      ["postfix increment", 'const v = x++ / require("fs") / y;'],
      ["postfix decrement", 'const v = x-- / require("fs") / y;'],
    ])("does not let a %s hide a require call", (_label, source) => {
      expect(extractNeutralImportSpecifiers(source)).toEqual(["fs"]);
      const verdict = verdictFor(source);
      expect(verdict.disposition).toBe("failed");
      expect(verdict.reason_code).toBe("boundary_forbidden_edge");
      expect((verdict.facts.source_ambiguities as unknown[]).length).toBeGreaterThan(0);
    });

    it("reports an ambiguous slash that would have swallowed an import", () => {
      // After `)` the reading is genuinely undecidable. Both readings are kept
      // honest: division keeps the statement scannable, and the ambiguity is
      // recorded because the discarded reading spans a dependency word.
      const verdict = verdictFor('const v = f(a) / import("./x") / b;');
      expect(verdict.disposition).toBe("failed");
      expect(
        (verdict.facts.source_ambiguities as Array<{ kind: string }>).every(
          (entry) => entry.kind === "regex_or_division"
        )
      ).toBe(true);
    });

    it("stays SILENT on an ambiguous slash that could not have hidden an edge", () => {
      // Ordinary arithmetic after a call or a block is ambiguous too, but both
      // readings agree there is no edge, so failing there would be noise.
      for (const source of [
        "const r = f(a) / 2;",
        "const q = compute() / total() / 3;",
        "function g() {} const z = w / 4;",
        "const n = counter++ / limit;",
      ]) {
        const verdict = verdictFor(source);
        expect([source, verdict.disposition]).toEqual([source, "succeeded"]);
        expect([source, verdict.facts.source_ambiguities]).toEqual([source, []]);
      }
    });

    it("keeps import.meta out of the edge set", () => {
      const verdict = verdictFor("const here = import.meta.url;");
      expect(verdict.disposition).toBe("succeeded");
      expect(verdict.facts.unresolved_edges).toEqual([]);
    });

    it("still resolves every ordinary form, so the tightening is not a blanket refusal", () => {
      const verdict = verdictFor(
        [
          'import a from "./neutral-runtime-contracts";',
          'export * from "./neutral-gate-policy";',
          'const c = await import("./neutral-conformance-core");',
          'const d = require("./neutral-core-boundary");',
          "const e = require(`./neutral-runtime-contracts`);",
        ].join("\n")
      );
      expect(verdict.disposition).toBe("succeeded");
      expect(verdict.reason_code).toBeNull();
      expect(verdict.facts.unresolved_edges).toEqual([]);
      expect(verdict.facts.source_ambiguities).toEqual([]);
    });

    it("counts unresolved edges in edge_count so the fact set stays honest", () => {
      const verdict = verdictFor('const m = "fs"; require(m);');
      expect(verdict.facts.edge_count).toBe(1);
      expect((verdict.facts.unresolved_edges as Array<{ form: string }>)[0].form).toBe("require()");
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
// MH-02-R2-B04 — the MH-02 surface is reproducible in plugin CI
//
// Round 2 pinned the contract assertions to an absolute umbrella worktree. The
// plugin test workflow checks out ONLY the plugin repository and then runs the
// whole `scripts` Jest project, so the suite that gated MH-02 could not execute
// on a clean clone or a runner — it passed solely because that private path
// happened to exist on the review machine.
//
// Removing the path once would be a fix that silently rots. This guard makes it
// an INVARIANT: the MH-02 surface may not name a machine-local root or any
// sibling repository, in tests or in source. Cross-repository equality is still
// required — it is verified at the umbrella/run level, where both repositories
// are present, and recorded in the MH-02 handoff receipt.
// ---------------------------------------------------------------------------

describe("MH-02-R2-B04 the MH-02 surface is hermetic to the plugin repository", () => {
  const TESTS_DIR = path.resolve(__dirname);
  const MH02_TEST_FILES = [
    "neutral-runtime-contracts.test.ts",
    "neutral-lifecycle-machine.test.ts",
    "neutral-conformance-core.test.ts",
  ];

  /**
   * Assembled from fragments on purpose. Writing any of these roots as one
   * contiguous literal — in the array, in a comment, anywhere in this file —
   * would be found by the very scan below, and the guard would trip on itself.
   * Interpolation keeps the matcher expressive without making the file a match.
   */
  const MACHINE_LOCAL_ROOTS = [
    `/${"Users"}/`,
    `/${"home"}/`,
    `/private/${"var"}/`,
    `.guild/${"worktrees"}`,
    `${"Projects"}/guild/`,
  ];
  const SIBLING_REPOSITORIES = [
    `worktrees/${"guild"}`,
    `codex-mh-02-${"contract"}`,
    `codex-review-mh-02-${"contract"}`,
    `codex-mh-w0-${"lead"}`,
  ];

  function surfaceSources(): Array<{ label: string; source: string }> {
    return [
      ...MH02_TEST_FILES.map((file) => ({
        label: `__tests__/${file}`,
        source: fs.readFileSync(path.join(TESTS_DIR, file), "utf8"),
      })),
      ...NEUTRAL_CORE_MEMBERS.map((member) => ({
        label: `workflows/${member}`,
        source: fs.readFileSync(path.join(CORE_DIR, member), "utf8"),
      })),
    ];
  }

  it("names no machine-local filesystem root anywhere in the MH-02 surface", () => {
    const offenders: string[] = [];
    for (const { label, source } of surfaceSources()) {
      for (const root of MACHINE_LOCAL_ROOTS) {
        if (source.indexOf(root) !== -1) offenders.push(`${label} -> ${root}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("names no sibling repository, so nothing can become a cross-repo import", () => {
    const offenders: string[] = [];
    for (const { label, source } of surfaceSources()) {
      for (const needle of SIBLING_REPOSITORIES) {
        if (source.indexOf(needle) !== -1) offenders.push(`${label} -> ${needle}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("reads only paths derived from this checkout", () => {
    // Both filesystem roots this suite uses resolve from __dirname, so the
    // suite relocates with the repository instead of pointing outside it.
    for (const root of [TESTS_DIR, CORE_DIR]) {
      expect(path.isAbsolute(root)).toBe(true);
      expect(root.startsWith(path.resolve(__dirname, "..", ".."))).toBe(true);
    }
  });

  it("proves the guard actually bites", () => {
    // A guard that cannot fail is not a guard. Same matcher, seeded input.
    const seeded = `const CONTRACT_DIR = "/${"Users"}/someone/.guild/${"worktrees"}/guild/x";`;
    const caught = MACHINE_LOCAL_ROOTS.filter((root) => seeded.indexOf(root) !== -1);
    expect(caught.length).toBeGreaterThan(0);
  });

  it("keeps the reconciled vocabulary declared natively rather than read as data", () => {
    const source = fs.readFileSync(
      path.join(CORE_DIR, "neutral-runtime-contracts.ts"),
      "utf8"
    );
    // The core declares the shared block itself and imports nothing to get it.
    expect(source).toContain("NEUTRAL_NORMALIZED_EVENT_VOCABULARY");
    expect(source).toContain("guild.normalized_event.v2");
    expect(extractNeutralImportSpecifiers(source)).toEqual([]);
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
            // The canonical receipt-reference form: a schema marker, a journal
            // id, and a per-scenario sequence. MH-02-R2-B03 established that
            // "any non-empty string" was not a reference at all.
            receipt_ref: `${NEUTRAL_RECEIPT_REF_SCHEMA}:jrn-run-1#${index + 1}`,
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
    // The offending value is reported verbatim, so a reader can see WHAT was
    // cited rather than only that something was wrong.
    expect(outcome.facts.results_without_receipt_reference).toEqual([
      { stable_id: "MHRC-LIF-003", receipt_ref: "" },
    ]);
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

  // -------------------------------------------------------------------------
  // MH-02-R2-B03 — the suite is not the claimant's to choose, and nominal
  // metadata is not evidence
  //
  // Round 2 still took a caller-supplied `scenarios` array (defaulted to the
  // core's, so it read as harmless) and derived the required set FROM IT. A
  // caller passing one scenario got a one-scenario suite and promoted
  // `conformant`. Six further probes promoted on forged nominal metadata.
  // -------------------------------------------------------------------------

  describe("MH-02-R2-B03 promotion is neither caller-selectable nor nominally forgeable", () => {
    /** The reviewer's exact probe: a suite of one, chosen by the claimant. */
    it("refuses a caller-selected one-scenario suite", () => {
      const only = NEUTRAL_CORE_SCENARIOS[0];
      const outcome = evaluateNeutralConformanceDecision({
        suite_id: NEUTRAL_SCENARIO_SUITE_ID,
        suite_version: NEUTRAL_SCENARIO_SUITE_VERSION,
        required_scenario_ids: [only.stable_id],
        activated_runtime: ACTIVATED_RUNTIME,
        results: [evidence().results[0]],
      });
      expect(outcome.disposition).toBe("refused");
      expect(outcome.reason_code).toBe("scenario_required_set_mismatch");
      expect(outcome.facts.may_promote_conformant).toBe(false);
      expect(outcome.facts.omitted_required_scenarios).toEqual(required.slice(1));
    });

    /**
     * The structural half of the same finding: there is no scenario parameter
     * left to pass. A caller handing one over cannot change the verdict.
     */
    it("takes no scenario-set parameter at all", () => {
      expect(evaluateNeutralConformanceDecision).toHaveLength(1);
      const smuggled = (
        evaluateNeutralConformanceDecision as unknown as (
          e: NeutralConformanceEvidence,
          s?: unknown
        ) => ReturnType<typeof evaluateNeutralConformanceDecision>
      )(evidence(), [NEUTRAL_CORE_SCENARIOS[0]]);
      // The smuggled one-scenario suite is ignored; the core tuple still rules.
      expect(smuggled.disposition).toBe("succeeded");
      expect(smuggled.facts.may_promote_conformant).toBe(true);
    });

    it("refuses a required tuple that is the right SET in the wrong ORDER", () => {
      const reversedIds = [...required].reverse();
      const reversedResults = [...evidence().results].reverse();
      const outcome = evaluateNeutralConformanceDecision(
        evidence({ required_scenario_ids: reversedIds, results: reversedResults })
      );
      expect(outcome.disposition).toBe("refused");
      expect(outcome.reason_code).toBe("scenario_required_set_mismatch");
      expect(outcome.facts.tuple_misordered).toBe(true);
    });

    it("refuses a caller-INFLATED required tuple that still contains the core set", () => {
      const outcome = evaluateNeutralConformanceDecision(
        evidence({
          required_scenario_ids: [...required, "MHRC-RCT-001"],
          results: [
            ...evidence().results,
            { ...evidence().results[0], stable_id: "MHRC-RCT-001" },
          ],
        })
      );
      expect(outcome.reason_code).toBe("scenario_required_set_mismatch");
      expect(outcome.facts.undeclared_scenarios).toEqual(["MHRC-RCT-001"]);
    });

    /** A closed-but-wrong outcome type is evidence of a different experiment. */
    it("fails a result whose outcome TYPE is not the scenario's expected type", () => {
      const outcome = evaluateNeutralConformanceDecision(
        evidence({}, (r) => ({ ...r, outcome_type: "guild.migration_outcome.v1" }))
      );
      expect(outcome.disposition).toBe("failed");
      expect(outcome.reason_code).toBe("scenario_result_mismatch");
      expect(outcome.facts.may_promote_conformant).toBe(false);
      expect(outcome.facts.mistyped_scenarios).toHaveLength(5);
      expect((outcome.facts.mistyped_scenarios as Array<Record<string, unknown>>)[0]).toEqual({
        stable_id: "MHRC-LIF-001",
        expected_outcome_type: "guild.lifecycle_outcome.v1",
        observed_outcome_type: "guild.migration_outcome.v1",
      });
    });

    it("keeps MHRC-UNS-002's policy outcome type distinct from the lifecycle ones", () => {
      // The scenario that legitimately expects guild.policy_outcome.v1 must not
      // be satisfiable by a lifecycle outcome, or the type check would be
      // uniform rather than per-scenario.
      const outcome = evaluateNeutralConformanceDecision(
        evidence({}, (r) =>
          r.stable_id === "MHRC-UNS-002"
            ? { ...r, outcome_type: "guild.lifecycle_outcome.v1" }
            : r
        )
      );
      expect(outcome.reason_code).toBe("scenario_result_mismatch");
      expect(outcome.facts.mistyped_scenarios).toHaveLength(1);
    });

    it("refuses an invented reason code on a non-succeeded result", () => {
      const outcome = evaluateNeutralConformanceDecision(
        evidence({}, (r) =>
          r.disposition === "succeeded" ? r : { ...r, reason_code: "invented_reason" }
        )
      );
      expect(outcome.disposition).toBe("refused");
      expect(outcome.reason_code).toBe("scenario_reason_code_unrecognized");
      expect(outcome.facts.unrecognized_reason_codes).toEqual([
        { stable_id: "MHRC-LIF-002", reason_code: "invented_reason" },
        { stable_id: "MHRC-UNS-002", reason_code: "invented_reason" },
      ]);
    });

    it.each([
      ["a word", "bogus"],
      ["a bare id", "receipt-1"],
      ["the schema alone", NEUTRAL_RECEIPT_REF_SCHEMA],
      ["a missing sequence", `${NEUTRAL_RECEIPT_REF_SCHEMA}:jrn-run-1`],
      ["a non-numeric sequence", `${NEUTRAL_RECEIPT_REF_SCHEMA}:jrn-run-1#later`],
      ["a non-canonical sequence", `${NEUTRAL_RECEIPT_REF_SCHEMA}:jrn-run-1#007`],
      ["a foreign schema", "other.receipt_ref.v1:jrn-run-1#1"],
    ])("refuses %s as a receipt reference", (_label, ref) => {
      const outcome = evaluateNeutralConformanceDecision(
        evidence({}, (r) => ({ ...r, receipt_ref: ref }))
      );
      expect(outcome.disposition).toBe("refused");
      expect(outcome.reason_code).toBe("scenario_receipt_reference_missing");
      expect(outcome.facts.may_promote_conformant).toBe(false);
    });

    it("refuses one receipt entry cited by two scenarios", () => {
      const outcome = evaluateNeutralConformanceDecision(
        evidence({}, (r) => ({ ...r, receipt_ref: `${NEUTRAL_RECEIPT_REF_SCHEMA}:jrn-run-1#7` }))
      );
      expect(outcome.disposition).toBe("refused");
      expect(outcome.reason_code).toBe("scenario_receipt_reference_ambiguous");
      expect(outcome.facts.duplicate_receipt_references).toHaveLength(4);
    });

    it.each([
      ["an unrecognized major", 999],
      ["a zero", 0],
      ["a string", "1" as unknown as number],
    ])("refuses %s as the contract version", (_label, version) => {
      const bad = { ...ACTIVATED_RUNTIME, contract_version: version as number };
      const outcome = evaluateNeutralConformanceDecision(
        evidence({ activated_runtime: bad }, (r) => ({ ...r, runtime_binding: bad }))
      );
      expect(outcome.disposition).toBe("refused");
      expect(outcome.reason_code).toBe("scenario_contract_version_unrecognized");
      expect(outcome.facts.recognized_contract_version).toBe(1);
    });

    it("refuses a contract version that drifts on ONE result only", () => {
      const outcome = evaluateNeutralConformanceDecision(
        evidence({}, (r) =>
          r.stable_id === "MHRC-LIF-004"
            ? { ...r, runtime_binding: { ...ACTIVATED_RUNTIME, contract_version: 2 } }
            : r
        )
      );
      expect(outcome.reason_code).toBe("scenario_contract_version_unrecognized");
      expect(outcome.facts.unrecognized_contract_versions).toEqual([
        { scope: "MHRC-LIF-004", contract_version: 2 },
      ]);
    });

    it.each([
      ["free text", "totally-unknown-runtime"],
      ["a bare semver", "2.2.0"],
      ["a foreign product", "codex-2.2.0"],
      ["an empty string", ""],
    ])("refuses %s as a runtime version", (_label, version) => {
      const bad = { ...ACTIVATED_RUNTIME, runtime_version: version };
      const outcome = evaluateNeutralConformanceDecision(
        evidence({ activated_runtime: bad }, (r) => ({ ...r, runtime_binding: bad }))
      );
      expect(outcome.disposition).toBe("refused");
      expect(outcome.reason_code).toBe("scenario_runtime_version_unrecognized");
    });

    it("accepts a recognized runtime identity with a pre-release tail", () => {
      const ok = { ...ACTIVATED_RUNTIME, runtime_version: "guild-2.3.0-beta.1" };
      const outcome = evaluateNeutralConformanceDecision(
        evidence({ activated_runtime: ok }, (r) => ({ ...r, runtime_binding: ok }))
      );
      expect(outcome.disposition).toBe("succeeded");
      expect(outcome.facts.may_promote_conformant).toBe(true);
    });

    /**
     * The whole point of the tightening is that HONEST evidence still promotes.
     * If every package refused, the gate would prove nothing either.
     */
    it("still promotes a complete, ordered, receipt-bound, exactly-versioned package", () => {
      const outcome = evaluateNeutralConformanceDecision(evidence());
      expect(outcome.disposition).toBe("succeeded");
      expect(outcome.reason_code).toBeNull();
      expect(outcome.facts.may_promote_conformant).toBe(true);
      expect(outcome.facts.evaluated_scenarios).toHaveLength(5);
    });
  });
});
