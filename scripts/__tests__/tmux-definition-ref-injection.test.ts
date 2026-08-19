/**
 * scripts/__tests__/tmux-definition-ref-injection.test.ts
 *
 * Fix A of the W4/W5 completion lane (run-identity-and-dispatch): the tmux
 * dispatch port refused exact project `definition_ref` injection because the
 * launcher's tmux port never declared `supports_definition_injection`, and the
 * tmux backend never exposed a per-specialist forwarding proof reportLaunch's
 * `portHonoredInjection` loop could verify.
 *
 * The contract under test ("refuse, never strip" — execution-transport-ports
 * cap-loc-D11):
 *   1. The tmux BACKEND must actually carry the exact ref into the pane
 *      command (`GUILD_DEFINITION_REF`, content_hash included verbatim) and
 *      expose it per-specialist on the launch result's `dispatchPlan` so the
 *      declaring port can verify forwarding — an echo without carriage is a
 *      fabricated proof, so the plan entry appears ONLY when the composed pane
 *      command demonstrably carries the ref bytes.
 *   2. A tmux port that DECLARES support and launches a ref-carrying request
 *      must come back `succeeded` (the verification loop passes on the proof).
 *   3. NEGATIVE CONTROL: an UNDECLARED port must refuse the same request
 *      (`unsupported` / `capability_absent`) — never a stripped launch.
 *   4. NEGATIVE CONTROL: a declaring port whose backend DROPS the ref from its
 *      dispatch plan must fail with `invalid_request` — declaration without
 *      carriage is detected, not trusted.
 */

import { dispatchPlanFromTmuxPlan, paneCommand, TmuxTeamBackend } from "../lib/host/tmux-backend";
import type { ParsedTmuxCommand, RunFn, Specialist, TeamLaunchRequest } from "../lib/core/contracts/team-backend";
import { TeamDispatchExecutionTransport } from "../../src/modules/dispatch/workflows/execution-transport-adapters";
import { isTeamLaunchRequestLike } from "../../src/modules/dispatch/workflows/execution-transport-ports";
import {
  validateProjectDefinitionRefV1,
  type ProjectDefinitionRefV1,
} from "../lib/core/contracts/project-definition-ref";

const REF: ProjectDefinitionRefV1 = {
  schema_version: "guild.project_definition_ref.v1",
  project_id: "proj-tdr",
  layer: "project-guild",
  kind: "agent",
  id: "tooling-engineer",
  relative_path: ".guild/agents/tooling-engineer.md",
  content_hash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1",
  source_commit: null,
  specialist_profile_hash: "b".repeat(63) + "2",
  specialist_type_hash: "c".repeat(63) + "3",
  skills: [],
};

/** A RunFn that never touches a real tmux — every invocation succeeds. */
const fakeRun: RunFn = () => ({ status: 0, stdout: "", stderr: "" });

function specialist(withRef: boolean): Specialist {
  return {
    name: "tooling-engineer",
    scope: "lane scope",
    ...(withRef ? { definition_ref: REF } : {}),
  } as Specialist;
}

function request(spec: Specialist, dryRun = true): TeamLaunchRequest {
  return {
    slug: "tdr",
    runId: "run-20260811-010101-tdr",
    cwd: "/tmp/tdr",
    specialists: [spec],
    targetName: "guild-tdr",
    mode: "new-session",
    dryRun,
  };
}

function honestPaneCommand(): string {
  return paneCommand(
    "lane scope",
    "run-20260811-010101-tdr",
    undefined,
    undefined,
    "tooling-engineer",
    false,
    [],
    undefined,
    undefined,
    undefined,
    REF,
  );
}

function taskSpecialist(taskId: string): Specialist {
  return {
    ...specialist(true),
    dispatch_key: `tooling-engineer:${taskId}`,
    taskId,
    task_cell_assignment_path: `.guild/runs/run-20260811-010101-tdr/tasks/${taskId}.json`,
    task_cell_instance_id: `cell-${taskId}`,
  };
}

function probeSession(
  requested: Specialist | readonly Specialist[],
  commands: ParsedTmuxCommand[],
): { outcome: ReturnType<TeamDispatchExecutionTransport["launch"]>; spawn: jest.Mock } {
  const specs = Array.isArray(requested) ? requested : [requested];
  const backend = new TmuxTeamBackend({ run: fakeRun });
  const spawn = jest.fn(() => ({
    ok: true,
    failedCommand: null,
    stderr: "",
    orchestratorPaneId: "%1",
    teammatePaneIds: Object.fromEntries(
      specs.map((spec, index) => [spec.dispatch_key ?? spec.name, `%${index + 2}`]),
    ),
  }));
  const session = {
    sessionExists: () => false,
    windowExists: () => false,
    currentSessionName: () => "guild-tdr",
    preflight: () => ({ ok: true, failures: [] }),
    plan: () => ({ mode: "new-session", targetName: "guild-tdr", commands }),
    spawn,
  };
  const port = new TeamDispatchExecutionTransport({
    transport_id: "tmux",
    backend,
    session,
    supports_definition_injection: true,
  });
  return {
    outcome: port.launch({ ...request(specs[0], false), specialists: specs }),
    spawn,
  };
}

