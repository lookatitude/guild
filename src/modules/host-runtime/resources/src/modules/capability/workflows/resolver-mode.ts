/**
 * src/modules/capability/workflows/resolver-mode.ts
 *
 * The FIVE RESOLVER OPERATING MODES — `guild.resolver_mode_outcome.v1`.
 *
 * Closes audit gap D4: *"the mode concept does not exist — `roster-resolve.ts` has
 * no mode, no config key, and the plan never says where the mode would live."* S5
 * gave the mode a home (`capability.resolver_mode`, already landed in
 * `config-defaults.ts`); THIS file gives it behaviour.
 *
 * ── WHAT A MODE IS ──────────────────────────────────────────────────────────
 * A mode is a POLICY, not a code path. It answers four questions, and every
 * consumer must read the answers from `RESOLVER_MODE_POLICIES` rather than
 * re-deriving them from the mode string:
 *
 *   1. which resolver is AUTHORITATIVE (legacy vs project-local)
 *   2. whether the project-local resolver may perform CAPABILITY WRITES
 *   3. whether the compatibility surface (15 templates + 58 domain skills) is
 *      REACHABLE at all, and for which intents
 *   4. whether user-approved LOCAL CREATION may happen
 *
 * ── THE ONE INVARIANT ───────────────────────────────────────────────────────
 * EVERY mode change and EVERY unresolvable capability produces a TYPED OUTCOME.
 * There is no silent fallback anywhere in this file. `resolveCapability` returns
 * a discriminated union whose `unresolved` arm always carries a closed failure
 * code; `planModeTransition` returns `rejected` with a closed code rather than
 * clamping to a legal mode. A caller that ignores the outcome gets nothing — not
 * a best guess.
 *
 * Why that matters concretely: the failure this replaces is "capability X has no
 * project definition, so quietly load the shipped template". That fallback is
 * invisible in a receipt, invisible in a diff, and it is exactly what makes a
 * migration window never end — the legacy read never surfaces as a decision
 * anyone can see or count.
 *
 * ── COUNTING IS DEFINED HERE, ONCE ──────────────────────────────────────────
 * `classifyCompatibilityRead` is the SOLE place that maps (mode, intent) onto an
 * S8 `CompatibilityReadReason`. The G5 removal gate's counting rule is
 * load-bearing and asymmetric — `mint_source` and `shadow_comparison` are the
 * migration WORKING and must be excluded, or the gate can never reach zero — so
 * the mapping lives in one function that every emission point calls, rather than
 * as a judgement each call site re-makes.
 *
 * ── DEFAULT FLIP ────────────────────────────────────────────────────────────
 * This file does NOT decide the shipped default. `CAPABILITY_RESOLVER_MODE_DEFAULT`
 * (currently `legacy`, pending F7) and `CAPABILITY_RESOLVER_MODE_AFTER_F7` live in
 * `config-defaults.ts` and are re-exported here for consumers, unchanged.
 *
 * Pure library module: no I/O, no clock, no filesystem. Never throws.
 */

import { types as nodeTypes } from "util";

import {
  CAPABILITY_RESOLVER_MODES,
  type CapabilityResolverMode,
} from "../../config";

import {
  COMPATIBILITY_READ_REASONS,
  type CompatibilityReadReason,
} from "./compatibility-usage";

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

export const RESOLVER_MODE_OUTCOME_SCHEMA = "guild.resolver_mode_outcome.v1" as const;

// ---------------------------------------------------------------------------
// Shared hardening primitives
// ---------------------------------------------------------------------------
//
// Re-declared rather than imported so this module has no cross-contract import
// edge, matching the convention in core/contracts/*. Behaviour is deliberately
// identical to `compatibility-usage.ts`; see that file for the full rationale.

/** Every scalar in this contract is short by nature. Unbounded is a smuggling channel. */
const MAX_SCALAR_LEN = 1024;

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

/** Canonical id spelling. One referent, one spelling — never normalized. */
const CANONICAL_ID = /^[a-z0-9][a-z0-9._-]*$/;

const MAX_ID_LEN = 128;

function isCanonicalId(v: unknown): v is string {
  return (
    typeof v === "string" &&
    v.length > 0 &&
    v.length <= MAX_ID_LEN &&
    !CONTROL_CHARS.test(v) &&
    CANONICAL_ID.test(v)
  );
}

/**
 * A CANONICAL relative path. Non-canonical spellings are REJECTED, never
 * repaired: inventing a canonical spelling silently decides what the caller
 * meant, and two spellings of one file would resolve as two capabilities.
 */
