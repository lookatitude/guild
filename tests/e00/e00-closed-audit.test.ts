/**
 * E00-T0 · EAT08 / CD13 / CD26 — closed audit joins over the EXISTING
 * auditTaskCellArtifactJoin, plus the declared verifyPrereleaseBusJoins helper.
 *
 * Expected red today: the closed audit does not check team_result lane role or
 * handoff_ref / acceptance_ref equality (CD13 extension), and
 * verifyPrereleaseBusJoins does not exist. Positive controls pin what must keep
 * passing: a complete lifecycle audits closed; identity-set mismatch and
 * unresolved dependency joins already fail.
 */
import { describe, it, expect, afterEach } from "bun:test";
import * as fs from "fs";
import * as path from "path";

import { auditTaskCellArtifactJoin, readBusLog, taskCellPaths } from "../../src/domains/dispatch";
import { composeStationTeam, writeTeamPlan, writeTeamResult } from "../../src/domains/teams";
import {
  FIXED_NOW, acceptLane, driveLane, makeRuntime, requireExport, sha256, teardownOwned, tempRoot, type TempRoot,
} from "./support/e00-harness";

afterEach(teardownOwned);

const TASK_CELL_KINDS_AT_BASE = [
  "assignment", "ack", "context", "handoff", "validation", "acceptance", "terminal",
];

async function closedRun(lanes: Array<{ id: string; role: string }>) {
  const root = tempRoot("guild-e00-audit-");
  const rt = makeRuntime(root);
  const done: Array<Awaited<ReturnType<typeof driveLane>>> = [];
  for (const lane of lanes) {
    const d = await driveLane(root, rt, { logicalTaskId: lane.id, role: lane.role });
    expect((await acceptLane(rt, d.instance)).ok).toBe(true);
    expect((await rt.runtime.terminate(d.instance)).ok).toBe(true);
    done.push(d);
  }
  const planAbs = writeTeamPlan(root.cwd, root.runId, composeStationTeam("build", {}, { tierIndex: {} }), { now: () => FIXED_NOW });
  return { root, rt, done, planRel: path.relative(root.cwd, planAbs) };
}

function canonicalRefs(root: TempRoot, d: { instance: { instance_id: string }; assignment: { logical_task_id: string } }) {
  const p = taskCellPaths({ run_id: root.runId, logical_task_id: d.assignment.logical_task_id, attempt: 1, instance_id: d.instance.instance_id });
  return { handoff_ref: p.handoff_path, acceptance_ref: p.acceptance_path };
}

function writeResult(root: TempRoot, planRel: string, lanes: unknown[]) {
  writeTeamResult(root.cwd, root.runId, {
    schema_version: "guild.team_result.v1", station: "build", team_plan_ref: planRel, lanes,
  } as never, { now: () => FIXED_NOW });
}

describe("EAT08 closed audit — positive controls (must stay green)", () => {
  it("a complete lifecycle with canonical team_result refs audits closed", async () => {
    const { root, done, planRel } = await closedRun([{ id: "T1", role: "backend" }]);
    writeResult(root, planRel, done.map((d) => ({ role: d.assignment.worker_role, instance_id: d.instance.instance_id, ...canonicalRefs(root, d) })));
    const audit = auditTaskCellArtifactJoin({ cwd: root.cwd, runId: root.runId, requireClosed: true });
    expect({ ok: audit.ok, missing: audit.missing, invalid: audit.invalid }).toEqual({ ok: true, missing: [], invalid: [] });
  });

  it("duplicated roles stay distinct by logical task id", async () => {
    const { root, done, planRel } = await closedRun([{ id: "T1", role: "backend" }, { id: "T2", role: "backend" }]);
    writeResult(root, planRel, done.map((d) => ({ role: "backend", instance_id: d.instance.instance_id, ...canonicalRefs(root, d) })));
    const audit = auditTaskCellArtifactJoin({ cwd: root.cwd, runId: root.runId, requireClosed: true });
    expect(audit.ok).toBe(true);
    expect(new Set(done.map((d) => d.instance.instance_id)).size).toBe(2);
  });

  it("team_result with a wrong, missing, or extra lane fails the identity set", async () => {
    const { root, done, planRel } = await closedRun([{ id: "T1", role: "backend" }]);
    writeResult(root, planRel, [
      { role: "backend", instance_id: `${done[0].instance.instance_id}-other`, handoff_ref: null, acceptance_ref: null },
    ]);
    const audit = auditTaskCellArtifactJoin({ cwd: root.cwd, runId: root.runId, requireClosed: true });
    expect(audit.ok).toBe(false);
    expect(audit.invalid).toContain("team_result/build assignment identity set mismatch");
  });

  it("missing team_result after the station settles fails the closed audit", async () => {
    const { root } = await closedRun([{ id: "T1", role: "backend" }]);
    const audit = auditTaskCellArtifactJoin({ cwd: root.cwd, runId: root.runId, requireClosed: true });
    expect(audit.ok).toBe(false);
    expect(audit.missing.some((m) => m.startsWith("team_result:"))).toBe(true);
  });

  it("an ack whose bus event is removed fails the closed audit (old closeout ack-bus gap)", async () => {
    const { root, done, planRel } = await closedRun([{ id: "T1", role: "backend" }]);
    writeResult(root, planRel, done.map((d) => ({ role: d.assignment.worker_role, instance_id: d.instance.instance_id, ...canonicalRefs(root, d) })));
    const log = path.join(root.cwd, ".guild", "runs", root.runId, "bus", "log.jsonl");
    const kept = fs.readFileSync(log, "utf8").split("\n").filter((l) => !(l.includes("assignment-ack.json") && l.includes("artifact.published")));
    fs.writeFileSync(log, kept.join("\n"));
    const audit = auditTaskCellArtifactJoin({ cwd: root.cwd, runId: root.runId, requireClosed: true });
    expect(audit.ok).toBe(false);
  });
});

