import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import {
  FilesystemTaskCellRuntime,
  ExecutionTransportTaskCellWorkerPort,
  type TaskCellWorkerPort,
} from "../../src/modules/dispatch/workflows/task-cell-runtime";
import { auditTaskCellArtifactJoin } from "../../src/modules/dispatch/workflows/task-cell-artifact-join";
import { acknowledgeAssignment } from "../../src/modules/dispatch/workflows/task-assignment-v2";
import { publishSubmittedHandoffPointer } from "../../src/modules/dispatch/workflows/task-cell-acceptance";
import { buildTaskAssignmentV2, taskCellPaths } from "../lib/core/contracts/task-cell-backend";
import { mintRunBinding } from "../../src/modules/lifecycle/workflows/run-binding";
import type { ExecutionTransportPort } from "../../src/modules/dispatch/workflows/execution-transport-ports";
import { readTaskCellLifecycleEvents } from "../../src/modules/telemetry/workflows/task-cell-telemetry";
import { reconcileTaskCellLifecycleTelemetry } from "../../src/modules/dispatch/workflows/task-cell-telemetry-reconcile";
import { composeStationTeam, writeTeamPlan, writeTeamResult } from "../../src/modules/teams";

const NOW = () => "2026-08-10T17:00:00.000Z";

class FakeWorkerPort implements TaskCellWorkerPort {
  readonly mode = "native" as const;
  readonly losses: string[] = [];
  spawned: string[] = [];
  terminated: string[] = [];
  available = true;
  terminateOk = true;
  onNotify: ((input: { instance_id: string; run_id: string; assignment_path: string }) => void) | null = null;
  isAvailable(): boolean { return this.available; }
  spawn(input: { instance_id: string }): { ok: boolean; reason: string | null } {
    this.spawned.push(input.instance_id);
    return { ok: true, reason: null };
  }
  ready(): { ok: boolean; reason: string | null } { return { ok: true, reason: null }; }
  notifyAssignment(input: { instance_id: string; run_id: string; assignment_path: string }): { ok: boolean; reason: string | null } {
    this.onNotify?.(input);
    return { ok: true, reason: null };
  }
  terminate(input: { instance_id: string }): { ok: boolean; reason: string | null } {
    this.terminated.push(input.instance_id);
    return this.terminateOk
      ? { ok: true, reason: null }
      : { ok: false, reason: "worker still alive" };
  }
}

function setup() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "guild-task-cell-runtime-"));
  const runId = "run-runtime";
  const binding = mintRunBinding({ root: cwd, run_id: runId });
  const worker = new FakeWorkerPort();
  let seq = 0;
  const runtime = new FilesystemTaskCellRuntime({
    cwd,
    substrate: "tmux",
    parallelism: 4,
    binding: { binding_ref: binding.binding_ref },
    worker,
    now: NOW,
    idFactory: (kind) => `${kind}-${++seq}`,
  });
  return { cwd, runId, worker, runtime };
}