function isCanonicalRelPath(v: unknown): v is string {
  if (typeof v !== "string" || v.length === 0 || v.length > MAX_SCALAR_LEN) return false;
  if (CONTROL_CHARS.test(v)) return false;
  if (v.includes("\\")) return false; // one separator convention only
  if (/^[A-Za-z]:/.test(v)) return false; // Windows drive absolute
  if (v.startsWith("/")) return false; // must be relative
  if (v.endsWith("/")) return false; // a directory is not a definition
  for (const seg of v.split("/")) {
    if (seg.length === 0) return false; // `//` or leading/trailing empty
    if (seg === "." || seg === "..") return false; // alias spellings
  }
  return true;
}

/**
 * Resolve a caller-supplied OPTIONS object into a plain own-data snapshot, or null.
 *
 * Options are resolved FIRST, before anything is inspected, so nothing
 * caller-supplied can execute during the decision. A getter or Proxy on the
 * options would otherwise run DURING validation and could return a different
 * value on the check than on the use — in `resolveCapability` that is a direct
 * authority confusion: report `strict` to the mode check and `legacy` to the
 * fallback branch, and a strict-mode project silently loads a shipped template.
 */
function readOptions(
  value: unknown,
  allowedKeys: readonly string[],
): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  if (nodeTypes.isProxy(value)) return null;
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return null;
  if (Object.getOwnPropertySymbols(value).length > 0) return null;
  const out: Record<string, unknown> = Object.create(null);
  for (const key of Object.getOwnPropertyNames(value)) {
    if (!allowedKeys.includes(key)) return null; // unknown key ⇒ REJECT, never ignore
    const desc = Object.getOwnPropertyDescriptor(value, key);
    if (!desc || !("value" in desc)) return null; // accessor ⇒ reject, never invoke
    out[key] = desc.value;
  }
  return out;
}

// ---------------------------------------------------------------------------
// The mode policy matrix
// ---------------------------------------------------------------------------

/** Which resolver's answer is BINDING in a given mode. */
export const RESOLVER_AUTHORITIES = Object.freeze(["legacy", "project-local"] as const);
export type ResolverAuthority = (typeof RESOLVER_AUTHORITIES)[number];

/**
 * Why a caller is reaching for a definition. CLOSED — the intent is what makes a
 * compatibility read countable or benign, so it can never be free text.
 */
export const CAPABILITY_RESOLUTION_INTENTS = Object.freeze([
  /** A live lane needs this definition to run. */
  "dispatch",
  /** Minting a project-local role FROM a shipped template. The migration WORKING. */
  "mint",
  /** The A-side of a shadow comparison. Also the migration working. */
  "shadow_compare",
  /** Replaying a historical run record against the compatibility surface. */
  "replay",
  /** A deliberate return to the legacy path after a failed adoption. */
  "rollback",
] as const);
export type CapabilityResolutionIntent = (typeof CAPABILITY_RESOLUTION_INTENTS)[number];

/**
 * One mode's policy. Frozen, and consumed through `resolverModePolicy()` — the
 * exported record is for readers; the PRIVATE frozen map decides.
 */
export interface ResolverModePolicy {
  readonly mode: CapabilityResolverMode;
  /** Which resolver's answer binds. */
  readonly authority: ResolverAuthority;
  /** Does the project-local resolver run at all (even non-authoritatively)? */
  readonly project_resolver_runs: boolean;
  /** May the project-local side perform capability WRITES (mint, registry, profile)? */
  readonly capability_writes_permitted: boolean;
  /** May a dispatch/mint side effect originate from the project-local side? */
  readonly project_side_effects_permitted: boolean;
  /** Is the compatibility surface reachable at all in this mode? */
  readonly compatibility_available: boolean;
  /** The intents for which a compatibility read is legal in this mode. */
  readonly compatibility_intents: readonly CapabilityResolutionIntent[];
  /** May a human-approved local definition be created while in this mode? */
  readonly local_creation_permitted: boolean;
  /** Are profiles written and candidates computed? */
  readonly profiles_emitted: boolean;
}

/**
 * The ladder, as policy.
 *
 * Each row is the decision record made executable:
 *
 *   legacy         current roster + shipped templates/domain skills. The world as it
 *                  was; the project-local resolver does not run, so nothing is
 *                  profiled and nothing is proposed.
 *   observe        legacy remains AUTHORITATIVE. Profiles are written and candidates
 *                  computed, but NO capability writes occur — that is the whole
 *                  point of the phase, and D03's advance condition is "zero live
 *                  agent/skill/registry writes proven by before/after tree hash".
 *   shadow         BOTH resolvers run so their answers can be compared field by
 *                  field. Only the LEGACY side may mint or produce a dispatch side
 *                  effect; user-approved local creation is allowed, because that
 *                  approval is a human authority event (D02), not a resolver effect.
 *   project-local  the project's own definitions are authoritative. The compatibility
 *                  surface is reachable ONLY for explicit replay or migration — a
 *                  live dispatch that finds no project definition is a typed failure
 *                  carrying `no_project_definition`, which is precisely the reason
 *                  G5 counts.
 *   strict         templates and domain packs are UNAVAILABLE. A missing capability
 *                  is an explicit typed failure with no read to fall back to. This is
 *                  the end state the removal gate clears the way for.
 */
