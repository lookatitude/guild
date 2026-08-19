/**
 * scripts/__tests__/task-assignment-v2.test.ts
 *
 * G3 — the `guild.task_assignment.v2` PRODUCTION channel (task-cell-runtime).
 * Proves the two adversarial cases the migration is responsible for at the
 * write/read boundary the launcher uses:
 *
 *   AT1  one specialist owning TWO ready tasks → two distinct instances,
 *        two assignments, two fresh contexts, two handoff paths, NO overwrite.
 *   AT3  a malformed/missing assignment is a HARD dispatch failure — the writer
 *        throws, the reader returns null; a lane never proceeds on garbage.
 *
 * Plus the D5 ack primitive + the attempt companion + the reader roundtrip.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import {
  acknowledgeAssignment,
  assignmentAckPath,
  buildTaskCell,
  readAgentInstanceV1,
  readAssignmentAck,
  readTaskAssignmentV2,
  writeTaskAssignmentV2,
  writeTaskAttemptV1,
  writeTaskCell,
  type TaskCellDispatchInput,
} from "../../src/modules/dispatch/workflows/task-assignment-v2";
import {
  assignmentId,
  taskCellPaths,
  validateAgentInstanceV1,
  validateTaskAssignmentV2,
  validateTaskAttemptV1,
} from "../lib/core/contracts/task-cell-backend";

import {
  BindingRejectedError,
  closeRunBinding,
  loadRunBinding,
  mintRunBinding,
  runBindingPath,
} from "../../src/modules/lifecycle/workflows/run-binding";

/** T3 F3: mint-or-load the run's binding under this test root (writers verify it). */
function bindFor(cwd: string, runId: string): { binding_ref: string } {
  const existing = loadRunBinding({ root: cwd, run_id: runId });
  return { binding_ref: (existing ?? mintRunBinding({ root: cwd, run_id: runId })).binding_ref };
}

const FIXED_NOW = () => "2026-07-15T00:00:00.000Z";

function tmpCwd(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "guild-task-assignment-v2-"));
}

/** A valid single-task dispatch descriptor; `over` tweaks the identity per task. */
function dispatch(over: Partial<TaskCellDispatchInput> = {}): TaskCellDispatchInput {
  const logicalTaskId = over.logicalTaskId ?? "T1-backend";
  return {
    runId: "run-g3",
    logicalTaskId,
    taskRunId: `${logicalTaskId}.tr1`,
    attempt: 1,
    attemptId: `${logicalTaskId}.att1`,
    instanceId: `${logicalTaskId}.a1.i1`,
    cellId: `cell-${logicalTaskId}`,
    goalId: "goal-demo",
    phaseId: "build",
    stepId: logicalTaskId,
    teamId: "demo",
    workerRole: "backend",
    specialistTypeId: "backend",
    specialistTypeVersion: "1",
    specialistTypeHash: "sha256:type-backend",
    specialistProfileId: "backend",
    specialistProfileHash: "sha256:profile-backend",
    contextBundleId: `.guild/context/run-g3/backend-${logicalTaskId}.md`,
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
    projection: { tools: ["read", "write"], permissions: [], recorded_losses: [] },
    autonomyPolicy: "supervised",
    budgets: { tokens: null, wall_clock_ms: null, cost_usd: null },
    deadline: null,
    leadBindingId: "lead-binding-demo",
    now: FIXED_NOW,
    ...over,
    substrate: over.substrate ?? "tmux",
    modelTier: over.modelTier ?? "mid",
  };
}

