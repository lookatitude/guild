#!/usr/bin/env -S npx tsx
/**
 * understand/content-analyze.ts — K1 stage: content analysis
 *
 * Usage:
 *   npx tsx scripts/understand/content-analyze.ts <repoRoot> \
 *     [--code relPath1 relPath2 ...]  \
 *     [--docs relPath1 relPath2 ...]
 *
 * Extracts knowledge content nodes from a corpus:
 *   - concept  nodes  — from file-level doc-comments in code files
 *   - claim    nodes  — from prose sections in markdown docs
 *   - entity   nodes  — from heading-based definitions in markdown docs
 *   - clusters        — TF/co-occurrence membership groups (deterministic)
 *                       consumed by L4 (taxonomy-build) via makeTopicId(memberIds)
 *
 * Does NOT produce file/function nodes; those come from the codebase
 * structural analysis pipeline (analyze-structural.ts + graph.ts).
 *
 * SC-9 determinism responsibility table:
 * ┌──────────────────────────────────────────────┬──────────────────────────┐
 * │ Output field                                 │ Owner                    │
 * ├──────────────────────────────────────────────┼──────────────────────────┤
 * │ concept/claim/entity node id                 │ deterministic-script     │
 * │   (makeConceptId / makeClaimId / makeEntityId│                          │
 * │    hash text + anchor — id formula in code)  │                          │
 * │ source_refs (anchor derivation)              │ deterministic-script     │
 * │ node type / category                         │ deterministic-script     │
 * │ heading-slug derivation                      │ deterministic-script     │
 * │ doc-comment line-range (L1-L6)               │ deterministic-script     │
 * │ cluster membership — structural authorship   │ deterministic-script     │
 * │   (step 1: file + its own exported functions)│                          │
 * │ cluster membership — content co-occurrence   │ deterministic-script     │
 * │   (steps 2-3: cross-file co-mention in doc   │                          │
 * │    sections + mermaid; NOT dir co-location)  │                          │
 * │ concept name                                 │ LLM-judged (injectable)  │
 * │ claim text                                   │ LLM-judged (injectable)  │
 * │ entity selection (which headings are entities│ LLM-judged (injectable)  │
 * │   vs. topics / section titles)               │                          │
 * │ confidence                                   │ LLM-judged (injectable)  │
 * └──────────────────────────────────────────────┴──────────────────────────┘
 *
 * LLM seams are injectable via ContentAnalyzeOptions — unit tests inject
 * oracle-backed mocks; production callers supply a real LLM adapter.
 *
 * REQUIRED: at least one of `proposeConcepts` or `proposeClaimsAndEntities`
 * MUST be provided via opts. Calling analyzeContent without either seam throws
 * a clear error (fail-loud, not fail-silent — avoids presenting an empty graph
 * as valid SC-1 output).
 *
 * SC-1 acceptance: min_nodes_by_type: claim>=2, entity>=3, concept>=2;
 * every node has >=1 resolvable anchor; nodes_missing_confidence==0.
 *
 * Conform-by-pointer: docs/knowledge/architecture/codebase-understanding.md
 * Contract: guild.knowledge_graph.v2 (scripts/understand/lib/schema.ts)
 */

import * as fs from "fs";
import * as path from "path";
import { makeConceptId, makeClaimId, makeEntityId, resolveAnchor } from "./lib/schema";
import { analyzeSource } from "./lib/extract";
import type { GraphNode, GraphEdge } from "./lib/schema";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** A file-level block doc-comment (JSDoc-style) extracted from a code file. */
export interface DocCommentCandidate {
  /** Corpus-relative path (e.g. "src/ingest.ts"). */
  relPath: string;
  /**
   * Anchor in "relpath#Lstart-Lend" form (1-based, inclusive).
   * Example: "src/ingest.ts#L1-L6".
   */
  anchor: string;
  /**
   * Cleaned comment body — comment delimiters stripped;
   * multi-line, trimmed.
   */
  rawText: string;
}

/** A markdown heading extracted from a doc file. */
export interface HeadingCandidate {
  /** Corpus-relative path (e.g. "docs/concepts.md"). */
  relPath: string;
  /** Heading level 1–6. */
  level: number;
  /** Raw heading text (as written, without `#` markers). */
  text: string;
  /** Anchor: `relpath#heading-slug`. */
  anchor: string;
}

