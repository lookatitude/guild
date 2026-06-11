/**
 * understand/lib/schema.ts
 *
 * The FROZEN Guild KnowledgeGraph schema (codebase-understanding.md
 * §"KnowledgeGraph", contract `guild.knowledge_graph.v1`, contract-map.md §A
 * row 12) + the tolerant validate/repair ladder.
 *
 * Also exports the BREAKING v2 schema (`guild.knowledge_graph.v2`) with:
 *   - Expanded closed node set (topic, concept, claim, entity, wiki_page, diagram)
 *   - Expanded closed edge set (subtopic_of, relates_to, evidenced_by, belongs_to_domain,
 *     mentions, defines, related)
 *   - Deterministic node ID helpers
 *   - v2-only validator (validateGraphV2) with invariant checks:
 *     monotone flow_step (FATAL), file-in-exactly-one-layer, subtopic_of acyclicity
 *     + depth + fan-out, no topic below minTopicImportance, evidenced_by target anchor
 *     resolution, mandatory per-form anchor resolution.
 *   - v1/v2 boundary: v1 graphs (version != "guild.knowledge_graph.v2") are routed
 *     to validateGraph (read-only, no v2 invariants). Only v2 graphs get v2 validation.
 *   - Config keys: KNOWLEDGE_CONFIG_DEFAULTS (models.knowledge.*)
 *
 * Schema field names and the `version` string are canonical — cited from the
 * spec, NOT re-spelled. The ladder + the ~80-entry alias tables are forked
 * Guild-native from Understand-Anything (MIT — see ../LICENSE-attribution.md).
 * zod is NOT used; validation is hand-rolled to honor the zero-runtime-dep
 * constraint.
 *
 * Ladder: sanitize → normalize aliases → auto-fix defaults → validate & drop
 * invalid items individually. Never discards a salvageable graph; FATAL only
 * on zero valid nodes / non-object / missing project.
 *
 * Conform-by-pointer: docs/knowledge/architecture/codebase-understanding.md + contract-map.md
 * The contract-map row for guild.knowledge_graph.v2 needs updating in L10 (docs lane).
 */

import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

// ---------------------------------------------------------------------------
// v1 — closed node type set (frozen)
// ---------------------------------------------------------------------------

// 21 canonical node types (frozen schema §"KnowledgeGraph").
export const NODE_TYPES = new Set([
  "file", "function", "class", "module", "concept",
  "config", "document", "service", "table", "endpoint",
  "pipeline", "schema", "resource",
  "domain", "flow", "step",
  "article", "entity", "topic", "claim", "source",
]);

// ---------------------------------------------------------------------------
// v2 — expanded node type set (breaking bump)
// ---------------------------------------------------------------------------

// guild.knowledge_graph.v2 adds: wiki_page (first-class, not aliased),
// diagram. concept/entity/topic/claim already in v1 NODE_TYPES; wiki_page
// replaces the article alias trap.
// NOTE: there is NO separate `subtopic` type — a subtopic is a `topic`
// reached via a `subtopic_of` edge (per spec § Schema Design).
// subtopic_of edges form a TREE (each topic has at most one parent).
// Multi-parent subtopic_of is REJECTED (violates tree invariant).
export const NODE_TYPES_V2 = new Set([
  ...NODE_TYPES,
  "wiki_page",  // first-class in v2; v1 aliased this to article — alias removed
  "diagram",    // new in v2: fenced mermaid blocks, .svg files
]);

// ---------------------------------------------------------------------------
// v1 — closed edge type set (frozen)
// ---------------------------------------------------------------------------

// Canonical edge types: the forked UA 35-type closed set across 8 categories,
// PLUS `implemented_by` which the frozen Guild schema names explicitly and
// the LOCKED invariant marks as NOT aliased.
export const EDGE_TYPES = new Set([
  // Structural
  "imports", "exports", "contains", "inherits", "implements", "implemented_by",
  // Behavioral
  "calls", "subscribes", "publishes", "middleware",
  // Data flow
  "reads_from", "writes_to", "transforms", "validates",
  // Dependencies
  "depends_on", "tested_by", "configures",
  // Semantic
  "related", "similar_to",
  // Infrastructure
  "deploys", "serves", "provisions", "triggers",
  // Schema/Data
  "migrates", "documents", "routes", "defines_schema",
  // Domain
  "contains_flow", "flow_step", "cross_domain",
  // Knowledge
  "cites", "contradicts", "builds_on", "exemplifies", "categorized_under", "authored_by",
]);

// ---------------------------------------------------------------------------
// v2 — expanded edge type set (breaking bump)
// ---------------------------------------------------------------------------

// guild.knowledge_graph.v2 adds new knowledge edge types that survive the
// validator (in v1 these were aliased or dropped as unknown).
export const EDGE_TYPES_V2 = new Set([
  ...EDGE_TYPES,
  "subtopic_of",       // hierarchy; acyclic, tree (single-parent), depth-monotone (SC-2)
  "relates_to",        // weighted, LLM-judged (SC-3)
  "evidenced_by",      // knowledge→artifact, cross-modal (SC-4)
  "belongs_to_domain", // topic→domain membership (SC-5)
  "mentions",          // modality bridge (SC-3)
  "defines",           // modality bridge (first-class v2 — NOT aliased to defines_schema)
  // NOTE: "related" is already in v1 EDGE_TYPES (wikilink edges use it)
]);

// ---------------------------------------------------------------------------
// v2 — category enum (closed set, SC-6)
// ---------------------------------------------------------------------------

// Frozen category enum for knowledge nodes. Validator REQUIRES category on
// all v2 knowledge node types (topic/concept/claim/entity/wiki_page/diagram)
// and REJECTS any value not in this set.
export const NODE_CATEGORIES = new Set([
  // Code structure
  "function", "class", "module", "config", "endpoint", "pipeline", "schema",
  // Knowledge
  "concept", "fact", "claim", "principle", "definition", "example",
  // Documentation
  "guide", "tutorial", "reference", "overview", "changelog", "architecture",
  // Organizational
  "decision", "standard", "recipe", "checklist",
  // Content
  "component", "domain", "diagram", "index", "note",
]);

// ---------------------------------------------------------------------------
// v2 — config defaults (models.knowledge.*, SC-2/SC-15)
// ---------------------------------------------------------------------------

