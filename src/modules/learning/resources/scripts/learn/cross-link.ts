/**
 * K5 cross-modal-link — `buildCrossLinks`
 *
 * Proposes candidate evidenced_by / relates_to / mentions edges across
 * code ↔ topic ↔ wiki ↔ diagram boundaries via deterministic file-read
 * rules, then calls an injected LLM seam to confirm + score each edge.
 *
 * Deterministic candidate rules:
 *   Rule 1 — shared file-level anchor between any two nodes' source_refs
 *   Rule 2 — function name (\b<funcName>\b) appears in doc/claim/topic file
 *   Rule 3 — ≥2 distinct claim key-terms (\b<term>\b) appear in function source file
 *   Rule 4 — entity name (\b<name>\b, case-insensitive) in function source file
 *   Rule 5 — entity↔topic by name-token prefix overlap (≥4 shared leading chars)
 *   Rule 6 — wiki_page↔topic DISCRIMINATING membership → `topic
 *            --evidenced_by--> wiki_page` (SC-3). Requires identity involvement
 *            (≥1 shared topic-identity↔wiki-identity term) + DF-filtered ≥2
 *            distinct terms, ranked per-wiki top-k AND per-topic-capped (L19:
 *            no topic is the evidence for more than ~half the corpus). The cap
 *            is captivity-aware and shared by the SC-3 fallback, so a page is
 *            never orphaned to enforce it (a captive page's sole topic exceeds
 *            the cap rather than dropping the page). (L16: replaced the prior
 *            body-co-occurrence predicate that over-linked on boilerplate.)
 *
 * SC coverage: SC-3 (every wiki_page gets ≥1 topic membership edge — Rule 6;
 *                    without it every wiki_page is an orphan: topics anchor to
 *                    code, wiki pages to .guild/wiki/ — Rules 1-5 never bridge),
 *              SC-4 (evidenced_by, target anchors, ≤2-hop claim→code),
 *              SC-9/SC-11 (determinism — all candidate IDs from input nodes;
 *                          candidates sorted before LLM call; LLM-invented
 *                          edges not in candidate set are discarded),
 *              SC-12 (anchor resolution for evidenced_by targets).
 *
 * Usage:
 *   const { edges } = await buildCrossLinks(repoRoot, { nodes, edges }, opts)
 */

import * as fs from "fs";
import * as path from "path";
import type { GraphNode, GraphEdge } from "./lib/schema";
import { resolveAnchor } from "./lib/schema";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CrossLinkCandidate {
  source: string; // source node ID
  target: string; // target node ID
  type: "evidenced_by" | "relates_to" | "mentions";
  reason:
    | "shared_file"
    | "func_in_doc"
    | "claim_term_in_code"
    | "entity_in_code"
    | "name_token_overlap"
    | "wiki_topic_term_overlap";
}

/**
 * LLM seam — injected; fail-loud if absent.
 *
 * Receives the full node list + deterministic candidates (sorted). Returns
 * GraphEdge[] — only edges whose (source, target, type) triple is present in
 * the candidate set are accepted; others are silently discarded (SC-9 guard).
 */
export type ConfirmCrossLinksFn = (
  nodes: GraphNode[],
  candidates: CrossLinkCandidate[],
  context: { relMinConf: number }
) => Promise<GraphEdge[]>;

export interface CrossLinkOptions {
  /** LLM seam — required. Throws with "LLM adapter … confirmCrossLinks" if absent. */
  confirmCrossLinks: ConfirmCrossLinksFn;
  /** Minimum confidence weight for emitting an edge. Default: 0.5 */
  relMinConf?: number;
}

export interface CrossLinkResult {
  edges: GraphEdge[];
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for unit tests)
// ---------------------------------------------------------------------------

/**
 * Strip the fragment from a source_ref, returning the bare file path.
 *
 * @example
 *   fileFromSourceRef("docs/ingestion.md#ingestion")  // → "docs/ingestion.md"
 *   fileFromSourceRef("src/validate.ts#L16-L20")       // → "src/validate.ts"
 */
export function fileFromSourceRef(ref: string): string {
  const hashIdx = ref.indexOf("#");
  return hashIdx === -1 ? ref : ref.slice(0, hashIdx);
}

/**
 * Extract the function name from a function node ID.
 * "function:src/validate.ts:validateEvent" → "validateEvent"
 * Returns null for non-function node IDs.
 */
export function funcNameFromId(nodeId: string): string | null {
  if (!nodeId.startsWith("function:")) return null;
  const parts = nodeId.split(":");
  return parts.length >= 3 ? parts[parts.length - 1] : null;
}

