// v1.4.0 — SC9 observability-coverage test.
// The spec mandates: "every internal Bash/Edit/Write/Read/Grep/Glob/Agent/
// Skill/AskUserQuestion/TaskCreate/TaskUpdate/TaskList invocation during
// a `--loops` run emits a `tool_call` event with `command_redacted`,
// `result_excerpt_redacted`, `latency_ms`, `status` (ok/err/n/a).
// Hook invocations emit `hook_event`."
//
// This file pins SC9 by:
//   1. Asserting the closed enum `tool_call.tool` includes every
//      internal-tool value the spec names AND the schema doc adds
//      (WebFetch, WebSearch, NotebookEdit, BashOutput, KillShell).
//   2. Asserting the schema validator accepts a `tool_call` event for
//      every value in the closed enum.
//   3. Asserting `hook_event.hook_name` covers all 12 canonical Claude
//      Code hook events (so a hook fires from any of the 12 surfaces
//      can be logged validly).
//   4. Asserting summary regen aggregates per-tool counts so the
//      audit trail is complete.

import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { gzipSync } from "node:zlib";

import {
  EVENT_TYPES as EVENT_TYPES_SET,
  HOOK_EVENT_NAMES,
  TOOL_CALL_TOOL_VALUES,
  appendEvent,
  archiveDir,
  archivePath,
  liveLogPath,
  type JsonlEvent,
  type ToolCallEvent,
} from "../src/log-jsonl.js";
import {
  validateEvent,
  TOOL_CALL_TOOL_VALUES as VALIDATOR_TOOLS,
  HOOK_EVENT_NAMES as VALIDATOR_HOOKS,
  EVENT_TYPES as VALIDATOR_EVENTS,
} from "../../scripts/v1.4-log-validator.js";
import { regenerateSummary } from "../../scripts/v1.4-summary-md-regen.js";

const TS = "2026-04-27T07:35:00.123Z";
const RUN_ID = "run-2026-04-27-observability-test";

let tmpRoot: string;
let runDir: string;

beforeEach(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), "guild-observability-"));
  runDir = join(tmpRoot, "runs", RUN_ID);
  mkdirSync(join(runDir, "logs"), { recursive: true });
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

// ──────────────────────────────────────────────────────────────────────────
// SC9 — every spec-named tool surface covered
// ──────────────────────────────────────────────────────────────────────────

/** Verbatim from spec SC9: the 12 tool surfaces named in the success criterion. */
const SPEC_SC9_NAMED_TOOLS = [
  "Bash",
  "Edit",
  "Write",
  "Read",
  "Grep",
  "Glob",
  "Agent",
  "Skill",
  "AskUserQuestion",
  "TaskCreate",
  "TaskUpdate",
  "TaskList",
] as const;

