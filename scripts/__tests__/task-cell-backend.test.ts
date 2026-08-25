/**
 * scripts/__tests__/task-cell-backend.test.ts
 *
 * G2 conformance suite for the `TaskCellBackend` seam (task-cell-runtime initiative,
 * ADR `task-cell-runtime-contract.md`).
 *
 * The ADR's load-bearing claim is that lifecycle semantics are IDENTICAL across
 * tmux / in-process / serial / remote and only the mechanics differ. So the adversarial
 * cases below are written ONCE and run against all four substrate doubles via
 * `describe.each` — a substrate that quietly diverges fails here, not in production.
 *
 * Covered (the contract-testable subset assigned to G2):
 *   AT1  one specialist → two ready tasks → two distinct instances, no assignment
 *        overwrite, no context reuse
 *   AT2  retry = same logical task, new task_run_id / attempt / attempt_id / instance_id,
 *        with previous_attempt_id + retry_reason lineage
 *   AT3  malformed/missing assignment → the worker never starts
 *   AT4  no assignment ack → timeout + terminate; `running` is unreachable without an ack
 *   AT5  malformed receipt → no dependency release, no false "dismissed" claim
 *   AT6  valid receipt but termination fails → terminal record carries an orphan, reaper retries
 *   AT8  dependency rejected → downstream stays blocked
 *   AT15 reconstruct cell state from the durable records without reviving terminal instances
 *
 * AT7/AT9–AT14 belong to later work items (G6/G8/G9) and are out of scope here.
 */

import {
  ACCEPTANCE_REQ,
  InMemoryTaskCellBackend,
  REJECTION_REQ,
  RemoteTaskCellDouble,
  SUBSTRATE_DOUBLES,
  SerialTaskCellDouble,
  fakeClock,
  makeAssignmentFor,
  makeSpawnCellRequest,
  makeSpawnInstanceRequest,
  makeValidReceipt,
} from "./fixtures/task-cell-doubles";
import {
  LEGAL_TRANSITIONS,
  TASK_CELL_STATES,
  TERMINAL_STATES,
  assertTransition,
  assignmentId,
  attemptLineage,
  dependencyGate,
  isHeartbeatStale,
  isTerminal,
  leadBinding,
  outOfScopeFiles,
  reconstructCellState,
  releasedLogicalTasks,
  taskCellPaths,
  validateTaskAssignmentV2,
  validateTaskAttemptV1,
  type CellHandle,
  type HandoffAcceptanceV1,
  type InstanceHandle,
  type TaskCellState,
} from "../lib/core/contracts/task-cell-backend";

// ── narrowing helpers ────────────────────────────────────────────────────────

function expectOk<T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> {
  if (!r.ok) throw new Error(`expected ok, got: ${JSON.stringify(r)}`);
  return r as Extract<T, { ok: true }>;
}

function expectFail<T extends { ok: boolean }>(r: T): Extract<T, { ok: false }> {
  if (r.ok) throw new Error(`expected failure, got ok: ${JSON.stringify(r)}`);
  return r as Extract<T, { ok: false }>;
}

// ═════════════════════════════════════════════════════════════════════════════
// Pure contract — the state machine, the paths, the frozen record shapes.
// These are substrate-independent by construction, so they run once.
// ═════════════════════════════════════════════════════════════════════════════

describe("D5 state machine", () => {
  it("declares all 15 states, 5 of them terminal", () => {
    expect(TASK_CELL_STATES).toHaveLength(15);
    expect([...TERMINAL_STATES].sort()).toEqual(
      ["cancelled", "failed", "rejected", "terminated", "timed_out"].sort()
    );
    for (const s of TERMINAL_STATES) expect(isTerminal(s)).toBe(true);
    expect(isTerminal("running")).toBe(false);
  });

  it("makes `running` reachable ONLY from assignment_acknowledged (the ack gate)", () => {
    const inbound = TASK_CELL_STATES.filter((s) => LEGAL_TRANSITIONS[s].includes("running"));
    expect(inbound).toEqual(["assignment_acknowledged"]);
    expect(() => assertTransition("assigned", "running")).toThrow(/illegal task-cell transition/);
    expect(() => assertTransition("ready", "running")).toThrow();
  });

  it("gives terminal states no outgoing edge — a terminal attempt can never be revived", () => {
    for (const s of TERMINAL_STATES) {
      expect(LEGAL_TRANSITIONS[s]).toEqual([]);
      for (const to of TASK_CELL_STATES) {
        expect(() => assertTransition(s, to)).toThrow(/terminal and immutable/);
      }
    }
  });

  it("walks the D5 happy path end to end", () => {
    const path: TaskCellState[] = [
      "declared",
      "instantiated",
      "ready",
      "assigned",
      "assignment_acknowledged",
      "running",
      "handoff_submitted",
      "handoff_validated",
      "handoff_accepted",
      "terminating",
      "terminated",
    ];
    for (let i = 0; i < path.length - 1; i++) {
      expect(() => assertTransition(path[i], path[i + 1])).not.toThrow();
    }
  });

  it("refuses to let an unvalidated receipt jump to accepted", () => {
    expect(() => assertTransition("handoff_submitted", "handoff_accepted")).toThrow();
    expect(() => assertTransition("handoff_submitted", "rejected")).not.toThrow();
  });

  it("has no post-acceptance `-> failed` edge — accepted work parks/reaps, never terminal-fails", () => {
    // The ONLY path out of acceptance is terminating -> terminated (D5).
    expect(LEGAL_TRANSITIONS.handoff_accepted).toEqual(["terminating"]);
    expect(LEGAL_TRANSITIONS.terminating).toEqual(["terminated"]);
    expect(() => assertTransition("handoff_accepted", "failed")).toThrow(/illegal task-cell transition/);
    expect(() => assertTransition("terminating", "failed")).toThrow(/illegal task-cell transition/);
  });
});

