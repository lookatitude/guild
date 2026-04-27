import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type {
  Comparison,
  ComponentDelta,
  ComponentKey,
  ExcludedRun,
  LoopManifest,
  ReflectionApplied,
  RunJson,
  Score,
  SkippedRun,
  TrialSetSummary,
} from "./types.js";
import { COMPONENT_KEYS, SCHEMA_VERSION } from "./types.js";

// P4 — keep/discard thresholds locked by
// `benchmark/plans/p4-learning-loop-architecture.md §5.1`. Inclusive
// boundaries (`>=`, not `>`) per architect §5.2 worked-example pin.
export const DEFAULT_KEEP_THRESHOLD = 2.0;
export const DEFAULT_REGRESSION_THRESHOLD = -1.0;

export interface CompareOpts {
  runsDir: string;
  baseline: string;
  candidate: string;
  outputPath?: string;
  // Server pass-through reads (P2): compute the comparison without writing
  // a `_compare/*.json` artifact. Default true preserves CLI behavior.
  write?: boolean;
  // P4 — when supplied, and when manifest.baseline_run_id +
  // manifest.applied_proposal.candidate_run_id are both present in the
  // run sets, the resulting Comparison is annotated with
  // reflection_applied per architect §3.4. Otherwise unchanged.
  manifest?: LoopManifest;
  // P4 — per-case override knob (architect §5.3). Optional; defaults
  // apply when absent. Inclusive boundary semantics (architect §5.2).
  keepThreshold?: number;
  regressionThreshold?: number;
}

export interface CompareResult {
  comparison: Comparison;
  outputPath: string;
}

// Default output path matches architect's tentative convention
// (plans/01-architecture.md §3 / §6): runs/_compare/<baseline>__<candidate>.json.
// Backend confirmed this path in T2 — see handoffs/T2-backend.md decisions.
export function defaultComparisonPath(
  runsDir: string,
  baseline: string,
  candidate: string,
): string {
  return join(runsDir, "_compare", `${baseline}__${candidate}.json`);
}

interface SetRun {
  run: RunJson;
  score: Score;
  run_id: string;
}

interface CollectResult {
  runs: SetRun[];
  skipped: string[];
}

export async function compareSets(opts: CompareOpts): Promise<CompareResult> {
  const runsDir = resolve(opts.runsDir);
  const baselineCollect = await collectRunsForSet(runsDir, opts.baseline);
  const candidateCollect = await collectRunsForSet(runsDir, opts.candidate);
  const baselineRuns = baselineCollect.runs;
  const candidateRuns = candidateCollect.runs;
  const skippedRuns: SkippedRun[] = [
    ...baselineCollect.skipped.map((id) => ({
      run_id: id,
      side: "baseline" as const,
      reason: "no_score_json" as const,
    })),
    ...candidateCollect.skipped.map((id) => ({
      run_id: id,
      side: "candidate" as const,
      reason: "no_score_json" as const,
    })),
  ];

  const baseline = summariseSet(opts.baseline, baselineRuns);
  const candidate = summariseSet(opts.candidate, candidateRuns);

  const excluded: ExcludedRun[] = [
    ...filterMismatched(baselineRuns, baseline.canonical_model_ref, "baseline"),
    ...filterMismatched(candidateRuns, candidate.canonical_model_ref, "candidate"),
  ];

  let status: Comparison["status"] = "ok";
  if (
    baselineRuns.length === 0 ||
    candidateRuns.length === 0 ||
    !modelRefEqual(baseline.canonical_model_ref, candidate.canonical_model_ref)
  ) {
    status = "no_comparable_runs";
  } else if (excluded.length > 0) {
    status = "partial";
  }

  const per_component_delta = {} as Record<ComponentKey, ComponentDelta>;
  for (const key of COMPONENT_KEYS) {
    const b = meanComponent(baselineRuns, key);
    const c = meanComponent(candidateRuns, key);
    per_component_delta[key] = { baseline: b, candidate: c, delta: round2(c - b) };
  }

  const guild_score_delta: ComponentDelta = {
    baseline: baseline.mean_guild_score,
    candidate: candidate.mean_guild_score,
    delta: round2(candidate.mean_guild_score - baseline.mean_guild_score),
  };

  const comparison: Comparison = {
    schema_version: SCHEMA_VERSION,
    baseline,
    candidate,
    status,
    excluded_runs: excluded,
    skipped_runs: skippedRuns,
    per_component_delta,
    guild_score_delta,
    generated_at: new Date().toISOString(),
  };

  // P4 — annotate with reflection_applied iff the loop wired both runs.
  // M12 — keep/discard rule computed server-side; full per-component
  // delta remains the source of truth (frontend renders the table).
  if (opts.manifest !== undefined) {
    const annotated = maybeAnnotateReflection(
      comparison,
      opts.manifest,
      baselineRuns,
      candidateRuns,
      {
        keepThreshold: opts.keepThreshold ?? DEFAULT_KEEP_THRESHOLD,
        regressionThreshold: opts.regressionThreshold ?? DEFAULT_REGRESSION_THRESHOLD,
      },
    );
    if (annotated !== undefined) {
      comparison.reflection_applied = annotated;
    }
  }

  const outputPath =
    opts.outputPath ?? defaultComparisonPath(runsDir, opts.baseline, opts.candidate);
  if (opts.write !== false) {
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, JSON.stringify(comparison, null, 2) + "\n");
  }
  return { comparison, outputPath };
}

