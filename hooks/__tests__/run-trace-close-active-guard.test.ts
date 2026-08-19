/**
 * hooks/__tests__/run-trace-close-active-guard.test.ts
 *
 * Fix C of the W4/W5 completion lane (run-identity-and-dispatch): the Stop
 * hook must refuse to close a run while workers are still active.
 *
 * Reproduced defect: the launcher-created (redundant) orchestrator's Stop
 * event closed run-20260811-000117-run-identity-and-dispatch while its
 * tooling-engineer worker held a live, non-terminal task-cell attempt. The
 * only guards in run-trace-close.ts were "run.yaml exists" and the
 * provenance-based idempotency check — nothing consulted worker liveness.
 *
 * Contract under test (deterministic, file-based — no substrate probing):
 *   1. run-state.json carrying ANY lane with status "in_progress" → the close
 *      is refused (exit 0, no provenance.json, stderr says why).
 *   2. ANY task-cell attempt record with terminal_state null (a spawned,
 *      unterminated teammate instance) → the close is refused.
 *   3. POSITIVE CONTROL: lanes done + attempts terminal → the close proceeds
 *      exactly as before (provenance.json written, status closed).
 *
 * Same real-subprocess pattern as run-trace-close-reopen.test.ts — the REAL
 * close path is exercised, never a mock.
 */

import { spawnSync } from "child_process";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";

const SCRIPT = path.resolve(__dirname, "../run-trace-close.ts");
const FIXTURES = path.resolve(__dirname, "../fixtures");

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { mintRunBinding } = require("../../scripts/lib/run-binding") as
  typeof import("../../scripts/lib/run-binding");

const RUN_ID = "run-20260811-000000-active-guard";

