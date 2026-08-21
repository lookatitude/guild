import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { parseCompatibilityUsageV1 } from "../../../src/modules/capability/workflows/compatibility-usage";
import { checkContained, isRefused, writeContainedFile } from "../../../src/modules/kernel/workflows/path-containment";
import {
  compareCheckpointToJournal,
  defaultJournalIo,
  readCheckpointState,
  scanReceiptJournal,
} from "../../../src/modules/telemetry/workflows/receipt-journal";
import { validateProjectCapabilityProfileV1 } from "../core/contracts/project-capability-profile";

export const MIGRATION_BOUNDARY_SCHEMA = "guild.capability_migration_boundary.v1" as const;
export const MIGRATION_BOUNDARY_CHANNEL = "next" as const;
export const MIGRATION_OBSERVATION_SCHEMA = "guild.capability_migration_observation.v1" as const;
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
  readonly tree_sha256: string;
}

export interface MigrationEvidenceRefV1 {
  readonly path: string;
  readonly sha256: string;
}

export interface MigrationObservationRunV1 {
  readonly run_id: string;
  readonly profile: MigrationEvidenceRefV1;
  readonly journal: MigrationEvidenceRefV1;
  readonly checkpoint: MigrationEvidenceRefV1;
  readonly compatibility_payloads: readonly MigrationEvidenceRefV1[];
}

export interface MigrationObservationV1 {
  readonly schema_version: typeof MIGRATION_OBSERVATION_SCHEMA;
  readonly boundary_hash: string;
  readonly boundary_release: string;
  readonly boundary_source_commit: string;
  readonly boundary_merged_at: string;
  /** Earliest whole-run profile instant represented by this observation. */
  readonly observed_at: string;
  readonly runtime_package: MigrationRuntimePackageV1;
  readonly project_id: string;
  readonly mode: "observe" | "shadow";
  readonly runs: readonly MigrationObservationRunV1[];
  readonly verdict: "non_synthetic_runtime";
  readonly observation_hash: string;
}

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

