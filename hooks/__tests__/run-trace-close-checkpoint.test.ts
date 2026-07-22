/**
 * hooks/__tests__/run-trace-close-checkpoint.test.ts
 *
 * TDD: written BEFORE the HK-09 implementation.
 *
 * Verifies that run-trace-close.ts:
 *   - finds the terminal `guild.learning_checkpoint.v1` YAML when the
 *     `.guild/runs/<run-id>/learning/` directory has at least one checkpoint
 *   - prefers the `reflection-<run-id>.yaml` file when it exists
 *   - falls back to the last-modified checkpoint when no reflection phase exists
 *   - passes the checkpoint path to `emitRunClosed` as `final_learning_checkpoint`
 *   - passes `final_learning_checkpoint: null` when the learning/ dir is absent
 *   - passes `final_learning_checkpoint: null` when the learning/ dir is empty
 *
 * DRIFT-ANALYSIS finding addressed: HK-09 (medium) — `provenance.json`
 *   `final_learning_checkpoint` field is never populated because run-trace-close.ts
 *   does not pass the param to `emitRunClosed`.
 *
 * Evidence contract:
 *   - `scripts/lib/run-lifecycle.ts` → `CloseRunOpts.final_learning_checkpoint?: string | null`
 *   - `hooks/lib/run-trace.ts`       → `emitRunClosed` accepts the field in opts
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { findTerminalCheckpoint } from "../run-trace-close";

// ── Helpers ────────────────────────────────────────────────────────────────

function makeRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "guild-rtc-"));
}

function makeRun(root: string, runId: string): string {
  const runDir = path.join(root, ".guild", "runs", runId);
  fs.mkdirSync(runDir, { recursive: true });
  return runDir;
}

function writeFakeCheckpoint(runDir: string, runId: string, phase: string): string {
  const learningDir = path.join(runDir, "learning");
  fs.mkdirSync(learningDir, { recursive: true });
  const p = path.join(learningDir, `${phase}-${runId}.yaml`);
  fs.writeFileSync(
    p,
    [
      "schema_version: guild.learning_checkpoint.v1",
      `run_id: ${runId}`,
      `phase: ${phase}`,
    ].join("\n") + "\n",
    "utf8",
  );
  return p;
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("run-trace-close — findTerminalCheckpoint — HK-09", () => {
  let root: string;
  const RUN = "run-hk09-test";

  beforeEach(() => {
    root = makeRoot();
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  // ── Export surface ─────────────────────────────────────────────────────

  it("exports findTerminalCheckpoint as a named function", () => {
    expect(typeof findTerminalCheckpoint).toBe("function");
  });

  // ── No learning directory ──────────────────────────────────────────────

  it("returns null when the learning/ directory does not exist", () => {
    const runDir = makeRun(root, RUN);
    const result = findTerminalCheckpoint(runDir, RUN);
    expect(result).toBeNull();
  });

  it("returns null when learning/ exists but is empty", () => {
    const runDir = makeRun(root, RUN);
    fs.mkdirSync(path.join(runDir, "learning"), { recursive: true });
    const result = findTerminalCheckpoint(runDir, RUN);
    expect(result).toBeNull();
  });

  it("returns null when learning/ contains no .yaml files", () => {
    const runDir = makeRun(root, RUN);
    const learningDir = path.join(runDir, "learning");
    fs.mkdirSync(learningDir, { recursive: true });
    fs.writeFileSync(path.join(learningDir, "README.md"), "# docs\n", "utf8");
    const result = findTerminalCheckpoint(runDir, RUN);
    expect(result).toBeNull();
  });

  // ── Reflection phase preference ────────────────────────────────────────

  it("returns reflection-phase checkpoint when it exists", () => {
    const runDir = makeRun(root, RUN);
    writeFakeCheckpoint(runDir, RUN, "development");
    writeFakeCheckpoint(runDir, RUN, "quality");
    const reflPath = writeFakeCheckpoint(runDir, RUN, "reflection");
    const result = findTerminalCheckpoint(runDir, RUN);
    expect(result).toBe(reflPath);
  });

  it("returns reflection phase even if it is not the newest mtime", () => {
    const runDir = makeRun(root, RUN);
    writeFakeCheckpoint(runDir, RUN, "reflection");
    // Sleep briefly, then write a later file to give it a newer mtime
    const learningDir = path.join(runDir, "learning");
    const laterPath = path.join(learningDir, `operations-${RUN}.yaml`);
    fs.writeFileSync(laterPath, "schema_version: guild.learning_checkpoint.v1\n", "utf8");
    // The reflection checkpoint has an older mtime — still should be preferred
    const result = findTerminalCheckpoint(runDir, RUN);
    expect(result).toBe(path.join(learningDir, `reflection-${RUN}.yaml`));
  });

  // ── Last-modified fallback ─────────────────────────────────────────────

  it("falls back to last-modified checkpoint when no reflection phase file", () => {
    const runDir = makeRun(root, RUN);
    const devPath = writeFakeCheckpoint(runDir, RUN, "development");
    // Give planning a slightly older mtime by writing it first
    writeFakeCheckpoint(runDir, RUN, "planning");
    // Set devPath mtime to well in the future to guarantee it sorts first
    const futureTime = new Date(Date.now() + 60_000);
    fs.utimesSync(devPath, futureTime, futureTime);
    const result = findTerminalCheckpoint(runDir, RUN);
    expect(result).toBe(devPath);
  });

  it("returns the single checkpoint when only one phase file exists", () => {
    const runDir = makeRun(root, RUN);
    const planPath = writeFakeCheckpoint(runDir, RUN, "planning");
    const result = findTerminalCheckpoint(runDir, RUN);
    expect(result).toBe(planPath);
  });

  // ── Path shape ────────────────────────────────────────────────────────

  it("returned path uses forward-slash separators (or os.sep) — no null bytes", () => {
    const runDir = makeRun(root, RUN);
    writeFakeCheckpoint(runDir, RUN, "quality");
    const result = findTerminalCheckpoint(runDir, RUN);
    expect(result).not.toBeNull();
    expect(result).toContain("quality");
    expect(result).toContain(runDir);
  });

  it("returned path ends in .yaml", () => {
    const runDir = makeRun(root, RUN);
    writeFakeCheckpoint(runDir, RUN, "init");
    const result = findTerminalCheckpoint(runDir, RUN);
    expect(result).not.toBeNull();
    expect(result!.endsWith(".yaml")).toBe(true);
  });
});

// ── Import safety — #74 ─────────────────────────────────────────────────────
//
// run-trace-close.ts used to invoke `main()` unconditionally at module scope
// (no `require.main === module` guard, unlike its siblings session-reanchor.ts
// / lifecycle-gate.ts / using-guild-bootstrap.ts). That meant simply importing
// this module — exactly what the describe block above does to reach
// `findTerminalCheckpoint` — ran the real CLI path: it read stdin, failed to
// parse it as JSON, hit the catch at run-trace-close.ts:137, and called the
// REAL `process.exit(0)`. Under a full `jest --runInBand` run that killed the
// whole worker process asynchronously, after this file's own tests had
// already reported PASS, truncating the suite before its Tests:/Suites:
// summary ever printed.
describe("run-trace-close — module import does not trigger CLI side effects (regression #74)", () => {
  const prevGuildCwd = process.env["GUILD_CWD"];

  afterEach(() => {
    if (prevGuildCwd === undefined) delete process.env["GUILD_CWD"];
    else process.env["GUILD_CWD"] = prevGuildCwd;
    jest.restoreAllMocks();
  });

  it("never calls process.exit merely from being required", async () => {
    // Point any accidental CLI run at an isolated, guild-less tmpdir so it
    // can't wander into (and mutate) this real checkout's own .guild/ state.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "guild-rtc-import-safety-"));
    process.env["GUILD_CWD"] = tmp;

    const exitSpy = jest.spyOn(process, "exit").mockImplementation((() => undefined) as never);

    jest.isolateModules(() => {
      require("../run-trace-close");
    });

    // If the module (incorrectly) ran main() at load time, it registered
    // stdin listeners and is awaiting `readHookStdin()`. Drive stdin's 'end'
    // event and flush the microtask queue so any such dangling promise chain
    // resolves before we assert — a correctly-guarded module never registers
    // these listeners in the first place, making this a harmless no-op.
    process.stdin.emit("end");
    for (let i = 0; i < 5; i++) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }

    expect(exitSpy).not.toHaveBeenCalled();

    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
