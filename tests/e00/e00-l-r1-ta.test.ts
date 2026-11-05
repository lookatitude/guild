/**
 * E00-T0 · focused reds for the five L1 findings (review/G-lane-E00-L/result-r1.json),
 * authored BEFORE any L source change against the frozen L candidate.
 *
 * L1-F1 launcher --reap / --dismiss-completed must not kill a replacement pane that
 *       reuses the recorded pane id (replacement before the call, and AT the kill via
 *       the shim's kill/if-shell hold barrier); mismatches stay unconfirmed.
 * L1-F2 unreadable session.json, a missing pane entry, or a "(unknown)" pane id for a
 *       live worker never seal a nonterminal attempt terminal (no fabricated absence).
 * L1-F3 a failed TmuxTeamBackend.spawn never kills a pre-existing, test-owned target
 *       session/window it did not create.
 * L1-F4 an unreadable show-environment never authorizes creation on a server whose
 *       global environment holds a fake canary binding (isolated owned server only;
 *       the canary value is never printed).
 * L1-F5 a ps error is "unavailable", never death: a live owned process is not
 *       reported torn down; authoritative absence and normal teardown still confirm.
 *
 * Seams: every tmux call goes through the test-owned shim (isolated socket, ledger
 * ownership, hold barrier); ps/tmux faults are injected only through the declared
 * `run` transport and counted (activation is a precondition); the launcher runs as
 * its real CLI with the shim first on PATH. Physical truth is real owned processes
 * (sleep 65xx) checked by pid + start. No product edits, no ambient tmux server.
 */
import { describe, it, expect, afterEach } from "bun:test";
import { spawn as spawnChild, spawnSync } from "child_process";
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";

import { TmuxTaskCellWorkerPort, TmuxTeamBackend, processStartOf, terminateBoundPane, tmuxServerIdentity } from "../../scripts/lib/host/tmux-backend";
import { resolveAdoptedDefinition } from "../../scripts/task-cell-controller";
import {
  buildAcceptance, buildTaskCell, markAttemptOrphaned, readAttemptForInstance, runDeterministicFloor, writeAcceptanceRecord, writeTaskCell,
  type TaskCellDispatchInput,
} from "../../src/domains/dispatch";
import { taskCellPaths } from "../../src/domains/dispatch";
import { loadRunBinding, mintRunBinding } from "../../src/domains/lifecycle";
import { PLUGIN, ownChild, ownedTempDir, teardownOwned } from "./support/e00-harness";
import { TEST_PROFILE_HASH, TEST_TYPE_HASH, adoptDefinition } from "./support/adopted-definition";
import { installTmuxShim, resolveRealTmux, tmuxOn, type TmuxShim } from "./tc/tmux-shim";

afterEach(teardownOwned);

const tmuxAvailable = resolveRealTmux() !== null;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let seq = 6500;

interface Env { root: string; bin: string; shim: TmuxShim; run: (cmd: string, args: string[], o?: Record<string, unknown>) => { status: number | null; stdout: string; stderr: string } }
function env(prefix = "guild-e00-lr1-"): Env {
  const root = ownedTempDir(prefix);
  fs.mkdirSync(path.join(root, ".guild"), { recursive: true });
  fs.writeFileSync(path.join(root, ".guild", "guild.yaml"), "schema_version: guild.root.v1\nkind: project\n");
  const bin = path.join(root, ".bin");
  const shim = installTmuxShim(root, bin);
  // The pane runs `claude` from PATH: a fixed fake, so the pane outlives the spawn on a host without Claude.
  fs.writeFileSync(path.join(bin, "claude"), "#!/bin/sh\nexec sleep 6950\n", { mode: 0o755 });
  const run = (cmd: string, args: string[], o: Record<string, unknown> = {}) => {
    const r = spawnSync(cmd === "tmux" ? path.join(bin, "tmux") : cmd, args, { encoding: "utf8", timeout: 20000, ...o } as never);
    return { status: r.status, stdout: (r.stdout as unknown as string) ?? "", stderr: (r.stderr as unknown as string) ?? "" };
  };
  return { root, bin, shim, run };
}

/** A pane on the owned server running a fresh sleep; returns its id, pid and start. */
function ownedPane(e: Env, session: string): { pane_id: string; pid: number; start: string } {
  const out = e.run("tmux", ["new-session", "-d", "-P", "-F", "#{pane_id} #{pane_pid}", "-s", session, `sleep ${++seq}`]);
  if (out.status !== 0) throw new Error(`fixture: owned pane not created: ${out.stderr}`);
  const [pane_id, pid] = out.stdout.trim().split(" ");
  return { pane_id: pane_id!, pid: Number(pid), start: processStartOf(Number(pid))! };
}
const alive = (p: { pid: number; start: string }) => processStartOf(p.pid) === p.start;
const shimCalls = (e: Env) => (fs.existsSync(e.shim.callsLog) ? fs.readFileSync(e.shim.callsLog, "utf8").split("\n").filter(Boolean) : []);

// ── L1-F5 ──

