#!/usr/bin/env -S npx tsx
/**
 * scripts/audit-run-sinks.ts
 *
 * rf-wi-02 (G2) — the deterministic dispatch-integrity gate `guild:verify-done`
 * runs as check #6. Reads a run's two dedicated sinks via scripts/lib/run-sinks.ts
 * and reports whether the run is dispatch-clean:
 *
 *   - `logs/backend-degradation.jsonl` — any lane that ran on a downgraded backend.
 *   - `logs/tier-dispatch.jsonl`       — any dispatch that violated the tier contract
 *                                        (incl. un-tiered `missing_model`).
 *
 * verify.md is authored by an LLM gate and summary.md may not exist yet at verify
 * time, so verify-done cannot lean on the summary — it gates on THIS exit code:
 *   exit 0  clean (no degradations, no tier violations) — check passes.
 *   exit 1  dirty — the run must not close clean; the findings print to stdout.
 *   exit 2  bad input (missing --run-id).
 *
 * The audit section prints to stdout on both clean and dirty so it can be pasted
 * verbatim into verify.md's check-6 evidence line.
 *
 * Usage:
 *   audit-run-sinks.ts --run-id <id> [--cwd <path>]
 */

import * as path from "path";
import { isRunSinkDirty, loadRunSinks, renderSinkAuditSection } from "./lib/run-sinks";

function parseArgs(argv: string[]): { runId: string | null; cwd: string } {
  let runId: string | null = null;
  let cwd = ".";
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--run-id" && i + 1 < argv.length) runId = argv[++i];
    else if (argv[i] === "--cwd" && i + 1 < argv.length) cwd = argv[++i];
  }
  return { runId, cwd };
}

function main(): void {
  const { runId, cwd } = parseArgs(process.argv.slice(2));
  if (!runId) {
    process.stderr.write("[audit-run-sinks] ERROR: --run-id <id> is required\n");
    process.exit(2);
  }
  const runDir = path.join(path.resolve(cwd), ".guild", "runs", runId);
  const audit = loadRunSinks(runDir);
  process.stdout.write(renderSinkAuditSection(audit) + "\n");
  if (isRunSinkDirty(audit)) {
    process.stderr.write(
      `[audit-run-sinks] DIRTY: run ${runId} has ` +
        `${audit.degradations.count} backend degradation(s), ` +
        `${audit.tier.violationCount} tier-contract violation(s) ` +
        `(${audit.tier.untieredCount} un-tiered), ` +
        `${audit.parseErrors} unparseable sink line(s). verify-done check #6 FAILS.\n`
    );
    process.exit(1);
  }
  process.exit(0);
}

main();
