#!/usr/bin/env -S npx tsx
/**
 * scripts/flip-report.ts
 *
 * Implements guild-plan.md §11.2 step 6 — benchmark + flip report.
 * Reads paired-subagent grading at .guild/evolve/<run-id>/grading.json (expects
 * {current: [...], proposed: [...]} with per-case {case_id, passed, ms, tokens}),
 * computes per-case P→F (regression) and F→P (fix), aggregates pass_rate +
 * duration_ms + total_tokens with mean±stddev + delta. Writes a human-readable
 * markdown report.
 *
 * Usage:
 *   scripts/flip-report.ts --run-id <id> [--cwd <path>] [--out <path>]
 *
 * Options:
 *   --run-id <id>   (required) The evolve run to report on.
 *   --cwd <path>    (optional, default ".") Repo root.
 *                   Reads <cwd>/.guild/evolve/<run-id>/grading.json.
 *   --out <path>    (optional, default <cwd>/.guild/evolve/<run-id>/flip-report.md).
 *
 * Reads:  <cwd>/.guild/evolve/<run-id>/grading.json
 * Writes: <cwd>/.guild/evolve/<run-id>/flip-report.md  (or --out override)
 *
 * Exit codes:
 *   0  Success.
 *   1  Bad input (missing --run-id, grading.json missing or malformed).
 *   2  Internal error.
 *
 * Invariant: never writes to .guild/wiki/. Writes only to the run-specific
 *             flip-report.md under .guild/evolve/<run-id>/.
 */

import * as fs from "fs";
import * as path from "path";

// ── Types ──────────────────────────────────────────────────────────────────

interface CaseResult {
  case_id: string;
  passed: boolean;
  ms: number;
  tokens: number;
}

interface Grading {
  current: CaseResult[];
  proposed: CaseResult[];
}

interface Aggregate {
  n: number;
  passRate: number;
  durationMean: number;
  durationStddev: number;
  tokensTotal: number;
  tokensMean: number;
  tokensStddev: number;
}

interface FlipPair {
  case_id: string;
  current: CaseResult | null;
  proposed: CaseResult | null;
  kind: "P→P" | "P→F" | "F→P" | "F→F" | "missing";
}

// ── CLI parsing ────────────────────────────────────────────────────────────

function parseArgs(argv: string[]): {
  runId: string | null;
  cwd: string;
  out: string | null;
} {
  let runId: string | null = null;
  let cwd = ".";
  let out: string | null = null;

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--run-id" && i + 1 < argv.length) runId = argv[++i];
    else if (argv[i] === "--cwd" && i + 1 < argv.length) cwd = argv[++i];
    else if (argv[i] === "--out" && i + 1 < argv.length) out = argv[++i];
  }

  return { runId, cwd, out };
}

// ── Validation ─────────────────────────────────────────────────────────────

function validateGrading(raw: unknown): Grading {
  if (
    !raw ||
    typeof raw !== "object" ||
    !Array.isArray((raw as any).current) ||
    !Array.isArray((raw as any).proposed)
  ) {
    throw new Error(
      "grading.json must be an object with 'current' and 'proposed' arrays"
    );
  }
  for (const arr of [(raw as any).current, (raw as any).proposed]) {
    for (const r of arr) {
      if (
        typeof r !== "object" ||
        typeof r.case_id !== "string" ||
        typeof r.passed !== "boolean" ||
        typeof r.ms !== "number" ||
        typeof r.tokens !== "number"
      ) {
        throw new Error(
          "each case must be {case_id:string, passed:bool, ms:number, tokens:number}"
        );
      }
    }
  }
  return raw as Grading;
}

// ── Aggregation ────────────────────────────────────────────────────────────

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function stddev(xs: number[]): number {
  if (xs.length === 0) return 0;
  const m = mean(xs);
  const variance = mean(xs.map((x) => (x - m) ** 2));
  return Math.sqrt(variance);
}

function aggregate(cases: CaseResult[]): Aggregate {
  const n = cases.length;
  const passes = cases.filter((c) => c.passed).length;
  const ms = cases.map((c) => c.ms);
  const tokens = cases.map((c) => c.tokens);
  return {
    n,
    passRate: n > 0 ? passes / n : 0,
    durationMean: mean(ms),
    durationStddev: stddev(ms),
    tokensTotal: tokens.reduce((a, b) => a + b, 0),
    tokensMean: mean(tokens),
    tokensStddev: stddev(tokens),
  };
}

