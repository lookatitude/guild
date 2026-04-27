// compare.reflection-applied.test.ts
//
// Pins the comparator's P4 reflection-annotation behaviour. The
// comparator's contract:
//   - When `compareSets` is called WITHOUT a manifest → no
//     `reflection_applied` field. Backward-compat with P1/P2/P3
//     comparisons is the load-bearing invariant.
//   - When `compareSets` is called WITH a manifest whose
//     `baseline_run_id` AND `applied_proposal.candidate_run_id` are both
//     present in the matched run sets → `reflection_applied` is
//     populated with the architect-§3.4 fields.
//   - When the manifest's run-ids do NOT match the matched sets →
//     `reflection_applied` is absent (architect §3.3 mismatched-proposal
//     handling). Stderr emits a structured warning.
//   - `kept` is computed by architect §5.1: guild_score_delta >=
//     keep_threshold AND every per_component_delta >= regression_threshold.
//   - `delta_summary.worst_component` names the lowest-delta component.

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  compareSets,
  DEFAULT_KEEP_THRESHOLD,
  DEFAULT_REGRESSION_THRESHOLD,
} from "../src/compare.js";
import type { LoopManifest, RunJson, Score } from "../src/types.js";

interface SeedOpts {
  guild_score?: number;
  outcome?: number;
  delegation?: number;
  gates?: number;
  evidence?: number;
  loop_response?: number;
  efficiency?: number;
  status?: RunJson["status"];
  plugin_ref?: string;
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
    model_ref: { architect: "claude-opus-4-7" },
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
        raw_subscore: opts.outcome ?? 80,
        max_subscore: 100,
        weighted: ((opts.outcome ?? 80) * 30) / 100,
      },
      delegation: {
        weight: 20,
        raw_subscore: opts.delegation ?? 80,
        max_subscore: 100,
        weighted: ((opts.delegation ?? 80) * 20) / 100,
      },
      gates: {
        weight: 20,
        raw_subscore: opts.gates ?? 80,
        max_subscore: 100,
        weighted: ((opts.gates ?? 80) * 20) / 100,
      },
      evidence: {
        weight: 15,
        raw_subscore: opts.evidence ?? 80,
        max_subscore: 100,
        weighted: ((opts.evidence ?? 80) * 15) / 100,
      },
      loop_response: {
        weight: 10,
        raw_subscore: opts.loop_response ?? 80,
        max_subscore: 100,
        weighted: ((opts.loop_response ?? 80) * 10) / 100,
      },
      efficiency: {
        weight: 5,
        raw_subscore: opts.efficiency ?? 80,
        max_subscore: 100,
        weighted: ((opts.efficiency ?? 80) * 5) / 100,
      },
    },
    guild_score: opts.guild_score ?? 80,
  };
  const dir = join(runsDir, runId);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "run.json"), JSON.stringify(run, null, 2));
  await writeFile(join(dir, "score.json"), JSON.stringify(score, null, 2));
}

function buildManifest(opts: {
  baselineRunId: string;
  candidateRunId: string;
  pluginRefBefore?: string;
  pluginRefAfter?: string;
  proposalId?: string;
  state?: LoopManifest["state"];
}): LoopManifest {
  return {
    schema_version: 1,
    baseline_run_id: opts.baselineRunId,
    case_slug: "demo",
    plugin_ref_before: opts.pluginRefBefore ?? "abc1234",
    available_proposals: [
      {
        proposal_id: opts.proposalId ?? "ref-fixture",
        source_path: "agents/architect.md",
        summary: "synthetic proposal for compare tests",
      },
    ],
    started_at: "2026-04-26T05:00:00Z",
    state: opts.state ?? "completed",
    applied_proposal: {
      proposal_id: opts.proposalId ?? "ref-fixture",
      source_path: "agents/architect.md",
      applied_at: "2026-04-26T05:30:00Z",
      plugin_ref_after: opts.pluginRefAfter ?? "def5678",
      candidate_run_id: opts.candidateRunId,
    },
  };
}

