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
import * as os from "os";
import * as path from "path";
import * as yaml from "js-yaml";

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

export interface TaskRunHost {
  requested: "claude-code" | "codex-local" | "codex-cloud" | "any";
  /** Filled in by the router AFTER routing; null until then. */
  selected: string | null;
  capability_requirements: TaskRunCapabilityRequirements;
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
    },
    trace: {
      events_ref: eventsRef,
    },
  };

  const doc: TaskRunDocument = { task_run: taskRun };

  const outPath = taskRunPath(cwd, runId, taskId);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  // Atomic write: write to a temp file in the system temp dir, then rename.
  const tmpPath = path.join(
    os.tmpdir(),
    `guild-task-run-${process.pid}-${Date.now()}.yaml.tmp`
  );
  const yamlStr = yaml.dump(doc, {
    indent: 2,
    lineWidth: -1, // no forced line wraps
    quotingType: '"',
    forceQuotes: false,
  });
  fs.writeFileSync(tmpPath, yamlStr, "utf8");
  fs.renameSync(tmpPath, outPath);

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
      dependsOn,
      autonomyPolicy,
      loopsApplicable,
      budget: { maxTurns, maxTokens },
      host: {
        requested: hostRequested,
        capabilityRequirements: { needsPr, needsParallel, needsNetwork, isolation },
      },
    },
  };
}

if (require.main === module) {
  const parsed = parseArgs(process.argv.slice(2));
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
