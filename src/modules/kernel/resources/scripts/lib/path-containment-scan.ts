/**
 * scripts/lib/path-containment-scan.ts
 *
 * THE SCANNING SIDE OF THE PATH-CONTAINMENT RAIL.
 *
 * A TypeScript AST scan — NOT a regex — for two structural facts a regex cannot
 * see, both of which produced real misses in this repo:
 *
 *   • THE CLIMB is a control-flow shape, not a token. `while (!fs.existsSync(x)) {
 *     x = path.dirname(x) }`, `for (;;) { … probe = parent }`, and
 *     `while (!fs.existsSync(ancestor)) { const up = path.dirname(ancestor); … }`
 *     are the same construct spelled three ways, and they were. A grep for any one
 *     spelling finds one of them.
 *
 *   • THE MKDIR/WRITE PAIRING is a relationship between calls, not a call. The
 *     defect in variant 2(a) was the ORDER of `mkdirSync` and the check, which no
 *     amount of matching on `mkdirSync` alone can detect.
 *
 * ── WHAT IT LOOKS FOR ──────────────────────────────────────────────────────────
 * A file is a CONTAINMENT SITE when any function in it does either:
 *
 *   (A) CLIMB — calls `realpathSync` AND contains a loop whose body reassigns a
 *       variable from `path.dirname(<that same variable>)`. That is the
 *       deepest-existing-ancestor walk, however it is spelled.
 *
 *   (B) BOUNDED WRITE — calls `mkdirSync` with `{recursive: true}` AND calls
 *       `realpathSync` in the same function. That is a write being bounded by a
 *       root, which is the pairing this primitive owns.
 *
 * Importing the primitive does NOT suppress a finding — a file that imports it and
 * ALSO grows a private climb is still a site, and still has to justify itself. The
 * registry records what it is; the scanner only records that it is one.
 *
 * ── AND EVERY MIRROR ───────────────────────────────────────────────────────────
 * `resources/` mirrors are swept exactly like live files, and reported with the
 * live file they mirror. The S3 lane's second mirror surfaced through `git status`
 * rather than through any gate, which is a gate that stopped at the live tree.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as ts from "typescript";

import {
  CONTAINMENT_HOME,
  CONTAINMENT_SCAN_ROOTS,
  CONTAINMENT_SITES,
  type ContainmentSite,
} from "./path-containment-registry";

export type ContainmentEvidence = "climb" | "bounded-write" | "lexical-guard";

export interface ScannedSite {
  /** Repo-relative POSIX path. */
  readonly path: string;
  readonly evidence: readonly ContainmentEvidence[];
  /** Non-empty when this file is a `resources/` mirror of a live file. */
  readonly mirrorOf?: string;
  readonly importsPrimitive: boolean;
}

export type FindingCode =
  /** A containment site with no registry entry. The headline failure. */
  | "unregistered-site"
  /** A `resources/` mirror whose LIVE source is not a registered site. */
  | "unregistered-mirror"
  /** A registry entry naming a file that no longer exists. */
  | "stale-registration"
  /** A registry entry whose file the scanner no longer sees as a site. */
  | "registration-without-site"
  /** `status: "adopted"` but the file does not import the primitive. */
  | "adopted-without-import"
  /** `status: "adopted"` and the file grew its own climb back. */
  | "adopted-with-private-climb"
  /** More than one file, or the wrong file, claiming `status: "home"`. */
  | "home-mismatch"
  /** A waiver with no stated reason. */
  | "waiver-without-reason";

export interface Finding {
  readonly code: FindingCode;
  readonly path: string;
  readonly detail: string;
}

export interface ScanResult {
  readonly sites: readonly ScannedSite[];
  readonly findings: readonly Finding[];
}

const SOURCE_EXT = new Set([".ts", ".tsx", ".mts", ".cts"]);

