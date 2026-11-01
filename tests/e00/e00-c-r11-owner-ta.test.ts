/**
 * E00-T0 · C11-A3 owner-proof regressions (implementation/e00/c11-owner-proof-scope.json,
 * c11-owner-proof-clarifications.json). Authored BEFORE any C owner correction.
 *
 * Owner death needs affirmative proof: authoritative PID absence, PID reuse (start
 * differs), or a boot change. A failed, blank or whitespace process observation, or a
 * missing/malformed recorded PID or start, is UNKNOWN: recordControllerLoss must refuse
 * controller_not_dead BEFORE any teardown call, seal or loss publication, and the real
 * worker survives. A missing recorded boot only removes the boot-change proof: with a
 * genuinely observed PID/start the owner is not dead.
 *
 * Real fixture: the claim is created by the SOURCE startTaskCellController
 * (support/controller-lane.ts) and names this live test process as owner; the lane's
 * worker is a real owned grandchild bound into the spawned handle (readiness fails and
 * teardown is refused, so the attempt stays nonterminal). The process-observation fault
 * is a test-owned `ps` first on PATH (macOS observer path; armed in-process and restored
 * in finally, activation probed). Claim mutations are test-side edits of the source-created
 * claim in the owned temp root. Linux /proc read faults are not exercisable on this host.
 * No product edits, no binding/nonce access.
 */
