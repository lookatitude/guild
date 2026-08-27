/**
 * scripts/__tests__/task-cell-acceptance.test.ts
 *
 * G4 — the ACCEPTANCE GATE + terminal-attempt record (ADR `task-cell-runtime-
 * contract.md` D5). These are the deliverable-1/2/4 assertions, written to be
 * NON-VACUOUS: each would fail if the acceptance gate were reverted to "a receipt
 * on disk releases/terminates."
 *
 *   handoff floor  — a receipt that fails the deterministic floor is `failed`.
 *   AT5            — an INVALID (failed-floor) receipt releases NO dependency and
 *                    cannot be accepted; buildAcceptance THROWS.
 *   shutdown       — a VALID accepted receipt authorizes termination, releases
 *                    downstream, and seals a terminal `guild.task_attempt.v1`.
 *   AT6            — a teardown that fails parks the attempt `orphaned` (still
 *                    non-terminal); a later confirmed kill seals `terminated`,
 *                    and the orphan is remembered.
 *   rejection      — a rejected receipt writes a DURABLE rejection record:
 *                    downstream stays blocked, termination IS authorized.
 *   discovery      — findRunAcceptances walks the run tree and only authorized
 *                    records gate dismissal.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { createHash } from "node:crypto";

import {
  buildTaskCell,
  writeTaskCell,
  type TaskCellDispatchInput,
} from "../../src/modules/dispatch/workflows/task-assignment-v2";
import {
  buildAcceptance,
  buildRejection,
  findRunAcceptances,
  gateDependencies,
  isDownstreamReleased,
  isTerminationAuthorized,
  markAttemptOrphaned,
  readAcceptanceForInstance,
  readAssignmentForInstance,
  readAttemptForInstance,
  retainSubmittedHandoffReceipt,
  releasedLogicalTasks,
  runDeterministicFloor,
  sealTerminalAttempt,
  validateSubmittedHandoffReceipt,
  writeAcceptanceRecord,
  writeValidationRecord,
  type TaskCellInstanceIds,
} from "../../src/modules/dispatch/workflows/task-cell-acceptance";
import {
  ACCEPTANCE_AUTHORITIES,
  taskCellPaths,
  type SubmittedHandoff,
  type TaskAssignmentV2,
} from "../lib/core/contracts/task-cell-backend";

const FIXED_NOW = () => "2026-07-15T00:00:00.000Z";

function tmpCwd(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "guild-task-cell-acceptance-"));
}

// T3 F3: the v2 descriptor writers fail closed without the run's minted binding.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const runBindingMod = require("../../src/modules/lifecycle/workflows/run-binding") as
  typeof import("../../src/modules/lifecycle/workflows/run-binding");

/** Mint-or-load the run's binding under this test root. */
function bindFor(cwd: string, runId: string): { binding_ref: string } {
  const existing = runBindingMod.loadRunBinding({ root: cwd, run_id: runId });
  return {
    binding_ref: (existing ?? runBindingMod.mintRunBinding({ root: cwd, run_id: runId })).binding_ref,
  };
}

function dispatch(over: Partial<TaskCellDispatchInput> = {}): TaskCellDispatchInput {
  const logicalTaskId = over.logicalTaskId ?? "lt-api";
  return {
    runId: "run-g4",
    logicalTaskId,
    taskRunId: `${logicalTaskId}.tr1`,
    attempt: 1,
    attemptId: `${logicalTaskId}.att1`,
    instanceId: `${logicalTaskId}.a1.i1`,
    cellId: `cell-${logicalTaskId}`,
    goalId: "goal-g4",
    phaseId: "build",
    stepId: logicalTaskId,
    teamId: "demo",
    workerRole: "backend",
    specialistTypeId: "backend",
    specialistTypeVersion: "1",
    specialistTypeHash: "sha256:type-backend",
    specialistProfileId: "backend",
    specialistProfileHash: "sha256:profile-backend",
    contextBundleId: `.guild/context/run-g4/backend-${logicalTaskId}.md`,
    contextBundleHash: `sha256:ctx-${logicalTaskId}`,
    hostId: "claude-code-cli",
    adapterId: "claude-code-cli@1",
    hostCapabilitiesHash: "sha256:caps",
    substrate: "tmux",
    modelTier: "mid",
    objective: `implement ${logicalTaskId}`,
    nonGoals: [],
    scopePaths: ["src/api"],
    outputSchema: "guild.handoff_receipt.v1",
    acceptanceTests: ["npm test -- api"],
    dependencies: [],
    projection: { tools: ["read", "write"], permissions: [], recorded_losses: [] },
    autonomyPolicy: "supervised",
    budgets: { tokens: null, wall_clock_ms: null, cost_usd: null },
    deadline: null,
    leadBindingId: "lead-binding-demo",
    now: FIXED_NOW,
    ...over,
  };
}

