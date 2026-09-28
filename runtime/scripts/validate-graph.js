#!/usr/bin/env node
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// scripts/learn/validate-graph.ts
var validate_graph_exports = {};
__export(validate_graph_exports, {
  KNOWLEDGE_GRAPH_V2: () => KNOWLEDGE_GRAPH_V2,
  checkDowngradeGuard: () => checkDowngradeGuard,
  isV2Input: () => isV2Input,
  isV2Result: () => isV2Result,
  validateWithDispatch: () => validateWithDispatch
});
module.exports = __toCommonJS(validate_graph_exports);
var fs3 = __toESM(require("fs"));
var path4 = __toESM(require("path"));

// scripts/learn/lib/paths.ts
var fs = __toESM(require("fs"));
var path = __toESM(require("path"));
var import_child_process = require("child_process");
function parseCwd(argv) {
  const idx = argv.indexOf("--cwd");
  if (idx !== -1 && argv[idx + 1]) return argv[idx + 1];
  return process.env["GUILD_CWD"] ?? process.cwd();
}
function parseFlag(argv, name) {
  const eq = `--${name}=`;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === `--${name}` && argv[i + 1]) return argv[i + 1];
    if (argv[i].startsWith(eq)) return argv[i].slice(eq.length);
  }
  return void 0;
}
function hasFlag(argv, name) {
  return argv.includes(`--${name}`);
}
function resolveMainRepoRoot(cwd) {
  try {
    const commonDir = (0, import_child_process.execFileSync)("git", ["rev-parse", "--git-common-dir"], {
      cwd,
      encoding: "utf-8"
    }).trim();
    const abs = path.isAbsolute(commonDir) ? commonDir : path.resolve(cwd, commonDir);
    const root = path.dirname(abs);
    if (fs.existsSync(root)) return root;
  } catch {
  }
  return path.resolve(cwd);
}
function guildPaths(cwd) {
  const repoRoot = resolveMainRepoRoot(cwd);
  const guildDir = path.join(repoRoot, ".guild");
  const indexesDir = path.join(guildDir, "indexes");
  const runsDir = path.join(guildDir, "runs");
  return {
    repoRoot,
    guildDir,
    indexesDir,
    runsDir,
    codebaseMap: path.join(indexesDir, "codebase-map.json"),
    knowledgeGraph: path.join(indexesDir, "knowledge-graph.json"),
    knowledgeLinks: path.join(indexesDir, "knowledge-links.json"),
    knowledgeRecall: path.join(indexesDir, "knowledge-recall.json"),
    fingerprint: path.join(indexesDir, "understand-fingerprint.json"),
    partialGraph: path.join(indexesDir, "understand-partial-graph.json")
  };
}
function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf8");
}
function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

// scripts/learn/lib/schema.ts
var fs2 = __toESM(require("fs"));

// src/domains/kernel/module-manifest.ts
var OWNED_INVENTORY_CATEGORIES = Object.freeze([
  "commands",
  "skills",
  "agents",
  "hooks",
  "mcp_servers",
  "scripts"
]);

// src/domains/kernel/plugin-root.ts
var path2 = __toESM(require("node:path"));
var PLUGIN_ROOT_MARKER = path2.join("runtime", "guild-mcp.js");

// src/domains/kernel/sealed-collections.ts
function regExpWritesLastIndex(re) {
  return re.global || re.sticky;
}
function freezeRegExpSafely(re) {
  if (regExpWritesLastIndex(re)) return false;
  Object.freeze(re);
  return true;
}
var SEALED_BRAND = /* @__PURE__ */ Symbol.for("guild.sealed_collection.v1");
function refuseMutator(label, method) {
  return () => {
    throw new TypeError(
      `${label} is a sealed collection: ${method}() would silently change a closed vocabulary`
    );
  };
}
function sealSet(values, label = "this Set") {
  const inner = new Set(values);
  const facade = {
    [SEALED_BRAND]: "set",
    // A data property, not a getter: `inner` is unreachable from outside these closures,
    // so the size is constant for the life of the value.
    size: inner.size,
    has: (value) => inner.has(value),
    keys: () => inner.keys(),
    values: () => inner.values(),
    entries: () => inner.entries(),
    forEach: (callback, thisArg) => {
      inner.forEach((value, value2) => callback.call(thisArg, value, value2, facade));
    },
    [Symbol.iterator]: () => inner[Symbol.iterator](),
    add: refuseMutator(label, "add"),
    delete: refuseMutator(label, "delete"),
    clear: refuseMutator(label, "clear")
  };
  return Object.freeze(facade);
}
function isSealedCollection(value) {
  if (value === null || typeof value !== "object") return false;
  if (value instanceof Set || value instanceof Map) return false;
  const brand = value[SEALED_BRAND];
  return (brand === "set" || brand === "map") && Object.isFrozen(value);
}
function sealedCollectionValues(value) {
  if (!isSealedCollection(value)) return void 0;
  return [...value];
}
function deepFreeze(value, options = {}) {
  const policy = options.regexps ?? "safe";
  const seen = /* @__PURE__ */ new WeakSet();
  const walk = (node) => {
    if (node === null || typeof node !== "object") return;
    const obj = node;
    if (seen.has(obj)) return;
    seen.add(obj);
    if (obj instanceof RegExp) {
      if (policy === "freeze") Object.freeze(obj);
      else if (policy === "safe") freezeRegExpSafely(obj);
      return;
    }
    if (obj instanceof Date) {
      return;
    }
    if (obj instanceof Set || obj instanceof Map) {
      throw new TypeError(
        "deepFreeze: refusing to 'freeze' a Set/Map \u2014 freeze does not close membership and the intrinsics reach past neutered own methods. Declare it with sealSet()/sealMap()."
      );
    }
    const sealedValues = sealedCollectionValues(obj);
    if (sealedValues !== void 0) {
      for (const entry of sealedValues) walk(entry);
      return;
    }
    Object.freeze(obj);
    for (const key of Reflect.ownKeys(obj)) {
      const descriptor = Object.getOwnPropertyDescriptor(obj, key);
      if (!descriptor || !("value" in descriptor)) continue;
      walk(descriptor.value);
    }
  };
  walk(value);
  return value;
}
function frozenList(items, options = {}) {
  return deepFreeze(items.slice(), options);
}