describe.skipIf(!tmuxAvailable)("L1-F5 · a process-table error is unavailable, never confirmed death", () => {
  function deadServerIdentity(e: Env) {
    ownedPane(e, "holder");
    const server = tmuxServerIdentity(e.run)!;
    tmuxOn(e.shim, ["kill-server"]);
    return server;
  }

  it("no server answers and ps errors: the live recorded process is not reported torn down", () => {
    const e = env();
    const server = deadServerIdentity(e);
    const child = ownChild(spawnChild("sleep", [String(++seq)], { stdio: "ignore" }), e.root);
    const proc = { pid: child.pid!, start: processStartOf(child.pid!)! };
    let injected = 0;
    const run = (cmd: string, args: string[], o: Record<string, unknown> = {}) => {
      if (cmd === "ps") { injected++; return { status: 1, stdout: "", stderr: "ps: sysctl: Operation not permitted" }; }
      return e.run(cmd, args, o);
    };
    const out = terminateBoundPane("%0", { pane_id: "%0", pane_pid: proc.pid, pane_process_start: proc.start, server_pid: server.pid, server_process_start: server.process_start }, { run });
    // Preconditions: the fault was exercised, no server answers, the process is alive.
    expect(injected).toBeGreaterThan(0);
    expect(tmuxServerIdentity(e.run)).toBeNull();
    expect(alive(proc)).toBe(true);
    expect({ ok: out.ok, confirmed: out.confirmed, identity_check: out.identity_check }).toEqual({ ok: false, confirmed: false, identity_check: "unavailable" });
    expect(alive(proc)).toBe(true);
  });

  it("control: authoritative absence (process really gone, real ps) still confirms", async () => {
    const e = env();
    const server = deadServerIdentity(e);
    const child = ownChild(spawnChild("sleep", [String(++seq)], { stdio: "ignore" }), e.root);
    const proc = { pid: child.pid!, start: processStartOf(child.pid!)! };
    child.kill("SIGKILL");
    for (let i = 0; i < 50 && alive(proc); i++) await sleep(20);
    expect(alive(proc)).toBe(false);
    const out = terminateBoundPane("%0", { pane_id: "%0", pane_pid: proc.pid, pane_process_start: proc.start, server_pid: server.pid, server_process_start: server.process_start }, { run: e.run });
    expect({ ok: out.ok, confirmed: out.confirmed, identity_check: out.identity_check }).toEqual({ ok: true, confirmed: true, identity_check: "verified" });
  });

  it("control: normal bound teardown of a live recorded pane confirms and kills it", () => {
    const e = env();
    const pane = ownedPane(e, "worker");
    const server = tmuxServerIdentity(e.run)!;
    const out = terminateBoundPane(pane.pane_id, { pane_id: pane.pane_id, pane_pid: pane.pid, pane_process_start: pane.start, server_pid: server.pid, server_process_start: server.process_start }, { run: e.run });
    expect({ ok: out.ok, confirmed: out.confirmed, identity_check: out.identity_check }).toEqual({ ok: true, confirmed: true, identity_check: "verified" });
    expect(alive(pane)).toBe(false);
  });
});

// ── L1-F4 ──

function workerPort(e: Env, run: Env["run"], recordLaunch?: (id: string, evidence: unknown) => void) {
  adoptDefinition(e.root, "backend");
  const stubPlugin = path.join(e.root, ".stub-plugin");
  fs.mkdirSync(stubPlugin, { recursive: true });
  const assignmentRel = ".guild/runs/run-e00-lr1/task-cells/T1/attempts/1/instances/i1/assignment.json";
  fs.mkdirSync(path.dirname(path.join(e.root, assignmentRel)), { recursive: true });
  fs.writeFileSync(path.join(e.root, assignmentRel), "{\"schema_version\":\"guild.task_assignment.v2\"}\n");
  const port = new TmuxTaskCellWorkerPort({
    cwd: e.root, sessionName: "e00-lr1-port",
    snapshotDir: path.join(e.root, ".guild", "runs", "run-e00-lr1", "controller", "launch"),
    resolveDefinition: (inst) => resolveAdoptedDefinition(e.root, inst.worker_role),
    receiptPath: (inst) => path.join(e.root, ".guild", "runs", "run-e00-lr1", "handoffs", `${inst.worker_role}-${inst.logical_task_id}.md`),
    ackArgv: ["node", path.join(e.root, "task-cell-ack.js")],
    run,
    env: { PATH: `${e.bin}:${process.env["PATH"] ?? "/usr/bin:/bin"}`, HOME: process.env["HOME"] ?? e.root, SHELL: fs.existsSync("/bin/zsh") ? "/bin/zsh" : "/bin/sh", LANG: "en_US.UTF-8" },
    activate: () => ({ args: ["--plugin-dir", stubPlugin], pluginRoot: stubPlugin }),
    ...(recordLaunch ? { recordLaunch } : {}),
  });
  const input = {
    instance_id: "i1", run_id: "run-e00-lr1", assignment_path: assignmentRel,
    instance: {
      instance_id: "i1", run_id: "run-e00-lr1", logical_task_id: "T1", worker_role: "backend", host_id: "claude-code-cli",
      specialist_profile_hash: `sha256:${TEST_PROFILE_HASH}`, specialist_type_hash: `sha256:${TEST_TYPE_HASH}`,
      projection: { tools: ["read", "write"], permissions: [], recorded_losses: [] }, model_id: null,
    },
  };
  return { port, spawn: () => port.spawn(input as never) };
}

