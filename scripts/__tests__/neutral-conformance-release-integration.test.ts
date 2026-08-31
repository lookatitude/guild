/**
 * __tests__/neutral-conformance-release-integration.test.ts
 *
 * FIC-155 / A21-X (RED-FIRST) — the executable contract for the final local
 * integration seam: replacing the honest-but-incomplete 5/31 release emission
 * with real six-owner packet assembly and exact 31/31 coverage.
 *
 * WHAT THIS BINDS
 *   The accepted assembly spine (`neutral-conformance-assembly.ts`) can already
 *   join six owner packets into one frozen 31-scenario aggregate — but nothing
 *   in production PRODUCES those six packets from the real owner evaluators,
 *   nothing hands the aggregate to `evaluateNeutralConformanceDecision`, the
 *   release emitter still hard-codes the honest 5/31 coverage statement, and
 *   the promotion gate still REQUIRES exactly that 5/31 shape. This file states
 *   what A21-X production must be before a 31/31 release record may exist:
 *
 *   1. a source-owned integration function
 *      `runNeutralConformanceReleaseIntegration` in a new module
 *      `src/modules/distribution/workflows/release-conformance-integration.ts`,
 *      exported through the distribution index, that accepts ONE canonical JSON
 *      text (never an object graph), invokes or consumes all six real owner
 *      evaluators WITHOUT caller-supplied scenario ids or outcomes, obtains six
 *      immutable owner packets, and calls `assembleNeutralConformanceEvidence`;
 *   2. the release emitter (`scripts/emit-release-conformance.ts`) consuming
 *      the assembled aggregate and emitting an honest 31/31 record ONLY after
 *      assembly and the production decision succeed — which entails the
 *      five-scenario evaluator package alone NO LONGER emitting;
 *   3. the channel promotion gate (`scripts/check-channel-integrity.ts
 *      promotion`) re-running the same full integration/assembly decision from
 *      the transported inputs instead of trusting a claimed verdict or count —
 *      which entails the current honest-5/31 record NO LONGER promoting and a
 *      claimed-31/31 record being refused on re-run substance, never accepted
 *      on its own say-so.
 *
 *   As with the MH-03..MH-09 siblings, the contract is written twice: once as
 *   production-bound obligations (§"A21-X production obligations" — every `it`
 *   fails RED because the integration module and its wiring do not exist), and
 *   once as CONTROLS that are GREEN from the first run: a test-side conforming
 *   ORACLE proving this suite can construct valid inputs (so a RED is always a
 *   missing production behavior, never a test that cannot feed the boundary),
 *   plus planted broken MUTANTS of the integration contract whose defects are
 *   proven test-side, so the production control battery this file demands is
 *   demonstrably discriminating rather than a rubber stamp.
 *
 * WHAT IT DELIBERATELY DOES NOT BIND
 *   No owner evaluator internals — MH-03/06/07/08 are shipped and separately
 *   suite-bound; MH-09 is bound by the FIC-153 RED suite and may still be
 *   mid-implementation (FIC-154), so this file binds it LAZILY: only as an
 *   import specifier the integration source must name, never as a module this
 *   suite requires to exist or load. No off-repository attestor material: the
 *   pinned production trust-root seeds were discarded by design, so no test can
 *   mint a promotable 31/31 bundle — every promotable-path obligation here is
 *   therefore expressed as a REFUSAL the production code must take, and the
 *   green 31/31 emission remains an operator act outside any test repository.
 *
 * PINNED NAMES (the GREEN lane implements exactly these)
 *   module   src/modules/distribution/workflows/release-conformance-integration.ts
 *   exports  runNeutralConformanceReleaseIntegration
 *            runNeutralReleaseIntegrationControls
 *            RELEASE_INTEGRATION_CONTROLS
 *            RELEASE_INTEGRATION_OWNER_KEYS
 *            RELEASE_INTEGRATION_REQUEST_MEMBERS   (= ["claim","owner_inputs"])
 *            RELEASE_INTEGRATION_REFUSAL_CONTROLS  (superset of the pinned set)
 *   result   { outcome, evidence, packets } — evidence/packets null on refusal
 *
 * RED DIAGNOSTIC: every production-bound failure below either throws the one
 * binder message naming the missing module/export, or fails an expectation on a
 * production value that A21-X has not yet rewired (5/31 still emitting, 5/31
 * still promoting, claimed-31/31 refused for count-shape instead of substance).
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { createHash } from "crypto";

import {
  neutralCanonicalJson,
  NEUTRAL_CONTRACT_VERSION,
} from "../../src/modules/lifecycle/workflows/neutral-runtime-contracts";
import type { NeutralOutcome } from "../../src/modules/lifecycle/workflows/neutral-runtime-contracts";
import {
  evaluateNeutralConformanceDecision,
  NEUTRAL_EVIDENCE_IDENTITY_FIELDS,
  NEUTRAL_REQUIRED_CORE_SCENARIO_IDS,
  NEUTRAL_SCENARIO_SUITE_ID,
  NEUTRAL_SCENARIO_SUITE_VERSION,
} from "../../src/modules/lifecycle/workflows/neutral-conformance-core";
import type {
  NeutralConformanceAuthority,
  NeutralConformanceEvidence,
  NeutralEvidenceIdentity,
  NeutralScenarioResult,
} from "../../src/modules/lifecycle/workflows/neutral-conformance-core";
import {
  assembleNeutralConformanceEvidence,
  NEUTRAL_ASSEMBLY_PACKET_SCHEMA,
  NEUTRAL_CONFORMANCE_OWNER_KEYS,
  NEUTRAL_CONFORMANCE_OWNER_SCENARIO_COUNTS,
  NEUTRAL_OWNER_SCENARIO_IDS,
  NEUTRAL_REQUIRED_SUITE_SCENARIO_COUNT,
  NEUTRAL_REQUIRED_SUITE_SCENARIO_IDS,
} from "../../src/modules/lifecycle/workflows/neutral-conformance-assembly";
import type { NeutralOwnerConformancePacket } from "../../src/modules/lifecycle/workflows/neutral-conformance-assembly";
import { emitReleaseConformance } from "../emit-release-conformance";
import {
  checkStablePromotion,
  promotionAllowedPaths,
  FROZEN_SCENARIO_CONTRACT_IDS,
  FROZEN_SCENARIO_CONTRACT_SHA256,
  MANIFEST_PATH,
} from "../check-channel-integrity";
import type { PromotionGitOps } from "../check-channel-integrity";

// ---------------------------------------------------------------------------
// The module under contract (lazy binder — the ONE tolerated RED diagnostic)
// ---------------------------------------------------------------------------

const RED = "A21-X RED: production release-conformance integration not implemented yet";

const INTEGRATION_REQUEST = "../../src/modules/distribution/workflows/release-conformance-integration";
const INTEGRATION_SOURCE_PATH = path.resolve(
  __dirname,
  "../../src/modules/distribution/workflows/release-conformance-integration.ts"
);
const DISTRIBUTION_INDEX_PATH = path.resolve(__dirname, "../../src/modules/distribution/index.ts");
const EMITTER_SOURCE_PATH = path.resolve(__dirname, "../emit-release-conformance.ts");
const GATE_SOURCE_PATH = path.resolve(__dirname, "../check-channel-integrity.ts");

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

const Integration = makeBinder(INTEGRATION_SOURCE_PATH, INTEGRATION_REQUEST);

/** The integration result contract every implementation (real or mutant) obeys. */
interface IntegrationResult {
  readonly outcome: NeutralOutcome;
  readonly evidence: NeutralConformanceEvidence | null;
  readonly packets: readonly NeutralOwnerConformancePacket[] | null;
}
type IntegrationFunction = (request: unknown) => IntegrationResult;

