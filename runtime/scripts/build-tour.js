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

// scripts/learn/build-tour.ts
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

// scripts/learn/lib/tour.ts
function buildTourOrder(graph) {
  const fileNodes = graph.nodes.filter((n) => n.type === "file");
  if (fileNodes.length === 0) return [];
  const inDeg = /* @__PURE__ */ new Map();
  const adj = /* @__PURE__ */ new Map();
  for (const f of fileNodes) {
    inDeg.set(f.id, 0);
    adj.set(f.id, []);
  }
  for (const e of graph.edges) {
    if (e.type !== "imports") continue;
    if (!inDeg.has(e.source) || !inDeg.has(e.target)) continue;
    adj.get(e.source).push(e.target);
    inDeg.set(e.target, (inDeg.get(e.target) ?? 0) + 1);
  }
  const queue = [...fileNodes].sort((a, b) => inDeg.get(a.id) - inDeg.get(b.id) || a.id.localeCompare(b.id)).map((n) => n.id);
  const visited = /* @__PURE__ */ new Set();
  const order = [];
  while (queue.length) {
    const id = queue.shift();
    if (visited.has(id)) continue;
    visited.add(id);
    order.push(id);
    for (const next of (adj.get(id) ?? []).sort()) {
      if (!visited.has(next)) queue.push(next);
    }
  }
  const target = Math.max(5, Math.min(15, Math.ceil(order.length / 5)));
  const perStep = Math.max(1, Math.min(5, Math.ceil(order.length / target)));
  const steps = [];
  for (let i = 0, o = 0; i < order.length; i += perStep, o++) {
    const slice = order.slice(i, i + perStep);
    steps.push({
      order: o,
      title: `Step ${o + 1}`,
      description: "",
      nodeIds: slice
    });
    if (steps.length >= 15) break;
  }
  return steps;
}

// scripts/learn/build-tour.ts
function main() {
  const argv = process.argv.slice(2);
  const cwd = parseCwd(argv);
  ensureStorageLayout(cwd, { detectOnly: true });
  const gp = guildPaths(cwd);
  const inPath = parseFlag(argv, "in");
  const target = inPath ? path4.resolve(cwd, inPath) : gp.knowledgeGraph;
  const graph = readJson(target);
  if (!graph) {
    process.stderr.write(`[tour] ERROR: cannot read ${target}
`);
    process.exit(1);
  }
  graph.tour = buildTourOrder(graph);
  writeJson(target, graph);
  process.stderr.write(
    `[tour] ${graph.tour.length} steps \u2192 ${path4.relative(gp.repoRoot, target)}
`
  );
  if (hasFlag(argv, "print")) process.stdout.write(JSON.stringify(graph.tour, null, 2) + "\n");
  else process.stdout.write(`${graph.tour.length} tour steps
`);
}
main();
