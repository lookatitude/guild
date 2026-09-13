#!/usr/bin/env node
/**
 * layout-laws — the U1 grep set of the plugin layout reshape (architecture rev 20).
 *
 * Canonical rules: AGENTS.md §"Layout laws" (KTD1-KTD70) and the operator-locked
 * source at .guild/artifacts/reports/plugin-layout-implementation-plan.html §U1.
 *
 * Runs on Bun (`bun run lint:layout`), on tsx, and on plain Node after compile.
 *
 *   npm run lint:layout                 # baseline applied; exit 0 when no regression
 *   npm run lint:layout -- --no-baseline# raw truth; exits non-zero on the current tree
 *   npm run lint:layout -- --fixtures   # anti-vacuity: every check flags its fixture
 *   npm run lint:layout -- --write-baseline
 *   npm run lint:layout -- --root=<dir> [--check=<id>] [--json]
 *
 * SCOPE, by design: the entry guards are RAW-TEXT rules. A file that builds the
 * string ".guild" by concatenation evades them, and `overlay-cannot-drop-required-nodes`
 * executes the validator it finds. These are KTD regression guards for a repo we
 * control -- not a sandbox, not a security boundary, and not safe against hostile code.
 *
 * Baseline semantics (T01 -> T16): scripts/lint/layout-baseline.json enumerates every
 * violation present on the tree at the start of the reshape. A later lane may only
 * REMOVE entries. A violation whose key is absent from the baseline is a regression
 * and fails the run. T16 deletes the baseline file.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as ts from "typescript";

// ---------------------------------------------------------------- locked lists
// Not editable by a lane. Changing either list requires operator confirmation.
const COMMAND_NAMES_13 = [
  "guild", "init", "ideate", "plan", "build", "qa", "ops",
  "learn", "wiki", "initiative", "config", "status", "maintain",
];
const ASSEMBLER_NAMES_17 = [
  "using-guild", "init", "brainstorm", "plan", "team-compose", "execute-plan",
  "quality", "operations", "learn", "wiki", "initiative", "review", "diagnose",
  "evolve", "create-skill", "create-specialist", "reflect",
];
const MACHINERY_AGENTS_4 = ["team-lead", "context-manager", "advisor", "developer"];
const WORKFLOW_CLASSES_5 = ["product", "research", "debug", "ops", "init"];

// ---------------------------------------------------------------- tiny fs utils
const IGNORED_DIRS = new Set([
  "node_modules", ".git", "dist", "build", ".worktrees", "coverage", ".guild",
]);

function exists(p: string): boolean {
  try { fs.statSync(p); return true; } catch { return false; }
}

function isDir(p: string): boolean {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
}

function read(p: string): string {
  try { return fs.readFileSync(p, "utf8"); } catch { return ""; }
}

/** Recursive file walk, repo-relative POSIX paths, deterministic order. */
function walk(root: string, rel = "", out: string[] = []): string[] {
  const abs = path.join(root, rel);
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(abs, { withFileTypes: true }); } catch { return out; }
  for (const e of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) {
      if (IGNORED_DIRS.has(e.name)) continue;
      walk(root, r, out);
    } else if (e.isFile()) {
      out.push(r);
    }
  }
  return out;
}

function walkDirs(root: string, rel = "", out: string[] = []): string[] {
  const abs = path.join(root, rel);
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(abs, { withFileTypes: true }); } catch { return out; }
  for (const e of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (!e.isDirectory() || IGNORED_DIRS.has(e.name)) continue;
    const r = rel ? `${rel}/${e.name}` : e.name;
    out.push(r);
    walkDirs(root, r, out);
  }
  return out;
}

/** Lint fixtures live under scripts/lint/__tests__/fixtures and are never linted. */
function isFixturePath(f: string): boolean {
  const live = liveOf(f);
  return live.includes("__tests__/fixtures/") || live.includes("__fixtures__/") ||
    live.includes("/fixtures/");
}

/**
 * A module-resource mirror: `src/modules/<mod>/resources/<live path>`, written by
 * `sync:module-resources` from the live file and never hand-edited (AGENTS.md).
 */
const MODULE_RESOURCE_MIRROR_RE = /^src\/modules\/[^/]+\/resources\//;

function isModuleResourceMirror(f: string): boolean {
  return MODULE_RESOURCE_MIRROR_RE.test(f);
}

/**
 * The LIVE path a file is classified as. A mirror is byte-identical to its live
 * file, so every text-reading check must reach the same verdict for both — a rule
 * that holds for `scripts/foo.ts` and not for its mirror is a lint bug, not a
 * finding. Non-mirror paths are returned unchanged.
 *
 * Use this for EXEMPTION and CLASSIFICATION only. It deliberately does NOT change
 * which prefixes a check scans: violations stay reported at the path they were
 * found, so the baseline keys stay stable.
 */
function liveOf(f: string): string {
  return f.replace(MODULE_RESOURCE_MIRROR_RE, "");
}

/**
 * The lint tooling's own source names every forbidden pattern it greps for, so it
 * must never be its own subject. Resolved through `liveOf` so the live file and
 * every mirror of it get the identical verdict, at any mirror depth or future
 * mirror home. (T02: without this, `lint:layout` is red on a clean tree for the
 * lint's own text — 12 open, all mirror-only.)
 */
function isLayoutLawsSource(f: string): boolean {
  return liveOf(f).startsWith("scripts/lint/");
}

function under(files: string[], ...prefixes: string[]): string[] {
  return files.filter((f) => prefixes.some((p) => f === p || f.startsWith(p)));
}

function readJson(p: string): any {
  const raw = read(p);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

// ---------------------------------------------------------------- model types
interface Violation { check: string; path: string; detail: string; }
interface Check {
  id: string;
  ktd: string;
  title: string;
  run(ctx: Ctx): Violation[] | Promise<Violation[]>;
}
interface Ctx {
  root: string;
  files: string[];
  dirs: string[];
  manifest: any;
}

function key(v: Violation): string { return `${v.check}::${v.path}::${v.detail}`; }

// ------------------------------------------------------------------ TS analysis
// Guard checks must see a real CALL SITE, never a token that happens to appear in a
// comment or a string. Everything below parses with the TypeScript compiler API
// (typescript is already a devDependency of scripts/).

const AST_CACHE = new Map<string, ts.SourceFile | null>();

function parse(root: string, rel: string): ts.SourceFile | null {
  const k = `${root}::${rel}`;
  if (AST_CACHE.has(k)) return AST_CACHE.get(k)!;
  let sf: ts.SourceFile | null = null;
  const text = read(path.join(root, rel));
  if (text) {
    // Committed compile outputs are JavaScript; parse them in JS mode so the same
    // guards apply to the graph users actually run (KTD7).
    const kind = /\.(js|mjs|cjs)$/.test(rel) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
    try {
      sf = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, kind);
    } catch { sf = null; }
  }
  AST_CACHE.set(k, sf);
  return sf;
}

function eachNode(node: ts.Node, fn: (n: ts.Node) => void): void {
  fn(node);
  node.forEachChild((c) => eachNode(c, fn));
}

/** The callee name of a CallExpression: `f()` -> "f", `a.b.f()` -> "f". */
function calleeName(n: ts.CallExpression): string | null {
  const e = n.expression;
  if (ts.isIdentifier(e)) return e.text;
  if (ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.name)) return e.name.text;
  return null;
}

/** True only when `name` appears as an actual invoked callee in this file. */
function hasCallTo(root: string, rel: string, name: string): boolean {
  const sf = parse(root, rel);
  if (!sf) return false;
  let found = false;
  eachNode(sf, (n) => {
    if (found) return;
    if (ts.isCallExpression(n) && calleeName(n) === name) found = true;
  });
  return found;
}

// ------------------------------------------------------------------ shell lexer
// A quote- and heredoc-aware lexer. `echo "; ensureStorageLayout"` and a heredoc body
// mentioning the name are NOT invocations; only a bare word in command position is.

interface ShWord { text: string; quoted: boolean; }
interface ShCommand { words: ShWord[]; redirects: ShWord[]; index: number; }

const SH_KEYWORDS = new Set(["then", "do", "else", "elif", "fi", "done", "in", "{", "}", "!"]);

/** Split a shell script into commands, honouring quotes, escapes, heredocs, comments. */
function lexShell(text: string): ShCommand[] {
  const cmds: ShCommand[] = [];
  let words: ShWord[] = [];
  let redirects: ShWord[] = [];
  let buf = "";
  let quoted = false;
  let started = false;
  let index = 0;
  let pendingRedirect = false;
  const heredocQueue: Array<{ tag: string; strip: boolean }> = [];

  const flushWord = () => {
    if (!started) return;
    (pendingRedirect ? redirects : words).push({ text: buf, quoted });
    pendingRedirect = false;
    buf = ""; quoted = false; started = false;
  };
  const flushCmd = () => {
    flushWord();
    if (words.length || redirects.length) cmds.push({ words, redirects, index: index++ });
    words = []; redirects = [];
  };

  const lines = text.split("\n");
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    // Consume any heredoc bodies opened on the previous line: their contents are data.
    if (heredocQueue.length) {
      const h = heredocQueue[0];
      const probe = h.strip ? line.replace(/^\t+/, "") : line;
      if (probe.trim() === h.tag) heredocQueue.shift();
      continue;
    }
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === "\\") { buf += line[++i] ?? ""; started = true; continue; }
      if (ch === "'") {
        const end = line.indexOf("'", i + 1);
        buf += end === -1 ? line.slice(i + 1) : line.slice(i + 1, end);
        quoted = true; started = true;
        i = end === -1 ? line.length : end;
        continue;
      }
      if (ch === '"') {
        let j = i + 1; let acc = "";
        while (j < line.length && line[j] !== '"') {
          if (line[j] === "\\") { acc += line[++j] ?? ""; j++; continue; }
          acc += line[j++];
        }
        buf += acc; quoted = true; started = true; i = j;
        continue;
      }
      if (ch === "#" && !started) { i = line.length; break; }
      if (ch === "<" && line[i + 1] === "<") {
        let j = i + 2; let strip = false;
        if (line[j] === "-") { strip = true; j++; }
        if (line[j] === "<") { i = j; continue; } // here-string `<<<`
        const m = line.slice(j).match(/^\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/);
        if (m) { heredocQueue.push({ tag: m[2], strip }); i = j + m[0].length - 1; flushWord(); continue; }
        i = j - 1; continue;
      }
      if (ch === ">" || ch === "<") {
        flushWord();
        pendingRedirect = ch === ">";
        if (line[i + 1] === ">") i++;
        continue;
      }
      if (ch === "&" && line[i + 1] === "&") { flushCmd(); i++; continue; }
      if (ch === "|" && line[i + 1] === "|") { flushCmd(); i++; continue; }
      if (ch === "|" || ch === ";" || ch === "(" || ch === ")" || ch === "`") { flushCmd(); continue; }
      if (ch === "$" && line[i + 1] === "(") { flushCmd(); i++; continue; }
      if (ch === " " || ch === "\t") { flushWord(); continue; }
      buf += ch; started = true;
    }
    flushCmd();
  }
  flushCmd();
  return cmds;
}

/** The command name of a shell command: unquoted head, env assignments stripped. */
function shellHead(c: ShCommand): ShWord | null {
  let ws = c.words;
  while (ws.length && (SH_KEYWORDS.has(ws[0].text) ||
         (!ws[0].quoted && /^[A-Za-z_][A-Za-z0-9_]*=/.test(ws[0].text)) ||
         ws[0].text === "command" || ws[0].text === "exec" || ws[0].text === "sudo")) {
    ws = ws.slice(1);
  }
  return ws[0] ?? null;
}

/** Index of the first real invocation of `name`, or -1. Quoted heads never count. */
function shellInvokeIndex(root: string, rel: string, name: string): number {
  for (const c of lexShell(read(path.join(root, rel)))) {
    const head = shellHead(c);
    if (!head || head.quoted) continue;
    if (head.text === name || head.text.endsWith(`/${name}`)) return c.index;
  }
  return -1;
}

