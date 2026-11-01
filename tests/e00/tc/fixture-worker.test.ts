/**
 * E00-T0 · contract of the TC fixture worker (runs at TA, not gated): given an
 * absolute GUILD_TASK_ASSIGNMENT it writes declared artifact_exists targets and the
 * frozen-format lane receipt, runs the compiled TaskCompleted hook from the package
 * derived from its ack CLI, records receipt -> hook -> ack order, then runs the ack
 * CLI from a non-root cwd; it writes a secret-safe windowed env check (F3) and never
 * opens binding.json (a FIFO here: an open would hang the worker).
 *
 * Unit layout (archival amendment B2): an owned package dir holding a byte copy of
 * the worktree's compiled hooks/agent-team/dist/task-completed.js and a unit ack stub
 * at runtime/scripts/task-cell-ack.js. The assignment is a real E00 TaskCell written
 * through the canonical helpers. Unqualified unit fixture: no installed, native or
 * package-identity claim (the owned layout has no release identity). It is test
 * infrastructure for tc/e00-installed-package.tc.test.ts.
 */
import { describe, it, expect, afterEach } from "bun:test";
import { spawn, spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { buildTaskCell, writeTaskCell } from "../../../src/domains/dispatch";
import { mintRunBinding } from "../../../src/domains/lifecycle";
import { ensureStorageLayout } from "../../../hooks/lib/ensure-layout";
import { PLUGIN, ownChild, ownedTempDir, sha256, teardownOwned } from "../support/e00-harness";

afterEach(teardownOwned);

const WORKER = path.join(__dirname, "fixture-worker.mjs");
const COMPILED_HOOK = path.join(PLUGIN, "hooks", "agent-team", "dist", "task-completed.js");
const NONCE = "rb-fixture-worker-test-nonce";
const RUN = "run-fw";

function setup(mode: string) {
  const root = ownedTempDir("guild-e00-fw-");
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  const bindingRef = mintRunBinding({ root, run_id: RUN }).binding_ref;
  const c = buildTaskCell({
    runId: RUN, logicalTaskId: "T1", taskRunId: "T1.tr1", attempt: 1, attemptId: "T1.att1",
    instanceId: "T1.a1.i1", cellId: "cell-T1", goalId: "goal-fw", phaseId: "build", stepId: "T1",
    teamId: "guild-team", workerRole: "backend", specialistTypeId: "backend", specialistTypeVersion: "1",
    specialistTypeHash: "sha256:type", specialistProfileId: "backend", specialistProfileHash: "sha256:profile",
    contextBundleId: `.guild/context/${RUN}/backend-T1.md`, contextBundleHash: "sha256:ctx",
    hostId: "claude-code-cli", adapterId: "claude-code-cli@1", hostCapabilitiesHash: "sha256:caps",
    substrate: "tmux", modelTier: "mid", objective: "fw", scopePaths: ["src"],
    outputSchema: "guild.handoff_receipt.v1", acceptanceTests: ["tc"],
    projection: { tools: ["read", "write"], permissions: [], recorded_losses: [] }, autonomyPolicy: "supervised",
    budgets: { tokens: null, wall_clock_ms: null, cost_usd: null }, leadBindingId: "lead-binding-fw",
    now: () => "2026-10-26T13:00:00.000Z",
    doneWhen: [{ id: "a", oracle: "artifact_exists", target: JSON.stringify({ path: "src/out/T1.txt", sha256: null }) }] as never,
  });
  (c.assignment as Record<string, unknown>)["done_when_ref"] = { oracle_plan_path: `.guild/runs/${RUN}/oracle-plan/build.json`, oracle_plan_sha256: "a".repeat(64), decision_sha256: "b".repeat(64) };
  writeTaskCell(root, c, { binding_ref: bindingRef });
  expect(ensureStorageLayout(root, "e00-t0-fixture").ok).toBe(true);
  // The worker (and the unbound hook it runs) must never open binding.json: it is a FIFO in every case.
  const binding = path.join(root, ".guild", "runs", RUN, "binding.json");
  fs.rmSync(binding);
  expect(spawnSync("mkfifo", [binding]).status).toBe(0);
  const pkg = ownedTempDir("guild-e00-fw-pkg-");
  fs.mkdirSync(path.join(pkg, "hooks", "agent-team", "dist"), { recursive: true });
  fs.copyFileSync(COMPILED_HOOK, path.join(pkg, "hooks", "agent-team", "dist", "task-completed.js"));
  const ackLog = path.join(root, "ack-calls.txt");
  const ackCli = path.join(pkg, "runtime", "scripts", "task-cell-ack.js");
  fs.mkdirSync(path.dirname(ackCli), { recursive: true });
  fs.writeFileSync(ackCli, `require("fs").appendFileSync(${JSON.stringify(ackLog)}, process.cwd() + " " + process.argv.slice(2).join(" ") + "\\n");\n`);
  fs.writeFileSync(path.join(root, ".tc-worker-mode.json"), JSON.stringify({ mode, ackCli, packageId: "pkg-1", nonceSha256: sha256(NONCE), nonceLength: Buffer.byteLength(NONCE) }));
  const assignmentPath = path.join(root, c.assignment.assignment_path);
  const runDir = path.join(root, ".guild", "runs", RUN);
  const notice = path.join(runDir, "outbox", c.assignment.instance_id, "task-completed-notice.json");
  return { root, runDir, assignmentPath, ackLog, notice, instanceId: c.assignment.instance_id, binding };
}

/** Run the worker as the pane would (absolute assignment, GUILD_RUN_ID) until it recorded the receipt (no-ack) or a completed ack. */
async function runWorker(f: ReturnType<typeof setup>, cwd: string, extraEnv: Record<string, string> = {}): Promise<void> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !k.startsWith("GUILD_")) env[k] = v;
  const child = ownChild(spawn("node", [WORKER], { cwd, env: { ...env, ...extraEnv, GUILD_RUN_ID: RUN, GUILD_TASK_ASSIGNMENT: f.assignmentPath }, stdio: "ignore" }), f.root);
  const result = path.join(f.root, ".tc-hook-result.json");
  const done = () => { if (!fs.existsSync(result)) return false; const r = JSON.parse(fs.readFileSync(result, "utf8")); return r.mode === "no-ack" || r.ack_completed === true; };
  const until = Date.now() + 30_000;
  try {
    while (Date.now() < until && !done()) await new Promise((r) => setTimeout(r, 50));
    if (!done()) throw new Error("fixture worker did not record its receipt/ack observations within 30s");
  } finally {
    child.kill("SIGKILL");
  }
}

