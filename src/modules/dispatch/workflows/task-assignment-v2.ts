/**
 * src/modules/dispatch/workflows/task-assignment-v2.ts
 *
 * `guild.task_assignment.v2` — the authoritative, per-attempt production channel
 * (ADR `task-cell-runtime-contract.md` D6). This is the I/O + launcher-facing
 * BUILDER layer over the pure G2 contract
 * (`scripts/lib/core/contracts/task-cell-backend.ts`); it owns no schema of its
 * own — it reuses `buildTaskAssignmentV2` / `validateTaskAssignmentV2` /
 * `validateTaskAttemptV1` / `taskCellPaths`.
 *
 * It replaces the v1 representative-first-task collapse
 * (`task-assignment.ts` → one file per SPECIALIST name, first task only). Here a
 * dispatch emits ONE immutable assignment file per (task_run_id, attempt,
 * instance_id) at the canonical run-tree path, plus its `guild.task_attempt.v1`
 * companion — so a specialist owning ≥2 tasks gets ≥2 distinct files and nothing
 * is overwritten (P0.3 / adversarial test 1).
 *
 * Fail-closed (D6 — a malformed/unreadable assignment is a HARD dispatch failure,
 * not log-and-continue):
 *   - the WRITER validates before writing and THROWS on a malformed assignment or
 *     an attempt to overwrite an existing immutable file;
 *   - the READER validates after reading and returns null on any malformed/absent
 *     file (the caller then fails the lane rather than acting on garbage).
 */

import * as fs from "fs";
import * as path from "path";

// T3 rework F3 (guild.session_context.v1 §5): the v2 production descriptor
// writers require + verify the run's minted binding fail-closed before ANY
// write. Frozen v2 schemas are preserved — the binding rides the writer API.
import {
  BindingRejectedError,
  verifyRunBinding,
} from "../../lifecycle";
import type { DispatchBindingEnvelope } from "./task-assignment";
import {
  TASK_ATTEMPT_SCHEMA,
  buildTaskAssignmentV2,
  taskCellPaths,
  validateTaskAssignmentV2,
  validateTaskAttemptV1,
  type TaskAssignmentV2,
  type TaskAttemptV1,
  type ToolPermissionProjection,
} from "./task-cell-contract";
// T6 rework F5: the production dispatch path consumes the M1/M2 routing plan
// (shadow provenance on every real dispatch; v2 selection only behind the
// verified M2 gate) — wired HERE, the module-map §1 dispatch wiring point.
import {
  loadVerifiedM0Reports,
  readRoutingFlags,
  type M2EvidenceRefs,
} from "../../capability";
import type { ResolveRequest, ResolutionReceipt } from "../../capability";
import {
  confirmationKeyForReceipt,
  persistShadowArtifacts,
  planDispatchModel,
  type DispatchModelSelection,
  type LegacySelection,
} from "./shadow-routing";
// T7-M4: the §6 exact-key confirmation arbiter, wired at the REAL dispatch
// point. Before this, `claimPrompt`/`createRunLocalState` had zero production
// callers, so nothing stopped one degradation approval from being reused
// across a different target, purpose, or fallback shape.
import { claimConfirmation } from "./confirmation-gate";
import type { SpecialistModelProvenance } from "./specialist-contract";

/**
 * The launcher-facing dispatch descriptor for ONE task attempt. The launcher
 * resolves these from team.yaml × the plan (one per task-id a specialist owns);
 * `buildTaskCell` turns each into a self-contained `guild.task_assignment.v2`
 * plus its attempt companion. Every id is a safe path segment (the contract's
 * `taskCellPaths` throws otherwise — a hard failure, never a silent sanitize).
 */
