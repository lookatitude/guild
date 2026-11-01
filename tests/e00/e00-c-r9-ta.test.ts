/**
 * E00-T0 · focused C9 regressions (review/G-lane-E00-C/result-r9.json F1, F2),
 * authored BEFORE any C source change against the frozen C9 candidate.
 *
 * F1  a real child is launched and the spawn is a typed unknown; the reservation
 *     cleanup (reservation.release -> withStableLock on the run) then really fails:
 *     (a) the run lock directory is unwritable (EACCES on the sentinel create), or
 *     (b) the lock sentinel is held, so the acquire times out. The fault is armed
 *     only for that spawnInstance call, verified active, and removed in finally.
 *     The typed unknown, nonterminal orphan, held cap slot and supervision survive.
 * F2  the inner spawn succeeds with a live child; the spawned-handle PUBLICATION then
 *     fails semantically: the first write whose serialized payload is a controller
 *     handle with state "spawned" (writeFileSync to any path, temp or final, or fd
 *     writeSync) writes a truncated prefix into its actual target and throws EIO.
 *     The fault must fire (precondition), so an atomic temp+rename writer still hits
 *     it. Separately, a corrupt or missing canonical handle before the noteHandle
 *     fallback. The handle must stay conservatively pending: never a fabricated
 *     "spawned" record, and a spawned identity only from captured inner provenance.
 * Controls: ordinary success records the inner identity; an intact known spawned
 *     handle keeps its identity when noted awaiting teardown; a no-effect refusal
 *     releases its slot normally; a prior unknown (no fault) keeps spawn_pending.
 *
 * Physical truth is a real test-owned child (sleep 63xx). Existing seams only:
 * source controller lane over the REAL runtime, runtime method wrapper (`wrap`) to
 * bound each fault window, LanePort prototype methods replaced per lane and
 * restored, and bun's test-runner module mock for fs (installed inside the window,
 * restored in finally; a plain fs-object patch does not reach ESM importers).
 * No product edits; no TC/broker/package claim.
 */
import { describe, it, expect, afterEach, mock } from "bun:test";
import { spawn as spawnChild } from "child_process";
import * as fs from "fs";
import * as path from "path";

import { FilesystemTaskCellRuntime, readControllerStatus, taskCellPaths } from "../../src/domains/dispatch";
import { FULL_RUNGS, FakeWorkerPort, ownChild, processStart, teardownOwned, tempRoot, type TempRoot } from "./support/e00-harness";
import { LANE_RUN, LanePort, runControllerLane } from "./support/controller-lane";

/** Unpatched fs functions, captured before any module mock. */
const FS_SNAPSHOT: Record<string, unknown> = { ...fs };

const faultRestores: Array<() => void> = [];
function restoreFaults(): void {
  while (faultRestores.length) { try { faultRestores.pop()!(); } catch { /* gone */ } }
}
afterEach(restoreFaults);
afterEach(teardownOwned);

const TERMINAL = ["failed", "terminated", "timed_out", "cancelled", "reaped"];
let sleepSeq = 6300;

function liveChild(root: string): { pid: number; start: string; alive: () => boolean } {
  const child = ownChild(spawnChild("sleep", [String(++sleepSeq)], { stdio: "ignore" }), root);
  const pid = child.pid!;
  const start = processStart(pid)!;
  return { pid, start, alive: () => processStart(pid) === start };
}

// ── F1 fault: the real run lock taken by reservation.release ──

type LockFault = "eacces" | "timeout";
interface LockArm { mode: LockFault; active: boolean; detail: string | null }

/** Arm the lock fault on `runDir` (verified active); the restore is queued. */
function armLockFault(runDir: string, mode: LockFault): LockArm {
  const logs = path.join(runDir, "logs");
  fs.mkdirSync(logs, { recursive: true });
  const sentinel = path.join(logs, ".lock.exclusion");
  if (mode === "eacces") {
    fs.chmodSync(logs, 0o500);
    faultRestores.push(() => fs.chmodSync(logs, 0o700));
    try { fs.closeSync(fs.openSync(path.join(logs, ".t0-probe"), "wx")); return { mode, active: false, detail: "probe create succeeded" }; }
    catch (e) { return { mode, active: (e as NodeJS.ErrnoException).code === "EACCES", detail: (e as NodeJS.ErrnoException).code ?? null }; }
  }
  fs.writeFileSync(sentinel, "held by E00-T0 C9-F1 fault\n", { flag: "wx" });
  faultRestores.push(() => fs.rmSync(sentinel, { force: true }));
  try { fs.closeSync(fs.openSync(sentinel, "wx")); return { mode, active: false, detail: "sentinel create succeeded" }; }
  catch (e) { return { mode, active: (e as NodeJS.ErrnoException).code === "EEXIST", detail: (e as NodeJS.ErrnoException).code ?? null }; }
}

