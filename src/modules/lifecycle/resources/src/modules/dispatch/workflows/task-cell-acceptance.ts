/**
 * src/modules/dispatch/workflows/task-cell-acceptance.ts
 *
 * G4 — the ACCEPTANCE GATE + terminal-record writer (ADR `task-cell-runtime-
 * contract.md` D5). This is the deterministic engine that splits
 *
 *   handoff_submitted → handoff_validated → handoff_accepted → terminating → terminated
 *
 * into durable, auditable records and owns the ONE predicate the runtime is
 * allowed to release/terminate on. It is the I/O + gate layer over the pure G2
 * contract (`scripts/lib/core/contracts/task-cell-backend.ts`); like
 * `task-assignment-v2.ts` it owns NO schema of its own — it reuses
 * `HandoffValidationV1` / `HandoffAcceptanceV1` / `TaskAttemptV1`, the frozen
 * field lists, `outOfScopeFiles`, `assignmentId`, `releasedLogicalTasks`,
 * `dependencyGate`, and `taskCellPaths`.
 *
 * The invariants this file exists to make unfakeable (D5):
 *
 *   1. A receipt on disk releases NOTHING. Dependency release + termination read
 *      a durable `guild.handoff_acceptance.v1`, never receipt existence
 *      (`isDownstreamReleased` / `isTerminationAuthorized` / `releasedLogicalTasks`).
 *   2. A receipt that fails the DETERMINISTIC FLOOR (`runDeterministicFloor`) can
 *      never be accepted — `buildAcceptance` throws on a non-passing validation.
 *   3. Every required acceptance authority must be observed as `accepted` before an
 *      acceptance record is built (resolved decision 3 — no rubber-stamp).
 *   4. A forced/rejected teardown writes an EXPLICIT rejection/failure terminal
 *      event, never a silent kill (`buildRejection` + `sealTerminalAttempt`).
 *   5. A teardown that FAILS parks the attempt `orphaned` (still non-terminal) for
 *      the reaper (`markAttemptOrphaned`); only a confirmed kill seals `terminated`.
 *   6. Terminal attempts are IMMUTABLE — `sealTerminalAttempt` refuses to rewrite a
 *      terminal decision to a different state (D4).
 */

import * as fs from "fs";
import * as path from "path";
import { createHash } from "node:crypto";

import {
  hasCanonicalReceiptWrapper,
  readReceiptFrontmatter,
  validateFrozenReceiptDocument,
} from "../../documents";

import {
  HANDOFF_ACCEPTANCE_SCHEMA,
  HANDOFF_VALIDATION_SCHEMA,
  assignmentId,
  dependencyGate,
  outOfScopeFiles,
  releasedLogicalTasks,
  taskCellPaths,
  validateAgentInstanceV1,
  validateTaskAttemptV1,
  type AcceptanceAuthority,
  type AssignmentDependency,
  type AuthorityDecision,
  type DependencyGateResult,
  type HandoffAcceptanceV1,
  type HandoffValidationV1,
  type SubmittedHandoff,
  type TaskAssignmentV2,
  type TaskAttemptV1,
  type TerminalState,
} from "./task-cell-contract";
import {
  TASK_CELL_TERMINAL_SCHEMA,
  publishTaskCellFile,
  type TaskCellArtifactKind,
} from "./task-cell-artifact-join";

// ── Path ids the run-tree records are keyed by (D6) ──────────────────────────

export interface TaskCellInstanceIds {
  run_id: string;
  logical_task_id: string;
  attempt: number;
  instance_id: string;
}

function receiptPathsForAssignment(assignment: TaskAssignmentV2): {
  lane: string;
  retained: string;
} {
  return {
    lane: `.guild/runs/${assignment.run_id}/handoffs/${assignment.worker_role}-${assignment.logical_task_id}.md`,
    retained: taskCellPaths({
      run_id: assignment.run_id,
      logical_task_id: assignment.logical_task_id,
      attempt: assignment.attempt,
      instance_id: assignment.instance_id,
    }).receipt_path,
  };
}

