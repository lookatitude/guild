/**
 * E00-T0-C-R2 · TA regressions for G-lane:E00-C r2 blockers, round-keyed C-r2-F1,
 * C-r2-F2 and C-r2-F3 (review/G-lane-E00-C/result-r2.json). Expected red until
 * E00-C corrects them.
 *
 * Mechanics only (CD16): a source run through the package facade
 * (startTaskCellController, packageRoot null) over the controller's REAL
 * FilesystemTaskCellRuntime, in owned OS-temp roots. Faults are deterministic
 * and test-side:
 *   - method boundary: the controller's runtime.collectHandoff / terminate are
 *     wrapped to throw AFTER the real call completed (event step done);
 *   - event step: a planted lifecycle marker makes the runtime's own
 *     appendTaskCellLifecycleEvent throw `duplicate event_id` (no line written),
 *     or the worker port's terminate() makes events.jsonl read-only after
 *     termination_started, so only the terminal event line fails;
 *   - final.json: the acceptance-evidence directory is made read-only after
 *     acceptance, so all three exclusive creates fail.
 * C-r2-F2 calls the private cleanup() and C-r2-F3 replaces the private
 * preflight() (CD17a P6 refuses source runs as mechanics_only): unit seams on a
 * source-only controller. Nothing here asserts a qualified release, uses a
 * production flag, or is review or package evidence.
 */
import { describe, it, expect, afterEach } from "bun:test";
import * as fs from "fs";
import * as path from "path";

import { recordAuthorityDecision, startTaskCellController, taskCellPaths, writeAckClaim } from "../../src/domains/dispatch";
import { mintRunBinding } from "../../src/domains/lifecycle";
import { composeStationTeam } from "../../src/domains/teams";
import { FIXED_NOW, FULL_RUNGS, FakeWorkerPort, ownedTempDir, receiptBytes, sha256, teardownOwned, walkFiles } from "./support/e00-harness";
import { writeApprovedTeam } from "./support/team-authority-fixture";

const RUN = "run-e00-cr2";
const LEAD = "lead-binding-cr2";

const restoreModes: Array<() => void> = [];
afterEach(async () => {
  while (restoreModes.length) restoreModes.pop()!();
  await teardownOwned();
});

/** chmod with a guaranteed restore before teardown; returns an early restore. */
function chmodFor(abs: string, mode: number): () => void {
  const before = fs.statSync(abs).mode & 0o777;
  fs.chmodSync(abs, mode);
  const restore = () => { try { fs.chmodSync(abs, before); } catch { /* removed */ } };
  restoreModes.push(restore);
  return restore;
}

/** Worker port: on delivery writes the ack claim, the receipt and the artifact oracle target. */
class LanePort extends FakeWorkerPort {
  onTerminate: (() => void) | null = null;
  constructor(private readonly root: string) {
    super();
    this.onNotify = ({ assignment_path }) => {
      const abs = path.resolve(this.root, assignment_path);
      const a = JSON.parse(fs.readFileSync(abs, "utf8"));
      expect(writeAckClaim({ assignmentPath: abs, now: () => FIXED_NOW }).ok).toBe(true);
      const receipt = path.join(this.root, ".guild", "runs", a.run_id, "handoffs", `${a.worker_role}-${a.logical_task_id}.md`);
      fs.mkdirSync(path.dirname(receipt), { recursive: true });
      fs.writeFileSync(receipt, receiptBytes(a.run_id, a));
      fs.mkdirSync(path.join(this.root, "src", "out"), { recursive: true });
      fs.writeFileSync(path.join(this.root, "src", "out", `${a.logical_task_id}.txt`), "done\n");
    };
  }
  terminate(input: { instance_id: string }): { ok: boolean; reason: string | null } {
    this.onTerminate?.();
    return super.terminate(input);
  }
}

interface Lane {
  root: string;
  controller: any;
  port: LanePort;
  out: Record<string, any>;
  ids: { run_id: string; logical_task_id: string; attempt: number; instance_id: string };
  paths: ReturnType<typeof taskCellPaths>;
}

interface LaneOpts {
  /** Wrap the controller's real runtime methods (method-boundary faults). */
  wrap?: (runtime: any, root: string, controller: any) => void;
  /** Record the team_lead decision while the controller polls (reaches acceptLane). */
  decideLead?: boolean;
  /** Replace the private CD17a preflight (source runs are mechanics_only at P6). */
  stubPreflight?: boolean;
  /** The lane's declared review family (CW-10 F6); defaults to the host's real family. */
  hostFamily?: string;
}

