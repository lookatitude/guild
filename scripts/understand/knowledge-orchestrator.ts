#!/usr/bin/env -S npx tsx
/**
 * understand/knowledge-orchestrator.ts — K-tier deterministic glue (SC-8)
 *
 * Single-path entrypoint for the knowledge pipeline:
 *   K1 (content-analyze) → K3 (diagram-analyze) → K2 (wiki-index)
 *   → K4 (taxonomy-build) → K5 (cross-modal-link) → K6 (write-knowledge-links)
 *
 * CRITICAL (SC-8): runKnowledgeStages is the ONE function all 3 triggers call
 * (/guild:learn knowledge, /guild:learn, init --learn). There are NO per-trigger
 * branches that alter output. Same inputs + same seams → byte-identical output.
 *
 * LLM seams are INJECTED via KnowledgeLLMSeams — the orchestrator never calls
 * an LLM directly. Production callers inject real adapters; tests inject mocks.
 *
 * Three-phase CLI surface (for the model-gap protocol between emit and finalize):
 *
 *   Phase round1  — emit deterministic K1/K3/K2/K4 candidate files
 *   Phase round2  — emit deterministic K5 candidate file (needs round1 nodes)
 *   Phase finalize — run full pipeline with file-backed seams → write artifacts
 *
 * Usage:
 *   npx tsx scripts/understand/knowledge-orchestrator.ts \
 *     --phase=round1|round2|finalize \
 *     --cwd <repoRoot> \
 *     --run-id <id> \
 *     [--generated-at <iso8601>]
 *
 * For programmatic use (skill entrypoint):
 *   import { runKnowledgeStages, buildFileBackedSeams, emitRound1Candidates } from "./knowledge-orchestrator";
 *
 * SC-8 byte-set: knowledge-graph.json (v2) + knowledge-recall.json
 *   - both byte-identical across all 3 triggers when seams return the same judgments
 *   - provenance sidecar (knowledge-recall-provenance.json) is excluded from SC-8
 *
 * SC-9: LLM seams only CONFIRM deterministic candidates — they never invent IDs,
 *   edges, or node fields that are not in the pre-computed candidate set.
 *
 * Determinism responsibility:
 *   node/edge IDs      → deterministic-script (schema.ts helpers)
 *   candidate keys     → deterministic-script (same helpers, sorted)
 *   output key order   → deterministic-script (canonicalizer in write-knowledge-links)
 *   output sort order  → deterministic-script (sortNodesByRecall, edge sort)
 *   node names/confs   → LLM-judged (via injected seams)
 */

import * as fs from "fs";
import * as path from "path";

import {
  analyzeContent,
  extractDocCommentCandidates,
  extractHeadingCandidates,
  extractClaimSections,
  extractMermaidEntries,
  extractFunctionIds,
  buildContentClusters,
  type ContentAnalyzeOptions,
  type ClusterGroup,
} from "./content-analyze";

import { analyzeDiagrams } from "./diagram-analyze";

import {
  indexWiki,
  collectWikiPageRelpaths,
  type WikiPageDescriptor,
  type WikiPageClassification,
  type ClassifyPageFn,
} from "./wiki-index";

import { detectLanguage, isCodeLanguage } from "./lib/languages";
import { createIgnoreFilter } from "./lib/ignore";
import { headSha } from "./lib/git";

import {
  buildTaxonomy,
  collectTopicInputs,
  type ProposeTaxonomyFn,
  type TopicInput,
  type TopicProposal,
  type DomainProposal,
} from "./taxonomy-build";

import {
  buildCrossLinks,
  type ConfirmCrossLinksFn,
  type CrossLinkCandidate,
} from "./cross-link";

import {
  validateGraphV2,
  makeTopicId,
  makeWikiPageId,
  KNOWLEDGE_CONFIG_DEFAULTS,
  type GraphNode,
  type GraphEdge,
  type KnowledgeGraph,
  type KnowledgeConfig,
} from "./lib/schema";

import {
  writeKnowledgeLinks,
  canonicalizeNode,
  canonicalizeEdge,
} from "./write-knowledge-links";

// NOTE: k-stage-staleness is NOT imported here. Staleness is the SKILL's coarse
// gate — the skill decides run-or-skip the whole tier. The orchestrator always
// rebuilds the full graph from (candidates, judgments, config) on every call.
// FIX 1 (codex G-lane): prevGraph caching removed so finalize is a pure function.

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** File path sets passed to the pipeline — all paths relative to repoRoot. */
export interface KnowledgeFilePaths {
  /** Source-code files (e.g. ["src/validate.ts", "src/store.ts"]) */
  codeRelPaths: string[];
  /** Documentation markdown files (e.g. ["docs/ingestion.md"]) */
  docRelPaths: string[];
  /**
   * Absolute path to wiki/KB directory. Defaults to `<repoRoot>/.guild/wiki`.
   * K2 is SKIPPED if this directory does not exist.
   */
  wikiDir?: string;
  /**
   * Corpus-relative paths to standalone SVG diagram files.
   * K3 scans docRelPaths for mermaid blocks AND svgRelPaths for .svg files.
   */
  svgRelPaths?: string[];
}

/** Injected LLM seams — all LLM calls go through these functions. */
export interface KnowledgeLLMSeams {
  /** K1: concept name / confidence from doc-comment candidates */
  proposeConcepts?: import("./content-analyze").ProposeConceptsFn;
  /** K1: claim + entity extraction from heading candidates */
  proposeClaimsAndEntities?: import("./content-analyze").ProposeClaimsAndEntitiesFn;
  /** K2: wiki page classification (category, importance, labels) */
  classifyPage?: ClassifyPageFn;
  /** K4: topic taxonomy from K1 clusters (required) */
  proposeTaxonomy: ProposeTaxonomyFn;
  /** K5: cross-modal edge confirmation (required) */
  confirmCrossLinks: ConfirmCrossLinksFn;
}

/** Optional configuration for runKnowledgeStages. */
export interface RunKnowledgeOptions {
  /** Written to provenance sidecar ONLY — never in knowledge-recall.json (SC-8) */
  runId?: string;
  /** ISO 8601 — written to provenance sidecar ONLY */
  generatedAt?: string;
  /** KnowledgeGraph project metadata */
  project?: { name: string; description: string };
  /** Git commit hash for generated_from_commit field */
  generatedFromCommit?: string;
  /** KnowledgeConfig overrides */
  config?: Partial<KnowledgeConfig>;
  // NOTE: no `staleness` field. Staleness is the SKILL's decision; the
  // orchestrator always runs all stages (FIX 1 — pure finalize).
}

