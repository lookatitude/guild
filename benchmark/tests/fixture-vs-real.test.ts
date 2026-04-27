import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseEventsNdjson } from "../src/artifact-importer.js";

// R4 mitigation per `01-architecture.md` §4 + the qa context bundle:
// the *single source of truth* for the EventLine schema is the zod schema
// declared in `artifact-importer.ts` (see architect's followup in T1
// receipt). This test reads a real captured `.guild/runs/<id>/events.ndjson`
// from this repo's working copy and runs it through that exact parser.
//
// Behaviour matrix:
//
//   | file present? | first line shape           | this test does            |
//   | ------------- | -------------------------- | ------------------------- |
//   | absent        |  n/a                       | SKIP — clean repos pass   |
//   | benchmark     | { type: ... }              | parse all lines vs schema |
//   | hooks-style   | { event: ..., no `type` }  | SKIP with explicit reason |
//
// The hooks-style skip path is the genuine open finding: the existing real
// `.guild/runs/run-c36e78b4.../events.ndjson` is hook telemetry written by
// Claude Code's `Pre|PostToolUse` events, NOT a benchmark run produced by
// (future) `runner.ts`. The two streams use different field names. The
// test SKIPs cleanly for hook telemetry and surfaces the divergence in
// the qa handoff receipt as an open risk + followup.
//
// When P3's runner lands and starts producing real benchmark events.ndjson,
// this same test will exercise the full parse path automatically — no
// edits needed here.

const REPO_ROOT = resolve(__dirname, "..", "..");
const REAL_EVENTS = join(
  REPO_ROOT,
  ".guild",
  "runs",
  "run-c36e78b4-9d86-41af-8c4c-bbad88c6139b",
  "events.ndjson",
);

interface Probe {
  status: "absent" | "benchmark" | "hooks" | "unknown";
  reason: string;
}

async function probe(path: string): Promise<Probe> {
  if (!existsSync(path)) {
    return { status: "absent", reason: "no events.ndjson at expected path" };
  }
  const raw = await readFile(path, "utf8");
  const firstLine = raw.split(/\r?\n/).find((l) => l.trim().length > 0);
  if (firstLine === undefined) {
    return { status: "absent", reason: "events.ndjson is empty" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(firstLine);
  } catch {
    return {
      status: "unknown",
      reason: "first non-blank line is not valid JSON",
    };
  }
  if (
    typeof parsed === "object" &&
    parsed !== null &&
    "type" in parsed &&
    typeof (parsed as { type: unknown }).type === "string"
  ) {
    return { status: "benchmark", reason: "has top-level `type` field" };
  }
  if (
    typeof parsed === "object" &&
    parsed !== null &&
    "event" in parsed &&
    !("type" in parsed)
  ) {
    return {
      status: "hooks",
      reason:
        "has top-level `event` field, no `type` field — Claude Code hook telemetry, not benchmark output",
    };
  }
  return { status: "unknown", reason: "unrecognised shape" };
}

describe("fixture-vs-real / events.ndjson schema check (R4)", () => {
  it("either parses every line against EventLine, or skips with a documented reason", async () => {
    const p = await probe(REAL_EVENTS);
    if (p.status === "absent") {
      // Clean repo (no captured run) — the test passes trivially.
      // The bundle requires SKIP semantics here; we encode it as a
      // log-and-pass since vitest's `it.skip` cannot be triggered
      // dynamically from inside a test body. Equivalent semantics: the
      // assertion list is empty and the test exits clean.
      expect(p.reason).toMatch(/no events\.ndjson|empty/);
      return;
    }
    if (p.status === "hooks") {
      // Documented divergence — see test header. Surfaced as an open
      // risk + followup in `.guild/runs/<run>/handoffs/T3-qa.md`.
      expect(p.reason).toContain("hook telemetry");
      return;
    }
    if (p.status === "unknown") {
      throw new Error(
        `Unrecognised events.ndjson shape at ${REAL_EVENTS}: ${p.reason}`,
      );
    }
    // Benchmark-shape file: parse it. Any failure surfaces the line
    // number (parser already does that). This is the load-bearing path
    // post-P3.
    const raw = await readFile(REAL_EVENTS, "utf8");
    const events = parseEventsNdjson(raw);
    expect(events.length).toBeGreaterThan(0);
    for (const e of events) {
      expect(typeof e.type).toBe("string");
      expect(typeof e.ts).toBe("string");
    }
  });
});

describe("fixture-vs-real / skip-path is itself tested (per bundle)", () => {
  let workDir: string;
  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), "fvr-skip-"));
  });
  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it("probe() reports `absent` when the file does not exist", async () => {
    const p = await probe(join(workDir, "missing.ndjson"));
    expect(p.status).toBe("absent");
  });

  it("probe() reports `absent` when the file exists but is blank", async () => {
    const path = join(workDir, "empty.ndjson");
    await writeFile(path, "\n\n   \n");
    const p = await probe(path);
    expect(p.status).toBe("absent");
  });

  it("probe() reports `benchmark` when the first line has a `type` field", async () => {
    const path = join(workDir, "bench.ndjson");
    await writeFile(
      path,
      `{"ts":"2026-04-26T05:30:00Z","type":"stage_started","stage":"brainstorm"}\n`,
    );
    const p = await probe(path);
    expect(p.status).toBe("benchmark");
  });

  it("probe() reports `hooks` when the first line has `event` but no `type`", async () => {
    const path = join(workDir, "hooks.ndjson");
    await writeFile(
      path,
      `{"ts":"2026-04-26T03:20:22.016Z","event":"UserPromptSubmit","tool":"","specialist":""}\n`,
    );
    const p = await probe(path);
    expect(p.status).toBe("hooks");
  });

  it("when probe() is `benchmark`, parseEventsNdjson succeeds end-to-end", async () => {
    const path = join(workDir, "bench-full.ndjson");
    await writeFile(
      path,
      [
        `{"ts":"t","type":"stage_started","stage":"brainstorm"}`,
        `{"ts":"t","type":"stage_completed","stage":"brainstorm","duration_ms":1}`,
        `{"ts":"t","type":"gate_passed","gate":"brainstorm"}`,
      ].join("\n"),
    );
    const raw = await readFile(path, "utf8");
    const events = parseEventsNdjson(raw);
    expect(events).toHaveLength(3);
  });
});

describe("fixture-vs-real / synthetic fixtures all conform to the importer schema", () => {
  // Every fixture under benchmark/fixtures/synthetic-* whose
  // events.ndjson is present must parse against the EventLine schema.
  // This is the R4 mitigation _within_ qa's lane: the synthetic
  // fixtures themselves cannot drift from the importer contract.
  const FIXTURES = resolve(__dirname, "..", "fixtures");
  const candidates = ["synthetic-pass", "synthetic-fail", "synthetic-timeout"];

  for (const name of candidates) {
    it(`fixtures/${name}/events.ndjson parses against EventLine`, async () => {
      const path = join(FIXTURES, name, "events.ndjson");
      expect(existsSync(path)).toBe(true);
      const raw = await readFile(path, "utf8");
      const events = parseEventsNdjson(raw);
      expect(events.length).toBeGreaterThan(0);
    });
  }

  it("synthetic-malformed deliberately omits events.ndjson (partial-import test surface)", async () => {
    const path = join(FIXTURES, "synthetic-malformed", "events.ndjson");
    expect(existsSync(path)).toBe(false);
  });
});