export interface TaskCellDispatchInput {
  runId: string;
  /** The stable logical task (the plan lane / task-id). One per file — never collapsed. */
  logicalTaskId: string;
  /** This attempt's run id + attempt number (attempt 1 for a fresh dispatch). */
  taskRunId: string;
  attempt: number;
  attemptId: string;
  /** The EPHEMERAL instance identity — unique per (task_run_id, attempt); never reused (D3). */
  instanceId: string;
  /** D4 lineage — required on every non-first attempt, forbidden on the first. */
  previousAttemptId?: string | null;
  retryReason?: string | null;
  cellId: string;
  goalId: string;
  phaseId: string;
  stepId: string;
  teamId: string;
  /** The specialist slug owning this lane. */
  workerRole: string;
  specialistTypeId: string;
  specialistTypeVersion: string;
  specialistTypeHash: string;
  specialistProfileId: string;
  specialistProfileHash: string;
  /** Fresh per instance — an attempt NEVER reuses the prior attempt's bundle (D3). */
  contextBundleId: string;
  contextBundleHash: string;
  hostId: string;
  adapterId: string;
  hostCapabilitiesHash: string;
  objective: string;
  nonGoals?: string[];
  scopePaths?: string[];
  outputSchema: string;
  acceptanceTests?: string[];
  dependencies?: Array<{ logical_task_id: string; accepted_artifact_ref: string | null }>;
  projection: ToolPermissionProjection;
  autonomyPolicy: string;
  budgets: TaskAssignmentV2["budgets"];
  deadline?: string | null;
  /** Resolved decision 2 — a REUSED parent orchestrator is a `lead_binding_id` (no new lead instance). */
  leadBindingId?: string | null;
  /** …or a cell that spawns a distinct Team Lead records `team_lead_instance_id`. Exactly one. */
  teamLeadInstanceId?: string | null;
  now: () => string;
}

/** The two immutable records a dispatch emits: the assignment + its attempt companion. */
export interface TaskCell {
  assignment: TaskAssignmentV2;
  attempt: TaskAttemptV1;
}

/**
 * Build a self-contained `guild.task_assignment.v2` + its `guild.task_attempt.v1`
 * companion from a single dispatch descriptor. Reuses the contract's
 * `buildTaskAssignmentV2` (which derives the canonical channels + enforces the D4
 * lineage / lead XOR) and validates the attempt record fail-closed. THROWS on any
 * malformed input — a dispatch that cannot be built is a hard failure (D6).
 */
export function buildTaskCell(input: TaskCellDispatchInput): TaskCell {
  const assignment = buildTaskAssignmentV2({
    run_id: input.runId,
    cell_id: input.cellId,
    goal_id: input.goalId,
    phase_id: input.phaseId,
    step_id: input.stepId,
    team_id: input.teamId,
    logical_task_id: input.logicalTaskId,
    task_run_id: input.taskRunId,
    attempt: input.attempt,
    attempt_id: input.attemptId,
    previous_attempt_id: input.previousAttemptId ?? null,
    retry_reason: input.retryReason ?? null,
    instance_id: input.instanceId,
    team_lead_instance_id: input.teamLeadInstanceId ?? null,
    lead_binding_id: input.leadBindingId ?? null,
    worker_role: input.workerRole,
    specialist_type_id: input.specialistTypeId,
    specialist_type_version: input.specialistTypeVersion,
    specialist_type_hash: input.specialistTypeHash,
    specialist_profile_id: input.specialistProfileId,
    specialist_profile_hash: input.specialistProfileHash,
    context_bundle_id: input.contextBundleId,
    context_bundle_hash: input.contextBundleHash,
    host_id: input.hostId,
    adapter_id: input.adapterId,
    host_capabilities_hash: input.hostCapabilitiesHash,
    objective: input.objective,
    non_goals: input.nonGoals ?? [],
    scope_paths: input.scopePaths ?? [],
    output_schema: input.outputSchema,
    acceptance_tests: input.acceptanceTests ?? [],
    dependencies: input.dependencies ?? [],
    projection: input.projection,
    autonomy_policy: input.autonomyPolicy,
    budgets: input.budgets,
    deadline: input.deadline ?? null,
    written_at: input.now(),
  });

  // Re-validate the built assignment fail-closed — the builder cannot express the
  // full D6 field contract in the type system, so a malformed shape must be
  // caught HERE, before anything reaches disk.
  if (!validateTaskAssignmentV2(assignment)) {
    throw new Error(
      `refusing to emit a malformed guild.task_assignment.v2 for ` +
        `${input.logicalTaskId} (instance ${input.instanceId}) — fail-closed (D6)`
    );
  }

  const attemptRecord: TaskAttemptV1 = {
    schema_version: TASK_ATTEMPT_SCHEMA,
    run_id: input.runId,
    cell_id: input.cellId,
    logical_task_id: input.logicalTaskId,
    task_run_id: input.taskRunId,
    attempt: input.attempt,
    attempt_id: input.attemptId,
    previous_attempt_id: input.previousAttemptId ?? null,
    retry_reason: input.retryReason ?? null,
    instance_id: input.instanceId,
    created_at: input.now(),
    terminal_state: null,
    terminal_reason: null,
    terminated_at: null,
    immutable: false,
    orphaned: false,
    reap_attempts: 0,
  };
  if (!validateTaskAttemptV1(attemptRecord)) {
    throw new Error(
      `refusing to emit a malformed guild.task_attempt.v1 for ` +
        `${input.logicalTaskId} attempt ${input.attempt} — fail-closed (D4)`
    );
  }

  return { assignment, attempt: attemptRecord };
}

