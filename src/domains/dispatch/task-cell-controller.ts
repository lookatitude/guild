/**
 * src/domains/dispatch/task-cell-controller.ts
 *
 * The E00 TaskCell controller (design e00-controller-contract r12, CD4–CD26):
 * one live owner per run that drives the EXISTING FilesystemTaskCellRuntime,
 * records controller-observed handoff origin, settles typed oracles from its own
 * evidence, derives acceptance authorities from approved identities, and seals a
 * hash-bound acceptance evidence pair (pre.json before acceptHandoff, final.json
 * after) that the one E00 release predicate, isQualifiedDownstreamRelease,
 * re-verifies at read time.
 *
 * Trust policy (CD19/CD20): cooperative_local only. Trusted same-operator local
 * workers share the operator UID; nothing here claims to resist a worker that
 * deliberately reads binding.json or forges an authority file with its bus
 * event. isolated_worker refuses at start with worker_principal_unavailable.
 *
 * The binding (CD10/CD21) is passed only as an explicit DispatchBindingEnvelope;
 * the worker-facing entry points (writeAckClaim, the outbox notice) never read
 * it. Source-run harnesses have no verified installed package, so their
 * evidence never qualifies (CD16: mechanics_only).
 *
 * Legacy release primitives are deliberately not imported here: every release,
 * admission and acceptance_record consumer goes through findQualifiedRunAcceptances.
 */

import { spawnSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

import { readBusLog, sha256 } from "./artifact-bus";
import type { DispatchBindingEnvelope } from "./task-assignment";
import { acknowledgeAssignment, readTaskAssignmentV2 } from "./task-assignment-v2";
import {
  assignmentId,
  buildTaskAssignmentV2,
  taskCellPaths,
  validateTaskAssignmentV2,
  validateTaskAttemptV1,
  type AuthorityDecision,
  type HandoffAcceptanceV1,
  type HandoffValidationV1,
  type InstanceHandle,
  type TaskAssignmentV2,
  type TaskAttemptV1,
} from "./task-cell-contract";
import {
  classifyPersistedAcceptance,
  classifyPersistedTerminal,
  classifyPersistedValidation,
  findRunAcceptances,
  markAttemptOrphaned,
  publishPersistedLifecycleRecord,
  publishScannedHandoffPointer,
  readAttemptForInstance,
  sealTerminalAttempt,
  type IntendedAcceptance,
  type RunAcceptance,
  type TaskCellInstanceIds,
} from "./task-cell-acceptance";
import {
  publishTaskCellFile,
  verifyPrereleaseBusJoins,
  type TaskCellArtifactKind,
} from "./task-cell-artifact-join";
import { lifecycleEventPresent } from "./task-cell-cleanup-check";
import {
  cellCanGoDone,
  decodeExecutableTarget,
  initProgressLedger,
  ledgerBoundToAssignment,
  progressLedgerPath,
  readProgressLedger,
  recordOracleOutcome,
  validateExecutableDoneWhen,
  type ArtifactExistsOracleTarget,
  type CommandOracleTarget,
  type AcceptanceRecordOracleTarget,
  type DoneWhenItem,
} from "./progress-ledger";
import { isInstanceReservation } from "./instance-cap";
import {
  FilesystemTaskCellRuntime,
  SpawnOutcomeUnknownError,
  type FilesystemTaskCellRuntimeOpts,
  type TaskCellWorkerPort,
  type TaskCellMechanicsResult,
} from "./task-cell-runtime";
import { selectPrincipalProvider, type PrincipalProvider, type WorkerTrustPolicy } from "./principal-provider";
import {
  evaluateGatePass,
  readVerifiedReleasePackageIdentity,
  invocationAdapterMismatch,
  validateReviewInvocationV1,
  validateReviewResultV1Strict,
  type GatePassConditions,
} from "../distribution";
import { validateSecretsPolicy } from "../config";
import { checkContained, isRefused } from "../kernel";
import { loadRunBinding, runBindingPath, verifyRunBinding } from "../lifecycle";
import { applySecretsPolicy, parseSecurityConfig, securityDefaults, type SecretsPolicy } from "../security";
import { durableGuildDir, guildRootId, parseYaml } from "../state";
import { readTaskCellLifecycleEvents } from "../telemetry";
import { dispatchGate, readTeamPlan, writeTeamPlan, writeTeamResult } from "../teams";
import type { TeamDecisionV1, TeamProposalV2 } from "../teams";

// ── Schemas and closed codes ─────────────────────────────────────────────────

export const TASK_CELL_CONTROLLER_SCHEMA = "guild.task_cell_controller.v1" as const;
export const TASK_CELL_CONTROLLER_STATUS_VIEW = "guild.task_cell_controller_status.v1" as const;
export const TASK_ORACLE_PLAN_SCHEMA = "guild.task_oracle_plan.v1" as const;
export const ORACLE_PLAN_DECISION_SCHEMA = "guild.oracle_plan_decision.v1" as const;
export const ASSIGNMENT_ACK_CLAIM_SCHEMA = "guild.assignment_ack_claim.v1" as const;
export const HANDOFF_ORIGIN_SCHEMA = "guild.handoff_origin.v1" as const;
export const TASK_CELL_DECISION_SCHEMA = "guild.task_cell_decision.v1" as const;
export const TASK_CELL_REVIEW_REQUEST_SCHEMA = "guild.task_cell_review_request.v1" as const;
export const SOURCE_BASIS_REVIEW_REQUEST_SCHEMA = "guild.source_basis_review_request.v1" as const;
export const SOURCE_BASIS_DESCRIPTOR_SCHEMA = "guild.source_basis_descriptor.v1" as const;
export const ACCEPTANCE_EVIDENCE_SCHEMA = "guild.task_cell_acceptance_evidence.v1" as const;
export const ACCEPTANCE_EVIDENCE_FINAL_SCHEMA = "guild.task_cell_acceptance_evidence_final.v1" as const;
export const TASK_CELL_CLEANUP_SCHEMA = "guild.task_cell_cleanup.v1" as const;
export const TASK_CELL_RECONCILIATION_SCHEMA = "guild.task_cell_reconciliation.v1" as const;
export const CONTROLLER_LOSS_OBSERVATION_SCHEMA = "guild.task_cell_controller_loss_observation.v1" as const;
export const CONTROLLER_LOSS_MARKER_SCHEMA = "guild.task_cell_controller_loss.v1" as const;
export const CONTROLLER_HANDLE_SCHEMA = "guild.task_cell_controller_handle.v1" as const;
export const ORACLE_EVIDENCE_SCHEMA = "guild.task_cell_oracle_evidence.v1" as const;
export const TASK_COMPLETED_NOTICE_SCHEMA = "guild.task_completed_notice.v1" as const;

/** Heartbeat cadence and the unresponsive threshold (CD5). */
export const CONTROLLER_HEARTBEAT_MS = 5_000;
export const CONTROLLER_UNRESPONSIVE_MS = 30_000;

/** The approved slot independence a reviewer_cross_host participant requires (CD12 d). */
const REQUIRED_INDEPENDENCE: Readonly<Record<string, string>> = Object.freeze({ reviewer_cross_host: "cross_family" });

/** A typed refusal: returned `{ ok:false, reason }` or thrown with `.reason`. */
export class ControllerRefusal extends Error {
  readonly ok = false as const;
  constructor(readonly reason: string, detail = "") {
    super(detail ? `${reason}: ${detail}` : reason);
    this.name = "ControllerRefusal";
  }
}

export type Refused = { ok: false; reason: string; detail?: string };
const refuse = (reason: string, detail?: string): Refused => (detail ? { ok: false, reason, detail } : { ok: false, reason });

// ── Small I/O helpers ────────────────────────────────────────────────────────

interface FileRef { path: string; sha256: string }

function readJsonFile(abs: string): unknown | null {
  try {
    return JSON.parse(fs.readFileSync(abs, "utf8"));
  } catch {
    return null;
  }
}

/** Regular, non-symlink file bytes or null (absent, irregular or unreadable). */
function regularBytes(abs: string): Buffer | null {
  try {
    const stat = fs.lstatSync(abs);
    if (!stat.isFile() || stat.isSymbolicLink()) return null;
    return fs.readFileSync(abs);
  } catch {
    return null;
  }
}

function fileRef(cwd: string, rel: string): FileRef | null {
  const bytes = regularBytes(path.resolve(cwd, rel));
  return bytes === null ? null : { path: rel, sha256: sha256(bytes) };
}

/** Exclusive create (O_CREAT|O_EXCL). Returns false when the file already exists. */
function writeExclusive(abs: string, contents: string, mode = 0o600): boolean {
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  try {
    fs.writeFileSync(abs, contents, { encoding: "utf8", flag: "wx", mode });
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  }
}

/**
 * Exclusive create that tolerates an identical existing file (an idempotent
 * retry) and reports a differing one as a conflict.
 */
function writeExclusiveIdempotent(abs: string, contents: string): "created" | "identical" | "conflict" {
  if (writeExclusive(abs, contents)) return "created";
  const existing = regularBytes(abs);
  return existing !== null && existing.toString("utf8") === contents ? "identical" : "conflict";
}

const json = (value: unknown): string => JSON.stringify(value, null, 2) + "\n";

/** Exact bytes of a physically contained regular file (no symlinked leaf or parent), or null. */
function containedBytes(cwd: string, rel: string): Buffer | null {
  const contained = checkContained(cwd, rel, { policy: "physical", requireRegularFileLeaf: true });
  if (isRefused(contained)) return null;
  try {
    return fs.readFileSync(contained.realPath);
  } catch {
    return null;
  }
}

/**
 * The configured secrets policy, read strictly (C13 F1). An absent settings.json is no
 * configured policy (built-in defaults). A present file that is not a contained regular
 * file, does not parse, or carries a secrets_policy the closed validator rejects is null:
 * never a silent default.
 */
function configuredSecretsPolicy(cwd: string): SecretsPolicy | null {
  const abs = path.join(durableGuildDir(cwd), "settings.json");
  try {
    fs.lstatSync(abs);
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT" ? securityDefaults().secrets_policy : null;
  }
  const bytes = containedBytes(cwd, path.relative(cwd, abs));
  if (bytes === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  const policy = (parsed as Record<string, unknown>)["secrets_policy"];
  if (policy !== undefined) {
    if (typeof policy !== "object" || policy === null || Array.isArray(policy)) return null;
    const fields = policy as Record<string, unknown>;
    // The shared validator can throw while describing a malformed value; that is unavailable, never its message.
    try {
      if (validateSecretsPolicy(fields).length > 0) return null;
    } catch {
      return null;
    }
    for (const key of ["env_allowlist", "redaction_patterns"]) {
      const value = fields[key];
      if (value !== undefined && !(Array.isArray(value) && value.every((x) => typeof x === "string"))) return null;
    }
  }
  return parseSecurityConfig(parsed).secrets_policy;
}

let handleTmpSeq = 0;
/**
 * Publish a controller handle atomically: an exclusive 0600 temp in the same directory,
 * then rename. Any failure removes the temp and leaves the previous handle bytes intact.
 */
function publishHandle(abs: string, record: ControllerHandleV1): void {
  const tmp = path.join(path.dirname(abs), `.${path.basename(abs)}.tmp-${process.pid}-${Date.now()}-${++handleTmpSeq}`);
  try {
    fs.writeFileSync(tmp, json(record), { encoding: "utf8", mode: 0o600, flag: "wx" });
    fs.renameSync(tmp, abs);
  } catch (error) {
    try { fs.rmSync(tmp, { force: true }); } catch { /* best effort */ }
    throw error;
  }
}

function ownedByUid(abs: string, uid: number): boolean {
  try {
    const stat = fs.lstatSync(abs);
    return stat.isFile() && !stat.isSymbolicLink() && (uid < 0 || stat.uid === uid);
  } catch {
    return false;
  }
}

function currentUid(): number {
  return typeof process.getuid === "function" ? process.getuid() : -1;
}

function isSafeSegment(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,191}$/.test(value);
}

// ── Canonical paths (all under <root>/.guild/runs/<run>/) ────────────────────

function runRel(runId: string, ...segments: string[]): string {
  return path.join(".guild", "runs", runId, ...segments);
}
const controllerRel = (runId: string, ...s: string[]) => runRel(runId, "controller", ...s);
const claimRel = (runId: string) => controllerRel(runId, "controller.json");
const heartbeatRel = (runId: string) => controllerRel(runId, "heartbeat.json");
const handleRel = (runId: string, instanceId: string) => controllerRel(runId, "handles", `${instanceId}.json`);
const decisionRel = (runId: string, instanceId: string) => controllerRel(runId, "decisions", instanceId, "team_lead.json");
const reviewRequestRel = (runId: string, instanceId: string) => controllerRel(runId, "review-requests", `${instanceId}.json`);
const evidenceRel = (runId: string, instanceId: string, name: "pre.json" | "final.json") =>
  controllerRel(runId, "acceptance-evidence", instanceId, name);
const reconciliationRel = (runId: string, instanceId: string, kind: string) =>
  controllerRel(runId, "reconciliations", instanceId, `${kind}.json`);
const cleanupRel = (runId: string, instanceId: string, name: string) => controllerRel(runId, "cleanup", instanceId, name);
const oraclePlanRel = (runId: string, phase: string) => runRel(runId, "oracle-plan", `${phase}.json`);
const oracleDecisionRel = (runId: string, phase: string) => runRel(runId, "oracle-plan", `${phase}.decision.json`);
const oracleEvidenceRel = (runId: string, assignment: string, oracleId: string) =>
  runRel(runId, "oracle-evidence", assignment, `${oracleId}.json`);
const outboxRel = (runId: string, instanceId: string, name: string) => runRel(runId, "outbox", instanceId, name);
const originRel = (ids: TaskCellInstanceIds) => path.join(taskCellPaths(ids).instance_dir, "handoff-origin.json");
const ackRel = (ids: TaskCellInstanceIds) => path.join(taskCellPaths(ids).instance_dir, "assignment-ack.json");

/** The assignment's lead identity: exactly one of lead_binding_id / team_lead_instance_id (LeadBinding). */
function leadOf(a: TaskAssignmentV2): { lead_binding_id: string | null; team_lead_instance_id: string | null } {
  const r = a as unknown as { lead_binding_id?: string | null; team_lead_instance_id?: string | null };
  return { lead_binding_id: r.lead_binding_id ?? null, team_lead_instance_id: r.team_lead_instance_id ?? null };
}

function idsOf(a: Pick<TaskAssignmentV2, "run_id" | "logical_task_id" | "attempt" | "instance_id">): TaskCellInstanceIds {
  return { run_id: a.run_id, logical_task_id: a.logical_task_id, attempt: a.attempt, instance_id: a.instance_id };
}

// ── Canonical identities (CD18 / CD22) ───────────────────────────────────────

export interface RootIdentity {
  root_id: string;
  source_id: string;
  /** sha256(realpath(root) + NUL + dev:ino of root/.guild); null when unreadable. */
  root_fingerprint: string | null;
  guild_root_path: string;
}

/** root_id/source_id exactly as StackScope derives them, plus the copy-detecting fingerprint. */
export function readRootIdentity(cwd: string): RootIdentity {
  const real = fs.realpathSync(cwd);
  const rootId = guildRootId(real);
  let fingerprint: string | null = null;
  try {
    const stat = fs.statSync(durableGuildDir(real));
    fingerprint = sha256(`${real}\0${stat.dev}:${stat.ino}`);
  } catch {
    fingerprint = null;
  }
  return { root_id: rootId, source_id: `source:${rootId}`, root_fingerprint: fingerprint, guild_root_path: real };
}

export interface PackageIdentityView {
  package_identity: { id: string; sha256: string };
  package_release_version: string;
  package_current_package: string;
  package_root: string;
  source_revision: string | null;
}

/** CD22 mapping over readVerifiedReleasePackageIdentity; throws on any verification failure. */
export function readPackageIdentity(packageRoot: string): PackageIdentityView {
  const identity = readVerifiedReleasePackageIdentity(packageRoot);
  const digest = identity.package_digests[identity.current_package];
  if (typeof digest !== "string") throw new Error("package identity has no digest for its current package");
  return {
    package_identity: { id: identity.release_id, sha256: digest },
    package_release_version: identity.release_version,
    package_current_package: identity.current_package,
    package_root: fs.realpathSync(packageRoot),
    source_revision: identity.source_commit ?? null,
  };
}

/** host_profile_id = sha256 of {os, arch, provider, operator_uid, provider_version} (CD18). */
export function hostProfileId(provider: string, providerVersion = "1"): string {
  return sha256(JSON.stringify({ os: process.platform, arch: process.arch, provider, operator_uid: currentUid(), provider_version: providerVersion }));
}

// ── Process identity (CD5) ───────────────────────────────────────────────────

/** Start time of a pid, whitespace-normalized; null when no such process. */
export function processStartOf(pid: number): string | null {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  if (process.platform === "linux") {
    try {
      const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
      const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
      return fields[19] ?? null;
    } catch {
      return null;
    }
  }
  const r = spawnSync("ps", ["-o", "lstart=", "-p", String(pid)], { encoding: "utf8" });
  const out = (r.stdout ?? "").trim().replace(/\s+/g, " ");
  return r.status === 0 && out.length > 0 ? out : null;
}

export function bootSession(): string | null {
  if (process.platform === "linux") {
    try {
      return fs.readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim() || null;
    } catch {
      return null;
    }
  }
  const r = spawnSync("sysctl", ["-n", "kern.bootsessionuuid"], { encoding: "utf8" });
  const out = (r.stdout ?? "").trim();
  return r.status === 0 && out.length > 0 ? out : null;
}

const normalizeStart = (s: unknown): string | null => (typeof s === "string" ? s.trim().replace(/\s+/g, " ") : null);

/**
 * Owner process observation for the death decision. Only ESRCH from kill(pid, 0) is
 * definite absence; every other presence error (EPERM included), or a failed or blank
 * start read, is unavailable (never dead).
 */
function observeOwnerProcess(pid: number): { state: "absent" } | { state: "present"; start: string } | { state: "unavailable" } {
  try {
    process.kill(pid, 0);
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ESRCH" ? { state: "absent" } : { state: "unavailable" };
  }
  const start = normalizeStart(processStartOf(pid));
  return start ? { state: "present", start } : { state: "unavailable" };
}

// ── The claim (CD5) ──────────────────────────────────────────────────────────

export interface TaskCellControllerClaimV1 extends PackageIdentityNullable {
  schema_version: typeof TASK_CELL_CONTROLLER_SCHEMA;
  run_id: string;
  oracle_plan: FileRef;
  oracle_plan_decision: FileRef;
  lead_binding_id: string;
  root_id: string;
  source_id: string;
  root_fingerprint: string | null;
  source_revision: string | null;
  controller_instance_id: string;
  pid: number;
  process_start: string;
  boot_session: string | null;
  operator_uid: number;
  worker_trust_policy: WorkerTrustPolicy;
  provider: string;
  host_profile_id: string | null;
  started_at: string;
  /**
   * Additive (root Q2): the reviewed source-basis proof for the installed
   * package, pinned at exclusive create and never rewritten; null on source
   * runs (mechanics_only). Re-verified at preflight P6 and CD17b check 8.
   */
  reviewed_basis: ReviewedBasisPins | null;
}

interface PackageIdentityNullable {
  package_identity: { id: string; sha256: string } | null;
  package_release_version: string | null;
  package_current_package: string | null;
  package_root: string | null;
}

function readClaim(cwd: string, runId: string): TaskCellControllerClaimV1 | null {
  const value = readJsonFile(path.resolve(cwd, claimRel(runId))) as TaskCellControllerClaimV1 | null;
  if (!value || value.schema_version !== TASK_CELL_CONTROLLER_SCHEMA || value.run_id !== runId) return null;
  return value;
}

export type ControllerLiveness = "live" | "unresponsive" | "dead" | "absent" | "unknown";

export interface OwnerClassification {
  liveness: ControllerLiveness;
  evidence_quality: "pid_start_verified" | "heartbeat_only" | "none";
  heartbeat: { state: string | null; heartbeat_at: string | null } | null;
}

/**
 * Dead only on affirmative proof: a recorded boot session that differs, the pid
 * authoritatively absent, or a different start for the pid (PID reuse). A missing or
 * malformed recorded pid/start, or an unavailable observation, is unknown. A missing
 * recorded or current boot only removes the boot-change proof.
 */
export function classifyControllerOwner(cwd: string, runId: string, nowIso: string): OwnerClassification {
  const claimAbs = path.resolve(cwd, claimRel(runId));
  if (!fs.existsSync(claimAbs)) return { liveness: "absent", evidence_quality: "none", heartbeat: null };
  const claim = readClaim(cwd, runId);
  if (!claim) return { liveness: "unknown", evidence_quality: "none", heartbeat: null };
  const hb = readJsonFile(path.resolve(cwd, heartbeatRel(runId))) as { state?: unknown; heartbeat_at?: unknown } | null;
  const heartbeat = {
    state: typeof hb?.state === "string" ? hb.state : null,
    heartbeat_at: typeof hb?.heartbeat_at === "string" ? hb.heartbeat_at : null,
  };
  const recordedStart = normalizeStart(claim.process_start);
  if (!Number.isInteger(claim.pid) || claim.pid <= 0 || !recordedStart) {
    return { liveness: "unknown", evidence_quality: "none", heartbeat };
  }
  // Boot is a proof only when both values are available; an unavailable one never blocks the pid proof.
  const boot = bootSession();
  const recordedBoot = typeof claim.boot_session === "string" ? claim.boot_session.trim() : "";
  if (boot !== null && recordedBoot && recordedBoot !== boot) return { liveness: "dead", evidence_quality: "pid_start_verified", heartbeat };
  const observed = observeOwnerProcess(claim.pid);
  if (observed.state === "unavailable") return { liveness: "unknown", evidence_quality: "heartbeat_only", heartbeat };
  if (observed.state === "absent" || observed.start !== recordedStart) {
    return { liveness: "dead", evidence_quality: "pid_start_verified", heartbeat };
  }
  const at = heartbeat.heartbeat_at ? Date.parse(heartbeat.heartbeat_at) : Number.NaN;
  const age = Date.parse(nowIso) - at;
  const fresh = Number.isFinite(at) && Number.isFinite(age) && age <= CONTROLLER_UNRESPONSIVE_MS;
  return { liveness: fresh ? "live" : "unresponsive", evidence_quality: "pid_start_verified", heartbeat };
}

function lossRecorded(cwd: string, runId: string, claim: TaskCellControllerClaimV1 | null): boolean {
  if (!claim) return false;
  return fs.existsSync(path.resolve(cwd, controllerRel(runId, `loss-${claim.controller_instance_id}.json`)));
}

// ── Oracle plan (CD8) ────────────────────────────────────────────────────────

export interface OraclePlanLane {
  logical_task_id: string;
  authorities_required: string[];
  reviewer_participant_id: string | null;
  done_when: DoneWhenItem[];
}

export interface TaskOraclePlanV1 {
  schema_version: typeof TASK_ORACLE_PLAN_SCHEMA;
  approved_plan_ref: FileRef;
  team_decision_ref: FileRef;
  lead_binding_id: string;
  acceptance_policy_version: string;
  lanes: OraclePlanLane[];
}

export interface ApprovedOraclePlan {
  plan: TaskOraclePlanV1;
  plan_ref: FileRef;
  decision_ref: FileRef;
}

function validateOraclePlan(value: unknown): TaskOraclePlanV1 | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (v["schema_version"] !== TASK_ORACLE_PLAN_SCHEMA) return null;
  if (typeof v["lead_binding_id"] !== "string" || v["lead_binding_id"].length === 0) return null;
  if (typeof v["acceptance_policy_version"] !== "string" || !Array.isArray(v["lanes"])) return null;
  for (const lane of v["lanes"] as unknown[]) {
    const l = lane as Record<string, unknown>;
    if (!l || typeof l["logical_task_id"] !== "string" || !Array.isArray(l["authorities_required"])) return null;
    if (l["reviewer_participant_id"] !== null && typeof l["reviewer_participant_id"] !== "string") return null;
    if (!Array.isArray(l["done_when"])) return null;
  }
  return v as unknown as TaskOraclePlanV1;
}

