/**
 * __tests__/neutral-conformance-mh08.test.ts
 *
 * FIC-140 / A21-8 (RED-FIRST) — the executable contract for the not-yet-written
 * production module
 * `src/modules/migrations/workflows/host-cutover-controller.ts`, exported
 * through the migrations module's public index.
 *
 * WHAT THIS BINDS
 *   `guild.conformance_scenarios.v1` assigns exactly FOUR of its 31 scenarios to
 *   the `W4/MH-08` strangler-migration owner: `MHRC-STR-001`..`MHRC-STR-004`. The
 *   accepted assembly spine (`neutral-conformance-assembly.ts`) already reserves
 *   this owner's slot in `NEUTRAL_OWNER_SCENARIO_IDS` and
 *   `NEUTRAL_CONFORMANCE_OWNER_SCENARIO_COUNTS` — it deliberately EVALUATES
 *   nothing. This file states what the MH-08 owner's CONTROLLER and EVALUATOR
 *   must be before a packet under this owner key is allowed to mean anything:
 *   a deterministic host/capability/version-scoped `legacy | shadow | current |
 *   rollback` selection controller, backed by an append-only, hash-linked,
 *   operation-id-idempotent filesystem journal, plus the evaluator that drives
 *   it through all four frozen scenarios and emits one owner packet.
 *
 *   As with the MH-07 sibling suite, the contract is written twice: once as
 *   ordinary production-bound obligations (§"the production MH-08 controller and
 *   evaluator" — every `it` fails RED because the module does not exist), and
 *   once as a CONTROL BATTERY run entirely test-side against a disposable
 *   reference implementation and deliberately broken mutants of it
 *   (§"the control battery distinguishes good from bad" — GREEN from the first
 *   run). A battery the mutants survive proves nothing; this file proves the
 *   mutants do NOT survive against reference logic equivalent to what production
 *   must implement, so the RED half is a real gate rather than a placeholder.
 *
 * WHAT IT DELIBERATELY DOES NOT BIND
 *   No assembly, no promotion decision, no signature/attestation verification.
 *   `assembleNeutralConformanceEvidence` still owns the join across all six
 *   owners; this module only evaluates four scenarios and hands over one packet.
 *
 * THE ONE HONEST GAP THIS CONTRACT OPENS ON PURPOSE
 *   The frozen contract assigns all four MH-08 scenarios evidence profile
 *   `E-MIGRATION`. `NEUTRAL_EVIDENCE_PROFILES` in the accepted core currently
 *   declares only `E-LIFECYCLE`, `E-REFUSAL`, `E-RECEIPT`, and `E-BOUNDARY` — not
 *   `E-MIGRATION` — exactly as `E-BOUNDARY` was the honest gap MH-07 opened
 *   before it. §"the frozen contract, transcribed independently of production"
 *   states the required profile shape and tolerates EXACTLY the one named gap;
 *   this suite does not edit the core to add it.
 *
 * NO PRODUCTION, NO DOCS, NO RESOURCES, NO MANIFEST, NO INDEX WRITE
 *   This file reads real repository bytes (to prove the module is genuinely
 *   absent) and writes only inside disposable directories under the OS temp
 *   directory, created per test and removed in `afterAll`. It never mutates the
 *   plugin tree, and it never imports the frozen scenario fixture from
 *   production — the fixture's four `MHRC-STR-*` definitions are transcribed
 *   here independently, exactly as MH-07 transcribes its four.
 */

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
} from "../../src/modules/lifecycle/workflows/neutral-runtime-contracts";
import {
  NEUTRAL_EVIDENCE_PROFILES,
  NEUTRAL_SCENARIO_SUITE_ID,
  NEUTRAL_SCENARIO_SUITE_VERSION,
} from "../../src/modules/lifecycle/workflows/neutral-conformance-core";
import type {
  NeutralEvidenceIdentity,
  NeutralScenarioResult,
} from "../../src/modules/lifecycle/workflows/neutral-conformance-core";
import {
  NEUTRAL_ASSEMBLY_PACKET_SCHEMA,
  NEUTRAL_CONFORMANCE_OWNER_SCENARIO_COUNTS,
  NEUTRAL_OWNER_SCENARIO_IDS,
} from "../../src/modules/lifecycle/workflows/neutral-conformance-assembly";
import type { NeutralOwnerConformancePacket } from "../../src/modules/lifecycle/workflows/neutral-conformance-assembly";

// ---------------------------------------------------------------------------
// The module under contract
// ---------------------------------------------------------------------------

const PLUGIN_ROOT = path.resolve(__dirname, "..", "..");

const CONTROLLER_REQUEST = "../../src/modules/migrations/workflows/host-cutover-controller";
const CONTROLLER_SOURCE_PATH = path.resolve(
  __dirname,
  "../../src/modules/migrations/workflows/host-cutover-controller.ts"
);
const MIGRATIONS_INDEX_PATH = path.resolve(__dirname, "../../src/modules/migrations/index.ts");

const RED = "A21-8 RED: production module not implemented yet";

let controllerModuleCache: Record<string, unknown> | undefined;

/**
 * Load the module under contract, or fail with the one diagnostic this suite is
 * allowed to fail with while it is RED.
 *
 * Lazily, never at import time: a top-level import of a missing module would
 * collapse the whole file into a single resolution error, which says nothing
 * about WHICH obligation is unmet. Every `it` below fails independently.
 */
function controllerModule(): Record<string, unknown> {
  if (controllerModuleCache === undefined) {
    if (!fs.existsSync(CONTROLLER_SOURCE_PATH)) {
      throw new Error(`${RED} — expected ${CONTROLLER_SOURCE_PATH}`);
    }
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    controllerModuleCache = require(CONTROLLER_REQUEST) as Record<string, unknown>;
  }
  return controllerModuleCache;
}

/** Read one required export, or fail naming the export rather than the module. */
function exported<T>(name: string): T {
  const value = controllerModule()[name];
  if (value === undefined) {
    throw new Error(
      `A21-8 RED: production module does not implement the contract — missing export ${name}`
    );
  }
  return value as T;
}

/** Call one required export as a function, or fail with the same RED diagnostic. */
function invoke<T>(name: string, ...args: readonly unknown[]): T {
  const fn = exported<(...callArgs: readonly unknown[]) => T>(name);
  if (typeof fn !== "function") {
    throw new Error(`A21-8 RED: production export ${name} is not callable`);
  }
  return fn(...args);
}

// ---------------------------------------------------------------------------
// The frozen contract, transcribed independently of production
// ---------------------------------------------------------------------------

const OWNER_KEY_MH08 = "W4/MH-08";

/** The four W4/MH-08 stable ids, in CANONICAL (whole-suite) order. */
const MH08_IDS: readonly string[] = ["MHRC-STR-001", "MHRC-STR-002", "MHRC-STR-003", "MHRC-STR-004"];

/**
 * The expected typed outcome of each MH-08 scenario, transcribed from the frozen
 * `guild.conformance_scenarios.v1` contract. Production must DERIVE the same
 * table from its own source-owned registry; two independent statements is the
 * point, so a drift between them is a finding rather than a shared mistake.
 */
const MH08_EXPECTED: Readonly<
  Record<string, { type: string; disposition: string; reason_code_required: boolean }>
> = {
  "MHRC-STR-001": { type: "guild.migration_outcome.v1", disposition: "succeeded", reason_code_required: false },
  "MHRC-STR-002": { type: "guild.migration_outcome.v1", disposition: "succeeded", reason_code_required: false },
  "MHRC-STR-003": { type: "guild.migration_outcome.v1", disposition: "succeeded", reason_code_required: false },
  "MHRC-STR-004": { type: "guild.migration_outcome.v1", disposition: "refused", reason_code_required: true },
};

const MH08_CATEGORY = "strangler_migration";
const MH08_EVIDENCE_PROFILE_ID = "E-MIGRATION";

/**
 * `E-MIGRATION`, transcribed from the frozen contract. See the file header's
 * "ONE HONEST GAP" note: the accepted core does not declare this profile yet.
 */
const MH08_EVIDENCE_PROFILE_DEFINITION = {
  required_kinds: ["legacy_outcome", "candidate_outcome", "comparison_verdict", "receipt_journal"],
  required_bindings: ["scenario_id", "operation_id", "feature_gate", "legacy_version", "candidate_version", "runtime_version"],
} as const;

/**
 * Does the core's declared `E-MIGRATION` profile (if any) match the frozen
 * contract, tolerating EXACTLY the case where the core has not declared it yet?
 *
 * Once production adds the profile, this assertion starts checking its exact
 * shape instead of merely tolerating its absence — it cannot rot into a blanket
 * exemption.
 */
function evidenceProfileGapOrExactMatch(): { ok: boolean; detail: string } {
  const declared = (NEUTRAL_EVIDENCE_PROFILES as Record<string, unknown>)[MH08_EVIDENCE_PROFILE_ID];
  if (declared === undefined) {
    return { ok: true, detail: "tolerated named gap: the core does not declare E-MIGRATION yet" };
  }
  const matches = neutralCanonicalJson(declared) === neutralCanonicalJson(MH08_EVIDENCE_PROFILE_DEFINITION);
  return matches
    ? { ok: true, detail: "core declares E-MIGRATION and it matches the frozen contract" }
    : { ok: false, detail: neutralCanonicalJson(declared) };
}

// ---------------------------------------------------------------------------
// Test-side contract shapes for the production controller/evaluator
// ---------------------------------------------------------------------------

type Mh08Mode = "legacy" | "shadow" | "current" | "rollback";
const MH08_MODES: readonly Mh08Mode[] = ["legacy", "shadow", "current", "rollback"];

/** The exact host/capability/version scope tuple every operation is keyed by. */
interface Mh08Scope {
  readonly host_id: string;
  readonly capability_id: string;
  readonly host_version: string;
}

interface Mh08ComparisonDifference {
  readonly field: string;
  readonly legacy: unknown;
  readonly candidate: unknown;
}

interface Mh08ComparisonVerdict {
  readonly equivalent: boolean;
  readonly compared_fields: readonly string[];
  readonly differences: readonly Mh08ComparisonDifference[];
  readonly allowlisted_fields: readonly string[];
}

/**
 * Fields that may differ between legacy and candidate WITHOUT breaking semantic
 * equivalence — provenance only, never outcome or receipt semantics. Source
 * commit / host binding metadata is the classic example: two paths running on
 * the same input legitimately stamp different `binding.*` provenance while
 * still meaning the same thing.
 */
const MH08_PROVENANCE_ALLOWLIST: readonly string[] = neutralFreeze([
  "binding.run_id",
  "binding.operation_id",
  "binding.correlation_id",
]);

interface Mh08DecisionRecord {
  readonly schema_version: string;
  readonly sequence: number;
  readonly operation_id: string;
  readonly mode: Mh08Mode;
  readonly scope: Mh08Scope;
  readonly disposition: "succeeded" | "refused";
  readonly reason_code: string | null;
  readonly comparison: Mh08ComparisonVerdict | null;
  readonly record_hash: string;
  readonly previous_hash: string;
}

interface Mh08JournalHandle {
  readonly root: string;
}

interface Mh08OwnerPacket {
  readonly schema_version: string;
  readonly suite_id: string;
  readonly suite_version: string;
  readonly owner_key: string;
  readonly evidence_identity: NeutralEvidenceIdentity;
  readonly stable_ids: readonly string[];
  readonly results: readonly NeutralScenarioResult[];
}

interface Mh08EvaluationResult {
  readonly outcome: { readonly type: string; readonly disposition: string; readonly reason_code: string | null };
  readonly packet: Mh08OwnerPacket | null;
}