function runtimeFor(root: TempRoot, worker: any, maxInstances = 1) {
  let seq = 0;
  return new FilesystemTaskCellRuntime({
    rungPlan: FULL_RUNGS, cwd: root.cwd, substrate: "tmux", parallelism: 4, maxInstances,
    binding: { binding_ref: root.bindingRef }, worker, now: () => "2026-10-27T00:00:00.000Z",
    idFactory: (kind: string) => `${kind}-${++seq}`,
  } as never);
}

async function spawnOne(runtime: any, root: TempRoot, taskId: string) {
  const cell = await runtime.spawnCell({
    run_id: root.runId, cell_id: `cell-${taskId}`, goal_id: "goal-e00", phase_id: "build",
    step_id: taskId, team_id: "team-e00", logical_task_id: taskId,
    fanout: "lead_plus_one", lead: { lead_binding_id: "lead-binding-e00" },
  });
  return runtime.spawnInstance(cell, {
    task_run_id: `${taskId}.tr1`, attempt: 1, worker_role: "backend",
    specialist_type_id: "backend", specialist_type_version: "1", specialist_type_hash: "sha256:type",
    specialist_profile_id: "backend", specialist_profile_hash: "sha256:profile",
    host_id: "claude-code-cli", adapter_id: "claude-code-cli@1", host_capabilities_hash: "sha256:caps",
    model_tier: "mid", model_id: "fixture-model", context_bundle_id: `.guild/context/${taskId}.md`,
    context_bundle_hash: `sha256:${"0".repeat(64)}`,
    projection: { tools: ["read", "write"], permissions: [], recorded_losses: [] },
    budgets: { tokens: null, wall_clock_ms: null, cost_usd: null },
  });
}

function attemptOf(root: TempRoot, taskId: string) {
  const base = path.join(root.cwd, ".guild", "runs", root.runId, "task-cells", taskId, "attempts", "1", "instances");
  const iid = fs.existsSync(base) ? fs.readdirSync(base)[0] ?? null : null;
  if (!iid) return { iid: null, attempt: null };
  const abs = path.join(root.cwd, taskCellPaths({ run_id: root.runId, logical_task_id: taskId, attempt: 1, instance_id: iid }).attempt_path);
  return { iid, attempt: fs.existsSync(abs) ? JSON.parse(fs.readFileSync(abs, "utf8")) : null };
}

