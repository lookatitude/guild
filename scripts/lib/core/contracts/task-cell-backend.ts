/**
 * scripts/lib/core/contracts/task-cell-backend.ts
 *
 * G2 — the `TaskCellBackend` seam: the lifecycle-bearing runtime contract that
 * extends (and will eventually replace) the `launch()`-only `TeamBackend` seam.
 * Pure interfaces, pure builders, pure predicates — no I/O, no processes.
 *
 * Layer: core/contracts/ — zero host-specific imports. Host implementations
 * (tmux / in-process / serial / remote) live behind adapters; the SEMANTICS in
 * this file are identical across every substrate, which is what makes one
 * conformance suite meaningful (ADR D5).
 *
 * Canonical source: `.guild/wiki/decisions/task-cell-runtime-contract.md`
 *   D3 — three identity layers (type → profile → instance); an instance is never reused.
 *   D4 — immutable terminal attempts; retry = new task_run_id/attempt/attempt_id/instance_id
 *        with mandatory `previous_attempt_id` + `retry_reason` lineage.
 *   D5 — the lifecycle state machine + the runtime operation set + the frozen
 *        `guild.handoff_acceptance.v1` field list.
 *   D6 — self-contained `guild.task_assignment.v2` + run-tree containment.
 *
 * ADDITIVE: `team-backend.ts` and every shipping dispatch path are untouched.
 * Rewiring production callers onto this seam is G3/G4.
 *
 * NOTE on the operation count: the initiative ledger and the G2 brief both say
 * "15 ops", but the ADR's frozen list (D5) names exactly FOURTEEN operations —
 * spawnCell · spawnInstance · awaitReady · deliverAssignment · awaitAssignmentAck ·
 * observe · heartbeat · collectHandoff · acceptHandoff · rejectHandoff · cancel ·
 * terminate · awaitTerminated · reapOrphan. The ADR is authoritative, so this
 * interface implements those fourteen (plus the `isAvailable()` availability probe
 * carried over from the `TeamBackend` seam, which is what the "15th" almost
 * certainly counted).
 */

import * as path from "path";

// ── D5 · Lifecycle state machine ─────────────────────────────────────────────

/**
 * The D5 lifecycle:
 *
 *   declared → instantiated → ready → assigned → assignment_acknowledged → running
 *     → handoff_submitted → handoff_validated → handoff_accepted
 *     → terminating → terminated
 *          (alt terminal: failed | cancelled | timed_out | rejected)
 */
export const TASK_CELL_STATES = [
  "declared",
  "instantiated",
  "ready",
  "assigned",
  "assignment_acknowledged",
  "running",
  "handoff_submitted",
  "handoff_validated",
  "handoff_accepted",
  "terminating",
  "terminated",
  "failed",
  "cancelled",
  "timed_out",
  "rejected",
] as const;

export type TaskCellState = (typeof TASK_CELL_STATES)[number];

/** D4 — terminal states are IMMUTABLE. A retry mints a new attempt; it never revives one of these. */
export const TERMINAL_STATES = [
  "terminated",
  "failed",
  "cancelled",
  "timed_out",
  "rejected",
] as const;

export type TerminalState = (typeof TERMINAL_STATES)[number];

const TERMINAL_SET: ReadonlySet<string> = new Set<string>(TERMINAL_STATES);

export function isTerminal(state: TaskCellState): state is TerminalState {
  return TERMINAL_SET.has(state);
}

/**
 * The legal edges. Two invariants this table exists to make unfakeable:
 *
 *  1. `running` is reachable ONLY from `assignment_acknowledged` — a worker that
 *     never acknowledges its assignment is timed out and terminated, never allowed
 *     to run (D5, adversarial test 4).
 *  2. Terminal states have NO outgoing edge — a terminal attempt can never be
 *     resurrected (D4, adversarial test 15).
 *
 * `handoff_submitted → handoff_validated` fires only when the deterministic floor
 * passes; a receipt that fails validation stays `handoff_submitted` until it is
 * rejected. It can never reach `handoff_accepted` (D5, adversarial test 5).
 */
export const LEGAL_TRANSITIONS: Readonly<Record<TaskCellState, readonly TaskCellState[]>> =
  Object.freeze({
    declared: ["instantiated", "failed", "cancelled"],
    instantiated: ["ready", "failed", "cancelled", "timed_out"],
    ready: ["assigned", "failed", "cancelled", "timed_out"],
    assigned: ["assignment_acknowledged", "failed", "cancelled", "timed_out"],
    // The ack gate: `running` has exactly ONE inbound edge.
    assignment_acknowledged: ["running", "failed", "cancelled", "timed_out"],
    running: ["handoff_submitted", "failed", "cancelled", "timed_out"],
    handoff_submitted: ["handoff_validated", "rejected", "failed", "cancelled", "timed_out"],
    handoff_validated: ["handoff_accepted", "rejected", "failed", "cancelled", "timed_out"],
    // Only a durable acceptance record authorizes termination (D5). After
    // acceptance the ONLY legal path is `terminating -> terminated`; there is no
    // edge to `failed` — a post-acceptance teardown problem parks in
    // `terminating` for the reaper, it never terminal-fails the accepted work.
    handoff_accepted: ["terminating"],
    // A failed teardown leaves the instance HERE, orphaned, for the reaper to
    // retry until it reaches `terminated`. `terminating` therefore has no
    // `failed` edge (the reaper never abandons an accepted instance to failed).
    terminating: ["terminated"],
    terminated: [],
    failed: [],
    cancelled: [],
    timed_out: [],
    rejected: [],
  } as Record<TaskCellState, readonly TaskCellState[]>);

