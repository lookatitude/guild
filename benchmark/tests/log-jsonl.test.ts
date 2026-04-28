// v1.4.0 — T3c-backend-logging JSONL writer tests.
// Pins the binding contracts:
//   - 12 event types (envelope + type-specific fields).
//   - Stable lockfile inode permanence across appends + rotations.
//   - 4-parallel-process append serialization (no torn lines).
//   - Rotation-during-append: rotation under the write lock; append
//     after rotation lands in the new live log.
//   - Rotator-rotator O_EXCL retry: a leftover live file is recovered.
//   - Cross-platform fallback: per-lane file path + merge.
//   - Sidecar pre/post pairing + orphan sweep.

import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import { gzipSync } from "node:zlib";

import {
  appendEvent,
  appendSidecarPre,
  archiveDir,
  archivePath,
  buildToolCallFromPair,
  consumeSidecarPre,
  EVENT_TYPES,
  HOOK_EVENT_NAMES,
  initStableLockfile,
  laneFallbackPath,
  listArchives,
  liveLogPath,
  lockPath,
  lockfileInode,
  lockfileSize,
  nextRotationIndex,
  ORPHAN_RESULT_EXCERPT,
  readAllEvents,
  rotate,
  sidecarPath,
  snapshotLiveLog,
  sweepOrphanedSidecar,
  TOOL_CALL_TOOL_VALUES,
  type JsonlEvent,
  type SidecarPreEntry,
} from "../src/log-jsonl.js";

let tmpRoot: string;
let runDir: string;
const RUN_ID = "test-run-log-jsonl";
const TS = "2026-04-27T07:35:00.123Z";

beforeEach(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), "guild-log-jsonl-"));
  runDir = join(tmpRoot, "runs", RUN_ID);
  mkdirSync(join(runDir, "logs"), { recursive: true });
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

// ──────────────────────────────────────────────────────────────────────────
// Path + init contracts
// ──────────────────────────────────────────────────────────────────────────

