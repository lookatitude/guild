/**
 * scripts/lib/ingest-similarity.ts
 *
 * D-INGEST-GATE (Wave-3 security) — BM25 near-duplicate gate for wiki-ingest.
 *
 * Usage:
 *   ingestSimilarity(cwd, candidate, category?) → IngestSimilarityResult
 *
 * The gate prevents near-duplicate or poisoned-overwrite pages from ingesting
 * unchecked into the wiki. It computes the top-1 BM25 score of a candidate page
 * against all existing pages in the target category, reads the configured
 * threshold (models.ingestSimilarityGate, default 0.80), and returns
 * `should_pause: true` when the top score meets or exceeds the threshold.
 *
 * D-PROBE (ingest side, fail-closed — docs/v2/11-security.md §D-PROBE): the
 * same call also runs the deterministic directive-language probe
 * (hooks/lib/security/injection-guard.ts patterns) over the candidate. A probe
 * HIT forces `should_pause: true` (`probe_hit: true`, `pause_reason`) — the
 * page write is BLOCKED pending explicit operator confirmation through the
 * same always-ask channel the similarity gate uses. Code, not model prose.
 *
 * Contract:
 *  - Same BM25 algorithm as guild-memory/src/index.ts (k1=1.5, b=0.75,
 *    tokenize = /[A-Za-z0-9]+/g lowercase, length>1) — no re-implementation;
 *    these ARE the same constants and formula.
 *  - Category-scoped: only pages under .guild/wiki/<category>/ are compared.
 *    A similar page in a DIFFERENT category does NOT trip the gate (scope honored).
 *  - Config-driven: `gate` is read from models.ingestSimilarityGate in
 *    .guild/settings.json (default 0.80). Never hard-coded.
 *  - Deterministic: same candidate + same wiki state → same score.
 *  - Never throws (errors → null fallback). All functions are synchronous.
 *
 * Spec: .guild/initiatives/active/drift-remediation/contracts/wave3-dingest-gate-bm25.md
 */

import * as fs from "node:fs";
import * as path from "node:path";
// D-PROBE (ingest side): deterministic directive-language probe over the
// candidate content. Same regex detector the recall/handoff paths use
// (hooks/lib/security/injection-guard.ts, HK-08) — code, not model self-scan.
import { sanitizeForInjection } from "../../hooks/lib/security/injection-guard.js";

// ── Public types ──────────────────────────────────────────────────────────

export interface IngestCandidate {
  /** Page title (used as a 2x-weighted input to tokenization, same as guild-memory). */
  title: string;
  /** Full page content (body text, may include frontmatter). */
  content: string;
}

export interface IngestSimilarityResult {
  /**
   * Top-1 BM25 score of candidate against existing pages in the category.
   * 0 when no existing pages in category or no token overlap.
   * Scale: positive float (same as guild-memory bm25Score — k1=1.5, b=0.75,
   * IDF-weighted; a near-duplicate typically scores >> 1; a novel page scores 0).
   */
  top_score: number;
  /**
   * Relative path (from repo root) of the most-similar existing page,
   * or null when no pages exist in the category or no overlap found.
   */
  top_path: string | null;
  /**
   * The configured gate threshold (models.ingestSimilarityGate, default 0.80).
   * Callers may surface this to the operator to explain the pause decision.
   */
  gate: number;
  /**
   * True when top_score >= gate OR probe_hit — the skill must pause and ask
   * the operator (the page write is BLOCKED pending explicit confirmation —
   * the same always-ask channel for both triggers).
   * False otherwise — ingest proceeds without a prompt.
   */
  should_pause: boolean;
  /**
   * D-PROBE (ingest side, fail-closed): true when the deterministic
   * directive-language probe (hooks/lib/security/injection-guard.ts patterns)
   * matched agent-directed imperatives in the candidate content. A hit forces
   * `should_pause: true` — the write is blocked pending explicit operator
   * confirmation (docs/v2/11-security.md §D-PROBE: probe `yes` ⇒ flag +
   * explicit user confirmation before write).
   */
  probe_hit: boolean;
  /** Names of the directive patterns that matched (diagnostics; [] when clean). */
  probe_patterns: string[];
  /**
   * Why the gate paused: "similarity" | "directive_probe" | "both" | null
   * (null ⇔ should_pause === false).
   */
  pause_reason: "similarity" | "directive_probe" | "both" | null;
}

// ── BM25 implementation (mirrors guild-memory/src/index.ts, same constants) ──
//
// Replicated here (not imported) because bm25Score in guild-memory is a private
// module-level function in an MCP server binary — not exported for library use.
// Parameters are IDENTICAL: k1=1.5, b=0.75, IDF floor +0.5, tokenize = alphanum
// length>1 lowercase. A unit test in this module verifies score parity.

const TOKEN_RE = /[A-Za-z0-9]+/g;

export function tokenize(s: string): string[] {
  const out: string[] = [];
  const m = s.toLowerCase().match(TOKEN_RE);
  if (!m) return out;
  for (const tok of m) if (tok.length > 1) out.push(tok);
  return out;
}