interface IntegrationControlReport {
  readonly passed: boolean;
  readonly failed_ids: readonly string[];
  readonly control_count: number;
}

function realIntegration(): IntegrationFunction {
  return Integration.exported<IntegrationFunction>("runNeutralConformanceReleaseIntegration");
}

function runBattery(implementation: IntegrationFunction): IntegrationControlReport {
  return Integration.invoke<IntegrationControlReport>(
    "runNeutralReleaseIntegrationControls",
    implementation
  );
}

// ---------------------------------------------------------------------------
// The pinned A21-X vocabulary (this suite's independent statement)
// ---------------------------------------------------------------------------

/** The two request members. A canonical text declaring anything else refuses. */
const REQUEST_MEMBERS = ["claim", "owner_inputs"] as const;

/** Refusal controls the integration must place on `outcome.facts.refusal_control`. */
const REQUIRED_REFUSAL_CONTROLS: readonly string[] = [
  "integration_request_not_canonical_text",
  "caller_supplied_packets",
  "caller_supplied_required_set",
  "caller_supplied_outcomes",
  "owner_evaluation_failed",
];

/**
 * The minimum control battery the production module must declare AND satisfy.
 * Each id names one property of the mandate; the discrimination proof below
 * (battery vs planted mutants) is what keeps these from being empty labels.
 */
const REQUIRED_BATTERY_CONTROL_IDS: readonly string[] = [
  "A21X-C01-full-suite-assembly",
  "A21X-C02-owner-counts",
  "A21X-C03-real-owner-evaluators",
  "A21X-C04-canonical-text-boundary",
  "A21X-C05-caller-channel-closed",
  "A21X-C06-single-evidence-identity",
  "A21X-C07-receipt-liveness",
  "A21X-C08-determinism",
  "A21X-C09-output-immutability",
  "A21X-C10-weakened-owner-refuses",
  "A21X-C11-fixture-provisioning-not-promotable",
];

/**
 * The 31 stable ids and their owners, transcribed INDEPENDENTLY of the assembly
 * module (two statements is the point: a drift surfaces as a failure, never as
 * a shared mistake). Order is canonical contract order.
 */
const OWNER_MH02 = "W1/MH-02";
const OWNER_MH03 = "W2/MH-03";
const OWNER_MH06 = "W1/MH-06";
const OWNER_MH07 = "W4/MH-07";
const OWNER_MH08 = "W4/MH-08";
const OWNER_MH09 = "W5/MH-09";
const OWNER_KEYS = [OWNER_MH02, OWNER_MH03, OWNER_MH06, OWNER_MH07, OWNER_MH08, OWNER_MH09];

const SUITE_OWNERSHIP: ReadonlyArray<readonly [string, string]> = [
  ["MHRC-LIF-001", OWNER_MH02],
  ["MHRC-LIF-002", OWNER_MH02],
  ["MHRC-LIF-003", OWNER_MH02],
  ["MHRC-LIF-004", OWNER_MH02],
  ["MHRC-EVT-001", OWNER_MH03],
  ["MHRC-EVT-002", OWNER_MH03],
  ["MHRC-SUP-001", OWNER_MH09],
  ["MHRC-SUP-002", OWNER_MH09],
  ["MHRC-SUP-003", OWNER_MH09],
  ["MHRC-SUP-004", OWNER_MH09],
  ["MHRC-SUP-005", OWNER_MH09],
  ["MHRC-SUP-006", OWNER_MH09],
  ["MHRC-UNS-001", OWNER_MH03],
  ["MHRC-UNS-002", OWNER_MH02],
  ["MHRC-UNS-003", OWNER_MH03],
  ["MHRC-RCT-001", OWNER_MH06],
  ["MHRC-RCT-002", OWNER_MH06],
  ["MHRC-RCT-003", OWNER_MH06],
  ["MHRC-RCT-004", OWNER_MH06],
  ["MHRC-RCT-005", OWNER_MH06],
  ["MHRC-MOD-001", OWNER_MH07],
  ["MHRC-MOD-002", OWNER_MH07],
  ["MHRC-MOD-003", OWNER_MH07],
  ["MHRC-MOD-004", OWNER_MH07],
  ["MHRC-STR-001", OWNER_MH08],
  ["MHRC-STR-002", OWNER_MH08],
  ["MHRC-STR-003", OWNER_MH08],
  ["MHRC-STR-004", OWNER_MH08],
  ["MHRC-VER-001", OWNER_MH09],
  ["MHRC-VER-002", OWNER_MH09],
  ["MHRC-VER-003", OWNER_MH09],
];
const SUITE_IDS = SUITE_OWNERSHIP.map(([stableId]) => stableId);
const EXPECTED_OWNER_COUNTS: Readonly<Record<string, number>> = {
  [OWNER_MH02]: 5,
  [OWNER_MH03]: 4,
  [OWNER_MH06]: 5,
  [OWNER_MH07]: 4,
  [OWNER_MH08]: 4,
  [OWNER_MH09]: 9,
};

/**
 * Import specifiers (bare filenames — robust to relative path shape) the
 * integration source must name: the six real owner boundaries plus the
 * assembly spine. MH-09's is the FIC-153-pinned module path; it is bound here
 * as a source STRING only, so this suite neither loads nor waits on FIC-154.
 */
const REQUIRED_INTEGRATION_IMPORTS: readonly string[] = [
  "neutral-conformance-core",
  "host-adapter-conformance-evaluator",
  "receipt-journal-conformance-evaluator",
  "module-boundary-conformance-evaluator",
  "host-cutover-controller",
  "release-conformance-evaluator",
  "neutral-conformance-assembly",
];

