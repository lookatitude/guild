/**
 * W04 — persist bounded workflow invocation state (AT22).
 *
 * Fixture: a loop capped at 3 rounds whose `until` needs an approve outcome and
 * no unresolved questions; a crash after round 2; an altered component version.
 * Expected: restart restores round 2, its evidence and the definition hash; the
 * next bounded round blocks while a question is unresolved; a changed hash
 * needs an explicit replan. Negative control: a restart that resets the budget
 * or treats exhaustion as satisfaction fails the suite.
 */

import { describe, it, expect, beforeEach } from "bun:test";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { compileWorkflow, createComponentRegistry, type CompileManifest, type WorkflowProjectionV2 } from "./workflow-component-compiler";
import {
  INVOCATION_HEAD_FILE,
  INVOCATION_LOCK_FILE,
  INVOCATION_STATE_FILE,
  WORKFLOW_INVOCATION_STATE_SCHEMA,
  beginRound,
  cancelInvocation,
  completeRound,
  initInvocationState,
  invocationIdFor,
  invocationStateHash,
  loadInvocationState,
  openInvocation,
  overlayInvocations,
  replanInvocationState,
  resumeInvocations,
  type InvocationBasis,
  type InvocationStateV1,
  type StoreResult,
} from "./workflow-invocation-state";

// ---------------------------------------------------------------- fixtures

function task(id: string, extra: Record<string, unknown> = {}) {
  return { kind: "task", id, effect: "write", role: "developer", capabilities: ["code"], inputs: [], outputs: [], ...extra };
}
function component(id: string, effects: string[], body: unknown, version = "1") {
  return { schema_version: "guild.workflow_component.v1", id, version, effects, inputs: [], outputs: [], body };
}
const UNTIL = { kind: "all_of", conditions: [{ kind: "outcome", equals: "approve" }, { kind: "no_unresolved_questions" }] };

function registryFor(version = "1", maxRounds = 3) {
  const inner = component("refine", ["write"], { kind: "repeat", id: "fix", max_rounds: 2, until: { kind: "outcome", equals: "done" }, body: task("patch") }, "1");
  const loop = component("design-loop", ["write", "review"], {
    kind: "repeat",
    id: "loop",
    max_rounds: maxRounds,
    until: UNTIL,
    body: { kind: "sequence", id: "round", steps: [task("draft"), { kind: "call", id: "r", component: { id: "refine", version: "1" } }, task("review", { effect: "review", role: "reviewer", capabilities: ["review"] })] },
  }, version);
  const r = createComponentRegistry([inner, loop]);
  if (!r.ok) throw new Error(JSON.stringify(r.violations));
  return r.registry;
}

function compile(version = "1", maxRounds = 3): InvocationBasis {
  const r = compileWorkflow(registryFor(version, maxRounds), {
    class: "research",
    workflow: { source_id: "proj-a", id: "design" },
    root: { id: "design-loop", version },
    policy: { roles: { developer: ["code"], reviewer: ["review"] } },
  });
  if (!r.ok) throw new Error(JSON.stringify(r.violations));
  return { projection: r.projection, manifest: r.manifest };
}

const SUBJECT = `sha256:${"a".repeat(64)}`;
const EV1 = { name: "draft-r1", sha256: `sha256:${"1".repeat(64)}` };
const EV2 = { name: "draft-r2", sha256: `sha256:${"2".repeat(64)}` };
const EV3 = { name: "draft-r3", sha256: `sha256:${"3".repeat(64)}` };

let root: string;
let runDir: string;
let ctx: { root: string; runDir: string; run_id: string };

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "w04-")));
  runDir = path.join(root, ".guild", "runs", "run-w04");
  ctx = { root, runDir, run_id: "run-w04" };
});

function must<T>(r: StoreResult<T>): T {
  if (!r.ok) throw new Error(`${r.rule}: ${r.detail}`);
  return r.value;
}
function refused<T>(r: StoreResult<T>): string {
  if (r.ok) throw new Error(`expected refusal, got ${JSON.stringify(r.value).slice(0, 300)}`);
  return r.rule;
}
const snap = () => path.join(runDir, INVOCATION_STATE_FILE);
const head = () => path.join(runDir, INVOCATION_HEAD_FILE);
const read = (p: string) => fs.readFileSync(p, "utf8");

/** Drive the AT22 loop to "crash after round 2": two completed rounds, one question still open. */
function runTwoRounds(basis: InvocationBasis): string {
  must(initInvocationState(ctx, basis));
  const inv = must(openInvocation(ctx, basis, { loop_id: "loop", subject_hash: SUBJECT })).id;
  must(beginRound(ctx, basis, { invocation_id: inv, expected_round: 1 }));
  must(completeRound(ctx, basis, { invocation_id: inv, round: 1, outcome: "revise", unresolved_questions: ["q-scope", "q-auth"], evidence: [EV1] }));
  must(beginRound(ctx, basis, { invocation_id: inv, expected_round: 2 }));
  must(completeRound(ctx, basis, { invocation_id: inv, round: 2, outcome: "revise", unresolved_questions: ["q-auth"], evidence: [EV2] }));
  return inv;
}

// ---------------------------------------------------------------- AT22

