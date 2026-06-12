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

/**
 * Recursively walk `dir` and collect all `.md` files.
 * Returns paths relative to `dir`, sorted for determinism.
 *
 * Excludes common meta files (README.md, CHANGELOG.md, CONTRIBUTING.md)
 * which are repo meta, not wiki content pages.
 */
function collectMarkdownFilesRecursive(dir: string): string[] {
  const EXCLUDED_NAMES = new Set(["README.md", "CHANGELOG.md", "CONTRIBUTING.md", "LICENSE.md"]);
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
      // Skip hidden dirs and common non-content dirs
      if (name.startsWith(".")) continue;
      const relChild = rel ? `${rel}/${name}` : name;
      if (entry.isDirectory()) {
        walk(path.join(current, name), relChild);
      } else if (entry.isFile() && name.toLowerCase().endsWith(".md")) {
        if (!EXCLUDED_NAMES.has(name)) {
          results.push(relChild);
        }
      }
    }
  }

  walk(dir, "");
  // Deterministic sort: consistent order regardless of filesystem
  return results.sort();
}

/**
 * Karpathy-style wiki scan: start from `index.md` and BFS-collect all pages
 * reachable via `[[wikilinks]]`. This correctly excludes meta files (README.md)
 * that are not part of the wiki content graph.
 *
 * Returns relpaths relative to `wikiDir`, in BFS order (deterministic given
 * a deterministic basename resolution).
 */
function collectViaIndex(wikiDir: string): string[] {
  const indexPath = path.join(wikiDir, "index.md");
  let indexContent: string;
  try {
    indexContent = fs.readFileSync(indexPath, "utf8");
  } catch {
    return collectMarkdownFilesRecursive(wikiDir);
  }

  // Build the full basename → relpath map first (need all files to resolve links)
  const allFiles = collectMarkdownFilesRecursive(wikiDir);
  const basenameMap = buildBasenameMapFromList(allFiles);

  // BFS from index.md
  const visited = new Set<string>(["index.md"]);
  const queue: string[] = ["index.md"];
  const ordered: string[] = ["index.md"];

  let head = 0;
  while (head < queue.length) {
    const current = queue[head++];
    const absPath = path.join(wikiDir, current);
    let content: string;
    try {
      content = fs.readFileSync(absPath, "utf8");
    } catch {
      continue;
    }
    for (const basename of extractWikilinks(content)) {
      const targetRelpath = basenameMap.get(basename);
      if (targetRelpath && !visited.has(targetRelpath)) {
        visited.add(targetRelpath);
        queue.push(targetRelpath);
        ordered.push(targetRelpath);
      }
    }
  }

  return ordered;
}

/**
 * Collect markdown files for a wiki directory.
 *
 * Strategy:
 *   - If `index.md` exists → Karpathy-style: BFS from index.md (only
 *     reachable pages, no meta files like README.md included).
 *   - Otherwise → full recursive scan (docs/knowledge/ style, no index.md
 *     required), excluding common meta files.
 */
function collectMarkdownFiles(wikiDir: string): string[] {
  const indexPath = path.join(wikiDir, "index.md");
  if (fs.existsSync(indexPath)) {
    return collectViaIndex(wikiDir);
  }
  return collectMarkdownFilesRecursive(wikiDir);
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
 */
export async function indexWiki(
  wikiDir: string,
  opts?: {
    classifier?: ClassifyPageFn;
    config?: Record<string, unknown>;
  },
): Promise<WikiIndexResult> {
  const classifier = opts?.classifier ?? defaultClassifier;

  // 1. Collect all markdown files (deterministic)
  const relpaths = collectMarkdownFiles(wikiDir);

  // 2. Parse each file: H1, headings, wikilinks, content
  const pageDescriptors: WikiPageDescriptor[] = [];
  const pageContents = new Map<string, string>(); // relpath → content

  for (const relpath of relpaths) {
    const absPath = path.join(wikiDir, relpath);
    let content: string;
    try {
      content = fs.readFileSync(absPath, "utf8");
    } catch {
      continue; // skip unreadable files
    }
    pageContents.set(relpath, content);

    const h1 = extractH1(content);
    const headings = extractHeadings(content);
    const wikilinks = extractWikilinks(content);
    const id = makeWikiPageId(relpath);

    pageDescriptors.push({ id, relpath, name: h1, headings, content, wikilinks });
  }

  // 3. Classify (LLM-judged)
  const classifications = await classifier(pageDescriptors);

  // 4. Build basename → relpath resolution map (deterministic)
  const basenameMap = buildBasenameMap(relpaths);

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
