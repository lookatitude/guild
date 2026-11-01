/**
 * E00-T0 · EAT01-I gate / EAT02 / CD5–CD8 / CD12 / CD16–CD17 / CD24 — the
 * controller facade at TA (source-run, OS-temp roots, existing seams). All of
 * these are expected red: src/domains/dispatch/task-cell-controller.ts and the
 * reconciliation primitives do not exist yet.
 *
 * Fixture rules: claims, handles, heartbeats and oracle plans written here are
 * NEGATIVE / setup inputs in a temp root, never production state. A positive
 * accepted path needs an installed package (CD16: source runs are
 * mechanics_only) and lives in tc/e00-installed-package.tc.test.ts.
 *
 * Proposed test contract (for root / E00-C review; contract r12 names the
 * functions but not their argument objects):
 *   startTaskCellController({ cwd, runId, phase, workerTrustPolicy, now })
 *   readControllerStatus({ cwd, runId, consumerPolicy, consumerContext?, viewVersion?, now })
 *   recordControllerLoss({ cwd, runId, now, teardown? })
 *   approveOraclePlan({ cwd, runId, phase, decidedBy, now })
 *   recordAuthorityDecision({ cwd, runId, instanceId, leadBindingId, decision, reason, now })
 *   isQualifiedDownstreamRelease(cwd, runAcceptance, { policy, context })
 *   findQualifiedRunAcceptances(cwd, runId, { policy, context })
 *   classifyPersistedAcceptance(cwd, ids, intended)  // intended carries not_before (pre.json written_at)
 *   publishPersistedLifecycleRecord(cwd, ids, kind, binding, now)
 * Refusals follow expectRefusal(): { ok:false, reason } or a thrown .reason/.code.
 */
