/**
 * scripts/__tests__/contract-vocabulary-freeze.test.ts
 *
 * RENAMED DURING THE FIVE-BRANCH INTEGRATION, and the rename is the resolution.
 * feature/cap-loc-contracts and feature/deep-freeze-collections each created a
 * `registry-freeze.test.ts` — an add/add conflict between two files that share a
 * name and nothing else. Neither subsumes the other:
 *
 *   this file ......... the NAMED-SURFACE half. 13 exported vocabularies across
 *                       S2/S3/S6/S7, each with a per-surface "a smuggled member is
 *                       still rejected by the validator" proof. Specific, and it
 *                       knows which contract it is talking about.
 *   registry-freeze ... the REPO-WIDE half. An AST scan plus a runtime deep-walk
 *                       over the module public indexes, with an anti-vacuity floor.
 *                       General, and it does not know any surface by name.
 *
 * Keeping one and dropping the other would have lost real coverage in whichever
 * direction it went, so both are kept and only the collision is removed.
 *
 * RULE 10 / matrix class XF — every exported registry or closed vocabulary is
 * frozen at RUNTIME, not merely `as const`.
 *
 * `as const` is a COMPILE-TIME annotation. It narrows the type and does nothing to
 * the object, so an exported vocabulary array stays mutable at runtime and any
 * caller can widen validation process-wide:
 *
 *     EXECUTION_REASON_CODES.push("anything");   // no type error at the call site
 *                                                // if the caller casts, and no
 *                                                // runtime barrier at all
 *
 * That is a validation bypass reachable without touching the contract file. Found
 * on S4 (`keysFrozen === false`) and confirmed present on all four of the surfaces
 * covered here.
 *
 * Rule 10 requires BOTH halves, and the second is the one that matters:
 *   1. mutation throws (or is silently refused in sloppy mode); AND
 *   2. validation STILL REJECTS a smuggled member afterwards.
 *
 * Half 1 alone would pass on a frozen-but-unused constant. Half 2 is what proves
 * the validator actually reads the frozen registry rather than a private copy —
 * the same "does the guard call production, or its own copy?" question that made
 * S4's schema guard self-referential.
 */

import {
  DEFINITION_KINDS,
  REF_VERIFICATION_FAILURES,
  validateProjectDefinitionRefV1,
} from "../lib/core/contracts/project-definition-ref";
import {
  ADOPTION_REASONS,
  ADOPTION_RESOLUTIONS,
  LEGACY_HOMES,
  validateLegacyLocator,
} from "../lib/core/contracts/adoption-manifest";
import {
  EXECUTION_DISPATCH_MODES,
  EXECUTION_OPERATIONS,
  EXECUTION_OUTCOME_STATUSES,
  EXECUTION_REASON_CODES,
  EXECUTION_TRANSPORT_IDS,
  TEAM_DISPATCH_SCOPES,
  isExecutionOperation,
  isExecutionReasonCode,
} from "../../src/modules/dispatch/workflows/execution-transport-ports";
import {
  INJECTION_SUPPORT,
  REQUIRED_HOOK_EVENTS,
} from "../../src/modules/host-runtime/workflows/host-capabilities-schema";

/** Every exported vocabulary across the four contract surfaces this lane owns. */
const REGISTRIES: ReadonlyArray<readonly [string, readonly unknown[]]> = [
  ["S2 DEFINITION_KINDS", DEFINITION_KINDS],
  ["S2 REF_VERIFICATION_FAILURES", REF_VERIFICATION_FAILURES],
  ["S3 ADOPTION_REASONS", ADOPTION_REASONS],
  ["S3 LEGACY_HOMES", LEGACY_HOMES],
  ["S3 ADOPTION_RESOLUTIONS", ADOPTION_RESOLUTIONS],
  ["S7 EXECUTION_OPERATIONS", EXECUTION_OPERATIONS],
  ["S7 EXECUTION_OUTCOME_STATUSES", EXECUTION_OUTCOME_STATUSES],
  ["S7 EXECUTION_REASON_CODES", EXECUTION_REASON_CODES],
  ["S7 EXECUTION_TRANSPORT_IDS", EXECUTION_TRANSPORT_IDS],
  ["S7 TEAM_DISPATCH_SCOPES", TEAM_DISPATCH_SCOPES],
  ["S7 EXECUTION_DISPATCH_MODES", EXECUTION_DISPATCH_MODES],
  ["S6 INJECTION_SUPPORT", INJECTION_SUPPORT],
  ["S6 REQUIRED_HOOK_EVENTS", REQUIRED_HOOK_EVENTS],
];