const MODE_POLICIES: ReadonlyMap<CapabilityResolverMode, ResolverModePolicy> = new Map<
  CapabilityResolverMode,
  ResolverModePolicy
>([
  [
    "legacy",
    Object.freeze({
      mode: "legacy",
      authority: "legacy",
      project_resolver_runs: false,
      capability_writes_permitted: false,
      project_side_effects_permitted: false,
      compatibility_available: true,
      compatibility_intents: Object.freeze([
        "dispatch",
        "mint",
        "replay",
        "rollback",
      ] as const),
      local_creation_permitted: false,
      profiles_emitted: false,
    }) as ResolverModePolicy,
  ],
  [
    "observe",
    Object.freeze({
      mode: "observe",
      authority: "legacy",
      project_resolver_runs: true,
      // THE defining constraint of observe. D03's advance condition is a
      // before/after tree hash proving zero live writes; a policy that permitted
      // writes here would make that condition unprovable by construction.
      capability_writes_permitted: false,
      project_side_effects_permitted: false,
      compatibility_available: true,
      compatibility_intents: Object.freeze([
        "dispatch",
        "mint",
        "replay",
        "rollback",
      ] as const),
      local_creation_permitted: false,
      profiles_emitted: true,
    }) as ResolverModePolicy,
  ],
  [
    "shadow",
    Object.freeze({
      mode: "shadow",
      authority: "legacy",
      project_resolver_runs: true,
      // Local creation is a HUMAN authority event, so it is permitted; but the
      // project-local RESOLVER still may not originate a mint or a dispatch. The
      // two are deliberately separate flags: collapsing them would either block
      // the approvals the phase exists to collect, or let the shadow side act.
      capability_writes_permitted: true,
      project_side_effects_permitted: false,
      compatibility_available: true,
      compatibility_intents: Object.freeze([
        "dispatch",
        "mint",
        "shadow_compare",
        "replay",
        "rollback",
      ] as const),
      local_creation_permitted: true,
      profiles_emitted: true,
    }) as ResolverModePolicy,
  ],
  [
    "project-local",
    Object.freeze({
      mode: "project-local",
      authority: "project-local",
      project_resolver_runs: true,
      capability_writes_permitted: true,
      project_side_effects_permitted: true,
      compatibility_available: true,
      // NOT `dispatch`. A live dispatch with no project definition must FAIL
      // TYPED, not quietly read a shipped template — that silent read is the
      // exact behaviour the mode exists to end.
      compatibility_intents: Object.freeze(["replay", "rollback", "mint"] as const),
      local_creation_permitted: true,
      profiles_emitted: true,
    }) as ResolverModePolicy,
  ],
  [
    "strict",
    Object.freeze({
      mode: "strict",
      authority: "project-local",
      project_resolver_runs: true,
      capability_writes_permitted: true,
      project_side_effects_permitted: true,
      // The end state: the surface is gone. No intent reaches it, including
      // replay — a strict project that still needs to replay history must step
      // back down the ladder deliberately, which is a recorded mode change.
      compatibility_available: false,
      compatibility_intents: Object.freeze([] as const),
      local_creation_permitted: true,
      profiles_emitted: true,
    }) as ResolverModePolicy,
  ],
]);

/**
 * The policy table as a plain frozen record, for readers and docs.
 *
 * Verdicts are taken from the PRIVATE `MODE_POLICIES` map above, so mutating
 * anything reachable from this export cannot change a resolution. (`as const` is
 * compile-time only; every level here is genuinely frozen.)
 */
export const RESOLVER_MODE_POLICIES: Readonly<
  Record<CapabilityResolverMode, ResolverModePolicy>
> = Object.freeze(
  Object.fromEntries(
    CAPABILITY_RESOLVER_MODES.map((m) => [m, MODE_POLICIES.get(m)!]),
  ) as Record<CapabilityResolverMode, ResolverModePolicy>,
);

/** The policy for a mode, or null if the value is not a member of the ladder. */
export function resolverModePolicy(mode: unknown): ResolverModePolicy | null {
  if (typeof mode !== "string") return null;
  return MODE_POLICIES.get(mode as CapabilityResolverMode) ?? null;
}