/** Returned from runKnowledgeStages. */
export interface RunKnowledgeResult {
  graph: KnowledgeGraph;
  /** Absolute path to .guild/indexes/knowledge-graph.json */
  graphPath: string;
  /** Absolute path to .guild/indexes/knowledge-recall.json (nonce-free, SC-8 member) */
  linksPath: string;
  /** Absolute path to .guild/indexes/knowledge-recall-provenance.json */
  provenancePath: string;
  nodeCount: number;
  edgeCount: number;
  /**
   * Defense-in-depth (SC-3 machine check): wiki_page node ids in the VALIDATED
   * graph that have NO topic-membership edge (evidenced_by from a topic). The
   * deterministic fallback root topic guarantees this is `[]` for any topic-less
   * corpus; a non-empty value is a tripwire (logged to stderr, never a hard
   * reject). NOT part of the SC-8 byte-set — lives only on the in-memory result.
   */
  sc3OrphanWikiPageIds: string[];
}

// ---------------------------------------------------------------------------
// SC-3 fallback root topic (deterministic) — see guild-plan.md §L20
// ---------------------------------------------------------------------------

/**
 * Deterministic seed fed to makeTopicId for the SC-3 fallback root topic id.
 * Constant (not corpus-derived) so the id is stable across every topic-less run.
 */
export const FALLBACK_ROOT_TOPIC_SEED = "project-knowledge";
/** Generic display name — used only when the repo root yields no usable basename. */
export const FALLBACK_ROOT_TOPIC_NAME = "Project Knowledge";

/**
 * Display name for the SC-3 fallback root topic, derived from the repo root so
 * the topic-less corpus reads as e.g. "Guild Knowledge" rather than the generic
 * "Project Knowledge". Pure function of `repoRoot` (no Date/random) → SC-8 holds
 * (byte-identical across triggers for a given repo). The topic ID stays the
 * constant FALLBACK_ROOT_TOPIC_SEED, so only the human-facing name varies.
 * Falls back to FALLBACK_ROOT_TOPIC_NAME when the basename is empty/degenerate.
 */
export function deriveFallbackRootTopicName(repoRoot: string): string {
  const base = path.basename((repoRoot ?? "").replace(/[/\\]+$/, "")).trim();
  if (!base || base === "." || base === "..") return FALLBACK_ROOT_TOPIC_NAME;
  const titled = base
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
  return titled ? `${titled} Knowledge` : FALLBACK_ROOT_TOPIC_NAME;
}

/**
 * SC-3 unconditional guarantee: when the assembled graph has ≥1 `wiki_page` but
 * 0 `topic` nodes (a topic-less corpus — wiki/docs pages but no code, so K4
 * emits 0 topics and cross-link Rule 6 cannot fire), synthesize ONE deterministic
 * fallback root `topic` and link EVERY wiki_page to it via `evidenced_by`
 * (topic→wiki_page). Returns `null` (no-op) when there are 0 wiki_page nodes OR
 * ≥1 topic already exists — so the normal multi-topic path (incl. the real
 * 16-topic plugin graph) is BYTE-IDENTICAL (synthesis never fires there).
 *
 * Determinism (SC-8): the id is `makeTopicId([SEED])` (constant), the anchor is
 * the lexicographically-first wiki_page's bare repoRoot-relative path (an
 * existing on-disk artifact → resolves at repoRoot for SC-12, fragment-free so
 * it is robust regardless of headings), and edges are emitted in sorted target
 * order. No Date/random.
 *
 * @param nodes     The assembled node set (post K1→K5, pre validateGraphV2).
 * @param repoRoot  Repo root — supplies the derived display name (see
 *                  deriveFallbackRootTopicName); anchor resolution itself is
 *                  checked downstream by validateGraphV2.
 */
export function maybeSynthesizeFallbackRootTopic(
  nodes: GraphNode[],
  repoRoot: string
): { topicNode: GraphNode; edges: GraphEdge[] } | null {
  const wikiPages = nodes.filter((n) => n.type === "wiki_page");
  if (wikiPages.length === 0) return null;
  if (nodes.some((n) => n.type === "topic")) return null;

  // Anchor to a REAL artifact: the lexicographically-first wiki_page's bare
  // relpath (derived from its id `wiki_page:<relpath>`). indexWiki only emits a
  // node for an existing file, so this bare path resolves at repoRoot (SC-12)
  // independent of any heading fragment.
  const sortedWikis = [...wikiPages].sort((a, b) => a.id.localeCompare(b.id));
  const firstRelpath = sortedWikis[0].id.slice("wiki_page:".length);

  const topicId = makeTopicId([FALLBACK_ROOT_TOPIC_SEED]);
  const topicNode: GraphNode = {
    id: topicId,
    type: "topic",
    name: deriveFallbackRootTopicName(repoRoot),
    category: "concept",
    source_refs: [firstRelpath],
    confidence: "high",
    importance: "high",
    importance_score: 1.0,
    topic_path: [FALLBACK_ROOT_TOPIC_SEED],
  };

  const edges: GraphEdge[] = sortedWikis.map((w) => ({
    direction: "out",
    source: topicId,
    target: w.id,
    type: "evidenced_by",
    weight: 1.0,
  }));

  return { topicNode, edges };
}

/**
 * SC-3 machine check: wiki_page ids in `graph` with NO topic-membership edge
 * (an `evidenced_by` edge whose source is a topic and whose target is the page).
 * Deterministic (sorted). Empty when there are no wiki_page nodes.
 */
function findOrphanWikiPages(graph: {
  nodes: GraphNode[];
  edges: GraphEdge[];
}): string[] {
  const wikiIds = graph.nodes.filter((n) => n.type === "wiki_page").map((n) => n.id);
  if (wikiIds.length === 0) return [];
  const topicIds = new Set(
    graph.nodes.filter((n) => n.type === "topic").map((n) => n.id)
  );
  const covered = new Set<string>();
  for (const e of graph.edges) {
    if (
      e.type === "evidenced_by" &&
      topicIds.has(e.source) &&
      typeof e.target === "string" &&
      e.target.startsWith("wiki_page:")
    ) {
      covered.add(e.target);
    }
  }
  return wikiIds.filter((id) => !covered.has(id)).sort();
}

// ---------------------------------------------------------------------------
// Judgment document types (the model fills these; finalize reads them)
// ---------------------------------------------------------------------------

/** Canonical key for a K1 doc-comment candidate: `concept:<anchor>` */
export type K1ConceptKey = string;
/** Canonical key for a K1 heading candidate: same as makeConceptId(anchor, text) or makeClaimId */
export type K1HeadingKey = string;

