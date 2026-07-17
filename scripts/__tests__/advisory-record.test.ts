/**
 * scripts/__tests__/advisory-record.test.ts
 *
 * guild.advisory.v1 record writer (deferred item 24).
 * Canonical contract: docs/v2/adversarial-review.md §Advisory records;
 * docs/knowledge/lifecycle/workflow-operating-model.md §Advisory records.
 *
 * Coverage:
 *  - Closed enum constants are exactly as specified.
 *  - makeAdvisoryRecord builds a fully-typed record (all required fields present,
 *    schema_version set, defaults applied, optional decision_link omitted when
 *    absent and included when supplied).
 *  - validateAdvisoryRecord accepts a well-formed record.
 *  - validateAdvisoryRecord catches every violation class (bad schema_version,
 *    empty id, bad backend, empty question, bad advisors, bad recommendations,
 *    empty synthesis, bad confidence, missing recorded_at, wrong shape).
 *  - appendAdvisoryRecord writes atomically to a real temp dir and returns
 *    { written: true, path }.
 *  - appendAdvisoryRecord returns { written: false, error } for an invalid record
 *    (no file created).
 *  - appendAdvisoryRecord returns { written: false, error } when the fs seam
 *    throws (fail-closed).
 *  - The written JSON round-trips back to an identical record.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import {
  ADVISORY_RECORD_SCHEMA,
  ADVISORY_BACKENDS,
  ADVISORY_CONFIDENCE,
  makeAdvisoryRecord,
  validateAdvisoryRecord,
  appendAdvisoryRecord,
  type AdvisoryRecord,
  type AppendFsSeam,
} from "../lib/advisory-record";

// ── Fixture helpers ───────────────────────────────────────────────────────────

const FIXED_TS = "2026-06-13T12:00:00Z";

function makeValid(): AdvisoryRecord {
  return makeAdvisoryRecord({
    id: "advisory-init-example-001",
    recorded_at: FIXED_TS,
    phase: "ideation",
    backend: "host_subagents",
    question: "Which architecture path should this initiative take?",
    advisors: [
      { role: "product", model_tier: "cheap" },
      { role: "architecture", model_tier: "mid" },
      { role: "escalation_reviewer", model_tier: "powerful" },
    ],
    recommendations: [
      { role: "product", recommendation: "Simpler monolith first.", confidence: "medium" },
      { role: "architecture", recommendation: "Event-driven boundaries at service edges.", confidence: "high" },
      { role: "escalation_reviewer", recommendation: "Either path is viable; lean on reversibility.", confidence: "medium" },
    ],
    synthesis: "Use event-driven boundaries at service edges; keep internal domain logic layered.",
    confidence: "high",
    run_id: "run-abc-123",
    initiative_id: "init-example",
    unresolved_questions: ["What is the expected peak load?"],
    decision_link: ".guild/wiki/decisions/arch-path.md",
  });
}

// ── Closed enum sanity ────────────────────────────────────────────────────────

test("ADVISORY_RECORD_SCHEMA is the frozen contract string", () => {
  expect(ADVISORY_RECORD_SCHEMA).toBe("guild.advisory.v1");
});

test("ADVISORY_BACKENDS closed enum", () => {
  expect([...ADVISORY_BACKENDS]).toEqual(["tmux_team", "host_subagents", "single_agent"]);
});

test("ADVISORY_CONFIDENCE closed enum", () => {
  expect([...ADVISORY_CONFIDENCE]).toEqual(["high", "medium", "low"]);
});

// ── makeAdvisoryRecord ────────────────────────────────────────────────────────

describe("makeAdvisoryRecord", () => {
  test("sets schema_version and all required fields", () => {
    const rec = makeValid();
    expect(rec.schema_version).toBe("guild.advisory.v1");
    expect(rec.id).toBe("advisory-init-example-001");
    expect(rec.recorded_at).toBe(FIXED_TS);
    expect(rec.phase).toBe("ideation");
    expect(rec.backend).toBe("host_subagents");
    expect(rec.question).toBe("Which architecture path should this initiative take?");
    expect(rec.synthesis).toContain("event-driven");
    expect(rec.confidence).toBe("high");
  });

  test("carries run_id, initiative_id, decision_link when supplied", () => {
    const rec = makeValid();
    expect(rec.run_id).toBe("run-abc-123");
    expect(rec.initiative_id).toBe("init-example");
    expect(rec.decision_link).toBe(".guild/wiki/decisions/arch-path.md");
  });

  test("defaults run_id and initiative_id to null when absent", () => {
    const rec = makeAdvisoryRecord({
      id: "adv-001",
      recorded_at: FIXED_TS,
      phase: "planning",
      backend: "single_agent",
      question: "Q?",
      advisors: [{ role: "architect", model_tier: "mid" }],
      recommendations: [{ role: "architect", recommendation: "Go with option B.", confidence: "high" }],
      synthesis: "Option B.",
      confidence: "medium",
    });
    expect(rec.run_id).toBeNull();
    expect(rec.initiative_id).toBeNull();
  });

  test("defaults unresolved_questions to [] when absent", () => {
    const rec = makeAdvisoryRecord({
      id: "adv-002",
      recorded_at: FIXED_TS,
      phase: "init",
      backend: "tmux_team",
      question: "Q?",
      advisors: [],
      recommendations: [],
      synthesis: "S.",
      confidence: "low",
    });
    expect(rec.unresolved_questions).toEqual([]);
  });

  test("omits decision_link when not supplied (key absent from object)", () => {
    const rec = makeAdvisoryRecord({
      id: "adv-003",
      recorded_at: FIXED_TS,
      phase: "review",
      backend: "single_agent",
      question: "Q?",
      advisors: [],
      recommendations: [],
      synthesis: "S.",
      confidence: "low",
    });
    expect(Object.prototype.hasOwnProperty.call(rec, "decision_link")).toBe(false);
  });

  test("does not mutate caller input", () => {
    const advisors: import("../lib/advisory-record").AdvisorEntry[] = [
      { role: "product", model_tier: "cheap" },
    ];
    const rec = makeAdvisoryRecord({
      id: "adv-004",
      recorded_at: FIXED_TS,
      phase: "ideation",
      backend: "host_subagents",
      question: "Q?",
      advisors,
      recommendations: [],
      synthesis: "S.",
      confidence: "medium",
    });
    advisors.push({ role: "extra", model_tier: "mid" });
    expect(rec.advisors).toHaveLength(1); // original snapshot unaffected
  });
});

// ── validateAdvisoryRecord ────────────────────────────────────────────────────

describe("validateAdvisoryRecord — happy path", () => {
  test("accepts a fully well-formed record", () => {
    const { valid, errors } = validateAdvisoryRecord(makeValid());
    expect(valid).toBe(true);
    expect(errors).toEqual([]);
  });

  test("accepts a minimal valid record (no decision_link, empty advisors/recommendations)", () => {
    const rec = makeAdvisoryRecord({
      id: "adv-min",
      recorded_at: FIXED_TS,
      phase: "ops",
      backend: "single_agent",
      question: "Should we proceed?",
      advisors: [],
      recommendations: [],
      synthesis: "Yes.",
      confidence: "low",
    });
    const { valid } = validateAdvisoryRecord(rec);
    expect(valid).toBe(true);
  });
});

describe("validateAdvisoryRecord — required field violations", () => {
  test("null / non-object input → invalid", () => {
    expect(validateAdvisoryRecord(null).valid).toBe(false);
    expect(validateAdvisoryRecord("string").valid).toBe(false);
    expect(validateAdvisoryRecord(42).valid).toBe(false);
    expect(validateAdvisoryRecord([]).valid).toBe(false);
  });

  test("wrong schema_version → error mentions schema_version", () => {
    const { valid, errors } = validateAdvisoryRecord({
      ...makeValid(),
      schema_version: "guild.advisory.v2",
    });
    expect(valid).toBe(false);
    expect(errors.join(" ")).toMatch(/schema_version/);
  });

  test("empty id → error mentions id", () => {
    const { valid, errors } = validateAdvisoryRecord({ ...makeValid(), id: "" });
    expect(valid).toBe(false);
    expect(errors.join(" ")).toMatch(/id/);
  });

  test("unknown backend → error mentions backend", () => {
    const { valid, errors } = validateAdvisoryRecord({ ...makeValid(), backend: "cloud_team" });
    expect(valid).toBe(false);
    expect(errors.join(" ")).toMatch(/backend/);
  });

  test("empty question → error mentions question", () => {
    const { valid, errors } = validateAdvisoryRecord({ ...makeValid(), question: "" });
    expect(valid).toBe(false);
    expect(errors.join(" ")).toMatch(/question/);
  });

  test("empty phase → error mentions phase", () => {
    const { valid, errors } = validateAdvisoryRecord({ ...makeValid(), phase: "" });
    expect(valid).toBe(false);
    expect(errors.join(" ")).toMatch(/phase/);
  });

  test("empty synthesis → error mentions synthesis", () => {
    const { valid, errors } = validateAdvisoryRecord({ ...makeValid(), synthesis: "" });
    expect(valid).toBe(false);
    expect(errors.join(" ")).toMatch(/synthesis/);
  });

  test("bad overall confidence → error mentions confidence", () => {
    const { valid, errors } = validateAdvisoryRecord({ ...makeValid(), confidence: "super-high" });
    expect(valid).toBe(false);
    expect(errors.join(" ")).toMatch(/confidence/);
  });

  test("missing recorded_at → error mentions recorded_at", () => {
    const { valid, errors } = validateAdvisoryRecord({ ...makeValid(), recorded_at: "" });
    expect(valid).toBe(false);
    expect(errors.join(" ")).toMatch(/recorded_at/);
  });

  test("run_id not null or string → error mentions run_id", () => {
    const { valid, errors } = validateAdvisoryRecord({ ...makeValid(), run_id: 42 });
    expect(valid).toBe(false);
    expect(errors.join(" ")).toMatch(/run_id/);
  });

  test("advisors not an array → error mentions advisors", () => {
    const { valid, errors } = validateAdvisoryRecord({ ...makeValid(), advisors: "not-array" });
    expect(valid).toBe(false);
    expect(errors.join(" ")).toMatch(/advisors/);
  });

  test("advisor with bad model_tier → error mentions model_tier", () => {
    const rec = makeValid();
    rec.advisors[0] = { role: "product", model_tier: "ultra" as never };
    const { valid, errors } = validateAdvisoryRecord(rec);
    expect(valid).toBe(false);
    expect(errors.join(" ")).toMatch(/model_tier/);
  });

  test("recommendation with bad confidence → error mentions confidence", () => {
    const rec = makeValid();
    rec.recommendations[0] = { ...rec.recommendations[0], confidence: "extreme" as never };
    const { valid, errors } = validateAdvisoryRecord(rec);
    expect(valid).toBe(false);
    expect(errors.join(" ")).toMatch(/confidence/);
  });

  test("recommendations not an array → error mentions recommendations", () => {
    const { valid, errors } = validateAdvisoryRecord({ ...makeValid(), recommendations: {} });
    expect(valid).toBe(false);
    expect(errors.join(" ")).toMatch(/recommendations/);
  });

  test("unresolved_questions not an array → error mentions unresolved_questions", () => {
    const { valid, errors } = validateAdvisoryRecord({
      ...makeValid(),
      unresolved_questions: "not-array",
    });
    expect(valid).toBe(false);
    expect(errors.join(" ")).toMatch(/unresolved_questions/);
  });

  test("multiple violations reported together", () => {
    const { valid, errors } = validateAdvisoryRecord({
      schema_version: "wrong",
      id: "",
      backend: "bad",
    });
    expect(valid).toBe(false);
    expect(errors.length).toBeGreaterThanOrEqual(2);
  });
});

// ── appendAdvisoryRecord — real fs (temp dirs) ────────────────────────────────

describe("appendAdvisoryRecord — real fs", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "advisory-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("happy path: writes the record and returns { written:true, path }", () => {
    const outPath = path.join(tmpDir, "advisory", "advisory-init-001.json");
    const rec = makeValid();
    const result = appendAdvisoryRecord(rec, outPath);

    expect(result.written).toBe(true);
    expect(result.path).toBe(outPath);
    expect(result.error).toBeUndefined();
    expect(fs.existsSync(outPath)).toBe(true);
  });

  test("written file parses back to the original record (round-trip)", () => {
    const outPath = path.join(tmpDir, "advisory-001.json");
    const rec = makeValid();
    appendAdvisoryRecord(rec, outPath);

    const raw = fs.readFileSync(outPath, "utf8");
    const parsed = JSON.parse(raw) as AdvisoryRecord;
    expect(parsed.schema_version).toBe("guild.advisory.v1");
    expect(parsed.id).toBe(rec.id);
    expect(parsed.recorded_at).toBe(FIXED_TS);
    expect(parsed.backend).toBe("host_subagents");
    expect(parsed.advisors).toHaveLength(3);
    expect(parsed.recommendations).toHaveLength(3);
    expect(parsed.unresolved_questions).toEqual(["What is the expected peak load?"]);
    expect(parsed.decision_link).toBe(".guild/wiki/decisions/arch-path.md");
  });

  test("creates intermediate directories automatically", () => {
    const nested = path.join(tmpDir, "runs", "run-abc-123", "advisory", "adv-001.json");
    const result = appendAdvisoryRecord(makeValid(), nested);
    expect(result.written).toBe(true);
    expect(fs.existsSync(nested)).toBe(true);
  });

  test("returns { written:false, error } for an invalid record — no file created", () => {
    const outPath = path.join(tmpDir, "bad.json");
    // Invalid: wrong schema_version + empty id
    const bad = { ...makeValid(), schema_version: "nope" as never, id: "" };
    const result = appendAdvisoryRecord(bad, outPath);
    expect(result.written).toBe(false);
    expect(typeof result.error).toBe("string");
    expect(result.error).toMatch(/validation failed/);
    expect(fs.existsSync(outPath)).toBe(false);
  });

  test("no leftover .tmp file after a successful write", () => {
    const outPath = path.join(tmpDir, "advisory-clean.json");
    appendAdvisoryRecord(makeValid(), outPath);
    const entries = fs.readdirSync(tmpDir);
    const leftover = entries.filter((e) => e.includes(".tmp-advisory-"));
    expect(leftover).toHaveLength(0);
  });

  test("overwrites an existing file (idempotent update)", () => {
    const outPath = path.join(tmpDir, "advisory-overwrite.json");
    appendAdvisoryRecord(makeValid(), outPath);

    const rec2 = makeAdvisoryRecord({
      id: "advisory-init-001-v2",
      recorded_at: "2026-06-14T00:00:00Z",
      phase: "planning",
      backend: "single_agent",
      question: "Updated question?",
      advisors: [],
      recommendations: [],
      synthesis: "Updated synthesis.",
      confidence: "low",
    });
    appendAdvisoryRecord(rec2, outPath);

    const parsed = JSON.parse(fs.readFileSync(outPath, "utf8")) as AdvisoryRecord;
    expect(parsed.id).toBe("advisory-init-001-v2");
    expect(parsed.phase).toBe("planning");
  });
});

// ── appendAdvisoryRecord — injectable fs seam (fail-closed) ──────────────────

describe("appendAdvisoryRecord — injectable fs seam", () => {
  test("returns { written:false, error } when fs.writeFile throws — no file persisted", () => {
    const fakeFs: AppendFsSeam = {
      mkdirp: () => { /* no-op */ },
      writeFile: () => { throw new Error("disk full"); },
      rename: () => { /* never reached */ },
      unlink: () => { /* cleanup no-op */ },
    };
    const result = appendAdvisoryRecord(makeValid(), "/fake/path/adv.json", fakeFs);
    expect(result.written).toBe(false);
    expect(result.error).toMatch(/disk full/);
  });

  test("returns { written:false, error } when fs.rename throws", () => {
    let tmpWritten = "";
    const fakeFs: AppendFsSeam = {
      mkdirp: () => { /* no-op */ },
      writeFile: (p) => { tmpWritten = p; },
      rename: () => { throw new Error("rename failed"); },
      unlink: (p) => { tmpWritten = "unlinked:" + p; }, // ensure cleanup runs
    };
    const result = appendAdvisoryRecord(makeValid(), "/fake/path/adv.json", fakeFs);
    expect(result.written).toBe(false);
    expect(result.error).toMatch(/rename failed/);
    // cleanup: unlink should have been attempted on the temp file
    expect(tmpWritten.startsWith("unlinked:")).toBe(true);
  });

  test("in-memory seam: verifies written content shape", () => {
    const store: Record<string, string> = {};
    const written: { src: string; dest: string } = { src: "", dest: "" };
    const fakeFs: AppendFsSeam = {
      mkdirp: () => { /* no-op */ },
      writeFile: (p, c) => { store[p] = c; },
      rename: (src, dest) => { store[dest] = store[src]; delete store[src]; written.src = src; written.dest = dest; },
      unlink: (p) => { delete store[p]; },
    };

    const rec = makeValid();
    const outPath = "/fake/advisory/adv-001.json";
    const result = appendAdvisoryRecord(rec, outPath, fakeFs);

    expect(result.written).toBe(true);
    expect(result.path).toBe(outPath);
    expect(store[outPath]).toBeDefined();

    const parsed = JSON.parse(store[outPath]) as AdvisoryRecord;
    expect(parsed.schema_version).toBe("guild.advisory.v1");
    expect(parsed.id).toBe("advisory-init-example-001");
    expect(parsed.confidence).toBe("high");

    // No temp file should remain in the store
    const keys = Object.keys(store);
    expect(keys.every((k) => !k.includes(".tmp-advisory-"))).toBe(true);
  });
});

