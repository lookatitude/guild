/**
 * E00-T0 · independent reds for the L r3 findings (review/G-lane-E00-L/result-r3.json,
 * implementation/e00/l-r3-triage-and-test-release.json), authored BEFORE any L r3 source change.
 *
 * L3-F1 the credential probe accepts only the two exact absent-variable responses (status 0,
 *       stdout "-KEY", empty stderr; nonzero status, empty stdout, stderr "unknown variable: KEY"),
 *       each with at most one final LF. Contradictory or whitespace-only other streams, surrounding
 *       blank lines, spaces, CR, control/format characters, extra text and a null status refuse
 *       before create; after create they are spawn_effect unknown with the identity retained.
 * L3-F2 a stored pane_process_start that is not in the writer's raw canonical C-locale form
 *       (VT/FF/TAB/CR/LF separators, leading/trailing or doubled spaces) never authorizes the
 *       real launcher's reap/dismiss teardown. Raw canonical single/shared carriers still do.
 * Lead readbacks (separate, not formal findings): A, ambiguous probe bytes (a canary) never reach
 * the result or written files; B, whitespace-only required carrier strings never authorize teardown,
 * while an opaque nonblank id with no grammar and an extra field still do.
 *
 * Seams as in the L1/L2 files: the test-owned tmux shim (isolated socket, PID+start ledger) and the
 * worker port's declared `run` transport; every injection is counted and its stage asserted. Physical
 * truth is real owned processes checked by pid + start. No product edits, no ambient tmux server.
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
let seq = 6800;

interface Env { root: string; bin: string; shim: TmuxShim; run: (cmd: string, args: string[], o?: Record<string, unknown>) => { status: number | null; stdout: string; stderr: string } }
function env(prefix = "guild-e00-lr3-"): Env {
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

// ── launcher fixtures (copied from the frozen L1/L2 files; neither is imported) ──

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

// ── L3-F1 · only the two exact absent-variable responses authorize use ──

const ABSENT_OK: Array<[string, Answer]> = [
  ["status 0, stdout exactly '-KEY', empty stderr", { status: 0, stdout: `-${KEY}`, stderr: "" }],
  ["status 0, stdout '-KEY' with one final LF, empty stderr", { status: 0, stdout: `-${KEY}\n`, stderr: "" }],
  ["status 1, empty stdout, stderr exactly 'unknown variable: KEY'", { status: 1, stdout: "", stderr: `unknown variable: ${KEY}` }],
  ["status 1, empty stdout, stderr with one final LF", { status: 1, stdout: "", stderr: `unknown variable: ${KEY}\n` }],
  ["status 2 (any nonzero), empty stdout, canonical stderr", { status: 2, stdout: "", stderr: `unknown variable: ${KEY}\n` }],
];

const ABSENT_AMBIGUOUS: Array<[string, Answer]> = [
  ["status 0 '-KEY' with contradictory stderr 'Permission denied'", { status: 0, stdout: `-${KEY}\n`, stderr: "Permission denied\n" }],
  ["status 0 '-KEY' with whitespace-only stderr", { status: 0, stdout: `-${KEY}\n`, stderr: " \n" }],
  ["status 0 '-KEY' preceded by a blank line", { status: 0, stdout: `\n-${KEY}\n`, stderr: "" }],
  ["status 0 '-KEY' followed by a blank line", { status: 0, stdout: `-${KEY}\n\n`, stderr: "" }],
  ["status 0 '-KEY' with a leading space", { status: 0, stdout: ` -${KEY}\n`, stderr: "" }],
  ["status 0 '-KEY' with a trailing space", { status: 0, stdout: `-${KEY} \n`, stderr: "" }],
  ["status 0 '-KEY' with CR LF", { status: 0, stdout: `-${KEY}\r\n`, stderr: "" }],
  ["status 0 '-KEY' with a trailing vertical tab", { status: 0, stdout: `-${KEY}\u000b`, stderr: "" }],
  ["status 0 '-KEY' preceded by a zero-width format character", { status: 0, stdout: `​-${KEY}\n`, stderr: "" }],
  ["status 0 '-KEY' with extra text", { status: 0, stdout: `-${KEY} extra\n`, stderr: "" }],
  ["status 1 canonical stderr with whitespace-only stdout", { status: 1, stdout: "  \n", stderr: `unknown variable: ${KEY}\n` }],
  ["status 1 canonical stderr followed by a blank line", { status: 1, stdout: "", stderr: `unknown variable: ${KEY}\n\n` }],
  ["status 1 canonical stderr with a leading space", { status: 1, stdout: "", stderr: ` unknown variable: ${KEY}\n` }],
  ["status 1 canonical stderr with CR LF", { status: 1, stdout: "", stderr: `unknown variable: ${KEY}\r\n` }],
  ["status 1 canonical stderr with extra text", { status: 1, stdout: "", stderr: `unknown variable: ${KEY} (Permission denied)\n` }],
  ["status 1 canonical stderr then a second line", { status: 1, stdout: "", stderr: `unknown variable: ${KEY}\nPermission denied\n` }],
  ["null status with canonical stderr", { status: null, stdout: "", stderr: `unknown variable: ${KEY}\n` }],
  ["null status with canonical stdout", { status: null, stdout: `-${KEY}\n`, stderr: "" }],
];

describe.skipIf(!tmuxAvailable)("L3-F1 · pre-create: only the exact canonical absent-variable responses authorize creation", () => {
  for (const [label, answer] of ABSENT_AMBIGUOUS) {
    it(`${label}: refused before create (spawn_effect none, no create, no identity)`, () => {
      const e = env();
      const p = probeAt(e, "pre", () => answer);
      const { port, spawn } = workerPort(e, p.run);
      const out = spawn();
      expect(p.stages[0]).toEqual({ creates_before: 0, injected: true });
      expect({ ok: out.ok, spawn_effect: effect(out), creates: creates(e, p.base), identity: port.paneIdentity("i1") })
        .toEqual({ ok: false, spawn_effect: "none", creates: 0, identity: null });
    });
  }

  for (const [label, answer] of ABSENT_OK) {
    it(`positive: ${label}: creation allowed; post-create reads real`, () => {
      const e = env();
      const p = probeAt(e, "pre", () => answer);
      const { port, spawn } = workerPort(e, p.run);
      const out = spawn();
      expect({ first: p.stages[0], post_real: p.stages.filter((s) => s.creates_before > 0).every((s) => !s.injected) }).toEqual({ first: { creates_before: 0, injected: true }, post_real: true });
      expect({ ok: out.ok, identity: port.paneIdentity("i1") !== null }).toEqual({ ok: true, identity: true });
    });
  }

  const NO_SERVER: Array<[string, (s: string) => Answer]> = [
    ["exact 'no server running on <socket>'", (s) => ({ status: 1, stdout: "", stderr: `no server running on ${s}\n` })],
    ["exact socket ENOENT", (s) => ({ status: 1, stdout: "", stderr: `error connecting to ${s} (No such file or directory)\n` })],
  ];
  for (const [label, answer] of NO_SERVER) {
    it(`control: pre-create ${label} allows creation`, () => {
      const e = env();
      const p = probeAt(e, "pre", answer);
      const { port, spawn } = workerPort(e, p.run);
      expect({ ok: spawn().ok, injected: p.stages[0]?.injected, identity: port.paneIdentity("i1") !== null }).toEqual({ ok: true, injected: true, identity: true });
    });
  }
});

describe.skipIf(!tmuxAvailable)("L3-F1 · post-create: an ambiguous absent probe is unknown with the identity retained, never a verified launch", () => {
  const POST: Array<[string, Answer]> = [
    ["status 0 '-KEY' with contradictory stderr", { status: 0, stdout: `-${KEY}\n`, stderr: "Permission denied\n" }],
    ["status 0 '-KEY' surrounded by blank lines", { status: 0, stdout: `\n-${KEY}\n\n`, stderr: "" }],
    ["status 1 canonical stderr with whitespace-only stdout", { status: 1, stdout: " \n", stderr: `unknown variable: ${KEY}\n` }],
  ];
  for (const [label, answer] of POST) {
    it(`${label}: spawn_effect unknown, identity retained, worker alive, no verified launch`, () => {
      const e = env();
      const p = probeAt(e, "post", () => answer);
      const recorded: string[] = [];
      const { port, spawn } = workerPort(e, p.run, (id) => { recorded.push(id); });
      const out = spawn();
      const identity = port.paneIdentity("i1");
      expect({ pre_real: p.stages[0]?.creates_before === 0 && p.stages[0]?.injected === false, created: creates(e, p.base) > 0, post_injected: p.stages.some((s) => s.creates_before > 0 && s.injected) })
        .toEqual({ pre_real: true, created: true, post_injected: true });
      expect({ ok: out.ok, spawn_effect: effect(out), identity_retained: identity !== null,
        worker_alive: identity !== null && alive({ pid: identity.pane_pid, start: identity.pane_process_start }), verified_launch_recorded: recorded.length > 0 })
        .toEqual({ ok: false, spawn_effect: "unknown", identity_retained: true, worker_alive: true, verified_launch_recorded: false });
    });
  }

  it("positive: a canonical post-create absent answer records the verified launch", () => {
    const e = env();
    const p = probeAt(e, "post", () => ({ status: 0, stdout: `-${KEY}\n`, stderr: "" }));
    const recorded: string[] = [];
    const { port, spawn } = workerPort(e, p.run, (id) => { recorded.push(id); });
    const out = spawn();
    expect({ post_injected: p.stages.some((s) => s.creates_before > 0 && s.injected) }).toEqual({ post_injected: true });
    expect({ ok: out.ok, identity: port.paneIdentity("i1") !== null, verified_launch_recorded: recorded.length > 0 }).toEqual({ ok: true, identity: true, verified_launch_recorded: true });
  });
});

// ── lead readback A (separate, not a formal finding): probe bytes never propagate ──

/** True if `needle` occurs in any file under `dir` (booleans only; the bytes are never printed). */
function anyFileContains(dir: string, needle: string): boolean {
  if (!fs.existsSync(dir)) return false;
  for (const rel of fs.readdirSync(dir, { recursive: true }) as string[]) {
    const p = path.join(dir, String(rel));
    try { if (fs.statSync(p).isFile() && fs.readFileSync(p).includes(needle)) return true; } catch { /* unreadable entries are not hits */ }
  }
  return false;
}