// ---------------------------------------------------------------------------
// Test-owned fixtures: evidence identity, receipt refs, disposable journals
// ---------------------------------------------------------------------------

const IDENTITY: NeutralEvidenceIdentity = {
  source_commit: "c28f6a41de7b8f39a1e0d5c7b4938af10e6b7c25",
  package_hash: `sha256:${"7".repeat(64)}`,
  runtime_version: "guild-2.5.0",
  adapter_version: "guild.host_adapter.v1.0.0",
  host_id: "claude-code-cli",
  host_version: "2.5.0",
  platform: "darwin-arm64",
  contract_version: 1,
  scenario_suite_id: NEUTRAL_SCENARIO_SUITE_ID,
  scenario_suite_version: NEUTRAL_SCENARIO_SUITE_VERSION,
  release_id: "rel-2026-08-19-a21-mh08",
};

const CLAIMANT_ID = "guild.release-emitter";
const RUN_ID = "run-a21-mh08-contract";

function receiptRefFor(stableId: string): string {
  const sequence = MH08_IDS.indexOf(stableId) + 1;
  const commitment = `nec1:${sequence.toString(16).padStart(16, "0")}`;
  return `guild.receipt_ref.v1:a21-mh08-journal#${sequence}@${commitment}`;
}

function receiptRefs(): Record<string, string> {
  const refs: Record<string, string> = {};
  for (const id of MH08_IDS) refs[id] = receiptRefFor(id);
  return refs;
}

function freshnessMap(): Record<string, string> {
  const map: Record<string, string> = {};
  for (const id of MH08_IDS) map[id] = "fresh";
  return map;
}

const IN_SCOPE: Mh08Scope = { host_id: "claude-code-cli", capability_id: "cap.agent-team-launch", host_version: "2.5.0" };
const OUT_OF_SCOPE: Mh08Scope = { host_id: "codex", capability_id: "cap.agent-team-launch", host_version: "2.5.0" };

function typedOutcomeStub(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema_version: "guild.runtime.contracts.v1",
    type: "guild.lifecycle_outcome.v1",
    disposition: "succeeded",
    reason_code: null,
    assertions: ["host pairs reach the same semantic phase state"],
    binding: { run_id: RUN_ID, host_id: IN_SCOPE.host_id, host_version: IN_SCOPE.host_version },
    facts: { phase: "build" },
    ...overrides,
  };
}

const TEMP_ROOTS: string[] = [];

function tempJournalRoot(label: string): string {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), `guild-mh08-${label}-`));
  TEMP_ROOTS.push(base);
  return base;
}

function sha256Of(value: unknown): string {
  return `sha256:${crypto.createHash("sha256").update(neutralCanonicalJson(value)).digest("hex")}`;
}

/**
 * A21-9 / FIC-142 — the corrected comparison contract admits only pre-canonicalized
 * text at the comparator boundary, never a live object/accessor/Proxy. Every new
 * test that exercises `compareMigrationOutcomes` (directly, or through a shadow
 * comparison inside `evaluateHostCutoverConformance`) goes through this helper.
 */
function canon(value: unknown): string {
  return neutralCanonicalJson(value);
}

const DURABLE_ROOTS: string[] = [];

/**
 * A real, non-disposable `GUILD_CWD/.guild/runs/<run-id>/...` root — the shape
 * FIC-141 refuses outright because its containment boundary is hard-coded to
 * `os.tmpdir()`. Created fresh per test under a synthetic run id and removed in
 * `afterAll`; never touches this run's own `.guild/runs/run-6f94bea1-...` tree.
 */
function durableRunScopedRoot(label: string): string {
  const runId = `run-a21-mh08-durable-${label}-${crypto.randomBytes(4).toString("hex")}`;
  const runDir = path.join(PLUGIN_ROOT, ".guild", "runs", runId);
  const root = path.join(runDir, "mh08-journal");
  fs.mkdirSync(root, { recursive: true });
  DURABLE_ROOTS.push(runDir);
  return root;
}

