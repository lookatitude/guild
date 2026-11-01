import { it, expect, afterAll } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createRunLifecycle, createRealEnv, claimManagedAttempt, readManagedAttempt, managedLaunchHash, runManagedWorker, reconcileManagedAttempt, prepareManagedWorker, type ManagedLaunchSpec, type ManagedOwnedProcess, type ManagedProcessPort, type ManagedControlPort } from "../../src/domains/lifecycle";
import { ManagedNodeProcessPort, ManagedLocalControlPort, requestManagedControl, launchManagedWorker } from "../../src/adapters";
import { StackScope } from "../../src/domains/state";

const hash = (bytes: string | Buffer) => "sha256:" + createHash("sha256").update(bytes).digest("hex");
const node = fs.realpathSync(execFileSync("which", ["node"], { encoding: "utf8" }).trim()), nodeHash = hash(fs.readFileSync(node));
const facts: Record<string, unknown>[] = [], proofFile = process.env.QA_A08_PROOF;
function record(fact: Record<string, unknown>) { facts.push(fact); if (proofFile) fs.writeFileSync(proofFile, JSON.stringify({ classification: "local_no_model_process_qa", facts }, null, 2) + "\n"); }
afterAll(() => { record({ event: "test_file_finished" }); });
const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
async function bounded<T>(promise: Promise<T>, ms: number, label: string): Promise<T> { let timer: ReturnType<typeof setTimeout>; try { return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(label + " timed out")), ms); })]); } finally { clearTimeout(timer!); } }
async function until(check: () => boolean, ms = 2500) { const end = Date.now() + ms; while (!check()) { if (Date.now() > end) throw new Error("owned fixture did not become ready"); await sleep(10); } }
interface Owned { pid: number; process_group_id: number; start_identity: string; executable: string; executable_sha256: string }
function inspectOwned(pid: number): Owned | null {
  try {
    const start = fs.existsSync("/proc/" + pid + "/stat") ? "linux:" + fs.readFileSync("/proc/" + pid + "/stat", "utf8").split(") ")[1].split(" ")[19] : "ps:" + execFileSync("/bin/ps", ["-p", String(pid), "-o", "lstart="], { encoding: "utf8", timeout: 1000 }).trim();
    const state = execFileSync("/bin/ps", ["-p", String(pid), "-o", "stat="], { encoding: "utf8", timeout: 1000 }).trim(); if (!start || !state || state.startsWith("Z")) return null;
    const executable = fs.realpathSync(fs.existsSync("/proc/" + pid + "/exe") ? fs.readlinkSync("/proc/" + pid + "/exe") : execFileSync("/bin/ps", ["-p", String(pid), "-o", "comm="], { encoding: "utf8", timeout: 1000 }).trim());
    const group = Number(execFileSync("/bin/ps", ["-p", String(pid), "-o", "pgid="], { encoding: "utf8", timeout: 1000 }).trim());
    return { pid, process_group_id: group, start_identity: start, executable, executable_sha256: hash(fs.readFileSync(executable)) };
  } catch { return null; }
}
function stillOwned(identity: Owned): boolean { const now = inspectOwned(identity.pid); return !!now && now.start_identity === identity.start_identity && now.executable === identity.executable && now.executable_sha256 === identity.executable_sha256 && now.process_group_id === identity.process_group_id; }
function groupGone(group: number): boolean { try { return !execFileSync("/bin/ps", ["-axo", "pgid=,stat="], { encoding: "utf8", timeout: 1000 }).split(/\r?\n/).some(row => { const [pgid, state] = row.trim().split(/\s+/); return Number(pgid) === group && !state?.startsWith("Z"); }); } catch { return false; } }
function killExact(identity: Owned): boolean { if (!stillOwned(identity)) return false; process.kill(-identity.process_group_id, "SIGKILL"); return true; }
function fixture(script: (home: string) => string, duration = 2000) {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "guild-a08-process-qa-"))), root = path.join(home, "project"), runtime = path.join(home, "runtime");
  fs.mkdirSync(path.join(root, ".git"), { recursive: true }); fs.mkdirSync(path.join(root, ".guild/config"), { recursive: true }); fs.mkdirSync(path.join(root, ".guild/runs"), { recursive: true });
  fs.writeFileSync(path.join(root, ".guild/guild.yaml"), "schema_version: guild.root.v1\nkind: project\n"); fs.writeFileSync(path.join(root, ".guild/config/project.json"), JSON.stringify({ advisorRounds: 2, tiers: { default: "mid" } })); fs.writeFileSync(path.join(root, ".guild/storage-layout.json"), JSON.stringify({ storage_layout_version: 2 })); fs.writeFileSync(path.join(root, ".guild/runs/current-run-id"), "run-20261025-220000-parent\n");
  const previous = process.env.GUILD_STATE_HOME; process.env.GUILD_STATE_HOME = path.join(home, "private-state");
  const lifecycle = createRunLifecycle(createRealEnv(root, requested => ({ requested, resolved: "codex" })));
  const plan = lifecycle.stageRunStart({ command: "/guild:build", arguments: { brief: "Independent no-model process QA" }, cwd: root, root, target_kind: "existing_guild_project", workspace: { is_workspace: false, root }, project: "qa", host_requested: "codex", model_tier_policy: "explicit", ignore_policy: "project", scan_policy: "none", initiative: null, session_identity: { envelope_host: "codex", active_model: "no-model-test" } }, { detached: true }); lifecycle.materializeRunStart(plan);
  const launch: ManagedLaunchSpec = { binary: node, binary_sha256: nodeHash, args: ["-e", script(home)], cwd: root, env: { PATH: process.env.PATH ?? "" }, max_duration_ms: duration, classification: "local_process_test", host_id: "local-no-model-qa", model: "none", max_usd: 0, strict_usd_qualified: false };
  const claimInput = { source_id: new StackScope(root).discover().root.source_id, operation_id: "op-independent", run_id: plan.run_id, attempt_id: "attempt-independent", launch_hash: managedLaunchHash(launch), max_duration_ms: duration };
  const identity = claimManagedAttempt(runtime, claimInput).identity, children: ManagedOwnedProcess[] = [], extra: Owned[] = [];
  let starts = 0;
  const native = new ManagedNodeProcessPort(), processPort: ManagedProcessPort = { async start(spec, admission) { starts++; const child = await native.start(spec, admission); children.push(child); const owned = inspectOwned(Number(child.identity.pid)); if (owned) { extra.push(owned); record({ event: "owned_child_started", identity: owned, classification: "local_no_model" }); } return child; } };
  const control = new ManagedLocalControlPort(runtime), dir = path.join(root, ".guild/runs", plan.run_id, "attempts", identity.attempt_id);
  const run = (port = processPort, controlPort: ManagedControlPort = control) => bounded(runManagedWorker({ runtimeDir: runtime, sourceRoot: root, identity, launch, process: port, control: controlPort, graceMs: 80 }), duration + 2000, "managed worker");
  return { home, root, runtime, plan, launch, identity, claimInput, dir, processPort, native, control, children, extra, run, get starts() { return starts; },
    async close() { for (const child of children) { if (child.verifyOwnership()) child.signalGroup("SIGKILL"); await bounded(child.exited, 1000, "owned child cleanup").catch(() => {}); } for (const owned of extra) { try { killExact(owned); } catch {} } await sleep(30); if (previous === undefined) delete process.env.GUILD_STATE_HOME; else process.env.GUILD_STATE_HOME = previous; fs.rmSync(home, { recursive: true, force: true }); }
  };
}
function test(name: string, work: (f: ReturnType<typeof fixture>) => Promise<void>, script: (home: string) => string, duration = 2000) { it(name, async () => { const f = fixture(script, duration); try { await work(f); } finally { await f.close(); } }, 10000); }

