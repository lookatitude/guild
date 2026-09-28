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
 *  - `claimIsolatedLaunches` (disk, one-shot): the real launch consumes the
 *    instance's single launch claim with an exclusive create. A second launch of
 *    the same instance, under any cwd spelling, refuses. Admission is not a
 *    reusable file check.
 *
 * Refusals throw `IsolatedSpawnRefused`; the message starts with
 * `isolated_spawn_refused:` like the launcher's rung refusal.
 */
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";

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
  if (!fs.existsSync(path.resolve(input.cwd, paths.attempt_path))) {
    throw new IsolatedSpawnRefused(
      `instance ${instanceId} (${logicalTaskId}) holds no admitted slot: reserveInstance never claimed its attempt record`,
    );
  }
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

export const ISOLATED_LAUNCH_CLAIM_SCHEMA = "guild.isolated_launch_claim.v1" as const;

/** The one launch claim of an instance, beside its assignment. */
export function launchClaimPath(ids: {
  runId: string;
  logicalTaskId: string;
  instanceId: string;
  attempt?: number;
  guildDir?: string;
}): string {
  const paths = taskCellPaths(
    { run_id: ids.runId, logical_task_id: ids.logicalTaskId, attempt: ids.attempt ?? 1, instance_id: ids.instanceId },
    { guildDir: ids.guildDir },
  );
  return path.join(paths.instance_dir, "launch-claim.json");
}

export interface IsolatedLaunchLane {
  logicalTaskId: string | undefined;
  instanceId: string | undefined;
  attempt?: number;
}

/**
 * Admit and consume, all or nothing: every lane must pass
 * `assertIsolatedLaneAdmitted`, then each lane's launch claim is created with
 * `wx` (O_EXCL). If any claim already exists, the claims this call created are
 * removed and the launch refuses naming the launch that holds it. Call it only
 * immediately before the process or pane is created.
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
        instanceId: lane.instanceId!,
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
      for (const own of created) fs.rmSync(own, { force: true });
      let holder = "an earlier launch";
      try {
        const prior = JSON.parse(fs.readFileSync(file, "utf8")) as { launch_id?: unknown };
        if (typeof prior.launch_id === "string") holder = `launch ${prior.launch_id}`;
      } catch {
        /* unreadable claim still refuses */
      }
      const code = (err as NodeJS.ErrnoException).code;
      throw new IsolatedSpawnRefused(
        code === "EEXIST"
          ? `instance ${lane.instanceId} (${lane.logicalTaskId}) was already launched by ${holder}; ` +
              `admission is one launch per instance. A relaunch reserves a new attempt.`
          : `instance ${lane.instanceId} (${lane.logicalTaskId}) launch claim could not be written (${code ?? "error"})`,
      );
    }
  }
}
