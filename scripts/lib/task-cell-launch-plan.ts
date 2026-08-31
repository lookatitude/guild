import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import type { Specialist } from "./core/contracts/team-backend";
import {
  taskCellPaths,
  validateTaskAssignmentV2,
  type TaskAssignmentV2,
} from "./core/contracts/task-cell-backend";
import {
  TEAM_RESULT_SCHEMA,
  isStation,
  type StationId,
  type TeamResultV1,
} from "../../src/modules/teams/workflows/station-composer";
import {
  readTeamResult,
  writeTeamResult,
} from "../../src/modules/teams/workflows/station-signals";

export interface TaskCellLaunchLane extends Specialist {
  taskId: string;
  dispatch_key: string;
  task_cell_instance_id: string;
  task_cell_assignment_path: string;
}

function safeSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9_.-]/g, "_");
}

/**
 * Expand the authored per-role team into the production per-task launch plan.
 * The semantic role stays in `name`; only the transport handle is task-unique.
 */
export function expandTaskCellLaunchLanes(
  runId: string,
  specialists: readonly Specialist[],
  ownerMap: ReadonlyMap<string, readonly string[]>,
): TaskCellLaunchLane[] {
  const lanes: TaskCellLaunchLane[] = [];
  const taskIds = new Set<string>();
  const dispatchKeys = new Set<string>();
  const instanceIds = new Set<string>();

  for (const specialist of specialists) {
    const owned = ownerMap.get(specialist.name);
    const effective = owned && owned.length > 0 ? owned : [specialist.name];
    for (const rawTaskId of effective) {
      const taskId = safeSegment(rawTaskId);
      if (!taskId || taskIds.has(taskId)) {
        throw new Error(`task-cell launch plan requires one unique logical task id; duplicate/empty: ${rawTaskId}`);
      }
      taskIds.add(taskId);
      const role = safeSegment(specialist.name);
      const dispatchKey = `${role}--${taskId}--a1`;
      const nonce = createHash("sha256")
        .update(`${runId}\0${specialist.name}\0${rawTaskId}\0attempt:1`)
        .digest("hex")
        .slice(0, 12);
      const instanceId = `${taskId}.a1.i-${nonce}`;
      if (dispatchKeys.has(dispatchKey) || instanceIds.has(instanceId)) {
        throw new Error(`task-cell launch identity collision for ${specialist.name}/${rawTaskId}`);
      }
      dispatchKeys.add(dispatchKey);
      instanceIds.add(instanceId);
      lanes.push({
        ...specialist,
        taskId,
        dispatch_key: dispatchKey,
        task_cell_instance_id: instanceId,
        task_cell_assignment_path: taskCellPaths({
          run_id: runId,
          logical_task_id: taskId,
          attempt: 1,
          instance_id: instanceId,
        }).assignment_path,
      });
    }
  }
  return lanes;
}

/** Build the typed station result from the exact identities handed to backends. */
export function buildStationTaskCellResult(
  station: string,
  teamPlanRef: string,
  lanes: readonly TaskCellLaunchLane[],
): TeamResultV1 {
  if (!isStation(station)) throw new Error(`unknown TaskCell station: ${station}`);
  return {
    schema_version: TEAM_RESULT_SCHEMA,
    station,
    team_plan_ref: teamPlanRef,
    lanes: lanes.map((lane) => ({
      role: lane.name,
      instance_id: lane.task_cell_instance_id,
      handoff_ref: null,
      acceptance_ref: null,
    })),
  };
}

function assignmentFiles(cwd: string, runId: string): string[] {
  const root = path.join(cwd, ".guild", "runs", runId, "task-cells");
  const out: string[] = [];
  const walk = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else if (entry.isFile() && entry.name === "assignment.json") out.push(abs);
    }
  };
  walk(root);
  return out.sort();
}

function readAssignment(file: string): TaskAssignmentV2 {
  let parsed: unknown;
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("not a regular file");
    parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`invalid TaskCell assignment ${file}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const valid = validateTaskAssignmentV2(parsed);
  if (!valid) throw new Error(`invalid TaskCell assignment ${file}: schema validation failed`);
  return valid;
}

function regularFile(cwd: string, relativePath: string): boolean {
  try {
    const stat = fs.lstatSync(path.resolve(cwd, relativePath));
    return stat.isFile() && !stat.isSymbolicLink();
  } catch {
    return false;
  }
}

/**
 * Enrich the launcher-authored station result from canonical TaskCell records.
 * Runtime identities are immutable: this join may only fill handoff/acceptance
 * pointers after proving exact assignment/result identity-set equality.
 */
export function reconcileStationTaskCellResult(
  cwd: string,
  runId: string,
  station: string,
): TeamResultV1 {
  if (!isStation(station)) throw new Error(`unknown TaskCell station: ${station}`);
  const stationId: StationId = station;
  const existing = readTeamResult(cwd, runId, stationId);
  if (!existing) throw new Error(`missing or invalid launcher-authored team_result for ${runId}/${station}`);

  const assignments = assignmentFiles(cwd, runId)
    .map(readAssignment)
    .filter((assignment) => assignment.run_id === runId && assignment.phase_id === station);
  const byInstance = new Map<string, TaskAssignmentV2>();
  for (const assignment of assignments) {
    if (byInstance.has(assignment.instance_id)) {
      throw new Error(`duplicate TaskCell assignment identity: ${assignment.instance_id}`);
    }
    byInstance.set(assignment.instance_id, assignment);
  }

  const resultIds = existing.lanes.map((lane) => lane.instance_id).sort();
  const assignmentIds = [...byInstance.keys()].sort();
  if (JSON.stringify(resultIds) !== JSON.stringify(assignmentIds)) {
    throw new Error(
      `team_result/assignment identity SET mismatch for ${runId}/${station}: ` +
      `result=[${resultIds.join(",")}] assignments=[${assignmentIds.join(",")}]`,
    );
  }

  const reconciled: TeamResultV1 = {
    ...existing,
    lanes: existing.lanes.map((lane) => {
      const assignment = byInstance.get(lane.instance_id)!;
      if (lane.role !== assignment.worker_role) {
        throw new Error(
          `team_result role mismatch for ${lane.instance_id}: ${lane.role} != ${assignment.worker_role}`,
        );
      }
      const paths = taskCellPaths({
        run_id: assignment.run_id,
        logical_task_id: assignment.logical_task_id,
        attempt: assignment.attempt,
        instance_id: assignment.instance_id,
      });
      const handoffRef = regularFile(cwd, paths.handoff_path) ? paths.handoff_path : null;
      const acceptanceRef = regularFile(cwd, paths.acceptance_path) ? paths.acceptance_path : null;
      if (lane.handoff_ref !== null && lane.handoff_ref !== handoffRef) {
        throw new Error(`conflicting handoff_ref for ${lane.instance_id}`);
      }
      if (lane.acceptance_ref !== null && lane.acceptance_ref !== acceptanceRef) {
        throw new Error(`conflicting acceptance_ref for ${lane.instance_id}`);
      }
      return { ...lane, handoff_ref: handoffRef, acceptance_ref: acceptanceRef };
    }),
  };
  writeTeamResult(cwd, runId, reconciled);
  return reconciled;
}
