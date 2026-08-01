/**
 * scripts/__tests__/project-capability-profile.test.ts
 *
 * Conformance for `guild.project_capability_profile.v1` (spec S1, decisions
 * cap-loc-D01/D04). Assertion ids map to the wave-5 conformance matrix §S1.
 *
 * The load-bearing ones:
 *   A1.1  budget ceiling — over-budget is INVALID, never truncated
 *   A1.2  no evidence, no candidate
 *   A1.3  low confidence may not `propose`
 *   A1.4  occurrence_count === evidence_refs.length, dedup-proof
 *   A1.5  `mutation_performed` is the literal `false`
 *   A1.6  every before/after tree-hash pair must be EQUAL
 *   A1.8  coverage is hash-bound, not a bare name
 *   A1.11 a recurrence claim must cite history
 *
 * NOT HERE (integration-owned; their absence is deliberate and documented in the
 * module header): A1.7 real-Learn no-mutation, A1.9 absent-feedstock recording,
 * A1.10 evidence-ref RESOLUTION.
 */

import * as fs from "fs";
import * as path from "path";

import {
  PROJECT_CAPABILITY_PROFILE_SCHEMA,
  DEFAULT_SUGGESTION_BUDGET,
  RESOLVER_MODES,
  CONFIDENCE_GRADES,
  CANDIDATE_ACTIONS,
  EVIDENCE_SOURCES,
  HISTORICAL_EVIDENCE_SOURCES,
  isTreeHash,
  isFeedstockHash,
  parseEvidenceRef,
  isCanonicalLocator,
  isEvidenceRef,
  validateMutationEvidence,
  validateProjectCapabilityProfileV1,
  isProjectCapabilityProfileV1,
  type ProjectCapabilityProfileV1,
} from "../lib/core/contracts/project-capability-profile";

import { PROJECT_DEFINITION_REF_SCHEMA } from "../lib/core/contracts/project-definition-ref";

// ── Fixtures ─────────────────────────────────────────────────────────────────

const TREE_A = "a".repeat(64);
const TREE_B = "b".repeat(64);
const TREE_C = "c".repeat(64);
const BYTE_HASH = `sha256:${"e".repeat(64)}`;
const IDENT_P = "1".repeat(64);
const IDENT_T = "2".repeat(64);

const coveringRef = () => ({
  schema_version: PROJECT_DEFINITION_REF_SCHEMA,
  project_id: "plugin",
  kind: "agent" as const,
  id: "plugin-runtime-architect",
  relative_path: ".guild/agents/plugin-runtime-architect.md",
  content_hash: BYTE_HASH,
  source_commit: null,
  specialist_profile_hash: IDENT_P,
  specialist_type_hash: IDENT_T,
  skills: [],
});

function profile(over: Partial<ProjectCapabilityProfileV1> = {}): any {
  return {
    schema_version: PROJECT_CAPABILITY_PROFILE_SCHEMA,
    project_id: "plugin",
    run_id: "run-20260801-050000-learn",
    generated_at: "2026-08-01T05:00:00Z",
    source_commit: null,
    feedstock: {
      codebase_map_hash: TREE_A,
      knowledge_graph_hash: null,
      roster_hash: TREE_B,
      absent: ["knowledge_graph"],
    },
    domains: [
      {
        id: "domain/dispatch",
        label: "Dispatch",
        evidence_refs: ["knowledge_graph:node/domain/dispatch"],
        confidence: "high",
      },
    ],
    boundaries: [
      {
        id: "boundary/host",
        label: "Host boundary",
        rationale: "Adapters own discovery; the core owns policy.",
        evidence_refs: ["codebase_map:src/modules/host-runtime/index.ts#12"],
        confidence: "medium",
      },
    ],
    repeated_methods: [
      {
        id: "method/adversarial-review",
        label: "Adversarial review before close",
        occurrence_count: 2,
        evidence_refs: ["run:run-20260726-000000-a", "reflection:.guild/reflections/r-b.md"],
        confidence: "high",
      },
    ],
    coverage: {
      covered: [{ fact_id: "domain/dispatch", covered_by: coveringRef() }],
      uncovered: ["boundary/host"],
      unmatched_roles: ["legacy-role"],
    },
    candidates: [
      {
        id: "cand/1",
        kind: "skill",
        proposed_id: "adversarial-close-review",
        justified_by: ["method/adversarial-review"],
        action: "propose",
        defer_reason: null,
        confidence: "high",
        owning_layer: "plugin",
      },
    ],
    resolver_mode: "observe",
    mutation_performed: false,
    mutation_evidence: {
      agents_tree_hash_before: TREE_A,
      agents_tree_hash_after: TREE_A,
      skills_tree_hash_before: TREE_B,
      skills_tree_hash_after: TREE_B,
      registry_hash_before: TREE_C,
      registry_hash_after: TREE_C,
    },
    ...over,
  };
}