// Concurrent callers share one durable attempt, not merely one in-memory promise.
test("A08 concurrent worker admission starts one real child and terminal replay changes no evidence", async f => {
  const settled = await Promise.allSettled([f.run(), f.run()]); expect(settled.filter(v => v.status === "fulfilled")).toHaveLength(1); expect(settled.filter(v => v.status === "rejected")).toHaveLength(1); expect(f.starts).toBe(1);
  expect(fs.readFileSync(path.join(f.home, "spawn-count.txt"), "utf8").trim().split("\n")).toHaveLength(1);
  const before = Object.fromEntries(fs.readdirSync(f.dir).map(name => [name, hash(fs.readFileSync(path.join(f.dir, name)))]));
  const one = reconcileManagedAttempt(f.runtime, f.identity, { verifyOwnedWorker: () => false }), two = reconcileManagedAttempt(f.runtime, f.identity, { verifyOwnedWorker: () => false }); expect(one.outcome).toEqual(two.outcome); expect(one.can_relaunch).toBe(false); await expect(f.run()).rejects.toThrow(); expect(f.starts).toBe(1);
  expect(Object.fromEntries(fs.readdirSync(f.dir).map(name => [name, hash(fs.readFileSync(path.join(f.dir, name)))]))).toEqual(before);
  const privateClaim = readManagedAttempt(f.runtime, f.identity.attempt_id), publicBytes = fs.readdirSync(f.dir).map(name => fs.readFileSync(path.join(f.dir, name), "utf8")).concat(["attempt.json", "host-dispatch.json"].map(name => fs.readFileSync(path.join(path.dirname(path.dirname(f.dir)), name), "utf8"))).join("\n");
  expect(publicBytes.includes(privateClaim.worker_nonce)).toBe(false); expect(publicBytes.includes(f.plan.private_binding_ref)).toBe(false); expect(one.outcome?.usage.cost_usd).toBeNull(); expect(fs.readFileSync(path.join(f.root, ".guild/runs/current-run-id"), "utf8")).toBe("run-20261025-220000-parent\n");
}, home => "require('node:fs').appendFileSync(" + JSON.stringify(path.join(home, "spawn-count.txt")) + ",'one\\n');setTimeout(()=>{},100)");