describe("buildTaskCell", () => {
  it("builds a self-contained, canonical, validate-clean assignment + attempt", () => {
    const { assignment, attempt, instance } = buildTaskCell(dispatch());
    expect(validateTaskAssignmentV2(assignment)).not.toBeNull();
    expect(validateTaskAttemptV1(attempt)).not.toBeNull();
    expect(validateAgentInstanceV1(instance)).not.toBeNull();
    expect(instance.instance_id).toBe(assignment.instance_id);
    expect(instance.specialist_profile_hash).toBe(assignment.specialist_profile_hash);
    // Channels are derived onto the canonical run-tree, keyed on the instance.
    const paths = taskCellPaths({
      run_id: "run-g3",
      logical_task_id: "T1-backend",
      attempt: 1,
      instance_id: "T1-backend.a1.i1",
    });
    expect(assignment.assignment_path).toBe(paths.assignment_path);
    expect(assignment.handoff_path).toBe(paths.handoff_path);
    // Lead is a binding (reused parent orchestrator), never a distinct lead instance.
    expect(assignment.lead_binding_id).toBe("lead-binding-demo");
    expect(assignment.team_lead_instance_id ?? null).toBeNull();
  });

  it("throws on a would-be-malformed assignment (empty objective) — fail-closed (D6)", () => {
    expect(() => buildTaskCell(dispatch({ objective: "" }))).toThrow(/malformed|fail-closed/i);
  });

  it("enforces D4 lineage — a non-first attempt needs previous_attempt_id + retry_reason", () => {
    expect(() => buildTaskCell(dispatch({ attempt: 2 }))).toThrow(/previous_attempt_id|retry_reason/i);
    const retry = buildTaskCell(
      dispatch({ attempt: 2, previousAttemptId: "T1-backend.att1", retryReason: "tests failed" })
    );
    expect(retry.attempt.previous_attempt_id).toBe("T1-backend.att1");
    expect(retry.attempt.retry_reason).toBe("tests failed");
  });
});

describe("AT1 — one specialist owning two ready tasks (no overwrite)", () => {
  it("writes two distinct assignments + attempts + contexts, none overwritten", () => {
    const cwd = tmpCwd();
    // SAME specialist (worker_role backend, same type/profile hash) → TWO logical tasks.
    const cellA = buildTaskCell(dispatch({ logicalTaskId: "T1-backend" }));
    const cellB = buildTaskCell(dispatch({ logicalTaskId: "T2-backend" }));

    const a = writeTaskCell(cwd, cellA, bindFor(cwd, "run-g3"));
    const b = writeTaskCell(cwd, cellB, bindFor(cwd, "run-g3"));

    // Two files, two distinct canonical paths — the v1 per-specialist collapse is gone.
    expect(a.assignmentPath).not.toBe(b.assignmentPath);
    expect(fs.existsSync(a.assignmentPath)).toBe(true);
    expect(fs.existsSync(b.assignmentPath)).toBe(true);
    expect(a.attemptPath).not.toBe(b.attemptPath);
    expect(a.instancePath).not.toBe(b.instancePath);
    expect(readAgentInstanceV1(cwd, cellA.assignment)).toEqual(cellA.instance);

    // Distinct instance identity + assignment id.
    expect(cellA.assignment.instance_id).not.toBe(cellB.assignment.instance_id);
    expect(assignmentId(cellA.assignment)).not.toBe(assignmentId(cellB.assignment));

    // Fresh, per-task context — never shared across the specialist's two tasks (D3).
    expect(cellA.assignment.context_bundle_id).not.toBe(cellB.assignment.context_bundle_id);
    expect(cellA.assignment.context_bundle_hash).not.toBe(cellB.assignment.context_bundle_hash);

    // Distinct handoff paths so two receipts never collide.
    expect(cellA.assignment.handoff_path).not.toBe(cellB.assignment.handoff_path);

    // The SPECIALIST is shared — that is the whole point of the type/profile layers.
    expect(cellA.assignment.worker_role).toBe(cellB.assignment.worker_role);
    expect(cellA.assignment.specialist_profile_hash).toBe(cellB.assignment.specialist_profile_hash);
  });

  it("refuses to overwrite an already-written immutable assignment (D6)", () => {
    const cwd = tmpCwd();
    const cell = buildTaskCell(dispatch());
    writeTaskCell(cwd, cell, bindFor(cwd, "run-g3"));
    // A second write to the same (task_run_id, attempt, instance_id) is the v1
    // overwrite class — it THROWS, it never clobbers.
    expect(() => writeTaskAssignmentV2(cwd, cell.assignment, bindFor(cwd, "run-g3"))).toThrow(/overwrite refused|immutable/i);
  });

  it("keeps the attempt companion idempotent but refuses a divergent rewrite", () => {
    const cwd = tmpCwd();
    const cell = buildTaskCell(dispatch());
    const p1 = writeTaskAttemptV1(cwd, cell.attempt, bindFor(cwd, "run-g3"));
    // Re-writing the identical record is a no-op (idempotent).
    expect(writeTaskAttemptV1(cwd, cell.attempt, bindFor(cwd, "run-g3"))).toBe(p1);
    // A DIFFERENT record at the same attempt path is refused (terminal-immutability, D4).
    expect(() =>
      writeTaskAttemptV1(cwd, { ...cell.attempt, orphaned: true }, bindFor(cwd, "run-g3"))
    ).toThrow(/overwrite refused|immutable/i);
  });
});