function idsOf(assignment: TaskAssignmentV2): TaskCellInstanceIds {
  return {
    run_id: assignment.run_id,
    logical_task_id: assignment.logical_task_id,
    attempt: assignment.attempt,
    instance_id: assignment.instance_id,
  };
}

function validReceipt(over: Partial<SubmittedHandoff> = {}): SubmittedHandoff {
  return {
    receipt_id: "receipt-1",
    receipt_path: "handoffs/backend-lt-api.md",
    schema_valid: true,
    claimed_changed_files: ["src/api/routes.ts"],
    acceptance_tests_passed: ["npm test -- api"],
    submitted_at: FIXED_NOW(),
    ...over,
  };
}

const AUTHORITIES = [...ACCEPTANCE_AUTHORITIES.slice(0, 2)]; // deterministic_floor + team_lead
const OBSERVED_ACCEPT = AUTHORITIES.map((authority) => ({
  authority,
  decision: "accepted" as const,
  at: FIXED_NOW(),
  reason: null,
}));

function canonicalFrozenReceipt(assignment: TaskAssignmentV2): string {
  return [
    "---", "schema_version: guild.handoff_receipt.v1", "ids:", "  initiative_id: null",
    `  run_id: ${assignment.run_id}`, `  task_id: ${assignment.logical_task_id}`, `  task_run_id: ${assignment.task_run_id}`,
    `specialist: ${assignment.worker_role}`, "host:", `  selected: ${assignment.host_id}`, "  degraded: false",
    "  native_ref: null", "  independence: strong", "scope:", `  objective: ${JSON.stringify(assignment.objective)}`,
    `  in_scope: ${JSON.stringify(assignment.scope_paths)}`, "  out_of_scope_touched: []", "status: completed",
    "changed_files:", "  - path: src/api/routes.ts", "    change: modified", `    sha256_after: ${"c".repeat(64)}`,
    "evidence:", "  - kind: command", `    ref: ${JSON.stringify(assignment.acceptance_tests[0])}`, "    result: pass",
    "assumptions: []", "open_risks: []", "followups: []", `produced_at: ${FIXED_NOW()}`,
    "---", "", "## changed_files", "- src/api/routes.ts", "", "## opens_for", "- lead", "",
    "## assumptions", "- none", "", "## evidence", `- ${assignment.acceptance_tests[0]}`, "",
    "## followups", "- none", "", "```guild.handoff.v2", JSON.stringify({
      schema_version: "guild.handoff.v2", task_id: assignment.logical_task_id, tier: "mid", status: "done",
      summary: "implemented and tested", artifacts: ["src/api/routes.ts"], issues: [],
    }), "```", "",
  ].join("\n");
}

// ── deterministic floor ──────────────────────────────────────────────────────

