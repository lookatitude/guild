import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { OWNER_ARCHITECT_LAYER } from "../src/domains/lifecycle";

// new-run-id.ts deleted in SC-8 W2B-4; run-lifecycle.ts:startRun is the sole sentinel writer.
const EMIT_LOOP_EVENT = path.resolve(__dirname, "emit-loop-event.ts");

// Suppress Node-internal/tsx-loader warnings (e.g. DEP0205
// `module.register()` deprecation on newer Node) so the stderr
// assertions reflect ONLY the spawned script's own output. The scripts
// under test write to stderr exclusively on error; they are silent on
// success.
// emit-loop-event resolves runId as `--run-id ?? GUILD_RUN_ID ?? sentinel`. This test
// exercises the SENTINEL path, so it must NOT inherit an ambient GUILD_RUN_ID/GUILD_CWD
// (set whenever the suite runs inside a live Guild run) — those would override the
// sentinel and route the write to the real run's dir, ENOENT-ing the expected path.
const SPAWN_ENV = { ...process.env, NODE_NO_WARNINGS: "1" };
delete (SPAWN_ENV as Record<string, string | undefined>)["GUILD_RUN_ID"];
delete (SPAWN_ENV as Record<string, string | undefined>)["GUILD_CWD"];

describe("run scoping and loop event helpers", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-run-scope-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("emit-loop-event writes v1.4 loop_round_start/end rows using the sentinel run id", () => {
    const runId = "run-loop-helper";
    const runsRoot = path.join(tmpDir, ".guild", "runs");
    fs.mkdirSync(runsRoot, { recursive: true });
    fs.writeFileSync(path.join(runsRoot, "current-run-id"), runId, "utf8");

    const start = spawnSync(
      "npx",
      [
        "tsx",
        EMIT_LOOP_EVENT,
        "--cwd",
        tmpDir,
        "--event",
        "loop_round_start",
        "--layer",
        "L2",
        "--lane",
        "phase:plan",
        "--round",
        "1",
        "--cap",
        "16",
      ],
      { encoding: "utf8", timeout: 15000, env: SPAWN_ENV },
    );
    expect(start.status).toBe(0);
    expect(start.stderr).toBe("");

    const end = spawnSync(
      "npx",
      [
        "tsx",
        EMIT_LOOP_EVENT,
        "--cwd",
        tmpDir,
        "--event",
        "loop_round_end",
        "--layer",
        "L2",
        "--lane",
        "phase:plan",
        "--round",
        "1",
        "--terminated",
        "satisfied",
        "--terminator",
        "security",
      ],
      { encoding: "utf8", timeout: 15000, env: SPAWN_ENV },
    );
    expect(end.status).toBe(0);
    expect(end.stderr).toBe("");

    const logPath = path.join(runsRoot, runId, "logs", "v1.4-events.jsonl");
    const events = fs
      .readFileSync(logPath, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));

    expect(events).toEqual([
      expect.objectContaining({
        event: "loop_round_start",
        run_id: runId,
        lane_id: "phase:plan",
        loop_layer: "L2",
        round_number: 1,
        cap: 16,
      }),
      expect.objectContaining({
        event: "loop_round_end",
        run_id: runId,
        lane_id: "phase:plan",
        loop_layer: "L2",
        round_number: 1,
        terminated: "satisfied",
        terminator: "security",
      }),
    ]);
  });

  // G11 R1: the owner-architect loop (OWNER_ARCHITECT_LAYER) must be emittable,
  // and the layer whitelist must still refuse anything it does not name.
  function emitStart(layer: string) {
    return spawnSync(
      "npx",
      [
        "tsx", EMIT_LOOP_EVENT, "--cwd", tmpDir, "--run-id", "run-layer-check",
        "--event", "loop_round_start", "--layer", layer,
        "--lane", "phase:plan", "--round", "1", "--cap", "4",
      ],
      { encoding: "utf8", timeout: 15000, env: SPAWN_ENV },
    );
  }
  const layerLog = () =>
    path.join(tmpDir, ".guild", "runs", "run-layer-check", "logs", "v1.4-events.jsonl");

  it("accepts an owner-architect loop event on the L-arch layer", () => {
    expect(OWNER_ARCHITECT_LAYER).toBe("L-arch");
    const res = emitStart(OWNER_ARCHITECT_LAYER);
    expect(res.status).toBe(0);
    expect(res.stderr).toBe("");
    const rows = fs.readFileSync(layerLog(), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(rows).toEqual([
      expect.objectContaining({ event: "loop_round_start", loop_layer: "L-arch", round_number: 1, cap: 4 }),
    ]);
  });

  it("still refuses an unknown loop layer and writes nothing", () => {
    for (const layer of ["L-unknown", "l-arch", "L5"]) {
      const res = emitStart(layer);
      expect(res.stderr).toContain("--layer is required for loop round events");
    }
    expect(fs.existsSync(layerLog())).toBe(false);
  });
});
