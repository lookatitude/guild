#!/usr/bin/env node
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
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

// scripts/learn/derive-domain.ts
var path5 = __toESM(require("path"));

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

// scripts/learn/lib/knowledge-links-io.ts
var fs2 = __toESM(require("fs"));
var path2 = __toESM(require("path"));
var KNOWLEDGE_LINKS_SCHEMA_VERSION = "guild.knowledge_links.v1";
function loadKnowledgeLinksDoc(file) {
  try {
    const raw = fs2.readFileSync(file, "utf8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed["links"])) {
      const schemaVersion = typeof parsed["schema_version"] === "string" ? parsed["schema_version"] : typeof parsed["version"] === "string" ? parsed["version"] : KNOWLEDGE_LINKS_SCHEMA_VERSION;
      return { schema_version: schemaVersion, links: parsed["links"] };
    }
  } catch {
  }
  return { schema_version: KNOWLEDGE_LINKS_SCHEMA_VERSION, links: [] };
}
function writeKnowledgeLinksDoc(file, doc) {
  fs2.mkdirSync(path2.dirname(file), { recursive: true });
  const out = {
    schema_version: doc.schema_version || KNOWLEDGE_LINKS_SCHEMA_VERSION,
    links: doc.links
  };
  fs2.writeFileSync(file, JSON.stringify(out, null, 2) + "\n", "utf8");
}
function linkKey(l) {
  return `${l.from}|${l.to}|${l.type}`;
}
function appendKnowledgeLinksBatch(file, batch) {
  const doc = loadKnowledgeLinksDoc(file);
  const existing = new Set(doc.links.map(linkKey));
  let added = 0;
  for (const link of batch) {
    const key = linkKey(link);
    if (!existing.has(key)) {
      existing.add(key);
      doc.links.push(link);
      added++;
    }
  }
  writeKnowledgeLinksDoc(file, { schema_version: KNOWLEDGE_LINKS_SCHEMA_VERSION, links: doc.links });
  return { added, total: doc.links.length };
}

// scripts/learn/lib/domain.ts
function relOf(n) {
  const sr = n.source_refs?.[0];
  return sr ? sr.split("#")[0] : null;
}
function moduleOf(rel) {
  const norm = rel.replace(/\\/g, "/");
  const parts = norm.split("/");
  return parts.length > 1 ? parts[0] : "(root)";
}
function deriveDomain(graph) {
  const nodes = [];
  const edges = [];
  const seen = new Set(graph.nodes.map((n) => n.id));
  const byModule = /* @__PURE__ */ new Map();
  for (const n of graph.nodes) {
    if (n.type !== "file") continue;
    const rel = relOf(n);
    if (!rel) continue;
    const mod = moduleOf(rel);
    n.domain = mod;
    const arr = byModule.get(mod) ?? [];
    arr.push(n);
    byModule.set(mod, arr);
  }
  const add = (n) => {
    if (!seen.has(n.id)) {
      seen.add(n.id);
      nodes.push(n);
    }
  };
  for (const [mod, files] of byModule) {
    const domainId = `domain:${mod}`;
    add({ id: domainId, type: "domain", name: mod, source_refs: [mod], confidence: "low" });
    const flowFiles = files.filter(
      (f) => graph.edges.some((e) => e.source === f.id && e.type === "contains")
    );
    const flowSet = flowFiles.length ? flowFiles : files.slice(0, 1);
    let flowOrder = 0;
    for (const f of flowSet) {
      const rel = relOf(f);
      const flowId = `flow:${rel}`;
      add({ id: flowId, type: "flow", name: rel, source_refs: f.source_refs, confidence: "low" });
      edges.push({ source: domainId, target: flowId, type: "contains_flow", direction: "out", weight: 1 });
      const stepNodeIds = graph.edges.filter((e) => e.source === f.id && e.type === "contains").map((e) => e.target).filter((id) => id.startsWith("function:"));
      const count = stepNodeIds.length;
      stepNodeIds.forEach((sid, i) => {
        const w = Math.round((i + 1) / (count + 1) * 1e3) / 1e3;
        edges.push({ source: flowId, target: sid, type: "flow_step", direction: "out", weight: w });
      });
      flowOrder++;
    }
  }
  return { nodes, edges };
}
function appendKnowledgeLinks(knowledgeLinksPath, graph, runId) {
  const batch = [];
  for (const n of graph.nodes) {
    if (n.type !== "file") continue;
    const dom = n.domain;
    if (!dom) continue;
    batch.push({ from: `domain:${dom}`, to: n.id, type: "touches", run_id: runId });
  }
  return appendKnowledgeLinksBatch(knowledgeLinksPath, batch);
}

// scripts/lib/state/ensure-storage-layout.ts
var fs4 = __toESM(require("node:fs"));
var path4 = __toESM(require("node:path"));

// src/domains/state/guild-root.ts
var fs3 = __toESM(require("node:fs"));
var path3 = __toESM(require("node:path"));
function resolveGuildRoot(startDir) {
  const resolvedStart = path3.resolve(startDir);
  let current = resolvedStart;
  let nearestGuildDir = null;
  for (; ; ) {
    if (fs3.existsSync(path3.join(current, ".git"))) return current;
    if (nearestGuildDir === null) {
      const guildDir = path3.join(current, ".guild");
      try {
        if (fs3.existsSync(guildDir) && fs3.statSync(guildDir).isDirectory()) nearestGuildDir = current;
      } catch {
      }
    }
    const parent = path3.dirname(current);
    if (parent === current) return nearestGuildDir ?? resolvedStart;
    current = parent;
  }
}