// ── Edge and contract cases ───────────────────────────────────────────────────

describe("contract guarantees", () => {
  test("makeAdvisoryRecord is deterministic — same input produces same output", () => {
    const opts = {
      id: "adv-det",
      recorded_at: FIXED_TS,
      phase: "reflect",
      backend: "tmux_team" as const,
      question: "Is the outcome sound?",
      advisors: [{ role: "reviewer", model_tier: "mid" as const }],
      recommendations: [{ role: "reviewer", recommendation: "Yes.", confidence: "high" as const }],
      synthesis: "The outcome is sound.",
      confidence: "high" as const,
    };
    const r1 = makeAdvisoryRecord(opts);
    const r2 = makeAdvisoryRecord(opts);
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
  });

  test("validateAdvisoryRecord never throws — always returns {valid,errors}", () => {
    const inputs = [
      null, undefined, 0, "", [], {}, makeValid(),
      { schema_version: "guild.advisory.v1" },  // partial
      { ...makeValid(), advisors: [{ role: "", model_tier: "bad" }] },
    ];
    for (const inp of inputs) {
      let result: ReturnType<typeof validateAdvisoryRecord> | null = null;
      expect(() => { result = validateAdvisoryRecord(inp); }).not.toThrow();
      expect(typeof result?.valid).toBe("boolean");
      expect(Array.isArray(result?.errors)).toBe(true);
    }
  });

  test("appendAdvisoryRecord never throws — always returns AppendResult", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "advisory-nothrow-"));
    try {
      let result: ReturnType<typeof appendAdvisoryRecord> | null = null;
      expect(() => {
        result = appendAdvisoryRecord(makeValid(), path.join(tmpDir, "adv.json"));
      }).not.toThrow();
      expect(typeof result?.written).toBe("boolean");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("written JSON ends with a newline (serialization hygiene)", () => {
    const store: Record<string, string> = {};
    const fakeFs: AppendFsSeam = {
      mkdirp: () => { /* no-op */ },
      writeFile: (p, c) => { store[p] = c; },
      rename: (src, dest) => { store[dest] = store[src]; delete store[src]; },
      unlink: (p) => { delete store[p]; },
    };
    appendAdvisoryRecord(makeValid(), "/out/adv.json", fakeFs);
    expect(store["/out/adv.json"]).toMatch(/\n$/);
  });
});