/** Read the approved oracle plan; any missing, unapproved or hash-mismatched input refuses. */
export function readApprovedOraclePlan(cwd: string, runId: string, phase: string): ApprovedOraclePlan | Refused {
  if (!isSafeSegment(phase)) return refuse("oracle_plan_unapproved", "invalid phase");
  const planBytes = regularBytes(path.resolve(cwd, oraclePlanRel(runId, phase)));
  const decisionBytes = regularBytes(path.resolve(cwd, oracleDecisionRel(runId, phase)));
  if (planBytes === null) return refuse("oracle_plan_unapproved", "oracle plan missing");
  if (decisionBytes === null) return refuse("oracle_plan_unapproved", "oracle plan decision missing");
  let plan: TaskOraclePlanV1 | null;
  let decision: Record<string, unknown>;
  try {
    plan = validateOraclePlan(JSON.parse(planBytes.toString("utf8")));
    decision = JSON.parse(decisionBytes.toString("utf8")) as Record<string, unknown>;
  } catch {
    return refuse("oracle_plan_unapproved", "oracle plan or decision unparseable");
  }
  if (!plan) return refuse("oracle_plan_unapproved", "oracle plan malformed");
  if (
    decision["schema_version"] !== ORACLE_PLAN_DECISION_SCHEMA ||
    decision["decision"] !== "approved" ||
    decision["oracle_plan_sha256"] !== sha256(planBytes)
  ) return refuse("oracle_plan_unapproved", "decision does not approve these plan bytes");
  return {
    plan,
    plan_ref: { path: oraclePlanRel(runId, phase), sha256: sha256(planBytes) },
    decision_ref: { path: oracleDecisionRel(runId, phase), sha256: sha256(decisionBytes) },
  };
}

/** The closed authority set a lane implies (CD12): reviewer_cell iff a reviewer participant is named. */
export function requiredAuthoritiesFor(reviewerParticipantId: string | null): string[] {
  return reviewerParticipantId === null
    ? ["deterministic_floor", "team_lead"]
    : ["deterministic_floor", "team_lead", "reviewer_cell"];
}

/** Lane membership from the approved machine plan: logical_task_id → owning role. */
export type ApprovedLaneMembership = ReadonlyMap<string, string>;

/**
 * F2 / CD8 / root Q3: the oracle plan's references and lanes are bound to the
 * approved team. team_decision_ref and approved_plan_ref must hash-match their
 * regular files; the canonical dispatchGate must approve the given proposal with
 * that decision for this run and phase; approved_plan_ref must equal the
 * proposal's hash-bound spec_ref or plan_ref, and that JSON's work_items[].id /
 * owner give membership (unique ids, owner a worker role_ref in the proposal).
 * Every lane must be a member, and its authorities_required must equal the
 * closed set implied by its reviewer participant, which must be a
 * reviewer_cross_host slot of the proposal.
 */
export function verifyTeamAuthority(input: {
  cwd: string;
  runId: string;
  phase: string;
  plan: TaskOraclePlanV1;
  proposal: TeamProposalV2 | null | undefined;
}): { ok: true; membership: ApprovedLaneMembership } | Refused {
  const no = (detail: string) => refuse("oracle_plan_unapproved", detail);
  const proposal = input.proposal;
  if (!proposal || typeof proposal !== "object") return no("approved proposal input absent");
  const refFile = (ref: FileRef | undefined, label: string): Buffer | string => {
    if (!ref || typeof ref.path !== "string" || typeof ref.sha256 !== "string") return `${label} ref malformed`;
    const abs = path.resolve(input.cwd, ref.path);
    const rel = path.relative(input.cwd, abs);
    if (rel.startsWith("..") || path.isAbsolute(rel)) return `${label} ref escapes the root`;
    const bytes = regularBytes(abs);
    if (bytes === null) return `${label} ref is not a regular file`;
    if (sha256(bytes) !== ref.sha256) return `${label} ref hash mismatch`;
    return bytes;
  };
  const decisionBytes = refFile(input.plan.team_decision_ref, "team_decision");
  if (typeof decisionBytes === "string") return no(decisionBytes);
  let decision: TeamDecisionV1;
  try {
    decision = parseYaml(decisionBytes.toString("utf8")) as TeamDecisionV1;
  } catch {
    return no("team decision unparseable");
  }
  const gate = dispatchGate(proposal, decision);
  if (!gate.allowed) return no(`team decision does not approve the proposal: ${gate.reason ?? ""}`);
  if (decision.run_id !== input.runId || decision.phase !== input.phase) return no("team decision is for another run or phase");
  const planBytes = refFile(input.plan.approved_plan_ref, "approved_plan");
  if (typeof planBytes === "string") return no(planBytes);
  const sameRef = (r: { path: string; sha256: string } | undefined) =>
    !!r && path.normalize(r.path) === path.normalize(input.plan.approved_plan_ref.path) && r.sha256 === input.plan.approved_plan_ref.sha256;
  if (!sameRef(proposal.spec_ref) && !sameRef(proposal.plan_ref)) return no("approved_plan_ref is not bound by the approved proposal");
  let approved: { work_items?: unknown };
  try {
    approved = JSON.parse(planBytes.toString("utf8")) as { work_items?: unknown };
  } catch {
    return no("approved plan is not JSON");
  }
  if (!Array.isArray(approved.work_items)) return no("approved plan has no work_items");
  const workerRoles = new Set(proposal.participants.filter((p) => p.participation_kind === "worker").map((p) => p.role_ref));
  const membership = new Map<string, string>();
  for (const item of approved.work_items as Array<Record<string, unknown>>) {
    const id = item?.["id"];
    const owner = item?.["owner"];
    if (typeof id !== "string" || id.length === 0 || typeof owner !== "string" || owner.length === 0) return no("approved work_item malformed");
    if (membership.has(id)) return no(`approved work_item id is ambiguous: ${id}`);
    membership.set(id, owner);
  }
  const seenLanes = new Set<string>();
  for (const lane of input.plan.lanes) {
    if (seenLanes.has(lane.logical_task_id)) return no(`duplicate oracle-plan lane ${lane.logical_task_id}`);
    seenLanes.add(lane.logical_task_id);
    const owner = membership.get(lane.logical_task_id);
    if (owner === undefined) return no(`lane ${lane.logical_task_id} is not an approved work item`);
    if (!workerRoles.has(owner)) return no(`lane ${lane.logical_task_id} owner ${owner} is not an approved worker role`);
    const expected = requiredAuthoritiesFor(lane.reviewer_participant_id);
    const got = [...lane.authorities_required].sort();
    if (got.length !== expected.length || [...expected].sort().some((a, i) => a !== got[i])) {
      return no(`lane ${lane.logical_task_id} authorities_required is not the closed set ${expected.join(",")}`);
    }
    if (lane.reviewer_participant_id !== null) {
      const slot = proposal.participants.find((p) => p.participant_id === lane.reviewer_participant_id);
      if (!slot || slot.participation_kind !== "reviewer_cross_host") return no(`lane ${lane.logical_task_id} reviewer is not an approved reviewer_cross_host slot`);
    }
  }
  return { ok: true, membership };
}

/**
 * Operator CLI approve-oracles (CD8): bind a decision to the exact current plan
 * bytes. Exclusive create; a second approval of the same bytes is identical,
 * of different bytes a conflict.
 */
export function approveOraclePlan(input: {
  cwd: string;
  runId: string;
  phase: string;
  decidedBy: string;
  now?: () => string;
}): { ok: true; path: string; oracle_plan_sha256: string } | Refused {
  if (!isSafeSegment(input.phase)) return refuse("oracle_plan_invalid", "invalid phase");
  const planBytes = regularBytes(path.resolve(input.cwd, oraclePlanRel(input.runId, input.phase)));
  if (planBytes === null) return refuse("oracle_plan_missing");
  let plan: TaskOraclePlanV1 | null;
  try {
    plan = validateOraclePlan(JSON.parse(planBytes.toString("utf8")));
  } catch {
    plan = null;
  }
  if (!plan) return refuse("oracle_plan_invalid");
  if (typeof input.decidedBy !== "string" || input.decidedBy.trim().length === 0) return refuse("decided_by_required");
  const digest = sha256(planBytes);
  const rel = oracleDecisionRel(input.runId, input.phase);
  const decision = {
    schema_version: ORACLE_PLAN_DECISION_SCHEMA,
    oracle_plan_sha256: digest,
    decision: "approved",
    decided_by: input.decidedBy,
    operator_uid: currentUid(),
    at: (input.now ?? (() => new Date().toISOString()))(),
  };
  const outcome = writeExclusiveIdempotent(path.resolve(input.cwd, rel), json(decision));
  if (outcome === "conflict") {
    const existing = readJsonFile(path.resolve(input.cwd, rel)) as { oracle_plan_sha256?: unknown } | null;
    if (existing?.oracle_plan_sha256 === digest) return { ok: true, path: rel, oracle_plan_sha256: digest };
    return refuse("oracle_plan_decision_conflict");
  }
  return { ok: true, path: rel, oracle_plan_sha256: digest };
}

// ── Worker ack claim (CD10) ──────────────────────────────────────────────────

export interface AssignmentAckClaimV1 {
  schema_version: typeof ASSIGNMENT_ACK_CLAIM_SCHEMA;
  run_id: string;
  instance_id: string;
  assignment_sha256: string;
  claimed_at: string;
}

/**
 * Derive the guild root and canonical ids from an ABSOLUTE assignment path:
 * <root>/.guild/runs/<run>/task-cells/<task>/attempts/<n>/instances/<id>/assignment.json,
 * cross-checked against the assignment's own ids. The worker's cwd is never used.
 */
export function locateAssignment(assignmentPath: string): { root: string; assignment: TaskAssignmentV2; bytes: Buffer } | Refused {
  if (typeof assignmentPath !== "string" || !path.isAbsolute(assignmentPath)) return refuse("assignment_path_not_absolute");
  const bytes = regularBytes(assignmentPath);
  if (bytes === null) return refuse("assignment_unreadable");
  let assignment: TaskAssignmentV2 | null;
  try {
    assignment = validateTaskAssignmentV2(JSON.parse(bytes.toString("utf8")));
  } catch {
    assignment = null;
  }
  if (!assignment) return refuse("assignment_malformed");
  const canonical = taskCellPaths(idsOf(assignment)).assignment_path;
  const normalized = path.normalize(assignmentPath);
  if (!normalized.endsWith(path.sep + canonical)) return refuse("assignment_path_not_canonical");
  const root = normalized.slice(0, normalized.length - canonical.length - 1);
  if (root.length === 0 || !path.isAbsolute(root)) return refuse("assignment_path_not_canonical");
  return { root, assignment, bytes };
}

/**
 * The worker-side ack (CD10): write ONLY outbox/<instance_id>/ack-claim.json.
 * Never reads the run binding, publishes to the bus, edits instance.json or
 * writes the controller's ack. The controller validates the claim against the
 * delivered assignment bytes before it acknowledges with its own binding.
 */
export function writeAckClaim(input: { assignmentPath: string; now?: () => string }): { ok: true; path: string; claim: AssignmentAckClaimV1 } | Refused {
  const located = locateAssignment(input.assignmentPath);
  if (!("assignment" in located)) return located;
  const { root, assignment, bytes } = located;
  const claim: AssignmentAckClaimV1 = {
    schema_version: ASSIGNMENT_ACK_CLAIM_SCHEMA,
    run_id: assignment.run_id,
    instance_id: assignment.instance_id,
    assignment_sha256: sha256(bytes),
    claimed_at: (input.now ?? (() => new Date().toISOString()))(),
  };
  const abs = path.join(root, outboxRel(assignment.run_id, assignment.instance_id, "ack-claim.json"));
  if (writeExclusive(abs, json(claim))) return { ok: true, path: abs, claim };
  const existing = readJsonFile(abs) as AssignmentAckClaimV1 | null;
  if (
    existing?.schema_version === ASSIGNMENT_ACK_CLAIM_SCHEMA && existing.run_id === claim.run_id &&
    existing.instance_id === claim.instance_id && existing.assignment_sha256 === claim.assignment_sha256
  ) return { ok: true, path: abs, claim: existing };
  return refuse("ack_claim_conflict");
}

/** Validate a worker ack claim against the delivered assignment bytes (untrusted input). */
export function readValidAckClaim(cwd: string, assignment: TaskAssignmentV2): { claim: AssignmentAckClaimV1; ref: FileRef } | null {
  const rel = outboxRel(assignment.run_id, assignment.instance_id, "ack-claim.json");
  const bytes = regularBytes(path.resolve(cwd, rel));
  const assignmentBytes = regularBytes(path.resolve(cwd, assignment.assignment_path));
  if (bytes === null || assignmentBytes === null) return null;
  let claim: AssignmentAckClaimV1;
  try {
    claim = JSON.parse(bytes.toString("utf8")) as AssignmentAckClaimV1;
  } catch {
    return null;
  }
  if (
    claim.schema_version !== ASSIGNMENT_ACK_CLAIM_SCHEMA || claim.run_id !== assignment.run_id ||
    claim.instance_id !== assignment.instance_id || claim.assignment_sha256 !== sha256(assignmentBytes) ||
    typeof claim.claimed_at !== "string"
  ) return null;
  return { claim, ref: { path: rel, sha256: sha256(bytes) } };
}

// ── Controller-observed handoff origin (CD4) ─────────────────────────────────

export interface HandoffOriginV1 {
  schema_version: typeof HANDOFF_ORIGIN_SCHEMA;
  origin_kind: "controller_observed";
  native_task_completed: false;
  controller_instance_id: string;
  package_identity: { id: string; sha256: string } | null;
  receipt_sha256: string;
  observed_at: string;
  reported_claims: Array<{ path: string; sha256: string; claim_status: "unverified" | "refused" }>;
}

/** Notices already reported by another instance's origin in this run (replay detection). */
function replayedNoticeShas(cwd: string, runId: string, exceptInstance: string): Set<string> {
  const out = new Set<string>();
  for (const { ids } of walkInstances(cwd, runId)) {
    if (ids.instance_id === exceptInstance) continue;
    const origin = readJsonFile(path.resolve(cwd, originRel(ids))) as HandoffOriginV1 | null;
    for (const c of origin?.reported_claims ?? []) out.add(c.sha256);
  }
  return out;
}

function classifyNotice(
  cwd: string,
  assignment: TaskAssignmentV2,
  packageIdentity: { id: string; sha256: string } | null,
): HandoffOriginV1["reported_claims"] {
  const rel = outboxRel(assignment.run_id, assignment.instance_id, "task-completed-notice.json");
  const bytes = regularBytes(path.resolve(cwd, rel));
  if (bytes === null) return [];
  const digest = sha256(bytes);
  let notice: Record<string, unknown> | null = null;
  try {
    notice = JSON.parse(bytes.toString("utf8")) as Record<string, unknown>;
  } catch {
    notice = null;
  }
  const noticePackage = notice?.["package_identity"] as { id?: unknown; sha256?: unknown } | undefined;
  const matches =
    notice !== null &&
    notice["run_id"] === assignment.run_id &&
    notice["assignment_id"] === assignmentId(assignment) &&
    notice["instance_id"] === assignment.instance_id &&
    packageIdentity !== null &&
    noticePackage?.id === packageIdentity.id &&
    noticePackage?.sha256 === packageIdentity.sha256 &&
    !replayedNoticeShas(cwd, assignment.run_id, assignment.instance_id).has(digest);
  // A claim never raises provenance strength: matching notices stay unverified.
  return [{ path: rel, sha256: digest, claim_status: matches ? "unverified" : "refused" }];
}

/**
 * The controller observed a stable lane receipt (CD4/CD11 step 9): publish the
 * submitted-handoff pointer with the controller's binding, then exclusively
 * create handoff-origin.json (controller_observed, native_task_completed=false).
 * Any notice the worker left is recorded as a claim and never raises provenance.
 *
 * C-H1-1: the receipt is checked against secrets_policy in memory first. A receipt
 * that would need redaction, or a policy that cannot apply, is refused before any
 * pointer, origin or retained copy; the receipt is never rewritten and the refusal
 * carries no receipt content. Every later read must hash to the scanned bytes.
 *
 * C13: a present but unreadable or invalid settings policy refuses
 * (handoff_secret_policy_unavailable). The pointer is published only for the scanned
 * bytes, and the origin is created only after a contained canonical re-read matches them.
 */
export function submitObservedHandoff(input: {
  cwd: string;
  assignment: TaskAssignmentV2;
  binding: DispatchBindingEnvelope;
  controllerInstanceId: string;
  packageIdentity: { id: string; sha256: string } | null;
  now: () => string;
}): { ok: true; origin: HandoffOriginV1; origin_ref: FileRef } | Refused {
  const a = input.assignment;
  const laneRel = `.guild/runs/${a.run_id}/handoffs/${a.worker_role}-${a.logical_task_id}.md`;
  const policy = configuredSecretsPolicy(input.cwd);
  if (policy === null) return refuse("handoff_secret_policy_unavailable");
  const scanned = containedBytes(input.cwd, laneRel);
  if (scanned === null) return refuse("handoff_receipt_unreadable");
  const text = scanned.toString("utf8");
  const scrub = applySecretsPolicy(text, policy, { noTruncate: true });
  if (!scrub.ok || scrub.value !== text) return refuse("handoff_secret_scrub_required");
  const scannedDigest = sha256(scanned);
  const at = input.now();
  const published = publishScannedHandoffPointer({
    cwd: input.cwd, assignment: input.assignment, submittedAt: at, binding: input.binding, scannedBytes: scanned,
  });
  if (!published.ok) return refuse(published.reason === "receipt_changed" ? "handoff_receipt_changed" : "handoff_pointer_refused");
  const pointer = published.submitted;
  if (pointer.receipt_id !== `handoff-sha256:${scannedDigest}` || pointer.receipt_path !== laneRel) return refuse("handoff_receipt_changed");
  // F3: re-read the canonical path under physical containment before the origin exists.
  const receiptBytes = containedBytes(input.cwd, laneRel);
  if (receiptBytes === null) return refuse("handoff_receipt_unreadable");
  if (sha256(receiptBytes) !== scannedDigest) return refuse("handoff_receipt_changed");
  const origin: HandoffOriginV1 = {
    schema_version: HANDOFF_ORIGIN_SCHEMA,
    origin_kind: "controller_observed",
    native_task_completed: false,
    controller_instance_id: input.controllerInstanceId,
    package_identity: input.packageIdentity,
    receipt_sha256: sha256(receiptBytes),
    observed_at: at,
    reported_claims: classifyNotice(input.cwd, input.assignment, input.packageIdentity),
  };
  const rel = originRel(idsOf(input.assignment));
  const outcome = writeExclusiveIdempotent(path.resolve(input.cwd, rel), json(origin));
  if (outcome === "conflict") {
    const existing = readJsonFile(path.resolve(input.cwd, rel)) as HandoffOriginV1 | null;
    if (!existing || existing.receipt_sha256 !== origin.receipt_sha256 || existing.controller_instance_id !== origin.controller_instance_id) {
      return refuse("handoff_origin_conflict");
    }
    return { ok: true, origin: existing, origin_ref: fileRef(input.cwd, rel)! };
  }
  return { ok: true, origin, origin_ref: fileRef(input.cwd, rel)! };
}

// ── Run-tree walk ────────────────────────────────────────────────────────────

function walkInstances(cwd: string, runId: string): Array<{ ids: TaskCellInstanceIds; attemptRel: string }> {
  const cellsRoot = path.join(durableGuildDir(cwd), "runs", runId, "task-cells");
  const out: Array<{ ids: TaskCellInstanceIds; attemptRel: string }> = [];
  const list = (dir: string): string[] => {
    try {
      return fs.readdirSync(dir).sort();
    } catch {
      return [];
    }
  };
  for (const logical of list(cellsRoot)) {
    for (const attemptDir of list(path.join(cellsRoot, logical, "attempts"))) {
      const attempt = Number.parseInt(attemptDir, 10);
      if (!Number.isInteger(attempt) || attempt < 1 || String(attempt) !== attemptDir) continue;
      const attemptRel = runRel(runId, "task-cells", logical, "attempts", attemptDir, "attempt.json");
      for (const instance of list(path.join(cellsRoot, logical, "attempts", attemptDir, "instances"))) {
        out.push({ ids: { run_id: runId, logical_task_id: logical, attempt, instance_id: instance }, attemptRel });
      }
    }
  }
  return out;
}

function findAssignmentByInstance(cwd: string, runId: string, instanceId: string): TaskAssignmentV2 | null {
  for (const { ids } of walkInstances(cwd, runId)) {
    if (ids.instance_id !== instanceId) continue;
    const a = readTaskAssignmentV2(cwd, taskCellPaths(ids).assignment_path);
    if (a && a.instance_id === instanceId) return a;
  }
  return null;
}

// ── team_lead decision (CD12) ────────────────────────────────────────────────

export interface TaskCellDecisionV1 {
  schema_version: typeof TASK_CELL_DECISION_SCHEMA;
  run_id: string;
  root_id: string;
  instance_id: string;
  assignment_id: string;
  receipt_id: string;
  validation_result_id: string;
  authority: "team_lead";
  lead_binding_id: string;
  decided_by: string;
  decision: "accepted" | "rejected";
  at: string;
  reason: string | null;
}

const derivedDecidedBy = (leadBindingId: string) => `lead_binding:${leadBindingId}`;

/**
 * Operator CLI `decide` (CD12): refuses unless the given lead binding equals the
 * instance assignment's and the claim's. decided_by is DERIVED from the lead
 * binding; any caller-supplied decided_by is ignored (no free text).
 */
export function recordAuthorityDecision(input: {
  cwd: string;
  runId: string;
  instanceId: string;
  leadBindingId: string;
  decision: "accepted" | "rejected";
  reason: string | null;
  now?: () => string;
  /** Ignored: decided_by is always derived from the lead binding. */
  decidedBy?: unknown;
}): { ok: true; path: string; decision: TaskCellDecisionV1 } | Refused {
  if (input.decision !== "accepted" && input.decision !== "rejected") return refuse("decision_invalid");
  if (!isSafeSegment(input.instanceId)) return refuse("instance_unknown");
  const claim = readClaim(input.cwd, input.runId);
  if (!claim) return refuse("controller_claim_absent");
  const assignment = findAssignmentByInstance(input.cwd, input.runId, input.instanceId);
  if (!assignment) return refuse("instance_unknown");
  const lead = leadOf(assignment);
  if (lead.team_lead_instance_id !== null) return refuse("team_lead_instance_unsupported");
  if (input.leadBindingId !== lead.lead_binding_id || input.leadBindingId !== claim.lead_binding_id) {
    return refuse("lead_binding_mismatch");
  }
  const ids = idsOf(assignment);
  const validation = readJsonFile(path.resolve(input.cwd, taskCellPaths(ids).validation_path)) as HandoffValidationV1 | null;
  if (!validation || validation.schema_version !== "guild.handoff_validation.v1" || validation.assignment_id !== assignmentId(assignment)) {
    return refuse("validation_absent");
  }
  if (regularBytes(path.resolve(input.cwd, taskCellPaths(ids).receipt_path)) === null) return refuse("retained_receipt_absent");
  const record: TaskCellDecisionV1 = {
    schema_version: TASK_CELL_DECISION_SCHEMA,
    run_id: input.runId,
    root_id: claim.root_id,
    instance_id: input.instanceId,
    assignment_id: assignmentId(assignment),
    receipt_id: validation.receipt_id,
    validation_result_id: validation.validation_result_id,
    authority: "team_lead",
    lead_binding_id: input.leadBindingId,
    decided_by: derivedDecidedBy(input.leadBindingId),
    decision: input.decision,
    at: (input.now ?? (() => new Date().toISOString()))(),
    reason: input.reason ?? null,
  };
  const rel = decisionRel(input.runId, input.instanceId);
  if (!writeExclusive(path.resolve(input.cwd, rel), json(record))) return refuse("decision_already_recorded");
  return { ok: true, path: rel, decision: record };
}

