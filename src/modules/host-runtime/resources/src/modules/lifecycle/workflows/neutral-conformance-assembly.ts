/**
 * src/modules/lifecycle/workflows/neutral-conformance-assembly.ts
 *
 * A21-S — the owner-packet assembly spine.
 *
 * WHAT THIS FILE IS
 *   The frozen scenario suite pins 31 scenarios across SIX owners. Five of them
 *   (W1/MH-02) are declared and evaluated by `neutral-conformance-core.ts`; the
 *   other 26 belong to boundaries that will hand their results over as evidence
 *   PACKETS. This module is the join: it takes one packet per owner, proves each
 *   packet is the packet that owner was supposed to produce, and emits ONE
 *   ordered 31-scenario aggregate in the shape the MH-02 promotion decision
 *   consumes.
 *
 *   The only thing that makes such an aggregate honest is that the required
 *   tuple, its ORDER, and the owner/count map are SOURCE-OWNED constants no
 *   caller can supply, shrink, reorder, or mutate — and that a packet lying
 *   about its owner, its ids, its suite, its identity, or the runtime contract
 *   of any single result is REFUSED rather than concatenated. Both properties
 *   are mechanical here, not asserted: the tuple is derived from a closed table
 *   below, and every refusal path names a distinct control on
 *   `outcome.facts.refusal_control`.
 *
 * WHAT THIS FILE IS NOT
 *   It takes NO promotion decision and verifies NO signature or attestation.
 *   The MH-02 decision function still owns promotion and the attestor trust
 *   root; A21-X owns wiring the two together. It also does not EVALUATE any
 *   scenario — an owner's evaluator produces its own packet; this module only
 *   checks that what arrived is well-formed, complete, and attributable.
 *
 *   It deliberately does not re-check the receipt-reference commitment, the
 *   recognized-runtime table, or the attestation quorum. Those are the MH-02
 *   decision's obligations over the assembled package, and duplicating them
 *   here would create a second, drifting copy of the promotion rules. What it
 *   DOES check about a result is only the runtime CONTRACT — that each field is
 *   present and drawn from a vocabulary the core exports — because emitting a
 *   `NeutralConformanceEvidence` that is not that shape is this module's own
 *   defect, not a later boundary's problem (FIC-110 B1).
 *
 * THE REQUEST BOUNDARY IS TEXT (FIC129-B1, FIC129-B2)
 *   Packets and claims arrive from other boundaries, so the request is ONE
 *   CANONICAL JSON STRING — never an object graph. `typeof request === "string"`
 *   is decided before any structural operation runs, so a direct object, array,
 *   proxy, or accessor-bearing input is refused WITHOUT being inspected: no key
 *   is enumerated, no property is read, no property is written, no descriptor is
 *   asked for. That is what makes "this module executes no caller code" a
 *   property of the control flow rather than a hope about which reflection
 *   primitive happens to be trap-free.
 *
 *   The earlier own-data/`[[Set]]`-probe admission could not carry that claim and
 *   FIC-129 proved it twice: `Object.isFrozen` is not an inertness test, so a
 *   frozen record with a non-configurable RETURNING getter was admitted and its
 *   value emitted; and every admission primitive — `Object.keys`, an assignment
 *   through an `Object.create` child, a property read — is a PROXY TRAP, so a
 *   proxied result executed caller code 70 times and planted its own receipt.
 *   Separating those shapes needs `Object.getOwnPropertyDescriptor`, which this
 *   file may not call (it is a `reflection_call_reach` under the core capability
 *   rail), and `util.types.isProxy`, a V8 hook, a reflection exception, or a
 *   WeakSet brand registry would each buy the distinction with a host import or
 *   with state — both of which this core member is defined by not having.
 *
 *   Text has none of those problems. `JSON.parse` of a PRIMITIVE string yields a
 *   fresh ordinary graph by construction: plain objects and arrays, data
 *   properties only, no accessor, no proxy, no inherited contract field, and a
 *   `"__proto__"` member lands as an ordinary own key rather than as a live
 *   prototype slot. The parsed snapshot is then required to re-canonicalize to
 *   the exact bytes that arrived, so what is validated is what was sent and what
 *   is emitted is what was validated. Owner keys are still matched by INDEX into
 *   the source-owned owner tuple rather than used as record keys, so `__proto__`
 *   and `constructor` remain ordinary unattributable strings.
 *
 *   The caller encodes with `neutralCanonicalJson` (the core's own canonical
 *   form). Encoding is the CALLER's act over data the caller owns; this module's
 *   obligation begins at the text.
 *
 * PURITY
 *   A REGISTERED member of the host-neutral core (`NEUTRAL_CORE_MEMBERS` in
 *   `neutral-core-boundary.ts`): its only imports are two other core files, so it
 *   performs no I/O, reads no clock, and holds no host handle. The production
 *   closure evaluator scans this file's actual bytes as a node of the closure, so
 *   the capability rules — no computed access off a base the scan cannot name, no
 *   prototype-chain walk, no reflection call, no indirect callee — bind THIS
 *   source rather than a private restatement of it.
 *
 * Pure library module; there is no CLI entrypoint.
 */

import {
  NEUTRAL_CONTRACT_VERSION,
  NEUTRAL_DISPOSITIONS,
  NEUTRAL_OUTCOME_TYPES,
  NEUTRAL_REASON_CODES,
  neutralCanonicalJson,
  neutralFreeze,
  neutralOutcome,
} from "./neutral-runtime-contracts";
import type { NeutralOutcome, NeutralReasonCode } from "./neutral-runtime-contracts";
import {
  NEUTRAL_CORE_SCENARIOS,
  NEUTRAL_CORE_WAVE_OWNER,
  NEUTRAL_EVIDENCE_FRESHNESS_VERDICTS,
  NEUTRAL_EVIDENCE_IDENTITY_FIELDS,
  NEUTRAL_SCENARIO_SUITE_ID,
  NEUTRAL_SCENARIO_SUITE_VERSION,
} from "./neutral-conformance-core";
import type {
  NeutralConformanceEvidence,
  NeutralEvidenceIdentity,
  NeutralScenarioResult,
} from "./neutral-conformance-core";

// ---------------------------------------------------------------------------
// The closed, source-owned scenario/owner table
// ---------------------------------------------------------------------------

/** One frozen-suite scenario and the production boundary that must evaluate it. */
export interface NeutralScenarioOwnerRegistration {
  readonly stable_id: string;
  readonly owner_key: string;
}

/**
 * The W1/MH-02 owner key is READ off the core's own wave owner rather than
 * re-typed, so the five scenarios this repository already evaluates cannot end
 * up owned by one key in the core and another key here.
 */
const OWNER_MH02 = NEUTRAL_CORE_WAVE_OWNER.key;
const OWNER_MH03 = "W2/MH-03";
const OWNER_MH06 = "W1/MH-06";
const OWNER_MH07 = "W4/MH-07";
const OWNER_MH08 = "W4/MH-08";
const OWNER_MH09 = "W5/MH-09";

/**
 * The 31 stable ids in CONTRACT order, each bound to its owner.
 *
 * Order is a property of the contract, not of the owners: the tuple interleaves
 * owners (the three `MHRC-UNS-*` ids are split across two of them), which is
 * exactly why the required set cannot be reconstructed by concatenating owner
 * packets in arrival order. Every derived constant below comes off this one
 * table, so the tuple, the owner map, and the per-owner counts cannot disagree.
 *
 * These ids are IDENTIFIERS transcribed against the frozen contract, in the same
 * authored-not-imported way `NEUTRAL_CORE_SCENARIOS` transcribes its five. The
 * contract artifact itself is never read: this core performs no I/O, and the
 * focused suite states the same tuple independently, so a drift between the two
 * statements surfaces as a failure rather than as a shared mistake.
 */
const NEUTRAL_SUITE_SCENARIO_OWNERSHIP: readonly NeutralScenarioOwnerRegistration[] = neutralFreeze([
  { stable_id: "MHRC-LIF-001", owner_key: OWNER_MH02 },
  { stable_id: "MHRC-LIF-002", owner_key: OWNER_MH02 },
  { stable_id: "MHRC-LIF-003", owner_key: OWNER_MH02 },
  { stable_id: "MHRC-LIF-004", owner_key: OWNER_MH02 },
  { stable_id: "MHRC-EVT-001", owner_key: OWNER_MH03 },
  { stable_id: "MHRC-EVT-002", owner_key: OWNER_MH03 },
  { stable_id: "MHRC-SUP-001", owner_key: OWNER_MH09 },
  { stable_id: "MHRC-SUP-002", owner_key: OWNER_MH09 },
  { stable_id: "MHRC-SUP-003", owner_key: OWNER_MH09 },
  { stable_id: "MHRC-SUP-004", owner_key: OWNER_MH09 },
  { stable_id: "MHRC-SUP-005", owner_key: OWNER_MH09 },
  { stable_id: "MHRC-SUP-006", owner_key: OWNER_MH09 },
  { stable_id: "MHRC-UNS-001", owner_key: OWNER_MH03 },
  { stable_id: "MHRC-UNS-002", owner_key: OWNER_MH02 },
  { stable_id: "MHRC-UNS-003", owner_key: OWNER_MH03 },
  { stable_id: "MHRC-RCT-001", owner_key: OWNER_MH06 },
  { stable_id: "MHRC-RCT-002", owner_key: OWNER_MH06 },
  { stable_id: "MHRC-RCT-003", owner_key: OWNER_MH06 },
  { stable_id: "MHRC-RCT-004", owner_key: OWNER_MH06 },
  { stable_id: "MHRC-RCT-005", owner_key: OWNER_MH06 },
  { stable_id: "MHRC-MOD-001", owner_key: OWNER_MH07 },
  { stable_id: "MHRC-MOD-002", owner_key: OWNER_MH07 },
  { stable_id: "MHRC-MOD-003", owner_key: OWNER_MH07 },
  { stable_id: "MHRC-MOD-004", owner_key: OWNER_MH07 },
  { stable_id: "MHRC-STR-001", owner_key: OWNER_MH08 },
  { stable_id: "MHRC-STR-002", owner_key: OWNER_MH08 },
  { stable_id: "MHRC-STR-003", owner_key: OWNER_MH08 },
  { stable_id: "MHRC-STR-004", owner_key: OWNER_MH08 },
  { stable_id: "MHRC-VER-001", owner_key: OWNER_MH09 },
  { stable_id: "MHRC-VER-002", owner_key: OWNER_MH09 },
  { stable_id: "MHRC-VER-003", owner_key: OWNER_MH09 },
]);

