/**
 * __tests__/neutral-conformance-assembly.test.ts
 *
 * A21-S SPINE (RED-FIRST) — the executable contract for the not-yet-written pure
 * production module
 * `src/modules/lifecycle/workflows/neutral-conformance-assembly.ts`.
 *
 * WHAT THIS BINDS
 *   `guild.conformance_scenarios.v1` freezes 31 scenarios across six owners.
 *   Production today declares only the five W1/MH-02 ones. The spine module is
 *   the place the OTHER five owners' evidence packets are joined into one
 *   ordered 31-scenario aggregate — and the only way that aggregate can be
 *   honest is if the required set, its ORDER, and the owner/count map are
 *   SOURCE-OWNED constants that no caller can supply, shrink, reorder, or
 *   mutate, and if a packet that lies about its owner, its ids, its suite, or
 *   its identity is REFUSED rather than concatenated.
 *
 * WHAT IT DELIBERATELY DOES NOT BIND
 *   No promotion decision and no signature/attestation verification live in this
 *   module. `evaluateNeutralConformanceDecision` (MH-02) still owns promotion and
 *   the attestor trust root; A21-X owns wiring the two together. This module only
 *   ASSEMBLES, and §"module stays inside its boundary" proves it by scanning the
 *   real source for those edges.
 *
 * PROVENANCE OF THE 31 IDS
 *   The canonical order and the owner/count map below are transcribed from the
 *   frozen contract as TEST-owned literals. Production must DERIVE the same
 *   values from its own closed registries; §"the frozen fixture never reaches
 *   production" proves it does not read the fixture to do so. Two independent
 *   statements of the same tuple is the point — a drift between them is a
 *   finding, not a maintenance chore.
 *
 * ANTI-VACUITY
 *   §"the control battery distinguishes good from bad" runs the module's own
 *   control battery against a planted naive-concatenation mutant. A battery the
 *   mutant survives is a battery that proves nothing, so the mutant is required
 *   to fail a NAMED list of controls.
 *
 * RED EXPECTATION AT AUTHORING TIME: every test here fails with
 * "A21-S RED: production module not implemented yet", because the module does
 * not exist. It must fail for that reason and no other.
 */

import * as fs from "fs";
import * as path from "path";

import {
  NEUTRAL_REASON_CODES,
  neutralCanonicalJson,
  neutralOutcome,
} from "../../src/modules/lifecycle/workflows/neutral-runtime-contracts";
import type { NeutralOutcome } from "../../src/modules/lifecycle/workflows/neutral-runtime-contracts";
import {
  NEUTRAL_EVIDENCE_FRESHNESS_VERDICTS,
  NEUTRAL_EVIDENCE_IDENTITY_FIELDS,
  NEUTRAL_SCENARIO_SUITE_ID,
  NEUTRAL_SCENARIO_SUITE_VERSION,
} from "../../src/modules/lifecycle/workflows/neutral-conformance-core";
import type {
  NeutralConformanceEvidence,
  NeutralEvidenceIdentity,
  NeutralScenarioResult,
} from "../../src/modules/lifecycle/workflows/neutral-conformance-core";

// ---------------------------------------------------------------------------
// The module under contract
// ---------------------------------------------------------------------------

const ASSEMBLY_REQUEST = "../../src/modules/lifecycle/workflows/neutral-conformance-assembly";
const ASSEMBLY_SOURCE_PATH = path.resolve(
  __dirname,
  "../../src/modules/lifecycle/workflows/neutral-conformance-assembly.ts"
);

let assemblyModuleCache: Record<string, unknown> | undefined;

/**
 * Load the module under contract, or fail with the one diagnostic this suite is
 * allowed to fail with while it is RED.
 *
 * Loading lazily rather than at import time is deliberate: a top-level import of
 * a missing module collapses the whole suite into one resolution error, which
 * says nothing about WHICH obligations are unmet. Every `it` below fails
 * independently and names its own obligation.
 */
function assemblyModule(): Record<string, unknown> {
  if (assemblyModuleCache === undefined) {
    if (!fs.existsSync(ASSEMBLY_SOURCE_PATH)) {
      throw new Error(
        `A21-S RED: production module not implemented yet — expected ${ASSEMBLY_SOURCE_PATH}`
      );
    }
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    assemblyModuleCache = require(ASSEMBLY_REQUEST) as Record<string, unknown>;
  }
  return assemblyModuleCache;
}

/** Read one required export, or fail naming the export rather than the module. */
function exported<T>(name: string): T {
  const value = assemblyModule()[name];
  if (value === undefined) {
    throw new Error(
      `A21-S RED: production module does not implement the contract — missing export ${name}`
    );
  }
  return value as T;
}

function assemblySource(): string {
  if (!fs.existsSync(ASSEMBLY_SOURCE_PATH)) {
    throw new Error(
      `A21-S RED: production module not implemented yet — expected ${ASSEMBLY_SOURCE_PATH}`
    );
  }
  return fs.readFileSync(ASSEMBLY_SOURCE_PATH, "utf8");
}

/** Strip block and line comments so a source scan cannot be tripped by prose. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
}

// ---------------------------------------------------------------------------
// The frozen tuple, transcribed independently of production
// ---------------------------------------------------------------------------

/** The 31 stable ids of `guild.conformance_scenarios.v1`, in contract order. */
const CANONICAL_SCENARIO_IDS: readonly string[] = [
  "MHRC-LIF-001",
  "MHRC-LIF-002",
  "MHRC-LIF-003",
  "MHRC-LIF-004",
  "MHRC-EVT-001",
  "MHRC-EVT-002",
  "MHRC-SUP-001",
  "MHRC-SUP-002",
  "MHRC-SUP-003",
  "MHRC-SUP-004",
  "MHRC-SUP-005",
  "MHRC-SUP-006",
  "MHRC-UNS-001",
  "MHRC-UNS-002",
  "MHRC-UNS-003",
  "MHRC-RCT-001",
  "MHRC-RCT-002",
  "MHRC-RCT-003",
  "MHRC-RCT-004",
  "MHRC-RCT-005",
  "MHRC-MOD-001",
  "MHRC-MOD-002",
  "MHRC-MOD-003",
  "MHRC-MOD-004",
  "MHRC-STR-001",
  "MHRC-STR-002",
  "MHRC-STR-003",
  "MHRC-STR-004",
  "MHRC-VER-001",
  "MHRC-VER-002",
  "MHRC-VER-003",
];

/** Owner keys in work-item order, as the A21 design's owner/count map states them. */
const CANONICAL_OWNER_KEYS: readonly string[] = [
  "W1/MH-02",
  "W2/MH-03",
  "W1/MH-06",
  "W4/MH-07",
  "W4/MH-08",
  "W5/MH-09",
];

const CANONICAL_OWNER_COUNTS: Readonly<Record<string, number>> = {
  "W1/MH-02": 5,
  "W2/MH-03": 4,
  "W1/MH-06": 5,
  "W4/MH-07": 4,
  "W4/MH-08": 4,
  "W5/MH-09": 9,
};

/** Which owner each stable id belongs to — the join the assembler must enforce. */
const CANONICAL_OWNER_OF: Readonly<Record<string, string>> = {
  "MHRC-LIF-001": "W1/MH-02",
  "MHRC-LIF-002": "W1/MH-02",
  "MHRC-LIF-003": "W1/MH-02",
  "MHRC-LIF-004": "W1/MH-02",
  "MHRC-UNS-002": "W1/MH-02",
  "MHRC-EVT-001": "W2/MH-03",
  "MHRC-EVT-002": "W2/MH-03",
  "MHRC-UNS-001": "W2/MH-03",
  "MHRC-UNS-003": "W2/MH-03",
  "MHRC-RCT-001": "W1/MH-06",
  "MHRC-RCT-002": "W1/MH-06",
  "MHRC-RCT-003": "W1/MH-06",
  "MHRC-RCT-004": "W1/MH-06",
  "MHRC-RCT-005": "W1/MH-06",
  "MHRC-MOD-001": "W4/MH-07",
  "MHRC-MOD-002": "W4/MH-07",
  "MHRC-MOD-003": "W4/MH-07",
  "MHRC-MOD-004": "W4/MH-07",
  "MHRC-STR-001": "W4/MH-08",
  "MHRC-STR-002": "W4/MH-08",
  "MHRC-STR-003": "W4/MH-08",
  "MHRC-STR-004": "W4/MH-08",
  "MHRC-SUP-001": "W5/MH-09",
  "MHRC-SUP-002": "W5/MH-09",
  "MHRC-SUP-003": "W5/MH-09",
  "MHRC-SUP-004": "W5/MH-09",
  "MHRC-SUP-005": "W5/MH-09",
  "MHRC-SUP-006": "W5/MH-09",
  "MHRC-VER-001": "W5/MH-09",
  "MHRC-VER-002": "W5/MH-09",
  "MHRC-VER-003": "W5/MH-09",
};

/** This owner's ids, in canonical (contract) order — never in owner-local order. */
function canonicalIdsFor(ownerKey: string): readonly string[] {
  return CANONICAL_SCENARIO_IDS.filter((id) => CANONICAL_OWNER_OF[id] === ownerKey);
}

const PACKET_SCHEMA = "guild.conformance_owner_packet.v1";

/** The refusal discriminators the assembler must place on `outcome.facts`. */
const REFUSAL_CONTROLS = {
  ownerMissing: "owner_packet_missing",
  ownerDuplicated: "owner_packet_duplicated",
  ownerCount: "owner_scenario_count_mismatch",
  idDuplicated: "stable_id_duplicated",
  idForeign: "stable_id_foreign",
  idOwnerMismatch: "stable_id_owner_mismatch",
  resultOrder: "result_order_mismatch",
  suiteDrift: "suite_identity_drift",
  identityMismatch: "evidence_identity_mismatch",
  callerRequiredSet: "caller_supplied_required_set",
  packetSchema: "packet_schema_unrecognized",
  identityIncomplete: "evidence_identity_incomplete",
} as const;

