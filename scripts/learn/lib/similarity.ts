/**
 * learn/lib/similarity.ts
 *
 * TASK T8.1 (Goal G8) — Local, model-free code similarity / near-clone detection.
 *
 * Two LOCAL signals, combined; NO embeddings model, NO network, NO model tokens:
 *
 *   1. MinHash structural fingerprint — a seeded MinHash signature over the
 *      token-shingle set of a code node's source slice. Tokens are type-2
 *      normalized first (local identifier NAMES → a single `$id` class, numeric
 *      literals → `$num`; keywords/operators kept), so the fingerprint is
 *      rename-invariant: a renamed true clone still matches, while a same-name
 *      semantic edit cannot win on verbatim name overlap. Jaccard(MinHash) then
 *      estimates structural-token overlap and is robust to small edits / reordering.
 *   2. AST-profile cosine — cosine over the existing 25-feature structural profile
 *      (`sp`, committed by G1 in lib/structural.ts). This signal is rename-invariant:
 *      two functions that differ only in local identifier names share an (almost)
 *      identical control-flow / size / data-flow profile.
 *
 * Combined score = alpha · Jaccard(MinHash) + (1 − alpha) · cosine(sp).
 *
 * Determinism: hashing is seeded (a fixed MINHASH_SEED derives every permutation),
 * so identical input → byte-identical fingerprints/scores. Ranking sorts by score
 * desc with a node-id tie-break, so input node ORDER never changes the result.
 *
 * Candidates only: `buildSimilarEdges` emits `similar_to` edges (a member of the
 * FROZEN closed edge set in lib/schema.ts) tagged `candidate: true`. Nothing here
 * auto-promotes — the lead decides.
 *
 * SQLite: NONE. This module is JSON-only (the `index: off` source-of-truth path).
 * Fingerprints are pure functions of node source + `sp`, so there is no projection
 * to accelerate and no index-mode parity to prove — see T8.1.md gate 5.
 *
 * Scope guard (T8.1): this file is fully self-contained. It READS the committed
 * graph (node `sp` + `source_refs`) and node source slices from disk; it never
 * edits lib/structural.ts or extract-structural.ts (owned by in-flight tasks).
 *
 * Zero runtime deps. No model client import; no fetch/http/https/net/tls.
 */

import * as fs from "fs";
import * as path from "path";

import type { GraphNode, GraphEdge } from "./schema";
import { STRUCTURAL_PROFILE_KEYS } from "./structural";

// ---------------------------------------------------------------------------
// Tunables (all overridable via SimilarityOptions)
// ---------------------------------------------------------------------------

/** Number of MinHash permutations in a signature. More = tighter Jaccard estimate. */
export const DEFAULT_NUM_HASHES = 64;
/** Token-shingle width (k-gram over the token stream). */
export const DEFAULT_SHINGLE_SIZE = 3;
/**
 * Weight on Jaccard(MinHash) vs cosine(sp): score = alpha·J + (1−alpha)·C.
 * Tilted toward the MinHash fingerprint (the headline G8 signal) so the
 * rename-invariant cosine — which is high across nearly all small functions —
 * cannot dominate the threshold; the fingerprint provides the separation.
 */
export const DEFAULT_ALPHA = 0.6;
/** Default minimum combined score for a neighbor / candidate edge. */
export const DEFAULT_THRESHOLD = 0.5;
/** Default neighbor cap (top-k). */
export const DEFAULT_K = 5;

/**
 * Fixed seed root for the MinHash permutation family. Changing it would change
 * every fingerprint — it is part of the determinism contract, so it is frozen.
 */
const MINHASH_SEED = 0x9e3779b9;

/** Code node types we fingerprint (functions + classes carry `sp`). */
const CODE_NODE_TYPES = new Set(["function", "class"]);

// ---------------------------------------------------------------------------
// Options + result types
// ---------------------------------------------------------------------------

