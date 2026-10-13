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

// scripts/learn/assign-layers.ts
var path4 = __toESM(require("path"));

// scripts/learn/lib/paths.ts
var fs3 = __toESM(require("fs"));
var path3 = __toESM(require("path"));
var import_child_process = require("child_process");

// scripts/lib/state/ensure-storage-layout.ts
var fs2 = __toESM(require("node:fs"));
var path2 = __toESM(require("node:path"));

// src/domains/state/guild-root.ts
var fs = __toESM(require("node:fs"));
var path = __toESM(require("node:path"));
function resolveGuildRoot(startDir) {
  const resolvedStart = path.resolve(startDir);
  let current = resolvedStart;
  let nearestGuildDir = null;
  for (; ; ) {
    if (fs.existsSync(path.join(current, ".git"))) return current;
    if (nearestGuildDir === null) {
      const guildDir = path.join(current, ".guild");
      try {
        if (fs.existsSync(guildDir) && fs.statSync(guildDir).isDirectory()) nearestGuildDir = current;
      } catch {
      }
    }
    const parent = path.dirname(current);
    if (parent === current) return nearestGuildDir ?? resolvedStart;
    current = parent;
  }
}

// scripts/lib/state/ensure-storage-layout.ts
var CURRENT_LAYOUT_VERSION = 2;
function durableGuildDir(root) {
  return path2.join(root, ".guild");
}
function markerPath(root) {
  return path2.join(root, ".guild", "storage-layout.json");
}
function detect(cwd = process.cwd()) {
  const root = resolveGuildRoot(cwd);
  const marker = markerPath(root);
  if (!fs2.existsSync(path2.join(root, ".guild"))) {
    return { state: "absent", version: null, root, marker };
  }
  let version = null;
  try {
    const parsed = JSON.parse(fs2.readFileSync(marker, "utf8"));
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
      path2.join(__dirname, "upgrade-chain.js"),
      path2.join(__dirname, "lib", "state", "upgrade-chain"),
      path2.join(__dirname, "upgrade-chain")
    ];
    const spec = candidates.find((c) => fs2.existsSync(c) || fs2.existsSync(`${c}.ts`)) ?? candidates[2];
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

// scripts/learn/lib/paths.ts
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
    const abs = path3.isAbsolute(commonDir) ? commonDir : path3.resolve(cwd, commonDir);
    const root = path3.dirname(abs);
    if (fs3.existsSync(root)) return root;
  } catch {
  }
  return path3.resolve(cwd);
}
function guildPaths(cwd) {
  const repoRoot = resolveMainRepoRoot(cwd);
  const guildDir = durableGuildDir(repoRoot);
  const indexesDir = path3.join(guildDir, "indexes");
  const runsDir = path3.join(guildDir, "runs");
  return {
    repoRoot,
    guildDir,
    indexesDir,
    runsDir,
    codebaseMap: path3.join(indexesDir, "codebase-map.json"),
    knowledgeGraph: path3.join(indexesDir, "knowledge-graph.json"),
    knowledgeLinks: path3.join(indexesDir, "knowledge-links.json"),
    knowledgeRecall: path3.join(indexesDir, "knowledge-recall.json"),
    fingerprint: path3.join(indexesDir, "understand-fingerprint.json"),
    partialGraph: path3.join(indexesDir, "understand-partial-graph.json")
  };
}
function writeJson(filePath, data) {
  fs3.mkdirSync(path3.dirname(filePath), { recursive: true });
  fs3.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf8");
}
function readJson(filePath) {
  try {
    return JSON.parse(fs3.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

// scripts/learn/lib/layers.ts
var LAYER_PATTERNS = [
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
  { patterns: ["doc", "docs", "knowledge", "wiki"], name: "Documentation Layer", description: "Documentation and knowledge base" }
];
function layerId(name) {
  return `layer:${name.toLowerCase().replace(/\s+/g, "-")}`;
}
function relOf(node) {
  const sr = node.source_refs?.[0];
  if (!sr) return null;
  return sr.split("#")[0].replace(/\\/g, "/").toLowerCase();
}
function matchLayer(relPath) {
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
function assignLayers(graph) {
  const map = /* @__PURE__ */ new Map();
  for (const node of graph.nodes) {
    if (node.type !== "file") continue;
    const rel = relOf(node);
    const name = rel && matchLayer(rel) || "Core";
    node.component = name;
    const arr = map.get(name) ?? [];
    arr.push(node.id);
    map.set(name, arr);
  }
  const layers = [];
  for (const [name, nodeIds] of map) {
    const description = name === "Core" ? "Core application files not matched to a specific layer" : LAYER_PATTERNS.find((p) => p.name === name)?.description ?? "";
    layers.push({ id: layerId(name), name, description, nodeIds });
  }
  return layers.sort((a, b) => a.name.localeCompare(b.name));
}

// scripts/learn/assign-layers.ts
function main() {
  const argv = process.argv.slice(2);
  const cwd = parseCwd(argv);
  ensureStorageLayout(cwd, { detectOnly: true });
  const gp = guildPaths(cwd);
  const inPath = parseFlag(argv, "in");
  const target = inPath ? path4.resolve(cwd, inPath) : gp.knowledgeGraph;
  const graph = readJson(target);
  if (!graph) {
    process.stderr.write(`[layers] ERROR: cannot read ${target}
`);
    process.exit(1);
  }
  graph.layers = assignLayers(graph);
  const fileNodes = graph.nodes.filter((n) => n.type === "file").map((n) => n.id);
  const seen = /* @__PURE__ */ new Map();
  for (const l of graph.layers) for (const id of l.nodeIds) seen.set(id, (seen.get(id) ?? 0) + 1);
  const missing = fileNodes.filter((id) => !seen.has(id));
  const dup = fileNodes.filter((id) => (seen.get(id) ?? 0) > 1);
  if (missing.length || dup.length) {
    process.stderr.write(`[layers] WARN invariant: missing=${missing.length} dup=${dup.length}
`);
  }
  writeJson(target, graph);
  process.stderr.write(
    `[layers] ${graph.layers.length} layers over ${fileNodes.length} file nodes \u2192 ${path4.relative(gp.repoRoot, target)}
`
  );
  if (hasFlag(argv, "print")) {
    process.stdout.write(JSON.stringify(graph.layers, null, 2) + "\n");
  } else {
    process.stdout.write(graph.layers.map((l) => `${l.name} (${l.nodeIds.length})`).join(", ") + "\n");
  }
}
main();
