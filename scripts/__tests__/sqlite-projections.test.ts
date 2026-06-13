/**
 * scripts/__tests__/sqlite-projections.test.ts
 *
 * Tests for scripts/lib/sqlite-projections.ts (ITEM-29, v2.x).
 *
 * Covers:
 *   buildRunState — happy path, sentinel folding, status merge, edge cases
 *   buildSpans    — happy path, synthetic span_id, actor resolution, tokens
 *   buildFilesTouched — happy path, deduplication, null provenance
 *   parseJsonlEvents  — malformed lines skipped, blanks skipped
 *   writeProjections  — DB upsert path via in-memory SQLite
 *   Key contract guarantees:
 *     - Filesystem-canonical: runs with no provenance produce sensible rows
 *     - is_current sentinel folded correctly into run_state
 *     - Deterministic: identical inputs → identical outputs
 *     - benchmark_eligible only true when provenance says so
 *     - Duplicate file paths deduplicated
 *     - Malformed/edge-case event lines handled gracefully
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  buildRunState,
  buildSpans,
  buildFilesTouched,
  parseJsonlEvents,
  writeProjections,
  validateRunStateRow,
  validateSpanRow,
  type ParsedRunYaml,
  type ParsedProvenance,
  type ParsedTraceEvent,
} from "../lib/sqlite-projections";

// ── Helpers ────────────────────────────────────────────────────────────────

/** Minimal in-memory SQLite DB for DB-write tests. */
function openInMemoryDb(): {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
    get(...params: unknown[]): Record<string, unknown> | undefined;
    all(...params: unknown[]): Record<string, unknown>[];
  };
  close(): void;
} {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { DatabaseSync } = require("node:sqlite") as {
    DatabaseSync: new (p: string) => ReturnType<typeof openInMemoryDb>;
  };
  return new DatabaseSync(":memory:");
}

