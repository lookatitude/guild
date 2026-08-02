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
    const isProjectLocal =
      spec.definition_source === "project" && !!spec.definition;
    // T6-R2-F5: an evidenced-M2 selection IS the descriptor's model, so the
    // Agent() call guild:execute-plan issues runs at the resolver's frozen
    // model instead of being auto-scored. `null` (legacy / shadow / no
    // provenance) keeps the auto-scored behavior byte-identical.
    const model = dispatchModelForSpecialist(spec);
    const modelParams = dispatchModelParamsForSpecialist(spec);
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
        ...(spec.capability_scope !== undefined
          ? { GUILD_CAPABILITY_SCOPE: JSON.stringify(spec.capability_scope) }
          : {}),
        ...(isProjectLocal
          ? { GUILD_AGENT_DEFINITION: spec.definition as string }
          : {}),
      },
      prompt: buildPrompt(
        req.slug,
        req.runId,
        spec,
        req.teamPath,
        spec.host_kind ?? req.orchestratorHostKind ?? "claude",
      ),
      definitionPath: isProjectLocal ? (spec.definition as string) : null,
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
