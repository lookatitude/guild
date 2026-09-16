/**
 * wiki-index.ts — the LAZY BM25 index over this root's knowledge (R29 / R77 / KTD67).
 *
 * Three properties, each of which is a rule from the plan rather than a preference:
 *
 *   1. LAZY. The index is built on the first MISS, never at SessionStart. Phase
 *      start is a fingerprint comparison (`working-set.ts`); building an index on
 *      every session would put an O(wiki) walk on the one path KTD45 caps at 50ms.
 *   2. The GLOSSARY IS IN IT (KTD70). It is a wiki page, so it is indexed like one.
 *      That is what makes "recall the definition of X" work without the glossary
 *      ever riding in the always-on prefix.
 *   3. `recall.backend: hybrid` RERANKS, and FAILS OPEN (R77). Embeddings are a
 *      cache, never the source of truth. A missing embedding model, a corrupt
 *      cache, a reranker that throws — every one of them returns the BM25 order
 *      rather than an error, because a degraded recall is recall and a failed
 *      recall is a blocked run. Hybrid can only ever reorder what BM25 found; it
 *      cannot introduce a document BM25 missed, which is what keeps the failure
 *      mode boring.
 *
 * `refreshTouched` (see `refresh-touched.ts`) updates this index INCREMENTALLY.
 * Nothing here rebuilds the knowledge graph or the recall projection.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import { bm25Score, tokenize } from "./bm25";
import { createGuildStorage, type GuildStorage } from "../../state";

export const WIKI_INDEX_SCHEMA = "guild.wiki_index.v1" as const;

export type RecallBackend = "bm25" | "hybrid";

export interface IndexedDoc {
  /** Path relative to the wiki root. */
  rel: string;
  title: string;
  tokens: string[];
  /** sha256 prefix of the file body, so an incremental refresh can skip no-ops. */
  hash: string;
  mtime: number;
}

export interface WikiIndex {
  schema_version: typeof WIKI_INDEX_SCHEMA;
  built_at: string;
  docs: IndexedDoc[];
}

export interface IndexOptions {
  cwd?: string;
  storage?: GuildStorage;
}

function storageFor(opts: IndexOptions): GuildStorage {
  return opts.storage ?? createGuildStorage(opts.cwd ?? process.cwd());
}

function wikiRoot(storage: GuildStorage): string | null {
  const scope = storage.project ?? storage.workspace;
  return scope ? scope.knowledge() : null;
}

export function wikiIndexPath(storage: GuildStorage): string {
  return storage.cache("wiki-index", "bm25.json");
}

function listMarkdown(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string, prefix: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const rel = prefix === "" ? e.name : `${prefix}/${e.name}`;
      if (e.isDirectory()) {
        // `_archive` is preserved history, explicitly non-canonical; indexing it
        // would let a superseded page outrank the page that superseded it.
        if (e.name === "_archive" || e.name === "node_modules") continue;
        walk(path.join(dir, e.name), rel);
      } else if (e.name.endsWith(".md")) {
        out.push(rel);
      }
    }
  };
  walk(root, "");
  return out.sort();
}

function titleOf(rel: string, body: string): string {
  const h = /^#\s+(.+)$/m.exec(body);
  return h ? h[1].trim() : path.basename(rel, ".md");
}

function indexOne(root: string, rel: string): IndexedDoc | null {
  const abs = path.join(root, rel);
  let body: string;
  let mtime = 0;
  try {
    body = fs.readFileSync(abs, "utf8");
    mtime = Math.floor(fs.statSync(abs).mtimeMs);
  } catch {
    return null;
  }
  return {
    rel,
    title: titleOf(rel, body),
    tokens: tokenize(`${titleOf(rel, body)}\n${body}`),
    hash: crypto.createHash("sha256").update(body, "utf8").digest("hex").slice(0, 16),
    mtime,
  };
}

export function readWikiIndex(storage: GuildStorage): WikiIndex | null {
  const p = wikiIndexPath(storage);
  try {
    if (!fs.existsSync(p)) return null;
    const parsed = JSON.parse(fs.readFileSync(p, "utf8")) as WikiIndex;
    return parsed && parsed.schema_version === WIKI_INDEX_SCHEMA ? parsed : null;
  } catch {
    return null;
  }
}

export function writeWikiIndex(storage: GuildStorage, index: WikiIndex): string {
  const p = wikiIndexPath(storage);
  storage.ensureDir(path.dirname(p));
  fs.writeFileSync(p, JSON.stringify(index), "utf8");
  return p;
}

/** Build the whole index. Called on a miss, never at SessionStart. */
export function buildWikiIndex(opts: IndexOptions = {}): WikiIndex {
  const storage = storageFor(opts);
  const root = wikiRoot(storage);
  const docs: IndexedDoc[] = [];
  if (root && fs.existsSync(root)) {
    for (const rel of listMarkdown(root)) {
      const d = indexOne(root, rel);
      if (d) docs.push(d);
    }
  }
  const index: WikiIndex = { schema_version: WIKI_INDEX_SCHEMA, built_at: new Date().toISOString(), docs };
  writeWikiIndex(storage, index);
  return index;
}

