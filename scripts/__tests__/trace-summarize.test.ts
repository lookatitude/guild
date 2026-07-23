/**
 * scripts/__tests__/trace-summarize.test.ts
 *
 * TDD: written before trace-summarize.ts implementation.
 * Spawns the script with a temp run dir, verifies:
 *  - Happy path: correct counts, specialists, ok_rate, sections present
 *  - Empty: minimal summary without crash
 *  - Malformed: valid lines parsed, invalid lines skipped, exit 0
 *  - CLI errors: missing --run-id → exit 1, missing events file → exit 1
 */

import { spawnSync } from "child_process";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";

const SCRIPT = path.resolve(__dirname, "../trace-summarize.ts");
const FIXTURES = path.resolve(__dirname, "../fixtures");

function runScript(
  args: string[],
  env: Record<string, string> = {}
): { exitCode: number; stdout: string; stderr: string } {
  const result = spawnSync("npx", ["tsx", SCRIPT, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env },
    timeout: 120_000,
  });
  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function makeRunDir(tmpDir: string, runId: string, fixtureFile: string): string {
  const runDir = path.join(tmpDir, ".guild", "runs", runId);
  fs.mkdirSync(runDir, { recursive: true });
  const src = path.join(FIXTURES, fixtureFile);
  const dst = path.join(runDir, "events.ndjson");
  fs.copyFileSync(src, dst);
  return runDir;
}

/** Seeds the CANONICAL v1.4 event log (logs/v1.4-events.jsonl) instead of the
 *  legacy mirror — proves the canonical-first read path (scripts/lib/run-events.ts). */
function makeCanonicalRunDir(tmpDir: string, runId: string, fixtureFile: string): string {
  const runDir = path.join(tmpDir, ".guild", "runs", runId);
  const logsDir = path.join(runDir, "logs");
  fs.mkdirSync(logsDir, { recursive: true });
  const src = path.join(FIXTURES, fixtureFile);
  const dst = path.join(logsDir, "v1.4-events.jsonl");
  fs.copyFileSync(src, dst);
  return runDir;
}

