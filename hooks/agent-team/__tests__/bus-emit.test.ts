/**
 * hooks/agent-team/__tests__/bus-emit.test.ts
 *
 * TDD for hooks/lib/bus-emit.ts — the agent-bus NDJSON event emitter.
 * Covers:
 *   - buildBusEvent stamps schema_version + ts + required fields
 *   - emitBusEvent writes to <runDir>/agent-bus/events.ndjson
 *   - emitBusEvent creates the agent-bus dir if it doesn't exist
 *   - emitBusEvent is best-effort: returns false + does not throw on bad dir
 *   - All 4 event kinds (dispatched, completed, errored, idle)
 *   - Optional fields (lane_id, task_id, team_name, detail) present/absent
 *
 * Integration (real hook fire → completed line in events.ndjson):
 *   See task-completed.test.ts "bus event" section.
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  buildBusEvent,
  emitBusEvent,
  BUS_EVENT_SCHEMA_VERSION,
} from "../../lib/bus-emit";

function readBusLines(runDir: string): Array<Record<string, unknown>> {
  const file = path.join(runDir, "agent-bus", "events.ndjson");
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

describe("buildBusEvent", () => {
  it("stamps schema_version and ISO ts", () => {
    const rec = buildBusEvent({ run_id: "r1", event: "dispatched" });
    expect(rec.schema_version).toBe(BUS_EVENT_SCHEMA_VERSION);
    expect(rec.schema_version).toBe("guild.agent_bus_event.v1");
    expect(() => new Date(rec.ts).toISOString()).not.toThrow();
  });

  it("carries all required fields", () => {
    const rec = buildBusEvent({ run_id: "r1", event: "completed" });
    expect(rec.run_id).toBe("r1");
    expect(rec.event).toBe("completed");
  });

  it("carries optional fields when provided", () => {
    const rec = buildBusEvent({
      run_id: "r1",
      event: "dispatched",
      lane_id: "backend",
      task_id: "task-001",
      team_name: "guild",
      detail: "lane queued",
    });
    expect(rec.lane_id).toBe("backend");
    expect(rec.task_id).toBe("task-001");
    expect(rec.team_name).toBe("guild");
    expect(rec.detail).toBe("lane queued");
  });

  it("omits optional fields when absent or empty", () => {
    const rec = buildBusEvent({ run_id: "r1", event: "idle" });
    expect(rec.lane_id).toBeUndefined();
    expect(rec.task_id).toBeUndefined();
    expect(rec.team_name).toBeUndefined();
    expect(rec.detail).toBeUndefined();
  });

  it("supports all 4 event kinds", () => {
    for (const kind of ["dispatched", "completed", "errored", "idle"] as const) {
      const rec = buildBusEvent({ run_id: "r", event: kind });
      expect(rec.event).toBe(kind);
    }
  });
});

describe("emitBusEvent", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "guild-bus-emit-"));
  });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it("creates agent-bus/ and appends to events.ndjson", () => {
    const ok = emitBusEvent(tmp, { run_id: "r1", event: "dispatched", lane_id: "backend" });
    expect(ok).toBe(true);
    const file = path.join(tmp, "agent-bus", "events.ndjson");
    expect(fs.existsSync(file)).toBe(true);
    const lines = readBusLines(tmp);
    expect(lines.length).toBe(1);
    expect(lines[0].schema_version).toBe("guild.agent_bus_event.v1");
    expect(lines[0].event).toBe("dispatched");
    expect(lines[0].lane_id).toBe("backend");
  });

  it("appends multiple events in NDJSON order", () => {
    emitBusEvent(tmp, { run_id: "r", event: "dispatched", task_id: "t1" });
    emitBusEvent(tmp, { run_id: "r", event: "completed", task_id: "t1" });
    const lines = readBusLines(tmp);
    expect(lines.length).toBe(2);
    expect(lines[0].event).toBe("dispatched");
    expect(lines[1].event).toBe("completed");
  });

  it("returns false + does not throw when runDir is non-writable", () => {
    // Pass a path where mkdir will fail (parent is a file, not a dir)
    const badPath = path.join(tmp, "not-a-dir");
    fs.writeFileSync(badPath, "I am a file");
    expect(() => emitBusEvent(badPath, { run_id: "r", event: "idle" })).not.toThrow();
    const result = emitBusEvent(badPath, { run_id: "r", event: "idle" });
    expect(result).toBe(false);
  });

  it("event record on disk is valid JSON with required fields", () => {
    emitBusEvent(tmp, {
      run_id: "run-abc",
      event: "errored",
      lane_id: "qa",
      task_id: "task-007",
      team_name: "guild",
      detail: "blocked by missing dep",
    });
    const lines = readBusLines(tmp);
    const rec = lines[0];
    expect(rec.schema_version).toBe("guild.agent_bus_event.v1");
    expect(rec.run_id).toBe("run-abc");
    expect(rec.event).toBe("errored");
    expect(rec.lane_id).toBe("qa");
    expect(rec.task_id).toBe("task-007");
    expect(rec.team_name).toBe("guild");
    expect(typeof rec.detail).toBe("string");
  });
});