/** Resolve the on-disk absolute location of a run-tree-relative channel path under `cwd`. */
function absUnderCwd(cwd: string, relPath: string): string {
  return path.resolve(cwd, relPath);
}

/**
 * §5 fail-closed gate shared by the v2 descriptor writers (T3 F3): verify the
 * caller-threaded binding against the record's OWN run under `cwd` (the run
 * tree lives at <cwd>/.guild/runs/<run_id>). Missing, malformed, closed, or
 * mismatched bindings THROW BindingRejectedError before anything reaches disk.
 */
function assertDispatchBinding(
  cwd: string,
  runId: string,
  binding: DispatchBindingEnvelope
): void {
  const verdict = verifyRunBinding({
    root: cwd,
    run_id: runId,
    binding_ref: binding?.binding_ref,
  });
  if (verdict.ok === false) {
    throw new BindingRejectedError(verdict.reason, runId);
  }
}

/**
 * Write one immutable `guild.task_assignment.v2` at its canonical
 * `assignment_path` (resolved under `cwd`). Fail-closed:
 *   - THROWS if the assignment fails `validateTaskAssignmentV2`;
 *   - THROWS if a file already exists at the canonical path (the v1 overwrite
 *     class — assignments are immutable per instance+attempt, D6).
 * Returns the absolute path written.
 */
export function writeTaskAssignmentV2(
  cwd: string,
  assignment: TaskAssignmentV2,
  binding: DispatchBindingEnvelope
): string {
  const valid = validateTaskAssignmentV2(assignment);
  if (!valid) {
    throw new Error(
      "refusing to write a malformed guild.task_assignment.v2 — fail-closed (D6)"
    );
  }
  assertDispatchBinding(cwd, valid.run_id, binding); // §5 — no descriptor without a valid binding
  const out = absUnderCwd(cwd, valid.assignment_path);
  if (fs.existsSync(out)) {
    throw new Error(
      `assignment overwrite refused at ${valid.assignment_path} — assignments are ` +
        `immutable per (task_run_id, attempt, instance_id) (D6)`
    );
  }
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(valid, null, 2) + "\n", "utf8");
  return out;
}

/**
 * Write the `guild.task_attempt.v1` companion at its canonical `attempt_path`
 * (one immutable file per attempt, ABOVE the instances — D4). Fail-closed on a
 * malformed record. Idempotent for a single-instance attempt: writing the same
 * record twice is a no-op; a DIFFERENT record at the same path THROWS (a terminal
 * attempt is never overwritten).
 */
