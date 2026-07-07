/**
 * Tests for hooks/lib/context-compliance.ts
 *
 * Red-first coverage of the deterministic all-lanes/no-assemble enforcement:
 *   - classifyContextMode: assemble / inline / MISSING decision table
 *   - hasInlineTraceEntry: lane-mention + file-listed-working-set requirement
 *   - evaluateContextCompliance: real filesystem wiring (bundle + dispatch-trace)
 *   - record path: dedicated context-compliance.jsonl + v1.4 hook_event marker
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  classifyContextMode,
  hasInlineTraceEntry,
  traceLineMentionsLane,
  evaluateContextCompliance,
  appendComplianceLog,
  emitContextModeEvent,
  recordContextCompliance,
  bundleAbsPath,
  bundleRelPath,
  dispatchTraceAbsPath,
  CONTEXT_COMPLIANCE_SCHEMA,
} from "../context-compliance";

describe("classifyContextMode (pure decision table)", () => {
  it("bundle present → assemble (no gap), regardless of trace", () => {
    const r = classifyContextMode({
      bundleExists: true,
      traceContent: null,
      specialist: "backend",
      taskId: "task-001",
    });
    expect(r.context_mode).toBe("assemble");
    expect(r.bundle_present).toBe(true);
    expect(r.gap).toBe(false);
  });

  it("no bundle + inline trace entry with files → inline (no gap)", () => {
    const trace = [
      "# dispatch-trace",
      "",
      "- lane backend-task-001 · tier mid · working set:",
      "  - scripts/auth.ts",
      "  - scripts/auth.test.ts",
      "",
    ].join("\n");
    const r = classifyContextMode({
      bundleExists: false,
      traceContent: trace,
      specialist: "backend",
      taskId: "task-001",
    });
    expect(r.context_mode).toBe("inline");
    expect(r.trace_present).toBe(true);
    expect(r.trace_entry_found).toBe(true);
    expect(r.gap).toBe(false);
  });

  it("no bundle + NO trace at all → MISSING (gap)", () => {
    const r = classifyContextMode({
      bundleExists: false,
      traceContent: null,
      specialist: "backend",
      taskId: "task-001",
    });
    expect(r.context_mode).toBe("MISSING");
    expect(r.gap).toBe(true);
    expect(r.trace_present).toBe(false);
    expect(r.reason).toMatch(/no dispatch-trace/i);
  });

  it("no bundle + trace exists but does NOT name this lane → MISSING (gap)", () => {
    const trace = "- lane frontend-task-009 · files: src/app.tsx\n";
    const r = classifyContextMode({
      bundleExists: false,
      traceContent: trace,
      specialist: "backend",
      taskId: "task-001",
    });
    expect(r.context_mode).toBe("MISSING");
    expect(r.gap).toBe(true);
    expect(r.trace_present).toBe(true);
    expect(r.trace_entry_found).toBe(false);
  });

  it("no bundle + trace names the lane but lists NO files → MISSING (audit trail incomplete)", () => {
    const trace = "- lane backend-task-001 · tier mid · (no working set listed)\n";
    const r = classifyContextMode({
      bundleExists: false,
      traceContent: trace,
      specialist: "backend",
      taskId: "task-001",
    });
    expect(r.context_mode).toBe("MISSING");
    expect(r.gap).toBe(true);
  });
});

describe("traceLineMentionsLane", () => {
  it("matches by bare task id", () => {
    expect(traceLineMentionsLane("- task-001 dispatched", "backend", "task-001")).toBe(true);
  });
  it("matches by specialist-taskid token", () => {
    expect(traceLineMentionsLane("entry: backend-task-001", "backend", "task-001")).toBe(true);
  });
  it("does not match a different lane", () => {
    expect(traceLineMentionsLane("- task-999 dispatched", "backend", "task-001")).toBe(false);
  });
  // G-lane regression (codex): substring matching let a prefix-colliding sibling
  // satisfy the current lane — "backend-task-010".includes("task-01") is true.
  it("does NOT match a prefix-colliding sibling lane (task-01 vs task-010)", () => {
    expect(traceLineMentionsLane("backend-task-010 ... src/other.ts", "backend", "task-01")).toBe(false);
    expect(traceLineMentionsLane("- task-0100 dispatched", "backend", "task-01")).toBe(false);
    // …but still matches the SAME lane named with its specialist prefix:
    expect(traceLineMentionsLane("backend-task-01 ... src/x.ts", "backend", "task-01")).toBe(true);
  });
  it("full-stack regression: hasInlineTraceEntry rejects a sibling-lane block (→ MISSING)", () => {
    const trace = "## Lane backend-task-010\n- working set: `src/other.ts`\n";
    expect(hasInlineTraceEntry(trace, "backend", "task-01")).toBe(false); // sibling, not this lane
    expect(hasInlineTraceEntry(trace, "backend", "task-010")).toBe(true); // the real lane
  });
});

describe("hasInlineTraceEntry (file-listed working set requirement)", () => {
  it("returns false for an empty/missing trace", () => {
    expect(hasInlineTraceEntry(null, "backend", "task-001")).toBe(false);
    expect(hasInlineTraceEntry("", "backend", "task-001")).toBe(false);
  });

  it("rejects 'and/or' style prose as a file token (no extension)", () => {
    const trace = "- backend-task-001 touched this and/or that, no real files\n";
    expect(hasInlineTraceEntry(trace, "backend", "task-001")).toBe(false);
  });

  it("rejects a version number like v1.4 as a file token", () => {
    const trace = "- backend-task-001 · bumped to v1.4 · tier mid\n";
    expect(hasInlineTraceEntry(trace, "backend", "task-001")).toBe(false);
  });

  it("accepts a backtick-wrapped path with extension", () => {
    const trace = "- backend-task-001 working set: `hooks/lib/context-compliance.ts`\n";
    expect(hasInlineTraceEntry(trace, "backend", "task-001")).toBe(true);
  });

  it("only counts files within the lane's own block (blank-line separated)", () => {
    const trace = [
      "- backend-task-001 · tier mid · (no files)",
      "",
      "- frontend-task-002 · files: src/app.tsx",
    ].join("\n");
    // task-001's block has no file token; the file belongs to task-002's block.
    expect(hasInlineTraceEntry(trace, "backend", "task-001")).toBe(false);
    expect(hasInlineTraceEntry(trace, "frontend", "task-002")).toBe(true);
  });
});

describe("evaluateContextCompliance (filesystem wiring)", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "guild-ctxcompliance-"));
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const runId = "run-xyz";
  const specialist = "backend";
  const taskId = "task-001";

  function runDirFor(): string {
    return path.join(tmp, ".guild", "runs", runId);
  }

  it("assemble when a non-empty bundle exists at the canonical path", () => {
    const bundle = bundleAbsPath(tmp, runId, specialist, taskId);
    fs.mkdirSync(path.dirname(bundle), { recursive: true });
    fs.writeFileSync(bundle, "# bundle\nsome staged context\n");

    const r = evaluateContextCompliance({
      guildRoot: tmp,
      runDir: runDirFor(),
      runId,
      specialist,
      taskId,
    });
    expect(r.context_mode).toBe("assemble");
    expect(r.bundle_path).toBe(bundleRelPath(runId, specialist, taskId));
  });

  it("treats an empty bundle file as absent (not a pass)", () => {
    const bundle = bundleAbsPath(tmp, runId, specialist, taskId);
    fs.mkdirSync(path.dirname(bundle), { recursive: true });
    fs.writeFileSync(bundle, ""); // zero-byte

    const r = evaluateContextCompliance({
      guildRoot: tmp,
      runDir: runDirFor(),
      runId,
      specialist,
      taskId,
    });
    expect(r.context_mode).toBe("MISSING");
  });

  it("inline when no bundle but dispatch-trace.md names the lane with files", () => {
    const runDir = runDirFor();
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(
      dispatchTraceAbsPath(runDir),
      "- backend-task-001 · tier mid · working set: hooks/lib/x.ts\n",
    );

    const r = evaluateContextCompliance({
      guildRoot: tmp,
      runDir,
      runId,
      specialist,
      taskId,
    });
    expect(r.context_mode).toBe("inline");
    expect(r.trace_entry_found).toBe(true);
  });

  it("MISSING when neither bundle nor a qualifying trace entry exists", () => {
    const runDir = runDirFor();
    fs.mkdirSync(runDir, { recursive: true });
    const r = evaluateContextCompliance({
      guildRoot: tmp,
      runDir,
      runId,
      specialist,
      taskId,
    });
    expect(r.context_mode).toBe("MISSING");
    expect(r.gap).toBe(true);
  });
});

describe("recording channels", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "guild-ctxrecord-"));
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("appendComplianceLog writes a guild.context_compliance.v1 record", () => {
    const runDir = path.join(tmp, ".guild", "runs", "run-rec");
    const result = classifyContextMode({
      bundleExists: false,
      traceContent: null,
      specialist: "backend",
      taskId: "task-001",
    });
    result.bundle_path = bundleRelPath("run-rec", "backend", "task-001");
    expect(appendComplianceLog(runDir, "run-rec", "backend", "task-001", result)).toBe(true);

    const logPath = path.join(runDir, "context-compliance.jsonl");
    expect(fs.existsSync(logPath)).toBe(true);
    const rec = JSON.parse(fs.readFileSync(logPath, "utf8").trim());
    expect(rec.schema_version).toBe(CONTEXT_COMPLIANCE_SCHEMA);
    expect(rec.context_mode).toBe("MISSING");
    expect(rec.gap).toBe(true);
    expect(rec.lane_id).toBe("task-001");
    expect(rec.specialist).toBe("backend");
  });

  it("emitContextModeEvent writes a hook_event into the v1.4 events log", () => {
    const runDir = path.join(tmp, ".guild", "runs", "run-evt");
    const result = classifyContextMode({
      bundleExists: true,
      traceContent: null,
      specialist: "backend",
      taskId: "task-001",
    });
    expect(emitContextModeEvent(runDir, "run-evt", "backend", "task-001", result)).toBe(true);

    const eventsPath = path.join(runDir, "logs", "v1.4-events.jsonl");
    expect(fs.existsSync(eventsPath)).toBe(true);
    const line = fs.readFileSync(eventsPath, "utf8").trim().split("\n").filter(Boolean).pop()!;
    const evt = JSON.parse(line);
    expect(evt.event).toBe("hook_event");
    expect(evt.hook_name).toBe("TaskCompleted");
    expect(evt.lane_id).toBe("task-001");
    expect(evt.status).toBe("ok");
    expect(evt.payload_excerpt_redacted).toMatch(/context_mode=assemble/);
  });

  it("emitContextModeEvent marks status=err for MISSING", () => {
    const runDir = path.join(tmp, ".guild", "runs", "run-miss");
    const result = classifyContextMode({
      bundleExists: false,
      traceContent: null,
      specialist: "backend",
      taskId: "task-001",
    });
    emitContextModeEvent(runDir, "run-miss", "backend", "task-001", result);
    const eventsPath = path.join(runDir, "logs", "v1.4-events.jsonl");
    const evt = JSON.parse(fs.readFileSync(eventsPath, "utf8").trim().split("\n").filter(Boolean).pop()!);
    expect(evt.status).toBe("err");
    expect(evt.payload_excerpt_redacted).toMatch(/context_mode=MISSING/);
  });

  it("recordContextCompliance writes BOTH channels", () => {
    const runDir = path.join(tmp, ".guild", "runs", "run-both");
    const result = classifyContextMode({
      bundleExists: false,
      traceContent: "- backend-task-001 files: a/b.ts\n",
      specialist: "backend",
      taskId: "task-001",
    });
    recordContextCompliance(runDir, "run-both", "backend", "task-001", result);
    expect(fs.existsSync(path.join(runDir, "context-compliance.jsonl"))).toBe(true);
    expect(fs.existsSync(path.join(runDir, "logs", "v1.4-events.jsonl"))).toBe(true);
  });
});