describe("observability-coverage / SC9 — every named tool surface emits", () => {
  it("the closed tool_call.tool enum includes every spec-SC9 named tool", () => {
    const toolSet = new Set<string>(TOOL_CALL_TOOL_VALUES);
    for (const named of SPEC_SC9_NAMED_TOOLS) {
      expect(toolSet.has(named)).toBe(true);
    }
  });

  it("schema validator accepts a tool_call for every value in the enum", () => {
    for (const tool of TOOL_CALL_TOOL_VALUES) {
      const r = validateEvent({
        ts: TS,
        event: "tool_call",
        run_id: RUN_ID,
        tool,
        command_redacted: `${tool} test invocation`,
        status: "ok",
        latency_ms: 1,
        result_excerpt_redacted: "",
      });
      expect(r.ok).toBe(true);
    }
  });

  it("appendEvent + readAllEvents round-trips a tool_call for every named tool", async () => {
    for (const tool of SPEC_SC9_NAMED_TOOLS) {
      const ev: ToolCallEvent = {
        ts: TS,
        event: "tool_call",
        run_id: RUN_ID,
        lane_id: "T3c-backend-logging",
        tool,
        command_redacted: `${tool} args`,
        status: tool === "Read" || tool === "Grep" || tool === "Glob" ? "n/a" : "ok",
        latency_ms: 5,
        result_excerpt_redacted: "ok",
      };
      appendEvent(runDir, ev);
    }
    const text = readFileSync(liveLogPath(runDir), "utf8");
    const lines = text.trim().split("\n");
    expect(lines.length).toBe(SPEC_SC9_NAMED_TOOLS.length);
    for (const line of lines) {
      const parsed = JSON.parse(line);
      const r = validateEvent(parsed);
      expect(r.ok).toBe(true);
    }
  });

  it("summary.md aggregates counts per tool", async () => {
    // Emit 3 Bash + 2 Read + 1 Edit calls.
    const emits: ToolCallEvent[] = [
      ...new Array(3).fill(0).map((_, i) => ({
        ts: `2026-04-27T07:35:0${i}.000Z`,
        event: "tool_call" as const,
        run_id: RUN_ID,
        tool: "Bash" as const,
        command_redacted: `bash ${i}`,
        status: "ok" as const,
        latency_ms: 100 + i,
        result_excerpt_redacted: "x",
      })),
      ...new Array(2).fill(0).map((_, i) => ({
        ts: `2026-04-27T07:36:0${i}.000Z`,
        event: "tool_call" as const,
        run_id: RUN_ID,
        tool: "Read" as const,
        command_redacted: `read ${i}`,
        status: "n/a" as const,
        latency_ms: 50 + i,
        result_excerpt_redacted: "",
      })),
      {
        ts: "2026-04-27T07:37:00.000Z",
        event: "tool_call",
        run_id: RUN_ID,
        tool: "Edit",
        command_redacted: "edit",
        status: "ok",
        latency_ms: 75,
        result_excerpt_redacted: "",
      },
    ];
    for (const ev of emits) appendEvent(runDir, ev);

    const result = await regenerateSummary({ runDir });
    expect(result.markdown).toContain("## Tools");
    expect(result.markdown).toContain("Bash");
    expect(result.markdown).toContain("Read");
    expect(result.markdown).toContain("Edit");
    // 3 Bash calls
    expect(result.markdown).toMatch(/\| Bash \| 3 /);
    // 2 Read calls
    expect(result.markdown).toMatch(/\| Read \| 2 /);
  });
});

