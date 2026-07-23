/**
 * scripts/__tests__/run-sinks.test.ts
 *
 * rf-wi-02 (G2) — the degradation + tier-dispatch SINK CONSUMERS.
 *
 * Two sinks exist on every run dir but had ZERO readers before this lane:
 *   - logs/backend-degradation.jsonl (guild.backend_degradation.v1)
 *   - logs/tier-dispatch.jsonl       (guild.tier_dispatch.v1)
 * A run with a silent backend downgrade or an un-tiered dispatch was
 * auditable-by-path only, never surfaced. This suite pins the wiring that
 * makes such a run VISIBLY dirty:
 *   1. `scripts/lib/run-sinks.ts` — pure readers/summarizers (unit).
 *   2. `scripts/trace-summarize.ts` — summary.md (reflect's input) carries a
 *      `## Sink audit` section + frontmatter counts (integration).
 *   3. `scripts/audit-run-sinks.ts` — the CLI verify-done gates on; exit 1 on
 *      a dirty run, exit 0 on a clean one (integration).
 *
 * Fixtures represent the scored_compliant sink format (G3 / #85).
 */

import { spawnSync } from "child_process";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";

import {
  BACKEND_DEGRADATION_SINK,
  TIER_DISPATCH_SINK,
  readJsonlSink,
  summarizeBackendDegradations,
  summarizeTierDispatch,
  loadRunSinks,
  isRunSinkDirty,
  renderSinkAuditSection,
  sinkAuditFrontmatterLines,
} from "../lib/run-sinks";

const SUMMARIZE = path.resolve(__dirname, "../trace-summarize.ts");
const AUDIT = path.resolve(__dirname, "../audit-run-sinks.ts");

// ── Fixture receipts (scored_compliant sink format, G3/#85) ──────────────────

const DEGRADATION_RECEIPT = {
  schema_version: "guild.backend_degradation.v1",
  ts: "2026-04-24T10:00:03.000Z",
  event: "backend_degradation",
  tool: "Agent",
  specialist: "backend-engineer",
  ok: false,
  ms: 0,
  run_id: "sink-run",
  decision: "deny",
  reason: "team_substrate_available",
  snapshot_agent_mode: "team",
  substrate: "tmux",
  lane_evidence: "structured",
  attempted_subagent_type: "general-purpose",
  detail: "seeded degradation",
  span_id: "d1",
};

const TIER_COMPLIANT = {
  schema_version: "guild.tier_dispatch.v1",
  ts: "2026-04-24T10:00:04.000Z",
  event: "tier_dispatch",
  tool: "Agent",
  specialist: "backend-engineer",
  ok: true,
  ms: 0,
  run_id: "sink-run",
  decision: "pass",
  reason: "scored_compliant",
  task_id: "t1",
  model: "claude-sonnet-5",
  tier: "mid",
  lane_evidence: "structured",
  subagent_type: "guild:developer",
  dispatch_line: "lane t1 · score 5 · tier mid · model claude-sonnet-5",
  detail: "",
  span_id: "td1",
};

const TIER_UNTIERED = {
  schema_version: "guild.tier_dispatch.v1",
  ts: "2026-04-24T10:00:06.000Z",
  event: "tier_dispatch",
  tool: "Agent",
  specialist: "frontend-engineer",
  ok: false,
  ms: 0,
  run_id: "sink-run",
  decision: "allow_recorded",
  reason: "missing_model",
  task_id: "t2",
  model: "MISSING",
  lane_evidence: "prompt_only",
  subagent_type: "general-purpose",
  dispatch_line: "lane t2 · score ? · tier ? · model MISSING",
  detail: "",
  span_id: "td2",
};

const EVENTS = [
  { ts: "2026-04-24T10:00:00.000Z", event: "PostToolUse", tool: "Read", specialist: "backend-engineer", payload_digest: "a", ok: true, ms: 10 },
  { ts: "2026-04-24T10:00:05.000Z", event: "PostToolUse", tool: "Write", specialist: "backend-engineer", payload_digest: "b", ok: true, ms: 12 },
];

function writeJsonl(file: string, rows: unknown[]): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, rows.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");
}

/** Seed a run dir with an event log + optionally the two sinks. */
function seedRun(
  tmpDir: string,
  runId: string,
  opts: { degradations?: unknown[]; tierDispatches?: unknown[] } = {}
): string {
  const runDir = path.join(tmpDir, ".guild", "runs", runId);
  writeJsonl(path.join(runDir, "logs", "v1.4-events.jsonl"), EVENTS);
  if (opts.degradations) writeJsonl(path.join(runDir, BACKEND_DEGRADATION_SINK), opts.degradations);
  if (opts.tierDispatches) writeJsonl(path.join(runDir, TIER_DISPATCH_SINK), opts.tierDispatches);
  return runDir;
}