async function runLane(opts: LaneOpts = {}): Promise<Lane> {
  const root = ownedTempDir("guild-e00-cr2-");
  fs.mkdirSync(path.join(root, ".guild"), { recursive: true });
  fs.writeFileSync(path.join(root, ".guild", "guild.yaml"), "schema_version: guild.root.v1\nkind: project\n");
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  const bindingRef = mintRunBinding({ root, run_id: RUN }).binding_ref;
  const team = writeApprovedTeam(root, RUN, [{ id: "T1", role: "backend" }], { reviewerId: "cr2-review", planRel: ".guild/plan/e00-cr2.spec.json" });
  const dir = path.join(root, ".guild", "runs", RUN, "oracle-plan");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "build.json"), JSON.stringify({
    schema_version: "guild.task_oracle_plan.v1", approved_plan_ref: team.approvedPlanRef, team_decision_ref: team.teamDecisionRef,
    lead_binding_id: LEAD, acceptance_policy_version: "E00.1",
    lanes: [{ logical_task_id: "T1", authorities_required: ["deterministic_floor", "team_lead"], reviewer_participant_id: null,
      done_when: [{ id: "artifact", oracle: "artifact_exists", target: JSON.stringify({ path: "src/out/T1.txt", sha256: null }) }] }],
  }, null, 2) + "\n");
  const { approveOraclePlan } = await import("../../src/domains/dispatch");
  expect(approveOraclePlan({ cwd: root, runId: RUN, phase: "build", decidedBy: "cr2-operator", now: () => FIXED_NOW }).ok).toBe(true);

  const port = new LanePort(root);
  let seq = 0;
  let lane: Lane | null = null;
  const sleep = async () => {
    // Deterministic team_lead decision: only once a validation exists for the instance.
    if (!opts.decideLead || !lane) return;
    const inst = controller.instances?.[0]?.handle;
    if (!inst) return;
    const ids = { run_id: RUN, logical_task_id: "T1", attempt: inst.attempt, instance_id: inst.instance_id };
    if (!fs.existsSync(path.join(root, taskCellPaths(ids).validation_path))) return;
    if (fs.existsSync(path.join(root, ".guild", "runs", RUN, "controller", "decisions", inst.instance_id, "team_lead.json"))) return;
    recordAuthorityDecision({ cwd: root, runId: RUN, instanceId: inst.instance_id, leadBindingId: LEAD, decision: "accepted", reason: null, now: () => FIXED_NOW } as never);
  };
  const started = startTaskCellController({
    cwd: root, runId: RUN, phase: "build", workerTrustPolicy: "cooperative_local", now: () => FIXED_NOW,
    binding: { binding_ref: bindingRef }, worker: port, rungPlan: FULL_RUNGS, proposal: team.proposal as never,
    sleep, idFactory: (k: string) => `${k}-${++seq}`,
  } as never) as any;
  expect(started.ok).toBe(true);
  const controller = started.controller;
  ports.set(controller, port);
  lane = { root, controller, port } as Lane;
  try {
    if (opts.stubPreflight) controller.preflight = () => ({ ok: true });
    opts.wrap?.(controller.runtime, root, controller);
    controller.writeStationPlan(composeStationTeam("build", {}, { tierIndex: {} }));
    const contextRel = `.guild/context/${RUN}/backend-T1.md`;
    fs.mkdirSync(path.dirname(path.join(root, contextRel)), { recursive: true });
    fs.writeFileSync(path.join(root, contextRel), "# context T1\n");
    const out = await controller.runLane({
      logical_task_id: "T1", worker_role: "backend",
      specialist: { type_id: "backend", type_version: "1", type_hash: "sha256:type", profile_id: "backend", profile_hash: "sha256:profile" },
      host: { host_id: "claude-code-cli", adapter_id: "claude-code-cli@1", host_capabilities_hash: "sha256:caps", host_family: opts.hostFamily ?? "anthropic" },
      model: { tier: "mid", model_id: "fixture-model" }, context_bundle_id: contextRel, objective: "implement T1", non_goals: [],
      scope_paths: ["src"], acceptance_tests: ["fixture"], dependencies: [],
      projection: { tools: ["read", "write"], permissions: [], recorded_losses: [] },
      budgets: { tokens: null, wall_clock_ms: null, cost_usd: null }, autonomy_policy: "supervised", deadline: null,
      ready_timeout_ms: 0, ack_timeout_ms: 0, receipt_timeout_ms: 0, review_timeout_ms: opts.decideLead ? 60_000 : 0,
    });
    const handle = controller.instances[0]?.handle;
    if (!handle) return { root, controller, port, out } as Lane;
    const ids = { run_id: RUN, logical_task_id: "T1", attempt: handle.attempt, instance_id: handle.instance_id };
    return { root, controller, port, out, ids, paths: taskCellPaths(ids) };
  } finally {
    controller.close();
  }
}

