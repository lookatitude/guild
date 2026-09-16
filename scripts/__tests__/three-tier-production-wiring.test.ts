/**
 * scripts/__tests__/three-tier-production-wiring.test.ts
 *
 * U-TIER (T08) rework-r1 — the codex G-lane round-1 findings, each proven on the
 * PRODUCTION caller rather than on the helper the round-1 lane shipped.
 *
 * The recurring round-1 defect was that the guards existed and nothing called
 * them. So every case here drives the real seam:
 *
 *   W1  the projection is fixed at spawn; `deliverAssignment` refuses a widened
 *       one, and the disk-backed tool gate the PreToolUse seam calls fails closed
 *   W2  `lead_only` binds the parent and spawns NO process (recorded loss)
 *   W3  a specialist publishing to the orchestrator's channel is refused by the
 *       real `artifact-bus.publish`
 *   W4  the instance cap is run-scoped and counted from disk: a fifth spawn is
 *       refused ACROSS two runtime objects, and the launcher refuses a batch
 *   W5  `emitTaskCellsV2` BLOCKS when the run carries no session binding
 *   W6  acceptance binds the ledger to the assignment's own `done_when[]`
 *   W7  the advisor budget survives re-initialisation and blocks on the
 *       production consult path
 *   W8  the orchestrator lint and fold see NESTED assignments
 *   W9  an empty minted slice returns nothing + `next_need: mint`, never templates
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { emitTaskCellsV2 } from "../agent-team-launcher";
import { publish, lastBusPublishRefusal } from "../lib/artifact-bus";
import { authenticateBusTier } from "../../src/modules/kernel/workflows/tier-bus";
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
import { InProcessExecutionTransport } from "../../src/modules/dispatch/workflows/execution-transport-adapters";
import type { ExecutionTransportPort } from "../../src/modules/dispatch/workflows/execution-transport-ports";
import {
  countLiveRunInstances,
  countOpenReservations,
  isInstanceReservation,
  reserveInstance,
  type ReserveResult,
} from "../../src/modules/dispatch/workflows/instance-cap";
import {
  authorizeProjectedToolCall,
  projectionNarrowsOnly,
} from "../../src/modules/dispatch/workflows/isolation-guard";
import {
  initProgressLedger,
  ledgerBoundToAssignment,
  recordOracleOutcome,
  readProgressLedger,
} from "../../src/modules/dispatch/workflows/progress-ledger";
import {
  consumeConsult,
  initAdvisorBudget,
  readAdvisorBudget,
} from "../../src/modules/dispatch/workflows/advisor-budget";
import {
  findNestedForbiddenSchema,
  foldOrchestratorContext,
  lintOrchestratorContext,
} from "../../src/modules/teams/workflows/goal-contract";
import { sliceRosterForGoal } from "../../src/modules/teams/workflows/compose-scope";
import { loadRunBinding, mintRunBinding } from "../../src/modules/lifecycle/workflows/run-binding";
import {
  sessionBindingPath,
  type SessionBinding,
} from "../../src/modules/config/workflows/session-binding";
import {
  assignmentId,
  taskCellPaths,
  type AcceptHandoffRequest,
  type InstanceHandle,
  type TaskAssignmentV2,
} from "../lib/core/contracts/task-cell-backend";
import type { TaskCellLaunchLane } from "../lib/task-cell-launch-plan";

const FIXED_NOW = () => "2026-09-15T00:00:00.000Z";
const RUN_ID = "run-t08rw";

/** Narrow a result union to its refusal arm (the ts-jest transform is non-strict). */
function refusal<T extends { ok: boolean }>(value: T): Extract<T, { ok: false }> {
  if (value.ok) throw new Error(`expected a refusal, got ${JSON.stringify(value)}`);
  return value as Extract<T, { ok: false }>;
}

/** Mint-or-load: a run binding is minted once and restored thereafter. */
function bindingRefFor(root: string): string {
  return (
    loadRunBinding({ root, run_id: RUN_ID }) ?? mintRunBinding({ root, run_id: RUN_ID })
  ).binding_ref;
}

function tmpRoot(tag: string): string {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `guild-t08rw-${tag}-`)));
}

/** A worker port that records what it was asked to spawn. */
function recordingWorker(): TaskCellWorkerPort & { spawned: string[] } {
  const ok = { ok: true as const, reason: null };
  const spawned: string[] = [];
  return {
    spawned,
    mode: "native",
    losses: [],
    isAvailable: () => true,
    spawn: ({ instance_id }) => {
      spawned.push(instance_id);
      return ok;
    },
    ready: () => ok,
    notifyAssignment: () => ok,
    terminate: () => ok,
  };
}

/** One non-terminal attempt record on disk — the shape the cap counts. */
function writeLiveAttempt(cwd: string, logicalTaskId: string): void {
  const dir = path.join(
    cwd, ".guild", "runs", RUN_ID, "task-cells", logicalTaskId, "attempts", "1",
  );
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "attempt.json"),
    JSON.stringify({
      schema_version: "guild.task_attempt.v1",
      run_id: RUN_ID,
      logical_task_id: logicalTaskId,
      attempt: 1,
      instance_id: `${logicalTaskId}.i1`,
      terminal_state: null,
    }),
    "utf8",
  );
}

/** `emitTaskCellsV2` hashes each lane's context bundle, so it must exist. */
function writeLaneContexts(cwd: string, taskIds: readonly string[]): void {
  const dir = path.join(cwd, ".guild", "context", RUN_ID);
  fs.mkdirSync(dir, { recursive: true });
  for (const id of taskIds) {
    fs.writeFileSync(path.join(dir, `plr-lane-${id}.md`), `# context ${id}\n`, "utf8");
  }
}

function writeSessionBinding(cwd: string, runId: string, over: Partial<SessionBinding> = {}): void {
  const runDir = path.join(cwd, ".guild", "runs", runId);
  fs.mkdirSync(runDir, { recursive: true });
  const binding: SessionBinding = {
    schema_version: "guild.session_binding.v1",
    run_id: runId,
    host_family: "claude-code-cli",
    surface: "cli",
    detected_at: FIXED_NOW(),
    models: { cheap: "haiku", mid: "sonnet", powerful: "opus" },
    model_family: "claude",
    prompt_compose: { dialect_id: "claude", overlay_ids: [], hash: "sha256:x" },
    evidence: { cheap: "available", mid: "available", powerful: "available" },
    ...over,
  };
  fs.writeFileSync(sessionBindingPath(runDir), `${JSON.stringify(binding, null, 2)}\n`, "utf8");
}

