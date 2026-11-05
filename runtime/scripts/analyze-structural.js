#!/usr/bin/env node
if (require.main === module) { const a = process.argv.slice(2), e = a.indexOf("--"); if ((e < 0 ? a : a.slice(0, e)).some((x) => x === "--help" || x === "-h")) { require("fs").writeSync(1, "usage: node runtime/scripts/analyze-structural.js [--cwd <path>] [--print]\n"); process.exit(0); } }
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

// scripts/learn/analyze-structural.ts
var fs8 = __toESM(require("fs"));
var path9 = __toESM(require("path"));

// scripts/learn/lib/paths.ts
var fs6 = __toESM(require("fs"));
var path6 = __toESM(require("path"));
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
    const candidates2 = [
      path2.join(__dirname, "upgrade-chain.js"),
      path2.join(__dirname, "lib", "state", "upgrade-chain"),
      path2.join(__dirname, "upgrade-chain")
    ];
    const spec = candidates2.find((c) => fs2.existsSync(c) || fs2.existsSync(`${c}.ts`)) ?? candidates2[2];
    upgradeChunk = require(spec);
  }
  return upgradeChunk;
}
function ensureStorageLayout(cwd = process.cwd(), opts = {}) {
  const status = detect(cwd);
  if (status.state === "current" && opts.recheck !== true) return status;
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
    dryRun: opts.dryRun === true,
    fresh: opts.recheck === true
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

// src/domains/knowledge/source-basis.ts
var import_node_child_process = require("node:child_process");
var fs3 = __toESM(require("node:fs"));
var path3 = __toESM(require("node:path"));
function realRoot(root) {
  try {
    return fs3.realpathSync(root);
  } catch {
    return path3.resolve(root);
  }
}
function git(cwd, args) {
  try {
    return (0, import_node_child_process.execFileSync)("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return null;
  }
}
function resolveSourceWorktreeRoot(cwd) {
  const top = git(cwd, ["rev-parse", "--show-toplevel"])?.trim();
  return realRoot(top ? top : cwd);
}
function readWorktreeEntry(root, rel) {
  if (path3.isAbsolute(rel) || rel.includes("\\")) return { kind: "refused" };
  const segs = rel.split("/");
  if (segs.some((seg) => seg === "" || seg === "." || seg === "..")) return { kind: "refused" };
  let cur = root;
  for (let i = 0; i < segs.length; i++) {
    cur = path3.join(cur, segs[i]);
    let st;
    try {
      st = fs3.lstatSync(cur);
    } catch {
      return { kind: "absent" };
    }
    const last = i === segs.length - 1;
    if (st.isSymbolicLink()) return last ? { kind: "symlink", target: fs3.readlinkSync(cur) } : { kind: "refused" };
    if (!last && !st.isDirectory()) return { kind: "absent" };
    if (last) return st.isFile() ? { kind: "file", bytes: fs3.readFileSync(cur) } : { kind: "refused" };
  }
  return { kind: "refused" };
}
function readContainedFile(root, rel) {
  const e = readWorktreeEntry(root, rel);
  return e.kind === "file" ? e.bytes : null;
}

// scripts/learn/lib/ignore.ts
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
  const rootIgnore = readContainedFile(projectRoot, ".guildignore");
  if (rootIgnore) {
    patterns.push(...rootIgnore.toString("utf-8").split("\n"));
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

// scripts/learn/lib/walk.ts
var fs4 = __toESM(require("fs"));
var path4 = __toESM(require("path"));
function registeredSubGuildPaths(repoRoot) {
  const out = /* @__PURE__ */ new Set();
  let manifest;
  try {
    manifest = JSON.parse(fs4.readFileSync(path4.join(durableGuildDir(repoRoot), "workspace.json"), "utf8"));
  } catch {
    return out;
  }
  if (manifest === null || typeof manifest !== "object" || manifest.is_workspace !== true || !Array.isArray(manifest.sub_guilds)) return out;
  for (const sg of manifest.sub_guilds) {
    const p = sg?.path;
    if (typeof p === "string" && p !== "" && p !== "." && p !== ".." && !/[\\/]/.test(p)) out.add(p);
  }
  return out;
}
function walkRepo(repoRoot, maxFiles = 2e4) {
  const filter = createIgnoreFilter(repoRoot);
  const subGuilds = registeredSubGuildPaths(repoRoot);
  const out = [];
  let truncated = false;
  const unreadable = [];
  const unsupported = [];
  const visit = (absDir) => {
    if (truncated) return;
    let entries;
    try {
      entries = fs4.readdirSync(absDir, { withFileTypes: true });
    } catch {
      unreadable.push(path4.relative(repoRoot, absDir).replace(/\\/g, "/"));
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      const abs = path4.join(absDir, e.name);
      if (path4.sep === "/" && e.name.includes("\\") || e.name.includes("\uFFFD")) {
        unsupported.push(path4.relative(repoRoot, abs));
        continue;
      }
      const rel = path4.relative(repoRoot, abs).replace(/\\/g, "/");
      if (e.isDirectory()) {
        if (subGuilds.has(rel)) continue;
        if (filter.isIgnored(rel) || filter.isIgnored(rel + "/")) continue;
        visit(abs);
      } else if (e.isFile()) {
        if (filter.isIgnored(rel)) continue;
        if (out.length >= maxFiles) {
          truncated = true;
          return;
        }
        out.push(rel);
      }
    }
  };
  visit(repoRoot);
  out.sort();
  return { files: out, filter, truncated, unreadable: unreadable.sort(), unsupported: unsupported.sort() };
}

// scripts/learn/lib/tsconfig-chain.ts
var fs5 = __toESM(require("fs"));
var path5 = __toESM(require("path"));
var TSCONFIG_MAX_DEPTH = 8;
var LINE_BREAK = /[\n\r\u2028\u2029]/;
function parseJsonc(text) {
  const src = text.charCodeAt(0) === 65279 ? text.slice(1) : text;
  let noComments = "";
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '"') {
      let j = i + 1;
      while (j < src.length && src[j] !== '"') j += src[j] === "\\" ? 2 : 1;
      if (j >= src.length) throw new SyntaxError("parseJsonc: unterminated string");
      noComments += src.slice(i, j + 1);
      i = j;
    } else if (c === "/" && src[i + 1] === "/") {
      while (i < src.length && !LINE_BREAK.test(src[i])) i++;
      noComments += "\n";
    } else if (c === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      if (end < 0) throw new SyntaxError("parseJsonc: unterminated block comment");
      noComments += " ";
      i = end + 1;
    } else {
      noComments += c;
    }
  }
  let out = "";
  for (let i = 0; i < noComments.length; i++) {
    const c = noComments[i];
    if (c === '"') {
      let j = i + 1;
      while (j < noComments.length && noComments[j] !== '"') j += noComments[j] === "\\" ? 2 : 1;
      out += noComments.slice(i, j + 1);
      i = j;
      continue;
    }
    if (c === ",") {
      let k = i + 1;
      while (k < noComments.length && /\s/.test(noComments[k])) k++;
      if (noComments[k] === "}" || noComments[k] === "]") continue;
    }
    out += c;
  }
  return JSON.parse(out);
}
function contained(root, abs) {
  const rel = path5.relative(root, abs);
  if (rel === "" || rel.startsWith("..") || path5.isAbsolute(rel)) return null;
  return rel.split(path5.sep).join("/");
}
function isAbsentError(err) {
  const code = err?.code;
  return code === "ENOENT" || code === "ENOTDIR";
}
function entryPresent(root, rel) {
  try {
    fs5.lstatSync(path5.join(root, rel));
    return true;
  } catch (err) {
    return !isAbsentError(err);
  }
}
function presentNonDirectory(root, rel) {
  try {
    return !fs5.lstatSync(path5.join(root, rel)).isDirectory();
  } catch (err) {
    return !isAbsentError(err);
  }
}
function readJson(root, rel) {
  const bytes = readContainedFile(root, rel);
  if (!bytes) return null;
  try {
    const v = parseJsonc(bytes.toString("utf8"));
    return v && typeof v === "object" && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}
function candidates(root, fromRel, spec, probed, refuse) {
  const fromDir = path5.join(root, path5.posix.dirname(fromRel));
  const withJson = (p) => p.endsWith(".json") ? [p] : [p, `${p}.json`];
  if (spec.startsWith("./") || spec.startsWith("../") || path5.isAbsolute(spec)) {
    const rels = withJson(path5.resolve(fromDir, spec)).map((abs) => contained(root, abs));
    return rels.every((r) => r === null) ? "escape" : rels.filter((r) => r !== null);
  }
  const out = [];
  const push = (abs) => {
    const rel = contained(root, abs);
    if (rel) out.push(rel);
  };
  for (let dir = fromDir; ; dir = path5.dirname(dir)) {
    const base = path5.join(dir, "node_modules", spec);
    for (const abs of withJson(base)) push(abs);
    const pkgRel = contained(root, path5.join(base, "package.json"));
    if (pkgRel) probed.add(pkgRel);
    const pkg = pkgRel ? readJson(root, pkgRel) : null;
    if (pkgRel && !pkg && entryPresent(root, pkgRel)) refuse(`${pkgRel}: not a contained, parseable regular file`);
    if (pkg && pkg.tsconfig !== void 0) {
      if (typeof pkg.tsconfig !== "string") refuse(`${pkgRel}: tsconfig field is not a string`);
      else if (contained(root, path5.join(base, pkg.tsconfig)) === null) refuse(`${pkgRel}: tsconfig ${pkg.tsconfig} outside worktree`);
      else push(path5.join(base, pkg.tsconfig));
    }
    push(path5.join(base, "tsconfig.json"));
    if (contained(root, dir) === null) break;
  }
  return out;
}
function loadTsconfigChain(root, rootConfig = "tsconfig.json") {
  const hops = [];
  const unresolved = [];
  const probedSet = /* @__PURE__ */ new Set();
  const done = () => ({ hops, unresolved, probed: [...probedSet].sort() });
  const byPath = /* @__PURE__ */ new Map();
  probedSet.add(rootConfig);
  if (!entryPresent(root, rootConfig)) return done();
  if (!readContainedFile(root, rootConfig)) {
    unresolved.push(`${rootConfig}: not a contained regular file`);
    return done();
  }
  const first = readJson(root, rootConfig);
  if (!first) {
    unresolved.push(`${rootConfig}: unparseable`);
    return done();
  }
  const top = { path: rootConfig, json: first, parents: [] };
  hops.push(top);
  byPath.set(rootConfig, top);
  const visit = (from, stack) => {
    const ext = from.json.extends;
    const specs = typeof ext === "string" ? [ext] : Array.isArray(ext) ? ext.filter((s) => typeof s === "string") : [];
    for (const spec of specs) {
      const tag = `${from.path} -> ${spec}`;
      if (stack.size > TSCONFIG_MAX_DEPTH) {
        unresolved.push(`${tag}: depth>${TSCONFIG_MAX_DEPTH}`);
        continue;
      }
      const refused = [];
      const cands = candidates(root, from.path, spec, probedSet, (why) => refused.push(why));
      if (refused.length) {
        for (const why of refused) unresolved.push(`${tag}: ${why}`);
        continue;
      }
      if (cands === "escape") {
        unresolved.push(`${tag}: outside worktree`);
        continue;
      }
      let hit;
      let refusedHit;
      for (const rel of cands) {
        probedSet.add(rel);
        if (readContainedFile(root, rel) !== null) {
          hit = rel;
          break;
        }
        if (presentNonDirectory(root, rel)) {
          refusedHit = rel;
          break;
        }
      }
      if (refusedHit) {
        unresolved.push(`${tag}: not a contained regular file`);
        continue;
      }
      if (!hit) {
        unresolved.push(`${tag}: not a contained regular file`);
        continue;
      }
      if (stack.has(hit)) {
        unresolved.push(`${tag}: cycle`);
        continue;
      }
      let hop = byPath.get(hit);
      if (!hop) {
        const json = readJson(root, hit);
        if (!json) {
          unresolved.push(`${tag}: unparseable`);
          continue;
        }
        hop = { path: hit, json, parents: [] };
        byPath.set(hit, hop);
        hops.push(hop);
        visit(hop, /* @__PURE__ */ new Set([...stack, hit]));
      }
      from.parents.push(hop);
    }
  };
  visit(top, /* @__PURE__ */ new Set([rootConfig]));
  return done();
}
function effectiveAliasOptions(chain) {
  const memo = /* @__PURE__ */ new Map();
  const eff = (hop) => {
    const hit = memo.get(hop);
    if (hit) return hit;
    const out = {};
    for (const p of hop.parents) Object.assign(out, eff(p));
    const co = hop.json.compilerOptions ?? {};
    if (typeof co.baseUrl === "string") out.baseUrl = path5.posix.normalize(path5.posix.join(path5.posix.dirname(hop.path), co.baseUrl));
    if (co.paths && typeof co.paths === "object" && !Array.isArray(co.paths)) {
      out.paths = co.paths;
      out.pathsDir = path5.posix.dirname(hop.path);
    }
    memo.set(hop, out);
    return out;
  };
  return chain.hops.length ? eff(chain.hops[0]) : {};
}

// scripts/learn/lib/paths.ts
var SCHEMA = {
  codebaseMap: "guild.codebase_map.v1",
  knowledgeGraph: "guild.knowledge_graph.v1",
  diffUnderstanding: "guild.diff_understanding.v1",
  knowledgeLinks: "guild.knowledge_links.v1"
};
function parseCwd(argv) {
  return parseFlag(argv, "cwd") ?? process.env["GUILD_CWD"] ?? process.cwd();
}
function parseFlag(argv, name) {
  const eq = `--${name}=`;
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i] === `--${name}` ? argv[i + 1] : argv[i].startsWith(eq) ? argv[i].slice(eq.length) : void 0;
    if (v === void 0 && argv[i] !== `--${name}`) continue;
    if (!v || v.startsWith("--")) throw new Error(`--${name} needs a value (--${name} <v> or --${name}=<v>)`);
    return v;
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
    const abs = path6.isAbsolute(commonDir) ? commonDir : path6.resolve(cwd, commonDir);
    const root = path6.dirname(abs);
    if (fs6.existsSync(root)) return root;
  } catch {
  }
  return path6.resolve(cwd);
}
function sameDir(a, b) {
  try {
    return fs6.realpathSync(a) === fs6.realpathSync(b);
  } catch {
    return path6.resolve(a) === path6.resolve(b);
  }
}
function guildPaths(cwd) {
  const repoRoot = resolveMainRepoRoot(cwd);
  const sourceRoot = resolveSourceWorktreeRoot(cwd);
  const guildDir = durableGuildDir(repoRoot);
  const indexesDir = path6.join(guildDir, "indexes");
  const runsDir = path6.join(guildDir, "runs");
  return {
    repoRoot,
    sourceRoot: sameDir(sourceRoot, repoRoot) ? repoRoot : sourceRoot,
    guildDir,
    indexesDir,
    runsDir,
    codebaseMap: path6.join(indexesDir, "codebase-map.json"),
    knowledgeGraph: path6.join(indexesDir, "knowledge-graph.json"),
    knowledgeLinks: path6.join(indexesDir, "knowledge-links.json"),
    knowledgeRecall: path6.join(indexesDir, "knowledge-recall.json"),
    fingerprint: path6.join(indexesDir, "understand-fingerprint.json"),
    partialGraph: path6.join(indexesDir, "understand-partial-graph.json")
  };
}
var SCAN_MAX_FILES = 2e4;
function scannedFileList(gp) {
  return walkRepo(gp.sourceRoot, SCAN_MAX_FILES).files;
}
function writeJson(filePath, data) {
  fs6.mkdirSync(path6.dirname(filePath), { recursive: true });
  fs6.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf8");
}

