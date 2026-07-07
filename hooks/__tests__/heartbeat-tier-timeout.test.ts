/**
 * hooks/__tests__/heartbeat-tier-timeout.test.ts
 *
 * G-10 (SC-5) — tier-scaled idle timeouts (hooks/lib/heartbeat.ts) + the
 * REAL teammate-idle path (hooks/agent-team/teammate-idle.ts via tsx).
 *
 * Covers:
 *  - built-in tier defaults: cheap 180000 / mid 600000 / powerful 1200000
 *  - tier resolved from the run-state lane record (guild.run_state.v1 shape)
 *  - explicit defaults.heartbeat_timeout_ms WINS over the tier map
 *  - fallback mid when tier unresolvable (byte-identical to the old default)
 *  - readHeartbeatTimeoutMs back-compat unchanged
 *  - REAL PATH: teammate-idle resolves the tier-scaled timeout end-to-end
 *
 * Fixtures mirror the REAL guild.run_state.v1 shape on disk
 * (.guild/runs/run-57732c80-.../run-state.json).
 */

import { spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import {
  DEFAULT_HEARTBEAT_TIMEOUT_MS,
  TIER_HEARTBEAT_TIMEOUTS_MS,
  readHeartbeatTimeoutMs,
  readExplicitHeartbeatTimeoutMs,
  resolveHeartbeatTimeoutMs,
  resolveLaneTier,
} from "../lib/heartbeat";

const TEAMMATE_IDLE = path.resolve(__dirname, "../agent-team/teammate-idle.ts");
const RUN_ID = "run-57732c80-39d6-462b-a3e5-213e553d3c9c";

let root: string;
let runDir: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "guild-tier-timeout-"));
  fs.mkdirSync(path.join(root, ".git"), { recursive: true });
  runDir = path.join(root, ".guild", "runs", RUN_ID);
  fs.mkdirSync(runDir, { recursive: true });
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

