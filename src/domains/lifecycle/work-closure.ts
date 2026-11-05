/**
 * src/domains/lifecycle/work-closure.ts — R04 work closure (AT14).
 *
 * Closing a task or goal sets four independent axes (lifecycle, outcome,
 * acceptance, observability). Verified success needs the final attempt's
 * controller-accepted evidence, verified receipts, reconciled effects and the
 * required acceptance; an exit code or an archive never counts. Cancel and
 * partial are explicit operator outcomes with a reason and never claim
 * verified acceptance. Any close waits for an unacknowledged follow-up
 * transfer of the same work.
 *
 * Initiative completion is kind-aware: `software` (the default when no kind
 * is declared) keeps the strict D8 gate; `research` must be declared exactly
 * and needs the adopted research predicate, accepted research evidence, every
 * work item disposed and the docs leg, and may not claim a software release.
 */
import * as path from "node:path";
import { ControllerRefusal, type RunController, type WriterGrant } from "./run-controller";
import type { Entity, Evidence, Hash, StackTaskAttemptV1, StateAxes } from "./execution-identity";
import { d8CloseGate, type D8Input } from "./initiative";
import { DurableOnceError, canonicalJson, hashOf, publishOnce, readOnce } from "./durable-once";
import { transferCloseBlocker, type TransferState } from "./followup-transfer";

export const WORK_CLOSURE_SCHEMA = "guild.work_closure.v1" as const;

export type CloseRequest =
  | { kind: "verified_success" }
  | { kind: "cancel"; operator_id: string; reason: string }
  | { kind: "partial"; operator_id: string; reason: string };

export interface AttemptFacts {
  attempt: StackTaskAttemptV1;
  /** Result of verifying the attempt's control receipt against the controller journal. */
  receipt: "verified" | "missing" | "mismatch";
  /** Informational only; never evidence of success. */
  exit_code?: number | null;
}
export interface TaskCloseInput {
  task: Entity;
  attempts: AttemptFacts[];
  acceptance_required: boolean;
  acceptance: { state: "verified" | "rejected" | "pending"; subject_hash: Hash | null };
  transfer_blocker: { operation_id: string; state: TransferState } | null;
  request: CloseRequest;
}
export type CloseBlockerCode =
  | "request_invalid"
  | "operator_reason_required"
  | "attempt_live"
  | "attempt_orphaned"
  | "receipt_missing"
  | "receipt_mismatch"
  | "receipt_loss_unreconciled"
  | "uncertain_effects"
  | "no_accepted_final_evidence"
  | "acceptance_unverified"
  | "acceptance_subject_mismatch"
  | "transfer_unacknowledged"
  | "no_contributions"
  | "contribution_open"
  | "contribution_not_succeeded";
export interface CloseBlocker { code: CloseBlockerCode; subject: string }
export type CloseDecision =
  | { ok: true; state: StateAxes; final_attempt_id: string | null; surfaced: string[] }
  | { ok: false; blockers: CloseBlocker[] };

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SEG_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/;

function requestBlockers(req: CloseRequest): CloseBlocker[] {
  if (!req || !["verified_success", "cancel", "partial"].includes((req as { kind?: string }).kind as string)) {
    return [{ code: "request_invalid", subject: String((req as { kind?: unknown })?.kind) }];
  }
  if (req.kind === "verified_success") return [];
  const okOperator = typeof req.operator_id === "string" && ID_RE.test(req.operator_id);
  const okReason = typeof req.reason === "string" && req.reason.trim().length > 0 && req.reason.length <= 4096;
  return okOperator && okReason ? [] : [{ code: "operator_reason_required", subject: req.kind }];
}

const attemptId = (a: StackTaskAttemptV1) => a.lineage.attempt_id ?? `ordinal-${a.ordinal}`;
const isLive = (a: StackTaskAttemptV1) => a.state.lifecycle === "created" || a.state.lifecycle === "active";
const isOrphaned = (a: StackTaskAttemptV1) =>
  !isLive(a) && (a.state.lifecycle !== "closed" || a.state.outcome === "pending" || a.state.outcome === "unknown");
const availableRefs = (refs: Evidence[]) => refs.length > 0 && refs.every((r) => r.availability === "available");