// ---------------------------------------------------------------------------
// Fixtures: the signed 5-scenario bundle (the only decision-recognized evidence)
// ---------------------------------------------------------------------------

const FIXTURES = path.join(__dirname, "fixtures", "release-conformance");
const SUITE_PATH = path.join(FIXTURES, "conformance-scenarios.v1.json");
const PACKAGE_PATH = path.join(FIXTURES, "evaluator-package.json");
const SOURCE_COMMIT = "b871c8d973bd8258c25ce5e87a89f68f2e63a516";
const HEAD_SHA = "1234567890abcdef1234567890abcdef12345678";
const VERSION = "2.2.0";
const BETA_VERSION = `${VERSION}-beta.20`;
const MARKETPLACE_PATH = ".claude-plugin/marketplace.json";
const GENERATED_AT = "2026-08-18T06:30:00.000Z";

interface FixturePackage {
  evidence: NeutralConformanceEvidence & {
    activated_runtime: NeutralEvidenceIdentity;
    results: NeutralScenarioResult[];
    claimant_id: string;
  };
  authority: NeutralConformanceAuthority;
}

const FIXTURE_PACKAGE: FixturePackage = JSON.parse(fs.readFileSync(PACKAGE_PATH, "utf8"));
const FIXTURE_IDENTITY = FIXTURE_PACKAGE.evidence.activated_runtime;
const FIXTURE_CLAIMANT = FIXTURE_PACKAGE.evidence.claimant_id;

function sha256(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "a21x-red-"));
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

// ---------------------------------------------------------------------------
// The conforming ORACLE: six owner packets that really assemble
// ---------------------------------------------------------------------------

function oracleCommitment(sequence: number): string {
  let hex = (sequence >>> 0).toString(16);
  while (hex.length < 16) hex = `0${hex}`;
  return `nec1:${hex}`;
}

function oracleReceiptRef(stableId: string): string {
  const sequence = SUITE_IDS.indexOf(stableId) + 1;
  return `guild.receipt_ref.v1:jrn-a21x-oracle#${sequence}@${oracleCommitment(sequence)}`;
}

function oracleResult(stableId: string, overrides: Record<string, unknown> = {}): NeutralScenarioResult {
  const result: Record<string, unknown> = {
    stable_id: stableId,
    outcome_type: "guild.lifecycle_outcome.v1",
    disposition: "succeeded",
    reason_code: null,
    receipt_ref: oracleReceiptRef(stableId),
    evidence_identity: clone(FIXTURE_IDENTITY),
    evidence_freshness: "fresh",
  };
  for (const key of Object.keys(overrides)) result[key] = overrides[key];
  return result as unknown as NeutralScenarioResult;
}

function oraclePacket(ownerKey: string): NeutralOwnerConformancePacket {
  const ids = SUITE_OWNERSHIP.filter(([, owner]) => owner === ownerKey).map(([stableId]) => stableId);
  return {
    schema_version: NEUTRAL_ASSEMBLY_PACKET_SCHEMA,
    suite_id: NEUTRAL_SCENARIO_SUITE_ID,
    suite_version: NEUTRAL_SCENARIO_SUITE_VERSION,
    owner_key: ownerKey,
    evidence_identity: clone(FIXTURE_IDENTITY),
    stable_ids: ids,
    results: ids.map((stableId) => oracleResult(stableId)),
  } as unknown as NeutralOwnerConformancePacket;
}

function oraclePackets(): NeutralOwnerConformancePacket[] {
  return OWNER_KEYS.map((ownerKey) => oraclePacket(ownerKey));
}

const ORACLE_CLAIM = { claimant_id: FIXTURE_CLAIMANT, activated_runtime: FIXTURE_IDENTITY };

function oracleAssemblyText(packets: readonly NeutralOwnerConformancePacket[]): string {
  return neutralCanonicalJson({ packets, claim: ORACLE_CLAIM });
}

/** The real assembler over the oracle packets — the suite's 31-scenario aggregate. */
function oracleAggregate(): NeutralConformanceEvidence {
  const assembled = assembleNeutralConformanceEvidence(oracleAssemblyText(oraclePackets()));
  if (assembled.evidence === null) {
    throw new Error(
      `oracle failed to assemble: ${JSON.stringify(assembled.outcome.facts?.refusal_control ?? null)}`
    );
  }
  return assembled.evidence;
}

/**
 * A FABRICATED full-suite evidence: the five signed MH-02 results extended with
 * 26 invented ones. Structurally complete, substantively unbacked — the exact
 * forgery the decision, the emitter, and the gate must all refuse.
 */
function fabricated31Evidence(): Record<string, unknown> {
  const realById = new Map(
    FIXTURE_PACKAGE.evidence.results.map((result) => [result.stable_id, result] as const)
  );
  const results = SUITE_IDS.map((stableId) => {
    const real = realById.get(stableId);
    return real !== undefined ? clone(real) : oracleResult(stableId);
  });
  return {
    suite_id: NEUTRAL_SCENARIO_SUITE_ID,
    suite_version: NEUTRAL_SCENARIO_SUITE_VERSION,
    required_scenario_ids: [...SUITE_IDS],
    activated_runtime: clone(FIXTURE_IDENTITY),
    results,
    claimant_id: FIXTURE_CLAIMANT,
  };
}

function promotable(outcome: NeutralOutcome): boolean {
  return outcome.disposition === "succeeded" && outcome.facts?.may_promote_conformant === true;
}

// ---------------------------------------------------------------------------
// Planted broken mutants of the integration contract (test-side, disposable)
// ---------------------------------------------------------------------------

function successResult(evidence: NeutralConformanceEvidence, packets: readonly NeutralOwnerConformancePacket[]): IntegrationResult {
  return {
    outcome: {
      type: "guild.boundary_outcome.v1",
      disposition: "succeeded",
      reason_code: null,
      assertions: ["mutant"],
      binding: { contract_version: NEUTRAL_CONTRACT_VERSION },
      facts: { mutant: true },
    } as unknown as NeutralOutcome,
    evidence,
    packets,
  };
}

function refusalResult(): IntegrationResult {
  return {
    outcome: {
      type: "guild.boundary_outcome.v1",
      disposition: "refused",
      reason_code: "scenario_evidence_incomplete",
      assertions: ["mutant refuses everything"],
      binding: { contract_version: NEUTRAL_CONTRACT_VERSION },
      facts: { refusal_control: "integration_request_not_canonical_text" },
    } as unknown as NeutralOutcome,
    evidence: null,
    packets: null,
  };
}