const envCheck = (root: string) => JSON.parse(fs.readFileSync(path.join(root, ".tc-worker-env.json"), "utf8"));
const hookResult = (root: string) => JSON.parse(fs.readFileSync(path.join(root, ".tc-hook-result.json"), "utf8"));

describe("TC fixture worker contract", () => {
  it("writes artifact and receipt, runs the compiled hook (notice), then acks from <root>/src with the absolute locator, without opening binding.json", async () => {
    const f = setup("normal");
    await runWorker(f, os.tmpdir());
    expect(fs.readFileSync(f.ackLog, "utf8").trim()).toBe(`${path.join(f.root, "src")} --assignment ${f.assignmentPath}`);
    expect(fs.existsSync(path.join(f.root, "src", "out", "T1.txt"))).toBe(true);
    const receipt = fs.readFileSync(path.join(f.runDir, "handoffs", "backend-T1.md"), "utf8");
    expect(receipt.startsWith("---\nschema_version: guild.handoff_receipt.v1\n")).toBe(true);
    expect(receipt).toContain("```guild.handoff.v2");
    const hr = hookResult(f.root);
    expect(hr).toMatchObject({ invocation: "synthetic_fixture_event", hook_present: true, hook_ran: true, hook_exit: 0, hook_timed_out: false,
      notice_present_after_hook: true, ack_claim_present_at_hook: false, ack_started: true, ack_completed: true, ack_exit: 0,
      changed_fields: [], steps: { receipt: 1, hook: 2, ack_cli: 3 } });
    expect(hr.events.map((e: { event: string }) => e.event)).toEqual(["receipt_written", "hook_completed", "ack_started", "ack_completed"]);
    const notice = JSON.parse(fs.readFileSync(f.notice, "utf8"));
    expect(notice).toMatchObject({ schema_version: "guild.task_completed_notice.v1", run_id: RUN, instance_id: f.instanceId, package_identity: null });
    expect(fs.lstatSync(f.binding).isFIFO()).toBe(true);
  });

  it("waits for an assignment the controller publishes after readiness, through a non-atomic exclusive write, then proceeds", async () => {
    const f = setup("normal");
    const bytes = fs.readFileSync(f.assignmentPath);
    fs.rmSync(f.assignmentPath);
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !k.startsWith("GUILD_")) env[k] = v;
    const child = ownChild(spawn("node", [WORKER], { cwd: f.root, env: { ...env, GUILD_RUN_ID: RUN, GUILD_TASK_ASSIGNMENT: f.assignmentPath }, stdio: "ignore" }), f.root);
    let exit: number | null = null;
    child.on("exit", (c) => { exit = c; });
    await new Promise((r) => setTimeout(r, 1000));
    expect({ exit, env_check: fs.existsSync(path.join(f.root, ".tc-worker-env.json")) }).toEqual({ exit: null, env_check: false });
    // Regression input: a non-atomic exclusive write (create, then bytes). The C6 production writer is atomic.
    const fd = fs.openSync(f.assignmentPath, "wx");
    await new Promise((r) => setTimeout(r, 500));
    expect({ exit, env_check: fs.existsSync(path.join(f.root, ".tc-worker-env.json")) }).toEqual({ exit: null, env_check: false });
    fs.writeSync(fd, bytes);
    fs.closeSync(fd);
    const until = Date.now() + 30_000;
    while (Date.now() < until && !(fs.existsSync(path.join(f.root, ".tc-hook-result.json")) && hookResult(f.root).ack_completed === true)) await new Promise((r) => setTimeout(r, 50));
    expect(exit).toBeNull();
    expect(hookResult(f.root)).toMatchObject({ hook_exit: 0, notice_present_after_hook: true, ack_completed: true, ack_exit: 0, steps: { receipt: 1, hook: 2, ack_cli: 3 } });
    expect(fs.readFileSync(f.ackLog, "utf8").trim()).toBe(`${path.join(f.root, "src")} --assignment ${f.assignmentPath}`);
  });

  it("exits 3 without writing anything when no assignment appears within its bound", () => {
    const f = setup("normal");
    const mode = JSON.parse(fs.readFileSync(path.join(f.root, ".tc-worker-mode.json"), "utf8"));
    fs.writeFileSync(path.join(f.root, ".tc-worker-mode.json"), JSON.stringify({ ...mode, assignmentWaitMs: 1500 }));
    fs.rmSync(f.assignmentPath);
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !k.startsWith("GUILD_")) env[k] = v;
    const started = Date.now();
    const r = spawnSync("node", [WORKER], { cwd: f.root, env: { ...env, GUILD_RUN_ID: RUN, GUILD_TASK_ASSIGNMENT: f.assignmentPath }, timeout: 30_000 });
    expect(r.status).toBe(3);
    expect(Date.now() - started).toBeGreaterThanOrEqual(1500);
    expect(["env", "hook"].map((k) => fs.existsSync(path.join(f.root, k === "env" ? ".tc-worker-env.json" : ".tc-hook-result.json")))).toEqual([false, false]);
    expect(fs.existsSync(f.ackLog)).toBe(false);
  });

  // The env-detection cases run in no-ack mode (neither hook nor ack), so binding.json stays a FIFO throughout.
  it("reports a clean environment as booleans only", async () => {
    const f = setup("no-ack");
    await runWorker(f, f.root);
    const check = envCheck(f.root);
    expect(check).toMatchObject({ binding_ref_env_present: false, nonce_digest_supplied: true, nonce_digest_matched: false, assignment_locator_absolute: true });
    expect(check.windows_checked).toBeGreaterThan(0);
    expect(fs.readFileSync(path.join(f.root, ".tc-worker-env.json")).includes(Buffer.from(NONCE))).toBe(false);
  });

  it("detects a forwarded binding env key and a nonce embedded in another variable (non-vacuous)", async () => {
    const f = setup("no-ack");
    await runWorker(f, f.root, { GUILD_RUN_BINDING_REF: NONCE, SOME_EXPORT: `x=${NONCE}` });
    expect(envCheck(f.root)).toMatchObject({ binding_ref_env_present: true, nonce_digest_matched: true });
    expect(fs.readFileSync(path.join(f.root, ".tc-worker-env.json")).includes(Buffer.from(NONCE))).toBe(false);
  });

  it("detects a nonce embedded with an undelimited prefix and suffix", async () => {
    const f = setup("no-ack");
    await runWorker(f, f.root, { OPAQUE_BLOB: `abc${NONCE}xyz` });
    expect(envCheck(f.root)).toMatchObject({ binding_ref_env_present: false, nonce_digest_matched: true });
    expect(fs.readFileSync(path.join(f.root, ".tc-worker-env.json")).includes(Buffer.from(NONCE))).toBe(false);
  });

  it("does not report a nonce split by the key=value separator (never contiguous; specificity control)", async () => {
    const f = setup("no-ack");
    const half = Math.floor(NONCE.length / 2);
    await runWorker(f, f.root, { [`K${NONCE.slice(0, half)}`]: `${NONCE.slice(half)}tail` });
    expect(envCheck(f.root).nonce_digest_matched).toBe(false);
  });

  it("bad-notice changes only the hook notice's instance_id; no-ack runs neither the hook nor the ack CLI", async () => {
    const bad = setup("bad-notice");
    await runWorker(bad, bad.root);
    expect(hookResult(bad.root)).toMatchObject({ hook_exit: 0, notice_present_after_hook: true, ack_completed: true, ack_exit: 0, changed_fields: ["instance_id"] });
    expect(JSON.parse(fs.readFileSync(bad.notice, "utf8")).instance_id).toBe(`${bad.instanceId}-other`);
    const none = setup("no-ack");
    await runWorker(none, none.root);
    expect(hookResult(none.root)).toMatchObject({ mode: "no-ack", hook_ran: false, ack_started: false, steps: { receipt: 1 } });
    expect({ ack_called: fs.existsSync(none.ackLog), notice: fs.existsSync(none.notice) }).toEqual({ ack_called: false, notice: false });
  });
});
