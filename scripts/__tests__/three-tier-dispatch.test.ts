/**
 * scripts/__tests__/three-tier-dispatch.test.ts
 *
 * U-TIER (T08) — the eleven fixtures the plan names verbatim, run against the
 * REAL runtime, the REAL validators, the REAL roster, and the shipped manifest.
 *
 *   F01  orchestrator context has goal_status, not assignments
 *   F02  post-mint dispatch Reads the project profile
 *   F03  projected-tool violation fails closed
 *   F04  retry writes a new attempt id
 *   F05  plugin.json agents glob length is 4
 *   F06  a cell without oracles cannot go done
 *   F07  the fifth instance is refused at the default cap
 *   F08  advisorRounds exhausted blocks with next_need: budget
 *   F09  D-PROBE does not decrement the advisor cap
 *   F10  the per-goal slice uses minted profiles only
 *   F11  the phase team file still resolves
 *
 * R33–R35, R37, R46, R72, R73, R78.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import {
  buildTaskCell,
  writeTaskCell,
  type TaskCellDispatchInput,
} from "../../src/modules/dispatch/workflows/task-assignment-v2";
import {
  ExecutionTransportTaskCellWorkerPort,
  FilesystemTaskCellRuntime,
  type TaskCellWorkerPort,
} from "../../src/modules/dispatch/workflows/task-cell-runtime";
import {
  assignmentId,
} from "../lib/core/contracts/task-cell-backend";
import type {
  AcceptHandoffRequest,
  InstanceHandle,
  TaskAssignmentV2,
} from "../lib/core/contracts/task-cell-backend";
import {
  DEFAULT_MAX_INSTANCES,
  countLiveRunInstances,
  reserveInstance,
} from "../../src/modules/dispatch/workflows/instance-cap";
import {
  cellCanGoDone,
  initProgressLedger,
  readDoneWhen,
  readProgressLedger,
  recordOracleOutcome,
} from "../../src/modules/dispatch/workflows/progress-ledger";
import { checkBusMessage } from "../../src/modules/dispatch/workflows/isolation-guard";
import {
  consumeConsult,
  initAdvisorBudget,
  resolveAdvisorRounds,
} from "../../src/modules/dispatch/workflows/advisor-budget";
import { resolveAssignmentBinding } from "../../src/modules/dispatch/workflows/assignment-binding";
import { publishSubmittedHandoffPointer } from "../../src/modules/dispatch/workflows/task-cell-acceptance";
import { acknowledgeAssignment } from "../../src/modules/dispatch/workflows/task-assignment-v2";
import {
  foldOrchestratorContext,
  lintOrchestratorContext,
  validateGoalStatusV1,
  validateGoalV1,
} from "../../src/modules/teams/workflows/goal-contract";
import { sliceRosterForGoal } from "../../src/modules/teams/workflows/compose-scope";
import { resolveTeamFile } from "../../src/modules/teams/workflows/team-file";
import { mintFromTemplate, resolveRoster } from "../lib/roster";
import { mintRunBinding } from "../../src/modules/lifecycle/workflows/run-binding";
import { taskCellPaths } from "../lib/core/contracts/task-cell-backend";

const PLUGIN_ROOT = path.resolve(__dirname, "..", "..");
const FIXED_NOW = () => "2026-09-15T00:00:00.000Z";

/**
 * Narrow a result union to its refusal arm.
 *
 * This suite runs under the repo's non-strict ts-jest transform, where
 * control-flow narrowing on a literal `ok: false` discriminant does not apply.
 * `Extract` is a static type operation, so it works regardless.
 */
function refusal<T extends { ok: boolean }>(value: T): Extract<T, { ok: false }> {
  if (value.ok) throw new Error(`expected a refusal, got ${JSON.stringify(value)}`);
  return value as Extract<T, { ok: false }>;
}

function tmpRoot(tag: string): string {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `guild-t08-${tag}-`)));
}

/** A worker port that always succeeds — the mechanics are not what these assert. */
function okWorker(): TaskCellWorkerPort {
  const ok = { ok: true as const, reason: null };
  return {
    mode: "native",
    losses: [],
    isAvailable: () => true,
    spawn: () => ok,
    ready: () => ok,
    notifyAssignment: () => ok,
    terminate: () => ok,
  };
}

/**
 * Drive one cell through the REAL runtime as far as `handoff_validated`, the
 * state `acceptHandoff` is reachable from. Everything here is the shipped path:
 * the runtime's own spawn/ready/deliver/ack/collect, the real receipt validator,
 * and the real submitted-handoff pointer. Only the host mechanics are doubled.
 */
