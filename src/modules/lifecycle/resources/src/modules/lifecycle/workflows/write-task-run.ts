#!/usr/bin/env -S npx tsx
/**
 * scripts/write-task-run.ts
 *
 * TE-01/ARCH-1 — guild.task_run.v1 writer.
 *
 * Contract (BY POINTER): docs/knowledge/architecture/target-architecture.md
 *   §task_run (FROZEN, guild.task_run.v1). Path:
 *   <cwd>/.guild/runs/<run-id>/task-runs/<task-id>.yaml.
 *
 * The orchestrator calls this BEFORE each dispatch attempt (one file per
 * (re)dispatch). On re-dispatch, the file is OVERWRITTEN — the internal
 * `task_run_id` tracks the attempt number; the path uses task-id only.
 *
 * The task_run file is the neutral, host-agnostic lane specification: ids,
 * specialist, objective, context-bundle, inputs, expected_outputs, depends_on,
 * permissions, budget, autonomy_policy, loops_applicable, capability_requirements
 * (for the host router), and a trace pointer. It is a DESCRIPTOR — it never
 * routes or dispatches itself.
 *
 * Usage:
 *   npx tsx scripts/write-task-run.ts \
 *     --cwd <root> \
 *     --run-id <run-id> \
 *     --task-id <task-id> \
 *     --task-run-id <trun-id>          (default: trun-001) \
 *     --specialist <name>              (default: unknown) \
 *     --objective "<text>"             (default: "") \
 *     [--initiative-id <id>]           (default: null) \
 *     [--phase <phase>]                (default: execute; the R-TRACE
 *                                        dispatch-event phase — a lifecycle
 *                                        phase token such as "execute" or
 *                                        "review", NEVER derived from
 *                                        --initiative-id) \
 *     [--context-bundle <path>]
 *     [--depends-on <id,id,...>]
 *     [--autonomy-policy <policy>]     (default: autonomous_after_plan_approval)
 *     [--loops-applicable <val>]       (default: none)
 *     [--needs-pr]                     (sets capability_requirements.needs_pr=true)
 *     [--needs-parallel]
 *     [--needs-network]
 *     [--isolation worktree|none]      (default: worktree)
 *     [--host-requested <kind>]        (default: any)
 *     [--max-turns <n>]                (default: 20)
 *     [--max-tokens <n>]               (default: 80000)
 *
 * Stdout:  path to the written task_run YAML.
 * Stderr:  diagnostics.
 * Exit:    0 success · 1 bad input · 2 internal error.
 *
 * Invariant: never writes to .guild/wiki/. Writes only under
 *   .guild/runs/<run-id>/task-runs/.
 */

import * as fs from "fs";
import * as path from "path";
// R-TRACE (Wave 6): additive dispatch trace — NEVER changes return value
import { emitTraceEvent, makeDispatchEvent } from "../../telemetry";
import { loadYamlApi } from "../../kernel";
import { atomicWrite } from "../../state";

// ── Canonical schema types (guild.task_run.v1) ───────────────────────────────

export type AutonomyPolicy =
  | "interactive"
  | "autonomous_after_plan_approval"
  | "auto_approve";

export type LoopsApplicable = "none" | "l3-only" | "l4-only" | "both" | "full";

export type NetworkPolicy =
  | "disabled_by_default"
  | "approval_required"
  | "enabled";

export type ApprovalPolicy = "approval_required" | "enabled" | "disabled";

export interface TaskRunIds {
  initiative_id: string | null;
  run_id: string;
  task_id: string;
  /** Unique per (re)dispatch attempt — e.g. trun-001, trun-002. */
  task_run_id: string;
}

export interface TaskRunPermissions {
  read: string[];
  write: string[];
  network: NetworkPolicy;
  shell: ApprovalPolicy;
  destructive: ApprovalPolicy;
}

export interface TaskRunBudget {
  max_turns: number;
  max_tokens: number;
}

export interface TaskRunCapabilityRequirements {
  needs_pr: boolean;
  needs_parallel: boolean;
  needs_network: boolean;
  isolation: "worktree" | "none";
}

export interface TaskRunModelParams {
  model: string;
  effort?: string;
  reasoning?: string;
  thinking?: string;
  verbosity?: string;
  [key: string]: string | undefined;
}

