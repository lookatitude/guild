/**
 * src/modules/lifecycle/workflows/neutral-runtime-contracts.ts
 *
 * `guild.runtime.contracts.v1` — the host-neutral typed contract vocabulary.
 *
 * MH-02 / W1 of the `multi-host-runtime-convergence` initiative. Provider
 * boundary: `host-neutral-core`. Consumers per the MH-01A boundary contract:
 * host-runtime-facade, host-adapters, execution-transports,
 * artifact-document-services, knowledge-facing-services, observability.
 *
 * WHAT THIS FILE IS
 *   The closed vocabularies and the single strict constructor for every typed
 *   runtime result the core emits. Typed records are the machine truth (BR-10);
 *   HTML, Markdown, hook stdout, and wrapper stdout are not.
 *
 * WHAT THIS FILE IS NOT
 *   It is not a host adapter, hook, wrapper, launcher, transport, benchmark, or
 *   website surface, and it reaches none of them. This file is a declared member
 *   of the import-closed neutral core (see `neutral-core-boundary.ts`): it has
 *   ZERO imports, including Node builtins, so it cannot perform I/O, read a
 *   clock, or observe a host. That closure is what makes MH-02 acceptance 3
 *   ("core imports no host adapter, hook, wrapper, launcher, PaneAdapter
 *   backend, benchmark, or website implementation") mechanically checkable
 *   instead of asserted.
 *
 * VOCABULARY AUTHORITY — the MH-02-R1-B05 reconciliation
 *   Every closed list below mirrors `guild.conformance_scenarios.v1`
 *   §closed_vocabularies (MH-01C). The two W0 artifacts previously declared
 *   CONTRADICTORY normalized event vocabularies. That contradiction is now
 *   resolved NORMATIVELY in both frozen contract sources, and this file mirrors
 *   the resolution as typed constants (see `NEUTRAL_NORMALIZED_EVENT_VOCABULARY`).
 *
 *   `guild.normalized_event.v2` — the 19-name vocabulary below — is NORMATIVE.
 *   `guild.normalized_event.v1` — the 8-name list the boundary contract used to
 *   carry (`session.resume` / `tool.pre` / `tool.post` / `task.transition` /
 *   `session.stop` + three unchanged names) — is SUPERSEDED.
 *
 *   The selection is evidenced by SHIPPED producer/consumer behaviour, not by
 *   preference:
 *     1. `hooks/hooks.json` ships `TaskCreated` and `TaskCompleted` as two
 *        DISTINCT hook events. v2's `task.dispatch` + `task.collect` normalizes
 *        them losslessly; v1's single `task.transition` collapses two shipped
 *        producers into one name and cannot be inverted.
 *     2. Guild's shipped state model is run-centric (`.guild/runs/<run-id>/`,
 *        `run_id` throughout the lifecycle surface), which v2's `run.resume` /
 *        `run.stop` names correctly and v1's `session.*` does not.
 *     3. Neither vocabulary has any shipped producer literal, so v1 holds no
 *        incumbency claim; and v1 cannot express the `package.*`, `receipt.*`,
 *        `runtime.verify`, or `migration.*` events the other 26 frozen scenarios
 *        require.
 *
 *   Because v1 → v2 is a PARTIAL function (`task.transition` is ambiguous) the
 *   compatibility semantics are machine-readable rather than guessed: see
 *   `mapLegacyNeutralEventName`, which returns a typed decision per legacy name
 *   instead of silently picking a replacement. MH-03 binds host-native events to
 *   the v2 list.
 *
 * There is no usable CLI here — this is a pure library module. It is reached
 * through the lifecycle module's public entrypoint (`src/modules/lifecycle`).
 */

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

export const NEUTRAL_CONTRACTS_SCHEMA_VERSION = "guild.runtime.contracts.v1";

/** Contract MAJOR. A consumer pinned to a different major must refuse, not downgrade. */
export const NEUTRAL_CONTRACT_VERSION = 1;

// ---------------------------------------------------------------------------
// Closed vocabularies
// ---------------------------------------------------------------------------

/** The six canonical lifecycle phases. */
export const NEUTRAL_LIFECYCLE_PHASES = Object.freeze(["init", "ideate", "plan", "build", "qa", "ops"] as const);
export type NeutralLifecyclePhase = (typeof NEUTRAL_LIFECYCLE_PHASES)[number];

/** Terminal dispositions. Exactly one per typed outcome. */
export const NEUTRAL_DISPOSITIONS = Object.freeze([
  "succeeded",
  "refused",
  "unsupported",
  "failed",
  "degraded",
] as const);
export type NeutralDisposition = (typeof NEUTRAL_DISPOSITIONS)[number];

/**
 * Observation states. BR-07: an absent or untrustworthy observation MUST NOT be
 * read as success, cleanliness, support, or conformance.
 */
