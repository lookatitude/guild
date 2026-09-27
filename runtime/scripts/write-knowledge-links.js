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

// scripts/learn/write-knowledge-links.ts
var write_knowledge_links_exports = {};
__export(write_knowledge_links_exports, {
  KNOWLEDGE_LINKS_PROVENANCE_SCHEMA_VERSION: () => KNOWLEDGE_LINKS_PROVENANCE_SCHEMA_VERSION,
  KNOWLEDGE_RECALL_SCHEMA_VERSION: () => KNOWLEDGE_RECALL_SCHEMA_VERSION,
  canonicalizeEdge: () => canonicalizeEdge,
  canonicalizeNode: () => canonicalizeNode,
  sortNodesByRecall: () => sortNodesByRecall,
  writeKnowledgeLinks: () => writeKnowledgeLinks
});
module.exports = __toCommonJS(write_knowledge_links_exports);
var fs2 = __toESM(require("fs"));
var path2 = __toESM(require("path"));

// src/domains/knowledge/knowledge-links-contract.ts
var KNOWLEDGE_RECALL_SCHEMA_VERSION = "guild.knowledge_links.v2";
var KNOWLEDGE_LINKS_PROVENANCE_SCHEMA_VERSION = "guild.knowledge_links.provenance.v1";

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
function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
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
  const indexesDir = path2.join(repoRoot, ".guild", "indexes");
  fs2.mkdirSync(indexesDir, { recursive: true });
  const linksPath = path2.join(indexesDir, "knowledge-recall.json");
  fs2.writeFileSync(linksPath, JSON.stringify(linksDoc, null, 2) + "\n", "utf8");
  const provenanceDoc = {
    schema_version: KNOWLEDGE_LINKS_PROVENANCE_SCHEMA_VERSION,
    run_id: runId ?? null,
    generated_at: generatedAt ?? null,
    node_count: graph.nodes.length,
    edge_count: dedupedEdges.length
  };
  const provenancePath = path2.join(indexesDir, "knowledge-recall-provenance.json");
  fs2.writeFileSync(provenancePath, JSON.stringify(provenanceDoc, null, 2) + "\n", "utf8");
  return {
    linksPath,
    provenancePath,
    nodeCount: graph.nodes.length,
    edgeCount: dedupedEdges.length
  };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  KNOWLEDGE_LINKS_PROVENANCE_SCHEMA_VERSION,
  KNOWLEDGE_RECALL_SCHEMA_VERSION,
  canonicalizeEdge,
  canonicalizeNode,
  sortNodesByRecall,
  writeKnowledgeLinks
});