export interface SimilarityOptions {
  /** Top-k neighbors to return (kgSimilar) — default DEFAULT_K. */
  k?: number;
  /** Minimum combined score (inclusive) — default DEFAULT_THRESHOLD. */
  threshold?: number;
  /** Jaccard vs cosine mix — default DEFAULT_ALPHA. */
  alpha?: number;
  /** MinHash permutations — default DEFAULT_NUM_HASHES. */
  numHashes?: number;
  /** Token-shingle width — default DEFAULT_SHINGLE_SIZE. */
  shingleSize?: number;
  /**
   * Repo root used to resolve a node's `source_refs[0]` (path#Lx-Ly) to text.
   * Required unless every node carries an inline `src` string or `sourceOf` is given.
   */
  repoRoot?: string;
  /** File reader (defaults to fs.readFileSync utf8). Injected for tests/determinism. */
  readFile?: (abs: string) => string;
  /** Explicit per-node source resolver; wins over `src`/disk when it returns a string. */
  sourceOf?: (node: GraphNode) => string | undefined;
}

export interface SimilarNeighbor {
  id: string;
  type: string;
  name: string;
  /** path#Lx-Ly provenance copied from the node (may be []). */
  source_refs: string[];
  /** Combined score = alpha·jaccard + (1−alpha)·cosine, rounded for byte-stability. */
  score: number;
  /** Jaccard(MinHash) component. */
  jaccard: number;
  /** cosine(sp) component. */
  cosine: number;
}

export interface KgSimilarResult {
  query: string;
  k: number;
  threshold: number;
  /** ranked desc by score, id tie-break; length ≤ k; all score ≥ threshold. */
  neighbors: SimilarNeighbor[];
}

/** A precomputed fingerprint for one code node. */
export interface Fingerprint {
  id: string;
  /** MinHash signature (length numHashes), or [] when the node has no tokens. */
  minhash: number[];
  /** Dense profile vector in STRUCTURAL_PROFILE_KEYS order. */
  profile: number[];
}

// ---------------------------------------------------------------------------
// Hashing primitives (32-bit, deterministic)
// ---------------------------------------------------------------------------

/** FNV-1a 32-bit hash of a string → unsigned 32-bit. */
function fnv1a32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** murmur3 fmix32 finalizer → unsigned 32-bit avalanche. */
function fmix32(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/**
 * The MinHash permutation family: permutation j hashes a shingle value `x` as
 * fmix32(x XOR seed_j), where seed_j = fmix32(MINHASH_SEED + j). Seeds are derived
 * from the fixed root, so the family — and every signature — is deterministic.
 */
function permutationSeeds(numHashes: number): number[] {
  const seeds: number[] = new Array(numHashes);
  for (let j = 0; j < numHashes; j++) {
    seeds[j] = fmix32((MINHASH_SEED + j) >>> 0);
  }
  return seeds;
}

// ---------------------------------------------------------------------------
// Tokenization + shingles
// ---------------------------------------------------------------------------

/**
 * Split source into a deterministic token stream: identifiers/keywords, numeric
 * literals, and single non-space punctuation chars (operators, brackets). This is
 * language-agnostic and captures the structural skeleton; only local identifier
 * NAMES differ between a near-clone pair, so most tokens still match.
 */
export function tokenize(src: string): string[] {
  const out: string[] = [];
  const re = /[A-Za-z_$][\w$]*|\d+(?:\.\d+)?|[^\s\w$]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    out.push(m[0]);
  }
  return out;
}

/**
 * Language-agnostic keyword superset (JS/TS + Python control-flow and declaration
 * keywords). Keywords are STRUCTURAL anchors and are kept verbatim; every other
 * identifier is canonicalized so local names never affect the fingerprint. This is
 * a heuristic superset — a missing keyword only weakens discrimination slightly (it
 * is canonicalized like any identifier); it never breaks determinism or
 * rename-invariance.
 */
const KEYWORDS = new Set<string>([
  // shared control flow + declarations
  "if", "else", "elif", "for", "while", "do", "return", "break", "continue",
  "function", "def", "class", "new", "try", "catch", "except", "finally",
  "throw", "raise", "switch", "case", "default", "in", "of", "with", "lambda",
  "pass", "yield", "async", "await", "import", "from", "as", "export",
  // JS/TS
  "const", "let", "var", "typeof", "instanceof", "void", "this", "super",
  "extends", "implements", "interface", "type", "enum", "public", "private",
  "protected", "static", "readonly", "delete", "null", "undefined", "true",
  "false",
  // Python
  "and", "or", "not", "is", "None", "True", "False", "global", "nonlocal",
  "del", "assert",
]);

/** Canonical placeholders (printable; an identifier literally named `$id` shares the class). */
const ID_PLACEHOLDER = "$id";
const NUM_PLACEHOLDER = "$num";

