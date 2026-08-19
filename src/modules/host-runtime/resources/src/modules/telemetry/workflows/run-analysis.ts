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

import { parseYaml } from "../../state";
import { validateGuildTraceEvent, type AnalysisEventClass } from "./guild-trace-events";

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
  kind: "instruction_violation" | "repeated_failure" | "tool_gap" | "workflow_churn" | "prompt_inefficiency" | "telemetry_gap";
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
  };
  findings: AnalysisFinding[];
  recommendations: Recommendation[];
}

export interface RunComparison {
  schema_version: "guild.run_comparison.v1";
  comparison_id: string;
  run_ids: string[];
  source_hashes: string[];
  completeness: { eligible_runs: number; total_runs: number; average_score: number };
  repeated_signatures: Array<{ signature: string; runs: string[]; occurrences: number }>;
  recommendations: Recommendation[];
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
  const runs = path.join(resolvedRoot, ".guild", "runs");
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
  const dir = path.join(root, ".guild", "recommendations");
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
  const queue = readRecommendationRecords(root, path.join(root, ".guild", "recommendations", "queue.jsonl"), false);
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
  const queue = path.join(root, ".guild", "recommendations", "queue.jsonl");
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
  return path.join(root, ".guild", "recommendations", `${sourceId}.jsonl`);
}

