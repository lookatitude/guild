import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  compareSets,
  defaultComparisonPath,
} from "../src/compare.js";
import type { RunJson, Score } from "../src/types.js";

interface SeedOpts {
  status?: RunJson["status"];
  guild_score?: number;
  plugin_ref?: string;
  model_ref?: Record<string, string>;
  outcome?: number;
}

async function seedRun(
  runsDir: string,
  runId: string,
  opts: SeedOpts = {},
): Promise<void> {
  const run: RunJson = {
    schema_version: 1,
    run_id: runId,
    case_slug: "demo",
    plugin_ref: opts.plugin_ref ?? "abc1234",
    model_ref: opts.model_ref ?? { architect: "claude-opus-4-7" },
    started_at: "2026-04-26T05:30:00Z",
    completed_at: "2026-04-26T05:50:00Z",
    status: opts.status ?? "pass",
  };
  const score: Score = {
    schema_version: 1,
    run_id: runId,
    case_slug: "demo",
    plugin_ref: run.plugin_ref,
    model_ref: run.model_ref,
    status: run.status,
    scored_at: "2026-04-26T05:51:00Z",
    partial: false,
    missing_artifacts: [],
    components: {
      outcome: {
        weight: 30,
        raw_subscore: opts.outcome ?? 100,
        max_subscore: 100,
        weighted: ((opts.outcome ?? 100) * 30) / 100,
      },
      delegation: { weight: 20, raw_subscore: 100, max_subscore: 100, weighted: 20 },
      gates: { weight: 20, raw_subscore: 100, max_subscore: 100, weighted: 20 },
      evidence: { weight: 15, raw_subscore: 100, max_subscore: 100, weighted: 15 },
      loop_response: {
        weight: 10,
        raw_subscore: 100,
        max_subscore: 100,
        weighted: 10,
      },
      efficiency: { weight: 5, raw_subscore: 100, max_subscore: 100, weighted: 5 },
    },
    guild_score: opts.guild_score ?? 100,
  };
  const dir = join(runsDir, runId);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "run.json"), JSON.stringify(run, null, 2));
  await writeFile(join(dir, "score.json"), JSON.stringify(score, null, 2));
}

describe("compare / defaultComparisonPath", () => {
  it("places output under <runsDir>/_compare/<baseline>__<candidate>.json", () => {
    expect(defaultComparisonPath("/r", "a", "b")).toBe(
      "/r/_compare/a__b.json",
    );
  });
});

describe("compare / compareSets — happy path", () => {
  let runsDir: string;
  beforeEach(async () => {
    runsDir = await mkdtemp(join(tmpdir(), "compare-happy-"));
  });
  afterEach(async () => {
    await rm(runsDir, { recursive: true, force: true });
  });

  it("computes per-component deltas and overall guild_score_delta", async () => {
    await seedRun(runsDir, "set-a-1", { guild_score: 60, outcome: 50 });
    await seedRun(runsDir, "set-a-2", { guild_score: 80, outcome: 80 });
    await seedRun(runsDir, "set-b-1", { guild_score: 100, outcome: 100 });

    const { comparison, outputPath } = await compareSets({
      runsDir,
      baseline: "set-a",
      candidate: "set-b",
    });
    expect(comparison.status).toBe("ok");
    expect(comparison.baseline.run_count).toBe(2);
    expect(comparison.candidate.run_count).toBe(1);
    expect(comparison.guild_score_delta.baseline).toBe(70);
    expect(comparison.guild_score_delta.candidate).toBe(100);
    expect(comparison.guild_score_delta.delta).toBe(30);
    expect(comparison.per_component_delta.outcome.baseline).toBe(65);
    expect(comparison.per_component_delta.outcome.candidate).toBe(100);
    expect(existsSync(outputPath)).toBe(true);
  });

  it("matches an exact set name (no prefix collision)", async () => {
    await seedRun(runsDir, "exact-name", { guild_score: 90 });
    await seedRun(runsDir, "exact-name-extra", { guild_score: 50 });
    await seedRun(runsDir, "another", { guild_score: 100 });
    const { comparison } = await compareSets({
      runsDir,
      baseline: "exact-name",
      candidate: "another",
    });
    // Both `exact-name` and `exact-name-extra` (prefix match) belong to
    // the baseline set; comparator treats them as one trial set.
    expect(comparison.baseline.run_count).toBe(2);
  });

  // v1.1 — surface unscored runs in the comparison artifact (not just
  // stderr). Callers can now distinguish "no skipped runs" from "we
  // silently dropped some."
  it("surfaces unscored runs in comparison.skipped_runs", async () => {
    await seedRun(runsDir, "set-a-1", { guild_score: 80 });
    await seedRun(runsDir, "set-b-1", { guild_score: 100 });
    // Seed a run.json without a score.json — this is the "unscored" case.
    const unscoredId = "set-a-2";
    const dir = join(runsDir, unscoredId);
    await mkdir(dir, { recursive: true });
    const unscoredRun: RunJson = {
      schema_version: 1,
      run_id: unscoredId,
      case_slug: "demo",
      plugin_ref: "abc1234",
      model_ref: { architect: "claude-opus-4-7" },
      started_at: "2026-04-26T05:30:00Z",
      completed_at: "2026-04-26T05:50:00Z",
      status: "pass",
    };
    await writeFile(join(dir, "run.json"), JSON.stringify(unscoredRun, null, 2));

    const { comparison } = await compareSets({
      runsDir,
      baseline: "set-a",
      candidate: "set-b",
    });
    expect(comparison.skipped_runs).toEqual([
      { run_id: unscoredId, side: "baseline", reason: "no_score_json" },
    ]);
    expect(comparison.baseline.run_count).toBe(1);
  });

  it("emits empty skipped_runs when every matched run has score.json", async () => {
    await seedRun(runsDir, "set-a-1", { guild_score: 80 });
    await seedRun(runsDir, "set-b-1", { guild_score: 100 });
    const { comparison } = await compareSets({
      runsDir,
      baseline: "set-a",
      candidate: "set-b",
    });
    expect(comparison.skipped_runs).toEqual([]);
  });
});

