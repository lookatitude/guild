#!/usr/bin/env -S npx tsx
/**
 * hooks/agent-team/task-completed.ts
 *
 * Event:   TaskCompleted
 * Purpose:
 *   1. Validates a `guild.handoff.v2` envelope in the agent's handoff receipt,
 *      extracting `learnings[]` into the run record under
 *      `.guild/runs/<run-id>/learnings/<specialist>-<task-id>.json`.
 *   2. Rejects (exit non-zero) if the envelope is invalid or fails the
 *      lint/bloat check (SC-7 / VC-7).
 *   3. For backwards compatibility, also checks that the markdown receipt at
 *      `.guild/runs/<run-id>/handoffs/<specialist>-<task-id>.md` exists and
 *      has the §8.2 required sections (changed_files, opens_for, assumptions,
 *      evidence, followups).
 *   4. Persists the run-state checkpoint (`guild.run_state.v1`, ADR-RE-1) at
 *      `.guild/runs/<run-id>/run-state.json`: after the lane terminates it
 *      upserts `lanes[task-id]` with the terminal status (done / failed),
 *      depends_on (best-effort from the payload), the receipt pointer, and the
 *      resolved tier. Atomic temp-then-rename under the per-run `.lock`
 *      discipline (see hooks/lib/run-state.ts — contract bound by pointer). The
 *      `in_progress` transition is DISPATCH-owned (the agent-team launcher, via
 *      `markLaneInProgress`); there is no "TaskStarted" hook event. The
 *      checkpoint is a rebuildable speed-cache (never the system of record), so
 *      a write failure here is non-fatal — the receipt remains authoritative.
 *   5. Signals §task§agent dismiss (no idle): on a clean pass the agent
 *      terminates — no idle agents persist (ADR §6 D3).
 *
 * Stdin:   JSON — Claude Code TaskCompleted hook payload:
 *   {
 *     "session_id": string,
 *     "cwd": string,
 *     "hook_event_name": "TaskCompleted",
 *     "task_id": string,
 *     "task_subject": string,
 *     "task_description"?: string,
 *     "teammate_name"?: string,
 *     "team_name"?: string
 *   }
 *
 * Stdout:  Silent (Claude Code may consume stdout).
 * Stderr:  Human-readable reason if blocking.
 *
 * Run ID derivation: GUILD_RUN_ID env var (set by launcher) OR "run-<session_id>".
 *
 * Manual usage:
 *   echo '{"hook_event_name":"TaskCompleted","task_id":"task-001","session_id":"sess-abc123",
 *          "cwd":"/path/to/project","teammate_name":"backend","team_name":"guild"}' \
 *     | CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 npx tsx hooks/agent-team/task-completed.ts
 */

import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";
import { resolveGuildRoot } from "../lib/guild-root.js";
import { validateHandoffV2, extractHandoffEnvelope, HandoffV2 } from "../lib/handoff-v2.js";
import {
  POLICY_EFFECTIVE_DATE,
  isRunInScope,
  RunScopeResult,
} from "../lib/run-date.js";
import {
  upsertLane,
  LaneStatus,
  LaneTier,
  LanePatch,
  RunStateInit,
} from "../lib/run-state.js";
import { classifyEnvelope, type InjectionClean } from "../lib/security/injection-guard.js";
import {
  buildSecurityEvent,
  appendSecurityEvent,
} from "../lib/security/events.js";
import { scrubbedWrite, writeScrubApprovalRequest } from "../lib/security/scrubbed-write.js";
import { applySecretsPolicy } from "../lib/security/secrets.js";
import { readSecurityConfig } from "../lib/security/config.js";
import { emitBusEvent } from "../lib/bus-emit.js";
import { processFanout } from "../../scripts/lib/artifact-bus";
import {
  evaluateContextCompliance,
  recordContextCompliance,
} from "../lib/context-compliance.js";

// ── Types ──────────────────────────────────────────────────────────────────

interface TaskCompletedPayload {
  session_id?: string;
  cwd?: string;
  hook_event_name?: string;
  task_id?: string;
  task_subject?: string;
  task_description?: string;
  teammate_name?: string;
  team_name?: string;
}

// ── Constants ──────────────────────────────────────────────────────────────

// POLICY_EFFECTIVE_DATE is imported from ../lib/run-date.ts — it is the SINGLE
// named constant for the OD-4 enforcement boundary. Canonical source:
//   docs/knowledge/decisions/communication-format-policy.md §"policy_effective_date"