/**
 * `dist/` is generated from the live tree and re-checked by the bundle-determinism
 * gate; `node_modules/` is not ours.
 *
 * `__tests__/` is skipped DELIBERATELY and the reason matters: the regression suite
 * for this very primitive TRANSCRIBES the historical buggy implementations verbatim,
 * as negative controls proving its fixtures are live. Those transcriptions are real
 * climbs. Scanning tests would flag the proof that the rule works as a violation of
 * the rule — and the obvious "fix" would be to delete the controls, which is exactly
 * the vacuity this whole change is trying not to commit.
 */
const SKIP_DIRS = new Set(["node_modules", "dist", "__tests__", ".git"]);

export function walkSourceFiles(root: string, rel = "", out: string[] = []): string[] {
  const abs = path.join(root, rel);
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(abs, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name.startsWith(".") && e.name !== ".claude-plugin") continue;
    const childRel = rel === "" ? e.name : `${rel}/${e.name}`;
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      walkSourceFiles(root, childRel, out);
    } else if (SOURCE_EXT.has(path.extname(e.name)) && !e.name.endsWith(".d.ts")) {
      out.push(childRel);
    }
  }
  return out;
}

/**
 * Local names bound to an fs/path function, however it was imported or destructured.
 *
 * Matching only the SPELLING `fs.realpathSync` / `realpathSync` is a token check
 * wearing an AST's clothes: `import { realpathSync as rp } from "node:fs"` and
 * `const { dirname: up } = path` both defeat it, and both are ordinary code someone
 * writes without any intent to evade. The alias map is built per file and consulted
 * by every call test below.
 */
type AliasMap = Map<string, string>;

/** The single call a `(p) => f(p)` / `function(p){ return f(p) }` wrapper delegates to. */
function wrapperTarget(node: ts.Expression, aliases: AliasMap): string | undefined {
  if (ts.isArrowFunction(node)) {
    if (ts.isBlock(node.body)) return wrapperTargetFromBlock(node.body, aliases);
    return callTargetName(node.body, aliases);
  }
  if (ts.isFunctionExpression(node) && node.body) return wrapperTargetFromBlock(node.body, aliases);
  return undefined;
}

function wrapperTargetFromBlock(block: ts.Block, aliases: AliasMap): string | undefined {
  const stmts = block.statements;
  if (stmts.length !== 1) return undefined;
  const only = stmts[0];
  if (!ts.isReturnStatement(only) || only.expression === undefined) return undefined;
  return callTargetName(only.expression, aliases);
}

function callTargetName(expr: ts.Expression, aliases: AliasMap): string | undefined {
  if (!ts.isCallExpression(expr)) return undefined;
  const raw = expr.expression.getText().replace(/\s/g, "");
  const tail = raw.split(".").pop() ?? raw;
  return aliases.get(tail) ?? tail;
}

function collectAliases(sf: ts.SourceFile): AliasMap {
  const aliases: AliasMap = new Map();
  const note = (local: string, canonical: string): void => {
    aliases.set(local, canonical);
  };
  const visit = (n: ts.Node): void => {
    // import { realpathSync as rp } from "fs"
    if (ts.isImportDeclaration(n) && n.importClause?.namedBindings) {
      const nb = n.importClause.namedBindings;
      if (ts.isNamedImports(nb)) {
        for (const el of nb.elements) {
          note(el.name.getText(), (el.propertyName ?? el.name).getText());
        }
      }
    }
    // const { realpathSync, dirname: up } = fs / require("fs")
    if (ts.isVariableDeclaration(n) && n.name && ts.isObjectBindingPattern(n.name)) {
      for (const el of n.name.elements) {
        if (ts.isIdentifier(el.name)) {
          note(el.name.getText(), (el.propertyName ?? el.name).getText());
        }
      }
    }
    // const up = (p) => path.dirname(p)   /   function up(p){ return path.dirname(p) }
    //
    // A one-line WRAPPER, which an adversarial pass used to walk straight through
    // the scan: `const up = (p) => path.dirname(p); while (!existsSync(p)) p = up(p)`
    // is the same climb, and matching call NAMES could not see it. A wrapper whose
    // body is a single call to an fs/path function is treated as that function.
    if (ts.isVariableDeclaration(n) && n.name && ts.isIdentifier(n.name) && n.initializer) {
      const body = wrapperTarget(n.initializer, aliases);
      if (body !== undefined) note(n.name.getText(), body);
    }
    if (ts.isFunctionDeclaration(n) && n.name && n.body) {
      const body = wrapperTargetFromBlock(n.body, aliases);
      if (body !== undefined) note(n.name.getText(), body);
    }
    // const rp = fs.realpathSync   (a VALUE alias, not a destructure)
    if (
      ts.isVariableDeclaration(n) &&
      n.name &&
      ts.isIdentifier(n.name) &&
      n.initializer !== undefined &&
      (ts.isPropertyAccessExpression(n.initializer) || ts.isIdentifier(n.initializer))
    ) {
      const init = n.initializer.getText().replace(/\s/g, "");
      const tail = init.split(".").pop() ?? init;
      note(n.name.getText(), aliases.get(tail) ?? tail);
    }
    ts.forEachChild(n, visit);
  };
  ts.forEachChild(sf, visit);
  return aliases;
}