export function bm25Score(
  queryTokens: string[],
  docs: { tokens: string[] }[],
): number[] {
  const k1 = 1.5;
  const b = 0.75;
  const N = docs.length;
  if (N === 0) return [];
  const avgdl = docs.reduce((s, d) => s + d.tokens.length, 0) / N;

  // Document frequency per query token
  const df = new Map<string, number>();
  for (const q of new Set(queryTokens)) {
    let count = 0;
    for (const d of docs) {
      if (d.tokens.includes(q)) count++;
    }
    df.set(q, count);
  }

  const scores: number[] = new Array(N).fill(0);
  for (let i = 0; i < N; i++) {
    const doc = docs[i];
    const dl = doc.tokens.length || 1;
    const tf = new Map<string, number>();
    for (const t of doc.tokens) tf.set(t, (tf.get(t) ?? 0) + 1);

    let s = 0;
    for (const q of queryTokens) {
      const f = tf.get(q) ?? 0;
      if (f === 0) continue;
      const n = df.get(q) ?? 0;
      // IDF with +0.5 floor — matches guild-memory exactly
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
      const num = f * (k1 + 1);
      const den = f + k1 * (1 - b + b * (dl / avgdl));
      s += idf * (num / den);
    }
    scores[i] = s;
  }
  return scores;
}

// ── Config reader ─────────────────────────────────────────────────────────────
//
// Reads models.ingestSimilarityGate from .guild/settings.json.
// Falls back to DEFAULT_GATE when absent, invalid, or I/O fails.

const DEFAULT_GATE = 0.80;

export function readIngestGate(cwd: string): number {
  try {
    const settingsPath = path.join(cwd, ".guild", "settings.json");
    if (!fs.existsSync(settingsPath)) return DEFAULT_GATE;
    const raw = fs.readFileSync(settingsPath, "utf8");
    const settings = JSON.parse(raw) as Record<string, unknown>;
    const models = settings["models"];
    if (models && typeof models === "object") {
      const gate = (models as Record<string, unknown>)["ingestSimilarityGate"];
      if (typeof gate === "number" && gate >= 0 && gate <= 1) return gate;
    }
    return DEFAULT_GATE;
  } catch {
    return DEFAULT_GATE;
  }
}

// ── Category slug normalization ──────────────────────────────────────────────
//
// wiki-ingest SKILL passes SINGULAR hints (standard|product|entity|concept|source)
// while canonical wiki dirs are PLURAL (standards/products/entities/concepts/sources/).
// Without normalization, `--category concept` scans `.guild/wiki/concept/` (empty)
// → score=0 → should_pause=false ALWAYS (gate bypassed for every singular-category ingest).
//
// `context` is the one exception: its canonical dir IS `context/` (singular),
// matching the hint exactly — no normalization needed.
//
// Map: singular hint → canonical plural dir (pass-through if already plural/canonical).

const CATEGORY_SINGULAR_TO_PLURAL: Record<string, string> = {
  standard: "standards",
  product: "products",
  entity: "entities",
  concept: "concepts",
  source: "sources",
};

/**
 * Normalize a category slug from the SINGULAR hint form used by wiki-ingest
 * to the PLURAL canonical directory name used in `.guild/wiki/`.
 *
 * Already-plural or `context` pass through unchanged.
 *
 * @example
 *   normalizeCategory("concept")   // → "concepts"
 *   normalizeCategory("concepts")  // → "concepts"  (pass-through)
 *   normalizeCategory("context")   // → "context"   (canonical singular)
 */
export function normalizeCategory(category: string): string {
  return CATEGORY_SINGULAR_TO_PLURAL[category.toLowerCase()] ?? category;
}

// ── Category page scanner ─────────────────────────────────────────────────────
//
// Reads .md files from .guild/wiki/<category>/ (one directory level only).
// Returns an empty array when the category does not exist or I/O fails.

interface CategoryPage {
  relPath: string; // relative to repo root
  tokens: string[];
}