/** How many scenarios the frozen suite contains. Pinned, never counted at runtime. */
export const NEUTRAL_REQUIRED_SUITE_SCENARIO_COUNT = 31;

/** The six owners, in work-item order. */
export const NEUTRAL_CONFORMANCE_OWNER_KEYS: readonly string[] = neutralFreeze([
  OWNER_MH02,
  OWNER_MH03,
  OWNER_MH06,
  OWNER_MH07,
  OWNER_MH08,
  OWNER_MH09,
]);

/**
 * The REQUIRED tuple: all 31 stable ids, in contract order, immutable.
 *
 * This is the only source of the required set. `assembleNeutralConformanceEvidence`
 * refuses a caller that supplies one of its own — even an identical one — because
 * accepting a matching copy is accepting the channel through which a differing
 * copy could arrive.
 */
export const NEUTRAL_REQUIRED_SUITE_SCENARIO_IDS: readonly string[] = neutralFreeze(
  NEUTRAL_SUITE_SCENARIO_OWNERSHIP.map((registration) => registration.stable_id)
);

/**
 * The owner of `NEUTRAL_REQUIRED_SUITE_SCENARIO_IDS[i]`, positionally.
 *
 * A PARALLEL ARRAY rather than a record keyed by stable id, because every lookup
 * against it is driven by a caller-supplied string: a record would make
 * `__proto__` and `constructor` resolve to live prototype slots instead of to
 * "not a scenario". Positional lookup has no such keys to hit.
 */
const OWNER_KEY_OF_SCENARIO: readonly string[] = neutralFreeze(
  NEUTRAL_SUITE_SCENARIO_OWNERSHIP.map((registration) => registration.owner_key)
);

const ownerScenarioIds: Record<string, string[]> = {};
for (const ownerKey of NEUTRAL_CONFORMANCE_OWNER_KEYS) ownerScenarioIds[ownerKey] = [];
for (const registration of NEUTRAL_SUITE_SCENARIO_OWNERSHIP) {
  const bucket = ownerScenarioIds[registration.owner_key];
  if (bucket === undefined) {
    throw new Error(
      `neutral-conformance-assembly: ${registration.stable_id} names owner ${registration.owner_key}, which is not a declared owner`
    );
  }
  bucket.push(registration.stable_id);
}

/** Each owner's ids, in CANONICAL order — never in an owner-local order. */
export const NEUTRAL_OWNER_SCENARIO_IDS: Readonly<Record<string, readonly string[]>> =
  neutralFreeze(ownerScenarioIds);

const ownerScenarioCounts: Record<string, number> = {};
for (const ownerKey of NEUTRAL_CONFORMANCE_OWNER_KEYS) {
  ownerScenarioCounts[ownerKey] = ownerScenarioIds[ownerKey].length;
}

/** The owner/count map. A packet that carries a different count is refused. */
export const NEUTRAL_CONFORMANCE_OWNER_SCENARIO_COUNTS: Readonly<Record<string, number>> =
  neutralFreeze(ownerScenarioCounts);

/**
 * Which owner a stable id belongs to, or `undefined` when the closed tuple does
 * not contain it. It takes `unknown` because the id being tested always came
 * from a caller.
 */
function ownerKeyOfScenario(stableId: unknown): string | undefined {
  if (typeof stableId !== "string") return undefined;
  const at = NEUTRAL_REQUIRED_SUITE_SCENARIO_IDS.indexOf(stableId);
  if (at === -1) return undefined;
  return OWNER_KEY_OF_SCENARIO[at];
}

/**
 * Fail closed at load if the closed table has drifted.
 *
 * A registry that disagrees with itself, or with the core registry it claims to
 * extend, cannot back any aggregate this module emits — so it is a loud error at
 * import, not a soft verdict at call time.
 */
function assertSourceOwnedRegistry(): void {
  if (NEUTRAL_REQUIRED_SUITE_SCENARIO_IDS.length !== NEUTRAL_REQUIRED_SUITE_SCENARIO_COUNT) {
    throw new Error(
      `neutral-conformance-assembly: the suite tuple holds ${NEUTRAL_REQUIRED_SUITE_SCENARIO_IDS.length} ids, expected ${NEUTRAL_REQUIRED_SUITE_SCENARIO_COUNT}`
    );
  }
  const seen: string[] = [];
  for (const stableId of NEUTRAL_REQUIRED_SUITE_SCENARIO_IDS) {
    if (seen.indexOf(stableId) !== -1) {
      throw new Error(`neutral-conformance-assembly: duplicate stable id ${stableId} in the suite tuple`);
    }
    seen.push(stableId);
  }
  let total = 0;
  for (const ownerKey of NEUTRAL_CONFORMANCE_OWNER_KEYS) {
    total += NEUTRAL_CONFORMANCE_OWNER_SCENARIO_COUNTS[ownerKey];
  }
  if (total !== NEUTRAL_REQUIRED_SUITE_SCENARIO_COUNT) {
    throw new Error(
      `neutral-conformance-assembly: owner counts sum to ${total}, expected ${NEUTRAL_REQUIRED_SUITE_SCENARIO_COUNT}`
    );
  }
  // The one owner this repository already evaluates must agree with its own
  // registry, or the spine is claiming ids the core does not declare.
  const coreDeclared = NEUTRAL_CORE_SCENARIOS.map((scenario) => scenario.stable_id)
    .slice()
    .sort()
    .join("|");
  const spineIds = NEUTRAL_OWNER_SCENARIO_IDS[OWNER_MH02];
  const spineDeclared = spineIds.slice().sort().join("|");
  if (coreDeclared !== spineDeclared) {
    throw new Error(
      `neutral-conformance-assembly: the ${OWNER_MH02} ids disagree with the core scenario registry (${spineDeclared} vs ${coreDeclared})`
    );
  }
}
assertSourceOwnedRegistry();

// ---------------------------------------------------------------------------
// The owner packet
// ---------------------------------------------------------------------------

/** The pinned packet schema. A packet declaring anything else is refused. */
export const NEUTRAL_ASSEMBLY_PACKET_SCHEMA = "guild.conformance_owner_packet.v1";

/**
 * One owner's evidence packet.
 *
 * `stable_ids` is the owner's declared coverage and `results[i]` must correspond
 * to `stable_ids[i]`; the pairing is what makes a result attributable to a
 * scenario at all. `evidence_identity` is the identity the OWNER produced its
 * packet under, and it must agree with every result's identity and with the
 * claim's activated runtime — a packet assembled across two different releases
 * is not evidence about either.
 */
export interface NeutralOwnerConformancePacket {
  readonly schema_version: string;
  readonly suite_id: string;
  readonly suite_version: string;
  readonly owner_key: string;
  readonly evidence_identity: NeutralEvidenceIdentity;
  readonly stable_ids: readonly string[];
  readonly results: readonly NeutralScenarioResult[];
}

/**
 * What the caller asks for. It names itself and the runtime it claims to have
 * activated, and it may NOT name the required scenario set.
 */
export interface NeutralAssemblyClaim {
  readonly claimant_id: string;
  readonly activated_runtime: NeutralEvidenceIdentity;
  /** Present only in a malformed claim; its presence is itself the refusal. */
  readonly required_scenario_ids?: readonly string[];
}

/**
 * What one canonical request TEXT decodes to (FIC129-B1/B2).
 *
 * It is a decode target, not a parameter type: the boundary takes a string, and
 * this interface says what that string must contain once parsed. A caller builds
 * the text with `neutralCanonicalJson({ packets, claim })` over data it owns.
 */
export interface NeutralAssemblyRequest {
  readonly packets: readonly NeutralOwnerConformancePacket[];
  readonly claim: NeutralAssemblyClaim;
}

/**
 * The request's top-level members, sorted. A request carrying any other member —
 * or missing one of these — is refused: an unrecognized top-level key is a
 * channel, and this module has exactly one.
 */
export const NEUTRAL_ASSEMBLY_REQUEST_MEMBERS: readonly string[] = neutralFreeze(["claim", "packets"]);

export interface NeutralAssemblyResult {
  readonly outcome: NeutralOutcome;
  /** The aggregate, or `null` whenever the outcome is not `succeeded`. */
  readonly evidence: NeutralConformanceEvidence | null;
}

/**
 * The assembly contract, as the control battery exercises it.
 *
 * `unknown` rather than `string` is deliberate and load-bearing: the battery and
 * the focused suite hand this boundary objects, arrays, proxies, and accessor-
 * bearing records, and REFUSING them without inspection is the contract. A
 * signature that only admitted strings would make that untestable.
 */
export type NeutralAssemblyFunction = (request: unknown) => NeutralAssemblyResult;

// ---------------------------------------------------------------------------
// Refusal controls
// ---------------------------------------------------------------------------

const CONTROL_OWNER_MISSING = "owner_packet_missing";
const CONTROL_OWNER_DUPLICATED = "owner_packet_duplicated";
const CONTROL_OWNER_COUNT = "owner_scenario_count_mismatch";
const CONTROL_ID_DUPLICATED = "stable_id_duplicated";
const CONTROL_ID_FOREIGN = "stable_id_foreign";
const CONTROL_ID_OWNER_MISMATCH = "stable_id_owner_mismatch";
const CONTROL_RESULT_ORDER = "result_order_mismatch";
const CONTROL_SUITE_DRIFT = "suite_identity_drift";
const CONTROL_IDENTITY_MISMATCH = "evidence_identity_mismatch";
const CONTROL_CALLER_REQUIRED_SET = "caller_supplied_required_set";
const CONTROL_PACKET_SCHEMA = "packet_schema_unrecognized";
const CONTROL_IDENTITY_INCOMPLETE = "evidence_identity_incomplete";
const CONTROL_RESULT_CONTRACT = "result_contract_invalid";
const CONTROL_REQUEST_NOT_TEXT = "assembly_request_not_canonical_text";

