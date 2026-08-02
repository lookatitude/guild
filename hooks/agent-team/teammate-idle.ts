#!/usr/bin/env -S npx tsx
/**
 * hooks/agent-team/teammate-idle.ts
 *
 * Event:   TeammateIdle
 * Purpose: Nudges an idle teammate whose assigned task is still incomplete.
 *          Reads run state and plan to identify staleness, then emits an
 *          actionable nudge message to stdout (the orchestrator consumes it).
 *          NEVER exits non-zero — no exit-code gating.
 *
 * Liveness check (ADR-RE-3 — structured heartbeat; replaces the mtime heuristic):
 *   A teammate is considered to have pending work if ANY assigned task lacks a
 *   handoff receipt at .guild/runs/<run-id>/handoffs/<teammate>-<task-id>.md.
 *
 *   Liveness ("is the agent still making progress?") is now read from a
 *   STRUCTURED heartbeat at .guild/runs/<run-id>/in-progress/<teammate>.json
 *   ({ timestamp, step, pct_complete, last_action }) — see hooks/lib/heartbeat.ts
 *   (decision bound by pointer). The verdict is `age(timestamp) < timeout`.
 *   G-10 (SC-5): the timeout is TIER-SCALED — the lane's tier from the
 *   run-state lane record picks the built-in default (cheap 180000 / mid
 *   600000 / powerful 1200000; unresolvable tier → mid, preserving the prior
 *   600000 threshold). An EXPLICITLY-SET `defaults.heartbeat_timeout_ms`
 *   always wins over the tier map (byte-identical for configs that set it).
 *   BACKWARD-COMPAT: when the JSON record is absent, fall back to the legacy
 *   <teammate>.log mtime (no hard cutover).
 *
 *   SCOPE BOUNDARY: this heartbeat is LIVENESS/stall detection only. It is NOT
 *   the deferred O-3 "anomalously short output" quality-escalation heuristic
 *   (cost-aware-tiering-and-lean-context.md O-3 → DEFER) — distinct signal,
 *   left deferred. Nothing here inspects output length or quality.
 *
 *   The nudge surfaces the heartbeat phase + staleness for orchestrator
 *   context but (P5 refinement, still deferred) does NOT yet gate the nudge on
 *   liveness — today: nudge on any pending task; report the liveness verdict.
 *   If the plan file (.guild/plan/*.md) or run state directory don't exist,
 *   the nudge is still emitted — conservative default.
 *
 * Stdin:   JSON — Claude Code TeammateIdle hook payload:
 *   {
 *     "session_id": string,
 *     "cwd": string,
 *     "hook_event_name": "TeammateIdle",
 *     "teammate_name"?: string,
 *     "team_name"?: string
 *   }
 *
 * Stdout:  Nudge message (consumed by the orchestrator).
 * Stderr:  Diagnostic info (never consumed by Claude Code).
 *
 * Manual usage:
 *   echo '{"hook_event_name":"TeammateIdle","teammate_name":"backend","team_name":"guild","session_id":"sess-abc123","cwd":"/path/to/project"}' \
 *     | CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 npx tsx hooks/agent-team/teammate-idle.ts
 */

import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";
import { resolveGuildRoot } from "../lib/guild-root.js";
import { resolveRunIdForTrace } from "../lib/run-trace.js";
import { validateHandoffV2, extractHandoffEnvelope } from "../lib/handoff-v2.js";
import {
  assessLiveness,
  resolveHeartbeatTimeoutMs,
  resolveLaneTier,
  Liveness,
} from "../lib/heartbeat.js";
import { emitBusEvent } from "../lib/bus-emit.js";
// T3b rework F3: the idle BUS EVENT is a runtime write and requires the
// verified caller-presented binding envelope (GUILD_RUN_ID +
// GUILD_RUN_BINDING_REF); receipt/liveness READS + the stdout nudge stay
// read-only and unauthenticated.
import { authorizeHookWrite, formatBindingRejected } from "../lib/hook-binding.js";
import {
  findRunAcceptances,
  readAssignmentForInstance,
  isTerminationAuthorized,
} from "../../src/modules/dispatch/workflows/task-cell-acceptance.js";