export const NEUTRAL_OBSERVATION_STATES = Object.freeze([
  "checked_clean",
  "not_applicable",
  "not_observed",
  "observation_failed",
] as const);
export type NeutralObservationState = (typeof NEUTRAL_OBSERVATION_STATES)[number];

/** The ten typed outcome envelopes. */
export const NEUTRAL_OUTCOME_TYPES = Object.freeze([
  "guild.lifecycle_outcome.v1",
  "guild.normalized_event_outcome.v1",
  "guild.support_transition_outcome.v1",
  "guild.capability_outcome.v1",
  "guild.policy_outcome.v1",
  "guild.receipt_outcome.v1",
  "guild.reconciliation_outcome.v1",
  "guild.boundary_outcome.v1",
  "guild.migration_outcome.v1",
  "guild.version_compatibility_outcome.v1",
] as const);
export type NeutralOutcomeType = (typeof NEUTRAL_OUTCOME_TYPES)[number];

/**
 * Normalized event names. The core OWNS this vocabulary; host adapters (MH-03)
 * own native→normalized binding, and execution transports (MH-04) own transport
 * facts. `receipt.append` / `receipt.reconcile` appear here because the
 * vocabulary is core-owned — their DURABILITY, ordering, and reconciliation
 * semantics belong to W1/MH-06 and are not implemented by this core.
 */
export const NEUTRAL_EVENT_NAMES = Object.freeze([
  "session.start",
  "prompt.submit",
  "tool.before",
  "tool.after",
  "context.compact",
  "task.dispatch",
  "task.collect",
  "run.resume",
  "run.stop",
  "package.render",
  "package.install",
  "package.activate",
  "package.update",
  "runtime.verify",
  "receipt.append",
  "receipt.reconcile",
  "migration.shadow",
  "migration.cutover",
  "migration.rollback",
] as const);
export type NeutralEventName = (typeof NEUTRAL_EVENT_NAMES)[number];

/** The six orthogonal support-evidence dimensions. Never collapse them. */
export const NEUTRAL_SUPPORT_STATES = Object.freeze([
  "recognized",
  "rendered",
  "installed",
  "activated",
  "updated",
  "conformant",
] as const);
export type NeutralSupportState = (typeof NEUTRAL_SUPPORT_STATES)[number];

/** Per-dimension status. `not_evaluated` is not a soft `satisfied`. */
export const NEUTRAL_SUPPORT_STATUS_VALUES = Object.freeze([
  "not_evaluated",
  "unsupported",
  "failed",
  "satisfied",
] as const);
export type NeutralSupportStatus = (typeof NEUTRAL_SUPPORT_STATUS_VALUES)[number];

/** Conformance scenario categories. */
export const NEUTRAL_SCENARIO_CATEGORIES = Object.freeze([
  "lifecycle",
  "normalized_event",
  "support_state",
  "unsupported_refusal",
  "receipt_integrity",
  "module_boundary",
  "strangler_migration",
  "version_drift",
] as const);
export type NeutralScenarioCategory = (typeof NEUTRAL_SCENARIO_CATEGORIES)[number];

/**
 * Reason codes. Every non-succeeded outcome carries exactly one, so a caller can
 * always tell UNSUPPORTED (capability absent) from REFUSED (policy or gate said
 * no) from FAILED (it was tried and could not be trusted). There is deliberately
 * no undifferentiated `supported` / `ok` code.
 */
