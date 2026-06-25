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

import { buildImportMap } from "./import-map";
import { detectLanguage, isCodeLanguage } from "./languages";
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

const CALL_RE = /\b([A-Za-z_$][\w$]*)\s*\(/g;
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

/**
 * Build the structural subset of the knowledge graph for a set of repo-relative
 * code files. Pure + deterministic: same (tree, file list) → byte-identical
 * (after canonicalization). `readFile(abs)` is injected for testability.
 */
export function extractStructuralGraph(
  repoRoot: string,
  relFiles: string[],
  readFile: (abs: string) => string,
): StructuralGraph {
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
  const fnNameToIds = new Map<string, Set<string>>();   // simple name → callable ids
  const fnIdToFile = new Map<string, string>();          // callable id → rel
  const classNameToIds = new Map<string, Set<string>>(); // simple name → class ids
  const classIdToFile = new Map<string, string>();
  const fileExtracts: FileExtract[] = [];
  const fileLinesCache = new Map<string, string[]>();

  const register = (map: Map<string, Set<string>>, name: string, id: string) => {
    if (!map.has(name)) map.set(name, new Set());
    map.get(name)!.add(id);
  };

  // ── Pass 1: file/function/class nodes + structural profiles ───────────────
  for (const rel of [...relFiles].sort()) {
    const lang = detectLanguage(rel);
    const fileId = `file:${rel}`;
    addNode({
      id: fileId,
      type: "file",
      name: rel.split("/").pop() ?? rel,
      source_refs: [rel],
      confidence: "high",
      language: lang,
      extractor: STRUCTURAL_EXTRACTOR,
    });
    if (!isCodeLanguage(lang)) continue;

    let content: string;
    try {
      content = readFile(`${repoRoot}/${rel}`);
    } catch {
      continue;
    }
    const fe = extractFile(rel, content);
    if (!fe) continue;
    const lines = content.split("\n");
    fileLinesCache.set(rel, lines);
    fileExtracts.push(fe);

    for (const sym of fe.symbols) {
      const slice = lines.slice(sym.range[0] - 1, sym.range[1]);
      const sigLine = lines[sym.range[0] - 1] ?? "";
      const node: GraphNode = {
        id: sym.id,
        type: sym.kind,
        name: sym.id.startsWith("function:") ? sym.id.split(":").slice(2).join(":") : sym.simpleName,
        source_refs: [`${rel}#L${sym.range[0]}-L${sym.range[1]}`],
        confidence: "high",
        sp: computeProfile(slice, sigLine),
        extractor: STRUCTURAL_EXTRACTOR,
      };
      addNode(node);
      if (sym.kind === "function") {
        register(fnNameToIds, sym.simpleName, sym.id);
        fnIdToFile.set(sym.id, rel);
      } else {
        register(classNameToIds, sym.simpleName, sym.id);
        classIdToFile.set(sym.id, rel);
      }
    }
    for (const c of fe.contains) addEdge(c);
  }

  // ── Pass 2a: imports edges (ground truth from the import map) ──────────────
  for (const ie of buildImportMap(repoRoot, relFiles, readFile)) {
    const s = `file:${ie.from}`;
    const t = `file:${ie.to}`;
    if (nodeIds.has(s) && nodeIds.has(t)) {
      addEdge(edge(s, t, "imports", 0.7, ie.kind === "alias" ? "alias import" : undefined));
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
  for (const fe of fileExtracts) {
    for (const c of fe.classes) {
      for (const base of c.bases ?? []) {
        const targetId = resolve(classNameToIds, classIdToFile, base, fe.rel);
        if (targetId && targetId !== c.id) {
          const w = classIdToFile.get(targetId) === fe.rel ? 0.9 : 0.6;
          addEdge(edge(c.id, targetId, "inherits", w));
        }
      }
      for (const iface of c.ifaces ?? []) {
        const targetId = resolve(classNameToIds, classIdToFile, iface, fe.rel);
        if (targetId && targetId !== c.id) {
          const w = classIdToFile.get(targetId) === fe.rel ? 0.9 : 0.6;
          addEdge(edge(c.id, targetId, "implements", w));
        }
      }
    }
  }

  // ── Pass 2c: calls edges ──────────────────────────────────────────────────
  for (const fe of fileExtracts) {
    const lines = fileLinesCache.get(fe.rel)!;
    for (const sym of fe.callables) {
      // scan the body AFTER the signature line to avoid self-signature matches
      const bodyStart = sym.range[0]; // 0-indexed line just after signature (range[0] is 1-indexed sig line)
      const body = lines.slice(bodyStart, sym.range[1]).map(stripStringsAndComments).join("\n");
      const callees = new Set<string>();
      let m: RegExpExecArray | null;
      CALL_RE.lastIndex = 0;
      while ((m = CALL_RE.exec(body)) !== null) {
        const name = m[1];
        if (NON_CALL_NAMES.has(name)) continue;
        if (name === sym.simpleName) continue; // skip recursion / self-signature noise
        callees.add(name);
      }
      for (const name of [...callees].sort()) {
        const targetId = resolve(fnNameToIds, fnIdToFile, name, fe.rel);
        if (targetId && targetId !== sym.id) {
          const w = fnIdToFile.get(targetId) === fe.rel ? 0.9 : 0.6;
          addEdge(edge(sym.id, targetId, "calls", w));
        }
      }
    }
  }

  return canonicalize({ nodes, edges });
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

/** The structural subset of a graph = nodes/edges this extractor stamped. */
export function structuralSubset(g: { nodes: GraphNode[]; edges: GraphEdge[] }): StructuralGraph {
  return canonicalize({
    nodes: g.nodes.filter((n) => (n as Record<string, unknown>).extractor === STRUCTURAL_EXTRACTOR),
    edges: g.edges.filter((e) => (e as Record<string, unknown>).extractor === STRUCTURAL_EXTRACTOR),
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
      const merged: GraphNode = { ...ex };
      if (merged.sp === undefined && s.sp !== undefined) merged.sp = s.sp;
      if (merged.language === undefined && (s as Record<string, unknown>).language !== undefined) {
        merged.language = (s as Record<string, unknown>).language;
      }
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