export function writeTaskAttemptV1(
  cwd: string,
  attempt: TaskAttemptV1,
  binding: DispatchBindingEnvelope
): string {
  const valid = validateTaskAttemptV1(attempt);
  if (!valid) {
    throw new Error(
      "refusing to write a malformed guild.task_attempt.v1 — fail-closed (D4)"
    );
  }
  assertDispatchBinding(cwd, valid.run_id, binding); // §5 — the attempt companion is bound too
  const paths = taskCellPaths({
    run_id: valid.run_id,
    logical_task_id: valid.logical_task_id,
    attempt: valid.attempt,
    instance_id: valid.instance_id,
  });
  const out = absUnderCwd(cwd, paths.attempt_path);
  const serialized = JSON.stringify(valid, null, 2) + "\n";
  if (fs.existsSync(out)) {
    if (fs.readFileSync(out, "utf8") === serialized) return out; // idempotent re-write
    throw new Error(
      `attempt record overwrite refused at ${paths.attempt_path} — a terminal ` +
        `attempt is immutable; a retry mints a new attempt (D4)`
    );
  }
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, serialized, "utf8");
  return out;
}

/**
 * Emit BOTH records for a dispatch (attempt companion first — it is the join a
 * resume reconstructs from — then the immutable assignment). Returns the two
 * absolute paths written.
 */
export function writeTaskCell(
  cwd: string,
  cell: TaskCell,
  binding: DispatchBindingEnvelope
): { assignmentPath: string; attemptPath: string } {
  const attemptPath = writeTaskAttemptV1(cwd, cell.attempt, binding);
  const assignmentPath = writeTaskAssignmentV2(cwd, cell.assignment, binding);
  return { assignmentPath, attemptPath };
}

/**
 * Production READER (pane side). Reads the `guild.task_assignment.v2` at a
 * run-tree-relative path (as carried in `GUILD_TASK_ASSIGNMENT` / a pointer) and
 * returns the validated object, or null when absent / unparseable / invalid —
 * never throws. A null return is the worker's "no valid assignment" signal; the
 * lane then fails and the worker never starts (D5/D6).
 */
export function readTaskAssignmentV2(cwd: string, assignmentPath: string): TaskAssignmentV2 | null {
  try {
    const raw = fs.readFileSync(absUnderCwd(cwd, assignmentPath), "utf8");
    return validateTaskAssignmentV2(JSON.parse(raw));
  } catch {
    return null;
  }
}

export const ASSIGNMENT_ACK_SCHEMA = "guild.assignment_ack.v1" as const;

/** The ack marker a worker writes AFTER validating its assignment and BEFORE working (D5). */
export interface AssignmentAckV1 {
  schema_version: typeof ASSIGNMENT_ACK_SCHEMA;
  run_id: string;
  logical_task_id: string;
  task_run_id: string;
  attempt: number;
  instance_id: string;
  assignment_id: string;
  acknowledged_at: string;
}

/**
 * The canonical ack-marker path for an instance: `assignment-ack.json` alongside
 * the assignment in its instance dir (inside the run tree — D6). Derived from the
 * SAME `taskCellPaths` as every other channel, so a same-run non-canonical layout
 * can never masquerade as an ack.
 */
export function assignmentAckPath(ids: {
  run_id: string;
  logical_task_id: string;
  attempt: number;
  instance_id: string;
}): string {
  const paths = taskCellPaths(ids);
  return path.join(paths.instance_dir, "assignment-ack.json");
}

/**
 * The ack primitive (D5 ack gate). The worker reads + validates its assignment,
 * then calls this to write a durable ack marker the launcher/worker can await —
 * `running` is reachable ONLY after this marker exists. Returns the absolute path
 * written; THROWS on a malformed assignment (an unvalidated assignment can never
 * be acknowledged).
 */
export function acknowledgeAssignment(
  cwd: string,
  assignment: TaskAssignmentV2,
  now: () => string
): string {
  const valid = validateTaskAssignmentV2(assignment);
  if (!valid) {
    throw new Error(
      "refusing to acknowledge a malformed guild.task_assignment.v2 — the ack gate " +
        "requires a validated assignment (D5)"
    );
  }
  const ack: AssignmentAckV1 = {
    schema_version: ASSIGNMENT_ACK_SCHEMA,
    run_id: valid.run_id,
    logical_task_id: valid.logical_task_id,
    task_run_id: valid.task_run_id,
    attempt: valid.attempt,
    instance_id: valid.instance_id,
    assignment_id: `${valid.task_run_id}:${valid.attempt}:${valid.instance_id}`,
    acknowledged_at: now(),
  };
  const rel = assignmentAckPath({
    run_id: valid.run_id,
    logical_task_id: valid.logical_task_id,
    attempt: valid.attempt,
    instance_id: valid.instance_id,
  });
  const out = absUnderCwd(cwd, rel);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(ack, null, 2) + "\n", "utf8");
  return out;
}

