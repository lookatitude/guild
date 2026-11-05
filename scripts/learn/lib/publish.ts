/**
 * learn/lib/publish.ts — K03: every learn writer of the owner graph/recall
 * publishes through one generation store (src/domains/knowledge/publication.ts).
 *
 * A writer builds its artifacts from the pinned current generation, then
 * publishes with that generation as the destination base and its source basis.
 * If another writer published first, `build` runs again on the newer generation
 * (rebase), so the writer's own layer is re-merged instead of overwriting the
 * other layers. `indexes/knowledge-graph.json` and `knowledge-recall.json` stay
 * as exported copies for legacy readers; they are never freshness evidence.
 */

import * as fs from "fs";
import * as path from "path";

import {
  exportProvenance,
  publishGeneration,
  readPublication,
  type LayerChannel,
  type LayerSpec,
  type PinnedGeneration,
  type PublicationArtifacts,
  type PublishResult,
} from "../../../src/domains/knowledge/publication";
import { basisDigest, sourceWorktreeId, type SourceBasis } from "../../../src/domains/knowledge/source-basis";
import { computeLearnSourceBasis } from "./paths";
import { STRUCTURAL_EXTRACTOR, structuralSubset } from "./structural";
import type { GraphEdge, GraphNode } from "./schema";

export const GRAPH_ARTIFACT = "knowledge-graph.json";
export const RECALL_ARTIFACT = "knowledge-recall.json";

type AnyGraph = { nodes?: GraphNode[]; edges?: GraphEdge[]; layers?: unknown; tour?: unknown; [k: string]: unknown };

function parse(b: Buffer | undefined): AnyGraph | null {
  if (!b) return null;
  try {
    return JSON.parse(b.toString("utf8")) as AnyGraph;
  } catch {
    return null;
  }
}

/** Knowledge labels semantic stages persist onto structural nodes (layers.ts, domain.ts). */
const ANNOTATIONS = ["component", "domain"] as const;

const isStructuralNode = (n: unknown) => {
  const r = n as Record<string, unknown>;
  return r.extractor === STRUCTURAL_EXTRACTOR || r.structural === true;
};

/** Structural layer: what the structural extractor owns (incl. stamped collisions), minus knowledge labels. */
export function structuralView(g: AnyGraph | null): unknown {
  const sub = structuralSubset({ nodes: g?.nodes ?? [], edges: g?.edges ?? [] });
  return {
    nodes: sub.nodes.map((n) => {
      const c = { ...(n as Record<string, unknown>) };
      for (const k of ANNOTATIONS) delete c[k];
      return c;
    }),
    edges: sub.edges,
  };
}

/**
 * Semantic layer: every non-structural node and edge, with the fields a
 * structural merge stamps onto a collided node removed, plus layers and tour.
 */
export function semanticView(g: AnyGraph | null): unknown {
  const nodes = (g?.nodes ?? [])
    .filter((n) => (n as Record<string, unknown>).extractor !== STRUCTURAL_EXTRACTOR)
    .map((n) => {
      const c = { ...(n as Record<string, unknown>) };
      if (c.structural === true) {
        delete c.structural;
        delete c.sp;
        delete c.language;
      }
      return c;
    })
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const edges = (g?.edges ?? [])
    .filter((e) => (e as Record<string, unknown>).extractor !== STRUCTURAL_EXTRACTOR && (e as Record<string, unknown>).structural !== true)
    .map((e) => JSON.stringify([e.type, e.source, e.target, e]))
    .sort();
  const labels = (g?.nodes ?? [])
    .filter(isStructuralNode)
    .map((n) => {
      const r = n as Record<string, unknown>;
      return [r.id, ...ANNOTATIONS.map((k) => r[k] ?? null)];
    })
    .filter((row) => row.slice(1).some((v) => v !== null))
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  return { nodes, edges, labels, layers: g?.layers ?? [], tour: g?.tour ?? [] };
}

function nodeMap(g: AnyGraph | null): Map<string, Record<string, unknown>> {
  return new Map((g?.nodes ?? []).map((n) => [String(n.id), n as Record<string, unknown>]));
}

