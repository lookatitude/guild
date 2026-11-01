/**
 * E00-L r1 colocated controls: identity-bound teardown of ONE real pane shared by
 * two TaskCell lanes, through the worktree launcher CLI (not a HEAD archive). The
 * positive terminal and idempotence intent of the legacy G4 M1/M2 and round-2
 * cases, on matching per-instance carriers. Fixture seams are T0's (read-only).
 */
import { afterEach, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import {
  buildAcceptance, buildTaskCell, markAttemptOrphaned, readAttemptForInstance, runDeterministicFloor, taskCellPaths,
  writeAcceptanceRecord, writeTaskCell, type TaskCellDispatchInput,
} from "../../../src/domains/dispatch";
import { loadRunBinding, mintRunBinding } from "../../../src/domains/lifecycle";
import { PLUGIN, ownedTempDir, teardownOwned } from "../../../tests/e00/support/e00-harness";
import { installTmuxShim, resolveRealTmux, type TmuxShim } from "../../../tests/e00/tc/tmux-shim";
import { processStartOf } from "./tmux-backend";

afterEach(teardownOwned);

const tmuxAvailable = resolveRealTmux() !== null;
const SEED_NOW = () => "2026-07-15T00:00:00.000Z";
const BUN = (globalThis as { Bun?: { which(n: string): string | null } }).Bun?.which("bun") ?? "bun";
const KEY = "backend--shared";
let seq = 7100;

interface Env { root: string; bin: string; shim: TmuxShim }
function env(): Env {
  const root = ownedTempDir("guild-e00-l-shared-");
  fs.mkdirSync(path.join(root, ".guild"), { recursive: true });
  fs.writeFileSync(path.join(root, ".guild", "guild.yaml"), "schema_version: guild.root.v1\nkind: project\n");
  const bin = path.join(root, ".bin");
  return { root, bin, shim: installTmuxShim(root, bin) };
}
const tmux = (e: Env, args: string[]) => spawnSync(path.join(e.bin, "tmux"), args, { encoding: "utf8", timeout: 20000 });

function disp(runId: string, taskId: string): TaskCellDispatchInput {
  return {
    runId, logicalTaskId: taskId, taskRunId: `${taskId}.tr1`, attempt: 1, attemptId: `${taskId}.att1`, instanceId: `${taskId}.a1.i1`,
    cellId: `cell-${taskId}`, goalId: "goal", phaseId: "build", stepId: taskId, teamId: "guild", workerRole: "backend",
    specialistTypeId: "backend", specialistTypeVersion: "1", specialistTypeHash: "sha256:type", specialistProfileId: "backend", specialistProfileHash: "sha256:profile",
    contextBundleId: `.guild/context/${runId}/${taskId}.md`, contextBundleHash: "sha256:ctx", hostId: "claude-code-cli", adapterId: "claude-code-cli@1",
    hostCapabilitiesHash: "sha256:caps", substrate: "tmux", modelTier: "mid", objective: `implement ${taskId}`, nonGoals: [], scopePaths: [],
    outputSchema: "guild.handoff_receipt.v1", acceptanceTests: [], dependencies: [], projection: { tools: ["read", "write"], permissions: [], recorded_losses: [] },
    autonomyPolicy: "supervised", budgets: { tokens: null, wall_clock_ms: null, cost_usd: null }, deadline: null, leadBindingId: "lead-binding", now: SEED_NOW,
  };
}

function seed(root: string, runId: string, taskId: string, kind: "accepted" | "orphan" | "live") {
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
  } else if (kind === "orphan") {
    markAttemptOrphaned(root, ids, bind);
  }
  return ids;
}

/** A real owned pane on the shim's server, observed the way the capture rule reads it. */
function sharedPane(e: Env) {
  tmux(e, ["new-session", "-d", "-s", "holder", `sleep ${++seq}`]); // the server outlives the shared pane
  const out = tmux(e, ["new-session", "-d", "-P", "-F", "#{session_id} #{window_id} #{pid} #{start_time}", "-s", "worker", `sleep ${++seq}`]);
  expect(out.status).toBe(0);
  const [session_id, window_id, spid, sstart] = out.stdout.trim().split(" ");
  expect(tmux(e, ["select-pane", "-t", window_id!, "-T", KEY]).status).toBe(0);
  const [, , , pane_id, pane_pid] = tmux(e, ["list-panes", "-t", window_id!, "-F", "#{pid} #{start_time} #{window_id} #{pane_id} #{pane_pid}"]).stdout.trim().split(" ");
  return {
    pane: { pane_id: pane_id!, pane_pid: Number(pane_pid), pane_process_start: processStartOf(Number(pane_pid))!, window_id: window_id!, title: KEY },
    creating: { verb: "new-session", server_pid: Number(spid), server_process_start: `tmux-start_time:${sstart}`, session_id: session_id!, window_id: window_id! },
  };
}