/** Read and verify a team_lead decision against the current assignment, receipt, validation and claim. */
function readTeamLeadDecision(
  cwd: string,
  assignment: TaskAssignmentV2,
  claim: Pick<TaskCellControllerClaimV1, "lead_binding_id" | "root_id">,
  validation: HandoffValidationV1,
  operatorUid: number,
): { ok: true; decision: TaskCellDecisionV1; ref: FileRef } | Refused {
  const rel = decisionRel(assignment.run_id, assignment.instance_id);
  const abs = path.resolve(cwd, rel);
  if (!fs.existsSync(abs)) return refuse("awaiting_team_lead");
  if (!ownedByUid(abs, operatorUid)) return refuse("team_lead_decision_untrusted_file");
  const bytes = regularBytes(abs)!;
  let d: TaskCellDecisionV1;
  try {
    d = JSON.parse(bytes.toString("utf8")) as TaskCellDecisionV1;
  } catch {
    return refuse("team_lead_decision_malformed");
  }
  if (
    d.schema_version !== TASK_CELL_DECISION_SCHEMA || d.authority !== "team_lead" ||
    d.lead_binding_id !== leadOf(assignment).lead_binding_id || d.lead_binding_id !== claim.lead_binding_id ||
    d.decided_by !== derivedDecidedBy(d.lead_binding_id) || d.run_id !== assignment.run_id ||
    d.root_id !== claim.root_id || d.instance_id !== assignment.instance_id ||
    d.assignment_id !== assignmentId(assignment) || d.receipt_id !== validation.receipt_id ||
    d.validation_result_id !== validation.validation_result_id ||
    (d.decision !== "accepted" && d.decision !== "rejected") || typeof d.at !== "string"
  ) return refuse("team_lead_decision_mismatch");
  return { ok: true, decision: d, ref: { path: rel, sha256: sha256(bytes) } };
}

// ── reviewer_cell from the approved broker slot (CD12 a–f) ───────────────────

export interface ReviewRequestV1 {
  schema_version: typeof TASK_CELL_REVIEW_REQUEST_SCHEMA;
  request_id: string;
  packet_id: string;
  reviewer_participant_id: string;
  participation_kind: string;
  role_ref: string;
  proposal_sha256: string;
  retained_receipt: FileRef;
  reviewed: { cell_id: string; logical_task_id: string; instance_id: string; worker_role: string; host_family: string };
  evidence_dir: string;
}

export interface ReviewerAuthority {
  decision: "accepted" | "rejected" | "awaiting" | "review_refused";
  reason: string | null;
  gate_conditions?: GatePassConditions;
  /** Pins for the acceptance evidence's review block (present once all files verified). */
  evidence?: {
    reviewer_participant_id: string;
    participation_kind: string;
    role_ref: string;
    packet_id: string;
    request: FileRef;
    candidate: FileRef;
    packet: FileRef;
    invocation: FileRef & { invocation_id: string };
    adapter_exit: FileRef;
    result: FileRef;
    reviewer_family: string;
    author_family: string;
    independence: string;
    served_model: string;
    finished_at: string;
  };
}

/** packet_id = '<run_id>-<logical_task_id>-a<attempt>-review' (CD12). */
export function reviewPacketId(ids: Pick<TaskCellInstanceIds, "run_id" | "logical_task_id" | "attempt">): string {
  return `${ids.run_id}-${ids.logical_task_id}-a${ids.attempt}-review`;
}

/** The request fields every broker review request carries (TaskCell and source-basis). */
interface BrokerRequestCore {
  request_id: string;
  packet_id: string;
  reviewer_participant_id: string;
  participation_kind: string;
  role_ref: string;
  proposal_sha256: string;
  reviewed: { host_family: string };
  evidence_dir: string;
}

/**
 * The shared CD12 (a)–(f) verifier. Request-kind–specific joins run through
 * `requestJoin` at the same point the TaskCell receipt pin always ran (after the
 * candidate packet check, before the invocation join), so every TaskCell check
 * and refusal reason is unchanged.
 */
function verifyBrokerReview(input: {
  cwd: string;
  requestAbs: string;
  proposal: TeamProposalV2;
  reviewedHostFamily: string;
  operatorUid: number;
  knownInvocationIds?: readonly string[];
  parseRequest: (value: unknown) => BrokerRequestCore | null;
  requestJoin: (request: BrokerRequestCore, candidate: Record<string, unknown>) => string | null;
}): ReviewerAuthority {
  const refused = (reason: string): ReviewerAuthority => ({ decision: "review_refused", reason });
  const requestAbs = input.requestAbs;
  if (!fs.existsSync(requestAbs)) return { decision: "awaiting", reason: "review_request_absent" };
  if (!ownedByUid(requestAbs, input.operatorUid)) return refused("review_file_untrusted:request");
  const requestBytes = fs.readFileSync(requestAbs);
  let request: BrokerRequestCore | null;
  try {
    request = input.parseRequest(JSON.parse(requestBytes.toString("utf8")));
  } catch {
    return refused("review_request_malformed");
  }
  if (!request || typeof request.evidence_dir !== "string" || typeof request.packet_id !== "string") return refused("review_request_malformed");
  const dirAbs = path.resolve(input.cwd, request.evidence_dir);
  const rel = (name: string) => path.relative(input.cwd, path.join(dirAbs, name));
  const names = ["candidate.json", "packet.txt", "adapter-exit.json", "result.json", "invocation.json"] as const;
  // (a) every file regular, non-symlink and operator-owned. Missing → awaiting.
  for (const name of names) {
    const abs = path.join(dirAbs, name);
    let exists = false;
    try {
      fs.lstatSync(abs);
      exists = true;
    } catch {
      exists = false;
    }
    if (!exists) return { decision: "awaiting", reason: name === "invocation.json" ? "review_invocation_absent" : `review_evidence_absent:${name}` };
    if (!ownedByUid(abs, input.operatorUid)) return refused(`review_file_untrusted:${name}`);
  }
  const bytes = Object.fromEntries(names.map((n) => [n, fs.readFileSync(path.join(dirAbs, n))])) as Record<(typeof names)[number], Buffer>;
  const parse = (n: (typeof names)[number]): Record<string, unknown> | null => {
    try {
      const v = JSON.parse(bytes[n].toString("utf8"));
      return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  };
  const candidate = parse("candidate.json");
  const adapterExit = parse("adapter-exit.json");
  const invocation = validateReviewInvocationV1(parse("invocation.json"));
  if (!candidate || !adapterExit) return refused("review_evidence_malformed");
  if (!invocation) return refused("review_invocation_malformed");

  // (b) approved slot: participation_kind and role_ref checked as separate fields.
  if (request.proposal_sha256 !== input.proposal.proposal_hash) return refused("proposal_mismatch");
  const slot = input.proposal.participants.find((p) => p.participant_id === request!.reviewer_participant_id);
  if (!slot) return refused("reviewer_not_in_proposal");
  if (slot.participation_kind !== "reviewer_cross_host" || request.participation_kind !== "reviewer_cross_host") {
    return refused("reviewer_slot_not_cross_host");
  }
  if (request.role_ref !== slot.role_ref) return refused("reviewer_role_mismatch");
  if (candidate["reviewer_participant_id"] !== slot.participant_id) return refused("candidate_participant_mismatch");
  if (candidate["reviewer_role"] !== slot.role_ref) return refused("candidate_role_mismatch");
  if (candidate["packet_id"] !== request.packet_id) return refused("candidate_packet_mismatch");
  const joinRefusal = input.requestJoin(request, candidate);
  if (joinRefusal !== null) return refused(joinRefusal);

  // (c) invocation join.
  if (
    invocation.packet_id !== request.packet_id || invocation.request_id !== request.request_id ||
    invocation.reviewer_participant_id !== request.reviewer_participant_id ||
    invocation.participation_kind !== request.participation_kind || invocation.role_ref !== request.role_ref
  ) return refused("invocation_request_mismatch");
  const joins: Array<[keyof typeof invocation, Buffer, string]> = [
    ["request", requestBytes, path.relative(input.cwd, requestAbs)],
    ["candidate", bytes["candidate.json"], rel("candidate.json")],
    ["packet", bytes["packet.txt"], rel("packet.txt")],
    ["result", bytes["result.json"], rel("result.json")],
    ["adapter_exit", bytes["adapter-exit.json"], rel("adapter-exit.json")],
  ];
  for (const [field, b, relPath] of joins) {
    const ref = invocation[field] as { path: string; sha256: string };
    if (ref.sha256 !== sha256(b) || path.normalize(ref.path) !== path.normalize(relPath)) return refused(`invocation_hash_mismatch:${String(field)}`);
  }
  if ((input.knownInvocationIds ?? []).includes(invocation.invocation_id)) return refused("invocation_id_reused");
  const adapterMismatch = invocationAdapterMismatch(invocation, adapterExit);
  if (adapterMismatch !== null) return refused(`invocation_adapter_mismatch:${adapterMismatch}`);
  if (invocation.exit !== 0 || adapterExit["exit"] !== 0) return refused("broker_exit_nonzero");
  if (!(Date.parse(invocation.started_at) < Date.parse(invocation.finished_at))) return refused("invocation_times_invalid");
  try {
    const resultMtime = fs.lstatSync(path.join(dirAbs, "result.json")).mtimeMs;
    const invocationMtime = fs.lstatSync(path.join(dirAbs, "invocation.json")).mtimeMs;
    if (resultMtime > invocationMtime) return refused("result_after_invocation");
  } catch {
    return refused("review_evidence_unreadable");
  }

  // (d) independence.
  if (invocation.reviewer_family === invocation.author_family) return refused("same_family_review");
  if (invocation.author_family !== input.reviewedHostFamily || request.reviewed?.host_family !== input.reviewedHostFamily) {
    return refused("author_family_not_reviewed_host");
  }
  if (invocation.independence !== REQUIRED_INDEPENDENCE[slot.participation_kind]) return refused("independence_mismatch");

  // (e) canonical result, then (f) the unchanged gate evaluator.
  const result = validateReviewResultV1Strict(parse("result.json"));
  if (!result) return refused("review_result_not_canonical");
  const gate = evaluateGatePass({
    resultRaw: bytes["result.json"].toString("utf8"),
    artifactBytes: bytes["candidate.json"],
    packetId: request.packet_id,
    forcePass: false,
  });
  const evidence: ReviewerAuthority["evidence"] = {
    reviewer_participant_id: slot.participant_id,
    participation_kind: slot.participation_kind,
    role_ref: slot.role_ref,
    packet_id: request.packet_id,
    request: { path: path.relative(input.cwd, requestAbs), sha256: sha256(requestBytes) },
    candidate: { path: rel("candidate.json"), sha256: sha256(bytes["candidate.json"]) },
    packet: { path: rel("packet.txt"), sha256: sha256(bytes["packet.txt"]) },
    invocation: { path: rel("invocation.json"), sha256: sha256(bytes["invocation.json"]), invocation_id: invocation.invocation_id },
    adapter_exit: { path: rel("adapter-exit.json"), sha256: sha256(bytes["adapter-exit.json"]) },
    result: { path: rel("result.json"), sha256: sha256(bytes["result.json"]) },
    reviewer_family: invocation.reviewer_family,
    author_family: invocation.author_family,
    independence: invocation.independence,
    served_model: invocation.served_model,
    finished_at: invocation.finished_at,
  };
  if (!gate.conditions.parses || !gate.conditions.packet_id_match || !gate.conditions.sha256_match) {
    return { decision: "review_refused", reason: "gate_binding_failed", gate_conditions: gate.conditions };
  }
  if (!gate.pass) return { decision: "rejected", reason: "review_not_satisfied", gate_conditions: gate.conditions, evidence };
  return { decision: "accepted", reason: null, gate_conditions: gate.conditions, evidence };
}

/**
 * Derive reviewer_cell from root's broker evidence for one review request
 * (CD12). awaiting when a required file (including the invocation record) is
 * absent; rejected for a canonical non-satisfied or blocking result; accepted
 * only when (a)–(f) all hold; review_refused for anything else. There is no
 * force-pass path, and a nonzero exit never grants authority.
 */
export function deriveReviewerCellAuthority(input: {
  cwd: string;
  requestPath: string;
  proposal: TeamProposalV2;
  reviewedHostFamily: string;
  operatorUid: number;
  knownInvocationIds?: readonly string[];
}): ReviewerAuthority {
  return verifyBrokerReview({
    cwd: input.cwd,
    requestAbs: path.isAbsolute(input.requestPath) ? input.requestPath : path.resolve(input.cwd, input.requestPath),
    proposal: input.proposal,
    reviewedHostFamily: input.reviewedHostFamily,
    operatorUid: input.operatorUid,
    knownInvocationIds: input.knownInvocationIds,
    parseRequest: (value) => value as ReviewRequestV1,
    requestJoin: (request, candidate) => {
      const r = request as unknown as ReviewRequestV1;
      const pinned = candidate["retained_receipt"] as { path?: unknown; sha256?: unknown } | undefined;
      if (pinned?.path !== r.retained_receipt?.path || pinned?.sha256 !== r.retained_receipt?.sha256) {
        return "candidate_receipt_not_pinned";
      }
      const receiptNow = regularBytes(path.resolve(input.cwd, r.retained_receipt.path));
      if (receiptNow === null || sha256(receiptNow) !== r.retained_receipt.sha256) return "retained_receipt_changed";
      return null;
    },
  });
}

// ── Reviewed source basis (CD22, F1) ─────────────────────────────────────────

/**
 * A source-commit review request (root-confirmed additive shape). It names the
 * reviewed commit and carries no TaskCell, instance or receipt identifiers.
 */
export interface SourceBasisReviewRequestV1 {
  schema_version: typeof SOURCE_BASIS_REVIEW_REQUEST_SCHEMA;
  request_id: string;
  packet_id: string;
  reviewer_participant_id: string;
  participation_kind: string;
  role_ref: string;
  proposal_sha256: string;
  reviewed_commit: string;
  reviewed: { host_family: string };
  evidence_dir: string;
}

/** Where the genuine basis review lives: its own Guild root, proposal, decision and request. */
export interface ReviewedBasisInput {
  /** Absolute Guild root holding the basis review (may differ from the TaskCell root). */
  root: string;
  /** Root-relative path of the basis review's approved guild.team_proposal.v2. */
  proposalPath: string;
  /** Root-relative path of the guild.team_decision.v1 approving that proposal. */
  decisionPath: string;
  /** Root-relative path of the guild.source_basis_review_request.v1. */
  requestPath: string;
}

/** The immutable proof pinned in claim.reviewed_basis and re-verified on every read. */
export interface ReviewedBasisPins {
  root: string;
  commit: string;
  proposal: FileRef;
  decision: FileRef;
  request: FileRef;
  candidate: FileRef;
  packet: FileRef;
  adapter_exit: FileRef;
  invocation: FileRef & { invocation_id: string };
  result: FileRef;
}

const COMMIT_HEX = /^[0-9a-f]{40}$/;

function parseSourceBasisRequest(value: unknown): SourceBasisReviewRequestV1 | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (v["schema_version"] !== SOURCE_BASIS_REVIEW_REQUEST_SCHEMA) return null;
  for (const k of ["request_id", "packet_id", "reviewer_participant_id", "participation_kind", "role_ref", "proposal_sha256", "evidence_dir"]) {
    if (typeof v[k] !== "string" || (v[k] as string).length === 0) return null;
  }
  if (typeof v["reviewed_commit"] !== "string" || !COMMIT_HEX.test(v["reviewed_commit"])) return null;
  const reviewed = v["reviewed"] as Record<string, unknown> | undefined;
  if (!reviewed || typeof reviewed["host_family"] !== "string" || reviewed["host_family"].length === 0) return null;
  return v as unknown as SourceBasisReviewRequestV1;
}

/** Invocation ids used by any OTHER request's evidence of the same run (source-basis or TaskCell). */
function otherRunInvocationIds(root: string, runId: string, exceptPacket: string): string[] {
  return otherInvocationIds(root, runId, exceptPacket);
}

function readRootFile(root: string, rel: string, operatorUid: number): { bytes: Buffer; ref: FileRef } | null {
  if (typeof rel !== "string" || rel.length === 0 || path.isAbsolute(rel)) return null;
  const abs = path.resolve(root, rel);
  const relNorm = path.relative(root, abs);
  if (relNorm.startsWith("..") || path.isAbsolute(relNorm)) return null;
  if (!ownedByUid(abs, operatorUid)) return null;
  const bytes = regularBytes(abs);
  return bytes === null ? null : { bytes, ref: { path: relNorm, sha256: sha256(bytes) } };
}

export type SourceBasisVerdict =
  | { ok: true; pins: ReviewedBasisPins }
  | { ok: false; reason: "basis_unreviewed" | "source_commit_absent"; detail: string };

/**
 * Verify a reviewed source basis (CD22 + root Q1–Q3): the basis proposal is
 * approved by its decision through the canonical dispatchGate; the source-basis
 * request is bound to that proposal and passes the same CD12 (a)–(f) checks as a
 * TaskCell review; request.reviewed_commit and candidate.reviewed_commit are the
 * same 40-hex commit and equal `expectedCommit` (the verified package's
 * source_commit). Read-only; never rewrites any basis file.
 */
export function verifySourceBasisReview(input: {
  basis: ReviewedBasisInput;
  expectedCommit: string | null;
  operatorUid: number;
}): SourceBasisVerdict {
  const no = (detail: string): SourceBasisVerdict => ({ ok: false, reason: "basis_unreviewed", detail });
  if (input.expectedCommit === null) return { ok: false, reason: "source_commit_absent", detail: "package source_commit is null" };
  if (!COMMIT_HEX.test(input.expectedCommit)) return no("package source_commit is not a 40-hex commit");
  const b = input.basis;
  if (!b || typeof b.root !== "string" || !path.isAbsolute(b.root)) return no("basis root must be absolute");
  let root: string;
  try {
    root = fs.realpathSync(b.root);
  } catch {
    return no("basis root unreadable");
  }
  const proposalFile = readRootFile(root, b.proposalPath, input.operatorUid);
  const decisionFile = readRootFile(root, b.decisionPath, input.operatorUid);
  if (!proposalFile || !decisionFile) return no("basis proposal or decision unreadable");
  let proposal: TeamProposalV2;
  let decision: TeamDecisionV1;
  try {
    proposal = parseYaml(proposalFile.bytes.toString("utf8")) as TeamProposalV2;
    decision = parseYaml(decisionFile.bytes.toString("utf8")) as TeamDecisionV1;
  } catch {
    return no("basis proposal or decision unparseable");
  }
  const gate = dispatchGate(proposal, decision);
  if (!gate.allowed) return no(`basis decision does not approve the basis proposal: ${gate.reason ?? ""}`);
  const requestFile = readRootFile(root, b.requestPath, input.operatorUid);
  if (!requestFile) return no("basis request unreadable");
  let request: SourceBasisReviewRequestV1 | null;
  try {
    request = parseSourceBasisRequest(JSON.parse(requestFile.bytes.toString("utf8")));
  } catch {
    request = null;
  }
  if (!request) return no("basis request is not a guild.source_basis_review_request.v1");
  const authority = verifyBrokerReview({
    cwd: root,
    requestAbs: path.resolve(root, requestFile.ref.path),
    proposal,
    reviewedHostFamily: request.reviewed.host_family,
    operatorUid: input.operatorUid,
    knownInvocationIds: otherRunInvocationIds(root, proposal.run_id, request.packet_id),
    parseRequest: parseSourceBasisRequest,
    requestJoin: (req, candidate) => {
      const r = req as unknown as SourceBasisReviewRequestV1;
      return candidate["reviewed_commit"] === r.reviewed_commit ? null : "candidate_commit_mismatch";
    },
  });
  if (authority.decision !== "accepted" || !authority.evidence) return no(`basis review ${authority.decision}: ${authority.reason ?? ""}`);
  if (request.reviewed_commit !== input.expectedCommit) return no("reviewed_commit is not the package source_commit");
  const e = authority.evidence;
  return {
    ok: true,
    pins: {
      root, commit: request.reviewed_commit, proposal: proposalFile.ref, decision: decisionFile.ref, request: e.request,
      candidate: e.candidate, packet: e.packet, adapter_exit: e.adapter_exit, invocation: e.invocation, result: e.result,
    },
  };
}

/**
 * Re-verify pinned basis proof (preflight P6, CD17b check 8): every pinned file
 * still hashes to its pin, the full basis verification still holds from the
 * pinned paths, and its commit equals the current package source_commit.
 */
export function reverifyReviewedBasis(pins: ReviewedBasisPins | null | undefined, currentCommit: string | null, operatorUid: number): boolean {
  if (!pins || typeof pins.root !== "string") return false;
  for (const ref of [pins.proposal, pins.decision, pins.request, pins.candidate, pins.packet, pins.adapter_exit, pins.invocation, pins.result]) {
    const bytes = ref && regularBytes(path.resolve(pins.root, ref.path));
    if (!bytes || sha256(bytes) !== ref.sha256) return false;
  }
  const again = verifySourceBasisReview({
    basis: { root: pins.root, proposalPath: pins.proposal.path, decisionPath: pins.decision.path, requestPath: pins.request.path },
    expectedCommit: currentCommit,
    operatorUid,
  });
  return again.ok && again.pins.commit === pins.commit && JSON.stringify(again.pins) === JSON.stringify(pins);
}

/** Invocation ids already used by any OTHER review request's evidence in this run. */
function otherInvocationIds(cwd: string, runId: string, exceptPacket: string): string[] {
  const reviewRoot = path.resolve(cwd, runRel(runId, "review"));
  let dirs: string[];
  try {
    dirs = fs.readdirSync(reviewRoot);
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const d of dirs) {
    if (d === exceptPacket) continue;
    const inv = readJsonFile(path.join(reviewRoot, d, "invocation.json")) as { invocation_id?: unknown } | null;
    if (typeof inv?.invocation_id === "string") out.push(inv.invocation_id);
  }
  return out;
}

// ── Acceptance evidence (CD17) and the one E00 release predicate ─────────────

/**
 * The CD23 real_consumer_context: the CURRENT reader's context, every field
 * required and independently re-verified at each read (never trusted as given).
 */
export interface ReleaseConsumerContext {
  root_id: string;
  source_id: string;
  source_revision: string;
  package_identity: { id: string; sha256: string };
  package_root: string;
  provider: string;
  host_profile_id: string;
  run_id: string;
  instance_ids: string[];
}

export interface ConsumerContextInput {
  mode: "same_run" | "release";
  /** release mode: the complete CD23 real_consumer_context the reader re-verifies now. */
  context?: ReleaseConsumerContext;
}

