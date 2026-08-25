/** Live installed-host conformance runner for the canonical TaskCell lifecycle. */
import * as fs from "node:fs";
import * as path from "node:path";

import { sha256 } from "../../communication";
import { loadRunBinding, mintRunBinding } from "../../lifecycle";
import { readTaskCellLifecycleEvents } from "../../telemetry";
import { auditTaskCellArtifactJoin } from "./task-cell-artifact-join";
import {
  buildTaskAssignmentV2,
  taskCellPaths,
  validateTaskAssignmentV2,
  type TaskAssignmentV2,
} from "./task-cell-contract";
import { acknowledgeAssignment } from "./task-assignment-v2";
import {
  FilesystemTaskCellRuntime,
  type TaskCellMechanicsMode,
  type TaskCellWorkerPort,
} from "./task-cell-runtime";

export const TASK_CELL_HOST_CONFORMANCE_SCHEMA = "guild.task_cell_host_conformance_receipt.v1" as const;
export const TASK_CELL_HOST_CONFORMANCE_MATRIX_SCHEMA = "guild.task_cell_host_conformance_matrix.v1" as const;

export type HostConformanceStatus = "passed" | "degraded" | "refused";

export interface HostProbePreflight {
  ok: boolean;
  requested_host: string;
  bound_host_id: string | null;
  capability_snapshot_hash: string | null;
  mechanics_mode: TaskCellMechanicsMode;
  launch_requested: string | null;
  launch_effective: string | null;
  degradation_reasons: string[];
  evidence: unknown;
  errors: string[];
}

export interface NormalizedHostHandoff {
  schema_version: "guild.handoff.v2";
  task_id: string;
  tier: "cheap" | "mid" | "powerful";
  status: "done" | "blocked" | "escalate";
  summary: string;
  artifacts: string[];
  issues: string[];
  injection_clean?: "clean" | "flagged" | "unverified";
}

export interface HostProbeInvocationInput {
  host: string;
  cwd: string;
  run_id: string;
  assignment: TaskAssignmentV2;
  prompt: string;
  record_path: string;
}

export interface HostProbeInvocation {
  exit: number;
  stdout: string;
  stderr: string;
  wrapper_record: unknown;
  handoff: NormalizedHostHandoff | null;
  errors: string[];
}

export interface HostProbeRunner {
  preflight(input: { host: string; cwd: string; run_id: string }): HostProbePreflight;
  invoke(input: HostProbeInvocationInput): HostProbeInvocation;
}

export interface HostConformanceConcern {
  id:
    | "fresh_instance_spawn"
    | "assignment_delivery_ack"
    | "tool_permission_projection"
    | "structured_result_normalization"
    | "heartbeat_cancel_terminate"
    | "retry_new_attempt"
    | "resumable_artifact_delivery"
    | "truthful_degradation";
  status: HostConformanceStatus;
  detail: string;
  evidence_refs: string[];
}

export interface HostConformanceAttempt {
  attempt: number;
  task_run_id: string;
  attempt_id: string;
  previous_attempt_id: string | null;
  instance_id: string;
  context_bundle_hash: string;
  assignment_path: string;
  wrapper_record_path: string;
  host_output_path: string;
  handoff_receipt_path: string;
  artifact_join_ok: boolean;
  ok: boolean;
  errors: string[];
}

export interface TaskCellHostConformanceReceipt {
  schema_version: typeof TASK_CELL_HOST_CONFORMANCE_SCHEMA;
  run_id: string;
  requested_host: string;
  bound_host_id: string | null;
  capability_snapshot_hash: string | null;
  mechanics_mode: TaskCellMechanicsMode;
  degradation_reasons: string[];
  task_team_verified: boolean;
  support_state: "verified" | "verified_with_degradation" | "refused";
  attempts: HostConformanceAttempt[];
  normalized_trace: string[];
  concerns: HostConformanceConcern[];
  receipt_path: string;
  generated_at: string;
}

export interface TaskCellHostConformanceMatrix {
  schema_version: typeof TASK_CELL_HOST_CONFORMANCE_MATRIX_SCHEMA;
  ok: boolean;
  equivalent_traces: boolean;
  verified_hosts: string[];
  refused_hosts: string[];
  receipts: string[];
}

export interface TaskCellHostConformanceVerification {
  valid: boolean;
  errors: string[];
  receipt: TaskCellHostConformanceReceipt | null;
}

export interface RunTaskCellHostConformanceInput {
  cwd: string;
  run_id: string;
  host: string;
  runner: HostProbeRunner;
  now?: () => string;
  nonceFactory?: (attempt: number) => string;
}

