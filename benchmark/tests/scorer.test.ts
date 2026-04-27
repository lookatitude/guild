import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadCase } from "../src/case-loader.js";
import {
  importFixture,
  loadRunRecord,
} from "../src/artifact-importer.js";
import {
  computeMetrics,
  persistScore,
  resolveWeights,
  scoreRun,
} from "../src/scorer.js";
import type {
  Case,
  EventLine,
  RunRecord,
  ScoringWeights,
} from "../src/types.js";
import { DEFAULT_WEIGHTS } from "../src/types.js";

const FIXTURES = resolve(__dirname, "..", "fixtures");
const CASES_DIR = resolve(__dirname, "..", "cases");

function makeCase(overrides: Partial<Case> = {}): Case {
  return {
    schema_version: 1,
    id: "test-case",
    title: "Test",
    timeout_seconds: 1200,
    repetitions: 1,
    fixture: "../fixtures/synthetic-pass",
    prompt: "do thing",
    expected_specialists: ["architect", "backend", "qa", "technical-writer"],
    expected_stage_order: [
      "brainstorm",
      "team",
      "plan",
      "context",
      "execute",
      "review",
      "verify",
      "reflect",
    ],
    acceptance_commands: [],
    ...overrides,
  };
}

function makeRecord(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    run: {
      schema_version: 1,
      run_id: "test-run",
      case_slug: "test-case",
      plugin_ref: "abc1234",
      model_ref: { architect: "claude-opus-4-7" },
      started_at: "2026-04-26T05:30:00Z",
      completed_at: "2026-04-26T05:50:00Z",
      status: "pass",
      ...(overrides.run ?? {}),
    },
    events: [],
    runDir: "/tmp/x",
    artifactsRoot: "/tmp/x/artifacts/.guild",
    receipts: [],
    hasReview: false,
    hasAssumptions: false,
    hasReflection: false,
    partial: false,
    missing_artifacts: [],
    ...overrides,
  } as RunRecord;
}

describe("scorer / resolveWeights", () => {
  it("returns DEFAULT_WEIGHTS for a case with no override", () => {
    expect(resolveWeights(makeCase())).toEqual(DEFAULT_WEIGHTS);
  });

  it("merges a partial override on top of DEFAULT_WEIGHTS", () => {
    const w = resolveWeights(
      makeCase({ scoring_weights: { outcome: 50, efficiency: 0 } }),
    );
    expect(w.outcome).toBe(50);
    expect(w.efficiency).toBe(0);
    expect(w.delegation).toBe(DEFAULT_WEIGHTS.delegation);
  });
});

describe("scorer / scoreRun against synthetic-pass fixture", () => {
  let workDir: string;
  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), "scorer-pass-"));
  });
  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it("yields guild_score = 100 with weighted = 30/20/20/15/10/5", async () => {
    const { runDir } = await importFixture({
      fixturePath: join(FIXTURES, "synthetic-pass"),
      runsDir: workDir,
      runId: "score-pass",
    });
    const record = await loadRunRecord(runDir);
    const c = await loadCase(join(CASES_DIR, "demo-url-shortener-build.yaml"));
    const { score } = scoreRun(record, c);
    expect(score.guild_score).toBe(100);
    expect(score.partial).toBe(false);
    expect(score.components.outcome.weighted).toBe(30);
    expect(score.components.delegation.weighted).toBe(20);
    expect(score.components.gates.weighted).toBe(20);
    expect(score.components.evidence.weighted).toBe(15);
    expect(score.components.loop_response.weighted).toBe(10);
    expect(score.components.efficiency.weighted).toBe(5);
  });

  it("persistScore writes both metrics.json and score.json", async () => {
    const { runDir } = await importFixture({
      fixturePath: join(FIXTURES, "synthetic-pass"),
      runsDir: workDir,
      runId: "persist-pass",
    });
    const record = await loadRunRecord(runDir);
    const c = await loadCase(join(CASES_DIR, "demo-url-shortener-build.yaml"));
    const { score, metrics } = scoreRun(record, c);
    await persistScore(runDir, score, metrics);
    expect(existsSync(join(runDir, "score.json"))).toBe(true);
    expect(existsSync(join(runDir, "metrics.json"))).toBe(true);
    const persisted = JSON.parse(
      await readFile(join(runDir, "score.json"), "utf8"),
    );
    expect(persisted.guild_score).toBe(score.guild_score);
  });
});