function submittedReceiptBytes(input: {
  cwd: string;
  assignment: TaskAssignmentV2;
  submitted: SubmittedHandoff;
}): Buffer | null {
  const { cwd, assignment, submitted } = input;
  if (
    typeof submitted.receipt_path !== "string" ||
    typeof submitted.receipt_id !== "string" ||
    !Array.isArray(submitted.claimed_changed_files) ||
    !submitted.claimed_changed_files.every((value) => typeof value === "string") ||
    !Array.isArray(submitted.acceptance_tests_passed) ||
    !submitted.acceptance_tests_passed.every((value) => typeof value === "string")
  ) return null;
  const expected = receiptPathsForAssignment(assignment);
  if (
    (submitted.receipt_path !== expected.lane && submitted.receipt_path !== expected.retained) ||
    path.posix.normalize(submitted.receipt_path) !== submitted.receipt_path
  ) return null;
  const absolute = path.resolve(cwd, submitted.receipt_path);
  if (!absolute.startsWith(`${path.resolve(cwd)}${path.sep}`)) return null;
  try {
    const stat = fs.lstatSync(absolute);
    if (!stat.isFile() || stat.isSymbolicLink()) return null;
    return fs.readFileSync(absolute);
  } catch {
    return null;
  }
}

/**
 * Recompute the worker's `schema_valid` claim from the immutable receipt bytes.
 * The pointer must bind to this assignment's canonical lane path and the
 * frozen frontmatter identities; a readable legacy receipt is deliberately
 * not schema-valid at a new TaskCell acceptance boundary.
 */
export function validateSubmittedHandoffReceipt(input: {
  cwd: string;
  assignment: TaskAssignmentV2;
  submitted: SubmittedHandoff;
}): boolean {
  const { cwd, assignment, submitted } = input;
  const rawBytes = submittedReceiptBytes(input);
  if (rawBytes === null) return false;
  if (submitted.receipt_id !== `handoff-sha256:${createHash("sha256").update(rawBytes).digest("hex")}`) return false;
  const text = rawBytes.toString("utf8");
  if (
    validateFrozenReceiptDocument(text).status !== "parsed" ||
    !hasCanonicalReceiptWrapper(text)
  ) return false;
  const frontmatter = readReceiptFrontmatter(text);
  if (!frontmatter.ok) return false;
  const document = frontmatter.document;
  const ids = document.ids as Record<string, unknown> | null;
  const host = document.host as Record<string, unknown> | null;
  if (!ids || typeof ids !== "object" || Array.isArray(ids) || !host || typeof host !== "object" || Array.isArray(host)) return false;
  if (
    ids.run_id !== assignment.run_id ||
    ids.task_id !== assignment.logical_task_id ||
    ids.task_run_id !== assignment.task_run_id ||
    document.specialist !== assignment.worker_role ||
    host.selected !== assignment.host_id
  ) return false;
  const changedFiles = Array.isArray(document.changed_files)
    ? document.changed_files.flatMap((value) => {
        const entry = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
        return typeof entry?.path === "string" ? [entry.path] : [];
      }).sort()
    : [];
  return JSON.stringify(changedFiles) === JSON.stringify([...submitted.claimed_changed_files].sort());
}

/**
 * Snapshot validated lane receipt bytes into the immutable attempt/instance tree.
 * A later retry may update the human-facing lane file, but can never overwrite
 * evidence already bound to an earlier validation or acceptance record.
 */
export function retainSubmittedHandoffReceipt(input: {
  cwd: string;
  assignment: TaskAssignmentV2;
  submitted: SubmittedHandoff;
}): SubmittedHandoff | null {
  if (!validateSubmittedHandoffReceipt(input)) return null;
  const rawBytes = submittedReceiptBytes(input);
  if (rawBytes === null) return null;
  const retainedPath = receiptPathsForAssignment(input.assignment).retained;
  const retainedAbsolute = path.resolve(input.cwd, retainedPath);
  try {
    fs.mkdirSync(path.dirname(retainedAbsolute), { recursive: true });
    fs.writeFileSync(retainedAbsolute, rawBytes, { flag: "wx" });
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error
      ? String((error as { code?: unknown }).code)
      : null;
    if (code !== "EEXIST") return null;
    try {
      const stat = fs.lstatSync(retainedAbsolute);
      if (!stat.isFile() || stat.isSymbolicLink() || !fs.readFileSync(retainedAbsolute).equals(rawBytes)) return null;
    } catch {
      return null;
    }
  }
  const retained = { ...input.submitted, receipt_path: retainedPath };
  return validateSubmittedHandoffReceipt({ ...input, submitted: retained }) ? retained : null;
}

