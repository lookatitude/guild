/**
 * __tests__/emit-readback-degradation.test.ts
 *
 * W2-A2(d) — observable degradation signal for task_run readback failures.
 *
 * Tests that emitReadbackDegradation:
 *   1. Emits a stderr warning on read-failure.
 *   2. Appends a NDJSON record to v1.4-events.jsonl (guild-telemetry queryable).
 *   3. The record has the required fields: schema_version, event_name, run_id, task_id, specialist.
 *   4. Never throws — even on bad paths (the emit must never cascade to a harder failure).
 *   5. Creates the logs directory if it doesn't exist.
 *
 * "Forced to fail" in the unit context: the read has already returned undefined;
 * the CALLER (agent-team-launcher W2-A2 block) passes the task_id + specialist
 * to this function. The test calls emitReadbackDegradation directly — simulating
 * "the read was forced to fail and the degradation path was taken."
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  emitReadbackDegradation,
  READBACK_DEGRADATION_SCHEMA,
  READBACK_DEGRADATION_EVENT,
  type ReadbackDegradationRecord,
} from "../lib/emit-readback-degradation";

// ── Helpers ───────────────────────────────────────────────────────────────────

const TEMP_DIRS: string[] = [];
afterAll(() => {
  for (const d of TEMP_DIRS) fs.rmSync(d, { recursive: true, force: true });
});
function mkTmpDir(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "guild-erd-test-"));
  TEMP_DIRS.push(d);
  return d;
}

function eventsLogPath(cwd: string, runId: string): string {
  return path.join(cwd, ".guild", "runs", runId, "logs", "v1.4-events.jsonl");
}

function readDegradationRecords(logPath: string): ReadbackDegradationRecord[] {
  if (!fs.existsSync(logPath)) return [];
  return fs
    .readFileSync(logPath, "utf8")
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as ReadbackDegradationRecord)
    .filter((r) => r.event_name === READBACK_DEGRADATION_EVENT);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("emitReadbackDegradation — W2-A2(d) observable benign fallback", () => {
  test("appends a NDJSON record to v1.4-events.jsonl when read is forced to fail", () => {
    // Simulate: readTaskRunCapReqs returned undefined → caller invokes emitReadbackDegradation.
    const cwd = mkTmpDir();
    const runId = "run-wba2d-001";
    const taskId = "T1-analyst";
    const specialist = "analyst";

    const stderrOut: string[] = [];
    emitReadbackDegradation(cwd, runId, taskId, specialist, (msg) => stderrOut.push(msg));

    const logPath = eventsLogPath(cwd, runId);
    expect(fs.existsSync(logPath)).toBe(true);

    const records = readDegradationRecords(logPath);
    expect(records.length).toBe(1);

    const r = records[0];
    expect(r.schema_version).toBe(READBACK_DEGRADATION_SCHEMA);
    expect(r.event_name).toBe(READBACK_DEGRADATION_EVENT);
    expect(r.run_id).toBe(runId);
    expect(r.task_id).toBe(taskId);
    expect(r.specialist).toBe(specialist);
    expect(typeof r.message).toBe("string");
    expect(r.message.length).toBeGreaterThan(0);
    expect(typeof r.at).toBe("string");
  });

  test("emits a stderr warning containing the task_id and specialist", () => {
    const cwd = mkTmpDir();
    const stderrOut: string[] = [];

    emitReadbackDegradation(cwd, "run-001", "T2-backend", "backend", (msg) => stderrOut.push(msg));

    expect(stderrOut.length).toBeGreaterThan(0);
    const combined = stderrOut.join("");
    expect(combined).toContain("task_run_readback_failed");
    expect(combined).toContain("T2-backend");
    expect(combined).toContain("backend");
  });

  test("stderr message contains the 'equals written value' explanation (honest degradation message)", () => {
    const cwd = mkTmpDir();
    const stderrOut: string[] = [];

    emitReadbackDegradation(cwd, "run-001", "T3-qa", "qa", (msg) => stderrOut.push(msg));

    const combined = stderrOut.join("");
    expect(combined.toLowerCase()).toMatch(/equals written value|in-memory/i);
  });

  test("creates the logs directory if it does not exist", () => {
    const cwd = mkTmpDir();
    const runId = "run-mkdir-test";
    const logPath = eventsLogPath(cwd, runId);

    expect(fs.existsSync(path.dirname(logPath))).toBe(false); // dir not pre-created

    emitReadbackDegradation(cwd, runId, "T1-x", "x");

    expect(fs.existsSync(logPath)).toBe(true);
  });

  test("multiple calls append multiple records (one per readback failure)", () => {
    const cwd = mkTmpDir();
    const runId = "run-multi";

    emitReadbackDegradation(cwd, runId, "T1-architect", "architect");
    emitReadbackDegradation(cwd, runId, "T2-backend", "backend");
    emitReadbackDegradation(cwd, runId, "T3-qa", "qa");

    const records = readDegradationRecords(eventsLogPath(cwd, runId));
    expect(records.length).toBe(3);
    expect(records.map((r) => r.task_id).sort()).toEqual(
      ["T1-architect", "T2-backend", "T3-qa"].sort(),
    );
    expect(records.map((r) => r.specialist).sort()).toEqual(
      ["architect", "backend", "qa"].sort(),
    );
  });

  test("never throws — even when cwd is a non-writable or nonsensical path", () => {
    // Bad path — the function must not throw even if the file write fails.
    expect(() =>
      emitReadbackDegradation("/dev/null/no-such-dir", "run-x", "T1", "spec"),
    ).not.toThrow();
  });

  test("never throws — even when the stderr writer throws", () => {
    const cwd = mkTmpDir();
    const throwingOut = () => {
      throw new Error("stderr write failed");
    };

    expect(() =>
      emitReadbackDegradation(cwd, "run-001", "T1", "spec", throwingOut),
    ).not.toThrow();
  });

  test("record fields match — run_id, task_id, specialist are verbatim from call-site", () => {
    const cwd = mkTmpDir();
    const runId = "run-field-check";
    const taskId = "T99-special-task";
    const specialist = "security";
    const stderrOut: string[] = [];

    emitReadbackDegradation(cwd, runId, taskId, specialist, (msg) => stderrOut.push(msg));

    const records = readDegradationRecords(eventsLogPath(cwd, runId));
    expect(records[0].run_id).toBe(runId);
    expect(records[0].task_id).toBe(taskId);
    expect(records[0].specialist).toBe(specialist);

    // Stderr also carries these identifiers.
    const combined = stderrOut.join("");
    expect(combined).toContain(taskId);
    expect(combined).toContain(specialist);
  });
});
