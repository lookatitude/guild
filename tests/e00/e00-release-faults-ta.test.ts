/**
 * E00-T0 · F5 (round 1) · CD24 / CD25 at TA — deterministic write-then-publish
 * faults on the EXISTING runtime, injected only through file modes in this
 * test's own temp root (no production fault seam, no test mode):
 *   - bus/log.jsonl read-only while cas/ stays writable: casPut succeeds, the bus
 *     append fails (persisted record, pre-existing CAS, no bus event);
 *   - task-cell-telemetry/events.jsonl read-only: the event-id marker is created,
 *     the event line append fails (post-state with marker and no line).
 * Each fault has a green CONTROL proving the fault happened on today's code; the
 * red assertions target the declared CD24 primitives (absent today). TA is
 * mechanics-only: no qualification is claimed.
 *
 * Proposed test contract (handoff): classifyPersistedAcceptance(cwd, ids, intended),
 * classifyPersistedTerminal(cwd, ids, intendedSeal) -> { kind }; publishPersistedLifecycleRecord(cwd, ids,
 * kind, binding, now) -> { outcome }; runtime.reconcilePersisted*(instance) -> { ok } | { ok:false, failure }.
 */
import { describe, it, expect, afterEach } from "bun:test";
import * as fs from "fs";
import * as path from "path";

import { casGet, readBusLog, taskCellPaths, FilesystemTaskCellRuntime } from "../../src/domains/dispatch";
import { readTaskCellLifecycleEvents } from "../../src/domains/telemetry";
import {
  FIXED_NOW, acceptLane, driveLane, makeRuntime, requireExport, requireMethod, sha256, teardownOwned, tempRoot, type TempRoot,
} from "./support/e00-harness";

afterEach(teardownOwned);

const LATER = "2026-10-26T13:10:00.000Z";

function runDir(root: TempRoot): string {
  return path.join(root.cwd, ".guild", "runs", root.runId);
}

function busLog(root: TempRoot): string {
  return path.join(runDir(root), "bus", "log.jsonl");
}

function eventsFile(root: TempRoot): string {
  return path.join(runDir(root), "task-cell-telemetry", "events.jsonl");
}

function withReadOnly<T>(file: string, run: () => T, readOnlyMode = 0o444): T {
  const mode = fs.statSync(file).mode & 0o777;
  fs.chmodSync(file, readOnlyMode);
  try {
    return run();
  } finally {
    fs.chmodSync(file, mode);
  }
}

async function validatedLane() {
  let clock = FIXED_NOW;
  const root = tempRoot("guild-e00-fault-");
  const rt = makeRuntime(root, undefined, () => clock);
  const d = await driveLane(root, rt, { logicalTaskId: "T1", role: "backend" });
  const ids = { run_id: root.runId, logical_task_id: "T1", attempt: 1, instance_id: d.instance.instance_id };
  return { root, rt, d, ids, paths: taskCellPaths(ids), setClock: (t: string) => { clock = t; } };
}

const busEventsFor = (root: TempRoot, rel: string) => readBusLog(runDir(root)).filter((e) => e.path === rel);

/** Today's terminate() throws when its post-seal publication fails; record either failure shape, never success. */
async function failedTerminate(run: () => Promise<{ ok: boolean }>): Promise<"threw" | "returned_failure"> {
  try {
    const r = await run();
    if (r.ok) throw new Error("fault fixture did not fault: terminate succeeded");
    return "returned_failure";
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("fault fixture did not fault")) throw error;
    if ((error as NodeJS.ErrnoException).code !== "EACCES") throw error;
    return "threw";
  }
}

/** Fault 1: acceptance persisted, CAS created, bus append failed. */
async function acceptanceWithFailedBusAppend() {
  const lane = await validatedLane();
  const result = await withReadOnly(busLog(lane.root), () => acceptLane(lane.rt, lane.d.instance));
  return { ...lane, result };
}

