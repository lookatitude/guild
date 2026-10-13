/**
 * plr-wi-15-4 rework r1 — admission is one launch per instance, on every spawn
 * path, including the guild-run wrapper.
 *
 * Enforcing calls (each fixture fails when its call is removed):
 *   - claimIsolatedLaunches (src/domains/dispatch/isolated-launch-admission.ts):
 *     the real tmux / cmux / remote launch consumes the instance's one launch
 *     claim with an O_EXCL create; a second launch of the same identity, under
 *     any cwd spelling, refuses.
 *   - admitWrapperLaunch (scripts/guild-run.ts): a child that inherits
 *     GUILD_RUN_ID + GUILD_TASK_ID is admitted through that same claim, and an
 *     empty GUILD_TASK_CELL_INSTANCE_ID counts as absent.
 * Planted controls: a fresh admission launches exactly once; a wrapper call
 * with no lane identity still spawns.
 */
import { afterAll, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { CmuxTeamBackend } from "./cmux-backend";
import { TmuxTeamBackend } from "./tmux-backend";
import { MockTransport, RemoteTeamBackend } from "../team-backend";
import { resolveAdapter } from "../pane-adapter";
import type { RunFn, Specialist, TeamLaunchRequest } from "../core/contracts/team-backend";
import {
  NATIVE_CLAUDE_PACKAGE_IDENTITY_FILE,
  NATIVE_CLAUDE_PACKAGE_IDENTITY_SCHEMA,
  computePhysicalNativeClaudePayloadDigest,
} from "../release-package-identity";
import { claimIsolatedLaunches, launchClaimPath } from "../../../src/domains/dispatch";
import { admitLane, tmpLaunchRoot } from "./__tests__/admit-lane";

const RUN = "run-wi154-claim";
const REPO = path.resolve(__dirname, "../../..");
const GUILD_RUN_JS = path.join(REPO, "runtime/scripts/guild-run.js");

const PLUGIN_ROOT = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "wi154c-plugin-")));
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

const spawned = (calls: string[][]): boolean =>
  calls.some((a) => a[0] === "new-session" || a[0] === "split-window" || a[0] === "new-window" || a[0] === "new-pane");

function lane(taskId: string, instanceId: string): Specialist {
  return { name: "backend", scope: "api", dependsOn: [], taskId, task_cell_instance_id: instanceId, host_kind: "claude" } as Specialist;
}

function request(cwd: string, specialists: Specialist[], targetName: string): TeamLaunchRequest {
  return { slug: "wi154c", runId: RUN, cwd, specialists, targetName, mode: "new-session", dryRun: false };
}

const tmux = (run: RunFn) =>
  new TmuxTeamBackend({ run, env: { GUILD_PLUGIN_ROOT: PLUGIN_ROOT } as NodeJS.ProcessEnv, pluginOwnerRoot: PLUGIN_ROOT });

describe("plr-wi-15-4 r1 · backends: one admission, one launch", () => {
  it("codex repro: reserve once + one assignment, five tmux launches alternating real/symlinked cwd -> one spawn", () => {
    const cwd = tmpLaunchRoot();
    const link = `${cwd}-link`;
    fs.symlinkSync(cwd, link);
    admitLane(cwd, RUN, "T1", "T1.a1.i-1");
    const outcomes: boolean[] = [];
    const notes: string[] = [];
    for (let i = 0; i < 5; i++) {
      const { run, calls } = recordingRun();
      const r = tmux(run).launch(request(i % 2 === 0 ? cwd : link, [lane("T1", "T1.a1.i-1")], `guild-wi154c-${i}`));
      outcomes.push(spawned(calls));
      notes.push(r.notes.join(" "));
    }
    // CONTROL: the fresh admission launches once.
    expect(outcomes).toEqual([true, false, false, false, false]);
    for (const n of notes.slice(1)) expect(n).toMatch(/isolated_spawn_refused:.*already launched instance T1\.a1\.i-1 by launch tmux:guild-wi154c-0/);
    fs.rmSync(link);
  });

  it("cmux: a second launch of the same instance opens no surface", () => {
    const cwd = tmpLaunchRoot();
    admitLane(cwd, RUN, "T1", "T1.a1.i-1");
    const cmux = (run: RunFn) =>
      new CmuxTeamBackend({
        workspaceId: "workspace:1",
        run,
        resolveClaudeActivation: () => ({ args: ["--plugin-dir", PLUGIN_ROOT], pluginRoot: PLUGIN_ROOT }),
      });
    const first = recordingRun();
    expect(cmux(first.run).launch({ ...request(cwd, [lane("T1", "T1.a1.i-1")], "w1"), mode: "in-session" }).ok).toBe(true);
    expect(spawned(first.calls)).toBe(true);
    const second = recordingRun();
    const r = cmux(second.run).launch({ ...request(cwd, [lane("T1", "T1.a1.i-1")], "w2"), mode: "in-session" });
    expect(r.ok).toBe(false);
    expect(r.notes.join(" ")).toMatch(/already launched/);
    expect(spawned(second.calls)).toBe(false);
  });

  it("remote: a failed connect keeps the claim (retry launches once), a second success refuses", () => {
    const cwd = tmpLaunchRoot();
    admitLane(cwd, RUN, "T1", "T1.a1.i-1");
    const backend = (t: MockTransport) =>
      new RemoteTeamBackend({
        transport: t,
        resolveHostTarget: () => ({ hostId: "box", hostKind: "claude", endpoint: "u@box" }),
        resolveAdapter: resolveAdapter({ env: {} }),
      });
    const down = new MockTransport({ failConnectFor: () => true });
    expect(backend(down).launch(request(cwd, [lane("T1", "T1.a1.i-1")], "r0")).ok).toBe(false);
    const up = new MockTransport();
    expect(backend(up).launch(request(cwd, [lane("T1", "T1.a1.i-1")], "r1")).ok).toBe(true);
    expect(up.spawns).toHaveLength(1);
    const again = new MockTransport();
    const r = backend(again).launch(request(cwd, [lane("T1", "T1.a1.i-1")], "r2"));
    expect(r.ok).toBe(false);
    expect(r.notes.join(" ")).toMatch(/already launched/);
    expect(again.spawns).toHaveLength(0);
  });

  it("batch is all or nothing: a used lane refuses the batch and the fresh lane's claim is rolled back", () => {
    const cwd = tmpLaunchRoot();
    admitLane(cwd, RUN, "A", "A.a1.i-1");
    admitLane(cwd, RUN, "B", "B.a1.i-1");
    claimIsolatedLaunches({ cwd, runId: RUN, launchId: "first", lanes: [{ logicalTaskId: "B", instanceId: "B.a1.i-1" }] });
    expect(() =>
      claimIsolatedLaunches({
        cwd,
        runId: RUN,
        launchId: "second",
        lanes: [
          { logicalTaskId: "A", instanceId: "A.a1.i-1" },
          { logicalTaskId: "B", instanceId: "B.a1.i-1" },
        ],
      }),
    ).toThrow(/^isolated_spawn_refused:.*B\.a1\.i-1.*launch first/);
    expect(fs.existsSync(path.join(cwd, launchClaimPath({ runId: RUN, logicalTaskId: "A" })))).toBe(false);
    // CONTROL: A is still launchable once.
    claimIsolatedLaunches({ cwd, runId: RUN, launchId: "third", lanes: [{ logicalTaskId: "A", instanceId: "A.a1.i-1" }] });
  });
});