export interface TaskRunHost {
  requested: "claude-code" | "codex-local" | "codex-cloud" | "any";
  /** Filled in by the router AFTER routing; null until then. */
  selected: string | null;
  capability_requirements: TaskRunCapabilityRequirements;
  /** R5 full model params for this task, null until route/dispatch resolves them. */
  model_params: TaskRunModelParams | null;
}

export interface TaskRunTrace {
  events_ref: string;
}

/** The frozen guild.task_run.v1 shape (top-level wrapper). */
export interface TaskRun {
  schema_version: "guild.task_run.v1";
  ids: TaskRunIds;
  specialist: string;
  objective: string;
  context_bundle: string;
  inputs: string[];
  expected_outputs: string[];
  depends_on: string[];
  permissions: TaskRunPermissions;
  budget: TaskRunBudget;
  autonomy_policy: AutonomyPolicy;
  loops_applicable: LoopsApplicable;
  host: TaskRunHost;
  trace: TaskRunTrace;
}

/** The YAML file root document (outer wrapper key `task_run:`). */
export interface TaskRunDocument {
  task_run: TaskRun;
}

// ── Input parameters (camelCase — the writer's API surface) ──────────────────

export interface TaskRunCapabilityRequirementsParams {
  needsPr?: boolean;
  needsParallel?: boolean;
  needsNetwork?: boolean;
  isolation?: "worktree" | "none";
}

export interface TaskRunPermissionsParams {
  read?: string[];
  write?: string[];
  network?: NetworkPolicy;
  shell?: ApprovalPolicy;
  destructive?: ApprovalPolicy;
}

export interface TaskRunBudgetParams {
  maxTurns?: number;
  maxTokens?: number;
}

export interface TaskRunHostParams {
  requested?: "claude-code" | "codex-local" | "codex-cloud" | "any";
  capabilityRequirements?: TaskRunCapabilityRequirementsParams;
  modelParams?: TaskRunModelParams | null;
}

/** Accepted by writeTaskRun(). All fields except task_run_id have sensible defaults. */
export interface TaskRunParams {
  /** Default: null (not part of an initiative). */
  initiativeId?: string | null;
  /** Unique attempt id. Default: "trun-001". */
  taskRunId?: string;
  /** One of the 14 Guild specialists. Default: "unknown". */
  specialist?: string;
  /** Lane objective prose. Default: "". */
  objective?: string;
  /** Path to the context bundle for this lane. Default: "". */
  contextBundle?: string;
  /**
   * R-TRACE dispatch-event phase (e.g. "execute", "review"). Default: "execute".
   * A caller-supplied lifecycle phase — never derived from initiativeId (an
   * initiative id is an unrelated identifier, not a phase token; conflating
   * the two silently mislabeled every dispatch trace event with the
   * initiative slug instead of the actual phase).
   */
  phase?: string;
  inputs?: string[];
  expectedOutputs?: string[];
  dependsOn?: string[];
  permissions?: TaskRunPermissionsParams;
  budget?: TaskRunBudgetParams;
  autonomyPolicy?: AutonomyPolicy;
  loopsApplicable?: LoopsApplicable;
  host?: TaskRunHostParams;
}

// ── Path helper ───────────────────────────────────────────────────────────────

/**
 * Canonical path for a task_run file.
 * `.guild/runs/<run-id>/task-runs/<task-id>.yaml`
 */
export function taskRunPath(cwd: string, runId: string, taskId: string): string {
  return path.join(cwd, ".guild", "runs", runId, "task-runs", `${taskId}.yaml`);
}

// ── Read (W2-A2 single-source) ───────────────────────────────────────────────

/**
 * W2-A2: read back the `capability_requirements` block from a previously written
 * task_run YAML file. Used by the launcher to seed `planTeamRouting` from the
 * WRITTEN file rather than re-parsing team.yaml — makes the written task_run the
 * single source of truth (writer↔router drift is structurally impossible).
 *
 * Returns undefined if the file does not exist, cannot be parsed, or has no
 * `host.capability_requirements` block (fail-open: routing falls back to
 * spec.capabilityRequirements parsed directly from team.yaml).
 */
