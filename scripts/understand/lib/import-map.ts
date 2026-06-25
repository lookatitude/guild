/**
 * understand/lib/import-map.ts
 *
 * Deterministic per-language import-map resolver (stage 1 SCRIPT phase).
 * Forked Guild-native from Understand-Anything's import resolution (MIT —
 * see ../LICENSE-attribution.md). Resolves:
 *   - JS/TS relative + extension + /index resolution
 *   - tsconfig.json `compilerOptions.paths` aliases (kind: "alias")
 *   - Python absolute/relative module → file (best effort)
 * Anything unresolvable is dropped (no dangling edges into the CodebaseMap).
 */

import * as fs from "fs";
import * as path from "path";
import { analyzeSource } from "./extract";
import { detectLanguage } from "./languages";

export interface ImportEdge {
  from: string; // repo-relative
  to: string; // repo-relative
  kind: "static" | "dynamic" | "alias";
}

const JS_EXTS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];

function fileExists(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/** Resolve a JS/TS module specifier relative to importer; null if external. */
function resolveJs(
  importerAbs: string,
  spec: string,
  repoRoot: string,
  aliases: Array<{ prefix: string; targets: string[] }>,
): { abs: string; kind: ImportEdge["kind"] } | null {
  let baseDir: string | null = null;
  let kind: ImportEdge["kind"] = "static";

  if (spec.startsWith(".")) {
    baseDir = path.dirname(importerAbs);
  } else {
    // Try tsconfig path aliases.
    for (const a of aliases) {
      const star = a.prefix.endsWith("*");
      const pfx = star ? a.prefix.slice(0, -1) : a.prefix;
      if (star ? spec.startsWith(pfx) : spec === a.prefix) {
        const rest = star ? spec.slice(pfx.length) : "";
        for (const t of a.targets) {
          const tt = t.endsWith("*") ? t.slice(0, -1) : t;
          const cand = path.resolve(repoRoot, tt + rest);
          const hit = resolveJsFile(cand);
          if (hit) return { abs: hit, kind: "alias" };
        }
      }
    }
    return null; // bare specifier → external package
  }

  const target = path.resolve(baseDir, spec);
  const hit = resolveJsFile(target);
  return hit ? { abs: hit, kind } : null;
}

function resolveJsFile(target: string): string | null {
  if (fileExists(target)) return target;
  for (const e of JS_EXTS) if (fileExists(target + e)) return target + e;
  for (const e of JS_EXTS) {
    const idx = path.join(target, "index" + e);
    if (fileExists(idx)) return idx;
  }
  return null;
}

function loadTsAliases(repoRoot: string): Array<{ prefix: string; targets: string[] }> {
  const tsconfigPath = path.join(repoRoot, "tsconfig.json");
  try {
    const raw = fs
      .readFileSync(tsconfigPath, "utf8")
      .replace(/\/\/.*$/gm, "")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    const cfg = JSON.parse(raw);
    const co = cfg.compilerOptions ?? {};
    const baseUrl = co.baseUrl ?? ".";
    const paths = co.paths ?? {};
    const out: Array<{ prefix: string; targets: string[] }> = [];
    for (const [k, v] of Object.entries(paths)) {
      out.push({
        prefix: k,
        targets: (v as string[]).map((t) => path.join(baseUrl, t)),
      });
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Build the import-map edge list for a set of repo-relative code files.
 * `readFile` is injected for testability; defaults to fs.
 */
export function buildImportMap(
  repoRoot: string,
  relFiles: string[],
  readFile: (abs: string) => string = (a) => fs.readFileSync(a, "utf8"),
): ImportEdge[] {
  const aliases = loadTsAliases(repoRoot);
  const known = new Set(relFiles.map((f) => f.replace(/\\/g, "/")));
  const edges: ImportEdge[] = [];
  const seen = new Set<string>();

  for (const rel of relFiles) {
    const lang = detectLanguage(rel);
    if (lang !== "typescript" && lang !== "javascript" && lang !== "python") continue;
    const abs = path.join(repoRoot, rel);
    let content: string;
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
        const toRel = path.relative(repoRoot, r.abs).replace(/\\/g, "/");
        if (known.has(toRel)) pushEdge(edges, seen, rel, toRel, r.kind);
      }
    }
  }
  return edges;
}

function resolvePython(
  importerRel: string,
  spec: string,
  known: Set<string>,
): string | null {
  const bases: string[] = [];
  if (spec.startsWith(".")) {
    // Relative ("from .x import y") — walk up per dot, then descend.
    const up = spec.match(/^\.+/)?.[0].length ?? 1;
    let dir = path.dirname(importerRel);
    for (let i = 1; i < up; i++) dir = path.dirname(dir);
    bases.push(path.join(dir, spec.replace(/^\.+/, "").replace(/\./g, "/")));
  } else {
    const sub = spec.replace(/\./g, "/");
    // Absolute ("pkg.mod") — try BOTH importer-dir-relative (sibling/script-style
    // imports where the package dir is on sys.path) AND repo-root-relative.
    bases.push(path.join(path.dirname(importerRel), sub));
    bases.push(sub);
  }
  const cands = bases
    .flatMap((base) => [base + ".py", path.join(base, "__init__.py")])
    .map((p) => p.replace(/\\/g, "/").replace(/^\.\//, ""));
  return cands.find((c) => known.has(c)) ?? null;
}

function pushEdge(
  edges: ImportEdge[],
  seen: Set<string>,
  from: string,
  to: string | null,
  kind: ImportEdge["kind"],
): void {
  if (!to || to === from) return;
  const key = `${from}|${to}|${kind}`;
  if (seen.has(key)) return;
  seen.add(key);
  edges.push({ from: from.replace(/\\/g, "/"), to, kind });
}
