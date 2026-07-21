/**
 * src/modules/prompting/workflows/team-prompt.ts
 *
 * Shared Guild team prompt renderer. Dispatch backends transport these prompts;
 * this module owns the wording, context-bundle pointers, and host-family
 * differences in assignment instructions.
 */

import { hostKindToRegistryId } from "../../host-runtime";
import type { HostKind } from "../../host-runtime";

export interface TeamPromptSpecialist {
  name: string;
  scope: string;
  dependsOn?: readonly string[];
  /**
   * Agent-definition path from team.yaml (project-root-relative). Load-bearing
   * when definition_source === "project": the host has no registered agent for
   * this name, so the prompt itself must direct the lane to adopt the
   * definition at this path (and load its frontmatter `skills:` from
   * `.guild/skills/<skill>/` where present).
   */
  definition?: string;
  definition_source?: "shipped" | "project";
}

function isClaudeCli(hostKind: HostKind): boolean {
  return hostKindToRegistryId(hostKind) === "claude-code-cli";
}

export function buildPrompt(
  slug: string,
  runId: string,
  specialist: TeamPromptSpecialist | null,
  teamPath?: string,
  paneHostKind: HostKind = "claude",
): string {
  if (!specialist) {
    const teamRef = teamPath ?? `.guild/team/${slug}.yaml`;
    const coordination =
      isClaudeCli(paneHostKind)
        ? `Dispatch specialists via TaskCreated events when their plan dependencies clear, ` +
          `then aggregate handoffs and invoke guild:review → guild:verify-done → guild:reflect.`
        : `Dispatch specialists through the file-based agent bus when their plan dependencies clear; ` +
          `write dispatch/brief records under \`.guild/runs/${runId}/agent-bus/\`, ` +
          `then aggregate handoffs and invoke guild:review → guild:verify-done → guild:reflect.`;
    return (
      `You are the Guild orchestrator for team \`${slug}\`, run-id \`${runId}\`. ` +
      `The spec is at \`.guild/spec/${slug}.md\`, the team at \`${teamRef}\`, ` +
      `and the approved plan at \`.guild/plan/${slug}.md\`. ` +
      `Per-specialist context bundles are under \`.guild/context/${runId}/<specialist>-<task-id>.md\` ` +
      `(build them via guild:context-assemble before dispatch). ` +
      `Teammate handoff receipts will land at \`.guild/runs/${runId}/handoffs/<specialist>-<task-id>.md\`. ` +
      coordination
    );
  }

  const waitInstruction =
    isClaudeCli(paneHostKind)
      ? `Wait for a \`TaskCreated\` event from the orchestrator before starting.`
      : `Watch the file-based agent bus at \`.guild/runs/${runId}/agent-bus/\` ` +
        `for your dispatch/brief record before starting; do not wait for host-native event callbacks.`;
  // task-cell-runtime D5 — the assignment read-ack gate (PROSE tier, G3).
  // SCOPE (honest): `GUILD_TASK_ASSIGNMENT` still points at the legacy v1
  // per-specialist file (`.guild/runs/<run>/tasks/<specialist>.json`, exported by
  // tmux-backend.ts / pane-adapter.ts). G3 adds the *instruction* that the worker
  // must read + validate + acknowledge that file before any work (fail-closed on
  // missing/malformed). What is DEFERRED to G4 (with pane-per-task dispatch):
  // repointing this env at the per-instance canonical v2 assignment path AND
  // replacing this model-prose gate with a DETERMINISTIC read/ack await in the
  // backend (per the "security steps must be code, not prose" rule). Until then
  // this is a best-effort prose gate over the v1 pointer, not a v2 enforcement.
  const readAckInstruction =
    `Before doing any work, read your assignment file at \`$GUILD_TASK_ASSIGNMENT\` ` +
    `and validate it (guild.task_assignment schema, fail-closed). If it is missing or ` +
    `malformed, STOP and report a hard dispatch failure — do not start. Otherwise write ` +
    `your acknowledgment beside it (an \`assignment-ack.json\` marker in the instance ` +
    `directory) and only then begin your lane: you enter \`running\` only after the ` +
    `assignment is acknowledged (D5). `;
  // Project-local specialist: the definition is not host-registered, so the
  // prompt carries the adoption instruction (definition body + its project
  // skills) — this replaces the old "degraded generic agent" fallback.
  const definitionInstruction =
    specialist.definition_source === "project" && specialist.definition
      ? `Your role definition is at \`${specialist.definition}\` — read it FIRST and adopt it ` +
        `fully (persona, boundaries, TRIGGER / DO NOT TRIGGER limits). For each skill listed ` +
        `in its frontmatter \`skills:\`, load the project-local instance at ` +
        `\`.guild/skills/<skill>/SKILL.md\` when it exists before starting your lane. `
      : "";
  // #58 — the machine-readable definition-adoption PREFIX. Emitted as the very
  // FIRST LINE for a project specialist, alongside the human-readable
  // instruction above. The PreToolUse dispatch-integrity guard parses identity
  // from THIS line only: a fixed, producer-owned position that the lane's
  // arbitrary `scope` text (appended below) can never forge or contradict. This
  // is what makes a correct dispatch textually distinguishable from a
  // persona-stripped one instead of byte-identical.
  const definitionMarker =
    specialist.definition_source === "project" && specialist.definition
      ? `GUILD_AGENT_DEFINITION=${specialist.definition}\n`
      : "";
  return (
    definitionMarker +
    `You are the \`${specialist.name}\` teammate for run-id \`${runId}\`. ` +
    definitionInstruction +
    `Your lane scope: \`${specialist.scope}\`. ` +
    `Read your context bundle at \`.guild/context/${runId}/${specialist.name}-<task-id>.md\` — ` +
    `it is authoritative; privilege it over any ambient CLAUDE.md / auto-memory (§9.1). ` +
    `When you finish, write your §8.2 handoff receipt to ` +
    `\`.guild/runs/${runId}/handoffs/${specialist.name}-<task-id>.md\` with all 5 fields ` +
    `(changed_files, opens_for, assumptions, evidence, followups). ` +
    readAckInstruction +
    waitInstruction
  );
}
