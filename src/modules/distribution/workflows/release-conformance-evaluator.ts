/**
 * src/modules/distribution/workflows/release-conformance-evaluator.ts
 *
 * A21-9 / W5/MH-09 — the release-distribution owner's EVALUATOR.
 *
 * `guild.conformance_scenarios.v1` assigns exactly nine of its 31 scenarios to
 * `W5/MH-09`: `MHRC-SUP-001` … `MHRC-SUP-006` and `MHRC-VER-001` … `MHRC-VER-003`.
 * This module evaluates those nine and hands the A21-S assembler one
 * `guild.conformance_owner_packet.v1`. It decides nothing else: no assembly, no
 * cross-owner promotion, no channel or release decision, and no signature
 * issuance (the external one-time signer `scripts/sign-release-attestation.ts`
 * owns that boundary).
 *
 * WHAT MAKES THE PACKET HONEST
 *   Every result is DERIVED by driving the REAL production cores, never
 *   authored. The support-state dispositions come from
 *   `applyNeutralSupportTransition` / `deriveNeutralSupportClaim`; the
 *   install/activate/update proofs run the REAL `verifyReleaseClaim` over the
 *   bound release claim and archive bytes; version drift is compared over the
 *   complete `NEUTRAL_EVIDENCE_IDENTITY_FIELDS` tuple, never a label; and the
 *   covered scenario set is SOURCE-OWNED (derived from the assembly spine's
 *   registry) — a caller that supplies its own required set is refused, because
 *   accepting the channel is accepting a claim in place of evidence.
 *
 * THE ADMISSION BOUNDARY IS CANONICAL TEXT
 *   `evaluateReleaseConformance` accepts ONE argument: the canonical JSON TEXT
 *   of the request (`neutralCanonicalJson` form). A live object — however
 *   friendly — is refused unread: a Proxy can lie through every trap, and the
 *   only way to never invoke a trap is to never touch the object. The text is
 *   bounded in size and bracket depth BEFORE it is parsed, the parse result
 *   must re-serialize to the exact same bytes, and the member vocabulary is
 *   closed. Everything outside that vocabulary — a caller-supplied required-id
 *   set, a relabel instruction, a trust root — is a refusal, even when it
 *   agrees with the source-owned truth.
 *
 * PRODUCTION VS FIXTURE AUTHORITY
 *   `mode: "fixture"` proves MECHANICS with test-owned identities and is
 *   explicitly non-promotable (`promotable: false` on every result). `mode:
 *   "production"` requires independent production provisioning, recognized
 *   pinned verification roots, and externally signed authority — none of which
 *   this repository can mint for itself — so production mode FAILS CLOSED here
 *   and stays unavailable until that provisioning genuinely exists outside the
 *   repo. Relabeling a fixture packet as production is a refusal by vocabulary.
 *
 * PURITY
 *   No I/O, no clock, no randomness, no environment: two evaluations of the
 *   same request text produce byte-identical results.
 */

import { Buffer } from "node:buffer";

import {
  NEUTRAL_ASSEMBLY_PACKET_SCHEMA,
  NEUTRAL_EVIDENCE_FRESHNESS_VERDICTS,
  NEUTRAL_EVIDENCE_IDENTITY_FIELDS,
  NEUTRAL_OWNER_SCENARIO_IDS,
  NEUTRAL_RECOGNIZED_HOST_IDS,
  NEUTRAL_SCENARIO_SUITE_ID,
  NEUTRAL_SCENARIO_SUITE_VERSION,
  NEUTRAL_UNEVALUATED_SUPPORT,
  applyNeutralSupportTransition,
  deriveNeutralSupportClaim,
  neutralCanonicalJson,
  neutralFreeze,
  neutralOutcome,
} from "../../lifecycle";
import type {
  NeutralDisposition,
  NeutralEvidenceIdentity,
  NeutralOutcome,
  NeutralOutcomeType,
  NeutralOwnerConformancePacket,
  NeutralScenarioResult,
  NeutralSupportRecord,
  NeutralSupportStatus,
} from "../../lifecycle";

import { verifyReleaseClaim } from "./release-distribution-contract";
import type { OperationEvidence, ReleaseClaim } from "./release-distribution-contract";

// ---------------------------------------------------------------------------
// Identity of this owner and of this evaluator
// ---------------------------------------------------------------------------