/**
 * Ladder position, or `-1`. The ONLY ranking anyone should use — a consumer
 * comparing migration progress must never re-derive the order from a set.
 */
export function resolverModeRank(mode: unknown): number {
  if (typeof mode !== "string") return -1;
  return CAPABILITY_RESOLVER_MODES.indexOf(mode as CapabilityResolverMode);
}

// ---------------------------------------------------------------------------
// Typed failures — the closed vocabulary that replaces every silent fallback
// ---------------------------------------------------------------------------

/**
 * Why a resolution or a mode change did not happen.
 *
 * CLOSED and frozen. Each member names a DISTINCT operator action, which is why
 * they are not collapsed into one "failed" code: `no_project_definition` means
 * "author the definition", `compatibility_unavailable_in_mode` means "you are in
 * strict and this asset is gone", and `intent_not_permitted_in_mode` means "the
 * mode is right, the intent is wrong". Collapsing them would return the caller
 * to guessing, which is the state this file exists to leave.
 */
export const RESOLVER_MODE_FAILURES = Object.freeze([
  /** The request itself was malformed (proxy, accessor, unknown key, bad scalar). */
  "invalid_request",
  /** `mode` is not a member of the ladder. NEVER coerced to the default. */
  "unknown_mode",
  /** No project-local definition exists, and the mode does not permit a compatibility read. */
  "no_project_definition",
  /** The mode has no compatibility surface at all (strict). */
  "compatibility_unavailable_in_mode",
  /** The surface exists, but not for this intent (e.g. `dispatch` under project-local). */
  "intent_not_permitted_in_mode",
  /** Neither a project definition nor a compatibility asset was supplied. */
  "no_definition_anywhere",
  /** The mode forbids the write this request would require. */
  "write_not_permitted_in_mode",
  /** A mode transition that skips rungs without an explicit acknowledgement. */
  "transition_skips_rungs",
  /** A downward transition without a recorded reason. */
  "transition_regresses_without_reason",
  /** Source and target are the same rung. */
  "transition_is_noop",
] as const);
export type ResolverModeFailure = (typeof RESOLVER_MODE_FAILURES)[number];

const RESOLVER_MODE_FAILURE_SET: ReadonlySet<string> = new Set(RESOLVER_MODE_FAILURES);

/** True iff `v` is a member of the closed failure vocabulary. */
export function isResolverModeFailure(v: unknown): v is ResolverModeFailure {
  return typeof v === "string" && RESOLVER_MODE_FAILURE_SET.has(v);
}

// ---------------------------------------------------------------------------
// Compatibility-read classification — the G5 counting rule, in one place
// ---------------------------------------------------------------------------

const READ_REASON_SET: ReadonlySet<string> = new Set(COMPATIBILITY_READ_REASONS);

/**
 * The (mode, intent) → S8 reason mapping. PRIVATE and frozen; the exported
 * function is the only way to reach it.
 *
 * The asymmetry is deliberate and is the reason this table exists rather than a
 * per-call-site judgement:
 *
 *   mint            ⇒ `mint_source`       BENIGN — minting reads the template BY
 *                                          DESIGN. Counting it means the total never
 *                                          reaches zero and G5 can never pass.
 *   shadow_compare  ⇒ `shadow_comparison` BENIGN — the A-side is SUPPOSED to be legacy.
 *   rollback        ⇒ `rollback`          DEPENDENCE — a deliberate return to legacy is
 *                                          the clearest possible evidence of dependence.
 *   dispatch under a legacy-authoritative mode
 *                   ⇒ `explicit_legacy_mode`  DEPENDENCE — the project is running on the
 *                                          legacy path because it was told to.
 *   dispatch under project-local
 *                   ⇒ (never classified) the policy forbids the read; the caller gets
 *                                          `intent_not_permitted_in_mode` instead.
 *   replay          ⇒ `explicit_legacy_mode`  DEPENDENCE, deliberately. A replay that
 *                                          genuinely needs the shipped bytes means those
 *                                          bytes cannot be deleted yet — that is the
 *                                          honest answer, and fail-closed. Tooling and
 *                                          test replays set `synthetic: true` at the
 *                                          EMISSION point, which excludes them from G5
 *                                          without weakening the rule for real runs.
 */
const INTENT_REASON: ReadonlyMap<CapabilityResolutionIntent, CompatibilityReadReason> =
  new Map<CapabilityResolutionIntent, CompatibilityReadReason>([
    ["mint", "mint_source"],
    ["shadow_compare", "shadow_comparison"],
    ["rollback", "rollback"],
    ["replay", "explicit_legacy_mode"],
  ]);