/**
 * Copy the knowledge labels (component, domain) of surviving node ids from the
 * destination onto a rebuilt graph: a structural rebuild replaces structural
 * nodes wholesale and would otherwise drop them.
 */
export function carryLabels<G extends AnyGraph>(destination: AnyGraph | null, graph: G): G {
  const before = nodeMap(destination);
  for (const n of graph.nodes ?? []) {
    const prev = before.get(String(n.id));
    if (!prev) continue;
    for (const k of ANNOTATIONS) if (prev[k] !== undefined && (n as Record<string, unknown>)[k] === undefined) (n as Record<string, unknown>)[k] = prev[k];
  }
  return graph;
}

const stripStamps = (n: Record<string, unknown>) => {
  const c = { ...n };
  delete c.structural;
  delete c.sp;
  delete c.language;
  return c;
};

/**
 * A structural-only job must leave the semantic layer intact: every semantic
 * node, every semantic edge whose endpoints survive, and every label on a
 * surviving node. Returns the first loss, or null.
 */
export function semanticLoss(destination: AnyGraph | null, next: AnyGraph | null): string | null {
  if (!destination) return null;
  const after = nodeMap(next);
  for (const n of destination.nodes ?? []) {
    const r = n as Record<string, unknown>;
    const a = after.get(String(r.id));
    if (r.extractor !== STRUCTURAL_EXTRACTOR) {
      if (!a) return `semantic node ${String(r.id)} removed`;
      if (JSON.stringify(basisDigest(stripStamps(r))) !== JSON.stringify(basisDigest(stripStamps(a)))) return `semantic node ${String(r.id)} changed`;
    }
    if (a) for (const k of ANNOTATIONS) if (r[k] !== undefined && a[k] !== r[k]) return `label ${k} on ${String(r.id)} changed`;
  }
  // Endpoints only: the validator may normalize an edge's type (auto-correct), which is not a loss.
  const key = (e: GraphEdge) => JSON.stringify([e.source, e.target]);
  const edges = new Set((next?.edges ?? []).map(key));
  for (const e of destination.edges ?? []) {
    const r = e as Record<string, unknown>;
    if (r.extractor === STRUCTURAL_EXTRACTOR || r.structural === true) continue;
    if (after.has(e.source) && after.has(e.target) && !edges.has(key(e))) return `semantic edge ${key(e)} removed`;
  }
  return null;
}

/**
 * A job that does not own the structural layer must leave it intact: every
 * structural node and edge of the destination, compared without knowledge labels.
 */
export function structuralLoss(destination: AnyGraph | null, next: AnyGraph | null): string | null {
  if (!destination) return null;
  const before = structuralView(destination) as { nodes: Array<Record<string, unknown>>; edges: GraphEdge[] };
  const after = structuralView(next) as { nodes: Array<Record<string, unknown>>; edges: GraphEdge[] };
  const nodes = new Map(after.nodes.map((n) => [String(n.id), basisDigest(n)]));
  for (const n of before.nodes) {
    const h = nodes.get(String(n.id));
    if (!h) return `structural node ${String(n.id)} removed`;
    if (h !== basisDigest(n)) return `structural node ${String(n.id)} changed`;
  }
  const edges = new Set(after.edges.map((e) => JSON.stringify([e.source, e.target, e.type])));
  for (const e of before.edges) if (!edges.has(JSON.stringify([e.source, e.target, e.type]))) return `structural edge ${e.source}->${e.target} removed`;
  return null;
}

export const LEARN_LAYERS: Partial<Record<LayerChannel, LayerSpec>> = Object.freeze({
  structural_graph: { artifact: GRAPH_ARTIFACT, digest: (a: PublicationArtifacts) => basisDigest(structuralView(parse(a[GRAPH_ARTIFACT]))) },
  semantic_graph: { artifact: GRAPH_ARTIFACT, digest: (a: PublicationArtifacts) => basisDigest(semanticView(parse(a[GRAPH_ARTIFACT]))) },
  recall: {
    artifact: RECALL_ARTIFACT,
    digest: (a: PublicationArtifacts) => basisDigest(a[RECALL_ARTIFACT] ? a[RECALL_ARTIFACT]!.toString("base64") : null),
  },
});

