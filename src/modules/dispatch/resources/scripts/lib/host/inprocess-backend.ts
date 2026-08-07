/**
 * scripts/lib/host/inprocess-backend.ts
 *
 * InProcessTeamBackend + SerialBackend — Agent-tool dispatch (no tmux).
 * Extracted from team-backend.ts (W3 god-file split).
 *
 * Layer: host/ — imports from core/contracts + shared/.
 */

import type {
  GuildDispatchDescriptor,
  RunFn,
  Specialist,
  TeamBackend,
  TeamLaunchRequest,
  TeamLaunchResult,
} from "../core/contracts/team-backend";
import {
  GENERIC_SUBAGENT_TYPE,
  dispatchModelForSpecialist,
  dispatchModelParamsForSpecialist,
  DISPATCH_PRODUCER_ENV,
  DISPATCH_PRODUCER_TOKEN,
} from "../core/contracts/team-backend";
import { buildPrompt, shellQuote } from "./tmux-backend";

export function composeInProcessDispatch(
  req: TeamLaunchRequest
): GuildDispatchDescriptor[] {
  return req.specialists.map((spec) => {
    // A project-local specialist (.guild/agents/<role>.md) has no
    // host-registered agent under its name — hosts load agent definitions from
    // the plugin install once at session start. Dispatch it as the host's
    // generic subagent type; buildPrompt embeds the definition-adoption
    // instruction so the lane still runs the minted role at its own tier.
    //
    // #58 — the emission is keyed on `definition_source === "project"` ALONE
    // (NOT `&& definition`): for a project specialist, GUILD_AGENT_DEFINITION +
    // the definition-adoption prompt prefix are UNCONDITIONAL, so the intended
    // dispatch is never byte-identical to a persona-stripped generic agent. A
    // project specialist with no definition path cannot honor that contract —
    // fail closed rather than silently degrade to a bare `general-purpose`
    // dispatch (that IS the defect #58 describes).
    const isProjectLocal = spec.definition_source === "project";
    // rf-wi-06 (issue #91) — NORMALIZE, don't just validate-on-a-copy. The check
    // below compares TRIMMED, so a padded-but-canonical
    // `"  .guild/agents/devops.md  "` passes; but the raw `spec` was then handed
    // to `buildPrompt`, which interpolates it verbatim and emitted the line-1
    // marker `GUILD_AGENT_DEFINITION=  .guild/agents/devops.md  `. That line is
    // parsed whole-or-not-at-all, so `resolveDispatchAttribution` rejected it —
    // `hasAdoptionPrompt: false`, violation `missing_adoption_prompt` — and the
    // PreToolUse guard DENIED a dispatch this composer had just accepted, with
    // the env carrier canonical and the prompt carrier malformed. Normalizing
    // once, here, keeps both carriers identical by construction.
    const normalizedSpec: Specialist =
      isProjectLocal && typeof spec.definition === "string"
        ? { ...spec, definition: spec.definition.trim() }
        : spec;
    if (isProjectLocal) {
      const def = typeof normalizedSpec.definition === "string" ? normalizedSpec.definition : "";
      // The definition MUST be a well-formed `.guild/agents/<name>.md` path whose
      // role matches this specialist. A missing / whitespace / arbitrary /
      // role-mismatched path is not a valid GUILD_AGENT_DEFINITION — dispatching
      // it would emit a persona-stripped generic descriptor the host guard would
      // (rightly) block. Fail closed here at composition (#58, adversarial
      // review) rather than let a bad descriptor reach the Agent tool.
      const expected = `.guild/agents/${spec.name}.md`;
      if (def !== expected) {
        throw new Error(
          `composeInProcessDispatch: project specialist "${spec.name}" has an ` +
            `invalid definition path ${JSON.stringify(spec.definition)} — expected ` +
            `"${expected}". A project specialist's GUILD_AGENT_DEFINITION env + ` +
            `definition-adoption prompt prefix are unconditional (#58); refusing to ` +
            `dispatch a persona-stripped generic agent. team-compose must write ` +
            `${expected} and set spec.definition to it before dispatch.`,
        );
      }
    }
    // T6-R2-F5: an evidenced-M2 selection IS the descriptor's model, so the
    // Agent() call guild:execute-plan issues runs at the resolver's frozen
    // model instead of being auto-scored. `null` (legacy / shadow / no
    // provenance) keeps the auto-scored behavior byte-identical.
    const model = dispatchModelForSpecialist(spec);
    const modelParams = dispatchModelParamsForSpecialist(spec);
    // rf-wi-03 (G3) — carry the scored tier on the lane's OWN env so the tier
    // guard can verify MODEL↔TIER and reach `scored_compliant` instead of
    // capping at `model_present`. The scored tier wins over the authoring
    // default_tier (execute-plan writes the re-scored `tier:` back to team.yaml,
    // ARCH-6 Part 2); GUILD_TIER_SCORE rides along only when a producer actually
    // has the raw score (audit-only — the guard never gates on it). Absent tier
    // ⇒ no GUILD_TIER (never a fabricated value): the model-param invariant still
    // holds and the guard records `model_present`, exactly as before.
    const resolvedTier = spec.tier ?? spec.default_tier;
    const hasScore = typeof spec.score === "number" && Number.isFinite(spec.score);
    return {
      name: spec.name,
      subagentType: isProjectLocal ? GENERIC_SUBAGENT_TYPE : spec.name,
      model,
      env: {
        GUILD_RUN_ID: req.runId,
        GUILD_SPECIALIST: spec.name,
        GUILD_TASK_ID: spec.taskId ?? spec.name,
        ...(model !== null ? { GUILD_MODEL: model } : {}),
        ...(modelParams !== undefined
          ? { GUILD_MODEL_PARAMS: JSON.stringify(modelParams) }
          : {}),
        // rf-wi-03 (G3) — the universal structured producer marker. Unforgeable
        // by quoted prose (it lives in the dispatch's own env map), stamped on
        // EVERY descriptor so a lane that lacks it is detectably NOT
        // producer-composed (the backend guard's blockable prompt-only rung).
        [DISPATCH_PRODUCER_ENV]: DISPATCH_PRODUCER_TOKEN,
        ...(resolvedTier !== undefined ? { GUILD_TIER: resolvedTier } : {}),
        ...(hasScore ? { GUILD_TIER_SCORE: String(spec.score) } : {}),
        ...(spec.capability_scope !== undefined
          ? { GUILD_CAPABILITY_SCOPE: JSON.stringify(spec.capability_scope) }
          : {}),
        ...(isProjectLocal
          ? { GUILD_AGENT_DEFINITION: `.guild/agents/${spec.name}.md` }
          : {}),
      },
      prompt: buildPrompt(
        req.slug,
        req.runId,
        // rf-wi-06 — the NORMALIZED spec: `buildPrompt` interpolates
        // `definition` verbatim into the line-1 marker, so a padded value here
        // would emit a marker the whole-line parser rejects while the env
        // carrier above stayed canonical. Both carriers must agree.
        normalizedSpec,
        req.teamPath,
        spec.host_kind ?? req.orchestratorHostKind ?? "claude",
      ),
      definitionPath: isProjectLocal ? `.guild/agents/${spec.name}.md` : null,
    };
  });
}