function observationHash(value: Omit<MigrationObservationV1, "observation_hash">): string {
  return sha256(canonical(value));
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

/** Deterministic content identity for one generated host package tree. */
export function hashRuntimePackage(packageRoot: string): string {
  const root = fs.realpathSync(packageRoot);
  const entries: Array<{ path: string; sha256: string }> = [];
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
  return sha256(canonical(entries));
}

function runtimePackageBinding(packageRoot: string, hostId: MigrationRuntimeHost): MigrationRuntimePackageV1 {
  const manifestPath = hostId === "claude-code-cli" ? ".claude-plugin/plugin.json" as const : ".codex-plugin/plugin.json" as const;
  const root = fs.realpathSync(packageRoot);
  const manifestBytes = readRegularFileNoFollow(path.join(root, manifestPath), `${hostId} runtime manifest`);
  return Object.freeze({ host_id: hostId, manifest_path: manifestPath, manifest_sha256: sha256(manifestBytes), tree_sha256: hashRuntimePackage(root) });
}

function validateRuntimePackage(value: unknown, expectedHost?: MigrationRuntimeHost): MigrationRuntimePackageV1 | null {
  const record = plainRecord(value);
  if (!record || !exactKeys(record, ["host_id", "manifest_path", "manifest_sha256", "tree_sha256"])) return null;
  if (record.host_id !== "claude-code-cli" && record.host_id !== "codex-cli") return null;
  if (expectedHost && record.host_id !== expectedHost) return null;
  const expectedManifest: MigrationRuntimePackageV1["manifest_path"] = record.host_id === "claude-code-cli" ? ".claude-plugin/plugin.json" : ".codex-plugin/plugin.json";
  if (record.manifest_path !== expectedManifest || typeof record.manifest_sha256 !== "string" || !SHA256.test(record.manifest_sha256) || typeof record.tree_sha256 !== "string" || !SHA256.test(record.tree_sha256)) return null;
  return Object.freeze({ host_id: record.host_id, manifest_path: expectedManifest, manifest_sha256: record.manifest_sha256, tree_sha256: record.tree_sha256 });
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
  let output: string;
  try {
    output = execFileSync("gh", [
      "attestation", "verify", path.resolve(boundaryPath),
      "--repo", PRODUCTION_REPOSITORY,
      "--signer-workflow", BOUNDARY_SIGNER_WORKFLOW,
      "--source-ref", "refs/heads/next",
      "--source-digest", boundary.source_commit,
      "--deny-self-hosted-runners",
      "--format", "json",
    ], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
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
    runResponse = execFileSync("gh", ["api", "--include", `repos/${PRODUCTION_REPOSITORY}/actions/runs/${boundary.workflow.run_id}`], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  } catch (error) {
    throw new Error(`migration boundary GitHub run verification failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  const headerMatch = /(?:^|\n)date:\s*([^\r\n]+)/i.exec(runResponse);
  const jsonStart = runResponse.indexOf("{");
  if (!headerMatch || jsonStart < 0) throw new Error("migration boundary GitHub run response has no server Date header or JSON body");
  const verifiedAt = new Date(headerMatch[1].trim()).toISOString();
  let run: Record<string, unknown> | null = null;
  try { run = plainRecord(JSON.parse(runResponse.slice(jsonStart))); } catch { /* refusal below */ }
  if (!run || run.head_sha !== boundary.source_commit || run.head_branch !== "next" || run.event !== "push" || run.status !== "completed" || run.conclusion !== "success") {
    throw new Error("migration boundary GitHub run metadata does not match a successful next push for the attested commit");
  }
  return verifiedAt;
}

export function validateMigrationObservation(value: unknown): MigrationObservationV1 | null {
  const record = plainRecord(value);
  if (!record || !exactKeys(record, [
    "schema_version", "boundary_hash", "boundary_release", "boundary_source_commit", "boundary_merged_at", "observed_at", "runtime_package",
    "project_id", "mode", "runs", "verdict", "observation_hash",
  ])) return null;
  if (record.schema_version !== MIGRATION_OBSERVATION_SCHEMA || (record.mode !== "observe" && record.mode !== "shadow") || record.verdict !== "non_synthetic_runtime") return null;
  if (typeof record.boundary_hash !== "string" || !SHA256.test(record.boundary_hash)) return null;
  if (typeof record.boundary_release !== "string" || !BETA.test(record.boundary_release)) return null;
  if (typeof record.boundary_source_commit !== "string" || !COMMIT.test(record.boundary_source_commit)) return null;
  const boundaryMergedAt = canonicalInstant(record.boundary_merged_at);
  if (boundaryMergedAt === null || boundaryMergedAt !== record.boundary_merged_at) return null;
  const observedAt = canonicalInstant(record.observed_at);
  if (observedAt === null || observedAt !== record.observed_at || Date.parse(observedAt) < Date.parse(boundaryMergedAt)) return null;
  const runtimePackage = validateRuntimePackage(record.runtime_package);
  if (!runtimePackage) return null;
  if (typeof record.project_id !== "string" || !/^[a-z0-9][a-z0-9._-]{0,127}$/.test(record.project_id)) return null;
  if (typeof record.observation_hash !== "string" || !SHA256.test(record.observation_hash) || !Array.isArray(record.runs) || record.runs.length === 0 || record.runs.length > 64) return null;
  const runs: MigrationObservationRunV1[] = [];
  const seenRuns = new Set<string>();
  for (const rawRun of record.runs) {
    const run = plainRecord(rawRun);
    if (!run || !exactKeys(run, ["run_id", "profile", "journal", "checkpoint", "compatibility_payloads"])) return null;
    if (typeof run.run_id !== "string" || !/^run-\d{8}-\d{6}-[a-z0-9][a-z0-9-]*$/.test(run.run_id) || seenRuns.has(run.run_id)) return null;
    const profile = validateEvidenceRef(run.profile);
    const journal = validateEvidenceRef(run.journal);
    const checkpoint = validateEvidenceRef(run.checkpoint);
    if (!profile || !journal || !checkpoint || !Array.isArray(run.compatibility_payloads) || run.compatibility_payloads.length === 0 || run.compatibility_payloads.length > 256) return null;
    const payloads: MigrationEvidenceRefV1[] = [];
    const seenPayloads = new Set<string>();
    for (const rawPayload of run.compatibility_payloads) {
      const payload = validateEvidenceRef(rawPayload);
      if (!payload || seenPayloads.has(payload.path)) return null;
      seenPayloads.add(payload.path);
      payloads.push(payload);
    }
    seenRuns.add(run.run_id);
    runs.push(Object.freeze({ run_id: run.run_id, profile, journal, checkpoint, compatibility_payloads: Object.freeze(payloads) }));
  }
  const candidate = {
    schema_version: MIGRATION_OBSERVATION_SCHEMA,
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
  return Object.freeze({ ...candidate, observation_hash: record.observation_hash });
}

export function verifyMigrationObservation(projectRoot: string, value: unknown): MigrationObservationV1 {
  const observation = validateMigrationObservation(value);
  if (observation === null) throw new Error("migration observation is invalid or its hash binding does not verify");
  const profileInstants: number[] = [];
  for (const run of observation.runs) {
    const expectedPrefix = `.guild/artifacts/capability/migration-evidence/${observation.boundary_hash}/${run.run_id}/`;
    if (run.profile.path !== `${expectedPrefix}profile.json` || run.journal.path !== `${expectedPrefix}journal.jsonl` || run.checkpoint.path !== `${expectedPrefix}checkpoint.json`) {
      throw new Error(`migration observation run ${run.run_id} has non-canonical evidence paths`);
    }
    const snapshots = new Map<string, Buffer>();
    for (const ref of [run.profile, run.journal, run.checkpoint, ...run.compatibility_payloads]) {
      if (!ref.path.startsWith(expectedPrefix)) throw new Error(`migration observation evidence path mismatch: ${ref.path}`);
      const bytes = readEvidenceFile(projectRoot, ref.path);
      if (sha256(bytes) !== ref.sha256) throw new Error(`migration observation evidence hash mismatch: ${ref.path}`);
      snapshots.set(ref.path, bytes);
    }
    let rawProfile: unknown;
    try { rawProfile = JSON.parse(snapshots.get(run.profile.path)!.toString("utf8")); }
    catch { throw new Error(`migration observation profile is unreadable: ${run.profile.path}`); }
    const profile = validateProjectCapabilityProfileV1(rawProfile);
    if (!profile || profile.run_id !== run.run_id || profile.project_id !== observation.project_id || profile.resolver_mode !== observation.mode || profile.mutation_window !== "run" || profile.mutation_performed !== false || Date.parse(profile.generated_at) < Date.parse(observation.boundary_merged_at)) {
      throw new Error(`migration observation requires a whole-run ${observation.mode} profile for ${run.run_id}`);
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
    for (const receipt of scan.records) {
      if (receipt.scenario_id !== "PCL-09" || !receipt.operation_id.startsWith("compatibility-read:") || receipt.versions.runtime_version !== observation.boundary_release || receipt.output_hash === null || !expectedPayloadHashes.has(receipt.output_hash)) continue;
      const payloadRef = run.compatibility_payloads.find((ref) => ref.sha256 === receipt.output_hash)!;
      let rawPayload: unknown;
      try { rawPayload = JSON.parse(snapshots.get(payloadRef.path)!.toString("utf8")); } catch { continue; }
      const payload = parseCompatibilityUsageV1(rawPayload);
      if (payload && payload.resolver_mode === observation.mode && payload.synthetic === false) qualifying += 1;
    }
    if (qualifying === 0) throw new Error(`migration observation has no non-synthetic PCL-09 ${observation.mode} receipt for ${run.run_id} at ${observation.boundary_release}`);
  }
  if (new Date(Math.min(...profileInstants)).toISOString() !== observation.observed_at) {
    throw new Error("migration observation observed_at does not match its earliest whole-run profile");
  }
  return observation;
}

export function createMigrationObservation(options: { pluginRoot: string; runtimeHost: MigrationRuntimeHost; projectRoot: string; boundaryPath: string; projectId: string; mode: "observe" | "shadow"; runIds: readonly string[] }): MigrationObservationV1 {
  const boundary = loadMigrationBoundary(path.resolve(options.boundaryPath));
  const runtimePackage = runtimePackageBinding(options.pluginRoot, options.runtimeHost);
  const expectedRuntime = boundary.packages[options.runtimeHost];
  if (canonical(runtimePackage) !== canonical(expectedRuntime)) throw new Error(`runtime package does not match the attested ${options.runtimeHost} beta package`);
  const snapshot = (sourceRel: string, destinationRel: string): MigrationEvidenceRefV1 => {
    const bytes = readEvidenceFile(options.projectRoot, sourceRel);
    const destination = path.join(fs.realpathSync(options.projectRoot), destinationRel);
    try {
      const existing = readEvidenceFile(options.projectRoot, destinationRel);
      if (!existing.equals(bytes)) throw new Error(`migration evidence snapshot collision: ${destinationRel}`);
    } catch (error) {
      if (error instanceof Error && error.message.includes("snapshot collision")) throw error;
      const written = writeContainedFile(options.projectRoot, destination, bytes, { policy: "physical" });
      if (!written.written) throw new Error(`migration evidence snapshot refused [${written.code}]: ${destinationRel}`);
    }
    return evidenceRef(options.projectRoot, destinationRel);
  };
  const runs: MigrationObservationRunV1[] = options.runIds.map((runId) => {
    if (!/^run-\d{8}-\d{6}-[a-z0-9][a-z0-9-]*$/.test(runId)) throw new Error(`migration observation run id is not canonical: ${runId}`);
    const prefix = `.guild/runs/${runId}`;
    const payloadDirectory = path.join(fs.realpathSync(options.projectRoot), prefix, "receipts", "payloads");
    const checkedDirectory = checkContained(options.projectRoot, payloadDirectory, { policy: "physical" });
    if (isRefused(checkedDirectory)) throw new Error(`migration observation payload directory refused [${checkedDirectory.code}]`);
    const payloadNames = fs.readdirSync(checkedDirectory.realPath).filter((name) => name.endsWith(".compatibility-usage.json")).sort();
    const destinationPrefix = `.guild/artifacts/capability/migration-evidence/${boundary.boundary_hash}/${runId}`;
    return Object.freeze({
      run_id: runId,
      profile: snapshot(`${prefix}/capability/profile.json`, `${destinationPrefix}/profile.json`),
      journal: snapshot(`${prefix}/receipts/journal.jsonl`, `${destinationPrefix}/journal.jsonl`),
      checkpoint: snapshot(`${prefix}/receipts/checkpoint.json`, `${destinationPrefix}/checkpoint.json`),
      compatibility_payloads: Object.freeze(payloadNames.map((name) => snapshot(`${prefix}/receipts/payloads/${name}`, `${destinationPrefix}/payloads/${name}`))),
    });
  });
  const observedAt = new Date(Math.min(...runs.map((run) => {
    const raw = JSON.parse(readEvidenceFile(options.projectRoot, run.profile.path).toString("utf8")) as { generated_at?: unknown };
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
  const observation = verifyMigrationObservation(options.projectRoot, { ...candidate, observation_hash: observationHash(candidate) });
  return observation;
}

export function loadMigrationObservation(projectRoot: string, observationPath: string): MigrationObservationV1 {
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

export function migrationObservationFilename(observation: MigrationObservationV1): string {
  return `guild-capability-observation-${observation.project_id}-${observation.boundary_release}-${observation.boundary_source_commit.slice(0, 12)}.json`;
}

export function writeMigrationObservation(outputDirectory: string, observation: MigrationObservationV1): string {
  const validated = validateMigrationObservation(observation);
  if (validated === null) throw new Error("refusing to write an invalid migration observation");
  const directory = path.resolve(outputDirectory);
  fs.mkdirSync(directory, { recursive: true });
  const target = path.join(directory, migrationObservationFilename(validated));
  const descriptor = fs.openSync(target, "wx", 0o600);
  try {
    fs.writeFileSync(descriptor, `${JSON.stringify(validated, null, 2)}\n`);
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
  const claudePackage = runtimePackageBinding(options.claudePackageRoot, "claude-code-cli");
  const codexPackage = runtimePackageBinding(options.codexPackageRoot, "codex-cli");
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