async function driveToValidated(input: {
  cwd: string;
  runId: string;
  logicalTaskId: string;
  doneWhen?: readonly { id: string; oracle: "named_check" | "verify.after_edit"; target?: string | null }[];
}): Promise<{ runtime: FilesystemTaskCellRuntime; instance: InstanceHandle; assignment: TaskAssignmentV2 }> {
  const { cwd, runId, logicalTaskId } = input;
  const binding = mintRunBinding({ root: cwd, run_id: runId });
  let notifyCwd = cwd;
  const worker: TaskCellWorkerPort = {
    ...okWorker(),
    notifyAssignment: ({ assignment_path }) => {
      const persisted = JSON.parse(fs.readFileSync(path.join(notifyCwd, assignment_path), "utf8"));
      acknowledgeAssignment(notifyCwd, persisted, FIXED_NOW);
      return { ok: true, reason: null };
    },
  };
  const runtime = new FilesystemTaskCellRuntime({
    cwd,
    substrate: "tmux",
    parallelism: 4,
    binding: { binding_ref: binding.binding_ref },
    worker,
    now: FIXED_NOW,
  });
  const contextRel = `.guild/context/${runId}/backend-${logicalTaskId}.md`;
  fs.mkdirSync(path.dirname(path.join(cwd, contextRel)), { recursive: true });
  fs.writeFileSync(path.join(cwd, contextRel), "# context\n", "utf8");

  const cell = await runtime.spawnCell({
    run_id: runId,
    cell_id: `cell-${logicalTaskId}`,
    goal_id: "goal-t08",
    phase_id: "build",
    step_id: logicalTaskId,
    team_id: "t08",
    logical_task_id: logicalTaskId,
    fanout: "lead_plus_one",
    lead: { lead_binding_id: "lead-binding-t08", team_lead_instance_id: null },
  });
  const instance = await runtime.spawnInstance(cell, {
    task_run_id: `${logicalTaskId}.tr1`,
    attempt: 1,
    worker_role: "backend",
    specialist_type_id: "backend",
    specialist_type_version: "1",
    specialist_type_hash: "sha256:type-backend",
    specialist_profile_id: "backend",
    specialist_profile_hash: "sha256:profile-backend",
    host_id: "claude-code-cli",
    adapter_id: "claude-code-cli@1",
    host_capabilities_hash: "sha256:caps",
    model_tier: "mid",
    context_bundle_id: contextRel,
    context_bundle_hash: runtime.contentHash("# context\n"),
    projection: { tools: ["Read", "Write"], permissions: [], recorded_losses: [] },
    budgets: { tokens: null, wall_clock_ms: null, cost_usd: null },
  });
  await runtime.awaitReady(instance);

  const built = buildTaskCell(
    dispatchInput({
      logicalTaskId,
      taskRunId: instance.task_run_id,
      instanceId: instance.instance_id,
      attemptId: instance.attempt_id,
      cellId: cell.cell_id,
      contextBundleId: contextRel,
      contextBundleHash: runtime.contentHash("# context\n"),
      scopePaths: ["src/api"],
      acceptanceTests: ["npm test -- api"],
      doneWhen: input.doneWhen,
    }),
  );
  notifyCwd = cwd;
  const delivered = await runtime.deliverAssignment(instance, built.assignment);
  expect(delivered.ok).toBe(true);
  expect((await runtime.awaitAssignmentAck(instance)).ok).toBe(true);

  const receiptPath = `.guild/runs/${runId}/handoffs/backend-${logicalTaskId}.md`;
  fs.mkdirSync(path.dirname(path.join(cwd, receiptPath)), { recursive: true });
  fs.writeFileSync(path.join(cwd, receiptPath), receiptBytes(runId, logicalTaskId), "utf8");
  expect(
    publishSubmittedHandoffPointer({ cwd, assignment: built.assignment, submittedAt: FIXED_NOW() }),
  ).not.toBeNull();
  const collected = await runtime.collectHandoff(instance);
  expect(collected.ok).toBe(true);
  return { runtime, instance, assignment: built.assignment };
}

/** The frozen `guild.handoff_receipt.v1` a worker writes. */
function receiptBytes(runId: string, logicalTaskId: string): string {
  return [
    "---",
    "schema_version: guild.handoff_receipt.v1",
    "ids:",
    "  initiative_id: null",
    `  run_id: ${runId}`,
    `  task_id: ${logicalTaskId}`,
    `  task_run_id: ${logicalTaskId}.tr1`,
    "specialist: backend",
    "host:",
    "  selected: claude-code-cli",
    "  degraded: false",
    "  native_ref: null",
    "  independence: weak",
    "scope:",
    `  objective: implement ${logicalTaskId}`,
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
    `produced_at: ${FIXED_NOW()}`,
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
    JSON.stringify({
      schema_version: "guild.handoff.v2",
      task_id: logicalTaskId,
      tier: "mid",
      status: "done",
      summary: `implemented ${logicalTaskId}`,
      artifacts: ["src/api/routes.ts"],
      issues: [],
    }),
    "```",
    "",
  ].join("\n");
}

const ACCEPTANCE_REQ: AcceptHandoffRequest = {
  acceptance_policy_version: "1",
  authorities_required: ["deterministic_floor", "team_lead"],
  authorities_observed: [
    { authority: "deterministic_floor", decision: "accepted", at: FIXED_NOW(), reason: null },
    { authority: "team_lead", decision: "accepted", at: FIXED_NOW(), reason: null },
  ],
};