/** A prose section extracted from a markdown doc file (text under one heading). */
export interface ClaimSection {
  /** Corpus-relative path. */
  relPath: string;
  /** Anchor of the containing heading: `relpath#heading-slug`. */
  anchor: string;
  /** All prose text under the heading (until the next heading). */
  text: string;
}

/** A mermaid diagram block extracted from a doc file. */
export interface MermaidEntry {
  /**
   * Deterministic anchor: `relpath#mermaid-N` (0-based counter per file).
   * Mirrors the diagram ID computed by K3 (diagram-analyze).
   */
  anchor: string;
  /** Raw mermaid block content (inside the ``` fences). */
  content: string;
}

/**
 * A TF/co-occurrence cluster group — a set of corpus node IDs that
 * co-occur in the same conceptual context.
 *
 * memberIds are SORTED (for makeTopicId determinism — SC-11).
 * Each ID follows the K-tier ID convention:
 *   file:relPath, function:relPath:funcName, diagram:relPath#anchor
 *
 * L4 (taxonomy-build) calls makeTopicId(cluster.memberIds) to derive the
 * topic node ID, then names the topic via LLM.
 */
export interface ClusterGroup {
  memberIds: string[]; // sorted, ready for makeTopicId()
}

// LLM result types
export interface ConceptLLMResult {
  anchor: string;
  name: string;
  confidence?: "high" | "medium" | "low";
}
export interface ClaimLLMResult {
  anchor: string;
  text: string;
  confidence?: "high" | "medium" | "low";
}
export interface EntityLLMResult {
  name: string;
  anchor: string;
  confidence?: "high" | "medium" | "low";
}

/**
 * LLM adapter for concept extraction.
 *
 * Given doc-comment candidates, returns concept proposals (name + anchor).
 * In production: calls an LLM (cheap/mid tier) with batched doc-comment text.
 * In tests: inject oracle-backed mock for deterministic assertion.
 */
export type ProposeConceptsFn = (
  candidates: DocCommentCandidate[]
) => Promise<ConceptLLMResult[]>;

/**
 * LLM adapter for claim + entity extraction.
 *
 * Given prose sections and heading candidates, returns claim and entity proposals.
 * In production: calls an LLM with prose text.
 * In tests: inject oracle-backed mock.
 */
export type ProposeClaimsAndEntitiesFn = (
  sections: ClaimSection[],
  headings: HeadingCandidate[]
) => Promise<{ claims: ClaimLLMResult[]; entities: EntityLLMResult[] }>;

/**
 * Options for analyzeContent — LLM seams.
 *
 * At least one seam MUST be provided; calling analyzeContent without either
 * throws a clear error (fail-loud).
 */
export interface ContentAnalyzeOptions {
  proposeConcepts?: ProposeConceptsFn;
  proposeClaimsAndEntities?: ProposeClaimsAndEntitiesFn;
}

/** Result of content analysis: knowledge content nodes, edges, and clusters. */
export interface ContentAnalyzeResult {
  nodes: GraphNode[];
  /** Cross-modal edges at K1 are empty — they land in K5 (cross-link). */
  edges: GraphEdge[];
  /**
   * Deterministic TF/co-occurrence cluster membership groups.
   * Each ClusterGroup.memberIds is sorted and ready for makeTopicId().
   * Consumed by L4 (taxonomy-build) to form+name topic nodes.
   */
  clusters: ClusterGroup[];
}

// ---------------------------------------------------------------------------
// Internal: heading-slug derivation (mirrors resolveAnchor in schema.ts)
// ---------------------------------------------------------------------------

/**
 * Derive the heading anchor slug from raw heading text.
 * Mirrors the slug derivation in `resolveAnchor` (schema.ts) exactly
 * so anchors always resolve at the corpus root.
 */
