/**
 * Plugin-owned deterministic run analysis (run-tracing-evaluation P1-P5).
 *
 * The analyzer consumes only frozen run artifacts. It never calls a model,
 * files a bug, or mutates a project capability. Every conclusion is typed and
 * evidence-bound; missing telemetry yields `unobservable`, never a guess.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import { parseYaml } from "../state";
import { collapseSpanTwins, toolActionSignature, validateGuildTraceEvent, type AnalysisEventClass } from "./guild-trace-events";
import { durableGuildDir } from "../state";

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const RESERVED_RECOMMENDATION_SOURCE_IDS = new Set(["activity", "queue"]);
const REQUIRED_COVERAGE = Object.freeze(["prompt", "agent", "tool", "phase", "loop", "gate", "close"] as const);
const COMPLETENESS_REQUIREMENTS = Object.freeze(["run identity", "plugin-config-snapshot.json", "trace parseability", "trace validity", ...REQUIRED_COVERAGE] as const);

export type EvidenceCategory = (typeof REQUIRED_COVERAGE)[number] | "knowledge" | "memory" | "steering" | "correction";
export type AssessmentStatus = "satisfied" | "violated" | "ambiguous" | "unobservable";
export type RecommendationScope = "plugin" | "project";
export type RecommendationStatus = "proposed" | "accepted" | "filed" | "queued" | "rejected" | "implemented" | "superseded";
export type RecommendationKind =
  | "bug_report" | "feature_request" | "telemetry_gap" | "workflow_engine_gap" | "tooling_gap" | "docs_sync_gap"
  | "create_skill" | "evolve_skill" | "create_agent" | "update_workflow" | "update_knowledge" | "change_settings" | "clarify_prompt_contract";
export interface RecommendationRouting {
  action: "ask_user_before_filing" | "queue_proposal_only";
  requires_user_approval: true;
  target: "guild-plugin" | "project-local";
}

export interface AnalysisFinding {
  id: string;
  kind: "instruction_violation" | "repeated_failure" | "runaway_repetition" | "tool_gap" | "workflow_churn" | "prompt_inefficiency" | "telemetry_gap";
  severity: "low" | "medium" | "high";
  summary: string;
  evidence_refs: string[];
  signature: string;
}

export interface Recommendation {
  schema_version: "guild.recommendation.v1";
  id: string;
  source_id: string;
  source_analysis_id: string;
  scope: RecommendationScope;
  kind: RecommendationKind;
  confidence: "low" | "medium" | "high";
  severity: "low" | "medium" | "high";
  evidence_refs: string[];
  evidence_signature: string;
  affected_runs: string[];
  proposed_action: string;
  suggested_owner: "guild-plugin" | "project";
  next_action: RecommendationRouting["action"];
  requires_user_approval: true;
  status: RecommendationStatus;
  routing: RecommendationRouting;
}

export interface RecommendationDecisionResult {
  source_id: string;
  recommendation_id: string;
  status: RecommendationStatus;
  effect: "plugin_draft_written" | "project_proposal_queued" | "recommendation_rejected" | "status_recorded";
  draft?: string;
}

export interface RunAnalysis {
  schema_version: "guild.run_analysis.v1";
  analysis_id: string;
  run_id: string;
  source_hash: string;
  eligible: boolean;
  identity: {
    run_scope: "initiative" | "independent" | "unknown";
    initiative_id: string | null;
    independent_group_id: string | null;
    config_snapshot_ref: string | null;
    host: string;
    phase: string | null;
  };
  completeness: {
    score: number;
    present: string[];
    missing: string[];
  };
  assessments: {
    instruction_following: { status: AssessmentStatus; evidence_refs: string[] };
    prompt_efficiency: { status: AssessmentStatus; evidence_refs: string[] };
    workflow: { status: AssessmentStatus; evidence_refs: string[] };
    tool_coverage: { status: AssessmentStatus; evidence_refs: string[] };
  };
  usage: {
    llm_event_count: number;
    specialists_dispatched: string[];
    tokens: { input: number; output: number; cached: number; total: number; cost_usd: number };
    duration_ms: number;
    /** Additive (C-ANALYSIS usage_availability). Absent on legacy artifacts: every metric is unknown. */
    availability?: Record<UsageMetric, UsageMetricAvailability>;
  };
  findings: AnalysisFinding[];
  recommendations: Recommendation[];
  /** Additive C-DETECTORS/v1 diagnostics. Absent on legacy artifacts; never relabels a v1 field. */
  diagnostics?: RunDiagnostics;
}

export const DETECTOR_IDS = Object.freeze([
  "clarification", "instruction_following", "knowledge_memory", "outcome_quality", "prompt_action_latency",
  "recommendation_scope", "redundant_prompt", "repeated_mistake", "steering", "tool_coverage", "usage_outlier", "workflow_churn",
] as const);
export type DetectorId = (typeof DETECTOR_IDS)[number];
export type DetectorState = "observed" | "ambiguous" | "unobservable";
export interface DetectorResult {
  detector: DetectorId;
  state: DetectorState;
  value: Record<string, unknown>;
  evidence_refs: string[];
  reason: string | null;
}
export interface InstructionCheck {
  instruction_id: string;
  requirement_hash: string;
  status: AssessmentStatus;
  evidence_refs: string[];
  proof_refs: string[];
}
export interface InputManifestEntry {
  ref: string;
  sha256: string | null;
  status: "consumed" | "missing" | "rejected" | "unrecognized";
}
export interface AnalysisCohort {
  run_class: string | null;
  model: string | null;
  provider: string | null;
  config_hash: string | null;
}
export interface RunDiagnostics {
  contract: "C-DETECTORS/v1";
  input_manifest: InputManifestEntry[];
  input_hash: string;
  cohort: AnalysisCohort;
  results: DetectorResult[];
  instruction_checks: InstructionCheck[];
}
export const USAGE_METRICS = Object.freeze(["input", "output", "cached", "cost_usd", "duration_ms"] as const);
export type UsageMetric = (typeof USAGE_METRICS)[number];
export interface UsageMetricAvailability {
  state: "unobserved" | "partial" | "complete";
  evidence_refs: string[];
  missing_reason: null | "host_unavailable" | "unwired" | "legacy_unknown" | "incomplete_observation";
}
export interface ComparisonDimension extends DetectorResult {
  by_run: Record<string, { state: DetectorState | "legacy_unknown"; eligible: boolean; value: Record<string, unknown> }>;
  comparable_runs: string[];
}
export interface ComparisonDiagnostics {
  contract: "C-DETECTORS/v1";
  runs: Array<{ run_id: string; source_hash: string; input_hash: string | null; eligible: boolean }>;
  dimensions: ComparisonDimension[];
  recommendation_clusters: Array<{ scope: RecommendationScope; kind: RecommendationKind; target: string; runs: string[] }>;
}

export interface RunComparison {
  schema_version: "guild.run_comparison.v1";
  comparison_id: string;
  run_ids: string[];
  source_hashes: string[];
  completeness: { eligible_runs: number; total_runs: number; average_score: number };
  repeated_signatures: Array<{ signature: string; runs: string[]; occurrences: number }>;
  recommendations: Recommendation[];
  /** Additive per-dimension evidence/availability; comparison_id and core fields are unchanged. */
  diagnostics?: ComparisonDiagnostics;
}

export type ComparisonTarget =
  | { kind: "runs"; ids: string[] }
  | { kind: "initiative"; id: string }
  | { kind: "independent"; id: string };

