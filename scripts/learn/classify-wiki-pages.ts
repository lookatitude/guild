#!/usr/bin/env -S npx tsx
/**
 * learn/classify-wiki-pages.ts — L8: Real ClassifyPageFn implementation
 *
 * Provides the REAL classification/labeling pass for wiki/KB pages (K2 stage).
 * The `ClassifyPageFn` seam in wiki-index.ts is injectable; this module delivers
 * the production implementation that assigns `category`, `importance`, and `labels[]`
 * to every `wiki_page` node using an LLM (cost-tiered cheap/mid).
 *
 * OQ-4 DECISION: author fresh (NOT reuse classify-proposal.ts).
 * Rationale: classify-proposal.ts is a specific-vs-systemic DEFECT classifier that
 * operates on (distinct_subject_count, same_run, same_signature, user_approved) — a
 * completely different domain. Reusing it would be wrong-interface abuse. The correct
 * implementation is a new ClassifyPageFn matching the WikiPageDescriptor→WikiPageClassification
 * contract defined in wiki-index.ts.
 *
 * Architecture (injectable LLM, SC-9 honest):
 *   - buildClassifyPrompt(pages)    — deterministic-script: prompt template + page content
 *   - parseClassifyResponse(raw, pages) — deterministic-script: JSON parse + fallback
 *   - makeClassifier(runLLM)        — composes the above; the LLM call is injected by L6
 *   - defaultFallbackClassifier     — offline fallback (category="note"/importance="low")
 *
 * Determinism responsibility table (SC-9):
 *   | Output                    | Owner                |
 *   |---------------------------|----------------------|
 *   | prompt text               | deterministic-script |
 *   | JSON parse + field check  | deterministic-script |
 *   | fallback defaults         | deterministic-script |
 *   | category / importance /   |                      |
 *   |   labels[] values         | LLM-judged (cheap)   |
 *
 * Production wiring (L6 skill entrypoint):
 *   import { makeClassifier } from "./learn/classify-wiki-pages";
 *   const classifier = makeClassifier(async (prompt) => callClaude("haiku", prompt));
 *   await indexWiki(wikiDir, { classifier });
 *
 * Usage (CLI demo — prints the prompt for a directory):
 *   npx tsx scripts/learn/classify-wiki-pages.ts <wikiDir> [--print-prompt]
 *
 * Conform-by-pointer: docs/knowledge/architecture/codebase-understanding.md §K2 / SC-6
 * SC-6 (classification half) + SC-3 (category/importance on wiki_page nodes)
 */

import * as path from "path";
import { NODE_CATEGORIES } from "./lib/schema";
import type {
  WikiPageDescriptor,
  WikiPageClassification,
  ClassifyPageFn,
} from "./wiki-index";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Valid importance values (mirrors wiki-lint-knowledge.ts — single source check). */
const VALID_IMPORTANCE = new Set(["high", "medium", "low"]);

/** Default classification for pages the LLM could not classify. */
const FALLBACK_CLASSIFICATION: WikiPageClassification = {
  category: "note",
  importance: "low",
  labels: [],
};

// ---------------------------------------------------------------------------
// Exported: Prompt builder (deterministic-script, no LLM)
// ---------------------------------------------------------------------------

/**
 * Build the classification prompt for a batch of wiki/KB pages.
 *
 * Deterministic: given the same pages in the same order, always returns
 * the same string (SC-9 deterministic-script).
 *
 * The prompt instructs the LLM to output ONLY valid JSON matching the
 * schema: `{ results: [{ id, category, importance, labels }] }`.
 *
 * @param pages  Batch of page descriptors (id, relpath, name, headings, content).
 * @returns Prompt string ready to pass to the LLM.
 */