import { describe, it, expect, afterEach } from "bun:test";
import { execFileSync, spawnSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

import { classifyControllerOwner, recordControllerLoss, taskCellPaths } from "../../src/domains/dispatch";
import { processStartOf } from "../../scripts/lib/host/tmux-backend";
import { ownedTempDir, teardownOwned } from "./support/e00-harness";
import { LANE_RUN, LanePort, runControllerLane } from "./support/controller-lane";

afterEach(teardownOwned);

/**
 * The TEST's own process observations use an absolute /bin/ps under LC_ALL=C, so the
 * PATH ps fault reaches only the code under test, never the physical-truth checks.
 */
function startAbs(pid: number): string | null {
  const r = spawnSync("/bin/ps", ["-o", "lstart=", "-p", String(pid)], { encoding: "utf8", env: { ...process.env, LC_ALL: "C", LANG: "C" } });
  const out = (r.stdout ?? "").trim().replace(/\s+/g, " ");
  return r.status === 0 && out ? out : null;
}
const grandchildren: Array<{ pid: number; start: string }> = [];
afterEach(() => {
  while (grandchildren.length) {
    const g = grandchildren.pop()!;
    if (startAbs(g.pid) === g.start) { try { process.kill(g.pid, "SIGKILL"); } catch { /* gone */ } }
  }
});
let seq = 6700;
function liveGrandchild(): { pid: number; start: string } {
  const pid = Number(execFileSync("/bin/sh", ["-c", `sleep ${++seq} >/dev/null 2>&1 & echo $!`], { encoding: "utf8" }).trim());
  const g = { pid, start: startAbs(pid)! };
  grandchildren.push(g);
  return g;
}
const alive = (p: { pid: number; start: string }) => startAbs(p.pid) === p.start;
const isDarwin = process.platform === "darwin";

/** A source-created live owner (this process) with a real worker in a nonterminal spawned attempt. */
async function liveOwnerWithWorker() {
  const worker = liveGrandchild();
  const identity = { pane_id: "%7", pane_pid: worker.pid, pane_process_start: worker.start, server_pid: 434343, server_process_start: "tmux-start_time:1793100000" };
  const proto = LanePort.prototype as any;
  const overrides: Record<string, (this: any, input: any) => any> = {
    spawn: () => ({ ok: true, reason: null }),
    paneIdentity: () => identity,
    ready: () => ({ ok: false, reason: "fixture: never ready" }),
    terminate: () => ({ ok: false, reason: "fixture: worker teardown refused" }),
  };
  const undo = Object.entries(overrides).map(([k, fn]) => { const own = Object.prototype.hasOwnProperty.call(proto, k); const prev = proto[k]; proto[k] = fn; return () => { if (own) proto[k] = prev; else delete proto[k]; }; });
  let root = "";
  try { await runControllerLane({ wrap: (_rt, r) => { root = r; } }); } finally { for (const u of undo.reverse()) u(); }
  const controllerDir = path.join(root, ".guild", "runs", LANE_RUN, "controller");
  const claimFile = path.join(controllerDir, "controller.json");
  const handles = path.join(controllerDir, "handles");
  const iid = fs.readdirSync(handles)[0]!.replace(/\.json$/, "");
  const ids = { run_id: LANE_RUN, logical_task_id: "T1", attempt: 1, instance_id: iid };
  const attemptFile = path.join(root, taskCellPaths(ids).attempt_path);
  return { root, worker, claimFile, controllerDir, attemptFile, ids };
}
type Owner = Awaited<ReturnType<typeof liveOwnerWithWorker>>;

const editClaim = (o: Owner, f: (c: Record<string, any>) => void) => {
  const c = JSON.parse(fs.readFileSync(o.claimFile, "utf8"));
  f(c);
  fs.writeFileSync(o.claimFile, JSON.stringify(c, null, 2) + "\n");
};

/** A recording teardown port: it never signals anything; any call proves the gate was passed. */
function recordingPort() {
  const calls: string[] = [];
  return {
    calls,
    port: {
      serverIdentity: () => { calls.push("serverIdentity"); return null; },
      panePid: (id: string) => { calls.push(`panePid:${id}`); return null; },
      processStart: (pid: number) => { calls.push(`processStart:${pid}`); return processStartOf(pid); },
      terminatePane: (id: string) => { calls.push(`terminatePane:${id}`); return { ok: false, confirmed: false, degraded: false, polls: 0, error: "recording port", identity_check: "unavailable" as const }; },
    },
  };
}

/** Arm a test-owned `ps` first on PATH for the duration of `fn` (restored in finally). */
function withPs(root: string, mode: "error" | "blank" | "whitespace", fn: () => void): { activation: { status: number | null; stdout: string; stderrHasError: boolean } } {
  const bin = path.join(root, `.ps-${mode}`);
  fs.mkdirSync(bin, { recursive: true });
  const body = mode === "error" ? "echo 'ps: sysctl: Operation not permitted' >&2\nexit 1" : mode === "blank" ? "exit 0" : "printf '   \\n'\nexit 0";
  fs.writeFileSync(path.join(bin, "ps"), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  const saved = process.env["PATH"];
  process.env["PATH"] = `${bin}:${saved ?? "/usr/bin:/bin"}`;
  try {
    const probe = spawnSync("ps", ["-o", "lstart=", "-p", String(process.pid)], { encoding: "utf8" });
    const activation = { status: probe.status, stdout: probe.stdout ?? "", stderrHasError: /Operation not permitted/.test(probe.stderr ?? "") };
    fn();
    return { activation };
  } finally {
    process.env["PATH"] = saved;
  }
}

function lossObservation(o: Owner, run: () => any) {
  const attemptBefore = fs.readFileSync(o.attemptFile, "utf8");
  const rec = recordingPort();
  let out: any = null;
  let threw: string | null = null;
  run.call(null);
  try { out = recordControllerLoss({ cwd: o.root, runId: LANE_RUN, teardown: rec.port }); } catch (e) { threw = (e as Error).message; }
  const lossPublished = fs.existsSync(path.join(o.controllerDir, "loss")) || fs.readdirSync(o.controllerDir).some((n) => /^loss-.*\.json$/.test(n));
  return {
    threw, ok: out?.ok ?? null, refusal: out?.ok === false ? out.reason ?? null : null,
    port_calls: rec.calls.length, loss_published: lossPublished,
    attempt_unchanged: fs.readFileSync(o.attemptFile, "utf8") === attemptBefore, worker_alive: alive(o.worker),
  };
}

const REFUSED = { threw: null, ok: false, refusal: "controller_not_dead", port_calls: 0, loss_published: false, attempt_unchanged: true, worker_alive: true };
const nowIso = () => new Date().toISOString();

describe("C11-A3 · an unavailable owner process observation is unknown, never dead", () => {
  for (const mode of ["error", "blank", "whitespace"] as const) {
    it.skipIf(!isDarwin)(`ps ${mode} for a live source-created owner: owner unknown; record-loss refuses before any teardown`, async () => {
      const o = await liveOwnerWithWorker();
      // Precondition: the claim names this live process with its real start.
      const claim = JSON.parse(fs.readFileSync(o.claimFile, "utf8"));
      expect({ pid_is_self: claim.pid === process.pid, start_matches: startAbs(process.pid) === claim.process_start.trim().replace(/\s+/g, " ") }).toEqual({ pid_is_self: true, start_matches: true });
      let liveness = "";
      let obs: ReturnType<typeof lossObservation> | null = null;
      const { activation } = withPs(o.root, mode, () => {
        liveness = classifyControllerOwner(o.root, LANE_RUN, nowIso()).liveness;
        obs = lossObservation(o, () => undefined);
      });
      // Activation: the PATH ps the C observer resolves really fails / returns no start.
      expect(mode === "error" ? activation.status === 1 && activation.stderrHasError : activation.status === 0 && activation.stdout.trim() === "").toBe(true);
      expect({ liveness, ...obs! }).toEqual({ liveness: "unknown", ...REFUSED });
    }, 120_000);
  }
});

describe("C11-A3 · a missing or malformed recorded owner PID/start is unknown, never dead", () => {
  const mutations: Array<[string, (c: Record<string, any>) => void]> = [
    ["pid missing", (c) => { delete c.pid; }],
    ["pid zero", (c) => { c.pid = 0; }],
    ["pid negative", (c) => { c.pid = -1; }],
    ["pid non-integer", (c) => { c.pid = "not-a-pid"; }],
    ["process_start missing", (c) => { delete c.process_start; }],
    ["process_start blank", (c) => { c.process_start = "   "; }],
  ];
  for (const [label, mutate] of mutations) {
    it(`${label} for a live owner: owner unknown; record-loss refuses before any teardown`, async () => {
      const o = await liveOwnerWithWorker();
      editClaim(o, mutate);
      const liveness = classifyControllerOwner(o.root, LANE_RUN, nowIso()).liveness;
      expect({ liveness, ...lossObservation(o, () => undefined) }).toEqual({ liveness: "unknown", ...REFUSED });
    }, 120_000);
  }

  for (const [label, value] of [["null", null], ["blank", " "]] as const) {
    it(`boot_session ${label} with a genuinely observed live PID/start: not dead; record-loss refuses`, async () => {
      const o = await liveOwnerWithWorker();
      editClaim(o, (c) => { c.boot_session = value; });
      const liveness = classifyControllerOwner(o.root, LANE_RUN, nowIso()).liveness;
      expect({ not_dead: liveness !== "dead", ...lossObservation(o, () => undefined) }).toEqual({ not_dead: true, ...REFUSED });
    }, 120_000);
  }
});

/**
 * Boundary coverage authored AFTER the initial C owner correction started (root Q2:
 * only ESRCH from kill(pid, 0) is absence; every other presence-probe error is
 * unknown). Not a pre-correction red. A scoped process.kill wrapper fails ONLY
 * signal 0 aimed at the source-created owner pid; all other calls pass through, and
 * the original is restored in finally. The wrapper must fire (precondition). ESRCH
 * and normal observation stay covered by the real-absence and live-owner controls.
 */
describe("C11-A3 boundary · a non-ESRCH owner presence-probe error is unknown, never permission to continue", () => {
  for (const code of ["EPERM", "EINVAL"] as const) {
    it(`kill(owner, 0) ${code}: owner unknown; record-loss refuses before any teardown`, async () => {
      const o = await liveOwnerWithWorker();
      const ownerPid = JSON.parse(fs.readFileSync(o.claimFile, "utf8")).pid as number;
      expect(ownerPid).toBe(process.pid);
      const original = process.kill;
      let fired = 0;
      (process as { kill: typeof process.kill }).kill = ((pid: number, signal?: string | number) => {
        if (pid === ownerPid && (signal === 0 || signal === "0")) {
          fired++;
          throw Object.assign(new Error(`kill ${code} (E00-T0 scoped fault)`), { code, errno: code === "EPERM" ? -1 : -22, syscall: "kill" });
        }
        return original.call(process, pid, signal as never);
      }) as typeof process.kill;
      let liveness = "";
      let obs: ReturnType<typeof lossObservation> | null = null;
      try {
        liveness = classifyControllerOwner(o.root, LANE_RUN, nowIso()).liveness;
        obs = lossObservation(o, () => undefined);
      } finally {
        (process as { kill: typeof process.kill }).kill = original;
      }
      expect(fired).toBeGreaterThan(0);
      expect({ liveness, ...obs! }).toEqual({ liveness: "unknown", ...REFUSED });
    }, 120_000);
  }
});

/**
 * C12 (review/G-lane-E00-C/result-r11.json F1): an unavailable CURRENT boot id removes
 * only the boot-change proof. Affirmative PID absence or PID/start reuse must still
 * prove the owner dead and let loss proceed; a live matching owner and an unavailable
 * process read must still refuse. The fault is a test-owned `sysctl` first on PATH
 * (macOS current-boot observer), armed AFTER the source-created claim records its boot,
 * restored in finally, activation probed. Pre-correction reds on C source 3f0f9a63.
 */
function withSysctl(root: string, mode: "error" | "blank", fn: () => void): { status: number | null; stdout: string; stderrHasError: boolean } {
  const bin = path.join(root, `.sysctl-${mode}`);
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, "sysctl"), `#!/bin/sh\n${mode === "error" ? "echo 'sysctl: unknown oid' >&2\nexit 1" : "exit 0"}\n`, { mode: 0o755 });
  const saved = process.env["PATH"];
  process.env["PATH"] = `${bin}:${saved ?? "/usr/bin:/bin"}`;
  try {
    const probe = spawnSync("sysctl", ["-n", "kern.bootsessionuuid"], { encoding: "utf8" });
    fn();
    return { status: probe.status, stdout: probe.stdout ?? "", stderrHasError: /unknown oid/.test(probe.stderr ?? "") };
  } finally {
    process.env["PATH"] = saved;
  }
}
const sysctlActive = (mode: "error" | "blank", a: { status: number | null; stdout: string; stderrHasError: boolean }) =>
  mode === "error" ? a.status === 1 && a.stderrHasError : a.status === 0 && a.stdout.trim() === "";

