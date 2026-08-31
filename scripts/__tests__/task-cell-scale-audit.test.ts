import {
  AGENT_INSTANCE_SCHEMA,
  TASK_ATTEMPT_SCHEMA,
  assignmentId,
  buildTaskAssignmentV2,
  type AgentInstanceV1,
  type HandoffAcceptanceV1,
  type HandoffValidationV1,
  type TaskAttemptV1,
  type TaskCellRecordSet,
  type TaskCellSubstrate,
} from "../lib/core/contracts/task-cell-backend";
import {
  auditTaskCellScaleRecords,
  type TaskCellCapabilityIndex,
} from "../../src/modules/dispatch/workflows/task-cell-scale-audit";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const NOW = "2026-08-10T12:00:00.000Z";
const SUBSTRATES: TaskCellSubstrate[] = ["tmux", "in-process", "serial", "remote"];

function fixture(taskCount = 512): {
  records: TaskCellRecordSet;
  expected: string[];
  capabilityIndex: TaskCellCapabilityIndex;
} {
  const records: TaskCellRecordSet = { instances: [], attempts: [], assignments: [], validations: [], acceptances: [] };
  const expected = Array.from({ length: taskCount }, (_, index) => `T${String(index).padStart(4, "0")}`);
  const capabilityIndex: TaskCellCapabilityIndex = {};
  for (let index = 0; index < SUBSTRATES.length; index++) {
    capabilityIndex[`host-${index}`] = {
      allowed_substrates: [SUBSTRATES[index]],
      allowed_model_tiers: ["mid"],
      max_cost_usd: 2,
    };
  }

  for (let taskIndex = 0; taskIndex < expected.length; taskIndex++) {
    const logicalTaskId = expected[taskIndex];
    const attempts = logicalTaskId === "T0000" ? 2 : 1;
    let previousAttemptId: string | null = null;
    for (let attemptNumber = 1; attemptNumber <= attempts; attemptNumber++) {
      const substrateIndex = (taskIndex + attemptNumber - 1) % SUBSTRATES.length;
      const substrate = SUBSTRATES[substrateIndex];
      const instanceId = `instance-${logicalTaskId}-${attemptNumber}`;
      const attemptId = `attempt-${logicalTaskId}-${attemptNumber}`;
      const taskRunId = `task-run-${logicalTaskId}-${attemptNumber}`;
      const rejected = logicalTaskId === "T0000" && attemptNumber === 1;
      const instance: AgentInstanceV1 = {
        schema_version: AGENT_INSTANCE_SCHEMA,
        instance_id: instanceId,
        run_id: "run-scale",
        cell_id: `cell-${logicalTaskId}`,
        logical_task_id: logicalTaskId,
        task_run_id: taskRunId,
        attempt: attemptNumber,
        attempt_id: attemptId,
        worker_role: "backend",
        specialist_type_id: "backend",
        specialist_type_version: "1",
        specialist_type_hash: "sha256:type",
        specialist_profile_id: "backend",
        specialist_profile_hash: "sha256:profile",
        host_id: `host-${substrateIndex}`,
        adapter_id: `host-${substrateIndex}@1`,
        host_capabilities_hash: "sha256:host",
        substrate,
        model_tier: "mid",
        model_id: "model-mid",
        context_bundle_id: `.guild/context/run-scale/${logicalTaskId}-${attemptNumber}.md`,
        context_bundle_hash: `sha256:context-${taskIndex}-${attemptNumber}`,
        projection: { tools: ["read", "write"], permissions: [], recorded_losses: [] },
        budgets: { tokens: 2000, wall_clock_ms: 60_000, cost_usd: 1 },
        created_at: NOW,
        started_at: NOW,
        terminated_at: NOW,
        terminal_state: rejected ? "rejected" : "terminated",
        terminal_reason: rejected ? "review rejected" : null,
      };
      const attempt: TaskAttemptV1 = {
        schema_version: TASK_ATTEMPT_SCHEMA,
        run_id: "run-scale",
        cell_id: `cell-${logicalTaskId}`,
        logical_task_id: logicalTaskId,
        task_run_id: taskRunId,
        attempt: attemptNumber,
        attempt_id: attemptId,
        previous_attempt_id: previousAttemptId,
        retry_reason: attemptNumber === 1 ? null : "review rejected prior attempt",
        instance_id: instanceId,
        created_at: NOW,
        terminal_state: rejected ? "rejected" : "terminated",
        terminal_reason: rejected ? "review rejected" : null,
        terminated_at: NOW,
        immutable: true,
        orphaned: false,
        reap_attempts: 0,
      };
      const assignment = buildTaskAssignmentV2({
        run_id: "run-scale",
        cell_id: `cell-${logicalTaskId}`,
        goal_id: "goal-scale",
        phase_id: "build",
        step_id: logicalTaskId,
        team_id: "team-scale",
        logical_task_id: logicalTaskId,
        task_run_id: taskRunId,
        attempt: attemptNumber,
        attempt_id: attemptId,
        previous_attempt_id: previousAttemptId,
        retry_reason: attemptNumber === 1 ? null : "review rejected prior attempt",
        instance_id: instanceId,
        lead_binding_id: "lead-scale",
        team_lead_instance_id: null,
        worker_role: "backend",
        specialist_type_id: "backend",
        specialist_type_version: "1",
        specialist_type_hash: "sha256:type",
        specialist_profile_id: "backend",
        specialist_profile_hash: "sha256:profile",
        context_bundle_id: instance.context_bundle_id,
        context_bundle_hash: instance.context_bundle_hash,
        host_id: instance.host_id,
        adapter_id: instance.adapter_id,
        host_capabilities_hash: instance.host_capabilities_hash,
        objective: `complete ${logicalTaskId}`,
        non_goals: [],
        scope_paths: ["src"],
        output_schema: "guild.handoff_receipt.v1",
        acceptance_tests: ["npm test"],
        dependencies: [],
        projection: instance.projection,
        autonomy_policy: "supervised",
        budgets: instance.budgets,
        deadline: null,
        written_at: NOW,
      });
      const validation: HandoffValidationV1 = {
        schema_version: "guild.handoff_validation.v1",
        validation_result_id: `validation-${logicalTaskId}-${attemptNumber}`,
        run_id: "run-scale",
        cell_id: `cell-${logicalTaskId}`,
        logical_task_id: logicalTaskId,
        task_run_id: taskRunId,
        attempt: attemptNumber,
        instance_id: instanceId,
        assignment_id: assignmentId(assignment),
        receipt_id: `receipt-${logicalTaskId}-${attemptNumber}`,
        schema_valid: true,
        scope_valid: true,
        tests_passed: true,
        out_of_scope_files: [],
        failed_acceptance_tests: [],
        result: "passed",
        reason: null,
        validated_at: NOW,
      };
      const acceptance: HandoffAcceptanceV1 = {
        schema_version: "guild.handoff_acceptance.v1",
        run_id: "run-scale",
        cell_id: `cell-${logicalTaskId}`,
        logical_task_id: logicalTaskId,
        task_run_id: taskRunId,
        attempt: attemptNumber,
        instance_id: instanceId,
        assignment_id: validation.assignment_id,
        receipt_id: validation.receipt_id,
        validation_result_id: validation.validation_result_id,
        acceptance_policy_version: "1",
        authorities_required: ["deterministic_floor", "team_lead"],
        authorities_observed: [
          { authority: "deterministic_floor", decision: "accepted", at: NOW, reason: null },
          { authority: "team_lead", decision: rejected ? "rejected" : "accepted", at: NOW, reason: rejected ? "retry" : null },
        ],
        downstream_release_at: rejected ? null : NOW,
        termination_authorized_at: NOW,
      };
      records.instances.push(instance);
      records.attempts.push(attempt);
      records.assignments.push(assignment);
      records.validations.push(validation);
      records.acceptances.push(acceptance);
      previousAttemptId = attemptId;
    }
  }
  return { records, expected, capabilityIndex };
}

