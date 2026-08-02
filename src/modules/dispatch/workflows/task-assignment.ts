/**
 * src/modules/dispatch/workflows/task-assignment.ts
 *
 * `guild.task_assignment.v1` — the cross-host work-assignment channel (docs/v2 §08).
 * The launcher writes one assignment per dispatched specialist to
 * `.guild/runs/<run-id>/tasks/<specialist>.json`; the specialist's pane (local OR
 * a remote/cross-host process that cannot see the orchestrator's chat) reads it to
 * learn its bounded task — name, scope, upstream deps, the context-bundle pointer,
 * and the resolved host/adapter. All state on disk (library + CLI first); no daemon.
 *
 * Fail-closed: the writer validates before writing; the reader validates after
 * reading and returns null on any malformed/absent file (the pane then surfaces a
 * clear "no assignment" error rather than acting on garbage).
 */

import * as fs from "fs";
import * as path from "path";

// T3 rework F3 (guild.session_context.v1 §5): every production dispatch-
// descriptor write carries an explicit run binding (run_id + binding_ref) and
// is verified fail-closed BEFORE anything reaches disk. The frozen
// guild.task_assignment.v1 schema is preserved — the binding rides the writer
// API, not the descriptor payload.
import {
  BindingRejectedError,
  verifyRunBinding,
} from "../../lifecycle";

/** The explicit run-binding envelope every descriptor writer requires (§5). */
export interface DispatchBindingEnvelope {
  /** The nonce minted for this run at run start (mintRunBinding). */
  binding_ref: string;
}

export const TASK_ASSIGNMENT_SCHEMA = "guild.task_assignment.v1" as const;

export interface TaskAssignmentV1 {
  schema_version: typeof TASK_ASSIGNMENT_SCHEMA;
  /** The run this assignment belongs to. */
  run_id: string;
  /** The specialist slug (matches the team-file owner + agents/<name>.md). */
  specialist: string;
  /** The plan lane / task id this specialist owns (when the run is plan-backed). */
  task_id: string | null;
  /** One-sentence bounded responsibility (from the team file). */
  scope: string;
  /** Specialist slugs whose handoff this lane waits on (upstream contracts). */
  depends_on: string[];
  /** Pointer to the assembled context bundle (the authoritative task brief). */
  context_ref: string | null;
  /** Resolved host for this specialist's pane (CH-1 routing). */
  host_kind: string;
  /** Adapter version that resolved the host, for replay (null if local/native). */
  adapter_version: string | null;
  /** ISO timestamp the launcher wrote this assignment. */
  written_at: string;
}

/**
 * A specialist slug must be a safe filename segment with no separators, so distinct
 * names can never collide on one file (the `a/b` vs `a_b` overwrite class). Validation
 * and the path builder both enforce this — fail-closed, never silently rewritten.
 */
const SAFE_SPECIALIST = /^[A-Za-z0-9_.-]+$/;

/**
 * The on-disk path for a specialist's task assignment. THROWS on an unsafe slug
 * (no silent sanitize) — callers either pre-validate (writer) or wrap in try/catch
 * and treat the throw as "no assignment" (reader). Rejects `.`/`..` traversal too.
 */
export function taskAssignmentPath(runDir: string, specialist: string): string {
  if (!SAFE_SPECIALIST.test(specialist) || specialist === "." || specialist === "..") {
    throw new Error(`unsafe specialist slug for task-assignment path: ${JSON.stringify(specialist)}`);
  }
  return path.join(runDir, "tasks", `${specialist}.json`);
}