/** The benign reasons, snapshotted privately. Mutating an S8 export cannot reach this. */
const BENIGN_REASONS: ReadonlySet<CompatibilityReadReason> = new Set<CompatibilityReadReason>([
  "mint_source",
  "shadow_comparison",
]);

/**
 * DISCRIMINATED BY A STRING, not by a boolean `ok`. The repo transpiles under a
 * non-strict ts-jest config, and without `strictNullChecks` a `true | false`
 * discriminant does not narrow — a consumer would silently lose the refusal arm
 * and read `undefined` where a failure code belongs. A string tag narrows in both
 * modes, and matches the `status` discriminant every other outcome here uses.
 */
export type CompatibilityReadClassification =
  | {
      readonly status: "classified";
      readonly reason: CompatibilityReadReason;
      /** Whether this read is G5 DEPENDENCE. Derived here, never re-judged downstream. */
      readonly counts_as_dependence: boolean;
    }
  | { readonly status: "refused"; readonly failure: ResolverModeFailure; readonly detail: string };

/**
 * Classify a compatibility read into its S8 reason. The SOLE definition of the
 * G5 counting rule; every emission point routes through it.
 *
 * Returns a typed refusal — never a default reason — when the mode does not
 * permit the read. Guessing a reason for a read that should not have happened
 * would put a fabricated row into the one number the removal gate rests on.
 */
export function classifyCompatibilityRead(request: unknown): CompatibilityReadClassification {
  const opts = readOptions(request, ["mode", "intent"]);
  if (opts === null) {
    return {
      status: "refused" as const,
      failure: "invalid_request",
      detail: "classification request rejected (proxy/accessor/symbol/unknown key)",
    };
  }
  const policy = resolverModePolicy(opts["mode"]);
  if (policy === null) {
    return {
      status: "refused" as const,
      failure: "unknown_mode",
      detail: `not a resolver mode: ${JSON.stringify(opts["mode"])}`,
    };
  }
  const intent = opts["intent"];
  if (typeof intent !== "string" || !CAPABILITY_RESOLUTION_INTENTS.includes(intent as CapabilityResolutionIntent)) {
    return {
      status: "refused" as const,
      failure: "invalid_request",
      detail: `not a resolution intent: ${JSON.stringify(intent)}`,
    };
  }
  const typedIntent = intent as CapabilityResolutionIntent;

  if (!policy.compatibility_available) {
    return {
      status: "refused" as const,
      failure: "compatibility_unavailable_in_mode",
      detail: `mode ${policy.mode} has no compatibility surface`,
    };
  }
  if (!policy.compatibility_intents.includes(typedIntent)) {
    return {
      status: "refused" as const,
      failure: "intent_not_permitted_in_mode",
      detail: `mode ${policy.mode} does not permit a compatibility read for intent ${typedIntent}`,
    };
  }

  // `dispatch` is the only intent whose reason depends on the MODE rather than on
  // the intent alone, because "why is this legacy asset being read" is genuinely a
  // different answer under a legacy-authoritative mode than under project-local.
  let reason: CompatibilityReadReason | undefined = INTENT_REASON.get(typedIntent);
  if (reason === undefined) {
    reason = policy.authority === "legacy" ? "explicit_legacy_mode" : "no_project_definition";
  }
  // Defence in depth: the reason must be a member of S8's vocabulary. A mapping
  // that drifted out of the closed set would produce a payload S8's validator
  // rejects, and a rejected payload is an UNREADABLE record — which blocks G5
  // rather than passing it, but blocks it mysteriously.
  if (!READ_REASON_SET.has(reason)) {
    return {
      status: "refused" as const,
      failure: "invalid_request",
      detail: `classified reason ${JSON.stringify(reason)} is not a guild.compatibility_usage.v1 reason`,
    };
  }

  return Object.freeze({
    status: "classified" as const,
    reason,
    counts_as_dependence: !BENIGN_REASONS.has(reason),
  });
}

// ---------------------------------------------------------------------------
// Capability resolution
// ---------------------------------------------------------------------------

export interface CapabilityResolutionRequest {
  readonly mode: CapabilityResolverMode;
  readonly kind: "agent" | "skill";
  /** Canonical capability id (role slug or skill name). */
  readonly capability_id: string;
  /** Project-root-relative path of the local definition, or null when absent. */
  readonly project_definition: string | null;
  /** Plugin-install-relative path of the shipped asset, or null when absent. */
  readonly compatibility_asset: string | null;
  readonly intent: CapabilityResolutionIntent;
}

