#!/usr/bin/env -S npx tsx
/**
 * understand/k-stage-staleness.ts — SC-14 per-K-stage staleness classifier.
 *
 * Classifies which of K1..K6 must re-run given the files that changed since
 * the last K-stage baseline. Uses content-hash comparison (no AST parse).
 *
 * K-stage routing rules (SC-14 spec-correct):
 *   K1 (content-analyze)  — any prose (.md/.mdx) changed OR a code file's
 *                           doc-comments changed; pure structural code = NO-OP
 *   K2 (wiki-index)       — .guild/wiki/ OR docs/knowledge/ changed (NOT any .md)
 *   K3 (diagram-analyze)  — standalone diagram (.mermaid/.mmd/.svg) changed OR
 *                           .md file with ```mermaid blocks changed
 *   K4 (taxonomy-build)   — k1 || k2 || k3
 *   K5 (cross-link)       — k1 || k2 || k3
 *   K6 (project)          — k1 || k2 || k3
 *   structuralSkip        — true when no code file's structural (non-comment)
 *                           hash changed; callers may skip code-AST rebuild
 *
 * Acceptance cases:
 *   1. code-only structural edit (comments unchanged) → k1..k6 ALL FALSE
 *   2. docs-only (.guild/wiki/ or docs/knowledge/, no mermaid)
 *      → K1/K2/K4/K5/K6 TRUE; K3 FALSE; structuralSkip=true
 *
 * No-baseline conservative default: all stages stale.
 *
 * Usage:
 *   npx tsx understand/k-stage-staleness.ts [--cwd <path>] [--baseline] [--json]
 *
 * Baseline: <repoRoot>/.guild/indexes/kstage-fingerprint.json
 * SC-9 determinism: all computation is deterministic-script; no LLM calls.
 */

import * as fs from "fs";
import * as path from "path";
import { createHash } from "crypto";
import * as ts from "typescript";
import { parseCwd, hasFlag, guildPaths } from "./lib/paths";
import { walkRepo } from "./lib/walk";

// ---------------------------------------------------------------------------
// Extension sets
// ---------------------------------------------------------------------------

export const CODE_EXTENSIONS = new Set([
  ".ts", ".tsx", ".mts", ".cts",
  ".js", ".jsx", ".mjs", ".cjs",
]);

export const DOC_EXTENSIONS = new Set([".md", ".mdx"]);

/** .svg added per SC-14 spec — isDiagramFile covers standalone SVG exports. */
export const DIAGRAM_EXTENSIONS = new Set([".mermaid", ".mmd", ".svg"]);

// ---------------------------------------------------------------------------
// File type classifiers
// ---------------------------------------------------------------------------

export function isCodeFile(relPath: string): boolean {
  return CODE_EXTENSIONS.has(path.extname(relPath).toLowerCase());
}

export function isDocFile(relPath: string): boolean {
  return DOC_EXTENSIONS.has(path.extname(relPath).toLowerCase());
}

export function isDiagramFile(relPath: string): boolean {
  return DIAGRAM_EXTENSIONS.has(path.extname(relPath).toLowerCase());
}

/** True when path is under .guild/wiki/ (Karpathy-style wiki). */
export function isWikiPath(relPath: string): boolean {
  return relPath.startsWith(".guild/wiki/");
}

/** True when path is under docs/knowledge/ (docs KB). */
export function isKnowledgePath(relPath: string): boolean {
  return relPath.startsWith("docs/knowledge/");
}