export interface ConsumerSpec {
  policy: WorkerTrustPolicy;
  context: ConsumerContextInput;
}

export interface ProducerContext {
  source_id: string;
  source_revision: string | null;
  package_identity: { id: string; sha256: string } | null;
  provider: string;
  host_profile_id: string | null;
}

interface EvidencePin extends FileRef { role: string }

export interface AcceptanceEvidencePreV1 {
  schema_version: typeof ACCEPTANCE_EVIDENCE_SCHEMA;
  identity: {
    root_id: string; source_id: string; root_fingerprint: string | null; run_id: string;
    logical_task_id: string; attempt: number; instance_id: string; controller_instance_id: string;
    operator_uid: number; worker_uid: number; lead_binding_id: string;
  };
  producer_context: ProducerContext & {
    package_release_version: string | null; package_current_package: string | null; package_root: string | null;
    worker_trust_policy: WorkerTrustPolicy; acceptance_policy_version: string; lead_binding_id: string;
    /** The claim's reviewed source-basis pins (root Q2), re-verified at CD17b check 8. */
    reviewed_basis: ReviewedBasisPins | null;
  };
  bound_artifacts: {
    assignment_sha256: string;
    done_when_ref: unknown;
    retained_receipt_sha256: string;
    origin_sha256: string;
    validation_result_id: string;
    validation_sha256: string;
    ledger_sha256: string;
    oracle_evidence: Array<FileRef & { oracle_id: string; result: string }>;
    team_lead: FileRef & { lead_binding_id: string; decided_by: string; decision: string; at: string };
    review: (NonNullable<ReviewerAuthority["evidence"]> & { source: "broker"; result_schema_valid: true; exit: 0; gate_conditions: GatePassConditions }) | null;
    deterministic_floor: { validated_at: string };
    oracle_plan: FileRef;
    oracle_plan_decision: FileRef;
    ack_claim: FileRef;
  };
  /** Every bound file, verified by hash at CD17b check 3 and by the closed audit. */
  pins: EvidencePin[];
  intended_acceptance: IntendedAcceptance;
  reviewer_cell_id: null;
  written_at: string;
}

export interface AcceptanceEvidenceFinalV1 {
  schema_version: typeof ACCEPTANCE_EVIDENCE_FINAL_SCHEMA;
  pre_sha256: string;
  acceptance_sha256: string;
  finalized_at: string;
  reconciliation_manifest: Array<{ kind: "acceptance" | "validation" | "handoff"; path: string; sha256: string }>;
  reconciliation_manifest_complete: true;
}

export type QualificationReason =
  | "not_released"
  | "finalization_incomplete"
  | "evidence_untrusted_file"
  | "evidence_binding_mismatch"
  | "bound_hash_mismatch"
  | "root_identity_mismatch"
  | "qualified_other_context"
  | "package_identity_unverified"
  | "source_commit_absent"
  | "authorities_mismatch"
  | "lifecycle_event_incomplete"
  | "reconciliation_sidecar_missing"
  | "reconciliation_manifest_incomplete"
  | "prerelease_bus_join_missing"
  | "basis_unreviewed";

export interface QualificationVerdict {
  qualified_release: boolean;
  reason: QualificationReason | null;
  mechanical_acceptance: "accepted" | "rejected";
  /** Historical fact: the producing context sealed in pre.json. */
  producer_context: ProducerContext | null;
  /** Current fact: the reader's consumer context as verified at this read (null when unverifiable). */
  consumer_context: ProducerContext | null;
}

function readPre(cwd: string, ids: TaskCellInstanceIds): { pre: AcceptanceEvidencePreV1; bytes: Buffer; abs: string } | null {
  const abs = path.resolve(cwd, evidenceRel(ids.run_id, ids.instance_id, "pre.json"));
  const bytes = regularBytes(abs);
  if (bytes === null) return null;
  try {
    const pre = JSON.parse(bytes.toString("utf8")) as AcceptanceEvidencePreV1;
    return pre.schema_version === ACCEPTANCE_EVIDENCE_SCHEMA ? { pre, bytes, abs } : null;
  } catch {
    return null;
  }
}

function producerOf(pre: AcceptanceEvidencePreV1): ProducerContext {
  const p = pre.producer_context;
  return { source_id: p.source_id, source_revision: p.source_revision, package_identity: p.package_identity, provider: p.provider, host_profile_id: p.host_profile_id };
}

const sameContext = (a: ProducerContext, b: ProducerContext): boolean =>
  a.source_id === b.source_id && a.source_revision === b.source_revision &&
  a.package_identity?.id === b.package_identity?.id && a.package_identity?.sha256 === b.package_identity?.sha256 &&
  a.provider === b.provider && a.host_profile_id === b.host_profile_id;

/**
 * F6 / CD23: verify a release consumer context NOW. Every field is required;
 * root_id/source_id must be the reader's own root, run_id the acceptance's run
 * and the instance one of instance_ids; the package is re-read through
 * readVerifiedReleasePackageIdentity and must match identity and source
 * revision; the provider's host profile is recomputed. Null on any gap.
 */
function verifyReleaseConsumerContext(
  c: ReleaseConsumerContext | undefined,
  root: RootIdentity,
  ids: TaskCellInstanceIds,
): ProducerContext | null {
  if (!c || typeof c !== "object") return null;
  const str = (v: unknown) => typeof v === "string" && v.length > 0;
  if (![c.root_id, c.source_id, c.source_revision, c.package_root, c.provider, c.host_profile_id, c.run_id].every(str)) return null;
  if (!c.package_identity || !str(c.package_identity.id) || !str(c.package_identity.sha256)) return null;
  if (!Array.isArray(c.instance_ids) || !c.instance_ids.every(str)) return null;
  if (c.root_id !== root.root_id || c.source_id !== root.source_id) return null;
  if (c.run_id !== ids.run_id || !c.instance_ids.includes(ids.instance_id)) return null;
  if (!path.isAbsolute(c.package_root)) return null;
  let current: PackageIdentityView;
  try {
    current = readPackageIdentity(c.package_root);
  } catch {
    return null;
  }
  if (current.package_identity.id !== c.package_identity.id || current.package_identity.sha256 !== c.package_identity.sha256) return null;
  if (current.source_revision === null || current.source_revision !== c.source_revision) return null;
  if (c.host_profile_id !== hostProfileId(c.provider)) return null;
  return {
    source_id: c.source_id, source_revision: c.source_revision, package_identity: { id: c.package_identity.id, sha256: c.package_identity.sha256 },
    provider: c.provider, host_profile_id: c.host_profile_id,
  };
}

function lifecycleEventsComplete(cwd: string, ids: TaskCellInstanceIds): boolean {
  const telemetryDir = path.join(durableGuildDir(cwd), "runs", ids.run_id, "task-cell-telemetry");
  if (!fs.existsSync(path.join(telemetryDir, "events.jsonl"))) return false;
  let events: ReturnType<typeof readTaskCellLifecycleEvents>;
  try {
    events = readTaskCellLifecycleEvents({ cwd, runId: ids.run_id });
  } catch {
    return false;
  }
  for (const name of ["handoff_validated", "handoff_accepted"]) {
    const event = events.find((e) => e.instance_id === ids.instance_id && e.event_name === name);
    if (!event || !fs.existsSync(path.join(telemetryDir, "event-ids", event.event_id))) return false;
  }
  return true;
}

/**
 * CD17b — the only E00 release predicate. True only if the frozen acceptance
 * released downstream AND its sealed pre/final evidence still verifies now for
 * this consumer: bound hashes, root identity, trust policy, verified installed
 * package and source revision, authorities, producer/consumer context,
 * lifecycle and reconciliation completeness, and the pre-release bus/CAS
 * joins. Source-run harnesses fail check 8 by construction (mechanics_only).
 */
export function isQualifiedDownstreamRelease(cwd: string, runAcceptance: RunAcceptance, consumer: ConsumerSpec): QualificationVerdict {
  const ids = runAcceptance.ids;
  const acceptance = runAcceptance.acceptance;
  const mechanical = acceptance.downstream_release_at !== null ? "accepted" : "rejected";
  let verifiedConsumer: ProducerContext | null = null;
  const verdict = (reason: QualificationReason | null, producer: ProducerContext | null = null): QualificationVerdict =>
    ({ qualified_release: reason === null, reason, mechanical_acceptance: mechanical, producer_context: producer, consumer_context: verifiedConsumer });
  // (1)
  if (acceptance.downstream_release_at === null) return verdict("not_released");
  // (2)
  const uid = currentUid();
  const preRead = readPre(cwd, ids);
  const finalAbs = path.resolve(cwd, evidenceRel(ids.run_id, ids.instance_id, "final.json"));
  const finalBytes = regularBytes(finalAbs);
  if (!preRead || finalBytes === null) return verdict("finalization_incomplete");
  if (!ownedByUid(preRead.abs, uid) || !ownedByUid(finalAbs, uid)) return verdict("evidence_untrusted_file");
  const { pre } = preRead;
  const producer = producerOf(pre);
  let final: AcceptanceEvidenceFinalV1;
  try {
    final = JSON.parse(finalBytes.toString("utf8")) as AcceptanceEvidenceFinalV1;
  } catch {
    return verdict("finalization_incomplete", producer);
  }
  const acceptanceBytes = regularBytes(path.resolve(cwd, taskCellPaths(ids).acceptance_path));
  if (
    final.schema_version !== ACCEPTANCE_EVIDENCE_FINAL_SCHEMA || final.pre_sha256 !== sha256(preRead.bytes) ||
    acceptanceBytes === null || final.acceptance_sha256 !== sha256(acceptanceBytes)
  ) return verdict("evidence_binding_mismatch", producer);
  if (
    pre.identity.run_id !== ids.run_id || pre.identity.instance_id !== ids.instance_id ||
    pre.identity.logical_task_id !== ids.logical_task_id || pre.identity.attempt !== ids.attempt
  ) return verdict("evidence_binding_mismatch", producer);
  // (3)
  for (const pin of pre.pins) {
    const bytes = regularBytes(path.resolve(cwd, pin.path));
    if (bytes === null || sha256(bytes) !== pin.sha256) return verdict("bound_hash_mismatch", producer);
  }
  // (4)
  let root: RootIdentity;
  try {
    root = readRootIdentity(cwd);
  } catch {
    return verdict("root_identity_mismatch", producer);
  }
  if (root.root_id !== pre.identity.root_id || root.source_id !== pre.identity.source_id || root.root_fingerprint !== pre.identity.root_fingerprint) {
    return verdict("root_identity_mismatch", producer);
  }
  // (7)
  const policy = pre.producer_context.worker_trust_policy;
  const policyOk = policy === "cooperative_local" ? consumer.policy === "cooperative_local" : consumer.policy === policy;
  if (!policyOk) return verdict("qualified_other_context", producer);
  // (8)
  if (pre.producer_context.package_root === null || pre.producer_context.package_identity === null) {
    return verdict("package_identity_unverified", producer);
  }
  let pkg: PackageIdentityView;
  try {
    pkg = readPackageIdentity(pre.producer_context.package_root);
  } catch {
    return verdict("package_identity_unverified", producer);
  }
  if (pkg.package_identity.id !== producer.package_identity!.id || pkg.package_identity.sha256 !== producer.package_identity!.sha256) {
    return verdict("package_identity_unverified", producer);
  }
  if (pkg.source_revision === null || producer.source_revision === null) return verdict("source_commit_absent", producer);
  if (pkg.source_revision !== producer.source_revision) return verdict("package_identity_unverified", producer);
  // F1: the reviewed source basis pinned at start still verifies against the current package commit.
  if (!reverifyReviewedBasis(pre.producer_context.reviewed_basis, pkg.source_revision, uid)) return verdict("basis_unreviewed", producer);
  // (9)
  const observed = acceptance.authorities_observed;
  if (
    JSON.stringify(observed) !== JSON.stringify(pre.intended_acceptance.authorities_observed) ||
    !observed.some((o) => o.authority === "deterministic_floor") ||
    !observed.every((o) => o.decision === "accepted")
  ) return verdict("authorities_mismatch", producer);
  // (10) The consumer context is a CURRENT fact the reader verifies now; the producer
  // context above is the historical fact sealed in pre.json. They must be equal.
  let consumerContext: ProducerContext | null = null;
  if (consumer.context.mode === "same_run") {
    const claim = readClaim(cwd, ids.run_id);
    if (claim && claim.run_id === ids.run_id && claim.host_profile_id === hostProfileId(claim.provider)) {
      consumerContext = {
        source_id: claim.source_id, source_revision: claim.source_revision, package_identity: claim.package_identity,
        provider: claim.provider, host_profile_id: claim.host_profile_id,
      };
    }
  } else {
    consumerContext = verifyReleaseConsumerContext(consumer.context.context, root, ids);
  }
  if (!consumerContext) return verdict("qualified_other_context", producer);
  verifiedConsumer = consumerContext;
  if (!sameContext(producer, consumerContext)) return verdict("qualified_other_context", producer);
  // (11)
  if (!lifecycleEventsComplete(cwd, ids)) return verdict("lifecycle_event_incomplete", producer);
  if (final.reconciliation_manifest_complete !== true || !Array.isArray(final.reconciliation_manifest)) {
    return verdict("reconciliation_manifest_incomplete", producer);
  }
  const events = readBusLog(path.join(durableGuildDir(cwd), "runs", ids.run_id));
  for (const entry of final.reconciliation_manifest) {
    const bytes = regularBytes(path.resolve(cwd, entry.path));
    if (bytes === null || sha256(bytes) !== entry.sha256) return verdict("reconciliation_sidecar_missing", producer);
    let side: Record<string, unknown>;
    try {
      side = JSON.parse(bytes.toString("utf8")) as Record<string, unknown>;
    } catch {
      return verdict("reconciliation_sidecar_missing", producer);
    }
    const fact = Date.parse(String(side["fact_at"]));
    const rec = Date.parse(String(side["reconciled_at"]));
    if (!(fact <= rec)) return verdict("reconciliation_sidecar_missing", producer);
    const seq = side["bus_seq"];
    if (!events.some((e) => e.seq === seq && e.path === side["path"] && e.sha256 === side["sha256"])) {
      return verdict("reconciliation_sidecar_missing", producer);
    }
  }
  const sidecarDir = path.resolve(cwd, controllerRel(ids.run_id, "reconciliations", ids.instance_id));
  let sidecars: string[] = [];
  try {
    sidecars = fs.readdirSync(sidecarDir);
  } catch {
    sidecars = [];
  }
  const listed = new Set(final.reconciliation_manifest.map((m) => path.normalize(m.path)));
  for (const name of sidecars) {
    if (!listed.has(path.normalize(reconciliationRel(ids.run_id, ids.instance_id, path.basename(name, ".json"))))) {
      return verdict("reconciliation_manifest_incomplete", producer);
    }
  }
  // (12)
  const kinds: TaskCellArtifactKind[] = ["assignment", "ack", "handoff", "validation", "acceptance", "team_plan"];
  const assignment = readTaskAssignmentV2(cwd, taskCellPaths(ids).assignment_path);
  if (!assignment) return verdict("prerelease_bus_join_missing", producer);
  if (fs.existsSync(path.resolve(cwd, assignment.context_bundle_id))) kinds.push("context");
  if (verifyPrereleaseBusJoins(cwd, ids, kinds).some((j) => j.reason !== null)) return verdict("prerelease_bus_join_missing", producer);
  const plan = readTeamPlan(cwd, ids.run_id, assignment.phase_id as never);
  const planBytes = regularBytes(path.resolve(cwd, runRel(ids.run_id, "team-plan", `${assignment.phase_id}.json`)));
  if (!plan || planBytes === null) return verdict("prerelease_bus_join_missing", producer);
  return verdict(null, producer);
}

/**
 * The qualified acceptance set for a consumer: findRunAcceptances filtered
 * through CD17b. This wrapper is the ONLY place this module reads the raw
 * acceptance enumerator; release, admission and oracle consumers use it.
 */
export function findQualifiedRunAcceptances(cwd: string, runId: string, consumer: ConsumerSpec): RunAcceptance[] {
  return findRunAcceptances(cwd, runId).filter((ra) => isQualifiedDownstreamRelease(cwd, ra, consumer).qualified_release);
}

// ── Read-only status (CD7) ───────────────────────────────────────────────────

export interface ControllerStatusInstance {
  instance_id: string;
  logical_task_id: string;
  runtime_state: string | null;
  attempt_terminal_state: string | null;
  mechanical_acceptance: "none" | "accepted" | "rejected";
  qualified_release: boolean | "unknown";
  release_telemetry_state: string;
  cleanup_state: string;
  awaiting: string | null;
}

/**
 * Exact read-only status view (CD7): one schema for every liveness state, zero
 * writes. qualification is historical (does sealed evidence verify for this
 * consumer), readiness is current (can this host and package execute the
 * policy now); they are separate objects. No credential, binding path or
 * mutation command appears in the payload.
 */
export function readControllerStatus(input: {
  cwd: string;
  runId: string;
  consumerPolicy: WorkerTrustPolicy;
  consumerContext?: ConsumerContextInput;
  viewVersion?: string;
  managementSessionId?: string | null;
  packageRoot?: string | null;
  now?: () => string;
}): Record<string, unknown> {
  if (input.viewVersion !== undefined && input.viewVersion !== TASK_CELL_CONTROLLER_STATUS_VIEW) {
    throw new ControllerRefusal("view_version_unsupported");
  }
  const now = (input.now ?? (() => new Date().toISOString()))();
  const root = (() => {
    try {
      return readRootIdentity(input.cwd);
    } catch {
      return null;
    }
  })();
  const claimPresent = fs.existsSync(path.resolve(input.cwd, claimRel(input.runId)));
  const claim = readClaim(input.cwd, input.runId);
  const owner = classifyControllerOwner(input.cwd, input.runId, now);
  const consumerContext = input.consumerContext ?? { mode: "same_run" as const };
  const consumer: ConsumerSpec = { policy: input.consumerPolicy, context: consumerContext };

  const instances: ControllerStatusInstance[] = [];
  let anyQualified = false;
  let anyOtherContext = false;
  let anyIncomplete = false;
  for (const { ids } of walkInstances(input.cwd, input.runId)) {
    const attempt = readAttemptForInstance(input.cwd, ids);
    const acc = readJsonFile(path.resolve(input.cwd, taskCellPaths(ids).acceptance_path)) as HandoffAcceptanceV1 | null;
    const accepted = acc?.schema_version === "guild.handoff_acceptance.v1" ? acc : null;
    let qualified: boolean | "unknown" = false;
    let telemetry = "unknown";
    if (accepted && accepted.downstream_release_at !== null) {
      const v = isQualifiedDownstreamRelease(input.cwd, { ids, acceptance: accepted }, consumer);
      qualified = v.qualified_release;
      telemetry = v.qualified_release ? "complete"
        : ["lifecycle_event_incomplete", "reconciliation_sidecar_missing", "reconciliation_manifest_incomplete", "prerelease_bus_join_missing"].includes(v.reason ?? "")
          ? (v.reason as string) : "unknown";
      if (v.qualified_release) anyQualified = true;
      if (v.reason === "qualified_other_context") anyOtherContext = true;
      if (v.reason === "finalization_incomplete") anyIncomplete = true;
    }
    const cleanup = readJsonFile(path.resolve(input.cwd, cleanupRel(ids.run_id, ids.instance_id, "cleanup.json"))) as { cleanup_state?: unknown } | null;
    const handle = readJsonFile(path.resolve(input.cwd, handleRel(ids.run_id, ids.instance_id))) as { awaiting?: unknown; runtime_state?: unknown } | null;
    instances.push({
      instance_id: ids.instance_id,
      logical_task_id: ids.logical_task_id,
      runtime_state: typeof handle?.runtime_state === "string" ? handle.runtime_state : null,
      attempt_terminal_state: attempt?.terminal_state ?? null,
      mechanical_acceptance: accepted === null ? "none" : accepted.downstream_release_at !== null ? "accepted" : "rejected",
      qualified_release: qualified,
      release_telemetry_state: telemetry,
      cleanup_state: typeof cleanup?.cleanup_state === "string" ? cleanup.cleanup_state
        : attempt?.orphaned && attempt.terminal_state === null ? "orphaned"
          : attempt?.terminal_state ? "unknown" : "pending",
      // An orphaned nonterminal attempt awaits teardown even when its handle could not record it.
      awaiting: typeof handle?.awaiting === "string" ? handle.awaiting
        : attempt?.orphaned && attempt.terminal_state === null ? "teardown" : null,
    });
  }
  const mechanicallyAccepted = instances.filter((i) => i.mechanical_acceptance === "accepted").length;
  const qualificationState = anyQualified ? "qualified"
    : anyOtherContext ? "qualified_other_context"
      : mechanicallyAccepted > 0 && !claim ? "mechanics_only"
        : anyIncomplete && claim?.package_root ? "finalization_incomplete"
          : mechanicallyAccepted > 0 ? "mechanics_only"
            : claim ? "unavailable" : "unknown";
  const qualificationReason = anyQualified ? null
    : qualificationState === "mechanics_only" ? "acceptance records carry no verified CD17 evidence"
      : qualificationState === "unknown" ? "no readable controller claim"
        : qualificationState === "unavailable" ? (claim?.package_root ? "no qualified acceptance yet" : "no verified installed package (source run)")
          : qualificationState;

  let readiness: Record<string, unknown> = { state: "unknown", current_package_identity: null, current_host_profile_id: null,
    policy_available: "cooperative_local available; isolated_worker unavailable in E00", reason: "no package root to verify" };
  const pkgRoot = input.packageRoot ?? claim?.package_root ?? null;
  if (pkgRoot) {
    try {
      const pkg = readPackageIdentity(pkgRoot);
      readiness = { ...readiness, state: input.consumerPolicy === "cooperative_local" ? "ready" : "not_ready",
        current_package_identity: { ...pkg.package_identity, verified: true }, current_host_profile_id: hostProfileId("cooperative_local"),
        reason: input.consumerPolicy === "cooperative_local" ? null : "worker_principal_unavailable" };
    } catch (error) {
      readiness = { ...readiness, state: "not_ready", reason: `package identity unverified: ${(error as Error).message}` };
    }
  }

  const principal = claim
    ? { mode: claim.worker_trust_policy === "cooperative_local" ? "cooperative_same_uid" : "unavailable",
        worker_trust_policy: claim.worker_trust_policy, provider: claim.provider === "cooperative_local" ? "cooperative_local" : null,
        host_profile_id: claim.host_profile_id, reason: claim.worker_trust_policy === "cooperative_local" ? null : "worker_principal_unavailable" }
    : { mode: "unknown", worker_trust_policy: null, provider: null, host_profile_id: null,
        reason: claimPresent ? "controller claim unreadable" : "no controller claim" };

  return {
    view_version: TASK_CELL_CONTROLLER_STATUS_VIEW,
    observed_at: now,
    identity: {
      root_id: root?.root_id ?? null,
      source_id: root?.source_id ?? null,
      root_fingerprint: root?.root_fingerprint ?? null,
      guild_root_path: root?.guild_root_path ?? path.resolve(input.cwd),
      run_id: input.runId,
      management_session_id: input.managementSessionId ?? null,
      controller_instance_id: claim?.controller_instance_id ?? null,
      package_identity: claim?.package_identity ?? null,
      source_revision: claim?.source_revision ?? null,
      package_release_version: claim?.package_release_version ?? null,
      package_current_package: claim?.package_current_package ?? null,
    },
    liveness: owner.liveness,
    evidence_quality: owner.evidence_quality,
    controller_state: claim ? (owner.heartbeat?.state ?? null) : null,
    last_heartbeat_at: owner.heartbeat?.heartbeat_at ?? null,
    loss_recorded: lossRecorded(input.cwd, input.runId, claim),
    principal,
    qualification: {
      state: qualificationState,
      run_policy: claim?.worker_trust_policy ?? null,
      consumer_policy: input.consumerPolicy,
      producer_context: claim ? { source_id: claim.source_id, source_revision: claim.source_revision, package_identity: claim.package_identity,
        provider: claim.provider, host_profile_id: claim.host_profile_id } : null,
      consumer_context: consumerContext.mode === "same_run"
        ? { mode: "same_run", ...(claim ? { source_id: claim.source_id, source_revision: claim.source_revision, package_identity: claim.package_identity, provider: claim.provider, host_profile_id: claim.host_profile_id } : {}) }
        : { mode: "release", ...(consumerContext.context ?? {}) },
      reason: qualificationReason,
    },
    instances,
    counts: {
      total: instances.length,
      mechanically_accepted: mechanicallyAccepted,
      qualified_released: instances.filter((i) => i.qualified_release === true).length,
    },
    failure_reason: null,
    readiness,
  };
}