// Default values for models.knowledge.* config keys.
// Overridable in settings.json models.knowledge.*; bound by pointer to the
// cost-aware-tiering ADR §10 — never re-spells the tier map here.
// NOTE: importance_score is a REQUIRED numeric 0–1 field on topic nodes.
// The string "importance" field (high/medium/low) is separate display labeling;
// the numeric importance_score drives the threshold filter.
export const KNOWLEDGE_CONFIG_DEFAULTS = {
  maxDepth: 8,              // hard ceiling on subtopic_of tree depth
  maxBranching: 12,         // per-node subtopic_of fan-out limit
  minTopicImportance: 0.4,  // numeric importance_score threshold; below → fold into parent
  relMinConf: 0.5,          // min confidence for LLM-judged relates_to/evidenced_by edges
  maxFiles: 3000,           // cost gate: max files per K-stage run
  maxTokens: 1_000_000,     // cost gate: max LLM output tokens per run
  batchSize: 20,            // files per LLM batch
} as const;

export type KnowledgeConfig = typeof KNOWLEDGE_CONFIG_DEFAULTS;

// ---------------------------------------------------------------------------
// v2 — deterministic node ID helpers (SC-11/SC-12)
// ---------------------------------------------------------------------------

/**
 * Normalize a name for entity IDs: lowercase, spaces → hyphens, strip
 * non-alphanumeric except hyphens and slashes.
 */
function normalizeEntityName(name: string): string {
  return name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9\-/]/g, "");
}

/**
 * topic:<sha8(sorted-member-ids)>
 *
 * Accepts the real cluster membership (`memberIds: string[]`).
 * Hashing is enforced INSIDE so determinism is in code, not caller guidance.
 * The sorted-join is done here; caller order does not affect the output (SC-11).
 * The LLM display name is a label only; the ID is derived from membership.
 *
 * Usage by K4 taxonomy-build:
 *   const id = makeTopicId(["file:src/a.ts", "function:src/a.ts:foo"]);
 */
export function makeTopicId(memberIds: string[]): string {
  const sorted = [...memberIds].sort();
  return `topic:${sha8Hash(sorted.join("|"))}`;
}

/**
 * claim:<path#anchor>:<sha8(normalizedText + NUL + anchor)>
 *
 * Hashing is enforced INSIDE so two distinct claims at the same anchor
 * produce distinct IDs (SC-11), and same inputs always produce the same ID.
 * `text` is normalized to lowercase-trimmed before hashing.
 */
export function makeClaimId(anchor: string, text: string): string {
  const normalized = text.trim().toLowerCase();
  return `claim:${anchor}:${sha8Hash(normalized + "\x00" + anchor)}`;
}

/**
 * entity:<normalized-name>
 * Normalization: lowercase, spaces → hyphens, non-alnum stripped.
 */
export function makeEntityId(name: string): string {
  return `entity:${normalizeEntityName(name)}`;
}

/**
 * wiki_page:<relpath>
 * relpath is repo-relative path to the markdown file.
 */
export function makeWikiPageId(relpath: string): string {
  return `wiki_page:${relpath}`;
}

/**
 * diagram:<path#mermaid-N|svg>
 * anchor = path#mermaid-N for fenced blocks, or path for .svg files.
 */
export function makeDiagramId(anchor: string): string {
  return `diagram:${anchor}`;
}

/**
 * concept:<path#anchor>:<sha8(normalizedText + NUL + anchor)>
 *
 * Hashing is enforced INSIDE so two distinct concepts at the same anchor
 * produce distinct IDs (SC-11), and same inputs always produce the same ID.
 * `text` is normalized to lowercase-trimmed before hashing.
 */
export function makeConceptId(anchor: string, text: string): string {
  const normalized = text.trim().toLowerCase();
  return `concept:${anchor}:${sha8Hash(normalized + "\x00" + anchor)}`;
}

/**
 * Compute an 8-char SHA-256 hex digest of a string.
 * Used for dedup keys in topic/claim/concept IDs.
 *
 * For claim/concept IDs, callers should hash (normalizedText + "\x00" + anchor)
 * to avoid collisions at the same anchor.
 * For topic IDs, callers should hash the sorted member-node-id set joined by "|".
 */
export function sha8Hash(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex").slice(0, 8);
}

// Back-compat alias (tests may call sha8 directly; keep both exported).
export const sha8 = sha8Hash;

// ---------------------------------------------------------------------------
// v1 — alias tables (forked from Understand-Anything, MIT)
// ---------------------------------------------------------------------------

export const DIRECTIONS = new Set(["out", "in", "bi"]);
export const CONFIDENCE = new Set(["high", "medium", "low"]);

// ---- Forked alias tables (Understand-Anything, MIT). DATA, not logic. ----

export const NODE_TYPE_ALIASES: Record<string, string> = {
  func: "function", fn: "function", method: "function",
  interface: "class", struct: "class",
  mod: "module", pkg: "module", package: "module",
  container: "service", deployment: "service", pod: "service",
  doc: "document", readme: "document", docs: "document",
  job: "pipeline", ci: "pipeline",
  route: "endpoint", api: "endpoint", query: "endpoint", mutation: "endpoint",
  setting: "config", env: "config", configuration: "config",
  infra: "resource", infrastructure: "resource", terraform: "resource",
  migration: "table", database: "table", db: "table", view: "table",
  proto: "schema", protobuf: "schema", definition: "schema", typedef: "schema",
  business_domain: "domain", business_flow: "flow", business_process: "flow",
  task: "step", business_step: "step",
  note: "article", page: "article",
  // v1 alias: wiki_page → article (v1 read path ONLY; v2 makes wiki_page first-class)
  wiki_page: "article",
  person: "entity", actor: "entity", organization: "entity",
  tag: "topic", category: "topic", theme: "topic",
  assertion: "claim", decision: "claim", thesis: "claim",
  reference: "source", raw: "source", paper: "source",
};

export const EDGE_TYPE_ALIASES: Record<string, string> = {
  extends: "inherits", invokes: "calls", invoke: "calls",
  uses: "depends_on", requires: "depends_on",
  relates_to: "related", related_to: "related", similar: "similar_to",
  import: "imports", export: "exports", contain: "contains",
  publish: "publishes", subscribe: "subscribes",
  describes: "documents", documented_by: "documents",
  creates: "provisions", exposes: "serves", listens: "serves",
  deploys_to: "deploys", migrates_to: "migrates", routes_to: "routes",
  triggers_on: "triggers", fires: "triggers", defines: "defines_schema",
  has_flow: "contains_flow", next_step: "flow_step", interacts_with: "cross_domain",
  references: "cites", cites_source: "cites",
  conflicts_with: "contradicts", disagrees_with: "contradicts",
  refines: "builds_on", elaborates: "builds_on",
  illustrates: "exemplifies", instance_of: "exemplifies", example_of: "exemplifies",
  belongs_to: "categorized_under", tagged_with: "categorized_under",
  written_by: "authored_by", created_by: "authored_by",
  // NOTE (LOCKED invariant): "implemented_by" is intentionally NOT aliased —
  // aliasing it to "implements" would invert edge direction.
};