describe("XF.1 — every exported vocabulary is frozen at RUNTIME", () => {
  it("covers all 13 exported registries across the four surfaces", () => {
    // A floor, so a NEW exported vocabulary that skips this file is conspicuous.
    expect(REGISTRIES).toHaveLength(13);
  });

  it.each(REGISTRIES)("%s is Object.isFrozen", (_label, reg) => {
    expect(Object.isFrozen(reg)).toBe(true);
  });

  it.each(REGISTRIES)("%s refuses a push", (_label, reg) => {
    const before = reg.length;
    // Strict mode (TS modules are strict) throws; sloppy mode silently refuses.
    // Assert the OUTCOME rather than the mechanism, so the test holds either way.
    try {
      (reg as unknown[]).push("smuggled");
    } catch {
      /* expected in strict mode */
    }
    expect(reg.length).toBe(before);
    expect(reg).not.toContain("smuggled");
  });

  it.each(REGISTRIES)("%s refuses an index overwrite", (_label, reg) => {
    const original = reg[0];
    try {
      (reg as unknown[])[0] = "smuggled";
    } catch {
      /* expected */
    }
    expect(reg[0]).toBe(original);
  });
});

// ── XF.2 — the half that actually matters ──────────────────────────────────

describe("XF.2 — validation still REJECTS a smuggled member after a mutation attempt", () => {
  it("S7: a smuggled operation is not recognised", () => {
    try {
      (EXECUTION_OPERATIONS as unknown as unknown[]).push("exfiltrate");
    } catch {
      /* expected */
    }
    // The guard reads the frozen registry, so widening it was impossible AND the
    // predicate still refuses. Freezing without this assertion would prove only
    // that a constant is frozen, not that validation depends on it.
    expect(isExecutionOperation("exfiltrate")).toBe(false);
    expect(EXECUTION_OPERATIONS).toHaveLength(7);
  });

  it("S7: a smuggled reason code is not recognised", () => {
    try {
      (EXECUTION_REASON_CODES as unknown as unknown[]).push("policy_denied");
    } catch {
      /* expected */
    }
    // `policy_denied` is specifically the shape BR-04 forbids a transport from
    // emitting — a widened vocabulary would have let one claim a policy denial.
    expect(isExecutionReasonCode("policy_denied")).toBe(false);
    expect(EXECUTION_REASON_CODES).toHaveLength(14);
  });

  it("S3: a smuggled legacy home is still rejected by the validator", () => {
    try {
      (LEGACY_HOMES as unknown as unknown[]).push("anywhere");
    } catch {
      /* expected */
    }
    expect(
      validateLegacyLocator({
        id: "x",
        historical_path: "/g/x.md",
        content_hash: null,
        home: "anywhere",
      })
    ).toBeNull();
  });

  it("S2: a smuggled definition kind is still rejected by the validator", () => {
    try {
      (DEFINITION_KINDS as unknown as unknown[]).push("tool");
    } catch {
      /* expected */
    }
    expect(
      validateProjectDefinitionRefV1({
        schema_version: "guild.project_definition_ref.v1",
        project_id: "plugin",
        kind: "tool",
        id: "x",
        relative_path: ".guild/agents/x.md",
        content_hash: `sha256:${"a".repeat(64)}`,
        source_commit: null,
        specialist_profile_hash: null,
        specialist_type_hash: null,
        skills: [],
      })
    ).toBeNull();
  });
});