export const NEUTRAL_REASON_CODES = Object.freeze([
  // lifecycle + gate
  "gate_unsatisfied",
  "unknown_event",
  "unknown_phase",
  "unknown_observation_state",
  "unknown_terminal_state",
  "run_already_closed",
  "capability_snapshot_mismatch",
  "required_observation_missing",
  "required_observation_failed",
  "required_gate_outcome_missing",
  // capability + policy
  "capability_absent",
  "authentication_failed",
  "policy_denied",
  "approval_required",
  // admission (MH-02-R1-B01): the lifecycle path decides, it never trusts a verdict
  "admission_context_missing",
  // one-snapshot-per-run (MH-02-R2-B01): the snapshot a decision is EVALUATED
  // against and the snapshot the run is BOUND to must be the same snapshot, or
  // no outcome from that run can be attributed to a capability truth at all.
  "admission_context_snapshot_mismatch",
  "execution_failed",
  // not-applicable rule binding (MH-02-R1-B02)
  "not_applicable_rule_missing",
  "not_applicable_rule_unknown",
  "not_applicable_rule_mismatch",
  // normalized-event vocabulary compatibility (MH-02-R1-B05)
  "event_vocabulary_superseded",
  "event_vocabulary_ambiguous",
  // support + conformance
  "support_precondition_unproven",
  "support_operation_failed",
  "scenario_evidence_incomplete",
  "scenario_result_mismatch",
  "scenario_registry_invalid",
  // conformance evidence binding (MH-02-R1-B04)
  "scenario_suite_version_mismatch",
  "scenario_required_set_mismatch",
  "scenario_results_unordered",
  "scenario_receipt_reference_missing",
  "scenario_runtime_binding_mismatch",
  "scenario_evidence_stale",
  // conformance evidence integrity (MH-02-R2-B03): nominal metadata is not
  // evidence. Each code names exactly which forgery the decision caught.
  "scenario_reason_code_unrecognized",
  "scenario_receipt_reference_ambiguous",
  "scenario_contract_version_unrecognized",
  "scenario_runtime_version_unrecognized",
  // source-bound conformance evidence (MH-02-R3-B02): a self-consistent bundle
  // of caller-authored labels is not evidence of anything. Promotion requires an
  // AUTHORITATIVE input the claimant does not author, identities the core
  // RECOGNIZES rather than merely parses, and receipt references BOUND by a
  // commitment to that authority instead of merely shaped like references. The
  // commitment is a deterministic UNKEYED digest, NOT a cryptographic MAC — see
  // `neutralReceiptReference`, which states that limit where the code is.
  "scenario_evidence_authority_missing",
  "scenario_identity_binding_mismatch",
  "scenario_source_identity_unrecognized",
  "scenario_host_identity_unrecognized",
  "scenario_receipt_binding_unverified",
  // journal-bound conformance evidence (MH-02-R4-B02): round 4's authority
  // carried an identity, a journal NAME, and a numeric range — no entries. So the
  // decision recomputed every commitment from the claimant's own package and two
  // caller-authored objects agreeing promoted `conformant=true`. Promotion now
  // requires a chain-linked, gap-free journal whose per-entry commitments are
  // TRANSPORTED and compared against the package, a quorum of distinct recognized
  // attestors over its root, and a claimant that is none of them.
  "scenario_journal_chain_unverified",
  "scenario_journal_attestation_insufficient",
  "scenario_claimant_not_independent",
  // independently anchored conformance authority (MH-02-R5-B01): rounds 3, 4 and
  // 5 all bound the evidence to itself more tightly and all left the same hole —
  // every value the decision compared was derivable from public data, so one
  // party supplying the package, the journal, the commitments, the attestor
  // names, and the authority still promoted. An attestation is now a SIGNATURE
  // verified against a verification key pinned in this core, which is the one
  // input a claimant cannot author. This code names a quorum that failed that
  // verification, as distinct from one that was merely malformed.
  "scenario_attestation_signature_unverified",
  // core boundary
  "boundary_forbidden_edge",
  "boundary_unclassified_edge",
  "boundary_membership_mismatch",
  // import closure fails closed (MH-02-R2-B02): an edge whose destination
  // cannot be RESOLVED, and a source whose lexing is ambiguous in a way that
  // could hide an edge, are both "closure unproven" — never "closure proven".
  "boundary_unresolved_edge",
  "boundary_ambiguous_source",
  // capability closure (MH-02-R3-B01): module edges are not the only way out of
  // the core. A call the scan cannot reduce to a named destination, and a
  // reference to an ambient binding the core neither declares nor imports, each
  // reach code the closure argument never covered.
  "boundary_indirect_callee",
  "boundary_ambient_capability",
  // capability PROVENANCE (MH-02-R4-B01): recognizing a call SHAPE is not
  // recognizing a capability. Round 4 rejected `x["k"](…)` only when the `]` was
  // immediately followed by the call parenthesis, so binding the same computed
  // value to a local first — `const load = module["require"].bind(module)` — and
  // calling the local passed with zero findings. Two codes close that: a REACH is
  // the point where a capability enters the file (a computed access whose base is
  // not a clean local or pure intrinsic, or a walk up the prototype chain), and an
  // ALIAS is any later use of a value that flowed from one.
  "boundary_capability_reach",
  "boundary_capability_alias",
  // strangler-migration cutover (A21-8 / W4/MH-08): a shadow record whose
  // candidate outcome diverges from legacy is a typed refusal, never a
  // selection change — this is the one code that names that refusal.
  "migration_shadow_divergence",
  // release/version-drift evidence (A21-9 / W5/MH-09): the three typed
  // version-drift outcomes the frozen contract requires for MHRC-VER-001..003.
  // Drift in any bound evidence-identity field invalidates a prior verdict
  // (refused), a pinned consumer on a different contract major is unsupported
  // rather than silently downgraded, and an expected package/runtime that
  // disagrees with independent runtime discovery is a typed failure.
  "evidence_version_drift",
  "contract_major_mismatch",
  "package_runtime_mismatch",
] as const);
export type NeutralReasonCode = (typeof NEUTRAL_REASON_CODES)[number];

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

function includes(list: readonly string[], value: unknown): boolean {
  return typeof value === "string" && list.indexOf(value) !== -1;
}

export function isNeutralLifecyclePhase(value: unknown): value is NeutralLifecyclePhase {
  return includes(NEUTRAL_LIFECYCLE_PHASES, value);
}

export function isNeutralDisposition(value: unknown): value is NeutralDisposition {
  return includes(NEUTRAL_DISPOSITIONS, value);
}