/** k1-judgments.json top-level doc shape. */
export interface K1JudgmentsDoc {
  schema_version: "guild.knowledge.judgments.v1";
  stage: "k1";
  /**
   * Maps candidate_key → concept judgment.
   * candidate_key for doc-comment = anchor string from K1 candidates file.
   */
  concepts: Record<string, { name: string; confidence: string }>;
  /**
   * Maps candidate_key → claim judgment.
   */
  claims: Record<string, { accepted: boolean; importance_score?: number }>;
  /**
   * Maps candidate_key → entity judgment.
   */
  entities: Record<string, { accepted: boolean }>;
}

/** k2-judgments.json top-level doc shape. */
export interface K2JudgmentsDoc {
  schema_version: "guild.knowledge.judgments.v1";
  stage: "k2";
  /** Maps page id (wiki_page:<relpath>) → classification */
  pages: Record<
    string,
    { category: string; importance: string; labels: string[] }
  >;
}

/** k4-judgments.json top-level doc shape. */
export interface K4JudgmentsDoc {
  schema_version: "guild.knowledge.judgments.v1";
  stage: "k4";
  /** Maps topicId → topic judgment */
  topics: Record<
    string,
    {
      name: string;
      parent: string | null;
      importance_score: number;
      sourceRef?: string;
    }
  >;
  /**
   * Maps domain candidate_key → domain judgment.
   * candidate_key must be one of the `domain_candidates[].candidate_key` values
   * emitted by emitRound1Candidates. Off-candidate keys are silently dropped (SC-9).
   */
  domains: Record<string, {
    name: string;
    topicIds: string[];
    sourceRef: string;
  }>;
}

/** k5-judgments.json top-level doc shape. */
export interface K5JudgmentsDoc {
  schema_version: "guild.knowledge.judgments.v1";
  stage: "k5";
  /**
   * Maps `${source}→${target}:${type}` → edge judgment.
   * Key form is the same candidate_key used in k5-candidates.json.
   */
  edges: Record<string, { weight: number }>;
}

// ---------------------------------------------------------------------------
// buildFileBackedSeams — reads judgment files, returns KnowledgeLLMSeams
// ---------------------------------------------------------------------------

/** Safe JSON parse helper — returns null on any error. */
function safeReadJson<T>(filePath: string): T | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

/**
 * Build KnowledgeLLMSeams backed by judgment files in `judgmentDir`.
 *
 * Each seam reads the appropriate k*-judgments.json file at call-time.
 * Missing judgment files → seam returns an empty / default result (graceful).
 * Candidate keys absent from the judgment file → skipped (SC-9: no invented data).
 *
 * @param judgmentDir  Absolute path to the directory containing judgment files.
 */
export function buildFileBackedSeams(judgmentDir: string): KnowledgeLLMSeams {
  // ------ proposeConcepts ------
  const proposeConcepts: import("./content-analyze").ProposeConceptsFn = async (
    candidates
  ) => {
    const judgments = safeReadJson<K1JudgmentsDoc>(
      path.join(judgmentDir, "k1-judgments.json")
    );
    if (!judgments?.concepts) return [];

    const results: import("./content-analyze").ConceptLLMResult[] = [];
    for (const c of candidates) {
      const anchor = (c as { anchor?: string }).anchor ?? "";
      const judgment = judgments.concepts[anchor];
      if (!judgment) continue;
      results.push({
        anchor,
        name: judgment.name,
        confidence: judgment.confidence as "high" | "medium" | "low",
      });
    }
    return results;
  };

  // ------ proposeClaimsAndEntities ------
  // Signature: (sections: ClaimSection[], headings: HeadingCandidate[]) => ...
  const proposeClaimsAndEntities: import("./content-analyze").ProposeClaimsAndEntitiesFn =
    async (sections, headings) => {
      const judgments = safeReadJson<K1JudgmentsDoc>(
        path.join(judgmentDir, "k1-judgments.json")
      );

      const claims: import("./content-analyze").ClaimLLMResult[] = [];
      const entities: import("./content-analyze").EntityLLMResult[] = [];

      if (!judgments) return { claims, entities };

      // Claims keyed by section anchor
      if (judgments.claims) {
        for (const s of sections) {
          const j = judgments.claims[s.anchor];
          if (j?.accepted) {
            claims.push({
              anchor: s.anchor,
              text: s.text,
              confidence: "medium",
            });
          }
        }
      }

      // Entities keyed by heading anchor
      if (judgments.entities) {
        for (const h of headings) {
          const j = judgments.entities[h.anchor] ?? judgments.entities[h.text];
          if (j?.accepted) {
            entities.push({
              name: h.text,
              anchor: h.anchor,
              confidence: "medium",
            });
          }
        }
      }

      return { claims, entities };
    };

  // ------ classifyPage ------
  const classifyPage: ClassifyPageFn = async (pages) => {
    const judgments = safeReadJson<K2JudgmentsDoc>(
      path.join(judgmentDir, "k2-judgments.json")
    );

    const result = new Map<string, WikiPageClassification>();
    for (const page of pages) {
      const judgment = judgments?.pages?.[page.id];
      if (!judgment) continue; // SC-9 / B4: no judgment → page absent from Map, not fabricated
      result.set(page.id, {
        category: judgment.category,
        importance: judgment.importance,
        labels: judgment.labels ?? [],
      });
    }
    return result;
  };

  // ------ proposeTaxonomy ------
  const proposeTaxonomy: ProposeTaxonomyFn = async (topicInputs, _context) => {
    const judgments = safeReadJson<K4JudgmentsDoc>(
      path.join(judgmentDir, "k4-judgments.json")
    );

    if (!judgments?.topics) {
      return { topicProposals: [], domainProposals: [] };
    }

    const topicProposals: TopicProposal[] = [];
    for (const input of topicInputs) {
      const judgment = judgments.topics[input.topicId];
      if (!judgment) continue; // SC-9: absent → skip, not invent
      topicProposals.push({
        topicId: input.topicId,
        name: judgment.name,
        parentTopicId: judgment.parent ?? null,
        importanceScore: judgment.importance_score,
        sourceRef: judgment.sourceRef ?? "",
      });
    }

    // SC-9 domain guard: load valid candidate keys from k4-candidates.json.
    // Only accept domain judgments whose candidate_key was emitted by the
    // deterministic phase (emitRound1Candidates). Off-candidate keys → drop.
    const k4Candidates = safeReadJson<{ domain_candidates?: Array<{ candidate_key: string }> }>(
      path.join(judgmentDir, "k4-candidates.json")
    );
    const validDomainKeys = new Set<string>(
      (k4Candidates?.domain_candidates ?? []).map((c) => c.candidate_key)
    );

    const domainProposals: DomainProposal[] = [];
    for (const [key, d] of Object.entries(judgments.domains ?? {})) {
      if (!validDomainKeys.has(key)) continue; // SC-9: off-candidate domain → drop
      domainProposals.push({
        name: d.name,
        topicIds: d.topicIds,
        sourceRef: d.sourceRef,
      });
    }

    return { topicProposals, domainProposals };
  };

  // ------ confirmCrossLinks ------
  const confirmCrossLinks: ConfirmCrossLinksFn = async (
    _nodes,
    candidates,
    context
  ) => {
    const judgments = safeReadJson<K5JudgmentsDoc>(
      path.join(judgmentDir, "k5-judgments.json")
    );

    if (!judgments?.edges) return [];

    const relMinConf = context?.relMinConf ?? 0.5;
    const edges: GraphEdge[] = [];

    for (const c of candidates) {
      const key = `${c.source}→${c.target}:${c.type}`;
      const judgment = judgments.edges[key];
      if (!judgment) continue; // SC-9: not in judgments → discard
      if (judgment.weight < relMinConf) continue; // below confidence threshold
      edges.push({
        direction: "out",
        source: c.source,
        target: c.target,
        type: c.type as GraphEdge["type"],
        weight: judgment.weight,
      });
    }

    return edges;
  };

  return {
    proposeConcepts,
    proposeClaimsAndEntities,
    classifyPage,
    proposeTaxonomy,
    confirmCrossLinks,
  };
}

