/**
 * E00-T0 · EAT01-C / CD10 / CD21 / binding_matrix — run-binding authority on
 * the EXISTING write paths.
 *
 * Expected red today (concrete old-code defects, not import failures):
 *  - publishTaskCellFile without bindingRef falls back to reading binding.json
 *    (readRunBindingRef) and publishes;
 *  - acknowledgeAssignment, publishSubmittedHandoffPointer, markAttemptOrphaned
 *    and sealTerminalAttempt write with no caller-supplied binding.
 * Positive controls: the same calls with the fixture's own minted binding
 * succeed; closed / mismatched / malformed / unminted bindings refuse.
 * Secret checks compare digests and booleans; nonce bytes are never printed.
 */
import { describe, it, expect, afterEach } from "bun:test";
import * as fs from "fs";
import * as path from "path";

import {
  acknowledgeAssignment, markAttemptOrphaned, publishSubmittedHandoffPointer,
  publishTaskCellFile, readBusLog, sealTerminalAttempt, taskCellPaths,
} from "../../src/domains/dispatch";
import { closeRunBinding } from "../../src/domains/lifecycle";
import { composeStationTeam, writeTeamPlan, writeTeamResult } from "../../src/domains/teams";
import {
  FIXED_NOW, PLUGIN, acceptLane, bindingPathOf, driveLane, filesContainingNonce, makeRuntime,
  isTypedBindingRejection, isTypedBindingResult, receiptBytes, teardownOwned, tempRoot, type TempRoot,
} from "./support/e00-harness";

afterEach(teardownOwned);

function assignmentAckPath(ids: { run_id: string; logical_task_id: string; attempt: number; instance_id: string }): string {
  return path.join(taskCellPaths(ids).instance_dir, "assignment-ack.json");
}

function runDir(root: TempRoot): string {
  return path.join(root.cwd, ".guild", "runs", root.runId);
}

function busCount(root: TempRoot): number {
  return readBusLog(runDir(root)).length;
}

/**
 * F6: a refusal is a TYPED binding refusal plus "no write and no bus event".
 * Typed means BindingRejectedError (reason in BindingRejectReason) or a returned
 * { ok:false, reason: <binding reason> }. Only publishTaskCellFile may signal by
 * its documented `null` (nullContract), and every such case sits beside a control
 * proving the same call with the verified binding publishes. Any other exception
 * is rethrown so the test fails instead of passing as a refusal.
 */
function refusedWithoutWrite(
  run: () => unknown,
  watched: string[],
  root: TempRoot,
  opts: { nullContract?: boolean } = {},
): { refused: boolean; detail: string } {
  const before = watched.map((f) => (fs.existsSync(f) ? fs.readFileSync(f).toString("base64") : null));
  const events = busCount(root);
  let result: unknown;
  let threw: unknown = null;
  try {
    result = run();
  } catch (error) {
    threw = error;
  }
  if (threw !== null && !isTypedBindingRejection(threw)) {
    throw new Error(`unrelated exception, not a binding refusal: ${String((threw as Error)?.message ?? threw)}`);
  }
  const after = watched.map((f) => (fs.existsSync(f) ? fs.readFileSync(f).toString("base64") : null));
  const unchanged = JSON.stringify(before) === JSON.stringify(after) && busCount(root) === events;
  const typed = threw !== null || isTypedBindingResult(result) || (opts.nullContract === true && result === null);
  return { refused: unchanged && typed, detail: `unchanged=${unchanged} typed=${typed}` };
}

async function laneAt(stage: "delivered" | "validated") {
  const root = tempRoot("guild-e00-bind-");
  const rt = makeRuntime(root);
  const d = await driveLane(root, rt, { logicalTaskId: "T1", role: "backend", stopAfterDeliver: stage === "delivered" });
  const ids = { run_id: root.runId, logical_task_id: "T1", attempt: 1, instance_id: d.instance.instance_id };
  return { root, rt, d, ids, paths: taskCellPaths(ids) };
}

describe("EAT01-C binding refusals on publishTaskCellFile (closed binding is red today; the rest are controls)", () => {
  it("publishes with the fixture's explicit verified bindingRef", async () => {
    const { root, ids, paths } = await laneAt("delivered");
    const r = publishTaskCellFile({ cwd: root.cwd, ids, kind: "assignment", relativePath: paths.assignment_path, hostId: "claude-code-cli", role: "task-cell-controller", bindingRef: root.bindingRef, now: () => FIXED_NOW });
    expect(r).not.toBeNull();
  });

  for (const [label, mutate] of [
    ["closed", (root: TempRoot) => closeRunBinding({ root: root.cwd, run_id: root.runId })],
    ["malformed", (root: TempRoot) => fs.writeFileSync(bindingPathOf(root), '{"schema_version":"guild.run_binding.v1"}\n')],
    ["not minted", (root: TempRoot) => fs.rmSync(bindingPathOf(root))],
  ] as const) {
    it(`refuses with a ${label} binding`, async () => {
      const { root, ids, paths } = await laneAt("delivered");
      mutate(root);
      const r = refusedWithoutWrite(() => publishTaskCellFile({ cwd: root.cwd, ids, kind: "assignment", relativePath: paths.assignment_path, hostId: "claude-code-cli", role: "task-cell-controller", bindingRef: root.bindingRef, now: () => FIXED_NOW }), [], root, { nullContract: true });
      expect(r).toEqual({ refused: true, detail: expect.any(String) });
    });
  }

  it("refuses a mismatched bindingRef", async () => {
    const { root, ids, paths } = await laneAt("delivered");
    const r = refusedWithoutWrite(() => publishTaskCellFile({ cwd: root.cwd, ids, kind: "assignment", relativePath: paths.assignment_path, hostId: "claude-code-cli", role: "task-cell-controller", bindingRef: "rb-not-this-run", now: () => FIXED_NOW }), [], root, { nullContract: true });
    expect(r.refused).toBe(true);
  });
});