/** Resolve a run-tree-relative channel path (as the contract emits) to an on-disk path under `cwd`. */
function absUnderCwd(cwd: string, relPath: string): string {
  return path.resolve(cwd, relPath);
}

function publishLifecycleFile(args: {
  cwd: string;
  ids: TaskCellInstanceIds;
  kind: TaskCellArtifactKind;
  relativePath: string;
  at: string;
  required?: boolean;
}): void {
  const instance = (() => {
    try {
      const p = taskCellPaths(args.ids);
      return validateAgentInstanceV1(JSON.parse(fs.readFileSync(absUnderCwd(args.cwd, p.instance_path), "utf8")));
    } catch {
      return null;
    }
  })();
  const published = publishTaskCellFile({
    cwd: args.cwd,
    ids: args.ids,
    kind: args.kind,
    relativePath: args.relativePath,
    hostId: instance?.host_id ?? "unknown-host",
    role: "task-cell-runtime",
    now: () => args.at,
  });
  if ((args.required ?? true) && published === null) {
    throw new Error(`artifact-bus publish failed for ${args.kind}:${args.relativePath}`);
  }
}

// ── handoff_submitted → handoff_validated · the DETERMINISTIC FLOOR ──────────

export interface DeterministicFloorInput {
  assignment: TaskAssignmentV2;
  submitted: SubmittedHandoff;
  /** A unique id for this validation result (the caller mints it deterministically). */
  validationResultId: string;
  now: () => string;
}

/**
 * The deterministic floor (D5). PURE, mechanical, host-neutral — never a model
 * judgement. Identical logic to the conformance double's `collectHandoff` floor:
 * the receipt must be schema-valid, its claimed changed-files must trace to the
 * assignment's `scope_paths`, and every acceptance test the assignment names must
 * be reported passing. Its outcome is a durable `guild.handoff_validation.v1`.
 *
 * A `result: "failed"` validation is STILL a durable record — a rejected receipt
 * leaves a trace, and it can never be accepted (`buildAcceptance` enforces that).
 */
export function runDeterministicFloor(input: DeterministicFloorInput): HandoffValidationV1 {
  const { assignment, submitted } = input;

  const out_of_scope_files = outOfScopeFiles(
    assignment.scope_paths,
    submitted.claimed_changed_files,
  );
  const failed_acceptance_tests = assignment.acceptance_tests.filter(
    (t) => !submitted.acceptance_tests_passed.includes(t),
  );

  const schema_valid = submitted.schema_valid;
  const scope_valid = out_of_scope_files.length === 0;
  const tests_passed = failed_acceptance_tests.length === 0;
  const passed = schema_valid && scope_valid && tests_passed;

  return {
    schema_version: HANDOFF_VALIDATION_SCHEMA,
    validation_result_id: input.validationResultId,
    run_id: assignment.run_id,
    cell_id: assignment.cell_id,
    logical_task_id: assignment.logical_task_id,
    task_run_id: assignment.task_run_id,
    attempt: assignment.attempt,
    instance_id: assignment.instance_id,
    assignment_id: assignmentId(assignment),
    receipt_id: submitted.receipt_id,
    schema_valid,
    scope_valid,
    tests_passed,
    out_of_scope_files,
    failed_acceptance_tests,
    result: passed ? "passed" : "failed",
    reason: passed
      ? null
      : [
          schema_valid ? null : "receipt is not a schema-valid guild.handoff_receipt.v1",
          scope_valid ? null : `changed files outside scope: ${out_of_scope_files.join(", ")}`,
          tests_passed
            ? null
            : `acceptance tests not passed: ${failed_acceptance_tests.join(", ")}`,
        ]
          .filter(Boolean)
          .join("; "),
    validated_at: input.now(),
  };
}

/**
 * Persist a `guild.handoff_validation.v1` at its canonical instance-dir path
 * (D6 run-tree containment). Idempotent for the same result; a DIFFERENT record at
 * the same path THROWS — a validation result is written once.
 */