describe("FilesystemTaskCellRuntime production seam", () => {
  it("drives the production lifecycle and leaves a reconstructable bus join", async () => {
    const { cwd, runId, worker, runtime } = setup();
    const contextRel = `.guild/context/${runId}/backend-T1.md`;
    const context = "# context\n";
    fs.mkdirSync(path.dirname(path.join(cwd, contextRel)), { recursive: true });
    fs.writeFileSync(path.join(cwd, contextRel), context);

    const cell = await runtime.spawnCell({
      run_id: runId,
      cell_id: "cell-T1",
      goal_id: "goal-1",
      phase_id: "build",
      step_id: "T1",
      team_id: "team-1",
      logical_task_id: "T1",
      fanout: "lead_plus_one",
      lead: { lead_binding_id: "lead-1" },
    });
    const instance = await runtime.spawnInstance(cell, {
      task_run_id: "T1.tr1",
      attempt: 1,
      worker_role: "backend",
      specialist_type_id: "backend",
      specialist_type_version: "1",
      specialist_type_hash: "sha256:type",
      specialist_profile_id: "backend",
      specialist_profile_hash: "sha256:profile",
      host_id: "claude-code-cli",
      adapter_id: "claude-code-cli@1",
      host_capabilities_hash: "sha256:caps",
      model_tier: "mid",
      model_id: "claude-sonnet",
      context_bundle_id: contextRel,
      context_bundle_hash: runtime.contentHash(context),
      projection: { tools: ["read", "write"], permissions: [], recorded_losses: [] },
      budgets: { tokens: 1000, wall_clock_ms: 60_000, cost_usd: 1 },
    });
    expect(worker.spawned).toEqual([instance.instance_id]);
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
      attempt: instance.attempt,
      attempt_id: instance.attempt_id,
      previous_attempt_id: null,
      retry_reason: null,
      instance_id: instance.instance_id,
      lead_binding_id: "lead-1",
      team_lead_instance_id: null,
      worker_role: instance.worker_role,
      specialist_type_id: "backend",
      specialist_type_version: "1",
      specialist_type_hash: "sha256:type",
      specialist_profile_id: "backend",
      specialist_profile_hash: "sha256:profile",
      context_bundle_id: contextRel,
      context_bundle_hash: runtime.contentHash(context),
      host_id: "claude-code-cli",
      adapter_id: "claude-code-cli@1",
      host_capabilities_hash: "sha256:caps",
      objective: "implement T1",
      non_goals: [],
      scope_paths: ["src/api"],
      output_schema: "guild.handoff_receipt.v1",
      acceptance_tests: ["npm test -- api"],
      dependencies: [],
      projection: { tools: ["read", "write"], permissions: [], recorded_losses: [] },
      autonomy_policy: "supervised",
      budgets: { tokens: 1000, wall_clock_ms: 60_000, cost_usd: 1 },
      deadline: null,
      written_at: NOW(),
    });
    worker.onNotify = ({ assignment_path }) => {
      const persisted = JSON.parse(fs.readFileSync(path.join(cwd, assignment_path), "utf8"));
      acknowledgeAssignment(cwd, persisted, () => "2026-08-10T16:59:59.000Z");
    };
    const delivered = await runtime.deliverAssignment((ready as { ok: true; instance: typeof instance }).instance, assignment);
    expect(delivered.ok).toBe(true);
    const running = await runtime.awaitAssignmentAck(instance);
    expect(running.ok).toBe(true);
    expect((running as { ok: true; acknowledged_at: string }).acknowledged_at).toBe("2026-08-10T16:59:59.000Z");

    const paths = taskCellPaths({ run_id: runId, logical_task_id: "T1", attempt: 1, instance_id: instance.instance_id });
    const receiptPath = `.guild/runs/${runId}/handoffs/backend-T1.md`;
    fs.mkdirSync(path.dirname(path.join(cwd, receiptPath)), { recursive: true });
    const receiptBytes = [
      "---",
      "schema_version: guild.handoff_receipt.v1",
      "ids:",
      "  initiative_id: null",
      `  run_id: ${runId}`,
      "  task_id: T1",
      "  task_run_id: T1.tr1",
      "specialist: backend",
      "host:",
      "  selected: claude-code-cli",
      "  degraded: false",
      "  native_ref: null",
      "  independence: weak",
      "scope:",
      "  objective: implement T1",
      "  in_scope: [src/api]",
      "  out_of_scope_touched: []",
      "status: completed",
      "changed_files:",
      "  - path: src/api/routes.ts",
      "    change: modified",
      `    sha256_after: ${"a".repeat(64)}`,
      "evidence:",
      "  - kind: command",
      "    ref: npm test -- api",
      "    result: pass",
      "assumptions: []",
      "open_risks: []",
      "followups: []",
      `produced_at: ${NOW()}`,
      "---",
      "",
      "## changed_files",
      "- src/api/routes.ts",
      "",
      "## opens_for",
      "- lead",
      "",
      "## assumptions",
      "- none",
      "",
      "## evidence",
      "- runtime collection",
      "",
      "## followups",
      "- none",
      "",
      "```guild.handoff.v2",
      JSON.stringify({ schema_version: "guild.handoff.v2", task_id: "T1", tier: "mid", status: "done", summary: "implemented T1", artifacts: ["src/api/routes.ts"], issues: [] }),
      "```",
      "",
    ].join("\n");
    fs.writeFileSync(path.join(cwd, receiptPath), receiptBytes);
    expect(publishSubmittedHandoffPointer({ cwd, assignment, submittedAt: NOW() })).not.toBeNull();
    const collected = await runtime.collectHandoff(instance);
    expect(collected.ok).toBe(true);
    expect(fs.readFileSync(path.join(cwd, paths.receipt_path))).toEqual(Buffer.from(receiptBytes));
    expect(JSON.parse(fs.readFileSync(path.join(cwd, paths.handoff_path), "utf8")).receipt_path).toBe(paths.receipt_path);
    fs.writeFileSync(path.join(cwd, receiptPath), "later retry bytes");
    expect(fs.readFileSync(path.join(cwd, paths.receipt_path))).toEqual(Buffer.from(receiptBytes));
    const accepted = await runtime.acceptHandoff(instance, {
      acceptance_policy_version: "1",
      authorities_required: ["deterministic_floor", "team_lead"],
      authorities_observed: [
        { authority: "deterministic_floor", decision: "accepted", at: NOW(), reason: null },
        { authority: "team_lead", decision: "accepted", at: NOW(), reason: null },
      ],
    });
    expect(accepted.ok).toBe(true);
    const terminated = await runtime.terminate(instance);
    expect(terminated.ok).toBe(true);
    expect(worker.terminated).toEqual([instance.instance_id]);
    writeTeamPlan(cwd, runId, composeStationTeam("build", {}, { tierIndex: {} }), { now: NOW });
    writeTeamResult(cwd, runId, {
      schema_version: "guild.team_result.v1",
      station: "build",
      team_plan_ref: `.guild/runs/${runId}/team-plan/build.json`,
      lanes: [{ role: "backend", instance_id: instance.instance_id, handoff_ref: null, acceptance_ref: null }],
    }, { now: NOW });
    expect(auditTaskCellArtifactJoin({ cwd, runId, requireClosed: true }).ok).toBe(true);
    const lifecycle = readTaskCellLifecycleEvents({ cwd, runId });
    expect(lifecycle.map((item) => item.event_name)).toEqual([
      "spawn_started",
      "spawned",
      "ready",
      "assignment_delivered",
      "assignment_acknowledged",
      "running",
      "handoff_submitted",
      "handoff_validated",
      "handoff_accepted",
      "termination_started",
      "terminated",
    ]);
    expect(lifecycle.map((item) => item.at)).toEqual([...lifecycle.map((item) => item.at)].sort());
    expect(lifecycle[0]).toMatchObject({
      mechanics_mode: "native",
      degradation_reasons: [],
      specialist_type_hash: "sha256:type",
      specialist_profile_hash: "sha256:profile",
      context_bundle_hash: runtime.contentHash(context),
      host_capabilities_hash: "sha256:caps",
      context_bundle_bytes: Buffer.byteLength(context),
    });

    fs.rmSync(path.join(cwd, ".guild", "runs", runId, "task-cell-telemetry"), { recursive: true });
    const reconstructed = reconcileTaskCellLifecycleTelemetry({ cwd, runId });
    expect(reconstructed).toMatchObject({ ok: true, instances: 1, events_appended: 11 });
    expect(readTaskCellLifecycleEvents({ cwd, runId }).map((item) => item.event_name)).toEqual(
      lifecycle.map((item) => item.event_name),
    );
  });

  it("fails closed when the selected worker substrate is unavailable", async () => {
    const { runId, worker, runtime } = setup();
    worker.available = false;
    const cell = await runtime.spawnCell({
      run_id: runId, cell_id: "c", goal_id: "g", phase_id: "build", step_id: "s",
      team_id: "t", logical_task_id: "T", fanout: "lead_only", lead: { lead_binding_id: "lead" },
    });
    await expect(runtime.spawnInstance(cell, {
      task_run_id: "tr", attempt: 1, worker_role: "backend",
      specialist_type_id: "backend", specialist_type_version: "1", specialist_type_hash: "sha256:type",
      specialist_profile_id: "backend", specialist_profile_hash: "sha256:profile",
      host_id: "missing", adapter_id: "missing@1", host_capabilities_hash: "sha256:caps",
      model_tier: "mid", context_bundle_id: ".guild/context/run-runtime/T.md",
      context_bundle_hash: "sha256:ctx", projection: { tools: [], permissions: [], recorded_losses: [] },
      budgets: { tokens: null, wall_clock_ms: null, cost_usd: null },
    })).rejects.toThrow(/unavailable/);
  });

  it("records filesystem assignment emulation and refuses to fake termination", () => {
    const transport = {
      supports: (operation: string) => operation === "spawn",
      spawn: () => ({ status: "succeeded", value: {
        transport_id: "in-process", handle_id: "h1", host_id: "claude", host_kind: "claude", invocation: null,
      } }),
    } as unknown as ExecutionTransportPort;
    const worker = new ExecutionTransportTaskCellWorkerPort({
      transport,
      filesystemAssignmentWakeup: true,
      requestFor: () => ({ handle_id: "h1", payload: {} }),
    });
    const instance = { instance_id: "i1", run_id: "r1", assignment_path: "a.json", instance: {} as never };
    expect(worker.spawn(instance).ok).toBe(true);
    expect(worker.notifyAssignment({ instance_id: "i1", run_id: "r1", assignment_path: "a.json" }).ok).toBe(true);
    expect(worker.mode).toBe("emulated");
    expect(worker.losses).toEqual(expect.arrayContaining([expect.stringContaining("send unsupported"), expect.stringContaining("termination") ]));
    expect(worker.terminate({ instance_id: "i1", run_id: "r1", reason: "done" })).toEqual({
      ok: false,
      reason: "transport cannot confirm worker termination",
    });
  });

  it("parks a forced-cleanup failure as orphaned instead of sealing a false terminal state", async () => {
    const { cwd, runId, worker, runtime } = setup();
    worker.terminateOk = false;
    worker.ready = () => ({ ok: false, reason: "readiness timed out" });
    const cell = await runtime.spawnCell({
      run_id: runId, cell_id: "c-orphan", goal_id: "g", phase_id: "build", step_id: "s",
      team_id: "t", logical_task_id: "T-orphan", fanout: "lead_only", lead: { lead_binding_id: "lead" },
    });
    const instance = await runtime.spawnInstance(cell, {
      task_run_id: "tr-orphan", attempt: 1, worker_role: "backend",
      specialist_type_id: "backend", specialist_type_version: "1", specialist_type_hash: "sha256:type",
      specialist_profile_id: "backend", specialist_profile_hash: "sha256:profile",
      host_id: "claude", adapter_id: "claude@1", host_capabilities_hash: "sha256:caps",
      model_tier: "mid", context_bundle_id: ".guild/context/run-runtime/T-orphan.md",
      context_bundle_hash: "sha256:ctx", projection: { tools: [], permissions: [], recorded_losses: [] },
      budgets: { tokens: null, wall_clock_ms: null, cost_usd: null },
    });

    const result = await runtime.awaitReady(instance);
    expect(result.ok).toBe(false);
    expect((result as { failure: string }).failure).toBe("termination_failed");
    const attempt = JSON.parse(fs.readFileSync(path.join(cwd, taskCellPaths({
      run_id: runId, logical_task_id: "T-orphan", attempt: 1, instance_id: instance.instance_id,
    }).attempt_path), "utf8"));
    expect(attempt.orphaned).toBe(true);
    expect(attempt.terminal_state).toBeNull();
    expect(attempt.immutable).toBe(false);
  });
});
