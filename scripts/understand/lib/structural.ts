/**
 * understand/lib/structural.ts
 *
 * LANE G1 — model-free structural extraction core.
 *
 * Deterministic, zero-runtime-dep, ZERO-LLM extraction of the structural
 * subset of guild.knowledge_graph.v1:
 *   nodes : file / function (incl. methods) / class
 *   edges : contains / imports / calls / inherits / implements
 * plus the 25-feature AST structural profile (`sp`) per code symbol
 * (goals.md §2.1 — control-flow counts, nesting, data-flow counts,
 * Halstead-lite). Computed at extraction time, near-zero cost.
 *
 * Architecture note (decision for the lead — see handoff G1.md):
 * the lane brief names `web-tree-sitter`. The Guild repo carries a standing
 * zero-runtime-dep + no-network invariant (goals.md §1.4.4; lib/extract.ts
 * already forked tree-sitter into a dependency-free extractor for this reason).
 * Vendoring binary wasm grammars is a heavyweight departure that the lead
 * should ratify; this lane therefore extends the proven regex/heuristic path,
 * which fully satisfies the G1 validation gate while honoring the invariant.
 * G2 (accurate call resolution) is the natural home for any later type-aware
 * upgrade. Node-id conventions match lib/graph.ts so output merges cleanly with
 * the existing LLM path.
 *
 * DETERMINISM: output is a pure function of (source tree, file list). No
 * timestamps, run-ids, or randomness enter the graph. Nodes are emitted sorted
 * by id, edges sorted by `type|source|target`.
 */

import { loadTsAliases, resolveImportSpec } from "./import-map";
import { detectLanguage, isCodeLanguage } from "./languages";
import { analyzeSource } from "./extract";
import { contentHash } from "./fingerprint";
import { isValidBundle } from "./bundle-validate";
import type { GraphEdge, GraphNode } from "./schema";

// ---------------------------------------------------------------------------
// Public contract
// ---------------------------------------------------------------------------

/** Marker stamped on every node/edge this extractor emits (structural subset). */
export const STRUCTURAL_EXTRACTOR = "structural-v1";

/** Node types this layer emits (all members of v1 NODE_TYPES). */
export const STRUCTURAL_NODE_TYPES = new Set(["file", "function", "class"]);

/** Edge types this layer emits (all members of v1 EDGE_TYPES). */
export const STRUCTURAL_EDGE_TYPES = new Set([
  "contains", "imports", "calls", "inherits", "implements",
]);

/** Ordered key list of the 25-feature structural profile (goals.md §2.1). */
export const STRUCTURAL_PROFILE_KEYS = [
  // size (3)
  "loc", "sloc", "comment_lines",
  // control flow (12)
  "if_count", "else_count", "for_count", "while_count", "switch_count",
  "case_count", "try_count", "catch_count", "return_count", "throw_count",
  "break_continue_count", "ternary_count",
  // boolean / async data flow (2)
  "logical_op_count", "await_count",
  // nesting (1)
  "max_nesting_depth",
  // data flow (4)
  "param_count", "call_count", "assignment_count", "decl_count",
  // aggregate + Halstead-lite (3)
  "branch_count", "distinct_identifiers", "token_count",
] as const;

export type StructuralProfile = Record<(typeof STRUCTURAL_PROFILE_KEYS)[number], number>;

/**
 * Cache-validity stamp (FIX-T4.1-3). A reused cached bundle is trusted ONLY when
 * the cache it came from was produced by the SAME extractor + config + bundle
 * shape — `contentHash` alone is insufficient (an unchanged file's stale/tampered
 * bundle could otherwise make `--incremental` diverge from a full rebuild).
 *
 * Fold every input that changes a bundle's bytes into this stamp; BUMP `cfg`
 * whenever extraction, import-resolution (lib/import-map), call/inheritance
 * resolution, or the FileBundle shape changes so old caches invalidate cleanly:
 *   - `STRUCTURAL_EXTRACTOR` — the extractor marker/version,
 *   - `sp:<n>`               — the structural-profile shape (key count),
 *   - `cfg:<rev>`            — manual revision covering resolution/bundle logic.
 */
export const STRUCTURAL_CACHE_VERSION =
  `${STRUCTURAL_EXTRACTOR}|sp:${STRUCTURAL_PROFILE_KEYS.length}|cfg:1`;

export interface StructuralGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

interface Symbol {
  kind: "function" | "class";
  /** node id (e.g. function:a.ts:foo, function:a.ts:Cls.method, class:a.ts:Cls) */
  id: string;
  /** simple name used for call/inheritance resolution */
  simpleName: string;
  /** 1-indexed [startLine, endLineExclusive] */
  range: [number, number];
  /** class-only: extends targets (simple names) */
  bases?: string[];
  /** class-only: implements targets (simple names) */
  ifaces?: string[];
}

interface FileExtract {
  rel: string;
  language: string;
  symbols: Symbol[];
  /** file → (class node id, [bases], [ifaces]) for inheritance resolution */
  classes: Symbol[];
  /** every function/method symbol (for call resolution) */
  callables: Symbol[];
  /** contains edges (file→symbol, class→method) */
  contains: GraphEdge[];
}

