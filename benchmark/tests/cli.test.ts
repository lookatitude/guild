import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
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
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

describe("cli / help", () => {
  it("prints usage when invoked with no args", () => {
    const r = runCli([]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("benchmark — Guild benchmark factory CLI");
    expect(r.stdout).toContain("score");
    expect(r.stdout).toContain("compare");
  });

  it("prints usage when invoked with --help", () => {
    const r = runCli(["--help"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("Usage:");
  });

  it("prints usage when invoked with help", () => {
    const r = runCli(["help"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("benchmark score");
  });
});

describe("cli / deferred subcommands", () => {
  it("`run` requires --case <slug>", () => {
    // P3 wires `run` for real (T2-backend). The previous P1 test expected
    // exit 2 + "deferred to P3"; we now probe the real command via a
    // missing --case which fails in argv parsing before any spawn.
    const r = runCli(["run"]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("--case");
  });

  it("`run --case <slug> --dry-run` prints a plan and exits 0", () => {
    const r = runCli([
      "run",
      "--case",
      "demo-url-shortener-build",
      "--dry-run",
    ]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("benchmark run --dry-run");
    expect(r.stdout).toContain("plugin_ref");
    expect(r.stdout).toContain("argv (json)");
    expect(r.stdout).toContain("env_allowlist");
    expect(r.stdout).toContain("(dry-run: no subprocess spawned");
  });

  it("`serve` rejects an out-of-range --port with exit 1 (no longer deferred in P2)", () => {
    // P2 implements `serve` for real (T2-backend). The previous P1 test
    // expected exit 2 + "deferred to P2"; we now probe the real command via
    // --port=999999 which fails before any port is bound.
    const r = runCli(["serve", "--port", "999999"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/--port must be a valid TCP port/);
  });

  it("`export-website` exits 2 with deferred message", () => {
    const r = runCli(["export-website"]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("deferred");
  });
});

describe("cli / unknown subcommand", () => {
  it("exits 1 with usage on the stderr", () => {
    const r = runCli(["totally-made-up"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("Unknown command");
    expect(r.stdout).toContain("Usage:");
  });
});

describe("cli / score happy path", () => {
  let workDir: string;
  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), "cli-score-"));
  });
  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it("imports synthetic-pass and writes score.json + metrics.json", () => {
    const r = runCli([
      "score",
      "--run-id",
      "cli-pass-001",
      "--fixture",
      resolve(REPO_ROOT, "fixtures", "synthetic-pass"),
      "--case",
      resolve(REPO_ROOT, "cases", "demo-url-shortener-build.yaml"),
      "--runs-dir",
      workDir,
    ]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("guild_score=100");
    expect(existsSync(join(workDir, "cli-pass-001", "score.json"))).toBe(true);
    expect(existsSync(join(workDir, "cli-pass-001", "metrics.json"))).toBe(true);
  });

  it("supports --flag=value syntax (no space between flag and value)", () => {
    const r = runCli([
      "score",
      `--run-id=cli-eq-001`,
      `--fixture=${resolve(REPO_ROOT, "fixtures", "synthetic-pass")}`,
      `--case=${resolve(REPO_ROOT, "cases", "demo-url-shortener-build.yaml")}`,
      `--runs-dir=${workDir}`,
    ]);
    expect(r.status).toBe(0);
    expect(existsSync(join(workDir, "cli-eq-001", "score.json"))).toBe(true);
  });

  it("exits 1 when --run-id is omitted", () => {
    const r = runCli(["score"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("--run-id");
  });

  it("exits 1 when run dir does not exist and no --fixture is passed", () => {
    const r = runCli([
      "score",
      "--run-id",
      "missing-run",
      "--runs-dir",
      workDir,
    ]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("Run directory not found");
  });
});

describe("cli / compare happy path", () => {
  let workDir: string;
  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), "cli-compare-"));
  });
  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it("rejects compare without --baseline", () => {
    const r = runCli(["compare", "--candidate", "x"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("--baseline");
  });

  it("rejects compare without --candidate", () => {
    const r = runCli(["compare", "--baseline", "x"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("--candidate");
  });

  it("scores two runs then compares them end-to-end", () => {
    const fixturePath = resolve(REPO_ROOT, "fixtures", "synthetic-pass");
    const casePath = resolve(REPO_ROOT, "cases", "demo-url-shortener-build.yaml");
    const a = runCli([
      "score",
      "--run-id",
      "set-a-1",
      "--fixture",
      fixturePath,
      "--case",
      casePath,
      "--runs-dir",
      workDir,
    ]);
    expect(a.status).toBe(0);
    const b = runCli([
      "score",
      "--run-id",
      "set-b-1",
      "--fixture",
      fixturePath,
      "--case",
      casePath,
      "--runs-dir",
      workDir,
    ]);
    expect(b.status).toBe(0);
    const c = runCli([
      "compare",
      "--baseline",
      "set-a",
      "--candidate",
      "set-b",
      "--runs-dir",
      workDir,
    ]);
    expect(c.status).toBe(0);
    expect(c.stdout).toContain("status=ok");
    expect(
      existsSync(join(workDir, "_compare", "set-a__set-b.json")),
    ).toBe(true);
  });
});
