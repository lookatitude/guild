/**
 * The authoritative TaskCell → artifact-bus join (G10).
 *
 * Lifecycle writers publish the exact bytes they persist. Closeout then walks
 * the run tree and requires a hash-bound bus event for every required record;
 * chat transcripts are neither read nor accepted as evidence.
 */
import * as fs from "fs";
import * as path from "path";

import { casVerify, publish, readBusLog, sha256, type BusEventV1 } from "../../communication";
import {
  HANDOFF_ACCEPTANCE_SCHEMA,
  HANDOFF_VALIDATION_SCHEMA,
  taskCellPaths,
  validateAgentInstanceV1,
  validateTaskAssignmentV2,
  validateTaskAttemptV1,
  type TaskAssignmentV2,
} from "./task-cell-contract";
import { STATIONS, readTeamPlan, readTeamResult, type TeamResultV1 } from "../../teams";

export const TASK_CELL_TERMINAL_SCHEMA = "guild.task_cell_terminal.v1" as const;

export type TaskCellArtifactKind =
  | "team_plan"
  | "team_result"
  | "instance"
  | "attempt"
  | "assignment"
  | "ack"
  | "context"
  | "heartbeat"
  | "handoff"
  | "validation"
  | "acceptance"
  | "terminal";

export interface TaskCellCoordinates {
  run_id: string;
  logical_task_id: string;
  attempt: number;
  instance_id: string;
}

export interface PublishedTaskCellArtifact {
  kind: TaskCellArtifactKind;
  path: string;
  sha256: string;
  seq: number;
}

export interface PublishTaskCellFileInput {
  cwd: string;
  ids: TaskCellCoordinates;
  kind: TaskCellArtifactKind;
  relativePath: string;
  hostId: string;
  role: string;
  now: () => string;
}

function runDir(cwd: string, runId: string): string {
  return path.join(cwd, ".guild", "runs", runId);
}

function topic(kind: TaskCellArtifactKind, ids: TaskCellCoordinates): string {
  const prefix =
    kind === "context"
      ? "context"
      : kind === "handoff"
        ? "handoff"
        : kind === "validation" || kind === "acceptance"
          ? "approval"
          : kind === "heartbeat"
            ? "heartbeat"
            : "status";
  return `${prefix}/task-cell/${ids.logical_task_id}/${ids.attempt}/${ids.instance_id}/${kind}`;
}

/** Publish exact persisted bytes. Missing files return null; callers decide whether optional. */
export function publishTaskCellFile(
  input: PublishTaskCellFileInput,
): PublishedTaskCellArtifact | null {
  const abs = path.resolve(input.cwd, input.relativePath);
  const root = path.resolve(input.cwd);
  const rel = path.relative(root, abs);
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) return null;
  let content: Buffer;
  try {
    const stat = fs.lstatSync(abs);
    if (!stat.isFile() || stat.isSymbolicLink()) return null;
    content = fs.readFileSync(abs);
  } catch {
    return null;
  }
  const event = publish(runDir(input.cwd, input.ids.run_id), {
    runId: input.ids.run_id,
    topic: topic(input.kind, input.ids),
    content,
    artifactPath: input.relativePath,
    publisher: { host_id: input.hostId, role: input.role },
    now: input.now,
  });
  if (!event || event.sha256 === null) return null;
  return { kind: input.kind, path: input.relativePath, sha256: event.sha256, seq: event.seq };
}

export interface TaskCellJoinAudit {
  schema_version: "guild.task_cell_artifact_join_audit.v1";
  run_id: string;
  require_closed: boolean;
  ok: boolean;
  cells: number;
  artifacts: PublishedTaskCellArtifact[];
  missing: string[];
  invalid: string[];
}

function walkAssignments(cwd: string, runId: string): string[] {
  const root = path.join(runDir(cwd, runId), "task-cells");
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

function parseJson(file: string): unknown | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function latestEventForPath(events: readonly BusEventV1[], relPath: string): BusEventV1 | null {
  const matching = events.filter((event) => event.path === relPath);
  const latest = matching.length === 0 ? null : matching[matching.length - 1];
  return latest?.event === "artifact.retracted" ? null : latest;
}

function expectedContextPath(assignment: TaskAssignmentV2): string | null {
  const rel = assignment.context_bundle_id;
  const prefix = path.join(".guild", "context", assignment.run_id) + path.sep;
  return rel.startsWith(prefix) ? rel : null;
}

function verifyArtifact(args: {
  cwd: string;
  runId: string;
  kind: TaskCellArtifactKind;
  relPath: string;
  events: readonly BusEventV1[];
  missing: string[];
  invalid: string[];
}): PublishedTaskCellArtifact | null {
  const label = `${args.kind}:${args.relPath}`;
  const abs = path.resolve(args.cwd, args.relPath);
  let bytes: Buffer;
  try {
    const stat = fs.lstatSync(abs);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      args.invalid.push(`${label} is not a regular contained file`);
      return null;
    }
    bytes = fs.readFileSync(abs);
  } catch {
    args.missing.push(label);
    return null;
  }
  const event = latestEventForPath(args.events, args.relPath);
  if (!event || event.sha256 === null) {
    args.missing.push(`${label} bus event`);
    return null;
  }
  const actual = sha256(bytes);
  if (event.sha256 !== actual || !casVerify(runDir(args.cwd, args.runId), event.sha256, bytes)) {
    args.invalid.push(`${label} bus/CAS hash mismatch`);
    return null;
  }
  return { kind: args.kind, path: args.relPath, sha256: actual, seq: event.seq };
}