function dispatchInput(over: Partial<TaskCellDispatchInput> = {}): TaskCellDispatchInput {
  const logicalTaskId = over.logicalTaskId ?? "T1-backend";
  return {
    runId: "run-t08",
    logicalTaskId,
    taskRunId: `${logicalTaskId}.tr1`,
    attempt: 1,
    attemptId: `${logicalTaskId}.att1`,
    instanceId: `${logicalTaskId}.a1.i1`,
    cellId: `cell-${logicalTaskId}`,
    goalId: "goal-t08",
    phaseId: "build",
    stepId: logicalTaskId,
    teamId: "t08",
    workerRole: "backend",
    specialistTypeId: "backend",
    specialistTypeVersion: "1",
    specialistTypeHash: "sha256:type-backend",
    specialistProfileId: "backend",
    specialistProfileHash: "sha256:profile-backend",
    contextBundleId: `.guild/context/run-t08/backend-${logicalTaskId}.md`,
    contextBundleHash: `sha256:ctx-${logicalTaskId}`,
    hostId: "claude-code-cli",
    adapterId: "claude-code-cli@1",
    hostCapabilitiesHash: "sha256:caps",
    objective: `implement ${logicalTaskId}`,
    nonGoals: [],
    scopePaths: [],
    outputSchema: "guild.handoff_receipt.v1",
    acceptanceTests: [],
    dependencies: [],
    projection: { tools: ["Read", "Write"], permissions: [], recorded_losses: [] },
    autonomyPolicy: "supervised",
    budgets: { tokens: null, wall_clock_ms: null, cost_usd: null },
    deadline: null,
    leadBindingId: "lead-binding-t08",
    now: FIXED_NOW,
    ...over,
    substrate: over.substrate ?? "tmux",
    modelTier: over.modelTier ?? "mid",
  };
}

function goalStatus(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema_version: "guild.goal_status.v1",
    run_id: "run-t08",
    goal_id: "goal-t08",
    phase_id: "build",
    cell_id: "cell-1",
    team_id: "t08",
    state: "running",
    progress: 0.5,
    worker_count: 2,
    handoff_ids: [],
    summary: "two lanes running, none blocked",
    ...over,
  };
}

// ── F01 ──────────────────────────────────────────────────────────────────────

describe("F01 orchestrator context has goal_status, not assignments (R33)", () => {
  it("accepts a clean goal_status envelope and rejects an assignment in the same slot", () => {
    expect(validateGoalStatusV1(goalStatus())).not.toBeNull();

    const assignment = buildTaskCell(dispatchInput()).assignment;
    const findings = lintOrchestratorContext({ envelopes: [assignment] });
    expect(findings.map((f) => f.code)).toContain("assignment_in_context");
  });

  it("rejects paths, diffs, and specialist names inside the envelope", () => {
    const codes = lintOrchestratorContext({
      envelopes: [
        goalStatus({ summary: "edited src/modules/dispatch/workflows/task-cell-runtime.ts" }),
        goalStatus({ summary: "applied\n@@ -1,4 +1,9 @@\nchange" }),
        goalStatus({ summary: "backend finished the lane" }),
      ],
      specialist_names: ["backend"],
    }).map((f) => f.code);
    expect(codes).toContain("path_in_envelope");
    expect(codes).toContain("diff_in_envelope");
    expect(codes).toContain("specialist_name_in_envelope");
  });

  it("keeps the last 5 envelopes verbatim and collapses the rest to a rolling summary", () => {
    const stream = Array.from({ length: 8 }, (_, i) =>
      goalStatus({ cell_id: `cell-${i}`, state: i < 3 ? "done" : "running" }),
    );
    const ctx = foldOrchestratorContext(stream);
    expect(ctx.recent).toHaveLength(5);
    expect(ctx.recent[0].cell_id).toBe("cell-3");
    expect(ctx.pointers).toEqual(["cell-0", "cell-1", "cell-2"]);
    expect(ctx.rolling_summary).toBe("3 earlier cells: 3 done");
    // Nothing in the fold may carry task specifics upward.
    expect(lintOrchestratorContext({ envelopes: ctx.recent })).toEqual([]);
  });

  it("refuses a blocked envelope with no blocked_reason", () => {
    expect(validateGoalStatusV1(goalStatus({ state: "blocked" }))).toBeNull();
    expect(
      validateGoalStatusV1(goalStatus({ state: "blocked", blocked_reason: "budget" })),
    ).not.toBeNull();
  });
});

// ── F02 ──────────────────────────────────────────────────────────────────────

describe("F02 post-mint dispatch Reads the project profile (R34)", () => {
  it("mints into the GuildStorage definition tree and resolves project-first", () => {
    const projectRoot = tmpRoot("mint");
    const before = resolveRoster({ pluginRoot: PLUGIN_ROOT, projectRoot });
    expect(before.project.map((p) => p.name)).not.toContain("frontend");

    const minted = mintFromTemplate({ pluginRoot: PLUGIN_ROOT, projectRoot, name: "frontend" });
    expect(minted.action).toBe("written");
    // The mint target is the project's definition tree, not the install dir.
    expect(minted.path).toBe(path.join(projectRoot, ".guild", "agents", "frontend.md"));
    expect(minted.path.startsWith(PLUGIN_ROOT)).toBe(false);

    const after = resolveRoster({ pluginRoot: PLUGIN_ROOT, projectRoot });
    const entry = after.roster.find((r) => r.name === "frontend");
    expect(entry).toBeDefined();
    // The live body a dispatch reads is the PROJECT file, never the template.
    expect(entry!.source).toBe("project");
    expect(entry!.definition_abs).toBe(minted.path);
    expect(fs.readFileSync(entry!.definition_abs, "utf8").length).toBeGreaterThan(0);
  });
});

// ── F03 ──────────────────────────────────────────────────────────────────────

