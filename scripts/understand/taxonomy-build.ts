/**
 * understand/taxonomy-build.ts — K4 stage: build topic taxonomy from K1 clusters
 *
 * Usage: invoked from the knowledge pipeline after content-analyze (K1).
 *   import { buildTaxonomy } from "./taxonomy-build";
 *   const result = await buildTaxonomy(repoRoot, clusters, { proposeTaxonomy });
 *
 * Determinism table (SC-9):
 * ┌─────────────────────────────────────┬──────────────────────────┐
 * │ Field                               │ Owner                    │
 * ├─────────────────────────────────────┼──────────────────────────┤
 * │ topic ID (makeTopicId(memberIds))   │ deterministic-script     │
 * │ hub function detection (≥2 refs)    │ deterministic-script     │
 * │ domain ID (domain:<slug>)           │ deterministic-script     │
 * │ topic_path (slugified parent chain) │ deterministic-script     │
 * │ importance label (score→band)       │ deterministic-script     │
 * │ SC-2 fold (importanceScore < thr.)  │ deterministic-script     │
 * │ SC-2 acyclicity check               │ deterministic-script     │
 * │ SC-2 depth / fan-out checks         │ deterministic-script     │
 * │ SC-5 top-level dir detection        │ deterministic-script     │
 * │ topic name                          │ LLM-judged (injectable)  │
 * │ parent assignment                   │ LLM-judged (injectable)  │
 * │ importance score                    │ LLM-judged (injectable)  │
 * │ source_refs (topic doc anchor)      │ LLM-judged (injectable)  │
 * │ domain name                         │ LLM-judged (injectable)  │
 * │ domain-topic assignments            │ LLM-judged (injectable)  │
 * └─────────────────────────────────────┴──────────────────────────┘
 *
 * SC-2 invariants enforced:
 *   maxDepth (8)          — throws if any post-fold topic exceeds it
 *   maxBranching (12)     — throws if any node has >12 children
 *   minTopicImportance    — topics below 0.4 are folded (children promoted)
 *   acyclicity            — throws if subtopic_of graph contains a cycle
 *
 * SC-5 invariants enforced:
 *   domain names must NOT equal any top-level directory name in repoRoot
 *   behavioral domain names required (e.g. "Event Ingestion", not "src")
 */

import * as fs from "fs";
import * as path from "path";

import {
  makeTopicId,
  resolveAnchor,
  KNOWLEDGE_CONFIG_DEFAULTS,
} from "./lib/schema";
import type { GraphNode, GraphEdge } from "./lib/schema";
import type { ClusterGroup } from "./content-analyze";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** One input unit passed to the LLM seam — a cluster mapped to its topicId. */
export interface TopicInput {
  topicId: string;
  memberIds: string[];
}

/** LLM-produced proposal for a single topic. */
export interface TopicProposal {
  topicId: string;
  name: string;
  importanceScore: number;  // 0..1; LLM-judged
  sourceRef: string;        // ONE resolvable anchor (LLM-picked doc heading)
  parentTopicId: string | null;  // null = root topic
}

/** LLM-produced proposal for a semantic domain. */
export interface DomainProposal {
  name: string;         // behavioral (must NOT equal a top-level dir name)
  topicIds: string[];   // which topics belong to this domain
  sourceRef: string;    // resolvable anchor
}

/**
 * Injectable LLM seam — required.  In tests, inject an oracle-backed mock.
 * In production, inject the real Anthropic adapter.
 * FAIL-LOUD: buildTaxonomy throws if this is absent.
 */
export type ProposeTaxonomyFn = (
  topicInputs: TopicInput[],
  context: { forbiddenDomainNames: string[] }
) => Promise<{
  topicProposals: TopicProposal[];
  domainProposals: DomainProposal[];
}>;

/** Options passed to buildTaxonomy. */
export interface TaxonomyBuildOptions {
  proposeTaxonomy: ProposeTaxonomyFn;
  maxDepth?: number;
  maxBranching?: number;
  minTopicImportance?: number;
}

/** Output of buildTaxonomy. */
export interface TaxonomyBuildResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

// ---------------------------------------------------------------------------
// Pure deterministic helpers (all exported for unit testing)
// ---------------------------------------------------------------------------