const ok = (o: any, opts?: any) => validateProjectCapabilityProfileV1(o, opts);

// ── Baseline ─────────────────────────────────────────────────────────────────

describe("guild.project_capability_profile.v1 — baseline", () => {
  test("the reference fixture validates", () => {
    const v = ok(profile());
    expect(v).not.toBeNull();
    expect(v!.schema_version).toBe(PROJECT_CAPABILITY_PROFILE_SCHEMA);
    expect(v!.mutation_performed).toBe(false);
  });

  test("returns a FRESH object — mutating the input cannot reach the result", () => {
    const input = profile();
    const v = ok(input)!;
    input.candidates[0].proposed_id = "mutated-after-validation";
    input.domains[0].id = "mutated";
    expect(v.candidates[0].proposed_id).toBe("adversarial-close-review");
    expect(v.domains[0].id).toBe("domain/dispatch");
  });

  test("the shape is CLOSED — an extra key is rejected, not ignored", () => {
    expect(ok({ ...profile(), extra: 1 })).toBeNull();
  });

  test("a missing key is rejected", () => {
    const p = profile();
    delete p.resolver_mode;
    expect(ok(p)).toBeNull();
  });

  test("a symbol key is rejected", () => {
    const p = profile();
    (p as any)[Symbol("x")] = 1;
    expect(ok(p)).toBeNull();
  });

  test("an accessor field is rejected — a getter is never fired", () => {
    const p = profile();
    let fired = false;
    Object.defineProperty(p, "project_id", {
      get() {
        fired = true;
        return "plugin";
      },
      enumerable: true,
      configurable: true,
    });
    expect(ok(p)).toBeNull();
    expect(fired).toBe(false);
  });

  test("a Proxy is rejected outright", () => {
    const p = new Proxy(profile(), {});
    expect(ok(p)).toBeNull();
  });

  test("the validator NEVER throws, whatever it is handed", () => {
    const nasty: unknown[] = [
      null,
      undefined,
      0,
      "",
      [],
      Object.create(null),
      new Map(),
      Symbol("s"),
      () => undefined,
    ];
    for (const v of nasty) expect(() => validateProjectCapabilityProfileV1(v)).not.toThrow();
    for (const v of nasty) expect(validateProjectCapabilityProfileV1(v)).toBeNull();
  });

  test("isProjectCapabilityProfileV1 agrees with the validator and does not narrow", () => {
    expect(isProjectCapabilityProfileV1(profile())).toBe(true);
    expect(isProjectCapabilityProfileV1({})).toBe(false);
  });
});

// ── A1.5 / A1.6 — the no-mutation guarantee ──────────────────────────────────

describe("A1.5 — mutation_performed is the literal false", () => {
  test.each([[true], [1], [0], ["false"], [null], [undefined], [""]])(
    "%p is rejected",
    (value) => {
      expect(ok(profile({ mutation_performed: value as any }))).toBeNull();
    }
  );

  test("the literal false is accepted", () => {
    expect(ok(profile({ mutation_performed: false }))).not.toBeNull();
  });

  test("truthiness is never used — 0 and '' are rejected like true is", () => {
    // If the check were `if (v)` rather than `v !== false`, 0 and "" would pass.
    expect(ok(profile({ mutation_performed: 0 as any }))).toBeNull();
    expect(ok(profile({ mutation_performed: "" as any }))).toBeNull();
  });
});