test("A08 delaying a claimed preview does not consume the later admission deadline", async f => {
  expect(readManagedAttempt(f.runtime, f.identity.attempt_id).deadline_at).toBeNull(); await sleep(2200); const start = Date.now(), running = f.run();
  const readyFile = path.join(f.home, "admission-ready.json"); await until(() => fs.existsSync(readyFile));
  const ready = JSON.parse(fs.readFileSync(readyFile, "utf8")), claim = readManagedAttempt(f.runtime, f.identity.attempt_id);
  expect(ready.pid).toBe(claim.host?.host_pid); expect(claim.state).toBe("running");
  fs.writeFileSync(path.join(f.home, "admission-release"), "exit"); const outcome = await running;
  expect(outcome.state).toBe("exited"); expect(outcome.exit_code).toBe(0); expect(Date.parse(outcome.admitted_at)).toBeGreaterThanOrEqual(start - 10); expect(Date.parse(outcome.deadline_at) - Date.parse(outcome.admitted_at)).toBe(2000);
  expect(Date.parse(ready.ready_at)).toBeGreaterThanOrEqual(Date.parse(outcome.admitted_at)); expect(Date.parse(ready.ready_at)).toBeLessThan(Date.parse(outcome.deadline_at));
  record({ event: "delayed_admission", preview_delay_ms: 2200, admitted_at: outcome.admitted_at, deadline_at: outcome.deadline_at, duration_ms: 2000, host_ready: ready, controlled_exit: true });
}, home => "const fs=require('node:fs');fs.writeFileSync(" + JSON.stringify(path.join(home, "admission-ready.json")) + ",JSON.stringify({pid:process.pid,ready_at:new Date().toISOString()}));setInterval(()=>{if(fs.existsSync(" + JSON.stringify(path.join(home, "admission-release")) + "))process.exit(0)},10)", 2000);