export const DIRECTION_ALIASES: Record<string, string> = {
  // Frozen Guild direction enum is out|in|bi (NOT UA's forward/backward/...).
  forward: "out", outbound: "out", to: "out", out_: "out",
  backward: "in", inbound: "in", from: "in",
  bidirectional: "bi", both: "bi", mutual: "bi", "bi-directional": "bi",
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GraphNode {
  id: string;
  type: string;
  name: string;
  source_refs: string[];
  confidence: "high" | "medium" | "low";
  // v2 optional fields on knowledge nodes
  category?: string;
  importance?: string;
  importance_score?: number;
  topic_path?: string[];
  labels?: string[];
  [k: string]: unknown; // additive optional keys (lenient-reader rule)
}
export interface GraphEdge {
  source: string;
  target: string;
  type: string;
  direction: "out" | "in" | "bi";
  weight: number;
  description?: string;
  [k: string]: unknown;
}
export interface Layer {
  id: string;
  name: string;
  description: string;
  nodeIds: string[];
}
export interface TourStep {
  order: number;
  title: string;
  description: string;
  nodeIds: string[];
  languageLesson?: string;
}
export interface KnowledgeGraph {
  version: string;
  kind?: "codebase" | "knowledge";
  generated_from_commit: string;
  project: { name: string; description: string };
  nodes: GraphNode[];
  edges: GraphEdge[];
  layers: Layer[];
  tour: TourStep[];
  [k: string]: unknown;
}

export interface GraphIssue {
  level: "auto-corrected" | "dropped" | "fatal";
  category: string;
  message: string;
}
export interface ValidationResult {
  success: boolean;
  data?: KnowledgeGraph;
  issues: GraphIssue[];
  fatal?: string;
}

// ---------------------------------------------------------------------------
// v1 Tier 1: sanitize
// ---------------------------------------------------------------------------

function sanitize(d: Record<string, unknown>): Record<string, unknown> {
  const r: Record<string, unknown> = { ...d };
  if (d.tour == null) r.tour = [];
  if (d.layers == null) r.layers = [];
  if (d.edges == null) r.edges = [];
  if (Array.isArray(d.nodes)) {
    r.nodes = (d.nodes as Record<string, unknown>[]).map((n) => {
      if (typeof n !== "object" || n === null) return n;
      const x = { ...n };
      if (x.source_refs === null) delete x.source_refs;
      if (x.confidence === null) delete x.confidence;
      if (typeof x.type === "string") x.type = x.type.toLowerCase();
      return x;
    });
  }
  if (Array.isArray(d.edges)) {
    r.edges = (d.edges as Record<string, unknown>[]).map((e) => {
      if (typeof e !== "object" || e === null) return e;
      const x = { ...e };
      if (x.description === null) delete x.description;
      if (typeof x.type === "string") x.type = x.type.toLowerCase();
      if (typeof x.direction === "string") x.direction = x.direction.toLowerCase();
      return x;
    });
  }
  return r;
}

// ---------------------------------------------------------------------------
// v1 Tier 2: normalize aliases
// ---------------------------------------------------------------------------

function normalize(d: Record<string, unknown>): Record<string, unknown> {
  const r = { ...d };
  if (Array.isArray(d.nodes)) {
    r.nodes = (d.nodes as any[]).map((n) =>
      n && typeof n.type === "string" && n.type in NODE_TYPE_ALIASES
        ? { ...n, type: NODE_TYPE_ALIASES[n.type] }
        : n,
    );
  }
  if (Array.isArray(d.edges)) {
    r.edges = (d.edges as any[]).map((e) => {
      if (!e || typeof e !== "object") return e;
      let x = e;
      if (typeof e.type === "string" && e.type in EDGE_TYPE_ALIASES) {
        x = { ...x, type: EDGE_TYPE_ALIASES[e.type] };
      }
      if (typeof x.direction === "string" && x.direction in DIRECTION_ALIASES) {
        x = { ...x, direction: DIRECTION_ALIASES[x.direction] };
      }
      return x;
    });
  }
  return r;
}

// ---------------------------------------------------------------------------
// v1 Tier 3: auto-fix defaults
// ---------------------------------------------------------------------------

function autoFix(d: Record<string, unknown>): { data: Record<string, unknown>; issues: GraphIssue[] } {
  const issues: GraphIssue[] = [];
  const r = { ...d };
  if (Array.isArray(d.nodes)) {
    r.nodes = (d.nodes as Record<string, unknown>[]).map((n, i) => {
      if (typeof n !== "object" || n === null) return n;
      const x = { ...n };
      const label = (x.name as string) || (x.id as string) || `index ${i}`;
      if (!x.type || typeof x.type !== "string") {
        x.type = "file";
        issues.push({ level: "auto-corrected", category: "missing-field", message: `nodes[${i}] ("${label}"): type defaulted to "file"` });
      }
      if (!Array.isArray(x.source_refs)) {
        x.source_refs = [];
        issues.push({ level: "auto-corrected", category: "missing-field", message: `nodes[${i}] ("${label}"): source_refs defaulted to []` });
      }
      if (typeof x.confidence !== "string" || !CONFIDENCE.has(x.confidence as string)) {
        x.confidence = "low";
        issues.push({ level: "auto-corrected", category: "missing-field", message: `nodes[${i}] ("${label}"): confidence defaulted to "low"` });
      }
      if (typeof x.name !== "string" || x.name === "") {
        x.name = (x.id as string) || `node-${i}`;
        issues.push({ level: "auto-corrected", category: "missing-field", message: `nodes[${i}]: name defaulted to id` });
      }
      return x;
    });
  }
  if (Array.isArray(d.edges)) {
    r.edges = (d.edges as Record<string, unknown>[]).map((e, i) => {
      if (typeof e !== "object" || e === null) return e;
      const x = { ...e };
      if (!x.type || typeof x.type !== "string") {
        x.type = "depends_on";
        issues.push({ level: "auto-corrected", category: "missing-field", message: `edges[${i}]: type defaulted to "depends_on"` });
      }
      if (typeof x.direction !== "string" || !DIRECTIONS.has(x.direction as string)) {
        x.direction = "out";
        issues.push({ level: "auto-corrected", category: "missing-field", message: `edges[${i}]: direction defaulted to "out"` });
      }
      if (x.weight === undefined || x.weight === null) {
        x.weight = 0.5;
        issues.push({ level: "auto-corrected", category: "missing-field", message: `edges[${i}]: weight defaulted to 0.5` });
      } else if (typeof x.weight === "string") {
        const p = parseFloat(x.weight as string);
        x.weight = isNaN(p) ? 0.5 : p;
        issues.push({ level: "auto-corrected", category: "type-coercion", message: `edges[${i}]: weight coerced from string` });
      }
      if (typeof x.weight === "number" && (x.weight < 0 || x.weight > 1)) {
        const o = x.weight;
        x.weight = Math.max(0, Math.min(1, x.weight as number));
        issues.push({ level: "auto-corrected", category: "out-of-range", message: `edges[${i}]: weight ${o} clamped to ${x.weight}` });
      }
      return x;
    });
  }
  return { data: r, issues };
}

// ---------------------------------------------------------------------------
// v1 Tier 4: validate + drop (the existing validateGraph — unchanged)
// ---------------------------------------------------------------------------

export function validateGraph(input: unknown): ValidationResult {
  if (typeof input !== "object" || input === null) {
    return { success: false, issues: [], fatal: "Invalid input: not an object" };
  }
  const sanitized = sanitize(input as Record<string, unknown>);
  const normalized = normalize(sanitized);
  const { data: fixed, issues } = autoFix(normalized);

  for (const c of ["nodes", "edges", "layers", "tour"]) {
    if (c in fixed && fixed[c] !== undefined && !Array.isArray(fixed[c])) {
      return { success: false, issues, fatal: `"${c}" must be an array when present` };
    }
  }
  const project = fixed.project as Record<string, unknown> | undefined;
  if (!project || typeof project !== "object" || typeof project.name !== "string") {
    return { success: false, issues, fatal: "Missing or invalid project metadata" };
  }

  const validNodes: GraphNode[] = [];
  for (let i = 0; i < (fixed.nodes as unknown[] ?? []).length; i++) {
    const n = (fixed.nodes as Record<string, unknown>[])[i];
    if (n && typeof n.id === "string" && typeof n.type === "string" && NODE_TYPES.has(n.type) && typeof n.name === "string") {
      validNodes.push(n as unknown as GraphNode);
    } else {
      issues.push({ level: "dropped", category: "invalid-node", message: `nodes[${i}]: invalid (id/type/name) — removed` });
    }
  }
  if (validNodes.length === 0) {
    return { success: false, issues, fatal: "No valid nodes found in knowledge graph" };
  }

  const ids = new Set(validNodes.map((n) => n.id));
  const validEdges: GraphEdge[] = [];
  for (let i = 0; i < (fixed.edges as unknown[] ?? []).length; i++) {
    const e = (fixed.edges as Record<string, unknown>[])[i];
    if (!e || typeof e.source !== "string" || typeof e.target !== "string") {
      issues.push({ level: "dropped", category: "invalid-edge", message: `edges[${i}]: missing source/target — removed` });
      continue;
    }
    if (typeof e.type !== "string" || !EDGE_TYPES.has(e.type)) {
      issues.push({ level: "dropped", category: "invalid-edge", message: `edges[${i}]: unknown type "${e.type}" — removed` });
      continue;
    }
    if (!ids.has(e.source as string)) {
      issues.push({ level: "dropped", category: "invalid-reference", message: `edges[${i}]: source "${e.source}" not in nodes — removed` });
      continue;
    }
    if (!ids.has(e.target as string)) {
      issues.push({ level: "dropped", category: "invalid-reference", message: `edges[${i}]: target "${e.target}" not in nodes — removed` });
      continue;
    }
    validEdges.push(e as unknown as GraphEdge);
  }

  const validLayers: Layer[] = [];
  for (let i = 0; i < (fixed.layers as unknown[] ?? []).length; i++) {
    const l = (fixed.layers as Record<string, unknown>[])[i];
    if (l && typeof l.id === "string" && typeof l.name === "string" && Array.isArray(l.nodeIds)) {
      validLayers.push({
        id: l.id as string,
        name: l.name as string,
        description: typeof l.description === "string" ? l.description : "",
        nodeIds: (l.nodeIds as string[]).filter((x) => ids.has(x)),
      });
    } else {
      issues.push({ level: "dropped", category: "invalid-layer", message: `layers[${i}]: invalid — removed` });
    }
  }

  const validTour: TourStep[] = [];
  for (let i = 0; i < (fixed.tour as unknown[] ?? []).length; i++) {
    const t = (fixed.tour as Record<string, unknown>[])[i];
    if (t && typeof t.title === "string" && Array.isArray(t.nodeIds)) {
      validTour.push({
        order: typeof t.order === "number" ? t.order : i,
        title: t.title as string,
        description: typeof t.description === "string" ? t.description : "",
        nodeIds: (t.nodeIds as string[]).filter((x) => ids.has(x)),
        ...(typeof t.languageLesson === "string" ? { languageLesson: t.languageLesson } : {}),
      });
    } else {
      issues.push({ level: "dropped", category: "invalid-tour-step", message: `tour[${i}]: invalid — removed` });
    }
  }

  const graph: KnowledgeGraph = {
    version: typeof fixed.version === "string" ? fixed.version : "guild.knowledge_graph.v1",
    ...(fixed.kind === "knowledge" || fixed.kind === "codebase" ? { kind: fixed.kind } : { kind: "codebase" }),
    generated_from_commit:
      typeof fixed.generated_from_commit === "string" ? fixed.generated_from_commit : "unknown",
    project: {
      name: project.name as string,
      description: typeof project.description === "string" ? project.description : "",
    },
    nodes: validNodes,
    edges: validEdges,
    layers: validLayers,
    tour: validTour,
  };
  return { success: true, data: graph, issues };
}

// ---------------------------------------------------------------------------
// v2 validator options
// ---------------------------------------------------------------------------

export interface ValidateGraphV2Options {
  /**
   * Repo root for anchor resolution (SC-12). The validator resolves every
   * knowledge-node anchor against the working tree at this path (assumption:
   * caller ensures tree matches generated_from_commit; documented below).
   *
   * Assumption: anchor resolution is performed against the working tree at
   * `repoRoot`. The caller is responsible for ensuring this tree corresponds
   * to `generated_from_commit`. A full commit-checkout per-validation is
   * deliberately avoided (prohibitively expensive); the assumption is safe
   * for the primary production caller (the K6 write path runs immediately
   * after building the graph from the current tree).
   */
  repoRoot: string;
  /**
   * Knowledge config overrides. Falls back to KNOWLEDGE_CONFIG_DEFAULTS.
   */
  config?: Partial<KnowledgeConfig>;
}

// ---------------------------------------------------------------------------
// v2 internal: anchor resolution (SC-12, per-form)
// ---------------------------------------------------------------------------

/** The set of knowledge node types that require both category and anchor. */
const KNOWLEDGE_NODE_TYPES_V2 = new Set([
  "topic", "concept", "claim", "entity", "wiki_page", "diagram",
]);

/** Extract the file path from an anchor (strips #fragment). */
function anchorToPath(anchor: string): string {
  const hashIdx = anchor.indexOf("#");
  return hashIdx === -1 ? anchor : anchor.slice(0, hashIdx);
}

/**
 * Parse the fragment part of an anchor.
 * Returns undefined when no fragment present.
 */
function anchorFragment(anchor: string): string | undefined {
  const hashIdx = anchor.indexOf("#");
  return hashIdx === -1 ? undefined : anchor.slice(hashIdx + 1);
}

/**
 * Resolve a per-form anchor against the working tree at repoRoot.
 *
 * Forms handled:
 *   path#Lx-Ly          code line-range: check line range exists in file
 *   path#heading-slug   doc/wiki heading: check slug appears as a heading
 *   path#mermaid-N      diagram: check Nth fenced mermaid block exists
 *   path#svg            diagram: check file is an .svg
 *   path                bare file reference (no fragment): check file exists
 *
 * Returns true iff the anchor resolves. Reads file content once per anchor.
 *
 * Assumption (documented in ValidateGraphV2Options.repoRoot): resolution is
 * against the working tree — caller must ensure it matches generated_from_commit.
 */
function resolveAnchor(repoRoot: string, anchor: string): boolean {
  if (!anchor || typeof anchor !== "string") return false;
  const relPath = anchorToPath(anchor);
  if (!relPath) return false;

  const absPath = path.resolve(repoRoot, relPath);
  try {
    if (!fs.existsSync(absPath)) return false;
  } catch {
    return false;
  }

  const fragment = anchorFragment(anchor);
  if (!fragment) {
    // Bare file reference — existence check suffices.
    return true;
  }

  // Read file content for fragment forms.
  let content: string;
  try {
    content = fs.readFileSync(absPath, "utf8");
  } catch {
    return false;
  }

  // Form: path#svg — the file must be a valid SVG (contains a root <svg ...> element).
  // Extension alone is insufficient; we check for a <svg start in the content.
  if (fragment === "svg") {
    // Must be an .svg file whose content contains a root SVG element.
    if (!relPath.toLowerCase().endsWith(".svg")) return false;
    return /<svg[\s>]/i.test(content);
  }

  // Form: path#<element-id> — SVG fragment: element with id="<fragment>" must exist.
  // This form only applies to .svg files (HTML id-based fragments in SVG).
  if (relPath.toLowerCase().endsWith(".svg")) {
    // Check for id="<fragment>" or id='<fragment>' attribute in the SVG content.
    const idPattern = new RegExp(`\\bid=["']${fragment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`);
    return idPattern.test(content);
  }

  // Form: path#Lx-Ly — code line range
  const lineRangeMatch = fragment.match(/^L(\d+)-L(\d+)$/);
  if (lineRangeMatch) {
    const start = parseInt(lineRangeMatch[1], 10);
    const end = parseInt(lineRangeMatch[2], 10);
    const lines = content.split("\n");
    const lineCount = lines.length;
    // Lines are 1-indexed; check both endpoints exist and range is valid
    return start >= 1 && end >= start && end <= lineCount;
  }

  // Form: path#mermaid-N — Nth fenced mermaid block
  const mermaidMatch = fragment.match(/^mermaid-(\d+)$/);
  if (mermaidMatch) {
    const idx = parseInt(mermaidMatch[1], 10);
    // Count fenced ```mermaid blocks (0-indexed)
    let count = 0;
    const mermaidFenceRe = /^```mermaid\b/m;
    let searchStart = 0;
    while (true) {
      const found = content.indexOf("```mermaid", searchStart);
      if (found === -1) break;
      if (count === idx) return true;
      count++;
      searchStart = found + 1;
    }
    return false;
  }

  // Form: path#heading-slug — heading slug (doc/wiki)
  // A heading slug is the lowercase, hyphenated form of a markdown heading.
  // We check that the file contains a heading whose slug matches.
  // Slug derivation: lowercase, strip punctuation except hyphens, spaces→hyphens.
  const headingRe = /^#{1,6}\s+(.+)$/gm;
  let match: RegExpExecArray | null;
  while ((match = headingRe.exec(content)) !== null) {
    const raw = match[1].trim();
    const slug = raw
      .toLowerCase()
      .replace(/[^\w\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
    if (slug === fragment) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// v2 internal: subtopic_of graph invariants (Blocker 1 + 2)
// ---------------------------------------------------------------------------

/**
 * Validate the subtopic_of graph:
 *   - Each topic has AT MOST ONE parent (tree invariant; multi-parent rejected).
 *   - The graph is acyclic.
 *   - All depths <= maxDepth.
 *   - All fan-outs <= maxBranching.
 *
 * Returns an error message string, or null if all invariants hold.
 * "Multi-parent" policy: REJECT (per tree contract; the spec has no DAG support).
 */
function validateSubtopicGraph(
  edges: GraphEdge[],
  nodeIds: Set<string>,
  maxDepth: number,
  maxBranching: number,
): string | null {
  // Build adjacency structures over ALL subtopic_of edges.
  // childToParents: child → Set<parent> (detect multi-parent)
  // parentToChildren: parent → Set<child> (fan-out)
  const childToParents = new Map<string, Set<string>>();
  const parentToChildren = new Map<string, Set<string>>();

  for (const e of edges) {
    if (e.type !== "subtopic_of") continue;
    if (!nodeIds.has(e.source) || !nodeIds.has(e.target)) continue;

    if (!childToParents.has(e.source)) childToParents.set(e.source, new Set());
    childToParents.get(e.source)!.add(e.target);

    if (!parentToChildren.has(e.target)) parentToChildren.set(e.target, new Set());
    parentToChildren.get(e.target)!.add(e.source);
  }

  // Reject multi-parent (tree invariant)
  for (const [child, parents] of childToParents.entries()) {
    if (parents.size > 1) {
      return `subtopic_of multi-parent violation: node "${child}" has ${parents.size} parents [${[...parents].sort().join(", ")}] — tree contract requires exactly one parent (SC-2)`;
    }
  }

  // Build a simple child→parent map now that we've confirmed at most 1 parent per child
  const childToParent = new Map<string, string>();
  for (const [child, parents] of childToParents.entries()) {
    childToParent.set(child, [...parents][0]);
  }

  // Check fan-out (>maxBranching children under one parent)
  for (const [parentId, children] of parentToChildren.entries()) {
    if (children.size > maxBranching) {
      return `subtopic_of fan-out violation: node "${parentId}" has ${children.size} children, exceeding maxBranching ${maxBranching} (SC-2)`;
    }
  }

  // Cycle detection via DFS over the (now single-parent) tree
  const visited = new Set<string>();
  const inStack = new Set<string>();

  function hasCycle(nodeId: string): boolean {
    if (inStack.has(nodeId)) return true;
    if (visited.has(nodeId)) return false;
    inStack.add(nodeId);
    const parent = childToParent.get(nodeId);
    if (parent && nodeIds.has(parent)) {
      if (hasCycle(parent)) return true;
    }
    inStack.delete(nodeId);
    visited.add(nodeId);
    return false;
  }

  for (const id of nodeIds) {
    if (!visited.has(id)) {
      if (hasCycle(id)) {
        return `subtopic_of cycle detected — v2 invariant violation (SC-2)`;
      }
    }
  }

  // Depth check (max depth over all nodes)
  const depths = new Map<string, number>();

  function getDepth(nodeId: string, callStack: Set<string>): number {
    if (depths.has(nodeId)) return depths.get(nodeId)!;
    if (callStack.has(nodeId)) return 0; // cycle guard (already checked above)
    const parent = childToParent.get(nodeId);
    if (!parent || !nodeIds.has(parent)) {
      depths.set(nodeId, 0);
      return 0;
    }
    callStack.add(nodeId);
    const d = getDepth(parent, callStack) + 1;
    callStack.delete(nodeId);
    depths.set(nodeId, d);
    return d;
  }

  for (const id of nodeIds) {
    const d = getDepth(id, new Set());
    if (d > maxDepth) {
      return `subtopic_of depth ${d} exceeds maxDepth ${maxDepth} at node "${id}" — SC-2 violation`;
    }
  }

  return null; // all invariants hold
}

// ---------------------------------------------------------------------------
// v2 internal: canonical sort for SC-11 determinism
// ---------------------------------------------------------------------------

/**
 * Sort nodes by ID string for canonical (input-order-independent) dedup.
 * "First wins" after sorting means the winner is the lexicographically smallest
 * ID — deterministic regardless of input order (SC-11).
 */
function canonicalSortNodes(nodes: Record<string, unknown>[]): Record<string, unknown>[] {
  return [...nodes].sort((a, b) => {
    const aid = typeof a.id === "string" ? a.id : "";
    const bid = typeof b.id === "string" ? b.id : "";
    return aid < bid ? -1 : aid > bid ? 1 : 0;
  });
}

/**
 * Sort edges by canonical key (type|source|target) for SC-11 dedup determinism.
 */
function canonicalSortEdges(edges: Record<string, unknown>[]): Record<string, unknown>[] {
  return [...edges].sort((a, b) => {
    const ak = `${a.type ?? ""}|${a.source ?? ""}|${a.target ?? ""}`;
    const bk = `${b.type ?? ""}|${b.source ?? ""}|${b.target ?? ""}`;
    return ak < bk ? -1 : ak > bk ? 1 : 0;
  });
}

// ---------------------------------------------------------------------------
// v2 validator — the full v2 invariant ladder
// ---------------------------------------------------------------------------

/**
 * validateGraphV2 — the v2 validator for guild.knowledge_graph.v2 graphs.
 *
 * v1/v2 boundary:
 *   - v1 graphs (version != "guild.knowledge_graph.v2") are routed to the
 *     v1 validateGraph (read-only, NO v2 invariants applied).
 *   - Only v2-written graphs receive v2 validation.
 *   - The writer always emits "guild.knowledge_graph.v2".
 *
 * Invariant checks (v2 only):
 *   1. Version dispatch: non-v2 input → v1 validateGraph, return immediately.
 *   2. Category REQUIRED on knowledge nodes (topic/concept/claim/entity/wiki_page/diagram);
 *      out-of-enum values → node dropped (SC-6).
 *   3. importance_score REQUIRED on topic nodes; missing → fatal.
 *      Topics with importance_score < minTopicImportance → dropped (SC-2).
 *   4. Anchor resolution MANDATORY: every node's source_refs must be non-empty
 *      for knowledge nodes; every ref must resolve per-form (SC-12).
 *      evidenced_by target's anchor must also resolve (SC-4 global).
 *   5. subtopic_of TREE invariants: single-parent, acyclic, depth ≤ maxDepth,
 *      fan-out ≤ maxBranching — all FATAL (SC-2).
 *   6. flow_step non-monotone → FATAL (v2 declared invariant, E2 must-fix).
 *   7. file-in-EXACTLY-one-layer: zero layers → fatal; duplicate → dropped (SC layer contract).
 *   8. SC-11: canonical sort before dedup so output is byte-identical regardless
 *      of input order; nodes deduped by ID, edges by type|source|target (first wins).
 */
export function validateGraphV2(
  input: unknown,
  opts: ValidateGraphV2Options,
): ValidationResult {
  // ── Version dispatch (MAJOR fix): non-v2 graphs route to v1 validator ──────
  if (typeof input === "object" && input !== null) {
    const raw = input as Record<string, unknown>;
    if (raw.version !== "guild.knowledge_graph.v2") {
      // v1 graph: pass through to the v1 tolerant ladder, no v2 invariants.
      return validateGraph(input);
    }
  }

  const cfg: KnowledgeConfig = { ...KNOWLEDGE_CONFIG_DEFAULTS, ...(opts.config ?? {}) };
  const { repoRoot } = opts;

  if (typeof input !== "object" || input === null) {
    return { success: false, issues: [], fatal: "Invalid input: not an object" };
  }

  const raw = input as Record<string, unknown>;

  // ── Sanitize (v2: same as v1 but NO node-type alias normalizer) ─────────────
  const sanitized = sanitize(raw);

  // ── Edge alias normalize (v2: only for edge types NOT already in EDGE_TYPES_V2) ─
  // In v2, `defines` is first-class (not aliased to defines_schema), and
  // `relates_to` is first-class (not aliased to related). The v1 alias table
  // maps both, so we skip aliases for v2-native edge types.
  const r = { ...sanitized };
  if (Array.isArray(sanitized.edges)) {
    r.edges = (sanitized.edges as any[]).map((e) => {
      if (!e || typeof e !== "object") return e;
      let x = e;
      if (typeof e.type === "string" && !EDGE_TYPES_V2.has(e.type) && e.type in EDGE_TYPE_ALIASES) {
        x = { ...x, type: EDGE_TYPE_ALIASES[e.type] };
      }
      if (typeof x.direction === "string" && x.direction in DIRECTION_ALIASES) {
        x = { ...x, direction: DIRECTION_ALIASES[x.direction] };
      }
      return x;
    });
  }

  // ── auto-fix defaults ────────────────────────────────────────────────────────
  const { data: fixed, issues } = autoFix(r);

  // ── Basic structural checks ──────────────────────────────────────────────────
  for (const c of ["nodes", "edges", "layers", "tour"]) {
    if (c in fixed && fixed[c] !== undefined && !Array.isArray(fixed[c])) {
      return { success: false, issues, fatal: `"${c}" must be an array when present` };
    }
  }
  const project = fixed.project as Record<string, unknown> | undefined;
  if (!project || typeof project !== "object" || typeof project.name !== "string") {
    return { success: false, issues, fatal: "Missing or invalid project metadata" };
  }

  // ── SC-11: canonical sort before dedup (input-order-independent) ────────────
  const sortedRawNodes = canonicalSortNodes(
    Array.isArray(fixed.nodes) ? (fixed.nodes as Record<string, unknown>[]) : []
  );
  const sortedRawEdges = canonicalSortEdges(
    Array.isArray(fixed.edges) ? (fixed.edges as Record<string, unknown>[]) : []
  );

  // ── Node validation (v2 closed set + category required + anchor mandatory) ──
  const seenNodeIds = new Set<string>();
  const validNodes: GraphNode[] = [];

  for (let i = 0; i < sortedRawNodes.length; i++) {
    const n = sortedRawNodes[i];
    if (!n || typeof n.id !== "string" || typeof n.type !== "string" || typeof n.name !== "string") {
      issues.push({ level: "dropped", category: "invalid-node", message: `node at sorted-index ${i}: invalid (id/type/name) — removed` });
      continue;
    }
    if (!NODE_TYPES_V2.has(n.type)) {
      issues.push({ level: "dropped", category: "invalid-node", message: `node "${n.id}": unknown type "${n.type}" for v2 — removed` });
      continue;
    }

    // SC-11: dedup by ID after canonical sort (first = lexicographically smallest)
    if (seenNodeIds.has(n.id)) {
      issues.push({ level: "dropped", category: "duplicate-node", message: `node "${n.id}": duplicate id — removed (canonical-first wins)` });
      continue;
    }

    const isKnowledgeNode = KNOWLEDGE_NODE_TYPES_V2.has(n.type);

    // SC-6: category REQUIRED on knowledge nodes
    if (isKnowledgeNode) {
      if (n.category === undefined || n.category === null) {
        issues.push({ level: "dropped", category: "missing-category", message: `node "${n.id}" (${n.type}): category is required on v2 knowledge nodes — removed` });
        continue;
      }
      if (typeof n.category !== "string" || !NODE_CATEGORIES.has(n.category as string)) {
        issues.push({ level: "dropped", category: "invalid-category", message: `node "${n.id}" (${n.type}): invalid category "${n.category}" — removed` });
        continue;
      }
    }

    // SC-2: topic nodes MUST have a numeric importance_score
    if (n.type === "topic") {
      if (typeof n.importance_score !== "number") {
        issues.push({ level: "dropped", category: "missing-importance-score", message: `topic node "${n.id}": importance_score (numeric 0-1) is required on topic nodes — removed` });
        continue;
      }
      if (n.importance_score < cfg.minTopicImportance) {
        issues.push({ level: "dropped", category: "below-importance-threshold", message: `topic node "${n.id}": importance_score ${n.importance_score} < minTopicImportance ${cfg.minTopicImportance} — removed (SC-2)` });
        continue;
      }
    }

    // SC-12: anchor resolution MANDATORY for knowledge nodes.
    // All source_refs must resolve per-form; zero source_refs on a knowledge node = invalid.
    if (isKnowledgeNode) {
      const refs = Array.isArray(n.source_refs) ? (n.source_refs as string[]) : [];
      if (refs.length === 0) {
        issues.push({ level: "dropped", category: "missing-anchor", message: `node "${n.id}" (${n.type}): knowledge nodes require at least one source_ref anchor — removed (SC-12)` });
        continue;
      }
      let allResolved = true;
      for (const ref of refs) {
        if (!resolveAnchor(repoRoot, ref)) {
          allResolved = false;
          issues.push({ level: "dropped", category: "unresolvable-anchor", message: `node "${n.id}": anchor "${ref}" does not resolve at repoRoot — SC-12 violation` });
        }
      }
      if (!allResolved) {
        // Every source_ref must resolve — a node with any broken anchor is rejected (SC-12).
        continue;
      }
    }

    seenNodeIds.add(n.id);
    validNodes.push(n as unknown as GraphNode);
  }

  if (validNodes.length === 0) {
    return { success: false, issues, fatal: "No valid nodes found in knowledge graph" };
  }

  const nodeIds = new Set(validNodes.map((n) => n.id));

  // Build a lookup from node id → node for anchor resolution of evidenced_by targets
  const nodeById = new Map<string, GraphNode>();
  for (const node of validNodes) {
    nodeById.set(node.id, node);
  }

  // ── Edge validation (v2 closed set + dedup + SC-4 anchor check) ─────────────
  const seenEdgeKeys = new Set<string>();
  const validEdges: GraphEdge[] = [];

  for (let i = 0; i < sortedRawEdges.length; i++) {
    const e = sortedRawEdges[i];
    if (!e || typeof e.source !== "string" || typeof e.target !== "string") {
      issues.push({ level: "dropped", category: "invalid-edge", message: `edge at sorted-index ${i}: missing source/target — removed` });
      continue;
    }
    if (typeof e.type !== "string" || !EDGE_TYPES_V2.has(e.type)) {
      issues.push({ level: "dropped", category: "invalid-edge", message: `edge "${e.type}|${e.source}|${e.target}": unknown type for v2 — removed` });
      continue;
    }
    if (!nodeIds.has(e.source as string)) {
      issues.push({ level: "dropped", category: "invalid-reference", message: `edge "${e.type}|${e.source}|${e.target}": source not in nodes — removed` });
      continue;
    }
    if (!nodeIds.has(e.target as string)) {
      const label = e.type === "evidenced_by" ? " (SC-4)" : "";
      issues.push({ level: "dropped", category: "invalid-reference", message: `edge "${e.type}|${e.source}|${e.target}": target not in nodes — removed${label}` });
      continue;
    }

    // SC-4 global: evidenced_by target's artifact anchor must also resolve
    if (e.type === "evidenced_by") {
      const targetNode = nodeById.get(e.target as string);
      if (targetNode) {
        const refs = Array.isArray(targetNode.source_refs) ? (targetNode.source_refs as string[]) : [];
        let targetAnchorResolved = refs.length === 0; // non-knowledge nodes (file/function) have no required anchor; treat as resolved
        if (KNOWLEDGE_NODE_TYPES_V2.has(targetNode.type)) {
          // Target is a knowledge node — at least one ref must resolve
          targetAnchorResolved = refs.some((ref) => resolveAnchor(repoRoot, ref));
        } else {
          // Target is a code node (file/function/class etc.) — check first ref if present
          if (refs.length > 0) {
            targetAnchorResolved = resolveAnchor(repoRoot, refs[0]);
          } else {
            targetAnchorResolved = true; // file nodes without refs are already validated by v1
          }
        }
        if (!targetAnchorResolved) {
          issues.push({ level: "dropped", category: "evidenced-by-anchor-broken", message: `edge evidenced_by target "${e.target}": no source_ref resolves at repoRoot — removed (SC-4 global)` });
          continue;
        }
      }
    }

    // SC-11: dedup edges by type|source|target after canonical sort
    const eKey = `${e.type}|${e.source}|${e.target}`;
    if (seenEdgeKeys.has(eKey)) {
      issues.push({ level: "dropped", category: "duplicate-edge", message: `edge "${eKey}": duplicate — removed (canonical-first wins)` });
      continue;
    }

    seenEdgeKeys.add(eKey);
    validEdges.push(e as unknown as GraphEdge);
  }

  // ── SC-2: subtopic_of graph invariants (FATAL) ───────────────────────────────
  const subtopicErr = validateSubtopicGraph(validEdges, nodeIds, cfg.maxDepth, cfg.maxBranching);
  if (subtopicErr !== null) {
    return {
      success: false,
      issues: [...issues, { level: "fatal", category: "invariant-violation", message: subtopicErr }],
      fatal: subtopicErr,
    };
  }

  // ── flow_step monotone invariant — FATAL on v2 (E2 must-fix) ─────────────────
  // Monotone = weights non-decreasing in the order edges appear (after canonical sort).
  // A graph is free to have flow_step edges across multiple independent flows;
  // we check the global sequence as emitted (the writer must emit them in order).
  const flowStepEdges = validEdges.filter((e) => e.type === "flow_step");
  if (flowStepEdges.length > 1) {
    for (let i = 1; i < flowStepEdges.length; i++) {
      if (flowStepEdges[i].weight < flowStepEdges[i - 1].weight) {
        const msg = `flow_step edges are not monotone: weight at position ${i} (${flowStepEdges[i].weight}) < position ${i-1} (${flowStepEdges[i-1].weight}) — v2 invariant violation`;
        return {
          success: false,
          issues: [...issues, { level: "fatal", category: "non-monotone-flow-step", message: msg }],
          fatal: msg,
        };
      }
    }
  }

  // ── Layer validation + file-in-EXACTLY-one-layer (MAJOR fix) ─────────────────
  // file-in-exactly-one-layer: a file node in ZERO layers is a fatal v2 violation.
  // We enforce this after layer validation.
  const validLayers: Layer[] = [];
  const nodeInLayer = new Map<string, string>(); // nodeId → first layerId

  for (let i = 0; i < ((fixed.layers as unknown[]) ?? []).length; i++) {
    const l = (fixed.layers as Record<string, unknown>[])[i];
    if (l && typeof l.id === "string" && typeof l.name === "string" && Array.isArray(l.nodeIds)) {
      const filteredNodeIds: string[] = [];
      for (const nid of l.nodeIds as string[]) {
        if (!nodeIds.has(nid)) continue;
        const node = nodeById.get(nid);
        if (node && node.type === "file") {
          if (nodeInLayer.has(nid)) {
            issues.push({
              level: "dropped",
              category: "file-in-multiple-layers",
              message: `file node "${nid}" appears in layer "${l.id}" but already assigned to layer "${nodeInLayer.get(nid)}" — removed from second layer`,
            });
            continue;
          }
          nodeInLayer.set(nid, l.id as string);
        }
        filteredNodeIds.push(nid);
      }
      validLayers.push({
        id: l.id as string,
        name: l.name as string,
        description: typeof l.description === "string" ? l.description : "",
        nodeIds: filteredNodeIds,
      });
    } else {
      issues.push({ level: "dropped", category: "invalid-layer", message: `layers[${i}]: invalid — removed` });
    }
  }

  // Enforce file-in-EXACTLY-one-layer: on the v2 path every file node must appear
  // in exactly one layer. Zero layers for any file node is FATAL regardless of
  // whether other layers exist — a final v2 graph always assigns file nodes to layers.
  for (const node of validNodes) {
    if (node.type === "file" && !nodeInLayer.has(node.id)) {
      const msg = `file node "${node.id}" is not assigned to any layer — file-in-exactly-one-layer invariant violated`;
      return {
        success: false,
        issues: [...issues, { level: "fatal", category: "file-in-zero-layers", message: msg }],
        fatal: msg,
      };
    }
  }

  const validTour: TourStep[] = [];
  for (let i = 0; i < ((fixed.tour as unknown[]) ?? []).length; i++) {
    const t = (fixed.tour as Record<string, unknown>[])[i];
    if (t && typeof t.title === "string" && Array.isArray(t.nodeIds)) {
      validTour.push({
        order: typeof t.order === "number" ? t.order : i,
        title: t.title as string,
        description: typeof t.description === "string" ? t.description : "",
        nodeIds: (t.nodeIds as string[]).filter((x) => nodeIds.has(x)),
        ...(typeof t.languageLesson === "string" ? { languageLesson: t.languageLesson } : {}),
      });
    } else {
      issues.push({ level: "dropped", category: "invalid-tour-step", message: `tour[${i}]: invalid — removed` });
    }
  }

  // ── Assemble canonical v2 graph ───────────────────────────────────────────────
  // Output nodes/edges are already in canonical sort order from the dedup pass.
  const graph: KnowledgeGraph = {
    version: "guild.knowledge_graph.v2",
    kind: "knowledge",
    generated_from_commit:
      typeof fixed.generated_from_commit === "string" ? fixed.generated_from_commit : "unknown",
    project: {
      name: project.name as string,
      description: typeof project.description === "string" ? project.description : "",
    },
    nodes: validNodes,
    edges: validEdges,
    layers: validLayers,
    tour: validTour,
  };

  return { success: true, data: graph, issues };
}
