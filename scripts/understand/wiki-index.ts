#!/usr/bin/env -S npx tsx
/**
 * understand/wiki-index.ts — K2 stage: Wiki/KB index
 *
 * Indexes `.guild/wiki/` (Karpathy: index.md + wikilinked md) AND
 * `docs/knowledge/` (own deterministic scanner — no index.md required)
 * → `wiki_page` nodes + `related` edges (1:1 with [[wikilinks]]).
 *
 * Deterministic outputs (no LLM):
 *   - wiki_page node ids:          wiki_page:<relpath>   (makeWikiPageId)
 *   - source_refs:                 relpath#heading-slug  (H1 of each file)
 *   - name:                        H1 text (exact)
 *   - related edges:               1:1 with [[wikilinks]] present in corpus
 *   - edge direction / weight:     always "out" / 1.0
 *
 * LLM outputs (cost-tiered cheap/mid; each carries confidence):
 *   - category   (closed enum from NODE_CATEGORIES)
 *   - importance (high|medium|low)
 *   - labels[]
 *   - implicit relates_to edges (each ≥ relMinConf, confidence field required)
 *
 * SC-9 determinism boundary: heading/anchor parse, wikilink extraction,
 * node id derivation, related-edge emission = deterministic-script.
 * category / importance / labels / relates_to = LLM-judged (injectable via
 * `ClassifyPageFn` for tests; real LLM call in production).
 *
 * Usage:
 *   npx tsx scripts/understand/wiki-index.ts <wikiDir> [--cwd <path>] [--print]
 *
 * SC-3, SC-6 are the primary acceptance criteria for this stage.
 */

import * as fs from "fs";
import * as path from "path";

import { makeWikiPageId } from "./lib/schema";
import type { GraphNode, GraphEdge } from "./lib/schema";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface WikiPageClassification {
  category: string;     // from NODE_CATEGORIES closed enum
  importance: string;   // "high" | "medium" | "low"
  labels: string[];
}

/** Input descriptor passed to the classifier for each page. */
export interface WikiPageDescriptor {
  id: string;           // wiki_page:<relpath>
  relpath: string;      // e.g. "docs/overview.md"
  name: string;         // H1 text
  headings: string[];   // all headings (H1…H6) in order
  content: string;      // full markdown text
  wikilinks: string[];  // [[basename]] targets as bare basenames
}

/**
 * Classifier function: given a batch of page descriptors, return a map from
 * page id → WikiPageClassification.
 *
 * In production: calls an LLM (cheap/mid tier) with the page content.
 * In tests: inject the oracle map from expected-output.json for determinism.
 *
 * The function MUST return a classification for every page id it is given;
 * missing ids get a default category="note" / importance="low" fallback.
 */
export type ClassifyPageFn = (
  pages: WikiPageDescriptor[],
) => Promise<Map<string, WikiPageClassification>>;

export interface WikiIndexResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

// ---------------------------------------------------------------------------
// Internal: heading-slug derivation (mirrors resolveAnchor in schema.ts)
// ---------------------------------------------------------------------------

/**
 * Derive a heading slug from raw H1 text — identical algorithm to the
 * resolveAnchor fragment matcher in schema.ts so anchors always resolve.
 *
 * "Event Pipeline Knowledge Base"
 *   → "event pipeline knowledge base"
 *   → "event pipeline knowledge base"   (strip non-\w\s- → nothing removed here)
 *   → "event-pipeline-knowledge-base"
 */
function headingSlug(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

// ---------------------------------------------------------------------------
// Internal: markdown parse helpers
// ---------------------------------------------------------------------------

/**
 * Extract the H1 title from markdown content.
 * Returns the first `# Title` line found, or empty string if none.
 */
function extractH1(content: string): string {
  const match = content.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : "";
}

/**
 * Extract all headings (H1…H6) from markdown content, in order.
 */
function extractHeadings(content: string): string[] {
  const re = /^#{1,6}\s+(.+)$/gm;
  const result: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    result.push(m[1].trim());
  }
  return result;
}

/**
 * Extract all `[[wikilink]]` targets from markdown content.
 * Returns basenames only (no brackets).
 * De-duplicates: a basename appearing N times yields N edges from the
 * same source, but we dedup to unique basenames here because the fixture
 * expects 1 edge per unique (source, target) pair, not N per occurrence.
 *
 * SC-3: "[[wikilinks]] → related edges (1:1 with the links present)"
 * means: one edge per unique link per page.
 */
function extractWikilinks(content: string): string[] {
  const re = /\[\[([^\]]+)\]\]/g;
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const target = m[1].trim();
    seen.add(target);
  }
  return [...seen];
}

// ---------------------------------------------------------------------------
// Internal: file scanner
// ---------------------------------------------------------------------------

/** Markdown meta files that are repo meta, not wiki content pages. */
const EXCLUDED_WIKI_NAMES = new Set([
  "README.md",
  "CHANGELOG.md",
  "CONTRIBUTING.md",
  "LICENSE.md",
]);