/** The frozen contract's owner key for the nine release-distribution scenarios. */
export const MH09_OWNER_KEY = "W5/MH-09";

/**
 * The nine stable ids, in CANONICAL (whole-suite) order. SOURCE-OWNED: derived
 * from the assembly spine's closed registry, so the evaluator and the assembler
 * cannot drift on which scenarios this owner covers.
 */
export const MH09_STABLE_IDS: readonly string[] = neutralFreeze([
  ...NEUTRAL_OWNER_SCENARIO_IDS[MH09_OWNER_KEY],
]);

/** The closed evaluation-mode vocabulary. */
export const MH09_MODES: readonly string[] = neutralFreeze(["production", "fixture"]);

/**
 * The closed request-member vocabulary of the canonical-text admission
 * boundary. `scenario` is an optional focus label; every other member is
 * mandatory. A member outside this vocabulary — `required_scenario_ids`,
 * `relabel_as`, `trust_root`, anything — is refused, even when it agrees with
 * the source-owned truth, because accepting the channel accepts the claim.
 */
export const MH09_REQUEST_MEMBERS: readonly string[] = neutralFreeze([
  "run_id",
  "claimant_id",
  "mode",
  "evidence_identity",
  "receipt_refs",
  "evidence_freshness",
  "scenario_evidence",
  "scenario",
]);

export const MH09_EVALUATOR_VERSION = "guild.release_conformance_evaluator.v1";

/** Admission bounds. The request is refused BEFORE parsing when it exceeds them. */
export const MH09_MAX_REQUEST_CHARS = 1_000_000;
export const MH09_MAX_REQUEST_DEPTH = 64;

// ---------------------------------------------------------------------------
// The frozen expected outcome of each scenario, derived here from source
// ---------------------------------------------------------------------------

interface Mh09ExpectedRow {
  readonly type: NeutralOutcomeType;
  readonly disposition: NeutralDisposition;
  readonly reason_code: string | null;
}

/**
 * The typed outcome each scenario reports when its frozen expectation is
 * DEMONSTRATED by the evidence. The three `MHRC-VER-*` rows are expected typed
 * refusal/unsupported/failure outcomes carrying the three closed version-drift
 * reason codes; the six `MHRC-SUP-*` rows are expected successes.
 */
const MH09_EXPECTED: Readonly<Record<string, Mh09ExpectedRow>> = neutralFreeze({
  "MHRC-SUP-001": { type: "guild.support_transition_outcome.v1", disposition: "succeeded", reason_code: null },
  "MHRC-SUP-002": { type: "guild.support_transition_outcome.v1", disposition: "succeeded", reason_code: null },
  "MHRC-SUP-003": { type: "guild.support_transition_outcome.v1", disposition: "succeeded", reason_code: null },
  "MHRC-SUP-004": { type: "guild.support_transition_outcome.v1", disposition: "succeeded", reason_code: null },
  "MHRC-SUP-005": { type: "guild.support_transition_outcome.v1", disposition: "succeeded", reason_code: null },
  "MHRC-SUP-006": { type: "guild.support_transition_outcome.v1", disposition: "succeeded", reason_code: null },
  "MHRC-VER-001": { type: "guild.version_compatibility_outcome.v1", disposition: "refused", reason_code: "evidence_version_drift" },
  "MHRC-VER-002": { type: "guild.version_compatibility_outcome.v1", disposition: "unsupported", reason_code: "contract_major_mismatch" },
  "MHRC-VER-003": { type: "guild.version_compatibility_outcome.v1", disposition: "failed", reason_code: "package_runtime_mismatch" },
});

// ---------------------------------------------------------------------------
// Request / result shapes
// ---------------------------------------------------------------------------

export interface Mh09EvaluationRequest {
  readonly run_id: string;
  readonly claimant_id: string;
  readonly mode: string;
  readonly evidence_identity: NeutralEvidenceIdentity;
  readonly receipt_refs: Readonly<Record<string, string>>;
  readonly evidence_freshness: Readonly<Record<string, string>>;
  readonly scenario_evidence: Readonly<Record<string, unknown>>;
  readonly scenario?: string;
}

export interface Mh09EvaluationResult {
  readonly outcome: NeutralOutcome;
  readonly packet: NeutralOwnerConformancePacket;
  /** Fixture-mode packets prove mechanics only; they are never promotable. */
  readonly promotable: false;
  readonly mode: string;
}

