import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createHash } from "node:crypto";

import {
  FilesystemTaskCellRuntime,
  type TaskCellWorkerPort,
} from "../../src/modules/dispatch/workflows/task-cell-runtime";
import { auditTaskCellScaleRecords, type TaskCellCapabilityIndex } from "../../src/modules/dispatch/workflows/task-cell-scale-audit";
import { acknowledgeAssignment } from "../../src/modules/dispatch/workflows/task-assignment-v2";
import { mintRunBinding } from "../../src/modules/lifecycle/workflows/run-binding";
import {
  buildTaskAssignmentV2,
  taskCellPaths,
  type CellHandle,
  type InstanceHandle,
  type TaskCellSubstrate,
} from "../lib/core/contracts/task-cell-backend";

const NOW = () => "2026-08-10T13:00:00.000Z";
const SUBSTRATES: TaskCellSubstrate[] = ["tmux", "in-process", "serial", "remote"];

class ScaleWorker implements TaskCellWorkerPort {
  readonly mode = "native" as const;
  readonly losses: string[] = [];
  isAvailable(): boolean { return true; }
  spawn(): { ok: true; reason: null } { return { ok: true, reason: null }; }
  ready(): { ok: true; reason: null } { return { ok: true, reason: null }; }
  notifyAssignment(): { ok: true; reason: null } { return { ok: true, reason: null }; }
  terminate(): { ok: true; reason: null } { return { ok: true, reason: null }; }
}