/** Decide how a task may close. Pure. */
export function evaluateTaskClose(input: TaskCloseInput): CloseDecision {
  const blockers = requestBlockers(input.request);
  if (blockers.some((b) => b.code === "request_invalid")) return { ok: false, blockers };
  const req = input.request;
  const attempts = [...input.attempts].sort((x, y) => x.attempt.ordinal - y.attempt.ordinal);

  if (input.transfer_blocker) blockers.push({ code: "transfer_unacknowledged", subject: input.transfer_blocker.operation_id });
  for (const f of attempts) if (isLive(f.attempt)) blockers.push({ code: "attempt_live", subject: attemptId(f.attempt) });

  const surfaced: string[] = [];
  let degraded = false;
  for (const f of attempts) {
    const a = f.attempt;
    const id = attemptId(a);
    const problems: CloseBlockerCode[] = [];
    if (isOrphaned(a)) problems.push("attempt_orphaned");
    if (f.receipt === "missing") problems.push("receipt_missing");
    if (f.receipt === "mismatch") problems.push("receipt_mismatch");
    if (!a.receipt_loss_reconciled) problems.push("receipt_loss_unreconciled");
    if (a.uncertain_effects) problems.push("uncertain_effects");
    if (problems.length || !a.result_refs.every((r) => r.availability === "available")) degraded = true;
    if (problems.length && !isLive(a)) surfaced.push(id);
    if (req.kind === "verified_success") for (const code of problems) blockers.push({ code, subject: id });
  }
  const observability: StateAxes["observability"] = attempts.length === 0 || !degraded ? "complete" : "partial";

  if (req.kind !== "verified_success") {
    if (blockers.length) return { ok: false, blockers };
    const acceptance: StateAxes["acceptance"] = input.acceptance.state === "rejected" ? "rejected" : req.kind === "cancel" ? "not_required" : "pending";
    return { ok: true, state: { lifecycle: "closed", outcome: req.kind === "cancel" ? "cancelled" : "partial", acceptance, observability }, final_attempt_id: null, surfaced };
  }

  // Verified success: the final attempt carries the accepted evidence.
  const final = attempts[attempts.length - 1]?.attempt;
  const accepted = !!final && final.state.lifecycle === "closed" && final.state.outcome === "succeeded" && final.state.acceptance === "verified"
    && final.accepted_by_controller_epoch !== null && final.acceptance_subject_hash !== null && availableRefs(final.result_refs);
  if (!accepted) blockers.push({ code: "no_accepted_final_evidence", subject: final ? attemptId(final) : input.task.id });
  if (input.acceptance_required) {
    if (input.acceptance.state !== "verified") blockers.push({ code: "acceptance_unverified", subject: input.task.id });
    else if (!final || input.acceptance.subject_hash === null || input.acceptance.subject_hash !== final.acceptance_subject_hash) {
      blockers.push({ code: "acceptance_subject_mismatch", subject: input.task.id });
    }
  }
  if (blockers.length) return { ok: false, blockers };
  return {
    ok: true,
    state: { lifecycle: "closed", outcome: "succeeded", acceptance: input.acceptance_required ? "verified" : "not_required", observability },
    final_attempt_id: attemptId(final!),
    surfaced: [],
  };
}

export interface GoalCloseInput {
  goal: Entity;
  /** Each contributing task with its recorded closure state, or null when not closed. */
  contributions: Array<{ task: Entity; state: StateAxes | null }>;
  request: CloseRequest;
}