export type CapabilityResolutionOutcome =
  | {
      readonly schema_version: typeof RESOLVER_MODE_OUTCOME_SCHEMA;
      readonly status: "resolved";
      readonly mode: CapabilityResolverMode;
      readonly kind: "agent" | "skill";
      readonly capability_id: string;
      /** Which surface answered. */
      readonly source: "project" | "compatibility";
      /** The path that answered, in the spelling the caller supplied. */
      readonly path: string;
      /** Which resolver's answer was BINDING in this mode. */
      readonly authority: ResolverAuthority;
      /** Whether the caller may act (mint/dispatch side effect) on this answer. */
      readonly side_effects_permitted: boolean;
      /**
       * Present IFF `source === "compatibility"`. Carries the S8 reason and the
       * dependence flag so the emission point never re-derives them.
       */
      readonly compatibility_read: {
        readonly reason: CompatibilityReadReason;
        readonly counts_as_dependence: boolean;
      } | null;
    }
  | {
      readonly schema_version: typeof RESOLVER_MODE_OUTCOME_SCHEMA;
      readonly status: "unresolved";
      readonly mode: CapabilityResolverMode | null;
      readonly kind: "agent" | "skill" | null;
      readonly capability_id: string | null;
      readonly failure: ResolverModeFailure;
      readonly detail: string;
    };

const RESOLUTION_REQUEST_KEYS = [
  "mode",
  "kind",
  "capability_id",
  "project_definition",
  "compatibility_asset",
  "intent",
] as const;

function unresolved(
  failure: ResolverModeFailure,
  detail: string,
  ctx?: {
    mode?: CapabilityResolverMode | null;
    kind?: "agent" | "skill" | null;
    capability_id?: string | null;
  },
): CapabilityResolutionOutcome {
  return Object.freeze({
    schema_version: RESOLVER_MODE_OUTCOME_SCHEMA,
    status: "unresolved" as const,
    mode: ctx?.mode ?? null,
    kind: ctx?.kind ?? null,
    capability_id: ctx?.capability_id ?? null,
    failure,
    detail,
  });
}

/**
 * Resolve one capability under one mode. PURE — no filesystem, no clock.
 *
 * The caller supplies what EXISTS (a project definition path, a compatibility
 * asset path, or neither); this decides what may be USED. Separating the two is
 * what lets the policy be tested exhaustively without a fixture tree, and what
 * keeps "does the file exist" (an I/O question) out of "may I read it" (a policy
 * question).
 *
 * NEVER falls back silently. Every non-resolution is a typed `unresolved` arm.
 */