// ── Post-death loss scan (CD6) ───────────────────────────────────────────────

export interface PaneTeardownResult {
  ok: boolean;
  confirmed: boolean;
  degraded: boolean;
  polls: number;
  error: string | null;
  /**
   * Whether the port enforced the expected identity through the kill itself
   * (CD6/L4): mismatch → no kill; unavailable → the port cannot bind identity
   * and did not kill. Absent means a port that predates identity binding.
   */
  identity_check?: "verified" | "mismatch" | "unavailable";
}

/** The recorded pane identity record-loss expects to terminate (never a current replacement). */
export interface ExpectedPaneIdentity {
  pane_id: string;
  pane_pid: number;
  pane_process_start: string;
  server_pid: number;
  server_process_start: string;
}

/** The scripts-layer teardown record-loss uses (tmux terminatePane and identity reads). */
export interface LossTeardownPort {
  /** Current tmux server identity, or null when tmux is unavailable. */
  serverIdentity(): { pid: number; process_start: string } | null;
  /** The pane's current pane_pid, or null when the pane is gone or unreadable. */
  panePid(paneId: string): number | null;
  terminatePane(paneId: string, expected?: ExpectedPaneIdentity): PaneTeardownResult;
  /**
   * The observed start of `pid`; null ONLY when the process is authoritatively absent.
   * An unavailable observation throws (a blank string is treated as unavailable too).
   */
  processStart(pid: number): string | null;
}

/** What one process read proves about the recorded original (absent and replaced both mean it is gone). */
type OriginalObservation =
  | { state: "absent" | "same" | "replaced" | "unrecorded" }
  | { state: "unavailable"; error: string };

function observeOriginal(teardown: LossTeardownPort, pid: number, recordedStart: unknown): OriginalObservation {
  let observed: unknown;
  try {
    observed = teardown.processStart(pid);
  } catch (error) {
    return { state: "unavailable", error: error instanceof Error ? error.message : String(error) };
  }
  if (observed === null) return { state: "absent" };
  const start = normalizeStart(observed);
  if (!start) return { state: "unavailable", error: "blank or non-string process start" };
  // A live pid with no recorded start cannot be proven to be a replacement.
  const recorded = normalizeStart(recordedStart);
  if (!recorded) return { state: "unrecorded" };
  return { state: start === recorded ? "same" : "replaced" };
}

/** The no-action teardown shape for an observation that could not be made (nothing was killed). */
const observationUnavailable = (error: string): PaneTeardownResult =>
  ({ ok: false, confirmed: false, degraded: true, polls: 0, error: `process observation unavailable: ${error}` });

interface ControllerHandleV1 {
  schema_version: typeof CONTROLLER_HANDLE_SCHEMA;
  instance_id: string;
  state: "spawn_pending" | "spawned";
  pane_id?: string | null;
  pane_pid?: number | null;
  pane_process_start?: string | null;
  server_pid?: number | null;
  server_process_start?: string | null;
  runtime_state?: string | null;
  awaiting?: string | null;
}

/**
 * Operator-invoked loss scan after dead-owner proof (CD6). Never constructs a
 * runtime, never validates/accepts/rejects, never reconciles acceptance or
 * validation, never finalizes and never adopts. Its only writes are loss
 * artifacts through the canonical binding-authenticated writers, one exclusive
 * observation per run, and the one-time loss marker.
 */
export function recordControllerLoss(input: {
  cwd: string;
  runId: string;
  now?: () => string;
  teardown?: LossTeardownPort | null;
  binding?: DispatchBindingEnvelope;
}): Record<string, unknown> | Refused {
  const now = input.now ?? (() => new Date().toISOString());
  const claim = readClaim(input.cwd, input.runId);
  if (!claim) return refuse("controller_claim_absent");
  const owner = classifyControllerOwner(input.cwd, input.runId, now());
  if (owner.liveness !== "dead") return refuse("controller_not_dead", owner.liveness);
  const record = loadRunBinding({ root: input.cwd, run_id: input.runId });
  const bindingRef = input.binding?.binding_ref ?? record?.binding_ref;
  if (!bindingRef || !verifyRunBinding({ root: input.cwd, run_id: input.runId, binding_ref: bindingRef }).ok) {
    return refuse("loss_binding_refused");
  }
  const binding: DispatchBindingEnvelope = { binding_ref: bindingRef };
  const teardown = input.teardown ?? null;
  const observations: Array<Record<string, unknown>> = [];

  for (const { ids, attemptRel } of walkInstances(input.cwd, input.runId)) {
    const attemptAbs = path.resolve(input.cwd, attemptRel);
    const rawText = regularBytes(attemptAbs)?.toString("utf8") ?? null;
    if (rawText !== null && isInstanceReservation(rawText)) {
      observations.push({ ...ids, outcome: "placeholder_unwritten" });
      continue;
    }
    const attempt = validateTaskAttemptV1(readJsonFile(attemptAbs));
    if (!attempt || attempt.instance_id !== ids.instance_id) continue;
    if (attempt.terminal_state !== null) {
      // Terminal attempts are untouched; a prior run may have left their loss bytes unpublished.
      observations.push({ ...ids, outcome: publishLossIfUnpublished(input.cwd, ids, binding, now) });
      continue;
    }
    const finalExists = fs.existsSync(path.resolve(input.cwd, evidenceRel(ids.run_id, ids.instance_id, "final.json")));
    const acceptanceExists = fs.existsSync(path.resolve(input.cwd, taskCellPaths(ids).acceptance_path));
    const finalizationIncomplete = acceptanceExists && !finalExists;
    const handle = readJsonFile(path.resolve(input.cwd, handleRel(ids.run_id, ids.instance_id))) as ControllerHandleV1 | null;
    const orphan = (outcome: string, teardownResult: PaneTeardownResult | null = null, unavailable: string | null = null): void => {
      let status = outcome;
      try {
        markAttemptOrphaned(input.cwd, ids, binding);
      } catch (error) {
        status = attemptChanged(attemptAbs, attempt) ? "loss_publication_incomplete" : `orphan_failed:${(error as Error).message}`;
      }
      observations.push({
        ...ids, outcome: status, ...(finalizationIncomplete ? { reason: "finalization_incomplete" } : {}), teardown: teardownResult,
        ...(unavailable !== null ? { process_observation: { state: "unavailable", error: unavailable } } : {}),
      });
    };
    if (!handle) {
      orphan("unconfirmed_no_handle");
      continue;
    }
    if (handle.state === "spawn_pending") {
      orphan("unconfirmed");
      continue;
    }
    if (!handle.pane_id || !/^%\d+$/.test(handle.pane_id) || !handle.pane_pid) {
      orphan("teardown_unconfirmed");
      continue;
    }
    if (!teardown) {
      orphan("teardown_degraded", { ok: false, confirmed: false, degraded: true, polls: 0, error: "no teardown port" });
      continue;
    }
    const server = teardown.serverIdentity();
    if (!server || server.pid !== handle.server_pid || normalizeStart(server.process_start) !== normalizeStart(handle.server_process_start)) {
      // The pane id may have been reused under a new server: never kill. Only proven absence
      // or a recorded-start replacement seals; anything unproven stays orphaned.
      const original = observeOriginal(teardown, handle.pane_pid, handle.pane_process_start);
      if (original.state === "absent" || original.state === "replaced") {
        sealLoss(input.cwd, ids, binding, now, "process_gone_server_changed", attemptAbs, attempt, observations, finalizationIncomplete, null);
      } else if (original.state === "unavailable") orphan("teardown_degraded", observationUnavailable(original.error), original.error);
      else if (original.state === "unrecorded") orphan("teardown_unconfirmed");
      else orphan("teardown_unconfirmed_process_alive");
      continue;
    }
    // F7: re-read the pane's pid AND its process start immediately before the kill;
    // a respawned pane reusing the pid never matches the recorded start.
    if (teardown.panePid(handle.pane_id) !== handle.pane_pid) {
      orphan("identity_mismatch");
      continue;
    }
    const fresh = observeOriginal(teardown, handle.pane_pid, handle.pane_process_start);
    if (fresh.state === "unavailable") {
      orphan("teardown_degraded", observationUnavailable(fresh.error), fresh.error);
      continue;
    }
    if (fresh.state === "unrecorded") {
      orphan("teardown_unconfirmed");
      continue;
    }
    if (fresh.state !== "same") {
      orphan("identity_mismatch");
      continue;
    }
    const result = teardown.terminatePane(handle.pane_id, {
      pane_id: handle.pane_id, pane_pid: handle.pane_pid, pane_process_start: handle.pane_process_start as string,
      server_pid: handle.server_pid ?? 0, server_process_start: handle.server_process_start ?? "",
    });
    if (result.identity_check === "mismatch") orphan("identity_mismatch", result);
    else if (result.identity_check === "unavailable") orphan("teardown_unconfirmed", result);
    else if (result.degraded) orphan("teardown_degraded", result);
    else if (result.ok && result.confirmed) {
      // The actual teardown result is kept as returned; the death proof is a separate read.
      const after = observeOriginal(teardown, handle.pane_pid, handle.pane_process_start);
      if (after.state === "absent" || after.state === "replaced") {
        sealLoss(input.cwd, ids, binding, now, "sealed_controller_lost", attemptAbs, attempt, observations, finalizationIncomplete, result);
      } else if (after.state === "unavailable") orphan("teardown_unconfirmed", result, after.error);
      else orphan("teardown_unconfirmed_process_alive", result);
    } else if (result.confirmed) orphan("teardown_unconfirmed_process_alive", result);
    else orphan("teardown_unconfirmed", result);
  }

  const lossDir = path.resolve(input.cwd, controllerRel(input.runId, "loss", claim.controller_instance_id));
  fs.mkdirSync(lossDir, { recursive: true, mode: 0o700 });
  let seq = 1;
  const observation = {
    schema_version: CONTROLLER_LOSS_OBSERVATION_SCHEMA,
    run_id: input.runId,
    controller_instance_id: claim.controller_instance_id,
    observed_at: now(),
    attempts: observations,
  };
  while (!writeExclusive(path.join(lossDir, `observation-${String(seq).padStart(4, "0")}.json`), json({ ...observation, seq }))) seq++;
  writeExclusive(
    path.resolve(input.cwd, controllerRel(input.runId, `loss-${claim.controller_instance_id}.json`)),
    json({ schema_version: CONTROLLER_LOSS_MARKER_SCHEMA, run_id: input.runId, controller_instance_id: claim.controller_instance_id, recorded_at: observation.observed_at }),
  );
  return { ok: true, run_id: input.runId, controller_instance_id: claim.controller_instance_id, seq, attempts: observations };
}

function attemptChanged(abs: string, before: TaskAttemptV1): boolean {
  const now = validateTaskAttemptV1(readJsonFile(abs));
  return !!now && JSON.stringify(now) !== JSON.stringify(before);
}

function sealLoss(
  cwd: string,
  ids: TaskCellInstanceIds,
  binding: DispatchBindingEnvelope,
  now: () => string,
  outcome: string,
  attemptAbs: string,
  before: TaskAttemptV1,
  observations: Array<Record<string, unknown>>,
  finalizationIncomplete: boolean,
  teardown: PaneTeardownResult | null,
): void {
  let status = outcome;
  try {
    sealTerminalAttempt({ cwd, ids, terminal_state: "failed", reason: "controller_lost", orphaned: true, now, binding });
  } catch (error) {
    status = attemptChanged(attemptAbs, before) ? "loss_publication_incomplete" : `seal_failed:${(error as Error).message}`;
  }
  observations.push({ ...ids, outcome: status, ...(finalizationIncomplete ? { reason: "finalization_incomplete" } : {}), teardown });
}

/** A later loss run publishes only the exact persisted loss bytes (attempt, instance, terminal). */
function publishLossIfUnpublished(cwd: string, ids: TaskCellInstanceIds, binding: DispatchBindingEnvelope, now: () => string): string {
  const attempt = readAttemptForInstance(cwd, ids);
  if (attempt?.terminal_reason !== "controller_lost") return "already_terminal";
  let published = false;
  for (const kind of ["attempt", "instance", "terminal"] as const) {
    try {
      if (publishPersistedLifecycleRecord(cwd, ids, kind, binding, now).outcome === "published") published = true;
    } catch {
      return "loss_publication_incomplete";
    }
  }
  return published ? "loss_published" : "already_terminal";
}

// ── The controller (CD5 / CD11) ──────────────────────────────────────────────

/** Optional pane identity a tmux-backed worker port exposes to the handle record (CD6). */
export interface PaneIdentityPort {
  paneIdentity(instanceId: string): {
    pane_id: string;
    pane_pid: number;
    pane_process_start: string;
    server_pid: number;
    server_process_start: string;
  } | null;
}

export interface TaskCellControllerOptions {
  cwd: string;
  runId: string;
  /** The station (phase) this controller supervises; also the oracle-plan name. */
  phase: string;
  workerTrustPolicy: unknown;
  now?: () => string;
  /** The verified run binding; omitted, it is loaded from the controller's own spawn env or the run record. */
  binding?: DispatchBindingEnvelope;
  /** The controller's installed package root; null on source runs (mechanics_only, CD16). */
  packageRoot?: string | null;
  /** Worker mechanics (CD11: the controller-owned transport wrapper). */
  worker?: TaskCellWorkerPort & Partial<PaneIdentityPort>;
  rungPlan?: FilesystemTaskCellRuntimeOpts["rungPlan"];
  substrate?: FilesystemTaskCellRuntimeOpts["substrate"];
  maxInstances?: number;
  idFactory?: FilesystemTaskCellRuntimeOpts["idFactory"];
  /** The approved team proposal (reviewer slots, CD8/CD12). */
  proposal?: TeamProposalV2 | null;
  /** F1: the reviewed source basis; required whenever packageRoot is set (CD22). */
  reviewedBasis?: ReviewedBasisInput | null;
  /** Injected waiting (tests); production sleeps. */
  sleep?: (ms: number) => Promise<void>;
  /** Source-only: the principal provider override is not reachable from the package facade. */
  principal?: PrincipalProvider;
  controllerInstanceId?: string;
}

export interface LaneSpec {
  logical_task_id: string;
  worker_role: string;
  specialist: {
    type_id: string; type_version: string; type_hash: string; profile_id: string; profile_hash: string;
  };
  host: { host_id: string; adapter_id: string; host_capabilities_hash: string; host_family: string };
  model: { tier: "cheap" | "mid" | "powerful"; model_id: string | null };
  context_bundle_id: string;
  objective: string;
  non_goals: string[];
  scope_paths: string[];
  acceptance_tests: string[];
  dependencies: string[];
  projection: TaskAssignmentV2["projection"];
  budgets: TaskAssignmentV2["budgets"];
  autonomy_policy: TaskAssignmentV2["autonomy_policy"];
  deadline: string | null;
  /** Lane deadlines (ms) for the polling windows (CD11 steps 3/7/9). */
  ready_timeout_ms?: number;
  ack_timeout_ms?: number;
  receipt_timeout_ms?: number;
  review_timeout_ms?: number;
}

export type LaneOutcome = {
  logical_task_id: string;
  instance_id: string | null;
  /** The ACTUAL D5 state: terminal only after a confirmed termination (C-r3-F1). */
  state: string;
  qualified_release: boolean;
  /** The primary reason the lane stopped; a teardown error is never folded in. */
  failure_reason: string | null;
  awaiting: string | null;
  /** Additive (root C-r3): the termination attempt's outcome, when one was made. */
  teardown?: { ok: boolean; failure: string | null; reason: string | null; confirmed: boolean } | null;
  /** Additive (root C-r3): the persisted attempt's orphan flag, separate from the D5 state. */
  orphaned?: boolean;
};

type LaneOutcomeExtra = Pick<LaneOutcome, "teardown" | "orphaned">;
type OutcomeFn = (
  state: string, iid: string | null, failure: string | null, awaiting?: string | null, qualified?: boolean, extra?: LaneOutcomeExtra,
) => LaneOutcome;

/** One termination/rejection attempt as actually observed: its result, or the error it threw. */
interface TerminationAttempt {
  result: unknown;
  threw: string | null;
  /** cleanup(): the API threw but the terminal post-state was verified on disk and bus (provenance, not an API result). */
  recovered_post_state?: boolean;
  /** cleanup(): the recorded cleanup_state and whether cleanup.json was durably written. */
  cleanup_state?: string;
  cleanup_record?: "written" | "exists" | "write_failed";
  /** An earlier cleanup of this lane threw before this attempt (kept visible). */
  prior_error?: string;
}

/** A cleanup that threw inside acceptLane; carries what the generic catch needs to settle it truthfully. */
class CleanupThrewError extends Error {
  constructor(
    readonly cause_message: string,
    readonly primary: string | null,
    readonly qualified: boolean,
    readonly final: AcceptanceEvidenceFinalV1 | null,
  ) {
    super(cause_message);
    this.name = "CleanupThrewError";
  }
}

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

