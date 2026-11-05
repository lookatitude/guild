/**
 * E00-T0 · supplement to the frozen L r3 reds (implementation/e00/l-r3-parser-scope-decisions.json Q1/Q2),
 * closing the same L3-F1 status boundary; not a new formal finding. The frozen 48-case file is unchanged.
 *
 * A non-finite or missing exit status (NaN, +Infinity, -Infinity, undefined) never establishes absence or
 * no-server, for the canonical "unknown variable" and "no server running" stderr; a finite nonzero status
 * (2) with either canonical response still allows creation. A thrown probe error's E-prefixed code never
 * reaches the result or written files.
 *
 * Seams as in the r3 file: the test-owned tmux shim and the worker port's declared `run` transport; each
 * injection is counted and its stage asserted. No product edits, no ambient tmux server.
 */
import { describe, it, expect, afterEach } from "bun:test";
import { spawn as spawnChild, spawnSync } from "child_process";
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";

import { TmuxTaskCellWorkerPort, processStartOf, terminateBoundPane, tmuxServerIdentity } from "../../scripts/lib/host/tmux-backend";
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
let seq = 6900;

interface Env { root: string; bin: string; shim: TmuxShim; run: (cmd: string, args: string[], o?: Record<string, unknown>) => { status: number | null; stdout: string; stderr: string } }
function env(prefix = "guild-e00-lr3s-"): Env {
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

function ownedPane(e: Env, session: string): { pane_id: string; pid: number; start: string } {
  const out = e.run("tmux", ["new-session", "-d", "-P", "-F", "#{pane_id} #{pane_pid}", "-s", session, `sleep ${++seq}`]);
  if (out.status !== 0) throw new Error(`fixture: owned pane not created: ${out.stderr}`);
  const [pane_id, pid] = out.stdout.trim().split(" ");
  return { pane_id: pane_id!, pid: Number(pid), start: processStartOf(Number(pid))! };
}
const alive = (p: { pid: number; start: string }) => processStartOf(p.pid) === p.start;
const shimCalls = (e: Env) => (fs.existsSync(e.shim.callsLog) ? fs.readFileSync(e.shim.callsLog, "utf8").split("\n").filter(Boolean) : []);
const creates = (e: Env, from: number) => shimCalls(e).slice(from).filter((c) => c === "new-session" || c === "new-window").length;
/** A live owned process outside tmux (survives the server), recorded by pid + start. */
function ownedProcess(e: Env): { pid: number; start: string; kill: () => void } {
  const child = ownChild(spawnChild("sleep", [String(++seq)], { stdio: "ignore" }), e.root);
  return { pid: child.pid!, start: processStartOf(child.pid!)!, kill: () => child.kill("SIGKILL") };
}

// ── fixtures copied from the frozen L r3 file (not imported) ──

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
  };
}

function seedAttempt(root: string, runId: string, kind: "orphan" | "accepted", taskId = "T1") {
  const bind = { binding_ref: (loadRunBinding({ root, run_id: runId }) ?? mintRunBinding({ root, run_id: runId })).binding_ref };
  const cell = buildTaskCell(disp(runId, taskId));
  writeTaskCell(root, cell, bind);
  const ids = { run_id: runId, logical_task_id: taskId, attempt: 1, instance_id: `${taskId}.a1.i1` };
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
  } else {
    markAttemptOrphaned(root, ids, bind);
  }
  return ids;
}

function writeSession(root: string, runId: string, panes: Array<{ task_id: string; pane_id: string }>): void {
  const dir = path.join(root, ".guild", "runs", runId, "agent-team");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "session.json"), JSON.stringify({ run_id: runId, backend: "tmux",
    teammate_panes: panes.map((p) => ({ specialist: "backend", task_id: p.task_id, pane_id: p.pane_id, host_kind: "claude", adapter_version: "1" })) }, null, 2));
}

const BUN = (globalThis as { Bun?: { which(n: string): string | null } }).Bun?.which("bun") ?? "bun";
function launcher(e: Env, op: "--reap" | "--dismiss-completed", runId: string, extraBin?: string) {
  const PATHv = `${extraBin ? `${extraBin}:` : ""}${e.bin}:${process.env["PATH"] ?? "/usr/bin:/bin"}`;
  return spawnSync(BUN, [path.join(PLUGIN, "scripts", "agent-team-launcher.ts"), op, "--run-id", runId, "--cwd", e.root],
    { cwd: e.root, env: { PATH: PATHv, HOME: process.env["HOME"] ?? e.root, GUILD_PLUGIN_ROOT: PLUGIN }, encoding: "utf8", timeout: 120000 });
}
const termOf = (root: string, ids: ReturnType<typeof seedAttempt>) => { const a = readAttemptForInstance(root, ids); return a === null ? "missing_record" : a.terminal_state; };
const ran = (r: ReturnType<typeof launcher>) => ({ status: r.status, stderr: r.status === 0 ? "" : String(r.stderr).slice(0, 400) });