// P4 — return a populated ReflectionApplied iff the manifest's run-ids
// match exactly one run on each side. Otherwise return undefined (the
// caller leaves comparison.reflection_applied unset, preserving
// backward-compat with non-loop comparisons per architect §3.3).
function maybeAnnotateReflection(
  comparison: Comparison,
  manifest: LoopManifest,
  baselineRuns: SetRun[],
  candidateRuns: SetRun[],
  thresholds: { keepThreshold: number; regressionThreshold: number },
): ReflectionApplied | undefined {
  const applied = manifest.applied_proposal;
  if (applied === undefined) return undefined;
  const baselineMatch = baselineRuns.some((r) => r.run_id === manifest.baseline_run_id);
  const candidateMatch = candidateRuns.some((r) => r.run_id === applied.candidate_run_id);
  if (!baselineMatch) {
    process.stderr.write(
      `compare: manifest baseline_run_id "${manifest.baseline_run_id}" missing score.json or absent from baseline set; reflection_applied not annotated\n`,
    );
    return undefined;
  }
  if (!candidateMatch) {
    process.stderr.write(
      `compare: manifest applied_proposal.candidate_run_id "${applied.candidate_run_id}" absent from candidate set; reflection_applied not annotated\n`,
    );
    return undefined;
  }

  // Compute keep/discard per architect §5.1. Inclusive boundary (>=).
  const meetsKeep = comparison.guild_score_delta.delta >= thresholds.keepThreshold;
  let worstKey: ComponentKey = COMPONENT_KEYS[0] as ComponentKey;
  let worstDelta = comparison.per_component_delta[worstKey].delta;
  for (const k of COMPONENT_KEYS) {
    const d = comparison.per_component_delta[k].delta;
    if (d < worstDelta) {
      worstDelta = d;
      worstKey = k;
    }
  }
  const noRegression = COMPONENT_KEYS.every(
    (k) => comparison.per_component_delta[k].delta >= thresholds.regressionThreshold,
  );
  const kept = meetsKeep && noRegression;

  return {
    proposal_id: applied.proposal_id,
    source_path: applied.source_path,
    applied_at: applied.applied_at,
    plugin_ref_before: manifest.plugin_ref_before,
    plugin_ref_after: applied.plugin_ref_after,
    kept,
    delta_summary: {
      guild_score_delta: comparison.guild_score_delta.delta,
      worst_component_delta: worstDelta,
      worst_component: worstKey,
    },
  };
}

async function collectRunsForSet(runsDir: string, setId: string): Promise<CollectResult> {
  if (!existsSync(runsDir)) return { runs: [], skipped: [] };
  const entries = await readdir(runsDir, { withFileTypes: true });
  const matches: SetRun[] = [];
  const skipped: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name === "_compare") continue;
    // Match on exact id OR set-prefix (`<setId>-<n>` repetitions).
    const matchesSet = entry.name === setId || entry.name.startsWith(`${setId}-`);
    if (!matchesSet) continue;
    const runDir = join(runsDir, entry.name);
    const runPath = join(runDir, "run.json");
    const scorePath = join(runDir, "score.json");
    if (!existsSync(runPath)) continue;
    if (!existsSync(scorePath)) {
      // v1.1 — track skipped runs in the comparison artifact (Comparison.skipped_runs)
      // in addition to the existing stderr line. Callers can now distinguish
      // "no skipped runs" from "we silently dropped some."
      process.stderr.write(`compare: skipping ${entry.name} — no score.json\n`);
      skipped.push(entry.name);
      continue;
    }
    const run = JSON.parse(await readFile(runPath, "utf8")) as RunJson;
    const score = JSON.parse(await readFile(scorePath, "utf8")) as Score;
    matches.push({ run, score, run_id: entry.name });
  }
  return { runs: matches, skipped };
}

function summariseSet(setId: string, runs: SetRun[]): TrialSetSummary {
  return {
    set_id: setId,
    run_count: runs.length,
    pass_count: runs.filter((r) => r.run.status === "pass").length,
    fail_count: runs.filter((r) => r.run.status === "fail").length,
    timeout_count: runs.filter((r) => r.run.status === "timeout").length,
    errored_count: runs.filter((r) => r.run.status === "errored").length,
    mean_guild_score:
      runs.length === 0
        ? 0
        : round2(runs.reduce((acc, r) => acc + r.score.guild_score, 0) / runs.length),
    canonical_model_ref: runs[0]?.run.model_ref ?? {},
    canonical_plugin_ref: runs[0]?.run.plugin_ref ?? "",
    runs: runs.map((r) => ({
      run_id: r.run_id,
      status: r.run.status,
      guild_score: r.score.guild_score,
      plugin_ref: r.run.plugin_ref,
      model_ref: r.run.model_ref,
    })),
  };
}

// R2 mitigation: runs whose model_ref differs from the canonical signature
// of their side are excluded — never silently scored across drifting models.
function filterMismatched(
  runs: SetRun[],
  canonical: Record<string, string>,
  side: "baseline" | "candidate",
): ExcludedRun[] {
  return runs
    .filter((r) => !modelRefEqual(r.run.model_ref, canonical))
    .map((r) => ({
      run_id: r.run_id,
      side,
      reason: `model_ref differs from canonical (${JSON.stringify(canonical)} vs ${JSON.stringify(r.run.model_ref)})`,
    }));
}

function modelRefEqual(a: Record<string, string>, b: Record<string, string>): boolean {
  const aKeys = Object.keys(a).sort();
  const bKeys = Object.keys(b).sort();
  if (aKeys.length !== bKeys.length) return false;
  for (const k of aKeys) if (a[k] !== b[k]) return false;
  return true;
}

function meanComponent(runs: SetRun[], key: ComponentKey): number {
  if (runs.length === 0) return 0;
  const sum = runs.reduce((acc, r) => acc + r.score.components[key].raw_subscore, 0);
  return round2(sum / runs.length);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
