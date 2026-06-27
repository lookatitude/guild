/**
 * scripts/__tests__/task-assignment.test.ts
 *
 * guild.task_assignment.v1 — the cross-host work-assignment channel (docs/v2 §08).
 * Verifies the write→read roundtrip, fail-closed validation, and the on-disk path.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import {
  TASK_ASSIGNMENT_SCHEMA,
  buildTaskAssignment,
  readTaskAssignment,
  taskAssignmentPath,
  validateTaskAssignmentV1,
  writeTaskAssignment,
  type TaskAssignmentV1,
} from "../../src/modules/dispatch/workflows/task-assignment";

const FIXED_NOW = () => "2026-06-27T00:00:00.000Z";

function tmpRunDir(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "guild-task-assignment-"));
  return path.join(d, ".guild", "runs", "run-x");
}

describe("guild.task_assignment.v1", () => {
  describe("buildTaskAssignment", () => {
    it("builds a valid v1 with defaults for the optional fields", () => {
      const a = buildTaskAssignment({
        runId: "run-x",
        specialist: "backend",
        scope: "Implement the API contract.",
        hostKind: "claude-code-cli",
        now: FIXED_NOW,
      });
      expect(a.schema_version).toBe(TASK_ASSIGNMENT_SCHEMA);
      expect(a).toMatchObject({
        run_id: "run-x",
        specialist: "backend",
        task_id: null,
        depends_on: [],
        context_ref: null,
        adapter_version: null,
        host_kind: "claude-code-cli",
        written_at: "2026-06-27T00:00:00.000Z",
      });
      expect(validateTaskAssignmentV1(a)).not.toBeNull();
    });

    it("carries task_id, depends_on, context_ref, adapter_version when provided", () => {
      const a = buildTaskAssignment({
        runId: "run-x",
        specialist: "qa",
        taskId: "L3",
        scope: "Author the regression suite.",
        dependsOn: ["backend"],
        contextRef: ".guild/context/run-x/qa-L3.md",
        hostKind: "codex-cli",
        adapterVersion: "1",
        now: FIXED_NOW,
      });
      expect(a).toMatchObject({
        task_id: "L3",
        depends_on: ["backend"],
        context_ref: ".guild/context/run-x/qa-L3.md",
        host_kind: "codex-cli",
        adapter_version: "1",
      });
    });
  });

  describe("write → read roundtrip", () => {
    it("writes to .guild/runs/<id>/tasks/<specialist>.json and reads it back", () => {
      const runDir = tmpRunDir();
      const a = buildTaskAssignment({
        runId: "run-x",
        specialist: "backend",
        scope: "Implement the API contract.",
        dependsOn: ["architect"],
        hostKind: "claude-code-cli",
        now: FIXED_NOW,
      });
      const written = writeTaskAssignment(runDir, a);
      expect(written).toBe(path.join(runDir, "tasks", "backend.json"));
      expect(fs.existsSync(written!)).toBe(true);
      expect(taskAssignmentPath(runDir, "backend")).toBe(written);
      const back = readTaskAssignment(runDir, "backend");
      expect(back).toEqual(a);
    });

    it("read returns null when the assignment is absent (no throw)", () => {
      const runDir = tmpRunDir();
      expect(readTaskAssignment(runDir, "nobody")).toBeNull();
    });

    it("read returns null on malformed JSON / invalid schema (fail-closed)", () => {
      const runDir = tmpRunDir();
      const p = taskAssignmentPath(runDir, "backend");
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, "{ not json");
      expect(readTaskAssignment(runDir, "backend")).toBeNull();
      fs.writeFileSync(p, JSON.stringify({ schema_version: "guild.wrong.v1" }));
      expect(readTaskAssignment(runDir, "backend")).toBeNull();
    });
  });

  describe("validateTaskAssignmentV1 — fail-closed", () => {
    const valid: TaskAssignmentV1 = buildTaskAssignment({
      runId: "run-x",
      specialist: "backend",
      scope: "x",
      hostKind: "claude-code-cli",
      now: FIXED_NOW,
    });
    it("accepts a valid object", () => expect(validateTaskAssignmentV1(valid)).not.toBeNull());
    it("rejects wrong schema_version", () =>
      expect(validateTaskAssignmentV1({ ...valid, schema_version: "guild.x.v2" })).toBeNull());
    it("rejects missing run_id", () =>
      expect(validateTaskAssignmentV1({ ...valid, run_id: "" })).toBeNull());
    it("rejects non-string depends_on entries", () =>
      expect(validateTaskAssignmentV1({ ...valid, depends_on: [1, 2] })).toBeNull());
    it("rejects a non-string scope", () =>
      expect(validateTaskAssignmentV1({ ...valid, scope: 42 })).toBeNull());
    it("rejects null/non-object", () => {
      expect(validateTaskAssignmentV1(null)).toBeNull();
      expect(validateTaskAssignmentV1("x")).toBeNull();
    });
  });

  it("writeTaskAssignment returns null and writes nothing for an invalid assignment", () => {
    const runDir = tmpRunDir();
    const bad = { schema_version: "guild.task_assignment.v1", specialist: "backend" } as unknown as TaskAssignmentV1;
    expect(writeTaskAssignment(runDir, bad)).toBeNull();
    expect(fs.existsSync(taskAssignmentPath(runDir, "backend"))).toBe(false);
  });
});