describe("AT22 restart restores invocation, round, evidence and hash exactly", () => {
  it("a fresh process reading the run dir sees round 2 with its evidence and definition hash", () => {
    const basis = compile();
    const inv = runTwoRounds(basis);
    const before = read(snap());
    // "Restart": nothing in memory survives; only the run dir does.
    const state = must(loadInvocationState(ctx, compile()));
    const i = state.invocations.find((x) => x.id === inv)!;
    expect(i.rounds.length).toBe(2);
    expect(i.rounds[1]).toEqual({ round: 2, status: "completed", outcome: "revise", unresolved_questions: ["q-auth"], evidence: [EV2], obligations_accepted: false, artifacts: [] });
    expect(i.rounds[0].evidence).toEqual([EV1]);
    expect(i.definition_hash).toBe(basis.projection.definition_hash);
    expect(i.max_rounds).toBe(3);
    expect(state.stack).toEqual([inv]);
    const resume = must(resumeInvocations(ctx, compile()));
    expect(resume.next).toEqual({ kind: "begin-round", invocation_id: inv, round: 3 });
    // Loading and resuming never rewrite state.
    expect(read(snap())).toBe(before);
  });

  it("resume is deterministic: same bytes, same answer", () => {
    const basis = compile();
    runTwoRounds(basis);
    const a = JSON.stringify(must(resumeInvocations(ctx, basis)));
    const b = JSON.stringify(must(resumeInvocations(ctx, compile())));
    expect(a).toBe(b);
  });

  it("the third round with an unresolved question blocks and escalates; it never accepts", () => {
    const basis = compile();
    const inv = runTwoRounds(basis);
    must(beginRound(ctx, basis, { invocation_id: inv, expected_round: 3 }));
    // Approve outcome but q-auth still open: exhaustion is not satisfaction.
    const done = must(completeRound(ctx, basis, { invocation_id: inv, round: 3, outcome: "approve", unresolved_questions: ["q-auth"], evidence: [EV3] }));
    expect(done.state).toBe("blocked");
    expect(done.escalation).toEqual({ kind: "budget-exhausted", round: 3, unresolved_questions: ["q-auth"] });
    expect(refused(beginRound(ctx, basis, { invocation_id: inv, expected_round: 4 }))).toBe("budget-exhausted");
    const resume = must(resumeInvocations(ctx, compile()));
    expect(resume.next).toEqual({ kind: "blocked", invocation_id: inv, escalation: { kind: "budget-exhausted", round: 3, unresolved_questions: ["q-auth"] } });
    const projected = overlayInvocations(basis.projection, must(loadInvocationState(ctx, basis)));
    expect(projected.invocations[0]).toMatchObject({ id: inv, round: 3, max_rounds: 3, state: "blocked", unresolved_questions: ["q-auth"] });
  });

  it("a round that resolves every question and meets until accepts", () => {
    const basis = compile();
    const inv = runTwoRounds(basis);
    must(beginRound(ctx, basis, { invocation_id: inv, expected_round: 3 }));
    const done = must(completeRound(ctx, basis, { invocation_id: inv, round: 3, outcome: "approve", unresolved_questions: [], evidence: [EV3] }));
    expect(done.state).toBe("accepted");
    expect(must(loadInvocationState(ctx, basis)).stack).toEqual([]);
    expect(refused(beginRound(ctx, basis, { invocation_id: inv, expected_round: 4 }))).toBe("invocation-closed");
  });

  it("a changed component version requires an explicit replan and leaves state untouched", () => {
    const inv = runTwoRounds(compile());
    const s0 = read(snap());
    const h0 = read(head());
    const changed = compile("2");
    expect(changed.projection.definition_hash).not.toBe(compile().projection.definition_hash);
    expect(refused(loadInvocationState(ctx, changed))).toBe("replan-required");
    expect(refused(resumeInvocations(ctx, changed))).toBe("replan-required");
    expect(refused(beginRound(ctx, changed, { invocation_id: inv, expected_round: 3 }))).toBe("replan-required");
    expect(refused(openInvocation(ctx, changed, { loop_id: "loop", subject_hash: SUBJECT }))).toBe("replan-required");
    expect(refused(initInvocationState(ctx, changed))).toBe("replan-required");
    expect(read(snap())).toBe(s0);
    expect(read(head())).toBe(h0);
    // A changed budget is a changed definition too.
    expect(refused(loadInvocationState(ctx, compile("1", 5)))).toBe("replan-required");
  });

  it("explicit replan rebinds, keeps history and carries open questions; same definition cannot replan", () => {
    const old = compile();
    const inv = runTwoRounds(old);
    expect(refused(replanInvocationState(ctx, old, { reason: "reset" }))).toBe("replan-unchanged");
    const changed = compile("2");
    const st = must(replanInvocationState(ctx, changed, { reason: "architect revised design-loop" }));
    expect(st.basis.definition_hash).toBe(changed.projection.definition_hash);
    expect(st.invocations).toEqual([]);
    expect(st.stack).toEqual([]);
    expect(st.previous).toMatchObject({ definition_hash: old.projection.definition_hash, reason: "architect revised design-loop", open_questions: ["q-auth"], cancelled_invocations: [inv] });
    expect(refused(loadInvocationState(ctx, old))).toBe("replan-required");
    expect(must(loadInvocationState(ctx, changed)).seq).toBeGreaterThan(0);
  });
});

