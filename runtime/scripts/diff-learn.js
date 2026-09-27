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

// scripts/learn/diff-learn.ts
var fs2 = __toESM(require("fs"));
var path2 = __toESM(require("path"));

// scripts/learn/lib/paths.ts
var fs = __toESM(require("fs"));
var path = __toESM(require("path"));
var import_child_process = require("child_process");
var SCHEMA = {
  codebaseMap: "guild.codebase_map.v1",
  knowledgeGraph: "guild.knowledge_graph.v1",
  diffUnderstanding: "guild.diff_understanding.v1",
  knowledgeLinks: "guild.knowledge_links.v1"
};
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

// scripts/learn/lib/git.ts
var import_child_process2 = require("child_process");
function git(cwd, args) {
  return (0, import_child_process2.execFileSync)("git", args, { cwd, encoding: "utf-8" }).trim();
}
function headSha(cwd) {
  try {
    return git(cwd, ["rev-parse", "HEAD"]);
  } catch {
    return "unknown";
  }
}
function changedFiles(cwd, base, head = "HEAD") {
  try {
    const out = git(cwd, ["diff", `${base}..${head}`, "--name-only"]);
    return out.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
  } catch {
    return [];
  }
}

// scripts/learn/diff-learn.ts
function resolveRunId(cwd, argv) {
  const flag = parseFlag(argv, "run-id");
  if (flag) return flag;
  try {
    return fs2.readFileSync(path2.join(cwd, ".guild", "runs", "current-run-id"), "utf8").trim() || "run-adhoc";
  } catch {
    return "run-adhoc";
  }
}
function relOfNode(srcRefs) {
  const r = srcRefs?.[0];
  return r ? r.split("#")[0] : null;
}
function main() {
  const argv = process.argv.slice(2);
  const cwd = parseCwd(argv);
  const gp = guildPaths(cwd);
  const base = parseFlag(argv, "base");
  const head = parseFlag(argv, "head") ?? "HEAD";
  if (!base) {
    process.stderr.write("[diff] ERROR: --base <sha> required\n");
    process.exit(1);
  }
  const runId = resolveRunId(cwd, argv);
  const graph = readJson(gp.knowledgeGraph);
  if (!graph) {
    process.stderr.write(`[diff] ERROR: knowledge-graph.json not found (build it first)
`);
    process.exit(1);
  }
  const changed = changedFiles(gp.repoRoot, base, head);
  const changedSet = new Set(changed);
  const affectedNodes = [];
  const tracedFiles = /* @__PURE__ */ new Set();
  for (const n of graph.nodes) {
    const rel = relOfNode(n.source_refs);
    if (rel && changedSet.has(rel)) {
      affectedNodes.push(n.id);
      tracedFiles.add(rel);
    }
  }
  const affectedNodeSet = new Set(affectedNodes);
  const affectedLayers = graph.layers.filter((l) => l.nodeIds.some((id) => affectedNodeSet.has(id))).map((l) => l.id);
  const untraced = changed.filter((f) => !tracedFiles.has(f));
  const nodeCount = affectedNodes.length;
  const layerCount = affectedLayers.length;
  let risk = "low";
  if (layerCount >= 4 || nodeCount > 40) risk = "high";
  else if (layerCount >= 2 || nodeCount > 10) risk = "medium";
  const artifact = {
    version: SCHEMA.diffUnderstanding,
    base: base === "HEAD" ? headSha(gp.repoRoot) : base,
    head: head === "HEAD" ? headSha(gp.repoRoot) : head,
    changed_files: changed,
    affected_nodes: affectedNodes,
    affected_layers: affectedLayers,
    blast_radius: { node_count: nodeCount, layer_count: layerCount, risk },
    untraced_files: untraced
  };
  const outPath = path2.join(gp.runsDir, runId, "diff-learn.json");
  writeJson(outPath, artifact);
  process.stderr.write(
    `[diff] changed=${changed.length} affected_nodes=${nodeCount} layers=${layerCount} risk=${risk} untraced=${untraced.length} \u2192 ${path2.relative(gp.repoRoot, outPath)}
`
  );
  if (hasFlag(argv, "print")) process.stdout.write(JSON.stringify(artifact, null, 2) + "\n");
  else process.stdout.write(path2.relative(gp.repoRoot, outPath) + "\n");
}
main();