export function readTaskRunCapReqs(
  cwd: string,
  runId: string,
  taskId: string
): TaskRunCapabilityRequirements | undefined {
  try {
    const p = taskRunPath(cwd, runId, taskId);
    const raw = fs.readFileSync(p, "utf8");
    const doc = loadYamlApi().load(raw) as TaskRunDocument | null;
    const cr = doc?.task_run?.host?.capability_requirements;
    if (!cr) return undefined;
    return {
      needs_pr: cr.needs_pr,
      needs_parallel: cr.needs_parallel,
      needs_network: cr.needs_network,
      isolation: cr.isolation,
    };
  } catch {
    return undefined;
  }
}

// ── Write ────────────────────────────────────────────────────────────────────

/**
 * Serialize a guild.task_run.v1 document to disk (atomic temp+rename).
 * Returns the written file path.
 *
 * Called by the execute-plan dispatch path BEFORE each dispatch attempt.
 * Re-dispatch overwrites the file; task_run_id tracks the attempt number.
 */
export function writeTaskRun(
  cwd: string,
  runId: string,
  taskId: string,
  params: TaskRunParams
): string {
  const {
    initiativeId = null,
    taskRunId = "trun-001",
    specialist = "unknown",
    objective = "",
    contextBundle = "",
    phase = "execute",
    inputs = [],
    expectedOutputs = [],
    dependsOn = [],
    permissions = {},
    budget = {},
    autonomyPolicy = "autonomous_after_plan_approval",
    loopsApplicable = "none",
    host = {},
  } = params;

  const capReqs = host.capabilityRequirements ?? {};
  const eventsRef = `.guild/runs/${runId}/logs/v1.4-events.jsonl`;

  const taskRun: TaskRun = {
    schema_version: "guild.task_run.v1",
    ids: {
      initiative_id: initiativeId,
      run_id: runId,
      task_id: taskId,
      task_run_id: taskRunId,
    },
    specialist,
    objective,
    context_bundle: contextBundle,
    inputs,
    expected_outputs: expectedOutputs,
    depends_on: dependsOn,
    permissions: {
      read: permissions.read ?? ["repo"],
      write: permissions.write ?? ["assigned_worktree"],
      network: permissions.network ?? "disabled_by_default",
      shell: permissions.shell ?? "approval_required",
      destructive: permissions.destructive ?? "approval_required",
    },
    budget: {
      max_turns: budget.maxTurns ?? 20,
      max_tokens: budget.maxTokens ?? 80000,
    },
    autonomy_policy: autonomyPolicy,
    loops_applicable: loopsApplicable,
    host: {
      requested: host.requested ?? "any",
      selected: null,
      capability_requirements: {
        needs_pr: capReqs.needsPr ?? false,
        needs_parallel: capReqs.needsParallel ?? false,
        needs_network: capReqs.needsNetwork ?? false,
        isolation: capReqs.isolation ?? "worktree",
      },
      model_params: host.modelParams ?? null,
    },
    trace: {
      events_ref: eventsRef,
    },
  };

  const doc: TaskRunDocument = { task_run: taskRun };

  const outPath = taskRunPath(cwd, runId, taskId);
  const yamlStr = loadYamlApi().dump(doc, {
    indent: 2,
    lineWidth: -1, // no forced line wraps
    quotingType: '"',
    forceQuotes: false,
  });
  // EXDEV fix: atomicWrite writes its temp file in the SAME directory as
  // `outPath` (never os.tmpdir()), so the rename is always same-filesystem.
  atomicWrite(outPath, yamlStr);

  // R-TRACE emit — guild.trace.dispatch.v1 (additive, try/catch)
  // emit-point: write-task-run.ts writeTaskRun(), after task_run file written
  // The task_run write is the canonical pre-dispatch gate (the orchestrator calls
  // this BEFORE each dispatch attempt per the module contract).
  try {
    const _traceRunDir = path.join(cwd, ".guild", "runs", runId);
    const _traceTs = new Date().toISOString();
    // task_run creation happens before host routing/dispatch, so the real backend
    // is not known yet. Keep the trace schema-valid without leaking host ids.
    const _traceBackend = "unknown";
    emitTraceEvent(
      makeDispatchEvent({
        ts: _traceTs,
        run_id: runId,
        lane_id: taskId,
        specialist,
        phase,
        task_id: taskId,
        backend: _traceBackend,
        backend_rung: 0, // not yet determined at write-task-run time
        dispatched_at: _traceTs,
      }),
      _traceRunDir,
    );
  } catch {
    // Trace must never affect task_run write — swallow silently
  }

  return outPath;
}