/** Seed the owned server's GLOBAL env with a fake canary binding (value never printed). */
function seedCanary(e: Env): void {
  ownedPane(e, "holder");
  const canary = `e00-canary-${crypto.randomBytes(8).toString("hex")}`;
  expect(e.run("tmux", ["set-environment", "-g", "GUILD_RUN_BINDING_REF", canary]).status).toBe(0);
}
const creates = (e: Env, from: number) => shimCalls(e).slice(from).filter((c) => c === "new-session" || c === "new-window").length;

describe.skipIf(!tmuxAvailable)("L1-F4 · an unreadable server environment never authorizes creation", () => {
  const faults: Array<[string, () => { status: number | null; stdout: string; stderr: string }]> = [
    ["show-environment unavailable (no exit status)", () => ({ status: null, stdout: "", stderr: "" })],
    ["show-environment connection error", () => ({ status: 1, stdout: "", stderr: "error connecting to server (Permission denied)" })],
    ["show-environment empty output", () => ({ status: 0, stdout: "", stderr: "" })],
    ["show-environment other stderr", () => ({ status: 1, stdout: "", stderr: "unexpected tmux failure" })],
  ];
  for (const [label, fault] of faults) {
    it(`${label}: spawn refused, no pane created`, () => {
      const e = env();
      seedCanary(e);
      let injected = 0;
      const run = (cmd: string, args: string[], o: Record<string, unknown> = {}) => {
        if (cmd === "tmux" && args[0] === "show-environment") { injected++; return fault(); }
        return e.run(cmd, args, o);
      };
      const { port, spawn } = workerPort(e, run);
      const before = shimCalls(e).length;
      const out = spawn();
      expect(injected).toBeGreaterThan(0);
      expect({ ok: out.ok, creates: creates(e, before), identity: port.paneIdentity("i1") }).toEqual({ ok: false, creates: 0, identity: null });
    });
  }

  it("control: a readable environment holding the canary refuses creation", () => {
    const e = env();
    seedCanary(e);
    const { spawn } = workerPort(e, e.run);
    const before = shimCalls(e).length;
    const out = spawn();
    expect({ ok: out.ok, credential_reason: /^credential_env_present_in_tmux_server/.test(String(out.reason)), creates: creates(e, before) })
      .toEqual({ ok: false, credential_reason: true, creates: 0 });
  });

  it("control: a readable environment without the binding allows creation", () => {
    const e = env();
    ownedPane(e, "holder");
    const { spawn, port } = workerPort(e, e.run);
    const out = spawn();
    expect(out).toEqual({ ok: true, reason: null });
    expect(port.paneIdentity("i1")).not.toBeNull();
  });

  const absent: Array<[string, () => { status: number | null; stdout: string; stderr: string }]> = [
    ["status 0 '-GUILD_RUN_BINDING_REF' (removed)", () => ({ status: 0, stdout: "-GUILD_RUN_BINDING_REF\n", stderr: "" })],
    ["nonzero 'unknown variable'", () => ({ status: 1, stdout: "", stderr: "unknown variable: GUILD_RUN_BINDING_REF\n" })],
    ["nonzero 'no server running on'", () => ({ status: 1, stdout: "", stderr: "no server running on /private/tmp/e00/sock\n" })],
  ];
  for (const [label, answer] of absent) {
    const preCreateOnly = label.includes("no server running");
    it(`control: authoritative ${label} allows creation on a server without the binding`, () => {
      const e = env();
      ownedPane(e, "holder");
      const base = shimCalls(e).length;
      let injected = 0;
      const stages: Array<{ creates_before: number; injected: boolean }> = [];
      const run = (cmd: string, args: string[], o: Record<string, unknown> = {}) => {
        if (cmd === "tmux" && args[0] === "show-environment") {
          const createsBefore = creates(e, base);
          const inject = !preCreateOnly || createsBefore === 0;
          stages.push({ creates_before: createsBefore, injected: inject });
          if (inject) { injected++; return answer(); }
        }
        return e.run(cmd, args, o);
      };
      const { spawn, port } = workerPort(e, run);
      const out = spawn();
      expect(injected).toBeGreaterThan(0);
      if (preCreateOnly) {
        // Preconditions: injected only before any create; every post-create read was real.
        expect({ first_pre: stages[0]?.creates_before === 0 && stages[0]?.injected === true, post_all_real: stages.filter((x) => x.creates_before > 0).every((x) => !x.injected), post_reads: stages.some((x) => x.creates_before > 0) })
          .toEqual({ first_pre: true, post_all_real: true, post_reads: true });
      }
      expect({ ok: out.ok, identity: port.paneIdentity("i1") !== null }).toEqual({ ok: true, identity: true });
    });
  }

  it("post-create 'no server running' does not observe the created target: spawn_effect unknown, identity retained, no verified launch", () => {
    const e = env();
    ownedPane(e, "holder");
    const base = shimCalls(e).length;
    const stages: Array<{ creates_before: number; injected: boolean }> = [];
    const run = (cmd: string, args: string[], o: Record<string, unknown> = {}) => {
      if (cmd === "tmux" && args[0] === "show-environment") {
        const createsBefore = creates(e, base);
        stages.push({ creates_before: createsBefore, injected: createsBefore > 0 });
        if (createsBefore > 0) return { status: 1, stdout: "", stderr: "no server running on /private/tmp/e00/sock\n" };
      }
      return e.run(cmd, args, o);
    };
    const recorded: string[] = [];
    const { spawn, port } = workerPort(e, run, (id) => { recorded.push(id); });
    const out = spawn();
    const identity = port.paneIdentity("i1");
    // Preconditions: the pre-create probe was real; a real create happened; the post-create read was injected.
    expect({ first_real_pre: stages[0]?.creates_before === 0 && stages[0]?.injected === false, created: creates(e, base) > 0, post_injected: stages.some((x) => x.creates_before > 0 && x.injected) })
      .toEqual({ first_real_pre: true, created: true, post_injected: true });
    expect({
      ok: out.ok, spawn_effect: (out as { spawn_effect?: unknown }).spawn_effect ?? null,
      identity_retained: identity !== null,
      worker_alive: identity !== null && alive({ pid: identity.pane_pid, start: identity.pane_process_start }),
      verified_launch_recorded: recorded.length > 0,
    }).toEqual({ ok: false, spawn_effect: "unknown", identity_retained: true, worker_alive: true, verified_launch_recorded: false });
  });
});