describe("crash points: resume exactly once, never double-run a round", () => {
  it("crash after a round is begun: restart re-attaches to the same round, a second begin is refused", () => {
    const basis = compile();
    const inv = runTwoRounds(basis);
    must(beginRound(ctx, basis, { invocation_id: inv, expected_round: 3 }));
    // crash: the worker for round 3 may or may not have run.
    const resume = must(resumeInvocations(ctx, compile()));
    expect(resume.next).toEqual({ kind: "await-round", invocation_id: inv, round: 3 });
    expect(refused(beginRound(ctx, basis, { invocation_id: inv, expected_round: 3 }))).toBe("round-in-flight");
    expect(refused(beginRound(ctx, basis, { invocation_id: inv, expected_round: 4 }))).toBe("round-in-flight");
    const s = must(loadInvocationState(ctx, basis));
    expect(s.invocations[0].rounds.length).toBe(3);
  });

  it("crash after the round is written: restart sees it in flight, never round 2 done", () => {
    const basis = compile();
    const inv = runTwoRounds(basis);
    expect(() => beginRound(ctx, basis, { invocation_id: inv, expected_round: 3 }, { faults: { afterSnapshot: () => { throw new Error("crash after snapshot"); } } })).toThrow("crash after snapshot");
    expect(must(resumeInvocations(ctx, compile())).next).toEqual({ kind: "await-round", invocation_id: inv, round: 3 });
    expect(refused(beginRound(ctx, basis, { invocation_id: inv, expected_round: 3 }))).toBe("round-in-flight");
    expect(must(completeRound(ctx, basis, { invocation_id: inv, round: 3, outcome: "approve", unresolved_questions: [], evidence: [EV3] })).state).toBe("accepted");
  });

  it("crash between head and snapshot: the change never landed, and repeated crashes still recover", () => {
    const basis = compile();
    const inv = runTwoRounds(basis);
    const s0 = read(snap());
    const crash = { faults: { afterHead: () => { throw new Error("crash after head"); } } };
    for (let k = 0; k < 3; k++) {
      expect(() => beginRound(ctx, basis, { invocation_id: inv, expected_round: 3 }, crash)).toThrow("crash after head");
      expect(read(snap())).toBe(s0);
      expect(must(resumeInvocations(ctx, compile())).next).toEqual({ kind: "begin-round", invocation_id: inv, round: 3 });
    }
    must(beginRound(ctx, basis, { invocation_id: inv, expected_round: 3 }));
    expect(() => completeRound(ctx, basis, { invocation_id: inv, round: 3, outcome: "approve", unresolved_questions: [], evidence: [EV3] }, crash)).toThrow();
    expect(() => completeRound(ctx, basis, { invocation_id: inv, round: 3, outcome: "approve", unresolved_questions: [], evidence: [EV3] }, crash)).toThrow();
    expect(must(resumeInvocations(ctx, basis)).next).toEqual({ kind: "await-round", invocation_id: inv, round: 3 });
    expect(must(completeRound(ctx, basis, { invocation_id: inv, round: 3, outcome: "approve", unresolved_questions: [], evidence: [EV3] })).state).toBe("accepted");
  });

  it("a crash during the very first write leaves no state and init can be retried", () => {
    const basis = compile();
    expect(() => initInvocationState(ctx, basis, { faults: { afterHead: () => { throw new Error("crash"); } } })).toThrow();
    expect(refused(loadInvocationState(ctx, basis))).toBe("no-state");
    must(initInvocationState(ctx, basis));
  });

  it("a second controller cannot mutate while one holds the run; a dead holder's lock is taken over", () => {
    const basis = compile();
    const inv = runTwoRounds(basis);
    let inner = "";
    must(beginRound(ctx, basis, { invocation_id: inv, expected_round: 3 }, { faults: { afterHead: () => { inner = refused(beginRound(ctx, basis, { invocation_id: inv, expected_round: 3 })); } } }));
    expect(inner).toBe("state-locked");
    expect(must(loadInvocationState(ctx, basis)).invocations[0].rounds.length).toBe(3);
    const lock = path.join(runDir, INVOCATION_LOCK_FILE);
    fs.writeFileSync(lock, `${process.pid}:live`);
    expect(refused(completeRound(ctx, basis, { invocation_id: inv, round: 3, outcome: "approve", unresolved_questions: [], evidence: [] }))).toBe("state-locked");
    const dead = spawnSync(process.execPath, ["-e", ""]).pid;
    fs.writeFileSync(lock, `${dead}:crashed`);
    expect(must(completeRound(ctx, basis, { invocation_id: inv, round: 3, outcome: "approve", unresolved_questions: [], evidence: [] })).state).toBe("accepted");
    expect(fs.existsSync(lock)).toBe(false);
  });

  it("a controller that lost the lock mid-write stops before the next write", () => {
    const basis = compile();
    const inv = runTwoRounds(basis);
    const lock = path.join(runDir, INVOCATION_LOCK_FILE);
    const steal = { faults: { afterHead: () => fs.writeFileSync(lock, `${process.pid}:other-controller`) } };
    expect(refused(beginRound(ctx, basis, { invocation_id: inv, expected_round: 3 }, steal))).toBe("state-locked");
    fs.rmSync(lock);
    // The pending head never landed its snapshot: round 3 was not begun.
    expect(must(resumeInvocations(ctx, basis)).next).toEqual({ kind: "begin-round", invocation_id: inv, round: 3 });
  });

  it("directly nested repeats (identical bodies) open outer-first", () => {
    const reg = createComponentRegistry([
      component("nest", ["write"], { kind: "repeat", id: "outer", max_rounds: 2, until: { kind: "outcome", equals: "ok" }, body: { kind: "repeat", id: "inner", max_rounds: 2, until: { kind: "outcome", equals: "ok" }, body: task("work") } }),
    ]);
    if (!reg.ok) throw new Error("fixture");
    const r = compileWorkflow(reg.registry, { class: "research", workflow: { source_id: "proj-a", id: "nest" }, root: { id: "nest", version: "1" }, policy: { roles: { developer: ["code"] } } });
    if (!r.ok) throw new Error(JSON.stringify(r.violations));
    const basis = { projection: r.projection, manifest: r.manifest };
    must(initInvocationState(ctx, basis));
    expect(refused(openInvocation(ctx, basis, { loop_id: "inner", subject_hash: SUBJECT }))).toBe("parent-required");
    const outer = must(openInvocation(ctx, basis, { loop_id: "outer", subject_hash: SUBJECT })).id;
    must(beginRound(ctx, basis, { invocation_id: outer, expected_round: 1 }));
    const inner = must(openInvocation(ctx, basis, { loop_id: "inner", subject_hash: SUBJECT, parent: { invocation_id: outer, round: 1 } }));
    expect(inner.max_rounds).toBe(2);
    expect(must(loadInvocationState(ctx, basis)).stack).toEqual([outer, inner.id]);
  });

  it("a write that would exceed the snapshot cap is refused before anything is written", () => {
    const basis = compile();
    const inv = runTwoRounds(basis);
    const s0 = read(snap());
    const h0 = read(head());
    must(beginRound(ctx, basis, { invocation_id: inv, expected_round: 3 }));
    const s1 = read(snap());
    const big = Array.from({ length: 64 }, (_, i) => `question-${i}-${"x".repeat(100)}`);
    expect(refused(completeRound(ctx, basis, { invocation_id: inv, round: 3, outcome: "revise", unresolved_questions: big, evidence: [] }, { maxStateBytes: s1.length + 1000 }))).toBe("capacity-exceeded");
    expect(read(snap())).toBe(s1);
    expect(s0).not.toBe(s1);
    expect(h0).not.toBe(read(head()));
    expect(must(resumeInvocations(ctx, basis)).next).toEqual({ kind: "await-round", invocation_id: inv, round: 3 });
  });

  it("completing a round twice is idempotent for the same result and refused for a different one", () => {
    const basis = compile();
    const inv = runTwoRounds(basis);
    const s0 = read(snap());
    const again = must(completeRound(ctx, basis, { invocation_id: inv, round: 2, outcome: "revise", unresolved_questions: ["q-auth"], evidence: [EV2] }));
    expect(again.replayed).toBe(true);
    expect(read(snap())).toBe(s0);
    expect(refused(completeRound(ctx, basis, { invocation_id: inv, round: 2, outcome: "approve", unresolved_questions: [], evidence: [EV2] }))).toBe("round-already-completed");
    expect(refused(completeRound(ctx, basis, { invocation_id: inv, round: 3, outcome: "approve", unresolved_questions: [], evidence: [] }))).toBe("no-round-in-flight");
  });

  it("a stale begin after restart cannot skip or repeat a round", () => {
    const basis = compile();
    const inv = runTwoRounds(basis);
    expect(refused(beginRound(ctx, basis, { invocation_id: inv, expected_round: 2 }))).toBe("round-mismatch");
    expect(refused(beginRound(ctx, basis, { invocation_id: inv, expected_round: 4 }))).toBe("round-mismatch");
  });

  it("reopening an invocation after restart returns the same one with its budget, never a fresh one", () => {
    const basis = compile();
    const inv = runTwoRounds(basis);
    const again = must(openInvocation(ctx, compile(), { loop_id: "loop", subject_hash: SUBJECT }));
    expect(again.id).toBe(inv);
    expect(again.rounds.length).toBe(2);
    expect(refused(openInvocation(ctx, basis, { loop_id: "loop", subject_hash: `sha256:${"b".repeat(64)}` }))).toBe("invocation-conflict");
    expect(refused(initInvocationState(ctx, basis))).toBe("state-exists");
  });
});