/** Fail-closed validation. Returns the typed object or null (never throws). */
export function validateTaskAssignmentV1(obj: unknown): TaskAssignmentV1 | null {
  if (obj === null || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;
  if (o["schema_version"] !== TASK_ASSIGNMENT_SCHEMA) return null;
  const str = (v: unknown): v is string => typeof v === "string" && v.length > 0;
  const strOrNull = (v: unknown): v is string | null => v === null || typeof v === "string";
  if (!str(o["run_id"]) || !str(o["specialist"]) || !str(o["host_kind"])) return null;
  // scope may be empty (a degenerate team file) — allow "" so an under-specified
  // specialist still gets an assignment file rather than being silently dropped.
  if (typeof o["scope"] !== "string") return null;
  // Specialist must be a collision-safe slug (no separators) — a name that would need
  // sanitizing is rejected, not silently rewritten onto a colliding file.
  if (!SAFE_SPECIALIST.test(o["specialist"] as string) || o["specialist"] === "." || o["specialist"] === "..") return null;
  if (!str(o["written_at"])) return null;
  if (!strOrNull(o["task_id"]) || !strOrNull(o["context_ref"]) || !strOrNull(o["adapter_version"])) return null;
  if (!Array.isArray(o["depends_on"]) || !o["depends_on"].every((d) => typeof d === "string")) return null;
  return {
    schema_version: TASK_ASSIGNMENT_SCHEMA,
    run_id: o["run_id"] as string,
    specialist: o["specialist"] as string,
    task_id: (o["task_id"] as string | null) ?? null,
    scope: o["scope"] as string,
    depends_on: o["depends_on"] as string[],
    context_ref: (o["context_ref"] as string | null) ?? null,
    host_kind: o["host_kind"] as string,
    adapter_version: (o["adapter_version"] as string | null) ?? null,
    written_at: o["written_at"] as string,
  };
}

/**
 * Write a specialist's task assignment (launcher side). Validates before writing —
 * a malformed assignment is never persisted (returns null; the launcher logs and
 * continues). The run BINDING is verified fail-closed first (T3 F3): a missing,
 * malformed, closed, or mismatched binding — or a runDir that does not address
 * the assignment's own run — THROWS BindingRejectedError (structured
 * `binding_rejected`, non-zero result to the caller) and nothing is written.
 */
export function writeTaskAssignment(
  runDir: string,
  assignment: TaskAssignmentV1,
  binding: DispatchBindingEnvelope
): string | null {
  const valid = validateTaskAssignmentV1(assignment);
  if (!valid) return null;
  // Addressing integrity: the descriptor must land in ITS OWN run's dir. A
  // runDir naming a different run is the cross-run/moved-sentinel write class.
  if (path.basename(runDir) !== valid.run_id) {
    throw new BindingRejectedError("binding_mismatch", valid.run_id);
  }
  // Canonical layout: runDir = <root>/.guild/runs/<run_id> — derive the root
  // the binding record is verified under.
  const root = path.resolve(runDir, "..", "..", "..");
  const verdict = verifyRunBinding({
    root,
    run_id: valid.run_id,
    binding_ref: binding?.binding_ref,
  });
  if (verdict.ok === false) {
    throw new BindingRejectedError(verdict.reason, valid.run_id);
  }
  const out = taskAssignmentPath(runDir, valid.specialist);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(valid, null, 2) + "\n");
  return out;
}

/**
 * Read a specialist's task assignment (pane side). Returns the validated object,
 * or null when absent/unparseable/invalid — never throws.
 */
export function readTaskAssignment(runDir: string, specialist: string): TaskAssignmentV1 | null {
  try {
    const raw = fs.readFileSync(taskAssignmentPath(runDir, specialist), "utf8");
    return validateTaskAssignmentV1(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** Build a `guild.task_assignment.v1` from the resolved dispatch inputs. */
export function buildTaskAssignment(input: {
  runId: string;
  specialist: string;
  taskId?: string | null;
  scope: string;
  dependsOn?: string[];
  contextRef?: string | null;
  hostKind: string;
  adapterVersion?: string | null;
  now: () => string;
}): TaskAssignmentV1 {
  return {
    schema_version: TASK_ASSIGNMENT_SCHEMA,
    run_id: input.runId,
    specialist: input.specialist,
    task_id: input.taskId ?? null,
    scope: input.scope,
    depends_on: input.dependsOn ?? [],
    context_ref: input.contextRef ?? null,
    host_kind: input.hostKind,
    adapter_version: input.adapterVersion ?? null,
    written_at: input.now(),
  };
}