/**
 * Type-2 normalization of one token: keywords + punctuation/operators are kept
 * verbatim (structural anchors), non-keyword identifiers collapse to `$id`, and
 * numeric literals collapse to `$num`. The effect is that two functions differing
 * only in local identifier names / literal values produce the SAME token stream,
 * while a structurally different function does not — so a renamed true clone wins
 * over a same-identifier non-clone on the MinHash signal too (not just on cosine).
 */
function canonicalizeToken(tok: string): string {
  const c = tok.charCodeAt(0);
  // identifier or keyword: starts with a letter, `_`, or `$`
  if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95 || c === 36) {
    return KEYWORDS.has(tok) ? tok : ID_PLACEHOLDER;
  }
  // numeric literal: starts with a digit
  if (c >= 48 && c <= 57) return NUM_PLACEHOLDER;
  // punctuation / operator — structural, kept verbatim
  return tok;
}

/** Apply {@link canonicalizeToken} across a token stream. */
function canonicalizeTokens(tokens: string[]): string[] {
  return tokens.map(canonicalizeToken);
}

/**
 * Build the set of shingle hashes (k-grams over the token stream). When the token
 * count is below the shingle width, the whole token list is one shingle so short
 * functions still produce a non-empty set.
 */
function shingleHashes(tokens: string[], shingleSize: number): Set<number> {
  const set = new Set<number>();
  if (tokens.length === 0) return set;
  if (tokens.length < shingleSize) {
    set.add(fnv1a32(tokens.join("")));
    return set;
  }
  for (let i = 0; i + shingleSize <= tokens.length; i++) {
    set.add(fnv1a32(tokens.slice(i, i + shingleSize).join("")));
  }
  return set;
}

// ---------------------------------------------------------------------------
// MinHash signature + Jaccard
// ---------------------------------------------------------------------------

/**
 * Compute a MinHash signature over a source slice. Deterministic: same src +
 * params → identical signature. Returns [] for empty token streams.
 */
export function minhashSignature(
  src: string,
  numHashes: number = DEFAULT_NUM_HASHES,
  shingleSize: number = DEFAULT_SHINGLE_SIZE,
): number[] {
  const shingles = shingleHashes(canonicalizeTokens(tokenize(src)), shingleSize);
  if (shingles.size === 0) return [];
  const seeds = permutationSeeds(numHashes);
  const sig = new Array(numHashes).fill(0xffffffff);
  for (const x of shingles) {
    for (let j = 0; j < numHashes; j++) {
      const h = fmix32((x ^ seeds[j]) >>> 0);
      if (h < sig[j]) sig[j] = h;
    }
  }
  return sig;
}

/** Jaccard estimate = fraction of equal MinHash slots. 0 when either sig is empty. */
export function minhashJaccard(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return 0;
  let eq = 0;
  for (let i = 0; i < a.length; i++) if (a[i] === b[i]) eq++;
  return eq / a.length;
}

// ---------------------------------------------------------------------------
// AST-profile cosine
// ---------------------------------------------------------------------------

/** Dense profile vector in the canonical STRUCTURAL_PROFILE_KEYS order. */
export function profileVector(node: GraphNode): number[] {
  const sp = (node as { sp?: Record<string, number> }).sp;
  return STRUCTURAL_PROFILE_KEYS.map((key) => {
    const v = sp ? sp[key] : undefined;
    return typeof v === "number" && Number.isFinite(v) ? v : 0;
  });
}

/** Cosine similarity of two equal-length numeric vectors. 0 when either is a zero vector. */
export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// ---------------------------------------------------------------------------
// Source resolution
// ---------------------------------------------------------------------------

const defaultReadFile = (abs: string): string => fs.readFileSync(abs, "utf8");

/** True when `rel` (output of path.relative) points outside the base directory. */
function escapesBase(rel: string): boolean {
  return rel === ".." || rel.startsWith(".." + path.sep) || path.isAbsolute(rel);
}

/**
 * Resolve `relPath` against `repoRoot` and REFUSE any escape outside the root.
 * Two layers: (1) a lexical containment check on the resolved path — defeats `../`
 * traversal without touching disk; then (2) a best-effort realpath check — defeats
 * symlink escapes — applied only when both paths exist on disk (a not-yet-created
 * file or an injected reader skips layer 2, since layer 1 already proved lexical
 * containment). Returns the absolute path, or null when the target is not under root.
 */