/**
 * Slugify a topic name for use in topic_path segments.
 * Lowercases, strips non-word characters except hyphens, collapses hyphens.
 * E.g. "Event Pipeline" → "event-pipeline".
 */
export function slugifyTopicName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")   // strip non-word except space+hyphen
    .replace(/\s+/g, "-")       // spaces → hyphens
    .replace(/-+/g, "-")        // collapse repeated hyphens
    .replace(/^-|-$/g, "");     // strip leading/trailing hyphens
}

/**
 * Derive a deterministic domain ID from a proposed behavioral name.
 * "Event Ingestion" → "domain:event-ingestion"
 * SC-5: caller must verify the normalized segment does not match a top-level dir.
 */
export function deriveDomainId(name: string): string {
  return `domain:${slugifyTopicName(name)}`;
}

/**
 * Derive the topic_path array for a topic — slugified names from root to leaf.
 * parentMap and nameMap must be consistent (built from kept proposals after fold).
 * Cycle-safe (visited set guard), though validateAcyclicity should be called first.
 */
export function deriveTopicPath(
  topicId: string,
  parentMap: ReadonlyMap<string, string | null>,
  nameMap: ReadonlyMap<string, string>
): string[] {
  const segments: string[] = [];
  let current: string | null = topicId;
  const visited = new Set<string>();

  while (current !== null) {
    if (visited.has(current)) break; // cycle guard (should not happen post-validation)
    visited.add(current);
    const name = nameMap.get(current);
    if (name) segments.unshift(slugifyTopicName(name));
    current = parentMap.get(current) ?? null;
  }
  return segments;
}

/**
 * Collect one TopicInput per distinct K1 ClusterGroup.
 * topicId = makeTopicId(cluster.memberIds) — deterministic.
 * Deduplicates clusters with identical member sets.
 */
export function collectTopicInputs(clusters: ClusterGroup[]): TopicInput[] {
  const seen = new Set<string>();
  const results: TopicInput[] = [];
  for (const cluster of clusters) {
    const topicId = makeTopicId(cluster.memberIds);
    if (seen.has(topicId)) continue;
    seen.add(topicId);
    results.push({ topicId, memberIds: [...cluster.memberIds] });
  }
  return results;
}

/**
 * Find "hub" function IDs — function IDs that appear in ≥2 distinct K1 clusters.
 * For each hub, add a singleton TopicInput (single-function topic).
 *
 * Hub detection rule (SC-11 / K4 spec):
 *   A funcId referenced in ≥2 K1 clusters signals a highly-coupled API surface.
 *   K1 skips singleton clusters; K4 adds them as hub topics.
 *
 * Deduplicated against existingIds to avoid double-counting.
 */
export function addHubTopics(
  clusters: ClusterGroup[],
  baseInputs: TopicInput[]
): TopicInput[] {
  // Count distinct-cluster references per funcId
  const funcRefCount = new Map<string, number>();
  for (const cluster of clusters) {
    for (const memberId of cluster.memberIds) {
      if (memberId.startsWith("function:")) {
        funcRefCount.set(memberId, (funcRefCount.get(memberId) ?? 0) + 1);
      }
    }
  }

  const existingIds = new Set(baseInputs.map((t) => t.topicId));
  const hubs: TopicInput[] = [];

  for (const [funcId, count] of funcRefCount) {
    if (count >= 2) {
      const memberIds = [funcId]; // singleton — single element, sorted trivially
      const topicId = makeTopicId(memberIds);
      if (!existingIds.has(topicId)) {
        hubs.push({ topicId, memberIds });
        existingIds.add(topicId);
      }
    }
  }

  return [...baseInputs, ...hubs];
}

/**
 * Validate the subtopic_of parentMap for cycles.
 * Throws with a "cycle" message if any cycle is detected (SC-2 acyclicity invariant).
 * Traversal is per-node: O(n²) but fine for n ≤ KNOWLEDGE_CONFIG_DEFAULTS.maxDepth * maxBranching.
 */
export function validateAcyclicity(
  parentMap: ReadonlyMap<string, string | null>
): void {
  for (const [startId] of parentMap) {
    const visited = new Set<string>();
    let current: string | null = startId;
    while (current !== null) {
      if (visited.has(current)) {
        throw new Error(
          `K4 taxonomy-build: subtopic_of cycle detected involving topic "${current}". ` +
          "The parent assignment creates a cycle — all subtopic_of edges must form an acyclic tree."
        );
      }
      visited.add(current);
      current = parentMap.get(current) ?? null;
    }
  }
}