describe("A1.6 — mutation_evidence before/after pairs must be equal", () => {
  test("a differing AGENTS tree hash is rejected", () => {
    const p = profile();
    p.mutation_evidence.agents_tree_hash_after = TREE_C;
    expect(ok(p)).toBeNull();
  });

  test("a differing SKILLS tree hash is rejected", () => {
    const p = profile();
    p.mutation_evidence.skills_tree_hash_after = TREE_C;
    expect(ok(p)).toBeNull();
  });

  test("a differing REGISTRY hash is rejected", () => {
    const p = profile();
    p.mutation_evidence.registry_hash_after = TREE_A;
    expect(ok(p)).toBeNull();
  });

  test("all three pairs equal is accepted", () => {
    expect(ok(profile())).not.toBeNull();
  });

  test("validateMutationEvidence enforces the same rule standalone", () => {
    const good = {
      agents_tree_hash_before: TREE_A,
      agents_tree_hash_after: TREE_A,
      skills_tree_hash_before: TREE_B,
      skills_tree_hash_after: TREE_B,
      registry_hash_before: TREE_C,
      registry_hash_after: TREE_C,
    };
    expect(validateMutationEvidence(good)).not.toBeNull();
    expect(validateMutationEvidence({ ...good, agents_tree_hash_after: TREE_B })).toBeNull();
  });

  test("a non-hash tree value is rejected", () => {
    const p = profile();
    p.mutation_evidence.agents_tree_hash_before = "not-a-hash";
    p.mutation_evidence.agents_tree_hash_after = "not-a-hash";
    expect(ok(p)).toBeNull();
  });

  test("isTreeHash requires bare 64 lowercase hex", () => {
    expect(isTreeHash(TREE_A)).toBe(true);
    expect(isTreeHash(`sha256:${TREE_A}`)).toBe(false);
    expect(isTreeHash("A".repeat(64))).toBe(false);
    expect(isTreeHash("a".repeat(63))).toBe(false);
  });
});

// ── A1.1 — the budget ceiling ────────────────────────────────────────────────

describe("A1.1 — candidates.length <= suggestion_budget", () => {
  const candidate = (n: number) => ({
    id: `cand/${n}`,
    kind: "skill",
    proposed_id: `skill-${n}`,
    justified_by: ["method/adversarial-review"],
    action: "propose",
    defer_reason: null,
    confidence: "high",
    owning_layer: "plugin",
  });

  test("D04's default budget is 4", () => {
    expect(DEFAULT_SUGGESTION_BUDGET).toBe(4);
  });

  test("exactly the budget is accepted", () => {
    const p = profile({ candidates: [1, 2, 3, 4].map(candidate) as any });
    expect(ok(p)).not.toBeNull();
  });

  test("one over the budget is INVALID — not truncated", () => {
    const p = profile({ candidates: [1, 2, 3, 4, 5].map(candidate) as any });
    const v = ok(p);
    expect(v).toBeNull(); // the whole profile is rejected...
    // ...and emphatically NOT silently reduced to 4:
    expect(v).not.toEqual(expect.objectContaining({ candidates: expect.any(Array) }));
  });

  test("an explicit budget overrides the default in both directions", () => {
    const two = profile({ candidates: [1, 2].map(candidate) as any });
    expect(ok(two, { suggestionBudget: 2 })).not.toBeNull();
    expect(ok(two, { suggestionBudget: 1 })).toBeNull();
  });

  test("a nonsense budget fails closed", () => {
    expect(ok(profile(), { suggestionBudget: -1 })).toBeNull();
    expect(ok(profile(), { suggestionBudget: 1.5 })).toBeNull();
  });

  test("budget 0 rejects any candidate but accepts an empty list", () => {
    expect(ok(profile({ candidates: [] }), { suggestionBudget: 0 })).not.toBeNull();
    expect(ok(profile(), { suggestionBudget: 0 })).toBeNull();
  });
});

// ── A1.2 / A1.3 — candidate honesty ──────────────────────────────────────────

describe("A1.2 — no evidence, no candidate", () => {
  test("empty justified_by is rejected", () => {
    const p = profile();
    p.candidates[0].justified_by = [];
    expect(ok(p)).toBeNull();
  });

  test("a candidate citing a fact id the profile does not declare is rejected", () => {
    const p = profile();
    p.candidates[0].justified_by = ["method/never-declared"];
    expect(ok(p)).toBeNull();
  });

  test("duplicate justification entries are rejected", () => {
    const p = profile();
    p.candidates[0].justified_by = ["method/adversarial-review", "method/adversarial-review"];
    expect(ok(p)).toBeNull();
  });
});

