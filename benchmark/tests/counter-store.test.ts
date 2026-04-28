// v1.4.0 — T3a-backend-config pinning tests for counters.json persistence.
// Architect contract:
//   - atomic-rename writes (write-tmp → fsync → rename)
//   - shared lockfile (`<runDir>/logs/.lock`) coordinates with JSONL writer
//     via the shared `withStableLock()` helper in `v1.4-lock.ts`
//   - bounded retry (initial + 3 retries; 10ms/50ms/200ms backoff between)
//     on EBUSY/EIO/EAGAIN/ENOSPC
//   - crash-resume cleanup deletes orphaned `counters.json.tmp` on read
//   - per-lane key isolation (lane A's writes never touch lane B's keys)
//   - schema: globals `l1_round`/`l2_round` flat; per-lane lane-keyed
//     nested object with `L3_round`/`L4_round`/`security_round`/`restart_count`

import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { spawn, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  COUNTER_SCHEMA_VERSION,
  CounterStoreContentionError,
  cleanupOrphanedTmp,
  counterFilePath,
  counterLockPath,
  counterTmpPath,
  emptyLaneCounters,
  getGlobal,
  getLaneCounter,
  getLaneCounters,
  GLOBAL_COUNTER_KEYS,
  incrementL1,
  incrementL2,
  incrementLaneCounter,
  LANE_COUNTER_FIELDS,
  MAX_ATTEMPTS,
  MAX_RETRIES,
  readCounters,
  resetLaneCounters,
  RETRY_BACKOFFS_MS,
  updateCounters,
} from "../src/counter-store.js";
import {
  exclusionSentinelPath,
  stableLockPath,
} from "../src/v1.4-lock.js";

let tmpRoot: string;
let runDir: string;
const RUN_ID = "test-run-counter-store";

beforeEach(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), "guild-counter-store-"));
  runDir = join(tmpRoot, "runs", RUN_ID);
  mkdirSync(runDir, { recursive: true });
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

// ──────────────────────────────────────────────────────────────────────────
// Schema constants — pinned literals
// ──────────────────────────────────────────────────────────────────────────