export class IllegalTransitionError extends Error {
  readonly from: TaskCellState;
  readonly to: TaskCellState;
  constructor(from: TaskCellState, to: TaskCellState) {
    super(
      isTerminal(from)
        ? `illegal task-cell transition ${from} → ${to}: ${from} is terminal and immutable (D4)`
        : `illegal task-cell transition ${from} → ${to}`
    );
    this.name = "IllegalTransitionError";
    this.from = from;
    this.to = to;
  }
}

export function canTransition(from: TaskCellState, to: TaskCellState): boolean {
  return (LEGAL_TRANSITIONS[from] ?? []).includes(to);
}

/** Fail-closed guard. Throws `IllegalTransitionError` on any edge not in `LEGAL_TRANSITIONS`. */
export function assertTransition(from: TaskCellState, to: TaskCellState): void {
  if (!canTransition(from, to)) throw new IllegalTransitionError(from, to);
}

// ── D1 · Fan-out + substrate ─────────────────────────────────────────────────

/** D1 — every step emits a TaskCell; multi-worker fan-out is CONDITIONAL, never mandatory. */
export type CellFanout = "lead_only" | "lead_plus_one" | "lead_plus_many";

/**
 * The four substrates the conformance suite pins. String literals mirror
 * `TeamBackendKind` 1:1 so the G3/G4 rewire is a straight mapping — deliberately
 * re-declared rather than imported, to keep this contract free of the host graph.
 */
export type TaskCellSubstrate = "tmux" | "in-process" | "serial" | "remote";

// ── D3 · Identity ────────────────────────────────────────────────────────────

export type ModelTier = "cheap" | "mid" | "powerful";

export interface TaskCellBudgets {
  tokens: number | null;
  wall_clock_ms: number | null;
  cost_usd: number | null;
}

/**
 * Resolved decision 2 — a cell either spawns a distinct Team Lead instance
 * (`team_lead_instance_id`) or reuses the parent orchestrator as lead
 * (`lead_binding_id`). EXACTLY ONE is present; the discriminated union makes the
 * "both" and "neither" shapes unrepresentable at compile time.
 */
export type LeadBinding =
  | { team_lead_instance_id: string; lead_binding_id?: undefined }
  | { lead_binding_id: string; team_lead_instance_id?: undefined };

/** Runtime XOR guard for callers building a `LeadBinding` from untyped input. */
export function leadBinding(input: {
  team_lead_instance_id?: string | null;
  lead_binding_id?: string | null;
}): LeadBinding {
  const lead = input.team_lead_instance_id ?? null;
  const binding = input.lead_binding_id ?? null;
  if (lead && binding) {
    throw new Error(
      "lead binding must carry exactly one of team_lead_instance_id / lead_binding_id, got both"
    );
  }
  if (lead) return { team_lead_instance_id: lead };
  if (binding) return { lead_binding_id: binding };
  throw new Error(
    "lead binding must carry exactly one of team_lead_instance_id / lead_binding_id, got neither"
  );
}

/**
 * D4 — lineage. The union encodes "retry_reason is REQUIRED on every non-first
 * attempt" in the type system: `{ attempt: 2 }` alone does not typecheck.
 */
export type AttemptLineage =
  | { attempt: 1; previous_attempt_id?: null; retry_reason?: null }
  | { attempt: number; previous_attempt_id: string; retry_reason: string };

/** Runtime lineage guard, for callers whose `attempt` is a computed number. */
export function attemptLineage(input: {
  attempt: number;
  previous_attempt_id?: string | null;
  retry_reason?: string | null;
}): AttemptLineage {
  const { attempt } = input;
  if (!Number.isInteger(attempt) || attempt < 1) {
    throw new Error(`attempt must be an integer >= 1, got ${JSON.stringify(attempt)}`);
  }
  const prev = input.previous_attempt_id ?? null;
  const reason = input.retry_reason ?? null;
  if (attempt === 1) {
    if (prev || reason) {
      throw new Error("attempt 1 must not carry previous_attempt_id / retry_reason lineage");
    }
    return { attempt: 1, previous_attempt_id: null, retry_reason: null };
  }
  if (!prev || !reason) {
    throw new Error(
      `attempt ${attempt} requires previous_attempt_id + retry_reason lineage (D4)`
    );
  }
  return { attempt, previous_attempt_id: prev, retry_reason: reason };
}

export const AGENT_INSTANCE_SCHEMA = "guild.agent_instance.v1" as const;

/**
 * D3 — the EPHEMERAL runtime identity. Created for exactly one
 * (`task_run_id`, `attempt`) and NEVER reused. Binds a profile hash to host,
 * model, context hash, permission scope, budget, timestamps, terminal status.
 */
export interface AgentInstanceV1 {
  schema_version: typeof AGENT_INSTANCE_SCHEMA;
  instance_id: string;
  run_id: string;
  cell_id: string;
  logical_task_id: string;
  task_run_id: string;
  attempt: number;
  attempt_id: string;
  worker_role: string;
  /** Type layer (`guild.specialist_type.v2`) — immutable, provider-neutral. */
  specialist_type_id: string;
  specialist_type_version: string;
  specialist_type_hash: string;
  /** Profile layer (`guild.specialist_profile.v1`) — the durable `.guild/agents/<role>.md`. */
  specialist_profile_id: string;
  specialist_profile_hash: string;
  /** Host binding. */
  host_id: string;
  adapter_id: string;
  host_capabilities_hash: string;
  substrate: TaskCellSubstrate;
  /** Types carry a TIER; a concrete model is resolved at dispatch (D3, G7). */
  model_tier: ModelTier;
  model_id: string | null;
  /** Context layer — fresh per instance; never reused across attempts. */
  context_bundle_id: string;
  context_bundle_hash: string;
  projection: ToolPermissionProjection;
  budgets: TaskCellBudgets;
  created_at: string;
  started_at: string | null;
  terminated_at: string | null;
  terminal_state: TerminalState | null;
  terminal_reason: string | null;
}

export const TASK_ATTEMPT_SCHEMA = "guild.task_attempt.v1" as const;