describe("runDeterministicFloor", () => {
  it("publishes an immutable submitted-handoff pointer from a canonical frozen receipt", () => {
    const cwd = tmpCwd();
    const { assignment } = buildTaskCell(dispatch());
    const receiptPath = `.guild/runs/${assignment.run_id}/handoffs/${assignment.worker_role}-${assignment.logical_task_id}.md`;
    fs.mkdirSync(path.dirname(path.join(cwd, receiptPath)), { recursive: true });
    fs.writeFileSync(path.join(cwd, receiptPath), canonicalFrozenReceipt(assignment));

    const acceptanceModule = require("../../src/modules/dispatch/workflows/task-cell-acceptance") as {
      publishSubmittedHandoffPointer?: (input: {
        cwd: string;
        assignment: TaskAssignmentV2;
        submittedAt: string;
      }) => SubmittedHandoff | null;
    };
    expect(typeof acceptanceModule.publishSubmittedHandoffPointer).toBe("function");
    if (!acceptanceModule.publishSubmittedHandoffPointer) return;

    const submitted = acceptanceModule.publishSubmittedHandoffPointer({
      cwd,
      assignment,
      submittedAt: FIXED_NOW(),
    });
    expect(submitted).not.toBeNull();
    expect(submitted).toMatchObject({
      receipt_path: receiptPath,
      schema_valid: true,
      claimed_changed_files: ["src/api/routes.ts"],
      acceptance_tests_passed: assignment.acceptance_tests,
      submitted_at: FIXED_NOW(),
    });
    expect(submitted?.receipt_id.startsWith("handoff-sha256:")).toBe(true);
    expect(submitted?.receipt_id.slice("handoff-sha256:".length)).toMatch(/^[a-f0-9]{64}$/);
    expect(validateSubmittedHandoffReceipt({ cwd, assignment, submitted: submitted! })).toBe(true);
    expect(JSON.parse(fs.readFileSync(path.join(cwd, assignment.handoff_path), "utf8"))).toEqual(submitted);

    expect(acceptanceModule.publishSubmittedHandoffPointer({
      cwd,
      assignment,
      submittedAt: "2026-07-15T00:00:01.000Z",
    })).toEqual(submitted);
  });

  it("refuses a canonical-looking receipt reached through an escaping symlink ancestor", () => {
    const cwd = tmpCwd();
    const outside = tmpCwd();
    const { assignment } = buildTaskCell(dispatch());
    const handoffsDir = path.join(cwd, ".guild", "runs", assignment.run_id, "handoffs");
    const receiptName = `${assignment.worker_role}-${assignment.logical_task_id}.md`;
    fs.mkdirSync(path.dirname(handoffsDir), { recursive: true });
    fs.writeFileSync(path.join(outside, receiptName), canonicalFrozenReceipt(assignment));
    fs.symlinkSync(outside, handoffsDir, "dir");

    const acceptanceModule = require("../../src/modules/dispatch/workflows/task-cell-acceptance") as {
      publishSubmittedHandoffPointer: (input: {
        cwd: string;
        assignment: TaskAssignmentV2;
        submittedAt: string;
      }) => SubmittedHandoff | null;
    };
    expect(acceptanceModule.publishSubmittedHandoffPointer({
      cwd,
      assignment,
      submittedAt: FIXED_NOW(),
    })).toBeNull();
    expect(fs.existsSync(path.join(cwd, assignment.handoff_path))).toBe(false);
  });

  it("rejects a preexisting pointer that forges passing tests absent from receipt evidence", () => {
    const cwd = tmpCwd();
    const { assignment } = buildTaskCell(dispatch());
    const receiptPath = `.guild/runs/${assignment.run_id}/handoffs/${assignment.worker_role}-${assignment.logical_task_id}.md`;
    const receipt = canonicalFrozenReceipt(assignment).replace("    result: pass", "    result: fail");
    fs.mkdirSync(path.dirname(path.join(cwd, receiptPath)), { recursive: true });
    fs.writeFileSync(path.join(cwd, receiptPath), receipt);

    const forged: SubmittedHandoff = {
      receipt_id: `handoff-sha256:${createHash("sha256").update(receipt).digest("hex")}`,
      receipt_path: receiptPath,
      schema_valid: true,
      claimed_changed_files: ["src/api/routes.ts"],
      acceptance_tests_passed: [...assignment.acceptance_tests],
      submitted_at: FIXED_NOW(),
    };
    fs.mkdirSync(path.dirname(path.join(cwd, assignment.handoff_path)), { recursive: true });
    fs.writeFileSync(path.join(cwd, assignment.handoff_path), JSON.stringify(forged, null, 2) + "\n");

    const acceptanceModule = require("../../src/modules/dispatch/workflows/task-cell-acceptance") as {
      publishSubmittedHandoffPointer: (input: {
        cwd: string;
        assignment: TaskAssignmentV2;
        submittedAt: string;
      }) => SubmittedHandoff | null;
    };
    expect(acceptanceModule.publishSubmittedHandoffPointer({
      cwd,
      assignment,
      submittedAt: FIXED_NOW(),
    })).toBeNull();
  });

  it("derives schema validity from the frozen receipt bytes, never the worker claim", () => {
    const cwd = tmpCwd();
    const { assignment } = buildTaskCell(dispatch());
    const receiptPath = `.guild/runs/${assignment.run_id}/handoffs/${assignment.worker_role}-${assignment.logical_task_id}.md`;
    fs.mkdirSync(path.dirname(path.join(cwd, receiptPath)), { recursive: true });
    fs.writeFileSync(path.join(cwd, receiptPath), [
      "---",
      "schema_version: guild.handoff_receipt.v1",
      `task_id: ${assignment.logical_task_id}`,
      `specialist: ${assignment.worker_role}`,
      "model_family: claude",
      "host: claude-code-cli",
      `generated_at: ${FIXED_NOW()}`,
      "---",
      "",
      "```guild.handoff.v2",
      JSON.stringify({ schema_version: "guild.handoff.v2", task_id: assignment.logical_task_id, tier: "mid", status: "done", summary: "legacy receipt", artifacts: [], issues: [] }),
      "```",
      "",
    ].join("\n"));
    const submitted = validReceipt({ receipt_path: receiptPath, schema_valid: true });

    expect(validateSubmittedHandoffReceipt({ cwd, assignment, submitted })).toBe(false);
  });

  it("fails closed instead of throwing on malformed claimed-file arrays", () => {
    const cwd = tmpCwd();
    const { assignment } = buildTaskCell(dispatch());
    const submitted = {
      ...validReceipt(),
      claimed_changed_files: null,
      acceptance_tests_passed: "npm test -- api",
    } as unknown as ReturnType<typeof validReceipt>;

    expect(() => validateSubmittedHandoffReceipt({ cwd, assignment, submitted })).not.toThrow();
    expect(validateSubmittedHandoffReceipt({ cwd, assignment, submitted })).toBe(false);
  });

  it("binds receipt_id to raw file bytes even when ignored prose is not valid UTF-8", () => {
    const cwd = tmpCwd();
    const { assignment } = buildTaskCell(dispatch());
    const receiptPath = `.guild/runs/${assignment.run_id}/handoffs/${assignment.worker_role}-${assignment.logical_task_id}.md`;
    const prefix = [
      "---", "schema_version: guild.handoff_receipt.v1", "ids:", "  initiative_id: null",
      `  run_id: ${assignment.run_id}`, `  task_id: ${assignment.logical_task_id}`, `  task_run_id: ${assignment.task_run_id}`,
      `specialist: ${assignment.worker_role}`, "host:", `  selected: ${assignment.host_id}`, "  degraded: false",
      "  native_ref: null", "  independence: strong", "scope:", `  objective: ${JSON.stringify(assignment.objective)}`,
      `  in_scope: ${JSON.stringify(assignment.scope_paths)}`, "  out_of_scope_touched: []", "status: completed",
      "changed_files:", "  - path: src/api/routes.ts", "    change: modified", `    sha256_after: ${"b".repeat(64)}`,
      "evidence:", "  - kind: command", `    ref: ${JSON.stringify(assignment.acceptance_tests[0])}`, "    result: pass",
      "assumptions: []", "open_risks: []", "followups: []", `produced_at: ${FIXED_NOW()}`,
      "---", "",
      "## changed_files", "- src/api/routes.ts", "",
      "## opens_for", "- lead", "",
      "## assumptions", "- none", "",
      "## evidence", "- raw-byte binding", "",
      "## followups", "- none", "",
      "ignored prose ",
    ].join("\n");
    const suffix = ["", "```guild.handoff.v2", JSON.stringify({
      schema_version: "guild.handoff.v2", task_id: assignment.logical_task_id, tier: "mid", status: "done",
      summary: "done", artifacts: ["src/api/routes.ts"], issues: [],
    }), "```", ""].join("\n");
    const bytes = Buffer.concat([Buffer.from(prefix), Buffer.from([0xff]), Buffer.from(suffix)]);
    fs.mkdirSync(path.dirname(path.join(cwd, receiptPath)), { recursive: true });
    fs.writeFileSync(path.join(cwd, receiptPath), bytes);
    const submitted = validReceipt({
      receipt_path: receiptPath,
      receipt_id: `handoff-sha256:${createHash("sha256").update(bytes).digest("hex")}`,
    });

    expect(validateSubmittedHandoffReceipt({ cwd, assignment, submitted })).toBe(true);

    const incompleteWrapperBytes = Buffer.from(
      bytes.toString("latin1").replace("## followups\n- none\n", ""),
      "latin1"
    );
    fs.writeFileSync(path.join(cwd, receiptPath), incompleteWrapperBytes);
    expect(validateSubmittedHandoffReceipt({
      cwd,
      assignment,
      submitted: {
        ...submitted,
        receipt_id: `handoff-sha256:${createHash("sha256").update(incompleteWrapperBytes).digest("hex")}`,
      },
    })).toBe(false);
    fs.writeFileSync(path.join(cwd, receiptPath), bytes);

    const retainedPath = taskCellPaths(assignment).receipt_path;
    fs.mkdirSync(path.dirname(path.join(cwd, retainedPath)), { recursive: true });
    fs.writeFileSync(path.join(cwd, retainedPath), "planted conflicting receipt");
    expect(() => retainSubmittedHandoffReceipt({ cwd, assignment, submitted })).not.toThrow();
    expect(retainSubmittedHandoffReceipt({ cwd, assignment, submitted })).toBeNull();

    const retainedParent = path.dirname(path.join(cwd, retainedPath));
    fs.rmSync(retainedParent, { recursive: true });
    fs.writeFileSync(retainedParent, "planted parent-path collision");
    expect(() => retainSubmittedHandoffReceipt({ cwd, assignment, submitted })).not.toThrow();
    expect(retainSubmittedHandoffReceipt({ cwd, assignment, submitted })).toBeNull();
  });

  it("passes a schema-valid, in-scope, tests-passed receipt", () => {
    const { assignment } = buildTaskCell(dispatch());
    const v = runDeterministicFloor({
      assignment,
      submitted: validReceipt(),
      validationResultId: "val-1",
      now: FIXED_NOW,
    });
    expect(v.result).toBe("passed");
    expect(v.schema_valid && v.scope_valid && v.tests_passed).toBe(true);
    expect(v.assignment_id).toBe(`${assignment.task_run_id}:1:${assignment.instance_id}`);
  });

  it("fails a receipt whose changed files escape the assignment scope", () => {
    const { assignment } = buildTaskCell(dispatch());
    const v = runDeterministicFloor({
      assignment,
      submitted: validReceipt({ claimed_changed_files: ["scripts/agent-team-launcher.ts"] }),
      validationResultId: "val-2",
      now: FIXED_NOW,
    });
    expect(v.result).toBe("failed");
    expect(v.scope_valid).toBe(false);
    expect(v.out_of_scope_files).toContain("scripts/agent-team-launcher.ts");
  });

  it("fails a receipt that did not pass a named acceptance test", () => {
    const { assignment } = buildTaskCell(dispatch());
    const v = runDeterministicFloor({
      assignment,
      submitted: validReceipt({ acceptance_tests_passed: [] }),
      validationResultId: "val-3",
      now: FIXED_NOW,
    });
    expect(v.result).toBe("failed");
    expect(v.tests_passed).toBe(false);
    expect(v.failed_acceptance_tests).toEqual(["npm test -- api"]);
  });
});