const runDir = (l: { root: string }) => path.join(l.root, ".guild", "runs", RUN);
const events = (l: Lane, name: string) => {
  const f = path.join(runDir(l), "task-cell-telemetry", "events.jsonl");
  return fs.readFileSync(f, "utf8").split("\n").filter(Boolean).map((x) => JSON.parse(x)).filter((e) => e.instance_id === l.ids.instance_id && e.event_name === name).length;
};
const busCount = (l: Lane, rel: string) => fs.readFileSync(path.join(runDir(l), "bus", "log.jsonl"), "utf8").split("\n").filter(Boolean)
  .map((x) => JSON.parse(x)).filter((e) => e.event === "artifact.published" && e.path === rel).length;
const sidecarDir = (l: Lane) => path.join(runDir(l), "controller", "reconciliations", l.ids.instance_id);
const attemptOf = (l: Lane) => JSON.parse(fs.readFileSync(path.join(l.root, l.paths.attempt_path), "utf8"));
const markerCount = (root: string, iid: string) => {
  const dir = path.join(root, ".guild", "runs", RUN, "task-cell-telemetry", "event-ids");
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => n.startsWith(`${iid}.`)).length : 0;
};

/** Plant the marker of the instance's NEXT `nth` event so its append throws duplicate event_id. */
function plantNextMarker(root: string, iid: string, nth: number, name: string) {
  const dir = path.join(root, ".guild", "runs", RUN, "task-cell-telemetry", "event-ids");
  const seq = markerCount(root, iid) + nth;
  fs.writeFileSync(path.join(dir, `${iid}.${String(seq).padStart(6, "0")}.${name}`), "planted by test\n", { flag: "wx" });
}

// ── CW-10 F6: the declared review family is the registry host's model family ──

describe("CW-10 F6 · runLane refuses a lane whose host_family is not its host's model family", () => {
  it("a claude-code-cli lane labelled openai is refused before any spawn", async () => {
    const l = await runLane({ hostFamily: "openai" });
    expect(l.out).toMatchObject({ state: "refused", instance_id: null, failure_reason: "host_family_mismatch" });
    expect(l.controller.instances.length).toBe(0);
  });
});

// ── C-r2-F1: validation post-state after the event step ──────────────────────

describe("C-r2-F1 · collect fails after validation persisted, published and handoff_validated (TA mechanics)", () => {
  it("control: an unfaulted lane reaches handoff_validated awaiting team_lead", async () => {
    const l = await runLane();
    expect(l.out).toMatchObject({ state: "handoff_validated", awaiting: "team_lead", failure_reason: null });
    expect(events(l, "handoff_validated")).toBe(1);
  });

  it("collect throws AFTER a complete handoff_validated event: recognized, no reconciliation, no re-emission", async () => {
    const l = await runLane({ wrap: (rt) => {
      const orig = rt.collectHandoff.bind(rt);
      rt.collectHandoff = async (i: unknown) => { await orig(i); throw new Error("fault after event step"); };
    } });
    expect(fs.existsSync(path.join(l.root, l.paths.validation_path))).toBe(true);
    expect(busCount(l, l.paths.validation_path)).toBe(1);
    expect(events(l, "handoff_validated")).toBe(1);
    expect(l.out).toMatchObject({ state: "handoff_validated", awaiting: "team_lead", failure_reason: null });
    expect(fs.existsSync(sidecarDir(l)) ? fs.readdirSync(sidecarDir(l)) : []).toEqual([]);
  });

  it("the handoff_validated event line is missing: lifecycle_event_incomplete, release blocked, not failed, no re-emission", async () => {
    const l = await runLane({ wrap: (rt, root) => {
      const orig = rt.collectHandoff.bind(rt);
      // handoff_submitted is the next event, handoff_validated the one after.
      rt.collectHandoff = async (i: { instance_id: string }) => { plantNextMarker(root, i.instance_id, 2, "handoff_validated"); return orig(i); };
    } });
    expect(fs.existsSync(path.join(l.root, l.paths.validation_path))).toBe(true);
    expect(busCount(l, l.paths.validation_path)).toBe(1);
    expect(events(l, "handoff_validated")).toBe(0);
    expect(l.out.state).toBe("handoff_validated");
    expect(JSON.stringify(l.out)).toContain("lifecycle_event_incomplete");
    expect(attemptOf(l).terminal_state ?? null).toBeNull();
    expect(fs.existsSync(path.join(l.root, l.paths.acceptance_path))).toBe(false);
    expect(fs.existsSync(sidecarDir(l)) ? fs.readdirSync(sidecarDir(l)) : []).toEqual([]);
  });
});