describe("trace-summarize.ts", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-summarize-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ─────────────────────────────────────────────────────────────
  // Happy path
  // ─────────────────────────────────────────────────────────────
  describe("happy path — events-happy.ndjson", () => {
    it("exits 0", () => {
      makeRunDir(tmpDir, "test-run", "events-happy.ndjson");
      const { exitCode } = runScript(["--run-id", "test-run", "--cwd", tmpDir]);
      expect(exitCode).toBe(0);
    });

    it("writes summary.md to default output path", () => {
      makeRunDir(tmpDir, "test-run", "events-happy.ndjson");
      runScript(["--run-id", "test-run", "--cwd", tmpDir]);
      const summaryPath = path.join(tmpDir, ".guild", "runs", "test-run", "summary.md");
      expect(fs.existsSync(summaryPath)).toBe(true);
    });

    it("writes summary.md to custom --out path", () => {
      makeRunDir(tmpDir, "test-run", "events-happy.ndjson");
      const outPath = path.join(tmpDir, "custom-summary.md");
      runScript(["--run-id", "test-run", "--cwd", tmpDir, "--out", outPath]);
      expect(fs.existsSync(outPath)).toBe(true);
    });

    it("frontmatter contains run_id", () => {
      makeRunDir(tmpDir, "test-run", "events-happy.ndjson");
      runScript(["--run-id", "test-run", "--cwd", tmpDir]);
      const content = fs.readFileSync(
        path.join(tmpDir, ".guild", "runs", "test-run", "summary.md"),
        "utf8"
      );
      expect(content).toMatch(/run_id:\s*test-run/);
    });

    it("frontmatter contains correct event_count (20 events)", () => {
      makeRunDir(tmpDir, "test-run", "events-happy.ndjson");
      runScript(["--run-id", "test-run", "--cwd", tmpDir]);
      const content = fs.readFileSync(
        path.join(tmpDir, ".guild", "runs", "test-run", "summary.md"),
        "utf8"
      );
      expect(content).toMatch(/event_count:\s*20/);
    });

    it("frontmatter contains both specialists sorted alphabetically", () => {
      makeRunDir(tmpDir, "test-run", "events-happy.ndjson");
      runScript(["--run-id", "test-run", "--cwd", tmpDir]);
      const content = fs.readFileSync(
        path.join(tmpDir, ".guild", "runs", "test-run", "summary.md"),
        "utf8"
      );
      // Both specialists must appear
      expect(content).toMatch(/backend-engineer/);
      expect(content).toMatch(/frontend-engineer/);
      // In the frontmatter list, backend comes before frontend alphabetically
      const backendIdx = content.indexOf("backend-engineer");
      const frontendIdx = content.indexOf("frontend-engineer");
      expect(backendIdx).toBeLessThan(frontendIdx);
    });

    it("frontmatter contains errors count (1 error in happy fixture)", () => {
      makeRunDir(tmpDir, "test-run", "events-happy.ndjson");
      runScript(["--run-id", "test-run", "--cwd", tmpDir]);
      const content = fs.readFileSync(
        path.join(tmpDir, ".guild", "runs", "test-run", "summary.md"),
        "utf8"
      );
      expect(content).toMatch(/errors:\s*1/);
    });

    it("frontmatter ok_rate is correct (19/20 = 0.95)", () => {
      makeRunDir(tmpDir, "test-run", "events-happy.ndjson");
      runScript(["--run-id", "test-run", "--cwd", tmpDir]);
      const content = fs.readFileSync(
        path.join(tmpDir, ".guild", "runs", "test-run", "summary.md"),
        "utf8"
      );
      expect(content).toMatch(/ok_rate:\s*0\.95/);
    });

    it("frontmatter tools_used lists tools sorted by count descending", () => {
      makeRunDir(tmpDir, "test-run", "events-happy.ndjson");
      runScript(["--run-id", "test-run", "--cwd", tmpDir]);
      const content = fs.readFileSync(
        path.join(tmpDir, ".guild", "runs", "test-run", "summary.md"),
        "utf8"
      );
      // Read appears 6 times, Bash 5, Write 4, Edit 3 in happy fixture
      // (plus SubagentStop with empty tool which is excluded from tools_used)
      expect(content).toMatch(/Read:\s*6/);
      expect(content).toMatch(/Bash:\s*5/);
      expect(content).toMatch(/Write:\s*4/);
      expect(content).toMatch(/Edit:\s*3/);
      // Read (6) must appear before Bash (5) in the tools list
      const readIdx = content.indexOf("Read: 6");
      const bashIdx = content.indexOf("Bash: 5");
      expect(readIdx).toBeLessThan(bashIdx);
    });

    it("frontmatter started_at and ended_at are correct ISO timestamps", () => {
      makeRunDir(tmpDir, "test-run", "events-happy.ndjson");
      runScript(["--run-id", "test-run", "--cwd", tmpDir]);
      const content = fs.readFileSync(
        path.join(tmpDir, ".guild", "runs", "test-run", "summary.md"),
        "utf8"
      );
      expect(content).toMatch(/started_at:\s*2026-04-24T10:00:00\.000Z/);
      expect(content).toMatch(/ended_at:\s*2026-04-24T10:00:45\.000Z/);
    });

    it("frontmatter files_touched_count is correct (Write+Edit = 7)", () => {
      makeRunDir(tmpDir, "test-run", "events-happy.ndjson");
      runScript(["--run-id", "test-run", "--cwd", tmpDir]);
      const content = fs.readFileSync(
        path.join(tmpDir, ".guild", "runs", "test-run", "summary.md"),
        "utf8"
      );
      // 3 Write + 3 Edit (backend) + 1 Write + 2 Edit + 1 Write (frontend) = Write:4, Edit:3 = 7
      expect(content).toMatch(/files_touched_count:\s*7/);
    });

    it("body has all required markdown sections", () => {
      makeRunDir(tmpDir, "test-run", "events-happy.ndjson");
      runScript(["--run-id", "test-run", "--cwd", tmpDir]);
      const content = fs.readFileSync(
        path.join(tmpDir, ".guild", "runs", "test-run", "summary.md"),
        "utf8"
      );
      expect(content).toMatch(/^# Run test-run summary/m);
      expect(content).toMatch(/^## Timeline/m);
      expect(content).toMatch(/^## Specialist activity/m);
      expect(content).toMatch(/^## Notable events/m);
      expect(content).toMatch(/^## Reflection hints/m);
    });

    it("body does not reference .guild/wiki (invariant check)", () => {
      makeRunDir(tmpDir, "test-run", "events-happy.ndjson");
      runScript(["--run-id", "test-run", "--cwd", tmpDir]);
      const content = fs.readFileSync(
        path.join(tmpDir, ".guild", "runs", "test-run", "summary.md"),
        "utf8"
      );
      expect(content).not.toMatch(/\.guild\/wiki/);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Empty events file
  // ─────────────────────────────────────────────────────────────
  describe("empty events file — events-empty.ndjson", () => {
    it("exits 0 (does not crash)", () => {
      makeRunDir(tmpDir, "empty-run", "events-empty.ndjson");
      const { exitCode } = runScript(["--run-id", "empty-run", "--cwd", tmpDir]);
      expect(exitCode).toBe(0);
    });

    it("writes a summary.md", () => {
      makeRunDir(tmpDir, "empty-run", "events-empty.ndjson");
      runScript(["--run-id", "empty-run", "--cwd", tmpDir]);
      const summaryPath = path.join(tmpDir, ".guild", "runs", "empty-run", "summary.md");
      expect(fs.existsSync(summaryPath)).toBe(true);
    });

    it("frontmatter shows event_count: 0", () => {
      makeRunDir(tmpDir, "empty-run", "events-empty.ndjson");
      runScript(["--run-id", "empty-run", "--cwd", tmpDir]);
      const content = fs.readFileSync(
        path.join(tmpDir, ".guild", "runs", "empty-run", "summary.md"),
        "utf8"
      );
      expect(content).toMatch(/event_count:\s*0/);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Malformed events file
  // ─────────────────────────────────────────────────────────────
  describe("malformed events file — events-malformed.ndjson", () => {
    it("exits 0 when at least some lines parse", () => {
      makeRunDir(tmpDir, "malformed-run", "events-malformed.ndjson");
      const { exitCode } = runScript(["--run-id", "malformed-run", "--cwd", tmpDir]);
      expect(exitCode).toBe(0);
    });

    it("writes a summary.md for 3 valid events", () => {
      makeRunDir(tmpDir, "malformed-run", "events-malformed.ndjson");
      runScript(["--run-id", "malformed-run", "--cwd", tmpDir]);
      const summaryPath = path.join(tmpDir, ".guild", "runs", "malformed-run", "summary.md");
      expect(fs.existsSync(summaryPath)).toBe(true);
    });

    it("counts only valid lines (3 valid out of 5 total)", () => {
      makeRunDir(tmpDir, "malformed-run", "events-malformed.ndjson");
      runScript(["--run-id", "malformed-run", "--cwd", tmpDir]);
      const content = fs.readFileSync(
        path.join(tmpDir, ".guild", "runs", "malformed-run", "summary.md"),
        "utf8"
      );
      expect(content).toMatch(/event_count:\s*3/);
    });

    it("reports parse errors to stderr", () => {
      makeRunDir(tmpDir, "malformed-run", "events-malformed.ndjson");
      const { stderr } = runScript(["--run-id", "malformed-run", "--cwd", tmpDir]);
      // Should log parse error for the 2 malformed lines
      expect(stderr).toMatch(/parse/i);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Canonical event log (logs/v1.4-events.jsonl) — item G9-1
  // ─────────────────────────────────────────────────────────────
  describe("canonical event log — logs/v1.4-events.jsonl", () => {
    it("reads from the canonical path when legacy events.ndjson is absent", () => {
      makeCanonicalRunDir(tmpDir, "canon-run", "events-happy.ndjson");
      const { exitCode } = runScript(["--run-id", "canon-run", "--cwd", tmpDir]);
      expect(exitCode).toBe(0);
      const content = fs.readFileSync(
        path.join(tmpDir, ".guild", "runs", "canon-run", "summary.md"),
        "utf8"
      );
      expect(content).toMatch(/event_count:\s*20/);
    });

    it("prefers the canonical log over a stale legacy mirror when both exist", () => {
      const runDir = makeCanonicalRunDir(tmpDir, "both-run", "events-happy.ndjson");
      // Legacy mirror present too, but with different (smaller) content — canonical must win.
      fs.copyFileSync(
        path.join(FIXTURES, "events-empty.ndjson"),
        path.join(runDir, "events.ndjson")
      );
      runScript(["--run-id", "both-run", "--cwd", tmpDir]);
      const content = fs.readFileSync(path.join(runDir, "summary.md"), "utf8");
      expect(content).toMatch(/event_count:\s*20/);
    });

    it("handles a real run-dir shape: a guild.trace_event.v1 line with no `event`/`ts` field", () => {
      // Real shape observed in a live .guild/runs/<id>/logs/v1.4-events.jsonl:
      // hook-mirror lines interleaved with a schema-only guild.trace_event.v1 line.
      const runDir = path.join(tmpDir, ".guild", "runs", "mixed-shape-run");
      const logsDir = path.join(runDir, "logs");
      fs.mkdirSync(logsDir, { recursive: true });
      fs.writeFileSync(
        path.join(logsDir, "v1.4-events.jsonl"),
        [
          '{"ts":"2026-06-25T06:53:59.382Z","event":"UserPromptSubmit","tool":"","specialist":"","payload_digest":"a1","ok":true,"ms":0,"prompt":"do the thing"}',
          '{"schema_version":"guild.trace_event.v1","event_id":"evt-1","event_name":"run_started","run_id":"mixed-shape-run","at":"2026-06-25T06:54:00.000Z"}',
          '{"ts":"2026-06-25T06:54:02.596Z","event":"PostToolUse","tool":"Read","specialist":"backend","payload_digest":"a2","ok":true,"ms":3}',
        ].join("\n") + "\n",
        "utf8"
      );
      const { exitCode } = runScript(["--run-id", "mixed-shape-run", "--cwd", tmpDir]);
      expect(exitCode).toBe(0);
      const content = fs.readFileSync(path.join(runDir, "summary.md"), "utf8");
      // All 3 lines parse (the schema-only line parses as valid JSON — it just
      // contributes no timeline/tool/specialist signal); none are parse errors.
      expect(content).toMatch(/event_count:\s*3/);
    });

    it("anchors started/ended on boundary guild.trace_event.v1 markers (`at`, no `ts`)", () => {
      // A NORMAL canonical log starts with run_started and ends with run_closed
      // — both guild.trace_event.v1 lines carrying `at` instead of `ts`. The
      // summarizer must normalize ts??at at the boundaries or every real run
      // reports blank timestamps and duration_ms: 0 (codex wave-3 finding #3).
      const runDir = path.join(tmpDir, ".guild", "runs", "boundary-run");
      const logsDir = path.join(runDir, "logs");
      fs.mkdirSync(logsDir, { recursive: true });
      fs.writeFileSync(
        path.join(logsDir, "v1.4-events.jsonl"),
        [
          '{"schema_version":"guild.trace_event.v1","event_id":"evt-1","event_name":"run_started","run_id":"boundary-run","at":"2026-06-25T06:00:00.000Z"}',
          '{"ts":"2026-06-25T06:10:00.000Z","event":"PostToolUse","tool":"Read","specialist":"backend","payload_digest":"b1","ok":true,"ms":3}',
          '{"schema_version":"guild.trace_event.v1","event_id":"evt-2","event_name":"run_closed","run_id":"boundary-run","at":"2026-06-25T06:30:00.000Z"}',
        ].join("\n") + "\n",
        "utf8"
      );
      const { exitCode } = runScript(["--run-id", "boundary-run", "--cwd", tmpDir]);
      expect(exitCode).toBe(0);
      const content = fs.readFileSync(path.join(runDir, "summary.md"), "utf8");
      expect(content).toMatch(/started_at:\s*2026-06-25T06:00:00\.000Z/);
      expect(content).toMatch(/ended_at:\s*2026-06-25T06:30:00\.000Z/);
      expect(content).toMatch(/duration_ms:\s*1800000/);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Canonical v1.4 tool_call shape (status/latency_ms, not ok/ms) — #73
  // ─────────────────────────────────────────────────────────────
  describe("canonical v1.4 tool_call shape — events-v14-tool-call.ndjson (#73)", () => {
    // Real production `tool_call` events (hooks/post-tool-use.ts) carry
    // `status: "ok"|"err"|"n/a"` + `latency_ms`, NOT the legacy hook-mirror
    // `ok: boolean` + `ms: number` pair trace-summarize.ts reads. Before the
    // fix, every row here — including the two "ok" rows, the "n/a" row, and
    // the fieldless row — rendered "⚠ ERROR (undefinedms)" because `event.ok`
    // and `event.ms` were simply undefined for all of them, and `event.ok ?
    // "" : " ⚠ ERROR"` treats `undefined` as an error.
    //
    // Fixture rows: 1/2 status:"ok"; 3 status:"err" with the real orphan-sweep
    // latency_ms:-1 sentinel (hooks/post-tool-use.ts); 4 status:"n/a"; 5 no
    // status/latency_ms/ok/ms field at all (defensive fallback — this module's
    // header comment: "every access below is defensive/undefined-safe"; not a
    // literal producer shape, exercises the fully-fieldless path); 6 carries
    // BOTH an explicit legacy ok:true/ms:77 AND a contradicting
    // status:"err"/latency_ms:500 (proves existing ok/ms always wins — no
    // legitimate producer emits both, but normalizeEvent must never clobber a
    // field already present); 7 uses duration_ms instead of latency_ms; 8 a
    // `phase_end status:"escalated"` — a DIFFERENT status enum than
    // tool_call/hook_event's "ok"|"err"|"n/a" (see log-jsonl-schema.ts) that a
    // `status !== "n/a"` blacklist would wrongly turn into an error; 9 a
    // canonical `hook_event status:"err"` with `hook_name` (no `tool` field)
    // proving the hook_name→tool Timeline bridge.
    it("does not mark ok/n/a/fieldless/escalated rows as ERROR — only explicit status:err rows", () => {
      makeCanonicalRunDir(tmpDir, "v14-run", "events-v14-tool-call.ndjson");
      const { exitCode } = runScript(["--run-id", "v14-run", "--cwd", tmpDir]);
      expect(exitCode).toBe(0);
      const content = fs.readFileSync(
        path.join(tmpDir, ".guild", "runs", "v14-run", "summary.md"),
        "utf8"
      );
      const timelineLines = content
        .split("\n")
        .filter((l) => l.startsWith("- `"));
      // 7 tool_call rows with a `tool` field + 1 hook_event bridged via
      // hook_name. The phase_end row has neither `tool` nor `hook_name` and
      // contributes no Timeline row.
      expect(timelineLines).toHaveLength(8);

      const errorLines = timelineLines.filter((l) => l.includes("ERROR"));
      // status:"err" Bash row (a3) + status:"err" hook_event row (SessionStart)
      // are real errors. The contradicting Grep row (a6) has an explicit
      // ok:true that wins, and the escalated phase_end has no Timeline row.
      expect(errorLines).toHaveLength(2);
      expect(errorLines.some((l) => l.includes("Bash"))).toBe(true);
      expect(errorLines.some((l) => l.includes("SessionStart"))).toBe(true);

      const okLine = timelineLines.find((l) => l.includes("Skill"))!;
      expect(okLine).not.toContain("ERROR");

      const naStatusLine = timelineLines.find((l) => l.includes("WebFetch"))!;
      expect(naStatusLine).not.toContain("ERROR");

      const grepLine = timelineLines.find((l) => l.includes("Grep"))!;
      expect(grepLine).not.toContain("ERROR");
    });

    it("does not classify a phase_end status:\"escalated\" as an error (different status enum than tool_call)", () => {
      // Regression for the blacklist bug: `status !== "n/a"` would have
      // mapped "escalated" to ok:false, inflating frontmatter `errors`.
      makeCanonicalRunDir(tmpDir, "v14-run", "events-v14-tool-call.ndjson");
      runScript(["--run-id", "v14-run", "--cwd", tmpDir]);
      const content = fs.readFileSync(
        path.join(tmpDir, ".guild", "runs", "v14-run", "summary.md"),
        "utf8"
      );
      // Only the two real status:"err" rows (Bash tool_call, SessionStart
      // hook_event) count — "escalated" must not be a third.
      expect(content).toMatch(/errors:\s*2/);
    });

    it("bridges hook_event.hook_name onto Timeline `tool` so its status:err is visible", () => {
      makeCanonicalRunDir(tmpDir, "v14-run", "events-v14-tool-call.ndjson");
      runScript(["--run-id", "v14-run", "--cwd", tmpDir]);
      const content = fs.readFileSync(
        path.join(tmpDir, ".guild", "runs", "v14-run", "summary.md"),
        "utf8"
      );
      const hookLine = content
        .split("\n")
        .find((l) => l.startsWith("- `") && l.includes("SessionStart"))!;
      expect(hookLine).toBeDefined();
      expect(hookLine).toContain("ERROR");
      expect(hookLine).toContain("(5ms)");
    });

    it("renders (n/a) — never a literal (undefinedms) or a negative sentinel — for unknown durations", () => {
      makeCanonicalRunDir(tmpDir, "v14-run", "events-v14-tool-call.ndjson");
      runScript(["--run-id", "v14-run", "--cwd", tmpDir]);
      const content = fs.readFileSync(
        path.join(tmpDir, ".guild", "runs", "v14-run", "summary.md"),
        "utf8"
      );
      expect(content).not.toMatch(/undefinedms/);
      expect(content).not.toMatch(/\(-1ms\)/);

      const readLine = content
        .split("\n")
        .find((l) => l.startsWith("- `") && l.includes("Read"))!;
      expect(readLine).toContain("(n/a)");
      expect(readLine).not.toContain("ERROR");

      // The orphan-sweep sentinel latency_ms:-1 is not a real duration either.
      const bashErrorLine = content
        .split("\n")
        .find((l) => l.startsWith("- `") && l.includes("Bash") && l.includes("ERROR"))!;
      expect(bashErrorLine).toContain("(n/a)");
    });

    it("maps a real positive latency_ms/duration_ms onto the rendered duration", () => {
      makeCanonicalRunDir(tmpDir, "v14-run", "events-v14-tool-call.ndjson");
      runScript(["--run-id", "v14-run", "--cwd", tmpDir]);
      const content = fs.readFileSync(
        path.join(tmpDir, ".guild", "runs", "v14-run", "summary.md"),
        "utf8"
      );
      const timelineLines = content.split("\n").filter((l) => l.startsWith("- `"));
      expect(timelineLines.find((l) => l.includes("Bash") && !l.includes("ERROR"))).toContain("(955ms)");
      expect(timelineLines.find((l) => l.includes("Skill"))).toContain("(3ms)");
      expect(timelineLines.find((l) => l.includes("WebFetch"))).toContain("(12ms)");
      // duration_ms fallback (no latency_ms on this row).
      expect(timelineLines.find((l) => l.includes("Glob"))).toContain("(42ms)");
    });

    it("never overwrites an existing ok/ms pair with a contradicting status/latency_ms", () => {
      makeCanonicalRunDir(tmpDir, "v14-run", "events-v14-tool-call.ndjson");
      runScript(["--run-id", "v14-run", "--cwd", tmpDir]);
      const content = fs.readFileSync(
        path.join(tmpDir, ".guild", "runs", "v14-run", "summary.md"),
        "utf8"
      );
      const grepLine = content
        .split("\n")
        .find((l) => l.startsWith("- `") && l.includes("Grep"))!;
      // ok:true + ms:77 are already present on this row — status:"err" /
      // latency_ms:500 must not override them.
      expect(grepLine).not.toContain("ERROR");
      expect(grepLine).toContain("(77ms)");
    });

    it("frontmatter errors/ok_rate agree with the timeline (2 errors out of 5 defined-verdict events)", () => {
      makeCanonicalRunDir(tmpDir, "v14-run", "events-v14-tool-call.ndjson");
      runScript(["--run-id", "v14-run", "--cwd", tmpDir]);
      const content = fs.readFileSync(
        path.join(tmpDir, ".guild", "runs", "v14-run", "summary.md"),
        "utf8"
      );
      // Verdict-bearing rows: 1 (ok), 2 (ok), 3 (err), 6 (ok, via existing
      // ok:true), 9 (err, via hook_event status). Rows 4/5/7/8 have no
      // defined ok verdict and are excluded from both errors and the
      // ok_rate denominator.
      expect(content).toMatch(/errors:\s*2/);
      expect(content).toMatch(/ok_rate:\s*0\.6/);
      const errorLines = content
        .split("\n")
        .filter((l) => l.startsWith("- `") && l.includes("ERROR"));
      expect(errorLines).toHaveLength(2);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // G7b — canonical tool_call events undercounted + digest cosmetic
  // (rf-wi-07 / v23x-deferred-followups): buildSpecialistActivity and the
  // slow-call detectors gated on the legacy hook-mirror `event.event ===
  // "PostToolUse"` only — the canonical v1.4 shape (log-jsonl-schema.ts)
  // names the same activity `event: "tool_call"`, so every canonical run
  // silently zeroed these tallies. buildNotableEvents also printed the
  // literal string "digest: undefined" for canonical rows, which carry no
  // `payload_digest` field (legacy-only).
  // ─────────────────────────────────────────────────────────────
  describe("G7b — canonical tool_call gate + digest cosmetic", () => {
    it("counts canonical tool_call events toward a specialist's Tool calls tally (events-v14-tool-call.ndjson)", () => {
      makeCanonicalRunDir(tmpDir, "v14-run", "events-v14-tool-call.ndjson");
      runScript(["--run-id", "v14-run", "--cwd", tmpDir]);
      const content = fs.readFileSync(
        path.join(tmpDir, ".guild", "runs", "v14-run", "summary.md"),
        "utf8"
      );
      // Row 5 is the sole tool_call carrying specialist:"backend-engineer"
      // (a bare Read, no status/latency_ms/ok/ms at all).
      const section = content.split("### backend-engineer")[1]?.split("###")[0] ?? "";
      expect(section).toMatch(/Tool calls:\s*1/);
    });

    it("counts canonical tool_call events toward (main session)'s Tool calls tally", () => {
      makeCanonicalRunDir(tmpDir, "v14-run", "events-v14-tool-call.ndjson");
      runScript(["--run-id", "v14-run", "--cwd", tmpDir]);
      const content = fs.readFileSync(
        path.join(tmpDir, ".guild", "runs", "v14-run", "summary.md"),
        "utf8"
      );
      // Rows 1,2,3,4,6,7 are tool_call with no specialist field → "(main session)".
      const section = content.split("### (main session)")[1]?.split("###")[0] ?? "";
      expect(section).toMatch(/Tool calls:\s*6/);
    });

    it("flags a canonical tool_call over 2000ms as SLOW in Notable events", () => {
      const runDir = path.join(tmpDir, ".guild", "runs", "slow-canon-run");
      const logsDir = path.join(runDir, "logs");
      fs.mkdirSync(logsDir, { recursive: true });
      fs.writeFileSync(
        path.join(logsDir, "v1.4-events.jsonl"),
        '{"ts":"2026-07-21T01:35:26.666Z","event":"tool_call","run_id":"slow-canon-run","tool":"Bash","status":"ok","latency_ms":3000}\n',
        "utf8"
      );
      runScript(["--run-id", "slow-canon-run", "--cwd", tmpDir]);
      const content = fs.readFileSync(path.join(runDir, "summary.md"), "utf8");
      expect(content).toMatch(/SLOW at .*Bash.*took 3000ms/);
    });

    it("flags a canonical tool_call over 5000ms as a context-bundle reflection hint", () => {
      const runDir = path.join(tmpDir, ".guild", "runs", "very-slow-canon-run");
      const logsDir = path.join(runDir, "logs");
      fs.mkdirSync(logsDir, { recursive: true });
      fs.writeFileSync(
        path.join(logsDir, "v1.4-events.jsonl"),
        '{"ts":"2026-07-21T01:35:26.666Z","event":"tool_call","run_id":"very-slow-canon-run","tool":"Bash","status":"ok","latency_ms":6000}\n',
        "utf8"
      );
      runScript(["--run-id", "very-slow-canon-run", "--cwd", tmpDir]);
      const content = fs.readFileSync(path.join(runDir, "summary.md"), "utf8");
      expect(content).toMatch(/context-bundle issues: 1 tool call\(s\) exceeded 5000ms/);
    });

    it("never prints the literal 'digest: undefined' for a canonical ERROR row", () => {
      makeCanonicalRunDir(tmpDir, "v14-run", "events-v14-tool-call.ndjson");
      runScript(["--run-id", "v14-run", "--cwd", tmpDir]);
      const content = fs.readFileSync(
        path.join(tmpDir, ".guild", "runs", "v14-run", "summary.md"),
        "utf8"
      );
      expect(content).not.toMatch(/digest: undefined/);
    });

    it("renders the real redacted excerpt as the digest when payload_digest is absent", () => {
      makeCanonicalRunDir(tmpDir, "v14-run", "events-v14-tool-call.ndjson");
      runScript(["--run-id", "v14-run", "--cwd", tmpDir]);
      const content = fs.readFileSync(
        path.join(tmpDir, ".guild", "runs", "v14-run", "summary.md"),
        "utf8"
      );
      // The Bash status:"err" tool_call row carries result_excerpt_redacted:"<orphaned>".
      expect(content).toMatch(/digest: <orphaned>/);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // CLI error handling
  // ─────────────────────────────────────────────────────────────
  describe("CLI error handling", () => {
    it("exits 1 when --run-id is missing", () => {
      const { exitCode, stderr } = runScript(["--cwd", tmpDir]);
      expect(exitCode).toBe(1);
      expect(stderr).toMatch(/run-id/i);
    });

    it("exits 1 when neither canonical nor legacy event log exists", () => {
      // Run dir exists but no events file
      const runDir = path.join(tmpDir, ".guild", "runs", "no-events");
      fs.mkdirSync(runDir, { recursive: true });
      const { exitCode, stderr } = runScript(["--run-id", "no-events", "--cwd", tmpDir]);
      expect(exitCode).toBe(1);
      expect(stderr).toMatch(/events/i);
    });
  });
});
