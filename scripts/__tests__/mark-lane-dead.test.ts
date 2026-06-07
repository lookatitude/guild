/**
 * scripts/__tests__/mark-lane-dead.test.ts
 *
 * TDD suite for scripts/mark-lane-dead.ts (R-016 bridge-seam CLI).
 *
 * This thin CLI wraps hooks' markLaneDead so the InProcess/subagent PROSE retry
 * path (where the orchestrator can't call a TS function) can write the SAME
 * run-state `dead` checkpoint + resume.json that the SSH onExhausted path writes.
 * One writer (markLaneDead), two reach mechanisms (TS import for SSH; this CLI
 * for prose).
 *
 * TESTING APPROACH: subprocess via `npx tsx` — mirrors agent-team-launcher.test.ts.
 * mark-lane-dead.ts imports ../hooks/lib/run-state, whose transitive `.js`-suffixed
 * imports (v1.4-lock.js, guild-root.js) are resolved by the tsx runtime but NOT by
 * ts-jest's commonjs resolver. Invoking the CLI as a subprocess tests the REAL
 * runtime path (the exact way skill prose invokes it in production) and sidesteps
 * the cross-dir resolution entirely.
 *
 * Coverage map:
 *  - arg errors: missing runDir/laneId; missing/non-numeric --attempts → exit 1.
 *  - happy path: writes run-state dead + resume.json (resume.enabled default true).
 *  - resume.enabled=false: marks dead WITHOUT resume.json.
 *  - optional flags: --last-error captured in resume.json.
 */

import { spawnSync } from "child_process";
import * as os from "os";
import * as fs from "fs";
import * as path from "path";

const CLI = path.resolve(__dirname, "..", "mark-lane-dead.ts");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRunDir(): { cwd: string; runDir: string; runId: string } {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "guild-mld-test-"));
  const runId = "run-2026-06-07-test";
  const runDir = path.join(cwd, ".guild", "runs", runId);
  fs.mkdirSync(runDir, { recursive: true });
  return { cwd, runDir, runId };
}

function writeResumeEnabled(cwd: string, enabled: boolean): void {
  const guildDir = path.join(cwd, ".guild");
  fs.mkdirSync(guildDir, { recursive: true });
  fs.writeFileSync(
    path.join(guildDir, "settings.json"),
    JSON.stringify({ defaults: { resume: { enabled } } }, null, 2)
  );
}

function runCli(args: string[]): { status: number; stdout: string; stderr: string } {
  const res = spawnSync("npx", ["tsx", CLI, ...args], {
    encoding: "utf8",
    timeout: 60000,
  });
  return {
    status: res.status ?? -1,
    stdout: res.stdout ?? "",
    stderr: res.stderr ?? "",
  };
}

// ---------------------------------------------------------------------------
// 1. Arg errors → exit 1
// ---------------------------------------------------------------------------

describe("mark-lane-dead CLI — arg validation", () => {
  it("exits non-zero when runDir + laneId are missing", () => {
    const r = runCli([]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("usage:");
  });

  it("exits non-zero when laneId is missing", () => {
    const r = runCli(["/only/rundir"]);
    expect(r.status).not.toBe(0);
  });

  it("exits non-zero when --attempts is missing", () => {
    const r = runCli(["/rd", "lane"]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("attempts");
  });

  it("exits non-zero when --attempts is non-numeric", () => {
    const r = runCli(["/rd", "lane", "--attempts", "abc"]);
    expect(r.status).not.toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 2. Happy path — dead + resume.json (resume.enabled default/true)
// ---------------------------------------------------------------------------

describe("mark-lane-dead CLI — marks dead + writes resume.json", () => {
  it("marks the lane dead AND writes resume.json when resume.enabled=true", () => {
    const { cwd, runDir } = makeRunDir();
    writeResumeEnabled(cwd, true);

    const r = runCli([
      runDir,
      "backend-api",
      "--attempts",
      "3",
      "--last-error",
      "transient ssh failure",
      "--run-id",
      "run-2026-06-07-test",
      "--cwd",
      cwd,
    ]);
    expect(r.status).toBe(0);

    // run-state.json shows the lane dead
    const state = JSON.parse(fs.readFileSync(path.join(runDir, "run-state.json"), "utf8"));
    expect(state.lanes["backend-api"].status).toBe("dead");
    expect(state.lanes["backend-api"].attempt).toBe(3);

    // resume.json checkpoint written with the error captured
    const resumePath = path.join(runDir, "lanes", "backend-api", "resume.json");
    expect(fs.existsSync(resumePath)).toBe(true);
    const resume = JSON.parse(fs.readFileSync(resumePath, "utf8"));
    expect(resume.lane_id).toBe("backend-api");
    expect(resume.attempts).toBe(3);
    expect(resume.last_error).toBe("transient ssh failure");
  });

  it("defaults resume.enabled to true when settings.json is absent (still writes resume.json)", () => {
    const { cwd, runDir } = makeRunDir();
    // no settings.json → markLaneDead's readResumeEnabled defaults to true
    const r = runCli([runDir, "lane-z", "--attempts", "2", "--run-id", "run-2026-06-07-test", "--cwd", cwd]);
    expect(r.status).toBe(0);
    const resumePath = path.join(runDir, "lanes", "lane-z", "resume.json");
    expect(fs.existsSync(resumePath)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. resume.enabled=false — dead but NO resume.json
// ---------------------------------------------------------------------------

describe("mark-lane-dead CLI — resume.enabled=false", () => {
  it("marks dead but writes NO resume.json when resume.enabled=false", () => {
    const { cwd, runDir } = makeRunDir();
    writeResumeEnabled(cwd, false);

    const r = runCli([runDir, "frontend", "--attempts", "2", "--run-id", "run-2026-06-07-test", "--cwd", cwd]);
    expect(r.status).toBe(0);

    const state = JSON.parse(fs.readFileSync(path.join(runDir, "run-state.json"), "utf8"));
    expect(state.lanes["frontend"].status).toBe("dead");

    const resumePath = path.join(runDir, "lanes", "frontend", "resume.json");
    expect(fs.existsSync(resumePath)).toBe(false); // resume disabled → no checkpoint
  });
});
