#!/usr/bin/env -S npx tsx

/**
 * Captures and verifies exact-package conformance runs executed by an activated
 * Claude Code or Codex CLI process. The implementation is intentionally kept
 * behind a small exported API so its transcript and package-binding rules can
 * be exercised without launching a paid host in unit tests.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";

import {
  NEUTRAL_CONTRACT_VERSION,
  NEUTRAL_DISPOSITIONS,
  NEUTRAL_EVIDENCE_FRESHNESS_VERDICTS,
  NEUTRAL_EVIDENCE_IDENTITY_FIELDS,
  NEUTRAL_OUTCOME_TYPES,
  NEUTRAL_REQUIRED_SUITE_SCENARIO_IDS,
  NEUTRAL_SCENARIO_SUITE_ID,
  NEUTRAL_SCENARIO_SUITE_VERSION,
  neutralCanonicalJson,
  type NeutralConformanceEvidence,
} from "../src/modules/lifecycle";
import {
  evaluateTransportedReleaseConformance,
  runNeutralConformanceReleaseIntegration,
} from "../src/modules/distribution/workflows/release-conformance-integration";
import {
  loadAttestedMigrationBoundary,
  snapshotMigrationRuntimePackage,
  verifyInstalledMigrationRuntimePackage,
  type MigrationRuntimeHost,
  type MigrationRuntimePackageV1,
} from "./lib/capability/migration-evidence";
import { readScalarField } from "./lib/frontmatter";
import { redactShareableFile } from "../src/modules/security/workflows/scrub-redact";

export const ACTIVATED_HOST_CONFORMANCE_SCHEMA = "guild.activated_host_conformance.v1" as const;
export const ACTIVATED_HOST_WORKER_SCHEMA = "guild.activated_host_conformance_worker.v1" as const;
export const ACTIVATED_HOST_PUBLIC_EVIDENCE_SCHEMA = "guild.activated_host_public_evidence.v1" as const;
export const ACTIVATED_HOST_PUBLIC_MANIFEST_SCHEMA = "guild.activated_host_public_manifest.v1" as const;

const SHA256 = /^[0-9a-f]{64}$/;
const COMMIT = /^[0-9a-f]{40}$/;
const UTC_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const SESSION_ID = /^[0-9a-f-]{16,64}$/;
const HOSTS: readonly MigrationRuntimeHost[] = Object.freeze(["claude-code-cli", "codex-cli"]);
const CODEX_PROBE_SKILL_NAME = "guild:guild-verify-done";
const CODEX_PROBE_SKILL_PATH = ".agents/skills/guild/meta/verify-done/SKILL.md";
const CONSUMER_NAMES = Object.freeze(["website", "benchmark"] as const);
const CONSUMER_REPOSITORIES = Object.freeze({
  website: "github.com/lookatitude/guild-website",
  benchmark: "github.com/lookatitude/guild-benchmark",
});
const CONSUMER_EXCLUDED_DIRECTORIES = Object.freeze([".git", ".guild", "node_modules", "dist", ".astro", ".next", "coverage"]);

type PlainRecord = Record<string, unknown>;

function isCanonicalUtcInstant(value: unknown): value is string {
  if (typeof value !== "string" || !UTC_INSTANT.test(value)) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

export interface ActivatedHostVerification {
  readonly ok: boolean;
  readonly code: string;
  readonly detail: string;
}

export interface VerifyActivatedHostOptions {
  readonly receipt: unknown;
  readonly transcript: string;
  readonly workerResult: string;
  readonly packageRoot: string;
  readonly expectedPackage: MigrationRuntimePackageV1;
  readonly expectedSourceCommit: string;
  readonly expectedRelease: string;
}

export interface ActivatedConformanceWorkerOptions {
  readonly hostId: MigrationRuntimeHost;
  readonly challenge: string;
  readonly sourceCommit: string;
  readonly packageHash: string;
  readonly installSurfaceHash: string;
  readonly runtimeVersion: string;
  readonly hostVersion: string;
  readonly platform: string;
  readonly release: string;
  readonly capturedAt?: string;
  readonly pluginRoot: string;
  /** Exact package twin used by MH-07; its website/benchmark consumers are true siblings. */
  readonly moduleBoundaryRoot: string;
  readonly consumerRoots: Readonly<Record<string, string>>;
  readonly consumerIdentities: Readonly<Record<string, ConsumerTreeIdentity>>;
  /** Deterministic fail-closed test seam; never exposed by the CLI. */
  readonly testOnlyAfterInitialPackageSnapshot?: () => void;
  readonly testOnlyAfterInitialBoundarySnapshot?: () => void;
  readonly testOnlyAfterInitialConsumerSnapshot?: () => void;
}

export interface ActivatedConformanceWorkerResult {
  readonly ok: boolean;
  readonly code: string;
  readonly detail: string;
  readonly marker: string;
  readonly evidence: NeutralConformanceEvidence | null;
  readonly packageSnapshot: PlainRecord | null;
  readonly hostActivation: PlainRecord | null;
  readonly consumerTrees: Readonly<Record<string, ConsumerTreeIdentity>> | null;
}

export interface ConsumerTreeIdentity {
  readonly schema_version: "guild.consumer_tree_identity.v1";
  readonly name: "website" | "benchmark";
  readonly repository: string;
  readonly source_commit: string;
  readonly source_tree: string;
  readonly content_tree_sha256: string;
  readonly file_count: number;
}

export interface OpenedHostExecutable {
  readonly descriptor: number;
  readonly identity: HostExecutableIdentity;
  readonly launchPath: string;
}

interface ActivatedHostLaunchRequest {
  readonly hostId: MigrationRuntimeHost;
  readonly packageRoot: string;
  readonly stageRoot: string;
  readonly workerOutPath: string;
  readonly workerCommand: string;
  readonly marker: string;
  readonly environment: NodeJS.ProcessEnv;
  readonly hostExecutable: OpenedHostExecutable;
}

export interface ActivatedHostLaunchResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

export interface CaptureActivatedHostOptions {
  readonly hostId: MigrationRuntimeHost;
  readonly packageRoot: string;
  readonly expectedPackage: MigrationRuntimePackageV1;
  readonly sourceCommit: string;
  readonly release: string;
  readonly platform: string;
  readonly capturedAt: string;
  readonly consumerRoots: Readonly<Record<"website" | "benchmark", string>>;
  readonly outDir: string;
  readonly challenge?: string;
}

export interface HostExecutableIdentity {
  readonly path: string;
  readonly sha256: string;
  readonly device: number;
  readonly inode: number;
  readonly size: number;
  readonly companions: readonly HostExecutableCompanionIdentity[];
}

export interface HostExecutableCompanionIdentity {
  readonly name: string;
  readonly sha256: string;
  readonly size: number;
}

export interface CaptureActivatedHostResult {
  readonly ok: boolean;
  readonly code: string;
  readonly detail: string;
  readonly receiptPath: string | null;
  readonly transcriptPath: string | null;
  readonly workerPath: string | null;
  readonly verification: ActivatedHostVerification | null;
}

export interface ActivatedHostPublicPublication {
  readonly directory: string;
  readonly evidencePath: string;
  readonly manifestPath: string;
  readonly publicEvidenceSha256: string;
}

const PUBLIC_EVIDENCE_KEYS = Object.freeze([
  "public_evidence_sha256", "schema_version", "host_id", "source_commit", "release",
  "host_version", "platform", "runtime_version", "adapter_version", "contract_version",
  "scenario_suite_id", "scenario_suite_version", "captured_at", "source_capture_commitment",
  "runtime_package", "host_executable", "host_activation", "consumer_trees", "conformance",
  "raw_artifacts_included", "external_attestation_verified", "authorizes_promotion",
]);
const PUBLIC_MANIFEST_KEYS = Object.freeze([
  "manifest_sha256", "schema_version", "evidence_file", "evidence_sha256", "file_count",
  "raw_artifacts_included", "external_attestation_verified", "authorizes_promotion",
]);
const PUBLIC_FORBIDDEN_KEYS = new Set([
  "activated_package_path", "challenge", "device", "inode", "installed", "installed_at",
  "installedPath", "list_entry", "marketplace", "path", "request_id", "session_id",
  "socket", "socket_path", "thread_id", "transcript", "worker_result",
]);
const PUBLIC_PACKAGE_KEYS = Object.freeze([
  "host_id", "manifest_path", "manifest_sha256", "producer_sha256", "tree_sha256", "install_surface_sha256",
]);
const PUBLIC_HOST_EXECUTABLE_KEYS = Object.freeze(["sha256", "size", "companions"]);
const PUBLIC_HOST_COMPANION_KEYS = Object.freeze(["name", "sha256", "size"]);
const PUBLIC_CLAUDE_ACTIVATION_KEYS = Object.freeze(["mechanism", "channel", "ref", "version", "receipt_sha256"]);
const PUBLIC_CODEX_ACTIVATION_KEYS = Object.freeze(["mechanism", "skill_name", "skill_path", "skill_sha256"]);
const PUBLIC_CONSUMER_TREE_KEYS = Object.freeze([
  "schema_version", "name", "repository", "source_commit", "source_tree", "content_tree_sha256", "file_count",
]);
const PUBLIC_CONFORMANCE_KEYS = Object.freeze(["suite_id", "suite_version", "required_scenario_ids", "results"]);
const PUBLIC_RESULT_KEYS = Object.freeze(["stable_id", "disposition", "outcome_type", "reason_code", "evidence_freshness"]);
const GROUPED_COMMIT = /^[0-9a-f]{8}(?:-[0-9a-f]{8}){4}$/;