describe("AT3 — a malformed/missing assignment is a hard dispatch failure", () => {
  it("throws when the writer is handed a malformed assignment", () => {
    const cwd = tmpCwd();
    const { assignment } = buildTaskCell(dispatch());
    const malformed = { ...(assignment as object), objective: "" };
    expect(() => writeTaskAssignmentV2(cwd, malformed as never, bindFor(cwd, "run-g3"))).toThrow(/malformed|fail-closed/i);
    // Nothing was persisted.
    expect(fs.existsSync(path.resolve(cwd, assignment.assignment_path))).toBe(false);
  });

  it("returns null for a MISSING assignment (reader fail-closed) — the worker never starts", () => {
    const cwd = tmpCwd();
    const { assignment } = buildTaskCell(dispatch());
    expect(readTaskAssignmentV2(cwd, assignment.assignment_path)).toBeNull();
  });

  it("returns null for a malformed on-disk assignment (garbage / wrong schema)", () => {
    const cwd = tmpCwd();
    const { assignment } = buildTaskCell(dispatch());
    const abs = path.resolve(cwd, assignment.assignment_path);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, "{ not json");
    expect(readTaskAssignmentV2(cwd, assignment.assignment_path)).toBeNull();
    fs.writeFileSync(abs, JSON.stringify({ ...assignment, schema_version: "guild.task_assignment.v1" }));
    expect(readTaskAssignmentV2(cwd, assignment.assignment_path)).toBeNull();
  });
});

describe("reader roundtrip", () => {
  it("writes then reads back the exact validated assignment", () => {
    const cwd = tmpCwd();
    const cell = buildTaskCell(dispatch());
    writeTaskCell(cwd, cell, bindFor(cwd, "run-g3"));
    const back = readTaskAssignmentV2(cwd, cell.assignment.assignment_path);
    expect(back).toEqual(cell.assignment);
  });
});

describe("D5 ack primitive", () => {
  it("writes an ack marker beside the assignment that read-back returns", () => {
    const cwd = tmpCwd();
    const cell = buildTaskCell(dispatch());
    writeTaskCell(cwd, cell, bindFor(cwd, "run-g3"));

    const ids = {
      run_id: "run-g3",
      logical_task_id: "T1-backend",
      attempt: 1,
      instance_id: "T1-backend.a1.i1",
    };
    // No ack yet — running is not authorized.
    expect(readAssignmentAck(cwd, ids)).toBeNull();

    const ackPath = acknowledgeAssignment(cwd, cell.assignment, FIXED_NOW);
    expect(path.resolve(cwd, assignmentAckPath(ids))).toBe(ackPath);
    const ack = readAssignmentAck(cwd, ids);
    expect(ack).not.toBeNull();
    expect(ack!.assignment_id).toBe(assignmentId(cell.assignment));
    expect(ack!.instance_id).toBe("T1-backend.a1.i1");
    expect(ack!.acknowledged_at).toBe("2026-07-15T00:00:00.000Z");
  });

  it("refuses to acknowledge a malformed assignment (the ack gate needs a valid one — D5)", () => {
    const cwd = tmpCwd();
    const { assignment } = buildTaskCell(dispatch());
    const malformed = { ...(assignment as object), instance_id: "" };
    expect(() => acknowledgeAssignment(cwd, malformed as never, FIXED_NOW)).toThrow(/malformed|ack gate/i);
  });
});

// ── T3 rework F3 — reviewer probe regressions (session_context §5) ───────────
// The G-lane round-1 live probe built a valid guild.task_assignment.v1/v2 and
// the writers persisted it with NO run binding (ACCEPTED_FAIL_OPEN). These pin
// the fail-closed posture for every §5 failure class on the v2 channel.