test("A08 cancel kills an owned interrupt-ignoring descendant even when its group leader exits first", async f => {
  const running = f.run(); const marker = path.join(f.home, "grandchild.json");
  await until(() => fs.existsSync(marker) && readManagedAttempt(f.runtime, f.identity.attempt_id).state === "running");
  const { pid } = JSON.parse(fs.readFileSync(marker, "utf8")), descendant = inspectOwned(pid); expect(descendant).not.toBeNull(); f.extra.push(descendant!); record({ event: "owned_descendant_started", identity: descendant });
  const claim = readManagedAttempt(f.runtime, f.identity.attempt_id); await requestManagedControl(f.runtime, f.identity, claim.worker_nonce, "cancel"); const outcome = await bounded(running, 2500, "descendant cancellation");
  const survivor = stillOwned(descendant!); record({ event: "descendant_cancel_result", outcome: outcome.state, descendant_survived: survivor, process_identity: descendant });
  expect(outcome.state).toBe("cancelled"); expect(survivor).toBe(false);
}, home => {
  const grandchild = "require('node:fs').writeFileSync(" + JSON.stringify(path.join(home, "grandchild.json")) + ",JSON.stringify({pid:process.pid}));process.on('SIGINT',()=>{});setTimeout(()=>process.exit(0),5000);setInterval(()=>{},100)";
  return "require('node:child_process').spawn(process.execPath,['-e'," + JSON.stringify(grandchild) + "],{stdio:'ignore'});process.on('SIGINT',()=>process.exit(0));setTimeout(()=>process.exit(0),6000);setInterval(()=>{},100)";
}, 3000);


test("A08 a crash before spawn consumes admission and refuses changed intent or worker replay", async f => {
  expect(claimManagedAttempt(f.runtime, f.claimInput).created).toBe(false);
  expect(() => claimManagedAttempt(f.runtime, { ...f.claimInput, source_id: "other-source" })).toThrow();
  expect(() => claimManagedAttempt(f.runtime, { ...f.claimInput, launch_hash: hash("other-launch") })).toThrow();
  const refused: ManagedControlPort = { async open() { throw new Error("injected control-open crash before spawn"); } };
  await expect(f.run(f.processPort, refused)).rejects.toThrow("injected control-open crash");
  expect(f.starts).toBe(0); expect(readManagedAttempt(f.runtime, f.identity.attempt_id).admitted_at).toBeNull();
  const recovered = reconcileManagedAttempt(f.runtime, f.identity, { verifyOwnedWorker: () => false });
  expect(recovered).toEqual({ state: "recovery_needed", can_relaunch: false, outcome: null });
  await expect(f.run()).rejects.toThrow(); expect(f.starts).toBe(0);
  record({ event: "simulated_pre_spawn_control_crash", starts: f.starts, reconciliation: recovered });
}, () => "setTimeout(()=>{},100)");

test("A08 control rejects stale start identity and foreign nonce without cancelling the live owned group", async f => {
  const running = f.run(); await until(() => readManagedAttempt(f.runtime, f.identity.attempt_id).state === "running");
  const file = path.join(f.runtime, f.identity.attempt_id + ".control.json"), original = fs.readFileSync(file), endpoint = JSON.parse(original.toString());
  const claim = readManagedAttempt(f.runtime, f.identity.attempt_id);
  fs.writeFileSync(file, JSON.stringify({ ...endpoint, worker_start_identity: endpoint.worker_start_identity + ":stale" }));
  await expect(requestManagedControl(f.runtime, f.identity, claim.worker_nonce, "cancel")).rejects.toThrow("ownership unknown");
  fs.writeFileSync(file, original); await expect(requestManagedControl(f.runtime, f.identity, "foreign-worker-nonce", "cancel")).rejects.toThrow();
  expect(f.children[0].verifyOwnership()).toBe(true); expect(readManagedAttempt(f.runtime, f.identity.attempt_id).state).toBe("running");
  await requestManagedControl(f.runtime, f.identity, claim.worker_nonce, "cancel"); expect((await bounded(running, 2000, "owned cancel")).state).toBe("cancelled");
  record({ event: "simulated_stale_start_and_foreign_nonce", stale_start_refused: true, foreign_nonce_refused: true });
}, () => "process.on('SIGINT',()=>{});setInterval(()=>{},100)", 4000);