/**
 * Re-index only the named wiki-relative paths. Used by `refreshTouched`, and by
 * harvest after it writes a page — harvest indexes the page it wrote, it does not
 * rebuild the recall projection (R62).
 */
export function refreshWikiIndexPaths(relPaths: readonly string[], opts: IndexOptions = {}): WikiIndex {
  const storage = storageFor(opts);
  const root = wikiRoot(storage);
  // No full index yet: an incremental refresh would WRITE a one-document index,
  // and every later search would read that as complete and miss every untouched
  // page. The first refresh on a cold index builds the whole thing, then patches.
  const existing =
    readWikiIndex(storage) ??
    (root ? buildWikiIndex({ storage }) : { schema_version: WIKI_INDEX_SCHEMA, built_at: "", docs: [] });
  if (!root) return existing;

  const byRel = new Map(existing.docs.map((d) => [d.rel, d]));
  for (const rel of relPaths) {
    const fresh = indexOne(root, rel);
    if (fresh) byRel.set(rel, fresh);
    else byRel.delete(rel); // the page was deleted; drop it rather than serve a ghost
  }
  const index: WikiIndex = {
    schema_version: WIKI_INDEX_SCHEMA,
    built_at: new Date().toISOString(),
    docs: [...byRel.values()].sort((a, b) => a.rel.localeCompare(b.rel)),
  };
  writeWikiIndex(storage, index);
  return index;
}

export interface SearchHit {
  rel: string;
  title: string;
  score: number;
}

export interface SearchResult {
  hits: SearchHit[];
  /** The backend that actually produced this order. */
  backend: RecallBackend;
  /** Set when `hybrid` was asked for and BM25 order was served instead. */
  degraded_reason?: string;
  /** True when the index had to be built for this query. */
  built_index: boolean;
}

/** Optional reranker. Returning anything unusable is a fail-open, not an error. */
export type Reranker = (query: string, hits: readonly SearchHit[]) => SearchHit[] | null | undefined;

export interface SearchOptions extends IndexOptions {
  backend?: RecallBackend;
  max_hits?: number;
  min_score?: number;
  /** Injected in tests; in production this is the embedding-cache reranker. */
  reranker?: Reranker;
}

export const DEFAULT_MAX_HITS = 8;
export const DEFAULT_MIN_SCORE = 0.1;

/**
 * Search the wiki. Builds the index if there is none — that is the "lazy on first
 * miss" half of R29.
 */
export function searchWiki(query: string, opts: SearchOptions = {}): SearchResult {
  const storage = storageFor(opts);
  let index = readWikiIndex(storage);
  let built = false;
  if (!index) {
    index = buildWikiIndex({ storage });
    built = true;
  }

  const qTokens = tokenize(String(query ?? ""));
  const scores = bm25Score(qTokens, index.docs);
  const minScore = opts.min_score ?? DEFAULT_MIN_SCORE;
  const maxHits = opts.max_hits ?? DEFAULT_MAX_HITS;

  const bm25Hits: SearchHit[] = index.docs
    .map((d, i) => ({ rel: d.rel, title: d.title, score: scores[i] ?? 0 }))
    .filter((h) => h.score >= minScore)
    .sort((a, b) => b.score - a.score || a.rel.localeCompare(b.rel))
    .slice(0, maxHits);

  if ((opts.backend ?? "bm25") !== "hybrid") {
    return { hits: bm25Hits, backend: "bm25", built_index: built };
  }

  // ── hybrid: rerank in cache, fail OPEN to the BM25 order (R77) ──────────────
  const failOpen = (reason: string): SearchResult => ({
    hits: bm25Hits,
    backend: "bm25",
    degraded_reason: reason,
    built_index: built,
  });
  if (!opts.reranker) return failOpen("no embedding model available; served BM25");
  let reranked: SearchHit[] | null | undefined;
  try {
    reranked = opts.reranker(String(query ?? ""), bm25Hits);
  } catch (err) {
    return failOpen(`reranker threw (${(err as Error).message}); served BM25`);
  }
  if (!Array.isArray(reranked) || reranked.length === 0) {
    return failOpen("reranker returned no order; served BM25");
  }
  // A reranker may only REORDER. Anything it invented is dropped, so a broken
  // embedding cache can never inject a document BM25 did not find.
  const allowed = new Set(bm25Hits.map((h) => h.rel));
  const kept = reranked.filter((h) => h && allowed.has(h.rel));
  if (kept.length === 0) return failOpen("reranker returned no known documents; served BM25");
  return { hits: kept, backend: "hybrid", built_index: built };
}
