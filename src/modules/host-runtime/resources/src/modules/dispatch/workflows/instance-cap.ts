/**
 * `dispatch.max_instances` — the per-run concurrency cap (R46, KTD30).
 *
 * Four is CONCURRENCY, not a roster cap: `team_decision.v1` still approves the
 * full team, and this only bounds how many worker instances are live in one run
 * at once. The distinction matters because the operator disabled the cost gate
 * on fan-out (ADR resolved decision 5) — signals decide the shape of the team,
 * this decides how much of it runs at the same moment.
 *
 * ONE ADMISSION ENTRY. `reserveInstance` is the only export that can say yes,
 * and saying yes is the same act as claiming the slot. There is deliberately no
 * observe-only "is there room?" function any more: each earlier round shipped
 * one, and each time a caller used the observation instead of the claim and two
 * spawns raced past the cap. A predicate that answers without claiming is the bug.
 *
 * THE RESERVATION IS THE ATTEMPT'S LIVE MARKER. One file — the attempt record's
 * own path — created with an exclusive `wx`. Until the dispatch succeeds it
 * holds a `guild.instance_reservation.v1` placeholder that counts as live; on
 * success the real `guild.task_attempt.v1` replaces it in place; on failure it is
 * unlinked. A separate reservation file was a second thing to count, and while
 * both existed the run was charged twice for one slot.
 *
 * The refusal reuses the CLOSED `TaskCellFailure` enum (`not_authorized`): the
 * cap is a policy that does not authorize a fifth live instance. Adding a member
 * to that enum, or changing the default of 4, is an operator decision.
 */
import * as fs from "fs";
import * as crypto from "node:crypto";
import * as path from "path";

import { deepFreeze } from "../../kernel";
import { withStableLock } from "../../lifecycle";
import { taskCellPaths, type InstanceHandle, type OpFailure, type TaskCellFailure } from "./task-cell-contract";

/** KTD30 / R46. Changing this is an operator decision, not a lane's. */
export const DEFAULT_MAX_INSTANCES = 4;

/** The closed-enum member a cap refusal reports. */
export const INSTANCE_CAP_FAILURE = "not_authorized" as const satisfies TaskCellFailure;

/**
 * The placeholder an admitted-but-not-yet-written attempt holds.
 *
 * It lives at the attempt record's own path, so the thing that counts occupancy
 * and the thing that claims it are the same file.
 */
export const INSTANCE_RESERVATION_SCHEMA = "guild.instance_reservation.v1" as const;

export interface InstanceReservationV1 {
  schema_version: typeof INSTANCE_RESERVATION_SCHEMA;
  run_id: string;
  logical_task_id: string;
  attempt: number;
  claimed_at: string;
  /**
   * Unique owner token (codex G-lane r4). `release()` deletes the placeholder
   * ONLY when the file still carries this token, under the run lock, so a stale
   * release from an earlier claimant can never delete another admission's slot.
   */
  owner: string;
}

export interface InstanceCapRefusal {
  ok: false;
  failure: typeof INSTANCE_CAP_FAILURE;
  reason: string;
  live: number;
  max: number;
}

/**
 * Resolve the cap from already-resolved policy. A missing key is the default,
 * never "unbounded": the whole point is that unbounded fan-out is not reachable
 * by omitting a setting.
 */
export function resolveMaxInstances(policy: Record<string, unknown> | null | undefined): number {
  const dispatch = policy?.["dispatch"];
  const raw =
    dispatch !== null && typeof dispatch === "object"
      ? (dispatch as Record<string, unknown>)["max_instances"]
      : undefined;
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 1) return DEFAULT_MAX_INSTANCES;
  return raw;
}

// ── Counting ─────────────────────────────────────────────────────────────────

interface RunScope {
  cwd: string;
  run_id: string;
  guildDir?: string;
}

function runDirOf(input: RunScope): string {
  return taskCellPaths(
    { run_id: input.run_id, logical_task_id: "probe", attempt: 1, instance_id: "probe" },
    { guildDir: input.guildDir },
  ).run_dir;
}

function absoluteRunDir(input: RunScope): string {
  return path.resolve(input.cwd, runDirOf(input));
}

function attemptFile(input: RunScope & { logical_task_id: string; attempt: number }): string {
  return path.resolve(
    input.cwd,
    taskCellPaths(
      {
        run_id: input.run_id,
        logical_task_id: input.logical_task_id,
        attempt: input.attempt,
        instance_id: "probe",
      },
      { guildDir: input.guildDir },
    ).attempt_path,
  );
}