// ---------------------------------------------------------------------------
// Internal: wiki page candidate collector (sync, no LLM)
// ---------------------------------------------------------------------------

/**
 * Collect deterministic WikiPage descriptors for one wiki root — gives the model
 * the AUTHORITATIVE wiki_page id + heading set to classify in k2-judgments.json.
 *
 * BUG-2: page discovery uses the SHARED `collectWikiPageRelpaths` routine that
 * finalize (indexWiki) also uses, so the round1 candidate page set and the
 * finalize page set CANNOT drift (the retired index.md-BFS membership gate
 * dropped pages in finalize that round1 had classified — SC-3 violation).
 *
 * BUG-3: the candidate `id` / `candidate_key` / `relpath` are **repoRoot-relative**
 * (e.g. `wiki_page:.guild/wiki/index.md`) so they equal finalize's indexWiki id
 * exactly, and so the node's anchor resolves at repoRoot in validateGraphV2.
 *
 * Not using indexWiki directly to keep emitRound1Candidates synchronous.
 *
 * @param wikiAbsDir  Absolute path to the wiki root.
 * @param repoRoot    Absolute repo root — used to prefix ids to repoRoot-relative.
 */
function collectWikiPageCandidates(
  wikiAbsDir: string,
  repoRoot: string
): Array<{
  candidate_key: string;
  id: string;
  relpath: string;
  name: string;
  headings: string[];
  wikilinks: string[];
}> {
  const results: ReturnType<typeof collectWikiPageCandidates> = [];

  const rawRelBase = path.relative(repoRoot, wikiAbsDir).split(path.sep).join("/");
  const toRepoRel = (fileRel: string): string =>
    rawRelBase ? `${rawRelBase}/${fileRel}` : fileRel;

  // BUG-2: identical page set as finalize (shared routine, recursive, all .md,
  // EXCLUDED_WIKI_NAMES meta exclusion, hidden-dir skip, sorted).
  for (const fileRel of collectWikiPageRelpaths(wikiAbsDir)) {
    const abs = path.join(wikiAbsDir, fileRel);
    let content: string;
    try { content = fs.readFileSync(abs, "utf8"); }
    catch { continue; }
    // H1 (name)
    const h1Match = content.match(/^#\s+(.+)$/m);
    const name = h1Match ? h1Match[1].trim() : path.basename(fileRel, ".md");
    // All headings
    const headings: string[] = [];
    const headingRe = /^#{1,6}\s+(.+)$/gm;
    let m: RegExpExecArray | null;
    while ((m = headingRe.exec(content)) !== null) headings.push(m[1].trim());
    // [[wikilinks]]
    const wikilinks: string[] = [];
    const wlRe = /\[\[([^\]]+)\]\]/g;
    while ((m = wlRe.exec(content)) !== null) {
      wikilinks.push(m[1].split("|")[0].trim()); // strip aliases
    }
    const repoRel = toRepoRel(fileRel);
    const id = makeWikiPageId(repoRel);
    results.push({ candidate_key: id, id, relpath: repoRel, name, headings, wikilinks });
  }

  return results;
}

// ---------------------------------------------------------------------------
// emitRound1Candidates — deterministic K1/K2/K3/K4 candidate files
// ---------------------------------------------------------------------------

/**
 * Emit deterministic candidate files for K1, K2, K3, and K4 stages.
 *
 * Written to `candidateDir`:
 *   k1-candidates.json  — doc_comment_candidates, claim_sections, heading_candidates
 *   k2-candidates.json  — wiki_page descriptors (id, relpath, name, headings) — SC-3 model input
 *   k3-nodes.json       — fully deterministic diagram nodes
 *   k4-candidates.json  — topic_inputs (makeTopicId from K1 clusters)
 *
 * All candidates include `candidate_key` for 1:1 mapping back to judgments.
 * This function is SYNCHRONOUS (no LLM calls).
 *
 * Usage: node scripts/understand/knowledge-orchestrator.ts --phase=round1 ...
 */