describe("C12 · an unavailable current boot id never blocks affirmative owner death proof", () => {
  for (const mode of ["error", "blank"] as const) {
    it.skipIf(!isDarwin)(`sysctl ${mode}: authoritatively absent owner PID is dead and loss proceeds; the live worker is never killed`, async () => {
      const o = await liveOwnerWithWorker();
      const gone = liveGrandchild();
      process.kill(gone.pid, "SIGKILL");
      for (let i = 0; i < 100 && alive(gone); i++) await new Promise((r) => setTimeout(r, 20));
      expect(alive(gone)).toBe(false);
      editClaim(o, (c) => { c.pid = gone.pid; c.process_start = gone.start; });
      let liveness = "";
      let obs: ReturnType<typeof lossObservation> | null = null;
      const a = withSysctl(o.root, mode, () => { liveness = classifyControllerOwner(o.root, LANE_RUN, nowIso()).liveness; obs = lossObservation(o, () => undefined); });
      expect(sysctlActive(mode, a)).toBe(true);
      expect({ liveness, ok: obs!.ok, loss_published: obs!.loss_published, worker_alive: obs!.worker_alive })
        .toEqual({ liveness: "dead", ok: true, loss_published: true, worker_alive: true });
    }, 120_000);

    it.skipIf(!isDarwin)(`sysctl ${mode}: a live PID with a different start (reuse) is dead and loss proceeds`, async () => {
      const o = await liveOwnerWithWorker();
      editClaim(o, (c) => { c.process_start = "Thu Jan  1 00:00:00 1970"; });
      let liveness = "";
      let obs: ReturnType<typeof lossObservation> | null = null;
      const a = withSysctl(o.root, mode, () => { liveness = classifyControllerOwner(o.root, LANE_RUN, nowIso()).liveness; obs = lossObservation(o, () => undefined); });
      expect(sysctlActive(mode, a)).toBe(true);
      expect({ liveness, ok: obs!.ok, loss_published: obs!.loss_published, worker_alive: obs!.worker_alive })
        .toEqual({ liveness: "dead", ok: true, loss_published: true, worker_alive: true });
    }, 120_000);

    it.skipIf(!isDarwin)(`control, sysctl ${mode}: a live matching owner is not dead; record-loss refuses before any teardown`, async () => {
      const o = await liveOwnerWithWorker();
      let liveness = "";
      let obs: ReturnType<typeof lossObservation> | null = null;
      const a = withSysctl(o.root, mode, () => { liveness = classifyControllerOwner(o.root, LANE_RUN, nowIso()).liveness; obs = lossObservation(o, () => undefined); });
      expect(sysctlActive(mode, a)).toBe(true);
      expect({ not_dead: liveness !== "dead", ...obs! }).toEqual({ not_dead: true, ...REFUSED });
    }, 120_000);

    it.skipIf(!isDarwin)(`control, sysctl ${mode} and ps error: an unavailable process read stays unknown; record-loss refuses`, async () => {
      const o = await liveOwnerWithWorker();
      let liveness = "";
      let obs: ReturnType<typeof lossObservation> | null = null;
      let a: { status: number | null; stdout: string; stderrHasError: boolean } | null = null;
      withPs(o.root, "error", () => {
        a = withSysctl(o.root, mode, () => { liveness = classifyControllerOwner(o.root, LANE_RUN, nowIso()).liveness; obs = lossObservation(o, () => undefined); });
      });
      expect(sysctlActive(mode, a!)).toBe(true);
      expect({ liveness, ...obs! }).toEqual({ liveness: "unknown", ...REFUSED });
    }, 120_000);
  }
});