function shellInvokes(root: string, rel: string, name: string): boolean {
  return shellInvokeIndex(root, rel, name) >= 0;
}

const SHELL_WRITING_COMMANDS = new Set([
  "mkdir", "cp", "mv", "tee", "touch", "rm", "ln", "install", "rsync", "dd", "truncate",
]);

/**
 * The first command that writes a path this analyzer cannot prove is outside
 * `.guild`. A literal `.guild` target is a proven write; a target built from a shell
 * variable is UNPROVABLE and counts as a write too — fail closed, so a guard cannot
 * be evaded by assigning the path first.
 */
const SHELL_INTERPRETERS = new Set([
  "node", "npx", "bun", "bunx", "tsx", "deno", "python", "python3", "bash", "sh", "zsh",
]);

type ShWriteKind = "guild" | "variable" | "spawn";

function shellGuildWriteIndex(
  root: string, rel: string,
): { index: number; kind: ShWriteKind | null } {
  const text = read(path.join(root, rel));
  const mentionsGuild = text.includes(".guild");
  for (const c of lexShell(text)) {
    const head = shellHead(c);
    const classify = (ws: ShWord[]): ShWriteKind | null => {
      if (ws.some((w) => w.text.includes(".guild"))) return "guild";
      if (ws.some((w) => w.text.includes("$"))) return "variable";
      return null;
    };
    // `> path` / `>> path` redirection (ignore the /dev/null idiom).
    const reds = c.redirects.filter((r) => !r.text.startsWith("/dev/"));
    const red = classify(reds);
    if (red) return { index: c.index, kind: red };
    if (!head) continue;
    const name = head.text.replace(/^.*\//, "");
    const args = c.words.filter((w) => w !== head);
    // A spawned interpreter writes wherever its program writes; from the shell that
    // target is unprovable, so a script that also names `.guild` fails closed.
    if (SHELL_INTERPRETERS.has(name) && mentionsGuild) return { index: c.index, kind: "spawn" };
    const isWriter = SHELL_WRITING_COMMANDS.has(name) ||
      (name === "sed" && args.some((a) => /^-[a-zA-Z]*i/.test(a.text))) ||
      (name === "git" && args[0]?.text === "worktree" && args[1]?.text === "add");
    if (!isWriter) continue;
    const verdict = classify(args);
    if (verdict) return { index: c.index, kind: verdict };
  }
  return { index: -1, kind: null };
}

/**
 * A real invocation of any of `names`. TypeScript/JavaScript is matched on the AST;
 * shell is matched by the lexer above. A mention in a comment, a string, or a heredoc
 * body never counts.
 */
function callsAnything(root: string, rel: string, names: string[]): boolean {
  const isShell = rel.endsWith(".sh") || rel.endsWith(".bash");
  return names.some((n) => (isShell ? shellInvokes(root, rel, n) : hasCallTo(root, rel, n)));
}

const WRITE_CALL_NAMES = [
  "writeFileSync", "writeFile", "mkdirSync", "mkdir", "appendFileSync", "appendFile",
  "rmSync", "rm", "renameSync", "rename", "cpSync", "copyFileSync", "outputFileSync",
];

const FS_MODULES = new Set([
  "fs", "node:fs", "fs/promises", "node:fs/promises", "graceful-fs", "fs-extra",
]);

/**
 * Does this file reach the fs module in ANY form — a direct import/require/dynamic
 * import/export-from, or a relative module that itself does (a re-export)? Name-based
 * write detection is defeated by `fs["writeFileSync"]`, aliases and indirection, so
 * the entry guard keys off fs REACHABILITY instead and over-approximates on purpose.
 */
const FS_REACH_CACHE = new Map<string, boolean>();

function referencesFsModule(root: string, rel: string, depth = 1): boolean {
  const k = `${root}::${rel}::${depth}`;
  const hit = FS_REACH_CACHE.get(k);
  if (hit !== undefined) return hit;
  FS_REACH_CACHE.set(k, false); // cycle guard
  const specs = moduleSpecifiers(root, rel);
  let found = specs.some((s) => FS_MODULES.has(s));
  if (!found && depth > 0) {
    for (const s of specs) {
      if (!s.startsWith(".")) continue;
      const base = path.normalize(path.join(path.dirname(rel), s.replace(/\.js$/, "")))
        .replace(/\\/g, "/");
      const candidate = [`${base}.ts`, `${base}.js`, `${base}/index.ts`, `${base}/index.js`]
        .find((c) => exists(path.join(root, c)));
      if (candidate && referencesFsModule(root, candidate, depth - 1)) { found = true; break; }
    }
  }
  FS_REACH_CACHE.set(k, found);
  return found;
}

/**
 * Local names bound to an fs write API, so an alias cannot hide a write:
 * `import { writeFileSync as save }`, `const { writeFileSync: w } = require("fs")`,
 * `import * as fs` / `const fsp = require("fs").promises` (namespace form).
 */
function fsWriteBindings(root: string, rel: string): { direct: Set<string>; ns: Set<string> } {
  const direct = new Set<string>();
  const ns = new Set<string>();
  const sf = parse(root, rel);
  if (!sf) return { direct, ns };

  const fromFsModule = (e: ts.Expression | undefined): boolean =>
    !!e && ts.isStringLiteralLike(e) && FS_MODULES.has(e.text);
  const requireOfFs = (e: ts.Expression | undefined): boolean => {
    if (!e) return false;
    let cur: ts.Expression = e;
    // Unwrap `require("fs").promises`, `(await import("fs")).promises`, etc.
    while (ts.isPropertyAccessExpression(cur)) cur = cur.expression;
    if (ts.isAwaitExpression(cur)) cur = cur.expression;
    if (ts.isParenthesizedExpression(cur)) cur = cur.expression;
    while (ts.isPropertyAccessExpression(cur)) cur = cur.expression;
    if (!ts.isCallExpression(cur)) return false;
    const isReq = ts.isIdentifier(cur.expression) && cur.expression.text === "require";
    const isDyn = cur.expression.kind === ts.SyntaxKind.ImportKeyword;
    return (isReq || isDyn) && fromFsModule(cur.arguments[0]);
  };

  eachNode(sf, (n) => {
    if (ts.isImportDeclaration(n) && fromFsModule(n.moduleSpecifier as ts.Expression)) {
      const c = n.importClause;
      if (!c) return;
      if (c.name) ns.add(c.name.text);
      if (c.namedBindings && ts.isNamespaceImport(c.namedBindings)) ns.add(c.namedBindings.name.text);
      if (c.namedBindings && ts.isNamedImports(c.namedBindings)) {
        for (const el of c.namedBindings.elements) {
          const original = (el.propertyName ?? el.name).text;
          if (WRITE_CALL_NAMES.includes(original)) direct.add(el.name.text);
          else ns.add(el.name.text); // e.g. `import { promises } from "fs"`
        }
      }
      return;
    }
    if (ts.isVariableDeclaration(n) && requireOfFs(n.initializer)) {
      if (ts.isIdentifier(n.name)) { ns.add(n.name.text); return; }
      if (ts.isObjectBindingPattern(n.name)) {
        for (const el of n.name.elements) {
          if (!ts.isIdentifier(el.name)) continue;
          const original = el.propertyName && ts.isIdentifier(el.propertyName)
            ? el.propertyName.text : el.name.text;
          if (WRITE_CALL_NAMES.includes(original)) direct.add(el.name.text);
          else ns.add(el.name.text);
        }
      }
      return;
    }
    // `const fsp = fs.promises` where `fs` is already a namespace binding.
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer &&
        ts.isPropertyAccessExpression(n.initializer)) {
      let root2: ts.Expression = n.initializer;
      while (ts.isPropertyAccessExpression(root2)) root2 = root2.expression;
      if (ts.isIdentifier(root2) && ns.has(root2.text)) ns.add(n.name.text);
    }
  });
  return { direct, ns };
}

/** True when the file performs a filesystem write through a real call site. */
function performsWrite(root: string, rel: string): boolean {
  if (rel.endsWith(".sh") || rel.endsWith(".bash")) {
    const stripped = read(path.join(root, rel))
      .split("\n").map((l) => l.replace(/(^|\s)#.*$/, "")).join("\n");
    return /(^|\s)(mkdir|cp|mv|touch|tee|install)\s/.test(stripped) || />>?\s*"?\$/.test(stripped);
  }
  const sf = parse(root, rel);
  if (!sf) return false;
  const { direct, ns } = fsWriteBindings(root, rel);
  let found = false;
  eachNode(sf, (n) => {
    if (found || !ts.isCallExpression(n)) return;
    const e = n.expression;
    if (ts.isIdentifier(e) && direct.has(e.text)) { found = true; return; }
    const c = calleeName(n);
    if (!c || !WRITE_CALL_NAMES.includes(c)) return;
    // `fs.writeFileSync`, `fsp.writeFile`, `fs.promises.writeFile`, bare `writeFileSync`.
    // Bare `writeFileSync(...)` or any receiver whose method is an fs write API
    // (`fs.writeFileSync`, `fsp.writeFile`, `fs.promises.writeFile`).
    if (ts.isIdentifier(e) || ts.isPropertyAccessExpression(e)) found = true;
  });
  return found;
}

/** Every module specifier: import, export-from, require(), and dynamic import(). */
function moduleSpecifiers(root: string, rel: string): string[] {
  const sf = parse(root, rel);
  if (!sf) return [];
  const out: string[] = [];
  eachNode(sf, (n) => {
    if ((ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) &&
        n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier)) {
      out.push(n.moduleSpecifier.text);
      return;
    }
    if (ts.isImportTypeNode(n) && ts.isLiteralTypeNode(n.argument) &&
        ts.isStringLiteral(n.argument.literal)) {
      out.push(n.argument.literal.text);
      return;
    }
    if (ts.isCallExpression(n)) {
      const isRequire = ts.isIdentifier(n.expression) && n.expression.text === "require";
      const isDynamic = n.expression.kind === ts.SyntaxKind.ImportKeyword;
      if ((isRequire || isDynamic) && n.arguments.length && ts.isStringLiteral(n.arguments[0])) {
        out.push(n.arguments[0].text);
      }
    }
  });
  return out;
}

/** String literals + template text only — a path check that ignores comments. */
function stringLiterals(root: string, rel: string): string[] {
  const sf = parse(root, rel);
  if (!sf) return [];
  const out: string[] = [];
  eachNode(sf, (n) => {
    if (ts.isStringLiteralLike(n)) out.push(n.text);
    else if (ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) out.push(n.text);
  });
  return out;
}

function mentionsPathInCode(root: string, rel: string, needle: string): boolean {
  return stringLiterals(root, rel).some((s) => s.includes(needle));
}

// ---------------------------------------------------- overlay enforcement proof
/** The nearest enclosing function-like body, or the source file. */
function enclosingBody(n: ts.Node): ts.Node {
  let cur: ts.Node | undefined = n.parent;
  while (cur) {
    if (ts.isFunctionDeclaration(cur) || ts.isFunctionExpression(cur) ||
        ts.isArrowFunction(cur) || ts.isMethodDeclaration(cur) || ts.isSourceFile(cur)) {
      return cur;
    }
    cur = cur.parent;
  }
  return n;
}

const FAILURE_CALL_NAMES = new Set([
  "push", "fail", "reject", "invalid", "error", "throwError", "addViolation", "violation",
]);

/** A node that produces a failure: a throw, a `return false`, or a rejection call. */
function isFailureNode(n: ts.Node): boolean {
  if (ts.isThrowStatement(n)) return true;
  if (ts.isReturnStatement(n) && n.expression &&
      n.expression.kind === ts.SyntaxKind.FalseKeyword) return true;
  if (ts.isCallExpression(n)) {
    const c = calleeName(n);
    if (c && FAILURE_CALL_NAMES.has(c)) return true;
  }
  return false;
}

function containsRef(n: ts.Node, names: Set<string>): boolean {
  let hit = false;
  eachNode(n, (x) => { if (!hit && ts.isIdentifier(x) && names.has(x.text)) hit = true; });
  return hit;
}

const ITERATION_METHODS = new Set(["every", "some", "filter", "find", "forEach", "map", "flatMap"]);
const PREDICATE_METHODS = new Set(["every", "some", "includes", "has", "find", "filter"]);

/**
 * Names that carry the required-node set's value: the set itself, a `for…of` binding
 * over it, a variable initialised from it, and a callback parameter it iterates.
 * Without this, `for (const n of REQUIRED_NODES) if (!overlay.includes(n)) throw`
 * would read as non-enforcing.
 */
function aliasesOf(sf: ts.SourceFile, name: string): Set<string> {
  const aliases = new Set<string>([name]);
  for (let pass = 0; pass < 4; pass++) {
    const before = aliases.size;
    eachNode(sf, (n) => {
      if ((ts.isForOfStatement(n) || ts.isForInStatement(n)) && containsRef(n.expression, aliases)) {
        const decl = n.initializer;
        if (ts.isVariableDeclarationList(decl)) {
          for (const d of decl.declarations) if (ts.isIdentifier(d.name)) aliases.add(d.name.text);
        }
        return;
      }
      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer &&
          containsRef(n.initializer, aliases)) {
        aliases.add(n.name.text);
        return;
      }
      if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) &&
          ITERATION_METHODS.has(n.expression.name.text) &&
          containsRef(n.expression.expression, aliases)) {
        const cb = n.arguments[0];
        if (cb && (ts.isArrowFunction(cb) || ts.isFunctionExpression(cb))) {
          for (const p of cb.parameters) if (ts.isIdentifier(p.name)) aliases.add(p.name.text);
        }
      }
    });
    if (aliases.size === before) break;
  }
  return aliases;
}