export function resolveCapability(request: unknown): CapabilityResolutionOutcome {
  // Options FIRST: nothing caller-supplied executes after this line, so no field
  // can differ between the check that guards it and the read that uses it.
  const opts = readOptions(request, RESOLUTION_REQUEST_KEYS);
  if (opts === null) {
    return unresolved(
      "invalid_request",
      "resolution request rejected (proxy/accessor/symbol/unknown key)",
    );
  }

  const policy = resolverModePolicy(opts["mode"]);
  if (policy === null) {
    // NEVER coerced to the shipped default. A typo in `capability.resolver_mode`
    // that silently resolved to `legacy` would put a project on the legacy path
    // while `config show` reports the typo — the operator would have no way to
    // see which world they are in.
    return unresolved("unknown_mode", `not a resolver mode: ${JSON.stringify(opts["mode"])}`);
  }
  const mode = policy.mode;

  const kindRaw = opts["kind"];
  if (kindRaw !== "agent" && kindRaw !== "skill") {
    return unresolved("invalid_request", `kind must be "agent" or "skill"`, { mode });
  }
  // The two `!==` guards above prove the value, but equality narrowing on
  // `unknown` widens to `string`, so the assertion restores what was proven.
  const kind = kindRaw as "agent" | "skill";

  const capabilityId = opts["capability_id"];
  if (!isCanonicalId(capabilityId)) {
    // Rejected, not normalized: two spellings of one capability would resolve as
    // two capabilities, and every count taken before a later normalization already
    // double-counted.
    return unresolved(
      "invalid_request",
      `capability_id is not a canonical id: ${JSON.stringify(capabilityId)}`,
      { mode, kind },
    );
  }

  const intentRaw = opts["intent"];
  if (
    typeof intentRaw !== "string" ||
    !CAPABILITY_RESOLUTION_INTENTS.includes(intentRaw as CapabilityResolutionIntent)
  ) {
    return unresolved("invalid_request", `not a resolution intent: ${JSON.stringify(intentRaw)}`, {
      mode,
      kind,
      capability_id: capabilityId,
    });
  }
  const intent = intentRaw as CapabilityResolutionIntent;

  const projectDefRaw = opts["project_definition"];
  let projectDef: string | null;
  if (projectDefRaw === null) projectDef = null;
  else if (isCanonicalRelPath(projectDefRaw)) projectDef = projectDefRaw;
  else {
    return unresolved(
      "invalid_request",
      `project_definition is not a canonical relative path: ${JSON.stringify(projectDefRaw)}`,
      { mode, kind, capability_id: capabilityId },
    );
  }

  const compatRaw = opts["compatibility_asset"];
  let compatAsset: string | null;
  if (compatRaw === null) compatAsset = null;
  else if (isCanonicalRelPath(compatRaw)) compatAsset = compatRaw;
  else {
    return unresolved(
      "invalid_request",
      `compatibility_asset is not a canonical relative path: ${JSON.stringify(compatRaw)}`,
      { mode, kind, capability_id: capabilityId },
    );
  }

  const ctx = { mode, kind, capability_id: capabilityId };

  // A mint intent is a WRITE. Refusing it here rather than at the write site is
  // what makes observe's "no capability writes" provable: the resolver never
  // hands back an answer a caller could act on.
  if (intent === "mint" && !policy.capability_writes_permitted) {
    return unresolved(
      "write_not_permitted_in_mode",
      `mode ${mode} does not permit capability writes, so intent "mint" cannot be served`,
      ctx,
    );
  }

  // ── The project-local side ──
  // It answers whenever it RUNS and has something to say — but the outcome
  // records whether its answer was AUTHORITATIVE and whether the caller may act,
  // so a shadow-mode caller cannot mistake a comparison answer for a live one.
  if (policy.project_resolver_runs && projectDef !== null && intent !== "shadow_compare") {
    return Object.freeze({
      schema_version: RESOLVER_MODE_OUTCOME_SCHEMA,
      status: "resolved" as const,
      mode,
      kind,
      capability_id: capabilityId,
      source: "project" as const,
      path: projectDef,
      authority: policy.authority,
      // In shadow, the project side may not originate a side effect even when it
      // has the better answer. That is the phase's whole safety property.
      side_effects_permitted: policy.project_side_effects_permitted,
      compatibility_read: null,
    });
  }

  // ── The compatibility side ──
  if (compatAsset === null) {
    return unresolved(
      projectDef === null ? "no_definition_anywhere" : "no_project_definition",
      projectDef === null
        ? `no project definition and no compatibility asset for ${kind} "${capabilityId}"`
        : `mode ${mode} did not consult the project definition for intent "${intent}", and no compatibility asset was supplied`,
      ctx,
    );
  }

  const classification = classifyCompatibilityRead({ mode, intent });
  if (classification.status === "refused") {
    // The typed refusal is passed through UNCHANGED. Under `project-local` a live
    // dispatch lands here with `intent_not_permitted_in_mode`; under `strict` with
    // `compatibility_unavailable_in_mode`. Both are the explicit typed failure the
    // mode ladder promises instead of a silent shipped-template read.
    return unresolved(classification.failure, classification.detail, ctx);
  }

  return Object.freeze({
    schema_version: RESOLVER_MODE_OUTCOME_SCHEMA,
    status: "resolved" as const,
    mode,
    kind,
    capability_id: capabilityId,
    source: "compatibility" as const,
    path: compatAsset,
    authority: policy.authority,
    side_effects_permitted: policy.authority === "legacy",
    compatibility_read: Object.freeze({
      reason: classification.reason,
      counts_as_dependence: classification.counts_as_dependence,
    }),
  });
}

// ---------------------------------------------------------------------------
// Mode transitions
// ---------------------------------------------------------------------------

/** The direction a transition moves along the ladder. */
export const MODE_TRANSITION_DIRECTIONS = Object.freeze(["advance", "regress"] as const);
export type ModeTransitionDirection = (typeof MODE_TRANSITION_DIRECTIONS)[number];

export type ModeTransitionOutcome =
  | {
      readonly schema_version: typeof RESOLVER_MODE_OUTCOME_SCHEMA;
      readonly status: "allowed";
      readonly from: CapabilityResolverMode;
      readonly to: CapabilityResolverMode;
      readonly direction: ModeTransitionDirection;
      /** How many rungs the ladder moves. Always ≥ 1. */
      readonly rungs: number;
      /** The operator-supplied justification, echoed for the receipt. */
      readonly reason: string;
    }
  | {
      readonly schema_version: typeof RESOLVER_MODE_OUTCOME_SCHEMA;
      readonly status: "rejected";
      readonly from: CapabilityResolverMode | null;
      readonly to: CapabilityResolverMode | null;
      readonly failure: ResolverModeFailure;
      readonly detail: string;
    };

