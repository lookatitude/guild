/**
 * learn/lib/resolve-calls-ts.ts — LANE G2 accurate TS/JS call resolution.
 *
 * The ratified accurate backend: the in-process **TypeScript compiler API**
 * (`typescript`, already available via tsx/ts-jest — no wasm, no network, no new
 * heavy dep). Builds a `ts.Program` + type checker and resolves every
 * CallExpression to the declaration of its callee — following imports
 * (alias symbols) and method dispatch (property-access on a typed receiver) —
 * mapping the declaration back to a G1-consistent node id
 * (`function:<rel>:<name>` / `function:<rel>:<Class>.<method>`).
 *
 * Why type-aware beats G1's syntactic pass: a cross-file call `add()` imported
 * from "./b" resolves to `function:src/b.ts:add` even when another `add` exists
 * elsewhere (no name-collision mistakes); an unimported/external call
 * (`console.log`) resolves to no internal declaration and is reported as
 * dynamic rather than silently linked to a same-named local.
 *
 * Determinism: AST traversal order is fixed; output is deduped and sorted.
 * No model, no network.
 */

import * as ts from "typescript";
import * as path from "path";
import type { ResolvedCall } from "./resolved-call";

const TS_EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".mts", ".cts", ".mjs", ".cjs"]);

function toRel(repoRoot: string, abs: string): string {
  return path.relative(repoRoot, abs).replace(/\\/g, "/");
}

function relpathOf(nodeId: string): string {
  const parts = nodeId.split(":");
  return parts[0] === "file" ? parts.slice(1).join(":") : parts.slice(1, -1).join(":");
}

/**
 * FIX G2-4: load the repo's tsconfig `baseUrl` + `paths` so the compiler can
 * resolve alias imports (e.g. `@app/foo` → `src/foo`). Without these, an
 * alias-imported call's symbol never resolves to an internal declaration and the
 * edge vanishes (resolve-calls.ts drops the G1 syntactic edge for ts/js files).
 * Scoped to `<repoRoot>/tsconfig.json` ONLY (no upward walk) so the result stays
 * a pure function of the tree — deterministic and sandbox-safe. We pull ONLY
 * baseUrl/paths; the rest of the compiler options stay the safe, network-free,
 * @types-free defaults below.
 */
function aliasOptions(repoRoot: string): Pick<ts.CompilerOptions, "baseUrl" | "paths"> {
  const configPath = path.join(repoRoot, "tsconfig.json");
  if (!ts.sys.fileExists(configPath)) return {};
  const read = ts.readConfigFile(configPath, ts.sys.readFile);
  if (read.error || !read.config) return {};
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, path.dirname(configPath));
  const opts: Pick<ts.CompilerOptions, "baseUrl" | "paths"> = {};
  if (parsed.options.baseUrl) opts.baseUrl = parsed.options.baseUrl;
  if (parsed.options.paths) opts.paths = parsed.options.paths;
  return opts;
}

/** Map a declaration to a G1-consistent node id, or null if not a call target we model. */
function declToId(decl: ts.Declaration, rel: string): string | null {
  if (ts.isFunctionDeclaration(decl) && decl.name) {
    return `function:${rel}:${decl.name.text}`;
  }
  if (ts.isMethodDeclaration(decl) || ts.isGetAccessorDeclaration(decl) || ts.isSetAccessorDeclaration(decl)) {
    const cls = decl.parent;
    if ((ts.isClassDeclaration(cls) || ts.isClassExpression(cls)) && cls.name && ts.isIdentifier(decl.name)) {
      return `function:${rel}:${cls.name.text}.${decl.name.text}`;
    }
    return null;
  }
  // arrow / function-expression assigned to a top-level/local const
  if (ts.isVariableDeclaration(decl) && decl.name && ts.isIdentifier(decl.name) && decl.initializer) {
    if (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer)) {
      return `function:${rel}:${decl.name.text}`;
    }
  }
  return null;
}