// ---------------------------------------------------------------------------
// Admission: canonical JSON text only, bounded, closed vocabulary
// ---------------------------------------------------------------------------

function refuseAdmission(detail: string): never {
  throw new Error(`release-conformance-evaluator: ${detail}`);
}

/**
 * The maximum bracket-nesting depth of the raw text, computed ITERATIVELY so an
 * over-deep request is refused before anything recursive (parse-then-serialize)
 * ever touches it. String bodies (and their escapes) are skipped.
 */
function textBracketDepth(text: string): number {
  let depth = 0;
  let max = 0;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const ch = text.charAt(index);
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{" || ch === "[") {
      depth += 1;
      if (depth > max) max = depth;
    } else if (ch === "}" || ch === "]") depth -= 1;
  }
  return max;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function identityComplete(value: unknown): value is NeutralEvidenceIdentity {
  if (!isPlainRecord(value)) return false;
  for (const field of NEUTRAL_EVIDENCE_IDENTITY_FIELDS) {
    const member = value[field];
    if (field === "contract_version") {
      if (typeof member !== "number" || !Number.isFinite(member)) return false;
      continue;
    }
    if (typeof member !== "string" || member.length === 0) return false;
  }
  return true;
}

/**
 * Decode and admit one canonical request text. Every refusal here THROWS: an
 * inadmissible request is not an evaluation that failed, it is a request that
 * never became one.
 */
function admitRequest(requestText: unknown): Mh09EvaluationRequest {
  // A live object is refused UNREAD — no property, trap, or key of it is ever
  // touched, which is the only refusal a hostile Proxy cannot observe.
  if (typeof requestText !== "string") {
    refuseAdmission("the request must be canonical JSON text, never a live object");
  }
  if (requestText.length > MH09_MAX_REQUEST_CHARS) {
    refuseAdmission(`request text exceeds the ${MH09_MAX_REQUEST_CHARS}-character admission bound`);
  }
  if (textBracketDepth(requestText) > MH09_MAX_REQUEST_DEPTH) {
    refuseAdmission(`request text exceeds the depth-${MH09_MAX_REQUEST_DEPTH} admission bound`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(requestText);
  } catch {
    refuseAdmission("request text is not valid JSON");
  }
  if (!isPlainRecord(parsed)) {
    refuseAdmission("request text must decode to a single JSON object");
  }
  if (neutralCanonicalJson(parsed) !== requestText) {
    refuseAdmission("request text is not in canonical form");
  }

  for (const key of Object.keys(parsed)) {
    if (MH09_REQUEST_MEMBERS.indexOf(key) === -1) {
      refuseAdmission(
        `request member ${JSON.stringify(key)} is outside the closed vocabulary — ` +
          "the covered scenario set, trust roots, and packet labels are source-owned, never supplied"
      );
    }
  }

  const runId = parsed.run_id;
  const claimantId = parsed.claimant_id;
  const mode = parsed.mode;
  if (typeof runId !== "string" || runId.length === 0) refuseAdmission("run_id must be a non-empty string");
  if (typeof claimantId !== "string" || claimantId.length === 0) {
    refuseAdmission("claimant_id must be a non-empty string");
  }
  if (typeof mode !== "string" || MH09_MODES.indexOf(mode) === -1) {
    refuseAdmission("mode must be one of the closed evaluation modes");
  }
  if (mode === "production") {
    // FAIL CLOSED. Production evaluation requires independent production
    // provisioning, recognized pinned verification roots, and externally
    // signed authority — inputs no request (and nothing in this repository)
    // can mint. Until they exist outside the repo, production mode refuses.
    refuseAdmission(
      "production mode is unavailable: independent production provisioning and externally signed authority are not present"
    );
  }
  if (!identityComplete(parsed.evidence_identity)) {
    refuseAdmission("evidence_identity must carry every bound identity field");
  }
  const receiptRefs = parsed.receipt_refs;
  if (!isPlainRecord(receiptRefs)) refuseAdmission("receipt_refs must be a record");
  const freshness = parsed.evidence_freshness;
  if (!isPlainRecord(freshness)) refuseAdmission("evidence_freshness must be a record");
  for (const stableId of MH09_STABLE_IDS) {
    const ref = receiptRefs[stableId];
    if (typeof ref !== "string" || ref.length === 0) {
      refuseAdmission(`receipt_refs must bind every owner scenario; ${stableId} is unbound`);
    }
    const verdict = freshness[stableId];
    if (NEUTRAL_EVIDENCE_FRESHNESS_VERDICTS.indexOf(verdict as never) === -1) {
      refuseAdmission(`evidence_freshness must carry a typed verdict for ${stableId}`);
    }
  }
  const scenarioEvidence = parsed.scenario_evidence;
  if (!isPlainRecord(scenarioEvidence)) refuseAdmission("scenario_evidence must be a record");
  for (const key of Object.keys(scenarioEvidence)) {
    if (MH09_STABLE_IDS.indexOf(key) === -1) {
      refuseAdmission(`scenario_evidence names ${JSON.stringify(key)}, which is not an owner scenario`);
    }
  }
  const scenario = parsed.scenario;
  if (scenario !== undefined && (typeof scenario !== "string" || MH09_STABLE_IDS.indexOf(scenario) === -1)) {
    refuseAdmission("scenario, when present, must name one owner scenario");
  }

  return parsed as unknown as Mh09EvaluationRequest;
}

// ---------------------------------------------------------------------------
// Per-scenario derivation — each drives the REAL cores
// ---------------------------------------------------------------------------

interface Mh09Derived {
  readonly disposition: NeutralDisposition;
  readonly reason_code: string | null;
  readonly observed: Readonly<Record<string, unknown>>;
}

const EVIDENCE_MISSING: Mh09Derived = neutralFreeze({
  disposition: "refused",
  reason_code: "scenario_evidence_incomplete",
  observed: { evidence_present: false },
}) as Mh09Derived;

/** The frozen expectation was not demonstrated by otherwise-present evidence. */
function undemonstrated(observed: Record<string, unknown>): Mh09Derived {
  return { disposition: "failed", reason_code: "scenario_result_mismatch", observed };
}

function stringOf(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" ? value : null;
}

function recordOf(record: Record<string, unknown>, key: string): Record<string, unknown> | null {
  const value = record[key];
  return isPlainRecord(value) ? value : null;
}

/**
 * Validate one embedded operation observation against the shape the REAL
 * release-distribution contract emits. Presence of a kind label is not an
 * observation — the destination and the observed manager identity/path are what
 * make it one.
 */
function operationObserved(value: unknown, kind: OperationEvidence["kind"]): boolean {
  if (!isPlainRecord(value)) return false;
  if (value.kind !== kind || value.outcome !== "succeeded") return false;
  if (typeof value.destination !== "string" || value.destination.length === 0) return false;
  const manager = value.manager;
  if (!isPlainRecord(manager)) return false;
  return (
    typeof manager.identity === "string" &&
    manager.identity.length > 0 &&
    typeof manager.path === "string" &&
    manager.path.length > 0
  );
}

/**
 * Drive the REAL `verifyReleaseClaim` over the bound claim and archive bytes,
 * and bind the claim to the evidence identity: the archive digest the claim
 * carries must BE the package hash the identity names, produced from the same
 * source commit. A claim that verifies but describes a different artifact is
 * not evidence about this release.
 */
function releaseClaimVerifies(
  evidence: Record<string, unknown>,
  identity: NeutralEvidenceIdentity
): { readonly ok: boolean; readonly errors: readonly string[] } {
  const claim = evidence.release_claim;
  const archiveBase64 = evidence.release_archive_base64;
  if (!isPlainRecord(claim) || typeof archiveBase64 !== "string" || archiveBase64.length === 0) {
    return { ok: false, errors: ["release claim or archive bytes absent"] };
  }
  let archive: Buffer;
  try {
    archive = Buffer.from(archiveBase64, "base64");
  } catch {
    return { ok: false, errors: ["archive bytes are not decodable"] };
  }
  let errors: string[];
  try {
    errors = verifyReleaseClaim(claim as unknown as ReleaseClaim, archive);
  } catch (error) {
    return { ok: false, errors: [String((error as Error)?.message ?? error)] };
  }
  if (errors.length > 0) return { ok: false, errors };
  const claimRecord = claim as unknown as Record<string, unknown>;
  if (`sha256:${String(claimRecord.archive_sha256)}` !== identity.package_hash) {
    return { ok: false, errors: ["claim archive digest disagrees with the bound package hash"] };
  }
  if (claimRecord.source_commit !== identity.source_commit) {
    return { ok: false, errors: ["claim source commit disagrees with the bound identity"] };
  }
  return { ok: true, errors: [] };
}

/** Seed a support record with the named dimensions already proven. */
function seededSupport(satisfied: readonly ("recognized" | "rendered" | "installed" | "activated")[]): NeutralSupportRecord {
  const record: Record<string, NeutralSupportStatus> = { ...NEUTRAL_UNEVALUATED_SUPPORT };
  for (const state of satisfied) record[state] = "satisfied";
  return record as unknown as NeutralSupportRecord;
}

/**
 * Map one REAL support-transition outcome onto a scenario derivation. The
 * disposition and reason code are the core's own — the evaluator never restates
 * the transition rule it just drove.
 */
function fromTransition(
  transition: ReturnType<typeof applyNeutralSupportTransition>,
  observed: Record<string, unknown>
): Mh09Derived {
  return {
    disposition: transition.outcome.disposition,
    reason_code: transition.outcome.reason_code,
    observed: { ...observed, support_record: { ...transition.record } },
  };
}

function deriveSup001(evidence: Record<string, unknown>, identity: NeutralEvidenceIdentity): Mh09Derived {
  const hostRecognized =
    evidence.host_recognized === true && NEUTRAL_RECOGNIZED_HOST_IDS.indexOf(identity.host_id) !== -1;
  const sourceBound = evidence.source_commit === identity.source_commit;
  const noArtifact = evidence.package_artifact_exists === false;
  const record = seededSupport(hostRecognized && sourceBound ? ["recognized"] : []);
  const claim = deriveNeutralSupportClaim(record);
  const observed = {
    host_recognized: hostRecognized,
    source_bound: sourceBound,
    package_artifact_exists: !noArtifact,
    proven: [...claim.proven],
    unproven: [...claim.unproven],
  };
  // Recognition proves ONLY recognized: with no package artifact, rendered must
  // remain unproven — the claim's own shape (no collapsed boolean) carries that.
  if (hostRecognized && sourceBound && noArtifact && claim.proven.length === 1 && claim.proven[0] === "recognized") {
    return { disposition: "succeeded", reason_code: null, observed };
  }
  return { disposition: "failed", reason_code: "support_operation_failed", observed };
}

function deriveSup002(evidence: Record<string, unknown>, identity: NeutralEvidenceIdentity): Mh09Derived {
  const recognized =
    evidence.host_recognized === true &&
    evidence.source_commit === identity.source_commit &&
    NEUTRAL_RECOGNIZED_HOST_IDS.indexOf(identity.host_id) !== -1;
  const renderProven =
    evidence.package_hash === identity.package_hash &&
    evidence.manifest_deterministic === true &&
    evidence.manager_or_destination_mutated === false;
  const transition = applyNeutralSupportTransition(seededSupport(recognized ? ["recognized"] : []), "render", {
    satisfied: renderProven,
  });
  // A prepared tree is not installed: the record itself must leave `installed`
  // unevaluated after a successful render.
  if (transition.outcome.disposition === "succeeded" && transition.record.installed !== "not_evaluated") {
    return undemonstrated({ render_promoted_beyond_itself: true });
  }
  return fromTransition(transition, { recognized, render_proven: renderProven });
}

function deriveSup003(evidence: Record<string, unknown>, identity: NeutralEvidenceIdentity): Mh09Derived {
  const renderBound = evidence.rendered_package_hash === identity.package_hash;
  const claimVerdict = releaseClaimVerifies(evidence, identity);
  const installObserved = operationObserved(evidence.install_operation, "install");
  const postWriteBound = evidence.post_write_hash === identity.package_hash;
  const installProven = claimVerdict.ok && installObserved && postWriteBound;
  const transition = applyNeutralSupportTransition(
    seededSupport(renderBound ? ["recognized", "rendered"] : ["recognized"]),
    "install",
    { satisfied: installProven }
  );
  return fromTransition(transition, {
    rendered_package_bound: renderBound,
    install_operation_observed: installObserved,
    post_write_bound: postWriteBound,
    release_claim_verified: claimVerdict.ok,
    release_claim_errors: [...claimVerdict.errors],
  });
}

function deriveSup004(evidence: Record<string, unknown>, identity: NeutralEvidenceIdentity): Mh09Derived {
  const installedBound = evidence.installed_package_hash === identity.package_hash;
  const claimVerdict = releaseClaimVerifies(evidence, identity);
  const activateOp = evidence.activate_operation;
  const activateObserved =
    operationObserved(activateOp, "activate") &&
    isPlainRecord(activateOp) &&
    activateOp.evidence_class === "operator";
  const discovery = recordOf(evidence, "runtime_discovery");
  const discoveryBound =
    discovery !== null &&
    discovery.active_version === identity.runtime_version &&
    discovery.active_package_hash === identity.package_hash;
  const requiredSurfaces = evidence.required_entry_surfaces;
  const discoveredSurfaces = discovery === null ? null : discovery.entry_surfaces;
  const surfacesBound =
    Array.isArray(requiredSurfaces) &&
    requiredSurfaces.length > 0 &&
    Array.isArray(discoveredSurfaces) &&
    requiredSurfaces.every((surface) => (discoveredSurfaces as unknown[]).indexOf(surface) !== -1);
  const activateProven = claimVerdict.ok && activateObserved && discoveryBound && surfacesBound;
  const transition = applyNeutralSupportTransition(
    seededSupport(installedBound ? ["recognized", "rendered", "installed"] : ["recognized", "rendered"]),
    "activate",
    { satisfied: activateProven }
  );
  return fromTransition(transition, {
    installed_package_bound: installedBound,
    activate_operator_observed: activateObserved,
    runtime_discovery_bound: discoveryBound,
    entry_surfaces_bound: surfacesBound,
    release_claim_verified: claimVerdict.ok,
    release_claim_errors: [...claimVerdict.errors],
  });
}

function deriveSup005(evidence: Record<string, unknown>, identity: NeutralEvidenceIdentity): Mh09Derived {
  const before = recordOf(evidence, "before_discovery");
  const after = recordOf(evidence, "after_discovery");
  const beforeObserved =
    before !== null && typeof before.active_version === "string" && typeof before.active_package_hash === "string";
  const afterObserved =
    after !== null && typeof after.active_version === "string" && typeof after.active_package_hash === "string";
  const changed =
    beforeObserved &&
    afterObserved &&
    (before?.active_version !== after?.active_version || before?.active_package_hash !== after?.active_package_hash);
  const afterBound =
    afterObserved && after?.active_version === identity.runtime_version && after?.active_package_hash === identity.package_hash;
  const claimVerdict = releaseClaimVerifies(evidence, identity);
  const updateObserved = operationObserved(evidence.update_operation, "update");
  const destinationStable = evidence.destination_unchanged === true;
  const updateProven = beforeObserved && afterObserved && changed && afterBound && claimVerdict.ok && updateObserved && destinationStable;
  // An update presupposes an installed runtime, which is exactly what a BEFORE
  // discovery observes; a render-only refresh observes nothing on either side
  // and is refused by the core's own precondition chain.
  const transition = applyNeutralSupportTransition(
    seededSupport(beforeObserved ? ["recognized", "rendered", "installed"] : ["recognized", "rendered"]),
    "update",
    { satisfied: updateProven }
  );
  return fromTransition(transition, {
    before_discovery_observed: beforeObserved,
    after_discovery_observed: afterObserved,
    version_changed: changed,
    after_bound_to_identity: afterBound,
    update_operation_observed: updateObserved,
    destination_unchanged: destinationStable,
    release_claim_verified: claimVerdict.ok,
    release_claim_errors: [...claimVerdict.errors],
  });
}

function deriveSup006(evidence: Record<string, unknown>, identity: NeutralEvidenceIdentity): Mh09Derived {
  const activated = evidence.activated_identity;
  const identityExact =
    identityComplete(activated) &&
    NEUTRAL_EVIDENCE_IDENTITY_FIELDS.every(
      (field) =>
        (activated as unknown as Record<string, unknown>)[field] ===
        (identity as unknown as Record<string, unknown>)[field]
    );
  const manifestComplete = evidence.scenario_verdict_manifest_complete === true;
  const hashesResolve = evidence.all_evidence_hashes_resolve === true;
  const verifyProven = identityExact && manifestComplete && hashesResolve;
  const transition = applyNeutralSupportTransition(
    seededSupport(
      identityExact ? ["recognized", "rendered", "installed", "activated"] : ["recognized", "rendered", "installed"]
    ),
    "verify",
    { satisfied: verifyProven }
  );
  return fromTransition(transition, {
    activated_identity_exact: identityExact,
    scenario_verdict_manifest_complete: manifestComplete,
    all_evidence_hashes_resolve: hashesResolve,
  });
}

function deriveVer001(evidence: Record<string, unknown>): Mh09Derived {
  const prior = evidence.prior_verdict_identity;
  const current = evidence.current_identity;
  if (!identityComplete(prior) || !identityComplete(current)) {
    return EVIDENCE_MISSING;
  }
  const changed = NEUTRAL_EVIDENCE_IDENTITY_FIELDS.filter(
    (field) =>
      (prior as unknown as Record<string, unknown>)[field] !==
      (current as unknown as Record<string, unknown>)[field]
  );
  // Identity decides; age NEVER does. Any `claimed_still_valid_by_age` member is
  // deliberately unread: a drifted identity is refused however recent, and an
  // identical identity is not a drift whatever its age claims.
  if (changed.length > 0) {
    return {
      disposition: "refused",
      reason_code: "evidence_version_drift",
      observed: { changed_fields: changed, field_count: changed.length },
    };
  }
  return undemonstrated({ changed_fields: [], age_ignored: true });
}

function deriveVer002(evidence: Record<string, unknown>): Mh09Derived {
  const consumer = evidence.consumer_pinned_major;
  const producer = evidence.producer_contract_major;
  if (typeof consumer !== "number" || !Number.isInteger(consumer) || typeof producer !== "number" || !Number.isInteger(producer)) {
    return EVIDENCE_MISSING;
  }
  // A major mismatch is a typed unsupported BEFORE any parse: the bundle hash is
  // recorded as observed, never opened.
  if (consumer !== producer) {
    return {
      disposition: "unsupported",
      reason_code: "contract_major_mismatch",
      observed: {
        consumer_pinned_major: consumer,
        producer_contract_major: producer,
        bundle_parsed: false,
        bundle_hash: stringOf(evidence, "bundle_hash"),
      },
    };
  }
  return undemonstrated({ consumer_pinned_major: consumer, producer_contract_major: producer });
}

function deriveVer003(evidence: Record<string, unknown>): Mh09Derived {
  const expected = recordOf(evidence, "expected");
  const observedDiscovery = recordOf(evidence, "observed_runtime_discovery");
  if (expected === null || observedDiscovery === null) return EVIDENCE_MISSING;
  const comparisons: Array<{ field: string; expected: unknown; observed: unknown }> = [
    { field: "package_hash", expected: expected.package_hash, observed: observedDiscovery.active_package_hash },
    { field: "runtime_version", expected: expected.runtime_version, observed: observedDiscovery.active_version },
    { field: "destination", expected: expected.destination, observed: observedDiscovery.destination },
  ];
  const mismatched = comparisons.filter((row) => row.expected !== row.observed);
  if (mismatched.length > 0) {
    return {
      disposition: "failed",
      reason_code: "package_runtime_mismatch",
      observed: { mismatched, expected, observed_runtime_discovery: observedDiscovery },
    };
  }
  return undemonstrated({ mismatched: [] });
}

function deriveScenario(
  stableId: string,
  evidence: unknown,
  identity: NeutralEvidenceIdentity
): Mh09Derived {
  if (!isPlainRecord(evidence)) return EVIDENCE_MISSING;
  switch (stableId) {
    case "MHRC-SUP-001":
      return deriveSup001(evidence, identity);
    case "MHRC-SUP-002":
      return deriveSup002(evidence, identity);
    case "MHRC-SUP-003":
      return deriveSup003(evidence, identity);
    case "MHRC-SUP-004":
      return deriveSup004(evidence, identity);
    case "MHRC-SUP-005":
      return deriveSup005(evidence, identity);
    case "MHRC-SUP-006":
      return deriveSup006(evidence, identity);
    case "MHRC-VER-001":
      return deriveVer001(evidence);
    case "MHRC-VER-002":
      return deriveVer002(evidence);
    case "MHRC-VER-003":
      return deriveVer003(evidence);
    default:
      return EVIDENCE_MISSING;
  }
}

// ---------------------------------------------------------------------------
// The evaluator
// ---------------------------------------------------------------------------

/**
 * Evaluate the nine `W5/MH-09` scenarios from one canonical request text.
 *
 * Always evaluates the COMPLETE source-owned scenario set and always emits one
 * packet covering all nine ids — evidence a caller did not supply produces a
 * typed non-success for that scenario, never a shrunken packet and never a
 * manufactured success. The top-level outcome derives `succeeded` ONLY when
 * every scenario resolves to its frozen expected disposition AND (for the
 * `MHRC-VER-*` rows) its exact required reason code.
 */
export function evaluateReleaseConformance(requestText: unknown): Mh09EvaluationResult {
  const request = admitRequest(requestText);
  const identity = request.evidence_identity;

  const derivations: Record<string, Mh09Derived> = {};
  for (const stableId of MH09_STABLE_IDS) {
    derivations[stableId] = deriveScenario(stableId, request.scenario_evidence[stableId], identity);
  }

  const results: NeutralScenarioResult[] = MH09_STABLE_IDS.map((stableId) => {
    const derived = derivations[stableId];
    return {
      stable_id: stableId,
      outcome_type: MH09_EXPECTED[stableId].type,
      disposition: derived.disposition,
      reason_code: derived.reason_code,
      receipt_ref: request.receipt_refs[stableId],
      evidence_identity: { ...(identity as unknown as Record<string, unknown>) } as unknown as NeutralEvidenceIdentity,
      evidence_freshness: request.evidence_freshness[stableId] as NeutralScenarioResult["evidence_freshness"],
    };
  });

  const matchesExpected = MH09_STABLE_IDS.every((stableId) => {
    const derived = derivations[stableId];
    const expected = MH09_EXPECTED[stableId];
    return derived.disposition === expected.disposition && derived.reason_code === expected.reason_code;
  });
  const anyEvidenceIncomplete = MH09_STABLE_IDS.some(
    (stableId) => derivations[stableId].reason_code === "scenario_evidence_incomplete"
  );

  const packet: NeutralOwnerConformancePacket = neutralFreeze({
    schema_version: NEUTRAL_ASSEMBLY_PACKET_SCHEMA,
    suite_id: NEUTRAL_SCENARIO_SUITE_ID,
    suite_version: NEUTRAL_SCENARIO_SUITE_VERSION,
    owner_key: MH09_OWNER_KEY,
    evidence_identity: { ...(identity as unknown as Record<string, unknown>) } as unknown as NeutralEvidenceIdentity,
    stable_ids: [...MH09_STABLE_IDS],
    results,
  }) as unknown as NeutralOwnerConformancePacket;

  const evidenceFacts = MH09_STABLE_IDS.map((stableId) => ({
    stable_id: stableId,
    disposition: derivations[stableId].disposition,
    reason_code: derivations[stableId].reason_code,
    observed: derivations[stableId].observed,
  }));

  const outcome = neutralOutcome({
    type: "guild.version_compatibility_outcome.v1",
    disposition: matchesExpected ? "succeeded" : anyEvidenceIncomplete ? "refused" : "failed",
    reason_code: matchesExpected
      ? null
      : anyEvidenceIncomplete
        ? ("scenario_evidence_incomplete" as never)
        : ("scenario_result_mismatch" as never),
    assertions: [
      "each of the nine W5/MH-09 scenarios was evaluated against the real support-state and release-distribution cores",
      "install/activate/update proofs drive the real verifyReleaseClaim over the bound claim and archive bytes",
      "version drift is compared over the complete bound identity tuple; age never substitutes for identity",
      "a fixture-mode packet proves mechanics only and is never promotable",
    ],
    binding: { run_id: request.run_id },
    facts: {
      owner_key: MH09_OWNER_KEY,
      suite_id: NEUTRAL_SCENARIO_SUITE_ID,
      suite_version: NEUTRAL_SCENARIO_SUITE_VERSION,
      evaluator_version: MH09_EVALUATOR_VERSION,
      mode: request.mode,
      claimant_id: request.claimant_id,
      focused_scenario: request.scenario ?? null,
      evidence: evidenceFacts,
    },
  });

  return neutralFreeze({
    outcome,
    packet,
    promotable: false as const,
    mode: request.mode,
  }) as unknown as Mh09EvaluationResult;
}