describe.skipIf(!tmuxAvailable)("lead readback A · ambiguous probe stdout/stderr/thrown bytes never reach the result or diagnostics", () => {
  const cases: Array<[string, "pre" | "post", (canary: string) => Answer | "throw"]> = [
    ["pre-create stdout carries a private-looking line", "pre", (c) => ({ status: 0, stdout: `-${KEY}\n${KEY}=${c}\n`, stderr: "" })],
    ["pre-create stderr carries a private-looking line", "pre", (c) => ({ status: 1, stdout: "", stderr: `unknown variable: ${KEY}\n${KEY}=${c}\n` })],
    ["pre-create probe throws with private-looking bytes", "pre", () => "throw"],
    ["post-create stdout carries a private-looking line", "post", (c) => ({ status: 0, stdout: `-${KEY}\n${KEY}=${c}\n`, stderr: "" })],
  ];
  for (const [label, stage, answer] of cases) {
    it(`${label}: not a verified use, and the canary is absent from the result and every written file`, () => {
      const e = env();
      const canary = `e00-canary-${crypto.randomBytes(8).toString("hex")}`;
      const p = probeAt(e, stage, () => answer(canary), `show-environment failed: ${KEY}=${canary}`);
      const recorded: string[] = [];
      const { spawn } = workerPort(e, p.run, (id) => { recorded.push(id); });
      const out = spawn();
      expect(p.stages.some((s) => s.injected)).toBe(true);
      expect({ ok: out.ok, verified_launch_recorded: recorded.length > 0, canary_in_result: JSON.stringify(out).includes(canary), canary_in_files: anyFileContains(path.join(e.root, ".guild"), canary) })
        .toEqual({ ok: false, verified_launch_recorded: false, canary_in_result: false, canary_in_files: false });
    });
  }
});