function isRecord(value: unknown): value is PlainRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: PlainRecord, keys: readonly string[]): boolean {
  return Object.keys(value).sort().join("|") === [...keys].sort().join("|");
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function nonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function validPublicPackage(value: unknown, hostId: MigrationRuntimeHost): boolean {
  return isRecord(value) && exactKeys(value, PUBLIC_PACKAGE_KEYS) && value.host_id === hostId &&
    nonEmptyString(value.manifest_path) && !path.isAbsolute(value.manifest_path) && !value.manifest_path.split(/[\\/]/).includes("..") &&
    [value.manifest_sha256, value.producer_sha256, value.tree_sha256, value.install_surface_sha256]
      .every((hash) => typeof hash === "string" && SHA256.test(hash));
}

function validPublicHostExecutable(value: unknown): boolean {
  return isRecord(value) && exactKeys(value, PUBLIC_HOST_EXECUTABLE_KEYS) &&
    typeof value.sha256 === "string" && SHA256.test(value.sha256) && nonNegativeInteger(value.size) &&
    Array.isArray(value.companions) && value.companions.every((entry) => isRecord(entry) && exactKeys(entry, PUBLIC_HOST_COMPANION_KEYS) &&
      nonEmptyString(entry.name) && typeof entry.sha256 === "string" && SHA256.test(entry.sha256) && nonNegativeInteger(entry.size));
}

function validPublicActivation(value: unknown, hostId: MigrationRuntimeHost): boolean {
  if (!isRecord(value)) return false;
  if (hostId === "claude-code-cli") {
    return exactKeys(value, PUBLIC_CLAUDE_ACTIVATION_KEYS) && value.mechanism === "host-native-session-start" &&
      [value.channel, value.ref, value.version].every(nonEmptyString) && typeof value.receipt_sha256 === "string" && SHA256.test(value.receipt_sha256);
  }
  return exactKeys(value, PUBLIC_CODEX_ACTIVATION_KEYS) && nonEmptyString(value.mechanism) &&
    value.skill_name === CODEX_PROBE_SKILL_NAME && value.skill_path === CODEX_PROBE_SKILL_PATH &&
    typeof value.skill_sha256 === "string" && SHA256.test(value.skill_sha256);
}

function validPublicConsumerTrees(value: unknown): boolean {
  if (!isRecord(value) || !exactKeys(value, CONSUMER_NAMES)) return false;
  return CONSUMER_NAMES.every((name) => {
    const tree = value[name];
    return isRecord(tree) && exactKeys(tree, PUBLIC_CONSUMER_TREE_KEYS) &&
      tree.schema_version === "guild.consumer_tree_identity.v1" && tree.name === name &&
      tree.repository === CONSUMER_REPOSITORIES[name] && typeof tree.source_commit === "string" && GROUPED_COMMIT.test(tree.source_commit) &&
      typeof tree.source_tree === "string" && GROUPED_COMMIT.test(tree.source_tree) &&
      typeof tree.content_tree_sha256 === "string" && SHA256.test(tree.content_tree_sha256) && nonNegativeInteger(tree.file_count);
  });
}

function validPublicConformance(value: unknown): boolean {
  if (!isRecord(value) || !exactKeys(value, PUBLIC_CONFORMANCE_KEYS) ||
      value.suite_id !== NEUTRAL_SCENARIO_SUITE_ID || value.suite_version !== NEUTRAL_SCENARIO_SUITE_VERSION ||
      !Array.isArray(value.required_scenario_ids) || canonical(value.required_scenario_ids) !== canonical(NEUTRAL_REQUIRED_SUITE_SCENARIO_IDS) ||
      !Array.isArray(value.results) || value.results.length !== NEUTRAL_REQUIRED_SUITE_SCENARIO_IDS.length) return false;
  return value.results.every((entry, index) => isRecord(entry) && exactKeys(entry, PUBLIC_RESULT_KEYS) &&
    entry.stable_id === NEUTRAL_REQUIRED_SUITE_SCENARIO_IDS[index] &&
    NEUTRAL_DISPOSITIONS.includes(entry.disposition as never) && NEUTRAL_OUTCOME_TYPES.includes(entry.outcome_type as never) &&
    (entry.disposition === "succeeded" ? entry.reason_code === null : nonEmptyString(entry.reason_code)) &&
    NEUTRAL_EVIDENCE_FRESHNESS_VERDICTS.includes(entry.evidence_freshness as never));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (!isRecord(value)) return value;
  const sorted: PlainRecord = {};
  for (const key of Object.keys(value).sort()) sorted[key] = sortValue(value[key]);
  return sorted;
}

function canonical(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

export function sha256Hex(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Hash id over every receipt field except the id itself. */
export function activatedHostCaptureId(withoutId: unknown): string {
  return `ahc1:${sha256Hex(canonical(withoutId))}`;
}

function refusal(code: string, detail: string): ActivatedHostVerification {
  return Object.freeze({ ok: false, code, detail });
}

function bindingOf(pkg: MigrationRuntimePackageV1): PlainRecord {
  return {
    host_id: pkg.host_id,
    manifest_path: pkg.manifest_path,
    manifest_sha256: pkg.manifest_sha256,
    producer_sha256: pkg.producer_sha256,
    tree_sha256: pkg.tree_sha256,
    install_surface_sha256: pkg.install_surface_sha256,
  };
}

function fullPackageIdentity(pkg: MigrationRuntimePackageV1): PlainRecord {
  return {
    host_id: pkg.host_id,
    manifest_path: pkg.manifest_path,
    manifest_sha256: pkg.manifest_sha256,
    producer_sha256: pkg.producer_sha256,
    tree_sha256: pkg.tree_sha256,
    files: pkg.files,
  };
}

/** Verify the full generated tree and its separately attested supported-install subset. */
export function verifyAttestedGeneratedRuntimePackage(
  packageRoot: string,
  expectedPackage: MigrationRuntimePackageV1,
): MigrationRuntimePackageV1 {
  const actualPackage = snapshotMigrationRuntimePackage(packageRoot, expectedPackage.host_id);
  if (canonical(fullPackageIdentity(actualPackage)) !== canonical(fullPackageIdentity(expectedPackage))) {
    throw new Error(`generated runtime package does not match the attested ${expectedPackage.host_id} full tree`);
  }
  verifyInstalledMigrationRuntimePackage(packageRoot, expectedPackage);
  return expectedPackage;
}

const INSTALL_RECEIPT_KEYS = Object.freeze([
  "schema_version", "host", "channel", "ref", "commit", "version", "installed_at",
  "minted_by", "managed_by", "channel_confidence",
]);

function expectedActivationChannel(release: string): { channel: string; ref: string; confidence: string } {
  return /^\d+\.\d+\.\d+-beta\.(?:0|[1-9]\d*)$/.test(release)
    ? { channel: "beta", ref: "next", confidence: "version-derived" }
    : { channel: "stable", ref: "main", confidence: "assumed-default" };
}

function codexSkillActivation(expectedPackage: MigrationRuntimePackageV1, packageRoot: string): PlainRecord {
  const skill = expectedPackage.files.find((entry) => entry.path === CODEX_PROBE_SKILL_PATH);
  if (skill === undefined) throw new Error(`attested Codex package has no ${CODEX_PROBE_SKILL_PATH}`);
  const bytes = readRegularNoFollow(path.join(packageRoot, CODEX_PROBE_SKILL_PATH), "Codex probe skill");
  if (sha256Hex(bytes) !== skill.sha256) throw new Error("Codex probe skill bytes do not match the attested package");
  const description = readScalarField(bytes.toString("utf8"), "description");
  if (typeof description !== "string" || description.length === 0) throw new Error("Codex probe skill has no single-line frontmatter description");
  const words = description.trim().split(/\s+/).slice(0, 12);
  if (words.length !== 12) throw new Error("Codex probe skill description has fewer than 12 words");
  return Object.freeze({
    schema_version: "guild.codex_model_visible_skill_activation.v1",
    mechanism: "model-visible-plugin-skill",
    skill_name: CODEX_PROBE_SKILL_NAME,
    skill_path: CODEX_PROBE_SKILL_PATH,
    skill_sha256: skill.sha256,
    declaration: `GUILD_CODEX_SKILL_VISIBLE:${words.join(" ")}`,
  });
}

function validateHostActivation(
  activation: unknown,
  hostId: MigrationRuntimeHost,
  release: string,
  capturedAt: string,
  expectedPackage?: MigrationRuntimePackageV1,
  packageRoot?: string,
): ActivatedHostVerification {
  if (hostId === "codex-cli") {
    if (expectedPackage === undefined || packageRoot === undefined || !isRecord(activation) || canonical(activation) !== canonical(codexSkillActivation(expectedPackage, packageRoot))) {
      return refusal("host_activation_unproven", "Codex activation does not bind the model-visible Guild skill probe in the attested package");
    }
    return Object.freeze({ ok: true, code: "verified", detail: "Codex model-visible Guild skill probe is package-bound" });
  }
  return validateInstallReceiptActivation(activation, hostId, release, capturedAt);
}

function validateInstallReceiptActivation(
  activation: unknown,
  hostId: MigrationRuntimeHost,
  release: string,
  capturedAt: string,
): ActivatedHostVerification {
  if (!isRecord(activation) || !exactKeys(activation, ["path", "sha256", "receipt"])) {
    return refusal("host_activation_unproven", "host activation evidence has an invalid closed shape");
  }
  if (activation.path !== "guild-install-receipt.json" || typeof activation.sha256 !== "string" || !SHA256.test(activation.sha256)) {
    return refusal("host_activation_unproven", "host activation path or digest is invalid");
  }
  const receipt = activation.receipt;
  const expected = expectedActivationChannel(release);
  if (
    !isRecord(receipt) ||
    !exactKeys(receipt, INSTALL_RECEIPT_KEYS) ||
    receipt.schema_version !== "guild.install_receipt.v1" ||
    receipt.host !== hostId ||
    receipt.channel !== expected.channel ||
    receipt.ref !== expected.ref ||
    receipt.commit !== null ||
    receipt.version !== release ||
    receipt.minted_by !== "update-check-session-start" ||
    receipt.managed_by !== "host-native" ||
    receipt.channel_confidence !== expected.confidence ||
    typeof receipt.installed_at !== "string" ||
    !isCanonicalUtcInstant(receipt.installed_at) ||
    new Date(receipt.installed_at).toISOString() !== receipt.installed_at ||
    Date.parse(receipt.installed_at) < Date.parse(capturedAt) ||
    Date.parse(receipt.installed_at) > Date.now() + 300_000 ||
    sha256Hex(`${JSON.stringify(receipt, null, 2)}\n`) !== activation.sha256
  ) {
    return refusal("host_activation_unproven", "SessionStart receipt does not truthfully bind this host, release, channel, and capture instant");
  }
  return Object.freeze({ ok: true, code: "verified", detail: "host-native SessionStart receipt is valid" });
}

function hasPathEntryNoFollow(target: string): boolean {
  try {
    fs.lstatSync(target);
    return true;
  } catch (error) {
    if (isRecord(error) && error.code === "ENOENT") return false;
    throw error;
  }
}

function executableName(hostId: MigrationRuntimeHost): string {
  return hostId === "claude-code-cli" ? "claude" : "codex";
}

function resolveHostExecutable(hostId: MigrationRuntimeHost, environment: NodeJS.ProcessEnv): string {
  const name = executableName(hostId);
  const search = (environment.PATH ?? "").split(path.delimiter).filter((entry) => entry.length > 0);
  let resolved: string | null = null;
  for (const directory of search) {
    const candidate = path.join(directory, name);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      resolved = fs.realpathSync(candidate);
      break;
    } catch { /* keep searching */ }
  }
  if (resolved === null) throw new Error(`${name} executable is not resolvable from PATH`);
  return resolved;
}

function identityFromOpenExecutable(descriptor: number, resolved: string): Omit<HostExecutableIdentity, "companions"> {
  const stats = fs.fstatSync(descriptor);
  if (!stats.isFile()) throw new Error("resolved executable is not a regular file");
  const bytes = readOpenFileBytes(descriptor, stats.size);
  return Object.freeze({
    path: resolved,
    sha256: sha256Hex(bytes),
    device: stats.dev,
    inode: stats.ino,
    size: stats.size,
  });
}

function hostExecutableCompanions(hostId: MigrationRuntimeHost, resolved: string): readonly HostExecutableCompanionIdentity[] {
  const names = hostId === "codex-cli" ? ["codex-code-mode-host"] : [];
  const companions: HostExecutableCompanionIdentity[] = [];
  for (const name of names) {
    const source = path.join(path.dirname(resolved), name);
    if (!hasPathEntryNoFollow(source)) continue;
    const bytes = readRegularNoFollow(source, `${name} host companion`);
    companions.push(Object.freeze({ name, sha256: sha256Hex(bytes), size: bytes.length }));
  }
  return Object.freeze(companions);
}

function readOpenFileBytes(descriptor: number, size: number): Buffer {
  const bytes = Buffer.alloc(size);
  let offset = 0;
  while (offset < bytes.length) {
    const read = fs.readSync(descriptor, bytes, offset, bytes.length - offset, offset);
    if (read === 0) throw new Error("resolved executable changed size while it was read");
    offset += read;
  }
  return bytes;
}

export function openHostExecutable(hostId: MigrationRuntimeHost, environment: NodeJS.ProcessEnv, sealRoot: string): OpenedHostExecutable {
  const resolved = resolveHostExecutable(hostId, environment);
  const descriptor = fs.openSync(resolved, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const identity = Object.freeze({ ...identityFromOpenExecutable(descriptor, resolved), companions: hostExecutableCompanions(hostId, resolved) });
    const sealedPath = path.join(sealRoot, `sealed-host-${executableName(hostId)}`);
    writeExclusive(sealedPath, readOpenFileBytes(descriptor, identity.size), 0o500);
    if (sha256Hex(readRegularNoFollow(sealedPath, `sealed ${executableName(hostId)} executable`)) !== identity.sha256) {
      throw new Error(`${executableName(hostId)} sealed executable bytes differ from the verified source`);
    }
    for (const companion of identity.companions) {
      const bytes = readRegularNoFollow(path.join(path.dirname(resolved), companion.name), `${companion.name} host companion`);
      writeExclusive(path.join(sealRoot, companion.name), bytes, 0o500);
      if (sha256Hex(readRegularNoFollow(path.join(sealRoot, companion.name), `sealed ${companion.name} host companion`)) !== companion.sha256) {
        throw new Error(`${companion.name} sealed host companion bytes differ from the verified source`);
      }
    }
    fsyncDirectory(sealRoot);
    return Object.freeze({
      descriptor,
      identity,
      launchPath: sealedPath,
    });
  } catch (error) {
    fs.closeSync(descriptor);
    throw error;
  }
}

export function snapshotHostExecutable(hostId: MigrationRuntimeHost, environment: NodeJS.ProcessEnv = process.env): HostExecutableIdentity {
  const resolved = resolveHostExecutable(hostId, environment);
  const descriptor = fs.openSync(resolved, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try { return Object.freeze({ ...identityFromOpenExecutable(descriptor, resolved), companions: hostExecutableCompanions(hostId, resolved) }); }
  finally { fs.closeSync(descriptor); }
}

function assertOpenHostExecutable(expected: OpenedHostExecutable, hostId: MigrationRuntimeHost): void {
  const actual = identityFromOpenExecutable(expected.descriptor, expected.identity.path);
  if (canonical({ ...actual, companions: expected.identity.companions }) !== canonical(expected.identity)) throw new Error(`${executableName(hostId)} open executable identity changed during capture`);
  if (sha256Hex(readRegularNoFollow(expected.launchPath, `sealed ${executableName(hostId)} executable`)) !== expected.identity.sha256) {
    throw new Error(`${executableName(hostId)} sealed executable identity changed during capture`);
  }
  for (const companion of expected.identity.companions) {
    const sealedCompanion = path.join(path.dirname(expected.launchPath), companion.name);
    if (sha256Hex(readRegularNoFollow(sealedCompanion, `sealed ${companion.name} host companion`)) !== companion.sha256) {
      throw new Error(`${companion.name} sealed host companion identity changed during capture`);
    }
  }
}

export function spawnOpenExecutable(
  hostId: MigrationRuntimeHost,
  opened: OpenedHostExecutable,
  args: readonly string[],
  options: { readonly cwd?: string; readonly timeout: number; readonly env: NodeJS.ProcessEnv },
): ActivatedHostLaunchResult {
  assertOpenHostExecutable(opened, hostId);
  const result = spawnSync(opened.launchPath, [...args], {
    ...options,
    encoding: "utf8",
  });
  assertOpenHostExecutable(opened, hostId);
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function validHostExecutableIdentity(value: unknown): value is HostExecutableIdentity {
  return isRecord(value) &&
    exactKeys(value, ["path", "sha256", "device", "inode", "size", "companions"]) &&
    typeof value.path === "string" && path.isAbsolute(value.path) &&
    typeof value.sha256 === "string" && SHA256.test(value.sha256) &&
    typeof value.device === "number" && Number.isSafeInteger(value.device) && value.device >= 0 &&
    typeof value.inode === "number" && Number.isSafeInteger(value.inode) && value.inode >= 0 &&
    typeof value.size === "number" && Number.isSafeInteger(value.size) && value.size > 0 &&
    Array.isArray(value.companions) && value.companions.every((entry) => isRecord(entry) && exactKeys(entry, ["name", "sha256", "size"]) &&
      entry.name === "codex-code-mode-host" && typeof entry.sha256 === "string" && SHA256.test(entry.sha256) &&
      typeof entry.size === "number" && Number.isSafeInteger(entry.size) && entry.size > 0);
}

function consumeHostActivationReceipt(
  pluginRoot: string,
  hostId: MigrationRuntimeHost,
  release: string,
  capturedAt: string,
): PlainRecord {
  const receiptPath = path.join(pluginRoot, "guild-install-receipt.json");
  let descriptor: number | null = null;
  try {
    const deadline = Date.now() + 5_000;
    while (descriptor === null) {
      try {
        descriptor = fs.openSync(receiptPath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      } catch (error) {
        const code = isRecord(error) && typeof error.code === "string" ? error.code : null;
        if (code !== "ENOENT" || Date.now() >= deadline) throw error;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
      }
    }
    const opened = fs.fstatSync(descriptor);
    if (!opened.isFile()) throw new Error("SessionStart receipt is not a regular file");
    const bytes = fs.readFileSync(descriptor);
    const parsed: unknown = JSON.parse(bytes.toString("utf8"));
    const activation = Object.freeze({ path: "guild-install-receipt.json", sha256: sha256Hex(bytes), receipt: parsed });
    const validation = validateInstallReceiptActivation(activation, hostId, release, capturedAt);
    if (!validation.ok) throw new Error(`${validation.code}: ${validation.detail}`);
    const current = fs.lstatSync(receiptPath);
    if (!current.isFile() || current.dev !== opened.dev || current.ino !== opened.ino) {
      throw new Error("SessionStart receipt changed before consumption");
    }
    fs.unlinkSync(receiptPath);
    return activation;
  } catch (error) {
    throw new Error(`host-native activation receipt is missing or unsafe: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    if (descriptor !== null) fs.closeSync(descriptor);
  }
}

function parseJsonl(text: string): PlainRecord[] | null {
  const rows: PlainRecord[] = [];
  for (const line of text.split("\n")) {
    if (line.length === 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      return null;
    }
    if (!isRecord(parsed)) return null;
    rows.push(parsed);
  }
  return rows.length === 0 ? null : rows;
}

function contentRows(value: unknown): PlainRecord[] {
  if (!isRecord(value) || !Array.isArray(value.content)) return [];
  return value.content.filter(isRecord);
}

function markerFor(challenge: string): string {
  return `GUILD_ACTIVATED_CONFORMANCE_OK:${challenge}`;
}

function releaseId(release: string, capturedDay = "2026-08-21"): string {
  const suffix = release.split("-").slice(1).join("").replace(/[^0-9a-z]/gi, "").toLowerCase().slice(0, 16);
  return `rel-${capturedDay}-${suffix}`;
}

function copyPackageTree(source: string, destination: string): void {
  fs.cpSync(source, destination, { recursive: true, dereference: false });
}

function gitText(root: string, args: readonly string[]): string {
  return execFileSync("git", ["-C", root, ...args], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function normalizedGitHubRepository(value: string): string | null {
  let normalized = value.trim();
  const scpPrefix = "git@github.com:";
  const sshPrefix = "ssh://git@github.com/";
  if (normalized.startsWith(scpPrefix)) normalized = `https://github.com/${normalized.slice(scpPrefix.length)}`;
  if (normalized.startsWith(sshPrefix)) normalized = `https://github.com/${normalized.slice(sshPrefix.length)}`;
  normalized = normalized.replace(/\.git$/, "");
  const webPrefix = "https://github.com/";
  if (!normalized.startsWith(webPrefix)) return null;
  const match = /^([^/]+)\/([^/]+)$/.exec(normalized.slice(webPrefix.length));
  return match === null ? null : `github.com/${match[1]}/${match[2]}`;
}

function excludedConsumerPath(relative: string): boolean {
  return relative.split("/").some((segment) => CONSUMER_EXCLUDED_DIRECTORIES.includes(segment));
}

function consumerContentEntries(root: string): readonly { path: string; sha256: string }[] {
  const physicalRoot = fs.realpathSync(root);
  const entries: Array<{ path: string; sha256: string }> = [];
  const visit = (directory: string, prefix: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const relative = prefix.length === 0 ? entry.name : `${prefix}/${entry.name}`;
      if (excludedConsumerPath(relative)) continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`consumer tree contains a symlink: ${relative}`);
      if (entry.isDirectory()) visit(absolute, relative);
      else if (entry.isFile()) entries.push({ path: relative, sha256: sha256Hex(readRegularNoFollow(absolute, `consumer file ${relative}`)) });
      else throw new Error(`consumer tree contains a non-regular entry: ${relative}`);
      if (entries.length > 100_000) throw new Error("consumer tree exceeds the bounded file count");
    }
  };
  visit(physicalRoot, "");
  if (entries.length === 0) throw new Error("consumer tree is empty");
  entries.sort((left, right) => left.path.localeCompare(right.path));
  return Object.freeze(entries.map((entry) => Object.freeze(entry)));
}

export function snapshotConsumerContentTree(root: string): { readonly content_tree_sha256: string; readonly file_count: number } {
  const entries = consumerContentEntries(root);
  return Object.freeze({ content_tree_sha256: sha256Hex(canonical(entries)), file_count: entries.length });
}

function gitBlobOid(bytes: Buffer, algorithm: "sha1" | "sha256"): string {
  return createHash(algorithm).update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
}

export function snapshotOfficialConsumerGitTree(
  name: "website" | "benchmark",
  sourceRoot: string,
  destination: string,
): ConsumerTreeIdentity {
  const root = fs.realpathSync(sourceRoot);
  let top: string;
  let repository: string | null;
  let sourceCommit: string;
  let sourceTree: string;
  let objectFormat: string;
  let rows: string[];
  try {
    top = fs.realpathSync(gitText(root, ["rev-parse", "--show-toplevel"]));
    repository = normalizedGitHubRepository(gitText(root, ["remote", "get-url", "origin"]));
    sourceCommit = gitText(root, ["rev-parse", "HEAD"]);
    sourceTree = gitText(root, ["rev-parse", "HEAD^{tree}"]);
    objectFormat = gitText(root, ["rev-parse", "--show-object-format"]);
    rows = execFileSync("git", ["-C", root, "ls-tree", "-r", "-z", "--full-tree", sourceCommit], { maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] })
      .toString("utf8").split("\0").filter(Boolean);
  } catch (error) {
    throw new Error(`${name} consumer must be an official Git worktree: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (top !== root) throw new Error(`${name} consumer root must be the Git worktree root`);
  if (repository !== CONSUMER_REPOSITORIES[name]) throw new Error(`${name} consumer origin is not ${CONSUMER_REPOSITORIES[name]}`);
  if (!COMMIT.test(sourceCommit) || !COMMIT.test(sourceTree) || (objectFormat !== "sha1" && objectFormat !== "sha256")) throw new Error(`${name} consumer Git identity is malformed`);
  if (hasPathEntryNoFollow(destination)) throw new Error(`${name} consumer staging destination already exists`);
  fs.mkdirSync(destination, { recursive: true, mode: 0o700 });
  const contentEntries: Array<{ path: string; sha256: string }> = [];
  for (const row of rows) {
    const match = /^(\d{6}) (\S+) ([0-9a-f]+)\t(.+)$/.exec(row);
    if (match === null) throw new Error(`${name} consumer Git tree entry is malformed`);
    const [, mode, type, oid, relative] = match;
    if (excludedConsumerPath(relative)) continue;
    if (type !== "blob" || (mode !== "100644" && mode !== "100755")) throw new Error(`${name} consumer Git tree contains an unsupported entry: ${relative}`);
    let bytes: Buffer;
    try {
      bytes = readRegularNoFollow(path.join(root, relative), `${name} worktree file ${relative}`);
      if (gitBlobOid(bytes, objectFormat as "sha1" | "sha256") !== oid) throw new Error("worktree differs from HEAD");
    } catch {
      bytes = execFileSync("git", ["-C", root, "show", `${sourceCommit}:${relative}`], { maxBuffer: 256 * 1024 * 1024 });
    }
    if (gitBlobOid(bytes, objectFormat as "sha1" | "sha256") !== oid) throw new Error(`${name} consumer Git object bytes do not match ${relative}`);
    const target = path.join(destination, ...relative.split("/"));
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    fs.writeFileSync(target, bytes, { flag: "wx", mode: mode === "100755" ? 0o500 : 0o400 });
    contentEntries.push({ path: relative, sha256: sha256Hex(bytes) });
  }
  if (contentEntries.length === 0) throw new Error(`${name} consumer Git tree has no in-scope files`);
  contentEntries.sort((left, right) => left.path.localeCompare(right.path));
  const content = snapshotConsumerContentTree(destination);
  const expectedHash = sha256Hex(canonical(contentEntries));
  if (content.content_tree_sha256 !== expectedHash || content.file_count !== contentEntries.length) throw new Error(`${name} staged consumer bytes differ from Git HEAD`);
  return Object.freeze({
    schema_version: "guild.consumer_tree_identity.v1",
    name,
    repository,
    source_commit: sourceCommit,
    source_tree: sourceTree,
    content_tree_sha256: expectedHash,
    file_count: contentEntries.length,
  });
}

function validConsumerTreeIdentity(value: unknown, expectedName: "website" | "benchmark"): value is ConsumerTreeIdentity {
  return isRecord(value) && exactKeys(value, ["schema_version", "name", "repository", "source_commit", "source_tree", "content_tree_sha256", "file_count"]) &&
    value.schema_version === "guild.consumer_tree_identity.v1" && value.name === expectedName &&
    value.repository === CONSUMER_REPOSITORIES[expectedName] && typeof value.source_commit === "string" && COMMIT.test(value.source_commit) &&
    typeof value.source_tree === "string" && COMMIT.test(value.source_tree) && typeof value.content_tree_sha256 === "string" && SHA256.test(value.content_tree_sha256) &&
    typeof value.file_count === "number" && Number.isSafeInteger(value.file_count) && value.file_count > 0 && value.file_count <= 100_000;
}

function validConsumerTreeSet(value: unknown): value is Readonly<Record<string, ConsumerTreeIdentity>> {
  return isRecord(value) && exactKeys(value, CONSUMER_NAMES) && CONSUMER_NAMES.every((name) => validConsumerTreeIdentity(value[name], name));
}

function assertConsumerTreeMatches(root: string, identity: ConsumerTreeIdentity): void {
  const content = snapshotConsumerContentTree(root);
  if (content.content_tree_sha256 !== identity.content_tree_sha256 || content.file_count !== identity.file_count) {
    throw new Error(`${identity.name} consumer bytes do not match their bound Git identity`);
  }
}

function physicallyContains(parent: string, child: string): boolean {
  const relative = path.relative(fs.realpathSync(parent), fs.realpathSync(child));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function activatedConsumerRoots(
  hostId: MigrationRuntimeHost,
  stageRoot: string,
  packageRoot: string,
  stagedWebsite: string,
  stagedBenchmark: string,
): Readonly<Record<"website" | "benchmark", string>> {
  const roots = Object.freeze({ website: fs.realpathSync(stagedWebsite), benchmark: fs.realpathSync(stagedBenchmark) });
  for (const [name, root] of Object.entries(roots)) {
    if (!physicallyContains(stageRoot, root)) throw new Error(`${name} consumer root escapes the private capture stage`);
    if (hostId === "codex-cli" && physicallyContains(path.dirname(packageRoot), root)) {
      throw new Error(`${name} consumer root must stay outside the Codex plugin version cache`);
    }
  }
  return roots;
}

function safeToken(value: string, label: string): string {
  const allowed = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_./:@+-";
  if (value.length === 0 || [...value].some((character) => !allowed.includes(character))) {
    throw new Error(`${label} contains shell-unsafe characters`);
  }
  return value;
}

export function codexExecutionWorkspace(stageRoot: string, packageRoot: string): string {
  const workspace = path.join(stageRoot, "codex-empty-workspace");
  fs.mkdirSync(workspace, { recursive: false, mode: 0o700 });
  const physicalWorkspace = fs.realpathSync(workspace);
  const physicalPackage = fs.realpathSync(packageRoot);
  const relative = path.relative(physicalPackage, physicalWorkspace);
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) throw new Error("Codex execution workspace must be outside the installed plugin tree");
  if (fs.readdirSync(physicalWorkspace).length !== 0) throw new Error("Codex execution workspace must start empty");
  return physicalWorkspace;
}

function defaultHostRunner(request: ActivatedHostLaunchRequest): ActivatedHostLaunchResult {
  const prompt = [
    "This is a narrow conformance worker invocation.",
    ...(request.hostId === "codex-cli" ? [
      `Before using any tool, find the model-visible plugin skill named ${CODEX_PROBE_SKILL_NAME}.`,
      "Reply with one line containing GUILD_CODEX_SKILL_VISIBLE: followed immediately by the first twelve whitespace-delimited words of that skill's description.",
      "Do not inspect any file or run any command to obtain those words. If that skill is not model-visible, do not execute the command.",
    ] : []),
    "Execute exactly the command below once with the shell. Do not run any other command.",
    `After it succeeds, reply with exactly the single ${request.marker}:RESULT_SHA256:<digest> line printed by the command.`,
    request.workerCommand,
  ].join("\n");
  if (request.hostId === "claude-code-cli") {
    const emptyMcpPath = path.join(request.stageRoot, "empty-mcp.json");
    fs.writeFileSync(emptyMcpPath, '{"mcpServers":{}}\n', { flag: "wx", mode: 0o600 });
    return spawnOpenExecutable(
      request.hostId,
      request.hostExecutable,
      [
        "-p",
        "--plugin-dir",
        request.packageRoot,
        "--setting-sources",
        "",
        "--strict-mcp-config",
        "--mcp-config",
        emptyMcpPath,
        "--output-format",
        "stream-json",
        "--verbose",
        "--tools",
        "Bash",
        "--allowedTools",
        "Bash",
        "--permission-mode",
        "acceptEdits",
        prompt,
      ],
      { cwd: request.packageRoot, timeout: 900_000, env: request.environment },
    );
  }
  const executionWorkspace = codexExecutionWorkspace(request.stageRoot, request.packageRoot);
  return spawnOpenExecutable(
    request.hostId,
    request.hostExecutable,
    [
      "--dangerously-bypass-hook-trust",
      "-a",
      "never",
      "-s",
      "workspace-write",
      "-C",
      executionWorkspace,
      "exec",
      "--ignore-rules",
      "--ephemeral",
      "--skip-git-repo-check",
      "--add-dir",
      request.stageRoot,
      "--json",
      prompt,
    ],
    {
      cwd: executionWorkspace,
      timeout: 900_000,
      env: request.environment,
    },
  );
}

function sessionIdFromTranscript(host: MigrationRuntimeHost, transcript: string): string | null {
  const rows = parseJsonl(transcript);
  if (rows === null) return null;
  for (const row of rows) {
    if (host === "claude-code-cli" && row.type === "system" && row.subtype === "init" && typeof row.session_id === "string") return row.session_id;
    if (host === "codex-cli" && row.type === "thread.started" && typeof row.thread_id === "string") return row.thread_id;
  }
  return null;
}

function writeExclusive(target: string, bytes: string | Buffer, mode: number): void {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const descriptor = fs.openSync(target, "wx", mode);
  try {
    fs.writeFileSync(descriptor, bytes);
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function fsyncDirectory(directory: string): void {
  const descriptor = fs.openSync(directory, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try { fs.fsyncSync(descriptor); }
  finally { fs.closeSync(descriptor); }
}

export function sealActivatedWorkerRuntime(
  stageRoot: string,
  packageRoot: string,
  expectedPackage: MigrationRuntimePackageV1,
  nodeExecutable = process.execPath,
): { readonly nodePath: string; readonly workerPath: string } {
  const workerRelative = "scripts/dist/activated-host-conformance.js";
  const expectedWorker = expectedPackage.files.find((entry) => entry.path === workerRelative);
  if (expectedWorker === undefined) throw new Error(`attested package has no ${workerRelative}`);
  const workerBytes = readRegularNoFollow(path.join(packageRoot, workerRelative), "activated-host worker bundle");
  if (sha256Hex(workerBytes) !== expectedWorker.sha256) throw new Error("activated-host worker bundle differs from the attested package");
  const nodeBytes = readRegularNoFollow(nodeExecutable, "Node executable");
  const runtimeRoot = path.join(stageRoot, "sealed-worker-runtime");
  const binRoot = path.join(runtimeRoot, "bin");
  const libRoot = path.join(runtimeRoot, "lib");
  fs.mkdirSync(binRoot, { recursive: true, mode: 0o700 });
  fs.mkdirSync(libRoot, { recursive: true, mode: 0o700 });
  const sealedNode = path.join(binRoot, "node");
  const sealedWorker = path.join(runtimeRoot, "activated-host-worker.js");
  writeExclusive(sealedNode, nodeBytes, 0o500);
  writeExclusive(sealedWorker, workerBytes, 0o400);
  if (process.platform === "darwin") {
    const sourceLibRoot = path.join(path.dirname(path.dirname(fs.realpathSync(nodeExecutable))), "lib");
    if (fs.existsSync(sourceLibRoot)) {
      for (const name of fs.readdirSync(sourceLibRoot).filter((entry) => /^libnode\.[0-9]+\.dylib$/.test(entry))) {
        const dependencyBytes = readRegularNoFollow(path.join(sourceLibRoot, name), `Node runtime dependency ${name}`);
        writeExclusive(path.join(libRoot, name), dependencyBytes, 0o400);
        if (sha256Hex(readRegularNoFollow(path.join(libRoot, name), `sealed Node runtime dependency ${name}`)) !== sha256Hex(dependencyBytes)) {
          throw new Error(`sealed Node runtime dependency ${name} differs from its verified source`);
        }
      }
    }
  }
  if (sha256Hex(readRegularNoFollow(sealedNode, "sealed Node executable")) !== sha256Hex(nodeBytes) ||
      sha256Hex(readRegularNoFollow(sealedWorker, "sealed activated-host worker")) !== expectedWorker.sha256) {
    throw new Error("sealed activated-host runtime did not preserve verified bytes");
  }
  fsyncDirectory(binRoot);
  fsyncDirectory(libRoot);
  fsyncDirectory(runtimeRoot);
  fsyncDirectory(stageRoot);
  return Object.freeze({ nodePath: sealedNode, workerPath: sealedWorker });
}

export function publishActivatedHostEvidence(
  outDir: string,
  hostId: MigrationRuntimeHost,
  captureId: string,
  transcript: string,
  workerBytes: Buffer,
  receiptBytes: string,
  sensitiveValues: readonly string[],
): { receiptPath: string; transcriptPath: string; workerPath: string } {
  if (!HOSTS.includes(hostId) || !captureId.startsWith("ahc1:") || !SHA256.test(captureId.slice(5))) throw new Error("evidence publication identity is invalid");
  if (!hasPathEntryNoFollow(outDir)) throw new Error("evidence output root must already exist as a durable physical directory");
  const outStats = fs.lstatSync(outDir);
  if (!outStats.isDirectory() || outStats.isSymbolicLink()) throw new Error("evidence output root must be a physical directory");
  const physicalOut = fs.realpathSync(outDir);
  const finalDir = path.join(physicalOut, `capture-${captureId.slice(5)}`);
  if (hasPathEntryNoFollow(finalDir)) throw new Error(`evidence capture already exists: ${captureId}`);
  const names = {
    transcript: `${hostId}.transcript.jsonl`,
    worker: `${hostId}.worker.json`,
    receipt: `${hostId}.receipt.json`,
  };
  if ([transcript, workerBytes.toString("utf8"), receiptBytes].some((value) => containsSensitiveOutput(value, {}, sensitiveValues))) {
    throw new Error("evidence publication refused because an artifact contained authentication material");
  }
  const stagingDir = fs.mkdtempSync(path.join(physicalOut, ".activated-host-stage-"));
  fs.chmodSync(stagingDir, 0o700);
  let renamed = false;
  try {
    writeExclusive(path.join(stagingDir, names.transcript), transcript, 0o600);
    writeExclusive(path.join(stagingDir, names.worker), workerBytes, 0o600);
    writeExclusive(path.join(stagingDir, names.receipt), receiptBytes, 0o644);
    fsyncDirectory(stagingDir);
    fs.renameSync(stagingDir, finalDir);
    renamed = true;
    fsyncDirectory(physicalOut);
  } catch (error) {
    fs.rmSync(renamed ? finalDir : stagingDir, { recursive: true, force: true });
    try { fsyncDirectory(physicalOut); } catch { /* retain the original durability failure */ }
    throw error;
  }
  return {
    receiptPath: path.join(finalDir, names.receipt),
    transcriptPath: path.join(finalDir, names.transcript),
    workerPath: path.join(finalDir, names.worker),
  };
}

function groupedHex(value: string): string {
  return value.match(/.{1,8}/g)?.join("-") ?? value;
}

function publicPackageBinding(value: unknown): PlainRecord {
  if (!isRecord(value)) throw new Error("public projection requires a closed runtime package binding");
  return Object.freeze({
    host_id: value.host_id,
    manifest_path: value.manifest_path,
    manifest_sha256: value.manifest_sha256,
    producer_sha256: value.producer_sha256,
    tree_sha256: value.tree_sha256,
    install_surface_sha256: value.install_surface_sha256,
  });
}

function publicHostExecutable(value: unknown): PlainRecord {
  if (!isRecord(value) || !Array.isArray(value.companions)) throw new Error("public projection requires a verified host executable binding");
  return Object.freeze({
    sha256: value.sha256,
    size: value.size,
    companions: value.companions.map((entry) => {
      if (!isRecord(entry)) throw new Error("public projection host companion is malformed");
      return Object.freeze({ name: entry.name, sha256: entry.sha256, size: entry.size });
    }),
  });
}

function publicConsumerTrees(value: unknown): PlainRecord {
  if (!isRecord(value)) throw new Error("public projection requires consumer tree bindings");
  const out: PlainRecord = {};
  for (const name of CONSUMER_NAMES) {
    const tree = value[name];
    if (!isRecord(tree)) throw new Error(`public projection requires the ${name} consumer tree`);
    out[name] = Object.freeze({
      schema_version: tree.schema_version,
      name: tree.name,
      repository: tree.repository,
      source_commit: typeof tree.source_commit === "string" ? groupedHex(tree.source_commit) : tree.source_commit,
      source_tree: typeof tree.source_tree === "string" ? groupedHex(tree.source_tree) : tree.source_tree,
      content_tree_sha256: tree.content_tree_sha256,
      file_count: tree.file_count,
    });
  }
  return Object.freeze(out);
}

function publicActivation(value: unknown, hostId: MigrationRuntimeHost): PlainRecord {
  if (!isRecord(value)) throw new Error("public projection requires verified activation evidence");
  if (hostId === "claude-code-cli") {
    const receipt = value.receipt;
    if (!isRecord(receipt)) throw new Error("public Claude activation receipt is malformed");
    return Object.freeze({
      mechanism: "host-native-session-start",
      channel: receipt.channel,
      ref: receipt.ref,
      version: receipt.version,
      receipt_sha256: value.sha256,
    });
  }
  return Object.freeze({
    mechanism: value.mechanism,
    skill_name: value.skill_name,
    skill_path: value.skill_path,
    skill_sha256: value.skill_sha256,
  });
}

function publicConformance(value: unknown): PlainRecord {
  if (!isRecord(value) || !Array.isArray(value.required_scenario_ids) || !Array.isArray(value.results)) {
    throw new Error("public projection requires verified conformance results");
  }
  return Object.freeze({
    suite_id: value.suite_id,
    suite_version: value.suite_version,
    required_scenario_ids: [...value.required_scenario_ids],
    results: value.results.map((result) => {
      if (!isRecord(result)) throw new Error("public projection conformance result is malformed");
      return Object.freeze({
        stable_id: result.stable_id,
        disposition: result.disposition,
        outcome_type: result.outcome_type,
        reason_code: result.reason_code,
        evidence_freshness: result.evidence_freshness,
      });
    }),
  });
}

/**
 * Verify raw activated-host evidence, then build a new public identity from an
 * allow-list of non-operator fields. Raw transcript/worker bytes are never copied.
 */
export function projectActivatedHostPublicEvidence(options: VerifyActivatedHostOptions): PlainRecord {
  const verification = verifyActivatedHostConformanceReceipt(options);
  if (!verification.ok) throw new Error(`raw activated-host evidence is not verified: [${verification.code}] ${verification.detail}`);
  const receipt = options.receipt as PlainRecord;
  const hostId = receipt.host_id as MigrationRuntimeHost;
  const withoutHash = {
    schema_version: ACTIVATED_HOST_PUBLIC_EVIDENCE_SCHEMA,
    host_id: hostId,
    source_commit: groupedHex(String(receipt.source_commit)),
    release: receipt.release,
    host_version: receipt.host_version,
    platform: receipt.platform,
    runtime_version: receipt.runtime_version,
    adapter_version: receipt.adapter_version,
    contract_version: receipt.contract_version,
    scenario_suite_id: receipt.scenario_suite_id,
    scenario_suite_version: receipt.scenario_suite_version,
    captured_at: receipt.captured_at,
    source_capture_commitment: groupedHex(String(receipt.capture_id)),
    runtime_package: publicPackageBinding(receipt.runtime_package),
    host_executable: publicHostExecutable(receipt.host_executable),
    host_activation: publicActivation(receipt.host_activation, hostId),
    consumer_trees: publicConsumerTrees(receipt.consumer_trees),
    conformance: publicConformance(receipt.evidence),
    raw_artifacts_included: false,
    external_attestation_verified: false,
    authorizes_promotion: false,
  };
  return Object.freeze({ public_evidence_sha256: sha256Hex(canonical(withoutHash)), ...withoutHash });
}

function hasForbiddenPublicKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasForbiddenPublicKey);
  if (!isRecord(value)) return false;
  return Object.entries(value).some(([key, entry]) => PUBLIC_FORBIDDEN_KEYS.has(key) || hasForbiddenPublicKey(entry));
}

/** Independently verify the two-file public projection without access to raw evidence. */
export function verifyActivatedHostPublicEvidence(
  evidenceBytes: string,
  manifestBytes: string,
): ActivatedHostVerification {
  let evidence: unknown;
  let manifest: unknown;
  try {
    evidence = JSON.parse(evidenceBytes);
    manifest = JSON.parse(manifestBytes);
  } catch {
    return refusal("public_json_invalid", "public evidence or manifest is not JSON");
  }
  if (!isRecord(evidence) || !exactKeys(evidence, PUBLIC_EVIDENCE_KEYS)) return refusal("public_evidence_malformed", "public evidence has an invalid or open member shape");
  if (!isRecord(manifest) || !exactKeys(manifest, PUBLIC_MANIFEST_KEYS)) return refusal("public_manifest_malformed", "public manifest has an invalid or open member shape");
  if (evidence.schema_version !== ACTIVATED_HOST_PUBLIC_EVIDENCE_SCHEMA || manifest.schema_version !== ACTIVATED_HOST_PUBLIC_MANIFEST_SCHEMA) return refusal("public_schema_mismatch", "public evidence schema is not recognized");
  if (!HOSTS.includes(evidence.host_id as MigrationRuntimeHost)) return refusal("public_host_invalid", "public evidence host is unsupported");
  const hostId = evidence.host_id as MigrationRuntimeHost;
  if (typeof evidence.source_commit !== "string" || !GROUPED_COMMIT.test(evidence.source_commit) ||
      ![evidence.release, evidence.host_version, evidence.platform, evidence.runtime_version, evidence.adapter_version, evidence.source_capture_commitment].every(nonEmptyString) ||
      evidence.contract_version !== NEUTRAL_CONTRACT_VERSION || evidence.scenario_suite_id !== NEUTRAL_SCENARIO_SUITE_ID ||
      evidence.scenario_suite_version !== NEUTRAL_SCENARIO_SUITE_VERSION || !isCanonicalUtcInstant(evidence.captured_at) ||
      !validPublicPackage(evidence.runtime_package, hostId) || !validPublicHostExecutable(evidence.host_executable) ||
      !validPublicActivation(evidence.host_activation, hostId) || !validPublicConsumerTrees(evidence.consumer_trees)) {
    return refusal("public_evidence_malformed", "public evidence contains an invalid closed binding");
  }
  if (hasForbiddenPublicKey(evidence) || hasForbiddenPublicKey(manifest)) return refusal("public_private_field", "public evidence contains an operator-private field");
  if (evidence.raw_artifacts_included !== false || evidence.external_attestation_verified !== false || evidence.authorizes_promotion !== false ||
      manifest.raw_artifacts_included !== false || manifest.external_attestation_verified !== false || manifest.authorizes_promotion !== false) {
    return refusal("public_authority_overclaim", "public evidence cannot include raw artifacts, self-attest, or authorize promotion");
  }
  const scan = redactShareableFile(evidenceBytes, "provenance.json");
  const manifestScan = redactShareableFile(manifestBytes, "provenance.json");
  if (scan.out !== evidenceBytes || scan.opPaths !== 0 || scan.secrets.length !== 0 || manifestScan.out !== manifestBytes || manifestScan.opPaths !== 0 || manifestScan.secrets.length !== 0) {
    return refusal("public_not_scrub_clean", "public evidence is not byte-clean under the canonical scrub policy");
  }
  const { public_evidence_sha256: evidenceId, ...withoutEvidenceId } = evidence;
  if (typeof evidenceId !== "string" || !SHA256.test(evidenceId) || evidenceId !== sha256Hex(canonical(withoutEvidenceId))) return refusal("public_evidence_hash_mismatch", "public evidence identity does not match its sanitized fields");
  const { manifest_sha256: manifestId, ...withoutManifestId } = manifest;
  if (typeof manifestId !== "string" || !SHA256.test(manifestId) || manifestId !== sha256Hex(canonical(withoutManifestId))) return refusal("public_manifest_hash_mismatch", "public manifest identity does not match its fields");
  if (manifest.evidence_file !== "activated-host-public-evidence.json" || manifest.file_count !== 1 ||
      typeof manifest.evidence_sha256 !== "string" || !SHA256.test(manifest.evidence_sha256) || manifest.evidence_sha256 !== sha256Hex(evidenceBytes)) {
    return refusal("public_manifest_binding_mismatch", "public manifest does not bind the sole evidence file bytes");
  }
  if (!validPublicConformance(evidence.conformance)) {
    return refusal("public_scenario_coverage_incomplete", "public evidence does not retain the canonical 31-scenario result set");
  }
  return Object.freeze({ ok: true, code: "verified", detail: "public activated-host evidence is closed, scrub-clean, and hash-bound" });
}

export function publishActivatedHostPublicEvidence(
  outDir: string,
  options: VerifyActivatedHostOptions,
): ActivatedHostPublicPublication {
  if (!hasPathEntryNoFollow(outDir)) throw new Error("public evidence output root must already exist as a durable physical directory");
  const outStats = fs.lstatSync(outDir);
  if (!outStats.isDirectory() || outStats.isSymbolicLink()) throw new Error("public evidence output root must be a physical directory");
  const publicEvidence = projectActivatedHostPublicEvidence(options);
  const publicEvidenceSha256 = String(publicEvidence.public_evidence_sha256);
  const evidenceBytes = `${JSON.stringify(publicEvidence, null, 2)}\n`;
  const scan = redactShareableFile(evidenceBytes, "provenance.json");
  if (scan.out !== evidenceBytes || scan.opPaths !== 0 || scan.secrets.length !== 0) {
    throw new Error("public activated-host projection is not scrub-clean");
  }
  const manifestWithoutHash = {
    schema_version: ACTIVATED_HOST_PUBLIC_MANIFEST_SCHEMA,
    evidence_file: "activated-host-public-evidence.json",
    evidence_sha256: sha256Hex(evidenceBytes),
    file_count: 1,
    raw_artifacts_included: false,
    external_attestation_verified: false,
    authorizes_promotion: false,
  };
  const manifest = { manifest_sha256: sha256Hex(canonical(manifestWithoutHash)), ...manifestWithoutHash };
  const manifestBytes = `${JSON.stringify(manifest, null, 2)}\n`;
  const manifestScan = redactShareableFile(manifestBytes, "provenance.json");
  if (manifestScan.out !== manifestBytes || manifestScan.opPaths !== 0 || manifestScan.secrets.length !== 0) {
    throw new Error("public activated-host manifest is not scrub-clean");
  }
  const publicVerification = verifyActivatedHostPublicEvidence(evidenceBytes, manifestBytes);
  if (!publicVerification.ok) throw new Error(`public activated-host verification refused: [${publicVerification.code}] ${publicVerification.detail}`);
  const physicalOut = fs.realpathSync(outDir);
  const finalDir = path.join(physicalOut, `public-${publicEvidenceSha256}`);
  if (hasPathEntryNoFollow(finalDir)) throw new Error(`public evidence already exists: ${publicEvidenceSha256}`);
  const stagingDir = fs.mkdtempSync(path.join(physicalOut, ".activated-host-public-stage-"));
  fs.chmodSync(stagingDir, 0o700);
  let renamed = false;
  try {
    const evidencePath = path.join(stagingDir, "activated-host-public-evidence.json");
    const manifestPath = path.join(stagingDir, "manifest.json");
    writeExclusive(evidencePath, evidenceBytes, 0o644);
    writeExclusive(manifestPath, manifestBytes, 0o644);
    fsyncDirectory(stagingDir);
    fs.renameSync(stagingDir, finalDir);
    renamed = true;
    fsyncDirectory(physicalOut);
  } catch (error) {
    fs.rmSync(renamed ? finalDir : stagingDir, { recursive: true, force: true });
    try { fsyncDirectory(physicalOut); } catch { /* retain original failure */ }
    throw error;
  }
  return Object.freeze({
    directory: finalDir,
    evidencePath: path.join(finalDir, "activated-host-public-evidence.json"),
    manifestPath: path.join(finalDir, "manifest.json"),
    publicEvidenceSha256,
  });
}

function readRegularNoFollow(target: string, label: string): Buffer {
  let descriptor: number | null = null;
  try {
    descriptor = fs.openSync(target, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    if (!fs.fstatSync(descriptor).isFile()) throw new Error("not a regular file");
    return fs.readFileSync(descriptor);
  } catch (error) {
    throw new Error(`${label} is unreadable: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    if (descriptor !== null) fs.closeSync(descriptor);
  }
}

function readPrivateRegularNoFollow(target: string, label: string): Buffer {
  let descriptor: number | null = null;
  try {
    descriptor = fs.openSync(target, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    const stats = fs.fstatSync(descriptor);
    if (!stats.isFile()) throw new Error("not a regular file");
    if (typeof process.getuid === "function" && stats.uid !== process.getuid()) throw new Error("not owned by the current user");
    if ((stats.mode & 0o077) !== 0) throw new Error("group/world permissions are not private");
    return fs.readFileSync(descriptor);
  } catch (error) {
    throw new Error(`${label} is unreadable or unsafe: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    if (descriptor !== null) fs.closeSync(descriptor);
  }
}

const HOST_ENVIRONMENT_KEYS = Object.freeze([
  "PATH", "HOME", "LANG", "LC_ALL", "TMPDIR", "TMP", "TEMP", "TERM", "SHELL", "USER", "LOGNAME",
  "ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN", "OPENAI_API_KEY",
]);

function hostEnvironment(overrides: NodeJS.ProcessEnv = {}, source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of HOST_ENVIRONMENT_KEYS) if (source[key] !== undefined) env[key] = source[key];
  return { ...env, ...overrides };
}

export function isolatedCodexEnvironment(
  stageRoot: string,
  codexHome: string,
  installedRoot: string,
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const isolatedHome = path.join(stageRoot, "isolated-home");
  const xdgRoot = path.join(stageRoot, "xdg");
  const roots = {
    HOME: isolatedHome,
    CODEX_HOME: codexHome,
    XDG_CONFIG_HOME: path.join(xdgRoot, "config"),
    XDG_DATA_HOME: path.join(xdgRoot, "data"),
    XDG_STATE_HOME: path.join(xdgRoot, "state"),
    XDG_CACHE_HOME: path.join(xdgRoot, "cache"),
    GUILD_PLUGIN_ROOT: installedRoot,
  };
  for (const directory of [isolatedHome, ...Object.values(roots).filter((value) => value.startsWith(xdgRoot))]) {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  }
  return hostEnvironment(roots, source);
}

function secretValues(environment: NodeJS.ProcessEnv): string[] {
  return ["ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN", "OPENAI_API_KEY"]
    .map((key) => environment[key])
    .filter((value): value is string => typeof value === "string" && value.length >= 8);
}

export function sensitiveJsonValues(bytes: Buffer): string[] {
  let parsed: unknown;
  try { parsed = JSON.parse(bytes.toString("utf8")); }
  catch { throw new Error("Codex auth material is not valid JSON"); }
  const found = new Set<string>();
  const sensitiveKey = /(?:token|secret|password|credential|authorization|api[_-]?key|private[_-]?key)/i;
  const visit = (value: unknown, inheritedSensitive: boolean): void => {
    if (typeof value === "string") {
      if (inheritedSensitive && value.length >= 8) found.add(value);
      return;
    }
    if (Array.isArray(value)) {
      for (const entry of value) visit(entry, inheritedSensitive);
      return;
    }
    if (!isRecord(value)) return;
    for (const [key, entry] of Object.entries(value)) visit(entry, inheritedSensitive || sensitiveKey.test(key));
  };
  visit(parsed, false);
  return [...found];
}

export function containsSensitiveOutput(
  text: string,
  environment: NodeJS.ProcessEnv,
  additionalSecrets: readonly string[] = [],
): boolean {
  return [...secretValues(environment), ...additionalSecrets].some((value) => value.length >= 8 && text.includes(value));
}

interface PreparedActivation {
  readonly packageRoot: string;
  readonly environment: NodeJS.ProcessEnv;
  readonly transcriptPrefix: string;
  readonly sensitiveValues: string[];
  readonly sensitivePath: string | null;
  readonly sensitiveIdentity: SensitiveFileIdentity | null;
}

interface SensitiveFileIdentity {
  readonly device: string;
  readonly inode: string;
  readonly size: string;
  readonly ctime_ns: string;
  readonly mtime_ns: string;
  readonly sha256: string;
}

function snapshotSensitiveFileIdentity(target: string): SensitiveFileIdentity {
  let descriptor: number | null = null;
  try {
    descriptor = fs.openSync(target, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    const stats = fs.fstatSync(descriptor, { bigint: true });
    if (!stats.isFile()) throw new Error("not a regular file");
    if (typeof process.getuid === "function" && stats.uid !== BigInt(process.getuid())) throw new Error("not owned by the current user");
    if ((stats.mode & 0o77n) !== 0n) throw new Error("group/world permissions are not private");
    const bytes = fs.readFileSync(descriptor);
    return Object.freeze({
      device: stats.dev.toString(), inode: stats.ino.toString(), size: stats.size.toString(),
      ctime_ns: stats.ctimeNs.toString(), mtime_ns: stats.mtimeNs.toString(), sha256: sha256Hex(bytes),
    });
  } catch (error) {
    throw new Error(`Codex auth material is unreadable or unsafe: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    if (descriptor !== null) fs.closeSync(descriptor);
  }
}

function assertSensitiveFileUnchanged(target: string, expected: SensitiveFileIdentity, label: string): void {
  if (canonical(snapshotSensitiveFileIdentity(target)) !== canonical(expected)) throw new Error(`Codex auth material changed during ${label}`);
}

export function refreshSensitiveJsonValues(target: string | null, prior: string[]): readonly string[] {
  if (target === null) return prior;
  for (const value of sensitiveJsonValues(readPrivateRegularNoFollow(target, "refreshed Codex auth material"))) {
    if (!prior.includes(value)) prior.push(value);
  }
  return prior;
}

export function runJsonCommand(
  hostExecutable: OpenedHostExecutable,
  args: readonly string[],
  environment: NodeJS.ProcessEnv,
  label: string,
  additionalSecrets: string[] = [],
  sensitivePath: string | null = null,
): PlainRecord {
  const sensitiveBefore = sensitivePath === null ? null : snapshotSensitiveFileIdentity(sensitivePath);
  const result = spawnOpenExecutable("codex-cli", hostExecutable, args, { timeout: 120_000, env: environment });
  if (sensitivePath !== null && sensitiveBefore !== null) assertSensitiveFileUnchanged(sensitivePath, sensitiveBefore, label);
  const liveSecrets = refreshSensitiveJsonValues(sensitivePath, additionalSecrets);
  if (containsSensitiveOutput(result.stdout, environment, liveSecrets) || containsSensitiveOutput(result.stderr, environment, liveSecrets)) {
    throw new Error(`${label} output was withheld because it contained authentication material`);
  }
  if (result.status !== 0) {
    const detail = result.stderr.trim().slice(0, 500);
    throw new Error(`${label} failed with status ${String(result.status)}${detail ? `: ${detail}` : ""}`);
  }
  const parsed = JSON.parse(result.stdout);
  if (!isRecord(parsed)) throw new Error(`${label} returned a non-object JSON result`);
  return parsed;
}

function prepareCodexActivation(
  stageRoot: string,
  stagedPlugin: string,
  expectedPackage: MigrationRuntimePackageV1,
  release: string,
  hostExecutable: OpenedHostExecutable,
): PreparedActivation {
  const codexHome = path.join(stageRoot, "codex-home");
  const marketplaceRoot = path.join(stageRoot, "codex-marketplace");
  fs.mkdirSync(path.join(marketplaceRoot, ".agents", "plugins"), { recursive: true });
  copyPackageTree(stagedPlugin, path.join(marketplaceRoot, "plugins", "guild"));
  const sourceAuth = path.join(process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex"), "auth.json");
  fs.mkdirSync(codexHome, { recursive: true });
  const authBytes = readPrivateRegularNoFollow(sourceAuth, "Codex auth material");
  const authSensitiveValues = sensitiveJsonValues(authBytes);
  const copiedAuth = path.join(codexHome, "auth.json");
  writeExclusive(copiedAuth, authBytes, 0o600);
  const marketplaceName = "guild-activated-capture";
  writeExclusive(path.join(marketplaceRoot, ".agents", "plugins", "marketplace.json"), `${JSON.stringify({
    name: marketplaceName,
    plugins: [{
      name: "guild",
      source: { source: "local", path: "./plugins/guild" },
      policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
      category: "Developer Tools",
    }],
  }, null, 2)}\n`, 0o600);
  const environment = isolatedCodexEnvironment(stageRoot, codexHome, stagedPlugin);
  const marketplace = runJsonCommand(hostExecutable, ["plugin", "marketplace", "add", marketplaceRoot, "--json"], environment, "Codex marketplace activation", authSensitiveValues, copiedAuth);
  const installed = runJsonCommand(hostExecutable, ["plugin", "add", `guild@${marketplaceName}`, "--json"], environment, "Codex plugin activation", authSensitiveValues, copiedAuth);
  const listed = runJsonCommand(hostExecutable, ["plugin", "list", "--json"], environment, "Codex plugin listing", authSensitiveValues, copiedAuth);
  const expectedPluginId = `guild@${marketplaceName}`;
  if (marketplace.marketplaceName !== marketplaceName) throw new Error("Codex marketplace activation returned the wrong marketplace identity");
  if (installed.pluginId !== expectedPluginId || installed.version !== release || typeof installed.installedPath !== "string" || !path.isAbsolute(installed.installedPath)) throw new Error("Codex plugin activation did not return the expected plugin/release/path");
  const installedRoot = fs.realpathSync(installed.installedPath);
  verifyAttestedGeneratedRuntimePackage(installedRoot, expectedPackage);
  if (!Array.isArray(listed.installed)) throw new Error("Codex plugin listing has no installed set");
  const listEntry = listed.installed.find((entry) => isRecord(entry) && entry.pluginId === expectedPluginId);
  if (!isRecord(listEntry) || listEntry.version !== release || listEntry.installed !== true || listEntry.enabled !== true) throw new Error("Codex plugin listing does not prove the exact enabled Guild release");
  const activation = {
    type: "guild.codex_plugin_activation",
    schema_version: "guild.codex_plugin_activation.v1",
    marketplace: { marketplaceName },
    installed: { pluginId: expectedPluginId, version: release, installedPath: installedRoot },
    list_entry: { pluginId: expectedPluginId, version: release, installed: true, enabled: true },
    activated_package_path: installedRoot,
    runtime_package: bindingOf(expectedPackage),
  };
  return {
    packageRoot: installedRoot,
    environment: isolatedCodexEnvironment(stageRoot, codexHome, installedRoot),
    transcriptPrefix: `${JSON.stringify(activation)}\n`,
    sensitiveValues: authSensitiveValues,
    sensitivePath: copiedAuth,
    sensitiveIdentity: snapshotSensitiveFileIdentity(copiedAuth),
  };
}

/** Launch one host, bind its transcript to a real worker result, and persist a public receipt. */
export function captureActivatedHostConformance(
  options: CaptureActivatedHostOptions,
): CaptureActivatedHostResult {
  const challenge = options.challenge ?? randomBytes(32).toString("hex");
  const failed = (code: string, detail: string, verification: ActivatedHostVerification | null = null): CaptureActivatedHostResult =>
    ({ ok: false, code, detail, receiptPath: null, transcriptPath: null, workerPath: null, verification });
  if (!HOSTS.includes(options.hostId) || options.expectedPackage.host_id !== options.hostId) return failed("host_identity_mismatch", "capture host/package mismatch");
  if (!SHA256.test(challenge) || !COMMIT.test(options.sourceCommit) || !isCanonicalUtcInstant(options.capturedAt)) return failed("capture_identity_invalid", "capture challenge, source commit, or instant is malformed");
  const stageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "guild-activated-host-stage-"));
  let openedHostExecutable: OpenedHostExecutable | null = null;
  try {
    try { verifyAttestedGeneratedRuntimePackage(options.packageRoot, options.expectedPackage); }
    catch (error) { return failed("runtime_package_mismatch", error instanceof Error ? error.message : String(error)); }
    openedHostExecutable = openHostExecutable(options.hostId, process.env, stageRoot);
    const hostExecutable = openedHostExecutable.identity;
    const hostVersion = probeHostVersion(options.hostId, openedHostExecutable);
    const stagedPlugin = path.join(stageRoot, "plugin");
    const stagedWebsite = path.join(stageRoot, "website");
    const stagedBenchmark = path.join(stageRoot, "benchmark");
    copyPackageTree(fs.realpathSync(options.packageRoot), stagedPlugin);
    const consumerIdentities = Object.freeze({
      website: snapshotOfficialConsumerGitTree("website", options.consumerRoots.website, stagedWebsite),
      benchmark: snapshotOfficialConsumerGitTree("benchmark", options.consumerRoots.benchmark, stagedBenchmark),
    });
    try { verifyAttestedGeneratedRuntimePackage(stagedPlugin, options.expectedPackage); }
    catch (error) { return failed("staged_package_mismatch", error instanceof Error ? error.message : String(error)); }
    const prepared = options.hostId === "codex-cli"
      ? prepareCodexActivation(stageRoot, stagedPlugin, options.expectedPackage, options.release, openedHostExecutable)
      : { packageRoot: fs.realpathSync(stagedPlugin), environment: hostEnvironment(), transcriptPrefix: "", sensitiveValues: [], sensitivePath: null, sensitiveIdentity: null };
    const liveSensitiveValues = (): readonly string[] => refreshSensitiveJsonValues(prepared.sensitivePath, prepared.sensitiveValues);
    try { verifyAttestedGeneratedRuntimePackage(prepared.packageRoot, options.expectedPackage); }
    catch (error) { return failed("activated_package_mismatch", error instanceof Error ? error.message : String(error)); }
    const { website: activatedWebsite, benchmark: activatedBenchmark } = activatedConsumerRoots(
      options.hostId,
      stageRoot,
      prepared.packageRoot,
      stagedWebsite,
      stagedBenchmark,
    );
    assertConsumerTreeMatches(activatedWebsite, consumerIdentities.website);
    assertConsumerTreeMatches(activatedBenchmark, consumerIdentities.benchmark);
    const sealedRuntime = sealActivatedWorkerRuntime(stageRoot, prepared.packageRoot, options.expectedPackage);
    const workerOutPath = path.join(stageRoot, "worker-result.json");
    const consumerIdentitiesPath = path.join(stageRoot, "consumer-identities.json");
    writeExclusive(consumerIdentitiesPath, `${JSON.stringify(consumerIdentities, null, 2)}\n`, 0o400);
    const workerCommand = [
      `${safeToken(sealedRuntime.nodePath, "sealed node executable")} ${safeToken(sealedRuntime.workerPath, "sealed worker bundle")} worker`,
      `--host ${safeToken(options.hostId, "host")}`,
      `--challenge ${challenge}`,
      `--source-commit ${options.sourceCommit}`,
      `--package-hash ${options.expectedPackage.tree_sha256}`,
      `--install-surface-hash ${options.expectedPackage.install_surface_sha256}`,
      `--runtime-version ${safeToken(`guild-${options.release}`, "runtime version")}`,
      `--host-version ${safeToken(hostVersion, "host version")}`,
      `--platform ${safeToken(options.platform, "platform")}`,
      `--release ${safeToken(options.release, "release")}`,
      `--captured-at ${safeToken(options.capturedAt, "captured_at")}`,
      `--plugin-root ${safeToken(prepared.packageRoot, "activated plugin root")}`,
      `--module-boundary-root ${safeToken(stagedPlugin, "module-boundary plugin root")}`,
      `--consumer-root website=${safeToken(activatedWebsite, "activated website root")}`,
      `--consumer-root benchmark=${safeToken(activatedBenchmark, "activated benchmark root")}`,
      `--consumer-identities ${safeToken(consumerIdentitiesPath, "consumer identities")}`,
      `--out ${safeToken(workerOutPath, "worker output")}`,
    ].join(" ");
    const marker = markerFor(challenge);
    const launch = defaultHostRunner({
      hostId: options.hostId,
      packageRoot: prepared.packageRoot,
      stageRoot,
      workerOutPath,
      workerCommand,
      marker,
      environment: prepared.environment,
      hostExecutable: openedHostExecutable,
    });
    if (prepared.sensitivePath !== null && prepared.sensitiveIdentity !== null) assertSensitiveFileUnchanged(prepared.sensitivePath, prepared.sensitiveIdentity, "activated Codex host execution");
    const transcript = `${prepared.transcriptPrefix}${launch.stdout}`;
    if (containsSensitiveOutput(transcript, prepared.environment, liveSensitiveValues()) || containsSensitiveOutput(launch.stderr, prepared.environment, liveSensitiveValues())) return failed("secret_leak_refused", "host output contained authentication material and was not persisted");
    if (launch.status !== 0) {
      const safeStderr = containsSensitiveOutput(launch.stderr, prepared.environment, liveSensitiveValues()) ? "stderr withheld because it contained authentication material" : launch.stderr.trim().slice(0, 500);
      return failed("host_process_failed", `host exited ${String(launch.status)}${safeStderr ? `: ${safeStderr}` : ""}`);
    }
    let workerBytes: Buffer;
    let worker: unknown;
    try {
      workerBytes = readRegularNoFollow(workerOutPath, "worker result");
      worker = JSON.parse(workerBytes.toString("utf8"));
    } catch (error) {
      const diagnostic = containsSensitiveOutput(transcript, prepared.environment, liveSensitiveValues()) ? "transcript withheld" : transcript.slice(-1000);
      return failed("worker_output_missing", `${error instanceof Error ? error.message : String(error)}${diagnostic ? `; transcript tail: ${diagnostic}` : ""}`);
    }
    if (!isRecord(worker) || !exactKeys(worker, ["schema_version", "ok", "code", "detail", "marker", "challenge", "host_id", "evidence", "package_snapshot", "host_activation", "consumer_trees"]) || worker.schema_version !== ACTIVATED_HOST_WORKER_SCHEMA || worker.ok !== true || worker.code !== "evaluated" || worker.marker !== marker || worker.challenge !== challenge || worker.host_id !== options.hostId || !isRecord(worker.evidence) || !isRecord(worker.package_snapshot) || !validConsumerTreeSet(worker.consumer_trees) || canonical(worker.consumer_trees) !== canonical(consumerIdentities) || (options.hostId === "claude-code-cli" ? !isRecord(worker.host_activation) : worker.host_activation !== null)) return failed("worker_output_invalid", "worker output is incomplete, mismatched, or overclaims");
    if (canonical(worker.package_snapshot) !== canonical(bindingOf(options.expectedPackage))) return failed("runtime_package_mismatch", "worker did not self-snapshot the exact attested package");
    const hostActivation = options.hostId === "codex-cli"
      ? codexSkillActivation(options.expectedPackage, prepared.packageRoot)
      : worker.host_activation;
    const activationCheck = validateHostActivation(hostActivation, options.hostId, options.release, options.capturedAt, options.expectedPackage, prepared.packageRoot);
    if (!activationCheck.ok) return failed(activationCheck.code, activationCheck.detail, activationCheck);
    const workerResultSha256 = sha256Hex(workerBytes);
    const sessionId = sessionIdFromTranscript(options.hostId, transcript);
    if (sessionId === null) return failed("transcript_malformed", "host transcript carries no session/thread id");
    try { verifyAttestedGeneratedRuntimePackage(prepared.packageRoot, options.expectedPackage); }
    catch (error) { return failed("activated_package_drift", error instanceof Error ? error.message : String(error)); }
    const withoutId = {
      schema_version: ACTIVATED_HOST_CONFORMANCE_SCHEMA,
      host_id: options.hostId,
      source_commit: options.sourceCommit,
      release: options.release,
      runtime_package: bindingOf(options.expectedPackage),
      host_version: hostVersion,
      host_executable: hostExecutable,
      platform: options.platform,
      runtime_version: `guild-${options.release}`,
      adapter_version: "guild.host_adapter.v1.0.0",
      contract_version: NEUTRAL_CONTRACT_VERSION,
      scenario_suite_id: NEUTRAL_SCENARIO_SUITE_ID,
      scenario_suite_version: NEUTRAL_SCENARIO_SUITE_VERSION,
      challenge,
      activated_package_path: prepared.packageRoot,
      worker_command_sha256: sha256Hex(workerCommand),
      worker_result_sha256: workerResultSha256,
      transcript_sha256: sha256Hex(transcript),
      session_id: sessionId,
      captured_at: options.capturedAt,
      evidence: worker.evidence,
      activated_package_snapshot: worker.package_snapshot,
      host_activation: hostActivation,
      consumer_trees: consumerIdentities,
      external_attestation_verified: false,
      authorizes_promotion: false,
    };
    const receipt = { capture_id: activatedHostCaptureId(withoutId), ...withoutId };
    const verification = verifyActivatedHostConformanceReceipt({
      receipt,
      transcript,
      workerResult: workerBytes.toString("utf8"),
      packageRoot: options.packageRoot,
      expectedPackage: options.expectedPackage,
      expectedSourceCommit: options.sourceCommit,
      expectedRelease: options.release,
    });
    if (!verification.ok) {
      const diagnostic = containsSensitiveOutput(transcript, prepared.environment, liveSensitiveValues()) ? "transcript withheld" : JSON.stringify((parseJsonl(transcript) ?? []).filter((row) => row.type === "assistant" || row.type === "user" || row.type === "result").map((row) => ({ type: row.type, subtype: row.subtype, result: row.result, content: isRecord(row.message) ? row.message.content : undefined }))).slice(-4000);
      return failed(verification.code, `${verification.detail}${diagnostic ? `; transcript tail: ${diagnostic}` : ""}`, verification);
    }
    const receiptBytes = `${JSON.stringify(receipt, null, 2)}\n`;
    if ([transcript, workerBytes.toString("utf8"), receiptBytes].some((value) => containsSensitiveOutput(value, prepared.environment, liveSensitiveValues()))) {
      return failed("secret_leak_refused", "final evidence contained authentication material and was not persisted");
    }
    const { receiptPath, transcriptPath, workerPath } = publishActivatedHostEvidence(
      options.outDir,
      options.hostId,
      receipt.capture_id,
      transcript,
      workerBytes,
      receiptBytes,
      liveSensitiveValues(),
    );
    return { ok: true, code: "captured", detail: verification.detail, receiptPath, transcriptPath, workerPath, verification };
  } catch (error) {
    return failed("capture_error", error instanceof Error ? error.message : String(error));
  } finally {
    if (openedHostExecutable !== null) fs.closeSync(openedHostExecutable.descriptor);
    fs.rmSync(stageRoot, { recursive: true, force: true });
  }
}

function workerReceiptRefs(challenge: string): Record<string, string> {
  const refs: Record<string, string> = {};
  for (let index = 0; index < NEUTRAL_REQUIRED_SUITE_SCENARIO_IDS.length; index += 1) {
    const sequence = index + 1;
    const commitment = sha256Hex(`${challenge}|${NEUTRAL_REQUIRED_SUITE_SCENARIO_IDS[index]}|${sequence}`).slice(0, 16);
    refs[NEUTRAL_REQUIRED_SUITE_SCENARIO_IDS[index]] =
      `guild.receipt_ref.v1:activated-${challenge.slice(0, 12)}#${sequence}@nec1:${commitment}`;
  }
  return refs;
}

/**
 * Execute the six production owner evaluators from raw inputs. This worker is
 * what the host process invokes; it makes no activation claim by itself. Only
 * the controller's transcript/package verifier may turn its output into an
 * activated-host capture.
 */
export function runActivatedConformanceWorker(
  options: ActivatedConformanceWorkerOptions,
): ActivatedConformanceWorkerResult {
  const marker = markerFor(options.challenge);
  const failed = (code: string, detail: string): ActivatedConformanceWorkerResult => ({
    ok: false,
    code,
    detail,
    marker,
    evidence: null,
    packageSnapshot: null,
    hostActivation: null,
    consumerTrees: null,
  });
  if (!HOSTS.includes(options.hostId)) return failed("host_identity_invalid", "worker host is not supported");
  if (!SHA256.test(options.challenge) || !SHA256.test(options.packageHash) || !SHA256.test(options.installSurfaceHash) || !COMMIT.test(options.sourceCommit)) return failed("worker_identity_invalid", "worker challenge, package hashes, or source commit is malformed");
  if (!validConsumerTreeSet(options.consumerIdentities)) return failed("consumer_identity_invalid", "worker consumer identities are missing or malformed");
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "guild-activated-conformance-worker-"));
  try {
    const receiptPath = path.join(options.pluginRoot, "guild-install-receipt.json");
    const hostActivation = options.hostId === "claude-code-cli"
      ? consumeHostActivationReceipt(options.pluginRoot, options.hostId, options.release, options.capturedAt ?? "")
      : (hasPathEntryNoFollow(receiptPath)
          ? (consumeHostActivationReceipt(options.pluginRoot, options.hostId, options.release, options.capturedAt ?? ""), null)
          : null);
    const packageBefore = snapshotMigrationRuntimePackage(options.pluginRoot, options.hostId);
    if (packageBefore.tree_sha256 !== options.packageHash) {
      return failed("runtime_package_mismatch", "worker self-snapshot does not match the expected package hash");
    }
    const boundaryPackageBefore = snapshotMigrationRuntimePackage(options.moduleBoundaryRoot, options.hostId);
    if (canonical(boundaryPackageBefore) !== canonical(packageBefore)) {
      return failed("module_boundary_package_mismatch", "MH-07 package twin does not match the activated runtime package");
    }
    for (const name of CONSUMER_NAMES) {
      const root = options.consumerRoots[name];
      if (typeof root !== "string") return failed("consumer_identity_invalid", `worker has no ${name} consumer root`);
      try { assertConsumerTreeMatches(root, options.consumerIdentities[name]); }
      catch (error) { return failed("consumer_identity_invalid", error instanceof Error ? error.message : String(error)); }
    }
    options.testOnlyAfterInitialConsumerSnapshot?.();
    options.testOnlyAfterInitialPackageSnapshot?.();
    options.testOnlyAfterInitialBoundarySnapshot?.();
    const journalRoot = path.join(temporaryRoot, "receipt-journal");
    const migrationJournalRoot = path.join(temporaryRoot, "migration-journal");
    fs.mkdirSync(journalRoot, { recursive: true });
    fs.mkdirSync(migrationJournalRoot, { recursive: true });
    const freshness: Record<string, string> = {};
    for (const stableId of NEUTRAL_REQUIRED_SUITE_SCENARIO_IDS) freshness[stableId] = "fresh";
    const identity = {
      source_commit: options.sourceCommit,
      package_hash: `sha256:${options.packageHash}`,
      runtime_version: options.runtimeVersion,
      adapter_version: "guild.host_adapter.v1.0.0",
      host_id: options.hostId,
      host_version: options.hostVersion,
      platform: options.platform,
      contract_version: NEUTRAL_CONTRACT_VERSION,
      scenario_suite_id: NEUTRAL_SCENARIO_SUITE_ID,
      scenario_suite_version: NEUTRAL_SCENARIO_SUITE_VERSION,
      release_id: releaseId(options.release, (options.capturedAt ?? "2026-08-21T00:00:00.000Z").slice(0, 10)),
    };
    const request = neutralCanonicalJson({
      claim: { claimant_id: "guild.activated-host-capture", activated_runtime: identity },
      owner_inputs: {
        run_id: `run-activated-${options.hostId}-${options.challenge.slice(0, 16)}`,
        receipt_refs: workerReceiptRefs(options.challenge),
        evidence_freshness: freshness,
        journal_root: journalRoot,
        migration_journal_root: migrationJournalRoot,
        migration_scenario_evidence: {},
        plugin_root: fs.realpathSync(options.moduleBoundaryRoot),
        consumer_roots: Object.fromEntries(
          Object.entries(options.consumerRoots).map(([name, root]) => [name, fs.realpathSync(root)]),
        ),
        release_mode: "production",
        release_scenario_evidence: {},
      },
    });
    const result = runNeutralConformanceReleaseIntegration(request);
    if (result.evidence === null || result.packets === null || result.outcome.disposition !== "succeeded") {
      return failed(
        "owner_evaluation_refused",
        `production integration refused: ${String(result.outcome.reason_code ?? "unnamed")} ` +
          `(control=${String(result.outcome.facts?.refusal_control ?? "unnamed")}, ` +
          `owner=${String(result.outcome.facts?.owner_key ?? "unnamed")}, ` +
          `detail=${String(result.outcome.facts?.owner_detail ?? "unnamed")})`,
      );
    }
    const packageAfter = snapshotMigrationRuntimePackage(options.pluginRoot, options.hostId);
    if (canonical(packageAfter) !== canonical(packageBefore)) {
      return failed("runtime_package_drift", "worker package self-snapshot changed during owner evaluation");
    }
    const boundaryPackageAfter = snapshotMigrationRuntimePackage(options.moduleBoundaryRoot, options.hostId);
    if (canonical(boundaryPackageAfter) !== canonical(boundaryPackageBefore)) {
      return failed("module_boundary_package_drift", "MH-07 package twin changed during owner evaluation");
    }
    for (const name of CONSUMER_NAMES) {
      try { assertConsumerTreeMatches(options.consumerRoots[name], options.consumerIdentities[name]); }
      catch (error) { return failed("consumer_tree_drift", error instanceof Error ? error.message : String(error)); }
    }
    return {
      ok: true,
      code: "evaluated",
      detail: "six production owner evaluators assembled the canonical 31-scenario evidence",
      marker,
      evidence: result.evidence,
      packageSnapshot: Object.freeze({ ...bindingOf(packageBefore), install_surface_sha256: options.installSurfaceHash }),
      hostActivation,
      consumerTrees: options.consumerIdentities,
    };
  } catch (error) {
    return failed("owner_evaluation_error", error instanceof Error ? error.message : String(error));
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

function verifyClaudeTranscript(
  rows: readonly PlainRecord[],
  receipt: PlainRecord,
  expectedRelease: string,
): ActivatedHostVerification {
  const sessionId = receipt.session_id;
  const successLine = `${markerFor(receipt.challenge as string)}:RESULT_SHA256:${String(receipt.worker_result_sha256)}`;
  let initCount = 0;
  let toolUseId: string | null = null;
  let toolResultCount = 0;
  let finalMessageCount = 0;
  let resultCount = 0;

  for (const row of rows) {
    if (row.type === "system" && row.subtype === "init") {
      initCount += 1;
      if (row.session_id !== sessionId || !Array.isArray(row.plugins)) return refusal("host_activation_unproven", "Claude initialization identity is mismatched");
      const guild = row.plugins.filter((plugin) => isRecord(plugin) && plugin.name === "guild");
      if (guild.length !== 1 || guild[0].version !== expectedRelease || typeof guild[0].path !== "string" || path.resolve(guild[0].path) !== path.resolve(String(receipt.activated_package_path))) return refusal("host_activation_unproven", "Claude initialization does not name the exact activated Guild package/version");
    }
    if (row.type === "assistant" && isRecord(row.message)) {
      for (const content of contentRows(row.message)) {
        if (content.type === "tool_use") {
          if (initCount !== 1 || toolUseId !== null || content.name !== "Bash" || typeof content.id !== "string" || !isRecord(content.input) || typeof content.input.command !== "string" || sha256Hex(content.input.command) !== receipt.worker_command_sha256) return refusal("host_command_unproven", "Claude executed an additional, out-of-order, or mismatched tool command");
          toolUseId = content.id;
        }
        if (content.type === "text") {
          if (content.text === successLine && toolResultCount === 1) finalMessageCount += 1;
          else if (toolResultCount !== 0 || finalMessageCount !== 0) return refusal("host_command_unproven", "Claude emitted an unexpected or out-of-order assistant message");
        }
      }
    }
    if (row.type === "user" && isRecord(row.message)) {
      for (const content of contentRows(row.message)) {
        if (content.type !== "tool_result") continue;
        if (toolUseId === null || content.tool_use_id !== toolUseId || content.is_error !== false || content.content !== successLine || toolResultCount !== 0) return refusal("host_command_unproven", "Claude tool result is not the unique exact-command result/digest");
        toolResultCount += 1;
      }
    }
    if (row.type === "result") {
      if (row.subtype !== "success" || row.session_id !== sessionId || row.result !== successLine || finalMessageCount !== 1) return refusal("host_command_unproven", "Claude terminal result is mismatched or out of order");
      resultCount += 1;
    }
  }

  if (initCount !== 1) return refusal("host_activation_unproven", "Claude transcript must contain exactly one matching initialization event");
  if (toolUseId === null || toolResultCount !== 1 || finalMessageCount !== 1 || resultCount !== 1) return refusal("host_command_unproven", "Claude transcript does not prove one ordered command/result/digest sequence");
  return Object.freeze({ ok: true, code: "verified", detail: "Claude plugin activation and worker command are transcript-bound" });
}

function unwrapCodexCommand(command: string): string {
  const prefix = "/bin/zsh -lc '";
  if (command.startsWith(prefix) && command.endsWith("'")) return command.slice(prefix.length, -1);
  return command;
}

function verifyCodexTranscript(rows: readonly PlainRecord[], receipt: PlainRecord): ActivatedHostVerification {
  const sessionId = receipt.session_id;
  const successLine = `${markerFor(receipt.challenge as string)}:RESULT_SHA256:${String(receipt.worker_result_sha256)}`;
  let activationCount = 0;
  let threadCount = 0;
  let turnStarted = 0;
  let commandId: string | null = null;
  let commandCompleted = 0;
  let skillProbeCount = 0;
  let finalCount = 0;
  let turnCount = 0;
  for (const row of rows) {
    if (row.type === "guild.codex_plugin_activation") {
      activationCount += 1;
      const pluginId = "guild@guild-activated-capture";
      if (
        !exactKeys(row, ["type", "schema_version", "marketplace", "installed", "list_entry", "activated_package_path", "runtime_package"]) ||
        row.schema_version !== "guild.codex_plugin_activation.v1" ||
        row.activated_package_path !== receipt.activated_package_path ||
        !isRecord(row.marketplace) || !exactKeys(row.marketplace, ["marketplaceName"]) || row.marketplace.marketplaceName !== "guild-activated-capture" ||
        !isRecord(row.installed) || !exactKeys(row.installed, ["pluginId", "version", "installedPath"]) || row.installed.pluginId !== pluginId || row.installed.version !== receipt.release || row.installed.installedPath !== receipt.activated_package_path ||
        !isRecord(row.list_entry) || !exactKeys(row.list_entry, ["pluginId", "version", "installed", "enabled"]) || row.list_entry.pluginId !== pluginId || row.list_entry.installed !== true || row.list_entry.enabled !== true || row.list_entry.version !== receipt.release ||
        !isRecord(row.runtime_package) || canonical(row.runtime_package) !== canonical(receipt.runtime_package)
      ) return refusal("host_activation_unproven", "Codex activation record does not prove the exact Guild marketplace/plugin identity and enabled installed package");
    }
    if (row.type === "thread.started") {
      threadCount += 1;
      if (activationCount !== 1 || row.thread_id !== sessionId) return refusal("host_command_unproven", "Codex transcript contains an out-of-order or mismatched thread");
    }
    if (row.type === "turn.started") {
      if (threadCount !== 1 || turnStarted !== 0) return refusal("host_command_unproven", "Codex turn is missing, duplicated, or out of order");
      turnStarted += 1;
    }
    if ((row.type === "item.started" || row.type === "item.completed") && isRecord(row.item) && row.item.type === "command_execution") {
      const item = row.item;
      if (threadCount !== 1 || skillProbeCount !== 1 || typeof item.id !== "string" || typeof item.command !== "string" || sha256Hex(unwrapCodexCommand(item.command)) !== receipt.worker_command_sha256) return refusal("host_command_unproven", "Codex executed an additional, out-of-order, or mismatched command");
      if (commandId !== null && commandId !== item.id) return refusal("host_command_unproven", "Codex transcript contains more than one command execution");
      commandId = item.id;
    }
    if (row.type === "item.completed" && isRecord(row.item)) {
      const item = row.item;
      if (
        item.type === "command_execution" &&
        item.status === "completed" &&
        item.exit_code === 0 &&
        typeof item.aggregated_output === "string" &&
        item.aggregated_output.trim() === successLine
      ) {
        commandCompleted += 1;
      }
      if (item.type === "agent_message") {
        const declaration = isRecord(receipt.host_activation) ? receipt.host_activation.declaration : null;
        if (item.text === declaration && skillProbeCount === 0) {
          if (threadCount !== 1 || turnStarted !== 1 || commandId !== null || commandCompleted !== 0) {
            return refusal("host_activation_unproven", "Codex model-visible Guild skill declaration is outside the started thread/turn");
          }
          skillProbeCount += 1;
        } else {
          if (item.text !== successLine || commandCompleted !== 1 || skillProbeCount !== 1) return refusal("host_command_unproven", "Codex activation declaration or final message is mismatched or out of order");
          finalCount += 1;
        }
      }
    }
    if (row.type === "turn.completed") {
      if (finalCount !== 1) return refusal("host_command_unproven", "Codex completed before its exact final digest message");
      turnCount += 1;
    }
  }
  if (activationCount !== 1 || skillProbeCount !== 1) return refusal("host_activation_unproven", "Codex transcript must carry one enabled-plugin record and one exact model-visible Guild skill declaration");
  if (threadCount !== 1 || turnStarted !== 1 || commandId === null || commandCompleted !== 1 || finalCount !== 1 || turnCount !== 1) return refusal("host_command_unproven", "Codex transcript does not prove one ordered skill-probe/command/result/digest sequence");
  return Object.freeze({ ok: true, code: "verified", detail: "Codex model-visible Guild skill activation and worker command are transcript-bound" });
}

const RECEIPT_KEYS = Object.freeze([
  "capture_id",
  "schema_version",
  "host_id",
  "source_commit",
  "release",
  "runtime_package",
  "host_version",
  "host_executable",
  "platform",
  "runtime_version",
  "adapter_version",
  "contract_version",
  "scenario_suite_id",
  "scenario_suite_version",
  "challenge",
  "activated_package_path",
  "worker_command_sha256",
  "worker_result_sha256",
  "transcript_sha256",
  "session_id",
  "captured_at",
  "evidence",
  "activated_package_snapshot",
  "host_activation",
  "consumer_trees",
  "external_attestation_verified",
  "authorizes_promotion",
]);

/** Verify one public, non-authorizing activated-host capture. */
export function verifyActivatedHostConformanceReceipt(
  options: VerifyActivatedHostOptions,
): ActivatedHostVerification {
  if (!isRecord(options.receipt) || !exactKeys(options.receipt, RECEIPT_KEYS)) {
    return refusal("receipt_malformed", "activated-host receipt has an invalid or open member shape");
  }
  const receipt = options.receipt;
  if (receipt.schema_version !== ACTIVATED_HOST_CONFORMANCE_SCHEMA) return refusal("receipt_malformed", "wrong schema_version");
  if (!HOSTS.includes(receipt.host_id as MigrationRuntimeHost) || receipt.host_id !== options.expectedPackage.host_id) return refusal("host_identity_mismatch", "receipt host does not match the expected package host");
  if (typeof receipt.source_commit !== "string" || !COMMIT.test(receipt.source_commit) || receipt.source_commit !== options.expectedSourceCommit) return refusal("source_commit_mismatch", "receipt does not bind the expected source commit");
  if (receipt.release !== options.expectedRelease || receipt.runtime_version !== `guild-${options.expectedRelease}`) return refusal("release_identity_mismatch", "receipt does not bind the expected release/runtime version");
  if (!validHostExecutableIdentity(receipt.host_executable)) return refusal("host_identity_mismatch", "receipt does not bind one resolved host executable identity");
  if (typeof receipt.challenge !== "string" || !SHA256.test(receipt.challenge)) return refusal("receipt_malformed", "challenge must be 32 random bytes encoded as lowercase hex");
  if (typeof receipt.activated_package_path !== "string" || !path.isAbsolute(receipt.activated_package_path)) return refusal("receipt_malformed", "activated_package_path must be absolute");
  if (typeof receipt.worker_command_sha256 !== "string" || !SHA256.test(receipt.worker_command_sha256)) return refusal("receipt_malformed", "worker command digest is malformed");
  if (typeof receipt.worker_result_sha256 !== "string" || !SHA256.test(receipt.worker_result_sha256)) return refusal("receipt_malformed", "worker result digest is malformed");
  if (typeof receipt.transcript_sha256 !== "string" || !SHA256.test(receipt.transcript_sha256)) return refusal("receipt_malformed", "transcript digest is malformed");
  if (typeof receipt.session_id !== "string" || !SESSION_ID.test(receipt.session_id)) return refusal("receipt_malformed", "host session id is malformed");
  if (!isCanonicalUtcInstant(receipt.captured_at)) return refusal("receipt_malformed", "captured_at is not a real canonical UTC instant");
  if (receipt.external_attestation_verified !== false || receipt.authorizes_promotion !== false) return refusal("authority_overclaim", "an activated-host capture is public evidence only and cannot self-attest or authorize promotion");
  if (!isRecord(receipt.activated_package_snapshot) || canonical(receipt.activated_package_snapshot) !== canonical(bindingOf(options.expectedPackage))) return refusal("runtime_package_mismatch", "worker self-snapshot does not bind the attested beta package");
  if (!validConsumerTreeSet(receipt.consumer_trees)) return refusal("consumer_identity_invalid", "receipt does not bind the official website and benchmark Git trees");
  const activationCheck = validateHostActivation(receipt.host_activation, receipt.host_id as MigrationRuntimeHost, String(receipt.release), String(receipt.captured_at), options.expectedPackage, options.packageRoot);
  if (!activationCheck.ok) return activationCheck;

  const { capture_id: captureId, ...withoutId } = receipt;
  if (captureId !== activatedHostCaptureId(withoutId)) return refusal("capture_id_mismatch", "receipt bytes do not match their capture id");
  if (sha256Hex(options.transcript) !== receipt.transcript_sha256) return refusal("transcript_hash_mismatch", "transcript bytes do not match the receipt");
  if (sha256Hex(options.workerResult) !== receipt.worker_result_sha256) return refusal("worker_result_hash_mismatch", "worker result bytes do not match the receipt");
  let worker: unknown;
  try { worker = JSON.parse(options.workerResult); }
  catch { return refusal("worker_output_invalid", "worker result is not JSON"); }
  if (!isRecord(worker) || !exactKeys(worker, ["schema_version", "ok", "code", "detail", "marker", "challenge", "host_id", "evidence", "package_snapshot", "host_activation", "consumer_trees"]) || worker.schema_version !== ACTIVATED_HOST_WORKER_SCHEMA || worker.ok !== true || worker.code !== "evaluated" || worker.marker !== markerFor(receipt.challenge) || worker.challenge !== receipt.challenge || worker.host_id !== receipt.host_id || canonical(worker.evidence) !== canonical(receipt.evidence) || canonical(worker.package_snapshot) !== canonical(receipt.activated_package_snapshot) || canonical(worker.consumer_trees) !== canonical(receipt.consumer_trees) || (receipt.host_id === "claude-code-cli" ? canonical(worker.host_activation) !== canonical(receipt.host_activation) : worker.host_activation !== null)) return refusal("worker_output_invalid", "worker result does not exactly bind the receipt evidence, package snapshot, consumer trees, and host-specific activation identity");

  if (!isRecord(receipt.runtime_package) || canonical(receipt.runtime_package) !== canonical(bindingOf(options.expectedPackage))) return refusal("runtime_package_mismatch", "receipt runtime binding does not match the attested beta package");
  let actualPackage: MigrationRuntimePackageV1;
  try {
    actualPackage = verifyAttestedGeneratedRuntimePackage(options.packageRoot, options.expectedPackage);
  } catch (error) {
    return refusal("runtime_package_mismatch", `runtime package cannot be snapshotted: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (canonical(actualPackage) !== canonical(options.expectedPackage)) return refusal("runtime_package_mismatch", "runtime package bytes changed before or after host execution");
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(options.packageRoot, options.expectedPackage.manifest_path), "utf8"));
    if (!isRecord(manifest) || manifest.name !== "guild" || manifest.version !== options.expectedRelease) return refusal("release_identity_mismatch", "runtime manifest does not name the expected Guild release");
  } catch (error) {
    return refusal("runtime_package_mismatch", `runtime manifest is unreadable: ${error instanceof Error ? error.message : String(error)}`);
  }

  const rows = parseJsonl(options.transcript);
  if (rows === null) return refusal("transcript_malformed", "host transcript is not non-empty JSONL");
  const transcriptCheck = receipt.host_id === "claude-code-cli"
    ? verifyClaudeTranscript(rows, receipt, options.expectedRelease)
    : verifyCodexTranscript(rows, receipt);
  if (!transcriptCheck.ok) return transcriptCheck;

  if (!isRecord(receipt.evidence)) return refusal("scenario_coverage_incomplete", "receipt carries no conformance evidence");
  const evidence = receipt.evidence;
  if (!Array.isArray(evidence.required_scenario_ids) || !Array.isArray(evidence.results) || evidence.required_scenario_ids.length !== NEUTRAL_REQUIRED_SUITE_SCENARIO_IDS.length || evidence.results.length !== NEUTRAL_REQUIRED_SUITE_SCENARIO_IDS.length) return refusal("scenario_coverage_incomplete", "receipt does not carry exactly 31 required ids and 31 results");
  for (let index = 0; index < NEUTRAL_REQUIRED_SUITE_SCENARIO_IDS.length; index += 1) {
    if (evidence.required_scenario_ids[index] !== NEUTRAL_REQUIRED_SUITE_SCENARIO_IDS[index] || !isRecord(evidence.results[index]) || evidence.results[index].stable_id !== NEUTRAL_REQUIRED_SUITE_SCENARIO_IDS[index]) return refusal("scenario_coverage_incomplete", "scenario tuple/results are not the canonical ordered 31");
  }

  const expectedIdentity: PlainRecord = {
    source_commit: receipt.source_commit,
    package_hash: `sha256:${options.expectedPackage.tree_sha256}`,
    runtime_version: receipt.runtime_version,
    adapter_version: receipt.adapter_version,
    host_id: receipt.host_id,
    host_version: receipt.host_version,
    platform: receipt.platform,
    contract_version: receipt.contract_version,
    scenario_suite_id: receipt.scenario_suite_id,
    scenario_suite_version: receipt.scenario_suite_version,
    release_id: `rel-${String(receipt.captured_at).slice(0, 10)}-${String(receipt.release)
      .split("-")
      .slice(1)
      .join("")
      .replace(/[^0-9a-z]/gi, "")
      .toLowerCase()
      .slice(0, 16)}`,
  };
  if (
    receipt.contract_version !== NEUTRAL_CONTRACT_VERSION ||
    receipt.scenario_suite_id !== NEUTRAL_SCENARIO_SUITE_ID ||
    receipt.scenario_suite_version !== NEUTRAL_SCENARIO_SUITE_VERSION ||
    !isRecord(evidence.activated_runtime)
  ) {
    return refusal("scenario_identity_mismatch", "receipt names an unrecognized contract or scenario suite identity");
  }
  for (const field of NEUTRAL_EVIDENCE_IDENTITY_FIELDS) {
    if (evidence.activated_runtime[field] !== expectedIdentity[field]) return refusal("scenario_identity_mismatch", `activated runtime differs at ${field}`);
  }
  for (const result of evidence.results) {
    if (!isRecord(result) || !isRecord(result.evidence_identity)) return refusal("scenario_identity_mismatch", "scenario result has no evidence identity");
    for (const field of NEUTRAL_EVIDENCE_IDENTITY_FIELDS) {
      if (result.evidence_identity[field] !== expectedIdentity[field]) return refusal("scenario_identity_mismatch", `scenario result differs at ${field}`);
    }
  }

  const transported = evaluateTransportedReleaseConformance(evidence, {});
  if (transported.stage !== "decision") return refusal("scenario_coverage_incomplete", `production re-assembly refused at ${transported.stage}: ${transported.detail}`);
  return Object.freeze({ ok: true, code: "verified", detail: "exact package, activated host transcript, and canonical 31-scenario evidence verify" });
}

function cliValues(argv: readonly string[], flag: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== flag) continue;
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`${flag} <value> is required`);
    values.push(value);
  }
  return values;
}

function cliValue(argv: readonly string[], flag: string): string {
  const values = cliValues(argv, flag);
  if (values.length !== 1) throw new Error(`${flag} must appear exactly once`);
  return values[0];
}

function parseConsumerRoots(values: readonly string[]): Readonly<Record<string, string>> {
  if (values.length !== 2) throw new Error("--consumer-root must name website and benchmark exactly once");
  const roots: Record<string, string> = {};
  for (const value of values) {
    const separator = value.indexOf("=");
    if (separator <= 0) throw new Error("--consumer-root uses name=/absolute/path");
    const name = value.slice(0, separator);
    const root = value.slice(separator + 1);
    if ((name !== "website" && name !== "benchmark") || roots[name] !== undefined || !path.isAbsolute(root)) throw new Error("--consumer-root must name distinct absolute website and benchmark roots");
    roots[name] = root;
  }
  if (roots.website === undefined || roots.benchmark === undefined) throw new Error("--consumer-root must include website and benchmark");
  return roots;
}

function probeHostVersion(hostId: MigrationRuntimeHost, hostExecutable: OpenedHostExecutable): string {
  const result = spawnOpenExecutable(hostId, hostExecutable, ["--version"], { timeout: 30_000, env: process.env });
  if (result.status !== 0) throw new Error(`${executableName(hostId)} --version failed with status ${String(result.status)}: ${(result.stderr ?? "").trim()}`);
  const match = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.match(/\b\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?\b/);
  if (match === null) throw new Error(`${executableName(hostId)} --version did not report a semantic version`);
  return match[0];
}

function assertCliPairs(argv: readonly string[], allowed: ReadonlySet<string>, label: string): void {
  for (let index = 0; index < argv.length; index += 2) {
    if (!allowed.has(argv[index])) throw new Error(`unknown ${label} option ${JSON.stringify(argv[index])}`);
    if (argv[index + 1] === undefined) throw new Error(`${argv[index]} <value> is required`);
  }
}

function runCaptureCli(argv: readonly string[]): number {
  assertCliPairs(argv, new Set(["--host", "--boundary", "--package-root", "--consumer-root", "--out-dir"]), "capture");
  const hostId = cliValue(argv, "--host") as MigrationRuntimeHost;
  if (!HOSTS.includes(hostId)) throw new Error("--host must be claude-code-cli or codex-cli");
  const boundary = loadAttestedMigrationBoundary(path.resolve(cliValue(argv, "--boundary"))).boundary;
  const packageRoot = fs.realpathSync(path.resolve(cliValue(argv, "--package-root")));
  const expectedPackage = boundary.packages[hostId];
  verifyAttestedGeneratedRuntimePackage(packageRoot, expectedPackage);
  const consumers = parseConsumerRoots(cliValues(argv, "--consumer-root"));
  const result = captureActivatedHostConformance({
    hostId,
    packageRoot,
    expectedPackage,
    sourceCommit: boundary.source_commit,
    release: boundary.release,
    platform: `${process.platform}-${process.arch}`,
    capturedAt: new Date().toISOString(),
    consumerRoots: {
      website: fs.realpathSync(consumers.website),
      benchmark: fs.realpathSync(consumers.benchmark),
    },
    outDir: path.resolve(cliValue(argv, "--out-dir")),
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result.ok ? 0 : 2;
}

function runVerifyCli(argv: readonly string[]): number {
  assertCliPairs(argv, new Set(["--host", "--boundary", "--package-root", "--receipt", "--transcript", "--worker-result"]), "verify");
  const hostId = cliValue(argv, "--host") as MigrationRuntimeHost;
  if (!HOSTS.includes(hostId)) throw new Error("--host must be claude-code-cli or codex-cli");
  const boundary = loadAttestedMigrationBoundary(path.resolve(cliValue(argv, "--boundary"))).boundary;
  const packageRoot = fs.realpathSync(path.resolve(cliValue(argv, "--package-root")));
  const receipt = JSON.parse(readRegularNoFollow(path.resolve(cliValue(argv, "--receipt")), "activated-host receipt").toString("utf8"));
  const transcript = readRegularNoFollow(path.resolve(cliValue(argv, "--transcript")), "activated-host transcript").toString("utf8");
  const workerResult = readRegularNoFollow(path.resolve(cliValue(argv, "--worker-result")), "activated-host worker result").toString("utf8");
  const result = verifyActivatedHostConformanceReceipt({
    receipt,
    transcript,
    workerResult,
    packageRoot,
    expectedPackage: boundary.packages[hostId],
    expectedSourceCommit: boundary.source_commit,
    expectedRelease: boundary.release,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result.ok ? 0 : 2;
}

function runPublicProjectCli(argv: readonly string[]): number {
  assertCliPairs(argv, new Set(["--host", "--boundary", "--package-root", "--receipt", "--transcript", "--worker-result", "--out-dir"]), "public-project");
  const hostId = cliValue(argv, "--host") as MigrationRuntimeHost;
  if (!HOSTS.includes(hostId)) throw new Error("--host must be claude-code-cli or codex-cli");
  const boundary = loadAttestedMigrationBoundary(path.resolve(cliValue(argv, "--boundary"))).boundary;
  const packageRoot = fs.realpathSync(path.resolve(cliValue(argv, "--package-root")));
  const receipt = JSON.parse(readRegularNoFollow(path.resolve(cliValue(argv, "--receipt")), "activated-host receipt").toString("utf8"));
  const transcript = readRegularNoFollow(path.resolve(cliValue(argv, "--transcript")), "activated-host transcript").toString("utf8");
  const workerResult = readRegularNoFollow(path.resolve(cliValue(argv, "--worker-result")), "activated-host worker result").toString("utf8");
  const publication = publishActivatedHostPublicEvidence(path.resolve(cliValue(argv, "--out-dir")), {
    receipt,
    transcript,
    workerResult,
    packageRoot,
    expectedPackage: boundary.packages[hostId],
    expectedSourceCommit: boundary.source_commit,
    expectedRelease: boundary.release,
  });
  process.stdout.write(`${JSON.stringify(publication, null, 2)}\n`);
  return 0;
}

function runWorkerCli(argv: readonly string[]): number {
  const allowed = new Set([
    "--host", "--challenge", "--source-commit", "--package-hash", "--install-surface-hash", "--runtime-version",
    "--host-version", "--platform", "--release", "--captured-at", "--plugin-root",
    "--module-boundary-root",
    "--consumer-root", "--consumer-identities", "--out",
  ]);
  assertCliPairs(argv, allowed, "worker");
  const hostId = cliValue(argv, "--host") as MigrationRuntimeHost;
  const challenge = cliValue(argv, "--challenge");
  const capturedAt = cliValue(argv, "--captured-at");
  const consumerIdentities: unknown = JSON.parse(readRegularNoFollow(path.resolve(cliValue(argv, "--consumer-identities")), "consumer identities").toString("utf8"));
  if (!validConsumerTreeSet(consumerIdentities)) throw new Error("--consumer-identities must bind the official website and benchmark trees");
  const result = runActivatedConformanceWorker({
    hostId,
    challenge,
    sourceCommit: cliValue(argv, "--source-commit"),
    packageHash: cliValue(argv, "--package-hash"),
    installSurfaceHash: cliValue(argv, "--install-surface-hash"),
    runtimeVersion: cliValue(argv, "--runtime-version"),
    hostVersion: cliValue(argv, "--host-version"),
    platform: cliValue(argv, "--platform"),
    release: cliValue(argv, "--release"),
    capturedAt,
    pluginRoot: cliValue(argv, "--plugin-root"),
    moduleBoundaryRoot: cliValue(argv, "--module-boundary-root"),
    consumerRoots: parseConsumerRoots(cliValues(argv, "--consumer-root")),
    consumerIdentities,
  });
  if (!result.ok || result.evidence === null) {
    process.stderr.write(`activated-host-conformance worker: REFUSED [${result.code}] ${result.detail}\n`);
    return 2;
  }
  const payload = {
    schema_version: ACTIVATED_HOST_WORKER_SCHEMA,
    ok: true,
    code: result.code,
    detail: result.detail,
    marker: result.marker,
    challenge,
    host_id: hostId,
    evidence: result.evidence,
    package_snapshot: result.packageSnapshot,
    host_activation: result.hostActivation,
    consumer_trees: result.consumerTrees,
  };
  const bytes = `${JSON.stringify(payload, null, 2)}\n`;
  writeExclusive(path.resolve(cliValue(argv, "--out")), bytes, 0o600);
  process.stdout.write(`${result.marker}:RESULT_SHA256:${sha256Hex(bytes)}\n`);
  return 0;
}

function main(): void {
  const [subcommand, ...argv] = process.argv.slice(2);
  try {
    if (subcommand === "worker") {
      process.exitCode = runWorkerCli(argv);
      return;
    }
    if (subcommand === "capture") {
      process.exitCode = runCaptureCli(argv);
      return;
    }
    if (subcommand === "verify") {
      process.exitCode = runVerifyCli(argv);
      return;
    }
    if (subcommand === "public-project") {
      process.exitCode = runPublicProjectCli(argv);
      return;
    }
    process.stderr.write(
      "usage: activated-host-conformance.ts <capture|verify|public-project|worker> --host <claude-code-cli|codex-cli> ...\n",
    );
    process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`activated-host-conformance: ERROR — ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();