// ── C-r2-F2: terminal post-state after the event step (private cleanup seam) ─

describe("C-r2-F2 · unforced terminate sealed and published before the event failure (TA mechanics)", () => {
  /** Lane at handoff_validated, then accepted mechanically through the real runtime. */
  async function accepted(wrap?: LaneOpts["wrap"]) {
    const l = await runLane();
    const handle = l.controller.instances[0].handle;
    const acc = await l.controller.runtime.acceptHandoff(handle, {
      acceptance_policy_version: "E00.1", authorities_required: ["deterministic_floor", "team_lead"],
      authorities_observed: [
        { authority: "deterministic_floor", decision: "accepted", at: FIXED_NOW, reason: null },
        { authority: "team_lead", decision: "accepted", at: FIXED_NOW, reason: null },
      ],
    });
    expect(acc.ok).toBe(true);
    let reconcileCalls = 0;
    const rt = l.controller.runtime;
    const origRec = rt.reconcilePersistedTerminal.bind(rt);
    rt.reconcilePersistedTerminal = async (...a: unknown[]) => { reconcileCalls++; return origRec(...a); };
    wrap?.(rt, l.root, l.controller);
    const evidence = path.join(runDir(l), "controller", "acceptance-evidence");
    const factsBefore = [l.paths.acceptance_path].map((p) => sha256(fs.readFileSync(path.join(l.root, p))))
      .concat(walkFiles(evidence).map((f) => sha256(fs.readFileSync(f))));
    await l.controller.cleanup(handle, l.ids, null);
    const factsAfter = [l.paths.acceptance_path].map((p) => sha256(fs.readFileSync(path.join(l.root, p))))
      .concat(walkFiles(evidence).map((f) => sha256(fs.readFileSync(f))));
    const cleanup = JSON.parse(fs.readFileSync(path.join(runDir(l), "controller", "cleanup", l.ids.instance_id, "cleanup.json"), "utf8"));
    return { l, cleanup, reconcileCalls: () => reconcileCalls, factsBefore, factsAfter };
  }

  it("control: unfaulted unforced cleanup is complete and published", async () => {
    const { l, cleanup, reconcileCalls } = await accepted();
    expect(cleanup).toMatchObject({ terminal_state: "terminated", terminal_published: true, cleanup_state: "complete", terminal_reconciliation: null });
    expect(events(l, "terminated")).toBe(1);
    expect(reconcileCalls()).toBe(0);
  });

  it("terminate throws AFTER a complete terminated event: recognized complete, no reconciliation or repeated transition", async () => {
    const { l, cleanup, reconcileCalls, factsBefore, factsAfter } = await accepted((rt) => {
      const orig = rt.terminate.bind(rt);
      rt.terminate = async (...a: unknown[]) => { await orig(...a); throw new Error("fault after event step"); };
    });
    expect(busCount(l, l.paths.terminal_path)).toBe(1);
    expect(events(l, "terminated")).toBe(1);
    expect(cleanup).toMatchObject({ terminal_state: "terminated", terminal_published: true, cleanup_state: "complete", terminal_reconciliation: null });
    expect(reconcileCalls()).toBe(0);
    expect(factsAfter).toEqual(factsBefore);
  });

  it("the terminated event line fails after seal and publication: lifecycle_event_incomplete with terminal_published true, no reconciliation", async () => {
    const { l, cleanup, reconcileCalls, factsBefore, factsAfter } = await accepted((_rt, root, controller) => {
      // termination_started is already appended when the port is asked to terminate; only the terminal line can fail.
      const eventsFile = path.join(root, ".guild", "runs", RUN, "task-cell-telemetry", "events.jsonl");
      lanePort(controller).onTerminate = () => chmodFor(eventsFile, 0o444);
    });
    expect(fs.existsSync(path.join(l.root, l.paths.terminal_path))).toBe(true);
    expect(busCount(l, l.paths.terminal_path)).toBe(1);
    expect(events(l, "terminated")).toBe(0);
    expect(attemptOf(l).terminal_state).toBe("terminated");
    expect(cleanup).toMatchObject({ terminal_state: "terminated", terminal_published: true, cleanup_state: "lifecycle_event_incomplete", terminal_telemetry_state: "lifecycle_event_incomplete", terminal_reconciliation: null });
    expect(reconcileCalls()).toBe(0);
    expect(factsAfter).toEqual(factsBefore);
  });
});