const TRANSITION_KEYS = ["from", "to", "reason", "allow_skip"] as const;

function rejectedTransition(
  failure: ResolverModeFailure,
  detail: string,
  from: CapabilityResolverMode | null,
  to: CapabilityResolverMode | null,
): ModeTransitionOutcome {
  return Object.freeze({
    schema_version: RESOLVER_MODE_OUTCOME_SCHEMA,
    status: "rejected" as const,
    from,
    to,
    failure,
    detail,
  });
}

/**
 * Decide whether a mode change is legal, as a TYPED outcome.
 *
 * This is a POLICY check on the change itself, not on whether the migration
 * window's gate criteria are met — D03 is explicit that "advance conditions are
 * not encoded in config; they are gate criteria the initiative evaluates". What
 * this enforces is the shape of a legal move:
 *
 *   - a rung must actually change (`transition_is_noop`)
 *   - advancing more than one rung requires `allow_skip: true`, because skipping
 *     `observe` on the way to `project-local` skips the phase whose evidence the
 *     later gates consume — legal when deliberate, never by accident
 *   - a downward move (a rollback along the ladder) requires a non-empty reason,
 *     because it is the move that must be explicable months later
 *
 * Never throws; never clamps to a legal mode.
 */
export function planModeTransition(request: unknown): ModeTransitionOutcome {
  const opts = readOptions(request, TRANSITION_KEYS);
  if (opts === null) {
    return rejectedTransition(
      "invalid_request",
      "transition request rejected (proxy/accessor/symbol/unknown key)",
      null,
      null,
    );
  }

  const fromPolicy = resolverModePolicy(opts["from"]);
  if (fromPolicy === null) {
    return rejectedTransition(
      "unknown_mode",
      `"from" is not a resolver mode: ${JSON.stringify(opts["from"])}`,
      null,
      null,
    );
  }
  const toPolicy = resolverModePolicy(opts["to"]);
  if (toPolicy === null) {
    return rejectedTransition(
      "unknown_mode",
      `"to" is not a resolver mode: ${JSON.stringify(opts["to"])}`,
      fromPolicy.mode,
      null,
    );
  }
  const from = fromPolicy.mode;
  const to = toPolicy.mode;

  const reasonRaw = opts["reason"];
  if (
    typeof reasonRaw !== "string" ||
    reasonRaw.length === 0 ||
    reasonRaw.length > MAX_SCALAR_LEN ||
    CONTROL_CHARS.test(reasonRaw)
  ) {
    return rejectedTransition(
      "invalid_request",
      "reason must be a non-empty, control-character-free string within bounds",
      from,
      to,
    );
  }
  const reason = reasonRaw;

  const allowSkipRaw = opts["allow_skip"];
  if (allowSkipRaw !== undefined && typeof allowSkipRaw !== "boolean") {
    return rejectedTransition("invalid_request", "allow_skip must be a boolean", from, to);
  }
  const allowSkip = allowSkipRaw === true;

  const fromRank = resolverModeRank(from);
  const toRank = resolverModeRank(to);
  if (fromRank === toRank) {
    return rejectedTransition(
      "transition_is_noop",
      `already in mode ${from} — a no-op change must not be recorded as a migration step`,
      from,
      to,
    );
  }

  const direction: ModeTransitionDirection = toRank > fromRank ? "advance" : "regress";
  const rungs = Math.abs(toRank - fromRank);

  if (direction === "advance" && rungs > 1 && !allowSkip) {
    return rejectedTransition(
      "transition_skips_rungs",
      `${from} → ${to} skips ${rungs - 1} rung(s); pass allow_skip: true to acknowledge that the skipped phase's evidence will not exist`,
      from,
      to,
    );
  }

  // A regression is always permitted with a reason — rollback must never be
  // harder than the thing it undoes. The reason is what makes it auditable.
  return Object.freeze({
    schema_version: RESOLVER_MODE_OUTCOME_SCHEMA,
    status: "allowed" as const,
    from,
    to,
    direction,
    rungs,
    reason,
  });
}

// NOT re-exported on purpose. `CAPABILITY_RESOLVER_MODES`,
// `CAPABILITY_RESOLVER_MODE_DEFAULT` and `CAPABILITY_RESOLVER_MODE_AFTER_F7` are
// owned by `src/modules/config/workflows/config-defaults.ts`; import them from
// there. Re-exporting them here would make the same names reachable through two
// `export *` stars, and an ambiguous star export is silently DROPPED rather than
// duplicated — a consumer that star-exports both modules would lose the ladder
// entirely, with no error anywhere.
//
// The shipped default is `legacy` pending F7; `..._AFTER_F7` is `observe`. This
// file deliberately does not decide or flip that.