/** Is this the placeholder a reservation wrote, rather than a real attempt? */
export function isInstanceReservation(raw: string): boolean {
  try {
    return (
      (JSON.parse(raw) as { schema_version?: unknown }).schema_version ===
      INSTANCE_RESERVATION_SCHEMA
    );
  } catch {
    return false;
  }
}

/** Walk every `attempt.json` in the run, newest-agnostic, and classify it. */
function forEachAttemptFile(input: RunScope, visit: (raw: string | null) => void): void {
  const cellsDir = path.resolve(input.cwd, runDirOf(input), "task-cells");
  let cells: string[];
  try {
    cells = fs.readdirSync(cellsDir);
  } catch {
    return;
  }
  for (const cell of cells) {
    const attemptsDir = path.join(cellsDir, cell, "attempts");
    let attempts: string[];
    try {
      attempts = fs.readdirSync(attemptsDir);
    } catch {
      continue;
    }
    for (const attempt of attempts) {
      try {
        visit(fs.readFileSync(path.join(attemptsDir, attempt, "attempt.json"), "utf8"));
      } catch {
        // No attempt file in this directory at all — nothing claimed it.
      }
    }
  }
}

/**
 * Count the run's LIVE worker slots from the run tree on disk.
 *
 * ONE source: `attempt.json`. A reservation placeholder is live (it is a slot
 * someone is using), a non-terminal attempt is live, and a terminal attempt is
 * not (D4 terminal attempts are immutable records, not occupancy). Because the
 * reservation and the attempt are the same file, a slot is counted exactly once
 * from claim to termination — never twice during the handover.
 */
export function countLiveRunInstances(input: RunScope): number {
  let live = 0;
  forEachAttemptFile(input, (raw) => {
    if (raw === null) return;
    let parsed: { terminal_state?: unknown; schema_version?: unknown };
    try {
      parsed = JSON.parse(raw) as { terminal_state?: unknown; schema_version?: unknown };
    } catch {
      // An unreadable attempt file counts as LIVE. Fail-closed: the one thing
      // worse than refusing a spawn is admitting one because a record could not
      // be parsed.
      live += 1;
      return;
    }
    if (parsed.schema_version === INSTANCE_RESERVATION_SCHEMA) {
      live += 1;
      return;
    }
    if (parsed.terminal_state === null || parsed.terminal_state === undefined) live += 1;
  });
  return live;
}

/** Slots whose real attempt record has not replaced the placeholder yet. */
export function countOpenReservations(input: RunScope): number {
  let open = 0;
  forEachAttemptFile(input, (raw) => {
    if (raw !== null && isInstanceReservation(raw)) open += 1;
  });
  return open;
}

// ── The one admission entry ──────────────────────────────────────────────────

export interface InstanceReservation {
  logical_task_id: string;
  attempt: number;
  /** Absolute path of the attempt record this reservation became. */
  path: string;
  /** Live slots observed at the moment the claim was granted. */
  live: number;
  max: number;
  /**
   * Give the slot back. Unlinks the file ONLY while it is still a placeholder,
   * so a caller that releases after the real attempt record landed cannot delete
   * a durable record — and cannot free a slot the run is genuinely holding.
   *
   * There is no "release on success": once the attempt record replaces the
   * placeholder it IS the live marker, and the slot stays claimed until that
   * attempt goes terminal. Idempotent.
   */
  release(): void;
}

export type ReserveResult = { ok: true; reservation: InstanceReservation } | InstanceCapRefusal;

export type ReserveBatchResult =
  | { ok: true; reservations: InstanceReservation[] }
  | InstanceCapRefusal;

/**
 * Narrowing predicate for the refusal arm (the repo's test transform is
 * non-strict). Shared by the single and batch entries: both refuse with the same
 * shape, so a caller handles one refusal type either way.
 */
export function reserveRefused(
  result: ReserveResult | ReserveBatchResult,
): result is InstanceCapRefusal {
  return !result.ok;
}

/** Shape a cap refusal as the backend seam's `OpFailure`. */
export function instanceCapFailure(
  refusal: InstanceCapRefusal,
  instance: InstanceHandle,
): OpFailure {
  return { ok: false, failure: refusal.failure, reason: refusal.reason, instance };
}

export interface ReserveInstanceInput extends RunScope {
  logical_task_id: string;
  attempt: number;
  max?: number;
  now?: () => string;
}