function computeFlips(grading: Grading): FlipPair[] {
  const byCurrent = new Map<string, CaseResult>();
  for (const c of grading.current) byCurrent.set(c.case_id, c);
  const byProposed = new Map<string, CaseResult>();
  for (const c of grading.proposed) byProposed.set(c.case_id, c);

  const allIds = new Set<string>([
    ...byCurrent.keys(),
    ...byProposed.keys(),
  ]);

  const pairs: FlipPair[] = [];
  for (const id of Array.from(allIds).sort()) {
    const cur = byCurrent.get(id) ?? null;
    const prop = byProposed.get(id) ?? null;
    let kind: FlipPair["kind"];
    if (!cur || !prop) kind = "missing";
    else if (cur.passed && prop.passed) kind = "P→P";
    else if (cur.passed && !prop.passed) kind = "P→F";
    else if (!cur.passed && prop.passed) kind = "F→P";
    else kind = "F→F";
    pairs.push({ case_id: id, current: cur, proposed: prop, kind });
  }
  return pairs;
}

// ── Formatting ─────────────────────────────────────────────────────────────

function fmt(n: number, digits = 2): string {
  if (!Number.isFinite(n)) return "n/a";
  return n.toFixed(digits);
}

function pct(n: number, digits = 1): string {
  if (!Number.isFinite(n)) return "n/a";
  return (n * 100).toFixed(digits) + "%";
}

function deltaPct(before: number, after: number): string {
  if (!Number.isFinite(before) || !Number.isFinite(after)) return "n/a";
  if (before === 0) {
    if (after === 0) return "0.0%";
    return "n/a";
  }
  const d = (after - before) / Math.abs(before);
  const sign = d >= 0 ? "+" : "";
  return `${sign}${(d * 100).toFixed(1)}%`;
}

