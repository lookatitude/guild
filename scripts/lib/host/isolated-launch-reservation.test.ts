/**
 * plr-wi-15-4 rework r2 — the launch claim belongs to the RESERVATION
 * (run, task, attempt), not to an instance id.
 *
 * Enforcing calls (each fixture fails when its call is removed):
 *   - claimIsolatedLaunches (src/domains/dispatch/isolated-launch-admission.ts):
 *     one O_EXCL claim per reserved attempt, so a second instance under the same
 *     attempt refuses and the run's live count equals the spawned count.
 *   - assertReservationAdmitsInstance (same file): the attempt record names the
 *     one instance it admitted; any other instance id refuses, as does a
 *     terminal attempt.
 * Planted controls: the reserved instance launches once; a second reserved
 * attempt launches once.
 */
import { afterAll, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { TmuxTeamBackend } from "./tmux-backend";
import type { RunFn, Specialist, TeamLaunchRequest } from "../core/contracts/team-backend";
import {
  NATIVE_CLAUDE_PACKAGE_IDENTITY_FILE,
  NATIVE_CLAUDE_PACKAGE_IDENTITY_SCHEMA,
  computePhysicalNativeClaudePayloadDigest,
} from "../release-package-identity";
import {
  claimIsolatedLaunches,
  countLiveRunInstances,
  launchClaimPath,
  reserveInstance,
  reserveRefused,
  taskCellPaths,
} from "../../../src/domains/dispatch";
import { admitLane, tmpLaunchRoot, writeLaneAssignment } from "./__tests__/admit-lane";

const RUN = "run-wi154-r2";
const REPO = path.resolve(__dirname, "../../..");
const GUILD_RUN_JS = path.join(REPO, "runtime/scripts/guild-run.js");

const PLUGIN_ROOT = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "wi154r2-plugin-")));
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
    return { status: 0, stdout: "", stderr: "" };
  };
  return { run, calls };
}

const spawned = (calls: string[][]): boolean =>
  calls.some((a) => a[0] === "new-session" || a[0] === "split-window" || a[0] === "new-window");

function lane(taskId: string, instanceId: string): Specialist {
  return { name: "backend", scope: "api", dependsOn: [], taskId, task_cell_instance_id: instanceId, host_kind: "claude" } as Specialist;
}

function request(cwd: string, specialists: Specialist[], targetName: string): TeamLaunchRequest {
  return { slug: "wi154r2", runId: RUN, cwd, specialists, targetName, mode: "new-session", dryRun: false };
}

const tmux = (run: RunFn) =>
  new TmuxTeamBackend({ run, env: { GUILD_PLUGIN_ROOT: PLUGIN_ROOT } as NodeJS.ProcessEnv, pluginOwnerRoot: PLUGIN_ROOT });

function reserveBare(cwd: string, taskId: string): void {
  const claim = reserveInstance({ cwd, run_id: RUN, logical_task_id: taskId, attempt: 1, max: 4 });
  if (reserveRefused(claim)) throw new Error(claim.reason);
}

function launchEach(cwd: string, taskId: string, instances: string[]): { outcomes: boolean[]; notes: string[] } {
  const outcomes: boolean[] = [];
  const notes: string[] = [];
  instances.forEach((instanceId, i) => {
    const { run, calls } = recordingRun();
    const r = tmux(run).launch(request(cwd, [lane(taskId, instanceId)], `guild-wi154r2-${taskId}-${i}`));
    outcomes.push(spawned(calls));
    notes.push(r.notes.join(" "));
  });
  return { outcomes, notes };
}