/** True when markdown content contains a fenced ```mermaid block. */
export function containsMermaid(content: string): boolean {
  return /^```mermaid\b/m.test(content);
}

export function isKStageTrackedFile(relPath: string): boolean {
  return isCodeFile(relPath) || isDocFile(relPath) || isDiagramFile(relPath);
}

// ---------------------------------------------------------------------------
// Comment extraction helpers (TypeScript AST-aware)
// ---------------------------------------------------------------------------

/**
 * Extract comment character ranges from source code using the TypeScript
 * full parser so string/template/regex/JSX literals are NEVER misclassified
 * as comments.
 *
 * Uses `ts.createSourceFile` (full parse) + `ts.getLeadingCommentRanges` /
 * `ts.getTrailingCommentRanges` at each AST node, which is the same mechanism
 * the TypeScript language service uses to locate comments.
 *
 * Falls back to an empty list for non-parseable content.
 */
function getAstCommentRanges(content: string): Array<{ start: number; end: number }> {
  if (!content.trim()) return [];

  let sourceFile: ts.SourceFile;
  try {
    sourceFile = ts.createSourceFile(
      "tmp.tsx",
      content,
      ts.ScriptTarget.Latest,
      /* setParentNodes */ true,
      ts.ScriptKind.TSX,
    );
  } catch {
    return []; // non-parseable — conservatively report no comments
  }

  const seen = new Set<number>();
  const ranges: Array<{ start: number; end: number }> = [];

  function addRange(r: ts.CommentRange): void {
    if (!seen.has(r.pos)) {
      seen.add(r.pos);
      ranges.push({ start: r.pos, end: r.end });
    }
  }

  function visit(node: ts.Node): void {
    const leading = ts.getLeadingCommentRanges(content, node.getFullStart());
    if (leading) leading.forEach(addRange);
    const trailing = ts.getTrailingCommentRanges(content, node.getEnd());
    if (trailing) trailing.forEach(addRange);
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return ranges.sort((a, b) => a.start - b.start);
}

/**
 * Extract all comment text from source code in document order.
 * Returns the raw concatenation of all comment tokens joined with "\n".
 * Deterministic: same source ⇒ same output.
 *
 * Tokenizer-aware: string/template/regex/JSX literals are never
 * misclassified as comments (blocker in the naive regex approach).
 */
export function extractDocComments(content: string): string {
  const ranges = getAstCommentRanges(content);
  return ranges.map((r) => content.slice(r.start, r.end)).join("\n");
}

/**
 * Return source code with all comments stripped and whitespace normalised.
 * Used to detect structural code changes independent of comment edits.
 *
 * Tokenizer-aware: preserves string/template/regex literals intact.
 */
export function extractNonCommentCode(content: string): string {
  const ranges = getAstCommentRanges(content);
  if (ranges.length === 0) {
    return content.replace(/\s+/g, " ").trim();
  }
  const parts: string[] = [];
  let pos = 0;
  for (const r of ranges) {
    if (r.start > pos) {
      parts.push(content.slice(pos, r.start));
    }
    parts.push(" "); // replace comment with whitespace to preserve token separation
    pos = r.end;
  }
  if (pos < content.length) {
    parts.push(content.slice(pos));
  }
  return parts.join("").replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------------------
// Content hash
// ---------------------------------------------------------------------------

export function sha256Hash(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

// Sentinel: hash of the empty string — represents "no comments" or "empty code".
const EMPTY_HASH = sha256Hash("");

// ---------------------------------------------------------------------------
// Store type
// ---------------------------------------------------------------------------

export interface KStageStore {
  version: "guild.kstage_fingerprint.v1";
  /** relPath → sha256 of full file content. */
  files: Record<string, string>;
  /** relPath → sha256 of doc-comment text (code files only). */
  docCommentHashes: Record<string, string>;
  /** relPath → sha256 of non-comment code (code files only; for structuralSkip). */
  nonCommentHashes: Record<string, string>;
  /** relpaths of .md files that contain ```mermaid blocks. */
  mermaidDocs: string[];
}

// ---------------------------------------------------------------------------
// Build store
// ---------------------------------------------------------------------------

export function buildKStageStore(files: Record<string, string>): KStageStore {
  const hashed: Record<string, string> = {};
  const docCommentHashes: Record<string, string> = {};
  const nonCommentHashes: Record<string, string> = {};
  const mermaidDocs: string[] = [];

  for (const [relPath, content] of Object.entries(files)) {
    hashed[relPath] = sha256Hash(content);
    if (isCodeFile(relPath)) {
      docCommentHashes[relPath] = sha256Hash(extractDocComments(content));
      nonCommentHashes[relPath] = sha256Hash(extractNonCommentCode(content));
    }
    if (isDocFile(relPath) && containsMermaid(content)) {
      mermaidDocs.push(relPath);
    }
  }

  return {
    version: "guild.kstage_fingerprint.v1",
    files: hashed,
    docCommentHashes,
    nonCommentHashes,
    mermaidDocs,
  };
}

// ---------------------------------------------------------------------------
// Delta analysis
// ---------------------------------------------------------------------------

export interface KHashDelta {
  added: string[];
  deleted: string[];
  modified: string[];
  unchanged: string[];
}