/** The LanePort a controller was started with (its wrapped worker delegates to it). */
const ports = new WeakMap<object, LanePort>();
function lanePort(controller: object): LanePort {
  const p = ports.get(controller);
  if (!p) throw new Error("fixture: no LanePort recorded for this controller");
  return p;
}

// ── C-r2-F3: all final.json writes fail ──────────────────────────────────────

describe("C-r2-F3 · every final.json create fails after acceptance (TA mechanics, preflight replaced)", () => {
  function lockEvidenceAfterAccept(rt: any, root: string) {
    const orig = rt.acceptHandoff.bind(rt);
    rt.acceptHandoff = async (i: { instance_id: string }, req: unknown) => {
      const r = await orig(i, req);
      chmodFor(path.join(root, ".guild", "runs", RUN, "controller", "acceptance-evidence", i.instance_id), 0o555);
      return r;
    };
  }
  const cleanupOf = (l: Lane) => JSON.parse(fs.readFileSync(path.join(runDir(l), "controller", "cleanup", l.ids.instance_id, "cleanup.json"), "utf8"));
  const finalAbs = (l: Lane) => path.join(runDir(l), "controller", "acceptance-evidence", l.ids.instance_id, "final.json");

  it("control: with preflight replaced, final.json is written and cleanup pins its persisted bytes (no qualification asserted)", async () => {
    const l = await runLane({ decideLead: true, stubPreflight: true });
    expect(fs.existsSync(finalAbs(l))).toBe(true);
    expect(cleanupOf(l).final_sha256).toBe(sha256(fs.readFileSync(finalAbs(l))));
  });

  it("all three final.json creates fail: no final file, cleanup.final_sha256 null, accepted fact kept, unforced terminated", async () => {
    const l = await runLane({ decideLead: true, stubPreflight: true, wrap: (rt, root) => lockEvidenceAfterAccept(rt, root) });
    expect(fs.existsSync(finalAbs(l))).toBe(false);
    expect(l.out.failure_reason).toBe("finalization_failed");
    expect(l.out.qualified_release).toBe(false);
    const acc = JSON.parse(fs.readFileSync(path.join(l.root, l.paths.acceptance_path), "utf8"));
    expect(acc.downstream_release_at).not.toBeNull();
    expect(attemptOf(l).terminal_state).toBe("terminated");
    expect(cleanupOf(l).final_sha256).toBeNull();
  });
});



// ── C-r2 recovery matrix: the ORIGINAL call fails before the state advance, then the
// RECONCILER advances state and fails after (root R2 matrix + R2-A1 acceptance counterpart).
// Original fault: the bus log is read-only during the original call, so the record is
// persisted but unpublished and the runtime stays in its pre-state. Reconciler faults:
// it completes then throws ("complete"), or its own lifecycle append throws ("missing").

const busLogOf = (root: string) => path.join(root, ".guild", "runs", RUN, "bus", "log.jsonl");