// ── T6 F5: production model-routing integration (M1 shadow + gated M2) ───────

/** Outcome of the per-dispatch model-routing plan on the PRODUCTION path. */
export interface ProductionDispatchModelOutcome {
  /** The (possibly v2-selected) dispatch model. At M0/M1 this is ALWAYS legacy. */
  selection: DispatchModelSelection;
  /** Provenance stamped onto the specialist dispatch contract. */
  provenance: SpecialistModelProvenance;
  /** Run-local shadow artifact paths (null when the shadow leg did not run). */
  shadowArtifacts: { receiptPath: string | null; comparisonPath: string | null };
  /** Closed-key flag violations from settings, surfaced for the caller's log. */
  flagRejects: string[];
  /**
   * T7-M4 — §6 exact-key confirmation state for THIS dispatch.
   *
   * `required: false` on every path that does not degrade (and on M0/M1, where
   * the selection is byte-identical legacy). When a v2 selection DOES carry a
   * degradation and the purpose policy sets `confirm_on_degradation`, the
   * EXACT 6-tuple (run_id, purpose, target_id, policy_hash, catalog_hash,
   * fallback_hash) claims a prompt through the T5 arbiter — so one approval can
   * never leak to a different target, purpose, or fallback shape.
   *
   * `required && !decided` means the caller MUST block this lane. Guild never
   * auto-approves a degradation.
   */
  confirmation: {
    required: boolean;
    decided: boolean;
    /** The recorded decision verb, or null when unanswered / not required. */
    decision: string | null;
    /** Stable prompt id for the exact key; null when no claim was made. */
    prompt_id: number | null;
    /** Why confirmation was (or was not) required — never silent. */
    reason: string;
  };
}

function readSettingsJson(cwd: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(path.join(cwd, ".guild", "settings.json"), "utf8"));
  } catch {
    return undefined;
  }
}

/** Discover on-record M0/M1 evidence refs in the run's own tree (gateM2 verifies each). */
function discoverM2EvidenceRefs(cwd: string, runId: string): M2EvidenceRefs {
  const runDir = path.join(cwd, ".guild", "runs", runId);
  const listJson = (sub: string, suffix: string): string[] => {
    try {
      return fs
        .readdirSync(path.join(runDir, sub))
        .filter((f) => f.endsWith(suffix))
        .map((f) => path.join(sub, f));
    } catch {
      return [];
    }
  };
  return {
    root: cwd,
    run_id: runId,
    m0: { inspection_report_refs: listJson("inspection", ".json") },
    m1: { shadow_comparison_refs: listJson("shadow", ".shadow-comparison.json") },
  };
}