export function buildClassifyPrompt(pages: WikiPageDescriptor[]): string {
  const categoryList = [...NODE_CATEGORIES].sort().join(" | ");

  // Build per-page context snippets: id, name, headings, first 400 chars of content.
  // Truncated to keep tokens low (cheap tier).
  const pageSnippets = pages.map((p) => {
    const headingsLine = p.headings.length > 0 ? `  Headings: ${p.headings.join(", ")}` : "";
    const contentSnippet = p.content.slice(0, 400).replace(/\n+/g, " ");
    return [
      `- id: "${p.id}"`,
      `  name: "${p.name}"`,
      headingsLine,
      `  content_preview: "${contentSnippet}"`,
    ]
      .filter(Boolean)
      .join("\n");
  });

  return `You are a knowledge-graph classifier. For each wiki/KB page below, assign:
  - category: one value from the CLOSED set: ${categoryList}
  - importance: one of: high | medium | low
  - labels: an array of 1-4 short lowercase tag strings (topic keywords)

Rules:
  - category MUST be exactly one of the listed values. Never invent a new category.
  - importance reflects how central this page is to understanding the project:
      high   = essential (architecture, core design decisions, key concepts)
      medium = useful reference (guides, tutorials, specific features)
      low    = supplemental (glossary, changelogs, edge cases)
  - labels should be short lowercase strings like ["ingestion", "pipeline"] — avoid generic labels like "doc" or "page".

Output ONLY valid JSON in this exact shape (no markdown, no explanation):
{
  "results": [
    { "id": "<page-id>", "category": "<category>", "importance": "<high|medium|low>", "labels": ["<label>", ...] }
  ]
}

Pages to classify:
${pageSnippets.join("\n\n")}`;
}

// ---------------------------------------------------------------------------
// Exported: Response parser (deterministic-script, no LLM)
// ---------------------------------------------------------------------------

/**
 * Parse an LLM response string into a Map<pageId, WikiPageClassification>.
 *
 * Safe fallback strategy (SC-9 deterministic, no hallucination amplification):
 *   - If the JSON is malformed → fallback for all pages.
 *   - If a result entry has an invalid category → fallback category "note".
 *   - If a result entry has an invalid importance → fallback importance "low".
 *   - If a result entry has invalid labels → empty array fallback.
 *   - If a page id is missing from results → fallback for that page.
 *
 * @param raw   Raw LLM response string.
 * @param pages Original page descriptors (used to ensure every id is covered).
 * @returns Map<pageId, WikiPageClassification> — every page id present.
 */