describe("F5 fault fixtures are real on today's code (controls)", () => {
  it("bus append failure leaves a persisted acceptance, its CAS entry, no bus event, and state handoff_validated", async () => {
    const { root, rt, d, paths, result } = await acceptanceWithFailedBusAppend();
    expect(result.ok).toBe(false);
    const bytes = fs.readFileSync(path.join(root.cwd, paths.acceptance_path));
    expect(busEventsFor(root, paths.acceptance_path).length).toBe(0);
    expect(casGet(runDir(root), sha256(bytes))?.created_at).toBe(FIXED_NOW);
    expect((await rt.runtime.observe(d.instance))?.handle.state).toBe("handoff_validated");
  });

  it("event-line failure leaves the acceptance published, the runtime in post-state, and a marker with no line", async () => {
    const { root, rt, d, paths } = await validatedLane();
    const before = readTaskCellLifecycleEvents({ cwd: root.cwd, runId: root.runId }).length;
    const result = await withReadOnly(eventsFile(root), () => acceptLane(rt, d.instance));
    expect(result.ok).toBe(false);
    expect(busEventsFor(root, paths.acceptance_path).length).toBe(1);
    expect((await rt.runtime.observe(d.instance))?.handle.state).toBe("handoff_accepted");
    const events = readTaskCellLifecycleEvents({ cwd: root.cwd, runId: root.runId });
    expect(events.length).toBe(before);
    expect(events.some((e) => e.event_name === "handoff_accepted")).toBe(false);
    const markers = fs.readdirSync(path.join(runDir(root), "task-cell-telemetry", "event-ids"));
    expect(markers.length).toBe(before + 1);
  });

  it("event-marker CREATE failure leaves the acceptance published, the runtime in post-state, and neither marker nor line", async () => {
    const { root, rt, d, paths } = await validatedLane();
    const ids = path.join(runDir(root), "task-cell-telemetry", "event-ids");
    const markersBefore = fs.readdirSync(ids).length;
    const linesBefore = readTaskCellLifecycleEvents({ cwd: root.cwd, runId: root.runId }).length;
    const result = await withReadOnly(ids, () => acceptLane(rt, d.instance), 0o555);
    expect(result.ok).toBe(false);
    expect(busEventsFor(root, paths.acceptance_path).length).toBe(1);
    expect((await rt.runtime.observe(d.instance))?.handle.state).toBe("handoff_accepted");
    expect(fs.readdirSync(ids).length).toBe(markersBefore);
    expect(readTaskCellLifecycleEvents({ cwd: root.cwd, runId: root.runId }).length).toBe(linesBefore);
  });

  it("terminal publication failure after acceptance leaves the acceptance bytes and bus event unchanged", async () => {
    const { root, rt, d, paths } = await validatedLane();
    expect((await acceptLane(rt, d.instance)).ok).toBe(true);
    const accBytes = fs.readFileSync(path.join(root.cwd, paths.acceptance_path));
    const accEvents = busEventsFor(root, paths.acceptance_path).length;
    expect(["threw", "returned_failure"]).toContain(await withReadOnly(busLog(root), () => failedTerminate(() => rt.runtime.terminate(d.instance))));
    expect(fs.existsSync(path.join(root.cwd, paths.terminal_path))).toBe(true);
    expect(busEventsFor(root, paths.terminal_path).length).toBe(0);
    expect(fs.readFileSync(path.join(root.cwd, paths.acceptance_path)).equals(accBytes)).toBe(true);
    expect(busEventsFor(root, paths.acceptance_path).length).toBe(accEvents);
  });
});