/**
 * Resolver inputs sourced from the run's OWN verified M0 evidence (T6-R2-F5).
 *
 * The launcher has no catalog/session channel of its own, so without this the
 * production call could never reach a v2 selection — the resolver always failed
 * closed on `catalog_snapshot_unparsable` and M2 stayed decorative. The M2 gate
 * already REQUIRES a verified `guild.model_inspection.v1` report in the bound
 * run tree, and that report records exactly the two things the resolver needs:
 * the inspected execution target and the catalog rows it inspected. So the
 * evidence M2 gates on IS the input record — no new channel, no injectable seam.
 *
 * Honest + fail-closed:
 *   - only VERIFIED reports are read (`loadVerifiedM0Reports` — inside the run
 *     dir, schema-valid, `state: "ok"`, bound to this run, run binding ok);
 *   - a report whose catalog block is not `state: "ok"` with rows yields NO
 *     catalog (the resolver then fails closed exactly as today);
 *   - the report keeps only `canonical_id` / `tier` / `evidence_state` per row,
 *     so the reconstructed snapshot carries those plus a positional
 *     `catalog_index` (the report preserves catalog order). A policy selecting
 *     on a field the report does not record (e.g. `family:`) matches NOTHING
 *     and the resolution fails closed — never a silent substitution.
 *
 * Returns `null` when no verified report carries a usable catalog block.
 *
 * T8R/F3 — WHO WRITES THAT EVIDENCE. Until T8R this reader had no producer on
 * the real path (`persistInspectionReport` had zero production callers), so it
 * always returned null and M2 was unreachable end-to-end. The production writer
 * is now `capability/workflows/inspection-record.ts`
 * (`recordRunInspectionEvidence`), called once per run by the launcher's lane
 * model planner and inert at the ADR defaults. Its report's catalog block is
 * `state: "ok"` only when a catalog snapshot is on record for the run's target
 * identity; publishing one from a REAL bounded discovery run is still open
 * (T7-M5 / T8-F7 — only `nullIo` exists today).
 */
export function deriveResolveInputsFromM0Evidence(
  evidence: M2EvidenceRefs | null | undefined
): { session_context: unknown; catalog_snapshot: unknown } | null {
  for (const report of loadVerifiedM0Reports(evidence)) {
    const catalog = report["catalog"];
    if (typeof catalog !== "object" || catalog === null || Array.isArray(catalog)) continue;
    const catalogObj = catalog as Record<string, unknown>;
    if (catalogObj["state"] !== "ok") continue;
    const rows = catalogObj["models"];
    if (!Array.isArray(rows) || rows.length === 0) continue;
    const target = report["target"];
    const targetObj =
      typeof target === "object" && target !== null && !Array.isArray(target)
        ? (target as Record<string, unknown>)
        : {};
    const models = rows.map((r, index) => {
      const row =
        typeof r === "object" && r !== null && !Array.isArray(r)
          ? (r as Record<string, unknown>)
          : {};
      return {
        canonical_id: typeof row["canonical_id"] === "string" ? row["canonical_id"] : "unknown",
        tier: typeof row["tier"] === "string" ? row["tier"] : "unknown",
        catalog_index: index,
        evidence: {
          state: typeof row["evidence_state"] === "string" ? row["evidence_state"] : "unknown",
        },
      };
    });
    return {
      // The resolver reads `session_context.target_id` (receipt binding only).
      session_context: {
        target_id:
          typeof targetObj["target_id"] === "string" ? targetObj["target_id"] : "unknown",
      },
      catalog_snapshot: {
        target: { target_id: catalogObj["target_id"] ?? targetObj["target_id"] ?? null },
        models,
      },
    };
  }
  return null;
}

/**
 * The PRODUCTION dispatch-model step (T6-R1-F5): called by the real dispatch
 * entrypoint for EVERY task-cell attempt. It reads the rollout flags from the
 * consuming repo's `.guild/settings.json`, discovers this run's on-record
 * M0/M1 evidence (gateM2 loads + verifies each ref), and runs
 * `planDispatchModel` over the caller's inputs:
 *
 *   - M0/M1: the returned selection is the LEGACY selection byte-identical —
 *     this step changes NO routing; when `model_routing.shadow` is on it
 *     additionally persists the shadow receipt + content-hashed comparison
 *     run-local through the T3/T3b binding-verified writer (a dispatch whose
 *     binding does not verify gets NO shadow write — the same envelope gates
 *     the task-cell writers themselves);
 *   - M2 (opt-in + evidenced, verified inside gateM2): the returned selection
 *     is the v2 receipt's frozen model, with provenance hashes.
 *
 * Making v2 routing the DEFAULT remains a requires-confirmation followup; this
 * function never flips a flag.
 */
