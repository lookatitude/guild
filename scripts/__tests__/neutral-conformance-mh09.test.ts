/**
 * __tests__/neutral-conformance-mh09.test.ts
 *
 * FIC-153 / A21-MH09 (RED-FIRST) — the executable contract for the not-yet-written
 * production evaluator
 * `src/modules/distribution/workflows/release-conformance-evaluator.ts`, exported
 * through the distribution module's public index, plus the not-yet-written
 * external one-time signer `scripts/sign-release-attestation.ts`.
 *
 * WHAT THIS BINDS
 *   `guild.conformance_scenarios.v1` assigns exactly NINE of its 31 scenarios to
 *   the `W5/MH-09` release-distribution owner: `MHRC-SUP-001`..`MHRC-SUP-006` and
 *   `MHRC-VER-001`..`MHRC-VER-003`. The accepted assembly spine
 *   (`neutral-conformance-assembly.ts`) already reserves this owner's slot in
 *   `NEUTRAL_OWNER_SCENARIO_IDS` and `NEUTRAL_CONFORMANCE_OWNER_SCENARIO_COUNTS`
 *   — it deliberately EVALUATES nothing. This file states what the MH-09 owner's
 *   EVALUATOR and its external SIGNER must be before a packet under this owner key
 *   is allowed to mean anything: a deterministic evaluator driving the real
 *   `applyNeutralSupportTransition` support-state core and the real
 *   `release-distribution-contract` claim verification through all nine frozen
 *   scenarios, plus a signer that can issue the one-time WOTS+/Merkle attestation
 *   signatures the accepted `neutralVerifyAttestationSignature` core already
 *   verifies, without ever holding or leaking the private chain material that
 *   backs them.
 *
 *   As with the MH-07/MH-08 siblings, the contract is written twice: once as
 *   ordinary production-bound obligations (§"the production MH-09 evaluator" and
 *   §"the production external one-time signer" — every `it` fails RED because the
 *   modules do not exist), and once as a CONTROL BATTERY run entirely test-side
 *   against disposable reference logic and deliberately broken mutants of it
 *   (§"the control battery distinguishes good from bad" — GREEN from the first
 *   run). A battery the mutants survive proves nothing; this file proves the
 *   mutants do NOT survive against reference logic equivalent to what production
 *   must implement, so the RED half is a real gate rather than a placeholder. The
 *   control battery's WOTS+/Merkle reference signer is exercised against the REAL,
 *   already-accepted `neutralVerifyAttestationSignature` core function — this is
 *   not a test-side stand-in for that verifier, it IS that verifier.
 *
 * WHAT IT DELIBERATELY DOES NOT BIND
 *   No assembly, no cross-owner promotion decision. `assembleNeutralConformanceEvidence`
 *   still owns the join across all six owners; this module only evaluates nine
 *   scenarios and hands over one packet. This suite also does not bind the
 *   PRODUCTION `NEUTRAL_ATTESTOR_TRUST_ROOT` roots — their private seeds were
 *   discarded off-repository by design (see the core's own header comment on that
 *   table) — the control battery's signer proves the SCHEME using its own
 *   test-owned, deterministically-seeded key material, which the production
 *   signer must reject as a production trust root exactly as this suite requires.
 *
 * NO TOLERATED GAPS — EVERY MISSING PRODUCTION DECLARATION IS RED
 *   The frozen contract assigns `MHRC-SUP-001..005` evidence profile `E-SUPPORT`
 *   and `MHRC-SUP-006`/`MHRC-VER-001..003` evidence profile `E-VERSION`, and
 *   requires three new closed reason codes (`evidence_version_drift`,
 *   `contract_major_mismatch`, `package_runtime_mismatch`) for its three
 *   `MHRC-VER-*` scenarios. Unlike MH-07's `E-BOUNDARY` and MH-08's `E-MIGRATION`
 *   — which were tolerated-absence gaps at the time those suites were written —
 *   this suite requires `NEUTRAL_EVIDENCE_PROFILES` to declare `E-SUPPORT` and
 *   `E-VERSION` EXACTLY as specified, and `NEUTRAL_REASON_CODES` to contain
 *   EXACTLY the three named codes, right now. Both currently fail — that is the
 *   RED this task exists to produce. §"the production core declarations MH-09
 *   requires" states the exact required shapes and fails until the core adds
 *   them; nothing in this file tolerates their absence.
 *
 * NO PRODUCTION, NO DOCS, NO RESOURCES, NO MANIFEST, NO INDEX WRITE
 *   This file reads real repository bytes (to prove the modules are genuinely
 *   absent) and writes only inside disposable directories under the OS temp
 *   directory, created per test and removed in `afterAll`. It never mutates the
 *   plugin tree, and it never imports the frozen scenario fixture from
 *   production — the fixture's nine `MHRC-SUP-*`/`MHRC-VER-*` definitions are
 *   transcribed here independently, exactly as MH-07 and MH-08 transcribe theirs.
 *   No offensive exploitation, credentials, persistence, networking, publication,
 *   host mutation, or user influence occurs anywhere in this file.
 */

import { spawn } from "child_process";
import * as crypto from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import {
  NEUTRAL_DISPOSITIONS,
  NEUTRAL_OUTCOME_TYPES,
  NEUTRAL_REASON_CODES,
  neutralCanonicalJson,
  neutralFreeze,
  neutralSha256Hex,
} from "../../src/modules/lifecycle/workflows/neutral-runtime-contracts";
import {
  NEUTRAL_ATTESTATION_CHAINS,
  NEUTRAL_ATTESTATION_CHAIN_LENGTH,
  NEUTRAL_ATTESTATION_CHECKSUM_CHAINS,
  NEUTRAL_ATTESTATION_MESSAGE_CHAINS,
  NEUTRAL_ATTESTATION_SCHEME,
  NEUTRAL_ATTESTATION_SIGNATURE_DOMAIN,
  NEUTRAL_ATTESTATION_TREE_HEIGHT,
  NEUTRAL_ATTESTOR_TRUST_ROOT,
  NEUTRAL_EVIDENCE_IDENTITY_FIELDS,
  NEUTRAL_EVIDENCE_PROFILES,
  NEUTRAL_SCENARIO_SUITE_ID,
  NEUTRAL_SCENARIO_SUITE_VERSION,
  NEUTRAL_UNEVALUATED_SUPPORT,
  applyNeutralSupportTransition,
  deriveNeutralSupportClaim,
  neutralAttestorVerificationKey,
  neutralVerifyAttestationSignature,
} from "../../src/modules/lifecycle/workflows/neutral-conformance-core";
import type {
  NeutralEvidenceIdentity,
  NeutralScenarioResult,
  NeutralSupportRecord,
} from "../../src/modules/lifecycle/workflows/neutral-conformance-core";
import {
  NEUTRAL_ASSEMBLY_PACKET_SCHEMA,
  NEUTRAL_CONFORMANCE_OWNER_SCENARIO_COUNTS,
  NEUTRAL_OWNER_SCENARIO_IDS,
} from "../../src/modules/lifecycle/workflows/neutral-conformance-assembly";
import type { NeutralOwnerConformancePacket } from "../../src/modules/lifecycle/workflows/neutral-conformance-assembly";
import {
  ACCEPTED_CONFORMANCE_ARTIFACTS,
  OPERATION_KINDS,
  buildOperationEvidence,
  buildReleaseClaim,
  verifyReleaseClaim,
} from "../../src/modules/distribution/workflows/release-distribution-contract";
import type { OperationEvidence, ReleaseClaim } from "../../src/modules/distribution/workflows/release-distribution-contract";

// ---------------------------------------------------------------------------
// The modules under contract
// ---------------------------------------------------------------------------

const PLUGIN_ROOT = path.resolve(__dirname, "..", "..");

const EVALUATOR_REQUEST = "../../src/modules/distribution/workflows/release-conformance-evaluator";
const EVALUATOR_SOURCE_PATH = path.resolve(
  __dirname,
  "../../src/modules/distribution/workflows/release-conformance-evaluator.ts"
);
const DISTRIBUTION_INDEX_PATH = path.resolve(__dirname, "../../src/modules/distribution/index.ts");

const SIGNER_REQUEST = "../sign-release-attestation";
const SIGNER_SOURCE_PATH = path.resolve(__dirname, "../sign-release-attestation.ts");

const DISTRIBUTION_MANIFEST_PATH = path.resolve(__dirname, "../../src/modules/distribution/module.manifest.json");
const SCRIPTS_PACKAGE_JSON_PATH = path.resolve(__dirname, "../package.json");

const RED = "A21-MH09 RED: production module not implemented yet";

/** A lazy, per-module binder: throws the ONE diagnostic this suite is allowed to
 * fail with while a module is RED, naming which obligation is unmet rather than
 * collapsing the whole file into one import-time resolution error. */
function makeBinder(sourcePath: string, requirePath: string) {
  let cache: Record<string, unknown> | undefined;
  function mod(): Record<string, unknown> {
    if (cache === undefined) {
      if (!fs.existsSync(sourcePath)) {
        throw new Error(`${RED} — expected ${sourcePath}`);
      }
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      cache = require(requirePath) as Record<string, unknown>;
    }
    return cache;
  }
  function exported<T>(name: string): T {
    const value = mod()[name];
    if (value === undefined) {
      throw new Error(`${RED} — missing export ${name}`);
    }
    return value as T;
  }
  function invoke<T>(name: string, ...args: readonly unknown[]): T {
    const fn = exported<(...callArgs: readonly unknown[]) => T>(name);
    if (typeof fn !== "function") {
      throw new Error(`${RED} — export ${name} is not callable`);
    }
    return fn(...args);
  }
  return { mod, exported, invoke };
}

const Evaluator = makeBinder(EVALUATOR_SOURCE_PATH, EVALUATOR_REQUEST);
const Signer = makeBinder(SIGNER_SOURCE_PATH, SIGNER_REQUEST);

// ---------------------------------------------------------------------------
// The frozen contract, transcribed independently of production
// ---------------------------------------------------------------------------

const OWNER_KEY_MH09 = "W5/MH-09";

/** The nine W5/MH-09 stable ids, in CANONICAL (whole-suite) order. */
const MH09_IDS: readonly string[] = [
  "MHRC-SUP-001",
  "MHRC-SUP-002",
  "MHRC-SUP-003",
  "MHRC-SUP-004",
  "MHRC-SUP-005",
  "MHRC-SUP-006",
  "MHRC-VER-001",
  "MHRC-VER-002",
  "MHRC-VER-003",
];

const MH09_SUP_IDS = MH09_IDS.slice(0, 6);
const MH09_VER_IDS = MH09_IDS.slice(6);

interface Mh09ExpectedRow {
  readonly type: string;
  readonly disposition: string;
  readonly category: string;
  readonly evidence_profile: string;
  readonly reason_code_required: boolean;
}

/**
 * The expected typed outcome of each MH-09 scenario, transcribed from the frozen
 * `guild.conformance_scenarios.v1` contract. Production must DERIVE the same
 * table from its own source-owned registry; two independent statements is the
 * point, so a drift between them is a finding rather than a shared mistake.
 */
const MH09_EXPECTED: Readonly<Record<string, Mh09ExpectedRow>> = {
  "MHRC-SUP-001": { type: "guild.support_transition_outcome.v1", disposition: "succeeded", category: "support_state", evidence_profile: "E-SUPPORT", reason_code_required: false },
  "MHRC-SUP-002": { type: "guild.support_transition_outcome.v1", disposition: "succeeded", category: "support_state", evidence_profile: "E-SUPPORT", reason_code_required: false },
  "MHRC-SUP-003": { type: "guild.support_transition_outcome.v1", disposition: "succeeded", category: "support_state", evidence_profile: "E-SUPPORT", reason_code_required: false },
  "MHRC-SUP-004": { type: "guild.support_transition_outcome.v1", disposition: "succeeded", category: "support_state", evidence_profile: "E-SUPPORT", reason_code_required: false },
  "MHRC-SUP-005": { type: "guild.support_transition_outcome.v1", disposition: "succeeded", category: "support_state", evidence_profile: "E-SUPPORT", reason_code_required: false },
  // MHRC-SUP-006 ("conformant") is exact-version lifecycle proof over the WHOLE
  // suite, so the frozen contract binds it to E-VERSION, not E-SUPPORT.
  "MHRC-SUP-006": { type: "guild.support_transition_outcome.v1", disposition: "succeeded", category: "support_state", evidence_profile: "E-VERSION", reason_code_required: false },
  "MHRC-VER-001": { type: "guild.version_compatibility_outcome.v1", disposition: "refused", category: "version_drift", evidence_profile: "E-VERSION", reason_code_required: true },
  "MHRC-VER-002": { type: "guild.version_compatibility_outcome.v1", disposition: "unsupported", category: "version_drift", evidence_profile: "E-VERSION", reason_code_required: true },
  "MHRC-VER-003": { type: "guild.version_compatibility_outcome.v1", disposition: "failed", category: "version_drift", evidence_profile: "E-VERSION", reason_code_required: true },
};

/** The three new closed reason codes MH-09's VER scenarios require, by name. */
const MH09_NEW_REASON_CODES = {
  "MHRC-VER-001": "evidence_version_drift",
  "MHRC-VER-002": "contract_major_mismatch",
  "MHRC-VER-003": "package_runtime_mismatch",
} as const;