// ── L1-F3 ──

describe.skipIf(!tmuxAvailable)("L1-F3 · a failed team launch never deletes a target it did not create", () => {
  it("new-session mode: create fails on an existing test-owned session; that session and its process survive", () => {
    const e = env();
    const existing = ownedPane(e, "e00-target");
    const backend = new TmuxTeamBackend({ run: e.run, env: process.env });
    const out = backend.spawn({ mode: "new-session", targetName: "e00-target", commands: [{ argv: ["tmux", "new-session", "-d", "-s", "e00-target", `sleep ${++seq}`], display: "create" }] });
    expect(out.ok).toBe(false);
    expect(out.failedCommand?.display).toBe("create");
    expect({ session: tmuxOn(e.shim, ["has-session", "-t", "e00-target"]).status === 0, process_alive: alive(existing) }).toEqual({ session: true, process_alive: true });
  });

  it("in-session mode: the window create fails; an existing test-owned window with that name survives", () => {
    const e = env();
    ownedPane(e, "holder");
    const win = e.run("tmux", ["new-window", "-d", "-P", "-F", "#{pane_id} #{pane_pid}", "-t", "holder:", "-n", "e00-win", `sleep ${++seq}`]);
    const [, pid] = win.stdout.trim().split(" ");
    const existing = { pid: Number(pid), start: processStartOf(Number(pid))! };
    const backend = new TmuxTeamBackend({ run: e.run, env: process.env });
    const out = backend.spawn({ mode: "in-session", targetName: "e00-win", commands: [{ argv: ["tmux", "new-window", "-d", "-t", "e00-no-such-session:", "-n", "e00-win", `sleep ${++seq}`], display: "create" }] });
    expect(out.ok).toBe(false);
    expect(out.failedCommand?.display).toBe("create");
    const names = tmuxOn(e.shim, ["list-windows", "-a", "-F", "#{window_name}"]).stdout.split("\n").filter(Boolean);
    expect({ window: names.includes("e00-win"), process_alive: alive(existing) }).toEqual({ window: true, process_alive: true });
  });

  it("later-command failure: only the captured session is removed; a same-name replacement survives", () => {
    const e = env();
    let captured: { session_id: string; pid: number; start: string } | null = null;
    let replacement: { pane_id: string; pid: number; start: string } | null = null;
    const run = (cmd: string, args: string[], o: Record<string, unknown> = {}) => {
      if (cmd === "tmux" && args[0] === "e00-failing-step") {
        // Between the captured create and the failing step, the name moves to an owned replacement.
        expect(e.run("tmux", ["rename-session", "-t", captured!.session_id, "e00-moved"]).status).toBe(0);
        replacement = ownedPane(e, "e00-cap");
        return { status: 1, stdout: "", stderr: "e00 injected later-command failure" };
      }
      const r = e.run(cmd, args, o);
      if (cmd === "tmux" && args[0] === "new-session" && args.includes("e00-cap") && r.status === 0 && captured === null) {
        const [session_id] = r.stdout.trim().split(" ");
        const pid = Number(e.run("tmux", ["list-panes", "-t", session_id!, "-F", "#{pane_pid}"]).stdout.trim());
        captured = { session_id: session_id!, pid, start: processStartOf(pid)! };
      }
      return r;
    };
    const backend = new TmuxTeamBackend({ run, env: process.env });
    const out = backend.spawn({ mode: "new-session", targetName: "e00-cap", commands: [
      { argv: ["tmux", "new-session", "-d", "-P", "-F", "#{session_id} #{window_id} #{pid} #{start_time}", "-s", "e00-cap", `sleep ${++seq}`], display: "create" },
      { argv: ["tmux", "e00-failing-step"], display: "later" },
    ] });
    expect(out.failedCommand?.display).toBe("later");
    expect(captured).not.toBeNull();
    expect({ captured_alive: alive(captured!), replacement_alive: alive(replacement!) }).toEqual({ captured_alive: false, replacement_alive: true });
  });
});

// ── launcher fixtures (L1-F1, L1-F2) ──

