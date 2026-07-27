#!/usr/bin/env -S npx tsx
/**
 * learn/wiki-lint-knowledge.ts — L8: Knowledge graph lint check
 *
 * Deterministic advisory lint over knowledge graph nodes.
 * Extends the wiki-lint surface (wiki-lint-checks.ts operates on .guild/wiki/ files)
 * to cover *in-graph* knowledge nodes produced by the K2 wiki-index and other K-stages.
 *
 * Flagged conditions (both advisory — deterministic-script, no LLM):
 *
 *   missing-importance  — a `wiki_page` node is missing the string `importance` field
 *                         (high|medium|low), or its value is not one of those three strings.
 *                         The v2 validator does NOT require `importance` on wiki_page nodes
 *                         (only `category` is validator-required) — this is the lint-only
 *                         advisory catch (SC-6 lint half).
 *
 *                         Per-type importance contract (canonical — do NOT re-spell elsewhere):
 *                           wiki_page  → string `importance` (K2 assigns; NOT validator-required)
 *                                        → THIS is the lint's job.
 *                           topic      → numeric `importance_score` (K4 assigns; validator-enforced;
 *                                        a topic missing it is dropped at validation, so the lint
 *                                        never sees one). Linting topic for STRING importance
 *                                        would false-positive on every valid topic — do NOT lint.
 *                           claim / concept / entity / diagram
 *                                      → carry `confidence`, not `importance`. Do NOT lint
 *                                        for missing importance (would produce false positives).
 *
 *   invalid-category    — any knowledge node (all 6 types) has a missing or out-of-enum
 *                         `category`. Advisory for pre-validation or v1 reads; validateGraphV2
 *                         also rejects these as hard drops, but the lint surfaces them earlier
 *                         without dropping the node from the graph.
 *
 * Knowledge node types subject to `invalid-category`:
 *   topic | concept | claim | entity | wiki_page | diagram  (all 6)
 * Knowledge node types subject to `missing-importance`:
 *   wiki_page  (only — see contract above)
 *
 * Non-knowledge nodes (file/function/class/module/domain/etc.) are silently ignored.
 *
 * SC-6 (lint half): own half of the SC-6 contract; the validator half (category enum rejection)
 * lives in validateGraphV2.
 *
 * Determinism responsibility table (SC-9):
 *   | Output         | Owner                |
 *   |----------------|----------------------|
 *   | findings list  | deterministic-script |
 *   | nodeId         | deterministic-script |
 *   | check          | deterministic-script |
 *   | reason         | deterministic-script |
 *
 * Usage (standalone): npx tsx scripts/learn/wiki-lint-knowledge.ts <graph.json>
 * Exit: 0 = clean · 2 = findings.
 *
 * Conform-by-pointer: docs/knowledge/architecture/codebase-understanding.md §K2 / SC-6
 */

import * as fs from "fs";
import * as path from "path";
import { NODE_CATEGORIES, type GraphNode } from "./knowledge-graph-contract";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * All knowledge node types (require `category`).
 * Mirrors KNOWLEDGE_NODE_TYPES_V2 in schema.ts (local — avoids touching the
 * committed L0 file; identical definition per spec).
 */
const KNOWLEDGE_NODE_TYPES = new Set([
  "topic",
  "concept",
  "claim",
  "entity",
  "wiki_page",
  "diagram",
]);

/**
 * Node types that are expected to carry the string `importance` field (high|medium|low).
 * Scope rationale (SC-9 honesty + per-type importance contract):
 *   - wiki_page: K2 classifier assigns string `importance`. The v2 validator does NOT
 *                require it, so the lint check is the only gate. THIS is what we lint.
 *   - topic:     carries NUMERIC `importance_score` (K4; validator-enforced). Valid topic
 *                nodes do NOT carry the string `importance` field — linting topic for string
 *                importance would false-positive on every valid topic. NOT in this set.
 *   - claim / concept / entity / diagram: carry `confidence`, not `importance`. NOT in this set.
 *
 * Extend this set only when a K-stage starts assigning string `importance` to additional types.
 */
const IMPORTANCE_LINTABLE_TYPES = new Set(["wiki_page"]);

/** Valid importance values. */
const VALID_IMPORTANCE = new Set(["high", "medium", "low"]);

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface KnowledgeLintFinding {
  /** The node id that triggered the finding. */
  nodeId: string;
  /**
   * Which lint rule fired:
   *   missing-importance — the `importance` field is absent or not high|medium|low.
   *   invalid-category   — the `category` field is absent or not in NODE_CATEGORIES.
   */
  check: "missing-importance" | "invalid-category";
  /** Human-readable description of why this finding was raised. */
  reason: string;
}