describe("C9-F1 · runtime: a failing reservation cleanup never replaces the typed unknown spawn", () => {
  for (const mode of ["eacces", "timeout"] as LockFault[]) {
    it(`lock ${mode}: SpawnOutcomeUnknownError survives; attempt nonterminal; cap slot held; child alive`, async () => {
      const root = tempRoot("guild-e00-c9-");
      const runDir = path.join(root.cwd, ".guild", "runs", root.runId);
      let child: ReturnType<typeof liveChild> | null = null;
      let arm: LockArm | null = null;
      const worker = new FakeWorkerPort();
      worker.spawn = (() => {
        child = liveChild(root.cwd);
        arm = armLockFault(runDir, mode);
        return { ok: false, reason: "fixture: worker launched, outcome lost", spawn_effect: "unknown" };
      }) as never;
      const runtime = runtimeFor(root, worker);
      let error: any = null;
      try { await spawnOne(runtime, root, "T1"); } catch (e) { error = e; } finally { restoreFaults(); }
      // Preconditions: the child is alive and the lock fault was verified active at the cleanup boundary.
      expect(child!.alive()).toBe(true);
      expect(arm).toMatchObject({ mode, active: true });
      const a = attemptOf(root, "T1");
      let second = false;
      worker.spawn = (() => ({ ok: true, reason: null })) as never;
      try { await spawnOne(runtime, root, "T2"); } catch { second = true; }
      expect({
        error_name: error?.name ?? null, error_instance_id: error?.instance_id ?? null, error_attempt_id: error?.attempt_id ?? null,
        attempt_present: a.attempt !== null, attempt_terminal: a.attempt === null ? "missing_record" : a.attempt.terminal_state,
        second_admission_refused: second,
      }).toEqual({
        error_name: "SpawnOutcomeUnknownError", error_instance_id: a.iid, error_attempt_id: a.attempt?.attempt_id ?? "missing",
        attempt_present: true, attempt_terminal: null, second_admission_refused: true,
      });
      expect(child!.alive()).toBe(true);
    }, 30_000);
  }

  it("control: a no-effect refusal releases its slot normally (no fault)", async () => {
    const root = tempRoot("guild-e00-c9-");
    const worker = new FakeWorkerPort();
    worker.spawn = (() => ({ ok: false, reason: "fixture: refused before any action", spawn_effect: "none" })) as never;
    const runtime = runtimeFor(root, worker);
    let error: any = null;
    try { await spawnOne(runtime, root, "T1"); } catch (e) { error = e; }
    expect(error?.name).not.toBe("SpawnOutcomeUnknownError");
    expect(attemptOf(root, "T1").attempt?.terminal_state).toBe("failed");
    worker.spawn = (() => ({ ok: true, reason: null })) as never;
    await spawnOne(runtime, root, "T2");
  });
});

// ── controller lane helper (existing seams only) ──

interface LaneObs { root: string; out: any; thrown: Error | null; iid: string | null; attempt: any; handle: any; handleRaw: string | null; view: any; heartbeatAtReturn: string | null; spawnErrorName: string | null; spawnErrorReason: string | null }

async function lane(port: Record<string, (this: any, ...a: any[]) => any>, o: { wrapSpawnInstance?: (root: string) => { before?: () => void; after?: () => void } } = {}): Promise<LaneObs> {
  const proto = LanePort.prototype as any;
  const undo = Object.entries(port).map(([name, fn]) => {
    const own = Object.prototype.hasOwnProperty.call(proto, name);
    const prev = proto[name];
    proto[name] = fn;
    return () => { if (own) proto[name] = prev; else delete proto[name]; };
  });
  let root = "";
  let out: any = null;
  let thrown: Error | null = null;
  let heartbeatAtReturn: string | null = null;
  let spawnErrorName: string | null = null;
  let spawnErrorReason: string | null = null;
  try {
    const run = await runControllerLane({
      wrap: (rt, r) => {
        root = r;
        const orig = rt.spawnInstance.bind(rt);
        rt.spawnInstance = async (...a: unknown[]) => {
          const hooks = o.wrapSpawnInstance?.(r) ?? {};
          try { return await orig(...a); }
          catch (e) { spawnErrorName = (e as Error).name; spawnErrorReason = (e as { reason?: string }).reason ?? (e as Error).message; throw e; }
          finally { hooks.after?.(); restoreFaults(); }
        };
      },
      controllerHook: (c, r) => {
        const inner = c.runLane.bind(c);
        c.runLane = async (spec: unknown) => {
          const res = await inner(spec);
          const hb = path.join(r, ".guild", "runs", LANE_RUN, "controller", "heartbeat.json");
          heartbeatAtReturn = fs.existsSync(hb) ? JSON.parse(fs.readFileSync(hb, "utf8")).state ?? null : null;
          return res;
        };
      },
    });
    out = run.out;
  } catch (error) {
    thrown = error as Error;
  } finally {
    for (const u of undo.reverse()) u();
    restoreFaults();
  }
  const handles = path.join(root, ".guild", "runs", LANE_RUN, "controller", "handles");
  const files = fs.existsSync(handles) ? fs.readdirSync(handles) : [];
  const iid = files.length === 1 ? files[0]!.replace(/\.json$/, "") : null;
  const handleRaw = iid ? fs.readFileSync(path.join(handles, files[0]!), "utf8") : null;
  let handle: any = null;
  try { handle = handleRaw === null ? null : JSON.parse(handleRaw); } catch { handle = "unparseable"; }
  const p = iid ? taskCellPaths({ run_id: LANE_RUN, logical_task_id: "T1", attempt: 1, instance_id: iid }) : null;
  const attempt = p && fs.existsSync(path.join(root, p.attempt_path)) ? JSON.parse(fs.readFileSync(path.join(root, p.attempt_path), "utf8")) : null;
  const status = readControllerStatus({ cwd: root, runId: LANE_RUN, consumerPolicy: "cooperative_local" } as never) as any;
  const view = (status.instances ?? []).find((i: any) => i.instance_id === iid) ?? null;
  return { root, out, thrown, iid, attempt, handle, handleRaw, view, heartbeatAtReturn, spawnErrorName, spawnErrorReason };
}