export function emitRound1Candidates(
  repoRoot: string,
  filePaths: KnowledgeFilePaths,
  candidateDir: string
): void {
  fs.mkdirSync(candidateDir, { recursive: true });

  const { codeRelPaths, docRelPaths, svgRelPaths = [] } = filePaths;

  // ── K1 candidates ──────────────────────────────────────────────────────────
  // All extract functions take (repoRoot, relPaths[]) and read files internally.
  const rawDocComments = extractDocCommentCandidates(repoRoot, codeRelPaths);
  const docCommentCandidates = rawDocComments.map((c) => ({
    candidate_key: c.anchor, // anchor IS the stable key for K1 concepts
    anchor: c.anchor,
    rawText: c.rawText,
    relPath: c.relPath,
  }));

  const rawHeadings = extractHeadingCandidates(repoRoot, docRelPaths);
  const headingCandidates = rawHeadings.map((c) => ({
    candidate_key: c.anchor,
    anchor: c.anchor,
    text: c.text,
    level: c.level,
    relPath: c.relPath,
  }));

  const rawClaims = extractClaimSections(repoRoot, docRelPaths);
  const claimSections = rawClaims.map((c) => ({
    candidate_key: c.anchor,
    anchor: c.anchor,
    text: c.text,
    relPath: c.relPath,
  }));

  const k1Doc = {
    schema_version: "guild.knowledge.candidates.v1",
    stage: "k1",
    doc_comment_candidates: docCommentCandidates,
    heading_candidates: headingCandidates,
    claim_sections: claimSections,
  };
  fs.writeFileSync(
    path.join(candidateDir, "k1-candidates.json"),
    JSON.stringify(k1Doc, null, 2) + "\n",
    "utf8"
  );

  // ── K2 candidates — wiki page descriptors (authoritative page set for model) ─
  //
  // SC-3 real-path: the model MUST have the authoritative wiki_page id list to
  // fill k2-judgments.json correctly. Without this file, the model would have to
  // re-enumerate the wiki itself → any missed page falls to the default
  // classification (note/low/[]) → SC-3 (real category/importance/labels) fails.
  //
  // Scans both .guild/wiki/ and docs/knowledge/ (mirroring indexWiki's scope).
  // The classifyPage seam reads k2-judgments.json keyed by wiki_page_id; those
  // IDs are 1:1 with the candidate_key here.
  const wikiAbsDirs: string[] = [
    filePaths.wikiDir ?? path.join(repoRoot, ".guild", "wiki"),
    path.join(repoRoot, "docs", "knowledge"),
  ];
  const k2Pages: ReturnType<typeof collectWikiPageCandidates> = [];
  for (const dir of wikiAbsDirs) {
    if (fs.existsSync(dir)) {
      k2Pages.push(...collectWikiPageCandidates(dir, repoRoot));
    }
  }
  const k2Doc = {
    schema_version: "guild.knowledge.candidates.v1",
    stage: "k2",
    pages: k2Pages,
  };
  fs.writeFileSync(
    path.join(candidateDir, "k2-candidates.json"),
    JSON.stringify(k2Doc, null, 2) + "\n",
    "utf8"
  );

  // ── K3 nodes (fully deterministic — no LLM, no candidates needed) ─────────
  const k3AllPaths = [...docRelPaths, ...svgRelPaths];
  const k3Result = analyzeDiagrams(repoRoot, k3AllPaths);
  const k3Doc = {
    schema_version: "guild.knowledge.candidates.v1",
    stage: "k3",
    nodes: k3Result.nodes,
  };
  fs.writeFileSync(
    path.join(candidateDir, "k3-nodes.json"),
    JSON.stringify(k3Doc, null, 2) + "\n",
    "utf8"
  );

  // ── K4 candidates (topic_inputs from K1 clusters — deterministic) ─────────
  // buildContentClusters(codeRelPaths, functionIds, docSections, mermaidEntries)
  const functionIds = extractFunctionIds(repoRoot, codeRelPaths);
  const docSections = extractClaimSections(repoRoot, docRelPaths);
  const mermaidEntries = extractMermaidEntries(repoRoot, docRelPaths);
  const clusters = buildContentClusters(codeRelPaths, functionIds, docSections, mermaidEntries);
  const topicInputs = collectTopicInputs(clusters);
  const k4Doc = {
    schema_version: "guild.knowledge.candidates.v1",
    stage: "k4",
    topic_inputs: topicInputs.map((t) => ({
      candidate_key: t.topicId, // topicId IS the makeTopicId-derived stable key
      topicId: t.topicId,
      memberIds: t.memberIds,
    })),
    // SC-9: domain_candidates gives the model a bounded vocabulary of domain keys.
    // In finalize, only k4-judgments.domains entries whose key appears here are
    // accepted — the model cannot inject a domain that was never proposed here.
    domain_candidates: topicInputs.map((t) => ({
      candidate_key: `domain:${t.topicId}`,
      primary_topicId: t.topicId,
    })),
  };
  fs.writeFileSync(
    path.join(candidateDir, "k4-candidates.json"),
    JSON.stringify(k4Doc, null, 2) + "\n",
    "utf8"
  );
}

// ---------------------------------------------------------------------------
// emitRound2Candidates — K5 candidates (needs K1-K4 nodes from partial run)
// ---------------------------------------------------------------------------

/**
 * Emit K5 cross-link candidates after the model has filled K1/K2/K3/K4 judgments.
 *
 * Runs K1→K3→K2→K4 with the judgment-backed seams to assemble the intermediate
 * node set, then extracts K5 candidates deterministically.
 * Writes `k5-candidates.json` to `candidateDir`.
 *
 * @param repoRoot      Absolute path to repo root
 * @param filePaths     Same KnowledgeFilePaths as round1
 * @param candidateDir  Directory to write k5-candidates.json to
 * @param judgmentDir   Directory containing k1/k2/k4-judgments.json
 */
export async function emitRound2Candidates(
  repoRoot: string,
  filePaths: KnowledgeFilePaths,
  candidateDir: string,
  judgmentDir: string
): Promise<void> {
  fs.mkdirSync(candidateDir, { recursive: true });

  const seams = buildFileBackedSeams(judgmentDir);
  const { nodes } = await runKnowledgeStagesK1ToK4(repoRoot, filePaths, seams);

  // Extract K5 candidates deterministically (same rules as buildCrossLinks)
  const { proposeCandidates } = await import("./cross-link");

  const candidates: CrossLinkCandidate[] = proposeCandidates(
    repoRoot,
    nodes,
    [] // no existing edges to dedup against
  );

  const k5Doc = {
    schema_version: "guild.knowledge.candidates.v1",
    stage: "k5",
    cross_link_candidates: candidates.map((c) => ({
      candidate_key: `${c.source}→${c.target}:${c.type}`,
      source: c.source,
      target: c.target,
      type: c.type,
      reason: c.reason,
    })),
  };
  fs.writeFileSync(
    path.join(candidateDir, "k5-candidates.json"),
    JSON.stringify(k5Doc, null, 2) + "\n",
    "utf8"
  );
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Compute K1 clusters DETERMINISTICALLY (no LLM).
 * Reusable when K1 is skipped by staleness but K4 still needs fresh clusters.
 */
function computeClustersDeterministic(
  repoRoot: string,
  codeRelPaths: string[],
  docRelPaths: string[]
): ClusterGroup[] {
  const functionIds = extractFunctionIds(repoRoot, codeRelPaths);
  const docSections = extractClaimSections(repoRoot, docRelPaths);
  const mermaidEntries = extractMermaidEntries(repoRoot, docRelPaths);
  return buildContentClusters(codeRelPaths, functionIds, docSections, mermaidEntries);
}

// ---------------------------------------------------------------------------
// Internal: K1→K4 partial run (shared by emitRound2Candidates + runKnowledgeStages)
// ---------------------------------------------------------------------------

// FIX 1 (codex G-lane): ALL_STALE and K1ToK4Context removed. The orchestrator
// never caches from a previous graph — finalize is a PURE function of
// (candidates, judgments, config). Staleness is the SKILL's coarse gate only.

interface PartialRunResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
  clusters: ClusterGroup[];
}