// ---------------------------------------------------------------------------
// Core: lintKnowledgeNodes
// ---------------------------------------------------------------------------

/**
 * Lint a list of graph nodes for SC-6 knowledge-metadata completeness.
 *
 * Checks applied to every node whose type is in KNOWLEDGE_NODE_TYPES:
 *
 *   missing-importance — `importance` is missing, null, or not one of
 *                        "high" | "medium" | "low". The v2 validator does not
 *                        enforce this; the lint check is advisory.
 *
 *   invalid-category   — `category` is missing, null, or not in NODE_CATEGORIES.
 *                        Advisory; validateGraphV2 also rejects these as drops.
 *
 * Non-knowledge nodes are silently skipped.
 * Deterministic: same input always produces the same findings (SC-9).
 *
 * @param nodes Array of GraphNode objects to inspect.
 * @returns Array of KnowledgeLintFinding (may be empty).
 */
export function lintKnowledgeNodes(nodes: GraphNode[]): KnowledgeLintFinding[] {
  const findings: KnowledgeLintFinding[] = [];

  for (const node of nodes) {
    if (!KNOWLEDGE_NODE_TYPES.has(node.type)) {
      continue; // non-knowledge node: skip
    }

    const nodeId = node.id ?? "<unknown>";

    // ── Check 1: importance (string high|medium|low) ─────────────────────────
    // Only applied to node types where a K-stage is expected to assign `importance`.
    // (SC-9 honesty: claim/concept/entity/diagram don't yet carry importance.)
    if (IMPORTANCE_LINTABLE_TYPES.has(node.type)) {
      const imp = (node as Record<string, unknown>).importance;
      const impString = typeof imp === "string" ? imp : undefined;
      if (!impString || !VALID_IMPORTANCE.has(impString)) {
        findings.push({
          nodeId,
          check: "missing-importance",
          reason: impString
            ? `knowledge node (type=${node.type}) has invalid importance "${impString}" — expected one of high|medium|low`
            : `knowledge node (type=${node.type}) is missing the required importance field (high|medium|low)`,
        });
      }
    }

    // ── Check 2: category (closed NODE_CATEGORIES enum) ──────────────────────
    // The v2 validator already rejects nodes with missing/invalid category as
    // hard drops. This lint check is advisory — it surfaces the problem before
    // (or independent of) validation, e.g. on v1 graphs or partial node lists.
    const cat = node.category;
    if (!cat || typeof cat !== "string" || !NODE_CATEGORIES.has(cat)) {
      findings.push({
        nodeId,
        check: "invalid-category",
        reason: cat
          ? `knowledge node (type=${node.type}) has invalid category "${cat}" — not in NODE_CATEGORIES enum`
          : `knowledge node (type=${node.type}) is missing the required category field`,
      });
    }
  }

  return findings;
}

// ---------------------------------------------------------------------------
// CLI entry point (standalone: npx tsx wiki-lint-knowledge.ts <graph.json>)
// ---------------------------------------------------------------------------

if (require.main === module) {
  const argv = process.argv.slice(2);
  const graphPath = argv[0];

  if (!graphPath) {
    process.stderr.write(
      "Usage: npx tsx scripts/learn/wiki-lint-knowledge.ts <graph.json> [--json]\n",
    );
    process.exit(1);
  }

  const useJson = argv.includes("--json");

  let graph: { nodes?: unknown[] };
  try {
    graph = JSON.parse(fs.readFileSync(path.resolve(graphPath), "utf8"));
  } catch (err) {
    process.stderr.write(`[wiki-lint-knowledge] ERROR reading graph: ${err}\n`);
    process.exit(1);
  }

  const nodes = Array.isArray(graph.nodes) ? (graph.nodes as GraphNode[]) : [];
  const findings = lintKnowledgeNodes(nodes);

  if (useJson) {
    process.stdout.write(JSON.stringify({ findings }, null, 2) + "\n");
  } else if (findings.length === 0) {
    process.stdout.write("[wiki-lint-knowledge] clean — 0 knowledge-lint findings\n");
  } else {
    process.stdout.write(`[wiki-lint-knowledge] ${findings.length} finding(s):\n`);
    for (const f of findings) {
      process.stdout.write(`  [${f.check}] ${f.nodeId} — ${f.reason}\n`);
    }
  }

  process.exit(findings.length > 0 ? 2 : 0);
}