/** The control battery ids, in the order the module must declare them. */
const CONTROL_IDS: readonly string[] = [
  "A21S-C01-canonical-order",
  "A21S-C02-owner-packet-missing",
  "A21S-C03-owner-packet-duplicated",
  "A21S-C04-owner-scenario-count",
  "A21S-C05-stable-id-duplicated",
  "A21S-C06-stable-id-foreign",
  "A21S-C07-stable-id-owner-mismatch",
  "A21S-C08-result-order-mismatch",
  "A21S-C09-suite-identity-drift",
  "A21S-C10-evidence-identity-mismatch",
  "A21S-C11-caller-required-set",
  "A21S-C12-packet-input-order-independence",
  "A21S-C13-output-immutability",
  "A21S-C14-packet-schema-versioned",
  "A21S-C15-evidence-identity-complete",
];

/**
 * Controls a naive concatenation CANNOT satisfy, whatever fixtures the battery
 * chooses. Concatenation neither reorders to the canonical tuple, nor refuses a
 * malformed packet set, nor derives the required set from source. If a battery
 * lets this mutant through on any of these, the battery is the defect.
 */
const MUTANT_MUST_FAIL: readonly string[] = [
  "A21S-C01-canonical-order",
  "A21S-C02-owner-packet-missing",
  "A21S-C03-owner-packet-duplicated",
  "A21S-C04-owner-scenario-count",
  "A21S-C05-stable-id-duplicated",
  "A21S-C06-stable-id-foreign",
  "A21S-C07-stable-id-owner-mismatch",
  "A21S-C08-result-order-mismatch",
  "A21S-C11-caller-required-set",
  "A21S-C12-packet-input-order-independence",
  // The mutant decodes the canonical text and then trusts it, so it neither
  // refuses a non-string request nor refuses text that is not the canonical form
  // of what it decodes to.
  "A21S-C18-canonical-text-request",
];

// ---------------------------------------------------------------------------
// Test-owned fixtures
// ---------------------------------------------------------------------------

const IDENTITY: NeutralEvidenceIdentity = {
  source_commit: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678",
  package_hash: `sha256:${"9".repeat(64)}`,
  runtime_version: "guild-2.5.0",
  adapter_version: "guild.host_adapter.v1.0.0",
  host_id: "claude-code-cli",
  host_version: "2.5.0",
  platform: "darwin-arm64",
  contract_version: 1,
  scenario_suite_id: NEUTRAL_SCENARIO_SUITE_ID,
  scenario_suite_version: NEUTRAL_SCENARIO_SUITE_VERSION,
  release_id: "rel-2026-08-18-a21s",
};

/** A second, equally complete identity — used to prove cross-packet comparison. */
const OTHER_IDENTITY: NeutralEvidenceIdentity = {
  ...IDENTITY,
  source_commit: "0f1e2d3c4b5a69788796a5b4c3d2e1f001234567",
};

const CLAIMANT_ID = "guild.release-emitter";

interface AssemblyClaim {
  readonly claimant_id: string;
  readonly activated_runtime: NeutralEvidenceIdentity;
  readonly required_scenario_ids?: readonly string[];
}

const CLAIM: AssemblyClaim = { claimant_id: CLAIMANT_ID, activated_runtime: IDENTITY };

interface OwnerPacket {
  readonly schema_version: string;
  readonly suite_id: string;
  readonly suite_version: string;
  readonly owner_key: string;
  readonly evidence_identity: NeutralEvidenceIdentity;
  readonly stable_ids: readonly string[];
  readonly results: readonly NeutralScenarioResult[];
}

interface AssemblyResult {
  readonly outcome: NeutralOutcome;
  readonly evidence: NeutralConformanceEvidence | null;
}

/**
 * The production contract, as of FIC-131: ONE canonical JSON request TEXT.
 *
 * `unknown` rather than `string` is load-bearing here — this suite hands the
 * boundary objects, arrays, proxies, and accessor-bearing records on purpose, and
 * refusing them WITHOUT inspection is the property under test. A signature that
 * only admitted strings would make the adversarial half of this file unwritable.
 */
type AssemblyFn = (request: unknown) => AssemblyResult;

function resultFor(stableId: string, overrides: Record<string, unknown> = {}): NeutralScenarioResult {
  const sequence = CANONICAL_SCENARIO_IDS.indexOf(stableId) + 1;
  const commitment = `nec1:${sequence.toString(16).padStart(16, "0")}`;
  return {
    stable_id: stableId,
    outcome_type: "guild.lifecycle_outcome.v1",
    disposition: "succeeded",
    reason_code: null,
    receipt_ref: `guild.receipt_ref.v1:a21s-journal#${sequence}@${commitment}`,
    evidence_identity: IDENTITY,
    evidence_freshness: "fresh",
    ...overrides,
  } as NeutralScenarioResult;
}

function packetFor(ownerKey: string, overrides: Record<string, unknown> = {}): OwnerPacket {
  const ids = canonicalIdsFor(ownerKey);
  return {
    schema_version: PACKET_SCHEMA,
    suite_id: NEUTRAL_SCENARIO_SUITE_ID,
    suite_version: NEUTRAL_SCENARIO_SUITE_VERSION,
    owner_key: ownerKey,
    evidence_identity: IDENTITY,
    stable_ids: [...ids],
    results: ids.map((id) => resultFor(id)),
    ...overrides,
  } as OwnerPacket;
}

function allPackets(): OwnerPacket[] {
  return CANONICAL_OWNER_KEYS.map((key) => packetFor(key));
}

/** Replace one owner's packet, leaving the other five untouched. */
function packetsWith(ownerKey: string, replacement: OwnerPacket | null): OwnerPacket[] {
  const packets: OwnerPacket[] = [];
  for (const key of CANONICAL_OWNER_KEYS) {
    if (key !== ownerKey) {
      packets.push(packetFor(key));
      continue;
    }
    if (replacement !== null) packets.push(replacement);
  }
  return packets;
}

/**
 * Call the production boundary with EXACTLY what it is given — no encoding.
 *
 * Every adversarial probe in this file goes through here, and that is the whole
 * point: an object, a proxy, or an accessor-bearing record must be refused as a
 * RAW input, with zero executions. Serializing a probe in the harness would run
 * the very accessor whose non-execution is being asserted, so the harness never
 * touches an attacker shape (FIC-131).
 */
function assembleRaw(request: unknown): AssemblyResult {
  return exported<AssemblyFn>("assembleNeutralConformanceEvidence")(request);
}

/**
 * Encode HONEST, test-owned fixtures into the canonical request text and call
 * the boundary with it.
 *
 * The encoding is the CALLER's act over data this suite owns — the canonical
 * form is the core's own `neutralCanonicalJson`, transcribed nowhere — so it
 * exercises the same path a real owner-boundary caller takes.
 */
function assemble(packets: readonly OwnerPacket[], claim: AssemblyClaim = CLAIM): AssemblyResult {
  return assembleRaw(neutralCanonicalJson({ packets, claim }));
}

function expectRefusal(result: AssemblyResult, control: string): void {
  expect(result.evidence).toBeNull();
  expect(result.outcome.disposition).toBe("refused");
  expect(NEUTRAL_REASON_CODES.indexOf(result.outcome.reason_code as never)).toBeGreaterThanOrEqual(0);
  expect(result.outcome.facts.refusal_control).toBe(control);
}

function expectAccepted(result: AssemblyResult): NeutralConformanceEvidence {
  expect(result.outcome.disposition).toBe("succeeded");
  expect(result.outcome.reason_code).toBeNull();
  expect(result.evidence).not.toBeNull();
  return result.evidence as NeutralConformanceEvidence;
}

/** A value is immutable when a write attempt either throws or changes nothing. */
function expectImmutable(container: Record<string, unknown> | unknown[], key: string | number, value: unknown): void {
  const before = (container as Record<string | number, unknown>)[key];
  try {
    (container as Record<string | number, unknown>)[key] = value;
  } catch {
    // A throwing write is the strongest form of the same guarantee.
  }
  expect((container as Record<string | number, unknown>)[key]).toEqual(before);
}

// ---------------------------------------------------------------------------
// The planted mutant (anti-vacuity)
// ---------------------------------------------------------------------------

/**
 * The exact shortcut this whole module exists to make impossible: take whatever
 * packets arrive, splice their results together in ARRIVAL order, and call the
 * concatenation the required set. It validates nothing, so every honest control
 * must catch it. Any control it survives is a control that would also have let a
 * false 31/31 promotion through.
 */
const naiveConcatenationMutant: AssemblyFn = (request) => {
  // The mutant is an HONEST alternative implementation of the same boundary: it
  // decodes the canonical text exactly as production does, then skips every
  // validation. Making it fail on decoding instead would make it fail every
  // control for the wrong reason, and the battery's discrimination would prove
  // nothing about the join.
  const decoded = JSON.parse(request as string) as { packets: OwnerPacket[]; claim: AssemblyClaim };
  const packets = decoded.packets;
  const claim = decoded.claim;
  const results: NeutralScenarioResult[] = [];
  for (const packet of packets) for (const result of packet.results) results.push(result);
  return {
    outcome: neutralOutcome({
      type: "guild.boundary_outcome.v1",
      disposition: "succeeded",
      assertions: ["concatenated whatever arrived"],
      facts: { packet_count: packets.length, result_count: results.length },
    }),
    evidence: {
      suite_id: NEUTRAL_SCENARIO_SUITE_ID,
      suite_version: NEUTRAL_SCENARIO_SUITE_VERSION,
      required_scenario_ids: results.map((result) => result.stable_id),
      activated_runtime: claim.activated_runtime,
      results,
      claimant_id: claim.claimant_id,
    },
  };
};

// ---------------------------------------------------------------------------