/**
 * Run K1→K4 deterministically — no staleness gating, no prevGraph cache.
 * All stages always run. Called by emitRound2Candidates and runKnowledgeStages.
 */
async function runKnowledgeStagesK1ToK4(
  repoRoot: string,
  filePaths: KnowledgeFilePaths,
  seams: KnowledgeLLMSeams
): Promise<PartialRunResult> {
  const { codeRelPaths, docRelPaths, svgRelPaths = [], wikiDir } = filePaths;
  const allNodes: GraphNode[] = [];
  const allEdges: GraphEdge[] = [];

  // ── K1: content-analyze (always runs) ──────────────────────────────────────
  // Compute clusters deterministically — K4 needs them.
  const clusters = computeClustersDeterministic(repoRoot, codeRelPaths, docRelPaths);

  const k1Opts: ContentAnalyzeOptions = {};
  if (seams.proposeConcepts) k1Opts.proposeConcepts = seams.proposeConcepts;
  if (seams.proposeClaimsAndEntities)
    k1Opts.proposeClaimsAndEntities = seams.proposeClaimsAndEntities;
  // K1 requires at least one seam — inject NOOP passthrough if neither provided
  if (!k1Opts.proposeConcepts && !k1Opts.proposeClaimsAndEntities) {
    k1Opts.proposeConcepts = async () => [];
  }
  const k1Result = await analyzeContent(repoRoot, codeRelPaths, docRelPaths, k1Opts);
  allNodes.push(...k1Result.nodes);
  allEdges.push(...k1Result.edges);

  // ── K3: diagram-analyze (MUST run before K5 — cross-link needs diagram nodes) ─
  // Always runs unconditionally.
  const k3Paths = [...docRelPaths, ...svgRelPaths];
  const k3Result = analyzeDiagrams(repoRoot, k3Paths);
  allNodes.push(...k3Result.nodes);
  // k3Result.edges is always [] (cross-modal edges live in K5)

  // ── K2: wiki-index (always runs; scans BOTH roots — mirrors emitRound1Candidates) ─
  //
  // SC-3 real-path fix: finalize MUST index the same roots as emitRound1Candidates.
  // Previously this only indexed wikiDir (.guild/wiki/), so docs/knowledge/ pages
  // received k2-candidates + model judgments in round1 but no wiki_page nodes were
  // ever produced in the final graph — SC-3 violation.
  //
  // Both roots match the candidate emitter at lines ~585-594 exactly.
  const k2Roots: string[] = [
    wikiDir ?? path.join(repoRoot, ".guild", "wiki"),
    path.join(repoRoot, "docs", "knowledge"),
  ];
  // BUG-3: pass repoRoot so wiki_page ids/anchors are repoRoot-relative and
  // resolve in validateGraphV2 (wikiDir-relative ids were unresolvable → every
  // wiki_page node dropped). round1 candidate_key == this id (both repoRoot-rel).
  const k2Opts: { classifier?: ClassifyPageFn; repoRoot: string } = { repoRoot };
  if (seams.classifyPage) k2Opts.classifier = seams.classifyPage;
  for (const k2Dir of k2Roots) {
    if (fs.existsSync(k2Dir)) {
      const k2Result = await indexWiki(k2Dir, k2Opts);
      allNodes.push(...k2Result.nodes);
      allEdges.push(...k2Result.edges);
    }
  }

  // ── K4: taxonomy-build (always runs) ────────────────────────────────────────
  const k4Result = await buildTaxonomy(repoRoot, clusters, {
    proposeTaxonomy: seams.proposeTaxonomy,
  });
  allNodes.push(...k4Result.nodes);
  allEdges.push(...k4Result.edges);

  return { nodes: allNodes, edges: allEdges, clusters };
}

// ---------------------------------------------------------------------------
// runKnowledgeStages — SC-8 single-path entrypoint
// ---------------------------------------------------------------------------

/**
 * Run the full K1→K3→K2→K4→K5→K6 knowledge pipeline.
 *
 * SC-8: this is the ONLY function all 3 triggers call. No per-trigger branches
 * that change output. Same inputs + same seams → byte-identical knowledge-graph.json
 * and knowledge-recall.json (the SC-8 byte-set).
 *
 * Stage order:
 *   K1 (content-analyze)  — concept/claim/entity nodes + clusters
 *   K3 (diagram-analyze)  — diagram nodes (BEFORE K5 needs them)
 *   K2 (wiki-index)       — wiki_page nodes + related edges
 *   K4 (taxonomy-build)   — topic nodes (from K1 clusters)
 *   K5 (cross-modal-link) — cross-modal edges (needs ALL of K1/K2/K3/K4 nodes)
 *   validateGraphV2       — enforce invariants
 *   write-knowledge-links — knowledge-graph.json + knowledge-recall.json + sidecar
 *
 * @param repoRoot   Absolute path to repo root
 * @param filePaths  File path sets (relative to repoRoot)
 * @param seams      Injected LLM adapters
 * @param opts       Run options (runId, generatedAt, project, etc.)
 */