describe("plr-wi-15-4 r2 · one reservation admits one launch", () => {
  it("codex repro: one reserved attempt + five instance assignments -> one spawn; live count matches", () => {
    const cwd = tmpLaunchRoot();
    reserveBare(cwd, "T1");
    const instances = [1, 2, 3, 4, 5].map((n) => `T1.a1.i-${n}`);
    for (const id of instances) writeLaneAssignment(cwd, RUN, "T1", id);
    const { outcomes, notes } = launchEach(cwd, "T1", instances);
    expect(outcomes).toEqual([true, false, false, false, false]);
    for (const n of notes.slice(1)) {
      expect(n).toMatch(/isolated_spawn_refused:.*attempt 1 of T1 already launched instance T1\.a1\.i-1/);
    }
    expect(countLiveRunInstances({ cwd, run_id: RUN })).toBe(outcomes.filter(Boolean).length);
  });

  it("two instances of one attempt in one batch -> nothing spawns and no claim survives", () => {
    const cwd = tmpLaunchRoot();
    reserveBare(cwd, "T1");
    writeLaneAssignment(cwd, RUN, "T1", "T1.a1.i-1");
    writeLaneAssignment(cwd, RUN, "T1", "T1.a1.i-2");
    const { run, calls } = recordingRun();
    const r = tmux(run).launch(request(cwd, [lane("T1", "T1.a1.i-1"), lane("T1", "T1.a1.i-2")], "guild-wi154r2-batch"));
    expect(r.ok).toBe(false);
    expect(spawned(calls)).toBe(false);
    expect(fs.existsSync(path.join(cwd, launchClaimPath({ runId: RUN, logicalTaskId: "T1" })))).toBe(false);
  });

  it("a reservation that names its instance refuses any other instance, then admits its own", () => {
    const cwd = tmpLaunchRoot();
    admitLane(cwd, RUN, "T1", "T1.a1.i-1");
    writeLaneAssignment(cwd, RUN, "T1", "T1.a1.i-2");
    const { outcomes, notes } = launchEach(cwd, "T1", ["T1.a1.i-2", "T1.a1.i-1", "T1.a1.i-1"]);
    expect(notes[0]).toMatch(/isolated_spawn_refused:.*attempt 1 of T1 admitted instance T1\.a1\.i-1, not T1\.a1\.i-2/);
    // CONTROL: the reserved instance launches exactly once.
    expect(outcomes).toEqual([false, true, false]);
  });

  it("a written attempt record binds its instance; a terminal attempt launches nothing", () => {
    const cwd = tmpLaunchRoot();
    admitLane(cwd, RUN, "T1", "T1.a1.i-1");
    writeLaneAssignment(cwd, RUN, "T1", "T1.a1.i-2");
    const attemptPath = path.join(
      cwd,
      taskCellPaths({ run_id: RUN, logical_task_id: "T1", attempt: 1, instance_id: "T1.a1.i-1" }).attempt_path,
    );
    const record = {
      schema_version: "guild.task_attempt.v1",
      run_id: RUN,
      logical_task_id: "T1",
      attempt: 1,
      instance_id: "T1.a1.i-1",
      terminal_state: null,
    };
    fs.writeFileSync(attemptPath, JSON.stringify(record));
    expect(() =>
      claimIsolatedLaunches({ cwd, runId: RUN, launchId: "x", lanes: [{ logicalTaskId: "T1", instanceId: "T1.a1.i-2" }] }),
    ).toThrow(/admitted instance T1\.a1\.i-1, not T1\.a1\.i-2/);
    fs.writeFileSync(attemptPath, JSON.stringify({ ...record, terminal_state: "failed" }));
    expect(() =>
      claimIsolatedLaunches({ cwd, runId: RUN, launchId: "y", lanes: [{ logicalTaskId: "T1", instanceId: "T1.a1.i-1" }] }),
    ).toThrow(/attempt 1 of T1 is terminal \(failed\)/);
  });

  it("CONTROL: a second reserved attempt of another task launches once", () => {
    const cwd = tmpLaunchRoot();
    admitLane(cwd, RUN, "T1", "T1.a1.i-1");
    admitLane(cwd, RUN, "T2", "T2.a1.i-1");
    expect(launchEach(cwd, "T1", ["T1.a1.i-1"]).outcomes).toEqual([true]);
    expect(launchEach(cwd, "T2", ["T2.a1.i-1", "T2.a1.i-1"]).outcomes).toEqual([true, false]);
    expect(countLiveRunInstances({ cwd, run_id: RUN })).toBe(2);
  });
});

describe("plr-wi-15-4 r2 · guild-run wrapper uses the reservation claim (compiled runtime)", () => {
  const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "wi154r2-run-")));
  const bin = path.join(scratch, "bin");
  const marker = path.join(scratch, "started");
  const NODE = spawnSync("which", ["node"], { encoding: "utf8" }).stdout.trim();
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, "claude"), `#!/bin/sh\necho started >> "${marker}"\necho "{}"\n`, { mode: 0o755 });
  afterAll(() => fs.rmSync(scratch, { recursive: true, force: true }));

  function guildRun(cwd: string, instanceId: string): { exit: number | null; stderr: string; started: boolean } {
    fs.rmSync(marker, { force: true });
    const r = spawnSync(NODE, [GUILD_RUN_JS, "--host", "claude", "--cwd", cwd, "--prompt", "harmless"], {
      encoding: "utf8",
      env: {
        HOME: os.homedir(),
        PATH: `${bin}:${path.dirname(NODE)}:/usr/bin:/bin`,
        GUILD_RUN_ID: RUN,
        GUILD_TASK_ID: "T1",
        GUILD_TASK_CELL_INSTANCE_ID: instanceId,
      },
    });
    return { exit: r.status, stderr: r.stderr, started: fs.existsSync(marker) };
  }

  it("one reserved attempt, two instance ids: the first starts, the second never does", () => {
    const cwd = tmpLaunchRoot();
    fs.mkdirSync(path.join(cwd, ".git"));
    reserveBare(cwd, "T1");
    writeLaneAssignment(cwd, RUN, "T1", "T1.a1.i-1");
    writeLaneAssignment(cwd, RUN, "T1", "T1.a1.i-2");
    const first = guildRun(cwd, "T1.a1.i-1");
    expect(first.exit).toBe(0);
    expect(first.started).toBe(true);
    const second = guildRun(cwd, "T1.a1.i-2");
    expect(second.exit).toBe(1);
    expect(second.stderr).toMatch(/isolated_spawn_refused:.*already launched instance T1\.a1\.i-1/);
    expect(second.started).toBe(false);
  });
});
