/**
 * First-class cmux team backend.
 *
 * One non-focus-stealing terminal surface is opened per concrete task lane.
 * Each surface receives the same Guild identity/scope/definition environment
 * used by tmux, while workspace status keys expose lane lifecycle to the
 * operator. A partial launch is rolled back synchronously and reported.
 */

import { buildPrompt } from "../../../src/modules/prompting/workflows/team-prompt";
import type {
  AdapterResolver,
  GuildDispatchDescriptor,
  PaneSpec,
  RunFn,
  Specialist,
  TeamBackend,
  TeamLaunchRequest,
  TeamLaunchResult,
} from "../core/contracts/team-backend";
import {
  defaultRun,
  dispatchModelForSpecialist,
  dispatchModelParamsForSpecialist,
  resolvedSpecialistCapabilityScope,
  specialistDispatchKey,
} from "../core/contracts/team-backend";
import type { HostKind } from "../host-types";
import { paneCommand, resolveClaudeTeamLaunchArgs, shellQuote } from "./tmux-backend";
import { readRuntimePermissionConfig } from "../permission-policy";
import { validateProjectDefinitionRefV1 } from "../core/contracts/project-definition-ref";

function definitionRefCarriage(
  value: unknown,
): { ref: NonNullable<PaneSpec["definition_ref"]>; serialized: string; fragment: string } | null {
  if (value === undefined) return null;
  const ref = validateProjectDefinitionRefV1(value);
  if (ref === null) throw new Error("cmux lane carries an invalid definition_ref");
  const serialized = JSON.stringify(ref);
  const quoted = shellQuote(serialized);
  return {
    ref,
    serialized,
    fragment:
      `export GUILD_DEFINITION_REF=${quoted}; ` +
      `test "$GUILD_DEFINITION_REF" = ${quoted} || { ` +
      `echo '[GUILD_DEFINITION_REF] exact-carriage check failed' >&2; exit 66; }; `,
  };
}

/**
 * Locate the first non-export shell statement in an adapter command.
 * Pane adapters intentionally emit a generated `export …; ` prelude followed
 * by the host executable and `exec $SHELL`. The definition guard belongs
 * after that prelude, immediately before the executable. This scanner is
 * quote-aware so a semicolon inside a shell-quoted prompt is never mistaken
 * for a statement boundary.
 */
function adapterExecutableIndex(command: string): number | null {
  let cursor = 0;
  while (cursor < command.length) {
    if (!command.startsWith("export ", cursor)) return cursor;
    let quoted = false;
    let boundary = -1;
    for (let index = cursor; index < command.length; index += 1) {
      const char = command[index];
      if (!quoted && char === "\\") {
        index += 1;
        continue;
      }
      if (char === "'") {
        quoted = !quoted;
        continue;
      }
      if (!quoted && char === ";" && command[index + 1] === " ") {
        boundary = index;
        break;
      }
    }
    if (boundary < 0) return null;
    const statement = command.slice(cursor, boundary);
    if (!/^export [A-Za-z_][A-Za-z0-9_]*=/.test(statement)) return null;
    cursor = boundary + 2;
  }
  return null;
}

function collectSurfaceIds(value: unknown, ids: Set<string>): void {
  if (typeof value === "string" && /^surface:[A-Za-z0-9_.-]+$/.test(value)) {
    ids.add(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const child of value) {
      collectSurfaceIds(child, ids);
    }
    return;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of ["surface_id", "surfaceId", "id", "surface"]) {
      collectSurfaceIds(record[key], ids);
    }
    for (const child of Object.values(record)) {
      collectSurfaceIds(child, ids);
    }
  }
}

function surfaceIdsFromJson(stdout: string): Set<string> | null {
  try {
    const ids = new Set<string>();
    collectSurfaceIds(JSON.parse(stdout), ids);
    return ids;
  } catch {
    return null;
  }
}

export function parseCmuxSurfaceId(stdout: string): string | null {
  const parsed = surfaceIdsFromJson(stdout);
  if (parsed && parsed.size > 0) return parsed.values().next().value ?? null;
  // Older cmux builds may print a human line; fall through to its stable id.
  return stdout.match(/\bsurface:[A-Za-z0-9_.-]+\b/)?.[0] ?? null;
}

export function cmuxLaneStatusKey(runId: string, dispatchKey: string): string {
  return `guild-${runId}-${dispatchKey}`.replace(/[^A-Za-z0-9_.-]/g, "-");
}

function statusKey(runId: string, lane: Specialist): string {
  return cmuxLaneStatusKey(runId, specialistDispatchKey(lane));
}

export interface CmuxBackendOpts {
  workspaceId: string;
  run?: RunFn;
  resolveAdapter?: AdapterResolver;
}

export class CmuxTeamBackend implements TeamBackend {
  readonly kind = "cmux" as const;
  private readonly workspaceId: string;
  private readonly run: RunFn;
  private readonly resolveAdapter?: AdapterResolver;

  constructor(opts: CmuxBackendOpts) {
    this.workspaceId = opts.workspaceId.trim();
    this.run = opts.run ?? defaultRun;
    this.resolveAdapter = opts.resolveAdapter;
  }

