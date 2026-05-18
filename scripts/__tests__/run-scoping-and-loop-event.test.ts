import { spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const NEW_RUN_ID = path.resolve(__dirname, "../new-run-id.ts");
const EMIT_LOOP_EVENT = path.resolve(__dirname, "../emit-loop-event.ts");

// Suppress Node-internal/tsx-loader warnings (e.g. DEP0205
// `module.register()` deprecation on newer Node) so the stderr
// assertions reflect ONLY the spawned script's own output. The scripts
// under test write to stderr exclusively on error; they are silent on
// success.
const SPAWN_ENV = { ...process.env, NODE_NO_WARNINGS: "1" };

describe("run scoping and loop event helpers", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-run-scope-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("new-run-id writes current-run-id and metadata for one /guild invocation", () => {
    const result = spawnSync("npx", ["tsx", NEW_RUN_ID, "--cwd", tmpDir], {
      encoding: "utf8",
      timeout: 15000,
      env: SPAWN_ENV,
    });

    expect(result.status).toBe(0);
    const runId = result.stdout.trim();
    expect(runId).toMatch(/^run-\d{4}-\d{2}-\d{2}-[a-f0-9]{8}$/);
    expect(
      fs.readFileSync(path.join(tmpDir, ".guild", "runs", "current-run-id"), "utf8"),
    ).toBe(runId);

    const metadata = JSON.parse(
      fs.readFileSync(path.join(tmpDir, ".guild", "runs", runId, "metadata.json"), "utf8"),
    );
    expect(metadata).toMatchObject({
      schema_version: 1,
      run_id: runId,
      invocation: "/guild",
    });
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
});