/** The canonical fs/path function a call expression targets, if any. */
function calleeName(node: ts.CallExpression, aliases: AliasMap): string {
  const raw = node.expression.getText().replace(/\s/g, "");
  const tail = raw.split(".").pop() ?? raw;
  // A bare identifier may be an alias; a `x.y` form names its own member.
  if (raw === tail) return aliases.get(raw) ?? raw;
  return tail;
}

/** `fs.realpathSync(...)` / `realpathSync(...)` / `fs.realpathSync.native(...)`. */
function isRealpathCall(node: ts.Node, aliases: AliasMap): boolean {
  if (!ts.isCallExpression(node)) return false;
  const raw = node.expression.getText().replace(/\s/g, "");
  if (/\.realpathSync\.native$/.test(raw)) return true;
  return calleeName(node, aliases) === "realpathSync";
}

/** `fs.mkdirSync(x, { recursive: true })`. */
function isRecursiveMkdir(node: ts.Node, aliases: AliasMap): boolean {
  if (!ts.isCallExpression(node)) return false;
  if (calleeName(node, aliases) !== "mkdirSync") return false;
  return node.arguments.some(
    (a) =>
      ts.isObjectLiteralExpression(a) &&
      a.properties.some((p) => p.name?.getText() === "recursive")
  );
}

/**
 * A PARENT STEP — an expression that yields the parent of a path — returning the
 * path it steps up from.
 *
 * Two forms, because `dirname` is not the only way anyone writes it:
 *   • `path.dirname(x)` (or any alias of it)
 *   • `path.parse(x).dir`
 * Matching only `dirname` made the rail miss the second, which is ordinary code.
 */
function dirnameArg(node: ts.Node, aliases: AliasMap): string | undefined {
  // path.parse(x).dir
  if (
    ts.isPropertyAccessExpression(node) &&
    node.name.getText() === "dir" &&
    ts.isCallExpression(node.expression) &&
    calleeName(node.expression, aliases) === "parse"
  ) {
    const a = node.expression.arguments[0];
    return a ? a.getText() : undefined;
  }
  if (!ts.isCallExpression(node)) return undefined;
  if (calleeName(node, aliases) !== "dirname") return undefined;
  const a = node.arguments[0];
  return a ? a.getText() : undefined;
}

/**
 * A CLIMB: inside a loop, some variable is assigned `path.dirname(<itself>)`,
 * OR assigned `path.dirname(v)` where `v` is later assigned from that assignment.
 * The first form covers `x = path.dirname(x)`; the second covers the
 * `const up = path.dirname(ancestor); ancestor = up;` spelling in roster.ts.
 */
