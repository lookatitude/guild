/**
 * __tests__/heartbeat-write-side.test.ts
 *
 * Focused tests for scripts/lib/heartbeat-write-side.ts — the agent-side
 * heartbeat emission module (ARCH-9 write side, scripts tier).
 *
 * Coverage strategy:
 *  - Happy path: writeHeartbeat writes a parseable marker; readHeartbeatMarker
 *    reads it back with all optional fields intact.
 *  - Key contract guarantees:
 *      (a) Atomic write — no partial / temp file survives a successful write.
 *      (b) isStale: fresh/stale boundary, clamped negative age, NaN timestamp.
 *      (c) isSafeLaneId: allowlist enforcement.
 *      (d) readHeartbeatMarker: returns null on absent/corrupt files (never
 *          throws).
 *      (e) Caller controls timestamp — no Date.now() inside lib functions.
 *  - Edge / malformed cases:
 *      unsafe laneId (path traversal) → throws with a clear message.
 *      corrupt JSON on disk → readHeartbeatMarker returns null.
 *      missing timestamp field → readHeartbeatMarker returns null.
 *      isStale with future-dated marker (negative age clamped → fresh).
 *
 * Filesystem: real tempdir for fs-touching tests; pure functions exercised
 * without any fs I/O.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import {
  DEFAULT_HEARTBEAT_TTL_MS,
  HeartbeatMarker,
  WriteHeartbeatOpts,
  heartbeatPath,
  isSafeLaneId,
  isStale,
  readHeartbeatMarker,
  writeHeartbeat,
} from "../lib/heartbeat-write-side";

// ── Fixtures / helpers ───────────────────────────────────────────────────────

/** Fixed base time for deterministic tests. */
const BASE_MS = Date.parse("2026-06-13T10:00:00.000Z");

function isoAgo(msAgo: number): string {
  return new Date(BASE_MS - msAgo).toISOString();
}

function makeTempRunDir(): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "guild-hbws-test-"));
  const runDir = path.join(tmp, ".guild", "runs", "run-hbws-test-001");
  fs.mkdirSync(runDir, { recursive: true });
  return runDir;
}