describe("TaskCell production record-runtime scale proof", () => {
  it("executes 256 tasks plus a retry under four substrate profiles through a deterministic worker port", async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "guild-task-cell-runtime-scale-"));
    const runId = "run-runtime-scale";
    const binding = mintRunBinding({ root: cwd, run_id: runId });
    const runtimes = SUBSTRATES.map((substrate, substrateIndex) => {
      let sequence = 0;
      return new FilesystemTaskCellRuntime({
        cwd,
        substrate,
        parallelism: substrate === "serial" ? 1 : 32,
        binding: { binding_ref: binding.binding_ref },
        worker: new ScaleWorker(),
        now: NOW,
        idFactory: (kind) => `${substrateIndex}-${kind}-${++sequence}`,
      });
    });
    const expected = Array.from({ length: 256 }, (_, index) => `T${String(index).padStart(4, "0")}`);

    async function executeAttempt(
      runtime: FilesystemTaskCellRuntime,
      substrateIndex: number,
      cell: CellHandle,
      attempt: number,
      previous: InstanceHandle | null,
      reject: boolean,
    ): Promise<InstanceHandle> {
      const contextRel = `.guild/context/${runId}/${cell.logical_task_id}-${attempt}.md`;
      const context = `# ${cell.logical_task_id} attempt ${attempt}\n`;
      fs.mkdirSync(path.dirname(path.join(cwd, contextRel)), { recursive: true });
      fs.writeFileSync(path.join(cwd, contextRel), context);
      const instance = await runtime.spawnInstance(cell, {
        task_run_id: `${cell.logical_task_id}.tr${attempt}`,
        attempt,
        previous_attempt_id: previous?.attempt_id ?? null,
        retry_reason: attempt === 1 ? null : "review rejected prior attempt",
        worker_role: "backend",
        specialist_type_id: "backend",
        specialist_type_version: "1",
        specialist_type_hash: "sha256:type",
        specialist_profile_id: "backend",
        specialist_profile_hash: "sha256:profile",
        host_id: `host-${substrateIndex}`,
        adapter_id: `host-${substrateIndex}@1`,
        host_capabilities_hash: "sha256:host",
        model_tier: "mid",
        model_id: "model-mid",
        context_bundle_id: contextRel,
        context_bundle_hash: runtime.contentHash(context),
        projection: { tools: ["read", "write"], permissions: [], recorded_losses: [] },
        budgets: { tokens: 2000, wall_clock_ms: 60_000, cost_usd: 1 },
      });
      const ready = await runtime.awaitReady(instance);
      expect(ready.ok).toBe(true);
      const assignment = buildTaskAssignmentV2({
        run_id: runId,
        cell_id: cell.cell_id,
        goal_id: cell.goal_id,
        phase_id: cell.phase_id,
        step_id: cell.step_id,
        team_id: cell.team_id,
        logical_task_id: cell.logical_task_id,
        task_run_id: instance.task_run_id,
        attempt,
        attempt_id: instance.attempt_id,
        previous_attempt_id: previous?.attempt_id ?? null,
        retry_reason: attempt === 1 ? null : "review rejected prior attempt",
        instance_id: instance.instance_id,
        lead_binding_id: "lead-scale",
        team_lead_instance_id: null,
        worker_role: "backend",
        specialist_type_id: "backend",
        specialist_type_version: "1",
        specialist_type_hash: "sha256:type",
        specialist_profile_id: "backend",
        specialist_profile_hash: "sha256:profile",
        context_bundle_id: contextRel,
        context_bundle_hash: runtime.contentHash(context),
        host_id: `host-${substrateIndex}`,
        adapter_id: `host-${substrateIndex}@1`,
        host_capabilities_hash: "sha256:host",
        objective: `complete ${cell.logical_task_id}`,
        non_goals: [],
        scope_paths: ["src"],
        output_schema: "guild.handoff_receipt.v1",
        acceptance_tests: ["npm test"],
        dependencies: [],
        projection: { tools: ["read", "write"], permissions: [], recorded_losses: [] },
        autonomy_policy: "supervised",
        budgets: { tokens: 2000, wall_clock_ms: 60_000, cost_usd: 1 },
        deadline: null,
        written_at: NOW(),
      });
      expect((await runtime.deliverAssignment(instance, assignment)).ok).toBe(true);
      acknowledgeAssignment(cwd, assignment, NOW);
      expect((await runtime.awaitAssignmentAck(instance)).ok).toBe(true);
      const paths = taskCellPaths({ run_id: runId, logical_task_id: cell.logical_task_id, attempt, instance_id: instance.instance_id });
      const receiptPath = `.guild/runs/${runId}/handoffs/backend-${cell.logical_task_id}.md`;
      const receiptBytes = [
        "---",
        "schema_version: guild.handoff_receipt.v1",
        "ids:",
        "  initiative_id: null",
        `  run_id: ${runId}`,
        `  task_id: ${cell.logical_task_id}`,
        `  task_run_id: ${instance.task_run_id}`,
        "specialist: backend",
        "host:",
        `  selected: host-${substrateIndex}`,
        "  degraded: false",
        "  native_ref: null",
        "  independence: weak",
        "scope:",
        `  objective: complete ${cell.logical_task_id}`,
        "  in_scope: [src]",
        "  out_of_scope_touched: []",
        "status: completed",
        "changed_files:",
        "  - path: src/output.ts",
        "    change: modified",
        `    sha256_after: ${"a".repeat(64)}`,
        "evidence: []",
        "assumptions: []",
        "open_risks: []",
        "followups: []",
        `produced_at: ${NOW()}`,
        "---",
        "",
        "## changed_files",
        "- src/output.ts",
        "",
        "## opens_for",
        "- lead",
        "",
        "## assumptions",
        "- none",
        "",
        "## evidence",
        "- scale runtime",
        "",
        "## followups",
        "- none",
        "",
        "```guild.handoff.v2",
        JSON.stringify({
          schema_version: "guild.handoff.v2",
          task_id: cell.logical_task_id,
          tier: "mid",
          status: "done",
          summary: `completed ${cell.logical_task_id}`,
          artifacts: ["src/output.ts"],
          issues: [],
        }),
        "```",
        "",
      ].join("\n");
      fs.mkdirSync(path.dirname(path.join(cwd, receiptPath)), { recursive: true });
      fs.writeFileSync(path.join(cwd, receiptPath), receiptBytes);
      fs.writeFileSync(path.join(cwd, paths.handoff_path), `${JSON.stringify({
        receipt_id: `handoff-sha256:${createHash("sha256").update(receiptBytes).digest("hex")}`,
        receipt_path: receiptPath,
        schema_valid: true,
        claimed_changed_files: ["src/output.ts"],
        acceptance_tests_passed: ["npm test"],
        submitted_at: NOW(),
      }, null, 2)}\n`);
      expect((await runtime.collectHandoff(instance)).ok).toBe(true);
      const authorities = [
        { authority: "deterministic_floor" as const, decision: "accepted" as const, at: NOW(), reason: null },
        { authority: "team_lead" as const, decision: reject ? "rejected" as const : "accepted" as const, at: NOW(), reason: reject ? "retry" : null },
      ];
      if (reject) {
        expect((await runtime.rejectHandoff(instance, {
          acceptance_policy_version: "1",
          authorities_required: ["deterministic_floor", "team_lead"],
          authorities_observed: authorities,
          reason: "review rejected prior attempt",
        })).ok).toBe(true);
      } else {
        expect((await runtime.acceptHandoff(instance, {
          acceptance_policy_version: "1",
          authorities_required: ["deterministic_floor", "team_lead"],
          authorities_observed: authorities,
        })).ok).toBe(true);
        expect((await runtime.terminate(instance)).ok).toBe(true);
      }
      return instance;
    }

    for (let index = 0; index < expected.length; index++) {
      const runtimeIndex = index % runtimes.length;
      const runtime = runtimes[runtimeIndex];
      const logicalTaskId = expected[index];
      const cell = await runtime.spawnCell({
        run_id: runId,
        cell_id: `cell-${logicalTaskId}`,
        goal_id: "goal-scale",
        phase_id: "build",
        step_id: logicalTaskId,
        team_id: "team-scale",
        logical_task_id: logicalTaskId,
        fanout: "lead_plus_many",
        lead: { lead_binding_id: "lead-scale" },
      });
      const first = await executeAttempt(runtime, runtimeIndex, cell, 1, null, index === 0);
      if (index === 0) await executeAttempt(runtime, runtimeIndex, cell, 2, first, false);
    }

    const records = await runtimes[0].readRecords(runId);
    const capabilityIndex: TaskCellCapabilityIndex = Object.fromEntries(SUBSTRATES.map((substrate, index) => [
      `host-${index}`,
      { allowed_substrates: [substrate], allowed_model_tiers: ["mid"], max_cost_usd: 2 },
    ]));
    expect(auditTaskCellScaleRecords({
      records,
      expected_logical_task_ids: expected,
      minimum_instances: 256,
      required_substrates: SUBSTRATES,
      capability_index: capabilityIndex,
    })).toMatchObject({
      ok: true,
      findings: [],
      counts: { logical_tasks: 256, instances: 257, retries: 1, substrates: 4 },
    });
  }, 120_000);
});