// ── AT5 — an invalid receipt releases NOTHING and cannot be accepted ──────────

describe("AT5 — an invalid/failed-floor receipt releases no dependency + claims no acceptance", () => {
  it("buildAcceptance THROWS on a failed-floor validation (cannot self-accept a bad receipt)", () => {
    const { assignment } = buildTaskCell(dispatch());
    const failed = runDeterministicFloor({
      assignment,
      submitted: validReceipt({ schema_valid: false }),
      validationResultId: "val-bad",
      now: FIXED_NOW,
    });
    expect(failed.result).toBe("failed");
    expect(() =>
      buildAcceptance({
        validation: failed,
        acceptancePolicyVersion: "1.0.0",
        authoritiesRequired: AUTHORITIES,
        authoritiesObserved: OBSERVED_ACCEPT,
        now: FIXED_NOW,
      })
    ).toThrow(/did not pass|D5/i);
  });

  it("releases NO downstream when no acceptance record exists — a receipt on disk is not a release", () => {
    // A dependent lane waits on lt-api. With zero acceptance records, it is blocked.
    const gate = gateDependencies(
      [{ logical_task_id: "lt-api", accepted_artifact_ref: null }],
      /* acceptances */ []
    );
    expect(gate.ready).toBe(false);
    expect(gate.blocked_on).toEqual(["lt-api"]);
    expect(releasedLogicalTasks([]).size).toBe(0);
  });

  it("buildAcceptance THROWS when a required authority is missing (no rubber-stamp)", () => {
    const { assignment } = buildTaskCell(dispatch());
    const passed = runDeterministicFloor({
      assignment,
      submitted: validReceipt(),
      validationResultId: "val-ok",
      now: FIXED_NOW,
    });
    expect(() =>
      buildAcceptance({
        validation: passed,
        acceptancePolicyVersion: "1.0.0",
        authoritiesRequired: AUTHORITIES,
        authoritiesObserved: [OBSERVED_ACCEPT[0]], // only deterministic_floor; team_lead missing
        now: FIXED_NOW,
      })
    ).toThrow(/authorities not satisfied|team_lead/i);
  });
});