/**
 * §8.2 required fields that every handoff receipt markdown must contain.
 * Keys must appear as markdown headings or YAML-style labels.
 */
const REQUIRED_FIELDS: ReadonlyArray<string> = [
  "changed_files",
  "opens_for",
  "assumptions",
  "evidence",
  "followups",
];

// ── Helpers ────────────────────────────────────────────────────────────────

function die(reason: string): never {
  process.stderr.write(`[task-completed] BLOCKED: ${reason}\n`);
  process.exit(1);
}

/**
 * Derive run ID. Honors GUILD_RUN_ID env var if set (agent-team launcher
 * exports it per pane so hooks converge on the launcher's session manifest
 * path). Falls back to "run-<session_id>" otherwise.
 */
function deriveRunId(sessionId: string): string {
  return process.env["GUILD_RUN_ID"] ?? `run-${sessionId}`;
}

/**
 * Locate the handoff receipt markdown for specialist+task in the run directory.
 * Path: <guild-root>/.guild/runs/<run-id>/handoffs/<specialist>-<task-id>.md
 */
function receiptPath(guildRoot: string, runId: string, specialist: string, taskId: string): string {
  return path.join(guildRoot, ".guild", "runs", runId, "handoffs", `${specialist}-${taskId}.md`);
}

/**
 * Locate the learnings output path for the run record.
 * Path: <guild-root>/.guild/runs/<run-id>/learnings/<specialist>-<task-id>.json
 */
function learningsPath(
  guildRoot: string,
  runId: string,
  specialist: string,
  taskId: string
): string {
  return path.join(guildRoot, ".guild", "runs", runId, "learnings", `${specialist}-${taskId}.json`);
}

/**
 * Check whether a markdown receipt contains all required §8.2 sections.
 * Accepts markdown heading form (## changed_files) or label form (changed_files:).
 */
function missingFields(content: string): string[] {
  return REQUIRED_FIELDS.filter((field) => {
    const pattern = new RegExp(`(?:^##?\\s+${field}\\b|^${field}\\s*:)`, "im");
    return !pattern.test(content);
  });
}

// extractHandoffEnvelope imported from hooks/lib/handoff-v2.ts (shared with teammate-idle.ts).
// R4b (P1-2): this validation runs for ALL dispatch paths — execute-plan AND agent-team/tmux.
// It is NOT execute-plan-only. Any TaskCompleted event with CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1
// goes through this validation regardless of how the task was dispatched.

/**
 * Write learnings from a valid `guild.handoff.v2` envelope into the run record.
 * Silently skips if no learnings are present.
 *
 * HK-06: routes the write through `scrubbedWrite` (the D-SECRETS durable-write
 * choke-point) instead of raw fs.writeFileSync. Surface: "learnings" → fail-CLOSED
 * by default (on scrub failure the file does NOT land; secret_scrub_blocked event
 * is emitted; approval_request written for human review).
 */
function persistLearnings(
  envelope: HandoffV2,
  outPath: string,
  specialist: string,
  taskId: string,
  runDir: string,
  runId: string,
): void {
  if (!envelope.learnings || envelope.learnings.length === 0) return;

  const record = {
    schema_version: "guild.learnings.v1",
    task_id: taskId,
    specialist,
    tier: envelope.tier,
    timestamp: new Date().toISOString(),
    learnings: envelope.learnings,
  };

  const content = JSON.stringify(record, null, 2) + "\n";
  // HK-06: scrubbedWrite handles mkdirSync + scrub-then-write atomically.
  // fail-CLOSED: on scrub failure the file does NOT land (fs.existsSync === false).
  const writeResult = scrubbedWrite(outPath, content, {
    surface: "learnings",
    runDir,
    runId,
    laneId: specialist,
  });
  if (writeResult.written) {
    process.stderr.write(`[task-completed] learnings persisted to ${outPath}\n`);
  } else if (writeResult.blocked) {
    process.stderr.write(
      `[task-completed] WARN: learnings write BLOCKED by secret scrub (fail-CLOSED) ` +
        `for specialist "${specialist}" task "${taskId}". Security event emitted.\n`,
    );
  }
}

/**
 * Best-effort extraction of inlined `depends-on: <id>` references from the
 * payload text (mirrors task-created.ts). Used to mirror the plan lane's gating
 * edges into the run-state checkpoint when no launcher-seeded value exists.
 */
