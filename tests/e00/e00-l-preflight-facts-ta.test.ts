/**
 * E00-T0 · current preflight failure (F3) · independent red for the typed
 * pre-action fact on the session dispatch path.
 *
 * TeamDispatchExecutionTransport.launchThroughSession runs session.plan() and then
 * session.spawn(plan). The launcher seals reserved lanes failed only when the
 * outcome carries facts.substrate_spawned === false; anything else parks them as
 * orphaned (unknown launch). So:
 *   - a plan() that throws has spawned nothing and must say so
 *     (substrate_spawned === false, spawn never entered) — red today;
 *   - a spawn() that was entered and then throws may have launched panes and
 *     must NEVER claim substrate_spawned === false (unknown stays unknown) — control.
 *
 * Mechanics only: the production transport class with an injected session seam
 * shaped like TmuxTeamBackend's session half (as in mh-04-execution-transports),
 * counting real calls. No tmux, no subprocess, no model. The request points at an
 * owned temp root holding a minimal Guild config.
 */
import { describe, it, expect, afterEach } from "bun:test";
import * as fs from "fs";
import * as path from "path";

import { TeamDispatchExecutionTransport, type TeamSessionSeamLike } from "../../src/domains/dispatch";
import { InProcessTeamBackend, type Specialist, type TeamLaunchRequest } from "../../scripts/lib/team-backend";
import { ownedTempDir, teardownOwned } from "./support/e00-harness";

afterEach(teardownOwned);

const SPECIALIST: Specialist = { name: "architect", scope: "boundaries", dependsOn: [] };

function request(): TeamLaunchRequest {
  const cwd = ownedTempDir("guild-e00-lpf-");
  fs.mkdirSync(path.join(cwd, ".guild"), { recursive: true });
  fs.writeFileSync(path.join(cwd, ".guild", "guild.yaml"), "schema_version: guild.root.v1\nkind: project\n");
  return { slug: "lpf", runId: "run-e00-lpf", cwd, specialists: [SPECIALIST], targetName: "guild-lpf", mode: "new-session", dryRun: false };
}

/** A session seam with call counters; overrides replace plan/spawn. */
function seam(overrides: { plan?: (r: { targetName: string; mode: string }) => unknown; spawn?: () => unknown } = {}) {
  const calls = { plan: 0, spawn: 0 };
  const s = {
    sessionExists: () => false,
    windowExists: () => false,
    currentSessionName: () => "guild-session",
    preflight: () => ({ ok: true, failures: [] }),
    plan: (r: { targetName: string; mode: string }) => {
      calls.plan += 1;
      return overrides.plan ? overrides.plan(r) : { mode: r.mode, targetName: r.targetName, commands: [{ display: "tmux new-session -d -s guild-lpf" }] };
    },
    spawn: () => {
      calls.spawn += 1;
      return overrides.spawn
        ? overrides.spawn()
        : { ok: true, failedCommand: null, stderr: "", orchestratorPaneId: "%1", teammatePaneIds: { architect: "%2" } };
    },
  };
  return { session: s as unknown as TeamSessionSeamLike, calls };
}

function launch(session: TeamSessionSeamLike) {
  const port = new TeamDispatchExecutionTransport({ transport_id: "tmux", backend: new InProcessTeamBackend(), session });
  return port.launch(request());
}

describe("F3 red · a session plan that throws before any spawn reports the typed pre-action fact", () => {
  it("R-L-1 plan() throws (activation re-verification refusal): failed, spawn never entered, facts.substrate_spawned === false", () => {
    const { session, calls } = seam({ plan: () => { throw new Error("launcher-owning Claude plugin root is invalid: native Claude complete payload digest differs"); } });
    const out = launch(session);
    expect({ status: out.status, plan_calls: calls.plan, spawn_calls: calls.spawn }).toEqual({ status: "failed", plan_calls: 1, spawn_calls: 0 });
    expect(out.facts["substrate_spawned"]).toBe(false);
  });
});

describe("F3 controls · launched or unknown outcomes never claim pre-action (must stay green)", () => {
  it("C-L-1 spawn() entered then throws: failed, spawn entered once, substrate_spawned is NOT false", () => {
    const { session, calls } = seam({ spawn: () => { throw new Error("tmux server vanished mid-launch"); } });
    const out = launch(session);
    expect({ status: out.status, plan_calls: calls.plan, spawn_calls: calls.spawn }).toEqual({ status: "failed", plan_calls: 1, spawn_calls: 1 });
    expect(out.facts["substrate_spawned"] === false).toBe(false);
  });

  it("C-L-2 spawn() entered and reports a failed command: failed, spawn entered once, substrate_spawned is NOT false", () => {
    const { session, calls } = seam({
      spawn: () => ({ ok: false, failedCommand: { display: "tmux split-window -t guild-lpf" }, stderr: "no space for new pane", orchestratorPaneId: "", teammatePaneIds: {} }),
    });
    const out = launch(session);
    expect({ status: out.status, spawn_calls: calls.spawn, failed_command: out.value?.failed_command }).toEqual({ status: "failed", spawn_calls: 1, failed_command: "tmux split-window -t guild-lpf" });
    expect(out.facts["substrate_spawned"] === false).toBe(false);
  });

  it("C-L-3 normal plan and spawn: succeeded, spawn entered once, substrate_spawned is NOT false", () => {
    const { session, calls } = seam();
    const out = launch(session);
    expect({ status: out.status, ok: out.value?.ok, spawn_calls: calls.spawn }).toEqual({ status: "succeeded", ok: true, spawn_calls: 1 });
    expect(out.facts["substrate_spawned"] === false).toBe(false);
  });

  it("C-L-4 an existing pre-spawn refusal (plan that cannot be snapshotted) already reports substrate_spawned === false with no spawn", () => {
    const { session, calls } = seam({ plan: () => null });
    const out = launch(session);
    expect({ status: out.status, plan_calls: calls.plan, spawn_calls: calls.spawn, substrate_spawned: out.facts["substrate_spawned"] })
      .toEqual({ status: "failed", plan_calls: 1, spawn_calls: 0, substrate_spawned: false });
  });
});
