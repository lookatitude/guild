// v1.4.0 — T3d-backend-platform statusline-guild script tests.
// Pins the audit-conformant 3-mode contract (per
// `benchmark/plans/v1.4-claude-plugin-surface-audit.md` lines 253-276):
//   - Mode A (counters.json present): full 5-field format
//     `phase: <p> | round: <r> | cap: <c> | loops: <m> | restarts: <n>`.
//   - Mode B (GUILD_RUN_ID unset): single-line `phase: unknown` (no other fields).
//   - Mode C (GUILD_RUN_ID set, counters.json missing): single-line
//     `phase: <run-id> (initialising)`.

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";

const SCRIPT = resolve(__dirname, "../../scripts/statusline-guild.sh");
const RUN_ID = "test-run-statusline";

function runScript(env: Record<string, string> = {}): {
  exitCode: number;
  stdout: string;
  stderr: string;
} {
  const result = spawnSync("bash", [SCRIPT], {
    encoding: "utf8",
    env: { ...process.env, ...env },
    timeout: 5000,
  });
  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

let tmpRoot: string;
let runDir: string;
let countersPath: string;

beforeEach(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), "guild-statusline-"));
  runDir = join(tmpRoot, ".guild", "runs", RUN_ID);
  mkdirSync(runDir, { recursive: true });
  countersPath = join(runDir, "counters.json");
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe("statusline-guild.sh — output shape", () => {
  it("Mode A: exits 0 with the 5-field format when counters.json is present", () => {
    // Seed a counters.json so Mode A fires.
    writeFileSync(
      countersPath,
      JSON.stringify({
        schema_version: 1,
        run_id: RUN_ID,
        counters: { l1_round: 0, l2_round: 0 },
      }),
    );
    const result = runScript({
      GUILD_RUN_ID: RUN_ID,
      GUILD_CWD: tmpRoot,
    });
    expect(result.exitCode).toBe(0);
    // Architect's 5-field format.
    expect(result.stdout).toMatch(
      /^phase: .+ \| round: \d+ \| cap: \d+ \| loops: .+ \| restarts: \d+\n?$/,
    );
  });

  it("Mode B: outputs only `phase: unknown` when GUILD_RUN_ID is unset", () => {
    const result = runScript({
      GUILD_RUN_ID: "",
      GUILD_CWD: tmpRoot,
    });
    expect(result.exitCode).toBe(0);
    // Per audit line 267: bare `phase: unknown`, no other fields.
    expect(result.stdout.trim()).toBe("phase: unknown");
    expect(result.stdout).not.toContain("round:");
    expect(result.stdout).not.toContain("cap:");
    expect(result.stdout).not.toContain("loops:");
    expect(result.stdout).not.toContain("restarts:");
  });

  it("Mode C: outputs `phase: <run-id> (initialising)` when counters.json is missing", () => {
    const result = runScript({
      GUILD_RUN_ID: RUN_ID,
      GUILD_CWD: tmpRoot,
    });
    expect(result.exitCode).toBe(0);
    // Per audit lines 272-273: bare initialising marker, no other fields.
    expect(result.stdout.trim()).toBe(`phase: ${RUN_ID} (initialising)`);
    expect(result.stdout).not.toContain("round:");
    expect(result.stdout).not.toContain("cap:");
  });

  it("Mode A: uses provided phase/loops/cap env values when counters.json is present", () => {
    writeFileSync(
      countersPath,
      JSON.stringify({
        schema_version: 1,
        run_id: RUN_ID,
        counters: { l1_round: 0, l2_round: 0 },
      }),
    );
    const result = runScript({
      GUILD_RUN_ID: RUN_ID,
      GUILD_CWD: tmpRoot,
      GUILD_PHASE: "execute",
      GUILD_LOOPS: "implementation",
      GUILD_LOOP_CAP: "8",
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("phase: execute");
    expect(result.stdout).toContain("loops: implementation");
    expect(result.stdout).toContain("cap: 8");
  });
});

describe("statusline-guild.sh — counters.json parsing", () => {
  it("reads global L1/L2 counters when no lane id is set", () => {
    writeFileSync(
      countersPath,
      JSON.stringify({
        schema_version: 1,
        run_id: RUN_ID,
        counters: {
          l1_round: 3,
          l2_round: 5,
        },
      }),
    );
    const result = runScript({
      GUILD_RUN_ID: RUN_ID,
      GUILD_CWD: tmpRoot,
      GUILD_PHASE: "plan",
    });
    expect(result.exitCode).toBe(0);
    // round = max(L1, L2) = 5.
    expect(result.stdout).toContain("round: 5");
    expect(result.stdout).toContain("restarts: 0");
  });

  it("reads per-lane block when GUILD_LANE_ID matches a key", () => {
    writeFileSync(
      countersPath,
      JSON.stringify({
        schema_version: 1,
        run_id: RUN_ID,
        counters: {
          l1_round: 1,
          l2_round: 2,
          "T3d": {
            L3_round: 4,
            L4_round: 6,
            security_round: 0,
            restart_count: 2,
          },
        },
      }),
    );
    const result = runScript({
      GUILD_RUN_ID: RUN_ID,
      GUILD_CWD: tmpRoot,
      GUILD_LANE_ID: "T3d",
      GUILD_PHASE: "execute",
    });
    expect(result.exitCode).toBe(0);
    // round = max(L3, L4, security) = 6.
    expect(result.stdout).toContain("round: 6");
    expect(result.stdout).toContain("restarts: 2");
  });

  it("falls back to defaults when counters.json is malformed", () => {
    writeFileSync(countersPath, "not valid json {{{");
    const result = runScript({
      GUILD_RUN_ID: RUN_ID,
      GUILD_CWD: tmpRoot,
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("round: 0");
    expect(result.stdout).toContain("restarts: 0");
  });

  it("respects GUILD_RUN_DIR override", () => {
    const altRunDir = join(tmpRoot, "alt-run-dir");
    mkdirSync(altRunDir, { recursive: true });
    writeFileSync(
      join(altRunDir, "counters.json"),
      JSON.stringify({
        schema_version: 1,
        run_id: RUN_ID,
        counters: { l1_round: 9, l2_round: 0 },
      }),
    );
    const result = runScript({
      GUILD_RUN_ID: RUN_ID,
      GUILD_RUN_DIR: altRunDir,
      GUILD_PHASE: "brainstorm",
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("round: 9");
  });
});