/**
 * Recursively walk `wikiDir` and collect EVERY `.md` content page.
 * Returns paths relative to `wikiDir`, sorted for determinism.
 *
 * BUG-2 fix (SC-3): page-set discovery is a single shared routine used by BOTH
 * round1 candidate emission (knowledge-orchestrator.collectWikiPageCandidates)
 * and finalize (indexWiki). The retired `collectViaIndex` BFS-from-`index.md`
 * gate dropped any page not reachable by a `[[wikilink]]` — so pages the model
 * classified in round1 vanished in finalize. SC-3 is explicit: EVERY `.guild/wiki/`
 * and `docs/knowledge/` page becomes a `wiki_page` node (fixture page count ==
 * wiki_page node count). `[[wikilinks]]` are `related` EDGES only — never a
 * membership filter. `index.md` is just another page; ordering is fine, the
 * reachability membership gate is the bug.
 *
 * Excludes common meta files (README.md, CHANGELOG.md, …) and hidden dirs.
 * Exported so round1 and finalize cannot drift.
 */
export function collectWikiPageRelpaths(wikiDir: string): string[] {
  const results: string[] = [];

  function walk(current: string, rel: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const name = entry.name;
      // Skip hidden dirs/files
      if (name.startsWith(".")) continue;
      const relChild = rel ? `${rel}/${name}` : name;
      if (entry.isDirectory()) {
        walk(path.join(current, name), relChild);
      } else if (entry.isFile() && name.toLowerCase().endsWith(".md")) {
        if (!EXCLUDED_WIKI_NAMES.has(name)) {
          results.push(relChild);
        }
      }
    }
  }

  walk(wikiDir, "");
  // Deterministic sort: consistent order regardless of filesystem.
  return results.sort();
}

/** Convert an OS-native relative path to POSIX (forward-slash) form. */
function toPosixRel(p: string): string {
  return p.split(path.sep).join("/");
}

// ---------------------------------------------------------------------------
// Internal: wikilink resolution
// ---------------------------------------------------------------------------

/**
 * Build a basename → relpath map from an explicit list of relpaths.
 * Basename = filename without extension (e.g. "overview.md" → "overview").
 * On collision, the first entry wins (callers pass a deterministically sorted list).
 */
function buildBasenameMapFromList(relpaths: string[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const relpath of relpaths) {
    const basename = path.basename(relpath, path.extname(relpath));
    if (!map.has(basename)) {
      map.set(basename, relpath);
    }
  }
  return map;
}

/**
 * Build a basename → relpath map for all .md files in the corpus.
 * Used to resolve [[overview]] → "docs/overview.md".
 */
function buildBasenameMap(relpaths: string[]): Map<string, string> {
  return buildBasenameMapFromList(relpaths);
}

// ---------------------------------------------------------------------------
// Internal: default classifier (fallback when no LLM injected)
// ---------------------------------------------------------------------------

/**
 * Default classifier: assigns category="note" / importance="low" / labels=[]
 * to every page. This is the production-offline fallback (e.g. dry-run mode).
 *
 * In real usage the caller passes a real LLM classifier. In tests the oracle
 * classifier is injected. This default exists so indexWiki is callable without
 * any async LLM dependency in minimal/dry-run contexts.
 */
const defaultClassifier: ClassifyPageFn = async (pages) => {
  const result = new Map<string, WikiPageClassification>();
  for (const page of pages) {
    result.set(page.id, { category: "note", importance: "low", labels: [] });
  }
  return result;
};

// ---------------------------------------------------------------------------
// Public: indexWiki
// ---------------------------------------------------------------------------

/**
 * Index all markdown pages under `wikiDir`, emit `wiki_page` nodes and
 * `related` edges (wikilink 1:1).
 *
 * @param wikiDir  Absolute path to the wiki root (`.guild/wiki/` or
 *                 `docs/knowledge/` — no `index.md` required for the latter).
 * @param opts.classifier  Inject a custom classifier (for tests / dry-run).
 *                         Defaults to the no-op fallback that assigns "note"/"low".
 * @param opts.config      Knowledge config overrides (unused in K2 but accepted
 *                         so the caller can pass through the full config block).
 * @param opts.repoRoot    BUG-3 fix (SC-3/SC-12): when provided, every `wiki_page`
 *                         id + anchor is made **repoRoot-relative** (e.g.
 *                         `wiki_page:.guild/wiki/index.md`, anchor
 *                         `.guild/wiki/index.md#slug`). validateGraphV2 resolves
 *                         anchors at repoRoot, so wikiDir-relative ids ("index.md")
 *                         were unresolvable → every wiki_page node was dropped, and
 *                         two roots both with "index.md" collided on id. When
 *                         absent, ids stay wikiDir-relative (back-compat for direct
 *                         wiki-index callers/tests). The round1 candidate_key
 *                         (`wiki_page:<repoRoot-relpath>`) MUST equal this id.
 */
