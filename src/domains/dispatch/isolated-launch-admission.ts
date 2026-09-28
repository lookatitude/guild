/**
 * Isolated-launch admission (KTD28 / R46, plr-wi-15-4).
 *
 * A lane worker that carries `GUILD_RUN_ID` + `GUILD_TASK_ID` but no
 * `GUILD_TASK_CELL_INSTANCE_ID` has no assignment the PreToolUse projection gate
 * can resolve, so it would run with the parent's full tool set. Two checks close
 * that at the launcher, before any pane or process exists:
 *
 *  - `assertLaneInstanceExported` (pure): a command/env builder that is about to
 *    export a task id must also export the instance id. Every pane builder calls
 *    it, so no launch path can emit the one without the other.
 *  - `assertIsolatedLaneAdmitted` (disk): at real launch, the instance must have
 *    been admitted through `reserveInstance` (its attempt record exists) and its
 *    `guild.task_assignment.v2` must be written and name this exact instance.
 *  - `assertReservationAdmitsInstance` (disk): the attempt record is the
 *    reservation. When it names an instance (the placeholder's `instance_id`,
 *    or the written `guild.task_attempt.v1`), no other instance id may launch
 *    under it, and a terminal attempt launches nothing.
 *  - `claimIsolatedLaunches` (disk, one-shot): the real launch consumes the
 *    RESERVATION's single launch claim, keyed by (run, task, attempt), with an
 *    exclusive create that records the instance it launched. A second launch
 *    under that attempt, by any instance id and under any cwd spelling,
 *    refuses. So live slots and spawned workers stay one to one.
 *
 * Refusals throw `IsolatedSpawnRefused`; the message starts with
 * `isolated_spawn_refused:` like the launcher's rung refusal.
 */
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";

import { INSTANCE_RESERVATION_SCHEMA } from "./instance-cap";
import { taskCellPaths, validateTaskAssignmentV2 } from "./task-cell-contract";

export const ISOLATED_SPAWN_REFUSED = "isolated_spawn_refused" as const;

export class IsolatedSpawnRefused extends Error {
  readonly code = ISOLATED_SPAWN_REFUSED;
  constructor(detail: string) {
    super(`${ISOLATED_SPAWN_REFUSED}: ${detail}`);
    this.name = "IsolatedSpawnRefused";
  }
}

function present(v: string | undefined | null): v is string {
  return typeof v === "string" && v.length > 0;
}

/** Pure: a task id is never exported to a run's worker without an instance id. */
export function assertLaneInstanceExported(spec: {
  runId?: string | null;
  taskId?: string | null;
  taskCellInstanceId?: string | null;
}): void {
  if (present(spec.runId) && present(spec.taskId) && !present(spec.taskCellInstanceId)) {
    throw new IsolatedSpawnRefused(
      `lane ${spec.taskId} in run ${spec.runId} has no GUILD_TASK_CELL_INSTANCE_ID. ` +
        `Admit it through reserveInstance and write its guild.task_assignment.v2 ` +
        `before launch (agent-team-launcher emitTaskCellsV2), or run it lead_only.`,
    );
  }
}

/**
 * Disk: the instance was admitted by `reserveInstance` and its v2 assignment is
 * written for exactly this run / task / instance.
 */
export function assertIsolatedLaneAdmitted(input: {
  cwd: string;
  runId: string;
  logicalTaskId: string | undefined;
  instanceId: string | undefined;
  attempt?: number;
  guildDir?: string;
}): void {
  const { runId, logicalTaskId, instanceId } = input;
  if (!present(logicalTaskId)) {
    throw new IsolatedSpawnRefused(`a lane in run ${runId} has no logical task id`);
  }
  assertLaneInstanceExported({ runId, taskId: logicalTaskId, taskCellInstanceId: instanceId });
  const paths = taskCellPaths(
    { run_id: runId, logical_task_id: logicalTaskId, attempt: input.attempt ?? 1, instance_id: instanceId! },
    { guildDir: input.guildDir },
  );
  let attemptRaw: string;
  try {
    attemptRaw = fs.readFileSync(path.resolve(input.cwd, paths.attempt_path), "utf8");
  } catch {
    throw new IsolatedSpawnRefused(
      `instance ${instanceId} (${logicalTaskId}) holds no admitted slot: reserveInstance never claimed its attempt record`,
    );
  }
  assertReservationAdmitsInstance({
    raw: attemptRaw,
    runId,
    logicalTaskId,
    attempt: input.attempt ?? 1,
    instanceId: instanceId!,
  });
  let assignment: ReturnType<typeof validateTaskAssignmentV2> = null;
  try {
    assignment = validateTaskAssignmentV2(
      JSON.parse(fs.readFileSync(path.resolve(input.cwd, paths.assignment_path), "utf8")),
    );
  } catch {
    assignment = null;
  }
  if (!assignment) {
    throw new IsolatedSpawnRefused(
      `instance ${instanceId} (${logicalTaskId}) has no readable guild.task_assignment.v2 at ${paths.assignment_path}`,
    );
  }
  if (
    assignment.run_id !== runId ||
    assignment.logical_task_id !== logicalTaskId ||
    assignment.instance_id !== instanceId
  ) {
    throw new IsolatedSpawnRefused(
      `the assignment at ${paths.assignment_path} names ${assignment.run_id}/${assignment.logical_task_id}/` +
        `${assignment.instance_id}, not ${runId}/${logicalTaskId}/${instanceId}`,
    );
  }
}

/**
 * Disk: the attempt record at `attempt_path` is the reservation. It must be for
 * this run / task / attempt, must not be terminal, and when it names an
 * instance, that instance is the only one it admits. A placeholder that names
 * no instance is bound by the first launch claim instead.
 */