/**
 * Escape a string for use in a RegExp constructor.
 */
export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Build a word-boundary regex for a term.
 *
 * ⚠ L1 lesson: always use `\b<escaped>\b`, never `includes()`.
 * `wordBoundaryRegex("store")` does NOT match "stored" or "storeEvent".
 *
 * @param flags  Optional flags string (e.g. 'i' for case-insensitive).
 */
export function wordBoundaryRegex(term: string, flags: string = ""): RegExp {
  return new RegExp(`\\b${escapeRegex(term)}\\b`, flags);
}

/**
 * Split a name into lowercase slug tokens for prefix-overlap comparison.
 *
 * @example
 *   nameSlugTokens("Event Store")  // → ["event", "store"]
 *   nameSlugTokens("event-pipeline") // → ["event", "pipeline"]
 */
export function nameSlugTokens(name: string): string[] {
  return name
    .toLowerCase()
    .split(/[\s\-_]+/)
    .filter((t) => t.length > 0);
}

/**
 * Length of the longest common prefix of two lowercase strings.
 *
 * @example
 *   sharedPrefixLen("store", "storage")    // → 4  ("stor")
 *   sharedPrefixLen("validator", "validation") // → 7 ("validat")
 *   sharedPrefixLen("event", "ingestion")   // → 0
 */
export function sharedPrefixLen(a: string, b: string): number {
  const min = Math.min(a.length, b.length);
  let i = 0;
  while (i < min && a[i] === b[i]) i++;
  return i;
}

/**
 * Stop-words excluded from claim term extraction (Rule 3).
 * Includes both linguistic stop-words and common generic tech terms that
 * appear in nearly every codebase and provide no discriminative signal.
 */
const STOPWORDS = new Set([
  // Linguistic stop-words
  "a",
  "an",
  "the",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "it",
  "its",
  "of",
  "in",
  "to",
  "for",
  "on",
  "at",
  "by",
  "and",
  "or",
  "not",
  "so",
  "no",
  "never",
  "every",
  "all",
  "any",
  "each",
  "that",
  "this",
  "these",
  "those",
  "has",
  "have",
  "had",
  "do",
  "does",
  "did",
  "will",
  "would",
  "could",
  "should",
  "may",
  "might",
  "must",
  "can",
  "with",
  "from",
  "before",
  "after",
  "once",
  "which",
  "what",
  "when",
  "where",
  "who",
  "how",
  "as",
  "only",
  // Generic tech terms — too common to be a discriminative signal
  "event",
  "events",
  "data",
  "type",
  "types",
  "valid",
  "check",
  "error",
  "value",
  "object",
  "input",
  "output",
  "result",
  "handle",
  "create",
  "update",
  "delete",
  "process",
  "service",
  "request",
  "response",
  "method",
  "class",
  "function",
  "return",
  "param",
  "item",
  "list",
  "node",
  "file",
  // Structural / pronoun fillers — too common to discriminate a wiki↔topic link
  // (Rule 6). Added per L14: "module" appears in every auto-named topic ("X
  // Module"), "wiki"/"page" in every wiki node, and the pronoun set survives the
  // 4-char floor without carrying signal.
  "module",
  "modules",
  "wiki",
  "page",
  "pages",
  "they",
  "them",
  "their",
  "there",
  "then",
  "than",
  "here",
  "such",
  "into",
  "your",
  "our",
  "also",
]);

/**
 * Extract key terms from a claim's text: strip punctuation, split on
 * whitespace, filter stop-words and generic tech terms, and require
 * minimum length of 4 characters.
 */