// src/domains/kernel/path-containment.ts
var CONTAINMENT_REFUSAL_CODES = Object.freeze([
  "root-unresolvable",
  "no-existing-ancestor",
  "dangling-symlink",
  "physical-symlink",
  "outside-root",
  "leaf-not-regular-file",
  "mkdir-failed",
  "parent-traversal",
  "destination-moved"
]);

// src/domains/kernel/runtime-tree-guard.ts
var RUNTIME_SUBTREE_SEGMENTS = sealSet(
  [
    "skills",
    "agents",
    "commands",
    "hooks",
    ".claude-plugin",
    "dist",
    "src",
    "templates"
  ],
  "RUNTIME_SUBTREE_SEGMENTS"
);

// src/domains/kernel/tier-bus.ts
var BUS_TIERS = frozenList(["T0", "T1", "T2"]);
var LEAD_ROLE_IDS = frozenList(["team-lead", "lead", "orchestrator"]);
var TIER_BUS_CONTRACT = deepFreeze({
  tiers: BUS_TIERS,
  upward_envelopes: { T2: "guild.handoff.v2", T1: "guild.goal_status.v1" },
  lead_roles: LEAD_ROLE_IDS,
  tier_source: "the attempt record on disk, or the run's minted binding_ref \u2014 never the payload"
});