const SEED_NOW = () => "2026-07-15T00:00:00.000Z";
function disp(runId: string, logicalTaskId: string, attempt = 1): TaskCellDispatchInput {
  return {
    runId, logicalTaskId, taskRunId: `${logicalTaskId}.tr1`, attempt, attemptId: `${logicalTaskId}.att${attempt}`, instanceId: `${logicalTaskId}.a${attempt}.i1`,
    cellId: `cell-${logicalTaskId}`, goalId: "goal", phaseId: "build", stepId: logicalTaskId, teamId: "guild", workerRole: "backend",
    specialistTypeId: "backend", specialistTypeVersion: "1", specialistTypeHash: "sha256:type", specialistProfileId: "backend", specialistProfileHash: "sha256:profile",
    contextBundleId: `.guild/context/${runId}/${logicalTaskId}.md`, contextBundleHash: "sha256:ctx", hostId: "claude-code-cli", adapterId: "claude-code-cli@1",
    hostCapabilitiesHash: "sha256:caps", substrate: "tmux", modelTier: "mid", objective: `implement ${logicalTaskId}`, nonGoals: [], scopePaths: [],
    outputSchema: "guild.handoff_receipt.v1", acceptanceTests: [], dependencies: [], projection: { tools: ["read", "write"], permissions: [], recorded_losses: [] },
    autonomyPolicy: "supervised", budgets: { tokens: null, wall_clock_ms: null, cost_usd: null }, deadline: null, leadBindingId: "lead-binding", now: SEED_NOW,
    ...(attempt > 1 ? { previousAttemptId: `${logicalTaskId}.att${attempt - 1}`, retryReason: "relaunch after an orphaned attempt" } : {}),
  };
}

/** One orphaned (reap), accepted (dismiss) or live attempt for backend/<task> in `root`. */
function seedAttempt(root: string, runId: string, kind: "orphan" | "accepted" | "live", taskId = "T1", attemptNo = 1) {
  const bind = { binding_ref: (loadRunBinding({ root, run_id: runId }) ?? mintRunBinding({ root, run_id: runId })).binding_ref };
  const cell = buildTaskCell(disp(runId, taskId, attemptNo));
  writeTaskCell(root, cell, bind);
  const ids = { run_id: runId, logical_task_id: taskId, attempt: attemptNo, instance_id: `${taskId}.a${attemptNo}.i1` };
  if (kind === "accepted") {
    const validation = runDeterministicFloor({
      assignment: cell.assignment,
      submitted: { receipt_id: "r1", receipt_path: "handoffs/x.md", schema_valid: true, claimed_changed_files: [], acceptance_tests_passed: [], submitted_at: SEED_NOW() },
      validationResultId: "val-1", now: SEED_NOW,
    });
    writeAcceptanceRecord(root, buildAcceptance({
      validation, acceptancePolicyVersion: "1.0.0", authoritiesRequired: ["deterministic_floor", "team_lead"],
      authoritiesObserved: [
        { authority: "deterministic_floor", decision: "accepted", at: SEED_NOW(), reason: null },
        { authority: "team_lead", decision: "accepted", at: SEED_NOW(), reason: null },
      ],
      now: SEED_NOW,
    }), bind);
  } else if (kind === "orphan") {
    markAttemptOrphaned(root, ids, bind);
  }
  return ids;
}

function writeSession(root: string, runId: string, body: string | object): void {
  const dir = path.join(root, ".guild", "runs", runId, "agent-team");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "session.json"), typeof body === "string" ? body : JSON.stringify(body, null, 2));
}
const sessionWith = (runId: string, paneId: string) => ({ run_id: runId, backend: "tmux", teammate_panes: [{ specialist: "backend", task_id: "T1", pane_id: paneId, host_kind: "claude", adapter_version: "1" }] });

/** The author-plane runner for the launcher CLI (process.execPath is node under bun test). */
const BUN = (globalThis as { Bun?: { which(n: string): string | null } }).Bun?.which("bun") ?? "bun";
function launcherArgs(op: "--reap" | "--dismiss-completed", root: string, runId: string) { return [path.join(PLUGIN, "scripts", "agent-team-launcher.ts"), op, "--run-id", runId, "--cwd", root]; }
function launcherEnv(e: Env): Record<string, string> {
  return { PATH: `${e.bin}:${process.env["PATH"] ?? "/usr/bin:/bin"}`, HOME: process.env["HOME"] ?? e.root, GUILD_PLUGIN_ROOT: PLUGIN };
}
function launcher(e: Env, op: "--reap" | "--dismiss-completed", runId: string) {
  return spawnSync(BUN, launcherArgs(op, e.root, runId), { cwd: e.root, env: launcherEnv(e), encoding: "utf8", timeout: 120000 });
}
const notSealed = (root: string, ids: ReturnType<typeof seedAttempt>) => {
  const a = readAttemptForInstance(root, ids);
  return { attempt_present: a !== null, terminal_state: a ? a.terminal_state : "missing_record" };
};

/** End the recorded server and start an owned replacement whose first pane reuses the id. */
function replaceServer(e: Env): { pane_id: string; pid: number; start: string } {
  tmuxOn(e.shim, ["kill-server"]);
  return ownedPane(e, "replacement");
}

// ── approved per-instance pane carrier (implementation/e00/l-pane-carrier-approved-r1.json) ──

interface CarrierPane { pane_id: string; pid: number; start: string; window_id: string; session_id: string; server_pid: number; server_start: string; title: string }