describe("negative control: restart cannot reset the budget or turn exhaustion into acceptance", () => {
  function tamper(mut: (s: InvocationStateV1) => void, rehead = true): void {
    const s = JSON.parse(read(snap())) as InvocationStateV1;
    mut(s);
    s.state_hash = invocationStateHash(s);
    fs.writeFileSync(snap(), JSON.stringify(s, null, 2) + "\n");
    if (rehead) fs.writeFileSync(head(), JSON.stringify({ ...JSON.parse(read(head())), seq: s.seq, state_hash: s.state_hash }, null, 2) + "\n");
  }

  it("deleting the snapshot does not restart the loop at round 0", () => {
    const basis = compile();
    runTwoRounds(basis);
    fs.rmSync(snap());
    expect(refused(loadInvocationState(ctx, basis))).toBe("state-missing");
    expect(refused(initInvocationState(ctx, basis))).toBe("state-missing");
    expect(refused(resumeInvocations(ctx, basis))).toBe("state-missing");
  });

  it("deleting the head past the first write does not unanchor the snapshot", () => {
    const basis = compile();
    runTwoRounds(basis);
    fs.rmSync(head());
    expect(refused(loadInvocationState(ctx, basis))).toBe("state-missing");
  });

  it("a snapshot-only forgery chained to the head is refused (cannot reset an exhausted budget)", () => {
    const basis = compile();
    const inv = runTwoRounds(basis);
    must(beginRound(ctx, basis, { invocation_id: inv, expected_round: 3 }));
    must(completeRound(ctx, basis, { invocation_id: inv, round: 3, outcome: "revise", unresolved_questions: ["q-auth"], evidence: [EV3] }));
    const h = JSON.parse(read(head()));
    const s = JSON.parse(read(snap())) as InvocationStateV1;
    s.seq = h.seq + 1;
    s.prev_state_hash = h.state_hash;
    s.invocations[0].rounds = [];
    s.invocations[0].state = "active";
    s.invocations[0].escalation = null;
    s.state_hash = invocationStateHash(s);
    fs.writeFileSync(snap(), JSON.stringify(s, null, 2) + "\n");
    expect(refused(loadInvocationState(ctx, basis))).toBe("state-stale");
    expect(refused(beginRound(ctx, basis, { invocation_id: inv, expected_round: 1 }))).toBe("state-stale");
  });

  it("replaying the pre-round snapshot after a committed begin is refused (no second round 3)", () => {
    const basis = compile();
    const inv = runTwoRounds(basis);
    const before = read(snap());
    must(beginRound(ctx, basis, { invocation_id: inv, expected_round: 3 }));
    fs.writeFileSync(snap(), before);
    expect(refused(resumeInvocations(ctx, basis))).toBe("state-stale");
    expect(refused(beginRound(ctx, basis, { invocation_id: inv, expected_round: 3 }))).toBe("state-stale");
  });

  it("after crash recovery settles the head, replaying the pre-round snapshot is stale", () => {
    const basis = compile();
    const inv = runTwoRounds(basis);
    const before = read(snap());
    expect(() => beginRound(ctx, basis, { invocation_id: inv, expected_round: 3 }, { faults: { afterSnapshot: () => { throw new Error("crash"); } } })).toThrow();
    expect(must(resumeInvocations(ctx, basis)).next).toEqual({ kind: "await-round", invocation_id: inv, round: 3 });
    expect(JSON.parse(read(head())).phase).toBe("committed");
    fs.writeFileSync(snap(), before);
    expect(refused(resumeInvocations(ctx, basis))).toBe("state-stale");
    expect(refused(beginRound(ctx, basis, { invocation_id: inv, expected_round: 3 }))).toBe("state-stale");
  });

  it("restoring an older snapshot is refused as stale", () => {
    const basis = compile();
    must(initInvocationState(ctx, basis));
    const inv = must(openInvocation(ctx, basis, { loop_id: "loop", subject_hash: SUBJECT })).id;
    must(beginRound(ctx, basis, { invocation_id: inv, expected_round: 1 }));
    const old = read(snap());
    must(completeRound(ctx, basis, { invocation_id: inv, round: 1, outcome: "revise", unresolved_questions: ["q"], evidence: [EV1] }));
    must(beginRound(ctx, basis, { invocation_id: inv, expected_round: 2 }));
    fs.writeFileSync(snap(), old);
    expect(refused(loadInvocationState(ctx, basis))).toBe("state-stale");
  });

  it("a self-consistent edit that drops rounds but not the head is refused", () => {
    const basis = compile();
    runTwoRounds(basis);
    tamper((s) => {
      s.invocations[0].rounds = s.invocations[0].rounds.slice(0, 1);
    }, false);
    expect(refused(loadInvocationState(ctx, basis))).toBe("state-stale");
  });

  it("a forged 'active' state at exhaustion is refused even with consistent hashes", () => {
    const basis = compile();
    const inv = runTwoRounds(basis);
    must(beginRound(ctx, basis, { invocation_id: inv, expected_round: 3 }));
    must(completeRound(ctx, basis, { invocation_id: inv, round: 3, outcome: "revise", unresolved_questions: ["q-auth"], evidence: [EV3] }));
    tamper((s) => {
      s.invocations[0].state = "active";
      s.invocations[0].escalation = null;
    });
    expect(refused(loadInvocationState(ctx, basis))).toBe("state-corrupt");
  });

  it("a forged 'accepted' with unresolved questions is refused", () => {
    const basis = compile();
    runTwoRounds(basis);
    tamper((s) => {
      s.invocations[0].state = "accepted";
      s.stack = [];
    });
    expect(refused(loadInvocationState(ctx, basis))).toBe("state-corrupt");
  });

  it("a forged root-level invocation of a nested loop is refused", () => {
    const basis = compile();
    must(initInvocationState(ctx, basis));
    tamper((s) => {
      const l = s.basis.loops.find((x) => x.id === "r.fix")!;
      s.invocations.push({ id: invocationIdFor("r.fix", null), loop_id: "r.fix", node_id: l.entry, parent: null, max_rounds: l.max_rounds, definition_hash: s.basis.definition_hash, subject_hash: SUBJECT, state: "active", escalation: null, cancel_reason: null, rounds: [] });
      s.stack = [invocationIdFor("r.fix", null)];
    });
    expect(refused(loadInvocationState(ctx, basis))).toBe("state-corrupt");
  });

  it("a forged larger max_rounds or extra round beyond the bound is refused", () => {
    const basis = compile();
    runTwoRounds(basis);
    tamper((s) => {
      s.invocations[0].max_rounds = 9;
    });
    expect(refused(loadInvocationState(ctx, basis))).toBe("state-corrupt");
  });

  it("a forged basis (pinned to a different definition) is replan-required, never adopted", () => {
    const basis = compile();
    runTwoRounds(basis);
    tamper((s) => {
      s.basis.definition_hash = `sha256:${"f".repeat(64)}`;
    });
    expect(["replan-required", "state-corrupt"]).toContain(refused(loadInvocationState(ctx, basis)));
  });

  it("a self-hash mismatch, a non-JSON body, unknown keys and a symlinked state file are refused", () => {
    const basis = compile();
    runTwoRounds(basis);
    const good = read(snap());
    const s = JSON.parse(good);
    s.invocations[0].rounds[0].outcome = "approve";
    fs.writeFileSync(snap(), JSON.stringify(s));
    expect(refused(loadInvocationState(ctx, basis))).toBe("state-corrupt");
    fs.writeFileSync(snap(), "{not json");
    expect(refused(loadInvocationState(ctx, basis))).toBe("state-corrupt");
    fs.writeFileSync(snap(), good);
    tamper((x) => {
      (x as unknown as Record<string, unknown>).__proto_extra = 1;
    });
    expect(refused(loadInvocationState(ctx, basis))).toBe("state-corrupt");
    fs.writeFileSync(snap(), good);
    fs.writeFileSync(head(), JSON.stringify({ ...JSON.parse(read(head())) }));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "w04-out-"));
    fs.writeFileSync(path.join(outside, "s.json"), good);
    fs.rmSync(snap());
    fs.symlinkSync(path.join(outside, "s.json"), snap());
    expect(refused(loadInvocationState(ctx, basis))).toBe("path-not-contained");
  });

  it("a run dir outside the project root is refused", () => {
    const basis = compile();
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "w04-esc-"));
    expect(refused(initInvocationState({ ...ctx, runDir: outside }, basis))).toBe("path-not-contained");
    expect(refused(initInvocationState({ ...ctx, runDir: path.join(root, "..", "x") }, basis))).toBe("path-not-contained");
  });
});