describe("CD24 reconciliation of a persisted, unpublished acceptance (expected red)", () => {
  it("classifies persisted_matching, then publishes the exact bytes at the reconciliation clock keeping the first CAS created_at", async () => {
    const classify = await requireExport<(...a: unknown[]) => Record<string, unknown>>("src/domains/dispatch/index.ts", "classifyPersistedAcceptance");
    const publishPersisted = await requireExport<(...a: unknown[]) => Record<string, unknown>>("src/domains/dispatch/index.ts", "publishPersistedLifecycleRecord");
    const { root, ids, paths } = await acceptanceWithFailedBusAppend();
    const acc = JSON.parse(fs.readFileSync(path.join(root.cwd, paths.acceptance_path), "utf8"));
    const bytes = fs.readFileSync(path.join(root.cwd, paths.acceptance_path));
    const intended = {
      acceptance_policy_version: acc.acceptance_policy_version, authorities_required: acc.authorities_required,
      authorities_observed: acc.authorities_observed, reviewer_cell_id: acc.reviewer_cell_id ?? null,
      validation_result_id: acc.validation_result_id, receipt_id: acc.receipt_id, assignment_id: acc.assignment_id, not_before: FIXED_NOW,
    };
    expect(classify(root.cwd, ids, intended)).toMatchObject({ kind: "persisted_matching" });
    expect(publishPersisted(root.cwd, ids, "acceptance", { binding_ref: root.bindingRef }, () => LATER)).toMatchObject({ outcome: "published" });
    const events = busEventsFor(root, paths.acceptance_path);
    expect(events.map((e) => [e.ts, e.sha256])).toEqual([[LATER, sha256(bytes)]]);
    expect(casGet(runDir(root), sha256(bytes))?.created_at).toBe(FIXED_NOW);
    expect(fs.readFileSync(path.join(root.cwd, paths.acceptance_path)).equals(bytes)).toBe(true);
  });

  it("runtime.reconcilePersistedAcceptance transitions and emits handoff_accepted at the current clock", async () => {
    requireMethod(FilesystemTaskCellRuntime.prototype, "FilesystemTaskCellRuntime", "reconcilePersistedAcceptance");
    const { root, rt, d, setClock } = await acceptanceWithFailedBusAppend();
    setClock(LATER);
    const out = await (rt.runtime as unknown as Record<string, (i: unknown) => Promise<{ ok: boolean }>>)["reconcilePersistedAcceptance"](d.instance);
    expect(out.ok).toBe(true);
    expect((await rt.runtime.observe(d.instance))?.handle.state).toBe("handoff_accepted");
    const ev = readTaskCellLifecycleEvents({ cwd: root.cwd, runId: root.runId }).filter((e) => e.event_name === "handoff_accepted");
    expect(ev.map((e) => e.at)).toEqual([LATER]);
  });

  it("a post-state whose marker could not be created is illegal_state for reconciliation (no re-emission)", async () => {
    requireMethod(FilesystemTaskCellRuntime.prototype, "FilesystemTaskCellRuntime", "reconcilePersistedAcceptance");
    const { root, rt, d } = await validatedLane();
    const ids = path.join(runDir(root), "task-cell-telemetry", "event-ids");
    await withReadOnly(ids, () => acceptLane(rt, d.instance), 0o555);
    const markers = fs.readdirSync(ids).length;
    const out = await (rt.runtime as unknown as Record<string, (i: unknown) => Promise<Record<string, unknown>>>)["reconcilePersistedAcceptance"](d.instance);
    expect(JSON.stringify(out)).toContain("illegal_state");
    expect(fs.readdirSync(ids).length).toBe(markers);
  });

  it("a post-state with a marker and no event line is illegal_state for reconciliation (no re-emission)", async () => {
    requireMethod(FilesystemTaskCellRuntime.prototype, "FilesystemTaskCellRuntime", "reconcilePersistedAcceptance");
    const { root, rt, d } = await validatedLane();
    await withReadOnly(eventsFile(root), () => acceptLane(rt, d.instance));
    const markers = fs.readdirSync(path.join(runDir(root), "task-cell-telemetry", "event-ids")).length;
    const out = await (rt.runtime as unknown as Record<string, (i: unknown) => Promise<Record<string, unknown>>>)["reconcilePersistedAcceptance"](d.instance);
    expect(JSON.stringify(out)).toContain("illegal_state");
    expect(fs.readdirSync(path.join(runDir(root), "task-cell-telemetry", "event-ids")).length).toBe(markers);
    expect(readTaskCellLifecycleEvents({ cwd: root.cwd, runId: root.runId }).some((e) => e.event_name === "handoff_accepted")).toBe(false);
  });
});

describe("CD24 / CD25 post-acceptance terminal reconciliation (expected red)", () => {
  it("reconcilePersistedTerminal publishes the persisted terminal, keeps terminated_at, and leaves acceptance facts unchanged", async () => {
    requireMethod(FilesystemTaskCellRuntime.prototype, "FilesystemTaskCellRuntime", "reconcilePersistedTerminal");
    const { root, rt, d, paths, setClock } = await validatedLane();
    expect((await acceptLane(rt, d.instance)).ok).toBe(true);
    const accBytes = fs.readFileSync(path.join(root.cwd, paths.acceptance_path));
    await withReadOnly(busLog(root), () => failedTerminate(() => rt.runtime.terminate(d.instance)));
    const terminalBefore = fs.readFileSync(path.join(root.cwd, paths.terminal_path));
    setClock(LATER);
    const out = await (rt.runtime as unknown as Record<string, (i: unknown) => Promise<{ ok: boolean }>>)["reconcilePersistedTerminal"](d.instance);
    expect(out.ok).toBe(true);
    expect(fs.readFileSync(path.join(root.cwd, paths.terminal_path)).equals(terminalBefore)).toBe(true);
    expect(busEventsFor(root, paths.terminal_path).map((e) => e.ts)).toEqual([LATER]);
    expect(fs.readFileSync(path.join(root.cwd, paths.acceptance_path)).equals(accBytes)).toBe(true);
  });

  it("classifyPersistedTerminal reports persisted_matching for the sealed request", async () => {
    const classify = await requireExport<(...a: unknown[]) => Record<string, unknown>>("src/domains/dispatch/index.ts", "classifyPersistedTerminal");
    const { root, rt, d, ids } = await validatedLane();
    expect((await acceptLane(rt, d.instance)).ok).toBe(true);
    await withReadOnly(busLog(root), () => failedTerminate(() => rt.runtime.terminate(d.instance)));
    expect(classify(root.cwd, ids, { terminal_state: "terminated", reason: null })).toMatchObject({ kind: "persisted_matching" });
  });
});