/**
 * The additive companion to the frozen `guild.task_run.v1` (ADR §Frozen-contract
 * impact): the authoritative source for retry lineage + terminal-attempt
 * immutability. ONE IMMUTABLE FILE PER ATTEMPT — never overwritten. No
 * implementation may overload a v1 `task_run_id` to mean both logical task and
 * attempt.
 */
export interface TaskAttemptV1 {
  schema_version: typeof TASK_ATTEMPT_SCHEMA;
  run_id: string;
  cell_id: string;
  logical_task_id: string;
  task_run_id: string;
  attempt: number;
  attempt_id: string;
  previous_attempt_id: string | null;
  /** Required on every non-first attempt (D4). */
  retry_reason: string | null;
  instance_id: string;
  created_at: string;
  // ── terminal-immutability metadata ──
  terminal_state: TerminalState | null;
  terminal_reason: string | null;
  terminated_at: string | null;
  /** Flips true the moment a terminal state is recorded; the record is sealed thereafter. */
  immutable: boolean;
  /** Adversarial test 6 — a teardown that failed leaves an orphan for the reaper. */
  orphaned: boolean;
  reap_attempts: number;
}

// ── D6 · guild.task_assignment.v2 ────────────────────────────────────────────

export const TASK_ASSIGNMENT_V2_SCHEMA = "guild.task_assignment.v2" as const;

/** Resolved decision 4 — an `emulated | degraded` core tool is NOT compatible; losses are recorded, never silently passed. */
export interface ToolPermissionProjection {
  tools: string[];
  permissions: string[];
  recorded_losses: Array<{ capability: string; mapping: string; loss: string }>;
}

/** A dependency plus its accepted-upstream pointer (null until the upstream is ACCEPTED — D5). */
export interface AssignmentDependency {
  logical_task_id: string;
  accepted_artifact_ref: string | null;
}

/** The channels the runtime reads/writes for this instance (all inside the run tree — D6). */
export interface AssignmentChannels {
  assignment_path: string;
  handoff_path: string;
  heartbeat_path: string;
  cancel_channel: string;
}

/**
 * Everything in `guild.task_assignment.v2` EXCEPT the two XOR unions
 * (`LeadBinding`, `AttemptLineage`), which are intersected in below.
 *
 * Self-containment invariant (D6): this file alone must be sufficient to
 * reconstruct and re-validate the entire dispatch — no external join.
 */
export interface TaskAssignmentV2Base extends AssignmentChannels {
  schema_version: typeof TASK_ASSIGNMENT_V2_SCHEMA;
  // ── Identity ──
  run_id: string;
  cell_id: string;
  goal_id: string;
  phase_id: string;
  step_id: string;
  team_id: string;
  logical_task_id: string;
  task_run_id: string;
  attempt_id: string;
  instance_id: string;
  worker_role: string;
  // ── Type / profile ──
  specialist_type_id: string;
  specialist_type_version: string;
  specialist_type_hash: string;
  specialist_profile_id: string;
  specialist_profile_hash: string;
  // ── Context + host ──
  context_bundle_id: string;
  context_bundle_hash: string;
  host_id: string;
  adapter_id: string;
  /** So the "not compatible" tool decision is reproducible (resolved Q4). */
  host_capabilities_hash: string;
  // ── Work + policy ──
  objective: string;
  non_goals: string[];
  /**
   * The path scope the worker's claimed changed-files must trace to.
   *
   * ADDITIVE to the ADR's D6 "frozen required fields" list (which is a MUST-carry
   * floor, not a closed set). The D5 deterministic floor requires that "its claimed
   * changed-files trace to the assignment's scope", and D6 requires the assignment
   * be sufficient to re-validate the dispatch FROM THE FILE ALONE — so the scope the
   * floor checks against has to live here. Empty array = no path scope declared, and
   * the scope check then passes vacuously.
   */
  scope_paths: string[];
  output_schema: string;
  acceptance_tests: string[];
  dependencies: AssignmentDependency[];
  projection: ToolPermissionProjection;
  autonomy_policy: string;
  budgets: TaskCellBudgets;
  deadline: string | null;
  written_at: string;
}

/**
 * `guild.task_assignment.v2` — ONE IMMUTABLE FILE per (task_run_id, attempt,
 * instance_id). NEVER per specialist name (that is the v1 overwrite class this
 * replaces). A malformed or unreadable assignment is a HARD DISPATCH FAILURE.
 */
export type TaskAssignmentV2 = TaskAssignmentV2Base & LeadBinding & AttemptLineage;

const SAFE_SEGMENT = /^[A-Za-z0-9_.-]+$/;

function assertSafeSegment(label: string, value: string): void {
  if (!SAFE_SEGMENT.test(value) || value === "." || value === "..") {
    throw new Error(`unsafe ${label} path segment: ${JSON.stringify(value)}`);
  }
}

export interface TaskCellPathIds {
  run_id: string;
  logical_task_id: string;
  attempt: number;
  instance_id: string;
}

export interface TaskCellPaths {
  run_dir: string;
  cell_dir: string;
  attempt_dir: string;
  instance_dir: string;
  /** `guild.task_attempt.v1` — one immutable file per attempt (above the instances). */
  attempt_path: string;
  assignment_path: string;
  handoff_path: string;
  heartbeat_path: string;
  cancel_channel: string;
  validation_path: string;
  acceptance_path: string;
  terminal_path: string;
}

/**
 * D6 run-tree containment. The canonical path is
 *
 *   .guild/runs/<run_id>/task-cells/<logical_task_id>/attempts/<attempt>/instances/<instance_id>/…
 *
 * Every id is validated as a safe single segment and the built paths are asserted
 * to stay inside the `run_id` tree — no record may be scattered outside the
 * authoritative run tree (which is what makes a run reconstructible after an
 * orchestrator crash — adversarial test 15).
 */
