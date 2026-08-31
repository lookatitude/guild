/**
 * hooks/__tests__/run-trace-close-reopen.test.ts
 *
 * Audit finding (hooks.json:78, "Run close semantics"): Stop fires at the end
 * of EVERY assistant turn, not at session end. Before this fix,
 * run-trace-close.ts's ONLY idempotency guard was "does provenance.json
 * exist" — so a multi-turn /guild lifecycle got its run closed after the
 * FIRST turn and every later turn's tool activity silently attached to an
 * already-"closed" run whose provenance never updated again.
 *
 * The fix (see run-trace-close.ts header, "Reopen-on-activity"): when
 * provenance.json already records a terminal status, compare
 * newestPostCloseActivityMs() against the recorded closed_at. No newer
 * activity → genuine idempotent no-op (unchanged behavior). Newer activity
 * (a later turn touched the canonical events log) → re-run the close so
 * provenance reflects the LATEST state instead of a stale first-turn snapshot.
 *
 * These tests spawn run-trace-close.ts as a real subprocess (same pattern as
 * maybe-reflect.test.ts) against a hand-built run.yaml — never a mocked
 * closeRun — because the whole point is to prove the REAL close path
 * (readStartFacts → flipRunStatus → provenance.json) exhibits the fix.
 */

import { spawnSync } from "child_process";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";

const SCRIPT = path.resolve(__dirname, "../run-trace-close.ts");
const FIXTURES = path.resolve(__dirname, "../fixtures");