export interface LearnPublishTarget {
  /** Owner `.guild/indexes`. */
  indexesDir: string;
  /** Owner (durable) worktree root. */
  repoRoot: string;
  /** Scanned worktree root: the bytes the layers were built from. */
  sourceRoot: string;
}

/** Inputs a writer builds from: the pinned generation, or the legacy file before any publication. */
export interface LearnBase {
  pinned: PinnedGeneration | null;
  graph: AnyGraph | null;
  recall: Buffer | null;
  /** The export path holds bytes no generation produced (a writer bypassed publication). */
  bypassed_export: boolean;
}

export function baseFrom(pinned: PinnedGeneration | null, t: LearnPublishTarget): LearnBase {
  if (pinned) {
    // Once a generation exists the export path is never an input: a bypass write
    // there is reported and overwritten, never adopted (it could be stale bytes
    // that would erase a newer layer).
    const bypassed = exportProvenance(t.indexesDir, GRAPH_ARTIFACT).provenance === "bypassed";
    return { pinned, graph: parse(pinned.artifacts[GRAPH_ARTIFACT]), recall: pinned.artifacts[RECALL_ARTIFACT] ?? null, bypassed_export: bypassed };
  }
  // Pre-K03 state: the legacy file is the only input (migration). It proves
  // nothing about freshness: its layers publish `unknown` until a writer rebuilds them.
  let graph: AnyGraph | null = null;
  try {
    graph = JSON.parse(fs.readFileSync(path.join(t.indexesDir, GRAPH_ARTIFACT), "utf8")) as AnyGraph;
  } catch {
    graph = null;
  }
  return { pinned: null, graph, recall: null, bypassed_export: false };
}

export function readLearnBase(t: LearnPublishTarget): LearnBase {
  return baseFrom(readPublication(t.indexesDir), t);
}

/** Same bytes `writeJson` produced, so exported files keep their shape. */
export function jsonBytes(data: unknown): string {
  return JSON.stringify(data, null, 2) + "\n";
}

export interface LearnPublishOptions {
  channels: LayerChannel[];
  /** How each declared channel was produced (default `rebuilt` from the source). */
  provenance?: Partial<Record<LayerChannel, "rebuilt" | "derived" | "ingested">>;
  provenanceReason?: Partial<Record<LayerChannel, string>>;
  /** Artifacts built from `base`; called again on a newer generation. */
  build: (base: LearnBase) => Record<string, unknown>;
  base?: LearnBase;
  basis?: SourceBasis;
  /** Test seam / bounded wait. */
  lockTimeoutMs?: number;
}

function encode(artifacts: Record<string, unknown>): Record<string, string | Buffer> {
  const out: Record<string, string | Buffer> = {};
  for (const [k, v] of Object.entries(artifacts)) out[k] = Buffer.isBuffer(v) ? v : typeof v === "string" ? v : jsonBytes(v);
  return out;
}

function publishBuilt(
  t: LearnPublishTarget,
  opts: { channels: LayerChannel[]; provenance?: LearnPublishOptions["provenance"]; provenanceReason?: LearnPublishOptions["provenanceReason"]; base: LearnBase; basis: SourceBasis; artifacts: Record<string, unknown>; rebase?: (b: LearnBase) => Record<string, unknown>; lockTimeoutMs?: number },
): PublishResult {
  const basis = opts.basis;
  const ownerId = sourceWorktreeId(t.repoRoot);
  const rebase = opts.rebase;
  const structuralOnly = opts.channels.every((c) => c === "structural_graph");
  const touchesGraph = opts.channels.some((c) => c === "structural_graph" || c === "semantic_graph");
  return publishGeneration({
    indexesDir: t.indexesDir,
    identity: { source_id: ownerId, durable_owner_source_id: ownerId, publication_scope_source_id: ownerId },
    layers: LEARN_LAYERS,
    channels: opts.channels,
    base: opts.base.pinned?.pointer ?? null,
    basis,
    observe: () => computeLearnSourceBasis(t.sourceRoot),
    artifacts: encode(opts.artifacts),
    rebase: rebase ? (cur) => encode(rebase(baseFrom(cur, t))) : undefined,
    provenance: opts.provenance,
    provenanceReason: opts.provenanceReason,
    preserve: structuralOnly
      ? (dest, next) => semanticLoss(parse(dest?.[GRAPH_ARTIFACT]), parse(next[GRAPH_ARTIFACT]))
      : touchesGraph
        ? (dest, next) => structuralLoss(parse(dest?.[GRAPH_ARTIFACT]), parse(next[GRAPH_ARTIFACT]))
        : undefined,
    exports: [GRAPH_ARTIFACT, RECALL_ARTIFACT],
    lockTimeoutMs: opts.lockTimeoutMs,
  });
}

