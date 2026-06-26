/**
 * learn/diagram-analyze.ts — K3 stage: diagram analysis
 *
 * Usage:
 *   npx tsx scripts/learn/diagram-analyze.ts <repoRoot> \
 *     [--files relPath1 relPath2 ...]
 *
 * Parses fenced ```mermaid blocks and .svg files from the given corpus files
 * and emits `diagram` nodes anchored at `path#mermaid-N` / `path#svg`.
 *
 * Runs BEFORE K5 (cross-modal link) — the diagram nodes it emits are required
 * targets for evidenced_by edges seeded in L5.
 *
 * Determinism responsibility table (SC-9):
 * ┌──────────────────────────────────────────────┬─────────────────────────┐
 * │ Output field                                 │ Owner                   │
 * ├──────────────────────────────────────────────┼─────────────────────────┤
 * │ diagram node id (makeDiagramId)              │ deterministic-script    │
 * │ diagram anchor (source_refs[0])              │ deterministic-script    │
 * │ diagram node name (filename → title)         │ deterministic-script    │
 * │ diagram node type / category / confidence    │ deterministic-script    │
 * │ mermaid_nodes (regex parser)                 │ deterministic-script    │
 * │ mermaid_edges (regex parser)                 │ deterministic-script    │
 * │ svg_title (<title> element text)             │ deterministic-script    │
 * │ svg_labels (<text> element content)          │ deterministic-script    │
 * │ svg_element_ids (id= attributes)             │ deterministic-script    │
 * │ svg_description                              │ LLM-judged (NOT emitted │
 * │                                              │ by this script; callers │
 * │                                              │ may set via LLM stage)  │
 * └──────────────────────────────────────────────┴─────────────────────────┘
 *
 * SC-7 acceptance: the fixture mermaid block (docs/ingestion.md#mermaid-0)
 * yields expected node/edge concept nodes; the seeded topic→diagram link
 * resolves (the diagram node + its anchor exist so L5's evidenced_by target
 * resolves at validateGraphV2).
 *
 * Conform-by-pointer: docs/knowledge/architecture/codebase-understanding.md
 * Contract: guild.knowledge_graph.v2 (scripts/learn/lib/schema.ts)
 */

import * as fs from "fs";
import * as path from "path";

import {
  makeDiagramId,
} from "./lib/schema";
import type { GraphNode, GraphEdge } from "./lib/schema";

// ---------------------------------------------------------------------------
// Public result type
// ---------------------------------------------------------------------------

export interface DiagramAnalyzeResult {
  /** diagram nodes (and any concept nodes emitted by this stage) */
  nodes: GraphNode[];
  /** edges emitted by K3. Currently empty — cross-modal edges live in K5. */
  edges: GraphEdge[];
}

// ---------------------------------------------------------------------------
// Internal: mermaid block parsing
// ---------------------------------------------------------------------------

/**
 * Extract all fenced ```mermaid blocks from markdown content.
 * Returns an array of raw block body strings (excluding fence lines).
 * Deterministic: regex-based, no LLM.
 */