function extractDependsOn(text: string): string[] {
  const matches = text.matchAll(/depends[\s-]on:\s*([^\s,;]+)/gi);
  return Array.from(matches, (m) => m[1].trim());
}

/**
 * Map the terminal `guild.handoff.v2` status onto a `guild.run_state.v1` lane
 * status. A clean `done` is `done`; any other terminal disposition (`blocked`,
 * `escalate`) or a legacy receipt with no envelope is recorded conservatively.
 */
function laneStatusFor(envelopeStatus: HandoffV2["status"] | null): LaneStatus {
  if (envelopeStatus === null) return "done"; // legacy receipt passed validation
  return envelopeStatus === "done" ? "done" : "failed";
}

/**
 * Derive the top-level run identity for a fresh checkpoint. Existing top-level
 * fields are preserved by upsertLane; these defaults only apply on first write.
 * Honors launcher-exported env (GUILD_PLAN_SLUG / GUILD_PROGRAM_ID /
 * GUILD_WAVE_INDEX) when present.
 */
function deriveRunStateInit(runId: string): RunStateInit {
  const planSlug = process.env["GUILD_PLAN_SLUG"];
  const programId = process.env["GUILD_PROGRAM_ID"];
  const waveRaw = process.env["GUILD_WAVE_INDEX"];
  const waveIndex = waveRaw !== undefined ? Number.parseInt(waveRaw, 10) : NaN;
  return {
    runId,
    planSlug: planSlug && planSlug.trim() !== "" ? planSlug : undefined,
    programId: programId && programId.trim() !== "" ? programId : null,
    waveIndex: Number.isFinite(waveIndex) ? waveIndex : undefined,
  };
}

/**
 * Persist the terminal lane state into run-state.json (ADR-RE-1). NON-FATAL:
 * the checkpoint is a rebuildable cache, never the system of record — a write
 * failure is logged and swallowed so it never blocks a clean completion.
 */
function persistRunState(
  runDir: string,
  runId: string,
  specialist: string,
  taskId: string,
  status: LaneStatus,
  tier: LaneTier | undefined,
  dependsOn: string[]
): void {
  try {
    const patch: LanePatch = {
      status,
      receipt_ref: path.join("handoffs", `${specialist}-${taskId}.md`),
    };
    if (tier !== undefined) patch.tier = tier;
    // Only set depends_on when we actually found edges; otherwise preserve any
    // launcher-seeded value (upsertLane keeps the prior array on undefined).
    if (dependsOn.length > 0) patch.depends_on = dependsOn;

    upsertLane(runDir, deriveRunStateInit(runId), taskId, patch);
    process.stderr.write(
      `[task-completed] run-state checkpoint updated: lane "${taskId}" → ${status} ` +
        `(${runStatePathHint(runDir)}).\n`
    );
  } catch (err) {
    process.stderr.write(
      `[task-completed] WARN: run-state checkpoint write failed (non-fatal, ` +
        `rebuildable cache): ${err instanceof Error ? err.message : String(err)}\n`
    );
  }
}

function runStatePathHint(runDir: string): string {
  return path.join(runDir, "run-state.json");
}

/**
 * HK-06: Post-write scrub for the handoff receipt (the agent-authored file).
 *
 * The agent writes the receipt to disk; this hook reads it and applies
 * applySecretsPolicy before any further processing. The scrub happens
 * IN-PLACE at rPath:
 *
 *   ok=true  → rewrite rPath with scrubbed content; return scrubbed value.
 *   ok=false → failure ladder (fail-CLOSED):
 *     STEP 1: Best-effort quarantine — rename rPath → rPath+".quarantined"
 *             (preserves content for human review).
 *     STEP 2: If rename failed, MUST destroy raw at canonical path:
 *             try overwrite with a redaction notice, then unlink.
 *             INVARIANT: raw NEVER survives at the canonical path.
 *     HARD:   If canonical removal also fails → die() immediately (critical).
 *     STEP 3: Emit secret_scrub_blocked security event.
 *     STEP 4: Write guild.approval_request.v1 to agent-bus (MAJOR 2 fix —
 *             operator always-ask notification, same as durable scrubbedWrite).
 *     Return blocked=true → caller die()s to block the lane.
 *
 * Non-throwing by contract (except the intentional HARD die() path).
 */