function orphanObservation(r: LaneObs) {
  return {
    thrown: r.thrown?.message ?? null, orphaned: r.out?.orphaned ?? null, awaiting: r.out?.awaiting ?? null,
    qualified_release: r.out?.qualified_release ?? null, teardown_confirmed: r.out?.teardown?.confirmed ?? null,
    unknown_token: String(r.out?.teardown?.failure ?? "").includes("spawn_outcome_unknown"),
    state_nonterminal: r.out ? !TERMINAL.includes(r.out.state) : null,
    attempt_present: r.attempt !== null, attempt_terminal: r.attempt === null ? "missing_record" : r.attempt.terminal_state,
    status_awaiting: r.view?.awaiting ?? null, heartbeat_at_return: r.heartbeatAtReturn,
  };
}
const ORPHAN_EXPECTED = {
  thrown: null, orphaned: true, awaiting: "teardown", qualified_release: false, teardown_confirmed: false, unknown_token: true,
  state_nonterminal: true, attempt_present: true, attempt_terminal: null, status_awaiting: "teardown", heartbeat_at_return: "supervising",
};

describe("C9-F1 · controller: the truthful nonterminal orphan outcome survives a failing reservation cleanup", () => {
  for (const mode of ["eacces", "timeout"] as LockFault[]) {
    it(`lock ${mode}`, async () => {
      let child: ReturnType<typeof liveChild> | null = null;
      let arm: LockArm | null = null;
      const r = await lane({
        spawn(this: any) {
          child = liveChild(this.root);
          arm = armLockFault(path.join(this.root, ".guild", "runs", LANE_RUN), mode);
          return { ok: false, reason: "fixture: worker launched, outcome lost", spawn_effect: "unknown" };
        },
      });
      expect(child!.alive()).toBe(true);
      expect(arm).toMatchObject({ mode, active: true });
      expect({ ...orphanObservation(r), spawn_error: r.spawnErrorName }).toEqual({ ...ORPHAN_EXPECTED, spawn_error: "SpawnOutcomeUnknownError" });
    }, 30_000);
  }
});

// ── F2: the post-success spawned-handle publication fails on a mutated target ──

const IDENTITY_FIELDS = ["pane_id", "pane_pid", "pane_process_start", "server_pid", "server_process_start"];
const identityOf = (h: any) => Object.fromEntries(IDENTITY_FIELDS.map((k) => [k, h && typeof h === "object" ? h[k] ?? null : null]));
const NO_IDENTITY = Object.fromEntries(IDENTITY_FIELDS.map((k) => [k, null]));
const HANDLE_SCHEMA = "guild.task_cell_controller_handle.v1";

/**
 * Semantic fault on the spawned-handle PUBLICATION, not on a pathname: the first write
 * (writeFileSync to any path, or fd writeSync) whose serialized payload is a controller
 * handle with state "spawned" writes a truncated prefix of that payload into its actual
 * target and then throws EIO. A same-directory temp+rename writer still hits it; a writer
 * that no longer routes through these calls leaves `fired` false and the precondition fails.
 * Installed through bun's module mock for the lane only and restored in finally.
 */