describe("C11-A3 controls · real absence, PID reuse, boot change and a live owner", () => {
  it("control: live owner, no fault: not dead; record-loss refuses before any teardown", async () => {
    const o = await liveOwnerWithWorker();
    const liveness = classifyControllerOwner(o.root, LANE_RUN, nowIso()).liveness;
    expect({ live_or_unresponsive: liveness === "live" || liveness === "unresponsive", ...lossObservation(o, () => undefined) })
      .toEqual({ live_or_unresponsive: true, ...REFUSED });
  }, 120_000);

  it("control: the recorded owner PID is authoritatively absent: dead; record-loss proceeds and never kills the live worker", async () => {
    const o = await liveOwnerWithWorker();
    const gone = liveGrandchild();
    process.kill(gone.pid, "SIGKILL");
    for (let i = 0; i < 100 && alive(gone); i++) await new Promise((r) => setTimeout(r, 20));
    expect(alive(gone)).toBe(false);
    editClaim(o, (c) => { c.pid = gone.pid; c.process_start = gone.start; });
    expect(classifyControllerOwner(o.root, LANE_RUN, nowIso()).liveness).toBe("dead");
    const r = lossObservation(o, () => undefined);
    expect({ ok: r.ok, loss_published: r.loss_published, worker_alive: r.worker_alive }).toEqual({ ok: true, loss_published: true, worker_alive: true });
  }, 120_000);

  it("control: the recorded PID is alive with a different start (reuse): dead; record-loss proceeds", async () => {
    const o = await liveOwnerWithWorker();
    editClaim(o, (c) => { c.process_start = "Thu Jan  1 00:00:00 1970"; });
    expect(classifyControllerOwner(o.root, LANE_RUN, nowIso()).liveness).toBe("dead");
    expect(lossObservation(o, () => undefined)).toMatchObject({ ok: true, loss_published: true, worker_alive: true });
  }, 120_000);

  it("control: a recorded boot session that differs from the current one: dead; record-loss proceeds", async () => {
    const o = await liveOwnerWithWorker();
    editClaim(o, (c) => { c.boot_session = "00000000-0000-0000-0000-000000000000"; });
    expect(classifyControllerOwner(o.root, LANE_RUN, nowIso()).liveness).toBe("dead");
    expect(lossObservation(o, () => undefined)).toMatchObject({ ok: true, loss_published: true, worker_alive: true });
  }, 120_000);
});