/** Decide how a goal may close. Success needs every contribution closed succeeded with acceptance. Pure. */
export function evaluateGoalClose(input: GoalCloseInput): CloseDecision {
  const blockers = requestBlockers(input.request);
  if (blockers.some((b) => b.code === "request_invalid")) return { ok: false, blockers };
  const req = input.request;
  const open = input.contributions.filter((c) => !c.state || c.state.lifecycle !== "closed");
  for (const c of open) blockers.push({ code: "contribution_open", subject: c.task.id });
  if (req.kind === "verified_success") {
    if (input.contributions.length === 0) blockers.push({ code: "no_contributions", subject: input.goal.id });
    for (const c of input.contributions) {
      if (c.state && c.state.lifecycle === "closed" && !(c.state.outcome === "succeeded" && (c.state.acceptance === "verified" || c.state.acceptance === "not_required"))) {
        blockers.push({ code: "contribution_not_succeeded", subject: c.task.id });
      }
    }
  }
  if (blockers.length) return { ok: false, blockers };
  const observability: StateAxes["observability"] = input.contributions.every((c) => c.state?.observability === "complete") ? "complete" : "partial";
  if (req.kind === "verified_success") {
    const acceptance = input.contributions.some((c) => c.state!.acceptance === "verified") ? "verified" : "not_required";
    return { ok: true, state: { lifecycle: "closed", outcome: "succeeded", acceptance, observability }, final_attempt_id: null, surfaced: [] };
  }
  return { ok: true, state: { lifecycle: "closed", outcome: req.kind === "cancel" ? "cancelled" : "partial", acceptance: req.kind === "cancel" ? "not_required" : "pending", observability }, final_attempt_id: null, surfaced: [] };
}

// ── initiative completion predicate ──────────────────────────────────────────

export type OutcomeKind = "software" | "research";
export interface InitiativeCloseInput {
  /** Declared outcome kind. Absent means software; any other value refuses. */
  outcome_kind?: unknown;
  /** True only when the research completion predicate has been adopted for this initiative. */
  research_predicate_adopted?: boolean;
  d8: D8Input;
  work_items: Array<{ id: string; status: string }>;
  research_evidence: Array<{ ref: Evidence; accepted: boolean }>;
}
export interface InitiativeCloseResult { kind: OutcomeKind | "unknown"; canClose: boolean; blockers: string[] }

export function initiativeClosePredicate(i: InitiativeCloseInput): InitiativeCloseResult {
  if (i.outcome_kind === undefined || i.outcome_kind === "software") {
    const d8 = d8CloseGate(i.d8);
    return { kind: "software", canClose: d8.canClose, blockers: d8.blockers };
  }
  if (i.outcome_kind !== "research") return { kind: "unknown", canClose: false, blockers: [`unknown outcome kind ${JSON.stringify(i.outcome_kind)}; declare software or research`] };
  const blockers: string[] = [];
  if (i.research_predicate_adopted !== true) blockers.push("research completion predicate not adopted for this initiative");
  if (!i.research_evidence.some((e) => e.accepted && e.ref.availability === "available")) blockers.push("no accepted research evidence that is still available");
  const undisposed = i.work_items.filter((w) => w.status !== "done" && w.status !== "cancelled");
  if (undisposed.length) blockers.push(`work items not disposed: ${undisposed.map((w) => w.id).join(", ")}`);
  if (i.d8.execution_status !== "done") blockers.push("execution leg unresolved: execution_status != done");
  if (i.d8.documentation_status !== "updated" && i.d8.documentation_status !== "no_update_required") blockers.push("docs leg unresolved: documentation_status not 'updated'/'no_update_required'");
  if (i.d8.release_status !== "not_released") blockers.push("a research initiative cannot claim a software release (release_status must stay not_released)");
  return { kind: "research", canClose: blockers.length === 0, blockers };
}

// ── persistence ──────────────────────────────────────────────────────────────

export type WorkClosureRefusalCode = "request_invalid" | "decision_refused" | "transfer_unacknowledged" | "closure_conflict" | "closure_corrupt" | "controller_refused" | "storage_refused";
export class WorkClosureRefusal extends Error {
  constructor(readonly code: WorkClosureRefusalCode, detail: string) {
    super(`work closure refused (${code}): ${detail}`);
    this.name = "WorkClosureRefusal";
  }
}

export interface WorkClosureRecord {
  schema_version: typeof WORK_CLOSURE_SCHEMA;
  source_id: string;
  run_id: string;
  subject: Entity;
  operation_id: string;
  request: CloseRequest;
  state: StateAxes;
  final_attempt_id: string | null;
  surfaced: string[];
  controller_epoch: number;
  closed_at: string;
}

const closurePath = (run_id: string, subject: Entity) => path.join(".guild", "runs", run_id, "closures", subject.kind, `${subject.id}.json`);
const closureIdentity = (r: WorkClosureRecord) => canonicalJson({ ...r, controller_epoch: null, closed_at: null });