test("A08 uncertain process-group accounting remains recovery_needed with unknown spend and no relaunch", async f => {
  const uncertain: ManagedProcessPort = { async start(spec, admission) { const child = await f.processPort.start(spec, admission); return { ...child, groupGone: () => false }; } };
  const outcome = await f.run(uncertain); expect(outcome.state).toBe("recovery_needed"); expect(outcome.usage.state).toBe("unknown"); expect(outcome.usage.cost_usd).toBeNull();
  expect(reconcileManagedAttempt(f.runtime, f.identity, { verifyOwnedWorker: () => false })).toEqual({ state: "recovery_needed", can_relaunch: false, outcome });
  await expect(f.run()).rejects.toThrow(); expect(f.starts).toBe(1);
  record({ event: "simulated_unavailable_group_probe", actual_child_exit: true, state: outcome.state, cost_usd: outcome.usage.cost_usd });
}, () => "setTimeout(()=>{},40)");

test("A08 detached worker survives a real facade exit and worker SIGKILL cannot defeat the group deadline", async f => {
  const compiler = await import("../../scripts/compile"), entry = path.join(f.home, "worker.js");
  compiler.buildOne(compiler.targets().find(target => target.id === "scripts/stack-run-worker")!, entry);
  const worker = { node_binary: node, node_sha256: nodeHash, entry, entry_sha256: hash(fs.readFileSync(entry)) };
  prepareManagedWorker(f.runtime, { sourceRoot: f.root, identity: f.identity, launch: f.launch, worker });
  const facadeSource = path.join(f.home, "facade.ts"), facade = path.join(f.home, "facade.cjs");
  fs.writeFileSync(facadeSource, "import {launchManagedWorker} from " + JSON.stringify(path.resolve(import.meta.dir, "../../src/adapters")) + ";const handle=launchManagedWorker(" + JSON.stringify(f.runtime) + "," + JSON.stringify(f.identity) + "," + JSON.stringify(worker) + ");process.stdout.write(JSON.stringify({facade_pid:process.pid,...handle}));");
  compiler.buildOne({ ...compiler.targets().find(target => target.id === "scripts/stack-run-worker")!, id: "qa-facade", entry: facadeSource }, facade);
  const handle = JSON.parse(execFileSync(node, [facade], { encoding: "utf8", timeout: 5000 }));
  expect(inspectOwned(handle.facade_pid)).toBeNull(); await until(() => readManagedAttempt(f.runtime, f.identity.attempt_id).state === "running", 5000);
  const liveClaim = readManagedAttempt(f.runtime, f.identity.attempt_id);
  const detached = inspectOwned(handle.pid), host = inspectOwned(Number(liveClaim.host?.pid)), hostChild = inspectOwned(Number(liveClaim.host?.host_pid));
  expect(detached).not.toBeNull(); expect(host).not.toBeNull(); expect(hostChild).not.toBeNull(); f.extra.push(detached!, host!, hostChild!);
  record({ event: "real_facade_exited_worker_and_host_alive", facade_pid: handle.facade_pid, worker: detached, group_supervisor: host, host: hostChild });
  expect(killExact(detached!)).toBe(true); await until(() => !stillOwned(detached!));
  const recovered = reconcileManagedAttempt(f.runtime, f.identity, { verifyOwnedWorker: () => stillOwned(detached!) });
  expect(recovered).toEqual({ state: "recovery_needed", can_relaunch: false, outcome: null });
  expect(() => launchManagedWorker(f.runtime, f.identity, worker)).toThrow(); expect(stillOwned(host!)).toBe(true);
  expect(fs.readFileSync(path.join(f.root, ".guild/runs/current-run-id"), "utf8")).toBe("run-20261025-220000-parent\n");
  record({ event: "real_worker_sigkill_reconciliation", state: recovered.state, can_relaunch: recovered.can_relaunch, outcome: recovered.outcome, orphan_owned_identity: host });
  await sleep(Math.max(0, Date.parse(liveClaim.deadline_at!) - Date.now()) + 500);
  const gone = groupGone(host!.process_group_id); record({ event: "real_worker_sigkill_deadline_result", deadline_at: liveClaim.deadline_at, checked_at: new Date().toISOString(), group_gone: gone, supervisor_alive: stillOwned(host!), host_alive: stillOwned(hostChild!) });
  expect(gone).toBe(true); expect(stillOwned(hostChild!)).toBe(false);
  expect(reconcileManagedAttempt(f.runtime, f.identity, { verifyOwnedWorker: () => false })).toEqual({ state: "recovery_needed", can_relaunch: false, outcome: null });
}, () => "process.on('SIGINT',()=>{});setInterval(()=>{},100)", 2000);


