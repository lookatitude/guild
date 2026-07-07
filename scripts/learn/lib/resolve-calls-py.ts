/**
 * learn/lib/resolve-calls-py.ts — LANE G2 import-aware Python call resolution.
 *
 * Python has no compiler API, so this is an **import-aware, scope-aware
 * symbol-table resolver** (goals.md G2): parse `from MOD import a, b as c` and
 * `import MOD`, resolve MOD → file (relative + dotted), then resolve each
 * in-function call to a top-level def — but ONLY with import or same-file
 * evidence that is VISIBLE at the call site:
 *   - bare `name()`     → high, when bound by `from … import name` to a def in the
 *                         target file, OR a same-file top-level def
 *   - qualified `m.fn()` → high, when receiver `m` is bound by `import m` (incl.
 *                         `import m as x` / dotted) to a file defining `fn`
 *
 * FIX G2-6: there is NO cross-file global-name fallback. A bare name without
 * import/same-file evidence is treated as external/dynamic (no edge) rather than
 * falsely linked to a same-named def in another file. Method calls on instances
 * (`obj.method()`) and builtins (`print`, `range`) likewise produce no edge.
 *
 * FIX G2-r2-4: import bindings are SCOPED, not file-wide. A module-level import
 * (indent 0) is visible everywhere in the file; an import nested inside a
 * function is visible ONLY within that function. A receiver/name shadowed by a
 * parameter or a local assignment in the enclosing callable is treated as a local
 * object and suppresses the import binding. This prevents a function-local
 * `import b` (or a local `b = …`) from falsely linking ANOTHER function's
 * `b.add()` cross-file. Deterministic, model-free, no network.
 *
 * FIX G2-r3: a nested import is bound to its LEXICAL owner (the innermost
 * enclosing `def`), not merely to a line range. Each import records the def line
 * of the callable that lexically owns it; an import is applied to a callable ONLY
 * when that callable IS its owner. So an `import b` inside an inner `def` (nested
 * within an outer function) does NOT leak into the outer function — its owner is
 * the inner def, not the outer callable, so the outer's `b.add()` stays unlinked.
 */

import * as path from "path";
import type { ResolvedCall } from "./resolved-call";

const PY_KEYWORDS = new Set([
  "if", "elif", "else", "for", "while", "return", "def", "class", "lambda",
  "and", "or", "not", "is", "in", "import", "from", "as", "with", "try",
  "except", "finally", "raise", "assert", "global", "nonlocal", "pass", "del",
  "yield", "await", "async", "print", "range", "len", "super",
]);

interface Callable {
  id: string;
  simpleName: string;
  start: number; // 1-indexed def (signature) line
  end: number;   // 1-indexed exclusive body bound (matches `enclosing` below)
}

/** A single binding introduced by an `import …` / `from … import …` statement. */
interface ImportClause {
  bindName: string;  // local receiver / binding name (alias-aware; dotted for `import a.b`)
  targetRel: string; // resolved repo-relative file
  realName: string;  // original symbol (from-import); "" for module-import
  kind: "from" | "module";
  line: number;      // 1-indexed line the statement appears on
  topLevel: boolean; // indent 0 → module scope (file-wide); else nested (local)
  ownerStart: number; // 1-indexed def line of the innermost enclosing callable;
                      // 0 = module scope (no enclosing def). FIX G2-r3.
}

interface PyFile {
  rel: string;
  lines: string[];
  topDefs: Map<string, Callable>; // name → top-level function
  callables: Callable[];          // top-level functions + methods
  importClauses: ImportClause[];  // every import binding, with line + scope
}