/**
 * Fail-closed enforcement analysis (codex G-lane r3). A required-node set PASSES only
 * when every clause below is provable on the AST; anything the analyzer cannot
 * classify is reported as "unprovable enforcement", never waved through.
 *
 *   (a) a validator FUNCTION exists (not just module top-level statements);
 *   (b) that function reads the required-node set (or a value carried from it);
 *   (c) a branch conditioned on that value REJECTS — a `throw`, a `return false`
 *       literal, a `return` of an object/array literal carrying an error/violation
 *       entry, or a `return` of a call whose name matches /fail|reject|error|
 *       violation|push/.
 *
 * A branch that only logs is not a rejection. `return REQUIRED.every(...)` is NOT an
 * accepted shape: it is unprovable without type information, so it fails closed.
 */
type EnforcementVerdict =
  | { ok: true }
  | { ok: false; reason: string };

const REJECT_CALL_RE = /fail|reject|error|violation|push/i;
const ERROR_KEY_RE = /error|violation|invalid|fail|refus|reject|blocked/i;
const LOG_CALL_RE = /^(log|info|debug|warn|trace|table|dir)$/;

/** A `return` that hands back a failure value. */
function returnsFailure(r: ts.ReturnStatement): boolean {
  let e = r.expression;
  if (!e) return false;
  while (ts.isParenthesizedExpression(e) || ts.isAsExpression(e)) e = e.expression;
  if (e.kind === ts.SyntaxKind.FalseKeyword) return true;
  if (ts.isCallExpression(e)) {
    const c = calleeName(e);
    if (c && REJECT_CALL_RE.test(c)) return true;
  }
  if (ts.isObjectLiteralExpression(e)) {
    return e.properties.some((prop) => {
      const n = prop.name && (ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name))
        ? prop.name.text : "";
      if (ERROR_KEY_RE.test(n)) return true;
      // `{ ok: false }` / `{ valid: false }`
      return ts.isPropertyAssignment(prop) &&
        prop.initializer.kind === ts.SyntaxKind.FalseKeyword;
    });
  }
  if (ts.isArrayLiteralExpression(e)) {
    return e.elements.some((el) =>
      (ts.isStringLiteralLike(el) && ERROR_KEY_RE.test(el.text)) ||
      (ts.isObjectLiteralExpression(el) && el.properties.some((prop) =>
        !!prop.name && (ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name)) &&
        ERROR_KEY_RE.test(prop.name.text))));
  }
  return false;
}

/** Does this statement/expression subtree reject? Logging alone does not. */
function branchRejects(branch: ts.Node): boolean {
  let rejects = false;
  eachNode(branch, (n) => {
    if (rejects) return;
    if (ts.isThrowStatement(n)) { rejects = true; return; }
    if (ts.isReturnStatement(n) && returnsFailure(n)) { rejects = true; return; }
  });
  return rejects;
}

function isValidatorFunction(n: ts.Node): boolean {
  return ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) ||
    ts.isArrowFunction(n) || ts.isMethodDeclaration(n);
}

function enforcementVerdict(sf: ts.SourceFile, name: string): EnforcementVerdict {
  const aliases = aliasesOf(sf, name);
  const refs: ts.Identifier[] = [];
  eachNode(sf, (n) => {
    if (!ts.isIdentifier(n) || !aliases.has(n.text)) return;
    if (ts.isVariableDeclaration(n.parent) && n.parent.name === n) return; // the declaration
    if (ts.isCallExpression(n.parent) && LOG_CALL_RE.test(calleeName(n.parent) ?? "")) return;
    refs.push(n);
  });
  if (refs.length === 0) {
    return { ok: false, reason: `${name} is declared but no validator reads it` };
  }
  const inFunction = refs.filter((r) => {
    let cur: ts.Node | undefined = r.parent;
    while (cur && !ts.isSourceFile(cur)) {
      if (isValidatorFunction(cur)) return true;
      cur = cur.parent;
    }
    return false;
  });
  if (inFunction.length === 0) {
    return { ok: false, reason: `${name} is read only at module top level; no validator function consults it` };
  }
  for (const ref of inFunction) {
    const body = enclosingBody(ref);
    let proven = false;
    eachNode(body, (n) => {
      if (proven) return;
      if (ts.isIfStatement(n) && containsRef(n.expression, aliases)) {
        if (branchRejects(n.thenStatement)) { proven = true; return; }
        if (n.elseStatement && branchRejects(n.elseStatement)) { proven = true; return; }
        return;
      }
      if (ts.isConditionalExpression(n) && containsRef(n.condition, aliases)) {
        if (branchRejects(n.whenTrue) || branchRejects(n.whenFalse)) { proven = true; return; }
        return;
      }
      // A loop over the set whose body rejects on a missing member.
      if ((ts.isForOfStatement(n) || ts.isForStatement(n) || ts.isWhileStatement(n)) &&
          containsRef(n, aliases)) {
        let inner = false;
        eachNode(n.statement, (x) => {
          if (inner) return;
          if (ts.isIfStatement(x) &&
              (branchRejects(x.thenStatement) ||
               (x.elseStatement ? branchRejects(x.elseStatement) : false))) inner = true;
        });
        if (inner) { proven = true; return; }
      }
      // A predicate callback over the set whose body rejects.
      if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) &&
          ITERATION_METHODS.has(n.expression.name.text) &&
          containsRef(n.expression.expression, aliases)) {
        const cb = n.arguments[0];
        if (cb && (ts.isArrowFunction(cb) || ts.isFunctionExpression(cb)) &&
            cb.body && branchRejects(cb.body)) { proven = true; return; }
      }
    });
    if (proven) return { ok: true };
  }
  return {
    ok: false,
    reason: `no branch conditioned on a missing ${name} member rejects (throw / return false / error literal / reject-call); enforcement is unprovable`,
  };
}

/** `["a"]`, `new Set(["a"])`, `{a:1}` are non-empty; `[]`, `new Set()`, absent are not. */
function nonEmptySet(init: ts.Expression | undefined): boolean {
  if (!init) return false;
  let e = init;
  while (ts.isAsExpression(e) || ts.isTypeAssertionExpression(e) || ts.isParenthesizedExpression(e)) {
    e = e.expression;
  }
  if (ts.isArrayLiteralExpression(e)) return e.elements.length > 0;
  if (ts.isObjectLiteralExpression(e)) return e.properties.length > 0;
  if (ts.isNewExpression(e)) {
    const arg = e.arguments?.[0];
    return arg ? nonEmptySet(arg) : false;
  }
  return false;
}

// ------------------------------------------------------- behavioral oracle (KTD42)
// Static proof lost four rounds to syntactic evasion. The overlay law is now decided
// by EXECUTION: load the validator and call it with an overlay that omits a protected
// node. The code either rejects it or it does not; polarity, reachability and naming
// stop mattering. Loading requires a TypeScript-capable loader (tsx/bun); a load
// failure is a violation, never a pass.

const PROTECTED_NODES = ["product.qa", "d5", "d8", "ops.first-run"];
const DEFAULT_GRAPH_IDS = [
  "product.define", "product.build", "product.qa", "d5", "d8", "ops.first-run",
  "product.release",
];
/** The overlay under test drops `product.qa` — the KTD42 "qa before release" node. */
const OVERLAY_MISSING_IDS = DEFAULT_GRAPH_IDS.filter((n) => n !== "product.qa");
const asGraph = (ids: string[]) => ({ class: "product", nodes: ids.map((id) => ({ id })) });

const VALIDATOR_EXPORT_RE = /^(applyOverlay|validateOverlay|checkOverlay|assertOverlay|overlay\w*|\w*Overlay)$/;

/** Does the returned value serialize to something the lint can call a failure? */
function classifyOracleResult(value: unknown): "failure" | "not-failure" {
  if (value === false) return "failure";
  if (value === null || value === undefined) return "not-failure";
  if (typeof value === "object") {
    let json: string;
    try { json = JSON.stringify(value) ?? ""; } catch { return "not-failure"; }
    if (ERROR_KEY_RE.test(json)) return "failure";
    if (/"(ok|valid|passed)"\s*:\s*false/.test(json)) return "failure";
  }
  return "not-failure";
}

/** Every exported function on a lifecycle/overlay module that looks like the validator. */
function overlayValidatorFiles(ctx: Ctx): string[] {
  return tsFiles(ctx, DOMAIN_PREFIXES)
    .filter((f) => /overlay|workflow[-_]?graph/i.test(f) && !f.endsWith(".test.ts"));
}

async function runOverlayOracle(ctx: Ctx): Promise<Violation[]> {
  const mk = (detail: string): Violation =>
    ({ check: "overlay-cannot-drop-required-nodes", path: "src/domains/lifecycle/", detail });

  const files = overlayValidatorFiles(ctx);
  if (files.length === 0) {
    return [mk("no overlay validator module exists on this tree")];
  }

  const problems: Violation[] = [];
  for (const f of files) {
    const abs = path.join(ctx.root, f);
    let mod: Record<string, unknown>;
    try {
      mod = (await import(`${pathToFileUrl(abs)}?t=${Date.now()}`)) as Record<string, unknown>;
    } catch (err) {
      problems.push({
        check: "overlay-cannot-drop-required-nodes",
        path: f,
        detail: `validator module could not be loaded for the behavioral oracle: ${String((err as Error)?.message ?? err).slice(0, 160)}`,
      });
      continue;
    }
    const fns = Object.entries(mod).filter(
      ([name, v]) => typeof v === "function" && VALIDATOR_EXPORT_RE.test(name),
    ) as Array<[string, (...a: unknown[]) => unknown]>;
    if (fns.length === 0) {
      problems.push({ check: "overlay-cannot-drop-required-nodes", path: f, detail: "module exports no overlay validator function" });
      continue;
    }
    for (const [name, fn] of fns) {
      const shapes: unknown[][] = [
        [asGraph(DEFAULT_GRAPH_IDS), asGraph(OVERLAY_MISSING_IDS)],
        [DEFAULT_GRAPH_IDS, OVERLAY_MISSING_IDS],
        [OVERLAY_MISSING_IDS],
        [asGraph(OVERLAY_MISSING_IDS)],
      ];
      let rejected = false;
      let sawCallable = false;
      const quiet = silenceConsole();
      try {
        for (const args of shapes) {
          try {
            const out = await fn(...args);
            sawCallable = true;
            if (classifyOracleResult(out) === "failure") { rejected = true; break; }
          } catch (err) {
            const msg = String((err as Error)?.message ?? err);
            // A structural miscall is not the validator rejecting the overlay.
            if (/is not a function|Cannot read propert/i.test(msg)) continue;
            sawCallable = true;
            rejected = true;
            break;
          }
        }
      } finally { quiet(); }
      if (rejected) return [];  // one exported validator rejects: the law holds
      problems.push({
        check: "overlay-cannot-drop-required-nodes",
        path: f,
        detail: sawCallable
          ? `${name}() accepted an overlay omitting ${PROTECTED_NODES[0]}: it neither threw nor returned a failure value`
          : `${name}() could not be exercised by the oracle`,
      });
    }
  }
  return problems.length ? problems : [mk("no overlay validator rejected the synthetic overlay")];
}

