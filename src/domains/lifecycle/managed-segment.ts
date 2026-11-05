import { StackError, stackHash } from "../state";
import { ExecutionIdentityRefusal, readExecutionSegmentSeal, readLogicalRunView, type ExecutionSegmentV1 } from "./execution-identity";
import type { ManagedUsageObservation } from "./managed-run";

/**
 * R05 · P05 host supervision on execution segments.
 *
 * A v1 managed run keeps its exit-closes-run behaviour. A logical v2 run is
 * refused until segment integration qualifies (V01 needs a real managed host
 * launch). When integrated, host exit seals the exact segment and never closes
 * the logical run.
 */
export interface ManagedSegmentIntegration { readonly qualified: boolean; readonly reason: string }
export const MANAGED_SEGMENT_INTEGRATION: ManagedSegmentIntegration = Object.freeze({
  qualified: false,
  reason: "Managed launch of a logical v2 run is not qualified; segment integration needs a real managed host launch (V01)",
});

export type ManagedRunTarget =
  | { kind: "v1" }
  | { kind: "v2"; execution_id: string; segment: ExecutionSegmentV1; segment_revision: string };

export interface ManagedRunTargetInput { root: string; run_id: string; source_id: string; host_id: string; execution_id?: string }

/** Resolve what a managed launch supervises. Refuses before any effect. */
export function resolveManagedRunTarget(input: ManagedRunTargetInput, integration: ManagedSegmentIntegration = MANAGED_SEGMENT_INTEGRATION): ManagedRunTarget {
  let view;
  try {
    view = readLogicalRunView(input.root, input.run_id);
  } catch (error) {
    if (error instanceof ExecutionIdentityRefusal) throw new StackError(error.code, "Managed run layout refused", 409);
    throw error;
  }
  if (view.kind !== "v2") {
    if (input.execution_id !== undefined) throw new StackError("execution_on_v1_run", "A v1 run authority cannot carry an execution id", 403);
    return { kind: "v1" };
  }
  if (integration.qualified !== true) throw new StackError("logical_v2_unqualified", integration.reason, 503);
  if (view.manifest.source_id !== input.source_id) throw new StackError("source_mismatch", "Logical run belongs to another source", 403);
  if (view.manifest.controller.state !== "active") throw new StackError("controller_suspended", "Logical run controller is not active", 409);
  if (input.execution_id === undefined) throw new StackError("execution_required", "Logical v2 launch must name its execution segment", 422);
  const found = view.executions.find((e) => e.segment.lineage.execution_id === input.execution_id);
  if (!found) throw new StackError("execution_unknown", "Execution segment is not recorded", 404);
  if (found.segment.admission !== "active") throw new StackError("segment_not_active", "Execution segment is not admitted for launch", 409);
  if (found.segment.original_host_id !== input.host_id) throw new StackError("original_host_changed", "Execution segment runs on another host", 409);
  if (readExecutionSegmentSeal(input.root, input.run_id, input.execution_id) !== null) throw new StackError("segment_sealed", "Execution segment is already sealed", 409);
  return { kind: "v2", execution_id: input.execution_id, segment: found.segment, segment_revision: found.revision };
}

export type ManagedExitAction = { action: "close_run"; status: "closed" | "resumable" } | { action: "seal_segment" } | { action: "hold" };

/** Segment-seal versus run-close policy. Surviving owned descendants hold both. */
export function managedExitAction(kind: "v1" | "v2", exit: { gone: boolean; state: string; exit_code: number | null; leave_resumable: boolean }): ManagedExitAction {
  if (!exit.gone) return { action: "hold" };
  if (kind === "v2") return { action: "seal_segment" };
  return { action: "close_run", status: exit.state === "exited" && exit.exit_code === 0 && !exit.leave_resumable ? "closed" : "resumable" };
}

export interface ManagedLaunchProofExpectation {
  source_id: string; run_id: string; operation_id: string; operation: "run.start" | "run.rerun";
  attempt_id: string; launch_hash: string;
  parent_run: { source_id: string; kind: string; id: string; revision: string } | null;
}

const canonical = (v: unknown): string => v === null || typeof v !== "object" ? JSON.stringify(v)
  : Array.isArray(v) ? "[" + v.map(canonical).join(",") + "]"
    : "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canonical((v as any)[k])).join(",") + "}";

/** A launch proof binds one exact operation and attempt; a start proof never stands in for a rerun. */
export function bindManagedLaunchProof(proof: unknown, expected: ManagedLaunchProofExpectation): void {
  const p = proof as Record<string, unknown> | null;
  const parentOk = expected.operation === "run.start"
    ? p?.["parent_run"] === null && expected.parent_run === null
    : expected.parent_run !== null && expected.parent_run.id !== expected.run_id && canonical(p?.["parent_run"]) === canonical(expected.parent_run);
  const ok = p !== null && typeof p === "object" && !Array.isArray(p)
    && p["schema_version"] === "guild.stack.managed_launch.v1"
    && p["source_id"] === expected.source_id && p["run_id"] === expected.run_id
    && p["operation_id"] === expected.operation_id && p["operation"] === expected.operation
    && p["attempt_id"] === expected.attempt_id && p["launch_hash"] === expected.launch_hash && parentOk;
  if (!ok) throw new StackError("proof_mismatch", "Launch proof does not bind this exact operation and attempt", 409);
}