// ── Types ──────────────────────────────────────────────────────────────────

interface TeammateIdlePayload {
  session_id?: string;
  cwd?: string;
  hook_event_name?: string;
  teammate_name?: string;
  team_name?: string;
}

interface NudgeContext {
  teammate: string;
  teamName: string;
  runId: string;
  hasReceipt: boolean;
  /** Structured liveness verdict (ADR-RE-3): heartbeat → mtime fallback. */
  liveness: Liveness;
  /** Task IDs that have NO receipt file. */
  pendingTaskIds: string[];
  /**
   * Task IDs whose receipt exists but contains no valid guild.handoff.v2 envelope.
   * task-cell-runtime G4 (ADR D5): a valid receipt is `handoff_submitted`, NOT a
   * dismissal signal. Safe-to-dismiss is gated on a durable
   * `guild.handoff_acceptance.v1` record (see `acceptedLanes`), never on receipt
   * existence — the launcher keys off `[LANE-ACCEPTED]`, not receipt presence.
   */
  invalidReceiptTaskIds: string[];
  /** Task IDs whose receipt exists and has a valid guild.handoff.v2 envelope. */
  validReceiptTaskIds: string[];
  /** Full assessments for valid receipts (carries receiptPath + envelopeStatus). */
  validReceipts: ReceiptAssessment[];
  /**
   * task-cell-runtime G4 (ADR D5): the DURABLE termination-authorizing
   * `guild.handoff_acceptance.v1` records for THIS teammate's lanes. A lane is
   * safe to dismiss ONLY when such a record exists — never on receipt existence.
   * Empty means: even a valid receipt is only `handoff_submitted`, not accepted.
   */
  acceptedLanes: AcceptedLane[];
  runDir: string;
}

