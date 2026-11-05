/**
 * E00-T0 · C loss-interface regressions (implementation/e00/loss-process-observation-
 * interface.v1.json), a C source integration finding SEPARATE from the formal L1
 * result. Authored BEFORE any C/L source change.
 *
 * Contract: LossTeardownPort.processStart(pid): string | null keeps its signature; a
 * string is the observed start, null is ONLY authoritative absence, and an unavailable
 * observation THROWS. recordControllerLoss catches that, records pending/orphaned
 * without a terminal seal, and keeps an already-taken teardown result. Missing expected
 * start provenance is never proof that a live pid is dead or replaced.
 *
 * Physical truth: the recorded pane process is a REAL owned live grandchild (sleep 66xx)
 * checked by pid + start. The shipping reproduction runs the real CLI adapter
 * tmuxLossTeardown() with a test-owned `ps` that fails and the test-owned tmux shim
 * first on PATH (isolated socket, no ambient server or credentials); PATH is restored
 * in finally. Contract cases use a declared LossTeardownPort whose probes really read
 * the child and throw only at the armed probe. Dead-owner claim and lane come from the
 * existing C-R1 F7 fixture shape. No product edits, no sentinel strings.
 */
import { describe, it, expect, afterEach } from "bun:test";
import { execFileSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

import { recordControllerLoss, taskCellPaths } from "../../src/domains/dispatch";
import { processStartOf } from "../../scripts/lib/host/tmux-backend";
import { tmuxLossTeardown } from "../../scripts/task-cell-controller";
import { FIXED_NOW, driveLane, makeRuntime, teardownOwned, tempRoot, type TempRoot, hostBootSession } from "./support/e00-harness";
import { installTmuxShim, resolveRealTmux } from "./tc/tmux-shim";

afterEach(teardownOwned);

/**
 * The recorded worker is an owned GRANDCHILD (detached by sh, reparented to launchd),
 * so a kill is reaped at once and `ps` never reports a zombie of the test as alive.
 * Teardown signals it only while pid + start still match.
 */
const grandchildren: Array<{ pid: number; start: string }> = [];
afterEach(() => {
  while (grandchildren.length) {
    const g = grandchildren.pop()!;
    if (processStartOf(g.pid) === g.start) { try { process.kill(g.pid, "SIGKILL"); } catch { /* gone */ } }
  }
});
function liveGrandchild(): { pid: number; start: string } {
  const pid = Number(execFileSync("/bin/sh", ["-c", `sleep ${++seq} >/dev/null 2>&1 & echo $!`], { encoding: "utf8" }).trim());
  const start = processStartOf(pid);
  if (!start) throw new Error("fixture: grandchild not observable");
  const g = { pid, start };
  grandchildren.push(g);
  return g;
}

const RUN = "run-e00-cr11";
let seq = 6600;
const SERVER = { server_pid: 434343, server_process_start: "tmux-start_time:1793100000" };

function plantDeadClaim(root: TempRoot) {
  const dir = path.join(root.cwd, ".guild", "runs", root.runId, "controller");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(dir, "controller.json"), JSON.stringify({
    schema_version: "guild.task_cell_controller.v1", run_id: root.runId,
    oracle_plan: { path: "oracle-plan/build.json", sha256: "a".repeat(64) },
    oracle_plan_decision: { path: "oracle-plan/build.decision.json", sha256: "b".repeat(64) },
    lead_binding_id: "lead-binding-e00", root_id: "fixture", source_id: "source:fixture", root_fingerprint: "c".repeat(64),
    source_revision: null, controller_instance_id: "ctl-cr11", pid: 2 ** 22 - 3, process_start: "Thu Jan  1 00:00:00 1970",
    boot_session: hostBootSession(), operator_uid: process.getuid?.() ?? 0,
    package_identity: null, package_release_version: null, package_current_package: null, package_root: null,
    worker_trust_policy: "cooperative_local", provider: "cooperative_local", host_profile_id: null, started_at: FIXED_NOW,
  }, null, 2) + "\n", { flag: "wx" });
  fs.writeFileSync(path.join(dir, "heartbeat.json"), JSON.stringify({ state: "supervising", heartbeat_at: FIXED_NOW }) + "\n");
}

