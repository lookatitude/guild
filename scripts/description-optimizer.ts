#!/usr/bin/env -S npx tsx
/**
 * scripts/description-optimizer.ts
 *
 * Implements guild-plan.md §11.2 step 9 — description optimizer.
 * Deterministic heuristic (NOT an LLM). Given a skill's evals.json, treats
 * should_trigger as positives and should_not_trigger as negatives, derives
 * common positive trigger tokens, filters against negative-example tokens,
 * and assembles a description with TRIGGER / DO NOT TRIGGER clauses capped
 * at 1024 chars.
 *
 * Usage:
 *   scripts/description-optimizer.ts --skill <slug> [--cwd <path>]
 *
 * Options:
 *   --skill <slug>  (required) Skill slug (e.g. "guild-brainstorm").
 *   --cwd <path>    (optional, default ".") Repo root.
 *                   Searches <cwd>/skills/<tier>/<slug>/evals.json across the
 *                   known tiers (core, meta, specialists).
 *
 * Reads:  <cwd>/skills/<tier>/<slug>/evals.json
 * Writes: none (emits YAML on stdout; orchestrator decides whether to apply).
 *
 * Stdout: one-line YAML `description: <...>`.
 * Stderr: diagnostics.
 *
 * Exit codes:
 *   0  Success.
 *   1  Bad input (missing --skill, evals.json not found).
 *   2  Internal error.
 *
 * Invariant: never writes to disk. Never writes to .guild/wiki/.
 */

import * as fs from "fs";
import * as path from "path";

// ── Types ──────────────────────────────────────────────────────────────────

interface EvalCase {
  id?: string;
  prompt: string;
}

interface Evals {
  should_trigger: EvalCase[];
  should_not_trigger: EvalCase[];
}

// ── CLI parsing ────────────────────────────────────────────────────────────

function parseArgs(argv: string[]): {
  skill: string | null;
  cwd: string;
} {
  let skill: string | null = null;
  let cwd = ".";
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--skill" && i + 1 < argv.length) skill = argv[++i];
    else if (argv[i] === "--cwd" && i + 1 < argv.length) cwd = argv[++i];
  }
  return { skill, cwd };
}

// ── Skill path resolution ──────────────────────────────────────────────────

const KNOWN_TIERS = ["core", "meta", "specialists"];

function findEvalsFile(cwd: string, slug: string): string | null {
  for (const tier of KNOWN_TIERS) {
    const p = path.join(cwd, "skills", tier, slug, "evals.json");
    if (fs.existsSync(p)) return p;
  }
  // Fallback: check skills/<slug>/evals.json (tier-less layout)
  const fallback = path.join(cwd, "skills", slug, "evals.json");
  if (fs.existsSync(fallback)) return fallback;
  return null;
}

// ── Tokenization ───────────────────────────────────────────────────────────