test("A08 deadline kills a late-born descendant after the host itself has already exited", async f => {
  const running = f.run(), marker = path.join(f.home, "late-descendant.json"); await until(() => fs.existsSync(marker));
  const descendant = inspectOwned(JSON.parse(fs.readFileSync(marker, "utf8")).pid); expect(descendant).not.toBeNull(); f.extra.push(descendant!);
  const claim = readManagedAttempt(f.runtime, f.identity.attempt_id); expect(inspectOwned(Number(claim.host?.host_pid))).toBeNull();
  expect(claim.state).toBe("running"); const outcome = await bounded(running, 2500, "late descendant deadline");
  expect(outcome.state).toBe("timed_out"); expect(stillOwned(descendant!)).toBe(false);
  expect(Date.parse(outcome.deadline_at) - Date.parse(outcome.admitted_at)).toBe(1200);
  record({ event: "real_late_descendant_deadline", identity: descendant, host_already_exited: true, outcome: outcome.state, descendant_survived: stillOwned(descendant!) });
}, home => {
  const grandchild = "require('node:fs').writeFileSync(" + JSON.stringify(path.join(home, "late-descendant.json")) + ",JSON.stringify({pid:process.pid}));process.on('SIGINT',()=>{});setInterval(()=>{},100);setTimeout(()=>process.exit(0),5000)";
  const intermediate = "setTimeout(()=>{require('node:child_process').spawn(process.execPath,['-e'," + JSON.stringify(grandchild) + "],{stdio:'ignore'});process.exit(0)},150)";
  return "require('node:child_process').spawn(process.execPath,['-e'," + JSON.stringify(intermediate) + "],{stdio:'ignore'});process.exit(0)";
}, 1200);

test("A08 an executable pin change refuses group signals until the exact owned pin is restored", async f => {
  const bin = path.join(f.home, "bin"); fs.mkdirSync(bin); const library = path.resolve(path.dirname(node), "../lib");
  if (fs.existsSync(library)) fs.symlinkSync(library, path.join(f.home, "lib"), "dir");
  const copy = path.join(bin, "owned-node"), saved = copy + ".original"; fs.copyFileSync(node, copy); fs.chmodSync(copy, 0o700);
  const child = await f.native.start({ ...f.launch, binary: copy, binary_sha256: hash(fs.readFileSync(copy)) }); f.children.push(child);
  const readyFile = path.join(f.home, "pin-ready.json"); await until(() => fs.existsSync(readyFile));
  const ready = JSON.parse(fs.readFileSync(readyFile, "utf8")); expect(ready.pid).toBe(child.identity.host_pid);
  const owned = inspectOwned(Number(child.identity.pid)), host = inspectOwned(ready.pid); expect(owned).not.toBeNull(); expect(host).not.toBeNull(); f.extra.push(owned!, host!);
  try {
    expect(child.verifyOwnership()).toBe(true); fs.renameSync(copy, saved); fs.writeFileSync(copy, "replacement is not the pinned executable", { mode: 0o700 });
    expect(child.verifyOwnership()).toBe(false); expect(child.signalGroup("SIGKILL")).toBe(false); expect(stillOwned(owned!)).toBe(true);
    record({ event: "real_executable_path_pin_drift", identity: owned, ready_host: host, signal_refused: true, group_still_alive: true });
  } finally { if (fs.existsSync(saved)) { fs.rmSync(copy, { force: true }); fs.renameSync(saved, copy); } }
  expect(child.verifyOwnership()).toBe(true); expect(child.signalGroup("SIGKILL")).toBe(true); const exit = await bounded(child.exited, 1500, "restored exact pin cleanup");
  expect(exit.signal).toBe("SIGKILL"); record({ event: "real_restored_pin_controlled_stop", signal: exit.signal, identity: owned, host_ready: ready });
}, home => "require('node:fs').writeFileSync(" + JSON.stringify(path.join(home, "pin-ready.json")) + ",JSON.stringify({pid:process.pid,ready_at:new Date().toISOString()}));setInterval(()=>{},100)", 4000);