function scanCategoryPages(cwd: string, category: string): CategoryPage[] {
  // Normalize singular → plural before scanning (standard→standards etc.)
  const canonicalCategory = normalizeCategory(category);
  const catDir = path.join(cwd, ".guild", "wiki", canonicalCategory);
  let names: string[];
  try {
    names = fs.readdirSync(catDir).filter((n) => n.endsWith(".md"));
  } catch {
    return [];
  }

  const pages: CategoryPage[] = [];
  for (const name of names) {
    try {
      const abs = path.join(catDir, name);
      const content = fs.readFileSync(abs, "utf8");
      // Title-weighted: title 2x + body (same as guild-memory's rankPages)
      const title = name.replace(/\.md$/, "").replace(/[-_]/g, " ");
      const tokens = tokenize(title + "\n" + title + "\n" + content);
      pages.push({
        relPath: path.join(".guild", "wiki", canonicalCategory, name),
        tokens,
      });
    } catch {
      // Skip unreadable files
    }
  }
  return pages;
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Compute the top-1 BM25 similarity of a candidate page against all existing
 * pages in the target category, and return the gate decision.
 *
 * @param cwd       Absolute path to the consuming repo root.
 * @param candidate The page being considered for ingestion.
 * @param category  Wiki category subdirectory (e.g. "decisions", "context").
 *                  When empty/absent, the whole wiki is not scanned — the
 *                  category scope is required for the gate to be meaningful.
 *                  Passing an empty string scans `.guild/wiki/` root only.
 */
export function ingestSimilarity(
  cwd: string,
  candidate: IngestCandidate,
  category: string = "",
): IngestSimilarityResult {
  const gate = readIngestGate(cwd);

  // D-PROBE (ingest side, fail-closed): run the deterministic directive probe
  // over the FULL candidate (title + content) FIRST — it is independent of the
  // wiki state, so it must gate even when the category is empty or the
  // candidate has no tokens. A hit forces should_pause:true (the same
  // always-ask channel the similarity gate uses; never silent).
  const probe = sanitizeForInjection(candidate.title + "\n" + candidate.content);
  const probeHit = probe.result === "flagged";
  const probePatterns = probe.matchedPatterns;

  const compose = (topScore: number, topPath: string | null): IngestSimilarityResult => {
    const similarityPause = topScore >= gate;
    const shouldPause = similarityPause || probeHit;
    const pauseReason: IngestSimilarityResult["pause_reason"] = !shouldPause
      ? null
      : similarityPause && probeHit
        ? "both"
        : similarityPause
          ? "similarity"
          : "directive_probe";
    return {
      top_score: topScore,
      top_path: topPath,
      gate,
      should_pause: shouldPause,
      probe_hit: probeHit,
      probe_patterns: probePatterns,
      pause_reason: pauseReason,
    };
  };

  // Build candidate tokens (title 2x weighted, same as guild-memory)
  const candidateTokens = tokenize(
    candidate.title + "\n" + candidate.title + "\n" + candidate.content,
  );

  if (candidateTokens.length === 0) {
    return compose(0, null);
  }

  // Scan existing pages in the category
  const pages = scanCategoryPages(cwd, category);
  if (pages.length === 0) {
    return compose(0, null);
  }

  // BM25: candidate query tokens vs. each existing page as a document
  const scores = bm25Score(candidateTokens, pages.map((p) => ({ tokens: p.tokens })));

  // Find top-1
  let topScore = 0;
  let topPath: string | null = null;
  for (let i = 0; i < scores.length; i++) {
    if (scores[i] > topScore) {
      topScore = scores[i];
      topPath = pages[i].relPath;
    }
  }

  return compose(topScore, topPath);
}

// ── CLI entry ─────────────────────────────────────────────────────────────────
//
// Usage (from wiki-ingest SKILL.md §BM25 + learn-graph SKILL.md §5):
//
//   npx tsx scripts/lib/ingest-similarity.ts \
//     --cwd <repo-root> --category <target-category> \
//     --title "<candidate title>" --content-file <path-to-candidate-text>
//
// Prints `{ top_score, top_path, gate, should_pause, probe_hit, probe_patterns,
// pause_reason }` as JSON to stdout (D-PROBE: a directive-probe hit forces
// should_pause:true — fail-closed; the skill's pause channel blocks the write).
// Exits 0 always (gate decision is surfaced in the JSON, not the exit code).
// Guard: require.main === module so the library import path is unaffected.

if (require.main === module) {
  const argv = process.argv.slice(2);
  let cwd = process.env["GUILD_CWD"] ?? process.cwd();
  let category = "";
  let title = "";
  let contentFile = "";

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if ((arg === "--cwd") && argv[i + 1]) { cwd = argv[++i]!; }
    else if ((arg === "--category") && argv[i + 1]) { category = argv[++i]!; }
    else if ((arg === "--title") && argv[i + 1]) { title = argv[++i]!; }
    else if ((arg === "--content-file") && argv[i + 1]) { contentFile = argv[++i]!; }
    else if (arg.startsWith("--cwd=")) { cwd = arg.slice("--cwd=".length); }
    else if (arg.startsWith("--category=")) { category = arg.slice("--category=".length); }
    else if (arg.startsWith("--title=")) { title = arg.slice("--title=".length); }
    else if (arg.startsWith("--content-file=")) { contentFile = arg.slice("--content-file=".length); }
  }

  if (!category) {
    process.stderr.write("[ingest-similarity] ERROR: --category <category> is required\n");
    process.exit(1);
  }

  let content = "";
  if (contentFile) {
    try {
      content = fs.readFileSync(contentFile, "utf8");
    } catch (e) {
      process.stderr.write(
        `[ingest-similarity] ERROR: cannot read --content-file "${contentFile}": ${String(e)}\n`,
      );
      process.exit(1);
    }
  }

  const result = ingestSimilarity(cwd, { title, content }, category);
  process.stdout.write(JSON.stringify(result) + "\n");
}