describe("neutral conformance assembly — A21-S spine", () => {
  describe("the required tuple is source-owned", () => {
    it("declares all 31 stable ids in exact contract order", () => {
      const required = exported<readonly string[]>("NEUTRAL_REQUIRED_SUITE_SCENARIO_IDS");
      expect(required.length).toBe(31);
      expect([...required]).toEqual([...CANONICAL_SCENARIO_IDS]);
    });

    it("declares the six owners and their exact scenario counts", () => {
      const ownerKeys = exported<readonly string[]>("NEUTRAL_CONFORMANCE_OWNER_KEYS");
      const counts = exported<Record<string, number>>("NEUTRAL_CONFORMANCE_OWNER_SCENARIO_COUNTS");
      expect([...ownerKeys]).toEqual([...CANONICAL_OWNER_KEYS]);
      expect({ ...counts }).toEqual({ ...CANONICAL_OWNER_COUNTS });
      // The counts must sum to the tuple, or one of the two is wrong.
      const total = CANONICAL_OWNER_KEYS.reduce((sum, key) => sum + counts[key], 0);
      expect(total).toBe(31);
    });

    it("maps each owner to its ids in canonical order, partitioning the tuple", () => {
      const byOwner = exported<Record<string, readonly string[]>>("NEUTRAL_OWNER_SCENARIO_IDS");
      const seen: string[] = [];
      for (const key of CANONICAL_OWNER_KEYS) {
        expect([...byOwner[key]]).toEqual([...canonicalIdsFor(key)]);
        seen.push(...byOwner[key]);
      }
      expect(seen.slice().sort()).toEqual([...CANONICAL_SCENARIO_IDS].sort());
      expect(Object.keys(byOwner).slice().sort()).toEqual([...CANONICAL_OWNER_KEYS].sort());
    });

    it("is immutable — a caller cannot shrink, extend, or reorder it", () => {
      const required = exported<readonly string[]>("NEUTRAL_REQUIRED_SUITE_SCENARIO_IDS");
      const counts = exported<Record<string, number>>("NEUTRAL_CONFORMANCE_OWNER_SCENARIO_COUNTS");
      expect(Object.isFrozen(required)).toBe(true);
      expect(Object.isFrozen(counts)).toBe(true);
      expectImmutable(required as unknown as unknown[], 0, "MHRC-FORGED-001");
      expectImmutable(counts, "W5/MH-09", 1);
      try {
        (required as unknown as string[]).push("MHRC-FORGED-002");
      } catch {
        // Frozen arrays throw on push in strict mode; either way length holds.
      }
      expect(required.length).toBe(31);
    });
  });

  describe("owner packets are schema-versioned and immutable", () => {
    it("pins the packet schema version", () => {
      expect(exported<string>("NEUTRAL_ASSEMBLY_PACKET_SCHEMA")).toBe(PACKET_SCHEMA);
    });

    it("refuses a packet that does not declare the pinned packet schema", () => {
      const drifted = packetFor("W1/MH-06", { schema_version: "guild.conformance_owner_packet.v2" });
      expectRefusal(assemble(packetsWith("W1/MH-06", drifted)), REFUSAL_CONTROLS.packetSchema);
    });

    it("does not mutate the caller's packets, and does not alias them into the output", () => {
      const packets = allPackets();
      const before = JSON.stringify(packets);
      const evidence = expectAccepted(assemble(packets));
      expect(JSON.stringify(packets)).toBe(before);

      // Mutating the caller's array after the fact must not reach the aggregate.
      (packets as unknown as OwnerPacket[]).length = 0;
      expect(evidence.results.length).toBe(31);
    });

    it("returns a deeply frozen aggregate", () => {
      const evidence = expectAccepted(assemble(allPackets()));
      expect(Object.isFrozen(evidence)).toBe(true);
      expect(Object.isFrozen(evidence.results)).toBe(true);
      expect(Object.isFrozen(evidence.required_scenario_ids)).toBe(true);
      expect(Object.isFrozen(evidence.results[0])).toBe(true);
      expect(Object.isFrozen(evidence.results[0].evidence_identity)).toBe(true);
      expectImmutable(evidence as unknown as Record<string, unknown>, "claimant_id", "someone-else");
      expectImmutable(evidence.results as unknown as unknown[], 0, resultFor("MHRC-VER-003"));
    });
  });

  describe("aggregate assembly", () => {
    it("emits the 31 results in canonical order from six valid packets", () => {
      const evidence = expectAccepted(assemble(allPackets()));
      expect(evidence.results.map((result) => result.stable_id)).toEqual([...CANONICAL_SCENARIO_IDS]);
      expect([...evidence.required_scenario_ids]).toEqual([...CANONICAL_SCENARIO_IDS]);
    });

    it("is independent of packet input order", () => {
      const canonicalOrder = expectAccepted(assemble(allPackets()));
      const reversed = expectAccepted(assemble(allPackets().reverse()));
      const rotated = (() => {
        const packets = allPackets();
        packets.push(packets.shift() as OwnerPacket);
        return expectAccepted(assemble(packets));
      })();
      expect(JSON.stringify(reversed)).toBe(JSON.stringify(canonicalOrder));
      expect(JSON.stringify(rotated)).toBe(JSON.stringify(canonicalOrder));
    });

    it("produces a NeutralConformanceEvidence-compatible shape and nothing more", () => {
      const evidence = expectAccepted(assemble(allPackets()));
      expect(Object.keys(evidence).slice().sort()).toEqual([
        "activated_runtime",
        "claimant_id",
        "required_scenario_ids",
        "results",
        "suite_id",
        "suite_version",
      ]);
      expect(evidence.suite_id).toBe(NEUTRAL_SCENARIO_SUITE_ID);
      expect(evidence.suite_version).toBe(NEUTRAL_SCENARIO_SUITE_VERSION);
      expect(evidence.claimant_id).toBe(CLAIMANT_ID);
      // No promotion verdict may ride along on the aggregate or its outcome.
      for (const key of ["conformant", "promoted", "signature", "attestations", "authority"]) {
        expect(Object.prototype.hasOwnProperty.call(evidence, key)).toBe(false);
      }
    });

    it("carries a complete evidence identity on every result", () => {
      const evidence = expectAccepted(assemble(allPackets()));
      for (const result of evidence.results) {
        for (const field of NEUTRAL_EVIDENCE_IDENTITY_FIELDS) {
          const value = (result.evidence_identity as unknown as Record<string, unknown>)[field];
          expect(value).not.toBeUndefined();
          expect(value === "" || value === null).toBe(false);
        }
      }
      expect(evidence.activated_runtime).toEqual(IDENTITY);
    });
  });

  describe("refusals — each malformed packet set is refused, and named", () => {
    it("refuses a missing owner", () => {
      expectRefusal(assemble(packetsWith("W4/MH-08", null)), REFUSAL_CONTROLS.ownerMissing);
    });

    it("refuses a duplicate owner", () => {
      const packets = allPackets();
      packets.push(packetFor("W1/MH-06"));
      expectRefusal(assemble(packets), REFUSAL_CONTROLS.ownerDuplicated);
    });

    it("refuses a wrong owner scenario count", () => {
      const short = packetFor("W5/MH-09");
      const trimmed: OwnerPacket = {
        ...short,
        stable_ids: short.stable_ids.slice(0, 8),
        results: short.results.slice(0, 8),
      };
      expectRefusal(assemble(packetsWith("W5/MH-09", trimmed)), REFUSAL_CONTROLS.ownerCount);
    });

    it("refuses a duplicated stable id", () => {
      const ids = canonicalIdsFor("W4/MH-07");
      const duplicated = packetFor("W4/MH-07", {
        stable_ids: [ids[0], ids[0], ids[2], ids[3]],
        results: [resultFor(ids[0]), resultFor(ids[0]), resultFor(ids[2]), resultFor(ids[3])],
      });
      expectRefusal(assemble(packetsWith("W4/MH-07", duplicated)), REFUSAL_CONTROLS.idDuplicated);
    });

    it("refuses a foreign stable id", () => {
      const ids = canonicalIdsFor("W2/MH-03");
      const foreign = packetFor("W2/MH-03", {
        stable_ids: [ids[0], ids[1], ids[2], "MHRC-FORGED-001"],
        results: [resultFor(ids[0]), resultFor(ids[1]), resultFor(ids[2]), resultFor("MHRC-FORGED-001")],
      });
      expectRefusal(assemble(packetsWith("W2/MH-03", foreign)), REFUSAL_CONTROLS.idForeign);
    });

    it("refuses an id that belongs to another owner", () => {
      const ids = canonicalIdsFor("W2/MH-03");
      const poached = packetFor("W2/MH-03", {
        stable_ids: [ids[0], ids[1], ids[2], "MHRC-RCT-001"],
        results: [resultFor(ids[0]), resultFor(ids[1]), resultFor(ids[2]), resultFor("MHRC-RCT-001")],
      });
      expectRefusal(assemble(packetsWith("W2/MH-03", poached)), REFUSAL_CONTROLS.idOwnerMismatch);
    });

    it("refuses results that are not ordered against the packet's ids", () => {
      const ids = canonicalIdsFor("W1/MH-02");
      const misordered = packetFor("W1/MH-02", {
        results: [
          resultFor(ids[1]),
          resultFor(ids[0]),
          resultFor(ids[2]),
          resultFor(ids[3]),
          resultFor(ids[4]),
        ],
      });
      expectRefusal(assemble(packetsWith("W1/MH-02", misordered)), REFUSAL_CONTROLS.resultOrder);
    });

    it("refuses suite drift", () => {
      const drifted = packetFor("W4/MH-08", { suite_version: "1.1.0" });
      expectRefusal(assemble(packetsWith("W4/MH-08", drifted)), REFUSAL_CONTROLS.suiteDrift);
      const renamed = packetFor("W4/MH-08", { suite_id: "guild.conformance_scenarios.v2" });
      expectRefusal(assemble(packetsWith("W4/MH-08", renamed)), REFUSAL_CONTROLS.suiteDrift);
    });

    it("refuses an identity that disagrees across packets, results, or the claim", () => {
      const otherPacket = packetFor("W1/MH-06", { evidence_identity: OTHER_IDENTITY });
      expectRefusal(
        assemble(packetsWith("W1/MH-06", otherPacket)),
        REFUSAL_CONTROLS.identityMismatch
      );

      const ids = canonicalIdsFor("W4/MH-07");
      const otherResult = packetFor("W4/MH-07", {
        results: [
          resultFor(ids[0], { evidence_identity: OTHER_IDENTITY }),
          resultFor(ids[1]),
          resultFor(ids[2]),
          resultFor(ids[3]),
        ],
      });
      expectRefusal(
        assemble(packetsWith("W4/MH-07", otherResult)),
        REFUSAL_CONTROLS.identityMismatch
      );

      expectRefusal(
        assemble(allPackets(), { claimant_id: CLAIMANT_ID, activated_runtime: OTHER_IDENTITY }),
        REFUSAL_CONTROLS.identityMismatch
      );
    });

    it("refuses an incomplete evidence identity", () => {
      const incomplete = { ...IDENTITY } as Record<string, unknown>;
      delete incomplete.platform;
      const packet = packetFor("W5/MH-09", { evidence_identity: incomplete });
      expectRefusal(assemble(packetsWith("W5/MH-09", packet)), REFUSAL_CONTROLS.identityIncomplete);

      const blank = packetFor("W5/MH-09", {
        evidence_identity: { ...IDENTITY, release_id: "" },
      });
      expectRefusal(assemble(packetsWith("W5/MH-09", blank)), REFUSAL_CONTROLS.identityIncomplete);
    });

    it("refuses a caller that supplies its own required set", () => {
      expectRefusal(
        assemble(allPackets(), {
          claimant_id: CLAIMANT_ID,
          activated_runtime: IDENTITY,
          required_scenario_ids: CANONICAL_SCENARIO_IDS.slice(0, 5),
        }),
        REFUSAL_CONTROLS.callerRequiredSet
      );

      // Even a caller set that AGREES is refused: the required set has one source,
      // and accepting a matching copy is accepting the channel that can differ.
      expectRefusal(
        assemble(allPackets(), {
          claimant_id: CLAIMANT_ID,
          activated_runtime: IDENTITY,
          required_scenario_ids: [...CANONICAL_SCENARIO_IDS],
        }),
        REFUSAL_CONTROLS.callerRequiredSet
      );
    });

    /**
     * The closed set is stated as the twelve PRE-blocker controls, the one
     * FIC-110 B1 adds, and the one FIC-131 adds for the canonical-text request
     * boundary. Widening it here — rather than loosening the assertion to a
     * superset check — is what keeps it a CLOSED set: an unannounced fifteenth
     * control still fails.
     */
    it("names a distinct refusal control for every refusal path", () => {
      const controls: string[] = Object.keys(REFUSAL_CONTROLS).map(
        (key) => REFUSAL_CONTROLS[key as keyof typeof REFUSAL_CONTROLS]
      );
      controls.push(RESULT_CONTRACT_CONTROL);
      controls.push(REQUEST_TEXT_CONTROL);
      expect(new Set(controls).size).toBe(controls.length);
      const declared = exported<readonly string[]>("NEUTRAL_ASSEMBLY_REFUSAL_CONTROLS");
      expect([...declared].sort()).toEqual(controls.slice().sort());
    });
  });

  describe("the control battery distinguishes good from bad", () => {
    /**
     * The ORDERED closed list is the fifteen PRE-blocker controls, the two
     * FIC-110 B1/B2 adds, and the FIC-131 canonical-text add, appended in that
     * order. Stating it exactly — rather than relaxing to `toContain` — keeps an
     * unannounced nineteenth control a failure, and keeps §"declares both blocker
     * controls" below non-vacuous.
     */
    it("declares the named controls", () => {
      const controls = exported<Array<{ id: string; title: string }>>("NEUTRAL_ASSEMBLY_CONTROLS");
      expect(controls.map((control) => control.id)).toEqual([
        ...CONTROL_IDS,
        BLOCKER_CONTROL_IDS.resultContract,
        BLOCKER_CONTROL_IDS.untrustedShape,
        BLOCKER_CONTROL_IDS.canonicalTextRequest,
      ]);
      for (const control of controls) expect(typeof control.title).toBe("string");
    });

    it("passes the real implementation", () => {
      const run = exported<(impl: AssemblyFn) => { passed: boolean; failed_ids: readonly string[] }>(
        "runNeutralAssemblyControls"
      );
      const report = run(exported<AssemblyFn>("assembleNeutralConformanceEvidence"));
      expect([...report.failed_ids]).toEqual([]);
      expect(report.passed).toBe(true);
    });

    it("fails the planted naive-concatenation mutant on named controls", () => {
      const run = exported<(impl: AssemblyFn) => { passed: boolean; failed_ids: readonly string[] }>(
        "runNeutralAssemblyControls"
      );
      const report = run(naiveConcatenationMutant);
      expect(report.passed).toBe(false);
      for (const id of MUTANT_MUST_FAIL) expect([...report.failed_ids]).toContain(id);
      expect(report.failed_ids.length).toBeGreaterThanOrEqual(MUTANT_MUST_FAIL.length);
    });
  });

  describe("the module stays inside its boundary", () => {
    it("never reads the frozen fixture", () => {
      const source = withoutComments(assemblySource());
      for (const forbidden of ["conformance-scenarios.v1", "__tests__", "fixtures", ".json"]) {
        expect(source).not.toContain(forbidden);
      }
    });

    it("imports only neutral-core members — no I/O, no fixture, no host edge", () => {
      const source = withoutComments(assemblySource());
      const specifiers: string[] = [];
      const pattern = /(?:from|require\()\s*["']([^"']+)["']/g;
      let match = pattern.exec(source);
      while (match !== null) {
        specifiers.push(match[1]);
        match = pattern.exec(source);
      }
      expect(specifiers.length).toBeGreaterThan(0);
      for (const specifier of specifiers) {
        expect(["./neutral-runtime-contracts", "./neutral-conformance-core"]).toContain(specifier);
      }
    });

    it("takes no promotion or signature decision", () => {
      const source = withoutComments(assemblySource());
      for (const forbidden of [
        "evaluateNeutralConformanceDecision",
        "NEUTRAL_ATTESTOR_TRUST_ROOT",
        "NEUTRAL_MINIMUM_ATTESTOR_QUORUM",
        "neutralAttestationVerifies",
        "neutralVerifyAttestationSignature",
        "neutralAttestationDigest",
        "NeutralConformanceAuthority",
        "NeutralJournalAttestation",
      ]) {
        expect(source).not.toContain(forbidden);
      }
    });
  });
});

// ---------------------------------------------------------------------------
// FIC-110 blockers B1 + B2 — the untrusted-shape contract, stated RED-first
// ---------------------------------------------------------------------------

/**
 * WHY THIS BLOCK EXISTS
 *
 * The suite above binds the JOIN: owners, ids, order, identity. FIC-110's
 * independent review found two boundary properties it never stated, and direct
 * probes confirmed both against the shipped implementation:
 *
 *   B1  a result carrying no `outcome_type`, `disposition: 42`, `receipt_ref:
 *       null`, and `evidence_freshness: "invented"` was COPIED into a frozen
 *       aggregate under `disposition: "succeeded"`. The module claims to emit
 *       `NeutralConformanceEvidence`; malformed evidence is not that shape, and
 *       "the MH-02 decision rejects it later" is a different boundary's job.
 *
 *   B2  the whole contract is read with ordinary property access, so a claim and
 *       six packets supplied ENTIRELY through prototypes assembled successfully —
 *       including an inherited `required_scenario_ids: ["ATTACKER"]`, the one
 *       channel this module exists to close — and a throwing `claimant_id` getter
 *       escaped as `Error: getter executed` instead of returning a refusal.
 *
 * WHAT IS DELIBERATELY NOT REQUIRED
 *   No reflection mechanism is dictated. The contract is behavioural: refuse,
 *   never throw, and stay compatible with ordinary JSON-parsed records (which
 *   carry own data properties only). Freshness is NOT required to be `fresh` —
 *   `stale` and `unknown` are typed verdicts the MH-02 decision rejects later —
 *   only membership in the exported vocabulary is required here.
 *
 * NOTE ON THE TWO WIDENED CLOSED SETS (FIC-112)
 *   Two assertions above state the contract as CLOSED sets:
 *   §"names a distinct refusal control for every refusal path" and
 *   §"declares the named controls". They were authored at the PRE-blocker sizes
 *   (12 controls, 15 battery ids) and left untouched during the RED pass so it
 *   failed only on the new obligations. Landing B1/B2 adds
 *   `RESULT_CONTRACT_CONTROL` and the two `BLOCKER_CONTROL_IDS` below, so both
 *   are now stated at 13 and 17 — still EXACT, still closed, so an unannounced
 *   control or battery id remains a failure.
 */

/** The refusal control a malformed runtime result contract must name (B1). */
const RESULT_CONTRACT_CONTROL = "result_contract_invalid";

/**
 * The refusal control a request that is not one canonical JSON TEXT must name
 * (FIC-131).
 *
 * It is stated here, test-side, exactly as every other control is: production
 * has to declare the same string in `NEUTRAL_ASSEMBLY_REFUSAL_CONTROLS`, so a
 * rename on either side is a failure rather than a silent divergence.
 */
const REQUEST_TEXT_CONTROL = "assembly_request_not_canonical_text";

/** The control-battery ids the blockers add to the module's own battery. */
const BLOCKER_CONTROL_IDS = {
  resultContract: "A21S-C16-result-contract-validated",
  untrustedShape: "A21S-C17-untrusted-shape-safe-reads",
  canonicalTextRequest: "A21S-C18-canonical-text-request",
} as const;

function declaredRefusalControls(): readonly string[] {
  return exported<readonly string[]>("NEUTRAL_ASSEMBLY_REFUSAL_CONTROLS");
}

/** Every VALUE on the outcome's facts, so a test can require one to name a field. */
function factValues(outcome: NeutralOutcome): unknown[] {
  const facts = outcome.facts as unknown as Record<string, unknown>;
  return Object.keys(facts).map((key) => facts[key]);
}

/**
 * A refusal that is a RETURN VALUE, not an exception.
 *
 * A thrown error is not a refusal a caller can inspect, route, or record, so the
 * throw is caught here and re-raised as the assertion failure it is.
 */
function expectSafeRefusal(run: () => AssemblyResult): AssemblyResult {
  let result: AssemblyResult;
  try {
    result = run();
  } catch (error) {
    throw new Error(
      `expected a typed refusal, but the assembler threw: ${String((error as Error)?.message ?? error)}`
    );
  }
  expect(result.evidence).toBeNull();
  expect(result.outcome.disposition).toBe("refused");
  expect(NEUTRAL_REASON_CODES.indexOf(result.outcome.reason_code as never)).toBeGreaterThanOrEqual(0);
  // Source-owned: the control is one the MODULE declares, never one invented at
  // the refusal site.
  expect([...declaredRefusalControls()]).toContain(result.outcome.facts.refusal_control);
  return result;
}

/** A result with one contract field REMOVED rather than replaced. */
function resultOmitting(stableId: string, field: string): NeutralScenarioResult {
  const result = { ...(resultFor(stableId) as unknown as Record<string, unknown>) };
  delete result[field];
  return result as unknown as NeutralScenarioResult;
}

/** One owner's packet with a single result replaced, everything else canonical. */
function packetWithResultAt(
  ownerKey: string,
  position: number,
  replacement: NeutralScenarioResult
): OwnerPacket {
  const ids = canonicalIdsFor(ownerKey);
  const results = ids.map((id) => resultFor(id));
  results[position] = replacement;
  return packetFor(ownerKey, { results });
}

interface MalformedResultCase {
  readonly label: string;
  readonly owner: string;
  readonly position: number;
  /** The contract field the refusal must identify. */
  readonly field: string;
  readonly result: (stableId: string) => NeutralScenarioResult;
}

/**
 * Every malformed class of the runtime result contract, one row each.
 *
 * The rows are spread across owners and positions on purpose: a validation that
 * only inspects the first packet, or only position 0, passes a narrower table
 * while leaving the boundary open exactly where a real owner's packet differs.
 */
const MALFORMED_RESULT_CASES: readonly MalformedResultCase[] = [
  {
    label: "missing outcome_type",
    owner: "W1/MH-02",
    position: 0,
    field: "outcome_type",
    result: (id) => resultOmitting(id, "outcome_type"),
  },
  {
    label: "outcome_type outside the closed envelope vocabulary",
    owner: "W2/MH-03",
    position: 1,
    field: "outcome_type",
    result: (id) => resultFor(id, { outcome_type: "guild.invented_outcome.v9" }),
  },
  {
    label: "non-string disposition",
    owner: "W1/MH-06",
    position: 2,
    field: "disposition",
    result: (id) => resultFor(id, { disposition: 42 }),
  },
  {
    label: "disposition outside the closed vocabulary",
    owner: "W4/MH-07",
    position: 3,
    field: "disposition",
    result: (id) => resultFor(id, { disposition: "promoted" }),
  },
  {
    label: "missing disposition",
    owner: "W4/MH-08",
    position: 0,
    field: "disposition",
    result: (id) => resultOmitting(id, "disposition"),
  },
  {
    label: "invented reason_code on a refused result",
    owner: "W5/MH-09",
    position: 8,
    field: "reason_code",
    result: (id) => resultFor(id, { disposition: "refused", reason_code: "invented_reason" }),
  },
  {
    label: "non-string reason_code on a failed result",
    owner: "W1/MH-06",
    position: 4,
    field: "reason_code",
    result: (id) => resultFor(id, { disposition: "failed", reason_code: 7 }),
  },
  {
    label: "reason_code carried by a succeeded result",
    owner: "W1/MH-02",
    position: 4,
    field: "reason_code",
    result: (id) => resultFor(id, { disposition: "succeeded", reason_code: "policy_denied" }),
  },
  {
    label: "absent reason_code on a non-succeeded result",
    owner: "W2/MH-03",
    position: 3,
    field: "reason_code",
    result: (id) => resultFor(id, { disposition: "failed", reason_code: null }),
  },
  {
    label: "missing receipt_ref",
    owner: "W4/MH-07",
    position: 0,
    field: "receipt_ref",
    result: (id) => resultOmitting(id, "receipt_ref"),
  },
  {
    label: "null receipt_ref",
    owner: "W4/MH-08",
    position: 3,
    field: "receipt_ref",
    result: (id) => resultFor(id, { receipt_ref: null }),
  },
  {
    label: "non-string receipt_ref",
    owner: "W5/MH-09",
    position: 0,
    field: "receipt_ref",
    result: (id) => resultFor(id, { receipt_ref: 12 }),
  },
  {
    label: "evidence_freshness outside the exported vocabulary",
    owner: "W1/MH-02",
    position: 2,
    field: "evidence_freshness",
    result: (id) => resultFor(id, { evidence_freshness: "invented" }),
  },
  {
    label: "missing evidence_freshness",
    owner: "W2/MH-03",
    position: 2,
    field: "evidence_freshness",
    result: (id) => resultOmitting(id, "evidence_freshness"),
  },
  {
    label: "non-string evidence_freshness",
    owner: "W1/MH-06",
    position: 1,
    field: "evidence_freshness",
    result: (id) => resultFor(id, { evidence_freshness: true }),
  },
];

describe("FIC-110 B1 — a malformed runtime result contract is refused, never assembled", () => {
  it("declares a source-owned control for the result contract", () => {
    expect([...declaredRefusalControls()]).toContain(RESULT_CONTRACT_CONTROL);
  });

  it.each(MALFORMED_RESULT_CASES.map((testCase) => [testCase.label, testCase] as const))(
    "refuses %s, naming the control and the invalid field",
    (_label, testCase) => {
      const ids = canonicalIdsFor(testCase.owner);
      const stableId = ids[testCase.position];
      const packet = packetWithResultAt(testCase.owner, testCase.position, testCase.result(stableId));
      const result = expectSafeRefusal(() => assemble(packetsWith(testCase.owner, packet)));
      expect(result.outcome.facts.refusal_control).toBe(RESULT_CONTRACT_CONTROL);
      // Some fact NAMES the offending field — which key carries it is the
      // implementation's choice, that it is named is the contract.
      expect(factValues(result.outcome)).toContain(testCase.field);
    }
  );

  /** The exact probe FIC-110 ran: four malformed fields on one result at once. */
  it("refuses the FIC-110 probe result rather than freezing it into succeeded evidence", () => {
    const ids = canonicalIdsFor("W1/MH-02");
    const probe = {
      ...(resultOmitting(ids[0], "outcome_type") as unknown as Record<string, unknown>),
      disposition: 42,
      receipt_ref: null,
      evidence_freshness: "invented",
    } as unknown as NeutralScenarioResult;
    const result = expectSafeRefusal(() =>
      assemble(packetsWith("W1/MH-02", packetWithResultAt("W1/MH-02", 0, probe)))
    );
    expect(result.outcome.facts.refusal_control).toBe(RESULT_CONTRACT_CONTROL);
    expect(result.evidence).toBeNull();
  });

  /**
   * NON-VACUITY — the validation must not degenerate into "only my fixture
   * passes". Every value the exported vocabularies admit is still assembled.
   */
  it("accepts every freshness verdict the core exports, not only fresh", () => {
    for (const verdict of NEUTRAL_EVIDENCE_FRESHNESS_VERDICTS) {
      const ids = canonicalIdsFor("W4/MH-08");
      const packet = packetFor("W4/MH-08", {
        results: ids.map((id) => resultFor(id, { evidence_freshness: verdict })),
      });
      const evidence = expectAccepted(assemble(packetsWith("W4/MH-08", packet)));
      const assembled = evidence.results.filter((entry) => ids.indexOf(entry.stable_id) !== -1);
      expect(assembled.length).toBe(ids.length);
      for (const entry of assembled) expect(entry.evidence_freshness).toBe(verdict);
    }
  });

  it("accepts a non-succeeded result that names a reason code from the closed vocabulary", () => {
    const ids = canonicalIdsFor("W2/MH-03");
    const packet = packetWithResultAt(
      "W2/MH-03",
      0,
      resultFor(ids[0], { disposition: "failed", reason_code: "execution_failed" })
    );
    const evidence = expectAccepted(assemble(packetsWith("W2/MH-03", packet)));
    const assembled = evidence.results.find((entry) => entry.stable_id === ids[0]);
    expect(assembled).toBeDefined();
    expect((assembled as NeutralScenarioResult).disposition).toBe("failed");
    expect((assembled as NeutralScenarioResult).reason_code).toBe("execution_failed");
  });
});

// ---------------------------------------------------------------------------

/** A shallow own-data clone with ONE field replaced by a throwing accessor. */
function withThrowingGetter<T>(base: T, field: string): T {
  const clone: Record<string, unknown> = {};
  const source = base as unknown as Record<string, unknown>;
  for (const key of Object.keys(source)) clone[key] = source[key];
  Object.defineProperty(clone, field, {
    enumerable: true,
    configurable: true,
    get(): never {
      throw new Error(`A21-S probe: ${field} getter executed`);
    },
  });
  return clone as unknown as T;
}

/** The same record, reachable only through its prototype. */
function throughPrototype<T>(base: T): T {
  return Object.create(base as unknown as object) as T;
}

/**
 * The RAW object request an inherited-shape probe now makes.
 *
 * These probes may never be encoded by the harness: canonicalizing an
 * `Object.create` child reads only its OWN keys, which would silently delete the
 * inherited field the probe exists to plant. The object is handed to the
 * boundary exactly as built, and refusing it unread is the obligation.
 */
function objectRequest(packets: unknown, claim: unknown): unknown {
  return { packets, claim };
}

describe("FIC-110 B2 — untrusted shapes refuse rather than throw or pass", () => {
  /**
   * FIC-131 MIGRATION, stated where it bites.
   *
   * These probes are unchanged in shape and unchanged in obligation: an inherited
   * `required_scenario_ids` is still a caller supplying the tuple, and it is
   * still refused with no evidence. What changed is WHERE it is refused. The
   * request boundary is now one canonical JSON text, so an object request is
   * refused before any of its members are read, and the control it names is the
   * text control rather than the required-set one — the earlier control cannot
   * fire, because deciding it would mean reading the shape.
   *
   * The CHANNEL assertion is therefore not dropped, it is doubled: each test
   * below asserts (a) the raw object request is refused at the text boundary, and
   * (b) the same attack expressed inside a canonical request — the tuple as OWN
   * data on the claim, which is the only way it can cross a text boundary at all
   * — is still refused with `caller_supplied_required_set`.
   */
  it("refuses a required set supplied through the claim's prototype", () => {
    const claim = throughPrototype({
      required_scenario_ids: ["ATTACKER"],
    }) as unknown as Record<string, unknown>;
    claim.claimant_id = CLAIMANT_ID;
    claim.activated_runtime = IDENTITY;
    const raw = expectSafeRefusal(() => assembleRaw(objectRequest(allPackets(), claim)));
    expect(raw.outcome.facts.refusal_control).toBe(REQUEST_TEXT_CONTROL);
    expect(JSON.stringify(raw)).not.toContain("ATTACKER");

    // The channel is the finding, not the value: a caller-supplied tuple that
    // DOES cross the text boundary is still refused for being supplied.
    const encoded = expectSafeRefusal(() =>
      assemble(allPackets(), {
        claimant_id: CLAIMANT_ID,
        activated_runtime: IDENTITY,
        required_scenario_ids: ["ATTACKER"],
      })
    );
    expect(encoded.outcome.facts.refusal_control).toBe(REFUSAL_CONTROLS.callerRequiredSet);
  });

  it("refuses a required set inherited even when it agrees with the source-owned tuple", () => {
    const claim = throughPrototype({
      required_scenario_ids: [...CANONICAL_SCENARIO_IDS],
    }) as unknown as Record<string, unknown>;
    claim.claimant_id = CLAIMANT_ID;
    claim.activated_runtime = IDENTITY;
    const raw = expectSafeRefusal(() => assembleRaw(objectRequest(allPackets(), claim)));
    expect(raw.outcome.facts.refusal_control).toBe(REQUEST_TEXT_CONTROL);

    // An AGREEING tuple is refused too, on the text path where it is expressible.
    const encoded = expectSafeRefusal(() =>
      assemble(allPackets(), {
        claimant_id: CLAIMANT_ID,
        activated_runtime: IDENTITY,
        required_scenario_ids: [...CANONICAL_SCENARIO_IDS],
      })
    );
    expect(encoded.outcome.facts.refusal_control).toBe(REFUSAL_CONTROLS.callerRequiredSet);
  });

  it("refuses a claim whose contract fields are inherited rather than own", () => {
    expectSafeRefusal(() => assembleRaw(objectRequest(allPackets(), throughPrototype(CLAIM))));
  });

  it("refuses a packet whose contract fields are inherited rather than own", () => {
    const inherited = throughPrototype(packetFor("W1/MH-06"));
    expectSafeRefusal(() => assembleRaw(objectRequest(packetsWith("W1/MH-06", inherited), CLAIM)));
  });

  it("refuses the FIC-110 probe: six packets and a claim supplied entirely through prototypes", () => {
    const packets = allPackets().map((packet) => throughPrototype(packet));
    expectSafeRefusal(() => assembleRaw(objectRequest(packets, throughPrototype(CLAIM))));
  });

  it.each([["__proto__"], ["constructor"]])(
    "refuses an otherwise schema-valid packet whose owner key is %s",
    (ownerKey) => {
      const packets = [...allPackets(), packetFor("W1/MH-02", { owner_key: ownerKey })];
      expectSafeRefusal(() => assemble(packets));
    }
  );

  it.each([["__proto__"], ["constructor"]])(
    "refuses when the %s owner key REPLACES a declared owner's packet",
    (ownerKey) => {
      const impostor = packetFor("W4/MH-07", { owner_key: ownerKey });
      expectSafeRefusal(() => assemble(packetsWith("W4/MH-07", impostor)));
    }
  );

  /**
   * The throwing-accessor probes go to the RAW boundary, and they are strictly
   * stronger there. The accessor throws the moment it is executed, so a refusal
   * that returns at all is itself proof the getter never ran — the harness never
   * touches the probe either, since encoding it would be the harness running the
   * attacker's code on production's behalf.
   */
  it.each([["claimant_id"], ["activated_runtime"], ["required_scenario_ids"]])(
    "refuses instead of propagating a throwing claim getter on %s",
    (field) => {
      expectSafeRefusal(() =>
        assembleRaw(objectRequest(allPackets(), withThrowingGetter(CLAIM, field)))
      );
    }
  );

  it.each([
    ["schema_version"],
    ["suite_id"],
    ["suite_version"],
    ["owner_key"],
    ["evidence_identity"],
    ["stable_ids"],
    ["results"],
  ])("refuses instead of propagating a throwing packet getter on %s", (field) => {
    const packet = withThrowingGetter(packetFor("W5/MH-09"), field);
    expectSafeRefusal(() => assembleRaw(objectRequest(packetsWith("W5/MH-09", packet), CLAIM)));
  });

  it.each([["stable_id"], ["outcome_type"], ["receipt_ref"], ["evidence_identity"]])(
    "refuses instead of propagating a throwing result getter on %s",
    (field) => {
      const ids = canonicalIdsFor("W4/MH-08");
      const packet = packetWithResultAt("W4/MH-08", 1, withThrowingGetter(resultFor(ids[1]), field));
      expectSafeRefusal(() => assembleRaw(objectRequest(packetsWith("W4/MH-08", packet), CLAIM)));
    }
  );

  /**
   * NON-VACUITY — an implementation that refuses everything would satisfy the
   * block above. Ordinary JSON-parsed records carry own data properties only, and
   * they must still assemble.
   */
  it("still assembles ordinary JSON-parsed records", () => {
    const packets = JSON.parse(JSON.stringify(allPackets())) as OwnerPacket[];
    const claim = JSON.parse(JSON.stringify(CLAIM)) as AssemblyClaim;
    const evidence = expectAccepted(assemble(packets, claim));
    expect(evidence.results.map((entry) => entry.stable_id)).toEqual([...CANONICAL_SCENARIO_IDS]);
  });
});

// ---------------------------------------------------------------------------

describe("FIC-110 B1 + B2 — the blockers are controls in the module's own battery", () => {
  it("declares both blocker controls", () => {
    const controls = exported<Array<{ id: string; title: string }>>("NEUTRAL_ASSEMBLY_CONTROLS");
    const ids = controls.map((control) => control.id);
    expect(ids).toContain(BLOCKER_CONTROL_IDS.resultContract);
    expect(ids).toContain(BLOCKER_CONTROL_IDS.untrustedShape);
  });

  it("passes both blocker controls on the real implementation", () => {
    const run = exported<
      (impl: AssemblyFn) => {
        passed: boolean;
        failed_ids: readonly string[];
        control_count: number;
      }
    >("runNeutralAssemblyControls");
    const report = run(exported<AssemblyFn>("assembleNeutralConformanceEvidence"));
    expect(report.control_count).toBeGreaterThanOrEqual(CONTROL_IDS.length + 2);
    expect([...report.failed_ids]).not.toContain(BLOCKER_CONTROL_IDS.resultContract);
    expect([...report.failed_ids]).not.toContain(BLOCKER_CONTROL_IDS.untrustedShape);
    expect(report.passed).toBe(true);
  });

  it("fails the planted naive-concatenation mutant on both blocker controls", () => {
    const run = exported<(impl: AssemblyFn) => { passed: boolean; failed_ids: readonly string[] }>(
      "runNeutralAssemblyControls"
    );
    const report = run(naiveConcatenationMutant);
    expect(report.passed).toBe(false);
    expect([...report.failed_ids]).toContain(BLOCKER_CONTROL_IDS.resultContract);
    expect([...report.failed_ids]).toContain(BLOCKER_CONTROL_IDS.untrustedShape);
  });
});

// ---------------------------------------------------------------------------
// FIC124-B1 — a RETURNING accessor is validated once and copied twice
// ---------------------------------------------------------------------------

/**
 * WHY THIS BLOCK EXISTS
 *
 * §"FIC-110 B2" above probes accessors that THROW, and a throwing accessor is
 * safe here for an accidental reason: `readOwnField` catches it, the field reads
 * as UNREADABLE, and the refusal path that field feeds fires. An accessor that
 * RETURNS is the same reach with none of that protection — it still executes
 * caller code inside this module's stack, and it can answer differently each time
 * it is asked.
 *
 * The assembler asks twice. It validates `result.stable_id` in the coverage pass
 * and reads the result AGAIN when `copyResult` builds the aggregate, so a getter
 * returning the canonical id on the first read and an attacker value on the
 * second passes validation and lands in the output. FIC-124's independent probe
 * confirmed exactly that against the shipped module: `disposition: "succeeded"`,
 * `evidence !== null`, `evidence.results[0].stable_id: "ATTACKER-SWAP"` — while
 * `required_scenario_ids[0]` still read `MHRC-LIF-001`. That is a false aggregate
 * AND a hidden side effect, and it contradicts the succeeded assertion that
 * "nothing inherited or accessor-backed entered".
 *
 * WHAT IS REQUIRED — three properties, stated as behaviour and not as mechanism:
 *
 *   1. the accessor is NEVER executed as caller code during admission;
 *   2. the aggregate is REFUSED, with `evidence === null` and a control the
 *      module itself declares;
 *   3. no attacker value appears anywhere in a succeeded result.
 *
 * Snapshotting an untrusted field once as inert data and refusing every
 * accessor-backed contract field both satisfy (2) and (3); only the second
 * satisfies (1), and (1) is the property this suite binds, because "validated the
 * value I copied" is not a claim a re-readable field can support.
 *
 * HOW IT IS SATISFIED SINCE FIC-131. The refusal is now the CANONICAL-TEXT one:
 * this probe hands production the raw packet set, production sees a non-string
 * request, and it returns before any structural operation — so the stateful
 * getter is never reached, `reads()` is 0, and no attacker value can appear.
 * The three properties are unchanged and the probe is unchanged; only the step
 * at which the refusal happens moved earlier, which is strictly stronger than
 * refusing after admitting the shape far enough to classify it. This control
 * stays load-bearing precisely because it is the shape that would re-open the
 * defect if the boundary ever accepted an object graph again.
 *
 * NON-VACUITY is already carried above by §"still assembles ordinary JSON-parsed
 * records": a module that refused everything would fail it. Nothing here widens
 * that, so a plain own-data record must still assemble unchanged.
 */

/** The value the FIC-124 probe swapped in on the second read. */
const ATTACKER_SWAP = "ATTACKER-SWAP";

interface SwappingProbe<T> {
  /** The clone whose `field` is an enumerable, RETURNING, stateful accessor. */
  readonly value: T;
  /** How many times the accessor has been executed. */
  reads(): number;
}

/**
 * A shallow own-data clone with ONE field replaced by a returning getter that
 * answers canonically once and adversarially forever after.
 *
 * Enumerable on purpose: `Object.keys` reports it, so an own-ness test alone
 * cannot tell it apart from data — which is precisely why reading it is the
 * defect rather than finding it.
 */
function withSwappingGetter<T>(base: T, field: string, attacker: unknown): SwappingProbe<T> {
  const source = base as unknown as Record<string, unknown>;
  const canonical = source[field];
  const clone: Record<string, unknown> = {};
  for (const key of Object.keys(source)) clone[key] = source[key];
  let executions = 0;
  Object.defineProperty(clone, field, {
    enumerable: true,
    configurable: true,
    get(): unknown {
      executions += 1;
      return executions === 1 ? canonical : attacker;
    },
  });
  return { value: clone as unknown as T, reads: () => executions };
}

/**
 * Hand the RAW packet set to production without letting a throw stand in for a
 * refusal.
 *
 * Raw is mandatory for every probe below (FIC-131). These packet sets carry
 * stateful getters, frozen returning getters, getter/setter pairs, and counting
 * proxies, and the property under test is that PRODUCTION never executes them.
 * If the harness encoded them first, the harness would be the thing that ran the
 * accessor, the execution counter would be non-zero for a reason production is
 * not responsible for, and the assertion would be measuring the test.
 */
function assembleWithoutThrowing(packets: readonly OwnerPacket[]): AssemblyResult {
  try {
    return assembleRaw(objectRequest(packets, CLAIM));
  } catch (error) {
    throw new Error(
      `expected a typed refusal, but the assembler threw: ${String((error as Error)?.message ?? error)}`
    );
  }
}

/** The exact FIC-124 probe: `MHRC-LIF-001`'s `stable_id` swaps after validation. */
function stableIdSwapProbe(): { probe: SwappingProbe<NeutralScenarioResult>; packets: OwnerPacket[] } {
  const ids = canonicalIdsFor("W1/MH-02");
  const probe = withSwappingGetter(resultFor(ids[0]), "stable_id", ATTACKER_SWAP);
  const packet = packetWithResultAt("W1/MH-02", 0, probe.value);
  return { probe, packets: packetsWith("W1/MH-02", packet) };
}

describe("FIC124-B1 — an accessor-backed contract field cannot change between validation and copy", () => {
  it("never lets the swapped value reach a succeeded aggregate", () => {
    const { packets } = stableIdSwapProbe();
    const result = assembleWithoutThrowing(packets);
    // The reviewed defect, verbatim: a succeeded aggregate whose results carry
    // the attacker's id while the required tuple still reads the canonical one.
    expect(JSON.stringify(result)).not.toContain(ATTACKER_SWAP);
    expect(result.evidence).toBeNull();
    expect(result.outcome.disposition).toBe("refused");
    expect([...declaredRefusalControls()]).toContain(result.outcome.facts.refusal_control);
  });

  it("never executes the accessor as caller code while admitting the packet", () => {
    const { probe, packets } = stableIdSwapProbe();
    assembleWithoutThrowing(packets);
    // A field that was READ was validated at a moment that has already passed.
    // The only honest number here is zero.
    expect(probe.reads()).toBe(0);
  });

  it.each([["stable_id"], ["outcome_type"], ["disposition"], ["receipt_ref"], ["evidence_freshness"]])(
    "refuses a result whose %s is an accessor, without executing it",
    (field) => {
      const ids = canonicalIdsFor("W4/MH-07");
      const probe = withSwappingGetter(resultFor(ids[2]), field, ATTACKER_SWAP);
      const packet = packetWithResultAt("W4/MH-07", 2, probe.value);
      const result = assembleWithoutThrowing(packetsWith("W4/MH-07", packet));
      expect(JSON.stringify(result)).not.toContain(ATTACKER_SWAP);
      expect(result.evidence).toBeNull();
      expect(result.outcome.disposition).toBe("refused");
      expect([...declaredRefusalControls()]).toContain(result.outcome.facts.refusal_control);
      expect(probe.reads()).toBe(0);
    }
  );
});

// ---------------------------------------------------------------------------
// FIC129-B1 — a FROZEN accessor is still caller code, and it is still admitted
// ---------------------------------------------------------------------------

/**
 * WHY THIS BLOCK EXISTS
 *
 * §"FIC124-B1" above closed the reread SWAP: a contract field is snapshotted
 * once, so the value validated is the value emitted. It did not close the
 * ADMISSION question, and FIC-129 refused the correction packet on exactly that
 * distinction.
 *
 * `fieldIsInertData` decides own-ness by ASSIGNING through a throwaway prototype
 * child and watching `[[Set]]`. `[[Set]]` cannot separate a non-writable data
 * property from a getter-only accessor — both merely return false — so the
 * failed write falls back to `Object.isFrozen(value)` and admits the whole
 * record. A FROZEN record with an enumerable, non-configurable, RETURNING getter
 * therefore rides that fallback straight into `readOwnField`, which executes the
 * getter as caller code inside this module's stack.
 *
 * FIC-129's independent replay against the shipped module confirmed it: a frozen
 * result whose `receipt_ref` was such a getter produced `disposition:
 * "succeeded"`, a non-null aggregate, and `ATTACKER-FROZEN-RECEIPT` in
 * `evidence.results[0].receipt_ref` — under the very assertion that "nothing
 * inherited or accessor-backed entered". A single snapshot makes that value
 * stable; it does not make it inert, and it does not make the success assertion
 * true.
 *
 * The GETTER-PLUS-SETTER shape is refused today, but not without cost: the
 * `[[Set]]` discriminator is itself the caller's setter, so admission executes
 * attacker code ONCE before deciding to refuse. A refusal reached by running the
 * caller's code is still a reach into this module's stack.
 *
 * WHAT IS REQUIRED — the same three properties §"FIC124-B1" states, now over the
 * shapes that survive the snapshot:
 *
 *   1. neither accessor half is executed as caller code during admission;
 *   2. the aggregate is REFUSED, with `evidence === null` and a control the
 *      module itself declares;
 *   3. no attacker value appears anywhere in the returned aggregate.
 *
 * HOW IT WAS CLOSED (FIC-131). Not by a better admission probe — there is no
 * portable one. `[[Set]]` cannot separate a non-writable data property from a
 * getter-only accessor; `Object.getOwnPropertyDescriptor` can, but the core
 * capability rail rejects it as a `reflection_call_reach`; and `util.types.isProxy`,
 * a V8 hook, or a WeakSet brand registry would each buy the distinction with a
 * host import or with state. The boundary moved instead: the request is now ONE
 * CANONICAL JSON TEXT, so a frozen returning getter, a getter/setter pair, and a
 * proxy are all refused at `typeof request !== "string"` — before any key is
 * enumerated, any property is read or written, and any descriptor is asked for.
 * All three obligations above hold for the same reason at once, and they hold for
 * shapes nobody has thought of yet.
 *
 * NON-VACUITY is carried by §"still assembles ordinary JSON-parsed records" and
 * by §"the frozen result battery still assembles a frozen own-data record"
 * inside the first control below: freezing is the shape an owner evaluator
 * actually hands over, so a frozen record of plain data must still assemble.
 */

/** The value FIC-129's frozen-accessor replay found in the succeeded aggregate. */
const ATTACKER_FROZEN_RECEIPT = "ATTACKER-FROZEN-RECEIPT";

interface AccessorProbe<T> {
  readonly value: T;
  /** How many times the getter half has executed. */
  reads(): number;
  /** How many times the setter half has executed. */
  writes(): number;
}

/**
 * A FROZEN own-data clone with ONE contract field replaced by an enumerable,
 * non-configurable, RETURNING getter.
 *
 * Frozen is the point. `Object.freeze` is what `fieldIsInertData` falls back to
 * when its `[[Set]]` probe throws, and an accessor property is frozen once it is
 * non-configurable — so this record answers `Object.isFrozen === true` while one
 * of its contract fields is still caller code.
 */
function withFrozenReturningGetter<T>(base: T, field: string, attacker: unknown): AccessorProbe<T> {
  const source = base as unknown as Record<string, unknown>;
  const clone: Record<string, unknown> = {};
  for (const key of Object.keys(source)) if (key !== field) clone[key] = source[key];
  let reads = 0;
  Object.defineProperty(clone, field, {
    enumerable: true,
    configurable: false,
    get(): unknown {
      reads += 1;
      return attacker;
    },
  });
  Object.freeze(clone);
  return { value: clone as unknown as T, reads: () => reads, writes: () => 0 };
}

/**
 * The same clone with an accessor that has BOTH halves.
 *
 * The setter is what the `[[Set]]` discriminator runs. Counting it is the whole
 * point of this probe: the refusal is already correct, the execution is not.
 */
function withGetterAndSetter<T>(base: T, field: string, attacker: unknown): AccessorProbe<T> {
  const source = base as unknown as Record<string, unknown>;
  const clone: Record<string, unknown> = {};
  for (const key of Object.keys(source)) if (key !== field) clone[key] = source[key];
  let reads = 0;
  let writes = 0;
  Object.defineProperty(clone, field, {
    enumerable: true,
    configurable: false,
    get(): unknown {
      reads += 1;
      return attacker;
    },
    set(): void {
      writes += 1;
    },
  });
  return { value: clone as unknown as T, reads: () => reads, writes: () => writes };
}

/** A frozen own-DATA clone — the honest shape an owner evaluator hands over. */
function frozenOwnData<T>(base: T): T {
  const source = base as unknown as Record<string, unknown>;
  const clone: Record<string, unknown> = {};
  for (const key of Object.keys(source)) clone[key] = source[key];
  return Object.freeze(clone) as unknown as T;
}

/** Place one probed result into `W1/MH-02` at its canonical first position. */
function packetsWithProbedResult(probe: AccessorProbe<NeutralScenarioResult>): OwnerPacket[] {
  const packet = packetWithResultAt("W1/MH-02", 0, probe.value);
  return packetsWith("W1/MH-02", packet);
}

describe("FIC129-B1 — a frozen or setter-backed accessor is refused without executing either half", () => {
  it("refuses a frozen result whose receipt_ref is a returning getter", () => {
    // Anti-vacuity FIRST, in the same control: freezing alone must not be the
    // thing that refuses, or the refusal below would prove nothing about the
    // accessor. A frozen record of plain own data is the INTENDED shape.
    const honest = packetWithResultAt("W1/MH-02", 0, frozenOwnData(resultFor(CANONICAL_SCENARIO_IDS[0])));
    expectAccepted(assemble(packetsWith("W1/MH-02", honest)));

    const probe = withFrozenReturningGetter(
      resultFor(CANONICAL_SCENARIO_IDS[0]),
      "receipt_ref",
      ATTACKER_FROZEN_RECEIPT
    );
    expect(Object.isFrozen(probe.value)).toBe(true);
    const result = assembleWithoutThrowing(packetsWithProbedResult(probe));
    // The reviewed defect verbatim: `fieldIsInertData` fell back to
    // `Object.isFrozen` and admitted an accessor-backed contract field.
    expect(result.evidence).toBeNull();
    expect(result.outcome.disposition).toBe("refused");
    expect([...declaredRefusalControls()]).toContain(result.outcome.facts.refusal_control);
  });

  it("never executes the frozen getter, and never emits its value", () => {
    const probe = withFrozenReturningGetter(
      resultFor(CANONICAL_SCENARIO_IDS[0]),
      "receipt_ref",
      ATTACKER_FROZEN_RECEIPT
    );
    const result = assembleWithoutThrowing(packetsWithProbedResult(probe));
    // A field that was READ ran caller code inside this module's frame. The only
    // honest number is zero.
    expect(probe.reads()).toBe(0);
    // FIC-129 replayed `ATTACKER-FROZEN-RECEIPT` out of
    // `evidence.results[0].receipt_ref` of a SUCCEEDED aggregate.
    expect(JSON.stringify(result)).not.toContain(ATTACKER_FROZEN_RECEIPT);
  });

  it("refuses a getter-plus-setter contract field without running either half", () => {
    const probe = withGetterAndSetter(
      resultFor(CANONICAL_SCENARIO_IDS[0]),
      "receipt_ref",
      ATTACKER_FROZEN_RECEIPT
    );
    const result = assembleWithoutThrowing(packetsWithProbedResult(probe));
    expect(result.evidence).toBeNull();
    expect(result.outcome.disposition).toBe("refused");
    expect([...declaredRefusalControls()]).toContain(result.outcome.facts.refusal_control);
    expect(JSON.stringify(result)).not.toContain(ATTACKER_FROZEN_RECEIPT);
    expect(probe.reads()).toBe(0);
    // The `[[Set]]` discriminator IS the caller's setter. Refusing after running
    // it is refusing after the reach has already happened.
    expect(probe.writes()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// FIC129-B2 — a proxy-backed contract container executes caller code too
// ---------------------------------------------------------------------------

/**
 * WHY THIS BLOCK EXISTS
 *
 * The admission path is described as reading inert data and running no caller
 * code. Its three primitives — `Object.keys`, an assignment through an
 * `Object.create` child, and a property read — are all EXOTIC-OBSERVABLE: on a
 * proxy they are `ownKeys`, `getOwnPropertyDescriptor`, `set`, and `get` traps,
 * every one of them arbitrary caller code.
 *
 * FIC-129's replay wrapped an otherwise valid result in a proxy whose `get` trap
 * answered `receipt_ref` with an attacker value. The shipped module succeeded and
 * emitted `ATTACKER-PROXY-RECEIPT` after 7 `ownKeys`, 7 `get`, 7 `set`, and 49
 * `getOwnPropertyDescriptor` trap executions. The single snapshot guarantees the
 * emitted value is the validated one; it does not make a proxy inert data, and it
 * is a SECOND caller-code path the source's narrative does not mention.
 *
 * WHAT IS REQUIRED — descriptor-safe admission must DEFINE or REFUSE a
 * proxy-backed contract container: refusal with `evidence === null`, a declared
 * control, no attacker value anywhere in the aggregate, and zero executions
 * across every trap family the admission path can reach.
 */

const ATTACKER_PROXY_RECEIPT = "ATTACKER-PROXY-RECEIPT";

interface TrapCounts {
  ownKeys: number;
  getOwnPropertyDescriptor: number;
  get: number;
  set: number;
}

interface ProxyProbe<T> {
  readonly value: T;
  counts(): TrapCounts;
  total(): number;
}

/**
 * An otherwise VALID result behind a counting proxy whose `get` trap plants an
 * attacker receipt.
 *
 * The target is a plain own-data record, so every trap forwards through
 * `Reflect` and no proxy invariant is violated: the shape is indistinguishable
 * from an honest result to anything that does not ask whether it is exotic.
 */
function withCountingProxy<T>(base: T, field: string, attacker: unknown): ProxyProbe<T> {
  const target = base as unknown as Record<string, unknown>;
  const counts: TrapCounts = { ownKeys: 0, getOwnPropertyDescriptor: 0, get: 0, set: 0 };
  const value = new Proxy(target, {
    ownKeys(subject: Record<string, unknown>): ArrayLike<string | symbol> {
      counts.ownKeys += 1;
      return Reflect.ownKeys(subject);
    },
    getOwnPropertyDescriptor(
      subject: Record<string, unknown>,
      key: string | symbol
    ): PropertyDescriptor | undefined {
      counts.getOwnPropertyDescriptor += 1;
      return Reflect.getOwnPropertyDescriptor(subject, key);
    },
    get(subject: Record<string, unknown>, key: string | symbol, receiver: unknown): unknown {
      counts.get += 1;
      if (key === field) return attacker;
      return Reflect.get(subject, key, receiver);
    },
    set(
      subject: Record<string, unknown>,
      key: string | symbol,
      next: unknown,
      receiver: unknown
    ): boolean {
      counts.set += 1;
      return Reflect.set(subject, key, next, receiver);
    },
  });
  return {
    value: value as unknown as T,
    counts: () => ({ ...counts }),
    total: () => counts.ownKeys + counts.getOwnPropertyDescriptor + counts.get + counts.set,
  };
}

describe("FIC129-B2 — a proxy-backed result is refused without executing a single trap", () => {
  it("refuses the proxy-backed result and emits no attacker receipt", () => {
    const probe = withCountingProxy(
      resultFor(CANONICAL_SCENARIO_IDS[0]),
      "receipt_ref",
      ATTACKER_PROXY_RECEIPT
    );
    const packets = packetsWith("W1/MH-02", packetWithResultAt("W1/MH-02", 0, probe.value));
    const result = assembleWithoutThrowing(packets);
    // The reviewed defect verbatim: succeeded, with the trap's chosen receipt in
    // the aggregate.
    expect(JSON.stringify(result)).not.toContain(ATTACKER_PROXY_RECEIPT);
    expect(result.evidence).toBeNull();
    expect(result.outcome.disposition).toBe("refused");
    expect([...declaredRefusalControls()]).toContain(result.outcome.facts.refusal_control);
  });

  it("executes zero ownKeys, getOwnPropertyDescriptor, get, and set traps", () => {
    const probe = withCountingProxy(
      resultFor(CANONICAL_SCENARIO_IDS[0]),
      "receipt_ref",
      ATTACKER_PROXY_RECEIPT
    );
    const packets = packetsWith("W1/MH-02", packetWithResultAt("W1/MH-02", 0, probe.value));
    assembleWithoutThrowing(packets);
    // Every one of these is arbitrary caller code running inside this module's
    // stack. "Inert data, no caller code" is a claim about all four at once.
    expect(probe.counts()).toEqual({ ownKeys: 0, getOwnPropertyDescriptor: 0, get: 0, set: 0 });
    expect(probe.total()).toBe(0);
  });
});

/**
 * FIC134-B1 (reviewer finding, `FIC-134-A21-FIC129-BLOCKERS-CORRECTION-REVIEW`).
 *
 * `decodeAssemblyRequest` re-canonicalizes the parsed graph with
 * `neutralCanonicalJson(parsed) !== request` to prove the admitted snapshot is
 * the transmitted one — but that canonicalizer recurses one stack frame per
 * nesting level with no depth guard and no catch. The reviewer's own inline
 * probe supplied canonical JSON with exactly the declared `claim`/`packets`
 * members and a nested array at `claim.x`: 1,000 deep returned a typed
 * `evidence_identity_incomplete` refusal, but 5,000 and 10,000 deep threw
 * `RangeError: Maximum call stack size exceeded` out of the production entry.
 *
 * The request text below is built by STRING REPETITION, never by calling
 * `neutralCanonicalJson` on a constructed array: encoding a 5,000/10,000-deep
 * array through that same recursive function would overflow in the test's own
 * setup, proving nothing about the production boundary. A nested-array
 * canonical form is exactly `depth` `[` characters, one scalar, then `depth`
 * `]` characters, so the text is assembled without recursion on either side.
 */
describe("FIC134-B1 — canonical-text re-canonicalization is total over adversarial depth", () => {
  /** Canonical JSON text for an array nested `depth` deep around a scalar `0`. */
  function nestedArrayText(depth: number): string {
    return `${"[".repeat(depth)}0${"]".repeat(depth)}`;
  }

  /**
   * The reviewer's exact probe shape: a canonical request declaring only
   * `claim` and `packets`, with the adversarial depth at `claim.x`.
   */
  function depthProbeRequestText(depth: number): string {
    return `{"claim":{"x":${nestedArrayText(depth)}},"packets":[]}`;
  }

  it(
    "returns a typed evidence_identity_incomplete refusal for a shallow (1,000-deep) nested-array " +
      "claim, proving the probe reaches re-canonicalization and claim validation rather than tripping " +
      "a malformed-JSON check",
    () => {
      const result = expectSafeRefusal(() => assembleRaw(depthProbeRequestText(1_000)));
      expect(result.outcome.facts.refusal_control).toBe(REFUSAL_CONTROLS.identityIncomplete);
      expect(result.outcome.facts.incomplete_field).toBe("claimant_id");
    }
  );

  it.each([5_000, 10_000])(
    "returns a typed refusal rather than throwing for a canonical-text claim nested %i deep (FIC134-B1)",
    (depth) => {
      const result = expectSafeRefusal(() => assembleRaw(depthProbeRequestText(depth)));
      expect(result.outcome.facts.refusal_control).toBe(REQUEST_TEXT_CONTROL);
    }
  );
});
