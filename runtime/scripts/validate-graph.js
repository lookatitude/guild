#!/usr/bin/env node
if (require.main === module) { const a = process.argv.slice(2), e = a.indexOf("--"); if ((e < 0 ? a : a.slice(0, e)).some((x) => x === "--help" || x === "-h")) { require("fs").writeSync(1, "usage: node runtime/scripts/validate-graph.js [--cwd <path>] [--in <path>] [--dry] [--print] [--force]\n       --cwd <path> --stdin\n"); process.exit(0); } }
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
var fs11 = __toESM(require("fs"));
var path13 = __toESM(require("path"));

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
var crypto = __toESM(require("node:crypto"));
var import_node_child_process = require("node:child_process");
var fs3 = __toESM(require("node:fs"));
var path3 = __toESM(require("node:path"));
function canonicalJson(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("canonicalJson: non-finite number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const obj = value;
    const keys = Object.keys(obj).filter((k) => obj[k] !== void 0).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
  }
  throw new Error(`canonicalJson: unsupported ${typeof value}`);
}
function basisDigest(value) {
  return `sha256:${crypto.createHash("sha256").update(canonicalJson(value), "utf8").digest("hex")}`;
}
function bytesDigest(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}
function realRoot(root) {
  try {
    return fs3.realpathSync(root);
  } catch {
    return path3.resolve(root);
  }
}
function sourceWorktreeId(root) {
  return `worktree-${crypto.createHash("sha256").update(realRoot(root), "utf8").digest("hex").slice(0, 32)}`;
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
function gitBlobOid(e, algo) {
  const body = e.kind === "file" ? e.bytes : e.kind === "symlink" ? Buffer.from(e.target, "utf8") : null;
  if (!body) return null;
  const oid = crypto.createHash(algo).update(`blob ${body.length}\0`).update(body).digest("hex");
  return { mode: e.kind === "symlink" ? "link" : "blob", oid };
}
function headEntries(root) {
  const map = /* @__PURE__ */ new Map();
  const out = git(root, ["ls-tree", "-r", "-z", "--full-tree", "HEAD"]);
  if (out === null) return map;
  for (const rec of out.split("\0")) {
    const tab = rec.indexOf("	");
    if (tab < 0) continue;
    const p = rec.slice(tab + 1);
    const [mode, , oid] = rec.slice(0, tab).split(" ");
    map.set(p, { mode: mode === "120000" ? "link" : mode.startsWith("100") ? "blob" : "other", oid });
  }
  return map;
}
function computeSourceBasis(input) {
  const root = resolveSourceWorktreeRoot(input.sourceRoot);
  const headOid = git(root, ["rev-parse", "--verify", "-q", "HEAD"])?.trim() ?? "";
  const algo = headOid.length === 64 ? "sha256" : "sha1";
  const head = headEntries(root);
  const inventory = [];
  const dirty = [];
  for (const rel of [...new Set(input.files)].sort()) {
    const e = readWorktreeEntry(root, rel);
    if (e.kind !== "file") continue;
    const sha2 = bytesDigest(e.bytes);
    inventory.push({ path: rel, sha256: sha2 });
    const h = head.get(rel);
    const w = gitBlobOid(e, algo);
    if (!h || h.mode !== w.mode || h.oid !== w.oid) dirty.push({ path: rel, sha256: sha2 });
  }
  const scanned = new Set(inventory.map((e) => e.path));
  for (const rel of head.keys()) {
    if (scanned.has(rel) || !input.inScope(rel)) continue;
    const kind = readWorktreeEntry(root, rel).kind;
    if (kind === "absent" || kind === "refused") dirty.push({ path: rel, sha256: null });
  }
  dirty.sort((x, y) => x.path < y.path ? -1 : x.path > y.path ? 1 : 0);
  const resolverUnresolved = [...new Set(input.resolverUnresolved ?? [])].sort();
  const resolverInputs = {};
  for (const rel of [...new Set(input.resolverInputs ?? [])].sort()) {
    const e = readWorktreeEntry(root, rel);
    resolverInputs[rel] = e.kind === "file" ? bytesDigest(e.bytes) : null;
  }
  const commit = git(root, ["rev-parse", "--verify", "-q", "HEAD"])?.trim() || null;
  const treeOid = commit ? git(root, ["rev-parse", "HEAD^{tree}"])?.trim() ?? null : null;
  const basis = {
    commit,
    tree: basisDigest({ git_tree: treeOid }),
    dirty_blob_manifest: basisDigest(dirty),
    file_inventory: basisDigest(inventory),
    resolver_policy: basisDigest({ policy: input.resolverPolicy, inputs: resolverInputs, unresolved: resolverUnresolved }),
    scan_policy: basisDigest(input.scanPolicy),
    source_worktree_id: sourceWorktreeId(root)
  };
  return { source_root: root, basis, source_basis_hash: basisDigest(basis), inventory, dirty, resolver_unresolved: resolverUnresolved };
}
function freshnessFor(published, observed) {
  if (!observed) return "unknown";
  if (basisDigest(published.basis) !== published.source_basis_hash) return "unknown";
  if (basisDigest(observed.basis) !== observed.source_basis_hash) return "unknown";
  if (published.basis.source_worktree_id !== observed.basis.source_worktree_id) return "unknown";
  if (published.resolver_unresolved?.length || observed.resolver_unresolved?.length) return "unknown";
  return published.source_basis_hash === observed.source_basis_hash ? "current_for_basis" : "stale";
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
function candidates(root, fromRel, spec, probed, refuse2) {
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
    if (pkgRel && !pkg && entryPresent(root, pkgRel)) refuse2(`${pkgRel}: not a contained, parseable regular file`);
    if (pkg && pkg.tsconfig !== void 0) {
      if (typeof pkg.tsconfig !== "string") refuse2(`${pkgRel}: tsconfig field is not a string`);
      else if (contained(root, path5.join(base, pkg.tsconfig)) === null) refuse2(`${pkgRel}: tsconfig ${pkg.tsconfig} outside worktree`);
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

// scripts/learn/lib/paths.ts
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
function isLink(p) {
  try {
    return fs6.lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
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
function computeLearnSourceBasis(cwd, opts = {}) {
  const sourceRoot = resolveSourceWorktreeRoot(cwd);
  const maxFiles = opts.maxFiles ?? SCAN_MAX_FILES;
  const { files, filter, truncated, unreadable, unsupported } = walkRepo(sourceRoot, maxFiles);
  const subGuilds = [...registeredSubGuildPaths(sourceRoot)].sort();
  const guildignore = readContainedFile(sourceRoot, ".guildignore");
  const ignorePath = path6.join(sourceRoot, ".guildignore");
  const guildignoreRefused = !guildignore && (isLink(ignorePath) || fs6.existsSync(ignorePath));
  const scanPolicy = {
    policy: "guild.learn.scan_policy.v1",
    walker: "walkRepo",
    default_ignore: [...DEFAULT_IGNORE_PATTERNS],
    guildignore: guildignore ? guildignore.toString("utf8") : null,
    sub_guilds_skipped: subGuilds,
    symlinks: "not_followed",
    max_files: maxFiles,
    bytes: "raw"
  };
  const tsconfig = loadTsconfigChain(sourceRoot);
  return computeSourceBasis({
    sourceRoot,
    files,
    inScope: (rel) => !filter.isIgnored(rel) && !subGuilds.some((g) => rel === g || rel.startsWith(`${g}/`)),
    scanPolicy,
    resolverPolicy: {
      policy: "guild.learn.resolver_policy.v1",
      resolver: "structural",
      version: 1,
      tsconfig: `extends chain; contained regular files only; depth<=${TSCONFIG_MAX_DEPTH}`
    },
    resolverInputs: ["package.json", ...tsconfig.hops.map((h) => h.path), ...tsconfig.probed],
    resolverUnresolved: [
      ...tsconfig.unresolved,
      ...guildignoreRefused ? [".guildignore: not a contained regular file"] : [],
      // K02: files past the cap are neither inventoried nor compared.
      ...truncated ? [`scan: max_files (${maxFiles}) exceeded; inventory incomplete`] : [],
      ...unreadable.map((d) => `scan: directory ${d || "."} unreadable; inventory incomplete`),
      ...unsupported.map((p) => `scan: ${JSON.stringify(p)} has a backslash or non-UTF-8 bytes in its name; inventory incomplete`)
    ]
  });
}
function readJson2(filePath) {
  try {
    return JSON.parse(fs6.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

// scripts/learn/lib/publish.ts
var fs10 = __toESM(require("fs"));
var path12 = __toESM(require("path"));

// src/domains/knowledge/publication.ts
var crypto2 = __toESM(require("node:crypto"));
var fs8 = __toESM(require("node:fs"));
var os = __toESM(require("node:os"));
var path10 = __toESM(require("node:path"));

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
var path7 = __toESM(require("node:path"));
var PLUGIN_ROOT_MARKER = path7.join("runtime", "guild-mcp.js");

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
var fs7 = __toESM(require("node:fs"));
var path8 = __toESM(require("node:path"));
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
function isRefused(r) {
  return "code" in r;
}
function escapes(rel) {
  return rel === ".." || rel.startsWith(`..${path8.sep}`) || path8.isAbsolute(rel);
}
function refuse(code, detail) {
  return Object.freeze({ contained: false, code, detail });
}
function hasParentSegment(p) {
  return p.split(/[\\/]/).includes("..");
}
function lstatOrNull(p) {
  try {
    return fs7.lstatSync(p);
  } catch {
    return null;
  }
}
function checkContained(root, target, options = {}) {
  const policy = options.policy ?? "resolve";
  let realRoot2;
  try {
    realRoot2 = fs7.realpathSync(path8.resolve(root));
  } catch {
    return refuse("root-unresolvable", `project root ${root} does not resolve`);
  }
  if (hasParentSegment(target)) {
    return refuse(
      "parent-traversal",
      `refusing a path spelled with a ".." segment (${target}) \u2014 parent traversal cannot be resolved before symlinks`
    );
  }
  const abs = path8.isAbsolute(target) ? path8.resolve(target) : path8.resolve(realRoot2, target);
  let probe = abs;
  let probeStat = null;
  for (; ; ) {
    probeStat = lstatOrNull(probe);
    if (probeStat !== null) break;
    const parent = path8.dirname(probe);
    if (parent === probe) {
      return refuse("no-existing-ancestor", `no existing ancestor of ${abs}`);
    }
    probe = parent;
  }
  if (options.requireRegularFileLeaf && probe === abs && !probeStat.isFile()) {
    const what = probeStat.isSymbolicLink() ? "symlink" : probeStat.isDirectory() ? "directory" : "special file";
    return refuse(
      "leaf-not-regular-file",
      `${abs} exists and is not a regular file (${what}); refusing to write through it`
    );
  }
  let realProbe;
  try {
    realProbe = fs7.realpathSync(probe);
  } catch {
    return refuse(
      "dangling-symlink",
      `${probe} is a symlink that does not resolve; refusing to write through it`
    );
  }
  const rel = path8.relative(realRoot2, realProbe);
  if (rel !== "" && escapes(rel)) {
    return refuse("outside-root", `${abs} resolves outside the project root (${realProbe})`);
  }
  if (policy === "physical") {
    const parsed = path8.parse(abs);
    let walk = parsed.root;
    for (const seg of abs.slice(parsed.root.length).split(path8.sep)) {
      if (seg === "" || seg === ".") continue;
      walk = path8.join(walk, seg);
      const st = lstatOrNull(walk);
      if (st === null || !st.isSymbolicLink()) continue;
      let segReal;
      try {
        segReal = fs7.realpathSync(walk);
      } catch {
        return refuse("dangling-symlink", `${walk} is a symlink that does not resolve`);
      }
      const segRel = path8.relative(realRoot2, segReal);
      const strictlyInside = segRel !== "" && !escapes(segRel);
      if (strictlyInside) {
        return refuse("physical-symlink", `refusing \u2014 symlinked path segment: ${walk}`);
      }
    }
  }
  const tail = path8.relative(probe, abs);
  const realPath = tail === "" ? realProbe : path8.join(realProbe, tail);
  return Object.freeze({ contained: true, realRoot: realRoot2, realPath });
}
function prepareContainedWrite(root, target, options = {}) {
  if (hasParentSegment(target)) {
    return refuse(
      "parent-traversal",
      `refusing a path spelled with a ".." segment (${target}) \u2014 parent traversal cannot be resolved before symlinks`
    );
  }
  let canonRoot;
  try {
    canonRoot = fs7.realpathSync(path8.resolve(root));
  } catch {
    return refuse("root-unresolvable", `project root ${root} does not resolve`);
  }
  const abs = path8.isAbsolute(target) ? path8.resolve(target) : path8.resolve(canonRoot, target);
  const dir = path8.dirname(abs);
  const pre = checkContained(root, dir, { policy: options.policy });
  if (isRefused(pre)) return pre;
  try {
    fs7.mkdirSync(dir, { recursive: true });
  } catch (err) {
    return refuse("mkdir-failed", `could not create ${dir}: ${err?.message ?? "unknown"}`);
  }
  const post = checkContained(root, abs, options);
  if (isRefused(post)) return post;
  let realDir;
  try {
    realDir = fs7.realpathSync(dir);
  } catch {
    return refuse("dangling-symlink", `${dir} stopped resolving between the check and the write`);
  }
  return Object.freeze({
    contained: true,
    realRoot: post.realRoot,
    realPath: post.realPath,
    realDir
  });
}

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

// src/domains/kernel/reserved-identity-fields.ts
var path9 = __toESM(require("node:path"));
var RESERVED_IDENTITY_FIELDS = Object.freeze([
  // logical-run
  "source_id",
  "run_id",
  "initiative_id",
  "parent_run",
  "created_at",
  "phase",
  "initial_command",
  "initial_prompt_ref",
  "controller",
  "workflow_hash",
  "settings_hash",
  "execution_refs",
  "goal_refs",
  "state",
  // execution-segment
  "lineage",
  "original_host_id",
  "host_session_id",
  "issued_controller_epoch",
  "adapter_capability_hash",
  "pins",
  "admission",
  "interval",
  "observation_manifest",
  "seal_evidence",
  // task-assignment v3
  "assignment_hash",
  "result_scope_hash",
  "grant_id",
  "goal_contributions",
  "input_refs",
  // stack task-attempt
  "assignment_ref",
  "ordinal",
  "result_refs",
  "acceptance_subject_hash",
  "accepted_by_controller_epoch",
  "receipt_loss_reconciled",
  "uncertain_effects",
  // run-binding v2
  "controller_source_id",
  "controller_host_id",
  "controller_epoch",
  "writer_grant_id",
  "writer_scope_hash",
  "logical_run_manifest_hash",
  // execution-lineage receipt
  "run_schema",
  "requested_host",
  "observed_host",
  "requested_model",
  "observed_identity",
  "authority",
  "attempt_grant_ref",
  "handoffs",
  "evidence",
  // lineage keys
  "execution_id",
  "goal_id",
  "logical_task_id",
  "attempt_id",
  "agent_instance_id",
  "request_id"
]);
var RUN_KIND_V2_MANIFEST_RELPATH = path9.join("lineage", "logical-run.json");

// src/domains/knowledge/publication.ts
var PUBLICATION_FAULT_STEPS = Object.freeze([
  "lock_acquired",
  "artifact:knowledge-graph.json",
  "artifact:knowledge-recall.json",
  "layers_written",
  "manifest_written",
  "record_written",
  "generation_renamed",
  "successor_claimed",
  "pointer_tmp_written",
  "pointer_renamed",
  "export:knowledge-graph.json",
  "export:knowledge-recall.json",
  "reclaimed"
]);
var ARTIFACT_NAME = /^[a-z0-9][a-z0-9._-]{0,127}\.json$/;
var GEN_DIR = /^[a-f0-9]{64}$/;
var HOST = crypto2.createHash("sha256").update(os.hostname()).digest("hex").slice(0, 12);
function publicationDir(indexesDir) {
  return path10.join(indexesDir, "publication");
}
function generationsDir(indexesDir) {
  return path10.join(publicationDir(indexesDir), "generations");
}
function sha(bytes) {
  return `sha256:${crypto2.createHash("sha256").update(bytes).digest("hex")}`;
}
function hex(g) {
  return g.slice("sha256:".length);
}
function isGenerationHash(v) {
  return typeof v === "string" && v.startsWith("sha256:") && GEN_DIR.test(v.slice(7));
}
function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === "EPERM";
  }
}
function fsyncPath(p) {
  let fd;
  try {
    fd = fs8.openSync(p, "r");
    fs8.fsyncSync(fd);
  } catch {
  } finally {
    if (fd !== void 0) fs8.closeSync(fd);
  }
}
function writeDurable(p, bytes, mode = 420) {
  const fd = fs8.openSync(p, "wx", mode);
  try {
    fs8.writeSync(fd, typeof bytes === "string" ? Buffer.from(bytes, "utf8") : bytes);
    fs8.fsyncSync(fd);
  } finally {
    fs8.closeSync(fd);
  }
}
function contained2(indexesDir, target, leafFile = false) {
  const r = checkContained(indexesDir, target, { policy: "physical", requireRegularFileLeaf: leafFile });
  return isRefused(r) ? `${r.code}: ${r.detail}` : null;
}
function ensureDir(indexesDir, dir) {
  const r = prepareContainedWrite(indexesDir, path10.join(dir, ".probe"), { policy: "physical" });
  if (isRefused(r)) throw new PublicationError("containment", `${r.code}: ${r.detail}`);
}
function removeContained(indexesDir, target) {
  if (contained2(indexesDir, path10.dirname(target))) return;
  let st;
  try {
    st = fs8.lstatSync(target);
  } catch {
    return;
  }
  if (st.isSymbolicLink()) fs8.unlinkSync(target);
  else fs8.rmSync(target, { recursive: true, force: true });
}
var PublicationError = class extends Error {
  constructor(code, detail) {
    super(`publication ${code}: ${detail}`);
    this.code = code;
  }
  code;
};
function readOwner(lockDir) {
  try {
    const o = JSON.parse(fs8.readFileSync(path10.join(lockDir, "owner.json"), "utf8"));
    return o && typeof o.pid === "number" && typeof o.token === "string" ? o : null;
  } catch {
    return null;
  }
}
function createOwned(parent, name) {
  const owner = { pid: process.pid, host: HOST, token: crypto2.randomUUID(), acquired_at: (/* @__PURE__ */ new Date()).toISOString() };
  const tmp = path10.join(parent, `.${name}.${owner.token}`);
  fs8.mkdirSync(tmp);
  try {
    writeDurable(path10.join(tmp, "owner.json"), JSON.stringify(owner));
    fs8.renameSync(tmp, path10.join(parent, name));
    return owner;
  } catch (err) {
    const code = err.code;
    if (code === "ENOTEMPTY" || code === "EEXIST" || code === "EPERM" || code === "EISDIR") return null;
    throw err;
  } finally {
    fs8.rmSync(tmp, { recursive: true, force: true });
  }
}
function staleToken(dir) {
  const owner = readOwner(dir);
  return owner && owner.host === HOST && !pidAlive(owner.pid) ? owner.token : null;
}
function removeIfToken(parent, name, token) {
  const dir = path10.join(parent, name);
  const grave = path10.join(parent, `.${name}.dead.${crypto2.randomUUID()}`);
  try {
    fs8.renameSync(dir, grave);
  } catch {
    return false;
  }
  if (readOwner(grave)?.token !== token) {
    try {
      fs8.renameSync(grave, dir);
    } catch {
    }
    return false;
  }
  fs8.rmSync(grave, { recursive: true, force: true });
  return true;
}
function reclaimStaleLock(pubDir) {
  const mutexOwner = createOwned(pubDir, "lock.reclaim");
  if (!mutexOwner) {
    const t = staleToken(path10.join(pubDir, "lock.reclaim"));
    if (t) removeIfToken(pubDir, "lock.reclaim", t);
    return;
  }
  try {
    const t = staleToken(path10.join(pubDir, "lock"));
    if (t) removeIfToken(pubDir, "lock", t);
  } finally {
    removeIfToken(pubDir, "lock.reclaim", mutexOwner.token);
  }
}
function acquirePublisherLock(pubDir, opts = {}) {
  const lockDir = path10.join(pubDir, "lock");
  const deadline = Date.now() + (opts.timeoutMs ?? 3e4);
  fs8.mkdirSync(pubDir, { recursive: true });
  for (let wait = 5; ; wait = Math.min(wait * 2, 100)) {
    let owner;
    try {
      owner = createOwned(pubDir, "lock");
    } catch (err) {
      return { ok: false, detail: String(err) };
    }
    if (owner) {
      const token = owner.token;
      let released = false;
      return {
        ok: true,
        token,
        holds: () => readOwner(lockDir)?.token === token,
        release: () => {
          if (released) return;
          released = true;
          removeIfToken(pubDir, "lock", token);
        }
      };
    }
    if (staleToken(lockDir)) reclaimStaleLock(pubDir);
    if (Date.now() >= deadline) return { ok: false, detail: `publisher lock held: ${JSON.stringify(readOwner(lockDir))}` };
    sleep(wait);
  }
}
function parsePointer(file, indexesDir) {
  const bad = contained2(indexesDir, file, true);
  if (bad) throw new PublicationError("containment", bad);
  const ptr = JSON.parse(fs8.readFileSync(file, "utf8"));
  if (!isGenerationHash(ptr?.generation) || !isGenerationHash(ptr.publication_sha256)) throw new PublicationError("corrupt", "pointer malformed");
  return ptr;
}
function successorFile(indexesDir, parent) {
  return path10.join(publicationDir(indexesDir), "successors", parent ? hex(parent) : "root");
}
function readPointer(indexesDir) {
  const cur = path10.join(publicationDir(indexesDir), "CURRENT");
  let ptr = fs8.existsSync(cur) ? parsePointer(cur, indexesDir) : null;
  if (!ptr) {
    const root = successorFile(indexesDir, null);
    if (!fs8.existsSync(root)) return null;
    ptr = parsePointer(root, indexesDir);
  }
  for (let i = 0; i < 1e5; i++) {
    const next = successorFile(indexesDir, ptr.generation);
    if (!fs8.existsSync(next)) return ptr;
    ptr = parsePointer(next, indexesDir);
  }
  throw new PublicationError("corrupt", "successor chain does not terminate");
}
function readVerified(indexesDir, file, expected) {
  const bad = contained2(indexesDir, file, true);
  if (bad) throw new PublicationError("containment", bad);
  const bytes = fs8.readFileSync(file);
  if (sha(bytes) !== expected) throw new PublicationError("corrupt", `hash mismatch for ${path10.basename(file)}`);
  return bytes;
}
function loadGeneration(indexesDir, generation, publicationSha) {
  const dir = path10.join(generationsDir(indexesDir), hex(generation));
  const recBytes = publicationSha ? readVerified(indexesDir, path10.join(dir, "publication.json"), publicationSha) : fs8.readFileSync(path10.join(dir, "publication.json"));
  const record = JSON.parse(recBytes.toString("utf8"));
  if (record.generation !== generation) throw new PublicationError("corrupt", "record names another generation");
  const manBytes = readVerified(indexesDir, path10.join(dir, "manifest.json"), record.manifest.sha256);
  const manifest = JSON.parse(manBytes.toString("utf8"));
  if (manifest.generation !== generation) throw new PublicationError("corrupt", "manifest names another generation");
  const artifacts = {};
  for (const [name, a] of Object.entries(manifest.artifacts)) {
    if (!ARTIFACT_NAME.test(name)) throw new PublicationError("corrupt", `artifact name ${JSON.stringify(name)}`);
    artifacts[name] = readVerified(indexesDir, path10.join(dir, name), a.sha256);
  }
  if (generationId(manifest) !== generation) throw new PublicationError("corrupt", "generation id does not match its manifest");
  const pointer = {
    schema_version: "guild.knowledge_publication_pointer.v1",
    generation,
    destination_layer_digest: record.destination_layer_digest,
    publication_sha256: sha(recBytes)
  };
  return { pointer, record, manifest, artifacts };
}
function pinFile(indexesDir, generation) {
  try {
    const dir = path10.join(publicationDir(indexesDir), "pins");
    if (contained2(indexesDir, dir)) return null;
    fs8.mkdirSync(dir, { recursive: true });
    const id = `${process.pid}-${crypto2.randomUUID()}`;
    const tmp = path10.join(dir, `.tmp-${id}`);
    writeDurable(tmp, JSON.stringify({ pid: process.pid, host: HOST, generation }));
    const f = path10.join(dir, `${id}.json`);
    fs8.renameSync(tmp, f);
    return f;
  } catch {
    return null;
  }
}
function readPublication(indexesDir, opts = {}) {
  for (let attempt = 0; ; attempt++) {
    const ptr = opts.generation ? null : readPointer(indexesDir);
    const gen = opts.generation ?? ptr?.generation;
    if (!gen) return null;
    const pin = pinFile(indexesDir, gen);
    try {
      const pg = loadGeneration(indexesDir, gen, ptr?.publication_sha256 ?? null);
      if (ptr && pg.pointer.destination_layer_digest !== ptr.destination_layer_digest) {
        throw new PublicationError("corrupt", "pointer layer digest differs from its record");
      }
      return pg;
    } catch (err) {
      if (err.code === "ENOENT" && !opts.generation && attempt < 3) continue;
      if (err.code === "ENOENT" && opts.generation) return null;
      throw err;
    } finally {
      if (pin) fs8.rmSync(pin, { force: true });
    }
  }
}
function exportProvenance(indexesDir, name) {
  const file = path10.join(indexesDir, name);
  let bytes;
  try {
    if (contained2(indexesDir, file, true)) return { provenance: "bypassed", sha256: null };
    bytes = fs8.readFileSync(file);
  } catch {
    return { provenance: "absent", sha256: null };
  }
  const h = sha(bytes);
  const pub = readPublication(indexesDir);
  if (!pub) return { provenance: "unpublished", sha256: h };
  if (pub.manifest.artifacts[name]?.sha256 === h) return { provenance: "current", sha256: h };
  for (const g of safeReaddir(generationsDir(indexesDir))) {
    if (!GEN_DIR.test(g)) continue;
    try {
      const m = JSON.parse(fs8.readFileSync(path10.join(generationsDir(indexesDir), g, "manifest.json"), "utf8"));
      if (m.artifacts?.[name]?.sha256 === h) return { provenance: "lagging", sha256: h };
    } catch {
    }
  }
  return { provenance: "bypassed", sha256: h };
}
function generationId(m) {
  return basisDigest({
    previous_generation: m.previous_generation,
    artifacts: Object.fromEntries(Object.entries(m.artifacts).map(([k, v]) => [k, v.sha256])),
    layers: m.layers,
    source_basis_hash: m.source_basis.source_basis_hash,
    exports: m.exports
  });
}
function layerDigest(layers) {
  return basisDigest(
    Object.entries(layers).map(([c, l]) => [c, l.layer_hash]).sort((a, b) => a[0].localeCompare(b[0]))
  );
}
function toBuffers(a) {
  const out = {};
  for (const [k, v] of Object.entries(a)) out[k] = typeof v === "string" ? Buffer.from(v, "utf8") : v;
  return out;
}
function sameBase(base, cur) {
  if (!base || !cur) return !base && !cur;
  return base.generation === cur.generation && base.destination_layer_digest === cur.destination_layer_digest;
}
function validateJob(job) {
  if (!job.channels.length) return "a job declares at least one channel";
  for (const c of job.channels) if (!job.layers[c]) return `channel ${c} has no layer spec`;
  for (const n of [...Object.keys(job.artifacts), ...job.exports ?? []]) if (!ARTIFACT_NAME.test(n)) return `artifact name ${JSON.stringify(n)}`;
  for (const c of job.channels) if (!(job.layers[c].artifact in job.artifacts)) return `channel ${c} artifact ${job.layers[c].artifact} not written`;
  if (basisDigest(job.basis.basis) !== job.basis.source_basis_hash) return "job basis hash is not the digest of its basis";
  return null;
}
function relFromOwner(indexesDir, abs) {
  return path10.join(".guild", "indexes", path10.relative(indexesDir, abs)).split(path10.sep).join("/");
}
function reclaimStaging(indexesDir) {
  const sdir = path10.join(publicationDir(indexesDir), "successors");
  if (!contained2(indexesDir, sdir)) {
    for (const n of safeReaddir(sdir)) {
      const m = /^\.claim-([a-f0-9]{12})-(\d+)-/.exec(n);
      if (m && m[1] === HOST && !pidAlive(Number(m[2]))) removeContained(indexesDir, path10.join(sdir, n));
    }
  }
  const gdir = generationsDir(indexesDir);
  let names = [];
  try {
    names = fs8.readdirSync(gdir);
  } catch {
    return;
  }
  for (const n of names) {
    const m = /^\.(?:stage|reclaim)-([a-f0-9]{12})-(\d+)-/.exec(n);
    if (!m) continue;
    if (m[1] === HOST && !pidAlive(Number(m[2]))) removeContained(indexesDir, path10.join(gdir, n));
  }
}
function livePins(indexesDir) {
  const out = /* @__PURE__ */ new Set();
  const dir = path10.join(publicationDir(indexesDir), "pins");
  if (fs8.existsSync(dir) && contained2(indexesDir, dir)) return null;
  let names = [];
  try {
    names = fs8.readdirSync(dir);
  } catch {
    return out;
  }
  for (const n of names) {
    const f = path10.join(dir, n);
    const tmp = /^\.tmp-(\d+)-/.exec(n);
    if (tmp) {
      if (!pidAlive(Number(tmp[1]))) removeContained(indexesDir, f);
      continue;
    }
    let pin;
    try {
      pin = JSON.parse(fs8.readFileSync(f, "utf8"));
    } catch {
      return null;
    }
    if (pin.host === HOST && !pidAlive(pin.pid)) {
      removeContained(indexesDir, f);
      continue;
    }
    if (!isGenerationHash(pin.generation)) return null;
    out.add(hex(pin.generation));
  }
  return out;
}
var ORPHAN_GRACE_MS = 10 * 6e4;
function reclaimGenerations(indexesDir, opts = {}) {
  const keep = opts.keep ?? 3;
  const now = opts.now ?? Date.now();
  const removed = [];
  const gdir = generationsDir(indexesDir);
  if (contained2(indexesDir, gdir) || contained2(indexesDir, path10.join(publicationDir(indexesDir), "successors"))) return removed;
  const tip = readPointer(indexesDir);
  if (!tip) return removed;
  advanceCurrent(indexesDir, tip);
  const pins = livePins(indexesDir);
  if (!pins) return removed;
  const chain = [];
  for (let g = tip.generation; g && chain.length < 1e5; ) {
    chain.push(hex(g));
    try {
      g = JSON.parse(fs8.readFileSync(path10.join(gdir, hex(g), "publication.json"), "utf8")).previous_generation;
    } catch {
      g = null;
    }
  }
  const depth = new Map(chain.map((g, i) => [g, i]));
  for (const n of safeReaddir(gdir)) {
    if (!GEN_DIR.test(n) || pins.has(n)) continue;
    const d = depth.get(n);
    if (d !== void 0 && d <= keep) continue;
    if (d === void 0) {
      let age = 0;
      try {
        age = now - fs8.statSync(path10.join(gdir, n)).mtimeMs;
      } catch {
        continue;
      }
      if (age < ORPHAN_GRACE_MS) continue;
    }
    const aside = path10.join(gdir, `.reclaim-${HOST}-${process.pid}-${n}`);
    try {
      fs8.renameSync(path10.join(gdir, n), aside);
    } catch {
      continue;
    }
    const again = livePins(indexesDir);
    if (!again || again.has(n)) {
      try {
        fs8.renameSync(aside, path10.join(gdir, n));
      } catch {
      }
      continue;
    }
    removeContained(indexesDir, aside);
    for (const side of ["hints", "verifications"]) {
      removeContained(indexesDir, path10.join(publicationDir(indexesDir), side, `${n}.jsonl`));
      removeContained(indexesDir, path10.join(publicationDir(indexesDir), side, `${n}.json`));
    }
    removed.push(n);
  }
  reclaimStaging(indexesDir);
  return removed;
}
function advanceCurrent(indexesDir, tip) {
  const pubDir = publicationDir(indexesDir);
  const cur = path10.join(pubDir, "CURRENT");
  if (contained2(indexesDir, cur, true)) return;
  try {
    if (JSON.parse(fs8.readFileSync(cur, "utf8")).generation === tip.generation) return;
  } catch {
  }
  const tmp = path10.join(pubDir, `.CURRENT.${process.pid}.${crypto2.randomUUID()}`);
  writeDurable(tmp, JSON.stringify(tip, null, 2) + "\n");
  fs8.renameSync(tmp, cur);
  fsyncPath(pubDir);
}
function channelOrder(c) {
  return ["structural_graph", "semantic_graph", "recall"].indexOf(c);
}
function publishGeneration(job) {
  const invalid = validateJob(job);
  if (invalid) return { status: "refused", reason: "invalid", detail: invalid };
  const pubDir = publicationDir(job.indexesDir);
  const gdir = generationsDir(job.indexesDir);
  try {
    fs8.mkdirSync(job.indexesDir, { recursive: true });
    ensureDir(job.indexesDir, gdir);
  } catch (err) {
    return { status: "refused", reason: "containment", detail: String(err.message) };
  }
  const fault = job.fault ?? (() => {
  });
  const now = job.now ?? (() => (/* @__PURE__ */ new Date()).toISOString());
  const lock = acquirePublisherLock(pubDir, { timeoutMs: job.lockTimeoutMs });
  if (!lock.ok) return { status: "refused", reason: "lock_timeout", detail: lock.detail };
  let staging = null;
  let inflightPin = null;
  try {
    fault("lock_acquired");
    reclaimStaging(job.indexesDir);
    let base = job.base;
    let rebases = 0;
    for (let round = 0; ; round++) {
      const current = readPublication(job.indexesDir);
      let artifacts = toBuffers(job.artifacts);
      if (!sameBase(base, current?.pointer ?? null)) {
        if (!job.rebase || !current) {
          return {
            status: "refused",
            reason: "destination_moved",
            detail: `built from ${base?.generation ?? "nothing"}, destination is ${current?.pointer.generation ?? "nothing"}`
          };
        }
        artifacts = toBuffers(job.rebase(current));
        rebases++;
      }
      if (job.preserve) {
        const lost = job.preserve(current?.artifacts ?? null, { ...current?.artifacts ?? {}, ...artifacts });
        if (lost) return { status: "refused", reason: "undeclared_layer_change", detail: lost };
      }
      const observed = job.observe();
      const sameShape = (r) => !!r && basisDigest(r.basis) === r.source_basis_hash;
      if (!sameShape(observed) || observed.basis.source_worktree_id !== job.basis.basis.source_worktree_id) {
        return { status: "refused", reason: "source_unknown", detail: "observed basis is missing, malformed or from another worktree" };
      }
      if (observed.source_basis_hash !== job.basis.source_basis_hash) {
        return { status: "refused", reason: "source_drift", detail: `source moved from ${job.basis.source_basis_hash} to ${observed.source_basis_hash}` };
      }
      const unresolved = freshnessFor(job.basis, observed) === "unknown";
      const verifiedAt = now();
      const all = { ...current?.artifacts ?? {}, ...artifacts };
      const declared = new Set(job.channels);
      const layers = {};
      const carriedReason = {};
      const channelSet = /* @__PURE__ */ new Set([
        ...job.channels,
        ...Object.keys(current?.manifest.layers ?? {}),
        ...Object.keys(job.layers)
      ]);
      for (const c of [...channelSet].sort((a, b) => channelOrder(a) - channelOrder(b))) {
        const spec = job.layers[c];
        const prev = current?.manifest.layers[c];
        if (!spec) {
          if (prev) {
            layers[c] = prev;
            if (prev.unknown_reason) carriedReason[c] = prev.unknown_reason;
          }
          continue;
        }
        if (!(spec.artifact in all)) continue;
        const layer_hash = spec.digest(all);
        if (declared.has(c)) {
          const how = job.provenance?.[c] ?? "rebuilt";
          if (how === "rebuilt") {
            layers[c] = { artifact: spec.artifact, layer_hash, basis_hash: job.basis.source_basis_hash };
          } else if (how === "derived" && prev) {
            layers[c] = { artifact: spec.artifact, layer_hash, basis_hash: prev.basis_hash, ...prev.unknown_reason ? { unknown_reason: prev.unknown_reason } : {} };
            if (prev.unknown_reason) carriedReason[c] = prev.unknown_reason;
          } else {
            const why = how === "derived" ? "derived from a layer that was never built from source" : job.provenanceReason?.[c] ?? "ingested layer; the basis it was built for is not recorded";
            layers[c] = { artifact: spec.artifact, layer_hash, basis_hash: job.basis.source_basis_hash, unknown_reason: why };
            carriedReason[c] = why;
          }
        } else if (prev) {
          const why = prev.layer_hash !== layer_hash ? "layer changed by a writer that did not rebuild it from source" : prev.unknown_reason;
          layers[c] = { artifact: spec.artifact, layer_hash, basis_hash: prev.basis_hash, ...why ? { unknown_reason: why } : {} };
          if (why) carriedReason[c] = why;
        } else {
          const why = "layer was never published by a writer that builds it";
          layers[c] = { artifact: spec.artifact, layer_hash, basis_hash: job.basis.source_basis_hash, unknown_reason: why };
          carriedReason[c] = why;
        }
      }
      const exportsList = [...new Set(job.exports ?? [])].filter((n) => n in all).sort();
      const manifestBase = {
        previous_generation: current?.pointer.generation ?? null,
        artifacts: Object.fromEntries(
          Object.entries(all).filter((e) => e[1] !== void 0).sort((a, b) => a[0].localeCompare(b[0])).map(([k, v]) => [k, { sha256: sha(v), bytes: v.length }])
        ),
        layers,
        source_basis: { basis: job.basis.basis, source_basis_hash: job.basis.source_basis_hash, inventory: [...job.basis.inventory ?? []] },
        exports: exportsList
      };
      const generation = generationId(manifestBase);
      const finalDir = path10.join(gdir, hex(generation));
      const reused = fs8.existsSync(finalDir);
      inflightPin = pinFile(job.indexesDir, generation);
      if (!inflightPin) return { status: "refused", reason: "containment", detail: "cannot pin the in-flight generation" };
      if (!reused) {
        staging = path10.join(gdir, `.stage-${HOST}-${process.pid}-${crypto2.randomUUID()}`);
        fs8.mkdirSync(staging);
        for (const [name, bytes] of Object.entries(all)) {
          if (!bytes) continue;
          writeDurable(path10.join(staging, name), bytes, 292);
          fault(`artifact:${name}`);
        }
        fault("layers_written");
        const manifest = { schema_version: "guild.knowledge_publication_manifest.v1", generation, ...manifestBase };
        const manBytes = JSON.stringify(manifest, null, 2) + "\n";
        writeDurable(path10.join(staging, "manifest.json"), manBytes, 292);
        fault("manifest_written");
        const evidence = (p, s, schema) => ({
          source_id: job.identity.source_id,
          path: relFromOwner(job.indexesDir, p),
          sha256: s,
          schema_version: schema,
          observed_at: verifiedAt,
          availability: "available",
          reason: null
        });
        const channels = Object.entries(layers).map(([c, l]) => {
          const current4basis = l.basis_hash === job.basis.source_basis_hash;
          const state = carriedReason[c] || unresolved ? "unknown" : current4basis ? "current_for_basis" : "stale";
          return {
            channel: c,
            state,
            basis_hash: l.basis_hash,
            layer_hash: l.layer_hash,
            output: evidence(path10.join(finalDir, l.artifact), manifestBase.artifacts[l.artifact].sha256, "guild.knowledge_layer_artifact.v1"),
            reason: carriedReason[c] ?? (unresolved ? "resolver inputs outside the basis are unresolved" : current4basis ? null : "layer was built for an older source basis")
          };
        });
        const record = {
          schema_version: "guild.stack.knowledge-publication.v1",
          source_id: job.identity.source_id,
          source_worktree_id: job.basis.basis.source_worktree_id,
          durable_owner_source_id: job.identity.durable_owner_source_id,
          publication_scope_source_id: job.identity.publication_scope_source_id,
          basis: job.basis.basis,
          source_basis_hash: job.basis.source_basis_hash,
          basis_verified_at: unresolved ? null : verifiedAt,
          generation,
          previous_generation: manifestBase.previous_generation,
          destination_layer_digest: layerDigest(layers),
          manifest: evidence(path10.join(finalDir, "manifest.json"), sha(manBytes), manifest.schema_version),
          channels,
          decision_refs: [],
          replan_required: []
        };
        writeDurable(path10.join(staging, "publication.json"), JSON.stringify(record, null, 2) + "\n", 292);
        fault("record_written");
        fsyncPath(staging);
        fs8.renameSync(staging, finalDir);
        staging = null;
        fsyncPath(gdir);
        fault("generation_renamed");
      }
      const loaded = loadGeneration(job.indexesDir, generation, null);
      const pointer = loaded.pointer;
      ensureDir(job.indexesDir, path10.join(pubDir, "successors"));
      const claim = successorFile(job.indexesDir, current?.pointer.generation ?? null);
      const badClaim = contained2(job.indexesDir, claim, true);
      if (badClaim) return { status: "refused", reason: "containment", detail: badClaim };
      const claimTmp = path10.join(path10.dirname(claim), `.claim-${HOST}-${process.pid}-${crypto2.randomUUID()}`);
      writeDurable(claimTmp, JSON.stringify(pointer, null, 2) + "\n");
      fault("successor_tmp");
      try {
        fs8.linkSync(claimTmp, claim);
      } catch (err) {
        fs8.rmSync(claimTmp, { force: true });
        if (err.code !== "EEXIST") throw err;
        base = current?.pointer ?? null;
        if (inflightPin) fs8.rmSync(inflightPin, { force: true });
        inflightPin = null;
        if (!job.rebase || round >= 3) {
          return { status: "refused", reason: "destination_moved", detail: `successor of ${current?.pointer.generation ?? "root"} already claimed` };
        }
        continue;
      }
      fs8.rmSync(claimTmp, { force: true });
      fsyncPath(path10.dirname(claim));
      fault("successor_claimed");
      const tmp = path10.join(pubDir, `.CURRENT.${process.pid}.${crypto2.randomUUID()}`);
      writeDurable(tmp, JSON.stringify(pointer, null, 2) + "\n");
      fault("pointer_tmp_written");
      const curFile = path10.join(pubDir, "CURRENT");
      const badPtr = contained2(job.indexesDir, curFile, true);
      if (!badPtr) {
        fs8.renameSync(tmp, curFile);
        fsyncPath(pubDir);
      }
      fault("pointer_renamed");
      exportLegacy(job.indexesDir, loaded, fault);
      reclaimGenerations(job.indexesDir, { keep: job.keep });
      fault("reclaimed");
      return { status: "published", generation, rebases, reused };
    }
  } finally {
    if (inflightPin) fs8.rmSync(inflightPin, { force: true });
    if (staging) fs8.rmSync(staging, { recursive: true, force: true });
    for (const n of safeReaddir(pubDir)) {
      if (n.startsWith(`.CURRENT.${process.pid}.`)) fs8.rmSync(path10.join(pubDir, n), { force: true });
    }
    lock.release();
  }
}
function safeReaddir(d) {
  try {
    return fs8.readdirSync(d);
  } catch {
    return [];
  }
}
function exportLegacy(indexesDir, gen, fault) {
  for (const name of gen.manifest.exports) {
    const bytes = gen.artifacts[name];
    if (!bytes) continue;
    const target = path10.join(indexesDir, name);
    const bad = contained2(indexesDir, target, true);
    if (bad) throw new PublicationError("containment", bad);
    try {
      if (sha(fs8.readFileSync(target)) === gen.manifest.artifacts[name].sha256) {
        fault(`export:${name}`);
        continue;
      }
    } catch {
    }
    const tmp = path10.join(indexesDir, `.${name}.${process.pid}.${crypto2.randomUUID()}.tmp`);
    writeDurable(tmp, bytes);
    fs8.renameSync(tmp, target);
    fault(`export:${name}`);
  }
}

// scripts/learn/lib/schema.ts
var fs9 = __toESM(require("fs"));
var path11 = __toESM(require("path"));
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
  const absPath = path11.resolve(repoRoot, relPath);
  try {
    if (!fs9.existsSync(absPath)) return false;
  } catch {
    return false;
  }
  const fragment = anchorFragment(anchor);
  if (!fragment) {
    return true;
  }
  let content;
  try {
    content = fs9.readFileSync(absPath, "utf8");
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

// scripts/learn/lib/structural.ts
var STRUCTURAL_EXTRACTOR = "structural-v1";
var STRUCTURAL_NODE_TYPES = sealSet(["file", "function", "class"], "STRUCTURAL_NODE_TYPES");
var STRUCTURAL_EDGE_TYPES = sealSet([
  "contains",
  "imports",
  "calls",
  "inherits",
  "implements"
], "STRUCTURAL_EDGE_TYPES");
var STRUCTURAL_PROFILE_KEYS = Object.freeze([
  // size (3)
  "loc",
  "sloc",
  "comment_lines",
  // control flow (12)
  "if_count",
  "else_count",
  "for_count",
  "while_count",
  "switch_count",
  "case_count",
  "try_count",
  "catch_count",
  "return_count",
  "throw_count",
  "break_continue_count",
  "ternary_count",
  // boolean / async data flow (2)
  "logical_op_count",
  "await_count",
  // nesting (1)
  "max_nesting_depth",
  // data flow (4)
  "param_count",
  "call_count",
  "assignment_count",
  "decl_count",
  // aggregate + Halstead-lite (3)
  "branch_count",
  "distinct_identifiers",
  "token_count"
]);
var STRUCTURAL_CACHE_VERSION = `${STRUCTURAL_EXTRACTOR}|sp:${STRUCTURAL_PROFILE_KEYS.length}|cfg:3`;
function canonicalize(g) {
  const nodes = [...g.nodes].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const edges = [...g.edges].sort((a, b) => {
    const ak = `${a.type}|${a.source}|${a.target}`;
    const bk = `${b.type}|${b.source}|${b.target}`;
    if (ak !== bk) return ak < bk ? -1 : 1;
    const at = JSON.stringify([a.type, a.source, a.target]);
    const bt = JSON.stringify([b.type, b.source, b.target]);
    return at < bt ? -1 : at > bt ? 1 : 0;
  });
  return { nodes, edges };
}
function structuralSubset(g) {
  const isStructural = (x) => x.extractor === STRUCTURAL_EXTRACTOR || x.structural === true;
  return canonicalize({
    nodes: g.nodes.filter((n) => isStructural(n)),
    edges: g.edges.filter((e) => isStructural(e))
  });
}

// scripts/learn/lib/publish.ts
var GRAPH_ARTIFACT = "knowledge-graph.json";
var RECALL_ARTIFACT = "knowledge-recall.json";
function parse2(b) {
  if (!b) return null;
  try {
    return JSON.parse(b.toString("utf8"));
  } catch {
    return null;
  }
}
var ANNOTATIONS = ["component", "domain"];
var isStructuralNode = (n) => {
  const r = n;
  return r.extractor === STRUCTURAL_EXTRACTOR || r.structural === true;
};
function structuralView(g) {
  const sub = structuralSubset({ nodes: g?.nodes ?? [], edges: g?.edges ?? [] });
  return {
    nodes: sub.nodes.map((n) => {
      const c = { ...n };
      for (const k of ANNOTATIONS) delete c[k];
      return c;
    }),
    edges: sub.edges
  };
}
function semanticView(g) {
  const nodes = (g?.nodes ?? []).filter((n) => n.extractor !== STRUCTURAL_EXTRACTOR).map((n) => {
    const c = { ...n };
    if (c.structural === true) {
      delete c.structural;
      delete c.sp;
      delete c.language;
    }
    return c;
  }).sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const edges = (g?.edges ?? []).filter((e) => e.extractor !== STRUCTURAL_EXTRACTOR && e.structural !== true).map((e) => JSON.stringify([e.type, e.source, e.target, e])).sort();
  const labels = (g?.nodes ?? []).filter(isStructuralNode).map((n) => {
    const r = n;
    return [r.id, ...ANNOTATIONS.map((k) => r[k] ?? null)];
  }).filter((row) => row.slice(1).some((v) => v !== null)).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  return { nodes, edges, labels, layers: g?.layers ?? [], tour: g?.tour ?? [] };
}
function nodeMap(g) {
  return new Map((g?.nodes ?? []).map((n) => [String(n.id), n]));
}
var stripStamps = (n) => {
  const c = { ...n };
  delete c.structural;
  delete c.sp;
  delete c.language;
  return c;
};
function semanticLoss(destination, next) {
  if (!destination) return null;
  const after = nodeMap(next);
  for (const n of destination.nodes ?? []) {
    const r = n;
    const a = after.get(String(r.id));
    if (r.extractor !== STRUCTURAL_EXTRACTOR) {
      if (!a) return `semantic node ${String(r.id)} removed`;
      if (JSON.stringify(basisDigest(stripStamps(r))) !== JSON.stringify(basisDigest(stripStamps(a)))) return `semantic node ${String(r.id)} changed`;
    }
    if (a) {
      for (const k of ANNOTATIONS) if (r[k] !== void 0 && a[k] !== r[k]) return `label ${k} on ${String(r.id)} changed`;
    }
  }
  const key = (e) => JSON.stringify([e.source, e.target]);
  const edges = new Set((next?.edges ?? []).map(key));
  for (const e of destination.edges ?? []) {
    const r = e;
    if (r.extractor === STRUCTURAL_EXTRACTOR || r.structural === true) continue;
    if (after.has(e.source) && after.has(e.target) && !edges.has(key(e))) return `semantic edge ${key(e)} removed`;
  }
  return null;
}
function structuralLoss(destination, next) {
  if (!destination) return null;
  const before = structuralView(destination);
  const after = structuralView(next);
  const nodes = new Map(after.nodes.map((n) => [String(n.id), basisDigest(n)]));
  for (const n of before.nodes) {
    const h = nodes.get(String(n.id));
    if (!h) return `structural node ${String(n.id)} removed`;
    if (h !== basisDigest(n)) return `structural node ${String(n.id)} changed`;
  }
  const edges = new Set(after.edges.map((e) => JSON.stringify([e.source, e.target, e.type])));
  for (const e of before.edges) if (!edges.has(JSON.stringify([e.source, e.target, e.type]))) return `structural edge ${e.source}->${e.target} removed`;
  return null;
}
var LEARN_LAYERS = Object.freeze({
  structural_graph: { artifact: GRAPH_ARTIFACT, digest: (a) => basisDigest(structuralView(parse2(a[GRAPH_ARTIFACT]))) },
  semantic_graph: { artifact: GRAPH_ARTIFACT, digest: (a) => basisDigest(semanticView(parse2(a[GRAPH_ARTIFACT]))) },
  recall: {
    artifact: RECALL_ARTIFACT,
    digest: (a) => basisDigest(a[RECALL_ARTIFACT] ? a[RECALL_ARTIFACT].toString("base64") : null)
  }
});
function baseFrom(pinned, t) {
  if (pinned) {
    const bypassed = exportProvenance(t.indexesDir, GRAPH_ARTIFACT).provenance === "bypassed";
    return { pinned, graph: parse2(pinned.artifacts[GRAPH_ARTIFACT]), recall: pinned.artifacts[RECALL_ARTIFACT] ?? null, bypassed_export: bypassed };
  }
  let graph = null;
  try {
    graph = JSON.parse(fs10.readFileSync(path12.join(t.indexesDir, GRAPH_ARTIFACT), "utf8"));
  } catch {
    graph = null;
  }
  return { pinned: null, graph, recall: null, bypassed_export: false };
}
function readLearnBase(t) {
  return baseFrom(readPublication(t.indexesDir), t);
}
function jsonBytes(data) {
  return JSON.stringify(data, null, 2) + "\n";
}
function encode(artifacts) {
  const out = {};
  for (const [k, v] of Object.entries(artifacts)) out[k] = Buffer.isBuffer(v) ? v : typeof v === "string" ? v : jsonBytes(v);
  return out;
}
function publishBuilt(t, opts) {
  const basis = opts.basis;
  const ownerId = sourceWorktreeId(t.repoRoot);
  const rebase = opts.rebase;
  const structuralOnly = opts.channels.every((c) => c === "structural_graph");
  const touchesGraph = opts.channels.some((c) => c === "structural_graph" || c === "semantic_graph");
  return publishGeneration({
    indexesDir: t.indexesDir,
    identity: { source_id: ownerId, durable_owner_source_id: ownerId, publication_scope_source_id: ownerId },
    layers: LEARN_LAYERS,
    channels: opts.channels,
    base: opts.base.pinned?.pointer ?? null,
    basis,
    observe: () => computeLearnSourceBasis(t.sourceRoot),
    artifacts: encode(opts.artifacts),
    rebase: rebase ? (cur) => encode(rebase(baseFrom(cur, t))) : void 0,
    provenance: opts.provenance,
    provenanceReason: opts.provenanceReason,
    preserve: structuralOnly ? (dest, next) => semanticLoss(parse2(dest?.[GRAPH_ARTIFACT]), parse2(next[GRAPH_ARTIFACT])) : touchesGraph ? (dest, next) => structuralLoss(parse2(dest?.[GRAPH_ARTIFACT]), parse2(next[GRAPH_ARTIFACT])) : void 0,
    exports: [GRAPH_ARTIFACT, RECALL_ARTIFACT],
    lockTimeoutMs: opts.lockTimeoutMs
  });
}
function publishLearnArtifacts(t, opts) {
  if (opts.base && !opts.basis) throw new Error("publishLearnArtifacts: a supplied base needs the basis taken before it was read");
  const basis = opts.basis ?? computeLearnSourceBasis(t.sourceRoot);
  const base = opts.base ?? readLearnBase(t);
  return publishBuilt(t, { ...opts, basis, base, artifacts: opts.build(base), rebase: opts.rebase === false ? void 0 : opts.build });
}
function assertPublished(r, who) {
  if (r.status === "published") return r;
  throw new Error(`[${who}] publication refused (${r.reason}): ${r.detail}`);
}
function learnTarget(gp) {
  return { indexesDir: gp.indexesDir, repoRoot: gp.repoRoot, sourceRoot: gp.sourceRoot };
}
var PUBLICATION_WRITERS = deepFreeze([
  { file: "scripts/learn/extract-structural.ts", channels: ["structural_graph"], rebase: true },
  { file: "scripts/learn/resolve-calls.ts", channels: ["structural_graph"], rebase: true },
  { file: "scripts/learn/assign-layers.ts", channels: ["semantic_graph"], rebase: true },
  { file: "scripts/learn/build-tour.ts", channels: ["semantic_graph"], rebase: true },
  { file: "scripts/learn/derive-domain.ts", channels: ["semantic_graph"], rebase: true },
  // Whole-graph replacements: a moved destination is refused, never rebased over.
  { file: "scripts/learn/validate-graph.ts", channels: ["semantic_graph"], rebase: false },
  { file: "scripts/learn/knowledge-orchestrator.ts", channels: ["semantic_graph", "recall"], rebase: false },
  { file: "scripts/learn/write-knowledge-links.ts", channels: ["recall"], rebase: false }
]);
var NON_LAYER_WRITERS = deepFreeze([
  { file: "scripts/learn/lib/publish.ts", writes: "explicit --in/--out stage targets (not published)" },
  { file: "scripts/learn/lib/paths.ts", writes: "writeJson helper; no artifact path of its own" },
  { file: "src/domains/knowledge/publication.ts", writes: "the generation store and legacy exports" },
  { file: "scripts/learn/analyze-structural.ts", writes: "understand-partial-graph.json (validate-graph input)" },
  { file: "scripts/learn/diff-learn.ts", writes: "runs/<id>/diff-learn.json" },
  { file: "scripts/learn/k-stage-staleness.ts", writes: "the K-stage fingerprint store" },
  { file: "src/domains/knowledge/working-set.ts", writes: "the working-set card" },
  { file: "scripts/lib/capability/profile-emit.ts", writes: "capability profile receipts (reads the graph)" },
  { file: "scripts/dashboard-launch.ts", writes: "dashboard launch state" },
  { file: "scripts/lint/layout-laws.ts", writes: "lint reports (names the artifacts in a scope rule)" }
]);

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
  const existing = readJson2(knowledgeGraphPath);
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
  ensureStorageLayout(cwd, { detectOnly: true });
  const gp = guildPaths(cwd);
  const dry = hasFlag(argv, "dry");
  const basis = dry ? null : computeLearnSourceBasis(gp.sourceRoot);
  const learnBase = dry ? null : readLearnBase(learnTarget(gp));
  let input;
  if (hasFlag(argv, "stdin")) {
    input = JSON.parse(fs11.readFileSync(0, "utf8"));
  } else {
    const inPath = parseFlag(argv, "in");
    const resolved = inPath ? path13.resolve(cwd, inPath) : gp.partialGraph;
    input = readJson2(resolved);
    if (input === null) {
      process.stderr.write(`[validate] ERROR: cannot read input graph ${resolved}
`);
      process.exit(2);
    }
  }
  if (input && typeof input === "object") delete input._merge_report;
  const dispatchedV2 = isV2Input(input);
  const result = validateWithDispatch(input, gp.sourceRoot);
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
    try {
      const data = result.data;
      assertPublished(
        publishLearnArtifacts(learnTarget(gp), { channels: ["semantic_graph"], provenance: { semantic_graph: "ingested" }, base: learnBase, basis, build: () => ({ [GRAPH_ARTIFACT]: data }), rebase: false }),
        "validate"
      );
    } catch (err) {
      process.stderr.write(`${String(err.message ?? err)}
`);
      process.exit(2);
    }
    process.stderr.write(`[validate] \u2192 ${path13.relative(gp.repoRoot, gp.knowledgeGraph)}
`);
  }
  if (hasFlag(argv, "print")) {
    process.stdout.write(JSON.stringify({ data: result.data, issues: result.issues }, null, 2) + "\n");
  } else {
    process.stdout.write(
      dry ? "validated (dry-run)\n" : path13.relative(gp.repoRoot, gp.knowledgeGraph) + "\n"
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