describe("T3 F3 — v2 descriptor writers fail closed on the run binding", () => {
  const fsx = require("fs") as typeof import("fs");

  it("MISSING: no minted binding for the run → BindingRejectedError(binding_not_minted), nothing written", () => {
    const cwd = tmpCwd();
    const cell = buildTaskCell(dispatch());
    expect(() => writeTaskCell(cwd, cell, { binding_ref: "rb-unminted" }))
      .toThrow(BindingRejectedError);
    expect(fsx.existsSync(path.resolve(cwd, cell.assignment.assignment_path))).toBe(false);
    expect(fsx.existsSync(path.resolve(cwd, taskCellPaths({
      run_id: "run-g3", logical_task_id: "T1-backend", attempt: 1, instance_id: "T1-backend.a1.i1",
    }).attempt_path))).toBe(false);
  });

  it("ABSENT REF: an empty/undefined binding_ref is rejected (binding_absent)", () => {
    const cwd = tmpCwd();
    bindFor(cwd, "run-g3"); // binding exists — the CALLER still must present it
    const cell = buildTaskCell(dispatch());
    try {
      writeTaskCell(cwd, cell, { binding_ref: undefined as unknown as string });
      throw new Error("unreachable — writer must throw");
    } catch (e) {
      expect(e).toBeInstanceOf(BindingRejectedError);
      expect((e as InstanceType<typeof BindingRejectedError>).reason).toBe("binding_absent");
    }
    expect(fsx.existsSync(path.resolve(cwd, cell.assignment.assignment_path))).toBe(false);
  });

  it("MALFORMED: a corrupt persisted binding record (state outside the enum) rejects the write", () => {
    const cwd = tmpCwd();
    const ref = bindFor(cwd, "run-g3").binding_ref;
    // The reviewer's exact probe shape: a schema-invalid state value.
    fsx.writeFileSync(
      runBindingPath(cwd, "run-g3"),
      JSON.stringify({
        schema_version: "guild.run_binding.v1",
        run_id: "run-g3",
        binding_ref: ref,
        state: "corrupt-openish",
      }, null, 2) + "\n",
    );
    const cell = buildTaskCell(dispatch());
    try {
      writeTaskCell(cwd, cell, { binding_ref: ref });
      throw new Error("unreachable — writer must throw");
    } catch (e) {
      expect(e).toBeInstanceOf(BindingRejectedError);
      expect((e as InstanceType<typeof BindingRejectedError>).reason).toBe("binding_malformed");
    }
    expect(fsx.existsSync(path.resolve(cwd, cell.assignment.assignment_path))).toBe(false);
  });

  it("CLOSED: a revoked binding rejects the write (binding_closed)", () => {
    const cwd = tmpCwd();
    const bind = bindFor(cwd, "run-g3");
    closeRunBinding({ root: cwd, run_id: "run-g3" });
    const cell = buildTaskCell(dispatch());
    try {
      writeTaskCell(cwd, cell, bind);
      throw new Error("unreachable — writer must throw");
    } catch (e) {
      expect(e).toBeInstanceOf(BindingRejectedError);
      expect((e as InstanceType<typeof BindingRejectedError>).reason).toBe("binding_closed");
    }
  });

  it("MISMATCHED: another run's nonce rejects the write (binding_mismatch)", () => {
    const cwd = tmpCwd();
    bindFor(cwd, "run-g3");
    const other = bindFor(cwd, "run-other");
    const cell = buildTaskCell(dispatch());
    try {
      writeTaskCell(cwd, cell, other);
      throw new Error("unreachable — writer must throw");
    } catch (e) {
      expect(e).toBeInstanceOf(BindingRejectedError);
      expect((e as InstanceType<typeof BindingRejectedError>).reason).toBe("binding_mismatch");
    }
  });

  it("MOVED SENTINEL: repointing the workspace sentinel cannot redirect or authorize a descriptor write (SC-1)", () => {
    const cwd = tmpCwd();
    const bind = bindFor(cwd, "run-g3");
    // Another actor points BOTH sentinels at a different run mid-dispatch.
    fsx.mkdirSync(path.join(cwd, ".guild", "runs"), { recursive: true });
    fsx.writeFileSync(path.join(cwd, ".guild", "runs", "current-run-id"), "run-hijack\n");
    fsx.writeFileSync(path.join(cwd, ".guild", "current-run-id"), "run-hijack\n");
    // The bound write still lands under ITS OWN run tree — never the sentinel's.
    const cell = buildTaskCell(dispatch());
    const out = writeTaskCell(cwd, cell, bind);
    expect(out.assignmentPath).toContain(path.join(".guild", "runs", "run-g3"));
    expect(out.assignmentPath).not.toContain("run-hijack");
    // And the hijacked run id (no minted binding) cannot authorize anything.
    const hijacked = buildTaskCell(dispatch({ runId: "run-hijack", logicalTaskId: "T9-x" }));
    expect(() => writeTaskCell(cwd, hijacked, bind)).toThrow(BindingRejectedError);
  });
});