export function writeValidationRecord(cwd: string, validation: HandoffValidationV1): string {
  if (validation.schema_version !== HANDOFF_VALIDATION_SCHEMA) {
    throw new Error("refusing to write a non-guild.handoff_validation.v1 record");
  }
  const paths = taskCellPaths({
    run_id: validation.run_id,
    logical_task_id: validation.logical_task_id,
    attempt: validation.attempt,
    instance_id: validation.instance_id,
  });
  const out = absUnderCwd(cwd, paths.validation_path);
  const serialized = JSON.stringify(validation, null, 2) + "\n";
  if (fs.existsSync(out)) {
    if (fs.readFileSync(out, "utf8") === serialized) return out;
    throw new Error(
      `validation record overwrite refused at ${paths.validation_path} — a deterministic-floor ` +
        `result is written once per (task_run_id, attempt, instance_id)`,
    );
  }
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, serialized, "utf8");
  const ids = {
    run_id: validation.run_id,
    logical_task_id: validation.logical_task_id,
    attempt: validation.attempt,
    instance_id: validation.instance_id,
  };
  publishLifecycleFile({ cwd, ids, kind: "handoff", relativePath: paths.handoff_path, at: validation.validated_at, required: false });
  publishLifecycleFile({ cwd, ids, kind: "validation", relativePath: paths.validation_path, at: validation.validated_at });
  return out;
}

// ── handoff_validated → handoff_accepted · the AUTHORITY decision ────────────

export interface AcceptanceInput {
  validation: HandoffValidationV1;
  acceptancePolicyVersion: string;
  authoritiesRequired: AcceptanceAuthority[];
  authoritiesObserved: AuthorityDecision[];
  reviewerCellId?: string | null;
  now: () => string;
}

/**
 * Build a `guild.handoff_acceptance.v1` that RELEASES downstream + authorizes
 * termination. Fail-closed (mirrors the conformance double's `acceptHandoff`):
 *   - THROWS unless the validation passed the deterministic floor (a failed floor
 *     can never be accepted — D5, adversarial test 5);
 *   - THROWS unless every REQUIRED authority is observed as `accepted` (resolved
 *     decision 3 — no rubber-stamp).
 * Both `downstream_release_at` and `termination_authorized_at` are set: an accepted
 * lane releases its dependents AND its worker may be torn down.
 */
export function buildAcceptance(input: AcceptanceInput): HandoffAcceptanceV1 {
  const { validation } = input;
  if (validation.result !== "passed") {
    throw new Error(
      `refusing to accept a receipt whose deterministic floor did not pass ` +
        `(validation ${validation.validation_result_id} result=${validation.result}) — D5`,
    );
  }
  const missing = input.authoritiesRequired.filter(
    (a) =>
      !input.authoritiesObserved.some((o) => o.authority === a && o.decision === "accepted"),
  );
  if (missing.length > 0) {
    throw new Error(
      `acceptance authorities not satisfied: ${missing.join(", ")} — no rubber-stamp (D5)`,
    );
  }
  const at = input.now();
  return acceptanceRecord(input, at, at);
}

export interface RejectionInput extends AcceptanceInput {
  reason: string;
}

/**
 * Build a REJECTING `guild.handoff_acceptance.v1`. The record is DURABLE, not a
 * silent kill (D5): `downstream_release_at` is null (dependents stay BLOCKED,
 * adversarial test 8) while `termination_authorized_at` IS set — a rejected worker
 * is terminated with an explicit rejection terminal event, never silently killed.
 */
export function buildRejection(input: RejectionInput): HandoffAcceptanceV1 {
  const at = input.now();
  return acceptanceRecord(input, /* downstream_release_at */ null, /* termination_authorized_at */ at);
}

function acceptanceRecord(
  input: AcceptanceInput,
  downstream_release_at: string | null,
  termination_authorized_at: string | null,
): HandoffAcceptanceV1 {
  const v = input.validation;
  return {
    schema_version: HANDOFF_ACCEPTANCE_SCHEMA,
    run_id: v.run_id,
    cell_id: v.cell_id,
    logical_task_id: v.logical_task_id,
    task_run_id: v.task_run_id,
    attempt: v.attempt,
    instance_id: v.instance_id,
    assignment_id: v.assignment_id,
    receipt_id: v.receipt_id,
    validation_result_id: v.validation_result_id,
    acceptance_policy_version: input.acceptancePolicyVersion,
    authorities_required: [...input.authoritiesRequired],
    authorities_observed: input.authoritiesObserved.map((o) => ({ ...o })),
    reviewer_cell_id: input.reviewerCellId ?? null,
    downstream_release_at,
    termination_authorized_at,
  };
}