describe("compare / R2 model-ref filter", () => {
  let runsDir: string;
  beforeEach(async () => {
    runsDir = await mkdtemp(join(tmpdir(), "compare-r2-"));
  });
  afterEach(async () => {
    await rm(runsDir, { recursive: true, force: true });
  });

  it("excludes runs whose model_ref differs from the side's canonical signature", async () => {
    await seedRun(runsDir, "set-a-1", {
      model_ref: { architect: "claude-opus-4-7" },
    });
    await seedRun(runsDir, "set-a-2", {
      model_ref: { architect: "claude-sonnet-4-6" },
    });
    await seedRun(runsDir, "set-b-1", {
      model_ref: { architect: "claude-opus-4-7" },
    });
    const { comparison } = await compareSets({
      runsDir,
      baseline: "set-a",
      candidate: "set-b",
    });
    expect(comparison.excluded_runs.length).toBeGreaterThan(0);
    expect(comparison.status).toBe("partial");
  });

  it("returns status='no_comparable_runs' when baseline is empty", async () => {
    await seedRun(runsDir, "set-b-1");
    const { comparison } = await compareSets({
      runsDir,
      baseline: "set-a",
      candidate: "set-b",
    });
    expect(comparison.status).toBe("no_comparable_runs");
    expect(comparison.baseline.run_count).toBe(0);
  });

  it("returns status='no_comparable_runs' when canonical model_ref differs across sides", async () => {
    await seedRun(runsDir, "set-a-1", {
      model_ref: { architect: "claude-opus-4-7" },
    });
    await seedRun(runsDir, "set-b-1", {
      model_ref: { architect: "claude-sonnet-4-6" },
    });
    const { comparison } = await compareSets({
      runsDir,
      baseline: "set-a",
      candidate: "set-b",
    });
    expect(comparison.status).toBe("no_comparable_runs");
  });

  it("treats model_ref maps with different key counts as not equal", async () => {
    await seedRun(runsDir, "set-a-1", {
      model_ref: { architect: "claude-opus-4-7", backend: "claude-sonnet-4-6" },
    });
    await seedRun(runsDir, "set-b-1", {
      model_ref: { architect: "claude-opus-4-7" },
    });
    const { comparison } = await compareSets({
      runsDir,
      baseline: "set-a",
      candidate: "set-b",
    });
    expect(comparison.status).toBe("no_comparable_runs");
  });
});

describe("compare / silently skips runs missing score.json (T2 documented behaviour)", () => {
  let runsDir: string;
  beforeEach(async () => {
    runsDir = await mkdtemp(join(tmpdir(), "compare-skip-"));
  });
  afterEach(async () => {
    await rm(runsDir, { recursive: true, force: true });
  });

  it("does not include a directory that has run.json but no score.json", async () => {
    await seedRun(runsDir, "set-a-1");
    const lonelyDir = join(runsDir, "set-a-2");
    await mkdir(lonelyDir, { recursive: true });
    await writeFile(
      join(lonelyDir, "run.json"),
      JSON.stringify(
        {
          schema_version: 1,
          run_id: "set-a-2",
          case_slug: "demo",
          plugin_ref: "abc1234",
          model_ref: { architect: "claude-opus-4-7" },
          started_at: "2026-04-26T05:30:00Z",
          completed_at: "2026-04-26T05:50:00Z",
          status: "pass",
        },
        null,
        2,
      ),
    );
    await seedRun(runsDir, "set-b-1");
    const { comparison } = await compareSets({
      runsDir,
      baseline: "set-a",
      candidate: "set-b",
    });
    expect(comparison.baseline.run_count).toBe(1);
  });

  it("ignores the _compare directory itself when enumerating runs", async () => {
    await seedRun(runsDir, "set-a-1");
    await seedRun(runsDir, "set-b-1");
    // Pre-existing _compare dir from a previous run shouldn't be picked up.
    await mkdir(join(runsDir, "_compare"), { recursive: true });
    const { comparison } = await compareSets({
      runsDir,
      baseline: "set-a",
      candidate: "set-b",
    });
    expect(comparison.status).toBe("ok");
  });

  it("returns no_comparable_runs against a non-existent runs dir", async () => {
    const fake = join(runsDir, "does-not-exist");
    const { comparison } = await compareSets({
      runsDir: fake,
      baseline: "set-a",
      candidate: "set-b",
    });
    expect(comparison.status).toBe("no_comparable_runs");
  });
});

describe("compare / honours custom outputPath", () => {
  let runsDir: string;
  beforeEach(async () => {
    runsDir = await mkdtemp(join(tmpdir(), "compare-out-"));
  });
  afterEach(async () => {
    await rm(runsDir, { recursive: true, force: true });
  });

  it("writes to the explicit --output path when provided", async () => {
    await seedRun(runsDir, "set-a-1");
    await seedRun(runsDir, "set-b-1");
    const out = join(runsDir, "custom", "report.json");
    const { outputPath } = await compareSets({
      runsDir,
      baseline: "set-a",
      candidate: "set-b",
      outputPath: out,
    });
    expect(outputPath).toBe(out);
    expect(existsSync(out)).toBe(true);
  });
});
