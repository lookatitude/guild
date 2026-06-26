/**
 * learn/lib/layers.ts — stage 4 SCRIPT phase (topology → layers).
 *
 * Forked Guild-native from Understand-Anything's layer-detector (MIT — see
 * ../LICENSE-attribution.md). LOCKED invariant: every file node lands in
 * exactly one layer. Unmatched files fall to "Core". The `component`
 * knowledge label is persisted on each node here (= its layer assignment) —
 * near-zero new cost; codebase-understanding.md §"One connected knowledge
 * model" requires it not be discarded.
 */

import type { GraphNode, Layer, KnowledgeGraph } from "./schema";

const LAYER_PATTERNS: Array<{ patterns: string[]; name: string; description: string }> = [
  { patterns: ["routes", "controller", "handler", "endpoint", "api"], name: "API Layer", description: "HTTP endpoints, route handlers, and API controllers" },
  { patterns: ["service", "usecase", "use-case", "business"], name: "Service Layer", description: "Business logic and application services" },
  { patterns: ["model", "entity", "schema", "database", "db", "migration", "repository", "repo"], name: "Data Layer", description: "Data models, database access, and persistence" },
  { patterns: ["component", "view", "page", "screen", "layout", "widget", "ui"], name: "UI Layer", description: "User interface components and views" },
  { patterns: ["middleware", "interceptor", "guard", "filter", "pipe"], name: "Middleware Layer", description: "Request/response middleware and interceptors" },
  { patterns: ["client", "integration", "external", "sdk", "vendor", "adapter"], name: "External Services", description: "External integrations, SDKs, and third-party adapters" },
  { patterns: ["worker", "job", "queue", "cron", "consumer", "processor", "scheduler", "background"], name: "Background Tasks", description: "Background workers, job processors, scheduled tasks" },
  { patterns: ["util", "helper", "lib", "common", "shared"], name: "Utility Layer", description: "Shared utilities, helpers, and common libraries" },
  { patterns: ["test", "spec", "__test__", "__spec__", "__tests__", "__specs__"], name: "Test Layer", description: "Test files and test utilities" },
  { patterns: ["config", "setting", "env"], name: "Configuration Layer", description: "Application configuration and environment settings" },
  { patterns: ["skill", "skills"], name: "Skill Layer", description: "Skill definitions and prompt assets" },
  { patterns: ["agent", "agents"], name: "Agent Layer", description: "Specialist agent definitions" },
  { patterns: ["hook", "hooks"], name: "Hook Layer", description: "Lifecycle hooks" },
  { patterns: ["doc", "docs", "knowledge", "wiki"], name: "Documentation Layer", description: "Documentation and knowledge base" },
];

function layerId(name: string): string {
  return `layer:${name.toLowerCase().replace(/\s+/g, "-")}`;
}

function relOf(node: GraphNode): string | null {
  const sr = node.source_refs?.[0];
  if (!sr) return null;
  return sr.split("#")[0].replace(/\\/g, "/").toLowerCase();
}

function matchLayer(relPath: string): string | null {
  const segments = relPath.split("/");
  for (const { patterns, name } of LAYER_PATTERNS) {
    for (const seg of segments) {
      for (const p of patterns) {
        if (seg === p || seg === p + "s") return name;
      }
    }
  }
  return null;
}

/**
 * Assign every file node to exactly one layer (topology signal phase). Also
 * mutates each assigned node's `component` attribute (persisted label).
 */
export function assignLayers(graph: KnowledgeGraph): Layer[] {
  const map = new Map<string, string[]>();
  for (const node of graph.nodes) {
    if (node.type !== "file") continue;
    const rel = relOf(node);
    const name = (rel && matchLayer(rel)) || "Core";
    (node as GraphNode).component = name; // persisted knowledge label
    const arr = map.get(name) ?? [];
    arr.push(node.id);
    map.set(name, arr);
  }
  const layers: Layer[] = [];
  for (const [name, nodeIds] of map) {
    const description =
      name === "Core"
        ? "Core application files not matched to a specific layer"
        : LAYER_PATTERNS.find((p) => p.name === name)?.description ?? "";
    layers.push({ id: layerId(name), name, description, nodeIds });
  }
  return layers.sort((a, b) => a.name.localeCompare(b.name));
}