/** M1 — fabricates six packets and a success for ANY input, canonical or not. */
const mutantFabricator: IntegrationFunction = () => {
  const packets = oraclePackets();
  const assembled = assembleNeutralConformanceEvidence(oracleAssemblyText(packets));
  return successResult(assembled.evidence as NeutralConformanceEvidence, packets);
};

/** M2 — trusts caller-authored packets smuggled through the request text. */
const mutantPassthrough: IntegrationFunction = (request) => {
  if (typeof request !== "string") return refusalResult();
  let parsed: { packets?: NeutralOwnerConformancePacket[]; claim?: unknown };
  try {
    parsed = JSON.parse(request);
  } catch {
    return refusalResult();
  }
  if (!Array.isArray(parsed.packets)) return refusalResult();
  const assembled = assembleNeutralConformanceEvidence(
    neutralCanonicalJson({ packets: parsed.packets, claim: parsed.claim ?? ORACLE_CLAIM })
  );
  if (assembled.evidence === null) return refusalResult();
  return successResult(assembled.evidence, parsed.packets);
};

/** M3 — inspects and accepts non-text object requests (live-graph traversal). */
const mutantObjectAcceptor: IntegrationFunction = (request) => {
  if (request !== null && typeof request === "object") {
    // Reading properties off the caller's live object is exactly the traversal
    // the text boundary exists to make impossible.
    void Object.keys(request as Record<string, unknown>);
    return mutantFabricator(request);
  }
  return mutantFabricator(request);
};

/** M4 — reports success with only 30 of the 31 scenarios (a count liar). */
const mutantCountLiar: IntegrationFunction = () => {
  const full = oracleAggregate();
  const evidence = {
    suite_id: full.suite_id,
    suite_version: full.suite_version,
    required_scenario_ids: full.required_scenario_ids.slice(0, 30),
    activated_runtime: clone(FIXTURE_IDENTITY),
    results: full.results.slice(0, 30).map((result) => clone(result)),
    claimant_id: FIXTURE_CLAIMANT,
  } as unknown as NeutralConformanceEvidence;
  return successResult(evidence, oraclePackets());
};

/** M5 — returns a live, unfrozen aggregate a consumer could edit after the fact. */
const mutantMutable: IntegrationFunction = () => {
  const evidence = clone(oracleAggregate()) as NeutralConformanceEvidence; // clone = unfrozen
  return successResult(evidence, oraclePackets());
};

/** M6 — nondeterministic: each call mints different receipt references. */
let mutantCallCounter = 0;
const mutantNondeterministic: IntegrationFunction = () => {
  mutantCallCounter += 1;
  const packets = OWNER_KEYS.map((ownerKey) => {
    const packet = oraclePacket(ownerKey);
    const results = packet.results.map((result, index) => ({
      ...clone(result),
      receipt_ref: `guild.receipt_ref.v1:jrn-a21x-oracle#${SUITE_IDS.indexOf(packet.stable_ids[index]) + 1}@${oracleCommitment(mutantCallCounter * 1000 + index)}`,
    }));
    return { ...clone(packet), results } as unknown as NeutralOwnerConformancePacket;
  });
  const assembled = assembleNeutralConformanceEvidence(oracleAssemblyText(packets));
  if (assembled.evidence === null) return refusalResult();
  return successResult(assembled.evidence, packets);
};

/** M7 — refuses everything (the vacuity probe: a battery it survives proves nothing). */
const mutantRefuseAll: IntegrationFunction = () => refusalResult();

const MUTANTS: ReadonlyArray<readonly [string, IntegrationFunction]> = [
  ["M1-fabricator", mutantFabricator],
  ["M2-caller-packet-passthrough", mutantPassthrough],
  ["M3-object-request-acceptor", mutantObjectAcceptor],
  ["M4-count-liar", mutantCountLiar],
  ["M5-mutable-output", mutantMutable],
  ["M6-nondeterministic", mutantNondeterministic],
  ["M7-refuse-all", mutantRefuseAll],
];

// ---------------------------------------------------------------------------
// Gate harness (in-memory git, same shape as the promotion suite's)
// ---------------------------------------------------------------------------

let CONFORMANCE_BYTES: Buffer;
let PROMOTION_BYTES: Buffer;

beforeAll(() => {
  const dir = tmpDir();
  const result = emitReleaseConformance({
    suitePath: SUITE_PATH,
    packagePath: PACKAGE_PATH,
    sourceCommit: SOURCE_COMMIT,
    outPath: path.join(dir, "conformance.json"),
    promotionOut: path.join(dir, "promotion.json"),
    version: VERSION,
    generatedAt: GENERATED_AT,
  });
  // If A21-X GREEN has landed and the 5/31 package no longer emits, the gate
  // fixtures cannot be produced this way any more — the RED emitter obligation
  // below documents exactly that flip. Guard so the CONTROLS stay meaningful.
  if (result.ok) {
    CONFORMANCE_BYTES = fs.readFileSync(path.join(dir, "conformance.json"));
    PROMOTION_BYTES = fs.readFileSync(path.join(dir, "promotion.json"));
  } else {
    CONFORMANCE_BYTES = Buffer.alloc(0);
    PROMOTION_BYTES = Buffer.alloc(0);
  }
});

function fixtureRecordsAvailable(): boolean {
  return CONFORMANCE_BYTES.length > 0;
}

interface FakeRepo {
  refs: Record<string, string>;
  files: Map<string, Buffer>;
  ancestries: Set<string>;
  diffs: Map<string, string[]>;
}

function fakeGit(repo: FakeRepo): PromotionGitOps {
  return {
    resolveCommit: (ref) => repo.refs[ref] ?? null,
    showBytes: (ref, filePath) => repo.files.get(`${ref}:${filePath}`) ?? null,
    isAncestor: (ancestor, descendant) => repo.ancestries.has(`${ancestor}..${descendant}`),
    changedPaths: (from, to) => repo.diffs.get(`${from}..${to}`) ?? [],
  };
}

