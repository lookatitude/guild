#!/usr/bin/env node
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __esm = (fn, res, err) => function __init() {
  if (err) throw err[0];
  try {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  } catch (e) {
    throw err = [e], e;
  }
};
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

// src/domains/kernel/sealed-collections.ts
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
var SEALED_BRAND;
var init_sealed_collections = __esm({
  "src/domains/kernel/sealed-collections.ts"() {
    SEALED_BRAND = /* @__PURE__ */ Symbol.for("guild.sealed_collection.v1");
  }
});

// scripts/learn/lib/schema.ts
function normalizeEntityName(name) {
  return name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9\-/]/g, "");
}
function makeTopicId(memberIds) {
  const sorted = [...memberIds].sort();
  return `topic:${sha8Hash(sorted.join("|"))}`;
}
function makeClaimId(anchor, text) {
  const normalized = text.trim().toLowerCase();
  return `claim:${anchor}:${sha8Hash(normalized + "\0" + anchor)}`;
}
function makeEntityId(name) {
  return `entity:${normalizeEntityName(name)}`;
}
function makeWikiPageId(relpath) {
  return `wiki_page:${relpath}`;
}
function makeDiagramId(anchor) {
  return `diagram:${anchor}`;
}
function makeConceptId(anchor, text) {
  const normalized = text.trim().toLowerCase();
  return `concept:${anchor}:${sha8Hash(normalized + "\0" + anchor)}`;
}
function sha8Hash(input) {
  return crypto.createHash("sha256").update(input).digest("hex").slice(0, 8);
}
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
  const absPath = path.resolve(repoRoot, relPath);
  try {
    if (!fs.existsSync(absPath)) return false;
  } catch {
    return false;
  }
  const fragment = anchorFragment(anchor);
  if (!fragment) {
    return true;
  }
  let content;
  try {
    content = fs.readFileSync(absPath, "utf8");
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
  function getDepth2(nodeId, callStack) {
    if (depths.has(nodeId)) return depths.get(nodeId);
    if (callStack.has(nodeId)) return 0;
    const parent = childToParent.get(nodeId);
    if (!parent || !nodeIds.has(parent)) {
      depths.set(nodeId, 0);
      return 0;
    }
    callStack.add(nodeId);
    const d = getDepth2(parent, callStack) + 1;
    callStack.delete(nodeId);
    depths.set(nodeId, d);
    return d;
  }
  for (const id of nodeIds) {
    const d = getDepth2(id, /* @__PURE__ */ new Set());
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
var fs, path, crypto, NODE_TYPES, NODE_TYPES_V2, EDGE_TYPES, EDGE_TYPES_V2, NODE_CATEGORIES, KNOWLEDGE_CONFIG_DEFAULTS, DIRECTIONS, CONFIDENCE, NODE_TYPE_ALIASES, EDGE_TYPE_ALIASES, DIRECTION_ALIASES, KNOWLEDGE_NODE_TYPES_V2;
var init_schema = __esm({
  "scripts/learn/lib/schema.ts"() {
    fs = __toESM(require("fs"));
    init_sealed_collections();
    path = __toESM(require("path"));
    crypto = __toESM(require("crypto"));
    NODE_TYPES = sealSet([
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
    NODE_TYPES_V2 = sealSet([
      ...NODE_TYPES,
      "wiki_page",
      // first-class in v2; v1 aliased this to article — alias removed
      "diagram"
      // new in v2: fenced mermaid blocks, .svg files
    ], "NODE_TYPES_V2");
    EDGE_TYPES = sealSet([
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
    EDGE_TYPES_V2 = sealSet([
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
    NODE_CATEGORIES = sealSet([
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
    KNOWLEDGE_CONFIG_DEFAULTS = {
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
    DIRECTIONS = sealSet(["out", "in", "bi"], "DIRECTIONS");
    CONFIDENCE = sealSet(["high", "medium", "low"], "CONFIDENCE");
    NODE_TYPE_ALIASES = {
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
    EDGE_TYPE_ALIASES = {
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
    DIRECTION_ALIASES = {
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
    KNOWLEDGE_NODE_TYPES_V2 = /* @__PURE__ */ new Set([
      "topic",
      "concept",
      "claim",
      "entity",
      "wiki_page",
      "diagram"
    ]);
  }
});

// scripts/learn/cross-link.ts
var cross_link_exports = {};
__export(cross_link_exports, {
  buildCrossLinks: () => buildCrossLinks,
  distinctLowerKeyTerms: () => distinctLowerKeyTerms,
  escapeRegex: () => escapeRegex,
  extractHeadingTexts: () => extractHeadingTexts,
  extractKeyTerms: () => extractKeyTerms,
  fileFromSourceRef: () => fileFromSourceRef,
  funcNameFromId: () => funcNameFromId,
  nameSlugTokens: () => nameSlugTokens,
  proposeCandidates: () => proposeCandidates,
  sharedPrefixLen: () => sharedPrefixLen,
  wordBoundaryRegex: () => wordBoundaryRegex
});
function fileFromSourceRef(ref) {
  const hashIdx = ref.indexOf("#");
  return hashIdx === -1 ? ref : ref.slice(0, hashIdx);
}
function funcNameFromId(nodeId) {
  if (!nodeId.startsWith("function:")) return null;
  const parts = nodeId.split(":");
  return parts.length >= 3 ? parts[parts.length - 1] : null;
}
function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function wordBoundaryRegex(term, flags = "") {
  return new RegExp(`\\b${escapeRegex(term)}\\b`, flags);
}
function nameSlugTokens(name) {
  return name.toLowerCase().split(/[\s\-_]+/).filter((t) => t.length > 0);
}
function sharedPrefixLen(a, b) {
  const min = Math.min(a.length, b.length);
  let i = 0;
  while (i < min && a[i] === b[i]) i++;
  return i;
}
function extractKeyTerms(text) {
  return text.replace(/[^a-zA-Z\s]/g, " ").split(/\s+/).filter((w) => w.length >= 4 && !STOPWORDS.has(w.toLowerCase()));
}
function distinctLowerKeyTerms(text) {
  return [...new Set(extractKeyTerms(text).map((w) => w.toLowerCase()))];
}
function extractHeadingTexts(content) {
  const out = [];
  const headingRe = /^#{1,6}\s+(.+)$/gm;
  let m;
  while ((m = headingRe.exec(content)) !== null) out.push(m[1].trim());
  return out;
}
function safeReadFile(repoRoot, relPath) {
  try {
    return fs7.readFileSync(path7.join(repoRoot, relPath), "utf-8");
  } catch {
    return null;
  }
}
function proposeCandidates(repoRoot, nodes, _existingEdges) {
  const seen = /* @__PURE__ */ new Set();
  const unsorted = [];
  function addIfNew(c) {
    const key = `${c.source}\u2192${c.target}:${c.type}`;
    if (!seen.has(key)) {
      seen.add(key);
      unsorted.push(c);
    }
  }
  const claims = nodes.filter((n) => n.type === "claim");
  const functions = nodes.filter((n) => n.type === "function");
  const topics = nodes.filter((n) => n.type === "topic");
  const entities = nodes.filter((n) => n.type === "entity");
  const wikiPages = nodes.filter((n) => n.type === "wiki_page");
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i];
      const b = nodes[j];
      const filesA = (a.source_refs ?? []).map(fileFromSourceRef);
      const filesB = (b.source_refs ?? []).map(fileFromSourceRef);
      const sharesFile = filesA.some((f) => f && filesB.includes(f));
      if (sharesFile) {
        addIfNew({ source: a.id, target: b.id, type: "evidenced_by", reason: "shared_file" });
        addIfNew({ source: b.id, target: a.id, type: "evidenced_by", reason: "shared_file" });
      }
    }
  }
  for (const fn of functions) {
    const fnName = funcNameFromId(fn.id);
    if (!fnName) continue;
    const fnRe = wordBoundaryRegex(fnName, "");
    for (const doc of [...claims, ...topics, ...wikiPages]) {
      const ref = (doc.source_refs ?? [])[0];
      if (!ref) continue;
      const content = safeReadFile(repoRoot, fileFromSourceRef(ref));
      if (content && fnRe.test(content)) {
        addIfNew({ source: doc.id, target: fn.id, type: "evidenced_by", reason: "func_in_doc" });
      }
    }
  }
  for (const claim of claims) {
    const terms = extractKeyTerms(claim.name ?? "");
    if (terms.length === 0) continue;
    for (const fn of functions) {
      const ref = (fn.source_refs ?? [])[0];
      if (!ref) continue;
      const content = safeReadFile(repoRoot, fileFromSourceRef(ref));
      if (!content) continue;
      const matchCount = terms.filter((t) => wordBoundaryRegex(t, "").test(content)).length;
      if (matchCount >= 2) {
        addIfNew({
          source: claim.id,
          target: fn.id,
          type: "evidenced_by",
          reason: "claim_term_in_code"
        });
      }
    }
  }
  for (const fn of functions) {
    const ref = (fn.source_refs ?? [])[0];
    if (!ref) continue;
    const content = safeReadFile(repoRoot, fileFromSourceRef(ref));
    if (!content) continue;
    for (const entity of entities) {
      const entityName = (entity.name ?? "").trim();
      if (!entityName) continue;
      if (wordBoundaryRegex(entityName, "i").test(content)) {
        addIfNew({
          source: fn.id,
          target: entity.id,
          type: "mentions",
          reason: "entity_in_code"
        });
      }
    }
  }
  for (const entity of entities) {
    const entityTokens = nameSlugTokens(entity.name ?? "");
    if (entityTokens.length === 0) continue;
    for (const topic of topics) {
      const topicTokens = nameSlugTokens(topic.name ?? "");
      if (topicTokens.length === 0) continue;
      const hasOverlap = entityTokens.some(
        (et) => topicTokens.some((tt) => sharedPrefixLen(et, tt) >= 4)
      );
      if (hasOverlap) {
        addIfNew({
          source: entity.id,
          target: topic.id,
          type: "relates_to",
          reason: "name_token_overlap"
        });
      }
    }
  }
  const topicTermIndex = topics.map((t) => {
    const tp = t.topic_path ?? [];
    const ownLeaf = tp.length > 0 ? tp[tp.length - 1] : "";
    return {
      id: t.id,
      idTerms: distinctLowerKeyTerms(`${t.name ?? ""} ${ownLeaf}`),
      sourceContent: (t.source_refs ?? []).map((r) => safeReadFile(repoRoot, fileFromSourceRef(r)) ?? "").join("\n")
    };
  });
  const wikiTermIndex = wikiPages.map((w) => {
    const bodyRef = (w.source_refs ?? [])[0];
    const body = bodyRef ? safeReadFile(repoRoot, fileFromSourceRef(bodyRef)) ?? "" : "";
    const headings = extractHeadingTexts(body);
    return {
      id: w.id,
      idTerms: distinctLowerKeyTerms(
        `${w.name ?? ""} ${headings.join(" ")} ${(w.labels ?? []).join(" ")}`
      ),
      body
    };
  });
  if (topicTermIndex.length > 0 && wikiTermIndex.length > 0) {
    const T = topicTermIndex.length;
    const W = wikiTermIndex.length;
    const N = T + W;
    const DF_RATIO = 0.5;
    const DF_MIN_ABS = 3;
    const TOP_K = 3;
    const inText = (term, text) => wordBoundaryRegex(term, "i").test(text);
    const idDf = /* @__PURE__ */ new Map();
    for (const t of topicTermIndex)
      for (const term of t.idTerms) idDf.set(term, (idDf.get(term) ?? 0) + 1);
    for (const w of wikiTermIndex)
      for (const term of w.idTerms) idDf.set(term, (idDf.get(term) ?? 0) + 1);
    const wikiBodyDf = /* @__PURE__ */ new Map();
    for (const t of topicTermIndex) {
      for (const term of t.idTerms) {
        if (wikiBodyDf.has(term)) continue;
        let c = 0;
        for (const w of wikiTermIndex) if (inText(term, w.body)) c++;
        wikiBodyDf.set(term, c);
      }
    }
    const topicSrcDf = /* @__PURE__ */ new Map();
    for (const w of wikiTermIndex) {
      for (const term of w.idTerms) {
        if (topicSrcDf.has(term)) continue;
        let c = 0;
        for (const t of topicTermIndex) if (inText(term, t.sourceContent)) c++;
        topicSrcDf.set(term, c);
      }
    }
    const isBoilerplate = (df, term, corpus) => {
      const d = df.get(term) ?? 0;
      return d >= DF_MIN_ABS && d > corpus * DF_RATIO;
    };
    const TOP_K_TOPIC = Math.max(TOP_K, Math.ceil(W / 2));
    const wikiHasDiscriminative = /* @__PURE__ */ new Set();
    const perWikiRanked = /* @__PURE__ */ new Map();
    for (const w of wikiTermIndex) {
      const wikiIdSet = new Set(w.idTerms);
      const scored = [];
      for (const t of topicTermIndex) {
        const bridge = /* @__PURE__ */ new Set();
        let idSharedCount = 0;
        for (const tt of t.idTerms) {
          if (wikiIdSet.has(tt) && !isBoilerplate(idDf, tt, N)) {
            bridge.add(tt);
            idSharedCount++;
          }
        }
        for (const tt of t.idTerms) {
          if (!isBoilerplate(wikiBodyDf, tt, W) && inText(tt, w.body)) {
            bridge.add(tt);
          }
        }
        for (const ww of w.idTerms) {
          if (!isBoilerplate(topicSrcDf, ww, T) && inText(ww, t.sourceContent)) {
            bridge.add(ww);
          }
        }
        if (idSharedCount >= 1 && bridge.size >= 2) {
          scored.push({ topicId: t.id, score: idSharedCount * 100 + bridge.size });
        }
      }
      scored.sort(
        (a, b) => b.score !== a.score ? b.score - a.score : a.topicId < b.topicId ? -1 : a.topicId > b.topicId ? 1 : 0
      );
      if (scored.length > 0) {
        wikiHasDiscriminative.add(w.id);
        perWikiRanked.set(w.id, scored.slice(0, TOP_K));
      }
    }
    const intended = /* @__PURE__ */ new Map();
    const pageDegree = /* @__PURE__ */ new Map();
    const topicLoad = /* @__PURE__ */ new Map();
    for (const [wikiId, ranked] of perWikiRanked) {
      for (const r of ranked) {
        const key = `${r.topicId}\u2192${wikiId}`;
        if (intended.has(key)) continue;
        intended.set(key, { topicId: r.topicId, wikiId, score: r.score });
        pageDegree.set(wikiId, (pageDegree.get(wikiId) ?? 0) + 1);
        topicLoad.set(r.topicId, (topicLoad.get(r.topicId) ?? 0) + 1);
      }
    }
    const dropped = /* @__PURE__ */ new Set();
    const overCapTopics = [...topicLoad.keys()].filter((t) => (topicLoad.get(t) ?? 0) > TOP_K_TOPIC).sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
    for (const topicId of overCapTopics) {
      const edges = [...intended.values()].filter(
        (e) => e.topicId === topicId && !dropped.has(`${topicId}\u2192${e.wikiId}`)
      ).sort(
        (a, b) => a.score !== b.score ? a.score - b.score : a.wikiId < b.wikiId ? 1 : a.wikiId > b.wikiId ? -1 : 0
      );
      for (const e of edges) {
        if ((topicLoad.get(topicId) ?? 0) <= TOP_K_TOPIC) break;
        if ((pageDegree.get(e.wikiId) ?? 0) > 1) {
          dropped.add(`${topicId}\u2192${e.wikiId}`);
          pageDegree.set(e.wikiId, (pageDegree.get(e.wikiId) ?? 0) - 1);
          topicLoad.set(topicId, (topicLoad.get(topicId) ?? 0) - 1);
        }
      }
    }
    for (const [key, e] of intended) {
      if (dropped.has(key)) continue;
      addIfNew({
        source: e.topicId,
        target: e.wikiId,
        type: "evidenced_by",
        reason: "wiki_topic_term_overlap"
      });
    }
    const emittedTopicLoad = /* @__PURE__ */ new Map();
    for (const [key, e] of intended) {
      if (dropped.has(key)) continue;
      emittedTopicLoad.set(
        e.topicId,
        (emittedTopicLoad.get(e.topicId) ?? 0) + 1
      );
    }
    const topicsById = [...topicTermIndex].sort(
      (a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0
    );
    const orphanWikis = wikiTermIndex.filter((w) => !wikiHasDiscriminative.has(w.id)).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    const loadOf = (id) => emittedTopicLoad.get(id) ?? 0;
    const byPreference = (a, b) => b.raw !== a.raw ? b.raw - a.raw : loadOf(a.topicId) !== loadOf(b.topicId) ? loadOf(a.topicId) - loadOf(b.topicId) : a.topicId < b.topicId ? -1 : a.topicId > b.topicId ? 1 : 0;
    for (const w of orphanWikis) {
      const wikiIdSet = new Set(w.idTerms);
      const ranked = topicsById.map((t) => {
        const raw = /* @__PURE__ */ new Set();
        for (const tt of t.idTerms) {
          if (wikiIdSet.has(tt)) raw.add(tt);
          if (inText(tt, w.body)) raw.add(tt);
        }
        for (const ww of w.idTerms) {
          if (inText(ww, t.sourceContent)) raw.add(ww);
        }
        return { topicId: t.id, raw: raw.size };
      });
      const positives = ranked.filter((r) => r.raw > 0).sort(byPreference);
      let chosen = null;
      for (const r of positives) {
        if (loadOf(r.topicId) < TOP_K_TOPIC) {
          chosen = r.topicId;
          break;
        }
      }
      if (!chosen && positives.length > 0) chosen = positives[0].topicId;
      if (!chosen) {
        const spread = [...ranked].sort(byPreference);
        chosen = spread.length > 0 ? spread[0].topicId : null;
      }
      if (chosen) {
        addIfNew({
          source: chosen,
          target: w.id,
          type: "evidenced_by",
          reason: "wiki_topic_term_overlap"
        });
        emittedTopicLoad.set(chosen, loadOf(chosen) + 1);
      }
    }
  }
  return unsorted.sort((a, b) => {
    if (a.source !== b.source) return a.source < b.source ? -1 : 1;
    if (a.target !== b.target) return a.target < b.target ? -1 : 1;
    return a.type < b.type ? -1 : 1;
  });
}
async function buildCrossLinks(repoRoot, input, opts) {
  if (!opts || !opts.confirmCrossLinks) {
    throw new Error(
      "cross-link: LLM adapter (confirmCrossLinks) is required but was not provided. Inject a ConfirmCrossLinksFn via opts.confirmCrossLinks."
    );
  }
  const relMinConf = opts.relMinConf ?? 0.5;
  const candidates = proposeCandidates(repoRoot, input.nodes, input.edges);
  const candidateKeys = new Set(
    candidates.map((c) => `${c.source}\u2192${c.target}:${c.type}`)
  );
  const rawEdges = await opts.confirmCrossLinks(input.nodes, candidates, { relMinConf });
  const existingKeys = new Set(
    input.edges.map((e) => `${e.source}\u2192${e.target}:${e.type}`)
  );
  const nodeById = new Map(input.nodes.map((n) => [n.id, n]));
  const result = [];
  for (const edge of rawEdges) {
    const edgeKey = `${edge.source}\u2192${edge.target}:${edge.type}`;
    if (!candidateKeys.has(edgeKey)) continue;
    if (edge.weight < relMinConf) continue;
    if (existingKeys.has(edgeKey)) continue;
    if (edge.type === "evidenced_by") {
      const targetNode = nodeById.get(edge.target);
      if (!targetNode) continue;
      const refs = targetNode.source_refs ?? [];
      const anyResolves = refs.some((r) => resolveAnchor(repoRoot, r));
      if (!anyResolves) continue;
    }
    result.push(edge);
    existingKeys.add(edgeKey);
  }
  return { edges: result };
}
var fs7, path7, STOPWORDS;
var init_cross_link = __esm({
  "scripts/learn/cross-link.ts"() {
    fs7 = __toESM(require("fs"));
    path7 = __toESM(require("path"));
    init_schema();
    STOPWORDS = /* @__PURE__ */ new Set([
      // Linguistic stop-words
      "a",
      "an",
      "the",
      "is",
      "are",
      "was",
      "were",
      "be",
      "been",
      "it",
      "its",
      "of",
      "in",
      "to",
      "for",
      "on",
      "at",
      "by",
      "and",
      "or",
      "not",
      "so",
      "no",
      "never",
      "every",
      "all",
      "any",
      "each",
      "that",
      "this",
      "these",
      "those",
      "has",
      "have",
      "had",
      "do",
      "does",
      "did",
      "will",
      "would",
      "could",
      "should",
      "may",
      "might",
      "must",
      "can",
      "with",
      "from",
      "before",
      "after",
      "once",
      "which",
      "what",
      "when",
      "where",
      "who",
      "how",
      "as",
      "only",
      // Generic tech terms — too common to be a discriminative signal
      "event",
      "events",
      "data",
      "type",
      "types",
      "valid",
      "check",
      "error",
      "value",
      "object",
      "input",
      "output",
      "result",
      "handle",
      "create",
      "update",
      "delete",
      "process",
      "service",
      "request",
      "response",
      "method",
      "class",
      "function",
      "return",
      "param",
      "item",
      "list",
      "node",
      "file",
      // Structural / pronoun fillers — too common to discriminate a wiki↔topic link
      // (Rule 6). Added per L14: "module" appears in every auto-named topic ("X
      // Module"), "wiki"/"page" in every wiki node, and the pronoun set survives the
      // 4-char floor without carrying signal.
      "module",
      "modules",
      "wiki",
      "page",
      "pages",
      "they",
      "them",
      "their",
      "there",
      "then",
      "than",
      "here",
      "such",
      "into",
      "your",
      "our",
      "also"
    ]);
  }
});

// scripts/learn/knowledge-orchestrator.ts
var knowledge_orchestrator_exports = {};
__export(knowledge_orchestrator_exports, {
  FALLBACK_ROOT_TOPIC_NAME: () => FALLBACK_ROOT_TOPIC_NAME,
  FALLBACK_ROOT_TOPIC_SEED: () => FALLBACK_ROOT_TOPIC_SEED,
  buildFileBackedSeams: () => buildFileBackedSeams,
  deriveFallbackRootTopicName: () => deriveFallbackRootTopicName,
  discoverFilePaths: () => discoverFilePaths,
  emitRound1Candidates: () => emitRound1Candidates,
  emitRound2Candidates: () => emitRound2Candidates,
  findOrphanWikiPages: () => findOrphanWikiPages,
  maybeSynthesizeFallbackRootTopic: () => maybeSynthesizeFallbackRootTopic,
  runKnowledgeStages: () => runKnowledgeStages
});
module.exports = __toCommonJS(knowledge_orchestrator_exports);
var fs10 = __toESM(require("fs"));
var path10 = __toESM(require("path"));

// scripts/learn/content-analyze.ts
var fs2 = __toESM(require("fs"));
var path3 = __toESM(require("path"));
init_schema();

// scripts/learn/lib/languages.ts
var path2 = __toESM(require("path"));
var EXT_LANG = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".mts": "typescript",
  ".cts": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".py": "python",
  ".rb": "ruby",
  ".go": "go",
  ".rs": "rust",
  ".java": "java",
  ".kt": "kotlin",
  ".kts": "kotlin",
  ".swift": "swift",
  ".c": "c",
  ".h": "c",
  ".cc": "cpp",
  ".cpp": "cpp",
  ".cxx": "cpp",
  ".hpp": "cpp",
  ".cs": "csharp",
  ".php": "php",
  ".scala": "scala",
  ".clj": "clojure",
  ".ex": "elixir",
  ".exs": "elixir",
  ".dart": "dart",
  ".sh": "shell",
  ".bash": "shell",
  ".sql": "sql",
  ".graphql": "graphql",
  ".gql": "graphql",
  ".proto": "protobuf",
  ".tf": "terraform",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".json": "json",
  ".md": "markdown",
  ".mdx": "markdown",
  ".toml": "toml",
  ".html": "html",
  ".css": "css",
  ".scss": "scss",
  ".vue": "vue",
  ".svelte": "svelte"
};
var BASENAME_LANG = {
  Dockerfile: "dockerfile",
  Makefile: "makefile",
  ".gitignore": "config"
};
function detectLanguage(filePath) {
  const base = path2.basename(filePath);
  if (BASENAME_LANG[base]) return BASENAME_LANG[base];
  const ext = path2.extname(filePath).toLowerCase();
  return EXT_LANG[ext] ?? "unknown";
}
function isCodeLanguage(lang) {
  return [
    "typescript",
    "javascript",
    "python",
    "ruby",
    "go",
    "rust",
    "java",
    "kotlin",
    "swift",
    "c",
    "cpp",
    "csharp",
    "php",
    "scala",
    "dart"
  ].includes(lang);
}

// scripts/learn/lib/extract.ts
var BRANCH_KW = /\b(if|else|for|while|switch|case|catch|&&|\|\||\?\.|=>|return)\b/g;
function complexityScore(loc, branchCount) {
  const sizeC = Math.min(1, loc / 600);
  const branchC = Math.min(1, branchCount / 120);
  return Math.round((0.55 * sizeC + 0.45 * branchC) * 100) / 100;
}
function blockEnd(lines, start) {
  let depth = 0;
  let seen = false;
  for (let i = start; i < lines.length; i++) {
    for (const ch of lines[i]) {
      if (ch === "{") {
        depth++;
        seen = true;
      } else if (ch === "}") {
        depth--;
        if (seen && depth === 0) return i + 1;
      }
    }
  }
  return Math.min(lines.length, start + 1);
}
function indentEnd(lines, start) {
  const base = lines[start].match(/^\s*/)?.[0].length ?? 0;
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].trim() === "") continue;
    const ind = lines[i].match(/^\s*/)?.[0].length ?? 0;
    if (ind <= base) return i;
  }
  return lines.length;
}
function analyzeJsTs(lines, lang) {
  const functions = [];
  const classes = [];
  const imports = [];
  const exports2 = [];
  const reImport = /^\s*import\s+(?:type\s+)?(?:(\*\s+as\s+\w+|\{[^}]*\}|\w+)(?:\s*,\s*(\{[^}]*\}))?\s+from\s+)?["']([^"']+)["']/;
  const reRequire = /(?:const|let|var)\s+(\{[^}]*\}|\w+)\s*=\s*require\(\s*["']([^"']+)["']\s*\)/;
  const reFn = /^\s*(export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/;
  const reArrow = /^\s*(export\s+)?(?:default\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s*)?\([^)]*\)\s*(?::[^=]+)?=>/;
  const reClass = /^\s*(export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/;
  const reExport = /^\s*export\s+(?:default\s+)?(?:const|let|var|function|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/;
  const reExportList = /^\s*export\s*\{([^}]*)\}/;
  const reMethod = /^\s*(?:public|private|protected|static|async|get|set|\s)*([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{?/;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const mImp = line.match(reImport);
    if (mImp) {
      const specRaw = (mImp[1] ?? "") + (mImp[2] ? "," + mImp[2] : "");
      const specifiers = specRaw.replace(/[{}*]/g, "").split(",").map((s) => s.replace(/\s+as\s+\w+/, "").trim()).filter(Boolean);
      imports.push({ source: mImp[3], specifiers });
      continue;
    }
    const mReq = line.match(reRequire);
    if (mReq) {
      imports.push({
        source: mReq[2],
        specifiers: mReq[1].replace(/[{}]/g, "").split(",").map((s) => s.trim()).filter(Boolean)
      });
      continue;
    }
    const mClass = line.match(reClass);
    if (mClass) {
      const end = blockEnd(lines, i);
      const methods = [];
      for (let j = i + 1; j < end - 1; j++) {
        const mm = lines[j].match(reMethod);
        if (mm && !/^\s*(if|for|while|switch|catch|return)\b/.test(lines[j])) {
          methods.push(mm[1]);
        }
      }
      classes.push({
        name: mClass[2],
        lineRange: [i + 1, end],
        exported: Boolean(mClass[1]),
        methods: [...new Set(methods)]
      });
      if (mClass[1]) exports2.push(mClass[2]);
      continue;
    }
    const mFn = line.match(reFn);
    if (mFn) {
      functions.push({
        name: mFn[2],
        lineRange: [i + 1, blockEnd(lines, i)],
        exported: Boolean(mFn[1])
      });
      if (mFn[1]) exports2.push(mFn[2]);
      continue;
    }
    const mArrow = line.match(reArrow);
    if (mArrow) {
      functions.push({
        name: mArrow[2],
        lineRange: [i + 1, blockEnd(lines, i)],
        exported: Boolean(mArrow[1])
      });
      if (mArrow[1]) exports2.push(mArrow[2]);
      continue;
    }
    const mExp = line.match(reExport);
    if (mExp) exports2.push(mExp[1]);
    const mExpList = line.match(reExportList);
    if (mExpList) {
      for (const s of mExpList[1].split(",")) {
        const name = s.replace(/\s+as\s+\w+/, "").trim();
        if (name) exports2.push(name);
      }
    }
  }
  return finalize(lines, lang, functions, classes, imports, exports2);
}
function analyzePython(lines) {
  const functions = [];
  const classes = [];
  const imports = [];
  const exports2 = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const mFrom = line.match(/^\s*from\s+([.\w]+)\s+import\s+(.+)$/);
    if (mFrom) {
      imports.push({
        source: mFrom[1],
        specifiers: mFrom[2].replace(/[()]/g, "").split(",").map((s) => s.split(" as ")[0].trim()).filter(Boolean)
      });
      continue;
    }
    const mImp = line.match(/^\s*import\s+(.+)$/);
    if (mImp && !mFrom) {
      for (const part of mImp[1].split(",")) {
        const mod = part.trim().split(" as ")[0].trim();
        if (mod) imports.push({ source: mod, specifiers: [] });
      }
      continue;
    }
    const mClass = line.match(/^(\s*)class\s+([A-Za-z_]\w*)/);
    if (mClass) {
      const end = indentEnd(lines, i);
      const methods = [];
      for (let j = i + 1; j < end; j++) {
        const mm = lines[j].match(/^\s+def\s+([A-Za-z_]\w*)/);
        if (mm) methods.push(mm[1]);
      }
      const top = (mClass[1]?.length ?? 0) === 0;
      classes.push({ name: mClass[2], lineRange: [i + 1, end], exported: top, methods });
      if (top) exports2.push(mClass[2]);
      continue;
    }
    const mDef = line.match(/^(\s*)def\s+([A-Za-z_]\w*)/);
    if (mDef) {
      const top = (mDef[1]?.length ?? 0) === 0;
      functions.push({ name: mDef[2], lineRange: [i + 1, indentEnd(lines, i)], exported: top });
      if (top) exports2.push(mDef[2]);
    }
  }
  return finalize(lines, "python", functions, classes, imports, exports2);
}
function analyzeGeneric(lines, lang) {
  const functions = [];
  const classes = [];
  const imports = [];
  const exports2 = [];
  const reImp = /^\s*(?:import|use|#include|require_relative|require)\s+["'<]?([\w./:-]+)/;
  const reClass = /^\s*(?:pub\s+)?(?:public\s+|final\s+|abstract\s+|static\s+)*(?:class|struct|interface|enum|trait)\s+([A-Za-z_]\w*)/;
  const reFn = /^\s*(?:pub\s+|public\s+|private\s+|protected\s+|static\s+|async\s+|func\s+|fn\s+|def\s+)+?\s*([A-Za-z_]\w*)\s*\(/;
  const reGoFn = /^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)\s*\(/;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const mImp = line.match(reImp);
    if (mImp) {
      imports.push({ source: mImp[1], specifiers: [] });
      continue;
    }
    const mClass = line.match(reClass);
    if (mClass) {
      classes.push({ name: mClass[1], lineRange: [i + 1, blockEnd(lines, i)], exported: true, methods: [] });
      continue;
    }
    const mGo = line.match(reGoFn);
    if (mGo) {
      functions.push({ name: mGo[1], lineRange: [i + 1, blockEnd(lines, i)], exported: /^[A-Z]/.test(mGo[1]) });
      continue;
    }
    const mFn = line.match(reFn);
    if (mFn && !/\b(if|for|while|switch|return)\b/.test(mFn[1])) {
      functions.push({ name: mFn[1], lineRange: [i + 1, blockEnd(lines, i)], exported: true });
    }
  }
  return finalize(lines, lang, functions, classes, imports, exports2);
}
function finalize(lines, language, functions, classes, imports, exports2) {
  const text = lines.join("\n");
  const loc = lines.filter((l) => l.trim() !== "").length;
  const branchCount = (text.match(BRANCH_KW) ?? []).length;
  return {
    language,
    loc,
    complexity: complexityScore(loc, branchCount),
    functions,
    classes,
    imports,
    exports: [...new Set(exports2)]
  };
}
function analyzeSource(filePath, content) {
  const lang = detectLanguage(filePath);
  const lines = content.split("\n");
  if (lang === "typescript" || lang === "javascript") return analyzeJsTs(lines, lang);
  if (lang === "python") return analyzePython(lines);
  if (["go", "rust", "java", "kotlin", "swift", "c", "cpp", "csharp", "php", "scala", "dart"].includes(lang)) {
    return analyzeGeneric(lines, lang);
  }
  return null;
}

// scripts/learn/content-analyze.ts
function headingSlug(rawText) {
  return rawText.trim().toLowerCase().replace(/[^\w\s-]/g, "").replace(/\s+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}
function extractDocCommentCandidates(repoRoot, codeRelPaths) {
  const results = [];
  for (const relPath of codeRelPaths) {
    const absPath = path3.join(repoRoot, relPath);
    let content;
    try {
      content = fs2.readFileSync(absPath, "utf8");
    } catch {
      continue;
    }
    const lines = content.split("\n");
    let startIdx = -1;
    let endIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trimStart();
      if (startIdx === -1) {
        if (trimmed.startsWith("#!") || trimmed === "") continue;
        if (trimmed.startsWith("/**")) {
          startIdx = i;
          if (trimmed.includes("*/", 3)) {
            endIdx = i;
            break;
          }
        } else {
          break;
        }
      } else {
        if (trimmed.startsWith("*/") || trimmed.endsWith("*/")) {
          endIdx = i;
          break;
        }
      }
    }
    if (startIdx === -1 || endIdx === -1) continue;
    const bodyLines = lines.slice(startIdx, endIdx + 1).map((line) => {
      return line.replace(/^\s*\/\*\*\s?/, "").replace(/^\s*\*\/\s*$/, "").replace(/^\s*\*\s?/, "").trimEnd();
    });
    const rawText = bodyLines.filter((l) => l !== "").join("\n").trim();
    if (!rawText) continue;
    const startLine = startIdx + 1;
    const endLine = endIdx + 1;
    const anchor = `${relPath}#L${startLine}-L${endLine}`;
    results.push({ relPath, anchor, rawText });
  }
  return results;
}
function extractHeadingCandidates(repoRoot, docRelPaths) {
  const results = [];
  for (const relPath of docRelPaths) {
    const absPath = path3.join(repoRoot, relPath);
    let content;
    try {
      content = fs2.readFileSync(absPath, "utf8");
    } catch {
      continue;
    }
    const headingRe = /^(#{1,6})\s+(.+)$/gm;
    let m;
    while ((m = headingRe.exec(content)) !== null) {
      const level = m[1].length;
      const text = m[2].trim();
      const slug = headingSlug(text);
      if (!slug) continue;
      const anchor = `${relPath}#${slug}`;
      results.push({ relPath, level, text, anchor });
    }
  }
  return results;
}
function extractClaimSections(repoRoot, docRelPaths) {
  const results = [];
  for (const relPath of docRelPaths) {
    const absPath = path3.join(repoRoot, relPath);
    let content;
    try {
      content = fs2.readFileSync(absPath, "utf8");
    } catch {
      continue;
    }
    const lines = content.split("\n");
    let currentAnchor = null;
    let proseLines = [];
    const flushSection = () => {
      if (currentAnchor === null) return;
      const text = proseLines.join("\n").replace(/```[\s\S]*?```/g, "").trim();
      if (text) results.push({ relPath, anchor: currentAnchor, text });
      proseLines = [];
    };
    for (const line of lines) {
      const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
      if (headingMatch) {
        flushSection();
        const text = headingMatch[2].trim();
        const slug = headingSlug(text);
        currentAnchor = slug ? `${relPath}#${slug}` : null;
      } else {
        if (currentAnchor !== null) proseLines.push(line);
      }
    }
    flushSection();
  }
  return results;
}
function extractMermaidEntries(repoRoot, docRelPaths) {
  const results = [];
  for (const relPath of docRelPaths) {
    const absPath = path3.join(repoRoot, relPath);
    let content;
    try {
      content = fs2.readFileSync(absPath, "utf8");
    } catch {
      continue;
    }
    const mermaidRe = /^```mermaid\s*\n([\s\S]*?)^```/gm;
    let m;
    let blockIndex = 0;
    while ((m = mermaidRe.exec(content)) !== null) {
      const anchor = `${relPath}#mermaid-${blockIndex}`;
      const blockContent = m[1].trim();
      if (blockContent) {
        results.push({ anchor, content: blockContent });
        blockIndex++;
      }
    }
  }
  return results;
}
function extractFunctionIds(repoRoot, codeRelPaths) {
  const results = [];
  for (const relPath of codeRelPaths) {
    const absPath = path3.join(repoRoot, relPath);
    let content;
    try {
      content = fs2.readFileSync(absPath, "utf8");
    } catch {
      continue;
    }
    const analysis = analyzeSource(relPath, content);
    if (!analysis) continue;
    for (const fn of analysis.functions) {
      if (!fn.exported) continue;
      results.push(`function:${relPath}:${fn.name}`);
    }
  }
  return results;
}
function buildContentClusters(codeRelPaths, functionIds, docSections, mermaidEntries) {
  const results = [];
  const seen = /* @__PURE__ */ new Set();
  const addCluster = (memberIds) => {
    if (memberIds.length < 2) return;
    const sorted = [...memberIds].sort();
    const key = sorted.join("|");
    if (seen.has(key)) return;
    seen.add(key);
    results.push({ memberIds: sorted });
  };
  const funcNameToIds = /* @__PURE__ */ new Map();
  const funcIdToFileId = /* @__PURE__ */ new Map();
  for (const funcId of functionIds) {
    const parts = funcId.split(":");
    if (parts.length === 3) {
      const funcName = parts[2];
      const relPath = parts[1];
      const existing = funcNameToIds.get(funcName);
      if (existing) {
        existing.push(funcId);
      } else {
        funcNameToIds.set(funcName, [funcId]);
      }
      funcIdToFileId.set(funcId, `file:${relPath}`);
    }
  }
  const funcNamePatterns = /* @__PURE__ */ new Map();
  for (const [funcName] of funcNameToIds) {
    const escaped = funcName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    funcNamePatterns.set(funcName, new RegExp(`\\b${escaped}\\b`));
  }
  for (const relPath of codeRelPaths) {
    const fileId = `file:${relPath}`;
    const prefix = `function:${relPath}:`;
    const fileFunctionIds = functionIds.filter((id) => id.startsWith(prefix));
    if (fileFunctionIds.length > 0) {
      addCluster([fileId, ...fileFunctionIds]);
    }
  }
  for (const section of docSections) {
    const fileIdsMentioned = /* @__PURE__ */ new Set();
    for (const [funcName, funcIds] of funcNameToIds) {
      if (funcNamePatterns.get(funcName).test(section.text)) {
        for (const funcId of funcIds) {
          const fileId = funcIdToFileId.get(funcId);
          if (fileId) fileIdsMentioned.add(fileId);
        }
      }
    }
    if (fileIdsMentioned.size >= 2) {
      addCluster([...fileIdsMentioned]);
    }
  }
  for (const entry of mermaidEntries) {
    const diagramId = `diagram:${entry.anchor}`;
    const fileIdsMentioned = /* @__PURE__ */ new Set();
    let firstFuncId = null;
    for (const [funcName, funcIds] of funcNameToIds) {
      if (funcNamePatterns.get(funcName).test(entry.content)) {
        if (firstFuncId === null) firstFuncId = funcIds[0];
        for (const funcId of funcIds) {
          const fileId = funcIdToFileId.get(funcId);
          if (fileId) fileIdsMentioned.add(fileId);
        }
      }
    }
    if (firstFuncId !== null) {
      addCluster([diagramId, firstFuncId]);
    }
    if (fileIdsMentioned.size >= 2) {
      addCluster([...fileIdsMentioned]);
    }
  }
  return results;
}
function buildConceptNode(anchor, name, confidence = "high") {
  return {
    id: makeConceptId(anchor, name),
    type: "concept",
    name,
    category: "concept",
    source_refs: [anchor],
    confidence
  };
}
function buildClaimNode(anchor, text, confidence = "high") {
  return {
    id: makeClaimId(anchor, text),
    type: "claim",
    name: text,
    category: "claim",
    source_refs: [anchor],
    confidence
  };
}
function buildEntityNode(name, anchor, confidence = "high") {
  return {
    id: makeEntityId(name),
    type: "entity",
    name,
    category: "definition",
    source_refs: [anchor],
    confidence
  };
}
async function analyzeContent(repoRoot, codeRelPaths, docRelPaths, opts) {
  if (!opts?.proposeConcepts && !opts?.proposeClaimsAndEntities) {
    throw new Error(
      "K1 analyzeContent requires at least one LLM adapter. Inject ProposeConceptsFn and/or ProposeClaimsAndEntitiesFn via ContentAnalyzeOptions. In tests, inject an oracle-backed mock. In production, inject the real LLM adapter (wired at L6)."
    );
  }
  const functionIds = extractFunctionIds(repoRoot, codeRelPaths);
  const mermaidEntries = extractMermaidEntries(repoRoot, docRelPaths);
  const claimSections = extractClaimSections(repoRoot, docRelPaths);
  const clusters = buildContentClusters(codeRelPaths, functionIds, claimSections, mermaidEntries);
  const nodeMap = /* @__PURE__ */ new Map();
  const addNode = (n) => {
    if (!nodeMap.has(n.id)) nodeMap.set(n.id, n);
  };
  if (opts?.proposeConcepts) {
    const docCommentCandidates = extractDocCommentCandidates(repoRoot, codeRelPaths);
    const conceptProposals = await opts.proposeConcepts(docCommentCandidates);
    for (const p of conceptProposals) {
      if (!p.anchor || !p.name) continue;
      if (!resolveAnchor(repoRoot, p.anchor)) continue;
      addNode(buildConceptNode(p.anchor, p.name, p.confidence ?? "high"));
    }
  }
  if (opts?.proposeClaimsAndEntities) {
    const headingCandidates = extractHeadingCandidates(repoRoot, docRelPaths);
    const { claims, entities } = await opts.proposeClaimsAndEntities(
      claimSections,
      headingCandidates
    );
    for (const c of claims) {
      if (!c.anchor || !c.text) continue;
      if (!resolveAnchor(repoRoot, c.anchor)) continue;
      addNode(buildClaimNode(c.anchor, c.text, c.confidence ?? "high"));
    }
    for (const e of entities) {
      if (!e.name || !e.anchor) continue;
      if (!resolveAnchor(repoRoot, e.anchor)) continue;
      addNode(buildEntityNode(e.name, e.anchor, e.confidence ?? "high"));
    }
  }
  return {
    nodes: [...nodeMap.values()],
    edges: [],
    clusters
  };
}
if (require.main === module) {
  const argv = process.argv.slice(2);
  if (argv.length < 1) {
    process.stderr.write(
      "Usage: npx tsx content-analyze.ts <repoRoot> [--code ...] [--docs ...]\n"
    );
    process.exit(1);
  }
  process.stderr.write(
    "[content-analyze] K1 stage loaded. Run via the K-tier pipeline or in tests.\n"
  );
}

// scripts/learn/diagram-analyze.ts
var fs3 = __toESM(require("fs"));
var path4 = __toESM(require("path"));
init_schema();
function extractMermaidBlocks(markdownContent) {
  const blocks = [];
  const fenceRe = /```mermaid[^\n]*\n([\s\S]*?)```/g;
  let m;
  while ((m = fenceRe.exec(markdownContent)) !== null) {
    blocks.push(m[1]);
  }
  return blocks;
}
function extractMermaidNodeId(token) {
  const t = token.trim();
  const quotedMatch = t.match(/^"([^"]+)"/);
  if (quotedMatch) return quotedMatch[1];
  const bareMatch = t.match(/^([A-Za-z0-9_][A-Za-z0-9_-]*)/);
  return bareMatch ? bareMatch[1] : null;
}
function parseMermaidBlock(blockBody) {
  const nodeSet = /* @__PURE__ */ new Set();
  const edges = [];
  const lines = blockBody.split("\n");
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("%%") || line.startsWith("//")) continue;
    if (/^(?:sub)?graph\b/i.test(line) || /^flowchart\b/i.test(line)) continue;
    if (line === "end") continue;
    if (/^(?:style|classDef|class|linkStyle|direction)\b/i.test(line)) continue;
    const normalized = line.replace(/\|[^|]*\|/g, "");
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
    const standaloneMatch = line.match(
      /^(?:"([^"]+)"|([A-Za-z0-9_][A-Za-z0-9_-]*))(?:\[[^\]]*\]|\([^)]*\)|\{[^}]*\})?$/
    );
    if (standaloneMatch) {
      nodeSet.add(standaloneMatch[1] ?? standaloneMatch[2]);
    }
  }
  return { nodes: Array.from(nodeSet), edges };
}
function parseSvgFile(content) {
  const titleMatch = content.match(
    /<(?:\w+:)?title(?:\s[^>]*)?>([^<]*)<\/(?:\w+:)?title>/i
  );
  const title = titleMatch ? titleMatch[1].trim() || void 0 : void 0;
  const textRe = /<(?:\w+:)?text\b[^>]*>([\s\S]*?)<\/(?:\w+:)?text>/gi;
  const labels = [];
  let tm;
  while ((tm = textRe.exec(content)) !== null) {
    const raw = tm[1].replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    if (raw) labels.push(raw);
  }
  const idRe = /\bid=["']([^"']+)["']/g;
  const elementIds = [];
  let im;
  while ((im = idRe.exec(content)) !== null) {
    if (im[1]) elementIds.push(im[1]);
  }
  return { title, labels, elementIds };
}
function makeDiagramName(relPath, kind) {
  const base = path4.basename(relPath, path4.extname(relPath));
  const title = base.charAt(0).toUpperCase() + base.slice(1);
  return kind === "mermaid" ? `${title} flow (mermaid)` : `${title} (svg)`;
}
function analyzeDiagrams(repoRoot, relFilePaths) {
  const nodes = [];
  for (const relPath of relFilePaths) {
    const absPath = path4.resolve(repoRoot, relPath);
    let content;
    try {
      if (!fs3.existsSync(absPath)) continue;
      content = fs3.readFileSync(absPath, "utf8");
    } catch {
      continue;
    }
    const ext = relPath.toLowerCase();
    if (ext.endsWith(".svg")) {
      const anchor = `${relPath}#svg`;
      const { title, labels, elementIds } = parseSvgFile(content);
      const node = {
        id: makeDiagramId(anchor),
        type: "diagram",
        name: makeDiagramName(relPath, "svg"),
        source_refs: [anchor],
        confidence: "high",
        category: "diagram",
        svg_title: title,
        svg_labels: labels,
        svg_element_ids: elementIds
        // svg_description intentionally omitted — LLM-judged field (SC-9)
      };
      nodes.push(node);
    } else if (ext.endsWith(".md") || ext.endsWith(".mdx")) {
      const blocks = extractMermaidBlocks(content);
      for (let idx = 0; idx < blocks.length; idx++) {
        const anchor = `${relPath}#mermaid-${idx}`;
        const { nodes: mNodes, edges: mEdges } = parseMermaidBlock(blocks[idx]);
        const node = {
          id: makeDiagramId(anchor),
          type: "diagram",
          name: makeDiagramName(relPath, "mermaid"),
          source_refs: [anchor],
          confidence: "high",
          category: "diagram",
          mermaid_nodes: mNodes,
          mermaid_edges: mEdges
        };
        nodes.push(node);
      }
    }
  }
  return { nodes, edges: [] };
}
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

// scripts/learn/wiki-index.ts
var fs4 = __toESM(require("fs"));
var path5 = __toESM(require("path"));
init_schema();
function headingSlug2(raw) {
  return raw.trim().toLowerCase().replace(/[^\w\s-]/g, "").replace(/\s+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}
function extractH1(content) {
  const match = content.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : "";
}
function extractHeadings(content) {
  const re = /^#{1,6}\s+(.+)$/gm;
  const result = [];
  let m;
  while ((m = re.exec(content)) !== null) {
    result.push(m[1].trim());
  }
  return result;
}
function extractWikilinks(content) {
  const re = /\[\[([^\]]+)\]\]/g;
  const seen = /* @__PURE__ */ new Set();
  let m;
  while ((m = re.exec(content)) !== null) {
    const target = m[1].trim();
    seen.add(target);
  }
  return [...seen];
}
var EXCLUDED_WIKI_NAMES = /* @__PURE__ */ new Set([
  "README.md",
  "CHANGELOG.md",
  "CONTRIBUTING.md",
  "LICENSE.md"
]);
function collectWikiPageRelpaths(wikiDir) {
  const results = [];
  function walk(current, rel) {
    let entries;
    try {
      entries = fs4.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const name = entry.name;
      if (name.startsWith(".")) continue;
      const relChild = rel ? `${rel}/${name}` : name;
      if (entry.isDirectory()) {
        walk(path5.join(current, name), relChild);
      } else if (entry.isFile() && name.toLowerCase().endsWith(".md")) {
        if (!EXCLUDED_WIKI_NAMES.has(name)) {
          results.push(relChild);
        }
      }
    }
  }
  walk(wikiDir, "");
  return results.sort();
}
function toPosixRel(p) {
  return p.split(path5.sep).join("/");
}
function buildBasenameMapFromList(relpaths) {
  const map = /* @__PURE__ */ new Map();
  for (const relpath of relpaths) {
    const basename5 = path5.basename(relpath, path5.extname(relpath));
    if (!map.has(basename5)) {
      map.set(basename5, relpath);
    }
  }
  return map;
}
function buildBasenameMap(relpaths) {
  return buildBasenameMapFromList(relpaths);
}
var defaultClassifier = async (pages) => {
  const result = /* @__PURE__ */ new Map();
  for (const page of pages) {
    result.set(page.id, { category: "note", importance: "low", labels: [] });
  }
  return result;
};
async function indexWiki(wikiDir, opts) {
  const classifier = opts?.classifier ?? defaultClassifier;
  const relBase = opts?.repoRoot !== void 0 ? toPosixRel(path5.relative(opts.repoRoot, wikiDir)) : "";
  const toRepoRel = (fileRel) => relBase ? `${relBase}/${fileRel}` : fileRel;
  const fileRelpaths = collectWikiPageRelpaths(wikiDir);
  const pageDescriptors = [];
  for (const fileRel of fileRelpaths) {
    const absPath = path5.join(wikiDir, fileRel);
    let content;
    try {
      content = fs4.readFileSync(absPath, "utf8");
    } catch {
      continue;
    }
    const repoRel = toRepoRel(fileRel);
    const h1 = extractH1(content);
    const headings = extractHeadings(content);
    const wikilinks = extractWikilinks(content);
    const id = makeWikiPageId(repoRel);
    pageDescriptors.push({ id, relpath: repoRel, name: h1, headings, content, wikilinks });
  }
  const classifications = await classifier(pageDescriptors);
  const basenameMap = buildBasenameMap(pageDescriptors.map((d) => d.relpath));
  const nodes = [];
  const edges = [];
  const suppressed = [];
  for (const desc of pageDescriptors) {
    const cls = classifications.get(desc.id);
    if (!cls) {
      suppressed.push({
        id: desc.id,
        source_ref: desc.relpath,
        reason: "classifier returned no judgment for this page id (unclassified)",
        stage: "wiki-index-unclassified"
      });
      continue;
    }
    const anchor = desc.name ? `${desc.relpath}#${headingSlug2(desc.name)}` : desc.relpath;
    const node = {
      id: desc.id,
      type: "wiki_page",
      name: desc.name || path5.basename(desc.relpath, ".md"),
      source_refs: [anchor],
      confidence: "high",
      category: cls.category,
      importance: cls.importance,
      labels: cls.labels
    };
    nodes.push(node);
    const emittedTargets = /* @__PURE__ */ new Set();
    for (const basename5 of desc.wikilinks) {
      const targetRelpath = basenameMap.get(basename5);
      if (!targetRelpath) continue;
      const targetId = makeWikiPageId(targetRelpath);
      if (emittedTargets.has(targetId)) continue;
      emittedTargets.add(targetId);
      const edge = {
        source: desc.id,
        target: targetId,
        type: "related",
        direction: "out",
        weight: 1
      };
      edges.push(edge);
    }
  }
  return { nodes, edges, suppressed };
}
if (require.main === module) {
  const argv = process.argv.slice(2);
  const wikiDir = argv[0];
  if (!wikiDir || wikiDir.startsWith("--")) {
    process.stderr.write(
      "Usage: npx tsx wiki-index.ts <wikiDir> [--cwd <repoRoot>] [--print]\n"
    );
    process.exit(1);
  }
  const cwdIdx = argv.indexOf("--cwd");
  const cwdArg = cwdIdx >= 0 ? argv[cwdIdx + 1] : void 0;
  const repoRoot = path5.resolve(cwdArg ?? process.cwd());
  const absWikiDir = path5.resolve(repoRoot, wikiDir);
  indexWiki(absWikiDir, { repoRoot }).then(({ nodes, edges }) => {
    const wikiPages = nodes.filter((n) => n.type === "wiki_page");
    const related = edges.filter((e) => e.type === "related");
    process.stderr.write(
      `[wiki-index] ${wikiPages.length} wiki_page nodes \xB7 ${related.length} related edges
`
    );
    if (argv.includes("--print")) {
      process.stdout.write(JSON.stringify({ nodes, edges }, null, 2) + "\n");
    } else {
      process.stdout.write(`wiki_pages=${wikiPages.length} related_edges=${related.length}
`);
    }
  }).catch((err) => {
    process.stderr.write(`[wiki-index] ERROR: ${err}
`);
    process.exit(1);
  });
}

// scripts/learn/lib/ignore.ts
var fs5 = __toESM(require("fs"));
var path6 = __toESM(require("path"));
var DEFAULT_IGNORE_PATTERNS = Object.freeze([
  "node_modules/",
  ".git/",
  "vendor/",
  "venv/",
  ".venv/",
  "__pycache__/",
  // Guild derived-index dir is never itself indexed (derived, rebuildable).
  // Any external/forked plugin's dotfolder is excluded by the user's
  // .guildignore, not hardcoded here (keeps the engine free of external refs).
  ".guild/",
  "dist/",
  "build/",
  "out/",
  "coverage/",
  ".next/",
  ".cache/",
  ".turbo/",
  "target/",
  "obj/",
  // Generated module-resource mirrors (src/modules/<id>/resources/**) are
  // byte-for-byte copies of first-party source (scripts/**, hooks/**) produced by
  // sync:module-resources for host packaging — exactly like dist/. Indexing them
  // duplicates every mirrored node (~31% of the graph) and makes each source file
  // look like it has an exact clone. Exclude the generated tree; the canonical
  // source is indexed from its real path.
  "src/modules/*/resources/",
  // Test directories and fixtures are not first-party knowledge — they must be
  // excluded from the cost-gate corpus AND from knowledge discovery so the two
  // share one policy (L13-fix BLOCKER 2 / L17 residual). Without `tests/` the
  // L12 re-run produced 43 nodes sourced from plugin tests/ (boundary, evolve,
  // shadow, wiki-lint READMEs + workspace/_fixtures.ts). These dir patterns use
  // trailing-slash (dirOnly) matching — same as fixtures/ — so they prune whole
  // subtrees, not just files with those names.
  "tests/",
  "test/",
  "__tests__/",
  "fixtures/",
  "testdata/",
  "__fixtures__/",
  "*.lock",
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "*.png",
  "*.jpg",
  "*.jpeg",
  "*.gif",
  "*.svg",
  "*.ico",
  "*.woff",
  "*.woff2",
  "*.ttf",
  "*.eot",
  "*.mp3",
  "*.mp4",
  "*.pdf",
  "*.zip",
  "*.tar",
  "*.gz",
  "*.min.js",
  "*.min.css",
  "*.map",
  "*.generated.*",
  ".idea/",
  ".vscode/",
  "LICENSE",
  ".gitignore",
  ".editorconfig",
  ".prettierrc",
  ".eslintrc*",
  "*.log"
]);
function globToRegExp(pattern) {
  let p = pattern;
  const dirOnly = p.endsWith("/");
  if (dirOnly) p = p.slice(0, -1);
  const anchored = p.startsWith("/");
  if (anchored) p = p.slice(1);
  const hasSlash = p.includes("/");
  let re = "";
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === "*") {
      if (p[i + 1] === "*") {
        re += "(?:.*)";
        i++;
        if (p[i + 1] === "/") i++;
      } else {
        re += "[^/]*";
      }
    } else if (c === "?") {
      re += "[^/]";
    } else if ("\\^$.|+()[]{}".includes(c)) {
      re += "\\" + c;
    } else {
      re += c;
    }
  }
  let body;
  if (hasSlash || anchored) {
    body = "^" + re + (dirOnly ? "(?:/.*)?$" : "(?:/.*)?$");
  } else {
    body = "(?:^|/)" + re + (dirOnly ? "(?:/.*)?$" : "(?:/.*)?$");
  }
  return { source: body, dirOnly };
}
function compile(patterns) {
  const rules = [];
  for (const raw of patterns) {
    const line = raw.replace(/\r$/, "");
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    let body = trimmed;
    const negated = body.startsWith("!");
    if (negated) body = body.slice(1);
    const { source, dirOnly } = globToRegExp(body);
    rules.push({ re: new RegExp(source), negated, dirOnly });
  }
  return rules;
}
function createIgnoreFilter(projectRoot) {
  const patterns = [...DEFAULT_IGNORE_PATTERNS];
  const rootIgnore = path6.join(projectRoot, ".guildignore");
  if (fs5.existsSync(rootIgnore)) {
    patterns.push(...fs5.readFileSync(rootIgnore, "utf-8").split("\n"));
  }
  const rules = compile(patterns);
  return {
    isIgnored(relativePath) {
      const rel = relativePath.replace(/\\/g, "/").replace(/^\.\//, "");
      let ignored = false;
      for (const rule of rules) {
        if (rule.re.test(rel)) ignored = !rule.negated;
      }
      return ignored;
    }
  };
}

// scripts/learn/lib/git.ts
var import_child_process = require("child_process");
function git(cwd, args) {
  return (0, import_child_process.execFileSync)("git", args, { cwd, encoding: "utf-8" }).trim();
}
function headSha(cwd) {
  try {
    return git(cwd, ["rev-parse", "HEAD"]);
  } catch {
    return "unknown";
  }
}

// scripts/learn/taxonomy-build.ts
var fs6 = __toESM(require("fs"));
init_schema();
function slugifyTopicName(name) {
  return name.toLowerCase().replace(/[^\w\s-]/g, "").replace(/\s+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}
function deriveDomainId(name) {
  return `domain:${slugifyTopicName(name)}`;
}
function deriveTopicPath(topicId, parentMap, nameMap) {
  const segments = [];
  let current = topicId;
  const visited = /* @__PURE__ */ new Set();
  while (current !== null) {
    if (visited.has(current)) break;
    visited.add(current);
    const name = nameMap.get(current);
    if (name) segments.unshift(slugifyTopicName(name));
    current = parentMap.get(current) ?? null;
  }
  return segments;
}
function collectTopicInputs(clusters) {
  const seen = /* @__PURE__ */ new Set();
  const results = [];
  for (const cluster of clusters) {
    const topicId = makeTopicId(cluster.memberIds);
    if (seen.has(topicId)) continue;
    seen.add(topicId);
    results.push({ topicId, memberIds: [...cluster.memberIds] });
  }
  return results;
}
function addHubTopics(clusters, baseInputs) {
  const funcRefCount = /* @__PURE__ */ new Map();
  for (const cluster of clusters) {
    for (const memberId of cluster.memberIds) {
      if (memberId.startsWith("function:")) {
        funcRefCount.set(memberId, (funcRefCount.get(memberId) ?? 0) + 1);
      }
    }
  }
  const existingIds = new Set(baseInputs.map((t) => t.topicId));
  const hubs = [];
  for (const [funcId, count] of funcRefCount) {
    if (count >= 2) {
      const memberIds = [funcId];
      const topicId = makeTopicId(memberIds);
      if (!existingIds.has(topicId)) {
        hubs.push({ topicId, memberIds });
        existingIds.add(topicId);
      }
    }
  }
  return [...baseInputs, ...hubs];
}
function validateAcyclicity(parentMap) {
  for (const [startId] of parentMap) {
    const visited = /* @__PURE__ */ new Set();
    let current = startId;
    while (current !== null) {
      if (visited.has(current)) {
        throw new Error(
          `K4 taxonomy-build: subtopic_of cycle detected involving topic "${current}". The parent assignment creates a cycle \u2014 all subtopic_of edges must form an acyclic tree.`
        );
      }
      visited.add(current);
      current = parentMap.get(current) ?? null;
    }
  }
}
function foldSubThreshold(proposals, minTopicImportance) {
  const parentMap = new Map(
    proposals.map((p) => [p.topicId, p.parentTopicId])
  );
  const subThreshold = new Set(
    proposals.filter((p) => p.importanceScore < minTopicImportance).map((p) => p.topicId)
  );
  const resolveParent = (topicId) => {
    let current = parentMap.get(topicId) ?? null;
    while (current !== null && subThreshold.has(current)) {
      current = parentMap.get(current) ?? null;
    }
    return current;
  };
  return proposals.filter((p) => !subThreshold.has(p.topicId)).map((p) => ({
    ...p,
    parentTopicId: resolveParent(p.topicId)
  }));
}
function getTopLevelDirs(repoRoot) {
  try {
    return fs6.readdirSync(repoRoot, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith(".")).map((e) => e.name);
  } catch {
    return [];
  }
}
var STRUCTURAL_DIR_EXPANSIONS = {
  src: ["source"],
  lib: ["library", "libraries"],
  pkg: ["package", "packages"]
};
function isForbiddenDomainName(domainSlug, topLevelDirs) {
  const domainTokens = domainSlug.split("-");
  for (const dir of topLevelDirs) {
    const dirSlug = dir.toLowerCase().replace(/[^a-z0-9]/g, "");
    const dirSingular = dirSlug.endsWith("s") && dirSlug.length > 2 ? dirSlug.slice(0, -1) : dirSlug;
    const dirForms = /* @__PURE__ */ new Set([
      dirSlug,
      dirSingular,
      ...STRUCTURAL_DIR_EXPANSIONS[dirSlug] ?? []
    ]);
    for (const form of dirForms) {
      if (domainSlug === form) return true;
      if (domainTokens.includes(form)) return true;
    }
  }
  return false;
}
function getDepth(topicId, parentMap, cache) {
  const cached = cache.get(topicId);
  if (cached !== void 0) return cached;
  const parent = parentMap.get(topicId) ?? null;
  const depth = parent === null ? 0 : 1 + getDepth(parent, parentMap, cache);
  cache.set(topicId, depth);
  return depth;
}
function importanceLabel(score) {
  if (score >= 0.8) return "high";
  if (score >= 0.5) return "medium";
  return "low";
}
async function buildTaxonomy(repoRoot, clusters, opts) {
  if (!opts?.proposeTaxonomy) {
    throw new Error(
      "K4 buildTaxonomy: requires proposeTaxonomy LLM adapter. Inject a ProposeTaxonomyFn via TaxonomyBuildOptions.proposeTaxonomy. In tests, inject an oracle-backed mock; in production, inject the real LLM adapter."
    );
  }
  const maxDepth = opts.maxDepth ?? KNOWLEDGE_CONFIG_DEFAULTS.maxDepth;
  const maxBranching = opts.maxBranching ?? KNOWLEDGE_CONFIG_DEFAULTS.maxBranching;
  const minTopicImportance = opts.minTopicImportance ?? KNOWLEDGE_CONFIG_DEFAULTS.minTopicImportance;
  const baseInputs = collectTopicInputs(clusters);
  const topicInputs = addHubTopics(clusters, baseInputs);
  const topLevelDirs = getTopLevelDirs(repoRoot);
  const { topicProposals: rawProposals, domainProposals } = await opts.proposeTaxonomy(topicInputs, { forbiddenDomainNames: topLevelDirs });
  const validTopicIds = new Set(topicInputs.map((t) => t.topicId));
  const validProposals = rawProposals.filter(
    (p) => validTopicIds.has(p.topicId) && p.sourceRef && resolveAnchor(repoRoot, p.sourceRef)
  );
  const keptProposals = foldSubThreshold(validProposals, minTopicImportance);
  const keptIds = new Set(keptProposals.map((p) => p.topicId));
  const parentMap = /* @__PURE__ */ new Map();
  const nameMap = /* @__PURE__ */ new Map();
  for (const p of keptProposals) {
    const parent = p.parentTopicId !== null && keptIds.has(p.parentTopicId) ? p.parentTopicId : null;
    parentMap.set(p.topicId, parent);
    nameMap.set(p.topicId, p.name);
  }
  validateAcyclicity(parentMap);
  const depthCache = /* @__PURE__ */ new Map();
  for (const p of keptProposals) {
    const depth = getDepth(p.topicId, parentMap, depthCache);
    if (depth > maxDepth) {
      throw new Error(
        `K4 taxonomy-build: topic "${p.name}" (${p.topicId}) exceeds maxDepth ${maxDepth}. Actual depth: ${depth}. The LLM-assigned parent chain is too deep. Reduce hierarchy depth or raise maxDepth in KNOWLEDGE_CONFIG_DEFAULTS.`
      );
    }
  }
  const childCount = /* @__PURE__ */ new Map();
  for (const p of keptProposals) {
    const parent = parentMap.get(p.topicId) ?? null;
    if (parent !== null) {
      childCount.set(parent, (childCount.get(parent) ?? 0) + 1);
    }
  }
  for (const [parentId, count] of childCount) {
    if (count > maxBranching) {
      throw new Error(
        `K4 taxonomy-build: topic "${nameMap.get(parentId) ?? parentId}" (${parentId}) has ${count} children, exceeding maxBranching ${maxBranching}. Reduce the fan-out or raise maxBranching in KNOWLEDGE_CONFIG_DEFAULTS.`
      );
    }
  }
  const nodes = [];
  const edges = [];
  for (const p of keptProposals) {
    const topicPath = deriveTopicPath(p.topicId, parentMap, nameMap);
    const topicNode = {
      id: p.topicId,
      type: "topic",
      name: p.name,
      category: "concept",
      source_refs: [p.sourceRef],
      confidence: "high",
      importance: importanceLabel(p.importanceScore),
      importance_score: p.importanceScore,
      topic_path: topicPath
    };
    nodes.push(topicNode);
    const parent = parentMap.get(p.topicId) ?? null;
    if (parent !== null) {
      edges.push({
        source: p.topicId,
        target: parent,
        type: "subtopic_of",
        direction: "out",
        weight: 1
      });
    }
  }
  for (const dp of domainProposals) {
    const domainId = deriveDomainId(dp.name);
    const normalizedName = domainId.slice("domain:".length);
    if (isForbiddenDomainName(normalizedName, topLevelDirs)) {
      continue;
    }
    if (!dp.sourceRef || !resolveAnchor(repoRoot, dp.sourceRef)) {
      continue;
    }
    const domainEdges = [];
    for (const topicId of dp.topicIds) {
      if (!keptIds.has(topicId)) continue;
      domainEdges.push({
        source: topicId,
        target: domainId,
        type: "belongs_to_domain",
        direction: "out",
        weight: 1
      });
    }
    if (domainEdges.length === 0) continue;
    const domainNode = {
      id: domainId,
      type: "domain",
      name: dp.name,
      source_refs: [dp.sourceRef],
      confidence: "high"
    };
    nodes.push(domainNode);
    edges.push(...domainEdges);
  }
  return { nodes, edges };
}

// scripts/learn/knowledge-orchestrator.ts
init_cross_link();
init_schema();

// scripts/learn/write-knowledge-links.ts
var fs9 = __toESM(require("fs"));
var path9 = __toESM(require("path"));

// src/domains/knowledge/knowledge-links-contract.ts
var KNOWLEDGE_RECALL_SCHEMA_VERSION = "guild.knowledge_links.v2";
var KNOWLEDGE_LINKS_PROVENANCE_SCHEMA_VERSION = "guild.knowledge_links.provenance.v1";

// scripts/learn/lib/paths.ts
var fs8 = __toESM(require("fs"));
var path8 = __toESM(require("path"));
var import_child_process2 = require("child_process");
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
    const commonDir = (0, import_child_process2.execFileSync)("git", ["rev-parse", "--git-common-dir"], {
      cwd,
      encoding: "utf-8"
    }).trim();
    const abs = path8.isAbsolute(commonDir) ? commonDir : path8.resolve(cwd, commonDir);
    const root = path8.dirname(abs);
    if (fs8.existsSync(root)) return root;
  } catch {
  }
  return path8.resolve(cwd);
}
function guildPaths(cwd) {
  const repoRoot = resolveMainRepoRoot(cwd);
  const guildDir = path8.join(repoRoot, ".guild");
  const indexesDir = path8.join(guildDir, "indexes");
  const runsDir = path8.join(guildDir, "runs");
  return {
    repoRoot,
    guildDir,
    indexesDir,
    runsDir,
    codebaseMap: path8.join(indexesDir, "codebase-map.json"),
    knowledgeGraph: path8.join(indexesDir, "knowledge-graph.json"),
    knowledgeLinks: path8.join(indexesDir, "knowledge-links.json"),
    knowledgeRecall: path8.join(indexesDir, "knowledge-recall.json"),
    fingerprint: path8.join(indexesDir, "understand-fingerprint.json"),
    partialGraph: path8.join(indexesDir, "understand-partial-graph.json")
  };
}
function readJson(filePath) {
  try {
    return JSON.parse(fs8.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

// src/domains/knowledge/graph-scoring.ts
function importanceMultiplier(node) {
  const n = node;
  if (typeof n.importance_score === "number") {
    return Math.max(0, Math.min(1, n.importance_score));
  }
  switch (n.importance) {
    case "high":
      return 0.8;
    case "medium":
      return 0.4;
    case "low":
      return 0.1;
    default:
      return 0;
  }
}
function confidenceBonus(node) {
  switch (node.confidence) {
    case "high":
      return 0.3;
    case "medium":
      return 0.1;
    default:
      return 0;
  }
}
function termMatchScore(node, terms) {
  const hay = `${node.name} ${node.id} ${(node.source_refs ?? []).join(" ")}`.toLowerCase();
  let termScore = 0;
  for (const t of terms) {
    if (!t) continue;
    if (node.name.toLowerCase() === t) termScore += 5;
    else if (node.name.toLowerCase().includes(t)) termScore += 3;
    else if (hay.includes(t)) termScore += 1;
  }
  return termScore;
}
function scoreNode(node, terms) {
  if (terms.length === 0) {
    return 1 * (1 + importanceMultiplier(node)) + confidenceBonus(node);
  }
  const termScore = termMatchScore(node, terms);
  if (termScore === 0) return 0;
  const imp = importanceMultiplier(node);
  const conf = confidenceBonus(node);
  return termScore * (1 + imp) + conf;
}
var PROXIMITY_WEIGHT = 0.1;
function rankKgNodes(candidates, edges, terms, limit, allNodes = candidates) {
  const candidateScored = candidates.map((n) => ({ n, s: scoreNode(n, terms) })).filter((x) => x.s > 0);
  const proximityBonuses = buildProximityBonuses(candidateScored, edges, allNodes);
  return candidateScored.map((x) => ({ n: x.n, s: x.s + (proximityBonuses.get(x.n.id) ?? 0) })).sort((a, b) => b.s - a.s || a.n.id.localeCompare(b.n.id)).slice(0, limit);
}
function buildProximityBonuses(scored, edges, allNodes = []) {
  const bonuses = /* @__PURE__ */ new Map();
  const matchedTopics = scored.filter((x) => x.s > 0 && x.n.type === "topic");
  if (matchedTopics.length === 0) return bonuses;
  const nodeById = new Map([
    ...scored.map((x) => [x.n.id, x.n]),
    ...allNodes.map((n) => [n.id, n])
  ]);
  for (const { n: node, s } of matchedTopics) {
    for (const e of edges) {
      if (e.type !== "subtopic_of" || e.source !== node.id) continue;
      const parentId = e.target;
      const parentNode = nodeById.get(parentId);
      if (parentNode !== void 0 && parentNode.type !== "topic") continue;
      const bonus = s * PROXIMITY_WEIGHT;
      const current = bonuses.get(parentId) ?? 0;
      bonuses.set(parentId, Math.max(current, bonus));
    }
  }
  return bonuses;
}

// scripts/learn/kg-query.ts
var MAX_LIMIT = 50;
function main() {
  const argv = process.argv.slice(2);
  const cwd = parseCwd(argv);
  const gp = guildPaths(cwd);
  const graph = readJson(gp.knowledgeRecall);
  if (!graph) {
    const neighborOf2 = parseFlag(argv, "neighbors");
    const json2 = hasFlag(argv, "json");
    if (json2) {
      process.stdout.write(
        JSON.stringify({ count: 0, capped: false, results: [] }, null, 2) + "\n"
      );
    } else if (neighborOf2) {
      process.stdout.write("");
    } else {
      process.stdout.write("(no matches)\n");
    }
    return;
  }
  const neighborOf = parseFlag(argv, "neighbors");
  const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(parseFlag(argv, "limit") ?? "20", 10) || 20));
  const json = hasFlag(argv, "json");
  if (neighborOf) {
    const out = graph.edges.filter((e) => e.source === neighborOf || e.target === neighborOf).slice(0, limit).map((e) => ({ ...e }));
    process.stdout.write(
      json ? JSON.stringify(out, null, 2) + "\n" : out.map((e) => `${e.source} -[${e.type}/${e.direction}]-> ${e.target}`).join("\n") + "\n"
    );
    return;
  }
  const q = (parseFlag(argv, "q") ?? "").toLowerCase().trim();
  const terms = q.split(/\s+/).filter(Boolean);
  const typeFilter = (parseFlag(argv, "type") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const typeSet = new Set(typeFilter);
  let candidates = graph.nodes;
  if (typeSet.size) candidates = candidates.filter((n) => typeSet.has(n.type));
  const ranked = rankKgNodes(
    candidates,
    graph.edges ?? [],
    terms,
    limit,
    graph.nodes ?? []
  );
  if (json) {
    const results = ranked.map((x) => {
      const base = {
        id: x.n.id,
        type: x.n.type,
        name: x.n.name,
        confidence: x.n.confidence,
        source_refs: (x.n.source_refs ?? []).slice(0, 2)
      };
      const ext = x.n;
      if (ext.importance !== void 0) base.importance = ext.importance;
      if (typeof ext.importance_score === "number") base.importance_score = ext.importance_score;
      return base;
    });
    process.stdout.write(
      JSON.stringify(
        { count: ranked.length, capped: candidates.length > limit, results },
        null,
        2
      ) + "\n"
    );
  } else {
    process.stdout.write(
      ranked.map((x) => `${x.n.type}	${x.n.id}	${x.n.confidence}	${(x.n.source_refs ?? [])[0] ?? ""}`).join("\n") + (ranked.length ? "\n" : "(no matches)\n")
    );
  }
}
if (require.main === module) {
  main();
}

// scripts/learn/write-knowledge-links.ts
function canonicalizeNode(node) {
  const n = node;
  const result = {
    id: n.id,
    type: n.type,
    name: n.name,
    confidence: n.confidence,
    source_refs: [...n.source_refs ?? []].sort()
  };
  if (n.category !== void 0) result["category"] = n.category;
  if (n.importance_score !== void 0) result["importance_score"] = n.importance_score;
  if (n.importance !== void 0) result["importance"] = n.importance;
  if (n.topic_path !== void 0) result["topic_path"] = n.topic_path;
  if (n.labels !== void 0) result["labels"] = n.labels;
  return result;
}
function canonicalizeEdge(edge) {
  const e = edge;
  const result = {
    direction: e.direction,
    source: e.source,
    target: e.target,
    type: e.type,
    weight: e.weight
  };
  if (e.description !== void 0) result["description"] = e.description;
  return result;
}
function sortNodesByRecall(nodes) {
  return [...nodes].sort((a, b) => {
    const impA = importanceMultiplier(a);
    const impB = importanceMultiplier(b);
    if (impB !== impA) return impB - impA;
    const confA = confidenceBonus(a);
    const confB = confidenceBonus(b);
    if (confB !== confA) return confB - confA;
    return a.id.localeCompare(b.id);
  });
}
function writeKnowledgeLinks(opts) {
  const { graph, repoRoot, runId, generatedAt } = opts;
  const seenEdgeKeys = /* @__PURE__ */ new Set();
  const dedupedEdges = [];
  for (const edge of graph.edges) {
    const key = `${edge.source}\u2192${edge.target}:${edge.type}`;
    if (!seenEdgeKeys.has(key)) {
      seenEdgeKeys.add(key);
      dedupedEdges.push(edge);
    }
  }
  const sortedNodes = sortNodesByRecall(graph.nodes);
  const sortedEdges = [...dedupedEdges].sort(
    (a, b) => a.source.localeCompare(b.source) || a.target.localeCompare(b.target) || a.type.localeCompare(b.type)
  );
  const canonNodes = sortedNodes.map(canonicalizeNode);
  const canonEdges = sortedEdges.map(canonicalizeEdge);
  const linksDoc = {
    schema_version: KNOWLEDGE_RECALL_SCHEMA_VERSION,
    nodes: canonNodes,
    edges: canonEdges
  };
  const indexesDir = path9.join(repoRoot, ".guild", "indexes");
  fs9.mkdirSync(indexesDir, { recursive: true });
  const linksPath = path9.join(indexesDir, "knowledge-recall.json");
  fs9.writeFileSync(linksPath, JSON.stringify(linksDoc, null, 2) + "\n", "utf8");
  const provenanceDoc = {
    schema_version: KNOWLEDGE_LINKS_PROVENANCE_SCHEMA_VERSION,
    run_id: runId ?? null,
    generated_at: generatedAt ?? null,
    node_count: graph.nodes.length,
    edge_count: dedupedEdges.length
  };
  const provenancePath = path9.join(indexesDir, "knowledge-recall-provenance.json");
  fs9.writeFileSync(provenancePath, JSON.stringify(provenanceDoc, null, 2) + "\n", "utf8");
  return {
    linksPath,
    provenancePath,
    nodeCount: graph.nodes.length,
    edgeCount: dedupedEdges.length
  };
}

// scripts/learn/knowledge-orchestrator.ts
var FALLBACK_ROOT_TOPIC_SEED = "project-knowledge";
var FALLBACK_ROOT_TOPIC_NAME = "Project Knowledge";
function deriveFallbackRootTopicName(repoRoot) {
  const base = path10.basename((repoRoot ?? "").replace(/[/\\]+$/, "")).trim();
  if (!base || base === "." || base === "..") return FALLBACK_ROOT_TOPIC_NAME;
  const titled = base.split(/[^A-Za-z0-9]+/).filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
  return titled ? `${titled} Knowledge` : FALLBACK_ROOT_TOPIC_NAME;
}
function maybeSynthesizeFallbackRootTopic(nodes, repoRoot) {
  const wikiPages = nodes.filter((n) => n.type === "wiki_page");
  if (wikiPages.length === 0) return null;
  if (nodes.some((n) => n.type === "topic")) return null;
  const sortedWikis = [...wikiPages].sort((a, b) => a.id.localeCompare(b.id));
  const firstRelpath = sortedWikis[0].id.slice("wiki_page:".length);
  const topicId = makeTopicId([FALLBACK_ROOT_TOPIC_SEED]);
  const topicNode = {
    id: topicId,
    type: "topic",
    name: deriveFallbackRootTopicName(repoRoot),
    category: "concept",
    source_refs: [firstRelpath],
    confidence: "high",
    importance: "high",
    importance_score: 1,
    topic_path: [FALLBACK_ROOT_TOPIC_SEED]
  };
  const edges = sortedWikis.map((w) => ({
    direction: "out",
    source: topicId,
    target: w.id,
    type: "evidenced_by",
    weight: 1
  }));
  return { topicNode, edges };
}
function findOrphanWikiPages(graph) {
  const wikiIds = graph.nodes.filter((n) => n.type === "wiki_page").map((n) => n.id);
  if (wikiIds.length === 0) return [];
  const topicIds = new Set(
    graph.nodes.filter((n) => n.type === "topic").map((n) => n.id)
  );
  const covered = /* @__PURE__ */ new Set();
  for (const e of graph.edges) {
    if (e.type === "evidenced_by" && topicIds.has(e.source) && typeof e.target === "string" && e.target.startsWith("wiki_page:")) {
      covered.add(e.target);
    }
  }
  return wikiIds.filter((id) => !covered.has(id)).sort();
}
function safeReadJson(filePath) {
  try {
    if (!fs10.existsSync(filePath)) return null;
    return JSON.parse(fs10.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}
function buildFileBackedSeams(judgmentDir) {
  const proposeConcepts = async (candidates) => {
    const judgments = safeReadJson(
      path10.join(judgmentDir, "k1-judgments.json")
    );
    if (!judgments?.concepts) return [];
    const results = [];
    for (const c of candidates) {
      const anchor = c.anchor ?? "";
      const judgment = judgments.concepts[anchor];
      if (!judgment) continue;
      results.push({
        anchor,
        name: judgment.name,
        confidence: judgment.confidence
      });
    }
    return results;
  };
  const proposeClaimsAndEntities = async (sections, headings) => {
    const judgments = safeReadJson(
      path10.join(judgmentDir, "k1-judgments.json")
    );
    const claims = [];
    const entities = [];
    if (!judgments) return { claims, entities };
    if (judgments.claims) {
      for (const s of sections) {
        const j = judgments.claims[s.anchor];
        if (j?.accepted) {
          claims.push({
            anchor: s.anchor,
            text: s.text,
            confidence: "medium"
          });
        }
      }
    }
    if (judgments.entities) {
      for (const h of headings) {
        const j = judgments.entities[h.anchor] ?? judgments.entities[h.text];
        if (j?.accepted) {
          entities.push({
            name: h.text,
            anchor: h.anchor,
            confidence: "medium"
          });
        }
      }
    }
    return { claims, entities };
  };
  const classifyPage = async (pages) => {
    const judgments = safeReadJson(
      path10.join(judgmentDir, "k2-judgments.json")
    );
    const result = /* @__PURE__ */ new Map();
    for (const page of pages) {
      const judgment = judgments?.pages?.[page.id];
      if (!judgment) continue;
      result.set(page.id, {
        category: judgment.category,
        importance: judgment.importance,
        labels: judgment.labels ?? []
      });
    }
    return result;
  };
  const proposeTaxonomy = async (topicInputs, _context) => {
    const judgments = safeReadJson(
      path10.join(judgmentDir, "k4-judgments.json")
    );
    if (!judgments?.topics) {
      return { topicProposals: [], domainProposals: [] };
    }
    const topicProposals = [];
    for (const input of topicInputs) {
      const judgment = judgments.topics[input.topicId];
      if (!judgment) continue;
      topicProposals.push({
        topicId: input.topicId,
        name: judgment.name,
        parentTopicId: judgment.parent ?? null,
        importanceScore: judgment.importance_score,
        sourceRef: judgment.sourceRef ?? ""
      });
    }
    const k4Candidates = safeReadJson(
      path10.join(judgmentDir, "k4-candidates.json")
    );
    const validDomainKeys = new Set(
      (k4Candidates?.domain_candidates ?? []).map((c) => c.candidate_key)
    );
    const domainProposals = [];
    for (const [key, d] of Object.entries(judgments.domains ?? {})) {
      if (!validDomainKeys.has(key)) continue;
      domainProposals.push({
        name: d.name,
        topicIds: d.topicIds,
        sourceRef: d.sourceRef
      });
    }
    return { topicProposals, domainProposals };
  };
  const confirmCrossLinks = async (_nodes, candidates, context) => {
    const judgments = safeReadJson(
      path10.join(judgmentDir, "k5-judgments.json")
    );
    if (!judgments?.edges) return [];
    const relMinConf = context?.relMinConf ?? 0.5;
    const edges = [];
    for (const c of candidates) {
      const key = `${c.source}\u2192${c.target}:${c.type}`;
      const judgment = judgments.edges[key];
      if (!judgment) continue;
      if (judgment.weight < relMinConf) continue;
      edges.push({
        direction: "out",
        source: c.source,
        target: c.target,
        type: c.type,
        weight: judgment.weight
      });
    }
    return edges;
  };
  return {
    proposeConcepts,
    proposeClaimsAndEntities,
    classifyPage,
    proposeTaxonomy,
    confirmCrossLinks
  };
}
function collectWikiPageCandidates(wikiAbsDir, repoRoot) {
  const results = [];
  const rawRelBase = path10.relative(repoRoot, wikiAbsDir).split(path10.sep).join("/");
  const toRepoRel = (fileRel) => rawRelBase ? `${rawRelBase}/${fileRel}` : fileRel;
  for (const fileRel of collectWikiPageRelpaths(wikiAbsDir)) {
    const abs = path10.join(wikiAbsDir, fileRel);
    let content;
    try {
      content = fs10.readFileSync(abs, "utf8");
    } catch {
      continue;
    }
    const h1Match = content.match(/^#\s+(.+)$/m);
    const name = h1Match ? h1Match[1].trim() : path10.basename(fileRel, ".md");
    const headings = [];
    const headingRe = /^#{1,6}\s+(.+)$/gm;
    let m;
    while ((m = headingRe.exec(content)) !== null) headings.push(m[1].trim());
    const wikilinks = [];
    const wlRe = /\[\[([^\]]+)\]\]/g;
    while ((m = wlRe.exec(content)) !== null) {
      wikilinks.push(m[1].split("|")[0].trim());
    }
    const repoRel = toRepoRel(fileRel);
    const id = makeWikiPageId(repoRel);
    results.push({ candidate_key: id, id, relpath: repoRel, name, headings, wikilinks });
  }
  return results;
}
function emitRound1Candidates(repoRoot, filePaths, candidateDir) {
  fs10.mkdirSync(candidateDir, { recursive: true });
  const { codeRelPaths, docRelPaths, svgRelPaths = [] } = filePaths;
  const rawDocComments = extractDocCommentCandidates(repoRoot, codeRelPaths);
  const docCommentCandidates = rawDocComments.map((c) => ({
    candidate_key: c.anchor,
    // anchor IS the stable key for K1 concepts
    anchor: c.anchor,
    rawText: c.rawText,
    relPath: c.relPath
  }));
  const rawHeadings = extractHeadingCandidates(repoRoot, docRelPaths);
  const headingCandidates = rawHeadings.map((c) => ({
    candidate_key: c.anchor,
    anchor: c.anchor,
    text: c.text,
    level: c.level,
    relPath: c.relPath
  }));
  const rawClaims = extractClaimSections(repoRoot, docRelPaths);
  const claimSections = rawClaims.map((c) => ({
    candidate_key: c.anchor,
    anchor: c.anchor,
    text: c.text,
    relPath: c.relPath
  }));
  const k1Doc = {
    schema_version: "guild.knowledge.candidates.v1",
    stage: "k1",
    doc_comment_candidates: docCommentCandidates,
    heading_candidates: headingCandidates,
    claim_sections: claimSections
  };
  fs10.writeFileSync(
    path10.join(candidateDir, "k1-candidates.json"),
    JSON.stringify(k1Doc, null, 2) + "\n",
    "utf8"
  );
  const wikiAbsDirs = [
    filePaths.wikiDir ?? path10.join(repoRoot, ".guild", "wiki"),
    path10.join(repoRoot, "docs", "knowledge")
  ];
  const k2Pages = [];
  for (const dir of wikiAbsDirs) {
    if (fs10.existsSync(dir)) {
      k2Pages.push(...collectWikiPageCandidates(dir, repoRoot));
    }
  }
  const k2Doc = {
    schema_version: "guild.knowledge.candidates.v1",
    stage: "k2",
    pages: k2Pages
  };
  fs10.writeFileSync(
    path10.join(candidateDir, "k2-candidates.json"),
    JSON.stringify(k2Doc, null, 2) + "\n",
    "utf8"
  );
  const k3AllPaths = [...docRelPaths, ...svgRelPaths];
  const k3Result = analyzeDiagrams(repoRoot, k3AllPaths);
  const k3Doc = {
    schema_version: "guild.knowledge.candidates.v1",
    stage: "k3",
    nodes: k3Result.nodes
  };
  fs10.writeFileSync(
    path10.join(candidateDir, "k3-nodes.json"),
    JSON.stringify(k3Doc, null, 2) + "\n",
    "utf8"
  );
  const functionIds = extractFunctionIds(repoRoot, codeRelPaths);
  const docSections = extractClaimSections(repoRoot, docRelPaths);
  const mermaidEntries = extractMermaidEntries(repoRoot, docRelPaths);
  const clusters = buildContentClusters(codeRelPaths, functionIds, docSections, mermaidEntries);
  const topicInputs = collectTopicInputs(clusters);
  const k4Doc = {
    schema_version: "guild.knowledge.candidates.v1",
    stage: "k4",
    topic_inputs: topicInputs.map((t) => ({
      candidate_key: t.topicId,
      // topicId IS the makeTopicId-derived stable key
      topicId: t.topicId,
      memberIds: t.memberIds
    })),
    // SC-9: domain_candidates gives the model a bounded vocabulary of domain keys.
    // In finalize, only k4-judgments.domains entries whose key appears here are
    // accepted — the model cannot inject a domain that was never proposed here.
    domain_candidates: topicInputs.map((t) => ({
      candidate_key: `domain:${t.topicId}`,
      primary_topicId: t.topicId
    }))
  };
  fs10.writeFileSync(
    path10.join(candidateDir, "k4-candidates.json"),
    JSON.stringify(k4Doc, null, 2) + "\n",
    "utf8"
  );
}
async function emitRound2Candidates(repoRoot, filePaths, candidateDir, judgmentDir) {
  fs10.mkdirSync(candidateDir, { recursive: true });
  const seams = buildFileBackedSeams(judgmentDir);
  const { nodes } = await runKnowledgeStagesK1ToK4(repoRoot, filePaths, seams);
  const { proposeCandidates: proposeCandidates2 } = await Promise.resolve().then(() => (init_cross_link(), cross_link_exports));
  const candidates = proposeCandidates2(
    repoRoot,
    nodes,
    []
    // no existing edges to dedup against
  );
  const k5Doc = {
    schema_version: "guild.knowledge.candidates.v1",
    stage: "k5",
    cross_link_candidates: candidates.map((c) => ({
      candidate_key: `${c.source}\u2192${c.target}:${c.type}`,
      source: c.source,
      target: c.target,
      type: c.type,
      reason: c.reason
    }))
  };
  fs10.writeFileSync(
    path10.join(candidateDir, "k5-candidates.json"),
    JSON.stringify(k5Doc, null, 2) + "\n",
    "utf8"
  );
}
function computeClustersDeterministic(repoRoot, codeRelPaths, docRelPaths) {
  const functionIds = extractFunctionIds(repoRoot, codeRelPaths);
  const docSections = extractClaimSections(repoRoot, docRelPaths);
  const mermaidEntries = extractMermaidEntries(repoRoot, docRelPaths);
  return buildContentClusters(codeRelPaths, functionIds, docSections, mermaidEntries);
}
async function runKnowledgeStagesK1ToK4(repoRoot, filePaths, seams) {
  const { codeRelPaths, docRelPaths, svgRelPaths = [], wikiDir } = filePaths;
  const allNodes = [];
  const allEdges = [];
  const clusters = computeClustersDeterministic(repoRoot, codeRelPaths, docRelPaths);
  const k1Opts = {};
  if (seams.proposeConcepts) k1Opts.proposeConcepts = seams.proposeConcepts;
  if (seams.proposeClaimsAndEntities)
    k1Opts.proposeClaimsAndEntities = seams.proposeClaimsAndEntities;
  if (!k1Opts.proposeConcepts && !k1Opts.proposeClaimsAndEntities) {
    k1Opts.proposeConcepts = async () => [];
  }
  const k1Result = await analyzeContent(repoRoot, codeRelPaths, docRelPaths, k1Opts);
  allNodes.push(...k1Result.nodes);
  allEdges.push(...k1Result.edges);
  const k3Paths = [...docRelPaths, ...svgRelPaths];
  const k3Result = analyzeDiagrams(repoRoot, k3Paths);
  allNodes.push(...k3Result.nodes);
  const k2Roots = [
    wikiDir ?? path10.join(repoRoot, ".guild", "wiki"),
    path10.join(repoRoot, "docs", "knowledge")
  ];
  const k2Opts = { repoRoot };
  if (seams.classifyPage) k2Opts.classifier = seams.classifyPage;
  const k2Suppressed = [];
  for (const k2Dir of k2Roots) {
    if (fs10.existsSync(k2Dir)) {
      const k2Result = await indexWiki(k2Dir, k2Opts);
      allNodes.push(...k2Result.nodes);
      allEdges.push(...k2Result.edges);
      k2Suppressed.push(...k2Result.suppressed);
    }
  }
  const k4Result = await buildTaxonomy(repoRoot, clusters, {
    proposeTaxonomy: seams.proposeTaxonomy
  });
  allNodes.push(...k4Result.nodes);
  allEdges.push(...k4Result.edges);
  return { nodes: allNodes, edges: allEdges, clusters, k2Suppressed };
}
async function runKnowledgeStages(repoRoot, filePaths, seams, opts = {}) {
  const partial = await runKnowledgeStagesK1ToK4(repoRoot, filePaths, seams);
  const allNodes = [...opts.structuralGraph?.nodes ?? [], ...partial.nodes];
  const allEdges = [...opts.structuralGraph?.edges ?? [], ...partial.edges];
  const suppressedEntries = [...partial.k2Suppressed];
  const k5Result = await buildCrossLinks(
    repoRoot,
    { nodes: allNodes, edges: allEdges },
    { confirmCrossLinks: seams.confirmCrossLinks }
  );
  allEdges.push(...k5Result.edges);
  const fallback = maybeSynthesizeFallbackRootTopic(allNodes, repoRoot);
  if (fallback) {
    allNodes.push(fallback.topicNode);
    allEdges.push(...fallback.edges);
  }
  const graphRaw = {
    version: "guild.knowledge_graph.v2",
    kind: "knowledge",
    generated_from_commit: opts.generatedFromCommit ?? "unknown",
    project: opts.project ?? { name: "guild", description: "Guild plugin self-build" },
    nodes: allNodes,
    edges: allEdges,
    layers: opts.structuralGraph?.layers ?? [],
    tour: opts.structuralGraph?.tour ?? []
  };
  const validation = validateGraphV2(graphRaw, {
    repoRoot,
    config: opts.config
  });
  if (!validation.data) {
    throw new Error(
      `validateGraphV2 returned a fatal result \u2014 refusing to write unvalidated graph. Fatal: ${validation.fatal ?? "unknown"}. Issues: ${JSON.stringify(validation.issues ?? [])}`
    );
  }
  const validated = validation.data;
  const validatorDropIssues = (validation.issues ?? []).filter(
    (issue) => issue.level === "dropped"
  );
  for (const issue of validatorDropIssues) {
    const idMatch = /^node "([^"]+)"/.exec(issue.message ?? "");
    const id = idMatch ? idMatch[1] : "(unknown)";
    const sourceRef = id.startsWith("wiki_page:") ? id.slice("wiki_page:".length) : id;
    suppressedEntries.push({
      id,
      source_ref: sourceRef,
      reason: issue.message ?? `validator dropped: category=${issue.category ?? "unknown"}`,
      stage: "validator-dropped"
    });
  }
  const canonNodes = validated.nodes.map(
    (n) => canonicalizeNode(n)
  );
  const canonEdges = validated.edges.map(
    (e) => canonicalizeEdge(e)
  );
  const graph = { ...validated, nodes: canonNodes, edges: canonEdges };
  const sc3OrphanWikiPageIds = findOrphanWikiPages(graph);
  if (sc3OrphanWikiPageIds.length > 0) {
    throw new Error(
      `[knowledge] SC-3 VIOLATION: ${sc3OrphanWikiPageIds.length} wiki_page node(s) have no topic-membership edge after finalize \u2014 the fallback root topic and cross-link Rule 6 both failed to cover: ${sc3OrphanWikiPageIds.join(", ")}. Refusing to write an SC-3-violating graph.`
    );
  }
  const indexesDir = path10.join(repoRoot, ".guild", "indexes");
  fs10.mkdirSync(indexesDir, { recursive: true });
  const suppressedDoc = {
    schema: "guild.knowledge_suppressed.v1",
    generated_at: opts.generatedAt ?? (/* @__PURE__ */ new Date()).toISOString(),
    suppressed: suppressedEntries
  };
  const suppressedPath = path10.join(indexesDir, "knowledge-suppressed.json");
  fs10.writeFileSync(suppressedPath, JSON.stringify(suppressedDoc, null, 2) + "\n", "utf8");
  const graphPath = path10.join(indexesDir, "knowledge-graph.json");
  fs10.writeFileSync(graphPath, JSON.stringify(graph, null, 2) + "\n", "utf8");
  const linksResult = writeKnowledgeLinks({
    graph: { nodes: graph.nodes, edges: graph.edges },
    repoRoot,
    runId: opts.runId,
    generatedAt: opts.generatedAt
  });
  return {
    graph,
    graphPath,
    linksPath: linksResult.linksPath,
    provenancePath: linksResult.provenancePath,
    suppressedPath,
    nodeCount: graph.nodes.length,
    edgeCount: graph.edges.length,
    sc3OrphanWikiPageIds
  };
}
if (require.main === module) {
  void (async () => {
    const args = process.argv.slice(2);
    const arg = (flag) => {
      const idx = args.findIndex(
        (a2) => a2 === flag || a2.startsWith(flag + "=")
      );
      if (idx === -1) return void 0;
      const a = args[idx];
      return a.includes("=") ? a.split("=").slice(1).join("=") : args[idx + 1];
    };
    const phase = arg("--phase");
    const cwd = arg("--cwd");
    const runId = arg("--run-id");
    const generatedAt = arg("--generated-at");
    if (!cwd) {
      process.stderr.write("Error: --cwd <repoRoot> is required\n");
      process.exit(1);
    }
    if (!phase || !["round1", "round2", "finalize"].includes(phase)) {
      process.stderr.write(
        "Error: --phase=round1|round2|finalize is required\n"
      );
      process.exit(1);
    }
    const repoRoot = path10.resolve(cwd);
    const runDir = runId ? path10.join(repoRoot, ".guild", "runs", runId, "knowledge") : path10.join(repoRoot, ".guild", "runs", "_current", "knowledge");
    const candidateDir = runDir;
    const judgmentDir = runDir;
    const filePaths = discoverFilePaths(repoRoot);
    if (phase === "round1") {
      emitRound1Candidates(repoRoot, filePaths, candidateDir);
      process.stdout.write(
        JSON.stringify({ phase: "round1", candidateDir, done: true }, null, 2) + "\n"
      );
    } else if (phase === "round2") {
      await emitRound2Candidates(repoRoot, filePaths, candidateDir, judgmentDir);
      process.stdout.write(
        JSON.stringify({ phase: "round2", candidateDir, done: true }, null, 2) + "\n"
      );
    } else if (phase === "finalize") {
      const seams = buildFileBackedSeams(judgmentDir);
      const structuralGraphPath = path10.join(repoRoot, ".guild", "indexes", "knowledge-graph.json");
      let structuralGraph;
      try {
        const prior = JSON.parse(fs10.readFileSync(structuralGraphPath, "utf8"));
        if (prior.version === "guild.knowledge_graph.v1" && Array.isArray(prior.nodes) && Array.isArray(prior.edges) && Array.isArray(prior.layers) && Array.isArray(prior.tour)) {
          structuralGraph = {
            nodes: prior.nodes,
            edges: prior.edges,
            layers: prior.layers,
            tour: prior.tour
          };
        }
      } catch {
      }
      const result = await runKnowledgeStages(repoRoot, filePaths, seams, {
        runId,
        generatedAt,
        generatedFromCommit: headSha(repoRoot),
        structuralGraph
      });
      process.stdout.write(
        JSON.stringify(
          {
            phase: "finalize",
            graphPath: result.graphPath,
            linksPath: result.linksPath,
            provenancePath: result.provenancePath,
            nodeCount: result.nodeCount,
            edgeCount: result.edgeCount,
            done: true
          },
          null,
          2
        ) + "\n"
      );
    }
  })();
}
function discoverFilePaths(repoRoot) {
  const codeRelPaths = [];
  const docRelPaths = [];
  const svgRelPaths = [];
  const filter = createIgnoreFilter(repoRoot);
  const walk = (dir, relBase) => {
    let entries;
    try {
      entries = fs10.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      const rel = relBase ? `${relBase}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (filter.isIgnored(rel) || filter.isIgnored(rel + "/")) continue;
        walk(path10.join(dir, e.name), rel);
        continue;
      }
      if (!e.isFile()) continue;
      const lower = e.name.toLowerCase();
      if (lower.endsWith(".svg")) {
        svgRelPaths.push(rel);
        continue;
      }
      if (filter.isIgnored(rel)) continue;
      if (lower.endsWith(".md")) {
        docRelPaths.push(rel);
      } else if (isCodeLanguage(detectLanguage(e.name)) && !/\.test\.|\.spec\./.test(e.name)) {
        codeRelPaths.push(rel);
      }
    }
  };
  walk(repoRoot, "");
  codeRelPaths.sort();
  docRelPaths.sort();
  svgRelPaths.sort();
  return {
    codeRelPaths,
    docRelPaths,
    svgRelPaths,
    wikiDir: path10.join(repoRoot, ".guild", "wiki")
  };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  FALLBACK_ROOT_TOPIC_NAME,
  FALLBACK_ROOT_TOPIC_SEED,
  buildFileBackedSeams,
  deriveFallbackRootTopicName,
  discoverFilePaths,
  emitRound1Candidates,
  emitRound2Candidates,
  findOrphanWikiPages,
  maybeSynthesizeFallbackRootTopic,
  runKnowledgeStages
});