export function analyzeHashDelta(
  stored: KStageStore,
  current: Record<string, string>,
): KHashDelta {
  const delta: KHashDelta = { added: [], deleted: [], modified: [], unchanged: [] };
  const storedFiles = stored.files;

  for (const relPath of Object.keys(storedFiles)) {
    if (!(relPath in current)) delta.deleted.push(relPath);
  }
  for (const [relPath, content] of Object.entries(current)) {
    if (!(relPath in storedFiles)) {
      delta.added.push(relPath);
    } else if (sha256Hash(content) === storedFiles[relPath]) {
      delta.unchanged.push(relPath);
    } else {
      delta.modified.push(relPath);
    }
  }

  return delta;
}

// ---------------------------------------------------------------------------
// K-stage staleness classification
// ---------------------------------------------------------------------------

export interface KStageStaleness {
  k1: boolean;
  k2: boolean;
  k3: boolean;
  k4: boolean;
  k5: boolean;
  /** K6 (project) = k1 || k2 || k3. */
  k6: boolean;
  /**
   * true  = no code file's structural (non-comment) hash changed;
   *         callers may skip code-AST / structural-graph rebuild.
   * false = at least one code file changed structurally.
   */
  structuralSkip: boolean;
  reason: string;
}

/**
 * Classify which K-stages must re-run based on a KHashDelta.
 *
 * Three-argument form required so routing can inspect per-file hashes.
 */
export function classifyKStages(
  delta: KHashDelta,
  stored: KStageStore,
  current: Record<string, string>,
): KStageStaleness {
  const storedDocHashes = stored.docCommentHashes ?? {};
  const storedNonHashes = stored.nonCommentHashes ?? {};
  const storedMermaidSet = new Set(stored.mermaidDocs ?? []);

  const allChanged = [...delta.added, ...delta.deleted, ...delta.modified];

  // ── K1: prose (.md/.mdx) changed OR code file doc-comments changed ─────
  let k1 = allChanged.some((p) => isDocFile(p));

  if (!k1) {
    // Added code files: k1 if new file has doc-comments
    for (const p of delta.added) {
      if (!isCodeFile(p)) continue;
      const docHash = sha256Hash(extractDocComments(current[p] ?? ""));
      if (docHash !== EMPTY_HASH) { k1 = true; break; }
    }
  }

  if (!k1) {
    // Modified code files: k1 if doc-comment hash changed
    for (const p of delta.modified) {
      if (!isCodeFile(p)) continue;
      const storedDocHash = storedDocHashes[p] ?? EMPTY_HASH;
      const currentDocHash = sha256Hash(extractDocComments(current[p] ?? ""));
      if (currentDocHash !== storedDocHash) { k1 = true; break; }
    }
  }

  if (!k1) {
    // Deleted code files: k1 if they had doc-comments
    for (const p of delta.deleted) {
      if (!isCodeFile(p)) continue;
      const storedDocHash = storedDocHashes[p] ?? EMPTY_HASH;
      if (storedDocHash !== EMPTY_HASH) { k1 = true; break; }
    }
  }

  // ── K2: .guild/wiki/ or docs/knowledge/ path changed ──────────────────
  const k2 = allChanged.some((p) => isWikiPath(p) || isKnowledgePath(p));

  // ── K3: standalone diagram OR .md-with-mermaid changed ────────────────
  let k3 = allChanged.some((p) => isDiagramFile(p));

  if (!k3) {
    for (const p of [...delta.added, ...delta.modified]) {
      if (!isDocFile(p)) continue;
      if (containsMermaid(current[p] ?? "") || storedMermaidSet.has(p)) {
        k3 = true; break;
      }
    }
  }

  if (!k3) {
    for (const p of delta.deleted) {
      if (isDocFile(p) && storedMermaidSet.has(p)) { k3 = true; break; }
    }
  }

  // ── K4, K5, K6 ────────────────────────────────────────────────────────
  const k4 = k1 || k2 || k3;
  const k5 = k1 || k2 || k3;
  const k6 = k1 || k2 || k3;

  // ── structuralSkip ─────────────────────────────────────────────────────
  let structuralSkip = true;

  for (const p of delta.modified) {
    if (!isCodeFile(p)) continue;
    const storedNonHash = storedNonHashes[p] ?? EMPTY_HASH;
    const currentNonHash = sha256Hash(extractNonCommentCode(current[p] ?? ""));
    if (currentNonHash !== storedNonHash) { structuralSkip = false; break; }
  }

  if (structuralSkip) {
    for (const p of delta.added) {
      if (!isCodeFile(p)) continue;
      const nonHash = sha256Hash(extractNonCommentCode(current[p] ?? ""));
      if (nonHash !== EMPTY_HASH) { structuralSkip = false; break; }
    }
  }

  if (structuralSkip) {
    for (const p of delta.deleted) {
      if (!isCodeFile(p)) continue;
      const storedNonHash = storedNonHashes[p] ?? EMPTY_HASH;
      if (storedNonHash !== EMPTY_HASH) { structuralSkip = false; break; }
    }
  }

  // ── Reason string ──────────────────────────────────────────────────────
  const staleStages = ["k1", "k2", "k3", "k4", "k5", "k6"].filter(
    (s) => ({ k1, k2, k3, k4, k5, k6 } as Record<string, boolean>)[s],
  );
  const skipNote = structuralSkip ? " (structural-skip)" : "";
  const reason =
    staleStages.length === 0
      ? `no relevant file changes — all K-stages up to date${skipNote}`
      : `${allChanged.length} file(s) changed → stale: ${staleStages.join(", ")}${skipNote}`;

  return { k1, k2, k3, k4, k5, k6, structuralSkip, reason };
}