describe("A1.3 — low confidence may not propose", () => {
  test("low + propose is rejected", () => {
    const p = profile();
    p.candidates[0].confidence = "low";
    expect(ok(p)).toBeNull();
  });

  test.each([["observe"], ["defer"]])("low + %s is accepted with a reason", (action) => {
    const p = profile();
    p.candidates[0].confidence = "low";
    p.candidates[0].action = action;
    p.candidates[0].defer_reason = "sparse evidence; one occurrence only";
    expect(ok(p)).not.toBeNull();
  });

  test("a non-propose action without a defer_reason is rejected", () => {
    const p = profile();
    p.candidates[0].action = "defer";
    p.candidates[0].defer_reason = null;
    expect(ok(p)).toBeNull();
  });

  test("a propose action carrying a defer_reason is rejected as contradictory", () => {
    const p = profile();
    p.candidates[0].defer_reason = "but also deferred?";
    expect(ok(p)).toBeNull();
  });

  test("high/medium confidence may propose", () => {
    for (const c of ["high", "medium"]) {
      const p = profile();
      p.candidates[0].confidence = c;
      expect(ok(p)).not.toBeNull();
    }
  });
});

// ── A1.4 / A1.11 — method facts cite history, and counts match ───────────────

describe("A1.4 — occurrence_count must equal evidence_refs.length", () => {
  test("count 3 with 2 refs is rejected", () => {
    const p = profile();
    p.repeated_methods[0].occurrence_count = 3;
    expect(ok(p)).toBeNull();
  });

  test("count 1 with 2 refs is rejected", () => {
    const p = profile();
    p.repeated_methods[0].occurrence_count = 1;
    expect(ok(p)).toBeNull();
  });

  test("a DOUBLED citation cannot inflate the count — dedup rejects it", () => {
    const p = profile();
    p.repeated_methods[0].occurrence_count = 2;
    p.repeated_methods[0].evidence_refs = ["run:run-a", "run:run-a"];
    expect(ok(p)).toBeNull();
  });

  test("occurrence_count below 1 is rejected", () => {
    const p = profile();
    p.repeated_methods[0].occurrence_count = 0;
    p.repeated_methods[0].evidence_refs = [];
    expect(ok(p)).toBeNull();
  });
});

describe("A1.11 — a recurrence claim must cite history", () => {
  test.each([["codebase_map:src/a.ts"], ["knowledge_graph:node/x"], ["roster:some-role"]])(
    "%s backing a MethodFact is rejected",
    (ref) => {
      const p = profile();
      p.repeated_methods[0].occurrence_count = 1;
      p.repeated_methods[0].evidence_refs = [ref];
      expect(ok(p)).toBeNull();
    }
  );

  test.each([["run:run-a"], ["reflection:.guild/reflections/x.md"]])(
    "%s backing a MethodFact is accepted",
    (ref) => {
      const p = profile();
      p.repeated_methods[0].occurrence_count = 1;
      p.repeated_methods[0].evidence_refs = [ref];
      expect(ok(p)).not.toBeNull();
    }
  );

  test("the historical subset is exactly {run, reflection}", () => {
    expect([...HISTORICAL_EVIDENCE_SOURCES].sort()).toEqual(["reflection", "run"]);
  });

  test("non-method facts may cite ANY source", () => {
    const p = profile();
    p.domains[0].evidence_refs = ["codebase_map:src/a.ts"];
    expect(ok(p)).not.toBeNull();
  });
});

// ── A1.8 — coverage is hash-bound ────────────────────────────────────────────