// ── shutdown — a valid accepted receipt authorizes + seals termination ────────

describe("shutdown — a valid accepted receipt releases downstream + seals a terminal record", () => {
  it("acceptance releases downstream, authorizes termination, and gates a dependent lane open", () => {
    const cwd = tmpCwd();
    const { assignment } = buildTaskCell(dispatch());
    writeTaskCell(cwd, buildTaskCell(dispatch()), bindFor(cwd, "run-g4"));

    const validation = runDeterministicFloor({
      assignment,
      submitted: validReceipt(),
      validationResultId: "val-1",
      now: FIXED_NOW,
    });
    writeValidationRecord(cwd, validation);

    const acceptance = buildAcceptance({
      validation,
      acceptancePolicyVersion: "1.0.0",
      authoritiesRequired: AUTHORITIES,
      authoritiesObserved: OBSERVED_ACCEPT,
      now: FIXED_NOW,
    });
    writeAcceptanceRecord(cwd, acceptance);

    expect(isDownstreamReleased(acceptance)).toBe(true);
    expect(isTerminationAuthorized(acceptance)).toBe(true);
    // The dependent lane is now released — ONLY because a durable acceptance exists.
    const gate = gateDependencies(
      [{ logical_task_id: "lt-api", accepted_artifact_ref: null }],
      [acceptance]
    );
    expect(gate.ready).toBe(true);
    expect(releasedLogicalTasks([acceptance]).has("lt-api")).toBe(true);
  });

  it("sealTerminalAttempt writes a terminal guild.task_attempt.v1 after acceptance", () => {
    const cwd = tmpCwd();
    const { assignment } = buildTaskCell(dispatch());
    writeTaskCell(cwd, buildTaskCell(dispatch()), bindFor(cwd, "run-g4"));
    const ids = idsOf(assignment);

    // Before termination the attempt companion is non-terminal.
    const before = readAttemptForInstance(cwd, ids);
    expect(before?.terminal_state).toBeNull();
    expect(before?.immutable).toBe(false);

    const sealed = sealTerminalAttempt({
      cwd,
      ids,
      terminal_state: "terminated",
      reason: null,
      now: FIXED_NOW,
    });
    expect(sealed.terminal_state).toBe("terminated");
    expect(sealed.immutable).toBe(true);
    expect(sealed.terminated_at).toBe(FIXED_NOW());

    // Persisted to the canonical attempt path.
    const after = readAttemptForInstance(cwd, ids);
    expect(after?.terminal_state).toBe("terminated");
    expect(fs.existsSync(path.resolve(cwd, taskCellPaths(ids).attempt_path))).toBe(true);
  });

  it("a terminal attempt is IMMUTABLE — re-sealing to a different state throws (D4)", () => {
    const cwd = tmpCwd();
    const { assignment } = buildTaskCell(dispatch());
    writeTaskCell(cwd, buildTaskCell(dispatch()), bindFor(cwd, "run-g4"));
    const ids = idsOf(assignment);
    sealTerminalAttempt({ cwd, ids, terminal_state: "terminated", reason: null, now: FIXED_NOW });
    expect(() =>
      sealTerminalAttempt({ cwd, ids, terminal_state: "failed", reason: "x", now: FIXED_NOW })
    ).toThrow(/immutable|retry mints a new attempt/i);
  });
});