function resolveUnderRoot(repoRoot: string, relPath: string): string | null {
  const root = path.resolve(repoRoot);
  const abs = path.resolve(root, relPath);
  if (escapesBase(path.relative(root, abs))) return null;
  try {
    const realRoot = fs.realpathSync(root);
    const realAbs = fs.realpathSync(abs);
    if (escapesBase(path.relative(realRoot, realAbs))) return null;
  } catch {
    // Root or target absent on disk (injected reader / not-yet-created file):
    // layer 1 already established lexical containment.
  }
  return abs;
}

/**
 * Resolve a node's source slice. Priority: explicit `sourceOf` → inline `src`
 * string → on-disk read of `source_refs[0]` (path#Lx-Ly). Returns "" when no
 * source can be located (the node is then treated as having an empty fingerprint).
 */
function nodeSource(node: GraphNode, opts: SimilarityOptions): string {
  if (opts.sourceOf) {
    const s = opts.sourceOf(node);
    if (typeof s === "string") return s;
  }
  const inline = (node as { src?: unknown }).src;
  if (typeof inline === "string") return inline;

  const ref = Array.isArray(node.source_refs) ? node.source_refs[0] : undefined;
  if (!ref || typeof ref !== "string" || !opts.repoRoot) return "";
  const read = opts.readFile ?? defaultReadFile;
  const hash = ref.indexOf("#");
  const relPath = hash === -1 ? ref : ref.slice(0, hash);
  const frag = hash === -1 ? "" : ref.slice(hash + 1);
  // SECURITY: refuse `source_refs` that escape the repo root (path traversal /
  // symlink). A rejected ref yields "" — the node is treated as empty-fingerprint.
  const abs = resolveUnderRoot(opts.repoRoot, relPath);
  if (abs === null) return "";
  let content: string;
  try {
    content = read(abs);
  } catch {
    return "";
  }
  const m = frag.match(/^L(\d+)-L(\d+)$/);
  if (!m) return content;
  const start = parseInt(m[1], 10);
  const end = parseInt(m[2], 10);
  return content.split("\n").slice(start - 1, end).join("\n");
}

// ---------------------------------------------------------------------------
// Fingerprint table
// ---------------------------------------------------------------------------

/** True for a function/class node carrying source provenance. */
export function isCodeNode(node: GraphNode): boolean {
  return CODE_NODE_TYPES.has(node.type);
}

/**
 * Compute a fingerprint (MinHash + profile vector) for every code node in the
 * graph. Pure function of node source + `sp` — independent of node order.
 */
export function computeFingerprints(
  graph: { nodes: GraphNode[] },
  opts: SimilarityOptions = {},
): Map<string, Fingerprint> {
  const numHashes = opts.numHashes ?? DEFAULT_NUM_HASHES;
  const shingleSize = opts.shingleSize ?? DEFAULT_SHINGLE_SIZE;
  validateFingerprintParams(numHashes, shingleSize);
  const table = new Map<string, Fingerprint>();
  for (const node of graph.nodes) {
    if (!isCodeNode(node)) continue;
    if (table.has(node.id)) continue;
    const src = nodeSource(node, opts);
    table.set(node.id, {
      id: node.id,
      minhash: minhashSignature(src, numHashes, shingleSize),
      profile: profileVector(node),
    });
  }
  return table;
}

/** Combined score for two fingerprints under `alpha`, plus its components. */
function scorePair(
  a: Fingerprint,
  b: Fingerprint,
  alpha: number,
): { score: number; jaccard: number; cosine: number } {
  const jaccard = minhashJaccard(a.minhash, b.minhash);
  const cos = cosine(a.profile, b.profile);
  const score = alpha * jaccard + (1 - alpha) * cos;
  return { score, jaccard, cosine: cos };
}

/** Round to 6 decimals so JSON output is byte-stable across runs/platforms. */
function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

// ---------------------------------------------------------------------------
// Input validation (reject out-of-contract params before they distort output)
// ---------------------------------------------------------------------------

/**
 * Validate MinHash params. Non-positive / non-integer `numHashes` would make
 * `new Array(numHashes)` throw or yield a degenerate signature; same for the
 * shingle width. Throws RangeError on violation.
 */