async function attemptTermination(run: () => Promise<unknown>): Promise<TerminationAttempt> {
  try {
    return { result: await run(), threw: null };
  } catch (error) {
    return { result: null, threw: error instanceof Error ? error.message : String(error) };
  }
}

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class TaskCellController {
  readonly claim: TaskCellControllerClaimV1;
  readonly runtime: FilesystemTaskCellRuntime;
  private readonly cwd: string;
  private readonly binding: DispatchBindingEnvelope;
  private readonly now: () => string;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly plan: ApprovedOraclePlan;
  private readonly proposal: TeamProposalV2 | null;
  private readonly membership: ApprovedLaneMembership;
  private readonly principal: PrincipalProvider;
  private readonly worker: TaskCellWorkerPort & Partial<PaneIdentityPort>;
  private planRel: string | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private readonly settled = new Map<string, LaneOutcome>();
  private readonly instances: Array<{ handle: InstanceHandle; assignment: TaskAssignmentV2 }> = [];
  /** Every instance this controller actually allocated, assigned or not; the station guard re-reads each. */
  private readonly allocated = new Map<string, TaskCellInstanceIds>();

  constructor(args: {
    cwd: string;
    claim: TaskCellControllerClaimV1;
    binding: DispatchBindingEnvelope;
    plan: ApprovedOraclePlan;
    principal: PrincipalProvider;
    membership: ApprovedLaneMembership;
    opts: TaskCellControllerOptions;
  }) {
    this.cwd = args.cwd;
    this.claim = args.claim;
    this.binding = args.binding;
    this.plan = args.plan;
    this.principal = args.principal;
    this.proposal = args.opts.proposal ?? null;
    this.membership = args.membership;
    this.now = args.opts.now ?? (() => new Date().toISOString());
    this.sleep = args.opts.sleep ?? realSleep;
    if (!args.opts.worker) throw new ControllerRefusal("worker_transport_unavailable");
    if (!args.opts.rungPlan) throw new ControllerRefusal("rung_plan_required");
    const wrapped = this.wrapWorker(args.opts.worker);
    this.worker = wrapped;
    const consumer: ConsumerSpec = { policy: "cooperative_local", context: { mode: "same_run" } };
    this.runtime = new FilesystemTaskCellRuntime({
      cwd: this.cwd,
      substrate: args.opts.substrate ?? "tmux",
      parallelism: 1,
      binding: this.binding,
      worker: wrapped,
      now: this.now,
      idFactory: args.opts.idFactory,
      maxInstances: args.opts.maxInstances,
      rungPlan: args.opts.rungPlan,
      dependencyAcceptances: (cwd, runId) => findQualifiedRunAcceptances(cwd, runId, consumer).map((x) => x.acceptance),
    });
  }

  /** The wrapper writes the spawn_pending handle BEFORE spawn and the spawned identity after (CD6). */
  private wrapWorker(inner: TaskCellWorkerPort & Partial<PaneIdentityPort>): TaskCellWorkerPort & Partial<PaneIdentityPort> {
    const handleAbs = (id: string) => path.resolve(this.cwd, handleRel(this.claim.run_id, id));
    const write = (id: string, record: ControllerHandleV1) => {
      fs.mkdirSync(path.dirname(handleAbs(id)), { recursive: true, mode: 0o700 });
      publishHandle(handleAbs(id), record);
    };
    return {
      mode: inner.mode,
      losses: inner.losses,
      isAvailable: () => inner.isAvailable(),
      spawn: (input) => {
        try {
          write(input.instance_id, { schema_version: CONTROLLER_HANDLE_SCHEMA, instance_id: input.instance_id, state: "spawn_pending" });
        } catch (error) {
          // Before the inner call: nothing was launched.
          return { ok: false, reason: `handle_write_failed: ${errorMessage(error)}`, spawn_effect: "none" };
        }
        // An inner throw propagates; the runtime classifies it as unknown.
        const result = inner.spawn(input);
        if (result.ok) {
          const pane = inner.paneIdentity?.(input.instance_id) ?? null;
          try {
            write(input.instance_id, {
              schema_version: CONTROLLER_HANDLE_SCHEMA, instance_id: input.instance_id, state: "spawned",
              pane_id: pane?.pane_id ?? null, pane_pid: pane?.pane_pid ?? null, pane_process_start: pane?.pane_process_start ?? null,
              server_pid: pane?.server_pid ?? null, server_process_start: pane?.server_process_start ?? null,
            });
          } catch (error) {
            // The worker started but its identity is not durable here: the handle stays
            // spawn_pending and the inner port keeps its own identity record untouched.
            return { ok: false, reason: `spawned_handle_write_failed: ${errorMessage(error)}`, spawn_effect: "unknown" };
          }
        }
        return result;
      },
      ready: (input) => inner.ready(input),
      notifyAssignment: (input) => inner.notifyAssignment(input),
      terminate: (input) => inner.terminate(input),
      paneIdentity: inner.paneIdentity ? (id: string) => inner.paneIdentity!(id) : undefined,
    };
  }

  private setHeartbeat(state: string): void {
    fs.writeFileSync(
      path.resolve(this.cwd, heartbeatRel(this.claim.run_id)),
      json({ state, heartbeat_at: this.now() }),
      { encoding: "utf8", mode: 0o600 },
    );
  }

  startHeartbeat(): void {
    this.setHeartbeat("supervising");
    this.heartbeatTimer = setInterval(() => this.setHeartbeat("supervising"), CONTROLLER_HEARTBEAT_MS);
    this.heartbeatTimer.unref?.();
  }

  close(state: "closed" | "failed_closed" = "closed"): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
    this.setHeartbeat(state);
  }

  /**
   * Patch only runtime_state/awaiting. A missing or invalid handle is rebuilt as
   * spawn_pending with no identity; only the spawn wrapper records a spawned identity.
   */
  private noteHandle(instanceId: string, patch: Pick<ControllerHandleV1, "runtime_state" | "awaiting">): void {
    const abs = path.resolve(this.cwd, handleRel(this.claim.run_id, instanceId));
    const read = readJsonFile(abs) as Partial<ControllerHandleV1> | null;
    const valid = read !== null && typeof read === "object" && !Array.isArray(read) &&
      read.schema_version === CONTROLLER_HANDLE_SCHEMA && read.instance_id === instanceId &&
      (read.state === "spawn_pending" || read.state === "spawned");
    const current: ControllerHandleV1 = valid
      ? (read as ControllerHandleV1)
      : { schema_version: CONTROLLER_HANDLE_SCHEMA, instance_id: instanceId, state: "spawn_pending" };
    const next: ControllerHandleV1 = { ...current };
    if ("runtime_state" in patch) next.runtime_state = patch.runtime_state;
    if ("awaiting" in patch) next.awaiting = patch.awaiting;
    publishHandle(abs, next);
  }

  /**
   * CD26 step 1: write and publish the station team plan before any spawn. The
   * returned absolute path is the only source of the per-instance plan path.
   */
  writeStationPlan(teamPlan: unknown): string {
    const planAbs = writeTeamPlan(this.cwd, this.claim.run_id, teamPlan, {
      publisher: { host_id: "task-cell-controller", role: "task-cell-controller" },
      now: this.now,
    });
    const rel = path.relative(this.cwd, planAbs);
    const canonical = runRel(this.claim.run_id, "team-plan", `${this.phaseStation()}.json`);
    if (rel !== canonical || rel.startsWith("..") || path.isAbsolute(rel)) throw new ControllerRefusal("team_plan_path_refused");
    const stat = fs.lstatSync(planAbs);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new ControllerRefusal("team_plan_path_refused");
    const realRoot = fs.realpathSync(this.cwd);
    if (!fs.realpathSync(planAbs).startsWith(realRoot + path.sep)) throw new ControllerRefusal("team_plan_path_refused");
    this.planRel = rel;
    return rel;
  }

  private phaseStation(): string {
    return path.basename(this.plan.plan_ref.path, ".json");
  }

  private planLane(logicalTaskId: string): OraclePlanLane | null {
    return this.plan.plan.lanes.find((l) => l.logical_task_id === logicalTaskId) ?? null;
  }

  /** Poll `probe` every `everyMs` until it returns non-null or `timeoutMs` passes. */
  private async poll<T>(probe: () => T | null, everyMs: number, timeoutMs: number): Promise<T | null> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const value = probe();
      if (value !== null) return value;
      if (Date.now() >= deadline) return null;
      await this.sleep(everyMs);
    }
  }

  /**
   * Run one lane end to end (CD11 steps 1–13). Returns the lane outcome; any
   * refusal before delivery leaves no assignment; any thrown error after spawn
   * force-terminates the instance as failed.
   */
  async runLane(spec: LaneSpec): Promise<LaneOutcome> {
    const lane = this.planLane(spec.logical_task_id);
    const outcome: OutcomeFn = (state, instanceId, failure, awaiting = null, qualified = false, extra = {}) => {
      const out: LaneOutcome = { logical_task_id: spec.logical_task_id, instance_id: instanceId, state, qualified_release: qualified, failure_reason: failure, awaiting, ...extra };
      this.settled.set(spec.logical_task_id, out);
      return out;
    };
    if (!lane) return outcome("refused", null, "lane_absent_from_oracle_plan");
    // F2: the dispatched role must be the approved work item's owner (root Q3).
    const owner = this.membership.get(spec.logical_task_id);
    if (owner === undefined) return outcome("refused", null, "lane_absent_from_oracle_plan");
    if (owner !== spec.worker_role) return outcome("refused", null, "lane_role_mismatch");
    if (this.planRel === null) return outcome("refused", null, "team_plan_not_written");
    const station = this.phaseStation();
    // Admission (CD9/CD21): binding.json outside every scope path, typed oracles valid.
    const bindingRel = path.relative(this.cwd, runBindingPath(this.cwd, this.claim.run_id));
    if (spec.scope_paths.some((s) => bindingRel === s || bindingRel.startsWith(`${s.replace(/\/$/, "")}/`) || s === "." || s === "")) {
      return outcome("refused", null, "binding_inside_scope");
    }
    // Dependencies resolve to upstream QUALIFIED acceptances only (CD26 step 3).
    const consumer: ConsumerSpec = { policy: "cooperative_local", context: { mode: "same_run" } };
    const qualified = findQualifiedRunAcceptances(this.cwd, this.claim.run_id, consumer);
    const dependencies = spec.dependencies.map((dep) => {
      const upstream = qualified.find((q) => q.ids.logical_task_id === dep);
      return { logical_task_id: dep, accepted_artifact_ref: upstream ? taskCellPaths(upstream.ids).acceptance_path : null };
    });
    if (dependencies.some((d) => d.accepted_artifact_ref === null)) return outcome("blocked", null, "dependencies_blocked");
    const typed = validateExecutableDoneWhen(lane.done_when, { scope_paths: spec.scope_paths, dependencies });
    if (!typed.ok) return outcome("refused", null, typed.reason);

    // (1)-(2) cell + instance; the wrapper records spawn_pending then spawned.
    const contextBytes = regularBytes(path.resolve(this.cwd, spec.context_bundle_id));
    if (contextBytes === null) return outcome("refused", null, "context_bundle_absent");
    const cell = await this.runtime.spawnCell({
      run_id: this.claim.run_id, cell_id: `cell-${spec.logical_task_id}`, goal_id: `goal-${station}`, phase_id: station,
      step_id: spec.logical_task_id, team_id: `team-${station}`, logical_task_id: spec.logical_task_id,
      fanout: "lead_plus_one", lead: { lead_binding_id: this.claim.lead_binding_id },
    });
    let instance: InstanceHandle;
    try {
      instance = await this.runtime.spawnInstance(cell, {
      task_run_id: `${spec.logical_task_id}.tr1`, attempt: 1, worker_role: spec.worker_role,
      specialist_type_id: spec.specialist.type_id, specialist_type_version: spec.specialist.type_version,
      specialist_type_hash: spec.specialist.type_hash, specialist_profile_id: spec.specialist.profile_id,
      specialist_profile_hash: spec.specialist.profile_hash, host_id: spec.host.host_id, adapter_id: spec.host.adapter_id,
      host_capabilities_hash: spec.host.host_capabilities_hash, model_tier: spec.model.tier, model_id: spec.model.model_id ?? undefined,
      context_bundle_id: spec.context_bundle_id, context_bundle_hash: `sha256:${sha256(contextBytes)}`,
      projection: spec.projection, budgets: spec.budgets,
      } as never);
    } catch (error) {
      if (!(error instanceof SpawnOutcomeUnknownError)) throw error;
      this.allocated.set(error.instance_id, { run_id: this.claim.run_id, logical_task_id: error.logical_task_id, attempt: 1, instance_id: error.instance_id });
      // A worker may be live and unidentified: report the physical orphan, keep the
      // nonterminal attempt (and its cap slot) under supervision, never re-dispatch.
      const failure = ["spawn_outcome_unknown", error.orphan_recorded ? null : "orphan_record_failed"];
      try {
        this.noteHandle(error.instance_id, { awaiting: "teardown" });
      } catch {
        failure.push("handle_record_failed");
      }
      const settled = outcome("instantiated", error.instance_id, error.reason, "teardown", false, {
        orphaned: true,
        teardown: { ok: false, failure: failure.filter((x): x is string => x !== null).join(","), reason: error.reason, confirmed: false },
      });
      return settled;
    }
    const iid = instance.instance_id;
    this.allocated.set(iid, { run_id: this.claim.run_id, logical_task_id: spec.logical_task_id, attempt: instance.attempt, instance_id: iid });
    try {
      // (3) readiness: poll, then awaitReady once.
      await this.poll(() => (this.worker.ready({ instance_id: iid, run_id: this.claim.run_id }).ok ? true : null), 1_000, spec.ready_timeout_ms ?? 60_000);
      const ready = await this.runtime.awaitReady(instance);
      if (!ready.ok) return this.settleLaneTermination(instance, `not_ready:${(ready as { reason?: string }).reason ?? ""}`, { result: ready, threw: null }, outcome);
      // (4) per-instance team_plan publication, then the pure assignment build.
      const published = publishTaskCellFile({
        cwd: this.cwd, ids: { run_id: this.claim.run_id, logical_task_id: spec.logical_task_id, attempt: instance.attempt, instance_id: iid },
        kind: "team_plan", relativePath: this.planRel, hostId: spec.host.host_id, role: "task-cell-controller",
        bindingRef: this.binding.binding_ref, now: this.now,
      });
      if (published === null) {
        const attempt = await attemptTermination(() => this.runtime.terminate(instance, { force: true, forced_state: "failed", reason: "team_plan_publication_failed" }));
        return this.settleLaneTermination(instance, "team_plan_publication_failed", attempt, outcome);
      }
      const assignment = buildTaskAssignmentV2({
        run_id: this.claim.run_id, cell_id: cell.cell_id, goal_id: cell.goal_id, phase_id: cell.phase_id, step_id: cell.step_id,
        team_id: cell.team_id, logical_task_id: spec.logical_task_id, task_run_id: instance.task_run_id, attempt: instance.attempt,
        attempt_id: instance.attempt_id, previous_attempt_id: null, retry_reason: null, instance_id: iid,
        lead_binding_id: this.claim.lead_binding_id, team_lead_instance_id: null, worker_role: spec.worker_role,
        specialist_type_id: spec.specialist.type_id, specialist_type_version: spec.specialist.type_version,
        specialist_type_hash: spec.specialist.type_hash, specialist_profile_id: spec.specialist.profile_id,
        specialist_profile_hash: spec.specialist.profile_hash, context_bundle_id: spec.context_bundle_id,
        context_bundle_hash: `sha256:${sha256(contextBytes)}`, host_id: spec.host.host_id, adapter_id: spec.host.adapter_id,
        host_capabilities_hash: spec.host.host_capabilities_hash, objective: spec.objective, non_goals: spec.non_goals,
        scope_paths: spec.scope_paths, output_schema: "guild.handoff_receipt.v1", acceptance_tests: spec.acceptance_tests,
        dependencies, projection: spec.projection, autonomy_policy: spec.autonomy_policy, budgets: spec.budgets,
        deadline: spec.deadline, written_at: this.now(),
      });
      const withOracles = Object.assign(assignment, {
        done_when: typed.items.map(({ id, oracle, target }) => ({ id, oracle, target })),
        done_when_ref: {
          oracle_plan_path: this.plan.plan_ref.path, oracle_plan_sha256: this.plan.plan_ref.sha256,
          decision_sha256: this.plan.decision_ref.sha256,
        },
      });
      const lead = leadOf(withOracles);
      if (lead.lead_binding_id !== this.claim.lead_binding_id || lead.team_lead_instance_id !== null) {
        throw new ControllerRefusal("lead_binding_mismatch");
      }
      // (5) ledger, (6) delivery — the only assignment writer.
      const ledger = initProgressLedger({
        cwd: this.cwd, run_id: this.claim.run_id, logical_task_id: spec.logical_task_id, cell_id: cell.cell_id,
        assignment_id: assignmentId(withOracles), done_when: withOracles.done_when, now: this.now, binding: this.binding,
      });
      if (!ledger.ok) throw new ControllerRefusal("ledger_refused", ledger.reason);
      const delivered = await this.runtime.deliverAssignment(instance, withOracles);
      if (!delivered.ok) return this.settleLaneTermination(instance, `delivery_failed:${(delivered as { reason?: string }).reason ?? ""}`, { result: delivered, threw: null }, outcome);
      this.instances.push({ handle: instance, assignment: withOracles });
      // (7) ack claim, then the controller-recorded ack.
      const claim = await this.poll(() => readValidAckClaim(this.cwd, withOracles), 1_000, spec.ack_timeout_ms ?? 120_000);
      if (claim) acknowledgeAssignment(this.cwd, withOracles, this.now, this.binding);
      const running = await this.runtime.awaitAssignmentAck(instance);
      if (!running.ok) return this.settleLaneTermination(instance, "ack_timeout", { result: running, threw: null }, outcome);
      this.noteHandle(iid, { runtime_state: "running" });
      // (8)-(9) receipt stability, then the controller-observed submission.
      const receiptRel = `.guild/runs/${this.claim.run_id}/handoffs/${spec.worker_role}-${spec.logical_task_id}.md`;
      const stable = await this.poll(() => {
        const a = regularBytes(path.resolve(this.cwd, receiptRel));
        return a === null ? null : sha256(a);
      }, 2_000, spec.receipt_timeout_ms ?? 3_600_000);
      if (stable === null) {
        const attempt = await attemptTermination(() => this.runtime.terminate(instance, { force: true, forced_state: "timed_out", reason: "receipt_timeout" }));
        return this.settleLaneTermination(instance, "receipt_timeout", attempt, outcome);
      }
      await this.sleep(2_000);
      const again = regularBytes(path.resolve(this.cwd, receiptRel));
      if (again === null || sha256(again) !== stable) return outcome("running", iid, null, "receipt_unstable");
      const submitted = submitObservedHandoff({
        cwd: this.cwd, assignment: withOracles, binding: this.binding,
        controllerInstanceId: this.claim.controller_instance_id, packageIdentity: this.claim.package_identity, now: this.now,
      });
      if (!submitted.ok) {
        const attempt = await attemptTermination(() => this.runtime.terminate(instance, { force: true, forced_state: "failed", reason: submitted.reason }));
        return this.settleLaneTermination(instance, submitted.reason, attempt, outcome);
      }
      const collected = await this.collectWithReconciliation(instance);
      if (!collected.ok) {
        if (collected.termination) return this.settleLaneTermination(instance, collected.reason, collected.termination, outcome);
        return outcome(collected.state, iid, collected.reason);
      }
      // (10) oracles, (11) authorities, preflight, pre.json, acceptHandoff once.
      const oracleEvidence = await this.settleOracles(withOracles, typed.items);
      return await this.acceptLane(spec, lane, instance, withOracles, collected.validation, oracleEvidence, claim, submitted.origin_ref, collected.manifest, collected.repair_incomplete, outcome);
    } catch (error) {
      const threwCleanup = error instanceof CleanupThrewError ? error : null;
      const reason = error instanceof ControllerRefusal ? error.reason
        : threwCleanup?.primary ?? `controller_error:${(error as Error).message}`;
      const ids = this.idsFor(instance);
      const persisted = readJsonFile(path.resolve(this.cwd, taskCellPaths(ids).acceptance_path)) as HandoffAcceptanceV1 | null;
      if (persisted?.schema_version === "guild.handoff_acceptance.v1" && persisted.downstream_release_at !== null) {
        // F4: an accepted fact on disk authorizes only unforced cleanup; never a conflicting failed terminal.
        // The retried cleanup's actual attempt (or its flat thrown error) is settled; the prior qualification is kept.
        const prior = threwCleanup ? { prior_error: threwCleanup.cause_message } : {};
        const termination: TerminationAttempt = await this.cleanup(instance, ids, threwCleanup?.final ?? null).then(
          (attempt) => ({ ...attempt, ...prior }),
          (cleanupError: unknown) => ({ result: null, threw: errorMessage(cleanupError), ...prior }),
        );
        return this.settleLaneTermination(instance, reason, termination, outcome, threwCleanup?.qualified ?? false);
      }
      // The loss scan owns anything left non-terminal; the outcome reports what actually happened.
      const attempt = await attemptTermination(() => this.runtime.terminate(instance, { force: true, forced_state: "failed", reason }));
      return this.settleLaneTermination(instance, reason, attempt, outcome);
    }
  }

  /**
   * collectHandoff, then (CD24) decide every thrown failure from disk: the runtime
   * state, the persisted validation, its bus publication and the lifecycle event
   * are re-observed independently; nothing is decided from the thrown error.
   */
  private async collectWithReconciliation(instance: InstanceHandle): Promise<
    | { ok: true; validation: HandoffValidationV1; manifest: AcceptanceEvidenceFinalV1["reconciliation_manifest"]; repair_incomplete: string | null }
    | { ok: false; state: string; reason: string; termination?: TerminationAttempt }
  > {
    let collected: Awaited<ReturnType<FilesystemTaskCellRuntime["collectHandoff"]>> | null;
    try {
      collected = await this.runtime.collectHandoff(instance);
    } catch {
      collected = null;
    }
    if (collected?.ok) return { ok: true, validation: collected.validation as HandoffValidationV1, manifest: [], repair_incomplete: null };
    if (collected && (collected as { failure?: string }).failure === "validation_failed") {
      return this.rejectFailedValidation(instance, (collected as { reason?: string }).reason ?? "validation failed");
    }
    if (collected) {
      // No teardown was attempted: report the actual runtime state, never an invented "failed".
      const state = (await this.runtime.observe(instance))?.handle.state ?? "unknown";
      return { ok: false, state, reason: (collected as { reason?: string }).reason ?? "collect_failed" };
    }
    return this.recoverValidation(instance);
  }

  private async rejectFailedValidation(instance: InstanceHandle, reason: string): Promise<{ ok: false; state: string; reason: string; termination: TerminationAttempt }> {
    const termination = await attemptTermination(() => this.runtime.rejectHandoff(instance, {
      acceptance_policy_version: this.plan.plan.acceptance_policy_version,
      authorities_required: ["deterministic_floor"],
      authorities_observed: [{ authority: "deterministic_floor", decision: "rejected", at: this.now(), reason }],
      reason: "validation_failed",
    } as never));
    return { ok: false, state: "rejected", reason: "validation_failed", termination };
  }

  /**
   * Post-state recognition for validation (CD24 / C-r2-F1, R2 matrix). Pre-state
   * with a persisted matching record → reconcile (bounded); post-state published
   * with its event → complete (a reconciliation whose result was lost is
   * reported as missing repair evidence); post-state without its event →
   * lifecycle_event_incomplete, release blocked; post-state unpublished →
   * integrity_violation. Never re-transitions or re-emits.
   */
  private async recoverValidation(instance: InstanceHandle): Promise<
    | { ok: true; validation: HandoffValidationV1; manifest: AcceptanceEvidenceFinalV1["reconciliation_manifest"]; repair_incomplete: string | null }
    | { ok: false; state: string; reason: string; termination?: TerminationAttempt }
  > {
    const ids = this.idsFor(instance);
    const rel = taskCellPaths(ids).validation_path;
    let reconcilerRan = false;
    for (let round = 0; round < 4; round++) {
      const persisted = readJsonFile(path.resolve(this.cwd, rel)) as HandoffValidationV1 | null;
      if (!persisted || persisted.schema_version !== "guild.handoff_validation.v1") throw new ControllerRefusal("collect_failed");
      const state = (await this.runtime.observe(instance))?.handle.state ?? null;
      if (state === "handoff_validated") {
        if (!this.busHasCurrentBytes(ids.run_id, rel)) return this.integrityViolation(instance);
        if (!lifecycleEventPresent(this.cwd, ids, "handoff_validated")) return { ok: false, state: "handoff_validated", reason: "lifecycle_event_incomplete" };
        return { ok: true, validation: persisted, manifest: [], repair_incomplete: reconcilerRan ? "reconciliation_sidecar_missing" : null };
      }
      if (state !== "handoff_submitted" || round === 3) break;
      if (classifyPersistedValidation(this.cwd, ids, persisted).kind !== "persisted_matching") throw new ControllerRefusal("validation_conflict");
      reconcilerRan = true;
      const out = await this.runtime.reconcilePersistedValidation(instance, persisted).catch(() => null);
      if (out?.ok) {
        try {
          const sidecar = this.writeSidecar(ids, "validation", out.publications[0], out.fact_at, out.runtime_transition_at);
          return { ok: true, validation: persisted, manifest: [{ kind: "validation", ...sidecar }], repair_incomplete: null };
        } catch (error) {
          return { ok: true, validation: persisted, manifest: [], repair_incomplete: error instanceof ControllerRefusal ? error.reason : "reconciliation_sidecar_missing" };
        }
      }
      if (out && "post_state_reached" in out && out.post_state_reached) {
        // Truthful sidecar from the metadata this call observed; release stays blocked.
        try {
          this.writeSidecar(ids, "validation", out.publications[0], out.fact_at, out.runtime_transition_at);
        } catch {
          /* the event is missing anyway: release is blocked */
        }
        return { ok: false, state: "handoff_validated", reason: "lifecycle_event_incomplete" };
      }
      if (out && !out.ok && (out as { failure?: string }).failure === "validation_failed") {
        return this.rejectFailedValidation(instance, (out as { reason?: string }).reason ?? "validation failed");
      }
      // Thrown or refused: re-observe from disk on the next round.
    }
    const state = (await this.runtime.observe(instance))?.handle.state ?? "failed";
    return { ok: false, state, reason: "validation_reconciliation_failed" };
  }

  /** Post-state without publication: unreachable through canonical writers → fail closed (CD24). */
  private async integrityViolation(instance: InstanceHandle): Promise<{ ok: false; state: string; reason: string; termination: TerminationAttempt }> {
    const termination = await attemptTermination(() => this.runtime.terminate(instance, { force: true, forced_state: "failed", reason: "integrity_violation" }));
    return { ok: false, state: "failed", reason: "integrity_violation", termination };
  }

  /**
   * C-r3-F1: the one place a lane's terminal outcome is decided. A terminal D5
   * state is reported only when a termination was actually attempted, its result
   * is not a teardown failure, the observed runtime state is that terminal state,
   * and the persisted immutable attempt and terminal seal record the same state.
   * Otherwise the lane reports its actual runtime state (e.g. terminating) with
   * the attempt's orphan flag and awaiting=teardown; the primary reason stays in
   * failure_reason and the teardown error in `teardown`. No D5 state is invented.
   */
  private async settleLaneTermination(
    instance: InstanceHandle,
    primaryReason: string | null,
    termination: TerminationAttempt | null,
    outcome: OutcomeFn,
    qualified = false,
  ): Promise<LaneOutcome> {
    const ids = this.idsFor(instance);
    const iid = instance.instance_id;
    const observed = (await this.runtime.observe(instance))?.handle.state ?? null;
    const attempt = readAttemptForInstance(this.cwd, ids);
    const seal = readJsonFile(path.resolve(this.cwd, taskCellPaths(ids).terminal_path)) as { terminal_state?: unknown } | null;
    const orphaned = attempt?.orphaned === true;
    const sealedAs = attempt?.immutable && attempt.terminal_state !== null && seal?.terminal_state === attempt.terminal_state
      ? attempt.terminal_state : null;
    const result = termination?.result as { ok?: boolean; failure?: string; reason?: string } | null | undefined;
    const recovered = termination?.recovered_post_state === true;
    const apiFailure = termination === null ? null
      : termination.threw !== null ? "threw" : result?.ok ? null : result?.failure ?? "unknown";
    // A recovered post-state confirms only from observed + sealed facts below; termination_failed never recovers.
    const resultFailure = recovered && apiFailure !== "termination_failed" ? null : apiFailure;
    const confirmed = termination !== null && (termination.threw === null || recovered) && resultFailure === null &&
      observed !== null && sealedAs !== null && sealedAs === observed;
    // Cleanup bookkeeping problems stay visible (audit fails closed) without un-confirming a sealed worker.
    const bookkeeping = [
      recovered && apiFailure !== null ? `api:${apiFailure}` : null,
      termination?.prior_error !== undefined ? "cleanup_threw" : null,
      termination?.cleanup_state !== undefined && termination.cleanup_state !== "complete" ? termination.cleanup_state : null,
      termination?.cleanup_record !== undefined && termination.cleanup_record !== "written" ? `cleanup_record_${termination.cleanup_record}` : null,
    ].filter((x): x is string => x !== null);
    const notes = [
      termination?.prior_error ?? null, recovered ? termination?.threw ?? null : null, recovered ? "recovered_post_state" : null,
    ].filter((x): x is string => x !== null);
    // qualified is only ever the qualification computed before cleanup (CD25); it is never re-derived here.
    if (confirmed) {
      this.noteHandle(iid, { runtime_state: observed, awaiting: null });
      return outcome(observed!, iid, primaryReason, null, qualified, {
        teardown: {
          ok: bookkeeping.length === 0, failure: bookkeeping.length ? bookkeeping.join(",") : null,
          reason: notes.length ? notes.join(";") : null, confirmed: true,
        },
        orphaned,
      });
    }
    const state = observed ?? "unknown";
    if (termination === null) return outcome(state, iid, primaryReason, null, qualified, { teardown: null, orphaned });
    this.noteHandle(iid, { runtime_state: state, awaiting: "teardown" });
    const failure = [resultFailure ?? "unconfirmed", ...bookkeeping].join(",");
    const reasonText = [termination.threw ?? result?.reason ?? null, ...notes].filter((x): x is string => x !== null);
    return outcome(state, iid, primaryReason, "teardown", qualified, {
      teardown: { ok: false, failure, reason: reasonText.length ? reasonText.join(";") : null, confirmed: false },
      orphaned,
    });
  }

  /** acceptLane cleanup: a thrown cleanup is raised to the generic catch with its primary reason, prior qualification and final. */
  private async cleanupOrRaise(
    instance: InstanceHandle, ids: TaskCellInstanceIds, final: AcceptanceEvidenceFinalV1 | null, primary: string | null, qualified: boolean,
  ): Promise<TerminationAttempt> {
    try {
      return await this.cleanup(instance, ids, final);
    } catch (error) {
      throw new CleanupThrewError(errorMessage(error), primary, qualified, final);
    }
  }

  /** True when the bus holds an artifact.published event for the CURRENT bytes of `rel`. */
  private busHasCurrentBytes(runId: string, rel: string): boolean {
    const bytes = regularBytes(path.resolve(this.cwd, rel));
    if (bytes === null) return false;
    const digest = sha256(bytes);
    return readBusLog(path.join(durableGuildDir(this.cwd), "runs", runId))
      .some((e) => e.event === "artifact.published" && e.path === rel && e.sha256 === digest);
  }

  private idsFor(instance: InstanceHandle): TaskCellInstanceIds {
    return { run_id: instance.run_id, logical_task_id: instance.logical_task_id, attempt: instance.attempt, instance_id: instance.instance_id };
  }

  /** Pre-release reconciliation sidecar: exclusive create, ≤3 identical-byte retries (CD24). */
  private writeSidecar(
    ids: TaskCellInstanceIds,
    kind: "acceptance" | "validation" | "handoff",
    publication: { path: string; sha256: string; outcome: string; bus_seq: number; reconciled_at: string; cas_created_at: string | null; cas_preexisting: boolean },
    factAt: string,
    transitionAt: string | null,
  ): { path: string; sha256: string } {
    const rel = reconciliationRel(ids.run_id, ids.instance_id, kind);
    const body = json({
      schema_version: TASK_CELL_RECONCILIATION_SCHEMA, kind, path: publication.path, sha256: publication.sha256,
      fact_at: factAt, reconciled_at: publication.reconciled_at, cas_created_at: publication.cas_created_at,
      cas_preexisting: publication.cas_preexisting, outcome: publication.outcome, bus_seq: publication.bus_seq,
      runtime_transition_at: transitionAt,
    });
    for (let i = 0; i < 3; i++) {
      try {
        const outcome = writeExclusiveIdempotent(path.resolve(this.cwd, rel), body);
        if (outcome === "conflict") throw new ControllerRefusal("reconciliation_sidecar_conflict");
        return { path: rel, sha256: sha256(body) };
      } catch (error) {
        if (error instanceof ControllerRefusal) throw error;
      }
    }
    throw new ControllerRefusal("reconciliation_sidecar_missing");
  }

  /** Settle every typed oracle from controller evidence only (CD9). */
  private async settleOracles(
    assignment: TaskAssignmentV2,
    items: ReadonlyArray<DoneWhenItem & { target: string }>,
  ): Promise<Array<FileRef & { oracle_id: string; result: string }>> {
    const out: Array<FileRef & { oracle_id: string; result: string }> = [];
    const ids = idsOf(assignment);
    for (const item of items) {
      const decoded = decodeExecutableTarget(item.oracle, item.target);
      if (!decoded.ok) throw new ControllerRefusal("oracle_target_invalid", decoded.reason);
      const startedAt = this.now();
      let result: "pass" | "fail" = "fail";
      let exitCode: number | null = null;
      let stdoutSha: string | null = null;
      let stderrSha: string | null = null;
      let artifactSha: string | null = null;
      if (decoded.kind === "command") {
        const target = decoded.value as CommandOracleTarget;
        // env -i semantics: no inherited environment (in particular no binding); PATH only to resolve argv[0].
        const r = spawnSync(target.argv[0], target.argv.slice(1), {
          cwd: path.resolve(this.cwd, target.cwd), env: { PATH: process.env["PATH"] ?? "/usr/bin:/bin" },
          timeout: target.timeout_ms, encoding: "buffer", maxBuffer: 64 * 1024 * 1024,
        });
        exitCode = typeof r.status === "number" ? r.status : null;
        stdoutSha = r.stdout ? sha256(r.stdout) : null;
        stderrSha = r.stderr ? sha256(r.stderr) : null;
        result = exitCode === 0 ? "pass" : "fail";
      } else if (decoded.kind === "artifact_exists") {
        const target = decoded.value as ArtifactExistsOracleTarget;
        const abs = path.resolve(this.cwd, target.path);
        const realRoot = fs.realpathSync(this.cwd);
        let real: string | null = null;
        try {
          real = fs.realpathSync(abs);
        } catch {
          real = null;
        }
        const bytes = regularBytes(abs);
        if (bytes !== null && real !== null && real.startsWith(realRoot + path.sep)) {
          artifactSha = sha256(bytes);
          result = target.sha256 === null || target.sha256 === artifactSha ? "pass" : "fail";
        }
      } else {
        const target = decoded.value as AcceptanceRecordOracleTarget;
        const qualified = findQualifiedRunAcceptances(this.cwd, assignment.run_id, { policy: "cooperative_local", context: { mode: "same_run" } });
        result = qualified.some((q) => q.ids.logical_task_id === target.logical_task_id) ? "pass" : "fail";
      }
      const rel = oracleEvidenceRel(assignment.run_id, assignmentId(assignment), item.id);
      const body = json({
        schema_version: ORACLE_EVIDENCE_SCHEMA, oracle_id: item.id, kind: decoded.kind, target: item.target, result,
        exit_code: exitCode, stdout_sha256: stdoutSha, stderr_sha256: stderrSha, artifact_sha256: artifactSha,
        started_at: startedAt, ended_at: this.now(), uid: currentUid(), trust_policy: this.principal.worker_trust_policy,
      });
      if (!writeExclusive(path.resolve(this.cwd, rel), body)) throw new ControllerRefusal("oracle_evidence_exists", rel);
      const settled = recordOracleOutcome({
        cwd: this.cwd, run_id: assignment.run_id, logical_task_id: ids.logical_task_id, item_id: item.id,
        state: result, now: this.now, binding: this.binding,
      });
      if (!settled.ok) throw new ControllerRefusal("oracle_settlement_refused", settled.reason);
      out.push({ oracle_id: item.id, path: rel, sha256: sha256(body), result });
    }
    return out;
  }

  /** CD11 steps 11–13: authorities, preflight (CD17a), pre.json, acceptHandoff, final.json, cleanup. */
  private async acceptLane(
    spec: LaneSpec,
    lane: OraclePlanLane,
    instance: InstanceHandle,
    assignment: TaskAssignmentV2,
    validation: HandoffValidationV1,
    oracleEvidence: Array<FileRef & { oracle_id: string; result: string }>,
    ackClaim: { claim: AssignmentAckClaimV1; ref: FileRef } | null,
    originRef: FileRef,
    priorManifest: AcceptanceEvidenceFinalV1["reconciliation_manifest"],
    repairIncomplete: string | null,
    outcome: OutcomeFn,
  ): Promise<LaneOutcome> {
    const iid = instance.instance_id;
    const ids = idsOf(assignment);
    const paths = taskCellPaths(ids);
    if (!ackClaim) return outcome("handoff_validated", iid, null, "ack_claim");
    // team_lead
    const lead = await this.poll(() => {
      const d = readTeamLeadDecision(this.cwd, assignment, this.claim, validation, this.principal.operatorUid());
      return d.ok || d.reason !== "awaiting_team_lead" ? d : null;
    }, 1_000, spec.review_timeout_ms ?? 3_600_000);
    if (!lead) return this.awaiting(iid, "team_lead", outcome);
    if (!lead.ok) return this.awaiting(iid, `team_lead:${lead.reason}`, outcome);
    if (lead.decision.decision === "rejected") return this.reject(instance, lane, validation, "team_lead", lead.decision.at, lead.decision.reason ?? "team_lead rejected", outcome);
    // reviewer_cell from the approved broker slot (CD12)
    let review: ReviewerAuthority | null = null;
    if (lane.reviewer_participant_id !== null) {
      if (!this.proposal) return this.awaiting(iid, "reviewer_cell:proposal_absent", outcome);
      if (lane.reviewer_participant_id === this.claim.lead_binding_id) return this.awaiting(iid, "reviewer_cell:reviewer_is_lead", outcome);
      const requestRel = this.writeReviewRequest(spec, assignment, lane.reviewer_participant_id);
      review = await this.poll(() => {
        const r = deriveReviewerCellAuthority({
          cwd: this.cwd, requestPath: requestRel, proposal: this.proposal!, reviewedHostFamily: spec.host.host_family,
          operatorUid: this.principal.operatorUid(), knownInvocationIds: otherInvocationIds(this.cwd, assignment.run_id, reviewPacketId(ids)),
        });
        return r.decision === "awaiting" ? null : r;
      }, 5_000, spec.review_timeout_ms ?? 3_600_000);
      if (!review) return this.awaiting(iid, "reviewer_cell", outcome);
      if (review.decision === "review_refused") return this.awaiting(iid, `reviewer_cell:${review.reason}`, outcome);
      if (review.decision === "rejected") return this.reject(instance, lane, validation, "reviewer_cell", review.evidence?.finished_at ?? this.now(), review.reason ?? "review not satisfied", outcome);
    }
    const observed: AuthorityDecision[] = [
      { authority: "deterministic_floor", decision: "accepted", at: validation.validated_at, reason: null },
      { authority: "team_lead", decision: "accepted", at: lead.decision.at, reason: null },
      ...(review?.evidence ? [{ authority: "reviewer_cell" as const, decision: "accepted" as const, at: review.evidence.finished_at, reason: null }] : []),
    ];
    // F2: the approved lane's authority set, validated at start against its reviewer participant.
    const required = [...lane.authorities_required];

    // Pre-release joins; a silently failed optional handoff publication is repaired (CD24).
    // F3: reconciliations performed earlier for this instance (validation) seed the manifest.
    const manifest: AcceptanceEvidenceFinalV1["reconciliation_manifest"] = [...priorManifest];
    const joins = verifyPrereleaseBusJoins(this.cwd, ids, ["assignment", "ack", "handoff", "validation"]);
    for (const j of joins.filter((x) => x.reason !== null)) {
      if (j.kind !== "handoff") return this.awaiting(iid, "prerelease_bus_join_missing", outcome);
      const pub = publishPersistedLifecycleRecord(this.cwd, ids, "handoff", this.binding, this.now);
      const pointer = readJsonFile(path.resolve(this.cwd, paths.handoff_path)) as { submitted_at?: string } | null;
      manifest.push({ kind: "handoff", ...this.writeSidecar(ids, "handoff", pub, pointer?.submitted_at ?? validation.validated_at, null) });
    }

    // CD17a preflight P1–P7.
    const preflight = this.preflight(assignment, validation, oracleEvidence, originRef);
    if (!preflight.ok) return this.awaiting(iid, preflight.reason, outcome);
    const intended: IntendedAcceptance = {
      acceptance_policy_version: this.plan.plan.acceptance_policy_version,
      authorities_required: required as never,
      authorities_observed: observed,
      reviewer_cell_id: null,
      validation_result_id: validation.validation_result_id,
      receipt_id: validation.receipt_id,
      assignment_id: assignmentId(assignment),
      not_before: "",
    };
    const writtenAt = this.now();
    intended.not_before = writtenAt;
    const pins: EvidencePin[] = [];
    const pin = (role: string, ref: FileRef | null): FileRef => {
      if (!ref) throw new ControllerRefusal("evidence_pin_unreadable", role);
      pins.push({ role, ...ref });
      return ref;
    };
    const assignmentRef = pin("assignment", fileRef(this.cwd, paths.assignment_path));
    const receiptRef = pin("retained_receipt", fileRef(this.cwd, paths.receipt_path));
    pin("origin", originRef);
    const validationRef = pin("validation", fileRef(this.cwd, paths.validation_path));
    const ledgerRef = pin("ledger", fileRef(this.cwd, progressLedgerPath({ run_id: ids.run_id, logical_task_id: ids.logical_task_id })));
    for (const e of oracleEvidence) pin(`oracle_evidence:${e.oracle_id}`, e);
    const leadRef = pin("team_lead", lead.ref);
    pin("oracle_plan", this.plan.plan_ref);
    pin("oracle_plan_decision", this.plan.decision_ref);
    const ackRef = pin("ack_claim", ackClaim.ref);
    if (review?.evidence) {
      for (const k of ["request", "candidate", "packet", "invocation", "adapter_exit", "result"] as const) pin(`review:${k}`, review.evidence[k]);
    }
    const pre: AcceptanceEvidencePreV1 = {
      schema_version: ACCEPTANCE_EVIDENCE_SCHEMA,
      identity: {
        root_id: this.claim.root_id, source_id: this.claim.source_id, root_fingerprint: this.claim.root_fingerprint,
        run_id: ids.run_id, logical_task_id: ids.logical_task_id, attempt: ids.attempt, instance_id: ids.instance_id,
        controller_instance_id: this.claim.controller_instance_id, operator_uid: this.principal.operatorUid(),
        worker_uid: this.principal.workerUid(), lead_binding_id: this.claim.lead_binding_id,
      },
      producer_context: {
        source_id: this.claim.source_id, source_revision: this.claim.source_revision, package_identity: this.claim.package_identity,
        provider: this.claim.provider, host_profile_id: this.claim.host_profile_id,
        package_release_version: this.claim.package_release_version, package_current_package: this.claim.package_current_package,
        package_root: this.claim.package_root, worker_trust_policy: this.claim.worker_trust_policy,
        acceptance_policy_version: this.plan.plan.acceptance_policy_version, lead_binding_id: this.claim.lead_binding_id,
        reviewed_basis: this.claim.reviewed_basis,
      },
      bound_artifacts: {
        assignment_sha256: assignmentRef.sha256,
        done_when_ref: (assignment as unknown as Record<string, unknown>)["done_when_ref"] ?? null,
        retained_receipt_sha256: receiptRef.sha256,
        origin_sha256: originRef.sha256,
        validation_result_id: validation.validation_result_id,
        validation_sha256: validationRef.sha256,
        ledger_sha256: ledgerRef.sha256,
        oracle_evidence: oracleEvidence,
        team_lead: { ...leadRef, lead_binding_id: lead.decision.lead_binding_id, decided_by: lead.decision.decided_by, decision: lead.decision.decision, at: lead.decision.at },
        review: review?.evidence
          ? { ...review.evidence, source: "broker", result_schema_valid: true, exit: 0, gate_conditions: review.gate_conditions! }
          : null,
        deterministic_floor: { validated_at: validation.validated_at },
        oracle_plan: this.plan.plan_ref,
        oracle_plan_decision: this.plan.decision_ref,
        ack_claim: ackRef,
      },
      pins,
      intended_acceptance: intended,
      reviewer_cell_id: null,
      written_at: writtenAt,
    };
    const preRel = evidenceRel(ids.run_id, iid, "pre.json");
    if (!writeExclusive(path.resolve(this.cwd, preRel), json(pre))) return this.awaiting(iid, "pre_evidence_exists", outcome);

    // acceptHandoff exactly once; failures classified from disk (CD11/CD24).
    const accepted = await this.acceptWithRecognition(instance, intended, required, observed, manifest);
    if (!accepted.ok) {
      if (accepted.termination) return this.settleLaneTermination(instance, accepted.reason, accepted.termination, outcome);
      // F4: a persisted accepted fact is never force-failed; it is left unqualified (no final.json) and cleaned up unforced.
      if (accepted.accepted_fact) {
        const cleanupTermination = await this.cleanupOrRaise(instance, ids, null, accepted.reason, false);
        return this.settleLaneTermination(instance, accepted.reason, cleanupTermination, outcome);
      }
      return outcome(accepted.state, iid, accepted.reason);
    }
    const accJoin = verifyPrereleaseBusJoins(this.cwd, ids, ["acceptance"])[0];
    if (accJoin.reason !== null) return outcome("handoff_accepted", iid, "prerelease_bus_join_missing");
    // A pre-release reconciliation whose repair evidence is missing never finalizes (CD24).
    if (repairIncomplete !== null) {
      const cleanupTermination = await this.cleanupOrRaise(instance, ids, null, repairIncomplete, false);
      return this.settleLaneTermination(instance, repairIncomplete, cleanupTermination, outcome);
    }

    // (12) final.json, then CD17b same_run before dependents may be admitted.
    const acceptanceBytes = regularBytes(path.resolve(this.cwd, paths.acceptance_path));
    if (acceptanceBytes === null) return outcome("handoff_accepted", iid, "finalization_failed");
    const final: AcceptanceEvidenceFinalV1 = {
      schema_version: ACCEPTANCE_EVIDENCE_FINAL_SCHEMA,
      pre_sha256: sha256(json(pre)),
      acceptance_sha256: sha256(acceptanceBytes),
      finalized_at: this.now(),
      reconciliation_manifest: manifest,
      reconciliation_manifest_complete: true,
    };
    let finalized = false;
    for (let i = 0; i < 3 && !finalized; i++) {
      try {
        finalized = writeExclusiveIdempotent(path.resolve(this.cwd, evidenceRel(ids.run_id, iid, "final.json")), json(final)) !== "conflict";
      } catch {
        finalized = false;
      }
    }
    const acceptanceRecord = JSON.parse(acceptanceBytes.toString("utf8")) as HandoffAcceptanceV1;
    const qualification = finalized
      ? isQualifiedDownstreamRelease(this.cwd, { ids, acceptance: acceptanceRecord }, { policy: "cooperative_local", context: { mode: "same_run" } })
      : null;
    // (13) post-release cleanup; never changes qualification.
    const cleanupTermination = await this.cleanupOrRaise(
      instance, ids, finalized ? final : null, finalized ? null : "finalization_failed", qualification?.qualified_release === true,
    );
    if (!finalized) return this.settleLaneTermination(instance, "finalization_failed", cleanupTermination, outcome);
    // Qualification is a release fact; the lane state still comes only from the confirmed cleanup termination.
    return this.settleLaneTermination(
      instance, qualification?.qualified_release ? null : qualification?.reason ?? null, cleanupTermination, outcome,
      qualification?.qualified_release === true,
    );
  }

  private awaiting(iid: string, what: string, outcome: OutcomeFn): LaneOutcome {
    this.noteHandle(iid, { awaiting: what, runtime_state: "handoff_validated" });
    return outcome("handoff_validated", iid, null, what);
  }

  private async reject(
    instance: InstanceHandle,
    lane: OraclePlanLane,
    validation: HandoffValidationV1,
    authority: "team_lead" | "reviewer_cell",
    at: string,
    reason: string,
    outcome: OutcomeFn,
  ): Promise<LaneOutcome> {
    const ids = this.idsFor(instance);
    // Rejection is allowed only while no acceptance persisted (CD11); no teardown is attempted then.
    if (fs.existsSync(path.resolve(this.cwd, taskCellPaths(ids).acceptance_path))) {
      return this.settleLaneTermination(instance, "acceptance_conflict", null, outcome);
    }
    const termination = await attemptTermination(() => this.runtime.rejectHandoff(instance, {
      acceptance_policy_version: this.plan.plan.acceptance_policy_version,
      authorities_required: lane.authorities_required as never,
      authorities_observed: [
        { authority: "deterministic_floor", decision: "accepted", at: validation.validated_at, reason: null },
        { authority, decision: "rejected", at, reason },
      ],
      reason,
    } as never));
    return this.settleLaneTermination(instance, reason, termination, outcome);
  }

  private writeReviewRequest(spec: LaneSpec, assignment: TaskAssignmentV2, reviewerId: string): string {
    const ids = idsOf(assignment);
    const slot = this.proposal!.participants.find((p) => p.participant_id === reviewerId);
    if (!slot || slot.participation_kind !== "reviewer_cross_host") throw new ControllerRefusal("reviewer_slot_not_cross_host");
    const leadParticipant = this.proposal!.participants.find((p) => p.participant_id === this.claim.lead_binding_id);
    if (leadParticipant?.participation_kind === "reviewer_cross_host") throw new ControllerRefusal("lead_is_reviewer");
    const packetId = reviewPacketId(ids);
    const receipt = fileRef(this.cwd, taskCellPaths(ids).receipt_path);
    if (!receipt) throw new ControllerRefusal("retained_receipt_absent");
    const request: ReviewRequestV1 = {
      schema_version: TASK_CELL_REVIEW_REQUEST_SCHEMA,
      request_id: `${packetId}.req`,
      packet_id: packetId,
      reviewer_participant_id: reviewerId,
      participation_kind: slot.participation_kind,
      role_ref: slot.role_ref,
      proposal_sha256: this.proposal!.proposal_hash ?? "",
      retained_receipt: receipt,
      reviewed: { cell_id: assignment.cell_id, logical_task_id: ids.logical_task_id, instance_id: ids.instance_id, worker_role: assignment.worker_role, host_family: spec.host.host_family },
      evidence_dir: runRel(ids.run_id, "review", packetId),
    };
    const rel = reviewRequestRel(ids.run_id, ids.instance_id);
    writeExclusiveIdempotent(path.resolve(this.cwd, rel), json(request));
    return rel;
  }

  /** CD17a P1–P7, reading only artifacts that exist before acceptance. */
  private preflight(
    assignment: TaskAssignmentV2,
    validation: HandoffValidationV1,
    oracleEvidence: Array<FileRef & { oracle_id: string; result: string }>,
    originRef: FileRef,
  ): { ok: true } | Refused {
    const ids = idsOf(assignment);
    const paths = taskCellPaths(ids);
    // P1
    if (validation.result !== "passed" || fileRef(this.cwd, paths.validation_path) === null) return refuse("preflight_validation");
    // P2
    const typed = validateExecutableDoneWhen((assignment as unknown as Record<string, unknown>)["done_when"], { scope_paths: assignment.scope_paths, dependencies: assignment.dependencies });
    const ledger = readProgressLedger({ cwd: this.cwd, run_id: ids.run_id, logical_task_id: ids.logical_task_id });
    if (!typed.ok || !ledgerBoundToAssignment(ledger, assignment).ok || !cellCanGoDone(ledger).ok) return refuse("preflight_oracles");
    for (const e of oracleEvidence) {
      const now = fileRef(this.cwd, e.path);
      if (!now || now.sha256 !== e.sha256 || e.result !== "pass") return refuse("preflight_oracle_evidence");
    }
    // P4
    const origin = readJsonFile(path.resolve(this.cwd, originRef.path)) as HandoffOriginV1 | null;
    const receipt = fileRef(this.cwd, paths.receipt_path);
    if (!origin || fileRef(this.cwd, originRef.path)?.sha256 !== originRef.sha256 || !receipt || origin.receipt_sha256 !== receipt.sha256 ||
        origin.native_task_completed !== false || origin.controller_instance_id !== this.claim.controller_instance_id) return refuse("preflight_origin");
    // P5
    const root = readRootIdentity(this.cwd);
    if (root.root_id !== this.claim.root_id || root.source_id !== this.claim.source_id || root.root_fingerprint !== this.claim.root_fingerprint) {
      return refuse("preflight_root_identity");
    }
    // P6 — a source run has no verified installed package: never accepted (CD16).
    if (!this.claim.package_root || !this.claim.package_identity) return refuse("mechanics_only");
    try {
      const pkg = readPackageIdentity(this.claim.package_root);
      if (pkg.package_identity.id !== this.claim.package_identity.id || pkg.package_identity.sha256 !== this.claim.package_identity.sha256) {
        return refuse("preflight_package_identity");
      }
      if (pkg.source_revision === null || this.claim.source_revision === null) return refuse("source_commit_absent");
      if (pkg.source_revision !== this.claim.source_revision) return refuse("preflight_package_identity");
      if (!reverifyReviewedBasis(this.claim.reviewed_basis, pkg.source_revision, this.principal.operatorUid())) return refuse("basis_unreviewed");
    } catch {
      return refuse("preflight_package_identity");
    }
    if (this.claim.provider !== this.principal.id || this.claim.host_profile_id !== hostProfileId(this.principal.id)) return refuse("preflight_provider");
    // P7
    if (this.claim.worker_trust_policy !== "cooperative_local") return refuse("preflight_trust_policy");
    return { ok: true };
  }

  /**
   * acceptHandoff, deciding every failure from disk (CD11/CD24), never from the
   * thrown error. An absent record after an I/O-class failure is retried at most
   * 3 times (4 attempts), reclassifying after each. The controller calls this
   * only after its own preflight verified the ledger binding, oracle completion
   * and every required authority, so an absent failure not coded
   * validation_failed / malformed_assignment / illegal_state can only be a write
   * or publish fault. Still absent: a durable rejection carrying the actual
   * accepted observations (no invented authority). `accepted_fact` tells the
   * caller a persisted accepted record exists, so only unforced cleanup is legal.
   */
  private async acceptWithRecognition(
    instance: InstanceHandle,
    intended: IntendedAcceptance,
    required: string[],
    observed: AuthorityDecision[],
    manifest: AcceptanceEvidenceFinalV1["reconciliation_manifest"],
  ): Promise<{ ok: true } | { ok: false; state: string; reason: string; accepted_fact: boolean; termination?: TerminationAttempt }> {
    const ids = this.idsFor(instance);
    const NON_IO = new Set(["validation_failed", "malformed_assignment", "illegal_state"]);
    let lastReason = "acceptance_failed";
    for (let attemptNo = 0; attemptNo < 4; attemptNo++) {
      const accepted = await this.runtime.acceptHandoff(instance, {
        acceptance_policy_version: intended.acceptance_policy_version,
        authorities_required: required as never,
        authorities_observed: observed,
        reviewer_cell_id: null,
      } as never).catch((error: unknown) => ({ ok: false as const, failure: "io_error", reason: (error as Error).message }));
      if (accepted.ok) return { ok: true };
      const failure = (accepted as { failure?: string }).failure ?? "io_error";
      lastReason = (accepted as { reason?: string }).reason ?? failure;
      const state = (await this.runtime.observe(instance))?.handle.state ?? null;
      const persisted = classifyPersistedAcceptance(this.cwd, ids, intended);
      if (persisted.kind !== "absent") return this.recognizePersistedAcceptance(instance, intended, persisted, state, manifest);
      if (NON_IO.has(failure)) break;
    }
    const reason = `acceptance_failed:${lastReason}`;
    const termination = await attemptTermination(() => this.runtime.rejectHandoff(instance, {
      acceptance_policy_version: intended.acceptance_policy_version,
      authorities_required: required as never,
      authorities_observed: observed,
      reviewer_cell_id: null,
      reason,
    } as never));
    if ((termination.result as { ok?: boolean } | null)?.ok) return { ok: false, state: "rejected", reason, accepted_fact: false, termination };
    // The rejection may have persisted with a failed teardown; never report a write that did not happen.
    const record = readJsonFile(path.resolve(this.cwd, taskCellPaths(ids).acceptance_path)) as HandoffAcceptanceV1 | null;
    const state = (await this.runtime.observe(instance))?.handle.state ?? "handoff_validated";
    if (record?.schema_version === "guild.handoff_acceptance.v1" && record.downstream_release_at === null) {
      // The rejection persisted; the lane state comes from the (unconfirmed) teardown, the reason stays primary.
      return { ok: false, state, reason, accepted_fact: false, termination };
    }
    return { ok: false, state, reason: "rejection_write_failed", accepted_fact: false };
  }

  /** The persisted-record branches of CD24 (matching or conflicting acceptance on disk). */
  private async recognizePersistedAcceptance(
    instance: InstanceHandle,
    intended: IntendedAcceptance,
    persisted: Exclude<ReturnType<typeof classifyPersistedAcceptance>, { kind: "absent" }>,
    _state: string | null,
    manifest: AcceptanceEvidenceFinalV1["reconciliation_manifest"],
  ): Promise<{ ok: true } | { ok: false; state: string; reason: string; accepted_fact: boolean; termination?: TerminationAttempt }> {
    const ids = this.idsFor(instance);
    if (persisted.kind === "persisted_conflicting") {
      const termination = await attemptTermination(() => this.runtime.terminate(instance, { force: true, forced_state: "failed", reason: "acceptance_conflict" }));
      return { ok: false, state: "failed", reason: "acceptance_conflict", accepted_fact: false, termination };
    }
    const rel = taskCellPaths(ids).acceptance_path;
    let reconcilerRan = false;
    for (let round = 0; round < 4; round++) {
      // Re-observe independently after the original call and after EVERY reconciler failure.
      const state = (await this.runtime.observe(instance))?.handle.state ?? null;
      if (state === "handoff_accepted") {
        if (!this.busHasCurrentBytes(ids.run_id, rel)) {
          const v = await this.integrityViolation(instance);
          return { ...v, accepted_fact: false };
        }
        if (!lifecycleEventPresent(this.cwd, ids, "handoff_accepted")) {
          return { ok: false, state: "handoff_accepted", reason: "lifecycle_event_incomplete", accepted_fact: true };
        }
        // Complete post-state. If our reconciliation produced it but its result was lost,
        // the repair evidence is missing: the accepted fact stands, finalization does not.
        return reconcilerRan
          ? { ok: false, state: "handoff_accepted", reason: "reconciliation_sidecar_missing", accepted_fact: true }
          : { ok: true };
      }
      if (state !== "handoff_validated" || round === 3) break;
      reconcilerRan = true;
      const out = await this.runtime.reconcilePersistedAcceptance(instance, intended).catch(() => null);
      if (out?.ok) {
        // F4: the acceptance is a published, transitioned fact; a sidecar failure leaves it unqualified.
        try {
          manifest.push({ kind: "acceptance", ...this.writeSidecar(ids, "acceptance", out.publications[0], out.fact_at, out.runtime_transition_at) });
          return { ok: true };
        } catch (error) {
          const reason = error instanceof ControllerRefusal ? error.reason : "reconciliation_sidecar_missing";
          return { ok: false, state: "handoff_accepted", reason, accepted_fact: true };
        }
      }
      if (out && "post_state_reached" in out && out.post_state_reached) {
        try {
          this.writeSidecar(ids, "acceptance", out.publications[0], out.fact_at, out.runtime_transition_at);
        } catch {
          /* release is blocked by the missing event regardless */
        }
        return { ok: false, state: "handoff_accepted", reason: "lifecycle_event_incomplete", accepted_fact: true };
      }
      // Thrown or refused: loop re-observes from disk.
    }
    const state = (await this.runtime.observe(instance))?.handle.state ?? "handoff_validated";
    return { ok: false, state, reason: "acceptance_publication_failed", accepted_fact: true };
  }

  /**
   * Post-release cleanup (CD25): unforced terminate, then decide every failure from
   * disk (runtime state, persisted seal, bus publication of attempt/instance/
   * terminal, lifecycle event). Outcomes only change cleanup.json and the closed
   * audit, never final.json or release. final_sha256 is pinned only from the
   * persisted final.json bytes (null when finalization did not durably write it).
   */
  private async cleanup(instance: InstanceHandle, ids: TaskCellInstanceIds, final: AcceptanceEvidenceFinalV1 | null): Promise<TerminationAttempt> {
    const request = { terminal_state: "terminated" as const, reason: null, not_before: this.now() };
    const TERMINAL = new Set(["terminated", "failed", "cancelled", "timed_out", "rejected"]);
    let cleanupState = "complete";
    let terminalReconciliation: FileRef | null = null;
    let result: Awaited<ReturnType<FilesystemTaskCellRuntime["terminate"]>> | null;
    let threw: string | null = null;
    try {
      result = await this.runtime.terminate(instance);
    } catch (error) {
      result = null;
      threw = error instanceof Error ? error.message : String(error);
    }
    // illegal_state means the instance already left the terminable states (e.g. a prior cleanup sealed it):
    // decide from the re-observed runtime and persisted terminal, exactly as for a thrown terminate.
    const illegalState = result !== null && !result.ok && (result as { failure?: string }).failure === "illegal_state";
    if (result && !result.ok && !illegalState) {
      cleanupState = (result as { failure?: string }).failure === "termination_failed" ? "orphaned" : "pending";
    } else if (result === null || illegalState) {
      let reconcilerRan = false;
      cleanupState = "terminal_publication_incomplete";
      for (let round = 0; round < 4; round++) {
        const live = (await this.runtime.observe(instance))?.handle.state ?? null;
        if (live !== null && TERMINAL.has(live)) {
          cleanupState = reconcilerRan ? "terminal_reconciliation_incomplete" : "complete";
          break;
        }
        if (round === 3) break;
        const persisted = classifyPersistedTerminal(this.cwd, ids, request);
        if (persisted.kind !== "persisted_matching") {
          cleanupState = persisted.kind === "absent" ? "pending" : "integrity_violation";
          break;
        }
        reconcilerRan = true;
        const out = await this.runtime.reconcilePersistedTerminal(instance, request).catch(() => null);
        if (out && (out.ok || ("post_state_reached" in out && out.post_state_reached))) {
          const meta = out as { publications: unknown[]; fact_at: string; runtime_transition_at: string };
          const rel = cleanupRel(ids.run_id, ids.instance_id, "terminal-reconciliation.json");
          const body = json({
            schema_version: TASK_CELL_RECONCILIATION_SCHEMA, kind: "terminal", publications: meta.publications,
            fact_at: meta.fact_at, reconciled_at: (meta.publications[0] as { reconciled_at?: string } | undefined)?.reconciled_at ?? null,
            runtime_transition_at: meta.runtime_transition_at,
          });
          let written = false;
          for (let i = 0; i < 3 && !written; i++) {
            try {
              written = writeExclusiveIdempotent(path.resolve(this.cwd, rel), body) !== "conflict";
            } catch {
              written = false;
            }
          }
          if (written) terminalReconciliation = { path: rel, sha256: sha256(body) };
          cleanupState = !out.ok ? "lifecycle_event_incomplete" : written ? "complete" : "terminal_reconciliation_incomplete";
          break;
        }
        // Thrown or refused: re-observe from disk on the next round.
      }
    }
    // Facts from disk decide publication and telemetry; precedence keeps the strongest failure.
    const attempt = readAttemptForInstance(this.cwd, ids);
    const p = taskCellPaths(ids);
    const published = attempt?.terminal_state != null &&
      [p.attempt_path, p.instance_path, p.terminal_path].every((rel) => this.busHasCurrentBytes(ids.run_id, rel));
    const eventPresent = attempt?.terminal_state != null && lifecycleEventPresent(this.cwd, ids, attempt.terminal_state);
    if (attempt?.terminal_state && ["complete", "terminal_reconciliation_incomplete", "lifecycle_event_incomplete"].includes(cleanupState)) {
      const live = (await this.runtime.observe(instance))?.handle.state ?? null;
      if (!published) cleanupState = live !== null && TERMINAL.has(live) ? "integrity_violation" : "terminal_publication_incomplete";
      else if (!eventPresent) cleanupState = "lifecycle_event_incomplete";
    }
    const terminal = fileRef(this.cwd, p.terminal_path);
    const finalBytes = final === null ? null : regularBytes(path.resolve(this.cwd, evidenceRel(ids.run_id, ids.instance_id, "final.json")));
    const finalSha = finalBytes !== null && finalBytes.toString("utf8") === json(final) ? sha256(finalBytes) : null;
    let cleanupRecord: "written" | "exists" | "write_failed";
    try {
      cleanupRecord = writeExclusive(path.resolve(this.cwd, cleanupRel(ids.run_id, ids.instance_id, "cleanup.json")), json({
        schema_version: TASK_CELL_CLEANUP_SCHEMA, instance_id: ids.instance_id, final_sha256: finalSha,
        terminal_state: attempt?.terminal_state ?? null, terminal_sha256: terminal?.sha256 ?? null, terminal_published: published,
        terminal_reconciliation: terminalReconciliation,
        terminal_telemetry_state: attempt?.terminal_state ? (eventPresent ? "complete" : "lifecycle_event_incomplete") : "unknown",
        cleanup_state: cleanupState, observed_at: this.now(),
      })) ? "written" : "exists";
    } catch {
      cleanupRecord = "write_failed";
    }
    // The handle is cleared only for a sealed terminal; otherwise it keeps the actual runtime state, awaiting teardown.
    const seal = readJsonFile(path.resolve(this.cwd, p.terminal_path)) as { terminal_state?: unknown } | null;
    const sealed = attempt?.immutable === true && attempt.terminal_state != null && seal?.terminal_state === attempt.terminal_state;
    if (sealed) {
      this.noteHandle(ids.instance_id, { runtime_state: attempt!.terminal_state, awaiting: null });
    } else {
      const live = (await this.runtime.observe(instance))?.handle.state ?? null;
      this.noteHandle(ids.instance_id, { runtime_state: live, awaiting: "teardown" });
    }
    // A recovered physical post-state is a separate verified-fact flag (immutable attempt + matching seal),
    // never a synthesized API result; publication/event problems stay in cleanup_state.
    const recovered = (threw !== null || illegalState) && sealed;
    return { result, threw, recovered_post_state: recovered, cleanup_state: cleanupState, cleanup_record: cleanupRecord };
  }

  /** CD26 step 4: once every station instance is terminal, write the team result once. */
  writeStationResult(): string {
    if (this.planRel === null) throw new ControllerRefusal("team_plan_not_written");
    // Every allocated instance (including ones that never reached assignment) must be terminal;
    // a missing or unreadable attempt fails closed. Cleanup completeness is not required here.
    for (const ids of this.allocated.values()) {
      const attempt = readAttemptForInstance(this.cwd, ids);
      if (!attempt || attempt.terminal_state === null) throw new ControllerRefusal("station_not_settled", ids.instance_id);
    }
    const lanes = this.instances.map(({ assignment }) => {
      const paths = taskCellPaths(idsOf(assignment));
      const attempt = readAttemptForInstance(this.cwd, idsOf(assignment));
      if (!attempt || attempt.terminal_state === null) throw new ControllerRefusal("station_not_settled", assignment.instance_id);
      return {
        role: assignment.worker_role,
        instance_id: assignment.instance_id,
        handoff_ref: fs.existsSync(path.resolve(this.cwd, paths.handoff_path)) ? paths.handoff_path : null,
        acceptance_ref: fs.existsSync(path.resolve(this.cwd, paths.acceptance_path)) ? paths.acceptance_path : null,
      };
    });
    const abs = writeTeamResult(this.cwd, this.claim.run_id, {
      schema_version: "guild.team_result.v1", station: this.phaseStation(), team_plan_ref: this.planRel, lanes,
    }, { publisher: { host_id: "task-cell-controller", role: "task-cell-controller" }, now: this.now });
    return path.relative(this.cwd, abs);
  }

  outcomes(): LaneOutcome[] {
    return [...this.settled.values()];
  }
}

