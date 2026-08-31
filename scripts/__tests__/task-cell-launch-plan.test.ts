import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  buildStationTaskCellResult,
  expandTaskCellLaunchLanes,
  reconcileStationTaskCellResult,
} from "../lib/task-cell-launch-plan";
import type { Specialist } from "../lib/core/contracts/team-backend";
import { buildTaskAssignmentV2, taskCellPaths } from "../lib/core/contracts/task-cell-backend";
import { STATIONS, validateTeamResultV1 } from "../../src/modules/teams/workflows/station-composer";
import { readTeamResult, writeTeamResult } from "../../src/modules/teams/workflows/station-signals";

const backend: Specialist = { name: "backend", scope: "API", dependsOn: [] };

describe("task-cell production launch plan", () => {
  it("expands one specialist owning two tasks into two fresh transport lanes", () => {
    const lanes = expandTaskCellLaunchLanes(
      "run-1",
      [backend],
      new Map([["backend", ["T1-api", "T2-db"]]]),
    );
    expect(lanes).toHaveLength(2);
    expect(lanes.map((lane) => lane.name)).toEqual(["backend", "backend"]);
    expect(new Set(lanes.map((lane) => lane.taskId))).toEqual(new Set(["T1-api", "T2-db"]));
    expect(new Set(lanes.map((lane) => lane.dispatch_key)).size).toBe(2);
    expect(new Set(lanes.map((lane) => lane.task_cell_instance_id)).size).toBe(2);
    expect(lanes[0].task_cell_assignment_path).toContain(lanes[0].task_cell_instance_id);
    expect(lanes[1].task_cell_assignment_path).toContain(lanes[1].task_cell_instance_id);
    expect(backend).toEqual({ name: "backend", scope: "API", dependsOn: [] });
  });

  it("produces fresh instance identities for the same task in a new run", () => {
    const owners = new Map([["backend", ["T1"]]]);
    expect(expandTaskCellLaunchLanes("run-1", [backend], owners)[0].task_cell_instance_id)
      .not.toBe(expandTaskCellLaunchLanes("run-2", [backend], owners)[0].task_cell_instance_id);
  });

  it("fails closed when authored ownership assigns one task twice", () => {
    expect(() => expandTaskCellLaunchLanes(
      "run-1",
      [backend, { name: "qa", scope: "test", dependsOn: [] }],
      new Map([["backend", ["T1"]], ["qa", ["T1"]]]),
    )).toThrow(/unique logical task id/);
  });

  it("binds fresh typed results for every lifecycle station (AT12)", () => {
    for (const station of STATIONS) {
      const lanes = expandTaskCellLaunchLanes(
        `run-${station}`,
        [backend],
        new Map([["backend", [`${station}-task`]]]),
      );
      const result = buildStationTaskCellResult(
        station,
        `.guild/runs/run-${station}/team-plan/${station}.json`,
        lanes,
      );
      expect(validateTeamResultV1(result)).not.toBeNull();
      expect(result.station).toBe(station);
      expect(result.lanes[0].instance_id).toBe(lanes[0].task_cell_instance_id);
    }
  });

  it("keeps the launcher as the single writer of team-result runtime identities", () => {
    const skill = fs.readFileSync(
      path.join(__dirname, "../../skills/meta/execute-plan/SKILL.md"),
      "utf8",
    );
    expect(skill).toContain("launcher-authored `guild.team_result.v1`");
    expect(skill).toContain("MUST NOT mint, derive, replace, reorder, or drop `instance_id`");
    expect(skill).toContain("identity SET equality");
    expect(skill).not.toContain("derived from the lane's fresh runtime identity, e.g. its `task_run_id`+`attempt`");
  });

  it("reconciles only canonical handoff and acceptance refs without changing launcher identities", () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "guild-team-result-reconcile-"));
    const runId = "run-join";
    const lanes = expandTaskCellLaunchLanes(
      runId,
      [backend, { name: "qa", scope: "test", dependsOn: [] }],
      new Map([["backend", ["T1"]], ["qa", ["T2"]]]),
    );
    const initial = buildStationTaskCellResult(
      "build",
      `.guild/runs/${runId}/team-plan/build.json`,
      lanes,
    );
    writeTeamResult(cwd, runId, initial);

    for (const lane of lanes) {
      const assignment = buildTaskAssignmentV2({
        run_id: runId,
        cell_id: `cell-${lane.taskId}`,
        goal_id: "goal-1",
        phase_id: "build",
        step_id: lane.taskId,
        team_id: "team-1",
        logical_task_id: lane.taskId,
        task_run_id: `${lane.taskId}.tr1`,
        attempt: 1,
        attempt_id: `${lane.taskId}.att1`,
        previous_attempt_id: null,
        retry_reason: null,
        instance_id: lane.task_cell_instance_id,
        lead_binding_id: "lead-1",
        team_lead_instance_id: null,
        worker_role: lane.name,
        specialist_type_id: lane.name,
        specialist_type_version: "1",
        specialist_type_hash: "sha256:type",
        specialist_profile_id: lane.name,
        specialist_profile_hash: "sha256:profile",
        context_bundle_id: `.guild/context/${runId}/${lane.name}-${lane.taskId}.md`,
        context_bundle_hash: "sha256:context",
        host_id: "claude",
        adapter_id: "claude@1",
        host_capabilities_hash: "sha256:caps",
        objective: lane.scope,
        non_goals: [],
        scope_paths: [],
        output_schema: "guild.handoff_receipt.v1",
        acceptance_tests: [],
        dependencies: [],
        projection: { tools: [], permissions: [], recorded_losses: [] },
        autonomy_policy: "supervised",
        budgets: { tokens: null, wall_clock_ms: null, cost_usd: null },
        deadline: null,
        written_at: "2026-08-10T18:00:00.000Z",
      });
      const paths = taskCellPaths({
        run_id: runId,
        logical_task_id: lane.taskId,
        attempt: 1,
        instance_id: lane.task_cell_instance_id,
      });
      fs.mkdirSync(path.join(cwd, paths.instance_dir), { recursive: true });
      fs.writeFileSync(path.join(cwd, paths.assignment_path), JSON.stringify(assignment));
      fs.writeFileSync(path.join(cwd, paths.handoff_path), "{}\n");
      if (lane.name === "qa") fs.writeFileSync(path.join(cwd, paths.acceptance_path), "{}\n");
    }

    const beforeIds = initial.lanes.map((lane) => lane.instance_id);
    const reconciled = reconcileStationTaskCellResult(cwd, runId, "build");
    const persisted = readTeamResult(cwd, runId, "build")!;
    expect(reconciled.lanes.map((lane) => lane.instance_id)).toEqual(beforeIds);
    expect(persisted.lanes.map((lane) => lane.instance_id)).toEqual(beforeIds);
    expect(persisted.lanes[0].handoff_ref).toContain("handoff.json");
    expect(persisted.lanes[0].acceptance_ref).toBeNull();
    expect(persisted.lanes[1].acceptance_ref).toContain("handoff-acceptance.json");
  });

  it("fails closed when team-result and TaskCell assignment identity sets differ", () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "guild-team-result-mismatch-"));
    const runId = "run-mismatch";
    const lanes = expandTaskCellLaunchLanes(runId, [backend], new Map([["backend", ["T1"]]]));
    writeTeamResult(cwd, runId, buildStationTaskCellResult(
      "build",
      `.guild/runs/${runId}/team-plan/build.json`,
      lanes,
    ));
    expect(() => reconcileStationTaskCellResult(cwd, runId, "build")).toThrow(/identity SET mismatch/);
  });
});