function buildReport(runId: string, grading: Grading): string {
  const cur = aggregate(grading.current);
  const prop = aggregate(grading.proposed);
  const flips = computeFlips(grading);

  const regressions = flips.filter((f) => f.kind === "P→F");
  const fixes = flips.filter((f) => f.kind === "F→P");
  const stablePass = flips.filter((f) => f.kind === "P→P");
  const stableFail = flips.filter((f) => f.kind === "F→F");
  const missing = flips.filter((f) => f.kind === "missing");

  const lines: string[] = [];
  lines.push("---");
  lines.push(`run_id: ${runId}`);
  lines.push(`n_cases_current: ${cur.n}`);
  lines.push(`n_cases_proposed: ${prop.n}`);
  lines.push(`regressions: ${regressions.length}`);
  lines.push(`fixes: ${fixes.length}`);
  lines.push(`stable_pass: ${stablePass.length}`);
  lines.push(`stable_fail: ${stableFail.length}`);
  lines.push(`missing_pairs: ${missing.length}`);
  lines.push(`pass_rate_current: ${fmt(cur.passRate, 3)}`);
  lines.push(`pass_rate_proposed: ${fmt(prop.passRate, 3)}`);
  lines.push(`pass_rate_delta: ${deltaPct(cur.passRate, prop.passRate)}`);
  lines.push(`duration_ms_current_mean: ${fmt(cur.durationMean, 1)}`);
  lines.push(`duration_ms_proposed_mean: ${fmt(prop.durationMean, 1)}`);
  lines.push(`duration_ms_delta: ${deltaPct(cur.durationMean, prop.durationMean)}`);
  lines.push(`tokens_total_current: ${cur.tokensTotal}`);
  lines.push(`tokens_total_proposed: ${prop.tokensTotal}`);
  lines.push(`tokens_total_delta: ${deltaPct(cur.tokensTotal, prop.tokensTotal)}`);
  lines.push("---");
  lines.push("");
  lines.push(`# Flip report — run ${runId}`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`- regressions (P→F): **${regressions.length}**`);
  lines.push(`- fixes (F→P): **${fixes.length}**`);
  lines.push(`- stable pass (P→P): ${stablePass.length}`);
  lines.push(`- stable fail (F→F): ${stableFail.length}`);
  if (missing.length > 0) {
    lines.push(`- missing pairs: ${missing.length} (case present in only one run)`);
  }
  lines.push("");
  lines.push("## Aggregates");
  lines.push("");
  lines.push("| metric | current | proposed | delta |");
  lines.push("|---|---|---|---|");
  lines.push(
    `| pass_rate | ${fmt(cur.passRate, 3)} | ${fmt(prop.passRate, 3)} | ${deltaPct(cur.passRate, prop.passRate)} |`
  );
  lines.push(
    `| duration_ms_mean | ${fmt(cur.durationMean, 1)} | ${fmt(prop.durationMean, 1)} | ${deltaPct(cur.durationMean, prop.durationMean)} |`
  );
  lines.push(
    `| duration_ms_stddev | ${fmt(cur.durationStddev, 1)} | ${fmt(prop.durationStddev, 1)} | — |`
  );
  lines.push(
    `| tokens_total | ${cur.tokensTotal} | ${prop.tokensTotal} | ${deltaPct(cur.tokensTotal, prop.tokensTotal)} |`
  );
  lines.push(
    `| tokens_mean | ${fmt(cur.tokensMean, 1)} | ${fmt(prop.tokensMean, 1)} | ${deltaPct(cur.tokensMean, prop.tokensMean)} |`
  );
  lines.push(
    `| tokens_stddev | ${fmt(cur.tokensStddev, 1)} | ${fmt(prop.tokensStddev, 1)} | — |`
  );
  lines.push("");
  lines.push("## Regressions (P→F)");
  lines.push("");
  if (regressions.length === 0) {
    lines.push("_None._");
  } else {
    lines.push("| case_id | current ms | proposed ms | current tokens | proposed tokens |");
    lines.push("|---|---|---|---|---|");
    for (const r of regressions) {
      lines.push(
        `| ${r.case_id} | ${r.current?.ms ?? "-"} | ${r.proposed?.ms ?? "-"} | ${r.current?.tokens ?? "-"} | ${r.proposed?.tokens ?? "-"} |`
      );
    }
  }
  lines.push("");
  lines.push("## Fixes (F→P)");
  lines.push("");
  if (fixes.length === 0) {
    lines.push("_None._");
  } else {
    lines.push("| case_id | current ms | proposed ms | current tokens | proposed tokens |");
    lines.push("|---|---|---|---|---|");
    for (const f of fixes) {
      lines.push(
        `| ${f.case_id} | ${f.current?.ms ?? "-"} | ${f.proposed?.ms ?? "-"} | ${f.current?.tokens ?? "-"} | ${f.proposed?.tokens ?? "-"} |`
      );
    }
  }
  lines.push("");
  lines.push("## Per-case flip table");
  lines.push("");
  if (flips.length === 0) {
    lines.push("_No cases._");
  } else {
    lines.push("| case_id | kind | current | proposed |");
    lines.push("|---|---|---|---|");
    for (const f of flips) {
      const cStr = f.current ? (f.current.passed ? "PASS" : "FAIL") : "—";
      const pStr = f.proposed ? (f.proposed.passed ? "PASS" : "FAIL") : "—";
      lines.push(`| ${f.case_id} | ${f.kind} | ${cStr} | ${pStr} |`);
    }
  }
  lines.push("");

  return lines.join("\n");
}

// ── Main ───────────────────────────────────────────────────────────────────

function main(): void {
  const { runId, cwd: cwdArg, out: outArg } = parseArgs(process.argv.slice(2));

  if (!runId) {
    process.stderr.write("[flip-report] ERROR: --run-id <id> is required\n");
    process.exit(1);
  }

  const cwd = path.resolve(cwdArg);
  const gradingFile = path.join(cwd, ".guild", "evolve", runId, "grading.json");
  const defaultOut = path.join(cwd, ".guild", "evolve", runId, "flip-report.md");
  const outFile = outArg ? path.resolve(outArg) : defaultOut;

  if (!fs.existsSync(gradingFile)) {
    process.stderr.write(
      `[flip-report] ERROR: grading.json not found: ${gradingFile}\n`
    );
    process.exit(1);
  }

  let grading: Grading;
  try {
    const raw = JSON.parse(fs.readFileSync(gradingFile, "utf8"));
    grading = validateGrading(raw);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(
      `[flip-report] ERROR: failed to parse grading.json: ${msg}\n`
    );
    process.exit(1);
    return;
  }

  const report = buildReport(runId, grading);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, report, "utf8");

  process.stderr.write(
    `[flip-report] wrote flip report for run ${runId} → ${outFile}\n`
  );
  process.exit(0);
}

main();