export function isNeutralObservationState(value: unknown): value is NeutralObservationState {
  return includes(NEUTRAL_OBSERVATION_STATES, value);
}

export function isNeutralOutcomeType(value: unknown): value is NeutralOutcomeType {
  return includes(NEUTRAL_OUTCOME_TYPES, value);
}

export function isNeutralEventName(value: unknown): value is NeutralEventName {
  return includes(NEUTRAL_EVENT_NAMES, value);
}

export function isNeutralSupportState(value: unknown): value is NeutralSupportState {
  return includes(NEUTRAL_SUPPORT_STATES, value);
}

export function isNeutralSupportStatus(value: unknown): value is NeutralSupportStatus {
  return includes(NEUTRAL_SUPPORT_STATUS_VALUES, value);
}

export function isNeutralScenarioCategory(value: unknown): value is NeutralScenarioCategory {
  return includes(NEUTRAL_SCENARIO_CATEGORIES, value);
}

export function isNeutralReasonCode(value: unknown): value is NeutralReasonCode {
  return includes(NEUTRAL_REASON_CODES, value);
}

/**
 * True only for observation states that permit a clean close. `not_observed` and
 * `observation_failed` are never clean (BR-07 / CI-05).
 */
export function isNeutralCleanObservation(value: unknown): boolean {
  return value === "checked_clean" || value === "not_applicable";
}

// ---------------------------------------------------------------------------
// Deterministic canonicalization + fingerprinting (no crypto, no clock)
// ---------------------------------------------------------------------------

/**
 * Canonical JSON: object keys sorted, `undefined`-valued keys dropped so an
 * absent key and an explicitly-undefined key canonicalize identically. Array
 * order is significant and preserved.
 */