// ── AT6 — teardown fails → orphan → reaper retry → terminated ─────────────────

describe("AT6 — a failed teardown parks the attempt orphaned; a reaper retry seals terminated", () => {
  it("markAttemptOrphaned leaves the attempt non-terminal + bumps reap_attempts", () => {
    const cwd = tmpCwd();
    const { assignment } = buildTaskCell(dispatch());
    writeTaskCell(cwd, buildTaskCell(dispatch()), bindFor(cwd, "run-g4"));
    const ids = idsOf(assignment);

    const orphaned = markAttemptOrphaned(cwd, ids);
    expect(orphaned.orphaned).toBe(true);
    expect(orphaned.terminal_state).toBeNull(); // still non-terminal — not yet reaped
    expect(orphaned.reap_attempts).toBe(1);

    // The reaper retries and finally confirms the kill → seal terminated; the
    // orphan is REMEMBERED on the terminal record.
    const sealed = sealTerminalAttempt({
      cwd,
      ids,
      terminal_state: "terminated",
      reason: null,
      orphaned: true,
      reapAttempts: 2,
      now: FIXED_NOW,
    });
    expect(sealed.terminal_state).toBe("terminated");
    expect(sealed.orphaned).toBe(true);
    expect(sealed.reap_attempts).toBe(2);
  });
});

