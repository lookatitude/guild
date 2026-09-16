/**
 * Structural isolation for the T0/T1/T2 split (KTD19, KTD28).
 *
 * "Structural" is the whole claim. Telling a specialist in prose not to message
 * the orchestrator is advisory and a model can ignore it; this module makes the
 * attempt fail at the seam. Two rails:
 *
 *  1. **Tool projection.** The assignment projects a tool set. A call to a tool
 *     outside it is REFUSED, and an isolated worker whose host cannot project a
 *     reduced tool set is refused a spawn entirely — never handed full tools and
 *     a comment. KTD28: "Unprojected tools never given to an isolated worker."
 *  2. **Private bus.** Each instance's channels live under its own instance dir
 *     inside the run tree (D6 containment). A specialist addressing the
 *     orchestrator, or a sibling specialist, is a DEFECT, not a degraded mode:
 *     the lead is the only upward edge and `guild.goal_status.v1` the only
 *     envelope that crosses it.
 *
 * The fallback when a host cannot project: `lead_only` in the parent, with the
 * lost isolation RECORDED. A recorded loss is honest; a silent one is the thing
 * the adapter matrix exists to prevent.
 */
import * as fs from "fs";
import * as path from "path";

import { deepFreeze, frozenList, TIER_BUS_CONTRACT } from "../../kernel";
import {
  taskCellPaths,
  validateTaskAssignmentV2,
  type TaskAssignmentV2,
} from "./task-cell-contract";

// The T0/T1/T2 bus contract lives in the kernel so the artifact bus (communication)
// can enforce it without closing a dispatch↔communication cycle. Re-exported here
// because `dispatch` is where callers look for the isolation surface.
export {
  BUS_TIERS,
  LEAD_ROLE_IDS,
  busRefused,
  busTierForRole,
  busTierForTopic,
  checkBusMessage,
  checkBusPublish,
  type BusDefect,
  type BusMessage,
  type BusTier,
  type BusVerdict,
} from "../../kernel";

// ── Tool projection ──────────────────────────────────────────────────────────

export type ToolProjectionVerdict =
  | { ok: true }
  | { ok: false; reason: string; refusal: "off_projection" | "unprojectable_isolated_spawn" };

export interface ProjectedToolCheck {
  /** The assignment's projected tool set. */
  projection: { tools: readonly string[] };
  /** The tool the worker is trying to call. */
  tool: string;
  /**
   * True when this instance is an ISOLATED worker (a spawned T2), false when the
   * cell collapsed to `lead_only` and runs in the parent's full-tool context.
   */
  isolated: boolean;
}

/**
 * Fail-closed projection check.
 *
 * An isolated worker with an EMPTY projection is refused rather than waved
 * through: empty means the dispatch declared no tool scope, and "no scope" for
 * an isolated worker is the unprojected case KTD28 forbids. A `lead_only` cell
 * with an empty projection is unscoped by design — it is the parent session.
 */
export function checkProjectedTool(input: ProjectedToolCheck): ToolProjectionVerdict {
  const tools = input.projection.tools ?? [];
  if (input.isolated && tools.length === 0) {
    return {
      ok: false,
      refusal: "unprojectable_isolated_spawn",
      reason:
        "isolated worker has an empty tool projection — refusing to hand an " +
        "isolated specialist unprojected tools (KTD28). Fall back to lead_only " +
        "in the parent and record the isolation loss.",
    };
  }
  if (tools.length === 0) return { ok: true };
  if (tools.includes(input.tool)) return { ok: true };
  return {
    ok: false,
    refusal: "off_projection",
    reason:
      `${input.tool} is outside this assignment's tool projection ` +
      `[${tools.join(", ")}] — refused. The projection is the worker's whole ` +
      `authority; a tool absent from it was never granted.`,
  };
}

/** Narrowing predicate for the refusal arm (see `capRefused` for why). */
export function projectionRefused(
  verdict: ToolProjectionVerdict,
): verdict is Extract<ToolProjectionVerdict, { ok: false }> {
  return !verdict.ok;
}

/**
 * A delivered projection may only NARROW the one the instance was spawned under.
 *
 * This is the hole the round-1 review found: `deliverAssignment` validated the
 * assignment's shape but never compared its projection to the instance's, so a
 * cell spawned with `["Read"]` could be handed an assignment carrying
 * `["Read", "Bash"]` and the widened set became the worker's authority. The
 * projection is fixed at spawn; an assignment can drop tools from it, never add.
 */
export function projectionNarrowsOnly(input: {
  spawned: { tools: readonly string[] };
  delivered: { tools: readonly string[] };
}): ToolProjectionVerdict {
  const spawned = input.spawned.tools ?? [];
  const delivered = input.delivered.tools ?? [];
  // An unscoped spawn (lead_only in the parent) has nothing to narrow from.
  if (spawned.length === 0) return { ok: true };
  const widened = delivered.filter((t) => !spawned.includes(t));
  if (widened.length === 0) return { ok: true };
  return {
    ok: false,
    refusal: "off_projection",
    reason:
      `assignment widens the instance's tool projection with ` +
      `[${widened.join(", ")}] — the projection is fixed at spawn ` +
      `([${spawned.join(", ")}]) and an assignment may only narrow it (KTD28).`,
  };
}