function scrubHandoffReceipt(
  rPath: string,
  content: string,
  guildRoot: string,
  runDir: string,
  runId: string,
  specialist: string,
  taskId: string,
): { content: string; blocked: boolean } {
  const sec = readSecurityConfig(guildRoot);
  // noTruncate: this scrubs the whole handoff DOCUMENT — redact secrets but never
  // apply the 4 KiB trace-field cap (was clipping handoffs at 4111 bytes).
  const scrubResult = applySecretsPolicy(content, sec.secrets_policy, { noTruncate: true });

  if (scrubResult.ok) {
    // Rewrite the receipt file in place with the scrubbed content.
    let rewriteOk = false;
    try {
      fs.writeFileSync(rPath, scrubResult.value, "utf8");
      rewriteOk = true;
    } catch (err) {
      process.stderr.write(
        `[task-completed] WARN: handoff scrub rewrite failed — raw receipt still ` +
          `at canonical path, falling into fail-CLOSED ladder: ` +
          `${err instanceof Error ? err.message : String(err)}\n`,
      );
    }
    if (rewriteOk) {
      return { content: scrubResult.value, blocked: false };
    }
    // Rewrite failed: raw content is still at rPath.
    // Fall through to the fail-CLOSED ladder — raw MUST NOT survive at the
    // canonical path regardless of whether the failure was scrub (ok=false)
    // or a successful scrub whose rewrite landed an I/O error (ok=true here).
  }

  // ── ok=false OR ok=true + rewrite-failure: fail-CLOSED path ──────────────

  // STEP 1: Best-effort quarantine (preserves content for human review).
  const quarantinePath = rPath + ".quarantined";
  let quarantineDone = false;
  try {
    fs.renameSync(rPath, quarantinePath);
    quarantineDone = true;
  } catch (err) {
    process.stderr.write(
      `[task-completed] WARN: handoff quarantine rename failed: ` +
        `${err instanceof Error ? err.message : String(err)}\n`,
    );
  }

  // STEP 2: If quarantine rename failed, MUST remove raw from canonical path.
  // INVARIANT: raw NEVER survives at the canonical path after fail-CLOSED.
  if (!quarantineDone) {
    let canonicalRemoved = false;
    // Try overwrite with a safe redaction notice first.
    try {
      fs.writeFileSync(
        rPath,
        "[SCRUB-BLOCKED: handoff receipt removed by Guild HK-06 secret scrub " +
          "— original content quarantine failed, raw destroyed at canonical path]\n",
        "utf8",
      );
      canonicalRemoved = true;
    } catch {
      // Overwrite failed — try unlink as last resort.
      try {
        fs.unlinkSync(rPath);
        canonicalRemoved = true;
      } catch {
        // All removal attempts exhausted.
      }
    }

    if (!canonicalRemoved) {
      // HARD FAILURE: raw secret persists at canonical path — critical breach.
      // Emit critical event (best-effort), then die immediately.
      try {
        const evt = buildSecurityEvent({
          run_id: runId,
          lane_id: specialist,
          event_type: "secret_scrub_blocked",
          decision: "blocked",
          tool: "task-completed/handoff-scrub",
          detail:
            `CRITICAL: Cannot remove raw handoff receipt "${path.basename(rPath)}" ` +
            `from canonical path — quarantine AND overwrite/unlink both failed. ` +
            `Raw secret may persist. Lane blocked. Manual remediation required.`,
          permission_mode: "blocked",
        });
        appendSecurityEvent(runDir, evt);
      } catch {}
      die(
        `CRITICAL HK-06 hard failure — raw handoff receipt from "${specialist}" ` +
          `(task "${taskId}") cannot be removed from canonical path ` +
          `(quarantine AND overwrite/unlink both failed). ` +
          `Raw secret may persist at ${rPath}. Manual remediation required.`,
      );
    }

    process.stderr.write(
      `[task-completed] WARN: HK-06: quarantine rename failed but canonical ` +
        `path overwritten/unlinked for ${path.basename(rPath)}.\n`,
    );
  }

  // STEP 3: Emit blocked security event (best-effort).
  try {
    const evt = buildSecurityEvent({
      run_id: runId,
      lane_id: specialist,
      event_type: "secret_scrub_blocked",
      decision: "blocked",
      tool: "task-completed/handoff-scrub",
      detail:
        `Secret scrub failed for handoff receipt from "${specialist}" ` +
        `(task: "${taskId}") — receipt quarantined/removed, lane blocked.`,
      permission_mode: "blocked",
    });
    appendSecurityEvent(runDir, evt);
  } catch {
    // best-effort
  }

  // STEP 4: Write approval_request to agent-bus (always-ask operator notification).
  // Mirrors the durable scrubbedWrite fail-CLOSED path so operators get the same
  // escalation channel regardless of which code path triggered the block.
  writeScrubApprovalRequest(runDir, runId, "handoff", rPath, specialist);

  return { content: "", blocked: true };
}