/**
 * Fold sub-threshold topics: remove any topic whose importanceScore < minTopicImportance.
 * Children of a folded topic are promoted to the folded topic's nearest kept ancestor.
 * Cascading: if the ancestor is also sub-threshold, the child is promoted further up.
 * SC-2: no emitted topic may have importance_score below minTopicImportance.
 */
export function foldSubThreshold(
  proposals: TopicProposal[],
  minTopicImportance: number
): TopicProposal[] {
  // Build parent map (all proposals including sub-threshold)
  const parentMap = new Map<string, string | null>(
    proposals.map((p) => [p.topicId, p.parentTopicId])
  );

  // Identify sub-threshold topic IDs
  const subThreshold = new Set(
    proposals
      .filter((p) => p.importanceScore < minTopicImportance)
      .map((p) => p.topicId)
  );

  // Walk up from topicId's PARENT, skipping sub-threshold nodes,
  // returning the nearest kept ancestor (or null if none).
  const resolveParent = (topicId: string): string | null => {
    let current = parentMap.get(topicId) ?? null;
    while (current !== null && subThreshold.has(current)) {
      current = parentMap.get(current) ?? null;
    }
    return current;
  };

  // Return kept proposals with updated parentTopicId
  return proposals
    .filter((p) => !subThreshold.has(p.topicId))
    .map((p) => ({
      ...p,
      parentTopicId: resolveParent(p.topicId),
    }));
}

/**
 * Read top-level (non-dot) directory names from repoRoot.
 * Used for SC-5: domains must NOT be named after these directories.
 */
export function getTopLevelDirs(repoRoot: string): string[] {
  try {
    return fs
      .readdirSync(repoRoot, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith("."))
      .map((e) => e.name);
  } catch {
    return [];
  }
}

/**
 * Well-known coding abbreviations to their expanded forms.
 * Used by isForbiddenDomainName so that "Source" is rejected when "src/" exists.
 * Keep this small and well-understood — it's a safety net, not NLP.
 */
const STRUCTURAL_DIR_EXPANSIONS: Record<string, string[]> = {
  src:  ["source"],
  lib:  ["library", "libraries"],
  pkg:  ["package", "packages"],
};

/**
 * Return true if the given domain slug is structurally forbidden — i.e., it
 * matches (or closely resembles) a top-level directory name.
 *
 * SC-5 checks (applied in priority order):
 *  1. Exact slug match (case-insensitive, already normalized)
 *  2. Singular/plural: strip trailing 's' from dir slug, compare to domain
 *  3. Known expansions: "src" → "source", etc. (STRUCTURAL_DIR_EXPANSIONS)
 *  4. Word-boundary: any hyphen-delimited token in the domain slug equals a
 *     dir slug or its singular (catches "my-docs-service" with "docs" dir)
 *
 * Exported for direct unit testing.
 */