/**
 * Every refusal path this module can take, named. Each value appears on exactly
 * one path, so a refusal is diagnosable without reading the assertions.
 */
export const NEUTRAL_ASSEMBLY_REFUSAL_CONTROLS: readonly string[] = neutralFreeze([
  CONTROL_OWNER_MISSING,
  CONTROL_OWNER_DUPLICATED,
  CONTROL_OWNER_COUNT,
  CONTROL_ID_DUPLICATED,
  CONTROL_ID_FOREIGN,
  CONTROL_ID_OWNER_MISMATCH,
  CONTROL_RESULT_ORDER,
  CONTROL_SUITE_DRIFT,
  CONTROL_IDENTITY_MISMATCH,
  CONTROL_CALLER_REQUIRED_SET,
  CONTROL_PACKET_SCHEMA,
  CONTROL_IDENTITY_INCOMPLETE,
  CONTROL_RESULT_CONTRACT,
  CONTROL_REQUEST_NOT_TEXT,
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isRecord(value: unknown): boolean {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The outcome of reading ONE field off a PARSED record.
 *
 * Two states, and the distinction is load-bearing:
 *
 *   absent      no member of that name in the parsed object
 *   present     ordinary own data, whatever JSON produced for it
 *
 * There is deliberately no third "unreadable" state any more. The FIC-110-era
 * reader needed one because it read untrusted object graphs, where a field could
 * be an accessor that threw. Nothing reaching this reader is untrusted in that
 * sense: everything it sees came out of `JSON.parse` of a primitive string, so a
 * read cannot execute anything and cannot throw. Inventing an unreachable state
 * would be a comment claiming a protection the code no longer needs.
 */
interface NeutralFieldRead {
  readonly present: boolean;
  readonly value: unknown;
}

const FIELD_ABSENT: NeutralFieldRead = neutralFreeze({
  present: false,
  value: undefined,
});

/**
 * Read one field of a parsed record as own data.
 *
 * `Object.keys` decides membership rather than `in`, so the object prototype is
 * not consulted at all — which matters for exactly one reason: `JSON.parse`
 * places a `"__proto__"` member as an ORDINARY OWN key and leaves the prototype
 * alone, so own-key membership is the only reading of "the request said this"
 * that stays true for every key a JSON document may contain.
 */
function readOwnField(value: unknown, field: string): NeutralFieldRead {
  if (!isRecord(value)) return FIELD_ABSENT;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).indexOf(field) === -1) return FIELD_ABSENT;
  return { present: true, value: record[field] };
}

/** The own-data value of a field, or `undefined` when the request omitted it. */
function fieldOf(value: unknown, field: string): unknown {
  return readOwnField(value, field).value;
}

/** A caller-supplied value safe to place on a refusal's facts. */
function reportable(value: unknown): unknown {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  return null;
}

// ---------------------------------------------------------------------------
// The runtime result contract (FIC-110 B1)
// ---------------------------------------------------------------------------

/**
 * The closed vocabularies a result's fields must be drawn from.
 *
 * They are the core's own exports, widened to `readonly string[]` for comparison
 * against untrusted values. Re-typing any of them here would fork the rules the
 * MH-02 decision applies later, which is exactly the drift this module refuses
 * to introduce.
 */
const OUTCOME_TYPE_VOCABULARY: readonly string[] = NEUTRAL_OUTCOME_TYPES;
const DISPOSITION_VOCABULARY: readonly string[] = NEUTRAL_DISPOSITIONS;
const REASON_CODE_VOCABULARY: readonly string[] = NEUTRAL_REASON_CODES;
const FRESHNESS_VOCABULARY: readonly string[] = NEUTRAL_EVIDENCE_FRESHNESS_VERDICTS;

/**
 * The FIRST field of the runtime result contract this result violates, or null.
 *
 * Naming the field rather than returning a bare boolean is the contract: a
 * refusal a caller cannot act on is barely better than an acceptance, and the
 * field name is the one fact that says which owner's evaluator to go fix.
 *
 * `evidence_freshness` is checked for MEMBERSHIP, not for `fresh`. `stale` and
 * `unknown` are typed verdicts the MH-02 decision weighs later; over-rejecting
 * them here would quietly delete the distinction the vocabulary exists to carry.
 * `evidence_identity` is deliberately absent from this function — completeness
 * and cross-binding of the identity tuple are checked in their own pass, which
 * has the claim to compare against.
 */
function invalidResultField(result: unknown): string | null {
  const outcomeType = fieldOf(result, "outcome_type");
  if (typeof outcomeType !== "string" || OUTCOME_TYPE_VOCABULARY.indexOf(outcomeType) === -1) {
    return "outcome_type";
  }

  const disposition = fieldOf(result, "disposition");
  if (typeof disposition !== "string" || DISPOSITION_VOCABULARY.indexOf(disposition) === -1) {
    return "disposition";
  }

  // A reason code is COUPLED to the disposition, not independent of it: every
  // non-succeeded outcome carries exactly one recognized code, and a succeeded
  // one carries none. An absent field reads as the explicit null.
  const reason = fieldOf(result, "reason_code");
  if (disposition === "succeeded") {
    if (reason !== null && reason !== undefined) return "reason_code";
  } else if (typeof reason !== "string" || REASON_CODE_VOCABULARY.indexOf(reason) === -1) {
    return "reason_code";
  }

  const receiptRef = fieldOf(result, "receipt_ref");
  if (typeof receiptRef !== "string" || receiptRef.length === 0) return "receipt_ref";

  const freshness = fieldOf(result, "evidence_freshness");
  if (typeof freshness !== "string" || FRESHNESS_VOCABULARY.indexOf(freshness) === -1) {
    return "evidence_freshness";
  }

  return null;
}

/**
 * Is every field of the identity tuple present and non-empty?
 *
 * The field list is the core's, so "complete" here and "complete" in the MH-02
 * decision cannot drift apart.
 */
function identityIsComplete(identity: unknown): boolean {
  if (!isRecord(identity)) return false;
  for (const field of NEUTRAL_EVIDENCE_IDENTITY_FIELDS) {
    const value = fieldOf(identity, field);
    if (field === "contract_version") {
      if (typeof value !== "number" || !Number.isFinite(value)) return false;
      continue;
    }
    if (typeof value !== "string" || value.length === 0) return false;
  }
  return true;
}

/** Which identity fields two identities disagree on. Empty means identical. */
function identityDifferences(left: unknown, right: unknown): string[] {
  const offenders: string[] = [];
  for (const field of NEUTRAL_EVIDENCE_IDENTITY_FIELDS) {
    if (fieldOf(left, field) !== fieldOf(right, field)) offenders.push(field);
  }
  return offenders;
}

/** A non-aliasing copy of exactly the identity tuple, and nothing else. */
function copyIdentity(identity: unknown): NeutralEvidenceIdentity {
  const copy: Record<string, unknown> = {};
  for (const field of NEUTRAL_EVIDENCE_IDENTITY_FIELDS) {
    copy[field] = fieldOf(identity, field);
  }
  return copy as unknown as NeutralEvidenceIdentity;
}

/**
 * A non-aliasing copy of exactly the scenario-result contract.
 *
 * Copying field by field rather than spreading is deliberate: it drops anything
 * an owner attached beyond the contract, so nothing an owner invented can ride
 * into the aggregate and be read downstream as evidence. Every field is read off
 * the PARSED snapshot, which holds ordinary data only, so the value copied here
 * is the value the passes above validated.
 */
function copyResult(result: unknown): NeutralScenarioResult {
  const reason = fieldOf(result, "reason_code");
  return {
    stable_id: fieldOf(result, "stable_id"),
    outcome_type: fieldOf(result, "outcome_type"),
    disposition: fieldOf(result, "disposition"),
    reason_code: reason === undefined ? null : reason,
    receipt_ref: fieldOf(result, "receipt_ref"),
    evidence_identity: copyIdentity(fieldOf(result, "evidence_identity")),
    evidence_freshness: fieldOf(result, "evidence_freshness"),
  } as unknown as NeutralScenarioResult;
}

// ---------------------------------------------------------------------------
// The canonical-text request boundary (FIC129-B1, FIC129-B2)
// ---------------------------------------------------------------------------

/**
 * The parsed request, or the reason the text was not one.
 *
 * `detail` is a SOURCE-OWNED phrase, never a fragment of the caller's bytes: a
 * refusal that echoes an attacker-chosen string back onto `outcome.facts` is a
 * second channel out of this module, and the caller already knows what it sent.
 */
interface NeutralRequestDecode {
  readonly claim: unknown;
  readonly packets: readonly unknown[];
  readonly detail: string | null;
}

/**
 * Decode ONE canonical JSON request text.
 *
 * The order is the whole point, and every step before the last is a decision
 * about a PRIMITIVE:
 *
 *   1. `typeof request === "string"`. Nothing structural has run yet, so an
 *      object, array, proxy, or accessor-bearing input is rejected here — with
 *      no key enumerated, no property read, no property written, and no
 *      descriptor requested. This is the property FIC129-B1/B2 found missing:
 *      it is the CONTROL FLOW, not a reflection trick, that keeps caller code
 *      out of this module's stack.
 *   2. `JSON.parse` of that primitive. The result is a fresh ordinary graph —
 *      plain objects and arrays holding data properties only. No accessor and
 *      no proxy can survive a text round trip, and a `"__proto__"` member lands
 *      as an ordinary own key rather than as a live prototype slot.
 *   3. The parsed graph must RE-CANONICALIZE to the exact bytes that arrived.
 *      That is what makes the snapshot faithful in both directions: a duplicate
 *      key, an unsorted object, or padding cannot leave a second reading of the
 *      request lying around for a later pass to find.
 *   4. Only then is the shape examined, and only for the two members the
 *      contract declares — an extra top-level member is an undeclared channel.
 *
 * `JSON.parse` is a pure ECMAScript intrinsic: it imports nothing, reads no
 * clock, holds no host handle, and keeps this file inside the core capability
 * closure that `neutral-core-boundary.ts` scans.
 */
function decodeAssemblyRequest(request: unknown): NeutralRequestDecode {
  if (typeof request !== "string") {
    return { claim: undefined, packets: [], detail: "the request must be one canonical JSON text" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(request);
  } catch {
    return { claim: undefined, packets: [], detail: "the request text is not well-formed JSON" };
  }
  if (!isRecord(parsed)) {
    return { claim: undefined, packets: [], detail: "the request text must decode to a JSON object" };
  }
  let recanonicalized: string;
  try {
    recanonicalized = neutralCanonicalJson(parsed);
  } catch {
    return {
      claim: undefined,
      packets: [],
      detail: "the request text could not be re-canonicalized for comparison",
    };
  }
  if (recanonicalized !== request) {
    return {
      claim: undefined,
      packets: [],
      detail: "the request text is not the canonical form of what it decodes to",
    };
  }
  const members = Object.keys(parsed as Record<string, unknown>).slice().sort();
  if (members.join("|") !== NEUTRAL_ASSEMBLY_REQUEST_MEMBERS.join("|")) {
    return {
      claim: undefined,
      packets: [],
      detail: "the request declares exactly the packet set and the claim, and nothing else",
    };
  }
  const packets = fieldOf(parsed, "packets");
  if (!Array.isArray(packets)) {
    return { claim: undefined, packets: [], detail: "the request's packet set must be a JSON array" };
  }
  return { claim: fieldOf(parsed, "claim"), packets: packets as readonly unknown[], detail: null };
}

function refuse(
  control: string,
  reasonCode: NeutralReasonCode,
  assertions: readonly string[],
  facts: Record<string, unknown>
): NeutralAssemblyResult {
  const merged: Record<string, unknown> = {};
  for (const key of Object.keys(facts)) merged[key] = facts[key];
  merged.refusal_control = control;
  merged.packet_schema = NEUTRAL_ASSEMBLY_PACKET_SCHEMA;
  merged.suite_id = NEUTRAL_SCENARIO_SUITE_ID;
  merged.suite_version = NEUTRAL_SCENARIO_SUITE_VERSION;
  merged.required_scenario_count = NEUTRAL_REQUIRED_SUITE_SCENARIO_COUNT;
  return {
    outcome: neutralOutcome({
      type: "guild.boundary_outcome.v1",
      disposition: "refused",
      reason_code: reasonCode,
      assertions: [...assertions],
      binding: { contract_version: NEUTRAL_CONTRACT_VERSION },
      facts: merged,
    }),
    evidence: null,
  };
}

// ---------------------------------------------------------------------------
// The assembler
// ---------------------------------------------------------------------------

/**
 * Join six owner packets into one ordered 31-scenario aggregate, or refuse.
 *
 * The checks run in a fixed order and each names its own control:
 *
 *   0. the request is one canonical JSON text, decoded into fresh ordinary data
 *   1. the claim may not carry a required set, and must name a complete identity
 *   2. every packet declares the pinned packet schema
 *   3. every packet declares the pinned suite id and version
 *   4. exactly one packet per declared owner — no duplicate, none missing, none
 *      attributable to no declared owner at all
 *   5. per owner: the exact scenario count, no duplicate id, no foreign id, no
 *      id belonging to another owner, and results ordered against those ids
 *   6. per owner: every result satisfies the runtime result contract
 *   7. per owner: a complete identity on the packet and on every result, all
 *      equal to the claim's activated runtime
 *
 * Only then is the aggregate built, and it is built by walking the SOURCE-OWNED
 * tuple and looking each id up in its owner's packet — never by concatenating
 * what arrived. That is what makes the output independent of packet input order
 * and impossible to shrink.
 *
 * The INPUT is one canonical JSON TEXT, and step 0 is the reason every later
 * step can be described as reading inert data: a non-string request is refused
 * before a single structural operation runs, and what a string decodes to is a
 * fresh ordinary graph `JSON.parse` built, never the caller's object. So there
 * is no accessor to execute, no proxy trap to hit, and no inherited contract
 * field to mistake for data — not because a clever probe separates those shapes,
 * but because none of them can cross a text boundary. Owner packets are still
 * held in a POSITIONAL array so a `"__proto__"` or `"constructor"` owner key is
 * an unattributable string rather than a live slot.
 */
export function assembleNeutralConformanceEvidence(request: unknown): NeutralAssemblyResult {
  // -- 0. the request is canonical TEXT -------------------------------------
  const decoded = decodeAssemblyRequest(request);
  if (decoded.detail !== null) {
    return refuse(
      CONTROL_REQUEST_NOT_TEXT,
      "scenario_contract_version_unrecognized",
      [
        "the assembly request is one canonical JSON text carrying exactly the packet set and the claim",
        "a direct object, array, proxy, or accessor-bearing input is refused without being inspected: no key is enumerated, no property is read or written, no descriptor is requested",
        "a text that is not the canonical form of what it decodes to is refused, so the validated snapshot is the transmitted one",
      ],
      // `typeof` answers for a proxy without reaching a trap, and the detail is
      // this module's own phrase — no fragment of the request is echoed back.
      { request_kind: typeof request, request_detail: decoded.detail }
    );
  }
  const claim = decoded.claim;

  // -- 1. the claim ---------------------------------------------------------
  if (!isRecord(claim)) {
    return refuse(
      CONTROL_IDENTITY_INCOMPLETE,
      "scenario_evidence_incomplete",
      ["an aggregate needs a claim that names its claimant and its activated runtime"],
      { incomplete_field: "claim" }
    );
  }
  // A parsed request has own data members only, so PRESENCE is the channel:
  // `JSON.parse` cannot produce an inherited member, an accessor-backed one, or
  // an own member whose value is `undefined`.
  if (readOwnField(claim, "required_scenario_ids").present) {
    return refuse(
      CONTROL_CALLER_REQUIRED_SET,
      "scenario_required_set_mismatch",
      [
        "the required scenario tuple has exactly one source, and it is this module",
        "a caller-supplied tuple is refused even when it agrees, because accepting a matching copy accepts the channel that can differ",
      ],
      { claimant_id: reportable(fieldOf(claim, "claimant_id")) }
    );
  }
  const claimantId = fieldOf(claim, "claimant_id");
  if (typeof claimantId !== "string" || claimantId.length === 0) {
    return refuse(
      CONTROL_IDENTITY_INCOMPLETE,
      "scenario_evidence_incomplete",
      ["an anonymous claim cannot be checked against anything downstream"],
      { incomplete_field: "claimant_id" }
    );
  }
  // Snapshotted ONCE, so the identity every packet and result is compared
  // against cannot differ from the identity the aggregate finally carries.
  const claimIdentity = copyIdentity(fieldOf(claim, "activated_runtime"));
  if (!identityIsComplete(claimIdentity)) {
    return refuse(
      CONTROL_IDENTITY_INCOMPLETE,
      "scenario_evidence_incomplete",
      ["the claimed activated runtime must name every field of the identity tuple"],
      { incomplete_source: "claim.activated_runtime", claimant_id: claimantId }
    );
  }

  // -- 2. packet shape ------------------------------------------------------
  // Every packet is already ONE inert record: it came out of `JSON.parse`, and
  // the decode above proved the text re-canonicalizes to itself, so the value
  // read in this pass is the value read in every later pass and the value
  // finally copied into the aggregate. That is the FIC124-B1 property, now held
  // by construction rather than by a snapshot the module has to maintain.
  const supplied: Record<string, unknown>[] = [];
  for (let index = 0; index < decoded.packets.length; index += 1) {
    const packet = decoded.packets[index];
    if (!isRecord(packet) || fieldOf(packet, "schema_version") !== NEUTRAL_ASSEMBLY_PACKET_SCHEMA) {
      return refuse(
        CONTROL_PACKET_SCHEMA,
        "scenario_contract_version_unrecognized",
        ["a packet whose schema this module does not implement cannot be interpreted"],
        {
          packet_index: index,
          declared_schema_version: reportable(fieldOf(packet, "schema_version")),
          owner_key: reportable(fieldOf(packet, "owner_key")),
        }
      );
    }
    supplied.push(packet as Record<string, unknown>);
  }

  // Every later pass walks owners in CANONICAL order, so which malformed packet
  // a refusal names does not depend on the order the caller happened to use.
  // The buckets are POSITIONAL: an owner key is matched by index into the
  // source-owned tuple and never used as a property key, so `__proto__` and
  // `constructor` resolve to nothing instead of to a live prototype slot.
  const packetsByOwner: unknown[][] = NEUTRAL_CONFORMANCE_OWNER_KEYS.map(() => []);
  const unattributable: unknown[] = [];
  for (const packet of supplied) {
    const ownerKey = fieldOf(packet, "owner_key");
    const at = typeof ownerKey === "string" ? NEUTRAL_CONFORMANCE_OWNER_KEYS.indexOf(ownerKey) : -1;
    if (at === -1) {
      unattributable.push(reportable(ownerKey));
      continue;
    }
    packetsByOwner[at].push(packet);
  }

  // -- 3. suite identity ----------------------------------------------------
  for (let ownerIndex = 0; ownerIndex < NEUTRAL_CONFORMANCE_OWNER_KEYS.length; ownerIndex += 1) {
    const ownerKey = NEUTRAL_CONFORMANCE_OWNER_KEYS[ownerIndex];
    for (const packet of packetsByOwner[ownerIndex]) {
      const suiteId = fieldOf(packet, "suite_id");
      const suiteVersion = fieldOf(packet, "suite_version");
      if (suiteId !== NEUTRAL_SCENARIO_SUITE_ID || suiteVersion !== NEUTRAL_SCENARIO_SUITE_VERSION) {
        return refuse(
          CONTROL_SUITE_DRIFT,
          "scenario_suite_version_mismatch",
          ["a packet evaluated against another suite revision proves nothing about this one"],
          {
            owner_key: ownerKey,
            declared_suite_id: reportable(suiteId),
            declared_suite_version: reportable(suiteVersion),
          }
        );
      }
    }
  }

  // -- 4. one packet per declared owner -------------------------------------
  const duplicated: string[] = [];
  const missing: string[] = [];
  for (let ownerIndex = 0; ownerIndex < NEUTRAL_CONFORMANCE_OWNER_KEYS.length; ownerIndex += 1) {
    const supplyCount = packetsByOwner[ownerIndex].length;
    if (supplyCount > 1) duplicated.push(NEUTRAL_CONFORMANCE_OWNER_KEYS[ownerIndex]);
    if (supplyCount === 0) missing.push(NEUTRAL_CONFORMANCE_OWNER_KEYS[ownerIndex]);
  }
  if (duplicated.length > 0) {
    return refuse(
      CONTROL_OWNER_DUPLICATED,
      "scenario_required_set_mismatch",
      [
        "each owner speaks once",
        "two packets for one owner leave the aggregate free to pick the more convenient of them",
      ],
      { duplicated_owner_keys: [...duplicated], supplied_packet_count: supplied.length }
    );
  }
  if (missing.length > 0 || unattributable.length > 0) {
    return refuse(
      CONTROL_OWNER_MISSING,
      "scenario_evidence_incomplete",
      [
        "the aggregate covers the whole suite or it covers nothing",
        "a packet attributable to no declared owner cannot stand in for one",
      ],
      {
        missing_owner_keys: [...missing],
        unattributable_owner_keys: [...unattributable],
        supplied_packet_count: supplied.length,
      }
    );
  }

  // -- 5. per-owner coverage ------------------------------------------------
  for (let ownerIndex = 0; ownerIndex < NEUTRAL_CONFORMANCE_OWNER_KEYS.length; ownerIndex += 1) {
    const ownerKey = NEUTRAL_CONFORMANCE_OWNER_KEYS[ownerIndex];
    const packet = packetsByOwner[ownerIndex][0];
    const expectedCount = NEUTRAL_CONFORMANCE_OWNER_SCENARIO_COUNTS[ownerKey];
    const declaredIdsValue = fieldOf(packet, "stable_ids");
    const resultsValue = fieldOf(packet, "results");
    const declaredIds: readonly unknown[] = Array.isArray(declaredIdsValue)
      ? (declaredIdsValue as readonly unknown[])
      : [];
    const results: readonly unknown[] = Array.isArray(resultsValue)
      ? (resultsValue as readonly unknown[])
      : [];

    if (declaredIds.length !== expectedCount || results.length !== expectedCount) {
      return refuse(
        CONTROL_OWNER_COUNT,
        "scenario_required_set_mismatch",
        ["an owner covers exactly the scenarios the closed table assigns it"],
        {
          owner_key: ownerKey,
          expected_scenario_count: expectedCount,
          declared_id_count: declaredIds.length,
          declared_result_count: results.length,
        }
      );
    }

    // A LIST, not a record: the ids being deduplicated are caller-supplied, and a
    // record keyed by them would treat `__proto__` as a live slot.
    const seenInPacket: string[] = [];
    for (let position = 0; position < declaredIds.length; position += 1) {
      const stableId = declaredIds[position];
      if (typeof stableId === "string" && seenInPacket.indexOf(stableId) !== -1) {
        return refuse(
          CONTROL_ID_DUPLICATED,
          "scenario_required_set_mismatch",
          ["a repeated id pads coverage without evaluating anything"],
          { owner_key: ownerKey, stable_id: stableId, position }
        );
      }
      if (typeof stableId === "string") seenInPacket.push(stableId);

      const declaredOwner = ownerKeyOfScenario(stableId);
      if (declaredOwner === undefined) {
        return refuse(
          CONTROL_ID_FOREIGN,
          "scenario_required_set_mismatch",
          ["the suite tuple is closed, so an id it does not contain is not a scenario"],
          { owner_key: ownerKey, stable_id: reportable(stableId), position }
        );
      }
      if (declaredOwner !== ownerKey) {
        return refuse(
          CONTROL_ID_OWNER_MISMATCH,
          "scenario_required_set_mismatch",
          [
            "each scenario has exactly one owner",
            "an owner claiming another owner's id would let one boundary vouch for a boundary it never ran",
          ],
          { owner_key: ownerKey, stable_id: stableId, declared_owner_key: declaredOwner, position }
        );
      }

      const resultId = fieldOf(results[position], "stable_id");
      if (resultId !== stableId) {
        return refuse(
          CONTROL_RESULT_ORDER,
          "scenario_results_unordered",
          [
            "results are ordered against the ids they answer",
            "an unordered pairing attributes an outcome to a scenario that did not produce it",
          ],
          {
            owner_key: ownerKey,
            position,
            expected_stable_id: stableId,
            result_stable_id: reportable(resultId),
          }
        );
      }
    }
  }

  // -- 6. the runtime result contract ---------------------------------------
  // FIC-110 B1: the JOIN being sound says nothing about whether what was joined
  // is a RESULT. A result carrying no outcome type, a numeric disposition, a null
  // receipt reference, or an invented freshness verdict is not the shape this
  // module claims to emit, and copying it into a frozen aggregate under
  // `succeeded` launders it as evidence. Deferring the check to the MH-02
  // decision is a different boundary's obligation, not a substitute for this one.
  for (let ownerIndex = 0; ownerIndex < NEUTRAL_CONFORMANCE_OWNER_KEYS.length; ownerIndex += 1) {
    const ownerKey = NEUTRAL_CONFORMANCE_OWNER_KEYS[ownerIndex];
    const packet = packetsByOwner[ownerIndex][0];
    const results = fieldOf(packet, "results") as readonly unknown[];
    for (let position = 0; position < results.length; position += 1) {
      const invalidField = invalidResultField(results[position]);
      if (invalidField !== null) {
        return refuse(
          CONTROL_RESULT_CONTRACT,
          "scenario_result_mismatch",
          [
            "every assembled result satisfies the runtime result contract before it is copied",
            "outcome type, disposition, reason-code coupling, receipt reference, and freshness are read against the vocabularies the core exports",
            "the refusal names the offending field, so the owner whose evaluator produced it is actionable",
          ],
          {
            owner_key: ownerKey,
            position,
            stable_id: reportable(fieldOf(results[position], "stable_id")),
            invalid_field: invalidField,
          }
        );
      }
    }
  }

  // -- 7. one identity across packets, results, and the claim ---------------
  for (let ownerIndex = 0; ownerIndex < NEUTRAL_CONFORMANCE_OWNER_KEYS.length; ownerIndex += 1) {
    const ownerKey = NEUTRAL_CONFORMANCE_OWNER_KEYS[ownerIndex];
    const packet = packetsByOwner[ownerIndex][0];
    const packetIdentity = fieldOf(packet, "evidence_identity");
    if (!identityIsComplete(packetIdentity)) {
      return refuse(
        CONTROL_IDENTITY_INCOMPLETE,
        "scenario_evidence_incomplete",
        ["a packet that does not name the whole identity tuple is not bound to any runtime"],
        { owner_key: ownerKey, incomplete_source: "packet.evidence_identity" }
      );
    }
    const results = fieldOf(packet, "results") as readonly unknown[];
    for (let position = 0; position < results.length; position += 1) {
      if (!identityIsComplete(fieldOf(results[position], "evidence_identity"))) {
        return refuse(
          CONTROL_IDENTITY_INCOMPLETE,
          "scenario_evidence_incomplete",
          ["every single result names the whole identity tuple it was produced under"],
          {
            owner_key: ownerKey,
            position,
            stable_id: reportable(fieldOf(results[position], "stable_id")),
            incomplete_source: "result.evidence_identity",
          }
        );
      }
    }

    const packetDifferences = identityDifferences(packetIdentity, claimIdentity);
    if (packetDifferences.length > 0) {
      return refuse(
        CONTROL_IDENTITY_MISMATCH,
        "scenario_identity_binding_mismatch",
        ["an aggregate assembled across two runtimes is evidence about neither"],
        {
          owner_key: ownerKey,
          differing_fields: packetDifferences,
          source: "packet.evidence_identity",
        }
      );
    }
    for (let position = 0; position < results.length; position += 1) {
      const differences = identityDifferences(
        fieldOf(results[position], "evidence_identity"),
        claimIdentity
      );
      if (differences.length > 0) {
        return refuse(
          CONTROL_IDENTITY_MISMATCH,
          "scenario_identity_binding_mismatch",
          ["one result produced under a different identity contaminates the whole aggregate"],
          {
            owner_key: ownerKey,
            position,
            stable_id: reportable(fieldOf(results[position], "stable_id")),
            differing_fields: differences,
            source: "result.evidence_identity",
          }
        );
      }
    }
  }

  // -- build ----------------------------------------------------------------
  // Walk the source-owned tuple, not the packets. Every id is looked up in the
  // packet of the owner the closed table assigns it, so the aggregate's order,
  // length, and membership are properties of this module rather than of the
  // caller's array.
  const orderedResults: NeutralScenarioResult[] = [];
  for (let index = 0; index < NEUTRAL_REQUIRED_SUITE_SCENARIO_IDS.length; index += 1) {
    const stableId = NEUTRAL_REQUIRED_SUITE_SCENARIO_IDS[index];
    const ownerKey = OWNER_KEY_OF_SCENARIO[index];
    const ownerIndex = NEUTRAL_CONFORMANCE_OWNER_KEYS.indexOf(ownerKey);
    const packet = packetsByOwner[ownerIndex][0];
    const declaredIds = fieldOf(packet, "stable_ids") as readonly unknown[];
    const results = fieldOf(packet, "results") as readonly unknown[];
    const position = declaredIds.indexOf(stableId);
    if (position === -1) {
      // Unreachable once pass 5 holds: coverage is exact, deduplicated, and
      // owner-bound. Kept because "unreachable" is a claim, and refusing is the
      // honest answer if it ever stops being true.
      return refuse(
        CONTROL_ID_FOREIGN,
        "scenario_required_set_mismatch",
        ["a required scenario has no result in its owner's packet"],
        { owner_key: ownerKey, stable_id: stableId }
      );
    }
    orderedResults.push(copyResult(results[position]));
  }

  const evidence = neutralFreeze({
    suite_id: NEUTRAL_SCENARIO_SUITE_ID,
    suite_version: NEUTRAL_SCENARIO_SUITE_VERSION,
    required_scenario_ids: [...NEUTRAL_REQUIRED_SUITE_SCENARIO_IDS],
    activated_runtime: copyIdentity(claimIdentity),
    results: orderedResults,
    claimant_id: claimantId,
  }) as unknown as NeutralConformanceEvidence;

  return {
    outcome: neutralOutcome({
      type: "guild.boundary_outcome.v1",
      disposition: "succeeded",
      assertions: [
        "one packet per declared owner, each covering exactly its assigned scenarios",
        "the required tuple and its order are source-owned, and the aggregate follows it",
        "every assembled result satisfies the runtime result contract",
        "one identity binds every packet, every result, and the claim",
        "the request arrived as one canonical JSON text, so nothing inherited, accessor-backed, or proxied could enter and no caller code ran",
        "assembly takes no promotion decision and verifies no signature",
      ],
      binding: { contract_version: NEUTRAL_CONTRACT_VERSION },
      facts: {
        packet_count: NEUTRAL_CONFORMANCE_OWNER_KEYS.length,
        result_count: orderedResults.length,
        required_scenario_count: NEUTRAL_REQUIRED_SUITE_SCENARIO_COUNT,
        owner_keys: [...NEUTRAL_CONFORMANCE_OWNER_KEYS],
        suite_id: NEUTRAL_SCENARIO_SUITE_ID,
        suite_version: NEUTRAL_SCENARIO_SUITE_VERSION,
        packet_schema: NEUTRAL_ASSEMBLY_PACKET_SCHEMA,
        claimant_id: claimantId,
      },
    }),
    evidence,
  };
}

// ---------------------------------------------------------------------------
// The control battery
// ---------------------------------------------------------------------------

/**
 * Inputs the battery builds for itself.
 *
 * They are AUTHORED here rather than read as data for the same reason the
 * scenario table is: this module performs no I/O. The identity values are
 * shaped like real ones so the battery exercises the same code path a real
 * packet does, and the assembler deliberately does not judge whether a runtime,
 * host, or release is RECOGNIZED — that is the MH-02 decision's obligation over
 * the assembled package, and duplicating it here would fork the rules.
 */
const CONTROL_IDENTITY: NeutralEvidenceIdentity = {
  source_commit: "7d1f0c6a4b93e28517ac6f30d5b8291e4c07ab63",
  package_hash: "sha256:3f9c1d8e2a640b57ef03c9d41a86b5720ed3f814c62a09bd57e1403f8ca92b6d",
  runtime_version: "guild-2.5.0",
  adapter_version: "guild.host_adapter.v1.0.0",
  host_id: "claude-code-cli",
  host_version: "2.5.0",
  platform: "darwin-arm64",
  contract_version: NEUTRAL_CONTRACT_VERSION,
  scenario_suite_id: NEUTRAL_SCENARIO_SUITE_ID,
  scenario_suite_version: NEUTRAL_SCENARIO_SUITE_VERSION,
  release_id: "rel-2026-08-18-a21s",
};

/**
 * A field-by-field copy of the control identity with overrides applied.
 *
 * A named function rather than the immediately-invoked arrow this used to be:
 * the core's capability rail reads an IIFE as a call whose callee is another
 * call's result, and a core member may not make one.
 */
function controlIdentityWith(overrides: Record<string, unknown>): NeutralEvidenceIdentity {
  const copy: Record<string, unknown> = {};
  for (const field of NEUTRAL_EVIDENCE_IDENTITY_FIELDS) {
    copy[field] = fieldOf(CONTROL_IDENTITY, field);
  }
  for (const key of Object.keys(overrides)) copy[key] = overrides[key];
  return copy as unknown as NeutralEvidenceIdentity;
}

/** A second, equally complete identity — the battery's cross-packet control. */
const CONTROL_OTHER_IDENTITY: NeutralEvidenceIdentity = controlIdentityWith({
  source_commit: "2b840ce15fa9376d0c4e8b21af5730d96e1c48a7",
});

const CONTROL_CLAIMANT_ID = "guild.release-emitter";

/**
 * Owner keys that name a prototype slot rather than an owner.
 *
 * They are STRINGS here, and the assembler must treat them as strings: an
 * implementation that buckets packets in a record keyed by owner would resolve
 * either of them to a live inherited value and then throw on it, which is a
 * crash rather than a refusal.
 */
const CONTROL_FORGED_OWNER_KEYS: readonly string[] = neutralFreeze([
  "__proto__",
  "constructor",
]);

const CONTROL_CLAIM: NeutralAssemblyClaim = {
  claimant_id: CONTROL_CLAIMANT_ID,
  activated_runtime: CONTROL_IDENTITY,
};

function controlCommitment(sequence: number): string {
  let hex = (sequence >>> 0).toString(16);
  while (hex.length < 16) hex = `0${hex}`;
  return `nec1:${hex}`;
}

function controlResultFor(
  stableId: string,
  overrides: Record<string, unknown> = {}
): NeutralScenarioResult {
  const sequence = NEUTRAL_REQUIRED_SUITE_SCENARIO_IDS.indexOf(stableId) + 1;
  const result: Record<string, unknown> = {
    stable_id: stableId,
    outcome_type: "guild.lifecycle_outcome.v1",
    disposition: "succeeded",
    reason_code: null,
    receipt_ref: `guild.receipt_ref.v1:a21s-control#${sequence}@${controlCommitment(sequence)}`,
    evidence_identity: CONTROL_IDENTITY,
    evidence_freshness: "fresh",
  };
  for (const key of Object.keys(overrides)) result[key] = overrides[key];
  return result as unknown as NeutralScenarioResult;
}

function controlPacketFor(
  ownerKey: string,
  overrides: Record<string, unknown> = {}
): NeutralOwnerConformancePacket {
  const declared = NEUTRAL_OWNER_SCENARIO_IDS[ownerKey];
  const ids = declared === undefined ? [] : declared;
  const packet: Record<string, unknown> = {
    schema_version: NEUTRAL_ASSEMBLY_PACKET_SCHEMA,
    suite_id: NEUTRAL_SCENARIO_SUITE_ID,
    suite_version: NEUTRAL_SCENARIO_SUITE_VERSION,
    owner_key: ownerKey,
    evidence_identity: CONTROL_IDENTITY,
    stable_ids: ids.slice(),
    results: ids.map((stableId) => controlResultFor(stableId)),
  };
  for (const key of Object.keys(overrides)) packet[key] = overrides[key];
  return packet as unknown as NeutralOwnerConformancePacket;
}

function controlPackets(): NeutralOwnerConformancePacket[] {
  return NEUTRAL_CONFORMANCE_OWNER_KEYS.map((ownerKey) => controlPacketFor(ownerKey));
}

/** All six packets, with one owner's replaced or omitted. */
function controlPacketsWith(
  ownerKey: string,
  replacement: NeutralOwnerConformancePacket | null
): NeutralOwnerConformancePacket[] {
  const packets: NeutralOwnerConformancePacket[] = [];
  for (const key of NEUTRAL_CONFORMANCE_OWNER_KEYS) {
    if (key !== ownerKey) {
      packets.push(controlPacketFor(key));
      continue;
    }
    if (replacement !== null) packets.push(replacement);
  }
  return packets;
}

function controlIdsFor(ownerKey: string): readonly string[] {
  return NEUTRAL_OWNER_SCENARIO_IDS[ownerKey];
}

/** One owner's packet with the result at `position` replaced. */
function controlPacketWithResultAt(
  ownerKey: string,
  position: number,
  replacement: NeutralScenarioResult
): NeutralOwnerConformancePacket {
  const ids = controlIdsFor(ownerKey);
  const results = ids.map((stableId) => controlResultFor(stableId));
  results[position] = replacement;
  return controlPacketFor(ownerKey, { results });
}

/**
 * The same record, reachable only through its prototype.
 *
 * `Object.create` is the one construction the untrusted-shape control needs and
 * the only one the core's capability rail admits for it: a descriptor API would
 * itself be a reflection reach and would fail the closure this module is a
 * member of. So the control exercises INHERITANCE, which is what B2 is about,
 * and leaves accessor and proxy probes to the focused suite, which is not
 * closure-bound and may call `Object.defineProperty` and `new Proxy`.
 */
function controlThroughPrototype(value: unknown): unknown {
  return Object.create(value as object);
}

/**
 * The battery's own encoder: source-owned control data as ONE canonical text.
 *
 * The battery holds every value it passes, so canonicalizing here is a caller
 * encoding data it owns — never this module inspecting an untrusted graph. The
 * boundary under test still begins at the string.
 */
function controlRequestText(
  packets: readonly NeutralOwnerConformancePacket[],
  claim: NeutralAssemblyClaim
): string {
  return neutralCanonicalJson({ packets, claim });
}

/**
 * A refusal an implementation must produce, as a TYPED outcome.
 *
 * An implementation that throws instead FAILS the control: a thrown error is not
 * a refusal a caller can inspect, route, or record.
 */
function refusesRawWith(
  implementation: NeutralAssemblyFunction,
  request: unknown,
  control: string
): boolean {
  let result: NeutralAssemblyResult;
  try {
    result = implementation(request);
  } catch {
    return false;
  }
  if (!isRecord(result) || result.evidence !== null) return false;
  const outcome = result.outcome;
  if (!isRecord(outcome) || outcome.disposition !== "refused") return false;
  return fieldOf(outcome.facts, "refusal_control") === control;
}

function refusesWith(
  implementation: NeutralAssemblyFunction,
  packets: readonly NeutralOwnerConformancePacket[],
  claim: NeutralAssemblyClaim,
  control: string
): boolean {
  let result: NeutralAssemblyResult;
  try {
    result = implementation(controlRequestText(packets, claim));
  } catch {
    return false;
  }
  if (!isRecord(result) || result.evidence !== null) return false;
  const outcome = result.outcome;
  if (!isRecord(outcome) || outcome.disposition !== "refused") return false;
  return fieldOf(outcome.facts, "refusal_control") === control;
}

/** Any typed refusal at all, naming a control this module declares. */
function refusesSafely(
  implementation: NeutralAssemblyFunction,
  packets: readonly NeutralOwnerConformancePacket[],
  claim: NeutralAssemblyClaim
): boolean {
  let result: NeutralAssemblyResult;
  try {
    result = implementation(controlRequestText(packets, claim));
  } catch {
    return false;
  }
  if (!isRecord(result) || result.evidence !== null) return false;
  const outcome = result.outcome;
  if (!isRecord(outcome) || outcome.disposition !== "refused") return false;
  const control = fieldOf(outcome.facts, "refusal_control");
  if (typeof control !== "string") return false;
  return NEUTRAL_ASSEMBLY_REFUSAL_CONTROLS.indexOf(control) !== -1;
}

function acceptedEvidence(
  implementation: NeutralAssemblyFunction,
  packets: readonly NeutralOwnerConformancePacket[],
  claim: NeutralAssemblyClaim
): NeutralConformanceEvidence | null {
  let result: NeutralAssemblyResult;
  try {
    result = implementation(controlRequestText(packets, claim));
  } catch {
    return null;
  }
  if (!isRecord(result) || !isRecord(result.outcome)) return null;
  if (result.outcome.disposition !== "succeeded") return null;
  return isRecord(result.evidence) ? result.evidence : null;
}

function sameIdList(actual: unknown, expected: readonly string[]): boolean {
  if (!Array.isArray(actual) || actual.length !== expected.length) return false;
  for (let index = 0; index < expected.length; index += 1) {
    if (actual[index] !== expected[index]) return false;
  }
  return true;
}

interface NeutralAssemblyControlDefinition {
  readonly id: string;
  readonly title: string;
  readonly check: (implementation: NeutralAssemblyFunction) => boolean;
}

/**
 * The battery, in declaration order.
 *
 * ANTI-VACUITY: a battery is only worth running if it can distinguish a real
 * assembler from a naive concatenation of whatever arrived. Every control below
 * is written so that concatenation fails it — either because concatenation
 * cannot reach the canonical order, or because it refuses nothing.
 */
const NEUTRAL_ASSEMBLY_CONTROL_BATTERY: readonly NeutralAssemblyControlDefinition[] = [
  {
    id: "A21S-C01-canonical-order",
    title: "six valid packets assemble into the 31 required ids, in contract order",
    check: (implementation) => {
      const shuffled = controlPackets().reverse();
      const evidence = acceptedEvidence(implementation, shuffled, CONTROL_CLAIM);
      if (evidence === null) return false;
      return (
        sameIdList(
          evidence.results.map((result) => result.stable_id),
          NEUTRAL_REQUIRED_SUITE_SCENARIO_IDS
        ) && sameIdList(evidence.required_scenario_ids, NEUTRAL_REQUIRED_SUITE_SCENARIO_IDS)
      );
    },
  },
  {
    id: "A21S-C02-owner-packet-missing",
    title: "an absent owner packet is refused, never treated as zero scenarios",
    check: (implementation) =>
      refusesWith(
        implementation,
        controlPacketsWith(OWNER_MH08, null),
        CONTROL_CLAIM,
        CONTROL_OWNER_MISSING
      ),
  },
  {
    id: "A21S-C03-owner-packet-duplicated",
    title: "two packets for one owner are refused",
    check: (implementation) => {
      const packets = controlPackets();
      packets.push(controlPacketFor(OWNER_MH06));
      return refusesWith(implementation, packets, CONTROL_CLAIM, CONTROL_OWNER_DUPLICATED);
    },
  },
  {
    id: "A21S-C04-owner-scenario-count",
    title: "an owner covering fewer scenarios than the closed table assigns it is refused",
    check: (implementation) => {
      const ids = controlIdsFor(OWNER_MH09);
      const short = ids.slice(0, ids.length - 1);
      const trimmed = controlPacketFor(OWNER_MH09, {
        stable_ids: short,
        results: short.map((stableId) => controlResultFor(stableId)),
      });
      return refusesWith(
        implementation,
        controlPacketsWith(OWNER_MH09, trimmed),
        CONTROL_CLAIM,
        CONTROL_OWNER_COUNT
      );
    },
  },
  {
    id: "A21S-C05-stable-id-duplicated",
    title: "a repeated stable id is refused, not counted twice",
    check: (implementation) => {
      const ids = controlIdsFor(OWNER_MH07);
      const repeated = [ids[0], ids[0], ids[2], ids[3]];
      const duplicated = controlPacketFor(OWNER_MH07, {
        stable_ids: repeated,
        results: repeated.map((stableId) => controlResultFor(stableId)),
      });
      return refusesWith(
        implementation,
        controlPacketsWith(OWNER_MH07, duplicated),
        CONTROL_CLAIM,
        CONTROL_ID_DUPLICATED
      );
    },
  },
  {
    id: "A21S-C06-stable-id-foreign",
    title: "an id outside the closed suite tuple is refused",
    check: (implementation) => {
      const ids = controlIdsFor(OWNER_MH03);
      const invented = [ids[0], ids[1], ids[2], "MHRC-CONTROL-FORGED-001"];
      const foreign = controlPacketFor(OWNER_MH03, {
        stable_ids: invented,
        results: invented.map((stableId) => controlResultFor(stableId)),
      });
      return refusesWith(
        implementation,
        controlPacketsWith(OWNER_MH03, foreign),
        CONTROL_CLAIM,
        CONTROL_ID_FOREIGN
      );
    },
  },
  {
    id: "A21S-C07-stable-id-owner-mismatch",
    title: "an owner claiming another owner's id is refused",
    check: (implementation) => {
      const ids = controlIdsFor(OWNER_MH03);
      const poached = [ids[0], ids[1], ids[2], controlIdsFor(OWNER_MH06)[0]];
      const packet = controlPacketFor(OWNER_MH03, {
        stable_ids: poached,
        results: poached.map((stableId) => controlResultFor(stableId)),
      });
      return refusesWith(
        implementation,
        controlPacketsWith(OWNER_MH03, packet),
        CONTROL_CLAIM,
        CONTROL_ID_OWNER_MISMATCH
      );
    },
  },
  {
    id: "A21S-C08-result-order-mismatch",
    title: "results not ordered against the packet's ids are refused",
    check: (implementation) => {
      const ids = controlIdsFor(OWNER_MH02);
      const misordered = [ids[1], ids[0], ...ids.slice(2)];
      const packet = controlPacketFor(OWNER_MH02, {
        results: misordered.map((stableId) => controlResultFor(stableId)),
      });
      return refusesWith(
        implementation,
        controlPacketsWith(OWNER_MH02, packet),
        CONTROL_CLAIM,
        CONTROL_RESULT_ORDER
      );
    },
  },
  {
    id: "A21S-C09-suite-identity-drift",
    title: "a packet evaluated against another suite revision is refused",
    check: (implementation) => {
      const drifted = controlPacketFor(OWNER_MH08, { suite_version: "9.9.9" });
      return refusesWith(
        implementation,
        controlPacketsWith(OWNER_MH08, drifted),
        CONTROL_CLAIM,
        CONTROL_SUITE_DRIFT
      );
    },
  },
  {
    id: "A21S-C10-evidence-identity-mismatch",
    title: "an identity that disagrees across packets or with the claim is refused",
    check: (implementation) => {
      const other = controlPacketFor(OWNER_MH06, { evidence_identity: CONTROL_OTHER_IDENTITY });
      return refusesWith(
        implementation,
        controlPacketsWith(OWNER_MH06, other),
        CONTROL_CLAIM,
        CONTROL_IDENTITY_MISMATCH
      );
    },
  },
  {
    id: "A21S-C11-caller-required-set",
    title: "a caller that supplies its own required set is refused, even when it agrees",
    check: (implementation) =>
      refusesWith(
        implementation,
        controlPackets(),
        {
          claimant_id: CONTROL_CLAIMANT_ID,
          activated_runtime: CONTROL_IDENTITY,
          required_scenario_ids: [...NEUTRAL_REQUIRED_SUITE_SCENARIO_IDS],
        },
        CONTROL_CALLER_REQUIRED_SET
      ),
  },
  {
    id: "A21S-C12-packet-input-order-independence",
    title: "the aggregate is byte-identical whatever order the packets arrive in",
    check: (implementation) => {
      const first = acceptedEvidence(implementation, controlPackets(), CONTROL_CLAIM);
      const rotatedPackets = controlPackets();
      rotatedPackets.push(rotatedPackets.shift() as NeutralOwnerConformancePacket);
      const rotated = acceptedEvidence(implementation, rotatedPackets, CONTROL_CLAIM);
      if (first === null || rotated === null) return false;
      return neutralCanonicalJson(first) === neutralCanonicalJson(rotated);
    },
  },
  {
    id: "A21S-C13-output-immutability",
    title: "the aggregate is deeply frozen, so no consumer can edit it after the fact",
    check: (implementation) => {
      const evidence = acceptedEvidence(implementation, controlPackets(), CONTROL_CLAIM);
      if (evidence === null) return false;
      if (!Object.isFrozen(evidence)) return false;
      if (!Object.isFrozen(evidence.results)) return false;
      if (!Object.isFrozen(evidence.required_scenario_ids)) return false;
      if (!Object.isFrozen(evidence.activated_runtime)) return false;
      for (const result of evidence.results) {
        if (!Object.isFrozen(result)) return false;
        if (!Object.isFrozen(result.evidence_identity)) return false;
      }
      return true;
    },
  },
  {
    id: "A21S-C14-packet-schema-versioned",
    title: "a packet that does not declare the pinned packet schema is refused",
    check: (implementation) => {
      const drifted = controlPacketFor(OWNER_MH06, {
        schema_version: "guild.conformance_owner_packet.v99",
      });
      return refusesWith(
        implementation,
        controlPacketsWith(OWNER_MH06, drifted),
        CONTROL_CLAIM,
        CONTROL_PACKET_SCHEMA
      );
    },
  },
  {
    id: "A21S-C15-evidence-identity-complete",
    title: "an identity missing any field of the tuple is refused",
    check: (implementation) => {
      const incomplete: Record<string, unknown> = {};
      for (const field of NEUTRAL_EVIDENCE_IDENTITY_FIELDS) {
        if (field === "platform") continue;
        incomplete[field] = fieldOf(CONTROL_IDENTITY, field);
      }
      const packet = controlPacketFor(OWNER_MH09, { evidence_identity: incomplete });
      return refusesWith(
        implementation,
        controlPacketsWith(OWNER_MH09, packet),
        CONTROL_CLAIM,
        CONTROL_IDENTITY_INCOMPLETE
      );
    },
  },
  {
    id: "A21S-C16-result-contract-validated",
    title:
      "a result violating the runtime result contract is refused, never copied into the aggregate",
    check: (implementation) => {
      // One row per malformed class, each on a DIFFERENT owner and a different
      // position, so a validation that only inspects the first packet, or only
      // position 0, fails here rather than passing a narrower table.
      const malformed: NeutralOwnerConformancePacket[] = [
        controlPacketWithResultAt(
          OWNER_MH02,
          0,
          controlResultFor(controlIdsFor(OWNER_MH02)[0], { outcome_type: "guild.invented.v9" })
        ),
        controlPacketWithResultAt(
          OWNER_MH03,
          1,
          controlResultFor(controlIdsFor(OWNER_MH03)[1], { disposition: 42 })
        ),
        controlPacketWithResultAt(
          OWNER_MH06,
          2,
          controlResultFor(controlIdsFor(OWNER_MH06)[2], {
            disposition: "refused",
            reason_code: "invented_reason",
          })
        ),
        controlPacketWithResultAt(
          OWNER_MH07,
          3,
          controlResultFor(controlIdsFor(OWNER_MH07)[3], { receipt_ref: null })
        ),
        controlPacketWithResultAt(
          OWNER_MH08,
          0,
          controlResultFor(controlIdsFor(OWNER_MH08)[0], { evidence_freshness: "invented" })
        ),
        controlPacketWithResultAt(
          OWNER_MH09,
          8,
          controlResultFor(controlIdsFor(OWNER_MH09)[8], {
            disposition: "succeeded",
            reason_code: "policy_denied",
          })
        ),
      ];
      for (let index = 0; index < malformed.length; index += 1) {
        const ownerKey = NEUTRAL_CONFORMANCE_OWNER_KEYS[index];
        const packets = controlPacketsWith(ownerKey, malformed[index]);
        if (!refusesWith(implementation, packets, CONTROL_CLAIM, CONTROL_RESULT_CONTRACT)) {
          return false;
        }
      }

      // NON-VACUITY: over-rejecting is its own defect. Every freshness verdict the
      // core exports, and a non-succeeded result naming a recognized reason code,
      // must still assemble.
      for (const verdict of FRESHNESS_VOCABULARY) {
        const ids = controlIdsFor(OWNER_MH08);
        const fresh = controlPacketFor(OWNER_MH08, {
          results: ids.map((stableId) => controlResultFor(stableId, { evidence_freshness: verdict })),
        });
        const packets = controlPacketsWith(OWNER_MH08, fresh);
        if (acceptedEvidence(implementation, packets, CONTROL_CLAIM) === null) return false;
      }
      const failing = controlPacketWithResultAt(
        OWNER_MH03,
        0,
        controlResultFor(controlIdsFor(OWNER_MH03)[0], {
          disposition: "failed",
          reason_code: "execution_failed",
        })
      );
      const accepted = acceptedEvidence(
        implementation,
        controlPacketsWith(OWNER_MH03, failing),
        CONTROL_CLAIM
      );
      return accepted !== null;
    },
  },
  {
    id: "A21S-C17-untrusted-shape-safe-reads",
    title: "prototype-supplied object requests and prototype-named owner keys refuse, never throw or pass",
    check: (implementation) => {
      // An OBJECT request is refused at the text boundary, whatever it carries.
      // The prototype-supplied shapes below are the FIC-110 B2 probes verbatim;
      // they now die one step earlier, unread, rather than being decomposed into
      // own-versus-inherited reads.
      const inheritedSet = controlThroughPrototype({
        required_scenario_ids: [...NEUTRAL_REQUIRED_SUITE_SCENARIO_IDS],
      }) as Record<string, unknown>;
      inheritedSet.claimant_id = CONTROL_CLAIMANT_ID;
      inheritedSet.activated_runtime = CONTROL_IDENTITY;
      const inheritedClaim = controlThroughPrototype(CONTROL_CLAIM);
      const inheritedPackets = controlPackets().map((packet) => controlThroughPrototype(packet));
      const objectRequests: unknown[] = [
        { packets: controlPackets(), claim: inheritedSet },
        { packets: controlPackets(), claim: inheritedClaim },
        { packets: inheritedPackets, claim: CONTROL_CLAIM },
      ];
      for (const objectRequest of objectRequests) {
        if (!refusesRawWith(implementation, objectRequest, CONTROL_REQUEST_NOT_TEXT)) return false;
      }

      // The CHANNEL itself still closes on the text path: a canonical request
      // whose claim carries the tuple as own data is refused for supplying it,
      // not for being the wrong kind of input.
      const ownSetClaim: Record<string, unknown> = {
        claimant_id: CONTROL_CLAIMANT_ID,
        activated_runtime: CONTROL_IDENTITY,
        required_scenario_ids: [...NEUTRAL_REQUIRED_SUITE_SCENARIO_IDS],
      };
      if (
        !refusesWith(
          implementation,
          controlPackets(),
          ownSetClaim as unknown as NeutralAssemblyClaim,
          CONTROL_CALLER_REQUIRED_SET
        )
      ) {
        return false;
      }

      // A prototype-named owner key is an unattributable string, not a live slot.
      for (const forgedKey of CONTROL_FORGED_OWNER_KEYS) {
        const extra = controlPackets();
        extra.push(controlPacketFor(OWNER_MH02, { owner_key: forgedKey }));
        if (!refusesWith(implementation, extra, CONTROL_CLAIM, CONTROL_OWNER_MISSING)) return false;
        const impostor = controlPacketFor(OWNER_MH07, { owner_key: forgedKey });
        const replaced = controlPacketsWith(OWNER_MH07, impostor);
        if (!refusesWith(implementation, replaced, CONTROL_CLAIM, CONTROL_OWNER_MISSING)) {
          return false;
        }
      }

      // NON-VACUITY: refusing everything would satisfy the block above. Ordinary
      // own-data records — the JSON-parsed case — must still assemble.
      return acceptedEvidence(implementation, controlPackets(), CONTROL_CLAIM) !== null;
    },
  },
  {
    id: "A21S-C18-canonical-text-request",
    title:
      "the request is one canonical JSON text: a non-string request, malformed text, or non-canonical text is refused, and only the canonical form assembles",
    check: (implementation) => {
      // 1. NON-TEXT. Every one of these is refused before a structural operation
      //    runs. An implementation that inspects the input to decide what it is
      //    has already executed whatever the input chose to be (FIC129-B1/B2).
      const nonText: unknown[] = [
        controlPackets(),
        { packets: controlPackets(), claim: CONTROL_CLAIM },
        CONTROL_CLAIM,
        null,
        undefined,
        7,
        true,
      ];
      for (const candidate of nonText) {
        if (!refusesRawWith(implementation, candidate, CONTROL_REQUEST_NOT_TEXT)) return false;
      }

      // 2. TEXT THAT IS NOT A CANONICAL REQUEST. Well-formedness, decoded kind,
      //    canonical form, and the declared member set are each their own step,
      //    so one row per step.
      const canonical = controlRequestText(controlPackets(), CONTROL_CLAIM);
      const malformed: unknown[] = [
        "",
        "{",
        "not json at all",
        "[]",
        '"a string is valid JSON, and is not a request"',
        // Valid JSON with the right members in the WRONG order: identical once
        // decoded, different bytes, so it is not the canonical form.
        `{"packets":[],"claim":{}}`,
        // The canonical text with insignificant padding — same decode, different
        // bytes.
        ` ${canonical}`,
        // An undeclared top-level member is a channel this contract does not have.
        neutralCanonicalJson({ packets: controlPackets(), claim: CONTROL_CLAIM, mode: "lenient" }),
        // The packet set must be a JSON array, not an object holding packets.
        neutralCanonicalJson({ packets: { first: controlPacketFor(OWNER_MH02) }, claim: CONTROL_CLAIM }),
      ];
      for (const candidate of malformed) {
        if (!refusesRawWith(implementation, candidate, CONTROL_REQUEST_NOT_TEXT)) return false;
      }

      // 3. A canonical request whose CONTENT is wrong still reaches the ordinary
      //    refusals: the text boundary must not swallow every other control.
      if (!refusesSafely(implementation, controlPacketsWith(OWNER_MH08, null), CONTROL_CLAIM)) {
        return false;
      }

      // 4. NON-VACUITY: the canonical text of six valid packets assembles, and
      //    the aggregate is the same one the canonical-order control expects.
      const evidence = acceptedEvidence(implementation, controlPackets(), CONTROL_CLAIM);
      if (evidence === null) return false;
      return sameIdList(
        evidence.results.map((result) => result.stable_id),
        NEUTRAL_REQUIRED_SUITE_SCENARIO_IDS
      );
    },
  },
];

export interface NeutralAssemblyControl {
  readonly id: string;
  readonly title: string;
}

/** The declared control battery, in the order it runs. */
export const NEUTRAL_ASSEMBLY_CONTROLS: readonly NeutralAssemblyControl[] = neutralFreeze(
  NEUTRAL_ASSEMBLY_CONTROL_BATTERY.map((control) => ({ id: control.id, title: control.title }))
);

export interface NeutralAssemblyControlReport {
  readonly passed: boolean;
  readonly failed_ids: readonly string[];
  readonly control_count: number;
}

/**
 * Run the whole battery against ANY implementation of the assembly contract.
 *
 * Taking the implementation as a parameter is what makes the battery falsifiable:
 * the same code that certifies the real assembler is pointed at a deliberately
 * broken one, and a battery the broken one survives is a battery that would also
 * have certified a false aggregate.
 */
export function runNeutralAssemblyControls(
  implementation: NeutralAssemblyFunction
): NeutralAssemblyControlReport {
  const failed: string[] = [];
  for (const control of NEUTRAL_ASSEMBLY_CONTROL_BATTERY) {
    let satisfied = false;
    try {
      satisfied = control.check(implementation) === true;
    } catch {
      satisfied = false;
    }
    if (!satisfied) failed.push(control.id);
  }
  return neutralFreeze({
    passed: failed.length === 0,
    failed_ids: failed,
    control_count: NEUTRAL_ASSEMBLY_CONTROL_BATTERY.length,
  }) as NeutralAssemblyControlReport;
}