// ── rejection — durable, downstream blocked, termination authorized ───────────

describe("rejection — a rejected receipt writes a DURABLE record, never a silent kill", () => {
  it("rejection blocks downstream but authorizes a rejection terminal event", () => {
    const cwd = tmpCwd();
    const { assignment } = buildTaskCell(dispatch());
    writeTaskCell(cwd, buildTaskCell(dispatch()), bindFor(cwd, "run-g4"));
    const validation = runDeterministicFloor({
      assignment,
      submitted: validReceipt(),
      validationResultId: "val-1",
      now: FIXED_NOW,
    });
    const rejection = buildRejection({
      validation,
      acceptancePolicyVersion: "1.0.0",
      authoritiesRequired: AUTHORITIES,
      authoritiesObserved: [
        { authority: "team_lead", decision: "rejected", at: FIXED_NOW(), reason: "quality" },
      ],
      reason: "quality",
      now: FIXED_NOW,
    });
    writeAcceptanceRecord(cwd, rejection);

    expect(isDownstreamReleased(rejection)).toBe(false); // dependents stay blocked
    expect(isTerminationAuthorized(rejection)).toBe(true); // but teardown IS authorized
    expect(releasedLogicalTasks([rejection]).size).toBe(0);

    // The terminal event is an explicit `rejected`, never a silent kill.
    const sealed = sealTerminalAttempt({
      cwd,
      ids: idsOf(assignment),
      terminal_state: "rejected",
      reason: "quality",
      now: FIXED_NOW,
    });
    expect(sealed.terminal_state).toBe("rejected");
    expect(sealed.terminal_reason).toBe("quality");
  });
});

// ── discovery — only durable acceptance records gate dismissal ────────────────

describe("findRunAcceptances — walks the run tree; only authorized records gate dismissal", () => {
  it("returns nothing when only a receipt exists (no acceptance record written)", () => {
    const cwd = tmpCwd();
    writeTaskCell(cwd, buildTaskCell(dispatch()), bindFor(cwd, "run-g4"));
    // No writeAcceptanceRecord → the run tree carries an assignment + attempt but
    // no acceptance. Dismissal discovery must find nothing.
    expect(findRunAcceptances(cwd, "run-g4")).toEqual([]);
  });

  it("finds the acceptance + resolves the sibling assignment worker_role", () => {
    const cwd = tmpCwd();
    const { assignment } = buildTaskCell(dispatch());
    writeTaskCell(cwd, buildTaskCell(dispatch()), bindFor(cwd, "run-g4"));
    const validation = runDeterministicFloor({
      assignment,
      submitted: validReceipt(),
      validationResultId: "val-1",
      now: FIXED_NOW,
    });
    writeAcceptanceRecord(
      cwd,
      buildAcceptance({
        validation,
        acceptancePolicyVersion: "1.0.0",
        authoritiesRequired: AUTHORITIES,
        authoritiesObserved: OBSERVED_ACCEPT,
        now: FIXED_NOW,
      })
    );

    const found = findRunAcceptances(cwd, "run-g4");
    expect(found).toHaveLength(1);
    expect(isTerminationAuthorized(found[0].acceptance)).toBe(true);
    const sib = readAssignmentForInstance(cwd, found[0].ids);
    expect(sib?.worker_role).toBe("backend");
    // The record is readable back through the single-instance reader too.
    expect(readAcceptanceForInstance(cwd, found[0].ids)).not.toBeNull();
  });
});