  isAvailable(): boolean {
    return this.workspaceId.length > 0 && this.run("cmux", ["--help"]).status === 0;
  }

  private commandFor(req: TeamLaunchRequest, lane: Specialist): {
    command: string;
    descriptor: GuildDispatchDescriptor;
  } {
    const hostKind: HostKind = lane.host_kind ?? req.orchestratorHostKind ?? "claude";
    const prompt = buildPrompt(req.slug, req.runId, lane, req.teamPath, hostKind);
    const model = dispatchModelForSpecialist(lane) ?? undefined;
    const modelParams = dispatchModelParamsForSpecialist(lane);
    const capabilityScope = resolvedSpecialistCapabilityScope(lane);
    const definitionCarriage = definitionRefCarriage(lane.definition_ref);
    const paneSpec: PaneSpec = {
      name: specialistDispatchKey(lane),
      scope: lane.scope,
      runId: req.runId,
      slug: req.slug,
      prompt,
      hostKind,
      taskId: lane.taskId,
      capability_scope: capabilityScope,
      specialist: lane.name,
      assignmentPath: lane.task_cell_assignment_path,
      taskCellInstanceId: lane.task_cell_instance_id,
      definition_ref: lane.definition_ref,
      model,
      modelParams,
    };
    let command: string;
    let carriageProven = false;
    if (hostKind === "claude") {
      const hostCommand = paneCommand(
          prompt,
          req.runId,
          capabilityScope,
          lane.taskId,
          lane.name,
          false,
          resolveClaudeTeamLaunchArgs(readRuntimePermissionConfig(req.cwd)),
          model,
          lane.task_cell_assignment_path,
          lane.task_cell_instance_id,
          undefined,
        );
      if (definitionCarriage === null) {
        command = hostCommand;
      } else {
        const launchToken = "command claude ";
        const launchIndex = hostCommand.lastIndexOf(launchToken);
        if (launchIndex < 0 || hostCommand.includes("GUILD_DEFINITION_REF")) {
          throw new Error("cmux Claude command has no unambiguous definition-ref launch boundary");
        }
        command =
          hostCommand.slice(0, launchIndex) +
          definitionCarriage.fragment +
          hostCommand.slice(launchIndex);
        carriageProven = command.startsWith(
          definitionCarriage.fragment + launchToken,
          launchIndex,
        );
      }
    } else {
      if (!this.resolveAdapter) {
        throw new Error(`cmux lane ${lane.name} requires a ${hostKind} adapter`);
      }
      const adapter = this.resolveAdapter(hostKind);
      const preflight = adapter.preflight();
      if (!preflight.ok) throw new Error(`${hostKind} preflight failed: ${preflight.message}`);
      const adapterEnv = adapter.env(paneSpec);
      const adapterCommand = adapter.command(paneSpec);
      if (
        Object.prototype.hasOwnProperty.call(adapterEnv, "GUILD_DEFINITION_REF") ||
        adapterCommand.includes("GUILD_DEFINITION_REF")
      ) {
        throw new Error(
          `${hostKind} adapter attempts to override the reserved GUILD_DEFINITION_REF boundary`,
        );
      }
      const exports = Object.entries(adapterEnv)
        .map(([key, value]) => `export ${key}=${shellQuote(value)}; `)
        .join("");
      if (definitionCarriage === null) {
        command = exports + adapterCommand;
      } else {
        const executableIndex = adapterExecutableIndex(adapterCommand);
        if (executableIndex === null) {
          throw new Error(`${hostKind} adapter has no unambiguous executable boundary`);
        }
        const guardedAdapterCommand =
          adapterCommand.slice(0, executableIndex) +
          definitionCarriage.fragment +
          adapterCommand.slice(executableIndex);
        command = exports + guardedAdapterCommand;
        const commandBoundary = exports.length + executableIndex;
        carriageProven = command.startsWith(
          definitionCarriage.fragment + adapterCommand.slice(executableIndex),
          commandBoundary,
        );
      }
    }
    // The dispatch descriptor reports exact carriage only when the guard is
    // the final generated boundary immediately before the host executable.
    const carriedDefinition = carriageProven ? definitionCarriage : null;
    return {
      command,
      descriptor: {
        name: specialistDispatchKey(lane),
        subagentType: hostKind,
        model: model ?? null,
        env: {
          GUILD_RUN_ID: req.runId,
          GUILD_TASK_ID: lane.taskId ?? lane.name,
          ...(capabilityScope !== undefined
            ? { GUILD_CAPABILITY_SCOPE: JSON.stringify(capabilityScope) }
            : {}),
          ...(carriedDefinition
            ? { GUILD_DEFINITION_REF: carriedDefinition.serialized }
            : {}),
        },
        prompt,
        definitionPath: lane.definition ?? null,
        definition_ref: carriedDefinition?.ref ?? null,
      },
    };
  }

