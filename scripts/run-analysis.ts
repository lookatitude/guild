#!/usr/bin/env -S npx tsx

import * as path from "node:path";

import {
  analyzeRun,
  compareRuns,
  decideRecommendation,
  inspectAnalysisArtifact,
  loadOrAnalyzeRun,
  resolveComparisonTarget,
  updateRecommendationStatus,
  writeRunAnalysis,
  writeRunComparison,
  type ComparisonTarget,
  type ExpectedDecisionContext,
  type RecommendationStatus,
} from "../src/domains/telemetry";

function usage(message?: string): never {
  if (message) process.stderr.write(`[run-analysis] ${message}\n`);
  process.stderr.write(
    "usage:\n" +
      "  run-analysis run analyze <run-id> [--cwd <root>]\n" +
      "  run-analysis run compare <run-id> <run-id...> [--cwd <root>]\n" +
      "  run-analysis initiative analyze <initiative-id> [--cwd <root>]\n" +
      "  run-analysis independent-runs analyze <group-id> [--cwd <root>]\n" +
      "  run-analysis artifact inspect <run|comparison> <source-id> [--cwd <root>]\n" +
      "  run-analysis recommendation decide <source-id> <recommendation-id> <accept|reject>\n" +
      "      [--expected-analysis-id <id> --expected-input-hash <sha256:hex>] [--cwd <root>]\n" +
      "  run-analysis recommendation status <source-id> <recommendation-id> <status> [--cwd <root>]\n",
  );
  process.exit(2);
}

const VALUE_FLAGS = new Set(["--cwd", "--expected-analysis-id", "--expected-input-hash"]);

function argumentsWithoutFlags(argv: string[]): { cwd: string; positional: string[]; flags: Map<string, string> } {
  const flags = new Map<string, string>();
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    if (!VALUE_FLAGS.has(arg)) usage(`unknown option: ${arg}`);
    if (flags.has(arg)) usage(`duplicate option: ${arg}`);
    const value = argv[i + 1];
    if (value === undefined || value.length === 0 || value.startsWith("--")) usage(`${arg} requires a value`);
    flags.set(arg, value);
    i++;
  }
  const cwd = flags.has("--cwd") ? path.resolve(flags.get("--cwd")!) : process.cwd();
  return { cwd, positional, flags };
}

/** Browser-bound consent needs both producer-issued values; either alone is a usage error. */
function expectedContext(flags: Map<string, string>): ExpectedDecisionContext | undefined {
  const analysisId = flags.get("--expected-analysis-id");
  const inputHash = flags.get("--expected-input-hash");
  if (analysisId === undefined && inputHash === undefined) return undefined;
  if (analysisId === undefined || inputHash === undefined) {
    usage("--expected-analysis-id and --expected-input-hash must be passed together");
  }
  return { analysisId, inputHash };
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
  const { cwd, positional, flags } = argumentsWithoutFlags(argv);
  const [surface, action, ...ids] = positional;
  const isDecide = surface === "recommendation" && action === "decide";
  if (!isDecide && (flags.has("--expected-analysis-id") || flags.has("--expected-input-hash"))) {
    usage("--expected-* flags apply only to recommendation decide");
  }
  if (surface === "run" && action === "analyze" && ids.length === 1) {
    // A current canonical artifact is reused as-is; a stale or malformed one is regenerated
    // and rewritten through the existing transaction, which preserves progressed decisions.
    const cached = loadOrAnalyzeRun(cwd, ids[0]);
    const written = cached.cache === "hit" ? null : writeRunAnalysis(cwd, cached.analysis);
    process.stdout.write(`${JSON.stringify({ ok: true, analysis_id: cached.analysis.analysis_id, eligible: cached.analysis.eligible, cache: cached.cache, reason: cached.reason, written }, null, 2)}\n`);
    return;
  }
  if (surface === "artifact" && action === "inspect" && ids.length === 2 && (ids[0] === "run" || ids[0] === "comparison")) {
    const inspection = inspectAnalysisArtifact(cwd, ids[0], ids[1]);
    process.stdout.write(`${JSON.stringify(inspection, null, 2)}\n`);
    if (inspection.state === "refused") process.exitCode = 1;
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
  if (isDecide && ids.length === 3 && (ids[2] === "accept" || ids[2] === "reject")) {
    const expected = expectedContext(flags);
    process.stdout.write(`${JSON.stringify({ ok: true, ...decideRecommendation(cwd, ids[0], ids[1], ids[2], expected) }, null, 2)}\n`);
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
