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

// scripts/learn/analyze-structural.ts
var fs7 = __toESM(require("fs"));
var path8 = __toESM(require("path"));

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

// scripts/learn/lib/walk.ts
var fs5 = __toESM(require("fs"));
var path5 = __toESM(require("path"));

// scripts/learn/lib/ignore.ts
var fs4 = __toESM(require("fs"));
var path4 = __toESM(require("path"));
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
  const rootIgnore = path4.join(projectRoot, ".guildignore");
  if (fs4.existsSync(rootIgnore)) {
    patterns.push(...fs4.readFileSync(rootIgnore, "utf-8").split("\n"));
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
function walkRepo(repoRoot, maxFiles = 2e4) {
  const filter = createIgnoreFilter(repoRoot);
  const out = [];
  const visit = (absDir) => {
    if (out.length >= maxFiles) return;
    let entries;
    try {
      entries = fs5.readdirSync(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      const abs = path5.join(absDir, e.name);
      const rel = path5.relative(repoRoot, abs).replace(/\\/g, "/");
      if (e.isDirectory()) {
        if (filter.isIgnored(rel) || filter.isIgnored(rel + "/")) continue;
        visit(abs);
      } else if (e.isFile()) {
        if (filter.isIgnored(rel)) continue;
        out.push(rel);
        if (out.length >= maxFiles) return;
      }
    }
  };
  visit(repoRoot);
  out.sort();
  return { files: out, filter };
}

// scripts/learn/lib/languages.ts
var path6 = __toESM(require("path"));
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
  const base = path6.basename(filePath);
  if (BASENAME_LANG[base]) return BASENAME_LANG[base];
  const ext = path6.extname(filePath).toLowerCase();
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

// scripts/learn/lib/import-map.ts
var fs6 = __toESM(require("fs"));
var path7 = __toESM(require("path"));
var JS_EXTS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];
function fileExists(p) {
  try {
    return fs6.statSync(p).isFile();
  } catch {
    return false;
  }
}
function resolveJs(importerAbs, spec, repoRoot, aliases) {
  let baseDir = null;
  let kind = "static";
  if (spec.startsWith(".")) {
    baseDir = path7.dirname(importerAbs);
  } else {
    for (const a of aliases) {
      const star = a.prefix.endsWith("*");
      const pfx = star ? a.prefix.slice(0, -1) : a.prefix;
      if (star ? spec.startsWith(pfx) : spec === a.prefix) {
        const rest = star ? spec.slice(pfx.length) : "";
        for (const t of a.targets) {
          const tt = t.endsWith("*") ? t.slice(0, -1) : t;
          const cand = path7.resolve(repoRoot, tt + rest);
          const hit2 = resolveJsFile(cand);
          if (hit2) return { abs: hit2, kind: "alias" };
        }
      }
    }
    return null;
  }
  const target = path7.resolve(baseDir, spec);
  const hit = resolveJsFile(target);
  return hit ? { abs: hit, kind } : null;
}
function resolveJsFile(target) {
  if (fileExists(target)) return target;
  for (const e of JS_EXTS) if (fileExists(target + e)) return target + e;
  for (const e of JS_EXTS) {
    const idx = path7.join(target, "index" + e);
    if (fileExists(idx)) return idx;
  }
  return null;
}
function loadTsAliases(repoRoot) {
  const tsconfigPath = path7.join(repoRoot, "tsconfig.json");
  try {
    const raw = fs6.readFileSync(tsconfigPath, "utf8").replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    const cfg = JSON.parse(raw);
    const co = cfg.compilerOptions ?? {};
    const baseUrl = co.baseUrl ?? ".";
    const paths = co.paths ?? {};
    const out = [];
    for (const [k, v] of Object.entries(paths)) {
      out.push({
        prefix: k,
        targets: v.map((t) => path7.join(baseUrl, t))
      });
    }
    return out;
  } catch {
    return [];
  }
}
function buildImportMap(repoRoot, relFiles, readFile = (a) => fs6.readFileSync(a, "utf8")) {
  const aliases = loadTsAliases(repoRoot);
  const known = new Set(relFiles.map((f) => f.replace(/\\/g, "/")));
  const edges = [];
  const seen = /* @__PURE__ */ new Set();
  for (const rel of relFiles) {
    const lang = detectLanguage(rel);
    if (lang !== "typescript" && lang !== "javascript" && lang !== "python") continue;
    const abs = path7.join(repoRoot, rel);
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
        const r = resolveJs(abs, imp.source, repoRoot, aliases);
        if (!r) continue;
        const toRel = path7.relative(repoRoot, r.abs).replace(/\\/g, "/");
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
    let dir = path7.dirname(importerRel);
    for (let i = 1; i < up; i++) dir = path7.dirname(dir);
    bases.push(path7.join(dir, spec.replace(/^\.+/, "").replace(/\./g, "/")));
  } else {
    const sub = spec.replace(/\./g, "/");
    bases.push(path7.join(path7.dirname(importerRel), sub));
    bases.push(sub);
  }
  const cands = bases.flatMap((base) => [base + ".py", path7.join(base, "__init__.py")]).map((p) => p.replace(/\\/g, "/").replace(/^\.\//, ""));
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
  const gp = guildPaths(cwd);
  const cm = readJson(gp.codebaseMap);
  const relFiles = cm?.files?.map((f) => f.path) ?? walkRepo(gp.repoRoot).files;
  const partial = buildPartialGraph(
    gp.repoRoot,
    relFiles,
    (abs) => fs7.readFileSync(abs, "utf8")
  );
  const report = mergeReport(partial);
  const out = {
    version: SCHEMA.knowledgeGraph,
    kind: "codebase",
    generated_from_commit: headSha(gp.repoRoot),
    project: { name: path8.basename(gp.repoRoot), description: "" },
    nodes: partial.nodes,
    edges: partial.edges,
    layers: [],
    tour: [],
    _merge_report: report
    // consumed by stage-3 challenger; stripped on validate
  };
  writeJson(gp.partialGraph, out);
  process.stderr.write(
    `[analyze] ${partial.nodes.length} nodes \xB7 ${partial.edges.length} edges \xB7 ${report.danglingEdges.length} dangling \u2192 ${path8.relative(gp.repoRoot, gp.partialGraph)}
`
  );
  if (hasFlag(argv, "print")) process.stdout.write(JSON.stringify(out, null, 2) + "\n");
  else process.stdout.write(path8.relative(gp.repoRoot, gp.partialGraph) + "\n");
}
main();