/** Find the enclosing callable's node id for a node, or null if module-level. */
function enclosingId(node: ts.Node, rel: string): string | null {
  let p: ts.Node | undefined = node.parent;
  while (p) {
    if (ts.isFunctionDeclaration(p) && p.name) return `function:${rel}:${p.name.text}`;
    if (ts.isMethodDeclaration(p) || ts.isGetAccessorDeclaration(p) || ts.isSetAccessorDeclaration(p)) {
      const cls = p.parent;
      if ((ts.isClassDeclaration(cls) || ts.isClassExpression(cls)) && cls.name && ts.isIdentifier(p.name)) {
        return `function:${rel}:${cls.name.text}.${p.name.text}`;
      }
    }
    if (ts.isConstructorDeclaration(p)) {
      const cls = p.parent;
      if (ts.isClassDeclaration(cls) && cls.name) return `function:${rel}:${cls.name.text}.constructor`;
    }
    if ((ts.isArrowFunction(p) || ts.isFunctionExpression(p)) &&
        p.parent && ts.isVariableDeclaration(p.parent) && p.parent.name && ts.isIdentifier(p.parent.name)) {
      return `function:${rel}:${p.parent.name.text}`;
    }
    p = p.parent;
  }
  return null;
}

/**
 * Resolve all calls in the TS/JS subset of `relFiles` to G1-consistent node ids.
 * `index: off|on` is irrelevant here — resolution reads source via the compiler,
 * not the SQLite projection, so the result is identical in both modes.
 */
export function resolveTsCalls(repoRoot: string, relFiles: string[]): ResolvedCall[] {
  const tsRel = relFiles.filter((r) => TS_EXTS.has(path.extname(r).toLowerCase()));
  if (tsRel.length === 0) return [];
  const absFiles = tsRel.map((r) => path.resolve(repoRoot, r));
  const wanted = new Set(absFiles.map((a) => path.resolve(a)));

  const program = ts.createProgram(absFiles, {
    allowJs: true,
    noLib: true,
    skipLibCheck: true,
    types: [],
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: false,
    noEmit: true,
    // FIX G2-4: merge the repo tsconfig's baseUrl/paths so alias imports resolve.
    ...aliasOptions(repoRoot),
  });
  const checker = program.getTypeChecker();

  const out: ResolvedCall[] = [];
  const seen = new Set<string>();
  const push = (rc: ResolvedCall) => {
    // FIX G2-8: printable separator (was an embedded NUL → Git flagged the file
    // binary). Node ids never contain a space, so " " is a safe key delimiter.
    const k = `${rc.from} ${rc.to}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push(rc);
  };

  for (const sf of program.getSourceFiles()) {
    if (!wanted.has(path.resolve(sf.fileName))) continue;
    const rel = toRel(repoRoot, sf.fileName);

    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) handleCall(node, rel);
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }

  function handleCall(call: ts.CallExpression, rel: string): void {
    const callerId = enclosingId(call, rel);
    if (!callerId) return; // module-level call (no caller function node)

    let nameNode: ts.Node | undefined;
    let kind: ResolvedCall["kind"] = "function";
    if (ts.isIdentifier(call.expression)) {
      nameNode = call.expression;
      kind = "function";
    } else if (ts.isPropertyAccessExpression(call.expression)) {
      nameNode = call.expression.name;
      kind = "method";
    } else {
      return; // element-access / dynamic dispatch → no static target
    }

    let sym = checker.getSymbolAtLocation(nameNode);
    if (sym && sym.flags & ts.SymbolFlags.Alias) {
      try { sym = checker.getAliasedSymbol(sym); } catch { /* keep original */ }
    }
    if (!sym) return; // external/dynamic (e.g. console.log) — no internal node

    const decls = sym.getDeclarations() ?? [];
    let calleeId: string | null = null;
    for (const d of decls) {
      const dsf = d.getSourceFile();
      if (!wanted.has(path.resolve(dsf.fileName))) continue; // external decl
      calleeId = declToId(d, toRel(repoRoot, dsf.fileName));
      if (calleeId) break;
    }
    if (!calleeId || calleeId === callerId) return;

    const crossFile = relpathOf(callerId) !== relpathOf(calleeId);
    // Compiler-resolved internal targets are IDE-grade → high confidence.
    push({ from: callerId, to: calleeId, confidence: "high", crossFile, kind, backend: "ts-compiler" });
  }

  return out.sort((a, b) => (a.from + a.to < b.from + b.to ? -1 : a.from + a.to > b.from + b.to ? 1 : 0));
}