function extractMermaidBlocks(markdownContent: string): string[] {
  const blocks: string[] = [];
  // Match: ```mermaid (optional whitespace) newline … ``` at line start
  const fenceRe = /```mermaid[^\n]*\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = fenceRe.exec(markdownContent)) !== null) {
    blocks.push(m[1]);
  }
  return blocks;
}

/**
 * Extract a mermaid node ID from a raw token (the part before/after an arrow).
 *
 * Handles:
 *   - Quoted IDs: `"my service"`, `"my-service"` — returns inner text verbatim.
 *   - Bare IDs: `NodeId`, `my-service`, `api-gateway`, `node_1` — starts with
 *     alnum/underscore; hyphens are allowed after the first character (very
 *     common in real-world diagrams, e.g. k8s service names).
 *   - Shape specifiers are ignored: `NodeId[Label]`, `"id"[Box]` → ID only.
 *
 * Deterministic: regex-based, no LLM.
 * Exported for direct unit testing (same pattern as kg-query-ranking helpers).
 */
export function extractMermaidNodeId(token: string): string | null {
  const t = token.trim();
  // Quoted node ID: "some text" optionally followed by a shape specifier
  const quotedMatch = t.match(/^"([^"]+)"/);
  if (quotedMatch) return quotedMatch[1];
  // Bare node ID: must start with alnum/underscore; hyphens allowed after the first char
  const bareMatch = t.match(/^([A-Za-z0-9_][A-Za-z0-9_-]*)/);
  return bareMatch ? bareMatch[1] : null;
}

/**
 * Parse a mermaid block body (the full content inside the fenced block,
 * including the opening `graph LR` / `flowchart LR` directive line).
 * Handles: `graph LR/TD/RL/BT`, `flowchart LR/TD/RL/BT` with `-->` edges.
 *
 * Returns:
 *   nodes — array of node IDs (in first-seen order, deduplicated).
 *           Supports bare (`NodeId`), hyphenated (`my-service`), and
 *           quoted (`"my service"`) IDs.
 *   edges — `{ from, to }` pairs using node IDs (not display labels).
 *
 * Deterministic: same input → same output; no LLM calls.
 * Exported for direct unit testing (same pattern as kg-query-ranking helpers).
 */
export function parseMermaidBlock(blockBody: string): {
  nodes: string[];
  edges: Array<{ from: string; to: string }>;
} {
  const nodeSet = new Set<string>();
  const edges: Array<{ from: string; to: string }> = [];

  const lines = blockBody.split("\n");
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("%%") || line.startsWith("//")) continue;
    // Skip graph header, subgraph, end, style, class, linkStyle, direction
    if (/^(?:sub)?graph\b/i.test(line) || /^flowchart\b/i.test(line)) continue;
    if (line === "end") continue;
    if (/^(?:style|classDef|class|linkStyle|direction)\b/i.test(line)) continue;

    // Strip pipe-label text: A -->|label| B → A --> B
    const normalized = line.replace(/\|[^|]*\|/g, "");

    // Try to match an edge line: fromToken ARROW toToken
    // ARROW covers: -->, ---, -.-, ==>, --o, --x, o--, x--
    // Lazy (.+?) matches the from-token up to the first arrow; (.+) greedily the rest.
    const edgeMatch = normalized.match(
      /^(.+?)\s*(?:-->|---|==>|-\.->|--o|--x|o--|x--)\s*(.+)$/
    );
    if (edgeMatch) {
      const from = extractMermaidNodeId(edgeMatch[1]);
      const to = extractMermaidNodeId(edgeMatch[2]);
      if (from && to) {
        nodeSet.add(from);
        nodeSet.add(to);
        edges.push({ from, to });
        continue;
      }
    }

    // Standalone node definition: bare/hyphenated/quoted ID, optionally followed
    // by a shape specifier ([Label], (Label), {Label}).
    // Examples: NodeId[Label], my-service, "quoted id", "my node"[Box]
    const standaloneMatch = line.match(
      /^(?:"([^"]+)"|([A-Za-z0-9_][A-Za-z0-9_-]*))(?:\[[^\]]*\]|\([^)]*\)|\{[^}]*\})?$/
    );
    if (standaloneMatch) {
      // Group 1 = quoted content; group 2 = bare/hyphenated id
      nodeSet.add(standaloneMatch[1] ?? standaloneMatch[2]);
    }
  }

  return { nodes: Array.from(nodeSet), edges };
}

// ---------------------------------------------------------------------------
// Internal: SVG parsing
// ---------------------------------------------------------------------------

/**
 * Parse an SVG file for deterministic metadata:
 *   title      — content of the first <title> (or namespaced <ns:title>) element
 *   labels     — content of all <text> (or <ns:text>) elements, trimmed
 *   elementIds — values of all id= attributes in the SVG content
 *
 * Tolerates:
 *   - Namespaced tags: `<svg:title>`, `<xlink:title>`, `<svg:text>`
 *   - Attributed tags: `<title id="main-title">`, `<title class="x" lang="en">`
 *   - Nested inline tags inside `<text>`: `<tspan>` content is merged with a
 *     single space and redundant whitespace collapsed.
 *
 * Deterministic: regex-based, no LLM.
 * svg_description (the semantic description) is NOT extracted here — it is
 * an LLM-judged field populated by a later LLM stage, per SC-9.
 *
 * Exported for direct unit testing (same pattern as kg-query-ranking helpers).
 */
export function parseSvgFile(content: string): {
  title?: string;
  labels: string[];
  elementIds: string[];
} {
  // Title: <title>, <ns:title> (any namespace prefix), with or without attributes.
  // Pattern: <(ns:)?title(optional attrs)>content</(ns:)?title>
  const titleMatch = content.match(
    /<(?:\w+:)?title(?:\s[^>]*)?>([^<]*)<\/(?:\w+:)?title>/i
  );
  const title = titleMatch ? titleMatch[1].trim() || undefined : undefined;

  // Text labels: <text>, <ns:text> with optional attributes.
  // Replace nested inline tags (e.g. <tspan>) with a space to avoid
  // concatenation without separator; then collapse whitespace.
  const textRe = /<(?:\w+:)?text\b[^>]*>([\s\S]*?)<\/(?:\w+:)?text>/gi;
  const labels: string[] = [];
  let tm: RegExpExecArray | null;
  while ((tm = textRe.exec(content)) !== null) {
    const raw = tm[1]
      .replace(/<[^>]*>/g, " ")   // inline tags → space
      .replace(/\s+/g, " ")       // collapse runs of whitespace
      .trim();
    if (raw) labels.push(raw);
  }

  // Element IDs: all id="..." or id='...' attributes
  const idRe = /\bid=["']([^"']+)["']/g;
  const elementIds: string[] = [];
  let im: RegExpExecArray | null;
  while ((im = idRe.exec(content)) !== null) {
    if (im[1]) elementIds.push(im[1]);
  }

  return { title, labels, elementIds };
}

// ---------------------------------------------------------------------------
// Internal: diagram node naming
// ---------------------------------------------------------------------------

/**
 * Derive a deterministic display name for a diagram node from its file path
 * and kind.
 *
 * Rules (must match expected-graph.v2.json):
 *   mermaid  →  `{TitleCase(fileStem)} flow (mermaid)`
 *   svg      →  `{TitleCase(fileStem)} (svg)`
 *
 * Examples:
 *   makeDiagramName("docs/ingestion.md", "mermaid") → "Ingestion flow (mermaid)"
 *   makeDiagramName("diagrams/architecture.svg", "svg") → "Architecture (svg)"
 */
function makeDiagramName(relPath: string, kind: "mermaid" | "svg"): string {
  const base = path.basename(relPath, path.extname(relPath));
  const title = base.charAt(0).toUpperCase() + base.slice(1);
  return kind === "mermaid" ? `${title} flow (mermaid)` : `${title} (svg)`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * analyzeDiagrams — K3 stage entry point.
 *
 * Scans the given corpus-relative file paths for:
 *   1. Fenced ```mermaid blocks in markdown files → one `diagram` node per
 *      block, anchored `{relPath}#mermaid-{N}`.
 *   2. `.svg` files → one `diagram` node per file, anchored
 *      `{relPath}#svg`.
 *
 * @param repoRoot     Absolute path to the corpus / repo root.
 * @param relFilePaths Corpus-relative file paths to scan.
 * @returns `{ nodes, edges }` where nodes are `diagram` GraphNodes and
 *          edges is always an empty array (cross-modal edges live in K5).
 */
export function analyzeDiagrams(
  repoRoot: string,
  relFilePaths: string[],
): DiagramAnalyzeResult {
  const nodes: GraphNode[] = [];

  for (const relPath of relFilePaths) {
    const absPath = path.resolve(repoRoot, relPath);

    let content: string;
    try {
      if (!fs.existsSync(absPath)) continue;
      content = fs.readFileSync(absPath, "utf8");
    } catch {
      continue;
    }

    const ext = relPath.toLowerCase();

    if (ext.endsWith(".svg")) {
      // SVG diagram node
      const anchor = `${relPath}#svg`;
      const { title, labels, elementIds } = parseSvgFile(content);
      const node: GraphNode & Record<string, unknown> = {
        id: makeDiagramId(anchor),
        type: "diagram",
        name: makeDiagramName(relPath, "svg"),
        source_refs: [anchor],
        confidence: "high",
        category: "diagram",
        svg_title: title,
        svg_labels: labels,
        svg_element_ids: elementIds,
        // svg_description intentionally omitted — LLM-judged field (SC-9)
      };
      nodes.push(node);
    } else if (ext.endsWith(".md") || ext.endsWith(".mdx")) {
      // Markdown: scan for fenced mermaid blocks
      const blocks = extractMermaidBlocks(content);
      for (let idx = 0; idx < blocks.length; idx++) {
        const anchor = `${relPath}#mermaid-${idx}`;
        const { nodes: mNodes, edges: mEdges } = parseMermaidBlock(blocks[idx]);
        const node: GraphNode & Record<string, unknown> = {
          id: makeDiagramId(anchor),
          type: "diagram",
          name: makeDiagramName(relPath, "mermaid"),
          source_refs: [anchor],
          confidence: "high",
          category: "diagram",
          mermaid_nodes: mNodes,
          mermaid_edges: mEdges,
        };
        nodes.push(node);
      }
    }
    // Other file types (e.g. .ts, .js) are skipped — no diagram content.
  }

  return { nodes, edges: [] };
}

// ---------------------------------------------------------------------------
// CLI entrypoint
// ---------------------------------------------------------------------------

if (require.main === module) {
  const argv = process.argv.slice(2);
  const repoRoot = argv[0];
  if (!repoRoot) {
    process.stderr.write(
      "Usage: npx tsx diagram-analyze.ts <repoRoot> [--files relPath1 ...]\n"
    );
    process.exit(1);
  }
  const filesIdx = argv.indexOf("--files");
  const relPaths = filesIdx >= 0 ? argv.slice(filesIdx + 1) : [];
  const result = analyzeDiagrams(repoRoot, relPaths);
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}