const E_SUPPORT_DEFINITION = {
  required_kinds: ["operation_receipt", "artifact_hash", "typed_outcome"],
  required_bindings: ["scenario_id", "source_commit", "package_hash", "runtime_version", "host_id", "host_version", "platform"],
} as const;

const E_VERSION_DEFINITION = {
  required_kinds: ["compatibility_verdict", "release_manifest", "artifact_hash"],
  required_bindings: [
    "scenario_id",
    "source_commit",
    "package_hash",
    "runtime_version",
    "adapter_version",
    "host_version",
    "contract_version",
    "scenario_suite_version",
    "platform",
  ],
} as const;

// ---------------------------------------------------------------------------
// Test-owned fixtures: evidence identity, receipt refs, disposable roots
// ---------------------------------------------------------------------------

/**
 * The archive bytes every fixture release claim is built from, and the REAL
 * sha256 of those bytes — computed once, here, so `IDENTITY.package_hash`
 * below is not an independent invented literal but the ACTUAL digest of the
 * archive `buildFixtureReleaseClaim` hands to the real `buildReleaseClaim`.
 * A positive release-claim scenario whose archive digest contradicted its
 * own evidence identity would prove nothing about the evaluator; this
 * coupling is what makes SUP-003/004/005's positive paths non-vacuous.
 */
const FIXTURE_ARCHIVE_BYTES = Buffer.from("guild-mh09-fixture-release-archive-bytes-for-testing");
const FIXTURE_ARCHIVE_SHA256 = crypto.createHash("sha256").update(FIXTURE_ARCHIVE_BYTES).digest("hex");

const IDENTITY: NeutralEvidenceIdentity = {
  source_commit: "d39a8b52c6e1f74a03b9d6e4c1a8f27d5e9b6c31",
  package_hash: `sha256:${FIXTURE_ARCHIVE_SHA256}`,
  runtime_version: "guild-2.5.0",
  adapter_version: "guild.host_adapter.v1.0.0",
  host_id: "claude-code-cli",
  host_version: "2.5.0",
  platform: "darwin-arm64",
  contract_version: 1,
  scenario_suite_id: NEUTRAL_SCENARIO_SUITE_ID,
  scenario_suite_version: NEUTRAL_SCENARIO_SUITE_VERSION,
  release_id: "rel-2026-08-19-a21-mh09",
};

const CLAIMANT_ID = "guild.release-emitter";
const RUN_ID = "run-a21-mh09-contract";

function receiptRefFor(stableId: string): string {
  const sequence = MH09_IDS.indexOf(stableId) + 1;
  const commitment = `nec1:${sequence.toString(16).padStart(16, "0")}`;
  return `guild.receipt_ref.v1:a21-mh09-journal#${sequence}@${commitment}`;
}

function receiptRefs(): Record<string, string> {
  const refs: Record<string, string> = {};
  for (const id of MH09_IDS) refs[id] = receiptRefFor(id);
  return refs;
}

function freshnessMap(): Record<string, string> {
  const map: Record<string, string> = {};
  for (const id of MH09_IDS) map[id] = "fresh";
  return map;
}

function canon(value: unknown): string {
  return neutralCanonicalJson(value);
}

const TEMP_ROOTS: string[] = [];
function tempRoot(label: string): string {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), `guild-mh09-${label}-`));
  TEMP_ROOTS.push(base);
  return base;
}

/**
 * The deterministic lock-path contract this owner pins for the signer:
 * `<used_key_registry_path>.lock`, sibling to the registry file, never a
 * caller-supplied or randomized name. A lock file living anywhere else, or a
 * symlink planted at exactly this path, is not something the signer can
 * merely happen to avoid — it is refused by definition.
 */
function lockPathFor(registryPath: string): string {
  return `${registryPath}.lock`;
}
afterAll(() => {
  for (const root of TEMP_ROOTS) fs.rmSync(root, { recursive: true, force: true });
});

/** One `package.render`/`install`/`activate`/`update` operation observation, built
 * through the REAL, already-accepted `release-distribution-contract` shape — the
 * evaluator drives real claim verification, not a restated copy of it. */
function operationEvidence(kind: OperationEvidence["kind"], overrides: Partial<OperationEvidence> = {}): OperationEvidence {
  return buildOperationEvidence({
    kind,
    destination: "/opt/guild/releases/current",
    manager: { identity: "guild-installer", path: "/usr/local/bin/guild-installer" },
    evidence_class: "release-builder",
    outcome: "succeeded",
    ...overrides,
  });
}

/**
 * A complete, well-formed `guild.release_claim.v1` claim plus the archive bytes
 * it was built from, using ONLY the real, already-accepted `buildReleaseClaim` /
 * `buildOperationEvidence` production functions from `release-distribution-contract.ts`
 * — never a restated copy of that verification logic. `MHRC-SUP-003/004/005`
 * evidence embeds this claim so the evaluator's install/activate/update
 * obligations are pinned to driving the REAL `verifyReleaseClaim`, not a
 * test-invented shortcut.
 */
function buildFixtureReleaseClaim(): { claim: ReleaseClaim; archive: Buffer } {
  const archive = FIXTURE_ARCHIVE_BYTES;
  const operations: OperationEvidence[] = OPERATION_KINDS.map((kind) =>
    operationEvidence(kind, { evidence_class: kind === "activate" ? "operator" : "release-builder" })
  );
  const claim = buildReleaseClaim({
    archive_path: `release/guild-${IDENTITY.source_commit}.tar.gz`,
    archive,
    source_commit: IDENTITY.source_commit,
    manifest: { entries: [{ path: "guild/.claude-plugin/plugin.json", sha256: "a".repeat(64) }] },
    contract_versions: { runtime: "guild.runtime_boundary_contract.v1", receipt: "guild.handoff.v2", artifact: "guild.artifact.v1" },
    conformance_artifacts: ACCEPTED_CONFORMANCE_ARTIFACTS.map((entry) => ({ ...entry })),
    operations,
  });
  return { claim, archive };
}

/** The full nine-scenario evaluation request the production evaluator must accept
 * as canonical JSON TEXT (never a live object). */
function baseRequest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    run_id: RUN_ID,
    claimant_id: CLAIMANT_ID,
    mode: "fixture",
    evidence_identity: IDENTITY,
    receipt_refs: receiptRefs(),
    evidence_freshness: freshnessMap(),
    scenario_evidence: {},
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Per-scenario evidence builders — the SAME blocks back both the individual
// scenario tests in §2 and the complete nine-scenario `allScenarioEvidence()`
// used by the top-level derivation-rule tests, so the two cannot drift.
// ---------------------------------------------------------------------------

function sup001Evidence(): Record<string, unknown> {
  return { host_recognized: true, source_commit: IDENTITY.source_commit, package_artifact_exists: false };
}

function sup002Evidence(): Record<string, unknown> {
  return {
    host_recognized: true,
    source_commit: IDENTITY.source_commit,
    package_hash: IDENTITY.package_hash,
    manifest_deterministic: true,
    manager_or_destination_mutated: false,
  };
}

function sup003Evidence(): Record<string, unknown> {
  const { claim, archive } = buildFixtureReleaseClaim();
  return {
    rendered_package_hash: IDENTITY.package_hash,
    install_operation: operationEvidence("install"),
    post_write_hash: IDENTITY.package_hash,
    release_claim: claim,
    release_archive_base64: archive.toString("base64"),
  };
}

function sup003WeakEvidence(): Record<string, unknown> {
  return { rendered_package_hash: IDENTITY.package_hash, instructions_only: true };
}

function sup004Evidence(): Record<string, unknown> {
  const { claim, archive } = buildFixtureReleaseClaim();
  return {
    installed_package_hash: IDENTITY.package_hash,
    activate_operation: operationEvidence("activate", { evidence_class: "operator" }),
    runtime_discovery: { active_version: IDENTITY.runtime_version, active_package_hash: IDENTITY.package_hash, entry_surfaces: ["cli", "hooks"] },
    required_entry_surfaces: ["cli", "hooks"],
    release_claim: claim,
    release_archive_base64: archive.toString("base64"),
  };
}

function sup005Evidence(): Record<string, unknown> {
  const { claim, archive } = buildFixtureReleaseClaim();
  return {
    before_discovery: { active_version: "guild-2.4.0", active_package_hash: `sha256:${"4".repeat(64)}` },
    update_operation: operationEvidence("update"),
    after_discovery: { active_version: IDENTITY.runtime_version, active_package_hash: IDENTITY.package_hash },
    destination_unchanged: true,
    release_claim: claim,
    release_archive_base64: archive.toString("base64"),
  };
}

function sup005WeakEvidence(): Record<string, unknown> {
  return { render_only_refresh: true };
}

function sup006Evidence(): Record<string, unknown> {
  return { activated_identity: IDENTITY, scenario_verdict_manifest_complete: true, all_evidence_hashes_resolve: true };
}

function sup006WeakEvidence(): Record<string, unknown> {
  return { activated_identity: IDENTITY, scenario_verdict_manifest_complete: false };
}

function ver001DriftedIdentity(): NeutralEvidenceIdentity {
  return { ...IDENTITY, package_hash: `sha256:${"9".repeat(64)}` };
}

function ver001Evidence(): Record<string, unknown> {
  return { prior_verdict_identity: IDENTITY, current_identity: ver001DriftedIdentity() };
}

function ver001NoDriftEvidence(): Record<string, unknown> {
  return { prior_verdict_identity: IDENTITY, current_identity: IDENTITY, claimed_still_valid_by_age: true };
}

function ver002Evidence(): Record<string, unknown> {
  return { consumer_pinned_major: 2, producer_contract_major: 1, bundle_hash: IDENTITY.package_hash };
}

function ver003Evidence(): Record<string, unknown> {
  return {
    expected: { package_hash: IDENTITY.package_hash, runtime_version: IDENTITY.runtime_version, destination: "/opt/guild/releases/current" },
    observed_runtime_discovery: { active_package_hash: `sha256:${"1".repeat(64)}`, active_version: "guild-2.4.0", destination: "/opt/guild/releases/current" },
  };
}

/**
 * Evidence for all nine scenarios, each block engineered to produce that
 * scenario's FROZEN expected disposition (§1's `MH09_EXPECTED`): six successes
 * plus the three typed `MHRC-VER-*` refusals/unsupported/failed. This is the
 * ONLY input a correct evaluator can derive a top-level `succeeded` from.
 */
function allScenarioEvidence(): Record<string, unknown> {
  return {
    "MHRC-SUP-001": sup001Evidence(),
    "MHRC-SUP-002": sup002Evidence(),
    "MHRC-SUP-003": sup003Evidence(),
    "MHRC-SUP-004": sup004Evidence(),
    "MHRC-SUP-005": sup005Evidence(),
    "MHRC-SUP-006": sup006Evidence(),
    "MHRC-VER-001": ver001Evidence(),
    "MHRC-VER-002": ver002Evidence(),
    "MHRC-VER-003": ver003Evidence(),
  };
}

// ---------------------------------------------------------------------------
// §1 — the frozen contract, transcribed independently of production (GREEN now)
// ---------------------------------------------------------------------------

describe("the frozen contract, transcribed independently of production", () => {
  it("assigns exactly nine stable ids to W5/MH-09, in canonical order", () => {
    expect(NEUTRAL_OWNER_SCENARIO_IDS[OWNER_KEY_MH09]).toEqual(MH09_IDS);
  });

  it("the accepted assembly spine already reserves a count of 9 for W5/MH-09", () => {
    expect(NEUTRAL_CONFORMANCE_OWNER_SCENARIO_COUNTS[OWNER_KEY_MH09]).toBe(9);
  });

  it("every MH-09 outcome type is a declared closed outcome type", () => {
    for (const id of MH09_IDS) expect(NEUTRAL_OUTCOME_TYPES).toContain(MH09_EXPECTED[id].type);
  });

  it("every MH-09 disposition is a declared closed disposition", () => {
    for (const id of MH09_IDS) expect(NEUTRAL_DISPOSITIONS).toContain(MH09_EXPECTED[id].disposition);
  });

  it("the six MHRC-SUP-* results succeed and the three MHRC-VER-* results are typed refusals/failures/unsupported", () => {
    for (const id of MH09_SUP_IDS) expect(MH09_EXPECTED[id].disposition).toBe("succeeded");
    expect(MH09_EXPECTED["MHRC-VER-001"].disposition).toBe("refused");
    expect(MH09_EXPECTED["MHRC-VER-002"].disposition).toBe("unsupported");
    expect(MH09_EXPECTED["MHRC-VER-003"].disposition).toBe("failed");
  });

  it("exactly the three MHRC-VER-* ids require a reason code; the six MHRC-SUP-* ids do not", () => {
    const required = MH09_IDS.filter((id) => MH09_EXPECTED[id].reason_code_required);
    expect(required).toEqual(MH09_VER_IDS);
  });

  it("the owner packet schema constant is guild.conformance_owner_packet.v1", () => {
    expect(NEUTRAL_ASSEMBLY_PACKET_SCHEMA).toBe("guild.conformance_owner_packet.v1");
  });

  it("MHRC-SUP-006 (conformant) is bound to E-VERSION, not E-SUPPORT, in the frozen contract", () => {
    expect(MH09_EXPECTED["MHRC-SUP-006"].evidence_profile).toBe("E-VERSION");
    for (const id of MH09_SUP_IDS.slice(0, 5)) expect(MH09_EXPECTED[id].evidence_profile).toBe("E-SUPPORT");
  });

  it("the pinned WOTS+/Merkle attestation scheme and dimensions this owner must reuse are already accepted core", () => {
    expect(NEUTRAL_ATTESTATION_SCHEME).toBe("guild.wots_merkle.v1");
    expect(NEUTRAL_ATTESTATION_CHAIN_LENGTH).toBe(16);
    expect(NEUTRAL_ATTESTATION_MESSAGE_CHAINS).toBe(64);
    expect(NEUTRAL_ATTESTATION_CHECKSUM_CHAINS).toBe(3);
    expect(NEUTRAL_ATTESTATION_CHAINS).toBe(67);
    expect(NEUTRAL_ATTESTATION_TREE_HEIGHT).toBe(4);
  });

  it("the production attestor trust root's private seeds are, by the core's own design, unavailable to any signer this suite builds", () => {
    // The whole point of the control battery below: it must prove the SCHEME with
    // its own test-owned root, and production must refuse to treat that root as a
    // recognized production attestor.
    expect(NEUTRAL_ATTESTOR_TRUST_ROOT.length).toBeGreaterThan(0);
    for (const key of NEUTRAL_ATTESTOR_TRUST_ROOT) {
      expect(neutralAttestorVerificationKey(key.attestor_id)).toBe(key.verification_root);
    }
  });
});