export function taskCellPaths(
  ids: TaskCellPathIds,
  opts: { guildDir?: string } = {}
): TaskCellPaths {
  assertSafeSegment("run_id", ids.run_id);
  assertSafeSegment("logical_task_id", ids.logical_task_id);
  assertSafeSegment("instance_id", ids.instance_id);
  if (!Number.isInteger(ids.attempt) || ids.attempt < 1) {
    throw new Error(`attempt must be an integer >= 1, got ${JSON.stringify(ids.attempt)}`);
  }

  const guildDir = opts.guildDir ?? ".guild";
  const run_dir = path.join(guildDir, "runs", ids.run_id);
  const cell_dir = path.join(run_dir, "task-cells", ids.logical_task_id);
  const attempt_dir = path.join(cell_dir, "attempts", String(ids.attempt));
  const instance_dir = path.join(attempt_dir, "instances", ids.instance_id);

  const paths: TaskCellPaths = {
    run_dir,
    cell_dir,
    attempt_dir,
    instance_dir,
    attempt_path: path.join(attempt_dir, "attempt.json"),
    assignment_path: path.join(instance_dir, "assignment.json"),
    handoff_path: path.join(instance_dir, "handoff.json"),
    heartbeat_path: path.join(instance_dir, "heartbeat.json"),
    cancel_channel: path.join(instance_dir, "cancel"),
    validation_path: path.join(instance_dir, "handoff-validation.json"),
    acceptance_path: path.join(instance_dir, "handoff-acceptance.json"),
    terminal_path: path.join(instance_dir, "terminal.json"),
  };

  for (const [key, value] of Object.entries(paths)) {
    if (key === "run_dir") continue;
    assertWithinRunTree(run_dir, value, key);
  }
  return paths;
}

/** Fail-closed containment check: `p` must resolve inside the `run_id` tree. */
export function assertWithinRunTree(runDir: string, p: string, label = "path"): void {
  const rel = path.relative(path.resolve(runDir), path.resolve(p));
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`${label} escapes the run tree ${runDir}: ${p}`);
  }
}

export interface BuildTaskAssignmentInput
  extends Omit<TaskAssignmentV2Base, "schema_version" | keyof AssignmentChannels> {
  attempt: number;
  previous_attempt_id?: string | null;
  retry_reason?: string | null;
  team_lead_instance_id?: string | null;
  lead_binding_id?: string | null;
  guildDir?: string;
}

/** Build a self-contained `guild.task_assignment.v2`, channels derived from the canonical run tree. */
export function buildTaskAssignmentV2(input: BuildTaskAssignmentInput): TaskAssignmentV2 {
  const lineage = attemptLineage(input);
  const lead = leadBinding(input);
  const paths = taskCellPaths(
    {
      run_id: input.run_id,
      logical_task_id: input.logical_task_id,
      attempt: input.attempt,
      instance_id: input.instance_id,
    },
    { guildDir: input.guildDir }
  );
  const { guildDir: _guildDir, ...rest } = input;
  void _guildDir;
  const base: TaskAssignmentV2Base = {
    ...(rest as Omit<TaskAssignmentV2Base, "schema_version" | keyof AssignmentChannels>),
    schema_version: TASK_ASSIGNMENT_V2_SCHEMA,
    assignment_path: paths.assignment_path,
    handoff_path: paths.handoff_path,
    heartbeat_path: paths.heartbeat_path,
    cancel_channel: paths.cancel_channel,
  };
  return { ...base, ...lineage, ...lead } as TaskAssignmentV2;
}

const isStr = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const isStrArr = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === "string");