export interface ManagedBudgetInput {
  mode: "native_spend_threshold" | "strict_verified";
  threshold_usd: number; duration_limit_ms: number;
  native_threshold_qualified: boolean; strict_usd_qualified: boolean;
  usage: ManagedUsageObservation | null; elapsed_ms: number | null;
}
export interface ManagedBudgetView {
  schema_version: "guild.stack.managed_budget_view.v1";
  mode: "native_spend_threshold";
  threshold: { usd: number; hard_ceiling: false; overshoot_possible: true };
  spend: {
    cost_basis: "native_estimate" | "unavailable"; estimate_basis: "api_equivalent_native_estimate";
    estimate_usd: number | null; measured_usd: null; overshoot_usd: number | null;
    state: "within_threshold" | "over_threshold" | "unknown";
  };
  duration: { limit_ms: number; enforcement: "independent_deadline"; elapsed_ms: number | null; exceeded: boolean | null };
  controls: Array<{ id: "strict_usd_ceiling" | "native_spend_threshold"; available: boolean; reason: string }>;
  labels: string[];
}

const STRICT_UNAVAILABLE = "No verified measured-USD billing source for this host; strict spend ceiling is unavailable";
const micro = (n: number) => Math.round(n * 1e6) / 1e6;
const usd = (n: number) => "$" + n.toFixed(2);

function assertBudgetAdmissible(input: Pick<ManagedBudgetInput, "mode" | "threshold_usd" | "duration_limit_ms" | "native_threshold_qualified">): void {
  if (!Number.isFinite(input.threshold_usd) || input.threshold_usd <= 0) throw new StackError("budget_refused", "Positive spend threshold required before dispatch", 403);
  if (!Number.isSafeInteger(input.duration_limit_ms) || input.duration_limit_ms < 1) throw new StackError("budget_refused", "Positive duration limit required before dispatch", 403);
  // Strict verified USD is never qualified on the managed path; native accounting must be qualified.
  if (input.mode !== "native_spend_threshold" || input.native_threshold_qualified !== true) throw new StackError("budget_unqualified", "Only a qualified native spend threshold is available; strict USD is not", 503);
}

/** Budget display: a native threshold is an estimate that may overshoot; duration is enforced on its own. */
export function managedBudgetView(input: ManagedBudgetInput): ManagedBudgetView {
  assertBudgetAdmissible(input);
  const u = input.usage;
  const known = u !== null && u.state === "observed_native_estimate" && u.basis === "api_equivalent_native_estimate"
    && typeof u.cost_usd === "number" && Number.isFinite(u.cost_usd) && u.cost_usd >= 0;
  const estimate = known ? micro(u!.cost_usd as number) : null;
  const overshoot = estimate === null ? null : Math.max(0, micro(estimate - input.threshold_usd));
  const state = estimate === null ? "unknown" : overshoot! > 0 ? "over_threshold" : "within_threshold";
  const elapsed = typeof input.elapsed_ms === "number" && Number.isFinite(input.elapsed_ms) && input.elapsed_ms >= 0 ? input.elapsed_ms : null;
  const labels = [
    `Spend threshold ${usd(input.threshold_usd)} (native estimate; a response in flight may overshoot)`,
    estimate === null ? "Estimated spend unknown (no trusted native estimate observed)"
      : `Estimated spend ${usd(estimate)} (api-equivalent native estimate)` + (overshoot! > 0 ? `, over threshold by ${usd(overshoot!)}` : ""),
    `Duration limit ${Math.round(input.duration_limit_ms / 1000)}s, enforced separately by deadline`,
  ];
  return {
    schema_version: "guild.stack.managed_budget_view.v1",
    mode: "native_spend_threshold",
    threshold: { usd: input.threshold_usd, hard_ceiling: false, overshoot_possible: true },
    spend: { cost_basis: estimate === null ? "unavailable" : "native_estimate", estimate_basis: "api_equivalent_native_estimate", estimate_usd: estimate, measured_usd: null, overshoot_usd: overshoot, state },
    duration: { limit_ms: input.duration_limit_ms, enforcement: "independent_deadline", elapsed_ms: elapsed, exceeded: elapsed === null ? null : elapsed > input.duration_limit_ms },
    controls: [
      { id: "strict_usd_ceiling", available: false, reason: STRICT_UNAVAILABLE },
      { id: "native_spend_threshold", available: true, reason: "Qualified native estimate threshold; overshoot possible" },
    ],
    labels,
  };
}

export interface ManagedV2BudgetEvidence {
  qualification: { source_id: string; path: string; sha256: string; schema_version: string; observed_at: string; availability: string; reason: string | null };
  policy_hash: string;
}

/** Project onto the frozen v2 common budget: native threshold always declares possible overshoot. */
export function managedV2Budget(input: Pick<ManagedBudgetInput, "mode" | "threshold_usd" | "duration_limit_ms" | "native_threshold_qualified">, evidence: ManagedV2BudgetEvidence) {
  assertBudgetAdmissible(input);
  if (evidence.qualification?.availability !== "available") throw new StackError("budget_unqualified", "Budget qualification evidence is not available", 503);
  if (!/^sha256:[a-f0-9]{64}$/.test(evidence.policy_hash) || !/^sha256:[a-f0-9]{64}$/.test(evidence.qualification.sha256)) throw new StackError("budget_refused", "Budget policy and qualification must be pinned", 403);
  return { mode: "native_spend_threshold" as const, threshold_usd: input.threshold_usd, duration_limit_ms: input.duration_limit_ms, overshoot_possible: true, qualification: evidence.qualification, policy_hash: evidence.policy_hash };
}

/** Hash of an outcome record, for the seal. */
export const managedOutcomeHash = (outcome: unknown): string => stackHash(canonical(outcome));