describe("F03 projected-tool violation fails closed (R35, KTD28)", () => {
  it("refuses an off-projection tool call through the real runtime", async () => {
    const cwd = tmpRoot("projection");
    const runId = "run-t08";
    const binding = mintRunBinding({ root: cwd, run_id: runId });
    const runtime = new FilesystemTaskCellRuntime({
      cwd,
      substrate: "tmux",
      parallelism: 4,
      binding: { binding_ref: binding.binding_ref },
      worker: okWorker(),
      now: FIXED_NOW,
    });
    const cell = await runtime.spawnCell({
      run_id: runId,
      cell_id: "cell-T1-backend",
      goal_id: "goal-t08",
      phase_id: "build",
      step_id: "T1-backend",
      team_id: "t08",
      logical_task_id: "T1-backend",
      fanout: "lead_plus_one",
      lead: { lead_binding_id: "lead-binding-t08", team_lead_instance_id: null },
    });
    const instance = await runtime.spawnInstance(cell, {
      task_run_id: "T1-backend.tr1",
      attempt: 1,
      worker_role: "backend",
      specialist_type_id: "backend",
      specialist_type_version: "1",
      specialist_type_hash: "sha256:type-backend",
      specialist_profile_id: "backend",
      specialist_profile_hash: "sha256:profile-backend",
      host_id: "claude-code-cli",
      adapter_id: "claude-code-cli@1",
      host_capabilities_hash: "sha256:caps",
      model_tier: "mid",
      context_bundle_id: ".guild/context/run-t08/backend-T1-backend.md",
      context_bundle_hash: "sha256:ctx",
      projection: { tools: ["Read"], permissions: [], recorded_losses: [] },
      budgets: { tokens: null, wall_clock_ms: null, cost_usd: null },
    });
    const ready = await runtime.awaitReady(instance);
    expect(ready.ok).toBe(true);
    const assignment = buildTaskCell(
      dispatchInput({
        instanceId: instance.instance_id,
        attemptId: instance.attempt_id,
        projection: { tools: ["Read"], permissions: [], recorded_losses: [] },
      }),
    ).assignment;
    const delivered = await runtime.deliverAssignment(instance, assignment);
    expect(delivered.ok).toBe(true);

    expect(runtime.authorizeToolCall(instance, "Read")).toEqual({ ok: true });
    const refused = runtime.authorizeToolCall(instance, "Bash");
    const refusedR = refusal(refused);
    expect(refusedR.failure).toBe("not_authorized");
    expect(refusedR.reason).toMatch(/outside this assignment's tool projection/);
  });

  it("refuses an isolated spawn whose projection is empty rather than granting full tools", async () => {
    const cwd = tmpRoot("unprojected");
    const runId = "run-t08";
    const binding = mintRunBinding({ root: cwd, run_id: runId });
    const runtime = new FilesystemTaskCellRuntime({
      cwd,
      substrate: "tmux",
      parallelism: 4,
      binding: { binding_ref: binding.binding_ref },
      worker: okWorker(),
      now: FIXED_NOW,
    });
    const cell = await runtime.spawnCell({
      run_id: runId,
      cell_id: "cell-T2-open",
      goal_id: "goal-t08",
      phase_id: "build",
      step_id: "T2-open",
      team_id: "t08",
      logical_task_id: "T2-open",
      fanout: "lead_plus_one",
      lead: { lead_binding_id: "lead-binding-t08", team_lead_instance_id: null },
    });
    const instance = await runtime.spawnInstance(cell, {
      task_run_id: "T2-open.tr1",
      attempt: 1,
      worker_role: "backend",
      specialist_type_id: "backend",
      specialist_type_version: "1",
      specialist_type_hash: "sha256:type-backend",
      specialist_profile_id: "backend",
      specialist_profile_hash: "sha256:profile-backend",
      host_id: "claude-code-cli",
      adapter_id: "claude-code-cli@1",
      host_capabilities_hash: "sha256:caps",
      model_tier: "mid",
      context_bundle_id: ".guild/context/run-t08/backend-T2-open.md",
      context_bundle_hash: "sha256:ctx",
      projection: { tools: [], permissions: [], recorded_losses: [] },
      budgets: { tokens: null, wall_clock_ms: null, cost_usd: null },
    });
    await runtime.awaitReady(instance);
    const assignment = buildTaskCell(
      dispatchInput({
        logicalTaskId: "T2-open",
        instanceId: instance.instance_id,
        attemptId: instance.attempt_id,
        projection: { tools: [], permissions: [], recorded_losses: [] },
      }),
    ).assignment;
    const delivered = await runtime.deliverAssignment(instance, assignment);
    const deliveredR = refusal(delivered);
    expect(deliveredR.failure).toBe("not_authorized");
    expect(deliveredR.reason).toMatch(/unprojected tools/);
  });

  it("treats a specialist addressing the orchestrator as a defect, not a degraded mode", () => {
    const toT0 = checkBusMessage({
      from_tier: "T2",
      to_tier: "T0",
      from_id: "backend.i1",
      to_id: "orchestrator",
      envelope: "guild.handoff.v2",
    });
    expect(toT0).toEqual(
      expect.objectContaining({ ok: false, defect: "specialist_addressed_orchestrator" }),
    );
    expect(
      checkBusMessage({
        from_tier: "T2",
        to_tier: "T2",
        from_id: "backend.i1",
        to_id: "frontend.i1",
        envelope: "guild.handoff.v2",
      }),
    ).toEqual(expect.objectContaining({ ok: false, defect: "specialist_addressed_sibling" }));
    // The two legal upward edges still pass, each with its own envelope.
    expect(
      checkBusMessage({
        from_tier: "T2",
        to_tier: "T1",
        from_id: "backend.i1",
        to_id: "cell-1",
        envelope: "guild.handoff.v2",
      }),
    ).toEqual({ ok: true });
    expect(
      checkBusMessage({
        from_tier: "T1",
        to_tier: "T0",
        from_id: "cell-1",
        to_id: "orchestrator",
        envelope: "guild.goal_status.v1",
      }),
    ).toEqual({ ok: true });
    // A lead forwarding a receipt upward is the leak R33 closes.
    expect(
      checkBusMessage({
        from_tier: "T1",
        to_tier: "T0",
        from_id: "cell-1",
        to_id: "orchestrator",
        envelope: "guild.handoff.v2",
      }),
    ).toEqual(expect.objectContaining({ ok: false, defect: "wrong_envelope" }));
  });
});

// ── F04 ──────────────────────────────────────────────────────────────────────

describe("F04 retry writes a NEW attempt id (R35 / D4)", () => {
  it("writes attempt 2 to its own immutable file and preserves the logical task", () => {
    const cwd = tmpRoot("retry");
    const binding = mintRunBinding({ root: cwd, run_id: "run-t08" });
    const env = { binding_ref: binding.binding_ref };

    const first = buildTaskCell(dispatchInput());
    writeTaskCell(cwd, first, env);
    const second = buildTaskCell(
      dispatchInput({
        attempt: 2,
        taskRunId: "T1-backend.tr2",
        attemptId: "T1-backend.att2",
        instanceId: "T1-backend.a2.i1",
        previousAttemptId: "T1-backend.att1",
        retryReason: "oracles failed on attempt 1",
        contextBundleId: ".guild/context/run-t08/backend-T1-backend-a2.md",
      }),
    );
    writeTaskCell(cwd, second, env);

    expect(second.attempt.attempt_id).not.toBe(first.attempt.attempt_id);
    expect(second.attempt.previous_attempt_id).toBe(first.attempt.attempt_id);
    expect(second.attempt.logical_task_id).toBe(first.attempt.logical_task_id);
    // Both attempt files exist; the retry did not overwrite the first.
    for (const attempt of [1, 2]) {
      const p = taskCellPaths({
        run_id: "run-t08",
        logical_task_id: "T1-backend",
        attempt,
        instance_id: attempt === 1 ? "T1-backend.a1.i1" : "T1-backend.a2.i1",
      });
      expect(fs.existsSync(path.join(cwd, p.attempt_path))).toBe(true);
    }
  });

  it("refuses a non-first attempt with no lineage", () => {
    expect(() => buildTaskCell(dispatchInput({ attempt: 2 }))).toThrow(
      /previous_attempt_id|retry_reason/i,
    );
  });
});

// ── F05 ──────────────────────────────────────────────────────────────────────

describe("F05 plugin.json agents glob length is 4 (R34)", () => {
  it("resolves to exactly the four machinery agents and no .claude/agents", () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(PLUGIN_ROOT, ".claude-plugin", "plugin.json"), "utf8"),
    ) as { agents?: string[] };
    const globs = manifest.agents ?? [];
    // The glob may be spelled as one pattern or as one entry per agent; what the
    // law caps is the RESOLVED SET, so dedupe before counting.
    const resolved = new Set(
      globs.flatMap((g) => {
        const dir = path.join(PLUGIN_ROOT, path.dirname(g));
        if (!fs.existsSync(dir)) return [];
        return fs
          .readdirSync(dir)
          .filter((f) => f.endsWith(".md"))
          .map((f) => path.basename(f, ".md"));
      }),
    );
    expect([...resolved].sort()).toEqual(["advisor", "context-manager", "developer", "team-lead"]);
    expect(resolved.size).toBe(4);
    expect(globs.some((g) => g.includes(".claude/agents"))).toBe(false);
  });

  it("keeps .claude/agents out of the dispatch roster", () => {
    const projectRoot = tmpRoot("roster-scope");
    fs.mkdirSync(path.join(projectRoot, ".claude", "agents"), { recursive: true });
    fs.writeFileSync(
      path.join(projectRoot, ".claude", "agents", "tooling-engineer.md"),
      "---\nname: tooling-engineer\ndescription: authoring helper\n---\nbody\n",
      "utf8",
    );
    const roster = resolveRoster({ pluginRoot: PLUGIN_ROOT, projectRoot });
    expect(roster.roster.map((r) => r.name)).not.toContain("tooling-engineer");
  });
});