function headingSlug(rawText: string): string {
  return rawText
    .trim()
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

// Note: anchor validation uses resolveAnchor() from ./lib/schema (exported).
// resolveAnchor does FULL per-form resolution:
//   path#Lx-Ly    — file exists AND line range in bounds
//   path#mermaid-N — file exists AND Nth mermaid fence exists
//   path#heading   — file exists AND heading slug resolves
//   path#svg       — file exists AND contains <svg> root element
//   path#element-id — SVG file contains id="element-id"
//   path (bare)    — file exists
// Never re-implement this inline — use the canonical resolver.

// ---------------------------------------------------------------------------
// Deterministic extraction: doc-comment candidates
// ---------------------------------------------------------------------------

/**
 * Extract file-level block doc-comments (`/** ... */`) from each code file.
 *
 * Deterministic: reads files, finds the first `/**` comment block starting at
 * the beginning of the file (optionally preceded by a shebang line), records
 * the 1-based start/end line numbers, and strips the comment decorators to
 * produce the rawText.
 *
 * One candidate per file. Files without a leading block comment are skipped.
 *
 * SC-9: fully deterministic-script — no model calls.
 */
export function extractDocCommentCandidates(
  repoRoot: string,
  codeRelPaths: string[]
): DocCommentCandidate[] {
  const results: DocCommentCandidate[] = [];

  for (const relPath of codeRelPaths) {
    const absPath = path.join(repoRoot, relPath);
    let content: string;
    try {
      content = fs.readFileSync(absPath, "utf8");
    } catch {
      continue;
    }

    const lines = content.split("\n");

    // Find the first `/**` block comment, allowing a shebang or blank lines before it.
    let startIdx = -1; // 0-based index
    let endIdx   = -1;

    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trimStart();
      // Skip shebang and leading blank lines
      if (startIdx === -1) {
        if (trimmed.startsWith("#!") || trimmed === "") continue;
        if (trimmed.startsWith("/**")) {
          startIdx = i;
          // Check for single-line comment: /** ... */
          if (trimmed.includes("*/", 3)) {
            endIdx = i;
            break;
          }
        } else {
          break; // File doesn't start with a block comment
        }
      } else {
        // We're inside the block — look for closing */
        if (trimmed.startsWith("*/") || trimmed.endsWith("*/")) {
          endIdx = i;
          break;
        }
      }
    }

    if (startIdx === -1 || endIdx === -1) continue;

    // Strip decorators: remove `/**`, ` * `, `*/` from each line
    const bodyLines = lines.slice(startIdx, endIdx + 1).map((line) => {
      return line
        .replace(/^\s*\/\*\*\s?/, "")   // /** at start
        .replace(/^\s*\*\/\s*$/, "")    // */ alone on a line
        .replace(/^\s*\*\s?/, "")       // * at start of interior lines
        .trimEnd();
    });
    const rawText = bodyLines.filter((l) => l !== "").join("\n").trim();

    if (!rawText) continue;

    const startLine = startIdx + 1; // 1-based
    const endLine   = endIdx + 1;   // 1-based
    const anchor = `${relPath}#L${startLine}-L${endLine}`;

    results.push({ relPath, anchor, rawText });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Deterministic extraction: heading candidates
// ---------------------------------------------------------------------------

/**
 * Extract all markdown headings (H1–H6) from each doc file.
 *
 * Returns one HeadingCandidate per heading encountered, in document order.
 * Anchor = `relpath#heading-slug` where the slug mirrors the resolveAnchor
 * derivation in schema.ts.
 *
 * SC-9: fully deterministic-script.
 */
export function extractHeadingCandidates(
  repoRoot: string,
  docRelPaths: string[]
): HeadingCandidate[] {
  const results: HeadingCandidate[] = [];

  for (const relPath of docRelPaths) {
    const absPath = path.join(repoRoot, relPath);
    let content: string;
    try {
      content = fs.readFileSync(absPath, "utf8");
    } catch {
      continue;
    }

    const headingRe = /^(#{1,6})\s+(.+)$/gm;
    let m: RegExpExecArray | null;
    while ((m = headingRe.exec(content)) !== null) {
      const level = m[1].length;
      const text  = m[2].trim();
      const slug  = headingSlug(text);
      if (!slug) continue;
      const anchor = `${relPath}#${slug}`;
      results.push({ relPath, level, text, anchor });
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Deterministic extraction: claim sections
// ---------------------------------------------------------------------------

/**
 * Split each markdown file into sections (one per heading) and return the
 * prose text under each heading as a ClaimSection.
 *
 * Sections with no prose text (empty after trimming) are omitted.
 * The anchor for each section is `relpath#heading-slug` of the section heading.
 *
 * SC-9: fully deterministic-script.
 */
export function extractClaimSections(
  repoRoot: string,
  docRelPaths: string[]
): ClaimSection[] {
  const results: ClaimSection[] = [];

  for (const relPath of docRelPaths) {
    const absPath = path.join(repoRoot, relPath);
    let content: string;
    try {
      content = fs.readFileSync(absPath, "utf8");
    } catch {
      continue;
    }

    const lines = content.split("\n");

    // Walk line-by-line, accumulating prose under each heading.
    let currentAnchor: string | null = null;
    let proseLines: string[] = [];

    const flushSection = () => {
      if (currentAnchor === null) return;
      const text = proseLines
        .join("\n")
        .replace(/```[\s\S]*?```/g, "") // strip code/mermaid fences
        .trim();
      if (text) results.push({ relPath, anchor: currentAnchor, text });
      proseLines = [];
    };

    for (const line of lines) {
      const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
      if (headingMatch) {
        flushSection();
        const text = headingMatch[2].trim();
        const slug = headingSlug(text);
        currentAnchor = slug ? `${relPath}#${slug}` : null;
      } else {
        if (currentAnchor !== null) proseLines.push(line);
      }
    }
    flushSection();
  }

  return results;
}

// ---------------------------------------------------------------------------
// Deterministic extraction: mermaid diagram entries
// ---------------------------------------------------------------------------

/**
 * Extract mermaid diagram blocks from markdown doc files.
 *
 * Returns one MermaidEntry per ``` ```mermaid ``` block found, in document order.
 * The anchor follows the K3 deterministic convention: `relpath#mermaid-N`
 * where N is the 0-based per-file block index.
 *
 * SC-9: fully deterministic-script — IDs are positional, no LLM.
 */
export function extractMermaidEntries(
  repoRoot: string,
  docRelPaths: string[]
): MermaidEntry[] {
  const results: MermaidEntry[] = [];

  for (const relPath of docRelPaths) {
    const absPath = path.join(repoRoot, relPath);
    let content: string;
    try {
      content = fs.readFileSync(absPath, "utf8");
    } catch {
      continue;
    }

    const mermaidRe = /^```mermaid\s*\n([\s\S]*?)^```/gm;
    let m: RegExpExecArray | null;
    let blockIndex = 0;
    while ((m = mermaidRe.exec(content)) !== null) {
      const anchor = `${relPath}#mermaid-${blockIndex}`;
      const blockContent = m[1].trim();
      if (blockContent) {
        results.push({ anchor, content: blockContent });
        blockIndex++;
      }
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Deterministic extraction: function IDs from code files
// ---------------------------------------------------------------------------

/**
 * Extract exported function IDs from code files.
 *
 * For each code file, uses analyzeSource (the structural extractor) to
 * discover exported function names and returns them as
 * `function:relPath:funcName` IDs.
 *
 * Only EXPORTED functions are included (they represent the public API surface
 * that doc sections reference). Files with no exported functions are skipped.
 *
 * SC-9: deterministic-script — no model calls.
 */
export function extractFunctionIds(
  repoRoot: string,
  codeRelPaths: string[]
): string[] {
  const results: string[] = [];

  for (const relPath of codeRelPaths) {
    const absPath = path.join(repoRoot, relPath);
    let content: string;
    try {
      content = fs.readFileSync(absPath, "utf8");
    } catch {
      continue;
    }

    const analysis = analyzeSource(relPath, content);
    if (!analysis) continue;

    for (const fn of analysis.functions) {
      if (!fn.exported) continue;
      results.push(`function:${relPath}:${fn.name}`);
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Deterministic clustering: content co-occurrence
// ---------------------------------------------------------------------------

/**
 * Build cluster groups from structural authorship and content co-occurrence.
 *
 * Algorithm (SC-9 deterministic-script):
 *
 *   1. STRUCTURAL AUTHORSHIP — each code file + its own exported functions.
 *      These are structurally co-located by definition (the functions are
 *      defined IN the file). This step is structural, NOT content-based —
 *      but is required: the oracle topic_member_sets include these per-file
 *      clusters and L4 needs them to build the taxonomy leaf nodes.
 *      ["file:src/ingest.ts", "function:src/ingest.ts:ingestEvent"]
 *
 *   2. CONTENT CO-MENTION (cross-file) — for each prose doc section, scan text
 *      for exported function names (word-boundary match \b). When names from
 *      ≥2 DIFFERENT code files are mentioned in the same section, emit a
 *      cross-file cluster of those file entities. This IS content-based and
 *      prevents the "structural directory = topic" defect.
 *      If multiple files export the same function name, ALL of them are
 *      attributed (funcName → funcIds[], not a single overwrite).
 *      ["file:src/ingest.ts", "file:src/validate.ts"]
 *
 *   3. MERMAID CO-MENTION (cross-file + diagram) — for each mermaid block,
 *      scan content for function names (word-boundary match \b):
 *      a. Diagram + FIRST matching function (pairwise):
 *         ["diagram:docs/ingestion.md#mermaid-0", "function:src/ingest.ts:ingestEvent"]
 *      b. Cross-file: when names from ≥2 files co-occur in the diagram, cluster
 *         those file entities together:
 *         ["file:src/ingest.ts", "file:src/store.ts", "file:src/validate.ts"]
 *
 * docSections: pre-extracted prose sections (from extractClaimSections).
 *   Mermaid fences are already stripped from prose text; pass mermaidEntries
 *   separately for diagram co-occurrence.
 *
 * All memberIds within each ClusterGroup are SORTED (makeTopicId hashes
 * the sorted join, so order does not affect the ID — SC-11 invariant).
 *
 * Dedup: clusters with identical sorted member sets are deduplicated.
 * Single-member clusters are skipped (makeTopicId needs ≥1 member; L4
 * creates single-function topics from topology, not from K1 clustering).
 *
 * SC-9: fully deterministic-script — no model calls.
 */
export function buildContentClusters(
  codeRelPaths: string[],
  functionIds: string[],
  docSections: ClaimSection[],     // prose sections (mermaid-stripped) for co-mention
  mermaidEntries: MermaidEntry[]   // mermaid blocks for diagram co-occurrence
): ClusterGroup[] {
  const results: ClusterGroup[] = [];
  const seen = new Set<string>(); // sorted-join key for dedup

  const addCluster = (memberIds: string[]) => {
    if (memberIds.length < 2) return; // skip single-member (L4 handles those)
    const sorted = [...memberIds].sort();
    const key = sorted.join("|");
    if (seen.has(key)) return;
    seen.add(key);
    results.push({ memberIds: sorted });
  };

  // Build lookups: funcName → funcIds[], funcId → fileId.
  // W1: multiple files may export the SAME function name (e.g. `handler`, `run`).
  // Using string[] prevents the last-write-wins overwrite that silently drops
  // clusters when two files share an exported name.
  // funcId format: "function:<relPath>:<funcName>" (relPath has / not :)
  const funcNameToIds = new Map<string, string[]>(); // funcName → funcId[] (all files)
  const funcIdToFileId = new Map<string, string>();   // funcId  → file:<relPath>
  for (const funcId of functionIds) {
    const parts = funcId.split(":");
    if (parts.length === 3) {
      const funcName = parts[2];    // "ingestEvent"
      const relPath  = parts[1];    // "src/ingest.ts"
      const existing = funcNameToIds.get(funcName);
      if (existing) {
        existing.push(funcId);
      } else {
        funcNameToIds.set(funcName, [funcId]);
      }
      funcIdToFileId.set(funcId, `file:${relPath}`);
    }
  }

  // Pre-compile word-boundary regexes (once per funcName — avoids recompiling per
  // text match). Using \b<escaped>\b prevents false positives where a short function
  // name is a substring of a longer word (e.g. "store" ⊂ "stored"/"restored";
  // "get" ⊂ "getUser"; "Event" ⊂ "ingestEvent"; "run" ⊂ "runner").
  const funcNamePatterns = new Map<string, RegExp>();
  for (const [funcName] of funcNameToIds) {
    const escaped = funcName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    funcNamePatterns.set(funcName, new RegExp(`\\b${escaped}\\b`));
  }

  // ── 1. Structural authorship: each code file + its own exported functions ─
  // These are defined IN the file — structural, not content-based co-mention.
  // Required by oracle topic_member_sets (expected-output.json per-file clusters).
  for (const relPath of codeRelPaths) {
    const fileId = `file:${relPath}`;
    const prefix = `function:${relPath}:`;
    const fileFunctionIds = functionIds.filter((id) => id.startsWith(prefix));
    if (fileFunctionIds.length > 0) {
      addCluster([fileId, ...fileFunctionIds]);
    }
  }

  // ── 2. Content co-mention (cross-file): doc-section clusters ─────────────
  // When prose text in a single section mentions function names from ≥2 DIFFERENT
  // files (word-boundary match), emit a cross-file cluster of those file entities.
  // W1: a funcName match attributes ALL files that export that name (funcIds[]).
  for (const section of docSections) {
    const fileIdsMentioned = new Set<string>();
    for (const [funcName, funcIds] of funcNameToIds) {
      // Word-boundary match: \bfuncName\b prevents false positives from short
      // names that appear as substrings (e.g. "store" inside "stored"/"restored").
      if (funcNamePatterns.get(funcName)!.test(section.text)) {
        for (const funcId of funcIds) {
          const fileId = funcIdToFileId.get(funcId);
          if (fileId) fileIdsMentioned.add(fileId);
        }
      }
    }
    if (fileIdsMentioned.size >= 2) {
      addCluster([...fileIdsMentioned]);
    }
  }

  // ── 3. Content co-mention (cross-file): mermaid diagram clusters ──────────
  // W1: same funcName → funcIds[] attribution applies here too.
  for (const entry of mermaidEntries) {
    const diagramId = `diagram:${entry.anchor}`;
    const fileIdsMentioned = new Set<string>();
    let firstFuncId: string | null = null;

    for (const [funcName, funcIds] of funcNameToIds) {
      // Word-boundary match (same rationale as doc-section co-mention above).
      if (funcNamePatterns.get(funcName)!.test(entry.content)) {
        // firstFuncId = first funcId of the first matching name (for diagram pair)
        if (firstFuncId === null) firstFuncId = funcIds[0];
        for (const funcId of funcIds) {
          const fileId = funcIdToFileId.get(funcId);
          if (fileId) fileIdsMentioned.add(fileId);
        }
      }
    }

    // 3a. Diagram + first function (pairwise)
    if (firstFuncId !== null) {
      addCluster([diagramId, firstFuncId]);
    }

    // 3b. Cross-file cluster when ≥2 files co-occur in the diagram
    if (fileIdsMentioned.size >= 2) {
      addCluster([...fileIdsMentioned]);
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Node builders (deterministic ids from schema helpers)
// ---------------------------------------------------------------------------

/**
 * Build a `concept` GraphNode from a doc-comment anchor and an LLM-proposed name.
 *
 * id: makeConceptId(anchor, name) → `concept:<anchor>:<sha8>`
 * SC-9: id derivation is deterministic-script (hash of normalizedText + anchor);
 *   the `name` text itself is LLM-judged.
 */
export function buildConceptNode(
  anchor: string,
  name: string,
  confidence: "high" | "medium" | "low" = "high"
): GraphNode {
  return {
    id: makeConceptId(anchor, name),
    type: "concept",
    name,
    category: "concept",
    source_refs: [anchor],
    confidence,
  };
}

/**
 * Build a `claim` GraphNode from a section anchor and an LLM-extracted claim text.
 *
 * id: makeClaimId(anchor, text) → `claim:<anchor>:<sha8>`
 */
export function buildClaimNode(
  anchor: string,
  text: string,
  confidence: "high" | "medium" | "low" = "high"
): GraphNode {
  return {
    id: makeClaimId(anchor, text),
    type: "claim",
    name: text,
    category: "claim",
    source_refs: [anchor],
    confidence,
  };
}

/**
 * Build an `entity` GraphNode from a normalized name and a heading anchor.
 *
 * id: makeEntityId(name) → `entity:<normalized-name>`
 * SC-9: entity id is deterministic-script (normalized heading text);
 *   which headings qualify as entities is LLM-judged.
 */
export function buildEntityNode(
  name: string,
  anchor: string,
  confidence: "high" | "medium" | "low" = "high"
): GraphNode {
  return {
    id: makeEntityId(name),
    type: "entity",
    name,
    category: "definition",
    source_refs: [anchor],
    confidence,
  };
}

// ---------------------------------------------------------------------------
// Full pipeline: analyzeContent
// ---------------------------------------------------------------------------

/**
 * Run K1 content analysis over a corpus.
 *
 * REQUIRED: opts must provide at least one LLM seam (proposeConcepts or
 * proposeClaimsAndEntities). Calling this function without any seam throws
 * "K1 requires an LLM adapter" (fail-loud, not fail-silent).
 *
 * Workflow:
 *   1. Guard: throw if both seams absent (fail-loud)
 *   2. Deterministic: extractFunctionIds + extractMermaidEntries + extractClaimSections
 *   3. buildContentClusters (content co-occurrence — deterministic, no LLM) → clusters
 *   4. extractDocCommentCandidates (deterministic)
 *   5. opts.proposeConcepts (LLM) → concept proposals
 *   6. resolveAnchor full-form validation + buildConceptNode per accepted proposal
 *   7. extractHeadingCandidates (deterministic); reuse claimSections from step 2
 *   8. opts.proposeClaimsAndEntities (LLM) → claim + entity proposals
 *   9. resolveAnchor full-form validation + buildClaimNode / buildEntityNode
 *  10. Dedup by id (first wins); return { nodes, edges: [], clusters }
 *
 * SC-9: deterministic phases (1-3, 4, 7) produce anchors + candidates.
 *   LLM phases (5, 8) are injected; id derivation in 6/9 is deterministic.
 *   resolveAnchor in 6/9 enforces per-form anchor validity before addNode().
 * SC-11: same inputs + deterministic LLM mock → same outputs.
 */
export async function analyzeContent(
  repoRoot: string,
  codeRelPaths: string[],
  docRelPaths: string[],
  opts?: ContentAnalyzeOptions
): Promise<ContentAnalyzeResult> {
  // ── BLOCKER 2: fail-loud when no LLM adapter injected ───────────────────
  if (!opts?.proposeConcepts && !opts?.proposeClaimsAndEntities) {
    throw new Error(
      "K1 analyzeContent requires at least one LLM adapter. " +
        "Inject ProposeConceptsFn and/or ProposeClaimsAndEntitiesFn via " +
        "ContentAnalyzeOptions. In tests, inject an oracle-backed mock. " +
        "In production, inject the real LLM adapter (wired at L6)."
    );
  }

  // ── Deterministic extraction (upfront — used by clustering AND LLM phases) ─
  const functionIds    = extractFunctionIds(repoRoot, codeRelPaths);
  const mermaidEntries = extractMermaidEntries(repoRoot, docRelPaths);
  // claimSections extracted once; reused for clustering (co-mention) + proposeClaimsAndEntities
  const claimSections  = extractClaimSections(repoRoot, docRelPaths);

  // ── Content co-occurrence clustering (deterministic-script, no LLM) ──────
  const clusters = buildContentClusters(codeRelPaths, functionIds, claimSections, mermaidEntries);

  const nodeMap = new Map<string, GraphNode>(); // id → node (dedup)

  const addNode = (n: GraphNode) => {
    if (!nodeMap.has(n.id)) nodeMap.set(n.id, n);
  };

  // ── Phase 4–6: concept nodes from doc-comments ───────────────────────────

  if (opts?.proposeConcepts) {
    const docCommentCandidates = extractDocCommentCandidates(repoRoot, codeRelPaths);
    const conceptProposals = await opts.proposeConcepts(docCommentCandidates);
    for (const p of conceptProposals) {
      if (!p.anchor || !p.name) continue;
      // BLOCKER 3: validate anchor before accepting the proposal
      if (!resolveAnchor(repoRoot, p.anchor)) continue;
      addNode(buildConceptNode(p.anchor, p.name, p.confidence ?? "high"));
    }
  }

  // ── Phase 7–9: claim + entity nodes from docs ────────────────────────────

  if (opts?.proposeClaimsAndEntities) {
    const headingCandidates = extractHeadingCandidates(repoRoot, docRelPaths);
    // reuse claimSections extracted upfront (already used for clustering above)
    const { claims, entities } = await opts.proposeClaimsAndEntities(
      claimSections,
      headingCandidates
    );
    for (const c of claims) {
      if (!c.anchor || !c.text) continue;
      // BLOCKER 3: validate anchor
      if (!resolveAnchor(repoRoot, c.anchor)) continue;
      addNode(buildClaimNode(c.anchor, c.text, c.confidence ?? "high"));
    }
    for (const e of entities) {
      if (!e.name || !e.anchor) continue;
      // BLOCKER 3: validate anchor
      if (!resolveAnchor(repoRoot, e.anchor)) continue;
      addNode(buildEntityNode(e.name, e.anchor, e.confidence ?? "high"));
    }
  }

  return {
    nodes: [...nodeMap.values()],
    edges: [],
    clusters,
  };
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

if (require.main === module) {
  const argv = process.argv.slice(2);
  if (argv.length < 1) {
    process.stderr.write(
      "Usage: npx tsx content-analyze.ts <repoRoot> [--code ...] [--docs ...]\n"
    );
    process.exit(1);
  }
  process.stderr.write(
    "[content-analyze] K1 stage loaded. Run via the K-tier pipeline or in tests.\n"
  );
}
