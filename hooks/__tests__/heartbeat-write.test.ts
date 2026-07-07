/**
 * hooks/__tests__/heartbeat-write.test.ts
 *
 * G-9 (SC-5) — structured heartbeat WRITE side (hooks/lib/heartbeat-write.ts)
 * + the REAL PostToolUse path (hooks/post-tool-use.ts spawned via tsx with a
 * real-shape payload — fixtures/post-tool-use.json shape).
 *
 * Covers:
 *  - env gate: GUILD_RUN_ID + GUILD_SPECIALIST both required (either absent
 *    → no write, reason "env-absent", no fs side-effects)
 *  - written shape parses via readHeartbeat() (the read side's contract)
 *  - step: GUILD_STEP || null; last_action: hook payload tool_name
 *  - atomicity: no partial/.tmp sibling survives a write
 *  - fail-open: unwritable in-progress path → written:false, never throws
 *  - unsafe ids (path traversal) refused
 *  - REAL PATH: spawning post-tool-use.ts with env set writes the heartbeat
 */

import { spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import {
  writeHeartbeat,
  writeHeartbeatFromEnv,
} from "../lib/heartbeat-write";
import { readHeartbeat, heartbeatPath } from "../lib/heartbeat";

const POST_TOOL_USE = path.resolve(__dirname, "../post-tool-use.ts");

const RUN_ID = "run-85d27757-f47b-4ccd-adaf-f91c749a4e8f";
const SPECIALIST = "hook-engineer";

let root: string;
let runDir: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "guild-hb-write-"));
  // Anchor resolveGuildRoot at the temp root (a .git dir, like a real repo).
  fs.mkdirSync(path.join(root, ".git"), { recursive: true });
  runDir = path.join(root, ".guild", "runs", RUN_ID);
  fs.mkdirSync(runDir, { recursive: true });
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("writeHeartbeatFromEnv — env gate", () => {
  it("no-ops (env-absent) when GUILD_RUN_ID is missing", () => {
    const res = writeHeartbeatFromEnv({
      toolName: "Bash",
      cwd: root,
      env: { GUILD_SPECIALIST: SPECIALIST },
    });
    expect(res.written).toBe(false);
    expect(res.reason).toBe("env-absent");
    expect(fs.existsSync(path.join(runDir, "in-progress"))).toBe(false);
  });

  it("no-ops (env-absent) when GUILD_SPECIALIST is missing", () => {
    const res = writeHeartbeatFromEnv({
      toolName: "Bash",
      cwd: root,
      env: { GUILD_RUN_ID: RUN_ID },
    });
    expect(res.written).toBe(false);
    expect(res.reason).toBe("env-absent");
    expect(fs.existsSync(path.join(runDir, "in-progress"))).toBe(false);
  });

  it("no-ops on empty-string env values", () => {
    const res = writeHeartbeatFromEnv({
      cwd: root,
      env: { GUILD_RUN_ID: "", GUILD_SPECIALIST: SPECIALIST },
    });
    expect(res.written).toBe(false);
    expect(res.reason).toBe("env-absent");
  });

  it("refuses unsafe ids (path traversal) without throwing", () => {
    const res = writeHeartbeatFromEnv({
      cwd: root,
      env: { GUILD_RUN_ID: RUN_ID, GUILD_SPECIALIST: "../evil" },
    });
    expect(res.written).toBe(false);
    expect(res.reason).toBe("unsafe-id");
  });
});