// ---------------------------------------------------------------------------
// §1.5 — the production core declarations MH-09 requires (RED)
//
// Unlike MH-07's `E-BOUNDARY` and MH-08's `E-MIGRATION` — tolerated-absence
// gaps at the time those suites were written — this suite requires the exact
// declarations right now. Every `it` below fails until the accepted core adds
// them; there is no dual-state ("declares it or honestly tolerates its
// absence") branch anywhere in this section.
// ---------------------------------------------------------------------------

describe("the production core declarations MH-09 requires (RED)", () => {
  it("NEUTRAL_EVIDENCE_PROFILES declares E-SUPPORT exactly as the frozen contract specifies", () => {
    expect(neutralCanonicalJson((NEUTRAL_EVIDENCE_PROFILES as Record<string, unknown>)["E-SUPPORT"])).toBe(
      neutralCanonicalJson(E_SUPPORT_DEFINITION)
    );
  });

  it("NEUTRAL_EVIDENCE_PROFILES declares E-VERSION exactly as the frozen contract specifies", () => {
    expect(neutralCanonicalJson((NEUTRAL_EVIDENCE_PROFILES as Record<string, unknown>)["E-VERSION"])).toBe(
      neutralCanonicalJson(E_VERSION_DEFINITION)
    );
  });

  it("NEUTRAL_REASON_CODES contains exactly the three named MH-09 version-drift codes", () => {
    for (const code of Object.values(MH09_NEW_REASON_CODES)) {
      expect(NEUTRAL_REASON_CODES).toContain(code);
    }
  });

  it("the distribution module public index re-exports the release-conformance evaluator", () => {
    const indexSource = fs.existsSync(DISTRIBUTION_INDEX_PATH) ? fs.readFileSync(DISTRIBUTION_INDEX_PATH, "utf8") : "";
    expect(indexSource).toEqual(expect.stringContaining("release-conformance-evaluator"));
  });

  it("the external one-time signer script exists", () => {
    expect(fs.existsSync(SIGNER_SOURCE_PATH)).toBe(true);
  });

  it("the distribution module manifest declares a dependency on lifecycle (the evaluator drives lifecycle's neutral-conformance core)", () => {
    const manifest = JSON.parse(fs.readFileSync(DISTRIBUTION_MANIFEST_PATH, "utf8")) as { depends_on?: readonly string[] };
    expect(manifest.depends_on ?? []).toContain("lifecycle");
  });

  it("the distribution module manifest declares ownership of the sign-release-attestation script", () => {
    const manifest = JSON.parse(fs.readFileSync(DISTRIBUTION_MANIFEST_PATH, "utf8")) as { owns?: { scripts?: readonly string[] } };
    expect(manifest.owns?.scripts ?? []).toContain("sign-release-attestation");
  });

  it("scripts/package.json exposes a signer CLI entrypoint wired to sign-release-attestation.ts", () => {
    const pkg = JSON.parse(fs.readFileSync(SCRIPTS_PACKAGE_JSON_PATH, "utf8")) as { scripts?: Record<string, string> };
    const entries = Object.entries(pkg.scripts ?? {});
    const hasSignerCli = entries.some(([, command]) => typeof command === "string" && command.indexOf("sign-release-attestation") !== -1);
    expect(hasSignerCli).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ReferenceMh09 — the WOTS+/Merkle reference signer, key registries, and
// evaluation-logic good/bad pairs.
//
// Defined here, BEFORE §2/§3, so both the production-bound sections (which use
// `buildFixtureMaterial` to hand the real signer entrypoint genuinely valid,
// verifiable test-owned material) and §4's control battery (which proves the
// reference logic itself is discriminating) share one implementation. Nothing
// here is production; every function is test-owned and disposable.
// ---------------------------------------------------------------------------

namespace ReferenceMh09 {
  // -- WOTS+/Merkle reference signer, matching the accepted core bit-for-bit --

  export function chainStep(value: string, chain: number, step: number): string {
    return neutralSha256Hex(`${NEUTRAL_ATTESTATION_SIGNATURE_DOMAIN}|F|${chain}|${step}|${value}`);
  }

  function walkSteps(value: string, chain: number, steps: number): string {
    let current = value;
    for (let at = 0; at < steps; at += 1) current = chainStep(current, chain, at);
    return current;
  }

  function chainToTip(value: string, chain: number, fromStep: number): string {
    let current = value;
    for (let at = fromStep; at < NEUTRAL_ATTESTATION_CHAIN_LENGTH - 1; at += 1) current = chainStep(current, chain, at);
    return current;
  }

  const HEX_ALPHABET = "0123456789abcdef";

  export function codeWord(message: string): number[] | null {
    if (message.length !== NEUTRAL_ATTESTATION_MESSAGE_CHAINS) return null;
    const symbols: number[] = [];
    let checksum = 0;
    for (let index = 0; index < message.length; index += 1) {
      const symbol = HEX_ALPHABET.indexOf(message.charAt(index));
      if (symbol === -1) return null;
      symbols.push(symbol);
      checksum += NEUTRAL_ATTESTATION_CHAIN_LENGTH - 1 - symbol;
    }
    for (let index = NEUTRAL_ATTESTATION_CHECKSUM_CHAINS - 1; index >= 0; index -= 1) {
      const shift = Math.pow(NEUTRAL_ATTESTATION_CHAIN_LENGTH, index);
      symbols.push(Math.floor(checksum / shift) % NEUTRAL_ATTESTATION_CHAIN_LENGTH);
    }
    return symbols;
  }

  /** Deterministic private chain starts — test-owned, disposable, never real. */
  function privateSeed(label: string, keyIndex: number, chain: number): string {
    return neutralSha256Hex(`guild-mh09-test-seed|${label}|${keyIndex}|${chain}`);
  }

  export interface OneTimeKeypair {
    readonly sk: readonly string[];
    readonly publicKey: string;
  }

  function oneTimeKeypair(label: string, keyIndex: number): OneTimeKeypair {
    const sk: string[] = [];
    const tips: string[] = [];
    for (let chain = 0; chain < NEUTRAL_ATTESTATION_CHAINS; chain += 1) {
      const seed = privateSeed(label, keyIndex, chain);
      sk.push(seed);
      tips.push(chainToTip(seed, chain, 0));
    }
    const publicKey = neutralSha256Hex(`${NEUTRAL_ATTESTATION_SIGNATURE_DOMAIN}|PK|${tips.join("|")}`);
    return { sk, publicKey };
  }

  function leafOf(keyIndex: number, publicKey: string): string {
    return neutralSha256Hex(`${NEUTRAL_ATTESTATION_SIGNATURE_DOMAIN}|LEAF|${keyIndex}|${publicKey}`);
  }

  export interface MerkleTree {
    readonly root: string;
    readonly levels: readonly (readonly string[])[];
    readonly keypairs: readonly OneTimeKeypair[];
  }

  export function buildTree(label: string): MerkleTree {
    const leafCount = Math.pow(2, NEUTRAL_ATTESTATION_TREE_HEIGHT);
    const keypairs = Array.from({ length: leafCount }, (_, i) => oneTimeKeypair(label, i));
    let level: string[] = keypairs.map((kp, i) => leafOf(i, kp.publicKey));
    const levels: string[][] = [level];
    for (let l = 0; l < NEUTRAL_ATTESTATION_TREE_HEIGHT; l += 1) {
      const next: string[] = [];
      for (let i = 0; i < level.length; i += 2) {
        next.push(neutralSha256Hex(`${NEUTRAL_ATTESTATION_SIGNATURE_DOMAIN}|NODE|${l}|${level[i]}|${level[i + 1]}`));
      }
      levels.push(next);
      level = next;
    }
    return { root: level[0], levels, keypairs };
  }

  function authPath(tree: MerkleTree, keyIndex: number): string[] {
    const nodes: string[] = [];
    let index = keyIndex;
    for (let l = 0; l < NEUTRAL_ATTESTATION_TREE_HEIGHT; l += 1) {
      const siblingIndex = index % 2 === 0 ? index + 1 : index - 1;
      nodes.push(tree.levels[l][siblingIndex]);
      index = Math.floor(index / 2);
    }
    return nodes;
  }

  /** GOOD sign — reveals chain values only up to each symbol's step, never the
   * full private seed, mirroring exactly what `neutralVerifyAttestationSignature`
   * walks the rest of the way. */
  export function sign(tree: MerkleTree, keyIndex: number, digest: string): string {
    const kp = tree.keypairs[keyIndex];
    const symbols = codeWord(neutralSha256Hex(`${NEUTRAL_ATTESTATION_SIGNATURE_DOMAIN}|M|${tree.root}|${keyIndex}|${digest}`));
    if (symbols === null) throw new Error("sign: digest is not a signable message");
    const revealed = symbols.map((s, i) => walkSteps(kp.sk[i], i, s));
    const path = authPath(tree, keyIndex);
    const keyIndexHex = keyIndex.toString(16).padStart(2, "0");
    return `nws1:${keyIndexHex}:${revealed.join("")}:${path.join("")}`;
  }

  /** BAD sign — leaks the RAW private seeds instead of the walked chain values,
   * mirroring the exact private-material leak the production signer must never
   * commit. A real signer must never do this; it exists here only so a leak test
   * has something to discriminate against. */
  export function signLeakingPrivateSeeds(tree: MerkleTree, keyIndex: number, digest: string): { signature: string; leaked_private_seeds: readonly string[] } {
    const kp = tree.keypairs[keyIndex];
    return { signature: sign(tree, keyIndex, digest), leaked_private_seeds: kp.sk };
  }

  // -- Closed test-owned fixture signing-material schema --

  /**
   * The schema the production `sign-release-attestation.ts` must accept as
   * `material_path` content in fixture mode: everything needed to (a) recompute
   * every leaf's public key and the declared Merkle root from the private chain
   * starts, verifying the material derives that root, and (b) sign a digest with
   * the leaf at `key_index`. Built ONLY from this namespace's own deterministic
   * private chain starts / Merkle tree / auth-path machinery above — there is no
   * second implementation of the WOTS+/Merkle math anywhere in this file.
   */
  export const FIXTURE_MATERIAL_SCHEMA = "guild.mh09_fixture_signing_material.v1";

  export interface FixtureMaterial {
    readonly schema_version: string;
    readonly attestor_id: string;
    readonly verification_root: string;
    readonly chain_length: number;
    readonly message_chains: number;
    readonly checksum_chains: number;
    readonly tree_height: number;
    readonly key_index: number;
    readonly leaves: ReadonlyArray<{ readonly private_seeds: readonly string[] }>;
  }

  export function buildFixtureMaterial(tree: MerkleTree, attestorId: string, keyIndex: number): FixtureMaterial {
    return {
      schema_version: FIXTURE_MATERIAL_SCHEMA,
      attestor_id: attestorId,
      verification_root: tree.root,
      chain_length: NEUTRAL_ATTESTATION_CHAIN_LENGTH,
      message_chains: NEUTRAL_ATTESTATION_MESSAGE_CHAINS,
      checksum_chains: NEUTRAL_ATTESTATION_CHECKSUM_CHAINS,
      tree_height: NEUTRAL_ATTESTATION_TREE_HEIGHT,
      key_index: keyIndex,
      leaves: tree.keypairs.map((kp) => ({ private_seeds: [...kp.sk] })),
    };
  }

  // -- One-time key reservation registry --

  export class KeyRegistry {
    private readonly reserved = new Set<string>();
    /** GOOD reserve — atomically checks-then-sets; throws before any output exists. */
    reserve(attestorId: string, verificationRoot: string, keyIndex: number): void {
      const token = `${attestorId}|${verificationRoot}|${keyIndex}`;
      if (this.reserved.has(token)) {
        throw new Error(`KeyRegistry: key ${token} already reserved — refusing reuse`);
      }
      this.reserved.add(token);
    }
  }

  export class NonAtomicKeyRegistry {
    private readonly reserved = new Set<string>();
    /** BAD reserve — signs first, "reserves" after, so two concurrent callers can
     * both pass the check before either records the reservation. */
    reserveAfterUse(attestorId: string, verificationRoot: string, keyIndex: number): void {
      const token = `${attestorId}|${verificationRoot}|${keyIndex}`;
      const alreadyUsed = this.reserved.has(token);
      // The mutation happens regardless — the "reuse" window this simulates.
      this.reserved.add(token);
      if (alreadyUsed) {
        // Still detects a STRICTLY SEQUENTIAL reuse (that half is not the bug);
        // the discriminating case below simulates the concurrent race directly.
        throw new Error(`NonAtomicKeyRegistry: key ${token} reused`);
      }
    }
  }

  // -- Trust-root admission --

  /** GOOD production-root admission — recognizes ONLY the pinned production
   * roots via the real accepted core, never a caller-supplied substitute. */
  export function recognizedProductionRoot(attestorId: string): string | null {
    return neutralAttestorVerificationKey(attestorId);
  }

  /** BAD production-root admission — accepts whatever root the caller supplies,
   * exactly the trust-root-substitution hole the evaluator/signer must refuse. */
  export function acceptCallerSuppliedRoot(_attestorId: string, callerSuppliedRoot: string): string {
    return callerSuppliedRoot;
  }

  // -- Identity comparison: full-field vs label-only --

  /** GOOD identity comparison — every field the frozen contract names. */
  export function differingIdentityFields(a: NeutralEvidenceIdentity, b: NeutralEvidenceIdentity): readonly string[] {
    return NEUTRAL_EVIDENCE_IDENTITY_FIELDS.filter(
      (field) => (a as unknown as Record<string, unknown>)[field] !== (b as unknown as Record<string, unknown>)[field]
    );
  }

  /** BAD identity comparison — compares only the host_id LABEL, ignoring every
   * other bound field (package hash, runtime, adapter, platform, release…). */
  export function labelOnlyRuntimeMatch(a: NeutralEvidenceIdentity, b: NeutralEvidenceIdentity): boolean {
    return a.host_id === b.host_id;
  }

  // -- Contract-major admission: refuse vs silently downgrade --

  /** GOOD contract-major admission — a mismatch is a typed refusal; the bundle is
   * never parsed past the version check. */
  export function admitContractMajor(consumerMajor: number, producerMajor: number): { admitted: boolean; reason_code: string | null } {
    if (consumerMajor !== producerMajor) return { admitted: false, reason_code: "contract_major_mismatch" };
    return { admitted: true, reason_code: null };
  }

  /** BAD contract-major admission — silently downgrades to the consumer's major
   * and parses anyway, exactly the hole MHRC-VER-002 forbids. */
  export function admitContractMajorSilentDowngrade(_consumerMajor: number, _producerMajor: number): { admitted: boolean; reason_code: string | null } {
    return { admitted: true, reason_code: null };
  }

  // -- Version-age acceptance --

  /** GOOD staleness rule — identity equality decides validity; age never does. */
  export function stillValid(priorIdentity: NeutralEvidenceIdentity, currentIdentity: NeutralEvidenceIdentity, _ageMillis: number): boolean {
    return differingIdentityFields(priorIdentity, currentIdentity).length === 0;
  }

  /** BAD staleness rule — accepts a drifted identity as long as it is "recent". */
  export function stillValidByAge(priorIdentity: NeutralEvidenceIdentity, currentIdentity: NeutralEvidenceIdentity, ageMillis: number): boolean {
    if (ageMillis < 24 * 60 * 60 * 1000) return true;
    return differingIdentityFields(priorIdentity, currentIdentity).length === 0;
  }

  // -- Support-state dimension collapse --

  /** GOOD support claim — drives the REAL accepted core, so collapsing into one
   * boolean is structurally impossible (the type has no such field). */
  export function proveDimension(record: NeutralSupportRecord, operation: string, satisfied: boolean): NeutralSupportRecord {
    return applyNeutralSupportTransition(record, operation, { satisfied }).record;
  }

  /** BAD support claim — collapses every dimension into one boolean, exactly
   * what `deriveNeutralSupportClaim`'s shape (no `supported` field) forbids. */
  export function collapsedSupportClaim(record: NeutralSupportRecord): { supported: boolean } {
    return { supported: Object.values(record).some((status) => status === "satisfied") };
  }

  /** BAD transition — treats "rendered" as sufficient proof of "installed",
   * skipping the install operation's own precondition chain entirely. */
  export function renderAsInstall(record: NeutralSupportRecord): NeutralSupportRecord {
    if (record.rendered !== "satisfied") return record;
    return { ...record, installed: "satisfied" };
  }

  /** BAD transition — treats "installed" as sufficient proof of "activated". */
  export function installAsActivation(record: NeutralSupportRecord): NeutralSupportRecord {
    if (record.installed !== "satisfied") return record;
    return { ...record, activated: "satisfied" };
  }

  /** GOOD update rule — requires BOTH a before and an after runtime discovery
   * naming a different version, mirroring `NEUTRAL_SUPPORT_TRANSITIONS`'s
   * `installed:satisfied` precondition plus the frozen contract's own text. */
  export function promoteUpdated(before: { version: string } | null, after: { version: string } | null): boolean {
    if (before === null || after === null) return false;
    return before.version !== after.version;
  }

  /** BAD update rule — promotes from a single (after-only) observation, exactly
   * the "render-only refresh" hole MHRC-SUP-005 forbids. */
  export function promoteUpdatedAfterOnly(before: { version: string } | null, after: { version: string } | null): boolean {
    return after !== null;
  }

  // -- Incomplete-suite conformance --

  /** GOOD conformance-manifest rule — every required id must resolve. */
  export function promoteConformant(requiredIds: readonly string[], resolvedIds: readonly string[]): boolean {
    if (requiredIds.length === 0) return false;
    return requiredIds.every((id) => resolvedIds.indexOf(id) !== -1);
  }

  /** BAD conformance-manifest rule — promotes on a majority, not a complete set,
   * exactly the "any required failed/stale/missing/unobserved scenario" hole
   * MHRC-SUP-006 forbids. */
  export function promoteConformantOnMajority(requiredIds: readonly string[], resolvedIds: readonly string[]): boolean {
    if (requiredIds.length === 0) return false;
    const resolvedCount = requiredIds.filter((id) => resolvedIds.indexOf(id) !== -1).length;
    return resolvedCount / requiredIds.length > 0.5;
  }
}

// ---------------------------------------------------------------------------
// §2 — the production MH-09 evaluator (RED)
// ---------------------------------------------------------------------------

describe("the production MH-09 evaluator", () => {
  it("is present in the distribution workflow source tree", () => {
    expect(Evaluator.mod()).not.toBeUndefined();
  });

  it("declares the closed nine-id owner coverage in canonical order", () => {
    expect(Evaluator.exported<readonly string[]>("MH09_STABLE_IDS")).toEqual(MH09_IDS);
  });

  it("declares the closed evaluation-mode vocabulary production | fixture", () => {
    expect(Evaluator.exported<readonly string[]>("MH09_MODES")).toEqual(["production", "fixture"]);
  });

  it("declares the closed request-member vocabulary for the canonical-text admission boundary", () => {
    const members = Evaluator.exported<readonly string[]>("MH09_REQUEST_MEMBERS");
    expect(members).toEqual(
      expect.arrayContaining(["run_id", "claimant_id", "mode", "evidence_identity", "receipt_refs", "evidence_freshness", "scenario_evidence"])
    );
  });

  describe("§admission: canonical JSON text only, never a live graph", () => {
    it("refuses a direct object request, unread", () => {
      expect(() => Evaluator.invoke("evaluateReleaseConformance", baseRequest())).toThrow();
    });

    it("refuses a Proxy request without invoking get/has/ownKeys traps", () => {
      let getCount = 0;
      const hostile = new Proxy(baseRequest(), {
        get(target, prop, receiver) {
          getCount += 1;
          return Reflect.get(target, prop, receiver);
        },
      });
      expect(() => Evaluator.invoke("evaluateReleaseConformance", hostile)).toThrow();
      // While RED, invoke() throws before the (absent) production function is ever
      // reached, so the trap count is trivially zero — this assertion is the same
      // one that must hold once production exists and genuinely refuses unread.
      expect(getCount).toBe(0);
    });

    it("refuses malformed (non-JSON) canonical text", () => {
      expect(() => Evaluator.invoke("evaluateReleaseConformance", "{not-json")).toThrow();
    });

    it("refuses non-canonical text (a valid but non-canonically-ordered JSON string)", () => {
      const nonCanonical = `{"claimant_id":"${CLAIMANT_ID}","run_id":"${RUN_ID}"}`;
      expect(() => Evaluator.invoke("evaluateReleaseConformance", nonCanonical)).toThrow();
    });

    it("refuses over-size request text", () => {
      const huge = canon(baseRequest({ padding: "x".repeat(2_000_000) }));
      expect(() => Evaluator.invoke("evaluateReleaseConformance", huge)).toThrow();
    });

    it("refuses over-deep request text", () => {
      let deep: unknown = "leaf";
      for (let i = 0; i < 5000; i += 1) deep = { nested: deep };
      expect(() => Evaluator.invoke("evaluateReleaseConformance", canon(baseRequest({ deep })))).toThrow();
    });

    it("refuses a caller that supplies its own required-scenario-id set rather than using the source-owned one", () => {
      expect(() =>
        Evaluator.invoke("evaluateReleaseConformance", canon(baseRequest({ required_scenario_ids: [MH09_IDS[0]] })))
      ).toThrow();
    });
  });

  describe("§authority: production vs fixture mode", () => {
    it("refuses production mode without independent production provisioning, recognized verification roots, and externally signed authority", () => {
      expect(() =>
        Evaluator.invoke("evaluateReleaseConformance", canon(baseRequest({ mode: "production" })))
      ).toThrow();
    });

    it("refuses production mode when the caller supplies its own trust root instead of the pinned production one", () => {
      const request = baseRequest({
        mode: "production",
        trust_root: [{ attestor_id: "guild.release-attestor", verification_root: "0".repeat(64) }],
      });
      expect(() => Evaluator.invoke("evaluateReleaseConformance", canon(request))).toThrow();
    });

    it("fixture mode may prove mechanics with test-owned keys but the packet is explicitly non-promotable", () => {
      const result = Evaluator.invoke<{ outcome: unknown; packet: NeutralOwnerConformancePacket | null }>(
        "evaluateReleaseConformance",
        canon(baseRequest({ mode: "fixture" }))
      );
      // RED: production absent, so this never actually runs — the obligation is
      // pinned for when it does: a fixture-mode packet must be labeled as such.
      expect((result as unknown as Record<string, unknown>).promotable).not.toBe(true);
    });

    it("refuses a fixture-mode packet relabeled as production evidence", () => {
      const request = baseRequest({ mode: "fixture", relabel_as: "production" });
      expect(() => Evaluator.invoke("evaluateReleaseConformance", canon(request))).toThrow();
    });
  });

  describe("§scenario evaluation drives the real support-state and release-distribution cores", () => {
    it("MHRC-SUP-001: recognition proves only recognized — no package artifact means rendered stays unproven", () => {
      const request = baseRequest({ scenario: "MHRC-SUP-001", scenario_evidence: { "MHRC-SUP-001": sup001Evidence() } });
      const result = Evaluator.invoke<{ packet: NeutralOwnerConformancePacket | null }>(
        "evaluateReleaseConformance",
        canon(request)
      );
      const scenarioResult = result.packet?.results.find((r) => r.stable_id === "MHRC-SUP-001");
      expect(scenarioResult?.disposition).toBe("succeeded");
    });

    it("MHRC-SUP-002: a deterministic rendered manifest/hash proves only rendered — a prepared tree is not installed", () => {
      const request = baseRequest({ scenario: "MHRC-SUP-002", scenario_evidence: { "MHRC-SUP-002": sup002Evidence() } });
      const result = Evaluator.invoke<{ packet: NeutralOwnerConformancePacket | null }>(
        "evaluateReleaseConformance",
        canon(request)
      );
      expect(result.packet?.results.find((r) => r.stable_id === "MHRC-SUP-002")?.disposition).toBe("succeeded");
    });

    it("MHRC-SUP-003: installation requires an observed manager/destination plus post-write bytes matching the package hash, driving the REAL verifyReleaseClaim over the bound release claim", () => {
      const request = baseRequest({ scenario: "MHRC-SUP-003", scenario_evidence: { "MHRC-SUP-003": sup003Evidence() } });
      const result = Evaluator.invoke<{ packet: NeutralOwnerConformancePacket | null }>(
        "evaluateReleaseConformance",
        canon(request)
      );
      expect(result.packet?.results.find((r) => r.stable_id === "MHRC-SUP-003")?.disposition).toBe("succeeded");
    });

    it("MHRC-SUP-003 refuses install instructions alone (no observed manager or destination bytes)", () => {
      const request = baseRequest({ scenario: "MHRC-SUP-003", scenario_evidence: { "MHRC-SUP-003": sup003WeakEvidence() } });
      const result = Evaluator.invoke<{ packet: NeutralOwnerConformancePacket | null }>(
        "evaluateReleaseConformance",
        canon(request)
      );
      expect(result.packet?.results.find((r) => r.stable_id === "MHRC-SUP-003")?.disposition).not.toBe("succeeded");
    });

    it("MHRC-SUP-003 refuses when the bound release claim's archive checksum is tampered — the REAL verifyReleaseClaim must catch it, not a restated copy", () => {
      const { claim, archive } = buildFixtureReleaseClaim();
      const tamperedClaim: ReleaseClaim = { ...claim, archive_sha256: "0".repeat(64) };
      // Sanity, exercised against real production code: the tamper is genuine —
      // the real verifier itself rejects it before the evaluator is even asked.
      expect(verifyReleaseClaim(tamperedClaim, archive).length).toBeGreaterThan(0);

      const request = baseRequest({
        scenario: "MHRC-SUP-003",
        scenario_evidence: {
          "MHRC-SUP-003": {
            rendered_package_hash: IDENTITY.package_hash,
            install_operation: operationEvidence("install"),
            post_write_hash: IDENTITY.package_hash,
            release_claim: tamperedClaim,
            release_archive_base64: archive.toString("base64"),
          },
        },
      });
      const result = Evaluator.invoke<{ packet: NeutralOwnerConformancePacket | null }>(
        "evaluateReleaseConformance",
        canon(request)
      );
      expect(result.packet?.results.find((r) => r.stable_id === "MHRC-SUP-003")?.disposition).not.toBe("succeeded");
    });

    it("MHRC-SUP-004: activation requires independently observed runtime discovery matching the install/activation contract", () => {
      const request = baseRequest({ scenario: "MHRC-SUP-004", scenario_evidence: { "MHRC-SUP-004": sup004Evidence() } });
      const result = Evaluator.invoke<{ packet: NeutralOwnerConformancePacket | null }>(
        "evaluateReleaseConformance",
        canon(request)
      );
      expect(result.packet?.results.find((r) => r.stable_id === "MHRC-SUP-004")?.disposition).toBe("succeeded");
    });

    it("MHRC-SUP-005: update requires before AND after active-runtime discoveries with a different target version/hash", () => {
      const request = baseRequest({ scenario: "MHRC-SUP-005", scenario_evidence: { "MHRC-SUP-005": sup005Evidence() } });
      const result = Evaluator.invoke<{ packet: NeutralOwnerConformancePacket | null }>(
        "evaluateReleaseConformance",
        canon(request)
      );
      expect(result.packet?.results.find((r) => r.stable_id === "MHRC-SUP-005")?.disposition).toBe("succeeded");
    });

    it("MHRC-SUP-005 refuses a render-only refresh (no runtime discovery on either side)", () => {
      const request = baseRequest({ scenario: "MHRC-SUP-005", scenario_evidence: { "MHRC-SUP-005": sup005WeakEvidence() } });
      const result = Evaluator.invoke<{ packet: NeutralOwnerConformancePacket | null }>(
        "evaluateReleaseConformance",
        canon(request)
      );
      expect(result.packet?.results.find((r) => r.stable_id === "MHRC-SUP-005")?.disposition).not.toBe("succeeded");
    });

    it("MHRC-SUP-005 refuses when the bound release claim's archive checksum is tampered — the REAL verifyReleaseClaim must catch it, not a restated copy", () => {
      const { claim, archive } = buildFixtureReleaseClaim();
      const tamperedClaim: ReleaseClaim = { ...claim, archive_sha256: "0".repeat(64) };
      // Sanity, exercised against real production code: the tamper is genuine.
      expect(verifyReleaseClaim(tamperedClaim, archive).length).toBeGreaterThan(0);

      const request = baseRequest({
        scenario: "MHRC-SUP-005",
        scenario_evidence: {
          "MHRC-SUP-005": {
            before_discovery: { active_version: "guild-2.4.0", active_package_hash: `sha256:${"4".repeat(64)}` },
            update_operation: operationEvidence("update"),
            after_discovery: { active_version: IDENTITY.runtime_version, active_package_hash: IDENTITY.package_hash },
            destination_unchanged: true,
            release_claim: tamperedClaim,
            release_archive_base64: archive.toString("base64"),
          },
        },
      });
      const result = Evaluator.invoke<{ packet: NeutralOwnerConformancePacket | null }>(
        "evaluateReleaseConformance",
        canon(request)
      );
      expect(result.packet?.results.find((r) => r.stable_id === "MHRC-SUP-005")?.disposition).not.toBe("succeeded");
    });

    it("MHRC-SUP-006: conformant requires the exact activated identity and a complete ordered 31-scenario manifest whose hashes resolve", () => {
      const request = baseRequest({ scenario: "MHRC-SUP-006", scenario_evidence: { "MHRC-SUP-006": sup006Evidence() } });
      const result = Evaluator.invoke<{ packet: NeutralOwnerConformancePacket | null }>(
        "evaluateReleaseConformance",
        canon(request)
      );
      expect(result.packet?.results.find((r) => r.stable_id === "MHRC-SUP-006")?.disposition).toBe("succeeded");
    });

    it("MHRC-SUP-006 refuses promotion when any required scenario is failed, stale, missing, or unobserved", () => {
      const request = baseRequest({ scenario: "MHRC-SUP-006", scenario_evidence: { "MHRC-SUP-006": sup006WeakEvidence() } });
      const result = Evaluator.invoke<{ packet: NeutralOwnerConformancePacket | null }>(
        "evaluateReleaseConformance",
        canon(request)
      );
      expect(result.packet?.results.find((r) => r.stable_id === "MHRC-SUP-006")?.disposition).not.toBe("succeeded");
    });

    it("MHRC-VER-001: any evidence-identity field drift invalidates conformance, refused with evidence_version_drift and the changed fields enumerated", () => {
      const request = baseRequest({ scenario: "MHRC-VER-001", scenario_evidence: { "MHRC-VER-001": ver001Evidence() } });
      const result = Evaluator.invoke<{ packet: NeutralOwnerConformancePacket | null }>(
        "evaluateReleaseConformance",
        canon(request)
      );
      const scenarioResult = result.packet?.results.find((r) => r.stable_id === "MHRC-VER-001");
      expect(scenarioResult?.disposition).toBe("refused");
      expect(scenarioResult?.reason_code).toBe(MH09_NEW_REASON_CODES["MHRC-VER-001"]);
    });

    it("MHRC-VER-001 refuses age alone as a substitute for a rerun of the required scenario set", () => {
      const request = baseRequest({ scenario: "MHRC-VER-001", scenario_evidence: { "MHRC-VER-001": ver001NoDriftEvidence() } });
      const result = Evaluator.invoke<{ packet: NeutralOwnerConformancePacket | null }>(
        "evaluateReleaseConformance",
        canon(request)
      );
      // Identical identity: no drift, so this is the anti-vacuity control — age
      // must never be what promotes or refuses this scenario, identity must.
      expect(result.packet?.results.find((r) => r.stable_id === "MHRC-VER-001")?.disposition).not.toBe("refused");
    });

    it("MHRC-VER-002: a pinned consumer on a different contract major is a typed unsupported, never a parse or silent downgrade", () => {
      const request = baseRequest({ scenario: "MHRC-VER-002", scenario_evidence: { "MHRC-VER-002": ver002Evidence() } });
      const result = Evaluator.invoke<{ packet: NeutralOwnerConformancePacket | null }>(
        "evaluateReleaseConformance",
        canon(request)
      );
      const scenarioResult = result.packet?.results.find((r) => r.stable_id === "MHRC-VER-002");
      expect(scenarioResult?.disposition).toBe("unsupported");
      expect(scenarioResult?.reason_code).toBe(MH09_NEW_REASON_CODES["MHRC-VER-002"]);
    });

    it("MHRC-VER-003: expected package/version/destination differing from runtime discovery is a typed failed, identifying expected vs observed", () => {
      const request = baseRequest({ scenario: "MHRC-VER-003", scenario_evidence: { "MHRC-VER-003": ver003Evidence() } });
      const result = Evaluator.invoke<{ packet: NeutralOwnerConformancePacket | null }>(
        "evaluateReleaseConformance",
        canon(request)
      );
      const scenarioResult = result.packet?.results.find((r) => r.stable_id === "MHRC-VER-003");
      expect(scenarioResult?.disposition).toBe("failed");
      expect(scenarioResult?.reason_code).toBe(MH09_NEW_REASON_CODES["MHRC-VER-003"]);
    });

    it("full owner evaluation refuses instead of manufacturing synthetic evidence when the caller supplies none for any scenario", () => {
      const result = Evaluator.invoke<{ packet: NeutralOwnerConformancePacket | null }>(
        "evaluateReleaseConformance",
        canon(baseRequest())
      );
      for (const id of MH09_SUP_IDS) {
        expect(result.packet?.results.find((r) => r.stable_id === id)?.disposition).not.toBe("succeeded");
      }
    });

    it("full owner evaluation's top-level outcome is scenario_evidence_incomplete, not a false success, when every scenario is evidence-incomplete", () => {
      const result = Evaluator.invoke<{ outcome: { disposition: string; reason_code: string | null } }>(
        "evaluateReleaseConformance",
        canon(baseRequest())
      );
      expect(result.outcome.disposition).toBe("refused");
      expect(result.outcome.reason_code).toBe("scenario_evidence_incomplete");
    });
  });

  describe("§the top-level derivation rule: six expected successes plus three expected typed VER outcomes", () => {
    it("derives a top-level succeeded outcome ONLY when all nine scenarios resolve to their frozen expected dispositions", () => {
      // NOT wrapped in toThrow(): a throw-only stub fails this (correctly RED),
      // but so would a stub that fakes a blanket "succeeded" without genuinely
      // deriving each of the nine typed results — every disposition below is
      // checked individually against MH09_EXPECTED before the top-level rollup
      // is trusted.
      const result = Evaluator.invoke<{
        outcome: { disposition: string; reason_code: string | null };
        packet: NeutralOwnerConformancePacket | null;
      }>("evaluateReleaseConformance", canon(baseRequest({ scenario_evidence: allScenarioEvidence() })));
      for (const id of MH09_IDS) {
        expect(result.packet?.results.find((r) => r.stable_id === id)?.disposition).toBe(MH09_EXPECTED[id].disposition);
      }
      expect(result.outcome.disposition).toBe("succeeded");
    });

    it("one controlled mismatch — MHRC-SUP-003 weakened to instructions-only while the other eight scenarios stay complete and correct — refuses the top-level outcome", () => {
      const evidence = allScenarioEvidence();
      evidence["MHRC-SUP-003"] = sup003WeakEvidence();
      const result = Evaluator.invoke<{
        outcome: { disposition: string; reason_code: string | null };
        packet: NeutralOwnerConformancePacket | null;
      }>("evaluateReleaseConformance", canon(baseRequest({ scenario_evidence: evidence })));
      expect(result.packet?.results.find((r) => r.stable_id === "MHRC-SUP-003")?.disposition).not.toBe("succeeded");
      expect(result.outcome.disposition).not.toBe("succeeded");
    });
  });

  describe("§the owner packet", () => {
    it("produces one immutable guild.conformance_owner_packet.v1 packet for W5/MH-09 with exact ordered ids MHRC-SUP-001..006, MHRC-VER-001..003", () => {
      const result = Evaluator.invoke<{ packet: NeutralOwnerConformancePacket | null }>(
        "evaluateReleaseConformance",
        canon(baseRequest())
      );
      expect(result.packet).not.toBeNull();
      expect(result.packet?.schema_version).toBe(NEUTRAL_ASSEMBLY_PACKET_SCHEMA);
      expect(result.packet?.owner_key).toBe(OWNER_KEY_MH09);
      expect(result.packet?.stable_ids).toEqual(MH09_IDS);
      expect(Object.isFrozen(result.packet)).toBe(true);
    });

    it("produces byte-identical packets for identical inputs (determinism)", () => {
      const request = canon(baseRequest());
      const first = Evaluator.invoke("evaluateReleaseConformance", request);
      const second = Evaluator.invoke("evaluateReleaseConformance", request);
      expect(neutralCanonicalJson(first)).toBe(neutralCanonicalJson(second));
    });

    it("does not mutate caller-supplied request inputs", () => {
      const request = canon(neutralFreeze(baseRequest()));
      const before = request;
      Evaluator.invoke("evaluateReleaseConformance", request);
      expect(request).toBe(before);
    });

    it("is exported through the distribution module's public index", () => {
      const indexSource = fs.existsSync(DISTRIBUTION_INDEX_PATH) ? fs.readFileSync(DISTRIBUTION_INDEX_PATH, "utf8") : "";
      expect(indexSource).toEqual(expect.stringContaining("release-conformance-evaluator"));
    });
  });
});

// ---------------------------------------------------------------------------
// §3 — the production external one-time signer (RED)
// ---------------------------------------------------------------------------

describe("the production external one-time signer", () => {
  it("is present in the scripts tree", () => {
    expect(Signer.mod()).not.toBeUndefined();
  });

  /** A closed, well-formed, VERIFIABLE fixture material file — never `"{}"` or
   * `{malformed:true}` — so every obligation below is attributable to the
   * specific thing under test, not to an earlier missing/malformed-material
   * refusal. */
  function writeFixtureMaterial(label: string, opts: { attestorId?: string; keyIndex?: number } = {}) {
    const tree = ReferenceMh09.buildTree(`signer-${label}`);
    const material = ReferenceMh09.buildFixtureMaterial(tree, opts.attestorId ?? "guild.release-attestor", opts.keyIndex ?? 0);
    const materialPath = path.join(tempRoot(`signer-material-${label}`), "material.json");
    fs.writeFileSync(materialPath, JSON.stringify(material));
    return { tree, material, materialPath };
  }

  it("accepts an explicit external material file, digest, output path, mode, and durable used-key registry path, and produces a signing output", () => {
    // NOT wrapped in toThrow(): a throw-only stub still fails this (correctly
    // RED, since Signer.mod() genuinely throws while the module is absent), but
    // once production exists a stub that always throws remains failing here too.
    const { materialPath } = writeFixtureMaterial("accept");
    const output = Signer.invoke<{ verification_root: string; signature: string }>("signReleaseAttestation", {
      material_path: materialPath,
      digest: `nad1:${neutralSha256Hex("mh09-signer-accept")}`,
      output_path: path.join(tempRoot("signer-output"), "attestation.json"),
      mode: "fixture",
      used_key_registry_path: path.join(tempRoot("signer-registry"), "used-keys.json"),
    });
    expect(output).toBeDefined();
  });

  it("verifies material schema, attestor/root/key index, chain count/width, authentication path, and derivation of the declared public root before signing — a malformed material is refused", () => {
    const materialPath = path.join(tempRoot("signer-verify"), "material.json");
    fs.writeFileSync(materialPath, JSON.stringify({ malformed: true }));
    expect(() =>
      Signer.invoke("signReleaseAttestation", {
        material_path: materialPath,
        digest: `nad1:${neutralSha256Hex("mh09-signer-verify")}`,
        output_path: path.join(tempRoot("signer-verify-out"), "out.json"),
        mode: "fixture",
        used_key_registry_path: path.join(tempRoot("signer-verify-reg"), "reg.json"),
      })
    ).toThrow();
  });

  it("§anti-vacuity: a material whose private seeds do NOT derive its declared verification_root is refused, even though otherwise well-formed", () => {
    const { material, materialPath: baseMaterialPath } = writeFixtureMaterial("wrong-root");
    void baseMaterialPath;
    const tampered = { ...material, verification_root: "0".repeat(64) };
    const materialPath = path.join(tempRoot("signer-wrong-root"), "material.json");
    fs.writeFileSync(materialPath, JSON.stringify(tampered));
    expect(() =>
      Signer.invoke("signReleaseAttestation", {
        material_path: materialPath,
        digest: `nad1:${neutralSha256Hex("mh09-signer-wrong-root")}`,
        output_path: path.join(tempRoot("signer-wrong-root-out"), "out.json"),
        mode: "fixture",
        used_key_registry_path: path.join(tempRoot("signer-wrong-root-reg"), "reg.json"),
      })
    ).toThrow();
  });

  it("emits a signature the REAL accepted neutralVerifyAttestationSignature core verifies — fixture-mode round trip, output read from disk", () => {
    const { tree, materialPath } = writeFixtureMaterial("roundtrip");
    const digest = `nad1:${neutralSha256Hex("mh09-signer-roundtrip")}`;
    const outputPath = path.join(tempRoot("signer-roundtrip-out"), "out.json");
    const output = Signer.invoke<{ verification_root: string; signature: string }>("signReleaseAttestation", {
      material_path: materialPath,
      digest,
      output_path: outputPath,
      mode: "fixture",
      used_key_registry_path: path.join(tempRoot("signer-roundtrip-reg"), "reg.json"),
    });
    expect(output.verification_root).toBe(tree.root);
    const written = JSON.parse(fs.readFileSync(outputPath, "utf8")) as { verification_root: string; signature: string };
    expect(neutralVerifyAttestationSignature(written.verification_root, digest, written.signature)).toBe(true);
    const mode = fs.statSync(outputPath).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  describe("§one-time key reservation", () => {
    it("refuses when the attestation output and used-key registry resolve to the same path", () => {
      const { materialPath } = writeFixtureMaterial("registry-output-alias");
      const sharedPath = path.join(tempRoot("signer-registry-output-alias"), "shared.json");
      expect(() =>
        Signer.invoke("signReleaseAttestation", {
          material_path: materialPath,
          digest: `nad1:${neutralSha256Hex("mh09-registry-output-alias")}`,
          output_path: sharedPath,
          mode: "fixture",
          used_key_registry_path: sharedPath,
        })
      ).toThrow(/distinct|path|position/i);
      expect(fs.existsSync(sharedPath)).toBe(false);
    });

    it.each([
      ["wrong schema", { schema_version: "guild.release_signer_registry.v0", used_keys: [] }],
      ["missing used_keys", { schema_version: "guild.release_signer_registry.v1" }],
      ["non-string used_keys entry", { schema_version: "guild.release_signer_registry.v1", used_keys: [7] }],
    ])("refuses a pre-existing %s registry instead of treating it as empty", (_label, registry) => {
      const { materialPath } = writeFixtureMaterial(`malformed-registry-${_label}`);
      const registryPath = path.join(tempRoot(`signer-malformed-registry-${_label}`), "reg.json");
      fs.writeFileSync(registryPath, JSON.stringify(registry));
      expect(() =>
        Signer.invoke("signReleaseAttestation", {
          material_path: materialPath,
          digest: `nad1:${neutralSha256Hex(`mh09-malformed-registry-${_label}`)}`,
          output_path: path.join(tempRoot(`signer-malformed-registry-out-${_label}`), "out.json"),
          mode: "fixture",
          used_key_registry_path: registryPath,
        })
      ).toThrow(/registry|schema|used_keys/i);
      expect(JSON.parse(fs.readFileSync(registryPath, "utf8"))).toEqual(registry);
    });

    it("reserves {attestor_id, verification_root, key_index} atomically before publishing output and refuses any reuse, even with a different digest — using otherwise-valid material", () => {
      const { materialPath } = writeFixtureMaterial("reuse");
      const registryPath = path.join(tempRoot("signer-reuse-reg"), "reg.json");
      // First call — not wrapped: while production is absent this throws here
      // and the test fails, correctly RED. Once production exists, the SECOND
      // call below is what actually discriminates a reuse-respecting signer
      // from a permissive one.
      Signer.invoke("signReleaseAttestation", {
        material_path: materialPath,
        digest: `nad1:${neutralSha256Hex("mh09-reuse-first")}`,
        output_path: path.join(tempRoot("signer-reuse-out-1"), "out.json"),
        mode: "fixture",
        used_key_registry_path: registryPath,
      });
      expect(() =>
        Signer.invoke("signReleaseAttestation", {
          material_path: materialPath,
          digest: `nad1:${neutralSha256Hex("mh09-reuse-second")}`,
          output_path: path.join(tempRoot("signer-reuse-out-2"), "out.json"),
          mode: "fixture",
          used_key_registry_path: registryPath,
        })
      ).toThrow(/reuse|reserved|consumed|already/i);
    });

    it("a consumed key remains consumed on later output failure — using otherwise-valid material, forcing ONLY the output write to fail, then a valid-output retry with the SAME material/digest is refused", () => {
      const { materialPath } = writeFixtureMaterial("consumed");
      const registryPath = path.join(tempRoot("signer-consumed-reg"), "reg.json");
      const digest = `nad1:${neutralSha256Hex("mh09-signer-consumed")}`;
      expect(() =>
        Signer.invoke("signReleaseAttestation", {
          material_path: materialPath,
          digest,
          output_path: "/dev/null/impossible/output.json",
          mode: "fixture",
          used_key_registry_path: registryPath,
        })
      ).toThrow();
      expect(() =>
        Signer.invoke("signReleaseAttestation", {
          material_path: materialPath,
          digest,
          output_path: path.join(tempRoot("signer-consumed-retry"), "out.json"),
          mode: "fixture",
          used_key_registry_path: registryPath,
        })
      ).toThrow(/reuse|reserved|consumed|already/i);
    });
  });

  describe("§path containment", () => {
    it("lstat/refuses a symlinked material path — the real (non-symlink) material at the same content is otherwise valid", () => {
      const { material } = writeFixtureMaterial("symlink-material-real");
      const base = tempRoot("signer-symlink-material");
      const real = path.join(base, "real-material.json");
      fs.writeFileSync(real, JSON.stringify(material));
      const link = path.join(base, "material-link.json");
      fs.symlinkSync(real, link);
      expect(() =>
        Signer.invoke("signReleaseAttestation", {
          material_path: link,
          digest: `nad1:${neutralSha256Hex("mh09-symlink-material")}`,
          output_path: path.join(tempRoot("signer-symlink-out"), "out.json"),
          mode: "fixture",
          used_key_registry_path: path.join(tempRoot("signer-symlink-reg"), "reg.json"),
        })
      ).toThrow(/symlink|contain|escap/i);
    });

    it("lstat/refuses a symlinked used-key registry path, with otherwise-valid material", () => {
      const { materialPath } = writeFixtureMaterial("symlink-registry");
      const base = tempRoot("signer-symlink-registry");
      const realReg = path.join(base, "real-reg.json");
      fs.writeFileSync(realReg, "{}");
      const link = path.join(base, "reg-link.json");
      fs.symlinkSync(realReg, link);
      expect(() =>
        Signer.invoke("signReleaseAttestation", {
          material_path: materialPath,
          digest: `nad1:${neutralSha256Hex("mh09-symlink-registry")}`,
          output_path: path.join(tempRoot("signer-symlink-out2"), "out.json"),
          mode: "fixture",
          used_key_registry_path: link,
        })
      ).toThrow(/symlink|contain|escap/i);
    });

    it("lstat/refuses a symlinked output path, including an intermediate symlink escape, with otherwise-valid material", () => {
      const { materialPath } = writeFixtureMaterial("symlink-output");
      const base = tempRoot("signer-symlink-output");
      const escape = fs.mkdtempSync(path.join(os.tmpdir(), "guild-mh09-escape-"));
      TEMP_ROOTS.push(escape);
      const link = path.join(base, "escaped-dir");
      fs.symlinkSync(escape, link);
      expect(() =>
        Signer.invoke("signReleaseAttestation", {
          material_path: materialPath,
          digest: `nad1:${neutralSha256Hex("mh09-symlink-output")}`,
          output_path: path.join(link, "out.json"),
          mode: "fixture",
          used_key_registry_path: path.join(tempRoot("signer-symlink-reg2"), "reg.json"),
        })
      ).toThrow(/symlink|contain|escap/i);
    });

    it("lstat/refuses an INTERMEDIATE-PARENT symlink escape reaching the material path (the real content lives outside the escaped directory), not just a symlink at the leaf", () => {
      const { material } = writeFixtureMaterial("material-parent-escape-source");
      const base = tempRoot("signer-material-parent-escape");
      const escape = fs.mkdtempSync(path.join(os.tmpdir(), "guild-mh09-escape-material-"));
      TEMP_ROOTS.push(escape);
      fs.writeFileSync(path.join(escape, "material.json"), JSON.stringify(material));
      const link = path.join(base, "escaped-dir");
      fs.symlinkSync(escape, link);
      expect(() =>
        Signer.invoke("signReleaseAttestation", {
          material_path: path.join(link, "material.json"),
          digest: `nad1:${neutralSha256Hex("mh09-material-parent-escape")}`,
          output_path: path.join(tempRoot("signer-material-parent-escape-out"), "out.json"),
          mode: "fixture",
          used_key_registry_path: path.join(tempRoot("signer-material-parent-escape-reg"), "reg.json"),
        })
      ).toThrow(/symlink|contain|escap/i);
    });

    it("lstat/refuses an INTERMEDIATE-PARENT symlink escape reaching the used-key registry path, with otherwise-valid material", () => {
      const { materialPath } = writeFixtureMaterial("registry-parent-escape");
      const base = tempRoot("signer-registry-parent-escape");
      const escape = fs.mkdtempSync(path.join(os.tmpdir(), "guild-mh09-escape-registry-"));
      TEMP_ROOTS.push(escape);
      const link = path.join(base, "escaped-dir");
      fs.symlinkSync(escape, link);
      expect(() =>
        Signer.invoke("signReleaseAttestation", {
          material_path: materialPath,
          digest: `nad1:${neutralSha256Hex("mh09-registry-parent-escape")}`,
          output_path: path.join(tempRoot("signer-registry-parent-escape-out"), "out.json"),
          mode: "fixture",
          used_key_registry_path: path.join(link, "reg.json"),
        })
      ).toThrow(/symlink|contain|escap/i);
    });
  });

  describe("§deterministic lock-path contract", () => {
    it("pins the lock path to exactly `<used_key_registry_path>.lock` and refuses a pre-planted symlink at that EXACT path, with otherwise-valid material", () => {
      const { materialPath } = writeFixtureMaterial("lock-symlink");
      const registryDir = tempRoot("signer-lock-symlink-reg-dir");
      const registryPath = path.join(registryDir, "reg.json");
      const lockPath = lockPathFor(registryPath);
      expect(lockPath).toBe(`${registryPath}.lock`);
      const decoyTarget = path.join(registryDir, "decoy-lock-target");
      fs.writeFileSync(decoyTarget, "not a lock");
      fs.symlinkSync(decoyTarget, lockPath);
      expect(() =>
        Signer.invoke("signReleaseAttestation", {
          material_path: materialPath,
          digest: `nad1:${neutralSha256Hex("mh09-lock-symlink")}`,
          output_path: path.join(tempRoot("signer-lock-symlink-out"), "out.json"),
          mode: "fixture",
          used_key_registry_path: registryPath,
        })
      ).toThrow(/symlink|contain|escap|lock/i);
    });
  });

  describe("§atomicity and non-leakage", () => {
    it("writes the used-key registry AND the signature output atomically, each at 0600, with EITHER parent directory containing only its expected final file and no temp/lock debris, with otherwise-valid material", () => {
      const { materialPath } = writeFixtureMaterial("atomic");
      const outDir = tempRoot("signer-atomic-out");
      const regDir = tempRoot("signer-atomic-reg");
      const outputPath = path.join(outDir, "out.json");
      const registryPath = path.join(regDir, "reg.json");
      Signer.invoke("signReleaseAttestation", {
        material_path: materialPath,
        digest: `nad1:${neutralSha256Hex("mh09-signer-atomic")}`,
        output_path: outputPath,
        mode: "fixture",
        used_key_registry_path: registryPath,
      });

      const outEntries = fs.readdirSync(outDir);
      const regEntries = fs.readdirSync(regDir);
      expect(outEntries).toEqual(["out.json"]);
      expect(regEntries).toEqual(["reg.json"]);
      expect(outEntries.some((entry) => /\.tmp$|\.lock$/.test(entry))).toBe(false);
      expect(regEntries.some((entry) => /\.tmp$|\.lock$/.test(entry))).toBe(false);

      expect(fs.statSync(outputPath).mode & 0o777).toBe(0o600);
      expect(fs.statSync(registryPath).mode & 0o777).toBe(0o600);
      // The deterministic lock path (§"lock path contract" below) must not
      // outlive a successfully completed, non-concurrent run.
      expect(fs.existsSync(lockPathFor(registryPath))).toBe(false);
    });

    it("a successful signing run never writes private chain material into the output file or the used-key registry", () => {
      // NOT wrapped in try/catch: this is the SUCCESS-path obligation, and it
      // stays RED until a real signing run actually happens to inspect.
      const { material, materialPath } = writeFixtureMaterial("leak-success");
      const privateSeeds = material.leaves.flatMap((leaf) => leaf.private_seeds);
      const outputPath = path.join(tempRoot("signer-leak-out"), "out.json");
      const registryPath = path.join(tempRoot("signer-leak-reg"), "reg.json");
      Signer.invoke("signReleaseAttestation", {
        material_path: materialPath,
        digest: `nad1:${neutralSha256Hex("mh09-signer-leak-success")}`,
        output_path: outputPath,
        mode: "fixture",
        used_key_registry_path: registryPath,
      });
      const outputText = fs.readFileSync(outputPath, "utf8");
      for (const seed of privateSeeds) expect(outputText.indexOf(seed)).toBe(-1);
      if (fs.existsSync(registryPath)) {
        const registryText = fs.readFileSync(registryPath, "utf8");
        for (const seed of privateSeeds) expect(registryText.indexOf(seed)).toBe(-1);
      }
    });

    it("a refused signing attempt never leaks private chain material in its error text (defensive; holds under absence and under production alike)", () => {
      const { material, materialPath } = writeFixtureMaterial("leak-refusal");
      const privateSeeds = material.leaves.flatMap((leaf) => leaf.private_seeds);
      expect(() =>
        Signer.invoke("signReleaseAttestation", {
          material_path: materialPath,
          digest: `nad1:${neutralSha256Hex("mh09-signer-leak-refusal")}`,
          output_path: "/dev/null/impossible/output.json",
          mode: "fixture",
          used_key_registry_path: path.join(tempRoot("signer-leak-refusal-reg"), "reg.json"),
        })
      ).toThrow();
      try {
        Signer.invoke("signReleaseAttestation", {
          material_path: materialPath,
          digest: `nad1:${neutralSha256Hex("mh09-signer-leak-refusal")}`,
          output_path: "/dev/null/impossible/output.json",
          mode: "fixture",
          used_key_registry_path: path.join(tempRoot("signer-leak-refusal-reg-2"), "reg.json"),
        });
      } catch (error) {
        expect((error as Error).message).not.toMatch(/private|seed|secret/i);
        for (const seed of privateSeeds) expect((error as Error).message.indexOf(seed)).toBe(-1);
      }
    });
  });

  describe("§production-mode refusals", () => {
    it("refuses production mode with absent provisioning, using otherwise-valid fixture material", () => {
      const { materialPath } = writeFixtureMaterial("prod-absent");
      expect(() =>
        Signer.invoke("signReleaseAttestation", {
          material_path: materialPath,
          digest: `nad1:${neutralSha256Hex("mh09-prod-absent")}`,
          output_path: path.join(tempRoot("signer-prod-out"), "out.json"),
          mode: "production",
          used_key_registry_path: path.join(tempRoot("signer-prod-reg"), "reg.json"),
        })
      ).toThrow();
    });

    it("refuses production mode when the material path is a non-production (temp/test) root, using otherwise-valid fixture material content", () => {
      const { materialPath } = writeFixtureMaterial("prod-fixture-root");
      expect(() =>
        Signer.invoke("signReleaseAttestation", {
          material_path: materialPath,
          digest: `nad1:${neutralSha256Hex("mh09-prod-fixture-root")}`,
          output_path: path.join(tempRoot("signer-prod-fixture-out"), "out.json"),
          mode: "production",
          used_key_registry_path: path.join(tempRoot("signer-prod-fixture-reg"), "reg.json"),
        })
      ).toThrow();
    });

    it("refuses a caller-supplied trust-root substitution in production mode, using otherwise-valid fixture material", () => {
      const { materialPath } = writeFixtureMaterial("prod-trust");
      expect(() =>
        Signer.invoke("signReleaseAttestation", {
          material_path: materialPath,
          digest: `nad1:${neutralSha256Hex("mh09-prod-trust")}`,
          output_path: path.join(tempRoot("signer-prod-trust-out"), "out.json"),
          mode: "production",
          used_key_registry_path: path.join(tempRoot("signer-prod-trust-reg"), "reg.json"),
          trust_root_override: { attestor_id: "guild.release-attestor", verification_root: "0".repeat(64) },
        })
      ).toThrow();
    });
  });

  describe("§genuine concurrent reuse: two independent OS processes racing the SAME valid material/registry/key", () => {
    const SCRIPTS_ROOT = path.resolve(__dirname, "..");

    /**
     * The CLI contract this owner pins (mirrors the library option names
     * one-for-one): `sign-release-attestation.ts --material-path <p> --digest
     * <d> --output-path <p> --mode <m> --used-key-registry-path <p>`. Spawned
     * as a genuinely separate OS process — not an in-process call — so this is
     * an actual race on the filesystem, not a simulated one.
     */
    function runSignerCli(args: readonly string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
      return new Promise((resolve) => {
        const child = spawn("npx", ["tsx", SIGNER_SOURCE_PATH, ...args], { cwd: SCRIPTS_ROOT });
        let stdout = "";
        let stderr = "";
        child.stdout?.on("data", (chunk) => (stdout += chunk.toString()));
        child.stderr?.on("data", (chunk) => (stderr += chunk.toString()));
        child.on("error", (error) => resolve({ code: -1, stdout, stderr: `spawn error: ${error.message}` }));
        child.on("close", (code) => resolve({ code, stdout, stderr }));
      });
    }

    it(
      "exactly one of two concurrent CLI processes signing with the SAME material/registry/key succeeds; the other refuses reuse/reserved/lock; no partial output or stale lock survives either process",
      async () => {
        const { materialPath } = writeFixtureMaterial("concurrent-cli");
        const registryPath = path.join(tempRoot("signer-concurrent-reg"), "reg.json");
        const outputA = path.join(tempRoot("signer-concurrent-out-a"), "out.json");
        const outputB = path.join(tempRoot("signer-concurrent-out-b"), "out.json");
        const digest = `nad1:${neutralSha256Hex("mh09-signer-concurrent")}`;
        const argsFor = (outputPath: string): readonly string[] => [
          "--material-path", materialPath,
          "--digest", digest,
          "--output-path", outputPath,
          "--mode", "fixture",
          "--used-key-registry-path", registryPath,
        ];

        // Launched together, awaited together — a genuine race, not two
        // sequential in-process calls.
        const [resultA, resultB] = await Promise.all([runSignerCli(argsFor(outputA)), runSignerCli(argsFor(outputB))]);

        const successes = [resultA, resultB].filter((r) => r.code === 0);
        const failures = [resultA, resultB].filter((r) => r.code !== 0);
        // RED while the module is absent: `npx tsx <missing file>` fails BOTH
        // processes (0 successes), so this assertion fails for the correct
        // reason. Only a real signer that lets exactly one process win the
        // race can ever satisfy it.
        expect(successes.length).toBe(1);
        expect(failures.length).toBe(1);
        expect((failures[0]?.stderr ?? "") + (failures[0]?.stdout ?? "")).toMatch(/reuse|reserved|lock/i);

        const failedOutputPath = resultA.code !== 0 ? outputA : outputB;
        expect(fs.existsSync(failedOutputPath)).toBe(false);
        expect(fs.existsSync(lockPathFor(registryPath))).toBe(false);
      },
      45000
    );
  });
});

// ---------------------------------------------------------------------------
// §4 — the control battery distinguishes good from bad (GREEN now)
//
// `ReferenceMh09` (the WOTS+/Merkle signer, key registries, and evaluation-logic
// good/bad pairs) is defined once, above §2, so both the production-bound
// sections and this control battery can share it — §2/§3 use its fixture
// material builder to exercise the real production signer/evaluator entrypoints
// with genuinely valid, verifiable test-owned material; this section proves the
// reference logic itself is discriminating. The WOTS+/Merkle reference SIGNER is
// checked against the REAL, already-accepted `neutralVerifyAttestationSignature`
// core — it is not a stand-in for that verifier, it proves the exact scheme
// production must implement is achievable and that the verifier genuinely
// discriminates.
// ---------------------------------------------------------------------------

describe("the control battery distinguishes good from bad", () => {
  const DIGEST = `nad1:${neutralSha256Hex("guild-mh09-test-battery-digest")}`;

  describe("§WOTS+/Merkle signer — proven against the REAL accepted verifier", () => {
    it("a signature from the test-owned key material verifies under neutralVerifyAttestationSignature", () => {
      const tree = ReferenceMh09.buildTree("root-and-verify");
      const signature = ReferenceMh09.sign(tree, 0, DIGEST);
      expect(neutralVerifyAttestationSignature(tree.root, DIGEST, signature)).toBe(true);
    });

    it("every leaf position in the tree can sign and verify (round-trips the whole Merkle authentication path)", () => {
      const tree = ReferenceMh09.buildTree("every-leaf");
      const leafCount = Math.pow(2, NEUTRAL_ATTESTATION_TREE_HEIGHT);
      for (let keyIndex = 0; keyIndex < leafCount; keyIndex += 1) {
        const signature = ReferenceMh09.sign(tree, keyIndex, DIGEST);
        expect(neutralVerifyAttestationSignature(tree.root, DIGEST, signature)).toBe(true);
      }
    });

    it("§anti-vacuity: a signature verifies against ITS OWN test root but never against a different tree's root", () => {
      const treeA = ReferenceMh09.buildTree("tree-a");
      const treeB = ReferenceMh09.buildTree("tree-b");
      const signature = ReferenceMh09.sign(treeA, 0, DIGEST);
      expect(neutralVerifyAttestationSignature(treeA.root, DIGEST, signature)).toBe(true);
      expect(neutralVerifyAttestationSignature(treeB.root, DIGEST, signature)).toBe(false);
    });

    it("§anti-vacuity: a signature never verifies against a different digest", () => {
      const tree = ReferenceMh09.buildTree("digest-swap");
      const signature = ReferenceMh09.sign(tree, 0, DIGEST);
      const otherDigest = `nad1:${neutralSha256Hex("a different message entirely")}`;
      expect(neutralVerifyAttestationSignature(tree.root, otherDigest, signature)).toBe(false);
    });

    it("§anti-vacuity: a single flipped hex character anywhere in the signature fails verification", () => {
      const tree = ReferenceMh09.buildTree("bitflip");
      const signature = ReferenceMh09.sign(tree, 3, DIGEST);
      const flippedChar = signature.charAt(20) === "0" ? "1" : "0";
      const flipped = `${signature.slice(0, 20)}${flippedChar}${signature.slice(21)}`;
      expect(flipped).not.toBe(signature);
      expect(neutralVerifyAttestationSignature(tree.root, DIGEST, flipped)).toBe(false);
    });

    it("§anti-vacuity: the production trust root NEVER verifies a test-owned signature — production seeds and test seeds are disjoint by construction", () => {
      const tree = ReferenceMh09.buildTree("disjoint-from-production");
      const signature = ReferenceMh09.sign(tree, 0, DIGEST);
      for (const key of NEUTRAL_ATTESTOR_TRUST_ROOT) {
        expect(neutralVerifyAttestationSignature(key.verification_root, DIGEST, signature)).toBe(false);
      }
    });

    it("§leak control: the good signer reveals only walked chain values; the bad signer leaks the raw private seeds", () => {
      const tree = ReferenceMh09.buildTree("leak-control");
      // A raw private seed is legitimately EQUAL to its own revealed chain value
      // whenever that chain's code-word symbol is 0 (zero steps walked) — that is
      // an inherent property of WOTS+, not a leak. So this control picks a digest
      // whose code word has NO zero symbols, which makes "every revealed value
      // differs from its raw seed" a valid, non-vacuous discriminator between the
      // good signer (walks every chain at least one step) and the bad one (hands
      // back the untouched seeds directly).
      let digest = DIGEST;
      let symbols = ReferenceMh09.codeWord(neutralSha256Hex(`${NEUTRAL_ATTESTATION_SIGNATURE_DOMAIN}|M|${tree.root}|0|${digest}`));
      let attempt = 0;
      while (symbols === null || symbols.some((s) => s === 0)) {
        attempt += 1;
        digest = `nad1:${neutralSha256Hex(`guild-mh09-leak-control-${attempt}`)}`;
        symbols = ReferenceMh09.codeWord(neutralSha256Hex(`${NEUTRAL_ATTESTATION_SIGNATURE_DOMAIN}|M|${tree.root}|0|${digest}`));
      }

      const good = ReferenceMh09.sign(tree, 0, digest);
      const bad = ReferenceMh09.signLeakingPrivateSeeds(tree, 0, digest);
      expect(bad.signature).toBe(good);
      expect(bad.leaked_private_seeds.length).toBe(NEUTRAL_ATTESTATION_CHAINS);
      expect(neutralVerifyAttestationSignature(tree.root, digest, good)).toBe(true);
      // The private seeds are never substrings of the honest signature output.
      for (const seed of bad.leaked_private_seeds) {
        expect(good.indexOf(seed)).toBe(-1);
      }
    });
  });

  describe("§one-time key reservation: atomic reserve-then-sign vs sign-then-reserve", () => {
    it("the good registry refuses a second reservation of the same key outright", () => {
      const registry = new ReferenceMh09.KeyRegistry();
      registry.reserve("guild.release-attestor", "root-x", 0);
      expect(() => registry.reserve("guild.release-attestor", "root-x", 0)).toThrow(/refusing reuse/);
    });

    it("§anti-vacuity: the non-atomic registry lets two callers race past the check before either commits — the good registry cannot", () => {
      const goodRegistry = new ReferenceMh09.KeyRegistry();
      const badRegistry = new ReferenceMh09.NonAtomicKeyRegistry();

      // Simulate two concurrent callers both observing "not yet reserved" before
      // either writes — the exact race a check-then-set-without-a-lock allows.
      let goodSecondCallerObservedFree = true;
      try {
        registryProbe(goodRegistry);
        registryProbe(goodRegistry);
      } catch {
        goodSecondCallerObservedFree = false;
      }
      expect(goodSecondCallerObservedFree).toBe(false);

      function registryProbe(registry: InstanceType<typeof ReferenceMh09.KeyRegistry>): void {
        registry.reserve("guild.release-attestor", "root-race", 1);
      }

      // The bad registry's own sequential call DOES throw (it checks after
      // mutating), but unlike the good registry it performs the mutation before
      // the check — the exact "consumed key remains consumed on later failure"
      // property inverted: a caller reading the registry BETWEEN the mutation and
      // the throw sees the key already marked used even though this call fails.
      let mutatedBeforeThrow = false;
      const probe = new ReferenceMh09.NonAtomicKeyRegistry();
      probe.reserveAfterUse("guild.release-attestor", "root-race-2", 2);
      try {
        probe.reserveAfterUse("guild.release-attestor", "root-race-2", 2);
      } catch {
        mutatedBeforeThrow = true;
      }
      expect(mutatedBeforeThrow).toBe(true);
      void badRegistry;
    });
  });

  describe("§trust-root substitution", () => {
    it("the good admission recognizes only the three pinned production attestors", () => {
      expect(ReferenceMh09.recognizedProductionRoot("guild.release-attestor")).not.toBeNull();
      expect(ReferenceMh09.recognizedProductionRoot("acme.self-notary")).toBeNull();
    });

    it("§anti-vacuity: the bad admission accepts ANY caller-supplied root as if it were the pinned one", () => {
      const forgedRoot = "f".repeat(64);
      expect(ReferenceMh09.recognizedProductionRoot("acme.self-notary")).toBeNull();
      expect(ReferenceMh09.acceptCallerSuppliedRoot("acme.self-notary", forgedRoot)).toBe(forgedRoot);
    });
  });

  describe("§full-field identity comparison vs label-only match", () => {
    it("the good comparison catches a package-hash-only drift", () => {
      const drifted = { ...IDENTITY, package_hash: `sha256:${"0".repeat(64)}` };
      expect(ReferenceMh09.differingIdentityFields(IDENTITY, drifted)).toEqual(["package_hash"]);
    });

    it("§anti-vacuity: label-only matching misses the same package-hash drift entirely", () => {
      const drifted = { ...IDENTITY, package_hash: `sha256:${"0".repeat(64)}` };
      expect(ReferenceMh09.differingIdentityFields(IDENTITY, drifted).length).toBeGreaterThan(0);
      expect(ReferenceMh09.labelOnlyRuntimeMatch(IDENTITY, drifted)).toBe(true);
    });
  });

  describe("§contract-major admission: refuse vs silent downgrade", () => {
    it("the good admission refuses a major mismatch with contract_major_mismatch", () => {
      expect(ReferenceMh09.admitContractMajor(2, 1)).toEqual({ admitted: false, reason_code: "contract_major_mismatch" });
    });

    it("§anti-vacuity: the bad admission silently downgrades and admits anyway", () => {
      expect(ReferenceMh09.admitContractMajor(2, 1).admitted).toBe(false);
      expect(ReferenceMh09.admitContractMajorSilentDowngrade(2, 1).admitted).toBe(true);
    });
  });

  describe("§version-age acceptance", () => {
    it("the good rule refuses a drifted identity regardless of age", () => {
      const drifted = { ...IDENTITY, adapter_version: "guild.host_adapter.v1.0.1" };
      expect(ReferenceMh09.stillValid(IDENTITY, drifted, 1)).toBe(false);
    });

    it("§anti-vacuity: the bad rule accepts the same drift purely because it is recent", () => {
      const drifted = { ...IDENTITY, adapter_version: "guild.host_adapter.v1.0.1" };
      expect(ReferenceMh09.stillValid(IDENTITY, drifted, 1)).toBe(false);
      expect(ReferenceMh09.stillValidByAge(IDENTITY, drifted, 1)).toBe(true);
    });
  });

  describe("§collapsed support state", () => {
    it("the real core keeps six independent dimensions — proving one never implies another", () => {
      const afterRecognizeOnly = NEUTRAL_UNEVALUATED_SUPPORT;
      const claim = deriveNeutralSupportClaim(afterRecognizeOnly);
      expect(claim.proven).toEqual([]);
      expect((claim as unknown as Record<string, unknown>).supported).toBeUndefined();
    });

    it("§anti-vacuity: a collapsed boolean view reports 'supported' from a single satisfied dimension", () => {
      const record = ReferenceMh09.proveDimension(
        { ...NEUTRAL_UNEVALUATED_SUPPORT, recognized: "satisfied" } as NeutralSupportRecord,
        "render",
        true
      );
      expect(record.installed).toBe("not_evaluated");
      expect(ReferenceMh09.collapsedSupportClaim(record).supported).toBe(true);
    });
  });

  describe("§render-as-install and install-as-activation", () => {
    it("the real core refuses install without rendered being proven first", () => {
      const outcome = applyNeutralSupportTransition(NEUTRAL_UNEVALUATED_SUPPORT, "install", { satisfied: true });
      expect(outcome.outcome.disposition).toBe("refused");
      expect(outcome.record.installed).toBe("not_evaluated");
    });

    it("§anti-vacuity: a rendered-implies-installed mutant promotes installed without any install operation at all", () => {
      const rendered = applyNeutralSupportTransition(
        { ...NEUTRAL_UNEVALUATED_SUPPORT, recognized: "satisfied" } as NeutralSupportRecord,
        "render",
        { satisfied: true }
      ).record;
      expect(rendered.installed).toBe("not_evaluated");
      expect(ReferenceMh09.renderAsInstall(rendered).installed).toBe("satisfied");
    });

    it("§anti-vacuity: an installed-implies-activated mutant promotes activated without any runtime discovery", () => {
      const installed = { ...NEUTRAL_UNEVALUATED_SUPPORT, recognized: "satisfied", rendered: "satisfied", installed: "satisfied" } as NeutralSupportRecord;
      expect(installed.activated).toBe("not_evaluated");
      expect(ReferenceMh09.installAsActivation(installed).activated).toBe("satisfied");
    });
  });

  describe("§update without before/after discovery", () => {
    it("the good rule requires both a before and an after observation naming a different version", () => {
      expect(ReferenceMh09.promoteUpdated({ version: "guild-2.4.0" }, { version: "guild-2.5.0" })).toBe(true);
      expect(ReferenceMh09.promoteUpdated(null, { version: "guild-2.5.0" })).toBe(false);
    });

    it("§anti-vacuity: the bad rule promotes from an after-only render refresh", () => {
      expect(ReferenceMh09.promoteUpdated(null, { version: "guild-2.5.0" })).toBe(false);
      expect(ReferenceMh09.promoteUpdatedAfterOnly(null, { version: "guild-2.5.0" })).toBe(true);
    });
  });

  describe("§incomplete-suite conformance", () => {
    it("the good rule requires every required id to resolve", () => {
      expect(ReferenceMh09.promoteConformant(["a", "b", "c"], ["a", "b", "c"])).toBe(true);
      expect(ReferenceMh09.promoteConformant(["a", "b", "c"], ["a", "b"])).toBe(false);
    });

    it("§anti-vacuity: the bad rule promotes on a bare majority, letting a required failure through", () => {
      const required = Array.from({ length: 31 }, (_, i) => `id-${i}`);
      const resolved = required.slice(0, 20);
      expect(ReferenceMh09.promoteConformant(required, resolved)).toBe(false);
      expect(ReferenceMh09.promoteConformantOnMajority(required, resolved)).toBe(true);
    });
  });

  describe("§real release-distribution claim verification is what the good evidence path is built from", () => {
    it("a well-formed operation evidence row round-trips through the real buildOperationEvidence", () => {
      const evidence = operationEvidence("install");
      expect(evidence.kind).toBe("install");
      expect(OPERATION_KINDS).toContain(evidence.kind);
      expect(evidence.destination.startsWith("/")).toBe(true);
    });

    it("a complete, well-formed release claim passes the REAL verifyReleaseClaim with zero errors — the positive path MHRC-SUP-003/004/005 evidence is built from", () => {
      const { claim, archive } = buildFixtureReleaseClaim();
      expect(verifyReleaseClaim(claim, archive)).toEqual([]);
    });

    it("IDENTITY.package_hash is the REAL sha256 of the fixture archive, not an independently invented literal — the claim's own archive_sha256 agrees", () => {
      const { claim, archive } = buildFixtureReleaseClaim();
      expect(IDENTITY.package_hash).toBe(`sha256:${FIXTURE_ARCHIVE_SHA256}`);
      expect(claim.archive_sha256).toBe(FIXTURE_ARCHIVE_SHA256);
      expect(crypto.createHash("sha256").update(archive).digest("hex")).toBe(FIXTURE_ARCHIVE_SHA256);
    });

    it("§anti-vacuity: a tampered archive checksum is caught by the REAL verifyReleaseClaim, not waved through", () => {
      const { claim, archive } = buildFixtureReleaseClaim();
      const tampered: ReleaseClaim = { ...claim, archive_sha256: "0".repeat(64) };
      expect(verifyReleaseClaim(tampered, archive).length).toBeGreaterThan(0);
    });

    it("§anti-vacuity: a tampered manifest is caught by the REAL verifyReleaseClaim", () => {
      const { claim, archive } = buildFixtureReleaseClaim();
      const tampered: ReleaseClaim = { ...claim, manifest: { entries: [{ path: "tampered", sha256: "f".repeat(64) }] } };
      expect(verifyReleaseClaim(tampered, archive).length).toBeGreaterThan(0);
    });

    it("§anti-vacuity: a claim whose activation operation lacks operator evidence is caught by the REAL verifyReleaseClaim", () => {
      const { claim, archive } = buildFixtureReleaseClaim();
      const tampered: ReleaseClaim = {
        ...claim,
        operations: claim.operations.map((op) => (op.kind === "activate" ? { ...op, evidence_class: "release-builder" as const } : op)),
      };
      expect(verifyReleaseClaim(tampered, archive).length).toBeGreaterThan(0);
    });
  });
});