describe("A1.8 — coverage references are hash-bound, never bare names", () => {
  test("a bare role-name string in covered_by is rejected", () => {
    const p = profile();
    p.coverage.covered[0].covered_by = "plugin-runtime-architect";
    expect(ok(p)).toBeNull();
  });

  test("a ref missing its content_hash is rejected", () => {
    const p = profile();
    delete p.coverage.covered[0].covered_by.content_hash;
    expect(ok(p)).toBeNull();
  });

  test("a ref with an ABSOLUTE path is rejected — S2's R10 guard still applies here", () => {
    const p = profile();
    p.coverage.covered[0].covered_by.relative_path = "/abs/agents/x.md";
    expect(ok(p)).toBeNull();
  });

  test("covering a fact the profile never declared is rejected", () => {
    const p = profile();
    p.coverage.covered[0].fact_id = "domain/never-declared";
    expect(ok(p)).toBeNull();
  });

  test("a fact cannot be both covered and uncovered", () => {
    const p = profile();
    p.coverage.uncovered = ["domain/dispatch"];
    expect(ok(p)).toBeNull();
  });

  test("two covering entries for one fact are rejected as ambiguous", () => {
    const p = profile();
    p.coverage.covered.push({ fact_id: "domain/dispatch", covered_by: coveringRef() });
    expect(ok(p)).toBeNull();
  });
});

// ── Evidence-ref shape ───────────────────────────────────────────────────────

describe("evidence-ref parsing (shape only — resolution is A1.10)", () => {
  test("parses source, locator, and optional anchor", () => {
    expect(parseEvidenceRef("run:run-a")).toEqual({
      source: "run",
      locator: "run-a",
      anchor: null,
    });
    expect(parseEvidenceRef("codebase_map:src/a.ts#74")).toEqual({
      source: "codebase_map",
      locator: "src/a.ts",
      anchor: "74",
    });
  });

  test("the FIRST colon splits, so a locator may contain colons", () => {
    const parsed = parseEvidenceRef("knowledge_graph:node:with:colons");
    expect(parsed).toEqual({ source: "knowledge_graph", locator: "node:with:colons", anchor: null });
  });

  test("the LAST hash splits, so a locator may contain a hash", () => {
    const parsed = parseEvidenceRef("codebase_map:a#b.ts#12");
    expect(parsed).toEqual({ source: "codebase_map", locator: "a#b.ts", anchor: "12" });
  });

  test("the source vocabulary is CLOSED", () => {
    expect(parseEvidenceRef("invented_source:x")).toBeNull();
    for (const s of EVIDENCE_SOURCES) expect(parseEvidenceRef(`${s}:x`)).not.toBeNull();
  });

  test.each([
    ["no colon at all", "runrun-a"],
    ["empty source", ":locator"],
    ["empty locator", "run:"],
    ["trailing hash with no anchor", "run:run-a#"],
    ["empty string", ""],
    ["NUL byte", "run:run\u0000a"],
    ["newline", "run:run\na"],
    ["tab", "run:run\ta"],
  ])("%s is rejected", (_label, ref) => {
    expect(parseEvidenceRef(ref)).toBeNull();
    expect(isEvidenceRef(ref)).toBe(false);
  });

  test("a fact with an empty evidence_refs array is rejected — facts always cite", () => {
    const p = profile();
    p.domains[0].evidence_refs = [];
    expect(ok(p)).toBeNull();
  });

  test("a malformed ref anywhere sinks the profile", () => {
    const p = profile();
    p.boundaries[0].evidence_refs = ["not a ref"];
    expect(ok(p)).toBeNull();
  });
});

// ── Feedstock ────────────────────────────────────────────────────────────────

describe("feedstock binding", () => {
  test("an absent input is recorded as an explicit null plus an `absent` entry", () => {
    const v = ok(profile())!;
    expect(v.feedstock.knowledge_graph_hash).toBeNull();
    expect(v.feedstock.absent).toContain("knowledge_graph");
  });

  test("undefined is NOT accepted for a hash — absence must be stated", () => {
    const p = profile();
    p.feedstock.knowledge_graph_hash = undefined;
    expect(ok(p)).toBeNull();
  });

  test("both bare and sha256-prefixed feedstock hashes are accepted", () => {
    expect(isFeedstockHash(TREE_A)).toBe(true);
    expect(isFeedstockHash(`sha256:${TREE_A}`)).toBe(true);
    expect(isFeedstockHash("nope")).toBe(false);
  });
});

// ── Enum + array hardening ───────────────────────────────────────────────────