export function neutralCanonicalJson(value: unknown): string {
  if (value === null) return "null";
  const kind = typeof value;
  if (kind === "number") return Number.isFinite(value as number) ? JSON.stringify(value) : "null";
  if (kind === "boolean" || kind === "string") return JSON.stringify(value);
  if (kind === "undefined" || kind === "function" || kind === "symbol") return "null";
  if (Array.isArray(value)) {
    return `[${value.map((item) => neutralCanonicalJson(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const parts: string[] = [];
  for (const key of Object.keys(record).sort()) {
    if (record[key] === undefined) continue;
    parts.push(`${JSON.stringify(key)}:${neutralCanonicalJson(record[key])}`);
  }
  return `{${parts.join(",")}}`;
}

function fnv1a32(input: string, seed: number): number {
  let hash = seed >>> 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash ^ input.charCodeAt(i)) >>> 0;
    // hash *= 16777619, in 32-bit shift-add form to stay exact in JS numbers.
    hash =
      (((hash << 1) >>> 0) +
        ((hash << 4) >>> 0) +
        ((hash << 7) >>> 0) +
        ((hash << 8) >>> 0) +
        ((hash << 24) >>> 0) +
        hash) >>>
      0;
  }
  return hash >>> 0;
}

function hex8(value: number): string {
  let out = (value >>> 0).toString(16);
  while (out.length < 8) out = `0${out}`;
  return out;
}

/**
 * Versioned, fixed-width, pure fingerprint over the canonical form. Used for
 * pre/post-state equality and cross-host equivalence comparison. Deliberately
 * NOT a cryptographic digest: importing `crypto` would break core import
 * closure, and this value proves equivalence, not integrity.
 */
export function neutralFingerprint(value: unknown): string {
  const canonical = neutralCanonicalJson(value);
  return `nfp1:${hex8(fnv1a32(canonical, 0x811c9dc5))}${hex8(fnv1a32(canonical, 0x01000193))}`;
}

// ---------------------------------------------------------------------------
// Collision-resistant digest (still no imports, no clock, no I/O)
// ---------------------------------------------------------------------------

/**
 * SHA-256, implemented natively (MH-02-R5-B01).
 *
 * WHY THIS EXISTS AND WHY IT IS NOT AN IMPORT
 *   Rounds 3, 4, and 5 all ended at the same wall: the core could bind evidence
 *   to itself, but it could not tell an OBSERVED attestation from a fabricated
 *   one, so a claimant holding every input still promoted. Telling those apart
 *   needs public-key verification, and verification needs a collision-resistant
 *   digest. `neutralFingerprint` is a 64-bit FNV-1a — fine for equality, useless
 *   under an adversary, since preimages are algebraically cheap.
 *
 *   The standing objection to closing that gap was "the core cannot import
 *   `crypto`". That is true and it is not the obstacle: IMPORTING a hash and
 *   COMPUTING one are different acts. This function performs no I/O, reads no
 *   clock, holds no host handle, and imports nothing — it is pure arithmetic on
 *   the input string, so core import closure (MH-02 acceptance 3) is untouched.
 *
 * WHAT IT IS
 *   FIPS 180-4 SHA-256 over the UTF-8 encoding of `input`, returned as 64
 *   lowercase hex characters. The focused suite pins the published NIST vectors
 *   and a multi-block, non-ASCII, and surrogate-pair vector, so a transcription
 *   error in the round constants cannot pass as a working digest.
 */
const NEUTRAL_SHA256_K: readonly number[] = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

const NEUTRAL_SHA256_INIT: readonly number[] = [
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
];

function rotr32(value: number, bits: number): number {
  return ((value >>> bits) | (value << (32 - bits))) >>> 0;
}

/** UTF-8 bytes of a JavaScript string, surrogate pairs included. */
function utf8Bytes(input: string): number[] {
  const bytes: number[] = [];
  for (let index = 0; index < input.length; index += 1) {
    let code = input.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff && index + 1 < input.length) {
      const low = input.charCodeAt(index + 1);
      if (low >= 0xdc00 && low <= 0xdfff) {
        code = 0x10000 + (code - 0xd800) * 0x400 + (low - 0xdc00);
        index += 1;
      }
    }
    if (code < 0x80) {
      bytes.push(code);
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >>> 6), 0x80 | (code & 0x3f));
    } else if (code < 0x10000) {
      bytes.push(0xe0 | (code >>> 12), 0x80 | ((code >>> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      bytes.push(
        0xf0 | (code >>> 18),
        0x80 | ((code >>> 12) & 0x3f),
        0x80 | ((code >>> 6) & 0x3f),
        0x80 | (code & 0x3f)
      );
    }
  }
  return bytes;
}

export function neutralSha256Hex(input: string): string {
  const bytes = utf8Bytes(input);
  const bitLength = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  // 64-bit big-endian length, split so the high half stays exact past 2^32 bits.
  const high = Math.floor(bitLength / 0x100000000);
  const low = bitLength >>> 0;
  bytes.push(
    (high >>> 24) & 0xff,
    (high >>> 16) & 0xff,
    (high >>> 8) & 0xff,
    high & 0xff,
    (low >>> 24) & 0xff,
    (low >>> 16) & 0xff,
    (low >>> 8) & 0xff,
    low & 0xff
  );

  const state = [...NEUTRAL_SHA256_INIT];
  const schedule: number[] = [];
  for (let block = 0; block < bytes.length; block += 64) {
    for (let word = 0; word < 16; word += 1) {
      const at = block + word * 4;
      schedule[word] =
        ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0;
    }
    for (let word = 16; word < 64; word += 1) {
      const s0 =
        (rotr32(schedule[word - 15], 7) ^ rotr32(schedule[word - 15], 18) ^ (schedule[word - 15] >>> 3)) >>> 0;
      const s1 =
        (rotr32(schedule[word - 2], 17) ^ rotr32(schedule[word - 2], 19) ^ (schedule[word - 2] >>> 10)) >>> 0;
      schedule[word] = (schedule[word - 16] + s0 + schedule[word - 7] + s1) >>> 0;
    }
    let a = state[0];
    let b = state[1];
    let c = state[2];
    let d = state[3];
    let e = state[4];
    let f = state[5];
    let g = state[6];
    let h = state[7];
    for (let round = 0; round < 64; round += 1) {
      const S1 = (rotr32(e, 6) ^ rotr32(e, 11) ^ rotr32(e, 25)) >>> 0;
      const ch = ((e & f) ^ (~e & g)) >>> 0;
      const temp1 = (h + S1 + ch + NEUTRAL_SHA256_K[round] + schedule[round]) >>> 0;
      const S0 = (rotr32(a, 2) ^ rotr32(a, 13) ^ rotr32(a, 22)) >>> 0;
      const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
      const temp2 = (S0 + maj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    state[0] = (state[0] + a) >>> 0;
    state[1] = (state[1] + b) >>> 0;
    state[2] = (state[2] + c) >>> 0;
    state[3] = (state[3] + d) >>> 0;
    state[4] = (state[4] + e) >>> 0;
    state[5] = (state[5] + f) >>> 0;
    state[6] = (state[6] + g) >>> 0;
    state[7] = (state[7] + h) >>> 0;
  }
  return state.map((word) => hex8(word)).join("");
}

/**
 * A collision-resistant digest over the canonical form of a value.
 *
 * Same canonicalization as `neutralFingerprint`, a real digest instead of a
 * 64-bit fingerprint. Use this wherever an ADVERSARY chooses the input;
 * `neutralFingerprint` remains correct for equality comparison between values
 * the core itself produced.
 */
export function neutralCanonicalDigest(value: unknown): string {
  return neutralSha256Hex(neutralCanonicalJson(value));
}

// ---------------------------------------------------------------------------
// Typed outcome
// ---------------------------------------------------------------------------

/**
 * Evidence bindings an outcome carries. Which subset is REQUIRED is decided by
 * the scenario's evidence profile, not by this constructor.
 */
export interface NeutralOutcomeBinding {
  readonly run_id?: string;
  readonly operation_id?: string;
  readonly correlation_id?: string;
  readonly scenario_id?: string;
  readonly host_id?: string;
  readonly host_version?: string;
  readonly runtime_version?: string;
  readonly capability_snapshot_hash?: string;
  readonly contract_version?: number;
}

export interface NeutralOutcome {
  readonly schema_version: typeof NEUTRAL_CONTRACTS_SCHEMA_VERSION;
  readonly type: NeutralOutcomeType;
  readonly disposition: NeutralDisposition;
  /** Exactly one reason code for every non-succeeded disposition; null otherwise. */
  readonly reason_code: NeutralReasonCode | null;
  readonly assertions: readonly string[];
  readonly binding: NeutralOutcomeBinding;
  readonly facts: Readonly<Record<string, unknown>>;
}

export interface NeutralOutcomeInput {
  readonly type: NeutralOutcomeType;
  readonly disposition: NeutralDisposition;
  readonly reason_code?: NeutralReasonCode | null;
  readonly assertions?: readonly string[];
  readonly binding?: NeutralOutcomeBinding;
  readonly facts?: Readonly<Record<string, unknown>>;
}

/**
 * Freeze a value and everything it transitively owns. Exported for core reuse.
 *
 * DELIBERATELY DUPLICATED from `src/modules/kernel/workflows/sealed-collections.ts`, and
 * deliberately WEAKER than it. This file is a declared member of the IMPORT-CLOSED
 * neutral core: zero imports, and — per `neutral-core-boundary.ts` — no ambient binding
 * outside `NEUTRAL_PURE_INTRINSIC_ROOTS`. That rules out `WeakSet`, `Reflect`,
 * `Object.defineProperty` and `Object.getOwnPropertyDescriptor`, so this copy CANNOT seal
 * a Set or Map (sealing means neutering `add`/`delete`/`clear` as non-writable own
 * properties, which needs `defineProperty`). The trade is deliberate: the core keeps its
 * mechanically-checked capability closure, and the rail enforces the consequence — NO Set
 * or Map may be reachable from a neutral-core export, because freezing one would close
 * nothing while `Object.isFrozen` reported success.
 *
 * The previous implementation guarded recursion with `Object.isFrozen(value)` and bailed
 * out on the first frozen node. That is backwards: a SHALLOW-frozen node reports
 * `isFrozen === true`, so the walk stopped at the boundary and left its children — the
 * mutable half — untouched, which is the very defect it existed to prevent. Recursion is
 * now guarded by a `Set` of visited objects (an intrinsic the core IS allowed) and the
 * walk keeps descending through already-frozen nodes.
 */
export function neutralFreeze<T>(value: T): T {
  const seen = new Set<unknown>();
  const walk = (node: unknown): void => {
    if (node === null || typeof node !== "object") return;
    if (seen.has(node)) return;
    seen.add(node);
    if (node instanceof RegExp) {
      // Freezing a global/sticky pattern makes `.exec()`/`.test()` throw on the
      // `lastIndex` write; freezing any other pattern is always safe.
      if (!node.global && !node.sticky) Object.freeze(node);
      return;
    }
    if (node instanceof Set || node instanceof Map) {
      // ROUND-1 P2 #6. This copy cannot SEAL a Set or Map, so it used to fall through to
      // `Object.freeze` — which closes nothing while `Object.isFrozen` reports `true`.
      // That is the exact false green the whole rail exists to catch, and it was reachable
      // through `neutralOutcome({ facts: { allowed: new Set([...]) } })`: the caller kept a
      // live reference and could `clear()`/`add()` the "machine truth" afterwards. The
      // prohibition on Sets in the neutral core was enforced only over STATIC `NEUTRAL_*`
      // exports, so nothing constrained a value handed in at runtime.
      //
      // Refusing is the honest move and needs no capability this core lacks: it makes the
      // unrepresentable case a loud error at construction instead of a silent one at use.
      throw new TypeError(
        "neutralFreeze: refusing to 'freeze' a Set/Map — freeze does not close membership, " +
          "and the neutral core cannot build a sealed facade. Pass a frozen array or a plain " +
          "record instead (outside the core, use sealSet()/sealMap()).",
      );
    }
    Object.freeze(node);
    // ENUMERABLE OWN STRING KEYS ONLY, and read by [[Get]] — which INVOKES getters.
    //
    // This is the residue of round-1 P2 #6 that CANNOT be closed here, and the reason is
    // mechanical rather than an oversight. Reaching a symbol-keyed or non-enumerable child
    // needs `Object.getOwnPropertySymbols` / `getOwnPropertyNames`, and avoiding the getter
    // invocation needs `Object.getOwnPropertyDescriptor` — all three are in
    // `NEUTRAL_REFLECTION_METHOD_NAMES`, which `neutral-core-boundary.ts` rejects as a
    // `reflection_call_reach`. Using them turns the core's import closure RED. The core's
    // mechanically-checked capability closure is the stronger property, so the divergence
    // from the kernel primitive stays, and the rail PINS it by name and by shape rather
    // than leaving it as an unstated gap. Do not "fix" this without moving the boundary.
    for (const key of Object.keys(node as Record<string, unknown>)) {
      walk((node as Record<string, unknown>)[key]);
    }
  };
  walk(value);
  return value;
}

/**
 * The ONLY way the core produces a typed result. Refuses to build a record that
 * would be ambiguous: a `succeeded` outcome may not carry a reason code, and a
 * non-`succeeded` outcome may not omit one. That is what stops "missing,
 * unsupported, failed, stale, satisfied" from collapsing into one value.
 */
export function neutralOutcome(input: NeutralOutcomeInput): NeutralOutcome {
  if (!isNeutralOutcomeType(input.type)) {
    throw new Error(`neutralOutcome: unknown outcome type ${JSON.stringify(input.type)}`);
  }
  if (!isNeutralDisposition(input.disposition)) {
    throw new Error(`neutralOutcome: unknown disposition ${JSON.stringify(input.disposition)}`);
  }
  const reason = input.reason_code === undefined ? null : input.reason_code;
  if (input.disposition === "succeeded") {
    if (reason !== null) {
      throw new Error(
        `neutralOutcome: disposition "succeeded" must not carry a reason_code (got ${JSON.stringify(reason)})`
      );
    }
  } else {
    if (reason === null) {
      throw new Error(
        `neutralOutcome: disposition ${JSON.stringify(input.disposition)} requires a reason_code`
      );
    }
    if (!isNeutralReasonCode(reason)) {
      throw new Error(`neutralOutcome: unknown reason code ${JSON.stringify(reason)}`);
    }
  }

  return neutralFreeze({
    schema_version: NEUTRAL_CONTRACTS_SCHEMA_VERSION,
    type: input.type,
    disposition: input.disposition,
    reason_code: reason,
    assertions: [...(input.assertions ?? [])],
    binding: {
      ...(input.binding ?? {}),
      contract_version: input.binding?.contract_version ?? NEUTRAL_CONTRACT_VERSION,
    },
    facts: { ...(input.facts ?? {}) },
  }) as NeutralOutcome;
}

// ---------------------------------------------------------------------------
// Normalized-event vocabulary: normative version + machine-readable compatibility
// (the MH-02-R1-B05 reconciliation)
// ---------------------------------------------------------------------------

/** How a superseded (v1) event name relates to the normative (v2) vocabulary. */
export const NEUTRAL_EVENT_COMPATIBILITY_KINDS = Object.freeze([
  "unchanged",
  "renamed",
  "ambiguous_split",
] as const);
export type NeutralEventCompatibilityKind = (typeof NEUTRAL_EVENT_COMPATIBILITY_KINDS)[number];

export interface NeutralEventCompatibilityRule {
  readonly from: string;
  /** The single normative replacement, or `null` when no lossless one exists. */
  readonly to: string | null;
  readonly kind: NeutralEventCompatibilityKind;
  /** Populated only for `ambiguous_split`: the candidates that cannot be chosen between. */
  readonly candidates: readonly string[];
}

/**
 * The v1 → v2 mapping, stated per legacy name. It is deliberately a PARTIAL
 * function: `task.transition` has two normative images and therefore NO lossless
 * mapping, which is recorded as `ambiguous_split` rather than resolved by guess.
 */
export const NEUTRAL_EVENT_COMPATIBILITY_RULES: readonly NeutralEventCompatibilityRule[] = neutralFreeze([
  { from: "session.start", to: "session.start", kind: "unchanged", candidates: [] },
  { from: "prompt.submit", to: "prompt.submit", kind: "unchanged", candidates: [] },
  { from: "context.compact", to: "context.compact", kind: "unchanged", candidates: [] },
  { from: "session.resume", to: "run.resume", kind: "renamed", candidates: [] },
  { from: "tool.pre", to: "tool.before", kind: "renamed", candidates: [] },
  { from: "tool.post", to: "tool.after", kind: "renamed", candidates: [] },
  { from: "session.stop", to: "run.stop", kind: "renamed", candidates: [] },
  {
    from: "task.transition",
    to: null,
    kind: "ambiguous_split",
    candidates: ["task.dispatch", "task.collect"],
  },
]);

/** The superseded 8-name list, exactly as `guild.normalized_event.v1` declared it. */
export const NEUTRAL_SUPERSEDED_EVENT_NAMES_V1 = Object.freeze([
  "session.start",
  "session.resume",
  "prompt.submit",
  "tool.pre",
  "tool.post",
  "context.compact",
  "task.transition",
  "session.stop",
] as const);

/**
 * v2 names with NO v1 preimage at all. A name reachable only as an ambiguous
 * `candidate` (`task.dispatch`, `task.collect`) is deliberately NOT counted as
 * introduced: it has a v1 preimage, just not an invertible one.
 */
export const NEUTRAL_EVENT_NAMES_INTRODUCED_IN_V2: readonly string[] = Object.freeze(NEUTRAL_EVENT_NAMES.filter(
  (name) =>
    !NEUTRAL_EVENT_COMPATIBILITY_RULES.some(
      (rule) => rule.to === name || rule.candidates.indexOf(name) !== -1
    )
));

/**
 * The shared normative block. This object is mirrored BYTE-FOR-BYTE by the
 * `normalized_event_vocabulary` key in BOTH frozen W0 contract artifacts. It is
 * declared natively here — the plugin never imports umbrella source — and the
 * focused tests prove field equality against both artifacts read as data.
 */
export const NEUTRAL_NORMALIZED_EVENT_VOCABULARY = neutralFreeze({
  block_id: "guild.normalized_event_vocabulary.v1",
  normative_version: "guild.normalized_event.v2",
  reconciles: "MH-02-R1-B05",
  vocabulary_owner: "host-neutral-core",
  native_mapping_owner: "host-adapters",
  transport_fact_owner: "execution-transports",
  consumer: "host-neutral-core",
  normative_event_names: [...NEUTRAL_EVENT_NAMES],
  superseded_versions: [
    {
      version: "guild.normalized_event.v1",
      status: "superseded",
      superseded_by: "guild.normalized_event.v2",
      event_types: [...NEUTRAL_SUPERSEDED_EVENT_NAMES_V1],
    },
  ],
  compatibility: {
    policy: "explicit_typed_mapping",
    mapping_totality: "partial",
    superseded_disposition: "refused",
    superseded_reason_code: "event_vocabulary_superseded",
    ambiguous_disposition: "refused",
    ambiguous_reason_code: "event_vocabulary_ambiguous",
    unmapped_disposition: "refused",
    unmapped_reason_code: "unknown_event",
    rules: NEUTRAL_EVENT_COMPATIBILITY_RULES.map((rule) => ({
      from: rule.from,
      to: rule.to,
      kind: rule.kind,
      candidates: [...rule.candidates],
    })),
    introduced_in_v2: [...NEUTRAL_EVENT_NAMES_INTRODUCED_IN_V2],
  },
});

/**
 * Decide what a SUPERSEDED event name means under the normative vocabulary.
 *
 * Every answer is typed, and none of them is "quietly use the replacement". A
 * name with a lossless image is refused WITH that image named, so an adapter is
 * told exactly what to send; `task.transition` is refused as ambiguous with both
 * candidates named, because choosing one would be the silent guess the frozen
 * contract's rule 3 forbids.
 */
export function mapLegacyNeutralEventName(name: unknown): NeutralOutcome {
  // The three `unchanged` names are members of BOTH versions. A name that is
  // already normative is not legacy at all, so it resolves to itself and is
  // accepted — checking this FIRST is what stops `session.start` from being
  // reported as superseded merely because it also existed in v1.
  if (isNeutralEventName(name)) {
    return neutralOutcome({
      type: "guild.version_compatibility_outcome.v1",
      disposition: "succeeded",
      assertions: ["the submitted name is already a normative event name"],
      facts: {
        submitted_event_name: name,
        normative_version: "guild.normalized_event.v2",
        normative_event_name: name,
        candidates: [],
        compatibility_kind: "unchanged",
      },
    });
  }

  const rule = NEUTRAL_EVENT_COMPATIBILITY_RULES.find((candidate) => candidate.from === name);

  if (rule === undefined) {
    return neutralOutcome({
      type: "guild.version_compatibility_outcome.v1",
      disposition: "refused",
      reason_code: "unknown_event",
      assertions: [
        "the normalized event vocabulary is closed",
        "the event is not silently skipped",
      ],
      facts: {
        submitted_event_name: name ?? null,
        normative_version: "guild.normalized_event.v2",
        in_normative_vocabulary: isNeutralEventName(name),
      },
    });
  }

  if (rule.kind === "ambiguous_split") {
    return neutralOutcome({
      type: "guild.version_compatibility_outcome.v1",
      disposition: "refused",
      reason_code: "event_vocabulary_ambiguous",
      assertions: [
        "a superseded name with two normative images has no lossless mapping",
        "the core refuses rather than choosing a replacement",
      ],
      facts: {
        submitted_event_name: rule.from,
        superseded_version: "guild.normalized_event.v1",
        normative_version: "guild.normalized_event.v2",
        normative_event_name: null,
        candidates: [...rule.candidates],
        compatibility_kind: rule.kind,
      },
    });
  }

  return neutralOutcome({
    type: "guild.version_compatibility_outcome.v1",
    disposition: "refused",
    reason_code: "event_vocabulary_superseded",
    assertions: [
      "the submitted name belongs to a superseded vocabulary version",
      "its single normative replacement is named, and no substitution is performed",
    ],
    facts: {
      submitted_event_name: rule.from,
      superseded_version: "guild.normalized_event.v1",
      normative_version: "guild.normalized_event.v2",
      normative_event_name: rule.to,
      candidates: [],
      compatibility_kind: rule.kind,
    },
  });
}