describe("invocation stack, nesting and inputs", () => {
  it("an outcome-only until still never accepts with an unresolved question", () => {
    const basis = compile();
    must(initInvocationState(ctx, basis));
    const outer = must(openInvocation(ctx, basis, { loop_id: "loop", subject_hash: SUBJECT })).id;
    must(beginRound(ctx, basis, { invocation_id: outer, expected_round: 1 }));
    const inner = must(openInvocation(ctx, basis, { loop_id: "r.fix", subject_hash: SUBJECT, parent: { invocation_id: outer, round: 1 } })).id;
    must(beginRound(ctx, basis, { invocation_id: inner, expected_round: 1 }));
    expect(must(completeRound(ctx, basis, { invocation_id: inner, round: 1, outcome: "done", unresolved_questions: ["q-open"], evidence: [] })).state).toBe("active");
    must(beginRound(ctx, basis, { invocation_id: inner, expected_round: 2 }));
    expect(must(completeRound(ctx, basis, { invocation_id: inner, round: 2, outcome: "done", unresolved_questions: ["q-open"], evidence: [] })).state).toBe("blocked");
  });

  it("a nested loop cannot open at the root even with an empty stack", () => {
    const basis = compile();
    must(initInvocationState(ctx, basis));
    expect(refused(openInvocation(ctx, basis, { loop_id: "r.fix", subject_hash: SUBJECT }))).toBe("parent-required");
  });

  it("a sibling loop cannot be opened, or forged, as a child of another loop", () => {
    const sib = createComponentRegistry([
      component("two-loops", ["write"], {
        kind: "sequence",
        id: "main",
        steps: [
          { kind: "repeat", id: "a", max_rounds: 2, until: { kind: "outcome", equals: "ok" }, body: task("x") },
          { kind: "repeat", id: "b", max_rounds: 2, until: { kind: "outcome", equals: "ok" }, body: task("y") },
        ],
      }),
    ]);
    if (!sib.ok) throw new Error("fixture");
    const r = compileWorkflow(sib.registry, { class: "research", workflow: { source_id: "proj-a", id: "two" }, root: { id: "two-loops", version: "1" }, policy: { roles: { developer: ["code"] } } });
    if (!r.ok) throw new Error(JSON.stringify(r.violations));
    const basis = { projection: r.projection, manifest: r.manifest };
    must(initInvocationState(ctx, basis));
    const a = must(openInvocation(ctx, basis, { loop_id: "a", subject_hash: SUBJECT })).id;
    must(beginRound(ctx, basis, { invocation_id: a, expected_round: 1 }));
    expect(refused(openInvocation(ctx, basis, { loop_id: "b", subject_hash: SUBJECT, parent: { invocation_id: a, round: 1 } }))).toBe("invalid-input");
    const s = JSON.parse(read(snap())) as InvocationStateV1;
    const child = { ...s.invocations[0], id: invocationIdFor("b", { invocation_id: a, round: 1 }), loop_id: "b", node_id: s.basis.loops.find((l) => l.id === "b")!.entry, parent: { invocation_id: a, round: 1 }, rounds: [] };
    s.invocations.push(child);
    s.stack.push(child.id);
    s.state_hash = invocationStateHash(s);
    fs.writeFileSync(snap(), JSON.stringify(s));
    fs.writeFileSync(head(), JSON.stringify({ ...JSON.parse(read(head())), seq: s.seq, state_hash: s.state_hash }));
    expect(refused(loadInvocationState(ctx, basis))).toBe("state-corrupt");
  });

  it("a nested loop runs inside the parent round; only the top of the stack moves", () => {
    const basis = compile();
    must(initInvocationState(ctx, basis));
    const outer = must(openInvocation(ctx, basis, { loop_id: "loop", subject_hash: SUBJECT })).id;
    expect(refused(openInvocation(ctx, basis, { loop_id: "r.fix", subject_hash: SUBJECT, parent: { invocation_id: outer, round: 1 } }))).toBe("no-round-in-flight");
    must(beginRound(ctx, basis, { invocation_id: outer, expected_round: 1 }));
    expect(refused(openInvocation(ctx, basis, { loop_id: "r.fix", subject_hash: SUBJECT }))).toBe("parent-required");
    const inner = must(openInvocation(ctx, basis, { loop_id: "r.fix", subject_hash: SUBJECT, parent: { invocation_id: outer, round: 1 } }));
    expect(inner.max_rounds).toBe(2);
    expect(must(loadInvocationState(ctx, basis)).stack).toEqual([outer, inner.id]);
    expect(refused(completeRound(ctx, basis, { invocation_id: outer, round: 1, outcome: "revise", unresolved_questions: [], evidence: [] }))).toBe("not-top-of-stack");
    must(beginRound(ctx, basis, { invocation_id: inner.id, expected_round: 1 }));
    expect(must(completeRound(ctx, basis, { invocation_id: inner.id, round: 1, outcome: "done", unresolved_questions: [], evidence: [] })).state).toBe("accepted");
    expect(must(loadInvocationState(ctx, basis)).stack).toEqual([outer]);
    must(completeRound(ctx, basis, { invocation_id: outer, round: 1, outcome: "revise", unresolved_questions: ["q"], evidence: [] }));
    // Round 2 of the parent gets its own inner invocation and a fresh inner budget.
    must(beginRound(ctx, basis, { invocation_id: outer, expected_round: 2 }));
    const inner2 = must(openInvocation(ctx, basis, { loop_id: "r.fix", subject_hash: SUBJECT, parent: { invocation_id: outer, round: 2 } }));
    expect(inner2.id).not.toBe(inner.id);
    expect(inner2.rounds.length).toBe(0);
  });

  it("an exhausted inner loop blocks the parent; cancel is the only way past it", () => {
    const basis = compile();
    must(initInvocationState(ctx, basis));
    const outer = must(openInvocation(ctx, basis, { loop_id: "loop", subject_hash: SUBJECT })).id;
    must(beginRound(ctx, basis, { invocation_id: outer, expected_round: 1 }));
    const inner = must(openInvocation(ctx, basis, { loop_id: "r.fix", subject_hash: SUBJECT, parent: { invocation_id: outer, round: 1 } })).id;
    for (const n of [1, 2]) {
      must(beginRound(ctx, basis, { invocation_id: inner, expected_round: n }));
      must(completeRound(ctx, basis, { invocation_id: inner, round: n, outcome: "retry", unresolved_questions: [], evidence: [] }));
    }
    expect(must(resumeInvocations(ctx, basis)).next).toMatchObject({ kind: "blocked", invocation_id: inner });
    expect(refused(completeRound(ctx, basis, { invocation_id: outer, round: 1, outcome: "approve", unresolved_questions: [], evidence: [] }))).toBe("not-top-of-stack");
    const c = must(cancelInvocation(ctx, basis, { invocation_id: inner, reason: "operator stopped the fix loop" }));
    expect(c.state).toBe("cancelled");
    expect(must(loadInvocationState(ctx, basis)).stack).toEqual([outer]);
  });

  it("deeply nested loops with long step ids keep bounded invocation ids", () => {
    const id = (c: string) => c.repeat(32);
    let body: unknown = task("work");
    for (const c of ["d", "c", "b", "a"]) body = { kind: "repeat", id: id(c), max_rounds: 1, until: { kind: "outcome", equals: "ok" }, body };
    const reg = createComponentRegistry([component("deep", ["write"], body)]);
    if (!reg.ok) throw new Error("fixture");
    const r = compileWorkflow(reg.registry, { class: "research", workflow: { source_id: "proj-a", id: "deep" }, root: { id: "deep", version: "1" }, policy: { roles: { developer: ["code"] } } });
    if (!r.ok) throw new Error(JSON.stringify(r.violations));
    const basis = { projection: r.projection, manifest: r.manifest };
    must(initInvocationState(ctx, basis));
    let parent: { invocation_id: string; round: number } | undefined;
    for (const c of ["a", "b", "c", "d"]) {
      const inv = must(openInvocation(ctx, basis, { loop_id: id(c), subject_hash: SUBJECT, ...(parent ? { parent } : {}) }));
      expect(inv.id.length).toBeLessThanOrEqual(128);
      must(beginRound(ctx, basis, { invocation_id: inv.id, expected_round: 1 }));
      parent = { invocation_id: inv.id, round: 1 };
    }
    expect(must(loadInvocationState(ctx, basis)).stack.length).toBe(4);
  });

  it("an aliased list that would expand into millions of values is refused cheaply", () => {
    const basis = compile();
    const inv = runTwoRounds(basis);
    must(beginRound(ctx, basis, { invocation_id: inv, expected_round: 3 }));
    let x: unknown = "q";
    for (let k = 0; k < 12; k++) x = Array(8).fill(x);
    const t0 = Date.now();
    expect(refused(completeRound(ctx, basis, { invocation_id: inv, round: 3, outcome: "approve", unresolved_questions: x as string[], evidence: [] }))).toBe("invalid-input");
    expect(Date.now() - t0).toBeLessThan(1000);
  });

  it("unknown loops, malformed ids, bad hashes and oversize inputs are refused", () => {
    const basis = compile();
    must(initInvocationState(ctx, basis));
    expect(refused(openInvocation(ctx, basis, { loop_id: "nope", subject_hash: SUBJECT }))).toBe("unknown-loop");
    expect(refused(openInvocation(ctx, basis, { loop_id: "loop", subject_hash: "xyz" }))).toBe("invalid-input");
    const inv = must(openInvocation(ctx, basis, { loop_id: "loop", subject_hash: SUBJECT })).id;
    must(beginRound(ctx, basis, { invocation_id: inv, expected_round: 1 }));
    expect(refused(completeRound(ctx, basis, { invocation_id: inv, round: 1, outcome: "approve", unresolved_questions: ["../x"], evidence: [] }))).toBe("invalid-input");
    expect(refused(completeRound(ctx, basis, { invocation_id: inv, round: 1, outcome: "approve", unresolved_questions: [], evidence: [{ name: "e", sha256: "nothex" }] }))).toBe("invalid-input");
    expect(refused(completeRound(ctx, basis, { invocation_id: inv, round: 1, outcome: "approve", unresolved_questions: Array.from({ length: 500 }, (_, i) => `q${i}`), evidence: [] }))).toBe("invalid-input");
    const hostile = { invocation_id: inv, round: 1, outcome: "approve", unresolved_questions: [], evidence: [] } as Record<string, unknown>;
    Object.defineProperty(hostile, "outcome", { get: () => "approve", enumerable: true });
    expect(refused(completeRound(ctx, basis, hostile as never))).toBe("invalid-input");
    expect(refused(beginRound(ctx, basis, { invocation_id: "ghost", expected_round: 1 }))).toBe("unknown-invocation");
  });

  it("the overlaid projection satisfies the frozen C8 invocation rules", () => {
    const basis = compile();
    const inv = runTwoRounds(basis);
    const p: WorkflowProjectionV2 = overlayInvocations(basis.projection, must(loadInvocationState(ctx, basis)));
    expect(basis.projection.invocations).toEqual([]);
    const entry = (basis.manifest as CompileManifest).loops.find((l) => l.id === "loop")!.entry;
    expect(p.invocations).toEqual([{ id: inv, node_id: entry, round: 2, max_rounds: 3, unresolved_questions: ["q-auth"], state: "active", definition_hash: basis.projection.definition_hash, subject_hash: SUBJECT }]);
    for (const i of p.invocations) {
      expect(i.round).toBeLessThanOrEqual(i.max_rounds);
      expect(i.state !== "accepted" || i.unresolved_questions.length === 0).toBe(true);
      expect(i.definition_hash).toBe(p.definition_hash);
      expect(p.nodes.some((n) => n.id === i.node_id)).toBe(true);
    }
  });

  it("state bytes are deterministic for the same operations", () => {
    const basis = compile();
    runTwoRounds(basis);
    const a = read(snap());
    const other = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "w04b-")));
    ctx = { root: other, runDir: path.join(other, ".guild", "runs", "run-w04"), run_id: "run-w04" };
    runTwoRounds(compile());
    expect(read(path.join(ctx.runDir, INVOCATION_STATE_FILE))).toBe(a);
    expect(JSON.parse(a).schema_version).toBe(WORKFLOW_INVOCATION_STATE_SCHEMA);
  });
});
