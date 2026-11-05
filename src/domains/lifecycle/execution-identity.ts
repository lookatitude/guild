/**
 * src/domains/lifecycle/execution-identity.ts — R01 logical run and execution
 * identity (contract bundle guild.stack.contract_bundle.v2, C12).
 *
 * A logical run (`guild.logical_run.v2`) owns immutable execution segments
 * (`guild.execution_segment.v1`); each segment pins ONE original host and ONE
 * host conversation (`host_session_id`), which is never the Stack management
 * session. Task assignments (`guild.task_assignment.v3`) and attempts (stack
 * `guild.task_attempt.v1`) belong to exactly one run and execution; a goal may
 * collect contributions from many runs.
 *
 * Coexistence with v1: a run with a `guild.run_binding.v1` or v1 session
 * binding stays host-bound. R01 never rewrites it and never grafts v2 records
 * onto it; a v2 run links to it through `parent_run`. Both writer families
 * publish their own marker first and then check for the other's, so of two
 * racing writers at least one backs off; a reader refuses a mixed layout. v1
 * readers refuse reserved identity fields (kernel RESERVED_IDENTITY_FIELDS).
 *
 * The stack `guild.task_attempt.v1` shares its schema_version string with the
 * TaskCell attempt record but not its shape. The two never share a path: stack
 * records live only under `<run>/lineage/`.
 *
 * Validators are hand-written mirrors of the frozen A02 schemas plus the
 * verify_contracts.py semantic rules for these six schemas (schema-specific
 * rules and the shared recursive walk). The vendored A02 fixture subset pins
 * parity; the test also runs a differential against the frozen JSON schemas
 * when the contracts checkout is available.
 *
 * Records are write-once: bytes go to a private temp file, are fsynced, and
 * are published with link(2), which fails if the name exists, so a reader
 * never sees a partial record. An identical replay is a no-op; any other
 * second write refuses. Records carrying a token, key=value secret or home-dir
 * path are refused,
 * never redacted (redaction would change the hashed identity).
 *
 * Activation stays gated: nothing here is wired into a launcher or hook.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { RunKindConflictError, checkContained, claimRunKind, isRefused, prepareContainedWrite, readRunKind } from "../kernel";
import { durableGuildDir } from "../state";
import { readSessionBinding, type SessionBinding } from "../config";
import { redactHomeDirPaths, redactKeyValueSecrets, redactTokenShapes } from "../security";
import { LOGICAL_RUN_MANIFEST_RELPATH, readRunBindingRecord, runBindingPath, type RunBindingRecord } from "./run-binding";

// ── Schema names ─────────────────────────────────────────────────────────────

export const LOGICAL_RUN_SCHEMA = "guild.logical_run.v2" as const;
export const EXECUTION_SEGMENT_SCHEMA = "guild.execution_segment.v1" as const;
export const STACK_TASK_ASSIGNMENT_SCHEMA = "guild.task_assignment.v3" as const;
export const STACK_TASK_ATTEMPT_SCHEMA = "guild.task_attempt.v1" as const;
export const RUN_BINDING_V2_SCHEMA = "guild.run_binding.v2" as const;
export const EXECUTION_LINEAGE_SCHEMA = "guild.stack.execution-lineage.v1" as const;

export type R01SchemaName =
  | "logical-run"
  | "execution-segment"
  | "task-assignment"
  | "task-attempt"
  | "run-binding"
  | "execution-lineage";

// ── Types (frozen A02 shapes) ────────────────────────────────────────────────

export type Hash = string;
export interface Entity { source_id: string; kind: string; id: string; revision: Hash }
export interface Evidence {
  source_id: string; path: string; sha256: Hash; schema_version: string; observed_at: string;
  availability: "available" | "expired" | "redacted" | "missing" | "unsupported"; reason: string | null;
}
export interface Lineage {
  source_id: string; run_id: string; execution_id: string; host_session_id: string | null;
  initiative_id: string | null; goal_id: string | null; logical_task_id: string | null;
  attempt_id: string | null; agent_instance_id: string | null; request_id: string | null;
}
export interface Pins { assignment: Hash; definition: Hash; configuration: Hash; workflow: Hash; policy: Hash }
export interface StateAxes {
  lifecycle: "created" | "active" | "suspended" | "closed" | "unknown";
  outcome: "pending" | "succeeded" | "failed" | "cancelled" | "partial" | "unknown";
  acceptance: "pending" | "verified" | "rejected" | "not_required" | "unknown";
  observability: "complete" | "partial" | "unavailable";
}
export interface Interval {
  start: string; end: string | null; duration_ms: number | null;
  clock: { domain: string; basis: "controller" | "local_monotonic" | "provider" | "unknown"; comparable: boolean; skew_bound_ms: number | null };
}
export interface Authority {
  controller_source_id: string; controller_epoch: number; execution_id: string | null; attempt_id: string | null;
  writer_scope_hash: Hash; source_disposition_revision: Hash | null;
}
export type Admission = "active" | "reconcile_only" | "revoked" | "sealed";

export interface LogicalRunV2 {
  schema_version: typeof LOGICAL_RUN_SCHEMA; source_id: string; run_id: string; initiative_id: string | null;
  parent_run: Entity | null; created_at: string; phase: "init" | "ideate" | "plan" | "build" | "qa" | "ops";
  initial_command: string; initial_prompt_ref: Evidence | null;
  controller: { source_id: string; host_id: string; epoch: number; state: "active" | "suspended"; failover: "manual_new_run_only" };
  workflow_hash: Hash; settings_hash: Hash; execution_refs: Entity[]; goal_refs: Entity[]; state: StateAxes;
}
export interface ExecutionSegmentV1 {
  schema_version: typeof EXECUTION_SEGMENT_SCHEMA; lineage: Lineage; original_host_id: string; host_session_id: string | null;
  issued_controller_epoch: number; adapter_capability_hash: Hash; pins: Pins; admission: Admission; interval: Interval;
  observation_manifest: Hash; seal_evidence: Evidence | null;
}
export interface StackTaskAssignmentV3 {
  schema_version: typeof STACK_TASK_ASSIGNMENT_SCHEMA; lineage: Lineage; original_host_id: string; issued_controller_epoch: number;
  assignment_hash: Hash; pins: Pins; result_scope_hash: Hash; grant_id: string; created_at: string;
  goal_contributions: Entity[]; input_refs: Evidence[];
}
export interface StackTaskAttemptV1 {
  schema_version: typeof STACK_TASK_ATTEMPT_SCHEMA; lineage: Lineage; assignment_ref: Evidence; ordinal: number; state: StateAxes;
  result_refs: Evidence[]; acceptance_subject_hash: Hash | null; accepted_by_controller_epoch: number | null;
  receipt_loss_reconciled: boolean; uncertain_effects: boolean;
}
export interface RunBindingV2 {
  schema_version: typeof RUN_BINDING_V2_SCHEMA; source_id: string; run_id: string; controller_source_id: string;
  controller_host_id: string; controller_epoch: number; writer_grant_id: string; writer_scope_hash: Hash;
  state: "open" | "suspended" | "sealed"; logical_run_manifest_hash: Hash;
}
export interface ExecutionLineageV1 {
  schema_version: typeof EXECUTION_LINEAGE_SCHEMA; lineage: Lineage; run_schema: typeof LOGICAL_RUN_SCHEMA; pins: Pins;
  requested_host: string; observed_host: string | null; requested_model: string | null;
  observed_identity: { provider: string | null; model: string | null; status: "observed" | "unavailable"; reason: string | null };
  adapter_capability_hash: Hash; authority: Authority; attempt_grant_ref: string | null; admission: Admission; state: StateAxes;
  interval: Interval;
  handoffs: Array<{ operation_id: string; from_execution_id: string; to_execution_id: string; accepted_by_controller_epoch: number; evidence: Evidence }>;
  evidence: Evidence[];
}

// ── Refusal ──────────────────────────────────────────────────────────────────

export type ExecutionIdentityRefusalCode =
  | "record_invalid"
  | "record_immutable"
  | "record_contains_secret"
  | "manifest_refs_are_derived"
  | "v1_run_host_bound"
  | "run_layout_mixed"
  | "record_location_mismatch"
  | "logical_run_unknown"
  | "execution_unknown"
  | "host_session_is_stack_session"
  | "original_host_changed"
  | "attempt_unassigned"
  | "attempt_reparent_refused"
  | "attempt_assignment_mismatch";

export class ExecutionIdentityRefusal extends Error {
  constructor(readonly code: ExecutionIdentityRefusalCode, detail: string) {
    super(`execution identity refused (${code}): ${detail}`);
    this.name = "ExecutionIdentityRefusal";
  }
}

// ── Structural validation (mirror of the frozen A02 schemas) ─────────────────

type Check = (v: unknown, at: string, errs: string[]) => void;
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const HASH_RE = /^sha256:[a-f0-9]{64}$/;
// RFC 3339 date-time (format "date-time"); calendar ranges are checked below.
const TIME_RE = /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:[Zz]|[+-](\d{2}):(\d{2}))$/;
const REL_PATH_RE = /^(?!\/)(?!.*(?:^|\/)\.{1,2}(?:\/|$))(?!.*[\\%\x00-\x1f])[^:]+$/u;
const KINDS = new Set(["initiative", "run", "execution", "host_session", "goal", "logical_task", "task_attempt", "agent_instance", "request", "operation", "decision", "workflow", "component", "invocation", "obligation", "memory", "knowledge", "candidate", "agent", "skill", "tool", "team", "loop", "config", "evaluation", "report", "benchmark_case", "transfer", "query"]);

const own = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);
const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const fail = (errs: string[], at: string, msg: string) => { errs.push(`${at}: ${msg}`); };
/** JSON Schema string lengths count Unicode code points, not UTF-16 units. */
const cpLength = (s: string) => [...s].length;