function runScript(
  input: string,
  env: Record<string, string>
): { exitCode: number; stdout: string; stderr: string } {
  const result = spawnSync("npx", ["tsx", SCRIPT], {
    input,
    encoding: "utf8",
    env: { ...process.env, ...env },
    timeout: 30000,
  });
  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function writeRunYaml(root: string, runId: string): string {
  const runDir = path.join(root, ".guild", "runs", runId);
  fs.mkdirSync(runDir, { recursive: true });
  const yaml = [
    "schema_version: guild.run.v1",
    `run_id: ${runId}`,
    "command: /guild:build",
    "arguments: {}",
    `cwd: ${root}`,
    "target_kind: existing_guild_project",
    "workspace:",
    "  is_workspace: false",
    `  root: ${root}`,
    "project: project",
    "host:",
    "  requested: auto",
    "  resolved: claude",
    "model_tier_policy: default (full run)",
    "started_at: 2026-01-01T00:00:00Z",
    "ignore_policy: default",
    "scan_policy: default",
    "initiative_attachment: null",
    "phase: null",
    "run_class: full",
    "gates: {}",
    "status: open",
    "phases_log: []",
    "",
  ].join("\n");
  fs.writeFileSync(path.join(runDir, "run.yaml"), yaml, "utf8");
  return mintRunBinding({ root, run_id: runId }).binding_ref;
}

function writeRunState(root: string, runId: string, laneStatus: string): void {
  const runDir = path.join(root, ".guild", "runs", runId);
  const state = {
    schema_version: "guild.run_state.v1",
    run_id: runId,
    plan_slug: "active-guard",
    program_id: null,
    wave_index: 0,
    lanes: {
      "W4-W5-tooling-completion": {
        status: laneStatus,
        attempt: 1,
        depends_on: [],
        receipt_ref: null,
        updated_at: "2026-01-01T00:00:00Z",
      },
    },
    last_checkpoint_at: "2026-01-01T00:00:00Z",
  };
  fs.writeFileSync(path.join(runDir, "run-state.json"), JSON.stringify(state, null, 2) + "\n", "utf8");
}

function writeAttempt(root: string, runId: string, terminalState: string | null): void {
  const attemptDir = path.join(
    root,
    ".guild",
    "runs",
    runId,
    "task-cells",
    "W4-W5-tooling-completion",
    "attempts",
    "1"
  );
  fs.mkdirSync(attemptDir, { recursive: true });
  const attempt = {
    schema_version: "guild.task_attempt.v1",
    run_id: runId,
    cell_id: "cell-W4-W5-tooling-completion",
    logical_task_id: "W4-W5-tooling-completion",
    task_run_id: "W4-W5-tooling-completion.tr1",
    attempt: 1,
    attempt_id: "W4-W5-tooling-completion.att1",
    previous_attempt_id: null,
    retry_reason: null,
    instance_id: "W4-W5-tooling-completion.a1.i-abc123456789",
    created_at: "2026-01-01T00:00:00Z",
    terminal_state: terminalState,
    terminal_reason: terminalState === null ? null : "test-terminal",
    terminated_at: terminalState === null ? null : "2026-01-01T01:00:00Z",
    immutable: terminalState !== null,
    orphaned: false,
    reap_attempts: 0,
  };
  fs.writeFileSync(path.join(attemptDir, "attempt.json"), JSON.stringify(attempt, null, 2) + "\n", "utf8");
}

function provenancePath(root: string, runId: string): string {
  return path.join(root, ".guild", "runs", runId, "provenance.json");
}

describe("run-trace-close.ts — active-worker close guard (Fix C)", () => {
  let tmpDir: string;
  let bindingRef: string;
  const stopPayload = fs.readFileSync(path.join(FIXTURES, "stop.json"), "utf8").toString();

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-rtc-guard-"));
    fs.mkdirSync(path.join(tmpDir, ".git"), { recursive: true });
    bindingRef = writeRunYaml(tmpDir, RUN_ID);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const env = () => ({
    GUILD_CWD: tmpDir,
    GUILD_RUN_ID: RUN_ID,
    GUILD_RUN_BINDING_REF: bindingRef,
  });

  it("refuses to close while run-state has an in_progress lane", () => {
    writeRunState(tmpDir, RUN_ID, "in_progress");
    const { exitCode, stderr } = runScript(stopPayload, env());
    expect(exitCode).toBe(0);
    expect(fs.existsSync(provenancePath(tmpDir, RUN_ID))).toBe(false);
    expect(stderr).toMatch(/in_progress|active/i);
  });

  it("refuses to close while a task-cell attempt is non-terminal (live teammate)", () => {
    writeAttempt(tmpDir, RUN_ID, null);
    const { exitCode, stderr } = runScript(stopPayload, env());
    expect(exitCode).toBe(0);
    expect(fs.existsSync(provenancePath(tmpDir, RUN_ID))).toBe(false);
    expect(stderr).toMatch(/non-terminal|active/i);
  });

  it("POSITIVE CONTROL: closes when lanes are done and attempts are terminal", () => {
    writeRunState(tmpDir, RUN_ID, "done");
    writeAttempt(tmpDir, RUN_ID, "terminated");
    const { exitCode } = runScript(stopPayload, env());
    expect(exitCode).toBe(0);
    const prov = JSON.parse(fs.readFileSync(provenancePath(tmpDir, RUN_ID), "utf8"));
    expect(prov.status).toBe("closed");
  });

  it("POSITIVE CONTROL: a bare run with no lanes and no cells still closes (no regression)", () => {
    const { exitCode } = runScript(stopPayload, env());
    expect(exitCode).toBe(0);
    const prov = JSON.parse(fs.readFileSync(provenancePath(tmpDir, RUN_ID), "utf8"));
    expect(prov.status).toBe("closed");
  });
});

// ── Independent-review blocker 2: the premature-close upgrade race ──────────
//
// Reproduced state (this exact continuation run had it): provenance.json says
// status "closed" with a terminal run_closed pointer — written by the OLD
// (pre-Fix-C) bundle that closed the run while its worker was active — while
// run.yaml and binding.json are OPEN again and a lane is active. Before this
// fix the active guard returned FIRST, so every later Stop preserved the
// contradiction: consumers observed the run as terminal AND active at once.
//
// The recovery contract: BEFORE the active-work refusal returns, a terminal
// provenance record that contradicts an OPEN run.yaml is atomically rewritten
// (temp+rename) to the non-terminal "resumable" status, preserving the
// original terminal fields as premature_close_* audit metadata. Deterministic,
// idempotent, and scoped to the exact contradiction class (terminal provenance
// + open run.yaml + active work).
describe("run-trace-close.ts — premature-close recovery before the active refusal (blocker 2)", () => {
  let tmpDir: string;
  let bindingRef: string;
  const stopPayload = fs.readFileSync(path.join(FIXTURES, "stop.json"), "utf8").toString();

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-rtc-race-"));
    fs.mkdirSync(path.join(tmpDir, ".git"), { recursive: true });
    bindingRef = writeRunYaml(tmpDir, RUN_ID);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const env = () => ({
    GUILD_CWD: tmpDir,
    GUILD_RUN_ID: RUN_ID,
    GUILD_RUN_BINDING_REF: bindingRef,
  });

  /** The stale terminal provenance the old bundle left behind. */
  function seedPrematureClosedProvenance(): void {
    fs.writeFileSync(
      provenancePath(tmpDir, RUN_ID),
      JSON.stringify(
        {
          schema_version: "guild.provenance.v1",
          run_id: RUN_ID,
          status: "closed",
          closed_at: "2026-08-11T01:20:00Z",
          terminal_event: { event_name: "run_closed", event_id: "stale-e1" },
        },
        null,
        2
      ) + "\n",
      "utf8"
    );
  }

  function readProv(): Record<string, unknown> {
    return JSON.parse(fs.readFileSync(provenancePath(tmpDir, RUN_ID), "utf8"));
  }

  it("recovers the stale closed-provenance/open-run/active-lane contradiction atomically", () => {
    seedPrematureClosedProvenance();
    writeRunState(tmpDir, RUN_ID, "in_progress");
    writeAttempt(tmpDir, RUN_ID, null);

    const { exitCode, stderr } = runScript(stopPayload, env());
    expect(exitCode).toBe(0);
    // Still refuses the close (workers active)…
    expect(stderr).toMatch(/refusing to close/);
    // …but the contradiction is GONE: provenance is non-terminal, audited.
    const prov = readProv();
    expect(prov["status"]).toBe("resumable");
    expect(prov["premature_close_recovered_at"]).toEqual(expect.any(String));
    expect(prov["premature_close_previous_status"]).toBe("closed");
    expect(stderr).toMatch(/premature/i);
  });

  it("is idempotent — a second Stop during the same active work changes nothing further", () => {
    seedPrematureClosedProvenance();
    writeRunState(tmpDir, RUN_ID, "in_progress");
    runScript(stopPayload, env());
    const first = readProv();
    const { exitCode } = runScript(stopPayload, env());
    expect(exitCode).toBe(0);
    expect(readProv()).toEqual(first);
  });

  it("after the workers terminate, the next Stop closes the recovered run normally", () => {
    seedPrematureClosedProvenance();
    writeRunState(tmpDir, RUN_ID, "in_progress");
    writeAttempt(tmpDir, RUN_ID, null);
    runScript(stopPayload, env());
    expect(readProv()["status"]).toBe("resumable");

    // Work finishes: lane done, attempt terminal.
    writeRunState(tmpDir, RUN_ID, "done");
    writeAttempt(tmpDir, RUN_ID, "terminated");
    const { exitCode } = runScript(stopPayload, env());
    expect(exitCode).toBe(0);
    expect(readProv()["status"]).toBe("closed");
  });

  it("NEGATIVE: a terminal provenance with a CLOSED run.yaml is left alone (no blind reopen)", () => {
    seedPrematureClosedProvenance();
    writeRunState(tmpDir, RUN_ID, "in_progress");
    const runYamlPath = path.join(tmpDir, ".guild", "runs", RUN_ID, "run.yaml");
    fs.writeFileSync(
      runYamlPath,
      fs.readFileSync(runYamlPath, "utf8").replace("status: open", "status: closed"),
      "utf8"
    );
    const { exitCode } = runScript(stopPayload, env());
    expect(exitCode).toBe(0);
    expect(readProv()["status"]).toBe("closed"); // untouched — not the race class
  });

  it("INSTALLED-BUNDLE CONTROL: the rebuilt dist bundle performs the same recovery", () => {
    seedPrematureClosedProvenance();
    writeRunState(tmpDir, RUN_ID, "in_progress");
    writeAttempt(tmpDir, RUN_ID, null);

    const bundle = path.resolve(__dirname, "../dist/run-trace-close.js");
    const result = spawnSync("node", [bundle], {
      input: stopPayload,
      encoding: "utf8",
      env: { ...process.env, ...env() },
      timeout: 30000,
    });
    expect(result.status ?? 1).toBe(0);
    expect(result.stderr ?? "").toMatch(/refusing to close/);
    const prov = readProv();
    expect(prov["status"]).toBe("resumable");
    expect(prov["premature_close_previous_status"]).toBe("closed");
  });
});
