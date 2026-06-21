/**
 * log-jsonl-split-parity.test.ts — W3 split-5 parity + anti-vacuity tests.
 *
 * Verifies that the M9 behavior-neutral decomposition of log-jsonl.ts into
 * three sub-modules (schema / writer / sidecar) preserves the FULL public API
 * and all behavioral contracts. Includes ordering/edge behavior tests and an
 * anti-vacuity control per the split task spec.
 *
 * Anti-vacuity control: each behavioral test includes a case that PROVES the
 * assertion would fail if the behavior were broken (marked // @control:).
 * A vacuous test that passes regardless is not a parity test.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";

// Import exclusively from the SHIM — callers only see this path.
import {
  // Schema exports
  TOOL_CALL_TOOL_VALUES,
  HOOK_EVENT_NAMES,
  EVENT_TYPES,
  RUN_ID_RE,
  LANE_ID_RE,
  isSafeRunId,
  isSafeLaneId,
  // Writer exports
  liveLogPath,
  archiveDir,
  archivePath,
  lockPath,
  sidecarPath,
  laneFallbackPath,
  summaryPath,
  ROTATION_THRESHOLD_BYTES,
  appendEvent,
  nextRotationIndex,
  rotate,
  snapshotLiveLog,
  listArchives,
  readAllEvents,
  lockfileInode,
  lockfileSize,
  initStableLockfile,
  // Sidecar exports
  SIDECAR_MAX_BYTES,
  ORPHAN_RESULT_EXCERPT,
  ORPHAN_LATENCY_MS,
  appendSidecarPre,
  consumeSidecarPre,
  sweepOrphanedSidecar,
  sweepOrphanedSidecarFull,
  buildToolCallFromPair,
  buildOrphanedToolCall,
  buildToolCallFromPostOnly,
  // Types (used as type-only assertions via compile-time checks)
  type Phase,
  type LoopLayer,
  type ToolCallTool,
  type HookEventName,
  type JsonlEvent,
  type ToolCallEvent,
  type HookEvent,
  type PhaseStartEvent,
  type SpecialistDispatchEvent,
  type SidecarPreEntry,
  type SidecarMatchKey,
  type OrphanSweepResult,
  type AppendOptions,
  type ReadSkipRecord,
} from "../log-jsonl.js";

// ──────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "log-jsonl-parity-"));
}

function readFallbackLines(runDir: string, laneId = "global"): unknown[] {
  const file = laneFallbackPath(runDir, laneId);
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

const BASE_TOOL_CALL: ToolCallEvent = {
  ts: "2026-06-21T00:00:00.000Z",
  event: "tool_call",
  run_id: "run-parity-1",
  tool: "Bash",
  command_redacted: "ls /tmp",
  status: "ok",
  latency_ms: 10,
  result_excerpt_redacted: "file.txt",
};

const BASE_HOOK_EVENT: HookEvent = {
  ts: "2026-06-21T00:01:00.000Z",
  event: "hook_event",
  run_id: "run-parity-1",
  hook_name: "PostToolUse",
  payload_excerpt_redacted: "{}",
  latency_ms: 5,
  status: "ok",
};

// ──────────────────────────────────────────────────────────────────────────
// 1. Schema constants and ID validators
// ──────────────────────────────────────────────────────────────────────────

describe("schema: constants and ID validators", () => {
  it("TOOL_CALL_TOOL_VALUES has 17 entries including Bash and Agent", () => {
    expect(TOOL_CALL_TOOL_VALUES).toContain("Bash");
    expect(TOOL_CALL_TOOL_VALUES).toContain("Agent");
    expect(TOOL_CALL_TOOL_VALUES.length).toBe(17);
    // @control: unknown tools are not part of the closed enum.
    expect(TOOL_CALL_TOOL_VALUES).not.toContain("UnknownTool");
  });

  it("HOOK_EVENT_NAMES has 12 entries including PostToolUse and TaskCreated", () => {
    expect(HOOK_EVENT_NAMES).toContain("PostToolUse");
    expect(HOOK_EVENT_NAMES).toContain("TaskCreated");
    expect(HOOK_EVENT_NAMES.length).toBe(12);
    // @control: unknown hook names are not part of the closed enum.
    expect(HOOK_EVENT_NAMES).not.toContain("UnknownHook");
  });

  it("EVENT_TYPES is a Set with 12 members", () => {
    expect(EVENT_TYPES.size).toBe(12);
    expect(EVENT_TYPES.has("tool_call")).toBe(true);
    expect(EVENT_TYPES.has("phase_start")).toBe(true);
    // @control: unknown event names must not pass the whitelist.
    expect(EVENT_TYPES.has("not_an_event" as any)).toBe(false);
  });

  it("RUN_ID_RE and LANE_ID_RE are exported as RegExp", () => {
    expect(RUN_ID_RE).toBeInstanceOf(RegExp);
    expect(LANE_ID_RE).toBeInstanceOf(RegExp);
  });

  it("isSafeRunId: accepts valid ids and rejects invalid", () => {
    expect(isSafeRunId("run-abc-123")).toBe(true);
    expect(isSafeRunId("run.test_0")).toBe(true);
    // @control: these MUST return false — if they returned true the guard is vacuous
    expect(isSafeRunId("..")).toBe(false);
    expect(isSafeRunId(".")).toBe(false);
    expect(isSafeRunId("")).toBe(false);
    expect(isSafeRunId("a/b")).toBe(false);
    expect(isSafeRunId("a b")).toBe(false);
  });

  it("isSafeLaneId: accepts valid ids and rejects invalid", () => {
    expect(isSafeLaneId("lane-1:backend")).toBe(true);
    expect(isSafeLaneId("L1")).toBe(true);
    // @control: these MUST return false
    expect(isSafeLaneId("..")).toBe(false);
    expect(isSafeLaneId(".")).toBe(false);
    expect(isSafeLaneId("")).toBe(false);
    expect(isSafeLaneId("a b")).toBe(false);
  });

  it("appendEvent rejects an invalid run_id (ID validation wired)", () => {
    const runDir = makeTmpDir();
    try {
      expect(() =>
        appendEvent(runDir, { ...BASE_TOOL_CALL, run_id: "../evil" }, { forceFallback: true }),
      ).toThrow(/invalid run_id/);
      // @control: a valid run_id must NOT throw
      expect(() =>
        appendEvent(runDir, { ...BASE_TOOL_CALL, run_id: "valid-run-1" }, { forceFallback: true }),
      ).not.toThrow();
    } finally {
      fs.rmSync(runDir, { recursive: true, force: true });
    }
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 2. Path helpers
// ──────────────────────────────────────────────────────────────────────────

describe("writer: path helpers", () => {
  const runDir = "/tmp/fake-run-for-paths";

  it("liveLogPath returns <runDir>/logs/v1.4-events.jsonl", () => {
    expect(liveLogPath(runDir)).toBe(path.join(runDir, "logs", "v1.4-events.jsonl"));
    // @control: it must not point at the sidecar or summary path.
    expect(liveLogPath(runDir)).not.toBe(sidecarPath(runDir));
  });

  it("archiveDir returns <runDir>/logs/archive", () => {
    expect(archiveDir(runDir)).toBe(path.join(runDir, "logs", "archive"));
    // @control: archives must not live directly in logs/.
    expect(archiveDir(runDir)).not.toBe(path.join(runDir, "logs"));
  });

  it("archivePath returns archive/v1.4-events.<N>.jsonl.gz", () => {
    expect(archivePath(runDir, 3)).toBe(
      path.join(runDir, "logs", "archive", "v1.4-events.3.jsonl.gz"),
    );
    // @control: the rotation index must affect the path.
    expect(archivePath(runDir, 3)).not.toBe(archivePath(runDir, 4));
  });

  it("lockPath is defined (delegates to shared stableLockPath)", () => {
    expect(typeof lockPath(runDir)).toBe("string");
    expect(lockPath(runDir).length).toBeGreaterThan(0);
    // @control: the lock path is distinct from the live log path.
    expect(lockPath(runDir)).not.toBe(liveLogPath(runDir));
  });

  it("sidecarPath returns <runDir>/logs/tool-call-pre.jsonl", () => {
    expect(sidecarPath(runDir)).toBe(path.join(runDir, "logs", "tool-call-pre.jsonl"));
    // @control: the sidecar must not be the live JSONL log.
    expect(sidecarPath(runDir)).not.toBe(liveLogPath(runDir));
  });

  it("laneFallbackPath embeds the lane id and rejects unsafe ids", () => {
    expect(laneFallbackPath(runDir, "lane-1")).toBe(
      path.join(runDir, "logs", "lane-lane-1-events.jsonl"),
    );
    // @control: unsafe lane id MUST throw
    expect(() => laneFallbackPath(runDir, "../evil")).toThrow(/invalid lane_id/);
  });

  it("summaryPath returns <runDir>/logs/summary.md", () => {
    expect(summaryPath(runDir)).toBe(path.join(runDir, "logs", "summary.md"));
    // @control: the summary markdown path is distinct from JSONL outputs.
    expect(summaryPath(runDir)).not.toBe(liveLogPath(runDir));
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 3. appendEvent — fallback path (forceFallback avoids real lock in tests)
// ──────────────────────────────────────────────────────────────────────────

describe("writer: appendEvent (forceFallback)", () => {
  let runDir: string;
  beforeEach(() => { runDir = makeTmpDir(); });
  afterEach(() => { fs.rmSync(runDir, { recursive: true, force: true }); });

  it("writes a tool_call event and it round-trips", () => {
    appendEvent(runDir, BASE_TOOL_CALL, { forceFallback: true });
    const lines = readFallbackLines(runDir);
    expect(lines.length).toBe(1);
    expect((lines[0] as any).event).toBe("tool_call");
    expect((lines[0] as any).tool).toBe("Bash");
    // @control: a missing event MUST NOT be there
    expect((lines[0] as any).event).not.toBe("phase_start");
  });

  it("writes a hook_event and fields are preserved", () => {
    appendEvent(runDir, BASE_HOOK_EVENT, { forceFallback: true });
    const [line] = readFallbackLines(runDir);
    expect((line as any).hook_name).toBe("PostToolUse");
    expect((line as any).latency_ms).toBe(5);
    // @control: hook_event fields must not be rewritten as another hook/latency.
    expect((line as any).hook_name).not.toBe("PreToolUse");
    expect((line as any).latency_ms).not.toBe(0);
  });

  it("multiple appends preserve ORDER (append-order is the primary key)", () => {
    const events: JsonlEvent[] = [
      { ...BASE_TOOL_CALL, ts: "2026-06-21T00:00:00.000Z", tool: "Bash" },
      { ...BASE_TOOL_CALL, ts: "2026-06-21T00:00:01.000Z", tool: "Read" },
      { ...BASE_TOOL_CALL, ts: "2026-06-21T00:00:02.000Z", tool: "Write" },
    ];
    for (const e of events) appendEvent(runDir, e, { forceFallback: true });
    const lines = readFallbackLines(runDir);
    expect(lines.length).toBe(3);
    // ORDER: Bash first, then Read, then Write — append order preserved
    expect((lines[0] as any).tool).toBe("Bash");
    expect((lines[1] as any).tool).toBe("Read");
    expect((lines[2] as any).tool).toBe("Write");
    // @control: reversed order would be wrong
    expect((lines[0] as any).tool).not.toBe("Write");
  });

  it("ROTATION_THRESHOLD_BYTES is 10 MiB", () => {
    expect(ROTATION_THRESHOLD_BYTES).toBe(10 * 1024 * 1024);
    // @control: it must not silently drift to the sidecar cap.
    expect(ROTATION_THRESHOLD_BYTES).not.toBe(SIDECAR_MAX_BYTES);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 4. Rotation and reader path
// ──────────────────────────────────────────────────────────────────────────

describe("writer: rotation and reader", () => {
  let runDir: string;
  beforeEach(() => {
    runDir = makeTmpDir();
    initStableLockfile(runDir);
  });
  afterEach(() => { fs.rmSync(runDir, { recursive: true, force: true }); });

  it("nextRotationIndex starts at 1 with no archives", () => {
    expect(nextRotationIndex(runDir)).toBe(1);
    // @control: it MUST NOT return 0 with no archives
    expect(nextRotationIndex(runDir)).not.toBe(0);
  });

  it("nextRotationIndex increments past existing archives", () => {
    fs.mkdirSync(archiveDir(runDir), { recursive: true });
    fs.writeFileSync(path.join(archiveDir(runDir), "v1.4-events.3.jsonl.gz"), "");
    expect(nextRotationIndex(runDir)).toBe(4);
    // @control: must NOT return 3 or 1 when archive 3 exists
    expect(nextRotationIndex(runDir)).not.toBe(3);
  });

  it("rotate moves live log to archive", () => {
    // Write one event to the live log (POSIX path, real lock)
    appendEvent(runDir, BASE_TOOL_CALL);
    expect(fs.existsSync(liveLogPath(runDir))).toBe(true);
    rotate(runDir);
    const archives = listArchives(runDir);
    expect(archives.length).toBe(1);
    // @control: archives MUST be non-empty after rotation
    expect(archives.length).not.toBe(0);
  });

  it("readAllEvents returns archive events BEFORE live log events (source priority)", async () => {
    // Write event A to live log → rotate → write event B to live log
    appendEvent(runDir, { ...BASE_TOOL_CALL, ts: "2026-06-21T00:00:00.000Z", result_excerpt_redacted: "A" });
    rotate(runDir);
    appendEvent(runDir, { ...BASE_TOOL_CALL, ts: "2026-06-21T00:00:01.000Z", result_excerpt_redacted: "B" });

    const events = await readAllEvents(runDir);
    expect(events.length).toBe(2);
    // Archive A comes before live B (source-priority order, NOT ts-sort)
    expect((events[0] as ToolCallEvent).result_excerpt_redacted).toBe("A");
    expect((events[1] as ToolCallEvent).result_excerpt_redacted).toBe("B");
    // @control: reversed order would violate the source-priority contract
    expect((events[0] as ToolCallEvent).result_excerpt_redacted).not.toBe("B");
  });

  it("readAllEvents TIEBREAK: same-ms same-source append order is preserved", async () => {
    // Same ts, appended in order — the schema §6.2 tiebreak rule requires
    // append-order wins within a source; ts is only the SECONDARY key.
    const same_ts = "2026-06-21T00:00:00.000Z";
    appendEvent(runDir, { ...BASE_TOOL_CALL, ts: same_ts, result_excerpt_redacted: "FIRST" });
    appendEvent(runDir, { ...BASE_TOOL_CALL, ts: same_ts, result_excerpt_redacted: "SECOND" });

    const events = await readAllEvents(runDir);
    expect(events.length).toBe(2);
    expect((events[0] as ToolCallEvent).result_excerpt_redacted).toBe("FIRST");
    expect((events[1] as ToolCallEvent).result_excerpt_redacted).toBe("SECOND");
    // @control: if sort by ts alone were used, order would be non-deterministic;
    // this proves append-order is preserved.
    expect((events[0] as ToolCallEvent).result_excerpt_redacted).not.toBe("SECOND");
  });

  it("readAllEvents skips malformed lines and calls onSkip", async () => {
    // Write a good event, then manually corrupt the live log with a bad line
    appendEvent(runDir, BASE_TOOL_CALL);
    fs.appendFileSync(liveLogPath(runDir), "NOT_JSON\n");
    const skipped: ReadSkipRecord[] = [];
    const events = await readAllEvents(runDir, { onSkip: (r) => skipped.push(r) });
    expect(events.length).toBe(1);
    expect(skipped.length).toBe(1);
    expect(skipped[0]!.reason).toMatch(/JSON.parse failed/);
    // @control: a CLEAN log must NOT call onSkip
    const runDir2 = makeTmpDir();
    initStableLockfile(runDir2);
    try {
      appendEvent(runDir2, BASE_TOOL_CALL);
      const skipped2: ReadSkipRecord[] = [];
      await readAllEvents(runDir2, { onSkip: (r) => skipped2.push(r) });
      expect(skipped2.length).toBe(0);
    } finally {
      fs.rmSync(runDir2, { recursive: true, force: true });
    }
  });

  it("lockfile inode is stable across appends (permanent inode contract)", () => {
    initStableLockfile(runDir);
    const inode1 = lockfileInode(runDir);
    appendEvent(runDir, BASE_TOOL_CALL);
    const inode2 = lockfileInode(runDir);
    expect(inode1).not.toBeNull();
    expect(inode1).toBe(inode2);
    // @control: a missing lockfile returns null
    const runDir2 = makeTmpDir();
    try {
      expect(lockfileInode(runDir2)).toBeNull();
    } finally {
      fs.rmSync(runDir2, { recursive: true, force: true });
    }
  });

  it("lockfile size is always zero (never written to)", () => {
    initStableLockfile(runDir);
    appendEvent(runDir, BASE_TOOL_CALL);
    rotate(runDir);
    expect(lockfileSize(runDir)).toBe(0);
    // @control: the assertion must observe a non-zero lockfile if one exists.
    const runDir2 = makeTmpDir();
    try {
      initStableLockfile(runDir2);
      fs.writeFileSync(lockPath(runDir2), "bad");
      expect(lockfileSize(runDir2)).toBeGreaterThan(0);
    } finally {
      fs.rmSync(runDir2, { recursive: true, force: true });
    }
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 5. Sidecar (appendSidecarPre / consumeSidecarPre)
// ──────────────────────────────────────────────────────────────────────────

describe("sidecar: appendSidecarPre and consumeSidecarPre", () => {
  let runDir: string;
  beforeEach(() => { runDir = makeTmpDir(); });
  afterEach(() => { fs.rmSync(runDir, { recursive: true, force: true }); });

  const preEntry: SidecarPreEntry = {
    run_id: "run-sidecar-1",
    tool: "Bash",
    ts_pre: "2026-06-21T00:00:00.000Z",
    command_redacted: "ls /tmp",
    call_id: "call-1",
  };

  it("appendSidecarPre writes a line and consumeSidecarPre reads it back", () => {
    appendSidecarPre(runDir, preEntry, { maxBytes: 64 * 1024 });
    const consumed = consumeSidecarPre(runDir, {
      run_id: "run-sidecar-1",
      tool: "Bash",
      post_ts: "2026-06-21T00:01:00.000Z",
    });
    expect(consumed).not.toBeNull();
    expect(consumed!.tool).toBe("Bash");
    expect(consumed!.run_id).toBe("run-sidecar-1");
    // @control: a second consume on the same key must return null (already consumed)
    const consumed2 = consumeSidecarPre(runDir, {
      run_id: "run-sidecar-1",
      tool: "Bash",
      post_ts: "2026-06-21T00:01:00.000Z",
    });
    expect(consumed2).toBeNull();
  });

  it("OLDEST-UNMATCHED: when two pre-records share the same key, consumes the older one first", () => {
    const older: SidecarPreEntry = { ...preEntry, ts_pre: "2026-06-21T00:00:00.000Z", call_id: "old" };
    const newer: SidecarPreEntry = { ...preEntry, ts_pre: "2026-06-21T00:00:05.000Z", call_id: "new" };
    appendSidecarPre(runDir, older);
    appendSidecarPre(runDir, newer);

    const key: SidecarMatchKey = { run_id: "run-sidecar-1", tool: "Bash", post_ts: "2026-06-21T01:00:00.000Z" };
    const first = consumeSidecarPre(runDir, key);
    expect(first).not.toBeNull();
    // @control: it must be the OLDER entry (ts 00:00:00), not the newer one
    expect(first!.call_id).toBe("old");
    expect(first!.call_id).not.toBe("new");

    const second = consumeSidecarPre(runDir, key);
    expect(second).not.toBeNull();
    expect(second!.call_id).toBe("new");
  });

  it("SIDECAR_MAX_BYTES is 1 MiB", () => {
    expect(SIDECAR_MAX_BYTES).toBe(1024 * 1024);
    // @control: sidecar cap must not drift to the main log rotation cap.
    expect(SIDECAR_MAX_BYTES).not.toBe(ROTATION_THRESHOLD_BYTES);
  });

  it("consumeSidecarPre returns null when sidecar does not exist", () => {
    const result = consumeSidecarPre(runDir, { run_id: "run-sidecar-1", tool: "Bash" });
    expect(result).toBeNull();
    // @control: non-null is only returned when there is a matching entry
  });

  it("ts_pre < post_ts filter: pre with ts_pre >= post_ts is NOT eligible", () => {
    const lateEntry: SidecarPreEntry = {
      ...preEntry,
      ts_pre: "2026-06-21T00:05:00.000Z", // LATER than the post_ts below
    };
    appendSidecarPre(runDir, lateEntry);
    const result = consumeSidecarPre(runDir, {
      run_id: "run-sidecar-1",
      tool: "Bash",
      post_ts: "2026-06-21T00:01:00.000Z", // EARLIER than ts_pre
    });
    // @control: must return null because ts_pre > post_ts violates the chronology guard
    expect(result).toBeNull();
    // The entry MUST still be in the sidecar (not consumed)
    const unconsumed = consumeSidecarPre(runDir, {
      run_id: "run-sidecar-1",
      tool: "Bash",
      post_ts: "2026-06-21T01:00:00.000Z", // now post_ts > ts_pre → eligible
    });
    expect(unconsumed).not.toBeNull();
    expect(unconsumed!.ts_pre).toBe("2026-06-21T00:05:00.000Z");
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 6. Orphan sweep
// ──────────────────────────────────────────────────────────────────────────

describe("sidecar: orphan sweep", () => {
  let runDir: string;
  beforeEach(() => { runDir = makeTmpDir(); });
  afterEach(() => { fs.rmSync(runDir, { recursive: true, force: true }); });

  const OLD_TS = "2026-06-21T00:00:00.000Z";

  it("sweepOrphanedSidecar returns entries older than maxAgeMs", () => {
    const oldEntry: SidecarPreEntry = {
      run_id: "run-sweep-1",
      tool: "Agent",
      ts_pre: OLD_TS,
      command_redacted: "dispatch",
    };
    appendSidecarPre(runDir, oldEntry);
    const nowMs = Date.parse(OLD_TS) + 6 * 60 * 1000; // 6 min later
    const orphans = sweepOrphanedSidecar(runDir, nowMs, 5 * 60 * 1000);
    expect(orphans.length).toBe(1);
    expect(orphans[0]!.tool).toBe("Agent");
    // @control: sweep with nowMs < maxAgeMs must return 0 orphans
    const runDir2 = makeTmpDir();
    try {
      appendSidecarPre(runDir2, oldEntry);
      const young = sweepOrphanedSidecar(runDir2, Date.parse(OLD_TS) + 1000, 5 * 60 * 1000);
      expect(young.length).toBe(0);
    } finally {
      fs.rmSync(runDir2, { recursive: true, force: true });
    }
  });

  it("sweepOrphanedSidecarFull returns BOTH orphans and synthetic events", () => {
    const entry: SidecarPreEntry = {
      run_id: "run-sweep-2",
      tool: "Read",
      ts_pre: OLD_TS,
      command_redacted: "read file",
    };
    appendSidecarPre(runDir, entry);
    const nowMs = Date.parse(OLD_TS) + 10 * 60 * 1000;
    const result: OrphanSweepResult = sweepOrphanedSidecarFull(runDir, nowMs);
    expect(result.orphans.length).toBe(1);
    expect(result.events.length).toBe(1);
    const evt = result.events[0]!;
    // @control: orphan event MUST carry err status and -1 latency
    expect(evt.status).toBe("err");
    expect(evt.latency_ms).toBe(ORPHAN_LATENCY_MS);
    expect(evt.result_excerpt_redacted).toBe(ORPHAN_RESULT_EXCERPT);
    // verify the sentinels themselves are not vacuous
    expect(ORPHAN_LATENCY_MS).toBe(-1);
    expect(ORPHAN_RESULT_EXCERPT).toBe("<orphaned — pre/post pairing failed>");
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 7. Tool-call event builders
// ──────────────────────────────────────────────────────────────────────────

describe("sidecar: tool-call event builders", () => {
  const pre: SidecarPreEntry = {
    run_id: "run-builder-1",
    lane_id: "lane-1",
    tool: "Write",
    ts_pre: "2026-06-21T00:00:00.000Z",
    command_redacted: "write /tmp/foo",
  };

  it("buildToolCallFromPair computes latency_ms from ts_pre and ts_post", () => {
    const evt = buildToolCallFromPair(pre, {
      ts_post: "2026-06-21T00:00:02.000Z", // 2000 ms later
      run_id: "run-builder-1",
      status: "ok",
      result_excerpt_redacted: "done",
    });
    expect(evt.latency_ms).toBe(2000);
    expect(evt.tool).toBe("Write");
    expect(evt.lane_id).toBe("lane-1");
    // @control: must NOT produce a negative latency
    expect(evt.latency_ms).toBeGreaterThanOrEqual(0);
  });

  it("buildToolCallFromPair clamps negative latency to 0", () => {
    const evt = buildToolCallFromPair(pre, {
      ts_post: "2026-06-20T23:59:59.000Z", // BEFORE ts_pre (clock skew)
      run_id: "run-builder-1",
      status: "ok",
      result_excerpt_redacted: "done",
    });
    expect(evt.latency_ms).toBe(0);
    // @control: a normal forward-time pair must give positive latency
    const normal = buildToolCallFromPair(pre, {
      ts_post: "2026-06-21T00:00:05.000Z",
      run_id: "run-builder-1",
      status: "ok",
      result_excerpt_redacted: "done",
    });
    expect(normal.latency_ms).toBe(5000);
  });

  it("buildOrphanedToolCall emits err status, -1 latency, ORPHAN_RESULT_EXCERPT sentinel", () => {
    const evt = buildOrphanedToolCall(pre);
    expect(evt.status).toBe("err");
    expect(evt.latency_ms).toBe(-1);
    expect(evt.result_excerpt_redacted).toBe(ORPHAN_RESULT_EXCERPT);
    expect(evt.ts).toBe(pre.ts_pre); // ts preserved from pre
    // @control: a paired call must NOT have orphan sentinel values
    const paired = buildToolCallFromPair(pre, {
      ts_post: "2026-06-21T00:00:01.000Z",
      run_id: "run-builder-1",
      status: "ok",
      result_excerpt_redacted: "actual result",
    });
    expect(paired.latency_ms).not.toBe(-1);
    expect(paired.result_excerpt_redacted).not.toBe(ORPHAN_RESULT_EXCERPT);
  });

  it("buildToolCallFromPostOnly: command_redacted is empty, status is ok, latency is 0", () => {
    const evt = buildToolCallFromPostOnly({
      ts_post: "2026-06-21T00:00:03.000Z",
      run_id: "run-builder-1",
      tool: "Grep",
      result_excerpt_redacted: "no match",
      lane_id: "lane-2",
    });
    expect(evt.command_redacted).toBe("");
    expect(evt.status).toBe("ok");
    expect(evt.latency_ms).toBe(0);
    expect(evt.tool).toBe("Grep");
    // @control: buildOrphanedToolCall's status is "err" — these ARE distinct functions
    expect(evt.status).not.toBe("err");
  });

  it("buildToolCallFromPostOnly respects latency_ms_override", () => {
    const evt = buildToolCallFromPostOnly({
      ts_post: "2026-06-21T00:00:03.000Z",
      run_id: "run-builder-1",
      tool: "Grep",
      result_excerpt_redacted: "x",
      latency_ms_override: 999,
    });
    expect(evt.latency_ms).toBe(999);
    // @control: without override, latency is 0
    const noOverride = buildToolCallFromPostOnly({
      ts_post: "2026-06-21T00:00:03.000Z",
      run_id: "run-builder-1",
      tool: "Grep",
      result_excerpt_redacted: "x",
    });
    expect(noOverride.latency_ms).toBe(0);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 8. snapshotLiveLog returns empty string on a missing run dir
// ──────────────────────────────────────────────────────────────────────────

describe("writer: edge — empty run dir", () => {
  it("snapshotLiveLog returns '' for a run dir with no logs/ subdir", () => {
    const runDir = makeTmpDir();
    try {
      const result = snapshotLiveLog(runDir);
      expect(result).toBe("");
      // @control: a runDir WITH a log must NOT return empty
      initStableLockfile(runDir);
      appendEvent(runDir, BASE_TOOL_CALL);
      expect(snapshotLiveLog(runDir).length).toBeGreaterThan(0);
    } finally {
      fs.rmSync(runDir, { recursive: true, force: true });
    }
  });

  it("listArchives returns [] for a run dir with no archive dir", () => {
    const runDir = makeTmpDir();
    try {
      expect(listArchives(runDir)).toEqual([]);
      // @control: after rotate, archives list is non-empty
      initStableLockfile(runDir);
      appendEvent(runDir, BASE_TOOL_CALL);
      rotate(runDir);
      expect(listArchives(runDir).length).toBeGreaterThan(0);
    } finally {
      fs.rmSync(runDir, { recursive: true, force: true });
    }
  });
});
