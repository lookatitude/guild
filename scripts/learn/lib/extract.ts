/**
 * learn/lib/extract.ts
 *
 * Deterministic structural extractor — the SCRIPT phase of stage 2.
 *
 * This is the Guild-native fork of Understand-Anything's tree-sitter
 * structural pass (MIT — see ../LICENSE-attribution.md). Native tree-sitter
 * bindings are a heavy runtime dep (node-gyp); per the zero-runtime-dep
 * constraint we re-implement the structural pass as a dependency-free
 * line/regex extractor over the languages Guild repos use most. It captures
 * exactly the signature-level facts the knowledge graph needs (functions,
 * classes, imports, exports + line ranges); the LLM phase (task #24) does the
 * semantic node/edge typing under "trust the script, do not re-read source".
 */

import { detectLanguage } from "./languages";

export interface FunctionInfo {
  name: string;
  lineRange: [number, number];
  exported: boolean;
}
export interface ClassInfo {
  name: string;
  lineRange: [number, number];
  exported: boolean;
  methods: string[];
}
export interface ImportInfo {
  /** Raw module specifier as written in source. */
  source: string;
  specifiers: string[];
}
export interface StructuralAnalysis {
  language: string;
  loc: number;
  complexity: number; // 0..1 normalized
  functions: FunctionInfo[];
  classes: ClassInfo[];
  imports: ImportInfo[];
  exports: string[];
}

const BRANCH_KW =
  /\b(if|else|for|while|switch|case|catch|&&|\|\||\?\.|=>|return)\b/g;

/** Normalized complexity in [0,1] from LOC + branch density. */
function complexityScore(loc: number, branchCount: number): number {
  // ~ log-ish scaling so 1000 LOC / dense files approach 1.0
  const sizeC = Math.min(1, loc / 600);
  const branchC = Math.min(1, branchCount / 120);
  return Math.round((0.55 * sizeC + 0.45 * branchC) * 100) / 100;
}

function blockEnd(lines: string[], start: number): number {
  // Brace matcher from the first '{' at/after `start`. Falls back to indent
  // heuristic for brace-less languages (python/ruby) handled by caller.
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

function indentEnd(lines: string[], start: number): number {
  const base = lines[start].match(/^\s*/)?.[0].length ?? 0;
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].trim() === "") continue;
    const ind = lines[i].match(/^\s*/)?.[0].length ?? 0;
    if (ind <= base) return i;
  }
  return lines.length;
}

/**
 * Static `require("<literal>")` calls per 0-based line. One pass over the whole
 * file so block comments, strings, and multi-line template text never yield
 * edges, while code inside `${...}` still does. Member calls (`x.require`,
 * across whitespace/newlines) are skipped. Regex literals are not modeled.
 */
function staticRequiresByLine(content: string): Map<number, string[]> {
  const out = new Map<number, string[]>();
  // Trivia: whitespace, `/* */` (never crossing its first `*/`), or `//` to EOL.
  const gap = String.raw`(?:\s|\/\*(?:[^*]|\*(?!\/))*\*\/|\/\/[^\n]*\n)*`;
  const call = new RegExp(
    String.raw`require${gap}\(${gap}(?:"((?:[^"\\\n]|\\[^\n])+)"|'((?:[^'\\\n]|\\[^\n])+)')${gap}(?:,${gap})?\)`,
    "y",
  );
  // Frames: a template literal, or a `${` interpolation with its brace depth.
  const stack: Array<{ tpl: true } | { tpl: false; depth: number }> = [];
  let line = 0;
  let lastSig = ""; // last non-whitespace code char before the cursor
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
          // Line continuation (LF or CRLF) keeps the string open.
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
    // Spread (`...require(x)`) is not member access.
    if (ch === "." && content[i - 1] === "." && content[i - 2] === ".") lastSig = "...";
    else if (!/\s/.test(ch)) lastSig = ch;
  }
  return out;
}