describe("binding_matrix — no helper reads binding.json (expected red)", () => {
  it("publishTaskCellFile without bindingRef refuses even when binding.json is readable", async () => {
    const { root, ids, paths } = await laneAt("delivered");
    const r = refusedWithoutWrite(() => publishTaskCellFile({ cwd: root.cwd, ids, kind: "assignment", relativePath: paths.assignment_path, hostId: "claude-code-cli", role: "task-cell-controller", now: () => FIXED_NOW }), [], root, { nullContract: true });
    expect(r.refused).toBe(true);
  });

  it("the readRunBindingRef fallback is deleted from task-cell-artifact-join.ts", () => {
    const src = fs.readFileSync(path.join(PLUGIN, "src/domains/dispatch/task-cell-artifact-join.ts"), "utf8");
    expect(src.includes("readRunBindingRef")).toBe(false);
    expect(src.includes('"binding.json"')).toBe(false);
  });

  it("acknowledgeAssignment without a binding argument refuses and writes no ack", async () => {
    const { root, ids, paths } = await laneAt("delivered");
    const assignment = JSON.parse(fs.readFileSync(path.join(root.cwd, paths.assignment_path), "utf8"));
    const ack = path.join(root.cwd, assignmentAckPath(ids));
    const r = refusedWithoutWrite(() => acknowledgeAssignment(root.cwd, assignment, () => FIXED_NOW), [ack, path.join(root.cwd, paths.instance_path)], root);
    expect(r.refused).toBe(true);
    expect(fs.existsSync(ack)).toBe(false);
  });

  it("acknowledgeAssignment with the verified binding writes the ack (positive control)", async () => {
    const { root, ids, paths } = await laneAt("delivered");
    const assignment = JSON.parse(fs.readFileSync(path.join(root.cwd, paths.assignment_path), "utf8"));
    (acknowledgeAssignment as (...a: unknown[]) => unknown)(root.cwd, assignment, () => FIXED_NOW, { binding_ref: root.bindingRef });
    expect(fs.existsSync(path.join(root.cwd, assignmentAckPath(ids)))).toBe(true);
  });

  it("publishSubmittedHandoffPointer without a binding refuses and writes no pointer", async () => {
    const { root, d, paths } = await laneAt("delivered");
    fs.mkdirSync(path.join(runDir(root), "handoffs"), { recursive: true });
    fs.writeFileSync(path.join(runDir(root), "handoffs", "backend-T1.md"), receiptBytes(root.runId, d.assignment));
    const pointer = path.join(root.cwd, paths.handoff_path);
    const r = refusedWithoutWrite(() => publishSubmittedHandoffPointer({ cwd: root.cwd, assignment: d.assignment, submittedAt: FIXED_NOW }), [pointer], root);
    expect(r.refused).toBe(true);
    expect(fs.existsSync(pointer)).toBe(false);
  });

  it("markAttemptOrphaned without a binding refuses and leaves the attempt unchanged", async () => {
    const { root, ids, paths } = await laneAt("validated");
    const r = refusedWithoutWrite(() => markAttemptOrphaned(root.cwd, ids), [path.join(root.cwd, paths.attempt_path)], root);
    expect(r.refused).toBe(true);
  });

  it("sealTerminalAttempt without a binding refuses and writes no terminal record", async () => {
    const { root, ids, paths } = await laneAt("validated");
    const r = refusedWithoutWrite(
      () => sealTerminalAttempt({ cwd: root.cwd, ids, terminal_state: "failed", reason: "controller_lost", orphaned: true, now: () => FIXED_NOW }),
      [path.join(root.cwd, paths.attempt_path), path.join(root.cwd, paths.instance_dir, "terminal.json")], root);
    expect(r.refused).toBe(true);
  });

  it("markAttemptOrphaned with the verified binding marks the attempt (positive control)", async () => {
    const { root, ids } = await laneAt("validated");
    const out = (markAttemptOrphaned as (...a: unknown[]) => { orphaned: boolean })(root.cwd, ids, { binding_ref: root.bindingRef });
    expect(out.orphaned).toBe(true);
  });
});

describe("EAT01-C credential carrier", () => {
  it("binding.json is written 0600 by the canonical mint", () => {
    const root = tempRoot("guild-e00-mode-");
    expect((fs.statSync(bindingPathOf(root)).mode & 0o777).toString(8)).toBe("600");
  });

  it("no system-produced sink of a complete lifecycle carries nonce bytes", async () => {
    const root = tempRoot("guild-e00-nonce-");
    const rt = makeRuntime(root);
    const d = await driveLane(root, rt, { logicalTaskId: "T1", role: "backend" });
    expect((await acceptLane(rt, d.instance)).ok).toBe(true);
    expect((await rt.runtime.terminate(d.instance)).ok).toBe(true);
    const planAbs = writeTeamPlan(root.cwd, root.runId, composeStationTeam("build", {}, { tierIndex: {} }), { now: () => FIXED_NOW });
    writeTeamResult(root.cwd, root.runId, { schema_version: "guild.team_result.v1", station: "build", team_plan_ref: path.relative(root.cwd, planAbs), lanes: [{ role: "backend", instance_id: d.instance.instance_id, handoff_ref: null, acceptance_ref: null }] } as never, { now: () => FIXED_NOW });
    const hits = filesContainingNonce(root);
    expect({ count: hits.length, files: hits }).toEqual({ count: 0, files: [] });
  });
});