describe("Fix A — tmux backend carries the exact definition_ref with a forwarding proof", () => {
  it("pane command exports and consumes the complete serialized definition_ref", () => {
    const backend = new TmuxTeamBackend({ run: fakeRun });
    const result = backend.launch(request(specialist(true)));
    expect(result.ok).toBe(true);
    const laneCommands = result.plannedCommands.filter((c) => c.includes("split-window"));
    expect(laneCommands.length).toBe(1);
    expect(laneCommands[0]).toContain("GUILD_DEFINITION_REF");
    expect(laneCommands[0]).toContain(JSON.stringify(REF));
    expect(laneCommands[0]).toContain('test "$GUILD_DEFINITION_REF" =');
  });

  it("launch result exposes the exact per-specialist definition_ref on dispatchPlan", () => {
    const backend = new TmuxTeamBackend({ run: fakeRun });
    const result = backend.launch(request(specialist(true)));
    expect(result.dispatchPlan).toBeDefined();
    const entry = (result.dispatchPlan ?? []).find((d) => d.name === "tooling-engineer");
    expect(entry).toBeDefined();
    expect(entry?.definition_ref).toEqual(REF);
  });

  it("a lane WITHOUT a definition_ref gets a plan entry without one (no fabrication)", () => {
    const backend = new TmuxTeamBackend({ run: fakeRun });
    const result = backend.launch(request(specialist(false)));
    const entry = (result.dispatchPlan ?? []).find((d) => d.name === "tooling-engineer");
    expect(entry).toBeDefined();
    expect(entry?.definition_ref ?? undefined).toBeUndefined();
    const laneCommands = result.plannedCommands.filter((c) => c.includes("split-window"));
    expect(laneCommands[0]).not.toContain("GUILD_DEFINITION_REF");
  });

  it("rejects a forged forwarding proof that carries only the expected content_hash", () => {
    const forged = JSON.stringify({
      schema_version: REF.schema_version,
      project_id: REF.project_id,
      layer: REF.layer,
      kind: REF.kind,
      id: "wrong-role",
      relative_path: REF.relative_path,
      content_hash: REF.content_hash,
      source_commit: REF.source_commit,
      skills: [],
    });
    const commands: ParsedTmuxCommand[] = [
      {
        argv: ["tmux", "split-window", "-d", `export GUILD_DEFINITION_REF='${forged}'; claude prompt`],
        display: `tmux split-window -d export GUILD_DEFINITION_REF='${forged}'; claude prompt`,
      },
      {
        argv: ["tmux", "select-pane", "-T", "tooling-engineer"],
        display: "tmux select-pane -T tooling-engineer",
      },
    ];

    const plan = dispatchPlanFromTmuxPlan([specialist(true)], commands);
    expect(plan[0]?.definition_ref ?? undefined).toBeUndefined();
  });

  it("rejects exact export/check text placed after claude has already started", () => {
    const serialized = JSON.stringify(REF);
    const forgedPostSpawn =
      `claude prompt; export GUILD_DEFINITION_REF='${serialized}'; ` +
      `test "$GUILD_DEFINITION_REF" = '${serialized}' || true`;
    const commands: ParsedTmuxCommand[] = [
      {
        argv: ["tmux", "split-window", "-d", forgedPostSpawn],
        display: `tmux split-window -d ${forgedPostSpawn}`,
      },
      {
        argv: ["tmux", "select-pane", "-T", "tooling-engineer"],
        display: "tmux select-pane -T tooling-engineer",
      },
    ];

    const plan = dispatchPlanFromTmuxPlan([specialist(true)], commands);
    expect(plan[0]?.definition_ref ?? undefined).toBeUndefined();
  });

  it("rejects a wrapper launch before an otherwise exact export/check plus direct decoy", () => {
    const serialized = JSON.stringify(REF);
    const forgedPostSpawn =
      `command claude prompt; export GUILD_DEFINITION_REF='${serialized}'; ` +
      `test "$GUILD_DEFINITION_REF" = '${serialized}' || true; claude decoy`;
    const commands: ParsedTmuxCommand[] = [
      {
        argv: ["tmux", "split-window", "-d", forgedPostSpawn],
        display: `tmux split-window -d ${forgedPostSpawn}`,
      },
      {
        argv: ["tmux", "select-pane", "-T", "tooling-engineer"],
        display: "tmux select-pane -T tooling-engineer",
      },
    ];

    const plan = dispatchPlanFromTmuxPlan([specialist(true)], commands);
    expect(plan[0]?.definition_ref ?? undefined).toBeUndefined();
  });

  it("rejects shell-token concatenation that spells a pre-guard host launch", () => {
    const serialized = JSON.stringify(REF);
    const forgedPostSpawn =
      `clau''de prompt; export GUILD_DEFINITION_REF='${serialized}'; ` +
      `test "$GUILD_DEFINITION_REF" = '${serialized}' || { ` +
      `echo '[GUILD_DEFINITION_REF] exact-carriage check failed' >&2; exit 66; }; claude decoy`;
    const commands: ParsedTmuxCommand[] = [
      {
        argv: ["tmux", "split-window", "-d", forgedPostSpawn],
        display: `tmux split-window -d ${forgedPostSpawn}`,
      },
      {
        argv: ["tmux", "select-pane", "-T", "tooling-engineer"],
        display: "tmux select-pane -T tooling-engineer",
      },
    ];

    const plan = dispatchPlanFromTmuxPlan([specialist(true)], commands);
    expect(plan[0]?.definition_ref ?? undefined).toBeUndefined();
  });

  it("rejects proof hidden in a non-executed argv element", () => {
    const commands: ParsedTmuxCommand[] = [
      {
        argv: ["sh", "-c", "printf ARBITRARY_COMMAND", honestPaneCommand()],
        display: "sh -c arbitrary",
      },
      {
        argv: ["tmux", "select-pane", "-T", "tooling-engineer"],
        display: "tmux select-pane -T tooling-engineer",
      },
    ];

    const plan = dispatchPlanFromTmuxPlan([specialist(true)], commands);
    expect(plan[0]?.definition_ref ?? undefined).toBeUndefined();
  });

  it("checks only the executable payload of the exact split-window argv", () => {
    const commands: ParsedTmuxCommand[] = [
      {
        argv: [
          "tmux",
          "split-window",
          "-t",
          honestPaneCommand(),
          "-c",
          "/tmp/tdr",
          "printf ARBITRARY_COMMAND",
        ],
        display: "tmux split-window with proof hidden in target",
      },
      {
        argv: ["tmux", "select-pane", "-T", "tooling-engineer"],
        display: "tmux select-pane -T tooling-engineer",
      },
    ];

    const plan = dispatchPlanFromTmuxPlan([specialist(true)], commands);
    expect(plan[0]?.definition_ref ?? undefined).toBeUndefined();
  });

  it("requires an exact four-element title argv with no trailing arguments", () => {
    const commands: ParsedTmuxCommand[] = [
      {
        argv: ["tmux", "split-window", "-t", "guild-tdr", "-c", "/tmp/tdr", honestPaneCommand()],
        display: "honest split-window",
      },
      {
        argv: ["tmux", "select-pane", "-T", "tooling-engineer", "EXTRA"],
        display: "tmux select-pane -T tooling-engineer EXTRA",
      },
    ];

    const plan = dispatchPlanFromTmuxPlan([specialist(true)], commands);
    expect(plan[0]?.definition_ref ?? undefined).toBeUndefined();
  });

  it("rejects ambiguous duplicate exact titles for one dispatch key", () => {
    const commands: ParsedTmuxCommand[] = [
      {
        argv: ["tmux", "split-window", "-t", "guild-tdr", "-c", "/tmp/tdr", honestPaneCommand()],
        display: "orphan honest split-window",
      },
      {
        argv: ["tmux", "select-pane", "-T", "tooling-engineer"],
        display: "first title",
      },
      {
        argv: ["tmux", "split-window", "-t", "guild-tdr", "-c", "/tmp/tdr", "printf ARBITRARY_LANE"],
        display: "actual malformed lane",
      },
      {
        argv: ["tmux", "select-pane", "-T", "tooling-engineer"],
        display: "duplicate title",
      },
    ];

    const plan = dispatchPlanFromTmuxPlan([specialist(true)], commands);
    expect(plan[0]?.definition_ref ?? undefined).toBeUndefined();
  });

  it("rejects one exact title mixed with a same-key trailing-argv prefix", () => {
    const commands: ParsedTmuxCommand[] = [
      {
        argv: ["tmux", "split-window", "-t", "guild-tdr", "-c", "/tmp/tdr", honestPaneCommand()],
        display: "honest split-window",
      },
      {
        argv: ["tmux", "select-pane", "-T", "tooling-engineer"],
        display: "exact title",
      },
      {
        argv: ["tmux", "select-pane", "-T", "tooling-engineer", "EXTRA"],
        display: "same-key trailing prefix",
      },
    ];

    const plan = dispatchPlanFromTmuxPlan([specialist(true)], commands);
    expect(plan[0]?.definition_ref ?? undefined).toBeUndefined();
  });

  it("binds proof to the requested concrete task lane, not only the shared ref", () => {
    const requested = taskSpecialist("task-b");
    const wrong = taskSpecialist("task-a");
    const wrongPayload = paneCommand(
      "task A scope",
      "run-20260811-010101-tdr",
      undefined,
      wrong.taskId,
      wrong.name,
      false,
      [],
      undefined,
      wrong.task_cell_assignment_path,
      wrong.task_cell_instance_id,
      REF,
    );
    const commands: ParsedTmuxCommand[] = [
      {
        argv: ["tmux", "split-window", "-t", "guild-tdr", "-c", "/tmp/tdr", wrongPayload],
        display: "wrong task-A predecessor",
      },
      {
        argv: ["tmux", "select-pane", "-T", requested.dispatch_key!],
        display: "requested task-B title",
      },
    ];

    const plan = dispatchPlanFromTmuxPlan([requested], commands);
    expect(plan[0]?.definition_ref ?? undefined).toBeUndefined();
  });

  it("keys two same-name task lanes by dispatch identity so proof cannot cross-credit", () => {
    const credited = taskSpecialist("task-a");
    const uncredited = taskSpecialist("task-b");
    const commands: ParsedTmuxCommand[] = [
      {
        argv: [
          "tmux",
          "split-window",
          "-t",
          "guild-tdr",
          "-c",
          "/tmp/tdr",
          paneCommand(
            credited.scope,
            "run-20260811-010101-tdr",
            undefined,
            credited.taskId,
            credited.name,
            false,
            [],
            undefined,
            credited.task_cell_assignment_path,
            credited.task_cell_instance_id,
            REF,
          ),
        ],
        display: "credited task-A payload",
      },
      {
        argv: ["tmux", "select-pane", "-T", credited.dispatch_key!],
        display: "task-A title",
      },
      {
        argv: ["tmux", "split-window", "-t", "guild-tdr", "-c", "/tmp/tdr", "printf MALFORMED_B"],
        display: "uncredited task-B payload",
      },
      {
        argv: ["tmux", "select-pane", "-T", uncredited.dispatch_key!],
        display: "task-B title",
      },
    ];

    const plan = dispatchPlanFromTmuxPlan(
      [credited, uncredited],
      commands,
      "run-20260811-010101-tdr",
    );
    expect(plan.map((entry) => entry.name)).toEqual([
      credited.dispatch_key,
      uncredited.dispatch_key,
    ]);
    expect(plan[0]?.definition_ref).toEqual(REF);
    expect(plan[1]?.definition_ref ?? undefined).toBeUndefined();
  });
});

