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
import { ControllerRefusal, readControllerJournal, type RunController, type WriterGrant } from "./run-controller";
import type { Entity, Evidence, Hash, StackTaskAttemptV1, StateAxes } from "./execution-identity";
import { d8CloseGate, type D8Input } from "./initiative";
import { DurableOnceError, canonicalJson, hashOf, publishOnce, readOnce } from "./durable-once";
import { TransferRefusal, closeWorkDisposition, readWorkDisposition, transferCloseBlocker, type TransferState } from "./followup-transfer";

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
/**
 * Everything but the epoch (checked against the controller receipt) and
 * `closed_at` (caller-reported time, not authority), so a replay after a crash
 * between authorization and publication carries the same digest.
 */
const closureDigest = (r: WorkClosureRecord) => hashOf(canonicalJson({ ...r, controller_epoch: null, closed_at: null }));
const closeSubject = (digest: Hash) => `close.${digest.slice(7, 47)}`;
const CLOSURE_KEYS = ["schema_version", "source_id", "run_id", "subject", "operation_id", "request", "state", "final_attempt_id", "surfaced", "controller_epoch", "closed_at"];
const AXES: Record<keyof StateAxes, readonly string[]> = {
  lifecycle: ["created", "active", "suspended", "closed", "unknown"],
  outcome: ["pending", "succeeded", "failed", "cancelled", "partial", "unknown"],
  acceptance: ["pending", "verified", "rejected", "not_required", "unknown"],
  observability: ["complete", "partial", "unavailable"],
};
function closureShapeOk(r: unknown): r is WorkClosureRecord {
  if (typeof r !== "object" || r === null || Array.isArray(r)) return false;
  const o = r as Record<string, unknown>;
  if (Object.keys(o).length !== CLOSURE_KEYS.length || !CLOSURE_KEYS.every((k) => k in o)) return false;
  const st = o.state as Record<string, unknown>;
  const req = o.request as Record<string, unknown>;
  return o.schema_version === WORK_CLOSURE_SCHEMA && typeof o.operation_id === "string" && SEG_RE.test(o.operation_id)
    && typeof st === "object" && st !== null && Object.keys(st).length === 4 && (Object.keys(AXES) as Array<keyof StateAxes>).every((k) => AXES[k].includes(st[k] as string))
    && typeof req === "object" && req !== null && requestBlockers(req as unknown as CloseRequest).length === 0
    && (o.final_attempt_id === null || typeof o.final_attempt_id === "string")
    && Array.isArray(o.surfaced) && o.surfaced.every((x) => typeof x === "string")
    && Number.isSafeInteger(o.controller_epoch) && typeof o.closed_at === "string" && !Number.isNaN(Date.parse(o.closed_at));
}

function refuseFrom(e: unknown): never {
  if (e instanceof ControllerRefusal) throw new WorkClosureRefusal("controller_refused", `${e.code}: ${e.message}`);
  if (e instanceof TransferRefusal) throw new WorkClosureRefusal(e.code === "journal_corrupt" ? "closure_corrupt" : "storage_refused", e.message);
  if (e instanceof DurableOnceError) throw new WorkClosureRefusal("storage_refused", e.message);
  throw e;
}

/**
 * Persist one closure per work through the run controller. The controller
 * receipt binds the record digest, and a terminal `closed` disposition entry
 * shares the transfer CAS chain, so a close and a follow-up reservation never
 * both win. Idempotent on replay; a different outcome is refused.
 */