// ── Start (CD5 / CD20 / CD21) ────────────────────────────────────────────────

function resolveStartBinding(cwd: string, runId: string, given?: DispatchBindingEnvelope): DispatchBindingEnvelope | Refused {
  // The controller holds its own verified binding: an explicit envelope, its
  // spawn env, or the run record. It is never exported to workers, and the env
  // copy is deleted once read.
  const envRef = process.env["GUILD_RUN_BINDING_REF"];
  delete process.env["GUILD_RUN_BINDING_REF"];
  const ref = given?.binding_ref ?? (envRef && envRef.length > 0 ? envRef : loadRunBinding({ root: cwd, run_id: runId })?.binding_ref);
  if (!ref) return refuse("binding_absent");
  const verdict = verifyRunBinding({ root: cwd, run_id: runId, binding_ref: ref });
  if (!verdict.ok) return refuse((verdict as { reason: string }).reason);
  try {
    const mode = fs.statSync(runBindingPath(cwd, runId)).mode & 0o777;
    if (mode !== 0o600) return refuse("binding_mode_not_private");
  } catch {
    return refuse("binding_unverifiable");
  }
  return { binding_ref: ref };
}

/**
 * Source-only composition (CD16): build a controller with an explicit
 * principal. The package facade (startTaskCellController) selects the
 * principal by the run's requested policy only.
 */
