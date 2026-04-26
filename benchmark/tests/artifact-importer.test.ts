import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  importFixture,
  loadRunRecord,
  parseEventsNdjson,
  parseRunJson,
} from "../src/artifact-importer.js";

const FIXTURES = resolve(__dirname, "..", "fixtures");

const validRunJson = {
  schema_version: 1,
  run_id: "tmp-run",
  case_slug: "demo-url-shortener-build",
  plugin_ref: "abc1234",
  model_ref: { architect: "claude-opus-4-7" },
  started_at: "2026-04-26T05:30:00Z",
  completed_at: "2026-04-26T05:50:00Z",
  status: "pass" as const,
};

describe("artifact-importer / parseRunJson", () => {
  it("parses a valid run.json string", () => {
    const r = parseRunJson(JSON.stringify(validRunJson));
    expect(r.run_id).toBe("tmp-run");
    expect(r.status).toBe("pass");
  });

  it("throws on malformed JSON with the literal phrase 'not valid JSON'", () => {
    expect(() => parseRunJson("{not json")).toThrow(/not valid JSON/);
  });

  it("throws on schema violation listing the failing fields", () => {
    const bad = { ...validRunJson, status: "weird-status" };
    try {
      parseRunJson(JSON.stringify(bad));
      expect.fail("should throw");
    } catch (e) {
      expect((e as Error).message).toMatch(/failed schema validation/);
      expect((e as Error).message).toContain("status");
    }
  });

  it("rejects negative wall_clock_ms", () => {
    const bad = { ...validRunJson, wall_clock_ms: -1 };
    expect(() => parseRunJson(JSON.stringify(bad))).toThrow();
  });
});

describe("artifact-importer / parseEventsNdjson", () => {
  it("parses an empty file as an empty array", () => {
    expect(parseEventsNdjson("")).toEqual([]);
  });

  it("parses a single valid line", () => {
    const line = `{"ts":"2026-04-26T05:30:00Z","type":"stage_started","stage":"brainstorm"}`;
    const out = parseEventsNdjson(line);
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe("stage_started");
  });

  it("parses every event variant in the discriminated union", () => {
    const samples = [
      `{"ts":"t","type":"stage_started","stage":"a"}`,
      `{"ts":"t","type":"stage_completed","stage":"a","duration_ms":100}`,
      `{"ts":"t","type":"specialist_dispatched","specialist":"x","task_id":"T1"}`,
      `{"ts":"t","type":"specialist_completed","specialist":"x","task_id":"T1","status":"complete"}`,
      `{"ts":"t","type":"gate_passed","gate":"g"}`,
      `{"ts":"t","type":"gate_skipped","gate":"g","reason":"r"}`,
      `{"ts":"t","type":"tool_error","tool":"Bash","exit_code":1}`,
      `{"ts":"t","type":"acceptance_command","command":"npm test","exit_code":0}`,
      `{"ts":"t","type":"retry","what":"backend"}`,
    ];
    const out = parseEventsNdjson(samples.join("\n"));
    expect(out).toHaveLength(9);
  });

  it("skips blank lines (extra newlines, trailing newline)", () => {
    const raw =
      `\n{"ts":"t","type":"gate_passed","gate":"a"}\n\n{"ts":"t","type":"gate_passed","gate":"b"}\n`;
    expect(parseEventsNdjson(raw)).toHaveLength(2);
  });

  it("throws with line number on malformed JSON", () => {
    const raw =
      `{"ts":"t","type":"gate_passed","gate":"a"}\n{not json}`;
    expect(() => parseEventsNdjson(raw)).toThrow(/line 2/);
  });

  it("throws with line number on schema violation", () => {
    const raw =
      `{"ts":"t","type":"gate_passed","gate":"a"}\n{"ts":"t","type":"made_up_event"}`;
    expect(() => parseEventsNdjson(raw)).toThrow(/line 2/);
  });
});

describe("artifact-importer / importFixture", () => {
  let workDir: string;
  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), "import-fixture-"));
  });
  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it("imports synthetic-pass into a clean runs dir with partial=false", async () => {
    const result = await importFixture({
      fixturePath: join(FIXTURES, "synthetic-pass"),
      runsDir: workDir,
      runId: "synthetic-pass-001",
    });
    expect(result.partial).toBe(false);
    expect(result.missing_artifacts).toEqual([]);
    expect(existsSync(join(result.runDir, "run.json"))).toBe(true);
    expect(existsSync(join(result.runDir, "events.ndjson"))).toBe(true);
    expect(existsSync(join(result.runDir, "artifacts", ".guild"))).toBe(true);
  });

  it("imports synthetic-malformed (no events.ndjson, no .guild) with partial=true", async () => {
    const result = await importFixture({
      fixturePath: join(FIXTURES, "synthetic-malformed"),
      runsDir: workDir,
      runId: "synthetic-malformed-001",
    });
    expect(result.partial).toBe(true);
    expect(result.missing_artifacts).toContain("events.ndjson");
    expect(result.missing_artifacts).toContain("artifacts/.guild");
  });

  it("uses the run.json's run_id when none is passed in opts", async () => {
    const fix = join(workDir, "fixture");
    await mkdir(fix, { recursive: true });
    await writeFile(
      join(fix, "run.json"),
      JSON.stringify({ ...validRunJson, run_id: "from-file-id" }),
    );
    const out = await importFixture({ fixturePath: fix, runsDir: workDir });
    expect(out.runId).toBe("from-file-id");
  });

  it("throws when fixture path does not exist", async () => {
    await expect(
      importFixture({
        fixturePath: join(workDir, "does-not-exist"),
        runsDir: workDir,
      }),
    ).rejects.toThrow(/Fixture path does not exist/);
  });

  it("throws when run.json is missing in the fixture", async () => {
    const fix = join(workDir, "no-run-json");
    await mkdir(fix, { recursive: true });
    await expect(
      importFixture({ fixturePath: fix, runsDir: workDir }),
    ).rejects.toThrow(/missing run.json/);
  });
});