/**
 * Claim one slot for one attempt, atomically. THE admission entry.
 *
 * The count and the claim both happen inside the per-run lock (the shipped
 * stable lock on the run record), and the claim is an exclusive `wx` create of
 * the attempt record's own path — so even if the lock were bypassed two callers
 * could not both own one attempt, and with it no caller can act on a stale count.
 *
 * Every production spawn path goes through this: the runtime's `spawnInstance`,
 * and the launcher's `emitTaskCellsV2`, which covers the tmux, cmux, in-process
 * and remote rungs because each of them emits its cells before it launches.
 */
export function reserveInstance(input: ReserveInstanceInput): ReserveResult {
  const max = input.max ?? DEFAULT_MAX_INSTANCES;
  const file = attemptFile(input);
  const owner = crypto.randomBytes(16).toString("hex");
  const release = (): void => {
    // Ownership, not just shape (codex G-lane r4): a placeholder at this path
    // that belongs to a LATER claimant is somebody else's live slot.
    withStableLock(absoluteRunDir(input), (): void => {
      try {
        const raw = fs.readFileSync(file, "utf8");
        if (!isInstanceReservation(raw)) return;
        const parsed = JSON.parse(raw) as Partial<InstanceReservationV1>;
        if (parsed.owner !== owner) return;
        fs.rmSync(file, { force: true });
      } catch {
        /* already gone, or already a real attempt record — leave it */
      }
    });
  };
  return withStableLock(absoluteRunDir(input), (): ReserveResult => {
    const live = countLiveRunInstances(input);
    if (live + 1 > max) {
      return {
        ok: false,
        failure: INSTANCE_CAP_FAILURE,
        live,
        max,
        reason:
          `dispatch.max_instances=${max} would be exceeded: ${live} live slot(s) in ` +
          `run ${input.run_id} plus 1 requested for ${input.logical_task_id} ` +
          `attempt ${input.attempt}. Refusing. Raise the policy key to fan out ` +
          `wider; concurrency is capped, the approved roster is not.`,
      };
    }
    const placeholder: InstanceReservationV1 = {
      schema_version: INSTANCE_RESERVATION_SCHEMA,
      run_id: input.run_id,
      logical_task_id: input.logical_task_id,
      attempt: input.attempt,
      claimed_at: (input.now ?? (() => new Date().toISOString()))(),
      owner,
    };
    fs.mkdirSync(path.dirname(file), { recursive: true });
    try {
      fs.writeFileSync(file, `${JSON.stringify(placeholder, null, 2)}\n`, {
        encoding: "utf8",
        flag: "wx",
      });
    } catch {
      return {
        ok: false,
        failure: INSTANCE_CAP_FAILURE,
        live,
        max,
        reason:
          `${input.logical_task_id} attempt ${input.attempt} already has an attempt ` +
          `record in run ${input.run_id} — a retry mints a NEW attempt (D4); it does ` +
          `not re-claim this one.`,
      };
    }
    return {
      ok: true,
      reservation: {
        logical_task_id: input.logical_task_id,
        attempt: input.attempt,
        path: file,
        live,
        max,
        release,
      },
    };
  });
}

/**
 * Reserve a whole batch, all or nothing.
 *
 * The launcher's case: a team file naming six lanes is refused before the first
 * record is written, not after the fourth. A partial claim is rolled back, so a
 * refused batch leaves the run exactly as it found it.
 */
export function reserveInstanceBatch(input: {
  cwd: string;
  run_id: string;
  max?: number;
  guildDir?: string;
  now?: () => string;
  lanes: ReadonlyArray<{ logical_task_id: string; attempt: number }>;
}): ReserveBatchResult {
  const held: InstanceReservation[] = [];
  for (const lane of input.lanes) {
    const claim = reserveInstance({
      cwd: input.cwd,
      run_id: input.run_id,
      guildDir: input.guildDir,
      max: input.max,
      now: input.now,
      logical_task_id: lane.logical_task_id,
      attempt: lane.attempt,
    });
    if (reserveRefused(claim)) {
      for (const prior of held) prior.release();
      return claim;
    }
    held.push(claim.reservation);
  }
  return { ok: true, reservations: held };
}

export const INSTANCE_CAP_CONTRACT = deepFreeze({
  policy_key: "dispatch.max_instances",
  default: DEFAULT_MAX_INSTANCES,
  failure: INSTANCE_CAP_FAILURE,
  admission_entry: "reserveInstance",
  reservation_schema: INSTANCE_RESERVATION_SCHEMA,
  note: "the reservation IS the attempt's live marker; there is no observe-only admission",
});
