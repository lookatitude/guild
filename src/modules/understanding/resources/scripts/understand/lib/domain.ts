/**
 * understand/lib/domain.ts — stage 5 SCRIPT phase.
 *
 * Derives a deterministic Domain→Flow→Step scaffold cheaply from the existing
 * graph (NO re-scan) — the "existing-process" view the LLM phase (#24) then
 * narrates. Persists the `domain` knowledge label on covered nodes and emits
 * the initial knowledge-links.json projection batch (append-only).
 *
 * LOCKED invariant: `flow_step` weight monotonically encodes step order.
 * knowledge-links closed edge-type set (decisions/continuous-knowledge-and-
 * learning-loop.md §"CR-A #2"): decided_by, used_for, produced, touches,
 * supersedes, learned_from, constrains, opens_question, resolves. The
 * stage-5 batch uses `touches` for domain↔file coverage
 * (codebase-understanding.md §"5 Domain").
 */

import * as fs from "fs";
import { SCHEMA } from "./paths";
import type { GraphEdge, GraphNode, KnowledgeGraph } from "./schema";

function relOf(n: GraphNode): string | null {
  const sr = n.source_refs?.[0];
  return sr ? sr.split("#")[0] : null;
}
function moduleOf(rel: string): string {
  const norm = rel.replace(/\\/g, "/");
  const parts = norm.split("/");
  return parts.length > 1 ? parts[0] : "(root)";
}

export interface DomainResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/**
 * Build the Domain→Flow→Step subgraph and persist `domain` labels.
 * Returns the new domain/flow/step nodes + structural edges to splice in.
 */
export function deriveDomain(graph: KnowledgeGraph): DomainResult {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const seen = new Set(graph.nodes.map((n) => n.id));

  // Group files by top-level module → domain.
  const byModule = new Map<string, GraphNode[]>();
  for (const n of graph.nodes) {
    if (n.type !== "file") continue;
    const rel = relOf(n);
    if (!rel) continue;
    const mod = moduleOf(rel);
    (n as GraphNode).domain = mod; // persisted knowledge label
    const arr = byModule.get(mod) ?? [];
    arr.push(n);
    byModule.set(mod, arr);
  }

  const add = (n: GraphNode) => {
    if (!seen.has(n.id)) {
      seen.add(n.id);
      nodes.push(n);
    }
  };

  for (const [mod, files] of byModule) {
    const domainId = `domain:${mod}`;
    add({ id: domainId, type: "domain", name: mod, source_refs: [mod], confidence: "low" });

    // Flows = function-bearing files in the module (deterministic scaffold).
    const flowFiles = files.filter((f) =>
      graph.edges.some((e) => e.source === f.id && e.type === "contains"),
    );
    const flowSet = flowFiles.length ? flowFiles : files.slice(0, 1);
    let flowOrder = 0;
    for (const f of flowSet) {
      const rel = relOf(f)!;
      const flowId = `flow:${rel}`;
      add({ id: flowId, type: "flow", name: rel, source_refs: f.source_refs, confidence: "low" });
      edges.push({ source: domainId, target: flowId, type: "contains_flow", direction: "out", weight: 1 });

      // Steps = functions contained by the file, ordered; weight monotone.
      const stepNodeIds = graph.edges
        .filter((e) => e.source === f.id && e.type === "contains")
        .map((e) => e.target)
        .filter((id) => id.startsWith("function:"));
      const count = stepNodeIds.length;
      stepNodeIds.forEach((sid, i) => {
        const w = Math.round(((i + 1) / (count + 1)) * 1000) / 1000;
        edges.push({ source: flowId, target: sid, type: "flow_step", direction: "out", weight: w });
      });
      flowOrder++;
    }
  }
  return { nodes, edges };
}

interface KnowledgeLink {
  from: string;
  to: string;
  type: string;
  run_id: string;
}
interface KnowledgeLinksDoc {
  version: string;
  links: KnowledgeLink[];
}

/**
 * Emit the stage-5 initial knowledge-links batch APPEND-ONLY into
 * .guild/indexes/knowledge-links.json (`guild.knowledge_links.v1`).
 * Derived, rebuildable, deletable — never a new store. Dedupes on
 * from|to|type so re-runs are idempotent.
 */
export function appendKnowledgeLinks(
  knowledgeLinksPath: string,
  graph: KnowledgeGraph,
  runId: string,
): { added: number; total: number } {
  let doc: KnowledgeLinksDoc = { version: SCHEMA.knowledgeLinks, links: [] };
  if (fs.existsSync(knowledgeLinksPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(knowledgeLinksPath, "utf8"));
      if (parsed && Array.isArray(parsed.links)) doc = parsed;
    } catch {
      /* corrupt → rebuild (derived index, safe) */
    }
  }
  doc.version = SCHEMA.knowledgeLinks;

  const existing = new Set(doc.links.map((l) => `${l.from}|${l.to}|${l.type}`));
  let added = 0;

  // domain → covered file: `touches` (closed-set member).
  for (const n of graph.nodes) {
    if (n.type !== "file") continue;
    const dom = (n as GraphNode).domain as string | undefined;
    if (!dom) continue;
    const link: KnowledgeLink = { from: `domain:${dom}`, to: n.id, type: "touches", run_id: runId };
    const k = `${link.from}|${link.to}|${link.type}`;
    if (!existing.has(k)) {
      existing.add(k);
      doc.links.push(link);
      added++;
    }
  }

  fs.mkdirSync(require("path").dirname(knowledgeLinksPath), { recursive: true });
  fs.writeFileSync(knowledgeLinksPath, JSON.stringify(doc, null, 2) + "\n", "utf8");
  return { added, total: doc.links.length };
}