function runScript(script: string, args: string[]): { code: number; out: string; err: string } {
  const r = spawnSync("npx", ["tsx", script, ...args], { encoding: "utf8", timeout: 120_000 });
  return { code: r.status ?? 1, out: r.stdout ?? "", err: r.stderr ?? "" };
}

describe("run-sinks (rf-wi-02)", () => {
  let tmpDir: string;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-run-sinks-"));
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── Unit: pure readers/summarizers ─────────────────────────────────────────
  describe("lib", () => {
    it("reads a JSONL sink defensively (missing file → [], malformed lines skipped)", () => {
      const runDir = seedRun(tmpDir, "r", { tierDispatches: [TIER_COMPLIANT] });
      expect(readJsonlSink(runDir, BACKEND_DEGRADATION_SINK)).toEqual([]); // absent
      // append a malformed line to a real sink
      fs.appendFileSync(path.join(runDir, TIER_DISPATCH_SINK), "{not json\n");
      const rows = readJsonlSink(runDir, TIER_DISPATCH_SINK);
      expect(rows).toHaveLength(1);
      expect((rows[0] as { reason: string }).reason).toBe("scored_compliant");
    });

    it("summarizes backend degradations — every degradation is dirty", () => {
      const s = summarizeBackendDegradations([DEGRADATION_RECEIPT]);
      expect(s.count).toBe(1);
      expect(s.byReason).toContainEqual({ reason: "team_substrate_available", count: 1 });
      expect(s.byDecision).toContainEqual({ decision: "deny", count: 1 });
    });

    it("summarizes tier dispatch — a pass is compliant, missing_model is untiered", () => {
      const s = summarizeTierDispatch([TIER_COMPLIANT, TIER_UNTIERED]);
      expect(s.total).toBe(2);
      expect(s.violationCount).toBe(1); // decision !== pass
      expect(s.untieredCount).toBe(1); // reason === missing_model
      expect(s.byReason).toContainEqual({ reason: "missing_model", count: 1 });
    });

    it("loadRunSinks + isRunSinkDirty: dirty when a degradation OR a violation exists", () => {
      const clean = seedRun(tmpDir, "clean", { tierDispatches: [TIER_COMPLIANT] });
      expect(isRunSinkDirty(loadRunSinks(clean))).toBe(false);
      const dirty = seedRun(tmpDir, "dirty", {
        degradations: [DEGRADATION_RECEIPT],
        tierDispatches: [TIER_COMPLIANT, TIER_UNTIERED],
      });
      expect(isRunSinkDirty(loadRunSinks(dirty))).toBe(true);
    });

    it("FAILS CLOSED on a present-but-unparseable sink line (codex r1 finding 1)", () => {
      // A run whose only tier-dispatch receipt is corrupt/truncated must NOT read
      // clean — a garbled line may hide a real un-tiered dispatch.
      const runDir = seedRun(tmpDir, "corrupt", { tierDispatches: [TIER_COMPLIANT] });
      fs.appendFileSync(path.join(runDir, TIER_DISPATCH_SINK), '{"schema_version":"guild.tier_dispatch.v1","decision":"allow_rec\n');
      const audit = loadRunSinks(runDir);
      expect(audit.parseErrors).toBe(1);
      expect(isRunSinkDirty(audit)).toBe(true);
      expect(renderSinkAuditSection(audit)).toMatch(/unverifiable sink records: 1/);
      expect(sinkAuditFrontmatterLines(audit)).toContain("sink_parse_errors: 1");
    });

    it("FAILS CLOSED on a wrong/garbled schema_version record (codex r2 finding 1)", () => {
      // A real receipt whose schema token got corrupted would otherwise be
      // silently filtered out and read clean.
      const runDir = seedRun(tmpDir, "wrongschema", {
        tierDispatches: [{ ...TIER_UNTIERED, schema_version: "guild.tier_dispatch.vX" }],
      });
      const audit = loadRunSinks(runDir);
      expect(audit.tier.total).toBe(0); // filtered out of the compliant view…
      expect(audit.parseErrors).toBe(1); // …but counted as an anomaly
      expect(isRunSinkDirty(audit)).toBe(true);
    });

    it("FAILS CLOSED on an unreadable (directory) sink; a MISSING sink stays clean (codex r2 finding 1)", () => {
      const runDir = seedRun(tmpDir, "dirsink", { tierDispatches: [TIER_COMPLIANT] });
      // Replace the degradation sink PATH with a directory → EISDIR on read.
      fs.mkdirSync(path.join(runDir, BACKEND_DEGRADATION_SINK), { recursive: true });
      const audit = loadRunSinks(runDir);
      expect(audit.parseErrors).toBeGreaterThanOrEqual(1);
      expect(isRunSinkDirty(audit)).toBe(true);
      // Control: a run with NO sinks at all (pure ENOENT) is clean.
      const empty = loadRunSinks(seedRun(tmpDir, "nosinks"));
      expect(empty.parseErrors).toBe(0);
      expect(isRunSinkDirty(empty)).toBe(false);
    });

    it("renders a clean audit affirmatively (not silently absent)", () => {
      const clean = loadRunSinks(seedRun(tmpDir, "clean", { tierDispatches: [TIER_COMPLIANT] }));
      const section = renderSinkAuditSection(clean);
      expect(section).toMatch(/Sink audit/);
      expect(section.toLowerCase()).toMatch(/clean|no (backend )?degradation/);
      expect(sinkAuditFrontmatterLines(clean)).toContain("backend_degradations: 0");
      expect(sinkAuditFrontmatterLines(clean)).toContain("untiered_dispatches: 0");
    });

    it("renders a dirty audit with the reason + counts", () => {
      const dirty = loadRunSinks(
        seedRun(tmpDir, "dirty", {
          degradations: [DEGRADATION_RECEIPT],
          tierDispatches: [TIER_COMPLIANT, TIER_UNTIERED],
        })
      );
      const section = renderSinkAuditSection(dirty);
      expect(section).toMatch(/team_substrate_available/);
      expect(section).toMatch(/missing_model/);
      const fm = sinkAuditFrontmatterLines(dirty);
      expect(fm).toContain("backend_degradations: 1");
      expect(fm).toContain("untiered_dispatches: 1");
      expect(fm).toContain("tier_violations: 1");
    });
  });

  // ── Integration: trace-summarize surfaces sinks in summary.md ──────────────
  describe("trace-summarize.ts consumes the sinks", () => {
    it("a dirty run's summary.md carries a Sink audit section + counts", () => {
      const runDir = seedRun(tmpDir, "sink-run", {
        degradations: [DEGRADATION_RECEIPT],
        tierDispatches: [TIER_COMPLIANT, TIER_UNTIERED],
      });
      const { code } = runScript(SUMMARIZE, ["--run-id", "sink-run", "--cwd", tmpDir]);
      expect(code).toBe(0);
      const summary = fs.readFileSync(path.join(runDir, "summary.md"), "utf8");
      expect(summary).toMatch(/## Sink audit/);
      expect(summary).toMatch(/backend_degradations: 1/);
      expect(summary).toMatch(/untiered_dispatches: 1/);
      expect(summary).toMatch(/team_substrate_available/);
      expect(summary).toMatch(/missing_model/);
    });

    it("a clean run's summary.md affirms the sinks are clean", () => {
      const runDir = seedRun(tmpDir, "clean-run", { tierDispatches: [TIER_COMPLIANT] });
      runScript(SUMMARIZE, ["--run-id", "clean-run", "--cwd", tmpDir]);
      const summary = fs.readFileSync(path.join(runDir, "summary.md"), "utf8");
      expect(summary).toMatch(/backend_degradations: 0/);
      expect(summary).toMatch(/untiered_dispatches: 0/);
    });
  });

  // ── Integration: audit-run-sinks CLI (verify-done gate) ────────────────────
  describe("audit-run-sinks.ts (verify-done gate)", () => {
    it("exits 1 and names the findings on a dirty run", () => {
      seedRun(tmpDir, "sink-run", {
        degradations: [DEGRADATION_RECEIPT],
        tierDispatches: [TIER_COMPLIANT, TIER_UNTIERED],
      });
      const { code, out, err } = runScript(AUDIT, ["--run-id", "sink-run", "--cwd", tmpDir]);
      const text = out + err;
      expect(code).toBe(1);
      expect(text).toMatch(/team_substrate_available/);
      expect(text).toMatch(/missing_model/);
    });

    it("exits 0 on a clean run", () => {
      seedRun(tmpDir, "clean-run", { tierDispatches: [TIER_COMPLIANT] });
      const { code } = runScript(AUDIT, ["--run-id", "clean-run", "--cwd", tmpDir]);
      expect(code).toBe(0);
    });
  });
});
