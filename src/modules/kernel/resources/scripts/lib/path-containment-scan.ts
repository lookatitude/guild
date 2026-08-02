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

export type ContainmentEvidence = "climb" | "bounded-write";

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

/** `path.dirname(x)` — returns the argument's text, or undefined. */
function dirnameArg(node: ts.Node, aliases: AliasMap): string | undefined {
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
}

function scanSource(text: string, fileName: string): FileEvidence {
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.ES2022, true);
  const ev: FileEvidence = { climb: false, boundedWrite: false };
  const aliases = collectAliases(sf);

  // Evidence is gathered PER FUNCTION so an unrelated `realpathSync` at the top of
  // a file cannot be paired with an unrelated `mkdirSync` at the bottom.
  const scanScope = (scope: ts.Node): void => {
    let realpath = false;
    let mkdir = false;
    let climb = false;
    const visit = (n: ts.Node): void => {
      // Do not descend into a NESTED function scope — it is scanned on its own.
      if (n !== scope && (ts.isFunctionLike(n) as boolean)) {
        scanScope(n);
        return;
      }
      if (isRealpathCall(n, aliases)) realpath = true;
      if (isRecursiveMkdir(n, aliases)) mkdir = true;
      if (isLoop(n) && loopContainsDirnameWalk(n, aliases)) climb = true;
      ts.forEachChild(n, visit);
    };
    ts.forEachChild(scope, visit);
    if (realpath && climb) ev.climb = true;
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

function importsPrimitiveSymbols(text: string): boolean {
  if (/workflows\/path-containment/.test(text)) return true;
  for (const m of text.matchAll(/import\s*\{([^}]*)\}\s*from\s*["'][^"']+["']/g)) {
    const names = m[1].split(",").map((n) => n.trim().split(/\s+as\s+/)[0].trim());
    if (names.some((n) => PRIMITIVE_EXPORTS.includes(n))) return true;
  }
  return false;
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
      if (evidence.length === 0) continue;
      sites.push({
        path: relPath,
        evidence,
        mirrorOf: mirrorSourceOf(relPath),
        importsPrimitive: importsPrimitiveSymbols(text),
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
        importsPrimitiveSymbols(fs.readFileSync(abs, "utf8"));
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
