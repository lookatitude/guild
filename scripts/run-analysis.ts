#!/usr/bin/env -S npx tsx

import * as path from "node:path";

import {
  analyzeRun,
  compareRuns,
  decideRecommendation,
  resolveComparisonTarget,
  updateRecommendationStatus,
  writeRunAnalysis,
  writeRunComparison,
  type ComparisonTarget,
  type RecommendationStatus,
} from "../src/modules/telemetry";

function usage(message?: string): never {
  if (message) process.stderr.write(`[run-analysis] ${message}\n`);
  process.stderr.write(
    "usage:\n" +
      "  run-analysis run analyze <run-id> [--cwd <root>]\n" +
      "  run-analysis run compare <run-id> <run-id...> [--cwd <root>]\n" +
      "  run-analysis initiative analyze <initiative-id> [--cwd <root>]\n" +
      "  run-analysis independent-runs analyze <group-id> [--cwd <root>]\n" +
      "  run-analysis recommendation decide <source-id> <recommendation-id> <accept|reject> [--cwd <root>]\n" +
      "  run-analysis recommendation status <source-id> <recommendation-id> <status> [--cwd <root>]\n",
  );
  process.exit(2);
}

function argumentsWithoutFlags(argv: string[]): { cwd: string; positional: string[] } {
  let cwd = process.cwd();
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--cwd") {
      if (!argv[i + 1]) usage("--cwd requires a path");
      cwd = path.resolve(argv[++i]);
    } else if (argv[i].startsWith("--")) {
      usage(`unknown option: ${argv[i]}`);
    } else {
      positional.push(argv[i]);
    }
  }
  return { cwd, positional };
}

function compareTarget(cwd: string, target: ComparisonTarget): void {
  const analyses = resolveComparisonTarget(cwd, target);
  if (analyses.length < 2) {
    throw new Error(`comparison target resolved ${analyses.length} run(s); at least two are required`);
  }
  analyses.forEach((analysis) => writeRunAnalysis(cwd, analysis));
  const comparison = compareRuns(analyses);
  const written = writeRunComparison(cwd, comparison);
  process.stdout.write(`${JSON.stringify({ ok: true, comparison_id: comparison.comparison_id, run_ids: comparison.run_ids, written }, null, 2)}\n`);
}

export function main(argv: string[]): void {
  const { cwd, positional } = argumentsWithoutFlags(argv);
  const [surface, action, ...ids] = positional;
  if (surface === "run" && action === "analyze" && ids.length === 1) {
    const analysis = analyzeRun(cwd, ids[0]);
    const written = writeRunAnalysis(cwd, analysis);
    process.stdout.write(`${JSON.stringify({ ok: true, analysis_id: analysis.analysis_id, eligible: analysis.eligible, written }, null, 2)}\n`);
    return;
  }
  if (surface === "run" && action === "compare" && ids.length >= 2) {
    compareTarget(cwd, { kind: "runs", ids });
    return;
  }
  if (surface === "initiative" && action === "analyze" && ids.length === 1) {
    compareTarget(cwd, { kind: "initiative", id: ids[0] });
    return;
  }
  if (surface === "independent-runs" && action === "analyze" && ids.length === 1) {
    compareTarget(cwd, { kind: "independent", id: ids[0] });
    return;
  }
  if (surface === "recommendation" && action === "decide" && ids.length === 3 && (ids[2] === "accept" || ids[2] === "reject")) {
    process.stdout.write(`${JSON.stringify({ ok: true, ...decideRecommendation(cwd, ids[0], ids[1], ids[2]) }, null, 2)}\n`);
    return;
  }
  const statuses = new Set<RecommendationStatus>(["filed", "implemented", "superseded"]);
  if (surface === "recommendation" && action === "status" && ids.length === 3 && statuses.has(ids[2] as RecommendationStatus)) {
    process.stdout.write(`${JSON.stringify({ ok: true, ...updateRecommendationStatus(cwd, ids[0], ids[1], ids[2] as RecommendationStatus) }, null, 2)}\n`);
    return;
  }
  usage("invalid command");
}

try {
  main(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`[run-analysis] ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