function standardRepo(overrides: { conformance?: Buffer; promotion?: Buffer } = {}): FakeRepo {
  const stableSha = "abcdef1234567890abcdef1234567890abcdef12";
  const conformance = overrides.conformance ?? CONFORMANCE_BYTES;
  const promotion = overrides.promotion ?? PROMOTION_BYTES;
  const dir = `.guild/artifacts/release/v${VERSION}`;
  const files = new Map<string, Buffer>();
  const put = (p: string, bytes: Buffer | string) =>
    files.set(`${HEAD_SHA}:${p}`, Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes));
  put(MANIFEST_PATH, JSON.stringify({ name: "guild", version: BETA_VERSION }));
  put(
    MARKETPLACE_PATH,
    JSON.stringify({ name: "guild", plugins: [{ name: "guild", source: "./", version: BETA_VERSION }] })
  );
  put(`${dir}/promotion.json`, promotion);
  put(`${dir}/conformance.json`, conformance);
  files.set(
    `${SOURCE_COMMIT}:${MANIFEST_PATH}`,
    Buffer.from(JSON.stringify({ name: "guild", version: VERSION }))
  );
  files.set(
    `${stableSha}:${MANIFEST_PATH}`,
    Buffer.from(JSON.stringify({ name: "guild", version: "2.1.0" }))
  );
  return {
    refs: {
      HEAD: HEAD_SHA,
      [HEAD_SHA]: HEAD_SHA,
      [SOURCE_COMMIT]: SOURCE_COMMIT,
      "origin/main": stableSha,
      [stableSha]: stableSha,
    },
    files,
    ancestries: new Set([`${SOURCE_COMMIT}..${HEAD_SHA}`]),
    diffs: new Map([[`${SOURCE_COMMIT}..${HEAD_SHA}`, promotionAllowedPaths(VERSION)]]),
  };
}

function check(repo: FakeRepo) {
  return checkStablePromotion(
    { sourceBranch: "next", headRef: "HEAD", stableRef: "origin/main" },
    fakeGit(repo)
  );
}

/** Mutate the conformance record and re-bind the promotion hash to the result. */
function tamperedPair(mutate: (record: Record<string, unknown>) => void): {
  conformance: Buffer;
  promotion: Buffer;
} {
  const record = JSON.parse(CONFORMANCE_BYTES.toString("utf8"));
  mutate(record);
  const conformance = Buffer.from(JSON.stringify(record, null, 2) + "\n");
  const promotion = JSON.parse(PROMOTION_BYTES.toString("utf8"));
  promotion.evidence_sha256 = sha256(conformance);
  return { conformance, promotion: Buffer.from(JSON.stringify(promotion, null, 2) + "\n") };
}

// ---------------------------------------------------------------------------
// Refusal-shape helpers for the (future) integration function
// ---------------------------------------------------------------------------

function expectTypedRefusal(result: IntegrationResult, control: string): void {
  expect(result.evidence).toBeNull();
  expect(result.packets).toBeNull();
  expect(result.outcome.disposition).toBe("refused");
  expect(result.outcome.facts?.refusal_control).toBe(control);
}

function trapCountingProxy(): { proxy: unknown; hits: () => number } {
  let count = 0;
  const bump = <T>(value: T): T => {
    count += 1;
    return value;
  };
  const proxy = new Proxy(
    {},
    {
      get: () => bump(undefined),
      set: () => bump(true),
      has: () => bump(false),
      ownKeys: () => bump([]),
      getOwnPropertyDescriptor: () => bump(undefined),
      getPrototypeOf: () => bump(null),
      defineProperty: () => bump(true),
      deleteProperty: () => bump(true),
    }
  );
  return { proxy, hits: () => count };
}

function canonicalRequest(claim: unknown, ownerInputs: unknown): string {
  return neutralCanonicalJson({ claim, owner_inputs: ownerInputs });
}

const MINIMAL_OWNER_INPUTS = { run_id: "run-a21x-red" };

// ═══════════════════════════════════════════════════════════════════════════
// §1  A21-X production obligations — RED until the integration lands
// ═══════════════════════════════════════════════════════════════════════════