function validateFingerprintParams(numHashes: number, shingleSize: number): void {
  if (!Number.isInteger(numHashes) || numHashes < 1) {
    throw new RangeError(`similarity: numHashes must be a positive integer (got ${numHashes})`);
  }
  if (!Number.isInteger(shingleSize) || shingleSize < 1) {
    throw new RangeError(`similarity: shingleSize must be a positive integer (got ${shingleSize})`);
  }
}

/**
 * Validate ranking params. A negative `k` would make `slice(0, k)` slice from the
 * end and silently emit candidates, breaking the k·|codeNodes| bound; a `threshold`
 * outside [0,1] is out of contract — combined scores are a convex mix of two
 * components each in [0,1], so they live in [0,1]; a `threshold < 0` admits every
 * pair (no exclusion / unbounded edges) and `> 1` excludes all, while a non-finite
 * value makes every `score < threshold` comparison NaN-driven; an `alpha` outside
 * [0,1] distorts the convex score mix. Throws RangeError on violation.
 */
function validateRankParams(k: number, threshold: number, alpha: number): void {
  if (!Number.isInteger(k) || k < 0) {
    throw new RangeError(`similarity: k must be a non-negative integer (got ${k})`);
  }
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    throw new RangeError(`similarity: threshold must be a finite number in [0,1] (got ${threshold})`);
  }
  if (!Number.isFinite(alpha) || alpha < 0 || alpha > 1) {
    throw new RangeError(`similarity: alpha must be a finite number in [0,1] (got ${alpha})`);
  }
}

// ---------------------------------------------------------------------------
// Public API: kgSimilar
// ---------------------------------------------------------------------------

/**
 * Rank the code nodes most similar to `nodeId` by combined
 * Jaccard(MinHash) + cosine(sp), keeping the top-`k` at or above `threshold`.
 *
 * Deterministic and order-independent: neighbors sort by score desc with an
 * id tie-break, so reversing the input node order yields an identical ranking.
 */