describe("writeHeartbeatFromEnv — write shape", () => {
  it("writes a record readHeartbeat() parses, with last_action = tool name", () => {
    const res = writeHeartbeatFromEnv({
      toolName: "Write",
      cwd: root,
      env: { GUILD_RUN_ID: RUN_ID, GUILD_SPECIALIST: SPECIALIST },
    });
    expect(res.written).toBe(true);
    expect(res.path).toBe(heartbeatPath(runDir, SPECIALIST));

    const hb = readHeartbeat(runDir, SPECIALIST);
    expect(hb).not.toBeNull();
    // timestamp is a parseable ISO stamp
    expect(Number.isNaN(Date.parse(hb!.timestamp))).toBe(false);
    expect(hb!.last_action).toBe("Write");
    // GUILD_STEP unset → step is null on disk; readHeartbeat drops non-strings
    expect(hb!.step).toBeUndefined();
    const onDisk = JSON.parse(
      fs.readFileSync(heartbeatPath(runDir, SPECIALIST), "utf8"),
    ) as Record<string, unknown>;
    expect(onDisk["step"]).toBeNull();
  });

  it("records GUILD_STEP when set", () => {
    writeHeartbeatFromEnv({
      toolName: "Edit",
      cwd: root,
      env: {
        GUILD_RUN_ID: RUN_ID,
        GUILD_SPECIALIST: SPECIALIST,
        GUILD_STEP: "writing tests",
      },
    });
    const hb = readHeartbeat(runDir, SPECIALIST);
    expect(hb?.step).toBe("writing tests");
    expect(hb?.last_action).toBe("Edit");
  });

  it("honors GUILD_RUN_DIR over the resolved <root>/.guild/runs path", () => {
    const altDir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-hb-alt-"));
    try {
      const res = writeHeartbeatFromEnv({
        toolName: "Bash",
        cwd: root,
        env: {
          GUILD_RUN_ID: RUN_ID,
          GUILD_SPECIALIST: SPECIALIST,
          GUILD_RUN_DIR: altDir,
        },
      });
      expect(res.written).toBe(true);
      expect(readHeartbeat(altDir, SPECIALIST)).not.toBeNull();
      expect(fs.existsSync(heartbeatPath(runDir, SPECIALIST))).toBe(false);
    } finally {
      fs.rmSync(altDir, { recursive: true, force: true });
    }
  });

  it("is atomic: no .tmp sibling survives, exactly one file in in-progress/", () => {
    // Two consecutive writes (overwrite path) — still exactly one file.
    for (let i = 0; i < 2; i++) {
      const res = writeHeartbeatFromEnv({
        toolName: "Bash",
        cwd: root,
        env: { GUILD_RUN_ID: RUN_ID, GUILD_SPECIALIST: SPECIALIST },
      });
      expect(res.written).toBe(true);
    }
    const entries = fs.readdirSync(path.join(runDir, "in-progress"));
    expect(entries).toEqual([`${SPECIALIST}.json`]);
    // And the surviving file is complete valid JSON (no partial write).
    expect(readHeartbeat(runDir, SPECIALIST)).not.toBeNull();
  });

  it("fails open when the in-progress path is unwritable (never throws)", () => {
    // Block mkdir by planting a FILE where the in-progress dir must go.
    fs.writeFileSync(path.join(runDir, "in-progress"), "not a dir", "utf8");
    const res = writeHeartbeatFromEnv({
      toolName: "Bash",
      cwd: root,
      env: { GUILD_RUN_ID: RUN_ID, GUILD_SPECIALIST: SPECIALIST },
    });
    expect(res.written).toBe(false);
    expect(res.reason).toMatch(/^write-failed:/);
  });
});

describe("writeHeartbeat — direct atomic writer", () => {
  it("creates in-progress/ and writes the exact record", () => {
    const p = writeHeartbeat(runDir, SPECIALIST, {
      timestamp: "2026-06-10T12:00:00.000Z",
      step: "implementing",
      last_action: "Read",
    });
    expect(p).toBe(heartbeatPath(runDir, SPECIALIST));
    const hb = readHeartbeat(runDir, SPECIALIST);
    expect(hb).toEqual({
      timestamp: "2026-06-10T12:00:00.000Z",
      step: "implementing",
      last_action: "Read",
    });
  });
});

describe("REAL PATH — post-tool-use.ts PostToolUse hook", () => {
  /** Real-shape payload mirroring fixtures/post-tool-use.json. */
  function payloadFor(toolName: string): Record<string, unknown> {
    return {
      session_id: "sess-abc123",
      transcript_path: "/tmp/session.jsonl",
      cwd: root,
      permission_mode: "default",
      hook_event_name: "PostToolUse",
      tool_name: toolName,
      tool_input: { command: "ls" },
      tool_response: { success: true },
      agent_name: "backend",
    };
  }

  function runPostToolUse(env: Record<string, string>): number {
    // Strip any ambient GUILD_* leakage (the suite itself may run inside a
    // guild lane that exports these) so the env gate is exercised honestly.
    const base: Record<string, string | undefined> = { ...process.env };
    for (const k of [
      "GUILD_RUN_ID",
      "GUILD_SPECIALIST",
      "GUILD_STEP",
      "GUILD_RUN_DIR",
      "GUILD_LANE_ID",
      "GUILD_CWD",
    ]) {
      delete base[k];
    }
    const result = spawnSync("npx", ["tsx", POST_TOOL_USE], {
      input: JSON.stringify(payloadFor("Bash")),
      encoding: "utf8",
      env: { ...base, GUILD_CWD: root, ...env },
      timeout: 25000,
    });
    return result.status ?? 1;
  }

  it("writes the heartbeat when GUILD_RUN_ID + GUILD_SPECIALIST are exported", () => {
    const status = runPostToolUse({
      GUILD_RUN_ID: RUN_ID,
      GUILD_SPECIALIST: SPECIALIST,
      GUILD_STEP: "lane work",
    });
    expect(status).toBe(0);
    const hb = readHeartbeat(runDir, SPECIALIST);
    expect(hb).not.toBeNull();
    expect(hb!.last_action).toBe("Bash");
    expect(hb!.step).toBe("lane work");
    expect(Number.isNaN(Date.parse(hb!.timestamp))).toBe(false);
  });

  it("writes NO heartbeat when GUILD_SPECIALIST is absent (env gate, real path)", () => {
    const status = runPostToolUse({ GUILD_RUN_ID: RUN_ID });
    expect(status).toBe(0);
    expect(fs.existsSync(path.join(runDir, "in-progress"))).toBe(false);
  });
});