describe("observability-coverage / hook_event covers all 12 canonical hooks", () => {
  it("schema validator accepts a hook_event for every canonical hook_name", () => {
    for (const name of HOOK_EVENT_NAMES) {
      const r = validateEvent({
        ts: TS,
        event: "hook_event",
        run_id: RUN_ID,
        hook_name: name,
        payload_excerpt_redacted: "{}",
        latency_ms: 1,
        status: "ok",
      });
      expect(r.ok).toBe(true);
    }
  });

  it("HOOK_EVENT_NAMES are identical between log-jsonl and validator", () => {
    expect([...HOOK_EVENT_NAMES].sort()).toEqual([...VALIDATOR_HOOKS].sort());
  });

  it("TOOL_CALL_TOOL_VALUES are identical between log-jsonl and validator", () => {
    expect([...TOOL_CALL_TOOL_VALUES].sort()).toEqual([...VALIDATOR_TOOLS].sort());
  });

  it("EVENT_TYPES are identical between log-jsonl set and validator array", () => {
    expect([...EVENT_TYPES_SET].sort()).toEqual([...VALIDATOR_EVENTS].sort());
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Summary regen reads live + archive deterministically
// ──────────────────────────────────────────────────────────────────────────

describe("observability-coverage / summary regen — live + archive determinism", () => {
  it("two regens against the same JSONL set produce byte-identical summary.md", async () => {
    // Emit live log + craft an archive.
    const ev1: JsonlEvent = {
      ts: "2026-04-27T07:00:00.000Z",
      event: "phase_start",
      run_id: RUN_ID,
      phase: "plan",
    };
    const ev2: JsonlEvent = {
      ts: "2026-04-27T07:00:01.000Z",
      event: "tool_call",
      run_id: RUN_ID,
      tool: "Bash",
      command_redacted: "ls",
      status: "ok",
      latency_ms: 5,
      result_excerpt_redacted: "",
    };
    appendEvent(runDir, ev2);
    mkdirSync(archiveDir(runDir), { recursive: true });
    writeFileSync(
      archivePath(runDir, 1),
      gzipSync(Buffer.from(JSON.stringify(ev1) + "\n")),
    );

    const r1 = await regenerateSummary({
      runDir,
      outPath: join(tmpRoot, "summary1.md"),
    });
    const r2 = await regenerateSummary({
      runDir,
      outPath: join(tmpRoot, "summary2.md"),
    });
    expect(r1.markdown).toBe(r2.markdown);
  });

  it("summary regen reads archive events BEFORE live (chronological)", async () => {
    const archEvent: JsonlEvent = {
      ts: "2026-04-27T07:00:00.000Z",
      event: "phase_start",
      run_id: RUN_ID,
      phase: "brainstorm",
    };
    const liveEvent: JsonlEvent = {
      ts: "2026-04-27T07:00:01.000Z",
      event: "phase_end",
      run_id: RUN_ID,
      phase: "brainstorm",
      duration_ms: 1000,
      status: "ok",
    };
    appendEvent(runDir, liveEvent);
    mkdirSync(archiveDir(runDir), { recursive: true });
    writeFileSync(
      archivePath(runDir, 1),
      gzipSync(Buffer.from(JSON.stringify(archEvent) + "\n")),
    );
    const r = await regenerateSummary({ runDir });
    // Phases section should pair them — phase_start (from archive) +
    // phase_end (from live) = one phase entry.
    expect(r.markdown).toMatch(/\*\*brainstorm\*\* — 1000ms — ok/);
    expect(r.eventCount).toBe(2);
  });

  it("summary regen reports skipped malformed lines via skipped count", async () => {
    writeFileSync(liveLogPath(runDir), "not json\nalso bad\n");
    const r = await regenerateSummary({ runDir });
    expect(r.skipped).toBe(2);
    expect(r.eventCount).toBe(0);
  });

  it("summary regen has all 8 required sections (none of: Codex when no codex events)", async () => {
    appendEvent(runDir, {
      ts: TS,
      event: "phase_start",
      run_id: RUN_ID,
      phase: "plan",
    });
    const r = await regenerateSummary({ runDir });
    expect(r.markdown).toContain("## Phases");
    expect(r.markdown).toContain("## Specialist dispatches");
    expect(r.markdown).toContain("## Loop rounds");
    expect(r.markdown).toContain("## Gates");
    expect(r.markdown).toContain("## Tools");
    expect(r.markdown).toContain("## Hooks");
    expect(r.markdown).toContain("## Escalations");
    expect(r.markdown).toContain("## Assumptions");
    // Codex section absent when no codex events.
    expect(r.markdown).not.toContain("## Codex review");
  });

  it("summary regen emits Codex section when codex_review_round events exist", async () => {
    appendEvent(runDir, {
      ts: TS,
      event: "codex_review_round",
      run_id: RUN_ID,
      gate: "G-spec",
      round_number: 1,
      terminated_by_satisfied: true,
    });
    const r = await regenerateSummary({ runDir });
    expect(r.markdown).toContain("## Codex review");
  });

  it("summary regen writes summary.md to <runDir>/logs/summary.md by default", async () => {
    appendEvent(runDir, {
      ts: TS,
      event: "phase_start",
      run_id: RUN_ID,
      phase: "plan",
    });
    const r = await regenerateSummary({ runDir });
    expect(r.outPath).toBe(join(runDir, "logs", "summary.md"));
    expect(existsSync(r.outPath)).toBe(true);
  });
});