describe("closed vocabularies and array hardening", () => {
  test("resolver_mode is closed and recorded", () => {
    for (const m of RESOLVER_MODES) expect(ok(profile({ resolver_mode: m }))).not.toBeNull();
    expect(ok(profile({ resolver_mode: "made-up" as any }))).toBeNull();
    expect(ok(profile({ resolver_mode: "observe" }))!.resolver_mode).toBe("observe");
  });

  test("confidence and action vocabularies are closed", () => {
    expect(CONFIDENCE_GRADES).toEqual(["high", "medium", "low"]);
    expect(CANDIDATE_ACTIONS).toEqual(["propose", "observe", "defer"]);
    const p = profile();
    p.domains[0].confidence = "very-high";
    expect(ok(p)).toBeNull();
  });

  test("a sparse array is rejected", () => {
    const p = profile();
    const sparse: any[] = [];
    sparse[2] = p.domains[0];
    p.domains = sparse;
    expect(ok(p)).toBeNull();
  });

  test("an array on a poisoned prototype is rejected, not normalized", () => {
    const p = profile();
    const arr: any = [p.domains[0]];
    Object.setPrototypeOf(arr, { poisoned: true });
    p.domains = arr;
    expect(ok(p)).toBeNull();
  });

  test("an array carrying an extra own key is rejected", () => {
    const p = profile();
    const arr: any = [p.domains[0]];
    arr.smuggled = "payload";
    p.domains = arr;
    expect(ok(p)).toBeNull();
  });

  test("duplicate fact ids are rejected", () => {
    const p = profile();
    p.domains.push({ ...p.domains[0] });
    expect(ok(p)).toBeNull();
  });

  test("duplicate candidate ids are rejected", () => {
    const p = profile();
    p.candidates.push({ ...p.candidates[0] });
    expect(ok(p)).toBeNull();
  });

  test("empty domains/boundaries/methods are allowed — a sparse project is legal", () => {
    const p = profile({
      domains: [],
      boundaries: [],
      repeated_methods: [],
      coverage: { covered: [], uncovered: [], unmatched_roles: [] },
      candidates: [],
    });
    expect(ok(p)).not.toBeNull();
  });
});

// ── Codex adversarial round 1 — the `opts` bypass ────────────────────────────
//
// REGRESSION. Round 1 found that `opts.suggestionBudget` was read with plain
// property access AFTER the profile's closed-key check. A getter on `opts` could
// therefore mutate the profile after it had been validated: the getter fired, an
// unknown key was smuggled in, the profile was ACCEPTED, and the extra key was
// silently dropped from the output — four rule violations from one read.

describe("codex round 1 — opts is caller input and gets the same treatment", () => {
  test("a getter on opts NEVER fires, and the smuggled key does not slip through", () => {
    const p = profile();
    let fired = 0;
    const opts: any = Object.defineProperty({}, "suggestionBudget", {
      get() {
        fired += 1;
        (p as any).extra = "smuggled-after-key-check";
        return 4;
      },
      enumerable: true,
      configurable: true,
    });

    const result = validateProjectCapabilityProfileV1(p, opts);

    expect(fired).toBe(0); // the getter is never invoked
    expect(result).toBeNull(); // an accessor-bearing opts fails closed
    expect("extra" in (p as any)).toBe(false); // the artifact was never mutated
  });

  test("a Proxy as opts is rejected — its get trap is the same attack", () => {
    const proxied = new Proxy({ suggestionBudget: 4 }, {
      get(t: any, k) {
        return t[k];
      },
    });
    expect(ok(profile(), proxied)).toBeNull();
  });

  test("an unknown option key is rejected — opts is a closed set too", () => {
    expect(ok(profile(), { suggestionBudget: 4, sneaky: true } as any)).toBeNull();
  });

  test("a symbol key on opts is rejected", () => {
    const opts: any = { suggestionBudget: 4 };
    opts[Symbol("x")] = 1;
    expect(ok(profile(), opts)).toBeNull();
  });

  test("opts on a poisoned prototype is rejected", () => {
    const opts: any = Object.create({ poisoned: true });
    opts.suggestionBudget = 4;
    expect(ok(profile(), opts)).toBeNull();
  });

  test("the legitimate shapes still work", () => {
    expect(ok(profile())).not.toBeNull(); // omitted entirely
    expect(ok(profile(), {})).not.toBeNull(); // empty object
    expect(ok(profile(), { suggestionBudget: undefined })).not.toBeNull(); // explicit undefined
    expect(ok(profile(), { suggestionBudget: 4 })).not.toBeNull(); // explicit value
  });

  test("a non-numeric or negative budget still fails closed", () => {
    for (const bad of ["4", -1, 1.5, null, {}]) {
      expect(ok(profile(), { suggestionBudget: bad } as any)).toBeNull();
    }
  });
});