/** Bus events for `rel` must each be a real line; a sidecar, if written, must name one of them. */
function sidecarTruthful(l: Lane, kind: string, rel: string) {
  const f = path.join(sidecarDir(l), `${kind}.json`);
  if (!fs.existsSync(f)) return;
  const side = JSON.parse(fs.readFileSync(f, "utf8"));
  const bus = fs.readFileSync(busLogOf(l.root), "utf8").split("\n").filter(Boolean).map((x) => JSON.parse(x));
  expect(bus.some((e) => e.event === "artifact.published" && e.path === rel && e.seq === side.bus_seq && e.sha256 === side.sha256)).toBe(true);
}

type ReconcilerFault = "complete" | "missing";

/** Wrap runtime[method] so its first call runs with the bus log read-only (original fails before publication). */
function failOriginalPublication(rt: any, root: string, method: string) {
  const orig = rt[method].bind(rt);
  let first = true;
  rt[method] = async (...a: unknown[]) => {
    if (!first) return orig(...a);
    first = false;
    const restore = chmodFor(busLogOf(root), 0o444);
    try { return await orig(...a); } finally { restore(); }
  };
}

/** Wrap a reconciler: count calls, and fault it after its state advance. */
function faultReconciler(rt: any, root: string, method: string, fault: ReconcilerFault, eventName: string, calls: { n: number }) {
  const orig = rt[method].bind(rt);
  rt[method] = async (i: { instance_id: string }, ...rest: unknown[]) => {
    calls.n++;
    if (calls.n > 1) return orig(i, ...rest);
    if (fault === "missing") { plantNextMarker(root, i.instance_id, 1, eventName); return orig(i, ...rest); }
    await orig(i, ...rest);
    throw new Error("fault after reconciler event step");
  };
}

describe("C-r2 matrix · validation: original collect fails before handoff_validated, reconciler fails after it (TA mechanics)", () => {
  async function run(fault: ReconcilerFault) {
    const calls = { n: 0 };
    const l = await runLane({ wrap: (rt, root) => {
      failOriginalPublication(rt, root, "collectHandoff");
      faultReconciler(rt, root, "reconcilePersistedValidation", fault, "handoff_validated", calls);
    } });
    expect(fs.existsSync(path.join(l.root, l.paths.validation_path))).toBe(true);
    expect(busCount(l, l.paths.validation_path)).toBe(1);
    expect(calls.n).toBe(1);
    expect(l.out.state).not.toBe("failed");
    sidecarTruthful(l, "validation", l.paths.validation_path);
    return l;
  }

  it("reconciler throws after a complete handoff_validated event: recognized, one event, release still gated", async () => {
    const l = await run("complete");
    expect(events(l, "handoff_validated")).toBe(1);
    expect(l.out).toMatchObject({ state: "handoff_validated" });
  });

  it("reconciler's handoff_validated line is missing: lifecycle_event_incomplete, release blocked, no re-emission", async () => {
    const l = await run("missing");
    expect(events(l, "handoff_validated")).toBe(0);
    expect(l.out.state).toBe("handoff_validated");
    expect(JSON.stringify(l.out)).toContain("lifecycle_event_incomplete");
    expect(fs.existsSync(path.join(l.root, l.paths.acceptance_path))).toBe(false);
  });
});

describe("C-r2 matrix · R2-A1 acceptance: original acceptHandoff fails before handoff_accepted, reconciler fails after it (TA mechanics, preflight replaced)", () => {
  async function run(fault: ReconcilerFault) {
    const calls = { n: 0 };
    const l = await runLane({ decideLead: true, stubPreflight: true, wrap: (rt, root) => {
      failOriginalPublication(rt, root, "acceptHandoff");
      faultReconciler(rt, root, "reconcilePersistedAcceptance", fault, "handoff_accepted", calls);
    } });
    const acc = JSON.parse(fs.readFileSync(path.join(l.root, l.paths.acceptance_path), "utf8"));
    expect(acc.downstream_release_at).not.toBeNull();
    expect(busCount(l, l.paths.acceptance_path)).toBe(1);
    expect(calls.n).toBe(1);
    expect(l.out.failure_reason).not.toBe("acceptance_publication_failed");
    expect(l.out.state).not.toBe("handoff_validated");
    sidecarTruthful(l, "acceptance", l.paths.acceptance_path);
    return l;
  }

  it("reconciler throws after a complete handoff_accepted event: accepted fact recognized once; no silent complete without repair evidence", async () => {
    const l = await run("complete");
    expect(events(l, "handoff_accepted")).toBe(1);
    const final = path.join(runDir(l), "controller", "acceptance-evidence", l.ids.instance_id, "final.json");
    if (fs.existsSync(final)) {
      const manifest = JSON.parse(fs.readFileSync(final, "utf8")).reconciliation_manifest as Array<{ kind: string; path: string }>;
      expect(manifest.some((m) => m.kind === "acceptance" && fs.existsSync(path.join(l.root, m.path)))).toBe(true);
    }
  });

  it("reconciler's handoff_accepted line is missing: lifecycle_event_incomplete, accepted fact kept, release blocked (no final.json)", async () => {
    const l = await run("missing");
    expect(events(l, "handoff_accepted")).toBe(0);
    expect(JSON.stringify(l.out)).toContain("lifecycle_event_incomplete");
    expect(fs.existsSync(path.join(runDir(l), "controller", "acceptance-evidence", l.ids.instance_id, "final.json"))).toBe(false);
    expect(l.out.qualified_release).toBe(false);
  });
});

