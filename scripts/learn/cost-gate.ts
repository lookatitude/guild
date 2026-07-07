#!/usr/bin/env -S npx tsx
/**
 * learn/cost-gate.ts — SC-15 pre-flight cost gate for the knowledge tier.
 *
 * Usage: npx tsx learn/cost-gate.ts [--cwd <path>] [--json]
 *
 * Reads resolveSettings().models.knowledge.{maxFiles,maxTokens} for the given
 * cwd, counts corpus files via walkRepo, estimates total LLM output tokens
 * across all K-stages, then emits a gate verdict.
 *
 * stdout (always JSON):
 *   {"gate":"pass","estimate":{"files":42,"tokens_est":12600},"reason":"within budget"}
 *   {"gate":"confirm","estimate":{...},"reason":"..."}
 *   {"gate":"abort","estimate":{...},"reason":"..."}
 *
 * Exit codes (SC-15):
 *   0  — pass or confirm (proceed; confirm means high-cost warning only)
 *   1  — abort (hard limit exceeded; caller must not proceed)
 *
 * Token estimation formula:
 *   tokens_est = files × AVG_TOKENS_PER_FILE
 *
 *   AVG_TOKENS_PER_FILE (300) is a conservative aggregate across K1–K5 LLM
 *   output passes:
 *     K1 concept/claim/entity extraction ≈  60 tok/file
 *     K2 wiki-page classification         ≈  80 tok/file
 *     K3 diagram analysis                 ≈  50 tok/file (diagrams are sparse)
 *     K4 taxonomy naming                  ≈  30 tok/file (cluster-level, few)
 *     K5 cross-link relationship extract  ≈  80 tok/file
 *     ─────────────────────────────────────────────────
 *     sum                                 ≈ 300 tok/file
 *
 * Gate thresholds (relative to resolved maxTokens):
 *   pass    : tokens_est ≤ maxTokens × CONFIRM_RATIO  AND  files ≤ maxFiles
 *   confirm : tokens_est ≤ maxTokens                  AND  files ≤ maxFiles
 *   abort   : tokens_est > maxTokens  OR  files > maxFiles
 *
 * SC-9 determinism boundary: all computation is deterministic-script; the LLM
 * is never invoked here.
 */

import { parseCwd, hasFlag } from "./lib/paths";
import { walkRepo } from "./lib/walk";
import { resolveSettings } from "../lib/settings-resolver";
import { KNOWLEDGE_CONFIG_DEFAULTS } from "./lib/schema";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Estimated total LLM output tokens per corpus file across all K-stages.
 * Combines K1–K5 pass contributions; see header for breakdown.
 */
export const AVG_TOKENS_PER_FILE = 300;

/**
 * Fraction of maxTokens above which the gate returns "confirm" instead of
 * "pass". Below this threshold the gate passes silently.
 */
export const CONFIRM_RATIO = 0.7;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CostGateEstimate {
  /** Total corpus files counted via walkRepo. */
  files: number;
  /** Estimated total LLM output tokens across all K-stages. */
  tokens_est: number;
}

export interface CostGateResult {
  gate: "pass" | "confirm" | "abort";
  estimate: CostGateEstimate;
  /** Always present. "within budget" on pass; descriptive on confirm/abort. */
  reason: string;
}

// ---------------------------------------------------------------------------
// Pure functions (deterministic, no FS)
// ---------------------------------------------------------------------------

/**
 * Estimate total LLM output tokens for a corpus of `files` files.
 * Formula: files × AVG_TOKENS_PER_FILE.
 */
export function computeTokensEstimate(files: number): number {
  return files * AVG_TOKENS_PER_FILE;
}

/**
 * Determine the gate verdict from a pre-computed estimate and config limits.
 *
 * Priority:
 *   1. files > maxFiles         → abort  (hard file-count limit)
 *   2. tokens_est > maxTokens   → abort  (hard token-budget limit)
 *   3. tokens_est > confirmThreshold → confirm (high-cost warning)
 *   4. otherwise                → pass
 */