// Clean up all temp dirs created during a test suite
const tempDirs: string[] = [];
afterAll(() => {
  for (const d of tempDirs) {
    try {
      fs.rmSync(d, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
});

function makeRunDir(): string {
  const runDir = makeTempRunDir();
  // Record the grandparent so we clean up the root temp dir
  tempDirs.push(path.resolve(runDir, "../../../.."));
  return runDir;
}

// ── isSafeLaneId ─────────────────────────────────────────────────────────────

describe("isSafeLaneId", () => {
  it("accepts typical lane/specialist ids", () => {
    expect(isSafeLaneId("tooling-engineer")).toBe(true);
    expect(isSafeLaneId("P1-enforcement")).toBe(true);
    expect(isSafeLaneId("lane.123")).toBe(true);
    expect(isSafeLaneId("a")).toBe(true);
  });

  it("rejects path-traversal sequences", () => {
    expect(isSafeLaneId("..")).toBe(false);
    expect(isSafeLaneId("../etc")).toBe(false);
    expect(isSafeLaneId(".")).toBe(false);
  });

  it("rejects path separators", () => {
    expect(isSafeLaneId("foo/bar")).toBe(false);
    expect(isSafeLaneId("foo\\bar")).toBe(false);
  });

  it("rejects ids starting with a non-alnum character", () => {
    expect(isSafeLaneId("-leading-dash")).toBe(false);
    expect(isSafeLaneId(".leading-dot")).toBe(false);
  });

  it("rejects empty strings", () => {
    expect(isSafeLaneId("")).toBe(false);
  });
});

// ── heartbeatPath ─────────────────────────────────────────────────────────────

describe("heartbeatPath", () => {
  it("returns <runDir>/in-progress/<laneId>.json", () => {
    expect(heartbeatPath("/guild/runs/run-abc", "tooling-engineer")).toBe(
      path.join("/guild/runs/run-abc", "in-progress", "tooling-engineer.json")
    );
  });
});

// ── isStale ───────────────────────────────────────────────────────────────────

describe("isStale", () => {
  const TTL = 600_000; // 10 min

  it("returns false when the marker is fresher than the TTL", () => {
    const marker: HeartbeatMarker = { timestamp: isoAgo(TTL - 1) };
    expect(isStale(marker, BASE_MS, TTL)).toBe(false);
  });

  it("returns true at exactly the TTL boundary (age === ttl)", () => {
    const marker: HeartbeatMarker = { timestamp: isoAgo(TTL) };
    expect(isStale(marker, BASE_MS, TTL)).toBe(true);
  });

  it("returns true when the marker is older than the TTL", () => {
    const marker: HeartbeatMarker = { timestamp: isoAgo(TTL + 1) };
    expect(isStale(marker, BASE_MS, TTL)).toBe(true);
  });

  it("clamps negative age to 0 — a future-dated marker is treated as fresh", () => {
    // Marker is 5 seconds in the future relative to nowMs
    const futureTs = new Date(BASE_MS + 5_000).toISOString();
    const marker: HeartbeatMarker = { timestamp: futureTs };
    expect(isStale(marker, BASE_MS, TTL)).toBe(false);
  });

  it("treats an unparseable timestamp as stale", () => {
    const marker: HeartbeatMarker = { timestamp: "not-a-date" };
    expect(isStale(marker, BASE_MS, TTL)).toBe(true);
  });

  it("uses DEFAULT_HEARTBEAT_TTL_MS when ttlMs is omitted", () => {
    // Just below the default (10 min) → fresh
    const fresh: HeartbeatMarker = { timestamp: isoAgo(DEFAULT_HEARTBEAT_TTL_MS - 1) };
    expect(isStale(fresh, BASE_MS)).toBe(false);
    // At the default → stale
    const stale: HeartbeatMarker = { timestamp: isoAgo(DEFAULT_HEARTBEAT_TTL_MS) };
    expect(isStale(stale, BASE_MS)).toBe(true);
  });
});

// ── writeHeartbeat — happy path ───────────────────────────────────────────────

describe("writeHeartbeat (happy path)", () => {
  it("writes the marker and returns the final path", () => {
    const runDir = makeRunDir();
    const ts = isoAgo(0);
    const result = writeHeartbeat(runDir, "tooling-engineer", ts);
    expect(result.path).toBe(heartbeatPath(runDir, "tooling-engineer"));
    expect(fs.existsSync(result.path)).toBe(true);
  });

  it("round-trips all optional fields through JSON", () => {
    const runDir = makeRunDir();
    const ts = isoAgo(1_000);
    const opts: WriteHeartbeatOpts = {
      step: "implementing",
      pct_complete: 42,
      last_action: "Edit",
    };
    const { path: writtenPath } = writeHeartbeat(runDir, "docs-writer", ts, opts);
    const raw = JSON.parse(fs.readFileSync(writtenPath, "utf8")) as HeartbeatMarker;
    expect(raw.timestamp).toBe(ts);
    expect(raw.step).toBe("implementing");
    expect(raw.pct_complete).toBe(42);
    expect(raw.last_action).toBe("Edit");
  });

  it("written marker is parseable by readHeartbeatMarker", () => {
    const runDir = makeRunDir();
    const ts = isoAgo(30_000);
    writeHeartbeat(runDir, "hook-engineer", ts, { step: "testing", last_action: "Bash" });
    const marker = readHeartbeatMarker(runDir, "hook-engineer");
    expect(marker).not.toBeNull();
    expect(marker!.timestamp).toBe(ts);
    expect(marker!.step).toBe("testing");
    expect(marker!.last_action).toBe("Bash");
  });

  it("overwrites an existing marker (idempotent update)", () => {
    const runDir = makeRunDir();
    writeHeartbeat(runDir, "lane1", isoAgo(60_000), { step: "old" });
    const newTs = isoAgo(1_000);
    writeHeartbeat(runDir, "lane1", newTs, { step: "new" });
    const marker = readHeartbeatMarker(runDir, "lane1");
    expect(marker!.timestamp).toBe(newTs);
    expect(marker!.step).toBe("new");
  });

  it("creates the in-progress directory when it does not yet exist", () => {
    const runDir = makeRunDir();
    const inProgress = path.join(runDir, "in-progress");
    expect(fs.existsSync(inProgress)).toBe(false);
    writeHeartbeat(runDir, "lane-new", isoAgo(0));
    expect(fs.existsSync(inProgress)).toBe(true);
  });
});

// ── writeHeartbeat — atomicity contract ──────────────────────────────────────

describe("writeHeartbeat (atomicity)", () => {
  it("leaves no temp sibling after a successful write", () => {
    const runDir = makeRunDir();
    writeHeartbeat(runDir, "lane-atomic", isoAgo(0));
    const inProgress = path.join(runDir, "in-progress");
    const entries = fs.readdirSync(inProgress);
    const temps = entries.filter((e) => e.includes(".tmp-"));
    expect(temps).toHaveLength(0);
    expect(entries).toEqual(["lane-atomic.json"]);
  });
});

// ── writeHeartbeat — path-traversal guard ────────────────────────────────────

describe("writeHeartbeat (path-traversal guard)", () => {
  it("throws on an unsafe laneId containing a path separator", () => {
    const runDir = makeRunDir();
    expect(() => writeHeartbeat(runDir, "evil/path", isoAgo(0))).toThrow(
      /unsafe laneId/
    );
  });

  it("throws on a '..' laneId", () => {
    const runDir = makeRunDir();
    expect(() => writeHeartbeat(runDir, "..", isoAgo(0))).toThrow(/unsafe laneId/);
  });

  it("throws on a laneId starting with a dash", () => {
    const runDir = makeRunDir();
    expect(() => writeHeartbeat(runDir, "-bad", isoAgo(0))).toThrow(/unsafe laneId/);
  });
});

// ── readHeartbeatMarker — defensive reads ────────────────────────────────────

describe("readHeartbeatMarker", () => {
  it("returns null when the file does not exist (never throws)", () => {
    const runDir = makeRunDir();
    const result = readHeartbeatMarker(runDir, "nonexistent-lane");
    expect(result).toBeNull();
  });

  it("returns null when the file contains malformed JSON", () => {
    const runDir = makeRunDir();
    const inProgress = path.join(runDir, "in-progress");
    fs.mkdirSync(inProgress, { recursive: true });
    fs.writeFileSync(path.join(inProgress, "bad-lane.json"), "{ not valid json {{", "utf8");
    expect(readHeartbeatMarker(runDir, "bad-lane")).toBeNull();
  });

  it("returns null when the timestamp field is missing", () => {
    const runDir = makeRunDir();
    const inProgress = path.join(runDir, "in-progress");
    fs.mkdirSync(inProgress, { recursive: true });
    fs.writeFileSync(
      path.join(inProgress, "no-ts.json"),
      JSON.stringify({ step: "something" }),
      "utf8"
    );
    expect(readHeartbeatMarker(runDir, "no-ts")).toBeNull();
  });

  it("returns null when the file contains a non-object JSON value", () => {
    const runDir = makeRunDir();
    const inProgress = path.join(runDir, "in-progress");
    fs.mkdirSync(inProgress, { recursive: true });
    fs.writeFileSync(path.join(inProgress, "array.json"), JSON.stringify([1, 2, 3]), "utf8");
    expect(readHeartbeatMarker(runDir, "array")).toBeNull();
  });

  it("parses a minimal marker (timestamp only)", () => {
    const runDir = makeRunDir();
    const ts = isoAgo(5_000);
    writeHeartbeat(runDir, "minimal", ts);
    const marker = readHeartbeatMarker(runDir, "minimal");
    expect(marker).not.toBeNull();
    expect(marker!.timestamp).toBe(ts);
    expect(marker!.step).toBeUndefined();
    expect(marker!.pct_complete).toBeUndefined();
    expect(marker!.last_action).toBeUndefined();
  });
});

// ── Determinism contract — caller supplies timestamp ─────────────────────────

describe("determinism contract", () => {
  it("the written timestamp is exactly the caller-supplied value", () => {
    const runDir = makeRunDir();
    const callerTs = "2026-06-13T10:00:00.000Z";
    writeHeartbeat(runDir, "det-lane", callerTs);
    const marker = readHeartbeatMarker(runDir, "det-lane");
    // The lib must not substitute its own timestamp.
    expect(marker!.timestamp).toBe(callerTs);
  });

  it("two calls with different caller timestamps produce different markers", () => {
    const runDir = makeRunDir();
    const ts1 = "2026-06-13T09:00:00.000Z";
    const ts2 = "2026-06-13T10:00:00.000Z";
    writeHeartbeat(runDir, "det-lane", ts1);
    const m1 = readHeartbeatMarker(runDir, "det-lane");
    writeHeartbeat(runDir, "det-lane", ts2);
    const m2 = readHeartbeatMarker(runDir, "det-lane");
    expect(m1!.timestamp).toBe(ts1);
    expect(m2!.timestamp).toBe(ts2);
    expect(m1!.timestamp).not.toBe(m2!.timestamp);
  });
});

// ── Integration: write → isStale ─────────────────────────────────────────────

describe("write → isStale integration", () => {
  it("a just-written marker is not stale at the same nowMs", () => {
    const runDir = makeRunDir();
    const nowMs = BASE_MS;
    const ts = new Date(nowMs).toISOString();
    writeHeartbeat(runDir, "int-lane", ts);
    const marker = readHeartbeatMarker(runDir, "int-lane");
    expect(isStale(marker!, nowMs, DEFAULT_HEARTBEAT_TTL_MS)).toBe(false);
  });

  it("a marker written far in the past is stale relative to a later nowMs", () => {
    const runDir = makeRunDir();
    const writeMs = BASE_MS - DEFAULT_HEARTBEAT_TTL_MS * 2;
    const ts = new Date(writeMs).toISOString();
    writeHeartbeat(runDir, "old-lane", ts);
    const marker = readHeartbeatMarker(runDir, "old-lane");
    expect(isStale(marker!, BASE_MS, DEFAULT_HEARTBEAT_TTL_MS)).toBe(true);
  });
});