// ---------------------------------------------------------------------------
// Block-bound helpers (brace-language + indent-language)
// ---------------------------------------------------------------------------

function blockEnd(lines: string[], start: number): number {
  let depth = 0;
  let seen = false;
  for (let i = start; i < lines.length; i++) {
    for (const ch of stripStringsAndComments(lines[i])) {
      if (ch === "{") { depth++; seen = true; }
      else if (ch === "}") { depth--; if (seen && depth === 0) return i + 1; }
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

/** Crude string/line-comment stripper so braces/parens in literals don't skew counts. */
function stripStringsAndComments(line: string): string {
  let out = "";
  let i = 0;
  let quote: string | null = null;
  while (i < line.length) {
    const ch = line[i];
    if (quote) {
      if (ch === "\\") { i += 2; continue; }
      if (ch === quote) quote = null;
      i++;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") { quote = ch; i++; continue; }
    if (ch === "/" && line[i + 1] === "/") break;
    if (ch === "#" && quote === null) break; // python / shell line comment
    out += ch;
    i++;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Call-name filtering
// ---------------------------------------------------------------------------

const NON_CALL_NAMES = new Set([
  // control flow / keywords that are followed by "("
  "if", "else", "for", "while", "switch", "case", "catch", "try", "return",
  "throw", "function", "class", "await", "typeof", "instanceof", "new",
  "delete", "void", "do", "yield", "super", "with", "in", "of", "as",
  // python keywords
  "def", "lambda", "and", "or", "not", "is", "elif", "except", "finally",
  "assert", "raise", "import", "from", "global", "nonlocal", "pass", "del",
  // common brace-lang keywords
  "fn", "func", "match", "when", "use", "pub", "static", "const", "let", "var",
]);

// Call-name match that EXCLUDES qualified/member calls: a name preceded by "."
// (e.g. `obj.bar(`) or by another word char is not a free call. This prevents a
// false `calls` edge from `obj.bar()` to a same-named free `bar` (FIX G1-1).
const CALL_RE = /(?<![.\w$])([A-Za-z_$][\w$]*)\s*\(/g;
const IDENT_RE = /[A-Za-z_$][\w$]*/g;

// ---------------------------------------------------------------------------
// 25-feature structural profile
// ---------------------------------------------------------------------------

function count(re: RegExp, text: string): number {
  const m = text.match(re);
  return m ? m.length : 0;
}

function computeProfile(sliceLines: string[], signatureLine: string): StructuralProfile {
  const code = sliceLines.map(stripStringsAndComments).join("\n");
  const raw = sliceLines.join("\n");

  const loc = sliceLines.length;
  const sloc = sliceLines.filter((l) => l.trim() !== "").length;
  const comment_lines = sliceLines.filter((l) =>
    /^\s*(\/\/|#|\*|\/\*)/.test(l),
  ).length;

  // ternary: '?' not part of '?.' or '??'
  const ternary_count = count(/\?(?![.?])/g, code);
  const logical_op_count = count(/&&/g, code) + count(/\|\|/g, code) +
    count(/\b(?:and|or)\b/g, code);

  // max nesting via running brace depth (brace langs) or indent units (indent langs)
  let braceDepth = 0;
  let maxBrace = 0;
  for (const ch of code) {
    if (ch === "{") { braceDepth++; if (braceDepth > maxBrace) maxBrace = braceDepth; }
    else if (ch === "}") { braceDepth = Math.max(0, braceDepth - 1); }
  }
  let maxIndent = 0;
  if (maxBrace === 0) {
    // indent-based (python etc.): normalize by the smallest non-zero indent step
    const indents = sliceLines
      .filter((l) => l.trim() !== "")
      .map((l) => l.match(/^\s*/)?.[0].replace(/\t/g, "    ").length ?? 0);
    const baseIndent = indents.length ? Math.min(...indents) : 0;
    const step = 4;
    maxIndent = indents.reduce((mx, ind) => Math.max(mx, Math.floor((ind - baseIndent) / step)), 0);
  }
  const max_nesting_depth = Math.max(maxBrace, maxIndent);

  // param count from the first "(...)" on the signature line
  const sig = stripStringsAndComments(signatureLine);
  const paramMatch = sig.match(/\(([^)]*)\)/);
  const paramInner = paramMatch ? paramMatch[1].trim() : "";
  const param_count = paramInner === "" ? 0 : paramInner.split(",").filter((s) => s.trim() !== "").length;

  // call count: identifier( minus non-call keywords
  let call_count = 0;
  let m: RegExpExecArray | null;
  CALL_RE.lastIndex = 0;
  while ((m = CALL_RE.exec(code)) !== null) {
    if (!NON_CALL_NAMES.has(m[1])) call_count++;
  }

  const assignment_count = count(/[^=!<>+\-*/%&|^]=[^=]/g, code);
  const decl_count = count(/\b(?:const|let|var)\b/g, code);

  const if_count = count(/\bif\b/g, code);
  const else_count = count(/\belse\b/g, code);
  const for_count = count(/\bfor\b/g, code);
  const while_count = count(/\bwhile\b/g, code);
  const switch_count = count(/\bswitch\b/g, code);
  const case_count = count(/\bcase\b/g, code);
  const try_count = count(/\btry\b/g, code);
  const catch_count = count(/\b(?:catch|except)\b/g, code);
  const return_count = count(/\breturn\b/g, code);
  const throw_count = count(/\b(?:throw|raise)\b/g, code);
  const break_continue_count = count(/\b(?:break|continue)\b/g, code);
  const await_count = count(/\bawait\b/g, code);

  const branch_count =
    if_count + for_count + while_count + case_count + catch_count +
    ternary_count + logical_op_count;

  // Halstead-lite: distinct identifiers (operands) + total tokens (length)
  const idents = new Set<string>();
  let im: RegExpExecArray | null;
  IDENT_RE.lastIndex = 0;
  while ((im = IDENT_RE.exec(code)) !== null) idents.add(im[0]);
  const distinct_identifiers = idents.size;
  const token_count = count(/[A-Za-z_$][\w$]*|[{}()[\];,.<>=+\-*/%&|^!?:]/g, code);

  void raw; // (raw retained for potential future signed-feature use)

  return {
    loc, sloc, comment_lines,
    if_count, else_count, for_count, while_count, switch_count, case_count,
    try_count, catch_count, return_count, throw_count, break_continue_count,
    ternary_count, logical_op_count, await_count, max_nesting_depth,
    param_count, call_count, assignment_count, decl_count,
    branch_count, distinct_identifiers, token_count,
  };
}

// ---------------------------------------------------------------------------
// Per-file symbol extraction
// ---------------------------------------------------------------------------

const RE_TS_CLASS =
  /^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)(?:\s+extends\s+([A-Za-z_$][\w$.]*))?(?:\s+implements\s+([^{]+))?/;
const RE_TS_INTERFACE =
  /^\s*(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)(?:\s+extends\s+([^{]+))?/;
const RE_TS_FN =
  /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/;
const RE_TS_ARROW =
  /^\s*(?:export\s+)?(?:default\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s*)?\([^)]*\)\s*(?::[^=]+)?=>/;
const RE_TS_METHOD =
  /^\s+(?:public\s+|private\s+|protected\s+|static\s+|readonly\s+|async\s+|get\s+|set\s+|\*\s*)*([A-Za-z_$][\w$]*)\s*\([^;{]*\)\s*(?::[^={]+)?\{/;

function splitNames(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim().split(/[<\s]/)[0].split(".").pop() ?? "")
    .filter((s) => /^[A-Za-z_$][\w$]*$/.test(s));
}

function extractTsJs(rel: string, lang: string, lines: string[]): FileExtract {
  const fileId = `file:${rel}`;
  const symbols: Symbol[] = [];
  const classes: Symbol[] = [];
  const callables: Symbol[] = [];
  const contains: GraphEdge[] = [];
  const claimed = new Set<number>(); // lines already consumed by a class body scan

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const mClass = line.match(RE_TS_CLASS);
    const mIface = mClass ? null : line.match(RE_TS_INTERFACE);
    if (mClass || mIface) {
      const name = (mClass ? mClass[1] : mIface![1]);
      const end = blockEnd(lines, i);
      const id = `class:${rel}:${name}`;
      const bases = mClass
        ? splitNames(mClass[2])
        : splitNames(mIface![2]);
      const ifaces = mClass ? splitNames(mClass[3]) : [];
      const sym: Symbol = { kind: "class", id, simpleName: name, range: [i + 1, end], bases, ifaces };
      symbols.push(sym);
      classes.push(sym);
      contains.push(edge(fileId, id, "contains", 1));

      // methods inside the class body
      for (let j = i + 1; j < end - 1; j++) {
        const mm = lines[j].match(RE_TS_METHOD);
        if (!mm) continue;
        if (NON_CALL_NAMES.has(mm[1])) continue;
        if (/^\s*(?:if|for|while|switch|catch|return)\b/.test(lines[j])) continue;
        const mEnd = blockEnd(lines, j);
        const mId = `function:${rel}:${name}.${mm[1]}`;
        const mSym: Symbol = { kind: "function", id: mId, simpleName: mm[1], range: [j + 1, mEnd] };
        symbols.push(mSym);
        callables.push(mSym);
        contains.push(edge(id, mId, "contains", 1));
        for (let k = j; k < mEnd; k++) claimed.add(k);
      }
      i = end - 1;
      continue;
    }

    if (claimed.has(i)) continue;

    const mFn = line.match(RE_TS_FN);
    if (mFn) {
      const id = `function:${rel}:${mFn[1]}`;
      const sym: Symbol = { kind: "function", id, simpleName: mFn[1], range: [i + 1, blockEnd(lines, i)] };
      symbols.push(sym); callables.push(sym);
      contains.push(edge(fileId, id, "contains", 1));
      continue;
    }
    const mArrow = line.match(RE_TS_ARROW);
    if (mArrow) {
      const id = `function:${rel}:${mArrow[1]}`;
      const sym: Symbol = { kind: "function", id, simpleName: mArrow[1], range: [i + 1, blockEnd(lines, i)] };
      symbols.push(sym); callables.push(sym);
      contains.push(edge(fileId, id, "contains", 1));
      continue;
    }
  }

  void lang;
  return { rel, language: lang, symbols, classes, callables, contains };
}

const RE_PY_CLASS = /^(\s*)class\s+([A-Za-z_]\w*)\s*(?:\(([^)]*)\))?/;
const RE_PY_DEF = /^(\s*)def\s+([A-Za-z_]\w*)/;

function extractPython(rel: string, lines: string[]): FileExtract {
  const fileId = `file:${rel}`;
  const symbols: Symbol[] = [];
  const classes: Symbol[] = [];
  const callables: Symbol[] = [];
  const contains: GraphEdge[] = [];
  const claimed = new Set<number>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const mClass = line.match(RE_PY_CLASS);
    if (mClass) {
      const name = mClass[2];
      const end = indentEnd(lines, i);
      const id = `class:${rel}:${name}`;
      const bases = splitNames(mClass[3]).filter((b) => b !== "object");
      const sym: Symbol = { kind: "class", id, simpleName: name, range: [i + 1, end], bases, ifaces: [] };
      symbols.push(sym); classes.push(sym);
      contains.push(edge(fileId, id, "contains", 1));

      for (let j = i + 1; j < end; j++) {
        const mm = lines[j].match(RE_PY_DEF);
        if (!mm) continue;
        const mEnd = indentEnd(lines, j);
        const mId = `function:${rel}:${name}.${mm[2]}`;
        const mSym: Symbol = { kind: "function", id: mId, simpleName: mm[2], range: [j + 1, mEnd] };
        symbols.push(mSym); callables.push(mSym);
        contains.push(edge(id, mId, "contains", 1));
        for (let k = j; k < mEnd; k++) claimed.add(k);
      }
      i = end - 1;
      continue;
    }
    if (claimed.has(i)) continue;
    const mDef = line.match(RE_PY_DEF);
    if (mDef && (mDef[1]?.length ?? 0) === 0) {
      const id = `function:${rel}:${mDef[2]}`;
      const sym: Symbol = { kind: "function", id, simpleName: mDef[2], range: [i + 1, indentEnd(lines, i)] };
      symbols.push(sym); callables.push(sym);
      contains.push(edge(fileId, id, "contains", 1));
    }
  }
  return { rel, language: "python", symbols, classes, callables, contains };
}

function extractFile(rel: string, content: string): FileExtract | null {
  const lang = detectLanguage(rel);
  const lines = content.split("\n");
  if (lang === "typescript" || lang === "javascript") return extractTsJs(rel, lang, lines);
  if (lang === "python") return extractPython(rel, lines);
  return null; // language table is additive — more langs slot in here
}

// ---------------------------------------------------------------------------
// Edge helper
// ---------------------------------------------------------------------------

function edge(source: string, target: string, type: string, weight: number, description?: string): GraphEdge {
  const e: GraphEdge = { source, target, type, direction: "out", weight, extractor: STRUCTURAL_EXTRACTOR };
  if (description) e.description = description;
  return e;
}

// ---------------------------------------------------------------------------
// Top-level extraction (two-pass: symbols, then calls/inheritance)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Per-file bundle — the incremental-refresh unit (G4)
// ---------------------------------------------------------------------------

/**
 * Everything the global resolution passes need from ONE file, computed once.
 * A bundle is a pure function of (rel, content). For unchanged files an
 * incremental refresh REUSES the cached bundle (keyed by `contentHash`) so the
 * file is never re-read/re-parsed; the global assemble then produces output
 * byte-identical to a full rebuild (cross-file resolution still runs over the
 * whole bundle set, so adding/removing/renaming a symbol in one file correctly
 * updates edges owned by OTHER, unchanged files).
 *
 * The bundle carries the IMPORT SPECIFIERS (raw, not resolved) and the per-
 * callable CALLEE NAMES (not resolved ids) — resolution is deferred to assemble
 * so it always reflects the current whole-tree symbol tables.
 */
export interface FileBundle {
  rel: string;
  language: string;
  /** true iff this file contributed code symbols (function/class) */
  isCode: boolean;
  /** SHA-256 of file content ("" if unreadable) — the incremental fingerprint key */
  contentHash: string;
  fileNode: GraphNode;
  symbolNodes: GraphNode[];
  contains: GraphEdge[];
  /** raw import source specifiers (re-resolved at assemble time) */
  importSpecs: string[];
  classes: Array<{ id: string; simpleName: string; bases: string[]; ifaces: string[] }>;
  callables: Array<{ id: string; simpleName: string; callees: string[] }>;
}

/** Persisted bundle cache — the reuse baseline for `--incremental` runs. */
export interface StructuralCache {
  schema: "guild.structural_cache.v1";
  /**
   * Extractor+config+shape stamp (FIX-T4.1-3). A mismatch (or absent field, i.e.
   * a pre-fix cache) invalidates the WHOLE cache — every file is re-extracted so
   * incremental can never diverge from a full rebuild after a logic/shape change.
   */
  version: string;
  files: Record<string, FileBundle>;
}

/**
 * A cached bundle may be reused ONLY if it passes the shared comprehensive
 * validator (`lib/bundle-validate.ts` `isValidBundle`) — top-level shape, the
 * FULL GraphNode/GraphEdge schema of every nested element, AND the bundle's
 * cross-consistency (id↔kind, id↔name, id↔owning-file, source_ref↔file, edge
 * endpoints within this bundle). `assembleStructuralGraph` dereferences and
 * emits this data WHOLESALE, so a current-version / matching-hash bundle that is
 * shaped-invalid (a phantom symbol id, a `contains` endpoint outside the bundle,
 * a `source_ref` for a foreign file, a class id resolving to a function node, a
 * `null`/malformed element, …) would otherwise crash or silently diverge from a
 * full rebuild. Any violation rejects the bundle → re-extract that file, so
 * incremental stays == full.
 *
 * FIX-T4.1-r3: the validator is the SINGLE source of truth shared with the
 * artifact-bootstrap path (`graph-artifact.ts` `validateStructuralCache`) so the
 * two reuse paths cannot diverge. We additionally require a non-empty
 * `contentHash` here — the reuse caller below only trusts a bundle whose
 * `contentHash` equals the live file's, which is never "".
 */
function isReusableBundle(rel: string, b: unknown): b is FileBundle {
  if (!b || typeof b !== "object") return false;
  if ((b as Record<string, unknown>).contentHash === "") return false;
  return isValidBundle(rel, b);
}

function symbolNodeName(sym: Symbol): string {
  return sym.id.startsWith("function:") ? sym.id.split(":").slice(2).join(":") : sym.simpleName;
}

/** Sorted, deduped callee simple-names within a callable body (matches Pass 2c). */
function computeCallees(lines: string[], sym: Symbol): string[] {
  // scan the body AFTER the signature line to avoid self-signature matches
  const body = lines.slice(sym.range[0], sym.range[1]).map(stripStringsAndComments).join("\n");
  const callees = new Set<string>();
  let m: RegExpExecArray | null;
  CALL_RE.lastIndex = 0;
  while ((m = CALL_RE.exec(body)) !== null) {
    const name = m[1];
    if (NON_CALL_NAMES.has(name)) continue;
    if (name === sym.simpleName) continue; // skip recursion / self-signature noise
    callees.add(name);
  }
  return [...callees].sort();
}

function importSpecsFor(rel: string, lang: string, content: string): string[] {
  if (lang !== "typescript" && lang !== "javascript" && lang !== "python") return [];
  const a = analyzeSource(rel, content);
  return a ? a.imports.map((i) => i.source) : [];
}

/**
 * Build the bundle for one file from its content (`null` = unreadable). Pure +
 * deterministic. A non-code (or unreadable, or unparseable) file yields just the
 * file node — exactly what the full Pass 1 emits for the same file.
 */
export function makeBundle(rel: string, content: string | null): FileBundle {
  const lang = detectLanguage(rel);
  const fileNode: GraphNode = {
    id: `file:${rel}`,
    type: "file",
    name: rel.split("/").pop() ?? rel,
    source_refs: [rel],
    confidence: "high",
    language: lang,
    extractor: STRUCTURAL_EXTRACTOR,
  };
  const hash = content === null ? "" : contentHash(content);
  const empty: FileBundle = {
    rel, language: lang, isCode: false, contentHash: hash, fileNode,
    symbolNodes: [], contains: [], importSpecs: [], classes: [], callables: [],
  };
  if (content === null || !isCodeLanguage(lang)) return empty;

  const fe = extractFile(rel, content);
  if (!fe) return empty;

  const lines = content.split("\n");
  const symbolNodes: GraphNode[] = fe.symbols.map((sym) => {
    const slice = lines.slice(sym.range[0] - 1, sym.range[1]);
    const sigLine = lines[sym.range[0] - 1] ?? "";
    return {
      id: sym.id,
      type: sym.kind,
      name: symbolNodeName(sym),
      source_refs: [`${rel}#L${sym.range[0]}-L${sym.range[1]}`],
      confidence: "high",
      sp: computeProfile(slice, sigLine),
      extractor: STRUCTURAL_EXTRACTOR,
    } as GraphNode;
  });
  return {
    rel,
    language: lang,
    isCode: true,
    contentHash: hash,
    fileNode,
    symbolNodes,
    contains: fe.contains,
    importSpecs: importSpecsFor(rel, lang, content),
    classes: fe.classes.map((c) => ({
      id: c.id, simpleName: c.simpleName, bases: c.bases ?? [], ifaces: c.ifaces ?? [],
    })),
    callables: fe.callables.map((c) => ({
      id: c.id, simpleName: c.simpleName, callees: computeCallees(lines, c),
    })),
  };
}

/** Read + bundle one file (`readFile` injected for testability). */
export function extractFileBundle(
  repoRoot: string,
  rel: string,
  readFile: (abs: string) => string,
): FileBundle {
  let content: string | null;
  try {
    content = readFile(`${repoRoot}/${rel}`);
  } catch {
    content = null;
  }
  return makeBundle(rel, content);
}

/** Bundle every file (the full-extraction Pass 1, factored out). */
export function buildBundles(
  repoRoot: string,
  relFiles: string[],
  readFile: (abs: string) => string,
): FileBundle[] {
  return [...relFiles].sort().map((rel) => extractFileBundle(repoRoot, rel, readFile));
}

// ---------------------------------------------------------------------------
// Global assemble — Pass 2 resolution over a bundle set
// ---------------------------------------------------------------------------

/**
 * Assemble the structural graph from a set of per-file bundles. This is the
 * SINGLE resolution implementation shared by the full and incremental paths:
 * given the same final bundle set it always produces byte-identical output,
 * regardless of whether each bundle was freshly extracted or reused from cache.
 */
export function assembleStructuralGraph(repoRoot: string, bundles: FileBundle[]): StructuralGraph {
  const sorted = [...bundles].sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));

  const nodes: GraphNode[] = [];
  const nodeIds = new Set<string>();
  const edges: GraphEdge[] = [];
  const edgeKeys = new Set<string>();
  const addNode = (n: GraphNode) => {
    if (nodeIds.has(n.id)) return;
    nodeIds.add(n.id);
    nodes.push(n);
  };
  const addEdge = (e: GraphEdge) => {
    const k = `${e.type}|${e.source}|${e.target}`;
    if (edgeKeys.has(k)) return;
    edgeKeys.add(k);
    edges.push(e);
  };

  // Global resolution tables.
  const fnNameToIds = new Map<string, Set<string>>();
  const fnIdToFile = new Map<string, string>();
  const classNameToIds = new Map<string, Set<string>>();
  const classIdToFile = new Map<string, string>();
  const register = (map: Map<string, Set<string>>, name: string, id: string) => {
    if (!map.has(name)) map.set(name, new Set());
    map.get(name)!.add(id);
  };

  // ── Pass 1: nodes + contains + symbol-table registration ───────────────────
  for (const b of sorted) {
    addNode(b.fileNode);
    if (!b.isCode) continue;
    for (const n of b.symbolNodes) addNode(n);
    for (const c of b.callables) { register(fnNameToIds, c.simpleName, c.id); fnIdToFile.set(c.id, b.rel); }
    for (const c of b.classes) { register(classNameToIds, c.simpleName, c.id); classIdToFile.set(c.id, b.rel); }
    for (const e of b.contains) addEdge(e);
  }

  // ── Pass 2a: imports edges (re-resolved against the current file set) ──────
  const known = new Set(sorted.map((b) => b.rel.replace(/\\/g, "/")));
  const aliases = loadTsAliases(repoRoot);
  for (const b of sorted) {
    if (!b.isCode) continue;
    for (const spec of b.importSpecs) {
      const ie = resolveImportSpec(repoRoot, b.rel, spec, known, aliases);
      if (!ie) continue;
      const s = `file:${ie.from}`;
      const t = `file:${ie.to}`;
      if (nodeIds.has(s) && nodeIds.has(t)) {
        addEdge(edge(s, t, "imports", 0.7, ie.kind === "alias" ? "alias import" : undefined));
      }
    }
  }

  // Resolve a simple name to a single node id, preferring same-file, then
  // global uniqueness. Ambiguous names are skipped (no false edges; G2 refines).
  const resolve = (
    map: Map<string, Set<string>>,
    idToFile: Map<string, string>,
    name: string,
    fromFile: string,
  ): string | null => {
    const ids = map.get(name);
    if (!ids || ids.size === 0) return null;
    const sameFile = [...ids].filter((id) => idToFile.get(id) === fromFile).sort();
    if (sameFile.length === 1) return sameFile[0];
    if (sameFile.length > 1) return null; // ambiguous within file → skip
    const all = [...ids];
    return all.length === 1 ? all[0] : null; // global unique only
  };

  // ── Pass 2b: inherits / implements edges ──────────────────────────────────
  for (const b of sorted) {
    if (!b.isCode) continue;
    for (const c of b.classes) {
      for (const base of c.bases) {
        const targetId = resolve(classNameToIds, classIdToFile, base, b.rel);
        if (targetId && targetId !== c.id) {
          const w = classIdToFile.get(targetId) === b.rel ? 0.9 : 0.6;
          addEdge(edge(c.id, targetId, "inherits", w));
        }
      }
      for (const iface of c.ifaces) {
        const targetId = resolve(classNameToIds, classIdToFile, iface, b.rel);
        if (targetId && targetId !== c.id) {
          const w = classIdToFile.get(targetId) === b.rel ? 0.9 : 0.6;
          addEdge(edge(c.id, targetId, "implements", w));
        }
      }
    }
  }

  // ── Pass 2c: calls edges ──────────────────────────────────────────────────
  for (const b of sorted) {
    if (!b.isCode) continue;
    for (const c of b.callables) {
      for (const name of c.callees) {
        const targetId = resolve(fnNameToIds, fnIdToFile, name, b.rel);
        if (targetId && targetId !== c.id) {
          const w = fnIdToFile.get(targetId) === b.rel ? 0.9 : 0.6;
          addEdge(edge(c.id, targetId, "calls", w));
        }
      }
    }
  }

  return canonicalize({ nodes, edges });
}

/**
 * Build the structural subset of the knowledge graph for a set of repo-relative
 * code files. Pure + deterministic: same (tree, file list) → byte-identical
 * (after canonicalization). `readFile(abs)` is injected for testability.
 *
 * Equivalent to `assembleStructuralGraph(repoRoot, buildBundles(...))` — the
 * full path and the incremental path (`refreshStructuralIncremental`) share the
 * one resolution implementation.
 */
export function extractStructuralGraph(
  repoRoot: string,
  relFiles: string[],
  readFile: (abs: string) => string,
): StructuralGraph {
  return assembleStructuralGraph(repoRoot, buildBundles(repoRoot, relFiles, readFile));
}

// ---------------------------------------------------------------------------
// Incremental git-aware refresh (G4)
// ---------------------------------------------------------------------------

/** Serialize bundles into the persisted cache (rel-sorted, deterministic). */
export function bundlesToCache(bundles: FileBundle[]): StructuralCache {
  const files: Record<string, FileBundle> = {};
  for (const b of [...bundles].sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0))) {
    files[b.rel] = b;
  }
  return { schema: "guild.structural_cache.v1", version: STRUCTURAL_CACHE_VERSION, files };
}

export interface RefreshStats {
  mode: "incremental";
  /** previously-cached files whose content changed → re-extracted */
  reExtracted: string[];
  /** unchanged files served from cache (never re-read/re-parsed) */
  reused: string[];
  /** files absent from the cache → freshly extracted */
  newFiles: string[];
  /** files in the cache but no longer in the tree → bundle dropped */
  deleted: string[];
}

/**
 * Incremental structural refresh: diff the current file set against a prior
 * bundle cache (by SHA-256 content hash), reuse cached bundles for unchanged
 * files, re-extract only changed/new files, drop deleted files, then re-assemble
 * the WHOLE structural graph. The cascade is implicit: a deleted/changed file's
 * nodes & edges vanish from the new assemble, and cross-file edges owned by
 * unchanged files are re-resolved against the new symbol tables — so the result
 * is byte-identical to a full rebuild of the final tree.
 */
export function refreshStructuralIncremental(
  repoRoot: string,
  relFiles: string[],
  readFile: (abs: string) => string,
  prior: StructuralCache,
): { structural: StructuralGraph; bundles: FileBundle[]; stats: RefreshStats } {
  // FIX-T4.1-3: a stamp mismatch (or a pre-fix cache with no `version`) means the
  // cached bundles were produced by a different extractor/config/shape — none are
  // trustworthy, so drop the whole cache and re-extract every file. The result is
  // a full rebuild surfaced through the incremental path (still == a clean build).
  const versionOk = prior.version === STRUCTURAL_CACHE_VERSION;
  const priorFiles = versionOk ? (prior.files ?? {}) : {};
  const stats: RefreshStats = { mode: "incremental", reExtracted: [], reused: [], newFiles: [], deleted: [] };

  const currentSet = new Set(relFiles);
  for (const rel of Object.keys(priorFiles)) {
    if (!currentSet.has(rel)) stats.deleted.push(rel);
  }
  stats.deleted.sort();

  const bundles: FileBundle[] = [];
  for (const rel of [...relFiles].sort()) {
    let content: string | null;
    try {
      content = readFile(`${repoRoot}/${rel}`);
    } catch {
      content = null;
    }
    const hash = content === null ? "" : contentHash(content);
    const cached = priorFiles[rel];
    // Reuse ONLY when the bundle's shape is intact AND its content hash matches —
    // a hash match on a malformed bundle is never enough (FIX-T4.1-3).
    if (cached && hash !== "" && isReusableBundle(rel, cached) && cached.contentHash === hash) {
      bundles.push(cached);
      stats.reused.push(rel);
    } else {
      bundles.push(makeBundle(rel, content));
      if (cached) stats.reExtracted.push(rel);
      else stats.newFiles.push(rel);
    }
  }

  const structural = assembleStructuralGraph(repoRoot, bundles);
  return { structural, bundles, stats };
}

/**
 * Strip THIS extractor's structural items from an existing graph so a freshly
 * assembled structural subgraph can be spliced in to yield a graph identical to
 * a clean full rebuild + that same LLM tier.
 *
 *  - Pure structural nodes/edges (`extractor === STRUCTURAL_EXTRACTOR`) are
 *    removed wholesale (they are fully replaced by the new assemble).
 *  - Collided LLM-tier nodes (carry additive `structural: true` from FIX G1-5)
 *    are KEPT but reverted to pure-LLM: the additive `structural` flag and the
 *    structural-owned `sp` profile are dropped, so the re-merge re-applies them
 *    only if the symbol still exists. NEVER deletes a foreign (LLM/other-
 *    producer) node or edge.
 *
 * Assumption (documented): `sp` is owned exclusively by the structural extractor
 * (LLM nodes do not author `sp`); a node carrying `structural: true` had its `sp`
 * stamped by FIX G1-5, so reverting it is loss-free.
 */
export function stripStructural(
  nodes: GraphNode[],
  edges: GraphEdge[],
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const keptNodes: GraphNode[] = [];
  for (const n of nodes) {
    const rec = n as Record<string, unknown>;
    if (rec.extractor === STRUCTURAL_EXTRACTOR) continue; // pure structural — replaced wholesale
    if (rec.structural === true) {
      const copy = { ...n } as Record<string, unknown>;
      delete copy.structural;
      delete copy.sp;
      keptNodes.push(copy as unknown as GraphNode);
    } else {
      keptNodes.push(n);
    }
  }
  const keptEdges = edges.filter((e) => (e as Record<string, unknown>).extractor !== STRUCTURAL_EXTRACTOR);
  return { nodes: keptNodes, edges: keptEdges };
}

// ---------------------------------------------------------------------------
// Canonicalization (determinism)
// ---------------------------------------------------------------------------

/** Sort nodes by id and edges by type|source|target for byte-identical output. */
export function canonicalize(g: StructuralGraph): StructuralGraph {
  const nodes = [...g.nodes].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const edges = [...g.edges].sort((a, b) => {
    const ak = `${a.type}|${a.source}|${a.target}`;
    const bk = `${b.type}|${b.source}|${b.target}`;
    return ak < bk ? -1 : ak > bk ? 1 : 0;
  });
  return { nodes, edges };
}

/**
 * The structural subset of a graph = nodes/edges this extractor produced.
 * A node counts as structural if it was emitted fresh (`extractor` marker) OR is
 * a collided LLM-tier node that ALSO denotes a structural symbol (`structural:
 * true`, stamped additively at merge — FIX G1-5) so the subset + sidecar counts
 * stay correct when a structural symbol coincides with an existing node id.
 */
export function structuralSubset(g: { nodes: GraphNode[]; edges: GraphEdge[] }): StructuralGraph {
  const isStructural = (x: Record<string, unknown>) =>
    x.extractor === STRUCTURAL_EXTRACTOR || x.structural === true;
  return canonicalize({
    nodes: g.nodes.filter((n) => isStructural(n as Record<string, unknown>)),
    edges: g.edges.filter((e) => isStructural(e as Record<string, unknown>)),
  });
}

/**
 * Deterministic merge of a structural subgraph into an existing graph's
 * nodes/edges. Existing (LLM-tier) nodes are NOT clobbered: on id collision the
 * existing node wins, but structural-only fields (`sp`, `language`) are filled
 * in where absent. Edges union by type|source|target.
 */
export function mergeStructuralInto(
  existingNodes: GraphNode[],
  existingEdges: GraphEdge[],
  structural: StructuralGraph,
): StructuralGraph {
  const nodeById = new Map<string, GraphNode>();
  for (const n of existingNodes) nodeById.set(n.id, n);
  for (const s of structural.nodes) {
    const ex = nodeById.get(s.id);
    if (!ex) {
      nodeById.set(s.id, s);
    } else {
      // Non-clobbering merge: existing (LLM-tier) values win, but fill in
      // structural-only fields AND stamp additive structural provenance so the
      // collided node is still counted in the structural subset (FIX G1-5).
      const exRec = ex as Record<string, unknown>;
      const exAlreadyStructural =
        exRec.extractor === STRUCTURAL_EXTRACTOR || exRec.structural === true;
      const merged: GraphNode = { ...ex };
      if (merged.sp === undefined && s.sp !== undefined) merged.sp = s.sp;
      if (merged.language === undefined && (s as Record<string, unknown>).language !== undefined) {
        merged.language = (s as Record<string, unknown>).language;
      }
      // Only stamp additive provenance on a GENUINE LLM-tier collision. If the
      // existing node is already ours (re-run on prior output), leave it as-is so
      // the merge is idempotent → byte-identical re-runs (FIX G1-4 determinism).
      if (!exAlreadyStructural) (merged as Record<string, unknown>).structural = true;
      nodeById.set(s.id, merged);
    }
  }

  const edgeByKey = new Map<string, GraphEdge>();
  for (const e of existingEdges) edgeByKey.set(`${e.type}|${e.source}|${e.target}`, e);
  for (const e of structural.edges) {
    const k = `${e.type}|${e.source}|${e.target}`;
    if (!edgeByKey.has(k)) edgeByKey.set(k, e);
  }

  return canonicalize({ nodes: [...nodeById.values()], edges: [...edgeByKey.values()] });
}