function analyzeJsTs(lines: string[], lang: string): StructuralAnalysis {
  const functions: FunctionInfo[] = [];
  const classes: ClassInfo[] = [];
  const imports: ImportInfo[] = [];
  const exports: string[] = [];

  const reImport =
    /^\s*import\s+(?:type\s+)?(?:(\*\s+as\s+\w+|\{[^}]*\}|\w+)(?:\s*,\s*(\{[^}]*\}))?\s+from\s+)?["']([^"']+)["']/;
  const reRequire = /(?:const|let|var)\s+(\{[^}]*\}|\w+)\s*=\s*require\s*\(\s*["']([^"']+)["']\s*\)/;
  const reFn =
    /^\s*(export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/;
  const reArrow =
    /^\s*(export\s+)?(?:default\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s*)?\([^)]*\)\s*(?::[^=]+)?=>/;
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
      const specifiers = specRaw
        .replace(/[{}*]/g, "")
        .split(",")
        .map((s) => s.replace(/\s+as\s+\w+/, "").trim())
        .filter(Boolean);
      imports.push({ source: mImp[3], specifiers });
    }
    // #218: every static require("<literal>") on the line, not only the
    // declaration form. The declaration keeps its specifiers.
    const mReq = line.match(reRequire);
    let declSource = mReq ? mReq[2] : null;
    for (const source of requiresByLine.get(i) ?? []) {
      if (source === declSource) {
        imports.push({
          source,
          specifiers: mReq![1].replace(/[{}]/g, "").split(",").map((s) => s.trim()).filter(Boolean),
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
      const methods: string[] = [];
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
        methods: [...new Set(methods)],
      });
      if (mClass[1]) exports.push(mClass[2]);
      continue;
    }

    const mFn = line.match(reFn);
    if (mFn) {
      functions.push({
        name: mFn[2],
        lineRange: [i + 1, blockEnd(lines, i)],
        exported: Boolean(mFn[1]),
      });
      if (mFn[1]) exports.push(mFn[2]);
      continue;
    }
    const mArrow = line.match(reArrow);
    if (mArrow) {
      functions.push({
        name: mArrow[2],
        lineRange: [i + 1, blockEnd(lines, i)],
        exported: Boolean(mArrow[1]),
      });
      if (mArrow[1]) exports.push(mArrow[2]);
      continue;
    }

    const mExp = line.match(reExport);
    if (mExp) exports.push(mExp[1]);
    const mExpList = line.match(reExportList);
    if (mExpList) {
      for (const s of mExpList[1].split(",")) {
        const name = s.replace(/\s+as\s+\w+/, "").trim();
        if (name) exports.push(name);
      }
    }
  }

  return finalize(lines, lang, functions, classes, imports, exports);
}

function analyzePython(lines: string[]): StructuralAnalysis {
  const functions: FunctionInfo[] = [];
  const classes: ClassInfo[] = [];
  const imports: ImportInfo[] = [];
  const exports: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const mFrom = line.match(/^\s*from\s+([.\w]+)\s+import\s+(.+)$/);
    if (mFrom) {
      imports.push({
        source: mFrom[1],
        specifiers: mFrom[2].replace(/[()]/g, "").split(",").map((s) => s.split(" as ")[0].trim()).filter(Boolean),
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
      const methods: string[] = [];
      for (let j = i + 1; j < end; j++) {
        const mm = lines[j].match(/^\s+def\s+([A-Za-z_]\w*)/);
        if (mm) methods.push(mm[1]);
      }
      const top = (mClass[1]?.length ?? 0) === 0;
      classes.push({ name: mClass[2], lineRange: [i + 1, end], exported: top, methods });
      if (top) exports.push(mClass[2]);
      continue;
    }
    const mDef = line.match(/^(\s*)def\s+([A-Za-z_]\w*)/);
    if (mDef) {
      const top = (mDef[1]?.length ?? 0) === 0;
      functions.push({ name: mDef[2], lineRange: [i + 1, indentEnd(lines, i)], exported: top });
      if (top) exports.push(mDef[2]);
    }
  }
  return finalize(lines, "python", functions, classes, imports, exports);
}

/**
 * I14 (legacy G2 R4-R5): visibility from syntax only. Go: capitalized name.
 * Elsewhere: an `export` / `public` / unrestricted `pub` modifier before the
 * name (`pub(crate)` is not public). No marker → false; never invented true.
 */
function genericExported(lang: string, match: RegExpMatchArray): boolean {
  const name = match[1];
  if (lang === "go") return /^[A-Z]/.test(name);
  const prefix = match[0].slice(0, match[0].lastIndexOf(name));
  return /\b(?:export|public)\b/.test(prefix) || /\bpub\b(?!\s*\()/.test(prefix);
}

function analyzeGeneric(lines: string[], lang: string): StructuralAnalysis {
  // Brace-language fallback (go/rust/java/c/cpp/csharp/php/kotlin/swift…).
  const functions: FunctionInfo[] = [];
  const classes: ClassInfo[] = [];
  const imports: ImportInfo[] = [];
  const exports: string[] = [];

  const reImp =
    /^\s*(?:import|use|#include|require_relative|require)\s+["'<]?([\w./:-]+)/;
  const reClass = /^\s*(?:pub\s+)?(?:public\s+|final\s+|abstract\s+|static\s+)*(?:class|struct|interface|enum|trait)\s+([A-Za-z_]\w*)/;
  const reFn =
    /^\s*(?:pub\s+|public\s+|private\s+|protected\s+|static\s+|async\s+|func\s+|fn\s+|def\s+)+?\s*([A-Za-z_]\w*)\s*\(/;
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
  return finalize(lines, lang, functions, classes, imports, exports);
}

function finalize(
  lines: string[],
  language: string,
  functions: FunctionInfo[],
  classes: ClassInfo[],
  imports: ImportInfo[],
  exports: string[],
): StructuralAnalysis {
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
    exports: [...new Set(exports)],
  };
}

/** Analyze source text for a path; returns null for non-code languages. */
export function analyzeSource(filePath: string, content: string): StructuralAnalysis | null {
  const lang = detectLanguage(filePath);
  const lines = content.split("\n");
  if (lang === "typescript" || lang === "javascript") return analyzeJsTs(lines, lang);
  if (lang === "python") return analyzePython(lines);
  if (
    ["go", "rust", "java", "kotlin", "swift", "c", "cpp", "csharp", "php", "scala", "dart"].includes(lang)
  ) {
    return analyzeGeneric(lines, lang);
  }
  return null;
}