/**
 * HK-08: Write one NDJSON line to injection-audit.jsonl recording the
 * injection_clean classification for this task's envelope.
 * Best-effort (non-fatal) — audit failures must never block task completion.
 */
function persistInjectionAudit(
  runDir: string,
  taskId: string,
  specialist: string,
  injectionClean: InjectionClean,
): void {
  try {
    const logsDir = path.join(runDir, "logs");
    fs.mkdirSync(logsDir, { recursive: true });
    const record = {
      schema_version: "guild.injection_audit.v1",
      ts: new Date().toISOString(),
      task_id: taskId,
      specialist,
      injection_clean: injectionClean,
    };
    fs.appendFileSync(
      path.join(logsDir, "injection-audit.jsonl"),
      JSON.stringify(record) + "\n",
      "utf8",
    );
  } catch (err) {
    process.stderr.write(
      `[task-completed] WARN: injection-audit write failed (non-fatal): ` +
        `${err instanceof Error ? err.message : String(err)}\n`,
    );
  }
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // Opt-in gate
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

  let payload: TaskCompletedPayload;
  try {
    payload = JSON.parse(raw) as TaskCompletedPayload;
  } catch {
    die(`Invalid JSON on stdin: ${raw.slice(0, 120)}`);
  }

  const sessionId = payload.session_id ?? "unknown";
  const taskId = payload.task_id ?? "(unknown)";
  const specialist = (payload.teammate_name ?? "").trim() || "unknown";
  const cwd = payload.cwd ?? process.cwd();

  const guildRoot = resolveGuildRoot(cwd);
  const runId = deriveRunId(sessionId);
  const runDir = path.join(guildRoot, ".guild", "runs", runId);
  const rPath = receiptPath(guildRoot, runId, specialist, taskId);

  // ── Check receipt exists ───────────────────────────────────────────────────
  if (!fs.existsSync(rPath)) {
    die(
      `Task "${taskId}" (specialist: "${specialist}") has no handoff receipt. ` +
        `Expected at: ${rPath}\n` +
        `Write the receipt with sections: ${REQUIRED_FIELDS.join(", ")} before marking complete.`
    );
  }

  const content = fs.readFileSync(rPath, "utf8");

  // ── Check §8.2 required markdown fields ───────────────────────────────────
  // Runs on the RAW content BEFORE scrub so structural validation (§8.2,
  // SC-7 bloat checks, OD-4 envelope) is not confused by redaction sentinels.
  const missing = missingFields(content);
  if (missing.length > 0) {
    die(
      `Task "${taskId}" receipt at "${rPath}" is missing required §8.2 fields: ` +
        `[${missing.join(", ")}]. ` +
        `Add the missing sections before marking complete.`
    );
  }

  // ── Validate guild.handoff.v2 envelope (OD-4 discriminator, AC-3) ───────────
  //
  // For in-scope receipts (run.yaml.started_at >= POLICY_EFFECTIVE_DATE), a
  // missing or invalid v2 envelope is a hard failure (fail-closed). For
  // grandfathered or indeterminate-date receipts the envelope remains optional
  // (lenient). The discriminator always fails-open on indeterminate dates to
  // never break runs with missing run manifests.
  const rawEnvelope = extractHandoffEnvelope(content);
  let envelopeStatus: HandoffV2["status"] | null = null;
  let laneTier: LaneTier | undefined;
  if (rawEnvelope !== null) {
    const { valid, errors } = validateHandoffV2(rawEnvelope);
    if (!valid) {
      die(
        `Task "${taskId}" receipt at "${rPath}" contains an invalid guild.handoff.v2 envelope.\n` +
          `Validation errors (SC-7 lint):\n` +
          errors.map((e) => `  - ${e}`).join("\n")
      );
    }
    // ── HK-06: handoff receipt post-write scrub (D-SECRETS) ──────────────────
    // Runs AFTER structural validation (§8.2, SC-7, OD-4) so bloat-rejection
    // is not defeated by the high-entropy redactor. The validated envelope is
    // already extracted in memory; the in-place scrub rewrites rPath on disk.
    // ok=true → rPath is rewritten with scrubbed content; we continue using
    //           the in-memory envelope (already valid, no re-parse needed).
    // ok=false → rPath is quarantined and the lane is blocked (fail-CLOSED).
    {
      const { blocked: handoffBlocked } = scrubHandoffReceipt(
        rPath, content, guildRoot, runDir, runId, specialist, taskId,
      );
      if (handoffBlocked) {
        die(
          `Task "${taskId}" handoff receipt from "${specialist}" failed secret scrub (fail-CLOSED) — ` +
            `receipt quarantined to ${rPath}.quarantined. Security event emitted. ` +
            `Remove secrets from the receipt and re-submit.`,
        );
      }
    }
    // ── end HK-06 handoff scrub ────────────────────────────────────────────────

    // Extract learnings into run record (§6 D3 Extract phase)
    const envelope = rawEnvelope as HandoffV2;
    envelopeStatus = envelope.status;
    laneTier = envelope.tier;
    const lPath = learningsPath(guildRoot, runId, specialist, taskId);
    persistLearnings(envelope, lPath, specialist, taskId, runDir, runId);

    // ── HK-08: injection_clean enforcement ────────────────────────────────
    // Classify the envelope's free-text (summary + notes) for directive
    // language. Advisory — never blocks task completion. Records result in
    // injection-audit.jsonl; emits security event on flagged.
    const rawObj = rawEnvelope as Record<string, unknown>;
    const injectionClean: InjectionClean = classifyEnvelope(rawObj);
    persistInjectionAudit(runDir, taskId, specialist, injectionClean);
    if (injectionClean === "flagged") {
      const secEvt = buildSecurityEvent({
        run_id: runId,
        lane_id: specialist,
        event_type: "injection_attempt_detected",
        decision: "pass", // advisory — we record and continue, not deny
        tool: "",
        detail: `Directive language detected in guild.handoff.v2 summary/notes from "${specialist}" (task: "${taskId}")`,
        permission_mode: "advisory",
      });
      appendSecurityEvent(runDir, secEvt);
      process.stderr.write(
        `[task-completed] SECURITY: injection patterns detected in summary from ` +
          `specialist "${specialist}" (task: "${taskId}"). Recorded in injection-audit.jsonl.\n`,
      );
    }
    // ── end HK-08 ────────────────────────────────────────────────────────

    process.stderr.write(
      `[task-completed] OK: task "${taskId}" envelope validated (tier: ${envelope.tier}, ` +
        `status: ${envelope.status}).\n`
    );
  } else {
    // No v2 envelope found — apply OD-4 discriminator to decide lenient vs fail-closed.
    const disc: RunScopeResult = isRunInScope(runDir, taskId);
    if (disc.inscope) {
      // In-scope receipt: fail-closed (AC-3 enforcement).
      die(
        `Task "${taskId}" receipt at "${rPath}" is missing a guild.handoff.v2 envelope.\n` +
          `This run is in-scope for enforcement (run started_at >= policy_effective_date ` +
          `${POLICY_EFFECTIVE_DATE.toISOString().slice(0, 10)}).\n` +
          `Add a fenced \`\`\`guild.handoff.v2 { ... } \`\`\` JSON block to the receipt ` +
          `before marking complete. A frontmatter-only receipt is not a valid machine receipt ` +
          `(communication-format-policy.md §"Handoff contract", OD-2).`
      );
    } else if (disc.reason === "indeterminate") {
      // Indeterminate date: fail-open lenient + log warning.
      process.stderr.write(disc.warn + "\n");
      process.stderr.write(
        `[task-completed] NOTE: no guild.handoff.v2 envelope found in receipt for task "${taskId}" — ` +
          `validation skipped (envelope optional for indeterminate-date runs).\n`
      );
    } else {
      // Grandfathered (pre-effective-date): lenient, envelope optional.
      process.stderr.write(
        `[task-completed] NOTE: no guild.handoff.v2 envelope found in receipt for task "${taskId}" — ` +
          `validation skipped (grandfathered legacy receipt, run pre-dates policy_effective_date ` +
          `${POLICY_EFFECTIVE_DATE.toISOString().slice(0, 10)}).\n`
      );
    }
  }

  // ── Persist run-state checkpoint (ADR-RE-1) — lane has terminated ─────────
  // Non-fatal: run-state is a rebuildable cache, the receipt is authoritative.
  const laneStatus = laneStatusFor(envelopeStatus);
  const dependsOn = extractDependsOn(`${payload.task_subject ?? ""} ${payload.task_description ?? ""}`);
  persistRunState(runDir, runId, specialist, taskId, laneStatus, laneTier, dependsOn);

  // Emit bus event (SK-5 / CMD-007: agent-bus producer). Best-effort — never blocks.
  // laneStatus: "done" → "completed", anything else (failed) → "errored".
  emitBusEvent(runDir, {
    run_id: runId,
    event: laneStatus === "done" ? "completed" : "errored",
    lane_id: specialist,
    task_id: taskId,
    team_name: (payload.team_name ?? "").trim() || undefined,
    detail: laneStatus === "done" ? undefined : `lane status: ${laneStatus}`,
  });

  // ── D-BUS-2: generalized artifact-bus fan-out ─────────────────────────────
  // After each bus-log append, the TaskCompleted hook scans the subscriber
  // registry and fires matching `hook` callbacks (records the delivery in
  // bus/fanout.jsonl); `poll` subscribers tail the log themselves; `webhook-url`
  // is the deferred D-XHOST remote seam. Distinct from the agent_bus_event stream
  // above (different log/schema). Best-effort + non-throwing — never blocks.
  try {
    processFanout(runDir, () => new Date().toISOString());
  } catch (err) {
    process.stderr.write(
      `[task-completed] WARN: artifact-bus fan-out failed: ${err instanceof Error ? err.message : String(err)}\n`,
    );
  }

  // ── Context-assemble compliance (deterministic enforcement) ───────────────
  // Closes the recurring `all-lanes/no-assemble` gap (evolve run-5e445ca4
  // gate.json: a COMPLIANCE failure, not a content gap → enforce in code).
  // By the lane's completion the run MUST contain EITHER a context-assemble
  // bundle (.guild/context/<run-id>/<specialist>-<task-id>.md) OR an inline
  // dispatch-trace.md entry naming this lane + its file-listed working set
  // (the audit trail is MANDATORY even under the valid --auto-approve=all
  // inline shortcut — guild:execute-plan §"Audit trail when inlining"). Emit a
  // per-lane context_mode marker (assemble|inline|MISSING) into telemetry so
  // `no-assemble` is a RECORDED, distinguishable signal, not a null gap.
  //
  // Non-blocking: the lane is already complete, so a MISSING is a loud
  // warn-and-record (never a hard fail of finished work). Best-effort: a check
  // failure is swallowed so it can never block a clean completion.
  try {
    const compliance = evaluateContextCompliance({
      guildRoot,
      runDir,
      runId,
      specialist,
      taskId,
    });
    recordContextCompliance(runDir, runId, specialist, taskId, compliance);
    if (compliance.context_mode === "MISSING") {
      process.stderr.write(
        `[task-completed] ⚠ CONTEXT-COMPLIANCE VIOLATION: lane "${taskId}" ` +
          `(specialist "${specialist}") completed with NEITHER a context-assemble ` +
          `bundle (${compliance.bundle_path}) NOR an inline dispatch-trace.md entry ` +
          `naming the lane with a file-listed working set. ${compliance.reason}. ` +
          `Recorded context_mode=MISSING in telemetry — the inline-shortcut audit ` +
          `trail is MANDATORY even under --auto-approve=all ` +
          `(guild:execute-plan §"Audit trail when inlining").\n`,
      );
    } else {
      process.stderr.write(
        `[task-completed] context-compliance OK: lane "${taskId}" ` +
          `context_mode=${compliance.context_mode}.\n`,
      );
    }
  } catch (err) {
    process.stderr.write(
      `[task-completed] WARN: context-compliance check failed (non-fatal): ` +
        `${err instanceof Error ? err.message : String(err)}\n`,
    );
  }

  // §task§agent dismiss: agent terminates cleanly here (no idle, D3 §6).
  process.stderr.write(
    `[task-completed] OK: task "${taskId}" receipt verified at "${rPath}". Agent dismissed.\n`
  );
  process.exit(0);
}

main().catch((err: unknown) => {
  process.stderr.write(
    `[task-completed] FATAL: ${err instanceof Error ? err.message : String(err)}\n`
  );
  process.exit(1);
});
