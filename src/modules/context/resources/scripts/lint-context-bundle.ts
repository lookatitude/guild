#!/usr/bin/env -S npx tsx
/**
 * scripts/lint-context-bundle.ts
 *
 * Deterministic context-bundle budget linter (G-8 / SC-4) — the code-side
 * enforcement of `guild:context-assemble`'s size budget
 * (skills/meta/context-assemble/SKILL.md §"Size budget" / §"Graph retrieval").
 *
 * WHY THIS EXISTS: the ~3k target / 6k hard cap and the 1200-token
 * knowledge-graph sub-cap were enforced model-side only (prose the assembler
 * was told to obey). This CLI makes the budget check deterministic; the skill
 * runs it as a mandatory post-write step and trims/re-lints on FAIL.
 *
 * No LLM. No network. Same input file → same verdict every time.
 *
 * Usage:
 *   npx tsx scripts/lint-context-bundle.ts --bundle <file>
 *
 * Checks:
 *   - est_tokens = ceil(chars / 4) over the whole bundle. FAIL when > 6000.
 *   - When the frontmatter carries `token_estimate:`, BOTH numbers are
 *     reported (the frontmatter value is informational — the deterministic
 *     chars/4 estimate is what gates).
 *   - Knowledge-graph sections (any markdown heading matching
 *     /knowledge.?graph/i) are summed; when their estimate exceeds 1200 tokens
 *     AND no `dropped_for_budget:` line exists anywhere in the bundle, FAIL —
 *     the graph sub-source must drop lowest-weight nodes first and RECORD the
 *     drop.
 *
 * Stdout: JSON { pass, est_tokens, graph_est_tokens, has_dropped_for_budget,
 *                frontmatter_token_estimate, reasons[] }
 * Exit:   0 pass · 2 fail · 1 usage error (missing flag / unreadable file).
 */

import * as fs from "node:fs";

// ── Constants (mirror the SKILL.md budget — bound by pointer) ────────────────

/** Hard cap for the whole bundle (SKILL.md §"Size budget"). */
export const BUNDLE_TOKEN_CAP = 6000;
/** Graph sub-cap inside the task-dependent budget (SKILL.md §"Graph retrieval"). */
export const GRAPH_SECTION_TOKEN_CAP = 1200;

// ── Types ────────────────────────────────────────────────────────────────────

export interface BundleLintVerdict {
  pass: boolean;
  est_tokens: number;
  graph_est_tokens: number;
  has_dropped_for_budget: boolean;
  /** The frontmatter `token_estimate:` value, when present (informational). */
  frontmatter_token_estimate: number | null;
  reasons: string[];
}

// ── Pure helpers ─────────────────────────────────────────────────────────────

/** Deterministic token estimate — ceil(chars/4), the repo-wide heuristic. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Read `token_estimate:` from the leading YAML frontmatter block (lenient —
 * regex over the block, no YAML dependency). Returns null when the bundle has
 * no frontmatter or the key is absent / non-numeric.
 */
export function readFrontmatterTokenEstimate(content: string): number | null {
  const lines = content.split("\n");
  if (lines[0]?.trim() !== "---") return null;
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") {
      end = i;
      break;
    }
  }
  if (end === -1) return null;
  const block = lines.slice(1, end).join("\n");
  const m = /^\s*token_estimate:\s*([0-9]+)\s*$/m.exec(block);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

/**
 * Extract the body of every markdown section whose heading matches
 * /knowledge.?graph/i. A section runs from its heading to the next heading of
 * the same or higher level (or EOF).
 */
export function extractGraphSections(content: string): string[] {
  const lines = content.split("\n");
  const sections: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^(#{1,6})\s+(.*)$/.exec(lines[i]);
    if (!m || !/knowledge.?graph/i.test(m[2])) continue;
    const level = m[1].length;
    const body: string[] = [];
    let j = i + 1;
    for (; j < lines.length; j++) {
      const hm = /^(#{1,6})\s+/.exec(lines[j]);
      if (hm && hm[1].length <= level) break;
      body.push(lines[j]);
    }
    sections.push(body.join("\n"));
    i = j - 1;
  }
  return sections;
}

/** True when any line in the bundle carries a `dropped_for_budget:` record. */
export function hasDroppedForBudgetLine(content: string): boolean {
  return content.split("\n").some((l) => l.includes("dropped_for_budget:"));
}

/** The lint itself — pure function of the bundle text. */
export function lintBundle(content: string): BundleLintVerdict {
  const reasons: string[] = [];
  const estTokens = estimateTokens(content);
  const fmEstimate = readFrontmatterTokenEstimate(content);
  const graphSections = extractGraphSections(content);
  const graphEstTokens = graphSections.reduce(
    (sum, s) => sum + estimateTokens(s),
    0
  );
  const hasDropped = hasDroppedForBudgetLine(content);

  if (estTokens > BUNDLE_TOKEN_CAP) {
    reasons.push(
      `bundle estimate ${estTokens} tokens exceeds the ${BUNDLE_TOKEN_CAP}-token hard cap ` +
        `(ceil(chars/4)) — trim per the size-budget summarization rules and re-lint`
    );
  }
  if (
    fmEstimate !== null &&
    fmEstimate > BUNDLE_TOKEN_CAP &&
    estTokens <= BUNDLE_TOKEN_CAP
  ) {
    // Informational only — the deterministic estimate gates, but a frontmatter
    // claim above the cap deserves a surfaced note.
    reasons.push(
      `frontmatter token_estimate (${fmEstimate}) exceeds the cap while the deterministic ` +
        `estimate (${estTokens}) does not — frontmatter may be stale (not a FAIL)`
    );
  }
  if (graphEstTokens > GRAPH_SECTION_TOKEN_CAP && !hasDropped) {
    reasons.push(
      `knowledge-graph section estimate ${graphEstTokens} tokens exceeds the ` +
        `${GRAPH_SECTION_TOKEN_CAP}-token sub-cap with no dropped_for_budget: line — ` +
        `drop lowest-weight graph nodes first and record the drop`
    );
  }

  const pass =
    estTokens <= BUNDLE_TOKEN_CAP &&
    !(graphEstTokens > GRAPH_SECTION_TOKEN_CAP && !hasDropped);

  return {
    pass,
    est_tokens: estTokens,
    graph_est_tokens: graphEstTokens,
    has_dropped_for_budget: hasDropped,
    frontmatter_token_estimate: fmEstimate,
    reasons,
  };
}

// ── CLI entry ────────────────────────────────────────────────────────────────

const USAGE = "usage: lint-context-bundle.ts --bundle <file>";

function main(): number {
  const argv = process.argv.slice(2);
  let bundlePath: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--bundle" && argv[i + 1] !== undefined) {
      bundlePath = argv[++i];
    } else if (arg.startsWith("--bundle=")) {
      bundlePath = arg.slice("--bundle=".length);
    } else {
      process.stderr.write(`unknown argument: ${arg}\n${USAGE}\n`);
      return 1;
    }
  }
  if (!bundlePath) {
    process.stderr.write(USAGE + "\n");
    return 1;
  }

  let content: string;
  try {
    content = fs.readFileSync(bundlePath, "utf8");
  } catch {
    process.stderr.write(
      `lint-context-bundle: cannot read bundle: ${bundlePath}\n`
    );
    return 1;
  }

  const verdict = lintBundle(content);
  process.stdout.write(JSON.stringify(verdict, null, 2) + "\n");
  return verdict.pass ? 0 : 2;
}

if (require.main === module) {
  process.exit(main());
}
