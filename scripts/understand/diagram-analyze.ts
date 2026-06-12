/**
 * understand/diagram-analyze.ts — K3 stage: diagram analysis
 *
 * Usage:
 *   npx tsx scripts/understand/diagram-analyze.ts <repoRoot> \
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
 * Contract: guild.knowledge_graph.v2 (scripts/understand/lib/schema.ts)
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
 * Parse a mermaid block body (excluding the opening ```mermaid line).
 * Handles: `graph LR/TD/RL/BT`, `flowchart LR/TD/RL/BT` with `-->` edges.
 *
 * Returns:
 *   nodes — array of node IDs (alphanumeric/underscore identifiers), in
 *           first-seen order, deduplicated.
 *   edges — `{ from, to }` pairs using node IDs (not display labels).
 *
 * Deterministic: same input → same output; no LLM calls.
 */
function parseMermaidBlock(blockBody: string): {
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
    // Skip subgraph / end / style / class directives
    if (/^(?:sub)?graph\b/i.test(line) || line === "end") continue;
    if (/^(?:style|classDef|class|linkStyle|direction)\b/i.test(line)) continue;

    // Strip pipe-label text: A -->|label| B → A --> B
    const normalized = line.replace(/\|[^|]*\|/g, "");

    // Try to match an edge line: fromToken ARROW toToken
    // ARROW covers: -->, ---, -.-, ==>, --o, --x, o--, x--
    // The lazy (.+?) matches the from-token; (.+) greedily the rest.
    const edgeMatch = normalized.match(
      /^(.+?)\s*(?:-->|---|==>|-\.->|--o|--x|o--|x--)\s*(.+)$/
    );
    if (edgeMatch) {
      const extractId = (s: string): string | null => {
        // Node ID is the leading alphanumeric/underscore sequence
        const idMatch = s.trim().match(/^([A-Za-z0-9_]+)/);
        return idMatch ? idMatch[1] : null;
      };
      const from = extractId(edgeMatch[1]);
      const to = extractId(edgeMatch[2]);
      if (from && to) {
        nodeSet.add(from);
        nodeSet.add(to);
        edges.push({ from, to });
        continue;
      }
    }

    // Standalone node definition: NodeId[Label] or NodeId(Label) etc.
    const nodeMatch = line.match(
      /^([A-Za-z0-9_]+)(?:\[[^\]]*\]|\([^)]*\)|\{[^}]*\})?$/
    );
    if (nodeMatch) {
      nodeSet.add(nodeMatch[1]);
    }
  }

  return { nodes: Array.from(nodeSet), edges };
}

// ---------------------------------------------------------------------------
// Internal: SVG parsing
// ---------------------------------------------------------------------------

/**
 * Parse an SVG file for deterministic metadata:
 *   title      — content of the first <title> element
 *   labels     — content of all <text> elements (trimmed, non-empty)
 *   elementIds — values of all id= attributes in the SVG content
 *
 * Deterministic: regex-based, no LLM.
 * svg_description (the semantic description) is NOT extracted here — it is
 * an LLM-judged field populated by a later LLM stage, per SC-9.
 */
function parseSvgFile(content: string): {
  title?: string;
  labels: string[];
  elementIds: string[];
} {
  // Title: first <title>...</title>
  const titleMatch = content.match(/<title>([^<]*)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim() || undefined : undefined;

  // Text labels: all <text ...>content</text> (may be multi-line)
  const textRe = /<text\b[^>]*>([\s\S]*?)<\/text>/gi;
  const labels: string[] = [];
  let tm: RegExpExecArray | null;
  while ((tm = textRe.exec(content)) !== null) {
    // Strip any nested tags (e.g. <tspan>) and trim
    const raw = tm[1].replace(/<[^>]*>/g, "").trim();
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