describe("compare / reflection_applied — presence (loop-produced manifest)", () => {
  let runsDir: string;
  beforeEach(async () => {
    runsDir = await mkdtemp(join(tmpdir(), "compare-refl-"));
  });
  afterEach(async () => {
    await rm(runsDir, { recursive: true, force: true });
  });

  it("annotates reflection_applied when manifest's run-ids match both sides", async () => {
    await seedRun(runsDir, "set-a-1", { guild_score: 70, outcome: 70 });
    await seedRun(runsDir, "set-b-1", { guild_score: 90, outcome: 95 });
    const manifest = buildManifest({
      baselineRunId: "set-a-1",
      candidateRunId: "set-b-1",
      pluginRefBefore: "abc1234",
      pluginRefAfter: "def5678",
      proposalId: "ref-helpful",
    });

    const { comparison } = await compareSets({
      runsDir,
      baseline: "set-a",
      candidate: "set-b",
      manifest,
      write: false,
    });

    expect(comparison.reflection_applied).toBeDefined();
    expect(comparison.reflection_applied?.proposal_id).toBe("ref-helpful");
    expect(comparison.reflection_applied?.plugin_ref_before).toBe("abc1234");
    expect(comparison.reflection_applied?.plugin_ref_after).toBe("def5678");
    expect(comparison.reflection_applied?.source_path).toBe("agents/architect.md");
    expect(typeof comparison.reflection_applied?.applied_at).toBe("string");
  });

  it("kept=true when delta >= keep_threshold AND no component regresses past -1", async () => {
    // baseline: 70, candidate: 90 → delta=20 (>= 2.0), every component
    // delta is non-negative → kept must be true.
    await seedRun(runsDir, "set-a-1", { guild_score: 70, outcome: 70 });
    await seedRun(runsDir, "set-b-1", { guild_score: 90, outcome: 90 });
    const manifest = buildManifest({
      baselineRunId: "set-a-1",
      candidateRunId: "set-b-1",
    });
    const { comparison } = await compareSets({
      runsDir,
      baseline: "set-a",
      candidate: "set-b",
      manifest,
      write: false,
    });
    expect(comparison.reflection_applied?.kept).toBe(true);
    expect(comparison.reflection_applied?.delta_summary.guild_score_delta).toBe(
      comparison.guild_score_delta.delta,
    );
  });

  it("kept=false when ANY component regresses below regression_threshold", async () => {
    // baseline=80 across the board; candidate's gates regresses to 50
    // (component delta = -30). Even with a positive guild_score_delta,
    // kept must be false because gates < -1.0.
    await seedRun(runsDir, "set-a-1", { guild_score: 80, gates: 80 });
    // Boost outcome enough that the aggregate delta clears keep_threshold
    // (otherwise we'd be testing two failure modes at once).
    await seedRun(runsDir, "set-b-1", {
      guild_score: 86,
      outcome: 100,
      gates: 50,
    });
    const manifest = buildManifest({
      baselineRunId: "set-a-1",
      candidateRunId: "set-b-1",
    });
    const { comparison } = await compareSets({
      runsDir,
      baseline: "set-a",
      candidate: "set-b",
      manifest,
      write: false,
    });
    expect(comparison.reflection_applied?.kept).toBe(false);
    expect(comparison.reflection_applied?.delta_summary.worst_component).toBe(
      "gates",
    );
    expect(
      comparison.reflection_applied?.delta_summary.worst_component_delta,
    ).toBeLessThan(DEFAULT_REGRESSION_THRESHOLD);
  });

  it("kept=false when delta < keep_threshold (even with no regressions)", async () => {
    // baseline=80, candidate=81 → delta=1.0, below keep_threshold of 2.0.
    // No component regresses; still must NOT be kept.
    await seedRun(runsDir, "set-a-1", { guild_score: 80 });
    await seedRun(runsDir, "set-b-1", {
      guild_score: 81,
      outcome: 81,
      delegation: 81,
      gates: 81,
      evidence: 81,
      loop_response: 81,
      efficiency: 81,
    });
    const manifest = buildManifest({
      baselineRunId: "set-a-1",
      candidateRunId: "set-b-1",
    });
    const { comparison } = await compareSets({
      runsDir,
      baseline: "set-a",
      candidate: "set-b",
      manifest,
      write: false,
    });
    expect(comparison.guild_score_delta.delta).toBeLessThan(
      DEFAULT_KEEP_THRESHOLD,
    );
    expect(comparison.reflection_applied?.kept).toBe(false);
  });

  it("respects per-call keepThreshold + regressionThreshold overrides (architect §5.3)", async () => {
    await seedRun(runsDir, "set-a-1", { guild_score: 80 });
    await seedRun(runsDir, "set-b-1", { guild_score: 81 });
    const manifest = buildManifest({
      baselineRunId: "set-a-1",
      candidateRunId: "set-b-1",
    });
    // Loosened threshold of 0.5 means a delta of 1.0 clears it → kept=true.
    const { comparison } = await compareSets({
      runsDir,
      baseline: "set-a",
      candidate: "set-b",
      manifest,
      write: false,
      keepThreshold: 0.5,
      regressionThreshold: -5.0,
    });
    expect(comparison.reflection_applied?.kept).toBe(true);
  });
});

describe("compare / reflection_applied — absence (manual / non-loop comparison)", () => {
  let runsDir: string;
  beforeEach(async () => {
    runsDir = await mkdtemp(join(tmpdir(), "compare-refl-absent-"));
  });
  afterEach(async () => {
    await rm(runsDir, { recursive: true, force: true });
  });

  it("does NOT annotate reflection_applied when no manifest is passed (P3 backward-compat)", async () => {
    await seedRun(runsDir, "set-a-1", { guild_score: 70 });
    await seedRun(runsDir, "set-b-1", { guild_score: 90 });
    const { comparison } = await compareSets({
      runsDir,
      baseline: "set-a",
      candidate: "set-b",
      write: false,
    });
    expect(comparison.reflection_applied).toBeUndefined();
  });

  it("does NOT annotate when manifest.applied_proposal is undefined (loop --start ran but --continue never did)", async () => {
    await seedRun(runsDir, "set-a-1");
    await seedRun(runsDir, "set-b-1");
    const manifest: LoopManifest = {
      schema_version: 1,
      baseline_run_id: "set-a-1",
      case_slug: "demo",
      plugin_ref_before: "abc1234",
      available_proposals: [],
      started_at: "2026-04-26T05:00:00Z",
      state: "awaiting-apply",
    };
    const { comparison } = await compareSets({
      runsDir,
      baseline: "set-a",
      candidate: "set-b",
      manifest,
      write: false,
    });
    expect(comparison.reflection_applied).toBeUndefined();
  });
});