export async function runKnowledgeStages(
  repoRoot: string,
  filePaths: KnowledgeFilePaths,
  seams: KnowledgeLLMSeams,
  opts: RunKnowledgeOptions = {}
): Promise<RunKnowledgeResult> {
  // FIX 1 (codex G-lane): no staleness, no prevGraph. Pure function of inputs.
  // ── K1→K4: assemble all nodes + edges (deterministic order) ───────────────
  const partial = await runKnowledgeStagesK1ToK4(repoRoot, filePaths, seams);
  const allNodes = partial.nodes;
  const allEdges = partial.edges;

  // ── K5: cross-modal-link (unions ALL node sets from K1+K2+K3+K4) ──────────
  // Always runs unconditionally — no caching from previous graph.
  const k5Result = await buildCrossLinks(
    repoRoot,
    { nodes: allNodes, edges: allEdges },
    { confirmCrossLinks: seams.confirmCrossLinks }
  );
  allEdges.push(...k5Result.edges);

  // ── SC-3 fallback root topic (deterministic) ──────────────────────────────
  // Guarantees EVERY wiki_page has ≥1 topic-membership edge even when K4 emits
  // 0 topics (topic-less corpus → cross-link Rule 6 cannot fire). No-op when
  // ≥1 topic already exists (Rule 6 owns coverage) or there are 0 wiki_page
  // nodes — so the real multi-topic plugin graph is byte-identical (synthesis
  // never fires there). This is the REAL guarantee behind the SC-3 machine
  // check below. Placed AFTER K5 + BEFORE validateGraphV2 so it sees both the
  // final topic set and the final wiki_page set (per guild-plan.md §L20).
  const fallback = maybeSynthesizeFallbackRootTopic(allNodes, repoRoot);
  if (fallback) {
    allNodes.push(fallback.topicNode);
    allEdges.push(...fallback.edges);
  }

  // ── Assemble KnowledgeGraph v2 ─────────────────────────────────────────────
  const graphRaw: KnowledgeGraph = {
    version: "guild.knowledge_graph.v2",
    kind: "knowledge",
    generated_from_commit: opts.generatedFromCommit ?? "unknown",
    project: opts.project ?? { name: "guild", description: "Guild plugin self-build" },
    nodes: allNodes,
    edges: allEdges,
    layers: [],
    tour: [],
  };

  // ── validateGraphV2 (FIX 2: throw on fatal — never write unvalidated graph) ─
  const validation = validateGraphV2(graphRaw, {
    repoRoot,
    config: opts.config,
  });

  if (!validation.data) {
    throw new Error(
      `validateGraphV2 returned a fatal result — refusing to write unvalidated graph. ` +
      `Fatal: ${validation.fatal ?? "unknown"}. ` +
      `Issues: ${JSON.stringify(validation.issues ?? [])}`
    );
  }
  const validated = validation.data as KnowledgeGraph;

  // ── H1 canonicalization — apply fixed key order to BOTH byte-set members ───
  //
  // SC-8 byte-set member 1 (knowledge-graph.json): apply canonicalizeNode /
  // canonicalizeEdge so the key order in the JSON is always deterministic
  // regardless of which buildXNode helper emitted the node or which trigger
  // called the pipeline. validateGraphV2 sorts arrays but does NOT fix per-
  // object key order — the canonicalizer pass is required.
  //
  // SC-8 byte-set member 2 (knowledge-recall.json): handled by writeKnowledgeLinks
  // which also calls canonicalizeNode/canonicalizeEdge internally.
  const canonNodes = validated.nodes.map(
    (n) => canonicalizeNode(n) as unknown as GraphNode
  );
  const canonEdges = validated.edges.map(
    (e) => canonicalizeEdge(e) as unknown as GraphEdge
  );
  const graph: KnowledgeGraph = { ...validated, nodes: canonNodes, edges: canonEdges };

  // ── Defense-in-depth: SC-3 machine check on the VALIDATED graph ────────────
  // The orphan codex found passed SILENTLY because nothing enforced SC-3.
  // We assert here (the least-invasive spot that sees the final validated graph)
  // that every wiki_page has ≥1 topic-membership edge. With the fallback root in
  // place this is always clean; a non-empty result is a tripwire — logged to
  // stderr, surfaced on the result, but NEVER a hard reject (legit runs must not
  // break). It is deliberately NOT inside validateGraphV2: the L0f reference
  // corpus models SC-3 via wiki↔wiki `related` edges and carries 0 topic edges,
  // so a validator-level reject would regress the knowledge-tier eval suite.
  const sc3OrphanWikiPageIds = findOrphanWikiPages(graph);
  if (sc3OrphanWikiPageIds.length > 0) {
    process.stderr.write(
      `[knowledge] SC-3 WARNING: ${sc3OrphanWikiPageIds.length} wiki_page node(s) ` +
        `have no topic-membership edge after validation: ` +
        `${sc3OrphanWikiPageIds.join(", ")}\n`
    );
  }

  // ── Write knowledge-graph.json (v2, H1-canonicalized) ─────────────────────
  const indexesDir = path.join(repoRoot, ".guild", "indexes");
  fs.mkdirSync(indexesDir, { recursive: true });
  const graphPath = path.join(indexesDir, "knowledge-graph.json");
  fs.writeFileSync(graphPath, JSON.stringify(graph, null, 2) + "\n", "utf8");

  // ── K6: write-knowledge-links (nonce-free, SC-8 member 2) ─────────────────
  // Pass canonicalized nodes/edges — writeKnowledgeLinks re-canonicalizes
  // internally (idempotent), so no double-canonicalize risk.
  // FIX 5: knowledge-recall-provenance.json carries run_id/generated_at and is
  // INTENTIONALLY excluded from the 2-file SC-8 byte-set (sidecar only).
  const linksResult = writeKnowledgeLinks({
    graph: { nodes: graph.nodes, edges: graph.edges },
    repoRoot,
    runId: opts.runId,
    generatedAt: opts.generatedAt,
  });

  return {
    graph,
    graphPath,
    linksPath: linksResult.linksPath,
    provenancePath: linksResult.provenancePath,
    nodeCount: graph.nodes.length,
    edgeCount: graph.edges.length,
    sc3OrphanWikiPageIds,
  };
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

if (require.main === module) {
  void (async () => {
    const args = process.argv.slice(2);
    const arg = (flag: string): string | undefined => {
      const idx = args.findIndex(
        (a) => a === flag || a.startsWith(flag + "=")
      );
      if (idx === -1) return undefined;
      const a = args[idx];
      return a.includes("=") ? a.split("=").slice(1).join("=") : args[idx + 1];
    };

    const phase = arg("--phase");
    const cwd = arg("--cwd");
    const runId = arg("--run-id");
    const generatedAt = arg("--generated-at");

    if (!cwd) {
      process.stderr.write("Error: --cwd <repoRoot> is required\n");
      process.exit(1);
    }

    if (!phase || !["round1", "round2", "finalize"].includes(phase)) {
      process.stderr.write(
        "Error: --phase=round1|round2|finalize is required\n"
      );
      process.exit(1);
    }

    const repoRoot = path.resolve(cwd);
    const runDir = runId
      ? path.join(repoRoot, ".guild", "runs", runId, "knowledge")
      : path.join(repoRoot, ".guild", "runs", "_current", "knowledge");
    const candidateDir = runDir;
    const judgmentDir = runDir;

    // Discover file paths from repo (heuristic: all .ts/.js in src/, all .md in docs/)
    const filePaths = discoverFilePaths(repoRoot);

    if (phase === "round1") {
      emitRound1Candidates(repoRoot, filePaths, candidateDir);
      process.stdout.write(
        JSON.stringify({ phase: "round1", candidateDir, done: true }, null, 2) +
          "\n"
      );
    } else if (phase === "round2") {
      await emitRound2Candidates(repoRoot, filePaths, candidateDir, judgmentDir);
      process.stdout.write(
        JSON.stringify({ phase: "round2", candidateDir, done: true }, null, 2) +
          "\n"
      );
    } else if (phase === "finalize") {
      const seams = buildFileBackedSeams(judgmentDir);
      // SC-12 provenance: derive generated_from_commit from HEAD at the CLI
      // boundary (keeps runKnowledgeStages a pure function of inputs — FIX 1).
      // headSha() returns a deterministic "unknown" when repoRoot is not a git
      // repo / git errors, so SC-8 byte-identity holds: within one commit every
      // run derives the same value, and a non-git fixture repo yields the same
      // constant "unknown" across all triggers.
      const result = await runKnowledgeStages(repoRoot, filePaths, seams, {
        runId,
        generatedAt,
        generatedFromCommit: headSha(repoRoot),
      });
      process.stdout.write(
        JSON.stringify(
          {
            phase: "finalize",
            graphPath: result.graphPath,
            linksPath: result.linksPath,
            provenancePath: result.provenancePath,
            nodeCount: result.nodeCount,
            edgeCount: result.edgeCount,
            done: true,
          },
          null,
          2
        ) + "\n"
      );
    }
  })();
}

// ---------------------------------------------------------------------------
// discoverFilePaths — GENERIC repo-wide file discovery for CLI use (BUG-1)
// ---------------------------------------------------------------------------

/**
 * Discover the corpus file sets GENERICALLY by walking `repoRoot` ONCE.
 *
 * BUG-1 fix: the previous implementation hardcoded code dirs `["src","lib"]` and
 * doc dir `["docs"]` and never returned `svgRelPaths`/`wikiDir`. Guild's own code
 * lives under `scripts/`, `hooks/`, `mcp-servers/`; arbitrary repos use arbitrary
 * layouts. On the plugin corpus this produced ZERO code files → no functions → no
 * clusters → no topics/domains/subtopic_of, and a degenerate all-claim→claim graph.
 *
 * BLOCKER-2 fix (L13-fix): directory/file exclusion now reuses the SHARED
 * cost-gate corpus policy (`createIgnoreFilter` from lib/ignore.ts — the same
 * policy walkRepo/scanCorpusFiles honor) instead of a hand-rolled, narrower dir
 * list. The old list missed `vendor/`, `out/`, `__tests__/fixtures/**`, generated
 * files → it admitted them as graph nodes AND diverged from the cost estimate.
 * Now discovered corpus == cost-gated corpus by construction.
 *
 * Discovery rules (all lists sorted for SC-8/SC-9 determinism):
 *   - code: any file whose extension maps (via detectLanguage + isCodeLanguage)
 *     to a language `analyzeSource`/`computeClustersDeterministic` actually parse
 *     — derived from the source of truth, not a hardcoded extension list — minus
 *     `.test.`/`.spec.` files, minus anything the shared ignore policy excludes.
 *   - docs: every non-ignored `.md` (claims/entities/mermaid come from prose).
 *   - svg:  every `.svg` under a NON-ignored directory. `.svg` is file-ignored by
 *     the shared policy (excluded from cost-gate TOKEN counting) but MUST still be
 *     discovered for K3 diagrams — the directory gate already excluded svgs under
 *     node_modules/vendor/out/fixtures, so only indexed-dir svgs reach the graph.
 *   - wikiDir: defaults to `<repoRoot>/.guild/wiki`.
 *
 * `.guild` is excluded by the shared policy so the wiki (indexed separately as
 * wikiDir) and the derived indexes are never double-scanned as content.
 *
 * Exported for red/green real-path tests (the L12 gate proved injected-seam
 * tests masked this — verify the REAL discovery path, not a fixture helper).
 */
export function discoverFilePaths(repoRoot: string): KnowledgeFilePaths {
  const codeRelPaths: string[] = [];
  const docRelPaths: string[] = [];
  const svgRelPaths: string[] = [];

  // BLOCKER-2 fix: discovery MUST share the cost-gate's corpus policy. The
  // cost-gate counts via walkRepo → createIgnoreFilter (lib/ignore.ts: honors
  // node_modules/.git/dist/build/out/vendor/coverage/__pycache__/target/obj,
  // `.guild`, lockfiles, generated files, AND test fixtures). The previous
  // hand-rolled DISCOVERY_EXCLUDED_DIRS was narrower → it admitted vendor/, out/,
  // and `__tests__/fixtures/**`, polluting the graph and diverging from the
  // cost estimate. Reusing the shared filter makes the discovered corpus ==
  // the cost-gated corpus by construction (no second policy to drift).
  const filter = createIgnoreFilter(repoRoot);

  const walk = (dir: string, relBase: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    // NI-2: sort for cross-filesystem determinism of discovered order.
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      const rel = relBase ? `${relBase}/${e.name}` : e.name;
      if (e.isDirectory()) {
        // Shared DIRECTORY exclusion (cost-gate parity).
        if (filter.isIgnored(rel) || filter.isIgnored(rel + "/")) continue;
        walk(path.join(dir, e.name), rel);
        continue;
      }
      if (!e.isFile()) continue;
      const lower = e.name.toLowerCase();
      // CRITICAL NUANCE: `.svg` is file-ignored by the shared policy (it is
      // excluded from cost-gate TOKEN counting, not from discovery). It MUST
      // still be collected for K3 diagrams. The svg's parent directory already
      // passed the shared DIRECTORY gate above, so an svg under node_modules/
      // vendor/ out/ fixtures/ is never reached here — only svgs under indexed
      // dirs are collected.
      if (lower.endsWith(".svg")) {
        svgRelPaths.push(rel);
        continue;
      }
      // Every other file honors the shared file-level policy so discovery ==
      // cost-gate corpus (fixtures/generated/lockfiles all excluded identically).
      if (filter.isIgnored(rel)) continue;
      if (lower.endsWith(".md")) {
        docRelPaths.push(rel);
      } else if (
        isCodeLanguage(detectLanguage(e.name)) &&
        !/\.test\.|\.spec\./.test(e.name)
      ) {
        codeRelPaths.push(rel);
      }
    }
  };

  walk(repoRoot, "");

  // Sort each list independently (walk already visits in sorted order, but a
  // final sort makes the contract explicit and robust to future walk changes).
  codeRelPaths.sort();
  docRelPaths.sort();
  svgRelPaths.sort();

  return {
    codeRelPaths,
    docRelPaths,
    svgRelPaths,
    wikiDir: path.join(repoRoot, ".guild", "wiki"),
  };
}
