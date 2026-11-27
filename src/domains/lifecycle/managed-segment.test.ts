/**
 * R05 · P05 host supervision on execution segments (AT17, AT18).
 *
 * AT17: a v1 managed run keeps its exit-closes-run behaviour; a logical v2 run
 * is refused until segment integration qualifies; once integrated, host exit
 * seals the exact segment and leaves the logical run open. Launch proofs bind
 * the exact operation/attempt. Negative controls: start proof substituted for
 * a rerun, worker startup crash, owned descendants surviving.
 *
 * AT18: native threshold 1 USD, observed native estimate 1.08 USD, strict
 * unknown host, 60 s duration. Native mode shows possible overshoot and the
 * estimate basis, 0.08 overshoot is observable, duration is enforced on its
 * own, strict control is disabled. Negative control: max_usd shown as a hard
 * ceiling or the estimate shown as measured spend fails.
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { StackScope } from "../state";
import { createRunLifecycle, createRealEnv } from "./run-lifecycle";
import { loadRunBinding } from "./run-binding";
import { claimManagedAttempt, managedLaunchHash, readManagedAttempt, recoverManagedSegmentSeal, runManagedWorker, type ManagedLaunchSpec, type ManagedOwnedProcess, type ManagedProcessPort, type ManagedUsageObservation } from "./managed-run";
import { createLogicalRun, readExecutionSegmentSeal, readLogicalRunView, recordExecutionSegment } from "./execution-identity";
import {
  MANAGED_SEGMENT_INTEGRATION,
  bindManagedLaunchProof,
  managedBudgetView,
  managedExitAction,
  managedV2Budget,
  resolveManagedRunTarget,
} from "./managed-segment";

const VENDORED = JSON.parse(fs.readFileSync(path.join(__dirname, "execution-identity.a02-cases.json"), "utf8")) as { cases: Array<{ id: string; instance: any }> };
const base = (schema: string) => JSON.parse(JSON.stringify(VENDORED.cases.find((c) => c.id === `${schema}-valid`)!.instance));
const H = (c: string) => `sha256:${c.repeat(64)}`;
const INTEGRATED = Object.freeze({ qualified: true, reason: "test-only integrated fixture" });
const RUN_V2 = "run-20261105-000000-segment";

let home: string, root: string, runtime: string, sourceId: string;
beforeEach(() => {
  home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "guild-r05-")));
  root = path.join(home, "project");
  runtime = path.join(home, "runtime");
  fs.mkdirSync(path.join(root, ".guild/runs"), { recursive: true });
  execFileSync("git", ["init", "--quiet", root]);
  fs.writeFileSync(path.join(root, ".guild/guild.yaml"), "schema_version: guild.root.v1\nkind: project\n");
  sourceId = new StackScope(root).discover().root.source_id;
});
afterEach(() => fs.rmSync(home, { recursive: true, force: true }));

function v1Run(): string {
  const lifecycle = createRunLifecycle(createRealEnv(root, (requested) => ({ requested, resolved: "codex" })));
  const plan = lifecycle.stageRunStart({ command: "/guild:build", arguments: { brief: "r05" }, cwd: root, root, target_kind: "existing_guild_project", workspace: { is_workspace: false, root }, project: "fixture", host_requested: "codex", model_tier_policy: "explicit", ignore_policy: "project", scan_policy: "none", initiative: null, session_identity: { envelope_host: "codex", active_model: "local-process-test" } }, { detached: true });
  lifecycle.materializeRunStart(plan);
  return plan.run_id;
}
function v2Run(executions: Array<{ id: string; host?: string; admission?: string }> = [{ id: "exec-1" }]): void {
  const m = base("logical-run");
  Object.assign(m, { source_id: sourceId, run_id: RUN_V2, initial_prompt_ref: null, execution_refs: [] });
  m.controller.source_id = sourceId;
  createLogicalRun(root, m);
  for (const e of executions) {
    const s = base("execution-segment");
    Object.assign(s.lineage, { source_id: sourceId, run_id: RUN_V2, execution_id: e.id, host_session_id: `hs-${e.id}` });
    Object.assign(s, { host_session_id: `hs-${e.id}`, original_host_id: e.host ?? "local-test", admission: e.admission ?? "active", seal_evidence: null });
    Object.assign(s.interval, { end: null, duration_ms: null });
    recordExecutionSegment(root, s, { stack_session_id: "stack-session" });
  }
}
const provenance = (run: string) => JSON.parse(fs.readFileSync(path.join(root, ".guild/runs", run, "provenance.json"), "utf8"));
function launch(extra: Partial<ManagedLaunchSpec> = {}): ManagedLaunchSpec {
  return { binary: "/bin/true", binary_sha256: H("1"), args: [], cwd: root, env: {}, max_duration_ms: 2000, classification: "local_process_test", host_id: "local-test", model: "none", max_usd: 0, strict_usd_qualified: false, ...extra };
}
function fakeProcess(mode: { gone?: boolean; crash?: boolean; exit_code?: number; usage?: ManagedUsageObservation } = {}): ManagedProcessPort & { signals: string[] } {
  const signals: string[] = [];
  return {
    signals,
    async start(): Promise<ManagedOwnedProcess> {
      if (mode.crash) throw new Error("worker startup crash");
      return {
        identity: { pid: 4242, start: "fixture" },
        exited: Promise.resolve({ exit_code: mode.exit_code ?? 0, signal: null }),
        verifyOwnership: () => true,
        signalGroup: (s) => { signals.push(s); return true; },
        groupGone: () => mode.gone ?? true,
        ...(mode.usage ? { observation: () => mode.usage! } : {}),
      };
    },
  };
}
const control = { open: async () => async () => {} };
function claim(runId: string, spec: ManagedLaunchSpec, attempt = "attempt-1") {
  return claimManagedAttempt(runtime, { source_id: sourceId, operation_id: "op-r05", run_id: runId, attempt_id: attempt, launch_hash: managedLaunchHash(spec), max_duration_ms: spec.max_duration_ms }).identity;
}
function errorCode(fn: () => unknown): string {
  try { fn(); } catch (error) { return (error as any).code ?? "thrown"; }
  return "no-refusal";
}
async function asyncCode(p: Promise<unknown>): Promise<string> {
  try { await p; } catch (error) { return (error as any).code ?? "thrown"; }
  return "no-refusal";
}

describe("AT17 · P05 supervisor on execution segments", () => {
  it("default integration is unqualified and frozen", () => {
    expect(MANAGED_SEGMENT_INTEGRATION.qualified).toBe(false);
    expect(Object.isFrozen(MANAGED_SEGMENT_INTEGRATION)).toBe(true);
  });

  it("v1 managed exit still closes the v1 run (existing behaviour)", async () => {
    const run = v1Run();
    const spec = launch();
    const identity = claim(run, spec);
    const outcome = await runManagedWorker({ runtimeDir: runtime, sourceRoot: root, identity, launch: spec, process: fakeProcess(), control });
    expect(outcome.state).toBe("exited");
    expect(loadRunBinding({ root, run_id: run })?.state).toBe("closed");
    expect(provenance(run).status).toBe("closed");
  });

  it("v1 exit with leave_resumable keeps the run resumable", async () => {
    const run = v1Run();
    const spec = launch({ leave_resumable: true });
    await runManagedWorker({ runtimeDir: runtime, sourceRoot: root, identity: claim(run, spec), launch: spec, process: fakeProcess(), control });
    expect(provenance(run).status).toBe("resumable");
  });

  it("managed launch refuses a logical v2 run before any effect while integration is unqualified", async () => {
    v2Run();
    const spec = launch({ execution_id: "exec-1" });
    const identity = claim(RUN_V2, spec);
    const proc = fakeProcess();
    expect(await asyncCode(runManagedWorker({ runtimeDir: runtime, sourceRoot: root, identity, launch: spec, process: proc, control }))).toBe("logical_v2_unqualified");
    expect(readManagedAttempt(runtime, identity.attempt_id).state).toBe("claimed");
    expect(fs.existsSync(path.join(root, ".guild/runs", RUN_V2, "attempts"))).toBe(false);
    expect(fs.readdirSync(runtime).some((n) => n.endsWith(".worker"))).toBe(false);
    expect(errorCode(() => resolveManagedRunTarget({ root, run_id: RUN_V2, source_id: sourceId, host_id: "local-test", execution_id: "exec-1" }))).toBe("logical_v2_unqualified");
  });

  it("an execution id under a v1 authority is refused", () => {
    const run = v1Run();
    expect(errorCode(() => resolveManagedRunTarget({ root, run_id: run, source_id: sourceId, host_id: "local-test", execution_id: "exec-1" }, INTEGRATED))).toBe("execution_on_v1_run");
  });

  it("once integrated, host exit seals the exact segment and leaves the logical run open", async () => {
    v2Run([{ id: "exec-1" }, { id: "exec-2" }]);
    const spec = launch({ execution_id: "exec-1" });
    const identity = claim(RUN_V2, spec);
    const manifestBefore = fs.readFileSync(path.join(root, ".guild/runs", RUN_V2, "lineage/logical-run.json"), "utf8");
    const outcome = await runManagedWorker({ runtimeDir: runtime, sourceRoot: root, identity, launch: spec, process: fakeProcess(), control, integration: INTEGRATED });
    expect(outcome.state).toBe("exited");
    const seal = readExecutionSegmentSeal(root, RUN_V2, "exec-1");
    expect(seal?.sealed_by).toEqual({ operation_id: "op-r05", attempt_id: "attempt-1", launch_hash: identity.launch_hash });
    expect(seal?.outcome_state).toBe("exited");
    expect(readExecutionSegmentSeal(root, RUN_V2, "exec-2")).toBeNull();
    const view = readLogicalRunView(root, RUN_V2);
    expect(view.kind).toBe("v2");
    if (view.kind === "v2") expect(view.manifest.controller.state).toBe("active");
    expect(fs.readFileSync(path.join(root, ".guild/runs", RUN_V2, "lineage/logical-run.json"), "utf8")).toBe(manifestBefore);
    expect(fs.existsSync(path.join(root, ".guild/runs", RUN_V2, "run-binding.json"))).toBe(false);
    // A sealed segment cannot be relaunched.
    expect(errorCode(() => resolveManagedRunTarget({ root, run_id: RUN_V2, source_id: sourceId, host_id: "local-test", execution_id: "exec-1" }, INTEGRATED))).toBe("segment_sealed");
  });

  it("a segment is reserved synchronously for one attempt; a concurrent attempt is refused before launch", async () => {
    v2Run();
    const spec = launch({ execution_id: "exec-1" });
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const held = { open: async () => { await gate; return async () => {}; } };
    const procA = fakeProcess();
    const a = runManagedWorker({ runtimeDir: runtime, sourceRoot: root, identity: claim(RUN_V2, spec, "attempt-a"), launch: spec, process: procA, control: held, integration: INTEGRATED });
    const procB = fakeProcess();
    let startedB = false;
    const b = runManagedWorker({ runtimeDir: runtime, sourceRoot: root, identity: claim(RUN_V2, spec, "attempt-b"), launch: spec, process: { start: async (...x: any[]) => { startedB = true; return (procB.start as any)(...x); } }, control, integration: INTEGRATED });
    expect(await asyncCode(b)).toBe("segment_reserved");
    expect(startedB).toBe(false);
    release();
    expect((await a).state).toBe("exited");
    expect(readExecutionSegmentSeal(root, RUN_V2, "exec-1")?.sealed_by.attempt_id).toBe("attempt-a");
  });

  it("a crash between outcome and seal recovers to the same seal idempotently", async () => {
    v2Run();
    const spec = launch({ execution_id: "exec-1" });
    const identity = claim(RUN_V2, spec);
    const blocker = path.join(root, ".guild/runs", RUN_V2, "lineage/seals");
    fs.writeFileSync(blocker, "not a directory");
    expect(await asyncCode(runManagedWorker({ runtimeDir: runtime, sourceRoot: root, identity, launch: spec, process: fakeProcess(), control, integration: INTEGRATED }))).not.toBe("no-refusal");
    expect(readManagedAttempt(runtime, identity.attempt_id).outcome?.state).toBe("exited");
    fs.rmSync(blocker);
    expect(readExecutionSegmentSeal(root, RUN_V2, "exec-1")).toBeNull();
    expect(recoverManagedSegmentSeal(runtime, root, identity, "exec-1")).toBe(true);
    const first = fs.readFileSync(path.join(blocker, "exec-1.json"), "utf8");
    expect(recoverManagedSegmentSeal(runtime, root, identity, "exec-1")).toBe(true);
    expect(fs.readFileSync(path.join(blocker, "exec-1.json"), "utf8")).toBe(first);
    expect(readExecutionSegmentSeal(root, RUN_V2, "exec-1")?.outcome_state).toBe("exited");
  });

  it("a crash after outcome.json but before the claim update still recovers the seal", async () => {
    v2Run();
    const spec = launch({ execution_id: "exec-1" });
    const identity = claim(RUN_V2, spec);
    const blocker = path.join(root, ".guild/runs", RUN_V2, "lineage/seals");
    fs.writeFileSync(blocker, "not a directory");
    await asyncCode(runManagedWorker({ runtimeDir: runtime, sourceRoot: root, identity, launch: spec, process: fakeProcess(), control, integration: INTEGRATED }));
    fs.rmSync(blocker);
    const claimFile = path.join(fs.realpathSync(runtime), "attempt-1.json");
    const c = JSON.parse(fs.readFileSync(claimFile, "utf8"));
    fs.writeFileSync(claimFile, JSON.stringify({ ...c, state: "running", outcome: null }));
    expect(readManagedAttempt(runtime, identity.attempt_id).outcome).toBeNull();
    expect(recoverManagedSegmentSeal(runtime, root, identity, "exec-1")).toBe(true);
    expect(readExecutionSegmentSeal(root, RUN_V2, "exec-1")?.outcome_state).toBe("exited");
    const outcomeFile = path.join(root, ".guild/runs", RUN_V2, "attempts/attempt-1/outcome.json");
    const o = JSON.parse(fs.readFileSync(outcomeFile, "utf8"));
    fs.chmodSync(outcomeFile, 0o600);
    fs.writeFileSync(outcomeFile, JSON.stringify({ ...o, attempt_id: "attempt-foreign" }));
    expect(errorCode(() => recoverManagedSegmentSeal(runtime, root, identity, "exec-1"))).toBe("invalid_state");
  });

  it("integrated launch refuses a missing, inactive, foreign-host or foreign-source segment", () => {
    v2Run([{ id: "exec-1" }, { id: "exec-r", admission: "reconcile_only" }, { id: "exec-c", host: "codex" }]);
    const t = (over: Record<string, unknown>) => errorCode(() => resolveManagedRunTarget({ root, run_id: RUN_V2, source_id: sourceId, host_id: "local-test", execution_id: "exec-1", ...over } as any, INTEGRATED));
    expect(t({ execution_id: undefined })).toBe("execution_required");
    expect(t({ execution_id: "exec-404" })).toBe("execution_unknown");
    expect(t({ execution_id: "exec-r" })).toBe("segment_not_active");
    expect(t({ execution_id: "exec-c" })).toBe("original_host_changed");
    expect(t({ source_id: "source-other" })).toBe("source_mismatch");
    expect(t({})).toBe("no-refusal");
  });

  it("negative control: worker startup crash neither seals nor closes", async () => {
    v2Run();
    const spec = launch({ execution_id: "exec-1" });
    const identity = claim(RUN_V2, spec);
    expect(await asyncCode(runManagedWorker({ runtimeDir: runtime, sourceRoot: root, identity, launch: spec, process: fakeProcess({ crash: true }), control, integration: INTEGRATED }))).toBe("thrown");
    expect(readManagedAttempt(runtime, identity.attempt_id).state).toBe("recovery_needed");
    expect(readExecutionSegmentSeal(root, RUN_V2, "exec-1")).toBeNull();

    const run = v1Run();
    const v1spec = launch();
    expect(await asyncCode(runManagedWorker({ runtimeDir: runtime, sourceRoot: root, identity: claim(run, v1spec, "attempt-2"), launch: v1spec, process: fakeProcess({ crash: true }), control }))).toBe("thrown");
    expect(loadRunBinding({ root, run_id: run })?.state).toBe("open");
    expect(fs.existsSync(path.join(root, ".guild/runs", run, "provenance.json"))).toBe(false);
  });

  it("negative control: surviving owned descendants hold the segment and the v1 run open", async () => {
    v2Run();
    const spec = launch({ execution_id: "exec-1" });
    const outcome = await runManagedWorker({ runtimeDir: runtime, sourceRoot: root, identity: claim(RUN_V2, spec), launch: spec, process: fakeProcess({ gone: false }), control, integration: INTEGRATED });
    expect(outcome.state).toBe("recovery_needed");
    expect(readExecutionSegmentSeal(root, RUN_V2, "exec-1")).toBeNull();

    const run = v1Run();
    const v1spec = launch();
    const v1 = await runManagedWorker({ runtimeDir: runtime, sourceRoot: root, identity: claim(run, v1spec, "attempt-2"), launch: v1spec, process: fakeProcess({ gone: false }), control });
    expect(v1.state).toBe("recovery_needed");
    expect(loadRunBinding({ root, run_id: run })?.state).toBe("open");
    expect(fs.existsSync(path.join(root, ".guild/runs", run, "provenance.json"))).toBe(false);
  });

  it("exit policy table: v1 closes, v2 seals, survivors hold", () => {
    expect(managedExitAction("v1", { gone: true, state: "exited", exit_code: 0, leave_resumable: false })).toEqual({ action: "close_run", status: "closed" });
    expect(managedExitAction("v1", { gone: true, state: "cancelled", exit_code: null, leave_resumable: false })).toEqual({ action: "close_run", status: "resumable" });
    expect(managedExitAction("v1", { gone: true, state: "exited", exit_code: 1, leave_resumable: false })).toEqual({ action: "close_run", status: "resumable" });
    expect(managedExitAction("v2", { gone: true, state: "timed_out", exit_code: null, leave_resumable: false })).toEqual({ action: "seal_segment" });
    expect(managedExitAction("v2", { gone: false, state: "recovery_needed", exit_code: 0, leave_resumable: false })).toEqual({ action: "hold" });
    expect(managedExitAction("v1", { gone: false, state: "recovery_needed", exit_code: 0, leave_resumable: false })).toEqual({ action: "hold" });
  });

  it("launch proof binds the exact operation and attempt; a start proof cannot stand in for a rerun", () => {
    const parent = { source_id: sourceId, kind: "run", id: "run-20261105-000000-parent", revision: H("c") };
    const start = { schema_version: "guild.stack.managed_launch.v1", source_id: sourceId, run_id: "run-20261105-000001-child", operation_id: "op-start", operation: "run.start", attempt_id: "attempt-s", launch_hash: H("a"), parent_run: null, parent_attempt_id: null };
    const rerun = { ...start, operation_id: "op-rerun", operation: "run.rerun", attempt_id: "attempt-r", launch_hash: H("b"), parent_run: parent };
    const expectRerun = { source_id: sourceId, run_id: start.run_id, operation_id: "op-rerun", operation: "run.rerun" as const, attempt_id: "attempt-r", launch_hash: H("b"), parent_run: parent };
    expect(() => bindManagedLaunchProof(rerun, expectRerun)).not.toThrow();
    expect(errorCode(() => bindManagedLaunchProof(start, expectRerun))).toBe("proof_mismatch");
    expect(errorCode(() => bindManagedLaunchProof({ ...start, operation_id: "op-rerun", attempt_id: "attempt-r", launch_hash: H("b") }, expectRerun))).toBe("proof_mismatch");
    expect(errorCode(() => bindManagedLaunchProof({ ...rerun, attempt_id: "attempt-other" }, expectRerun))).toBe("proof_mismatch");
    expect(errorCode(() => bindManagedLaunchProof({ ...rerun, parent_run: { ...parent, revision: H("d") } }, expectRerun))).toBe("proof_mismatch");
    expect(errorCode(() => bindManagedLaunchProof({ ...rerun, parent_run: null }, expectRerun))).toBe("proof_mismatch");
    const expectStart = { ...expectRerun, operation_id: "op-start", operation: "run.start" as const, attempt_id: "attempt-s", launch_hash: H("a"), parent_run: null };
    expect(() => bindManagedLaunchProof(start, expectStart)).not.toThrow();
    expect(errorCode(() => bindManagedLaunchProof({ ...start, parent_run: parent }, expectStart))).toBe("proof_mismatch");
    expect(errorCode(() => bindManagedLaunchProof(null, expectStart))).toBe("proof_mismatch");
  });
});

describe("AT18 · budget semantics", () => {
  const observed: ManagedUsageObservation = { state: "observed_native_estimate", cost_usd: 1.08, basis: "api_equivalent_native_estimate", cumulative_estimate_usd: 1.08 };
  const fixture = { mode: "native_spend_threshold" as const, threshold_usd: 1, duration_limit_ms: 60000, native_threshold_qualified: true, strict_usd_qualified: false, usage: observed, elapsed_ms: 61000 };

  it("native mode displays possible overshoot, estimate basis and an observable 0.08 overshoot", () => {
    const v = managedBudgetView(fixture);
    expect(v.mode).toBe("native_spend_threshold");
    expect(v.threshold.hard_ceiling).toBe(false);
    expect(v.threshold.overshoot_possible).toBe(true);
    expect(v.spend.cost_basis).toBe("native_estimate");
    expect(v.spend.estimate_basis).toBe("api_equivalent_native_estimate");
    expect(v.spend.estimate_usd).toBe(1.08);
    expect(v.spend.measured_usd).toBeNull();
    expect(v.spend.overshoot_usd).toBe(0.08);
    expect(v.spend.state).toBe("over_threshold");
    expect(v.labels.join("\n")).toContain("may overshoot");
    expect(v.labels.join("\n")).toContain("estimate");
    expect(v.labels.join("\n")).toContain("0.08");
  });

  it("duration is enforced independently of spend", () => {
    const v = managedBudgetView(fixture);
    expect(v.duration).toEqual({ limit_ms: 60000, enforcement: "independent_deadline", elapsed_ms: 61000, exceeded: true });
    expect(managedBudgetView({ ...fixture, usage: null, elapsed_ms: 1000 }).duration.exceeded).toBe(false);
    expect(managedBudgetView({ ...fixture, elapsed_ms: null }).duration.exceeded).toBeNull();
  });

  it("strict control on an unknown host is disabled, and strict mode is refused", () => {
    const v = managedBudgetView(fixture);
    const strict = v.controls.find((c) => c.id === "strict_usd_ceiling")!;
    expect(strict.available).toBe(false);
    expect(strict.reason.length).toBeGreaterThan(0);
    expect(v.controls.find((c) => c.id === "native_spend_threshold")!.available).toBe(true);
    expect(errorCode(() => managedBudgetView({ ...fixture, mode: "strict_verified" }))).toBe("budget_unqualified");
    expect(errorCode(() => managedBudgetView({ ...fixture, native_threshold_qualified: false }))).toBe("budget_unqualified");
  });

  it("unknown or missing cost stays unknown, never zero", () => {
    for (const usage of [null, { state: "unknown", cost_usd: null, basis: "no trusted provider billing observation" }, { state: "unknown", cost_usd: 0, basis: "x" }, { ...observed, cost_usd: Number.NaN }, { ...observed, cost_usd: -1 }] as any[]) {
      const v = managedBudgetView({ ...fixture, usage });
      expect(v.spend.estimate_usd).toBeNull();
      expect(v.spend.overshoot_usd).toBeNull();
      expect(v.spend.cost_basis).toBe("unavailable");
      expect(v.spend.state).toBe("unknown");
      expect(v.labels.join("\n")).toContain("unknown");
    }
    const under = managedBudgetView({ ...fixture, usage: { ...observed, cost_usd: 0.5 } });
    expect(under.spend.overshoot_usd).toBe(0);
    expect(under.spend.state).toBe("within_threshold");
  });

  it("negative control: the view never renders max_usd as a guaranteed ceiling or the estimate as measured spend", () => {
    const text = JSON.stringify(managedBudgetView(fixture)).toLowerCase();
    for (const banned of ["hard cap", "guaranteed", "maximum spend", "measured spend", "billed"]) expect(text).not.toContain(banned);
    expect(text).not.toContain('"cost_basis":"measured"');
  });

  it("frozen v2 budget projection: native threshold may overshoot, qualification disclosed", () => {
    const qualification = { source_id: sourceId, path: "artifacts/qualification.json", sha256: H("e"), schema_version: "guild.qualification.v1", observed_at: "2026-11-05T00:00:00Z", availability: "available", reason: null };
    const b = managedV2Budget(fixture, { qualification, policy_hash: H("f") });
    expect(b).toEqual({ mode: "native_spend_threshold", threshold_usd: 1, duration_limit_ms: 60000, overshoot_possible: true, qualification, policy_hash: H("f") });
    expect(errorCode(() => managedV2Budget({ ...fixture, threshold_usd: 0 }, { qualification, policy_hash: H("f") }))).toBe("budget_refused");
    expect(errorCode(() => managedV2Budget(fixture, { qualification: { ...qualification, availability: "missing" }, policy_hash: H("f") }))).toBe("budget_unqualified");
    const a02 = process.env["A02_CONTRACT_ROOT"] ?? path.resolve(__dirname, "../../..", "../contracts/guild-stack/v2");
    expect(fs.existsSync(path.join(a02, "schemas/common.schema.json")) || process.env["R01_REQUIRE_A02"] !== "1").toBe(true);
    if (fs.existsSync(path.join(a02, "schemas/common.schema.json"))) {
      const req = createRequire(path.resolve(__dirname, "../../../scripts/package.json"));
      const Ajv = req("ajv/dist/2020").default, addFormats = req("ajv-formats").default;
      const ajv = new Ajv({ strict: false, allErrors: true }); addFormats(ajv);
      for (const f of fs.readdirSync(path.join(a02, "schemas"))) ajv.addSchema(JSON.parse(fs.readFileSync(path.join(a02, "schemas", f), "utf8")));
      const validate = ajv.getSchema("https://guildstack.dev/contracts/guild-stack/v2/common.schema.json#/$defs/budget");
      expect(validate(b)).toBe(true);
    }
  });
});
