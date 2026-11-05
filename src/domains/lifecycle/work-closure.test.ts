/**
 * R04 · AT14 closure matrix.
 *
 * Fixture: pending/orphaned attempt, missing receipt, verified task,
 * cancelled/partial run, software/research initiative.
 * Expected: success needs accepted final evidence; cancel/partial are explicit
 * operator outcomes; research completion needs the adopted kind predicate;
 * software keeps the strict D8 gate.
 * Negative control: exit 0 or archive alone never marks accepted success.
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { openRunController, type RunController, type WriterGrant } from "./run-controller";
import type { Entity, Evidence, StackTaskAttemptV1, StateAxes } from "./execution-identity";
import {
  WorkClosureRefusal,
  evaluateGoalClose,
  evaluateTaskClose,
  initiativeClosePredicate,
  readWorkClosure,
  recordWorkClose,
  type AttemptFacts,
  type TaskCloseInput,
} from "./work-closure";
import { openWorkDisposition, runTransfer } from "./followup-transfer";

const H = (c: string) => `sha256:${c.repeat(64)}`;
const SRC = "source-a";
const RUN = "run-1";
const TASK: Entity = { source_id: SRC, kind: "logical_task", id: "task-1", revision: H("a") };

function ev(over: Partial<Evidence> = {}): Evidence {
  return { source_id: SRC, path: ".guild/runs/run-1/results/r.json", sha256: H("b"), schema_version: "guild.result.v1", observed_at: "2026-11-05T00:00:00.000Z", availability: "available", reason: null, ...over };
}
function attempt(over: Partial<StackTaskAttemptV1> = {}, state: Partial<StateAxes> = {}): StackTaskAttemptV1 {
  return {
    schema_version: "guild.task_attempt.v1",
    lineage: { source_id: SRC, run_id: RUN, execution_id: "exec-1", host_session_id: null, initiative_id: null, goal_id: null, logical_task_id: "task-1", attempt_id: "att-1", agent_instance_id: null, request_id: null },
    assignment_ref: ev({ path: ".guild/runs/run-1/assignments/att-1.json" }),
    ordinal: 1,
    state: { lifecycle: "closed", outcome: "succeeded", acceptance: "verified", observability: "complete", ...state },
    result_refs: [ev()],
    acceptance_subject_hash: H("c"),
    accepted_by_controller_epoch: 1,
    receipt_loss_reconciled: true,
    uncertain_effects: false,
    ...over,
  };
}
function facts(a: StackTaskAttemptV1, receipt: AttemptFacts["receipt"] = "verified", exit_code: number | null = 0): AttemptFacts {
  return { attempt: a, receipt, exit_code };
}
function input(over: Partial<TaskCloseInput> = {}): TaskCloseInput {
  return {
    task: TASK,
    attempts: [facts(attempt())],
    acceptance_required: true,
    acceptance: { state: "verified", subject_hash: H("c") },
    transfer_blocker: null,
    request: { kind: "verified_success" },
    ...over,
  };
}
const blockers = (r: ReturnType<typeof evaluateTaskClose>) => (r.ok ? [] : r.blockers.map((b) => b.code));

describe("AT14 · closure matrix (task)", () => {
  it("a verified task with accepted final evidence closes as success", () => {
    const r = evaluateTaskClose(input());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.state).toEqual({ lifecycle: "closed", outcome: "succeeded", acceptance: "verified", observability: "complete" });
      expect(r.final_attempt_id).toBe("att-1");
    }
  });

  it("a pending attempt blocks success and cancel alike", () => {
    const live = facts(attempt({ ordinal: 2, lineage: { ...attempt().lineage, attempt_id: "att-2" } }, { lifecycle: "active", outcome: "pending", acceptance: "pending" }), "missing", null);
    expect(blockers(evaluateTaskClose(input({ attempts: [facts(attempt()), live] })))).toContain("attempt_live");
    expect(blockers(evaluateTaskClose(input({ attempts: [live], request: { kind: "cancel", operator_id: "op-miguel", reason: "scope cut" } })))).toContain("attempt_live");
  });

  it("an orphaned attempt blocks success but is surfaced, not hidden, by an explicit cancel", () => {
    const orphan = facts(attempt({ uncertain_effects: true, receipt_loss_reconciled: false }, { lifecycle: "unknown", outcome: "unknown", acceptance: "unknown", observability: "partial" }), "missing", null);
    expect(blockers(evaluateTaskClose(input({ attempts: [orphan] })))).toEqual(expect.arrayContaining(["attempt_orphaned", "receipt_missing", "uncertain_effects"]));
    const c = evaluateTaskClose(input({ attempts: [orphan], request: { kind: "cancel", operator_id: "op-miguel", reason: "worker lost" } }));
    expect(c.ok).toBe(true);
    if (c.ok) {
      expect(c.state).toEqual({ lifecycle: "closed", outcome: "cancelled", acceptance: "not_required", observability: "partial" });
      expect(c.surfaced).toEqual(["att-1"]);
    }
  });

  it("a missing or mismatched receipt blocks success", () => {
    expect(blockers(evaluateTaskClose(input({ attempts: [facts(attempt(), "missing")] })))).toContain("receipt_missing");
    expect(blockers(evaluateTaskClose(input({ attempts: [facts(attempt(), "mismatch")] })))).toContain("receipt_mismatch");
  });

  it("success needs the final attempt's accepted evidence and the required acceptance subject", () => {
    expect(blockers(evaluateTaskClose(input({ attempts: [facts(attempt({ accepted_by_controller_epoch: null }))] })))).toContain("no_accepted_final_evidence");
    expect(blockers(evaluateTaskClose(input({ attempts: [facts(attempt({ result_refs: [] }))] })))).toContain("no_accepted_final_evidence");
    expect(blockers(evaluateTaskClose(input({ attempts: [facts(attempt({ result_refs: [ev({ availability: "missing", reason: "gc" })] }))] })))).toContain("no_accepted_final_evidence");
    expect(blockers(evaluateTaskClose(input({ acceptance: { state: "pending", subject_hash: null } })))).toContain("acceptance_unverified");
    expect(blockers(evaluateTaskClose(input({ acceptance: { state: "verified", subject_hash: H("d") } })))).toContain("acceptance_subject_mismatch");
    // An earlier verified attempt does not stand in for a failed final one.
    const failedFinal = facts(attempt({ ordinal: 2, lineage: { ...attempt().lineage, attempt_id: "att-2" }, accepted_by_controller_epoch: null, acceptance_subject_hash: null }, { outcome: "failed", acceptance: "rejected" }));
    expect(blockers(evaluateTaskClose(input({ attempts: [facts(attempt()), failedFinal] })))).toContain("no_accepted_final_evidence");
  });

  it("acceptance not required records not_required, never verified", () => {
    const r = evaluateTaskClose(input({ acceptance_required: false, acceptance: { state: "pending", subject_hash: null } }));
    expect(r.ok && r.state.acceptance).toBe("not_required");
  });

  it("partial is explicit, needs an operator and reason, and never claims verified acceptance", () => {
    expect(blockers(evaluateTaskClose(input({ request: { kind: "partial", operator_id: "op-miguel", reason: "" } })))).toContain("operator_reason_required");
    expect(blockers(evaluateTaskClose(input({ request: { kind: "partial", operator_id: "", reason: "half done" } })))).toContain("operator_reason_required");
    const p = evaluateTaskClose(input({ request: { kind: "partial", operator_id: "op-miguel", reason: "half done" } }));
    expect(p.ok && p.state).toEqual({ lifecycle: "closed", outcome: "partial", acceptance: "pending", observability: "complete" });
  });

  it("an unacknowledged follow-up transfer blocks any clean close", () => {
    const tb = { operation_id: "xfer-1", state: "source_committed" as const };
    expect(blockers(evaluateTaskClose(input({ transfer_blocker: tb })))).toContain("transfer_unacknowledged");
    expect(blockers(evaluateTaskClose(input({ transfer_blocker: tb, request: { kind: "cancel", operator_id: "op-miguel", reason: "x" } })))).toContain("transfer_unacknowledged");
  });

  it("an unknown request kind is refused", () => {
    expect(blockers(evaluateTaskClose(input({ request: { kind: "archived" } as never })))).toContain("request_invalid");
  });

  it("negative control: exit 0 or archive alone never marks accepted success", () => {
    const bare = attempt({ accepted_by_controller_epoch: null, acceptance_subject_hash: null, result_refs: [] }, { lifecycle: "closed", outcome: "pending", acceptance: "pending" });
    const withArchive = { ...input({ attempts: [facts(bare, "verified", 0)], acceptance: { state: "pending", subject_hash: null } }), archived: true, exit_code: 0 } as TaskCloseInput;
    const r = evaluateTaskClose(withArchive);
    expect(r.ok).toBe(false);
    expect(blockers(r)).toEqual(expect.arrayContaining(["no_accepted_final_evidence", "acceptance_unverified"]));
    // An attempt record claiming success without controller acceptance is not enough either.
    const claimed = attempt({ accepted_by_controller_epoch: null }, { outcome: "succeeded", acceptance: "verified" });
    expect(evaluateTaskClose(input({ attempts: [facts(claimed, "verified", 0)] })).ok).toBe(false);
    // No attempts at all.
    expect(blockers(evaluateTaskClose(input({ attempts: [] })))).toContain("no_accepted_final_evidence");
  });
});

describe("AT14 · closure matrix (goal)", () => {
  const ok: StateAxes = { lifecycle: "closed", outcome: "succeeded", acceptance: "verified", observability: "complete" };
  const goal: Entity = { source_id: SRC, kind: "goal", id: "goal-1", revision: H("e") };
  it("a goal succeeds only when every contributing task closed succeeded with acceptance", () => {
    expect(evaluateGoalClose({ goal, contributions: [{ task: TASK, state: ok }], request: { kind: "verified_success" } }).ok).toBe(true);
    const open = evaluateGoalClose({ goal, contributions: [{ task: TASK, state: ok }, { task: { ...TASK, id: "task-2" }, state: null }], request: { kind: "verified_success" } });
    expect(!open.ok && open.blockers.map((b) => b.code)).toContain("contribution_open");
    const partial = evaluateGoalClose({ goal, contributions: [{ task: TASK, state: { ...ok, outcome: "partial", acceptance: "pending" } }], request: { kind: "verified_success" } });
    expect(!partial.ok && partial.blockers.map((b) => b.code)).toContain("contribution_not_succeeded");
    const none = evaluateGoalClose({ goal, contributions: [], request: { kind: "verified_success" } });
    expect(!none.ok && none.blockers.map((b) => b.code)).toContain("no_contributions");
  });
  it("a cancelled goal is explicit and waits for open contributions to close", () => {
    const req = { kind: "cancel" as const, operator_id: "op-miguel", reason: "dropped" };
    const c = evaluateGoalClose({ goal, contributions: [{ task: TASK, state: { ...ok, outcome: "cancelled", acceptance: "not_required" } }], request: req });
    expect(c.ok && c.state.outcome).toBe("cancelled");
    const open = evaluateGoalClose({ goal, contributions: [{ task: TASK, state: { ...ok, lifecycle: "active", outcome: "pending" } }], request: req });
    expect(!open.ok && open.blockers.map((b) => b.code)).toContain("contribution_open");
  });
});

describe("AT14 · initiative close predicate (software vs research)", () => {
  const d8Done = { execVerified: true, execution_status: "done" as const, release_status: "released" as const, documentation_status: "updated" as const };
  const accepted = [{ ref: ev(), accepted: true }];
  const done = [{ id: "w1", status: "done" }, { id: "w2", status: "cancelled" }];

  it("software keeps the strict D8 gate; no research shortcut", () => {
    expect(initiativeClosePredicate({ d8: d8Done, work_items: done, research_evidence: [] }).canClose).toBe(true);
    const unreleased = initiativeClosePredicate({ d8: { ...d8Done, release_status: "not_released" }, work_items: done, research_evidence: accepted, research_predicate_adopted: true });
    expect(unreleased.kind).toBe("software");
    expect(unreleased.canClose).toBe(false);
    const noDocs = initiativeClosePredicate({ outcome_kind: "software", d8: { ...d8Done, documentation_status: "not_assessed" }, work_items: done, research_evidence: [] });
    expect(noDocs.canClose).toBe(false);
  });

  it("research completes on the adopted kind predicate without a software release", () => {
    const r = initiativeClosePredicate({
      outcome_kind: "research", research_predicate_adopted: true,
      d8: { execVerified: false, execution_status: "done", release_status: "not_released", documentation_status: "no_update_required" },
      work_items: done, research_evidence: accepted,
    });
    expect(r).toMatchObject({ kind: "research", canClose: true, blockers: [] });
  });

  it("research needs adoption, accepted evidence, all work disposed and docs; it cannot claim a release", () => {
    const base = { outcome_kind: "research", research_predicate_adopted: true, d8: { execVerified: false, execution_status: "done" as const, release_status: "not_released" as const, documentation_status: "updated" as const }, work_items: done, research_evidence: accepted };
    const codes = (o: Record<string, unknown>) => initiativeClosePredicate({ ...base, ...o } as never).blockers.join("|");
    expect(codes({ research_predicate_adopted: false })).toContain("not adopted");
    expect(codes({ research_evidence: [{ ref: ev(), accepted: false }] })).toContain("accepted research evidence");
    expect(codes({ research_evidence: [{ ref: ev({ availability: "missing", reason: "gc" }), accepted: true }] })).toContain("accepted research evidence");
    expect(codes({ work_items: [{ id: "w1", status: "in_progress" }] })).toContain("w1");
    expect(codes({ work_items: [{ id: "w1", status: "deferred" }] })).toContain("w1");
    expect(codes({ d8: { ...base.d8, documentation_status: "stale" } })).toContain("docs");
    expect(codes({ d8: { ...base.d8, release_status: "released" } })).toContain("software release");
    expect(codes({ d8: { ...base.d8, execution_status: "active" } })).toContain("execution");
  });

  it("an unknown or misspelled kind refuses instead of falling back", () => {
    const r = initiativeClosePredicate({ outcome_kind: "Research", research_predicate_adopted: true, d8: d8Done, work_items: done, research_evidence: accepted });
    expect(r.canClose).toBe(false);
    expect(r.blockers.join()).toContain("unknown outcome kind");
  });
});

// ── persistence through the R02 controller ───────────────────────────────────

describe("AT14 · recordWorkClose", () => {
  let tmp: string;
  let durableRoot: string;
  let privateDir: string;
  let ctl: RunController;
  let grant: WriterGrant;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "r04-close-"));
    durableRoot = path.join(tmp, "project");
    fs.mkdirSync(durableRoot);
    privateDir = path.join(tmp, "state");
    ctl = openRunController({ privateDir, durableRoot, source_id: SRC, run_id: RUN, host_id: "host-a" });
    grant = ctl.issueWriterGrant("scope:lifecycle");
  });
  afterEach(() => {
    ctl.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("persists one closure per work, idempotent on replay, conflicting outcome refused", () => {
    const d = evaluateTaskClose(input());
    if (!d.ok) throw new Error("fixture");
    const a = recordWorkClose({ controller: ctl, grant, controllerPrivateDir: privateDir, durableRoot, subject: TASK, operation_id: "close-task-1", decision: d, request: { kind: "verified_success" }, closed_at: "2026-11-05T01:00:00.000Z" });
    const b = recordWorkClose({ controller: ctl, grant, controllerPrivateDir: privateDir, durableRoot, subject: TASK, operation_id: "close-task-1", decision: d, request: { kind: "verified_success" }, closed_at: "2026-11-05T02:00:00.000Z" });
    expect(b).toEqual(a);
    expect(readWorkClosure(durableRoot, RUN, TASK, privateDir)).toEqual(a);
    const c = evaluateTaskClose(input({ request: { kind: "cancel", operator_id: "op-miguel", reason: "x" } }));
    if (!c.ok) throw new Error("fixture");
    let code = "";
    try {
      recordWorkClose({ controller: ctl, grant, controllerPrivateDir: privateDir, durableRoot, subject: TASK, operation_id: "close-task-1b", decision: c, request: { kind: "cancel", operator_id: "op-miguel", reason: "x" }, closed_at: "2026-11-05T03:00:00.000Z" });
    } catch (e) { code = (e as WorkClosureRefusal).code; }
    expect(code).toBe("closure_conflict");
  });

  it("re-checks the transfer journal: a reserved follow-up blocks the close write", () => {
    const target = path.join(tmp, "target");
    fs.mkdirSync(target);
    const rev = openWorkDisposition(durableRoot, RUN, TASK);
    expect(() => runTransfer(
      { operation_id: "xfer-1", source_work: TASK, expected_disposition_revision: rev, destination_work: { source_id: "source-b", kind: "logical_task", id: "follow-1", revision: H("f") }, destination_policy_hash: H("1"), payload: { title: "follow up" } },
      { controller: ctl, grant, sourceRoot: durableRoot, targetRoot: target, at: (p) => { if (p === "reserved_record") throw new Error("crash"); } },
    )).toThrow("crash");
    const d = evaluateTaskClose(input());
    if (!d.ok) throw new Error("fixture");
    let code = "";
    try {
      recordWorkClose({ controller: ctl, grant, controllerPrivateDir: privateDir, durableRoot, subject: TASK, operation_id: "close-task-1", decision: d, request: { kind: "verified_success" }, closed_at: "2026-11-05T01:00:00.000Z" });
    } catch (e) { code = (e as WorkClosureRefusal).code; }
    expect(code).toBe("transfer_unacknowledged");
    expect(readWorkClosure(durableRoot, RUN, TASK, privateDir)).toBeNull();
  });

  it("codex r1 F1: a tampered closure record refuses on read", () => {
    const c = evaluateTaskClose(input({ request: { kind: "cancel", operator_id: "op-miguel", reason: "x" } }));
    if (!c.ok) throw new Error("fixture");
    recordWorkClose({ controller: ctl, grant, controllerPrivateDir: privateDir, durableRoot, subject: TASK, operation_id: "close-task-1", decision: c, request: { kind: "cancel", operator_id: "op-miguel", reason: "x" }, closed_at: "2026-11-05T01:00:00.000Z" });
    const file = path.join(durableRoot, ".guild", "runs", RUN, "closures", "logical_task", "task-1.json");
    const rec = JSON.parse(fs.readFileSync(file, "utf8"));
    rec.state = { ...rec.state, outcome: "succeeded", acceptance: "verified" };
    fs.writeFileSync(file, JSON.stringify(rec));
    let code = "";
    try { readWorkClosure(durableRoot, RUN, TASK, privateDir); } catch (e) { code = (e as WorkClosureRefusal).code; }
    expect(code).toBe("closure_corrupt");
  });

  it("codex r1 F4: a closed work cannot acquire a follow-up reservation", () => {
    const rev = openWorkDisposition(durableRoot, RUN, TASK);
    const d = evaluateTaskClose(input());
    if (!d.ok) throw new Error("fixture");
    recordWorkClose({ controller: ctl, grant, controllerPrivateDir: privateDir, durableRoot, subject: TASK, operation_id: "close-task-1", decision: d, request: { kind: "verified_success" }, closed_at: "2026-11-05T01:00:00.000Z" });
    const target = path.join(tmp, "target");
    fs.mkdirSync(target);
    const r = runTransfer(
      { operation_id: "xfer-1", source_work: TASK, expected_disposition_revision: rev, destination_work: { source_id: "source-b", kind: "logical_task", id: "follow-1", revision: H("f") }, destination_policy_hash: H("1"), payload: { title: "late" } },
      { controller: ctl, grant, sourceRoot: durableRoot, targetRoot: target },
    );
    expect([r.state, r.refusal]).toEqual(["aborted", "disposition_conflict"]);
    expect(fs.existsSync(path.join(target, ".guild"))).toBe(false);
  });

  it("codex r2 F2: a crash between sealing and publication recovers on replay with a fresh timestamp", () => {
    const d = evaluateTaskClose(input());
    if (!d.ok) throw new Error("fixture");
    const dir = path.join(durableRoot, ".guild", "runs", RUN, "closures", "logical_task");
    fs.mkdirSync(dir, { recursive: true });
    fs.chmodSync(dir, 0o500);
    const call = (closed_at: string) => recordWorkClose({ controller: ctl, grant, controllerPrivateDir: privateDir, durableRoot, subject: TASK, operation_id: "close-task-1", decision: d, request: { kind: "verified_success" }, closed_at });
    try {
      expect(() => call("2026-11-05T01:00:00.000Z")).toThrow();
    } finally {
      fs.chmodSync(dir, 0o755);
    }
    const rec = call("2026-11-05T02:00:00.000Z");
    expect(rec.state.outcome).toBe("succeeded");
    expect(readWorkClosure(durableRoot, RUN, TASK, privateDir)).toEqual(rec);
  });

  it("a worker (attempt) grant cannot record a close", () => {
    const d = evaluateTaskClose(input());
    if (!d.ok) throw new Error("fixture");
    const worker = ctl.issueAttemptGrant({ execution_id: "exec-1", attempt_id: "att-9", scope: "scope:w", expires_at_ms: Date.now() + 60_000 });
    expect(() => recordWorkClose({ controller: ctl, grant: worker as unknown as WriterGrant, controllerPrivateDir: privateDir, durableRoot, subject: TASK, operation_id: "close-x", decision: d, request: { kind: "verified_success" }, closed_at: "2026-11-05T01:00:00.000Z" })).toThrow("worker_grant_not_writer");
    expect(readWorkClosure(durableRoot, RUN, TASK, privateDir)).toBeNull();
  });
});
