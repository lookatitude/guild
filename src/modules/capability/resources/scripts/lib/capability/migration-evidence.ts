import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { parseCompatibilityUsageV1 } from "../../../src/modules/capability/workflows/compatibility-usage";
import { checkContained, isRefused, writeContainedFile } from "../../../src/modules/kernel/workflows/path-containment";
import {
  acquireJournalAuthority,
  appendReceipt,
  compareCheckpointToJournal,
  defaultJournalIo,
  makeReceiptInput,
  readCheckpointState,
  scanReceiptJournal,
  type ReceiptAppendInput,
  type ReceiptRecordV1,
} from "../../../src/modules/telemetry/workflows/receipt-journal";
import { reconcileReceiptJournal } from "../../../src/modules/telemetry/workflows/receipt-reconcile";
import { validateProjectCapabilityProfileV1 } from "../core/contracts/project-capability-profile";
import {
  baselineBinding,
  snapshotTreeHashes,
  type BoundBaseline,
} from "./profile-emit";
import { parseFrontmatter, parseYaml } from "../frontmatter";
import { extractHandoffEnvelope, validateHandoffV2 } from "../../../hooks/lib/handoff-v2";
import {
  CAPABILITY_RUN_START_SNAPSHOT_SCHEMA,
  capabilityRunStartIdentityHash,
} from "../../../src/modules/lifecycle/workflows/run-lifecycle";
import {
  readRunBindingRecord,
  withRunBindingExclusion,
} from "../../../src/modules/lifecycle/workflows/run-binding";
import { isCanonicalLaneReceipt } from "../../../src/modules/lifecycle/workflows/run-record-validate";
import {
  taskCellPaths,
  validateTaskAssignmentV2,
  validateTaskAttemptV1,
} from "../../../src/modules/dispatch/workflows/task-cell-contract";
import { redactShareableFile } from "../shared/scrub-redact";

export const MIGRATION_BOUNDARY_SCHEMA = "guild.capability_migration_boundary.v1" as const;
export const MIGRATION_BOUNDARY_CHANNEL = "next" as const;
export const MIGRATION_OBSERVATION_SCHEMA_V1 = "guild.capability_migration_observation.v1" as const;
export const MIGRATION_OBSERVATION_SCHEMA = "guild.capability_migration_observation.v2" as const;
export const MIGRATION_RUN_BASELINE_SCHEMA = "guild.capability_run_baseline.v1" as const;
export const MIGRATION_SUBSTANTIVE_OPERATION_SCHEMA = "guild.capability_substantive_operation.v1" as const;
export const MIGRATION_BOUNDARY_EVIDENCE_RELPATH = ".guild/artifacts/capability/migration-boundaries";

const SHA256 = /^[0-9a-f]{64}$/;
const COMMIT = /^[0-9a-f]{40}$/;
const BETA = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-beta\.(0|[1-9]\d*)$/;
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const GITHUB_EVENT_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const PRODUCTION_REPOSITORY = "lookatitude/guild";
const BOUNDARY_SIGNER_WORKFLOW = "lookatitude/guild/.github/workflows/capability-migration-boundary.yml";

export interface MigrationBoundaryV1 {
  readonly schema_version: typeof MIGRATION_BOUNDARY_SCHEMA;
  readonly channel: typeof MIGRATION_BOUNDARY_CHANNEL;
  readonly release: string;
  readonly source_commit: string;
  readonly source_tree_hash: string;
  readonly merged_at: string;
  readonly packages: {
    readonly "claude-code-cli": MigrationRuntimePackageV1;
    readonly "codex-cli": MigrationRuntimePackageV1;
  };
  readonly workflow: {
    readonly repository: string;
    readonly run_id: string;
    readonly run_attempt: number;
    readonly event: "push";
    readonly ref: "refs/heads/next";
  };
  readonly event_sha256: string;
  readonly boundary_hash: string;
}

interface BoundaryOptions {
  readonly pluginRoot: string;
  readonly claudePackageRoot: string;
  readonly codexPackageRoot: string;
  readonly eventPath: string;
  readonly repository: string;
  readonly runId: string;
  readonly runAttempt: number;
}

export type MigrationRuntimeHost = "claude-code-cli" | "codex-cli";

export interface MigrationRuntimePackageV1 {
  readonly host_id: MigrationRuntimeHost;
  readonly manifest_path: ".claude-plugin/plugin.json" | ".codex-plugin/plugin.json";
  readonly manifest_sha256: string;
  /** Hash of the exact compatibility-loader producer surface. */
  readonly producer_sha256: string;
  readonly tree_sha256: string;
  readonly install_surface_sha256: string;
  /** Attested generated-package files; installed roots may carry harmless extras. */
  readonly files: readonly MigrationRuntimeFileV1[];
  /** Files common to the generated package and its supported live install root. */
  readonly install_files: readonly MigrationRuntimeFileV1[];
}

export interface MigrationRuntimeBindingV1 {
  readonly host_id: MigrationRuntimeHost;
  readonly manifest_path: ".claude-plugin/plugin.json" | ".codex-plugin/plugin.json";
  readonly manifest_sha256: string;
  readonly producer_sha256: string;
  /** Full generated tree named by the attested boundary. */
  readonly tree_sha256: string;
  /** Exact file subset verified in the live install root. */
  readonly install_surface_sha256: string;
}

export interface MigrationRuntimeFileV1 {
  readonly path: string;
  readonly sha256: string;
}

export interface MigrationEvidenceRefV1 {
  readonly path: string;
  readonly sha256: string;
}

export interface MigrationRunBaselineV1 extends BoundBaseline {
  readonly schema_version: typeof MIGRATION_RUN_BASELINE_SCHEMA;
  readonly run_id: string;
  readonly run_started_at: string;
  readonly captured_at: string;
}

export interface MigrationObservationRunV1 {
  readonly run_id: string;
  readonly profile: MigrationEvidenceRefV1;
  readonly journal: MigrationEvidenceRefV1;
  readonly checkpoint: MigrationEvidenceRefV1;
  readonly compatibility_payloads: readonly MigrationEvidenceRefV1[];
}

export interface MigrationObservationRunV2 extends MigrationObservationRunV1 {
  readonly run_manifest: MigrationEvidenceRefV1;
  readonly provenance: MigrationEvidenceRefV1;
  /** Present on scrub-clean public projections; absent only on historical v2 records. */
  readonly source_provenance_sha256?: string;
  /** Hash of the run-time session record covered by the terminal seal. */
  readonly source_session_context_sha256?: string;
  readonly terminal_trace_log: MigrationEvidenceRefV1;
  readonly start_snapshot: MigrationEvidenceRefV1;
  readonly baseline: MigrationEvidenceRefV1;
  /** Present on session-bound public projections; absent only on historical v2 records. */
  readonly session_context?: MigrationEvidenceRefV1;
  /** Present on post-FU18 records; absent on historical release-only v2 observations. */
  readonly substantive_operations?: readonly MigrationEvidenceRefV1[];
  /** Portable task-cell bytes that substantiate every post-FU18 operation hash. */
  readonly substantive_evidence?: readonly MigrationEvidenceRefV1[];
}

export interface MigrationSubstantiveOperationV1 {
  readonly schema_version: typeof MIGRATION_SUBSTANTIVE_OPERATION_SCHEMA;
  readonly run_id: string;
  readonly operation_id: string;
  readonly task_id: string;
  readonly specialist_id: string;
  readonly host_id: string;
  readonly task_run_id: string;
  readonly attempt: number;
  readonly instance_id: string;
  readonly assignment_written_at: string;
  readonly completed_at: string;
  readonly compatibility_operation_id: string;
  readonly compatibility_payload_sha256: string;
  readonly assignment_sha256: string;
  readonly handoff_sha256: string;
  readonly handoff_receipt_sha256: string;
  readonly validation_sha256: string;
  readonly attempt_sha256: string;
  readonly acceptance_sha256: string;
  /** Hashes of the deterministic scrub-clean bytes retained in public evidence. */
  readonly projected_assignment_sha256: string;
  readonly projected_handoff_sha256: string;
  readonly projected_handoff_receipt_sha256: string;
  readonly projected_validation_sha256: string;
  readonly projected_attempt_sha256: string;
  readonly projected_acceptance_sha256: string;
}

export interface MigrationObservationV1 {
  readonly schema_version: typeof MIGRATION_OBSERVATION_SCHEMA_V1;
  readonly boundary_hash: string;
  readonly boundary_release: string;
  readonly boundary_source_commit: string;
  readonly boundary_merged_at: string;
  /** Earliest whole-run profile instant represented by this observation. */
  readonly observed_at: string;
  readonly runtime_package: MigrationRuntimeBindingV1;
  readonly project_id: string;
  readonly mode: "observe" | "shadow";
  readonly runs: readonly MigrationObservationRunV1[];
  readonly verdict: "non_synthetic_runtime";
  readonly observation_hash: string;
}

export interface MigrationObservationV2 extends Omit<MigrationObservationV1, "schema_version" | "runs"> {
  readonly schema_version: typeof MIGRATION_OBSERVATION_SCHEMA;
  readonly runs: readonly MigrationObservationRunV2[];
}

export type MigrationObservation = MigrationObservationV1 | MigrationObservationV2;

export interface AttestedMigrationBoundaryV1 {
  readonly boundary: MigrationBoundaryV1;
  /** GitHub API response time observed while verifying this exact boundary. */
  readonly verified_at: string;
}

function sha256(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function git(root: string, args: readonly string[], encoding: BufferEncoding = "utf8"): string {
  return execFileSync("git", ["-C", root, ...args], { encoding }).trim();
}

function gitBytes(root: string, args: readonly string[]): Buffer {
  return execFileSync("git", ["-C", root, ...args], { maxBuffer: 256 * 1024 * 1024 });
}

function plainRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null ? value as Record<string, unknown> : null;
}

