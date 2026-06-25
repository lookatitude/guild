/**
 * src/modules/context/workflows/fs-scanner.ts
 *
 * R-019d — the FDC-13 `fallback_reader`. When the MCP transport is unavailable
 * (`mcp.stdio_available: false`), the recall path degrades to a DIRECT filesystem
 * scan instead of the guild-memory MCP BM25 search. This bypasses BOTH MCP and the
 * SQLite wiki_fts cache (wiki-recall.ts) — it is the last-resort reader the
 * feature-degradation contract specifies.
 *
 * Contract (BY POINTER): docs/knowledge/decisions/feature-degradation-contracts.md
 *   FDC-13 ("If MCP is completely unavailable, the reader falls back to the
 *   filesystem scanner over .guild/wiki/ + .guild/runs/").
 *
 * ── DROP-IN CONTRACT (team-lead refinement) ──
 * `hits` is returned PRE-SORTED, most-relevant first. Consumers MUST take hits in
 * ARRAY ORDER and MUST NOT re-sort by any rank field — the public hit shape has NO
 * `rank` field precisely so the positive-TF (here) vs negative-BM25 (wiki-recall.ts)
 * sign mismatch can never bite. `source: "fs-scanner"` is purely informational
 * (logging / telemetry). FsScanHit.path/title/snippet mirror WikiHit.path/title/snippet
 * so a consumer that already handles wiki-recall hits handles these unchanged.
 *
 * Purity / safety: synchronous, never throws. Returns `null` when NO target dir
 * exists (mirrors wiki-recall.ts's null contract → caller substitutes an empty
 * result). A present-but-empty dir yields `{ hits: [], ... }` (not null).
 *
 * Ranking: naive term-frequency. A file's score = sum over query terms of the
 * count of case-insensitive occurrences; files matching MORE distinct terms and
 * with higher total frequency rank first. This is intentionally simple — it is the
 * degraded path, not the primary BM25 reader.
 */

import * as fs from "fs";
import * as path from "path";

// ── Public types (mirror wiki-recall.ts WikiHit/WikiRecallResult, minus rank) ──

export interface FsScanHit {
  /** Absolute path to the matched file. */
  path: string;
  /** First H1 heading, or the basename without extension when no H1 present. */
  title: string;
  /** First matching line (trimmed), or the first 200 chars when no single line matches. */
  snippet: string;
}

export interface FsScanResult {
  /** Always "fs-scanner" — distinguishes from wiki-recall.ts "sqlite-wiki_fts". Informational. */
  source: "fs-scanner";
  /** Matched files, PRE-SORTED most-relevant first. Consume in array order; never re-sort. */
  hits: FsScanHit[];
  /** Absolute paths of the dirs that were found and walked (for diagnostics). */
  scannedDirs: string[];
}

export interface FsScanOpts {
  /** Max hits returned. Default 10 (matches wiki-recall DEFAULT_LIMIT). */
  limit?: number;
  /** Dirs relative to `.guild/` to scan. Default ["wiki", "runs"]. */
  dirs?: string[];
  /** File extensions to include. Default [".md", ".txt", ".yaml", ".yml"]. */
  extensions?: string[];
}

// ── Internal scored hit (rank kept internal; never surfaced on FsScanHit) ──────

interface ScoredHit extends FsScanHit {
  /** Internal term-frequency score (higher = more relevant). NOT public. */
  _score: number;
  /** Distinct query terms matched (tiebreak — more distinct terms ranks higher). */
  _distinctTerms: number;
}

const DEFAULT_LIMIT = 10;
const DEFAULT_DIRS = ["wiki", "runs"];
const DEFAULT_EXTENSIONS = [".md", ".txt", ".yaml", ".yml"];
/** Skip files larger than this (bytes) — the degraded path must stay cheap. */
const MAX_FILE_BYTES = 512 * 1024;

// ── Helpers ───────────────────────────────────────────────────────────────────

function safeReadDir(dir: string): fs.Dirent[] {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function safeReadFile(p: string): string | null {
  try {
    const stat = fs.statSync(p);
    if (stat.size > MAX_FILE_BYTES) return null;
    return fs.readFileSync(p, "utf8");
  } catch {
    return null;
  }
}

/** Recursively collect files under `dir` with an allowed extension. Never throws. */
function walkFiles(dir: string, extensions: string[]): string[] {
  const out: string[] = [];
  for (const entry of safeReadDir(dir)) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkFiles(full, extensions));
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (extensions.includes(ext)) out.push(full);
    }
  }
  return out;
}