// ── F06 ──────────────────────────────────────────────────────────────────────

describe("F06 a cell without oracles cannot go done (R46)", () => {
  it("refuses to build a ledger for an assignment with no done_when[]", () => {
    const cwd = tmpRoot("no-oracles");
    const assignment = buildTaskCell(dispatchInput()).assignment;
    expect(readDoneWhen(assignment).ok).toBe(false);
    const init = initProgressLedger({
      cwd,
      run_id: "run-t08",
      logical_task_id: "T1-backend",
      cell_id: "cell-T1-backend",
      done_when: (assignment as { done_when?: unknown }).done_when,
    });
    const initR = refusal(init);
    expect(initR.reason).toMatch(/no done_when\[\] oracles/);
    // No ledger on disk ⇒ the cell can never be declared done.
    expect(
      cellCanGoDone(readProgressLedger({ cwd, run_id: "run-t08", logical_task_id: "T1-backend" })),
    ).toEqual(expect.objectContaining({ ok: false }));
  });

  it("goes done only once every oracle is pass or skip-recorded", () => {
    const cwd = tmpRoot("oracles");
    const assignment = buildTaskCell(
      dispatchInput({
        doneWhen: [
          { id: "unit", oracle: "named_check", target: "jest:three-tier" },
          { id: "verify", oracle: "verify.after_edit", target: null },
        ],
      }),
    ).assignment;
    expect(readDoneWhen(assignment).ok).toBe(true);

    const init = initProgressLedger({
      cwd,
      run_id: "run-t08",
      logical_task_id: "T1-backend",
      cell_id: "cell-T1-backend",
      done_when: (assignment as { done_when?: unknown }).done_when,
      now: FIXED_NOW,
    });
    expect(init.ok).toBe(true);
    const ids = { cwd, run_id: "run-t08", logical_task_id: "T1-backend" };

    expect(cellCanGoDone(readProgressLedger(ids)).ok).toBe(false);
    expect(recordOracleOutcome({ ...ids, item_id: "unit", state: "pass" }).ok).toBe(true);
    expect(cellCanGoDone(readProgressLedger(ids)).ok).toBe(false);
    // A host that cannot run the inner verify RECORDS the loss; it never passes silently.
    expect(recordOracleOutcome({ ...ids, item_id: "verify", state: "skip-recorded" }).ok).toBe(true);
    expect(cellCanGoDone(readProgressLedger(ids))).toEqual({ ok: true });

    // A failing oracle re-opens the cell and carries a closed-enum verdict.
    expect(
      recordOracleOutcome({ ...ids, item_id: "unit", state: "fail", last_failure: "retry" }).ok,
    ).toBe(true);
    const reopened = readProgressLedger(ids)!;
    expect(reopened.last_failure).toBe("retry");
    expect(cellCanGoDone(reopened).ok).toBe(false);

    // The ledger never grows a new acceptance test at run time.
    expect(recordOracleOutcome({ ...ids, item_id: "invented", state: "pass" })).toEqual(
      expect.objectContaining({ ok: false }),
    );
  });

  it("blocks acceptance on an oracle-less cell, and releases it once the oracles settle", async () => {
    // (a) No done_when[] on the assignment ⇒ no ledger ⇒ acceptance is refused
    //     even though the receipt validated. A receipt has never been enough (D5).
    const bare = tmpRoot("accept-bare");
    const bareRun = await driveToValidated({
      cwd: bare,
      runId: "run-t08",
      logicalTaskId: "T1-backend",
    });
    const refusedAccept = await bareRun.runtime.acceptHandoff(bareRun.instance, ACCEPTANCE_REQ);
    const refusedAcceptR = refusal(refusedAccept);
    expect(refusedAcceptR.failure).toBe("validation_failed");
    expect(refusedAcceptR.reason).toMatch(/assignment declared no oracles/);

    // (b) The SAME path with oracles declared: refused while unsettled, accepted
    //     once every oracle is pass or skip-recorded. The gate is the ledger, and
    //     it does not spuriously block a cell that did its work.
    const cwd = tmpRoot("accept-oracles");
    const done = await driveToValidated({
      cwd,
      runId: "run-t08",
      logicalTaskId: "T2-backend",
      doneWhen: [
        { id: "unit", oracle: "named_check", target: "npm test -- api" },
        { id: "verify", oracle: "verify.after_edit", target: null },
      ],
    });
    const ids = { cwd, run_id: "run-t08", logical_task_id: "T2-backend" };
    expect(
      initProgressLedger({
        ...ids,
        cell_id: "cell-T2-backend",
        assignment_id: assignmentId(done.assignment),
        done_when: (done.assignment as { done_when?: unknown }).done_when,
        now: FIXED_NOW,
      }).ok,
    ).toBe(true);

    const early = await done.runtime.acceptHandoff(done.instance, ACCEPTANCE_REQ);
    expect(refusal(early).reason).toMatch(/done_when oracles unsettled/);

    recordOracleOutcome({ ...ids, item_id: "unit", state: "pass" });
    recordOracleOutcome({ ...ids, item_id: "verify", state: "skip-recorded" });
    const accepted = await done.runtime.acceptHandoff(done.instance, ACCEPTANCE_REQ);
    expect(accepted.ok).toBe(true);
  });
});