// scripts/lib/state/ensure-storage-layout.ts
var CURRENT_LAYOUT_VERSION = 2;
function markerPath(root) {
  return path4.join(root, ".guild", "storage-layout.json");
}
function detect(cwd = process.cwd()) {
  const root = resolveGuildRoot(cwd);
  const marker = markerPath(root);
  if (!fs4.existsSync(path4.join(root, ".guild"))) {
    return { state: "absent", version: null, root, marker };
  }
  let version = null;
  try {
    const parsed = JSON.parse(fs4.readFileSync(marker, "utf8"));
    if (typeof parsed.storage_layout_version === "number") version = parsed.storage_layout_version;
  } catch {
    version = null;
  }
  if (version === null) return { state: "unmarked", version, root, marker };
  if (version === CURRENT_LAYOUT_VERSION) return { state: "current", version, root, marker };
  return { state: version > CURRENT_LAYOUT_VERSION ? "future" : "stale", version, root, marker };
}
var upgradeChunk = null;
function upgradeChain() {
  if (upgradeChunk === null) {
    const candidates = [
      path4.join(__dirname, "upgrade-chain.js"),
      path4.join(__dirname, "lib", "state", "upgrade-chain"),
      path4.join(__dirname, "upgrade-chain")
    ];
    const spec = candidates.find((c) => fs4.existsSync(c) || fs4.existsSync(`${c}.ts`)) ?? candidates[2];
    upgradeChunk = require(spec);
  }
  return upgradeChunk;
}
function ensureStorageLayout(cwd = process.cwd(), opts = {}) {
  const status = detect(cwd);
  if (status.state === "current") return status;
  if (status.state === "future") {
    throw new Error(
      `guild: .guild/ is layout ${status.version}, this build understands ${CURRENT_LAYOUT_VERSION}. Upgrade Guild; a newer layout is never down-migrated (${status.marker}).`
    );
  }
  if (status.state === "absent" || opts.detectOnly === true) return status;
  const chain = upgradeChain();
  const result = chain.runLayoutUpgrade({
    root: status.root,
    fromVersion: status.version,
    toVersion: CURRENT_LAYOUT_VERSION,
    dryRun: opts.dryRun === true
  });
  const after = detect(cwd);
  return { ...after, upgrade: result };
}
function isProcessEntry() {
  const entry = process.argv[1];
  if (typeof entry !== "string" || entry === "") return false;
  return /(^|[\\/])ensure-storage-layout(\.[cm]?[jt]s)?$/.test(entry);
}
if (isProcessEntry()) {
  const cwdArg = process.argv.find((a) => a.startsWith("--cwd="));
  const cwd = cwdArg ? cwdArg.slice("--cwd=".length) : process.cwd();
  try {
    const status = ensureStorageLayout(cwd, {
      dryRun: process.argv.includes("--dry-run"),
      detectOnly: process.argv.includes("--detect-only")
    });
    if (process.argv.includes("--print")) {
      process.stdout.write(JSON.stringify(status) + "\n");
    } else if (status.upgrade && status.upgrade.state !== "committed") {
      process.stderr.write(`${status.upgrade.report}
`);
    }
    process.exit(0);
  } catch (e) {
    process.stderr.write(`${e.message}
`);
    process.exit(1);
  }
}

// scripts/learn/derive-domain.ts
function resolveRunId(cwd, argv) {
  const flag = parseFlag(argv, "run-id");
  if (flag) return flag;
  const sentinel = path5.join(cwd, ".guild", "runs", "current-run-id");
  try {
    return require("fs").readFileSync(sentinel, "utf8").trim() || "run-unknown";
  } catch {
    return "run-unknown";
  }
}
function main() {
  const argv = process.argv.slice(2);
  const cwd = parseCwd(argv);
  ensureStorageLayout(cwd, { detectOnly: true });
  const gp = guildPaths(cwd);
  const inPath = parseFlag(argv, "in");
  const target = inPath ? path5.resolve(cwd, inPath) : gp.knowledgeGraph;
  const runId = resolveRunId(cwd, argv);
  const graph = readJson(target);
  if (!graph) {
    process.stderr.write(`[domain] ERROR: cannot read ${target}
`);
    process.exit(1);
  }
  const { nodes, edges } = deriveDomain(graph);
  const ids = new Set(graph.nodes.map((n) => n.id));
  for (const n of nodes) if (!ids.has(n.id)) graph.nodes.push(n);
  const ek = new Set(graph.edges.map((e) => `${e.type}|${e.source}|${e.target}`));
  for (const e of edges) {
    const k = `${e.type}|${e.source}|${e.target}`;
    if (!ek.has(k)) graph.edges.push(e);
  }
  writeJson(target, graph);
  const kl = appendKnowledgeLinks(gp.knowledgeLinks, graph, runId);
  process.stderr.write(
    `[domain] +${nodes.length} domain/flow/step nodes \xB7 +${edges.length} edges \xB7 knowledge-links +${kl.added} (total ${kl.total}) \u2192 ${path5.relative(gp.repoRoot, gp.knowledgeLinks)}
`
  );
  if (hasFlag(argv, "print")) {
    process.stdout.write(JSON.stringify({ addedNodes: nodes.length, addedEdges: edges.length, knowledgeLinks: kl }, null, 2) + "\n");
  } else {
    process.stdout.write(`domains=${nodes.filter((n) => n.type === "domain").length} links+=${kl.added}
`);
  }
}
main();