function safeSegment(value: string): string {
  const normalized = value.replace(/[^A-Za-z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized || "unknown-host";
}

function writeJson(cwd: string, relative: string, value: unknown): void {
  const out = path.resolve(cwd, relative);
  const root = path.resolve(cwd) + path.sep;
  if (!out.startsWith(root)) throw new Error(`evidence path escapes cwd: ${relative}`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(value, null, 2) + "\n", "utf8");
}

function evidenceFile(cwd: string, relative: string): string | null {
  if (path.isAbsolute(relative)) return null;
  const lexicalRoot = path.resolve(cwd);
  const lexical = path.resolve(lexicalRoot, relative);
  if (lexical !== lexicalRoot && !lexical.startsWith(lexicalRoot + path.sep)) return null;
  try {
    const stat = fs.lstatSync(lexical);
    if (!stat.isFile()) return null;
    const root = fs.realpathSync(lexicalRoot);
    const real = fs.realpathSync(lexical);
    return real.startsWith(root + path.sep) ? real : null;
  } catch {
    return null;
  }
}

function readJsonFile(file: string): unknown | null {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
}

function handoffFromOutput(raw: string): NormalizedHostHandoff | null {
  const match = /```guild\.handoff\.v2\s*\n([\s\S]*?)```/.exec(raw);
  if (!match?.[1]) return null;
  try { return JSON.parse(match[1]) as NormalizedHostHandoff; } catch { return null; }
}

function handoffIsExact(
  handoff: NormalizedHostHandoff | null,
  assignment: TaskAssignmentV2,
  expectedSummary: string,
): boolean {
  return Boolean(
    handoff &&
    handoff.schema_version === "guild.handoff.v2" &&
    handoff.task_id === assignment.logical_task_id &&
    handoff.status === "done" &&
    handoff.summary === expectedSummary &&
    Array.isArray(handoff.artifacts) &&
    Array.isArray(handoff.issues),
  );
}

function wrapperRecordIsBound(record: unknown, expectedHostId: string, expectedHash: string): boolean {
  if (!record || typeof record !== "object" || Array.isArray(record)) return false;
  const root = record as Record<string, unknown>;
  if (root.schema_version !== "guild.run_wrapper_record.v1" || root.contract !== "guild.handoff.v2") return false;
  const normalized = root.normalized as Record<string, unknown> | null;
  const adapter = root.host_adapter as Record<string, unknown> | null;
  const boundary = adapter?.boundary as Record<string, unknown> | null;
  return Boolean(
    root.exit === 0 &&
    normalized?.ok === true &&
    normalized?.failed_closed === false &&
    boundary?.disposition === "succeeded" &&
    boundary?.host_id === expectedHostId &&
    boundary?.capability_snapshot_hash === expectedHash,
  );
}

function failureReason(result: { ok: boolean }): string {
  const value = result as { reason?: unknown; failure?: unknown };
  if (typeof value.reason === "string" && value.reason.length > 0) return value.reason;
  if (typeof value.failure === "string" && value.failure.length > 0) return value.failure;
  return "TaskCell lifecycle operation failed";
}

class LiveHostWorkerPort implements TaskCellWorkerPort {
  readonly mode: TaskCellMechanicsMode;
  readonly losses: readonly string[];
  readonly attempts: HostConformanceAttempt[] = [];
  private readonly input: RunTaskCellHostConformanceInput;
  private readonly preflight: HostProbePreflight;
  private readonly now: () => string;

  constructor(input: RunTaskCellHostConformanceInput, preflight: HostProbePreflight, now: () => string) {
    this.input = input;
    this.preflight = preflight;
    this.now = now;
    this.mode = preflight.mechanics_mode;
    this.losses = Object.freeze([...preflight.degradation_reasons]);
  }

  isAvailable(): boolean { return this.preflight.ok; }
  spawn(): { ok: boolean; reason: string | null } {
    return this.preflight.ok
      ? { ok: true, reason: this.mode === "native" ? null : "fresh process launch deferred to assignment delivery (recorded emulation)" }
      : { ok: false, reason: this.preflight.errors.join("; ") || "host preflight refused" };
  }
  ready(): { ok: boolean; reason: string | null } {
    return this.preflight.ok
      ? { ok: true, reason: "wrapper readiness is recorded before the assignment-bound process launch" }
      : { ok: false, reason: "host preflight refused" };
  }

  notifyAssignment(input: { assignment_path: string }): { ok: boolean; reason: string | null } {
    const assignment = JSON.parse(fs.readFileSync(path.resolve(this.input.cwd, input.assignment_path), "utf8")) as TaskAssignmentV2;
    const context = fs.readFileSync(path.resolve(this.input.cwd, assignment.context_bundle_id), "utf8").trim();
    const paths = taskCellPaths(assignment);
    const hostSlug = safeSegment(this.input.host);
    const wrapperRecordPath = path.join(paths.instance_dir, "guild-run-record.json");
    const hostOutputPath = path.join(paths.instance_dir, "host-output.txt");
    const hostErrorPath = path.join(paths.instance_dir, "host-stderr.txt");
    const handoffReceiptPath = paths.receipt_path;
    const prompt = [
      "You are executing an installed-host TaskCell conformance probe in read-only mode.",
      `Read the assignment JSON at ${assignment.assignment_path}.`,
      "Read the context file named by its context_bundle_id field.",
      "Emit only guild.handoff.v2 and include schema_version exactly guild.handoff.v2. Set task_id to the assignment logical_task_id, status to done, tier to cheap,",
      "summary to the complete context file contents without a trailing newline, and artifacts/issues to empty arrays.",
      "Do not infer or repeat values from this prompt; derive them from the files.",
    ].join(" ");
    const result = this.input.runner.invoke({
      host: this.input.host,
      cwd: this.input.cwd,
      run_id: assignment.run_id,
      assignment,
      prompt,
      record_path: wrapperRecordPath,
    });
    const exact = handoffIsExact(result.handoff, assignment, context);
    const bound = this.preflight.bound_host_id !== null && this.preflight.capability_snapshot_hash !== null &&
      wrapperRecordIsBound(result.wrapper_record, this.preflight.bound_host_id, this.preflight.capability_snapshot_hash);
    const errors = [...result.errors];
    if (result.exit !== 0) errors.push(`host wrapper exited ${result.exit}`);
    if (!exact) errors.push("host handoff did not match the assignment-bound task/context");
    if (!bound) errors.push("wrapper record did not preserve the preflight host binding and capability snapshot");
    const ok = result.exit === 0 && exact && bound;

    const absOutput = path.resolve(this.input.cwd, hostOutputPath);
    fs.mkdirSync(path.dirname(absOutput), { recursive: true });
    fs.writeFileSync(absOutput, result.stdout, "utf8");
    fs.writeFileSync(path.resolve(this.input.cwd, hostErrorPath), result.stderr, "utf8");
    writeJson(this.input.cwd, wrapperRecordPath, result.wrapper_record);

    if (ok && result.handoff) {
      const producedAt = this.now();
      const receipt = [
        "---",
        "schema_version: guild.handoff_receipt.v1",
        "ids:",
        "  initiative_id: null",
        `  run_id: ${JSON.stringify(assignment.run_id)}`,
        `  task_id: ${JSON.stringify(assignment.logical_task_id)}`,
        `  task_run_id: ${JSON.stringify(assignment.task_run_id)}`,
        `specialist: ${JSON.stringify(assignment.worker_role)}`,
        "host:",
        `  selected: ${JSON.stringify(assignment.host_id)}`,
        `  degraded: ${this.preflight.degradation_reasons.length > 0 ? "true" : "false"}`,
        `  native_ref: ${JSON.stringify(wrapperRecordPath)}`,
        "  independence: weak",
        "scope:",
        `  objective: ${JSON.stringify(assignment.objective)}`,
        `  in_scope: ${JSON.stringify(assignment.scope_paths)}`,
        "  out_of_scope_touched: []",
        "status: completed",
        "changed_files: []",
        "evidence:",
        "  - kind: artifact",
        `    ref: ${JSON.stringify(hostOutputPath)}`,
        "    result: pass",
        "assumptions: []",
        "open_risks: []",
        "followups: []",
        `produced_at: ${JSON.stringify(producedAt)}`,
        "---",
        "",
        "## changed_files",
        "- none",
        "",
        "## opens_for",
        "- lead",
        "",
        "## assumptions",
        "- none",
        "",
        "## evidence",
        `- ${hostOutputPath}`,
        "",
        "## followups",
        "- none",
        "",
        "```guild.handoff.v2",
        JSON.stringify(result.handoff),
        "```",
        "",
      ].join("\n");
      const absReceipt = path.resolve(this.input.cwd, handoffReceiptPath);
      fs.mkdirSync(path.dirname(absReceipt), { recursive: true });
      fs.writeFileSync(absReceipt, receipt, "utf8");
      acknowledgeAssignment(this.input.cwd, assignment, this.now);
      writeJson(this.input.cwd, assignment.handoff_path, {
        receipt_id: `handoff-sha256:${sha256(receipt)}`,
        receipt_path: handoffReceiptPath,
        schema_valid: true,
        claimed_changed_files: [],
        acceptance_tests_passed: [...assignment.acceptance_tests],
        submitted_at: producedAt,
      });
    }

    this.attempts.push({
      attempt: assignment.attempt,
      task_run_id: assignment.task_run_id,
      attempt_id: assignment.attempt_id,
      previous_attempt_id: assignment.previous_attempt_id ?? null,
      instance_id: assignment.instance_id,
      context_bundle_hash: assignment.context_bundle_hash,
      assignment_path: assignment.assignment_path,
      wrapper_record_path: wrapperRecordPath,
      host_output_path: hostOutputPath,
      handoff_receipt_path: handoffReceiptPath,
      artifact_join_ok: false,
      ok,
      errors,
    });
    return ok ? { ok: true, reason: null } : { ok: false, reason: errors.join("; ") };
  }

  terminate(): { ok: boolean; reason: string | null } {
    return {
      ok: true,
      reason: "the synchronous wrapper process was already collected; interrupt/cancel is recorded as an explicit emulation",
    };
  }
}

function refusedReceipt(
  input: RunTaskCellHostConformanceInput,
  preflight: HostProbePreflight,
  now: () => string,
  receiptPath: string,
): TaskCellHostConformanceReceipt {
  const detail = preflight.errors.join("; ") || "host preflight refused";
  const concernIds: HostConformanceConcern["id"][] = [
    "fresh_instance_spawn", "assignment_delivery_ack", "tool_permission_projection",
    "structured_result_normalization", "heartbeat_cancel_terminate", "retry_new_attempt",
    "resumable_artifact_delivery", "truthful_degradation",
  ];
  return {
    schema_version: TASK_CELL_HOST_CONFORMANCE_SCHEMA,
    run_id: input.run_id,
    requested_host: input.host,
    bound_host_id: preflight.bound_host_id,
    capability_snapshot_hash: preflight.capability_snapshot_hash,
    mechanics_mode: preflight.mechanics_mode,
    degradation_reasons: [...preflight.degradation_reasons, ...preflight.errors],
    task_team_verified: false,
    support_state: "refused",
    attempts: [],
    normalized_trace: [],
    concerns: concernIds.map((id) => ({ id, status: "refused", detail, evidence_refs: [] })),
    receipt_path: receiptPath,
    generated_at: now(),
  };
}

export async function runTaskCellHostConformance(
  input: RunTaskCellHostConformanceInput,
): Promise<TaskCellHostConformanceReceipt> {
  const cwd = path.resolve(input.cwd);
  const now = input.now ?? (() => new Date().toISOString());
  const hostSlug = safeSegment(input.host);
  const receiptPath = `.guild/runs/${input.run_id}/task-cell-host-conformance/${hostSlug}.json`;
  const preflight = input.runner.preflight({ host: input.host, cwd, run_id: input.run_id });
  if (!preflight.ok || !preflight.bound_host_id || !preflight.capability_snapshot_hash) {
    const receipt = refusedReceipt(input, preflight, now, receiptPath);
    writeJson(cwd, receiptPath, receipt);
    return receipt;
  }

  const binding = loadRunBinding({ root: cwd, run_id: input.run_id }) ??
    mintRunBinding({ root: cwd, run_id: input.run_id });
  if (binding.state !== "open") throw new Error(`run binding is closed: ${input.run_id}`);
  const worker = new LiveHostWorkerPort({ ...input, cwd }, preflight, now);
  let idSeq = 0;
  const runtime = new FilesystemTaskCellRuntime({
    cwd,
    substrate: "serial",
    parallelism: 1,
    binding: { binding_ref: binding.binding_ref },
    worker,
    now,
    idFactory: (kind) => `${hostSlug}-${kind}-${++idSeq}`,
  });
  const contextRel = `.guild/context/${input.run_id}/${hostSlug}-probe.txt`;
  const context = input.nonceFactory?.(1) ?? `guild-host-probe-${hostSlug}-${sha256(`${input.run_id}:${hostSlug}`).slice(0, 16)}`;
  fs.mkdirSync(path.dirname(path.resolve(cwd, contextRel)), { recursive: true });
  fs.writeFileSync(path.resolve(cwd, contextRel), context + "\n", "utf8");
  const contextHash = runtime.contentHash(context + "\n");
  const cell = await runtime.spawnCell({
    run_id: input.run_id,
    cell_id: `cell-host-probe-${hostSlug}`,
    goal_id: "G9",
    phase_id: "qa",
    step_id: "host-conformance",
    team_id: "task-cell-conformance",
    logical_task_id: `host-probe-${hostSlug}`,
    fanout: "lead_plus_one",
    lead: { lead_binding_id: "conformance-lead" },
  });

  let previousAttemptId: string | null = null;
  for (const attempt of [1, 2]) {
    const taskRunId = `host-probe-${hostSlug}.tr${attempt}`;
    try {
      const instance = await runtime.spawnInstance(cell, {
        task_run_id: taskRunId,
        attempt,
        ...(attempt === 2 ? { previous_attempt_id: previousAttemptId, retry_reason: "G9 retry conformance" } : {}),
        worker_role: "conformance-probe",
        specialist_type_id: "quality",
        specialist_type_version: "1",
        specialist_type_hash: "sha256:task-cell-host-conformance",
        specialist_profile_id: "installed-host",
        specialist_profile_hash: `sha256:${sha256(input.host)}`,
        host_id: preflight.bound_host_id,
        adapter_id: `${preflight.bound_host_id}@1`,
        host_capabilities_hash: preflight.capability_snapshot_hash,
        model_tier: "cheap",
        context_bundle_id: contextRel,
        context_bundle_hash: contextHash,
        projection: {
          tools: ["read"],
          permissions: [`requested:${preflight.launch_requested ?? "unknown"}`, `effective:${preflight.launch_effective ?? "unknown"}`],
          recorded_losses: preflight.degradation_reasons.map((loss) => ({ capability: "host-runtime", mapping: preflight.mechanics_mode, loss })),
        },
        budgets: { tokens: null, wall_clock_ms: 180_000, cost_usd: null },
      });
      previousAttemptId = instance.attempt_id;
      const ready = await runtime.awaitReady(instance);
      if (!ready.ok) throw new Error(failureReason(ready));
      const assignment = buildTaskAssignmentV2({
        run_id: input.run_id,
        cell_id: cell.cell_id,
        goal_id: cell.goal_id,
        phase_id: cell.phase_id,
        step_id: cell.step_id,
        team_id: cell.team_id,
        logical_task_id: cell.logical_task_id,
        task_run_id: instance.task_run_id,
        attempt: instance.attempt,
        attempt_id: instance.attempt_id,
        previous_attempt_id: attempt === 1 ? null : worker.attempts[0]?.attempt_id ?? null,
        retry_reason: attempt === 1 ? null : "G9 retry conformance",
        instance_id: instance.instance_id,
        lead_binding_id: "conformance-lead",
        team_lead_instance_id: null,
        worker_role: instance.worker_role,
        specialist_type_id: "quality",
        specialist_type_version: "1",
        specialist_type_hash: "sha256:task-cell-host-conformance",
        specialist_profile_id: "installed-host",
        specialist_profile_hash: `sha256:${sha256(input.host)}`,
        context_bundle_id: contextRel,
        context_bundle_hash: contextHash,
        host_id: preflight.bound_host_id,
        adapter_id: `${preflight.bound_host_id}@1`,
        host_capabilities_hash: preflight.capability_snapshot_hash,
        objective: "Prove assignment-bound structured result conformance on the installed host surface",
        non_goals: ["modify project files"],
        scope_paths: [],
        output_schema: "guild.handoff_receipt.v1",
        acceptance_tests: [],
        dependencies: [],
        projection: {
          tools: ["read"],
          permissions: [`requested:${preflight.launch_requested ?? "unknown"}`, `effective:${preflight.launch_effective ?? "unknown"}`],
          recorded_losses: preflight.degradation_reasons.map((loss) => ({ capability: "host-runtime", mapping: preflight.mechanics_mode, loss })),
        },
        autonomy_policy: "read_only",
        budgets: { tokens: null, wall_clock_ms: 180_000, cost_usd: null },
        deadline: null,
        written_at: now(),
      });
      const delivered = await runtime.deliverAssignment(instance, assignment);
      if (!delivered.ok) throw new Error(failureReason(delivered));
      const acknowledged = await runtime.awaitAssignmentAck(instance);
      if (!acknowledged.ok) throw new Error(failureReason(acknowledged));
      const heartbeat = await runtime.heartbeat(instance, now());
      if (!heartbeat.ok) throw new Error("heartbeat failed");
      const collected = await runtime.collectHandoff(instance);
      if (!collected.ok) throw new Error(failureReason(collected));
      const accepted = await runtime.acceptHandoff(instance, {
        acceptance_policy_version: "G9.1",
        authorities_required: ["deterministic_floor", "team_lead"],
        authorities_observed: [
          { authority: "deterministic_floor", decision: "accepted", at: now(), reason: null },
          { authority: "team_lead", decision: "accepted", at: now(), reason: null },
        ],
      });
      if (!accepted.ok) throw new Error(failureReason(accepted));
      const terminated = await runtime.terminate(instance);
      if (!terminated.ok) throw new Error(failureReason(terminated));
      const latest = worker.attempts[worker.attempts.length - 1];
      if (latest) latest.artifact_join_ok = auditTaskCellArtifactJoin({
        cwd,
        runId: input.run_id,
        requireClosed: true,
        requireStationArtifacts: false,
      }).ok;
    } catch (error) {
      const latest = worker.attempts[worker.attempts.length - 1];
      if (latest && latest.attempt === attempt) {
        latest.ok = false;
        latest.errors.push(error instanceof Error ? error.message : String(error));
      }
      break;
    }
  }

  const lifecycle = readTaskCellLifecycleEvents({ cwd, runId: input.run_id });
  const traces = worker.attempts.map((attempt) => lifecycle
    .filter((event) => event.instance_id === attempt.instance_id)
    .map((event) => event.event_name));
  const normalizedTrace = traces[0] ?? [];
  const equivalent = traces.length === 2 && traces.every((trace) => JSON.stringify(trace) === JSON.stringify(normalizedTrace));
  const attemptsOk = worker.attempts.length === 2 && worker.attempts.every((attempt) => attempt.ok);
  const joinsOk = attemptsOk && worker.attempts.every((attempt) => attempt.artifact_join_ok);
  const retryOk = attemptsOk && worker.attempts[0].instance_id !== worker.attempts[1].instance_id &&
    worker.attempts[1].previous_attempt_id === worker.attempts[0].attempt_id &&
    worker.attempts[0].context_bundle_hash === worker.attempts[1].context_bundle_hash;
  const ownInstanceIds = new Set(worker.attempts.map((attempt) => attempt.instance_id));
  const degradationTruth = lifecycle.filter((event) => ownInstanceIds.has(event.instance_id)).every((event) =>
    event.mechanics_mode === preflight.mechanics_mode &&
    JSON.stringify(event.degradation_reasons) === JSON.stringify(preflight.degradation_reasons));
  const refs = worker.attempts.flatMap((attempt) => [attempt.assignment_path, attempt.wrapper_record_path, attempt.handoff_receipt_path]);
  const concern = (
    id: HostConformanceConcern["id"],
    status: HostConformanceStatus,
    detail: string,
  ): HostConformanceConcern => ({ id, status, detail, evidence_refs: [...refs] });
  const concerns: HostConformanceConcern[] = [
    concern("fresh_instance_spawn", attemptsOk && worker.attempts[0].instance_id !== worker.attempts[1].instance_id ? "passed" : "refused", "two assignment-bound wrapper launches use distinct TaskCell instances"),
    concern("assignment_delivery_ack", attemptsOk ? "passed" : "refused", "the canonical assignment file is read before the durable acknowledgement gate opens"),
    concern("tool_permission_projection", preflight.degradation_reasons.length > 0 ? "degraded" : "passed", "projection is bound to the immutable capability snapshot and launch-mode receipt"),
    concern("structured_result_normalization", attemptsOk ? "passed" : "refused", "guild.handoff.v2 validates and matches task_run_id plus context contents exactly"),
    concern("heartbeat_cancel_terminate", attemptsOk ? "degraded" : "refused", "heartbeat and terminal sealing are native TaskCell records; the synchronous host process is collected before termination, so interrupt/cancel is recorded emulation"),
    concern("retry_new_attempt", retryOk ? "passed" : "refused", "retry preserves logical task/context and changes task_run_id, attempt, attempt_id, and instance_id"),
    concern("resumable_artifact_delivery", joinsOk ? "passed" : "refused", "the artifact-bus join reconstructs both closed attempts without host transcript state"),
    concern("truthful_degradation", degradationTruth ? "passed" : "refused", "every lifecycle event carries the preflight mechanics mode and exact degradation reasons"),
  ];
  const verified = equivalent && concerns.every((item) => item.status !== "refused");
  const receipt: TaskCellHostConformanceReceipt = {
    schema_version: TASK_CELL_HOST_CONFORMANCE_SCHEMA,
    run_id: input.run_id,
    requested_host: input.host,
    bound_host_id: preflight.bound_host_id,
    capability_snapshot_hash: preflight.capability_snapshot_hash,
    mechanics_mode: preflight.mechanics_mode,
    degradation_reasons: [...preflight.degradation_reasons],
    task_team_verified: verified,
    support_state: verified ? (concerns.some((item) => item.status === "degraded") ? "verified_with_degradation" : "verified") : "refused",
    attempts: worker.attempts,
    normalized_trace: normalizedTrace,
    concerns,
    receipt_path: receiptPath,
    generated_at: now(),
  };
  writeJson(cwd, receiptPath, receipt);
  return receipt;
}

/** Re-derive a live receipt from its canonical on-disk TaskCell evidence. */
export function verifyTaskCellHostConformanceReceipt(input: {
  cwd: string;
  receiptFile: string;
  expectedRunId: string;
}): TaskCellHostConformanceVerification {
  const cwd = path.resolve(input.cwd);
  const errors: string[] = [];
  const parsed = readJsonFile(input.receiptFile) as TaskCellHostConformanceReceipt | null;
  if (!parsed || parsed.schema_version !== TASK_CELL_HOST_CONFORMANCE_SCHEMA) {
    return { valid: false, errors: ["invalid host conformance receipt schema"], receipt: null };
  }
  if (parsed.run_id !== input.expectedRunId) errors.push("receipt run_id does not match the requested matrix run");
  const canonical = evidenceFile(cwd, parsed.receipt_path);
  let supplied: string | null = null;
  try { supplied = fs.realpathSync(input.receiptFile); } catch { /* reported below */ }
  if (!canonical || supplied !== canonical) errors.push("receipt file is not its canonical cwd/run/host path");
  const expectedReceiptPath = `.guild/runs/${input.expectedRunId}/task-cell-host-conformance/${safeSegment(parsed.requested_host)}.json`;
  if (parsed.receipt_path !== expectedReceiptPath) errors.push("receipt_path is not canonical for the requested host");
  if (!parsed.bound_host_id || !parsed.capability_snapshot_hash) errors.push("receipt lacks a bound host identity or capability snapshot");
  if (parsed.attempts.length !== 2) errors.push("receipt must carry exactly two live attempts");
  if (new Set(parsed.attempts.map((attempt) => attempt.instance_id)).size !== parsed.attempts.length) {
    errors.push("attempt instance ids are not distinct");
  }

  const instanceIds = new Set<string>();
  for (const attempt of parsed.attempts) {
    instanceIds.add(attempt.instance_id);
    const assignmentFile = evidenceFile(cwd, attempt.assignment_path);
    const wrapperFile = evidenceFile(cwd, attempt.wrapper_record_path);
    const outputFile = evidenceFile(cwd, attempt.host_output_path);
    const receiptFile = evidenceFile(cwd, attempt.handoff_receipt_path);
    if (!assignmentFile || !wrapperFile || !outputFile || !receiptFile) {
      errors.push(`attempt ${attempt.attempt} has a missing, non-file, symlink-escaped, or non-canonical evidence ref`);
      continue;
    }
    const assignment = validateTaskAssignmentV2(readJsonFile(assignmentFile));
    if (!assignment) {
      errors.push(`attempt ${attempt.attempt} assignment is invalid`);
      continue;
    }
    if (
      assignment.run_id !== parsed.run_id ||
      assignment.task_run_id !== attempt.task_run_id ||
      assignment.attempt !== attempt.attempt ||
      assignment.attempt_id !== attempt.attempt_id ||
      assignment.previous_attempt_id !== attempt.previous_attempt_id ||
      assignment.instance_id !== attempt.instance_id ||
      assignment.host_id !== parsed.bound_host_id ||
      assignment.host_capabilities_hash !== parsed.capability_snapshot_hash
    ) errors.push(`attempt ${attempt.attempt} identity does not match its assignment`);
    const contextFile = evidenceFile(cwd, assignment.context_bundle_id);
    if (!contextFile) {
      errors.push(`attempt ${attempt.attempt} context is missing or escaped`);
      continue;
    }
    const contextBytes = fs.readFileSync(contextFile);
    const contextText = contextBytes.toString("utf8").trim();
    const contextHash = `sha256:${sha256(contextBytes)}`;
    if (contextHash !== assignment.context_bundle_hash || contextHash !== attempt.context_bundle_hash) {
      errors.push(`attempt ${attempt.attempt} context hash does not match assignment/receipt`);
    }
    const output = fs.readFileSync(outputFile, "utf8");
    const handoff = handoffFromOutput(output);
    if (!handoffIsExact(handoff, assignment, contextText)) {
      errors.push(`attempt ${attempt.attempt} host output is not assignment/context exact`);
    }
    const wrapper = readJsonFile(wrapperFile);
    if (parsed.bound_host_id === null || parsed.capability_snapshot_hash === null ||
        !wrapperRecordIsBound(wrapper, parsed.bound_host_id, parsed.capability_snapshot_hash)) {
      errors.push(`attempt ${attempt.attempt} wrapper record is not bound to the receipt identity/snapshot`);
    }
    const durableReceipt = fs.readFileSync(receiptFile, "utf8");
    if (!handoffIsExact(handoffFromOutput(durableReceipt), assignment, contextText)) {
      errors.push(`attempt ${attempt.attempt} durable handoff receipt does not embed the exact normalized handoff`);
    }
    if (!attempt.ok || !attempt.artifact_join_ok || attempt.errors.length !== 0) {
      errors.push(`attempt ${attempt.attempt} self-reports an incomplete or errored lifecycle`);
    }
  }

  let lifecycle: ReturnType<typeof readTaskCellLifecycleEvents> = [];
  try { lifecycle = readTaskCellLifecycleEvents({ cwd, runId: parsed.run_id }); }
  catch (error) { errors.push(`lifecycle ledger invalid: ${error instanceof Error ? error.message : String(error)}`); }
  const traces = parsed.attempts.map((attempt) => lifecycle
    .filter((event) => event.instance_id === attempt.instance_id)
    .map((event) => event.event_name));
  if (traces.length !== 2 || traces.some((trace) => JSON.stringify(trace) !== JSON.stringify(parsed.normalized_trace))) {
    errors.push("normalized_trace does not match both on-disk instance traces");
  }
  const ownEvents = lifecycle.filter((event) => instanceIds.has(event.instance_id));
  if (ownEvents.some((event) =>
    event.mechanics_mode !== parsed.mechanics_mode ||
    JSON.stringify(event.degradation_reasons) !== JSON.stringify(parsed.degradation_reasons))) {
    errors.push("lifecycle mechanics/degradation fields do not match the receipt");
  }
  const audit = auditTaskCellArtifactJoin({
    cwd,
    runId: parsed.run_id,
    requireClosed: true,
    requireStationArtifacts: false,
  });
  if (!audit.ok) errors.push(`artifact join does not close: ${[...audit.missing, ...audit.invalid].join("; ")}`);
  const requiredConcerns: HostConformanceConcern["id"][] = [
    "fresh_instance_spawn", "assignment_delivery_ack", "tool_permission_projection",
    "structured_result_normalization", "heartbeat_cancel_terminate", "retry_new_attempt",
    "resumable_artifact_delivery", "truthful_degradation",
  ];
  if (
    parsed.concerns.length !== requiredConcerns.length ||
    requiredConcerns.some((id) => parsed.concerns.filter((item) => item.id === id).length !== 1) ||
    parsed.concerns.some((item) => item.status === "refused")
  ) errors.push("receipt concern set is missing, duplicated, or refused");
  const retry = parsed.attempts[0] && parsed.attempts[1] &&
    parsed.attempts[1].previous_attempt_id === parsed.attempts[0].attempt_id &&
    parsed.attempts[1].context_bundle_hash === parsed.attempts[0].context_bundle_hash;
  if (!retry) errors.push("retry lineage/context continuity is not proven");
  if (!parsed.task_team_verified || parsed.support_state === "refused") errors.push("receipt does not self-report a verified support state");
  return { valid: errors.length === 0, errors, receipt: parsed };
}

export function buildTaskCellHostConformanceMatrix(
  receipts: TaskCellHostConformanceReceipt[],
): TaskCellHostConformanceMatrix {
  const traces = receipts.map((receipt) => JSON.stringify(receipt.normalized_trace));
  const equivalent = traces.length > 0 && traces.every((trace) => trace === traces[0]);
  const structurallyVerified = (receipt: TaskCellHostConformanceReceipt): boolean =>
    receipt.task_team_verified &&
    receipt.support_state !== "refused" &&
    receipt.attempts.length === 2 &&
    receipt.normalized_trace.length > 0 &&
    receipt.concerns.length === 8 &&
    receipt.concerns.every((concern) => concern.status !== "refused");
  const verified = receipts.filter(structurallyVerified).map((receipt) => receipt.requested_host);
  const refused = receipts.filter((receipt) => !structurallyVerified(receipt)).map((receipt) => receipt.requested_host);
  return {
    schema_version: TASK_CELL_HOST_CONFORMANCE_MATRIX_SCHEMA,
    ok: receipts.length > 0 && equivalent && refused.length === 0,
    equivalent_traces: equivalent,
    verified_hosts: verified,
    refused_hosts: refused,
    receipts: receipts.map((receipt) => receipt.receipt_path),
  };
}