export async function indexWiki(
  wikiDir: string,
  opts?: {
    classifier?: ClassifyPageFn;
    config?: Record<string, unknown>;
    repoRoot?: string;
  },
): Promise<WikiIndexResult> {
  const classifier = opts?.classifier ?? defaultClassifier;

  // BUG-3: compute the wikiDir's repoRoot-relative prefix. When repoRoot is the
  // wikiDir itself (or absent), relBase is "" and ids stay wikiDir-relative.
  const relBase =
    opts?.repoRoot !== undefined
      ? toPosixRel(path.relative(opts.repoRoot, wikiDir))
      : "";
  const toRepoRel = (fileRel: string): string =>
    relBase ? `${relBase}/${fileRel}` : fileRel;

  // 1. Collect EVERY markdown page (BUG-2: shared recursive routine, no BFS gate)
  const fileRelpaths = collectWikiPageRelpaths(wikiDir);

  // 2. Parse each file: H1, headings, wikilinks, content. The id + anchor use the
  //    repoRoot-relative path; the filesystem read uses the wikiDir-relative path.
  const pageDescriptors: WikiPageDescriptor[] = [];

  for (const fileRel of fileRelpaths) {
    const absPath = path.join(wikiDir, fileRel);
    let content: string;
    try {
      content = fs.readFileSync(absPath, "utf8");
    } catch {
      continue; // skip unreadable files
    }

    const repoRel = toRepoRel(fileRel);
    const h1 = extractH1(content);
    const headings = extractHeadings(content);
    const wikilinks = extractWikilinks(content);
    const id = makeWikiPageId(repoRel);

    pageDescriptors.push({ id, relpath: repoRel, name: h1, headings, content, wikilinks });
  }

  // 3. Classify (LLM-judged)
  const classifications = await classifier(pageDescriptors);

  // 4. Build basename → repoRoot-relative-relpath resolution map (deterministic).
  //    Wikilink basenames resolve to the same repoRoot-relative ids the nodes use.
  const basenameMap = buildBasenameMap(pageDescriptors.map((d) => d.relpath));

  // 5. Emit wiki_page nodes + related edges
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  for (const desc of pageDescriptors) {
    // B4 / SC-9: if the classifier returned no entry for this page, skip it.
    // A missing entry means the model didn't classify it (not that it should be
    // silently defaulted to "note"). The defaultClassifier always populates every
    // entry, so dry-run / no-classifier callers are unaffected.
    const cls = classifications.get(desc.id);
    if (!cls) continue;

    // Compute source_ref anchor: relpath#h1-heading-slug
    // If H1 is missing, fall back to the bare relpath (edge case).
    const anchor = desc.name
      ? `${desc.relpath}#${headingSlug(desc.name)}`
      : desc.relpath;

    const node: GraphNode = {
      id: desc.id,
      type: "wiki_page",
      name: desc.name || path.basename(desc.relpath, ".md"),
      source_refs: [anchor],
      confidence: "high",
      category: cls.category,
      importance: cls.importance,
      labels: cls.labels,
    };
    nodes.push(node);

    // 6. Emit related edges for [[wikilinks]] (deterministic)
    const emittedTargets = new Set<string>(); // dedup per source
    for (const basename of desc.wikilinks) {
      const targetRelpath = basenameMap.get(basename);
      if (!targetRelpath) continue; // unresolved wikilink — skip (no dangling edge)
      const targetId = makeWikiPageId(targetRelpath);

      // Dedup: one edge per (source, target) pair
      if (emittedTargets.has(targetId)) continue;
      emittedTargets.add(targetId);

      const edge: GraphEdge = {
        source: desc.id,
        target: targetId,
        type: "related",
        direction: "out",
        weight: 1.0,
      };
      edges.push(edge);
    }
  }

  return { nodes, edges };
}

// ---------------------------------------------------------------------------
// CLI entry point (for direct invocation: npx tsx wiki-index.ts <wikiDir>)
// ---------------------------------------------------------------------------

if (require.main === module) {
  const argv = process.argv.slice(2);
  const wikiDir = argv[0];
  if (!wikiDir) {
    process.stderr.write("Usage: npx tsx wiki-index.ts <wikiDir> [--print]\n");
    process.exit(1);
  }

  const absWikiDir = path.resolve(wikiDir);

  indexWiki(absWikiDir)
    .then(({ nodes, edges }) => {
      const wikiPages = nodes.filter((n) => n.type === "wiki_page");
      const related = edges.filter((e) => e.type === "related");
      process.stderr.write(
        `[wiki-index] ${wikiPages.length} wiki_page nodes · ${related.length} related edges\n`,
      );
      if (argv.includes("--print")) {
        process.stdout.write(JSON.stringify({ nodes, edges }, null, 2) + "\n");
      } else {
        process.stdout.write(`wiki_pages=${wikiPages.length} related_edges=${related.length}\n`);
      }
    })
    .catch((err) => {
      process.stderr.write(`[wiki-index] ERROR: ${err}\n`);
      process.exit(1);
    });
}