interface LoadedEvent {
  value: Record<string, unknown>;
  line: number;
  ref: string;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function scalar(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value !== "null" && value.length > 0 ? value : null;
}

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function stableId(prefix: string, material: string): string {
  return `${prefix}-${sha256(material).slice(0, 16)}`;
}

function assertSafeId(value: string, label: string): void {
  if (!SAFE_ID.test(value) || value === "." || value === "..") {
    throw new Error(`${label} must be one safe path component`);
  }
}

function assertRecommendationSourceId(value: string, label: string): void {
  assertSafeId(value, label);
  if (RESERVED_RECOMMENDATION_SOURCE_IDS.has(value.toLowerCase())) {
    throw new Error(`${label} is reserved by the recommendation store`);
  }
}

function runDir(root: string, runId: string): string {
  assertSafeId(runId, "run id");
  const resolvedRoot = path.resolve(root);
  const runs = path.join(durableGuildDir(resolvedRoot), "runs");
  const candidate = path.join(runs, runId);
  try {
    if (fs.lstatSync(runs).isSymbolicLink() || fs.lstatSync(candidate).isSymbolicLink()) {
      throw new Error(`run input path contains a symlink: ${candidate}`);
    }
    const realRoot = fs.realpathSync(resolvedRoot);
    const realCandidate = fs.realpathSync(candidate);
    if (!fs.statSync(realCandidate).isDirectory() || !realCandidate.startsWith(`${realRoot}${path.sep}`)) {
      throw new Error(`run input escapes project root: ${candidate}`);
    }
    return realCandidate;
  } catch (error) {
    if (error instanceof Error && /symlink|escapes/.test(error.message)) throw error;
    throw new Error(`run input is not a contained directory: ${candidate}`);
  }
}

function resolveContainedFile(base: string, relativeRef: string): string | null {
  if (path.isAbsolute(relativeRef)) return null;
  const resolvedBase = path.resolve(base);
  const resolved = path.resolve(resolvedBase, relativeRef);
  if (resolved !== resolvedBase && !resolved.startsWith(`${resolvedBase}${path.sep}`)) return null;
  try {
    const realBase = fs.realpathSync(resolvedBase);
    const real = fs.realpathSync(resolved);
    if (real !== realBase && !real.startsWith(`${realBase}${path.sep}`)) return null;
    return fs.statSync(real).isFile() ? real : null;
  } catch {
    return null;
  }
}

/**
 * Resolve a run-owned evidence input without following any symlink component.
 * Missing optional inputs return null; present-but-unsafe inputs fail closed so
 * an escaped trace/provenance/config file cannot be reported under a contained
 * `.guild/runs/**` evidence reference.
 */
function resolveRunInputFile(base: string, relativeRef: string): string | null {
  if (path.isAbsolute(relativeRef)) throw new Error(`run input ref must be relative: ${relativeRef}`);
  const resolvedBase = path.resolve(base);
  const resolved = path.resolve(resolvedBase, relativeRef);
  if (resolved !== resolvedBase && !resolved.startsWith(`${resolvedBase}${path.sep}`)) {
    throw new Error(`run input escapes its run directory: ${relativeRef}`);
  }
  const relative = path.relative(resolvedBase, resolved);
  let cursor = resolvedBase;
  try {
    for (const component of relative.split(path.sep).filter(Boolean)) {
      cursor = path.join(cursor, component);
      if (fs.lstatSync(cursor).isSymbolicLink()) {
        throw new Error(`run input path contains a symlink: ${cursor}`);
      }
    }
    const realBase = fs.realpathSync(resolvedBase);
    const real = fs.realpathSync(resolved);
    if (real !== realBase && !real.startsWith(`${realBase}${path.sep}`)) {
      throw new Error(`run input escapes its run directory: ${relativeRef}`);
    }
    if (!fs.statSync(real).isFile()) throw new Error(`run input is not a regular file: ${resolved}`);
    return real;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function readText(file: string): string | null {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

function assertOutputContained(root: string, file: string): void {
  const resolvedRoot = path.resolve(root);
  const resolvedFile = path.resolve(file);
  if (resolvedFile !== resolvedRoot && !resolvedFile.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`analysis output escapes project root: ${resolvedFile}`);
  }
  const relative = path.relative(resolvedRoot, resolvedFile);
  let cursor = resolvedRoot;
  for (const component of relative.split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, component);
    try {
      if (fs.lstatSync(cursor).isSymbolicLink()) {
        throw new Error(`analysis output path is not a contained regular file path because it contains a symlink: ${cursor}`);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") break;
      throw error;
    }
  }
}

function atomicWrite(root: string, file: string, contents: string): void {
  assertOutputContained(root, file);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  assertOutputContained(root, path.dirname(file));
  const temp = `${file}.tmp-${process.pid}-${crypto.randomUUID()}`;
  try {
    fs.writeFileSync(temp, contents, { encoding: "utf8", mode: 0o600, flag: "wx" });
    fs.renameSync(temp, file);
  } finally {
    try { fs.unlinkSync(temp); } catch { /* rename already removed the temp file */ }
  }
}

interface LockOwner {
  schema_version: "guild.recommendation_lock.v1" | "guild.recommendation_lock_recovery.v1";
  pid: number;
  created_at: string;
}

function readLockOwner(root: string, file: string, schema: LockOwner["schema_version"]): LockOwner {
  const raw = readExistingContainedText(root, file);
  let owner: Record<string, unknown>;
  try { owner = asRecord(JSON.parse(raw ?? "")); } catch { throw new Error("recommendation store lock is malformed"); }
  if (!hasOnlyKeys(owner, new Set(["schema_version", "pid", "created_at"])) || owner["schema_version"] !== schema ||
      !Number.isInteger(owner["pid"]) || Number(owner["pid"]) <= 0 ||
      typeof owner["created_at"] !== "string" || !Number.isFinite(Date.parse(owner["created_at"] as string))) {
    throw new Error("recommendation store lock is malformed");
  }
  return owner as unknown as LockOwner;
}

function processIsAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
    if ((error as NodeJS.ErrnoException).code === "EPERM") return true;
    throw error;
  }
}

function sameInode(left: fs.Stats, right: fs.Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function unlinkOwnedLock(file: string, descriptor: number): void {
  try {
    const held = fs.fstatSync(descriptor);
    const current = fs.lstatSync(file);
    if (sameInode(held, current)) fs.unlinkSync(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

export function withRecommendationLock<T>(root: string, action: () => T): T {
  const dir = path.join(durableGuildDir(root), "recommendations");
  const lock = path.join(dir, ".write.lock");
  const recovery = path.join(dir, ".write.lock.recovery");
  assertOutputContained(root, lock);
  assertOutputContained(root, recovery);
  fs.mkdirSync(dir, { recursive: true });
  assertOutputContained(root, dir);
  let descriptor: number;
  const open = (duringRecovery = false): number => {
    if (!duringRecovery && fs.existsSync(recovery)) throw new Error("recommendation store lock recovery is active");
    const opened = fs.openSync(lock, "wx", 0o600);
    if (!duringRecovery && fs.existsSync(recovery)) {
      unlinkOwnedLock(lock, opened);
      fs.closeSync(opened);
      throw new Error("recommendation store lock recovery is active");
    }
    return opened;
  };
  try {
    descriptor = open();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const original = fs.lstatSync(lock);
    const owner = readLockOwner(root, lock, "guild.recommendation_lock.v1");
    if (processIsAlive(owner.pid)) throw new Error("recommendation store is locked by another writer");

    let recoveryDescriptor: number;
    try {
      recoveryDescriptor = fs.openSync(recovery, "wx", 0o600);
    } catch (recoveryError) {
      if ((recoveryError as NodeJS.ErrnoException).code !== "EEXIST") throw recoveryError;
      // A recovery claim is deliberately fail-closed even if its recorded PID
      // appears dead. Unlinking a claim after inspection has the same pathname
      // replacement race as the stale lock itself. An orphaned claim is a
      // bounded manual-recovery condition; it must never admit two writers.
      readLockOwner(root, recovery, "guild.recommendation_lock_recovery.v1");
      throw new Error("recommendation store lock recovery is active");
    }
    fs.writeFileSync(recoveryDescriptor, JSON.stringify({
      schema_version: "guild.recommendation_lock_recovery.v1",
      pid: process.pid,
      created_at: new Date().toISOString(),
    }) + "\n");
    try {
      const current = fs.lstatSync(lock);
      const currentOwner = readLockOwner(root, lock, "guild.recommendation_lock.v1");
      if (!sameInode(original, current) || processIsAlive(currentOwner.pid)) {
        throw new Error("recommendation store lock changed during stale recovery");
      }
      fs.unlinkSync(lock);
      descriptor = open(true);
    } finally {
      try { unlinkOwnedLock(recovery, recoveryDescriptor); }
      finally { fs.closeSync(recoveryDescriptor); }
    }
  }
  fs.writeFileSync(descriptor, JSON.stringify({
    schema_version: "guild.recommendation_lock.v1",
    pid: process.pid,
    created_at: new Date().toISOString(),
  }) + "\n");
  try {
    recoverPendingTransaction(root);
    return action();
  } finally {
    try { unlinkOwnedLock(lock, descriptor); }
    finally { fs.closeSync(descriptor); }
  }
}

const RECOMMENDATION_SCOPES = new Set<RecommendationScope>(["plugin", "project"]);
const RECOMMENDATION_STATUSES = new Set<RecommendationStatus>(["proposed", "accepted", "filed", "queued", "rejected", "implemented", "superseded"]);
const RECOMMENDATION_KINDS = new Set<RecommendationKind>([
  "bug_report", "feature_request", "telemetry_gap", "workflow_engine_gap", "tooling_gap", "docs_sync_gap",
  "create_skill", "evolve_skill", "create_agent", "update_workflow", "update_knowledge", "change_settings", "clarify_prompt_contract",
]);
const CONFIDENCE_VALUES = new Set(["low", "medium", "high"]);
const SEVERITY_VALUES = new Set(["low", "medium", "high"]);
const FINDING_KINDS = new Set<string>(["instruction_violation", "repeated_failure", "runaway_repetition", "tool_gap", "workflow_churn", "prompt_inefficiency", "telemetry_gap"]);
const PLUGIN_RECOMMENDATION_KINDS = new Set<RecommendationKind>([
  "bug_report", "feature_request", "telemetry_gap", "workflow_engine_gap", "tooling_gap", "docs_sync_gap",
]);
const PROJECT_RECOMMENDATION_KINDS = new Set<RecommendationKind>([
  "create_skill", "evolve_skill", "create_agent", "update_workflow", "update_knowledge", "change_settings", "clarify_prompt_contract",
]);
const RECOMMENDATION_KEYS = new Set([
  "schema_version", "id", "source_id", "source_analysis_id", "scope", "kind", "confidence", "severity",
  "evidence_refs", "evidence_signature", "affected_runs", "proposed_action", "suggested_owner", "next_action",
  "requires_user_approval", "status", "routing",
]);
const ROUTING_KEYS = new Set(["action", "requires_user_approval", "target"]);

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string" && item.length > 0);
}

function validEvidenceRef(value: string): boolean {
  if (!value.startsWith(".guild/") || value.includes("\\") || /[\0\r\n]/.test(value)) return false;
  const filePart = value.split("#", 1)[0];
  const normalized = path.posix.normalize(filePart);
  return normalized === filePart && !normalized.split("/").includes("..");
}

function evidenceRunId(value: string): string | null {
  const match = /^\.guild\/runs\/([^/]+)\//.exec(value.split("#", 1)[0]);
  return match?.[1] ?? null;
}

function assertEvidenceFiles(root: string, item: Recommendation, label: string): void {
  for (const ref of item.evidence_refs) {
    const file = ref.split("#", 1)[0];
    if (resolveContainedFile(root, file) === null) {
      throw new Error(`${label}.evidence_refs must resolve to contained regular files: ${ref}`);
    }
  }
}

function evidenceSignature(scope: RecommendationScope, kind: RecommendationKind, refs: readonly string[]): string {
  return sha256([scope, kind, ...[...refs].sort()].join("\n"));
}

function assertRecommendation(value: unknown, label: string): asserts value is Recommendation {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  const item = value as Record<string, unknown>;
  const scope = item["scope"];
  const routing = item["routing"];
  if (!hasOnlyKeys(item, RECOMMENDATION_KEYS)) throw new Error(`${label} contains unknown fields`);
  if (item["schema_version"] !== "guild.recommendation.v1") throw new Error(`${label}.schema_version is invalid`);
  if (typeof item["id"] !== "string" || !SAFE_ID.test(item["id"]) || item["id"] === "." || item["id"] === "..") {
    throw new Error(`${label}.id must be one safe path component`);
  }
  if (typeof item["source_id"] !== "string" || !SAFE_ID.test(item["source_id"]) || item["source_id"] === "." || item["source_id"] === ".." ||
      RESERVED_RECOMMENDATION_SOURCE_IDS.has(item["source_id"].toLowerCase())) {
    throw new Error(`${label}.source_id must be one safe path component`);
  }
  if (typeof item["source_analysis_id"] !== "string" || item["source_analysis_id"].length > 256 ||
      !/^[A-Za-z0-9][A-Za-z0-9:._-]*$/.test(item["source_analysis_id"])) {
    throw new Error(`${label}.source_analysis_id must be a safe analysis identifier`);
  }
  if (typeof scope !== "string" || !RECOMMENDATION_SCOPES.has(scope as RecommendationScope)) throw new Error(`${label}.scope is invalid`);
  if (typeof item["kind"] !== "string" || !RECOMMENDATION_KINDS.has(item["kind"] as RecommendationKind)) throw new Error(`${label}.kind is invalid`);
  const kind = item["kind"] as RecommendationKind;
  if ((scope === "plugin" && !PLUGIN_RECOMMENDATION_KINDS.has(kind)) ||
      (scope === "project" && !PROJECT_RECOMMENDATION_KINDS.has(kind))) {
    throw new Error(`${label}.kind is not authorized for ${scope} scope`);
  }
  if (typeof item["confidence"] !== "string" || !CONFIDENCE_VALUES.has(item["confidence"])) throw new Error(`${label}.confidence is invalid`);
  if (typeof item["severity"] !== "string" || !SEVERITY_VALUES.has(item["severity"])) throw new Error(`${label}.severity is invalid`);
  if (!stringArray(item["evidence_refs"]) || item["evidence_refs"].length === 0 || !item["evidence_refs"].every(validEvidenceRef)) {
    throw new Error(`${label}.evidence_refs must contain safe .guild refs`);
  }
  if (!stringArray(item["affected_runs"]) || item["affected_runs"].length === 0 || !item["affected_runs"].every((id) => SAFE_ID.test(id) && id !== "." && id !== "..")) {
    throw new Error(`${label}.affected_runs must contain safe run ids`);
  }
  if (!(item["affected_runs"] as string[]).every((runId) =>
    (item["evidence_refs"] as string[]).some((ref) => evidenceRunId(ref) === runId)) ||
      !(item["evidence_refs"] as string[]).every((ref) => (item["affected_runs"] as string[]).includes(evidenceRunId(ref) ?? ""))) {
    throw new Error(`${label}.affected_runs must be bound to run evidence refs`);
  }
  const expectedSignature = evidenceSignature(scope as RecommendationScope, kind, item["evidence_refs"] as string[]);
  if (item["evidence_signature"] !== expectedSignature) throw new Error(`${label}.evidence_signature does not match its evidence`);
  if (typeof item["proposed_action"] !== "string" || item["proposed_action"].trim().length === 0 || /[\0]/.test(item["proposed_action"])) {
    throw new Error(`${label}.proposed_action must be non-empty`);
  }
  const expected = routingForScope(scope as RecommendationScope);
  if (item["suggested_owner"] !== (scope === "plugin" ? "guild-plugin" : "project") ||
      item["next_action"] !== expected.action || item["requires_user_approval"] !== true ||
      routing === null || typeof routing !== "object" || Array.isArray(routing) ||
      !hasOnlyKeys(routing as Record<string, unknown>, ROUTING_KEYS) ||
      (routing as Record<string, unknown>)["action"] !== expected.action ||
      (routing as Record<string, unknown>)["requires_user_approval"] !== true ||
      (routing as Record<string, unknown>)["target"] !== expected.target) {
    throw new Error(`${label} routing does not match scope`);
  }
  if (typeof item["status"] !== "string" || !RECOMMENDATION_STATUSES.has(item["status"] as RecommendationStatus)) throw new Error(`${label}.status is invalid`);
}

function readExistingContainedText(root: string, file: string): string | null {
  if (!fs.existsSync(file)) return null;
  const relative = path.relative(path.resolve(root), path.resolve(file));
  const contained = resolveContainedFile(root, relative);
  if (contained === null) throw new Error(`recommendation input is not a contained regular file: ${file}`);
  return fs.readFileSync(contained, "utf8");
}

function readRecommendationRecords(
  root: string,
  file: string,
  required: boolean,
  expectedSourceId?: string,
  expectedSourceAnalysisId?: string,
): Recommendation[] {
  const raw = readExistingContainedText(root, file);
  if (raw === null) {
    if (required) throw new Error(`recommendation source does not exist: ${file}`);
    return [];
  }
  const records: Recommendation[] = [];
  const ids = new Set<string>();
  const signatures = new Set<string>();
  for (const [index, line] of raw.split(/\r?\n/).entries()) {
    if (line.trim().length === 0) continue;
    let value: unknown;
    try { value = JSON.parse(line); } catch { throw new Error(`recommendation record line ${index + 1} is not valid JSON`); }
    assertRecommendation(value, `recommendation record line ${index + 1}`);
    assertEvidenceFiles(root, value, `recommendation record line ${index + 1}`);
    if (expectedSourceId !== undefined && value.source_id !== expectedSourceId) {
      throw new Error(`recommendation record line ${index + 1}.source_id does not match ${expectedSourceId}`);
    }
    if (expectedSourceAnalysisId !== undefined && value.source_analysis_id !== expectedSourceAnalysisId) {
      throw new Error(`recommendation record line ${index + 1}.source_analysis_id does not match its canonical artifact`);
    }
    if (ids.has(value.id)) throw new Error(`duplicate recommendation id: ${value.id}`);
    if (signatures.has(value.evidence_signature)) throw new Error(`duplicate evidence signature: ${value.evidence_signature}`);
    ids.add(value.id);
    signatures.add(value.evidence_signature);
    records.push(value);
  }
  return records;
}

function writeRecommendationRecords(root: string, file: string, records: readonly Recommendation[]): void {
  const sorted = [...records].sort((a, b) => a.id.localeCompare(b.id));
  const ids = new Set<string>();
  const signatures = new Set<string>();
  sorted.forEach((record, index) => {
    assertRecommendation(record, `recommendation ${index + 1}`);
    assertEvidenceFiles(root, record, `recommendation ${index + 1}`);
    if (ids.has(record.id)) throw new Error(`duplicate recommendation id: ${record.id}`);
    if (signatures.has(record.evidence_signature)) throw new Error(`duplicate evidence signature: ${record.evidence_signature}`);
    ids.add(record.id);
    signatures.add(record.evidence_signature);
  });
  atomicWrite(root, file, sorted.map((item) => JSON.stringify(item)).join("\n") + (sorted.length > 0 ? "\n" : ""));
}

function assertGeneratedRecommendations(
  root: string,
  incoming: readonly Recommendation[],
  context: { sourceId: string; sourceAnalysisId: string; runIds: readonly string[] },
): void {
  const ids = new Set<string>();
  const signatures = new Set<string>();
  for (const [index, item] of incoming.entries()) {
    const label = `generated recommendation ${index + 1}`;
    assertRecommendation(item, label);
    assertEvidenceFiles(root, item, label);
    if (item.status !== "proposed") throw new Error(`${label}.status must be proposed before an authorized transition`);
    if (item.source_id !== context.sourceId) throw new Error(`${label}.source_id is not bound to its enclosing artifact`);
    if (item.source_analysis_id !== context.sourceAnalysisId) throw new Error(`${label}.source_analysis_id is not bound to its enclosing artifact`);
    if (!item.affected_runs.every((runId) => context.runIds.includes(runId))) throw new Error(`${label}.affected_runs are not bound to its enclosing artifact`);
    if (ids.has(item.id)) throw new Error(`duplicate recommendation id: ${item.id}`);
    if (signatures.has(item.evidence_signature)) throw new Error(`duplicate evidence signature: ${item.evidence_signature}`);
    ids.add(item.id);
    signatures.add(item.evidence_signature);
  }
}

function recommendationQueueKey(item: Recommendation): string {
  return item.evidence_signature;
}

function preserveRecordedStatuses(
  root: string,
  file: string,
  incoming: readonly Recommendation[],
  targetSourceAnalysisId: string,
): {
  records: Recommendation[];
  migrations: Array<{ item: Recommendation; fromId: string; fromSourceId: string; fromSourceAnalysisId: string }>;
} {
  const sourceId = path.basename(file, ".jsonl");
  const existing = readRecommendationRecords(root, file, false, sourceId);
  const queue = readRecommendationRecords(root, path.join(durableGuildDir(root), "recommendations", "queue.jsonl"), false);
  const activity = readRecommendationActivity(root);
  const migrations: Array<{ item: Recommendation; fromId: string; fromSourceId: string; fromSourceAnalysisId: string }> = [];
  const persisted = [
    ...existing,
    ...queue.filter((record) => record.source_id === sourceId),
  ];
  const records = incoming.map((item) => {
    const latestActivity = [...activity].reverse().find((event) =>
      event.scope === item.scope && event.evidence_signature === item.evidence_signature);
    const priorSource = latestActivity && latestActivity.source_id !== sourceId
      ? readRecommendationRecords(
        root,
        recommendationSourceFile(root, latestActivity.source_id),
        false,
        latestActivity.source_id,
        latestActivity.source_analysis_id,
      )
      : [];
    const candidates = [...existing, ...queue, ...priorSource].filter((record) =>
      record.scope === item.scope && (record.id === item.id || recommendationQueueKey(record) === recommendationQueueKey(item)));
    const progressedCandidates = candidates.filter((record) => record.status !== "proposed");
    if (progressedCandidates.length > 0 && !latestActivity) {
      throw new Error(`progressed recommendation ${item.id} has no authorized activity trail`);
    }
    const corroboratingCandidates = latestActivity ? candidates.filter((record) =>
      record.id === latestActivity.recommendation_id &&
      record.source_id === latestActivity.source_id &&
      record.source_analysis_id === latestActivity.source_analysis_id) : [];
    if (latestActivity && !corroboratingCandidates.some((record) => record.status === latestActivity.to_status)) {
      throw new Error(`recommendation ${item.id} activity is not corroborated by persisted source or queue state`);
    }
    if (latestActivity && corroboratingCandidates.some((record) => record.status !== "proposed" && record.status !== latestActivity.to_status)) {
      throw new Error(`recommendation ${item.id} status contradicts its authorized activity trail`);
    }
    const prior = latestActivity
      ? { id: latestActivity.recommendation_id, source_id: latestActivity.source_id, source_analysis_id: latestActivity.source_analysis_id, status: latestActivity.to_status }
      : candidates.find((record) => record.id === item.id) ?? candidates[0];
    if (item.status !== "proposed" || !prior || prior.status === "proposed") return item;
    const preserved = { ...item, status: prior.status };
    if (prior.id !== item.id || prior.source_id !== item.source_id || prior.source_analysis_id !== item.source_analysis_id) {
      migrations.push({ item: preserved, fromId: prior.id, fromSourceId: prior.source_id, fromSourceAnalysisId: prior.source_analysis_id });
    }
    return preserved;
  });

  // A progressed decision is durable user state, not a detector cache entry.
  // If regeneration no longer emits it (or emits a different signature), carry
  // the prior record forward under the new canonical analysis identity and
  // append an auditable identity migration. Proposed-only records may vanish.
  const matched = new Set(records.flatMap((record) => [record.id, recommendationQueueKey(record)]));
  const historical = new Map<string, Recommendation>();
  for (const prior of persisted) {
    if (prior.status === "proposed" || matched.has(prior.id) || matched.has(recommendationQueueKey(prior))) continue;
    const key = `${prior.scope}:${recommendationQueueKey(prior)}`;
    const duplicate = historical.get(key);
    if (duplicate && duplicate.status !== prior.status) {
      throw new Error(`progressed recommendation ${prior.id} has contradictory persisted statuses`);
    }
    historical.set(key, prior);
  }
  for (const prior of historical.values()) {
    const latestActivity = [...activity].reverse().find((event) =>
      event.scope === prior.scope && event.evidence_signature === prior.evidence_signature);
    if (!latestActivity || latestActivity.to_status !== prior.status ||
        latestActivity.recommendation_id !== prior.id ||
        latestActivity.source_id !== prior.source_id ||
        latestActivity.source_analysis_id !== prior.source_analysis_id) {
      throw new Error(`progressed recommendation ${prior.id} is not corroborated by its authorized activity trail`);
    }
    const carried: Recommendation = {
      ...prior,
      source_id: sourceId,
      source_analysis_id: targetSourceAnalysisId,
    };
    records.push(carried);
    matched.add(carried.id);
    matched.add(recommendationQueueKey(carried));
    if (prior.source_analysis_id !== targetSourceAnalysisId) {
      migrations.push({
        item: carried,
        fromId: prior.id,
        fromSourceId: prior.source_id,
        fromSourceAnalysisId: prior.source_analysis_id,
      });
    }
  }
  return { records, migrations };
}

function upsertProjectQueue(root: string, incoming: readonly Recommendation[], explicitStatus = false): string {
  const queue = path.join(durableGuildDir(root), "recommendations", "queue.jsonl");
  const records = readRecommendationRecords(root, queue, false);
  if (records.some((item) => item.scope !== "project")) throw new Error("project recommendation queue contains a non-project record");
  for (const item of incoming.filter((candidate) => candidate.scope === "project")) {
    assertRecommendation(item, `queued recommendation ${item.id}`);
    const signature = recommendationQueueKey(item);
    const index = records.findIndex((record) => record.id === item.id || recommendationQueueKey(record) === signature);
    if (index === -1) {
      records.push(item);
    } else {
      const existing = records[index];
      records[index] = !explicitStatus && item.status === "proposed" && existing.status !== "proposed"
        ? { ...item, status: existing.status }
        : item;
    }
  }
  writeRecommendationRecords(root, queue, records);
  return queue;
}

function recommendationSourceFile(root: string, sourceId: string): string {
  assertRecommendationSourceId(sourceId, "recommendation source id");
  return path.join(durableGuildDir(root), "recommendations", `${sourceId}.jsonl`);
}

function canonicalSourceAnalysisId(root: string, sourceId: string): string {
  const runArtifact = path.join(durableGuildDir(root), "analysis", "runs", sourceId, "analysis.json");
  const comparisonArtifact = path.join(durableGuildDir(root), "analysis", "comparisons", sourceId, "comparison.json");
  for (const [file, schema, idKey, analysisKey] of [
    [runArtifact, "guild.run_analysis.v1", "run_id", "analysis_id"],
    [comparisonArtifact, "guild.run_comparison.v1", "comparison_id", "comparison_id"],
  ] as const) {
    const raw = readExistingContainedText(root, file);
    if (raw === null) continue;
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { throw new Error(`canonical recommendation source is malformed: ${file}`); }
    const item = asRecord(parsed);
    if (item["schema_version"] !== schema || item[idKey] !== sourceId || typeof item[analysisKey] !== "string") {
      throw new Error(`canonical recommendation source identity is invalid: ${file}`);
    }
    return item[analysisKey] as string;
  }
  throw new Error(`canonical recommendation source artifact does not exist for ${sourceId}`);
}

type RecommendationActivityEffect = RecommendationDecisionResult["effect"] | "status_migrated";

interface RecommendationActivity {
  schema_version: "guild.recommendation_activity.v1";
  activity_id: string;
  at: string;
  source_id: string;
  source_analysis_id: string;
  recommendation_id: string;
  previous_recommendation_id?: string;
  previous_source_id?: string;
  previous_source_analysis_id?: string;
  evidence_signature: string;
  scope: RecommendationScope;
  from_status: RecommendationStatus;
  to_status: RecommendationStatus;
  effect: RecommendationActivityEffect;
}

const RECOMMENDATION_ACTIVITY_KEYS = new Set([
  "schema_version", "activity_id", "at", "source_id", "source_analysis_id", "recommendation_id", "previous_recommendation_id",
  "previous_source_id", "previous_source_analysis_id", "evidence_signature", "scope",
  "from_status", "to_status", "effect",
]);
const RECOMMENDATION_ACTIVITY_EFFECTS = new Set<RecommendationActivityEffect>([
  "plugin_draft_written", "project_proposal_queued", "recommendation_rejected", "status_recorded", "status_migrated",
]);

function authorizedProgressTransition(scope: RecommendationScope, from: RecommendationStatus, to: RecommendationStatus): boolean {
  if (from === to) return true;
  return scope === "project"
    ? from === "queued" && (to === "implemented" || to === "superseded")
    : (from === "accepted" && (to === "filed" || to === "implemented" || to === "superseded")) ||
      (from === "filed" && (to === "implemented" || to === "superseded"));
}

function activitySemantics(item: Record<string, unknown>): boolean {
  const scope = item["scope"] as RecommendationScope;
  const from = item["from_status"] as RecommendationStatus;
  const to = item["to_status"] as RecommendationStatus;
  const effect = item["effect"] as RecommendationActivityEffect;
  if (effect === "plugin_draft_written") return scope === "plugin" && from === "proposed" && to === "accepted";
  if (effect === "project_proposal_queued") return scope === "project" && from === "proposed" && to === "queued";
  if (effect === "recommendation_rejected") return from === "proposed" && to === "rejected";
  if (effect === "status_recorded") return from !== to && authorizedProgressTransition(scope, from, to);
  return effect === "status_migrated" && from === to &&
    typeof item["previous_recommendation_id"] === "string" && typeof item["previous_source_id"] === "string" &&
    typeof item["previous_source_analysis_id"] === "string" &&
    (item["previous_recommendation_id"] !== item["recommendation_id"] || item["previous_source_id"] !== item["source_id"] ||
      item["previous_source_analysis_id"] !== item["source_analysis_id"]);
}

function readRecommendationActivity(root: string, allowPendingMigration = false): RecommendationActivity[] {
  const activity = path.join(durableGuildDir(root), "recommendations", "activity.jsonl");
  const raw = readExistingContainedText(root, activity);
  if (raw === null) return [];
  const records: RecommendationActivity[] = [];
  const ids = new Set<string>();
  const statusByEvidence = new Map<string, RecommendationStatus>();
  for (const [index, line] of raw.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    let parsed: unknown;
    try { parsed = JSON.parse(line); } catch { throw new Error(`recommendation activity line ${index + 1} is not valid JSON`); }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(`recommendation activity line ${index + 1} must be an object`);
    const item = parsed as Record<string, unknown>;
    if (!hasOnlyKeys(item, RECOMMENDATION_ACTIVITY_KEYS) || item["schema_version"] !== "guild.recommendation_activity.v1" ||
        typeof item["activity_id"] !== "string" || !SAFE_ID.test(item["activity_id"]) || ids.has(item["activity_id"]) ||
        typeof item["at"] !== "string" || !Number.isFinite(Date.parse(item["at"])) ||
        typeof item["source_id"] !== "string" || !SAFE_ID.test(item["source_id"]) ||
        typeof item["source_analysis_id"] !== "string" || !/^[A-Za-z0-9][A-Za-z0-9:._-]*$/.test(item["source_analysis_id"]) ||
        typeof item["recommendation_id"] !== "string" || !SAFE_ID.test(item["recommendation_id"]) ||
        (item["previous_recommendation_id"] !== undefined &&
          (typeof item["previous_recommendation_id"] !== "string" || !SAFE_ID.test(item["previous_recommendation_id"]))) ||
        (item["previous_source_id"] !== undefined && (typeof item["previous_source_id"] !== "string" || !SAFE_ID.test(item["previous_source_id"]))) ||
        (item["previous_source_analysis_id"] !== undefined &&
          (typeof item["previous_source_analysis_id"] !== "string" || !/^[A-Za-z0-9][A-Za-z0-9:._-]*$/.test(item["previous_source_analysis_id"]))) ||
        typeof item["evidence_signature"] !== "string" || !/^[a-f0-9]{64}$/.test(item["evidence_signature"]) ||
        typeof item["scope"] !== "string" || !RECOMMENDATION_SCOPES.has(item["scope"] as RecommendationScope) ||
        typeof item["from_status"] !== "string" || !RECOMMENDATION_STATUSES.has(item["from_status"] as RecommendationStatus) ||
        typeof item["to_status"] !== "string" || !RECOMMENDATION_STATUSES.has(item["to_status"] as RecommendationStatus) ||
        typeof item["effect"] !== "string" || !RECOMMENDATION_ACTIVITY_EFFECTS.has(item["effect"] as RecommendationActivityEffect) ||
        !activitySemantics(item)) {
      throw new Error(`recommendation activity line ${index + 1} violates guild.recommendation_activity.v1`);
    }
    const chainKey = `${item["scope"]}:${item["evidence_signature"]}`;
    const expectedFrom = statusByEvidence.get(chainKey) ?? "proposed";
    if (item["from_status"] !== expectedFrom) {
      throw new Error(`recommendation activity line ${index + 1} breaks the authorized transition chain`);
    }
    statusByEvidence.set(chainKey, item["to_status"] as RecommendationStatus);
    ids.add(item["activity_id"] as string);
    records.push(item as unknown as RecommendationActivity);
  }
  if (!allowPendingMigration) {
    for (const [chainKey, status] of statusByEvidence) {
      void status;
      const latest = [...records].reverse().find((event) => `${event.scope}:${event.evidence_signature}` === chainKey)!;
      if (latest.source_analysis_id !== canonicalSourceAnalysisId(root, latest.source_id)) {
        throw new Error(`recommendation activity chain ${chainKey} is not bound to its current canonical source analysis`);
      }
    }
  }
  return records;
}

function recordRecommendationActivity(
  root: string,
  sourceId: string,
  item: Recommendation,
  fromStatus: RecommendationStatus,
  effect: RecommendationActivityEffect,
  previousRecommendationId?: string,
  previousSourceId?: string,
  previousSourceAnalysisId?: string,
  deferFinalValidation = false,
): void {
  if (fromStatus === item.status && effect !== "status_migrated") return;
  const activity = path.join(durableGuildDir(root), "recommendations", "activity.jsonl");
  const records = readRecommendationActivity(root, effect === "status_migrated");
  const at = new Date().toISOString();
  const event: RecommendationActivity = {
    schema_version: "guild.recommendation_activity.v1",
    activity_id: stableId("activity", `${at}|${crypto.randomUUID()}|${sourceId}|${item.id}`),
    at,
    source_id: sourceId,
    source_analysis_id: canonicalSourceAnalysisId(root, sourceId),
    recommendation_id: item.id,
    ...(previousRecommendationId ? { previous_recommendation_id: previousRecommendationId } : {}),
    ...(previousSourceId ? { previous_source_id: previousSourceId } : {}),
    ...(previousSourceAnalysisId ? { previous_source_analysis_id: previousSourceAnalysisId } : {}),
    evidence_signature: item.evidence_signature,
    scope: item.scope,
    from_status: fromStatus,
    to_status: item.status,
    effect,
  };
  records.push(event);
  atomicWrite(root, activity, records.map((record) => JSON.stringify(record)).join("\n") + "\n");
  if (!deferFinalValidation) readRecommendationActivity(root);
}

function restoreRecommendationFile(root: string, file: string, previous: string | null): void {
  if (previous === null) {
    assertOutputContained(root, file);
    try { fs.unlinkSync(file); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    return;
  }
  atomicWrite(root, file, previous);
}

interface RecommendationTransactionJournal {
  schema_version: "guild.recommendation_transaction.v1";
  transaction_id: string;
  files: Array<{ path: string; previous: string | null }>;
}

const TRANSACTION_JOURNAL_KEYS = new Set(["schema_version", "transaction_id", "files"]);
const TRANSACTION_FILE_KEYS = new Set(["path", "previous"]);

function isAnalyzerOwnedTransactionTarget(root: string, file: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(file)).split(path.sep).join("/");
  const parts = relative.split("/");
  if (relative === ".guild/recommendations/queue.jsonl" ||
      relative === ".guild/recommendations/activity.jsonl" ||
      relative === ".guild/analysis/comparisons/index.json") return true;
  if (parts.length === 3 && parts[0] === ".guild" && parts[1] === "recommendations" &&
      parts[2].endsWith(".jsonl") && SAFE_ID.test(parts[2].slice(0, -".jsonl".length))) return true;
  if (parts.length === 4 && parts[0] === ".guild" && parts[1] === "recommendations" && parts[2] === "drafts" &&
      parts[3].endsWith(".md") && SAFE_ID.test(parts[3].slice(0, -3))) return true;
  if (parts.length === 5 && parts[0] === ".guild" && parts[1] === "analysis" && parts[2] === "runs" &&
      SAFE_ID.test(parts[3]) && ["analysis.json", "analysis.md"].includes(parts[4])) return true;
  return parts.length === 5 && parts[0] === ".guild" && parts[1] === "analysis" && parts[2] === "comparisons" &&
    SAFE_ID.test(parts[3]) && ["comparison.json", "comparison.md"].includes(parts[4]);
}

function assertAnalyzerOwnedTransactionTarget(root: string, file: string): void {
  assertOutputContained(root, file);
  if (!isAnalyzerOwnedTransactionTarget(root, file)) {
    throw new Error(`recommendation transaction target is not analyzer-owned: ${file}`);
  }
}

function transactionJournalPath(root: string): string {
  return path.resolve(durableGuildDir(root), "recommendations", ".transaction.json");
}

function removeTransactionJournal(root: string): void {
  const journal = transactionJournalPath(root);
  assertOutputContained(root, journal);
  try { fs.unlinkSync(journal); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

function recoverPendingTransaction(root: string): void {
  const journal = transactionJournalPath(root);
  const raw = readExistingContainedText(root, journal);
  if (raw === null) return;
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new Error("recommendation transaction journal is malformed"); }
  const item = asRecord(parsed);
  if (!hasOnlyKeys(item, TRANSACTION_JOURNAL_KEYS) || item["schema_version"] !== "guild.recommendation_transaction.v1" ||
      typeof item["transaction_id"] !== "string" || !SAFE_ID.test(item["transaction_id"]) ||
      !Array.isArray(item["files"])) throw new Error("recommendation transaction journal violates guild.recommendation_transaction.v1");
  const restored = new Set<string>();
  const validated: Array<{ file: string; previous: string | null }> = [];
  for (const [index, value] of item["files"].entries()) {
    const entry = asRecord(value);
    if (!hasOnlyKeys(entry, TRANSACTION_FILE_KEYS) || typeof entry["path"] !== "string" || path.isAbsolute(entry["path"]) ||
        entry["path"].split(/[\\/]/).includes("..") ||
        (entry["previous"] !== null && typeof entry["previous"] !== "string")) {
      throw new Error(`recommendation transaction journal file ${index + 1} is invalid`);
    }
    const file = path.resolve(root, entry["path"]);
    assertAnalyzerOwnedTransactionTarget(root, file);
    if (file === journal || restored.has(file)) throw new Error("recommendation transaction journal contains a duplicate or self reference");
    restored.add(file);
    validated.push({ file, previous: entry["previous"] as string | null });
  }
  for (const entry of validated) restoreRecommendationFile(root, entry.file, entry.previous);
  removeTransactionJournal(root);
}

function withFileTransaction<T>(root: string, files: readonly string[], action: () => T): T {
  const journal = transactionJournalPath(root);
  const unique = [...new Set(files.map((file) => path.resolve(file)))];
  if (unique.includes(journal)) throw new Error("transaction targets must not include the transaction journal");
  const record: RecommendationTransactionJournal = {
    schema_version: "guild.recommendation_transaction.v1",
    transaction_id: stableId("transaction", `${new Date().toISOString()}|${crypto.randomUUID()}`),
    files: unique.map((file) => {
      assertAnalyzerOwnedTransactionTarget(root, file);
      return { path: path.relative(path.resolve(root), file), previous: readExistingContainedText(root, file) };
    }),
  };
  atomicWrite(root, journal, JSON.stringify(record, null, 2) + "\n");
  try {
    const result = action();
    removeTransactionJournal(root);
    return result;
  } catch (error) {
    const rollbackErrors: string[] = [];
    for (const entry of record.files) {
      try { restoreRecommendationFile(root, path.resolve(root, entry.path), entry.previous); }
      catch (rollbackError) { rollbackErrors.push(String(rollbackError)); }
    }
    if (rollbackErrors.length === 0) removeTransactionJournal(root);
    if (rollbackErrors.length > 0) throw new Error(`recommendation transaction failed and recovery is pending: ${rollbackErrors.join("; ")}`);
    throw error;
  }
}

function rewriteRecommendation(
  root: string,
  sourceId: string,
  recommendationId: string,
  status: RecommendationStatus,
  effect: RecommendationDecisionResult["effect"],
): Recommendation {
  assertSafeId(recommendationId, "recommendation id");
  const source = recommendationSourceFile(root, sourceId);
  const queue = path.join(durableGuildDir(root), "recommendations", "queue.jsonl");
  const activity = path.join(durableGuildDir(root), "recommendations", "activity.jsonl");
  const sourceBefore = readExistingContainedText(root, source);
  const queueBefore = readExistingContainedText(root, queue);
  const activityBefore = readExistingContainedText(root, activity);
  const records = readRecommendationRecords(root, source, true, sourceId, canonicalSourceAnalysisId(root, sourceId));
  readRecommendationRecords(root, queue, false);
  readRecommendationActivity(root);
  const index = records.findIndex((item) => item.id === recommendationId);
  if (index === -1) throw new Error(`recommendation ${recommendationId} was not found in ${sourceId}`);
  const fromStatus = records[index].status;
  const updated: Recommendation = { ...records[index], status };
  records[index] = updated;
  try {
    writeRecommendationRecords(root, source, records);
    if (updated.scope === "project") upsertProjectQueue(root, [updated], true);
    recordRecommendationActivity(root, sourceId, updated, fromStatus, effect);
  } catch (error) {
    const rollbackErrors: string[] = [];
    for (const [file, previous] of [[source, sourceBefore], [queue, queueBefore], [activity, activityBefore]] as const) {
      try { restoreRecommendationFile(root, file, previous); } catch (rollbackError) { rollbackErrors.push(String(rollbackError)); }
    }
    if (rollbackErrors.length > 0) throw new Error(`recommendation transaction failed and rollback was incomplete: ${rollbackErrors.join("; ")}`);
    throw error;
  }
  return updated;
}

const V14_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const V14_PHASES = new Set(["brainstorm", "team-compose", "plan", "context", "execute", "review", "verify", "reflect"]);
const V14_LOOPS = new Set(["L1", "L2", "L3", "L4", "security-review", "L-arch"]);
const DEGRADATION_KINDS = new Set([
  "coordination.parallelism", "backend_rung", "dispatch.deferred", "feature_degraded",
  "degraded_retrieval", "tier_degraded", "degraded_reason",
]);
const V14_TOOLS = new Set([
  "Read", "Write", "Edit", "Grep", "Glob", "Bash", "Agent", "Skill", "AskUserQuestion",
  "TaskCreate", "TaskUpdate", "TaskList", "WebFetch", "WebSearch", "NotebookEdit", "BashOutput", "KillShell",
]);
const HOOK_MIRROR_EVENTS = new Set([
  "SessionStart", "SessionEnd", "UserPromptSubmit", "PreToolUse", "PostToolUse", "Notification",
  "Stop", "SubagentStop", "PreCompact", "TaskCreated", "TaskCompleted", "TeammateIdle",
  "loop_round_start", "loop_round_end", "codex_review_round",
]);
const LIFECYCLE_TRACE_KEYS = new Set(["schema_version", "event_id", "event_name", "run_id", "at"]);
const DEGRADATION_TRACE_KEYS = new Set(["schema_version", "event_type", "kind", "run_id", "ts", "degradation"]);

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function integerAtLeast(value: unknown, minimum: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= minimum;
}

function strings(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return keys.every((key) => nonEmptyString(value[key]));
}

function noNullFields(value: Record<string, unknown>): boolean {
  return Object.values(value).every((field) => field !== null);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}

function optionalStrings(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return keys.every((key) => !(key in value) || typeof value[key] === "string");
}

function optionalNonNegativeIntegers(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return keys.every((key) => !(key in value) || integerAtLeast(value[key], 0));
}

function validTokenBlock(value: unknown): boolean {
  if (value === undefined) return true;
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  return ["input", "output", "cached", "cost_usd"].every((key) =>
    !(key in (value as Record<string, unknown>)) ||
      (typeof (value as Record<string, unknown>)[key] === "number" &&
        Number.isFinite((value as Record<string, unknown>)[key]) &&
        Number((value as Record<string, unknown>)[key]) >= 0),
  );
}

function validCodexGate(value: unknown): boolean {
  return typeof value === "string" &&
    (["G-spec", "G-plan", "G-diagnose"].includes(value) || /^(?:G-lane):T[0-9]+[a-z]?-[a-z][a-z-]{0,32}$/.test(value));
}

function validV14Envelope(value: Record<string, unknown>, event: string): boolean {
  return value["event"] === event && nonEmptyString(value["run_id"]) &&
    typeof value["ts"] === "string" && V14_TIMESTAMP.test(value["ts"]);
}

/**
 * Validate the evidence-bearing families the analyzer accepts from the mixed
 * canonical JSONL. This is deliberately stricter than category detection:
 * recognizing an event token never makes a malformed row usable evidence.
 * Hook mirrors are the only implicit-run family because their run identity is
 * bound by the containing run log; every other family must carry run_id.
 */
function validateAnalyzerTraceRow(value: Record<string, unknown>): { ok: boolean; implicitRun: boolean } {
  const schema = value["schema_version"];
  if (schema === "guild.trace_event.v1") {
    const lifecycle = hasOnlyKeys(value, LIFECYCLE_TRACE_KEYS) &&
      ["run_started", "run_closed"].includes(String(value["event_name"])) &&
      strings(value, ["event_id", "run_id", "at"]) && ISO_TIMESTAMP.test(String(value["at"]));
    const degradationPayload = asRecord(value["degradation"]);
    const degradation = hasOnlyKeys(value, DEGRADATION_TRACE_KEYS) &&
      value["event_type"] === "feature_degraded" &&
      strings(value, ["kind", "run_id", "ts"]) && ISO_TIMESTAMP.test(String(value["ts"])) &&
      DEGRADATION_KINDS.has(String(value["kind"])) &&
      degradationPayload["kind"] === value["kind"];
    return { ok: lifecycle || degradation, implicitRun: false };
  }
  if (typeof schema === "string" && schema.startsWith("guild.trace.")) {
    if ("event" in value || "event_name" in value) return { ok: false, implicitRun: false };
    return { ok: validateGuildTraceEvent(value).ok, implicitRun: false };
  }
  if ("schema_version" in value) return { ok: false, implicitRun: false };

  if (!noNullFields(value)) return { ok: false, implicitRun: false };

  const event = value["event"];
  if (typeof event !== "string") return { ok: false, implicitRun: false };
  const isHookMirror = HOOK_MIRROR_EVENTS.has(event) &&
    (event !== "loop_round_start" && event !== "loop_round_end" && event !== "codex_review_round" ||
      !("run_id" in value));
  if (isHookMirror) {
    const common = typeof value["ts"] === "string" && V14_TIMESTAMP.test(value["ts"]) &&
      typeof value["tool"] === "string" && typeof value["specialist"] === "string" &&
      nonEmptyString(value["payload_digest"]) && typeof value["ok"] === "boolean" &&
      integerAtLeast(value["ms"], 0) &&
      optionalStrings(value, ["model", "prompt", "loop_layer", "loop_gate", "span_id", "parent_span_id", "tier", "payload_ref"]) &&
      (!("loop_round" in value) || typeof value["loop_round"] === "number" && Number.isInteger(value["loop_round"])) &&
      (!("loop_terminated" in value) || typeof value["loop_terminated"] === "boolean") && validTokenBlock(value["tokens"]);
    const details = event === "loop_round_start"
      ? V14_LOOPS.has(String(value["loop_layer"])) && integerAtLeast(value["loop_round"], 1)
      : event === "loop_round_end"
        ? V14_LOOPS.has(String(value["loop_layer"])) && integerAtLeast(value["loop_round"], 1) && typeof value["loop_terminated"] === "boolean"
        : event === "codex_review_round"
          ? validCodexGate(value["loop_gate"]) && integerAtLeast(value["loop_round"], 1) && typeof value["loop_terminated"] === "boolean"
          : true;
    const ok = common && details;
    return { ok, implicitRun: true };
  }

  if (!validV14Envelope(value, event)) return { ok: false, implicitRun: false };
  let ok = false;
  switch (event) {
    case "phase_start":
      ok = V14_PHASES.has(String(value["phase"]));
      break;
    case "phase_end":
      ok = V14_PHASES.has(String(value["phase"])) && integerAtLeast(value["duration_ms"], 0) &&
        ["ok", "error", "escalated"].includes(String(value["status"]));
      break;
    case "specialist_dispatch":
      ok = strings(value, ["lane_id", "specialist", "task_id", "prompt_excerpt"]);
      break;
    case "specialist_receipt":
      ok = strings(value, ["lane_id", "specialist", "task_id", "receipt_path"]);
      break;
    case "loop_round_start":
      ok = nonEmptyString(value["lane_id"]) && V14_LOOPS.has(String(value["loop_layer"])) &&
        integerAtLeast(value["round_number"], 1) && integerAtLeast(value["cap"], 1) && Number(value["cap"]) <= 256;
      break;
    case "loop_round_end":
      ok = nonEmptyString(value["lane_id"]) && V14_LOOPS.has(String(value["loop_layer"])) &&
        integerAtLeast(value["round_number"], 1) &&
        ["satisfied", "malformed_termination", "cap_hit", "escalation", "error"].includes(String(value["terminated"])) &&
        nonEmptyString(value["terminator"]);
      break;
    case "tool_call":
      ok = V14_TOOLS.has(String(value["tool"])) && typeof value["command_redacted"] === "string" &&
        ["ok", "err", "n/a"].includes(String(value["status"])) && integerAtLeast(value["latency_ms"], 0) &&
        typeof value["result_excerpt_redacted"] === "string" && optionalStrings(value, ["lane_id"]) &&
        optionalNonNegativeIntegers(value, ["tokens_in", "tokens_out"]);
      break;
    case "hook_event":
      ok = HOOK_MIRROR_EVENTS.has(String(value["hook_name"])) && typeof value["payload_excerpt_redacted"] === "string" &&
        integerAtLeast(value["latency_ms"], 0) && ["ok", "err"].includes(String(value["status"])) &&
        optionalStrings(value, ["lane_id"]);
      break;
    case "gate_decision":
      ok = typeof value["gate"] === "string" &&
        (["gate-1-spec", "gate-2-team", "gate-3-plan"].includes(value["gate"]) || /^(?:mid-execution-decision):[a-z][a-z0-9-]{0,63}$/.test(value["gate"])) &&
        ["approved", "rejected", "deferred"].includes(String(value["decision"])) &&
        ["user", "auto-approve-mode"].includes(String(value["source"]));
      break;
    case "assumption_logged":
      ok = strings(value, ["lane_id", "specialist", "assumption_text"]);
      break;
    case "escalation":
      const offered = value["options_offered"];
      ok = ["cap_hit", "malformed_termination_x2", "restart_cap_hit"].includes(String(value["reason"])) &&
        Array.isArray(offered) &&
        ["force-pass", "extend-cap", "rework"].every((choice, index) => offered[index] === choice) &&
        offered.length === 3 && ["force-pass", "extend-cap", "rework"].includes(String(value["user_choice"])) &&
        optionalStrings(value, ["lane_id"]);
      break;
    case "codex_review_round":
      ok = validCodexGate(value["gate"]) &&
        integerAtLeast(value["round_number"], 1) && Number(value["round_number"]) <= 5 &&
        typeof value["terminated_by_satisfied"] === "boolean";
      break;
    default:
      ok = false;
  }
  return { ok, implicitRun: false };
}

function loadEvents(root: string, runId: string): { events: LoadedEvent[]; raw: string; parseErrors: number; invalidRecords: number } {
  const dir = runDir(root, runId);
  const log = resolveRunInputFile(dir, path.join("logs", "v1.4-events.jsonl"));
  const raw = log ? readText(log) ?? "" : "";
  const events: LoadedEvent[] = [];
  let parseErrors = 0;
  let invalidRecords = 0;
  raw.split(/\r?\n/).forEach((line, index) => {
    if (!line.trim()) return;
    try {
      const parsed = JSON.parse(line);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        invalidRecords++;
        return;
      }
      const value = parsed as Record<string, unknown>;
      const validation = validateAnalyzerTraceRow(value);
      const eventRunId = value["run_id"];
      const sameRun = validation.implicitRun
        ? eventRunId === undefined || eventRunId === runId
        : eventRunId === runId;
      if (!sameRun || !validation.ok) {
        invalidRecords++;
        return;
      }
      events.push({
        value,
        line: index + 1,
        ref: `.guild/runs/${runId}/logs/v1.4-events.jsonl#line:${index + 1}`,
      });
    } catch {
      parseErrors++;
    }
  });
  return { events, raw, parseErrors, invalidRecords };
}

function readConfigSnapshot(file: string | null, runId: string): Record<string, unknown> | null {
  if (!file) return null;
  const raw = readText(file);
  if (raw === null) return null;
  try {
    const parsed = asRecord(JSON.parse(raw));
    if (parsed["schema_version"] !== "guild.plugin_config_snapshot.v1") return null;
    if (parsed["run_id"] !== runId) return null;
    if (typeof parsed["effective"] !== "object" || parsed["effective"] === null || Array.isArray(parsed["effective"])) return null;
    if (parsed["config_source_layers"] === undefined || typeof parsed["config_source_layers"] !== "object" || parsed["config_source_layers"] === null || Array.isArray(parsed["config_source_layers"])) return null;
    const plugin = asRecord(parsed["plugin"]);
    if (!scalar(plugin, "version") || !scalar(plugin, "ref") || plugin["version"] === "unknown" || plugin["ref"] === "unknown") return null;
    const host = asRecord(parsed["host_adapter"]);
    if (!scalar(host, "requested") || !scalar(host, "resolved")) return null;
    const hashes = asRecord(parsed["registry_hashes"]);
    if (!("skills" in hashes) || !("agents" in hashes)) return null;
    if (!scalar(parsed, "command_surface_version")) return null;
    if (parsed["redaction_policy"] !== "scrubbed-config-v1") return null;
    if (typeof parsed["environment_capabilities"] !== "object" || parsed["environment_capabilities"] === null || Array.isArray(parsed["environment_capabilities"])) return null;
    return parsed;
  } catch {
    return null;
  }
}

const EVENT_CLASS_CATEGORY: Readonly<Record<AnalysisEventClass, EvidenceCategory | null>> = Object.freeze({
  run_started: null, run_closed: "close", run_attachment_resolved: null, config_snapshot_written: null,
  prompt_received: "prompt", prompt_normalized: "prompt", clarifying_question_asked: "prompt", implementation_authorized: "gate",
  agent_dispatched: "agent", agent_prompt_sent: "agent", agent_response_received: "agent", agent_handoff_written: "agent",
  knowledge_lookup_started: "knowledge", knowledge_lookup_result: "knowledge", memory_lookup_started: "memory", memory_lookup_result: "memory",
  tool_call_started: "tool", tool_call_finished: "tool", tool_call_denied: "tool", tool_call_failed: "tool",
  loop_entered: "loop", loop_iteration: "loop", loop_exited: "loop", loop_cap_hit: "loop",
  phase_entered: "phase", phase_concluded: "phase", gate_started: "gate", gate_concluded: "gate",
  instruction_violation_detected: "steering", user_steering_received: "steering", correction_applied: "correction", repeated_failure_detected: "correction",
  recommendation_created: null, recommendation_routed: null, bug_report_prompted: null,
});

function categoryOf(event: Record<string, unknown>): EvidenceCategory | null {
  const schema = event["schema_version"];
  if (schema === "guild.trace.analysis.v2") {
    const eventClass = event["event_class"] as AnalysisEventClass;
    return EVENT_CLASS_CATEGORY[eventClass] ?? null;
  }
  if (schema === "guild.trace_event.v1") return event["event_name"] === "run_closed" ? "close" : null;
  if (schema === "guild.trace.dispatch.v1") return "agent";
  if (schema === "guild.trace.recall.v1") return "knowledge";
  if ("schema_version" in event) return null;
  if (event["event"] === "specialist_dispatch") return "agent";
  if (event["event"] === "tool_call") return "tool";
  if (event["event"] === "phase_start" || event["event"] === "phase_end") return "phase";
  if (event["event"] === "loop_round_start" || event["event"] === "loop_round_end") return "loop";
  if (event["event"] === "gate_decision" || event["event"] === "codex_review_round") return "gate";
  if (event["event"] === "UserPromptSubmit") return "prompt";
  return null;
}

function evidenceFor(events: LoadedEvent[], category: EvidenceCategory): string[] {
  return events.filter((event) => categoryOf(event.value) === category).map((event) => event.ref);
}

function numeric(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

function tokenUsage(events: LoadedEvent[]): RunAnalysis["usage"] {
  const specialists = new Set<string>();
  let input = 0;
  let output = 0;
  let cached = 0;
  let cost = 0;
  let llm = 0;
  let duration = 0;
  const semanticSpans = new Set(events
    .filter(({ value }) => value["schema_version"] === "guild.trace.analysis.v2")
    .map(({ value }) => scalar(value, "span_id"))
    .filter((value): value is string => value !== null));
  for (const { value } of events) {
    const span = scalar(value, "span_id");
    if (value["schema_version"] !== "guild.trace.analysis.v2" && span && semanticSpans.has(span)) continue;
    const tokens = asRecord(value["tokens"]);
    const eventInput = numeric(tokens["input"]) + numeric(value["tokens_in"]);
    const eventOutput = numeric(tokens["output"]) + numeric(value["tokens_out"]);
    const eventCached = numeric(tokens["cached"]);
    const eventCost = numeric(tokens["cost_usd"]);
    input += eventInput;
    output += eventOutput;
    cached += eventCached;
    cost += eventCost;
    duration += numeric(value["duration_ms"]) + numeric(value["latency_ms"]);
    const specialist = scalar(value, "specialist") ?? scalar(value, "attribution_specialist") ??
      (value["event_class"] === "agent_dispatched" ? scalar(value, "actor_id") : null);
    if (specialist) specialists.add(specialist);
    if (eventInput + eventOutput + eventCached > 0 || categoryOf(value) === "agent") llm++;
  }
  return {
    llm_event_count: llm,
    specialists_dispatched: [...specialists].sort(),
    tokens: { input, output, cached, total: input + output + cached, cost_usd: cost },
    duration_ms: duration,
  };
}

function finding(
  analysisId: string,
  kind: AnalysisFinding["kind"],
  severity: AnalysisFinding["severity"],
  summary: string,
  evidenceRefs: string[],
  signature: string,
): AnalysisFinding {
  return {
    id: stableId("finding", `${analysisId}|${kind}|${signature}`),
    kind,
    severity,
    summary,
    evidence_refs: [...new Set(evidenceRefs)].sort(),
    signature,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// C-DETECTORS/v1 additive diagnostics. Every detector reads only validated
// frozen rows plus typed sidecars named by an explicit payload_ref; each
// consumed sidecar byte enters diagnostics.input_manifest/input_hash. A
// missing input is unobservable, never a measured zero or a positive proof.
// ─────────────────────────────────────────────────────────────────────────────

const DIAGNOSTICS_CONTRACT = "C-DETECTORS/v1" as const;
const HASH_REF = /^sha256:[a-f0-9]{64}$/;
const SIDECAR_MAX_BYTES = 1024 * 1024;
const LONG_LATENCY_MS = 30_000;
const OUTLIER_MIN_COHORT = 5;
const REPEAT_THRESHOLD = 2;
const SUBSTANTIVE_CLASSES = ["tool_call_started", "tool_call_finished", "tool_call_failed", "tool_call_denied", "agent_dispatched", "agent_prompt_sent"];
const RESULT_CLASSES = ["agent_response_received", "agent_handoff_written", "tool_call_finished", "tool_call_failed"];
const INPUT_CHANGE_CLASSES = ["prompt_received", "implementation_authorized", "config_snapshot_written"];
const DENIAL_CAUSES = ["policy", "user", "host_unavailable", "capability_absent"] as const;
const PROJECT_CAPABILITY_KINDS: Readonly<Record<string, RecommendationKind>> = Object.freeze({
  skill: "create_skill", agent: "create_agent", workflow: "update_workflow", knowledge: "update_knowledge", settings: "change_settings",
});
const PLUGIN_CAPABILITY_KINDS: Readonly<Record<string, RecommendationKind>> = Object.freeze({
  plugin_behavior: "tooling_gap", plugin_invariant: "bug_report",
});

/** Typed sidecar schema -> the analysis.v2 classes allowed to reference it. */
const SIDECAR_CARRIERS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  "guild.analysis_declaration.v1": ["run_started", "implementation_authorized"],
  "guild.instruction_evidence.v1": ["gate_concluded"],
  "guild.outcome_record.v1": ["gate_concluded"],
  "guild.capability_evidence.v1": ["tool_call_denied", "tool_call_failed"],
  "guild.lookup_result.v1": ["knowledge_lookup_result", "memory_lookup_result"],
  "guild.prompt_context.v1": ["prompt_normalized", "agent_prompt_sent"],
  "guild.phase_cursor.v1": ["run_closed", "phase_concluded"],
});
const SIDECAR_CARRIER_CLASSES = new Set(Object.values(SIDECAR_CARRIERS).flat());

const arrayOf = (value: unknown, test: (item: unknown) => boolean): boolean => Array.isArray(value) && value.every(test);
const keysOf = (...keys: string[]): ReadonlySet<string> => new Set(["schema_version", "run_id", ...keys]);
const hashRef = (value: unknown): boolean => typeof value === "string" && HASH_REF.test(value);
const runEvidenceRef = (runId: string) => (value: unknown): boolean =>
  typeof value === "string" && validEvidenceRef(value) && evidenceRunId(value) === runId;

const SIDECAR_VALIDATORS: Readonly<Record<string, (value: Record<string, unknown>, runId: string) => boolean>> = Object.freeze({
  "guild.analysis_declaration.v1": (v) => {
    const instructions = Array.isArray(v["instructions"]) ? v["instructions"].map(asRecord) : null;
    return hasOnlyKeys(v, keysOf("assessed_input_hash", "assessed_input_ref", "instructions", "instructions_complete", "clarification_required_tasks", "required_phases")) &&
      hashRef(v["assessed_input_hash"]) && nonEmptyString(v["assessed_input_ref"]) && instructions !== null &&
      instructions.every((item) => hasOnlyKeys(item, new Set(["instruction_id", "requirement_hash"])) &&
        typeof item["instruction_id"] === "string" && SAFE_ID.test(item["instruction_id"]) && hashRef(item["requirement_hash"])) &&
      new Set(instructions.map((item) => item["instruction_id"])).size === instructions.length &&
      typeof v["instructions_complete"] === "boolean" &&
      arrayOf(v["clarification_required_tasks"], nonEmptyString) && arrayOf(v["required_phases"], nonEmptyString);
  },
  "guild.instruction_evidence.v1": (v, runId) =>
    hasOnlyKeys(v, keysOf("instruction_id", "requirement_hash", "verifier_kind", "verifier_ref", "result", "verified_input_hash", "verification_input_ref", "evidence_refs")) &&
    typeof v["instruction_id"] === "string" && SAFE_ID.test(v["instruction_id"]) && hashRef(v["requirement_hash"]) &&
    ["done_when", "configured_check", "review_gate"].includes(String(v["verifier_kind"])) && runEvidenceRef(runId)(v["verifier_ref"]) &&
    ["passed", "failed", "unobservable"].includes(String(v["result"])) && hashRef(v["verified_input_hash"]) &&
    nonEmptyString(v["verification_input_ref"]) && arrayOf(v["evidence_refs"], runEvidenceRef(runId)),
  "guild.outcome_record.v1": (v) =>
    hasOnlyKeys(v, keysOf("kind", "result", "verified_input_hash", "reopen_transitions", "findings_complete", "unresolved_finding_ids")) &&
    ["review", "verify"].includes(String(v["kind"])) && ["passed", "failed"].includes(String(v["result"])) &&
    hashRef(v["verified_input_hash"]) && integerAtLeast(v["reopen_transitions"], 0) && typeof v["findings_complete"] === "boolean" &&
    arrayOf(v["unresolved_finding_ids"], (id) => typeof id === "string" && SAFE_ID.test(id)),
  "guild.capability_evidence.v1": (v, runId) =>
    hasOnlyKeys(v, keysOf("action_signature", "owner", "capability_kind", "target", "evidence_refs")) &&
    typeof v["action_signature"] === "string" && /^\S{1,256}$/.test(v["action_signature"]) &&
    ((v["owner"] === "project" && String(v["capability_kind"]) in PROJECT_CAPABILITY_KINDS) ||
      (v["owner"] === "plugin" && String(v["capability_kind"]) in PLUGIN_CAPABILITY_KINDS)) &&
    typeof v["target"] === "string" && SAFE_ID.test(v["target"]) && arrayOf(v["evidence_refs"], runEvidenceRef(runId)),
  "guild.lookup_result.v1": (v, runId) =>
    hasOnlyKeys(v, keysOf("outcome", "result_ref")) && ["hit", "miss"].includes(String(v["outcome"])) && runEvidenceRef(runId)(v["result_ref"]),
  "guild.prompt_context.v1": (v) =>
    hasOnlyKeys(v, keysOf("prompt_hash", "context_hash", "retry_authorized")) && nonEmptyString(v["prompt_hash"]) &&
    hashRef(v["context_hash"]) && typeof v["retry_authorized"] === "boolean",
  "guild.phase_cursor.v1": (v) =>
    hasOnlyKeys(v, keysOf("visited_phases", "bypassed_phases")) &&
    arrayOf(v["visited_phases"], nonEmptyString) && arrayOf(v["bypassed_phases"], nonEmptyString),
});

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function sortedUnique(values: Iterable<string>): string[] {
  return [...new Set(values)].sort();
}

interface AdditiveInput { entry: InputManifestEntry; bytes: string | null }
interface Sidecar { ref: string; schema: string; value: Record<string, unknown>; carrier: LoadedEvent }

/** Read one run-relative additive input exactly once; unsafe/missing refs are recorded, never followed. */
function readAdditiveInput(store: Map<string, AdditiveInput>, dir: string, runId: string, relative: unknown): AdditiveInput {
  const text = typeof relative === "string" ? relative : "";
  const candidate = text && !path.isAbsolute(text) && !text.includes("#") ? `.guild/runs/${runId}/${text}` : "";
  const ref = candidate && validEvidenceRef(candidate) && evidenceRunId(candidate) === runId
    ? candidate
    : `invalid-ref:${sha256(String(relative)).slice(0, 16)}`;
  const existing = store.get(ref);
  if (existing) return existing;
  let input: AdditiveInput = { entry: { ref, sha256: null, status: "rejected" }, bytes: null };
  if (ref.startsWith(".guild/")) {
    let file: string | null = null;
    let unsafe = false;
    try { file = resolveRunInputFile(dir, text); } catch { unsafe = true; }
    if (!unsafe && file === null) input = { entry: { ref, sha256: null, status: "missing" }, bytes: null };
    if (!unsafe && file !== null && fs.statSync(file).size <= SIDECAR_MAX_BYTES) {
      const bytes = fs.readFileSync(file, "utf8");
      input = { entry: { ref, sha256: `sha256:${sha256(bytes)}`, status: "consumed" }, bytes };
    }
  }
  store.set(ref, input);
  return input;
}

function readSidecars(store: Map<string, AdditiveInput>, dir: string, runId: string, events: readonly LoadedEvent[]): Sidecar[] {
  const sidecars: Sidecar[] = [];
  for (const event of events) {
    const value = event.value;
    if (value["schema_version"] !== "guild.trace.analysis.v2" || value["payload_ref"] === undefined ||
        !SIDECAR_CARRIER_CLASSES.has(String(value["event_class"]))) continue;
    const input = readAdditiveInput(store, dir, runId, value["payload_ref"]);
    if (input.bytes === null) continue;
    let record: Record<string, unknown>;
    try { record = asRecord(JSON.parse(input.bytes)); } catch { if (input.entry.status === "consumed") input.entry.status = "unrecognized"; continue; }
    const schema = String(record["schema_version"]);
    const validator = SIDECAR_VALIDATORS[schema];
    if (!validator) { if (input.entry.status === "consumed") input.entry.status = "unrecognized"; continue; }
    if (record["run_id"] !== runId || !SIDECAR_CARRIERS[schema].includes(String(value["event_class"])) || !validator(record, runId)) {
      input.entry.status = "rejected";
      continue;
    }
    sidecars.push({ ref: input.entry.ref, schema, value: record, carrier: event });
  }
  return sidecars;
}

/** One correlated action: span twins collapse (B01-F4); rows without a span stay distinct. */
interface ActionGroup { rows: LoadedEvent[]; refs: string[]; line: number }

function actionGroups(events: readonly LoadedEvent[], runId: string): ActionGroup[] {
  const byRef = new Map(events.map((event) => [event.ref, event]));
  return collapseSpanTwins(events, runId).map((action) => {
    const rows = action.refs.map((ref) => byRef.get(ref)).filter((row): row is LoadedEvent => row !== undefined).sort((a, b) => a.line - b.line);
    return { rows, refs: [...action.refs], line: rows[0]?.line ?? 0 };
  }).filter((group) => group.rows.length > 0).sort((a, b) => a.line - b.line);
}

const classOf = (event: LoadedEvent): string =>
  event.value["schema_version"] === "guild.trace.analysis.v2" ? String(event.value["event_class"]) : "";
const groupHas = (group: ActionGroup, classes: readonly string[]): boolean => group.rows.some((row) => classes.includes(classOf(row)));
const rowsOf = (group: ActionGroup, classes: readonly string[]): LoadedEvent[] => group.rows.filter((row) => classes.includes(classOf(row)));
function groupField(group: ActionGroup, key: string): string | null {
  for (const row of group.rows) {
    const value = scalar(row.value, key);
    if (value !== null) return value;
  }
  return null;
}
function rowTime(event: LoadedEvent): number {
  const value = scalar(event.value, "ts") ?? scalar(event.value, "at");
  return value === null ? Number.NaN : Date.parse(value);
}
const isLegacyToolFailure = (event: LoadedEvent): boolean => event.value["event"] === "tool_call" && event.value["status"] === "err";
const isFailureRow = (event: LoadedEvent): boolean =>
  isLegacyToolFailure(event) || ["tool_call_failed", "repeated_failure_detected"].includes(classOf(event));

/** v1 repeated_failure key: typed signature first, else the legacy mirror triple; none means unsignatured. */
function failureSignature(group: ActionGroup): string | null {
  const typed = group.rows.filter((row) => classOf(row) !== "");
  for (const row of [...typed.filter(isFailureRow), ...typed]) {
    const signature = scalar(row.value, "signature");
    if (signature !== null) return signature;
  }
  const legacy = group.rows.find(isLegacyToolFailure);
  return legacy ? [legacy.value["tool"], legacy.value["command_redacted"], legacy.value["result_excerpt_redacted"]].map(String).join("|") : null;
}

/** Span-independent tool action key used for gap ownership matching. */
function toolActionKey(group: ActionGroup): string | null {
  const denied = rowsOf(group, ["tool_call_denied"])[0];
  if (denied) return String(denied.value["signature"]).split(":").slice(1).join(":") || null;
  for (const row of group.rows) {
    if (classOf(row) !== "" && scalar(row.value, "signature") !== null) return scalar(row.value, "signature");
  }
  const legacy = group.rows.find((row) => row.value["event"] === "tool_call");
  return legacy ? toolActionSignature(String(legacy.value["tool"]), String(legacy.value["command_redacted"])) : null;
}

interface DetectorContext {
  runId: string;
  events: LoadedEvent[];
  groups: ActionGroup[];
  sidecars: Sidecar[];
  declaration: Sidecar | null;
  declarationReason: string | null;
  store: Map<string, AdditiveInput>;
  dir: string;
  eligible: boolean;
  closeRefs: string[];
  instructionObservableRefs: string[];
  v1ViolationRefs: string[];
}

interface DetectorOutput {
  result: DetectorResult;
  findings?: Array<Omit<AnalysisFinding, "id">>;
  supported?: SupportedRecommendation[];
}

interface SupportedRecommendation {
  scope: RecommendationScope;
  kind: RecommendationKind;
  target: string;
  severity: Recommendation["severity"];
  summary: string;
  evidence_refs: string[];
}

function result(detector: DetectorId, state: DetectorState, value: Record<string, unknown>, refs: Iterable<string>, reason: string | null): DetectorResult {
  return { detector, state, value, evidence_refs: sortedUnique(refs), reason };
}

/** A proof binds only when the frozen verification input hashes to both its claim and the assessed set. */
function boundInput(ctx: DetectorContext, claimed: unknown, inputRef: unknown): { bound: boolean; ref: string | null } {
  if (!ctx.declaration || claimed !== ctx.declaration.value["assessed_input_hash"]) return { bound: false, ref: null };
  if (inputRef === undefined) return { bound: true, ref: null };
  const input = readAdditiveInput(ctx.store, ctx.dir, ctx.runId, inputRef);
  return { bound: input.bytes !== null && input.entry.sha256 === claimed, ref: input.entry.ref };
}

/**
 * The verifier row must be execution-bound to THIS proof: it is the proof's own
 * carrier, or a gate row carrying a proof for the same obligation and input hash.
 * Any other gate_concluded/ok never corroborates.
 */
function verifierCorroborates(ctx: DetectorContext, sidecar: Sidecar): boolean {
  const proof = sidecar.value;
  const verifier = ctx.events.find((event) => event.ref === proof["verifier_ref"]);
  if (!verifier || classOf(verifier) !== "gate_concluded") return false;
  const bound = verifier.ref === sidecar.carrier.ref || ctx.sidecars.some((other) => other.schema === "guild.instruction_evidence.v1" &&
    other.carrier.ref === verifier.ref && other.value["instruction_id"] === proof["instruction_id"] &&
    other.value["requirement_hash"] === proof["requirement_hash"] && other.value["verified_input_hash"] === proof["verified_input_hash"]);
  if (!bound) return false;
  return (proof["result"] === "passed" && verifier.value["status"] === "ok") || (proof["result"] === "failed" && verifier.value["status"] === "error");
}

interface ProofVerdict { sidecar: Sidecar; valid: boolean; refs: string[] }

function instructionProofs(ctx: DetectorContext): ProofVerdict[] {
  return ctx.sidecars.filter((item) => item.schema === "guild.instruction_evidence.v1").map((sidecar) => {
    const proof = sidecar.value;
    const binding = boundInput(ctx, proof["verified_input_hash"], proof["verification_input_ref"]);
    const valid = proof["result"] !== "unobservable" && binding.bound && verifierCorroborates(ctx, sidecar);
    return { sidecar, valid, refs: sortedUnique([sidecar.ref, String(proof["verifier_ref"]), ...(binding.ref ? [binding.ref] : [])]) };
  });
}

function detectInstructionFollowing(ctx: DetectorContext): DetectorOutput & { checks: InstructionCheck[]; aggregate: AssessmentStatus; typedViolationRefs: string[]; satisfiedRefs: string[] } {
  const proofs = instructionProofs(ctx);
  const declared = ctx.declaration ? (ctx.declaration.value["instructions"] as Array<Record<string, string>>) : [];
  const violationRows = ctx.events.filter((event) => classOf(event) === "instruction_violation_detected");
  const checks: InstructionCheck[] = declared.map((item) => {
    const mine = proofs.filter(({ sidecar }) => sidecar.value["instruction_id"] === item.instruction_id && sidecar.value["requirement_hash"] === item.requirement_hash);
    const passed = mine.filter((proof) => proof.valid && proof.sidecar.value["result"] === "passed");
    const failed = mine.filter((proof) => proof.valid && proof.sidecar.value["result"] === "failed");
    const violations = violationRows.filter((event) => [item.instruction_id, `instruction:${item.instruction_id}`].includes(String(event.value["signature"])));
    const status: AssessmentStatus = failed.length > 0 || violations.length > 0 ? "violated"
      : passed.length > 0 ? "satisfied" : mine.length > 0 ? "ambiguous" : "unobservable";
    return {
      instruction_id: item.instruction_id,
      requirement_hash: item.requirement_hash,
      status,
      evidence_refs: sortedUnique([...violations.map((event) => event.ref), ...mine.flatMap((proof) => proof.sidecar.value["evidence_refs"] as string[])]),
      proof_refs: sortedUnique(mine.flatMap((proof) => proof.refs)),
    };
  }).sort((a, b) => a.instruction_id.localeCompare(b.instruction_id));
  const typedViolationRefs = checks.filter((check) => check.status === "violated").flatMap((check) => [...check.evidence_refs, ...check.proof_refs]);
  const complete = ctx.declaration !== null && ctx.declaration.value["instructions_complete"] === true && checks.length > 0;
  const aggregate: AssessmentStatus = typedViolationRefs.length > 0 || ctx.v1ViolationRefs.length > 0 ? "violated"
    : complete && checks.every((check) => check.status === "satisfied") ? "satisfied"
      : ctx.instructionObservableRefs.length > 0 || proofs.length > 0 ? "ambiguous" : "unobservable";
  const satisfiedRefs = aggregate === "satisfied" ? checks.flatMap((check) => [...check.evidence_refs, ...check.proof_refs, ctx.declaration!.ref]) : [];
  const counts = Object.fromEntries((["satisfied", "violated", "ambiguous", "unobservable"] as const).map((status) => [status, checks.filter((check) => check.status === status).length]));
  const reason = aggregate === "satisfied" || aggregate === "violated" ? null
    : ctx.declaration === null ? (ctx.declarationReason ?? "no_instruction_declaration")
      : !complete ? "declared_scope_incomplete" : "missing_typed_proof";
  return {
    result: result("instruction_following", aggregate === "satisfied" || aggregate === "violated" ? "observed" : aggregate === "ambiguous" ? "ambiguous" : "unobservable", {
      aggregate,
      declared: checks.length,
      declared_complete: complete,
      counts,
      requirement_hashes: sortedUnique(checks.map((check) => check.requirement_hash)),
    }, [...typedViolationRefs, ...ctx.v1ViolationRefs, ...satisfiedRefs, ...(aggregate === "ambiguous" ? ctx.instructionObservableRefs : [])], reason),
    checks,
    aggregate,
    typedViolationRefs,
    satisfiedRefs,
  };
}

function detectRepeatedMistake(ctx: DetectorContext, proofs: ProofVerdict[]): DetectorOutput {
  const attempts: Array<{ signature: string; task: string | null; phase: string | null; refs: string[]; source: string }> = [];
  let unsignatured = 0;
  for (const group of ctx.groups) {
    if (group.rows.some(isFailureRow)) {
      const signature = failureSignature(group);
      if (signature === null) unsignatured++;
      else attempts.push({ signature, task: groupField(group, "task_id"), phase: groupField(group, "phase"), refs: group.refs, source: "failed_action" });
    } else if (groupHas(group, ["correction_applied"])) {
      attempts.push({ signature: groupField(group, "signature")!, task: groupField(group, "task_id"), phase: groupField(group, "phase"), refs: group.refs, source: "correction_applied" });
    }
  }
  // Failed-proof carriers sharing one span are one attempt (same span dedupe as tool rows).
  const verifierAttempts = new Map<string, (typeof attempts)[number]>();
  for (const proof of proofs.filter((item) => item.valid && item.sidecar.value["result"] === "failed")) {
    const signature = `instruction:${String(proof.sidecar.value["instruction_id"])}`;
    const group = ctx.groups.find((candidate) => candidate.refs.includes(proof.sidecar.carrier.ref));
    const key = `${signature}|${group ? group.refs[0] : proof.sidecar.carrier.ref}`;
    const prior = verifierAttempts.get(key);
    if (prior) { prior.refs = sortedUnique([...prior.refs, ...proof.refs]); continue; }
    verifierAttempts.set(key, { signature, task: scalar(proof.sidecar.carrier.value, "task_id"), phase: scalar(proof.sidecar.carrier.value, "phase"), refs: [...proof.refs], source: "failed_verifier" });
  }
  attempts.push(...verifierAttempts.values());
  const clusters = new Map<string, typeof attempts>();
  for (const attempt of attempts) {
    const key = `${attempt.signature}|${attempt.task ?? "-"}|${attempt.phase ?? "-"}`;
    clusters.set(key, [...(clusters.get(key) ?? []), attempt]);
  }
  const repeated = [...clusters.values()].filter((items) => items.length >= REPEAT_THRESHOLD).map((items) => ({
    signature: items[0].signature,
    task_id: items[0].task,
    phase: items[0].phase,
    attempts: items.length,
    sources: sortedUnique(items.map((item) => item.source)),
    refs: sortedUnique(items.flatMap((item) => item.refs)),
  })).sort((a, b) => `${a.signature}|${a.task_id}|${a.phase}`.localeCompare(`${b.signature}|${b.task_id}|${b.phase}`));
  const state: DetectorState = attempts.length > 0 ? "observed" : "unobservable";
  // v1 detectFindings keys tool failures only; repeated failed verifications surface here.
  const findings = repeated.filter((item) => item.sources.includes("failed_verifier")).map((item) => ({
    kind: "repeated_failure" as const, severity: "high" as const,
    summary: `The same failed verification recurred ${item.attempts} times.`, evidence_refs: item.refs, signature: item.signature,
  }));
  return {
    findings,
    result: result("repeated_mistake", state, { clusters: repeated, signed_attempts: attempts.length, unsignatured_failures: unsignatured },
      repeated.flatMap((item) => item.refs),
      state === "observed" ? null : unsignatured > 0 ? "absent_action_signature" : "no_failure_or_correction_evidence"),
  };
}

function detectSteering(ctx: DetectorContext): DetectorOutput {
  const interventions = ctx.groups.filter((group) => groupHas(group, ["user_steering_received"]));
  const bySignature: Record<string, number> = {};
  for (const group of interventions) {
    const signature = groupField(group, "signature") ?? "unknown";
    bySignature[signature] = (bySignature[signature] ?? 0) + 1;
  }
  return {
    result: result("steering", interventions.length > 0 ? "observed" : "unobservable", {
      interventions: interventions.length,
      by_signature: Object.fromEntries(Object.entries(bySignature).sort(([a], [b]) => a.localeCompare(b))),
      repeated: interventions.length >= REPEAT_THRESHOLD,
      necessity: "unobservable",
    }, interventions.flatMap((group) => group.refs), interventions.length > 0 ? null : "no_steering_classification"),
  };
}

function firstSubstantive(ctx: DetectorContext, after: number, matches: (group: ActionGroup) => boolean, before = Number.POSITIVE_INFINITY): ActionGroup | null {
  return ctx.groups.find((group) => group.line > after && group.line < before && groupHas(group, SUBSTANTIVE_CLASSES) && matches(group)) ?? null;
}

function detectClarification(ctx: DetectorContext): DetectorOutput {
  const required = new Set(ctx.declaration ? ctx.declaration.value["clarification_required_tasks"] as string[] : []);
  const clarifications = ctx.groups.filter((group) => groupHas(group, ["clarifying_question_asked"]));
  const pairs: Array<{ task_id: string | null; order: string; constraint: string; timing: string }> = [];
  const findings: Array<Omit<AnalysisFinding, "id">> = [];
  const refs: string[] = [];
  for (const group of clarifications) {
    const task = groupField(group, "task_id");
    const action = task === null ? null : firstSubstantive(ctx, 0, (candidate) => groupField(candidate, "task_id") === task);
    const order = task === null ? "uncorrelated" : action === null ? "no_action" : action.line < group.line ? "action_first" : "clarification_first";
    const declared = task !== null && required.has(task);
    const timing = !declared || order === "uncorrelated" ? "unknown" : order === "action_first" ? "late" : "timely";
    pairs.push({ task_id: task, order, constraint: declared ? "declared" : "undeclared", timing });
    if (timing === "unknown") continue;
    const evidence = [...group.refs, ...(action?.refs ?? []), ctx.declaration!.ref];
    refs.push(...evidence);
    if (timing === "late") {
      findings.push({ kind: "prompt_inefficiency", severity: "low", summary: `A required clarification for task ${task} was asked after the first substantive action.`, evidence_refs: sortedUnique(evidence), signature: `late-clarification:${task}` });
    }
  }
  const count = (timing: string): number => pairs.filter((pair) => pair.timing === timing).length;
  const state: DetectorState = count("late") + count("timely") > 0 ? "observed" : pairs.length > 0 ? "ambiguous" : "unobservable";
  return {
    result: result("clarification", state, { timely: count("timely"), late: count("late"), unknown: count("unknown"), pairs },
      state === "ambiguous" ? clarifications.flatMap((group) => group.refs) : refs,
      state === "observed" ? null : state === "ambiguous" ? "no_declared_clarification_constraint" : "no_clarification_correlation"),
    findings,
  };
}

function detectRedundantPrompt(ctx: DetectorContext): DetectorOutput {
  const contexts = new Map(ctx.sidecars.filter((item) => item.schema === "guild.prompt_context.v1").map((item) => [item.carrier.ref, item]));
  const prompts = ctx.groups.filter((group) => groupHas(group, ["prompt_normalized", "agent_prompt_sent"]));
  const last = new Map<string, ActionGroup>();
  const candidates = new Map<string, string[]>();
  let unkeyed = 0;
  for (const group of prompts) {
    const row = rowsOf(group, ["prompt_normalized", "agent_prompt_sent"])[0];
    const context = contexts.get(row.ref);
    const promptHash = scalar(row.value, "prompt_hash");
    const task = groupField(group, "task_id");
    const phase = groupField(group, "phase");
    if (!context || context.value["prompt_hash"] !== promptHash || task === null || phase === null) { unkeyed++; continue; }
    const key = sha256(canonicalJson([promptHash, task, phase, context.value["context_hash"]])).slice(0, 16);
    const prior = last.get(key);
    last.set(key, group);
    if (!prior || context.value["retry_authorized"] === true) continue;
    const intervening = ctx.groups.some((candidate) => candidate.line > prior.line && candidate.line < group.line &&
      groupHas(candidate, RESULT_CLASSES) && [null, task].includes(groupField(candidate, "task_id")));
    if (intervening) continue;
    candidates.set(key, sortedUnique([...(candidates.get(key) ?? []), ...prior.refs, ...group.refs, context.ref]));
  }
  const clusters = [...candidates.entries()].map(([key, refs]) => ({ signature: `redundant-prompt:${key}`, refs })).sort((a, b) => a.signature.localeCompare(b.signature));
  const keyed = prompts.length - unkeyed;
  return {
    result: result("redundant_prompt", keyed > 0 ? "observed" : "unobservable", { prompts: prompts.length, keyed, unkeyed, candidates: clusters.map((item) => item.signature) },
      clusters.flatMap((item) => item.refs), keyed > 0 ? null : prompts.length > 0 ? "missing_context_hash" : "no_normalized_prompts"),
    findings: clusters.map((item) => ({ kind: "prompt_inefficiency" as const, severity: "low" as const, summary: "An identical prompt was resent against unchanged bound inputs without an intervening result.", evidence_refs: item.refs, signature: item.signature })),
  };
}

function detectPromptActionLatency(ctx: DetectorContext): DetectorOutput {
  const samples: number[] = [];
  const refs: string[] = [];
  let long = 0;
  let waits = 0;
  let malformed = 0;
  for (const group of ctx.groups.filter((candidate) => groupHas(candidate, ["prompt_received", "agent_prompt_sent"]))) {
    const prompt = rowsOf(group, ["prompt_received", "agent_prompt_sent"])[0];
    const span = scalar(prompt.value, "span_id");
    if (span === null) continue;
    const correlated = (candidate: ActionGroup): boolean => candidate.rows.some((row) => scalar(row.value, "parent_span_id") === span);
    const action = firstSubstantive(ctx, group.line, correlated);
    if (!action) continue;
    if (ctx.groups.some((candidate) => candidate.line > group.line && candidate.line < action.line && groupHas(candidate, ["clarifying_question_asked"]) && correlated(candidate))) {
      waits++;
      continue;
    }
    const elapsed = rowTime(action.rows[0]) - rowTime(prompt);
    if (!Number.isFinite(elapsed) || elapsed < 0) { malformed++; continue; }
    samples.push(elapsed);
    if (elapsed > LONG_LATENCY_MS) { long++; refs.push(prompt.ref, ...action.refs); }
  }
  const state: DetectorState = samples.length + waits > 0 ? "observed" : "unobservable";
  return {
    result: result("prompt_action_latency", state, {
      pairs: samples.length, samples_ms: samples.sort((a, b) => a - b), long_latency: long, excluded_waits: waits, malformed,
      threshold_ms: LONG_LATENCY_MS,
    }, refs, state === "observed" ? null : malformed > 0 ? "malformed_timestamps" : "no_correlated_prompt_action"),
  };
}

function detectWorkflowChurn(ctx: DetectorContext): DetectorOutput {
  const findings: Array<Omit<AnalysisFinding, "id">> = [];
  const capRefs = [
    ...ctx.groups.filter((group) => groupHas(group, ["loop_cap_hit"])).flatMap((group) => group.refs),
    ...ctx.events.filter((event) => event.value["event"] === "loop_round_end" && event.value["terminated"] === "cap_hit").map((event) => event.ref),
  ];
  const loopRows = ctx.events.filter((event) => categoryOf(event.value) === "loop");
  const entries = ctx.events.filter((event) => classOf(event) === "phase_entered" || event.value["event"] === "phase_start");
  const exits = ctx.events.filter((event) => classOf(event) === "phase_concluded" || event.value["event"] === "phase_end");
  const reentries: Record<string, number> = {};
  const reentryRefs: string[] = [];
  for (const entry of entries) {
    const phase = scalar(entry.value, "phase")!;
    if (exits.some((exit) => exit.line < entry.line && scalar(exit.value, "phase") === phase)) {
      reentries[phase] = (reentries[phase] ?? 0) + 1;
      reentryRefs.push(entry.ref);
    }
  }
  const repeatedLoops = Object.keys(reentries).filter((phase) => reentries[phase] >= REPEAT_THRESHOLD).sort();
  const requiredPhases = ctx.declaration ? ctx.declaration.value["required_phases"] as string[] : [];
  const entered = new Set(entries.map((entry) => scalar(entry.value, "phase")));
  // A skip needs the frozen graph cursor carried by the final close row; an earlier
  // (phase_concluded or superseded close) cursor is not final history, so the gap stays unconfirmed.
  const finalClose = ctx.events.filter((event) => categoryOf(event.value) === "close").sort((a, b) => b.line - a.line)[0] ?? null;
  const cursor = ctx.sidecars.find((item) => item.schema === "guild.phase_cursor.v1" && item.carrier.ref === finalClose?.ref) ?? null;
  const closed = ctx.declaration !== null && ctx.closeRefs.length > 0;
  const missing = closed ? sortedUnique(requiredPhases.filter((phase) => !entered.has(phase))) : [];
  const skipped = cursor ? missing.filter((phase) => (cursor.value["bypassed_phases"] as string[]).includes(phase) ||
    !(cursor.value["visited_phases"] as string[]).includes(phase)) : [];
  const unconfirmed = missing.filter((phase) => !skipped.includes(phase));
  for (const phase of skipped) {
    findings.push({ kind: "workflow_churn", severity: "medium", summary: `Required phase ${phase} was never entered before the run closed.`, evidence_refs: sortedUnique([ctx.declaration!.ref, ...ctx.closeRefs, cursor!.ref, cursor!.carrier.ref]), signature: `skipped-phase:${phase}` });
  }
  const proposals = ctx.groups.filter((group) => groupHas(group, ["recommendation_created"]));
  const repeatedProposals = new Map<string, string[]>();
  const lastProposal = new Map<string, ActionGroup>();
  for (const group of proposals) {
    const signature = groupField(group, "signature")!;
    const prior = lastProposal.get(signature);
    lastProposal.set(signature, group);
    if (!prior || ctx.groups.some((candidate) => candidate.line > prior.line && candidate.line < group.line && groupHas(candidate, INPUT_CHANGE_CLASSES))) continue;
    repeatedProposals.set(signature, sortedUnique([...(repeatedProposals.get(signature) ?? []), ...prior.refs, ...group.refs]));
  }
  const dimensionStates = {
    loops: loopRows.length > 0 ? "observed" : "unobservable",
    phases: entries.length > 0 && exits.length > 0 ? "observed" : "unobservable",
    skipped_phases: closed && cursor ? "observed" : "unobservable",
    proposals: proposals.length > 0 ? "observed" : "unobservable",
  };
  const observed = Object.values(dimensionStates).includes("observed");
  return {
    result: result("workflow_churn", observed ? "observed" : "unobservable", {
      cap_hits: capRefs.length,
      phase_reentries: Object.fromEntries(Object.entries(reentries).sort(([a], [b]) => a.localeCompare(b))),
      repeated_phase_loops: repeatedLoops,
      skipped_required_phases: skipped,
      unconfirmed_missing_phases: unconfirmed,
      repeated_proposals: [...repeatedProposals.keys()].sort(),
      dimension_states: dimensionStates,
    }, [...capRefs, ...(repeatedLoops.length > 0 ? reentryRefs : []), ...findings.flatMap((item) => item.evidence_refs), ...[...repeatedProposals.values()].flat()],
    observed ? null : "missing_phase_loop_or_proposal_evidence"),
    findings,
  };
}

function detectKnowledgeMemory(ctx: DetectorContext, proofs: ProofVerdict[]): DetectorOutput {
  const consumed = new Set(proofs.filter((proof) => proof.valid && proof.sidecar.value["result"] === "passed")
    .flatMap((proof) => proof.sidecar.value["evidence_refs"] as string[]));
  const refs: string[] = [];
  const summary = (kind: "knowledge" | "memory") => {
    const lookups = ctx.groups.filter((group) => groupHas(group, [`${kind}_lookup_started`, `${kind}_lookup_result`])).length;
    const outcomes = ctx.sidecars.filter((item) => item.schema === "guild.lookup_result.v1" && classOf(item.carrier) === `${kind}_lookup_result`);
    const hits = outcomes.filter((item) => item.value["outcome"] === "hit");
    const links = hits.filter((item) => consumed.has(String(item.value["result_ref"])));
    refs.push(...links.flatMap((item) => [item.ref, item.carrier.ref, String(item.value["result_ref"])]));
    return { lookups, typed_results: outcomes.length, hits: hits.length, misses: outcomes.length - hits.length, use_links: links.length };
  };
  const knowledge = summary("knowledge");
  const memory = summary("memory");
  const links = knowledge.use_links + memory.use_links;
  const typed = knowledge.typed_results + memory.typed_results;
  const lookups = knowledge.lookups + memory.lookups;
  const state: DetectorState = links > 0 ? "observed" : typed > 0 ? "ambiguous" : "unobservable";
  return {
    result: result("knowledge_memory", state, { knowledge, memory }, refs,
      state === "observed" ? null : typed > 0 ? "no_result_consumption_link" : lookups > 0 ? "no_typed_lookup_outcome" : "no_lookup_evidence"),
  };
}

function detectToolCoverage(ctx: DetectorContext): DetectorOutput & { supportedOnly: SupportedRecommendation[]; unowned: number } {
  const toolGroups = ctx.groups.filter((group) => group.rows.some((row) => categoryOf(row.value) === "tool"));
  const denials: Record<string, number> = Object.fromEntries(DENIAL_CAUSES.map((cause) => [cause, 0]));
  const outcomes = { ok: 0, failed: 0, denied: 0, started_only: 0 };
  const attempts = new Map<string, ActionGroup[]>();
  for (const group of toolGroups) {
    const denial = rowsOf(group, ["tool_call_denied"])[0];
    if (denial) {
      outcomes.denied++;
      const cause = String(denial.value["signature"]).split(":", 1)[0];
      denials[cause] = (denials[cause] ?? 0) + 1;
      // Policy/user refusal and host unavailability are permission outcomes, never a missing capability.
      if (cause !== "capability_absent") continue;
    } else if (group.rows.some(isFailureRow)) outcomes.failed++;
    else if (groupHas(group, ["tool_call_finished"]) || group.rows.some((row) => row.value["event"] === "tool_call")) { outcomes.ok++; continue; }
    else { outcomes.started_only++; continue; }
    const key = toolActionKey(group);
    if (key !== null) attempts.set(key, [...(attempts.get(key) ?? []), group]);
  }
  const evidence = ctx.sidecars.filter((item) => item.schema === "guild.capability_evidence.v1");
  const candidates: Array<Record<string, unknown>> = [];
  const supported: SupportedRecommendation[] = [];
  const findings: Array<Omit<AnalysisFinding, "id">> = [];
  const supportedOnly: SupportedRecommendation[] = [];
  const owned = new Set<string>();
  for (const item of evidence) {
    const signature = String(item.value["action_signature"]);
    const groups = attempts.get(signature) ?? [];
    if (!groups.some((group) => group.refs.includes(item.carrier.ref))) continue;
    owned.add(signature);
    const owner = item.value["owner"] as RecommendationScope;
    const capability = String(item.value["capability_kind"]);
    const target = String(item.value["target"]);
    const refs = sortedUnique([...groups.flatMap((group) => group.refs), item.ref, ...(item.value["evidence_refs"] as string[])]);
    if (groups.length < REPEAT_THRESHOLD) continue;
    if (capability === "plugin_invariant") {
      supportedOnly.push({ scope: "plugin", kind: "bug_report", target, severity: "high", summary: `Plugin-owned invariant ${target} failed during action ${signature}.`, evidence_refs: refs });
      continue;
    }
    const kind = owner === "project" ? PROJECT_CAPABILITY_KINDS[capability] : PLUGIN_CAPABILITY_KINDS[capability];
    candidates.push({ action_signature: signature, owner, capability_kind: capability, target, attempts: groups.length });
    const summary = `Action ${signature} failed ${groups.length} times and typed evidence names missing ${owner} capability ${target}.`;
    supported.push({ scope: owner, kind, target, severity: "medium", summary, evidence_refs: refs });
    findings.push({ kind: "tool_gap", severity: "medium", summary, evidence_refs: refs, signature: `tool-gap:${owner}:${capability}:${target}` });
  }
  const unowned = [...attempts.keys()].filter((key) => !owned.has(key)).length;
  return {
    result: result("tool_coverage", toolGroups.length > 0 ? "observed" : "unobservable", {
      actions: toolGroups.length, outcomes, denials,
      gap_candidates: candidates.sort((a, b) => String(a["action_signature"]).localeCompare(String(b["action_signature"]))),
      gap_cause: candidates.length > 0 ? "observed" : "unobservable",
    }, [...findings.flatMap((item) => item.evidence_refs), ...toolGroups.filter((group) => groupHas(group, ["tool_call_denied"])).flatMap((group) => group.refs)],
    toolGroups.length > 0 ? null : "no_tool_actions"),
    findings,
    supported,
    supportedOnly,
    unowned,
  };
}

function detectOutcomeQuality(ctx: DetectorContext): DetectorOutput {
  const records = ctx.sidecars.filter((item) => item.schema === "guild.outcome_record.v1");
  const bound = records.filter((item) => boundInput(ctx, item.value["verified_input_hash"], undefined).bound &&
    ((item.value["result"] === "passed" && item.carrier.value["status"] === "ok") || (item.value["result"] === "failed" && item.carrier.value["status"] === "error")));
  const latest = (kind: string): string => {
    const match = bound.filter((item) => item.value["kind"] === kind).sort((a, b) => b.carrier.line - a.carrier.line)[0];
    return match ? String(match.value["result"]) : "unknown";
  };
  const reopen = bound.length > 0 ? Math.max(...bound.map((item) => Number(item.value["reopen_transitions"]))) : null;
  const complete = bound.length > 0 && bound.every((item) => item.value["findings_complete"] === true);
  const residual = complete ? sortedUnique(bound.flatMap((item) => item.value["unresolved_finding_ids"] as string[])) : null;
  const state: DetectorState = bound.length > 0 ? "observed" : records.length > 0 ? "ambiguous" : "unobservable";
  return {
    result: result("outcome_quality", state, {
      review: latest("review"), verify: latest("verify"), reopen_transitions: reopen, reopened: reopen === null ? null : reopen >= 1,
      residual_finding_ids: residual, residual_count: residual === null ? null : residual.length, unbound_records: records.length - bound.length,
    }, bound.flatMap((item) => [item.ref, item.carrier.ref]),
    state === "observed" ? null : state === "ambiguous" ? "unbound_verifier_input" : "no_typed_outcome_records"),
  };
}

function usageOutlierSingle(availability: Record<UsageMetric, UsageMetricAvailability>): DetectorOutput {
  return {
    result: result("usage_outlier", "unobservable", {
      availability: Object.fromEntries(USAGE_METRICS.map((metric) => [metric, availability[metric].state])),
    }, [], "requires_comparison_cohort"),
  };
}

/** Per-metric availability (C-ANALYSIS). Refs follow the same span dedupe as the v1 totals. */
function usageAvailability(events: readonly LoadedEvent[], groups: readonly ActionGroup[], eligible: boolean): Record<UsageMetric, UsageMetricAvailability> {
  const semanticSpans = new Set(events.filter(({ value }) => value["schema_version"] === "guild.trace.analysis.v2")
    .map(({ value }) => scalar(value, "span_id")).filter((value): value is string => value !== null));
  const counted = new Set(events.filter(({ value }) => {
    const span = scalar(value, "span_id");
    return value["schema_version"] === "guild.trace.analysis.v2" || !span || !semanticSpans.has(span);
  }).map((event) => event.ref));
  const explicit = (event: LoadedEvent, metric: UsageMetric): boolean => {
    const tokens = asRecord(event.value["tokens"]);
    const has = (value: unknown): boolean => typeof value === "number" && Number.isFinite(value) && value >= 0;
    if (metric === "input") return has(tokens["input"]) || has(event.value["tokens_in"]);
    if (metric === "output") return has(tokens["output"]) || has(event.value["tokens_out"]);
    if (metric === "duration_ms") return has(event.value["duration_ms"]) || has(event.value["latency_ms"]);
    return has(tokens[metric]);
  };
  const tokenBoundary = (group: ActionGroup): boolean => groupHas(group, ["agent_response_received"]) ||
    group.rows.some((row) => row.value["tokens"] !== undefined || row.value["tokens_in"] !== undefined || row.value["tokens_out"] !== undefined);
  const durationBoundary = (group: ActionGroup): boolean => groupHas(group, ["tool_call_finished", "tool_call_failed"]) ||
    group.rows.some((row) => row.value["event"] === "tool_call" || row.value["event"] === "phase_end");
  return Object.fromEntries(USAGE_METRICS.map((metric) => {
    const refs = sortedUnique(events.filter((event) => counted.has(event.ref) && explicit(event, metric)).map((event) => event.ref));
    const boundaries = groups.filter(metric === "duration_ms" ? durationBoundary : tokenBoundary);
    const covered = boundaries.length > 0 && boundaries.every((group) => group.rows.some((row) => counted.has(row.ref) && explicit(row, metric)));
    const state: UsageMetricAvailability["state"] = refs.length === 0 ? "unobserved" : eligible && covered ? "complete" : "partial";
    return [metric, { state, evidence_refs: refs, missing_reason: state === "complete" ? null : "incomplete_observation" }];
  })) as Record<UsageMetric, UsageMetricAvailability>;
}

function knownIdentity(values: Array<string | null>): string | null {
  const known = sortedUnique(values.filter((value): value is string => value !== null && value !== "unknown"));
  return known.length === 1 && values.every((value) => value === null || value === known[0]) ? known[0] : null;
}

function analysisCohort(manifest: Record<string, unknown>, provenanceRaw: string, configSnapshot: Record<string, unknown> | null, events: readonly LoadedEvent[]): AnalysisCohort {
  let provenance: Record<string, unknown> = {};
  try { provenance = asRecord(JSON.parse(provenanceRaw)); } catch { /* absent or malformed provenance names no model */ }
  const inspections = events.filter(({ value }) => value["schema_version"] === "guild.trace.model_inspection.v1" && value["identity_trust"] === "verified")
    .map(({ value }) => scalar(value, "actual_model"));
  const modelSources = [scalar(provenance, "model"), ...inspections].filter((value): value is string => value !== null);
  return {
    run_class: scalar(manifest, "run_class"),
    model: modelSources.length > 0 ? knownIdentity(modelSources) : null,
    provider: knownIdentity([scalar(provenance, "provider")]),
    config_hash: configSnapshot ? `sha256:${sha256(canonicalJson({ effective: configSnapshot["effective"], plugin: configSnapshot["plugin"] }))}` : null,
  };
}

function inputManifestHash(entries: readonly InputManifestEntry[]): string {
  return `sha256:${sha256(canonicalJson(entries))}`;
}

/**
 * G04 R4: a decoder loop is ONE agent output that repeats a unit (a token or a
 * phrase of up to RUNAWAY_MAX_UNIT code points, carrying a letter or digit) at
 * least RUNAWAY_MIN_REPEATS times back to back over RUNAWAY_MIN_SPAN code
 * points. The text is the Agent tool_call row's redacted result excerpt.
 * Every period is scanned from every position (no match consumption), so a
 * short inner repeat can never hide a longer loop. Returns the unit, or null.
 * Distinct from repeated_failure, which counts repeated failed ACTIONS.
 */
const RUNAWAY_MAX_UNIT = 60;
const RUNAWAY_MIN_REPEATS = 10;
const RUNAWAY_MIN_SPAN = 200;
function runawayRepetitionUnit(text: string): string | null {
  const cp = Array.from(text);
  for (let period = 1; period <= RUNAWAY_MAX_UNIT; period++) {
    let runStart = 0;
    for (let i = 0; i + period <= cp.length; i++) {
      if (i + period < cp.length && cp[i] === cp[i + period]) continue;
      // cp[runStart .. i + period) is periodic with this period.
      const span = i + period - runStart;
      if (span >= RUNAWAY_MIN_SPAN && span >= period * RUNAWAY_MIN_REPEATS) {
        const unit = cp.slice(runStart, runStart + period).join("");
        if (/[\p{L}\p{N}]/u.test(unit)) return unit;
      }
      runStart = i + 1;
    }
  }
  return null;
}

function detectFindings(analysisId: string, events: LoadedEvent[], groups: readonly ActionGroup[]): AnalysisFinding[] {
  const findings: AnalysisFinding[] = [];
  const failures = new Map<string, ActionGroup[]>();
  const steering: ActionGroup[] = [];
  for (const group of groups) {
    if (group.rows.some(isFailureRow)) {
      // B01-F4: span twins are one attempt; an unsigned failure is never keyed as "undefined|undefined|undefined".
      const signature = failureSignature(group);
      if (signature !== null) failures.set(signature, [...(failures.get(signature) ?? []), group]);
    }
    for (const row of rowsOf(group, ["instruction_violation_detected"]).slice(0, 1)) {
      findings.push(finding(analysisId, "instruction_violation", "high", "The trace records an instruction violation.", group.refs, scalar(row.value, "signature") ?? "instruction-violation"));
    }
    // A tool denial is an observed permission outcome (diagnostics.tool_coverage), never an automatic tool_gap.
    for (const row of rowsOf(group, ["loop_cap_hit"]).slice(0, 1)) {
      findings.push(finding(analysisId, "workflow_churn", "medium", "A workflow loop reached its cap.", group.refs, scalar(row.value, "signature") ?? "loop-cap"));
    }
    if (groupHas(group, ["user_steering_received"])) steering.push(group);
  }
  for (const event of events) {
    const excerpt = event.value["event"] === "tool_call" && event.value["tool"] === "Agent" ? event.value["result_excerpt_redacted"] : null;
    const unit = typeof excerpt === "string" ? runawayRepetitionUnit(excerpt) : null;
    if (unit === null) continue;
    findings.push(finding(
      analysisId,
      "runaway_repetition",
      "high",
      "An agent output repeated the same text back to back (decoder loop).",
      [event.ref],
      `runaway_repetition:Agent:${sha256(unit).slice(0, 12)}`,
    ));
  }
  for (const [signature, attempts] of [...failures.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (attempts.length >= REPEAT_THRESHOLD) {
      findings.push(finding(analysisId, "repeated_failure", "high", `The same failed action recurred ${attempts.length} times.`, attempts.flatMap((group) => group.refs), signature));
    }
  }
  if (steering.length >= REPEAT_THRESHOLD) {
    findings.push(finding(
      analysisId,
      "prompt_inefficiency",
      "medium",
      `The run required ${steering.length} user steering interventions.`,
      steering.flatMap((group) => group.refs),
      "repeated-user-steering",
    ));
  }
  return findings.sort((a, b) => a.id.localeCompare(b.id));
}

function routingForScope(scope: RecommendationScope): RecommendationRouting {
  return scope === "plugin"
    ? { action: "ask_user_before_filing", requires_user_approval: true, target: "guild-plugin" }
    : { action: "queue_proposal_only", requires_user_approval: true, target: "project-local" };
}

function recommendationRoutingFields(scope: RecommendationScope): Pick<Recommendation, "suggested_owner" | "next_action" | "requires_user_approval" | "routing"> {
  const routing = routingForScope(scope);
  return {
    suggested_owner: scope === "plugin" ? "guild-plugin" : "project",
    next_action: routing.action,
    requires_user_approval: true,
    routing,
  };
}

function recommendationsFor(analysisId: string, runId: string, findings: AnalysisFinding[], supported: readonly SupportedRecommendation[] = []): Recommendation[] {
  // v1 routing for v1 finding kinds is unchanged. tool_gap findings now exist only
  // with typed ownership evidence, so their scope/kind come from that evidence.
  const v1 = findings.filter((item) => item.kind !== "tool_gap").map((item) => {
    const scope: RecommendationScope = item.kind === "telemetry_gap" ? "plugin" : "project";
    const kind: RecommendationKind = item.kind === "repeated_failure" ? "clarify_prompt_contract" :
      item.kind === "telemetry_gap" ? "telemetry_gap" : "update_workflow";
    return { scope, kind, severity: item.severity, summary: item.summary, evidence_refs: item.evidence_refs };
  });
  const seen = new Set<string>();
  return [...v1, ...supported].map((item) => {
    const refs = sortedUnique(item.evidence_refs);
    const signature = evidenceSignature(item.scope, item.kind, refs);
    return {
      schema_version: "guild.recommendation.v1",
      id: stableId("rec", signature),
      source_id: runId,
      source_analysis_id: analysisId,
      scope: item.scope,
      kind: item.kind,
      confidence: refs.length >= 2 ? "high" : "medium",
      severity: item.severity,
      evidence_refs: refs,
      evidence_signature: signature,
      affected_runs: [runId],
      proposed_action: item.summary,
      status: "proposed",
      ...recommendationRoutingFields(item.scope),
    } as Recommendation;
  }).filter((item) => !seen.has(item.evidence_signature) && seen.add(item.evidence_signature) !== undefined)
    .sort((a, b) => a.id.localeCompare(b.id));
}

function assessment(observableRefs: string[], violatedRefs: string[] = []): { status: AssessmentStatus; evidence_refs: string[] } {
  if (observableRefs.length === 0) return { status: "unobservable", evidence_refs: [] };
  if (violatedRefs.length > 0) return { status: "violated", evidence_refs: [...new Set([...observableRefs, ...violatedRefs])].sort() };
  // Observability alone is not positive proof. Only the C-DETECTORS typed-proof
  // aggregate (complete declared set, every instruction proved) may be satisfied.
  return { status: "ambiguous", evidence_refs: observableRefs.slice().sort() };
}

interface RunInputs {
  dir: string;
  manifest: Record<string, unknown>;
  provenanceRaw: string;
  configRef: string | null;
  configSnapshot: Record<string, unknown> | null;
  events: LoadedEvent[];
  parseErrors: number;
  invalidRecords: number;
  sourceHash: string;
  store: Map<string, AdditiveInput>;
  sidecars: Sidecar[];
  declaration: Sidecar | null;
  declarationReason: string | null;
}

/** Load core (source_hash-bound) and additive (input_hash-bound) inputs without running detectors. */
function collectRunInputs(root: string, runId: string): RunInputs {
  const dir = runDir(root, runId);
  const runFile = resolveRunInputFile(dir, "run.yaml");
  const runRaw = runFile ? readText(runFile) : null;
  if (runRaw === null) throw new Error(`run ${runId} has no run.yaml`);
  const manifest = asRecord(parseYaml(runRaw));
  const { events, raw: eventsRaw, parseErrors, invalidRecords } = loadEvents(root, runId);
  const configRef = scalar(manifest, "config_snapshot_ref");
  const configPath = configRef ? resolveRunInputFile(dir, configRef) : null;
  const provenancePath = resolveRunInputFile(dir, "provenance.json");
  const provenanceRaw = provenancePath ? readText(provenancePath) ?? "" : "";
  const sourceHash = sha256(runRaw + "\n" + provenanceRaw + "\n" + (configPath ? readText(configPath) ?? "" : "") + "\n" + eventsRaw);
  const store = new Map<string, AdditiveInput>();
  const sidecars = readSidecars(store, dir, runId, events);
  const declarations = sidecars.filter((item) => item.schema === "guild.analysis_declaration.v1");
  let declaration: Sidecar | null = null;
  let declarationReason: string | null = null;
  if (new Set(declarations.map((item) => canonicalJson(item.value))).size > 1) declarationReason = "conflicting_instruction_declarations";
  else if (declarations.length > 0) {
    const assessed = readAdditiveInput(store, dir, runId, declarations[0].value["assessed_input_ref"]);
    if (assessed.bytes !== null && assessed.entry.sha256 === declarations[0].value["assessed_input_hash"]) declaration = declarations[0];
    else declarationReason = "assessed_input_unbound";
  }
  return {
    dir, manifest, provenanceRaw, configRef, configSnapshot: readConfigSnapshot(configPath, runId),
    events, parseErrors, invalidRecords, sourceHash, store, sidecars, declaration, declarationReason,
  };
}

function manifestEntries(store: Map<string, AdditiveInput>): InputManifestEntry[] {
  return [...store.values()].map(({ entry }) => ({ ref: entry.ref, sha256: entry.sha256, status: entry.status })).sort((a, b) => a.ref.localeCompare(b.ref));
}

export function analyzeRun(root: string, runId: string): RunAnalysis {
  const inputs = collectRunInputs(root, runId);
  const { manifest, events, parseErrors, invalidRecords, sourceHash, configRef } = inputs;
  const scope = scalar(manifest, "run_scope");
  const initiativeId = scalar(manifest, "initiative_attachment");
  const independentGroup = scalar(manifest, "independent_run_group");
  const runScope = scope === "initiative" || scope === "independent"
    ? scope
    : initiativeId !== null ? "initiative" : "unknown";
  const configExists = inputs.configSnapshot !== null;
  const identityComplete = runScope !== "unknown" &&
    (runScope === "initiative" ? initiativeId !== null : independentGroup !== null);
  const categories = new Set(events.map((event) => categoryOf(event.value)).filter((value): value is EvidenceCategory => value !== null));
  const missing: string[] = REQUIRED_COVERAGE.filter((category) => !categories.has(category));
  if (!identityComplete) missing.unshift("run identity");
  if (!configExists) missing.unshift("plugin-config-snapshot.json");
  if (parseErrors > 0) missing.push("trace parseability");
  if (invalidRecords > 0) missing.push("trace validity");
  const present = [
    ...(identityComplete ? ["run identity"] : []),
    ...(configExists ? ["plugin-config-snapshot.json"] : []),
    ...(parseErrors === 0 ? ["trace parseability"] : []),
    ...(invalidRecords === 0 ? ["trace validity"] : []),
    ...REQUIRED_COVERAGE.filter((category) => categories.has(category)),
  ];
  const denominator = COMPLETENESS_REQUIREMENTS.length;
  const score = Math.round((present.length / denominator) * 100);
  const analysisId = `analysis:${runId}:${sourceHash.slice(0, 12)}`;
  const groups = actionGroups(events, runId);
  const findings = detectFindings(analysisId, events, groups);
  if (missing.length > 0) {
    findings.push(finding(
      analysisId,
      "telemetry_gap",
      "medium",
      `Analysis evidence is incomplete: ${[...new Set(missing)].sort().join(", ")}.`,
      [`.guild/runs/${runId}/run.yaml`],
      `missing:${[...new Set(missing)].sort().join("|")}`,
    ));
  }
  const instructionRefs = [...evidenceFor(events, "prompt"), ...evidenceFor(events, "gate")];
  const violationRefs = findings.filter((item) => item.kind === "instruction_violation").flatMap((item) => item.evidence_refs);
  const promptRefs = evidenceFor(events, "prompt");
  const workflowRefs = [...evidenceFor(events, "phase"), ...evidenceFor(events, "loop"), ...evidenceFor(events, "gate")];
  const toolRefs = evidenceFor(events, "tool");
  // Historical manifests may omit run_class. Treat every run as a full run
  // unless it explicitly declares the lightweight status-only contract; an
  // absent field must never bypass the evidence-completeness gate.
  const isLightweight = manifest["run_class"] === "lightweight";
  const eligible = isLightweight ||
    (identityComplete && configExists && parseErrors === 0 && invalidRecords === 0 && REQUIRED_COVERAGE.every((category) => categories.has(category)));

  const ctx: DetectorContext = {
    runId, events, groups, sidecars: inputs.sidecars, declaration: inputs.declaration, declarationReason: inputs.declarationReason,
    store: inputs.store, dir: inputs.dir, eligible,
    closeRefs: events.filter((event) => categoryOf(event.value) === "close").map((event) => event.ref),
    instructionObservableRefs: instructionRefs, v1ViolationRefs: violationRefs,
  };
  const usage = tokenUsage(events);
  const availability = usageAvailability(events, groups, eligible);
  const instruction = detectInstructionFollowing(ctx);
  const proofs = instructionProofs(ctx);
  const tools = detectToolCoverage(ctx);
  const outputs: DetectorOutput[] = [
    instruction,
    detectRepeatedMistake(ctx, proofs),
    detectSteering(ctx),
    detectClarification(ctx),
    detectRedundantPrompt(ctx),
    usageOutlierSingle(availability),
    detectPromptActionLatency(ctx),
    detectWorkflowChurn(ctx),
    detectKnowledgeMemory(ctx, proofs),
    tools,
    detectOutcomeQuality(ctx),
  ];
  const supported = [...tools.supported ?? [], ...tools.supportedOnly];
  const unownedFailures = groups.filter((group) => group.rows.some(isFailureRow)).length -
    new Set(supported.flatMap((item) => groups.filter((group) => group.rows.some(isFailureRow) && group.refs.some((ref) => item.evidence_refs.includes(ref))))).size;
  const scopeState: DetectorState = supported.length > 0 ? "observed" : unownedFailures > 0 ? "ambiguous" : "unobservable";
  outputs.push({
    result: result("recommendation_scope", scopeState, {
      supported: supported.map((item) => ({ scope: item.scope, kind: item.kind, target: item.target }))
        .sort((a, b) => `${a.scope}|${a.kind}|${a.target}`.localeCompare(`${b.scope}|${b.kind}|${b.target}`)),
      unowned_failed_actions: unownedFailures,
    }, supported.flatMap((item) => item.evidence_refs),
    scopeState === "observed" ? null : scopeState === "ambiguous" ? "unowned_action_failure" : "no_ownership_evidence"),
  });
  if (eligible) {
    for (const extra of outputs.flatMap((output) => output.findings ?? [])) {
      findings.push(finding(analysisId, extra.kind, extra.severity, extra.summary, extra.evidence_refs, extra.signature));
    }
  }
  const uniqueFindings = [...new Map(findings.map((item) => [item.id, item])).values()].sort((a, b) => a.id.localeCompare(b.id));
  const inputManifest = manifestEntries(inputs.store);
  const instructionAssessment = !eligible ? { status: "unobservable" as const, evidence_refs: [] }
    : instruction.aggregate === "satisfied" ? { status: "satisfied" as const, evidence_refs: sortedUnique([...instructionRefs, ...instruction.satisfiedRefs]) }
      : assessment(instructionRefs, [...violationRefs, ...instruction.typedViolationRefs]);
  return {
    schema_version: "guild.run_analysis.v1",
    analysis_id: analysisId,
    run_id: runId,
    source_hash: sourceHash,
    eligible,
    identity: {
      run_scope: runScope,
      initiative_id: initiativeId,
      independent_group_id: independentGroup,
      config_snapshot_ref: configRef,
      host: scalar(asRecord(manifest["host"]), "resolved") ?? "unknown",
      phase: scalar(manifest, "phase"),
    },
    completeness: { score, present: present.sort(), missing: [...new Set(missing)] },
    assessments: {
      instruction_following: instructionAssessment,
      prompt_efficiency: eligible ? assessment(promptRefs) : { status: "unobservable", evidence_refs: [] },
      workflow: eligible ? assessment(workflowRefs) : { status: "unobservable", evidence_refs: [] },
      tool_coverage: eligible ? assessment(toolRefs) : { status: "unobservable", evidence_refs: [] },
    },
    usage: { ...usage, availability },
    findings: uniqueFindings,
    recommendations: recommendationsFor(analysisId, runId, uniqueFindings, eligible ? supported : []),
    diagnostics: {
      contract: DIAGNOSTICS_CONTRACT,
      input_manifest: inputManifest,
      input_hash: inputManifestHash(inputManifest),
      cohort: analysisCohort(manifest, inputs.provenanceRaw, inputs.configSnapshot, events),
      results: outputs.map((output) => output.result).sort((a, b) => a.detector.localeCompare(b.detector)),
      instruction_checks: instruction.checks,
    },
  };
}

/** Strict shape of the cached core: a truncated or hand-edited artifact never counts as a hit. */
function cachedCoreWellFormed(cached: Record<string, unknown>): boolean {
  const strings = (value: unknown): boolean => arrayOf(value, (item) => typeof item === "string");
  const count = (value: unknown): boolean => typeof value === "number" && Number.isFinite(value) && value >= 0;
  const assessments = asRecord(cached["assessments"]);
  const completeness = asRecord(cached["completeness"]);
  const usage = asRecord(cached["usage"]);
  const tokens = asRecord(usage["tokens"]);
  const availability = asRecord(usage["availability"]);
  const identity = asRecord(cached["identity"]);
  const nullableString = (value: unknown): boolean => value === null || nonEmptyString(value);
  return typeof cached["eligible"] === "boolean" &&
    hasOnlyKeys(identity, new Set(["run_scope", "initiative_id", "independent_group_id", "config_snapshot_ref", "host", "phase"])) &&
    typeof identity["run_scope"] === "string" && ["initiative", "independent", "unknown"].includes(identity["run_scope"]) && nullableString(identity["initiative_id"]) &&
    nullableString(identity["independent_group_id"]) && nullableString(identity["config_snapshot_ref"]) &&
    nonEmptyString(identity["host"]) && nullableString(identity["phase"]) &&
    arrayOf(cached["findings"], (item) => {
      const finding = item !== null && typeof item === "object" && !Array.isArray(item) ? item as Record<string, unknown> : null;
      return finding !== null && hasOnlyKeys(finding, new Set(["id", "kind", "severity", "summary", "evidence_refs", "signature"])) &&
        nonEmptyString(finding["id"]) && typeof finding["kind"] === "string" && FINDING_KINDS.has(finding["kind"]) && typeof finding["severity"] === "string" && SEVERITY_VALUES.has(finding["severity"]) &&
        typeof finding["summary"] === "string" && stringArray(finding["evidence_refs"]) && nonEmptyString(finding["signature"]);
    }) &&
    hasOnlyKeys(assessments, new Set(["instruction_following", "prompt_efficiency", "workflow", "tool_coverage"])) &&
    ["instruction_following", "prompt_efficiency", "workflow", "tool_coverage"].every((key) => {
      const item = asRecord(assessments[key]);
      return typeof item["status"] === "string" && ["satisfied", "violated", "ambiguous", "unobservable"].includes(item["status"]) && strings(item["evidence_refs"]);
    }) &&
    typeof completeness["score"] === "number" && completeness["score"] >= 0 && completeness["score"] <= 100 &&
    strings(completeness["present"]) && strings(completeness["missing"]) &&
    count(usage["llm_event_count"]) && strings(usage["specialists_dispatched"]) && count(usage["duration_ms"]) &&
    ["input", "output", "cached", "total", "cost_usd"].every((key) => count(tokens[key])) &&
    USAGE_METRICS.every((metric) => {
      const item = asRecord(availability[metric]);
      return typeof item["state"] === "string" && ["complete", "partial", "unobserved"].includes(item["state"]) && strings(item["evidence_refs"]);
    });
}

export interface CachedRunAnalysis {
  analysis: RunAnalysis;
  cache: "hit" | "recomputed";
  reason: null | "missing" | "legacy_diagnostics" | "stale_source" | "stale_inputs" | "malformed";
}

/**
 * Reuse .guild/analysis/runs/<id>/analysis.json only when it strictly validates
 * and both the current core source_hash and the additive input_hash match the
 * frozen inputs. Anything else recomputes through analyzeRun (no stale reuse).
 */
export function loadOrAnalyzeRun(root: string, runId: string): CachedRunAnalysis {
  assertSafeId(runId, "run id");
  const inputs = collectRunInputs(root, runId);
  const currentInputHash = inputManifestHash(manifestEntries(inputs.store));
  const file = path.join(durableGuildDir(root), "analysis", "runs", runId, "analysis.json");
  const raw = readExistingContainedText(root, file);
  const recompute = (reason: CachedRunAnalysis["reason"]): CachedRunAnalysis => ({ analysis: analyzeRun(root, runId), cache: "recomputed", reason });
  if (raw === null) return recompute("missing");
  let cached: Record<string, unknown>;
  try { cached = asRecord(JSON.parse(raw)); } catch { return recompute("malformed"); }
  if (cached["schema_version"] !== "guild.run_analysis.v1" || cached["run_id"] !== runId ||
      typeof cached["source_hash"] !== "string" || cached["analysis_id"] !== `analysis:${runId}:${String(cached["source_hash"]).slice(0, 12)}` ||
      !Array.isArray(cached["recommendations"])) return recompute("malformed");
  try { (cached["recommendations"] as unknown[]).forEach((item, index) => assertRecommendation(item, `cached recommendation ${index + 1}`)); }
  catch { return recompute("malformed"); }
  const diagnostics = asRecord(cached["diagnostics"]);
  if (diagnostics["contract"] !== DIAGNOSTICS_CONTRACT || !Array.isArray(diagnostics["input_manifest"]) || !Array.isArray(diagnostics["results"])) {
    return recompute(cached["diagnostics"] === undefined ? "legacy_diagnostics" : "malformed");
  }
  if (!cachedCoreWellFormed(cached)) return recompute("malformed");
  if (diagnostics["input_hash"] !== inputManifestHash(diagnostics["input_manifest"] as InputManifestEntry[])) return recompute("malformed");
  if (cached["source_hash"] !== inputs.sourceHash) return recompute("stale_source");
  if (diagnostics["input_hash"] !== currentInputHash) return recompute("stale_inputs");
  return { analysis: cached as unknown as RunAnalysis, cache: "hit", reason: null };
}

export type ArtifactInspectionKind = "run" | "comparison";
export type ArtifactInspectionState = "current" | "stale" | "missing" | "unsupported" | "refused";
export interface ArtifactInspection {
  ok: boolean;
  state: ArtifactInspectionState;
  kind: ArtifactInspectionKind;
  source_id: string;
  artifact_ref: string | null;
  schema_version: string | null;
  source_analysis_id: string | null;
  source_hash: string | null;
  current_source_hash: string | null;
  input_hash: string | null;
  current_input_hash: string | null;
  /** True only for a current artifact with a supported diagnostics contract: the browser-decision precondition. */
  eligible: boolean;
  reason: string | null;
}

const INPUT_HASH_FORMAT = /^sha256:[a-f0-9]{64}$/;
const SOURCE_HASH_FORMAT = /^[a-f0-9]{64}$/;
const ANALYSIS_ID_FORMAT = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,255}$/;

class InspectionRefusal extends Error {
  constructor(readonly reason: string) { super(reason); }
}

function inspectionRefusal(reason: string): never {
  throw new InspectionRefusal(reason);
}

/** Current core + additive hashes through the analyzer's own input collector; null when the run is gone. */
function currentRunHashes(root: string, runId: string): { sourceHash: string; inputHash: string } | null {
  const runs = path.join(durableGuildDir(path.resolve(root)), "runs");
  try { fs.lstatSync(path.join(runs, runId)); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    inspectionRefusal("unsafe_source_inputs");
  }
  let inputs: RunInputs;
  try { inputs = collectRunInputs(root, runId); } catch (error) {
    if (error instanceof Error && /has no run\.yaml/.test(error.message)) return null;
    inspectionRefusal("unsafe_source_inputs");
  }
  // The same verification-input reads boundInput performs during detection, so the manifest matches analyzeRun's.
  for (const proof of inputs.sidecars) {
    if (inputs.declaration && proof.schema === "guild.instruction_evidence.v1" && proof.value["verification_input_ref"] !== undefined &&
        proof.value["verified_input_hash"] === inputs.declaration.value["assessed_input_hash"]) {
      try { readAdditiveInput(inputs.store, inputs.dir, runId, proof.value["verification_input_ref"]); } catch { inspectionRefusal("unsafe_source_inputs"); }
    }
  }
  return { sourceHash: inputs.sourceHash, inputHash: inputManifestHash(manifestEntries(inputs.store)) };
}

/** No-follow read of one analyzer artifact; null when absent, refusal when any component is a symlink or escapes. */
function readArtifactNoFollow(root: string, relative: string): string | null {
  let file: string | null;
  try { file = resolveRunInputFile(path.resolve(root), relative); } catch { inspectionRefusal("unsafe_artifact_path"); }
  if (file === null) return null;
  try { return fs.readFileSync(file, "utf8"); } catch { inspectionRefusal("artifact_unreadable"); }
}

const DETECTOR_STATES = new Set(["observed", "ambiguous", "unobservable"]);
const plainObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

/** Closed shape of one detector result (or comparison dimension); exactly one per DETECTOR_IDS entry. */
function detectorResultsWellFormed(value: unknown, dimension?: { runIds: readonly string[] }): boolean {
  const keys = new Set(["detector", "state", "value", "evidence_refs", "reason", ...(dimension ? ["by_run", "comparable_runs"] : [])]);
  if (!Array.isArray(value) || value.length !== DETECTOR_IDS.length) return false;
  const seen = new Set<string>();
  return value.every((item) => {
    if (!plainObject(item) || !hasOnlyKeys(item, keys) || typeof item["detector"] !== "string" ||
        !(DETECTOR_IDS as readonly string[]).includes(item["detector"]) || seen.has(item["detector"]) ||
        typeof item["state"] !== "string" || !DETECTOR_STATES.has(item["state"]) || !plainObject(item["value"]) ||
        !stringArray(item["evidence_refs"]) || !(item["reason"] === null || typeof item["reason"] === "string")) return false;
    seen.add(item["detector"]);
    if (!dimension) return true;
    const byRun = item["by_run"];
    return plainObject(byRun) && Object.keys(byRun).length === dimension.runIds.length &&
      dimension.runIds.every((id) => {
        const entry = byRun[id];
        return plainObject(entry) && hasOnlyKeys(entry, new Set(["state", "eligible", "value"])) &&
          typeof entry["state"] === "string" && (DETECTOR_STATES.has(entry["state"]) || entry["state"] === "legacy_unknown") &&
          typeof entry["eligible"] === "boolean" && plainObject(entry["value"]);
      }) &&
      arrayOf(item["comparable_runs"], (id) => typeof id === "string" && dimension.runIds.includes(id));
  });
}

function inspectRunArtifact(root: string, runId: string, base: ArtifactInspection, raw: string): ArtifactInspection {
  let cached: Record<string, unknown>;
  try { cached = asRecord(JSON.parse(raw)); } catch { inspectionRefusal("malformed_artifact"); }
  const schema = cached["schema_version"];
  if (schema !== "guild.run_analysis.v1") return { ...base, state: "unsupported", schema_version: typeof schema === "string" ? schema : null, reason: "unknown_core_schema" };
  const sourceHash = cached["source_hash"];
  if (cached["run_id"] !== runId || typeof sourceHash !== "string" || !SOURCE_HASH_FORMAT.test(sourceHash) ||
      cached["analysis_id"] !== `analysis:${runId}:${sourceHash.slice(0, 12)}` || !Array.isArray(cached["recommendations"])) {
    inspectionRefusal("malformed_artifact");
  }
  try { (cached["recommendations"] as unknown[]).forEach((item, index) => assertRecommendation(item, `recommendation ${index + 1}`)); }
  catch { inspectionRefusal("malformed_artifact"); }
  const current = currentRunHashes(root, runId);
  const recorded: ArtifactInspection = {
    ...base, schema_version: schema, source_analysis_id: cached["analysis_id"] as string, source_hash: sourceHash,
    current_source_hash: current?.sourceHash ?? null, current_input_hash: current?.inputHash ?? null,
  };
  const diagnostics = cached["diagnostics"];
  if (diagnostics === undefined) return { ...recorded, state: "unsupported", reason: "legacy_diagnostics_missing" };
  const contract = asRecord(diagnostics)["contract"];
  if (contract !== DIAGNOSTICS_CONTRACT) {
    const claimed = asRecord(diagnostics)["input_hash"];
    return { ...recorded, input_hash: typeof claimed === "string" && INPUT_HASH_FORMAT.test(claimed) ? claimed : null, state: "unsupported", reason: "unknown_diagnostics_contract" };
  }
  const record = asRecord(diagnostics);
  const manifest = record["input_manifest"];
  const inputHash = record["input_hash"];
  if (!Array.isArray(manifest) || !detectorResultsWellFormed(record["results"]) || typeof inputHash !== "string" ||
      !INPUT_HASH_FORMAT.test(inputHash) || inputHash !== inputManifestHash(manifest as InputManifestEntry[]) || !cachedCoreWellFormed(cached)) {
    inspectionRefusal("malformed_artifact");
  }
  const withInput = { ...recorded, input_hash: inputHash };
  if (current === null) return { ...withInput, state: "stale", reason: "source_inputs_missing" };
  if (current.sourceHash !== sourceHash) return { ...withInput, state: "stale", reason: "stale_source" };
  if (current.inputHash !== inputHash) return { ...withInput, state: "stale", reason: "stale_inputs" };
  return { ...withInput, state: "current", eligible: true, reason: null };
}

function comparisonRunsHash(runs: ReadonlyArray<{ run_id: string; source_hash: string; input_hash: string | null }>): string {
  return `sha256:${sha256(canonicalJson(runs.map(({ run_id, source_hash, input_hash }) => ({ run_id, source_hash, input_hash }))))}`;
}

function inspectComparisonArtifact(root: string, comparisonId: string, base: ArtifactInspection, raw: string): ArtifactInspection {
  let cached: Record<string, unknown>;
  try { cached = asRecord(JSON.parse(raw)); } catch { inspectionRefusal("malformed_artifact"); }
  const schema = cached["schema_version"];
  if (schema !== "guild.run_comparison.v1") return { ...base, state: "unsupported", schema_version: typeof schema === "string" ? schema : null, reason: "unknown_core_schema" };
  const runIds = cached["run_ids"];
  const sourceHashes = cached["source_hashes"];
  if (cached["comparison_id"] !== comparisonId || !arrayOf(runIds, (id) => typeof id === "string" && SAFE_ID.test(id)) ||
      !arrayOf(sourceHashes, (hash) => typeof hash === "string" && SOURCE_HASH_FORMAT.test(hash)) ||
      (runIds as string[]).length < 2 || (runIds as string[]).length !== (sourceHashes as string[]).length ||
      (runIds as string[]).some((id, index, all) => index > 0 && all[index - 1].localeCompare(id) >= 0) ||
      !Array.isArray(cached["recommendations"])) {
    inspectionRefusal("malformed_artifact");
  }
  const ids = runIds as string[];
  const hashes = sourceHashes as string[];
  const material = ids.map((id, index) => `${id}:${hashes[index]}`).join("|");
  if (stableId("comparison", material) !== comparisonId) inspectionRefusal("malformed_artifact");
  try { (cached["recommendations"] as unknown[]).forEach((item, index) => assertRecommendation(item, `recommendation ${index + 1}`)); }
  catch { inspectionRefusal("malformed_artifact"); }
  const current = ids.map((id) => currentRunHashes(root, id));
  const currentMaterial = current.every((item) => item !== null)
    ? ids.map((id, index) => `${id}:${current[index]!.sourceHash}`).join("|")
    : null;
  const recorded: ArtifactInspection = {
    ...base, schema_version: schema, source_analysis_id: comparisonId, source_hash: sha256(material),
    current_source_hash: currentMaterial === null ? null : sha256(currentMaterial),
    current_input_hash: currentMaterial === null ? null
      : comparisonRunsHash(ids.map((id, index) => ({ run_id: id, source_hash: current[index]!.sourceHash, input_hash: current[index]!.inputHash }))),
  };
  const diagnostics = cached["diagnostics"];
  if (diagnostics === undefined) return { ...recorded, state: "unsupported", reason: "legacy_diagnostics_missing" };
  const record = asRecord(diagnostics);
  if (record["contract"] !== DIAGNOSTICS_CONTRACT) return { ...recorded, state: "unsupported", reason: "unknown_diagnostics_contract" };
  const retained = record["runs"];
  if (!Array.isArray(retained) || retained.length !== ids.length || !retained.every((value, index) => {
    if (!plainObject(value) || !hasOnlyKeys(value, new Set(["run_id", "source_hash", "input_hash", "eligible"]))) return false;
    return value["run_id"] === ids[index] && value["source_hash"] === hashes[index] && typeof value["eligible"] === "boolean" &&
      (value["input_hash"] === null || (typeof value["input_hash"] === "string" && INPUT_HASH_FORMAT.test(value["input_hash"])));
  }) || !detectorResultsWellFormed(record["dimensions"], { runIds: ids })) inspectionRefusal("malformed_artifact");
  const retainedRuns = retained as Array<{ run_id: string; source_hash: string; input_hash: string | null }>;
  const withInput = { ...recorded, input_hash: comparisonRunsHash(retainedRuns) };
  if (retainedRuns.some((item) => item.input_hash === null)) return { ...withInput, state: "unsupported", reason: "retained_run_legacy_diagnostics" };
  if (currentMaterial === null) return { ...withInput, state: "stale", reason: "retained_run_missing" };
  if (withInput.current_source_hash !== withInput.source_hash) return { ...withInput, state: "stale", reason: "stale_source" };
  if (withInput.current_input_hash !== withInput.input_hash) return { ...withInput, state: "stale", reason: "stale_inputs" };
  return { ...withInput, state: "current", eligible: true, reason: null };
}

/**
 * C-CLI read-only freshness inspection. Recomputes the current core source_hash
 * and additive input_hash through the analyzer's own collectors and compares
 * them with the canonical artifact. Never creates a directory, lock, journal,
 * queue, sidecar or index; unsafe or malformed input reports `refused`.
 */
export function inspectAnalysisArtifact(root: string, kind: ArtifactInspectionKind, sourceId: string): ArtifactInspection {
  const base: ArtifactInspection = {
    ok: true, state: "missing", kind, source_id: sourceId, artifact_ref: null, schema_version: null, source_analysis_id: null,
    source_hash: null, current_source_hash: null, input_hash: null, current_input_hash: null, eligible: false, reason: null,
  };
  try {
    if (kind !== "run" && kind !== "comparison") inspectionRefusal("unknown_artifact_kind");
    try { assertRecommendationSourceId(sourceId, "source id"); } catch { inspectionRefusal("unsafe_source_id"); }
    const artifactRef = kind === "run"
      ? `.guild/analysis/runs/${sourceId}/analysis.json`
      : `.guild/analysis/comparisons/${sourceId}/comparison.json`;
    const located = { ...base, artifact_ref: artifactRef };
    const raw = readArtifactNoFollow(root, artifactRef);
    if (raw === null) {
      if (kind === "run") {
        const current = currentRunHashes(root, sourceId);
        return { ...located, current_source_hash: current?.sourceHash ?? null, current_input_hash: current?.inputHash ?? null, reason: "artifact_missing" };
      }
      return { ...located, reason: "artifact_missing" };
    }
    return kind === "run" ? inspectRunArtifact(root, sourceId, located, raw) : inspectComparisonArtifact(root, sourceId, located, raw);
  } catch (error) {
    if (!(error instanceof InspectionRefusal)) throw error;
    return { ...base, ok: false, state: "refused", eligible: false, reason: error.reason };
  }
}

export interface ExpectedDecisionContext {
  analysisId: string;
  inputHash: string;
}

function assertExpectedContextShape(expected: ExpectedDecisionContext | undefined): void {
  if (expected === undefined) return;
  if (typeof expected.analysisId !== "string" || !ANALYSIS_ID_FORMAT.test(expected.analysisId)) {
    throw new Error("expected-analysis-id must be a producer-issued analysis identity");
  }
  if (typeof expected.inputHash !== "string" || !INPUT_HASH_FORMAT.test(expected.inputHash)) {
    throw new Error("expected-input-hash must be sha256:<64 lowercase hex>");
  }
}

/**
 * Runs inside the recommendation lock, before any journal/draft/queue/activity
 * mutation. Browser-bound consent (expected context) needs an exact, current,
 * supported identity. Historical operator decisions keep manual authority over
 * legacy diagnostics but never over a changed core source.
 */
function assertDecisionContext(root: string, sourceId: string, expected: ExpectedDecisionContext | undefined): void {
  const runArtifact = path.join(durableGuildDir(root), "analysis", "runs", sourceId, "analysis.json");
  const kind: ArtifactInspectionKind = fs.existsSync(runArtifact) ? "run" : "comparison";
  const inspection = inspectAnalysisArtifact(root, kind, sourceId);
  if (expected !== undefined) {
    const changed = inspection.state !== "current" ? `${inspection.state}:${inspection.reason}`
      : inspection.source_analysis_id !== expected.analysisId ? "analysis_identity_changed"
        : inspection.input_hash !== expected.inputHash || inspection.current_input_hash !== expected.inputHash ? "input_hash_changed"
          : null;
    if (changed !== null) throw new Error(`expected_context_changed: ${changed}`);
    return;
  }
  if (inspection.state === "missing") return; // canonicalSourceAnalysisId reports the missing source unchanged.
  if (inspection.state === "refused") throw new Error(`recommendation source refused: ${inspection.reason}`);
  if (inspection.state === "stale" || (inspection.state === "unsupported" && inspection.source_hash !== null &&
      inspection.current_source_hash !== inspection.source_hash)) {
    throw new Error(`source_context_stale: ${inspection.reason === "legacy_diagnostics_missing" ? "stale_source" : inspection.reason}`);
  }
  // An unknown contract still recorded additive inputs; manual authority holds only while they provably match.
  if (inspection.state === "unsupported" && inspection.reason === "unknown_diagnostics_contract" &&
      (inspection.input_hash === null || inspection.input_hash !== inspection.current_input_hash)) {
    throw new Error("source_context_stale: stale_inputs");
  }
}

function renderAnalysis(analysis: RunAnalysis): string {
  const missing = analysis.completeness.missing.length > 0 ? analysis.completeness.missing.map((item) => `- ${item}`).join("\n") : "- none";
  const findings = analysis.findings.length > 0
    ? analysis.findings.map((item) => `- **${item.kind}** — ${item.summary} (${item.evidence_refs.join(", ")})`).join("\n")
    : "- none";
  return `# Run analysis: ${analysis.run_id}\n\n` +
    `Schema: \`${analysis.schema_version}\`  \nEligible: **${analysis.eligible}**  \n` +
    `Evidence completeness: **${analysis.completeness.score}%**\n\n` +
    `## Missing evidence\n\n${missing}\n\n## Findings\n\n${findings}\n`;
}

export function writeRunAnalysis(root: string, analysis: RunAnalysis): { json: string; markdown: string; recommendations: string } {
  return withRecommendationLock(root, () => {
    assertRecommendationSourceId(analysis.run_id, "run id");
    const outDir = path.join(durableGuildDir(root), "analysis", "runs", analysis.run_id);
    const recommendationsDir = path.join(durableGuildDir(root), "recommendations");
    const json = path.join(outDir, "analysis.json");
    const markdown = path.join(outDir, "analysis.md");
    const recommendations = path.join(recommendationsDir, `${analysis.run_id}.jsonl`);
    assertGeneratedRecommendations(root, analysis.recommendations, {
      sourceId: analysis.run_id,
      sourceAnalysisId: analysis.analysis_id,
      runIds: [analysis.run_id],
    });
    const queue = path.join(recommendationsDir, "queue.jsonl");
    const activity = path.join(recommendationsDir, "activity.jsonl");
    return withFileTransaction(root, [json, markdown, recommendations, queue, activity], () => {
      const preserved = preserveRecordedStatuses(root, recommendations, analysis.recommendations, analysis.analysis_id);
      const recordedAnalysis: RunAnalysis = { ...analysis, recommendations: preserved.records };
      atomicWrite(root, json, JSON.stringify(recordedAnalysis, null, 2) + "\n");
      atomicWrite(root, markdown, renderAnalysis(recordedAnalysis));
      writeRecommendationRecords(root, recommendations, preserved.records);
      upsertProjectQueue(root, preserved.records);
      preserved.migrations.forEach(({ item, fromId, fromSourceId, fromSourceAnalysisId }) =>
        recordRecommendationActivity(root, analysis.run_id, item, item.status, "status_migrated", fromId, fromSourceId, fromSourceAnalysisId, true));
      if (preserved.migrations.length > 0) readRecommendationActivity(root);
      return { json, markdown, recommendations };
    });
  });
}

function renderComparison(comparison: RunComparison): string {
  const repeated = comparison.repeated_signatures.length > 0
    ? comparison.repeated_signatures
      .map((item) => `- \`${item.signature}\` — ${item.occurrences} occurrence(s) across ${item.runs.join(", ")}`)
      .join("\n")
    : "- none";
  return `# Run comparison: ${comparison.comparison_id}\n\n` +
    `Schema: \`${comparison.schema_version}\`  \n` +
    `Runs: **${comparison.run_ids.length}**  \n` +
    `Eligible: **${comparison.completeness.eligible_runs}/${comparison.completeness.total_runs}**  \n` +
    `Average evidence completeness: **${comparison.completeness.average_score}%**\n\n` +
    `## Runs\n\n${comparison.run_ids.map((id) => `- ${id}`).join("\n")}\n\n` +
    `## Repeated signatures\n\n${repeated}\n`;
}

export function writeRunComparison(root: string, comparison: RunComparison): {
  json: string;
  markdown: string;
  recommendations: string;
  index: string;
} {
  return withRecommendationLock(root, () => {
  assertRecommendationSourceId(comparison.comparison_id, "comparison id");
  const comparisonsDir = path.join(durableGuildDir(root), "analysis", "comparisons");
  const outDir = path.join(comparisonsDir, comparison.comparison_id);
  const recommendationsDir = path.join(durableGuildDir(root), "recommendations");
  const json = path.join(outDir, "comparison.json");
  const markdown = path.join(outDir, "comparison.md");
  const recommendations = path.join(recommendationsDir, `${comparison.comparison_id}.jsonl`);
  const index = path.join(comparisonsDir, "index.json");
  assertGeneratedRecommendations(root, comparison.recommendations, {
    sourceId: comparison.comparison_id,
    sourceAnalysisId: comparison.comparison_id,
    runIds: comparison.run_ids,
  });
  const queue = path.join(recommendationsDir, "queue.jsonl");
  const activity = path.join(recommendationsDir, "activity.jsonl");
  return withFileTransaction(root, [json, markdown, recommendations, queue, activity, index], () => {
    const preserved = preserveRecordedStatuses(root, recommendations, comparison.recommendations, comparison.comparison_id);
    const recordedComparison: RunComparison = { ...comparison, recommendations: preserved.records };
    atomicWrite(root, json, JSON.stringify(recordedComparison, null, 2) + "\n");
    atomicWrite(root, markdown, renderComparison(recordedComparison));
    writeRecommendationRecords(root, recommendations, preserved.records);
    upsertProjectQueue(root, preserved.records);
    preserved.migrations.forEach(({ item, fromId, fromSourceId, fromSourceAnalysisId }) =>
      recordRecommendationActivity(root, comparison.comparison_id, item, item.status, "status_migrated", fromId, fromSourceId, fromSourceAnalysisId, true));
    if (preserved.migrations.length > 0) readRecommendationActivity(root);

    const old = readExistingContainedText(root, index);
    let entries: Array<{ comparison_id: string; run_ids: string[]; source_hashes: string[] }> = [];
    if (old) {
      try {
        const parsed = asRecord(JSON.parse(old));
        const values = parsed["comparisons"];
        if (Array.isArray(values)) {
          entries = values.filter((value): value is { comparison_id: string; run_ids: string[]; source_hashes: string[] } => {
            const item = asRecord(value);
            return typeof item["comparison_id"] === "string" && Array.isArray(item["run_ids"]) && Array.isArray(item["source_hashes"]);
          });
        }
      } catch { /* replace malformed advisory index from canonical artifacts */ }
    }
    entries = entries.filter((item) => item.comparison_id !== comparison.comparison_id);
    entries.push({ comparison_id: comparison.comparison_id, run_ids: comparison.run_ids, source_hashes: comparison.source_hashes });
    entries.sort((a, b) => a.comparison_id.localeCompare(b.comparison_id));
    atomicWrite(root, index, JSON.stringify({ schema_version: "guild.run_comparison_index.v1", comparisons: entries }, null, 2) + "\n");
    return { json, markdown, recommendations, index };
  });
  });
}

function discoverRunIds(root: string): string[] {
  const runsDir = path.join(durableGuildDir(root), "runs");
  try {
    return fs.readdirSync(runsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && SAFE_ID.test(entry.name))
      .map((entry) => entry.name)
      .filter((id) => fs.existsSync(path.join(runsDir, id, "run.yaml")))
      .sort();
  } catch {
    return [];
  }
}

export function resolveComparisonTarget(root: string, target: ComparisonTarget): RunAnalysis[] {
  if (target.kind !== "runs") assertSafeId(target.id, `${target.kind} id`);
  const discovered = target.kind === "runs" ? [...new Set(target.ids)].sort() : discoverRunIds(root);
  const ids = target.kind === "runs" ? discovered : discovered.filter((id) => {
    const dir = runDir(root, id);
    const manifest = resolveRunInputFile(dir, "run.yaml");
    const raw = manifest ? readText(manifest) : null;
    if (raw === null) return false;
    try {
      const manifest = asRecord(parseYaml(raw));
      if (target.kind === "initiative") return scalar(manifest, "initiative_attachment") === target.id;
      const scope = scalar(manifest, "run_scope");
      return scope === "independent" && scalar(manifest, "independent_run_group") === target.id;
    } catch {
      // A corrupt unrelated run must not poison a targeted comparison.
      return false;
    }
  });
  ids.forEach((id) => assertSafeId(id, "run id"));
  const analyses = ids.map((id) => analyzeRun(root, id));
  if (target.kind === "initiative") {
    return analyses.filter((analysis) => analysis.identity.initiative_id === target.id);
  }
  if (target.kind === "independent") {
    return analyses.filter((analysis) => analysis.identity.independent_group_id === target.id);
  }
  return analyses;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

const metricTotal = (analysis: RunAnalysis, metric: UsageMetric): number =>
  metric === "duration_ms" ? analysis.usage.duration_ms : analysis.usage.tokens[metric];

/** >2x median within >=5 eligible complete runs sharing run class, model, provider and config cohort. */
function compareUsageOutlier(sorted: readonly RunAnalysis[]): Omit<ComparisonDimension, "by_run" | "comparable_runs"> & { comparable: string[] } {
  const metrics: Record<string, unknown> = {};
  const refs: string[] = [];
  const comparable = new Set<string>();
  let observed = false;
  let zeroMedian = false;
  for (const metric of USAGE_METRICS) {
    let metricObserved = false;
    let metricZeroMedian = false;
    const complete: Record<string, number> = {};
    const partial: Record<string, number> = {};
    const unknown: string[] = [];
    const cohorts = new Map<string, RunAnalysis[]>();
    for (const analysis of sorted) {
      const availability = analysis.usage.availability?.[metric];
      if (!availability || availability.state === "unobserved") { unknown.push(analysis.run_id); continue; }
      if (availability.state === "partial") { partial[analysis.run_id] = metricTotal(analysis, metric); continue; }
      complete[analysis.run_id] = metricTotal(analysis, metric);
      const cohort = analysis.diagnostics?.cohort;
      if (!analysis.eligible || !cohort || Object.values(cohort).some((value) => value === null)) continue;
      const key = canonicalJson(cohort);
      cohorts.set(key, [...(cohorts.get(key) ?? []), analysis]);
    }
    const evaluated = [...cohorts.entries()].filter(([, runs]) => runs.length >= OUTLIER_MIN_COHORT).map(([key, runs]) => {
      const middle = median(runs.map((analysis) => metricTotal(analysis, metric)));
      if (middle <= 0) { zeroMedian = true; metricZeroMedian = true; }
      const outliers = middle > 0 ? runs.filter((analysis) => metricTotal(analysis, metric) > 2 * middle) : [];
      runs.forEach((analysis) => comparable.add(analysis.run_id));
      outliers.forEach((analysis) => refs.push(...(analysis.usage.availability?.[metric].evidence_refs ?? [])));
      if (middle > 0) { observed = true; metricObserved = true; }
      return { cohort: sha256(key).slice(0, 16), runs: runs.map((analysis) => analysis.run_id), median: middle, outliers: middle > 0 ? outliers.map((analysis) => analysis.run_id) : null };
    }).sort((a, b) => a.cohort.localeCompare(b.cohort));
    metrics[metric] = {
      state: metricObserved ? "observed" : "unobservable",
      reason: metricObserved ? null : metricZeroMedian ? "zero_median" : "insufficient_comparable_cohort",
      complete_totals: complete, partial_subtotals: partial, unknown, cohorts: evaluated,
    };
  }
  return {
    detector: "usage_outlier",
    state: observed ? "observed" : "unobservable",
    value: { min_cohort: OUTLIER_MIN_COHORT, metrics },
    evidence_refs: sortedUnique(refs),
    reason: observed ? null : zeroMedian ? "zero_median" : "insufficient_comparable_cohort",
    comparable: [...comparable].sort(),
  };
}

function detectorValue(analysis: RunAnalysis, detector: DetectorId): DetectorResult | null {
  return analysis.diagnostics?.results.find((item) => item.detector === detector) ?? null;
}

function compareDiagnostics(sorted: readonly RunAnalysis[]): ComparisonDiagnostics {
  const eligible = sorted.filter((analysis) => analysis.eligible);
  const dimensions: ComparisonDimension[] = DETECTOR_IDS.map((detector) => {
    const byRun: ComparisonDimension["by_run"] = Object.fromEntries(sorted.map((analysis) => {
      const item = detectorValue(analysis, detector);
      return [analysis.run_id, { state: item?.state ?? "legacy_unknown", eligible: analysis.eligible, value: item?.value ?? {} }];
    }));
    const states = eligible.map((analysis) => byRun[analysis.run_id].state);
    const observedRuns = eligible.filter((analysis) => byRun[analysis.run_id].state === "observed").map((analysis) => analysis.run_id);
    const refs = eligible.flatMap((analysis) => detectorValue(analysis, detector)?.evidence_refs ?? []);
    let state: DetectorState = states.includes("observed") ? "observed" : states.includes("ambiguous") ? "ambiguous" : "unobservable";
    let reason: string | null = state === "unobservable" ? (eligible.length === 0 ? "no_eligible_runs" : "no_observations") : null;
    let value: Record<string, unknown> = {};
    let comparable = observedRuns;
    if (detector === "usage_outlier") {
      const outlier = compareUsageOutlier(sorted);
      return { detector, state: outlier.state, value: outlier.value, evidence_refs: outlier.evidence_refs, reason: outlier.reason, by_run: byRun, comparable_runs: outlier.comparable };
    }
    if (detector === "instruction_following") {
      const scopes = Object.fromEntries(observedRuns.map((runId) => [runId, (byRun[runId].value["requirement_hashes"] as string[] | undefined) ?? []]));
      const distinct = new Set(Object.values(scopes).map((hashes) => hashes.join(",")));
      value = {
        by_aggregate: Object.fromEntries((["satisfied", "violated", "ambiguous", "unobservable"] as const).map((status) => [status,
          eligible.filter((analysis) => byRun[analysis.run_id].value["aggregate"] === status).map((analysis) => analysis.run_id)])),
        requirement_scopes: scopes,
      };
      if (distinct.size > 1) { state = "ambiguous"; reason = "incomparable_declared_scopes"; comparable = []; }
    }
    if (detector === "repeated_mistake") {
      const clusters = new Map<string, { runs: Set<string>; occurrences: number; phases: Set<string> }>();
      for (const analysis of eligible) {
        for (const cluster of (byRun[analysis.run_id].value["clusters"] as Array<Record<string, unknown>> | undefined) ?? []) {
          const current = clusters.get(String(cluster["signature"])) ?? { runs: new Set<string>(), occurrences: 0, phases: new Set<string>() };
          current.runs.add(analysis.run_id);
          current.occurrences += Number(cluster["attempts"]);
          current.phases.add(String(cluster["phase"] ?? "-"));
          clusters.set(String(cluster["signature"]), current);
        }
      }
      value = {
        cross_run_clusters: [...clusters.entries()].filter(([, item]) => item.runs.size >= REPEAT_THRESHOLD)
          .map(([signature, item]) => ({ signature, runs: [...item.runs].sort(), occurrences: item.occurrences, phases: [...item.phases].sort() }))
          .sort((a, b) => a.signature.localeCompare(b.signature)),
      };
    }
    return { detector, state, value, evidence_refs: sortedUnique(refs), reason, by_run: byRun, comparable_runs: comparable };
  });
  const clusters = new Map<string, { scope: RecommendationScope; kind: RecommendationKind; target: string; runs: Set<string> }>();
  for (const analysis of eligible) {
    for (const item of (detectorValue(analysis, "recommendation_scope")?.value["supported"] as Array<{ scope: RecommendationScope; kind: RecommendationKind; target: string }> | undefined) ?? []) {
      const key = `${item.scope}|${item.kind}|${item.target}`;
      const current = clusters.get(key) ?? { ...item, runs: new Set<string>() };
      current.runs.add(analysis.run_id);
      clusters.set(key, current);
    }
  }
  return {
    contract: DIAGNOSTICS_CONTRACT,
    runs: sorted.map((analysis) => ({ run_id: analysis.run_id, source_hash: analysis.source_hash, input_hash: analysis.diagnostics?.input_hash ?? null, eligible: analysis.eligible })),
    dimensions,
    recommendation_clusters: [...clusters.values()].filter((item) => item.runs.size >= REPEAT_THRESHOLD)
      .map((item) => ({ scope: item.scope, kind: item.kind, target: item.target, runs: [...item.runs].sort() }))
      .sort((a, b) => `${a.scope}|${a.kind}|${a.target}`.localeCompare(`${b.scope}|${b.kind}|${b.target}`)),
  };
}

export function compareRuns(analyses: readonly RunAnalysis[]): RunComparison {
  if (analyses.length < 2) throw new Error("comparison requires at least two run analyses");
  const sorted = [...analyses].sort((a, b) => a.run_id.localeCompare(b.run_id));
  const clusters = new Map<string, { runs: Set<string>; occurrences: number; refs: Set<string>; severity: Recommendation["severity"]; kinds: Set<AnalysisFinding["kind"]> }>();
  for (const analysis of sorted.filter((item) => item.eligible)) {
    for (const item of analysis.findings) {
      const current = clusters.get(item.signature) ?? { runs: new Set<string>(), occurrences: 0, refs: new Set<string>(), severity: item.severity, kinds: new Set<AnalysisFinding["kind"]>() };
      current.runs.add(analysis.run_id);
      current.occurrences += 1;
      item.evidence_refs.forEach((ref) => current.refs.add(ref));
      current.kinds.add(item.kind);
      clusters.set(item.signature, current);
    }
  }
  const repeated = [...clusters.entries()]
    .filter(([, value]) => value.runs.size >= 2 || value.occurrences >= 2)
    .map(([signature, value]) => ({ signature, runs: [...value.runs].sort(), occurrences: value.occurrences }))
    .sort((a, b) => a.signature.localeCompare(b.signature));
  const material = sorted.map((analysis) => `${analysis.run_id}:${analysis.source_hash}`).join("|");
  const comparisonId = stableId("comparison", material);
  const recommendations: Recommendation[] = repeated.map((cluster) => {
    const source = clusters.get(cluster.signature);
    const scope: RecommendationScope = source?.kinds.has("telemetry_gap") ? "plugin" : "project";
    const kind: RecommendationKind = scope === "plugin" ? "telemetry_gap" : "update_workflow";
    const refs = [...(source?.refs ?? [])].sort();
    const signature = evidenceSignature(scope, kind, refs);
    return {
      schema_version: "guild.recommendation.v1",
      id: stableId("rec", signature),
      source_id: comparisonId,
      source_analysis_id: comparisonId,
      scope,
      kind,
      confidence: "high",
      severity: "medium",
      evidence_refs: refs,
      evidence_signature: signature,
      affected_runs: cluster.runs,
      proposed_action: `Address repeated cross-run signature ${cluster.signature}`,
      status: "proposed",
      ...recommendationRoutingFields(scope),
    };
  });
  return {
    schema_version: "guild.run_comparison.v1",
    comparison_id: comparisonId,
    run_ids: sorted.map((analysis) => analysis.run_id),
    source_hashes: sorted.map((analysis) => analysis.source_hash),
    completeness: {
      eligible_runs: sorted.filter((analysis) => analysis.eligible).length,
      total_runs: sorted.length,
      average_score: Math.round(sorted.reduce((sum, analysis) => sum + analysis.completeness.score, 0) / sorted.length),
    },
    repeated_signatures: repeated,
    recommendations,
    diagnostics: compareDiagnostics(sorted),
  };
}

export function routeRecommendation<T extends Pick<Recommendation, "scope">>(recommendation: T): RecommendationRouting {
  if (!RECOMMENDATION_SCOPES.has(recommendation.scope)) throw new Error(`invalid recommendation scope: ${String(recommendation.scope)}`);
  return routingForScope(recommendation.scope);
}

function decideRecommendationUnlocked(
  root: string,
  sourceId: string,
  recommendationId: string,
  decision: "accept" | "reject",
): RecommendationDecisionResult {
  if (decision !== "accept" && decision !== "reject") throw new Error("recommendation decision must be accept or reject");
  const source = recommendationSourceFile(root, sourceId);
  assertSafeId(recommendationId, "recommendation id");
  const current = readRecommendationRecords(root, source, true, sourceId, canonicalSourceAnalysisId(root, sourceId)).find((item) => item.id === recommendationId);
  if (!current) throw new Error(`recommendation ${recommendationId} was not found in ${sourceId}`);

  if (decision === "reject") {
    if (!["proposed", "rejected"].includes(current.status)) {
      throw new Error(`cannot reject a recommendation with status ${current.status}`);
    }
    const updated = rewriteRecommendation(root, sourceId, recommendationId, "rejected", "recommendation_rejected");
    return { source_id: sourceId, recommendation_id: recommendationId, status: updated.status, effect: "recommendation_rejected" };
  }

  if (current.scope === "project") {
    if (!["proposed", "queued"].includes(current.status)) throw new Error(`cannot queue a recommendation with status ${current.status}`);
    const updated = rewriteRecommendation(root, sourceId, recommendationId, "queued", "project_proposal_queued");
    return { source_id: sourceId, recommendation_id: recommendationId, status: updated.status, effect: "project_proposal_queued" };
  }

  if (!["proposed", "accepted"].includes(current.status)) throw new Error(`cannot accept a recommendation with status ${current.status}`);
  const draft = path.join(durableGuildDir(root), "recommendations", "drafts", `${recommendationId}.md`);
  assertOutputContained(root, draft);
  const updatedCandidate: Recommendation = { ...current, status: "accepted" };
  const body = `# Guild plugin recommendation draft: ${updatedCandidate.id}\n\n` +
    `Status: accepted locally; external filing has not occurred.\n\n` +
    `## Proposed action\n\n${updatedCandidate.proposed_action}\n\n` +
    `## Evidence\n\n${updatedCandidate.evidence_refs.map((ref) => `- \`${ref}\``).join("\n")}\n`;
  const draftBefore = readExistingContainedText(root, draft);
  let updated: Recommendation;
  try {
    atomicWrite(root, draft, body);
    updated = rewriteRecommendation(root, sourceId, recommendationId, "accepted", "plugin_draft_written");
  } catch (error) {
    restoreRecommendationFile(root, draft, draftBefore);
    throw error;
  }
  return { source_id: sourceId, recommendation_id: recommendationId, status: updated.status, effect: "plugin_draft_written", draft };
}

export function decideRecommendation(
  root: string,
  sourceId: string,
  recommendationId: string,
  decision: "accept" | "reject",
  expected?: ExpectedDecisionContext,
): RecommendationDecisionResult {
  assertSafeId(recommendationId, "recommendation id");
  assertRecommendationSourceId(sourceId, "recommendation source id");
  assertExpectedContextShape(expected);
  return withRecommendationLock(root, () => {
    assertDecisionContext(root, sourceId, expected);
    return withFileTransaction(root, [
      recommendationSourceFile(root, sourceId),
      path.join(durableGuildDir(root), "recommendations", "queue.jsonl"),
      path.join(durableGuildDir(root), "recommendations", "activity.jsonl"),
      path.join(durableGuildDir(root), "recommendations", "drafts", `${recommendationId}.md`),
    ], () => decideRecommendationUnlocked(root, sourceId, recommendationId, decision));
  });
}

function updateRecommendationStatusUnlocked(
  root: string,
  sourceId: string,
  recommendationId: string,
  status: RecommendationStatus,
): RecommendationDecisionResult {
  if (!RECOMMENDATION_STATUSES.has(status)) throw new Error(`invalid recommendation status: ${String(status)}`);
  const source = recommendationSourceFile(root, sourceId);
  const current = readRecommendationRecords(root, source, true, sourceId, canonicalSourceAnalysisId(root, sourceId)).find((item) => item.id === recommendationId);
  if (!current) throw new Error(`recommendation ${recommendationId} was not found in ${sourceId}`);
  if (current.status !== status) {
    const allowed = authorizedProgressTransition(current.scope, current.status, status);
    if (!allowed) throw new Error(`status transition ${current.status} -> ${status} is not authorized for ${current.scope} scope or lacks approval`);
  }
  const updated = rewriteRecommendation(root, sourceId, recommendationId, status, "status_recorded");
  return { source_id: sourceId, recommendation_id: recommendationId, status: updated.status, effect: "status_recorded" };
}

export function updateRecommendationStatus(
  root: string,
  sourceId: string,
  recommendationId: string,
  status: RecommendationStatus,
): RecommendationDecisionResult {
  assertSafeId(recommendationId, "recommendation id");
  return withRecommendationLock(root, () => withFileTransaction(root, [
    recommendationSourceFile(root, sourceId),
    path.join(durableGuildDir(root), "recommendations", "queue.jsonl"),
    path.join(durableGuildDir(root), "recommendations", "activity.jsonl"),
  ], () => updateRecommendationStatusUnlocked(root, sourceId, recommendationId, status)));
}