function runScript(
  input: string,
  env: Record<string, string>,
): { exitCode: number; stdout: string; stderr: string } {
  const result = spawnSync("npx", ["tsx", SCRIPT], {
    input,
    encoding: "utf8",
    env: { ...process.env, ...env },
    timeout: 15000,
  });
  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

// T3 F2: closeRun fails closed without the run's minted binding — a real
// started run always has one (startRun mints FIRST), so the fixture mints too.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { mintRunBinding } = require("../../scripts/lib/run-binding") as
  typeof import("../../scripts/lib/run-binding");

/** Minimal-but-valid guild.run.v1 manifest — enough for readStartFacts + flipRunStatus.
 * Returns the minted binding nonce: rework F1 demands the caller PRESENT the
 * pair (GUILD_RUN_ID + GUILD_RUN_BINDING_REF) — the close/re-close legs never
 * recover the nonce from binding.json. */
function writeRunYaml(root: string, runId: string): string {
  const runDir = path.join(root, ".guild", "runs", runId);
  fs.mkdirSync(runDir, { recursive: true });
  const yaml = [
    "schema_version: guild.run.v1",
    `run_id: ${runId}`,
    "command: /guild:build",
    "arguments: {}",
    `cwd: ${root}`,
    "target_kind: existing_guild_project",
    "workspace:",
    "  is_workspace: false",
    `  root: ${root}`,
    "project: project",
    "host:",
    "  requested: auto",
    "  resolved: claude",
    "model_tier_policy: default (full run)",
    "started_at: 2026-01-01T00:00:00Z",
    "ignore_policy: default",
    "scan_policy: default",
    "initiative_attachment: null",
    "phase: null",
    "run_class: full",
    "gates: {}",
    "status: open",
    "phases_log: []",
    "",
  ].join("\n");
  fs.writeFileSync(path.join(runDir, "run.yaml"), yaml, "utf8");
  // T3 F2/§5: mint the run's binding exactly like startRun does at run start.
  return mintRunBinding({ root, run_id: runId }).binding_ref;
}

function readProvenance(root: string, runId: string): { status: string; closed_at: string } {
  const p = path.join(root, ".guild", "runs", runId, "provenance.json");
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

describe("run-trace-close.ts — reopen-on-activity", () => {
  let tmpDir: string;
  let bindingRef: string;
  const stopPayload = fs.readFileSync(path.join(FIXTURES, "stop.json"), "utf8").toString();
  const RUN_ID = "run-20260101-000000-test-reopen";

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-rtc-reopen-"));
    fs.mkdirSync(path.join(tmpDir, ".git"), { recursive: true });
    bindingRef = writeRunYaml(tmpDir, RUN_ID);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("first Stop closes the run and writes provenance.json (status: closed)", () => {
    const { exitCode } = runScript(stopPayload, { GUILD_CWD: tmpDir, GUILD_RUN_ID: RUN_ID, GUILD_RUN_BINDING_REF: bindingRef });
    expect(exitCode).toBe(0);
    const prov = readProvenance(tmpDir, RUN_ID);
    expect(prov.status).toBe("closed");
  });

  it("a second Stop with NO new activity is a genuine idempotent no-op", () => {
    runScript(stopPayload, { GUILD_CWD: tmpDir, GUILD_RUN_ID: RUN_ID, GUILD_RUN_BINDING_REF: bindingRef });
    const firstProv = readProvenance(tmpDir, RUN_ID);

    const { exitCode, stderr } = runScript(stopPayload, {
      GUILD_CWD: tmpDir,
      GUILD_RUN_ID: RUN_ID,
      GUILD_RUN_BINDING_REF: bindingRef,
    });
    expect(exitCode).toBe(0);
    expect(stderr).not.toMatch(/re-closing/);
    const secondProv = readProvenance(tmpDir, RUN_ID);
    // closed_at must be UNCHANGED — proves the second call really no-op'd
    // rather than silently re-closing every time regardless of activity.
    expect(secondProv.closed_at).toBe(firstProv.closed_at);
  });

  it("a second Stop AFTER new tool activity re-closes (the fix): a SECOND run_closed trace line is appended", () => {
    runScript(stopPayload, { GUILD_CWD: tmpDir, GUILD_RUN_ID: RUN_ID, GUILD_RUN_BINDING_REF: bindingRef });
    const firstProv = readProvenance(tmpDir, RUN_ID);

    const logsDir = path.join(tmpDir, ".guild", "runs", RUN_ID, "logs");
    const eventsFile = path.join(logsDir, "v1.4-events.jsonl");
    // The first close already appended ITS OWN run_closed line here (via
    // emitRunClosed) — APPEND (never overwrite) a synthetic later tool_call
    // line on top, simulating a later turn's real tool activity, with an
    // mtime comfortably beyond REOPEN_TOLERANCE_MS past the just-recorded
    // closed_at (well beyond any same-invocation write-lag noise).
    fs.appendFileSync(eventsFile, JSON.stringify({ event: "tool_call" }) + "\n", "utf8");
    const future = new Date(Date.parse(firstProv.closed_at) + 60_000);
    fs.utimesSync(eventsFile, future, future);

    const { exitCode, stderr } = runScript(stopPayload, {
      GUILD_CWD: tmpDir,
      GUILD_RUN_ID: RUN_ID,
      GUILD_RUN_BINDING_REF: bindingRef,
    });
    expect(exitCode).toBe(0);
    expect(stderr).toMatch(/re-closing/);
    const secondProv = readProvenance(tmpDir, RUN_ID);
    expect(secondProv.status).toBe("closed");

    // Robust (non-time-based) proof the run was ACTUALLY re-closed rather
    // than just re-read: emitRunClosed appends a run_closed trace line on
    // every real close, so a genuine re-close produces a SECOND one.
    const lines = fs
      .readFileSync(eventsFile, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l));
    const runClosedCount = lines.filter((l) => l.event_name === "run_closed").length;
    expect(runClosedCount).toBe(2);
  });

  it("run.yaml's OWN mtime bump from the close itself does NOT trigger a false reopen", () => {
    // Regression guard for the tolerance design note in newestPostCloseActivityMs:
    // run.yaml is deliberately excluded from the activity signal because
    // flipRunStatus() bumps its mtime as part of the very close being evaluated.
    runScript(stopPayload, { GUILD_CWD: tmpDir, GUILD_RUN_ID: RUN_ID, GUILD_RUN_BINDING_REF: bindingRef });
    const firstProv = readProvenance(tmpDir, RUN_ID);

    const { stderr } = runScript(stopPayload, { GUILD_CWD: tmpDir, GUILD_RUN_ID: RUN_ID, GUILD_RUN_BINDING_REF: bindingRef });
    expect(stderr).not.toMatch(/re-closing/);
    const secondProv = readProvenance(tmpDir, RUN_ID);
    expect(secondProv.closed_at).toBe(firstProv.closed_at);
  });
});