/** Keep a validator's own logging out of the lint report. */
function silenceConsole(): () => void {
  const saved = { log: console.log, warn: console.warn, error: console.error, info: console.info };
  const noop = () => {};
  console.log = noop; console.warn = noop; console.error = noop; console.info = noop;
  return () => {
    console.log = saved.log; console.warn = saved.warn;
    console.error = saved.error; console.info = saved.info;
  };
}

function pathToFileUrl(abs: string): string {
  const p = path.resolve(abs).replace(/\\/g, "/");
  return `file://${p.startsWith("/") ? "" : "/"}${p}`;
}

/** SessionStart must bootstrap AND project the Guild surface (KTD31 / R48). */
const SESSION_START_REQUIRED_CALLS: Array<{ names: string[]; label: string }> = [
  { names: ["ensureStorageLayout"], label: "ensureStorageLayout (layout bootstrap)" },
  { names: ["composePrompt", "compose"], label: "composePrompt (prompt compose at bind)" },
  { names: ["projectSurfaces", "project"], label: "projectSurfaces (surface projection)" },
];

// ------------------------------------------------------------- shared derivations
/** Every surface tree that ships as prompt-loaded markdown, pre- and post-fold. */
const SURFACE_PREFIXES = [
  "commands/", "skills/", "agents/", "templates/", "src/surfaces/",
];
/** Every TypeScript tree that is domain (business) code, pre- and post-fold. */
const DOMAIN_PREFIXES = ["src/modules/", "src/domains/"];

/**
 * Does this file target the wiki? RAW TEXT, FAIL CLOSED.
 *
 * Path-assembly analysis was tried and rejected (codex G-lane r2). Every AST rule
 * has a shape it cannot see: a literal-only predicate missed
 * `path.join(cwd, ".guild", "wiki")`; adding join/template handling still missed
 * `[".guild", "wiki", page].join("/")`, `reduce`, a segment held in a const, a
 * path built in a helper two files away. Each miss is a real wiki writer shipping
 * without `scrubbedWrite`, which is a KTD37 security guard, not a style rule.
 *
 * So the rule is deliberately over-inclusive and syntax-free: a file that
 * mentions BOTH the `.guild` and `wiki` tokens ANYWHERE in its raw text —
 * literals, template pieces, array elements, comments — and touches an fs write
 * API is treated as a wiki writer. The one escape is a real `scrubbedWrite` call
 * site. False positives cost one `scrubbedWrite` call or one baseline line; false
 * negatives cost an unscrubbed write to the knowledge base.
 *
 * A `wiki` token is the word on an identifier/path boundary (`"wiki"`, `wikiDir`,
 * `wiki/decisions`), not a substring of an unrelated word.
 */
function targetsWikiRawText(root: string, rel: string): boolean {
  const body = read(path.join(root, rel));
  if (!body.includes(".guild")) return false;
  return /(^|[^A-Za-z0-9_])wiki([^A-Za-z0-9_]|$)/i.test(body) || /\bwiki[A-Z]/.test(body);
}

function tsFiles(ctx: Ctx, prefixes: string[]): string[] {
  return under(ctx.files, ...prefixes).filter(
    (f) => (f.endsWith(".ts") || f.endsWith(".tsx")) &&
      !f.endsWith(".d.ts") && !isFixturePath(f),
  );
}

function skillGlobEntries(ctx: Ctx): string[] {
  const m = ctx.manifest;
  return Array.isArray(m?.skills) ? m.skills : [];
}