export function publishLearnArtifacts(t: LearnPublishTarget, opts: LearnPublishOptions & { rebase?: false }): PublishResult {
  // The basis is taken BEFORE any build input is read; a caller that read its
  // base already must have taken the basis first and pass both.
  if (opts.base && !opts.basis) throw new Error("publishLearnArtifacts: a supplied base needs the basis taken before it was read");
  const basis = opts.basis ?? computeLearnSourceBasis(t.sourceRoot);
  const base = opts.base ?? readLearnBase(t);
  return publishBuilt(t, { ...opts, basis, base, artifacts: opts.build(base), rebase: opts.rebase === false ? undefined : opts.build });
}

/** Async writers cannot rebase under the lock: rebuild and retry on a moved destination. */
export async function publishLearnArtifactsAsync(
  t: LearnPublishTarget,
  opts: Omit<LearnPublishOptions, "build" | "base"> & { build: (base: LearnBase) => Promise<Record<string, unknown>>; attempts?: number },
): Promise<PublishResult> {
  let last: PublishResult | null = null;
  for (let i = 0; i < (opts.attempts ?? 3); i++) {
    const basis = computeLearnSourceBasis(t.sourceRoot);
    const base = readLearnBase(t);
    last = publishBuilt(t, { ...opts, basis, base, artifacts: await opts.build(base) });
    if (last.status === "published" || last.reason !== "destination_moved") return last;
  }
  return last!;
}

/** Throw a readable error for a refused publication (CLI writers exit non-zero). */
export function assertPublished(r: PublishResult, who: string): Extract<PublishResult, { status: "published" }> {
  if (r.status === "published") return r;
  throw new Error(`[${who}] publication refused (${r.reason}): ${r.detail}`);
}

/**
 * Classify an explicit path against the owner's published artifacts by real
 * location (spelling-independent): the graph export, the generation store, or other.
 */
export function ownerArtifactTarget(gp: { indexesDir: string }, target: string): "export" | "store" | "other" {
  // A `..` segment cannot be classified truthfully (it collapses before links resolve): refuse it.
  if (target.split(/[\\/]+/).includes("..")) return "store";
  const real = (p: string): string => {
    const abs = path.resolve(p);
    try {
      return fs.realpathSync(abs);
    } catch {
      try {
        return path.join(fs.realpathSync(path.dirname(abs)), path.basename(abs));
      } catch {
        return abs;
      }
    }
  };
  // Lexical first: the owner namespace is the owner's whatever a link there points at.
  const lex = path.resolve(target);
  const lexIdx = path.resolve(gp.indexesDir);
  if (lex === path.join(lexIdx, GRAPH_ARTIFACT) || lex === path.join(lexIdx, RECALL_ARTIFACT)) return "export";
  if (lex === path.join(lexIdx, "publication") || lex.startsWith(path.join(lexIdx, "publication") + path.sep)) return "store";
  const t = real(target);
  const idx = real(gp.indexesDir);
  if (t === path.join(idx, GRAPH_ARTIFACT) || t === path.join(idx, RECALL_ARTIFACT)) return "export";
  const store = path.join(idx, "publication");
  if (t === store || t.startsWith(store + path.sep)) return "store";
  return "other";
}

export function learnTarget(gp: { indexesDir: string; repoRoot: string; sourceRoot: string }): LearnPublishTarget {
  return { indexesDir: gp.indexesDir, repoRoot: gp.repoRoot, sourceRoot: gp.sourceRoot };
}

/**
 * A graph stage (layers, tour, domain): transform the owner graph and publish
 * the channels it changes. An explicit `target` file is read and written as
 * before; it is not a published layer. Null when there is no graph to read.
 */
