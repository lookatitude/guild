/**
 * scripts/__tests__/init-staging-gate.test.ts
 *
 * Init staging → promote gate (ITEM 2, v2.x).
 * Canonical contract: docs/v2/03-lifecycle.md §"Init staging → promotion"
 *
 * Coverage:
 *  - Closed enum constants are exactly as specified.
 *  - makeStagedCandidate builds a fully-typed candidate (schema_version set,
 *    all required fields present, defaults applied for optional fields).
 *  - validateStagedCandidate accepts a well-formed candidate.
 *  - validateStagedCandidate catches every violation class (bad schema_version,
 *    empty id, empty staged_at, bad type, empty title, non-string content,
 *    bad source, bad confidence, non-array evidence_refs, non-string
 *    proposed_destination, null/non-object input, multiple violations).
 *  - promoteGate happy path — invalid candidate → reject.
 *  - promoteGate happy path — opts.rejected=true → reject (takes precedence).
 *  - promoteGate happy path — opts.approved=true → promote.
 *  - promoteGate default (no opts) → hold.
 *  - promoteGate contract: rejected takes precedence over approved.
 *  - promoteGate contract: never auto-promotes on any truthy-but-not-true value.
 *  - promoteGate includes caller reason in result when supplied.
 *  - promoteGate never throws on any input.
 *  - listStaging reads valid candidates from a real temp dir.
 *  - listStaging skips malformed JSON files silently.
 *  - listStaging skips files that fail validation silently.
 *  - listStaging returns [] when the directory does not exist.
 *  - listStaging returns [] when the directory is empty.
 *  - Edge: validateStagedCandidate never throws.
 *  - Edge: makeStagedCandidate is deterministic.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import {
  INIT_STAGING_SCHEMA,
  STAGED_CANDIDATE_TYPES,
  STAGED_CONFIDENCE_LEVELS,
  STAGED_CANDIDATE_SOURCES,
  PROMOTE_DECISIONS,
  validateStagedCandidate,
  promoteGate,
  listStaging,
  makeStagedCandidate,
  type StagedCandidate,
  type PromoteGateResult,
} from "../lib/init-staging-gate";

// ── Fixture helpers ───────────────────────────────────────────────────────────

const FIXED_TS = "2026-06-13T12:00:00Z";

function makeValid(): StagedCandidate {
  return makeStagedCandidate({
    id: "init-candidate-arch-map-001",
    staged_at: FIXED_TS,
    type: "architecture_note",
    title: "Architecture Map — initial brownfield scan",
    content: "# Architecture Map\n\nThis is a synthesized architecture overview.",
    source: "brownfield_scan",
    confidence: "medium",
    produced_by: "guild:init",
    evidence_refs: [".guild/indexes/codebase-map.json"],
    proposed_destination: ".guild/wiki/context/architecture-map.md",
  });
}

// ── Closed enum constants ─────────────────────────────────────────────────────

test("INIT_STAGING_SCHEMA is the frozen contract string", () => {
  expect(INIT_STAGING_SCHEMA).toBe("guild.init_staging_candidate.v1");
});

test("STAGED_CANDIDATE_TYPES closed enum", () => {
  expect([...STAGED_CANDIDATE_TYPES]).toEqual([
    "wiki_page",
    "architecture_note",
    "decision_candidate",
    "codebase_fact",
    "standard_candidate",
  ]);
});

test("STAGED_CONFIDENCE_LEVELS closed enum", () => {
  expect([...STAGED_CONFIDENCE_LEVELS]).toEqual(["high", "medium", "low"]);
});

test("STAGED_CANDIDATE_SOURCES closed enum", () => {
  expect([...STAGED_CANDIDATE_SOURCES]).toEqual([
    "brownfield_scan",
    "greenfield_interview",
    "agent_synthesis",
    "manual",
  ]);
});

test("PROMOTE_DECISIONS closed enum", () => {
  expect([...PROMOTE_DECISIONS]).toEqual(["promote", "hold", "reject"]);
});

// ── makeStagedCandidate ───────────────────────────────────────────────────────

describe("makeStagedCandidate", () => {
  test("sets schema_version and all required fields", () => {
    const c = makeValid();
    expect(c.schema_version).toBe("guild.init_staging_candidate.v1");
    expect(c.id).toBe("init-candidate-arch-map-001");
    expect(c.staged_at).toBe(FIXED_TS);
    expect(c.type).toBe("architecture_note");
    expect(c.title).toBe("Architecture Map — initial brownfield scan");
    expect(c.source).toBe("brownfield_scan");
    expect(c.confidence).toBe("medium");
    expect(c.produced_by).toBe("guild:init");
  });

  test("defaults produced_by to empty string when absent", () => {
    const c = makeStagedCandidate({
      id: "c-001",
      staged_at: FIXED_TS,
      type: "wiki_page",
      title: "T",
      content: "",
      source: "manual",
      confidence: "low",
    });
    expect(c.produced_by).toBe("");
  });

  test("defaults evidence_refs to [] when absent", () => {
    const c = makeStagedCandidate({
      id: "c-002",
      staged_at: FIXED_TS,
      type: "codebase_fact",
      title: "T",
      content: "",
      source: "agent_synthesis",
      confidence: "high",
    });
    expect(c.evidence_refs).toEqual([]);
  });

  test("defaults proposed_destination to empty string when absent", () => {
    const c = makeStagedCandidate({
      id: "c-003",
      staged_at: FIXED_TS,
      type: "standard_candidate",
      title: "T",
      content: "",
      source: "greenfield_interview",
      confidence: "medium",
    });
    expect(c.proposed_destination).toBe("");
  });

  test("does not mutate caller evidence_refs array", () => {
    const refs = ["ref-1"];
    const c = makeStagedCandidate({
      id: "c-004",
      staged_at: FIXED_TS,
      type: "decision_candidate",
      title: "T",
      content: "",
      source: "brownfield_scan",
      confidence: "medium",
      evidence_refs: refs,
    });
    refs.push("ref-2");
    expect(c.evidence_refs).toHaveLength(1);
  });

  test("is deterministic — same input produces same output", () => {
    const opts = {
      id: "c-det",
      staged_at: FIXED_TS,
      type: "wiki_page" as const,
      title: "Title",
      content: "Content",
      source: "manual" as const,
      confidence: "high" as const,
      produced_by: "test",
      evidence_refs: ["ref-a"],
      proposed_destination: ".guild/wiki/concepts/title.md",
    };
    const c1 = makeStagedCandidate(opts);
    const c2 = makeStagedCandidate(opts);
    expect(JSON.stringify(c1)).toBe(JSON.stringify(c2));
  });
});

// ── validateStagedCandidate — happy path ──────────────────────────────────────

describe("validateStagedCandidate — happy path", () => {
  test("accepts a fully well-formed candidate", () => {
    const { valid, errors } = validateStagedCandidate(makeValid());
    expect(valid).toBe(true);
    expect(errors).toEqual([]);
  });

  test("accepts a minimal valid candidate (empty strings for optional fields)", () => {
    const c = makeStagedCandidate({
      id: "min-001",
      staged_at: FIXED_TS,
      type: "wiki_page",
      title: "Minimal candidate",
      content: "",
      source: "manual",
      confidence: "low",
    });
    const { valid } = validateStagedCandidate(c);
    expect(valid).toBe(true);
  });
});

// ── validateStagedCandidate — violations ──────────────────────────────────────

describe("validateStagedCandidate — required field violations", () => {
  test("null input → invalid (non-object)", () => {
    const { valid, errors } = validateStagedCandidate(null);
    expect(valid).toBe(false);
    expect(errors.length).toBeGreaterThan(0);
  });

  test("string input → invalid", () => {
    expect(validateStagedCandidate("string").valid).toBe(false);
  });

  test("array input → invalid", () => {
    expect(validateStagedCandidate([]).valid).toBe(false);
  });

  test("wrong schema_version → error mentions schema_version", () => {
    const { valid, errors } = validateStagedCandidate({
      ...makeValid(),
      schema_version: "guild.init_staging_candidate.v2",
    });
    expect(valid).toBe(false);
    expect(errors.join(" ")).toMatch(/schema_version/);
  });

  test("empty id → error mentions id", () => {
    const { valid, errors } = validateStagedCandidate({ ...makeValid(), id: "" });
    expect(valid).toBe(false);
    expect(errors.join(" ")).toMatch(/id/);
  });

  test("empty staged_at → error mentions staged_at", () => {
    const { valid, errors } = validateStagedCandidate({ ...makeValid(), staged_at: "" });
    expect(valid).toBe(false);
    expect(errors.join(" ")).toMatch(/staged_at/);
  });

  test("unknown type → error mentions type", () => {
    const { valid, errors } = validateStagedCandidate({ ...makeValid(), type: "unknown_type" });
    expect(valid).toBe(false);
    expect(errors.join(" ")).toMatch(/type/);
  });

  test("empty title → error mentions title", () => {
    const { valid, errors } = validateStagedCandidate({ ...makeValid(), title: "" });
    expect(valid).toBe(false);
    expect(errors.join(" ")).toMatch(/title/);
  });

  test("non-string content → error mentions content", () => {
    const { valid, errors } = validateStagedCandidate({ ...makeValid(), content: 42 });
    expect(valid).toBe(false);
    expect(errors.join(" ")).toMatch(/content/);
  });

  test("unknown source → error mentions source", () => {
    const { valid, errors } = validateStagedCandidate({ ...makeValid(), source: "llm_magic" });
    expect(valid).toBe(false);
    expect(errors.join(" ")).toMatch(/source/);
  });

  test("unknown confidence → error mentions confidence", () => {
    const { valid, errors } = validateStagedCandidate({ ...makeValid(), confidence: "very-high" });
    expect(valid).toBe(false);
    expect(errors.join(" ")).toMatch(/confidence/);
  });

  test("evidence_refs not an array → error mentions evidence_refs", () => {
    const { valid, errors } = validateStagedCandidate({ ...makeValid(), evidence_refs: "not-array" });
    expect(valid).toBe(false);
    expect(errors.join(" ")).toMatch(/evidence_refs/);
  });

  test("proposed_destination not a string → error mentions proposed_destination", () => {
    const { valid, errors } = validateStagedCandidate({ ...makeValid(), proposed_destination: 99 });
    expect(valid).toBe(false);
    expect(errors.join(" ")).toMatch(/proposed_destination/);
  });

  test("multiple violations reported together", () => {
    const { valid, errors } = validateStagedCandidate({
      schema_version: "wrong",
      id: "",
      staged_at: "",
      type: "bad_type",
    });
    expect(valid).toBe(false);
    expect(errors.length).toBeGreaterThanOrEqual(3);
  });

  test("never throws on arbitrary input", () => {
    const inputs: unknown[] = [
      null, undefined, 0, "", [], {}, makeValid(),
      { schema_version: INIT_STAGING_SCHEMA },
      { ...makeValid(), evidence_refs: null },
    ];
    for (const inp of inputs) {
      let result: ReturnType<typeof validateStagedCandidate> | null = null;
      expect(() => { result = validateStagedCandidate(inp); }).not.toThrow();
      expect(typeof result?.valid).toBe("boolean");
      expect(Array.isArray(result?.errors)).toBe(true);
    }
  });
});

// ── promoteGate — happy path ──────────────────────────────────────────────────

describe("promoteGate — happy path", () => {
  test("valid candidate + approved:true → promote", () => {
    const result = promoteGate(makeValid(), { approved: true });
    expect(result.decision).toBe("promote");
    expect(typeof result.reason).toBe("string");
    expect(result.reason.length).toBeGreaterThan(0);
  });

  test("valid candidate + no opts → hold (default)", () => {
    const result = promoteGate(makeValid());
    expect(result.decision).toBe("hold");
  });

  test("valid candidate + empty opts → hold", () => {
    const result = promoteGate(makeValid(), {});
    expect(result.decision).toBe("hold");
  });

  test("valid candidate + rejected:true → reject", () => {
    const result = promoteGate(makeValid(), { rejected: true });
    expect(result.decision).toBe("reject");
  });

  test("invalid candidate → reject (cannot promote malformed candidate)", () => {
    const result = promoteGate({ id: "", schema_version: "wrong" });
    expect(result.decision).toBe("reject");
    expect(result.reason).toMatch(/failed validation/);
  });
});

// ── promoteGate — contract guarantees ────────────────────────────────────────

describe("promoteGate — contract guarantees (candidates-only invariant)", () => {
  test("rejected takes precedence over approved when both are true", () => {
    const result = promoteGate(makeValid(), { approved: true, rejected: true });
    expect(result.decision).toBe("reject");
  });

  test("approved:false → hold (not promote)", () => {
    const result = promoteGate(makeValid(), { approved: false });
    expect(result.decision).toBe("hold");
  });

  test("approved:undefined → hold (not promote)", () => {
    const result = promoteGate(makeValid(), { approved: undefined });
    expect(result.decision).toBe("hold");
  });

  test("hold reason explains that --auto-approve never skips this gate", () => {
    const result = promoteGate(makeValid());
    expect(result.reason).toMatch(/auto-approve/i);
  });

  test("caller-supplied reason is included in result", () => {
    const result = promoteGate(makeValid(), { approved: true, reason: "LGTM — architecture map is accurate" });
    expect(result.reason).toBe("LGTM — architecture map is accurate");
  });

  test("rejected with caller reason includes that reason", () => {
    const result = promoteGate(makeValid(), { rejected: true, reason: "content is speculative, needs human review" });
    expect(result.decision).toBe("reject");
    expect(result.reason).toBe("content is speculative, needs human review");
  });

  test("never throws on any input", () => {
    const inputs: Array<[unknown, Parameters<typeof promoteGate>[1]]> = [
      [null, {}],
      [undefined, { approved: true }],
      [makeValid(), { approved: true, rejected: true }],
      [{}, undefined],
      [makeValid(), {}],
      ["string", { approved: true }],
    ];
    for (const [candidate, opts] of inputs) {
      let result: PromoteGateResult | null = null;
      expect(() => { result = promoteGate(candidate, opts); }).not.toThrow();
      expect(typeof result?.decision).toBe("string");
      expect(PROMOTE_DECISIONS).toContain(result?.decision as string);
    }
  });

  test("decision is always a member of PROMOTE_DECISIONS enum", () => {
    const results = [
      promoteGate(makeValid()),
      promoteGate(makeValid(), { approved: true }),
      promoteGate(makeValid(), { rejected: true }),
      promoteGate(null),
    ];
    for (const r of results) {
      expect(PROMOTE_DECISIONS).toContain(r.decision);
    }
  });
});

// ── listStaging — real fs (temp dirs) ────────────────────────────────────────

describe("listStaging — real fs", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "init-staging-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("returns [] when directory does not exist", () => {
    const result = listStaging(path.join(tmpDir, "nonexistent", "staging"));
    expect(result).toEqual([]);
  });

  test("returns [] when directory is empty", () => {
    const stagingDir = path.join(tmpDir, "staging");
    fs.mkdirSync(stagingDir, { recursive: true });
    expect(listStaging(stagingDir)).toEqual([]);
  });

  test("reads valid candidates from staging dir", () => {
    const stagingDir = path.join(tmpDir, ".guild", "init", "staging");
    fs.mkdirSync(stagingDir, { recursive: true });

    const c = makeValid();
    fs.writeFileSync(
      path.join(stagingDir, "candidate-001.json"),
      JSON.stringify(c) + "\n",
      "utf8",
    );

    const result = listStaging(stagingDir);
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe("init-candidate-arch-map-001");
    expect(result[0]?.schema_version).toBe(INIT_STAGING_SCHEMA);
  });

  test("reads multiple valid candidates", () => {
    const stagingDir = path.join(tmpDir, "staging");
    fs.mkdirSync(stagingDir, { recursive: true });

    const c1 = makeStagedCandidate({
      id: "cand-001",
      staged_at: FIXED_TS,
      type: "wiki_page",
      title: "Page 1",
      content: "body 1",
      source: "manual",
      confidence: "high",
    });
    const c2 = makeStagedCandidate({
      id: "cand-002",
      staged_at: FIXED_TS,
      type: "decision_candidate",
      title: "Decision 2",
      content: "body 2",
      source: "agent_synthesis",
      confidence: "medium",
    });

    fs.writeFileSync(path.join(stagingDir, "c1.json"), JSON.stringify(c1), "utf8");
    fs.writeFileSync(path.join(stagingDir, "c2.json"), JSON.stringify(c2), "utf8");

    const result = listStaging(stagingDir);
    expect(result).toHaveLength(2);
    const ids = result.map((r) => r.id).sort();
    expect(ids).toEqual(["cand-001", "cand-002"]);
  });

  test("skips malformed JSON files silently", () => {
    const stagingDir = path.join(tmpDir, "staging");
    fs.mkdirSync(stagingDir, { recursive: true });

    fs.writeFileSync(path.join(stagingDir, "broken.json"), "{ NOT VALID JSON !!!", "utf8");
    const c = makeValid();
    fs.writeFileSync(path.join(stagingDir, "valid.json"), JSON.stringify(c), "utf8");

    const result = listStaging(stagingDir);
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe(c.id);
  });

  test("skips files that fail validation silently", () => {
    const stagingDir = path.join(tmpDir, "staging");
    fs.mkdirSync(stagingDir, { recursive: true });

    // Valid JSON but wrong schema
    const bad = { id: "bad", schema_version: "wrong", title: "" };
    fs.writeFileSync(path.join(stagingDir, "bad-schema.json"), JSON.stringify(bad), "utf8");

    const c = makeValid();
    fs.writeFileSync(path.join(stagingDir, "valid.json"), JSON.stringify(c), "utf8");

    const result = listStaging(stagingDir);
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe(c.id);
  });

  test("ignores non-.json files", () => {
    const stagingDir = path.join(tmpDir, "staging");
    fs.mkdirSync(stagingDir, { recursive: true });

    fs.writeFileSync(path.join(stagingDir, "README.md"), "# readme", "utf8");
    fs.writeFileSync(path.join(stagingDir, "notes.txt"), "some notes", "utf8");

    const result = listStaging(stagingDir);
    expect(result).toEqual([]);
  });
});

// ── Edge and integration cases ────────────────────────────────────────────────

describe("edge cases", () => {
  test("a candidate that passes validate can be round-tripped through JSON", () => {
    const c = makeValid();
    const { valid } = validateStagedCandidate(c);
    expect(valid).toBe(true);

    const parsed = JSON.parse(JSON.stringify(c)) as StagedCandidate;
    const { valid: valid2 } = validateStagedCandidate(parsed);
    expect(valid2).toBe(true);
    expect(parsed.id).toBe(c.id);
    expect(parsed.schema_version).toBe(INIT_STAGING_SCHEMA);
  });

  test("promoteGate on a hold → promoteGate on the same with approved:true → promote (two-step gate)", () => {
    const c = makeValid();

    const held = promoteGate(c, {});
    expect(held.decision).toBe("hold");

    // Simulating human approval at the gate
    const promoted = promoteGate(c, { approved: true });
    expect(promoted.decision).toBe("promote");
  });

  test("empty staging dir write and re-read round-trip", () => {
    const tmpDir2 = fs.mkdtempSync(path.join(os.tmpdir(), "init-staging-rtrip-"));
    try {
      const stagingDir = path.join(tmpDir2, ".guild", "init", "staging");
      fs.mkdirSync(stagingDir, { recursive: true });

      const c = makeStagedCandidate({
        id: "rtrip-001",
        staged_at: FIXED_TS,
        type: "codebase_fact",
        title: "Key service boundary",
        content: "The payment service owns the ledger.",
        source: "brownfield_scan",
        confidence: "high",
        evidence_refs: [".guild/indexes/codebase-map.json", "src/payment/index.ts"],
        produced_by: "guild:init",
        proposed_destination: ".guild/wiki/context/payment-service.md",
      });

      fs.writeFileSync(path.join(stagingDir, "rtrip-001.json"), JSON.stringify(c), "utf8");

      const candidates = listStaging(stagingDir);
      expect(candidates).toHaveLength(1);
      const loaded = candidates[0]!;
      expect(loaded.id).toBe("rtrip-001");
      expect(loaded.evidence_refs).toEqual([
        ".guild/indexes/codebase-map.json",
        "src/payment/index.ts",
      ]);
      expect(loaded.proposed_destination).toBe(".guild/wiki/context/payment-service.md");

      // Gate check on the loaded candidate
      const gateResult = promoteGate(loaded, { approved: true });
      expect(gateResult.decision).toBe("promote");
    } finally {
      fs.rmSync(tmpDir2, { recursive: true, force: true });
    }
  });
});