// Deliberately conservative stopword list — keep domain nouns intact.
const STOPWORDS = new Set<string>([
  "a", "an", "the", "and", "or", "but", "if", "then", "else",
  "for", "to", "of", "in", "on", "at", "by", "with", "from",
  "as", "is", "are", "was", "were", "be", "been", "being",
  "do", "does", "did", "doing", "have", "has", "had",
  "i", "me", "my", "we", "us", "our", "you", "your",
  "it", "its", "this", "that", "these", "those",
  "will", "would", "should", "could", "can", "may", "might",
  "please", "lets", "let", "need", "want", "help",
  "new", "some", "any", "all", "more", "now",
  "about", "into", "onto", "up", "down", "out", "over", "under",
  "so", "than", "too", "very", "just", "only", "also",
  "me", "us", "them", "him", "her",
  "what", "when", "where", "which", "who", "why", "how",
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

function tokenFrequency(prompts: string[]): Map<string, number> {
  const freq = new Map<string, number>();
  for (const p of prompts) {
    const seen = new Set<string>();
    for (const tok of tokenize(p)) {
      if (seen.has(tok)) continue;
      seen.add(tok);
      freq.set(tok, (freq.get(tok) ?? 0) + 1);
    }
  }
  return freq;
}

// ── Description building ───────────────────────────────────────────────────

function buildDescription(slug: string, evals: Evals): string {
  const posPrompts = evals.should_trigger.map((c) => c.prompt);
  const negPrompts = evals.should_not_trigger.map((c) => c.prompt);

  const posFreq = tokenFrequency(posPrompts);
  const negFreq = tokenFrequency(negPrompts);

  // Pick trigger tokens: appear in ≥ 1/3 of positives, not in any negative.
  const posThreshold = Math.max(1, Math.ceil(posPrompts.length / 3));
  const triggerTokens: string[] = [];
  for (const [tok, count] of Array.from(posFreq.entries()).sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0])
  )) {
    if (count < posThreshold) continue;
    if (negFreq.has(tok)) continue;
    triggerTokens.push(tok);
  }

  // Pick negative-boundary tokens: appear in ≥ 1/3 of negatives, not in
  // positives — these become the DO NOT TRIGGER cues.
  const negThreshold = Math.max(1, Math.ceil(negPrompts.length / 3));
  const blockTokens: string[] = [];
  for (const [tok, count] of Array.from(negFreq.entries()).sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0])
  )) {
    if (count < negThreshold) continue;
    if (posFreq.has(tok)) continue;
    blockTokens.push(tok);
  }

  // Fallback: if no high-signal trigger tokens, use all positive-only tokens.
  if (triggerTokens.length === 0) {
    for (const tok of Array.from(posFreq.keys()).sort()) {
      if (!negFreq.has(tok)) triggerTokens.push(tok);
    }
  }

  const slugReadable = slug.replace(/^guild[-:]?/, "").replace(/-/g, " ");

  // Assemble a single-line description.
  const triggerList =
    triggerTokens.length > 0 ? triggerTokens.slice(0, 12).join(", ") : slugReadable;
  const blockList = blockTokens.length > 0 ? blockTokens.slice(0, 10).join(", ") : "";

  let desc = `${slugReadable} skill. TRIGGER on: ${triggerList}.`;
  if (blockList) {
    desc += ` DO NOT TRIGGER for: ${blockList}.`;
  } else {
    desc += ` DO NOT TRIGGER for unrelated tasks.`;
  }

  // Enforce 1024-char cap.
  if (desc.length > 1024) {
    desc = desc.slice(0, 1021) + "...";
  }
  return desc;
}

// ── Main ───────────────────────────────────────────────────────────────────

function main(): void {
  const { skill, cwd: cwdArg } = parseArgs(process.argv.slice(2));

  if (!skill) {
    process.stderr.write(
      "[description-optimizer] ERROR: --skill <slug> is required\n"
    );
    process.exit(1);
  }

  const cwd = path.resolve(cwdArg);
  const evalsPath = findEvalsFile(cwd, skill);
  if (!evalsPath) {
    process.stderr.write(
      `[description-optimizer] ERROR: evals.json not found for skill "${skill}" under ${cwd}/skills/{core,meta,specialists}/${skill}/\n`
    );
    process.exit(1);
  }

  let evals: Evals;
  try {
    const raw = JSON.parse(fs.readFileSync(evalsPath!, "utf8"));
    if (
      !raw ||
      typeof raw !== "object" ||
      !Array.isArray(raw.should_trigger) ||
      !Array.isArray(raw.should_not_trigger)
    ) {
      throw new Error(
        "evals.json must have should_trigger and should_not_trigger arrays"
      );
    }
    evals = raw as Evals;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(
      `[description-optimizer] ERROR: failed to parse evals.json at ${evalsPath}: ${msg}\n`
    );
    process.exit(1);
    return;
  }

  const desc = buildDescription(skill, evals);
  process.stdout.write(`description: ${desc}\n`);
  process.stderr.write(
    `[description-optimizer] optimized description for ${skill} (${desc.length} chars)\n`
  );
  process.exit(0);
}

main();