/**
 * Persist a `guild.handoff_acceptance.v1` at its canonical instance-dir path. This
 * is the ONLY record that releases downstream / authorizes termination, so it is
 * written once — a differing record at the same path THROWS.
 */
export function writeAcceptanceRecord(cwd: string, acceptance: HandoffAcceptanceV1): string {
  if (acceptance.schema_version !== HANDOFF_ACCEPTANCE_SCHEMA) {
    throw new Error("refusing to write a non-guild.handoff_acceptance.v1 record");
  }
  const paths = taskCellPaths({
    run_id: acceptance.run_id,
    logical_task_id: acceptance.logical_task_id,
    attempt: acceptance.attempt,
    instance_id: acceptance.instance_id,
  });
  const out = absUnderCwd(cwd, paths.acceptance_path);
  const serialized = JSON.stringify(acceptance, null, 2) + "\n";
  if (fs.existsSync(out)) {
    if (fs.readFileSync(out, "utf8") === serialized) return out;
    throw new Error(
      `acceptance record overwrite refused at ${paths.acceptance_path} — the authority ` +
        `decision is written once per (task_run_id, attempt, instance_id) (D5)`,
    );
  }
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, serialized, "utf8");
  publishLifecycleFile({
    cwd,
    ids: {
      run_id: acceptance.run_id,
      logical_task_id: acceptance.logical_task_id,
      attempt: acceptance.attempt,
      instance_id: acceptance.instance_id,
    },
    kind: "acceptance",
    relativePath: paths.acceptance_path,
    at: acceptance.termination_authorized_at ?? acceptance.downstream_release_at ?? "1970-01-01T00:00:00.000Z",
  });
  return out;
}

// ── The release / termination predicate — reads the RECORD, never a receipt ──

/** Downstream may proceed only when the acceptance carries a `downstream_release_at` (D5). */
export function isDownstreamReleased(a: HandoffAcceptanceV1): boolean {
  return a.downstream_release_at !== null;
}

/**
 * The worker may be terminated only when a durable acceptance carries a
 * `termination_authorized_at` (accepted OR explicitly rejected — both authorize a
 * teardown, but a rejection writes a rejection terminal event). D5.
 */
export function isTerminationAuthorized(a: HandoffAcceptanceV1): boolean {
  return a.termination_authorized_at !== null;
}

/** Gate a dispatch's dependencies on their upstreams' ACCEPTANCE records (never receipts). */
export function gateDependencies(
  dependencies: readonly AssignmentDependency[],
  acceptances: readonly HandoffAcceptanceV1[],
): DependencyGateResult {
  return dependencyGate(dependencies, acceptances);
}

export { releasedLogicalTasks };

// ── Run-tree discovery (D7 — auditable without chat transcripts) ─────────────

/** Read + validate the acceptance record for one instance, or null when absent/malformed. */
export function readAcceptanceForInstance(
  cwd: string,
  ids: TaskCellInstanceIds,
): HandoffAcceptanceV1 | null {
  const paths = taskCellPaths(ids);
  try {
    const raw = fs.readFileSync(absUnderCwd(cwd, paths.acceptance_path), "utf8");
    const obj = JSON.parse(raw) as Record<string, unknown>;
    if (obj["schema_version"] !== HANDOFF_ACCEPTANCE_SCHEMA) return null;
    return obj as unknown as HandoffAcceptanceV1;
  } catch {
    return null;
  }
}

/** Read + validate the sibling assignment for an instance (carries `worker_role`), or null. */
export function readAssignmentForInstance(
  cwd: string,
  ids: TaskCellInstanceIds,
): TaskAssignmentV2 | null {
  const paths = taskCellPaths(ids);
  try {
    const raw = fs.readFileSync(absUnderCwd(cwd, paths.assignment_path), "utf8");
    const obj = JSON.parse(raw) as Record<string, unknown>;
    if (obj["schema_version"] !== "guild.task_assignment.v2") return null;
    return obj as unknown as TaskAssignmentV2;
  } catch {
    return null;
  }
}

