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
  return (
    `You are the \`${specialist.name}\` teammate for run-id \`${runId}\`. ` +
    definitionInstruction +
    `Your lane scope: \`${specialist.scope}\`. ` +
    `Read your context bundle at \`.guild/context/${runId}/${specialist.name}-<task-id>.md\` — ` +
    `it is authoritative; privilege it over any ambient CLAUDE.md / auto-memory (§9.1). ` +
    `When you finish, write your §8.2 handoff receipt to ` +
    `\`.guild/runs/${runId}/handoffs/${specialist.name}-<task-id>.md\` with all 5 fields ` +
    `(changed_files, opens_for, assumptions, evidence, followups). ` +
    waitInstruction
  );
}