/**
 * Reconstruct and validate every TaskCell join from durable files + bus/CAS.
 * `requireClosed` upgrades handoff/validation/acceptance/terminal from optional
 * lifecycle futures to mandatory closeout records.
 */
export function auditTaskCellArtifactJoin(input: {
  cwd: string;
  runId: string;
  requireClosed: boolean;
  /** Host-conformance probes exercise TaskCell mechanics outside a lifecycle station. */
  requireStationArtifacts?: boolean;
}): TaskCellJoinAudit {
  const missing: string[] = [];
  const invalid: string[] = [];
  const artifacts: PublishedTaskCellArtifact[] = [];
  const events = readBusLog(runDir(input.cwd, input.runId));
  const assignments: TaskAssignmentV2[] = [];
  const stationResults: TeamResultV1[] = [];
  const requireStationArtifacts = input.requireStationArtifacts ?? input.requireClosed;

  for (const station of STATIONS) {
    const planPath = path.join(".guild", "runs", input.runId, "team-plan", `${station}.json`);
    const resultPath = path.join(".guild", "runs", input.runId, "team-result", `${station}.json`);
    const hasPlan = fs.existsSync(path.resolve(input.cwd, planPath));
    const hasResult = fs.existsSync(path.resolve(input.cwd, resultPath));
    if (!hasPlan && !hasResult) continue;

    if (!hasPlan) missing.push(`team_plan:${planPath}`);
    else if (!readTeamPlan(input.cwd, input.runId, station)) invalid.push(`team_plan:${planPath} bus/CAS or schema mismatch`);
    else {
      const event = latestEventForPath(events, planPath);
      if (event?.sha256) artifacts.push({ kind: "team_plan", path: planPath, sha256: event.sha256, seq: event.seq });
      else missing.push(`team_plan:${planPath} bus event`);
    }

    if (!hasResult) {
      if (input.requireClosed) missing.push(`team_result:${resultPath}`);
    } else {
      const result = readTeamResult(input.cwd, input.runId, station);
      if (!result) invalid.push(`team_result:${resultPath} bus/CAS or schema mismatch`);
      else if (result.team_plan_ref !== planPath) invalid.push(`team_result:${resultPath} does not point to ${planPath}`);
      else {
        stationResults.push(result);
        const event = latestEventForPath(events, resultPath);
        if (event?.sha256) artifacts.push({ kind: "team_result", path: resultPath, sha256: event.sha256, seq: event.seq });
        else missing.push(`team_result:${resultPath} bus event`);
      }
    }
  }

  for (const absAssignment of walkAssignments(input.cwd, input.runId)) {
    const assignment = validateTaskAssignmentV2(parseJson(absAssignment));
    if (!assignment || assignment.run_id !== input.runId) {
      invalid.push(`assignment:${path.relative(input.cwd, absAssignment)} malformed or wrong run`);
      continue;
    }
    assignments.push(assignment);
    const ids: TaskCellCoordinates = {
      run_id: assignment.run_id,
      logical_task_id: assignment.logical_task_id,
      attempt: assignment.attempt,
      instance_id: assignment.instance_id,
    };
    const paths = taskCellPaths(ids);
    const required: Array<[TaskCellArtifactKind, string]> = [
      ["instance", paths.instance_path],
      ["attempt", paths.attempt_path],
      ["assignment", paths.assignment_path],
    ];
    const contextPath = expectedContextPath(assignment);
    if (contextPath === null) invalid.push(`context:${assignment.context_bundle_id} is not in this run context tree`);
    else required.push(["context", contextPath]);
    if (input.requireClosed) {
      required.push(
        ["ack", path.join(paths.instance_dir, "assignment-ack.json")],
        ["handoff", paths.handoff_path],
        ["validation", paths.validation_path],
        ["acceptance", paths.acceptance_path],
        ["terminal", paths.terminal_path],
      );
    }
    for (const [kind, relPath] of required) {
      const artifact = verifyArtifact({
        cwd: input.cwd,
        runId: input.runId,
        kind,
        relPath,
        events,
        missing,
        invalid,
      });
      if (artifact) artifacts.push(artifact);
    }

    const instance = validateAgentInstanceV1(parseJson(path.join(input.cwd, paths.instance_path)));
    if (!instance || instance.instance_id !== assignment.instance_id) {
      invalid.push(`instance:${paths.instance_path} does not bind the assignment identity`);
    }
    const attempt = validateTaskAttemptV1(parseJson(path.join(input.cwd, paths.attempt_path)));
    if (!attempt || attempt.instance_id !== assignment.instance_id) {
      invalid.push(`attempt:${paths.attempt_path} does not bind the assignment identity`);
    }
    if (contextPath !== null) {
      try {
        const actual = sha256(fs.readFileSync(path.join(input.cwd, contextPath)));
        if (assignment.context_bundle_hash !== `sha256:${actual}`) {
          invalid.push(`context hash mismatch for ${assignment.instance_id}`);
        }
      } catch {
        /* missing already reported above */
      }
    }

    if (input.requireClosed) {
      const validation = parseJson(path.join(input.cwd, paths.validation_path)) as Record<string, unknown> | null;
      const ack = parseJson(path.join(input.cwd, path.join(paths.instance_dir, "assignment-ack.json"))) as Record<string, unknown> | null;
      const acceptance = parseJson(path.join(input.cwd, paths.acceptance_path)) as Record<string, unknown> | null;
      const terminal = parseJson(path.join(input.cwd, paths.terminal_path)) as Record<string, unknown> | null;
      if (!ack || ack.schema_version !== "guild.assignment_ack.v1" ||
          ack.assignment_id !== `${assignment.task_run_id}:${assignment.attempt}:${assignment.instance_id}`) {
        invalid.push(`assignment ack join mismatch for ${assignment.instance_id}`);
      }
      if (!validation || validation.schema_version !== HANDOFF_VALIDATION_SCHEMA ||
          validation.assignment_id !== `${assignment.task_run_id}:${assignment.attempt}:${assignment.instance_id}`) {
        invalid.push(`validation join mismatch for ${assignment.instance_id}`);
      }
      if (!acceptance || acceptance.schema_version !== HANDOFF_ACCEPTANCE_SCHEMA ||
          acceptance.assignment_id !== `${assignment.task_run_id}:${assignment.attempt}:${assignment.instance_id}` ||
          acceptance.validation_result_id !== validation?.validation_result_id) {
        invalid.push(`acceptance join mismatch for ${assignment.instance_id}`);
      }
      if (!terminal || terminal.schema_version !== TASK_CELL_TERMINAL_SCHEMA ||
          terminal.instance_id !== assignment.instance_id || terminal.terminal_state !== attempt?.terminal_state) {
        invalid.push(`terminal join mismatch for ${assignment.instance_id}`);
      }
      if (!attempt?.immutable || attempt.terminal_state === null) {
        invalid.push(`attempt ${assignment.attempt_id} is not terminal and immutable at closeout`);
      }
      if (instance?.terminal_state !== attempt?.terminal_state || instance?.terminated_at !== attempt?.terminated_at) {
        invalid.push(`instance terminal state mismatch for ${assignment.instance_id}`);
      }
    }
  }

  if (assignments.length === 0) missing.push(`run ${input.runId} has no task-cell assignments`);
  if (input.requireClosed) {
    if (requireStationArtifacts) {
      const assignedStations = new Set(assignments.map((assignment) => assignment.phase_id));
      for (const station of STATIONS) {
        if (!assignedStations.has(station)) continue;
        const planPath = path.join(".guild", "runs", input.runId, "team-plan", `${station}.json`);
        const resultPath = path.join(".guild", "runs", input.runId, "team-result", `${station}.json`);
        if (!fs.existsSync(path.resolve(input.cwd, planPath))) missing.push(`team_plan:${planPath}`);
        if (!fs.existsSync(path.resolve(input.cwd, resultPath))) missing.push(`team_result:${resultPath}`);
      }
    }
    for (const result of stationResults) {
      const expected = assignments
        .filter((assignment) => assignment.phase_id === result.station)
        .map((assignment) => assignment.instance_id)
        .sort();
      const observed = result.lanes.map((lane) => lane.instance_id).sort();
      if (JSON.stringify(observed) !== JSON.stringify(expected)) {
        invalid.push(`team_result/${result.station} assignment identity set mismatch`);
      }
    }
    for (const assignment of assignments) {
      for (const dependency of assignment.dependencies) {
        const upstream = assignments.find((candidate) => candidate.logical_task_id === dependency.logical_task_id);
        if (!upstream || dependency.accepted_artifact_ref === null) {
          invalid.push(`dependency join unresolved: ${assignment.logical_task_id} -> ${dependency.logical_task_id}`);
        }
      }
    }
  }

  return {
    schema_version: "guild.task_cell_artifact_join_audit.v1",
    run_id: input.runId,
    require_closed: input.requireClosed,
    ok: missing.length === 0 && invalid.length === 0,
    cells: assignments.length,
    artifacts,
    missing,
    invalid,
  };
}