describe("Fix A — declaring tmux port verifies forwarding and passes", () => {
  it("declared port + ref-carrying request → succeeded (portHonoredInjection proof)", () => {
    const backend = new TmuxTeamBackend({ run: fakeRun });
    const port = new TeamDispatchExecutionTransport({
      transport_id: "tmux",
      backend,
      session: backend,
      supports_definition_injection: true,
    });
    const outcome = port.launch(request(specialist(true)));
    expect(outcome.status).toBe("succeeded");
    expect(outcome.value?.ok).toBe(true);
  });

  it("REAL (non-dry) session launch also succeeds — the session path exposes the same proof", () => {
    const backend = new TmuxTeamBackend({ run: fakeRun });
    const port = new TeamDispatchExecutionTransport({
      transport_id: "tmux",
      backend,
      session: backend,
      supports_definition_injection: true,
    });
    const outcome = port.launch(request(specialist(true), false));
    expect(outcome.status).toBe("succeeded");
  });

  it("honest two-lane same-name task carriage succeeds on backend and session paths", () => {
    const first = taskSpecialist("task-a");
    const second = taskSpecialist("task-b");
    const specs = [first, second];
    const backend = new TmuxTeamBackend({ run: fakeRun });
    const port = new TeamDispatchExecutionTransport({
      transport_id: "tmux",
      backend,
      supports_definition_injection: true,
    });
    const backendOutcome = port.launch({ ...request(first), specialists: specs });
    expect(backendOutcome.status).toBe("succeeded");
    expect(backendOutcome.value?.dispatch_plan?.map((entry) =>
      (entry as { name: string }).name
    )).toEqual([first.dispatch_key, second.dispatch_key]);

    const plan = backend.plan({ ...request(first, false), specialists: specs });
    const { outcome: sessionOutcome, spawn } = probeSession(specs, plan.commands);
    expect(sessionOutcome.status).toBe("succeeded");
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it("NEGATIVE: the session adapter refuses argv that mentions the hash but never consumes the exact ref", () => {
    const backend = new TmuxTeamBackend({ run: fakeRun });
    const forged = JSON.stringify({ ...REF, id: "wrong-role" });
    const session = {
      sessionExists: () => false,
      windowExists: () => false,
      currentSessionName: () => "guild-tdr",
      preflight: () => ({ ok: true, failures: [] }),
      plan: () => ({
        mode: "new-session",
        targetName: "guild-tdr",
        commands: [
          {
            argv: ["tmux", "split-window", "-d", `export GUILD_DEFINITION_REF='${forged}'; claude prompt`],
            display: `tmux split-window -d export GUILD_DEFINITION_REF='${forged}'; claude prompt`,
          },
          {
            argv: ["tmux", "select-pane", "-T", "tooling-engineer"],
            display: "tmux select-pane -T tooling-engineer",
          },
        ],
      }),
      spawn: () => ({
        ok: true,
        failedCommand: null,
        stderr: "",
        orchestratorPaneId: "%1",
        teammatePaneIds: { "tooling-engineer": "%2" },
      }),
    };
    const port = new TeamDispatchExecutionTransport({
      transport_id: "tmux",
      backend,
      session,
      supports_definition_injection: true,
    });

    const outcome = port.launch(request(specialist(true), false));
    expect(outcome.status).toBe("failed");
    expect(outcome.reason_code).toBe("invalid_request");
  });

  it("NEGATIVE: the session adapter refuses exact export/check text placed after claude", () => {
    const backend = new TmuxTeamBackend({ run: fakeRun });
    const serialized = JSON.stringify(REF);
    const forgedPostSpawn =
      `claude prompt; export GUILD_DEFINITION_REF='${serialized}'; ` +
      `test "$GUILD_DEFINITION_REF" = '${serialized}' || true`;
    const spawn = jest.fn(() => ({
      ok: true,
      failedCommand: null,
      stderr: "",
      orchestratorPaneId: "%1",
      teammatePaneIds: { "tooling-engineer": "%2" },
    }));
    const session = {
      sessionExists: () => false,
      windowExists: () => false,
      currentSessionName: () => "guild-tdr",
      preflight: () => ({ ok: true, failures: [] }),
      plan: () => ({
        mode: "new-session",
        targetName: "guild-tdr",
        commands: [
          {
            argv: ["tmux", "split-window", "-d", forgedPostSpawn],
            display: `tmux split-window -d ${forgedPostSpawn}`,
          },
          {
            argv: ["tmux", "select-pane", "-T", "tooling-engineer"],
            display: "tmux select-pane -T tooling-engineer",
          },
        ],
      }),
      spawn,
    };
    const port = new TeamDispatchExecutionTransport({
      transport_id: "tmux",
      backend,
      session,
      supports_definition_injection: true,
    });

    const outcome = port.launch(request(specialist(true), false));
    expect(outcome.status).toBe("failed");
    expect(outcome.reason_code).toBe("invalid_request");
    expect(spawn).not.toHaveBeenCalled();
  });

  it("NEGATIVE: wrapper launch before an exact guard and direct decoy is refused before spawn", () => {
    const backend = new TmuxTeamBackend({ run: fakeRun });
    const serialized = JSON.stringify(REF);
    const forgedPostSpawn =
      `command claude prompt; export GUILD_DEFINITION_REF='${serialized}'; ` +
      `test "$GUILD_DEFINITION_REF" = '${serialized}' || true; claude decoy`;
    const spawn = jest.fn(() => ({
      ok: true,
      failedCommand: null,
      stderr: "",
      orchestratorPaneId: "%1",
      teammatePaneIds: { "tooling-engineer": "%2" },
    }));
    const session = {
      sessionExists: () => false,
      windowExists: () => false,
      currentSessionName: () => "guild-tdr",
      preflight: () => ({ ok: true, failures: [] }),
      plan: () => ({
        mode: "new-session",
        targetName: "guild-tdr",
        commands: [
          {
            argv: ["tmux", "split-window", "-d", forgedPostSpawn],
            display: `tmux split-window -d ${forgedPostSpawn}`,
          },
          {
            argv: ["tmux", "select-pane", "-T", "tooling-engineer"],
            display: "tmux select-pane -T tooling-engineer",
          },
        ],
      }),
      spawn,
    };
    const port = new TeamDispatchExecutionTransport({
      transport_id: "tmux",
      backend,
      session,
      supports_definition_injection: true,
    });

    const outcome = port.launch(request(specialist(true), false));
    expect(outcome.status).toBe("failed");
    expect(outcome.reason_code).toBe("invalid_request");
    expect(spawn).not.toHaveBeenCalled();
  });

  it("NEGATIVE: an eval-defined host wrapper cannot mutate the ref after the guard", () => {
    const backend = new TmuxTeamBackend({ run: fakeRun });
    const serialized = JSON.stringify(REF);
    const forgedMutation =
      `eval 'clau''de() { export GUILD_DEFINITION_REF=mutated; }'; ` +
      `export GUILD_DEFINITION_REF='${serialized}'; ` +
      `test "$GUILD_DEFINITION_REF" = '${serialized}' || { ` +
      `echo '[GUILD_DEFINITION_REF] exact-carriage check failed' >&2; exit 66; }; claude prompt`;
    const spawn = jest.fn(() => ({
      ok: true,
      failedCommand: null,
      stderr: "",
      orchestratorPaneId: "%1",
      teammatePaneIds: { "tooling-engineer": "%2" },
    }));
    const session = {
      sessionExists: () => false,
      windowExists: () => false,
      currentSessionName: () => "guild-tdr",
      preflight: () => ({ ok: true, failures: [] }),
      plan: () => ({
        mode: "new-session",
        targetName: "guild-tdr",
        commands: [
          {
            argv: ["tmux", "split-window", "-d", forgedMutation],
            display: `tmux split-window -d ${forgedMutation}`,
          },
          {
            argv: ["tmux", "select-pane", "-T", "tooling-engineer"],
            display: "tmux select-pane -T tooling-engineer",
          },
        ],
      }),
      spawn,
    };
    const port = new TeamDispatchExecutionTransport({
      transport_id: "tmux",
      backend,
      session,
      supports_definition_injection: true,
    });

    const outcome = port.launch(request(specialist(true), false));
    expect(outcome.status).toBe("failed");
    expect(outcome.reason_code).toBe("invalid_request");
    expect(spawn).not.toHaveBeenCalled();
  });

  it("NEGATIVE: proof in a non-executed argv element is refused before session spawn", () => {
    const backend = new TmuxTeamBackend({ run: fakeRun });
    const spawn = jest.fn(() => ({
      ok: true,
      failedCommand: null,
      stderr: "",
      orchestratorPaneId: "%1",
      teammatePaneIds: { "tooling-engineer": "%2" },
    }));
    const commands = [
      {
        argv: ["sh", "-c", "printf ARBITRARY_COMMAND", honestPaneCommand()],
        display: "sh -c arbitrary",
      },
      {
        argv: ["tmux", "select-pane", "-T", "tooling-engineer"],
        display: "tmux select-pane -T tooling-engineer",
      },
    ];
    const session = {
      sessionExists: () => false,
      windowExists: () => false,
      currentSessionName: () => "guild-tdr",
      preflight: () => ({ ok: true, failures: [] }),
      plan: () => ({ mode: "new-session", targetName: "guild-tdr", commands }),
      spawn,
    };
    const port = new TeamDispatchExecutionTransport({
      transport_id: "tmux",
      backend,
      session,
      supports_definition_injection: true,
    });

    const outcome = port.launch(request(specialist(true), false));
    expect(outcome.status).toBe("failed");
    expect(outcome.reason_code).toBe("invalid_request");
    expect(spawn).not.toHaveBeenCalled();
  });

  it("NEGATIVE: a display-string title decoy cannot associate orphan proof with a lane", () => {
    const backend = new TmuxTeamBackend({ run: fakeRun });
    const spawn = jest.fn(() => ({
      ok: true,
      failedCommand: null,
      stderr: "",
      orchestratorPaneId: "%1",
      teammatePaneIds: { "tooling-engineer": "%2" },
    }));
    const commands = [
      {
        argv: ["tmux", "split-window", "-t", "guild-tdr", "-c", "/tmp/tdr", honestPaneCommand()],
        display: "orphan honest split-window",
      },
      {
        argv: ["printf", "decoy"],
        display: "not a title: select-pane -T tooling-engineer",
      },
      {
        argv: ["tmux", "split-window", "-t", "guild-tdr", "-c", "/tmp/tdr", "printf ARBITRARY_LANE"],
        display: "actual malformed lane",
      },
      {
        argv: ["tmux", "select-pane", "-T", "tooling-engineer"],
        display: "tmux select-pane -T tooling-engineer",
      },
    ];
    const session = {
      sessionExists: () => false,
      windowExists: () => false,
      currentSessionName: () => "guild-tdr",
      preflight: () => ({ ok: true, failures: [] }),
      plan: () => ({ mode: "new-session", targetName: "guild-tdr", commands }),
      spawn,
    };
    const port = new TeamDispatchExecutionTransport({
      transport_id: "tmux",
      backend,
      session,
      supports_definition_injection: true,
    });

    const outcome = port.launch(request(specialist(true), false));
    expect(outcome.status).toBe("failed");
    expect(outcome.reason_code).toBe("invalid_request");
    expect(spawn).not.toHaveBeenCalled();
  });

  it("NEGATIVE: duplicate exact lane titles are refused before session spawn", () => {
    const backend = new TmuxTeamBackend({ run: fakeRun });
    const spawn = jest.fn(() => ({
      ok: true,
      failedCommand: null,
      stderr: "",
      orchestratorPaneId: "%1",
      teammatePaneIds: { "tooling-engineer": "%2" },
    }));
    const commands = [
      {
        argv: ["tmux", "split-window", "-t", "guild-tdr", "-c", "/tmp/tdr", honestPaneCommand()],
        display: "orphan honest split-window",
      },
      {
        argv: ["tmux", "select-pane", "-T", "tooling-engineer"],
        display: "first title",
      },
      {
        argv: ["tmux", "split-window", "-t", "guild-tdr", "-c", "/tmp/tdr", "printf ARBITRARY_LANE"],
        display: "actual malformed lane",
      },
      {
        argv: ["tmux", "select-pane", "-T", "tooling-engineer"],
        display: "duplicate title",
      },
    ];
    const session = {
      sessionExists: () => false,
      windowExists: () => false,
      currentSessionName: () => "guild-tdr",
      preflight: () => ({ ok: true, failures: [] }),
      plan: () => ({ mode: "new-session", targetName: "guild-tdr", commands }),
      spawn,
    };
    const port = new TeamDispatchExecutionTransport({
      transport_id: "tmux",
      backend,
      session,
      supports_definition_injection: true,
    });

    const outcome = port.launch(request(specialist(true), false));
    expect(outcome.status).toBe("failed");
    expect(outcome.reason_code).toBe("invalid_request");
    expect(spawn).not.toHaveBeenCalled();
  });

  it("NEGATIVE: one exact title plus a same-key trailing prefix is refused before spawn", () => {
    const commands: ParsedTmuxCommand[] = [
      {
        argv: ["tmux", "split-window", "-t", "guild-tdr", "-c", "/tmp/tdr", honestPaneCommand()],
        display: "honest split-window",
      },
      {
        argv: ["tmux", "select-pane", "-T", "tooling-engineer"],
        display: "exact title",
      },
      {
        argv: ["tmux", "select-pane", "-T", "tooling-engineer", "EXTRA"],
        display: "same-key trailing prefix",
      },
    ];
    const { outcome, spawn } = probeSession(specialist(true), commands);

    expect(outcome.status).toBe("failed");
    expect(outcome.reason_code).toBe("invalid_request");
    expect(spawn).not.toHaveBeenCalled();
  });

  it("NEGATIVE: a proof-bearing task-A predecessor cannot authorize task B", () => {
    const requested = taskSpecialist("task-b");
    const wrong = taskSpecialist("task-a");
    const wrongPayload = paneCommand(
      "task A scope",
      "run-20260811-010101-tdr",
      undefined,
      wrong.taskId,
      wrong.name,
      false,
      [],
      undefined,
      wrong.task_cell_assignment_path,
      wrong.task_cell_instance_id,
      REF,
    );
    const commands: ParsedTmuxCommand[] = [
      {
        argv: ["tmux", "split-window", "-t", "guild-tdr", "-c", "/tmp/tdr", wrongPayload],
        display: "wrong task-A predecessor",
      },
      {
        argv: ["tmux", "select-pane", "-T", requested.dispatch_key!],
        display: "requested task-B title",
      },
    ];
    const { outcome, spawn } = probeSession(requested, commands);

    expect(outcome.status).toBe("failed");
    expect(outcome.reason_code).toBe("invalid_request");
    expect(spawn).not.toHaveBeenCalled();
  });

  it("NEGATIVE: task A's valid proof cannot authorize an uncredited same-name task B", () => {
    const credited = taskSpecialist("task-a");
    const uncredited = taskSpecialist("task-b");
    const commands: ParsedTmuxCommand[] = [
      {
        argv: [
          "tmux",
          "split-window",
          "-t",
          "guild-tdr",
          "-c",
          "/tmp/tdr",
          paneCommand(
            credited.scope,
            "run-20260811-010101-tdr",
            undefined,
            credited.taskId,
            credited.name,
            false,
            [],
            undefined,
            credited.task_cell_assignment_path,
            credited.task_cell_instance_id,
            REF,
          ),
        ],
        display: "credited task-A payload",
      },
      {
        argv: ["tmux", "select-pane", "-T", credited.dispatch_key!],
        display: "task-A title",
      },
      {
        argv: ["tmux", "split-window", "-t", "guild-tdr", "-c", "/tmp/tdr", "printf MALFORMED_B"],
        display: "uncredited task-B payload",
      },
      {
        argv: ["tmux", "select-pane", "-T", uncredited.dispatch_key!],
        display: "task-B title",
      },
    ];
    const { outcome, spawn } = probeSession([credited, uncredited], commands);

    expect(outcome.status).toBe("failed");
    expect(outcome.reason_code).toBe("invalid_request");
    expect(outcome.detail).toContain(uncredited.dispatch_key);
    expect(spawn).not.toHaveBeenCalled();
  });

  it("NEGATIVE: proof in target/cwd but not argv[6] is refused before spawn", () => {
    const commands: ParsedTmuxCommand[] = [
      {
        argv: [
          "tmux",
          "split-window",
          "-t",
          honestPaneCommand(),
          "-c",
          honestPaneCommand(),
          "printf ARBITRARY_LANE",
        ],
        display: "proof hidden outside payload",
      },
      {
        argv: ["tmux", "select-pane", "-T", "tooling-engineer"],
        display: "exact title",
      },
    ];
    const { outcome, spawn } = probeSession(specialist(true), commands);

    expect(outcome.status).toBe("failed");
    expect(outcome.reason_code).toBe("invalid_request");
    expect(spawn).not.toHaveBeenCalled();
  });

  it("NEGATIVE: an undeclared tmux port refuses the ref-carrying launch (never strips)", () => {
    const backend = new TmuxTeamBackend({ run: fakeRun });
    const port = new TeamDispatchExecutionTransport({
      transport_id: "tmux",
      backend,
      session: backend,
    });
    const outcome = port.launch(request(specialist(true)));
    expect(outcome.status).toBe("unsupported");
    expect(outcome.reason_code).toBe("capability_absent");
  });

  it("NEGATIVE: a declaring port whose backend drops the ref fails invalid_request", () => {
    const backend = new TmuxTeamBackend({ run: fakeRun });
    const stripping = {
      kind: "tmux",
      isAvailable: () => true,
      launch: (req: TeamLaunchRequest) => {
        const honest = backend.launch(req);
        return {
          ...honest,
          dispatchPlan: (honest.dispatchPlan ?? []).map((d) => {
            const { definition_ref: _dropped, ...rest } = d as unknown as Record<string, unknown>;
            void _dropped;
            return rest;
          }) as never,
        };
      },
    };
    const port = new TeamDispatchExecutionTransport({
      transport_id: "tmux",
      backend: stripping as never,
      supports_definition_injection: true,
    });
    const outcome = port.launch(request(specialist(true)));
    expect(outcome.status).toBe("failed");
    expect(outcome.reason_code).toBe("invalid_request");
    expect(outcome.detail).toContain("definition_ref");
  });

  it("NEGATIVE: backend verification cannot cross-credit two same-name task lanes", () => {
    const credited = taskSpecialist("task-a");
    const uncredited = taskSpecialist("task-b");
    const backend = new TmuxTeamBackend({ run: fakeRun });
    const stripping = {
      kind: "tmux",
      isAvailable: () => true,
      launch: (req: TeamLaunchRequest) => {
        const honest = backend.launch(req);
        return {
          ...honest,
          dispatchPlan: (honest.dispatchPlan ?? []).map((entry) => {
            if (entry.name !== uncredited.dispatch_key) return entry;
            const { definition_ref: _dropped, ...rest } = entry;
            void _dropped;
            return rest;
          }),
        };
      },
    };
    const port = new TeamDispatchExecutionTransport({
      transport_id: "tmux",
      backend: stripping as never,
      supports_definition_injection: true,
    });
    const outcome = port.launch({
      ...request(credited),
      specialists: [credited, uncredited],
    });

    expect(outcome.status).toBe("failed");
    expect(outcome.reason_code).toBe("invalid_request");
    expect(outcome.detail).toContain(uncredited.dispatch_key);
  });

  it("NEGATIVE: duplicate backend plan entries cannot satisfy an exact-one proof", () => {
    const requested = taskSpecialist("task-a");
    const backend = new TmuxTeamBackend({ run: fakeRun });
    const duplicate = {
      kind: "tmux",
      isAvailable: () => true,
      launch: (req: TeamLaunchRequest) => {
        const honest = backend.launch(req);
        return {
          ...honest,
          dispatchPlan: [
            ...(honest.dispatchPlan ?? []),
            { name: requested.dispatch_key },
          ],
        };
      },
    };
    const port = new TeamDispatchExecutionTransport({
      transport_id: "tmux",
      backend: duplicate as never,
      supports_definition_injection: true,
    });
    const outcome = port.launch(request(requested));

    expect(outcome.status).toBe("failed");
    expect(outcome.reason_code).toBe("invalid_request");
    expect(outcome.detail).toContain(requested.dispatch_key);
  });

  it("NEGATIVE: backend mutation cannot erase the definition proof being verified", () => {
    const requested = taskSpecialist("task-a");
    const mutating = {
      kind: "tmux",
      isAvailable: () => true,
      launch: () => {
        delete (requested as { definition_ref?: ProjectDefinitionRefV1 }).definition_ref;
        return {
          kind: "tmux",
          ok: true,
          plannedCommands: [],
          orchestratorPaneId: null,
          teammatePaneIds: {},
          notes: [],
          dispatchPlan: [],
        };
      },
    };
    const port = new TeamDispatchExecutionTransport({
      transport_id: "tmux",
      backend: mutating as never,
      supports_definition_injection: true,
    });
    const outcome = port.launch(request(requested));

    expect(outcome.status).toBe("failed");
    expect(outcome.reason_code).toBe("invalid_request");
    expect(outcome.detail).toContain(requested.dispatch_key);
  });

  it("NEGATIVE: session planning mutation cannot skip pre-spawn definition verification", () => {
    const requested = taskSpecialist("task-a");
    const spawn = jest.fn(() => ({
      ok: true,
      failedCommand: null,
      stderr: "",
      orchestratorPaneId: "%1",
      teammatePaneIds: {},
    }));
    const backend = new TmuxTeamBackend({ run: fakeRun });
    const session = {
      sessionExists: () => false,
      windowExists: () => false,
      currentSessionName: () => "guild-tdr",
      preflight: () => ({ ok: true, failures: [] }),
      plan: () => {
        delete (requested as { definition_ref?: ProjectDefinitionRefV1 }).definition_ref;
        return {
          mode: "new-session",
          targetName: "guild-tdr",
          commands: [
            {
              argv: ["tmux", "split-window", "-t", "guild-tdr", "-c", "/tmp/tdr", "printf MALFORMED"],
              display: "malformed lane payload",
            },
            {
              argv: ["tmux", "select-pane", "-T", requested.dispatch_key!],
              display: "lane title",
            },
          ],
        };
      },
      spawn,
    };
    const port = new TeamDispatchExecutionTransport({
      transport_id: "tmux",
      backend,
      session,
      supports_definition_injection: true,
    });
    const outcome = port.launch(request(requested, false));

    expect(outcome.status).toBe("failed");
    expect(outcome.reason_code).toBe("invalid_request");
    expect(spawn).not.toHaveBeenCalled();
  });

  it("NEGATIVE: a null definition_ref is refused before backend launch", () => {
    const malformed = {
      ...specialist(false),
      definition_ref: null,
    } as unknown as Specialist;
    const launch = jest.fn();
    const port = new TeamDispatchExecutionTransport({
      transport_id: "tmux",
      backend: { kind: "tmux", isAvailable: () => true, launch } as never,
      supports_definition_injection: true,
    });
    const outcome = port.launch(request(malformed));

    expect(outcome.status).toBe("failed");
    expect(outcome.reason_code).toBe("invalid_request");
    expect(outcome.detail).toContain("invalid definition_ref");
    expect(launch).not.toHaveBeenCalled();
  });

  it("NEGATIVE: a null definition_ref is refused before session plan or spawn", () => {
    const malformed = {
      ...specialist(false),
      definition_ref: null,
    } as unknown as Specialist;
    const plan = jest.fn();
    const spawn = jest.fn();
    const port = new TeamDispatchExecutionTransport({
      transport_id: "tmux",
      backend: new TmuxTeamBackend({ run: fakeRun }),
      session: {
        sessionExists: () => false,
        windowExists: () => false,
        currentSessionName: () => "guild-tdr",
        preflight: () => ({ ok: true, failures: [] }),
        plan,
        spawn,
      },
      supports_definition_injection: true,
    });
    const outcome = port.launch(request(malformed, false));

    expect(outcome.status).toBe("failed");
    expect(outcome.reason_code).toBe("invalid_request");
    expect(outcome.detail).toContain("invalid definition_ref");
    expect(plan).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
  });

  it.each([
    ["unknown key", { ...REF, extra: true }],
    ["unknown layer", { ...REF, layer: "elsewhere" }],
    ["unsafe path", { ...REF, relative_path: "../outside.md" }],
    ["malformed content hash", { ...REF, content_hash: "sha256:short" }],
    ["movable source commit", { ...REF, source_commit: "main" }],
    ["missing agent identity hash", { ...REF, specialist_profile_hash: null }],
    [
      "duplicate pinned skill identity",
      {
        ...REF,
        skills: [
          { id: "tdd", relative_path: "skills/meta/tdd/SKILL.md", content_hash: `sha256:${"d".repeat(64)}` },
          { id: "tdd", relative_path: "skills/meta/tdd/SKILL.md", content_hash: `sha256:${"e".repeat(64)}` },
        ],
      },
    ],
  ])("NEGATIVE: canonical malformed definition ref (%s) is refused before launch", (_label, badRef) => {
    expect(validateProjectDefinitionRefV1(badRef)).toBeNull();
    const malformed = { ...specialist(false), definition_ref: badRef } as unknown as Specialist;
    const launch = jest.fn();
    const port = new TeamDispatchExecutionTransport({
      transport_id: "tmux",
      backend: { kind: "tmux", isAvailable: () => true, launch } as never,
      supports_definition_injection: true,
    });

    const outcome = port.launch(request(malformed));
    expect(outcome.status).toBe("failed");
    expect(outcome.reason_code).toBe("invalid_request");
    expect(launch).not.toHaveBeenCalled();
  });

  it.each(["name", "dispatch_key"])(
    "NEGATIVE: a stateful %s accessor is refused without being invoked",
    (field) => {
      let reads = 0;
      const malformed: Record<string, unknown> = {
        scope: "lane scope",
        definition_ref: REF,
      };
      if (field !== "name") {
        Object.defineProperty(malformed, "name", {
          enumerable: true,
          value: "tooling-engineer",
        });
      }
      Object.defineProperty(malformed, field, {
        enumerable: true,
        get: () => {
          reads += 1;
          return reads === 1 ? "tooling-engineer:task-a" : "";
        },
      });
      const launch = jest.fn();
      const port = new TeamDispatchExecutionTransport({
        transport_id: "tmux",
        backend: { kind: "tmux", isAvailable: () => true, launch } as never,
        supports_definition_injection: true,
      });

      const outcome = port.launch(request(malformed as unknown as Specialist));
      expect(outcome.status).toBe("failed");
      expect(outcome.reason_code).toBe("invalid_request");
      expect(reads).toBe(0);
      expect(launch).not.toHaveBeenCalled();
    },
  );

  it("NEGATIVE: inherited specialist identity accessors cannot hide as opaque entries", () => {
    let reads = 0;
    const prototype = {} as Record<string, unknown>;
    Object.defineProperties(prototype, {
      name: { get: () => { reads += 1; return "tooling-engineer"; } },
      definition_ref: { get: () => { reads += 1; return REF; } },
    });
    const inherited = Object.create(prototype) as Specialist;
    inherited.scope = "lane scope";
    const launch = jest.fn();
    const port = new TeamDispatchExecutionTransport({
      transport_id: "tmux",
      backend: { kind: "tmux", isAvailable: () => true, launch } as never,
      supports_definition_injection: true,
    });

    const outcome = port.launch(request(inherited));
    expect(outcome.status).toBe("failed");
    expect(outcome.reason_code).toBe("invalid_request");
    expect(reads).toBe(0);
    expect(launch).not.toHaveBeenCalled();
  });

  it("NEGATIVE: a stateful session commands getter is refused before spawn", () => {
    const requested = taskSpecialist("task-a");
    let reads = 0;
    const spawn = jest.fn();
    const plan = {
      mode: "new-session",
      targetName: "guild-tdr",
      get commands(): ParsedTmuxCommand[] {
        reads += 1;
        return reads === 1
          ? new TmuxTeamBackend({ run: fakeRun }).plan(request(requested, false)).commands
          : [{ argv: ["tmux", "split-window", "printf MALFORMED"], display: "malformed" }];
      },
    };
    const port = new TeamDispatchExecutionTransport({
      transport_id: "tmux",
      backend: new TmuxTeamBackend({ run: fakeRun }),
      session: {
        sessionExists: () => false,
        windowExists: () => false,
        currentSessionName: () => "guild-tdr",
        preflight: () => ({ ok: true, failures: [] }),
        plan: () => plan,
        spawn,
      },
      supports_definition_injection: true,
    });

    const outcome = port.launch(request(requested, false));
    expect(outcome.status).toBe("failed");
    expect(outcome.reason_code).toBe("invalid_request");
    expect(reads).toBe(0);
    expect(spawn).not.toHaveBeenCalled();
  });

  it.each([
    ["duplicate", (first: Specialist, second: Specialist) => ({ ...second, dispatch_key: first.dispatch_key })],
    ["empty", (_first: Specialist, second: Specialist) => ({ ...second, dispatch_key: "" })],
  ])("NEGATIVE: %s dispatch identities are refused before backend launch", (_label, mutate) => {
    const first = taskSpecialist("task-a");
    const second = mutate(first, taskSpecialist("task-b"));
    const launch = jest.fn(() => ({
      kind: "tmux",
      ok: true,
      plannedCommands: [],
      orchestratorPaneId: null,
      teammatePaneIds: {},
      notes: [],
      dispatchPlan: [],
    }));
    const port = new TeamDispatchExecutionTransport({
      transport_id: "tmux",
      backend: { kind: "tmux", isAvailable: () => true, launch } as never,
      supports_definition_injection: true,
    });
    const outcome = port.launch({ ...request(first), specialists: [first, second] });

    expect(outcome.status).toBe("failed");
    expect(outcome.reason_code).toBe("invalid_request");
    expect(launch).not.toHaveBeenCalled();
  });

  it("preserves the exported legacy structural seam for opaque specialist entries", () => {
    expect(isTeamLaunchRequestLike({
      slug: "legacy",
      runId: "run-legacy",
      cwd: "/tmp/legacy",
      specialists: ["opaque-legacy-specialist"],
      targetName: "guild-legacy",
      mode: "new-session",
      dryRun: true,
    })).toBe(true);
  });

  it("fails closed instead of throwing when an untrusted request accessor throws", () => {
    const hostile = {
      get slug(): string {
        throw new Error("hostile getter");
      },
      runId: "run-hostile",
      cwd: "/tmp/hostile",
      specialists: [],
      targetName: "guild-hostile",
      mode: "new-session",
      dryRun: true,
    };

    expect(isTeamLaunchRequestLike(hostile)).toBe(false);
  });

  it("refuses a stateful request accessor without invoking backend launch", () => {
    let reads = 0;
    const hostile: Record<string, unknown> = {
      slug: "hostile",
      runId: "run-hostile",
      cwd: "/tmp/hostile",
      targetName: "guild-hostile",
      mode: "new-session",
      dryRun: true,
    };
    Object.defineProperty(hostile, "specialists", {
      enumerable: true,
      get: () => {
        reads += 1;
        return reads === 1 ? [specialist(true)] : [];
      },
    });
    const launch = jest.fn();
    const port = new TeamDispatchExecutionTransport({
      transport_id: "tmux",
      backend: { kind: "tmux", isAvailable: () => true, launch } as never,
      supports_definition_injection: true,
    });

    const outcome = port.launch(hostile as unknown as TeamLaunchRequest);
    expect(outcome.status).toBe("failed");
    expect(outcome.reason_code).toBe("invalid_request");
    expect(reads).toBe(0);
    expect(launch).not.toHaveBeenCalled();
  });
});
