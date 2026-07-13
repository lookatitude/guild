/**
 * scripts/__tests__/run-events.test.ts
 *
 * TDD for scripts/lib/run-events.ts — the shared canonical-first/legacy-
 * fallback run-event reader (audit: plugin-implementation-audit-2026-07-12).
 *
 * Fixtures use the REAL shapes found in a live .guild/runs/<id>/ tree:
 *   - canonical logs/v1.4-events.jsonl mixes hook-mirror lines
 *     ({ts, event, tool, specialist, ok, ms, payload_digest, ...}) with
 *     guild.trace_event.v1 lines ({schema_version, event_id, event_name, at})
 *     that carry no `event`/`ts` field — same discipline as the v1.4-log-
 *     validator fixtures.
 *   - legacy events.ndjson is hook-mirror-only.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  loadRunEvents,
  parseRunEventsJsonl,
  resolveRunEventsFile,
  CANONICAL_EVENTS_RELPATH,
  LEGACY_EVENTS_RELPATH,
} from "../lib/run-events";

const CANONICAL_FIXTURE_LINES = [
  '{"ts":"2026-06-25T06:53:59.382Z","event":"UserPromptSubmit","tool":"","specialist":"","payload_digest":"afcd16c48239","ok":true,"ms":0,"prompt":"do the thing","span_id":"7af4b476997b2684","payload_ref":"logs/payloads/7af4b476997b2684.json"}',
  '{"ts":"2026-06-25T06:54:02.596Z","event":"PostToolUse","tool":"Read","specialist":"backend","payload_digest":"c23da2cf6541","ok":true,"ms":3,"span_id":"916ad58ed51314a4","payload_ref":"logs/payloads/916ad58ed51314a4.json"}',
  // guild.trace_event.v1 shape — no `event`/`ts` field (real shape from a live run dir).
  '{"schema_version":"guild.trace_event.v1","event_id":"evt-77697292-2b96-4615-bdcc-da08a003472d","event_name":"run_started","run_id":"run-2026-06-15T03-14-57-320Z","at":"2026-06-15T03:24:09.673Z"}',
  '{"ts":"2026-06-25T06:54:10.000Z","event":"SubagentStop","tool":"","specialist":"backend","payload_digest":"d001","ok":true,"ms":4500}',
];

const LEGACY_FIXTURE_LINES = [
  '{"ts":"2026-04-01T09:00:00.000Z","event":"UserPromptSubmit","tool":"","specialist":"","payload_digest":"u001","ok":true,"ms":0,"prompt":"legacy prompt"}',
  '{"ts":"2026-04-01T09:00:05.000Z","event":"PostToolUse","tool":"Read","specialist":"main","payload_digest":"r001","ok":true,"ms":120}',
];

function writeRunDir(
  tmpDir: string,
  runId: string,
  opts: { canonical?: string[]; legacy?: string[] },
): string {
  const runDir = path.join(tmpDir, ".guild", "runs", runId);
  if (opts.canonical) {
    const logsDir = path.join(runDir, "logs");
    fs.mkdirSync(logsDir, { recursive: true });
    fs.writeFileSync(
      path.join(logsDir, "v1.4-events.jsonl"),
      opts.canonical.join("\n") + "\n",
      "utf8",
    );
  }
  if (opts.legacy) {
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(path.join(runDir, "events.ndjson"), opts.legacy.join("\n") + "\n", "utf8");
  }
  if (!opts.canonical && !opts.legacy) {
    fs.mkdirSync(runDir, { recursive: true });
  }
  return runDir;
}

describe("run-events.ts — resolveRunEventsFile", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-run-events-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("resolves canonical when only canonical exists", () => {
    const runDir = writeRunDir(tmpDir, "r1", { canonical: CANONICAL_FIXTURE_LINES });
    const { filePath, source } = resolveRunEventsFile(runDir);
    expect(source).toBe("canonical");
    expect(filePath).toBe(path.join(runDir, CANONICAL_EVENTS_RELPATH));
  });

  it("resolves legacy when only legacy exists", () => {
    const runDir = writeRunDir(tmpDir, "r2", { legacy: LEGACY_FIXTURE_LINES });
    const { filePath, source } = resolveRunEventsFile(runDir);
    expect(source).toBe("legacy");
    expect(filePath).toBe(path.join(runDir, LEGACY_EVENTS_RELPATH));
  });

  it("prefers canonical over legacy when both exist", () => {
    const runDir = writeRunDir(tmpDir, "r3", {
      canonical: CANONICAL_FIXTURE_LINES,
      legacy: LEGACY_FIXTURE_LINES,
    });
    const { source } = resolveRunEventsFile(runDir);
    expect(source).toBe("canonical");
  });

  it("returns source none when neither file exists", () => {
    const runDir = writeRunDir(tmpDir, "r4", {});
    const { source, filePath } = resolveRunEventsFile(runDir);
    expect(source).toBe("none");
    expect(filePath).toBe(path.join(runDir, CANONICAL_EVENTS_RELPATH));
  });
});

describe("run-events.ts — parseRunEventsJsonl", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-run-events-parse-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("parses every well-formed line, including the guild.trace_event.v1 shape", () => {
    const filePath = path.join(tmpDir, "events.jsonl");
    fs.writeFileSync(filePath, CANONICAL_FIXTURE_LINES.join("\n") + "\n", "utf8");
    const { events, parseErrors } = parseRunEventsJsonl(filePath);
    expect(events).toHaveLength(4);
    expect(parseErrors).toBe(0);
    // The guild.trace_event.v1 line has no `event`/`ts` field, per real shape.
    expect(events[2].event).toBeUndefined();
    expect(events[2].schema_version).toBe("guild.trace_event.v1");
  });

  it("skips malformed lines and counts them", () => {
    const filePath = path.join(tmpDir, "events.jsonl");
    fs.writeFileSync(
      filePath,
      [CANONICAL_FIXTURE_LINES[0], "not json", CANONICAL_FIXTURE_LINES[1]].join("\n") + "\n",
      "utf8",
    );
    const { events, parseErrors } = parseRunEventsJsonl(filePath);
    expect(events).toHaveLength(2);
    expect(parseErrors).toBe(1);
  });

  it("returns empty result for a missing file (never throws)", () => {
    const { events, parseErrors } = parseRunEventsJsonl(path.join(tmpDir, "nope.jsonl"));
    expect(events).toEqual([]);
    expect(parseErrors).toBe(0);
  });
});

describe("run-events.ts — loadRunEvents", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-run-events-load-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("loads canonical events when present", () => {
    const runDir = writeRunDir(tmpDir, "r1", { canonical: CANONICAL_FIXTURE_LINES });
    const result = loadRunEvents(runDir);
    expect(result.source).toBe("canonical");
    expect(result.events).toHaveLength(4);
    expect(result.parseErrors).toBe(0);
  });

  it("falls back to legacy events.ndjson when canonical is absent", () => {
    const runDir = writeRunDir(tmpDir, "r2", { legacy: LEGACY_FIXTURE_LINES });
    const result = loadRunEvents(runDir);
    expect(result.source).toBe("legacy");
    expect(result.events).toHaveLength(2);
  });

  it("returns empty events + source none for a run dir with neither file", () => {
    const runDir = writeRunDir(tmpDir, "r3", {});
    const result = loadRunEvents(runDir);
    expect(result.source).toBe("none");
    expect(result.events).toEqual([]);
    expect(result.parseErrors).toBe(0);
  });

  it("never throws for a wholly nonexistent run dir", () => {
    const runDir = path.join(tmpDir, ".guild", "runs", "does-not-exist");
    expect(() => loadRunEvents(runDir)).not.toThrow();
    expect(loadRunEvents(runDir).source).toBe("none");
  });
});