describe("scorer / scoreRun against synthetic-fail fixture", () => {
  let workDir: string;
  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), "scorer-fail-"));
  });
  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it("yields guild_score ≤ 50 with skipped review gate + missing specialists + 1 receipt empty", async () => {
    const { runDir } = await importFixture({
      fixturePath: join(FIXTURES, "synthetic-fail"),
      runsDir: workDir,
      runId: "score-fail",
    });
    const record = await loadRunRecord(runDir);
    const c = await loadCase(join(CASES_DIR, "demo-url-shortener-build.yaml"));
    const { score, metrics } = scoreRun(record, c);
    expect(score.guild_score).toBeLessThanOrEqual(50);
    expect(score.guild_score).toBeGreaterThan(0);
    expect(score.components.evidence.raw_subscore).toBe(0);
    expect(score.components.loop_response.raw_subscore).toBe(0);
    expect(metrics.retry_count).toBe(1);
    expect(metrics.tool_error_count).toBe(1);
    expect(metrics.gate_outcomes.review).toBe("skipped");
  });
});

describe("scorer / R3 timeout zeroing", () => {
  let workDir: string;
  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), "scorer-timeout-"));
  });
  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it("zeroes outcome AND efficiency when run.status === 'timeout' (R3 mitigation)", async () => {
    const { runDir } = await importFixture({
      fixturePath: join(FIXTURES, "synthetic-timeout"),
      runsDir: workDir,
      runId: "score-timeout",
    });
    const record = await loadRunRecord(runDir);
    const c = await loadCase(join(CASES_DIR, "demo-url-shortener-build.yaml"));
    const { score } = scoreRun(record, c);
    expect(score.status).toBe("timeout");
    expect(score.components.outcome.weighted).toBe(0);
    expect(score.components.outcome.reason).toBe("timeout");
    expect(score.components.efficiency.weighted).toBe(0);
    expect(score.components.efficiency.reason).toBe("timeout");
    expect(score.guild_score).toBeLessThan(30);
  });
});

describe("scorer / synthetic-malformed propagates partial=true", () => {
  let workDir: string;
  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), "scorer-malformed-"));
  });
  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it("scores cleanly (no throw) and propagates partial=true to score.json", async () => {
    const { runDir } = await importFixture({
      fixturePath: join(FIXTURES, "synthetic-malformed"),
      runsDir: workDir,
      runId: "score-malformed",
    });
    const record = await loadRunRecord(runDir);
    const c = await loadCase(join(CASES_DIR, "demo-url-shortener-build.yaml"));
    const { score } = scoreRun(record, c);
    expect(score.partial).toBe(true);
    expect(score.missing_artifacts).toContain("events.ndjson");
    // outcome.reason is "errored" here (status takes precedence over the
    // empty-events branch in scoreOutcome). The other event-driven
    // components fall through to the missing_artifact path because events
    // and receipts are both empty — that's the cross-cutting "loud zero"
    // contract from `01-architecture.md` §4.
    expect(score.components.outcome.reason).toBe("errored");
    expect(score.components.gates.reason).toBe("missing_artifact");
    expect(score.components.evidence.reason).toBe("missing_artifact");
    expect(score.components.loop_response.reason).toBe("missing_artifact");
  });
});

describe("scorer / scoreOutcome unit cases", () => {
  it("scores 0 with reason 'errored' when status is errored", () => {
    const r = makeRecord({ run: { status: "errored" } as never });
    const { score } = scoreRun(r, makeCase());
    expect(score.components.outcome.raw_subscore).toBe(0);
    expect(score.components.outcome.reason).toBe("errored");
  });

  it("scores 100 when status is pass and there are no acceptance commands", () => {
    const r = makeRecord({
      events: [{ ts: "t", type: "stage_started", stage: "x" } as EventLine],
    });
    const { score } = scoreRun(r, makeCase());
    expect(score.components.outcome.raw_subscore).toBe(100);
  });

  it("scores 0 when status is fail and there are no acceptance commands", () => {
    const r = makeRecord({
      run: { status: "fail" } as never,
      events: [{ ts: "t", type: "stage_started", stage: "x" } as EventLine],
    });
    const { score } = scoreRun(r, makeCase());
    expect(score.components.outcome.raw_subscore).toBe(0);
  });

  it("scores partial credit when only some acceptance commands pass", () => {
    const events: EventLine[] = [
      { ts: "t", type: "acceptance_command", command: "a", exit_code: 0 },
      { ts: "t", type: "acceptance_command", command: "b", exit_code: 1 },
      { ts: "t", type: "acceptance_command", command: "c", exit_code: 0 },
      { ts: "t", type: "acceptance_command", command: "d", exit_code: 0 },
    ];
    const r = makeRecord({ events });
    const c = makeCase({ acceptance_commands: ["a", "b", "c", "d"] });
    const { score } = scoreRun(r, c);
    expect(score.components.outcome.raw_subscore).toBe(75);
  });
});