export function recordWorkClose(opts: {
  controller: RunController;
  grant: WriterGrant;
  /** The controller's private state dir; used to verify closures and transfer acks against the keyed journal. */
  controllerPrivateDir: string;
  durableRoot: string;
  subject: Entity;
  operation_id: string;
  decision: CloseDecision;
  request: CloseRequest;
  closed_at: string;
}): WorkClosureRecord {
  const { controller, subject } = opts;
  if (!opts.decision.ok) throw new WorkClosureRefusal("decision_refused", opts.decision.blockers.map((b) => `${b.code}:${b.subject}`).join(", "));
  if (!subject || subject.source_id !== controller.source_id || !["logical_task", "goal"].includes(subject.kind) || !SEG_RE.test(subject.id) || !SEG_RE.test(subject.source_id)) {
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
  if (!closureShapeOk(want)) throw new WorkClosureRefusal("request_invalid", "closure record would be malformed");
  const digest = closureDigest(want);
  try {
    const existing = readWorkClosure(root, run_id, subject, opts.controllerPrivateDir);
    if (existing) {
      if (existing.operation_id === want.operation_id && canonicalJson({ ...existing, controller_epoch: null, closed_at: null }) === canonicalJson({ ...want, controller_epoch: null, closed_at: null })) return existing;
      throw new WorkClosureRefusal("closure_conflict", `${subject.kind} ${subject.id} already closed by ${existing.operation_id}`);
    }
    // Re-read the transfer journal: the caller's snapshot may be stale.
    const blocker = transferCloseBlocker(root, run_id, subject, opts.controllerPrivateDir);
    if (blocker) throw new WorkClosureRefusal("transfer_unacknowledged", `follow-up ${blocker.operation_id} is ${blocker.state}`);
    const receipt = controller.control(opts.grant, { operation_id: opts.operation_id, action: "close", subject: closeSubject(digest) });
    const rec = { ...want, controller_epoch: receipt.controller_epoch };
    const sealed = closeWorkDisposition(root, run_id, subject, { operation_id: opts.operation_id, closure_hash: digest });
    if (sealed.outcome === "blocked") {
      throw sealed.state === "closed"
        ? new WorkClosureRefusal("closure_conflict", `${subject.kind} ${subject.id} closed concurrently`)
        : new WorkClosureRefusal("transfer_unacknowledged", `disposition is ${sealed.state}`);
    }
    const r = publishOnce(root, closurePath(run_id, subject), Buffer.from(`${JSON.stringify(rec, null, 2)}\n`, "utf8"));
    if (r.created) return rec;
    const landed = readWorkClosure(root, run_id, subject, opts.controllerPrivateDir);
    if (landed && landed.operation_id === rec.operation_id && closureDigest(landed) === digest) return landed;
    throw new WorkClosureRefusal("closure_conflict", `${subject.kind} ${subject.id} closed concurrently`);
  } catch (e) {
    if (e instanceof WorkClosureRefusal) throw e;
    return refuseFrom(e);
  }
}

/**
 * Read a closure and verify it: full shape, the controller receipt that binds
 * its digest and epoch, and the terminal `closed` disposition entry. Null when
 * the work has no closure; anything that does not verify refuses.
 */
export function readWorkClosure(durableRoot: string, run_id: string, subject: Entity, controllerPrivateDir: string): WorkClosureRecord | null {
  if (!SEG_RE.test(run_id) || !subject || !SEG_RE.test(subject.id) || !["logical_task", "goal"].includes(subject.kind)) return null;
  const root = path.resolve(durableRoot);
  let raw: string | null;
  try { raw = readOnce(root, closurePath(run_id, subject)); } catch (e) { return refuseFrom(e); }
  if (raw === null) return null;
  let rec: unknown;
  try { rec = JSON.parse(raw); } catch { throw new WorkClosureRefusal("closure_corrupt", "closure record is not JSON"); }
  if (!closureShapeOk(rec) || rec.run_id !== run_id || canonicalJson(rec.subject) !== canonicalJson(subject)) {
    throw new WorkClosureRefusal("closure_corrupt", "closure record shape or identity mismatch");
  }
  const digest = closureDigest(rec);
  let journal: ReturnType<typeof readControllerJournal>;
  try { journal = readControllerJournal({ privateDir: controllerPrivateDir }); } catch (e) { return refuseFrom(e); }
  const bound = journal.run_id === run_id && journal.source_id === rec.source_id ? journal.operations.get(rec.operation_id) : undefined;
  if (!bound || bound.action !== "close" || bound.subject !== closeSubject(digest) || bound.controller_epoch !== rec.controller_epoch) {
    throw new WorkClosureRefusal("closure_corrupt", "closure record is not bound by the run controller");
  }
  let sealed = false;
  try {
    const view = readWorkDisposition(root, run_id, subject);
    const head = view.entries[view.entries.length - 1];
    sealed = !!head && head.state === "closed" && head.operation_id === rec.operation_id && head.intent_hash === digest;
  } catch (e) { return refuseFrom(e); }
  if (!sealed) throw new WorkClosureRefusal("closure_corrupt", "closure record has no matching closed disposition");
  return rec;
}