// ── CLI ──────────────────────────────────────────────────────────────────────

function parseArgs(argv: string[]): {
  cwd: string;
  runId: string;
  taskId: string;
  params: TaskRunParams;
} | { error: string } {
  let cwd = "";
  let runId = "";
  let taskId = "";
  let taskRunId = "trun-001";
  let specialist = "unknown";
  let objective = "";
  let contextBundle = "";
  let initiativeId: string | null = null;
  let phase = "execute";
  let dependsOnRaw = "";
  let autonomyPolicy: AutonomyPolicy = "autonomous_after_plan_approval";
  let loopsApplicable: LoopsApplicable = "none";
  let maxTurns = 20;
  let maxTokens = 80000;
  let hostRequested: TaskRunHostParams["requested"] = "any";
  let needsPr = false;
  let needsParallel = false;
  let needsNetwork = false;
  let isolation: "worktree" | "none" = "worktree";
  let modelParams: TaskRunModelParams | null = null;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    switch (a) {
      case "--cwd":           cwd = next; i++; break;
      case "--run-id":        runId = next; i++; break;
      case "--task-id":       taskId = next; i++; break;
      case "--task-run-id":   taskRunId = next; i++; break;
      case "--specialist":    specialist = next; i++; break;
      case "--objective":     objective = next; i++; break;
      case "--context-bundle": contextBundle = next; i++; break;
      case "--initiative-id": initiativeId = next; i++; break;
      case "--phase":         phase = next; i++; break;
      case "--depends-on":    dependsOnRaw = next; i++; break;
      case "--autonomy-policy": autonomyPolicy = next as AutonomyPolicy; i++; break;
      case "--loops-applicable": loopsApplicable = next as LoopsApplicable; i++; break;
      case "--host-requested": hostRequested = next as TaskRunHostParams["requested"]; i++; break;
      case "--max-turns":     maxTurns = parseInt(next, 10); i++; break;
      case "--max-tokens":    maxTokens = parseInt(next, 10); i++; break;
      case "--needs-pr":      needsPr = true; break;
      case "--needs-parallel": needsParallel = true; break;
      case "--needs-network": needsNetwork = true; break;
      case "--isolation":     isolation = next as "worktree" | "none"; i++; break;
      case "--model-params": {
        try {
          const parsed = JSON.parse(next) as TaskRunModelParams;
          if (parsed && typeof parsed.model === "string" && parsed.model.trim()) {
            modelParams = parsed;
          }
        } catch {
          return { error: "--model-params must be JSON with a non-empty model string" };
        }
        i++;
        break;
      }
    }
  }

  if (!cwd) return { error: "--cwd is required" };
  if (!runId) return { error: "--run-id is required" };
  if (!taskId) return { error: "--task-id is required" };

  const dependsOn = dependsOnRaw
    ? dependsOnRaw.split(",").map((s) => s.trim()).filter(Boolean)
    : [];

  return {
    cwd,
    runId,
    taskId,
    params: {
      initiativeId,
      taskRunId,
      specialist,
      objective,
      contextBundle,
      phase,
      dependsOn,
      autonomyPolicy,
      loopsApplicable,
      budget: { maxTurns, maxTokens },
      host: {
        requested: hostRequested,
        capabilityRequirements: { needsPr, needsParallel, needsNetwork, isolation },
        modelParams,
      },
    },
  };
}

export function runWriteTaskRunCli(argv: string[] = process.argv.slice(2)): void {
  const parsed = parseArgs(argv);
  if ("error" in parsed) {
    process.stderr.write(`[write-task-run] ${parsed.error}\n`);
    process.exit(1);
  }
  try {
    const outPath = writeTaskRun(parsed.cwd, parsed.runId, parsed.taskId, parsed.params);
    process.stdout.write(outPath + "\n");
    process.exit(0);
  } catch (err) {
    process.stderr.write(`[write-task-run] Error: ${err}\n`);
    process.exit(2);
  }
}

if (
  require.main === module &&
  new RegExp("[\\\\/]write-task-run\\.[cm]?[jt]s$").test(process.argv[1] ?? "")
) {
  runWriteTaskRunCli();
}
