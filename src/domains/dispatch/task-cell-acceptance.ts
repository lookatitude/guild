/**
 * src/domains/dispatch/task-cell-acceptance.ts
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
  assertWritableBinding,
  hasCanonicalReceiptWrapper,
  readReceiptFrontmatter,
  validateFrozenReceiptDocument,
} from "../lifecycle";
import type { DispatchBindingEnvelope } from "./task-assignment";
import {
  checkContained,
  isRefused,
  prepareContainedWrite,
} from "../kernel";

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
import { durableGuildDir } from "../state";
import { casGet, readBusLog, sha256 as busSha256 } from "./artifact-bus";

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

function receiptChangedFiles(document: Record<string, unknown>): string[] {
  return Array.isArray(document.changed_files)
    ? document.changed_files.flatMap((value) => {
        const entry = value && typeof value === "object" && !Array.isArray(value)
          ? value as Record<string, unknown>
          : null;
        return typeof entry?.path === "string" ? [entry.path] : [];
      })
    : [];
}

function passedEvidenceRefs(document: Record<string, unknown>): Set<string> {
  const refs = Array.isArray(document.evidence)
    ? document.evidence.flatMap((value) => {
        const entry = value && typeof value === "object" && !Array.isArray(value)
          ? value as Record<string, unknown>
          : null;
        return (
          entry !== null &&
          (entry.kind === "test" || entry.kind === "command") &&
          entry.result === "pass" &&
          typeof entry.ref === "string"
        ) ? [entry.ref] : [];
      })
    : [];
  return new Set(refs);
}

function physicallyContainedFileBytes(cwd: string, target: string): Buffer | null {
  const contained = checkContained(cwd, target, {
    policy: "physical",
    requireRegularFileLeaf: true,
  });
  if (isRefused(contained)) return null;
  try {
    return fs.readFileSync(contained.realPath);
  } catch {
    return null;
  }
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
  return physicallyContainedFileBytes(cwd, submitted.receipt_path);
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
  const changedFiles = receiptChangedFiles(document).sort();
  const passedRefs = passedEvidenceRefs(document);
  const derivedPassedTests = assignment.acceptance_tests.filter((test) => passedRefs.has(test));
  return (
    JSON.stringify(changedFiles) === JSON.stringify([...submitted.claimed_changed_files].sort()) &&
    JSON.stringify(derivedPassedTests) === JSON.stringify(submitted.acceptance_tests_passed)
  );
}

/**
 * Publish the immutable six-field `SubmittedHandoff` pointer after the worker's
 * canonical markdown receipt has been validated and scrubbed. Workers author the
 * receipt; the code-owned TaskCompleted boundary owns hashing and pointer shape.
 * Test claims are copied only from exact passing `test`/`command` evidence refs.
 */
export function publishSubmittedHandoffPointer(input: {
  cwd: string;
  assignment: TaskAssignmentV2;
  submittedAt: string;
  /** The caller's verified run binding (CD10); absent or invalid throws BindingRejectedError. */
  binding?: DispatchBindingEnvelope;
}): SubmittedHandoff | null {
  const published = publishPointer(input, null);
  return published.ok ? published.submitted : null;
}

/**
 * Module-internal (deliberately not a dispatch index export): publish the pointer for
 * exactly `scannedBytes`, the receipt bytes the controller already checked. When the
 * contained lane bytes no longer equal them, nothing is written (receipt_changed); an
 * existing pointer is never replaced.
 */
export function publishScannedHandoffPointer(input: {
  cwd: string;
  assignment: TaskAssignmentV2;
  submittedAt: string;
  binding: DispatchBindingEnvelope;
  scannedBytes: Buffer;
}): { ok: true; submitted: SubmittedHandoff } | { ok: false; reason: "receipt_changed" | "refused" } {
  return publishPointer(input, input.scannedBytes);
}