describe("C-r2 matrix · terminal: original unforced terminate fails before publication, reconciler fails after it (TA mechanics, private cleanup)", () => {
  async function run(fault: ReconcilerFault) {
    const l = await runLane();
    const handle = l.controller.instances[0].handle;
    expect((await l.controller.runtime.acceptHandoff(handle, {
      acceptance_policy_version: "E00.1", authorities_required: ["deterministic_floor", "team_lead"],
      authorities_observed: [
        { authority: "deterministic_floor", decision: "accepted", at: FIXED_NOW, reason: null },
        { authority: "team_lead", decision: "accepted", at: FIXED_NOW, reason: null },
      ],
    })).ok).toBe(true);
    const rt = l.controller.runtime;
    // Original: the seal's publication fails (bus read-only only while the port terminates and the seal runs).
    let restore: (() => void) | null = null;
    lanePort(l.controller).onTerminate = () => { restore = chmodFor(busLogOf(l.root), 0o444); };
    const origTerminate = rt.terminate.bind(rt);
    rt.terminate = async (...a: unknown[]) => { try { return await origTerminate(...a); } finally { restore?.(); } };
    const calls = { n: 0 };
    faultReconciler(rt, l.root, "reconcilePersistedTerminal", fault, "terminated", calls);
    const evidence = path.join(runDir(l), "controller", "acceptance-evidence");
    const facts = () => [sha256(fs.readFileSync(path.join(l.root, l.paths.acceptance_path)))].concat(walkFiles(evidence).map((f) => sha256(fs.readFileSync(f))));
    const before = facts();
    await l.controller.cleanup(handle, l.ids, null);
    const cleanup = JSON.parse(fs.readFileSync(path.join(runDir(l), "controller", "cleanup", l.ids.instance_id, "cleanup.json"), "utf8"));
    expect(busCount(l, l.paths.terminal_path)).toBe(1);
    expect(attemptOf(l).terminal_state).toBe("terminated");
    expect(calls.n).toBe(1);
    expect(facts()).toEqual(before);
    expect(cleanup).toMatchObject({ terminal_state: "terminated", terminal_published: true });
    expect(cleanup.cleanup_state).not.toBe("terminal_publication_incomplete");
    if (cleanup.terminal_reconciliation) {
      const rec = JSON.parse(fs.readFileSync(path.join(l.root, cleanup.terminal_reconciliation.path), "utf8"));
      const bus = fs.readFileSync(busLogOf(l.root), "utf8").split("\n").filter(Boolean).map((x) => JSON.parse(x));
      for (const p of rec.publications ?? []) expect(bus.some((e) => e.path === p.path && e.sha256 === p.sha256)).toBe(true);
    }
    return { l, cleanup };
  }

  it("reconciler throws after a complete terminated event: published once, no repeated transition, not reported unpublished", async () => {
    const { l } = await run("complete");
    expect(events(l, "terminated")).toBe(1);
  });

  it("reconciler's terminated line is missing: lifecycle_event_incomplete with terminal_published true", async () => {
    const { l, cleanup } = await run("missing");
    expect(events(l, "terminated")).toBe(0);
    expect(cleanup).toMatchObject({ cleanup_state: "lifecycle_event_incomplete", terminal_telemetry_state: "lifecycle_event_incomplete" });
  });
});