export function createTaskCellController(opts: TaskCellControllerOptions): { ok: true; controller: TaskCellController } | Refused {
  const now = opts.now ?? (() => new Date().toISOString());
  // CD20: isolated_worker refuses before ANY read that could write and before any record.
  const selection = opts.principal
    ? (opts.principal.worker_trust_policy === opts.workerTrustPolicy ? { ok: true as const, provider: opts.principal } : selectPrincipalProvider(opts.workerTrustPolicy))
    : selectPrincipalProvider(opts.workerTrustPolicy);
  if (!selection.ok) return refuse(selection.reason);
  const principal = selection.provider;
  const cwd = path.resolve(opts.cwd);
  const plan = readApprovedOraclePlan(cwd, opts.runId, opts.phase);
  if (!("plan" in plan)) return plan;
  const existing = path.resolve(cwd, claimRel(opts.runId));
  if (fs.existsSync(existing)) return refuseExistingClaim(cwd, opts.runId, now());
  // A claim is never released or reused, so refuse before writing one.
  if (!opts.worker) return refuse("worker_transport_unavailable");
  if (!opts.rungPlan) return refuse("rung_plan_required");
  // F2: the oracle plan's refs, lanes and authorities are bound to the approved team.
  const team = verifyTeamAuthority({ cwd, runId: opts.runId, phase: opts.phase, plan: plan.plan, proposal: opts.proposal });
  if (!("membership" in team)) return team;
  const binding = resolveStartBinding(cwd, opts.runId, opts.binding);
  if (!("binding_ref" in binding)) return binding;
  let pkg: PackageIdentityView | null = null;
  if (opts.packageRoot) {
    try {
      pkg = readPackageIdentity(opts.packageRoot);
    } catch (error) {
      return refuse("package_identity_unverified", (error as Error).message);
    }
  }
  // F1 / CD22: an installed package starts only on a satisfied review of its exact source_commit.
  let reviewedBasis: ReviewedBasisPins | null = null;
  if (pkg) {
    if (pkg.source_revision === null) return refuse("source_commit_absent");
    if (!opts.reviewedBasis) return refuse("basis_unreviewed", "no reviewed basis supplied for the installed package");
    const basis = verifySourceBasisReview({ basis: opts.reviewedBasis, expectedCommit: pkg.source_revision, operatorUid: principal.operatorUid() });
    if (!basis.ok) return refuse(basis.reason, basis.detail);
    reviewedBasis = basis.pins;
  }
  const root = readRootIdentity(cwd);
  const pid = process.pid;
  const start = processStartOf(pid);
  if (start === null) return refuse("controller_identity_unavailable");
  const claim: TaskCellControllerClaimV1 = {
    schema_version: TASK_CELL_CONTROLLER_SCHEMA,
    run_id: opts.runId,
    oracle_plan: plan.plan_ref,
    oracle_plan_decision: plan.decision_ref,
    lead_binding_id: plan.plan.lead_binding_id,
    root_id: root.root_id,
    source_id: root.source_id,
    root_fingerprint: root.root_fingerprint,
    source_revision: pkg?.source_revision ?? null,
    controller_instance_id: opts.controllerInstanceId ?? `ctl-${pid}-${sha256(`${opts.runId}:${start}:${now()}`).slice(0, 12)}`,
    pid,
    process_start: start,
    boot_session: bootSession(),
    operator_uid: principal.operatorUid(),
    package_identity: pkg?.package_identity ?? null,
    package_release_version: pkg?.package_release_version ?? null,
    package_current_package: pkg?.package_current_package ?? null,
    package_root: pkg?.package_root ?? null,
    worker_trust_policy: principal.worker_trust_policy,
    provider: principal.id,
    host_profile_id: hostProfileId(principal.id),
    started_at: now(),
    reviewed_basis: reviewedBasis,
  };
  fs.mkdirSync(path.resolve(cwd, controllerRel(opts.runId)), { recursive: true, mode: 0o700 });
  if (!writeExclusive(existing, json(claim))) return refuseExistingClaim(cwd, opts.runId, now());
  try {
    const controller = new TaskCellController({ cwd, claim, binding, plan, principal, membership: team.membership, opts: { ...opts, now } });
    controller.startHeartbeat();
    return { ok: true, controller };
  } catch (error) {
    fs.writeFileSync(path.resolve(cwd, heartbeatRel(opts.runId)), json({ state: "failed_closed", heartbeat_at: now() }), { mode: 0o600 });
    return refuse(error instanceof ControllerRefusal ? error.reason : "controller_construction_failed", (error as Error).message);
  }
}

function refuseExistingClaim(cwd: string, runId: string, nowIso: string): Refused {
  const owner = classifyControllerOwner(cwd, runId, nowIso);
  if (owner.liveness === "dead") {
    return lossRecorded(cwd, runId, readClaim(cwd, runId)) ? refuse("controller_lost") : refuse("controller_loss_unrecorded");
  }
  return refuse("controller_already_claimed", owner.liveness);
}

/**
 * Package facade start (CD14/CD20). Selects the principal by the requested
 * policy only; isolated_worker refuses worker_principal_unavailable and writes
 * nothing. Refusals are returned as `{ ok:false, reason }`.
 */
export function startTaskCellController(opts: Omit<TaskCellControllerOptions, "principal">): { ok: true; controller: TaskCellController } | Refused {
  const { principal: _ignored, ...rest } = opts as TaskCellControllerOptions;
  return createTaskCellController(rest);
}

// Read-only accessors for the CLI and the closed audit (pinned evidence, no writes).
export { readClaim as readControllerClaim, readPre as readAcceptanceEvidencePre };