function loopContainsDirnameWalk(loop: ts.Node, aliases: AliasMap): boolean {
  let direct = false;
  const dirnameTargets = new Map<string, string>(); // declared name -> dirname arg
  const reassigned = new Set<string>(); // name -> assigned from some identifier

  const visit = (n: ts.Node): void => {
    if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      const lhs = n.left.getText();
      const arg = dirnameArg(n.right, aliases);
      if (arg !== undefined && arg === lhs) direct = true;
      if (ts.isIdentifier(n.right) && dirnameTargets.get(n.right.getText()) === lhs) {
        direct = true;
      }
      if (ts.isIdentifier(n.right)) reassigned.add(lhs);
    }
    if (ts.isVariableDeclaration(n) && n.initializer) {
      const arg = dirnameArg(n.initializer, aliases);
      if (arg !== undefined && n.name) dirnameTargets.set(n.name.getText(), arg);
    }
    ts.forEachChild(n, visit);
  };
  ts.forEachChild(loop, visit);
  void reassigned;
  return direct;
}

/**
 * A RECURSIVE CLIMB — the same walk written without a loop:
 *
 *     function canonical(p) { try { return realpathSync(p) } catch { return canonical(dirname(p)) } }
 *
 * This is not a contrived evasion; it is how a functional-leaning author writes the
 * deepest-existing-ancestor walk, and a loop-only scan sees nothing. Detected by a
 * self-call whose argument contains a parent step.
 */
function containsRecursiveClimb(scope: ts.Node, aliases: AliasMap): boolean {
  const name =
    (ts.isFunctionDeclaration(scope) || ts.isFunctionExpression(scope)) && scope.name
      ? scope.name.getText()
      : ts.isVariableDeclaration(scope.parent ?? scope) &&
          ts.isIdentifier((scope.parent as ts.VariableDeclaration).name)
        ? (scope.parent as ts.VariableDeclaration).name.getText()
        : undefined;
  if (name === undefined) return false;
  let found = false;
  const visit = (n: ts.Node): void => {
    if (found) return;
    if (ts.isCallExpression(n) && n.expression.getText().replace(/\s/g, "") === name) {
      for (const a of n.arguments) {
        let hit = false;
        const scan = (m: ts.Node): void => {
          if (dirnameArg(m, aliases) !== undefined) hit = true;
          ts.forEachChild(m, scan);
        };
        if (dirnameArg(a, aliases) !== undefined) hit = true;
        ts.forEachChild(a, scan);
        if (hit) found = true;
      }
    }
    ts.forEachChild(n, visit);
  };
  ts.forEachChild(scope, visit);
  return found;
}

function isLoop(n: ts.Node): boolean {
  return (
    ts.isWhileStatement(n) ||
    ts.isForStatement(n) ||
    ts.isDoStatement(n) ||
    ts.isForOfStatement(n)
  );
}

interface FileEvidence {
  climb: boolean;
  boundedWrite: boolean;
  lexicalGuard: boolean;
}

/**
 * THE INLINE LEXICAL GUARD — the eleventh copy's shape, and the reason the tenth
 * being caught was not enough.
 *
 * `isLexicalContainmentHelper` only inspects FUNCTION DECLARATIONS, because the
 * tenth home (`run-lifecycle.ts`) factored its check into a named `assertContained`.
 * The eleventh (`promote-upstream.ts`) does not factor it at all:
 *
 *     const resolvedRunsDir = path.resolve(runsDir);
 *     if (!resolvedRunsDir.startsWith(runsBase + path.sep)) { …refuse… }
 *     fs.mkdirSync(runsDir, { recursive: true });
 *
 * Same defect, same file-level consequence, no function to recognise. A signal that
 * only sees the factored form finds the tidy copies and misses the untidy ones —
 * and the untidy ones are likelier, because factoring it out is what someone does
 * when they have already thought about it.
 *
 * Detected within ONE function scope: a `path.resolve`, a CONTAINMENT comparison,
 * and a write, with NO `realpath` anywhere in that scope. The comparison must be
 * `startsWith(<something> + path.sep)` — a bare `path.relative` is deliberately not
 * enough here, because that is what a label builder does and it produced three
 * false positives when the helper form was first written.
 */
interface InlineGuardEvidence {
  resolves: boolean;
  containmentCompare: boolean;
  writes: boolean;
  realpath: boolean;
}