export function assertReservationAdmitsInstance(input: {
  raw: string;
  runId: string;
  logicalTaskId: string;
  attempt: number;
  instanceId: string;
}): void {
  const { runId, logicalTaskId, attempt, instanceId } = input;
  const label = `attempt ${attempt} of ${logicalTaskId}`;
  let record: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(input.raw);
    if (parsed === null || typeof parsed !== "object") throw new Error("not an object");
    record = parsed as Record<string, unknown>;
  } catch {
    throw new IsolatedSpawnRefused(`${label} in run ${runId} has an unreadable attempt record`);
  }
  const isReservation = record["schema_version"] === INSTANCE_RESERVATION_SCHEMA;
  if (!isReservation && record["schema_version"] !== "guild.task_attempt.v1") {
    throw new IsolatedSpawnRefused(`${label} in run ${runId} has no reservation or attempt record`);
  }
  if (record["run_id"] !== runId || record["logical_task_id"] !== logicalTaskId || record["attempt"] !== attempt) {
    throw new IsolatedSpawnRefused(`the attempt record for ${label} is not for run ${runId}`);
  }
  const terminal = record["terminal_state"];
  if (!isReservation && terminal !== null && terminal !== undefined) {
    throw new IsolatedSpawnRefused(`${label} is terminal (${String(terminal)}); a relaunch reserves a new attempt`);
  }
  const admitted = record["instance_id"];
  if (!isReservation && typeof admitted !== "string") {
    throw new IsolatedSpawnRefused(`the attempt record for ${label} names no instance`);
  }
  if (typeof admitted === "string" && admitted !== instanceId) {
    throw new IsolatedSpawnRefused(`${label} admitted instance ${admitted}, not ${instanceId}`);
  }
}

export const ISOLATED_LAUNCH_CLAIM_SCHEMA = "guild.isolated_launch_claim.v1" as const;

/** The one launch claim of a reservation, beside its attempt record. */
export function launchClaimPath(ids: {
  runId: string;
  logicalTaskId: string;
  attempt?: number;
  guildDir?: string;
}): string {
  const paths = taskCellPaths(
    { run_id: ids.runId, logical_task_id: ids.logicalTaskId, attempt: ids.attempt ?? 1, instance_id: "claim" },
    { guildDir: ids.guildDir },
  );
  return path.join(paths.attempt_dir, "launch-claim.json");
}

export interface IsolatedLaunchLane {
  logicalTaskId: string | undefined;
  instanceId: string | undefined;
  attempt?: number;
}

/**
 * Admit and consume, all or nothing: every lane must pass
 * `assertIsolatedLaneAdmitted`, then each lane's reservation claim (one per
 * run / task / attempt) is created with `wx` (O_EXCL) and records the instance
 * it launched. If any claim already exists, including one this call just made
 * for another instance of the same attempt, the claims this call created are
 * removed and the launch refuses naming the instance and launch that hold it.
 * Call it only immediately before the process or pane is created.
 */
export function claimIsolatedLaunches(input: {
  cwd: string;
  runId: string;
  launchId: string;
  lanes: ReadonlyArray<IsolatedLaunchLane>;
  guildDir?: string;
  now?: () => string;
}): void {
  if (!present(input.launchId)) throw new IsolatedSpawnRefused(`a launch in run ${input.runId} has no launch id`);
  let root: string;
  try {
    root = fs.realpathSync(input.cwd);
  } catch {
    throw new IsolatedSpawnRefused(`launch root ${input.cwd} does not resolve`);
  }
  for (const lane of input.lanes) {
    assertIsolatedLaneAdmitted({
      cwd: root,
      runId: input.runId,
      logicalTaskId: lane.logicalTaskId,
      instanceId: lane.instanceId,
      attempt: lane.attempt,
      guildDir: input.guildDir,
    });
  }
  const created: string[] = [];
  for (const lane of input.lanes) {
    const file = path.resolve(
      root,
      launchClaimPath({
        runId: input.runId,
        logicalTaskId: lane.logicalTaskId!,
        attempt: lane.attempt,
        guildDir: input.guildDir,
      }),
    );
    const claim = {
      schema_version: ISOLATED_LAUNCH_CLAIM_SCHEMA,
      run_id: input.runId,
      logical_task_id: lane.logicalTaskId,
      attempt: lane.attempt ?? 1,
      instance_id: lane.instanceId,
      launch_id: input.launchId,
      nonce: crypto.randomBytes(16).toString("hex"),
      root,
      claimed_at: (input.now ?? (() => new Date().toISOString()))(),
    };
    try {
      fs.writeFileSync(file, `${JSON.stringify(claim, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
      created.push(file);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      let holder = "an unknown instance by an earlier launch";
      if (code === "EEXIST") {
        try {
          const prior = JSON.parse(fs.readFileSync(file, "utf8")) as { launch_id?: unknown; instance_id?: unknown };
          if (typeof prior.launch_id === "string") holder = `instance ${String(prior.instance_id)} by launch ${prior.launch_id}`;
        } catch {
          /* unreadable claim still refuses */
        }
      }
      for (const own of created) fs.rmSync(own, { force: true });
      const label = `attempt ${lane.attempt ?? 1} of ${lane.logicalTaskId}`;
      throw new IsolatedSpawnRefused(
        code === "EEXIST"
          ? `${label} already launched ${holder}; refusing ${lane.instanceId}. ` +
              `One reservation admits one launch. A relaunch reserves a new attempt.`
          : `${label} launch claim for ${lane.instanceId} could not be written (${code ?? "error"})`,
      );
    }
  }
}
