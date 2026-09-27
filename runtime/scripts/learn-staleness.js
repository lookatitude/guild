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

// scripts/learn/staleness.ts
var fs4 = __toESM(require("fs"));
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

// scripts/learn/lib/walk.ts
var fs3 = __toESM(require("fs"));
var path3 = __toESM(require("path"));

// scripts/learn/lib/ignore.ts
var fs2 = __toESM(require("fs"));
var path2 = __toESM(require("path"));
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
  const rootIgnore = path2.join(projectRoot, ".guildignore");
  if (fs2.existsSync(rootIgnore)) {
    patterns.push(...fs2.readFileSync(rootIgnore, "utf-8").split("\n"));
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
      entries = fs3.readdirSync(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      const abs = path3.join(absDir, e.name);
      const rel = path3.relative(repoRoot, abs).replace(/\\/g, "/");
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
var path4 = __toESM(require("path"));
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
  const base = path4.basename(filePath);
  if (BASENAME_LANG[base]) return BASENAME_LANG[base];
  const ext = path4.extname(filePath).toLowerCase();
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

// scripts/learn/lib/fingerprint.ts
var import_crypto = require("crypto");
var import_path = require("path");

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

// scripts/learn/lib/fingerprint.ts
function contentHash(s) {
  return (0, import_crypto.createHash)("sha256").update(s).digest("hex");
}
function fingerprintFile(rel, content) {
  const a = analyzeSource(rel, content);
  if (!a) {
    return { contentHash: contentHash(content), functions: [], classes: [], imports: [], exports: [], hasStructural: false };
  }
  return {
    contentHash: contentHash(content),
    functions: a.functions.map((f) => `${f.name}/${f.exported ? "x" : "_"}`).sort(),
    classes: a.classes.map((c) => `${c.name}{${[...c.methods].sort().join(",")}}`).sort(),
    imports: a.imports.map((i) => `${i.source}:${[...i.specifiers].sort().join(",")}`).sort(),
    exports: [...a.exports].sort(),
    hasStructural: true
  };
}
function compareFingerprint(a, b) {
  if (a.contentHash === b.contentHash) return "NONE";
  if (!a.hasStructural || !b.hasStructural) return "STRUCTURAL";
  const eq = (x, y) => JSON.stringify(x) === JSON.stringify(y);
  if (!eq(a.functions, b.functions) || !eq(a.classes, b.classes) || !eq(a.imports, b.imports) || !eq(a.exports, b.exports)) {
    return "STRUCTURAL";
  }
  return "COSMETIC";
}
function buildStore(files, commit) {
  const fp = {};
  for (const [rel, content] of Object.entries(files)) {
    fp[rel] = fingerprintFile(rel, content);
  }
  return {
    version: "guild.understand_fingerprint.v1",
    generated_from_commit: commit,
    generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
    files: fp
  };
}
function analyzeChanges(store, current) {
  const res = { newFiles: [], deletedFiles: [], structural: [], cosmetic: [], unchanged: [] };
  const prev = store.files;
  for (const rel of Object.keys(prev)) {
    if (!(rel in current)) res.deletedFiles.push(rel);
  }
  for (const [rel, content] of Object.entries(current)) {
    if (!(rel in prev)) {
      res.newFiles.push(rel);
      continue;
    }
    const level = compareFingerprint(prev[rel], fingerprintFile(rel, content));
    if (level === "NONE") res.unchanged.push(rel);
    else if (level === "COSMETIC") res.cosmetic.push(rel);
    else res.structural.push(rel);
  }
  return res;
}
function topDir(p) {
  const d = (0, import_path.dirname)(p);
  if (d === "." || d === "") return null;
  return d.split("/")[0] || null;
}
function classify(a, totalFilesInGraph, allKnownFiles = []) {
  const structuralCount = a.structural.length + a.newFiles.length + a.deletedFiles.length;
  if (structuralCount === 0) {
    return {
      state: "SKIP",
      filesToReanalyze: [],
      rerunArchitecture: false,
      reason: a.cosmetic.length ? `${a.cosmetic.length} cosmetic-only change(s)` : "no changes"
    };
  }
  const byCount = structuralCount > 30;
  const byPct = totalFilesInGraph > 0 && structuralCount / totalFilesInGraph > 0.5;
  if (byCount || byPct) {
    return {
      state: "FULL",
      filesToReanalyze: [...a.structural, ...a.newFiles],
      rerunArchitecture: true,
      reason: `${structuralCount} structural changes (${byCount && byPct ? ">30 & >50%" : byCount ? ">30 files" : ">50% of project"})`
    };
  }
  const existingDirs = new Set(allKnownFiles.map(topDir).filter(Boolean));
  const dirChange = a.newFiles.some((f) => {
    const d = topDir(f);
    return d && !existingDirs.has(d);
  }) || a.deletedFiles.some((f) => {
    const d = topDir(f);
    return d && !existingDirs.has(d);
  });
  if (dirChange || structuralCount > 10) {
    return {
      state: "ARCHITECTURE",
      filesToReanalyze: [...a.structural, ...a.newFiles],
      rerunArchitecture: true,
      reason: dirChange ? "directory/topology shifted" : `${structuralCount} structural changes`
    };
  }
  return {
    state: "PARTIAL",
    filesToReanalyze: [...a.structural, ...a.newFiles],
    rerunArchitecture: false,
    reason: `${structuralCount} localized structural change(s)`
  };
}

// scripts/learn/staleness.ts
function readTree(repoRoot) {
  const { files } = walkRepo(repoRoot);
  const out = {};
  for (const rel of files) {
    if (!isCodeLanguage(detectLanguage(rel))) continue;
    try {
      out[rel] = fs4.readFileSync(path5.join(repoRoot, rel), "utf8");
    } catch {
    }
  }
  return out;
}
function main() {
  const argv = process.argv.slice(2);
  const cwd = parseCwd(argv);
  const gp = guildPaths(cwd);
  const commit = headSha(gp.repoRoot);
  const tree = readTree(gp.repoRoot);
  if (hasFlag(argv, "baseline")) {
    const store2 = buildStore(tree, commit);
    writeJson(gp.fingerprint, store2);
    process.stderr.write(
      `[staleness] baseline written: ${Object.keys(store2.files).length} files @ ${commit.slice(0, 8)} \u2192 ${path5.relative(gp.repoRoot, gp.fingerprint)}
`
    );
    process.stdout.write("BASELINE\n");
    return;
  }
  const store = readJson(gp.fingerprint);
  if (!store) {
    process.stderr.write("[staleness] no baseline \u2014 treat as FULL (run --baseline after a build)\n");
    const out2 = { state: "FULL", reason: "no fingerprint baseline", filesToReanalyze: Object.keys(tree), rerunArchitecture: true };
    if (hasFlag(argv, "print")) process.stdout.write(JSON.stringify(out2, null, 2) + "\n");
    else process.stdout.write("FULL\n");
    return;
  }
  const analysis = analyzeChanges(store, tree);
  const knownFiles = Object.keys(store.files);
  const decision = classify(analysis, knownFiles.length, knownFiles);
  const staleVsHead = store.generated_from_commit !== commit;
  const out = {
    ...decision,
    baseline_commit: store.generated_from_commit,
    head_commit: commit,
    stale: staleVsHead,
    analysis: {
      new: analysis.newFiles.length,
      deleted: analysis.deletedFiles.length,
      structural: analysis.structural.length,
      cosmetic: analysis.cosmetic.length,
      unchanged: analysis.unchanged.length
    }
  };
  process.stderr.write(
    `[staleness] ${decision.state} \u2014 ${decision.reason} (stale-vs-HEAD=${staleVsHead})
`
  );
  if (hasFlag(argv, "print")) process.stdout.write(JSON.stringify(out, null, 2) + "\n");
  else process.stdout.write(decision.state + "\n");
}
main();