export class InProcessTeamBackend implements TeamBackend {
  readonly kind = "in-process" as const;

  isAvailable(): boolean {
    return true;
  }

  launch(req: TeamLaunchRequest): TeamLaunchResult {
    const dispatchPlan = composeInProcessDispatch(req);
    const plannedCommands = dispatchPlan.map(
      (d) =>
        `Agent({ subagent_type: ${shellQuote(d.subagentType)}, ` +
        `model: ${d.model ?? "<auto-scored at dispatch>"}, ` +
        `description: ${shellQuote(`${d.name} lane`)} })`
    );
    const head = req.dryRun
      ? `dry-run: in-process backend has no side effects — declarative plan only.`
      : `in-process: ${dispatchPlan.length} specialist(s) planned for Agent-tool ` +
        `dispatch (no tmux).`;
    return {
      kind: this.kind,
      ok: true,
      plannedCommands,
      orchestratorPaneId: null,
      teammatePaneIds: {},
      notes: [
        `${head} guild:execute-plan issues one Agent() call per descriptor in ` +
          `result.dispatchPlan (team \`${req.slug}\`, run-id \`${req.runId}\`).`,
      ],
      dispatchPlan,
    };
  }
}

export class SerialBackend implements TeamBackend {
  readonly kind = "serial" as const;

  isAvailable(): boolean {
    return true;
  }

  launch(req: TeamLaunchRequest, opts?: { degraded_from?: string; reason?: string }): TeamLaunchResult {
    const dispatchPlan = composeInProcessDispatch(req);
    const plannedCommands = dispatchPlan.map(
      (d) =>
        `Agent({ subagent_type: ${shellQuote(d.subagentType)}, ` +
        `model: ${d.model ?? "<auto-scored at dispatch>"}, ` +
        `description: ${shellQuote(`${d.name} lane`)} })`
    );
    const head = req.dryRun
      ? `dry-run: serial-floor backend — declarative plan only (parallelism=1, Rung 4).`
      : `serial: ${dispatchPlan.length} specialist(s) planned for sequential Agent-tool ` +
        `dispatch (Rung 4 / substrate degradation — parallelism=1).`;
    return {
      kind: this.kind,
      ok: true,
      plannedCommands,
      orchestratorPaneId: null,
      teammatePaneIds: {},
      notes: [
        `${head} guild:execute-plan issues Agent() calls sequentially ` +
          `(team \`${req.slug}\`, run-id \`${req.runId}\`). ` +
          `dispatch_rung=4 (GUILD_DISPATCH_RUNG=4 per HK-07 vocabulary).`,
      ],
      dispatchPlan,
      parallelism: 1,
      substrateDegradation: {
        substrate: "serial",
        degraded_from: opts?.degraded_from ?? "auto",
        reason:
          opts?.reason ??
          "no tmux / no independent-agents capability / serial floor selected (Rung 4)",
      },
    };
  }
}
