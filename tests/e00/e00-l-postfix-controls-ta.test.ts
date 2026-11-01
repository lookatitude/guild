/**
 * E00-T0 · independent POST-FIX negative controls for the E00-L r1 routing fix
 * (L-T0-1 locale-stable identity, L-T0-2 declared-host readiness). Authored after
 * L's r1 source freeze against the frozen backend; none of these were run
 * red-before. The original M1-M7 files are unchanged and rerun separately.
 *
 * P1 ready() stays false while a non-shell helper or guard is live under the
 *    recorded pane and the declared host has not started (and forever when it
 *    never starts), then true once the host carrying the injection runs.
 * P2 a created pane whose -F identity is malformed is recorded durably as
 *    identity_unknown with live_pane_may_remain, is never killed or re-adopted,
 *    and every later port verb for it is refused (not false-closed).
 * P3 no adoption by socket or window name only: a replacement server on the
 *    same socket with the same session/window names is never ready or notified.
 * P4 control: a no-side-effect spawn refusal through the real runtime still
 *    seals failed with its reason and never calls terminate.
 *
 * Routing reds for L (not fixed here): L-T0-3 a bound kill is reported degraded
 * while another pane lives on the same server; L-INTEGRATION-1 the real runtime
 * seals failed a live identity_unknown worker (task-cell-runtime.ts 578-582).
 * Limit: the source lane fixture closes the controller in its own finally, so
 * whether a full supervising owner stays up while an unknown worker may be alive
 * is not observable through this seam.
 *
 * Mechanics only, same declared seams as e00-l-worker-port-ta.test.ts: `run`
 * routes tmux through the test-owned shim, an explicitly declared activation
 * stub, a test-owned `claude` on PATH. P2 malforms only the spawn's printed -F
 * output inside the test's own `run` seam (a negative tamper input); the pane
 * itself is created by real tmux. No real Claude, host, model or package claim.
 */