export function isForbiddenDomainName(
  domainSlug: string,
  topLevelDirs: string[]
): boolean {
  // Pre-tokenize domain slug (hyphen-delimited words)
  const domainTokens = domainSlug.split("-");

  for (const dir of topLevelDirs) {
    const dirSlug = dir.toLowerCase().replace(/[^a-z0-9]/g, "");
    // Singular form: strip trailing 's' (only if dir is ≥3 chars to avoid "as" → "a")
    const dirSingular =
      dirSlug.endsWith("s") && dirSlug.length > 2 ? dirSlug.slice(0, -1) : dirSlug;

    const dirForms = new Set([
      dirSlug,
      dirSingular,
      ...(STRUCTURAL_DIR_EXPANSIONS[dirSlug] ?? []),
    ]);

    for (const form of dirForms) {
      // 1/3. Exact slug match
      if (domainSlug === form) return true;
      // 4. Standalone word match within the domain slug
      if (domainTokens.includes(form)) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Compute tree depth for a topic (root = 0).
 * Cached for O(n) total over all topics.
 */
function getDepth(
  topicId: string,
  parentMap: ReadonlyMap<string, string | null>,
  cache: Map<string, number>
): number {
  const cached = cache.get(topicId);
  if (cached !== undefined) return cached;
  const parent = parentMap.get(topicId) ?? null;
  const depth = parent === null ? 0 : 1 + getDepth(parent, parentMap, cache);
  cache.set(topicId, depth);
  return depth;
}

/**
 * Derive the importance label ("high" | "medium" | "low") from a numeric score.
 * Matches oracle mapping: ≥0.8 → high, ≥0.5 → medium, else → low.
 */
function importanceLabel(score: number): "high" | "medium" | "low" {
  if (score >= 0.8) return "high";
  if (score >= 0.5) return "medium";
  return "low";
}

// ---------------------------------------------------------------------------
// Main pipeline
// ---------------------------------------------------------------------------

/**
 * K4 taxonomy-build: ClusterGroup[] → topic tree nodes + edges.
 *
 * REQUIRED: opts.proposeTaxonomy must be provided — fail-loud otherwise.
 *
 * Pipeline:
 *   1. Deterministic: collect topic inputs + add hub topics
 *   2. Deterministic: derive forbidden domain names (top-level dirs)
 *   3. LLM: proposeTaxonomy → raw proposals
 *   4. Deterministic: guard topicId to deterministic set (SC-9) + filter invalid source_refs (SC-12)
 *   5. Deterministic: fold sub-threshold topics (SC-2)
 *   6. Deterministic: rebuild parentMap + nameMap from kept proposals
 *   7. Deterministic: validate acyclicity (SC-2)
 *   8. Deterministic: validate depth ≤ maxDepth (SC-2)
 *   9. Deterministic: validate fan-out ≤ maxBranching (SC-2)
 *  10. Deterministic: emit topic nodes + subtopic_of edges
 *  11. Deterministic: emit domain nodes + belongs_to_domain edges (SC-5)
 */
export async function buildTaxonomy(
  repoRoot: string,
  clusters: ClusterGroup[],
  opts: TaxonomyBuildOptions
): Promise<TaxonomyBuildResult> {
  // FAIL-LOUD: LLM seam is required
  if (!opts?.proposeTaxonomy) {
    throw new Error(
      "K4 buildTaxonomy: requires proposeTaxonomy LLM adapter. " +
      "Inject a ProposeTaxonomyFn via TaxonomyBuildOptions.proposeTaxonomy. " +
      "In tests, inject an oracle-backed mock; in production, inject the real LLM adapter."
    );
  }

  const maxDepth = opts.maxDepth ?? KNOWLEDGE_CONFIG_DEFAULTS.maxDepth;
  const maxBranching = opts.maxBranching ?? KNOWLEDGE_CONFIG_DEFAULTS.maxBranching;
  const minTopicImportance =
    opts.minTopicImportance ?? KNOWLEDGE_CONFIG_DEFAULTS.minTopicImportance;

  // Step 1 — deterministic: collect topic inputs + hubs
  const baseInputs = collectTopicInputs(clusters);
  const topicInputs = addHubTopics(clusters, baseInputs);

  // Step 2 — deterministic: SC-5 forbidden domain names
  const topLevelDirs = getTopLevelDirs(repoRoot);

  // Step 3 — LLM: propose taxonomy
  const { topicProposals: rawProposals, domainProposals } =
    await opts.proposeTaxonomy(topicInputs, { forbiddenDomainNames: topLevelDirs });

  // Step 4 — deterministic: guard topic IDs (SC-9 determinism boundary) +
  //   filter proposals with unresolvable source_refs (SC-12).
  // The LLM MUST echo back a topicId it was given; invented IDs are rejected.
  const validTopicIds = new Set(topicInputs.map((t) => t.topicId));
  const validProposals = rawProposals.filter(
    (p) =>
      validTopicIds.has(p.topicId) &&
      p.sourceRef &&
      resolveAnchor(repoRoot, p.sourceRef)
  );

  // Step 5 — deterministic: fold sub-threshold (SC-2)
  const keptProposals = foldSubThreshold(validProposals, minTopicImportance);
  const keptIds = new Set(keptProposals.map((p) => p.topicId));

  // Step 6 — deterministic: build parentMap + nameMap from kept proposals
  const parentMap = new Map<string, string | null>();
  const nameMap = new Map<string, string>();
  for (const p of keptProposals) {
    // If LLM assigned a parent that was folded, treat as root
    const parent =
      p.parentTopicId !== null && keptIds.has(p.parentTopicId)
        ? p.parentTopicId
        : null;
    parentMap.set(p.topicId, parent);
    nameMap.set(p.topicId, p.name);
  }

  // Step 7 — deterministic: validate acyclicity (SC-2)
  validateAcyclicity(parentMap);

  // Step 8 — deterministic: validate depth ≤ maxDepth (SC-2)
  // maxDepth=8 allows depths 0–8 (consistent with schema.ts validateGraphV2).
  const depthCache = new Map<string, number>();
  for (const p of keptProposals) {
    const depth = getDepth(p.topicId, parentMap, depthCache);
    if (depth > maxDepth) {
      throw new Error(
        `K4 taxonomy-build: topic "${p.name}" (${p.topicId}) exceeds maxDepth ${maxDepth}. ` +
        `Actual depth: ${depth}. The LLM-assigned parent chain is too deep. ` +
        "Reduce hierarchy depth or raise maxDepth in KNOWLEDGE_CONFIG_DEFAULTS."
      );
    }
  }

  // Step 9 — deterministic: validate fan-out ≤ maxBranching (SC-2)
  const childCount = new Map<string, number>();
  for (const p of keptProposals) {
    const parent = parentMap.get(p.topicId) ?? null;
    if (parent !== null) {
      childCount.set(parent, (childCount.get(parent) ?? 0) + 1);
    }
  }
  for (const [parentId, count] of childCount) {
    if (count > maxBranching) {
      throw new Error(
        `K4 taxonomy-build: topic "${nameMap.get(parentId) ?? parentId}" (${parentId}) ` +
        `has ${count} children, exceeding maxBranching ${maxBranching}. ` +
        "Reduce the fan-out or raise maxBranching in KNOWLEDGE_CONFIG_DEFAULTS."
      );
    }
  }

  // Step 10 — deterministic: emit topic nodes + subtopic_of edges
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  for (const p of keptProposals) {
    const topicPath = deriveTopicPath(p.topicId, parentMap, nameMap);

    const topicNode: GraphNode = {
      id: p.topicId,
      type: "topic",
      name: p.name,
      category: "concept",
      source_refs: [p.sourceRef],
      confidence: "high",
      importance: importanceLabel(p.importanceScore),
      importance_score: p.importanceScore,
      topic_path: topicPath,
    };
    nodes.push(topicNode);

    // subtopic_of edge: child → parent (SC-2 tree invariant)
    const parent = parentMap.get(p.topicId) ?? null;
    if (parent !== null) {
      edges.push({
        source: p.topicId,
        target: parent,
        type: "subtopic_of",
        direction: "out",
        weight: 1.0,
      });
    }
  }

  // Step 11 — deterministic: emit domain nodes + belongs_to_domain edges (SC-5)
  // B2 invariant: build belongs_to_domain edges FIRST; only emit domain node if ≥1 edge.
  for (const dp of domainProposals) {
    const domainId = deriveDomainId(dp.name);
    const normalizedName = domainId.slice("domain:".length); // slug after "domain:"

    // SC-5: skip domains whose name matches (or closely resembles) a top-level dir
    if (isForbiddenDomainName(normalizedName, topLevelDirs)) {
      continue;
    }

    // Source ref must resolve
    if (!dp.sourceRef || !resolveAnchor(repoRoot, dp.sourceRef)) {
      continue;
    }

    // Build belongs_to_domain edges FIRST (only for kept / non-folded topics)
    const domainEdges: GraphEdge[] = [];
    for (const topicId of dp.topicIds) {
      if (!keptIds.has(topicId)) continue; // skip folded topics
      domainEdges.push({
        source: topicId,
        target: domainId,
        type: "belongs_to_domain",
        direction: "out",
        weight: 1.0,
      });
    }

    // SC-5: only emit domain node if it has ≥1 kept topic (B2)
    if (domainEdges.length === 0) continue;

    const domainNode: GraphNode = {
      id: domainId,
      type: "domain",
      name: dp.name,
      source_refs: [dp.sourceRef],
      confidence: "high",
    };
    nodes.push(domainNode);
    edges.push(...domainEdges);
  }

  return { nodes, edges };
}