/** Resolved view of which import bindings + local shadows apply inside a callable. */
interface CallableScope {
  fromBindings: Map<string, { targetRel: string; realName: string }>;
  moduleBindings: Map<string, string>; // receiver name → module file
  shadowNames: Set<string>;            // names bound by params/locals (non-import)
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

const RE_DEF = /^(\s*)def\s+([A-Za-z_]\w*)/;
const RE_CLASS = /^(\s*)class\s+([A-Za-z_]\w*)/;
const RE_FROM = /^(\s*)from\s+(\.*)([\w.]*)\s+import\s+(.+)$/;
const RE_IMPORT = /^(\s*)import\s+(.+)$/;
// call names NOT preceded by '.' (excludes method calls) or a word char
const RE_CALL = /(?<![.\w])([A-Za-z_]\w*)\s*\(/g;
// FIX G2-5: qualified calls `receiver(.seg)*.method(` — receiver is a dotted
// path (`b`, `a.b`), method is the final attribute. Used to resolve module calls.
const RE_QUAL_CALL = /(?<![.\w])([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\.([A-Za-z_]\w*)\s*\(/g;

// Local-binding patterns (scanned against stripped source) — names these
// introduce SHADOW an equally-named import within the enclosing callable.
const RE_ASSIGN = /^\s*([A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)*)\s*(?::[^=]+)?=(?!=)/;
const RE_FOR = /^\s*for\s+([A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)*)\s+in\b/;
const RE_AS = /\bas\s+([A-Za-z_]\w*)/g;

/** Resolve a python module spec to a known repo-relative file, or null. */
function resolveModule(
  importerRel: string,
  dots: string,
  modulePath: string,
  fileSet: Set<string>,
): string | null {
  const segs = modulePath ? modulePath.split(".").filter(Boolean) : [];
  const candidates: string[] = [];

  if (dots.length > 0) {
    // relative import: each dot beyond the first walks up a directory
    let base = path.posix.dirname(importerRel);
    for (let i = 1; i < dots.length; i++) base = path.posix.dirname(base);
    const joined = [base, ...segs].filter((p) => p && p !== ".").join("/");
    candidates.push(`${joined}.py`, `${joined}/__init__.py`);
  } else {
    const dir = path.posix.dirname(importerRel);
    const joined = segs.join("/");
    // relative to importer dir, then repo root
    candidates.push(
      path.posix.join(dir, `${joined}.py`),
      path.posix.join(dir, joined, "__init__.py"),
      `${joined}.py`,
      `${joined}/__init__.py`,
    );
  }
  for (const c of candidates) {
    const norm = c.replace(/^\.\//, "");
    if (fileSet.has(norm)) return norm;
  }
  return null;
}

function parsePyFile(rel: string, content: string, fileSet: Set<string>): PyFile {
  const lines = content.split("\n");
  const topDefs = new Map<string, Callable>();
  const callables: Callable[] = [];
  const importClauses: ImportClause[] = [];

  // FIX G2-r3: every `def` block (ANY nesting depth) with its body range, used to
  // attribute each import to the innermost enclosing callable that lexically owns
  // it. `start`/`end` match the callable convention (start = 1-indexed def line;
  // end = indentEnd exclusive bound) so `ownerOf` aligns with `enclosing` below.
  const defBlocks: Array<{ start: number; end: number }> = [];
  for (let i = 0; i < lines.length; i++) {
    if (RE_DEF.test(lines[i])) defBlocks.push({ start: i + 1, end: indentEnd(lines, i) });
  }
  // Innermost (deepest-starting) def whose body contains `line1`; 0 = module scope.
  const ownerOf = (line1: number): number => {
    let owner = 0;
    for (const b of defBlocks) {
      if (b.start <= line1 && line1 < b.end && b.start > owner) owner = b.start;
    }
    return owner;
  };

  // Imports are collected on a FULL pass (so nested imports are captured with
  // their line + indent), independent of the def/class walk below.
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const mFrom = line.match(RE_FROM);
    if (mFrom) {
      const indent = mFrom[1]?.length ?? 0;
      const targetRel = resolveModule(rel, mFrom[2], mFrom[3], fileSet);
      if (targetRel) {
        for (const part of mFrom[4].replace(/[()]/g, "").split(",")) {
          const seg = part.trim();
          if (!seg || seg === "*") continue;
          const [orig, alias] = seg.split(/\s+as\s+/).map((s) => s.trim());
          if (!/^[A-Za-z_]\w*$/.test(orig)) continue;
          importClauses.push({
            bindName: alias || orig,
            targetRel,
            realName: orig,
            kind: "from",
            line: i + 1,
            topLevel: indent === 0,
            ownerStart: ownerOf(i + 1),
          });
        }
      }
      continue;
    }
    const mImport = line.match(RE_IMPORT);
    if (mImport && !/^\s*import\s+\(/.test(line)) {
      const indent = mImport[1]?.length ?? 0;
      // `import b`, `import b as c`, `import a.b as c`, `import a.b`, comma lists.
      // The receiver bound in code is the alias when present, else the FULL dotted
      // module path (`import a.b` is referenced as `a.b.x`).
      for (const clause of mImport[2].split(",")) {
        const seg = clause.trim();
        if (!seg) continue;
        const [modRaw, aliasRaw] = seg.split(/\s+as\s+/).map((s) => s.trim());
        if (!/^[A-Za-z_][\w.]*$/.test(modRaw)) continue;
        const targetRel = resolveModule(rel, "", modRaw, fileSet);
        if (!targetRel) continue;
        const receiver = aliasRaw && /^[A-Za-z_]\w*$/.test(aliasRaw) ? aliasRaw : modRaw;
        importClauses.push({
          bindName: receiver,
          targetRel,
          realName: "",
          kind: "module",
          line: i + 1,
          topLevel: indent === 0,
          ownerStart: ownerOf(i + 1),
        });
      }
      continue;
    }
  }

  // Def/class walk: top-level functions + class methods → callables.
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const mClass = line.match(RE_CLASS);
    if (mClass && (mClass[1]?.length ?? 0) === 0) {
      const clsName = mClass[2];
      const end = indentEnd(lines, i);
      for (let j = i + 1; j < end; j++) {
        const mm = lines[j].match(RE_DEF);
        if (!mm) continue;
        const mEnd = indentEnd(lines, j);
        callables.push({
          id: `function:${rel}:${clsName}.${mm[2]}`,
          simpleName: mm[2],
          start: j + 1,
          end: mEnd,
        });
        j = mEnd - 1;
      }
      i = end - 1;
      continue;
    }

    const mDef = line.match(RE_DEF);
    if (mDef && (mDef[1]?.length ?? 0) === 0) {
      const end = indentEnd(lines, i);
      const c: Callable = { id: `function:${rel}:${mDef[2]}`, simpleName: mDef[2], start: i + 1, end };
      topDefs.set(mDef[2], c);
      callables.push(c);
      i = end - 1;
    }
  }

  return { rel, lines, topDefs, callables, importClauses };
}

/** Split a comma-separated list at TOP-LEVEL commas only (parens/brackets aware). */
function splitTopLevel(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of s) {
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") depth--;
    if (ch === "," && depth === 0) { out.push(cur); cur = ""; continue; }
    cur += ch;
  }
  if (cur.trim() !== "") out.push(cur);
  return out;
}

/** Parameter names of the def whose signature starts at 0-indexed `defIdx`. */
function parseParams(lines: string[], defIdx: number): string[] {
  let text = "";
  let depth = 0;
  let started = false;
  outer: for (let k = defIdx; k < lines.length; k++) {
    for (const ch of lines[k]) {
      if (ch === "(") { depth++; started = true; if (depth === 1) continue; }
      else if (ch === ")") { depth--; if (depth === 0) break outer; }
      if (started && depth >= 1) text += ch;
    }
    text += " ";
    if (started && depth <= 0) break;
  }
  const names: string[] = [];
  for (const part of splitTopLevel(text)) {
    const seg = part.trim().replace(/^\*+/, "");
    const m = seg.match(/^([A-Za-z_]\w*)/);
    if (m) names.push(m[1]);
  }
  return names;
}

/**
 * Compute the import bindings + local shadows visible inside one callable:
 *   - module-level imports (file-wide) MINUS names shadowed by params/locals,
 *   - then within-callable imports OVERRIDE (a local `import b` wins),
 *   - shadowNames = params + local assignment/for/with/nested-def targets that
 *     are NOT themselves import bindings (those locals shadow same-named imports).
 */
function computeScope(f: PyFile, c: Callable): CallableScope {
  // Import clauses lexically OWNED by this callable (FIX G2-r3): the import's
  // innermost enclosing def IS this callable — NOT a nested inner def inside it,
  // and NOT merely a line within the body range. This stops an `import b` nested
  // in an inner `def` from leaking into the outer callable's calls.
  const localFrom = new Map<string, { targetRel: string; realName: string }>();
  const localModule = new Map<string, string>();
  const localImportNames = new Set<string>();
  for (const cl of f.importClauses) {
    if (cl.ownerStart !== c.start) continue;
    localImportNames.add(cl.bindName);
    if (cl.kind === "from") localFrom.set(cl.bindName, { targetRel: cl.targetRel, realName: cl.realName });
    else localModule.set(cl.bindName, cl.targetRel);
  }

  // Local non-import bindings (params + assignment/for/with/nested-def targets).
  const shadowRaw = new Set<string>(parseParams(f.lines, c.start - 1));
  for (let k = c.start; k < c.end - 1 && k < f.lines.length; k++) {
    const raw = stripPy(f.lines[k]);
    const mAssign = raw.match(RE_ASSIGN);
    if (mAssign) for (const n of mAssign[1].split(",")) shadowRaw.add(n.trim());
    const mFor = raw.match(RE_FOR);
    if (mFor) for (const n of mFor[1].split(",")) shadowRaw.add(n.trim());
    let mAs: RegExpExecArray | null;
    RE_AS.lastIndex = 0;
    while ((mAs = RE_AS.exec(raw)) !== null) shadowRaw.add(mAs[1]);
    const mDef = raw.match(RE_DEF);
    if (mDef) shadowRaw.add(mDef[2]);
    const mCls = raw.match(RE_CLASS);
    if (mCls) shadowRaw.add(mCls[2]);
  }
  // An import binding is not a shadow — it IS the binding for that name.
  const shadowNames = new Set([...shadowRaw].filter((n) => n && !localImportNames.has(n)));

  const fromBindings = new Map<string, { targetRel: string; realName: string }>();
  const moduleBindings = new Map<string, string>();
  for (const cl of f.importClauses) {
    if (!cl.topLevel) continue;
    if (shadowNames.has(cl.bindName)) continue; // param/local shadows the import
    if (cl.kind === "from") fromBindings.set(cl.bindName, { targetRel: cl.targetRel, realName: cl.realName });
    else moduleBindings.set(cl.bindName, cl.targetRel);
  }
  // within-callable imports win over file-wide + shadow.
  for (const [name, fr] of localFrom) fromBindings.set(name, fr);
  for (const [name, t] of localModule) moduleBindings.set(name, t);

  return { fromBindings, moduleBindings, shadowNames };
}

/**
 * Resolve all calls in the Python subset of `relFiles` to G1-consistent node ids.
 * `readFile(abs)` is injected for testability; resolution is index-independent.
 */
export function resolvePyCalls(
  repoRoot: string,
  relFiles: string[],
  readFile: (abs: string) => string,
): ResolvedCall[] {
  const pyRel = relFiles.filter((r) => r.toLowerCase().endsWith(".py"));
  if (pyRel.length === 0) return [];
  const fileSet = new Set(pyRel.map((r) => r.replace(/\\/g, "/")));

  const files: PyFile[] = [];
  for (const rel of pyRel) {
    let content: string;
    try { content = readFile(`${repoRoot}/${rel}`); } catch { continue; }
    files.push(parsePyFile(rel.replace(/\\/g, "/"), content, fileSet));
  }

  const out: ResolvedCall[] = [];
  const seen = new Set<string>();
  const push = (rc: ResolvedCall) => {
    const k = `${rc.from} ${rc.to}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push(rc);
  };

  for (const f of files) {
    // sort callables innermost-last so the LAST covering range wins (methods inside classes)
    const ranges = [...f.callables].sort((a, b) => a.start - b.start);
    const enclosing = (line1: number): Callable | null => {
      let best: Callable | null = null;
      for (const c of ranges) {
        if (c.start <= line1 && line1 < c.end) {
          if (!best || c.start > best.start) best = c;
        }
      }
      return best;
    };

    // Per-callable visible bindings + shadows (FIX G2-r2-4).
    const scopeByCallable = new Map<string, CallableScope>();
    for (const c of f.callables) scopeByCallable.set(c.id, computeScope(f, c));

    for (let i = 0; i < f.lines.length; i++) {
      const line1 = i + 1;
      const caller = enclosing(line1);
      if (!caller) continue;
      const scope = scopeByCallable.get(caller.id)!;
      const codeLine = stripPy(f.lines[i]);

      // ── Bare-name calls: `add(...)` ──────────────────────────────────────
      let m: RegExpExecArray | null;
      RE_CALL.lastIndex = 0;
      while ((m = RE_CALL.exec(codeLine)) !== null) {
        const name = m[1];
        if (PY_KEYWORDS.has(name)) continue;
        if (name === caller.simpleName) continue; // skip recursion/self

        // 1) import-bound name (`from MOD import name`) visible here → target def
        const imp = scope.fromBindings.get(name);
        if (imp) {
          const tf = files.find((x) => x.rel === imp.targetRel);
          if (tf && tf.topDefs.has(imp.realName)) {
            const to = `function:${imp.targetRel}:${imp.realName}`;
            if (to !== caller.id) {
              push({ from: caller.id, to, confidence: "high", crossFile: imp.targetRel !== f.rel, kind: "function", backend: "py-imports" });
            }
          }
          continue;
        }
        // 2) same-file top-level def — unless a param/local shadows the name
        if (!scope.shadowNames.has(name) && f.topDefs.has(name)) {
          const to = `function:${f.rel}:${name}`;
          if (to !== caller.id) {
            push({ from: caller.id, to, confidence: "high", crossFile: false, kind: "function", backend: "py-imports" });
          }
          continue;
        }
        // FIX G2-6: NO cross-file global fallback for an unbound bare name.
      }

      // ── Qualified module calls: `b.add(...)`, `a.b.add(...)` ─────────────
      RE_QUAL_CALL.lastIndex = 0;
      while ((m = RE_QUAL_CALL.exec(codeLine)) !== null) {
        const receiver = m[1];
        const method = m[2];
        // A param/local shadowing the receiver ROOT makes this attribute access on
        // a local object, NOT a module call (FIX G2-r2-4).
        if (scope.shadowNames.has(receiver.split(".")[0])) continue;
        const targetRel = scope.moduleBindings.get(receiver);
        if (!targetRel) continue; // receiver is a local object / unimported → skip
        const tf = files.find((x) => x.rel === targetRel);
        if (!tf || !tf.topDefs.has(method)) continue; // attribute is not a top-level def
        const to = `function:${targetRel}:${method}`;
        if (to !== caller.id) {
          push({ from: caller.id, to, confidence: "high", crossFile: targetRel !== f.rel, kind: "function", backend: "py-imports" });
        }
      }
    }
  }

  return out.sort((a, b) => (a.from + a.to < b.from + b.to ? -1 : a.from + a.to > b.from + b.to ? 1 : 0));
}

/** Strip strings + `#` comments so braces/hashes in literals don't skew call detection. */
function stripPy(line: string): string {
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
    if (ch === '"' || ch === "'") { quote = ch; i++; continue; }
    if (ch === "#") break;
    out += ch;
    i++;
  }
  return out;
}