export function parseClassifyResponse(
  raw: string,
  pages: WikiPageDescriptor[],
): Map<string, WikiPageClassification> {
  const result = new Map<string, WikiPageClassification>();

  // Parse JSON (extract from potential markdown fences)
  let parsed: { results?: unknown[] } | null = null;
  try {
    // Strip markdown code fences if present
    const stripped = raw
      .replace(/^```json\s*/m, "")
      .replace(/^```\s*$/m, "")
      .trim();
    parsed = JSON.parse(stripped);
  } catch {
    // Malformed JSON — will fall through to per-page fallbacks below.
  }

  if (parsed && Array.isArray(parsed.results)) {
    for (const entry of parsed.results) {
      if (!entry || typeof entry !== "object") continue;
      const e = entry as Record<string, unknown>;
      const id = typeof e.id === "string" ? e.id : null;
      if (!id) continue;

      // category: must be in NODE_CATEGORIES
      const rawCat = typeof e.category === "string" ? e.category.trim().toLowerCase() : "";
      const category = NODE_CATEGORIES.has(rawCat) ? rawCat : FALLBACK_CLASSIFICATION.category;

      // importance: must be high|medium|low
      const rawImp = typeof e.importance === "string" ? e.importance.trim().toLowerCase() : "";
      const importance = VALID_IMPORTANCE.has(rawImp)
        ? rawImp
        : FALLBACK_CLASSIFICATION.importance;

      // labels: array of strings; filter non-strings; clamp to 8 max
      const rawLabels = Array.isArray(e.labels) ? e.labels : [];
      const labels = rawLabels
        .filter((l): l is string => typeof l === "string" && l.length > 0)
        .map((l) => l.trim().toLowerCase())
        .slice(0, 8);

      result.set(id, { category, importance, labels });
    }
  }

  // Ensure every page id is covered (fill fallback for missing ids)
  for (const page of pages) {
    if (!result.has(page.id)) {
      result.set(page.id, { ...FALLBACK_CLASSIFICATION });
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Exported: makeClassifier — factory that composes prompt + LLM call + parse
// ---------------------------------------------------------------------------

/**
 * Build a production `ClassifyPageFn` from an injected LLM runner.
 *
 * The injected `runLLM` is responsible for the actual model call (cheap/mid tier).
 * The factory is responsible for prompt construction and response parsing.
 * This keeps the deterministic/LLM split honest (SC-9).
 *
 * Example (L6 wiring):
 *   const classifier = makeClassifier(async (prompt) =>
 *     callClaude({ model: "haiku", prompt })
 *   );
 *
 * Error handling: if `runLLM` throws, the classifier falls back to defaults
 * for all pages in the batch (fail-open: no partial/thrown result).
 *
 * @param runLLM  Async function that takes a prompt string and returns the LLM's response.
 * @param opts.batchSize  Max pages per LLM call (default 20, matches KNOWLEDGE_CONFIG_DEFAULTS.batchSize).
 */
export function makeClassifier(
  runLLM: (prompt: string) => Promise<string>,
  opts?: { batchSize?: number },
): ClassifyPageFn {
  const batchSize = opts?.batchSize ?? 20;

  return async (pages) => {
    const result = new Map<string, WikiPageClassification>();

    // Process in batches (SC-15 batchSize)
    for (let i = 0; i < pages.length; i += batchSize) {
      const batch = pages.slice(i, i + batchSize);
      const prompt = buildClassifyPrompt(batch);

      let raw: string;
      try {
        raw = await runLLM(prompt);
      } catch {
        // LLM call failed — fill fallback for this batch
        for (const page of batch) {
          result.set(page.id, { ...FALLBACK_CLASSIFICATION });
        }
        continue;
      }

      const batchResult = parseClassifyResponse(raw, batch);
      for (const [id, cls] of batchResult.entries()) {
        result.set(id, cls);
      }
    }

    return result;
  };
}

// ---------------------------------------------------------------------------
// Exported: defaultFallbackClassifier — offline fallback (no LLM)
// ---------------------------------------------------------------------------

/**
 * Offline fallback classifier: returns category="note" / importance="low" / labels=[]
 * for every page. Use when the LLM is not available (dry-run, offline, CI without keys).
 *
 * This is the same behavior as wiki-index.ts's internal `defaultClassifier` — exported
 * here so L6 can reference the canonical offline implementation.
 *
 * Deterministic-script: no LLM involved (SC-9).
 */
export const defaultFallbackClassifier: ClassifyPageFn = async (pages) => {
  const result = new Map<string, WikiPageClassification>();
  for (const page of pages) {
    result.set(page.id, { ...FALLBACK_CLASSIFICATION });
  }
  return result;
};

// ---------------------------------------------------------------------------
// CLI entry point (prompt preview / offline demo)
// ---------------------------------------------------------------------------

if (require.main === module) {
  const argv = process.argv.slice(2);
  const wikiDir = argv[0];
  const printPrompt = argv.includes("--print-prompt");

  if (!wikiDir || wikiDir.startsWith("--")) {
    process.stderr.write(
      "Usage: npx tsx scripts/learn/classify-wiki-pages.ts <wikiDir> [--cwd <repoRoot>] [--print-prompt]\n",
    );
    process.exit(1);
  }

  // BUG-3 real-path fix: resolve repoRoot from --cwd (default: process.cwd()) and
  // thread it to indexWiki so wiki_page ids/anchors are repoRoot-relative and
  // resolve at repoRoot (mirrors wiki-index.ts CLI + the orchestrator finalize
  // caller). Without it the CLI emitted unresolvable wikiDir-relative ids.
  const cwdIdx = argv.indexOf("--cwd");
  const cwdArg = cwdIdx >= 0 ? argv[cwdIdx + 1] : undefined;
  const repoRoot = path.resolve(cwdArg ?? process.cwd());
  const absWikiDir = path.resolve(repoRoot, wikiDir);

  // Dynamic import of indexWiki to avoid circular dep at module load time.
  // This is only used in CLI mode.
  import("./wiki-index")
    .then(({ indexWiki }) => {
      const demoClassifier: ClassifyPageFn = async (pages) => {
        if (printPrompt) {
          process.stdout.write("=== Classification prompt (first batch) ===\n");
          process.stdout.write(buildClassifyPrompt(pages.slice(0, 5)));
          process.stdout.write("\n===========================================\n");
        }
        return defaultFallbackClassifier(pages);
      };

      return indexWiki(absWikiDir, { classifier: demoClassifier, repoRoot }).then(
        ({ nodes }) => {
          const wikiPages = nodes.filter((n) => n.type === "wiki_page");
          process.stdout.write(
            `[classify-wiki-pages] ${wikiPages.length} wiki_page nodes (offline fallback)\n`,
          );
          for (const n of wikiPages.slice(0, 5)) {
            process.stdout.write(
              `  ${n.id}: category=${n.category} importance=${n.importance}\n`,
            );
          }
        },
      );
    })
    .catch((err) => {
      process.stderr.write(`[classify-wiki-pages] ERROR: ${err}\n`);
      process.exit(1);
    });
}