// ---------------------------------------------------------------------------
// FS helpers
// ---------------------------------------------------------------------------

function kStoreFile(repoRoot: string): string {
  return path.join(repoRoot, ".guild", "indexes", "kstage-fingerprint.json");
}

export function readKStageTree(repoRoot: string): Record<string, string> {
  const { files } = walkRepo(repoRoot);
  const out: Record<string, string> = {};
  for (const rel of files) {
    if (!isKStageTrackedFile(rel)) continue;
    try {
      out[rel] = fs.readFileSync(path.join(repoRoot, rel), "utf8");
    } catch { /* skip unreadable */ }
  }
  return out;
}

export function writeKStageBaseline(repoRoot: string): void {
  const tree = readKStageTree(repoRoot);
  const store = buildKStageStore(tree);
  const storePath = kStoreFile(repoRoot);
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  fs.writeFileSync(storePath, JSON.stringify(store, null, 2) + "\n", "utf8");
}

export function runKStageStaleness(cwd: string): KStageStaleness {
  let repoRoot: string;
  try {
    repoRoot = guildPaths(cwd).repoRoot;
  } catch {
    repoRoot = cwd;
  }

  const storePath = kStoreFile(repoRoot);
  if (!fs.existsSync(storePath)) {
    return {
      k1: true, k2: true, k3: true, k4: true, k5: true, k6: true,
      structuralSkip: false,
      reason: "no K-stage baseline — treat all stages as stale (run --baseline after the first K-pipeline build)",
    };
  }

  let stored: KStageStore;
  try {
    stored = JSON.parse(fs.readFileSync(storePath, "utf8")) as KStageStore;
  } catch {
    return {
      k1: true, k2: true, k3: true, k4: true, k5: true, k6: true,
      structuralSkip: false,
      reason: "K-stage baseline unreadable — treat all stages as stale",
    };
  }

  const current = readKStageTree(repoRoot);
  const delta = analyzeHashDelta(stored, current);
  return classifyKStages(delta, stored, current);
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

function main(): void {
  const argv = process.argv.slice(2);
  const cwd = parseCwd(argv);

  if (hasFlag(argv, "baseline")) {
    let repoRoot: string;
    try {
      repoRoot = guildPaths(cwd).repoRoot;
    } catch {
      repoRoot = cwd;
    }
    writeKStageBaseline(repoRoot);
    process.stderr.write(
      `[k-stage-staleness] baseline written → ${path.join(repoRoot, ".guild", "indexes", "kstage-fingerprint.json")}\n`,
    );
    process.stdout.write("BASELINE\n");
    return;
  }

  const result = runKStageStaleness(cwd);
  process.stdout.write(JSON.stringify(result) + "\n");
  if (!hasFlag(argv, "json")) {
    process.stderr.write(`[k-stage-staleness] ${result.reason}\n`);
  }
}

if (require.main === module) {
  main();
}