describe("scorer / scoreDelegation unit cases", () => {
  it("scores 100 when both expected and dispatched are empty (vacuous)", () => {
    const r = makeRecord();
    const c = makeCase({ expected_specialists: [] });
    const { score } = scoreRun(r, c);
    expect(score.components.delegation.raw_subscore).toBe(100);
  });

  it("uses an F1-like score that penalises both missing-critical and over-dispatch", () => {
    // expected = {a, b}, dispatched = {a, c, d}; intersect = 1, denom = 5 → 200/5 = 40.
    const events: EventLine[] = [
      { ts: "t", type: "specialist_dispatched", specialist: "a", task_id: "T1" },
      { ts: "t", type: "specialist_dispatched", specialist: "c", task_id: "T2" },
      { ts: "t", type: "specialist_dispatched", specialist: "d", task_id: "T3" },
      { ts: "t", type: "stage_started", stage: "execute" },
    ];
    const r = makeRecord({ events });
    const c = makeCase({ expected_specialists: ["a", "b"] });
    const { score } = scoreRun(r, c);
    expect(score.components.delegation.raw_subscore).toBe(40);
  });
});

describe("scorer / computeMetrics", () => {
  it("collapses duplicate stage events into one Stage entry per name", () => {
    const events: EventLine[] = [
      { ts: "1", type: "stage_started", stage: "execute" },
      { ts: "2", type: "stage_completed", stage: "execute", duration_ms: 50 },
      { ts: "3", type: "gate_skipped", gate: "review" },
    ];
    const m = computeMetrics(makeRecord({ events }), makeCase());
    expect(m.stages.find((s) => s.name === "execute")?.status).toBe("passed");
    expect(m.stages.find((s) => s.name === "review")?.status).toBe("skipped");
  });

  it("does not downgrade a passed stage to skipped when both events fire", () => {
    const events: EventLine[] = [
      { ts: "1", type: "stage_completed", stage: "review", duration_ms: 5 },
      { ts: "2", type: "gate_skipped", gate: "review", reason: "late" },
    ];
    const m = computeMetrics(makeRecord({ events }), makeCase());
    expect(m.stages.find((s) => s.name === "review")?.status).toBe("passed");
  });
});

describe("scorer / scoreEfficiency unit cases", () => {
  it("decreases linearly as wall_clock_ms exceeds budget", () => {
    const r = makeRecord({
      run: {
        ...makeRecord().run,
        wall_clock_ms: 1500000,
        wall_clock_budget_ms: 1000000,
      } as never,
      events: [],
    });
    const c = makeCase({ wall_clock_budget_ms: 1000000 });
    const { score } = scoreRun(r, c);
    // excess 500_000, ratio 0.5 → base 50, no penalties → 50.
    expect(score.components.efficiency.raw_subscore).toBe(50);
  });

  it("clamps the retry+tool_error penalty at 50", () => {
    const events: EventLine[] = Array.from({ length: 20 }, (_, i) => ({
      ts: `${i}`,
      type: "tool_error",
      tool: "Bash",
      exit_code: 1,
    }));
    const r = makeRecord({
      run: {
        ...makeRecord().run,
        wall_clock_ms: 100,
        wall_clock_budget_ms: 1000,
      } as never,
      events,
    });
    const c = makeCase({ wall_clock_budget_ms: 1000 });
    const { score } = scoreRun(r, c);
    // base 100 (under budget) − min(50, 200) = 50.
    expect(score.components.efficiency.raw_subscore).toBe(50);
  });
});

describe("scorer / sum-of-weighted invariant on the synthetic-fail run", () => {
  let workDir: string;
  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), "scorer-sum-"));
  });
  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it("guild_score is the sum of every component.weighted (rounded)", async () => {
    const { runDir } = await importFixture({
      fixturePath: join(FIXTURES, "synthetic-fail"),
      runsDir: workDir,
      runId: "sum-fail",
    });
    const record = await loadRunRecord(runDir);
    const c = await loadCase(join(CASES_DIR, "demo-url-shortener-build.yaml"));
    const { score } = scoreRun(record, c);
    const sum =
      score.components.outcome.weighted +
      score.components.delegation.weighted +
      score.components.gates.weighted +
      score.components.evidence.weighted +
      score.components.loop_response.weighted +
      score.components.efficiency.weighted;
    expect(Math.abs(score.guild_score - Math.round(sum * 100) / 100)).toBeLessThan(
      0.01,
    );
  });
});