import { describe, it, expect, afterEach } from "bun:test";
import { execFileSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

import { buildAcceptance, findRunAcceptances, readBusLog, taskCellPaths } from "../../src/domains/dispatch";
import { closeRunBinding } from "../../src/domains/lifecycle";
import {
  FIXED_NOW, PLUGIN, acceptLane, driveLane, expectRefusal, makeRuntime, requireExport, requireMethod,
  sha256, teardownOwned, tempRoot, walkFiles, type TempRoot,
} from "./support/e00-harness";
import { writeApprovedTeam } from "./support/team-authority-fixture";

afterEach(teardownOwned);

const FACADE = "src/domains/dispatch/index.ts";
const CONTROLLER_SRC = "src/domains/dispatch/task-cell-controller.ts";

function runDir(root: TempRoot): string {
  return path.join(root.cwd, ".guild", "runs", root.runId);
}

function controllerDir(root: TempRoot): string {
  return path.join(runDir(root), "controller");
}

function treeDigest(dir: string): string {
  return sha256(walkFiles(dir).map((f) => `${path.relative(dir, f)}:${sha256(fs.readFileSync(f))}`).join("\n"));
}

function selfIdentity() {
  return {
    pid: process.pid,
    process_start: execFileSync("ps", ["-o", "lstart=", "-p", String(process.pid)], { encoding: "utf8" }).trim(),
    boot_session: execFileSync("sysctl", ["-n", "kern.bootsessionuuid"], { encoding: "utf8" }).trim(),
  };
}

/**
 * Negative / setup fixture: an approved oracle plan in a temp root (CD8). C-R1:
 * its refs are real hash-bound approved-plan JSON and team decision bytes
 * (support/team-authority-fixture.ts), never placeholders.
 */
function writeOraclePlan(root: TempRoot, opts: { approve: boolean; tamper?: boolean; lanes?: string[] } = { approve: true }) {
  const dir = path.join(runDir(root), "oracle-plan");
  fs.mkdirSync(dir, { recursive: true });
  const team = writeApprovedTeam(root.cwd, root.runId, (opts.lanes ?? ["T1"]).map((id) => ({ id, role: "backend" })), { reviewerId: "e00-review", planRel: ".guild/plan/e00.json" });
  const plan = {
    schema_version: "guild.task_oracle_plan.v1",
    approved_plan_ref: team.approvedPlanRef,
    team_decision_ref: team.teamDecisionRef,
    lead_binding_id: "lead-binding-e00",
    acceptance_policy_version: "E00.1",
    lanes: (opts.lanes ?? ["T1"]).map((id) => ({ logical_task_id: id, authorities_required: ["deterministic_floor", "team_lead"], reviewer_participant_id: null, done_when: [] })),
  };
  const bytes = Buffer.from(JSON.stringify(plan, null, 2) + "\n");
  fs.writeFileSync(path.join(dir, "build.json"), bytes);
  if (opts.approve) {
    fs.writeFileSync(path.join(dir, "build.decision.json"), JSON.stringify({
      schema_version: "guild.oracle_plan_decision.v1",
      oracle_plan_sha256: opts.tamper ? "0".repeat(64) : sha256(bytes),
      decision: "approved", decided_by: "operator", operator_uid: process.getuid?.() ?? 0, at: FIXED_NOW,
    }, null, 2) + "\n");
  }
}

/** Negative fixture: a pre-existing claim (CD5) for liveness / refusal classification. */
function plantClaim(root: TempRoot, ident: { pid: number; process_start: string; boot_session: string }, heartbeatAt: string) {
  fs.mkdirSync(controllerDir(root), { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(controllerDir(root), "controller.json"), JSON.stringify({
    schema_version: "guild.task_cell_controller.v1", run_id: root.runId,
    oracle_plan: { path: "oracle-plan/build.json", sha256: "a".repeat(64) },
    oracle_plan_decision: { path: "oracle-plan/build.decision.json", sha256: "b".repeat(64) },
    lead_binding_id: "lead-binding-e00", root_id: "fixture", source_id: "source:fixture", root_fingerprint: "c".repeat(64),
    source_revision: null, controller_instance_id: "ctl-fixture", ...ident, operator_uid: process.getuid?.() ?? 0,
    package_identity: null, package_release_version: null, package_current_package: null, package_root: null,
    worker_trust_policy: "cooperative_local", provider: "cooperative_local", host_profile_id: null, started_at: FIXED_NOW,
  }, null, 2) + "\n", { flag: "wx" });
  fs.writeFileSync(path.join(controllerDir(root), "heartbeat.json"), JSON.stringify({ state: "supervising", heartbeat_at: heartbeatAt }) + "\n");
}

async function start(root: TempRoot, policy = "cooperative_local") {
  const fn = await requireExport<(o: unknown) => unknown>(FACADE, "startTaskCellController");
  return () => fn({ cwd: root.cwd, runId: root.runId, phase: "build", workerTrustPolicy: policy, now: () => FIXED_NOW });
}

async function status(root: TempRoot, extra: Record<string, unknown> = {}) {
  const fn = await requireExport<(o: unknown) => Record<string, any>>(FACADE, "readControllerStatus");
  return fn({ cwd: root.cwd, runId: root.runId, consumerPolicy: "cooperative_local", now: () => FIXED_NOW, ...extra });
}

describe("EAT01-I gate (CD20)", () => {
  it("isolated_worker refuses worker_principal_unavailable and writes no TaskCell record", async () => {
    const root = tempRoot("guild-e00-ctl-");
    writeOraclePlan(root);
    const before = treeDigest(runDir(root));
    await expectRefusal(await start(root, "isolated_worker"), "worker_principal_unavailable");
    expect(treeDigest(runDir(root))).toBe(before);
    expect(fs.existsSync(path.join(runDir(root), "task-cells"))).toBe(false);
  });
});

describe("CD5 / CD8 start refusals", () => {
  for (const [label, setup] of [
    ["missing oracle plan", (_r: TempRoot) => undefined],
    ["unapproved oracle plan", (r: TempRoot) => writeOraclePlan(r, { approve: false })],
    ["hash-mismatched decision", (r: TempRoot) => writeOraclePlan(r, { approve: true, tamper: true })],
  ] as const) {
    it(`${label}: oracle_plan_unapproved and no claim written`, async () => {
      const root = tempRoot("guild-e00-ctl-");
      setup(root);
      await expectRefusal(await start(root), "oracle_plan_unapproved");
      expect(fs.existsSync(path.join(controllerDir(root), "controller.json"))).toBe(false);
    });
  }

  it("a live owner's claim refuses a second start with controller_already_claimed", async () => {
    const root = tempRoot("guild-e00-ctl-");
    writeOraclePlan(root);
    plantClaim(root, selfIdentity(), new Date().toISOString());
    const claimBefore = sha256(fs.readFileSync(path.join(controllerDir(root), "controller.json")));
    await expectRefusal(await start(root), "controller_already_claimed");
    expect(sha256(fs.readFileSync(path.join(controllerDir(root), "controller.json")))).toBe(claimBefore);
  });

  it("a dead owner without a loss record refuses with controller_loss_unrecorded", async () => {
    const root = tempRoot("guild-e00-ctl-");
    writeOraclePlan(root);
    plantClaim(root, { ...selfIdentity(), pid: 2 ** 22 - 3 }, FIXED_NOW);
    await expectRefusal(await start(root), "controller_loss_unrecorded");
  });

  it("PID reuse (same pid, different process_start) is classified dead, never live", async () => {
    const root = tempRoot("guild-e00-ctl-");
    writeOraclePlan(root);
    plantClaim(root, { ...selfIdentity(), process_start: "Thu Jan  1 00:00:00 1970" }, new Date().toISOString());
    await expectRefusal(await start(root), "controller_loss_unrecorded");
    expect((await status(root)).liveness).toBe("dead");
  });
});

describe("CD7 read-only status", () => {
  it("absent controller: one schema, null controller fields, unknown principal, zero writes", async () => {
    const root = tempRoot("guild-e00-status-");
    const before = treeDigest(root.cwd);
    const s = await status(root);
    expect(treeDigest(root.cwd)).toBe(before);
    expect(s).toMatchObject({
      view_version: "guild.task_cell_controller_status.v1",
      liveness: "absent",
      controller_state: null,
      loss_recorded: false,
      principal: { mode: "unknown" },
      identity: { run_id: root.runId, controller_instance_id: null },
    });
    expect(["unknown", "unavailable"]).toContain(s.qualification.state);
    expect(typeof s.qualification.reason).toBe("string");
    expect(JSON.stringify(s).includes(root.bindingRef)).toBe(false);
    expect(JSON.stringify(s).includes("binding.json")).toBe(false);
  });

  it("unresponsive: identity matches but heartbeat older than 30s", async () => {
    const root = tempRoot("guild-e00-status-");
    plantClaim(root, selfIdentity(), "2026-01-01T00:00:00.000Z");
    const s = await status(root);
    expect(s.liveness).toBe("unresponsive");
    expect(s.evidence_quality).toBe("pid_start_verified");
    expect(s.principal.worker_trust_policy).toBe("cooperative_local");
  });

  it("unsupported view_version refuses", async () => {
    const root = tempRoot("guild-e00-status-");
    await expectRefusal(async () => status(root, { viewVersion: "guild.task_cell_controller_status.v0" }), "view_version_unsupported");
  });
});

describe("CD6 record-loss over attempts without live owner", () => {
  async function deadRunWithAttempt() {
    const root = tempRoot("guild-e00-loss-");
    const rt = makeRuntime(root);
    const d = await driveLane(root, rt, { logicalTaskId: "T1", role: "backend", stopAfterDeliver: true });
    plantClaim(root, { ...selfIdentity(), pid: 2 ** 22 - 3 }, FIXED_NOW);
    return { root, d, paths: taskCellPaths({ run_id: root.runId, logical_task_id: "T1", attempt: 1, instance_id: d.instance.instance_id }) };
  }

  it("a valid attempt with no handle is orphaned, never sealed (unconfirmed_no_handle)", async () => {
    const recordLoss = await requireExport<(o: unknown) => Record<string, any>>(FACADE, "recordControllerLoss");
    const { root, paths } = await deadRunWithAttempt();
    const out = await recordLoss({ cwd: root.cwd, runId: root.runId, now: () => FIXED_NOW });
    const attempt = JSON.parse(fs.readFileSync(path.join(root.cwd, paths.attempt_path), "utf8"));
    expect(attempt.terminal_state ?? null).toBeNull();
    expect(attempt.orphaned).toBe(true);
    expect(JSON.stringify(out)).toContain("unconfirmed_no_handle");
    expect(fs.readdirSync(path.join(controllerDir(root), "loss")).length).toBe(1);
  });

  it("a spawn_pending handle is orphaned as unconfirmed", async () => {
    const recordLoss = await requireExport<(o: unknown) => Record<string, any>>(FACADE, "recordControllerLoss");
    const { root, d } = await deadRunWithAttempt();
    fs.mkdirSync(path.join(controllerDir(root), "handles"), { recursive: true });
    fs.writeFileSync(path.join(controllerDir(root), "handles", `${d.instance.instance_id}.json`), JSON.stringify({ state: "spawn_pending", instance_id: d.instance.instance_id }) + "\n");
    expect(JSON.stringify(await recordLoss({ cwd: root.cwd, runId: root.runId, now: () => FIXED_NOW }))).toContain('"unconfirmed"');
  });

  it("a closed binding refuses every loss mutation (loss_binding_refused) and writes nothing", async () => {
    const recordLoss = await requireExport<(o: unknown) => Record<string, any>>(FACADE, "recordControllerLoss");
    const { root } = await deadRunWithAttempt();
    closeRunBinding({ root: root.cwd, run_id: root.runId });
    const before = treeDigest(runDir(root));
    await expectRefusal(async () => recordLoss({ cwd: root.cwd, runId: root.runId, now: () => FIXED_NOW }), "loss_binding_refused");
    expect(treeDigest(runDir(root))).toBe(before);
  });

  it("refuses to run while the owner is live", async () => {
    const recordLoss = await requireExport<(o: unknown) => Record<string, any>>(FACADE, "recordControllerLoss");
    const root = tempRoot("guild-e00-loss-");
    plantClaim(root, selfIdentity(), new Date().toISOString());
    const before = treeDigest(runDir(root));
    const out = await (async () => { try { return await recordLoss({ cwd: root.cwd, runId: root.runId, now: () => FIXED_NOW }); } catch (e) { return { ok: false, error: e }; } })();
    expect((out as { ok?: unknown }).ok).toBe(false);
    expect(treeDigest(runDir(root))).toBe(before);
  });
});

describe("CD8 / CD12 operator CLIs as facade functions", () => {
  it("approveOraclePlan binds the decision to the exact plan bytes", async () => {
    const approve = await requireExport<(o: unknown) => unknown>(FACADE, "approveOraclePlan");
    const root = tempRoot("guild-e00-approve-");
    writeOraclePlan(root, { approve: false });
    await approve({ cwd: root.cwd, runId: root.runId, phase: "build", decidedBy: "operator", now: () => FIXED_NOW });
    const plan = fs.readFileSync(path.join(runDir(root), "oracle-plan", "build.json"));
    const decision = JSON.parse(fs.readFileSync(path.join(runDir(root), "oracle-plan", "build.decision.json"), "utf8"));
    expect(decision).toMatchObject({ schema_version: "guild.oracle_plan_decision.v1", oracle_plan_sha256: sha256(plan), decision: "approved" });
  });

  it("recordAuthorityDecision refuses a lead_binding_id other than the assignment's and the claim's", async () => {
    const decide = await requireExport<(o: unknown) => unknown>(FACADE, "recordAuthorityDecision");
    const root = tempRoot("guild-e00-decide-");
    const rt = makeRuntime(root);
    const d = await driveLane(root, rt, { logicalTaskId: "T1", role: "backend" });
    plantClaim(root, selfIdentity(), new Date().toISOString());
    const out = await (async () => { try { return await decide({ cwd: root.cwd, runId: root.runId, instanceId: d.instance.instance_id, leadBindingId: "lead-binding-other", decision: "accepted", reason: null, now: () => FIXED_NOW }); } catch (e) { return { ok: false, error: e }; } })();
    expect((out as { ok?: unknown }).ok).toBe(false);
    expect(fs.existsSync(path.join(controllerDir(root), "decisions", d.instance.instance_id, "team_lead.json"))).toBe(false);
  });

  it("recordAuthorityDecision derives decided_by from the lead binding (no free text)", async () => {
    const decide = await requireExport<(o: unknown) => unknown>(FACADE, "recordAuthorityDecision");
    const root = tempRoot("guild-e00-decide-");
    const rt = makeRuntime(root);
    const d = await driveLane(root, rt, { logicalTaskId: "T1", role: "backend" });
    plantClaim(root, selfIdentity(), new Date().toISOString());
    await decide({ cwd: root.cwd, runId: root.runId, instanceId: d.instance.instance_id, leadBindingId: "lead-binding-e00", decision: "accepted", reason: null, decidedBy: "someone else", now: () => FIXED_NOW });
    const rec = JSON.parse(fs.readFileSync(path.join(controllerDir(root), "decisions", d.instance.instance_id, "team_lead.json"), "utf8"));
    expect(rec).toMatchObject({ schema_version: "guild.task_cell_decision.v1", authority: "team_lead", lead_binding_id: "lead-binding-e00", decided_by: "lead_binding:lead-binding-e00" });
  });
});

describe("fixture_non_authority / CD16–CD17 (CR2-F2)", () => {
  async function directAccepted() {
    const root = tempRoot("guild-e00-nonauth-");
    const rt = makeRuntime(root);
    const d = await driveLane(root, rt, { logicalTaskId: "T1", role: "backend" });
    expect((await acceptLane(rt, d.instance)).ok).toBe(true);
    return { root, d };
  }

  it("a direct FilesystemTaskCellRuntime acceptance never qualifies (finalization_incomplete)", async () => {
    const qualified = await requireExport<(...a: unknown[]) => unknown>(FACADE, "isQualifiedDownstreamRelease");
    const { root } = await directAccepted();
    const [acc] = findRunAcceptances(root.cwd, root.runId);
    expect(acc).toBeDefined();
    const out = await qualified(root.cwd, acc, { policy: "cooperative_local", context: { mode: "same_run" } });
    expect(out === true || (typeof out === "object" && (out as { qualified_release?: unknown }).qualified_release === true)).toBe(false);
    expect(JSON.stringify(out)).toContain("finalization_incomplete");
  });

  it("findQualifiedRunAcceptances is empty while the legacy reader sees the mechanical acceptance", async () => {
    const findQualified = await requireExport<(...a: unknown[]) => unknown[]>(FACADE, "findQualifiedRunAcceptances");
    const { root } = await directAccepted();
    expect(findRunAcceptances(root.cwd, root.runId).length).toBe(1);
    expect((await findQualified(root.cwd, root.runId, { policy: "cooperative_local", context: { mode: "same_run" } })).length).toBe(0);
  });

  it("status reports mechanics_only and never labels the record accepted work", async () => {
    const { root } = await directAccepted();
    const s = await status(root);
    expect(s.qualification.state).toBe("mechanics_only");
    for (const inst of s.instances as Array<Record<string, unknown>>) expect(inst.qualified_release).toBe(false);
  });

  it("E00 controller source imports no legacy release primitive", () => {
    const src = path.join(PLUGIN, CONTROLLER_SRC);
    if (!fs.existsSync(src)) throw new Error(`ABSENT_CAPABILITY ${CONTROLLER_SRC}`);
    const text = fs.readFileSync(src, "utf8");
    for (const banned of ["isDownstreamReleased", "gateDependencies", "releasedLogicalTasks", "dependencyGate"]) {
      expect(new RegExp(`\\b${banned}\\b`).test(text)).toBe(false);
    }
  });

  it("calls raw findRunAcceptances only inside the findQualifiedRunAcceptances wrapper (CD17 exception)", () => {
    const src = path.join(PLUGIN, CONTROLLER_SRC);
    if (!fs.existsSync(src)) throw new Error(`ABSENT_CAPABILITY ${CONTROLLER_SRC}`);
    const text = fs.readFileSync(src, "utf8");
    const decl = /function\s+findQualifiedRunAcceptances\b[^{]*\{/.exec(text);
    expect(decl).not.toBeNull();
    let depth = 1;
    let i = decl!.index + decl![0].length;
    for (; i < text.length && depth > 0; i++) {
      if (text[i] === "{") depth++;
      else if (text[i] === "}") depth--;
    }
    // Release, admission and oracle consumers elsewhere in the module must go through the qualified facade.
    const outside = text.slice(0, decl!.index) + text.slice(i);
    expect(/\bfindRunAcceptances\s*\(/.test(outside)).toBe(false);
  });
});

describe("CD24 persisted-record reconciliation primitives", () => {
  async function validatedWithPersistedAcceptance() {
    let clock = FIXED_NOW;
    const root = tempRoot("guild-e00-recon-");
    const rt = makeRuntime(root, undefined, () => clock);
    const d = await driveLane(root, rt, { logicalTaskId: "T1", role: "backend" });
    const ids = { run_id: root.runId, logical_task_id: "T1", attempt: 1, instance_id: d.instance.instance_id };
    const paths = taskCellPaths(ids);
    const validation = JSON.parse(fs.readFileSync(path.join(root.cwd, paths.validation_path), "utf8"));
    const authorities = [
      { authority: "deterministic_floor", decision: "accepted", at: FIXED_NOW, reason: null },
      { authority: "team_lead", decision: "accepted", at: FIXED_NOW, reason: null },
    ];
    const acceptance = buildAcceptance({ validation, acceptancePolicyVersion: "E00.1", authoritiesRequired: ["deterministic_floor", "team_lead"], authoritiesObserved: authorities as never, reviewerCellId: null, now: () => FIXED_NOW });
    // Simulates writeAcceptanceRecord persisting bytes whose publication then threw (temp-root input).
    fs.writeFileSync(path.join(root.cwd, paths.acceptance_path), JSON.stringify(acceptance, null, 2) + "\n");
    const intended = {
      acceptance_policy_version: "E00.1", authorities_required: ["deterministic_floor", "team_lead"], authorities_observed: authorities,
      reviewer_cell_id: null, validation_result_id: validation.validation_result_id, receipt_id: validation.receipt_id,
      assignment_id: validation.assignment_id, not_before: FIXED_NOW,
    };
    return { root, rt, d, ids, paths, intended, advance: (t: string) => { clock = t; } };
  }

  it("classifyPersistedAcceptance distinguishes absent, persisted_matching and persisted_conflicting", async () => {
    const classify = await requireExport<(...a: unknown[]) => Record<string, unknown>>(FACADE, "classifyPersistedAcceptance");
    const { root, ids, paths, intended } = await validatedWithPersistedAcceptance();
    expect(classify(root.cwd, ids, intended)).toMatchObject({ kind: "persisted_matching" });
    expect(classify(root.cwd, ids, { ...intended, acceptance_policy_version: "E00.2" })).toMatchObject({ kind: "persisted_conflicting" });
    fs.rmSync(path.join(root.cwd, paths.acceptance_path));
    expect(classify(root.cwd, ids, intended)).toMatchObject({ kind: "absent" });
  });

  it("publishPersistedLifecycleRecord publishes the exact bytes once at the current clock, then already_published", async () => {
    const publishPersisted = await requireExport<(...a: unknown[]) => Record<string, unknown>>(FACADE, "publishPersistedLifecycleRecord");
    const { root, ids, paths } = await validatedWithPersistedAcceptance();
    const bytes = fs.readFileSync(path.join(root.cwd, paths.acceptance_path));
    const later = "2026-10-26T13:05:00.000Z";
    const first = publishPersisted(root.cwd, ids, "acceptance", { binding_ref: root.bindingRef }, () => later);
    expect(first).toMatchObject({ outcome: "published" });
    const events = readBusLog(runDir(root)).filter((e) => e.path === paths.acceptance_path);
    expect(events.length).toBe(1);
    expect(events[0].sha256).toBe(sha256(bytes));
    expect(events[0].ts).toBe(later);
    expect(fs.readFileSync(path.join(root.cwd, paths.acceptance_path)).equals(bytes)).toBe(true);
    expect(publishPersisted(root.cwd, ids, "acceptance", { binding_ref: root.bindingRef }, () => "2026-10-26T13:06:00.000Z")).toMatchObject({ outcome: "already_published" });
    expect(readBusLog(runDir(root)).filter((e) => e.path === paths.acceptance_path).length).toBe(1);
  });

  it("runtime.reconcilePersistedAcceptance transitions at the current clock and is illegal_state afterwards", async () => {
    const { FilesystemTaskCellRuntime } = await import("../../src/domains/dispatch");
    requireMethod(FilesystemTaskCellRuntime.prototype, "FilesystemTaskCellRuntime", "reconcilePersistedAcceptance");
    const { rt, d, paths, root, advance } = await validatedWithPersistedAcceptance();
    advance("2026-10-26T13:07:00.000Z");
    const runtime = rt.runtime as unknown as Record<string, (i: unknown) => Promise<Record<string, unknown>>>;
    const out = await runtime["reconcilePersistedAcceptance"](d.instance);
    expect(out.ok).toBe(true);
    const acc = JSON.parse(fs.readFileSync(path.join(root.cwd, paths.acceptance_path), "utf8"));
    expect(acc.termination_authorized_at).toBe(FIXED_NOW);
    const again = await runtime["reconcilePersistedAcceptance"](d.instance);
    expect(JSON.stringify(again)).toContain("illegal_state");
  });

  for (const method of ["reconcilePersistedValidation", "reconcilePersistedTerminal"]) {
    it(`FilesystemTaskCellRuntime declares ${method}`, async () => {
      const { FilesystemTaskCellRuntime } = await import("../../src/domains/dispatch");
      requireMethod(FilesystemTaskCellRuntime.prototype, "FilesystemTaskCellRuntime", method);
    });
  }
});