export function gateDecision(
  estimate: CostGateEstimate,
  config: { maxFiles: number; maxTokens: number }
): CostGateResult {
  const { files, tokens_est } = estimate;
  const { maxFiles, maxTokens } = config;

  if (files > maxFiles) {
    return {
      gate: "abort",
      estimate,
      reason:
        `Corpus has ${files} files, which exceeds the maxFiles limit of ${maxFiles}. ` +
        `Reduce the corpus scope or raise models.knowledge.maxFiles in settings.json.`,
    };
  }

  if (tokens_est > maxTokens) {
    return {
      gate: "abort",
      estimate,
      reason:
        `Estimated ${tokens_est.toLocaleString()} output tokens exceeds the maxTokens limit of ` +
        `${maxTokens.toLocaleString()}. ` +
        `Reduce the corpus scope or raise models.knowledge.maxTokens in settings.json.`,
    };
  }

  const confirmThreshold = Math.floor(maxTokens * CONFIRM_RATIO);
  if (tokens_est > confirmThreshold) {
    const pct = Math.round((tokens_est / maxTokens) * 100);
    return {
      gate: "confirm",
      estimate,
      reason:
        `Estimated ${tokens_est.toLocaleString()} tokens (${pct}% of the ${maxTokens.toLocaleString()} limit). ` +
        `This is a high-cost run — confirm before proceeding.`,
    };
  }

  return { gate: "pass", estimate, reason: "within budget" };
}

/**
 * Map a gate verdict to the appropriate CLI exit code (SC-15).
 *   pass    → 0
 *   confirm → 0  (warning only; caller proceeds)
 *   abort   → 1
 */
export function gateExitCode(gate: CostGateResult["gate"]): number {
  return gate === "abort" ? 1 : 0;
}

// ---------------------------------------------------------------------------
// FS-dependent functions
// ---------------------------------------------------------------------------

/**
 * Count non-ignored files under `repoRoot` using the same walkRepo logic as
 * all other learn/ scripts.
 *
 * Passes `maxFiles + 1` as the walkRepo cap so the returned count can
 * exceed `maxFiles` and trigger the abort branch in gateDecision (SC-15).
 * Without this, a huge repo capped at walkRepo's 20,000-file default would
 * never report a count above `maxFiles` if `maxFiles` < 20,000 but the
 * corpus is huge, masking the over-limit condition.
 */
export function scanCorpusFiles(repoRoot: string, maxFiles = 20000): number {
  const { files } = walkRepo(repoRoot, maxFiles + 1);
  return files.length;
}

/**
 * Full pipeline: resolve settings → scan corpus → estimate → gate.
 *
 * Falls back to KNOWLEDGE_CONFIG_DEFAULTS when no settings file exists (e.g.
 * a bare temp directory in tests).
 *
 * Never throws — returns abort on any unexpected error.
 */
export function runCostGate(cwd: string): CostGateResult {
  // Resolve knowledge config (best-effort; fall back to defaults on error)
  let maxFiles: number = KNOWLEDGE_CONFIG_DEFAULTS.maxFiles;
  let maxTokens: number = KNOWLEDGE_CONFIG_DEFAULTS.maxTokens;
  try {
    const { config } = resolveSettings({ cwd });
    maxFiles = config.models.knowledge.maxFiles;
    maxTokens = config.models.knowledge.maxTokens;
  } catch {
    // settings resolver failed — use defaults
  }

  // Scan corpus files (pass maxFiles so walkRepo can return maxFiles+1 and
  // trigger the abort branch on huge repos — see scanCorpusFiles doc).
  let fileCount: number;
  try {
    fileCount = scanCorpusFiles(cwd, maxFiles);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      gate: "abort",
      estimate: { files: 0, tokens_est: 0 },
      reason: `Failed to scan corpus at ${cwd}: ${msg}`,
    };
  }

  const tokens_est = computeTokensEstimate(fileCount);
  const estimate: CostGateEstimate = { files: fileCount, tokens_est };
  return gateDecision(estimate, { maxFiles, maxTokens });
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

function main(): void {
  const argv = process.argv.slice(2);
  const cwd = parseCwd(argv);
  const jsonOnly = hasFlag(argv, "json");

  const result = runCostGate(cwd);
  process.stdout.write(JSON.stringify(result) + "\n");

  if (!jsonOnly && result.reason) {
    process.stderr.write(`[cost-gate] ${result.gate.toUpperCase()}: ${result.reason}\n`);
  }

  process.exit(gateExitCode(result.gate));
}

if (require.main === module) {
  main();
}