// ── F07 ──────────────────────────────────────────────────────────────────────

describe("F07 the fifth instance is refused at the default cap (R46)", () => {
  it("admits four and refuses the fifth through THE admission entry", () => {
    expect(DEFAULT_MAX_INSTANCES).toBe(4);
    const cwd = tmpRoot("cap-entry");
    const ids = { cwd, run_id: "run-t08" };
    // There is no observe-only check to call any more (r3): being admitted and
    // claiming the slot are one act, so this counts by claiming.
    for (let n = 1; n <= 4; n += 1) {
      expect(reserveInstance({ ...ids, logical_task_id: `T${n}`, attempt: 1 }).ok).toBe(true);
    }
    expect(countLiveRunInstances(ids)).toBe(4);
    const refusedR = refusal(reserveInstance({ ...ids, logical_task_id: "T5", attempt: 1 }));
    expect(refusedR.failure).toBe("not_authorized");
    expect(refusedR.reason).toMatch(/dispatch\.max_instances=4/);
  });

  it("refuses the fifth spawnInstance through the real runtime", async () => {
    const cwd = tmpRoot("cap");
    const runId = "run-t08";
    const binding = mintRunBinding({ root: cwd, run_id: runId });
    const runtime = new FilesystemTaskCellRuntime({
      cwd,
      substrate: "tmux",
      parallelism: 8,
      binding: { binding_ref: binding.binding_ref },
      worker: okWorker(),
      now: FIXED_NOW,
    });
    const spawn = async (n: number) => {
      const cell = await runtime.spawnCell({
        run_id: runId,
        cell_id: `cell-${n}`,
        goal_id: "goal-t08",
        phase_id: "build",
        step_id: `T${n}`,
        team_id: "t08",
        logical_task_id: `T${n}`,
        fanout: "lead_plus_one",
        lead: { lead_binding_id: "lead-binding-t08", team_lead_instance_id: null },
      });
      return runtime.spawnInstance(cell, {
        task_run_id: `T${n}.tr1`,
        attempt: 1,
        worker_role: "developer",
        specialist_type_id: "developer",
        specialist_type_version: "1",
        specialist_type_hash: "sha256:type",
        specialist_profile_id: "developer",
        specialist_profile_hash: "sha256:profile",
        host_id: "claude-code-cli",
        adapter_id: "claude-code-cli@1",
        host_capabilities_hash: "sha256:caps",
        model_tier: "mid",
        context_bundle_id: `.guild/context/run-t08/developer-T${n}.md`,
        context_bundle_hash: "sha256:ctx",
        projection: { tools: ["Read"], permissions: [], recorded_losses: [] },
        budgets: { tokens: null, wall_clock_ms: null, cost_usd: null },
      });
    };
    for (let n = 1; n <= 4; n += 1) await spawn(n);
    await expect(spawn(5)).rejects.toThrow(/not_authorized.*max_instances=4/s);
    // The refused instance left no attempt behind.
    expect(fs.existsSync(path.join(cwd, ".guild", "runs", runId, "task-cells", "T5"))).toBe(false);
  });
});

