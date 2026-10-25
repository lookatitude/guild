/**
 * hooks/__tests__/run-trace-close-cli.test.ts
 *
 * #277: `run-trace close --run-id <id> [--cwd]` closes a run without a Stop-hook
 * payload, through the SAME close path the Stop hook uses (hooks/lib/run-close.ts).
 * Spawns the shipped bundle (hooks/dist/run-trace.js) under node, as a consumer
 * would. Identity is passed by flag only; the spawned env carries no GUILD_* key.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { spawnSync } from "child_process";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { mintRunBinding } = require("../../scripts/lib/run-binding") as
  typeof import("../../scripts/lib/run-binding");

const BUNDLE = path.resolve(__dirname, "../dist/run-trace.js");
const HOOK_SOURCE = path.resolve(__dirname, "../run-trace-close.ts");
const CLI_SOURCE = path.resolve(__dirname, "../run-trace.ts");
const RUN_ID = "run-20260101-000000-test-close-cli";

function cleanEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && !k.startsWith("GUILD_")) env[k] = v;
  }
  return env;
}

function runClose(args: string[]): { exitCode: number; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [BUNDLE, "close", ...args], {
    encoding: "utf8",
    env: cleanEnv(),
    timeout: 15000,
  });
  return { exitCode: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

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
  return mintRunBinding({ root, run_id: runId }).binding_ref;
}

describe("run-trace close CLI (#277)", () => {
  let root: string;
  let runDir: string;
  let bindingRef: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "guild-rt-close-cli-"));
    fs.mkdirSync(path.join(root, ".git"), { recursive: true });
    bindingRef = writeRunYaml(root, RUN_ID);
    runDir = path.join(root, ".guild", "runs", RUN_ID);
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("closes an open run: provenance closed, run.yaml flipped, run_closed trace line appended", () => {
    const r = runClose(["--run-id", RUN_ID, "--cwd", root, "--binding-ref", bindingRef]);
    expect(r.stderr).toBe("");
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toBe(RUN_ID);

    const prov = JSON.parse(fs.readFileSync(path.join(runDir, "provenance.json"), "utf8"));
    expect(prov.status).toBe("closed");
    expect(typeof prov.terminal_trace_event?.event_id).toBe("string");
    expect(fs.readFileSync(path.join(runDir, "run.yaml"), "utf8")).toContain("\nstatus: closed\n");

    const lines = fs.readFileSync(path.join(runDir, "logs", "v1.4-events.jsonl"), "utf8")
      .trim().split("\n").map((l) => JSON.parse(l));
    const closed = lines.filter((l) => l.event_name === "run_closed");
    expect(closed.length).toBe(1);
    expect(closed[0].event_id).toBe(prov.terminal_trace_event.event_id);
  });

  it("accepts the --flag=value form", () => {
    const r = runClose([`--run-id=${RUN_ID}`, `--cwd=${root}`, `--binding-ref=${bindingRef}`]);
    expect(r.exitCode).toBe(0);
    expect(JSON.parse(fs.readFileSync(path.join(runDir, "provenance.json"), "utf8")).status).toBe("closed");
  });

  it("an already-closed run is a no-op with a clear message (closed_at unchanged)", () => {
    expect(runClose(["--run-id", RUN_ID, "--cwd", root, "--binding-ref", bindingRef]).exitCode).toBe(0);
    const first = JSON.parse(fs.readFileSync(path.join(runDir, "provenance.json"), "utf8"));
    const r = runClose(["--run-id", RUN_ID, "--cwd", root, "--binding-ref", bindingRef]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("");
    expect(r.stderr).toMatch(/already closed/);
    const second = JSON.parse(fs.readFileSync(path.join(runDir, "provenance.json"), "utf8"));
    expect(second.closed_at).toBe(first.closed_at);
  });

  it("an unknown run fails with a clear message and writes nothing", () => {
    const r = runClose(["--run-id", "run-20260101-000000-missing", "--cwd", root, "--binding-ref", bindingRef]);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toMatch(/no run "run-20260101-000000-missing"/);
    expect(fs.existsSync(path.join(root, ".guild", "runs", "run-20260101-000000-missing"))).toBe(false);
  });

  it("a missing --run-id is a usage error", () => {
    const r = runClose(["--cwd", root]);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toMatch(/usage: close --run-id/);
  });

  it("an unsafe run id is refused before any path is built", () => {
    const r = runClose(["--run-id", "../escape", "--cwd", root, "--binding-ref", bindingRef]);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toMatch(/invalid run id/);
  });

  it("without the run's binding nonce the close is refused (fail closed, no provenance)", () => {
    const r = runClose(["--run-id", RUN_ID, "--cwd", root]);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toMatch(/binding_rejected/);
    expect(fs.existsSync(path.join(runDir, "provenance.json"))).toBe(false);
  });

  it("a wrong binding nonce is refused (fail closed, no provenance)", () => {
    const r = runClose(["--run-id", RUN_ID, "--cwd", root, "--binding-ref", "not-the-nonce"]);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toMatch(/binding_rejected/);
    expect(fs.existsSync(path.join(runDir, "provenance.json"))).toBe(false);
  });

  it("active work defers the close exactly like the Stop hook (non-zero, no provenance)", () => {
    fs.writeFileSync(
      path.join(runDir, "run-state.json"),
      JSON.stringify({ schema_version: "guild.run_state.v1", run_id: RUN_ID, lanes: { T1: { status: "in_progress" } } }),
    );
    const r = runClose(["--run-id", RUN_ID, "--cwd", root, "--binding-ref", bindingRef]);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toMatch(/refusing to close .*in_progress/);
    expect(fs.existsSync(path.join(runDir, "provenance.json"))).toBe(false);
  });

  it("the Stop hook and the CLI share one close implementation (no fork)", () => {
    const hook = fs.readFileSync(HOOK_SOURCE, "utf8");
    const cli = fs.readFileSync(CLI_SOURCE, "utf8");
    expect(hook.includes("closeGuildRun(")).toBe(true);
    expect(cli.includes("closeGuildRun(")).toBe(true);
    expect(hook.includes("emitRunClosed(")).toBe(false);
    expect(cli.includes("emitRunClosed(")).toBe(false);
  });
});