/** Real-shape guild.run_state.v1 (mirrors run-57732c80's on-disk file). */
function writeRunState(
  lanes: Record<string, { status: string; tier?: string }>,
): void {
  const laneRecords: Record<string, unknown> = {};
  for (const [id, l] of Object.entries(lanes)) {
    laneRecords[id] = {
      status: l.status,
      ...(l.tier !== undefined ? { tier: l.tier } : {}),
      attempt: 1,
      depends_on: [],
      receipt_ref: null,
      updated_at: "2026-06-07T01:59:48.036Z",
    };
  }
  fs.writeFileSync(
    path.join(runDir, "run-state.json"),
    JSON.stringify(
      {
        schema_version: "guild.run_state.v1",
        run_id: RUN_ID,
        plan_slug: RUN_ID,
        program_id: null,
        wave_index: 0,
        lanes: laneRecords,
        last_checkpoint_at: "2026-06-07T01:59:52.402Z",
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
}

function writeSettings(heartbeatTimeoutMs?: number): void {
  fs.mkdirSync(path.join(root, ".guild"), { recursive: true });
  fs.writeFileSync(
    path.join(root, ".guild", "settings.json"),
    JSON.stringify(
      {
        defaults:
          heartbeatTimeoutMs !== undefined
            ? { heartbeat_timeout_ms: heartbeatTimeoutMs }
            : {},
      },
      null,
      2,
    ),
    "utf8",
  );
}

describe("TIER_HEARTBEAT_TIMEOUTS_MS — built-in defaults", () => {
  it("ships cheap=180000 / mid=600000 / powerful=1200000", () => {
    expect(TIER_HEARTBEAT_TIMEOUTS_MS).toEqual({
      cheap: 180000,
      mid: 600000,
      powerful: 1200000,
    });
  });

  it("mid equals the pre-G-10 default (fallback is byte-identical)", () => {
    expect(TIER_HEARTBEAT_TIMEOUTS_MS.mid).toBe(DEFAULT_HEARTBEAT_TIMEOUT_MS);
  });
});

describe("resolveLaneTier — run-state lane record", () => {
  it("reads the tier of an assigned task's lane record", () => {
    writeRunState({ "task-1": { status: "in_progress", tier: "powerful" } });
    expect(resolveLaneTier(runDir, "backend", ["task-1"])).toBe("powerful");
  });

  it("first assigned task with a tier wins", () => {
    writeRunState({
      "task-1": { status: "done" }, // no tier
      "task-2": { status: "in_progress", tier: "cheap" },
    });
    expect(resolveLaneTier(runDir, "backend", ["task-1", "task-2"])).toBe("cheap");
  });

  it("falls back to a lane keyed by the specialist name", () => {
    writeRunState({ backend: { status: "in_progress", tier: "cheap" } });
    expect(resolveLaneTier(runDir, "backend", ["task-9"])).toBe("cheap");
  });

  it("returns null when no lane carries a tier", () => {
    writeRunState({ "task-1": { status: "in_progress" } });
    expect(resolveLaneTier(runDir, "backend", ["task-1"])).toBeNull();
  });

  it("returns null when run-state.json is absent or corrupt", () => {
    expect(resolveLaneTier(runDir, "backend", ["task-1"])).toBeNull();
    fs.writeFileSync(path.join(runDir, "run-state.json"), "{not json", "utf8");
    expect(resolveLaneTier(runDir, "backend", ["task-1"])).toBeNull();
  });

  it("ignores an invalid tier token", () => {
    writeRunState({ "task-1": { status: "in_progress", tier: "enormous" } });
    expect(resolveLaneTier(runDir, "backend", ["task-1"])).toBeNull();
  });
});

describe("resolveHeartbeatTimeoutMs — precedence", () => {
  it("uses the tier default when no explicit setting exists", () => {
    expect(resolveHeartbeatTimeoutMs(root, "cheap")).toBe(180000);
    expect(resolveHeartbeatTimeoutMs(root, "mid")).toBe(600000);
    expect(resolveHeartbeatTimeoutMs(root, "powerful")).toBe(1200000);
  });

  it("falls back to mid (600000) for null/undefined/unknown tier", () => {
    expect(resolveHeartbeatTimeoutMs(root, null)).toBe(600000);
    expect(resolveHeartbeatTimeoutMs(root)).toBe(600000);
    expect(resolveHeartbeatTimeoutMs(root, "enormous")).toBe(600000);
  });

  it("an explicit defaults.heartbeat_timeout_ms WINS over every tier", () => {
    writeSettings(123456);
    expect(resolveHeartbeatTimeoutMs(root, "cheap")).toBe(123456);
    expect(resolveHeartbeatTimeoutMs(root, "powerful")).toBe(123456);
    expect(resolveHeartbeatTimeoutMs(root, null)).toBe(123456);
  });

  it("an invalid explicit value degrades to the tier map", () => {
    writeSettings(-5 as number);
    expect(resolveHeartbeatTimeoutMs(root, "cheap")).toBe(180000);
  });
});

describe("readHeartbeatTimeoutMs / readExplicitHeartbeatTimeoutMs — back-compat", () => {
  it("readHeartbeatTimeoutMs still returns the documented default when unset", () => {
    expect(readHeartbeatTimeoutMs(root)).toBe(DEFAULT_HEARTBEAT_TIMEOUT_MS);
  });

  it("readHeartbeatTimeoutMs still returns the explicit value when set", () => {
    writeSettings(120000);
    expect(readHeartbeatTimeoutMs(root)).toBe(120000);
  });

  it("readExplicitHeartbeatTimeoutMs returns null when unset, the value when set", () => {
    expect(readExplicitHeartbeatTimeoutMs(root)).toBeNull();
    writeSettings(120000);
    expect(readExplicitHeartbeatTimeoutMs(root)).toBe(120000);
  });
});

describe("REAL PATH — teammate-idle resolves the tier-scaled timeout", () => {
  function runTeammateIdle(): { exitCode: number; stderr: string } {
    const base: Record<string, string | undefined> = { ...process.env };
    for (const k of ["GUILD_RUN_ID", "GUILD_CWD", "GUILD_TASK_ID"]) {
      delete base[k];
    }
    const result = spawnSync("npx", ["tsx", TEAMMATE_IDLE], {
      input: JSON.stringify({
        session_id: "sess-abc123",
        cwd: root,
        hook_event_name: "TeammateIdle",
        teammate_name: "backend",
        team_name: "guild",
      }),
      encoding: "utf8",
      env: {
        ...base,
        CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1",
        GUILD_RUN_ID: RUN_ID,
      },
      timeout: 25000,
    });
    return { exitCode: result.status ?? 1, stderr: result.stderr ?? "" };
  }

  /** Plan file assigning task-1 to backend (the shape findAssignedTaskIds reads). */
  function writePlan(): void {
    const planDir = path.join(root, ".guild", "plan");
    fs.mkdirSync(planDir, { recursive: true });
    fs.writeFileSync(
      path.join(planDir, "test-plan.md"),
      ["# Plan", "", "- id: task-1", "  owner: backend", ""].join("\n"),
      "utf8",
    );
  }

  it("honors the run-state tier (cheap → timeoutMs=180000)", () => {
    writePlan();
    writeRunState({ "task-1": { status: "in_progress", tier: "cheap" } });
    const { exitCode, stderr } = runTeammateIdle();
    expect(exitCode).toBe(0);
    expect(stderr).toContain("timeoutMs=180000");
    expect(stderr).toContain("tier=cheap");
  });

  it("explicit defaults.heartbeat_timeout_ms wins over the tier", () => {
    writePlan();
    writeRunState({ "task-1": { status: "in_progress", tier: "cheap" } });
    writeSettings(424242);
    const { exitCode, stderr } = runTeammateIdle();
    expect(exitCode).toBe(0);
    expect(stderr).toContain("timeoutMs=424242");
  });

  it("falls back to mid (600000) when run-state has no tier", () => {
    writePlan();
    const { exitCode, stderr } = runTeammateIdle();
    expect(exitCode).toBe(0);
    expect(stderr).toContain("timeoutMs=600000");
    expect(stderr).toContain("tier=unresolved(mid-fallback)");
  });
});
