/**
 * plr-wi-15-4 — every isolated lane launch path exports GUILD_TASK_CELL_INSTANCE_ID
 * with a written guild.task_assignment.v2 admitted through reserveInstance, or
 * refuses the spawn.
 *
 * Two enforcing calls, each with its own fixture:
 *   - assertLaneInstanceExported (pure) in paneCommand and every PaneAdapter
 *     command()/env(): a task id without an instance id throws.
 *   - assertIsolatedLaneAdmitted (disk) in the tmux / cmux / remote real launch:
 *     no reserved attempt or no matching v2 assignment => nothing spawns.
 * Planted control in each block: the admitted lane launches.
 */
import { afterAll, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { buildAdapters } from "../pane-adapter";
import { CmuxTeamBackend } from "./cmux-backend";
import { TmuxTeamBackend, paneCommand } from "./tmux-backend";
import type { PaneSpec, RunFn, Specialist, TeamLaunchRequest } from "../core/contracts/team-backend";
import {
  NATIVE_CLAUDE_PACKAGE_IDENTITY_FILE,
  NATIVE_CLAUDE_PACKAGE_IDENTITY_SCHEMA,
  computePhysicalNativeClaudePayloadDigest,
} from "../release-package-identity";
import { reserveInstance, reserveRefused } from "../../../src/domains/dispatch";
import { admitLane, tmpLaunchRoot } from "./__tests__/admit-lane";

const RUN = "run-wi154-launch";

const PLUGIN_ROOT = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "wi154-plugin-")));
fs.mkdirSync(path.join(PLUGIN_ROOT, ".claude-plugin"), { recursive: true });
fs.writeFileSync(
  path.join(PLUGIN_ROOT, ".claude-plugin", "plugin.json"),
  JSON.stringify({ name: "guild", version: "2.7.0-beta.14" }),
);
fs.writeFileSync(
  path.join(PLUGIN_ROOT, NATIVE_CLAUDE_PACKAGE_IDENTITY_FILE),
  `${JSON.stringify({
    schema_version: NATIVE_CLAUDE_PACKAGE_IDENTITY_SCHEMA,
    release_version: "2.7.0-beta.14",
    payload_digest: computePhysicalNativeClaudePayloadDigest(PLUGIN_ROOT),
  }, null, 2)}\n`,
);
afterAll(() => fs.rmSync(PLUGIN_ROOT, { recursive: true, force: true }));

function recordingRun(): { run: RunFn; calls: string[][] } {
  const calls: string[][] = [];
  const run: RunFn = (_cmd, args) => {
    calls.push(args);
    if (args[0] === "new-pane") return { status: 0, stdout: JSON.stringify({ surface_id: "surface:1" }), stderr: "" };
    return { status: 0, stdout: "", stderr: "" };
  };
  return { run, calls };
}

function lane(taskId: string, instanceId: string | undefined): Specialist {
  return {
    name: "backend",
    scope: "api",
    dependsOn: [],
    taskId,
    ...(instanceId ? { task_cell_instance_id: instanceId } : {}),
    host_kind: "claude",
  } as Specialist;
}

function request(cwd: string, specialists: Specialist[]): TeamLaunchRequest {
  return {
    slug: "wi154",
    runId: RUN,
    cwd,
    specialists,
    targetName: "guild-wi154",
    mode: "new-session",
    dryRun: false,
  };
}

const spawned = (calls: string[][]): boolean =>
  calls.some((a) => a[0] === "new-session" || a[0] === "split-window" || a[0] === "new-window" || a[0] === "new-pane");

describe("plr-wi-15-4 · pure: a task id never leaves a builder without its instance id", () => {
  const base: PaneSpec = { name: "backend", scope: "api", runId: RUN, slug: "s", prompt: "p", hostKind: "claude", taskId: "T1" };
  const adapters = Object.entries(buildAdapters()).filter(([, a]) => a !== undefined);

  it("covers every registered adapter", () => {
    expect(adapters.length).toBeGreaterThanOrEqual(4);
  });

  it.each(adapters)("adapter %s refuses command() and env() without an instance id", (hostKind, adapter) => {
    const spec = { ...base, hostKind: hostKind as PaneSpec["hostKind"] };
    expect(() => adapter!.command(spec)).toThrow(/^isolated_spawn_refused:/);
    expect(() => adapter!.env(spec)).toThrow(/^isolated_spawn_refused:/);
    // CONTROL: the same spec with its instance id exports both.
    const ok = { ...spec, taskCellInstanceId: "T1.a1.i-1" };
    expect(adapter!.command(ok)).toContain("GUILD_TASK_CELL_INSTANCE_ID");
    expect(adapter!.env(ok)["GUILD_TASK_CELL_INSTANCE_ID"]).toBe("T1.a1.i-1");
  });

  it("paneCommand refuses a task id without an instance id", () => {
    expect(() => paneCommand("p", RUN, undefined, "T1", "backend")).toThrow(/^isolated_spawn_refused:/);
    // CONTROL
    const ok = paneCommand("p", RUN, undefined, "T1", "backend", false, [], undefined, undefined, "T1.a1.i-1");
    expect(ok).toContain("export GUILD_TASK_CELL_INSTANCE_ID=T1.a1.i-1");
  });
});