describe("plr-wi-15-4 r1 · guild-run wrapper spawns only admitted lanes (compiled runtime)", () => {
  const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "wi154c-run-")));
  const bin = path.join(scratch, "bin");
  const marker = path.join(scratch, "started");
  const NODE = spawnSync("which", ["node"], { encoding: "utf8" }).stdout.trim();
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, "claude"), `#!/bin/sh\necho started >> "${marker}"\necho "{}"\n`, { mode: 0o755 });
  afterAll(() => fs.rmSync(scratch, { recursive: true, force: true }));

  // An explicit env: the test must not inherit the operator's own lane identity.
  function guildRun(cwd: string, lane: Record<string, string>): { exit: number | null; stderr: string; started: number } {
    fs.rmSync(marker, { force: true });
    const r = spawnSync(NODE, [GUILD_RUN_JS, "--host", "claude", "--cwd", cwd, "--prompt", "harmless"], {
      encoding: "utf8",
      env: { HOME: os.homedir(), PATH: `${bin}:${path.dirname(NODE)}:/usr/bin:/bin`, ...lane },
    });
    const started = fs.existsSync(marker) ? fs.readFileSync(marker, "utf8").trim().split("\n").length : 0;
    return { exit: r.status, stderr: r.stderr, started };
  }

  it("codex repro: run + task identity with an empty instance id never starts the host", () => {
    const cwd = fs.mkdtempSync(path.join(scratch, "t15f-empty-"));
    const r = guildRun(cwd, { GUILD_RUN_ID: RUN, GUILD_TASK_ID: "T1", GUILD_TASK_CELL_INSTANCE_ID: "" });
    expect(r.exit).toBe(1);
    expect(r.stderr).toMatch(/isolated_spawn_refused:.*no GUILD_TASK_CELL_INSTANCE_ID/);
    expect(r.started).toBe(0);
  });

  it("an instance id with no reservation or assignment never starts the host", () => {
    const cwd = tmpLaunchRoot();
    fs.mkdirSync(path.join(cwd, ".guild"));
    const r = guildRun(cwd, { GUILD_RUN_ID: RUN, GUILD_TASK_ID: "T1", GUILD_TASK_CELL_INSTANCE_ID: "T1.a1.i-1" });
    expect(r.exit).toBe(1);
    expect(r.stderr).toMatch(/isolated_spawn_refused:.*no admitted slot/);
    expect(r.started).toBe(0);
  });

  it("CONTROL: an admitted instance starts once; the same identity again is refused", () => {
    const cwd = tmpLaunchRoot();
    fs.mkdirSync(path.join(cwd, ".git"));
    admitLane(cwd, RUN, "T1", "T1.a1.i-1");
    const identity = { GUILD_RUN_ID: RUN, GUILD_TASK_ID: "T1", GUILD_TASK_CELL_INSTANCE_ID: "T1.a1.i-1" };
    const first = guildRun(cwd, identity);
    expect(first.exit).toBe(0);
    expect(first.started).toBe(1);
    const second = guildRun(cwd, identity);
    expect(second.exit).toBe(1);
    expect(second.stderr).toMatch(/already launched instance T1\.a1\.i-1 by launch guild-run:/);
    expect(second.started).toBe(0);
  });

  it("CONTROL: no lane identity is not a lane launch and still starts the host", () => {
    const cwd = fs.mkdtempSync(path.join(scratch, "plain-"));
    const r = guildRun(cwd, {});
    expect(r.exit).toBe(0);
    expect(r.started).toBe(1);
  });
});