/** Read + validate the sibling attempt companion for an instance, or null. */
export function readAttemptForInstance(
  cwd: string,
  ids: TaskCellInstanceIds,
): TaskAttemptV1 | null {
  const paths = taskCellPaths(ids);
  try {
    const raw = fs.readFileSync(absUnderCwd(cwd, paths.attempt_path), "utf8");
    return validateTaskAttemptV1(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** One acceptance record plus the ids that locate it in the run tree. */
export interface RunAcceptance {
  ids: TaskCellInstanceIds;
  acceptance: HandoffAcceptanceV1;
}

/**
 * Walk `.guild/runs/<runId>/task-cells/**` and return every durable
 * `guild.handoff_acceptance.v1` found, keyed by its instance ids. This is what the
 * launcher's dismiss path and the teammate-idle hook read to decide whether a lane
 * is safe to terminate/dismiss — the acceptance RECORD, never receipt existence.
 * Best-effort + non-throwing: a missing/garbled tree yields [].
 */
export function findRunAcceptances(cwd: string, runId: string): RunAcceptance[] {
  const cellsRoot = path.join(cwd, ".guild", "runs", runId, "task-cells");
  const out: RunAcceptance[] = [];
  let logicalTaskDirs: string[];
  try {
    logicalTaskDirs = fs.readdirSync(cellsRoot);
  } catch {
    return out;
  }
  for (const logical_task_id of logicalTaskDirs) {
    const attemptsRoot = path.join(cellsRoot, logical_task_id, "attempts");
    let attemptDirs: string[];
    try {
      attemptDirs = fs.readdirSync(attemptsRoot);
    } catch {
      continue;
    }
    for (const attemptStr of attemptDirs) {
      const attempt = Number.parseInt(attemptStr, 10);
      if (!Number.isInteger(attempt) || attempt < 1) continue;
      const instancesRoot = path.join(attemptsRoot, attemptStr, "instances");
      let instanceDirs: string[];
      try {
        instanceDirs = fs.readdirSync(instancesRoot);
      } catch {
        continue;
      }
      for (const instance_id of instanceDirs) {
        const ids: TaskCellInstanceIds = { run_id: runId, logical_task_id, attempt, instance_id };
        const acceptance = readAcceptanceForInstance(cwd, ids);
        if (acceptance) out.push({ ids, acceptance });
      }
    }
  }
  return out;
}

// ── terminating → terminated · the terminal-attempt record (D4) ──────────────

export interface SealTerminalInput {
  cwd: string;
  ids: TaskCellInstanceIds;
  terminal_state: TerminalState;
  reason: string | null;
  /** Historical fact — this instance outlived a kill and needed the reaper (adversarial test 6). */
  orphaned?: boolean;
  reapAttempts?: number;
  now: () => string;
}

/**
 * Seal the `guild.task_attempt.v1` companion to a TERMINAL state (D4). Reads the
 * existing non-terminal attempt record (written at dispatch by
 * `writeTaskAttemptV1`), stamps the terminal decision, and rewrites it. Fail-closed:
 *   - THROWS when no attempt record exists (nothing to seal — D6 containment broke);
 *   - a terminal decision is IMMUTABLE: re-sealing to the SAME state only appends
 *     reaper bookkeeping (`orphaned` / `reap_attempts`); re-sealing to a DIFFERENT
 *     state THROWS (a retry must mint a new attempt).
 */
export function sealTerminalAttempt(input: SealTerminalInput): TaskAttemptV1 {
  const paths = taskCellPaths(input.ids);
  const out = absUnderCwd(input.cwd, paths.attempt_path);

  let existing: TaskAttemptV1 | null = null;
  try {
    existing = validateTaskAttemptV1(JSON.parse(fs.readFileSync(out, "utf8")));
  } catch {
    existing = null;
  }
  if (!existing) {
    throw new Error(
      `cannot seal a terminal attempt at ${paths.attempt_path} — no valid ` +
        `guild.task_attempt.v1 companion exists (D6 run-tree containment)`,
    );
  }
  if (existing.immutable && existing.terminal_state !== null) {
    if (existing.terminal_state !== input.terminal_state) {
      throw new Error(
        `terminal attempt ${existing.attempt_id} is immutable — cannot re-terminate ` +
          `(${existing.terminal_state} → ${input.terminal_state}); a retry mints a new attempt (D4)`,
      );
    }
    // Same terminal state — append reaper bookkeeping only (orphan/reap history).
    const bookkept: TaskAttemptV1 = {
      ...existing,
      orphaned: input.orphaned ?? existing.orphaned,
      reap_attempts: input.reapAttempts ?? existing.reap_attempts,
    };
    return writeTerminalArtifacts(input, paths, writeSealed(out, paths.attempt_path, bookkept));
  }

  const sealed: TaskAttemptV1 = {
    ...existing,
    terminal_state: input.terminal_state,
    terminal_reason: input.reason,
    terminated_at: input.now(),
    immutable: true,
    orphaned: input.orphaned ?? existing.orphaned,
    reap_attempts: input.reapAttempts ?? existing.reap_attempts,
  };
  return writeTerminalArtifacts(input, paths, writeSealed(out, paths.attempt_path, sealed));
}

function writeTerminalArtifacts(
  input: SealTerminalInput,
  paths: ReturnType<typeof taskCellPaths>,
  attempt: TaskAttemptV1,
): TaskAttemptV1 {
  const terminatedAt = attempt.terminated_at ?? input.now();
  const instanceAbs = absUnderCwd(input.cwd, paths.instance_path);
  const instance = (() => {
    try {
      return validateAgentInstanceV1(JSON.parse(fs.readFileSync(instanceAbs, "utf8")));
    } catch {
      return null;
    }
  })();
  if (!instance) {
    throw new Error(`cannot seal terminal TaskCell — no valid guild.agent_instance.v1 at ${paths.instance_path}`);
  }
  if (instance.terminal_state !== null && instance.terminal_state !== attempt.terminal_state) {
    throw new Error(
      `agent instance ${instance.instance_id} is terminal and immutable (${instance.terminal_state} -> ${attempt.terminal_state})`,
    );
  }
  const sealedInstance = validateAgentInstanceV1({
    ...instance,
    terminated_at: terminatedAt,
    terminal_state: attempt.terminal_state,
    terminal_reason: attempt.terminal_reason,
  });
  if (!sealedInstance) throw new Error("refusing to write malformed terminal guild.agent_instance.v1");
  fs.writeFileSync(instanceAbs, JSON.stringify(sealedInstance, null, 2) + "\n", "utf8");

  const terminal = {
    schema_version: TASK_CELL_TERMINAL_SCHEMA,
    run_id: attempt.run_id,
    cell_id: attempt.cell_id,
    logical_task_id: attempt.logical_task_id,
    task_run_id: attempt.task_run_id,
    attempt: attempt.attempt,
    attempt_id: attempt.attempt_id,
    instance_id: attempt.instance_id,
    terminal_state: attempt.terminal_state,
    reason: attempt.terminal_reason,
    terminated_at: terminatedAt,
    orphaned: attempt.orphaned,
    reap_attempts: attempt.reap_attempts,
  };
  fs.writeFileSync(absUnderCwd(input.cwd, paths.terminal_path), JSON.stringify(terminal, null, 2) + "\n", "utf8");
  publishLifecycleFile({ cwd: input.cwd, ids: input.ids, kind: "attempt", relativePath: paths.attempt_path, at: terminatedAt });
  publishLifecycleFile({ cwd: input.cwd, ids: input.ids, kind: "instance", relativePath: paths.instance_path, at: terminatedAt });
  publishLifecycleFile({ cwd: input.cwd, ids: input.ids, kind: "terminal", relativePath: paths.terminal_path, at: terminatedAt });
  return attempt;
}

/**
 * Mark an attempt ORPHANED without sealing it terminal (adversarial test 6): a
 * teardown that FAILED leaves the instance parked (still non-terminal) for the
 * reaper. Bumps `reap_attempts`. The attempt reaches `terminated` only when a
 * later confirmed kill calls `sealTerminalAttempt`.
 */
export function markAttemptOrphaned(
  cwd: string,
  ids: TaskCellInstanceIds,
): TaskAttemptV1 {
  const paths = taskCellPaths(ids);
  const out = absUnderCwd(cwd, paths.attempt_path);
  let existing: TaskAttemptV1 | null = null;
  try {
    existing = validateTaskAttemptV1(JSON.parse(fs.readFileSync(out, "utf8")));
  } catch {
    existing = null;
  }
  if (!existing) {
    throw new Error(
      `cannot mark orphaned at ${paths.attempt_path} — no valid guild.task_attempt.v1 companion`,
    );
  }
  if (existing.immutable && existing.terminal_state !== null) {
    // Already terminal — an orphan flag here is a no-op; the record is sealed.
    return existing;
  }
  const orphaned: TaskAttemptV1 = {
    ...existing,
    orphaned: true,
    reap_attempts: existing.reap_attempts + 1,
  };
  const written = writeSealed(out, paths.attempt_path, orphaned);
  publishLifecycleFile({
    cwd,
    ids,
    kind: "attempt",
    relativePath: paths.attempt_path,
    at: new Date().toISOString(),
  });
  return written;
}

function writeSealed(absPath: string, relLabel: string, record: TaskAttemptV1): TaskAttemptV1 {
  const valid = validateTaskAttemptV1(record);
  if (!valid) {
    throw new Error(`refusing to write a malformed guild.task_attempt.v1 at ${relLabel} (D4)`);
  }
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, JSON.stringify(valid, null, 2) + "\n", "utf8");
  return valid;
}

// ── run-tree enumerators (shared walk) ───────────────────────────────────────

/**
 * Walk `.guild/runs/<runId>/task-cells/**` and return the ids of EVERY instance
 * directory found (with or without an acceptance). Shared tree-walk for the
 * enumerators below. Best-effort + non-throwing: a missing/garbled tree yields [].
 */
function walkRunInstanceIds(cwd: string, runId: string): TaskCellInstanceIds[] {
  const cellsRoot = path.join(cwd, ".guild", "runs", runId, "task-cells");
  const out: TaskCellInstanceIds[] = [];
  let logicalTaskDirs: string[];
  try {
    logicalTaskDirs = fs.readdirSync(cellsRoot);
  } catch {
    return out;
  }
  for (const logical_task_id of logicalTaskDirs) {
    const attemptsRoot = path.join(cellsRoot, logical_task_id, "attempts");
    let attemptDirs: string[];
    try {
      attemptDirs = fs.readdirSync(attemptsRoot);
    } catch {
      continue;
    }
    for (const attemptStr of attemptDirs) {
      const attempt = Number.parseInt(attemptStr, 10);
      if (!Number.isInteger(attempt) || attempt < 1) continue;
      const instancesRoot = path.join(attemptsRoot, attemptStr, "instances");
      let instanceDirs: string[];
      try {
        instanceDirs = fs.readdirSync(instancesRoot);
      } catch {
        continue;
      }
      for (const instance_id of instanceDirs) {
        out.push({ run_id: runId, logical_task_id, attempt, instance_id });
      }
    }
  }
  return out;
}

/** One task-cell instance plus the specialist (`worker_role`) that owns it. */
export interface RunTaskCell {
  ids: TaskCellInstanceIds;
  worker_role: string | null;
}

/**
 * Every task-cell instance in a run, tagged with the specialist that owns it.
 * The launcher's dismiss path uses this to decide when it is SAFE to kill a
 * SHARED per-specialist pane (G4 M2): only when EVERY task-cell that specialist
 * owns has reached a terminal acceptance/rejection — otherwise a kill triggered by
 * one accepted task would destroy the specialist's other still-running tasks in the
 * same pane. Best-effort + non-throwing.
 */
export function findRunTaskCells(cwd: string, runId: string): RunTaskCell[] {
  return walkRunInstanceIds(cwd, runId).map((ids) => ({
    ids,
    worker_role: readAssignmentForInstance(cwd, ids)?.worker_role ?? null,
  }));
}

/**
 * Every attempt currently PARKED orphaned — a teardown that failed to confirm the
 * pane's death (`orphaned: true`, still non-terminal). The `--reap` sweep
 * re-attempts termination on these and seals them to `terminated` once the pane is
 * confirmed gone (G4 M1 / adversarial test 6). Best-effort + non-throwing.
 */
export function findOrphanedAttempts(cwd: string, runId: string): TaskCellInstanceIds[] {
  return walkRunInstanceIds(cwd, runId).filter((ids) => {
    const a = readAttemptForInstance(cwd, ids);
    return !!a && a.orphaned === true && a.terminal_state === null;
  });
}
