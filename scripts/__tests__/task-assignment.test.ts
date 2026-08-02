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
import {
  BindingRejectedError,
  closeRunBinding,
  loadRunBinding,
  mintRunBinding,
  runBindingPath,
} from "../../src/modules/lifecycle/workflows/run-binding";

const FIXED_NOW = () => "2026-06-27T00:00:00.000Z";

function tmpRunDir(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "guild-task-assignment-"));
  return path.join(d, ".guild", "runs", "run-x");
}

/** The workspace root a canonical runDir hangs under (<root>/.guild/runs/<id>). */
function rootOf(runDir: string): string {
  return path.resolve(runDir, "..", "..", "..");
}

/** T3 F3: mint-or-load the run's binding so the fail-closed writer accepts the write. */
function bindFor(runDir: string, runId = "run-x"): { binding_ref: string } {
  const root = rootOf(runDir);
  const existing = loadRunBinding({ root, run_id: runId });
  return { binding_ref: (existing ?? mintRunBinding({ root, run_id: runId })).binding_ref };
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
      const written = writeTaskAssignment(runDir, a, bindFor(runDir));
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
    expect(writeTaskAssignment(runDir, bad, bindFor(runDir))).toBeNull();
    expect(fs.existsSync(taskAssignmentPath(runDir, "backend"))).toBe(false);
  });
});


// ── T3 rework F3 — reviewer probe regressions (session_context §5, v1 channel) ──
// Round-1 live probe: writeTaskAssignment persisted a valid v1 descriptor with
// NO binding at all (ACCEPTED_FAIL_OPEN). These pin fail-closed for every
// §5 failure class, plus the runDir cross-run addressing check.

describe("T3 F3 — v1 descriptor writer fails closed on the run binding", () => {
  const valid = (runId = "run-x"): TaskAssignmentV1 =>
    buildTaskAssignment({
      runId,
      specialist: "backend",
      scope: "x",
      hostKind: "claude-code-cli",
      now: FIXED_NOW,
    });

  function expectReject(fn: () => unknown, reason: string): void {
    try {
      fn();
      throw new Error("unreachable — writer must throw");
    } catch (e) {
      expect(e).toBeInstanceOf(BindingRejectedError);
      expect((e as BindingRejectedError).diagnostic).toBe("binding_rejected");
      expect((e as BindingRejectedError).reason).toBe(reason);
    }
  }

  it("MISSING: no minted binding for the run → binding_not_minted, nothing written", () => {
    const runDir = tmpRunDir();
    expectReject(() => writeTaskAssignment(runDir, valid(), { binding_ref: "rb-unminted" }), "binding_not_minted");
    expect(fs.existsSync(taskAssignmentPath(runDir, "backend"))).toBe(false);
  });

  it("ABSENT REF: an undefined binding_ref is rejected even when a binding exists", () => {
    const runDir = tmpRunDir();
    bindFor(runDir);
    expectReject(
      () => writeTaskAssignment(runDir, valid(), { binding_ref: undefined as unknown as string }),
      "binding_absent"
    );
    expect(fs.existsSync(taskAssignmentPath(runDir, "backend"))).toBe(false);
  });

  it("MALFORMED: a corrupt persisted record (state 'corrupt-openish' — the reviewer probe) rejects the write", () => {
    const runDir = tmpRunDir();
    const ref = bindFor(runDir).binding_ref;
    fs.writeFileSync(
      runBindingPath(rootOf(runDir), "run-x"),
      JSON.stringify({
        schema_version: "guild.run_binding.v1",
        run_id: "run-x",
        binding_ref: ref,
        state: "corrupt-openish",
      }, null, 2) + "\n"
    );
    expectReject(() => writeTaskAssignment(runDir, valid(), { binding_ref: ref }), "binding_malformed");
    expect(fs.existsSync(taskAssignmentPath(runDir, "backend"))).toBe(false);
  });

  it("CLOSED: a revoked binding rejects the write", () => {
    const runDir = tmpRunDir();
    const bind = bindFor(runDir);
    closeRunBinding({ root: rootOf(runDir), run_id: "run-x" });
    expectReject(() => writeTaskAssignment(runDir, valid(), bind), "binding_closed");
  });

  it("MISMATCHED: another run's nonce rejects the write", () => {
    const runDir = tmpRunDir();
    bindFor(runDir);
    const other = mintRunBinding({ root: rootOf(runDir), run_id: "run-other" });
    expectReject(
      () => writeTaskAssignment(runDir, valid(), { binding_ref: other.binding_ref }),
      "binding_mismatch"
    );
  });

  it("CROSS-RUN ADDRESSING: a runDir naming a different run than the descriptor rejects (moved-sentinel class)", () => {
    const runDir = tmpRunDir(); // .../runs/run-x
    const bind = bindFor(runDir);
    expectReject(() => writeTaskAssignment(runDir, valid("run-elsewhere"), bind), "binding_mismatch");
  });

  it("MOVED SENTINEL: repointing both workspace sentinels cannot redirect or authorize the write (SC-1)", () => {
    const runDir = tmpRunDir();
    const root = rootOf(runDir);
    const bind = bindFor(runDir);
    fs.mkdirSync(path.join(root, ".guild", "runs"), { recursive: true });
    fs.writeFileSync(path.join(root, ".guild", "runs", "current-run-id"), "run-hijack\n");
    fs.writeFileSync(path.join(root, ".guild", "current-run-id"), "run-hijack\n");
    // The bound write still lands under ITS OWN run dir.
    const written = writeTaskAssignment(runDir, valid(), bind);
    expect(written).toBe(path.join(runDir, "tasks", "backend.json"));
    // The sentinel-named run (no minted binding) authorizes nothing.
    const hijackDir = path.join(root, ".guild", "runs", "run-hijack");
    expectReject(() => writeTaskAssignment(hijackDir, valid("run-hijack"), bind), "binding_not_minted");
  });
});