/** A durable acceptance record authorizing this teammate's termination (D5). */
interface AcceptedLane {
  logical_task_id: string;
  instance_id: string;
  /** Downstream is released only when the acceptance carries a release timestamp. */
  released: boolean;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function deriveRunId(sessionId: string, guildRoot: string): string {
  // GUILD_RUN_ID honored when the agent-team launcher sets it per pane; falls
  // back to "run-<session_id>" when the env is absent. T3b (session_context
  // §5): the sentinel leg is retired (resolveRunIdForTrace is env-only) — a
  // moved current-run-id can never redirect this hook.
  //
  // Rework F3: this derived id feeds READ-ONLY work ONLY — receipt/liveness
  // assessment and the stdout nudge text. It is NEVER a writer identity: the
  // idle bus event authorizes separately through authorizeHookWrite (verified
  // GUILD_RUN_ID + GUILD_RUN_BINDING_REF envelope), so the run-<session_id>
  // fallback can never name a write target.
  return (
    resolveRunIdForTrace(guildRoot, { GUILD_RUN_ID: process.env["GUILD_RUN_ID"] }) ??
    `run-${sessionId}`
  );
}

/** Per-receipt validity verdict used to build the nudge context. */
interface ReceiptAssessment {
  taskId: string;
  receiptPath: string;
  /** True iff the receipt contains a valid guild.handoff.v2 envelope. */
  envelopeValid: boolean;
  envelopeErrors: string[];
  /** Status from the validated envelope (present only when envelopeValid is true). */
  envelopeStatus?: string;
}

/**
 * Assess all handoff receipts already written for this teammate in this run.
 *
 * For each receipt file found at `<runDir>/handoffs/<teammate>-<task-id>.md`:
 *   - Extract the guild.handoff.v2 envelope (if present).
 *   - Validate it via validateHandoffV2.
 *   - Record valid/invalid verdict.
 *
 * A receipt with no envelope is recorded as invalid: the single-channel
 * protocol (R4a/P1-2) requires the envelope; a missing envelope means the
 * teammate has not yet completed the handoff.
 */
function assessReceipts(runDir: string, teammate: string): ReceiptAssessment[] {
  const handoffsDir = path.join(runDir, "handoffs");
  if (!fs.existsSync(handoffsDir)) return [];
  const prefix = `${teammate}-`;
  const results: ReceiptAssessment[] = [];
  const files = fs
    .readdirSync(handoffsDir)
    .filter((f) => f.startsWith(prefix) && f.endsWith(".md"));

  for (const file of files) {
    const taskId = file.slice(prefix.length, -".md".length);
    const rPath = path.join(handoffsDir, file);
    let envelopeValid = false;
    let envelopeErrors: string[] = [];
    let envelopeStatus: string | undefined;
    try {
      const content = fs.readFileSync(rPath, "utf8");
      const rawEnvelope = extractHandoffEnvelope(content);
      if (rawEnvelope !== null) {
        const result = validateHandoffV2(rawEnvelope);
        envelopeValid = result.valid;
        envelopeErrors = result.errors;
        if (result.valid) {
          const env = rawEnvelope as Record<string, unknown>;
          envelopeStatus = typeof env["status"] === "string" ? env["status"] : undefined;
        }
      } else {
        envelopeErrors = ["no guild.handoff.v2 envelope found in receipt"];
      }
    } catch (err) {
      envelopeErrors = [
        `could not read receipt: ${err instanceof Error ? err.message : String(err)}`,
      ];
    }
    results.push({ taskId, receiptPath: rPath, envelopeValid, envelopeErrors, envelopeStatus });
  }
  return results;
}

/**
 * Find task IDs assigned to this teammate in any plan file.
 */
function findAssignedTaskIds(cwd: string, teammate: string): string[] {
  const planDir = path.join(resolveGuildRoot(cwd), ".guild", "plan");
  if (!fs.existsSync(planDir)) return [];
  const files = fs.readdirSync(planDir).filter((f) => f.endsWith(".md"));
  const ids: string[] = [];
  for (const file of files) {
    const content = fs.readFileSync(path.join(planDir, file), "utf8");
    // Look for assignment patterns: "owner: <teammate>" or "assigned: <teammate>"
    // near a task ID line
    const blocks = content.split(/\n(?=[-*#]|\w)/);
    for (const block of blocks) {
      const isAssigned =
        new RegExp(`(?:owner|assigned|teammate):\\s*${teammate}\\b`, "i").test(block);
      if (isAssigned) {
        const idMatch = block.match(/\bid:\s*(task-[\w-]+)/i) ??
          block.match(/^\s*[-*]\s*(task-[\w-]+):/im);
        if (idMatch) ids.push(idMatch[1]);
      }
    }
  }
  return ids;
}

/**
 * task-cell-runtime G4 (ADR D5): resolve the DURABLE acceptance records that
 * authorize THIS teammate's termination. Walks `.guild/runs/<run>/task-cells/**`
 * for `guild.handoff_acceptance.v1` records and keeps those whose sibling
 * `guild.task_assignment.v2` binds `worker_role === teammate` AND that carry a
 * `termination_authorized_at`. Receipt existence is deliberately NOT consulted:
 * only the acceptance record makes a lane safe to dismiss.
 */
function resolveAcceptedLanes(guildRoot: string, runId: string, teammate: string): AcceptedLane[] {
  const out: AcceptedLane[] = [];
  for (const { ids, acceptance } of findRunAcceptances(guildRoot, runId)) {
    if (!isTerminationAuthorized(acceptance)) continue;
    const assignment = readAssignmentForInstance(guildRoot, ids);
    if (!assignment || assignment.worker_role !== teammate) continue;
    out.push({
      logical_task_id: ids.logical_task_id,
      instance_id: ids.instance_id,
      released: acceptance.downstream_release_at !== null,
    });
  }
  return out;
}

/**
 * Render the structured liveness verdict (ADR-RE-3) as a one-line context
 * string for the nudge. Surfaces the heartbeat phase + age, or the mtime
 * fallback, or "no heartbeat".
 */
function renderLiveness(liveness: Liveness): string {
  if (liveness.source === "none") {
    return `liveness: no heartbeat or progress log found (cannot confirm activity)`;
  }
  const ageSec = liveness.ageMs !== null ? Math.round(liveness.ageMs / 1000) : "?";
  const freshness = liveness.fresh ? "FRESH (active)" : "STALE (possible stall)";
  if (liveness.source === "heartbeat") {
    const phase = liveness.step ? ` phase="${liveness.step}"` : "";
    const pct = liveness.pctComplete !== undefined ? ` ${liveness.pctComplete}%` : "";
    return `liveness: heartbeat ${freshness}, last progress ${ageSec}s ago${phase}${pct}`;
  }
  return `liveness: legacy log mtime ${freshness}, last touched ${ageSec}s ago (no structured heartbeat)`;
}

/**
 * Compose a clear, actionable nudge message for the orchestrator.
 *
 * R4a (P1-2) single-channel enforcement:
 *
 *   • LANE-ACCEPTED / safe-to-dismiss — emitted ONLY when a durable
 *     guild.handoff_acceptance.v1 record authorizing termination exists for this
 *     teammate (task-cell-runtime G4, ADR D5). The launcher keys off the
 *     "[LANE-ACCEPTED]" sentinel to perform the REAL, confirmed termination.
 *
 *   • LANE-SUBMITTED / awaiting-acceptance — emitted when a valid receipt exists
 *     but NO acceptance record does yet: the lane is handoff_submitted, NOT
 *     dismissible (D5 — a receipt on disk releases nothing).
 *
 *   • Specific receipt nudge — emitted when tasks have no receipt or the
 *     receipt lacks a valid guild.handoff.v2 envelope.  Includes the EXACT
 *     canonical path and "do not paste it in chat" to enforce the
 *     single-channel rule (R1/R2 — file receipt is the source of truth).
 *
 *   • Conservative nudge — emitted when no plan file exists and no receipts
 *     have been written; includes the canonical path template and the
 *     single-channel reminder.
 *
 * The structured-heartbeat liveness verdict (ADR-RE-3) is always included so
 * the orchestrator can distinguish a fast-iterating agent from a genuine stall.
 */
function composeNudge(ctx: NudgeContext): string {
  const timestamp = new Date().toISOString();
  const livenessLine = renderLiveness(ctx.liveness);

  const hasPending = ctx.pendingTaskIds.length > 0;
  const hasInvalid = ctx.invalidReceiptTaskIds.length > 0;
  const hasValid = ctx.validReceiptTaskIds.length > 0;
  const hasAcceptance = ctx.acceptedLanes.length > 0;

  // ── task-cell-runtime G4 (ADR D5): acceptance-GATED dismissal signal ────────
  // A lane is safe to dismiss ONLY when a durable `guild.handoff_acceptance.v1`
  // authorizing termination exists — NEVER on receipt existence (the P0.4
  // false-positive channel the old receipt-gated `[AUTO-DISMISS]` was). The
  // launcher's `--dismiss-completed` performs the REAL, confirmed termination; this
  // hook only surfaces the acceptance-backed `[LANE-ACCEPTED]` sentinel. Always
  // exit-0 — non-gating.
  if (hasAcceptance && !hasPending) {
    const authLines = ctx.acceptedLanes
      .map(
        (a) =>
          `[TERMINATE-AUTHORIZED] teammate="${ctx.teammate}" team="${ctx.teamName}" ` +
          `logical_task=${a.logical_task_id} instance=${a.instance_id} ` +
          `downstream=${a.released ? "released" : "blocked"}`
      )
      .join("\n");
    return (
      `[TeammateIdle ${timestamp}] ` +
      `[LANE-ACCEPTED] teammate="${ctx.teammate}" team="${ctx.teamName}" ` +
      `status=safe-to-dismiss\n` +
      `${livenessLine}\n` +
      `Durable guild.handoff_acceptance.v1 record(s) authorize termination for ` +
      `${ctx.acceptedLanes.length} lane(s).\n` +
      `${authLines}\n` +
      `The launcher may safely terminate this pane (guild.handoff_acceptance.v1 exists).\n`
    );
  }

  // ── Valid receipt but NOT yet accepted → handoff_submitted, NOT dismissible ──
  // Closes the receipt-existence false positive: a receipt is the worker's OUTPUT,
  // not an acceptance. Downstream stays blocked and the pane stays up until a
  // durable acceptance record lands (D5).
  if (hasValid && !hasPending && !hasInvalid && !hasAcceptance) {
    const pointerLines = ctx.validReceipts
      .map(
        (r) =>
          `submitted · ${r.taskId} · status:${r.envelopeStatus ?? "done"} · receipt:${r.receiptPath}`
      )
      .join("\n");
    return (
      `[TeammateIdle ${timestamp}] ` +
      `[LANE-SUBMITTED] teammate="${ctx.teammate}" team="${ctx.teamName}" ` +
      `status=awaiting-acceptance\n` +
      `${livenessLine}\n` +
      `Valid guild.handoff.v2 receipt(s) confirmed, but NO durable ` +
      `guild.handoff_acceptance.v1 record yet — the lane is handoff_submitted, ` +
      `NOT safe to dismiss (D5: receipts release nothing).\n` +
      `${pointerLines}\n` +
      `Awaiting the acceptance authority (deterministic floor + Team Lead + any ` +
      `reviewer cell) before the launcher may terminate this pane.\n`
    );
  }

  // ── R4a: missing receipt — specific, actionable nudge ──────────────────────
  if (hasPending) {
    const paths = ctx.pendingTaskIds
      .map((tid) => `${ctx.runDir}/handoffs/${ctx.teammate}-${tid}.md`)
      .join(", ");
    return (
      `[TeammateIdle ${timestamp}] ` +
      `Teammate "${ctx.teammate}" (team: "${ctx.teamName}") is idle but has ` +
      `${ctx.pendingTaskIds.length} incomplete task(s): [${ctx.pendingTaskIds.join(", ")}].\n` +
      `${livenessLine}\n` +
      `write your guild.handoff.v2 receipt to ${paths}; do not paste it in chat.\n` +
      `Required sections: changed_files, opens_for, assumptions, evidence, followups.\n` +
      `Required format: a strict fenced JSON block (the envelope is JSON inside the fenced block, NOT YAML frontmatter; a frontmatter-only receipt is rejected):\n` +
      `\`\`\`guild.handoff.v2\n` +
      `{ "schema_version": "guild.handoff.v2", "task_id": "...", "tier": "cheap|mid|powerful", "status": "done|blocked|escalate", "summary": "...", "artifacts": [], "issues": [] }\n` +
      `\`\`\`\n` +
      `Or, if still working, update the structured heartbeat at ` +
      `${ctx.runDir}/in-progress/${ctx.teammate}.json ` +
      `({ timestamp, step, pct_complete, last_action }) to signal progress.\n`
    );
  }

  // ── R4a: receipt exists but envelope missing/invalid ───────────────────────
  if (hasInvalid) {
    const paths = ctx.invalidReceiptTaskIds
      .map((tid) => `${ctx.runDir}/handoffs/${ctx.teammate}-${tid}.md`)
      .join(", ");
    return (
      `[TeammateIdle ${timestamp}] ` +
      `Teammate "${ctx.teammate}" (team: "${ctx.teamName}") has a receipt but the ` +
      `guild.handoff.v2 envelope is missing or invalid.\n` +
      `${livenessLine}\n` +
      `write your guild.handoff.v2 receipt to ${paths}; do not paste it in chat.\n` +
      `Required format: a strict fenced JSON block (the envelope is JSON inside the fenced block, NOT YAML frontmatter; a frontmatter-only receipt is rejected):\n` +
      `\`\`\`guild.handoff.v2\n` +
      `{ "schema_version": "guild.handoff.v2", "task_id": "...", "tier": "cheap|mid|powerful", "status": "done|blocked|escalate", "summary": "...", "artifacts": [], "issues": [] }\n` +
      `\`\`\`\n`
    );
  }

  // ── Conservative nudge: no plan, no receipts ───────────────────────────────
  // Use GUILD_TASK_ID env var (set by the launcher) for a more specific path.
  const taskIdHint = process.env["GUILD_TASK_ID"] ?? "<task-id>";
  return (
    `[TeammateIdle ${timestamp}] ` +
    `Teammate "${ctx.teammate}" (team: "${ctx.teamName}") is idle.\n` +
    `${livenessLine}\n` +
    `If you have an active task, write your guild.handoff.v2 receipt to ` +
    `${ctx.runDir}/handoffs/${ctx.teammate}-${taskIdHint}.md; do not paste it in chat.\n` +
    `Required sections: changed_files, opens_for, assumptions, evidence, followups.\n` +
    `Required format: a strict fenced JSON block (the envelope is JSON inside the fenced block, NOT YAML frontmatter; a frontmatter-only receipt is rejected):\n` +
    `\`\`\`guild.handoff.v2\n` +
    `{ "schema_version": "guild.handoff.v2", "task_id": "...", "tier": "cheap|mid|powerful", "status": "done|blocked|escalate", "summary": "...", "artifacts": [], "issues": [] }\n` +
    `\`\`\`\n` +
    `Heartbeat path: ${ctx.runDir}/in-progress/${ctx.teammate}.json ` +
    `({ timestamp, step, pct_complete, last_action }).\n` +
    `If all tasks are complete, no action is needed.\n`
  );
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // Opt-in gate — but always exits 0
  const agentTeamEnabled = process.env["CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS"] === "1";
  if (!agentTeamEnabled) {
    process.exit(0);
  }

  // Read JSON payload from stdin
  const rl = readline.createInterface({ input: process.stdin });
  const lines: string[] = [];
  for await (const line of rl) {
    lines.push(line);
  }
  const raw = lines.join("\n").trim();

  let payload: TeammateIdlePayload;
  try {
    payload = JSON.parse(raw) as TeammateIdlePayload;
  } catch {
    process.stderr.write(`[teammate-idle] WARN: Invalid JSON on stdin: ${raw.slice(0, 120)}\n`);
    // Always exits 0 — no gating
    process.exit(0);
  }

  const sessionId = payload.session_id ?? "unknown";
  const teammate = (payload.teammate_name ?? "").trim() || "unknown";
  const teamName = (payload.team_name ?? "").trim() || "unknown";
  const cwd = payload.cwd ?? process.cwd();

  const guildRootForRun = resolveGuildRoot(cwd);
  const runId = deriveRunId(sessionId, guildRootForRun);
  const runDir = path.join(guildRootForRun, ".guild", "runs", runId);

  // Gather context — assess receipt validity first (R4a).
  const receiptAssessments = assessReceipts(runDir, teammate);
  const validReceiptTaskIds = receiptAssessments
    .filter((r) => r.envelopeValid)
    .map((r) => r.taskId);
  const invalidReceiptTaskIds = receiptAssessments
    .filter((r) => !r.envelopeValid)
    .map((r) => r.taskId);
  const completedIds = new Set(receiptAssessments.map((r) => r.taskId));
  const assignedIds = findAssignedTaskIds(cwd, teammate);
  const pendingTaskIds = assignedIds.filter((id) => !completedIds.has(id));
  const hasReceipt = receiptAssessments.length > 0;

  // Liveness via the structured heartbeat (ADR-RE-3), mtime fallback baked in.
  // G-10 (SC-5): tier-scaled timeout — lane tier from the run-state lane
  // record (cheap 3m / mid 10m / powerful 20m); an EXPLICIT
  // defaults.heartbeat_timeout_ms in settings.json still wins when set, and
  // an unresolvable tier falls back to mid (byte-identical to the old default).
  const laneTier = resolveLaneTier(runDir, teammate, assignedIds);
  const timeoutMs = resolveHeartbeatTimeoutMs(cwd, laneTier);
  const liveness = assessLiveness(runDir, teammate, timeoutMs);

  // task-cell-runtime G4 (ADR D5): the acceptance-record gate. Best-effort +
  // non-throwing — a missing/garbled task-cell tree yields no accepted lanes, so a
  // valid receipt without an acceptance record stays `handoff_submitted`.
  let acceptedLanes: AcceptedLane[] = [];
  try {
    acceptedLanes = resolveAcceptedLanes(guildRootForRun, runId, teammate);
  } catch (err) {
    process.stderr.write(
      `[teammate-idle] WARN: acceptance-gate lookup failed (non-fatal): ` +
        `${err instanceof Error ? err.message : String(err)}\n`
    );
  }

  process.stderr.write(
    `[teammate-idle] INFO: teammate="${teammate}" assigned=[${assignedIds.join(",")}] ` +
      `validReceipts=[${validReceiptTaskIds.join(",")}] ` +
      `invalidReceipts=[${invalidReceiptTaskIds.join(",")}] ` +
      `pending=[${pendingTaskIds.join(",")}] ` +
      `acceptedLanes=[${acceptedLanes.map((a) => a.logical_task_id).join(",")}] ` +
      `liveness=${liveness.source}/${liveness.fresh ? "fresh" : "stale"} ` +
      `ageMs=${liveness.ageMs ?? "n/a"} timeoutMs=${timeoutMs} ` +
      `tier=${laneTier ?? "unresolved(mid-fallback)"}\n`
  );

  const validReceipts = receiptAssessments.filter((r) => r.envelopeValid);

  const ctx: NudgeContext = {
    teammate,
    teamName,
    runId,
    hasReceipt,
    liveness,
    pendingTaskIds,
    invalidReceiptTaskIds,
    validReceiptTaskIds,
    validReceipts,
    acceptedLanes,
    runDir,
  };

  // Emit nudge to stdout (orchestrator consumes it) — read-only leg, always runs.
  process.stdout.write(composeNudge(ctx));

  // Emit idle bus event (SK-5 / CMD-007: agent-bus producer). Best-effort —
  // never blocks. Rework F3: this is a RUNTIME WRITE — it requires the
  // verified caller-presented binding envelope (session_context §5). The
  // write target derives from the VERIFIED run id, never from the
  // session_id fallback: an absent/blank/closed/mismatched envelope refuses
  // (binding_rejected, no write), and a bare session can never fabricate a
  // run-<session_id> bus file.
  const writeAuth = authorizeHookWrite(guildRootForRun);
  if (writeAuth.ok === true) {
    const boundRunDir = path.join(guildRootForRun, ".guild", "runs", writeAuth.run_id);
    emitBusEvent(boundRunDir, {
      run_id: writeAuth.run_id,
      event: "idle",
      lane_id: teammate,
      team_name: teamName !== "unknown" ? teamName : undefined,
      detail: ctx.pendingTaskIds.length > 0
        ? `pending tasks: [${ctx.pendingTaskIds.join(", ")}]`
        : undefined,
    });
  } else {
    process.stderr.write(formatBindingRejected("teammate-idle", writeAuth));
  }

  // Always exit 0 — no exit-code gating
  process.exit(0);
}

main().catch((err: unknown) => {
  process.stderr.write(
    `[teammate-idle] FATAL: ${err instanceof Error ? err.message : String(err)}\n`
  );
  // Always exits 0 — no gating
  process.exit(0);
});
