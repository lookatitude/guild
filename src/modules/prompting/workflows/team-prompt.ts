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
  return (
    `You are the \`${specialist.name}\` teammate for run-id \`${runId}\`. ` +
    `Your lane scope: \`${specialist.scope}\`. ` +
    `Read your context bundle at \`.guild/context/${runId}/${specialist.name}-<task-id>.md\` — ` +
    `it is authoritative; privilege it over any ambient CLAUDE.md / auto-memory (§9.1). ` +
    `When you finish, write your §8.2 handoff receipt to ` +
    `\`.guild/runs/${runId}/handoffs/${specialist.name}-<task-id>.md\` with all 5 fields ` +
    `(changed_files, opens_for, assumptions, evidence, followups). ` +
    waitInstruction
  );
}