describe("log-jsonl / paths + lockfile init", () => {
  it("stable lockfile is at <runDir>/logs/.lock (matches counter-store)", () => {
    expect(lockPath(runDir)).toBe(join(runDir, "logs", ".lock"));
  });

  it("live log path is <runDir>/logs/v1.4-events.jsonl", () => {
    expect(liveLogPath(runDir)).toBe(join(runDir, "logs", "v1.4-events.jsonl"));
  });

  it("archive path is archive/v1.4-events.<N>.jsonl.gz", () => {
    expect(archivePath(runDir, 3)).toBe(
      join(runDir, "logs", "archive", "v1.4-events.3.jsonl.gz"),
    );
  });

  it("sidecar path is logs/tool-call-pre.jsonl", () => {
    expect(sidecarPath(runDir)).toBe(join(runDir, "logs", "tool-call-pre.jsonl"));
  });

  it("initStableLockfile creates a zero-byte permanent lockfile", () => {
    initStableLockfile(runDir);
    expect(existsSync(lockPath(runDir))).toBe(true);
    expect(lockfileSize(runDir)).toBe(0);
  });

  it("initStableLockfile is idempotent (does not change inode)", () => {
    initStableLockfile(runDir);
    const ino1 = lockfileInode(runDir);
    initStableLockfile(runDir);
    const ino2 = lockfileInode(runDir);
    expect(ino1).toBe(ino2);
    expect(ino1).not.toBeNull();
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Append path — single event, redaction, JSONL shape
// ──────────────────────────────────────────────────────────────────────────

describe("log-jsonl / append path", () => {
  it("appends a phase_start event in JSONL format (one line)", () => {
    const ev: JsonlEvent = {
      ts: TS,
      event: "phase_start",
      run_id: RUN_ID,
      phase: "plan",
    };
    appendEvent(runDir, ev);
    const text = readFileSync(liveLogPath(runDir), "utf8");
    expect(text.endsWith("\n")).toBe(true);
    const line = text.trim();
    const parsed = JSON.parse(line);
    expect(parsed.event).toBe("phase_start");
    expect(parsed.phase).toBe("plan");
  });

  it("redacts secrets in command_redacted before writing", () => {
    const ev: JsonlEvent = {
      ts: TS,
      event: "tool_call",
      run_id: RUN_ID,
      tool: "Bash",
      command_redacted: "curl -H 'Authorization: Bearer abc.def.ghi_long_token_yes' /api",
      status: "ok",
      latency_ms: 5,
      result_excerpt_redacted: "OK",
    };
    appendEvent(runDir, ev);
    const text = readFileSync(liveLogPath(runDir), "utf8");
    expect(text).toContain("[REDACTED_TOKEN]");
    expect(text).not.toContain("abc.def.ghi_long_token_yes");
  });

  it("never logs unredacted home-dir secret paths", () => {
    const ev: JsonlEvent = {
      ts: TS,
      event: "specialist_dispatch",
      run_id: RUN_ID,
      lane_id: "T1",
      specialist: "backend",
      task_id: "T1",
      prompt_excerpt: "loaded /Users/me/.ssh/id_rsa for auth",
    };
    appendEvent(runDir, ev);
    const text = readFileSync(liveLogPath(runDir), "utf8");
    expect(text).not.toContain("id_rsa");
    expect(text).toContain("[REDACTED]");
  });

  it("writes 5 events, each on its own line", () => {
    for (let i = 0; i < 5; i++) {
      appendEvent(runDir, {
        ts: TS,
        event: "phase_start",
        run_id: RUN_ID,
        phase: "execute",
      });
    }
    const text = readFileSync(liveLogPath(runDir), "utf8");
    const lines = text.trim().split("\n");
    expect(lines.length).toBe(5);
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Stable lockfile inode persistence
// ──────────────────────────────────────────────────────────────────────────

describe("log-jsonl / stable lockfile inode", () => {
  it("inode is preserved across many appends", () => {
    initStableLockfile(runDir);
    const ino0 = lockfileInode(runDir);
    for (let i = 0; i < 10; i++) {
      appendEvent(runDir, {
        ts: TS,
        event: "phase_start",
        run_id: RUN_ID,
        phase: "plan",
      });
    }
    expect(lockfileInode(runDir)).toBe(ino0);
    expect(lockfileSize(runDir)).toBe(0);
  });

  it("inode is preserved across rotation", () => {
    initStableLockfile(runDir);
    const ino0 = lockfileInode(runDir);
    appendEvent(runDir, {
      ts: TS,
      event: "phase_start",
      run_id: RUN_ID,
      phase: "plan",
    });
    rotate(runDir);
    appendEvent(runDir, {
      ts: TS,
      event: "phase_end",
      run_id: RUN_ID,
      phase: "plan",
      duration_ms: 100,
      status: "ok",
    });
    expect(lockfileInode(runDir)).toBe(ino0);
    expect(lockfileSize(runDir)).toBe(0);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 4-parallel-process append — race control
// ──────────────────────────────────────────────────────────────────────────

describe("log-jsonl / 4-parallel-process append (race control)", () => {
  it("4 truly-concurrent child processes appending 25 events each produce 100 valid lines (no torn lines)", async () => {
    if (process.platform === "win32") {
      // POSIX-only path; Windows uses per-lane fallback (covered separately).
      return;
    }
    initStableLockfile(runDir);
    const N = 4;
    const events_per = 25;
    // Spawn N async children that each wait on a BARRIER FILE so they
    // unblock simultaneously and contend on the shared lock for real.
    // The previous version used `spawnSync` in a sequential loop, which
    // serialized the children at the test process layer and never
    // exercised the lock under contention. This version coordinates via
    // a filesystem barrier; the children all spin-wait, then the test
    // drops the file and they race.
    const barrierPath = join(runDir, "_append_barrier.ready");
    const helperPath = join(runDir, "_append_helper.mts");
    const helper = `
      import { appendEvent } from "${join(__dirname, "..", "src", "log-jsonl.js").replace(/\\/g, "/")}";
      import fs from "node:fs";
      const runDir = process.argv[2];
      const idx = Number(process.argv[3]);
      const count = Number(process.argv[4]);
      const barrier = process.argv[5];
      while (!fs.existsSync(barrier)) {
        await new Promise((r) => setTimeout(r, 5));
      }
      for (let i = 0; i < count; i++) {
        appendEvent(runDir, {
          ts: new Date().toISOString(),
          event: "phase_start",
          run_id: "test-run",
          phase: "execute",
        });
      }
    `;
    writeFileSync(helperPath, helper);

    const promises: Promise<{ status: number | null; stderr: string }>[] = [];
    for (let i = 0; i < N; i++) {
      promises.push(
        new Promise((resolve) => {
          const child = spawn(
            "npx",
            [
              "tsx",
              helperPath,
              runDir,
              String(i),
              String(events_per),
              barrierPath,
            ],
            { stdio: ["ignore", "ignore", "pipe"] },
          );
          let stderr = "";
          child.stderr?.on("data", (d) => {
            stderr += d.toString();
          });
          child.on("exit", (status) => resolve({ status, stderr }));
        }),
      );
    }
    // Allow the children to spin up and reach the barrier check.
    await new Promise((r) => setTimeout(r, 250));
    writeFileSync(barrierPath, "go");
    const results = await Promise.all(promises);
    for (const r of results) {
      if (r.status !== 0) {
        // Surface child stderr so test failures are diagnosable.
        throw new Error(`child exited ${r.status}: ${r.stderr}`);
      }
    }
    const text = readFileSync(liveLogPath(runDir), "utf8");
    const lines = text.trim().split("\n");
    expect(lines.length).toBe(N * events_per);
    for (const line of lines) {
      // No torn lines: every line must JSON.parse cleanly.
      expect(() => JSON.parse(line)).not.toThrow();
      const parsed = JSON.parse(line);
      expect(parsed.event).toBe("phase_start");
    }
  }, 60000);
});

// ──────────────────────────────────────────────────────────────────────────
// Rotation
// ──────────────────────────────────────────────────────────────────────────

describe("log-jsonl / rotation", () => {
  it("nextRotationIndex returns 1 when archive/ is empty", () => {
    expect(nextRotationIndex(runDir)).toBe(1);
  });

  it("nextRotationIndex returns max+1 when archives exist", () => {
    mkdirSync(archiveDir(runDir), { recursive: true });
    writeFileSync(archivePath(runDir, 3), "");
    writeFileSync(archivePath(runDir, 1), "");
    expect(nextRotationIndex(runDir)).toBe(4);
  });

  it("rotate() moves live log to archive/<N>.jsonl.gz and recreates empty live", () => {
    appendEvent(runDir, {
      ts: TS,
      event: "phase_start",
      run_id: RUN_ID,
      phase: "plan",
    });
    expect(existsSync(liveLogPath(runDir))).toBe(true);
    rotate(runDir);
    expect(existsSync(archivePath(runDir, 1))).toBe(true);
    expect(existsSync(liveLogPath(runDir))).toBe(true);
    expect(statSync(liveLogPath(runDir)).size).toBe(0);
  });

  it("rotation-during-append: append after rotation lands in new live", () => {
    appendEvent(runDir, {
      ts: TS,
      event: "phase_start",
      run_id: RUN_ID,
      phase: "brainstorm",
    });
    rotate(runDir);
    appendEvent(runDir, {
      ts: TS,
      event: "phase_start",
      run_id: RUN_ID,
      phase: "plan",
    });
    const liveText = readFileSync(liveLogPath(runDir), "utf8");
    expect(liveText).toContain('"phase":"plan"');
    expect(liveText).not.toContain('"phase":"brainstorm"');
  });

  it("rotator-rotator EEXIST retry: a leftover live recreates cleanly", () => {
    // Simulate a crash leftover: the rotator just renamed live to archive,
    // then crashed before recreating live. A new live file (potentially
    // partial) sits at the path. The next rotation should clean it up.
    appendEvent(runDir, {
      ts: TS,
      event: "phase_start",
      run_id: RUN_ID,
      phase: "plan",
    });
    rotate(runDir);
    // Now write a "leftover" partial line into live.
    writeFileSync(liveLogPath(runDir), "partial-line-no-newline");
    rotate(runDir);
    // The leftover content is rotated into archive 2.
    expect(existsSync(archivePath(runDir, 2))).toBe(true);
    // Live is empty again.
    expect(statSync(liveLogPath(runDir)).size).toBe(0);
  });

  it("rotation triggers at the configured threshold", () => {
    // Drive append with a tiny threshold so rotation fires after one event.
    appendEvent(
      runDir,
      {
        ts: TS,
        event: "phase_start",
        run_id: RUN_ID,
        phase: "execute",
      },
      { rotationThresholdBytes: 10 },
    );
    expect(existsSync(archivePath(runDir, 1))).toBe(true);
    expect(statSync(liveLogPath(runDir)).size).toBe(0);
  });

  it("listArchives returns archives in N-ascending order", () => {
    mkdirSync(archiveDir(runDir), { recursive: true });
    writeFileSync(archivePath(runDir, 3), "");
    writeFileSync(archivePath(runDir, 1), "");
    writeFileSync(archivePath(runDir, 2), "");
    const list = listArchives(runDir);
    expect(list[0]).toContain("v1.4-events.1.jsonl.gz");
    expect(list[1]).toContain("v1.4-events.2.jsonl.gz");
    expect(list[2]).toContain("v1.4-events.3.jsonl.gz");
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Reader path — snapshot live + decompress archives
// ──────────────────────────────────────────────────────────────────────────

describe("log-jsonl / reader path", () => {
  it("snapshotLiveLog returns the live log content", () => {
    appendEvent(runDir, {
      ts: TS,
      event: "phase_start",
      run_id: RUN_ID,
      phase: "plan",
    });
    const text = snapshotLiveLog(runDir);
    expect(text).toContain('"event":"phase_start"');
  });

  it("snapshotLiveLog returns empty string when no live log exists", () => {
    expect(snapshotLiveLog(runDir)).toBe("");
  });

  it("readAllEvents reads archives + live + lane fallback in order", async () => {
    // Live event:
    appendEvent(runDir, {
      ts: "2026-04-27T07:00:02.000Z",
      event: "phase_end",
      run_id: RUN_ID,
      phase: "plan",
      duration_ms: 1,
      status: "ok",
    });
    // Manually craft an archive with 1 event:
    mkdirSync(archiveDir(runDir), { recursive: true });
    const arch1 = JSON.stringify({
      ts: "2026-04-27T07:00:00.000Z",
      event: "phase_start",
      run_id: RUN_ID,
      phase: "plan",
    }) + "\n";
    writeFileSync(archivePath(runDir, 1), gzipSync(Buffer.from(arch1)));

    const events = await readAllEvents(runDir);
    expect(events.length).toBe(2);
    // Archives come first → phase_start, then live → phase_end.
    expect(events[0]?.event).toBe("phase_start");
    expect(events[1]?.event).toBe("phase_end");
  });

  it("readAllEvents skips invalid lines via onSkip callback", async () => {
    writeFileSync(liveLogPath(runDir), "not valid json\n" + JSON.stringify({
      ts: TS,
      event: "phase_start",
      run_id: RUN_ID,
      phase: "plan",
    }) + "\n");
    const skipped: string[] = [];
    const events = await readAllEvents(runDir, (off) => {
      skipped.push(off.reason);
    });
    expect(events.length).toBe(1);
    expect(skipped.length).toBe(1);
    expect(skipped[0]).toMatch(/JSON\.parse failed/);
  });

  it("readAllEvents flags unknown event types via onSkip", async () => {
    writeFileSync(
      liveLogPath(runDir),
      JSON.stringify({ ts: TS, event: "unknown_v2_event", run_id: RUN_ID }) + "\n",
    );
    const skipped: string[] = [];
    const events = await readAllEvents(runDir, (off) => skipped.push(off.reason));
    expect(events.length).toBe(0);
    expect(skipped[0]).toContain("unknown");
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Cross-platform fallback — per-lane log files
// ──────────────────────────────────────────────────────────────────────────

describe("log-jsonl / cross-platform fallback", () => {
  it("forceFallback writes to logs/lane-<id>-events.jsonl", () => {
    appendEvent(
      runDir,
      {
        ts: TS,
        event: "phase_start",
        run_id: RUN_ID,
        phase: "plan",
      },
      { forceFallback: true, laneId: "T3c-backend-logging" },
    );
    const path = laneFallbackPath(runDir, "T3c-backend-logging");
    expect(existsSync(path)).toBe(true);
    const content = readFileSync(path, "utf8");
    expect(content).toContain('"phase":"plan"');
    // No live log should exist on the fallback path.
    expect(existsSync(liveLogPath(runDir))).toBe(false);
  });

  it("readAllEvents merges fallback files with archives + live", async () => {
    appendEvent(
      runDir,
      {
        ts: "2026-04-27T07:00:01.000Z",
        event: "phase_start",
        run_id: RUN_ID,
        phase: "plan",
      },
      { forceFallback: true, laneId: "lane-A" },
    );
    appendEvent(
      runDir,
      {
        ts: "2026-04-27T07:00:02.000Z",
        event: "phase_end",
        run_id: RUN_ID,
        phase: "plan",
        duration_ms: 1,
        status: "ok",
      },
      { forceFallback: true, laneId: "lane-B" },
    );
    const events = await readAllEvents(runDir);
    expect(events.length).toBe(2);
    expect(events.map((e) => e.event).sort()).toEqual(["phase_end", "phase_start"]);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Sidecar pre/post pairing
// ──────────────────────────────────────────────────────────────────────────

describe("log-jsonl / sidecar pre/post pairing", () => {
  it("appendSidecarPre writes one entry per call (with run_id)", () => {
    appendSidecarPre(runDir, {
      run_id: RUN_ID,
      ts_pre: "2026-04-27T07:00:00.000Z",
      tool: "Bash",
      command_redacted: "ls -la",
      call_id: "abc123",
    });
    const text = readFileSync(sidecarPath(runDir), "utf8");
    expect(text.trim().split("\n").length).toBe(1);
    expect(text).toContain('"call_id":"abc123"');
    expect(text).toContain(`"run_id":"${RUN_ID}"`);
  });

  it("consumeSidecarPre by call_id returns the matching entry and removes it (legacy)", () => {
    appendSidecarPre(runDir, {
      run_id: RUN_ID,
      ts_pre: "2026-04-27T07:00:00.000Z",
      tool: "Read",
      command_redacted: "Read /etc/hosts",
      call_id: "match-me",
    });
    appendSidecarPre(runDir, {
      run_id: RUN_ID,
      ts_pre: "2026-04-27T07:00:01.000Z",
      tool: "Bash",
      command_redacted: "echo hi",
      call_id: "other",
    });
    const m = consumeSidecarPre(runDir, "match-me");
    expect(m).not.toBeNull();
    expect(m?.tool).toBe("Read");
    // Sidecar still has the other entry.
    const text = readFileSync(sidecarPath(runDir), "utf8");
    expect(text).toContain('"call_id":"other"');
    expect(text).not.toContain('"call_id":"match-me"');
  });

  it("consumeSidecarPre by 4-tuple — oldest-unmatched among equal keys", () => {
    // Two pre-records with the SAME (run_id, lane_id, tool); different
    // ts_pre. Architect contract: oldest-unmatched wins.
    appendSidecarPre(runDir, {
      run_id: RUN_ID,
      lane_id: "T-X",
      ts_pre: "2026-04-27T07:00:01.500Z", // newer
      tool: "Bash",
      command_redacted: "newer",
    });
    appendSidecarPre(runDir, {
      run_id: RUN_ID,
      lane_id: "T-X",
      ts_pre: "2026-04-27T07:00:00.100Z", // older
      tool: "Bash",
      command_redacted: "older",
    });
    const m = consumeSidecarPre(runDir, {
      run_id: RUN_ID,
      lane_id: "T-X",
      tool: "Bash",
      post_ts: "2026-04-27T07:00:02.000Z",
    });
    expect(m).not.toBeNull();
    expect(m?.command_redacted).toBe("older");
    // The newer one stays.
    const text = readFileSync(sidecarPath(runDir), "utf8");
    expect(text).toContain('"command_redacted":"newer"');
    expect(text).not.toContain('"command_redacted":"older"');
  });

  it("consumeSidecarPre by 4-tuple ignores entries with mismatching run_id / lane_id / tool", () => {
    appendSidecarPre(runDir, {
      run_id: "OTHER-RUN",
      lane_id: "T-X",
      ts_pre: "2026-04-27T07:00:00.000Z",
      tool: "Bash",
      command_redacted: "wrong-run",
    });
    appendSidecarPre(runDir, {
      run_id: RUN_ID,
      lane_id: "T-Y",
      ts_pre: "2026-04-27T07:00:00.000Z",
      tool: "Bash",
      command_redacted: "wrong-lane",
    });
    appendSidecarPre(runDir, {
      run_id: RUN_ID,
      lane_id: "T-X",
      ts_pre: "2026-04-27T07:00:00.000Z",
      tool: "Read",
      command_redacted: "wrong-tool",
    });
    const m = consumeSidecarPre(runDir, {
      run_id: RUN_ID,
      lane_id: "T-X",
      tool: "Bash",
    });
    expect(m).toBeNull();
  });

  it("consumeSidecarPre by 4-tuple respects post_ts upper bound (pre_ts < post_ts)", () => {
    appendSidecarPre(runDir, {
      run_id: RUN_ID,
      ts_pre: "2026-04-27T07:00:05.000Z",
      tool: "Bash",
      command_redacted: "future",
    });
    const m = consumeSidecarPre(runDir, {
      run_id: RUN_ID,
      tool: "Bash",
      post_ts: "2026-04-27T07:00:00.000Z", // BEFORE pre_ts
    });
    expect(m).toBeNull();
  });

  it("consumeSidecarPre returns null when no match exists", () => {
    appendSidecarPre(runDir, {
      run_id: RUN_ID,
      ts_pre: "2026-04-27T07:00:00.000Z",
      tool: "Bash",
      command_redacted: "x",
      call_id: "a",
    });
    expect(consumeSidecarPre(runDir, "missing")).toBeNull();
  });

  it("buildToolCallFromPair joins pre + post into a tool_call event", () => {
    const pre: SidecarPreEntry = {
      run_id: RUN_ID,
      ts_pre: "2026-04-27T07:00:00.000Z",
      tool: "Bash",
      command_redacted: "npm test",
      call_id: "x1",
    };
    const ev = buildToolCallFromPair(pre, {
      ts_post: "2026-04-27T07:00:01.500Z",
      run_id: RUN_ID,
      status: "ok",
      result_excerpt_redacted: "PASS",
    });
    expect(ev.tool).toBe("Bash");
    expect(ev.latency_ms).toBe(1500);
    expect(ev.command_redacted).toBe("npm test");
    expect(ev.event).toBe("tool_call");
  });

  it("sweepOrphanedSidecar collects entries older than maxAgeMs", () => {
    const oldTs = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const newTs = new Date(Date.now() - 1000).toISOString();
    appendSidecarPre(runDir, {
      run_id: RUN_ID,
      ts_pre: oldTs,
      tool: "Bash",
      command_redacted: "old",
      call_id: "old1",
    });
    appendSidecarPre(runDir, {
      run_id: RUN_ID,
      ts_pre: newTs,
      tool: "Bash",
      command_redacted: "new",
      call_id: "new1",
    });
    const orphans = sweepOrphanedSidecar(runDir, Date.now(), 5 * 60 * 1000);
    expect(orphans.length).toBe(1);
    expect(orphans[0]?.call_id).toBe("old1");
    // The new entry is still in the sidecar.
    const text = readFileSync(sidecarPath(runDir), "utf8");
    expect(text).toContain('"call_id":"new1"');
    expect(text).not.toContain('"call_id":"old1"');
  });

  it("ORPHAN_RESULT_EXCERPT is the literal architect contract sentinel", () => {
    expect(ORPHAN_RESULT_EXCERPT).toBe("<orphaned — pre/post pairing failed>");
  });

  it("sweepOrphanedSidecarFull synthesizes tool_call events with status:err and latency_ms:-1", async () => {
    const { ORPHAN_LATENCY_MS, sweepOrphanedSidecarFull } = await import(
      "../src/log-jsonl.js"
    );
    const oldTs = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    appendSidecarPre(runDir, {
      run_id: RUN_ID,
      lane_id: "T-Z",
      ts_pre: oldTs,
      tool: "Bash",
      command_redacted: "stale",
    });
    const result = sweepOrphanedSidecarFull(runDir, Date.now(), 5 * 60 * 1000);
    expect(result.orphans.length).toBe(1);
    expect(result.events.length).toBe(1);
    const ev = result.events[0]!;
    expect(ev.event).toBe("tool_call");
    expect(ev.status).toBe("err");
    expect(ev.latency_ms).toBe(ORPHAN_LATENCY_MS);
    expect(ev.latency_ms).toBe(-1);
    expect(ev.result_excerpt_redacted).toBe(ORPHAN_RESULT_EXCERPT);
    expect(ev.lane_id).toBe("T-Z");
    expect(ev.command_redacted).toBe("stale");
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Closed enums — schema doc §7 + §8
// ──────────────────────────────────────────────────────────────────────────

describe("log-jsonl / closed enums", () => {
  it("TOOL_CALL_TOOL_VALUES has exactly 17 values", () => {
    expect(TOOL_CALL_TOOL_VALUES.length).toBe(17);
  });

  it("HOOK_EVENT_NAMES has exactly 12 values", () => {
    expect(HOOK_EVENT_NAMES.length).toBe(12);
  });

  it("EVENT_TYPES has exactly 12 values", () => {
    expect(EVENT_TYPES.size).toBe(12);
  });

  it("TOOL_CALL_TOOL_VALUES contains the canonical 17", () => {
    const expected = new Set([
      "Read",
      "Write",
      "Edit",
      "Grep",
      "Glob",
      "Bash",
      "Agent",
      "Skill",
      "AskUserQuestion",
      "TaskCreate",
      "TaskUpdate",
      "TaskList",
      "WebFetch",
      "WebSearch",
      "NotebookEdit",
      "BashOutput",
      "KillShell",
    ]);
    for (const v of TOOL_CALL_TOOL_VALUES) {
      expect(expected.has(v)).toBe(true);
    }
  });

  it("HOOK_EVENT_NAMES contains the canonical 12", () => {
    const expected = new Set([
      "SessionStart",
      "SessionEnd",
      "UserPromptSubmit",
      "PreToolUse",
      "PostToolUse",
      "Notification",
      "Stop",
      "SubagentStop",
      "PreCompact",
      "TaskCreated",
      "TaskCompleted",
      "TeammateIdle",
    ]);
    for (const v of HOOK_EVENT_NAMES) {
      expect(expected.has(v)).toBe(true);
    }
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Lockfile is never deleted (defensive — concurrent rotate + append)
// ──────────────────────────────────────────────────────────────────────────

describe("log-jsonl / lockfile permanence under concurrent ops", () => {
  it("lockfile inode survives a many-rotation cycle", () => {
    initStableLockfile(runDir);
    const ino0 = lockfileInode(runDir);
    for (let i = 0; i < 5; i++) {
      appendEvent(runDir, {
        ts: TS,
        event: "phase_start",
        run_id: RUN_ID,
        phase: "plan",
      });
      rotate(runDir);
    }
    expect(lockfileInode(runDir)).toBe(ino0);
    expect(lockfileSize(runDir)).toBe(0);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Cross-lane mutual exclusion — counter-store + log-jsonl share ONE lock
// ──────────────────────────────────────────────────────────────────────────

describe("log-jsonl / cross-lane shared lock with counter-store", () => {
  it("the counter-store and log-jsonl resolve to the SAME lockfile path", async () => {
    const { counterLockPath } = await import("../src/counter-store.js");
    expect(lockPath(runDir)).toBe(counterLockPath(runDir));
  });

  it("interleaved counter-store + log-jsonl writes serialize cleanly", async () => {
    const { incrementL1, getGlobal } = await import("../src/counter-store.js");
    initStableLockfile(runDir);
    for (let i = 0; i < 10; i++) {
      // Alternate between a JSONL append and a counter increment under
      // the same shared lock. Both should complete without deadlock or
      // file corruption.
      appendEvent(runDir, {
        ts: TS,
        event: "phase_start",
        run_id: RUN_ID,
        phase: "execute",
      });
      incrementL1(runDir, RUN_ID);
    }
    expect(getGlobal(runDir, RUN_ID, "l1_round")).toBe(10);
    const text = readFileSync(liveLogPath(runDir), "utf8");
    expect(text.trim().split("\n").length).toBe(10);
  });
});

// Suppress unused-import lint warnings.
void closeSync;
void openSync;