/**
 * The PRODUCTION tool-call gate: resolve the worker's own assignment from the
 * run tree and refuse anything outside its projection.
 *
 * Disk-backed on purpose. The caller is the host adapter's PreToolUse seam, which
 * holds only the env identity of the worker making the call — it has no runtime
 * object and must not be trusted to pass its own projection in.
 */
export function authorizeProjectedToolCall(input: {
  cwd: string;
  run_id: string;
  logical_task_id: string;
  attempt: number;
  instance_id: string;
  tool: string;
  /** False only for a `lead_only` cell running in the parent's own context. */
  isolated?: boolean;
  guildDir?: string;
}): ToolProjectionVerdict {
  const paths = taskCellPaths(
    {
      run_id: input.run_id,
      logical_task_id: input.logical_task_id,
      attempt: input.attempt,
      instance_id: input.instance_id,
    },
    { guildDir: input.guildDir },
  );
  // Read through the pure contract validator rather than the dispatch reader:
  // the caller is the host's PreToolUse hook, and pulling the dispatch module's
  // import graph into that hot path would cost far more than this check saves.
  let assignment: TaskAssignmentV2 | null = null;
  try {
    assignment = validateTaskAssignmentV2(
      JSON.parse(fs.readFileSync(path.resolve(input.cwd, paths.assignment_path), "utf8")),
    );
  } catch {
    assignment = null;
  }
  if (!assignment) {
    return {
      ok: false,
      refusal: "off_projection",
      reason:
        `no readable guild.task_assignment.v2 for instance ${input.instance_id} ` +
        `— refusing the tool call. A worker with no assignment has no projected ` +
        `authority to call anything (fail-closed).`,
    };
  }
  return checkProjectedTool({
    projection: assignment.projection,
    tool: input.tool,
    isolated: input.isolated ?? true,
  });
}

export type IsolatedSpawnVerdict =
  | { ok: true; mode: "isolated" }
  | { ok: true; mode: "lead_only"; recorded_loss: string }
  | { ok: false; reason: string };

/**
 * The spawn-time half of KTD28. A host whose `tool_projection` rung is missing
 * cannot isolate, so an isolated spawn is refused and the cell collapses to
 * `lead_only` in the parent with the loss recorded — the one substitution the
 * adapter matrix names.
 */
export function resolveIsolatedSpawn(input: {
  /** Host rung for tool projection: absent/`"skip-recorded"` means it cannot project. */
  tool_projection_rung: string | null;
  /** The projection the assignment wants to apply. */
  projection: { tools: readonly string[] };
  /** Whether the cell asked for isolation at all. */
  wants_isolation: boolean;
}): IsolatedSpawnVerdict {
  if (!input.wants_isolation) return { ok: true, mode: "isolated" };
  const rung = input.tool_projection_rung;
  const canProject = rung === "native" || rung === "wrapped" || rung === "bridged";
  if (canProject) {
    const gate = checkProjectedTool({
      projection: input.projection,
      tool: "__spawn__",
      isolated: true,
    });
    if (projectionRefused(gate) && gate.refusal === "unprojectable_isolated_spawn") {
      return { ok: false, reason: gate.reason };
    }
    return { ok: true, mode: "isolated" };
  }
  return {
    ok: true,
    mode: "lead_only",
    recorded_loss:
      `tool_projection rung ${JSON.stringify(rung)} cannot project a reduced tool ` +
      `set; isolated spawn refused and the cell bound to the parent as lead_only ` +
      `with the isolation loss recorded (KTD28).`,
  };
}

/**
 * The channel set one instance may touch. Everything is inside its own instance
 * directory, so "private bus" is a filesystem fact a containment check can prove,
 * not a convention.
 */
export function privateBusChannels(assignment: TaskAssignmentV2): readonly string[] {
  return frozenList([
    assignment.assignment_path,
    assignment.handoff_path,
    assignment.heartbeat_path,
    assignment.cancel_channel,
  ]);
}

export type BusPathVerdict = { ok: true } | { ok: false; reason: string };

/** Refuse a worker reading or writing a channel that is not its own. */
export function checkBusChannel(assignment: TaskAssignmentV2, channelPath: string): BusPathVerdict {
  const own = privateBusChannels(assignment);
  if (own.includes(channelPath)) return { ok: true };
  const paths = taskCellPaths({
    run_id: assignment.run_id,
    logical_task_id: assignment.logical_task_id,
    attempt: assignment.attempt,
    instance_id: assignment.instance_id,
  });
  return {
    ok: false,
    reason:
      `${channelPath} is not a channel of instance ${assignment.instance_id} ` +
      `(private bus is ${paths.instance_dir}) — refused.`,
  };
}

export const ISOLATION_CONTRACT = deepFreeze({
  projection: "fixed at spawn; an assignment may only narrow it",
  tool_gate: "authorizeProjectedToolCall (PreToolUse seam, disk-backed)",
  bus: TIER_BUS_CONTRACT,
});