interface PubFault { fired: boolean; target: string | null; truncated_bytes: number | null; payload_state: string | null }
function installSpawnedPublicationFault(): PubFault {
  const fault: PubFault = { fired: false, target: null, truncated_bytes: null, payload_state: null };
  const text = (data: unknown): string | null =>
    typeof data === "string" ? data : data instanceof Uint8Array ? Buffer.from(data).toString("utf8") : null;
  const spawnedHandle = (data: unknown): boolean => {
    const s = text(data);
    if (s === null) return false;
    try { const j = JSON.parse(s); return j?.schema_version === HANDLE_SCHEMA && j.state === "spawned"; } catch { return false; }
  };
  const fail = (): never => { throw Object.assign(new Error("E00-T0 C9-F2 fault: spawned handle write interrupted"), { code: "EIO" }); };
  const writeFileSync = (target: any, data: any, ...rest: any[]) => {
    if (!fault.fired && spawnedHandle(data)) {
      const s = text(data)!;
      const partial = s.slice(0, Math.max(1, Math.floor(s.length / 3)));
      (FS_SNAPSHOT.writeFileSync as any)(target, partial, ...rest);
      Object.assign(fault, { fired: true, target: String(target), truncated_bytes: Buffer.byteLength(partial), payload_state: "spawned" });
      fail();
    }
    return (FS_SNAPSHOT.writeFileSync as any)(target, data, ...rest);
  };
  const writeSync = (fd: any, data: any, ...rest: any[]) => {
    if (!fault.fired && spawnedHandle(data)) {
      const s = text(data)!;
      const partial = s.slice(0, Math.max(1, Math.floor(s.length / 3)));
      (FS_SNAPSHOT.writeSync as any)(fd, partial);
      Object.assign(fault, { fired: true, target: `fd:${fd}`, truncated_bytes: Buffer.byteLength(partial), payload_state: "spawned" });
      fail();
    }
    return (FS_SNAPSHOT.writeSync as any)(fd, data, ...rest);
  };
  mock.module("fs", () => ({ ...FS_SNAPSHOT, default: { ...FS_SNAPSHOT, writeFileSync, writeSync }, writeFileSync, writeSync }));
  faultRestores.push(() => { mock.module("fs", () => ({ ...FS_SNAPSHOT, default: FS_SNAPSHOT })); });
  return fault;
}

const handlePath = (root: string, iid: string) => path.join(root, ".guild", "runs", LANE_RUN, "controller", "handles", `${iid}.json`);