function canonicalSourceAnalysisId(root: string, sourceId: string): string {
  const runArtifact = path.join(root, ".guild", "analysis", "runs", sourceId, "analysis.json");
  const comparisonArtifact = path.join(root, ".guild", "analysis", "comparisons", sourceId, "comparison.json");
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
  const activity = path.join(root, ".guild", "recommendations", "activity.jsonl");
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
  const activity = path.join(root, ".guild", "recommendations", "activity.jsonl");
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
  return path.resolve(root, ".guild", "recommendations", ".transaction.json");
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
  const queue = path.join(root, ".guild", "recommendations", "queue.jsonl");
  const activity = path.join(root, ".guild", "recommendations", "activity.jsonl");
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
const V14_LOOPS = new Set(["L1", "L2", "L3", "L4", "security-review"]);
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

function detectFindings(analysisId: string, events: LoadedEvent[]): AnalysisFinding[] {
  const findings: AnalysisFinding[] = [];
  const failures = new Map<string, string[]>();
  const steeringRefs: string[] = [];
  for (const event of events) {
    const value = event.value;
    const semanticFailure = value["schema_version"] === "guild.trace.analysis.v2" &&
      ["tool_call_failed", "repeated_failure_detected"].includes(String(value["event_class"]));
    const toolFailure = value["event"] === "tool_call" && value["status"] === "err";
    if (semanticFailure || toolFailure) {
      const signature = scalar(value, "signature") ?? [value["tool"], value["command_redacted"], value["result_excerpt_redacted"]].map(String).join("|");
      failures.set(signature, [...(failures.get(signature) ?? []), event.ref]);
    }
    if (value["event_class"] === "instruction_violation_detected") {
      findings.push(finding(analysisId, "instruction_violation", "high", "The trace records an instruction violation.", [event.ref], scalar(value, "signature") ?? "instruction-violation"));
    }
    if (value["event_class"] === "tool_call_denied") {
      findings.push(finding(analysisId, "tool_gap", "medium", "A required tool action was denied.", [event.ref], scalar(value, "signature") ?? "tool-denied"));
    }
    if (value["event_class"] === "loop_cap_hit") {
      findings.push(finding(analysisId, "workflow_churn", "medium", "A workflow loop reached its cap.", [event.ref], scalar(value, "signature") ?? "loop-cap"));
    }
    if (value["event_class"] === "user_steering_received") steeringRefs.push(event.ref);
  }
  for (const [signature, refs] of [...failures.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (refs.length >= 2) {
      findings.push(finding(analysisId, "repeated_failure", "high", `The same failed action recurred ${refs.length} times.`, refs, signature));
    }
  }
  if (steeringRefs.length >= 2) {
    findings.push(finding(
      analysisId,
      "prompt_inefficiency",
      "medium",
      `The run required ${steeringRefs.length} user steering interventions.`,
      steeringRefs,
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

function recommendationsFor(analysisId: string, runId: string, findings: AnalysisFinding[]): Recommendation[] {
  return findings.map((item) => {
    const scope: RecommendationScope = item.kind === "telemetry_gap" ? "plugin" : "project";
    const kind = item.kind === "repeated_failure" ? "clarify_prompt_contract" :
      item.kind === "tool_gap" ? "create_skill" :
      item.kind === "telemetry_gap" ? "telemetry_gap" : "update_workflow";
    const signature = evidenceSignature(scope, kind, item.evidence_refs);
    return {
      schema_version: "guild.recommendation.v1",
      id: stableId("rec", signature),
      source_id: runId,
      source_analysis_id: analysisId,
      scope,
      kind,
      confidence: item.evidence_refs.length >= 2 ? "high" : "medium",
      severity: item.severity,
      evidence_refs: item.evidence_refs,
      evidence_signature: signature,
      affected_runs: [runId],
      proposed_action: item.summary,
      status: "proposed",
      ...recommendationRoutingFields(scope),
    } as Recommendation;
  }).sort((a, b) => a.id.localeCompare(b.id));
}

function assessment(observableRefs: string[], violatedRefs: string[] = []): { status: AssessmentStatus; evidence_refs: string[] } {
  if (observableRefs.length === 0) return { status: "unobservable", evidence_refs: [] };
  if (violatedRefs.length > 0) return { status: "violated", evidence_refs: [...new Set([...observableRefs, ...violatedRefs])].sort() };
  // Observability alone is not positive proof. A satisfied verdict requires an
  // explicit positive detector; until one exists, retain the honest ambiguity.
  return { status: "ambiguous", evidence_refs: observableRefs.slice().sort() };
}

export function analyzeRun(root: string, runId: string): RunAnalysis {
  const dir = runDir(root, runId);
  const runFile = resolveRunInputFile(dir, "run.yaml");
  const runRaw = runFile ? readText(runFile) : null;
  if (runRaw === null) throw new Error(`run ${runId} has no run.yaml`);
  const manifest = asRecord(parseYaml(runRaw));
  const { events, raw: eventsRaw, parseErrors, invalidRecords } = loadEvents(root, runId);
  const scope = scalar(manifest, "run_scope");
  const initiativeId = scalar(manifest, "initiative_attachment");
  const independentGroup = scalar(manifest, "independent_run_group");
  const runScope = scope === "initiative" || scope === "independent"
    ? scope
    : initiativeId !== null ? "initiative" : "unknown";
  const configRef = scalar(manifest, "config_snapshot_ref");
  const configPath = configRef ? resolveRunInputFile(dir, configRef) : null;
  const configSnapshot = readConfigSnapshot(configPath, runId);
  const configExists = configSnapshot !== null;
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
  const provenancePath = resolveRunInputFile(dir, "provenance.json");
  const sourceHash = sha256(runRaw + "\n" + (provenancePath ? readText(provenancePath) ?? "" : "") + "\n" + (configPath ? readText(configPath) ?? "" : "") + "\n" + eventsRaw);
  const analysisId = `analysis:${runId}:${sourceHash.slice(0, 12)}`;
  const findings = detectFindings(analysisId, events);
  if (missing.length > 0) {
    findings.push(finding(
      analysisId,
      "telemetry_gap",
      "medium",
      `Analysis evidence is incomplete: ${[...new Set(missing)].sort().join(", ")}.`,
      [`.guild/runs/${runId}/run.yaml`],
      `missing:${[...new Set(missing)].sort().join("|")}`,
    ));
    findings.sort((a, b) => a.id.localeCompare(b.id));
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
      instruction_following: eligible ? assessment(instructionRefs, violationRefs) : { status: "unobservable", evidence_refs: [] },
      prompt_efficiency: eligible ? assessment(promptRefs) : { status: "unobservable", evidence_refs: [] },
      workflow: eligible ? assessment(workflowRefs) : { status: "unobservable", evidence_refs: [] },
      tool_coverage: eligible ? assessment(toolRefs) : { status: "unobservable", evidence_refs: [] },
    },
    usage: tokenUsage(events),
    findings,
    recommendations: recommendationsFor(analysisId, runId, findings),
  };
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
    const outDir = path.join(root, ".guild", "analysis", "runs", analysis.run_id);
    const recommendationsDir = path.join(root, ".guild", "recommendations");
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
  const comparisonsDir = path.join(root, ".guild", "analysis", "comparisons");
  const outDir = path.join(comparisonsDir, comparison.comparison_id);
  const recommendationsDir = path.join(root, ".guild", "recommendations");
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
  const runsDir = path.join(root, ".guild", "runs");
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
  const draft = path.join(root, ".guild", "recommendations", "drafts", `${recommendationId}.md`);
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
): RecommendationDecisionResult {
  assertSafeId(recommendationId, "recommendation id");
  return withRecommendationLock(root, () => withFileTransaction(root, [
    recommendationSourceFile(root, sourceId),
    path.join(root, ".guild", "recommendations", "queue.jsonl"),
    path.join(root, ".guild", "recommendations", "activity.jsonl"),
    path.join(root, ".guild", "recommendations", "drafts", `${recommendationId}.md`),
  ], () => decideRecommendationUnlocked(root, sourceId, recommendationId, decision)));
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
    path.join(root, ".guild", "recommendations", "queue.jsonl"),
    path.join(root, ".guild", "recommendations", "activity.jsonl"),
  ], () => updateRecommendationStatusUnlocked(root, sourceId, recommendationId, status)));
}