describe("D6 run-tree paths", () => {
  const ids = {
    run_id: "run-1",
    logical_task_id: "lt-api",
    attempt: 2,
    instance_id: "inst-9",
  };

  it("builds the canonical task-cell tree", () => {
    const p = taskCellPaths(ids);
    expect(p.instance_dir).toBe(
      ".guild/runs/run-1/task-cells/lt-api/attempts/2/instances/inst-9"
    );
    expect(p.assignment_path).toBe(`${p.instance_dir}/assignment.json`);
    expect(p.instance_path).toBe(`${p.instance_dir}/instance.json`);
    expect(p.receipt_path).toBe(`${p.instance_dir}/handoff-receipt.md`);
    // The attempt record is ABOVE the instances — one immutable file per attempt.
    expect(p.attempt_path).toBe(".guild/runs/run-1/task-cells/lt-api/attempts/2/attempt.json");
  });

  it("keeps every record inside the run_id tree", () => {
    const p = taskCellPaths(ids);
    for (const [key, value] of Object.entries(p)) {
      if (key === "run_dir") continue;
      expect(value.startsWith(`${p.run_dir}/`)).toBe(true);
    }
  });

  it("refuses ids that would escape the run tree", () => {
    expect(() => taskCellPaths({ ...ids, logical_task_id: "../../etc" })).toThrow(/unsafe/);
    expect(() => taskCellPaths({ ...ids, instance_id: ".." })).toThrow(/unsafe/);
    expect(() => taskCellPaths({ ...ids, run_id: "a/b" })).toThrow(/unsafe/);
    expect(() => taskCellPaths({ ...ids, attempt: 0 })).toThrow(/attempt must be an integer/);
  });
});

describe("D4 lineage + D3 lead-binding XOR", () => {
  it("requires previous_attempt_id + retry_reason on every non-first attempt", () => {
    expect(attemptLineage({ attempt: 1 })).toEqual({
      attempt: 1,
      previous_attempt_id: null,
      retry_reason: null,
    });
    expect(() => attemptLineage({ attempt: 2 })).toThrow(/requires previous_attempt_id/);
    expect(() => attemptLineage({ attempt: 2, previous_attempt_id: "att-1" })).toThrow(
      /retry_reason/
    );
    expect(
      attemptLineage({ attempt: 2, previous_attempt_id: "att-1", retry_reason: "tests failed" })
    ).toEqual({ attempt: 2, previous_attempt_id: "att-1", retry_reason: "tests failed" });
  });

  it("rejects lineage on a first attempt", () => {
    expect(() => attemptLineage({ attempt: 1, previous_attempt_id: "att-0" })).toThrow();
  });

  it("accepts exactly one of team_lead_instance_id / lead_binding_id", () => {
    expect(leadBinding({ lead_binding_id: "lb-1" })).toEqual({ lead_binding_id: "lb-1" });
    expect(leadBinding({ team_lead_instance_id: "inst-lead" })).toEqual({
      team_lead_instance_id: "inst-lead",
    });
    expect(() => leadBinding({})).toThrow(/got neither/);
    expect(() =>
      leadBinding({ lead_binding_id: "lb-1", team_lead_instance_id: "inst-lead" })
    ).toThrow(/got both/);
  });
});

describe("guild.task_attempt.v1 fail-closed validation (D4 lineage on the RECORD)", () => {
  const base = {
    schema_version: "guild.task_attempt.v1",
    run_id: "run-1",
    cell_id: "cell-1",
    logical_task_id: "lt-api",
    task_run_id: "tr-1",
    attempt: 1,
    attempt_id: "att-1",
    previous_attempt_id: null,
    retry_reason: null,
    instance_id: "inst-1",
    created_at: "2026-07-15T00:00:00Z",
    terminal_state: null,
    terminal_reason: null,
    terminated_at: null,
    immutable: false,
    orphaned: false,
    reap_attempts: 0,
  };

  it("accepts a well-formed first attempt and a well-formed retry", () => {
    expect(validateTaskAttemptV1(base)).not.toBeNull();
    expect(
      validateTaskAttemptV1({
        ...base,
        attempt: 2,
        attempt_id: "att-2",
        previous_attempt_id: "att-1",
        retry_reason: "flaky infra",
      })
    ).not.toBeNull();
  });

  it("rejects a non-first attempt with null lineage — enforced on the record, not just builders", () => {
    expect(
      validateTaskAttemptV1({ ...base, attempt: 2, previous_attempt_id: null, retry_reason: null })
    ).toBeNull();
    expect(
      validateTaskAttemptV1({ ...base, attempt: 2, previous_attempt_id: "att-1", retry_reason: null })
    ).toBeNull();
  });

  it("rejects a bad envelope, terminal metadata, or missing field", () => {
    expect(validateTaskAttemptV1({ ...base, schema_version: "guild.task_attempt.v2" })).toBeNull();
    expect(validateTaskAttemptV1({ ...base, terminal_state: "not-a-state" })).toBeNull();
    expect(validateTaskAttemptV1({ ...base, immutable: "yes" })).toBeNull();
    expect(validateTaskAttemptV1({ ...base, reap_attempts: -1 })).toBeNull();
    const { instance_id: _drop, ...missing } = base;
    void _drop;
    expect(validateTaskAttemptV1(missing)).toBeNull();
    expect(validateTaskAttemptV1(null)).toBeNull();
  });
});

