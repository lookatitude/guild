/**
 * understand/lib/resolve-calls-py.ts — LANE G2 import-aware Python call resolution.
 *
 * Python has no compiler API, so this is an **import-aware symbol-table
 * resolver** (goals.md G2): parse `from MOD import a, b as c` and `import MOD`,
 * resolve MOD → file (relative + dotted), then resolve each in-function call to a
 * top-level def — but ONLY with import or same-file evidence:
 *   - bare `name()`     → high, when bound by `from … import name` to a def in the
 *                         target file, OR a same-file top-level def
 *   - qualified `m.fn()` → high, when receiver `m` is bound by `import m` (incl.
 *                         `import m as x` / dotted) to a file defining `fn`
 *
 * FIX G2-6: there is NO cross-file global-name fallback. A bare name without
 * import/same-file evidence is treated as external/dynamic (no edge) rather than
 * falsely linked to a same-named def in another file. Method calls on instances
 * (`obj.method()`) and builtins (`print`, `range`) likewise produce no edge.
 * Deterministic, model-free, no network.
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
  start: number; // 1-indexed first body-eligible line (def line)
  end: number;   // 1-indexed exclusive
}

interface ImportBinding {
  targetRel: string; // resolved file
  realName: string;  // original symbol name (handles `import x as y`)
}

interface PyFile {
  rel: string;
  lines: string[];
  topDefs: Map<string, Callable>;     // name → top-level function
  callables: Callable[];              // top-level functions + methods
  imports: Map<string, ImportBinding>; // local binding name → resolved import (from … import)
  moduleImports: Map<string, string>; // local receiver name → resolved module file (import …)
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
const RE_FROM = /^\s*from\s+(\.*)([\w.]*)\s+import\s+(.+)$/;
const RE_IMPORT = /^\s*import\s+(.+)$/;
// call names NOT preceded by '.' (excludes method calls) or a word char
const RE_CALL = /(?<![.\w])([A-Za-z_]\w*)\s*\(/g;
// FIX G2-5: qualified calls `receiver(.seg)*.method(` — receiver is a dotted
// path (`b`, `a.b`), method is the final attribute. Used to resolve module calls.
const RE_QUAL_CALL = /(?<![.\w])([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\.([A-Za-z_]\w*)\s*\(/g;

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
  const imports = new Map<string, ImportBinding>();
  const moduleImports = new Map<string, string>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const mFrom = line.match(RE_FROM);
    if (mFrom) {
      const targetRel = resolveModule(rel, mFrom[1], mFrom[2], fileSet);
      if (targetRel) {
        // `a, b as c, *` → bindings
        for (const part of mFrom[3].replace(/[()]/g, "").split(",")) {
          const seg = part.trim();
          if (!seg || seg === "*") continue;
          const [orig, alias] = seg.split(/\s+as\s+/).map((s) => s.trim());
          if (!/^[A-Za-z_]\w*$/.test(orig)) continue;
          imports.set(alias || orig, { targetRel, realName: orig });
        }
      }
      continue;
    }
    const mImport = !mFrom ? line.match(RE_IMPORT) : null;
    if (mImport && !/^\s*import\s+\(/.test(line)) {
      // FIX G2-5: `import b`, `import b as c`, `import a.b as c`, `import a.b`,
      // and comma lists. Record receiver-name → resolved module file so qualified
      // calls (`b.add()`, `c.add()`, `a.b.add()`) resolve. The receiver bound in
      // code is the alias when present, else the FULL dotted module path
      // (`import a.b` is referenced as `a.b.x`).
      for (const clause of mImport[1].split(",")) {
        const seg = clause.trim();
        if (!seg) continue;
        const [modRaw, aliasRaw] = seg.split(/\s+as\s+/).map((s) => s.trim());
        if (!/^[A-Za-z_][\w.]*$/.test(modRaw)) continue;
        const targetRel = resolveModule(rel, "", modRaw, fileSet);
        if (!targetRel) continue;
        const receiver = aliasRaw && /^[A-Za-z_]\w*$/.test(aliasRaw) ? aliasRaw : modRaw;
        moduleImports.set(receiver, targetRel);
      }
      continue;
    }

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

  return { rel, lines, topDefs, callables, imports, moduleImports };
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

    for (let i = 0; i < f.lines.length; i++) {
      const line1 = i + 1;
      const caller = enclosing(line1);
      if (!caller) continue;
      const codeLine = stripPy(f.lines[i]);

      // ── Bare-name calls: `add(...)` ──────────────────────────────────────
      let m: RegExpExecArray | null;
      RE_CALL.lastIndex = 0;
      while ((m = RE_CALL.exec(codeLine)) !== null) {
        const name = m[1];
        if (PY_KEYWORDS.has(name)) continue;
        if (name === caller.simpleName) continue; // skip recursion/self

        // 1) import-bound name (`from MOD import name`) → target file's def
        const imp = f.imports.get(name);
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
        // 2) same-file top-level def
        if (f.topDefs.has(name)) {
          const to = `function:${f.rel}:${name}`;
          if (to !== caller.id) {
            push({ from: caller.id, to, confidence: "high", crossFile: false, kind: "function", backend: "py-imports" });
          }
          continue;
        }
        // FIX G2-6: NO cross-file global fallback. A bare name with no import and
        // no same-file def is external/builtin/dynamic — resolving it to a unique
        // (or lexicographically-picked) def in ANOTHER file falsely links an
        // unimported name across files. Leave it unresolved (reported as dynamic).
      }

      // ── Qualified module calls: `b.add(...)`, `a.b.add(...)` ─────────────
      // FIX G2-5: resolve `import b; b.add()` (and aliased / dotted variants) by
      // matching the receiver against the module-import bindings.
      RE_QUAL_CALL.lastIndex = 0;
      while ((m = RE_QUAL_CALL.exec(codeLine)) !== null) {
        const receiver = m[1];
        const method = m[2];
        const targetRel = f.moduleImports.get(receiver);
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