function isRfc3339(v: string): boolean {
  const m = TIME_RE.exec(v);
  if (!m) return false;
  const [y, mo, d, h, mi, s] = m.slice(1, 7).map(Number) as [number, number, number, number, number, number];
  const daysIn = [31, (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (mo < 1 || mo > 12 || d < 1 || d > daysIn[mo - 1]! || h > 23 || mi > 59 || s > 59) return false;
  if (m[7] !== undefined && (Number(m[7]) > 23 || Number(m[8]) > 59)) return false;
  return true;
}

/**
 * Order two validated RFC 3339 instants at microsecond precision, as the frozen
 * verifier's datetime comparison does (Date.parse alone truncates to ms).
 */
export function compareInstants(a: string, b: string): number {
  const micros = (t: string): bigint => {
    const m = TIME_RE.exec(t)!;
    const frac = /\.(\d+)/.exec(t.slice(19, t.length))?.[1] ?? "";
    const whole = BigInt(Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${t.slice(19).replace(/^\.\d+/, "")}`));
    return whole * 1000n + BigInt((frac + "000000").slice(0, 6));
  };
  const d = micros(a) - micros(b);
  return d < 0n ? -1 : d > 0n ? 1 : 0;
}

const id: Check = (v, at, e) => { if (typeof v !== "string" || !ID_RE.test(v)) fail(e, at, "not an id"); };
const hash: Check = (v, at, e) => { if (typeof v !== "string" || !HASH_RE.test(v)) fail(e, at, "not a sha256 hash"); };
const time: Check = (v, at, e) => { if (typeof v !== "string" || !isRfc3339(v)) fail(e, at, "not a date-time"); };
const str: Check = (v, at, e) => {
  if (typeof v !== "string" || cpLength(v) < 1 || cpLength(v) > 4096) fail(e, at, "not a bounded string");
};
const int0: Check = (v, at, e) => { if (typeof v !== "number" || !Number.isInteger(v) || v < 0) fail(e, at, "not a non-negative integer"); };
const int1: Check = (v, at, e) => { if (typeof v !== "number" || !Number.isInteger(v) || v < 1) fail(e, at, "not a positive integer"); };
const num0: Check = (v, at, e) => { if (typeof v !== "number" || !Number.isFinite(v) || v < 0) fail(e, at, "not a non-negative number"); };
const bool: Check = (v, at, e) => { if (typeof v !== "boolean") fail(e, at, "not a boolean"); };
const konst = (c: string): Check => (v, at, e) => { if (v !== c) fail(e, at, `must equal ${c}`); };
const oneOf = (...vals: string[]): Check => (v, at, e) => { if (typeof v !== "string" || !vals.includes(v)) fail(e, at, `not one of ${vals.join("|")}`); };
const nullable = (c: Check): Check => (v, at, e) => { if (v !== null) c(v, at, e); };
const relPath: Check = (v, at, e) => {
  if (typeof v !== "string" || cpLength(v) < 1 || cpLength(v) > 1024 || !REL_PATH_RE.test(v)) fail(e, at, "not a contained relative path");
};
const array = (item: Check, max: number): Check => (v, at, e) => {
  if (!Array.isArray(v)) return fail(e, at, "not an array");
  if (v.length > max) fail(e, at, `more than ${max} items`);
  // Index loop, not forEach: a sparse hole is checked (as undefined) and refused.
  for (let i = 0; i < v.length; i++) item(v[i], `${at}[${i}]`, e);
};
const object = (shape: Record<string, Check>): Check => (v, at, e) => {
  if (!isObj(v)) return fail(e, at, "not an object");
  for (const k of Object.keys(v)) if (!own(shape, k)) fail(e, `${at}.${k}`, "unknown field");
  for (const k of Object.keys(shape)) {
    if (!own(v, k)) fail(e, `${at}.${k}`, "required");
    else shape[k]!(v[k], `${at}.${k}`, e);
  }
};

const entity = object({ source_id: id, kind: (v, at, e) => { if (typeof v !== "string" || !KINDS.has(v)) fail(e, at, "unknown kind"); }, id, revision: hash });
const evidence = object({
  source_id: id, path: relPath, sha256: hash, schema_version: str, observed_at: time,
  availability: oneOf("available", "expired", "redacted", "missing", "unsupported"), reason: nullable(str),
});
const lineage = object({
  source_id: id, run_id: id, execution_id: id, host_session_id: nullable(id), initiative_id: nullable(id), goal_id: nullable(id),
  logical_task_id: nullable(id), attempt_id: nullable(id), agent_instance_id: nullable(id), request_id: nullable(id),
});
const pins = object({ assignment: hash, definition: hash, configuration: hash, workflow: hash, policy: hash });
const stateAxes = object({
  lifecycle: oneOf("created", "active", "suspended", "closed", "unknown"),
  outcome: oneOf("pending", "succeeded", "failed", "cancelled", "partial", "unknown"),
  acceptance: oneOf("pending", "verified", "rejected", "not_required", "unknown"),
  observability: oneOf("complete", "partial", "unavailable"),
});
const interval = object({
  start: time, end: nullable(time), duration_ms: nullable(num0),
  clock: object({ domain: id, basis: oneOf("controller", "local_monotonic", "provider", "unknown"), comparable: bool, skew_bound_ms: nullable(num0) }),
});
const authority = object({
  controller_source_id: id, controller_epoch: int0, execution_id: nullable(id), attempt_id: nullable(id),
  writer_scope_hash: hash, source_disposition_revision: nullable(hash),
});
const admission = oneOf("active", "reconcile_only", "revoked", "sealed");

const SHAPES: Record<R01SchemaName, Check> = {
  "logical-run": object({
    schema_version: konst(LOGICAL_RUN_SCHEMA), source_id: id, run_id: id, initiative_id: nullable(id), parent_run: nullable(entity),
    created_at: time, phase: oneOf("init", "ideate", "plan", "build", "qa", "ops"), initial_command: str,
    initial_prompt_ref: nullable(evidence),
    controller: object({ source_id: id, host_id: id, epoch: int0, state: oneOf("active", "suspended"), failover: konst("manual_new_run_only") }),
    workflow_hash: hash, settings_hash: hash, execution_refs: array(entity, 1000), goal_refs: array(entity, 1000), state: stateAxes,
  }),
  "execution-segment": object({
    schema_version: konst(EXECUTION_SEGMENT_SCHEMA), lineage, original_host_id: id, host_session_id: nullable(id),
    issued_controller_epoch: int0, adapter_capability_hash: hash, pins, admission, interval, observation_manifest: hash,
    seal_evidence: nullable(evidence),
  }),
  "task-assignment": object({
    schema_version: konst(STACK_TASK_ASSIGNMENT_SCHEMA), lineage, original_host_id: id, issued_controller_epoch: int0,
    assignment_hash: hash, pins, result_scope_hash: hash, grant_id: id, created_at: time,
    goal_contributions: array(entity, 100), input_refs: array(evidence, 100),
  }),
  "task-attempt": object({
    schema_version: konst(STACK_TASK_ATTEMPT_SCHEMA), lineage, assignment_ref: evidence, ordinal: int1, state: stateAxes,
    result_refs: array(evidence, 100), acceptance_subject_hash: nullable(hash), accepted_by_controller_epoch: nullable(int0),
    receipt_loss_reconciled: bool, uncertain_effects: bool,
  }),
  "run-binding": object({
    schema_version: konst(RUN_BINDING_V2_SCHEMA), source_id: id, run_id: id, controller_source_id: id, controller_host_id: id,
    controller_epoch: int0, writer_grant_id: id, writer_scope_hash: hash, state: oneOf("open", "suspended", "sealed"),
    logical_run_manifest_hash: hash,
  }),
  "execution-lineage": object({
    schema_version: konst(EXECUTION_LINEAGE_SCHEMA), lineage, run_schema: konst(LOGICAL_RUN_SCHEMA), pins, requested_host: id,
    observed_host: nullable(id), requested_model: nullable(str),
    observed_identity: object({ provider: nullable(str), model: nullable(str), status: oneOf("observed", "unavailable"), reason: nullable(str) }),
    adapter_capability_hash: hash, authority, attempt_grant_ref: nullable(id), admission, state: stateAxes, interval,
    handoffs: array(object({ operation_id: id, from_execution_id: id, to_execution_id: id, accepted_by_controller_epoch: int0, evidence }), 100),
    evidence: array(evidence, 100),
  }),
};

// ── Semantic rules (verify_contracts.py, R01 subset) ─────────────────────────

const hasKeys = (o: Record<string, unknown>, keys: string[]) => keys.every((k) => own(o, k));

/** verify_contracts.py `walk`: rules keyed on object shape, applied at every depth. */
function walkRules(value: unknown, require: (ok: boolean, msg: string) => void, level = 0): void {
  if (level > 32) return require(false, "object depth exceeds validation budget");
  if (Array.isArray(value)) { for (const x of value) walkRules(x, require, level + 1); return; }
  if (!isObj(value)) return;
  const o = value;
  if (hasKeys(o, ["lifecycle", "outcome", "acceptance", "observability"])) {
    if (o["outcome"] === "succeeded") require(o["acceptance"] === "verified", "success requires verified acceptance");
    if (o["lifecycle"] === "closed") require(o["outcome"] !== "pending" && o["outcome"] !== "unknown", "closed cannot have pending/unknown outcome");
  }
  if (hasKeys(o, ["start", "end", "duration_ms", "clock"])) {
    require(o["end"] === null || compareInstants(o["end"] as string, o["start"] as string) >= 0, "interval cannot end before start");
    require(o["duration_ms"] === null || (o["clock"] as Record<string, unknown>)["basis"] !== "unknown", "unknown clock cannot claim duration");
  }
  if (hasKeys(o, ["source_id", "run_id", "execution_id", "host_session_id", "attempt_id", "logical_task_id", "request_id"])) {
    require(o["attempt_id"] === null || o["logical_task_id"] !== null, "attempt requires logical task");
  }
  if (hasKeys(o, ["provider", "model", "status", "reason"])) {
    if (o["status"] === "observed") require(o["model"] !== null, "observed identity needs observed model");
    if (o["status"] === "unavailable") require(o["model"] === null && Boolean(o["reason"]), "unavailable observed identity needs null model and reason");
  }
  for (const x of Object.values(o)) walkRules(x, require, level + 1);
}

function semanticErrors(schema: R01SchemaName, v: any): string[] {
  const errs: string[] = [];
  const require = (ok: boolean, msg: string) => { if (!ok) errs.push(msg); };
  walkRules(v, require);
  if (schema === "logical-run") {
    require(v.controller.source_id === v.source_id, "logical run fixed-controller owner mismatch");
    require(v.execution_refs.every((x: Entity) => x.source_id === v.source_id && x.kind === "execution"), "foreign execution reference");
    require(v.initial_prompt_ref === null || v.initial_prompt_ref.source_id === v.source_id, "initial prompt evidence owner mismatch");
  } else if (schema === "run-binding") {
    require(v.controller_source_id === v.source_id, "binding controller moved to another source");
  } else {
    const l: Lineage = v.lineage;
    if (own(v, "authority")) {
      require(v.authority.controller_source_id === l.source_id && v.authority.execution_id === l.execution_id && v.authority.attempt_id === l.attempt_id, "lineage/authority mismatch");
    }
    if (schema === "task-assignment" || schema === "task-attempt") {
      require(l.attempt_id !== null && l.logical_task_id !== null, "assignment/attempt missing immutable identity");
    }
    const owned: Array<Evidence | null> =
      schema === "execution-lineage" ? [...v.evidence, ...v.handoffs.map((h: { evidence: Evidence }) => h.evidence)]
        : schema === "execution-segment" ? [v.seal_evidence]
          : schema === "task-attempt" ? [v.assignment_ref, ...v.result_refs]
            : [];
    require(owned.every((e) => e === null || e.source_id === l.source_id), "lineage-owned evidence recorded by another source");
    if (schema === "task-attempt" && v.state.outcome === "succeeded") {
      require(v.receipt_loss_reconciled && !v.uncertain_effects && v.accepted_by_controller_epoch !== null && v.acceptance_subject_hash !== null, "uncertain/unreconciled task cannot succeed");
    }
  }
  return errs;
}

export type ValidationVerdict = { ok: true } | { ok: false; errors: string[] };

/** Structural check only: the frozen JSON schema, nothing else. */
export function validateExecutionIdentityShape(schema: R01SchemaName, value: unknown): ValidationVerdict {
  const errs: string[] = [];
  SHAPES[schema](value, "$", errs);
  return errs.length === 0 ? { ok: true } : { ok: false, errors: errs };
}

/** Strict validation: structural errors first; semantic rules only on a well-formed record. */
export function validateExecutionIdentityRecord(schema: R01SchemaName, value: unknown): ValidationVerdict {
  const shape = validateExecutionIdentityShape(schema, value);
  if (!shape.ok) return shape;
  const errs = semanticErrors(schema, value);
  return errs.length === 0 ? { ok: true } : { ok: false, errors: errs };
}

/**
 * One JSON snapshot of a caller record. Every check and the publication itself
 * use this snapshot, so a toJSON hook, getter or sparse array cannot make the
 * persisted bytes differ from what was validated.
 */
function snapshot<T>(schema: R01SchemaName, value: T): T {
  let doc: unknown;
  try { doc = JSON.parse(JSON.stringify(value) ?? "null"); } catch { throw new ExecutionIdentityRefusal("record_invalid", `${schema}: not serializable`); }
  assertValid(schema, doc);
  assertNoSecrets(doc);
  return doc as T;
}

function assertValid(schema: R01SchemaName, value: unknown): void {
  const verdict = validateExecutionIdentityRecord(schema, value);
  if (!verdict.ok) throw new ExecutionIdentityRefusal("record_invalid", `${schema}: ${verdict.errors.join("; ")}`);
}

/** Refuse (never redact) a record holding a secret-shaped string; the message names only the JSON path. */
function assertNoSecrets(value: unknown, at = "$"): void {
  if (typeof value === "string") {
    // Token shapes, key=value secrets and home-dir paths. The high-entropy
    // group is skipped: digests and long run/path ids trip it by construction.
    if (redactHomeDirPaths(redactKeyValueSecrets(redactTokenShapes(value))) !== value) {
      throw new ExecutionIdentityRefusal("record_contains_secret", `${at} matches the secrets policy`);
    }
  } else if (Array.isArray(value)) {
    value.forEach((x, i) => assertNoSecrets(x, `${at}[${i}]`));
  } else if (isObj(value)) {
    for (const [k, x] of Object.entries(value)) assertNoSecrets(x, `${at}.${k}`);
  }
}

// ── Storage ──────────────────────────────────────────────────────────────────

const RUN_ID_RE = /^run-[A-Za-z0-9][A-Za-z0-9._-]{0,191}$/;
const LINEAGE_DIR = "lineage";
const ATTEMPT_INDEX = path.join("runs", "_lineage-index", "attempts");

function runDir(root: string, runId: string): string {
  if (!RUN_ID_RE.test(runId)) throw new ExecutionIdentityRefusal("record_invalid", `run id ${JSON.stringify(runId)} is not a run directory name`);
  return path.join(durableGuildDir(root), "runs", runId);
}
const logicalRunPath = (root: string, runId: string) => path.join(runDir(root, runId), LOGICAL_RUN_MANIFEST_RELPATH);
const executionPath = (root: string, runId: string, executionId: string) => path.join(runDir(root, runId), LINEAGE_DIR, "executions", `${executionId}.json`);
const assignmentPath = (root: string, runId: string, attemptId: string) => path.join(runDir(root, runId), LINEAGE_DIR, "assignments", `${attemptId}.json`);
const attemptPath = (root: string, runId: string, attemptId: string) => path.join(runDir(root, runId), LINEAGE_DIR, "attempts", `${attemptId}.json`);
const attemptOwnerPath = (root: string, attemptId: string) => path.join(durableGuildDir(root), ATTEMPT_INDEX, `${attemptId}.json`);

/** Evidence path of an assignment record, relative to the `.guild` source root. */
export function assignmentEvidencePath(runId: string, attemptId: string): string {
  return ["runs", runId, LINEAGE_DIR, "assignments", `${attemptId}.json`].join("/");
}

const serialize = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
export const recordRevision = (bytes: string) => `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;

function readContained(root: string, abs: string): string | null {
  if (!fs.existsSync(abs)) return null;
  return readNoFollow(root, abs);
}

function fsyncDir(dir: string): void {
  let fd: number | null = null;
  try {
    fd = fs.openSync(dir, "r");
    fs.fsyncSync(fd);
  } catch {
    // Directory fsync is unsupported on some platforms; the file itself is already durable.
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }
}

function realDirIdentity(dir: string): string {
  const st = fs.statSync(dir);
  return `${fs.realpathSync(dir)}\u0000${st.dev}:${st.ino}`;
}

/** Read a contained regular file without following a final symlink. */
function readNoFollow(root: string, abs: string): string {
  const rel = path.relative(root, abs);
  const checked = checkContained(root, rel, { policy: "physical", requireRegularFileLeaf: true });
  if (isRefused(checked)) throw new ExecutionIdentityRefusal("record_invalid", `lineage read refused (${checked.code}): ${rel}`);
  const fd = fs.openSync(checked.realPath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    // O_NOFOLLOW guards only the last component: re-prove containment after the
    // open and require the opened inode to be the one the contained path names.
    const opened = fs.fstatSync(fd);
    const again = checkContained(root, rel, { policy: "physical", requireRegularFileLeaf: true });
    if (isRefused(again) || again.realPath !== checked.realPath) throw new ExecutionIdentityRefusal("record_invalid", `lineage read refused: ${rel} moved during read`);
    const named = fs.lstatSync(again.realPath);
    if (named.dev !== opened.dev || named.ino !== opened.ino) throw new ExecutionIdentityRefusal("record_invalid", `lineage read refused: ${rel} moved during read`);
    return fs.readFileSync(fd, "utf8");
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Write-once publication. Returns true when this call created the record.
 * Identical bytes already present → false; different bytes → record_immutable.
 * The full buffer is written and fsynced to a private temp file, then linked
 * into place; the parent directory's identity and the final path's containment
 * are re-checked after the link, so a swapped ancestor is refused.
 */
function publishOnce(root: string, abs: string, value: unknown): boolean {
  const bytes = Buffer.from(serialize(value), "utf8");
  const rel = path.relative(root, abs);
  const prepared = prepareContainedWrite(root, rel, { policy: "physical", requireRegularFileLeaf: true });
  if (isRefused(prepared)) throw new ExecutionIdentityRefusal("record_invalid", `lineage write refused (${prepared.code}): ${rel}`);
  const final = prepared.realPath;
  const dir = path.dirname(final);
  const dirIdentity = realDirIdentity(dir);
  const tmp = path.join(dir, `.${path.basename(final)}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`);
  let created = false;
  try {
    const fd = fs.openSync(tmp, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o644);
    try {
      let off = 0;
      while (off < bytes.length) {
        const n = fs.writeSync(fd, bytes, off, bytes.length - off);
        if (n <= 0) throw new ExecutionIdentityRefusal("record_invalid", `${rel}: short write`);
        off += n;
      }
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    if (realDirIdentity(dir) !== dirIdentity) throw new ExecutionIdentityRefusal("record_invalid", `${rel}: parent directory changed during publication`);
    try {
      fs.linkSync(tmp, final);
      created = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  } finally {
    fs.rmSync(tmp, { force: true });
  }
  fsyncDir(dir);
  const after = checkContained(root, rel, { policy: "physical", requireRegularFileLeaf: true });
  if (isRefused(after) || after.realPath !== final || realDirIdentity(dir) !== dirIdentity) {
    // Node has no linkat/openat: an ancestor swapped between the last check and
    // link(2) can redirect the link. Withdraw what this call published there.
    if (created) fs.rmSync(final, { force: true });
    throw new ExecutionIdentityRefusal("record_invalid", `${rel}: containment changed during publication`);
  }
  if (!created && readNoFollow(root, abs) !== bytes.toString("utf8")) {
    throw new ExecutionIdentityRefusal("record_immutable", `${rel} already holds a different record`);
  }
  return created;
}

function readJson<T>(root: string, abs: string, schema: R01SchemaName | null): T | null {
  const raw = readContained(root, abs);
  if (raw === null) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new ExecutionIdentityRefusal("record_invalid", `${path.relative(root, abs)} is not JSON`); }
  if (schema !== null) assertValid(schema, parsed);
  return parsed as T;
}

function hasV1Files(root: string, runId: string): boolean {
  return fs.existsSync(runBindingPath(root, runId)) || fs.existsSync(path.join(runDir(root, runId), "session-binding.json"))
    || readRunKind(runDir(root, runId)) === "v1";
}

/** A v2 run claims kind v2 and holds no v1 file; anything else is mixed. */
function assertV2Layout(root: string, runId: string): void {
  if (hasV1Files(root, runId) || readRunKind(runDir(root, runId)) !== "v2") {
    throw new ExecutionIdentityRefusal("run_layout_mixed", `${runId} is not a clean v2 logical run`);
  }
}

/** A run with a v1 binding or v1 session binding is host-bound; R01 never touches it. */
function assertNotV1Run(root: string, runId: string): void {
  if (hasV1Files(root, runId)) {
    throw new ExecutionIdentityRefusal("v1_run_host_bound", `${runId} is a v1 host-bound run; start a linked logical run instead`);
  }
}

function requireLogicalRun(root: string, runId: string): { manifest: LogicalRunV2; revision: Hash } {
  const raw = readContained(root, logicalRunPath(root, runId));
  if (raw === null) throw new ExecutionIdentityRefusal("logical_run_unknown", `${runId} has no logical-run manifest`);
  assertV2Layout(root, runId);
  const manifest = readJson<LogicalRunV2>(root, logicalRunPath(root, runId), "logical-run")!;
  if (manifest.run_id !== runId) throw new ExecutionIdentityRefusal("record_location_mismatch", `manifest under ${runId} names ${manifest.run_id}`);
  return { manifest, revision: recordRevision(raw) };
}

function requireSegment(root: string, l: Lineage): ExecutionSegmentV1 {
  const { manifest } = requireLogicalRun(root, l.run_id);
  if (manifest.source_id !== l.source_id) throw new ExecutionIdentityRefusal("record_invalid", `lineage source ${l.source_id} is not the run owner ${manifest.source_id}`);
  const seg = readJson<ExecutionSegmentV1>(root, executionPath(root, l.run_id, l.execution_id), "execution-segment");
  if (seg === null) throw new ExecutionIdentityRefusal("execution_unknown", `${l.run_id} has no execution ${l.execution_id}`);
  assertSegmentAt(seg, manifest.source_id, l.run_id, l.execution_id);
  return seg;
}

/** A persisted record must name the identity its path names. */
function assertSegmentAt(seg: ExecutionSegmentV1, sourceId: string, runId: string, executionId: string): void {
  const sl = seg.lineage;
  if (sl.source_id !== sourceId || sl.run_id !== runId || sl.execution_id !== executionId || seg.host_session_id !== sl.host_session_id) {
    throw new ExecutionIdentityRefusal("record_location_mismatch", `execution file ${runId}/${executionId} holds ${sl.run_id}/${sl.execution_id}`);
  }
}
function assertAttemptRecordAt(l: Lineage, sourceId: string, runId: string, attemptId: string, what: string): void {
  if (l.source_id !== sourceId || l.run_id !== runId || l.attempt_id !== attemptId) {
    throw new ExecutionIdentityRefusal("record_location_mismatch", `${what} file ${runId}/${attemptId} holds ${l.run_id}/${l.attempt_id}`);
  }
}

/** Create the immutable logical-run manifest. execution_refs/goal_refs are derived, so they start empty. */
export function createLogicalRun(root: string, input: LogicalRunV2): void {
  const manifest = snapshot("logical-run", input);
  if (manifest.execution_refs.length > 0 || manifest.goal_refs.length > 0) {
    throw new ExecutionIdentityRefusal("manifest_refs_are_derived", "execution_refs and goal_refs derive from recorded segments and assignments");
  }
  // A run created before the run-kind marker existed is v1 by its files.
  assertNotV1Run(root, manifest.run_id);
  // One exclusion for both writer families: mintRunBinding and bindSession
  // claim "v1" the same way, so a racing v1 writer fails here or there.
  try {
    claimRunKind(runDir(root, manifest.run_id), "v2");
  } catch (error) {
    if (error instanceof RunKindConflictError) throw new ExecutionIdentityRefusal("v1_run_host_bound", error.message);
    throw error;
  }
  publishOnce(root, logicalRunPath(root, manifest.run_id), manifest);
}

export interface RecordSegmentOptions {
  /** The Stack management (scope) session id; a host conversation may never reuse it. */
  stack_session_id: string;
}

/** Record one immutable execution segment under its logical run. */
export function recordExecutionSegment(root: string, input: ExecutionSegmentV1, opts: RecordSegmentOptions): void {
  const segment = snapshot("execution-segment", input);
  const l = segment.lineage;
  assertNotV1Run(root, l.run_id);
  const { manifest } = requireLogicalRun(root, l.run_id);
  if (manifest.source_id !== l.source_id) throw new ExecutionIdentityRefusal("record_invalid", `segment source ${l.source_id} is not the run owner ${manifest.source_id}`);
  if (segment.host_session_id !== l.host_session_id) {
    throw new ExecutionIdentityRefusal("record_invalid", "segment host_session_id differs from its lineage host_session_id");
  }
  if (segment.host_session_id !== null && segment.host_session_id === opts.stack_session_id) {
    throw new ExecutionIdentityRefusal("host_session_is_stack_session", `host session ${segment.host_session_id} reuses the Stack session id`);
  }
  if (l.logical_task_id !== null || l.attempt_id !== null) {
    throw new ExecutionIdentityRefusal("record_invalid", "an execution segment names no task or attempt; attempts belong to assignments");
  }
  publishOnce(root, executionPath(root, l.run_id, l.execution_id), segment);
}

interface AttemptOwner { source_id: string; run_id: string; execution_id: string; logical_task_id: string }

function ownerOf(l: Lineage): AttemptOwner {
  return { source_id: l.source_id, run_id: l.run_id, execution_id: l.execution_id, logical_task_id: l.logical_task_id! };
}

/** Reserve the attempt id for one run/execution/task. A reservation alone authorizes nothing. */
function claimAttemptOwner(root: string, attemptId: string, owner: AttemptOwner): void {
  try {
    publishOnce(root, attemptOwnerPath(root, attemptId), owner);
  } catch (error) {
    if (error instanceof ExecutionIdentityRefusal && error.code === "record_immutable") {
      const prior = readJson<AttemptOwner>(root, attemptOwnerPath(root, attemptId), null);
      throw new ExecutionIdentityRefusal("attempt_reparent_refused", `${attemptId} belongs to ${prior?.run_id}/${prior?.execution_id}/${prior?.logical_task_id}`);
    }
    throw error;
  }
}

/** Lineage equality between an attempt (or receipt) and its assignment; request_id is per request. */
function sameAttemptLineage(a: Lineage, b: Lineage): boolean {
  const keys: Array<keyof Lineage> = ["source_id", "run_id", "execution_id", "host_session_id", "initiative_id", "goal_id", "logical_task_id", "attempt_id", "agent_instance_id"];
  return keys.every((k) => a[k] === b[k]);
}

/**
 * Load the persisted assignment that owns an attempt. An owner reservation with
 * no assignment (an interrupted recordTaskAssignment) is `attempt_unassigned`.
 */
function requireAssignment(root: string, l: Lineage): { assignment: StackTaskAssignmentV3; revision: Hash } {
  const owner = readJson<AttemptOwner>(root, attemptOwnerPath(root, l.attempt_id!), null);
  if (owner === null) throw new ExecutionIdentityRefusal("attempt_unassigned", `${l.attempt_id} has no assignment`);
  if (l.logical_task_id === null || serialize(owner) !== serialize(ownerOf(l))) {
    throw new ExecutionIdentityRefusal("attempt_reparent_refused", `${l.attempt_id} belongs to ${owner.run_id}/${owner.execution_id}/${owner.logical_task_id}`);
  }
  const abs = assignmentPath(root, l.run_id, l.attempt_id!);
  const raw = readContained(root, abs);
  if (raw === null) throw new ExecutionIdentityRefusal("attempt_unassigned", `${l.attempt_id} is reserved but its assignment was never published`);
  const assignment = readJson<StackTaskAssignmentV3>(root, abs, "task-assignment")!;
  assertAttemptRecordAt(assignment.lineage, l.source_id, l.run_id, l.attempt_id!, "assignment");
  if (!sameAttemptLineage(assignment.lineage, l)) {
    throw new ExecutionIdentityRefusal("attempt_assignment_mismatch", `${l.attempt_id} lineage differs from its assignment`);
  }
  return { assignment, revision: recordRevision(raw) };
}

/** Record an immutable task assignment; claims the attempt for exactly one run/execution/task. */
export function recordTaskAssignment(root: string, input: StackTaskAssignmentV3): void {
  const assignment = snapshot("task-assignment", input);
  const l = assignment.lineage;
  assertNotV1Run(root, l.run_id);
  const seg = requireSegment(root, l);
  if (assignment.original_host_id !== seg.original_host_id) {
    throw new ExecutionIdentityRefusal("original_host_changed", `${l.execution_id} runs on ${seg.original_host_id}, not ${assignment.original_host_id}`);
  }
  if (l.host_session_id !== seg.host_session_id) {
    throw new ExecutionIdentityRefusal("record_invalid", `assignment host session differs from execution ${l.execution_id}`);
  }
  claimAttemptOwner(root, l.attempt_id!, ownerOf(l));
  publishOnce(root, assignmentPath(root, l.run_id, l.attempt_id!), assignment);
}

/** Record an immutable task attempt; it must reference, byte for byte, the assignment that owns it. */
export function recordTaskAttempt(root: string, input: StackTaskAttemptV1): void {
  const attempt = snapshot("task-attempt", input);
  assertNotV1Run(root, attempt.lineage.run_id);
  assertAttemptOwned(root, attempt);
  publishOnce(root, attemptPath(root, attempt.lineage.run_id, attempt.lineage.attempt_id!), attempt);
}

/** An attempt must match, byte for byte, the persisted assignment that owns its id, on a recorded execution. */
function assertAttemptOwned(root: string, attempt: StackTaskAttemptV1): void {
  const l = attempt.lineage;
  const { revision } = requireAssignment(root, l);
  const ref = attempt.assignment_ref;
  if (ref.source_id !== l.source_id || ref.path !== assignmentEvidencePath(l.run_id, l.attempt_id!) || ref.sha256 !== revision
    || ref.schema_version !== STACK_TASK_ASSIGNMENT_SCHEMA || ref.availability !== "available") {
    throw new ExecutionIdentityRefusal("attempt_assignment_mismatch", `${l.attempt_id} assignment_ref does not name its persisted assignment`);
  }
  requireSegment(root, l);
}

/** A persisted assignment must hold its attempt's owner reservation, on a recorded execution with the same host. */
function assertAssignmentOwned(root: string, a: StackTaskAssignmentV3): void {
  const l = a.lineage;
  const owner = readJson<AttemptOwner>(root, attemptOwnerPath(root, l.attempt_id!), null);
  if (owner === null || serialize(owner) !== serialize(ownerOf(l))) {
    throw new ExecutionIdentityRefusal("attempt_reparent_refused", `${l.attempt_id} assignment does not hold its owner reservation`);
  }
  const seg = requireSegment(root, l);
  if (seg.original_host_id !== a.original_host_id || seg.host_session_id !== l.host_session_id) {
    throw new ExecutionIdentityRefusal("original_host_changed", `${l.attempt_id} assignment disagrees with execution ${l.execution_id}`);
  }
}

// ── Read projection ──────────────────────────────────────────────────────────

export type LogicalRunView =
  | { kind: "absent"; run_id: string }
  | { kind: "v1"; run_id: string; binding: RunBindingRecord; session: SessionBinding | null }
  | {
    kind: "v2"; run_id: string; manifest: LogicalRunV2; manifest_revision: Hash;
    executions: Array<{ segment: ExecutionSegmentV1; revision: Hash }>;
    execution_refs: Entity[]; assignments: StackTaskAssignmentV3[]; attempts: StackTaskAttemptV1[]; goal_refs: Entity[];
  };

function listJson(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith(".json") && !f.startsWith(".")).sort();
}

/** Read a run as v1 (frozen readers, untouched) or v2 (manifest + derived refs). A mixed layout refuses. */
export function readLogicalRunView(root: string, runId: string): LogicalRunView {
  const dir = runDir(root, runId);
  const hasManifest = fs.existsSync(logicalRunPath(root, runId));
  const kind = readRunKind(dir);
  if (kind === "unreadable" || (hasManifest && hasV1Files(root, runId)) || (kind === "v2" && hasV1Files(root, runId))) {
    throw new ExecutionIdentityRefusal("run_layout_mixed", `${runId} holds both v1 binding files and a v2 logical-run manifest`);
  }
  const v1 = readRunBindingRecord({ root, run_id: runId });
  if (v1.status === "ok") return { kind: "v1", run_id: runId, binding: v1.record, session: readSessionBinding(dir) };
  if (v1.status === "malformed") throw new ExecutionIdentityRefusal("record_invalid", `${runId} has a malformed v1 binding`);
  if (!hasManifest) return { kind: "absent", run_id: runId };
  const { manifest, revision: manifest_revision } = requireLogicalRun(root, runId);
  const lineageDir = path.join(dir, LINEAGE_DIR);
  const executions = listJson(path.join(lineageDir, "executions")).map((f) => {
    const abs = path.join(lineageDir, "executions", f);
    const segment = readJson<ExecutionSegmentV1>(root, abs, "execution-segment")!;
    assertSegmentAt(segment, manifest.source_id, runId, f.slice(0, -".json".length));
    return { segment, revision: recordRevision(readContained(root, abs)!) };
  });
  const assignments = listJson(path.join(lineageDir, "assignments")).map((f) => {
    const a = readJson<StackTaskAssignmentV3>(root, path.join(lineageDir, "assignments", f), "task-assignment")!;
    assertAttemptRecordAt(a.lineage, manifest.source_id, runId, f.slice(0, -".json".length), "assignment");
    assertAssignmentOwned(root, a);
    return a;
  });
  const attempts = listJson(path.join(lineageDir, "attempts")).map((f) => {
    const t = readJson<StackTaskAttemptV1>(root, path.join(lineageDir, "attempts", f), "task-attempt")!;
    assertAttemptRecordAt(t.lineage, manifest.source_id, runId, f.slice(0, -".json".length), "attempt");
    assertAttemptOwned(root, t);
    return t;
  });
  const goals = new Map<string, Entity>();
  for (const a of assignments) for (const g of a.goal_contributions) goals.set(`${g.source_id}\u0000${g.id}`, g);
  return {
    kind: "v2", run_id: runId, manifest, manifest_revision, executions,
    execution_refs: executions.map((e) => ({ source_id: e.segment.lineage.source_id, kind: "execution", id: e.segment.lineage.execution_id, revision: e.revision })),
    assignments, attempts,
    goal_refs: [...goals.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
  };
}

// ── Segment seal ─────────────────────────────────────────────────────────────

export const EXECUTION_SEGMENT_SEAL_SCHEMA = "guild.stack.execution_segment_seal.v1" as const;
/** Host exit seals one segment; the logical run stays open. Immutable: a segment seals once. */
export interface ExecutionSegmentSeal {
  schema_version: typeof EXECUTION_SEGMENT_SEAL_SCHEMA; source_id: string; run_id: string; execution_id: string;
  segment_revision: Hash; sealed_by: { operation_id: string; attempt_id: string; launch_hash: Hash };
  outcome_state: "exited" | "cancelled" | "timed_out"; outcome_sha256: Hash; sealed_at: string;
}
const sealPath = (root: string, runId: string, executionId: string) => {
  if (!ID_RE.test(executionId)) throw new ExecutionIdentityRefusal("record_invalid", "execution id is not an id");
  return path.join(runDir(root, runId), LINEAGE_DIR, "seals", `${executionId}.json`);
};
function assertSealShape(v: unknown): asserts v is ExecutionSegmentSeal {
  const keys = ["schema_version", "source_id", "run_id", "execution_id", "segment_revision", "sealed_by", "outcome_state", "outcome_sha256", "sealed_at"];
  const ok = isObj(v) && Object.keys(v).length === keys.length && keys.every((k) => own(v, k))
    && v["schema_version"] === EXECUTION_SEGMENT_SEAL_SCHEMA
    && [v["source_id"], v["execution_id"]].every((x) => typeof x === "string" && ID_RE.test(x))
    && typeof v["run_id"] === "string" && RUN_ID_RE.test(v["run_id"])
    && [v["segment_revision"], v["outcome_sha256"]].every((x) => typeof x === "string" && HASH_RE.test(x))
    && ["exited", "cancelled", "timed_out"].includes(v["outcome_state"] as string)
    && typeof v["sealed_at"] === "string" && isRfc3339(v["sealed_at"])
    && isObj(v["sealed_by"]) && Object.keys(v["sealed_by"]).length === 3
    && typeof v["sealed_by"]["operation_id"] === "string" && ID_RE.test(v["sealed_by"]["operation_id"])
    && typeof v["sealed_by"]["attempt_id"] === "string" && ID_RE.test(v["sealed_by"]["attempt_id"])
    && typeof v["sealed_by"]["launch_hash"] === "string" && HASH_RE.test(v["sealed_by"]["launch_hash"]);
  if (!ok) throw new ExecutionIdentityRefusal("record_invalid", "segment seal fields invalid");
}

export const EXECUTION_SEGMENT_RESERVATION_SCHEMA = "guild.stack.execution_segment_reservation.v1" as const;
/** One operation/attempt owns a segment for its whole supervised life; immutable. */
export interface ExecutionSegmentReservation {
  schema_version: typeof EXECUTION_SEGMENT_RESERVATION_SCHEMA; source_id: string; run_id: string; execution_id: string;
  segment_revision: Hash; operation_id: string; attempt_id: string; launch_hash: Hash;
}
const reservationPath = (root: string, runId: string, executionId: string) => {
  if (!ID_RE.test(executionId)) throw new ExecutionIdentityRefusal("record_invalid", "execution id is not an id");
  return path.join(runDir(root, runId), LINEAGE_DIR, "reservations", `${executionId}.json`);
};
function assertReservationShape(v: unknown): asserts v is ExecutionSegmentReservation {
  const keys = ["schema_version", "source_id", "run_id", "execution_id", "segment_revision", "operation_id", "attempt_id", "launch_hash"];
  const ok = isObj(v) && Object.keys(v).length === keys.length && keys.every((k) => own(v, k))
    && v["schema_version"] === EXECUTION_SEGMENT_RESERVATION_SCHEMA
    && ["source_id", "execution_id", "operation_id", "attempt_id"].every((k) => typeof v[k] === "string" && ID_RE.test(v[k] as string))
    && typeof v["run_id"] === "string" && RUN_ID_RE.test(v["run_id"])
    && ["segment_revision", "launch_hash"].every((k) => typeof v[k] === "string" && HASH_RE.test(v[k] as string));
  if (!ok) throw new ExecutionIdentityRefusal("record_invalid", "segment reservation fields invalid");
}
function requireActiveSegmentRevision(root: string, sourceId: string, runId: string, executionId: string, revision: Hash): void {
  const view = readLogicalRunView(root, runId);
  if (view.kind !== "v2") throw new ExecutionIdentityRefusal("logical_run_unknown", `${runId} is not a logical v2 run`);
  if (view.manifest.source_id !== sourceId) throw new ExecutionIdentityRefusal("record_invalid", "record source is not the run owner");
  const e = view.executions.find((x) => x.segment.lineage.execution_id === executionId);
  if (!e) throw new ExecutionIdentityRefusal("execution_unknown", `${runId} has no execution ${executionId}`);
  if (e.revision !== revision) throw new ExecutionIdentityRefusal("record_invalid", "record names a different segment revision");
  if (e.segment.admission !== "active") throw new ExecutionIdentityRefusal("record_invalid", `segment admission is ${e.segment.admission}`);
}

/** Reserve an unsealed segment for exactly one operation/attempt. A different reservation refuses record_immutable. */
export function reserveExecutionSegment(root: string, r: ExecutionSegmentReservation): void {
  assertReservationShape(r);
  requireActiveSegmentRevision(root, r.source_id, r.run_id, r.execution_id, r.segment_revision);
  if (readExecutionSegmentSeal(root, r.run_id, r.execution_id) !== null) throw new ExecutionIdentityRefusal("record_immutable", `${r.execution_id} is already sealed`);
  publishOnce(root, reservationPath(root, r.run_id, r.execution_id), r);
}

export function readExecutionSegmentReservation(root: string, runId: string, executionId: string): ExecutionSegmentReservation | null {
  const r = readJson<unknown>(root, reservationPath(root, runId, executionId), null);
  if (r === null) return null;
  assertReservationShape(r);
  if (r.run_id !== runId || r.execution_id !== executionId) throw new ExecutionIdentityRefusal("record_location_mismatch", `reservation file ${runId}/${executionId} holds ${r.run_id}/${r.execution_id}`);
  return r;
}

/** Seal the exact reserved segment revision. Idempotent for identical bytes; never touches the logical-run manifest. */
export function sealExecutionSegment(root: string, seal: ExecutionSegmentSeal): void {
  assertSealShape(seal);
  requireActiveSegmentRevision(root, seal.source_id, seal.run_id, seal.execution_id, seal.segment_revision);
  const r = readExecutionSegmentReservation(root, seal.run_id, seal.execution_id);
  if (r === null || r.source_id !== seal.source_id || r.segment_revision !== seal.segment_revision || r.operation_id !== seal.sealed_by.operation_id
    || r.attempt_id !== seal.sealed_by.attempt_id || r.launch_hash !== seal.sealed_by.launch_hash) {
    throw new ExecutionIdentityRefusal("record_invalid", "seal does not match the segment reservation");
  }
  publishOnce(root, sealPath(root, seal.run_id, seal.execution_id), seal);
}

export function readExecutionSegmentSeal(root: string, runId: string, executionId: string): ExecutionSegmentSeal | null {
  const seal = readJson<unknown>(root, sealPath(root, runId, executionId), null);
  if (seal === null) return null;
  assertSealShape(seal);
  if (seal.run_id !== runId || seal.execution_id !== executionId) throw new ExecutionIdentityRefusal("record_location_mismatch", `seal file ${runId}/${executionId} holds ${seal.run_id}/${seal.execution_id}`);
  return seal;
}

export interface GoalContribution { run_id: string; execution_id: string; logical_task_id: string; attempt_id: string }

/** Every recorded assignment, in any logical run of this root, that contributes to the goal. */
export function listGoalContributions(root: string, sourceId: string, goalId: string): GoalContribution[] {
  const runsDir = path.join(durableGuildDir(root), "runs");
  if (!fs.existsSync(runsDir)) return [];
  const out: GoalContribution[] = [];
  for (const runId of fs.readdirSync(runsDir).filter((d) => RUN_ID_RE.test(d)).sort()) {
    const dir = path.join(runsDir, runId, LINEAGE_DIR, "assignments");
    for (const f of listJson(dir)) {
      const { manifest } = requireLogicalRun(root, runId);
      const a = readJson<StackTaskAssignmentV3>(root, path.join(dir, f), "task-assignment")!;
      assertAttemptRecordAt(a.lineage, manifest.source_id, runId, f.slice(0, -".json".length), "assignment");
      assertAssignmentOwned(root, a);
      if (a.goal_contributions.some((g) => g.kind === "goal" && g.source_id === sourceId && g.id === goalId)) {
        out.push({ run_id: a.lineage.run_id, execution_id: a.lineage.execution_id, logical_task_id: a.lineage.logical_task_id!, attempt_id: a.lineage.attempt_id! });
      }
    }
  }
  return out;
}

// ── Joint versioned capability ───────────────────────────────────────────────

/**
 * One capability, six components. Identity is admitted only when every
 * component is supported together; a package advertising a subset gets a
 * refusal naming what is missing, never a partial v2 identity.
 */
export const EXECUTION_IDENTITY_CAPABILITY = Object.freeze({
  id: "guild.execution_identity",
  version: 1,
  components: Object.freeze({
    lifecycle_binding: RUN_BINDING_V2_SCHEMA,
    session: EXECUTION_SEGMENT_SCHEMA,
    assignment: STACK_TASK_ASSIGNMENT_SCHEMA,
    attempt: STACK_TASK_ATTEMPT_SCHEMA,
    receipt: EXECUTION_LINEAGE_SCHEMA,
    adapter: "guild.adapter_capability.v1",
  }),
});
export type IdentityComponent = keyof typeof EXECUTION_IDENTITY_CAPABILITY.components;

export type IdentityNegotiation =
  | { status: "supported"; capability: typeof EXECUTION_IDENTITY_CAPABILITY.id; version: number }
  | { status: "refused"; missing: IdentityComponent[] };

export function negotiateExecutionIdentity(advertised: Partial<Record<IdentityComponent, readonly string[]>>): IdentityNegotiation {
  const components = EXECUTION_IDENTITY_CAPABILITY.components;
  const missing = (Object.keys(components) as IdentityComponent[]).filter((c) => !(advertised[c] ?? []).includes(components[c]));
  return missing.length === 0
    ? { status: "supported", capability: EXECUTION_IDENTITY_CAPABILITY.id, version: EXECUTION_IDENTITY_CAPABILITY.version }
    : { status: "refused", missing };
}

function isSupportedNegotiation(n: IdentityNegotiation): boolean {
  return isObj(n) && n.status === "supported" && n.capability === EXECUTION_IDENTITY_CAPABILITY.id
    && n.version === EXECUTION_IDENTITY_CAPABILITY.version && Object.keys(n).length === 3;
}

export type AdmissionRefusalReason =
  | "capability_unsupported"
  | "v1_authority_cannot_carry_execution_identity"
  | "binding_invalid"
  | "lineage_invalid"
  | "binding_run_mismatch"
  | "binding_not_open"
  | "binding_manifest_mismatch"
  | "controller_mismatch"
  | "controller_suspended"
  | "authority_mismatch"
  | "stale_controller_epoch"
  | "logical_run_unknown"
  | "execution_unknown"
  | "host_session_mismatch"
  | "host_session_is_stack_session"
  | "original_host_changed"
  | "adapter_capability_mismatch"
  | "pins_mismatch"
  | "attempt_unassigned"
  | "attempt_reparent_refused"
  | "attempt_assignment_mismatch"
  | "attempt_grant_mismatch"
  | "run_layout_mixed"
  | "record_location_mismatch";

export type IdentityAdmission =
  | { ok: true; run_id: string; execution_id: string; attempt_id: string | null; host_session_id: string | null; stack_session_id: string }
  | { ok: false; reasons: AdmissionRefusalReason[] };

export interface AdmitExecutionIdentityInput {
  root: string;
  negotiation: IdentityNegotiation;
  /** Must be a `guild.run_binding.v2`; a v1 binding cannot authorize an execution identity. */
  binding: RunBindingV2 | RunBindingRecord;
  lineage: ExecutionLineageV1;
  stack_session_id: string;
}

const samePins = (a: Pins, b: Pins) => (Object.keys(a) as Array<keyof Pins>).every((k) => a[k] === b[k]);

/**
 * End-to-end admission of one execution-lineage receipt. Joins the negotiated
 * capability, the v2 authority binding, the persisted logical-run manifest
 * (by hash), the recorded segment, and — when an attempt is named — the
 * persisted assignment, across controller, epoch, host, host session, adapter,
 * writer scope and pins.
 */
export function admitExecutionIdentity(input: AdmitExecutionIdentityInput): IdentityAdmission {
  const reasons = new Set<AdmissionRefusalReason>();
  const refuse = (): IdentityAdmission => ({ ok: false, reasons: [...reasons] });
  if (!isSupportedNegotiation(input.negotiation)) reasons.add("capability_unsupported");
  const b = input.binding as unknown as Record<string, unknown>;
  if (isObj(b) && b["schema_version"] === "guild.run_binding.v1") {
    reasons.add("v1_authority_cannot_carry_execution_identity");
    return refuse();
  }
  if (!validateExecutionIdentityRecord("run-binding", input.binding).ok) reasons.add("binding_invalid");
  if (!validateExecutionIdentityRecord("execution-lineage", input.lineage).ok) reasons.add("lineage_invalid");
  if (reasons.has("binding_invalid") || reasons.has("lineage_invalid")) return refuse();

  const binding = input.binding as RunBindingV2;
  const rec = input.lineage;
  const l = rec.lineage;
  if (binding.run_id !== l.run_id || binding.source_id !== l.source_id) reasons.add("binding_run_mismatch");
  if (binding.state !== "open") reasons.add("binding_not_open");
  if (rec.authority.controller_source_id !== binding.controller_source_id || rec.authority.writer_scope_hash !== binding.writer_scope_hash) {
    reasons.add("authority_mismatch");
  }
  if (rec.authority.controller_epoch !== binding.controller_epoch) reasons.add("stale_controller_epoch");
  if (l.host_session_id !== null && l.host_session_id === input.stack_session_id) reasons.add("host_session_is_stack_session");

  let seg: ExecutionSegmentV1 | null = null;
  try {
    const run = requireLogicalRun(input.root, l.run_id);
    if (binding.logical_run_manifest_hash !== run.revision) reasons.add("binding_manifest_mismatch");
    const c = run.manifest.controller;
    if (c.source_id !== binding.controller_source_id || c.host_id !== binding.controller_host_id || binding.controller_epoch < c.epoch) {
      reasons.add("controller_mismatch");
    }
    if (c.state !== "active") reasons.add("controller_suspended");
    seg = requireSegment(input.root, l);
  } catch (error) {
    if (!(error instanceof ExecutionIdentityRefusal)) throw error;
    reasons.add(error.code === "logical_run_unknown" || error.code === "run_layout_mixed" || error.code === "record_location_mismatch"
      ? error.code : "execution_unknown");
  }
  if (seg !== null) {
    if (seg.host_session_id !== l.host_session_id) reasons.add("host_session_mismatch");
    if (seg.original_host_id !== rec.requested_host || (rec.observed_host !== null && rec.observed_host !== seg.original_host_id)) {
      reasons.add("original_host_changed");
    }
    if (seg.adapter_capability_hash !== rec.adapter_capability_hash) reasons.add("adapter_capability_mismatch");
    if (seg.issued_controller_epoch > binding.controller_epoch) reasons.add("stale_controller_epoch");
    if (l.attempt_id === null && !samePins(seg.pins, rec.pins)) reasons.add("pins_mismatch");
  }
  if (l.attempt_id !== null) {
    try {
      const { assignment } = requireAssignment(input.root, l);
      if (!samePins(assignment.pins, rec.pins)) reasons.add("pins_mismatch");
      if (rec.attempt_grant_ref !== assignment.grant_id) reasons.add("attempt_grant_mismatch");
      if (assignment.issued_controller_epoch > binding.controller_epoch) reasons.add("stale_controller_epoch");
    } catch (error) {
      if (!(error instanceof ExecutionIdentityRefusal)) throw error;
      reasons.add(error.code === "attempt_unassigned" ? "attempt_unassigned"
        : error.code === "attempt_reparent_refused" ? "attempt_reparent_refused"
          : error.code === "record_location_mismatch" ? "record_location_mismatch" : "attempt_assignment_mismatch");
    }
  }
  if (reasons.size > 0) return refuse();
  return { ok: true, run_id: l.run_id, execution_id: l.execution_id, attempt_id: l.attempt_id, host_session_id: l.host_session_id, stack_session_id: input.stack_session_id };
}
