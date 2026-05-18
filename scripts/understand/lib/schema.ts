/**
 * understand/lib/schema.ts
 *
 * The FROZEN Guild KnowledgeGraph schema (codebase-understanding.md
 * §"KnowledgeGraph", contract `guild.knowledge_graph.v1`, contract-map.md §A
 * row 12) + the tolerant validate/repair ladder.
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
 */

// 21 canonical node types (frozen schema §"KnowledgeGraph").
export const NODE_TYPES = new Set([
  "file", "function", "class", "module", "concept",
  "config", "document", "service", "table", "endpoint",
  "pipeline", "schema", "resource",
  "domain", "flow", "step",
  "article", "entity", "topic", "claim", "source",
]);

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
  note: "article", page: "article", wiki_page: "article",
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

// ---- Types ----

export interface GraphNode {
  id: string;
  type: string;
  name: string;
  source_refs: string[];
  confidence: "high" | "medium" | "low";
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

// ---- Tier 1: sanitize ----

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

// ---- Tier 2: normalize aliases ----

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

// ---- Tier 3: auto-fix defaults ----

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

// ---- Tier 4: validate + drop ----

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