// scripts/learn/lib/schema.ts
var path3 = __toESM(require("path"));
var NODE_TYPES = sealSet([
  "file",
  "function",
  "class",
  "module",
  "concept",
  "config",
  "document",
  "service",
  "table",
  "endpoint",
  "pipeline",
  "schema",
  "resource",
  "domain",
  "flow",
  "step",
  "article",
  "entity",
  "topic",
  "claim",
  "source"
], "NODE_TYPES");
var NODE_TYPES_V2 = sealSet([
  ...NODE_TYPES,
  "wiki_page",
  // first-class in v2; v1 aliased this to article — alias removed
  "diagram"
  // new in v2: fenced mermaid blocks, .svg files
], "NODE_TYPES_V2");
var EDGE_TYPES = sealSet([
  // Structural
  "imports",
  "exports",
  "contains",
  "inherits",
  "implements",
  "implemented_by",
  // Behavioral
  "calls",
  "subscribes",
  "publishes",
  "middleware",
  // Data flow
  "reads_from",
  "writes_to",
  "transforms",
  "validates",
  // Dependencies
  "depends_on",
  "tested_by",
  "configures",
  // Semantic
  "related",
  "similar_to",
  // Infrastructure
  "deploys",
  "serves",
  "provisions",
  "triggers",
  // Schema/Data
  "migrates",
  "documents",
  "routes",
  "defines_schema",
  // Domain
  "contains_flow",
  "flow_step",
  "cross_domain",
  // Knowledge
  "cites",
  "contradicts",
  "builds_on",
  "exemplifies",
  "categorized_under",
  "authored_by"
], "EDGE_TYPES");
var EDGE_TYPES_V2 = sealSet([
  ...EDGE_TYPES,
  "subtopic_of",
  // hierarchy; acyclic, tree (single-parent), depth-monotone (SC-2)
  "relates_to",
  // weighted, LLM-judged (SC-3)
  "evidenced_by",
  // knowledge→artifact, cross-modal (SC-4)
  "belongs_to_domain",
  // topic→domain membership (SC-5)
  "mentions",
  // modality bridge (SC-3)
  "defines"
  // modality bridge (first-class v2 — NOT aliased to defines_schema)
  // NOTE: "related" is already in v1 EDGE_TYPES (wikilink edges use it)
], "EDGE_TYPES_V2");
var NODE_CATEGORIES = sealSet([
  // Code structure
  "function",
  "class",
  "module",
  "config",
  "endpoint",
  "pipeline",
  "schema",
  // Knowledge
  "concept",
  "fact",
  "claim",
  "principle",
  "definition",
  "example",
  // Documentation
  "guide",
  "tutorial",
  "reference",
  "overview",
  "changelog",
  "architecture",
  // Organizational
  "decision",
  "standard",
  "recipe",
  "checklist",
  // Content
  "component",
  "domain",
  "diagram",
  "index",
  "note"
], "NODE_CATEGORIES");
var KNOWLEDGE_CONFIG_DEFAULTS = {
  maxDepth: 8,
  // hard ceiling on subtopic_of tree depth
  maxBranching: 12,
  // per-node subtopic_of fan-out limit
  minTopicImportance: 0.4,
  // numeric importance_score threshold; below → fold into parent
  relMinConf: 0.5,
  // min confidence for LLM-judged relates_to/evidenced_by edges
  maxFiles: 3e3,
  // cost gate: max files per K-stage run
  maxTokens: 1e6,
  // cost gate: max LLM output tokens per run
  batchSize: 20
  // files per LLM batch
};
var DIRECTIONS = sealSet(["out", "in", "bi"], "DIRECTIONS");
var CONFIDENCE = sealSet(["high", "medium", "low"], "CONFIDENCE");
var NODE_TYPE_ALIASES = {
  func: "function",
  fn: "function",
  method: "function",
  interface: "class",
  struct: "class",
  mod: "module",
  pkg: "module",
  package: "module",
  container: "service",
  deployment: "service",
  pod: "service",
  doc: "document",
  readme: "document",
  docs: "document",
  job: "pipeline",
  ci: "pipeline",
  route: "endpoint",
  api: "endpoint",
  query: "endpoint",
  mutation: "endpoint",
  setting: "config",
  env: "config",
  configuration: "config",
  infra: "resource",
  infrastructure: "resource",
  terraform: "resource",
  migration: "table",
  database: "table",
  db: "table",
  view: "table",
  proto: "schema",
  protobuf: "schema",
  definition: "schema",
  typedef: "schema",
  business_domain: "domain",
  business_flow: "flow",
  business_process: "flow",
  task: "step",
  business_step: "step",
  note: "article",
  page: "article",
  // v1 alias: wiki_page → article (v1 read path ONLY; v2 makes wiki_page first-class)
  wiki_page: "article",
  person: "entity",
  actor: "entity",
  organization: "entity",
  tag: "topic",
  category: "topic",
  theme: "topic",
  assertion: "claim",
  decision: "claim",
  thesis: "claim",
  reference: "source",
  raw: "source",
  paper: "source"
};
var EDGE_TYPE_ALIASES = {
  extends: "inherits",
  invokes: "calls",
  invoke: "calls",
  uses: "depends_on",
  requires: "depends_on",
  relates_to: "related",
  related_to: "related",
  similar: "similar_to",
  import: "imports",
  export: "exports",
  contain: "contains",
  publish: "publishes",
  subscribe: "subscribes",
  describes: "documents",
  documented_by: "documents",
  creates: "provisions",
  exposes: "serves",
  listens: "serves",
  deploys_to: "deploys",
  migrates_to: "migrates",
  routes_to: "routes",
  triggers_on: "triggers",
  fires: "triggers",
  defines: "defines_schema",
  has_flow: "contains_flow",
  next_step: "flow_step",
  interacts_with: "cross_domain",
  references: "cites",
  cites_source: "cites",
  conflicts_with: "contradicts",
  disagrees_with: "contradicts",
  refines: "builds_on",
  elaborates: "builds_on",
  illustrates: "exemplifies",
  instance_of: "exemplifies",
  example_of: "exemplifies",
  belongs_to: "categorized_under",
  tagged_with: "categorized_under",
  written_by: "authored_by",
  created_by: "authored_by"
  // NOTE (LOCKED invariant): "implemented_by" is intentionally NOT aliased —
  // aliasing it to "implements" would invert edge direction.
};
var DIRECTION_ALIASES = {
  // Frozen Guild direction enum is out|in|bi (NOT UA's forward/backward/...).
  forward: "out",
  outbound: "out",
  to: "out",
  out_: "out",
  backward: "in",
  inbound: "in",
  from: "in",
  bidirectional: "bi",
  both: "bi",
  mutual: "bi",
  "bi-directional": "bi"
};
function sanitize(d) {
  const r = { ...d };
  if (d.tour == null) r.tour = [];
  if (d.layers == null) r.layers = [];
  if (d.edges == null) r.edges = [];
  if (Array.isArray(d.nodes)) {
    r.nodes = d.nodes.map((n) => {
      if (typeof n !== "object" || n === null) return n;
      const x = { ...n };
      if (x.source_refs === null) delete x.source_refs;
      if (x.confidence === null) delete x.confidence;
      if (typeof x.type === "string") x.type = x.type.toLowerCase();
      return x;
    });
  }
  if (Array.isArray(d.edges)) {
    r.edges = d.edges.map((e) => {
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
function normalize(d) {
  const r = { ...d };
  if (Array.isArray(d.nodes)) {
    r.nodes = d.nodes.map(
      (n) => n && typeof n.type === "string" && n.type in NODE_TYPE_ALIASES ? { ...n, type: NODE_TYPE_ALIASES[n.type] } : n
    );
  }
  if (Array.isArray(d.edges)) {
    r.edges = d.edges.map((e) => {
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
function autoFix(d) {
  const issues = [];
  const r = { ...d };
  if (Array.isArray(d.nodes)) {
    r.nodes = d.nodes.map((n, i) => {
      if (typeof n !== "object" || n === null) return n;
      const x = { ...n };
      const label = x.name || x.id || `index ${i}`;
      if (!x.type || typeof x.type !== "string") {
        x.type = "file";
        issues.push({ level: "auto-corrected", category: "missing-field", message: `nodes[${i}] ("${label}"): type defaulted to "file"` });
      }
      if (!Array.isArray(x.source_refs)) {
        x.source_refs = [];
        issues.push({ level: "auto-corrected", category: "missing-field", message: `nodes[${i}] ("${label}"): source_refs defaulted to []` });
      }
      if (typeof x.confidence !== "string" || !CONFIDENCE.has(x.confidence)) {
        x.confidence = "low";
        issues.push({ level: "auto-corrected", category: "missing-field", message: `nodes[${i}] ("${label}"): confidence defaulted to "low"` });
      }
      if (typeof x.name !== "string" || x.name === "") {
        x.name = x.id || `node-${i}`;
        issues.push({ level: "auto-corrected", category: "missing-field", message: `nodes[${i}]: name defaulted to id` });
      }
      return x;
    });
  }
  if (Array.isArray(d.edges)) {
    r.edges = d.edges.map((e, i) => {
      if (typeof e !== "object" || e === null) return e;
      const x = { ...e };
      if (!x.type || typeof x.type !== "string") {
        x.type = "depends_on";
        issues.push({ level: "auto-corrected", category: "missing-field", message: `edges[${i}]: type defaulted to "depends_on"` });
      }
      if (typeof x.direction !== "string" || !DIRECTIONS.has(x.direction)) {
        x.direction = "out";
        issues.push({ level: "auto-corrected", category: "missing-field", message: `edges[${i}]: direction defaulted to "out"` });
      }
      if (x.weight === void 0 || x.weight === null) {
        x.weight = 0.5;
        issues.push({ level: "auto-corrected", category: "missing-field", message: `edges[${i}]: weight defaulted to 0.5` });
      } else if (typeof x.weight === "string") {
        const p = parseFloat(x.weight);
        x.weight = isNaN(p) ? 0.5 : p;
        issues.push({ level: "auto-corrected", category: "type-coercion", message: `edges[${i}]: weight coerced from string` });
      }
      if (typeof x.weight === "number" && (x.weight < 0 || x.weight > 1)) {
        const o = x.weight;
        x.weight = Math.max(0, Math.min(1, x.weight));
        issues.push({ level: "auto-corrected", category: "out-of-range", message: `edges[${i}]: weight ${o} clamped to ${x.weight}` });
      }
      return x;
    });
  }
  return { data: r, issues };
}
function validateGraph(input) {
  if (typeof input !== "object" || input === null) {
    return { success: false, issues: [], fatal: "Invalid input: not an object" };
  }
  const sanitized = sanitize(input);
  const normalized = normalize(sanitized);
  const { data: fixed, issues } = autoFix(normalized);
  for (const c of ["nodes", "edges", "layers", "tour"]) {
    if (c in fixed && fixed[c] !== void 0 && !Array.isArray(fixed[c])) {
      return { success: false, issues, fatal: `"${c}" must be an array when present` };
    }
  }
  const project = fixed.project;
  if (!project || typeof project !== "object" || typeof project.name !== "string") {
    return { success: false, issues, fatal: "Missing or invalid project metadata" };
  }
  const validNodes = [];
  for (let i = 0; i < (fixed.nodes ?? []).length; i++) {
    const n = fixed.nodes[i];
    if (n && typeof n.id === "string" && typeof n.type === "string" && NODE_TYPES.has(n.type) && typeof n.name === "string") {
      validNodes.push(n);
    } else {
      issues.push({ level: "dropped", category: "invalid-node", message: `nodes[${i}]: invalid (id/type/name) \u2014 removed` });
    }
  }
  if (validNodes.length === 0) {
    return { success: false, issues, fatal: "No valid nodes found in knowledge graph" };
  }
  const ids = new Set(validNodes.map((n) => n.id));
  const validEdges = [];
  for (let i = 0; i < (fixed.edges ?? []).length; i++) {
    const e = fixed.edges[i];
    if (!e || typeof e.source !== "string" || typeof e.target !== "string") {
      issues.push({ level: "dropped", category: "invalid-edge", message: `edges[${i}]: missing source/target \u2014 removed` });
      continue;
    }
    if (typeof e.type !== "string" || !EDGE_TYPES.has(e.type)) {
      issues.push({ level: "dropped", category: "invalid-edge", message: `edges[${i}]: unknown type "${e.type}" \u2014 removed` });
      continue;
    }
    if (!ids.has(e.source)) {
      issues.push({ level: "dropped", category: "invalid-reference", message: `edges[${i}]: source "${e.source}" not in nodes \u2014 removed` });
      continue;
    }
    if (!ids.has(e.target)) {
      issues.push({ level: "dropped", category: "invalid-reference", message: `edges[${i}]: target "${e.target}" not in nodes \u2014 removed` });
      continue;
    }
    validEdges.push(e);
  }
  const validLayers = [];
  for (let i = 0; i < (fixed.layers ?? []).length; i++) {
    const l = fixed.layers[i];
    if (l && typeof l.id === "string" && typeof l.name === "string" && Array.isArray(l.nodeIds)) {
      validLayers.push({
        id: l.id,
        name: l.name,
        description: typeof l.description === "string" ? l.description : "",
        nodeIds: l.nodeIds.filter((x) => ids.has(x))
      });
    } else {
      issues.push({ level: "dropped", category: "invalid-layer", message: `layers[${i}]: invalid \u2014 removed` });
    }
  }
  const validTour = [];
  for (let i = 0; i < (fixed.tour ?? []).length; i++) {
    const t = fixed.tour[i];
    if (t && typeof t.title === "string" && Array.isArray(t.nodeIds)) {
      validTour.push({
        order: typeof t.order === "number" ? t.order : i,
        title: t.title,
        description: typeof t.description === "string" ? t.description : "",
        nodeIds: t.nodeIds.filter((x) => ids.has(x)),
        ...typeof t.languageLesson === "string" ? { languageLesson: t.languageLesson } : {}
      });
    } else {
      issues.push({ level: "dropped", category: "invalid-tour-step", message: `tour[${i}]: invalid \u2014 removed` });
    }
  }
  const graph = {
    version: typeof fixed.version === "string" ? fixed.version : "guild.knowledge_graph.v1",
    ...fixed.kind === "knowledge" || fixed.kind === "codebase" ? { kind: fixed.kind } : { kind: "codebase" },
    generated_from_commit: typeof fixed.generated_from_commit === "string" ? fixed.generated_from_commit : "unknown",
    project: {
      name: project.name,
      description: typeof project.description === "string" ? project.description : ""
    },
    nodes: validNodes,
    edges: validEdges,
    layers: validLayers,
    tour: validTour
  };
  return { success: true, data: graph, issues };
}
var KNOWLEDGE_NODE_TYPES_V2 = /* @__PURE__ */ new Set([
  "topic",
  "concept",
  "claim",
  "entity",
  "wiki_page",
  "diagram"
]);
function anchorToPath(anchor) {
  const hashIdx = anchor.indexOf("#");
  return hashIdx === -1 ? anchor : anchor.slice(0, hashIdx);
}
function anchorFragment(anchor) {
  const hashIdx = anchor.indexOf("#");
  return hashIdx === -1 ? void 0 : anchor.slice(hashIdx + 1);
}
function resolveAnchor(repoRoot, anchor) {
  if (!anchor || typeof anchor !== "string") return false;
  const relPath = anchorToPath(anchor);
  if (!relPath) return false;
  const absPath = path3.resolve(repoRoot, relPath);
  try {
    if (!fs2.existsSync(absPath)) return false;
  } catch {
    return false;
  }
  const fragment = anchorFragment(anchor);
  if (!fragment) {
    return true;
  }
  let content;
  try {
    content = fs2.readFileSync(absPath, "utf8");
  } catch {
    return false;
  }
  if (fragment === "svg") {
    if (!relPath.toLowerCase().endsWith(".svg")) return false;
    return /<svg[\s>]/i.test(content);
  }
  if (relPath.toLowerCase().endsWith(".svg")) {
    const idPattern = new RegExp(`\\bid=["']${fragment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`);
    return idPattern.test(content);
  }
  const lineRangeMatch = fragment.match(/^L(\d+)-L(\d+)$/);
  if (lineRangeMatch) {
    const start = parseInt(lineRangeMatch[1], 10);
    const end = parseInt(lineRangeMatch[2], 10);
    const lines = content.split("\n");
    const lineCount = lines.length;
    return start >= 1 && end >= start && end <= lineCount;
  }
  const mermaidMatch = fragment.match(/^mermaid-(\d+)$/);
  if (mermaidMatch) {
    const idx = parseInt(mermaidMatch[1], 10);
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
  const headingRe = /^#{1,6}\s+(.+)$/gm;
  let match;
  while ((match = headingRe.exec(content)) !== null) {
    const raw = match[1].trim();
    const slug = raw.toLowerCase().replace(/[^\w\s-]/g, "").replace(/\s+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
    if (slug === fragment) return true;
  }
  return false;
}
function validateSubtopicGraph(edges, nodeIds, maxDepth, maxBranching) {
  const childToParents = /* @__PURE__ */ new Map();
  const parentToChildren = /* @__PURE__ */ new Map();
  for (const e of edges) {
    if (e.type !== "subtopic_of") continue;
    if (!nodeIds.has(e.source) || !nodeIds.has(e.target)) continue;
    if (!childToParents.has(e.source)) childToParents.set(e.source, /* @__PURE__ */ new Set());
    childToParents.get(e.source).add(e.target);
    if (!parentToChildren.has(e.target)) parentToChildren.set(e.target, /* @__PURE__ */ new Set());
    parentToChildren.get(e.target).add(e.source);
  }
  for (const [child, parents] of childToParents.entries()) {
    if (parents.size > 1) {
      return `subtopic_of multi-parent violation: node "${child}" has ${parents.size} parents [${[...parents].sort().join(", ")}] \u2014 tree contract requires exactly one parent (SC-2)`;
    }
  }
  const childToParent = /* @__PURE__ */ new Map();
  for (const [child, parents] of childToParents.entries()) {
    childToParent.set(child, [...parents][0]);
  }
  for (const [parentId, children] of parentToChildren.entries()) {
    if (children.size > maxBranching) {
      return `subtopic_of fan-out violation: node "${parentId}" has ${children.size} children, exceeding maxBranching ${maxBranching} (SC-2)`;
    }
  }
  const visited = /* @__PURE__ */ new Set();
  const inStack = /* @__PURE__ */ new Set();
  function hasCycle(nodeId) {
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
        return `subtopic_of cycle detected \u2014 v2 invariant violation (SC-2)`;
      }
    }
  }
  const depths = /* @__PURE__ */ new Map();
  function getDepth(nodeId, callStack) {
    if (depths.has(nodeId)) return depths.get(nodeId);
    if (callStack.has(nodeId)) return 0;
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
    const d = getDepth(id, /* @__PURE__ */ new Set());
    if (d > maxDepth) {
      return `subtopic_of depth ${d} exceeds maxDepth ${maxDepth} at node "${id}" \u2014 SC-2 violation`;
    }
  }
  return null;
}
function canonicalSortNodes(nodes) {
  return [...nodes].sort((a, b) => {
    const aid = typeof a.id === "string" ? a.id : "";
    const bid = typeof b.id === "string" ? b.id : "";
    return aid < bid ? -1 : aid > bid ? 1 : 0;
  });
}
function canonicalSortEdges(edges) {
  return [...edges].sort((a, b) => {
    const ak = `${a.type ?? ""}|${a.source ?? ""}|${a.target ?? ""}`;
    const bk = `${b.type ?? ""}|${b.source ?? ""}|${b.target ?? ""}`;
    return ak < bk ? -1 : ak > bk ? 1 : 0;
  });
}
function validateGraphV2(input, opts) {
  if (typeof input === "object" && input !== null) {
    const raw2 = input;
    if (raw2.version !== "guild.knowledge_graph.v2") {
      return validateGraph(input);
    }
  }
  const cfg = { ...KNOWLEDGE_CONFIG_DEFAULTS, ...opts.config ?? {} };
  const { repoRoot } = opts;
  if (typeof input !== "object" || input === null) {
    return { success: false, issues: [], fatal: "Invalid input: not an object" };
  }
  const raw = input;
  const sanitized = sanitize(raw);
  const r = { ...sanitized };
  if (Array.isArray(sanitized.edges)) {
    r.edges = sanitized.edges.map((e) => {
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
  const { data: fixed, issues } = autoFix(r);
  for (const c of ["nodes", "edges", "layers", "tour"]) {
    if (c in fixed && fixed[c] !== void 0 && !Array.isArray(fixed[c])) {
      return { success: false, issues, fatal: `"${c}" must be an array when present` };
    }
  }
  const project = fixed.project;
  if (!project || typeof project !== "object" || typeof project.name !== "string") {
    return { success: false, issues, fatal: "Missing or invalid project metadata" };
  }
  const sortedRawNodes = canonicalSortNodes(
    Array.isArray(fixed.nodes) ? fixed.nodes : []
  );
  const sortedRawEdges = canonicalSortEdges(
    Array.isArray(fixed.edges) ? fixed.edges : []
  );
  const seenNodeIds = /* @__PURE__ */ new Set();
  const validNodes = [];
  for (let i = 0; i < sortedRawNodes.length; i++) {
    const n = sortedRawNodes[i];
    if (!n || typeof n.id !== "string" || typeof n.type !== "string" || typeof n.name !== "string") {
      issues.push({ level: "dropped", category: "invalid-node", message: `node at sorted-index ${i}: invalid (id/type/name) \u2014 removed` });
      continue;
    }
    if (!NODE_TYPES_V2.has(n.type)) {
      issues.push({ level: "dropped", category: "invalid-node", message: `node "${n.id}": unknown type "${n.type}" for v2 \u2014 removed` });
      continue;
    }
    if (seenNodeIds.has(n.id)) {
      issues.push({ level: "dropped", category: "duplicate-node", message: `node "${n.id}": duplicate id \u2014 removed (canonical-first wins)` });
      continue;
    }
    const isKnowledgeNode = KNOWLEDGE_NODE_TYPES_V2.has(n.type);
    if (isKnowledgeNode) {
      if (n.category === void 0 || n.category === null) {
        issues.push({ level: "dropped", category: "missing-category", message: `node "${n.id}" (${n.type}): category is required on v2 knowledge nodes \u2014 removed` });
        continue;
      }
      if (typeof n.category !== "string" || !NODE_CATEGORIES.has(n.category)) {
        issues.push({ level: "dropped", category: "invalid-category", message: `node "${n.id}" (${n.type}): invalid category "${n.category}" \u2014 removed` });
        continue;
      }
    }
    if (n.type === "topic") {
      if (typeof n.importance_score !== "number") {
        issues.push({ level: "dropped", category: "missing-importance-score", message: `topic node "${n.id}": importance_score (numeric 0-1) is required on topic nodes \u2014 removed` });
        continue;
      }
      if (n.importance_score < cfg.minTopicImportance) {
        issues.push({ level: "dropped", category: "below-importance-threshold", message: `topic node "${n.id}": importance_score ${n.importance_score} < minTopicImportance ${cfg.minTopicImportance} \u2014 removed (SC-2)` });
        continue;
      }
    }
    if (isKnowledgeNode) {
      const refs = Array.isArray(n.source_refs) ? n.source_refs : [];
      if (refs.length === 0) {
        issues.push({ level: "dropped", category: "missing-anchor", message: `node "${n.id}" (${n.type}): knowledge nodes require at least one source_ref anchor \u2014 removed (SC-12)` });
        continue;
      }
      let allResolved = true;
      for (const ref of refs) {
        if (!resolveAnchor(repoRoot, ref)) {
          allResolved = false;
          issues.push({ level: "dropped", category: "unresolvable-anchor", message: `node "${n.id}": anchor "${ref}" does not resolve at repoRoot \u2014 SC-12 violation` });
        }
      }
      if (!allResolved) {
        continue;
      }
    }
    seenNodeIds.add(n.id);
    validNodes.push(n);
  }
  if (validNodes.length === 0) {
    return { success: false, issues, fatal: "No valid nodes found in knowledge graph" };
  }
  const nodeIds = new Set(validNodes.map((n) => n.id));
  const nodeById = /* @__PURE__ */ new Map();
  for (const node of validNodes) {
    nodeById.set(node.id, node);
  }
  const seenEdgeKeys = /* @__PURE__ */ new Set();
  const validEdges = [];
  for (let i = 0; i < sortedRawEdges.length; i++) {
    const e = sortedRawEdges[i];
    if (!e || typeof e.source !== "string" || typeof e.target !== "string") {
      issues.push({ level: "dropped", category: "invalid-edge", message: `edge at sorted-index ${i}: missing source/target \u2014 removed` });
      continue;
    }
    if (typeof e.type !== "string" || !EDGE_TYPES_V2.has(e.type)) {
      issues.push({ level: "dropped", category: "invalid-edge", message: `edge "${e.type}|${e.source}|${e.target}": unknown type for v2 \u2014 removed` });
      continue;
    }
    if (!nodeIds.has(e.source)) {
      issues.push({ level: "dropped", category: "invalid-reference", message: `edge "${e.type}|${e.source}|${e.target}": source not in nodes \u2014 removed` });
      continue;
    }
    if (!nodeIds.has(e.target)) {
      const label = e.type === "evidenced_by" ? " (SC-4)" : "";
      issues.push({ level: "dropped", category: "invalid-reference", message: `edge "${e.type}|${e.source}|${e.target}": target not in nodes \u2014 removed${label}` });
      continue;
    }
    if (e.type === "evidenced_by") {
      const targetNode = nodeById.get(e.target);
      if (targetNode) {
        const refs = Array.isArray(targetNode.source_refs) ? targetNode.source_refs : [];
        let targetAnchorResolved = refs.length === 0;
        if (KNOWLEDGE_NODE_TYPES_V2.has(targetNode.type)) {
          targetAnchorResolved = refs.some((ref) => resolveAnchor(repoRoot, ref));
        } else {
          if (refs.length > 0) {
            targetAnchorResolved = resolveAnchor(repoRoot, refs[0]);
          } else {
            targetAnchorResolved = true;
          }
        }
        if (!targetAnchorResolved) {
          issues.push({ level: "dropped", category: "evidenced-by-anchor-broken", message: `edge evidenced_by target "${e.target}": no source_ref resolves at repoRoot \u2014 removed (SC-4 global)` });
          continue;
        }
      }
    }
    const eKey = `${e.type}|${e.source}|${e.target}`;
    if (seenEdgeKeys.has(eKey)) {
      issues.push({ level: "dropped", category: "duplicate-edge", message: `edge "${eKey}": duplicate \u2014 removed (canonical-first wins)` });
      continue;
    }
    seenEdgeKeys.add(eKey);
    validEdges.push(e);
  }
  const subtopicErr = validateSubtopicGraph(validEdges, nodeIds, cfg.maxDepth, cfg.maxBranching);
  if (subtopicErr !== null) {
    return {
      success: false,
      issues: [...issues, { level: "fatal", category: "invariant-violation", message: subtopicErr }],
      fatal: subtopicErr
    };
  }
  const flowStepEdges = validEdges.filter((e) => e.type === "flow_step");
  if (flowStepEdges.length > 1) {
    const neighbours = /* @__PURE__ */ new Map();
    for (const edge of flowStepEdges) {
      if (!neighbours.has(edge.source)) neighbours.set(edge.source, /* @__PURE__ */ new Set());
      if (!neighbours.has(edge.target)) neighbours.set(edge.target, /* @__PURE__ */ new Set());
      neighbours.get(edge.source).add(edge.target);
      neighbours.get(edge.target).add(edge.source);
    }
    const componentByNode = /* @__PURE__ */ new Map();
    let component = 0;
    for (const start of neighbours.keys()) {
      if (componentByNode.has(start)) continue;
      const queue = [start];
      componentByNode.set(start, component);
      for (let cursor = 0; cursor < queue.length; cursor++) {
        const node = queue[cursor];
        for (const neighbour of neighbours.get(node) ?? []) {
          if (!componentByNode.has(neighbour)) {
            componentByNode.set(neighbour, component);
            queue.push(neighbour);
          }
        }
      }
      component++;
    }
    const componentEdges = /* @__PURE__ */ new Map();
    for (let i = 0; i < flowStepEdges.length; i++) {
      const edge = flowStepEdges[i];
      const componentId = componentByNode.get(edge.source);
      const entries = componentEdges.get(componentId) ?? [];
      entries.push({ edge, position: i });
      componentEdges.set(componentId, entries);
    }
    for (const [componentId, entries] of componentEdges) {
      const outDegree = /* @__PURE__ */ new Map();
      for (const { edge } of entries) {
        outDegree.set(edge.source, (outDegree.get(edge.source) ?? 0) + 1);
      }
      if ([...outDegree.values()].some((degree) => degree > 1)) continue;
      for (let i = 1; i < entries.length; i++) {
        const previous = entries[i - 1];
        const current = entries[i];
        if (current.edge.weight < previous.edge.weight) {
          const msg = `flow_step edges are not monotone in linear flow component ${componentId}: weight at position ${current.position} (${current.edge.weight}) < position ${previous.position} (${previous.edge.weight}) \u2014 v2 invariant violation`;
          return {
            success: false,
            issues: [...issues, { level: "fatal", category: "non-monotone-flow-step", message: msg }],
            fatal: msg
          };
        }
      }
    }
  }
  const validLayers = [];
  const nodeInLayer = /* @__PURE__ */ new Map();
  for (let i = 0; i < (fixed.layers ?? []).length; i++) {
    const l = fixed.layers[i];
    if (l && typeof l.id === "string" && typeof l.name === "string" && Array.isArray(l.nodeIds)) {
      const filteredNodeIds = [];
      for (const nid of l.nodeIds) {
        if (!nodeIds.has(nid)) continue;
        const node = nodeById.get(nid);
        if (node && node.type === "file") {
          if (nodeInLayer.has(nid)) {
            issues.push({
              level: "dropped",
              category: "file-in-multiple-layers",
              message: `file node "${nid}" appears in layer "${l.id}" but already assigned to layer "${nodeInLayer.get(nid)}" \u2014 removed from second layer`
            });
            continue;
          }
          nodeInLayer.set(nid, l.id);
        }
        filteredNodeIds.push(nid);
      }
      validLayers.push({
        id: l.id,
        name: l.name,
        description: typeof l.description === "string" ? l.description : "",
        nodeIds: filteredNodeIds
      });
    } else {
      issues.push({ level: "dropped", category: "invalid-layer", message: `layers[${i}]: invalid \u2014 removed` });
    }
  }
  for (const node of validNodes) {
    if (node.type === "file" && !nodeInLayer.has(node.id)) {
      const msg = `file node "${node.id}" is not assigned to any layer \u2014 file-in-exactly-one-layer invariant violated`;
      return {
        success: false,
        issues: [...issues, { level: "fatal", category: "file-in-zero-layers", message: msg }],
        fatal: msg
      };
    }
  }
  const validTour = [];
  for (let i = 0; i < (fixed.tour ?? []).length; i++) {
    const t = fixed.tour[i];
    if (t && typeof t.title === "string" && Array.isArray(t.nodeIds)) {
      validTour.push({
        order: typeof t.order === "number" ? t.order : i,
        title: t.title,
        description: typeof t.description === "string" ? t.description : "",
        nodeIds: t.nodeIds.filter((x) => nodeIds.has(x)),
        ...typeof t.languageLesson === "string" ? { languageLesson: t.languageLesson } : {}
      });
    } else {
      issues.push({ level: "dropped", category: "invalid-tour-step", message: `tour[${i}]: invalid \u2014 removed` });
    }
  }
  const graph = {
    version: "guild.knowledge_graph.v2",
    kind: "knowledge",
    generated_from_commit: typeof fixed.generated_from_commit === "string" ? fixed.generated_from_commit : "unknown",
    project: {
      name: project.name,
      description: typeof project.description === "string" ? project.description : ""
    },
    nodes: validNodes,
    edges: validEdges,
    layers: validLayers,
    tour: validTour
  };
  return { success: true, data: graph, issues };
}

// scripts/learn/validate-graph.ts
var KNOWLEDGE_GRAPH_V2 = "guild.knowledge_graph.v2";
function isV2Input(input) {
  return typeof input === "object" && input !== null && input["version"] === KNOWLEDGE_GRAPH_V2;
}
function isV2Result(data) {
  return typeof data === "object" && data !== null && data["version"] === KNOWLEDGE_GRAPH_V2;
}
function validateWithDispatch(input, repoRoot) {
  if (isV2Input(input)) {
    return validateGraphV2(input, { repoRoot });
  }
  return validateGraph(input);
}
function checkDowngradeGuard(knowledgeGraphPath, resultData, force) {
  const existing = readJson(knowledgeGraphPath);
  const onDiskVersion = typeof existing?.["version"] === "string" ? existing["version"] : void 0;
  const onDiskIsV2 = onDiskVersion === KNOWLEDGE_GRAPH_V2;
  const resultIsV2 = isV2Result(resultData);
  if (onDiskIsV2 && !resultIsV2 && !force) {
    return { refused: true, onDiskVersion };
  }
  return { refused: false, onDiskVersion };
}
function main() {
  const argv = process.argv.slice(2);
  const cwd = parseCwd(argv);
  const gp = guildPaths(cwd);
  let input;
  if (hasFlag(argv, "stdin")) {
    input = JSON.parse(fs3.readFileSync(0, "utf8"));
  } else {
    const inPath = parseFlag(argv, "in");
    const resolved = inPath ? path4.resolve(cwd, inPath) : gp.partialGraph;
    input = readJson(resolved);
    if (input === null) {
      process.stderr.write(`[validate] ERROR: cannot read input graph ${resolved}
`);
      process.exit(2);
    }
  }
  if (input && typeof input === "object") delete input._merge_report;
  const dispatchedV2 = isV2Input(input);
  const result = validateWithDispatch(input, gp.repoRoot);
  const counts = result.issues.reduce((m, i) => {
    m[i.level] = (m[i.level] ?? 0) + 1;
    return m;
  }, {});
  if (!result.success || !result.data) {
    process.stderr.write(`[validate] FATAL: ${result.fatal}
`);
    process.stdout.write(JSON.stringify({ success: false, fatal: result.fatal, issues: result.issues }, null, 2) + "\n");
    process.exit(2);
  }
  process.stderr.write(
    `[validate] OK (${dispatchedV2 ? "v2" : "v1"}) \xB7 nodes=${result.data.nodes.length} edges=${result.data.edges.length} layers=${result.data.layers.length} \xB7 auto-corrected=${counts["auto-corrected"] ?? 0} dropped=${counts["dropped"] ?? 0}
`
  );
  const dry = hasFlag(argv, "dry");
  const force = hasFlag(argv, "force");
  if (!dry) {
    const guard = checkDowngradeGuard(gp.knowledgeGraph, result.data, force);
    if (guard.refused) {
      const msg = `[validate] REFUSED: on-disk knowledge-graph.json is ${guard.onDiskVersion} (carries the knowledge tier \u2014 wiki_page/topic/diagram nodes + knowledge edges) but this run resolved a non-v2 result, which would silently strip that tier. Re-run the knowledge finalize (learn-knowledge) instead of this CLI, or pass --force to downgrade deliberately.
`;
      process.stderr.write(msg);
      process.stdout.write(
        JSON.stringify(
          { success: false, refused: "v2-downgrade-guard", onDiskVersion: guard.onDiskVersion },
          null,
          2
        ) + "\n"
      );
      process.exit(2);
    }
    if (guard.onDiskVersion === KNOWLEDGE_GRAPH_V2 && !isV2Result(result.data) && force) {
      process.stderr.write(
        `[validate] WARNING: --force downgrading on-disk ${guard.onDiskVersion} knowledge-graph.json to a non-v2 result \u2014 the knowledge tier will be lost.
`
      );
    }
  }
  if (!dry) {
    writeJson(gp.knowledgeGraph, result.data);
    process.stderr.write(`[validate] \u2192 ${path4.relative(gp.repoRoot, gp.knowledgeGraph)}
`);
  }
  if (hasFlag(argv, "print")) {
    process.stdout.write(JSON.stringify({ data: result.data, issues: result.issues }, null, 2) + "\n");
  } else {
    process.stdout.write(
      dry ? "validated (dry-run)\n" : path4.relative(gp.repoRoot, gp.knowledgeGraph) + "\n"
    );
  }
}
if (require.main === module) {
  main();
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  KNOWLEDGE_GRAPH_V2,
  checkDowngradeGuard,
  isV2Input,
  isV2Result,
  validateWithDispatch
});