/** Write-ish fs calls. A bounded write is one of these under a root check. */
const WRITE_CALLS = new Set([
  "mkdirSync",
  "writeFileSync",
  "appendFileSync",
  "copyFileSync",
  "cpSync",
  "renameSync",
  "openSync",
]);

/**
 * A LEXICAL CONTAINMENT HELPER: proves "inside the base" with string algebra only —
 * `path.resolve` plus a `startsWith(base + path.sep)` or `path.relative` escape test
 * — and never calls `realpath`.
 *
 * THIS IS THE MOST VALUABLE THING THE SCAN LOOKS FOR, and it was missing until a
 * third adversarial round pointed at `run-lifecycle.ts`. The climb and bounded-write
 * signals find code that has ALREADY been fixed once — someone reached for
 * `realpath`, which means they already knew. A purely lexical guard is the state
 * BEFORE anyone knows: it is exactly what the resolver lane rated CRITICAL, what the
 * Learn lane found, and what `station-signals` had to work around. `path.resolve` is
 * pure string algebra and knows nothing about links, so a symlinked `.guild/runs`
 * walks straight through one of these while it reports success.
 */
/**
 * Is this returned expression a VERDICT — something boolean-shaped — rather than a
 * value?
 *
 * The boundary matters in both directions and both were found empirically. Requiring
 * a boolean LITERAL missed `return t.startsWith(b + path.sep)`, the most natural way
 * anyone writes the helper. Accepting ANY call re-admitted a label builder whose body
 * is `return path.relative(root, p)` — a string. So: literals, negations, comparisons
 * and logical joins, and calls to the boolean-returning string/regex predicates.
 */
function isBooleanish(e: ts.Expression, aliases: AliasMap): boolean {
  if (e.kind === ts.SyntaxKind.TrueKeyword || e.kind === ts.SyntaxKind.FalseKeyword) return true;
  if (ts.isParenthesizedExpression(e)) return isBooleanish(e.expression, aliases);
  if (ts.isPrefixUnaryExpression(e) && e.operator === ts.SyntaxKind.ExclamationToken) return true;
  if (ts.isBinaryExpression(e)) {
    const op = e.operatorToken.kind;
    return (
      op === ts.SyntaxKind.EqualsEqualsEqualsToken ||
      op === ts.SyntaxKind.ExclamationEqualsEqualsToken ||
      op === ts.SyntaxKind.EqualsEqualsToken ||
      op === ts.SyntaxKind.ExclamationEqualsToken ||
      op === ts.SyntaxKind.AmpersandAmpersandToken ||
      op === ts.SyntaxKind.BarBarToken
    );
  }
  if (ts.isCallExpression(e)) {
    const name = calleeName(e, aliases);
    return ["startsWith", "endsWith", "includes", "test", "some", "every"].includes(name);
  }
  return false;
}