// scripts/learn/lib/git.ts
var import_child_process2 = require("child_process");
function git2(cwd, args) {
  return (0, import_child_process2.execFileSync)("git", args, { cwd, encoding: "utf-8" }).trim();
}
function headSha(cwd) {
  try {
    return git2(cwd, ["rev-parse", "HEAD"]);
  } catch {
    return "unknown";
  }
}

// scripts/learn/lib/languages.ts
var path7 = __toESM(require("path"));
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
  const base = path7.basename(filePath);
  if (BASENAME_LANG[base]) return BASENAME_LANG[base];
  const ext = path7.extname(filePath).toLowerCase();
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
function staticRequiresByLine(content) {
  const out = /* @__PURE__ */ new Map();
  const gap = String.raw`(?:\s|\/\*(?:[^*]|\*(?!\/))*\*\/|\/\/[^\n]*\n)*`;
  const call = new RegExp(
    String.raw`require${gap}\(${gap}(?:"((?:[^"\\\n]|\\[^\n])+)"|'((?:[^'\\\n]|\\[^\n])+)')${gap}(?:,${gap})?\)`,
    "y"
  );
  const stack = [];
  let line = 0;
  let lastSig = "";
  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    if (ch === "\n") line++;
    const top = stack[stack.length - 1];
    if (top?.tpl) {
      if (ch === "\\") {
        if (content[i + 1] === "\n") line++;
        i++;
      } else if (ch === "`") {
        stack.pop();
        lastSig = "`";
      } else if (ch === "$" && content[i + 1] === "{") {
        stack.push({ tpl: false, depth: 0 });
        i++;
        lastSig = "{";
      }
      continue;
    }
    if (ch === "/" && content[i + 1] === "/") {
      const nl = content.indexOf("\n", i);
      if (nl < 0) break;
      i = nl - 1;
      continue;
    }
    if (ch === "/" && content[i + 1] === "*") {
      const end = content.indexOf("*/", i + 2);
      const stop = end < 0 ? content.length : end + 2;
      for (let j = i; j < stop; j++) if (content[j] === "\n") line++;
      i = stop - 1;
      continue;
    }
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < content.length && content[j] !== ch && content[j] !== "\n") {
        if (content[j] === "\\") {
          if (content[j + 1] === "\r" && content[j + 2] === "\n") {
            line++;
            j += 3;
            continue;
          }
          if (content[j + 1] === "\n") line++;
          j += 2;
          continue;
        }
        j++;
      }
      i = content[j] === "\n" ? j - 1 : j;
      lastSig = ch;
      continue;
    }
    if (ch === "`") {
      stack.push({ tpl: true });
      continue;
    }
    if (top && !top.tpl) {
      if (ch === "{") top.depth++;
      else if (ch === "}") {
        if (top.depth === 0) {
          stack.pop();
          continue;
        }
        top.depth--;
      }
    }
    if (ch === "r" && !/[\w$]/.test(content[i - 1] ?? "") && lastSig !== ".") {
      call.lastIndex = i;
      const m = call.exec(content);
      if (m) {
        const list = out.get(line) ?? [];
        list.push(m[1] ?? m[2]);
        out.set(line, list);
        line += m[0].split("\n").length - 1;
        i = call.lastIndex - 1;
        lastSig = ")";
        continue;
      }
    }
    if (ch === "." && content[i - 1] === "." && content[i - 2] === ".") lastSig = "...";
    else if (!/\s/.test(ch)) lastSig = ch;
  }
  return out;
}
function analyzeJsTs(lines, lang) {
  const functions = [];
  const classes = [];
  const imports = [];
  const exports2 = [];
  const reImport = /^\s*import\s+(?:type\s+)?(?:(\*\s+as\s+\w+|\{[^}]*\}|\w+)(?:\s*,\s*(\{[^}]*\}))?\s+from\s+)?["']([^"']+)["']/;
  const reRequire = /(?:const|let|var)\s+(\{[^}]*\}|\w+)\s*=\s*require\s*\(\s*["']([^"']+)["']\s*\)/;
  const reFn = /^\s*(export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/;
  const reArrow = /^\s*(export\s+)?(?:default\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s*)?\([^)]*\)\s*(?::[^=]+)?=>/;
  const reClass = /^\s*(export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/;
  const reExport = /^\s*export\s+(?:default\s+)?(?:const|let|var|function|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/;
  const reExportList = /^\s*export\s*\{([^}]*)\}/;
  const reMethod = /^\s*(?:public|private|protected|static|async|get|set|\s)*([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{?/;
  const requiresByLine = staticRequiresByLine(lines.join("\n"));
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const mImp = line.match(reImport);
    if (mImp) {
      const specRaw = (mImp[1] ?? "") + (mImp[2] ? "," + mImp[2] : "");
      const specifiers = specRaw.replace(/[{}*]/g, "").split(",").map((s) => s.replace(/\s+as\s+\w+/, "").trim()).filter(Boolean);
      imports.push({ source: mImp[3], specifiers });
    }
    const mReq = line.match(reRequire);
    let declSource = mReq ? mReq[2] : null;
    for (const source of requiresByLine.get(i) ?? []) {
      if (source === declSource) {
        imports.push({
          source,
          specifiers: mReq[1].replace(/[{}]/g, "").split(",").map((s) => s.trim()).filter(Boolean)
        });
        declSource = null;
      } else {
        imports.push({ source, specifiers: [] });
      }
    }
    if (mImp || mReq) continue;
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
function genericExported(lang, match) {
  const name = match[1];
  if (lang === "go") return /^[A-Z]/.test(name);
  const prefix = match[0].slice(0, match[0].lastIndexOf(name));
  return /\b(?:export|public)\b/.test(prefix) || /\bpub\b(?!\s*\()/.test(prefix);
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
      classes.push({ name: mClass[1], lineRange: [i + 1, blockEnd(lines, i)], exported: genericExported(lang, mClass), methods: [] });
      continue;
    }
    const mGo = line.match(reGoFn);
    if (mGo) {
      functions.push({ name: mGo[1], lineRange: [i + 1, blockEnd(lines, i)], exported: genericExported(lang, mGo) });
      continue;
    }
    const mFn = line.match(reFn);
    if (mFn && !/\b(if|for|while|switch|return)\b/.test(mFn[1])) {
      functions.push({ name: mFn[1], lineRange: [i + 1, blockEnd(lines, i)], exported: genericExported(lang, mFn) });
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

// scripts/learn/lib/import-map.ts
var fs7 = __toESM(require("fs"));
var path8 = __toESM(require("path"));
var JS_EXTS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];
function inventoryExists(repoRoot, known) {
  return (abs) => known.has(path8.relative(repoRoot, abs).replace(/\\/g, "/"));
}
function resolveJs(importerAbs, spec, repoRoot, aliases, fileExists) {
  let baseDir = null;
  let kind = "static";
  if (spec.startsWith(".")) {
    baseDir = path8.dirname(importerAbs);
  } else {
    for (const a of aliases) {
      const star = a.prefix.endsWith("*");
      const pfx = star ? a.prefix.slice(0, -1) : a.prefix;
      if (star ? spec.startsWith(pfx) : spec === a.prefix) {
        const rest = star ? spec.slice(pfx.length) : "";
        for (const t of a.targets) {
          const tt = t.endsWith("*") ? t.slice(0, -1) : t;
          const cand = path8.resolve(repoRoot, tt + rest);
          const hit2 = resolveJsFile(cand, fileExists);
          if (hit2) return { abs: hit2, kind: "alias" };
        }
      }
    }
    return null;
  }
  const target = path8.resolve(baseDir, spec);
  const hit = resolveJsFile(target, fileExists);
  return hit ? { abs: hit, kind } : null;
}
function resolveJsFile(target, fileExists) {
  if (fileExists(target)) return target;
  for (const e of JS_EXTS) if (fileExists(target + e)) return target + e;
  for (const e of JS_EXTS) {
    const idx = path8.join(target, "index" + e);
    if (fileExists(idx)) return idx;
  }
  return null;
}
function loadTsAliases(repoRoot) {
  const eff = effectiveAliasOptions(loadTsconfigChain(repoRoot));
  if (!eff.paths) return [];
  const base = eff.baseUrl ?? eff.pathsDir ?? ".";
  return Object.entries(eff.paths).map(([k, v]) => ({
    prefix: k,
    targets: (Array.isArray(v) ? v : []).filter((t) => typeof t === "string").map((t) => path8.join(base, t))
  }));
}
function buildImportMap(repoRoot, relFiles, readFile = (a) => fs7.readFileSync(a, "utf8")) {
  const aliases = loadTsAliases(repoRoot);
  const known = new Set(relFiles.map((f) => f.replace(/\\/g, "/")));
  const edges = [];
  const seen = /* @__PURE__ */ new Set();
  for (const rel of relFiles) {
    const lang = detectLanguage(rel);
    if (lang !== "typescript" && lang !== "javascript" && lang !== "python") continue;
    const abs = path8.join(repoRoot, rel);
    let content;
    try {
      content = readFile(abs);
    } catch {
      continue;
    }
    const analysis = analyzeSource(rel, content);
    if (!analysis) continue;
    for (const imp of analysis.imports) {
      if (lang === "python") {
        const resolved = resolvePython(rel, imp.source, known);
        pushEdge(edges, seen, rel, resolved, "static");
      } else {
        const r = resolveJs(abs, imp.source, repoRoot, aliases, inventoryExists(repoRoot, known));
        if (!r) continue;
        const toRel = path8.relative(repoRoot, r.abs).replace(/\\/g, "/");
        if (known.has(toRel)) pushEdge(edges, seen, rel, toRel, r.kind);
      }
    }
  }
  return edges;
}
function resolvePython(importerRel, spec, known) {
  const bases = [];
  if (spec.startsWith(".")) {
    const up = spec.match(/^\.+/)?.[0].length ?? 1;
    let dir = path8.dirname(importerRel);
    for (let i = 1; i < up; i++) dir = path8.dirname(dir);
    bases.push(path8.join(dir, spec.replace(/^\.+/, "").replace(/\./g, "/")));
  } else {
    const sub = spec.replace(/\./g, "/");
    bases.push(path8.join(path8.dirname(importerRel), sub));
    bases.push(sub);
  }
  const cands = bases.flatMap((base) => [base + ".py", path8.join(base, "__init__.py")]).map((p) => p.replace(/\\/g, "/").replace(/^\.\//, ""));
  return cands.find((c) => known.has(c)) ?? null;
}
function pushEdge(edges, seen, from, to, kind) {
  if (!to || to === from) return;
  const key = `${from}|${to}|${kind}`;
  if (seen.has(key)) return;
  seen.add(key);
  edges.push({ from: from.replace(/\\/g, "/"), to, kind });
}

// scripts/learn/lib/graph.ts
function ref(rel, range) {
  return range ? [`${rel}#L${range[0]}-L${range[1]}`] : [`${rel}`];
}
function buildPartialGraph(repoRoot, relFiles, readFile) {
  const nodes = [];
  const edges = [];
  const nodeIds = /* @__PURE__ */ new Set();
  const edgeKeys = /* @__PURE__ */ new Set();
  const addNode = (n) => {
    if (nodeIds.has(n.id)) return;
    nodeIds.add(n.id);
    nodes.push(n);
  };
  const addEdge = (e) => {
    const k = `${e.type}|${e.source}|${e.target}`;
    if (edgeKeys.has(k)) return;
    edgeKeys.add(k);
    edges.push(e);
  };
  for (const rel of relFiles) {
    const lang = detectLanguage(rel);
    const fileId = `file:${rel}`;
    addNode({
      id: fileId,
      type: "file",
      name: rel.split("/").pop() ?? rel,
      source_refs: ref(rel),
      confidence: "high",
      language: lang
    });
    if (!isCodeLanguage(lang)) continue;
    let content;
    try {
      content = readFile(`${repoRoot}/${rel}`);
    } catch {
      continue;
    }
    const a = analyzeSource(rel, content);
    if (!a) continue;
    for (const fn of a.functions) {
      const id = `function:${rel}:${fn.name}`;
      addNode({
        id,
        type: "function",
        name: fn.name,
        source_refs: ref(rel, fn.lineRange),
        confidence: "high"
      });
      addEdge({ source: fileId, target: id, type: "contains", direction: "out", weight: 1 });
    }
    for (const cls of a.classes) {
      const id = `class:${rel}:${cls.name}`;
      addNode({
        id,
        type: "class",
        name: cls.name,
        source_refs: ref(rel, cls.lineRange),
        confidence: "high"
      });
      addEdge({ source: fileId, target: id, type: "contains", direction: "out", weight: 1 });
    }
  }
  for (const ie of buildImportMap(repoRoot, relFiles, readFile)) {
    const s = `file:${ie.from}`;
    const t = `file:${ie.to}`;
    if (nodeIds.has(s) && nodeIds.has(t)) {
      addEdge({
        source: s,
        target: t,
        type: "imports",
        direction: "out",
        weight: 0.7,
        description: ie.kind === "alias" ? "alias import" : void 0
      });
    }
  }
  return { nodes, edges };
}
function mergeReport(g) {
  const ids = new Set(g.nodes.map((n) => n.id));
  const danglingEdges = g.edges.filter((e) => !ids.has(e.source) || !ids.has(e.target));
  const referenced = /* @__PURE__ */ new Set();
  for (const e of g.edges) {
    referenced.add(e.source);
    referenced.add(e.target);
  }
  const orphanNodes = g.nodes.filter((n) => n.type !== "file" && !referenced.has(n.id)).map((n) => n.id);
  return { danglingEdges, orphanNodes };
}

// scripts/learn/analyze-structural.ts
function main() {
  const argv = process.argv.slice(2);
  const cwd = parseCwd(argv);
  ensureStorageLayout(cwd, { detectOnly: true });
  const gp = guildPaths(cwd);
  const relFiles = scannedFileList(gp);
  const partial = buildPartialGraph(
    gp.sourceRoot,
    relFiles,
    (abs) => fs8.readFileSync(abs, "utf8")
  );
  const report = mergeReport(partial);
  const out = {
    version: SCHEMA.knowledgeGraph,
    kind: "codebase",
    generated_from_commit: headSha(gp.sourceRoot),
    project: { name: path9.basename(gp.repoRoot), description: "" },
    nodes: partial.nodes,
    edges: partial.edges,
    layers: [],
    tour: [],
    _merge_report: report
    // consumed by stage-3 challenger; stripped on validate
  };
  writeJson(gp.partialGraph, out);
  process.stderr.write(
    `[analyze] ${partial.nodes.length} nodes \xB7 ${partial.edges.length} edges \xB7 ${report.danglingEdges.length} dangling \u2192 ${path9.relative(gp.repoRoot, gp.partialGraph)}
`
  );
  if (hasFlag(argv, "print")) process.stdout.write(JSON.stringify(out, null, 2) + "\n");
  else process.stdout.write(path9.relative(gp.repoRoot, gp.partialGraph) + "\n");
}
main();