export function runGraphStage<G extends object>(
  gp: { indexesDir: string; repoRoot: string; sourceRoot: string },
  opts: { target: string | null; who: string; channels: LayerChannel[]; transform: (g: G) => G },
): G | null {
  if (opts.target && ownerArtifactTarget(gp, opts.target) === "store") throw new Error(`[${opts.who}] refusing to write inside the generation store`);
  if (opts.target && ownerArtifactTarget(gp, opts.target) === "export") opts = { ...opts, target: null };
  if (opts.target) {
    let g: G | null = null;
    try {
      g = JSON.parse(fs.readFileSync(opts.target, "utf8")) as G;
    } catch {
      return null;
    }
    const out = opts.transform(g);
    fs.mkdirSync(path.dirname(opts.target), { recursive: true });
    fs.writeFileSync(opts.target, jsonBytes(out), "utf8");
    return out;
  }
  const t = learnTarget(gp);
  const basis = computeLearnSourceBasis(t.sourceRoot);
  const base = readLearnBase(t);
  if (!base.graph) return null;
  const clone = (g: unknown): G => JSON.parse(JSON.stringify(g)) as G;
  let final = opts.transform(clone(base.graph));
  const first = final;
  assertPublished(
    publishLearnArtifacts(t, {
      channels: opts.channels,
      provenance: Object.fromEntries(opts.channels.map((c) => [c, "derived"])),
      base,
      basis,
      build: (b) => {
        if (b === base) return { [GRAPH_ARTIFACT]: first };
        if (!b.graph) throw new Error(`[${opts.who}] the newer generation has no graph`);
        final = opts.transform(clone(b.graph));
        return { [GRAPH_ARTIFACT]: final };
      },
    }),
    opts.who,
  );
  return final;
}

/**
 * K03 all-writer inventory. Every module that writes the owner graph or recall
 * publishes through this file; every other module that names those artifacts and
 * writes something is listed with what it writes. The inventory test fails on a
 * writer missing from both lists.
 */
export const PUBLICATION_WRITERS: ReadonlyArray<{ file: string; channels: readonly LayerChannel[]; rebase: boolean }> = Object.freeze([
  { file: "scripts/learn/extract-structural.ts", channels: ["structural_graph"], rebase: true },
  { file: "scripts/learn/resolve-calls.ts", channels: ["structural_graph"], rebase: true },
  { file: "scripts/learn/assign-layers.ts", channels: ["semantic_graph"], rebase: true },
  { file: "scripts/learn/build-tour.ts", channels: ["semantic_graph"], rebase: true },
  { file: "scripts/learn/derive-domain.ts", channels: ["semantic_graph"], rebase: true },
  // Whole-graph replacements: a moved destination is refused, never rebased over.
  { file: "scripts/learn/validate-graph.ts", channels: ["semantic_graph"], rebase: false },
  { file: "scripts/learn/knowledge-orchestrator.ts", channels: ["semantic_graph", "recall"], rebase: false },
  { file: "scripts/learn/write-knowledge-links.ts", channels: ["recall"], rebase: false },
]);

export const NON_LAYER_WRITERS: ReadonlyArray<{ file: string; writes: string }> = Object.freeze([
  { file: "scripts/learn/lib/publish.ts", writes: "explicit --in/--out stage targets (not published)" },
  { file: "scripts/learn/lib/paths.ts", writes: "writeJson helper; no artifact path of its own" },
  { file: "src/domains/knowledge/publication.ts", writes: "the generation store and legacy exports" },
  { file: "scripts/learn/analyze-structural.ts", writes: "understand-partial-graph.json (validate-graph input)" },
  { file: "scripts/learn/diff-learn.ts", writes: "runs/<id>/diff-learn.json" },
  { file: "scripts/learn/k-stage-staleness.ts", writes: "the K-stage fingerprint store" },
  { file: "src/domains/knowledge/working-set.ts", writes: "the working-set card" },
  { file: "scripts/lib/capability/profile-emit.ts", writes: "capability profile receipts (reads the graph)" },
  { file: "scripts/dashboard-launch.ts", writes: "dashboard launch state" },
  { file: "scripts/lint/layout-laws.ts", writes: "lint reports (names the artifacts in a scope rule)" },
]);