export function planProductionDispatchModel(input: {
  cwd: string;
  runId: string;
  /** Unique per task-cell attempt (e.g. the attempt_id). */
  dispatchId: string;
  binding: DispatchBindingEnvelope;
  legacy: LegacySelection;
  /** Raw settings object; when omitted, `<cwd>/.guild/settings.json` is read. */
  settings?: unknown;
  /** Optional resolver inputs — absent inputs fail closed honestly in shadow. */
  sessionContext?: unknown;
  catalogSnapshot?: unknown;
  policy?: unknown;
  request?: ResolveRequest;
}): ProductionDispatchModelOutcome {
  const settings =
    input.settings !== undefined ? input.settings : readSettingsJson(input.cwd);
  const { flags, rejects } = readRoutingFlags(settings);
  const settingsObj =
    typeof settings === "object" && settings !== null && !Array.isArray(settings)
      ? (settings as Record<string, unknown>)
      : {};
  const m2Evidence = discoverM2EvidenceRefs(input.cwd, input.runId);
  // Caller-supplied inputs always win; otherwise fall back to the run's own
  // VERIFIED M0 evidence (the same artifacts gateM2 binds to). A run with no
  // verified report keeps today's behavior exactly: null inputs → fail closed.
  const derived =
    input.sessionContext === undefined || input.catalogSnapshot === undefined
      ? deriveResolveInputsFromM0Evidence(m2Evidence)
      : null;
  const plan = planDispatchModel({
    flags,
    m2Evidence,
    resolveInputs: {
      session_context: input.sessionContext ?? derived?.session_context ?? null,
      catalog_snapshot: input.catalogSnapshot ?? derived?.catalog_snapshot ?? null,
      policy: input.policy ?? settingsObj["model_policy"] ?? null,
      request: input.request,
      run_id: input.runId,
      dispatch_id: input.dispatchId,
    },
    legacy: input.legacy,
  });
  // Persist M1 evidence through the binding-verified writer ONLY (F4): the
  // same envelope that authorizes the task-cell writers authorizes this; a
  // non-verifying binding throws BindingRejectedError before any write —
  // consistent with the hard fail-closed dispatch contract (D6/§5).
  let shadowArtifacts: ProductionDispatchModelOutcome["shadowArtifacts"] = {
    receiptPath: null,
    comparisonPath: null,
  };
  if (plan.shadow.ran) {
    shadowArtifacts = persistShadowArtifacts(input.cwd, plan.shadow, {
      run_id: input.runId,
      binding_ref: input.binding?.binding_ref,
    });
  }
  const provenance: SpecialistModelProvenance = {
    source:
      plan.selection.source === "v2" ? "v2" : plan.shadow.ran ? "v2_shadow" : "legacy",
    ...(plan.selection.dispatch_id !== undefined
      ? { dispatch_id: plan.selection.dispatch_id }
      : plan.shadow.receipt
        ? { dispatch_id: String(plan.shadow.receipt.dispatch_id) }
        : {}),
    ...(plan.selection.resolution_core_hash !== undefined
      ? { resolution_core_hash: plan.selection.resolution_core_hash }
      : plan.shadow.receipt && typeof plan.shadow.receipt.resolution_core_hash === "string"
        ? { resolution_core_hash: plan.shadow.receipt.resolution_core_hash }
        : {}),
    ...(plan.shadow.comparison
      ? { shadow_comparison_hash: plan.shadow.comparison.comparison_hash }
      : {}),
    // T6-R2-F5: the SELECTED model rides the provenance so the dispatch
    // backends can actually spawn the lane at it. Stamped ONLY for a real v2
    // selection — legacy / shadow dispatches carry no model override at all.
    ...(plan.selection.source === "v2"
      ? {
          selected_model: plan.selection.model,
          selected_effort: plan.selection.effort,
        }
      : {}),
  };
  // ── T7-M4: §6 exact-key confirmation over a v2 DEGRADATION ────────────────
  //
  // Scope, deliberately narrow and honest:
  //   - M0/M1 (source "legacy") never degrade anything — the selection IS the
  //     legacy one byte-identically — so no prompt is claimed and behavior is
  //     unchanged. This is why the wiring is inert until M2 is turned on.
  //   - A v2 selection with `outcome.degradation` set is the case §6 exists
  //     for. It claims a prompt over the EXACT 6-tuple built by
  //     `confirmationKeyForReceipt` (the canonical builder), so approval can
  //     never leak across target / purpose / policy / catalog / fallback shape.
  //   - `confirm_on_degradation` is `true` for every shipped purpose policy
  //     (model-policy.ts) and `require_cross_family` may not turn it off, so a
  //     degradation is gated unless a policy explicitly opts out.
  const receipt = plan.selection.receipt;
  const degradation = receipt?.outcome?.degradation ?? null;
  let confirmation: ProductionDispatchModelOutcome["confirmation"] = {
    required: false,
    decided: false,
    decision: null,
    prompt_id: null,
    reason:
      plan.selection.source === "v2"
        ? "v2 selection carries no degradation — nothing to confirm (§6)"
        : "legacy selection — no v2 degradation exists to confirm (§6)",
  };
  if (plan.selection.source === "v2" && receipt && degradation) {
    const confirmOnDegradation = purposeConfirmsOnDegradation(
      input.policy ?? settingsObj["model_policy"],
      receipt,
    );
    if (!confirmOnDegradation) {
      confirmation = {
        ...confirmation,
        reason:
          `v2 selection degraded (${degradation.kind}) but the purpose policy sets ` +
          "confirm_on_degradation:false — no prompt claimed",
      };
    } else {
      // A partial key throws inside the arbiter (fail closed); an unverifiable
      // binding throws before any write. Neither is swallowed here.
      const claim = claimConfirmation({
        root: input.cwd,
        binding: { run_id: input.runId, binding_ref: input.binding?.binding_ref as string },
        key: confirmationKeyForReceipt(receipt),
      });
      confirmation = {
        required: true,
        decided: claim.already_decided,
        decision: claim.decision,
        prompt_id: claim.prompt_id,
        reason:
          `v2 selection degraded (${degradation.kind}: ${degradation.note}) and the purpose policy ` +
          `requires confirmation — §6 prompt ${claim.prompt_id} claimed over the exact 6-tuple; ` +
          (claim.already_decided
            ? `already decided "${claim.decision}"`
            : "AWAITING a user decision — dispatch must block (Guild never auto-approves)"),
      };
    }
  }

  return {
    selection: plan.selection,
    provenance,
    shadowArtifacts,
    flagRejects: rejects,
    confirmation,
  };
}