// ── F08 / F09 ────────────────────────────────────────────────────────────────

describe("F08 advisorRounds exhausted blocks with next_need: budget (R72)", () => {
  it("spends the cap, then blocks instead of consulting again", () => {
    const cwd = tmpRoot("advisor");
    const ids = { cwd, run_id: "run-t08", logical_task_id: "T1-backend" };
    expect(resolveAdvisorRounds({})).toBe(2);
    initAdvisorBudget({ ...ids, cell_id: "cell-T1-backend", rounds_allowed: 2, now: FIXED_NOW });

    const r1 = consumeConsult({ ...ids, kind: "advisor", now: FIXED_NOW });
    expect(r1).toEqual(expect.objectContaining({ ok: true, decremented: true, remaining: 1 }));
    const r2 = consumeConsult({ ...ids, kind: "advisor", now: FIXED_NOW });
    expect(r2).toEqual(expect.objectContaining({ ok: true, decremented: true, remaining: 0 }));

    const blocked = consumeConsult({ ...ids, kind: "advisor", now: FIXED_NOW });
    const blockedR = refusal(blocked);
    expect(blockedR.state).toBe("blocked");
    expect(blockedR.next_need).toBe("budget");

    // The block is reportable upward as a valid goal_status without leaking specifics.
    const envelope = goalStatus({
      state: "blocked",
      blocked_reason: "advisor rounds exhausted",
      next_need: "budget",
      budget_remaining: { tokens: 0 },
    });
    expect(validateGoalStatusV1(envelope)).not.toBeNull();
    expect(lintOrchestratorContext({ envelopes: [envelope] })).toEqual([]);
  });
});

describe("F09 D-PROBE does not decrement the advisor cap (R72/KTD61)", () => {
  it("charges advisor consults only; probe and inner verify stay free", () => {
    const cwd = tmpRoot("d-probe");
    const ids = { cwd, run_id: "run-t08", logical_task_id: "T1-backend" };
    initAdvisorBudget({ ...ids, cell_id: "cell-T1-backend", rounds_allowed: 2, now: FIXED_NOW });

    for (const kind of ["d-probe", "inner-verify", "harvest-bm25", "machinery"] as const) {
      const r = consumeConsult({ ...ids, kind, now: FIXED_NOW });
      expect(r).toEqual(expect.objectContaining({ ok: true, decremented: false, remaining: 2 }));
    }
    // Ten probes later the cell still has its full advisor budget.
    for (let i = 0; i < 10; i += 1) consumeConsult({ ...ids, kind: "d-probe", now: FIXED_NOW });
    expect(consumeConsult({ ...ids, kind: "advisor", now: FIXED_NOW })).toEqual(
      expect.objectContaining({ ok: true, remaining: 1 }),
    );
  });
});

// ── F10 ──────────────────────────────────────────────────────────────────────