function dispatchInput(over: Partial<TaskCellDispatchInput> = {}): TaskCellDispatchInput {
  const logicalTaskId = over.logicalTaskId ?? "T1-backend";
  return {
    runId: RUN_ID,
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
    contextBundleId: `.guild/context/${RUN_ID}/backend-${logicalTaskId}.md`,
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

interface Spawned {
  runtime: FilesystemTaskCellRuntime;
  worker: ReturnType<typeof recordingWorker>;
  instance: InstanceHandle;
}

let idSeq = 0;

async function spawnOne(input: {
  cwd: string;
  logicalTaskId: string;
  fanout?: "lead_only" | "lead_plus_one" | "lead_plus_many";
  projection?: string[];
  runtime?: FilesystemTaskCellRuntime;
  worker?: ReturnType<typeof recordingWorker>;
}): Promise<Spawned> {
  const worker = input.worker ?? recordingWorker();
  const runtime =
    input.runtime ??
    new FilesystemTaskCellRuntime({
      cwd: input.cwd,
      substrate: "tmux",
      parallelism: 8,
      binding: { binding_ref: bindingRefFor(input.cwd) },
      worker,
      now: FIXED_NOW,
      // Globally unique across runtime objects: the telemetry event id is keyed on
      // the instance id, and two objects in one run must not collide.
      idFactory: (kind) => `${kind}-${++idSeq}`,
    });
  const cell = await runtime.spawnCell({
    run_id: RUN_ID,
    cell_id: `cell-${input.logicalTaskId}`,
    goal_id: "goal-t08",
    phase_id: "build",
    step_id: input.logicalTaskId,
    team_id: "t08",
    logical_task_id: input.logicalTaskId,
    fanout: input.fanout ?? "lead_plus_one",
    lead: { lead_binding_id: "lead-binding-t08", team_lead_instance_id: null },
  });
  const instance = await runtime.spawnInstance(cell, {
    task_run_id: `${input.logicalTaskId}.tr1`,
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
    context_bundle_id: `.guild/context/${RUN_ID}/backend-${input.logicalTaskId}.md`,
    context_bundle_hash: "sha256:ctx",
    projection: {
      tools: input.projection ?? ["Read"],
      permissions: [],
      recorded_losses: [],
    },
    budgets: { tokens: null, wall_clock_ms: null, cost_usd: null },
  });
  await runtime.awaitReady(instance);
  return { runtime, worker, instance };
}

// ── W1 ───────────────────────────────────────────────────────────────────────

describe("W1 the projection is fixed at spawn and the tool gate fails closed", () => {
  it("refuses an assignment that WIDENS the instance's projection", async () => {
    const cwd = tmpRoot("widen");
    const { runtime, instance } = await spawnOne({
      cwd,
      logicalTaskId: "T1-backend",
      projection: ["Read"],
    });
    // The exact round-1 hole: spawned with ["Read"], delivered ["Read","Bash"].
    const widened = buildTaskCell(
      dispatchInput({
        instanceId: instance.instance_id,
        attemptId: instance.attempt_id,
        projection: { tools: ["Read", "Bash"], permissions: [], recorded_losses: [] },
      }),
    ).assignment;
    const delivered = await runtime.deliverAssignment(instance, widened);
    const deliveredR = refusal(delivered);
    expect(deliveredR.failure).toBe("not_authorized");
    expect(deliveredR.reason).toMatch(/widens the instance's tool projection with \[Bash\]/);
  });

  it("accepts an assignment that NARROWS the projection", async () => {
    const cwd = tmpRoot("narrow");
    const { runtime, instance } = await spawnOne({
      cwd,
      logicalTaskId: "T1-backend",
      projection: ["Read", "Write"],
    });
    const narrowed = buildTaskCell(
      dispatchInput({
        instanceId: instance.instance_id,
        attemptId: instance.attempt_id,
        projection: { tools: ["Read"], permissions: [], recorded_losses: [] },
      }),
    ).assignment;
    expect((await runtime.deliverAssignment(instance, narrowed)).ok).toBe(true);
    expect(projectionNarrowsOnly({ spawned: { tools: ["Read"] }, delivered: { tools: [] } }).ok).toBe(
      true,
    );
  });

  it("fails closed at the PreToolUse seam, which holds only the worker's env identity", async () => {
    const cwd = tmpRoot("gate");
    const { runtime, instance } = await spawnOne({
      cwd,
      logicalTaskId: "T1-backend",
      projection: ["Read"],
    });
    const assignment = buildTaskCell(
      dispatchInput({
        instanceId: instance.instance_id,
        attemptId: instance.attempt_id,
        projection: { tools: ["Read"], permissions: [], recorded_losses: [] },
      }),
    ).assignment;
    expect((await runtime.deliverAssignment(instance, assignment)).ok).toBe(true);

    // This is the shape the host adapter's PreToolUse hook has: GUILD_RUN_ID,
    // GUILD_TASK_ID and GUILD_TASK_CELL_INSTANCE_ID off the worker's env, no
    // runtime object, and no projection passed in by the caller.
    const env = {
      cwd,
      run_id: instance.run_id,
      logical_task_id: instance.logical_task_id,
      attempt: instance.attempt,
      instance_id: instance.instance_id,
    };
    expect(authorizeProjectedToolCall({ ...env, tool: "Read" }).ok).toBe(true);
    const denied = refusal(authorizeProjectedToolCall({ ...env, tool: "Bash" }));
    expect(denied.refusal).toBe("off_projection");
    expect(denied.reason).toMatch(/outside this assignment's tool projection/);

    // An unknown instance has no assignment, so it has no authority at all.
    const unknown = refusal(
      authorizeProjectedToolCall({ ...env, instance_id: "not-an-instance", tool: "Read" }),
    );
    expect(unknown.reason).toMatch(/no readable guild.task_assignment.v2/);

    // And the runtime's own seam agrees with the disk-backed one.
    expect(refusal(runtime.authorizeToolCall(instance, "Bash")).failure).toBe("not_authorized");
  });
});

// ── W2 ───────────────────────────────────────────────────────────────────────

describe("W2 lead_only binds the parent and spawns nothing", () => {
  it("spawns no process and records the isolation loss on the instance", async () => {
    const cwd = tmpRoot("lead-only");
    const { worker, instance } = await spawnOne({
      cwd,
      logicalTaskId: "T1-lead-only",
      fanout: "lead_only",
    });
    expect(worker.spawned).toEqual([]);

    const paths = taskCellPaths({
      run_id: RUN_ID,
      logical_task_id: "T1-lead-only",
      attempt: 1,
      instance_id: instance.instance_id,
    });
    const record = JSON.parse(fs.readFileSync(path.join(cwd, paths.instance_path), "utf8")) as {
      projection: { recorded_losses: Array<{ capability: string; mapping: string; loss: string }> };
    };
    const loss = record.projection.recorded_losses.find((l) => l.mapping === "lead_only");
    expect(loss).toBeDefined();
    expect(loss!.capability).toBe("task_cell.isolation");
    expect(loss!.loss).toMatch(/no worker process spawned/);
  });

  it("completes with ZERO interaction on the REAL transport port (r2)", async () => {
    const cwd = tmpRoot("lead-only-transport");
    // A real execution transport, wrapped so every single call is counted. The
    // round-2 hole was `notifyAssignment` reaching this port, whose honest answer
    // for in-process dispatch is "the transport holds no process handle".
    const calls: string[] = [];
    const real = new InProcessExecutionTransport({
      backend: { kind: "in-process", isAvailable: () => true, launch: () => ({ ok: true }) } as never,
    });
    const counted = new Proxy(real, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver);
        if (typeof value === "function") {
          return (...args: unknown[]) => {
            calls.push(String(prop));
            return (value as (...a: unknown[]) => unknown).apply(target, args);
          };
        }
        return value;
      },
    }) as ExecutionTransportPort;
    const worker = new ExecutionTransportTaskCellWorkerPort({
      transport: counted,
      requestFor: ({ instance_id }) => ({ handle_id: instance_id, payload: {} }) as never,
    });
    // The port's CONSTRUCTOR probes `supports()` to compute its mode and losses.
    // That is construction, not a cell touching the transport, so the counter
    // starts from the moment the lifecycle does.
    calls.length = 0;
    const runtime = new FilesystemTaskCellRuntime({
      cwd,
      substrate: "tmux",
      parallelism: 4,
      binding: { binding_ref: bindingRefFor(cwd) },
      worker,
      now: FIXED_NOW,
      idFactory: (kind) => `${kind}-${++idSeq}`,
    });
    const cell = await runtime.spawnCell({
      run_id: RUN_ID,
      cell_id: "cell-T1-lead",
      goal_id: "goal-t08",
      phase_id: "build",
      step_id: "T1-lead",
      team_id: "t08",
      logical_task_id: "T1-lead",
      fanout: "lead_only",
      lead: { lead_binding_id: "lead-binding-t08", team_lead_instance_id: null },
    });
    const instance = await runtime.spawnInstance(cell, {
      task_run_id: "T1-lead.tr1",
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
      context_bundle_id: `.guild/context/${RUN_ID}/backend-T1-lead.md`,
      context_bundle_hash: "sha256:ctx",
      projection: { tools: ["Read"], permissions: [], recorded_losses: [] },
      budgets: { tokens: null, wall_clock_ms: null, cost_usd: null },
    });
    expect((await runtime.awaitReady(instance)).ok).toBe(true);

    const assignment = buildTaskCell(
      dispatchInput({
        logicalTaskId: "T1-lead",
        taskRunId: "T1-lead.tr1",
        cellId: "cell-T1-lead",
        instanceId: instance.instance_id,
        attemptId: instance.attempt_id,
        contextBundleId: `.guild/context/${RUN_ID}/backend-T1-lead.md`,
        projection: { tools: ["Read"], permissions: [], recorded_losses: [] },
      }),
    ).assignment;
    expect((await runtime.deliverAssignment(instance, assignment)).ok).toBe(true);
    // Delivered in-session: the parent is both lead and worker, so the ack is
    // written by delivery and the cell reaches `running` with no transport.
    expect((await runtime.awaitAssignmentAck(instance)).ok).toBe(true);
    expect((await runtime.cancel(instance, "done in session")).ok).toBe(true);

    // Not one call — not spawn, not notify, not terminate, not even a supports()
    // probe. A lead_only cell never consults the substrate it declined to use.
    expect(calls).toEqual([]);
  });

  it("still spawns for a lead_plus_one cell", async () => {
    const cwd = tmpRoot("lead-plus-one");
    const { worker, instance } = await spawnOne({
      cwd,
      logicalTaskId: "T1-fanned",
      fanout: "lead_plus_one",
    });
    expect(worker.spawned).toEqual([instance.instance_id]);
  });
});

// ── W3 ───────────────────────────────────────────────────────────────────────

describe("W3 the bus authenticates the tier from durable state (r2)", () => {
  const BINDING = "rb-w3binding";

  /** A run dir with a minted binding and one REAL attempt record for a worker. */
  function runDirFor(tag: string): { runDir: string; cwd: string } {
    const cwd = tmpRoot(tag);
    const runDir = path.join(cwd, ".guild", "runs", RUN_ID);
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(
      path.join(runDir, "binding.json"),
      JSON.stringify({ run_id: RUN_ID, binding_ref: BINDING }),
      "utf8",
    );
    const attemptDir = path.join(runDir, "task-cells", "T1-backend", "attempts", "1");
    fs.mkdirSync(attemptDir, { recursive: true });
    fs.writeFileSync(
      path.join(attemptDir, "attempt.json"),
      JSON.stringify({
        schema_version: "guild.task_attempt.v1",
        run_id: RUN_ID,
        logical_task_id: "T1-backend",
        attempt: 1,
        instance_id: "worker-i1",
        terminal_state: null,
      }),
      "utf8",
    );
    return { runDir, cwd };
  }

  const WORKER = {
    kind: "attempt" as const,
    logical_task_id: "T1-backend",
    attempt: 1,
    instance_id: "worker-i1",
  };

  it("authenticates a worker attempt as T2 and the run binding as T1", () => {
    expect(
      authenticateBusTier(WORKER, { attempt_instance_id: "worker-i1" }),
    ).toEqual({ ok: true, tier: "T2", subject: "worker-i1" });
    expect(
      authenticateBusTier({ kind: "runtime", binding_ref: BINDING }, { run_binding_ref: BINDING }),
    ).toEqual({ ok: true, tier: "T1", subject: "runtime" });
  });

  it("REFUSES a T2 attempt that publishes claiming tier T1, and the bytes never land", () => {
    const { runDir } = runDirFor("bus-spoof");
    const event = publish(runDir, {
      runId: RUN_ID,
      topic: "status/qa/T3",
      content: "I am totally the lead",
      // The exact round-2 hole: the tier was read off this payload.
      publisher: { host_id: "claude-local", role: "team-lead", tier: "T1" },
      identity: WORKER,
      now: FIXED_NOW,
    });
    expect(event).toBeNull();
    expect(lastBusPublishRefusal()).toMatch(/declared tier T1 but the authenticated identity/);
    expect(fs.existsSync(path.join(runDir, "bus", "log.jsonl"))).toBe(false);
    expect(fs.existsSync(path.join(runDir, "bus", "cas"))).toBe(false);
  });

  it("REFUSES the same attempt on a status/ topic even with no tier claimed", () => {
    const { runDir } = runDirFor("bus-worker-status");
    expect(
      publish(runDir, {
        runId: RUN_ID,
        topic: "status/qa/T3",
        content: "x",
        publisher: { host_id: "claude-local", role: "backend" },
        identity: WORKER,
        now: FIXED_NOW,
      }),
    ).toBeNull();
    expect(lastBusPublishRefusal()).toMatch(/addressed the orchestrator directly/);
    expect(fs.existsSync(path.join(runDir, "bus", "log.jsonl"))).toBe(false);
  });

  it("REFUSES a gated publish that carries no runtime-issued identity at all", () => {
    const { runDir } = runDirFor("bus-anon");
    expect(
      publish(runDir, {
        runId: RUN_ID,
        topic: "status/qa/T3",
        content: "x",
        publisher: { host_id: "claude-local", role: "team-lead", tier: "T1" },
        now: FIXED_NOW,
      }),
    ).toBeNull();
    expect(lastBusPublishRefusal()).toMatch(/carries no runtime-issued identity/);
  });

  it("REFUSES a forged binding_ref and an attempt identity that names another instance", () => {
    const { runDir } = runDirFor("bus-forged");
    expect(
      publish(runDir, {
        runId: RUN_ID,
        topic: "status/qa/T3",
        content: "x",
        publisher: { host_id: "claude-local", role: "team-lead" },
        identity: { kind: "runtime", binding_ref: "rb-not-this-run" },
        now: FIXED_NOW,
      }),
    ).toBeNull();
    expect(lastBusPublishRefusal()).toMatch(/does not match this run's minted binding/);

    expect(
      publish(runDir, {
        runId: RUN_ID,
        topic: "handoff/backend/T1-backend",
        content: "x",
        publisher: { host_id: "claude-local", role: "backend" },
        identity: { ...WORKER, instance_id: "someone-else" },
        now: FIXED_NOW,
      }),
    ).toBeNull();
    expect(lastBusPublishRefusal()).toMatch(/identity mismatch/);
  });

  it("ALLOWS the runtime on status/ and the authenticated worker on its own handoff", () => {
    const { runDir } = runDirFor("bus-allow");
    expect(
      publish(runDir, {
        runId: RUN_ID,
        topic: "status/qa/T3",
        content: "cell running",
        publisher: { host_id: "claude-local", role: "team-lead" },
        identity: { kind: "runtime", binding_ref: BINDING },
        now: FIXED_NOW,
      }),
    ).not.toBeNull();
    expect(
      publish(runDir, {
        runId: RUN_ID,
        topic: "handoff/backend/T1-backend",
        content: "receipt",
        publisher: { host_id: "claude-local", role: "backend" },
        identity: WORKER,
        now: FIXED_NOW,
      }),
    ).not.toBeNull();
  });

  it("still refuses a lead that forwards a receipt upward", () => {
    const { runDir } = runDirFor("bus-envelope");
    expect(
      publish(runDir, {
        runId: RUN_ID,
        topic: "status/qa/T3",
        content: "receipt bytes",
        envelope: "guild.handoff.v2",
        publisher: { host_id: "claude-local", role: "team-lead" },
        identity: { kind: "runtime", binding_ref: BINDING },
        now: FIXED_NOW,
      }),
    ).toBeNull();
    expect(lastBusPublishRefusal()).toMatch(/T1 → T0 carries guild.goal_status.v1/);
  });
});

// ── W4 ───────────────────────────────────────────────────────────────────────

describe("W4 the instance cap is run-scoped and counted from disk", () => {
  it("refuses the fifth spawn ACROSS two runtime objects", async () => {
    const cwd = tmpRoot("cap-two-objects");
    const bindingRef = bindingRefFor(cwd);
    const makeRuntime = () =>
      new FilesystemTaskCellRuntime({
        cwd,
        substrate: "tmux",
        parallelism: 8,
        binding: { binding_ref: bindingRef },
        worker: recordingWorker(),
        now: FIXED_NOW,
        idFactory: (kind) => `${kind}-${++idSeq}`,
      });
    const first = makeRuntime();
    const second = makeRuntime();

    // Two on the first object, two on the second — the run now holds four.
    await spawnOne({ cwd, logicalTaskId: "T1", runtime: first });
    await spawnOne({ cwd, logicalTaskId: "T2", runtime: first });
    await spawnOne({ cwd, logicalTaskId: "T3", runtime: second });
    await spawnOne({ cwd, logicalTaskId: "T4", runtime: second });
    expect(countLiveRunInstances({ cwd, run_id: RUN_ID })).toBe(4);

    // Round 1 admitted this: `second` had only counted two in its own memory.
    await expect(spawnOne({ cwd, logicalTaskId: "T5", runtime: second })).rejects.toThrow(
      /not_authorized.*max_instances=4/s,
    );
    expect(fs.existsSync(path.join(cwd, ".guild", "runs", RUN_ID, "task-cells", "T5"))).toBe(false);
  });

  it("a STALE release cannot delete a later claimant's slot (codex r4 P1)", () => {
    // reserve X → release → X re-claimed by a later admission → the OLD release
    // fires again: it must not touch the new claimant's placeholder.
    const cwd = tmpRoot("cap-stale-release");
    const ids = { cwd, run_id: RUN_ID, logical_task_id: "T1", attempt: 1 };
    const first = reserveInstance(ids);
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error("unreachable");
    first.reservation.release();
    expect(countLiveRunInstances({ cwd, run_id: RUN_ID })).toBe(0);
    const second = reserveInstance(ids);
    expect(second.ok).toBe(true);
    expect(countLiveRunInstances({ cwd, run_id: RUN_ID })).toBe(1);
    // The stale release from the first claimant is a no-op now.
    first.reservation.release();
    expect(countLiveRunInstances({ cwd, run_id: RUN_ID })).toBe(1);
    expect(fs.existsSync(first.reservation.path)).toBe(true);
    // The rightful owner can still give it back.
    if (second.ok) second.reservation.release();
    expect(countLiveRunInstances({ cwd, run_id: RUN_ID })).toBe(0);
  });

  it("does not count terminal attempts as occupancy", async () => {
    const cwd = tmpRoot("cap-terminal");
    const { runtime, instance } = await spawnOne({ cwd, logicalTaskId: "T1" });
    expect(countLiveRunInstances({ cwd, run_id: RUN_ID })).toBe(1);
    expect((await runtime.cancel(instance, "operator stopped the lane")).ok).toBe(true);
    expect(countLiveRunInstances({ cwd, run_id: RUN_ID })).toBe(0);
  });

  it("lets exactly ONE of two concurrent admissions through at three live", async () => {
    const cwd = tmpRoot("cap-race");
    bindingRefFor(cwd);
    for (const id of ["R1", "R2", "R3"]) writeLiveAttempt(cwd, id);
    expect(countLiveRunInstances({ cwd, run_id: RUN_ID })).toBe(3);

    // Both racers claim the LAST slot. Admission and the claim are one act, so
    // only one can win — round 2's hole was an admission that merely observed.
    const [a, b] = await Promise.all([
      Promise.resolve().then(() =>
        reserveInstance({ cwd, run_id: RUN_ID, logical_task_id: "racer-a", attempt: 1 }),
      ),
      Promise.resolve().then(() =>
        reserveInstance({ cwd, run_id: RUN_ID, logical_task_id: "racer-b", attempt: 1 }),
      ),
    ]);
    expect([a, b].filter((r) => r.ok)).toHaveLength(1);
    const loser = [a, b].find((r) => !r.ok) as ReserveResult;
    expect(refusal(loser).reason).toMatch(/max_instances=4 would be exceeded/);
    expect(countLiveRunInstances({ cwd, run_id: RUN_ID })).toBe(4);

    const winner = [a, b].find((r) => r.ok) as Extract<ReserveResult, { ok: true }>;
    // The claim IS the attempt's live marker — one file, at the attempt's path.
    expect(winner.reservation.path).toMatch(
      /task-cells\/racer-[ab]\/attempts\/1\/attempt\.json$/,
    );
    expect(isInstanceReservation(fs.readFileSync(winner.reservation.path, "utf8"))).toBe(true);
    expect(countOpenReservations({ cwd, run_id: RUN_ID })).toBe(1);
    expect(
      reserveInstance({ cwd, run_id: RUN_ID, logical_task_id: "racer-c", attempt: 1 }).ok,
    ).toBe(false);

    winner.reservation.release();
    expect(countOpenReservations({ cwd, run_id: RUN_ID })).toBe(0);
    expect(countLiveRunInstances({ cwd, run_id: RUN_ID })).toBe(3);
    expect(
      reserveInstance({ cwd, run_id: RUN_ID, logical_task_id: "racer-d", attempt: 1 }).ok,
    ).toBe(true);
  });

  it("admits exactly four concurrent spawnInstance calls and refuses a fifth (r3)", async () => {
    const cwd = tmpRoot("cap-concurrent-spawn");
    const bindingRef = bindingRefFor(cwd);
    const runtime = new FilesystemTaskCellRuntime({
      cwd,
      substrate: "tmux",
      parallelism: 8,
      binding: { binding_ref: bindingRef },
      worker: recordingWorker(),
      now: FIXED_NOW,
      idFactory: (kind) => `${kind}-${++idSeq}`,
    });
    const spawn = async (n: number): Promise<InstanceHandle> => {
      const cell = await runtime.spawnCell({
        run_id: RUN_ID,
        cell_id: `cell-C${n}`,
        goal_id: "goal-t08",
        phase_id: "build",
        step_id: `C${n}`,
        team_id: "t08",
        logical_task_id: `C${n}`,
        fanout: "lead_plus_one",
        lead: { lead_binding_id: "lead-binding-t08", team_lead_instance_id: null },
      });
      return runtime.spawnInstance(cell, {
        task_run_id: `C${n}.tr1`,
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
        context_bundle_id: `.guild/context/${RUN_ID}/backend-C${n}.md`,
        context_bundle_hash: "sha256:ctx",
        projection: { tools: ["Read"], permissions: [], recorded_losses: [] },
        budgets: { tokens: null, wall_clock_ms: null, cost_usd: null },
      });
    };
    const settled = await Promise.allSettled([spawn(1), spawn(2), spawn(3), spawn(4)]);
    expect(settled.filter((r) => r.status === "fulfilled")).toHaveLength(4);
    // Four live, counted once each: round 3's P2 was the attempt and its
    // reservation both counting during the handover.
    expect(countLiveRunInstances({ cwd, run_id: RUN_ID })).toBe(4);
    expect(countOpenReservations({ cwd, run_id: RUN_ID })).toBe(0);
    await expect(spawn(5)).rejects.toThrow(/not_authorized.*max_instances=4/s);
  });

  it("frees the slot when the spawn itself fails", async () => {
    const cwd = tmpRoot("cap-failed-spawn");
    const failing = recordingWorker();
    failing.spawn = () => ({ ok: false, reason: "pane refused" });
    const runtime = new FilesystemTaskCellRuntime({
      cwd,
      substrate: "tmux",
      parallelism: 8,
      binding: { binding_ref: bindingRefFor(cwd) },
      worker: failing,
      now: FIXED_NOW,
      idFactory: (kind) => `${kind}-${++idSeq}`,
    });
    const cell = await runtime.spawnCell({
      run_id: RUN_ID,
      cell_id: "cell-F1",
      goal_id: "goal-t08",
      phase_id: "build",
      step_id: "F1",
      team_id: "t08",
      logical_task_id: "F1",
      fanout: "lead_plus_one",
      lead: { lead_binding_id: "lead-binding-t08", team_lead_instance_id: null },
    });
    await expect(
      runtime.spawnInstance(cell, {
        task_run_id: "F1.tr1",
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
        context_bundle_id: `.guild/context/${RUN_ID}/backend-F1.md`,
        context_bundle_hash: "sha256:ctx",
        projection: { tools: ["Read"], permissions: [], recorded_losses: [] },
        budgets: { tokens: null, wall_clock_ms: null, cost_usd: null },
      }),
    ).rejects.toThrow(/pane refused/);
    // The failed spawn sealed a terminal attempt, so the slot is not occupancy.
    expect(countLiveRunInstances({ cwd, run_id: RUN_ID })).toBe(0);
    expect(countOpenReservations({ cwd, run_id: RUN_ID })).toBe(0);
  });

  it("refuses a whole launcher BATCH before the first record is written", () => {
    const cwd = tmpRoot("cap-batch");
    writeSessionBinding(cwd, RUN_ID);
    const bindingRef = bindingRefFor(cwd);
    const lanes = ["L1", "L2", "L3", "L4", "L5"].map((id) => lane(id));
    expect(() =>
      emitTaskCellsV2(cwd, RUN_ID, "plr", lanes, "build", "tmux", bindingRef, false),
    ).toThrow(/not_authorized.*max_instances=4/s);
    // All-or-nothing: the four claims the batch took before the fifth refused are
    // rolled back, so the run holds nothing. (Empty attempt DIRECTORIES may
    // remain; what must not remain is a claimed slot or a written record.)
    expect(countLiveRunInstances({ cwd, run_id: RUN_ID })).toBe(0);
    expect(countOpenReservations({ cwd, run_id: RUN_ID })).toBe(0);
  });

  it("admits exactly one of two interleaved emitTaskCellsV2 calls at three live (r3)", () => {
    const cwd = tmpRoot("cap-launcher-race");
    writeSessionBinding(cwd, RUN_ID);
    const bindingRef = bindingRefFor(cwd);
    writeLaneContexts(cwd, ["A1", "B1"]);
    for (const id of ["R1", "R2", "R3"]) writeLiveAttempt(cwd, id);
    expect(countLiveRunInstances({ cwd, run_id: RUN_ID })).toBe(3);

    // Two launcher passes over ONE run, one slot left. Round 3's hole: this
    // production path called the observe-only admission, so both passes saw room
    // and the run went to five. Both go through the same claim now.
    const emit = (task: string) =>
      emitTaskCellsV2(cwd, RUN_ID, "plr", [lane(task)], "build", "tmux", bindingRef, false);
    const outcomes = [() => emit("A1"), () => emit("B1")].map((run) => {
      try {
        return { ok: true as const, written: run() };
      } catch (error) {
        return { ok: false as const, message: (error as Error).message };
      }
    });

    expect(outcomes.filter((o) => o.ok)).toHaveLength(1);
    const refused = outcomes.find((o) => !o.ok) as { ok: false; message: string };
    expect(refused.message).toMatch(/not_authorized.*max_instances=4/s);

    // Four live, never five — and the refused pass left no claim behind.
    expect(countLiveRunInstances({ cwd, run_id: RUN_ID })).toBe(4);
    expect(countOpenReservations({ cwd, run_id: RUN_ID })).toBe(0);
  });

  it("admits a batch that fits", () => {
    const cwd = tmpRoot("cap-batch-ok");
    writeSessionBinding(cwd, RUN_ID);
    writeLaneContexts(cwd, ["L1", "L2"]);
    const bindingRef = bindingRefFor(cwd);
    const written = emitTaskCellsV2(
      cwd,
      RUN_ID,
      "plr",
      ["L1", "L2"].map((id) => lane(id)),
      "build",
      "tmux",
      bindingRef,
      false,
    );
    expect(written).toBe(2);
    // The two lanes are now live, so a third claim is refused.
    expect(
      reserveInstance({ cwd, run_id: RUN_ID, logical_task_id: "L9", attempt: 1 }).ok,
    ).toBe(true);
    expect(
      reserveInstance({ cwd, run_id: RUN_ID, logical_task_id: "L10", attempt: 1 }).ok,
    ).toBe(true);
    expect(
      reserveInstance({ cwd, run_id: RUN_ID, logical_task_id: "L11", attempt: 1 }).ok,
    ).toBe(false);
  });
});

/** A minimal launch lane — the shape `emitTaskCellsV2` consumes. */
function lane(taskId: string): TaskCellLaunchLane {
  return {
    // Deliberately NOT one of the 15 shipped template ids: this fixture exercises
    // the binding block and the cap, not the compatibility-asset read, and a
    // shipped-template lane would additionally demand an installed plugin manifest.
    name: "plr-lane",
    scope: `implement ${taskId}`,
    dependsOn: [],
    taskId,
    dispatch_key: `plr-lane-${taskId}`,
    task_cell_instance_id: `${taskId}.a1.i1`,
    task_cell_assignment_path: "",
    tier: "mid",
  } as TaskCellLaunchLane;
}

// ── W5 ───────────────────────────────────────────────────────────────────────

describe("W5 a missing session binding BLOCKS the launcher", () => {
  it("refuses to emit cells when the run carries no binding (no host fallback)", () => {
    const cwd = tmpRoot("no-binding");
    const bindingRef = bindingRefFor(cwd);
    expect(() =>
      emitTaskCellsV2(cwd, RUN_ID, "plr", [lane("L1")], "build", "tmux", bindingRef, false),
    ).toThrow(/binding_blocked.*no guild.session_binding.v1/s);
    expect(fs.existsSync(path.join(cwd, ".guild", "runs", RUN_ID, "task-cells"))).toBe(false);
  });

  it("refuses an unknown host rather than resolving it to Claude", () => {
    const cwd = tmpRoot("unknown-host");
    writeSessionBinding(cwd, RUN_ID, {
      host_family: "unknown",
      model_family: "unknown",
      models: {},
    });
    const bindingRef = bindingRefFor(cwd);
    expect(() =>
      emitTaskCellsV2(cwd, RUN_ID, "plr", [lane("L1")], "build", "tmux", bindingRef, false),
    ).toThrow(/binding_blocked.*never resolves to Claude/s);
  });

  it("copies the bound host and tier model onto the emitted assignment", () => {
    const cwd = tmpRoot("binding-copy");
    writeSessionBinding(cwd, RUN_ID, {
      host_family: "codex-cli",
      model_family: "gpt",
      models: { cheap: "gpt-mini", mid: "gpt-mid", powerful: "gpt-max" },
    });
    writeLaneContexts(cwd, ["L1"]);
    const bindingRef = bindingRefFor(cwd);
    expect(
      emitTaskCellsV2(cwd, RUN_ID, "plr", [lane("L1")], "build", "tmux", bindingRef, false),
    ).toBe(1);
    const paths = taskCellPaths({
      run_id: RUN_ID,
      logical_task_id: "L1",
      attempt: 1,
      instance_id: "L1.a1.i1",
    });
    const assignment = JSON.parse(
      fs.readFileSync(path.join(cwd, paths.assignment_path), "utf8"),
    ) as TaskAssignmentV2;
    expect(assignment.host_id).toBe("codex-cli");
    const instance = JSON.parse(fs.readFileSync(path.join(cwd, paths.instance_path), "utf8")) as {
      model_id: string;
    };
    expect(instance.model_id).toBe("gpt-mid");
  });
});

// ── W6 ───────────────────────────────────────────────────────────────────────

describe("W6 acceptance binds the ledger to the assignment's own done_when", () => {
  const oracles = [{ id: "unit", oracle: "named_check" as const, target: "npm test" }];

  it("refuses an oracle-less assignment even when a passing ledger exists on disk", () => {
    const cwd = tmpRoot("foreign-ledger");
    const bare = buildTaskCell(dispatchInput({ logicalTaskId: "T1-backend" })).assignment;
    // A ledger for the SAME logical task, fully passing — written by a different
    // assignment. Round 1 released the bare assignment on this evidence.
    const init = initProgressLedger({
      cwd,
      run_id: RUN_ID,
      logical_task_id: "T1-backend",
      cell_id: "cell-T1-backend",
      assignment_id: "some-other-assignment",
      done_when: oracles,
      now: FIXED_NOW,
    });
    expect(init.ok).toBe(true);
    recordOracleOutcome({
      cwd,
      run_id: RUN_ID,
      logical_task_id: "T1-backend",
      item_id: "unit",
      state: "pass",
    });
    const ledger = readProgressLedger({ cwd, run_id: RUN_ID, logical_task_id: "T1-backend" });

    const verdict = refusal(ledgerBoundToAssignment(ledger, bare));
    expect(verdict.reason).toMatch(/assignment declared no oracles/);
  });

  it("refuses a ledger written for a different assignment id", () => {
    const cwd = tmpRoot("wrong-assignment-id");
    const mine = buildTaskCell(
      dispatchInput({ logicalTaskId: "T1-backend", doneWhen: oracles }),
    ).assignment;
    initProgressLedger({
      cwd,
      run_id: RUN_ID,
      logical_task_id: "T1-backend",
      cell_id: "cell-T1-backend",
      assignment_id: "T1-backend.tr0:1:someone-else",
      done_when: oracles,
      now: FIXED_NOW,
    });
    recordOracleOutcome({
      cwd,
      run_id: RUN_ID,
      logical_task_id: "T1-backend",
      item_id: "unit",
      state: "pass",
    });
    const ledger = readProgressLedger({ cwd, run_id: RUN_ID, logical_task_id: "T1-backend" });
    expect(refusal(ledgerBoundToAssignment(ledger, mine)).reason).toMatch(
      /belongs to assignment .*, not /,
    );
  });

  it("refuses a ledger whose oracle ids are not this assignment's", () => {
    const cwd = tmpRoot("wrong-oracles");
    const mine = buildTaskCell(
      dispatchInput({ logicalTaskId: "T1-backend", doneWhen: oracles }),
    ).assignment;
    initProgressLedger({
      cwd,
      run_id: RUN_ID,
      logical_task_id: "T1-backend",
      cell_id: "cell-T1-backend",
      assignment_id: assignmentId(mine),
      done_when: [{ id: "something-else", oracle: "named_check", target: null }],
      now: FIXED_NOW,
    });
    const ledger = readProgressLedger({ cwd, run_id: RUN_ID, logical_task_id: "T1-backend" });
    expect(refusal(ledgerBoundToAssignment(ledger, mine)).reason).toMatch(
      /do not match this assignment's done_when/,
    );
  });

  it("REFUSES a ledger with no assignment_id (r2: binding is required, not opt-in)", () => {
    const cwd = tmpRoot("ledger-no-id");
    const mine = buildTaskCell(
      dispatchInput({ logicalTaskId: "T1-backend", doneWhen: oracles }),
    ).assignment;
    // Exactly the round-2 hole: an unbound ledger used to match any assignment.
    initProgressLedger({
      cwd,
      run_id: RUN_ID,
      logical_task_id: "T1-backend",
      cell_id: "cell-T1-backend",
      done_when: oracles,
      now: FIXED_NOW,
    });
    recordOracleOutcome({
      cwd,
      run_id: RUN_ID,
      logical_task_id: "T1-backend",
      item_id: "unit",
      state: "pass",
    });
    const ledger = readProgressLedger({ cwd, run_id: RUN_ID, logical_task_id: "T1-backend" });
    expect(ledger!.assignment_id).toBeUndefined();
    expect(refusal(ledgerBoundToAssignment(ledger, mine)).reason).toMatch(
      /carries no assignment_id/,
    );
  });

  it("REFUSES the same id + same oracle id when the oracle KIND differs (r2)", () => {
    const cwd = tmpRoot("ledger-wrong-kind");
    const mine = buildTaskCell(
      dispatchInput({
        logicalTaskId: "T1-backend",
        doneWhen: [{ id: "unit", oracle: "command", target: "npm test" }],
      }),
    ).assignment;
    // Same assignment id, same oracle id — but settled as verify.after_edit, a
    // different and weaker check than the `command` the assignment declared.
    initProgressLedger({
      cwd,
      run_id: RUN_ID,
      logical_task_id: "T1-backend",
      cell_id: "cell-T1-backend",
      assignment_id: assignmentId(mine),
      done_when: [{ id: "unit", oracle: "verify.after_edit", target: null }],
      now: FIXED_NOW,
    });
    const ledger = readProgressLedger({ cwd, run_id: RUN_ID, logical_task_id: "T1-backend" });
    expect(refusal(ledgerBoundToAssignment(ledger, mine)).reason).toMatch(
      /compared by id AND kind/,
    );
  });

  it("accepts the ledger that IS this assignment's", () => {
    const cwd = tmpRoot("right-ledger");
    const mine = buildTaskCell(
      dispatchInput({ logicalTaskId: "T1-backend", doneWhen: oracles }),
    ).assignment;
    initProgressLedger({
      cwd,
      run_id: RUN_ID,
      logical_task_id: "T1-backend",
      cell_id: "cell-T1-backend",
      assignment_id: assignmentId(mine),
      done_when: oracles,
      now: FIXED_NOW,
    });
    const ledger = readProgressLedger({ cwd, run_id: RUN_ID, logical_task_id: "T1-backend" });
    expect(ledgerBoundToAssignment(ledger, mine)).toEqual({ ok: true });
  });

  it("refuses acceptance of an oracle-less dispatch through the real runtime", async () => {
    const cwd = tmpRoot("accept-foreign");
    const { runtime, instance } = await spawnOne({ cwd, logicalTaskId: "T1-backend" });
    const bare = buildTaskCell(
      dispatchInput({
        instanceId: instance.instance_id,
        attemptId: instance.attempt_id,
        projection: { tools: ["Read"], permissions: [], recorded_losses: [] },
      }),
    ).assignment;
    expect((await runtime.deliverAssignment(instance, bare)).ok).toBe(true);

    // A fully-passing ledger for this logical task, written by ANOTHER dispatch.
    initProgressLedger({
      cwd,
      run_id: RUN_ID,
      logical_task_id: "T1-backend",
      cell_id: "cell-T1-backend",
      assignment_id: "a-different-attempt",
      done_when: oracles,
      now: FIXED_NOW,
    });
    recordOracleOutcome({
      cwd,
      run_id: RUN_ID,
      logical_task_id: "T1-backend",
      item_id: "unit",
      state: "pass",
    });
    expect(assignmentId(bare)).not.toBe("a-different-attempt");

    const req: AcceptHandoffRequest = {
      acceptance_policy_version: "1",
      authorities_required: ["deterministic_floor"],
      authorities_observed: [],
    };
    // Round 1 released here on the foreign ledger. The release must not happen.
    const accepted = await runtime.acceptHandoff(instance, req);
    expect(accepted.ok).toBe(false);
    const acceptancePath = path.join(
      cwd,
      taskCellPaths({
        run_id: RUN_ID,
        logical_task_id: "T1-backend",
        attempt: 1,
        instance_id: instance.instance_id,
      }).acceptance_path,
    );
    expect(fs.existsSync(acceptancePath)).toBe(false);
  });
});

// ── W7 ───────────────────────────────────────────────────────────────────────

describe("W7 the advisor budget survives re-init and blocks in production", () => {
  it("re-initialising an exhausted budget does NOT refund the rounds", () => {
    const cwd = tmpRoot("budget-reinit");
    const ids = { cwd, run_id: RUN_ID, logical_task_id: "T1-backend" };
    initAdvisorBudget({ ...ids, cell_id: "cell-T1-backend", rounds_allowed: 2, now: FIXED_NOW });
    consumeConsult({ ...ids, kind: "advisor", now: FIXED_NOW });
    consumeConsult({ ...ids, kind: "advisor", now: FIXED_NOW });
    expect(readAdvisorBudget(ids)!.rounds_used).toBe(2);

    // Round 1 reset the file here and handed the cell two free rounds back.
    const again = initAdvisorBudget({
      ...ids,
      cell_id: "cell-T1-backend",
      rounds_allowed: 2,
      now: FIXED_NOW,
    });
    expect(again.rounds_used).toBe(2);
    expect(refusal(consumeConsult({ ...ids, kind: "advisor", now: FIXED_NOW })).next_need).toBe(
      "budget",
    );
  });

  it("blocks the production in-cell consult with next_need: budget", async () => {
    const cwd = tmpRoot("budget-runtime");
    const { runtime, instance } = await spawnOne({ cwd, logicalTaskId: "T1-backend" });

    // The runtime initialises the cell's budget on first consult and enforces it.
    expect(runtime.advisorRounds).toBe(2);
    const first = runtime.consultAdvisor(instance);
    expect(first).toEqual(expect.objectContaining({ ok: true, decremented: true, remaining: 1 }));
    expect(runtime.consultAdvisor(instance)).toEqual(
      expect.objectContaining({ ok: true, remaining: 0 }),
    );

    const blocked = refusal(runtime.consultAdvisor(instance));
    expect(blocked.state).toBe("blocked");
    expect(blocked.next_need).toBe("budget");

    // D-PROBE is still free after exhaustion — safety machinery is never charged.
    expect(runtime.consultAdvisor(instance, "d-probe")).toEqual(
      expect.objectContaining({ ok: true, decremented: false }),
    );
  });
});

// ── W8 ───────────────────────────────────────────────────────────────────────

describe("W8 the orchestrator lint sees NESTED assignments", () => {
  const status = (over: Record<string, unknown> = {}) => ({
    schema_version: "guild.goal_status.v1",
    run_id: RUN_ID,
    goal_id: "goal-t08",
    phase_id: "build",
    cell_id: "cell-1",
    team_id: "t08",
    state: "running",
    progress: 0.5,
    worker_count: 1,
    handoff_ids: [],
    summary: "one lane running",
    ...over,
  });

  it("flags an assignment nested inside an otherwise-valid envelope", () => {
    const assignment = buildTaskCell(dispatchInput()).assignment;
    const smuggled = status({ detail: { inner: { payload: assignment } } });
    expect(findNestedForbiddenSchema(smuggled)).toBe("guild.task_assignment.v2");
    const codes = lintOrchestratorContext({ envelopes: [smuggled] }).map((f) => f.code);
    expect(codes).toContain("assignment_in_context");
  });

  it("flags an assignment nested inside an array", () => {
    const assignment = buildTaskCell(dispatchInput()).assignment;
    const codes = lintOrchestratorContext({
      envelopes: [status({ extras: [{ a: 1 }, [{ b: assignment }]] })],
    }).map((f) => f.code);
    expect(codes).toContain("assignment_in_context");
  });

  it("flags a nested receipt and a nested handoff envelope", () => {
    for (const schema of ["guild.handoff_receipt.v1", "guild.handoff.v2"]) {
      const codes = lintOrchestratorContext({
        envelopes: [status({ attached: { schema_version: schema, task_id: "T1" } })],
      }).map((f) => f.code);
      expect(codes).toContain("assignment_in_context");
    }
  });

  it("flags a path and a specialist name in a NESTED string leaf", () => {
    const codes = lintOrchestratorContext({
      envelopes: [status({ notes: { trail: ["touched src/modules/dispatch/index.ts"] } })],
      specialist_names: ["backend"],
    }).map((f) => f.code);
    expect(codes).toContain("path_in_envelope");

    const named = lintOrchestratorContext({
      envelopes: [status({ notes: { who: "backend finished" } })],
      specialist_names: ["backend"],
    }).map((f) => f.code);
    expect(named).toContain("specialist_name_in_envelope");
  });

  it("drops a contaminated envelope from the fold instead of holding its bytes", () => {
    const assignment = buildTaskCell(dispatchInput()).assignment;
    const ctx = foldOrchestratorContext([
      status({ cell_id: "clean-1" }),
      status({ cell_id: "dirty", smuggled: assignment }),
      status({ cell_id: "clean-2" }),
    ]);
    expect(ctx.recent.map((e) => e.cell_id)).toEqual(["clean-1", "clean-2"]);
    expect(JSON.stringify(ctx)).not.toContain("guild.task_assignment.v2");
  });

  it("catches an assignment nested at depth 20 (r2: no depth cap on the CHECK)", () => {
    const assignment = buildTaskCell(dispatchInput()).assignment;
    // Round 2's hole had a number on it: the walk stopped at 12, so burying the
    // leak one level deeper was enough to pass.
    let buried: unknown = assignment;
    for (let i = 0; i < 20; i += 1) buried = { level: i, inner: buried };
    expect(findNestedForbiddenSchema(buried)).toBe("guild.task_assignment.v2");

    const smuggled = status({ detail: buried });
    expect(lintOrchestratorContext({ envelopes: [smuggled] }).map((f) => f.code)).toContain(
      "assignment_in_context",
    );
    const ctx = foldOrchestratorContext([status({ cell_id: "clean" }), smuggled]);
    expect(ctx.recent.map((e) => e.cell_id)).toEqual(["clean"]);
    expect(JSON.stringify(ctx)).not.toContain("guild.task_assignment.v2");
  });

  it("sees a path buried at depth 30 in a string leaf", () => {
    let buried: unknown = "touched src/modules/dispatch/index.ts";
    for (let i = 0; i < 30; i += 1) buried = [{ i, inner: buried }];
    expect(
      lintOrchestratorContext({ envelopes: [status({ trail: buried })] }).map((f) => f.code),
    ).toContain("path_in_envelope");
  });

  it("does not hang on a self-referential envelope", () => {
    const cyclic: Record<string, unknown> = status();
    cyclic["self"] = cyclic;
    expect(() => lintOrchestratorContext({ envelopes: [cyclic] })).not.toThrow();
  });
});

// ── W9 ───────────────────────────────────────────────────────────────────────

describe("W9 an empty minted slice returns nothing, never templates", () => {
  it("refuses with next_need: mint when the phase roster holds no minted profile", () => {
    const res = refusal(
      sliceRosterForGoal({
        scope: "goal",
        phase_roster: [
          { name: "security", source: "template" },
          { name: "advisor", source: "shipped" },
        ],
      }),
    );
    expect(res.roster).toEqual([]);
    expect(res.next_need).toBe("mint");
    expect(res.reason).toMatch(/never templates/);
  });

  it("refuses with next_need: mint when every NAMED role is unminted", () => {
    const res = refusal(
      sliceRosterForGoal({
        scope: "goal",
        phase_roster: [{ name: "security", source: "template" }],
        goal: { roster_role_ids: ["security"] },
      }),
    );
    expect(res.roster).toEqual([]);
    expect(res.next_need).toBe("mint");
    expect(res.unminted).toEqual(["security (template)"]);
  });

  it("returns only the minted members when no roles are named", () => {
    const res = sliceRosterForGoal({
      scope: "goal",
      phase_roster: [
        { name: "backend", source: "project" },
        { name: "security", source: "template" },
      ],
    });
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error("unreachable");
    expect(res.roster.map((r) => r.name)).toEqual(["backend"]);
  });

  it("still returns the full phase roster under the default phase scope", () => {
    const res = sliceRosterForGoal({
      scope: "phase",
      phase_roster: [
        { name: "backend", source: "project" },
        { name: "security", source: "template" },
      ],
    });
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error("unreachable");
    expect(res.roster).toHaveLength(2);
  });
});