// ── L3-F2 · the stored pane_process_start must be in raw canonical C-locale form ──

const START_VARIANTS: Array<[string, (s: string) => string]> = [
  ["first separator replaced by a vertical tab", (s) => s.replace(" ", "\u000b")],
  ["first separator replaced by a form feed", (s) => s.replace(" ", "\u000c")],
  ["first separator replaced by a tab", (s) => s.replace(" ", "\t")],
  ["first separator replaced by a carriage return", (s) => s.replace(" ", "\r")],
  ["first separator replaced by a line feed", (s) => s.replace(" ", "\n")],
  ["a leading space", (s) => ` ${s}`],
  ["a trailing space", (s) => `${s} `],
  ["a doubled ASCII space", (s) => s.replace(" ", "  ")],
];

describe.skipIf(!tmuxAvailable)("L3-F2 · a non-writer-shaped pane_process_start never authorizes teardown", () => {
  START_VARIANTS.forEach(([label, vary], i) => {
    it(`--reap, single member, ${label}: the live pane survives and the orphan stays nonterminal`, () => {
      const e = env();
      const runId = `run-e00-lr3-f2-reap-${i}`;
      const ids = seedAttempt(e.root, runId, "orphan");
      ownedPane(e, "holder");
      const pane = carrierPane(e, "worker", "backend--T1--a1");
      // Anti-vacuity: the writer's value is canonical and the variant really differs from it.
      expect({ canonical: /^[A-Z][a-z]{2} [A-Z][a-z]{2} \d{1,2} \d{2}:\d{2}:\d{2} \d{4}$/.test(pane.start), differs: vary(pane.start) !== pane.start }).toEqual({ canonical: true, differs: true });
      writeCarrier(e.root, ids, pane, { mutate: (c) => { c.pane.pane_process_start = vary(c.pane.pane_process_start); } });
      writeSession(e.root, runId, [{ task_id: "T1", pane_id: pane.pane_id }]);
      expect(ran(launcher(e, "--reap", runId))).toEqual({ status: 0, stderr: "" });
      expect({ pane_alive: alive(pane), terminal_state: termOf(e.root, ids) }).toEqual({ pane_alive: true, terminal_state: null });
    }, 180_000);
  });

  it("--dismiss-completed, shared pane, one member's start has a vertical tab: the shared pane survives and both lanes stay nonterminal", () => {
    const e = env();
    const runId = "run-e00-lr3-f2-shared-vt";
    const a = seedAttempt(e.root, runId, "accepted", "T1");
    const b = seedAttempt(e.root, runId, "accepted", "T2");
    ownedPane(e, "holder");
    const pane = carrierPane(e, "worker", "backend--shared");
    const members = [memberOf(a, pane.title), memberOf(b, pane.title)];
    writeCarrier(e.root, a, pane, { members });
    writeCarrier(e.root, b, pane, { members, mutate: (c) => { c.pane.pane_process_start = c.pane.pane_process_start.replace(" ", "\u000b"); } });
    writeSession(e.root, runId, [{ task_id: "T1", pane_id: pane.pane_id }, { task_id: "T2", pane_id: pane.pane_id }]);
    expect(ran(launcher(e, "--dismiss-completed", runId))).toEqual({ status: 0, stderr: "" });
    expect({ pane_alive: alive(pane), a: termOf(e.root, a), b: termOf(e.root, b) }).toEqual({ pane_alive: true, a: null, b: null });
  }, 180_000);

  it("positive: --reap with the raw canonical writer start kills the pane and seals the orphan", () => {
    const e = env();
    const runId = "run-e00-lr3-f2-pos-single";
    const ids = seedAttempt(e.root, runId, "orphan");
    ownedPane(e, "holder");
    const pane = carrierPane(e, "worker", "backend--T1--a1");
    writeCarrier(e.root, ids, pane);
    writeSession(e.root, runId, [{ task_id: "T1", pane_id: pane.pane_id }]);
    expect(ran(launcher(e, "--reap", runId))).toEqual({ status: 0, stderr: "" });
    expect({ pane_alive: alive(pane), terminal_state: termOf(e.root, ids) }).toEqual({ pane_alive: false, terminal_state: "terminated" });
  }, 180_000);

  it("positive: --dismiss-completed with raw canonical shared carriers kills and seals both; a second pass changes nothing", () => {
    const e = env();
    const runId = "run-e00-lr3-f2-pos-shared";
    const a = seedAttempt(e.root, runId, "accepted", "T1");
    const b = seedAttempt(e.root, runId, "accepted", "T2");
    ownedPane(e, "holder");
    const pane = carrierPane(e, "worker", "backend--shared");
    const members = [memberOf(a, pane.title), memberOf(b, pane.title)];
    writeCarrier(e.root, a, pane, { members });
    writeCarrier(e.root, b, pane, { members });
    writeSession(e.root, runId, [{ task_id: "T1", pane_id: pane.pane_id }, { task_id: "T2", pane_id: pane.pane_id }]);
    expect(ran(launcher(e, "--dismiss-completed", runId))).toEqual({ status: 0, stderr: "" });
    const files = [a, b].map((ids) => path.join(e.root, taskCellPaths(ids).attempt_path));
    const first = files.map((f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex"));
    expect(ran(launcher(e, "--dismiss-completed", runId))).toEqual({ status: 0, stderr: "" });
    expect({ pane_alive: alive(pane), a: termOf(e.root, a), b: termOf(e.root, b),
      unchanged: files.every((f, i) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex") === first[i]) })
      .toEqual({ pane_alive: false, a: "terminated", b: "terminated", unchanged: true });
  }, 180_000);
});

// ── lead readback B (separate, not a formal finding): whitespace-only required strings ──

describe.skipIf(!tmuxAvailable)("lead readback B · a whitespace-only required carrier string never authorizes teardown", () => {
  const cases: Array<[string, (c: Record<string, any>) => void]> = [
    ["launch_id is whitespace only", (c) => { c.launch_id = "   "; }],
    ["the member specialist is whitespace only", (c) => { c.shared_members[0].specialist = " "; }],
    ["pane title and the member dispatch_key are whitespace only", (c) => { c.pane.title = " "; c.shared_members[0].dispatch_key = " "; }],
  ];
  cases.forEach(([label, mutate], i) => {
    it(`--reap, ${label}: the live pane survives and the orphan stays nonterminal`, () => {
      const e = env();
      const runId = `run-e00-lr3-b-${i}`;
      const ids = seedAttempt(e.root, runId, "orphan");
      ownedPane(e, "holder");
      const pane = carrierPane(e, "worker", "backend--T1--a1");
      writeCarrier(e.root, ids, pane, { mutate });
      writeSession(e.root, runId, [{ task_id: "T1", pane_id: pane.pane_id }]);
      expect(ran(launcher(e, "--reap", runId))).toEqual({ status: 0, stderr: "" });
      expect({ pane_alive: alive(pane), terminal_state: termOf(e.root, ids) }).toEqual({ pane_alive: true, terminal_state: null });
    }, 180_000);
  });

  it("control: an opaque nonblank launch_id with no grammar and an extra field still tears down", () => {
    const e = env();
    const runId = "run-e00-lr3-b-pos";
    const ids = seedAttempt(e.root, runId, "orphan");
    ownedPane(e, "holder");
    const pane = carrierPane(e, "worker", "backend--T1--a1");
    writeCarrier(e.root, ids, pane, { mutate: (c) => { c.launch_id = "x"; c.extra_field = "tolerated"; } });
    writeSession(e.root, runId, [{ task_id: "T1", pane_id: pane.pane_id }]);
    expect(ran(launcher(e, "--reap", runId))).toEqual({ status: 0, stderr: "" });
    expect({ pane_alive: alive(pane), terminal_state: termOf(e.root, ids) }).toEqual({ pane_alive: false, terminal_state: "terminated" });
  }, 180_000);
});