describe("F10 the per-goal slice uses minted profiles only (R73)", () => {
  const phaseRoster = [
    { name: "backend", source: "project" as const },
    { name: "frontend", source: "project" as const },
    { name: "security", source: "template" as const },
    { name: "advisor", source: "shipped" as const },
  ];

  it("returns the whole phase roster under the default phase scope", () => {
    const res = sliceRosterForGoal({ scope: "phase", phase_roster: phaseRoster });
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error("unreachable");
    expect(res.roster).toHaveLength(4);
  });

  it("selects minted project profiles for a goal", () => {
    const goal = validateGoalV1({
      schema_version: "guild.goal.v1",
      id: "goal-t08",
      title: "ship the tier split",
      problem: "one context holds both ledgers",
      outcome: "three tiers, two envelopes",
      validation: ["fixtures green"],
      execution: ["U-TIER"],
      risks: [],
      acceptance_criteria_ids: ["R33"],
      project_scope: ["plugin"],
      roster_role_ids: ["backend", "frontend"],
    });
    expect(goal).not.toBeNull();
    const res = sliceRosterForGoal({ scope: "goal", phase_roster: phaseRoster, goal: goal! });
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error("unreachable");
    expect(res.roster.map((r) => r.name)).toEqual(["backend", "frontend"]);
  });

  it("refuses a slice naming an unminted template or a role outside the phase roster", () => {
    const res = sliceRosterForGoal({
      scope: "goal",
      phase_roster: phaseRoster,
      goal: { roster_role_ids: ["backend", "security", "nobody"] },
    });
    const resR = refusal(res);
    expect(resR.unminted).toEqual(["security (template)"]);
    expect(resR.unknown).toEqual(["nobody"]);
    expect(resR.reason).toMatch(/never mints a parallel tree/);
  });
});

// ── F11 ──────────────────────────────────────────────────────────────────────

describe("F11 the phase team file still resolves (R73)", () => {
  it("resolves the per-phase file, the .current pointer, and the legacy fallback", () => {
    const root = tmpRoot("team-file");
    const teamDir = path.join(root, ".guild", "team");
    fs.mkdirSync(teamDir, { recursive: true });

    fs.writeFileSync(path.join(teamDir, "plr.build.yaml"), "specialists: []\n", "utf8");
    expect(resolveTeamFile(root, "plr", "build")).toBe(path.join(teamDir, "plr.build.yaml"));

    fs.writeFileSync(path.join(teamDir, "plr.current"), "build\n", "utf8");
    expect(resolveTeamFile(root, "plr", null)).toBe(path.join(teamDir, "plr.build.yaml"));

    fs.writeFileSync(path.join(teamDir, "legacy.yaml"), "specialists: []\n", "utf8");
    expect(resolveTeamFile(root, "legacy", null)).toBe(path.join(teamDir, "legacy.yaml"));
  });
});

// ── Assignment host/model ids come from the run binding (KTD22) ──────────────

describe("assignment host/model ids are copied from the session binding (KTD22)", () => {
  const runDir = "/nonexistent/run";

  it("copies the tier's model id from the run binding", () => {
    const res = resolveAssignmentBinding({
      runDir,
      tier: "powerful",
      read: () => ({
        schema_version: "guild.session_binding.v1",
        run_id: "run-t08",
        host_family: "claude-code-cli",
        surface: "cli",
        detected_at: FIXED_NOW(),
        models: { cheap: "haiku", mid: "sonnet", powerful: "opus" },
        model_family: "claude",
        prompt_compose: { dialect_id: "claude", overlay_ids: [], hash: "sha256:x" },
        evidence: { cheap: "available", mid: "available", powerful: "available" },
      }),
    });
    expect(res).toEqual(
      expect.objectContaining({ ok: true, host_id: "claude-code-cli", model_id: "opus" }),
    );
  });

  it("BLOCKS an unknown host instead of defaulting to Claude", () => {
    const res = resolveAssignmentBinding({
      runDir,
      tier: "mid",
      read: () => ({
        schema_version: "guild.session_binding.v1",
        run_id: "run-t08",
        host_family: "unknown",
        surface: "unknown",
        detected_at: FIXED_NOW(),
        models: {},
        model_family: "unknown",
        prompt_compose: { dialect_id: "neutral", overlay_ids: [], hash: "sha256:x" },
        evidence: { cheap: "unknown", mid: "unknown", powerful: "unknown" },
      }),
    });
    const resR = refusal(res);
    expect(resR.blocked).toBe("unknown_host");
    expect(resR.reason).toMatch(/never resolves to Claude/);
  });

  it("BLOCKS an empty model map rather than treating it as usable", () => {
    const res = resolveAssignmentBinding({
      runDir,
      tier: "powerful",
      read: () => ({
        schema_version: "guild.session_binding.v1",
        run_id: "run-t08",
        host_family: "codex-cli",
        surface: "cli",
        detected_at: FIXED_NOW(),
        models: {},
        model_family: "gpt",
        prompt_compose: { dialect_id: "gpt", overlay_ids: [], hash: "sha256:x" },
        evidence: { cheap: "unknown", mid: "unknown", powerful: "unknown" },
      }),
    });
    expect(res).toEqual(expect.objectContaining({ ok: false, blocked: "no_model_for_tier" }));
  });

  it("BLOCKS when the run carries no binding at all", () => {
    const res = resolveAssignmentBinding({ runDir, tier: "mid", read: () => null });
    expect(res).toEqual(expect.objectContaining({ ok: false, blocked: "no_binding" }));
  });
});

/** Referenced so the adapter export stays part of this suite's import surface. */
describe("execution-transport worker port stays constructible", () => {
  it("is exported from the dispatch runtime", () => {
    expect(typeof ExecutionTransportTaskCellWorkerPort).toBe("function");
  });
});