// ── Codex adversarial round 1, defect 2 — the alias dedup bypass ─────────────
//
// REGRESSION. Dedup compared raw strings, so two spellings of ONE referent
// counted as two citations and inflated `occurrence_count` — defeating A1.4,
// the guarantee the dedup exists to provide. Fixed by REJECTING non-canonical
// locators (never normalizing them: silently rewriting a citation is the last
// thing an evidence contract should do).

describe("codex round 1 defect 2 — one spelling per referent", () => {
  test("the reported alias no longer inflates occurrence_count", () => {
    const p = profile();
    p.repeated_methods[0].occurrence_count = 2;
    p.repeated_methods[0].evidence_refs = [
      "reflection:.guild/reflections/r.md",
      "reflection:.guild/reflections/./r.md",
    ];
    expect(ok(p)).toBeNull();
  });

  test.each([
    ["dot segment", "reflection:.guild/./r.md"],
    ["dot-dot segment", "reflection:.guild/../r.md"],
    ["doubled slash", "reflection:.guild//r.md"],
    ["trailing slash", "reflection:.guild/"],
    ["leading slash", "reflection:/abs/r.md"],
    ["backslash", "reflection:.guild\\r.md"],
  ])("%s is rejected as a non-canonical locator", (_label, ref) => {
    expect(parseEvidenceRef(ref)).toBeNull();
    expect(isCanonicalLocator(ref.slice(ref.indexOf(":") + 1))).toBe(false);
  });

  test("canonical locators of every source still parse", () => {
    for (const ref of [
      "run:run-20260730-131020-x",
      "reflection:.guild/reflections/r.md",
      "knowledge_graph:node/domain/dispatch",
      "codebase_map:src/modules/dispatch/index.ts#74",
      "roster:plugin-runtime-architect",
    ]) {
      expect(parseEvidenceRef(ref)).not.toBeNull();
    }
  });

  test("dedup is now sound: two distinct strings are two distinct referents", () => {
    const p = profile();
    p.repeated_methods[0].occurrence_count = 2;
    p.repeated_methods[0].evidence_refs = [
      "reflection:.guild/reflections/a.md",
      "reflection:.guild/reflections/b.md",
    ];
    expect(ok(p)).not.toBeNull();
  });
});

// ── Anti-vacuity ─────────────────────────────────────────────────────────────
//
// A gate never observed failing is not evidence. These prove the fixture is
// actually exercising the guards rather than passing them trivially.

describe("anti-vacuity — the fixture is not passing by accident", () => {
  test("the baseline fixture uses every guard-relevant field non-trivially", () => {
    const p = profile();
    expect(p.candidates.length).toBeGreaterThan(0);
    expect(p.repeated_methods[0].evidence_refs.length).toBe(
      p.repeated_methods[0].occurrence_count
    );
    expect(p.coverage.covered.length).toBeGreaterThan(0);
    expect(p.mutation_evidence.agents_tree_hash_before).toBe(
      p.mutation_evidence.agents_tree_hash_after
    );
  });

  test("STATIC: the module never imports an identity hasher", () => {
    // The same discipline as S2's A2.5: this contract must not become a second
    // identity model by quietly recomputing a profile/type hash.
    const src = fs.readFileSync(
      path.join(__dirname, "../lib/core/contracts/project-capability-profile.ts"),
      "utf8"
    );
    expect(src).not.toContain("hashSpecialistProfile");
    expect(src).not.toContain("hashSpecialistType");
    expect(src).not.toContain("createHash");
  });

  test("STATIC: the module does no I/O and reads no clock", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "../lib/core/contracts/project-capability-profile.ts"),
      "utf8"
    );
    expect(src).not.toContain('from "fs"');
    expect(src).not.toContain("Date.now");
    expect(src).not.toContain("new Date");
  });
});
