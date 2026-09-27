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
var path2 = __toESM(require("path"));

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
  const gp = guildPaths(cwd);
  const inPath = parseFlag(argv, "in");
  const target = inPath ? path2.resolve(cwd, inPath) : gp.knowledgeGraph;
  const graph = readJson(target);
  if (!graph) {
    process.stderr.write(`[tour] ERROR: cannot read ${target}
`);
    process.exit(1);
  }
  graph.tour = buildTourOrder(graph);
  writeJson(target, graph);
  process.stderr.write(
    `[tour] ${graph.tour.length} steps \u2192 ${path2.relative(gp.repoRoot, target)}
`
  );
  if (hasFlag(argv, "print")) process.stdout.write(JSON.stringify(graph.tour, null, 2) + "\n");
  else process.stdout.write(`${graph.tour.length} tour steps
`);
}
main();