/** Create the three projection tables in the given DB. */
function createProjectionTables(db: ReturnType<typeof openInMemoryDb>): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS run_state (
      run_id             TEXT NOT NULL PRIMARY KEY,
      status             TEXT NOT NULL,
      phase              TEXT,
      run_class          TEXT NOT NULL,
      command            TEXT NOT NULL,
      initiative         TEXT,
      started_at         TEXT NOT NULL,
      closed_at          TEXT,
      is_current         INTEGER NOT NULL DEFAULT 0,
      benchmark_eligible INTEGER NOT NULL DEFAULT 0,
      data               TEXT
    );
    CREATE TABLE IF NOT EXISTS spans (
      span_id        TEXT NOT NULL,
      run_id         TEXT NOT NULL,
      parent_span_id TEXT,
      event_type     TEXT NOT NULL,
      actor          TEXT NOT NULL,
      ts             TEXT NOT NULL,
      tier           TEXT,
      model          TEXT,
      lane_id        TEXT,
      task_id        TEXT,
      tokens_input   INTEGER,
      tokens_output  INTEGER,
      tokens_cached  INTEGER,
      cost_usd       REAL,
      data           TEXT,
      PRIMARY KEY (run_id, span_id)
    );
    CREATE TABLE IF NOT EXISTS files_touched (
      run_id TEXT NOT NULL,
      path   TEXT NOT NULL,
      PRIMARY KEY (run_id, path)
    );
  `);
}

/** A minimal valid run.yaml parsed object. */
function makeRunYaml(overrides: Partial<ParsedRunYaml> = {}): ParsedRunYaml {
  return {
    run_id: "run-abc123",
    status: "open",
    phase: "build",
    run_class: "full",
    command: "/guild:build",
    initiative_attachment: null,
    started_at: "2026-06-01T10:00:00Z",
    ...overrides,
  };
}

/** A minimal valid provenance.json parsed object. */
function makeProvenance(overrides: Partial<ParsedProvenance> = {}): ParsedProvenance {
  return {
    schema_version: "guild.provenance.v1",
    run_id: "run-abc123",
    status: "closed",
    closed_at: "2026-06-01T11:00:00Z",
    run_class: "full",
    command: "/guild:build",
    initiative: null,
    benchmark_eligible: true,
    touched: {
      files: ["src/foo.ts", "src/bar.ts"],
      tasks: ["task-1"],
      agents: ["backend"],
      skills: ["guild:build"],
      decisions: [],
      features: ["feature-x"],
    },
    ...overrides,
  };
}

/** A minimal v1.4 trace event. */
function makeEvent(overrides: Partial<ParsedTraceEvent> = {}): ParsedTraceEvent {
  return {
    ts: "2026-06-01T10:05:00Z",
    event: "specialist_dispatch",
    run_id: "run-abc123",
    lane_id: "T1a-backend",
    specialist: "backend",
    task_id: "task-1",
    ...overrides,
  };
}

// ── buildRunState ──────────────────────────────────────────────────────────

describe("buildRunState — happy path", () => {
  it("projects a closed run correctly", () => {
    const yaml = makeRunYaml();
    const prov = makeProvenance();
    const row = buildRunState(yaml, prov, false);

    expect(row.run_id).toBe("run-abc123");
    expect(row.status).toBe("closed"); // provenance terminal status wins
    expect(row.phase).toBe("build");
    expect(row.run_class).toBe("full");
    expect(row.command).toBe("/guild:build");
    expect(row.initiative).toBeNull();
    expect(row.started_at).toBe("2026-06-01T10:00:00Z");
    expect(row.closed_at).toBe("2026-06-01T11:00:00Z");
    expect(row.is_current).toBe(false);
    expect(row.benchmark_eligible).toBe(true);
    // data is a JSON blob of run.yaml
    const parsed = JSON.parse(row.data) as ParsedRunYaml;
    expect(parsed.run_id).toBe("run-abc123");
  });

  it("passes validation for a well-formed row", () => {
    const row = buildRunState(makeRunYaml(), makeProvenance(), false);
    const result = validateRunStateRow(row);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});

describe("buildRunState — sentinel folding", () => {
  it("sets is_current=true when isCurrent=true", () => {
    const row = buildRunState(makeRunYaml(), makeProvenance(), true);
    expect(row.is_current).toBe(true);
  });

  it("sets is_current=false when isCurrent=false", () => {
    const row = buildRunState(makeRunYaml(), makeProvenance(), false);
    expect(row.is_current).toBe(false);
  });
});

describe("buildRunState — status merge contract", () => {
  it("uses run.yaml status for an open run with no provenance", () => {
    const yaml = makeRunYaml({ status: "open" });
    const row = buildRunState(yaml, null, false);
    expect(row.status).toBe("open");
    expect(row.closed_at).toBeNull();
    expect(row.benchmark_eligible).toBe(false);
  });

  it("uses provenance terminal status when provenance says failed", () => {
    const yaml = makeRunYaml({ status: "open" });
    const prov = makeProvenance({ status: "failed", benchmark_eligible: false });
    const row = buildRunState(yaml, prov, false);
    expect(row.status).toBe("failed");
    expect(row.benchmark_eligible).toBe(false);
  });

  it("uses provenance terminal status 'resumable'", () => {
    const yaml = makeRunYaml({ status: "open" });
    const prov = makeProvenance({ status: "resumable", benchmark_eligible: false });
    const row = buildRunState(yaml, prov, false);
    expect(row.status).toBe("resumable");
  });

  it("keeps run.yaml status when provenance has a non-terminal status", () => {
    // If somehow provenance has a custom/non-terminal status, run.yaml wins.
    const yaml = makeRunYaml({ status: "open" });
    const prov = makeProvenance({ status: "open" as never });
    const row = buildRunState(yaml, prov, false);
    // "open" is not in the terminal set, so run.yaml "open" should win
    expect(row.status).toBe("open");
  });
});

describe("buildRunState — initiative handling (NN#5)", () => {
  it("records a non-null initiative slug from run.yaml", () => {
    const yaml = makeRunYaml({ initiative_attachment: "my-feature" });
    const row = buildRunState(yaml, null, false);
    expect(row.initiative).toBe("my-feature");
  });

  it("falls back to provenance.initiative when run.yaml has none", () => {
    const yaml = makeRunYaml({ initiative_attachment: undefined });
    const prov = makeProvenance({ initiative: "prov-feature" });
    const row = buildRunState(yaml, prov, false);
    expect(row.initiative).toBe("prov-feature");
  });

  it("returns null for 'null' string sentinel from YAML scalar", () => {
    const yaml = makeRunYaml({ initiative_attachment: "null" });
    const row = buildRunState(yaml, null, false);
    expect(row.initiative).toBeNull();
  });
});

describe("buildRunState — edge cases", () => {
  it("handles completely empty inputs without throwing", () => {
    const row = buildRunState({}, null, false);
    expect(row.run_id).toBe("");
    expect(row.status).toBe("open"); // default
    expect(row.run_class).toBe("full");
    expect(row.is_current).toBe(false);
    expect(row.benchmark_eligible).toBe(false);
  });

  it("is deterministic — identical inputs produce identical outputs", () => {
    const yaml = makeRunYaml();
    const prov = makeProvenance();
    const row1 = buildRunState(yaml, prov, false);
    const row2 = buildRunState(yaml, prov, false);
    expect(row1).toEqual(row2);
  });

  it("phase is null when run.yaml phase is null", () => {
    const yaml = makeRunYaml({ phase: null });
    const row = buildRunState(yaml, null, false);
    expect(row.phase).toBeNull();
  });
});

// ── buildSpans ─────────────────────────────────────────────────────────────

describe("buildSpans — happy path", () => {
  it("produces one span per event", () => {
    const events = [
      makeEvent({ event: "specialist_dispatch", ts: "2026-06-01T10:05:00Z" }),
      makeEvent({ event: "specialist_receipt", ts: "2026-06-01T10:10:00Z" }),
    ];
    const spans = buildSpans("run-abc123", events);
    expect(spans).toHaveLength(2);
  });

  it("carries all required fields", () => {
    const evt = makeEvent({
      event: "specialist_dispatch",
      ts: "2026-06-01T10:05:00Z",
      lane_id: "T1a-backend",
      specialist: "backend",
      task_id: "task-1",
    });
    const spans = buildSpans("run-abc123", [evt]);
    const span = spans[0];
    expect(span.run_id).toBe("run-abc123");
    expect(span.event_type).toBe("specialist_dispatch");
    expect(span.ts).toBe("2026-06-01T10:05:00Z");
    expect(span.actor).toBe("backend");
    expect(span.lane_id).toBe("T1a-backend");
    expect(span.task_id).toBe("task-1");
  });

  it("passes validation for a well-formed span", () => {
    const spans = buildSpans("run-abc123", [makeEvent()]);
    expect(validateSpanRow(spans[0]).valid).toBe(true);
  });
});

describe("buildSpans — v2 fields", () => {
  it("uses explicit span_id when present (v2 field)", () => {
    const evt = makeEvent({ span_id: "abc123def456789a" });
    const spans = buildSpans("run-abc123", [evt]);
    expect(spans[0].span_id).toBe("abc123def456789a");
  });

  it("synthesizes span_id from event:ts when span_id absent", () => {
    const evt = makeEvent({ event: "tool_call", ts: "2026-06-01T10:07:00Z" });
    delete evt.span_id;
    const spans = buildSpans("run-abc123", [evt]);
    expect(spans[0].span_id).toBe("tool_call:2026-06-01T10:07:00Z");
  });

  it("sets parent_span_id when present", () => {
    const evt = makeEvent({ parent_span_id: "parent000" });
    const spans = buildSpans("run-abc123", [evt]);
    expect(spans[0].parent_span_id).toBe("parent000");
  });

  it("sets parent_span_id to null when absent", () => {
    const spans = buildSpans("run-abc123", [makeEvent()]);
    expect(spans[0].parent_span_id).toBeNull();
  });

  it("captures token fields from v2 tokens block", () => {
    const evt = makeEvent({
      tokens: { input: 100, output: 200, cached: 50, cost_usd: 0.0025 },
    });
    const spans = buildSpans("run-abc123", [evt]);
    expect(spans[0].tokens_input).toBe(100);
    expect(spans[0].tokens_output).toBe(200);
    expect(spans[0].tokens_cached).toBe(50);
    expect(spans[0].cost_usd).toBeCloseTo(0.0025);
  });

  it("sets token fields to null when tokens block absent", () => {
    const spans = buildSpans("run-abc123", [makeEvent()]);
    expect(spans[0].tokens_input).toBeNull();
    expect(spans[0].tokens_output).toBeNull();
    expect(spans[0].tokens_cached).toBeNull();
    expect(spans[0].cost_usd).toBeNull();
  });

  it("captures tier and model from v2 fields", () => {
    const evt = makeEvent({ tier: "mid", model: "claude-sonnet-4" });
    const spans = buildSpans("run-abc123", [evt]);
    expect(spans[0].tier).toBe("mid");
    expect(spans[0].model).toBe("claude-sonnet-4");
  });
});

describe("buildSpans — actor resolution", () => {
  it("resolves actor from specialist field", () => {
    const spans = buildSpans("run-abc123", [makeEvent({ specialist: "frontend" })]);
    expect(spans[0].actor).toBe("frontend");
  });

  it("resolves actor from hook_name when specialist absent", () => {
    const evt: ParsedTraceEvent = {
      ts: "2026-06-01T10:05:00Z",
      event: "hook_event",
      run_id: "run-abc123",
      hook_name: "post-tool-use",
    };
    const spans = buildSpans("run-abc123", [evt]);
    expect(spans[0].actor).toBe("post-tool-use");
  });

  it("defaults actor to 'orchestrator' when no specialist or hook_name", () => {
    const evt: ParsedTraceEvent = {
      ts: "2026-06-01T10:05:00Z",
      event: "gate_decision",
      run_id: "run-abc123",
    };
    const spans = buildSpans("run-abc123", [evt]);
    expect(spans[0].actor).toBe("orchestrator");
  });
});

describe("buildSpans — edge cases", () => {
  it("returns empty array for empty events list", () => {
    expect(buildSpans("run-abc123", [])).toEqual([]);
  });

  it("handles events with missing ts gracefully", () => {
    const evt: ParsedTraceEvent = { event: "phase_start", run_id: "run-abc123" };
    const spans = buildSpans("run-abc123", [evt]);
    expect(spans[0].ts).toBe("unknown");
  });

  it("handles events with missing event type", () => {
    const evt: ParsedTraceEvent = { ts: "2026-06-01T10:05:00Z", run_id: "run-abc123" };
    const spans = buildSpans("run-abc123", [evt]);
    expect(spans[0].event_type).toBe("unknown");
  });

  it("is deterministic — identical inputs produce identical spans", () => {
    const events = [makeEvent(), makeEvent({ event: "specialist_receipt" })];
    const spans1 = buildSpans("run-abc123", events);
    const spans2 = buildSpans("run-abc123", events);
    expect(spans1).toEqual(spans2);
  });
});

// ── buildFilesTouched ──────────────────────────────────────────────────────

describe("buildFilesTouched — happy path", () => {
  it("produces one row per unique file path", () => {
    const prov = makeProvenance({
      touched: { files: ["src/foo.ts", "src/bar.ts", "README.md"] },
    });
    const rows = buildFilesTouched("run-abc123", prov);
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.path).sort()).toEqual(["README.md", "src/bar.ts", "src/foo.ts"].sort());
  });

  it("stamps run_id on every row", () => {
    const prov = makeProvenance({ touched: { files: ["src/foo.ts"] } });
    const rows = buildFilesTouched("run-xyz", prov);
    expect(rows[0].run_id).toBe("run-xyz");
  });
});

describe("buildFilesTouched — key contract guarantees", () => {
  it("deduplicates duplicate file paths within a run", () => {
    const prov = makeProvenance({
      touched: { files: ["src/foo.ts", "src/foo.ts", "src/bar.ts"] },
    });
    const rows = buildFilesTouched("run-abc123", prov);
    expect(rows).toHaveLength(2);
  });

  it("returns empty array when provenance is null", () => {
    expect(buildFilesTouched("run-abc123", null)).toEqual([]);
  });

  it("returns empty array when touched.files is absent", () => {
    const prov = makeProvenance({ touched: {} });
    expect(buildFilesTouched("run-abc123", prov)).toEqual([]);
  });

  it("returns empty array when touched.files is empty", () => {
    const prov = makeProvenance({ touched: { files: [] } });
    expect(buildFilesTouched("run-abc123", prov)).toEqual([]);
  });

  it("is deterministic — same inputs same outputs", () => {
    const prov = makeProvenance();
    const r1 = buildFilesTouched("run-abc123", prov);
    const r2 = buildFilesTouched("run-abc123", prov);
    expect(r1).toEqual(r2);
  });
});

// ── parseJsonlEvents ───────────────────────────────────────────────────────

describe("parseJsonlEvents", () => {
  it("parses a well-formed JSONL string", () => {
    const content = [
      JSON.stringify(makeEvent({ event: "phase_start" })),
      JSON.stringify(makeEvent({ event: "tool_call" })),
    ].join("\n");
    const events = parseJsonlEvents(content);
    expect(events).toHaveLength(2);
    expect(events[0].event).toBe("phase_start");
    expect(events[1].event).toBe("tool_call");
  });

  it("skips blank lines", () => {
    const content = `${JSON.stringify(makeEvent())}\n\n${JSON.stringify(makeEvent({ event: "phase_end" }))}`;
    expect(parseJsonlEvents(content)).toHaveLength(2);
  });

  it("skips malformed JSON lines", () => {
    const content = `${JSON.stringify(makeEvent())}\nnot-json\n{"broken":}`;
    expect(parseJsonlEvents(content)).toHaveLength(1);
  });

  it("skips JSON lines that are arrays (not objects)", () => {
    const content = `${JSON.stringify(makeEvent())}\n[1,2,3]`;
    expect(parseJsonlEvents(content)).toHaveLength(1);
  });

  it("returns empty array for empty string", () => {
    expect(parseJsonlEvents("")).toEqual([]);
  });

  it("returns empty array for all-blank content", () => {
    expect(parseJsonlEvents("   \n  \n")).toEqual([]);
  });
});

// ── writeProjections (DB path) ─────────────────────────────────────────────

describe("writeProjections — DB upsert path", () => {
  let db: ReturnType<typeof openInMemoryDb>;

  beforeEach(() => {
    db = openInMemoryDb();
    createProjectionTables(db);
  });

  afterEach(() => {
    db.close();
  });

  it("writes run_state row into DB", () => {
    writeProjections(db, "run-abc123", makeRunYaml(), makeProvenance(), [], false);
    const row = db.prepare("SELECT * FROM run_state WHERE run_id = ?").get("run-abc123");
    expect(row).toBeDefined();
    expect(row!["run_id"]).toBe("run-abc123");
    expect(row!["status"]).toBe("closed");
    expect(row!["is_current"]).toBe(0);
    expect(row!["benchmark_eligible"]).toBe(1);
  });

  it("writes span rows into DB", () => {
    const events = [
      makeEvent({ event: "specialist_dispatch" }),
      makeEvent({ event: "specialist_receipt", ts: "2026-06-01T10:10:00Z" }),
    ];
    writeProjections(db, "run-abc123", makeRunYaml(), makeProvenance(), events, false);
    const rows = db.prepare("SELECT * FROM spans WHERE run_id = ?").all("run-abc123");
    expect(rows).toHaveLength(2);
  });

  it("writes files_touched rows into DB", () => {
    const prov = makeProvenance({ touched: { files: ["src/foo.ts", "src/bar.ts"] } });
    writeProjections(db, "run-abc123", makeRunYaml(), prov, [], false);
    const rows = db.prepare("SELECT * FROM files_touched WHERE run_id = ?").all("run-abc123");
    expect(rows).toHaveLength(2);
  });

  it("upserts run_state on repeat call (idempotent rebuild)", () => {
    writeProjections(db, "run-abc123", makeRunYaml(), makeProvenance(), [], false);
    // Second write with is_current=true
    writeProjections(db, "run-abc123", makeRunYaml(), makeProvenance(), [], true);
    const rows = db.prepare("SELECT * FROM run_state WHERE run_id = ?").all("run-abc123");
    expect(rows).toHaveLength(1); // not duplicated
    expect(rows[0]["is_current"]).toBe(1); // updated
  });

  it("replaces spans on repeat call (stale spans purged)", () => {
    const e1 = [makeEvent({ event: "specialist_dispatch" })];
    const e2 = [
      makeEvent({ event: "specialist_dispatch" }),
      makeEvent({ event: "specialist_receipt", ts: "2026-06-01T10:10:00Z" }),
    ];
    writeProjections(db, "run-abc123", makeRunYaml(), makeProvenance(), e1, false);
    writeProjections(db, "run-abc123", makeRunYaml(), makeProvenance(), e2, false);
    const rows = db.prepare("SELECT * FROM spans WHERE run_id = ?").all("run-abc123");
    expect(rows).toHaveLength(2); // reflects e2, not e1+e2
  });

  it("handles null provenance (open run) without error", () => {
    expect(() =>
      writeProjections(db, "run-abc123", makeRunYaml({ status: "open" }), null, [], true)
    ).not.toThrow();
    const row = db.prepare("SELECT * FROM run_state WHERE run_id = ?").get("run-abc123");
    expect(row!["status"]).toBe("open");
    expect(row!["closed_at"]).toBeNull();
    expect(row!["benchmark_eligible"]).toBe(0);
  });

  it("folds is_current sentinel into DB row correctly", () => {
    writeProjections(db, "run-abc123", makeRunYaml(), makeProvenance(), [], true);
    const row = db.prepare("SELECT is_current FROM run_state WHERE run_id = ?").get("run-abc123");
    expect(row!["is_current"]).toBe(1);
  });
});

// ── Integration: full round-trip via temp-dir FS ──────────────────────────

describe("Full round-trip via temp-dir filesystem", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-sqlite-proj-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("reads real files and projects correctly", () => {
    const runId = "run-test-roundtrip";
    const runDir = path.join(tmpDir, ".guild", "runs", runId);
    const logsDir = path.join(runDir, "logs");
    fs.mkdirSync(logsDir, { recursive: true });

    // Write minimal run.yaml
    fs.writeFileSync(
      path.join(runDir, "run.yaml"),
      [
        "schema_version: guild.run.v1",
        `run_id: ${runId}`,
        "status: open",
        "phase: build",
        "run_class: full",
        "command: /guild:build",
        "initiative_attachment: null",
        "started_at: 2026-06-01T10:00:00Z",
      ].join("\n") + "\n",
      "utf8",
    );

    // Write provenance.json
    const provContent: ParsedProvenance = {
      schema_version: "guild.provenance.v1",
      run_id: runId,
      status: "closed",
      closed_at: "2026-06-01T11:00:00Z",
      run_class: "full",
      command: "/guild:build",
      initiative: null,
      benchmark_eligible: true,
      touched: { files: ["src/index.ts", "src/types.ts"] },
    };
    fs.writeFileSync(
      path.join(runDir, "provenance.json"),
      JSON.stringify(provContent, null, 2),
      "utf8",
    );

    // Write v1.4-events.jsonl
    const eventsLines = [
      JSON.stringify({ ts: "2026-06-01T10:05:00Z", event: "specialist_dispatch", run_id: runId, lane_id: "T1a", specialist: "backend", task_id: "t1" }),
      JSON.stringify({ ts: "2026-06-01T10:30:00Z", event: "specialist_receipt", run_id: runId, lane_id: "T1a", specialist: "backend", task_id: "t1", receipt_path: "handoffs/t1.md" }),
    ];
    fs.writeFileSync(path.join(logsDir, "v1.4-events.jsonl"), eventsLines.join("\n"), "utf8");

    // Write current-run-id sentinel pointing at this run
    fs.mkdirSync(path.join(tmpDir, ".guild", "runs"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, ".guild", "runs", "current-run-id"), runId, "utf8");

    // Parse inputs (mirrors CLI read path)
    const rawYaml = fs.readFileSync(path.join(runDir, "run.yaml"), "utf8");
    const getYaml = (key: string): string | null => {
      const m = rawYaml.match(new RegExp(`^${key}:[ \\t]*(.*)$`, "m"));
      return m ? m[1].trim() : null;
    };
    const runYaml: ParsedRunYaml = {
      run_id: getYaml("run_id") ?? undefined,
      status: getYaml("status") ?? undefined,
      phase: getYaml("phase"),
      run_class: getYaml("run_class") ?? undefined,
      command: getYaml("command") ?? undefined,
      initiative_attachment: getYaml("initiative_attachment"),
      started_at: getYaml("started_at") ?? undefined,
    };
    const prov = JSON.parse(fs.readFileSync(path.join(runDir, "provenance.json"), "utf8")) as ParsedProvenance;
    const events = parseJsonlEvents(fs.readFileSync(path.join(logsDir, "v1.4-events.jsonl"), "utf8"));
    const sentinel = fs.readFileSync(path.join(tmpDir, ".guild", "runs", "current-run-id"), "utf8").trim();
    const isCurrent = sentinel === runId;

    const runState = buildRunState(runYaml, prov, isCurrent);
    const spans = buildSpans(runId, events);
    const filesTouched = buildFilesTouched(runId, prov);

    expect(runState.run_id).toBe(runId);
    expect(runState.status).toBe("closed");
    expect(runState.phase).toBe("build");
    expect(runState.is_current).toBe(true);
    expect(runState.benchmark_eligible).toBe(true);
    expect(validateRunStateRow(runState).valid).toBe(true);

    expect(spans).toHaveLength(2);
    expect(spans[0].actor).toBe("backend");
    expect(spans[0].event_type).toBe("specialist_dispatch");

    expect(filesTouched).toHaveLength(2);
    expect(filesTouched.map((f) => f.path).sort()).toEqual(["src/index.ts", "src/types.ts"].sort());
  });
});