/** A real owned pane created the way the approved capture rule reads it; every field is observed, none invented. */
function carrierPane(e: Env, session: string, title: string): CarrierPane {
  const out = e.run("tmux", ["new-session", "-d", "-P", "-F", "#{session_id} #{window_id} #{pid} #{start_time}", "-s", session, `sleep ${++seq}`]);
  if (out.status !== 0) throw new Error(`fixture: carrier pane not created: ${out.stderr}`);
  const [session_id, window_id, spid, sstart] = out.stdout.trim().split(" ");
  expect(e.run("tmux", ["select-pane", "-t", window_id!, "-T", title]).status).toBe(0);
  const lp = e.run("tmux", ["list-panes", "-t", window_id!, "-F", "#{pid} #{start_time} #{window_id} #{pane_id} #{pane_pid} #{pane_title}"]);
  const [lpid, lstart, lwin, pane_id, pane_pid, ltitle] = lp.stdout.trim().split(" ");
  expect({ lpid, lstart, lwin, ltitle }).toEqual({ lpid: spid, lstart: sstart, lwin: window_id, ltitle: title });
  return { pane_id: pane_id!, pid: Number(pane_pid), start: processStartOf(Number(pane_pid))!, window_id: window_id!, session_id: session_id!, server_pid: Number(spid), server_start: `tmux-start_time:${sstart}`, title };
}

type Member = { logical_task_id: string; attempt: number; instance_id: string; dispatch_key: string; specialist: string };
const memberOf = (ids: { logical_task_id: string; attempt: number; instance_id: string }): Member =>
  ({ logical_task_id: ids.logical_task_id, attempt: ids.attempt, instance_id: ids.instance_id, dispatch_key: `backend--${ids.logical_task_id}--a${ids.attempt}`, specialist: "backend" });