function publishPointer(
  input: { cwd: string; assignment: TaskAssignmentV2; submittedAt: string; binding?: DispatchBindingEnvelope },
  scanned: Buffer | null,
): { ok: true; submitted: SubmittedHandoff } | { ok: false; reason: "receipt_changed" | "refused" } {
  const { cwd, assignment, submittedAt } = input;
  requireWritableBinding(cwd, assignment.run_id, input.binding);
  const refused = { ok: false as const, reason: "refused" as const };
  const changed = { ok: false as const, reason: "receipt_changed" as const };
  const parsedAt = Date.parse(submittedAt);
  if (!Number.isFinite(parsedAt) || new Date(parsedAt).toISOString() !== submittedAt) return refused;

  const receiptPath = receiptPathsForAssignment(assignment).lane;
  const current = physicallyContainedFileBytes(cwd, receiptPath);
  if (current === null) return refused;
  if (scanned !== null && !current.equals(scanned)) return changed;
  const rawBytes = scanned ?? current;
  // A scanned publication whose lane bytes moved since the scan is a change, not a plain refusal.
  const refusedOrChanged = () => {
    if (scanned === null) return refused;
    const now = physicallyContainedFileBytes(cwd, receiptPath);
    return now !== null && now.equals(scanned) ? refused : changed;
  };

  const text = rawBytes.toString("utf8");
  if (
    validateFrozenReceiptDocument(text).status !== "parsed" ||
    !hasCanonicalReceiptWrapper(text)
  ) return refused;
  const frontmatter = readReceiptFrontmatter(text);
  if (!frontmatter.ok) return refused;
  const changedFiles = receiptChangedFiles(frontmatter.document);
  const passedRefs = passedEvidenceRefs(frontmatter.document);
  const submitted: SubmittedHandoff = {
    receipt_id: `handoff-sha256:${createHash("sha256").update(rawBytes).digest("hex")}`,
    receipt_path: receiptPath,
    schema_valid: true,
    claimed_changed_files: changedFiles,
    acceptance_tests_passed: assignment.acceptance_tests.filter((test) => passedRefs.has(test)),
    submitted_at: submittedAt,
  };
  // Re-reads the contained receipt and requires it to hash to receipt_id: for a scanned
  // publication, the scanned digest, immediately before the exclusive write.
  if (!validateSubmittedHandoffReceipt({ cwd, assignment, submitted })) return refusedOrChanged();

  const prepared = prepareContainedWrite(cwd, assignment.handoff_path, {
    policy: "physical",
    requireRegularFileLeaf: true,
  });
  if (isRefused(prepared)) return refused;
  const serialized = JSON.stringify(submitted, null, 2) + "\n";

  try {
    if (fs.existsSync(prepared.realPath)) {
      const stat = fs.lstatSync(prepared.realPath);
      if (!stat.isFile() || stat.isSymbolicLink()) return refused;
      const existingBytes = fs.readFileSync(prepared.realPath, "utf8");
      const existing = JSON.parse(existingBytes) as SubmittedHandoff;
      const existingAt = typeof existing.submitted_at === "string"
        ? Date.parse(existing.submitted_at)
        : Number.NaN;
      const expectedExisting = {
        ...submitted,
        submitted_at: existing.submitted_at,
      };
      if (
        Number.isFinite(existingAt) &&
        new Date(existingAt).toISOString() === existing.submitted_at &&
        existingBytes === JSON.stringify(expectedExisting, null, 2) + "\n" &&
        validateSubmittedHandoffReceipt({ cwd, assignment, submitted: existing })
      ) return { ok: true, submitted: existing };
      // The immutable earlier pointer stays; a scanned publication for another digest is a change.
      return scanned !== null && existing.receipt_id !== submitted.receipt_id ? changed : refused;
    }
    fs.writeFileSync(prepared.realPath, serialized, { encoding: "utf8", flag: "wx", mode: 0o600 });
    return { ok: true, submitted };
  } catch {
    return refused;
  }
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

/**
 * The binding gate every lifecycle writer runs BEFORE touching disk (CD10): the
 * caller presents its verified envelope; nothing here reads binding.json. Throws
 * BindingRejectedError (absent / not minted / malformed / closed / mismatch).
 */
function requireWritableBinding(
  cwd: string,
  runId: string,
  binding: DispatchBindingEnvelope | undefined,
): string {
  return assertWritableBinding({ root: cwd, run_id: runId, binding_ref: binding?.binding_ref }).binding_ref;
}

function publishLifecycleFile(args: {
  cwd: string;
  ids: TaskCellInstanceIds;
  kind: TaskCellArtifactKind;
  relativePath: string;
  at: string;
  bindingRef: string;
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
    bindingRef: args.bindingRef,
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
export function writeValidationRecord(
  cwd: string,
  validation: HandoffValidationV1,
  binding?: DispatchBindingEnvelope,
): string {
  if (validation.schema_version !== HANDOFF_VALIDATION_SCHEMA) {
    throw new Error("refusing to write a non-guild.handoff_validation.v1 record");
  }
  const bindingRef = requireWritableBinding(cwd, validation.run_id, binding);
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
  publishLifecycleFile({ cwd, ids, kind: "handoff", relativePath: paths.handoff_path, at: validation.validated_at, bindingRef, required: false });
  publishLifecycleFile({ cwd, ids, kind: "validation", relativePath: paths.validation_path, at: validation.validated_at, bindingRef });
  return out;
}

// ── handoff_validated → handoff_accepted · the AUTHORITY decision ────────────

export interface AcceptanceInput {
  validation: HandoffValidationV1;
  acceptancePolicyVersion: string;
  authoritiesRequired: AcceptanceAuthority[];
  authoritiesObserved: AuthorityDecision[];
  reviewerCellId?: string | null;
  /** Policy `review.independence` (default true): a cell may not review itself (KTD58). */
  reviewIndependence?: boolean;
  now: () => string;
}

/**
 * Build a `guild.handoff_acceptance.v1` that RELEASES downstream + authorizes
 * termination. Fail-closed (mirrors the conformance double's `acceptHandoff`):
 *   - THROWS unless the validation passed the deterministic floor (a failed floor
 *     can never be accepted — D5, adversarial test 5);
 *   - THROWS unless every REQUIRED authority is observed as `accepted` (resolved
 *     decision 3 — no rubber-stamp);
 *   - THROWS when the reviewer cell IS the cell under review while
 *     `review.independence` holds (KTD58: a Team Lead is never its own reviewer).
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
  if (input.reviewIndependence !== false && input.reviewerCellId === validation.cell_id) {
    throw new Error(
      `cell ${validation.cell_id} may not review its own handoff — a Team Lead is never ` +
        `its own reviewer (KTD58, review.independence)`,
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
export function writeAcceptanceRecord(
  cwd: string,
  acceptance: HandoffAcceptanceV1,
  binding?: DispatchBindingEnvelope,
): string {
  if (acceptance.schema_version !== HANDOFF_ACCEPTANCE_SCHEMA) {
    throw new Error("refusing to write a non-guild.handoff_acceptance.v1 record");
  }
  const bindingRef = requireWritableBinding(cwd, acceptance.run_id, binding);
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
    bindingRef,
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
  const cellsRoot = path.join(durableGuildDir(cwd), "runs", runId, "task-cells");
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
  /** The caller's verified run binding (CD6/CD10); checked before any write. */
  binding?: DispatchBindingEnvelope;
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
  const bindingRef = requireWritableBinding(input.cwd, input.ids.run_id, input.binding);
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
    return writeTerminalArtifacts(input, paths, writeSealed(out, paths.attempt_path, bookkept), bindingRef);
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
  return writeTerminalArtifacts(input, paths, writeSealed(out, paths.attempt_path, sealed), bindingRef);
}

function writeTerminalArtifacts(
  input: SealTerminalInput,
  paths: ReturnType<typeof taskCellPaths>,
  attempt: TaskAttemptV1,
  bindingRef: string,
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
  publishLifecycleFile({ cwd: input.cwd, ids: input.ids, kind: "attempt", relativePath: paths.attempt_path, at: terminatedAt, bindingRef });
  publishLifecycleFile({ cwd: input.cwd, ids: input.ids, kind: "instance", relativePath: paths.instance_path, at: terminatedAt, bindingRef });
  publishLifecycleFile({ cwd: input.cwd, ids: input.ids, kind: "terminal", relativePath: paths.terminal_path, at: terminatedAt, bindingRef });
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
  binding?: DispatchBindingEnvelope,
): TaskAttemptV1 {
  const bindingRef = requireWritableBinding(cwd, ids.run_id, binding);
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
    bindingRef,
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

// ── CD24 · persisted-record classification + publish-only reconciliation ─────
//
// writeAcceptanceRecord, writeValidationRecord and sealTerminalAttempt persist a
// file and THEN publish it. When publication throws, the file stays on disk and
// the caller sees an error. These helpers let the controller decide from disk
// (never from the thrown error) whether the record exists, matches what it
// intended, and was published; and publish the exact persisted bytes at the
// current clock without rewriting any payload byte. Existing writers are unchanged.

/** Persisted-record classification (CD24). */
export type PersistedRecordClass<T> =
  | { kind: "absent" }
  | { kind: "persisted_matching"; bytes: Buffer; sha256: string; record: T }
  | { kind: "persisted_conflicting"; sha256: string; reason: string };

/** The acceptance input recorded in pre.json (CD17a) the persisted record must equal. */
export interface IntendedAcceptance {
  acceptance_policy_version: string;
  authorities_required: AcceptanceAuthority[];
  authorities_observed: AuthorityDecision[];
  reviewer_cell_id: string | null;
  validation_result_id: string;
  receipt_id: string;
  assignment_id: string;
  /** pre.json written_at: the persisted fact time may not be earlier. */
  not_before: string;
}

function readExactBytes(cwd: string, relPath: string): Buffer | null | "not_regular" {
  const abs = absUnderCwd(cwd, relPath);
  try {
    const stat = fs.lstatSync(abs);
    if (!stat.isFile() || stat.isSymbolicLink()) return "not_regular";
    return fs.readFileSync(abs);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function isIsoInstant(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const t = Date.parse(value);
  return Number.isFinite(t) && new Date(t).toISOString() === value;
}

function readValidationOnDisk(cwd: string, ids: TaskCellInstanceIds): HandoffValidationV1 | null {
  try {
    const v = JSON.parse(fs.readFileSync(absUnderCwd(cwd, taskCellPaths(ids).validation_path), "utf8")) as HandoffValidationV1;
    return v.schema_version === HANDOFF_VALIDATION_SCHEMA ? v : null;
  } catch {
    return null;
  }
}

/**
 * Classify the acceptance at `ids` against the intended acceptance. A persisted
 * record matches when every byte equals the canonical writer's serialization of
 * buildAcceptance(intended) over this instance's validation, except that
 * downstream_release_at and termination_authorized_at carry the persisted fact
 * time: both equal and not earlier than `not_before`.
 */
export function classifyPersistedAcceptance(
  cwd: string,
  ids: TaskCellInstanceIds,
  intended: IntendedAcceptance,
): PersistedRecordClass<HandoffAcceptanceV1> {
  const bytes = readExactBytes(cwd, taskCellPaths(ids).acceptance_path);
  if (bytes === null) return { kind: "absent" };
  if (bytes === "not_regular") return { kind: "persisted_conflicting", sha256: "", reason: "acceptance_not_regular_file" };
  const digest = busSha256(bytes);
  const conflict = (reason: string): PersistedRecordClass<HandoffAcceptanceV1> => ({ kind: "persisted_conflicting", sha256: digest, reason });
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(bytes.toString("utf8")) as Record<string, unknown>;
  } catch {
    return conflict("acceptance_unparseable");
  }
  const at = parsed["termination_authorized_at"];
  if (!isIsoInstant(at) || parsed["downstream_release_at"] !== at) return conflict("acceptance_fact_time_invalid");
  if (!isIsoInstant(intended.not_before) || Date.parse(at) < Date.parse(intended.not_before)) {
    return conflict("acceptance_fact_time_before_preflight");
  }
  const validation = readValidationOnDisk(cwd, ids);
  if (
    !validation ||
    validation.run_id !== ids.run_id ||
    validation.logical_task_id !== ids.logical_task_id ||
    validation.attempt !== ids.attempt ||
    validation.instance_id !== ids.instance_id ||
    validation.validation_result_id !== intended.validation_result_id ||
    validation.receipt_id !== intended.receipt_id ||
    validation.assignment_id !== intended.assignment_id
  ) return conflict("acceptance_validation_join_mismatch");
  const expected = acceptanceRecord(
    {
      validation,
      acceptancePolicyVersion: intended.acceptance_policy_version,
      authoritiesRequired: intended.authorities_required,
      authoritiesObserved: intended.authorities_observed,
      reviewerCellId: intended.reviewer_cell_id,
      now: () => at,
    },
    at,
    at,
  );
  if (JSON.stringify(expected, null, 2) + "\n" !== bytes.toString("utf8")) return conflict("acceptance_bytes_differ");
  return { kind: "persisted_matching", bytes, sha256: digest, record: expected };
}

/** Classify the validation at `ids` against the controller's in-memory result (exact bytes). */
export function classifyPersistedValidation(
  cwd: string,
  ids: TaskCellInstanceIds,
  expected: HandoffValidationV1,
): PersistedRecordClass<HandoffValidationV1> {
  const bytes = readExactBytes(cwd, taskCellPaths(ids).validation_path);
  if (bytes === null) return { kind: "absent" };
  if (bytes === "not_regular") return { kind: "persisted_conflicting", sha256: "", reason: "validation_not_regular_file" };
  const digest = busSha256(bytes);
  if (
    expected.run_id !== ids.run_id || expected.instance_id !== ids.instance_id ||
    JSON.stringify(expected, null, 2) + "\n" !== bytes.toString("utf8")
  ) return { kind: "persisted_conflicting", sha256: digest, reason: "validation_bytes_differ" };
  return { kind: "persisted_matching", bytes, sha256: digest, record: expected };
}

/** The seal request a terminal record must match (CD24). */
export interface IntendedTerminal {
  terminal_state: TerminalState;
  reason: string | null;
  /** The controller clock before the seal: when given, terminated_at may not be earlier. */
  not_before?: string;
}

/**
 * Classify the terminal seal at `ids`: attempt immutable with the requested
 * state and reason, instance and terminal.json agreeing on state and
 * terminated_at. `bytes` / `sha256` are the terminal.json record's.
 */
export function classifyPersistedTerminal(
  cwd: string,
  ids: TaskCellInstanceIds,
  intended: IntendedTerminal,
): PersistedRecordClass<TaskAttemptV1> {
  const paths = taskCellPaths(ids);
  const terminalBytes = readExactBytes(cwd, paths.terminal_path);
  const attempt = readAttemptForInstance(cwd, ids);
  if (terminalBytes === null && (!attempt || attempt.terminal_state === null)) return { kind: "absent" };
  if (terminalBytes === null || terminalBytes === "not_regular") {
    return { kind: "persisted_conflicting", sha256: "", reason: "terminal_record_missing_or_irregular" };
  }
  const digest = busSha256(terminalBytes);
  const conflict = (reason: string): PersistedRecordClass<TaskAttemptV1> => ({ kind: "persisted_conflicting", sha256: digest, reason });
  if (!attempt || !attempt.immutable || attempt.terminal_state !== intended.terminal_state || attempt.terminal_reason !== intended.reason) {
    return conflict("terminal_attempt_mismatch");
  }
  if (!isIsoInstant(attempt.terminated_at)) return conflict("terminal_fact_time_invalid");
  if (intended.not_before !== undefined &&
      (!isIsoInstant(intended.not_before) || Date.parse(attempt.terminated_at) < Date.parse(intended.not_before))) {
    return conflict("terminal_fact_time_before_request");
  }
  let terminal: Record<string, unknown>;
  let instance: ReturnType<typeof validateAgentInstanceV1>;
  try {
    terminal = JSON.parse(terminalBytes.toString("utf8")) as Record<string, unknown>;
    instance = validateAgentInstanceV1(JSON.parse(fs.readFileSync(absUnderCwd(cwd, paths.instance_path), "utf8")));
  } catch {
    return conflict("terminal_unparseable");
  }
  if (
    terminal["schema_version"] !== TASK_CELL_TERMINAL_SCHEMA ||
    terminal["instance_id"] !== ids.instance_id ||
    terminal["terminal_state"] !== attempt.terminal_state ||
    terminal["terminated_at"] !== attempt.terminated_at ||
    !instance || instance.terminal_state !== attempt.terminal_state || instance.terminated_at !== attempt.terminated_at
  ) return conflict("terminal_records_disagree");
  return { kind: "persisted_matching", bytes: terminalBytes, sha256: digest, record: attempt };
}

/** Lifecycle kinds publishPersistedLifecycleRecord may republish (no new kind). */
export type PersistedLifecycleKind = "acceptance" | "validation" | "handoff" | "attempt" | "instance" | "terminal";

export interface PersistedPublication {
  ok: true;
  outcome: "published" | "already_published";
  kind: PersistedLifecycleKind;
  path: string;
  sha256: string;
  bus_seq: number;
  /** The reconciliation clock this call used (never a fact time). */
  reconciled_at: string;
  cas_created_at: string | null;
  cas_preexisting: boolean;
}

function persistedPathFor(ids: TaskCellInstanceIds, kind: PersistedLifecycleKind): string {
  const p = taskCellPaths(ids);
  switch (kind) {
    case "acceptance": return p.acceptance_path;
    case "validation": return p.validation_path;
    case "handoff": return p.handoff_path;
    case "attempt": return p.attempt_path;
    case "instance": return p.instance_path;
    case "terminal": return p.terminal_path;
  }
}

/**
 * Publish the exact on-disk bytes of one persisted lifecycle record (CD24).
 * Returns already_published when the bus already holds an artifact.published
 * event for the same path and sha256; otherwise publishes at `now()` (the
 * reconciliation clock), so the new bus event is never backdated. The payload
 * is read, never rewritten. A pre-existing CAS header keeps its first-creation
 * created_at. Throws BindingRejectedError on an unverified binding, and an
 * Error when the file is absent or publication fails.
 */
export function publishPersistedLifecycleRecord(
  cwd: string,
  ids: TaskCellInstanceIds,
  kind: PersistedLifecycleKind,
  binding: DispatchBindingEnvelope | undefined,
  now: () => string,
): PersistedPublication {
  const bindingRef = requireWritableBinding(cwd, ids.run_id, binding);
  const relativePath = persistedPathFor(ids, kind);
  const bytes = readExactBytes(cwd, relativePath);
  if (bytes === null || bytes === "not_regular") {
    throw new Error(`no persisted regular ${kind} record at ${relativePath} to publish`);
  }
  const digest = busSha256(bytes);
  const runDirAbs = path.join(durableGuildDir(cwd), "runs", ids.run_id);
  const prior = readBusLog(runDirAbs).filter(
    (e) => e.event === "artifact.published" && e.path === relativePath && e.sha256 === digest,
  );
  const at = now();
  const casBefore = casGet(runDirAbs, digest);
  if (prior.length > 0) {
    return {
      ok: true, outcome: "already_published", kind, path: relativePath, sha256: digest,
      bus_seq: prior[prior.length - 1].seq, reconciled_at: at,
      cas_created_at: casBefore?.created_at ?? null, cas_preexisting: casBefore !== null,
    };
  }
  publishLifecycleFile({ cwd, ids, kind, relativePath, at, bindingRef });
  const events = readBusLog(runDirAbs).filter(
    (e) => e.event === "artifact.published" && e.path === relativePath && e.sha256 === digest,
  );
  if (events.length === 0) throw new Error(`artifact-bus publish left no event for ${kind}:${relativePath}`);
  const casAfter = casGet(runDirAbs, digest);
  return {
    ok: true, outcome: "published", kind, path: relativePath, sha256: digest,
    bus_seq: events[events.length - 1].seq, reconciled_at: at,
    cas_created_at: casAfter?.created_at ?? null, cas_preexisting: casBefore !== null,
  };
}

// ── run-tree enumerators (shared walk) ───────────────────────────────────────

/**
 * Walk `.guild/runs/<runId>/task-cells/**` and return the ids of EVERY instance
 * directory found (with or without an acceptance). Shared tree-walk for the
 * enumerators below. Best-effort + non-throwing: a missing/garbled tree yields [].
 */
function walkRunInstanceIds(cwd: string, runId: string): TaskCellInstanceIds[] {
  const cellsRoot = path.join(durableGuildDir(cwd), "runs", runId, "task-cells");
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