/** A running lane (stopped after delivery), a dead owner, and a spawned handle recording a REAL live child. */
async function lossFixture(handleOverride: Record<string, unknown> = {}) {
  const root = tempRoot("guild-e00-cr11-", RUN);
  const d = await driveLane(root, makeRuntime(root), { logicalTaskId: "T1", role: "backend", stopAfterDeliver: true });
  plantDeadClaim(root);
  const proc = liveGrandchild();
  const handles = path.join(root.cwd, ".guild", "runs", root.runId, "controller", "handles");
  fs.mkdirSync(handles, { recursive: true });
  const handle = { schema_version: "guild.task_cell_controller_handle.v1", instance_id: d.instance.instance_id, state: "spawned",
    pane_id: "%7", pane_pid: proc.pid, pane_process_start: proc.start, ...SERVER, ...handleOverride };
  fs.writeFileSync(path.join(handles, `${d.instance.instance_id}.json`), JSON.stringify(handle, null, 2) + "\n");
  const ids = { run_id: root.runId, logical_task_id: "T1", attempt: 1, instance_id: d.instance.instance_id };
  const attempt = () => JSON.parse(fs.readFileSync(path.join(root.cwd, taskCellPaths(ids).attempt_path), "utf8"));
  return { root, proc, ids, attempt, alive: () => processStartOf(proc.pid) === proc.start };
}

type Probe = "server_mismatch" | "pre_action" | "post_action";
/** A declared port that really reads the child; processStart THROWS (unavailable) only at the armed probe. */
function port(proc: { pid: number; start: string }, o: { serverMatches: boolean; throwAt?: Probe; killOnTerminate?: boolean; blank?: { at: Probe; value: string } }) {
  const calls: string[] = [];
  let phase: "before" | "after" = "before";
  let thrown = 0;
  let blanks = 0;
  const p = {
    serverIdentity: () => { calls.push("serverIdentity"); return o.serverMatches ? { pid: SERVER.server_pid, process_start: SERVER.server_process_start } : null; },
    panePid: (id: string) => { calls.push(`panePid:${id}`); return proc.pid; },
    processStart: (pid: number) => {
      calls.push(`processStart:${phase}`);
      const armed = o.throwAt === "server_mismatch" || (o.throwAt === "pre_action" && phase === "before") || (o.throwAt === "post_action" && phase === "after");
      if (armed) { thrown++; throw Object.assign(new Error("process table unavailable"), { code: "EIO" }); }
      const b = o.blank;
      if (b && (b.at === "server_mismatch" || (b.at === "pre_action" && phase === "before") || (b.at === "post_action" && phase === "after"))) { blanks++; return b.value; }
      return processStartOf(pid);
    },
    terminatePane: () => {
      calls.push("terminatePane");
      phase = "after";
      if (o.killOnTerminate) {
        try { process.kill(proc.pid, "SIGKILL"); } catch { /* gone */ }
        const until = Date.now() + 2000;
        while (processStartOf(proc.pid) === proc.start && Date.now() < until) { /* wait for real death */ }
      }
      return { ok: true, confirmed: true, degraded: false, polls: 1, error: null, identity_check: "verified" as const };
    },
  };
  return { p, calls, thrownCount: () => thrown, blankCount: () => blanks };
}

function lossObservation(f: Awaited<ReturnType<typeof lossFixture>>, run: () => any) {
  let out: any = null;
  let threw: string | null = null;
  try { out = run(); } catch (e) { threw = (e as Error).message; }
  const a = f.attempt();
  const obs = (out?.attempts ?? []).find((x: any) => x.instance_id === f.ids.instance_id) ?? null;
  return { out, threw, attempt: a, obs };
}