function isLexicalContainmentHelper(scope: ts.Node, aliases: AliasMap): boolean {
  // STRUCTURAL, not name-based. A containment helper takes at least a target and a
  // base, and it VERDICTS — it throws or returns a boolean. Requiring that keeps
  // the signal on real guards and off the many functions that use `path.relative`
  // to build a display label and happen to live in a file that also writes. A
  // file-level join without it produced three false positives on the first run
  // (`dashboard-launch`, `dot-guild/audit`, `lifecycle-gate`), and a rail that
  // cries wolf is a rail that gets switched off.
  const params = (scope as ts.FunctionDeclaration).parameters;
  if (params === undefined || params.length < 2) return false;
  let resolves = false;
  let compares = false;
  let realpath = false;
  let writes = false;
  let verdicts = false;
  const visit = (n: ts.Node): void => {
    if (ts.isCallExpression(n)) {
      const name = calleeName(n, aliases);
      if (name === "resolve") resolves = true;
      if (name === "relative") compares = true;
      if (name === "startsWith") {
        // `startsWith(base + path.sep)` — a containment test, not a prefix match on
        // an unrelated string. The `path.sep` (or a `/`) is what makes it one.
        const arg = n.arguments[0]?.getText() ?? "";
        if (/path\.sep|["'`]\//.test(arg)) compares = true;
      }
      if (name === "realpathSync") realpath = true;
      if (WRITE_CALLS.has(name)) writes = true;
    }
    if (ts.isThrowStatement(n)) verdicts = true;
    if (ts.isReturnStatement(n) && n.expression !== undefined) {
      const e = n.expression;
      // A verdict is a boolean LITERAL *or* a returned boolean EXPRESSION. Requiring
      // a literal was an evasion an adversarial pass found: `return t.startsWith(b +
      // path.sep)` is the most natural way anyone writes this helper, and it slipped
      // straight through. Prefix-`!`, a comparison, `&&`/`||`, and a returned call
      // all count.
      if (isBooleanish(e, aliases)) verdicts = true;
    }
    if (/\.realpathSync(\.native)?/.test(n.getText?.() ?? "") && ts.isPropertyAccessExpression(n)) {
      realpath = true;
    }
    ts.forEachChild(n, visit);
  };
  ts.forEachChild(scope, visit);
  return resolves && compares && verdicts && !realpath && !writes;
}

function scanSource(text: string, fileName: string): FileEvidence {
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.ES2022, true);
  const ev: FileEvidence = { climb: false, boundedWrite: false, lexicalGuard: false };
  const aliases = collectAliases(sf);

  // ── The lexical-guard pass ────────────────────────────────────────────────────
  // A guard and the write it protects live in DIFFERENT functions — that is good
  // design, and it means neither scope alone shows the pattern. So this is a
  // file-level join: does this file declare a lexical containment helper, AND does
  // it anywhere perform a write? If so, a write in this file is bounded by string
  // algebra, and string algebra cannot see a symlink.
  const lexicalHelpers: string[] = [];
  let fileWrites = false;
  const topScan = (n: ts.Node): void => {
    if (ts.isFunctionDeclaration(n) && n.name && n.body) {
      if (isLexicalContainmentHelper(n, aliases)) lexicalHelpers.push(n.name.getText());
    }
    if (ts.isCallExpression(n) && WRITE_CALLS.has(calleeName(n, aliases))) fileWrites = true;
    ts.forEachChild(n, topScan);
  };
  ts.forEachChild(sf, topScan);
  if (lexicalHelpers.length > 0 && fileWrites) ev.lexicalGuard = true;

  // Evidence is gathered PER FUNCTION so an unrelated `realpathSync` at the top of
  // a file cannot be paired with an unrelated `mkdirSync` at the bottom.
  const scanScope = (scope: ts.Node): void => {
    let realpath = false;
    let mkdir = false;
    let climb = false;
    const inline: InlineGuardEvidence = {
      resolves: false,
      containmentCompare: false,
      writes: false,
      realpath: false,
    };
    const visit = (n: ts.Node): void => {
      // Do not descend into a NESTED function scope — it is scanned on its own.
      if (n !== scope && (ts.isFunctionLike(n) as boolean)) {
        scanScope(n);
        return;
      }
      if (isRealpathCall(n, aliases)) {
        realpath = true;
        inline.realpath = true;
      }
      if (isRecursiveMkdir(n, aliases)) mkdir = true;
      if (ts.isCallExpression(n)) {
        const cn = calleeName(n, aliases);
        if (cn === "resolve") inline.resolves = true;
        if (WRITE_CALLS.has(cn)) inline.writes = true;
        if (cn === "startsWith") {
          // A CONTAINMENT comparison specifically: the separator is what makes
          // `startsWith` a boundary test rather than a prefix match on a label.
          const arg = n.arguments[0]?.getText() ?? "";
          if (/path\.sep|sep\b|["'`]\//.test(arg)) inline.containmentCompare = true;
        }
      }
      if (isLoop(n) && loopContainsDirnameWalk(n, aliases)) climb = true;
      ts.forEachChild(n, visit);
    };
    ts.forEachChild(scope, visit);
    // The recursive form is a property of THIS scope, not of any child node, so it
    // is asked about the scope itself rather than from inside the child visitor.
    if (containsRecursiveClimb(scope, aliases)) climb = true;
    if (realpath && climb) ev.climb = true;
    if (
      inline.resolves &&
      inline.containmentCompare &&
      inline.writes &&
      !inline.realpath
    ) {
      ev.lexicalGuard = true;
    }
    if (realpath && mkdir) ev.boundedWrite = true;
  };

  scanScope(sf);
  return ev;
}

/**
 * The primitive's public names. A file has ADOPTED the primitive when it imports
 * any of them — from the workflow path directly, or through a module barrel.
 *
 * Matching the import PATH alone was the first attempt and it was wrong: the
 * module-boundary checker requires cross-module imports to go through
 * `src/modules/<m>/index.ts`, so a correctly-migrated consumer imports from
 * `"../../kernel"` and a path regex reports it as NOT adopted. The rail said
 * `adopted-without-import` about a file that had just adopted it. Bind to the
 * SYMBOLS, which is what "uses the primitive" actually means.
 */
const PRIMITIVE_EXPORTS = [
  "checkContained",
  "prepareContainedWrite",
  "writeContainedFile",
  "assertContained",
  "canonicalizeRealPath",
  "isWithin",
  "isRefused",
  "CONTAINMENT_REFUSAL_CODES",
];

/**
 * Has this file actually ADOPTED the primitive — i.e. does it USE one of its
 * exports, not merely name one in an import line?
 *
 * The import-line version was trivially satisfiable, which an adversarial pass
 * showed by adding an unused `checkContained` import to a file that had grown its
 * own climb back: `status: "adopted"` passed. A registration that a dead import
 * satisfies is not a check. Adoption is now: the symbol is imported AND referenced
 * somewhere that is not the import statement itself.
 */
function importsPrimitiveSymbols(text: string, fileName = "x.ts"): boolean {
  const imported = new Set<string>();
  for (const m of text.matchAll(/import\s*\{([^}]*)\}\s*from\s*["'][^"']+["']/g)) {
    for (const raw of m[1].split(",")) {
      const parts = raw.trim().split(/\s+as\s+/);
      const source = parts[0].trim().replace(/^type\s+/, "");
      const local = (parts[1] ?? parts[0]).trim();
      if (PRIMITIVE_EXPORTS.includes(source)) imported.add(local);
    }
  }
  if (imported.size === 0) return false;

  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.ES2022, true);
  let used = false;
  const visit = (n: ts.Node): void => {
    if (used) return;
    if (ts.isImportDeclaration(n)) return; // the import line is not a use
    if (ts.isIdentifier(n) && imported.has(n.getText())) {
      used = true;
      return;
    }
    ts.forEachChild(n, visit);
  };
  ts.forEachChild(sf, visit);
  return used;
}

/** Map a `resources/` mirror back to the live file it mirrors, if it is one. */
export function mirrorSourceOf(relPath: string): string | undefined {
  // Two shapes exist in this repo:
  //   src/modules/<m>/resources/scripts/lib/x.ts        -> scripts/lib/x.ts
  //   src/modules/<m>/resources/src/modules/<n>/…/x.ts  -> src/modules/<n>/…/x.ts
  const m = /^src\/modules\/[^/]+\/resources\/(.+)$/.exec(relPath);
  if (!m) return undefined;
  return m[1];
}

export function scanRepo(repoRoot: string): ScanResult {
  const sites: ScannedSite[] = [];

  for (const root of CONTAINMENT_SCAN_ROOTS) {
    for (const rel of walkSourceFiles(path.join(repoRoot, root))) {
      const relPath = `${root}/${rel}`;
      let text: string;
      try {
        text = fs.readFileSync(path.join(repoRoot, relPath), "utf8");
      } catch {
        continue;
      }
      const ev = scanSource(text, relPath);
      const evidence: ContainmentEvidence[] = [];
      if (ev.climb) evidence.push("climb");
      if (ev.boundedWrite) evidence.push("bounded-write");
      if (ev.lexicalGuard) evidence.push("lexical-guard");
      if (evidence.length === 0) continue;
      sites.push({
        path: relPath,
        evidence,
        mirrorOf: mirrorSourceOf(relPath),
        importsPrimitive: importsPrimitiveSymbols(text, relPath),
      });
    }
  }

  const byPath = new Map<string, ContainmentSite>(CONTAINMENT_SITES.map((s) => [s.path, s]));
  const findings: Finding[] = [];

  for (const site of sites) {
    if (site.mirrorOf !== undefined) {
      // A mirror is legitimate exactly when its LIVE source is registered. Nothing
      // is gained by registering every mirror by hand, and plenty is lost: the
      // registry would then need an edit every time the sync tool adds a copy,
      // which is how a mirror ends up unnoticed in the first place.
      if (!byPath.has(site.mirrorOf)) {
        findings.push({
          code: "unregistered-mirror",
          path: site.path,
          detail: `mirrors ${site.mirrorOf}, which is NOT a registered containment site`,
        });
      }
      continue;
    }
    if (!byPath.has(site.path)) {
      findings.push({
        code: "unregistered-site",
        path: site.path,
        detail: `declares path-containment logic (${site.evidence.join("+")}) but is not in CONTAINMENT_SITES — use the shared primitive at ${CONTAINMENT_HOME}, or register a waiver with a reason`,
      });
    }
  }

  const foundLive = new Set(sites.filter((s) => s.mirrorOf === undefined).map((s) => s.path));
  const climbSites = new Set(
    sites.filter((s) => s.mirrorOf === undefined && s.evidence.includes("climb")).map((s) => s.path)
  );
  const importsPrimitive = new Map(sites.map((s) => [s.path, s.importsPrimitive]));

  let homes = 0;
  for (const entry of CONTAINMENT_SITES) {
    const abs = path.join(repoRoot, entry.path);
    if (!fs.existsSync(abs)) {
      findings.push({
        code: "stale-registration",
        path: entry.path,
        detail: "registered as a containment site but the file does not exist",
      });
      continue;
    }
    if (entry.status === "home") {
      homes += 1;
      if (entry.path !== CONTAINMENT_HOME) {
        findings.push({
          code: "home-mismatch",
          path: entry.path,
          detail: `claims status "home" but the primitive lives at ${CONTAINMENT_HOME}`,
        });
      }
      continue;
    }
    if (entry.status === "waived" && entry.note.trim() === "") {
      findings.push({
        code: "waiver-without-reason",
        path: entry.path,
        detail: "a waiver must state why the shared primitive does not apply",
      });
    }
    if (entry.status === "adopted") {
      // Read the file directly: a migrated site may no longer trip the SCANNER
      // (that is the point of migrating), so its import cannot be checked from the
      // scanned-sites map alone.
      const imports =
        importsPrimitive.get(entry.path) ??
        importsPrimitiveSymbols(fs.readFileSync(abs, "utf8"), entry.path);
      if (!imports) {
        findings.push({
          code: "adopted-without-import",
          path: entry.path,
          detail:
            "registered as adopted but does not import the shared primitive — a site that stopped using it is a site that grew its own copy back",
        });
      }
    }
    if (entry.status === "adopted" && climbSites.has(entry.path)) {
      // Importing the primitive AND keeping a private climb is the failure mode a
      // presence-check alone cannot see: the registration says "adopted", the
      // import is there, and the duplicate is back. Registration is not adoption.
      findings.push({
        code: "adopted-with-private-climb",
        path: entry.path,
        detail:
          "imports the shared primitive but still declares its own deepest-existing-ancestor climb — registration is not adoption",
      });
    }
    if (entry.status === "waived" && foundLive.has(entry.path) === false) {
      findings.push({
        code: "registration-without-site",
        path: entry.path,
        detail:
          "waived, but the scanner no longer sees containment logic here — drop the waiver rather than leaving a rule with nothing to feel it",
      });
    }
  }

  if (homes !== 1) {
    findings.push({
      code: "home-mismatch",
      path: CONTAINMENT_HOME,
      detail: `exactly one registry entry must have status "home"; found ${homes}`,
    });
  }

  return { sites, findings };
}