describe("TaskCell G12 scale and mixed-backend audit", () => {
  it("proves 512 logical tasks across four substrates with an immutable retry and exact joins", () => {
    const { records, expected, capabilityIndex } = fixture();
    const result = auditTaskCellScaleRecords({
      records,
      expected_logical_task_ids: expected,
      minimum_instances: 512,
      required_substrates: SUBSTRATES,
      capability_index: capabilityIndex,
    });
    expect(result.ok).toBe(true);
    expect(result.findings).toEqual([]);
    expect(result.counts).toMatchObject({
      logical_tasks: 512,
      instances: 513,
      retries: 1,
      substrates: 4,
    });

    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "guild-task-cell-scale-cli-"));
    const inputFile = path.join(cwd, "scale-input.json");
    fs.writeFileSync(inputFile, JSON.stringify({
      records,
      expected_logical_task_ids: expected,
      minimum_instances: 512,
      required_substrates: SUBSTRATES,
      capability_index: capabilityIndex,
    }));
    const cli = spawnSync("npx", ["tsx", path.resolve(__dirname, "../task-cell-scale-audit.ts"), "--input", inputFile], { encoding: "utf8" });
    expect(cli.status).toBe(0);
    expect(JSON.parse(cli.stdout)).toMatchObject({ ok: true, counts: { instances: 513 } });
  });

  it("fails closed on set drift, broken retry lineage, or routing outside the capability envelope", () => {
    const missing = fixture(8);
    missing.records.acceptances.pop();
    expect(auditTaskCellScaleRecords({
      records: missing.records,
      expected_logical_task_ids: missing.expected,
      minimum_instances: 8,
      required_substrates: SUBSTRATES,
      capability_index: missing.capabilityIndex,
    })).toMatchObject({ ok: false, findings: expect.arrayContaining([expect.stringMatching(/acceptance instance set differs/)]) });

    const lineage = fixture(8);
    lineage.records.attempts.find((item) => item.attempt === 2)!.previous_attempt_id = "wrong";
    expect(auditTaskCellScaleRecords({
      records: lineage.records,
      expected_logical_task_ids: lineage.expected,
      minimum_instances: 8,
      required_substrates: SUBSTRATES,
      capability_index: lineage.capabilityIndex,
    })).toMatchObject({ ok: false, findings: expect.arrayContaining([expect.stringMatching(/retry lineage/)]) });

    const routing = fixture(8);
    routing.records.instances[0].host_id = "unregistered-host";
    expect(auditTaskCellScaleRecords({
      records: routing.records,
      expected_logical_task_ids: routing.expected,
      minimum_instances: 8,
      required_substrates: SUBSTRATES,
      capability_index: routing.capabilityIndex,
    })).toMatchObject({ ok: false, findings: expect.arrayContaining([expect.stringMatching(/not in capability index/)]) });

    const malformed = fixture(8);
    (malformed.records.acceptances[0] as unknown as { authorities_observed: unknown }).authorities_observed = null;
    expect(() => auditTaskCellScaleRecords({
      records: malformed.records,
      expected_logical_task_ids: malformed.expected,
      minimum_instances: 8,
      required_substrates: SUBSTRATES,
      capability_index: malformed.capabilityIndex,
    })).not.toThrow();
    expect(auditTaskCellScaleRecords({
      records: malformed.records,
      expected_logical_task_ids: malformed.expected,
      minimum_instances: 8,
      required_substrates: SUBSTRATES,
      capability_index: malformed.capabilityIndex,
    }).findings).toEqual(expect.arrayContaining([expect.stringMatching(/invalid acceptance record/)]));
  });
});