function isBudgets(v: unknown): v is TaskCellBudgets {
  if (v === null || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  const numOrNull = (x: unknown) => x === null || typeof x === "number";
  return numOrNull(o["tokens"]) && numOrNull(o["wall_clock_ms"]) && numOrNull(o["cost_usd"]);
}

function isProjection(v: unknown): v is ToolPermissionProjection {
  if (v === null || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  if (!isStrArr(o["tools"]) || !isStrArr(o["permissions"])) return false;
  const losses = o["recorded_losses"];
  return (
    Array.isArray(losses) &&
    losses.every((l) => {
      if (l === null || typeof l !== "object") return false;
      const e = l as Record<string, unknown>;
      return isStr(e["capability"]) && isStr(e["mapping"]) && isStr(e["loss"]);
    })
  );
}

function isDependencies(v: unknown): v is AssignmentDependency[] {
  return (
    Array.isArray(v) &&
    v.every((d) => {
      if (d === null || typeof d !== "object") return false;
      const e = d as Record<string, unknown>;
      return (
        isStr(e["logical_task_id"]) &&
        (e["accepted_artifact_ref"] === null || typeof e["accepted_artifact_ref"] === "string")
      );
    })
  );
}

/**
 * Fail-closed validation of a `guild.task_assignment.v2`. Returns the typed
 * assignment or NULL — never throws, never repairs. D6: a malformed or missing
 * assignment is a hard dispatch failure, not log-and-continue.
 */
export function validateTaskAssignmentV2(obj: unknown): TaskAssignmentV2 | null {
  if (obj === null || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;
  if (o["schema_version"] !== TASK_ASSIGNMENT_V2_SCHEMA) return null;

  const requiredStrings = [
    "run_id",
    "cell_id",
    "goal_id",
    "phase_id",
    "step_id",
    "team_id",
    "logical_task_id",
    "task_run_id",
    "attempt_id",
    "instance_id",
    "worker_role",
    "specialist_type_id",
    "specialist_type_version",
    "specialist_type_hash",
    "specialist_profile_id",
    "specialist_profile_hash",
    "context_bundle_id",
    "context_bundle_hash",
    "host_id",
    "adapter_id",
    "host_capabilities_hash",
    "objective",
    "output_schema",
    "autonomy_policy",
    "written_at",
    "assignment_path",
    "handoff_path",
    "heartbeat_path",
    "cancel_channel",
  ] as const;
  for (const k of requiredStrings) {
    if (!isStr(o[k])) return null;
  }
  if (!isStrArr(o["non_goals"]) || !isStrArr(o["acceptance_tests"])) return null;
  if (!isStrArr(o["scope_paths"])) return null;
  if (!isDependencies(o["dependencies"])) return null;
  if (!isProjection(o["projection"])) return null;
  if (!isBudgets(o["budgets"])) return null;
  if (!(o["deadline"] === null || typeof o["deadline"] === "string")) return null;

  let lineage: AttemptLineage;
  let lead: LeadBinding;
  try {
    lineage = attemptLineage({
      attempt: o["attempt"] as number,
      previous_attempt_id: (o["previous_attempt_id"] as string | null) ?? null,
      retry_reason: (o["retry_reason"] as string | null) ?? null,
    });
    lead = leadBinding({
      team_lead_instance_id: (o["team_lead_instance_id"] as string | null) ?? null,
      lead_binding_id: (o["lead_binding_id"] as string | null) ?? null,
    });
  } catch {
    return null;
  }

  // Canonical-path enforcement (D6): every channel must EQUAL the canonical
  // per-instance path, not merely live somewhere under the run tree. A same-run
  // but non-canonical path (e.g. a hand-written or role-keyed location) is a hard
  // validation failure — the assignment is the authoritative join and cannot
  // point channels at an off-tree layout.
  try {
    const expected = taskCellPaths({
      run_id: o["run_id"] as string,
      logical_task_id: o["logical_task_id"] as string,
      attempt: lineage.attempt,
      instance_id: o["instance_id"] as string,
    });
    if (o["assignment_path"] !== expected.assignment_path) return null;
    if (o["handoff_path"] !== expected.handoff_path) return null;
    if (o["heartbeat_path"] !== expected.heartbeat_path) return null;
    if (o["cancel_channel"] !== expected.cancel_channel) return null;
  } catch {
    return null;
  }

  return { ...(o as unknown as TaskAssignmentV2Base), ...lineage, ...lead } as TaskAssignmentV2;
}

/**
 * Fail-closed validator for the `guild.task_attempt.v1` companion record. The
 * record TYPE cannot express D4's conditional lineage ("previous_attempt_id +
 * retry_reason required on every non-first attempt") in TypeScript, so this
 * validator enforces it at the record boundary — not only inside builder
 * helpers. Reuses `attemptLineage` (the single source of the lineage rule), so a
 * record with `attempt > 1` and a null `previous_attempt_id` or null
 * `retry_reason` is rejected, exactly as an assignment would be.
 */
export function validateTaskAttemptV1(obj: unknown): TaskAttemptV1 | null {
  if (obj === null || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;
  if (o["schema_version"] !== TASK_ATTEMPT_SCHEMA) return null;

  const requiredStrings = [
    "run_id",
    "cell_id",
    "logical_task_id",
    "task_run_id",
    "attempt_id",
    "instance_id",
    "created_at",
  ] as const;
  for (const k of requiredStrings) {
    if (!isStr(o[k])) return null;
  }

  // Conditional lineage — the SAME guard the assignment path uses. Throws (→ null)
  // when attempt > 1 lacks previous_attempt_id / retry_reason, or attempt 1
  // carries lineage it must not.
  try {
    attemptLineage({
      attempt: o["attempt"] as number,
      previous_attempt_id: (o["previous_attempt_id"] as string | null) ?? null,
      retry_reason: (o["retry_reason"] as string | null) ?? null,
    });
  } catch {
    return null;
  }

  // Terminal-immutability metadata (nullable until sealed).
  const ts = o["terminal_state"];
  if (!(ts === null || (typeof ts === "string" && TERMINAL_SET.has(ts)))) return null;
  if (!(o["terminal_reason"] === null || typeof o["terminal_reason"] === "string")) return null;
  if (!(o["terminated_at"] === null || typeof o["terminated_at"] === "string")) return null;
  if (typeof o["immutable"] !== "boolean") return null;
  if (typeof o["orphaned"] !== "boolean") return null;
  if (!Number.isInteger(o["reap_attempts"]) || (o["reap_attempts"] as number) < 0) return null;

  return o as unknown as TaskAttemptV1;
}

/**
 * The D6 key of an assignment: `(task_run_id, attempt, instance_id)`. This is what
 * the validation + acceptance records mean by `assignment_id`. Deriving it keeps the
 * frozen v2 field list closed and makes "one assignment per instance+attempt"
 * structurally true — two assignments can only collide if their identity collides.
 */
export function assignmentId(a: TaskAssignmentV2): string {
  return `${a.task_run_id}:${a.attempt}:${a.instance_id}`;
}

/** The deterministic floor's scope check: claimed changed-files must trace to `scope_paths`. */
export function outOfScopeFiles(
  scope_paths: readonly string[],
  claimed_changed_files: readonly string[]
): string[] {
  if (scope_paths.length === 0) return [];
  return claimed_changed_files.filter(
    (f) => !scope_paths.some((s) => f === s || f.startsWith(s.endsWith("/") ? s : `${s}/`))
  );
}

// ── D5 · Handoff submission → validation → acceptance ────────────────────────

/**
 * A POINTER to the worker's frozen `guild.handoff_receipt.v1` — deliberately NOT
 * a redefinition of it. The receipt is the worker's output and is READ, NEVER
 * MUTATED, by the two orchestrator-owned records below. It is never reinterpreted
 * as validation, acceptance, dismissal, or termination (ADR §Frozen-contract impact).
 */
export interface SubmittedHandoff {
  receipt_id: string;
  receipt_path: string;
  /** Whether the receipt on the wire parsed as a schema-valid `guild.handoff_receipt.v1`. */
  schema_valid: boolean;
  /** Files the receipt CLAIMS it changed — validated against the assignment's scope. */
  claimed_changed_files: string[];
  /** Which of the assignment's acceptance tests the worker reports as passing. */
  acceptance_tests_passed: string[];
  submitted_at: string;
}

export const HANDOFF_VALIDATION_SCHEMA = "guild.handoff_validation.v1" as const;

/**
 * The DETERMINISTIC FLOOR result (D5). Pure, mechanical, host-neutral — never a
 * model judgement. Persisted so a rejected receipt leaves a durable trace.
 */
export interface HandoffValidationV1 {
  schema_version: typeof HANDOFF_VALIDATION_SCHEMA;
  validation_result_id: string;
  run_id: string;
  cell_id: string;
  logical_task_id: string;
  task_run_id: string;
  attempt: number;
  instance_id: string;
  assignment_id: string;
  receipt_id: string;
  /** The receipt parsed as a schema-valid `guild.handoff_receipt.v1`. */
  schema_valid: boolean;
  /** Every claimed changed file traces to the assignment's scope. */
  scope_valid: boolean;
  /** Every acceptance test named by the assignment passed. */
  tests_passed: boolean;
  out_of_scope_files: string[];
  failed_acceptance_tests: string[];
  result: "passed" | "failed";
  reason: string | null;
  validated_at: string;
}

/** Resolved decision 3 — the acceptance authorities, on a mandatory deterministic floor. */
export const ACCEPTANCE_AUTHORITIES = [
  "deterministic_floor",
  "team_lead",
  "reviewer_cell",
] as const;

export type AcceptanceAuthority = (typeof ACCEPTANCE_AUTHORITIES)[number];

export interface AuthorityDecision {
  authority: AcceptanceAuthority;
  decision: "accepted" | "rejected";
  at: string;
  reason: string | null;
}

export const HANDOFF_ACCEPTANCE_SCHEMA = "guild.handoff_acceptance.v1" as const;

/**
 * The FROZEN acceptance-record contract (D5 — this field list is verbatim).
 *
 * ONLY this durable record releases downstream tasks and authorizes termination.
 * Dependency-release code reads THIS record, never receipt existence. A validated
 * receipt that is not accepted blocks its dependents.
 *
 * `downstream_release_at === null` means downstream stays BLOCKED (the record still
 * exists so the rejection is durable and auditable — adversarial test 8);
 * `termination_authorized_at` may still be set, because a rejected worker must be
 * terminated with an explicit rejection terminal event, never silently killed.
 */
export interface HandoffAcceptanceV1 {
  schema_version: typeof HANDOFF_ACCEPTANCE_SCHEMA;
  run_id: string;
  cell_id: string;
  logical_task_id: string;
  task_run_id: string;
  attempt: number;
  instance_id: string;
  assignment_id: string;
  receipt_id: string;
  validation_result_id: string;
  acceptance_policy_version: string;
  authorities_required: AcceptanceAuthority[];
  authorities_observed: AuthorityDecision[];
  reviewer_cell_id?: string | null;
  downstream_release_at: string | null;
  termination_authorized_at: string | null;
}

// ── D5 · Dependency-release predicate ────────────────────────────────────────

/**
 * The ONLY sanctioned release predicate: a logical task is released when a durable
 * acceptance record exists for it AND that record carries a `downstream_release_at`.
 * Receipt existence releases nothing (D5, adversarial tests 5 + 8).
 */
export function releasedLogicalTasks(
  acceptances: readonly HandoffAcceptanceV1[]
): ReadonlySet<string> {
  const out = new Set<string>();
  for (const a of acceptances) {
    if (a.downstream_release_at !== null) out.add(a.logical_task_id);
  }
  return out;
}

export interface DependencyGateResult {
  ready: boolean;
  blocked_on: string[];
}

/** Gate an assignment's dispatch on its upstreams' ACCEPTANCE records. */
export function dependencyGate(
  dependencies: readonly AssignmentDependency[],
  acceptances: readonly HandoffAcceptanceV1[]
): DependencyGateResult {
  const released = releasedLogicalTasks(acceptances);
  const blocked_on = dependencies
    .map((d) => d.logical_task_id)
    .filter((id) => !released.has(id));
  return { ready: blocked_on.length === 0, blocked_on };
}

/** Heartbeat liveness (pure). A missing beat past the timeout is stale. */
export function isHeartbeatStale(
  last_heartbeat_at: string | null,
  now: string,
  timeout_ms: number
): boolean {
  if (last_heartbeat_at === null) return true;
  const last = Date.parse(last_heartbeat_at);
  const at = Date.parse(now);
  if (Number.isNaN(last) || Number.isNaN(at)) return true;
  return at - last > timeout_ms;
}

// ── Handles ──────────────────────────────────────────────────────────────────

/** An immutable SNAPSHOT of a cell. Re-read via `observe`; never mutated in place. */
export interface CellHandle {
  readonly cell_id: string;
  readonly run_id: string;
  readonly logical_task_id: string;
  readonly goal_id: string;
  readonly phase_id: string;
  readonly step_id: string;
  readonly team_id: string;
  readonly fanout: CellFanout;
  readonly lead: LeadBinding;
  readonly instance_ids: readonly string[];
}

/**
 * An immutable SNAPSHOT of one runtime instance. `instance_id` is UNIQUE across
 * the whole backend for all time — never reused across attempts, cells, or runs
 * (D3). A stale handle keeps its stale `state`; `observe` returns a fresh one.
 */
export interface InstanceHandle {
  readonly instance_id: string;
  readonly cell_id: string;
  readonly run_id: string;
  readonly logical_task_id: string;
  readonly task_run_id: string;
  readonly attempt: number;
  readonly attempt_id: string;
  readonly worker_role: string;
  readonly substrate: TaskCellSubstrate;
  readonly state: TaskCellState;
}

export interface InstanceRef {
  readonly run_id: string;
  readonly instance_id: string;
}

// ── Operation requests + results ─────────────────────────────────────────────

export type TaskCellFailure =
  | "malformed_assignment"
  | "identity_mismatch"
  | "dependencies_blocked"
  | "illegal_state"
  | "timed_out"
  | "validation_failed"
  | "not_authorized"
  | "termination_failed"
  | "unknown_instance";

export interface OpFailure {
  ok: false;
  failure: TaskCellFailure;
  reason: string;
  instance: InstanceHandle;
  /** Set when `failure === "dependencies_blocked"`. */
  blocked_on?: string[];
}

export interface SpawnCellRequest {
  run_id: string;
  cell_id: string;
  goal_id: string;
  phase_id: string;
  step_id: string;
  team_id: string;
  logical_task_id: string;
  fanout: CellFanout;
  lead: LeadBinding;
}

export interface SpawnInstanceRequest {
  task_run_id: string;
  attempt: number;
  /** Required when `attempt > 1` (D4) — `spawnInstance` throws otherwise. */
  previous_attempt_id?: string | null;
  retry_reason?: string | null;
  worker_role: string;
  specialist_type_id: string;
  specialist_type_version: string;
  specialist_type_hash: string;
  specialist_profile_id: string;
  specialist_profile_hash: string;
  host_id: string;
  adapter_id: string;
  host_capabilities_hash: string;
  model_tier: ModelTier;
  model_id?: string | null;
  /** Fresh per instance — an attempt NEVER reuses the prior attempt's bundle (D3). */
  context_bundle_id: string;
  context_bundle_hash: string;
  projection: ToolPermissionProjection;
  budgets: TaskCellBudgets;
}

export type AwaitReadyResult = { ok: true; instance: InstanceHandle } | OpFailure;

export type DeliverAssignmentResult =
  | {
      ok: true;
      instance: InstanceHandle;
      assignment: TaskAssignmentV2;
      assignment_path: string;
    }
  | OpFailure;

export type AwaitAssignmentAckResult =
  | { ok: true; instance: InstanceHandle; acknowledged_at: string }
  | OpFailure;

export interface InstanceObservation {
  handle: InstanceHandle;
  instance: AgentInstanceV1;
  attempt: TaskAttemptV1;
  assignment: TaskAssignmentV2 | null;
  last_heartbeat_at: string | null;
}

export interface HeartbeatResult {
  ok: boolean;
  instance: InstanceHandle;
  last_heartbeat_at: string | null;
}

export type CollectHandoffResult =
  | {
      ok: true;
      instance: InstanceHandle;
      validation: HandoffValidationV1;
    }
  | (OpFailure & { validation?: HandoffValidationV1 });

export interface AcceptHandoffRequest {
  acceptance_policy_version: string;
  authorities_required: AcceptanceAuthority[];
  authorities_observed: AuthorityDecision[];
  reviewer_cell_id?: string | null;
}

export type AcceptHandoffResult =
  | { ok: true; instance: InstanceHandle; acceptance: HandoffAcceptanceV1 }
  | OpFailure;

export interface RejectHandoffRequest {
  acceptance_policy_version: string;
  authorities_required: AcceptanceAuthority[];
  authorities_observed: AuthorityDecision[];
  reviewer_cell_id?: string | null;
  reason: string;
}

export type RejectHandoffResult =
  | { ok: true; instance: InstanceHandle; acceptance: HandoffAcceptanceV1 }
  | OpFailure;

export interface TerminalOutcome {
  instance_id: string;
  state: TerminalState;
  reason: string | null;
  terminated_at: string;
  orphaned: boolean;
  reap_attempts: number;
}

export interface TerminateRequest {
  /**
   * Forced termination WITHOUT an acceptance record. Requires a `reason` and
   * writes an explicit rejection/failure terminal event — NEVER a silent kill (D5).
   */
  force?: boolean;
  reason?: string;
  /** The terminal state a forced termination records. Defaults to `failed`. */
  forced_state?: Extract<TerminalState, "failed" | "cancelled" | "rejected" | "timed_out">;
}

export type TerminateResult =
  | { ok: true; instance: InstanceHandle; outcome: TerminalOutcome }
  | OpFailure;

export type AwaitTerminatedResult =
  | { ok: true; instance: InstanceHandle; outcome: TerminalOutcome }
  | OpFailure;

export interface ReapResult {
  ok: boolean;
  reaped: boolean;
  instance: InstanceHandle;
  reap_attempts: number;
  outcome: TerminalOutcome | null;
}

export interface WaitOptions {
  timeout_ms: number;
}

// ── The durable record channel ───────────────────────────────────────────────

export interface TaskCellRecordSet {
  instances: AgentInstanceV1[];
  attempts: TaskAttemptV1[];
  assignments: TaskAssignmentV2[];
  validations: HandoffValidationV1[];
  acceptances: HandoffAcceptanceV1[];
}

/**
 * The authoritative on-disk record view of a run (D6 run-tree containment; D7
 * "auditable without chat transcripts"). A real backend reads the run tree; a
 * test double keeps the same records in memory. Either way, `readRecords` is what
 * a resume-after-crash reconstructs from.
 */
export interface TaskCellRecordStore {
  readRecords(run_id: string): Promise<TaskCellRecordSet>;
}

// ── The seam ─────────────────────────────────────────────────────────────────

/**
 * The lifecycle-bearing runtime seam (D5). Backend-specific MECHANICS live behind
 * adapters; the SEMANTICS asserted by the conformance suite are identical across
 * tmux / in-process / serial / remote.
 */
export interface TaskCellBackend {
  readonly substrate: TaskCellSubstrate;
  /** The serial floor (Rung 4) is 1; the other substrates run lanes concurrently. */
  readonly parallelism: number;
  isAvailable(): boolean;
  /** The durable record channel a resume reconstructs from. */
  readonly records: TaskCellRecordStore;

  // 1
  spawnCell(req: SpawnCellRequest): Promise<CellHandle>;
  // 2 — mints a UNIQUE instance_id + attempt_id; throws on missing D4 lineage.
  spawnInstance(cell: CellHandle, req: SpawnInstanceRequest): Promise<InstanceHandle>;
  // 3
  awaitReady(instance: InstanceHandle, opts?: WaitOptions): Promise<AwaitReadyResult>;
  // 4 — `unknown` on purpose: the assignment is validated fail-closed at the seam.
  deliverAssignment(
    instance: InstanceHandle,
    assignment: unknown
  ): Promise<DeliverAssignmentResult>;
  // 5 — the ack gate. `running` is unreachable without it.
  awaitAssignmentAck(
    instance: InstanceHandle,
    opts?: WaitOptions
  ): Promise<AwaitAssignmentAckResult>;
  // 6
  observe(ref: InstanceRef): Promise<InstanceObservation | null>;
  // 7
  heartbeat(ref: InstanceRef, at: string): Promise<HeartbeatResult>;
  // 8 — runs the deterministic floor and persists `guild.handoff_validation.v1`.
  collectHandoff(instance: InstanceHandle, opts?: WaitOptions): Promise<CollectHandoffResult>;
  // 9 — persists `guild.handoff_acceptance.v1`; ONLY this releases downstream.
  acceptHandoff(
    instance: InstanceHandle,
    req: AcceptHandoffRequest
  ): Promise<AcceptHandoffResult>;
  // 10 — persists a rejecting acceptance record; downstream stays blocked.
  rejectHandoff(
    instance: InstanceHandle,
    req: RejectHandoffRequest
  ): Promise<RejectHandoffResult>;
  // 11
  cancel(instance: InstanceHandle, reason: string): Promise<TerminateResult>;
  // 12 — authorized by the durable acceptance record, or explicitly forced.
  terminate(instance: InstanceHandle, req?: TerminateRequest): Promise<TerminateResult>;
  // 13
  awaitTerminated(
    instance: InstanceHandle,
    opts?: WaitOptions
  ): Promise<AwaitTerminatedResult>;
  // 14
  reapOrphan(ref: InstanceRef): Promise<ReapResult>;
}

// ── Crash recovery (adversarial test 15) ─────────────────────────────────────

export interface ReconstructedAttempt {
  attempt: number;
  attempt_id: string;
  task_run_id: string;
  instance_id: string;
  previous_attempt_id: string | null;
  retry_reason: string | null;
  terminal_state: TerminalState | null;
  orphaned: boolean;
  /** FALSE for every terminal attempt — a terminal instance is never revived (D4). */
  resumable: boolean;
}

export interface ReconstructedCell {
  run_id: string;
  cell_id: string;
  logical_task_id: string;
  attempts: ReconstructedAttempt[];
  latest_attempt: number;
  /** A resume MUST mint this attempt; it may never re-enter a terminal one. */
  next_attempt: number;
  open_instances: string[];
  terminal_instances: string[];
  orphaned_instances: string[];
  /** Every attempt > 1 chains to its predecessor with a `retry_reason` (D4). */
  lineage_ok: boolean;
}

/**
 * Reconstruct cell state from the durable records ALONE — no chat transcript, no
 * live handle, no orchestrator memory (D7, adversarial test 15). Terminal attempts
 * come back as `resumable: false`; the only legal continuation is `next_attempt`.
 */
export function reconstructCellState(records: TaskCellRecordSet): ReconstructedCell[] {
  const byCell = new Map<string, TaskAttemptV1[]>();
  for (const a of records.attempts) {
    const key = `${a.run_id} ${a.cell_id} ${a.logical_task_id}`;
    const list = byCell.get(key);
    if (list) list.push(a);
    else byCell.set(key, [a]);
  }

  const cells: ReconstructedCell[] = [];
  for (const [key, rawAttempts] of byCell) {
    const [run_id, cell_id, logical_task_id] = key.split(" ");
    const ordered = [...rawAttempts].sort((a, b) => a.attempt - b.attempt);

    const attempts: ReconstructedAttempt[] = ordered.map((a) => ({
      attempt: a.attempt,
      attempt_id: a.attempt_id,
      task_run_id: a.task_run_id,
      instance_id: a.instance_id,
      previous_attempt_id: a.previous_attempt_id,
      retry_reason: a.retry_reason,
      terminal_state: a.terminal_state,
      orphaned: a.orphaned,
      resumable: a.terminal_state === null,
    }));

    let lineage_ok = true;
    for (let i = 0; i < ordered.length; i++) {
      const a = ordered[i];
      if (a.attempt === 1) {
        if (a.previous_attempt_id !== null || a.retry_reason !== null) lineage_ok = false;
        continue;
      }
      const prior = ordered[i - 1];
      if (
        !prior ||
        prior.attempt !== a.attempt - 1 ||
        a.previous_attempt_id !== prior.attempt_id ||
        !a.retry_reason
      ) {
        lineage_ok = false;
      }
    }

    const latest_attempt = ordered.length > 0 ? ordered[ordered.length - 1].attempt : 0;
    cells.push({
      run_id,
      cell_id,
      logical_task_id,
      attempts,
      latest_attempt,
      next_attempt: latest_attempt + 1,
      open_instances: attempts.filter((a) => a.resumable).map((a) => a.instance_id),
      terminal_instances: attempts.filter((a) => !a.resumable).map((a) => a.instance_id),
      orphaned_instances: attempts.filter((a) => a.orphaned).map((a) => a.instance_id),
      lineage_ok,
    });
  }

  return cells.sort((a, b) => a.logical_task_id.localeCompare(b.logical_task_id));
}