export function kgSimilar(
  graph: { nodes: GraphNode[] },
  nodeId: string,
  k: number = DEFAULT_K,
  threshold: number = DEFAULT_THRESHOLD,
  opts: SimilarityOptions = {},
): KgSimilarResult {
  const alpha = opts.alpha ?? DEFAULT_ALPHA;
  validateRankParams(k, threshold, alpha);
  const table = computeFingerprints(graph, opts);
  const self = table.get(nodeId);

  const nodeById = new Map<string, GraphNode>();
  for (const n of graph.nodes) if (!nodeById.has(n.id)) nodeById.set(n.id, n);

  const neighbors: SimilarNeighbor[] = [];
  if (self) {
    for (const [id, fp] of table) {
      if (id === nodeId) continue;
      const { score, jaccard, cosine: cos } = scorePair(self, fp, alpha);
      if (score < threshold) continue;
      const node = nodeById.get(id)!;
      neighbors.push({
        id,
        type: node.type,
        name: node.name,
        source_refs: Array.isArray(node.source_refs) ? node.source_refs : [],
        score: round6(score),
        jaccard: round6(jaccard),
        cosine: round6(cos),
      });
    }
  }

  neighbors.sort(
    (a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );

  return { query: nodeId, k, threshold, neighbors: neighbors.slice(0, k) };
}

// ---------------------------------------------------------------------------
// Public API: buildSimilarEdges (candidates only)
// ---------------------------------------------------------------------------

/**
 * Emit `similar_to` candidate edges across the whole graph. Each unordered code-node
 * pair scoring ≥ `threshold` yields exactly ONE edge (canonical source<target),
 * capped at `k` per node, tagged `candidate: true` and `provenance`. Bounded by
 * construction — at most k·|codeNodes| edges, threshold-filtered (no spam) — and
 * NEVER auto-promoted: the closed schema owns `similar_to`; the lead promotes.
 */
export function buildSimilarEdges(
  graph: { nodes: GraphNode[] },
  threshold: number = DEFAULT_THRESHOLD,
  k: number = DEFAULT_K,
  opts: SimilarityOptions = {},
): GraphEdge[] {
  const alpha = opts.alpha ?? DEFAULT_ALPHA;
  validateRankParams(k, threshold, alpha);
  const table = computeFingerprints(graph, opts);
  const ids = [...table.keys()].sort();

  // Per-node top-k acceptance, then collapse to unordered pairs (max score wins).
  const pairScore = new Map<string, { a: string; b: string; score: number; jaccard: number; cosine: number }>();
  for (const id of ids) {
    const self = table.get(id)!;
    const cands: { other: string; score: number; jaccard: number; cosine: number }[] = [];
    for (const other of ids) {
      if (other === id) continue;
      const { score, jaccard, cosine: cos } = scorePair(self, table.get(other)!, alpha);
      if (score < threshold) continue;
      cands.push({ other, score, jaccard, cosine: cos });
    }
    cands.sort((x, y) => y.score - x.score || (x.other < y.other ? -1 : x.other > y.other ? 1 : 0));
    for (const c of cands.slice(0, k)) {
      const a = id < c.other ? id : c.other;
      const b = id < c.other ? c.other : id;
      const key = `${a}${b}`;
      const prev = pairScore.get(key);
      if (!prev || c.score > prev.score) {
        pairScore.set(key, { a, b, score: c.score, jaccard: c.jaccard, cosine: c.cosine });
      }
    }
  }

  const edges: GraphEdge[] = [...pairScore.values()]
    .sort((x, y) => (x.a < y.a ? -1 : x.a > y.a ? 1 : x.b < y.b ? -1 : x.b > y.b ? 1 : 0))
    .map((p) => ({
      source: p.a,
      target: p.b,
      type: "similar_to",
      direction: "bi" as const,
      weight: round6(p.score),
      candidate: true,
      provenance: "similarity-minhash-cosine",
      jaccard: round6(p.jaccard),
      cosine: round6(p.cosine),
    }));
  return edges;
}

// ---------------------------------------------------------------------------
// Thin CLI verb: `npx tsx similarity.ts similar '<json>'`
// ---------------------------------------------------------------------------

/**
 * <json> is `{ "graph": <KnowledgeGraph|{nodes}>, "nodeId": "...", "k"?: N,
 * "threshold"?: T, "repoRoot"?: "...", "alpha"?: A }`. Nodes may carry an inline
 * `src` string; otherwise `repoRoot` resolves `source_refs[0]` from disk. Prints
 * a KgSimilarResult as JSON. A bare `edges` verb prints buildSimilarEdges output.
 */
function runCli(argv: string[]): number {
  const verb = argv[0];
  const payload = argv[1];
  if ((verb !== "similar" && verb !== "edges") || !payload) {
    process.stderr.write(
      "usage: similarity.ts <similar|edges> '<json>'\n" +
        "  similar : { graph, nodeId, k?, threshold?, repoRoot?, alpha? }\n" +
        "  edges   : { graph, k?, threshold?, repoRoot?, alpha? }\n",
    );
    return 2;
  }
  let req: Record<string, unknown>;
  try {
    req = JSON.parse(payload);
  } catch (e) {
    process.stderr.write(`invalid JSON: ${(e as Error).message}\n`);
    return 2;
  }
  const graph = req.graph as { nodes: GraphNode[] };
  if (!graph || !Array.isArray(graph.nodes)) {
    process.stderr.write("payload.graph must be an object with a nodes[] array\n");
    return 2;
  }
  const opts: SimilarityOptions = {
    repoRoot: typeof req.repoRoot === "string" ? req.repoRoot : undefined,
    alpha: typeof req.alpha === "number" ? req.alpha : undefined,
  };
  // Validation (RangeError) surfaces as a clean exit-2 rather than a stack trace.
  try {
    if (verb === "edges") {
      const out = buildSimilarEdges(
        graph,
        typeof req.threshold === "number" ? req.threshold : DEFAULT_THRESHOLD,
        typeof req.k === "number" ? req.k : DEFAULT_K,
        opts,
      );
      process.stdout.write(JSON.stringify(out, null, 2) + "\n");
      return 0;
    }
    const nodeId = req.nodeId;
    if (typeof nodeId !== "string") {
      process.stderr.write("payload.nodeId (string) is required for `similar`\n");
      return 2;
    }
    const out = kgSimilar(
      graph,
      nodeId,
      typeof req.k === "number" ? req.k : DEFAULT_K,
      typeof req.threshold === "number" ? req.threshold : DEFAULT_THRESHOLD,
      opts,
    );
    process.stdout.write(JSON.stringify(out, null, 2) + "\n");
    return 0;
  } catch (e) {
    process.stderr.write(`${(e as Error).message}\n`);
    return 2;
  }
}

// Execute only when run directly (never on import — the test suite imports this).
if (require.main === module) {
  process.exit(runCli(process.argv.slice(2)));
}