function exactKeys(record: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(record).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function canonicalInstant(value: unknown): string | null {
  if (typeof value !== "string" || !RFC3339.test(value) || !Number.isFinite(Date.parse(value))) return null;
  return new Date(value).toISOString();
}

function canonicalGitHubEventInstant(value: unknown): string | null {
  if (typeof value !== "string" || !GITHUB_EVENT_INSTANT.test(value) || !Number.isFinite(Date.parse(value))) return null;
  return new Date(value).toISOString();
}

function boundaryHash(value: Omit<MigrationBoundaryV1, "boundary_hash">): string {
  return sha256(canonical(value));
}

function observationHash(value: Omit<MigrationObservation, "observation_hash">): string {
  return sha256(canonical(value));
}

export function validateMigrationRunBaseline(value: unknown): MigrationRunBaselineV1 | null {
  const record = plainRecord(value);
  const keys = ["schema_version", "run_id", "run_started_at", "captured_at", "agents", "skills", "registries", "bound_root", "bound_run_id"] as const;
  if (!record || !exactKeys(record, keys) || record.schema_version !== MIGRATION_RUN_BASELINE_SCHEMA) return null;
  if (typeof record.run_id !== "string" || !/^run-\d{8}-\d{6}-[a-z0-9][a-z0-9-]*$/.test(record.run_id) || record.bound_run_id !== record.run_id) return null;
  const capturedAt = canonicalInstant(record.captured_at);
  const runStartedAt = canonicalInstant(record.run_started_at);
  if (capturedAt === null || capturedAt !== record.captured_at || runStartedAt === null || runStartedAt !== record.run_started_at
    || Date.parse(record.captured_at as string) < Date.parse(record.run_started_at as string)
    || Date.parse(record.captured_at as string) - Date.parse(record.run_started_at as string) > 60_000) return null;
  for (const key of ["agents", "skills", "registries", "bound_root"] as const) {
    if (typeof record[key] !== "string" || !SHA256.test(record[key] as string)) return null;
  }
  return Object.freeze({
    schema_version: MIGRATION_RUN_BASELINE_SCHEMA,
    run_id: record.run_id,
    run_started_at: record.run_started_at,
    captured_at: record.captured_at,
    agents: record.agents as string,
    skills: record.skills as string,
    registries: record.registries as string,
    bound_root: record.bound_root as string,
    bound_run_id: record.bound_run_id as string,
  });
}

export function profileBaselineFromMigrationRunBaseline(value: MigrationRunBaselineV1): BoundBaseline {
  return Object.freeze({
    agents: value.agents,
    skills: value.skills,
    registries: value.registries,
    bound_root: value.bound_root,
    bound_run_id: value.bound_run_id,
  });
}

interface CapabilityTreeSnapshot {
  readonly agents: string;
  readonly skills: string;
  readonly registries: string;
}

function assertProfileMatchesCurrentCapabilityTrees(projectRoot: string, profile: NonNullable<ReturnType<typeof validateProjectCapabilityProfileV1>>, label: string): CapabilityTreeSnapshot {
  const current = snapshotTreeHashes(projectRoot);
  const evidence = profile.mutation_evidence;
  if (!current
    || current.agents !== evidence.agents_tree_hash_after
    || current.skills !== evidence.skills_tree_hash_after
    || current.registries !== evidence.registry_hash_after) {
    throw new Error(`${label} refuses capability-tree mutation after final profile emission`);
  }
  return current;
}

function terminalSealOutputHash(profileHash: string, trees: CapabilityTreeSnapshot): string {
  return `sha256:${sha256(canonical({ profile_hash: profileHash, terminal_capability_trees: trees }))}`;
}

function migrationRunManifestFacts(bytes: Buffer, runId: string, status: "open" | "closed", snapshotPath = "capability/run-start-snapshot.json"): { readonly started_at: string; readonly capability_start_snapshot_sha256: string | null } | null {
  const manifest = plainRecord(parseYaml(bytes.toString("utf8")));
  if (!manifest || manifest.schema_version !== "guild.run.v1" || manifest.run_id !== runId || manifest.status !== status || typeof manifest.started_at !== "string") return null;
  const startedInstant = Date.parse(manifest.started_at);
  const ref = plainRecord(manifest.capability_start_snapshot_ref);
  const snapshotHash = ref === null && manifest.capability_start_snapshot_ref === null
    ? null
    : ref?.path === snapshotPath && typeof ref.sha256 === "string" && SHA256.test(ref.sha256)
      ? ref.sha256
      : undefined;
  return Number.isFinite(startedInstant) && snapshotHash !== undefined
    ? Object.freeze({ started_at: new Date(startedInstant).toISOString(), capability_start_snapshot_sha256: snapshotHash })
    : null;
}

function migrationRunStartSnapshot(bytes: Buffer, runId: string, startedAt: string): MigrationRunBaselineV1 | null {
  let parsed: unknown;
  try { parsed = JSON.parse(bytes.toString("utf8")); } catch { return null; }
  const record = plainRecord(parsed);
  if (!record || record.schema_version !== CAPABILITY_RUN_START_SNAPSHOT_SCHEMA) return null;
  return validateMigrationRunBaseline({ ...record, schema_version: MIGRATION_RUN_BASELINE_SCHEMA })?.run_id === runId
    && record.run_started_at === startedAt
    ? validateMigrationRunBaseline({ ...record, schema_version: MIGRATION_RUN_BASELINE_SCHEMA })
    : null;
}

interface MigrationRunCloseFacts {
  readonly started_at: string;
  readonly closed_at: string;
}

function migrationRunCloseFacts(bytes: Buffer, terminalLogBytes: Buffer, runId: string, logRef = `.guild/runs/${runId}/logs/v1.4-events.jsonl`): MigrationRunCloseFacts | null {
  let parsed: unknown;
  try { parsed = JSON.parse(bytes.toString("utf8")); } catch { return null; }
  const record = plainRecord(parsed);
  const terminal = plainRecord(record?.terminal_trace_event);
  if (!record || record.schema_version !== "guild.provenance.v1" || record.run_id !== runId || record.status !== "closed"
    || !terminal || terminal.event_name !== "run_closed" || typeof terminal.event_id !== "string"
    || terminal.log_ref !== logRef) return null;
  const startedAt = canonicalInstant(record.started_at);
  const closedAt = canonicalInstant(record.closed_at);
  const terminalAt = canonicalInstant(terminal.at);
  if (!startedAt || !closedAt || !terminalAt || closedAt !== terminalAt || Date.parse(closedAt) < Date.parse(startedAt)) return null;
  const matchingEvents: Record<string, unknown>[] = [];
  for (const line of terminalLogBytes.toString("utf8").split("\n").filter((entry) => entry.trim().length > 0)) {
    let event: Record<string, unknown> | null = null;
    try { event = plainRecord(JSON.parse(line)); } catch { event = null; }
    if (event?.event_id === terminal.event_id) matchingEvents.push(event);
  }
  if (matchingEvents.length !== 1) return null;
  const event = matchingEvents[0];
  if (!exactKeys(event, ["schema_version", "event_id", "event_name", "run_id", "at"])
    || event.schema_version !== "guild.trace_event.v1" || event.event_name !== "run_closed"
    || event.run_id !== runId || canonicalInstant(event.at) !== closedAt) return null;
  return Object.freeze({ started_at: startedAt, closed_at: closedAt });
}

function migrationRunCloseIdentityHash(
  runId: string,
  facts: MigrationRunCloseFacts,
  provenanceHash: string,
  sessionContextHash?: string,
  projectedProvenanceHash?: string,
  projectedSessionContextHash?: string,
): string {
  return `sha256:${sha256(canonical({
    schema_version: "guild.provenance.v1",
    run_id: runId,
    started_at: facts.started_at,
    closed_at: facts.closed_at,
    provenance_sha256: provenanceHash,
    ...(sessionContextHash ? { session_context_sha256: sessionContextHash } : {}),
    ...(projectedProvenanceHash ? { projected_provenance_sha256: projectedProvenanceHash } : {}),
    ...(projectedSessionContextHash ? { projected_session_context_sha256: projectedSessionContextHash } : {}),
  }))}`;
}

function receiptPaths(projectRoot: string, runId: string): { journal: string; checkpoint: string } {
  const root = path.join(fs.realpathSync(projectRoot), ".guild", "runs", runId, "receipts");
  return { journal: path.join(root, "journal.jsonl"), checkpoint: path.join(root, "checkpoint.json") };
}

function requireLifecycleStartReceipt(
  paths: { journal: string; checkpoint: string },
  runId: string,
  startedAt: string,
  snapshotHash: string,
): ReceiptRecordV1 {
  const scan = scanReceiptJournal(paths.journal);
  if (scan.integrity !== "intact" || scan.blocks_clean_close
    || compareCheckpointToJournal(readCheckpointState(paths.checkpoint), scan, runId).length > 0) {
    throw new Error("migration baseline requires an intact checkpoint-bound lifecycle start receipt");
  }
  const operationId = `capability-start-snapshot:${runId}`;
  const receipts = scan.records.filter((record) => record.operation_id === operationId);
  const identityHash = capabilityRunStartIdentityHash(runId, startedAt, snapshotHash);
  const outputHash = `sha256:${snapshotHash}`;
  if (receipts.length !== 1) throw new Error("migration baseline requires one lifecycle-produced run-start snapshot receipt");
  const receipt = receipts[0];
  if (receipt.sequence !== 1 || receipt.scenario_id !== "PCL-09" || receipt.event_name !== "receipt.append"
    || receipt.outcome_type !== "guild.capability_outcome.v1" || receipt.disposition !== "succeeded"
    || receipt.observation_state !== "checked_clean" || receipt.input_hash !== identityHash
    || receipt.output_hash !== outputHash || receipt.terminal !== false
    || receipt.recorded_at !== startedAt || receipt.observed_at !== startedAt
    || receipt.versions.host_id !== "guild-lifecycle"
    || receipt.versions.runtime_version !== CAPABILITY_RUN_START_SNAPSHOT_SCHEMA
    || receipt.versions.source_version !== identityHash
    || receipt.versions.contract_version !== "guild.observability.v1") {
    throw new Error("migration lifecycle run-start snapshot receipt is invalid or detached");
  }
  return receipt;
}

/**
 * Append one operation receipt exactly once and repair the checkpoint when the
 * journal append won the crash race. The matching predicate is deliberately
 * supplied by each producer: an operation id alone is not enough to bless a
 * record with detached hashes or timestamps.
 */
function ensureDurableReceipt(
  paths: { journal: string; checkpoint: string },
  runId: string,
  operationId: string,
  input: ReceiptAppendInput,
  matches: (record: ReceiptRecordV1) => boolean,
): ReceiptRecordV1 {
  const inspect = (): { scan: ReturnType<typeof scanReceiptJournal>; matches: ReceiptRecordV1[] } => {
    const scan = scanReceiptJournal(paths.journal);
    return { scan, matches: scan.records.filter((record) => record.operation_id === operationId) };
  };
  const finish = (): ReceiptRecordV1 => {
    let state = inspect();
    if (state.matches.length !== 1 || !matches(state.matches[0])) {
      throw new Error(`${operationId} has no unique matching append-only receipt`);
    }
    if (state.scan.integrity !== "intact" || state.scan.blocks_clean_close) {
      throw new Error(`${operationId} receipt journal is not intact`);
    }
    if (compareCheckpointToJournal(readCheckpointState(paths.checkpoint), state.scan, runId).length > 0) {
      const repaired = reconcileReceiptJournal({
        journalPath: paths.journal,
        checkpointPath: paths.checkpoint,
        run_id: runId,
        producerCheckpoint: { last_sequence: state.scan.last_sequence, record_count: state.scan.records.length },
        reconciled_at: new Date().toISOString(),
        repair_checkpoint: true,
      });
      if (!repaired.checkpoint_repair.verified || repaired.blocks_clean_close) {
        throw new Error(`${operationId} receipt checkpoint recovery failed`);
      }
      state = inspect();
      if (compareCheckpointToJournal(readCheckpointState(paths.checkpoint), state.scan, runId).length > 0) {
        throw new Error(`${operationId} receipt checkpoint remains detached after recovery`);
      }
    }
    return state.matches[0];
  };

  const before = inspect();
  if (before.matches.length > 0) return finish();
  // `uniqueOperation` is enforced inside appendReceipt's retained journal
  // authority. The optimistic inspection above is only a retry fast-path; two
  // processes that both observe absence still cannot append two operation rows.
  const appended = appendReceipt(paths, input, defaultJournalIo, {}, { uniqueOperation: true });
  if (!appended.durable || appended.sequence === null) {
    // appendReceipt may have durably landed the journal line before a checkpoint
    // failure. Re-inspect and reconcile instead of deleting its bound evidence.
    const after = inspect();
    if (after.matches.length === 0) {
      throw new Error(`${operationId} receipt was not durable: ${appended.failure?.message ?? "unknown receipt failure"}`);
    }
  }
  return finish();
}

export function captureMigrationRunBaseline(options: { projectRoot: string; runId: string }): MigrationRunBaselineV1 {
  if (!/^run-\d{8}-\d{6}-[a-z0-9][a-z0-9-]*$/.test(options.runId)) throw new Error(`migration baseline run id is not canonical: ${options.runId}`);
  let runManifest: { readonly started_at: string; readonly capability_start_snapshot_sha256: string | null } | null = null;
  let runManifestBytes: Buffer | null = null;
  try {
    runManifestBytes = readEvidenceFile(options.projectRoot, `.guild/runs/${options.runId}/run.yaml`);
    runManifest = migrationRunManifestFacts(runManifestBytes, options.runId, "open")
      ?? migrationRunManifestFacts(runManifestBytes, options.runId, "closed");
  }
  catch { runManifest = null; }
  if (!runManifest || !runManifestBytes) throw new Error("migration baseline requires the matching guild.run.v1 manifest with a valid started_at");
  const runStartedAt = runManifest.started_at;
  if (!runManifest.capability_start_snapshot_sha256) throw new Error("migration baseline requires a run-start transaction snapshot binding");
  const startSnapshotBytes = readEvidenceFile(options.projectRoot, `.guild/runs/${options.runId}/capability/run-start-snapshot.json`);
  if (sha256(startSnapshotBytes) !== runManifest.capability_start_snapshot_sha256) throw new Error("migration run-start transaction snapshot hash does not match the start manifest");
  const startSnapshot = migrationRunStartSnapshot(startSnapshotBytes, options.runId, runStartedAt);
  if (!startSnapshot) throw new Error("migration run-start transaction snapshot is invalid or detached");
  const boundRoot = baselineBinding(options.projectRoot);
  if (!boundRoot || startSnapshot.bound_root !== boundRoot) throw new Error("migration baseline could not bind the run-start snapshot to this project root");
  const relativePath = `.guild/runs/${options.runId}/capability/run-start-baseline.json`;
  const pendingRelativePath = `.guild/runs/${options.runId}/capability/run-start-baseline.pending.json`;
  const destination = path.join(fs.realpathSync(options.projectRoot), relativePath);
  const pendingDestination = path.join(fs.realpathSync(options.projectRoot), pendingRelativePath);
  const paths = receiptPaths(options.projectRoot, options.runId);
  requireLifecycleStartReceipt(paths, options.runId, runStartedAt, runManifest.capability_start_snapshot_sha256);
  const operationId = `capability-baseline:${options.runId}`;
  const manifestHash = capabilityRunStartIdentityHash(options.runId, runStartedAt, runManifest.capability_start_snapshot_sha256);
  const priorReceipts = scanReceiptJournal(paths.journal).records.filter((record) => record.operation_id === operationId);
  if (priorReceipts.length > 1) throw new Error("migration baseline has duplicate append-only capture receipts");
  let value: MigrationRunBaselineV1 | null = null;
  let baselineBytes: Buffer | null = null;
  let source: "final" | "pending" | "receipt" | "new" = "new";
  for (const candidate of [{ rel: relativePath, kind: "final" as const }, { rel: pendingRelativePath, kind: "pending" as const }]) {
    try {
      const bytes = readEvidenceFile(options.projectRoot, candidate.rel);
      const parsed = validateMigrationRunBaseline(JSON.parse(bytes.toString("utf8")));
      if (!parsed || parsed.run_id !== options.runId || parsed.run_started_at !== runStartedAt || parsed.bound_root !== boundRoot) {
        throw new Error(`migration baseline ${candidate.kind} state is invalid or detached`);
      }
      value = parsed;
      baselineBytes = bytes;
      source = candidate.kind;
      break;
    } catch (error) {
      if (error instanceof Error && /invalid or detached/.test(error.message)) throw error;
    }
  }
  // A pending/final baseline is recoverable only when the journal already owns
  // the matching receipt. A caller-created JSON file is not a transaction intent
  // and must never be upgraded into tool evidence on retry.
  if (value && priorReceipts.length !== 1) {
    throw new Error(`migration baseline ${source} file has no prior append-only capture receipt`);
  }
  if (!value || !baselineBytes) {
    value = startSnapshot;
    baselineBytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
    source = priorReceipts.length === 1 ? "receipt" : "new";
  }
  const baselineHash = `sha256:${sha256(baselineBytes)}`;
  if (priorReceipts.length === 1 && priorReceipts[0].output_hash !== baselineHash) {
    throw new Error("migration baseline receipt landed but the capability trees changed before baseline publication");
  }
  const receiptInput = makeReceiptInput({
      run_id: options.runId,
      operation_id: operationId,
      correlation_id: operationId,
      event_id: `${operationId}:${baselineHash.slice("sha256:".length, "sha256:".length + 12)}`,
      causation_id: null,
      scenario_id: "PCL-09",
      event_name: "receipt.append",
      outcome_type: "guild.capability_outcome.v1",
      disposition: "succeeded",
      observation_state: "checked_clean",
      input_hash: manifestHash,
      output_hash: baselineHash,
      terminal: false,
      recorded_at: value.captured_at,
      observed_at: value.captured_at,
      versions: {
        host_id: "guild-cli",
        host_version: "unknown",
        runtime_version: MIGRATION_RUN_BASELINE_SCHEMA,
        source_version: manifestHash,
        contract_version: "guild.observability.v1",
      },
      affected_event_range: null,
  });
  // The receipt is durable BEFORE any baseline file is created. Consequently a
  // crash can leave (receipt only), (receipt + pending), or the complete final
  // state; every one is recoverable, and a forged pending file alone is refused.
  ensureDurableReceipt(paths, options.runId, operationId, receiptInput, (record) =>
    record.input_hash === manifestHash && record.output_hash === baselineHash
      && record.recorded_at === value!.captured_at && record.observed_at === value!.captured_at
      && record.terminal === false && record.scenario_id === "PCL-09"
      && record.versions.runtime_version === MIGRATION_RUN_BASELINE_SCHEMA
      && record.versions.source_version === manifestHash);
  if (source === "new" || source === "receipt") {
    const staged = writeContainedFile(options.projectRoot, pendingDestination, baselineBytes, { policy: "physical" });
    if (!staged.written) throw new Error(`migration baseline staging refused [${staged.code}]: ${pendingRelativePath}`);
  }
  if (source !== "final") {
    try {
      const existing = readEvidenceFile(options.projectRoot, relativePath);
      if (!existing.equals(baselineBytes)) throw new Error(`migration baseline snapshot collision: ${relativePath}`);
    } catch (error) {
      if (error instanceof Error && error.message.includes("snapshot collision")) throw error;
      const published = writeContainedFile(options.projectRoot, destination, baselineBytes, { policy: "physical" });
      if (!published.written) throw new Error(`migration baseline publish refused [${published.code}]: ${relativePath}`);
    }
  }
  try { fs.unlinkSync(pendingDestination); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  return value;
}

/** Explicit terminal signal for PCL-09 evidence; the Stop hook never emits it. */
export function sealMigrationObservationRun(options: { projectRoot: string; runId: string }): ReceiptRecordV1 {
  return withRunBindingExclusion(options.projectRoot, options.runId, () =>
    sealMigrationObservationRunUnderExclusion(options));
}

function sealMigrationObservationRunUnderExclusion(
  options: { projectRoot: string; runId: string },
): ReceiptRecordV1 {
  const binding = readRunBindingRecord({ root: options.projectRoot, run_id: options.runId });
  if (binding.status !== "ok" || binding.record.state !== "closed") {
    throw new Error("migration run seal requires a valid closed run binding");
  }
  const manifestBytes = readEvidenceFile(options.projectRoot, `.guild/runs/${options.runId}/run.yaml`);
  const manifest = migrationRunManifestFacts(manifestBytes, options.runId, "closed");
  if (!manifest) throw new Error("migration run seal requires a closed guild.run.v1 manifest");
  const provenanceBytes = readEvidenceFile(options.projectRoot, `.guild/runs/${options.runId}/provenance.json`);
  const sessionContextBytes = readEvidenceFile(options.projectRoot, `.guild/runs/${options.runId}/session-context.json`);
  let sessionContext: Record<string, unknown> | null = null;
  try { sessionContext = plainRecord(JSON.parse(sessionContextBytes.toString("utf8"))); } catch { sessionContext = null; }
  if (!sessionContext || sessionContext.schema_version !== "guild.session_context.v1" || sessionContext.run_id !== options.runId || sessionContext.started_at !== manifest.started_at) {
    throw new Error("migration run seal requires the run-time session context");
  }
  let terminalTraceLogBytes: Buffer;
  try { terminalTraceLogBytes = readEvidenceFile(options.projectRoot, `.guild/runs/${options.runId}/logs/v1.4-events.jsonl`); }
  catch { throw new Error("migration run seal requires the referenced run_closed trace event"); }
  const closeFacts = migrationRunCloseFacts(provenanceBytes, terminalTraceLogBytes, options.runId);
  if (!closeFacts || closeFacts.started_at !== manifest.started_at) {
    throw new Error("migration run seal requires matching guild.provenance.v1 lifecycle close evidence");
  }
  let provenance: Record<string, unknown> | null = null;
  try { provenance = plainRecord(JSON.parse(provenanceBytes.toString("utf8"))); } catch { provenance = null; }
  const touched = plainRecord(provenance?.touched);
  const touchedTasks = Array.isArray(touched?.tasks) && touched.tasks.every((task) => typeof task === "string" && task.length > 0)
    ? touched.tasks as string[]
    : [];
  const profileBytes = readEvidenceFile(options.projectRoot, `.guild/runs/${options.runId}/capability/profile.json`);
  let profile: ReturnType<typeof validateProjectCapabilityProfileV1> = null;
  try { profile = validateProjectCapabilityProfileV1(JSON.parse(profileBytes.toString("utf8"))); } catch { profile = null; }
  if (!profile || profile.run_id !== options.runId || profile.mutation_window !== "run" || profile.mutation_performed !== false) {
    throw new Error("migration run seal requires the final whole-run capability profile");
  }
  if (Date.parse(profile.generated_at) > Date.parse(closeFacts.closed_at)) {
    throw new Error("migration run seal requires the final profile before lifecycle close");
  }
  const compatibility = assertQualifyingCompatibilityBeforeClose(options.projectRoot, options.runId, profile.resolver_mode, closeFacts.closed_at);
  const terminalTrees = assertProfileMatchesCurrentCapabilityTrees(options.projectRoot, profile, "migration run seal");
  const sealedAt = new Date().toISOString();
  if (Date.parse(sealedAt) < Date.parse(closeFacts.closed_at)) throw new Error("migration run seal cannot predate lifecycle close");
  requirePreexistingSubstantiveOperationReceipts({
    projectRoot: options.projectRoot,
    runId: options.runId,
    touchedTasks,
    closedAt: closeFacts.closed_at,
    compatibility,
  });
  const operationId = `capability-terminal:${options.runId}`;
  const projectedProvenanceHash = sha256(projectMigrationEvidenceBytes(
    options.projectRoot,
    options.runId,
    `.guild/runs/${options.runId}/provenance.json`,
    `.guild/artifacts/capability/migration-evidence/seal/${options.runId}/provenance.json`,
    provenanceBytes,
  ));
  const projectedSessionContextHash = sha256(projectMigrationEvidenceBytes(
    options.projectRoot,
    options.runId,
    `.guild/runs/${options.runId}/session-context.json`,
    `.guild/artifacts/capability/migration-evidence/seal/${options.runId}/session-context.json`,
    sessionContextBytes,
  ));
  const closeHash = migrationRunCloseIdentityHash(
    options.runId,
    closeFacts,
    sha256(provenanceBytes),
    sha256(sessionContextBytes),
    projectedProvenanceHash,
    projectedSessionContextHash,
  );
  const profileHash = `sha256:${sha256(profileBytes)}`;
  const sealHash = terminalSealOutputHash(profileHash, terminalTrees);
  const input = makeReceiptInput({
    run_id: options.runId,
    operation_id: operationId,
    correlation_id: operationId,
    event_id: `${operationId}:${sealHash.slice("sha256:".length, "sha256:".length + 12)}`,
    causation_id: null,
    scenario_id: "PCL-09",
    event_name: "receipt.append",
    outcome_type: "guild.capability_outcome.v1",
    disposition: "succeeded",
    observation_state: "checked_clean",
    input_hash: closeHash,
    output_hash: sealHash,
    terminal: true,
    recorded_at: sealedAt,
    observed_at: sealedAt,
    versions: { host_id: "guild-cli", host_version: "unknown", runtime_version: MIGRATION_OBSERVATION_SCHEMA, source_version: closeHash, contract_version: "guild.observability.v1" },
    affected_event_range: null,
  });
  const paths = receiptPaths(options.projectRoot, options.runId);
  const sealed = ensureDurableReceipt(paths, options.runId, operationId, input, (record) =>
    record.scenario_id === "PCL-09" && record.event_name === "receipt.append"
      && record.disposition === "succeeded" && record.observation_state === "checked_clean"
      && record.input_hash === closeHash && record.output_hash === sealHash
      && record.terminal === true && record.versions.host_id === "guild-cli"
      && record.versions.runtime_version === MIGRATION_OBSERVATION_SCHEMA
      && record.versions.source_version === closeHash);
  const finalScan = scanReceiptJournal(paths.journal);
  if (finalScan.integrity !== "intact" || finalScan.blocks_clean_close || sealed.sequence !== finalScan.last_sequence
    || compareCheckpointToJournal(readCheckpointState(paths.checkpoint), finalScan, options.runId).length > 0) {
    throw new Error("migration run seal is stale because it is no longer the terminal receipt");
  }
  return sealed;
}

function canonicalRelativePath(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 1024 || value.includes("\\") || path.posix.isAbsolute(value)) return false;
  const segments = value.split("/");
  return segments.every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

function validateEvidenceRef(value: unknown): MigrationEvidenceRefV1 | null {
  const record = plainRecord(value);
  if (!record || !exactKeys(record, ["path", "sha256"]) || !canonicalRelativePath(record.path) || typeof record.sha256 !== "string" || !SHA256.test(record.sha256)) return null;
  return Object.freeze({ path: record.path, sha256: record.sha256 });
}

function parseSubstantiveOperation(value: unknown): MigrationSubstantiveOperationV1 | null {
  const record = plainRecord(value);
  const keys = [
    "schema_version", "run_id", "operation_id", "task_id", "specialist_id", "host_id", "task_run_id", "attempt", "instance_id", "assignment_written_at", "completed_at",
    "compatibility_operation_id", "compatibility_payload_sha256", "assignment_sha256", "handoff_sha256", "handoff_receipt_sha256", "validation_sha256", "attempt_sha256", "acceptance_sha256",
    "projected_assignment_sha256", "projected_handoff_sha256", "projected_handoff_receipt_sha256", "projected_validation_sha256", "projected_attempt_sha256", "projected_acceptance_sha256",
  ];
  if (!record || !exactKeys(record, keys) || record.schema_version !== MIGRATION_SUBSTANTIVE_OPERATION_SCHEMA
    || typeof record.run_id !== "string" || !/^run-\d{8}-\d{6}-[a-z0-9][a-z0-9-]*$/.test(record.run_id)
    || typeof record.operation_id !== "string" || !record.operation_id.startsWith(`substantive-operation:${record.run_id}:`)
    || record.operation_id.startsWith("compatibility-read:")
    || typeof record.task_id !== "string" || !/^[A-Za-z0-9_.-]+$/.test(record.task_id)
    || typeof record.specialist_id !== "string" || !/^[A-Za-z0-9_.-]+$/.test(record.specialist_id)
    || typeof record.host_id !== "string" || !/^[A-Za-z0-9_.-]+$/.test(record.host_id)
    || typeof record.task_run_id !== "string" || !/^[A-Za-z0-9_.-]+$/.test(record.task_run_id)
    || !Number.isInteger(record.attempt) || (record.attempt as number) < 1
    || typeof record.instance_id !== "string" || !/^[A-Za-z0-9_.-]+$/.test(record.instance_id)
    || canonicalInstant(record.assignment_written_at) === null
    || canonicalInstant(record.completed_at) === null
    || typeof record.compatibility_operation_id !== "string" || !record.compatibility_operation_id.startsWith("compatibility-read:")
    || typeof record.compatibility_payload_sha256 !== "string" || !SHA256.test(record.compatibility_payload_sha256)
    || typeof record.assignment_sha256 !== "string" || !SHA256.test(record.assignment_sha256)
    || typeof record.handoff_sha256 !== "string" || !SHA256.test(record.handoff_sha256)
    || typeof record.handoff_receipt_sha256 !== "string" || !SHA256.test(record.handoff_receipt_sha256)
    || typeof record.validation_sha256 !== "string" || !SHA256.test(record.validation_sha256)
    || typeof record.attempt_sha256 !== "string" || !SHA256.test(record.attempt_sha256)
    || typeof record.acceptance_sha256 !== "string" || !SHA256.test(record.acceptance_sha256)
    || typeof record.projected_assignment_sha256 !== "string" || !SHA256.test(record.projected_assignment_sha256)
    || typeof record.projected_handoff_sha256 !== "string" || !SHA256.test(record.projected_handoff_sha256)
    || typeof record.projected_handoff_receipt_sha256 !== "string" || !SHA256.test(record.projected_handoff_receipt_sha256)
    || typeof record.projected_validation_sha256 !== "string" || !SHA256.test(record.projected_validation_sha256)
    || typeof record.projected_attempt_sha256 !== "string" || !SHA256.test(record.projected_attempt_sha256)
    || typeof record.projected_acceptance_sha256 !== "string" || !SHA256.test(record.projected_acceptance_sha256)) return null;
  return Object.freeze(record as unknown as MigrationSubstantiveOperationV1);
}

function readEvidenceFile(projectRoot: string, relativePath: string): Buffer {
  const root = fs.realpathSync(projectRoot);
  const checked = checkContained(root, path.join(root, relativePath), { policy: "physical", requireRegularFileLeaf: true });
  if (isRefused(checked)) throw new Error(`migration evidence ref refused [${checked.code}]: ${relativePath}`);
  const descriptor = fs.openSync(checked.realPath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    if (!fs.fstatSync(descriptor).isFile()) throw new Error(`migration evidence is not a regular file: ${relativePath}`);
    return fs.readFileSync(descriptor);
  } finally { fs.closeSync(descriptor); }
}

function evidenceRef(projectRoot: string, relativePath: string): MigrationEvidenceRefV1 {
  const bytes = readEvidenceFile(projectRoot, relativePath);
  return Object.freeze({ path: relativePath.split(path.sep).join("/"), sha256: sha256(bytes) });
}

interface QualifyingCompatibilityReceipt {
  readonly receipt: ReceiptRecordV1;
  readonly payload: NonNullable<ReturnType<typeof parseCompatibilityUsageV1>>;
}

function readQualifyingCompatibilityReceipts(projectRoot: string, runId: string): readonly QualifyingCompatibilityReceipt[] {
  const paths = receiptPaths(projectRoot, runId);
  const scan = scanReceiptJournal(paths.journal);
  if (scan.integrity !== "intact" || scan.blocks_clean_close
    || compareCheckpointToJournal(readCheckpointState(paths.checkpoint), scan, runId).length > 0) {
    throw new Error("migration run seal requires an intact checkpoint-bound receipt journal");
  }
  const payloadDir = path.join(fs.realpathSync(projectRoot), ".guild", "runs", runId, "receipts", "payloads");
  const checked = checkContained(projectRoot, payloadDir, { policy: "physical" });
  if (isRefused(checked)) throw new Error(`migration run seal payload directory refused [${checked.code}]`);
  const payloads = new Map<string, ReturnType<typeof parseCompatibilityUsageV1>>();
  for (const name of fs.readdirSync(checked.realPath).filter((entry) => entry.endsWith(".compatibility-usage.json"))) {
    const bytes = readEvidenceFile(projectRoot, `.guild/runs/${runId}/receipts/payloads/${name}`);
    let payload: ReturnType<typeof parseCompatibilityUsageV1> = null;
    try { payload = parseCompatibilityUsageV1(JSON.parse(bytes.toString("utf8"))); } catch { payload = null; }
    payloads.set(sha256(bytes), payload);
  }
  const qualifying = scan.records.flatMap((receipt): QualifyingCompatibilityReceipt[] => {
    if (receipt.scenario_id !== "PCL-09" || !receipt.operation_id.startsWith("compatibility-read:") || receipt.output_hash === null) return [];
    const payload = payloads.get(receipt.output_hash);
    return payload?.synthetic === false
      ? [{ receipt, payload }]
      : [];
  });
  return Object.freeze(qualifying);
}

function assertQualifyingCompatibilityBeforeClose(projectRoot: string, runId: string, mode: string, closedAt: string): readonly QualifyingCompatibilityReceipt[] {
  const qualifying = readQualifyingCompatibilityReceipts(projectRoot, runId)
    .filter(({ payload }) => payload.resolver_mode === mode);
  if (qualifying.length === 0) throw new Error(`migration run seal found no non-synthetic PCL-09 ${mode} receipt before lifecycle close`);
  if (qualifying.some(({ receipt }) => Date.parse(receipt.recorded_at) > Date.parse(closedAt))) {
    throw new Error("migration run seal refuses compatibility evidence produced after lifecycle close");
  }
  return Object.freeze(qualifying);
}

interface AcceptedTaskCellFacts {
  readonly task_id: string;
  readonly specialist_id: string;
  readonly host_id: string;
  readonly task_run_id: string;
  readonly attempt: number;
  readonly instance_id: string;
  readonly assignment_written_at: string;
  readonly completed_at: string;
  readonly assignment_sha256: string;
  readonly handoff_sha256: string;
  readonly handoff_receipt_sha256: string;
  readonly validation_sha256: string;
  readonly attempt_sha256: string;
  readonly acceptance_sha256: string;
}

interface AcceptedTaskCellEvidenceBytes {
  readonly assignment: Buffer;
  readonly handoff: Buffer;
  readonly handoff_receipt: Buffer;
  readonly validation: Buffer;
  readonly attempt: Buffer;
  readonly acceptance: Buffer;
}

interface AcceptedTaskCellOperationFacts extends AcceptedTaskCellFacts {
  readonly projected_assignment_sha256: string;
  readonly projected_handoff_sha256: string;
  readonly projected_handoff_receipt_sha256: string;
  readonly projected_validation_sha256: string;
  readonly projected_attempt_sha256: string;
  readonly projected_acceptance_sha256: string;
}

function acceptedTaskCellFactFromBytes(options: {
  readonly runId: string;
  readonly taskId: string;
  readonly attemptNumber: number;
  readonly instanceId: string;
  readonly closedAt: string;
  readonly bytes: AcceptedTaskCellEvidenceBytes;
}): AcceptedTaskCellFacts | null {
  const { runId, taskId, attemptNumber, instanceId, closedAt, bytes } = options;
  let assignment: ReturnType<typeof validateTaskAssignmentV2> = null;
  let attempt: ReturnType<typeof validateTaskAttemptV1> = null;
  let handoff: Record<string, unknown> | null = null;
  let validation: Record<string, unknown> | null = null;
  let acceptance: Record<string, unknown> | null = null;
  try {
    assignment = validateTaskAssignmentV2(JSON.parse(bytes.assignment.toString("utf8")));
    handoff = plainRecord(JSON.parse(bytes.handoff.toString("utf8")));
    validation = plainRecord(JSON.parse(bytes.validation.toString("utf8")));
    attempt = validateTaskAttemptV1(JSON.parse(bytes.attempt.toString("utf8")));
    acceptance = plainRecord(JSON.parse(bytes.acceptance.toString("utf8")));
  } catch { return null; }
  if (!assignment || !attempt || !handoff || !validation || !acceptance) return null;

  let pointerEnvelope: Record<string, unknown> | null = null;
  let receiptFrontmatter: Record<string, unknown> | null = null;
  let receiptText: string;
  try {
    receiptText = bytes.handoff_receipt.toString("utf8");
    pointerEnvelope = plainRecord(extractHandoffEnvelope(receiptText));
    receiptFrontmatter = parseFrontmatter(receiptText);
  } catch { return null; }

  const assignmentWrittenAt = canonicalInstant(assignment.written_at);
  const attemptCreatedAt = canonicalInstant(attempt.created_at);
  const completedAt = canonicalInstant(acceptance.downstream_release_at);
  const terminationAuthorizedAt = canonicalInstant(acceptance.termination_authorized_at);
  const terminatedAt = canonicalInstant(attempt.terminated_at);
  const validatedAt = canonicalInstant(validation.validated_at);
  const pointerSubmittedAt = canonicalInstant(handoff.submitted_at);
  const receiptGeneratedAt = canonicalInstant(receiptFrontmatter?.generated_at);
  const receiptSpecialist = receiptFrontmatter?.specialist ?? receiptFrontmatter?.agent;
  const authorities = Array.isArray(acceptance.authorities_observed) ? acceptance.authorities_observed : [];
  const requiredAuthorities = Array.isArray(acceptance.authorities_required) && acceptance.authorities_required.every((value) => typeof value === "string")
    ? acceptance.authorities_required as string[] : [];
  const acceptedAuthorities = new Set(authorities.flatMap((value) => {
    const authority = plainRecord(value);
    return authority?.decision === "accepted" && typeof authority.authority === "string" ? [authority.authority] : [];
  }));
  const claimedFiles = Array.isArray(handoff.claimed_changed_files) && handoff.claimed_changed_files.every((value) => typeof value === "string")
    ? handoff.claimed_changed_files as string[] : null;
  const scopeValid = claimedFiles !== null && (assignment.scope_paths.length === 0 || claimedFiles.every((file) => assignment!.scope_paths.some((scope) => file === scope || file.startsWith(scope.endsWith("/") ? scope : `${scope}/`))));
  const receiptId = handoff.receipt_id;
  const expectedHandoffKeys = ["receipt_id", "receipt_path", "schema_valid", "claimed_changed_files", "acceptance_tests_passed", "submitted_at"];
  const pointerPath = canonicalRelativePath(handoff.receipt_path) ? handoff.receipt_path : null;
  const pointerShapeValid = exactKeys(handoff, expectedHandoffKeys) && pointerPath !== null
    && pointerPath.startsWith(`.guild/runs/${runId}/handoffs/`) && pointerPath.endsWith(".md")
    && handoff.schema_valid === true && isCanonicalLaneReceipt(receiptText, path.posix.basename(pointerPath))
    && pointerEnvelope !== null && validateHandoffV2(pointerEnvelope).valid
    && pointerEnvelope.task_id === taskId && pointerEnvelope.status === "done"
    && receiptFrontmatter?.task_id === taskId
    && receiptSpecialist === assignment.worker_role
    && receiptGeneratedAt !== null
    && Array.isArray(handoff.acceptance_tests_passed)
    && handoff.acceptance_tests_passed.every((value) => typeof value === "string")
    && assignment.acceptance_tests.every((test) => (handoff.acceptance_tests_passed as string[]).includes(test));

  if (!pointerShapeValid || !scopeValid || typeof receiptId !== "string" || receiptId.length === 0 || !assignmentWrittenAt || !attemptCreatedAt || !validatedAt || !pointerSubmittedAt || !receiptGeneratedAt
    || assignment.run_id !== runId || assignment.logical_task_id !== taskId || assignment.attempt !== attemptNumber || assignment.instance_id !== instanceId
    || validation.schema_version !== "guild.handoff_validation.v1" || validation.validation_result_id !== acceptance.validation_result_id
    || validation.run_id !== runId || validation.cell_id !== assignment.cell_id || validation.logical_task_id !== taskId
    || validation.task_run_id !== assignment.task_run_id || validation.attempt !== attemptNumber || validation.instance_id !== instanceId
    || validation.assignment_id !== `${assignment.task_run_id}:${attemptNumber}:${instanceId}` || validation.receipt_id !== receiptId
    || validation.schema_valid !== true || validation.scope_valid !== true || validation.tests_passed !== true
    || validation.result !== "passed" || validation.reason !== null
    || !Array.isArray(validation.out_of_scope_files) || validation.out_of_scope_files.length !== 0
    || !Array.isArray(validation.failed_acceptance_tests) || validation.failed_acceptance_tests.length !== 0
    || attempt.run_id !== runId || attempt.logical_task_id !== taskId || attempt.attempt !== attemptNumber || attempt.instance_id !== instanceId
    || assignment.task_run_id !== attempt.task_run_id || assignment.attempt_id !== attempt.attempt_id
    || attempt.immutable !== true || attempt.terminal_state !== "terminated"
    || !(
      attempt.orphaned === false
      || (attempt.orphaned === true
        && Number.isInteger(attempt.reap_attempts)
        && attempt.reap_attempts > 0
        && (attempt.terminal_reason === "orphan reaped" || attempt.terminal_reason?.startsWith("reaper:") === true))
    )
    || !terminatedAt || Date.parse(terminatedAt) > Date.parse(closedAt)
    || acceptance.schema_version !== "guild.handoff_acceptance.v1" || acceptance.run_id !== runId || acceptance.logical_task_id !== taskId
    || acceptance.cell_id !== assignment.cell_id || acceptance.task_run_id !== assignment.task_run_id || acceptance.attempt !== attemptNumber || acceptance.instance_id !== instanceId
    || acceptance.assignment_id !== `${assignment.task_run_id}:${attemptNumber}:${instanceId}` || acceptance.receipt_id !== receiptId
    || !completedAt || !terminationAuthorizedAt || Date.parse(completedAt) > Date.parse(closedAt) || Date.parse(terminationAuthorizedAt) > Date.parse(closedAt)
    || Date.parse(assignmentWrittenAt) > Date.parse(attemptCreatedAt)
    || Date.parse(attemptCreatedAt) > Date.parse(receiptGeneratedAt)
    || Date.parse(receiptGeneratedAt) > Date.parse(pointerSubmittedAt)
    || Date.parse(pointerSubmittedAt) > Date.parse(validatedAt) || Date.parse(validatedAt) > Date.parse(completedAt)
    || Date.parse(validatedAt) > Date.parse(terminationAuthorizedAt)
    || Date.parse(completedAt) > Date.parse(terminatedAt) || Date.parse(terminationAuthorizedAt) > Date.parse(terminatedAt)
    || !requiredAuthorities.includes("deterministic_floor") || !requiredAuthorities.includes("team_lead")
    || requiredAuthorities.some((authority) => !acceptedAuthorities.has(authority))
    || !acceptedAuthorities.has("deterministic_floor") || !acceptedAuthorities.has("team_lead")
    || typeof assignment.specialist_profile_id !== "string" || !/^[A-Za-z0-9_.-]+$/.test(assignment.specialist_profile_id)
    || typeof assignment.host_id !== "string" || !/^[A-Za-z0-9_.-]+$/.test(assignment.host_id)) return null;

  return Object.freeze({
    task_id: taskId,
    specialist_id: assignment.specialist_profile_id,
    host_id: assignment.host_id,
    task_run_id: assignment.task_run_id,
    attempt: attemptNumber,
    instance_id: instanceId,
    assignment_written_at: assignmentWrittenAt,
    completed_at: completedAt,
    assignment_sha256: sha256(bytes.assignment),
    handoff_sha256: sha256(bytes.handoff),
    handoff_receipt_sha256: sha256(bytes.handoff_receipt),
    validation_sha256: sha256(bytes.validation),
    attempt_sha256: sha256(bytes.attempt),
    acceptance_sha256: sha256(bytes.acceptance),
  });
}

function acceptedTaskCellFacts(projectRoot: string, runId: string, touchedTasks: readonly string[], closedAt: string): readonly AcceptedTaskCellOperationFacts[] {
  const root = fs.realpathSync(projectRoot);
  const facts: AcceptedTaskCellOperationFacts[] = [];
  for (const taskId of [...new Set(touchedTasks)].sort()) {
    let taskRoot: string;
    try { taskRoot = taskCellPaths({ run_id: runId, logical_task_id: taskId, attempt: 1, instance_id: "probe" }).cell_dir; }
    catch { continue; }
    const attemptsPath = path.join(root, taskRoot, "attempts");
    const checkedAttempts = checkContained(root, attemptsPath, { policy: "physical" });
    if (isRefused(checkedAttempts)) continue;
    let attemptNames: string[];
    try { attemptNames = fs.readdirSync(checkedAttempts.realPath).sort(); } catch { continue; }
    for (const attemptName of attemptNames) {
      const attemptNumber = Number(attemptName);
      if (!Number.isInteger(attemptNumber) || attemptNumber < 1) continue;
      const instancesPath = path.join(checkedAttempts.realPath, attemptName, "instances");
      const checkedInstances = checkContained(root, instancesPath, { policy: "physical" });
      if (isRefused(checkedInstances)) continue;
      let instanceIds: string[];
      try { instanceIds = fs.readdirSync(checkedInstances.realPath).sort(); } catch { continue; }
      for (const instanceId of instanceIds) {
        let paths: ReturnType<typeof taskCellPaths>;
        try { paths = taskCellPaths({ run_id: runId, logical_task_id: taskId, attempt: attemptNumber, instance_id: instanceId }); }
        catch { continue; }
        let assignmentBytes: Buffer; let handoffBytes: Buffer; let validationBytes: Buffer; let attemptBytes: Buffer; let acceptanceBytes: Buffer;
        try {
          assignmentBytes = readEvidenceFile(projectRoot, paths.assignment_path);
          handoffBytes = readEvidenceFile(projectRoot, paths.handoff_path);
          validationBytes = readEvidenceFile(projectRoot, paths.validation_path);
          attemptBytes = readEvidenceFile(projectRoot, paths.attempt_path);
          acceptanceBytes = readEvidenceFile(projectRoot, paths.acceptance_path);
        } catch { continue; }
        let handoff: Record<string, unknown> | null = null;
        try {
          handoff = plainRecord(JSON.parse(handoffBytes.toString("utf8")));
        } catch { handoff = null; }
        const handoffReceiptPath = canonicalRelativePath(handoff?.receipt_path) ? handoff.receipt_path : null;
        let handoffReceiptBytes: Buffer | null = null;
        if (handoffReceiptPath !== null && handoffReceiptPath !== paths.handoff_path) {
          try { handoffReceiptBytes = readEvidenceFile(projectRoot, handoffReceiptPath); }
          catch { handoffReceiptBytes = null; }
        }
        if (!handoffReceiptBytes) continue;
        const fact = acceptedTaskCellFactFromBytes({
          runId, taskId, attemptNumber, instanceId, closedAt,
          bytes: { assignment: assignmentBytes, handoff: handoffBytes, handoff_receipt: handoffReceiptBytes, validation: validationBytes, attempt: attemptBytes, acceptance: acceptanceBytes },
        });
        if (fact) {
          const projected = (sourceRel: string, destinationName: string, bytes: Buffer): string => sha256(projectMigrationEvidenceBytes(
            projectRoot,
            runId,
            sourceRel,
            `.guild/artifacts/capability/migration-evidence/seal/${runId}/${destinationName}`,
            bytes,
          ));
          facts.push(Object.freeze({
            ...fact,
            projected_assignment_sha256: projected(paths.assignment_path, "assignment.json", assignmentBytes),
            projected_handoff_sha256: projected(paths.handoff_path, "handoff.json", handoffBytes),
            projected_handoff_receipt_sha256: projected(handoffReceiptPath!, "handoff-receipt.md", handoffReceiptBytes),
            projected_validation_sha256: projected(paths.validation_path, "handoff-validation.json", validationBytes),
            projected_attempt_sha256: projected(paths.attempt_path, "attempt.json", attemptBytes),
            projected_acceptance_sha256: projected(paths.acceptance_path, "handoff-acceptance.json", acceptanceBytes),
          }));
        }
      }
    }
  }
  return Object.freeze(facts);
}

interface SubstantiveOperationCandidate {
  readonly payload: MigrationSubstantiveOperationV1;
  readonly bytes: Buffer;
  readonly relativePath: string;
  readonly identity: string;
  readonly linked: QualifyingCompatibilityReceipt;
}

function substantiveOperationCandidates(options: {
  readonly projectRoot: string;
  readonly runId: string;
  readonly touchedTasks: readonly string[];
  readonly closedAt: string;
  readonly compatibility: readonly QualifyingCompatibilityReceipt[];
}): readonly SubstantiveOperationCandidate[] {
  const accepted = acceptedTaskCellFacts(options.projectRoot, options.runId, options.touchedTasks, options.closedAt);
  const payloadDirectory = `.guild/runs/${options.runId}/receipts/payloads`;
  const candidates: SubstantiveOperationCandidate[] = [];
  for (const task of accepted) {
    const expectedCompatibilityOperation = `compatibility-read:task-cell-identity-${task.task_id}-${task.specialist_id}`;
    const linked = options.compatibility.find(({ payload, receipt }) => payload.specialist_id === task.specialist_id
      && receipt.versions.host_id === task.host_id
      && receipt.operation_id === expectedCompatibilityOperation
      && Date.parse(receipt.recorded_at) < Date.parse(task.assignment_written_at));
    if (!linked || linked.receipt.output_hash === null) continue;
    const identity = sha256(canonical({ ...task, compatibility_operation_id: linked.receipt.operation_id, compatibility_payload_sha256: linked.receipt.output_hash }));
    const operationId = `substantive-operation:${options.runId}:${identity.slice(0, 16)}`;
    const payload: MigrationSubstantiveOperationV1 = Object.freeze({
      schema_version: MIGRATION_SUBSTANTIVE_OPERATION_SCHEMA,
      run_id: options.runId,
      operation_id: operationId,
      ...task,
      compatibility_operation_id: linked.receipt.operation_id,
      compatibility_payload_sha256: linked.receipt.output_hash,
    });
    const bytes = Buffer.from(`${JSON.stringify(payload, null, 2)}\n`, "utf8");
    const relativePath = `${payloadDirectory}/${identity}.substantive-operation.json`;
    candidates.push(Object.freeze({ payload, bytes, relativePath, identity, linked }));
  }
  return Object.freeze(candidates);
}

/**
 * Record the resolver's actual task-collection operation while the run is open.
 * Accepted TaskCell termination invokes the held-exclusion variant immediately
 * after sealing the terminal attempt; the later migration run seal only verifies
 * that pre-existing receipt and payload. A compatibility-only closed run cannot
 * manufacture substantive evidence while being sealed.
 */
export function recordMigrationSubstantiveTaskOperation(options: {
  readonly projectRoot: string;
  readonly runId: string;
  readonly taskId: string;
}): readonly MigrationSubstantiveOperationV1[] {
  return withRunBindingExclusion(options.projectRoot, options.runId, () =>
    recordMigrationSubstantiveTaskOperationUnderExclusion(options));
}

/**
 * Transactional variant for a caller that already holds the run-binding
 * exclusion. Keeping this separate avoids a nested stable-lock acquisition
 * when terminal-attempt sealing and evidence append must linearize together.
 */
export function recordMigrationSubstantiveTaskOperationUnderExclusion(options: {
  readonly projectRoot: string;
  readonly runId: string;
  readonly taskId: string;
}): readonly MigrationSubstantiveOperationV1[] {
  const binding = readRunBindingRecord({ root: options.projectRoot, run_id: options.runId });
  if (binding.status !== "ok" || binding.record.state !== "open") {
    throw new Error("substantive migration operation must be recorded while the run binding is open");
  }
  const recordedAt = canonicalInstant(new Date().toISOString());
  if (!recordedAt) throw new Error("substantive migration operation requires a canonical recording instant");
  let compatibility: readonly QualifyingCompatibilityReceipt[];
  try { compatibility = readQualifyingCompatibilityReceipts(options.projectRoot, options.runId); }
  catch { return Object.freeze([]); }
  const candidates = substantiveOperationCandidates({
    projectRoot: options.projectRoot,
    runId: options.runId,
    touchedTasks: [options.taskId],
    closedAt: recordedAt,
    compatibility,
  });
  const emitted: MigrationSubstantiveOperationV1[] = [];
  const paths = receiptPaths(options.projectRoot, options.runId);
  for (const { payload, bytes, relativePath, identity, linked } of candidates) {
    const operationId = payload.operation_id;
    const destination = path.join(fs.realpathSync(options.projectRoot), relativePath);
    try {
      const existing = readEvidenceFile(options.projectRoot, relativePath);
      if (!existing.equals(bytes)) throw new Error(`substantive operation payload collision: ${relativePath}`);
    } catch (error) {
      if (error instanceof Error && error.message.includes("payload collision")) throw error;
      const written = writeContainedFile(options.projectRoot, destination, bytes, { policy: "physical" });
      if (!written.written) throw new Error(`substantive operation payload write refused [${written.code}]: ${relativePath}`);
    }
    const outputHash = sha256(bytes);
    const inputHash = `sha256:${identity}`;
    const input = makeReceiptInput({
      run_id: options.runId,
      operation_id: operationId,
      correlation_id: operationId,
      event_id: `${operationId}:${identity.slice(0, 12)}`,
      causation_id: linked.receipt.event_id,
      scenario_id: "PCL-09",
      event_name: "task.collect",
      outcome_type: "guild.capability_outcome.v1",
      disposition: "succeeded",
      observation_state: "checked_clean",
      input_hash: inputHash,
      output_hash: outputHash,
      terminal: false,
      recorded_at: recordedAt,
      observed_at: payload.completed_at,
      versions: linked.receipt.versions,
      affected_event_range: null,
    });
    ensureDurableReceipt(paths, options.runId, operationId, input, (record) => record.scenario_id === "PCL-09"
      && record.event_name === "task.collect" && record.disposition === "succeeded" && record.observation_state === "checked_clean"
      && record.input_hash === inputHash && record.output_hash === outputHash && record.terminal === false
      && canonicalInstant(record.recorded_at) === record.recorded_at && record.observed_at === payload.completed_at
      && Date.parse(record.recorded_at) >= Date.parse(payload.completed_at)
      && Date.parse(record.recorded_at) <= Date.parse(recordedAt)
      && canonical(record.versions) === canonical(linked.receipt.versions));
    emitted.push(payload);
  }
  return Object.freeze(emitted);
}

function requirePreexistingSubstantiveOperationReceipts(options: {
  readonly projectRoot: string;
  readonly runId: string;
  readonly touchedTasks: readonly string[];
  readonly closedAt: string;
  readonly compatibility: readonly QualifyingCompatibilityReceipt[];
}): readonly MigrationSubstantiveOperationV1[] {
  const candidates = substantiveOperationCandidates(options);
  const scan = scanReceiptJournal(receiptPaths(options.projectRoot, options.runId).journal);
  const accepted: MigrationSubstantiveOperationV1[] = [];
  for (const { payload, bytes, relativePath, identity, linked } of candidates) {
    let retained: Buffer;
    try { retained = readEvidenceFile(options.projectRoot, relativePath); }
    catch { continue; }
    if (!retained.equals(bytes)) continue;
    const receipts = scan.records.filter((record) => record.operation_id === payload.operation_id);
    if (receipts.length !== 1) continue;
    const receipt = receipts[0];
    if (receipt.scenario_id !== "PCL-09" || receipt.event_name !== "task.collect"
      || receipt.disposition !== "succeeded" || receipt.observation_state !== "checked_clean"
      || receipt.input_hash !== `sha256:${identity}` || receipt.output_hash !== sha256(bytes)
      || receipt.terminal !== false || receipt.observed_at !== payload.completed_at
      || receipt.causation_id !== linked.receipt.event_id || receipt.correlation_id !== payload.operation_id
      || canonical(receipt.versions) !== canonical(linked.receipt.versions)
      || receipt.sequence <= linked.receipt.sequence
      || Date.parse(receipt.recorded_at) < Date.parse(payload.completed_at)
      || Date.parse(receipt.recorded_at) > Date.parse(options.closedAt)) continue;
    accepted.push(payload);
  }
  if (accepted.length === 0) {
    throw new Error("migration run seal requires a pre-existing resolver-emitted substantive operation recorded before lifecycle close");
  }
  return Object.freeze(accepted);
}

function readRegularFileNoFollow(filePath: string, label: string): Buffer {
  let descriptor: number | null = null;
  try {
    descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    if (!fs.fstatSync(descriptor).isFile()) throw new Error("not a regular file");
    return fs.readFileSync(descriptor);
  } catch (error) {
    throw new Error(`${label} is unreadable: ${error instanceof Error ? error.message : String(error)}`);
  } finally { if (descriptor !== null) fs.closeSync(descriptor); }
}

function snapshotRuntimeFiles(packageRoot: string): readonly MigrationRuntimeFileV1[] {
  const root = fs.realpathSync(packageRoot);
  const entries: MigrationRuntimeFileV1[] = [];
  const visit = (directory: string, relative: string): void => {
    for (const name of fs.readdirSync(directory).sort()) {
      const absolute = path.join(directory, name);
      const childRelative = relative ? `${relative}/${name}` : name;
      const stats = fs.lstatSync(absolute);
      if (stats.isSymbolicLink()) throw new Error(`runtime package contains a symbolic link: ${childRelative}`);
      if (stats.isDirectory()) { visit(absolute, childRelative); continue; }
      if (!stats.isFile()) throw new Error(`runtime package contains a non-regular entry: ${childRelative}`);
      entries.push({ path: childRelative, sha256: sha256(readRegularFileNoFollow(absolute, `runtime package entry ${childRelative}`)) });
    }
  };
  visit(root, "");
  if (entries.length === 0) throw new Error("runtime package tree is empty");
  entries.sort((left, right) => left.path.localeCompare(right.path));
  return Object.freeze(entries.map((entry) => Object.freeze(entry)));
}

/** Deterministic content identity for one generated host package tree. */
export function hashRuntimePackage(packageRoot: string): string {
  return sha256(canonical(snapshotRuntimeFiles(packageRoot)));
}

const COMPATIBILITY_PRODUCER_PATHS = Object.freeze([
  "scripts/lib/capability/compatibility-loader.ts",
]);

export function hashCompatibilityRuntimeProducer(packageRoot: string, hostId: MigrationRuntimeHost): string {
  const root = fs.realpathSync(packageRoot);
  const manifestPath = hostId === "claude-code-cli" ? ".claude-plugin/plugin.json" : ".codex-plugin/plugin.json";
  const paths = [manifestPath, ...COMPATIBILITY_PRODUCER_PATHS];
  const entries = paths.map((relativePath) => Object.freeze({
    path: relativePath,
    sha256: sha256(readRegularFileNoFollow(path.join(root, relativePath), `${hostId} compatibility producer ${relativePath}`)),
  }));
  return sha256(canonical(entries));
}

function runtimePackageBinding(packageRoot: string, hostId: MigrationRuntimeHost, expected?: MigrationRuntimePackageV1): MigrationRuntimeBindingV1 {
  const manifestPath = hostId === "claude-code-cli" ? ".claude-plugin/plugin.json" as const : ".codex-plugin/plugin.json" as const;
  const root = fs.realpathSync(packageRoot);
  const manifestBytes = readRegularFileNoFollow(path.join(root, manifestPath), `${hostId} runtime manifest`);
  const files = expected?.install_files ?? snapshotRuntimeFiles(root);
  const actualFiles = files.map((entry) => Object.freeze({
    path: entry.path,
    sha256: sha256(readRegularFileNoFollow(path.join(root, entry.path), `${hostId} attested runtime file ${entry.path}`)),
  }));
  if (expected && canonical(actualFiles) !== canonical(expected.install_files)) throw new Error(`runtime package files do not match the attested ${hostId} beta package`);
  return Object.freeze({
    host_id: hostId,
    manifest_path: manifestPath,
    manifest_sha256: sha256(manifestBytes),
    producer_sha256: hashCompatibilityRuntimeProducer(root, hostId),
    tree_sha256: expected?.tree_sha256 ?? sha256(canonical(actualFiles)),
    install_surface_sha256: sha256(canonical(actualFiles)),
  });
}

function validateRuntimeBinding(value: unknown, expectedHost?: MigrationRuntimeHost): MigrationRuntimeBindingV1 | null {
  const record = plainRecord(value);
  if (!record || !exactKeys(record, ["host_id", "manifest_path", "manifest_sha256", "producer_sha256", "tree_sha256", "install_surface_sha256"])) return null;
  if (record.host_id !== "claude-code-cli" && record.host_id !== "codex-cli") return null;
  if (expectedHost && record.host_id !== expectedHost) return null;
  const expectedManifest: MigrationRuntimePackageV1["manifest_path"] = record.host_id === "claude-code-cli" ? ".claude-plugin/plugin.json" : ".codex-plugin/plugin.json";
  if (record.manifest_path !== expectedManifest || typeof record.manifest_sha256 !== "string" || !SHA256.test(record.manifest_sha256) || typeof record.producer_sha256 !== "string" || !SHA256.test(record.producer_sha256) || typeof record.tree_sha256 !== "string" || !SHA256.test(record.tree_sha256) || typeof record.install_surface_sha256 !== "string" || !SHA256.test(record.install_surface_sha256)) return null;
  return Object.freeze({ host_id: record.host_id, manifest_path: expectedManifest, manifest_sha256: record.manifest_sha256, producer_sha256: record.producer_sha256, tree_sha256: record.tree_sha256, install_surface_sha256: record.install_surface_sha256 });
}

function validateRuntimePackage(value: unknown, expectedHost?: MigrationRuntimeHost): MigrationRuntimePackageV1 | null {
  const record = plainRecord(value);
  if (!record || !exactKeys(record, ["host_id", "manifest_path", "manifest_sha256", "producer_sha256", "tree_sha256", "install_surface_sha256", "files", "install_files"]) || !Array.isArray(record.files) || record.files.length === 0 || record.files.length > 4096 || !Array.isArray(record.install_files) || record.install_files.length === 0 || record.install_files.length > record.files.length) return null;
  const binding = validateRuntimeBinding({ host_id: record.host_id, manifest_path: record.manifest_path, manifest_sha256: record.manifest_sha256, producer_sha256: record.producer_sha256, tree_sha256: record.tree_sha256, install_surface_sha256: record.install_surface_sha256 }, expectedHost);
  if (!binding) return null;
  const files: MigrationRuntimeFileV1[] = []; const seen = new Set<string>();
  for (const raw of record.files) {
    const file = plainRecord(raw);
    if (!file || !exactKeys(file, ["path", "sha256"]) || !canonicalRelativePath(file.path) || typeof file.sha256 !== "string" || !SHA256.test(file.sha256) || seen.has(file.path)) return null;
    seen.add(file.path); files.push(Object.freeze({ path: file.path, sha256: file.sha256 }));
  }
  files.sort((left, right) => left.path.localeCompare(right.path));
  if (sha256(canonical(files)) !== binding.tree_sha256) return null;
  const installFiles: MigrationRuntimeFileV1[] = [];
  for (const raw of record.install_files) {
    const file = plainRecord(raw);
    if (!file || !exactKeys(file, ["path", "sha256"]) || !canonicalRelativePath(file.path) || typeof file.sha256 !== "string" || !SHA256.test(file.sha256) || !seen.has(file.path) || installFiles.some((entry) => entry.path === file.path)) return null;
    const full = files.find((entry) => entry.path === file.path);
    if (!full || full.sha256 !== file.sha256) return null;
    installFiles.push(Object.freeze({ path: file.path, sha256: file.sha256 }));
  }
  installFiles.sort((left, right) => left.path.localeCompare(right.path));
  if (sha256(canonical(installFiles)) !== binding.install_surface_sha256) return null;
  return Object.freeze({ ...binding, files: Object.freeze(files), install_files: Object.freeze(installFiles) });
}

export function snapshotMigrationRuntimePackage(packageRoot: string, host: MigrationRuntimeHost, supportedInstallRoot?: string): MigrationRuntimePackageV1 {
  const binding = runtimePackageBinding(packageRoot, host);
  const files = snapshotRuntimeFiles(packageRoot);
  const installFiles = supportedInstallRoot === undefined ? files : files.filter((entry) => {
    try { return sha256(readRegularFileNoFollow(path.join(fs.realpathSync(supportedInstallRoot), entry.path), `${host} live install file ${entry.path}`)) === entry.sha256; }
    catch { return false; }
  });
  const requiredInstallPaths = new Set([binding.manifest_path, ...COMPATIBILITY_PRODUCER_PATHS]);
  if ([...requiredInstallPaths].some((required) => !installFiles.some((entry) => entry.path === required))) throw new Error(`supported ${host} install root omits a required compatibility producer file`);
  const value = validateRuntimePackage({ ...binding, install_surface_sha256: sha256(canonical(installFiles)), files, install_files: installFiles }, host);
  if (!value) throw new Error(`generated ${host} runtime package snapshot is invalid`);
  return value;
}

export function verifyInstalledMigrationRuntimePackage(packageRoot: string, expected: MigrationRuntimePackageV1): MigrationRuntimeBindingV1 {
  const runtimePackage = runtimePackageBinding(packageRoot, expected.host_id, expected);
  const expectedBinding = validateRuntimeBinding({
    host_id: expected.host_id,
    manifest_path: expected.manifest_path,
    manifest_sha256: expected.manifest_sha256,
    producer_sha256: expected.producer_sha256,
    tree_sha256: expected.tree_sha256,
    install_surface_sha256: expected.install_surface_sha256,
  }, expected.host_id);
  if (!expectedBinding || canonical(runtimePackage) !== canonical(expectedBinding)) throw new Error(`runtime package does not match the attested ${expected.host_id} beta package`);
  return runtimePackage;
}

export function loadAttestedMigrationBoundary(boundaryPath: string, persistProjectRoot?: string): AttestedMigrationBoundaryV1 {
  let parsed: unknown;
  const boundaryBytes = readRegularFileNoFollow(boundaryPath, "migration boundary");
  try {
    parsed = JSON.parse(boundaryBytes.toString("utf8"));
  } catch (error) {
    throw new Error(`migration boundary is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  const boundary = validateMigrationBoundary(parsed);
  if (boundary === null) throw new Error("migration boundary is invalid or its hash binding does not verify");
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "guild-migration-boundary-"));
  const snapshotPath = path.join(temporaryDirectory, path.basename(boundaryPath));
  try {
    const descriptor = fs.openSync(snapshotPath, "wx", 0o600);
    try { fs.writeFileSync(descriptor, boundaryBytes); fs.fsyncSync(descriptor); }
    finally { fs.closeSync(descriptor); }
    const verifiedAt = verifyMigrationBoundaryProvenance(snapshotPath, boundary);
    if (persistProjectRoot !== undefined) persistBoundaryArtifact(persistProjectRoot, boundary, boundaryBytes);
    return Object.freeze({ boundary, verified_at: verifiedAt });
  } finally { fs.rmSync(temporaryDirectory, { recursive: true, force: true }); }
}

function persistedBoundaryRelativePath(boundary: MigrationBoundaryV1): string {
  return `${MIGRATION_BOUNDARY_EVIDENCE_RELPATH}/${boundary.boundary_hash}/boundary.json`;
}

function persistBoundaryArtifact(projectRoot: string, boundary: MigrationBoundaryV1, bytes: Buffer): void {
  const relativePath = persistedBoundaryRelativePath(boundary);
  const destination = path.join(fs.realpathSync(projectRoot), relativePath);
  try {
    const existing = readEvidenceFile(projectRoot, relativePath);
    if (!existing.equals(bytes)) throw new Error(`persisted migration boundary collision: ${boundary.boundary_hash}`);
    return;
  } catch (error) {
    if (error instanceof Error && error.message.includes("boundary collision")) throw error;
  }
  const written = writeContainedFile(projectRoot, destination, bytes, { policy: "physical" });
  if (!written.written) throw new Error(`persisted migration boundary refused [${written.code}]: ${boundary.boundary_hash}`);
}

/** Re-establish remote provenance for a boundary recovered from durable window state. */
export function verifyPersistedMigrationBoundary(projectRoot: string, expected: MigrationBoundaryV1): void {
  const artifactPath = path.join(fs.realpathSync(projectRoot), persistedBoundaryRelativePath(expected));
  const actual = loadMigrationBoundary(artifactPath);
  if (canonical(actual) !== canonical(expected)) throw new Error(`persisted migration boundary does not match window state: ${expected.boundary_hash}`);
}

export function loadMigrationBoundary(boundaryPath: string): MigrationBoundaryV1 {
  return loadAttestedMigrationBoundary(boundaryPath).boundary;
}

function verifyMigrationBoundaryProvenance(boundaryPath: string, boundary: MigrationBoundaryV1): string {
  if (boundary.workflow.repository !== PRODUCTION_REPOSITORY) throw new Error("migration boundary is not issued by the production repository");
  const ghEnvironment: NodeJS.ProcessEnv = { ...process.env, GH_HOST: "github.com" };
  delete ghEnvironment["GH_ENTERPRISE_TOKEN"];
  let output: string;
  try {
    output = execFileSync("gh", [
      "attestation", "verify", path.resolve(boundaryPath),
      "--hostname", "github.com",
      "--repo", PRODUCTION_REPOSITORY,
      "--signer-workflow", BOUNDARY_SIGNER_WORKFLOW,
      "--source-ref", "refs/heads/next",
      "--source-digest", boundary.source_commit,
      "--deny-self-hosted-runners",
      "--format", "json",
    ], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024, timeout: 30_000, env: ghEnvironment });
  } catch (error) {
    throw new Error(`migration boundary GitHub provenance verification failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    const results = JSON.parse(output);
    if (!Array.isArray(results) || results.length === 0) throw new Error("no verified attestation result");
  } catch (error) {
    throw new Error(`migration boundary GitHub provenance result is invalid: ${error instanceof Error ? error.message : String(error)}`);
  }
  let runResponse: string;
  try {
    runResponse = execFileSync("gh", ["api", "--hostname", "github.com", "--include", `repos/${PRODUCTION_REPOSITORY}/actions/runs/${boundary.workflow.run_id}`], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024, timeout: 30_000, env: ghEnvironment });
  } catch (error) {
    throw new Error(`migration boundary GitHub run verification failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  const separator = Math.max(runResponse.lastIndexOf("\r\n\r\n"), runResponse.lastIndexOf("\n\n"));
  const headerBlock = separator >= 0 ? runResponse.slice(0, separator) : "";
  const jsonBody = separator >= 0 ? runResponse.slice(separator + (runResponse.startsWith("\r\n", separator) ? 4 : 2)).trim() : "";
  const headerMatch = /(?:^|\n)date:\s*([^\r\n]+)/i.exec(headerBlock);
  const verifiedAtMillis = headerMatch ? Date.parse(headerMatch[1].trim()) : Number.NaN;
  if (!headerMatch || !Number.isFinite(verifiedAtMillis) || !jsonBody.startsWith("{")) throw new Error("migration boundary GitHub run response has no valid server Date header or JSON body");
  const verifiedAt = new Date(verifiedAtMillis).toISOString();
  let run: Record<string, unknown> | null = null;
  try { run = plainRecord(JSON.parse(jsonBody)); } catch { /* refusal below */ }
  if (!run || run.head_sha !== boundary.source_commit || run.head_branch !== "next" || run.event !== "push" || run.status !== "completed" || run.conclusion !== "success") {
    throw new Error("migration boundary GitHub run metadata does not match a successful next push for the attested commit");
  }
  return verifiedAt;
}

export function validateMigrationObservation(value: unknown): MigrationObservation | null {
  const record = plainRecord(value);
  const isV2 = record?.schema_version === MIGRATION_OBSERVATION_SCHEMA;
  const isV1 = record?.schema_version === MIGRATION_OBSERVATION_SCHEMA_V1;
  if (!record || !exactKeys(record, [
    "schema_version", "boundary_hash", "boundary_release", "boundary_source_commit", "boundary_merged_at", "observed_at", "runtime_package",
    "project_id", "mode", "runs", "verdict", "observation_hash",
  ])) return null;
  if ((!isV1 && !isV2) || (record.mode !== "observe" && record.mode !== "shadow") || record.verdict !== "non_synthetic_runtime") return null;
  if (typeof record.boundary_hash !== "string" || !SHA256.test(record.boundary_hash)) return null;
  if (typeof record.boundary_release !== "string" || !BETA.test(record.boundary_release)) return null;
  if (typeof record.boundary_source_commit !== "string" || !COMMIT.test(record.boundary_source_commit)) return null;
  const boundaryMergedAt = canonicalInstant(record.boundary_merged_at);
  if (boundaryMergedAt === null || boundaryMergedAt !== record.boundary_merged_at) return null;
  const observedAt = canonicalInstant(record.observed_at);
  if (observedAt === null || observedAt !== record.observed_at || Date.parse(observedAt) < Date.parse(boundaryMergedAt)) return null;
  const runtimePackage = validateRuntimeBinding(record.runtime_package);
  if (!runtimePackage) return null;
  if (typeof record.project_id !== "string" || !/^[a-z0-9][a-z0-9._-]{0,127}$/.test(record.project_id)) return null;
  if (typeof record.observation_hash !== "string" || !SHA256.test(record.observation_hash) || !Array.isArray(record.runs) || record.runs.length === 0 || record.runs.length > 64) return null;
  const runs: (MigrationObservationRunV1 | MigrationObservationRunV2)[] = [];
  const seenRuns = new Set<string>();
  for (const rawRun of record.runs) {
    const run = plainRecord(rawRun);
    const historicalV2Keys = ["run_id", "run_manifest", "provenance", "terminal_trace_log", "start_snapshot", "baseline", "profile", "journal", "checkpoint", "compatibility_payloads"];
    const projectedV2Keys = [...historicalV2Keys, "source_provenance_sha256", "source_session_context_sha256", "session_context"];
    const substantiveProjectedV2Keys = [...projectedV2Keys, "substantive_operations", "substantive_evidence"];
    if (!run || !(isV2 ? exactKeys(run, historicalV2Keys) || exactKeys(run, projectedV2Keys) || exactKeys(run, substantiveProjectedV2Keys) : exactKeys(run, ["run_id", "profile", "journal", "checkpoint", "compatibility_payloads"]))) return null;
    if (typeof run.run_id !== "string" || !/^run-\d{8}-\d{6}-[a-z0-9][a-z0-9-]*$/.test(run.run_id) || seenRuns.has(run.run_id)) return null;
    const profile = validateEvidenceRef(run.profile);
    const runManifest = isV2 ? validateEvidenceRef(run.run_manifest) : null;
    const provenance = isV2 ? validateEvidenceRef(run.provenance) : null;
    const sessionContext = isV2 && Object.prototype.hasOwnProperty.call(run, "session_context") ? validateEvidenceRef(run.session_context) : null;
    const sourceProvenanceSha256 = isV2 && Object.prototype.hasOwnProperty.call(run, "source_provenance_sha256") && typeof run.source_provenance_sha256 === "string" && SHA256.test(run.source_provenance_sha256)
      ? run.source_provenance_sha256
      : null;
    const sourceSessionContextSha256 = isV2 && Object.prototype.hasOwnProperty.call(run, "source_session_context_sha256") && typeof run.source_session_context_sha256 === "string" && SHA256.test(run.source_session_context_sha256)
      ? run.source_session_context_sha256
      : null;
    const terminalTraceLog = isV2 ? validateEvidenceRef(run.terminal_trace_log) : null;
    const startSnapshot = isV2 ? validateEvidenceRef(run.start_snapshot) : null;
    const baseline = isV2 ? validateEvidenceRef(run.baseline) : null;
    const journal = validateEvidenceRef(run.journal);
    const checkpoint = validateEvidenceRef(run.checkpoint);
    const projectedFieldsPresent = Object.prototype.hasOwnProperty.call(run, "session_context") || Object.prototype.hasOwnProperty.call(run, "source_provenance_sha256") || Object.prototype.hasOwnProperty.call(run, "source_session_context_sha256");
    if (!profile || (isV2 && (!runManifest || !provenance || !terminalTraceLog || !startSnapshot || !baseline || (projectedFieldsPresent && (!sessionContext || !sourceProvenanceSha256 || !sourceSessionContextSha256)))) || !journal || !checkpoint || !Array.isArray(run.compatibility_payloads) || run.compatibility_payloads.length === 0 || run.compatibility_payloads.length > 256) return null;
    const payloads: MigrationEvidenceRefV1[] = [];
    const seenPayloads = new Set<string>();
    for (const rawPayload of run.compatibility_payloads) {
      const payload = validateEvidenceRef(rawPayload);
      if (!payload || seenPayloads.has(payload.path)) return null;
      seenPayloads.add(payload.path);
      payloads.push(payload);
    }
    let substantiveOperations: MigrationEvidenceRefV1[] | undefined;
    let substantiveEvidence: MigrationEvidenceRefV1[] | undefined;
    if (Object.prototype.hasOwnProperty.call(run, "substantive_operations")) {
      if (!Array.isArray(run.substantive_operations) || run.substantive_operations.length === 0 || run.substantive_operations.length > 256) return null;
      substantiveOperations = [];
      for (const rawOperation of run.substantive_operations) {
        const operation = validateEvidenceRef(rawOperation);
        if (!operation || seenPayloads.has(operation.path)) return null;
        seenPayloads.add(operation.path);
        substantiveOperations.push(operation);
      }
      if (!Array.isArray(run.substantive_evidence) || run.substantive_evidence.length < substantiveOperations.length * 6 || run.substantive_evidence.length > 1536) return null;
      substantiveEvidence = [];
      for (const rawEvidence of run.substantive_evidence) {
        const evidence = validateEvidenceRef(rawEvidence);
        if (!evidence || seenPayloads.has(evidence.path)) return null;
        seenPayloads.add(evidence.path);
        substantiveEvidence.push(evidence);
      }
    }
    seenRuns.add(run.run_id);
    runs.push(Object.freeze({ run_id: run.run_id, ...(runManifest ? { run_manifest: runManifest } : {}), ...(provenance ? { provenance } : {}), ...(sourceProvenanceSha256 ? { source_provenance_sha256: sourceProvenanceSha256 } : {}), ...(sourceSessionContextSha256 ? { source_session_context_sha256: sourceSessionContextSha256 } : {}), ...(terminalTraceLog ? { terminal_trace_log: terminalTraceLog } : {}), ...(startSnapshot ? { start_snapshot: startSnapshot } : {}), ...(baseline ? { baseline } : {}), ...(sessionContext ? { session_context: sessionContext } : {}), ...(substantiveOperations ? { substantive_operations: Object.freeze(substantiveOperations), substantive_evidence: Object.freeze(substantiveEvidence!) } : {}), profile, journal, checkpoint, compatibility_payloads: Object.freeze(payloads) }));
  }
  const candidate = {
    schema_version: record.schema_version as typeof MIGRATION_OBSERVATION_SCHEMA | typeof MIGRATION_OBSERVATION_SCHEMA_V1,
    boundary_hash: record.boundary_hash,
    boundary_release: record.boundary_release,
    boundary_source_commit: record.boundary_source_commit,
    boundary_merged_at: record.boundary_merged_at,
    observed_at: record.observed_at,
    runtime_package: runtimePackage,
    project_id: record.project_id,
    mode: record.mode as "observe" | "shadow",
    runs: Object.freeze(runs),
    verdict: "non_synthetic_runtime" as const,
  };
  if (record.observation_hash !== observationHash(candidate)) return null;
  return Object.freeze({ ...candidate, observation_hash: record.observation_hash }) as MigrationObservation;
}

export function verifyMigrationObservation(projectRoot: string, value: unknown, stagedSnapshots?: ReadonlyMap<string, Buffer>): MigrationObservation {
  const observation = validateMigrationObservation(value);
  if (observation === null) throw new Error("migration observation is invalid or its hash binding does not verify");
  const baselineBoundV2 = observation.schema_version === MIGRATION_OBSERVATION_SCHEMA;
  const profileInstants: number[] = [];
    for (const run of observation.runs) {
      const expectedPrefix = `.guild/artifacts/capability/migration-evidence/${observation.boundary_hash}/${run.run_id}/`;
    const v2Run = observation.schema_version === MIGRATION_OBSERVATION_SCHEMA ? run as MigrationObservationRunV2 : null;
    const runManifestRef = v2Run?.run_manifest ?? null;
    const provenanceRef = v2Run?.provenance ?? null;
    const sourceProvenanceSha256 = v2Run?.source_provenance_sha256 ?? null;
    const sourceSessionContextSha256 = v2Run?.source_session_context_sha256 ?? null;
    const terminalTraceLogRef = v2Run?.terminal_trace_log ?? null;
    const startSnapshotRef = v2Run?.start_snapshot ?? null;
    const baselineRef = v2Run?.baseline ?? null;
    const sessionContextRef = v2Run?.session_context ?? null;
    const substantiveOperationRefs = v2Run?.substantive_operations ?? [];
    const substantiveEvidenceRefs = v2Run?.substantive_evidence ?? [];
    if ((runManifestRef && runManifestRef.path !== `${expectedPrefix}run.yaml`) || (provenanceRef && provenanceRef.path !== `${expectedPrefix}provenance.json`) || (terminalTraceLogRef && terminalTraceLogRef.path !== `${expectedPrefix}terminal-trace-log.jsonl`) || (startSnapshotRef && startSnapshotRef.path !== `${expectedPrefix}run-start-snapshot.json`) || (baselineRef && baselineRef.path !== `${expectedPrefix}baseline.json`) || (sessionContextRef && sessionContextRef.path !== `${expectedPrefix}session-context.json`) || run.profile.path !== `${expectedPrefix}profile.json` || run.journal.path !== `${expectedPrefix}journal.jsonl` || run.checkpoint.path !== `${expectedPrefix}checkpoint.json`) {
      throw new Error(`migration observation run ${run.run_id} has non-canonical evidence paths`);
    }
    const snapshots = new Map<string, Buffer>();
    for (const ref of [...(runManifestRef ? [runManifestRef] : []), ...(provenanceRef ? [provenanceRef] : []), ...(terminalTraceLogRef ? [terminalTraceLogRef] : []), ...(startSnapshotRef ? [startSnapshotRef] : []), ...(baselineRef ? [baselineRef] : []), ...(sessionContextRef ? [sessionContextRef] : []), run.profile, run.journal, run.checkpoint, ...run.compatibility_payloads, ...substantiveOperationRefs, ...substantiveEvidenceRefs]) {
      if (!ref.path.startsWith(expectedPrefix)) throw new Error(`migration observation evidence path mismatch: ${ref.path}`);
      const bytes = stagedSnapshots?.get(ref.path) ?? readEvidenceFile(projectRoot, ref.path);
      if (sha256(bytes) !== ref.sha256) throw new Error(`migration observation evidence hash mismatch: ${ref.path}`);
      snapshots.set(ref.path, bytes);
    }
    let rawProfile: unknown;
    try { rawProfile = JSON.parse(snapshots.get(run.profile.path)!.toString("utf8")); }
    catch { throw new Error(`migration observation profile is unreadable: ${run.profile.path}`); }
    const profile = validateProjectCapabilityProfileV1(rawProfile);
    if (!profile || profile.run_id !== run.run_id || profile.project_id !== observation.project_id || profile.source_commit === null || !COMMIT.test(profile.source_commit) || profile.resolver_mode !== observation.mode || profile.mutation_window !== "run" || profile.mutation_performed !== false || Date.parse(profile.generated_at) < Date.parse(observation.boundary_merged_at)) {
      throw new Error(`migration observation requires a whole-run ${observation.mode} profile for ${run.run_id}`);
    }
    let baseline: MigrationRunBaselineV1 | null = null;
    if (baselineRef) {
      try { baseline = validateMigrationRunBaseline(JSON.parse(snapshots.get(baselineRef.path)!.toString("utf8"))); }
      catch { baseline = null; }
      // Creation verifies the retained baseline against the physical source
      // checkout. Published evidence is intentionally portable: after its
      // atomic projection lands in git, a clone or worktree has a different
      // realpath. At that point the retained run-start snapshot (checked below),
      // profile hashes, journal, and terminal seal are the binding authority;
      // recomputing today's checkout path would reject unchanged evidence.
      const expectedBinding = stagedSnapshots ? baselineBinding(projectRoot) : baseline?.bound_root ?? null;
      if (!baseline || baseline.run_id !== run.run_id || baseline.bound_run_id !== run.run_id || expectedBinding === null || baseline.bound_root !== expectedBinding
        || baseline.agents !== profile.mutation_evidence.agents_tree_hash_before
        || baseline.skills !== profile.mutation_evidence.skills_tree_hash_before
        || baseline.registries !== profile.mutation_evidence.registry_hash_before) {
        throw new Error(`migration observation run-start baseline is invalid or detached for ${run.run_id}`);
      }
    }
    let retainedRunManifest: { readonly started_at: string; readonly capability_start_snapshot_sha256: string | null } | null = null;
    let retainedCloseFacts: MigrationRunCloseFacts | null = null;
    if (runManifestRef && baseline) {
      retainedRunManifest = migrationRunManifestFacts(snapshots.get(runManifestRef.path)!, run.run_id, "closed", sessionContextRef ? "run-start-snapshot.json" : "capability/run-start-snapshot.json");
      if (!retainedRunManifest || retainedRunManifest.started_at !== baseline.run_started_at) {
        throw new Error(`migration observation retained run manifest is invalid or detached for ${run.run_id}`);
      }
      const retainedStart = startSnapshotRef
        ? migrationRunStartSnapshot(snapshots.get(startSnapshotRef.path)!, run.run_id, retainedRunManifest.started_at)
        : null;
      if (!retainedStart || retainedRunManifest.capability_start_snapshot_sha256 !== startSnapshotRef?.sha256
        || canonical(retainedStart) !== canonical(baseline)) {
        throw new Error(`migration observation retained run-start transaction snapshot is invalid or detached for ${run.run_id}`);
      }
    }
    if (sessionContextRef && retainedRunManifest) {
      let session: Record<string, unknown> | null = null;
      try { session = plainRecord(JSON.parse(snapshots.get(sessionContextRef.path)!.toString("utf8"))); } catch { session = null; }
      const host = plainRecord(session?.host);
      const identity = plainRecord(session?.identity);
      if (!session || session.schema_version !== "guild.session_context.v1" || session.run_id !== run.run_id || session.started_at !== retainedRunManifest.started_at
        || !host || host.family === "unknown" || host.surface === "unknown" || host.adapter_id === "unknown" || host.adapter_version === "unknown"
        || !identity || identity.trust !== "verified" || identity.confidence !== "high" || (identity.source !== "native_adapter" && identity.source !== "host_handshake")) {
        throw new Error(`migration observation requires a verified high-confidence session identity for ${run.run_id}`);
      }
    }
    if (provenanceRef && terminalTraceLogRef && retainedRunManifest) {
      retainedCloseFacts = migrationRunCloseFacts(snapshots.get(provenanceRef.path)!, snapshots.get(terminalTraceLogRef.path)!, run.run_id, sessionContextRef ? "terminal-trace-log.jsonl" : `.guild/runs/${run.run_id}/logs/v1.4-events.jsonl`);
      if (!retainedCloseFacts || retainedCloseFacts.started_at !== retainedRunManifest.started_at) {
        throw new Error(`migration observation retained close provenance is invalid or detached for ${run.run_id}`);
      }
      if (Date.parse(profile.generated_at) > Date.parse(retainedCloseFacts.closed_at)) {
        throw new Error(`migration observation profile was produced after lifecycle close for ${run.run_id}`);
      }
    }
    let retainedTouchedTasks = new Set<string>();
    if (sessionContextRef && provenanceRef && substantiveOperationRefs.length > 0) {
      let retainedProvenance: Record<string, unknown> | null = null;
      try { retainedProvenance = plainRecord(JSON.parse(snapshots.get(provenanceRef.path)!.toString("utf8"))); } catch { retainedProvenance = null; }
      const touched = plainRecord(retainedProvenance?.touched);
      if (!touched || !Array.isArray(touched.tasks) || touched.tasks.length === 0 || touched.tasks.some((task) => typeof task !== "string" || task.length === 0)) {
        throw new Error(`migration observation requires substantive touched.tasks evidence for ${run.run_id}`);
      }
      retainedTouchedTasks = new Set(touched.tasks as string[]);
    }
    profileInstants.push(Date.parse(profile.generated_at));
    const journalPath = path.join(fs.realpathSync(projectRoot), run.journal.path);
    const checkpointPath = path.join(fs.realpathSync(projectRoot), run.checkpoint.path);
    const snapshotIo = {
      ...defaultJournalIo,
      readAll: (target: string) => target === journalPath ? snapshots.get(run.journal.path)!.toString("utf8") : target === checkpointPath ? snapshots.get(run.checkpoint.path)!.toString("utf8") : null,
    };
    const scan = scanReceiptJournal(journalPath, snapshotIo);
    if (scan.integrity !== "intact" || scan.blocks_clean_close || scan.run_ids.length !== 1 || scan.run_ids[0] !== run.run_id || compareCheckpointToJournal(readCheckpointState(checkpointPath, snapshotIo), scan, run.run_id).length > 0) {
      throw new Error(`migration observation receipt journal is not intact and checkpoint-bound for ${run.run_id}`);
    }
    const expectedPayloadHashes = new Set(run.compatibility_payloads.map((ref) => ref.sha256));
    let qualifying = 0;
    let earliestQualifyingReceipt = Number.POSITIVE_INFINITY;
    let latestQualifyingReceipt = Number.NEGATIVE_INFINITY;
    let earliestQualifyingSequence = Number.POSITIVE_INFINITY;
    const qualifyingCompatibility = new Map<string, { readonly receipt: ReceiptRecordV1; readonly specialist_id: string; readonly payload_sha256: string }>();
    const baselineReceipts = baseline && runManifestRef && baselineRef
      ? scan.records.filter((receipt) => receipt.operation_id === `capability-baseline:${run.run_id}`)
      : [];
    const lifecycleStartReceipts = baseline && runManifestRef && startSnapshotRef
      ? scan.records.filter((receipt) => receipt.operation_id === `capability-start-snapshot:${run.run_id}`)
      : [];
    const terminalReceipts = baseline && runManifestRef && provenanceRef
      ? scan.records.filter((receipt) => receipt.operation_id === `capability-terminal:${run.run_id}`)
      : [];
    if (baseline && runManifestRef && baselineRef) {
      const expectedBaselineHash = `sha256:${baselineRef.sha256}`;
      const expectedSnapshotHash = retainedRunManifest!.capability_start_snapshot_sha256!;
      const expectedManifestHash = capabilityRunStartIdentityHash(run.run_id, retainedRunManifest!.started_at, expectedSnapshotHash);
      if (lifecycleStartReceipts.length !== 1) throw new Error(`migration observation has no unique lifecycle start receipt for ${run.run_id}`);
      const lifecycleCapture = lifecycleStartReceipts[0];
      if (lifecycleCapture.sequence !== 1
        || lifecycleCapture.scenario_id !== "PCL-09"
        || lifecycleCapture.event_name !== "receipt.append"
        || lifecycleCapture.outcome_type !== "guild.capability_outcome.v1"
        || lifecycleCapture.disposition !== "succeeded"
        || lifecycleCapture.observation_state !== "checked_clean"
        || lifecycleCapture.input_hash !== expectedManifestHash
        || lifecycleCapture.output_hash !== `sha256:${expectedSnapshotHash}`
        || lifecycleCapture.recorded_at !== baseline.run_started_at
        || lifecycleCapture.observed_at !== baseline.run_started_at
        || lifecycleCapture.terminal !== false
        || lifecycleCapture.versions.host_id !== "guild-lifecycle"
        || lifecycleCapture.versions.runtime_version !== CAPABILITY_RUN_START_SNAPSHOT_SCHEMA
        || lifecycleCapture.versions.source_version !== expectedManifestHash
        || lifecycleCapture.versions.contract_version !== "guild.observability.v1") {
        throw new Error(`migration observation lifecycle start receipt is invalid or detached for ${run.run_id}`);
      }
      if (baselineReceipts.length !== 1) throw new Error(`migration observation baseline has no unique append-only capture receipt for ${run.run_id}`);
      const capture = baselineReceipts[0];
      if (capture.scenario_id !== "PCL-09"
        || capture.event_name !== "receipt.append"
        || capture.outcome_type !== "guild.capability_outcome.v1"
        || capture.disposition !== "succeeded"
        || capture.observation_state !== "checked_clean"
        || capture.input_hash !== expectedManifestHash
        || capture.output_hash !== expectedBaselineHash
        || capture.recorded_at !== baseline.captured_at
        || capture.observed_at !== baseline.captured_at
        || capture.terminal !== false
        || capture.versions.host_id !== "guild-cli"
        || capture.versions.runtime_version !== MIGRATION_RUN_BASELINE_SCHEMA
        || capture.versions.source_version !== expectedManifestHash
        || capture.versions.contract_version !== "guild.observability.v1") {
        throw new Error(`migration observation baseline capture receipt is invalid or detached for ${run.run_id}`);
      }
      if (lifecycleCapture.sequence >= capture.sequence) throw new Error(`migration observation lifecycle start receipt does not precede baseline publication for ${run.run_id}`);
    }
    for (const receipt of scan.records) {
      if (receipt.scenario_id !== "PCL-09"
        || !receipt.operation_id.startsWith("compatibility-read:")
        || receipt.versions.host_id !== observation.runtime_package.host_id
        || receipt.versions.runtime_version !== observation.boundary_release
        || receipt.versions.source_version !== `sha256:${observation.runtime_package.producer_sha256}`
        || receipt.output_hash === null
        || !expectedPayloadHashes.has(receipt.output_hash)) continue;
      const payloadRef = run.compatibility_payloads.find((ref) => ref.sha256 === receipt.output_hash)!;
      let rawPayload: unknown;
      try { rawPayload = JSON.parse(snapshots.get(payloadRef.path)!.toString("utf8")); } catch { continue; }
      const payload = parseCompatibilityUsageV1(rawPayload);
      if (payload && payload.resolver_mode === observation.mode && payload.synthetic === false && (!sessionContextRef || payload.specialist_id !== null)) {
        qualifying += 1;
        if (payload.specialist_id !== null) qualifyingCompatibility.set(receipt.operation_id, { receipt, specialist_id: payload.specialist_id, payload_sha256: payloadRef.sha256 });
        earliestQualifyingReceipt = Math.min(earliestQualifyingReceipt, Date.parse(receipt.recorded_at));
        latestQualifyingReceipt = Math.max(latestQualifyingReceipt, Date.parse(receipt.recorded_at));
        earliestQualifyingSequence = Math.min(earliestQualifyingSequence, receipt.sequence);
      }
    }
    if (qualifying === 0) throw new Error(`migration observation has no non-synthetic PCL-09 ${observation.mode} receipt with substantive specialist binding for ${run.run_id} at ${observation.boundary_release}`);
    if (baselineReceipts.length === 1 && baselineReceipts[0].sequence >= earliestQualifyingSequence) throw new Error(`migration observation baseline capture receipt does not precede compatibility dispatch for ${run.run_id}`);
    // Journal sequence is the authoritative ordering proof. Filesystems and the
    // RFC3339 clock can legitimately place the baseline and first dispatch in
    // the same millisecond, so equality is not evidence of reversed order.
    if (baseline && Date.parse(baseline.captured_at) > earliestQualifyingReceipt) throw new Error(`migration observation baseline does not precede compatibility dispatch for ${run.run_id}`);
    if (baselineBoundV2 && Date.parse(profile.generated_at) < earliestQualifyingReceipt) throw new Error(`migration observation profile predates compatibility dispatch for ${run.run_id}`);
    if (retainedCloseFacts && latestQualifyingReceipt > Date.parse(retainedCloseFacts.closed_at)) {
      throw new Error(`migration observation compatibility evidence was produced after lifecycle close for ${run.run_id}`);
    }
    const usedSubstantiveEvidencePaths = new Set<string>();
    for (const operationRef of substantiveOperationRefs) {
      let rawOperation: unknown;
      try { rawOperation = JSON.parse(snapshots.get(operationRef.path)!.toString("utf8")); }
      catch { throw new Error(`migration observation substantive operation is unreadable: ${operationRef.path}`); }
      const operation = parseSubstantiveOperation(rawOperation);
      const linked = operation ? qualifyingCompatibility.get(operation.compatibility_operation_id) : undefined;
      const receipts = operation ? scan.records.filter((receipt) => receipt.operation_id === operation.operation_id) : [];
      const receipt = receipts.length === 1 ? receipts[0] : null;
      let retainedTask: AcceptedTaskCellFacts | null = null;
      if (operation && retainedCloseFacts) {
        const attemptPrefix = `${expectedPrefix}task-cells/${operation.task_id}/attempts/${operation.attempt}`;
        const instancePrefix = `${attemptPrefix}/instances/${operation.instance_id}`;
        const evidenceByPath = new Map(substantiveEvidenceRefs.map((ref) => [ref.path, ref]));
        const assignmentRef = evidenceByPath.get(`${instancePrefix}/assignment.json`);
        const handoffRef = evidenceByPath.get(`${instancePrefix}/handoff.json`);
        const handoffReceiptRef = evidenceByPath.get(`${instancePrefix}/handoff-receipt.md`);
        const validationRef = evidenceByPath.get(`${instancePrefix}/handoff-validation.json`);
        const attemptRef = evidenceByPath.get(`${attemptPrefix}/attempt.json`);
        const acceptanceRef = evidenceByPath.get(`${instancePrefix}/handoff-acceptance.json`);
        if (assignmentRef && handoffRef && handoffReceiptRef && validationRef && attemptRef && acceptanceRef) {
          for (const ref of [assignmentRef, handoffRef, handoffReceiptRef, validationRef, attemptRef, acceptanceRef]) usedSubstantiveEvidencePaths.add(ref.path);
          retainedTask = acceptedTaskCellFactFromBytes({
            runId: run.run_id,
            taskId: operation.task_id,
            attemptNumber: operation.attempt,
            instanceId: operation.instance_id,
            closedAt: retainedCloseFacts.closed_at,
            bytes: {
              assignment: snapshots.get(assignmentRef.path)!,
              handoff: snapshots.get(handoffRef.path)!,
              handoff_receipt: snapshots.get(handoffReceiptRef.path)!,
              validation: snapshots.get(validationRef.path)!,
              attempt: snapshots.get(attemptRef.path)!,
              acceptance: snapshots.get(acceptanceRef.path)!,
            },
          });
        }
      }
      if (!operation || operation.run_id !== run.run_id || !retainedTouchedTasks.has(operation.task_id)
        || operation.host_id !== observation.runtime_package.host_id
        || !retainedTask || canonical(retainedTask) !== canonical({
          task_id: operation.task_id,
          specialist_id: operation.specialist_id,
          host_id: operation.host_id,
          task_run_id: operation.task_run_id,
          attempt: operation.attempt,
          instance_id: operation.instance_id,
          assignment_written_at: operation.assignment_written_at,
          completed_at: operation.completed_at,
          assignment_sha256: operation.projected_assignment_sha256,
          handoff_sha256: operation.projected_handoff_sha256,
          handoff_receipt_sha256: operation.projected_handoff_receipt_sha256,
          validation_sha256: operation.projected_validation_sha256,
          attempt_sha256: operation.projected_attempt_sha256,
          acceptance_sha256: operation.projected_acceptance_sha256,
        })
        || !linked || linked.specialist_id !== operation.specialist_id || linked.payload_sha256 !== operation.compatibility_payload_sha256
        || !receipt || receipt.operation_id.startsWith("compatibility-read:") || receipt.scenario_id !== "PCL-09"
        || receipt.event_name !== "task.collect" || receipt.outcome_type !== "guild.capability_outcome.v1"
        || receipt.disposition !== "succeeded" || receipt.observation_state !== "checked_clean"
        || receipt.input_hash !== `sha256:${sha256(canonical({
          task_id: operation.task_id,
          specialist_id: operation.specialist_id,
          host_id: operation.host_id,
          task_run_id: operation.task_run_id,
          attempt: operation.attempt,
          instance_id: operation.instance_id,
          assignment_written_at: operation.assignment_written_at,
          completed_at: operation.completed_at,
          assignment_sha256: operation.assignment_sha256,
          handoff_sha256: operation.handoff_sha256,
          handoff_receipt_sha256: operation.handoff_receipt_sha256,
          validation_sha256: operation.validation_sha256,
          attempt_sha256: operation.attempt_sha256,
          acceptance_sha256: operation.acceptance_sha256,
          projected_assignment_sha256: operation.projected_assignment_sha256,
          projected_handoff_sha256: operation.projected_handoff_sha256,
          projected_handoff_receipt_sha256: operation.projected_handoff_receipt_sha256,
          projected_validation_sha256: operation.projected_validation_sha256,
          projected_attempt_sha256: operation.projected_attempt_sha256,
          projected_acceptance_sha256: operation.projected_acceptance_sha256,
          compatibility_operation_id: operation.compatibility_operation_id,
          compatibility_payload_sha256: operation.compatibility_payload_sha256,
        }))}`
        || receipt.output_hash !== operationRef.sha256 || receipt.terminal !== false
        || receipt.observed_at !== operation.completed_at || receipt.causation_id !== linked.receipt.event_id
        || receipt.correlation_id !== operation.operation_id || canonical(receipt.versions) !== canonical(linked.receipt.versions)
        || receipt.sequence <= linked.receipt.sequence
        || Date.parse(receipt.recorded_at) < Date.parse(operation.completed_at)
        || (retainedCloseFacts && Date.parse(receipt.recorded_at) > Date.parse(retainedCloseFacts.closed_at))
        || linked.receipt.operation_id !== `compatibility-read:task-cell-identity-${operation.task_id}-${operation.specialist_id}`
        || Date.parse(linked.receipt.recorded_at) >= Date.parse(operation.assignment_written_at)
        || (retainedCloseFacts && Date.parse(operation.completed_at) > Date.parse(retainedCloseFacts.closed_at))) {
        throw new Error(`migration observation substantive operation is invalid, compatibility-only, or detached for ${run.run_id}`);
      }
    }
    if (substantiveOperationRefs.length > 0 && usedSubstantiveEvidencePaths.size !== substantiveEvidenceRefs.length) {
      throw new Error(`migration observation substantive evidence is missing, duplicated, or unclaimed for ${run.run_id}`);
    }
    if (baseline && retainedRunManifest && retainedCloseFacts && provenanceRef) {
      if (terminalReceipts.length !== 1) throw new Error(`migration observation requires one explicit terminal run seal for ${run.run_id}`);
      const terminal = terminalReceipts[0];
      const expectedCloseHash = migrationRunCloseIdentityHash(
        run.run_id,
        retainedCloseFacts,
        sourceProvenanceSha256 ?? provenanceRef.sha256,
        sourceSessionContextSha256 ?? undefined,
        sourceSessionContextSha256 ? provenanceRef.sha256 : undefined,
        sourceSessionContextSha256 && sessionContextRef ? sessionContextRef.sha256 : undefined,
      );
      const expectedProfileHash = `sha256:${run.profile.sha256}`;
      const expectedSealHash = terminalSealOutputHash(expectedProfileHash, {
        agents: profile.mutation_evidence.agents_tree_hash_after,
        skills: profile.mutation_evidence.skills_tree_hash_after,
        registries: profile.mutation_evidence.registry_hash_after,
      });
      if (terminal.scenario_id !== "PCL-09"
        || terminal.event_name !== "receipt.append"
        || terminal.disposition !== "succeeded"
        || terminal.observation_state !== "checked_clean"
        || terminal.input_hash !== expectedCloseHash
        || terminal.output_hash !== expectedSealHash
        || terminal.terminal !== true
        || terminal.sequence <= earliestQualifyingSequence
        || substantiveOperationRefs.some((operationRef) => {
          let operation: MigrationSubstantiveOperationV1 | null = null;
          try { operation = parseSubstantiveOperation(JSON.parse(snapshots.get(operationRef.path)!.toString("utf8"))); } catch { operation = null; }
          const substantiveReceipt = operation ? scan.records.find((receipt) => receipt.operation_id === operation.operation_id) : null;
          return !substantiveReceipt || terminal.sequence <= substantiveReceipt.sequence;
        })
        || terminal.sequence !== scan.last_sequence
        || Date.parse(terminal.recorded_at) < Date.parse(retainedCloseFacts.closed_at)
        || terminal.versions.host_id !== "guild-cli"
        || terminal.versions.runtime_version !== MIGRATION_OBSERVATION_SCHEMA
        || terminal.versions.source_version !== expectedCloseHash
        || terminal.versions.contract_version !== "guild.observability.v1") {
        throw new Error(`migration observation terminal run seal is invalid, stale, or detached for ${run.run_id}`);
      }
    }
  }
  if (new Date(Math.min(...profileInstants)).toISOString() !== observation.observed_at) {
    throw new Error("migration observation observed_at does not match its earliest whole-run profile");
  }
  return observation;
}

/** Historical v2 observations remain valid release evidence, but only FU18 records qualify as substantive runs. */
export function isSubstantiveMigrationObservation(value: MigrationObservation): boolean {
  return value.schema_version === MIGRATION_OBSERVATION_SCHEMA
    && value.runs.every((run) => "substantive_operations" in run
      && Array.isArray((run as MigrationObservationRunV2).substantive_operations)
      && (run as MigrationObservationRunV2).substantive_operations!.length > 0);
}

export function verifySubstantiveMigrationObservation(projectRoot: string, value: unknown, stagedSnapshots?: ReadonlyMap<string, Buffer>): MigrationObservationV2 {
  const observation = verifyMigrationObservation(projectRoot, value, stagedSnapshots);
  if (!isSubstantiveMigrationObservation(observation)) {
    throw new Error("migration observation has no distinct substantive operation evidence; compatibility-only release evidence does not qualify");
  }
  return observation as MigrationObservationV2;
}

function projectMigrationEvidenceBytes(projectRoot: string, runId: string, sourceRel: string, destinationRel: string, source: Buffer, terminalEventId?: string): Buffer {
  const root = fs.realpathSync(projectRoot);
  let projected = source.toString("utf8");
  let rootPathReplacements = 0;
  for (const candidate of new Set([projectRoot, path.resolve(projectRoot), root])) {
    const occurrences = projected.split(candidate).length - 1;
    if (occurrences > 0) {
      rootPathReplacements += occurrences;
      projected = projected.split(candidate).join("<workspace-root>");
    }
  }
  if (destinationRel.endsWith("/run.yaml")) {
    projected = projected.replace(/(^capability_start_snapshot_ref:\s*$\n(?:^[ \t]+[^\n]*\n)*?^[ \t]+path:\s*)capability\/run-start-snapshot\.json\s*$/m, "$1run-start-snapshot.json");
  } else if (destinationRel.endsWith("/provenance.json")) {
    let provenance: Record<string, unknown> | null = null;
    try { provenance = plainRecord(JSON.parse(projected)); } catch { provenance = null; }
    const terminal = plainRecord(provenance?.terminal_trace_event);
    const artifacts = plainRecord(provenance?.artifacts);
    if (!provenance || provenance.schema_version !== "guild.provenance.v1" || provenance.run_id !== runId || !terminal || !artifacts) {
      throw new Error(`migration public projection refuses malformed provenance: ${sourceRel}`);
    }
    terminal.log_ref = "terminal-trace-log.jsonl";
    artifacts.capability_profile = "profile.json";
    projected = `${JSON.stringify(provenance, null, 2)}\n`;
  } else if (destinationRel.endsWith("/terminal-trace-log.jsonl")) {
    if (!terminalEventId) throw new Error(`migration public projection refuses an unbound terminal trace: ${sourceRel}`);
    const matching = projected.split("\n").filter((line) => line.trim().length > 0).flatMap((line) => {
      try {
        const event = plainRecord(JSON.parse(line));
        return event?.schema_version === "guild.trace_event.v1"
          && event.event_id === terminalEventId
          && event.event_name === "run_closed"
          && event.run_id === runId
          ? [event]
          : [];
      } catch { return []; }
    });
    if (matching.length !== 1) throw new Error(`migration public projection refuses a missing, duplicated, or malformed terminal event: ${sourceRel}`);
    projected = `${JSON.stringify(matching[0])}\n`;
  }
  const scrubbed = redactShareableFile(projected, path.posix.basename(destinationRel));
  if (scrubbed.secrets.length > 0) {
    const categories = [...new Set(scrubbed.secrets.map((hit) => hit.category))].sort().join(", ");
    throw new Error(`migration public projection refuses credential, secret, or arbitrary entropy in ${sourceRel}: ${categories}`);
  }
  if (rootPathReplacements + scrubbed.opPaths > 0 && /\/(?:profile\.json|journal\.jsonl|checkpoint\.json)$/.test(destinationRel)) {
    throw new Error(`migration public projection refuses an operator path in seal-bound evidence ${sourceRel}; regenerate the run without private paths`);
  }
  return Buffer.from(scrubbed.out, "utf8");
}

export function createMigrationObservation(options: { pluginRoot: string; runtimeHost: MigrationRuntimeHost; projectRoot: string; boundaryPath: string; projectId: string; mode: "observe" | "shadow"; runIds: readonly string[] }): MigrationObservationV2 {
  const boundary = loadMigrationBoundary(path.resolve(options.boundaryPath));
  const expectedRuntime = boundary.packages[options.runtimeHost];
  const runtimePackage = verifyInstalledMigrationRuntimePackage(options.pluginRoot, expectedRuntime);
  if (!/^[a-z0-9][a-z0-9._-]{0,127}$/.test(options.projectId)) throw new Error("migration observation project id is not canonical");
  // One run per observation makes the immutable evidence tree publishable with
  // one atomic directory rename. The migration window still requires distinct
  // runs across its three release observations.
  if (options.runIds.length !== 1) throw new Error("migration observation requires exactly one whole-run id per atomic evidence publication");
  for (const runId of options.runIds) {
    if (!/^run-\d{8}-\d{6}-[a-z0-9][a-z0-9-]*$/.test(runId)) throw new Error(`migration observation run id is not canonical: ${runId}`);
    let terminal: { readonly started_at: string; readonly capability_start_snapshot_sha256: string | null } | null = null;
    try { terminal = migrationRunManifestFacts(readEvidenceFile(options.projectRoot, `.guild/runs/${runId}/run.yaml`), runId, "closed"); }
    catch { terminal = null; }
    if (!terminal) throw new Error(`migration observation requires the terminal closed run manifest before snapshotting ${runId}`);
  }
  const stagedSnapshots = new Map<string, Buffer>();
  const sourceSnapshots = new Map<string, Buffer>();
  const sourceHashes = new Map<string, string>();
  const stage = (sourceRel: string, destinationRel: string, terminalEventId?: string): MigrationEvidenceRefV1 => {
    const source = readEvidenceFile(options.projectRoot, sourceRel);
    sourceSnapshots.set(sourceRel, source);
    sourceHashes.set(sourceRel, sha256(source));
    const bytes = projectMigrationEvidenceBytes(options.projectRoot, options.runIds[0], sourceRel, destinationRel, source, terminalEventId);
    stagedSnapshots.set(destinationRel, bytes);
    return Object.freeze({ path: destinationRel, sha256: sha256(bytes) });
  };
  const runs: MigrationObservationRunV2[] = options.runIds.map((runId) => {
    const prefix = `.guild/runs/${runId}`;
    const payloadDirectory = path.join(fs.realpathSync(options.projectRoot), prefix, "receipts", "payloads");
    const checkedDirectory = checkContained(options.projectRoot, payloadDirectory, { policy: "physical" });
    if (isRefused(checkedDirectory)) throw new Error(`migration observation payload directory refused [${checkedDirectory.code}]`);
    const names = fs.readdirSync(checkedDirectory.realPath).sort();
    const payloadNames = names.filter((name) => name.endsWith(".compatibility-usage.json"));
    const substantiveNames = names.filter((name) => name.endsWith(".substantive-operation.json"));
    const destinationPrefix = `.guild/artifacts/capability/migration-evidence/${boundary.boundary_hash}/${runId}`;
    const substantiveOperations = Object.freeze(substantiveNames.map((name) => stage(`${prefix}/receipts/payloads/${name}`, `${destinationPrefix}/payloads/${name}`)));
    const substantiveEvidenceByPath = new Map<string, MigrationEvidenceRefV1>();
    const retainSubstantiveEvidence = (sourcePath: string, destinationPath: string): MigrationEvidenceRefV1 => {
      const existing = substantiveEvidenceByPath.get(destinationPath);
      if (existing) return existing;
      const retained = stage(sourcePath, destinationPath);
      substantiveEvidenceByPath.set(destinationPath, retained);
      return retained;
    };
    for (const operationRef of substantiveOperations) {
      let operation: MigrationSubstantiveOperationV1 | null = null;
      try { operation = parseSubstantiveOperation(JSON.parse(stagedSnapshots.get(operationRef.path)!.toString("utf8"))); }
      catch { operation = null; }
      if (!operation || operation.run_id !== runId) throw new Error(`migration observation refuses malformed substantive operation: ${operationRef.path}`);
      const paths = taskCellPaths({ run_id: runId, logical_task_id: operation.task_id, attempt: operation.attempt, instance_id: operation.instance_id });
      const attemptDestination = `${destinationPrefix}/task-cells/${operation.task_id}/attempts/${operation.attempt}`;
      const instanceDestination = `${attemptDestination}/instances/${operation.instance_id}`;
      retainSubstantiveEvidence(paths.assignment_path, `${instanceDestination}/assignment.json`);
      const handoffRef = retainSubstantiveEvidence(paths.handoff_path, `${instanceDestination}/handoff.json`);
      retainSubstantiveEvidence(paths.validation_path, `${instanceDestination}/handoff-validation.json`);
      retainSubstantiveEvidence(paths.attempt_path, `${attemptDestination}/attempt.json`);
      retainSubstantiveEvidence(paths.acceptance_path, `${instanceDestination}/handoff-acceptance.json`);
      let retainedHandoff: Record<string, unknown> | null = null;
      try { retainedHandoff = plainRecord(JSON.parse(stagedSnapshots.get(handoffRef.path)!.toString("utf8"))); }
      catch { retainedHandoff = null; }
      if (canonicalRelativePath(retainedHandoff?.receipt_path) && retainedHandoff.receipt_path !== paths.handoff_path) {
        retainSubstantiveEvidence(retainedHandoff.receipt_path, `${instanceDestination}/handoff-receipt.md`);
      }
    }
    const substantiveEvidence = Object.freeze([...substantiveEvidenceByPath.values()].sort((left, right) => left.path.localeCompare(right.path)));
    const runManifest = stage(`${prefix}/run.yaml`, `${destinationPrefix}/run.yaml`);
    const provenance = stage(`${prefix}/provenance.json`, `${destinationPrefix}/provenance.json`);
    let terminalEventId: string | null = null;
    try {
      const sourceProvenance = plainRecord(JSON.parse(sourceSnapshots.get(`${prefix}/provenance.json`)!.toString("utf8")));
      const terminal = plainRecord(sourceProvenance?.terminal_trace_event);
      terminalEventId = typeof terminal?.event_id === "string" ? terminal.event_id : null;
    } catch { terminalEventId = null; }
    return Object.freeze({
      run_id: runId,
      run_manifest: runManifest,
      provenance,
      source_provenance_sha256: sourceHashes.get(`${prefix}/provenance.json`)!,
      terminal_trace_log: stage(`${prefix}/logs/v1.4-events.jsonl`, `${destinationPrefix}/terminal-trace-log.jsonl`, terminalEventId ?? undefined),
      start_snapshot: stage(`${prefix}/capability/run-start-snapshot.json`, `${destinationPrefix}/run-start-snapshot.json`),
      baseline: stage(`${prefix}/capability/run-start-baseline.json`, `${destinationPrefix}/baseline.json`),
      session_context: stage(`${prefix}/session-context.json`, `${destinationPrefix}/session-context.json`),
      source_session_context_sha256: sourceHashes.get(`${prefix}/session-context.json`)!,
      profile: stage(`${prefix}/capability/profile.json`, `${destinationPrefix}/profile.json`),
      journal: stage(`${prefix}/receipts/journal.jsonl`, `${destinationPrefix}/journal.jsonl`),
      checkpoint: stage(`${prefix}/receipts/checkpoint.json`, `${destinationPrefix}/checkpoint.json`),
      compatibility_payloads: Object.freeze(payloadNames.map((name) => stage(`${prefix}/receipts/payloads/${name}`, `${destinationPrefix}/payloads/${name}`))),
      ...(substantiveNames.length > 0 ? { substantive_operations: substantiveOperations, substantive_evidence: substantiveEvidence } : {}),
    });
  });
  const observedAt = new Date(Math.min(...runs.map((run) => {
    let raw: { generated_at?: unknown };
    try { raw = JSON.parse(stagedSnapshots.get(run.profile.path)!.toString("utf8")) as { generated_at?: unknown }; }
    catch { throw new Error(`migration observation profile is unreadable: ${run.profile.path}`); }
    if (typeof raw.generated_at !== "string" || !Number.isFinite(Date.parse(raw.generated_at))) throw new Error(`migration observation profile has no canonical generated_at: ${run.profile.path}`);
    return Date.parse(raw.generated_at);
  }))).toISOString();
  const candidate = {
    schema_version: MIGRATION_OBSERVATION_SCHEMA,
    boundary_hash: boundary.boundary_hash,
    boundary_release: boundary.release,
    boundary_source_commit: boundary.source_commit,
    boundary_merged_at: boundary.merged_at,
    observed_at: observedAt,
    runtime_package: runtimePackage,
    project_id: options.projectId,
    mode: options.mode,
    runs: Object.freeze(runs),
    verdict: "non_synthetic_runtime" as const,
  };
  const observation = verifySubstantiveMigrationObservation(options.projectRoot, { ...candidate, observation_hash: observationHash(candidate) }, stagedSnapshots);
  // Publish only after the complete candidate verifies. All files are first
  // written beneath an observation-hash staging directory, then the ONE run
  // directory is renamed into place atomically. A crash leaves either a
  // recoverable content-addressed stage or the complete final tree—never a
  // partial immutable snapshot that strands this boundary/run identity.
  const root = fs.realpathSync(options.projectRoot);
  const runId = options.runIds[0];
  const finalPrefix = `.guild/artifacts/capability/migration-evidence/${boundary.boundary_hash}/${runId}`;
  const stagePrefix = `.guild/artifacts/capability/migration-evidence/.pending/${observation.observation_hash}/${runId}`;
  const finalDirectory = path.join(root, finalPrefix);
  const stageDirectory = path.join(root, stagePrefix);
  let finalExists = false;
  try { finalExists = fs.lstatSync(finalDirectory).isDirectory(); } catch { finalExists = false; }
  const profileRun = runs[0];
  const rawProfile = JSON.parse(stagedSnapshots.get(profileRun.profile.path)!.toString("utf8"));
  const publicationProfile = validateProjectCapabilityProfileV1(rawProfile);
  if (!publicationProfile) throw new Error("migration observation final profile became invalid before publication");
  assertProfileMatchesCurrentCapabilityTrees(options.projectRoot, publicationProfile, "migration observation publication");
  const liveJournalPath = path.join(root, ".guild", "runs", runId, "receipts", "journal.jsonl");
  const liveCheckpointPath = path.join(root, ".guild", "runs", runId, "receipts", "checkpoint.json");
  const expectedJournal = stagedSnapshots.get(runs[0].journal.path)!;
  const expectedCheckpoint = stagedSnapshots.get(runs[0].checkpoint.path)!;
  for (const [relativePath, bytes] of stagedSnapshots) {
    const suffix = relativePath.slice(finalPrefix.length);
    if (!suffix.startsWith("/")) throw new Error(`migration evidence publish path is detached: ${relativePath}`);
    const stageRelativePath = `${stagePrefix}${suffix}`;
    const destination = path.join(root, stageRelativePath);
    try {
      const existing = readEvidenceFile(options.projectRoot, stageRelativePath);
      if (!existing.equals(bytes)) throw new Error(`migration evidence staging collision: ${stageRelativePath}`);
    } catch (error) {
      if (error instanceof Error && error.message.includes("staging collision")) throw error;
      const written = writeContainedFile(options.projectRoot, destination, bytes, { policy: "physical" });
      if (!written.written) throw new Error(`migration evidence staging refused [${written.code}]: ${stageRelativePath}`);
    }
  }
  if (finalExists) {
    for (const [relativePath, bytes] of stagedSnapshots) {
      if (!readEvidenceFile(options.projectRoot, relativePath).equals(bytes)) throw new Error(`migration evidence snapshot collision: ${relativePath}`);
    }
    const acquired = acquireJournalAuthority(liveJournalPath, defaultJournalIo, {}, "read", liveCheckpointPath);
    if (!acquired.ok) throw new Error(`migration evidence recovery could not lock the live receipt journal [${acquired.failure.code}]`);
    const authority = acquired.authority;
    const boundIo = authority.bind(defaultJournalIo);
    try {
      const detached = authority.verify("migration evidence recovery");
      if (detached) throw new Error(`migration evidence live receipt authority detached during recovery [${detached.code}]`);
      const liveJournal = boundIo.readAll(authority.identity.path);
      const liveCheckpoint = boundIo.readAll(liveCheckpointPath);
      if (liveJournal === null || !Buffer.from(liveJournal, "utf8").equals(expectedJournal)
        || liveCheckpoint === null || !Buffer.from(liveCheckpoint, "utf8").equals(expectedCheckpoint)) {
        throw new Error("migration evidence terminal seal became stale during recovery");
      }
      assertProfileMatchesCurrentCapabilityTrees(options.projectRoot, publicationProfile, "migration evidence recovery");
      fs.rmSync(stageDirectory, { recursive: true, force: true });
    } finally {
      authority.release();
    }
  } else {
    fs.mkdirSync(path.dirname(finalDirectory), { recursive: true });
    const checkedStage = checkContained(root, stageDirectory, { policy: "physical" });
    const checkedParent = checkContained(root, path.dirname(finalDirectory), { policy: "physical" });
    if (isRefused(checkedStage) || isRefused(checkedParent)) throw new Error("migration evidence atomic publish containment refused");
    const publishedDestination = path.join(checkedParent.realPath, path.basename(finalDirectory));
    const stagedIdentity = fs.lstatSync(checkedStage.realPath);
    const parentIdentity = fs.statSync(checkedParent.realPath);
    const acquired = acquireJournalAuthority(liveJournalPath, defaultJournalIo, {}, "read", liveCheckpointPath);
    if (!acquired.ok) throw new Error(`migration evidence publication could not lock the live receipt journal [${acquired.failure.code}]`);
    const authority = acquired.authority;
    const boundIo = authority.bind(defaultJournalIo);
    let published = false;

    const assertLiveCommitState = (stage: string): void => {
      const detached = authority.verify(stage);
      if (detached) throw new Error(`migration evidence live receipt authority detached [${detached.code}]`);
      const liveJournal = boundIo.readAll(authority.identity.path);
      const liveCheckpoint = boundIo.readAll(liveCheckpointPath);
      if (liveJournal === null || !Buffer.from(liveJournal, "utf8").equals(expectedJournal)
        || liveCheckpoint === null || !Buffer.from(liveCheckpoint, "utf8").equals(expectedCheckpoint)) {
        throw new Error("migration evidence terminal seal became stale during publication");
      }
      assertProfileMatchesCurrentCapabilityTrees(options.projectRoot, publicationProfile, stage);
    };

    try {
      // The held journal authority blocks cooperating receipt writers. Exact
      // byte comparison also catches a writer that ignored the lock. Tree state
      // is checked on both sides of the rename so the publication linearizes at
      // one verified live state rather than at an earlier snapshot.
      assertLiveCommitState("immediately before migration evidence publication");
      fs.renameSync(checkedStage.realPath, publishedDestination);
      published = true;

      // rename(2) is pathname-based. Re-prove both the parent directory identity
      // and the directory that actually landed before reporting publication.
      const publishedIdentity = fs.lstatSync(publishedDestination);
      const currentParentIdentity = fs.statSync(checkedParent.realPath);
      const parentStillPinned = currentParentIdentity.dev === parentIdentity.dev && currentParentIdentity.ino === parentIdentity.ino;
      const publishedContainment = checkContained(root, publishedDestination, { policy: "physical" });
      const stagedDirectoryLanded = publishedIdentity.isDirectory() &&
        publishedIdentity.dev === stagedIdentity.dev && publishedIdentity.ino === stagedIdentity.ino;
      if (!parentStillPinned || isRefused(publishedContainment) || !stagedDirectoryLanded) {
        throw new Error("migration evidence atomic publish escaped or changed identity after rename");
      }
      assertLiveCommitState("immediately after migration evidence publication");
    } catch (error) {
      if (published) {
        try {
          const landed = fs.lstatSync(publishedDestination);
          if (landed.dev === stagedIdentity.dev && landed.ino === stagedIdentity.ino) {
            fs.rmSync(publishedDestination, { recursive: true, force: true });
          }
        } catch { /* refusal remains authoritative */ }
      }
      throw error;
    } finally {
      authority.release();
    }
  }
  return observation as MigrationObservationV2;
}

export function loadMigrationObservation(projectRoot: string, observationPath: string): MigrationObservation {
  let parsed: unknown;
  try {
    const stats = fs.lstatSync(observationPath);
    if (stats.isSymbolicLink() || !stats.isFile()) throw new Error("not a regular file");
    parsed = JSON.parse(fs.readFileSync(observationPath, "utf8"));
  } catch (error) {
    throw new Error(`migration observation is unreadable: ${error instanceof Error ? error.message : String(error)}`);
  }
  return verifyMigrationObservation(projectRoot, parsed);
}

export function migrationObservationFilename(observation: MigrationObservation): string {
  return `guild-capability-observation-${observation.project_id}-${observation.boundary_release}-${observation.boundary_source_commit.slice(0, 12)}.json`;
}

export function writeMigrationObservation(outputDirectory: string, observation: MigrationObservation): string {
  const validated = validateMigrationObservation(observation);
  if (validated === null) throw new Error("refusing to write an invalid migration observation");
  const directory = path.resolve(outputDirectory);
  fs.mkdirSync(directory, { recursive: true });
  const target = path.join(directory, migrationObservationFilename(validated));
  const serialized = `${JSON.stringify(validated, null, 2)}\n`;
  try {
    const existing = readRegularFileNoFollow(target, "migration observation output");
    if (existing.equals(Buffer.from(serialized, "utf8"))) return target;
    throw new Error(`migration observation output collision refuses replacement: ${target}`);
  } catch (error) {
    if (error instanceof Error && error.message.includes("collision refuses replacement")) throw error;
    if (!(error instanceof Error) || !/ENOENT|no such file/i.test(error.message)) throw error;
  }
  const descriptor = fs.openSync(target, "wx", 0o600);
  try {
    fs.writeFileSync(descriptor, serialized);
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  return target;
}

export function validateMigrationBoundary(value: unknown): MigrationBoundaryV1 | null {
  const record = plainRecord(value);
  if (!record || !exactKeys(record, [
    "schema_version", "channel", "release", "source_commit", "source_tree_hash",
    "merged_at", "packages", "workflow", "event_sha256", "boundary_hash",
  ])) return null;
  if (record.schema_version !== MIGRATION_BOUNDARY_SCHEMA || record.channel !== MIGRATION_BOUNDARY_CHANNEL) return null;
  if (typeof record.release !== "string" || !BETA.test(record.release)) return null;
  if (typeof record.source_commit !== "string" || !COMMIT.test(record.source_commit)) return null;
  if (typeof record.source_tree_hash !== "string" || !/^sha256:[0-9a-f]{64}$/.test(record.source_tree_hash)) return null;
  const mergedAt = canonicalInstant(record.merged_at);
  if (mergedAt === null || mergedAt !== record.merged_at) return null;
  if (typeof record.event_sha256 !== "string" || !SHA256.test(record.event_sha256)) return null;
  if (typeof record.boundary_hash !== "string" || !SHA256.test(record.boundary_hash)) return null;

  const packages = plainRecord(record.packages);
  if (!packages || !exactKeys(packages, ["claude-code-cli", "codex-cli"])) return null;
  const claudePackage = validateRuntimePackage(packages["claude-code-cli"], "claude-code-cli");
  const codexPackage = validateRuntimePackage(packages["codex-cli"], "codex-cli");
  if (!claudePackage || !codexPackage) return null;

  const workflow = plainRecord(record.workflow);
  if (!workflow || !exactKeys(workflow, ["repository", "run_id", "run_attempt", "event", "ref"])) return null;
  if (typeof workflow.repository !== "string" || !REPOSITORY.test(workflow.repository)) return null;
  if (typeof workflow.run_id !== "string" || !/^[1-9]\d*$/.test(workflow.run_id)) return null;
  if (!Number.isSafeInteger(workflow.run_attempt) || (workflow.run_attempt as number) < 1) return null;
  if (workflow.event !== "push" || workflow.ref !== "refs/heads/next") return null;

  const candidate = {
    schema_version: MIGRATION_BOUNDARY_SCHEMA,
    channel: MIGRATION_BOUNDARY_CHANNEL,
    release: record.release,
    source_commit: record.source_commit,
    source_tree_hash: record.source_tree_hash,
    merged_at: record.merged_at,
    packages: { "claude-code-cli": claudePackage, "codex-cli": codexPackage },
    workflow: {
      repository: workflow.repository as string,
      run_id: workflow.run_id as string,
      run_attempt: workflow.run_attempt as number,
      event: "push" as const,
      ref: "refs/heads/next" as const,
    },
    event_sha256: record.event_sha256,
  };
  if (record.boundary_hash !== boundaryHash(candidate)) return null;
  return Object.freeze({ ...candidate, boundary_hash: record.boundary_hash }) as MigrationBoundaryV1;
}

export function createMigrationBoundary(options: BoundaryOptions): MigrationBoundaryV1 {
  const root = fs.realpathSync(options.pluginRoot);
  const eventBytes = fs.readFileSync(options.eventPath);
  let event: unknown;
  try {
    event = JSON.parse(eventBytes.toString("utf8"));
  } catch {
    throw new Error("migration boundary event is not valid JSON");
  }
  const push = plainRecord(event);
  if (!push || push.ref !== "refs/heads/next" || typeof push.after !== "string" || !COMMIT.test(push.after)) {
    throw new Error("migration boundary requires a GitHub push event for refs/heads/next with an exact after commit");
  }
  const repository = plainRecord(push.repository);
  if (!repository || repository.full_name !== options.repository || !REPOSITORY.test(options.repository)) {
    throw new Error("migration boundary repository does not match the GitHub event");
  }
  const headCommit = plainRecord(push.head_commit);
  const headTimestamp = canonicalGitHubEventInstant(headCommit?.timestamp);
  if (!headCommit || headCommit.id !== push.after || headTimestamp === null) {
    throw new Error("migration boundary event has no exact head-commit binding");
  }
  // `head_commit.timestamp` is author-controlled git metadata and can be
  // backdated. GitHub's repository.pushed_at is server-observed Unix time in
  // the hash-bound push payload, so it is the elapsed-window clock authority.
  if (!Number.isSafeInteger(repository.pushed_at) || (repository.pushed_at as number) <= 0) {
    throw new Error("migration boundary event has no GitHub-observed repository.pushed_at instant");
  }
  const mergedAt = new Date((repository.pushed_at as number) * 1000).toISOString();
  if (Date.parse(headTimestamp) > Date.parse(mergedAt)) {
    throw new Error("migration boundary head commit timestamp is later than the GitHub-observed push instant");
  }
  const checkedOut = git(root, ["rev-parse", "--verify", "HEAD^{commit}"]);
  const next = git(root, ["rev-parse", "--verify", "refs/remotes/origin/next^{commit}"]);
  if (checkedOut !== push.after || next !== push.after) {
    throw new Error("migration boundary checkout, event after commit, and origin/next must be identical");
  }
  const manifestPath = ".claude-plugin/plugin.json" as const;
  const manifestBytes = gitBytes(root, ["show", `${push.after}:${manifestPath}`]);
  let manifest: unknown;
  try {
    manifest = JSON.parse(manifestBytes.toString("utf8"));
  } catch {
    throw new Error("migration boundary manifest is not valid JSON");
  }
  const manifestRecord = plainRecord(manifest);
  if (!manifestRecord || typeof manifestRecord.version !== "string" || !BETA.test(manifestRecord.version)) {
    throw new Error("migration boundary on next requires a canonical MAJOR.MINOR.PATCH-beta.N manifest version");
  }
  if (!Number.isSafeInteger(options.runAttempt) || options.runAttempt < 1 || !/^[1-9]\d*$/.test(options.runId)) {
    throw new Error("migration boundary requires canonical GitHub workflow identity");
  }
  const claudePackage = snapshotMigrationRuntimePackage(options.claudePackageRoot, "claude-code-cli", options.pluginRoot);
  const codexPackage = snapshotMigrationRuntimePackage(options.codexPackageRoot, "codex-cli");
  if (claudePackage.manifest_sha256 !== sha256(manifestBytes)) throw new Error("generated Claude package manifest does not match the exact boundary commit");
  for (const [packageRoot, runtimePackage] of [[options.claudePackageRoot, claudePackage], [options.codexPackageRoot, codexPackage]] as const) {
    let generatedManifest: unknown;
    try { generatedManifest = JSON.parse(readRegularFileNoFollow(path.join(fs.realpathSync(packageRoot), runtimePackage.manifest_path), `${runtimePackage.host_id} generated manifest`).toString("utf8")); }
    catch { throw new Error(`${runtimePackage.host_id} generated package manifest is not valid JSON`); }
    if (plainRecord(generatedManifest)?.version !== manifestRecord.version) throw new Error("generated host packages do not carry the same beta version");
  }
  const candidate = {
    schema_version: MIGRATION_BOUNDARY_SCHEMA,
    channel: MIGRATION_BOUNDARY_CHANNEL,
    release: manifestRecord.version,
    source_commit: push.after,
    source_tree_hash: `sha256:${sha256(gitBytes(root, ["archive", "--format=tar", push.after]))}`,
    merged_at: mergedAt,
    packages: {
      "claude-code-cli": claudePackage,
      "codex-cli": codexPackage,
    },
    workflow: {
      repository: options.repository,
      run_id: options.runId,
      run_attempt: options.runAttempt,
      event: "push" as const,
      ref: "refs/heads/next" as const,
    },
    event_sha256: sha256(eventBytes),
  };
  const validated = validateMigrationBoundary({ ...candidate, boundary_hash: boundaryHash(candidate) });
  if (validated === null) throw new Error("migration boundary failed its own validator");
  return validated;
}

export function migrationBoundaryFilename(boundary: MigrationBoundaryV1): string {
  return `guild-capability-migration-${boundary.release}-${boundary.source_commit.slice(0, 12)}.json`;
}

export function writeMigrationBoundary(outputDirectory: string, boundary: MigrationBoundaryV1): string {
  const validated = validateMigrationBoundary(boundary);
  if (validated === null) throw new Error("refusing to write an invalid migration boundary");
  const directory = path.resolve(outputDirectory);
  fs.mkdirSync(directory, { recursive: true });
  const target = path.join(directory, migrationBoundaryFilename(validated));
  const descriptor = fs.openSync(target, "wx", 0o600);
  try {
    fs.writeFileSync(descriptor, `${JSON.stringify(validated, null, 2)}\n`);
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  return target;
}