describe("counter-store / schema constants", () => {
  it("GLOBAL_COUNTER_KEYS is the exact ordered tuple [l1_round, l2_round]", () => {
    expect(GLOBAL_COUNTER_KEYS).toEqual(["l1_round", "l2_round"]);
  });

  it("LANE_COUNTER_FIELDS lists the four required per-lane integers in order", () => {
    expect(LANE_COUNTER_FIELDS).toEqual([
      "L3_round",
      "L4_round",
      "security_round",
      "restart_count",
    ]);
  });

  it("emptyLaneCounters() returns all four fields zero-initialized", () => {
    const empty = emptyLaneCounters();
    expect(empty).toEqual({
      L3_round: 0,
      L4_round: 0,
      security_round: 0,
      restart_count: 0,
    });
  });

  it("retry budget = 1 initial + 3 retries (4 total attempts) with 10/50/200ms backoffs", () => {
    expect(MAX_RETRIES).toBe(3);
    expect(MAX_ATTEMPTS).toBe(4);
    expect(RETRY_BACKOFFS_MS).toEqual([10, 50, 200]);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Round-trip
// ──────────────────────────────────────────────────────────────────────────

describe("counter-store / write-then-read round-trip", () => {
  it("first read of a fresh run returns an empty CounterFile", () => {
    const file = readCounters(runDir, RUN_ID);
    expect(file).toEqual({
      schema_version: COUNTER_SCHEMA_VERSION,
      run_id: RUN_ID,
      counters: {},
    });
  });

  it("update + read round-trips a mixed (globals + per-lane) counter map", () => {
    updateCounters(runDir, RUN_ID, () => ({
      l1_round: 2,
      l2_round: 5,
      "T3a-backend-config": {
        L3_round: 1,
        L4_round: 0,
        security_round: 0,
        restart_count: 0,
      },
    }));
    const file = readCounters(runDir, RUN_ID);
    expect(file.schema_version).toBe(1);
    expect(file.run_id).toBe(RUN_ID);
    expect(file.counters.l1_round).toBe(2);
    expect(file.counters.l2_round).toBe(5);
    const lane = file.counters["T3a-backend-config"];
    expect(lane).toEqual({
      L3_round: 1,
      L4_round: 0,
      security_round: 0,
      restart_count: 0,
    });
  });

  it("incrementL1 / incrementL2 increment by 1 by default and persist", () => {
    expect(incrementL1(runDir, RUN_ID)).toBe(1);
    expect(incrementL1(runDir, RUN_ID)).toBe(2);
    expect(incrementL1(runDir, RUN_ID, 3)).toBe(5);
    expect(getGlobal(runDir, RUN_ID, "l1_round")).toBe(5);
    expect(incrementL2(runDir, RUN_ID)).toBe(1);
  });

  it("incrementLaneCounter creates a fresh lane block with all four fields zeroed", () => {
    incrementLaneCounter(runDir, RUN_ID, "T-X", "L3_round");
    const block = getLaneCounters(runDir, RUN_ID, "T-X");
    expect(block).toEqual({
      L3_round: 1,
      L4_round: 0,
      security_round: 0,
      restart_count: 0,
    });
  });

  it("getLaneCounter returns 0 for absent lanes and absent fields", () => {
    expect(getLaneCounter(runDir, RUN_ID, "no-such-lane", "L3_round")).toBe(0);
    incrementLaneCounter(runDir, RUN_ID, "T-X", "L4_round");
    expect(getLaneCounter(runDir, RUN_ID, "T-X", "L3_round")).toBe(0);
    expect(getLaneCounter(runDir, RUN_ID, "T-X", "L4_round")).toBe(1);
  });

  it("counters.json is valid JSON on disk and matches the lane-keyed schema", () => {
    incrementL1(runDir, RUN_ID);
    incrementLaneCounter(runDir, RUN_ID, "T-A", "security_round", 7);
    const text = readFileSync(counterFilePath(runDir), "utf8");
    const obj = JSON.parse(text) as {
      schema_version: number;
      run_id: string;
      counters: Record<string, unknown>;
    };
    expect(obj.schema_version).toBe(1);
    expect(obj.run_id).toBe(RUN_ID);
    expect(obj.counters.l1_round).toBe(1);
    expect(obj.counters["T-A"]).toEqual({
      L3_round: 0,
      L4_round: 0,
      security_round: 7,
      restart_count: 0,
    });
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Atomic-rename — `.tmp` must not persist after success
// ──────────────────────────────────────────────────────────────────────────

describe("counter-store / atomic-rename writer", () => {
  it("does not leave counters.json.tmp behind after a successful write", () => {
    incrementL1(runDir, RUN_ID);
    expect(existsSync(counterTmpPath(runDir))).toBe(false);
    expect(existsSync(counterFilePath(runDir))).toBe(true);
  });

  it("uses the canonical paths from counterFilePath / counterTmpPath / counterLockPath", () => {
    expect(counterFilePath(runDir)).toBe(join(runDir, "counters.json"));
    expect(counterTmpPath(runDir)).toBe(join(runDir, "counters.json.tmp"));
    expect(counterLockPath(runDir)).toBe(join(runDir, "logs", ".lock"));
    // Cross-check the shared helper resolves the same path.
    expect(stableLockPath(runDir)).toBe(counterLockPath(runDir));
  });

  it("writes are 'all-or-nothing' — readers never see a partial file", () => {
    // Apply 50 updates; assert every intermediate read parses cleanly and
    // the final state is the expected sum.
    for (let i = 0; i < 50; i++) {
      incrementL1(runDir, RUN_ID);
      const text = readFileSync(counterFilePath(runDir), "utf8");
      // Should always parse — atomic-rename guarantees readers see a
      // complete file at any moment.
      const parsed = JSON.parse(text);
      expect(parsed).toHaveProperty("schema_version", 1);
    }
    expect(getGlobal(runDir, RUN_ID, "l1_round")).toBe(50);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Crash-resume cleanup
// ──────────────────────────────────────────────────────────────────────────

describe("counter-store / crash-resume cleanup", () => {
  it("on read, deletes orphaned counters.json.tmp from a previous crashed run", () => {
    // Simulate a crash mid-write: tmp exists, but counters.json holds
    // last-good state.
    writeFileSync(
      counterFilePath(runDir),
      JSON.stringify(
        {
          schema_version: 1,
          run_id: RUN_ID,
          counters: { l1_round: 3 },
        },
        null,
        2,
      ),
    );
    writeFileSync(counterTmpPath(runDir), '{"crashed": "during write"}');
    expect(existsSync(counterTmpPath(runDir))).toBe(true);

    const file = readCounters(runDir, RUN_ID);
    // Last-good state preserved.
    expect(file.counters.l1_round).toBe(3);
    // Orphaned tmp removed.
    expect(existsSync(counterTmpPath(runDir))).toBe(false);
  });

  it("cleanupOrphanedTmp is a no-op when no tmp file exists", () => {
    expect(() => cleanupOrphanedTmp(runDir)).not.toThrow();
    expect(existsSync(counterTmpPath(runDir))).toBe(false);
  });

  it("on crash with no counters.json yet, the next write starts from a clean empty state", () => {
    // Crash before the very first rename. Stub a leftover tmp.
    writeFileSync(counterTmpPath(runDir), '{"partial": true}');
    // Resume: read returns empty (counters.json absent), tmp gets cleaned.
    const file = readCounters(runDir, RUN_ID);
    expect(file.counters).toEqual({});
    expect(existsSync(counterTmpPath(runDir))).toBe(false);
    // Subsequent updates work cleanly.
    incrementL1(runDir, RUN_ID);
    expect(getGlobal(runDir, RUN_ID, "l1_round")).toBe(1);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Lock contention — concurrent writers serialise on the shared lockfile
// ──────────────────────────────────────────────────────────────────────────

describe("counter-store / shared-lock contention", () => {
  it("the .lock.exclusion sentinel mediates exclusivity (EEXIST while held)", () => {
    // Acquire the EXCLUSION sentinel manually (matches the shared
    // helper's O_EXCL idiom). A second `openSync(... 'wx')` MUST throw
    // EEXIST while the lock is held.
    mkdirSync(join(runDir, "logs"), { recursive: true });
    // The .lock file is permanent; we must never create the sentinel
    // there. The exclusion sentinel is a SIBLING file.
    const exclusion = exclusionSentinelPath(runDir);
    const fd = openSync(exclusion, "wx");
    try {
      let secondAcquireFailed = false;
      try {
        const fd2 = openSync(exclusion, "wx");
        closeSync(fd2);
      } catch (err) {
        const code = (err as NodeJS.ErrnoException)?.code;
        secondAcquireFailed = code === "EEXIST";
      }
      expect(secondAcquireFailed).toBe(true);
    } finally {
      closeSync(fd);
      rmSync(exclusion, { force: true });
    }
    // Once released, the next updateCounters call succeeds.
    incrementL1(runDir, RUN_ID);
    expect(getGlobal(runDir, RUN_ID, "l1_round")).toBe(1);
  });

  it("the permanent .lock file is NEVER deleted by acquire/release", () => {
    mkdirSync(join(runDir, "logs"), { recursive: true });
    incrementL1(runDir, RUN_ID);
    // The shared helper initStableLockfile() creates the permanent inode.
    expect(existsSync(stableLockPath(runDir))).toBe(true);
    incrementL1(runDir, RUN_ID);
    // Still there after another write.
    expect(existsSync(stableLockPath(runDir))).toBe(true);
    // And the exclusion sidecar is gone (released).
    expect(existsSync(exclusionSentinelPath(runDir))).toBe(false);
  });

  it("two sequential incrementL1 calls converge to the correct sum", () => {
    incrementL1(runDir, RUN_ID);
    incrementL1(runDir, RUN_ID);
    incrementL2(runDir, RUN_ID);
    expect(getGlobal(runDir, RUN_ID, "l1_round")).toBe(2);
    expect(getGlobal(runDir, RUN_ID, "l2_round")).toBe(1);
  });

  it("4 concurrent child processes appending counter increments converge to correct totals", async () => {
    if (process.platform === "win32") {
      // POSIX-only path; Windows uses per-lane fallback.
      return;
    }
    const helper = `
      import { incrementL1, incrementLaneCounter } from "${join(__dirname, "..", "src", "counter-store.js").replace(/\\/g, "/")}";
      const runDir = process.argv[2];
      const runId = process.argv[3];
      const idx = Number(process.argv[4]);
      const count = Number(process.argv[5]);
      // Wait for the barrier file to appear so all processes contend
      // simultaneously.
      const fs = await import("node:fs");
      const barrier = process.argv[6];
      while (!fs.existsSync(barrier)) {
        await new Promise((r) => setTimeout(r, 5));
      }
      for (let i = 0; i < count; i++) {
        incrementL1(runDir, runId);
        incrementLaneCounter(runDir, runId, "lane-" + idx, "L3_round");
      }
    `;
    const helperPath = join(runDir, "_counter_helper.mts");
    const barrierPath = join(runDir, "_counter_barrier.ready");
    writeFileSync(helperPath, helper);

    const N = 4;
    const incrementsPer = 10;
    // Spawn N async children; they wait on the barrier file.
    const promises = [] as Promise<{ status: number | null }>[];
    for (let i = 0; i < N; i++) {
      promises.push(
        new Promise((resolve) => {
          const child = spawn(
            "npx",
            [
              "tsx",
              helperPath,
              runDir,
              RUN_ID,
              String(i),
              String(incrementsPer),
              barrierPath,
            ],
            { stdio: "ignore" },
          );
          child.on("exit", (status) => resolve({ status }));
        }),
      );
    }
    // Drop the barrier so all children unblock simultaneously.
    await new Promise((r) => setTimeout(r, 200));
    writeFileSync(barrierPath, "go");
    const results = await Promise.all(promises);
    for (const r of results) {
      expect(r.status).toBe(0);
    }
    // Total l1_round increments == N * incrementsPer.
    expect(getGlobal(runDir, RUN_ID, "l1_round")).toBe(N * incrementsPer);
    // Each lane's L3_round has its own bump count.
    for (let i = 0; i < N; i++) {
      expect(
        getLaneCounter(runDir, RUN_ID, `lane-${i}`, "L3_round"),
      ).toBe(incrementsPer);
    }
  }, 60_000);
});

// ──────────────────────────────────────────────────────────────────────────
// Per-lane isolation
// ──────────────────────────────────────────────────────────────────────────

describe("counter-store / per-lane key isolation", () => {
  it("updates to one lane's keys do not affect another lane's", () => {
    incrementLaneCounter(runDir, RUN_ID, "laneA", "L3_round");
    incrementLaneCounter(runDir, RUN_ID, "laneA", "L3_round");
    incrementLaneCounter(runDir, RUN_ID, "laneB", "L3_round");
    expect(getLaneCounter(runDir, RUN_ID, "laneA", "L3_round")).toBe(2);
    expect(getLaneCounter(runDir, RUN_ID, "laneB", "L3_round")).toBe(1);
    // Each lane's other fields stay zero.
    expect(getLaneCounter(runDir, RUN_ID, "laneA", "L4_round")).toBe(0);
    expect(getLaneCounter(runDir, RUN_ID, "laneB", "security_round")).toBe(0);
  });

  it("resetLaneCounters clears L3/L4/security for one lane only and PRESERVES restart_count", () => {
    // Seed two lanes' counters using the lane-keyed schema.
    updateCounters(runDir, RUN_ID, () => ({
      l1_round: 1,
      l2_round: 2,
      laneA: {
        L3_round: 5,
        L4_round: 3,
        security_round: 1,
        restart_count: 2,
      },
      laneB: {
        L3_round: 7,
        L4_round: 2,
        security_round: 0,
        restart_count: 0,
      },
    }));
    resetLaneCounters(runDir, RUN_ID, "laneA");
    const file = readCounters(runDir, RUN_ID);
    const laneA = file.counters.laneA;
    const laneB = file.counters.laneB;
    if (typeof laneA !== "object" || laneA === null) {
      throw new Error("laneA must be a lane block");
    }
    if (typeof laneB !== "object" || laneB === null) {
      throw new Error("laneB must be a lane block");
    }
    // laneA's L3/L4/security cleared
    expect(laneA.L3_round).toBe(0);
    expect(laneA.L4_round).toBe(0);
    expect(laneA.security_round).toBe(0);
    // restart_count survives (architect contract)
    expect(laneA.restart_count).toBe(2);
    // laneB untouched
    expect(laneB.L3_round).toBe(7);
    expect(laneB.L4_round).toBe(2);
    expect(laneB.restart_count).toBe(0);
    // Globals untouched
    expect(file.counters.l1_round).toBe(1);
    expect(file.counters.l2_round).toBe(2);
  });

  it("resetLaneCounters on an absent lane is a no-op", () => {
    expect(() =>
      resetLaneCounters(runDir, RUN_ID, "nonexistent"),
    ).not.toThrow();
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Error surfaces
// ──────────────────────────────────────────────────────────────────────────

describe("counter-store / error surfaces", () => {
  it("rejects malformed counters.json (non-integer global counter value)", () => {
    writeFileSync(
      counterFilePath(runDir),
      JSON.stringify({
        schema_version: 1,
        run_id: RUN_ID,
        counters: { l1_round: "five" }, // not an integer
      }),
    );
    expect(() => readCounters(runDir, RUN_ID)).toThrow(
      /global counter 'l1_round' must be an integer/,
    );
  });

  it("rejects malformed lane block (missing required field)", () => {
    writeFileSync(
      counterFilePath(runDir),
      JSON.stringify({
        schema_version: 1,
        run_id: RUN_ID,
        counters: {
          "T-X": { L3_round: 1, L4_round: 0, security_round: 0 },
        },
      }),
    );
    expect(() => readCounters(runDir, RUN_ID)).toThrow(
      /field 'restart_count' must be an integer/,
    );
  });

  it("rejects unknown extra field in a lane block", () => {
    writeFileSync(
      counterFilePath(runDir),
      JSON.stringify({
        schema_version: 1,
        run_id: RUN_ID,
        counters: {
          "T-X": {
            L3_round: 0,
            L4_round: 0,
            security_round: 0,
            restart_count: 0,
            extra: 1,
          },
        },
      }),
    );
    expect(() => readCounters(runDir, RUN_ID)).toThrow(
      /unknown field 'extra'/,
    );
  });

  it("rejects schema_version mismatch", () => {
    writeFileSync(
      counterFilePath(runDir),
      JSON.stringify({
        schema_version: 99,
        run_id: RUN_ID,
        counters: {},
      }),
    );
    expect(() => readCounters(runDir, RUN_ID)).toThrow(/schema_version/);
  });

  it("rejects run_id mismatch (catches stale file copies)", () => {
    writeFileSync(
      counterFilePath(runDir),
      JSON.stringify({
        schema_version: 1,
        run_id: "some-other-run",
        counters: {},
      }),
    );
    expect(() => readCounters(runDir, RUN_ID)).toThrow(/run_id mismatch/);
  });

  it("incrementLaneCounter rejects non-integer 'by' values", () => {
    expect(() =>
      incrementLaneCounter(runDir, RUN_ID, "T-X", "L3_round", 1.5),
    ).toThrow(/must be an integer/);
  });

  it("incrementL1 rejects non-integer 'by' values", () => {
    expect(() => incrementL1(runDir, RUN_ID, 1.5)).toThrow(/must be an integer/);
  });

  it("rejects a lane id that collides with a reserved global key", () => {
    expect(() =>
      incrementLaneCounter(runDir, RUN_ID, "l1_round", "L3_round"),
    ).toThrow(/reserved global counter key/);
  });

  it("CounterStoreContentionError carries attempt count = MAX_ATTEMPTS", () => {
    const err = new CounterStoreContentionError(MAX_ATTEMPTS, new Error("EBUSY"));
    expect(err.attempts).toBe(MAX_ATTEMPTS);
    expect(err.attempts).toBe(4);
    expect(err.name).toBe("CounterStoreContentionError");
    expect(err.message).toContain("4 attempt(s)");
  });
});

// Suppress unused-import lint warnings for variables only used in opt-in tests.
void closeSync;
void openSync;
void spawnSync;