describe("guild.task_assignment.v2 fail-closed validation", () => {
  const cell: CellHandle = {
    cell_id: "cell-1",
    run_id: "run-1",
    logical_task_id: "lt-api",
    goal_id: "goal-1",
    phase_id: "build",
    step_id: "step-1",
    team_id: "team-1",
    fanout: "lead_plus_one",
    lead: { lead_binding_id: "lb-1" },
    instance_ids: [],
  };
  const instance: InstanceHandle = {
    instance_id: "inst-1",
    cell_id: "cell-1",
    run_id: "run-1",
    logical_task_id: "lt-api",
    task_run_id: "tr-1",
    attempt: 1,
    attempt_id: "att-1",
    worker_role: "backend",
    substrate: "tmux",
    state: "ready",
  };

  it("accepts a well-formed self-contained assignment", () => {
    const a = validateTaskAssignmentV2(makeAssignmentFor(cell, instance));
    expect(a).not.toBeNull();
    expect(assignmentId(a!)).toBe("tr-1:1:inst-1");
  });

  it("rejects a wrong schema_version, a missing field, and a malformed sub-object", () => {
    const good = makeAssignmentFor(cell, instance) as unknown as Record<string, unknown>;
    expect(validateTaskAssignmentV2({ ...good, schema_version: "guild.task_assignment.v1" })).toBeNull();
    expect(validateTaskAssignmentV2({ ...good, objective: "" })).toBeNull();
    const { objective: _drop, ...missing } = good;
    void _drop;
    expect(validateTaskAssignmentV2(missing)).toBeNull();
    expect(validateTaskAssignmentV2({ ...good, budgets: { tokens: "lots" } })).toBeNull();
    expect(validateTaskAssignmentV2({ ...good, dependencies: [{ logical_task_id: 7 }] })).toBeNull();
    expect(validateTaskAssignmentV2(null)).toBeNull();
    expect(validateTaskAssignmentV2("not an object")).toBeNull();
  });

  it("rejects a non-first attempt with no retry lineage (D4)", () => {
    const good = makeAssignmentFor(cell, { ...instance, attempt: 1 }) as unknown as Record<
      string,
      unknown
    >;
    expect(
      validateTaskAssignmentV2({
        ...good,
        attempt: 2,
        previous_attempt_id: null,
        retry_reason: null,
      })
    ).toBeNull();
  });

  it("rejects an assignment whose channels escape the run tree", () => {
    const good = makeAssignmentFor(cell, instance) as unknown as Record<string, unknown>;
    expect(
      validateTaskAssignmentV2({ ...good, handoff_path: "/etc/passwd" })
    ).toBeNull();
    expect(
      validateTaskAssignmentV2({ ...good, assignment_path: ".guild/runs/other-run/x.json" })
    ).toBeNull();
  });

  it("rejects a SAME-run but non-canonical channel path (canonical enforcement, not mere containment)", () => {
    const good = makeAssignmentFor(cell, instance) as unknown as Record<string, unknown>;
    // Inside this run + this instance dir, but not the frozen per-channel filename.
    expect(
      validateTaskAssignmentV2({
        ...good,
        assignment_path:
          ".guild/runs/run-1/task-cells/lt-api/attempts/1/instances/inst-1/WRONG.json",
      })
    ).toBeNull();
    // Inside the run tree but hoisted out of the canonical instance dir.
    expect(
      validateTaskAssignmentV2({ ...good, heartbeat_path: ".guild/runs/run-1/heartbeat.json" })
    ).toBeNull();
  });

  it("rejects an assignment carrying BOTH lead ids, and one carrying neither", () => {
    const good = makeAssignmentFor(cell, instance) as unknown as Record<string, unknown>;
    expect(
      validateTaskAssignmentV2({ ...good, team_lead_instance_id: "inst-lead" })
    ).toBeNull();
    const { lead_binding_id: _drop, ...neither } = good;
    void _drop;
    expect(validateTaskAssignmentV2(neither)).toBeNull();
  });
});

describe("D5 dependency-release predicate", () => {
  const base: HandoffAcceptanceV1 = {
    schema_version: "guild.handoff_acceptance.v1",
    run_id: "run-1",
    cell_id: "cell-up",
    logical_task_id: "lt-up",
    task_run_id: "tr-up",
    attempt: 1,
    instance_id: "inst-up",
    assignment_id: "tr-up:1:inst-up",
    receipt_id: "r-1",
    validation_result_id: "v-1",
    acceptance_policy_version: "1.0.0",
    authorities_required: ["deterministic_floor", "team_lead"],
    authorities_observed: [],
    reviewer_cell_id: null,
    downstream_release_at: "2026-07-14T00:00:00.000Z",
    termination_authorized_at: "2026-07-14T00:00:00.000Z",
  };

  it("releases only on an acceptance record carrying downstream_release_at", () => {
    expect([...releasedLogicalTasks([base])]).toEqual(["lt-up"]);
    // A REJECTED handoff still writes a durable record — but it releases nothing.
    expect([...releasedLogicalTasks([{ ...base, downstream_release_at: null }])]).toEqual([]);
    // No acceptance record at all (receipt on disk, validation passed) releases nothing.
    expect([...releasedLogicalTasks([])]).toEqual([]);
  });

  it("blocks a lane whose upstream has no releasing acceptance", () => {
    const deps = [{ logical_task_id: "lt-up", accepted_artifact_ref: null }];
    expect(dependencyGate(deps, [])).toEqual({ ready: false, blocked_on: ["lt-up"] });
    expect(dependencyGate(deps, [{ ...base, downstream_release_at: null }])).toEqual({
      ready: false,
      blocked_on: ["lt-up"],
    });
    expect(dependencyGate(deps, [base])).toEqual({ ready: true, blocked_on: [] });
  });
});