describe("EAT08 / CD13 closed-audit extension — expected red until E00-C", () => {
  it("refuses a team_result lane whose role differs from the assignment worker_role", async () => {
    const { root, done, planRel } = await closedRun([{ id: "T1", role: "backend" }]);
    writeResult(root, planRel, [{ role: "frontend", instance_id: done[0].instance.instance_id, ...canonicalRefs(root, done[0]) }]);
    const audit = auditTaskCellArtifactJoin({ cwd: root.cwd, runId: root.runId, requireClosed: true });
    expect(audit.ok).toBe(false);
  });

  it("refuses a lane whose handoff_ref names another instance's file", async () => {
    const { root, done, planRel } = await closedRun([{ id: "T1", role: "backend" }, { id: "T2", role: "backend" }]);
    const [a, b] = done;
    writeResult(root, planRel, [
      { role: "backend", instance_id: a.instance.instance_id, handoff_ref: canonicalRefs(root, b).handoff_ref, acceptance_ref: canonicalRefs(root, a).acceptance_ref },
      { role: "backend", instance_id: b.instance.instance_id, ...canonicalRefs(root, b) },
    ]);
    expect(auditTaskCellArtifactJoin({ cwd: root.cwd, runId: root.runId, requireClosed: true }).ok).toBe(false);
  });

  it("refuses a lane whose acceptance_ref names another instance's file", async () => {
    const { root, done, planRel } = await closedRun([{ id: "T1", role: "backend" }, { id: "T2", role: "backend" }]);
    const [a, b] = done;
    writeResult(root, planRel, [
      { role: "backend", instance_id: a.instance.instance_id, handoff_ref: canonicalRefs(root, a).handoff_ref, acceptance_ref: canonicalRefs(root, b).acceptance_ref },
      { role: "backend", instance_id: b.instance.instance_id, ...canonicalRefs(root, b) },
    ]);
    expect(auditTaskCellArtifactJoin({ cwd: root.cwd, runId: root.runId, requireClosed: true }).ok).toBe(false);
  });

  it("refuses null refs when the canonical handoff and acceptance files exist", async () => {
    const { root, done, planRel } = await closedRun([{ id: "T1", role: "backend" }]);
    writeResult(root, planRel, [{ role: "backend", instance_id: done[0].instance.instance_id, handoff_ref: null, acceptance_ref: null }]);
    expect(auditTaskCellArtifactJoin({ cwd: root.cwd, runId: root.runId, requireClosed: true }).ok).toBe(false);
  });
});

describe("EAT08 / CD17 check 12 — verifyPrereleaseBusJoins (declared, expected red)", () => {
  it("is exported from the dispatch index while topic() stays private and the kind set is unchanged", async () => {
    const dispatch = (await import("../../src/domains/dispatch")) as Record<string, unknown>;
    expect(dispatch["topic"]).toBeUndefined();
    const src = fs.readFileSync(path.join(__dirname, "..", "..", "src", "domains", "dispatch", "task-cell-artifact-join.ts"), "utf8");
    const kinds = /export type TaskCellArtifactKind =([^;]+);/.exec(src)?.[1] ?? "";
    for (const k of TASK_CELL_KINDS_AT_BASE) expect(kinds).toContain(`"${k}"`);
    expect(kinds).not.toMatch(/ack_claim|origin|oracle/);
    expect(typeof (await requireExport("src/domains/dispatch/index.ts", "verifyPrereleaseBusJoins"))).toBe("function");
  });

  it("returns a join per canonical kind and prerelease_bus_join_missing once the acceptance bus event is removed", async () => {
    const verify = await requireExport<(cwd: string, ids: unknown, kinds: string[]) => Array<Record<string, unknown>>>(
      "src/domains/dispatch/index.ts", "verifyPrereleaseBusJoins");
    const { root, done } = await closedRun([{ id: "T1", role: "backend" }]);
    const ids = { run_id: root.runId, logical_task_id: "T1", attempt: 1, instance_id: done[0].instance.instance_id };
    const kinds = ["assignment", "ack", "handoff", "validation", "acceptance", "context"];
    const before = verify(root.cwd, ids, kinds);
    expect(before.map((r) => r["kind"]).sort()).toEqual([...kinds].sort());
    for (const r of before) {
      expect(r["reason"] ?? null).toBeNull();
      expect(r["cas_ok"]).toBe(true);
      const file = path.join(root.cwd, String(r["path"]));
      expect(r["sha256"]).toBe(sha256(fs.readFileSync(file)));
    }
    const log = path.join(root.cwd, ".guild", "runs", root.runId, "bus", "log.jsonl");
    const accPath = String(before.find((r) => r["kind"] === "acceptance")!["path"]);
    fs.writeFileSync(log, fs.readFileSync(log, "utf8").split("\n").filter((l) => !l.includes(accPath)).join("\n"));
    expect(readBusLog(path.join(root.cwd, ".guild", "runs", root.runId)).some((e) => e.path === accPath)).toBe(false);
    const after = verify(root.cwd, ids, ["acceptance"]);
    expect(after[0]["reason"]).toBe("prerelease_bus_join_missing");
  });
});