describe("A21-X production obligations (RED until the integration module lands)", () => {
  it("[RED] the integration module exists at the pinned distribution path", () => {
    expect(fs.existsSync(INTEGRATION_SOURCE_PATH)).toBe(true);
  });

  it("[RED] the distribution index exports the integration workflow", () => {
    const indexSource = fs.existsSync(DISTRIBUTION_INDEX_PATH)
      ? fs.readFileSync(DISTRIBUTION_INDEX_PATH, "utf8")
      : "";
    expect(indexSource).toContain("release-conformance-integration");
  });

  it("[RED] the module exports the pinned integration surface", () => {
    expect(typeof Integration.exported("runNeutralConformanceReleaseIntegration")).toBe("function");
    expect(typeof Integration.exported("runNeutralReleaseIntegrationControls")).toBe("function");
    const members = Integration.exported<readonly string[]>("RELEASE_INTEGRATION_REQUEST_MEMBERS");
    expect([...members]).toEqual([...REQUEST_MEMBERS]);
  });

  it("[RED] the owner tuple is the assembly spine's, not a fork of it", () => {
    const ownerKeys = Integration.exported<readonly string[]>("RELEASE_INTEGRATION_OWNER_KEYS");
    expect([...ownerKeys]).toEqual([...NEUTRAL_CONFORMANCE_OWNER_KEYS]);
  });

  it("[RED] every pinned refusal control is declared", () => {
    const controls = Integration.exported<readonly string[]>("RELEASE_INTEGRATION_REFUSAL_CONTROLS");
    for (const control of REQUIRED_REFUSAL_CONTROLS) {
      expect(controls).toContain(control);
    }
  });

  it("[RED] every pinned battery control id is declared", () => {
    const declared = Integration.exported<ReadonlyArray<{ id: string }>>(
      "RELEASE_INTEGRATION_CONTROLS"
    ).map((control) => control.id);
    for (const id of REQUIRED_BATTERY_CONTROL_IDS) {
      expect(declared).toContain(id);
    }
  });

  it("[RED] a non-string request is refused untouched — no proxy trap ever fires", () => {
    const integration = realIntegration();
    const trap = trapCountingProxy();
    expectTypedRefusal(integration(trap.proxy), "integration_request_not_canonical_text");
    expect(trap.hits()).toBe(0);
    for (const nonText of [
      { claim: ORACLE_CLAIM, owner_inputs: MINIMAL_OWNER_INPUTS },
      [oraclePacket(OWNER_MH02)],
      null,
      undefined,
      42,
      true,
    ]) {
      expectTypedRefusal(integration(nonText), "integration_request_not_canonical_text");
    }
  });

  it("[RED] malformed or non-canonical text is refused at the text boundary", () => {
    const integration = realIntegration();
    const canonical = canonicalRequest(ORACLE_CLAIM, MINIMAL_OWNER_INPUTS);
    for (const bad of [
      "",
      "{",
      "not json",
      "[]",
      '"a JSON string is not a request"',
      ` ${canonical}`, // same decode, different bytes — not the canonical form
      neutralCanonicalJson({ claim: ORACLE_CLAIM, owner_inputs: MINIMAL_OWNER_INPUTS, mode: "lenient" }),
      neutralCanonicalJson({ claim: ORACLE_CLAIM }), // missing declared member
    ]) {
      expectTypedRefusal(integration(bad), "integration_request_not_canonical_text");
    }
  });

  it("[RED] a caller-supplied packet set is refused, even a plausible one", () => {
    const integration = realIntegration();
    const smuggled = neutralCanonicalJson({
      claim: ORACLE_CLAIM,
      owner_inputs: MINIMAL_OWNER_INPUTS,
      packets: oraclePackets(),
    });
    expectTypedRefusal(integration(smuggled), "caller_supplied_packets");
  });

  it("[RED] a claim carrying its own required scenario set is refused", () => {
    const integration = realIntegration();
    const request = canonicalRequest(
      { ...ORACLE_CLAIM, required_scenario_ids: [...SUITE_IDS] },
      MINIMAL_OWNER_INPUTS
    );
    expectTypedRefusal(integration(request), "caller_supplied_required_set");
  });

  it("[RED] owner inputs carrying scenario ids or outcomes are refused", () => {
    const integration = realIntegration();
    const rows: unknown[] = [
      { ...MINIMAL_OWNER_INPUTS, results: [oracleResult("MHRC-RCT-001")] },
      { ...MINIMAL_OWNER_INPUTS, stable_ids: [...SUITE_IDS] },
      { ...MINIMAL_OWNER_INPUTS, outcomes: { "MHRC-STR-001": "succeeded" } },
      { ...MINIMAL_OWNER_INPUTS, mh06: { journal_root: "/tmp/x", results: [] } },
    ];
    for (const ownerInputs of rows) {
      expectTypedRefusal(
        integration(canonicalRequest(ORACLE_CLAIM, ownerInputs)),
        "caller_supplied_outcomes"
      );
    }
  });

  it("[RED] refusals are deterministic: identical text, byte-identical outcome", () => {
    const integration = realIntegration();
    const request = canonicalRequest(
      { ...ORACLE_CLAIM, required_scenario_ids: [...SUITE_IDS] },
      MINIMAL_OWNER_INPUTS
    );
    const first = integration(request);
    const second = integration(request);
    expect(neutralCanonicalJson(first.outcome)).toBe(neutralCanonicalJson(second.outcome));
  });

  it("[RED] the integration source binds the six real owner boundaries and the assembler", () => {
    const source = fs.existsSync(INTEGRATION_SOURCE_PATH)
      ? fs.readFileSync(INTEGRATION_SOURCE_PATH, "utf8")
      : "";
    expect(source.length).toBeGreaterThan(0);
    for (const specifier of REQUIRED_INTEGRATION_IMPORTS) {
      expect(source).toContain(specifier);
    }
    // The required set is DERIVED from the assembly constants, never re-typed:
    // a second in-module transcription of the 31 ids would be a forkable copy.
    expect(source).not.toContain('"MHRC-');
    expect(source).not.toContain("'MHRC-");
    // No live-object traversal machinery at the public request boundary.
    expect(source).not.toContain("new Proxy");
  });

  it("[RED] the production control battery passes against the real integration", () => {
    const report = runBattery(realIntegration());
    expect(report.failed_ids).toEqual([]);
    expect(report.passed).toBe(true);
    expect(report.control_count).toBeGreaterThanOrEqual(REQUIRED_BATTERY_CONTROL_IDS.length);
  });

  for (const [name, mutant] of MUTANTS) {
    it(`[RED] the production control battery fails planted mutant ${name}`, () => {
      const report = runBattery(mutant);
      expect(report.passed).toBe(false);
      expect(report.failed_ids.length).toBeGreaterThan(0);
    });
  }
});

describe("A21-X release emitter obligations (RED until the emitter consumes assembly)", () => {
  it("[RED] the five-scenario evaluator package alone no longer emits a release record", () => {
    // Today this emits the honest 5/31 record (`ok: true`). A21-X replaces that
    // emission with full six-owner assembly, so the incomplete package must
    // REFUSE — an honest 5/31 stops being an emittable release claim once the
    // production evaluator owns all 31 scenarios.
    const dir = tmpDir();
    const result = emitReleaseConformance({
      suitePath: SUITE_PATH,
      packagePath: PACKAGE_PATH,
      sourceCommit: SOURCE_COMMIT,
      outPath: path.join(dir, "conformance.json"),
      generatedAt: GENERATED_AT,
    });
    expect(result.ok).toBe(false);
    expect(fs.existsSync(path.join(dir, "conformance.json"))).toBe(false);
  });

  it("[RED] the emitter source consumes the integration seam, not a hard-coded coverage table", () => {
    const source = fs.readFileSync(EMITTER_SOURCE_PATH, "utf8");
    expect(source).toContain("release-conformance-integration");
  });
});