/**
 * `confirm_on_degradation` for the receipt's REQUEST purpose, read from the
 * policy the resolution actually ran under. Unknown/absent policy shape ⇒
 * `true` (fail closed: an unreadable policy never silences the gate).
 */
function purposeConfirmsOnDegradation(policy: unknown, receipt: ResolutionReceipt): boolean {
  const purpose =
    typeof receipt.request === "object" && receipt.request !== null
      ? (receipt.request as Record<string, unknown>)["purpose"]
      : undefined;
  if (typeof purpose !== "string") return true;
  const purposes =
    typeof policy === "object" && policy !== null
      ? ((policy as Record<string, unknown>)["purposes"] as Record<string, unknown> | undefined)
      : undefined;
  const row = purposes?.[purpose];
  if (typeof row !== "object" || row === null) return true;
  return (row as Record<string, unknown>)["confirm_on_degradation"] !== false;
}

/** Read + validate an ack marker for an instance, or null when absent/malformed (the await primitive). */
export function readAssignmentAck(
  cwd: string,
  ids: { run_id: string; logical_task_id: string; attempt: number; instance_id: string }
): AssignmentAckV1 | null {
  try {
    const raw = fs.readFileSync(absUnderCwd(cwd, assignmentAckPath(ids)), "utf8");
    const obj = JSON.parse(raw) as Record<string, unknown>;
    if (obj["schema_version"] !== ASSIGNMENT_ACK_SCHEMA) return null;
    if (typeof obj["instance_id"] !== "string" || typeof obj["acknowledged_at"] !== "string") {
      return null;
    }
    return obj as unknown as AssignmentAckV1;
  } catch {
    return null;
  }
}