import { describe, it, expect, afterEach } from "bun:test";
import { spawnSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

import { TmuxTaskCellWorkerPort, processStartOf } from "../../scripts/lib/host/tmux-backend";
import { resolveAdoptedDefinition } from "../../scripts/task-cell-controller";
import { readControllerStatus, taskCellPaths } from "../../src/domains/dispatch";
import { ownedTempDir, teardownOwned } from "./support/e00-harness";
import { TEST_PROFILE_HASH, TEST_TYPE_HASH, adoptDefinition } from "./support/adopted-definition";
import { LanePort, runControllerLane } from "./support/controller-lane";
import { installTmuxShim, resolveRealTmux, tmuxOn, type TmuxShim } from "./tc/tmux-shim";

afterEach(teardownOwned);

const RUN = "run-e00-lpost";
const SESSION = "e00-lpost";
const CLAUDE_FIXTURE = path.join(__dirname, "tc", "claude-fixture.mjs");
const NODE = process.execPath.includes("bun") ? "node" : process.execPath;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const KILL_VERBS = ["kill-pane", "if-shell", "kill-window", "kill-session", "kill-server", "respawn-pane", "respawn-window"];

interface Fx { root: string; shim: TmuxShim; port: TmuxTaskCellWorkerPort; launches: Map<string, Record<string, any>>; assignmentRel: string; calls: () => string[] }

/** `claudeBody` is the test-owned `claude` script body; `mangle` rewrites only the printed spawn -F output. */
function fixture(opts: { claudeBody?: string; mangle?: (stdout: string) => string; root?: string; resolve?: (root: string, inst: any) => any } = {}): Fx {
  const root = opts.root ?? ownedTempDir("guild-e00-lpost-");
  fs.mkdirSync(path.join(root, ".guild"), { recursive: true });
  fs.writeFileSync(path.join(root, ".guild", "guild.yaml"), "schema_version: guild.root.v1\nkind: project\n");
  adoptDefinition(root, "backend");
  const bin = path.join(root, ".bin");
  const shim = installTmuxShim(root, bin);
  const host = `exec "${NODE}" "${CLAUDE_FIXTURE}" "$@"`;
  fs.writeFileSync(path.join(bin, "claude"), `#!/bin/sh\n${opts.claudeBody ?? host}\n`.replace("@HOST@", host), { mode: 0o755 });
  fs.writeFileSync(path.join(root, ".claude-fixture-mode"), "normal");
  const assignmentRel = `.guild/runs/${RUN}/task-cells/T1/attempts/1/instances/i1/assignment.json`;
  fs.mkdirSync(path.dirname(path.join(root, assignmentRel)), { recursive: true });
  fs.writeFileSync(path.join(root, assignmentRel), "{\"schema_version\":\"guild.task_assignment.v2\"}\n");
  const stubPlugin = path.join(root, ".stub-plugin");
  fs.mkdirSync(stubPlugin);
  const run = (cmd: string, args: string[], o: Record<string, unknown> = {}) => {
    const r = spawnSync(cmd === "tmux" ? path.join(bin, "tmux") : cmd, args, { encoding: "utf8", timeout: 20000, ...o } as never);
    let stdout = (r.stdout as unknown as string) ?? "";
    if (opts.mangle && cmd === "tmux" && (args[0] === "new-session" || args[0] === "new-window") && r.status === 0) stdout = opts.mangle(stdout);
    return { status: r.status, stdout, stderr: (r.stderr as unknown as string) ?? "" };
  };
  const launches = new Map<string, Record<string, any>>();
  const port = new TmuxTaskCellWorkerPort({
    cwd: root,
    sessionName: SESSION,
    snapshotDir: path.join(root, ".guild", "runs", RUN, "controller", "launch"),
    resolveDefinition: (inst) => (opts.resolve ? opts.resolve(root, inst) : resolveAdoptedDefinition(root, inst.worker_role)),
    receiptPath: (inst) => path.join(root, ".guild", "runs", RUN, "handoffs", `${inst.worker_role}-${inst.logical_task_id}.md`),
    ackArgv: ["node", path.join(root, "task-cell-ack.js")],
    recordLaunch: (iid, ev) => launches.set(iid, ev),
    run,
    env: { PATH: `${bin}:${process.env["PATH"] ?? "/usr/bin:/bin"}`, HOME: process.env["HOME"] ?? root, SHELL: "/bin/zsh", LANG: "en_US.UTF-8" },
    // DECLARED activation stub: a source checkout is refused real activation (L Q4).
    activate: () => ({ args: ["--plugin-dir", stubPlugin], pluginRoot: stubPlugin }),
  });
  const calls = () => (fs.existsSync(shim.callsLog) ? fs.readFileSync(shim.callsLog, "utf8").split("\n").filter(Boolean) : []);
  return { root, shim, port, launches, assignmentRel, calls };
}

function instance(id = "i1"): any {
  return {
    instance_id: id, run_id: RUN, logical_task_id: "T1", worker_role: "backend", host_id: "claude-code-cli",
    specialist_profile_hash: `sha256:${TEST_PROFILE_HASH}`, specialist_type_hash: `sha256:${TEST_TYPE_HASH}`,
    projection: { tools: ["read", "write"], permissions: [], recorded_losses: [] }, model_id: null,
  };
}
const spawn = (f: Fx, id = "i1") => f.port.spawn({ instance_id: id, run_id: RUN, assignment_path: f.assignmentRel, instance: instance(id) } as never);
const verbs = { ready: "ready", notifyAssignment: "notifyAssignment", terminate: "terminate" } as const;

/** Commands of the processes at or under `pid` (test-side ps). */
function treeComms(pid: number): string[] {
  const t = spawnSync("ps", ["-axww", "-o", "pid=,ppid=,comm="], { encoding: "utf8", env: { ...process.env, LC_ALL: "C" } });
  const rows = t.stdout.split("\n").map((l) => l.trim().split(/\s+/)).filter((r) => r.length >= 3)
    .map(([p, pp, ...c]) => ({ pid: Number(p), ppid: Number(pp), comm: path.basename(c.join(" ")) }));
  const out: string[] = [];
  const queue = [pid];
  while (queue.length) {
    const p = queue.shift()!;
    const row = rows.find((r) => r.pid === p);
    if (row) out.push(row.comm);
    queue.push(...rows.filter((r) => r.ppid === p).map((r) => r.pid));
  }
  return out;
}

async function until<T>(probe: () => T | null | undefined | false, limitMs = 10000): Promise<T> {
  const end = Date.now() + limitMs;
  for (;;) {
    const v = probe();
    if (v) return v;
    if (Date.now() > end) throw new Error("condition not reached in time");
    await sleep(50);
  }
}

const livePanes = (f: Fx) => {
  const r = tmuxOn(f.shim, ["list-panes", "-a", "-F", "#{pane_id} #{window_name} #{pane_pid}"]);
  return r.status === 0 ? r.stdout.split("\n").filter(Boolean) : [];
};

const tmuxAvailable = resolveRealTmux() !== null;

describe.skipIf(!tmuxAvailable)("P1 · ready() requires the declared host, not any non-shell process", () => {
  it("a non-shell pre-host helper under the recorded pane is not ready; the host that follows it is", async () => {
    const f = fixture({ claudeBody: "sleep 3\n@HOST@" });
    expect(spawn(f)).toEqual({ ok: true, reason: null });
    const id = f.port.paneIdentity("i1")!;
    // Precondition: the helper (non-shell, no injection argument) is live under the pane.
    await until(() => treeComms(id.pane_pid).includes("sleep"));
    const early = f.port.ready({ instance_id: "i1", run_id: RUN });
    expect(early.ok).toBe(false);
    expect(String(early.reason)).toMatch(/declared host process not started/);
    const late = await until(() => { const r = f.port.ready({ instance_id: "i1", run_id: RUN }); return r.ok ? r : null; }, 15000);
    expect(String(late.reason)).toMatch(/declared host process observed/);
    expect(treeComms(id.pane_pid)).not.toContain("sleep");
  });

  it("a non-shell guard that replaces the launch and never starts the host is never ready", async () => {
    const f = fixture({ claudeBody: "exec sleep 6031" });
    expect(spawn(f).ok).toBe(true);
    const id = f.port.paneIdentity("i1")!;
    // Anti-vacuity: the pane's foreground is a non-shell process (a shell-handoff-only rule would call this ready).
    await until(() => tmuxOn(f.shim, ["display-message", "-p", "-t", id.pane_id, "#{pane_current_command}"]).stdout.trim() === "sleep");
    for (let i = 0; i < 10; i++) {
      const r = f.port.ready({ instance_id: "i1", run_id: RUN });
      expect(r.ok).toBe(false);
      expect(String(r.reason)).toMatch(/declared host process not started/);
      await sleep(100);
    }
    expect(fs.existsSync(path.join(f.root, ".claude-fixture.json"))).toBe(false);
  });
});

describe.skipIf(!tmuxAvailable)("P2 · a malformed post-spawn identity is a durable known-unknown, never killed or re-adopted", () => {
  const cases: Array<[string, (s: string) => string]> = [
    ["an unparseable pane id", (s) => s.replace(/^%/, "?")],
    ["a parseable pane id with malformed server fields", (s) => { const t = s.trim().split(" "); t[2] = "x"; return t.join(" ") + "\n"; }],
  ];
  for (const [label, mangle] of cases) {
    it(`${label}: refused, recorded identity_unknown, pane left live, every later verb refused`, async () => {
      const f = fixture({ mangle });
      const out = spawn(f);
      expect(out.ok).toBe(false);
      expect(String(out.reason)).toMatch(/^spawn_identity_unavailable: a created pane may remain live and untracked/);
      const ev = f.launches.get("i1")!;
      expect(ev).toMatchObject({ schema_version: "guild.task_cell_launch_evidence.v1", instance_id: "i1", state: "identity_unknown", live_pane_may_remain: true, session: SESSION });
      expect(typeof ev.observed_spawn_output).toBe("string");
      expect(ev).not.toHaveProperty("pane");
      // The created pane is real and still live: the record is honest.
      const live = livePanes(f);
      expect(live.length).toBe(1);
      expect(live[0]!.split(" ")[1]).toBe("i1");
      expect(f.port.paneIdentity("i1")).toBeNull();
      for (const v of Object.values(verbs)) {
        const r = (f.port as any)[v]({ instance_id: "i1", run_id: RUN, assignment_path: f.assignmentRel, reason: "test" });
        expect({ v, ok: r.ok, reason: r.reason }).toEqual({ v, ok: false, reason: "no recorded pane for this instance" });
      }
      // No teardown verb was ever issued against the unknown pane.
      expect(f.calls().filter((c) => KILL_VERBS.includes(c))).toEqual([]);
      expect(livePanes(f)).toEqual(live);
    });
  }

  it("a later well-formed instance never adopts the unknown pane, and its bound kill leaves the unknown pane live", async () => {
    let first = true;
    const f = fixture({ mangle: (s) => (first ? ((first = false), s.replace(/^%/, "?")) : s) });
    expect(spawn(f, "i1").ok).toBe(false);
    const unknown = livePanes(f);
    expect(unknown.length).toBe(1);
    const unknownPaneId = unknown[0]!.split(" ")[0];
    expect(spawn(f, "i2")).toEqual({ ok: true, reason: null });
    const id2 = f.port.paneIdentity("i2")!;
    expect(id2.pane_id).not.toBe(unknownPaneId);
    expect(f.port.paneIdentity("i1")).toBeNull();
    f.port.terminate({ instance_id: "i2", run_id: RUN, reason: "test" });
    expect(processStartOf(id2.pane_pid)).toBeNull();
    expect(livePanes(f).map((l) => l.split(" ")[0])).toEqual([unknownPaneId]);
    expect(f.port.ready({ instance_id: "i1", run_id: RUN })).toEqual({ ok: false, reason: "no recorded pane for this instance" });
  });
});

describe.skipIf(!tmuxAvailable)("L routing finding L-T0-3 · bound teardown while another pane lives on the same server", () => {
  it("the recorded pane is killed and confirmed (verified), not reported degraded/unavailable", async () => {
    const f = fixture();
    expect(spawn(f, "i1").ok).toBe(true);
    expect(spawn(f, "i2").ok).toBe(true);
    const id1 = f.port.paneIdentity("i1")!;
    const id2 = f.port.paneIdentity("i2")!;
    const out = f.port.terminate({ instance_id: "i2", run_id: RUN, reason: "test" });
    // Physical facts first: i2 is gone, i1 (same server) is untouched.
    expect(processStartOf(id2.pane_pid)).toBeNull();
    expect(livePanes(f).map((l) => l.split(" ")[0])).toEqual([id1.pane_id]);
    // Red today: display-message -t <dead pane> exits 0 with an empty pane_pid while
    // the server has other panes, so paneServerView reads "unavailable".
    expect({ ok: out.ok, reason: out.reason }).toEqual({ ok: true, reason: null });
  });
});

describe.skipIf(!tmuxAvailable)("P3 · no adoption by socket or name only", () => {
  it("a replacement server on the same socket with the same session and window names is never ready or notified", async () => {
    const f = fixture();
    expect(spawn(f).ok).toBe(true);
    const id = f.port.paneIdentity("i1")!;
    await until(() => f.port.ready({ instance_id: "i1", run_id: RUN }).ok, 15000);
    // Test-side only, on the test-owned socket: end the recorded server, start a same-named replacement.
    tmuxOn(f.shim, ["kill-server"]);
    const repl = tmuxOn(f.shim, ["new-session", "-d", "-P", "-F", "#{pane_id} #{pane_pid}", "-s", SESSION, "-n", "i1", "sleep 6042"]);
    const [replPane, replPid] = repl.stdout.trim().split(" ");
    const replStart = processStartOf(Number(replPid));
    try {
      expect(replStart).not.toBeNull();
      expect(replPane).toBe(id.pane_id); // same socket, same session, same window name, same pane id
      const r = f.port.ready({ instance_id: "i1", run_id: RUN });
      expect(r.ok).toBe(false);
      expect(String(r.reason)).toMatch(/recorded pane not present \((mismatch|unavailable|absent)\)/);
      const n = f.port.notifyAssignment({ instance_id: "i1", run_id: RUN, assignment_path: f.assignmentRel });
      expect(n.ok).toBe(false);
      expect(f.port.paneIdentity("i1")).toEqual(id);
      expect(processStartOf(Number(replPid))).toBe(replStart);
    } finally {
      tmuxOn(f.shim, ["kill-server"]);
    }
  });
});

/**
 * P4 drives the REAL FilesystemTaskCellRuntime through the source controller lane
 * (support/controller-lane.ts). The lane's port delegates spawn, for this case only,
 * to a REAL TmuxTaskCellWorkerPort in the lane root (test-owned shim socket, declared
 * activation stub, declared resolveDefinition seam carrying the lane's own hashes).
 * `mangle` malforms only the printed -F identity, so the pane is physically created
 * and live while the port returns its identity_unknown refusal.
 */
type SpawnFn = (this: any, input: any) => { ok: boolean; reason: string | null };
async function laneWithSpawn(spawnImpl: SpawnFn) {
  const proto = LanePort.prototype as any;
  const had = Object.prototype.hasOwnProperty.call(proto, "spawn");
  const original = proto.spawn;
  const terminateCalls: string[] = [];
  const originalTerminate = proto.terminate;
  proto.spawn = spawnImpl;
  proto.terminate = function (this: any, input: { instance_id: string }) { terminateCalls.push(input.instance_id); return originalTerminate.call(this, input); };
  let root = "";
  let thrown: Error | null = null;
  let out: any = null;
  try {
    out = (await runControllerLane({ wrap: (_rt, r) => { root = r; } })).out;
  } catch (error) {
    thrown = error as Error;
  } finally {
    if (had) proto.spawn = original; else delete proto.spawn;
    proto.terminate = originalTerminate;
  }
  const runDir = path.join(root, ".guild", "runs", "run-e00-lane");
  const handles = path.join(runDir, "controller", "handles");
  const files = fs.existsSync(handles) ? fs.readdirSync(handles) : [];
  const iid = files.length === 1 ? files[0]!.replace(/\.json$/, "") : null;
  const ids = iid ? { run_id: "run-e00-lane", logical_task_id: "T1", attempt: 1, instance_id: iid } : null;
  const attemptAbs = ids ? path.join(root, taskCellPaths(ids).attempt_path) : null;
  const attempt = attemptAbs && fs.existsSync(attemptAbs) ? JSON.parse(fs.readFileSync(attemptAbs, "utf8")) : null;
  const handle = iid ? JSON.parse(fs.readFileSync(path.join(handles, files[0]!), "utf8")) : null;
  const status = readControllerStatus({ cwd: root, runId: "run-e00-lane", consumerPolicy: "cooperative_local" } as never) as any;
  const view = (status.instances ?? []).find((i: any) => i.instance_id === iid) ?? null;
  return { root, thrown, out, iid, handle, attempt, view, terminateCalls };
}

describe.skipIf(!tmuxAvailable)("L routing finding L-INTEGRATION-1 · a live identity-unknown worker is not sealed failed by the real runtime", () => {
  it("the attempt stays unsealed/nonterminal while the created pane is live and recorded identity_unknown", async () => {
    let real: Fx | null = null;
    let portResult: { ok: boolean; reason: string | null } | null = null;
    const r = await laneWithSpawn(function (this: any, input: any) {
      real = fixture({
        root: this.root,
        mangle: (s) => s.replace(/^%/, "?"),
        resolve: (root, inst) => {
          const d = resolveAdoptedDefinition(root, inst.worker_role);
          return "error" in d ? d : { ...d, ref: { ...d.ref, specialist_profile_hash: inst.specialist_profile_hash, specialist_type_hash: inst.specialist_type_hash } };
        },
      });
      portResult = real.port.spawn(input);
      return portResult;
    });
    const f = real as Fx | null;
    expect(f).not.toBeNull();
    expect({ thrown: portResult ? null : String(r.thrown?.message).slice(0, 300) }).toEqual({ thrown: null });
    expect(String(portResult?.reason)).toMatch(/^spawn_identity_unavailable: a created pane may remain live and untracked/);
    // Reviewed C10 interface: runLane catches the typed unknown and RETURNS a truthful
    // nonterminal orphan outcome carrying the port's own reason (no raw throw).
    expect({
      thrown: r.thrown?.message ?? null, failure_reason: r.out?.failure_reason ?? null, orphaned: r.out?.orphaned ?? null,
      awaiting: r.out?.awaiting ?? null, qualified_release: r.out?.qualified_release ?? null, teardown_confirmed: r.out?.teardown?.confirmed ?? null,
    }).toEqual({ thrown: null, failure_reason: portResult!.reason!, orphaned: true, awaiting: "teardown", qualified_release: false, teardown_confirmed: false });
    expect(r.attempt).not.toBeNull();
    // Physical precondition: the port really created a pane, it is still live, and the
    // port recorded it as a known unknown (no kill, no adoption).
    expect(f!.launches.get(r.iid!)).toMatchObject({ state: "identity_unknown", live_pane_may_remain: true });
    expect(livePanes(f!).length).toBe(1);
    expect(f!.calls().filter((c) => KILL_VERBS.includes(c))).toEqual([]);
    expect(r.terminateCalls).toEqual([]);
    expect(r.handle?.state).toBe("spawn_pending");
    // Red today (task-cell-runtime.ts 578-582): every ok:false spawn seals the attempt
    // "failed" and emits terminal "failed" with no physical teardown confirmation.
    expect({ attempt_terminal_state: r.attempt?.terminal_state ?? null, status_terminal: r.view?.attempt_terminal_state ?? null })
      .toEqual({ attempt_terminal_state: null, status_terminal: null });
  });
});

describe("P4 control · a no-side-effect spawn refusal still seals failed", () => {
  it("a pre-launch refusal (no pane created) seals the attempt failed with its reason; terminate is never called", async () => {
    const reason = "definition_hash_mismatch";
    const r = await laneWithSpawn(function () { return { ok: false, reason }; });
    expect(r.thrown?.message).toBe(reason);
    expect(r.handle?.state).toBe("spawn_pending");
    for (const k of ["pane_id", "pane_pid", "server_pid"]) expect(r.handle?.[k] ?? null).toBeNull();
    expect(r.attempt?.terminal_state).toBe("failed");
    expect(JSON.stringify(r.attempt)).toContain(reason);
    expect(r.view).toMatchObject({ attempt_terminal_state: "failed", mechanical_acceptance: "none", qualified_release: false });
    expect(r.terminateCalls).toEqual([]);
  });
});