describe("plr-wi-15-4 · disk: a real launch spawns only admitted instances", () => {
  const tmux = (run: RunFn) =>
    new TmuxTeamBackend({ run, env: { GUILD_PLUGIN_ROOT: PLUGIN_ROOT } as NodeJS.ProcessEnv, pluginOwnerRoot: PLUGIN_ROOT });

  it("tmux: an instance id with no reserved attempt and no assignment spawns nothing", () => {
    const cwd = tmpLaunchRoot();
    const { run, calls } = recordingRun();
    const r = tmux(run).launch(request(cwd, [lane("T1", "T1.a1.i-1")]));
    expect(r.ok).toBe(false);
    expect(r.notes.join(" ")).toMatch(/isolated_spawn_refused:.*no admitted slot/);
    expect(spawned(calls)).toBe(false);
  });

  it("tmux: a reserved slot without a written v2 assignment spawns nothing", () => {
    const cwd = tmpLaunchRoot();
    const claim = reserveInstance({ cwd, run_id: RUN, logical_task_id: "T1", attempt: 1 });
    expect(reserveRefused(claim)).toBe(false);
    const { run, calls } = recordingRun();
    const r = tmux(run).launch(request(cwd, [lane("T1", "T1.a1.i-1")]));
    expect(r.ok).toBe(false);
    expect(r.notes.join(" ")).toMatch(/no readable guild\.task_assignment\.v2/);
    expect(spawned(calls)).toBe(false);
  });

  it("tmux: an assignment for a different instance does not admit this one", () => {
    const cwd = tmpLaunchRoot();
    admitLane(cwd, RUN, "T1", "T1.a1.i-other");
    const { run, calls } = recordingRun();
    const r = tmux(run).launch(request(cwd, [lane("T1", "T1.a1.i-1")]));
    expect(r.ok).toBe(false);
    expect(spawned(calls)).toBe(false);
  });

  it("tmux: a lane with no task id spawns nothing", () => {
    const cwd = tmpLaunchRoot();
    const { run, calls } = recordingRun();
    const r = tmux(run).launch(request(cwd, [{ name: "backend", scope: "api", dependsOn: [] }]));
    expect(r.ok).toBe(false);
    expect(spawned(calls)).toBe(false);
  });

  it("CONTROL tmux: the admitted instance reaches the spawn with its instance id exported", () => {
    const cwd = tmpLaunchRoot();
    admitLane(cwd, RUN, "T1", "T1.a1.i-1");
    const { run, calls } = recordingRun();
    tmux(run).launch(request(cwd, [lane("T1", "T1.a1.i-1")]));
    expect(spawned(calls)).toBe(true);
    expect(calls.flat().join("\n")).toContain("GUILD_TASK_CELL_INSTANCE_ID=T1.a1.i-1");
  });

  const cmux = (run: RunFn) =>
    new CmuxTeamBackend({
      workspaceId: "workspace:1",
      run,
      resolveClaudeActivation: () => ({ args: ["--plugin-dir", PLUGIN_ROOT], pluginRoot: PLUGIN_ROOT }),
    });

  it("cmux: an unadmitted instance opens no surface", () => {
    const cwd = tmpLaunchRoot();
    const { run, calls } = recordingRun();
    const r = cmux(run).launch({ ...request(cwd, [lane("T1", "T1.a1.i-1")]), mode: "in-session" });
    expect(r.ok).toBe(false);
    expect(r.notes.join(" ")).toMatch(/isolated_spawn_refused:/);
    expect(spawned(calls)).toBe(false);
  });

  it("CONTROL cmux: the admitted instance opens its surface", () => {
    const cwd = tmpLaunchRoot();
    admitLane(cwd, RUN, "T1", "T1.a1.i-1");
    const { run, calls } = recordingRun();
    const r = cmux(run).launch({ ...request(cwd, [lane("T1", "T1.a1.i-1")]), mode: "in-session" });
    expect(r.ok).toBe(true);
    expect(spawned(calls)).toBe(true);
  });
});