/** Write <instance_dir>/pane-identity.json (wx, 0600) for `ids`; `mutate` derives negatives from the real carrier. */
function writeCarrier(root: string, ids: { run_id: string; logical_task_id: string; attempt: number; instance_id: string }, p: CarrierPane,
  o: { members?: Member[]; launchId?: string; mutate?: (c: Record<string, any>) => void; raw?: string } = {}): string {
  const file = path.join(root, taskCellPaths(ids).instance_dir, "pane-identity.json");
  const carrier: Record<string, any> = {
    schema_version: "guild.task_cell_pane_identity.v1", run_id: ids.run_id, logical_task_id: ids.logical_task_id, attempt: ids.attempt, instance_id: ids.instance_id,
    launch_id: o.launchId ?? `launch-${ids.logical_task_id}-a${ids.attempt}`, created_at: new Date().toISOString(),
    creating_command: { verb: "new-session", server_pid: p.server_pid, server_process_start: p.server_start, session_id: p.session_id, window_id: p.window_id },
    pane: { pane_id: p.pane_id, pane_pid: p.pid, pane_process_start: p.start, window_id: p.window_id, title: p.title },
    shared_members: o.members ?? [memberOf(ids)],
  };
  o.mutate?.(carrier);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, o.raw ?? JSON.stringify(carrier, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  return file;
}

// ── L1-F1 ──

describe.skipIf(!tmuxAvailable)("L1-F1 · the launcher never kills a replacement pane by a reused id", () => {
  for (const op of ["--reap", "--dismiss-completed"] as const) {
    it(`${op}: replacement server before the call reuses the recorded id; it survives and the attempt stays unconfirmed`, () => {
      const e = env();
      const runId = `run-e00-lr1-f1-${op === "--reap" ? "reap" : "dismiss"}`;
      const ids = seedAttempt(e.root, runId, op === "--reap" ? "orphan" : "accepted");
      const original = carrierPane(e, "worker", "backend--T1--a1");
      writeCarrier(e.root, ids, original);
      writeSession(e.root, runId, sessionWith(runId, original.pane_id));
      const replacement = replaceServer(e);
      // Anti-vacuity: the replacement answers for the recorded id and is a different process.
      expect({ same_id: replacement.pane_id === original.pane_id, different_process: replacement.pid !== original.pid }).toEqual({ same_id: true, different_process: true });
      const r = launcher(e, op, runId);
      expect({ status: r.status, stderr: r.status === 0 ? "" : String(r.stderr).slice(0, 400) }).toEqual({ status: 0, stderr: "" });
      expect({ replacement_alive: alive(replacement), ...notSealed(e.root, ids) }).toEqual({ replacement_alive: true, attempt_present: true, terminal_state: null });
    }, 180_000);
  }

  it("--reap: replacement AT the kill (shim hold barrier); the replacement survives and the attempt stays unconfirmed", async () => {
    const e = env();
    const runId = "run-e00-lr1-f1-reap-at";
    const ids = seedAttempt(e.root, runId, "orphan");
    const original = carrierPane(e, "worker", "backend--T1--a1");
    writeCarrier(e.root, ids, original);
    writeSession(e.root, runId, sessionWith(runId, original.pane_id));
    fs.writeFileSync(e.shim.holdFile, "");
    const child = spawnChild(BUN, launcherArgs("--reap", e.root, runId), { cwd: e.root, env: launcherEnv(e), stdio: "ignore" });
    let replacement: { pane_id: string; pid: number; start: string } | null = null;
    try {
      const until = Date.now() + 90_000;
      while (!fs.existsSync(e.shim.arrivedFile) && Date.now() < until) await sleep(50);
      // Barrier reached: the launcher's kill is held; swap the server under the same id.
      expect(fs.existsSync(e.shim.arrivedFile)).toBe(true);
      replacement = replaceServer(e);
      expect(replacement.pane_id).toBe(original.pane_id);
    } finally {
      fs.rmSync(e.shim.holdFile, { force: true });
      await new Promise((r) => child.on("exit", r));
    }
    expect({ replacement_alive: alive(replacement!), ...notSealed(e.root, ids) }).toEqual({ replacement_alive: true, attempt_present: true, terminal_state: null });
  }, 180_000);
});

// ── L1-F2 ──

describe.skipIf(!tmuxAvailable)("L1-F2 · missing pane metadata never fabricates death for a live worker", () => {
  const cases: Array<[string, "--reap" | "--dismiss-completed", (runId: string) => string | object]> = [
    ["--reap with an unreadable session.json", "--reap", () => "{ not json"],
    ["--reap with no pane entry for the orphan", "--reap", (runId) => ({ run_id: runId, backend: "tmux", teammate_panes: [{ specialist: "frontend", task_id: "T9", pane_id: "%9", host_kind: "claude", adapter_version: "1" }] })],
    ["--reap with the real-launch \"(unknown)\" pane id", "--reap", (runId) => sessionWith(runId, "(unknown)")],
    ["--dismiss-completed with no pane entry for the accepted lane", "--dismiss-completed", (runId) => ({ run_id: runId, backend: "tmux", teammate_panes: [{ specialist: "frontend", task_id: "T9", pane_id: "%9", host_kind: "claude", adapter_version: "1" }] })],
  ];
  cases.forEach(([label, op, body], i) => {
    it(`${label}: the attempt stays nonterminal; the live worker is untouched`, () => {
      const e = env();
      const runId = `run-e00-lr1-f2-${i}`;
      const ids = seedAttempt(e.root, runId, op === "--reap" ? "orphan" : "accepted");
      const worker = ownedPane(e, "worker");
      writeSession(e.root, runId, body(runId));
      const r = launcher(e, op, runId);
      expect({ status: r.status, stderr: r.status === 0 ? "" : String(r.stderr).slice(0, 400) }).toEqual({ status: 0, stderr: "" });
      // Anti-vacuity: the launcher processed this run (no early "no teammates" exit).
      expect(/has no teammates/.test(String(r.stdout))).toBe(false);
      expect({ worker_alive: alive(worker), ...notSealed(e.root, ids) }).toEqual({ worker_alive: true, attempt_present: true, terminal_state: null });
    }, 180_000);
  });
});

// ── carrier-aligned controls and cases (approved carrier r1) ──

const sha = (f: string) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
/** The attempt's terminal_state as read; a missing record is "missing_record", never confused with null. */
const termOf = (root: string, ids: ReturnType<typeof seedAttempt>) => { const a = readAttemptForInstance(root, ids); return a === null ? "missing_record" : a.terminal_state; };

describe.skipIf(!tmuxAvailable)("L1 carrier · a matching carrier for a confirmed live target is torn down and sealed", () => {
  it("--reap: the recorded live pane is killed and the orphan sealed terminated", () => {
    const e = env();
    const runId = "run-e00-lr1-c-reap";
    const ids = seedAttempt(e.root, runId, "orphan");
    ownedPane(e, "holder"); // the server outlives the worker pane, as on a shared server
    const pane = carrierPane(e, "worker", "backend--T1--a1");
    writeCarrier(e.root, ids, pane);
    writeSession(e.root, runId, sessionWith(runId, pane.pane_id));
    const r = launcher(e, "--reap", runId);
    expect({ status: r.status, stderr: r.status === 0 ? "" : String(r.stderr).slice(0, 400) }).toEqual({ status: 0, stderr: "" });
    expect({ pane_alive: alive(pane), terminal_state: termOf(e.root, ids) }).toEqual({ pane_alive: false, terminal_state: "terminated" });
  }, 180_000);

  it("--dismiss-completed: the recorded live pane is killed and sealed; a second pass re-seals nothing", () => {
    const e = env();
    const runId = "run-e00-lr1-c-dismiss";
    const ids = seedAttempt(e.root, runId, "accepted");
    ownedPane(e, "holder"); // the server outlives the worker pane, as on a shared server
    const pane = carrierPane(e, "worker", "backend--T1--a1");
    writeCarrier(e.root, ids, pane);
    writeSession(e.root, runId, sessionWith(runId, pane.pane_id));
    expect(launcher(e, "--dismiss-completed", runId).status).toBe(0);
    const attemptFile = path.join(e.root, taskCellPaths(ids).attempt_path);
    const first = { pane_alive: alive(pane), terminal_state: termOf(e.root, ids), bytes: sha(attemptFile) };
    expect(launcher(e, "--dismiss-completed", runId).status).toBe(0);
    expect({ ...first, bytes_unchanged: sha(attemptFile) === first.bytes }).toEqual({ pane_alive: false, terminal_state: "terminated", bytes: first.bytes, bytes_unchanged: true });
  }, 180_000);
});

describe.skipIf(!tmuxAvailable)("L1 carrier · placeholder, missing or invalid carrier parks the attempt and never kills", () => {
  const cases: Array<[string, (e: Env, root: string, ids: ReturnType<typeof seedAttempt>, p: CarrierPane) => string]> = [
    ["'(dry-run: not spawned)' pane id beside a real live attempt, no carrier", () => "(dry-run: not spawned)"],
    ["carrier absent for a real recorded pane", (_e, _r, _ids, p) => p.pane_id],
    ["carrier unreadable", (_e, root, ids, p) => { writeCarrier(root, ids, p, { raw: "{ not json" }); return p.pane_id; }],
    ["carrier names a foreign instance", (_e, root, ids, p) => { writeCarrier(root, ids, p, { mutate: (c) => { c.instance_id = "T1.a1.iX"; } }); return p.pane_id; }],
  ];
  cases.forEach(([label, arrange], i) => {
    it(`--reap, ${label}: worker alive, attempt nonterminal`, () => {
      const e = env();
      const runId = `run-e00-lr1-c-neg-${i}`;
      const ids = seedAttempt(e.root, runId, "orphan");
      const pane = carrierPane(e, "worker", "backend--T1--a1");
      writeSession(e.root, runId, sessionWith(runId, arrange(e, e.root, ids, pane)));
      const r = launcher(e, "--reap", runId);
      expect({ status: r.status, stderr: r.status === 0 ? "" : String(r.stderr).slice(0, 400) }).toEqual({ status: 0, stderr: "" });
      expect({ worker_alive: alive(pane), ...notSealed(e.root, ids) }).toEqual({ worker_alive: true, attempt_present: true, terminal_state: null });
    }, 180_000);
  });
});

describe.skipIf(!tmuxAvailable)("L1 carrier · a shared pane with a missing member or conflicting peer tuple defers without killing", () => {
  const variants: Array<[string, (members: Member[]) => { a?: (c: Record<string, any>) => void; b?: (c: Record<string, any>) => void; aMembers?: Member[] }]> = [
    ["a member's carrier omits its peer from shared_members", (m) => ({ aMembers: [m[0]!] })],
    ["the peer carrier records a different pane tuple", () => ({ b: (c) => { c.pane.pane_pid = c.pane.pane_pid + 1; } })],
  ];
  for (const [label, shape] of variants) {
    it(`--dismiss-completed, ${label}: shared pane alive, both lanes unsealed`, () => {
      const e = env();
      const runId = `run-e00-lr1-c-shared-${label.length}`;
      const a = seedAttempt(e.root, runId, "accepted", "T1");
      const b = seedAttempt(e.root, runId, "accepted", "T2");
      const pane = carrierPane(e, "worker", "backend--shared");
      const members = [memberOf(a), memberOf(b)];
      const s = shape(members);
      writeCarrier(e.root, a, pane, { members: s.aMembers ?? members, mutate: s.a });
      writeCarrier(e.root, b, pane, { members, mutate: s.b });
      writeSession(e.root, runId, { run_id: runId, backend: "tmux", teammate_panes: [
        { specialist: "backend", task_id: "T1", pane_id: pane.pane_id, host_kind: "claude", adapter_version: "1" },
        { specialist: "backend", task_id: "T2", pane_id: pane.pane_id, host_kind: "claude", adapter_version: "1" },
      ] });
      const r = launcher(e, "--dismiss-completed", runId);
      expect({ status: r.status, stderr: r.status === 0 ? "" : String(r.stderr).slice(0, 400) }).toEqual({ status: 0, stderr: "" });
      expect({ pane_alive: alive(pane), a: notSealed(e.root, a).terminal_state, b: notSealed(e.root, b).terminal_state }).toEqual({ pane_alive: true, a: null, b: null });
    }, 180_000);
  }
});

describe.skipIf(!tmuxAvailable)("L1 carrier · second-attempt history: each attempt is governed only by its own carrier", () => {
  it("--reap of attempt 1 kills only attempt 1's pane; attempt 2's carrier, pane and record are untouched", () => {
    const e = env();
    const runId = "run-e00-lr1-c-history";
    const a1 = seedAttempt(e.root, runId, "orphan", "T1", 1);
    const a2 = seedAttempt(e.root, runId, "live", "T1", 2);
    const p1 = carrierPane(e, "worker-a1", "backend--T1--a1");
    const p2 = carrierPane(e, "worker-a2", "backend--T1--a2");
    writeCarrier(e.root, a1, p1);
    const c2 = writeCarrier(e.root, a2, p2);
    const c2Before = sha(c2);
    // The session manifest names the latest launch for the task (attempt 2's pane).
    writeSession(e.root, runId, sessionWith(runId, p2.pane_id));
    const r = launcher(e, "--reap", runId);
    expect({ status: r.status, stderr: r.status === 0 ? "" : String(r.stderr).slice(0, 400) }).toEqual({ status: 0, stderr: "" });
    expect({
      a1_pane_alive: alive(p1), a1_terminal: termOf(e.root, a1),
      a2_pane_alive: alive(p2), a2_terminal: termOf(e.root, a2), a2_carrier_unchanged: sha(c2) === c2Before,
    }).toEqual({ a1_pane_alive: false, a1_terminal: "terminated", a2_pane_alive: true, a2_terminal: null, a2_carrier_unchanged: true });
  }, 180_000);
});