  launch(req: TeamLaunchRequest): TeamLaunchResult {
    const plannedCommands: string[] = [];
    const teammatePaneIds: Record<string, string> = {};
    const dispatchPlan: GuildDispatchDescriptor[] = [];
    const opened: Array<{ lane: Specialist; surface: string }> = [];
    const fail = (detail: string): TeamLaunchResult => {
      const survivors: Record<string, string> = {};
      let confirmed = 0;
      for (const { lane, surface } of [...opened].reverse()) {
        const termination = terminateCmuxSurface(surface, this.run, this.workspaceId);
        if (termination.confirmed) {
          confirmed += 1;
        } else {
          survivors[specialistDispatchKey(lane)] = surface;
        }
        this.run("cmux", ["clear-status", statusKey(req.runId, lane), "--workspace", this.workspaceId]);
      }
      this.run("cmux", ["clear-progress", "--workspace", this.workspaceId]);
      const unconfirmed = Object.keys(survivors).length;
      return {
        kind: this.kind,
        ok: false,
        plannedCommands,
        orchestratorPaneId: null,
        // A failed result carries ONLY surfaces whose death could not be
        // confirmed, so the launcher can park their exact TaskCells orphaned.
        teammatePaneIds: survivors,
        notes: [
          detail,
          `confirmed rollback of ${confirmed}/${opened.length} cmux surface(s)`,
          ...(unconfirmed > 0 ? [`${unconfirmed} unconfirmed survivor(s); lifecycle parked orphaned`] : []),
        ],
        dispatchPlan,
      };
    };

    for (const lane of req.specialists) {
      let composed: ReturnType<CmuxTeamBackend["commandFor"]>;
      try {
        composed = this.commandFor(req, lane);
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
      dispatchPlan.push(composed.descriptor);
      const createArgs = [
        "new-pane", "--workspace", this.workspaceId, "--type", "terminal",
        "--direction", "right", "--focus", "false", "--json",
      ];
      plannedCommands.push(`cmux ${createArgs.map(shellQuote).join(" ")}`);
      plannedCommands.push(`cmux send --surface <surface> ${shellQuote(composed.command + "\n")}`);
      if (req.dryRun) continue;

      const created = this.run("cmux", createArgs);
      const surface = created.status === 0 ? parseCmuxSurfaceId(created.stdout) : null;
      if (!surface) return fail(`cmux surface creation failed for ${lane.name}: ${created.stderr || created.stdout}`);
      opened.push({ lane, surface });
      teammatePaneIds[specialistDispatchKey(lane)] = surface;
      const status = this.run("cmux", [
        "set-status", statusKey(req.runId, lane), "running", "--workspace", this.workspaceId,
        "--color", "#ff9500",
      ]);
      if (status.status !== 0) return fail(`cmux status registration failed for ${lane.name}: ${status.stderr}`);
      const sent = this.run("cmux", ["send", "--surface", surface, composed.command + "\n"]);
      if (sent.status !== 0) return fail(`cmux dispatch send failed for ${lane.name}: ${sent.stderr}`);
    }

    if (!req.dryRun) {
      this.run("cmux", [
        "set-progress", "0", "--label", `Guild ${req.slug}: ${opened.length} lane(s) running`,
        "--workspace", this.workspaceId,
      ]);
    }
    return {
      kind: this.kind,
      ok: true,
      plannedCommands,
      orchestratorPaneId: null,
      teammatePaneIds,
      notes: req.dryRun
        ? ["dry-run: cmux not invoked; every planned surface uses --focus false"]
        : [`${opened.length} visible cmux surface(s) opened without focus stealing`],
      dispatchPlan,
    };
  }
}

export interface CmuxTerminationOutcome {
  ok: boolean;
  confirmed: boolean;
  degraded: boolean;
  mechanism: string;
  error?: string;
}

export function terminateCmuxSurface(
  surfaceId: string,
  run: RunFn = defaultRun,
  workspaceId?: string,
): CmuxTerminationOutcome {
  const closed = run("cmux", ["close-surface", "--surface", surfaceId]);
  if (closed.status !== 0) {
    return { ok: false, confirmed: false, degraded: false, mechanism: "cmux close-surface", error: closed.stderr };
  }
  const listed = run("cmux", [
    "list-pane-surfaces",
    ...(workspaceId ? ["--workspace", workspaceId] : []),
    "--json",
  ]);
  if (listed.status !== 0) {
    return { ok: false, confirmed: false, degraded: true, mechanism: "cmux close-surface", error: listed.stderr || "cmux liveness probe unavailable" };
  }
  const liveSurfaceIds = surfaceIdsFromJson(listed.stdout);
  if (liveSurfaceIds === null) {
    return {
      ok: false,
      confirmed: false,
      degraded: true,
      mechanism: "cmux close-surface",
      error: "cmux liveness probe returned malformed JSON",
    };
  }
  const survives = liveSurfaceIds.has(surfaceId);
  return {
    ok: !survives,
    confirmed: !survives,
    degraded: false,
    mechanism: "cmux close-surface + list-pane-surfaces confirmation",
    ...(survives ? { error: "surface survived close" } : {}),
  };
}
