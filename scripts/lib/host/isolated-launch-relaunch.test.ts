/**
 * plr-wi-15-4 rework r3 — every host process guild-run starts is its own
 * admission, including each bounded-repair re-spawn.
 *
 * Enforcing calls (each fixture fails when its call is removed):
 *   - admitWrapperRelaunch (scripts/guild-run.ts) → admitRelaunch
 *     (src/domains/dispatch/isolated-launch-admission.ts): a repair reserves the
 *     next attempt through reserveInstance, writes its derived assignment, and
 *     consumes that attempt's own launch claim; a refusal stops the repair loop.
 * Planted controls: a wrapper call with no lane identity still repairs; a
 * relaunch from a lane whose prior assignment is missing refuses.
 */
import { afterAll, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { admitRelaunch, launchClaimPath, taskCellPaths } from "../../../src/domains/dispatch";
import { admitLane, tmpLaunchRoot } from "./__tests__/admit-lane";

const RUN = "run-wi154-relaunch";
const REPO = path.resolve(__dirname, "../../..");
const GUILD_RUN_JS = path.join(REPO, "runtime/scripts/guild-run.js");

describe("plr-wi-15-4 r3 · guild-run repair re-spawns are admitted one by one (compiled runtime)", () => {
  const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "wi154r-run-")));
  const bin = path.join(scratch, "bin");
  const marker = path.join(scratch, "started");
  const NODE = spawnSync("which", ["node"], { encoding: "utf8" }).stdout.trim();
  fs.mkdirSync(bin);
  // Every start records the identity the child inherited, then returns an invalid result.
  fs.writeFileSync(
    path.join(bin, "claude"),
    `#!/bin/sh\necho "\${GUILD_TASK_CELL_INSTANCE_ID:-none} \${GUILD_TASK_ATTEMPT:-none}" >> "${marker}"\necho "{}"\n`,
    { mode: 0o755 },
  );
  afterAll(() => fs.rmSync(scratch, { recursive: true, force: true }));

  function guildRun(cwd: string, lane: Record<string, string>) {
    fs.rmSync(marker, { force: true });
    const r = spawnSync(
      NODE,
      [GUILD_RUN_JS, "--host", "claude", "--cwd", cwd, "--prompt", "harmless", "--contract", "guild.handoff.v2", "--max-repair", "4"],
      { encoding: "utf8", env: { HOME: os.homedir(), PATH: `${bin}:${path.dirname(NODE)}:/usr/bin:/bin`, ...lane } },
    );
    const starts = fs.existsSync(marker)
      ? fs.readFileSync(marker, "utf8").trim().split("\n").map((l) => {
          const [instance, attempt] = l.split(" ");
          return { instance, attempt };
        })
      : [];
    return { exit: r.status, stderr: r.stderr, starts };
  }

  it("codex repro: --max-repair 4 on an admitted lane -> every start is a distinct admitted attempt, then refused", () => {
    const cwd = tmpLaunchRoot();
    fs.mkdirSync(path.join(cwd, ".git"));
    admitLane(cwd, RUN, "T1", "T1.a1.i-1");
    const r = guildRun(cwd, { GUILD_RUN_ID: RUN, GUILD_TASK_ID: "T1", GUILD_TASK_CELL_INSTANCE_ID: "T1.a1.i-1", GUILD_TASK_ATTEMPT: "1" });

    // dispatch.max_instances defaults to 4: attempt 1 plus three admitted repairs
    // fill the run; the fourth repair is refused and never starts.
    expect(r.starts.map((s) => s.attempt)).toEqual(["1", "2", "3", "4"]);
    const instances = r.starts.map((s) => s.instance);
    expect(instances[0]).toBe("T1.a1.i-1");
    expect(new Set(instances).size).toBe(instances.length);
    r.starts.forEach(({ instance, attempt }) => {
      const n = Number(attempt);
      const claim = JSON.parse(
        fs.readFileSync(path.join(cwd, launchClaimPath({ runId: RUN, logicalTaskId: "T1", attempt: n })), "utf8"),
      );
      expect(claim.instance_id).toBe(instance);
      const assignment = JSON.parse(
        fs.readFileSync(
          path.join(cwd, taskCellPaths({ run_id: RUN, logical_task_id: "T1", attempt: n, instance_id: instance }).assignment_path),
          "utf8",
        ),
      );
      expect(assignment.instance_id).toBe(instance);
      expect(assignment.attempt).toBe(n);
    });
    expect(r.exit).toBe(2);
    expect(r.stderr).toMatch(/"repair_refusal":"isolated_spawn_refused: relaunch of T1 refused: not_authorized: dispatch\.max_instances=4/);
    // The refused attempt left no slot and no claim behind.
    expect(fs.existsSync(path.join(cwd, launchClaimPath({ runId: RUN, logicalTaskId: "T1", attempt: 5 })))).toBe(false);
    expect(fs.existsSync(path.join(cwd, taskCellPaths({ run_id: RUN, logical_task_id: "T1", attempt: 5, instance_id: "x" }).attempt_path))).toBe(false);
  });

  it("CONTROL: no lane identity is not a lane launch and repairs without admission", () => {
    const cwd = fs.mkdtempSync(path.join(scratch, "plain-"));
    const r = guildRun(cwd, {});
    expect(r.starts.length).toBe(5);
    expect(r.exit).toBe(2);
    expect(r.stderr).toMatch(/"repair_refusal":null/);
  });
});

describe("plr-wi-15-4 r3 · admitRelaunch", () => {
  it("CONTROL: a relaunch whose prior attempt has no assignment refuses and reserves nothing", () => {
    const cwd = tmpLaunchRoot();
    expect(() =>
      admitRelaunch({
        cwd,
        runId: RUN,
        logicalTaskId: "T2",
        prior: { instanceId: "T2.a1.i-1", attempt: 1 },
        instanceId: "T2.a2.i-1",
        retryReason: "repair",
        launchId: "l1",
      }),
    ).toThrow(/^isolated_spawn_refused:.*no matching guild\.task_assignment\.v2/);
    expect(
      fs.existsSync(path.join(cwd, taskCellPaths({ run_id: RUN, logical_task_id: "T2", attempt: 2, instance_id: "x" }).attempt_path)),
    ).toBe(false);
  });

  it("a relaunched attempt cannot be launched twice", () => {
    const cwd = tmpLaunchRoot();
    admitLane(cwd, RUN, "T3", "T3.a1.i-1");
    const input = {
      cwd,
      runId: RUN,
      logicalTaskId: "T3",
      prior: { instanceId: "T3.a1.i-1", attempt: 1 },
      instanceId: "T3.a2.i-1",
      retryReason: "repair",
      launchId: "l1",
    };
    expect(admitRelaunch(input)).toEqual({ instanceId: "T3.a2.i-1", attempt: 2 });
    expect(() => admitRelaunch({ ...input, instanceId: "T3.a2.i-2", launchId: "l2" })).toThrow(
      /^isolated_spawn_refused:.*T3 attempt 2 already has an attempt record/,
    );
  });
});