/** Persist one closure per work through the run controller. Idempotent on replay; a different outcome is refused. */
export function recordWorkClose(opts: {
  controller: RunController;
  grant: WriterGrant;
  durableRoot: string;
  subject: Entity;
  operation_id: string;
  decision: CloseDecision;
  request: CloseRequest;
  closed_at: string;
}): WorkClosureRecord {
  const { controller, subject } = opts;
  if (!opts.decision.ok) throw new WorkClosureRefusal("decision_refused", opts.decision.blockers.map((b) => `${b.code}:${b.subject}`).join(", "));
  if (!subject || subject.source_id !== controller.source_id || !["logical_task", "goal"].includes(subject.kind) || !SEG_RE.test(subject.id)) {
    throw new WorkClosureRefusal("request_invalid", "subject must be a logical_task or goal of this source with a path-safe id");
  }
  if (!SEG_RE.test(opts.operation_id) || Number.isNaN(Date.parse(opts.closed_at))) throw new WorkClosureRefusal("request_invalid", "operation_id or closed_at invalid");
  const root = path.resolve(opts.durableRoot);
  const run_id = controller.run_id;
  const want: WorkClosureRecord = {
    schema_version: WORK_CLOSURE_SCHEMA, source_id: controller.source_id, run_id, subject, operation_id: opts.operation_id,
    request: opts.request, state: opts.decision.state, final_attempt_id: opts.decision.final_attempt_id, surfaced: opts.decision.surfaced,
    controller_epoch: controller.epoch, closed_at: new Date(Date.parse(opts.closed_at)).toISOString(),
  };
  const existing = readWorkClosure(root, run_id, subject);
  if (existing) {
    if (existing.operation_id === want.operation_id && closureIdentity(existing) === closureIdentity(want)) return existing;
    throw new WorkClosureRefusal("closure_conflict", `${subject.kind} ${subject.id} already closed by ${existing.operation_id}`);
  }
  // Re-read the transfer journal: the caller's snapshot may be stale.
  const blocker = transferCloseBlocker(root, run_id, subject);
  if (blocker) throw new WorkClosureRefusal("transfer_unacknowledged", `follow-up ${blocker.operation_id} is ${blocker.state}`);
  try {
    const digest = hashOf(closureIdentity(want)).slice(7, 47);
    controller.control(opts.grant, { operation_id: opts.operation_id, action: "close", subject: `close.${digest}` });
  } catch (e) {
    if (e instanceof ControllerRefusal) throw new WorkClosureRefusal("controller_refused", `${e.code}: ${e.message}`);
    throw e;
  }
  let r: ReturnType<typeof publishOnce>;
  try {
    r = publishOnce(root, closurePath(run_id, subject), Buffer.from(`${JSON.stringify(want, null, 2)}\n`, "utf8"));
  } catch (e) {
    if (e instanceof DurableOnceError) throw new WorkClosureRefusal("storage_refused", e.message);
    throw e;
  }
  if (r.created) return want;
  const landed = readWorkClosure(root, run_id, subject);
  if (landed && landed.operation_id === want.operation_id && closureIdentity(landed) === closureIdentity(want)) return landed;
  throw new WorkClosureRefusal("closure_conflict", `${subject.kind} ${subject.id} closed concurrently`);
}

export function readWorkClosure(durableRoot: string, run_id: string, subject: Entity): WorkClosureRecord | null {
  if (!SEG_RE.test(run_id) || !subject || !SEG_RE.test(subject.id) || !["logical_task", "goal"].includes(subject.kind)) return null;
  const raw = readOnce(path.resolve(durableRoot), closurePath(run_id, subject));
  if (raw === null) return null;
  let rec: WorkClosureRecord;
  try { rec = JSON.parse(raw) as WorkClosureRecord; } catch { throw new WorkClosureRefusal("closure_corrupt", "closure record is not JSON"); }
  if (rec.schema_version !== WORK_CLOSURE_SCHEMA || rec.run_id !== run_id || canonicalJson(rec.subject) !== canonicalJson(subject)) {
    throw new WorkClosureRefusal("closure_corrupt", "closure record identity mismatch");
  }
  return rec;
}