describe("A21-X promotion gate obligations (RED until the gate re-runs full assembly)", () => {
  it("[RED] the honest five-of-31 record no longer promotes", () => {
    // Today the gate REQUIRES the 5/31 coverage shape and this exact in-memory
    // release checkout promotes. After A21-X the gate is red unless 31/31 plus
    // production authority/signature checks hold, so this same record refuses.
    if (!fixtureRecordsAvailable()) {
      // The emitter already refuses the 5/31 package (its own RED satisfied) —
      // there is no 5/31 record left to promote, which is this obligation met.
      expect(fixtureRecordsAvailable()).toBe(false);
      return;
    }
    const result = check(standardRepo());
    expect(result.ok).toBe(false);
  });

  it("[RED] a claimed 31/31 record is refused on re-run substance, not accepted on its count", () => {
    if (!fixtureRecordsAvailable()) {
      expect(fixtureRecordsAvailable()).toBe(false);
      return;
    }
    // A record whose coverage block CLAIMS all 31 executed, transporting a
    // fabricated 31-result evidence over the signed 5-entry authority. Today
    // the gate refuses it for having the wrong COUNT SHAPE
    // (`scenario_coverage_dishonest`, because only 5/31 is recognized). After
    // A21-X, 31/31 is the honest shape — so the refusal must come from
    // RE-RUNNING the production decision over the transported inputs, which no
    // fabricated bundle can survive.
    const tampered = tamperedPair((record) => {
      record.scenario_coverage = {
        evaluator: "claimed full-suite integration",
        evaluated_scenario_ids: [...SUITE_IDS],
        evaluated_scenario_count: 31,
        unevaluated_scenario_count: 0,
        statement: "All 31 scenarios executed.",
      };
      record.evidence = fabricated31Evidence();
    });
    const result = check(standardRepo(tampered));
    expect(result.ok).toBe(false);
    expect(result.code).toBe("conformance_decision_not_promotable");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// §2  Conforming oracle — GREEN controls proving this suite can feed the seam
// ═══════════════════════════════════════════════════════════════════════════

describe("conforming oracle (control — green from the first run)", () => {
  it("[CONTROL] the independent 31-id/owner transcription matches the assembly spine", () => {
    expect(SUITE_IDS).toHaveLength(NEUTRAL_REQUIRED_SUITE_SCENARIO_COUNT);
    expect([...NEUTRAL_REQUIRED_SUITE_SCENARIO_IDS]).toEqual(SUITE_IDS);
    expect([...NEUTRAL_CONFORMANCE_OWNER_KEYS]).toEqual(OWNER_KEYS);
    for (const ownerKey of OWNER_KEYS) {
      expect(NEUTRAL_CONFORMANCE_OWNER_SCENARIO_COUNTS[ownerKey]).toBe(EXPECTED_OWNER_COUNTS[ownerKey]);
      expect([...NEUTRAL_OWNER_SCENARIO_IDS[ownerKey]]).toEqual(
        SUITE_OWNERSHIP.filter(([, owner]) => owner === ownerKey).map(([stableId]) => stableId)
      );
    }
    // And both agree with the frozen contract tuple the gate pins.
    expect([...FROZEN_SCENARIO_CONTRACT_IDS]).toEqual(SUITE_IDS);
  });

  it("[CONTROL] the oracle's six owner packets assemble through the REAL assembler", () => {
    const assembled = assembleNeutralConformanceEvidence(oracleAssemblyText(oraclePackets()));
    expect(assembled.outcome.disposition).toBe("succeeded");
    expect(assembled.evidence).not.toBeNull();
    const evidence = assembled.evidence as NeutralConformanceEvidence;
    expect(evidence.results.map((result) => result.stable_id)).toEqual(SUITE_IDS);
    expect([...evidence.required_scenario_ids]).toEqual(SUITE_IDS);
    expect(Object.isFrozen(evidence)).toBe(true);
    expect(Object.isFrozen(evidence.results)).toBe(true);
    // One shared identity across the aggregate.
    for (const field of NEUTRAL_EVIDENCE_IDENTITY_FIELDS) {
      expect((evidence.activated_runtime as unknown as Record<string, unknown>)[field]).toEqual(
        (FIXTURE_IDENTITY as unknown as Record<string, unknown>)[field]
      );
    }
  });

  it("[CONTROL] oracle assembly is order-independent and deterministic", () => {
    const first = assembleNeutralConformanceEvidence(oracleAssemblyText(oraclePackets()));
    const rotated = oraclePackets();
    rotated.push(rotated.shift() as NeutralOwnerConformancePacket);
    const second = assembleNeutralConformanceEvidence(oracleAssemblyText(rotated));
    expect(first.evidence).not.toBeNull();
    expect(second.evidence).not.toBeNull();
    expect(neutralCanonicalJson(first.evidence)).toBe(neutralCanonicalJson(second.evidence));
  });

  it("[CONTROL] every oracle receipt reference is canonical and distinct", () => {
    const refs = SUITE_IDS.map((stableId) => oracleReceiptRef(stableId));
    expect(new Set(refs).size).toBe(31);
    for (const ref of refs) {
      expect(ref).toMatch(/^guild\.receipt_ref\.v1:[A-Za-z0-9][A-Za-z0-9._-]{2,}#[1-9][0-9]*@nec1:[0-9a-f]{16}$/);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// §3  Negative controls — fabrication cannot promote today, and must never
// ═══════════════════════════════════════════════════════════════════════════

describe("fabrication cannot reach a promotable decision (control)", () => {
  it("[CONTROL] the assembled 31-aggregate with invented receipts is NOT promotable", () => {
    // Today the MH-02 decision refuses the full-suite tuple outright; after
    // A21-X extends it, the invented receipt commitments still resolve to no
    // observed journal entry. Either way: never promotable by fabrication.
    const outcome = evaluateNeutralConformanceDecision(
      oracleAggregate() as never,
      FIXTURE_PACKAGE.authority as never
    );
    expect(promotable(outcome)).toBe(false);
  });

  it("[CONTROL] the fabricated 31-evidence over the signed 5-authority is NOT promotable", () => {
    const outcome = evaluateNeutralConformanceDecision(
      fabricated31Evidence() as never,
      FIXTURE_PACKAGE.authority as never
    );
    expect(promotable(outcome)).toBe(false);
  });

  it("[CONTROL] a claimant-authored authority is refused (claimant is an attestor)", () => {
    const evidence = clone(FIXTURE_PACKAGE.evidence) as unknown as Record<string, unknown>;
    evidence.claimant_id = FIXTURE_PACKAGE.authority.attestations[0].attestor_id;
    const outcome = evaluateNeutralConformanceDecision(
      evidence as never,
      FIXTURE_PACKAGE.authority as never
    );
    expect(promotable(outcome)).toBe(false);
    expect(outcome.reason_code).toBe("scenario_claimant_not_independent");
  });

  it("[CONTROL] a tampered attestation signature is refused", () => {
    const authority = clone(FIXTURE_PACKAGE.authority) as unknown as {
      attestations: Array<Record<string, unknown>>;
    };
    const signature = String(authority.attestations[0].attestation_signature ?? "");
    expect(signature.length).toBeGreaterThan(0);
    const flipped = (signature.slice(-1) === "0" ? "1" : "0") as string;
    authority.attestations[0].attestation_signature = signature.slice(0, -1) + flipped;
    const outcome = evaluateNeutralConformanceDecision(
      FIXTURE_PACKAGE.evidence as never,
      authority as never
    );
    expect(promotable(outcome)).toBe(false);
  });

  it("[CONTROL] the emitter refuses a fabricated 31/31 package and writes nothing", () => {
    const dir = tmpDir();
    const packagePath = path.join(dir, "package.json");
    fs.writeFileSync(
      packagePath,
      JSON.stringify({ evidence: fabricated31Evidence(), authority: FIXTURE_PACKAGE.authority })
    );
    const result = emitReleaseConformance({
      suitePath: SUITE_PATH,
      packagePath,
      sourceCommit: SOURCE_COMMIT,
      outPath: path.join(dir, "conformance.json"),
      generatedAt: GENERATED_AT,
    });
    expect(result.ok).toBe(false);
    expect(fs.existsSync(path.join(dir, "conformance.json"))).toBe(false);
  });
});

describe("the planted mutants are really broken (control — discrimination is earned)", () => {
  it("[CONTROL] M1 fabricates a success for garbage input", () => {
    const result = mutantFabricator("not even json");
    expect(result.outcome.disposition).toBe("succeeded");
    expect(result.evidence).not.toBeNull();
  });

  it("[CONTROL] M2 accepts caller-authored packets smuggled through the text", () => {
    const smuggled = neutralCanonicalJson({ packets: oraclePackets(), claim: ORACLE_CLAIM });
    const result = mutantPassthrough(smuggled);
    expect(result.outcome.disposition).toBe("succeeded");
    expect(result.evidence).not.toBeNull();
  });

  it("[CONTROL] M3 traverses and accepts a live object request", () => {
    const result = mutantObjectAcceptor({ claim: ORACLE_CLAIM, owner_inputs: MINIMAL_OWNER_INPUTS });
    expect(result.outcome.disposition).toBe("succeeded");
  });

  it("[CONTROL] M4 claims success over fewer than 31 scenarios", () => {
    const result = mutantCountLiar("anything");
    expect(result.outcome.disposition).toBe("succeeded");
    expect((result.evidence as NeutralConformanceEvidence).results.length).toBeLessThan(31);
  });

  it("[CONTROL] M5 returns a mutable aggregate", () => {
    const result = mutantMutable("anything");
    expect(Object.isFrozen(result.evidence)).toBe(false);
  });

  it("[CONTROL] M6 is nondeterministic across identical calls", () => {
    const first = mutantNondeterministic("anything");
    const second = mutantNondeterministic("anything");
    expect(neutralCanonicalJson(first.evidence)).not.toBe(neutralCanonicalJson(second.evidence));
  });

  it("[CONTROL] M7 refuses every request, including a well-formed one", () => {
    const result = mutantRefuseAll(canonicalRequest(ORACLE_CLAIM, MINIMAL_OWNER_INPUTS));
    expect(result.outcome.disposition).toBe("refused");
    expect(result.evidence).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// §4  Preservation — existing bindings stay load-bearing through A21-X
// ═══════════════════════════════════════════════════════════════════════════

describe("existing fail-closed bindings remain load-bearing (control)", () => {
  // Every row here exercises a refusal that runs BEFORE the coverage/decision
  // stage A21-X rewrites, so these must be green today AND after the GREEN lane.

  it("[CONTROL] the emitter still refuses a missing or malformed generation instant", () => {
    const dir = tmpDir();
    const base = {
      suitePath: SUITE_PATH,
      packagePath: PACKAGE_PATH,
      sourceCommit: SOURCE_COMMIT,
      outPath: path.join(dir, "conformance.json"),
    };
    expect(emitReleaseConformance({ ...base, generatedAt: "" }).code).toBe("generated_at_missing");
    expect(emitReleaseConformance({ ...base, generatedAt: "2026-02-30T00:00:00.000Z" }).code).toBe(
      "generated_at_malformed"
    );
  });

  it("[CONTROL] the emitter still refuses a malformed source commit before any write", () => {
    const dir = tmpDir();
    const result = emitReleaseConformance({
      suitePath: SUITE_PATH,
      packagePath: PACKAGE_PATH,
      sourceCommit: "not-a-sha",
      outPath: path.join(dir, "conformance.json"),
      generatedAt: GENERATED_AT,
    });
    expect(result.code).toBe("source_commit_malformed");
    expect(fs.existsSync(path.join(dir, "conformance.json"))).toBe(false);
  });

  it("[CONTROL] the emitter still refuses a source-commit binding the package does not carry", () => {
    const dir = tmpDir();
    const result = emitReleaseConformance({
      suitePath: SUITE_PATH,
      packagePath: PACKAGE_PATH,
      sourceCommit: "0000000000000000000000000000000000000000",
      outPath: path.join(dir, "conformance.json"),
      generatedAt: GENERATED_AT,
    });
    expect(result.ok).toBe(false);
    expect(fs.existsSync(path.join(dir, "conformance.json"))).toBe(false);
  });

  it("[CONTROL] the emitter append-only pre-flight still refuses an existing output", () => {
    const dir = tmpDir();
    const outPath = path.join(dir, "conformance.json");
    fs.writeFileSync(outPath, "occupied");
    const result = emitReleaseConformance({
      suitePath: SUITE_PATH,
      packagePath: PACKAGE_PATH,
      sourceCommit: SOURCE_COMMIT,
      outPath,
      generatedAt: GENERATED_AT,
    });
    expect(result.ok).toBe(false);
    expect(fs.readFileSync(outPath, "utf8")).toBe("occupied");
  });

  it("[CONTROL] the gate still hash-binds the conformance bytes to the promotion record", () => {
    if (!fixtureRecordsAvailable()) return;
    const record = JSON.parse(CONFORMANCE_BYTES.toString("utf8"));
    record.generated_at = "2026-08-18T06:30:00.001Z"; // one flipped millisecond
    const conformance = Buffer.from(JSON.stringify(record, null, 2) + "\n");
    const result = check(standardRepo({ conformance })); // promotion hash NOT re-bound
    expect(result.ok).toBe(false);
    expect(result.code).toBe("evidence_hash_mismatch");
  });

  it("[CONTROL] the gate still refuses a record naming a non-frozen scenario contract", () => {
    if (!fixtureRecordsAvailable()) return;
    const tampered = tamperedPair((record) => {
      record.scenario_contract_sha256 = sha256("not the frozen contract");
      (record.scenario_contract as Record<string, unknown>).sha256 = record.scenario_contract_sha256;
    });
    const result = check(standardRepo(tampered));
    expect(result.ok).toBe(false);
    expect(result.code).toBe("scenario_contract_hash_mismatch");
  });

  it("[CONTROL] the gate still requires the complete canonical 31-id tuple by name", () => {
    if (!fixtureRecordsAvailable()) return;
    const tampered = tamperedPair((record) => {
      const contract = record.scenario_contract as Record<string, unknown>;
      contract.scenario_ids = (contract.scenario_ids as string[]).slice(0, 30);
    });
    const result = check(standardRepo(tampered));
    expect(result.ok).toBe(false);
    expect(result.code).toBe("scenario_contract_ids_mismatch");
  });

  it("[CONTROL] the frozen contract fixture still hashes to the pinned bytes", () => {
    expect(sha256(fs.readFileSync(SUITE_PATH))).toBe(FROZEN_SCENARIO_CONTRACT_SHA256);
    expect(NEUTRAL_REQUIRED_CORE_SCENARIO_IDS).toHaveLength(5);
  });
});