export function extractKeyTerms(text: string): string[] {
  return text
    .replace(/[^a-zA-Z\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !STOPWORDS.has(w.toLowerCase()));
}

/**
 * Lowercased, de-duplicated key-terms for a node's identity string (Rule 6).
 * Wraps extractKeyTerms so topic/wiki identity term-sets compare case-folded.
 *
 * @example
 *   distinctLowerKeyTerms("Telemetry Module")  // → ["telemetry"]  ("module" is a stopword)
 */
export function distinctLowerKeyTerms(text: string): string[] {
  return [...new Set(extractKeyTerms(text).map((w) => w.toLowerCase()))];
}

/**
 * Extract the raw text of every markdown heading (`#`..`######`) in `content`.
 * Used to build a wiki_page's identity term-set for Rule 6.
 *
 * @example
 *   extractHeadingTexts("# Title\n## Section A\nbody")  // → ["Title", "Section A"]
 */
export function extractHeadingTexts(content: string): string[] {
  const out: string[] = [];
  const headingRe = /^#{1,6}\s+(.+)$/gm;
  let m: RegExpExecArray | null;
  while ((m = headingRe.exec(content)) !== null) out.push(m[1].trim());
  return out;
}

/** Read a file relative to repoRoot; returns null on any error. */
function safeReadFile(repoRoot: string, relPath: string): string | null {
  try {
    return fs.readFileSync(path.join(repoRoot, relPath), "utf-8");
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Deterministic candidate proposal
// ---------------------------------------------------------------------------

/**
 * Propose cross-modal link candidates by deterministic file-read rules.
 * Over-generates by design — the LLM seam prunes to semantically valid edges.
 * The returned list is sorted by (source, target, type) for SC-11 determinism.
 *
 * SC-11: no LLM-invented IDs; all candidate source/target IDs come from the
 * nodes array provided by earlier K-stages.
 */
export function proposeCandidates(
  repoRoot: string,
  nodes: GraphNode[],
  _existingEdges: GraphEdge[] // reserved for future dedup; unused in proposal
): CrossLinkCandidate[] {
  const seen = new Set<string>();
  const unsorted: CrossLinkCandidate[] = [];

  function addIfNew(c: CrossLinkCandidate): void {
    const key = `${c.source}→${c.target}:${c.type}`;
    if (!seen.has(key)) {
      seen.add(key);
      unsorted.push(c);
    }
  }

  const claims = nodes.filter((n) => n.type === "claim");
  const functions = nodes.filter((n) => n.type === "function");
  const topics = nodes.filter((n) => n.type === "topic");
  const entities = nodes.filter((n) => n.type === "entity");
  const wikiPages = nodes.filter((n) => n.type === "wiki_page");

  // ---- Rule 1: Shared file path between any two nodes' source_refs --------
  //
  // Generates both directions so the LLM can choose the canonical one.

  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i];
      const b = nodes[j];
      const filesA = (a.source_refs ?? []).map(fileFromSourceRef);
      const filesB = (b.source_refs ?? []).map(fileFromSourceRef);
      const sharesFile = filesA.some((f) => f && filesB.includes(f));
      if (sharesFile) {
        addIfNew({ source: a.id, target: b.id, type: "evidenced_by", reason: "shared_file" });
        addIfNew({ source: b.id, target: a.id, type: "evidenced_by", reason: "shared_file" });
      }
    }
  }

  // ---- Rule 2: Function name in doc/claim/topic/wiki_page file ------------
  //
  // ⚠ Uses exact word-boundary regex — never naive includes().

  for (const fn of functions) {
    const fnName = funcNameFromId(fn.id);
    if (!fnName) continue;
    const fnRe = wordBoundaryRegex(fnName, ""); // case-sensitive (camelCase)

    for (const doc of [...claims, ...topics, ...wikiPages]) {
      const ref = (doc.source_refs ?? [])[0];
      if (!ref) continue;
      const content = safeReadFile(repoRoot, fileFromSourceRef(ref));
      if (content && fnRe.test(content)) {
        addIfNew({ source: doc.id, target: fn.id, type: "evidenced_by", reason: "func_in_doc" });
      }
    }
  }

  // ---- Rule 3: ≥2 distinct claim key-terms in function source file --------
  //
  // Requires at least 2 non-stopword, non-generic-tech terms to match
  // word-boundary in the function file — a single common word (e.g. "event",
  // "data") is not a strong enough signal and floods the LLM with noise.

  for (const claim of claims) {
    const terms = extractKeyTerms(claim.name ?? "");
    if (terms.length === 0) continue;

    for (const fn of functions) {
      const ref = (fn.source_refs ?? [])[0];
      if (!ref) continue;
      const content = safeReadFile(repoRoot, fileFromSourceRef(ref));
      if (!content) continue;
      // Require ≥2 distinct matching terms (not just any single one).
      const matchCount = terms.filter((t) => wordBoundaryRegex(t, "").test(content)).length;
      if (matchCount >= 2) {
        addIfNew({
          source: claim.id,
          target: fn.id,
          type: "evidenced_by",
          reason: "claim_term_in_code",
        });
      }
    }
  }

  // ---- Rule 4: Entity name (case-insensitive word-boundary) in function file

  for (const fn of functions) {
    const ref = (fn.source_refs ?? [])[0];
    if (!ref) continue;
    const content = safeReadFile(repoRoot, fileFromSourceRef(ref));
    if (!content) continue;

    for (const entity of entities) {
      const entityName = (entity.name ?? "").trim();
      if (!entityName) continue;
      if (wordBoundaryRegex(entityName, "i").test(content)) {
        addIfNew({
          source: fn.id,
          target: entity.id,
          type: "mentions",
          reason: "entity_in_code",
        });
      }
    }
  }

  // ---- Rule 5: Entity↔topic by name-token prefix overlap (≥4 chars) ------
  //
  // "Validator" and "Validation" share prefix "validat" (7 chars) ✓
  // "Event Store" token "store" and "Storage" share prefix "stor" (4 chars) ✓
  // "Event" and "Ingestion" share no prefix ✗
  //
  // SC-9: entity/topic IDs come from the nodes array — the LLM never invents
  // new IDs; it only scores (source,target,type) triples proposed here.

  for (const entity of entities) {
    const entityTokens = nameSlugTokens(entity.name ?? "");
    if (entityTokens.length === 0) continue;

    for (const topic of topics) {
      const topicTokens = nameSlugTokens(topic.name ?? "");
      if (topicTokens.length === 0) continue;

      const hasOverlap = entityTokens.some((et) =>
        topicTokens.some((tt) => sharedPrefixLen(et, tt) >= 4)
      );

      if (hasOverlap) {
        addIfNew({
          source: entity.id,
          target: topic.id,
          type: "relates_to",
          reason: "name_token_overlap",
        });
      }
    }
  }

  // ---- Rule 6: wiki_page↔topic DISCRIMINATING membership (SC-3) -----------
  //
  // Topics anchor to CODE (e.g. `hooks/lib/bus-emit.ts#L1-L2`); wiki pages
  // anchor to `.guild/wiki/` & `docs/knowledge/` markdown. Rules 1-5 never
  // bridge them — no shared file (Rule 1), a topic's identity is a code-module
  // slug not a function name (Rules 2/4), and a wiki page is neither claim nor
  // entity (Rules 3/5). Result: every wiki_page is an ORPHAN. SC-3 requires
  // EACH wiki page to carry ≥1 topic membership edge, so we add the bridge.
  //
  // ⚠ L16 lesson — the prior predicate ("≥2 distinct shared terms in EITHER
  // direction") OVER-LINKED on project-wide boilerplate: on a real run three
  // topics each linked to ALL 10 wiki pages (near-complete bipartite) because
  // common domain vocabulary ("guild", "lifecycle", domain names) co-occurs in
  // every wiki body. Mere body co-occurrence of common words is NOT membership.
  //
  // The discriminating predicate now requires, for `topic --evidenced_by-->
  // wiki_page` (SC-4: wiki is doc-evidence FOR the topic; the edge IS SC-3's
  // membership edge):
  //   1. IDENTITY INVOLVEMENT — ≥1 term shared between the topic's IDENTITY
  //      (name + OWN topic_path leaf, never the cumulative ancestor breadcrumb)
  //      and the wiki page's IDENTITY (name + headings + labels). A body-only
  //      co-occurrence can never bridge alone.
  //   2. CORPUS-FREQUENCY (DF) FILTERING — a term that occurs across MOST of the
  //      corpus (project-wide boilerplate / domain names) is dropped from the
  //      bridging set, computed deterministically per term:
  //        • idDf       — # of topic+wiki identities carrying the term
  //        • wikiBodyDf — # of wiki bodies the term \b-matches (direction A)
  //        • topicSrcDf — # of topic sources the term \b-matches (direction B)
  //      A term is boilerplate iff df ≥ DF_MIN_ABS AND df > DF_RATIO·corpus
  //      (the absolute floor keeps tiny corpora — 1 topic / 1 wiki — intact).
  //   3. ≥2 DISTINCT DISCRIMINATING TERMS total (identity ∪ DF-clean dirA/dirB).
  //   4. PER-WIKI TOP-K — a wiki keeps only its K highest-scoring topics
  //      (score weights identity overlap above body corroboration), bounding the
  //      wiki→topics axis so no page links to every topic.
  //   5. PER-TOPIC CAP (L19) — a topic is the evidence for at most TOP_K_TOPIC =
  //      max(TOP_K, ceil(W/2)) wiki pages (≈ half the corpus, floored at the
  //      per-wiki K so tiny corpora are untouched). Per-wiki top-k alone left
  //      the per-TOPIC axis uncapped: on the real L12 run one broad-term topic
  //      ("Jsonl Telemetry Logging") was a genuine discriminating match for
  //      8/10 pages, re-creating a hub. The cap is CAPTIVITY-AWARE — an over-cap
  //      topic sheds its weakest edges (lowest score; ties keep lowest-id pages)
  //      but ONLY to pages that still have another topic edge. A page whose only
  //      discriminating topic is the over-cap one is never shed, so SC-3 holds
  //      and that topic may legitimately exceed the cap rather than orphaning a
  //      captive page (e.g. the wiki index/log pages, which match the telemetry
  //      topic and nothing narrower).
  // Matching is `\b` word-boundary (NEVER includes()), case-insensitive ("i")
  // because identity terms are case-folded but bodies/sources are not.
  //
  // SC-3 FALLBACK — discrimination must NOT leave a wiki page with 0 topics.
  // Two SC-3 safety nets:
  //   • CAPTIVITY GUARD (Phase 2b, above) — the per-topic cap never sheds an
  //     edge to a page that would be left with 0 topics, so a page that HAS a
  //     discriminating candidate always keeps ≥1 (the cap yields to SC-3).
  //   • RAW-OVERLAP FALLBACK (below) — a page with NO discriminating candidate
  //     at all falls back to its single highest-RAW-overlap topic (pre-DF, so a
  //     choice always exists), ties broken by least fallback-load then lowest id
  //     — distributing orphan pages instead of dumping them on one topic (which
  //     would re-create the bipartite saturation).
  // Over-generates by design; the LLM half confirms + scores, and the
  // candidateKeys guard in buildCrossLinks drops fabrications.

  // Precompute per-topic identity terms + concatenated source-file content
  // (one read per topic, not per pair).
  //
  // ⚠ L16: a topic's IDENTITY is its own name + its OWN topic_path leaf slug —
  // NOT the cumulative ancestor breadcrumb. topic_path accumulates parent slugs
  // (e.g. a deep "Handoff-v2" topic carries "guild-root", "emit-learning-…"),
  // which injected project-wide ancestor vocabulary into the identity term-set
  // and drove the over-linking. Use the leaf only.
  const topicTermIndex = topics.map((t) => {
    const tp = t.topic_path ?? [];
    const ownLeaf = tp.length > 0 ? tp[tp.length - 1] : "";
    return {
      id: t.id,
      idTerms: distinctLowerKeyTerms(`${t.name ?? ""} ${ownLeaf}`),
      sourceContent: (t.source_refs ?? [])
        .map((r) => safeReadFile(repoRoot, fileFromSourceRef(r)) ?? "")
        .join("\n"),
    };
  });

  // Precompute per-wiki_page identity terms + body content (one read per page).
  const wikiTermIndex = wikiPages.map((w) => {
    const bodyRef = (w.source_refs ?? [])[0];
    const body = bodyRef
      ? safeReadFile(repoRoot, fileFromSourceRef(bodyRef)) ?? ""
      : "";
    const headings = extractHeadingTexts(body);
    return {
      id: w.id,
      idTerms: distinctLowerKeyTerms(
        `${w.name ?? ""} ${headings.join(" ")} ${(w.labels ?? []).join(" ")}`
      ),
      body,
    };
  });

  if (topicTermIndex.length > 0 && wikiTermIndex.length > 0) {
    const T = topicTermIndex.length;
    const W = wikiTermIndex.length;
    const N = T + W;
    const DF_RATIO = 0.5; // boilerplate if a term spans > half the corpus …
    const DF_MIN_ABS = 3; // … AND at least this many docs (tiny-corpus floor)
    const TOP_K = 3; // max discriminating topics per wiki page

    const inText = (term: string, text: string): boolean =>
      wordBoundaryRegex(term, "i").test(text);

    // Document frequencies — all order-independent (deterministic).
    const idDf = new Map<string, number>();
    for (const t of topicTermIndex)
      for (const term of t.idTerms) idDf.set(term, (idDf.get(term) ?? 0) + 1);
    for (const w of wikiTermIndex)
      for (const term of w.idTerms) idDf.set(term, (idDf.get(term) ?? 0) + 1);

    const wikiBodyDf = new Map<string, number>(); // topic-id term → #wiki bodies
    for (const t of topicTermIndex) {
      for (const term of t.idTerms) {
        if (wikiBodyDf.has(term)) continue;
        let c = 0;
        for (const w of wikiTermIndex) if (inText(term, w.body)) c++;
        wikiBodyDf.set(term, c);
      }
    }

    const topicSrcDf = new Map<string, number>(); // wiki-id term → #topic sources
    for (const w of wikiTermIndex) {
      for (const term of w.idTerms) {
        if (topicSrcDf.has(term)) continue;
        let c = 0;
        for (const t of topicTermIndex) if (inText(term, t.sourceContent)) c++;
        topicSrcDf.set(term, c);
      }
    }

    const isBoilerplate = (
      df: Map<string, number>,
      term: string,
      corpus: number
    ): boolean => {
      const d = df.get(term) ?? 0;
      return d >= DF_MIN_ABS && d > corpus * DF_RATIO;
    };

    // L19: per-topic fan-out cap. Even with per-wiki top-k, ONE broad-term
    // topic can be a genuine discriminating match for most pages (on the real
    // L12 run one topic linked to 8/10), re-introducing a near-bipartite hub.
    // We bound the per-TOPIC axis to TOP_K_TOPIC — at most half the corpus,
    // floored at the per-wiki K so tiny corpora are untouched (cap ≥ W ⇒ no
    // capping).
    //
    // The cap is CAPTIVITY-AWARE so SC-3 is never violated: an over-cap topic
    // sheds its weakest edges, but ONLY to pages that still have ≥1 other edge.
    // A page whose ONLY discriminating topic is the over-cap one (a "captive"
    // page — e.g. the wiki index/log, which match the telemetry topic and
    // nothing narrower) is never shed, so its topic legitimately exceeds the cap
    // rather than orphaning the page. This subsumes the "restore" step: we never
    // orphan in the first place, so there is nothing to restore.
    const TOP_K_TOPIC = Math.max(TOP_K, Math.ceil(W / 2));

    // ── Phase 1: per-wiki top-k discriminating edges (ranked, NOT yet emitted).
    const wikiHasDiscriminative = new Set<string>();
    // wikiId → its ranked, top-k-sliced [{topicId, score}] (best first).
    const perWikiRanked = new Map<
      string,
      Array<{ topicId: string; score: number }>
    >();

    for (const w of wikiTermIndex) {
      const wikiIdSet = new Set(w.idTerms);
      const scored: Array<{ topicId: string; score: number }> = [];

      for (const t of topicTermIndex) {
        const bridge = new Set<string>();
        let idSharedCount = 0;

        // (1) identity ∩ identity — discriminating, DF-clean.
        for (const tt of t.idTerms) {
          if (wikiIdSet.has(tt) && !isBoilerplate(idDf, tt, N)) {
            bridge.add(tt);
            idSharedCount++;
          }
        }
        // (A) topic-identity term in the wiki body — DF-clean.
        for (const tt of t.idTerms) {
          if (!isBoilerplate(wikiBodyDf, tt, W) && inText(tt, w.body)) {
            bridge.add(tt);
          }
        }
        // (B) wiki-identity term in the topic source — DF-clean.
        for (const ww of w.idTerms) {
          if (!isBoilerplate(topicSrcDf, ww, T) && inText(ww, t.sourceContent)) {
            bridge.add(ww);
          }
        }

        // Identity involvement (≥1 shared identity term) AND ≥2 distinct terms.
        if (idSharedCount >= 1 && bridge.size >= 2) {
          // Weight identity overlap above body corroboration.
          scored.push({ topicId: t.id, score: idSharedCount * 100 + bridge.size });
        }
      }

      scored.sort((a, b) =>
        b.score !== a.score
          ? b.score - a.score
          : a.topicId < b.topicId
          ? -1
          : a.topicId > b.topicId
          ? 1
          : 0
      );

      if (scored.length > 0) {
        wikiHasDiscriminative.add(w.id);
        perWikiRanked.set(w.id, scored.slice(0, TOP_K));
      }
    }

    // ── Phase 2a: materialise the intended per-wiki top-k edge set, tracking
    // per-page degree (how many topics target each page) and per-topic load.
    interface IntendedEdge {
      topicId: string;
      wikiId: string;
      score: number;
    }
    const intended = new Map<string, IntendedEdge>(); // `topic→wiki` → edge
    const pageDegree = new Map<string, number>(); // wikiId → #topic edges
    const topicLoad = new Map<string, number>(); // topicId → #wiki edges
    for (const [wikiId, ranked] of perWikiRanked) {
      for (const r of ranked) {
        const key = `${r.topicId}→${wikiId}`;
        if (intended.has(key)) continue;
        intended.set(key, { topicId: r.topicId, wikiId, score: r.score });
        pageDegree.set(wikiId, (pageDegree.get(wikiId) ?? 0) + 1);
        topicLoad.set(r.topicId, (topicLoad.get(r.topicId) ?? 0) + 1);
      }
    }

    // ── Phase 2b: captivity-aware per-topic cap. For each over-cap topic (in id
    // order), shed its weakest edges (lowest score first, ties by HIGHER wiki id
    // so the strongest/lowest-id pages are kept) — but ONLY edges whose target
    // page still has another edge (pageDegree > 1). Stop when at the cap or when
    // every remaining edge is to a captive page (shedding it would orphan SC-3).
    const dropped = new Set<string>(); // `topic→wiki`
    const overCapTopics = [...topicLoad.keys()]
      .filter((t) => (topicLoad.get(t) ?? 0) > TOP_K_TOPIC)
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    for (const topicId of overCapTopics) {
      const edges = [...intended.values()]
        .filter(
          (e) => e.topicId === topicId && !dropped.has(`${topicId}→${e.wikiId}`)
        )
        .sort((a, b) =>
          a.score !== b.score
            ? a.score - b.score // weakest first
            : a.wikiId < b.wikiId
            ? 1 // higher wiki id shed first (keep lowest-id pages)
            : a.wikiId > b.wikiId
            ? -1
            : 0
        );
      for (const e of edges) {
        if ((topicLoad.get(topicId) ?? 0) <= TOP_K_TOPIC) break;
        if ((pageDegree.get(e.wikiId) ?? 0) > 1) {
          dropped.add(`${topicId}→${e.wikiId}`);
          pageDegree.set(e.wikiId, (pageDegree.get(e.wikiId) ?? 0) - 1);
          topicLoad.set(topicId, (topicLoad.get(topicId) ?? 0) - 1);
        }
      }
    }

    // ── Phase 2c: emit the surviving (non-dropped) discriminating edges.
    // Every original page retains ≥1 edge (captivity guard), so no SC-3 restore
    // is needed for the discriminating set. The final proposeCandidates sort
    // makes emission order irrelevant.
    for (const [key, e] of intended) {
      if (dropped.has(key)) continue;
      addIfNew({
        source: e.topicId,
        target: e.wikiId,
        type: "evidenced_by",
        reason: "wiki_topic_term_overlap",
      });
    }

    // SC-3 fallback (CAP-AWARE) — every wiki with NO discriminating candidate
    // gets a topic by RAW overlap (pre-DF, so a choice always exists). The
    // per-topic cap is SHARED with the discriminative path via `emittedTopicLoad`
    // (surviving discriminative edges seed the load), so the fallback steers
    // orphan pages AWAY from already-saturated topics. This is what actually
    // tames the real-run hub: meta pages (the wiki index/log, broad decision
    // notes) raw-overlap MANY topics, and quality-first selection used to dump
    // them ALL on the single broadest topic (the telemetry topic linked 8/10
    // pages). The cap fans them across their other raw matches instead.
    //
    // Selection per orphan page (deterministic):
    //   (1) highest-raw topic still UNDER the cap (ties: lower load, lower id);
    //   (2) if every raw>0 topic is saturated → captive page: take the best by
    //       preference, overriding the cap (SC-3 wins, never orphan);
    //   (3) no overlap anywhere → spread by least load, then lowest id.
    const emittedTopicLoad = new Map<string, number>();
    for (const [key, e] of intended) {
      if (dropped.has(key)) continue;
      emittedTopicLoad.set(
        e.topicId,
        (emittedTopicLoad.get(e.topicId) ?? 0) + 1
      );
    }

    const topicsById = [...topicTermIndex].sort((a, b) =>
      a.id < b.id ? -1 : a.id > b.id ? 1 : 0
    );
    const orphanWikis = wikiTermIndex
      .filter((w) => !wikiHasDiscriminative.has(w.id))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

    const loadOf = (id: string): number => emittedTopicLoad.get(id) ?? 0;
    const byPreference = (
      a: { topicId: string; raw: number },
      b: { topicId: string; raw: number }
    ): number =>
      b.raw !== a.raw
        ? b.raw - a.raw
        : loadOf(a.topicId) !== loadOf(b.topicId)
        ? loadOf(a.topicId) - loadOf(b.topicId)
        : a.topicId < b.topicId
        ? -1
        : a.topicId > b.topicId
        ? 1
        : 0;

    for (const w of orphanWikis) {
      const wikiIdSet = new Set(w.idTerms);

      const ranked = topicsById.map((t) => {
        const raw = new Set<string>();
        for (const tt of t.idTerms) {
          if (wikiIdSet.has(tt)) raw.add(tt);
          if (inText(tt, w.body)) raw.add(tt);
        }
        for (const ww of w.idTerms) {
          if (inText(ww, t.sourceContent)) raw.add(ww);
        }
        return { topicId: t.id, raw: raw.size };
      });

      const positives = ranked.filter((r) => r.raw > 0).sort(byPreference);

      let chosen: string | null = null;
      // (1) best raw>0 topic still under the per-topic cap.
      for (const r of positives) {
        if (loadOf(r.topicId) < TOP_K_TOPIC) {
          chosen = r.topicId;
          break;
        }
      }
      // (2) every raw>0 topic saturated → captive page; cap yields to SC-3.
      if (!chosen && positives.length > 0) chosen = positives[0].topicId;
      // (3) no overlap anywhere → spread by least load, then lowest id.
      if (!chosen) {
        const spread = [...ranked].sort(byPreference);
        chosen = spread.length > 0 ? spread[0].topicId : null;
      }

      if (chosen) {
        addIfNew({
          source: chosen,
          target: w.id,
          type: "evidenced_by",
          reason: "wiki_topic_term_overlap",
        });
        emittedTopicLoad.set(chosen, loadOf(chosen) + 1);
      }
    }
  }

  // Sort by (source, target, type) for SC-11 determinism — candidate order is
  // independent of nodes-array traversal order.
  return unsorted.sort((a, b) => {
    if (a.source !== b.source) return a.source < b.source ? -1 : 1;
    if (a.target !== b.target) return a.target < b.target ? -1 : 1;
    return a.type < b.type ? -1 : 1;
  });
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Build cross-modal links for a knowledge graph.
 *
 * @param repoRoot   Absolute path to the repository root (for anchor resolution).
 * @param input      Graph nodes + existing edges (from prior K-stages).
 * @param opts       Must include `confirmCrossLinks` (LLM seam). Throws if absent.
 */
export async function buildCrossLinks(
  repoRoot: string,
  input: { nodes: GraphNode[]; edges: GraphEdge[] },
  opts: CrossLinkOptions
): Promise<CrossLinkResult> {
  // FAIL-LOUD — missing LLM adapter is a programmer error, not a runtime one.
  if (!opts || !opts.confirmCrossLinks) {
    throw new Error(
      "cross-link: LLM adapter (confirmCrossLinks) is required but was not provided. " +
        "Inject a ConfirmCrossLinksFn via opts.confirmCrossLinks."
    );
  }

  const relMinConf = opts.relMinConf ?? 0.5;

  // Step 1: Propose candidates deterministically (sorted for SC-11).
  const candidates = proposeCandidates(repoRoot, input.nodes, input.edges);

  // Step 2: Build candidate key set for the SC-9 guard (B1).
  // Only edges whose (source,target,type) were proposed deterministically
  // are accepted from the LLM — invented pairs are silently discarded.
  const candidateKeys = new Set<string>(
    candidates.map((c) => `${c.source}→${c.target}:${c.type}`)
  );

  // Step 3: Call LLM seam — confirm + score; candidates are already sorted.
  const rawEdges = await opts.confirmCrossLinks(input.nodes, candidates, { relMinConf });

  // Step 4: Build existing-edge key set for dedup.
  const existingKeys = new Set<string>(
    input.edges.map((e) => `${e.source}→${e.target}:${e.type}`)
  );

  // Step 5: Build a node-by-id map for anchor resolution.
  const nodeById = new Map<string, GraphNode>(input.nodes.map((n) => [n.id, n]));

  // Step 6: Filter, validate, dedup.
  const result: GraphEdge[] = [];

  for (const edge of rawEdges) {
    // SC-9 guard (B1): discard LLM-invented edges not in the deterministic
    // candidate set. Same pattern as L4's validTopicIds guard.
    const edgeKey = `${edge.source}→${edge.target}:${edge.type}`;
    if (!candidateKeys.has(edgeKey)) continue;

    // Weight filter.
    if (edge.weight < relMinConf) continue;

    // Dedup against existing edges.
    if (existingKeys.has(edgeKey)) continue;

    // SC-12: For evidenced_by edges, validate the target node's anchor.
    if (edge.type === "evidenced_by") {
      const targetNode = nodeById.get(edge.target);
      if (!targetNode) continue; // target node unknown — drop
      const refs = targetNode.source_refs ?? [];
      const anyResolves = refs.some((r) => resolveAnchor(repoRoot, r));
      if (!anyResolves) continue; // anchor does not resolve — drop
    }

    // Accept edge and register to prevent duplicates within this batch.
    result.push(edge);
    existingKeys.add(edgeKey);
  }

  return { edges: result };
}