interface CarrierPane { pane_id: string; pid: number; start: string; window_id: string; session_id: string; server_pid: number; server_start: string; title: string }
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
/** The launcher's mapping (agent-team-launcher.ts carrier build): every member of one pane carries
 *  the SAME dispatch_key, the captured pane title; a single member's key is its own title. */
const memberOf = (ids: { logical_task_id: string; attempt: number; instance_id: string }, dispatchKey = `backend--${ids.logical_task_id}--a${ids.attempt}`): Member =>
  ({ logical_task_id: ids.logical_task_id, attempt: ids.attempt, instance_id: ids.instance_id, dispatch_key: dispatchKey, specialist: "backend" });

function writeCarrier(root: string, ids: { run_id: string; logical_task_id: string; attempt: number; instance_id: string }, p: CarrierPane,
  o: { members?: Member[]; launchId?: string; mutate?: (c: Record<string, any>) => void } = {}): string {
  const file = path.join(root, taskCellPaths(ids).instance_dir, "pane-identity.json");
  const carrier: Record<string, any> = {
    schema_version: "guild.task_cell_pane_identity.v1", run_id: ids.run_id, logical_task_id: ids.logical_task_id, attempt: ids.attempt, instance_id: ids.instance_id,
    launch_id: o.launchId ?? `launch-${ids.run_id}`, created_at: new Date().toISOString(),
    creating_command: { verb: "new-session", server_pid: p.server_pid, server_process_start: p.server_start, session_id: p.session_id, window_id: p.window_id },
    pane: { pane_id: p.pane_id, pane_pid: p.pid, pane_process_start: p.start, window_id: p.window_id, title: p.title },
    shared_members: o.members ?? [memberOf(ids)],
  };
  o.mutate?.(carrier);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(carrier, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  return file;
}


// ── worker port (credential probe caller) ──

const KEY = "GUILD_RUN_BINDING_REF";
type Answer = { status: number | null; stdout: string; stderr: string };

function workerPort(e: Env, run: Env["run"], recordLaunch?: (id: string, evidence: unknown) => void) {
  adoptDefinition(e.root, "backend");
  const stubPlugin = path.join(e.root, ".stub-plugin");
  fs.mkdirSync(stubPlugin, { recursive: true });
  const assignmentRel = ".guild/runs/run-e00-lr3/task-cells/T1/attempts/1/instances/i1/assignment.json";
  fs.mkdirSync(path.dirname(path.join(e.root, assignmentRel)), { recursive: true });
  fs.writeFileSync(path.join(e.root, assignmentRel), "{\"schema_version\":\"guild.task_assignment.v2\"}\n");
  const port = new TmuxTaskCellWorkerPort({
    cwd: e.root, sessionName: "e00-lr3-port",
    snapshotDir: path.join(e.root, ".guild", "runs", "run-e00-lr3", "controller", "launch"),
    resolveDefinition: (inst) => resolveAdoptedDefinition(e.root, inst.worker_role),
    receiptPath: (inst) => path.join(e.root, ".guild", "runs", "run-e00-lr3", "handoffs", `${inst.worker_role}-${inst.logical_task_id}.md`),
    ackArgv: ["node", path.join(e.root, "task-cell-ack.js")],
    run,
    env: { PATH: `${e.bin}:${process.env["PATH"] ?? "/usr/bin:/bin"}`, HOME: process.env["HOME"] ?? e.root, SHELL: fs.existsSync("/bin/zsh") ? "/bin/zsh" : "/bin/sh", LANG: "en_US.UTF-8" },
    activate: () => ({ args: ["--plugin-dir", stubPlugin], pluginRoot: stubPlugin }),
    ...(recordLaunch ? { recordLaunch } : {}),
  });
  const input = {
    instance_id: "i1", run_id: "run-e00-lr3", assignment_path: assignmentRel,
    instance: {
      instance_id: "i1", run_id: "run-e00-lr3", logical_task_id: "T1", worker_role: "backend", host_id: "claude-code-cli",
      specialist_profile_hash: `sha256:${TEST_PROFILE_HASH}`, specialist_type_hash: `sha256:${TEST_TYPE_HASH}`,
      projection: { tools: ["read", "write"], permissions: [], recorded_losses: [] }, model_id: null,
    },
  };
  return { port, spawn: () => port.spawn(input as never) };
}

/** Inject `answer` into show-environment at the chosen stage (before any create, or after one); the other stage is real. */
function probeAt(e: Env, stage: "pre" | "post", answer: (sock: string) => Answer | "throw", thrown = "boom") {
  const base = shimCalls(e).length;
  const stages: Array<{ creates_before: number; injected: boolean }> = [];
  const run = (cmd: string, args: string[], o: Record<string, unknown> = {}) => {
    if (cmd === "tmux" && args[0] === "show-environment") {
      const before = creates(e, base);
      const inject = stage === "pre" ? before === 0 : before > 0;
      stages.push({ creates_before: before, injected: inject });
      if (inject) {
        const a = answer(e.shim.socket);
        if (a === "throw") throw new Error(thrown);
        return a;
      }
    }
    return e.run(cmd, args, o);
  };
  return { run, stages, base };
}
const effect = (out: unknown) => (out as { spawn_effect?: unknown }).spawn_effect ?? null;


/** True if `needle` occurs in any file under `dir` (booleans only; the bytes are never printed). */
function anyFileContains(dir: string, needle: string): boolean {
  if (!fs.existsSync(dir)) return false;
  for (const rel of fs.readdirSync(dir, { recursive: true }) as string[]) {
    const p = path.join(dir, String(rel));
    try { if (fs.statSync(p).isFile() && fs.readFileSync(p).includes(needle)) return true; } catch { /* unreadable entries are not hits */ }
  }
  return false;
}


// ── L3-F1 status boundary (supplement; same finding, not a new one) ──

const NONFINITE: Array<[string, number | undefined]> = [["NaN", Number.NaN], ["+Infinity", Number.POSITIVE_INFINITY], ["-Infinity", Number.NEGATIVE_INFINITY], ["undefined", undefined]];
const RESPONSES: Array<[string, (s: string) => { stdout: string; stderr: string }]> = [
  ["canonical 'unknown variable' stderr", () => ({ stdout: "", stderr: `unknown variable: ${KEY}\n` })],
  ["canonical 'no server running' stderr", (s) => ({ stdout: "", stderr: `no server running on ${s}\n` })],
];

describe.skipIf(!tmuxAvailable)("L3-F1 status · a non-finite or missing exit status never establishes absence or no-server", () => {
  for (const [sname, status] of NONFINITE) {
    for (const [rname, resp] of RESPONSES) {
      it(`status ${sname} with ${rname}: refused before create (spawn_effect none, no create, no identity)`, () => {
        const e = env();
        const p = probeAt(e, "pre", (s) => ({ status: status as number, ...resp(s) }));
        const { port, spawn } = workerPort(e, p.run);
        const out = spawn();
        expect(p.stages[0]).toEqual({ creates_before: 0, injected: true });
        expect({ ok: out.ok, spawn_effect: effect(out), creates: creates(e, p.base), identity: port.paneIdentity("i1") })
          .toEqual({ ok: false, spawn_effect: "none", creates: 0, identity: null });
      });
    }
  }

  for (const [rname, resp] of RESPONSES) {
    it(`positive: finite nonzero status 2 with ${rname} allows creation`, () => {
      const e = env();
      const p = probeAt(e, "pre", (s) => ({ status: 2, ...resp(s) }));
      const { port, spawn } = workerPort(e, p.run);
      expect({ ok: spawn().ok, injected: p.stages[0]?.injected, identity: port.paneIdentity("i1") !== null }).toEqual({ ok: true, injected: true, identity: true });
    });
  }
});

describe.skipIf(!tmuxAvailable)("L3-F1 status · a thrown probe error's code is never echoed", () => {
  it("thrown Error with a safe message and an E-prefixed canary code: refused before create; the code is absent from the result and every written file", () => {
    const e = env();
    const code = `E${crypto.randomBytes(8).toString("hex").toUpperCase()}`;
    const base = shimCalls(e).length;
    let thrown = 0;
    const run = (cmd: string, args: string[], o: Record<string, unknown> = {}) => {
      if (cmd === "tmux" && args[0] === "show-environment" && creates(e, base) === 0) {
        thrown++;
        throw Object.assign(new Error("show-environment failed"), { code });
      }
      return e.run(cmd, args, o);
    };
    const { port, spawn } = workerPort(e, run);
    const out = spawn();
    expect(thrown).toBeGreaterThan(0);
    expect({ ok: out.ok, spawn_effect: effect(out), creates: creates(e, base), identity: port.paneIdentity("i1"),
      code_in_result: JSON.stringify(out).includes(code), code_in_files: anyFileContains(path.join(e.root, ".guild"), code) })
      .toEqual({ ok: false, spawn_effect: "none", creates: 0, identity: null, code_in_result: false, code_in_files: false });
  });
});
