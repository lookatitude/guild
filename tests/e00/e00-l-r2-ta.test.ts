/**
 * E00-T0 · deterministic reds for the three L r2 findings (review/G-lane-E00-L/result-r2.json,
 * implementation/e00/l-r2-triage-and-test-release.json), authored BEFORE any L r2 source change.
 *
 * L2-F1 a pane carrier missing or holding a malformed created_at or creating_command.verb never
 *       authorizes teardown: launcher --reap / --dismiss-completed leave the real pane live and
 *       the attempt nonterminal (single and shared). Complete valid carriers still tear down.
 * L2-F2 the worker port's pre-create credential probe accepts only the exact single-line
 *       canonical "no server running on <socket>" or socket-ENOENT answer; appended
 *       permission text, junk, mixed errno, CR or multiline output refuses creation.
 *       Exact canonical answers and a real fresh-socket ENOENT still allow creation.
 * L2-F3 a successful ps table with any malformed, unparseable, invalid-date or duplicate row
 *       is unavailable: no-server teardown of a live recorded process is never confirmed,
 *       including when a (reused-start) target row precedes the malformed row. Exact C-locale
 *       full tables still distinguish alive / reused / absent.
 *
 * Seams: tmux runs through the test-owned shim (isolated socket, PID+start ownership ledger);
 * show-environment and ps answers are injected only through the declared `run` transport, or
 * for the launcher CLI through a test-owned `ps` first on PATH that answers only the full-table
 * query and logs each use. Every injection is counted as a precondition. Physical truth is real
 * owned processes checked by pid + start. No product edits, no ambient tmux server.
 */
import { describe, it, expect, afterEach } from "bun:test";
import { spawn as spawnChild, spawnSync } from "child_process";
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
let seq = 6700;