/** Resolve the plugin.json skills glob to concrete skill ids + their folder. */
function resolveIndexedSkills(ctx: Ctx): Array<{ id: string; dir: string }> {
  const out: Array<{ id: string; dir: string }> = [];
  const hasSkillFile = (dir: string) =>
    exists(path.join(ctx.root, dir, "SKILL.md")) ||
    exists(path.join(ctx.root, dir, "SKILL.src.md"));
  for (const raw of skillGlobEntries(ctx)) {
    const rel = String(raw).replace(/^\.\//, "").replace(/\/+$/, "");
    const abs = path.join(ctx.root, rel);
    if (!isDir(abs)) continue;
    if (hasSkillFile(rel)) { out.push({ id: path.basename(rel), dir: rel }); continue; }
    for (const name of fs.readdirSync(abs).sort()) {
      const sub = `${rel}/${name}`;
      if (isDir(path.join(ctx.root, sub)) && hasSkillFile(sub)) {
        out.push({ id: name, dir: sub });
      }
    }
  }
  return out;
}

function commandFiles(ctx: Ctx): string[] {
  return ctx.files.filter(
    (f) => (/^commands\/[^/]+\.md$/.test(f) || /^src\/surfaces\/commands\/[^/]+\.md$/.test(f)),
  );
}

function aliasAllowlist(ctx: Ctx): string[] {
  for (const p of ["commands/aliases.allowlist.json", "src/surfaces/commands/aliases.allowlist.json"]) {
    const j = readJson(path.join(ctx.root, p));
    if (Array.isArray(j)) return j.map(String);
    if (Array.isArray(j?.aliases)) return j.aliases.map(String);
  }
  return [];
}

/** hooks.json command string -> the authored source file it is built from. */
function hookSources(ctx: Ctx): Array<{ event: string; source: string }> {
  const j = readJson(path.join(ctx.root, "hooks/hooks.json"));
  const events = j?.hooks ?? j ?? {};
  const out: Array<{ event: string; source: string }> = [];
  for (const [event, groups] of Object.entries(events)) {
    for (const g of (groups as any[]) ?? []) {
      for (const h of g?.hooks ?? []) {
        const cmd = String(h?.command ?? "");
        const m = cmd.match(/hooks\/(?:(?!dist\/)([\w-]+)\/)?(?:dist\/)?([\w.-]+)\.(js|sh|ts)/);
        if (!m) continue;
        const sub = m[1] ? `${m[1]}/` : "";
        const base = m[2];
        const candidates = [
          `hooks/${sub}${base}.ts`,
          `hooks/${sub}${base}.sh`,
          `hooks/${sub}${base}.js`,
        ];
        const src = candidates.find((c) => exists(path.join(ctx.root, c)));
        if (src) out.push({ event, source: src });
      }
    }
  }
  // de-duplicate on (event, source), deterministic order
  const seen = new Set<string>();
  return out
    .filter((e) => { const k = `${e.event}::${e.source}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => (`${a.event}${a.source}` < `${b.event}${b.source}` ? -1 : 1));
}

const WRITE_CALL = /\b(writeFileSync|writeFile|mkdirSync|appendFileSync|rmSync|renameSync|cpSync)\s*\(/;

/**
 * Every write-capable entry the source plan names (KTD23): the registered hooks, the
 * CLI entrypoints under scripts/ that write `.guild`, and the MCP binary. An entry is
 * in scope only when it actually performs a write.
 */
// -------------------------------------------------- raw-text entry rules (KTD23)
// Static reachability lost to aliasing and indirection, so the entry guard is now a
// RAW-TEXT rule. Scope note, by design: a file that builds the string ".guild" by
// concatenation evades these checks. That is accepted — these are KTD regression
// guards for a repo we control, not a sandbox or a security boundary.

// `node <path>/ensure-storage-layout.js` or `.../run-trace.js`; the path may be quoted.
const BOOTSTRAP_ENTRY_RE = /^node\s+["']?[^"'\s]*(?:ensure-storage-layout|run-trace)\.js["']?(\s|$)/;

function isShellEntry(root: string, rel: string): boolean {
  if (rel.endsWith(".sh") || rel.endsWith(".bash")) return true;
  const first = read(path.join(root, rel)).split("\n", 1)[0] ?? "";
  return /^#!.*\b(bash|sh|zsh|dash)\b/.test(first);
}

type ShellVerdict = { ok: true } | { ok: false; reason: string };

/**
 * A shell entry naming `.guild` passes only when a line, after stripping leading
 * whitespace, begins with `node <path ending in ensure-storage-layout.js|run-trace.js>`
 * while outside every heredoc body and outside a multi-line quoted string. An
 * undecidable quote or heredoc state is a violation.
 */
function shellBootstrapVerdict(root: string, rel: string): ShellVerdict {
  const lines = read(path.join(root, rel)).split("\n");
  // `cat <<A <<B` queues A then B; each body ends at its OWN terminator, in order.
  const heredocQueue: string[] = [];
  let quoteParity = { single: 0, double: 0 };
  let found = false;

  for (const line of lines) {
    if (heredocQueue.length) {
      if (line.replace(/^\t+/, "") === heredocQueue[0]) heredocQueue.shift();
      continue; // text inside ANY queued body is data, never a bootstrap line
    }
    const inQuotedString = quoteParity.single % 2 === 1 || quoteParity.double % 2 === 1;
    const candidate = line.replace(/^[ \t]+/, "");
    if (!inQuotedString && BOOTSTRAP_ENTRY_RE.test(candidate)) found = true;

    // Cumulative unescaped quote count, then EVERY heredoc opened on this line.
    for (let i = 0; i < line.length; i++) {
      if (line[i] === "\\") { i++; continue; }
      if (line[i] === "'") quoteParity.single++;
      else if (line[i] === '"') quoteParity.double++;
    }
    for (const h of line.matchAll(/<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/g)) {
      heredocQueue.push(h[2]);
    }
  }

  if (heredocQueue.length) {
    return { ok: false, reason: "unterminated heredoc: quote/heredoc state is undecidable" };
  }
  if (quoteParity.single % 2 === 1 || quoteParity.double % 2 === 1) {
    return { ok: false, reason: "unbalanced quotes: quote/heredoc state is undecidable" };
  }
  if (!found) {
    return { ok: false, reason: "no line invokes the compiled bootstrap (`node …/ensure-storage-layout.js` or `…/run-trace.js`)" };
  }
  return { ok: true };
}

/**
 * A JS/TS entry naming `.guild` passes only when the AST holds a call whose callee
 * resolves, through THIS FILE'S own import/require bindings, to `ensureStorageLayout`.
 * A locally defined function of that name does not resolve; unresolved is a violation.
 */
/**
 * Scope-aware resolution through TypeScript's binder. A call counts only when the
 * checker resolves its callee to a symbol DECLARED BY an import/require of
 * `ensureStorageLayout` in this file. A parameter, a local, or a shadowing binding of
 * the same name resolves elsewhere and does not count.
 */
function isRequireLike(e: ts.Expression): boolean {
  let cur: ts.Expression = e;
  if (ts.isAwaitExpression(cur)) cur = cur.expression;
  if (ts.isParenthesizedExpression(cur)) cur = cur.expression;
  while (ts.isPropertyAccessExpression(cur)) cur = cur.expression;
  if (!ts.isCallExpression(cur)) return false;
  return (ts.isIdentifier(cur.expression) && cur.expression.text === "require") ||
    cur.expression.kind === ts.SyntaxKind.ImportKeyword;
}

const PROGRAM_CACHE = new Map<string, ts.Program | null>();

function singleFileProgram(root: string, rel: string): ts.Program | null {
  const k = `${root}::${rel}`;
  if (PROGRAM_CACHE.has(k)) return PROGRAM_CACHE.get(k)!;
  const abs = path.join(root, rel);
  let program: ts.Program | null = null;
  try {
    const options: ts.CompilerOptions = {
      allowJs: true, checkJs: false, noResolve: true, noLib: true,
      target: ts.ScriptTarget.Latest, module: ts.ModuleKind.ESNext,
      allowNonTsExtensions: true, skipLibCheck: true,
    };
    const host = ts.createCompilerHost(options, true);
    const originalGet = host.getSourceFile.bind(host);
    host.getSourceFile = (name, lang, onErr, shouldCreate) =>
      path.resolve(name) === path.resolve(abs)
        ? ts.createSourceFile(name, read(abs), lang, true,
            /\.(js|mjs|cjs)$/.test(rel) ? ts.ScriptKind.JS : ts.ScriptKind.TS)
        : originalGet(name, lang, onErr, shouldCreate);
    program = ts.createProgram([abs], options, host);
  } catch { program = null; }
  PROGRAM_CACHE.set(k, program);
  return program;
}

/**
 * Is this symbol an import/require binding of a real fs module?
 *
 * Resolved through the CHECKER, never by binding name (codex G-lane r3). A file can
 * write `const fs = { readFileSync: () => "" }` and any name-keyed rule sees a
 * namespace called `fs` calling `readFileSync`. Only a symbol whose declaration is
 * an import or `require()` of `fs` / `node:fs` / `fs/promises` / `node:fs/promises`
 * counts, so a shadowing local object resolves to its own declaration and fails.
 *
 * `wantNamespace` distinguishes `fs.readFileSync(...)` (the base identifier must be
 * a namespace binding) from a destructured `readFileSync(...)` (the identifier must
 * be the named import itself).
 */
function declaresFsModuleBinding(
  sym: ts.Symbol | undefined,
  wantNamespace: boolean,
  checker: ts.TypeChecker,
): boolean {
  /**
   * Is this `require` the AMBIENT one? A file can declare
   * `function require(_: string) { return { readFileSync: () => "" }; }` and every
   * name-keyed rule reads `require("node:fs")` as a real module load (codex G-lane
   * r4). The global has no declaration in this source file, so a resolved symbol
   * whose declarations live HERE is a local shadow and disqualifies the call.
   */
  const isGlobalRequire = (id: ts.Identifier): boolean => {
    const rsym = checker.getSymbolAtLocation(id);
    const decls = rsym?.declarations ?? [];
    if (decls.length === 0) return true; // unresolved => the ambient require
    return !decls.some((d) => d.getSourceFile() === id.getSourceFile());
  };

  const specOf = (e: ts.Expression | undefined): string | null => {
    if (!e) return null;
    let cur: ts.Expression = e;
    while (ts.isPropertyAccessExpression(cur)) cur = cur.expression;
    if (ts.isAwaitExpression(cur)) cur = cur.expression;
    if (ts.isParenthesizedExpression(cur)) cur = cur.expression;
    while (ts.isPropertyAccessExpression(cur)) cur = cur.expression;
    if (!ts.isCallExpression(cur)) return null;
    const isReq = ts.isIdentifier(cur.expression) &&
      cur.expression.text === "require" && isGlobalRequire(cur.expression);
    const isDyn = cur.expression.kind === ts.SyntaxKind.ImportKeyword;
    if (!isReq && !isDyn) return null;
    const a = cur.arguments[0];
    return a && ts.isStringLiteralLike(a) ? a.text : null;
  };
  const isFsSpec = (spec: string | null | undefined): boolean => !!spec && FS_MODULES.has(spec);

  for (const d of sym?.declarations ?? []) {
    if (ts.isImportSpecifier(d)) {
      if (wantNamespace) continue;
      const decl = d.parent.parent.parent;
      if (!ts.isImportDeclaration(decl) || !ts.isStringLiteralLike(decl.moduleSpecifier)) continue;
      if (!isFsSpec(decl.moduleSpecifier.text)) continue;
      if (MARKER_READ_CALLS.includes((d.propertyName ?? d.name).text)) return true;
      continue;
    }
    if (ts.isNamespaceImport(d) || ts.isImportClause(d)) {
      if (!wantNamespace) continue;
      const decl = ts.isImportClause(d) ? d.parent : d.parent.parent;
      if (!ts.isImportDeclaration(decl) || !ts.isStringLiteralLike(decl.moduleSpecifier)) continue;
      if (isFsSpec(decl.moduleSpecifier.text)) return true;
      continue;
    }
    if (ts.isBindingElement(d)) {
      if (wantNamespace) continue;
      const varDecl = d.parent.parent;
      if (!ts.isVariableDeclaration(varDecl) || !varDecl.initializer) continue;
      if (!isFsSpec(specOf(varDecl.initializer))) continue;
      const original = d.propertyName && ts.isIdentifier(d.propertyName)
        ? d.propertyName.text
        : (ts.isIdentifier(d.name) ? d.name.text : "");
      if (MARKER_READ_CALLS.includes(original)) return true;
      continue;
    }
    if (ts.isVariableDeclaration(d) && d.initializer) {
      // `const fs = require("node:fs")` is a namespace binding. An object literal,
      // a call to anything else, or a parameter resolves here and is NOT fs.
      if (wantNamespace && isFsSpec(specOf(d.initializer))) return true;
    }
  }
  return false;
}

/** Is this symbol declared by an import/require binding of `ensureStorageLayout`? */
function declaresImportedEnsure(sym: ts.Symbol | undefined, wantNamespace: boolean): boolean {
  for (const d of sym?.declarations ?? []) {
    if (ts.isImportSpecifier(d)) {
      if (!wantNamespace && (d.propertyName ?? d.name).text === "ensureStorageLayout") return true;
      continue;
    }
    if (ts.isNamespaceImport(d) || ts.isImportClause(d) || ts.isNamespaceExport(d)) {
      if (wantNamespace) return true;
      continue;
    }
    if (ts.isBindingElement(d)) {
      // `const { ensureStorageLayout: x } = require("…")`
      const varDecl = d.parent.parent;
      if (!ts.isVariableDeclaration(varDecl) || !varDecl.initializer) continue;
      if (!isRequireLike(varDecl.initializer)) continue;
      const original = d.propertyName && ts.isIdentifier(d.propertyName)
        ? d.propertyName.text
        : (ts.isIdentifier(d.name) ? d.name.text : "");
      if (!wantNamespace && original === "ensureStorageLayout") return true;
      continue;
    }
    if (ts.isVariableDeclaration(d) && d.initializer && isRequireLike(d.initializer)) {
      // `const mod = require("…")` — a namespace-style binding only.
      if (wantNamespace) return true;
    }
  }
  return false;
}

/** The one file allowed to BE the scrubbing writer rather than call it. */
const CANONICAL_SCRUBBED_WRITE = "src/modules/security/workflows/scrubbed-write.ts";

/** True when `rel` exports a function declaration named `name` with a real body. */
function exportsNamed(root: string, rel: string, name: string): boolean {
  const sf = parse(root, rel);
  if (!sf) return false;
  let found = false;
  eachNode(sf, (n) => {
    if (
      ts.isFunctionDeclaration(n) &&
      n.name?.text === name &&
      n.body !== undefined &&
      n.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
    ) found = true;
  });
  return found;
}

/** The one file allowed to BE the layout bootstrap rather than call it. */
const CANONICAL_ENSURE_STORAGE_LAYOUT = "scripts/lib/state/ensure-storage-layout.ts";

/** fs read/stat APIs that constitute "performs the marker read". */
const MARKER_READ_CALLS = [
  "readFileSync", "readFile", "statSync", "stat", "existsSync", "access", "accessSync", "openSync",
];

/**
 * fs READ bindings, resolved the same way `fsWriteBindings` resolves writes:
 * `direct` are names destructured off an fs module (`import { readFileSync } from "fs"`),
 * `ns` are namespace handles (`import * as fs`, `const fs = require("node:fs")`).
 *
 * Resolving through the IMPORT is the point (codex G-lane r2): a file can declare its
 * own `function readFileSync() {}` and satisfy a name-only check without touching the
 * filesystem. A read only counts when it reaches a real fs module.
 */
function fsReadBindings(root: string, rel: string): { direct: Set<string>; ns: Set<string> } {
  const direct = new Set<string>();
  const ns = new Set<string>();
  const sf = parse(root, rel);
  if (!sf) return { direct, ns };

  const fromFsModule = (e: ts.Expression | undefined): boolean =>
    !!e && ts.isStringLiteralLike(e) && FS_MODULES.has(e.text);
  const requireOfFs = (e: ts.Expression | undefined): boolean => {
    if (!e) return false;
    let cur: ts.Expression = e;
    while (ts.isPropertyAccessExpression(cur)) cur = cur.expression;
    if (ts.isAwaitExpression(cur)) cur = cur.expression;
    if (ts.isParenthesizedExpression(cur)) cur = cur.expression;
    while (ts.isPropertyAccessExpression(cur)) cur = cur.expression;
    if (!ts.isCallExpression(cur)) return false;
    const isReq = ts.isIdentifier(cur.expression) && cur.expression.text === "require";
    const isDyn = cur.expression.kind === ts.SyntaxKind.ImportKeyword;
    return (isReq || isDyn) && fromFsModule(cur.arguments[0]);
  };

  eachNode(sf, (n) => {
    if (ts.isImportDeclaration(n) && fromFsModule(n.moduleSpecifier as ts.Expression)) {
      const c = n.importClause;
      if (!c) return;
      if (c.name) ns.add(c.name.text);
      if (c.namedBindings && ts.isNamespaceImport(c.namedBindings)) ns.add(c.namedBindings.name.text);
      if (c.namedBindings && ts.isNamedImports(c.namedBindings)) {
        for (const el of c.namedBindings.elements) {
          const original = (el.propertyName ?? el.name).text;
          if (MARKER_READ_CALLS.includes(original)) direct.add(el.name.text);
          else ns.add(el.name.text);
        }
      }
      return;
    }
    if (ts.isVariableDeclaration(n) && n.initializer && requireOfFs(n.initializer)) {
      if (ts.isIdentifier(n.name)) ns.add(n.name.text);
      if (ts.isObjectBindingPattern(n.name)) {
        for (const el of n.name.elements) {
          if (!ts.isIdentifier(el.name)) continue;
          const original = el.propertyName && ts.isIdentifier(el.propertyName)
            ? el.propertyName.text : el.name.text;
          if (MARKER_READ_CALLS.includes(original)) direct.add(el.name.text);
          else ns.add(el.name.text);
        }
      }
    }
  });
  return { direct, ns };
}

/**
 * Walk only the statements a function body actually REACHES: its own statements plus
 * the bodies of same-file functions it calls. Nested function declarations and
 * function/arrow expressions are NOT descended into unless something in the reachable
 * set invokes them — a reader defined inside the body but never called does not make
 * the body perform a read (codex G-lane r2).
 */
function reachableCalls(
  body: ts.Node,
  visit: (call: ts.CallExpression) => void,
  invoked: (callee: ts.Identifier) => void,
): void {
  const walkExpr = (n: ts.Node): void => {
    // Do not descend into a nested function's BODY; its call sites are only
    // reachable if the enclosing body invokes it, which the caller resolves.
    if (
      ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) ||
      ts.isArrowFunction(n) || ts.isMethodDeclaration(n)
    ) return;
    if (ts.isBlock(n)) { walkBlock(n); return; }
    if (ts.isCallExpression(n)) {
      visit(n);
      if (ts.isIdentifier(n.expression)) invoked(n.expression);
    }
    ts.forEachChild(n, walkExpr);
  };

  /**
   * Statements after an unconditional `return` / `throw` at the SAME block level are
   * dead code: a read parked there never executes, so it must not satisfy the law
   * (codex G-lane r3). The terminator's own expression is still walked — `return
   * fs.readFileSync(...)` is a real read.
   */
  const walkBlock = (block: ts.Block): void => {
    for (const st of block.statements) {
      walkExpr(st);
      if (ts.isReturnStatement(st) || ts.isThrowStatement(st)) return;
    }
  };

  if (ts.isBlock(body)) walkBlock(body);
  else ts.forEachChild(body, walkExpr);
}

/**
 * True when `rel` exports `function ensureStorageLayout` whose REACHABLE body performs
 * a real fs read — directly, or through a same-file function it calls.
 *
 * Three independent conditions, all required (codex G-lane r1 + r2):
 *   1. the caller has already checked this is the canonical implementation path;
 *   2. `ensureStorageLayout` is an EXPORTED function declaration with a body;
 *   3. that body reaches a call whose callee resolves through the file's fs IMPORT
 *      bindings — not merely a call to something *named* `readFileSync`, and not a
 *      reader defined inside the body that nothing invokes.
 */
function exportsRealBootstrap(root: string, rel: string, sf: ts.SourceFile): boolean {
  // The exported top-level declaration, taken from the source file directly (not a
  // name map that a nested declaration could overwrite).
  let entry: ts.FunctionDeclaration | undefined;
  for (const st of sf.statements) {
    if (ts.isFunctionDeclaration(st) && st.name?.text === "ensureStorageLayout" &&
        st.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) {
      entry = st;
    }
  }
  if (!entry?.body) return false;

  // Resolve the callee through the CHECKER. A name-keyed lookup accepts a locally
  // declared `readFileSync`, or a local object literal named `fs` — both of which
  // read nothing (codex G-lane r3). Unresolvable => not a read => fail closed.
  const program = singleFileProgram(root, rel);
  if (!program) return false;
  const checker = program.getTypeChecker();
  const isFsRead = (call: ts.CallExpression): boolean => {
    const e = call.expression;
    // `readFileSync(...)` destructured off an fs module.
    if (ts.isIdentifier(e)) {
      return declaresFsModuleBinding(checker.getSymbolAtLocation(e), false, checker);
    }
    // `fs.readFileSync(...)` / `fs.promises.readFile(...)` on an fs namespace handle.
    if (ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.name)) {
      if (!MARKER_READ_CALLS.includes(e.name.text)) return false;
      let base: ts.Expression = e.expression;
      while (ts.isPropertyAccessExpression(base)) base = base.expression;
      if (!ts.isIdentifier(base)) return false;
      return declaresFsModuleBinding(checker.getSymbolAtLocation(base), true, checker);
    }
    return false;
  };

  /**
   * The function-like declaration a callee identifier actually resolves to.
   *
   * Resolving a helper by NAME picks whichever declaration the lint happened to
   * index, so a local `const detect = () => null;` shadowing an outer reading
   * `detect()` still credited the outer one (codex G-lane r4). The checker resolves
   * to the binding in scope at the call site, which is the shadow.
   */
  const declarationOf = (id: ts.Identifier): ts.FunctionLikeDeclaration | null => {
    const sym = checker.getSymbolAtLocation(id);
    for (const d of sym?.declarations ?? []) {
      if (ts.isFunctionDeclaration(d) || ts.isFunctionExpression(d) || ts.isArrowFunction(d)) {
        return d;
      }
      // `const detect = () => …` / `const detect = function () {…}`
      if (ts.isVariableDeclaration(d) && d.initializer &&
          (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))) {
        return d.initializer;
      }
    }
    return null;
  };

  // Cycle guard keyed on the DECLARATION node, not a name: two different functions
  // can share a name across scopes, and one function can be reached by two paths.
  const seen = new Set<ts.Node>([entry]);
  const reaches = (fn: ts.FunctionLikeDeclaration): boolean => {
    const body = fn.body;
    if (!body) return false;
    let hit = false;
    const callees: ts.Identifier[] = [];
    reachableCalls(body, (c) => { if (isFsRead(c)) hit = true; }, (id) => callees.push(id));
    if (hit) return true;
    for (const id of callees) {
      const next = declarationOf(id);
      if (!next || seen.has(next)) continue;
      seen.add(next);
      if (reaches(next)) return true;
    }
    return false;
  };
  return reaches(entry);
}

function callsImportedEnsureStorageLayout(root: string, rel: string): boolean {
  const program = singleFileProgram(root, rel);
  if (!program) return false; // unresolvable => fail closed
  const abs = path.join(root, rel);
  const sf = program.getSourceFiles().find((f) => path.resolve(f.fileName) === path.resolve(abs));
  if (!sf) return false;
  const checker = program.getTypeChecker();
  let found = false;
  // The canonical IMPLEMENTATION satisfies the law by definition — it is the
  // bootstrap, not a caller that forgot to import it. Three conditions, all
  // required, because "exports a function with the right name" is a hole an
  // empty stub walks through (codex G-lane r1):
  //   1. the file IS the canonical implementation path, and
  //   2. it exports `function ensureStorageLayout`, and
  //   3. that function's BODY actually performs the marker read (an fs read/stat
  //      call reachable inside it, directly or through a helper it calls).
  // A stub that exports the name and returns is NOT exempt and is flagged.
  if (liveOf(rel) === CANONICAL_ENSURE_STORAGE_LAYOUT && exportsRealBootstrap(root, rel, sf)) return true;
  eachNode(sf, (n) => {
    if (found || !ts.isCallExpression(n)) return;
    const e = n.expression;
    if (ts.isIdentifier(e)) {
      const sym = checker.getSymbolAtLocation(e);
      if (declaresImportedEnsure(sym, false)) found = true;
      return;
    }
    if (ts.isPropertyAccessExpression(e) && e.name.text === "ensureStorageLayout") {
      let base: ts.Expression = e.expression;
      while (ts.isPropertyAccessExpression(base)) base = base.expression;
      if (!ts.isIdentifier(base)) return;
      const sym = checker.getSymbolAtLocation(base);
      if (declaresImportedEnsure(sym, true)) found = true;
    }
  });
  return found;
}

/**
 * Committed compile outputs. The generic walker skips `dist/` (it is regenerated and
 * noisy), but `hooks/dist/**` and `runtime/**` ARE the graph users execute (KTD7), so
 * the write-capable entry scan reaches them explicitly.
 */
function compiledOutputs(root: string): string[] {
  const out: string[] = [];
  for (const base of ["hooks/dist", "hooks/agent-team/dist", "runtime", "runtime/scripts"]) {
    if (!isDir(path.join(root, base))) continue;
    for (const f of walk(path.join(root, base))) {
      if (/\.(js|mjs|cjs)$/.test(f)) out.push(`${base}/${f}`);
    }
  }
  return out;
}

function writeCapableEntries(ctx: Ctx): Array<{ kind: string; source: string }> {
  const out: Array<{ kind: string; source: string }> = [];
  for (const { event, source } of hookSources(ctx)) {
    out.push({ kind: `${event} hook`, source });
  }
  // TypeScript authoring sources, the committed JavaScript graph users run, AND every
  // shell/shebang script under the entry roots — registered in hooks.json or not.
  // There is NO string-literal prefilter: write-capability is decided on raw text by
  // the check itself, so a `.guild` path inside a comment keeps the file in scope.
  const ENTRY_ROOTS = [
    "scripts/", "mcp-servers/", "src/runtime/", "runtime/", "hooks/", ".githooks/",
  ];
  const excluded = (f: string) =>
    f.endsWith(".d.ts") ||
    isFixturePath(f) ||
    f.includes("__tests__/") ||
    f.includes("node_modules/") ||
    /\.test\.(ts|js)$/.test(f);
  // Membership stays on the RAW path: `liveOf` governs exemption and classification,
  // never which prefixes a check scans. Widening scope here would pull ~150 mirror
  // files in as fresh findings and force the baseline to grow — the opposite of the
  // shrink-only rule. A mirror already in scope is CLASSIFIED by its live path below.
  const cliCandidates = [...ctx.files, ...compiledOutputs(ctx.root)].filter(
    (f) => !excluded(f) && ENTRY_ROOTS.some((p) => f.startsWith(p)) &&
      (/\.(ts|js|mjs|cjs)$/.test(f) || isShellEntry(ctx.root, f)),
  );
  for (const f of [...new Set(cliCandidates)].sort()) {
    if (isLayoutLawsSource(f)) continue; // this lint writes only its own baseline
    // `runtime/**` is COMPILED from an entry that is itself in this candidate set
    // (scripts/compile.ts owns the table). A bundle can only carry the violation its
    // source carries, so flagging both double-counts one program and would force a
    // baseline to GROW when a lane merely starts shipping a compiled copy. Fix the
    // source and the bundle follows. `hooks/**/dist` stays in scope: those bundles
    // predate the compile step and can be stale relative to their .ts.
    if (liveOf(f).startsWith("runtime/")) continue;
    const shell = isShellEntry(ctx.root, f);
    const live = liveOf(f);
    const kind = live.startsWith("mcp-servers/") ? "MCP binary"
      : live.startsWith(".githooks/") ? "git hook script"
      : live.startsWith("src/runtime/") || live.startsWith("runtime/") ? "runtime graph entry"
      : live.startsWith("hooks/") ? (shell ? "hook script" : "hook module")
      : shell ? "scripts shell entrypoint"
      : "scripts CLI entrypoint";
    out.push({ kind, source: f });
  }
  const seen = new Set<string>();
  return out
    .filter((e) => { if (seen.has(e.source)) return false; seen.add(e.source); return true; })
    .sort((a, b) => (a.source < b.source ? -1 : 1));
}

// ---------------------------------------------------------------- the 24 checks
const CHECKS: Check[] = [
  {
    id: "skills-glob-17",
    ktd: "KTD59",
    title: "plugin.json skills glob resolves to exactly the 17 assembler names",
    run(ctx) {
      const v: Violation[] = [];
      const resolved = resolveIndexedSkills(ctx);
      for (const s of resolved) {
        if (!ASSEMBLER_NAMES_17.includes(s.id)) {
          v.push({ check: "skills-glob-17", path: s.dir, detail: `indexed skill '${s.id}' is not one of the 17 assemblers` });
        }
      }
      const present = new Set(resolved.map((s) => s.id));
      for (const want of ASSEMBLER_NAMES_17) {
        if (!present.has(want)) {
          v.push({ check: "skills-glob-17", path: ".claude-plugin/plugin.json", detail: `assembler '${want}' is missing from the skills glob` });
        }
      }
      return v;
    },
  },
  {
    id: "agents-glob-4",
    ktd: "KTD19",
    title: "plugin.json agents glob is exactly the 4 machinery agents",
    run(ctx) {
      const v: Violation[] = [];
      const entries: string[] = Array.isArray(ctx.manifest?.agents) ? ctx.manifest.agents : [];
      const ids = entries.map((e) => path.basename(String(e), ".md"));
      for (const id of ids) {
        if (!MACHINERY_AGENTS_4.includes(id)) {
          v.push({ check: "agents-glob-4", path: ".claude-plugin/plugin.json", detail: `agent '${id}' is not a machinery agent` });
        }
      }
      for (const want of MACHINERY_AGENTS_4) {
        if (!ids.includes(want)) {
          v.push({ check: "agents-glob-4", path: ".claude-plugin/plugin.json", detail: `machinery agent '${want}' is missing from the agents glob` });
        }
      }
      return v;
    },
  },
  {
    id: "no-dispatched-claude-agents",
    ktd: "KTD24",
    title: "shipped surfaces never dispatch .claude/agents (authoring-only)",
    run(ctx) {
      const v: Violation[] = [];
      for (const f of under(ctx.files, ...SURFACE_PREFIXES, "hooks/", ...DOMAIN_PREFIXES)) {
        if (isFixturePath(f) || isLayoutLawsSource(f)) continue;
        const body = read(path.join(ctx.root, f));
        if (!body.includes(".claude/agents")) continue;
        v.push({ check: "no-dispatched-claude-agents", path: f, detail: "shipped surface references .claude/agents" });
      }
      return v;
    },
  },
  {
    id: "no-authored-registry-sot",
    ktd: "KTD44/KTD56",
    title: "no authored loops/registry.yaml or workflows/registry.yaml as source of truth",
    run(ctx) {
      const v: Violation[] = [];
      for (const f of ctx.files) {
        if (f.startsWith(".guild/") || isFixturePath(f)) continue;
        if (/(^|\/)(loops|workflows)\/registry\.ya?ml$/.test(f)) {
          v.push({ check: "no-authored-registry-sot", path: f, detail: "authored registry YAML is not source of truth" });
        }
      }
      return v;
    },
  },
  {
    id: "no-ts-workflows-dir",
    ktd: "KTD27",
    title: "no TypeScript workflows/ directory under src/",
    run(ctx) {
      return ctx.dirs
        .filter((d) => d.startsWith("src/") && path.basename(d) === "workflows")
        .map((d) => ({ check: "no-ts-workflows-dir", path: d, detail: "workflows/ directory name is retired" }));
    },
  },
  {
    id: "index-only-domain-imports",
    ktd: "KTD27",
    title: "cross-domain imports resolve to src/<tree>/<domain>/index only",
    run(ctx) {
      const v: Violation[] = [];
      const domainOf = (f: string) => {
        const m = f.match(/^src\/(modules|domains)\/([^/]+)\//);
        return m ? { tree: m[1], name: m[2] } : null;
      };
      for (const f of tsFiles(ctx, ["src/"])) {
        const self = domainOf(f);
        // import / export-from / require() / dynamic import(), via the AST.
        for (const spec of moduleSpecifiers(ctx.root, f)) {
          if (!spec.startsWith(".")) continue;
          const resolved = path
            .normalize(path.join(path.dirname(f), spec))
            .replace(/\\/g, "/")
            .replace(/\.(ts|tsx|js)$/, "");
          const target = domainOf(`${resolved}/`);
          if (!target) continue;
          if (self && self.name === target.name && self.tree === target.tree) continue;
          const tail = resolved.slice(`src/${target.tree}/${target.name}/`.length);
          if (tail === "index" || tail === "") continue;
          v.push({
            check: "index-only-domain-imports",
            path: f,
            detail: `imports '${spec}' past ${target.name}/index`,
          });
        }
      }
      return v;
    },
  },
  {
    id: "no-website-benchmark-import",
    ktd: "KTD66",
    title: "plugin TypeScript never imports website/ or benchmark/ source",
    run(ctx) {
      const v: Violation[] = [];
      for (const f of tsFiles(ctx, ["src/", "hooks/", "scripts/", "mcp-servers/"])) {
        for (const spec of moduleSpecifiers(ctx.root, f)) {
          if (/(^|\/)(website|benchmark)\//.test(spec)) {
            v.push({ check: "no-website-benchmark-import", path: f, detail: `imports sibling repo '${spec}'` });
          }
        }
      }
      return v;
    },
  },
  {
    id: "write-entry-calls-ensure-storage-layout",
    ktd: "KTD23",
    title: "every entry naming a .guild path calls the layout bootstrap (raw-text rule)",
    // RAW-TEXT and fail closed. Write-capable == the file's text contains `.guild`;
    // how it reaches fs is irrelevant. Shell entries must invoke the compiled
    // bootstrap on a line outside heredocs and quoted strings; JS/TS entries must
    // call an IMPORTED `ensureStorageLayout`. Out of scope by design: building the
    // string ".guild" by concatenation. These are KTD regression guards, not a sandbox.
    run(ctx) {
      const v: Violation[] = [];
      for (const { kind, source } of writeCapableEntries(ctx)) {
        if (!read(path.join(ctx.root, source)).includes(".guild")) continue;
        if (isShellEntry(ctx.root, source)) {
          const verdict = shellBootstrapVerdict(ctx.root, source);
          if (verdict.ok) continue;
          v.push({
            check: "write-entry-calls-ensure-storage-layout",
            path: source,
            detail: `${kind} names a .guild path and ${verdict.reason}`,
          });
          continue;
        }
        if (callsImportedEnsureStorageLayout(ctx.root, source)) continue;
        v.push({
          check: "write-entry-calls-ensure-storage-layout",
          path: source,
          detail: `${kind} names a .guild path with no call to an imported ensureStorageLayout`,
        });
      }
      return v;
    }
  },
  {
    id: "sessionstart-projects-guild",
    ktd: "KTD31",
    title: "SessionStart on a Guild root bootstraps AND projects the Guild surface",
    run(ctx) {
      const starts = hookSources(ctx).filter((h) => h.event === "SessionStart");
      if (starts.length === 0) {
        return [{ check: "sessionstart-projects-guild", path: "hooks/hooks.json", detail: "no SessionStart hook is registered" }];
      }
      const where = starts.map((s) => s.source).join(",");
      const v: Violation[] = [];
      for (const req of SESSION_START_REQUIRED_CALLS) {
        const satisfied = starts.some((h) => callsAnything(ctx.root, h.source, req.names));
        if (!satisfied) {
          v.push({
            check: "sessionstart-projects-guild",
            path: where,
            detail: `no SessionStart source calls ${req.label}`,
          });
        }
      }
      return v;
    },
  },
  {
    id: "latest-only-context-files",
    ktd: "KTD32",
    title: "no dated \"Update (…)\" appendix or changelog in prompt-loaded markdown",
    run(ctx) {
      const v: Violation[] = [];
      const targets = [
        // `.claude/agents/**` is authoring-only but still context-loaded (KTD24 rank 3
        // neighbourhood), so it obeys the same latest-only law.
        ...under(ctx.files, ...SURFACE_PREFIXES, ".claude/agents/").filter((f) => f.endsWith(".md")),
        ...ctx.files.filter((f) => f === "AGENTS.md" || f === "CLAUDE.md"),
      ];
      for (const f of targets) {
        if (isFixturePath(f)) continue;
        const lines = read(path.join(ctx.root, f)).split("\n");
        lines.forEach((line, i) => {
          if (/^\s*#{0,6}\s*\**Update\s*\(\s*\d{4}[-/]\d{2}/.test(line) ||
              /^\s*#{1,6}\s*Changelog\b/i.test(line)) {
            v.push({ check: "latest-only-context-files", path: `${f}:${i + 1}`, detail: "dated update / changelog block in a prompt-loaded file" });
          }
        });
      }
      return v;
    },
  },
  {
    id: "no-hardcoded-tmp-in-domain-ts",
    ktd: "KTD34",
    title: "no hardcoded /tmp in domain TypeScript",
    run(ctx) {
      const v: Violation[] = [];
      for (const f of tsFiles(ctx, DOMAIN_PREFIXES)) {
        if (f.endsWith(".test.ts")) continue;
        const lines = read(path.join(ctx.root, f)).split("\n");
        lines.forEach((line, i) => {
          if (/["'`]\/tmp[/"'`]/.test(line)) {
            v.push({ check: "no-hardcoded-tmp-in-domain-ts", path: `${f}:${i + 1}`, detail: "hardcoded /tmp; use GuildStorage.temporary()" });
          }
        });
      }
      return v;
    },
  },
  {
    id: "specialists-never-write-wiki",
    ktd: "KTD35",
    title: "specialist surfaces never instruct a wiki Write",
    run(ctx) {
      const v: Violation[] = [];
      const specialistFiles = ctx.files.filter(
        (f) => /(^|\/)specialists\//.test(f) && f.endsWith(".md") && !isFixturePath(f),
      );
      for (const f of specialistFiles) {
        const lines = read(path.join(ctx.root, f)).split("\n");
        lines.forEach((line, i) => {
          if (line.includes(".guild/wiki") && /\bWrite\b|\bwrite to\b|\bwrites\b/.test(line)) {
            v.push({ check: "specialists-never-write-wiki", path: `${f}:${i + 1}`, detail: "specialist surface writes the wiki" });
          }
        });
      }
      return v;
    },
  },
  {
    id: "harvest-writer-calls-scrubbed-write",
    ktd: "KTD37",
    title: "any wiki writer in domain TypeScript goes through scrubbedWrite",
    run(ctx) {
      const v: Violation[] = [];
      for (const f of tsFiles(ctx, DOMAIN_PREFIXES)) {
        if (f.endsWith(".test.ts") || isLayoutLawsSource(f)) continue;
        // The canonical IMPLEMENTATION of scrubbedWrite cannot call scrubbedWrite;
        // it IS the scrubbing write. Same three conditions as the layout-bootstrap
        // exemption: canonical path, exported by that name, real body. Anything
        // else that merely exports the name is still flagged.
        if (liveOf(f) === CANONICAL_SCRUBBED_WRITE && exportsNamed(ctx.root, f, "scrubbedWrite")) continue;
        if (!performsWrite(ctx.root, f)) continue;
        if (!targetsWikiRawText(ctx.root, f)) continue;
        // A comment or a string saying "scrubbedWrite" is not a call site.
        if (hasCallTo(ctx.root, f, "scrubbedWrite")) continue;
        v.push({ check: "harvest-writer-calls-scrubbed-write", path: f, detail: "writes the wiki without a call to scrubbedWrite" });
      }
      return v;
    },
  },
  {
    id: "no-sixth-workflow-class",
    ktd: "KTD40",
    title: "exactly five authored class graphs at src/surfaces/graphs/",
    run(ctx) {
      const v: Violation[] = [];
      const graphs = ctx.files.filter((f) => /^src\/surfaces\/graphs\/[^/]+\.ya?ml$/.test(f));
      if (graphs.length === 0) {
        return [{ check: "no-sixth-workflow-class", path: "src/surfaces/graphs/", detail: "no authored class graphs exist yet" }];
      }
      const ids = graphs.map((f) => path.basename(f).replace(/\.ya?ml$/, ""));
      for (const id of ids) {
        if (!WORKFLOW_CLASSES_5.includes(id)) {
          v.push({ check: "no-sixth-workflow-class", path: `src/surfaces/graphs/${id}.yaml`, detail: `'${id}' is not one of the five classes` });
        }
      }
      for (const want of WORKFLOW_CLASSES_5) {
        if (!ids.includes(want)) {
          v.push({ check: "no-sixth-workflow-class", path: "src/surfaces/graphs/", detail: `class graph '${want}' is missing` });
        }
      }
      return v;
    },
  },
  {
    id: "overlay-cannot-drop-required-nodes",
    ktd: "KTD42",
    title: "an overlay omitting a protected node is REJECTED when the validator is executed",
    // Behavioral oracle, not static analysis: the validator is imported at lint time
    // and called with a synthetic plugin default graph plus an overlay that drops
    // `product.qa`. Pass requires a throw or a failure return. A missing module, an
    // unloadable module, an absent export, or any other outcome is a violation.
    async run(ctx) {
      return await runOverlayOracle(ctx);
    }
  },
  {
    id: "checkpoint-never-writes-wiki",
    ktd: "KTD43",
    title: "LearningCheckpoint classifies only; it never writes the wiki",
    run(ctx) {
      const v: Violation[] = [];
      const targets = ctx.files.filter(
        (f) => /learning[-_]?checkpoint/i.test(f) && !isFixturePath(f) &&
          (f.endsWith(".ts") || f.endsWith(".md")),
      );
      for (const f of targets) {
        const body = read(path.join(ctx.root, f));
        const writesWiki = /\.guild\/wiki/.test(body) && (WRITE_CALL.test(body) || /\bWrite\b/.test(body));
        if (writesWiki) {
          v.push({ check: "checkpoint-never-writes-wiki", path: f, detail: "LearningCheckpoint surface writes the wiki" });
        }
      }
      return v;
    },
  },
  {
    id: "no-durable-skill-versions",
    ktd: "KTD48",
    title: "nothing writes a durable .guild/skill-versions/ tree",
    run(ctx) {
      const v: Violation[] = [];
      for (const f of under(ctx.files, ...DOMAIN_PREFIXES, "hooks/", ...SURFACE_PREFIXES)) {
        if (isFixturePath(f) || f.endsWith(".test.ts") || isLayoutLawsSource(f)) continue;
        const lines = read(path.join(ctx.root, f)).split("\n");
        lines.forEach((line, i) => {
          if (line.includes("skill-versions")) {
            v.push({ check: "no-durable-skill-versions", path: `${f}:${i + 1}`, detail: "references a durable skill-versions/ tree" });
          }
        });
      }
      return v;
    },
  },
  {
    id: "no-guild-raw-writes",
    ktd: "KTD47",
    title: "nothing writes .guild/raw (ingested blobs are definition sources)",
    run(ctx) {
      const v: Violation[] = [];
      for (const f of under(ctx.files, ...DOMAIN_PREFIXES, "hooks/", ...SURFACE_PREFIXES)) {
        if (isFixturePath(f) || f.endsWith(".test.ts") || isLayoutLawsSource(f)) continue;
        const lines = read(path.join(ctx.root, f)).split("\n");
        lines.forEach((line, i) => {
          if (/\.guild\/raw\b/.test(line)) {
            v.push({ check: "no-guild-raw-writes", path: `${f}:${i + 1}`, detail: "references .guild/raw" });
          }
        });
      }
      return v;
    },
  },
  {
    id: "refresh-touched-scope",
    ktd: "KTD50",
    title: "refreshTouched never touches the graph or the recall projection",
    run(ctx) {
      const v: Violation[] = [];
      for (const f of tsFiles(ctx, DOMAIN_PREFIXES)) {
        if (isLayoutLawsSource(f)) continue;
        const body = read(path.join(ctx.root, f));
        if (!body.includes("refreshTouched")) continue;
        for (const forbidden of ["knowledge-recall.json", "knowledge-graph.json", "validate-graph"]) {
          if (body.includes(forbidden)) {
            v.push({ check: "refresh-touched-scope", path: f, detail: `refreshTouched module references ${forbidden}` });
          }
        }
      }
      return v;
    },
  },
  {
    id: "learning-checkpoint-not-indexed",
    ktd: "KTD57",
    title: "learning-checkpoint is a domain function, not an indexed skill",
    run(ctx) {
      return resolveIndexedSkills(ctx)
        .filter((s) => /^learning[-_]?checkpoint$/.test(s.id))
        .map((s) => ({ check: "learning-checkpoint-not-indexed", path: s.dir, detail: "learning-checkpoint is in the skills glob" }));
    },
  },
  {
    id: "no-14th-command-file",
    ktd: "KTD20/KTD69",
    title: "command files are the 13 dispatchers plus allowlisted print-only aliases",
    run(ctx) {
      const v: Violation[] = [];
      const allow = aliasAllowlist(ctx);
      const files = commandFiles(ctx);
      if (files.length === 0) {
        return [{ check: "no-14th-command-file", path: "commands/", detail: "no command files found; the 13 dispatchers must exist" }];
      }
      const present = new Set(files.map((f) => path.basename(f, ".md")));
      for (const f of files) {
        const id = path.basename(f, ".md");
        if (COMMAND_NAMES_13.includes(id) || allow.includes(id)) continue;
        v.push({ check: "no-14th-command-file", path: f, detail: `'${id}' is neither a dispatcher nor an allowlisted alias` });
      }
      // An empty or hollowed-out tree must not pass by having nothing to reject.
      for (const want of COMMAND_NAMES_13) {
        if (!present.has(want)) {
          v.push({ check: "no-14th-command-file", path: "commands/", detail: `dispatcher '${want}' is missing` });
        }
      }
      return v;
    },
  },
  {
    id: "command-max-40-lines",
    ktd: "KTD24",
    title: "every command file is thin dispatch (≤40 lines)",
    run(ctx) {
      const v: Violation[] = [];
      const files = commandFiles(ctx);
      if (files.length === 0) {
        return [{ check: "command-max-40-lines", path: "commands/", detail: "no command files found; nothing to measure" }];
      }
      for (const f of files) {
        const n = read(path.join(ctx.root, f)).replace(/\n$/, "").split("\n").length;
        if (n > 40) {
          v.push({ check: "command-max-40-lines", path: f, detail: `${n} lines > 40` });
        }
      }
      return v;
    },
  },
  {
    id: "glossary-not-indexed-skill",
    ktd: "KTD70",
    title: "the glossary is a wiki page, never an 18th indexed skill",
    run(ctx) {
      const v: Violation[] = [];
      for (const s of resolveIndexedSkills(ctx)) {
        if (/glossar/i.test(s.id)) {
          v.push({ check: "glossary-not-indexed-skill", path: s.dir, detail: "glossary shipped as an indexed skill" });
        }
      }
      for (const f of under(ctx.files, ...SURFACE_PREFIXES)) {
        if (/\/glossary\/(SKILL\.md|SKILL\.src\.md)$/.test(f)) {
          v.push({ check: "glossary-not-indexed-skill", path: f, detail: "glossary authored as a skill folder" });
        }
      }
      return v;
    },
  },
  {
    id: "glossary-not-in-always-on-prefix",
    ktd: "KTD70",
    title: "the full glossary is never pasted into the always-on prefix",
    run(ctx) {
      const v: Violation[] = [];
      const prefixFiles = ctx.files.filter(
        (f) => f === "AGENTS.md" || f === "CLAUDE.md" || /using-guild\/SKILL(\.src)?\.md$/.test(f),
      );
      for (const f of prefixFiles) {
        const body = read(path.join(ctx.root, f));
        const lines = body.split("\n");
        lines.forEach((line, i) => {
          if (/^\s*#{1,6}\s*Glossary\b/i.test(line)) {
            v.push({ check: "glossary-not-in-always-on-prefix", path: `${f}:${i + 1}`, detail: "glossary heading in an always-on file" });
          }
        });
        const termLines = lines.filter((l) => /^\s*[-*]\s+\*\*[^*]+\*\*\s*[—:-]\s+/.test(l)).length;
        if (termLines >= 12) {
          v.push({ check: "glossary-not-in-always-on-prefix", path: f, detail: `${termLines} term-definition lines look like a glossary dump` });
        }
      }
      return v;
    },
  },
];

// ---------------------------------------------------------------- runner
function buildCtx(root: string): Ctx {
  return {
    root,
    files: walk(root),
    dirs: walkDirs(root),
    manifest: readJson(path.join(root, ".claude-plugin/plugin.json")) ?? {},
  };
}

async function runChecks(root: string, only?: string): Promise<Violation[]> {
  const ctx = buildCtx(root);
  const out: Violation[] = [];
  for (const c of CHECKS) {
    if (only && c.id !== only) continue;
    for (const v of await c.run(ctx)) out.push(v);
  }
  return out.sort((a, b) => (key(a) < key(b) ? -1 : 1));
}

function repoRoot(): string {
  // scripts/lint/ -> plugin root. Falls back to cwd when __dirname is absent (ESM).
  const here = typeof __dirname !== "undefined" ? __dirname : path.join(process.cwd(), "lint");
  return path.resolve(here, "..", "..");
}

function baselinePath(root: string): string {
  return path.join(root, "scripts/lint/layout-baseline.json");
}

function loadBaseline(root: string): Set<string> {
  const j = readJson(baselinePath(root));
  return new Set<string>(Array.isArray(j?.entries) ? j.entries.map(String) : []);
}

async function main(argv: string[]): Promise<number> {
  const flag = (n: string) => argv.includes(`--${n}`);
  const opt = (n: string) => {
    const hit = argv.find((a) => a.startsWith(`--${n}=`));
    return hit ? hit.slice(n.length + 3) : undefined;
  };

  const root = path.resolve(opt("root") ?? repoRoot());
  const only = opt("check");

  if (flag("fixtures")) return await runFixtures(root);

  const violations = await runChecks(root, only);
  const useBaseline = !flag("no-baseline");
  const baseline = useBaseline ? loadBaseline(root) : new Set<string>();

  if (flag("write-baseline")) {
    const payload = {
      schema: "guild.layout_baseline.v1",
      note: "Violations present on the tree when U1 landed. Later lanes may only REMOVE entries; T16 deletes this file.",
      checks: CHECKS.map((c) => c.id),
      entries: violations.map(key),
    };
    fs.writeFileSync(baselinePath(root), `${JSON.stringify(payload, null, 2)}\n`);
    console.log(`wrote ${violations.length} baseline entries to scripts/lint/layout-baseline.json`);
    return 0;
  }

  const byCheck = new Map<string, { open: Violation[]; waived: Violation[] }>();
  for (const c of CHECKS) byCheck.set(c.id, { open: [], waived: [] });
  for (const v of violations) {
    const bucket = byCheck.get(v.check);
    if (!bucket) continue;
    (baseline.has(key(v)) ? bucket.waived : bucket.open).push(v);
  }

  const stale = [...baseline].filter((b) => !violations.some((v) => key(v) === b));

  if (flag("json")) {
    console.log(JSON.stringify({ violations, baselined: baseline.size, stale }, null, 2));
  } else {
    console.log(`layout-laws — ${CHECKS.length} checks · root ${path.relative(process.cwd(), root) || "."} · baseline ${useBaseline ? `${baseline.size} entries` : "OFF"}`);
    for (const c of CHECKS) {
      if (only && c.id !== only) continue;
      const b = byCheck.get(c.id)!;
      const status = b.open.length === 0 ? "PASS" : "FAIL";
      const waived = b.waived.length ? ` (+${b.waived.length} baselined)` : "";
      console.log(`  ${status}  ${c.id.padEnd(42)} ${c.ktd.padEnd(11)} open=${b.open.length}${waived}  ${c.title}`);
      for (const v of b.open.slice(0, 12)) console.log(`        · ${v.path} — ${v.detail}`);
      if (b.open.length > 12) console.log(`        · … ${b.open.length - 12} more`);
    }
    const open = [...byCheck.values()].reduce((n, b) => n + b.open.length, 0);
    console.log(`total: ${violations.length} violations · ${violations.length - open} baselined · ${open} open`);
    if (stale.length) {
      console.log(`note: ${stale.length} baseline entries no longer reproduce — a lane fixed them; run --write-baseline to shrink.`);
    }
  }

  const open = [...byCheck.values()].reduce((n, b) => n + b.open.length, 0);
  return open === 0 ? 0 : 1;
}

/** Anti-vacuity: every check must flag its own known-positive fixture. */
async function runFixtures(root: string): Promise<number> {
  const dir = path.join(root, "scripts/lint/__tests__/fixtures");
  let failed = 0;
  const all = isDir(dir) ? fs.readdirSync(dir).filter((d) => isDir(path.join(dir, d))).sort() : [];
  console.log(`layout-laws fixtures — ${CHECKS.length} checks, ${all.length} fixture trees`);
  for (const c of CHECKS) {
    // `<id>/` is the base fixture; `<id>.<variant>/` pins a specific bypass.
    const mine = all.filter((d) => d === c.id || d.startsWith(`${c.id}.`));
    if (!mine.includes(c.id)) {
      console.log(`  MISSING  ${c.id.padEnd(42)} no fixture at scripts/lint/__tests__/fixtures/${c.id}/`);
      failed++;
    }
    for (const name of mine) {
      // `<id>.__<variant>` is a NEGATIVE control: a compliant tree the check must
      // leave alone, so a check cannot pass anti-vacuity by failing everything.
      const negative = /\.__/.test(name);
      const hits = await runChecks(path.join(dir, name), c.id);
      const ok = negative ? hits.length === 0 : hits.length > 0;
      if (!ok) failed++;
      const label = negative ? (ok ? "CLEAN " : "OVERFLAG") : (ok ? "FLAGS " : "VACUOUS");
      const tail = !negative && ok ? ` — ${hits[0].path}: ${hits[0].detail}` : "";
      console.log(`  ${label}  ${name.padEnd(52)} hits=${hits.length}${tail}`);
    }
  }
  const orphan = all.filter((d) => !CHECKS.some((c) => d === c.id || d.startsWith(`${c.id}.`)));
  for (const o of orphan) {
    console.log(`  ORPHAN   ${o.padEnd(42)} fixture has no matching check`);
    failed++;
  }
  console.log(failed === 0 ? "all checks flag their fixture" : `${failed} check(s) did not flag their fixture`);
  return failed === 0 ? 0 : 1;
}

main(process.argv.slice(2)).then((code) => process.exit(code), (err) => {
  console.error(err);
  process.exit(2);
});