describe("artifact-importer / loadRunRecord", () => {
  let workDir: string;
  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), "load-run-record-"));
  });
  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it("loads a fully-populated record from synthetic-pass", async () => {
    const { runDir } = await importFixture({
      fixturePath: join(FIXTURES, "synthetic-pass"),
      runsDir: workDir,
      runId: "rec-pass",
    });
    const record = await loadRunRecord(runDir);
    expect(record.partial).toBe(false);
    expect(record.events.length).toBeGreaterThan(0);
    expect(record.receipts.length).toBe(4);
    expect(record.hasReview).toBe(true);
    expect(record.hasAssumptions).toBe(true);
    expect(record.hasReflection).toBe(true);
  });

  it("flags partial=true when events.ndjson is absent", async () => {
    const { runDir } = await importFixture({
      fixturePath: join(FIXTURES, "synthetic-malformed"),
      runsDir: workDir,
      runId: "rec-partial",
    });
    const record = await loadRunRecord(runDir);
    expect(record.partial).toBe(true);
    expect(record.events).toEqual([]);
    expect(record.missing_artifacts).toContain("events.ndjson");
  });

  it("throws when run.json is missing in the run directory", async () => {
    const empty = join(workDir, "empty");
    await mkdir(empty, { recursive: true });
    await expect(loadRunRecord(empty)).rejects.toThrow(/run.json not found/);
  });

  it("throws when events.ndjson contains an invalid line", async () => {
    const dir = join(workDir, "bad-events");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "run.json"), JSON.stringify(validRunJson));
    await writeFile(
      join(dir, "events.ndjson"),
      `{"ts":"t","type":"gate_passed","gate":"a"}\n{not json`,
    );
    await expect(loadRunRecord(dir)).rejects.toThrow(/line 2/);
  });

  it("treats an empty Evidence section as evidence_present=false", async () => {
    const dir = join(workDir, "evidence-empty");
    const handoffsDir = join(dir, "artifacts", ".guild", "runs", "x", "handoffs");
    await mkdir(handoffsDir, { recursive: true });
    await writeFile(join(dir, "run.json"), JSON.stringify(validRunJson));
    await writeFile(
      join(handoffsDir, "T1.md"),
      `---\ntask_id: T1\nspecialist: x\nstatus: complete\n---\n\n## Evidence\n(short)\n`,
    );
    const record = await loadRunRecord(dir);
    expect(record.receipts).toHaveLength(1);
    expect(record.receipts[0].evidence_present).toBe(false);
  });

  it("treats a long Evidence section (≥40 chars) as evidence_present=true", async () => {
    const dir = join(workDir, "evidence-long");
    const handoffsDir = join(dir, "artifacts", ".guild", "runs", "x", "handoffs");
    await mkdir(handoffsDir, { recursive: true });
    await writeFile(join(dir, "run.json"), JSON.stringify(validRunJson));
    await writeFile(
      join(handoffsDir, "T1.md"),
      `---\ntask_id: T1\nspecialist: x\nstatus: complete\n---\n\n## Evidence\n` +
        "- pinned by tests; coverage 87% line, 84% branch — clean exit codes.\n",
    );
    const record = await loadRunRecord(dir);
    expect(record.receipts[0].evidence_present).toBe(true);
    expect(record.receipts[0].evidence_chars).toBeGreaterThanOrEqual(40);
  });

  it("falls back to file-basename for task_id when frontmatter omits it", async () => {
    const dir = join(workDir, "no-frontmatter-id");
    const handoffsDir = join(dir, "artifacts", ".guild", "runs", "x", "handoffs");
    await mkdir(handoffsDir, { recursive: true });
    await writeFile(join(dir, "run.json"), JSON.stringify(validRunJson));
    await writeFile(
      join(handoffsDir, "T7-mystery.md"),
      `## Evidence\nthis receipt has no frontmatter at all but enough text here.\n`,
    );
    const record = await loadRunRecord(dir);
    expect(record.receipts[0].task_id).toBe("T7-mystery");
    expect(record.receipts[0].specialist).toBe("unknown");
  });

  it("treats an artifacts/.guild dir without runs/ as zero receipts", async () => {
    const dir = join(workDir, "guild-no-runs");
    await mkdir(join(dir, "artifacts", ".guild"), { recursive: true });
    await writeFile(join(dir, "run.json"), JSON.stringify(validRunJson));
    const record = await loadRunRecord(dir);
    expect(record.receipts).toEqual([]);
    expect(record.hasReview).toBe(false);
  });

  it("recognises reflection.md as a valid reflect artifact", async () => {
    const dir = join(workDir, "reflect-alt");
    const innerDir = join(dir, "artifacts", ".guild", "runs", "x");
    await mkdir(innerDir, { recursive: true });
    await writeFile(join(dir, "run.json"), JSON.stringify(validRunJson));
    await writeFile(join(innerDir, "reflection.md"), "## Reflection\nnotes\n");
    const record = await loadRunRecord(dir);
    expect(record.hasReflection).toBe(true);
  });

  it("does not count an empty review.md as hasReview=true", async () => {
    const dir = join(workDir, "empty-review");
    const innerDir = join(dir, "artifacts", ".guild", "runs", "x");
    await mkdir(innerDir, { recursive: true });
    await writeFile(join(dir, "run.json"), JSON.stringify(validRunJson));
    await writeFile(join(innerDir, "review.md"), "   \n  ");
    const record = await loadRunRecord(dir);
    expect(record.hasReview).toBe(false);
  });
});
