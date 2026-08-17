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
  taskId?: string;
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

// ── Universal structured producer marker (rf-wi-03 / G3) ─────────────────────
//
// The prompt line-1 twin of the dispatch-env marker set by
// `composeInProcessDispatch` / `paneCommand` (canonical constants:
// scripts/lib/core/contracts/team-backend.ts DISPATCH_PRODUCER_ENV /
// DISPATCH_PRODUCER_TOKEN — restated here because the prompting module must not
// import the dispatch host layer; keep the literals in step). Emitted as the
// prompt's FIRST LINE for EVERY non-project dispatch (shipped specialist +
// orchestrator) so line-1 always carries producer identity — the anchor the
// legacy 300-char producer-head parsing collapsed onto and was DELETED in favour
// of (rf-wi-06 / issue #91: identity is now read from producer-owned positions
// only, the dispatch env and this line). A
// PROJECT specialist keeps its existing GUILD_AGENT_DEFINITION line-1 marker
// (#58) verbatim, which already carries role via its path, so the two dispatch
// classes are jointly universal without disturbing the #58 guard.
const DISPATCH_PRODUCER_ENV = "GUILD_DISPATCH_PRODUCER";
const DISPATCH_PRODUCER_TOKEN = "guild.dispatch.v1";

/** The line-1 producer marker (`role=` carries the dispatch identity). */
function producerMarkerLine(role: string): string {
  return `${DISPATCH_PRODUCER_ENV}=${DISPATCH_PRODUCER_TOKEN} role=${role}\n`;
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
      producerMarkerLine("orchestrator") +
      `You are the Team Lead for team \`${slug}\`, run-id \`${runId}\`. ` +
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
  // task-cell-runtime D5 — the worker-facing half of the assignment read/ack
  // gate. The launcher points GUILD_TASK_ASSIGNMENT at the exact immutable v2
  // instance path; the code-owned runtime separately validates and awaits ack.
  const readAckInstruction =
    `Before doing any work, read your assignment file at \`$GUILD_TASK_ASSIGNMENT\` ` +
    `and validate it (guild.task_assignment schema, fail-closed). If it is missing or ` +
    `malformed, STOP and report a hard dispatch failure — do not start. Otherwise write ` +
    `your acknowledgment beside it (an \`assignment-ack.json\` marker in the instance ` +
    `directory) and only then begin your lane: you enter \`running\` only after the ` +
    `assignment is acknowledged (D5). `;
  // rf-wi-06 (issue #91) — NORMALIZE the definition path ONCE, here, for EVERY
  // producer. `buildPrompt` is the single choke point every dispatch class runs
  // through (in-process, tmux panes, remote), and it used to interpolate the RAW
  // field into both the adoption prose and the line-1 marker. A quoted YAML value
  // legitimately carries surrounding whitespace (`stripQuotes` preserves what is
  // inside the quotes), so a real team file could produce the line-1 marker
  // `GUILD_AGENT_DEFINITION=  .guild/agents/devops.md  ` — which is parsed
  // whole-or-not-at-all and therefore REJECTED, denying a dispatch the composer
  // had accepted, while the env carrier stayed canonical. Trimming here keeps
  // every carrier canonical for every backend, not just the in-process one.
  const definitionPath =
    typeof specialist.definition === "string" ? specialist.definition.trim() : undefined;
  // Project-local specialist: the definition is not host-registered, so the
  // prompt carries the adoption instruction (definition body + its project
  // skills) — this replaces the old "degraded generic agent" fallback.
  const definitionInstruction =
    specialist.definition_source === "project" && definitionPath
      ? `Your role definition is at \`${definitionPath}\` — read it FIRST and adopt it ` +
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
  const isProjectSpecialist =
    specialist.definition_source === "project" && Boolean(definitionPath);
  const definitionMarker = isProjectSpecialist
    ? `GUILD_AGENT_DEFINITION=${definitionPath}\n`   // normalized — see definitionPath above
    : "";
  // rf-wi-03 (G3) — a PROJECT specialist keeps its GUILD_AGENT_DEFINITION line-1
  // marker (#58); every OTHER (shipped) specialist gets the universal producer
  // marker as line-1, so line-1 identity is universal across dispatch classes.
  const line1Marker = isProjectSpecialist
    ? definitionMarker
    : producerMarkerLine(specialist.name);
  return (
    line1Marker +
    `You are the \`${specialist.name}\` teammate for run-id \`${runId}\`. ` +
    definitionInstruction +
    `Your lane scope: \`${specialist.scope}\`. ` +
    `Read the exact \`context_bundle_id\` named by your assignment — ` +
    `it is authoritative; privilege it over any ambient CLAUDE.md / auto-memory (§9.1). ` +
    `When you finish, write your §8.2 handoff receipt to the assignment's exact ` +
    `\`channels.handoff_path\` with all 5 fields ` +
    `(changed_files, opens_for, assumptions, evidence, followups). ` +
    readAckInstruction +
    waitInstruction
  );
}