describe("C11-loss · an unavailable process observation never seals a live worker", () => {
  it.skipIf(resolveRealTmux() === null)("shipping CLI adapter: a failing ps with no tmux server answering is not proof of death", async () => {
    const f = await lossFixture();
    const bin = path.join(f.root.cwd, ".fault-bin");
    installTmuxShim(f.root.cwd, bin);
    fs.writeFileSync(path.join(bin, "ps"), "#!/bin/sh\necho 'ps: sysctl: Operation not permitted' >&2\nexit 1\n", { mode: 0o755 });
    // Activation: the PATH ps the adapter resolves really fails with an error.
    const probe = execFileSync("/bin/sh", ["-c", `PATH="${bin}:$PATH" ps -o lstart= -p ${f.proc.pid} 2>&1; echo "rc=$?"`], { encoding: "utf8" });
    expect(probe).toMatch(/Operation not permitted[\s\S]*rc=1/);
    const saved = process.env["PATH"];
    process.env["PATH"] = `${bin}:${saved ?? "/usr/bin:/bin"}`;
    let r;
    try { r = lossObservation(f, () => recordControllerLoss({ cwd: f.root.cwd, runId: f.root.runId, now: () => FIXED_NOW, teardown: tmuxLossTeardown() })); }
    finally { process.env["PATH"] = saved; }
    expect(f.alive()).toBe(true);
    expect({ threw: r.threw, terminal_state: r.attempt.terminal_state, orphaned: r.attempt.orphaned }).toEqual({ threw: null, terminal_state: null, orphaned: true });
  });

  const probes: Array<[Probe, boolean]> = [["server_mismatch", false], ["pre_action", true], ["post_action", true]];
  for (const [probe, serverMatches] of probes) {
    it(`${probe} probe throws unavailable: recorded pending/orphaned, never sealed, live child untouched`, async () => {
      const f = await lossFixture();
      const t = port(f.proc, { serverMatches, throwAt: probe });
      const r = lossObservation(f, () => recordControllerLoss({ cwd: f.root.cwd, runId: f.root.runId, now: () => FIXED_NOW, teardown: t.p }));
      // Preconditions: the armed probe really threw; the child is alive.
      expect(t.thrownCount()).toBeGreaterThan(0);
      expect(f.alive()).toBe(true);
      expect({
        threw: r.threw, ok: r.out?.ok ?? null, terminal_state: r.attempt.terminal_state, orphaned: r.attempt.orphaned,
        killed_before_probe: probe === "pre_action" ? t.calls.includes("terminatePane") : false,
        teardown_retained: probe === "post_action" ? r.obs?.teardown != null : true,
      }).toEqual({ threw: null, ok: true, terminal_state: null, orphaned: true, killed_before_probe: false, teardown_retained: true });
    });
  }

  it("missing expected start provenance with a live pid: kept pending, never sealed as gone", async () => {
    const f = await lossFixture({ pane_process_start: undefined });
    const t = port(f.proc, { serverMatches: false });
    const r = lossObservation(f, () => recordControllerLoss({ cwd: f.root.cwd, runId: f.root.runId, now: () => FIXED_NOW, teardown: t.p }));
    expect(f.alive()).toBe(true);
    expect({ threw: r.threw, terminal_state: r.attempt.terminal_state, orphaned: r.attempt.orphaned }).toEqual({ threw: null, terminal_state: null, orphaned: true });
  });
});

// C Q2: an empty or whitespace-only observed start is an unavailable observation,
// never death and never an identity verdict; the live recorded process is untouched.
describe("C11-loss · a blank observed start is unavailable, never false death", () => {
  const blanks: Array<[string, string]> = [["empty", ""], ["whitespace", "  \t "]];
  const probes: Array<[Probe, boolean]> = [["server_mismatch", false], ["pre_action", true], ["post_action", true]];
  for (const [label, value] of blanks) {
    for (const [probe, serverMatches] of probes) {
      it(`${label} start at the ${probe} probe: recorded pending/orphaned, never sealed, no kill on a failed pre-action read`, async () => {
        const f = await lossFixture();
        const t = port(f.proc, { serverMatches, blank: { at: probe, value } });
        const r = lossObservation(f, () => recordControllerLoss({ cwd: f.root.cwd, runId: f.root.runId, now: () => FIXED_NOW, teardown: t.p }));
        // Preconditions: the blank observation was really returned; the child is alive.
        expect(t.blankCount()).toBeGreaterThan(0);
        expect(f.alive()).toBe(true);
        expect({
          threw: r.threw, ok: r.out?.ok ?? null, terminal_state: r.attempt.terminal_state, orphaned: r.attempt.orphaned,
          killed_before_probe: probe === "pre_action" ? t.calls.includes("terminatePane") : false,
          teardown_retained: probe === "post_action" ? r.obs?.teardown != null : true,
        }).toEqual({ threw: null, ok: true, terminal_state: null, orphaned: true, killed_before_probe: false, teardown_retained: true });
        expect(f.alive()).toBe(true);
      });
    }
  }
});

describe("C11-loss controls", () => {
  it("authoritative absence (process really gone, null) with the server changed is sealed", async () => {
    const f = await lossFixture();
    process.kill(f.proc.pid, "SIGKILL");
    for (let i = 0; i < 50 && f.alive(); i++) await new Promise((r) => setTimeout(r, 20));
    expect(f.alive()).toBe(false);
    const t = port(f.proc, { serverMatches: false });
    const r = lossObservation(f, () => recordControllerLoss({ cwd: f.root.cwd, runId: f.root.runId, now: () => FIXED_NOW, teardown: t.p }));
    expect({ threw: r.threw, terminal_state: r.attempt.terminal_state, killed: t.calls.includes("terminatePane") }).toEqual({ threw: null, terminal_state: "failed", killed: false });
  });

  it("normal verified teardown of the recorded live process is sealed after real death", async () => {
    const f = await lossFixture();
    const t = port(f.proc, { serverMatches: true, killOnTerminate: true });
    const r = lossObservation(f, () => recordControllerLoss({ cwd: f.root.cwd, runId: f.root.runId, now: () => FIXED_NOW, teardown: t.p }));
    expect({ threw: r.threw, killed: t.calls.includes("terminatePane"), terminal_state: r.attempt.terminal_state, alive: f.alive() })
      .toEqual({ threw: null, killed: true, terminal_state: "failed", alive: false });
  });
});