/** Extract the first H1 heading, or fall back to the basename without extension. */
function extractTitle(content: string, filePath: string): string {
  const lines = content.split("\n");
  for (const line of lines) {
    const m = line.match(/^#\s+(.+?)\s*$/);
    if (m) return m[1].trim();
  }
  return path.basename(filePath, path.extname(filePath));
}

/** Tokenize a query into lowercase non-empty terms. */
function queryTerms(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

/** Count case-insensitive occurrences of `term` in `lowerContent`. */
function countOccurrences(lowerContent: string, term: string): number {
  if (term.length === 0) return 0;
  let count = 0;
  let idx = lowerContent.indexOf(term);
  while (idx !== -1) {
    count += 1;
    idx = lowerContent.indexOf(term, idx + term.length);
  }
  return count;
}

/** Find the first line containing any query term; fall back to the first 200 chars. */
function extractSnippet(content: string, terms: string[]): string {
  const lines = content.split("\n");
  for (const line of lines) {
    const lower = line.toLowerCase();
    if (terms.some((t) => lower.includes(t))) {
      return line.trim().slice(0, 200);
    }
  }
  return content.trim().slice(0, 200);
}

// ── Main export ─────────────────────────────────────────────────────────────

/**
 * Scan `.guild/wiki/` + `.guild/runs/` (by default) for `query` terms and return
 * the matching files PRE-SORTED most-relevant-first.
 *
 * @param query     space-separated search terms (case-insensitive)
 * @param guildRoot repo root — `.guild/` is resolved from here
 * @param opts      limit / dirs / extensions overrides
 * @returns FsScanResult, or `null` when NONE of the target dirs exist
 */
export function fsScan(
  query: string,
  guildRoot: string,
  opts: FsScanOpts = {}
): FsScanResult | null {
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const dirs = opts.dirs ?? DEFAULT_DIRS;
  const extensions = (opts.extensions ?? DEFAULT_EXTENSIONS).map((e) => e.toLowerCase());
  const terms = queryTerms(query);

  // Resolve which target dirs actually exist.
  const guildDir = path.join(guildRoot, ".guild");
  const existingDirs: string[] = [];
  for (const rel of dirs) {
    const abs = path.join(guildDir, rel);
    try {
      if (fs.statSync(abs).isDirectory()) existingDirs.push(abs);
    } catch {
      /* missing dir — skip */
    }
  }

  // Null contract: NO target dir exists at all → caller substitutes empty result.
  if (existingDirs.length === 0) return null;

  // Empty query → nothing to match, but the dirs exist → empty hits (not null).
  if (terms.length === 0) {
    return { source: "fs-scanner", hits: [], scannedDirs: existingDirs };
  }

  const scored: ScoredHit[] = [];

  for (const dir of existingDirs) {
    for (const file of walkFiles(dir, extensions)) {
      const content = safeReadFile(file);
      if (content === null) continue;
      const lower = content.toLowerCase();

      let score = 0;
      let distinct = 0;
      for (const term of terms) {
        const n = countOccurrences(lower, term);
        if (n > 0) {
          score += n;
          distinct += 1;
        }
      }
      if (score === 0) continue; // no term matched → not a hit

      scored.push({
        path: file,
        title: extractTitle(content, file),
        snippet: extractSnippet(content, terms),
        _score: score,
        _distinctTerms: distinct,
      });
    }
  }

  // Sort: more distinct terms first, then higher total frequency, then path (stable).
  scored.sort((a, b) => {
    if (b._distinctTerms !== a._distinctTerms) return b._distinctTerms - a._distinctTerms;
    if (b._score !== a._score) return b._score - a._score;
    return a.path.localeCompare(b.path);
  });

  // Strip internal fields → public hit shape (no rank), apply limit.
  const hits: FsScanHit[] = scored.slice(0, limit).map((s) => ({
    path: s.path,
    title: s.title,
    snippet: s.snippet,
  }));

  return { source: "fs-scanner", hits, scannedDirs: existingDirs };
}

// ── CLI (parity with wiki-recall.ts; for manual inspection / skill shell-out) ──

export function runFsScannerCli(): void {
  const argv = process.argv.slice(2);
  let query: string | undefined;
  let cwd = process.cwd();
  let limit: number | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--query" && argv[i + 1]) query = argv[++i];
    else if (arg.startsWith("--query=")) query = arg.slice("--query=".length);
    else if (arg === "--cwd" && argv[i + 1]) cwd = argv[++i];
    else if (arg.startsWith("--cwd=")) cwd = arg.slice("--cwd=".length);
    else if (arg === "--limit" && argv[i + 1]) limit = parseInt(argv[++i], 10);
    else if (arg.startsWith("--limit=")) limit = parseInt(arg.slice("--limit=".length), 10);
  }

  if (!query) {
    process.stderr.write("[fs-scanner] ERROR: --query is required\n");
    process.stdout.write(JSON.stringify({ source: "fs-scanner", hits: [], scannedDirs: [] }) + "\n");
    return;
  }

  const result = fsScan(query, cwd, limit !== undefined ? { limit } : {});
  if (result === null) {
    process.stdout.write(JSON.stringify({ nullResult: true, reason: "no target dirs" }) + "\n");
    return;
  }
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}

if (typeof module !== "undefined" && require.main === module) {
  runFsScannerCli();
}
