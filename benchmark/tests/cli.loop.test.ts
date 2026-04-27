// cli.loop.test.ts
//
// Subprocess-driven smoke for the `benchmark loop` subcommand. Each test
// shells out to the real CLI via tsx so we exercise argv parsing,
// mutually-exclusive mode handling, exit-code mapping (architect §4.1
// + §6.4), and dry-run output formatting end-to-end.
//
// We deliberately do NOT exercise the live `--start` / `--continue`
// paths here (those would require a real `claude` binary spawn). The
// dry-run flag is the architect's verification surface (ADR-005
// §Decision: "--dry-run never spawns claude").
//
// Coverage (≥ 5 tests):
//   1. `loop` with no mode flag exits 2 + clear stderr (mutually-exclusive enforcement).
//   2. `loop --start --continue --status` exits 2 (more than one mode set).
//   3. `loop --start --case demo-... --dry-run` exits 0 + prints plan-shaped report.
//   4. `loop --status` rejects missing --baseline-run-id.
//   5. `loop --continue --baseline-run-id <id> --apply <bad-id>` exits 2 (M13 regex rejection).
//   6. `loop --continue` rejects missing --apply.
//   7. `loop --continue` rejects missing --baseline-run-id.

import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const REPO_ROOT = resolve(__dirname, "..");
const CLI_PATH = resolve(REPO_ROOT, "src", "cli.ts");
const TSX_BIN = resolve(REPO_ROOT, "node_modules", ".bin", "tsx");

interface RunResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

function runCli(args: string[], cwd: string = REPO_ROOT): RunResult {
  const r = spawnSync(TSX_BIN, [CLI_PATH, ...args], {
    cwd,
    encoding: "utf8",
    // Strip auth-hash env so the subprocess doesn't carry it across tests.
    env: {
      ...process.env,
      GUILD_BENCHMARK_AUTH_HINT: "",
    },
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

let scratch: string;
let runsDir: string;
let casesDir: string;

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), "qa-cli-loop-"));
  runsDir = join(scratch, "runs");
  casesDir = join(scratch, "cases");
  await mkdir(runsDir, { recursive: true });
  await mkdir(casesDir, { recursive: true });
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

describe("cli / loop — argv parsing + exit-code map", () => {
  it("rejects invocation with no mode flag (exit 2)", () => {
    const r = runCli(["loop"]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain(
      "loop: one of --start, --continue, --status, --abort is required",
    );
  });

  it("rejects more than one mode flag set (exit 2)", () => {
    const r = runCli([
      "loop",
      "--start",
      "--continue",
      "--baseline-run-id",
      "synthetic-pass-001",
      "--apply",
      "ref-001",
      "--case",
      "demo-url-shortener-build",
    ]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("mutually exclusive");
  });

  it("`loop --start --case <slug> --dry-run` exits 0 + prints plan-shaped report", async () => {
    // Seed a real case YAML in the scratch casesDir; CLI will resolve it.
    const fixtureDir = join(scratch, "fixture");
    await mkdir(fixtureDir, { recursive: true });
    await writeFile(join(fixtureDir, "README.md"), "fixture\n", "utf8");
    const yaml = [
      `schema_version: 1`,
      `id: cli-loop-smoke`,
      `title: "cli loop smoke"`,
      `timeout_seconds: 60`,
      `repetitions: 1`,
      `fixture: "${fixtureDir}"`,
      `prompt: "smoke prompt"`,
      `expected_specialists:`,
      `  - architect`,
      `expected_stage_order:`,
      `  - brainstorm`,
      `acceptance_commands: []`,
      ``,
    ].join("\n");
    await writeFile(join(casesDir, "cli-loop-smoke.yaml"), yaml, "utf8");

    const r = runCli([
      "loop",
      "--start",
      "--case",
      "cli-loop-smoke",
      "--dry-run",
      "--runs-dir",
      runsDir,
      "--cases-dir",
      casesDir,
    ]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("benchmark loop --start --dry-run");
    expect(r.stdout).toContain("baseline_run_id");
    expect(r.stdout).toContain("manifest_path");
    expect(r.stdout).toContain("plugin_ref_before");
    expect(r.stdout).toContain("(dry-run: no subprocess spawned");
  });

  it("`loop --start` rejects missing --case (exit 2)", () => {
    const r = runCli([
      "loop",
      "--start",
      "--runs-dir",
      runsDir,
      "--cases-dir",
      casesDir,
    ]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("--case <slug> is required");
  });

  it("`loop --continue` rejects missing --baseline-run-id (exit 2)", () => {
    const r = runCli([
      "loop",
      "--continue",
      "--apply",
      "ref-001",
      "--runs-dir",
      runsDir,
      "--cases-dir",
      casesDir,
    ]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("--baseline-run-id <id> is required");
  });

  it("`loop --continue` rejects missing --apply (exit 2)", () => {
    const r = runCli([
      "loop",
      "--continue",
      "--baseline-run-id",
      "synthetic-pass-001",
      "--runs-dir",
      runsDir,
      "--cases-dir",
      casesDir,
    ]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("--apply <proposal-id> is required");
  });

  it("`loop --continue --apply <bad-id>` rejects path-traversal proposal_id (M13, exit 2)", () => {
    const r = runCli([
      "loop",
      "--continue",
      "--baseline-run-id",
      "synthetic-pass-001",
      "--apply",
      "../etc/passwd",
      "--runs-dir",
      runsDir,
      "--cases-dir",
      casesDir,
    ]);
    expect(r.status).toBe(2);
    // Wrapped in `loop:` prefix by commandLoop's catch handler.
    expect(r.stderr).toContain("not a valid proposal_id");
    expect(r.stderr).toContain("M13");
  });

  it("`loop --status` rejects missing --baseline-run-id (exit 2)", () => {
    const r = runCli([
      "loop",
      "--status",
      "--runs-dir",
      runsDir,
      "--cases-dir",
      casesDir,
    ]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("--baseline-run-id <id> is required");
  });

  it("`loop --status --baseline-run-id <id>` exits 2 when manifest is missing", () => {
    const r = runCli([
      "loop",
      "--status",
      "--baseline-run-id",
      "nonexistent-run-id",
      "--runs-dir",
      runsDir,
      "--cases-dir",
      casesDir,
    ]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("manifest not found");
  });

  // v1.2 — F1: loop --abort CLI argv parsing. Behavior is tested in
  // tests/loop.unit.test.ts; here we only pin mode-dispatch and exit
  // codes.
  it("`loop --abort` rejects missing --baseline-run-id (exit 2)", () => {
    const r = runCli([
      "loop",
      "--abort",
      "--runs-dir",
      runsDir,
      "--cases-dir",
      casesDir,
    ]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("--baseline-run-id <id> is required");
  });

  it("`loop --abort --baseline-run-id <id>` exits 2 when manifest is missing", () => {
    const r = runCli([
      "loop",
      "--abort",
      "--baseline-run-id",
      "nonexistent-run-id",
      "--runs-dir",
      runsDir,
      "--cases-dir",
      casesDir,
    ]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("manifest not found");
  });

  it("`loop --start --abort` rejects mutually exclusive modes (exit 2)", () => {
    const r = runCli([
      "loop",
      "--start",
      "--abort",
      "--runs-dir",
      runsDir,
      "--cases-dir",
      casesDir,
    ]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("mutually exclusive");
  });
});