describe("C9-F2 · a failed spawned-handle publication never becomes a fabricated spawned record", () => {
  it("post-success publication truncated then thrown: handle stays pending, no invented identity, nonterminal orphan", async () => {
    let child: ReturnType<typeof liveChild> | null = null;
    let fault: PubFault | null = null;
    const r = await lane({
      spawn(this: any) { child = liveChild(this.root); fault = installSpawnedPublicationFault(); return { ok: true, reason: null }; },
    }, { wrapSpawnInstance: () => ({ after: restoreFaults }) });
    // Preconditions: real child alive; the fault fired on an actual spawned-handle payload and mutated its target.
    expect(child!.alive()).toBe(true);
    expect(fault).toMatchObject({ fired: true, payload_state: "spawned" });
    expect(fault!.truncated_bytes).toBeGreaterThan(0);
    expect({ ...orphanObservation(r), handle_state: r.handle === "unparseable" ? "unparseable" : r.handle?.state ?? null, identity: identityOf(r.handle) })
      .toEqual({ ...ORPHAN_EXPECTED, handle_state: "spawn_pending", identity: NO_IDENTITY });
  });

  it("post-success publication fails with inner identity captured: pending, or spawned with exactly that identity", async () => {
    let child: ReturnType<typeof liveChild> | null = null;
    let captured: Record<string, unknown> | null = null;
    let fault: PubFault | null = null;
    const r = await lane({
      spawn(this: any) {
        child = liveChild(this.root);
        captured = { pane_id: "%71", pane_pid: child.pid, pane_process_start: child.start, server_pid: process.pid, server_process_start: processStart(process.pid) };
        fault = installSpawnedPublicationFault();
        return { ok: true, reason: null };
      },
      paneIdentity() { return captured; },
    }, { wrapSpawnInstance: () => ({ after: restoreFaults }) });
    expect(child!.alive()).toBe(true);
    expect(fault).toMatchObject({ fired: true, payload_state: "spawned" });
    const state = r.handle === "unparseable" ? "unparseable" : r.handle?.state ?? null;
    const identity = identityOf(r.handle);
    const truthful = state === "spawn_pending"
      ? JSON.stringify(identity) === JSON.stringify(NO_IDENTITY) || JSON.stringify(identity) === JSON.stringify(identityOf(captured))
      : state === "spawned" && JSON.stringify(identity) === JSON.stringify(identityOf(captured));
    expect({ ...orphanObservation(r), handle_truthful: truthful }).toEqual({ ...ORPHAN_EXPECTED, handle_truthful: true });
  });

  for (const damage of ["corrupt", "missing"] as const) {
    it(`${damage} canonical handle before the noteHandle fallback: no fabricated spawned record`, async () => {
      let child: ReturnType<typeof liveChild> | null = null;
      let verified: string | null = null;
      const r = await lane({
        spawn(this: any, input: any) {
          child = liveChild(this.root);
          const file = handlePath(this.root, input.instance_id);
          if (damage === "missing") { fs.rmSync(file); verified = fs.existsSync(file) ? null : "missing"; }
          else {
            fs.writeFileSync(file, fs.readFileSync(file).subarray(0, 12));
            try { JSON.parse(fs.readFileSync(file, "utf8")); } catch { verified = "corrupt"; }
          }
          return { ok: false, reason: "fixture: worker launched, outcome lost", spawn_effect: "unknown" };
        },
      });
      expect(child!.alive()).toBe(true);
      expect(verified).toBe(damage);
      const state = r.handle === "unparseable" ? "unparseable" : r.handle?.state ?? null;
      expect({ ...orphanObservation(r), handle_not_spawned: state !== "spawned", identity: identityOf(r.handle) })
        .toEqual({ ...ORPHAN_EXPECTED, handle_not_spawned: true, identity: NO_IDENTITY });
    });
  }

  it("control: ordinary success records the inner port's exact identity as spawned", async () => {
    let child: ReturnType<typeof liveChild> | null = null;
    let captured: Record<string, unknown> | null = null;
    const r = await lane({
      spawn(this: any) {
        child = liveChild(this.root);
        captured = { pane_id: "%72", pane_pid: child.pid, pane_process_start: child.start, server_pid: process.pid, server_process_start: processStart(process.pid) };
        return { ok: true, reason: null };
      },
      paneIdentity() { return captured; },
    });
    expect(child!.alive()).toBe(true);
    expect(r.thrown).toBeNull();
    expect(r.out?.orphaned ?? false).toBe(false);
    expect({ state: r.handle?.state ?? null, identity: identityOf(r.handle) }).toEqual({ state: "spawned", identity: identityOf(captured) });
  });

  it("control: an intact known spawned handle keeps its identity when later noted awaiting teardown", async () => {
    let child: ReturnType<typeof liveChild> | null = null;
    let captured: Record<string, unknown> | null = null;
    const r = await lane({
      spawn(this: any) {
        child = liveChild(this.root);
        captured = { pane_id: "%73", pane_pid: child.pid, pane_process_start: child.start, server_pid: process.pid, server_process_start: processStart(process.pid) };
        return { ok: true, reason: null };
      },
      paneIdentity() { return captured; },
      ready() { return { ok: false, reason: "fixture: never ready" }; },
      terminate() { return { ok: false, reason: "fixture: worker teardown refused" }; },
    });
    expect(child!.alive()).toBe(true);
    expect({ state: r.handle?.state ?? null, awaiting: r.handle?.awaiting ?? null, identity: identityOf(r.handle) })
      .toEqual({ state: "spawned", awaiting: "teardown", identity: identityOf(captured) });
  });

  it("control: a prior unknown (no damage) keeps the readable handle spawn_pending", async () => {
    let child: ReturnType<typeof liveChild> | null = null;
    const r = await lane({ spawn(this: any) { child = liveChild(this.root); return { ok: false, reason: "fixture: outcome lost", spawn_effect: "unknown" }; } });
    expect(child!.alive()).toBe(true);
    expect({ ...orphanObservation(r), handle_state: r.handle?.state ?? null }).toEqual({ ...ORPHAN_EXPECTED, handle_state: "spawn_pending" });
  });
});