interface Env { root: string; bin: string; shim: TmuxShim; run: (cmd: string, args: string[], o?: Record<string, unknown>) => { status: number | null; stdout: string; stderr: string } }
function env(prefix = "guild-e00-lr2-"): Env {
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

// ── launcher fixtures (copied from the frozen L1 file; that file is not imported) ──

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

// ── L2-F1 · complete carrier provenance ──

const CORRUPT: Array<[string, (c: Record<string, any>) => void]> = [
  ["created_at absent", (c) => { delete c.created_at; }],
  ["created_at empty", (c) => { c.created_at = ""; }],
  ["created_at not a timestamp", (c) => { c.created_at = "not-a-date"; }],
  ["created_at impossible calendar value", (c) => { c.created_at = "2026-13-45T99:99:99.000Z"; }],
  ["created_at a number", (c) => { c.created_at = 1793000000000; }],
  ["creating_command.verb absent", (c) => { delete c.creating_command.verb; }],
  ["creating_command.verb empty", (c) => { c.creating_command.verb = ""; }],
  ["creating_command.verb not a create verb", (c) => { c.creating_command.verb = "kill-pane"; }],
];

describe.skipIf(!tmuxAvailable)("L2-F1 · a carrier with absent or malformed created_at / creating_command.verb never authorizes teardown", () => {
  CORRUPT.forEach(([label, mutate], i) => {
    it(`--reap, single member, ${label}: the live pane survives and the orphan stays nonterminal`, () => {
      const e = env();
      const runId = `run-e00-lr2-f1-reap-${i}`;
      const ids = seedAttempt(e.root, runId, "orphan");
      ownedPane(e, "holder");
      const pane = carrierPane(e, "worker", "backend--T1--a1");
      writeCarrier(e.root, ids, pane, { mutate });
      writeSession(e.root, runId, [{ task_id: "T1", pane_id: pane.pane_id }]);
      const r = launcher(e, "--reap", runId);
      expect(ran(r)).toEqual({ status: 0, stderr: "" });
      expect({ pane_alive: alive(pane), terminal_state: termOf(e.root, ids) }).toEqual({ pane_alive: true, terminal_state: null });
    }, 180_000);
  });

  it("--dismiss-completed, single member, created_at absent: the live pane survives and the accepted attempt stays nonterminal", () => {
    const e = env();
    const runId = "run-e00-lr2-f1-dismiss";
    const ids = seedAttempt(e.root, runId, "accepted");
    ownedPane(e, "holder");
    const pane = carrierPane(e, "worker", "backend--T1--a1");
    writeCarrier(e.root, ids, pane, { mutate: (c) => { delete c.created_at; } });
    writeSession(e.root, runId, [{ task_id: "T1", pane_id: pane.pane_id }]);
    expect(ran(launcher(e, "--dismiss-completed", runId))).toEqual({ status: 0, stderr: "" });
    expect({ pane_alive: alive(pane), terminal_state: termOf(e.root, ids) }).toEqual({ pane_alive: true, terminal_state: null });
  }, 180_000);

  const shared: Array<[string, (c: Record<string, any>) => void]> = [
    ["one member's carrier lacks created_at", (c) => { delete c.created_at; }],
    ["one member's carrier lacks creating_command.verb", (c) => { delete c.creating_command.verb; }],
  ];
  for (const [label, mutate] of shared) {
    it(`--dismiss-completed, shared pane, ${label}: the shared pane survives and both lanes stay nonterminal`, () => {
      const e = env();
      const runId = `run-e00-lr2-f1-shared-${label.length}`;
      const a = seedAttempt(e.root, runId, "accepted", "T1");
      const b = seedAttempt(e.root, runId, "accepted", "T2");
      ownedPane(e, "holder");
      const pane = carrierPane(e, "worker", "backend--shared");
      const members = [memberOf(a, pane.title), memberOf(b, pane.title)];
      writeCarrier(e.root, a, pane, { members });
      writeCarrier(e.root, b, pane, { members, mutate });
      writeSession(e.root, runId, [{ task_id: "T1", pane_id: pane.pane_id }, { task_id: "T2", pane_id: pane.pane_id }]);
      expect(ran(launcher(e, "--dismiss-completed", runId))).toEqual({ status: 0, stderr: "" });
      expect({ pane_alive: alive(pane), a: termOf(e.root, a), b: termOf(e.root, b) }).toEqual({ pane_alive: true, a: null, b: null });
    }, 180_000);
  }

  it("positive: --reap with a complete valid single-member carrier kills the live pane and seals the orphan terminated", () => {
    const e = env();
    const runId = "run-e00-lr2-f1-pos-single";
    const ids = seedAttempt(e.root, runId, "orphan");
    ownedPane(e, "holder");
    const pane = carrierPane(e, "worker", "backend--T1--a1");
    writeCarrier(e.root, ids, pane);
    writeSession(e.root, runId, [{ task_id: "T1", pane_id: pane.pane_id }]);
    expect(ran(launcher(e, "--reap", runId))).toEqual({ status: 0, stderr: "" });
    expect({ pane_alive: alive(pane), terminal_state: termOf(e.root, ids) }).toEqual({ pane_alive: false, terminal_state: "terminated" });
  }, 180_000);

  it("positive: --dismiss-completed with complete agreeing shared carriers kills the shared pane and seals both lanes", () => {
    const e = env();
    const runId = "run-e00-lr2-f1-pos-shared";
    const a = seedAttempt(e.root, runId, "accepted", "T1");
    const b = seedAttempt(e.root, runId, "accepted", "T2");
    ownedPane(e, "holder");
    const pane = carrierPane(e, "worker", "backend--shared");
    const members = [memberOf(a, pane.title), memberOf(b, pane.title)];
    writeCarrier(e.root, a, pane, { members });
    writeCarrier(e.root, b, pane, { members });
    writeSession(e.root, runId, [{ task_id: "T1", pane_id: pane.pane_id }, { task_id: "T2", pane_id: pane.pane_id }]);
    expect(ran(launcher(e, "--dismiss-completed", runId))).toEqual({ status: 0, stderr: "" });
    expect({ pane_alive: alive(pane), a: termOf(e.root, a), b: termOf(e.root, b) }).toEqual({ pane_alive: false, a: "terminated", b: "terminated" });
  }, 180_000);
});

// ── L2-F2 · exact canonical no-server / ENOENT answers only ──

function workerPort(e: Env, run: Env["run"]) {
  adoptDefinition(e.root, "backend");
  const stubPlugin = path.join(e.root, ".stub-plugin");
  fs.mkdirSync(stubPlugin, { recursive: true });
  const assignmentRel = ".guild/runs/run-e00-lr2/task-cells/T1/attempts/1/instances/i1/assignment.json";
  fs.mkdirSync(path.dirname(path.join(e.root, assignmentRel)), { recursive: true });
  fs.writeFileSync(path.join(e.root, assignmentRel), "{\"schema_version\":\"guild.task_assignment.v2\"}\n");
  const port = new TmuxTaskCellWorkerPort({
    cwd: e.root, sessionName: "e00-lr2-port",
    snapshotDir: path.join(e.root, ".guild", "runs", "run-e00-lr2", "controller", "launch"),
    resolveDefinition: (inst) => resolveAdoptedDefinition(e.root, inst.worker_role),
    receiptPath: (inst) => path.join(e.root, ".guild", "runs", "run-e00-lr2", "handoffs", `${inst.worker_role}-${inst.logical_task_id}.md`),
    ackArgv: ["node", path.join(e.root, "task-cell-ack.js")],
    run,
    env: { PATH: `${e.bin}:${process.env["PATH"] ?? "/usr/bin:/bin"}`, HOME: process.env["HOME"] ?? e.root, SHELL: fs.existsSync("/bin/zsh") ? "/bin/zsh" : "/bin/sh", LANG: "en_US.UTF-8" },
    activate: () => ({ args: ["--plugin-dir", stubPlugin], pluginRoot: stubPlugin }),
  });
  const input = {
    instance_id: "i1", run_id: "run-e00-lr2", assignment_path: assignmentRel,
    instance: {
      instance_id: "i1", run_id: "run-e00-lr2", logical_task_id: "T1", worker_role: "backend", host_id: "claude-code-cli",
      specialist_profile_hash: `sha256:${TEST_PROFILE_HASH}`, specialist_type_hash: `sha256:${TEST_TYPE_HASH}`,
      projection: { tools: ["read", "write"], permissions: [], recorded_losses: [] }, model_id: null,
    },
  };
  return { port, spawn: () => port.spawn(input as never) };
}

/** Inject `answer` for show-environment calls made before any create; later reads are real. */
function preCreateProbe(e: Env, answer: (sock: string) => { status: number | null; stdout: string; stderr: string }) {
  const base = shimCalls(e).length;
  const stages: Array<{ creates_before: number; injected: boolean }> = [];
  const run = (cmd: string, args: string[], o: Record<string, unknown> = {}) => {
    if (cmd === "tmux" && args[0] === "show-environment") {
      const before = creates(e, base);
      stages.push({ creates_before: before, injected: before === 0 });
      if (before === 0) return answer(e.shim.socket);
    }
    return e.run(cmd, args, o);
  };
  return { run, stages, base };
}

const NONCANONICAL: Array<[string, (sock: string) => { status: number | null; stdout: string; stderr: string }]> = [
  ["no-server with appended permission error", (s) => ({ status: 1, stdout: "", stderr: `no server running on ${s} (Permission denied)\n` })],
  ["no-server with appended junk", (s) => ({ status: 1, stdout: "", stderr: `no server running on ${s} junk\n` })],
  ["mixed errno: permission error then ENOENT", (s) => ({ status: 1, stdout: "", stderr: `error connecting to ${s} (Permission denied) (No such file or directory)\n` })],
  ["ENOENT with appended junk", (s) => ({ status: 1, stdout: "", stderr: `error connecting to ${s} (No such file or directory) junk\n` })],
  ["no-server with a trailing CR", (s) => ({ status: 1, stdout: "", stderr: `no server running on ${s}\r\n` })],
  ["no-server followed by a second line", (s) => ({ status: 1, stdout: "", stderr: `no server running on ${s}\nerror connecting to ${s} (Permission denied)\n` })],
  ["no-server with non-empty stdout", (s) => ({ status: 1, stdout: "junk\n", stderr: `no server running on ${s}\n` })],
];

describe.skipIf(!tmuxAvailable)("L2-F2 · only the exact canonical no-server / ENOENT answer authorizes pre-create absence", () => {
  for (const [label, answer] of NONCANONICAL) {
    it(`${label}: creation refused, spawn_effect none, no create, no identity`, () => {
      const e = env();
      const p = preCreateProbe(e, answer);
      const { port, spawn } = workerPort(e, p.run);
      const out = spawn();
      expect(p.stages[0]).toEqual({ creates_before: 0, injected: true });
      expect({ ok: out.ok, spawn_effect: (out as { spawn_effect?: unknown }).spawn_effect ?? null, creates: creates(e, p.base), identity: port.paneIdentity("i1") })
        .toEqual({ ok: false, spawn_effect: "none", creates: 0, identity: null });
    });
  }

  const CANONICAL: Array<[string, (sock: string) => { status: number | null; stdout: string; stderr: string }]> = [
    ["exact 'no server running on <socket>'", (s) => ({ status: 1, stdout: "", stderr: `no server running on ${s}\n` })],
    ["exact socket ENOENT", (s) => ({ status: 1, stdout: "", stderr: `error connecting to ${s} (No such file or directory)\n` })],
  ];
  for (const [label, answer] of CANONICAL) {
    it(`positive: ${label} before create allows creation; post-create reads are real`, () => {
      const e = env();
      const p = preCreateProbe(e, answer);
      const { port, spawn } = workerPort(e, p.run);
      const out = spawn();
      expect({ first: p.stages[0], post_real: p.stages.filter((s) => s.creates_before > 0).every((s) => !s.injected) }).toEqual({ first: { creates_before: 0, injected: true }, post_real: true });
      expect({ ok: out.ok, identity: port.paneIdentity("i1") !== null }).toEqual({ ok: true, identity: true });
    });
  }

  it("positive: a real fresh socket (real tmux ENOENT, nothing injected) allows the first launch", () => {
    const e = env();
    const before = e.run("tmux", ["show-environment", "-g", "GUILD_RUN_BINDING_REF"]);
    // Precondition: the real answer is the single-line ENOENT form.
    expect({ status: before.status, enoent: /^error connecting to \S+ \(No such file or directory\)\n?$/.test(before.stderr) }).toEqual({ status: 1, enoent: true });
    const { port, spawn } = workerPort(e, e.run);
    expect({ ok: spawn().ok, identity: port.paneIdentity("i1") !== null }).toEqual({ ok: true, identity: true });
  });
});

// ── L2-F3 · the whole C-locale process table must validate ──

function deadServerIdentity(e: Env) {
  ownedPane(e, "holder");
  const server = tmuxServerIdentity(e.run)!;
  tmuxOn(e.shim, ["kill-server"]);
  return server;
}
/** The real full C-locale table as `ps -A -o pid=,lstart=` prints it. */
function realTable(): string[] {
  const r = spawnSync("/bin/ps", ["-A", "-o", "pid=,lstart="], { encoding: "utf8", env: { LC_ALL: "C", PATH: "/usr/bin:/bin" } });
  expect(r.status).toBe(0);
  return r.stdout.split("\n").filter((l) => l.trim().length > 0);
}
const pidOf = (line: string) => Number(line.trim().split(/\s+/)[0]);
const startOf = (line: string) => line.trim().replace(/^\d+\s+/, "");
/** A real start string of another process, different from `notStart`. */
const otherStart = (table: string[], notStart: string) => startOf(table.find((l) => startOf(l) !== notStart)!);

function teardownWithTable(e: Env, server: { pid: number; process_start: string }, proc: { pid: number; start: string }, table: (rows: string[]) => string) {
  let injected = 0;
  const run = (cmd: string, args: string[], o: Record<string, unknown> = {}) => {
    if (cmd === "ps" && args.join(" ") === "-A -o pid=,lstart=") { injected++; return { status: 0, stdout: table(realTable()), stderr: "" }; }
    return e.run(cmd, args, o);
  };
  const out = terminateBoundPane("%0", { pane_id: "%0", pane_pid: proc.pid, pane_process_start: proc.start, server_pid: server.pid, server_process_start: server.process_start }, { run });
  return { out: { ok: out.ok, confirmed: out.confirmed, identity_check: out.identity_check }, injected };
}

const MALFORMED: Array<[string, (rows: string[], proc: { pid: number; start: string }) => string]> = [
  ["status 0 table '1 garbage' only", () => "1 garbage\n"],
  ["real table without the target plus a '1 garbage' row", (rows, p) => [...rows.filter((l) => pidOf(l) !== p.pid), "1 garbage"].join("\n") + "\n"],
  ["a reused-start target row BEFORE a later '1 garbage' row", (rows, p) => [`${p.pid} ${otherStart(rows, p.start)}`, "1 garbage", ...rows.filter((l) => pidOf(l) !== p.pid)].join("\n") + "\n"],
  ["real table without the target, one other row with an invalid date", (rows, p) => {
    const others = rows.filter((l) => pidOf(l) !== p.pid);
    return [`${pidOf(others[0]!)} Xyz Abc 99 99:99:99 2026`, ...others.slice(1)].join("\n") + "\n";
  }],
  ["duplicate target rows: a reused start then the real start", (rows, p) => [`${p.pid} ${otherStart(rows, p.start)}`, `${p.pid} ${p.start}`, ...rows.filter((l) => pidOf(l) !== p.pid)].join("\n") + "\n"],
  ["the target row's start is not a C-locale date", (rows, p) => [`${p.pid} garbage words`, ...rows.filter((l) => pidOf(l) !== p.pid)].join("\n") + "\n"],
];

describe.skipIf(!tmuxAvailable)("L2-F3 · a malformed process table never confirms a no-server death", () => {
  for (const [label, table] of MALFORMED) {
    it(`terminateBoundPane, ${label}: unavailable, not confirmed, the live recorded process untouched`, () => {
      const e = env();
      const server = deadServerIdentity(e);
      const proc = ownedProcess(e);
      const r = teardownWithTable(e, server, proc, (rows) => table(rows, proc));
      // Preconditions: the fault was exercised, no server answers, the recorded process is alive.
      expect({ injected: r.injected > 0, no_server: tmuxServerIdentity(e.run) === null, alive: alive(proc) }).toEqual({ injected: true, no_server: true, alive: true });
      expect(r.out).toEqual({ ok: false, confirmed: false, identity_check: "unavailable" });
      expect(alive(proc)).toBe(true);
    });
  }

  it("positive: exact real C-locale table with the target alive is not a death (unavailable, alive)", () => {
    const e = env();
    const server = deadServerIdentity(e);
    const proc = ownedProcess(e);
    const r = teardownWithTable(e, server, proc, (rows) => rows.join("\n") + "\n");
    expect({ injected: r.injected > 0, has_target: realTable().some((l) => pidOf(l) === proc.pid) }).toEqual({ injected: true, has_target: true });
    expect({ ...r.out, alive: alive(proc) }).toEqual({ ok: false, confirmed: false, identity_check: "unavailable", alive: true });
  });

  it("positive: exact C-locale table whose target row carries another real start (pid reused) confirms the recorded process gone", () => {
    const e = env();
    const server = deadServerIdentity(e);
    const proc = ownedProcess(e);
    // Exact real rows (original right-aligned pid padding kept); only the target's start differs.
    const r = teardownWithTable(e, server, proc, (rows) => rows.map((l) => (pidOf(l) === proc.pid ? l.replace(startOf(l), otherStart(rows, proc.start)) : l)).join("\n") + "\n");
    expect(r.injected).toBeGreaterThan(0);
    expect(r.out).toEqual({ ok: true, confirmed: true, identity_check: "verified" });
  });

  it("positive: the recorded process really gone (real kill, real ps) confirms; no-server alone is never the proof", async () => {
    const e = env();
    const server = deadServerIdentity(e);
    const proc = ownedProcess(e);
    proc.kill();
    for (let i = 0; i < 50 && alive(proc); i++) await sleep(20);
    expect(alive(proc)).toBe(false);
    const out = terminateBoundPane("%0", { pane_id: "%0", pane_pid: proc.pid, pane_process_start: proc.start, server_pid: server.pid, server_process_start: server.process_start }, { run: e.run });
    expect({ ok: out.ok, confirmed: out.confirmed, identity_check: out.identity_check }).toEqual({ ok: true, confirmed: true, identity_check: "verified" });
  });

  /** The launcher CLI path: a test-owned `ps` first on PATH answers only the full-table query. */
  function faultPs(e: Env, body: string): { dir: string; log: string } {
    const dir = path.join(e.root, ".fault-ps");
    const log = path.join(dir, "uses.log");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "ps"), `#!/bin/sh\nif [ "$*" = "-A -o pid=,lstart=" ]; then echo used >> '${log}'; ${body}; exit 0; fi\nexec /bin/ps "$@"\n`, { mode: 0o755 });
    return { dir, log };
  }
  function orphanOnDeadServer(e: Env, runId: string) {
    const ids = seedAttempt(e.root, runId, "orphan");
    const pane = carrierPane(e, "worker", "backend--T1--a1");
    const proc = ownedProcess(e);
    // The carrier records the real created pane, with the recorded worker process being a live
    // owned process that outlives the server (the worker the reaper must not seal as dead).
    writeCarrier(e.root, ids, { ...pane, pid: proc.pid, start: proc.start });
    writeSession(e.root, runId, [{ task_id: "T1", pane_id: pane.pane_id }]);
    tmuxOn(e.shim, ["kill-server"]);
    return { ids, proc };
  }

  it("--reap through the real CLI, ps prints '1 garbage' with status 0: the orphan stays nonterminal and the worker lives", () => {
    const e = env();
    const { ids, proc } = orphanOnDeadServer(e, "run-e00-lr2-f3-reap");
    const f = faultPs(e, "printf '1 garbage\\n'");
    const r = launcher(e, "--reap", "run-e00-lr2-f3-reap", f.dir);
    expect({ fault_used: fs.existsSync(f.log), no_server: tmuxServerIdentity(e.run) === null }).toEqual({ fault_used: true, no_server: true });
    expect(ran(r)).toEqual({ status: 0, stderr: "" });
    expect({ worker_alive: alive(proc), terminal_state: termOf(e.root, ids) }).toEqual({ worker_alive: true, terminal_state: null });
  }, 180_000);

  it("positive: --reap through the real CLI with real ps and the recorded worker really gone seals the orphan terminated", async () => {
    const e = env();
    const { ids, proc } = orphanOnDeadServer(e, "run-e00-lr2-f3-reap-pos");
    proc.kill();
    for (let i = 0; i < 50 && alive(proc); i++) await sleep(20);
    expect(alive(proc)).toBe(false);
    expect(ran(launcher(e, "--reap", "run-e00-lr2-f3-reap-pos"))).toEqual({ status: 0, stderr: "" });
    expect(termOf(e.root, ids)).toBe("terminated");
  }, 180_000);
});