describe("deterministic-floor helpers", () => {
  it("traces claimed changed-files to the assignment scope", () => {
    expect(outOfScopeFiles(["src/api"], ["src/api/routes.ts"])).toEqual([]);
    expect(outOfScopeFiles(["src/api"], ["src/api", "src/apiary/x.ts"])).toEqual([
      "src/apiary/x.ts",
    ]);
    expect(outOfScopeFiles([], ["anything.ts"])).toEqual([]);
  });

  it("treats a missing or stale heartbeat as stale", () => {
    expect(isHeartbeatStale(null, "2026-07-14T00:00:10.000Z", 5000)).toBe(true);
    expect(isHeartbeatStale("2026-07-14T00:00:00.000Z", "2026-07-14T00:00:10.000Z", 5000)).toBe(
      true
    );
    expect(isHeartbeatStale("2026-07-14T00:00:08.000Z", "2026-07-14T00:00:10.000Z", 5000)).toBe(
      false
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// The cross-substrate conformance suite. SAME assertions, all four doubles.
// ═════════════════════════════════════════════════════════════════════════════

describe.each(SUBSTRATE_DOUBLES)("TaskCellBackend conformance — $name", ({ name, make }) => {
  let be: InMemoryTaskCellBackend;

  beforeEach(() => {
    be = make(fakeClock());
  });

  /** Drive an instance to `running` through the full gauntlet: ready → assigned → ack. */
  async function driveToRunning(
    cell: CellHandle,
    handle: InstanceHandle,
    over: Record<string, unknown> = {}
  ): Promise<InstanceHandle> {
    const ready = expectOk(await be.awaitReady(handle));
    // A 2nd+ attempt's assignment must carry the same D4 lineage the instance was
    // spawned with — pull it off the durable attempt record so callers don't repeat it.
    const obs = (await be.observe(ready.instance))!;
    const lineage =
      obs.attempt.attempt > 1
        ? {
            previous_attempt_id: obs.attempt.previous_attempt_id,
            retry_reason: obs.attempt.retry_reason,
          }
        : {};
    const delivered = expectOk(
      await be.deliverAssignment(
        ready.instance,
        makeAssignmentFor(cell, ready.instance, { ...lineage, ...over })
      )
    );
    be.ackAssignment(handle.instance_id);
    const acked = expectOk(await be.awaitAssignmentAck(delivered.instance));
    expect(acked.instance.state).toBe("running");
    return acked.instance;
  }

  /** running → submitted → validated → accepted. Returns the acceptance record. */
  async function driveToAccepted(handle: InstanceHandle) {
    be.submitHandoff(handle.instance_id, makeValidReceipt());
    const collected = expectOk(await be.collectHandoff(handle));
    expect(collected.validation.result).toBe("passed");
    return expectOk(await be.acceptHandoff(collected.instance, ACCEPTANCE_REQ));
  }

  it("reports its substrate and parallelism (the serial floor is 1)", () => {
    expect(be.substrate).toBe(name);
    expect(be.isAvailable()).toBe(true);
    if (name === "serial") expect(be.parallelism).toBe(1);
    else expect(be.parallelism).toBeGreaterThan(1);
  });

  // ── AT1 ────────────────────────────────────────────────────────────────────

  describe("AT1 — one specialist owns two ready tasks", () => {
    it("mints two distinct instances with two assignments and two fresh contexts", async () => {
      // ONE specialist (same type + profile hash) owning TWO logical tasks. Reusing the
      // type/profile is fine and desirable; reusing the runtime instance is the bug (D3).
      const cellA = await be.spawnCell(
        makeSpawnCellRequest({ cell_id: "cell-a", logical_task_id: "lt-api" })
      );
      const cellB = await be.spawnCell(
        makeSpawnCellRequest({ cell_id: "cell-b", logical_task_id: "lt-db" })
      );
      // Each instance is minted with its OWN fresh context bundle (D3) — the runtime
      // never hands one specialist's two tasks the same context.
      const a = await be.spawnInstance(
        cellA,
        makeSpawnInstanceRequest({
          task_run_id: "tr-a",
          context_bundle_id: "ctx-a",
          context_bundle_hash: "sha256:ctx-a",
        })
      );
      const b = await be.spawnInstance(
        cellB,
        makeSpawnInstanceRequest({
          task_run_id: "tr-b",
          context_bundle_id: "ctx-b",
          context_bundle_hash: "sha256:ctx-b",
        })
      );

      expect(a.instance_id).not.toBe(b.instance_id);
      expect(a.attempt_id).not.toBe(b.attempt_id);

      const ra = expectOk(await be.awaitReady(a));
      const rb = expectOk(await be.awaitReady(b));
      const da = expectOk(
        await be.deliverAssignment(ra.instance, makeAssignmentFor(cellA, ra.instance))
      );
      const db = expectOk(
        await be.deliverAssignment(rb.instance, makeAssignmentFor(cellB, rb.instance))
      );

      // No assignment overwrite: two files, two distinct canonical paths.
      expect(da.assignment_path).not.toBe(db.assignment_path);
      const records = await be.records.readRecords("run-20260714-tc");
      expect(records.assignments).toHaveLength(2);
      expect(new Set(records.assignments.map((x) => x.assignment_path)).size).toBe(2);
      expect(new Set(records.assignments.map(assignmentId)).size).toBe(2);

      // No context reuse: each instance carries its own bundle id + hash.
      expect(da.assignment.context_bundle_id).not.toBe(db.assignment.context_bundle_id);
      expect(da.assignment.context_bundle_hash).not.toBe(db.assignment.context_bundle_hash);

      // The SPECIALIST is shared — that is the whole point of the type/profile layers.
      expect(records.instances.map((i) => i.specialist_profile_hash)).toEqual([
        "sha256:profile-backend",
        "sha256:profile-backend",
      ]);
      expect(new Set(records.instances.map((i) => i.instance_id)).size).toBe(2);
      expect(new Set(records.instances.map((i) => i.context_bundle_id)).size).toBe(2);
    });

    it("keys the assignment path on instance identity, never on specialist name", async () => {
      // The v1 overwrite class was "one file per specialist NAME": two tasks owned by
      // the same specialist collided on one file. Here two instances of the SAME
      // specialist type/profile land on two distinct canonical paths — collision is
      // structurally impossible because the path is a function of the unique instance_id.
      const cell = await be.spawnCell(makeSpawnCellRequest());
      const a = await be.spawnInstance(cell, makeSpawnInstanceRequest({ task_run_id: "tr-a" }));
      const b = await be.spawnInstance(cell, makeSpawnInstanceRequest({ task_run_id: "tr-b" }));
      expect(a.worker_role).toBe(b.worker_role); // same specialist
      const readyA = expectOk(await be.awaitReady(a));
      const readyB = expectOk(await be.awaitReady(b));
      const da = expectOk(
        await be.deliverAssignment(readyA.instance, makeAssignmentFor(cell, readyA.instance))
      );
      const db = expectOk(
        await be.deliverAssignment(readyB.instance, makeAssignmentFor(cell, readyB.instance))
      );
      expect(da.assignment_path).not.toBe(db.assignment_path);
      expect(da.assignment_path).toContain(a.instance_id);
      expect(db.assignment_path).toContain(b.instance_id);

      // Re-delivering to an already-assigned instance is refused — no second write, no clobber.
      const again = expectFail(
        await be.deliverAssignment(readyA.instance, makeAssignmentFor(cell, readyA.instance))
      );
      expect(again.failure).toBe("illegal_state");
      const records = await be.records.readRecords("run-20260714-tc");
      expect(records.assignments).toHaveLength(2);
    });
  });

  // ── AT2 ────────────────────────────────────────────────────────────────────

  describe("AT2 — a retry is a new attempt, never a revived task", () => {
    it("keeps the logical task and mints a new task_run/attempt/attempt_id/instance_id", async () => {
      const cell = await be.spawnCell(makeSpawnCellRequest({ logical_task_id: "lt-retry" }));
      const first = await be.spawnInstance(cell, makeSpawnInstanceRequest({ task_run_id: "tr-1" }));
      const running = await driveToRunning(cell, first);
      expectOk(await be.terminate(running, { force: true, reason: "tests failed" }));

      const attempt2 = await be.spawnInstance(
        cell,
        makeSpawnInstanceRequest({
          task_run_id: "tr-2",
          attempt: 2,
          previous_attempt_id: first.attempt_id,
          retry_reason: "tests failed on attempt 1",
          context_bundle_id: "ctx-2",
          context_bundle_hash: "sha256:ctx-2",
        })
      );

      expect(attempt2.logical_task_id).toBe(first.logical_task_id); // same logical task
      expect(attempt2.task_run_id).not.toBe(first.task_run_id);
      expect(attempt2.attempt).toBe(2);
      expect(attempt2.attempt_id).not.toBe(first.attempt_id);
      expect(attempt2.instance_id).not.toBe(first.instance_id);

      const records = await be.records.readRecords("run-20260714-tc");
      const a1 = records.attempts.find((a) => a.attempt === 1)!;
      const a2 = records.attempts.find((a) => a.attempt === 2)!;

      // Attempt 1's terminal record SURVIVES the retry, untouched and sealed.
      expect(a1.terminal_state).toBe("failed");
      expect(a1.immutable).toBe(true);
      expect(a1.retry_reason).toBeNull();
      // Attempt 2 carries the mandatory lineage back to it.
      expect(a2.previous_attempt_id).toBe(a1.attempt_id);
      expect(a2.retry_reason).toBe("tests failed on attempt 1");
      expect(a2.terminal_state).toBeNull();

      // Same type + profile hash across attempts; different instance + context (G7/AT2).
      const [i1, i2] = records.instances;
      expect(i1.specialist_type_hash).toBe(i2.specialist_type_hash);
      expect(i1.specialist_profile_hash).toBe(i2.specialist_profile_hash);
      expect(i1.instance_id).not.toBe(i2.instance_id);
      expect(i1.context_bundle_hash).not.toBe(i2.context_bundle_hash);
    });

    it("refuses to spawn a non-first attempt without retry lineage", async () => {
      const cell = await be.spawnCell(makeSpawnCellRequest());
      await expect(
        be.spawnInstance(cell, makeSpawnInstanceRequest({ attempt: 2 }))
      ).rejects.toThrow(/requires previous_attempt_id \+ retry_reason/);
    });

    it("refuses to re-terminate a sealed attempt (no resurrection)", async () => {
      const cell = await be.spawnCell(makeSpawnCellRequest());
      const i = await be.spawnInstance(cell, makeSpawnInstanceRequest());
      const running = await driveToRunning(cell, i);
      expectOk(await be.cancel(running, "operator abort"));
      // The instance is terminal. Cancelling again cannot rewrite the terminal decision.
      const again = expectFail(await be.cancel(running, "second thoughts"));
      expect(again.failure).toBe("illegal_state");
      const obs = (await be.observe(running))!;
      expect(obs.attempt.terminal_state).toBe("cancelled");
      expect(obs.attempt.terminal_reason).toBe("operator abort");
    });
  });

  // ── AT3 ────────────────────────────────────────────────────────────────────

  describe("AT3 — a malformed assignment is a hard dispatch failure", () => {
    it("never starts the worker and never persists the assignment", async () => {
      const cell = await be.spawnCell(makeSpawnCellRequest());
      const i = await be.spawnInstance(cell, makeSpawnInstanceRequest());
      const ready = expectOk(await be.awaitReady(i));

      const malformed = { ...(makeAssignmentFor(cell, ready.instance) as object), objective: "" };
      const res = expectFail(await be.deliverAssignment(ready.instance, malformed));
      expect(res.failure).toBe("malformed_assignment");

      // Hard failure — not log-and-continue. The instance is dead, not merely idle.
      expect(res.instance.state).toBe("failed");
      const obs = (await be.observe(ready.instance))!;
      expect(obs.attempt.terminal_state).toBe("failed");
      expect(obs.assignment).toBeNull();
      expect(be.isWorkerAlive(i.instance_id)).toBe(false);

      const records = await be.records.readRecords("run-20260714-tc");
      expect(records.assignments).toHaveLength(0);

      // And it can never reach `running` afterwards.
      const ack = expectFail(await be.awaitAssignmentAck(res.instance));
      expect(ack.failure).toBe("illegal_state");
    });

    it("treats a MISSING assignment the same way", async () => {
      const cell = await be.spawnCell(makeSpawnCellRequest());
      const i = await be.spawnInstance(cell, makeSpawnInstanceRequest());
      const ready = expectOk(await be.awaitReady(i));
      const res = expectFail(await be.deliverAssignment(ready.instance, null));
      expect(res.failure).toBe("malformed_assignment");
      expect(res.instance.state).toBe("failed");
    });

    it("rejects an assignment addressed to a DIFFERENT instance", async () => {
      const cell = await be.spawnCell(makeSpawnCellRequest());
      const a = await be.spawnInstance(cell, makeSpawnInstanceRequest());
      const b = await be.spawnInstance(cell, makeSpawnInstanceRequest({ task_run_id: "tr-b" }));
      const readyA = expectOk(await be.awaitReady(a));
      const readyB = expectOk(await be.awaitReady(b));

      const forB = makeAssignmentFor(cell, readyB.instance);
      const res = expectFail(await be.deliverAssignment(readyA.instance, forB));
      expect(res.failure).toBe("identity_mismatch");
      expect(res.instance.state).toBe("failed");
    });
  });

  // ── AT4 ────────────────────────────────────────────────────────────────────

  describe("AT4 — a worker that never acks is timed out and terminated", () => {
    it("never lets an unacknowledged assignment reach `running`", async () => {
      const cell = await be.spawnCell(makeSpawnCellRequest());
      const i = await be.spawnInstance(cell, makeSpawnInstanceRequest());
      const ready = expectOk(await be.awaitReady(i));
      const delivered = expectOk(
        await be.deliverAssignment(ready.instance, makeAssignmentFor(cell, ready.instance))
      );
      expect(delivered.instance.state).toBe("assigned");

      // No ackAssignment() call — the worker read nothing and said nothing.
      const res = expectFail(await be.awaitAssignmentAck(delivered.instance, { timeout_ms: 1000 }));
      expect(res.failure).toBe("timed_out");
      expect(res.instance.state).toBe("timed_out");

      // Timed out AND torn down — the pane/process is gone, not left dangling.
      expect(be.isWorkerAlive(i.instance_id)).toBe(false);
      const obs = (await be.observe(i))!;
      expect(obs.instance.started_at).toBeNull();
      expect(obs.attempt.terminal_state).toBe("timed_out");

      // The state machine itself forbids the shortcut.
      expect(() => assertTransition("assigned", "running")).toThrow();
    });

    it("times out a worker the substrate never brought up", async () => {
      const cell = await be.spawnCell(makeSpawnCellRequest());
      const i = await be.spawnInstance(cell, makeSpawnInstanceRequest());
      be.scriptNeverReady(i.instance_id);
      const res = expectFail(await be.awaitReady(i, { timeout_ms: 1000 }));
      expect(res.failure).toBe("timed_out");
      expect(res.instance.state).toBe("timed_out");
    });
  });

  // ── AT5 ────────────────────────────────────────────────────────────────────

  describe("AT5 — a malformed receipt releases nothing and claims nothing", () => {
    it("fails the deterministic floor, blocks acceptance, and refuses to call it dismissed", async () => {
      const cell = await be.spawnCell(makeSpawnCellRequest());
      const i = await be.spawnInstance(cell, makeSpawnInstanceRequest());
      const running = await driveToRunning(cell, i);

      be.submitHandoff(
        i.instance_id,
        makeValidReceipt({
          schema_valid: false,
          claimed_changed_files: ["src/api/routes.ts", "hooks/dist/bundle.js"],
          acceptance_tests_passed: [],
        })
      );
      const collected = expectFail(await be.collectHandoff(running));
      expect(collected.failure).toBe("validation_failed");

      // The floor's verdict is DURABLE — a rejection leaves a trace, not silence.
      const validation = collected.validation!;
      expect(validation.result).toBe("failed");
      expect(validation.schema_valid).toBe(false);
      expect(validation.out_of_scope_files).toEqual(["hooks/dist/bundle.js"]);
      expect(validation.failed_acceptance_tests).toEqual(["npm test -- api"]);

      // The receipt exists on disk. It is NOT validated, NOT accepted, and NOT a dismissal.
      expect(collected.instance.state).toBe("handoff_submitted");
      const accept = expectFail(await be.acceptHandoff(collected.instance, ACCEPTANCE_REQ));
      expect(accept.failure).toBe("validation_failed");

      const records = await be.records.readRecords("run-20260714-tc");
      expect(records.validations).toHaveLength(1);
      expect(records.acceptances).toHaveLength(0);
      expect([...releasedLogicalTasks(records.acceptances)]).toEqual([]);

      // No acceptance record ⇒ termination is NOT authorized. The worker is still alive;
      // nothing may claim it was dismissed.
      const term = expectFail(await be.terminate(collected.instance));
      expect(term.failure).toBe("not_authorized");
      expect(be.isWorkerAlive(i.instance_id)).toBe(true);

      // The sanctioned exit: an explicit, durable rejection.
      const rejected = expectOk(await be.rejectHandoff(collected.instance, REJECTION_REQ));
      expect(rejected.instance.state).toBe("rejected");
      expect(rejected.acceptance.downstream_release_at).toBeNull();
      expect(rejected.acceptance.termination_authorized_at).not.toBeNull();
      expect(be.isWorkerAlive(i.instance_id)).toBe(false);
      expect([...releasedLogicalTasks((await be.records.readRecords("run-20260714-tc")).acceptances)]).toEqual(
        []
      );
    });

    it("refuses acceptance when a required authority did not accept", async () => {
      const cell = await be.spawnCell(makeSpawnCellRequest());
      const i = await be.spawnInstance(cell, makeSpawnInstanceRequest());
      const running = await driveToRunning(cell, i);
      be.submitHandoff(i.instance_id, makeValidReceipt());
      const collected = expectOk(await be.collectHandoff(running));

      // The floor passed, but the risk score required a reviewer cell that never voted.
      const res = expectFail(
        await be.acceptHandoff(collected.instance, {
          ...ACCEPTANCE_REQ,
          authorities_required: ["deterministic_floor", "team_lead", "reviewer_cell"],
        })
      );
      expect(res.failure).toBe("not_authorized");
      expect(res.reason).toMatch(/reviewer_cell/);
      const records = await be.records.readRecords("run-20260714-tc");
      expect(records.acceptances).toHaveLength(0);
    });
  });

  // ── AT6 ────────────────────────────────────────────────────────────────────

  describe("AT6 — a valid receipt whose termination fails leaves an orphan for the reaper", () => {
    it("parks in `terminating`, records the orphan, and the reaper retries to `terminated`", async () => {
      const cell = await be.spawnCell(makeSpawnCellRequest());
      const i = await be.spawnInstance(cell, makeSpawnInstanceRequest());
      const running = await driveToRunning(cell, i);
      const accepted = await driveToAccepted(running);
      expect(accepted.instance.state).toBe("handoff_accepted");
      expect(accepted.acceptance.termination_authorized_at).not.toBeNull();

      // The kill fails once — the pane/process/session survives it.
      be.failTerminationTimes(i.instance_id, 1);
      const failed = expectFail(await be.terminate(accepted.instance));
      expect(failed.failure).toBe("termination_failed");
      expect(failed.instance.state).toBe("terminating");
      expect(be.isWorkerAlive(i.instance_id)).toBe(true);

      // The orphan is recorded on the durable attempt ledger, not just in memory.
      const mid = (await be.observe(i))!;
      expect(mid.attempt.orphaned).toBe(true);
      expect(mid.attempt.terminal_state).toBeNull(); // NOT terminal — the worker still lives
      expect(expectFail(await be.awaitTerminated(mid.handle)).failure).toBe("timed_out");

      // The reaper retries and finally lands the kill.
      const reap = await be.reapOrphan({ run_id: i.run_id, instance_id: i.instance_id });
      expect(reap.ok).toBe(true);
      expect(reap.reaped).toBe(true);
      expect(reap.reap_attempts).toBe(1);
      expect(reap.instance.state).toBe("terminated");
      expect(be.isWorkerAlive(i.instance_id)).toBe(false);

      // The terminal record REMEMBERS it was orphaned — that history is not erased.
      const done = expectOk(await be.awaitTerminated(reap.instance));
      expect(done.outcome.state).toBe("terminated");
      expect(done.outcome.orphaned).toBe(true);
      expect(done.outcome.reap_attempts).toBe(1);
    });

    it("keeps retrying across repeated teardown failures", async () => {
      const cell = await be.spawnCell(makeSpawnCellRequest());
      const i = await be.spawnInstance(cell, makeSpawnInstanceRequest());
      const running = await driveToRunning(cell, i);
      const accepted = await driveToAccepted(running);

      be.failTerminationTimes(i.instance_id, 3);
      expectFail(await be.terminate(accepted.instance));

      const first = await be.reapOrphan({ run_id: i.run_id, instance_id: i.instance_id });
      expect(first.reaped).toBe(false);
      const second = await be.reapOrphan({ run_id: i.run_id, instance_id: i.instance_id });
      expect(second.reaped).toBe(false);
      const third = await be.reapOrphan({ run_id: i.run_id, instance_id: i.instance_id });
      expect(third.reaped).toBe(true);
      expect(third.reap_attempts).toBe(3);
      expect(third.instance.state).toBe("terminated");
    });

    it("terminates cleanly and kills the worker when the receipt is accepted", async () => {
      const cell = await be.spawnCell(makeSpawnCellRequest());
      const i = await be.spawnInstance(cell, makeSpawnInstanceRequest());
      const running = await driveToRunning(cell, i);
      const accepted = await driveToAccepted(running);

      const term = expectOk(await be.terminate(accepted.instance));
      expect(term.outcome.state).toBe("terminated");
      expect(term.outcome.orphaned).toBe(false);
      expect(be.isWorkerAlive(i.instance_id)).toBe(false);
      expect(be.teardowns.filter((t) => t.instance_id === i.instance_id && t.ok)).toHaveLength(1);
    });
  });

  // ── AT8 ────────────────────────────────────────────────────────────────────

  describe("AT8 — a rejected dependency keeps its downstream blocked", () => {
    it("blocks the downstream lane until a durable releasing acceptance exists", async () => {
      const upstream = await be.spawnCell(
        makeSpawnCellRequest({ cell_id: "cell-up", logical_task_id: "lt-up" })
      );
      const downstream = await be.spawnCell(
        makeSpawnCellRequest({ cell_id: "cell-down", logical_task_id: "lt-down" })
      );

      // The upstream submits a receipt that fails the floor and is rejected.
      const up1 = await be.spawnInstance(
        upstream,
        makeSpawnInstanceRequest({ task_run_id: "tr-up-1" })
      );
      const upRunning = await driveToRunning(upstream, up1);
      be.submitHandoff(up1.instance_id, makeValidReceipt({ schema_valid: false }));
      const upCollected = expectFail(await be.collectHandoff(upRunning));
      const upRejected = expectOk(await be.rejectHandoff(upCollected.instance, REJECTION_REQ));
      expect(upRejected.acceptance.downstream_release_at).toBeNull();

      // The downstream lane cannot start. A receipt exists upstream; it releases nothing.
      const down = await be.spawnInstance(
        downstream,
        makeSpawnInstanceRequest({ task_run_id: "tr-down-1", worker_role: "frontend" })
      );
      const downReady = expectOk(await be.awaitReady(down));
      const blocked = expectFail(
        await be.deliverAssignment(
          downReady.instance,
          makeAssignmentFor(downstream, downReady.instance, {
            dependencies: [{ logical_task_id: "lt-up", accepted_artifact_ref: null }],
          })
        )
      );
      expect(blocked.failure).toBe("dependencies_blocked");
      expect(blocked.blocked_on).toEqual(["lt-up"]);

      // Blocked, NOT failed — the lane is still legitimate, it just may not run yet.
      expect(blocked.instance.state).toBe("ready");
      const records = await be.records.readRecords("run-20260714-tc");
      expect(records.assignments.filter((a) => a.logical_task_id === "lt-down")).toHaveLength(0);

      // The upstream retries (new attempt, D4) and this time it is ACCEPTED.
      const up2 = await be.spawnInstance(
        upstream,
        makeSpawnInstanceRequest({
          task_run_id: "tr-up-2",
          attempt: 2,
          previous_attempt_id: up1.attempt_id,
          retry_reason: "receipt failed the deterministic floor",
          context_bundle_id: "ctx-up-2",
          context_bundle_hash: "sha256:ctx-up-2",
        })
      );
      const up2Running = await driveToRunning(upstream, up2);
      const upAccepted = await driveToAccepted(up2Running);
      expect(upAccepted.acceptance.downstream_release_at).not.toBeNull();

      // ONLY now does the gate open — and it opened on the ACCEPTANCE record.
      const released = expectOk(
        await be.deliverAssignment(
          blocked.instance,
          makeAssignmentFor(downstream, blocked.instance, {
            dependencies: [
              { logical_task_id: "lt-up", accepted_artifact_ref: "artifacts/lt-up.json" },
            ],
          })
        )
      );
      expect(released.instance.state).toBe("assigned");
    });
  });

  // ── AT15 ───────────────────────────────────────────────────────────────────

  describe("AT15 — resume reconstructs cell state without reviving terminal instances", () => {
    it("rebuilds the attempt series from the durable records alone", async () => {
      const cell = await be.spawnCell(makeSpawnCellRequest({ logical_task_id: "lt-crash" }));

      // Attempt 1 died. Attempt 2 was mid-flight when the orchestrator crashed.
      const a1 = await be.spawnInstance(cell, makeSpawnInstanceRequest({ task_run_id: "tr-1" }));
      const r1 = await driveToRunning(cell, a1);
      expectOk(await be.terminate(r1, { force: true, reason: "worker crashed" }));

      const a2 = await be.spawnInstance(
        cell,
        makeSpawnInstanceRequest({
          task_run_id: "tr-2",
          attempt: 2,
          previous_attempt_id: a1.attempt_id,
          retry_reason: "worker crashed on attempt 1",
          context_bundle_id: "ctx-2",
          context_bundle_hash: "sha256:ctx-2",
        })
      );
      await driveToRunning(cell, a2);

      // 💥 The orchestrator dies. Every live handle is gone; only the run tree remains.
      be.simulateOrchestratorCrash();
      expect(await be.observe({ run_id: a1.run_id, instance_id: a1.instance_id })).toBeNull();

      const records = await be.records.readRecords("run-20260714-tc");
      const cells = reconstructCellState(records);
      expect(cells).toHaveLength(1);
      const rebuilt = cells[0];

      expect(rebuilt.logical_task_id).toBe("lt-crash");
      expect(rebuilt.attempts.map((a) => a.attempt)).toEqual([1, 2]);
      expect(rebuilt.lineage_ok).toBe(true);
      expect(rebuilt.latest_attempt).toBe(2);

      // The terminal attempt comes back DEAD. It is not resumable, at any price.
      const [first, second] = rebuilt.attempts;
      expect(first.terminal_state).toBe("failed");
      expect(first.resumable).toBe(false);
      expect(rebuilt.terminal_instances).toEqual([a1.instance_id]);

      // The in-flight attempt comes back as the only open instance.
      expect(second.terminal_state).toBeNull();
      expect(second.resumable).toBe(true);
      expect(second.previous_attempt_id).toBe(first.attempt_id);
      expect(second.retry_reason).toBe("worker crashed on attempt 1");
      expect(rebuilt.open_instances).toEqual([a2.instance_id]);

      // A resume MUST move forward: the only legal continuation is a NEW attempt.
      expect(rebuilt.next_attempt).toBe(3);
      for (const a of rebuilt.attempts) {
        expect(a.resumable).toBe(a.terminal_state === null);
      }

      // And the durable ledger refuses to let a terminal attempt be rewritten.
      expect(records.attempts.find((a) => a.attempt === 1)!.immutable).toBe(true);
    });

    it("flags a broken lineage chain rather than silently accepting it", async () => {
      const cell = await be.spawnCell(makeSpawnCellRequest({ logical_task_id: "lt-broken" }));
      const a1 = await be.spawnInstance(cell, makeSpawnInstanceRequest());
      const r1 = await driveToRunning(cell, a1);
      expectOk(await be.terminate(r1, { force: true, reason: "boom" }));
      await be.spawnInstance(
        cell,
        makeSpawnInstanceRequest({
          task_run_id: "tr-2",
          attempt: 2,
          previous_attempt_id: a1.attempt_id,
          retry_reason: "boom",
        })
      );

      const records = await be.records.readRecords("run-20260714-tc");
      expect(reconstructCellState(records)[0].lineage_ok).toBe(true);

      // Corrupt the chain the way a v1-style overwrite would have: lineage pointing nowhere.
      records.attempts.find((a) => a.attempt === 2)!.previous_attempt_id = "att-does-not-exist";
      expect(reconstructCellState(records)[0].lineage_ok).toBe(false);
    });
  });

  // ── the umbrella invariant ─────────────────────────────────────────────────

  it("gives every instance a unique handle and a terminal state", async () => {
    const cell = await be.spawnCell(makeSpawnCellRequest({ logical_task_id: "lt-fan" }));

    // Three workers, three different exits: accepted, rejected, timed out.
    const accepted = await be.spawnInstance(cell, makeSpawnInstanceRequest({ task_run_id: "tr-1" }));
    const rejected = await be.spawnInstance(cell, makeSpawnInstanceRequest({ task_run_id: "tr-2" }));
    const silent = await be.spawnInstance(cell, makeSpawnInstanceRequest({ task_run_id: "tr-3" }));

    const acceptedRunning = await driveToRunning(cell, accepted);
    const acc = await driveToAccepted(acceptedRunning);
    expectOk(await be.terminate(acc.instance));

    const rejectedRunning = await driveToRunning(cell, rejected);
    be.submitHandoff(rejected.instance_id, makeValidReceipt({ schema_valid: false }));
    const collected = expectFail(await be.collectHandoff(rejectedRunning));
    expectOk(await be.rejectHandoff(collected.instance, REJECTION_REQ));

    const silentReady = expectOk(await be.awaitReady(silent));
    const silentAssigned = expectOk(
      await be.deliverAssignment(
        silentReady.instance,
        makeAssignmentFor(cell, silentReady.instance)
      )
    );
    expectFail(await be.awaitAssignmentAck(silentAssigned.instance));

    const records = await be.records.readRecords("run-20260714-tc");
    const ids = records.instances.map((i) => i.instance_id);
    expect(new Set(ids).size).toBe(3); // unique handles, never reused (D3)
    expect(records.attempts.map((a) => a.terminal_state).sort()).toEqual([
      "rejected",
      "terminated",
      "timed_out",
    ]);
    for (const a of records.attempts) {
      expect(a.immutable).toBe(true);
      expect(isTerminal(a.terminal_state!)).toBe(true);
    }
    for (const id of ids) expect(be.isWorkerAlive(id)).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Substrate-specific mechanics — the ONLY places the doubles are allowed to differ.
// ═════════════════════════════════════════════════════════════════════════════

describe("substrate mechanics (not semantics)", () => {
  it("names the substrate on every instance record", async () => {
    for (const { name, make } of SUBSTRATE_DOUBLES) {
      const be = make(fakeClock());
      const cell = await be.spawnCell(makeSpawnCellRequest());
      const i = await be.spawnInstance(cell, makeSpawnInstanceRequest());
      const obs = (await be.observe(i))!;
      expect(obs.instance.substrate).toBe(name);
      expect(obs.handle.substrate).toBe(name);
    }
  });

  it("pins the serial floor to parallelism 1", () => {
    expect(new SerialTaskCellDouble().parallelism).toBe(1);
  });

  it("lets a remote host go offline", () => {
    const remote = new RemoteTaskCellDouble();
    expect(remote.isAvailable()).toBe(true);
    remote.goOffline();
    expect(remote.isAvailable()).toBe(false);
  });

  it("records a substrate-specific teardown mechanism", async () => {
    const be = new RemoteTaskCellDouble(fakeClock());
    const cell = await be.spawnCell(makeSpawnCellRequest());
    const i = await be.spawnInstance(cell, makeSpawnInstanceRequest());
    const ready = expectOk(await be.awaitReady(i));
    expectOk(await be.deliverAssignment(ready.instance, makeAssignmentFor(cell, ready.instance)));
    be.ackAssignment(i.instance_id);
    const running = expectOk(await be.awaitAssignmentAck(ready.instance));
    expectOk(await be.cancel(running.instance, "operator abort"));
    expect(be.teardowns).toEqual([
      { instance_id: i.instance_id, mechanism: "ssh kill remote session", ok: true },
    ]);
  });
});
