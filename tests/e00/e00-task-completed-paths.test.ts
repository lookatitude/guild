/**
 * E00-T0 · EAT04 / CD4 — the three TaskCompleted paths on the real hook.
 *
 *  - bound (verified binding presented): pointer published (positive control);
 *  - unbound on an E00 assignment (carries done_when_ref): writes ONLY
 *    outbox/<instance_id>/task-completed-notice.json, publishes no pointer and
 *    never opens binding.json (expected red: today it dies with a refusal);
 *  - unbound on a legacy assignment (no done_when_ref): the existing refusal
 *    stays exactly as it is (positive control).
 *
 * "Never opens binding.json" is an fs trace: binding.json is replaced by a FIFO,
 * so any read blocks and the hook times out instead of passing silently.
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { buildTaskCell, writeTaskCell } from "../../src/domains/dispatch";
import { mintRunBinding } from "../../src/domains/lifecycle";
import { hermeticEnv } from "../../hooks/test-support/hermetic-env";
import { PLUGIN, ownedTempDir, receiptBytes, sha256, teardownOwned } from "./support/e00-harness";

const SCRIPT = path.join(PLUGIN, "hooks", "agent-team", "task-completed.ts");
const RUN_ID = "run-e00-hook";

let tmp: string;
let bindingRef: string;

beforeEach(() => {
  tmp = ownedTempDir("guild-e00-hook-");
  bindingRef = mintRunBinding({ root: tmp, run_id: RUN_ID }).binding_ref;
});

afterEach(teardownOwned);

function cell(e00: boolean) {
  const c = buildTaskCell({
    runId: RUN_ID, logicalTaskId: "task-001", taskRunId: "task-001.tr1", attempt: 1, attemptId: "task-001.att1",
    instanceId: "task-001.a1.i1", cellId: "cell-task-001", goalId: "goal-e00", phaseId: "build", stepId: "task-001",
    teamId: "guild-team", workerRole: "backend", specialistTypeId: "backend", specialistTypeVersion: "1",
    specialistTypeHash: "sha256:type", specialistProfileId: "backend", specialistProfileHash: "sha256:profile",
    contextBundleId: `.guild/context/${RUN_ID}/backend-task-001.md`, contextBundleHash: "sha256:ctx",
    hostId: "claude-code-cli", adapterId: "claude-code-cli@1", hostCapabilitiesHash: "sha256:caps",
    substrate: "tmux", modelTier: "mid", objective: "e00 hook path", scopePaths: ["hooks/agent-team"],
    outputSchema: "guild.handoff_receipt.v1", acceptanceTests: ["npm test -- hook"],
    projection: { tools: ["read", "write"], permissions: [], recorded_losses: [] }, autonomyPolicy: "supervised",
    budgets: { tokens: null, wall_clock_ms: null, cost_usd: null }, leadBindingId: "lead-binding-e00",
    now: () => "2026-10-26T13:00:00.000Z",
  });
  if (e00) {
    (c.assignment as Record<string, unknown>)["done_when_ref"] = {
      oracle_plan_path: `.guild/runs/${RUN_ID}/oracle-plan/build.json`,
      oracle_plan_sha256: "a".repeat(64),
      decision_sha256: "b".repeat(64),
    };
  }
  writeTaskCell(tmp, c, { binding_ref: bindingRef });
  const receipt = path.join(tmp, ".guild", "runs", RUN_ID, "handoffs", "backend-task-001.md");
  fs.mkdirSync(path.dirname(receipt), { recursive: true });
  fs.writeFileSync(receipt, receiptBytes(RUN_ID, c.assignment));
  return c;
}

function run(c: ReturnType<typeof cell>, bound: boolean, timeoutMs = 30000) {
  const r = spawnSync("npx", ["tsx", SCRIPT], {
    input: JSON.stringify({
      session_id: "e00-hook", cwd: tmp, hook_event_name: "TaskCompleted", task_id: c.assignment.logical_task_id,
      task_subject: "e00", teammate_name: c.assignment.worker_role, team_name: "guild-team",
    }),
    encoding: "utf8",
    env: {
      ...hermeticEnv(),
      CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1",
      GUILD_RUN_ID: RUN_ID,
      GUILD_TASK_ASSIGNMENT: c.assignment.assignment_path,
      ...(bound ? { GUILD_RUN_BINDING_REF: bindingRef } : {}),
    },
    timeout: timeoutMs,
  });
  return { status: r.status, stderr: r.stderr ?? "", timedOut: (r.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT" };
}

const noticePath = (c: ReturnType<typeof cell>) =>
  path.join(tmp, ".guild", "runs", RUN_ID, "outbox", c.assignment.instance_id, "task-completed-notice.json");

describe("CD4 bound TaskCompleted (positive control)", () => {
  it("publishes the pointer through the verified binding", () => {
    const c = cell(true);
    const r = run(c, true);
    expect(r.status).toBe(0);
    expect(fs.existsSync(path.join(tmp, c.assignment.handoff_path))).toBe(true);
  });
});

describe("CD4 unbound TaskCompleted on an E00 assignment (expected red)", () => {
  it("writes only the outbox notice and publishes no pointer", () => {
    const c = cell(true);
    const r = run(c, false);
    expect(r.timedOut).toBe(false);
    expect(fs.existsSync(noticePath(c))).toBe(true);
    expect(fs.existsSync(path.join(tmp, c.assignment.handoff_path))).toBe(false);
    const notice = JSON.parse(fs.readFileSync(noticePath(c), "utf8"));
    expect(notice).toMatchObject({ run_id: RUN_ID, instance_id: c.assignment.instance_id });
    expect(fs.readFileSync(noticePath(c)).includes(Buffer.from(bindingRef))).toBe(false);
  });

  it("never opens binding.json (FIFO trace)", () => {
    const c = cell(true);
    const binding = path.join(tmp, ".guild", "runs", RUN_ID, "binding.json");
    const digest = sha256(fs.readFileSync(binding));
    fs.rmSync(binding);
    expect(spawnSync("mkfifo", [binding]).status).toBe(0);
    const r = run(c, false, 20000);
    expect(r.timedOut).toBe(false);
    expect(fs.existsSync(noticePath(c))).toBe(true);
    expect(digest).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("CD4 unbound TaskCompleted on a legacy assignment (positive control)", () => {
  it("keeps the existing refusal: non-zero exit, no pointer, no notice", () => {
    const c = cell(false);
    const r = run(c, false);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/did not authorize this TaskCompleted write/);
    expect(fs.existsSync(path.join(tmp, c.assignment.handoff_path))).toBe(false);
    expect(fs.existsSync(noticePath(c))).toBe(false);
  });
});