describe("compare / reflection_applied — mismatch (architect §3.3 handling)", () => {
  let runsDir: string;
  beforeEach(async () => {
    runsDir = await mkdtemp(join(tmpdir(), "compare-refl-mis-"));
  });
  afterEach(async () => {
    await rm(runsDir, { recursive: true, force: true });
  });

  it("returns no reflection_applied when manifest baseline_run_id is absent from baseline set", async () => {
    await seedRun(runsDir, "set-a-1");
    await seedRun(runsDir, "set-b-1");
    const manifest = buildManifest({
      baselineRunId: "this-id-is-not-in-set-a",
      candidateRunId: "set-b-1",
    });
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    try {
      const { comparison } = await compareSets({
        runsDir,
        baseline: "set-a",
        candidate: "set-b",
        manifest,
        write: false,
      });
      expect(comparison.reflection_applied).toBeUndefined();
      expect(stderr).toHaveBeenCalled();
      const calls = stderr.mock.calls.map((c) => String(c[0])).join("\n");
      expect(calls).toMatch(/baseline_run_id/);
    } finally {
      stderr.mockRestore();
    }
  });

  it("returns no reflection_applied when manifest candidate_run_id is absent from candidate set", async () => {
    await seedRun(runsDir, "set-a-1");
    await seedRun(runsDir, "set-b-1");
    const manifest = buildManifest({
      baselineRunId: "set-a-1",
      candidateRunId: "this-id-is-not-in-set-b",
    });
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    try {
      const { comparison } = await compareSets({
        runsDir,
        baseline: "set-a",
        candidate: "set-b",
        manifest,
        write: false,
      });
      expect(comparison.reflection_applied).toBeUndefined();
      const calls = stderr.mock.calls.map((c) => String(c[0])).join("\n");
      expect(calls).toMatch(/candidate_run_id/);
    } finally {
      stderr.mockRestore();
    }
  });

  it("does not annotate when proposal_id in applied differs from any in available_proposals (independent ids)", async () => {
    // The annotator only requires both run-ids to be present; it doesn't
    // re-validate proposal_id membership (validateContinue already enforced
    // that pre-spawn). We assert annotated metadata reflects the
    // applied_proposal.proposal_id even when it would not match available.
    await seedRun(runsDir, "set-a-1", { guild_score: 70 });
    await seedRun(runsDir, "set-b-1", { guild_score: 90 });
    const manifest: LoopManifest = {
      schema_version: 1,
      baseline_run_id: "set-a-1",
      case_slug: "demo",
      plugin_ref_before: "abc1234",
      available_proposals: [
        {
          proposal_id: "available-only",
          source_path: "x.md",
          summary: "x",
        },
      ],
      started_at: "2026-04-26T05:00:00Z",
      state: "completed",
      applied_proposal: {
        proposal_id: "applied-only",
        source_path: "y.md",
        applied_at: "2026-04-26T06:00:00Z",
        plugin_ref_after: "def5678",
        candidate_run_id: "set-b-1",
      },
    };
    const { comparison } = await compareSets({
      runsDir,
      baseline: "set-a",
      candidate: "set-b",
      manifest,
      write: false,
    });
    expect(comparison.reflection_applied?.proposal_id).toBe("applied-only");
  });
});

describe("compare / reflection_applied — delta_summary.worst_component picks the smallest delta", () => {
  let runsDir: string;
  beforeEach(async () => {
    runsDir = await mkdtemp(join(tmpdir(), "compare-refl-worst-"));
  });
  afterEach(async () => {
    await rm(runsDir, { recursive: true, force: true });
  });

  it("identifies efficiency as the worst component when efficiency regresses most", async () => {
    await seedRun(runsDir, "set-a-1", {
      guild_score: 80,
      outcome: 80,
      delegation: 80,
      gates: 80,
      evidence: 80,
      loop_response: 80,
      efficiency: 80,
    });
    await seedRun(runsDir, "set-b-1", {
      guild_score: 84, // overall delta clears keep_threshold
      outcome: 100,
      delegation: 80,
      gates: 79,
      evidence: 80,
      loop_response: 80,
      efficiency: 65, // worst regression: -15
    });
    const manifest = buildManifest({
      baselineRunId: "set-a-1",
      candidateRunId: "set-b-1",
    });
    const { comparison } = await compareSets({
      runsDir,
      baseline: "set-a",
      candidate: "set-b",
      manifest,
      write: false,
    });
    expect(comparison.reflection_applied?.delta_summary.worst_component).toBe(
      "efficiency",
    );
    expect(
      comparison.reflection_applied?.delta_summary.worst_component_delta,
    ).toBe(-15);
  });
});