function writeCarriers(root: string, members: Array<ReturnType<typeof seed>>, p: ReturnType<typeof sharedPane>): void {
  const shared = members.map((m) => ({ logical_task_id: m.logical_task_id, attempt: m.attempt, instance_id: m.instance_id, dispatch_key: KEY, specialist: "backend" }));
  for (const ids of members) {
    const file = path.join(root, taskCellPaths(ids).instance_dir, "pane-identity.json");
    fs.writeFileSync(file, JSON.stringify({
      schema_version: "guild.task_cell_pane_identity.v1", ...ids, launch_id: "launch-shared", created_at: new Date().toISOString(),
      creating_command: p.creating, pane: p.pane, shared_members: shared,
    }, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  }
}

function writeSession(root: string, runId: string, paneId: string): void {
  const dir = path.join(root, ".guild", "runs", runId, "agent-team");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "session.json"), JSON.stringify({ run_id: runId, backend: "tmux", teammate_panes: [
    { specialist: "backend", task_id: "T1", pane_id: paneId, host_kind: "claude", adapter_version: "1" },
    { specialist: "backend", task_id: "T2", pane_id: paneId, host_kind: "claude", adapter_version: "1" },
  ] }));
}

function launcher(e: Env, op: "--reap" | "--dismiss-completed", runId: string) {
  return spawnSync(BUN, [path.join(PLUGIN, "scripts", "agent-team-launcher.ts"), op, "--run-id", runId, "--cwd", e.root], {
    cwd: e.root, encoding: "utf8", timeout: 120000,
    env: { PATH: `${e.bin}:${process.env["PATH"] ?? "/usr/bin:/bin"}`, HOME: process.env["HOME"] ?? e.root, GUILD_PLUGIN_ROOT: PLUGIN },
  });
}

const alive = (p: { pane_pid: number; pane_process_start: string }) => processStartOf(p.pane_pid) === p.pane_process_start;
/** terminal_state as read; a missing record is "missing_record", never confused with null. */
const term = (root: string, ids: ReturnType<typeof seed>) => {
  const a = readAttemptForInstance(root, ids);
  return a === null ? "missing_record" : a.terminal_state;
};
const sha = (f: string) => createHash("sha256").update(fs.readFileSync(f)).digest("hex");

describe.skipIf(!tmuxAvailable)("shared pane · identity-bound teardown through matching carriers (worktree launcher)", () => {
  it("--dismiss-completed kills the shared pane once and seals both members; a second pass re-seals nothing", () => {
    const e = env();
    const runId = "run-e00-l-shared-dismiss";
    const a = seed(e.root, runId, "T1", "accepted");
    const b = seed(e.root, runId, "T2", "accepted");
    const p = sharedPane(e);
    writeCarriers(e.root, [a, b], p);
    writeSession(e.root, runId, p.pane.pane_id);
    expect(alive(p.pane)).toBe(true);
    const first = launcher(e, "--dismiss-completed", runId);
    expect({ status: first.status, stderr: first.status === 0 ? "" : String(first.stderr).slice(0, 400) }).toEqual({ status: 0, stderr: "" });
    expect({ pane_alive: alive(p.pane), a: term(e.root, a), b: term(e.root, b) }).toEqual({ pane_alive: false, a: "terminated", b: "terminated" });
    const files = [a, b].map((ids) => path.join(e.root, taskCellPaths(ids).attempt_path));
    const before = files.map(sha);
    const second = launcher(e, "--dismiss-completed", runId);
    expect(second.status).toBe(0);
    expect(String(second.stdout)).not.toMatch(/\[TERMINATED\]/);
    expect(files.map(sha)).toEqual(before);
  }, 180_000);

  it("--dismiss-completed defers while one shared member is not yet authorized: pane alive, nothing sealed", () => {
    const e = env();
    const runId = "run-e00-l-shared-defer";
    const a = seed(e.root, runId, "T1", "accepted");
    const b = seed(e.root, runId, "T2", "live");
    const p = sharedPane(e);
    writeCarriers(e.root, [a, b], p);
    writeSession(e.root, runId, p.pane.pane_id);
    const r = launcher(e, "--dismiss-completed", runId);
    expect(r.status).toBe(0);
    expect(String(r.stdout)).toMatch(/\[DEFER\]/);
    expect({ pane_alive: alive(p.pane), a: term(e.root, a), b: term(e.root, b) }).toEqual({ pane_alive: true, a: null, b: null });
  }, 180_000);

  it("--reap seals both parked shared members once the shared pane is torn down by identity", () => {
    const e = env();
    const runId = "run-e00-l-shared-reap";
    const a = seed(e.root, runId, "T1", "orphan");
    const b = seed(e.root, runId, "T2", "orphan");
    const p = sharedPane(e);
    writeCarriers(e.root, [a, b], p);
    writeSession(e.root, runId, p.pane.pane_id);
    const r = launcher(e, "--reap", runId);
    expect({ status: r.status, stderr: r.status === 0 ? "" : String(r.stderr).slice(0, 400) }).toEqual({ status: 0, stderr: "" });
    expect({ pane_alive: alive(p.pane), a: term(e.root, a), b: term(e.root, b) }).toEqual({ pane_alive: false, a: "terminated", b: "terminated" });
  }, 180_000);
});