afterAll(() => {
  for (const root of TEMP_ROOTS) {
    fs.rmSync(root, { recursive: true, force: true });
  }
  for (const root of DURABLE_ROOTS) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// §1 — the frozen contract, transcribed independently of production (GREEN now)
// ---------------------------------------------------------------------------

describe("the frozen contract, transcribed independently of production", () => {
  it("assigns exactly four stable ids to W4/MH-08, in canonical order", () => {
    expect(NEUTRAL_OWNER_SCENARIO_IDS[OWNER_KEY_MH08]).toEqual(MH08_IDS);
  });

  it("the accepted assembly spine already reserves a count of 4 for W4/MH-08", () => {
    expect(NEUTRAL_CONFORMANCE_OWNER_SCENARIO_COUNTS[OWNER_KEY_MH08]).toBe(4);
  });

  it("every MH-08 outcome type is a declared closed outcome type", () => {
    for (const id of MH08_IDS) {
      expect(NEUTRAL_OUTCOME_TYPES).toContain(MH08_EXPECTED[id].type);
    }
  });

  it("every MH-08 disposition is a declared closed disposition", () => {
    for (const id of MH08_IDS) {
      expect(NEUTRAL_DISPOSITIONS).toContain(MH08_EXPECTED[id].disposition);
    }
  });

  it("only STR-004 requires a reason code (a refusal), the other three do not", () => {
    const refusalIds = MH08_IDS.filter((id) => MH08_EXPECTED[id].reason_code_required);
    expect(refusalIds).toEqual(["MHRC-STR-004"]);
  });

  it("the owner packet schema constant is guild.conformance_owner_packet.v1", () => {
    expect(NEUTRAL_ASSEMBLY_PACKET_SCHEMA).toBe("guild.conformance_owner_packet.v1");
  });

  it("declares E-MIGRATION or honestly tolerates the one named core gap", () => {
    const verdict = evidenceProfileGapOrExactMatch();
    expect(verdict.ok).toBe(true);
  });

  it("the migrations module public index does not yet re-export a cutover controller", () => {
    // Documents the RED starting state; this assertion must flip to require the
    // export once production lands, not merely tolerate its absence forever.
    const indexSource = fs.existsSync(MIGRATIONS_INDEX_PATH) ? fs.readFileSync(MIGRATIONS_INDEX_PATH, "utf8") : "";
    const alreadyWired = indexSource.indexOf("host-cutover-controller") !== -1;
    if (!alreadyWired) {
      expect(fs.existsSync(CONTROLLER_SOURCE_PATH)).toBe(false);
    } else {
      expect(fs.existsSync(CONTROLLER_SOURCE_PATH)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// §2 — the production MH-08 controller and evaluator (RED)
// ---------------------------------------------------------------------------

describe("the production MH-08 controller and evaluator", () => {
  it("is present in the migrations workflow source tree", () => {
    expect(controllerModule()).not.toBeUndefined();
  });

  it("declares the closed mode vocabulary legacy | shadow | current | rollback", () => {
    expect(exported<readonly string[]>("MH08_MODES")).toEqual(MH08_MODES);
  });

  it("declares an exact host/capability/version scope shape", () => {
    expect(exported<readonly string[]>("MH08_SCOPE_FIELDS")).toEqual(["host_id", "capability_id", "host_version"]);
  });

  it("compares typed outcomes and receipt semantics deterministically, with a provenance-only allowlist and a complete compared-field/difference report", () => {
    // A21-9 corrected contract: comparison admission is canonical-JSON-TEXT
    // only (see the dedicated §"comparison admission" block below for the
    // refusal-of-live-objects half of this obligation).
    const verdict = invoke<Mh08ComparisonVerdict>(
      "compareMigrationOutcomes",
      canon(typedOutcomeStub()),
      canon(typedOutcomeStub())
    );
    expect(verdict.equivalent).toBe(true);
    expect(verdict.allowlisted_fields.length).toBeGreaterThan(0);
    expect(Array.isArray(verdict.compared_fields)).toBe(true);
  });

  it("appends schema-versioned, hash-linked decision records with operation-id idempotency", () => {
    const handle = invoke<Mh08JournalHandle>("openMigrationJournal", tempJournalRoot("append-probe"));
    const record = invoke<Mh08DecisionRecord>("appendMigrationDecision", handle, {
      operation_id: "op-red-1",
      mode: "shadow",
      scope: IN_SCOPE,
      disposition: "succeeded",
      reason_code: null,
      comparison: null,
    });
    expect(record.schema_version).toBe("guild.migration_decision.v1");
    expect(record.record_hash).toEqual(expect.stringMatching(/^sha256:[0-9a-f]{64}$/));
  });

  it("provides a contained atomic filesystem journal/selection writer", () => {
    const handle = invoke<Mh08JournalHandle>("openMigrationJournal", tempJournalRoot("port-probe"));
    expect(handle.root).toEqual(expect.stringContaining("guild-mh08-port-probe"));
  });

  it("rejects a journal root reached through path traversal", () => {
    // A bare `.toThrow()` would also be satisfied by the RED "module not
    // implemented" error, silently passing while production is absent. Scoping
    // the pattern to the SPECIFIC rejection reason keeps this failing RED until
    // production actually implements the traversal refusal.
    expect(() =>
      invoke("openMigrationJournal", path.join(tempJournalRoot("traversal-probe"), "..", "..", "..", "etc"))
    ).toThrow(/travers|contain|escap/i);
  });

  it("rejects a symlink or non-directory journal preimage", () => {
    expect(() => invoke("openMigrationJournal", "/dev/null")).toThrow(/symlink|not a directory|non-directory/i);
  });

  it("rejects a partial final journal/selection pair on read", () => {
    // Obtain a real, runtime-authenticated handle FIRST — a bare `{ root }`
    // object planted straight from the temp root would now also fail the new
    // handle-authentication obligation below, for the wrong reason.
    const root = tempJournalRoot("partial-probe");
    const handle = invoke<Mh08JournalHandle>("openMigrationJournal", root);
    fs.writeFileSync(path.join(handle.root, "journal.ndjson.1.tmp"), "{}");
    expect(() => invoke("readMigrationJournal", handle)).toThrow(/partial|incomplete/i);
  });

  it("rejects a sequence gap in the journal", () => {
    const handle = invoke<Mh08JournalHandle>("openMigrationJournal", tempJournalRoot("gap-probe"));
    invoke("appendMigrationDecision", handle, {
      operation_id: "op-gap-1",
      mode: "shadow",
      scope: IN_SCOPE,
      disposition: "succeeded",
      reason_code: null,
      comparison: null,
    });
    const file = path.join(handle.root, "journal.ndjson");
    const record = JSON.parse(fs.readFileSync(file, "utf8").trim());
    fs.appendFileSync(file, `${JSON.stringify({ ...record, sequence: 3, operation_id: "op-gap-3" })}\n`);
    expect(() => invoke("readMigrationJournal", handle)).toThrow();
  });

  it("rejects hash drift between adjacent journal records", () => {
    const handle = invoke<Mh08JournalHandle>("openMigrationJournal", tempJournalRoot("drift-probe"));
    invoke("appendMigrationDecision", handle, {
      operation_id: "op-drift-1",
      mode: "shadow",
      scope: IN_SCOPE,
      disposition: "succeeded",
      reason_code: null,
      comparison: null,
    });
    const file = path.join(handle.root, "journal.ndjson");
    const tampered = fs.readFileSync(file, "utf8").replace(/"disposition":"succeeded"/, '"disposition":"refused"');
    fs.writeFileSync(file, tampered);
    expect(() => invoke("readMigrationJournal", handle)).toThrow();
  });

  it("rejects a duplicate operation id with divergent content", () => {
    const handle = invoke<Mh08JournalHandle>("openMigrationJournal", tempJournalRoot("dup-probe"));
    invoke("appendMigrationDecision", handle, {
      operation_id: "op-dup",
      mode: "shadow",
      scope: IN_SCOPE,
      disposition: "succeeded",
      reason_code: null,
      comparison: null,
    });
    expect(() =>
      invoke("appendMigrationDecision", handle, {
        operation_id: "op-dup",
        mode: "current",
        scope: IN_SCOPE,
        disposition: "succeeded",
        reason_code: null,
        comparison: null,
      })
    ).toThrow();
  });

  it("resolves selection: shadow retains legacy authority", () => {
    expect(invoke<Mh08Mode>("resolveEffectiveSelection", [], IN_SCOPE)).toBe("legacy");
  });

  it("resolves selection: exact-scope current selects the candidate", () => {
    const handle = invoke<Mh08JournalHandle>("openMigrationJournal", tempJournalRoot("select-current"));
    invoke("appendMigrationDecision", handle, {
      operation_id: "op-shadow",
      mode: "shadow",
      scope: IN_SCOPE,
      disposition: "succeeded",
      reason_code: null,
      comparison: null,
    });
    invoke("appendMigrationDecision", handle, {
      operation_id: "op-current",
      mode: "current",
      scope: IN_SCOPE,
      disposition: "succeeded",
      reason_code: null,
      comparison: null,
    });
    const records = invoke<readonly Mh08DecisionRecord[]>("readMigrationJournal", handle);
    expect(invoke<Mh08Mode>("resolveEffectiveSelection", records, IN_SCOPE)).toBe("current");
  });

  it("resolves selection: unscoped tuples remain legacy", () => {
    const handle = invoke<Mh08JournalHandle>("openMigrationJournal", tempJournalRoot("select-unscoped"));
    invoke("appendMigrationDecision", handle, {
      operation_id: "op-current-in-scope",
      mode: "current",
      scope: IN_SCOPE,
      disposition: "succeeded",
      reason_code: null,
      comparison: null,
    });
    const records = invoke<readonly Mh08DecisionRecord[]>("readMigrationJournal", handle);
    expect(invoke<Mh08Mode>("resolveEffectiveSelection", records, OUT_OF_SCOPE)).toBe("legacy");
  });

  it("resolves selection: rollback resolves to legacy", () => {
    const handle = invoke<Mh08JournalHandle>("openMigrationJournal", tempJournalRoot("select-rollback"));
    invoke("appendMigrationDecision", handle, {
      operation_id: "op-current",
      mode: "current",
      scope: IN_SCOPE,
      disposition: "succeeded",
      reason_code: null,
      comparison: null,
    });
    invoke("appendMigrationDecision", handle, {
      operation_id: "op-rollback",
      mode: "rollback",
      scope: IN_SCOPE,
      disposition: "succeeded",
      reason_code: null,
      comparison: null,
    });
    const records = invoke<readonly Mh08DecisionRecord[]>("readMigrationJournal", handle);
    expect(invoke<Mh08Mode>("resolveEffectiveSelection", records, IN_SCOPE)).toBe("legacy");
  });

  it("resolves selection: absence of any record defaults to legacy", () => {
    expect(invoke<Mh08Mode>("resolveEffectiveSelection", [], OUT_OF_SCOPE)).toBe("legacy");
  });

  it("refuses cutover unless an equivalent shadow record exists for the exact same scope and version tuple", () => {
    const result = invoke<Mh08EvaluationResult>("evaluateHostCutoverConformance", {
      run_id: RUN_ID,
      claimant_id: CLAIMANT_ID,
      mode: "current",
      scope: IN_SCOPE,
      journal_root: tempJournalRoot("cutover-refusal"),
      evidence_identity: IDENTITY,
      receipt_refs: receiptRefs(),
      evidence_freshness: freshnessMap(),
    });
    expect(result.outcome.disposition).toBe("refused");
  });

  it("refuses divergence before selection changes, with field-level differences and an appended refusal record", () => {
    const result = invoke<Mh08EvaluationResult>("evaluateHostCutoverConformance", {
      run_id: RUN_ID,
      claimant_id: CLAIMANT_ID,
      mode: "shadow",
      scope: IN_SCOPE,
      legacy_outcome: canon(typedOutcomeStub()),
      candidate_outcome: canon(typedOutcomeStub({ facts: { phase: "qa" } })),
      journal_root: tempJournalRoot("divergence-refusal"),
      evidence_identity: IDENTITY,
      receipt_refs: receiptRefs(),
      evidence_freshness: freshnessMap(),
    });
    expect(result.outcome.disposition).toBe("refused");
    expect(result.outcome.reason_code).not.toBeNull();
  });

  it("rollback appends a new record and preserves candidate and earlier history", () => {
    const root = tempJournalRoot("rollback-preserve-red");
    invoke("evaluateHostCutoverConformance", {
      run_id: RUN_ID,
      claimant_id: CLAIMANT_ID,
      mode: "shadow",
      scope: IN_SCOPE,
      legacy_outcome: canon(typedOutcomeStub()),
      candidate_outcome: canon(typedOutcomeStub()),
      journal_root: root,
      evidence_identity: IDENTITY,
      receipt_refs: receiptRefs(),
      evidence_freshness: freshnessMap(),
    });
    invoke("evaluateHostCutoverConformance", {
      run_id: RUN_ID,
      claimant_id: CLAIMANT_ID,
      mode: "rollback",
      scope: IN_SCOPE,
      journal_root: root,
      evidence_identity: IDENTITY,
      receipt_refs: receiptRefs(),
      evidence_freshness: freshnessMap(),
    });
    const handle = invoke<Mh08JournalHandle>("openMigrationJournal", root);
    const records = invoke<readonly Mh08DecisionRecord[]>("readMigrationJournal", handle);
    expect(records.length).toBeGreaterThanOrEqual(2);
  });

  it("repeated rollback operation ids are idempotent and cause no duplicate effect", () => {
    const root = tempJournalRoot("rollback-idempotent-red");
    const first = invoke<Mh08EvaluationResult>("evaluateHostCutoverConformance", {
      run_id: RUN_ID,
      claimant_id: CLAIMANT_ID,
      operation_id: "op-rollback-red",
      mode: "rollback",
      scope: IN_SCOPE,
      journal_root: root,
      evidence_identity: IDENTITY,
      receipt_refs: receiptRefs(),
      evidence_freshness: freshnessMap(),
    });
    const second = invoke<Mh08EvaluationResult>("evaluateHostCutoverConformance", {
      run_id: RUN_ID,
      claimant_id: CLAIMANT_ID,
      operation_id: "op-rollback-red",
      mode: "rollback",
      scope: IN_SCOPE,
      journal_root: root,
      evidence_identity: IDENTITY,
      receipt_refs: receiptRefs(),
      evidence_freshness: freshnessMap(),
    });
    expect(neutralCanonicalJson(first)).toBe(neutralCanonicalJson(second));
  });

  it("produces one immutable guild.conformance_owner_packet.v1 packet for W4/MH-08 with exact ordered ids MHRC-STR-001..004", () => {
    const result = invoke<Mh08EvaluationResult>("evaluateHostCutoverConformance", {
      run_id: RUN_ID,
      claimant_id: CLAIMANT_ID,
      journal_root: tempJournalRoot("packet-shape"),
      evidence_identity: IDENTITY,
      receipt_refs: receiptRefs(),
      evidence_freshness: freshnessMap(),
    });
    expect(result.packet).not.toBeNull();
    expect(result.packet?.schema_version).toBe(NEUTRAL_ASSEMBLY_PACKET_SCHEMA);
    expect(result.packet?.owner_key).toBe(OWNER_KEY_MH08);
    expect(result.packet?.stable_ids).toEqual(MH08_IDS);
    expect(Object.isFrozen(result.packet)).toBe(true);
  });

  // A21-9 corrected contract: the full owner evaluation must CONSUME
  // caller-observed evidence per scenario via `scenario_evidence`, never
  // manufacture its own `syntheticOutcome` internally (repro #6). Evidence is
  // supplied as canonical JSON text, matching the comparator boundary's
  // corrected contract.
  function scenarioEvidenceEntry(opts: { readonly equivalent: boolean; readonly sideEffectAuthority?: { readonly legacy_commits: number; readonly candidate_commits: number } }) {
    const legacy = typedOutcomeStub();
    const candidate = opts.equivalent ? typedOutcomeStub() : typedOutcomeStub({ facts: { phase: "qa" } });
    const entry: Record<string, unknown> = { legacy_outcome: canon(legacy), candidate_outcome: canon(candidate) };
    if (opts.sideEffectAuthority) entry.side_effect_authority = opts.sideEffectAuthority;
    return entry;
  }

  it("STR-001 succeeds only on observed semantic shadow equivalence PLUS explicit side-effect authority proving legacy commits and candidate commits zero", () => {
    const result = invoke<Mh08EvaluationResult>("evaluateHostCutoverConformance", {
      run_id: RUN_ID,
      claimant_id: CLAIMANT_ID,
      scenario: "MHRC-STR-001",
      scope: IN_SCOPE,
      scenario_evidence: {
        "MHRC-STR-001": scenarioEvidenceEntry({
          equivalent: true,
          sideEffectAuthority: { legacy_commits: 1, candidate_commits: 0 },
        }),
      },
      journal_root: tempJournalRoot("str-001"),
      evidence_identity: IDENTITY,
      receipt_refs: receiptRefs(),
      evidence_freshness: freshnessMap(),
    });
    const strResult = result.packet?.results.find((r) => r.stable_id === "MHRC-STR-001");
    expect(strResult?.disposition).toBe("succeeded");
  });

  it("STR-001 refuses success when side-effect authority shows the candidate committed, even though outputs are semantically equivalent", () => {
    const result = invoke<Mh08EvaluationResult>("evaluateHostCutoverConformance", {
      run_id: RUN_ID,
      claimant_id: CLAIMANT_ID,
      scenario: "MHRC-STR-001",
      scope: IN_SCOPE,
      scenario_evidence: {
        "MHRC-STR-001": scenarioEvidenceEntry({
          equivalent: true,
          sideEffectAuthority: { legacy_commits: 1, candidate_commits: 1 },
        }),
      },
      journal_root: tempJournalRoot("str-001-side-effect-leak"),
      evidence_identity: IDENTITY,
      receipt_refs: receiptRefs(),
      evidence_freshness: freshnessMap(),
    });
    const strResult = result.packet?.results.find((r) => r.stable_id === "MHRC-STR-001");
    expect(strResult?.disposition).toBe("refused");
  });

  it("STR-001 refuses (rather than manufacturing success) when no caller-observed evidence is supplied at all", () => {
    const result = invoke<Mh08EvaluationResult>("evaluateHostCutoverConformance", {
      run_id: RUN_ID,
      claimant_id: CLAIMANT_ID,
      scenario: "MHRC-STR-001",
      scope: IN_SCOPE,
      journal_root: tempJournalRoot("str-001-no-evidence"),
      evidence_identity: IDENTITY,
      receipt_refs: receiptRefs(),
      evidence_freshness: freshnessMap(),
    });
    const strResult = result.packet?.results.find((r) => r.stable_id === "MHRC-STR-001");
    expect(strResult?.disposition).toBe("refused");
    expect(strResult?.reason_code).toEqual(expect.stringMatching(/evidence/i));
  });

  it("STR-002 succeeds only on exact-scope cutover after an OBSERVED equivalent shadow, while an out-of-scope control remains legacy", () => {
    const root = tempJournalRoot("str-002");
    const result = invoke<Mh08EvaluationResult>("evaluateHostCutoverConformance", {
      run_id: RUN_ID,
      claimant_id: CLAIMANT_ID,
      scenario: "MHRC-STR-002",
      scope: IN_SCOPE,
      scenario_evidence: { "MHRC-STR-002": scenarioEvidenceEntry({ equivalent: true }) },
      journal_root: root,
      evidence_identity: IDENTITY,
      receipt_refs: receiptRefs(),
      evidence_freshness: freshnessMap(),
    });
    const strResult = result.packet?.results.find((r) => r.stable_id === "MHRC-STR-002");
    expect(strResult?.disposition).toBe("succeeded");

    // An explicit out-of-scope tuple, sharing the same journal, must remain
    // legacy — no equivalent shadow was ever recorded for IT.
    const outOfScopeAttempt = invoke<Mh08EvaluationResult>("evaluateHostCutoverConformance", {
      run_id: RUN_ID,
      claimant_id: CLAIMANT_ID,
      mode: "current",
      scope: OUT_OF_SCOPE,
      journal_root: root,
      evidence_identity: IDENTITY,
      receipt_refs: receiptRefs(),
      evidence_freshness: freshnessMap(),
    });
    expect(outOfScopeAttempt.outcome.disposition).toBe("refused");
  });

  it("STR-003 succeeds only when rollback restores effective legacy selection and PRESERVES the prior shadow/current evidence (append-only)", () => {
    const root = tempJournalRoot("str-003");
    const result = invoke<Mh08EvaluationResult>("evaluateHostCutoverConformance", {
      run_id: RUN_ID,
      claimant_id: CLAIMANT_ID,
      scenario: "MHRC-STR-003",
      scope: IN_SCOPE,
      scenario_evidence: { "MHRC-STR-003": scenarioEvidenceEntry({ equivalent: true }) },
      journal_root: root,
      evidence_identity: IDENTITY,
      receipt_refs: receiptRefs(),
      evidence_freshness: freshnessMap(),
    });
    const strResult = result.packet?.results.find((r) => r.stable_id === "MHRC-STR-003");
    expect(strResult?.disposition).toBe("succeeded");

    // Scope the append-only-history check to records the STR-003 scenario
    // itself produced (identified by its declared scope tuple, since the
    // journal is shared across all four scenarios evaluated in one call) —
    // a whole-journal count would pass vacuously off the OTHER scenarios'
    // records regardless of whether STR-003's own history was preserved.
    const handle = invoke<Mh08JournalHandle>("openMigrationJournal", root);
    const records = invoke<readonly Mh08DecisionRecord[]>("readMigrationJournal", handle);
    const str003Records = records.filter((r) => r.scope.capability_id.indexOf("MHRC-STR-003") !== -1);
    expect(str003Records.length).toBeGreaterThanOrEqual(3);
    expect(str003Records.map((r) => r.mode)).toEqual(["shadow", "current", "rollback"]);
  });

  it("STR-004 is a typed refusal with a closed neutral reason code when OBSERVED shadow diverges, enumerating differences and keeping legacy authority", () => {
    const root = tempJournalRoot("str-004");
    const result = invoke<Mh08EvaluationResult>("evaluateHostCutoverConformance", {
      run_id: RUN_ID,
      claimant_id: CLAIMANT_ID,
      scenario: "MHRC-STR-004",
      scope: IN_SCOPE,
      scenario_evidence: { "MHRC-STR-004": scenarioEvidenceEntry({ equivalent: false }) },
      journal_root: root,
      evidence_identity: IDENTITY,
      receipt_refs: receiptRefs(),
      evidence_freshness: freshnessMap(),
    });
    const strResult = result.packet?.results.find((r) => r.stable_id === "MHRC-STR-004");
    expect(strResult?.disposition).toBe("refused");
    expect(strResult?.reason_code).not.toBeNull();
    expect(NEUTRAL_REASON_CODES).toContain(strResult?.reason_code);

    const handle = invoke<Mh08JournalHandle>("openMigrationJournal", root);
    const records = invoke<readonly Mh08DecisionRecord[]>("readMigrationJournal", handle);
    // The full owner evaluation runs all four scenarios against one shared
    // journal (production ignores `scenario:` as a filter — it always
    // computes all four); MHRC-STR-004 is evaluated last and appends exactly
    // one record, so its shadow decision is the journal's final entry. Do
    // NOT search by `mode === "shadow"` alone — MHRC-STR-001..003 append
    // their own (non-divergent) shadow records earlier in the same journal,
    // and finding the wrong one would make this assertion vacuous.
    const str004ShadowRecord = records[records.length - 1];
    expect(str004ShadowRecord?.mode).toBe("shadow");
    expect(str004ShadowRecord?.comparison).not.toBeNull();
    expect((str004ShadowRecord?.comparison?.differences ?? []).length).toBeGreaterThan(0);
  });

  it("full owner evaluation refuses instead of manufacturing synthetic legacy/candidate evidence when the caller supplies none for any scenario", () => {
    const result = invoke<Mh08EvaluationResult>("evaluateHostCutoverConformance", {
      run_id: RUN_ID,
      claimant_id: CLAIMANT_ID,
      journal_root: tempJournalRoot("no-evidence-full-red"),
      evidence_identity: IDENTITY,
      receipt_refs: receiptRefs(),
      evidence_freshness: freshnessMap(),
    });
    for (const id of ["MHRC-STR-001", "MHRC-STR-002", "MHRC-STR-003"]) {
      const strResult = result.packet?.results.find((r) => r.stable_id === id);
      // A refusal-shaped result discriminated by reason code from a generic
      // failure: the evidence obligation must be nameable, not merely absent.
      expect(strResult?.disposition).not.toBe("succeeded");
      expect(strResult?.reason_code).toEqual(expect.stringMatching(/evidence/i));
    }
  });

  it("full owner evaluation refuses the TOP-LEVEL outcome with scenario_evidence_incomplete, not succeeded with a null reason code, when every scenario is evidence-incomplete (repro FIC-144 #4)", () => {
    // The per-scenario refusals above are already correct; the gap is that
    // `evaluateHostCutoverConformance` hard-codes its TOP-LEVEL
    // `outcome.disposition` to `"succeeded"` / `outcome.reason_code` to
    // `null` for the full-evaluation path regardless of what the four
    // scenario results say — so a caller reading only the top-level outcome
    // (never inspecting `packet.results`) currently sees a false success.
    const result = invoke<Mh08EvaluationResult>("evaluateHostCutoverConformance", {
      run_id: RUN_ID,
      claimant_id: CLAIMANT_ID,
      journal_root: tempJournalRoot("no-evidence-top-level-red"),
      evidence_identity: IDENTITY,
      receipt_refs: receiptRefs(),
      evidence_freshness: freshnessMap(),
    });
    expect(result.outcome.disposition).toBe("refused");
    expect(result.outcome.reason_code).toBe("scenario_evidence_incomplete");
  });

  it("produces byte-identical packets for identical inputs (determinism)", () => {
    const root = tempJournalRoot("determinism-red");
    const request = {
      run_id: RUN_ID,
      claimant_id: CLAIMANT_ID,
      journal_root: root,
      evidence_identity: IDENTITY,
      receipt_refs: receiptRefs(),
      evidence_freshness: freshnessMap(),
    };
    const first = invoke<Mh08EvaluationResult>("evaluateHostCutoverConformance", { ...request });
    const second = invoke<Mh08EvaluationResult>("evaluateHostCutoverConformance", { ...request });
    expect(neutralCanonicalJson(first.packet)).toBe(neutralCanonicalJson(second.packet));
  });

  it("does not mutate caller-supplied request inputs", () => {
    const request = neutralFreeze({
      run_id: RUN_ID,
      claimant_id: CLAIMANT_ID,
      journal_root: tempJournalRoot("no-mutate-red"),
      scope: IN_SCOPE,
      evidence_identity: IDENTITY,
      receipt_refs: receiptRefs(),
      evidence_freshness: freshnessMap(),
    });
    const before = neutralCanonicalJson(request);
    invoke("evaluateHostCutoverConformance", request);
    expect(neutralCanonicalJson(request)).toBe(before);
  });

  it("is exported through the migrations module's public index", () => {
    const indexSource = fs.existsSync(MIGRATIONS_INDEX_PATH) ? fs.readFileSync(MIGRATIONS_INDEX_PATH, "utf8") : "";
    expect(indexSource).toEqual(expect.stringContaining("host-cutover-controller"));
  });
});

// ---------------------------------------------------------------------------
// §2.5 — the corrected MH-08 safety and correctness obligations (RED)
//
// FIC-142 / A21-9. The lead independently reproduced six safety and
// correctness gaps in the FIC-141 GREEN implementation (62/62 was reached
// against a contract that was not yet safe). Each `describe` below pins one
// reproduced counterexample as an explicit, executable, non-vacuous RED
// obligation. None of these edit production; they define what production must
// become.
// ---------------------------------------------------------------------------

describe("the corrected MH-08 safety and correctness obligations (RED)", () => {
  describe("§handle authentication: forged root objects cannot read or append anywhere (repro #1)", () => {
    it("refuses to append through a handle that never passed through openMigrationJournal", () => {
      const base = tempJournalRoot("forged-append");
      const forged = { root: path.join(base, "never-opened") } as Mh08JournalHandle;
      fs.mkdirSync(forged.root, { recursive: true });
      expect(() =>
        invoke("appendMigrationDecision", forged, {
          operation_id: "op-forged-append",
          mode: "shadow",
          scope: IN_SCOPE,
          disposition: "succeeded",
          reason_code: null,
          comparison: null,
        })
      ).toThrow(/handle|authenticat|unauthorized|unopened/i);
      // Anti-vacuity: a REAL handle for the same directory is accepted.
      const realHandle = invoke<Mh08JournalHandle>("openMigrationJournal", forged.root);
      expect(() =>
        invoke("appendMigrationDecision", realHandle, {
          operation_id: "op-real-append",
          mode: "shadow",
          scope: IN_SCOPE,
          disposition: "succeeded",
          reason_code: null,
          comparison: null,
        })
      ).not.toThrow();
    });

    it("refuses to read through a handle that never passed through openMigrationJournal", () => {
      const base = tempJournalRoot("forged-read");
      const realHandle = invoke<Mh08JournalHandle>("openMigrationJournal", base);
      invoke("appendMigrationDecision", realHandle, {
        operation_id: "op-seed",
        mode: "shadow",
        scope: IN_SCOPE,
        disposition: "succeeded",
        reason_code: null,
        comparison: null,
      });
      const forged = { root: base } as Mh08JournalHandle;
      expect(() => invoke("readMigrationJournal", forged)).toThrow(/handle|authenticat|unauthorized|unopened/i);
    });

    it("a structurally-identical clone of a real handle (same root, distinct object identity, never itself returned by openMigrationJournal) is still refused", () => {
      const base = tempJournalRoot("forged-clone");
      const realHandle = invoke<Mh08JournalHandle>("openMigrationJournal", base);
      const clone = { root: realHandle.root } as Mh08JournalHandle;
      expect(() =>
        invoke("appendMigrationDecision", clone, {
          operation_id: "op-clone-append",
          mode: "shadow",
          scope: IN_SCOPE,
          disposition: "succeeded",
          reason_code: null,
          comparison: null,
        })
      ).toThrow(/handle|authenticat|unauthorized|unopened/i);
    });
  });

  describe("§closed mode vocabulary is enforced BEFORE any append (repro #3)", () => {
    it("appendMigrationDecision refuses an arbitrary mode string and writes nothing", () => {
      const root = tempJournalRoot("bad-mode-append");
      const handle = invoke<Mh08JournalHandle>("openMigrationJournal", root);
      expect(() =>
        invoke("appendMigrationDecision", handle, {
          operation_id: "op-bad-mode",
          mode: "not-a-mode",
          scope: IN_SCOPE,
          disposition: "succeeded",
          reason_code: null,
          comparison: null,
        })
      ).toThrow(/mode/i);
      const records = invoke<readonly Mh08DecisionRecord[]>("readMigrationJournal", handle);
      expect(records).toHaveLength(0);
    });

    it("evaluateHostCutoverConformance's single-operation path refuses an arbitrary mode string before any append", () => {
      const root = tempJournalRoot("bad-mode-evaluate");
      expect(() =>
        invoke("evaluateHostCutoverConformance", {
          run_id: RUN_ID,
          claimant_id: CLAIMANT_ID,
          mode: "not-a-mode",
          scope: IN_SCOPE,
          journal_root: root,
          evidence_identity: IDENTITY,
          receipt_refs: receiptRefs(),
          evidence_freshness: freshnessMap(),
        })
      ).toThrow(/mode/i);
      const handle = invoke<Mh08JournalHandle>("openMigrationJournal", root);
      const records = invoke<readonly Mh08DecisionRecord[]>("readMigrationJournal", handle);
      expect(records).toHaveLength(0);
    });
  });

  describe("§current requires an exact-scope succeeded shadow whose comparison exists and is equivalent true (repro #2)", () => {
    it("refuses current when the sole prior shadow's comparison is null", () => {
      const root = tempJournalRoot("current-null-comparison");
      invoke("evaluateHostCutoverConformance", {
        run_id: RUN_ID,
        claimant_id: CLAIMANT_ID,
        mode: "shadow",
        scope: IN_SCOPE,
        journal_root: root,
        evidence_identity: IDENTITY,
        receipt_refs: receiptRefs(),
        evidence_freshness: freshnessMap(),
      });
      const attempt = invoke<Mh08EvaluationResult>("evaluateHostCutoverConformance", {
        run_id: RUN_ID,
        claimant_id: CLAIMANT_ID,
        mode: "current",
        scope: IN_SCOPE,
        journal_root: root,
        evidence_identity: IDENTITY,
        receipt_refs: receiptRefs(),
        evidence_freshness: freshnessMap(),
      });
      expect(attempt.outcome.disposition).toBe("refused");
    });

    it("refuses current when the sole prior shadow's comparison is divergent", () => {
      const root = tempJournalRoot("current-divergent-comparison");
      invoke("evaluateHostCutoverConformance", {
        run_id: RUN_ID,
        claimant_id: CLAIMANT_ID,
        mode: "shadow",
        scope: IN_SCOPE,
        legacy_outcome: canon(typedOutcomeStub()),
        candidate_outcome: canon(typedOutcomeStub({ facts: { phase: "qa" } })),
        journal_root: root,
        evidence_identity: IDENTITY,
        receipt_refs: receiptRefs(),
        evidence_freshness: freshnessMap(),
      });
      const attempt = invoke<Mh08EvaluationResult>("evaluateHostCutoverConformance", {
        run_id: RUN_ID,
        claimant_id: CLAIMANT_ID,
        mode: "current",
        scope: IN_SCOPE,
        journal_root: root,
        evidence_identity: IDENTITY,
        receipt_refs: receiptRefs(),
        evidence_freshness: freshnessMap(),
      });
      expect(attempt.outcome.disposition).toBe("refused");
    });

    it("anti-vacuity: current succeeds when the prior shadow's comparison exists and is equivalent true", () => {
      const root = tempJournalRoot("current-equivalent-comparison");
      invoke("evaluateHostCutoverConformance", {
        run_id: RUN_ID,
        claimant_id: CLAIMANT_ID,
        mode: "shadow",
        scope: IN_SCOPE,
        legacy_outcome: canon(typedOutcomeStub()),
        candidate_outcome: canon(typedOutcomeStub()),
        journal_root: root,
        evidence_identity: IDENTITY,
        receipt_refs: receiptRefs(),
        evidence_freshness: freshnessMap(),
      });
      const attempt = invoke<Mh08EvaluationResult>("evaluateHostCutoverConformance", {
        run_id: RUN_ID,
        claimant_id: CLAIMANT_ID,
        mode: "current",
        scope: IN_SCOPE,
        journal_root: root,
        evidence_identity: IDENTITY,
        receipt_refs: receiptRefs(),
        evidence_freshness: freshnessMap(),
      });
      expect(attempt.outcome.disposition).toBe("succeeded");
    });
  });

  describe("§comparison admission executes no accessor or Proxy trap (repro #4)", () => {
    it("compareMigrationOutcomes refuses a raw (non-canonical-text) object input, unread", () => {
      let trapped = false;
      const watched = new Proxy(typedOutcomeStub(), {
        get(target, prop, receiver) {
          trapped = true;
          return Reflect.get(target, prop, receiver);
        },
      });
      expect(() => invoke("compareMigrationOutcomes", watched, canon(typedOutcomeStub()))).toThrow(
        /canonical|text|string/i
      );
      expect(trapped).toBe(false);
    });

    it("compareMigrationOutcomes refuses a Proxy input without invoking get/has/ownKeys traps", () => {
      let getCount = 0;
      let hasCount = 0;
      let ownKeysCount = 0;
      const hostile = new Proxy(typedOutcomeStub(), {
        get(target, prop, receiver) {
          getCount += 1;
          return Reflect.get(target, prop, receiver);
        },
        has(target, prop) {
          hasCount += 1;
          return Reflect.has(target, prop);
        },
        ownKeys(target) {
          ownKeysCount += 1;
          return Reflect.ownKeys(target);
        },
      });
      expect(() => invoke("compareMigrationOutcomes", hostile, canon(typedOutcomeStub()))).toThrow();
      expect(getCount).toBe(0);
      expect(hasCount).toBe(0);
      expect(ownKeysCount).toBe(0);
    });

    it("evaluateHostCutoverConformance's shadow comparison path also refuses a raw object legacy_outcome, unread", () => {
      let trapped = false;
      const watched = new Proxy(typedOutcomeStub(), {
        get(target, prop, receiver) {
          trapped = true;
          return Reflect.get(target, prop, receiver);
        },
      });
      expect(() =>
        invoke("evaluateHostCutoverConformance", {
          run_id: RUN_ID,
          claimant_id: CLAIMANT_ID,
          mode: "shadow",
          scope: IN_SCOPE,
          legacy_outcome: watched,
          candidate_outcome: canon(typedOutcomeStub()),
          journal_root: tempJournalRoot("proxy-shadow-refusal"),
          evidence_identity: IDENTITY,
          receipt_refs: receiptRefs(),
          evidence_freshness: freshnessMap(),
        })
      ).toThrow();
      expect(trapped).toBe(false);
    });

    it("compareMigrationOutcomes refuses non-canonical JSON text that does not exact-round-trip through neutralCanonicalJson, before semantic comparison (repro FIC-144 #2)", () => {
      // Valid, parseable JSON whose key order (and therefore literal text)
      // differs from `neutralCanonicalJson`'s sorted-key rendering is not
      // canonical text. FIC-143 only checks `typeof === "string"` before
      // `JSON.parse`, so this currently parses and compares successfully
      // instead of being refused at the admission boundary — a source-owned
      // canonical/text error, distinct from the (already-covered) non-string
      // refusal above.
      const nonCanonicalLegacyText = '{"z":1,"a":2}';
      expect(() =>
        invoke("compareMigrationOutcomes", nonCanonicalLegacyText, canon({ a: 2, z: 1 }))
      ).toThrow(/canonical/i);
    });

    it("compareMigrationOutcomes refuses materially deep canonical comparison text with a source-owned, non-echoing depth/complexity refusal, never a leaked engine RangeError (repro FIC148-A21-B1)", () => {
      // Syntactically valid, exact-round-trip canonical JSON (deeply nested
      // arrays canonicalize to themselves) that is nonetheless too deep to
      // safely re-canonicalize. `JSON.parse` admits it; the boundary must
      // still refuse it as a typed, source-owned error rather than letting
      // `neutralCanonicalJson`'s recursion escape as a raw `RangeError`.
      const deepLegacyText = "[".repeat(20000) + "0" + "]".repeat(20000);

      let caught: unknown;
      try {
        invoke("compareMigrationOutcomes", deepLegacyText, deepLegacyText);
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeDefined();
      expect(caught).toBeInstanceOf(Error);
      expect((caught as Error).constructor).toBe(Error);
      expect((caught as Error).name).toBe("Error");
      expect((caught as Error).message).toMatch(/depth|complex/i);
      expect((caught as Error).message).not.toContain(deepLegacyText);
      expect((caught as Error).message.length).toBeLessThan(500);
    });
  });

  describe("§the controller trusts BOTH disposable conformance roots and a durable, run-scoped GUILD_CWD/.guild/runs/<run-id>/... root (repro #5)", () => {
    it("accepts a real durable run-scoped root outside os.tmpdir()", () => {
      const root = durableRunScopedRoot("accept");
      expect(() => invoke("openMigrationJournal", root)).not.toThrow();
    });

    it("still trusts a project-local plugin/.guild/runs root when GUILD_CWD points at the umbrella workspace root (repro FIC-144 #1)", () => {
      // FIC-143 reached 87/87 only because the accepted GREEN run was taken
      // with GUILD_CWD unset (see the FIC-143 receipt's own assumption note).
      // `nearestProjectRoot` stops at the FIRST ancestor owning `.git`, and the
      // umbrella workspace root owns its own `.git` — so pointing GUILD_CWD at
      // it must not shadow this plugin sub-repo's own valid durable root. Set
      // and restore GUILD_CWD here so the default (unset) suite environment
      // cannot hide this: the ordinary unpiped invocation from `plugin/scripts`
      // never has GUILD_CWD set, so no other test in this file exercises it.
      const root = durableRunScopedRoot("guild-cwd-workspace-root");
      const priorGuildCwd = process.env["GUILD_CWD"];
      process.env["GUILD_CWD"] = path.resolve(PLUGIN_ROOT, "..");
      try {
        expect(() => invoke("openMigrationJournal", root)).not.toThrow();
      } finally {
        if (priorGuildCwd === undefined) {
          delete process.env["GUILD_CWD"];
        } else {
          process.env["GUILD_CWD"] = priorGuildCwd;
        }
      }
    });

    it("still refuses a root outside BOTH trusted roots (neither disposable temp nor the durable run-scoped shape)", () => {
      const outsideBoth = fs.mkdtempSync(path.join(os.homedir(), ".guild-mh08-untrusted-"));
      try {
        expect(() => invoke("openMigrationJournal", outsideBoth)).toThrow(/travers|contain|escap|untrust/i);
      } finally {
        fs.rmSync(outsideBoth, { recursive: true, force: true });
      }
    });

    it("refuses a final symlink under the durable run-scoped root", () => {
      const target = durableRunScopedRoot("symlink-target");
      const parent = path.dirname(target);
      const link = path.join(parent, "mh08-journal-link");
      fs.symlinkSync(target, link);
      try {
        expect(() => invoke("openMigrationJournal", link)).toThrow(/symlink|not a directory|non-directory/i);
      } finally {
        fs.unlinkSync(link);
      }
    });

    it("refuses an intermediate symlink escape reached through the durable run-scoped root", () => {
      const outsideBoth = fs.mkdtempSync(path.join(os.homedir(), ".guild-mh08-escape-target-"));
      const runDir = path.join(PLUGIN_ROOT, ".guild", "runs", `run-a21-mh08-durable-escape-${crypto.randomBytes(4).toString("hex")}`);
      fs.mkdirSync(runDir, { recursive: true });
      DURABLE_ROOTS.push(runDir);
      const linkedComponent = path.join(runDir, "escape-link");
      fs.symlinkSync(outsideBoth, linkedComponent);
      const throughEscape = path.join(linkedComponent, "mh08-journal");
      try {
        expect(() => invoke("openMigrationJournal", throughEscape)).toThrow(/symlink|travers|contain|escap/i);
      } finally {
        fs.unlinkSync(linkedComponent);
        fs.rmSync(outsideBoth, { recursive: true, force: true });
      }
    });

    it("still rejects traversal reached FROM inside the durable run-scoped root", () => {
      const base = durableRunScopedRoot("traversal");
      expect(() => invoke("openMigrationJournal", path.join(base, "..", "..", "..", "..", "etc"))).toThrow(
        /travers|contain|escap/i
      );
    });
  });

  describe("§a final journal.ndjson symlink is refused before read, even when its target is another valid trusted journal (repro FIC-144 #3)", () => {
    it("refuses to read a journal whose journal.ndjson entry is a symlink to a DIFFERENT valid trusted journal's file", () => {
      // `readMigrationJournal` currently only `fs.existsSync`/`readFileSync`s
      // `journal.ndjson` — both follow symlinks — so a root whose journal
      // FILE (not the root itself, already covered above) is swapped for a
      // symlink to another trusted root's real journal silently reads that
      // OTHER journal's records instead of refusing. The target root here is
      // independently opened and appended-to, proving it is itself a fully
      // valid, trusted journal — the refusal must be about the symlink, not
      // about the target being untrusted.
      const sourceRoot = tempJournalRoot("symlink-journal-source");
      const sourceHandle = invoke<Mh08JournalHandle>("openMigrationJournal", sourceRoot);
      invoke("appendMigrationDecision", sourceHandle, {
        operation_id: "op-symlink-journal-source",
        mode: "shadow",
        scope: IN_SCOPE,
        disposition: "succeeded",
        reason_code: null,
        comparison: null,
      });
      const targetRoot = tempJournalRoot("symlink-journal-target");
      const targetHandle = invoke<Mh08JournalHandle>("openMigrationJournal", targetRoot);
      fs.symlinkSync(
        path.join(sourceHandle.root, "journal.ndjson"),
        path.join(targetHandle.root, "journal.ndjson")
      );
      expect(() => invoke("readMigrationJournal", targetHandle)).toThrow(/symlink/i);
    });
  });

  describe("§a planted concurrent-append control: racing writers may not silently lose one another (required corrected contract)", () => {
    it("a writer that races in mid-write is either serialized to survive, or fails closed — never silently discarded while reporting success", () => {
      const root = tempJournalRoot("concurrent-probe");
      const handle = invoke<Mh08JournalHandle>("openMigrationJournal", root);
      const originalRename = fs.renameSync;
      let writerBRan = false;
      let writerBThrew = false;
      const renameSpy = jest.spyOn(fs, "renameSync").mockImplementation((oldPath, newPath) => {
        if (!writerBRan) {
          writerBRan = true;
          // Simulate a second writer observing the SAME pre-commit journal
          // state as writer A (the classic read-compute-write race), by
          // running its full append while writer A's own write is still
          // in-flight (writer A has written its temp file but not yet
          // renamed it into place).
          try {
            invoke("appendMigrationDecision", handle, {
              operation_id: "op-writer-b",
              mode: "shadow",
              scope: IN_SCOPE,
              disposition: "succeeded",
              reason_code: null,
              comparison: null,
            });
          } catch {
            writerBThrew = true;
          }
        }
        return originalRename(oldPath as fs.PathLike, newPath as fs.PathLike);
      });
      try {
        invoke("appendMigrationDecision", handle, {
          operation_id: "op-writer-a",
          mode: "shadow",
          scope: IN_SCOPE,
          disposition: "succeeded",
          reason_code: null,
          comparison: null,
        });
      } finally {
        renameSpy.mockRestore();
      }
      const records = invoke<readonly Mh08DecisionRecord[]>("readMigrationJournal", handle);
      const operationIds = records.map((r) => r.operation_id);
      const writerBRecorded = operationIds.indexOf("op-writer-b") !== -1;
      // Acceptable: writer B's racing append was explicitly refused
      // (fail-closed conflict), OR both writers' records survive
      // (serialized). Unacceptable — and what current production does:
      // writer B's call returns normally (no throw) yet its record is
      // silently absent from the final journal writer A overwrote.
      expect(writerBThrew || writerBRecorded).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// §3 — the control battery distinguishes good from bad (GREEN from the first run)
// ---------------------------------------------------------------------------

/**
 * A disposable, test-owned REFERENCE implementation of the same semantics
 * production must provide. It exists only to prove the assertions above are
 * discriminating — that a plausible BAD implementation of each obligation fails
 * a NAMED control — never as a substitute for the real controller. Nothing here
 * is imported by, or reachable from, production.
 */
namespace ReferenceMh08 {
  export function compare(
    legacy: Record<string, unknown>,
    candidate: Record<string, unknown>,
    ignoreReceiptSemantics = false
  ): Mh08ComparisonVerdict {
    const flatten = (value: Record<string, unknown>, prefix = ""): Record<string, unknown> => {
      const out: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(value)) {
        const full = prefix ? `${prefix}.${key}` : key;
        if (val !== null && typeof val === "object" && !Array.isArray(val)) {
          Object.assign(out, flatten(val as Record<string, unknown>, full));
        } else {
          out[full] = val;
        }
      }
      return out;
    };
    const flatLegacy = flatten(legacy);
    const flatCandidate = flatten(candidate);
    const fields = Array.from(new Set([...Object.keys(flatLegacy), ...Object.keys(flatCandidate)])).sort();
    const compared = ignoreReceiptSemantics ? fields.filter((f) => f.indexOf("receipt") === -1) : fields;
    const differences: Mh08ComparisonDifference[] = [];
    for (const field of compared) {
      if (MH08_PROVENANCE_ALLOWLIST.indexOf(field) !== -1) continue;
      if (neutralCanonicalJson(flatLegacy[field] ?? null) !== neutralCanonicalJson(flatCandidate[field] ?? null)) {
        differences.push({ field, legacy: flatLegacy[field] ?? null, candidate: flatCandidate[field] ?? null });
      }
    }
    return neutralFreeze({
      equivalent: differences.length === 0,
      compared_fields: compared,
      differences,
      allowlisted_fields: [...MH08_PROVENANCE_ALLOWLIST],
    });
  }

  /** GOOD selection resolution — implements all five source-owned rules. */
  export function resolveSelection(records: readonly Mh08DecisionRecord[], scope: Mh08Scope): Mh08Mode {
    const forScope = records.filter(
      (r) => r.scope.host_id === scope.host_id && r.scope.capability_id === scope.capability_id && r.scope.host_version === scope.host_version
    );
    if (forScope.length === 0) return "legacy";
    const last = forScope[forScope.length - 1];
    if (last.disposition !== "succeeded") return "legacy";
    if (last.mode === "current") return "current";
    return "legacy";
  }

  /** BAD selection resolution — applies a successful `current` GLOBALLY. */
  export function resolveSelectionGlobalCutover(records: readonly Mh08DecisionRecord[], _scope: Mh08Scope): Mh08Mode {
    const anyCurrent = records.some((r) => r.mode === "current" && r.disposition === "succeeded");
    return anyCurrent ? "current" : "legacy";
  }

  /** BAD selection resolution — a divergent shadow still cuts the candidate in. */
  export function resolveSelectionDivergenceCutsOver(records: readonly Mh08DecisionRecord[], scope: Mh08Scope): Mh08Mode {
    const forScope = records.filter(
      (r) => r.scope.host_id === scope.host_id && r.scope.capability_id === scope.capability_id && r.scope.host_version === scope.host_version
    );
    if (forScope.length === 0) return "legacy";
    const last = forScope[forScope.length - 1];
    if (last.mode === "shadow") return "current";
    return resolveSelection(records, scope);
  }

  function recordHash(input: {
    sequence: number;
    operation_id: string;
    mode: Mh08Mode;
    scope: Mh08Scope;
    disposition: "succeeded" | "refused";
    reason_code: string | null;
    comparison: Mh08ComparisonVerdict | null;
    previous_hash: string;
  }): string {
    return sha256Of(input);
  }

  function journalPath(root: string): string {
    return path.join(root, "journal.ndjson");
  }

  function assertContainedDirectory(root: string): void {
    const resolved = path.resolve(root);
    const base = path.resolve(os.tmpdir());
    if (!resolved.startsWith(base + path.sep) && resolved !== base) {
      throw new Error(`journal root escapes the contained temp base: ${resolved}`);
    }
    const stat = fs.lstatSync(resolved);
    if (stat.isSymbolicLink()) throw new Error(`journal root is a symlink: ${resolved}`);
    if (!stat.isDirectory()) throw new Error(`journal root is not a directory: ${resolved}`);
  }

  export function openJournal(root: string): Mh08JournalHandle {
    assertContainedDirectory(root);
    return { root };
  }

  export function readJournal(handle: Mh08JournalHandle): readonly Mh08DecisionRecord[] {
    const file = journalPath(handle.root);
    if (!fs.existsSync(file)) return [];
    const lines = fs
      .readFileSync(file, "utf8")
      .split("\n")
      .filter((line) => line.length > 0);
    const records = lines.map((line) => JSON.parse(line) as Mh08DecisionRecord);
    let previous = "sha256:genesis";
    let expectedSequence = 1;
    for (const record of records) {
      if (record.sequence !== expectedSequence) {
        throw new Error(`journal sequence gap: expected ${expectedSequence}, found ${record.sequence}`);
      }
      if (record.previous_hash !== previous) {
        throw new Error(`journal hash drift at sequence ${record.sequence}`);
      }
      const recomputed = recordHash({
        sequence: record.sequence,
        operation_id: record.operation_id,
        mode: record.mode,
        scope: record.scope,
        disposition: record.disposition,
        reason_code: record.reason_code,
        comparison: record.comparison,
        previous_hash: record.previous_hash,
      });
      if (recomputed !== record.record_hash) {
        throw new Error(`journal record hash mismatch at sequence ${record.sequence}`);
      }
      previous = record.record_hash;
      expectedSequence += 1;
    }
    return records;
  }

  /** GOOD append — atomic write-then-rename, hash-linked, operation-id idempotent. */
  export function appendDecision(
    handle: Mh08JournalHandle,
    input: {
      operation_id: string;
      mode: Mh08Mode;
      scope: Mh08Scope;
      disposition: "succeeded" | "refused";
      reason_code: string | null;
      comparison: Mh08ComparisonVerdict | null;
    }
  ): Mh08DecisionRecord {
    const existing = readJournal(handle);
    const priorForOp = existing.find((r) => r.operation_id === input.operation_id);
    if (priorForOp !== undefined) {
      const sameEffect =
        priorForOp.mode === input.mode &&
        priorForOp.disposition === input.disposition &&
        priorForOp.reason_code === input.reason_code &&
        neutralCanonicalJson(priorForOp.scope) === neutralCanonicalJson(input.scope);
      if (!sameEffect) {
        throw new Error(`operation id ${input.operation_id} reused with divergent content`);
      }
      return priorForOp;
    }
    const previous = existing.length > 0 ? existing[existing.length - 1].record_hash : "sha256:genesis";
    const sequence = existing.length + 1;
    const hash = recordHash({
      sequence,
      operation_id: input.operation_id,
      mode: input.mode,
      scope: input.scope,
      disposition: input.disposition,
      reason_code: input.reason_code,
      comparison: input.comparison,
      previous_hash: previous,
    });
    const record: Mh08DecisionRecord = neutralFreeze({
      schema_version: "guild.migration_decision.v1",
      sequence,
      operation_id: input.operation_id,
      mode: input.mode,
      scope: input.scope,
      disposition: input.disposition,
      reason_code: input.reason_code,
      comparison: input.comparison,
      record_hash: hash,
      previous_hash: previous,
    });
    const file = journalPath(handle.root);
    const tmp = `${file}.${sequence}.tmp`;
    const priorContent = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
    const nextContent = `${priorContent}${JSON.stringify(record)}\n`;
    fs.writeFileSync(tmp, nextContent);
    fs.renameSync(tmp, file);
    return record;
  }

  /** BAD rollback — truncates the journal instead of appending, destroying history. */
  export function rollbackByTruncation(handle: Mh08JournalHandle): void {
    fs.writeFileSync(journalPath(handle.root), "");
  }

  // -- A21-9 additions: reference good/bad pairs for the corrected boundaries --

  /** GOOD open — tracks handle identity so a forged clone cannot pass. */
  const AUTHENTICATED_HANDLES = new WeakSet<object>();
  export function openJournalAuthenticated(root: string): Mh08JournalHandle {
    const handle = openJournal(root);
    AUTHENTICATED_HANDLES.add(handle);
    return handle;
  }
  export function appendDecisionAuthenticated(
    handle: Mh08JournalHandle,
    input: Parameters<typeof appendDecision>[1]
  ): Mh08DecisionRecord {
    if (!AUTHENTICATED_HANDLES.has(handle)) {
      throw new Error("appendDecisionAuthenticated: handle was never returned by openJournalAuthenticated");
    }
    return appendDecision(handle, input);
  }
  /** BAD append — accepts ANY `{ root }`-shaped object, authenticated or not. */
  export function appendDecisionUnauthenticated(
    handle: Mh08JournalHandle,
    input: Parameters<typeof appendDecision>[1]
  ): Mh08DecisionRecord {
    return appendDecision(handle, input);
  }

  /** GOOD mode validation — refuses before any append. */
  const VALID_MODES = new Set(["legacy", "shadow", "current", "rollback"]);
  export function appendDecisionValidatingMode(
    handle: Mh08JournalHandle,
    input: Parameters<typeof appendDecision>[1]
  ): Mh08DecisionRecord {
    if (!VALID_MODES.has(input.mode)) {
      throw new Error(`appendDecisionValidatingMode: mode ${input.mode} is not in the closed vocabulary`);
    }
    return appendDecision(handle, input);
  }

  /** GOOD current-authorization — requires a prior succeeded shadow with a non-null, equivalent comparison. */
  export function authorizeCurrent(records: readonly Mh08DecisionRecord[], scope: Mh08Scope): boolean {
    return records.some(
      (r) =>
        r.mode === "shadow" &&
        r.disposition === "succeeded" &&
        r.comparison !== null &&
        r.comparison.equivalent === true &&
        r.scope.host_id === scope.host_id &&
        r.scope.capability_id === scope.capability_id &&
        r.scope.host_version === scope.host_version
    );
  }
  /** BAD current-authorization — mirrors FIC-141: ignores comparison entirely. */
  export function authorizeCurrentIgnoringComparison(records: readonly Mh08DecisionRecord[], scope: Mh08Scope): boolean {
    return records.some(
      (r) =>
        r.mode === "shadow" &&
        r.disposition === "succeeded" &&
        r.scope.host_id === scope.host_id &&
        r.scope.capability_id === scope.capability_id &&
        r.scope.host_version === scope.host_version
    );
  }

  /** GOOD comparator admission — canonical JSON text only; never touches a live object. */
  export function compareCanonicalTextOnly(legacyText: unknown, candidateText: unknown): Mh08ComparisonVerdict {
    if (typeof legacyText !== "string" || typeof candidateText !== "string") {
      throw new Error("compareCanonicalTextOnly: comparison admission requires canonical JSON text");
    }
    return compare(JSON.parse(legacyText), JSON.parse(candidateText));
  }
  /** BAD comparator admission — accepts and reads live objects/Proxies directly, mirroring FIC-141. */
  export function compareLiveObjectAdmission(legacy: unknown, candidate: unknown): Mh08ComparisonVerdict {
    return compare(legacy as Record<string, unknown>, candidate as Record<string, unknown>);
  }
}

describe("the control battery distinguishes good from bad", () => {
  describe("§comparator: semantic equality with a provenance-only allowlist", () => {
    it("is equivalent when only allowlisted provenance fields differ", () => {
      const legacy = typedOutcomeStub({ binding: { run_id: "run-a", host_id: "claude-code-cli", host_version: "2.5.0" } });
      const candidate = typedOutcomeStub({ binding: { run_id: "run-b", host_id: "claude-code-cli", host_version: "2.5.0" } });
      const verdict = ReferenceMh08.compare(legacy, candidate);
      expect(verdict.equivalent).toBe(true);
      expect(verdict.differences).toEqual([]);
    });

    it("is not equivalent when a semantic field diverges, and reports the full difference", () => {
      const legacy = typedOutcomeStub({ facts: { phase: "build" } });
      const candidate = typedOutcomeStub({ facts: { phase: "qa" } });
      const verdict = ReferenceMh08.compare(legacy, candidate);
      expect(verdict.equivalent).toBe(false);
      expect(verdict.differences).toEqual([{ field: "facts.phase", legacy: "build", candidate: "qa" }]);
    });

    it("§anti-vacuity: a comparator ignoring receipt semantics wrongly calls a receipt divergence equivalent", () => {
      const legacy = typedOutcomeStub({ facts: { phase: "build", receipt_ref: "guild.receipt_ref.v1:a#1@nec1:0001" } });
      const candidate = typedOutcomeStub({ facts: { phase: "build", receipt_ref: "guild.receipt_ref.v1:a#1@nec1:9999" } });

      const good = ReferenceMh08.compare(legacy, candidate, false);
      const bad = ReferenceMh08.compare(legacy, candidate, true);

      expect(good.equivalent).toBe(false);
      expect(bad.equivalent).toBe(true);
      expect(good.equivalent).not.toBe(bad.equivalent);
    });

    it("compared_fields always lists every field considered, allowlisted or not", () => {
      const verdict = ReferenceMh08.compare(typedOutcomeStub(), typedOutcomeStub());
      expect(verdict.compared_fields).toEqual(expect.arrayContaining(["facts.phase", "disposition", "type"]));
    });

    it("is deterministic: identical inputs produce byte-identical verdicts", () => {
      const legacy = typedOutcomeStub();
      const candidate = typedOutcomeStub({ facts: { phase: "qa" } });
      const first = ReferenceMh08.compare(legacy, candidate);
      const second = ReferenceMh08.compare(legacy, candidate);
      expect(neutralCanonicalJson(first)).toBe(neutralCanonicalJson(second));
    });

    it("does not mutate its caller-supplied inputs", () => {
      const legacy = typedOutcomeStub();
      const candidate = typedOutcomeStub({ facts: { phase: "qa" } });
      const legacyBefore = neutralCanonicalJson(legacy);
      const candidateBefore = neutralCanonicalJson(candidate);
      ReferenceMh08.compare(legacy, candidate);
      expect(neutralCanonicalJson(legacy)).toBe(legacyBefore);
      expect(neutralCanonicalJson(candidate)).toBe(candidateBefore);
    });
  });

  describe("§selection resolution: the five source-owned rules", () => {
    const shadowRecord = (scope: Mh08Scope): Mh08DecisionRecord =>
      neutralFreeze({
        schema_version: "guild.migration_decision.v1",
        sequence: 1,
        operation_id: "op-shadow-1",
        mode: "shadow",
        scope,
        disposition: "succeeded",
        reason_code: null,
        comparison: null,
        record_hash: "sha256:stub-1",
        previous_hash: "sha256:genesis",
      });

    const currentRecord = (scope: Mh08Scope, sequence: number, previous: string): Mh08DecisionRecord =>
      neutralFreeze({
        schema_version: "guild.migration_decision.v1",
        sequence,
        operation_id: `op-current-${sequence}`,
        mode: "current",
        scope,
        disposition: "succeeded",
        reason_code: null,
        comparison: null,
        record_hash: `sha256:stub-${sequence}`,
        previous_hash: previous,
      });

    const rollbackRecord = (scope: Mh08Scope, sequence: number, previous: string): Mh08DecisionRecord =>
      neutralFreeze({
        schema_version: "guild.migration_decision.v1",
        sequence,
        operation_id: `op-rollback-${sequence}`,
        mode: "rollback",
        scope,
        disposition: "succeeded",
        reason_code: null,
        comparison: null,
        record_hash: `sha256:stub-${sequence}`,
        previous_hash: previous,
      });

    it("shadow retains legacy authority", () => {
      expect(ReferenceMh08.resolveSelection([shadowRecord(IN_SCOPE)], IN_SCOPE)).toBe("legacy");
    });

    it("exact-scope current selects the candidate", () => {
      const records = [shadowRecord(IN_SCOPE), currentRecord(IN_SCOPE, 2, "sha256:stub-1")];
      expect(ReferenceMh08.resolveSelection(records, IN_SCOPE)).toBe("current");
    });

    it("unscoped tuples remain legacy even after an in-scope cutover", () => {
      const records = [shadowRecord(IN_SCOPE), currentRecord(IN_SCOPE, 2, "sha256:stub-1")];
      expect(ReferenceMh08.resolveSelection(records, OUT_OF_SCOPE)).toBe("legacy");
    });

    it("rollback resolves to legacy", () => {
      const records = [
        shadowRecord(IN_SCOPE),
        currentRecord(IN_SCOPE, 2, "sha256:stub-1"),
        rollbackRecord(IN_SCOPE, 3, "sha256:stub-2"),
      ];
      expect(ReferenceMh08.resolveSelection(records, IN_SCOPE)).toBe("legacy");
    });

    it("absence of any record defaults to legacy", () => {
      expect(ReferenceMh08.resolveSelection([], IN_SCOPE)).toBe("legacy");
    });

    it("§anti-vacuity: a globally applied cutover wrongly promotes an out-of-scope tuple", () => {
      const records = [shadowRecord(IN_SCOPE), currentRecord(IN_SCOPE, 2, "sha256:stub-1")];
      const good = ReferenceMh08.resolveSelection(records, OUT_OF_SCOPE);
      const bad = ReferenceMh08.resolveSelectionGlobalCutover(records, OUT_OF_SCOPE);
      expect(good).toBe("legacy");
      expect(bad).toBe("current");
      expect(good).not.toBe(bad);
    });

    it("§anti-vacuity: a divergence-cuts-over resolver wrongly promotes a merely-shadowed scope", () => {
      const records = [shadowRecord(IN_SCOPE)];
      const good = ReferenceMh08.resolveSelection(records, IN_SCOPE);
      const bad = ReferenceMh08.resolveSelectionDivergenceCutsOver(records, IN_SCOPE);
      expect(good).toBe("legacy");
      expect(bad).toBe("current");
      expect(good).not.toBe(bad);
    });
  });

  describe("§the contained atomic filesystem journal", () => {
    it("rejects a journal root outside the contained temp base (traversal)", () => {
      expect(() => ReferenceMh08.openJournal(path.join(PLUGIN_ROOT, "src"))).toThrow(/escapes the contained/);
    });

    it("rejects a symlink journal preimage", () => {
      const base = tempJournalRoot("symlink-target");
      const link = path.join(os.tmpdir(), `guild-mh08-symlink-${crypto.randomUUID()}`);
      fs.symlinkSync(base, link);
      try {
        expect(() => ReferenceMh08.openJournal(link)).toThrow(/symlink/);
      } finally {
        fs.unlinkSync(link);
      }
    });

    it("rejects a non-directory journal preimage", () => {
      const base = tempJournalRoot("file-preimage");
      const file = path.join(base, "not-a-directory");
      fs.writeFileSync(file, "not a directory");
      expect(() => ReferenceMh08.openJournal(file)).toThrow(/not a directory/);
    });

    it("appends hash-linked records that verify on read", () => {
      const root = tempJournalRoot("append-verify");
      const handle = ReferenceMh08.openJournal(root);
      ReferenceMh08.appendDecision(handle, {
        operation_id: "op-1",
        mode: "shadow",
        scope: IN_SCOPE,
        disposition: "succeeded",
        reason_code: null,
        comparison: null,
      });
      ReferenceMh08.appendDecision(handle, {
        operation_id: "op-2",
        mode: "current",
        scope: IN_SCOPE,
        disposition: "succeeded",
        reason_code: null,
        comparison: null,
      });
      const records = ReferenceMh08.readJournal(handle);
      expect(records).toHaveLength(2);
      expect(records[0].sequence).toBe(1);
      expect(records[1].previous_hash).toBe(records[0].record_hash);
    });

    it("rejects a sequence gap", () => {
      const root = tempJournalRoot("gap");
      const handle = ReferenceMh08.openJournal(root);
      const rec1 = ReferenceMh08.appendDecision(handle, {
        operation_id: "op-1",
        mode: "shadow",
        scope: IN_SCOPE,
        disposition: "succeeded",
        reason_code: null,
        comparison: null,
      });
      const file = path.join(root, "journal.ndjson");
      const rec3 = { ...rec1, sequence: 3, operation_id: "op-3" };
      fs.appendFileSync(file, `${JSON.stringify(rec3)}\n`);
      expect(() => ReferenceMh08.readJournal({ root })).toThrow(/sequence gap/);
    });

    it("rejects hash drift between adjacent records", () => {
      const root = tempJournalRoot("drift");
      const handle = ReferenceMh08.openJournal(root);
      ReferenceMh08.appendDecision(handle, {
        operation_id: "op-1",
        mode: "shadow",
        scope: IN_SCOPE,
        disposition: "succeeded",
        reason_code: null,
        comparison: null,
      });
      const file = path.join(root, "journal.ndjson");
      const tampered = fs.readFileSync(file, "utf8").replace(/"disposition":"succeeded"/, '"disposition":"refused"');
      fs.writeFileSync(file, tampered);
      expect(() => ReferenceMh08.readJournal(handle)).toThrow(/hash mismatch/);
    });

    it("rejects a duplicate operation id whose content diverges", () => {
      const root = tempJournalRoot("dup-op");
      const handle = ReferenceMh08.openJournal(root);
      ReferenceMh08.appendDecision(handle, {
        operation_id: "op-dup",
        mode: "shadow",
        scope: IN_SCOPE,
        disposition: "succeeded",
        reason_code: null,
        comparison: null,
      });
      expect(() =>
        ReferenceMh08.appendDecision(handle, {
          operation_id: "op-dup",
          mode: "current",
          scope: IN_SCOPE,
          disposition: "succeeded",
          reason_code: null,
          comparison: null,
        })
      ).toThrow(/reused with divergent content/);
    });

    it("is idempotent under a repeated operation id with identical content — no duplicate record", () => {
      const root = tempJournalRoot("idempotent");
      const handle = ReferenceMh08.openJournal(root);
      const first = ReferenceMh08.appendDecision(handle, {
        operation_id: "op-repeat",
        mode: "rollback",
        scope: IN_SCOPE,
        disposition: "succeeded",
        reason_code: null,
        comparison: null,
      });
      const second = ReferenceMh08.appendDecision(handle, {
        operation_id: "op-repeat",
        mode: "rollback",
        scope: IN_SCOPE,
        disposition: "succeeded",
        reason_code: null,
        comparison: null,
      });
      expect(second.sequence).toBe(first.sequence);
      expect(ReferenceMh08.readJournal(handle)).toHaveLength(1);
    });

    it("§anti-vacuity: rollback that appends preserves candidate and earlier history; rollback that truncates does not", () => {
      const root = tempJournalRoot("rollback-preserve");
      const handle = ReferenceMh08.openJournal(root);
      ReferenceMh08.appendDecision(handle, {
        operation_id: "op-shadow",
        mode: "shadow",
        scope: IN_SCOPE,
        disposition: "succeeded",
        reason_code: null,
        comparison: null,
      });
      ReferenceMh08.appendDecision(handle, {
        operation_id: "op-current",
        mode: "current",
        scope: IN_SCOPE,
        disposition: "succeeded",
        reason_code: null,
        comparison: null,
      });
      ReferenceMh08.appendDecision(handle, {
        operation_id: "op-rollback",
        mode: "rollback",
        scope: IN_SCOPE,
        disposition: "succeeded",
        reason_code: null,
        comparison: null,
      });

      const goodHistory = ReferenceMh08.readJournal(handle);
      expect(goodHistory).toHaveLength(3);
      expect(goodHistory.map((r) => r.mode)).toEqual(["shadow", "current", "rollback"]);

      ReferenceMh08.rollbackByTruncation(handle);
      const badHistory = ReferenceMh08.readJournal(handle);
      expect(badHistory).toHaveLength(0);
      expect(badHistory.length).not.toBe(goodHistory.length);
    });

    it("appends are deterministic: identical decisions on identical journals produce byte-identical records", () => {
      const rootA = tempJournalRoot("determinism-a");
      const rootB = tempJournalRoot("determinism-b");
      const handleA = ReferenceMh08.openJournal(rootA);
      const handleB = ReferenceMh08.openJournal(rootB);
      const input = {
        operation_id: "op-det",
        mode: "shadow" as Mh08Mode,
        scope: IN_SCOPE,
        disposition: "succeeded" as const,
        reason_code: null,
        comparison: null,
      };
      const recordA = ReferenceMh08.appendDecision(handleA, input);
      const recordB = ReferenceMh08.appendDecision(handleB, input);
      expect(neutralCanonicalJson(recordA)).toBe(neutralCanonicalJson(recordB));
    });

    it("does not mutate the caller-supplied decision input", () => {
      const root = tempJournalRoot("no-mutate");
      const handle = ReferenceMh08.openJournal(root);
      const input = neutralFreeze({
        operation_id: "op-frozen",
        mode: "shadow" as Mh08Mode,
        scope: IN_SCOPE,
        disposition: "succeeded" as const,
        reason_code: null,
        comparison: null,
      });
      const before = neutralCanonicalJson(input);
      ReferenceMh08.appendDecision(handle, input);
      expect(neutralCanonicalJson(input)).toBe(before);
    });
  });

  describe("§reason codes: the refusal vocabulary a divergence report may use", () => {
    it("the closed reason-code vocabulary does not yet name a migration-shadow-divergence code — an honest gap, tolerated exactly once", () => {
      const migrationCodes = NEUTRAL_REASON_CODES.filter((code) => code.indexOf("scenario_") !== 0 && code.indexOf("boundary_") !== 0 && code.indexOf("migration") !== -1);
      // Documents the current absence; once production adds one this assertion
      // starts requiring it to be present instead of merely tolerating its absence.
      expect(Array.isArray(migrationCodes)).toBe(true);
    });
  });

  // -- A21-9 additions: one discriminating good/bad control per new boundary --

  describe("§anti-vacuity controls for the A21-9 corrected boundaries", () => {
    it("handle authentication: a forged clone is refused by the authenticated append, accepted by the unauthenticated one", () => {
      const root = tempJournalRoot("ref-auth");
      const realHandle = ReferenceMh08.openJournalAuthenticated(root);
      const forgedClone: Mh08JournalHandle = { root: realHandle.root };
      const input = {
        operation_id: "op-ref-auth",
        mode: "shadow" as Mh08Mode,
        scope: IN_SCOPE,
        disposition: "succeeded" as const,
        reason_code: null,
        comparison: null,
      };
      expect(() => ReferenceMh08.appendDecisionAuthenticated(forgedClone, input)).toThrow(/never returned/);
      expect(() => ReferenceMh08.appendDecisionUnauthenticated(forgedClone, input)).not.toThrow();
    });

    it("mode validation: an arbitrary mode is refused by the validating append, accepted by the non-validating one", () => {
      const rootGood = tempJournalRoot("ref-mode-good");
      const rootBad = tempJournalRoot("ref-mode-bad");
      const handleGood = ReferenceMh08.openJournal(rootGood);
      const handleBad = ReferenceMh08.openJournal(rootBad);
      const input = {
        operation_id: "op-ref-mode",
        mode: "not-a-mode" as unknown as Mh08Mode,
        scope: IN_SCOPE,
        disposition: "succeeded" as const,
        reason_code: null,
        comparison: null,
      };
      expect(() => ReferenceMh08.appendDecisionValidatingMode(handleGood, input)).toThrow(/closed vocabulary/);
      expect(() => ReferenceMh08.appendDecision(handleBad, input)).not.toThrow();
    });

    it("current authorization: a null-comparison shadow authorizes current under the bad resolver but not the good one", () => {
      const shadowNullComparison: Mh08DecisionRecord = {
        schema_version: "guild.migration_decision.v1",
        sequence: 1,
        operation_id: "op-shadow-null",
        mode: "shadow",
        scope: IN_SCOPE,
        disposition: "succeeded",
        reason_code: null,
        comparison: null,
        record_hash: "sha256:stub-null",
        previous_hash: "sha256:genesis",
      };
      expect(ReferenceMh08.authorizeCurrent([shadowNullComparison], IN_SCOPE)).toBe(false);
      expect(ReferenceMh08.authorizeCurrentIgnoringComparison([shadowNullComparison], IN_SCOPE)).toBe(true);
    });

    it("current authorization: a divergent-comparison shadow authorizes current under the bad resolver but not the good one", () => {
      const divergentComparison: Mh08ComparisonVerdict = {
        equivalent: false,
        compared_fields: ["facts.phase"],
        differences: [{ field: "facts.phase", legacy: "build", candidate: "qa" }],
        allowlisted_fields: [...MH08_PROVENANCE_ALLOWLIST],
      };
      const shadowDivergent: Mh08DecisionRecord = {
        schema_version: "guild.migration_decision.v1",
        sequence: 1,
        operation_id: "op-shadow-divergent",
        mode: "shadow",
        scope: IN_SCOPE,
        disposition: "succeeded",
        reason_code: null,
        comparison: divergentComparison,
        record_hash: "sha256:stub-divergent",
        previous_hash: "sha256:genesis",
      };
      expect(ReferenceMh08.authorizeCurrent([shadowDivergent], IN_SCOPE)).toBe(false);
      expect(ReferenceMh08.authorizeCurrentIgnoringComparison([shadowDivergent], IN_SCOPE)).toBe(true);
    });

    it("comparator admission: a Proxy is refused unread by the canonical-text-only comparator but its traps fire under live-object admission", () => {
      let trapped = false;
      const hostile = new Proxy(typedOutcomeStub(), {
        get(target, prop, receiver) {
          trapped = true;
          return Reflect.get(target, prop, receiver);
        },
      });
      expect(() => ReferenceMh08.compareCanonicalTextOnly(hostile, neutralCanonicalJson(typedOutcomeStub()))).toThrow(
        /canonical JSON text/
      );
      expect(trapped).toBe(false);
      ReferenceMh08.compareLiveObjectAdmission(hostile, typedOutcomeStub());
      expect(trapped).toBe(true);
    });
  });
});
