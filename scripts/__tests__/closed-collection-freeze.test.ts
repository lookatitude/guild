/**
 * scripts/__tests__/closed-collection-freeze.test.ts
 *
 * THE CLOSED-COLLECTION RAIL — successor to registry-freeze.test.ts, whose premise was
 * too narrow. The class is not "unfrozen arrays". It is UNFROZEN CLOSED COLLECTIONS:
 * arrays, THEIR ELEMENT GRAPHS, and Sets/Maps. Three structural facts, each re-verified
 * below rather than asserted in prose, make a regex scan over TypeScript the wrong tool:
 *
 *   1. `as const` / `readonly` / `ReadonlySet` are COMPILE-TIME. They erase. A
 *      `ReadonlySet<string>` is a real `Set` with a working `delete` at runtime.
 *   2. `Object.freeze` does NOT freeze Set/Map MEMBERSHIP — entries live in an internal
 *      slot — while `Object.isFrozen` still answers `true`. A freeze over a Set is worse
 *      than nothing: no protection, plus a false green for any isFrozen-based audit.
 *   3. `Object.freeze` is SHALLOW. A frozen array of objects has mutable elements, and
 *      arrays nested inside those elements are mutable too.
 *
 * ── WHAT THIS RAIL ASSERTS, AND HOW ────────────────────────────────────────────────
 * STATIC half (TypeScript AST, not regex): every exported closed collection in
 * `src/**`, `scripts/**`, `hooks/**` is frozen or sealed AT ITS DECLARATION SITE. The
 * AST sees what the predecessor's regex could not — lowercase names, `readonly`-typed
 * declarations with no `as const`, computed arrays, `satisfies`, aliases, and Sets.
 *
 * RUNTIME half: imports every module public index and DEEP-WALKS the export graph —
 * through namespace objects, into array elements, into nested arrays and objects, into
 * Set/Map contents. It tests the actual property, at every depth, including the ones no
 * static scan can reach.
 *
 * THE JOIN IS EXPLICIT. The evidence split is computed by joining the two populations on
 * IDENTITY (`module` + export name), never by subtracting one aggregate from another.
 * The predecessor's "129 runtime / 38 spelling" split was produced by subtraction and is
 * retracted: 16 of its 98 were not index exports at all, and namespace objects were never
 * traversed, so the two numbers did not describe overlapping populations.
 *
 * ── ANTI-VACUITY ───────────────────────────────────────────────────────────────────
 * Every assertion here states a PROPERTY (`unfrozen` is empty). A count floor alone is
 * not enough — it passed a change that made things worse. But a property assertion over
 * an EMPTY population is vacuous, so each half additionally proves it saw something:
 *
 *   - the static half pins the exact identity set it must keep covering, and asserts the
 *     current scan is a SUPERSET of it. A plain numeric floor is gameable: the
 *     predecessor's scan found 167 where its own provenance said 168 and passed, because
 *     168 > 160. Under a superset assertion, one identity disappearing FAILS by name.
 *   - the runtime half asserts a floor on objects VISITED, and fails on a module whose
 *     index is missing or fails to import unless that module is documented by name AND
 *     the failure matches the documented error. Both of those were silent skips before.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as ts from "typescript";

// The rail uses the shipped predicates on purpose: a private re-implementation could
// drift from the primitive it is supposed to be checking.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { isSealedCollection, sealedCollectionValues } = require("../../src/modules/kernel/workflows/sealed-collections") as {
  isSealedCollection: (v: unknown) => boolean;
  sealedCollectionValues: (v: unknown) => unknown[] | undefined;
};

const REPO = path.resolve(__dirname, "..", "..");
const PIN_PATH = path.join(__dirname, "fixtures", "closed-collection-inventory.json");

// ---------------------------------------------------------------------------
// Static half — a TypeScript AST scan
// ---------------------------------------------------------------------------

// Matched against the REPO-RELATIVE path. An absolute match would be a self-inflicted
// silent skip: this repo is routinely checked out INSIDE a `.worktrees/` directory, so an
// absolute `/.worktrees/` test excludes every file and the scan finds nothing. That
// exact bug shipped in the predecessor rail and only the count floor caught it.
const SKIP = ["node_modules/", "dist/", ".git/", "resources/", "__tests__/"];

/** Calls that produce a frozen or sealed value. */
const FREEZE_WRAPPERS = new Set(["Object.freeze", "deepFreeze", "frozenList", "neutralFreeze"]);
const SEAL_WRAPPERS = new Set(["sealSet", "sealMap"]);

/**
 * ROUND-1 P2 #5 — A WRAPPER NAME IS NOT A WRAPPER.
 *
 * The scan used to accept the SPELLING: any call whose callee read `sealSet` marked the
 * declaration sealed. Nothing resolved the symbol, so a local decoy in the same file was a
 * complete, silent bypass — and `scripts/**` and `hooks/**` get no module-index walk, so
 * nothing downstream caught it either:
 *
 *     function sealSet<T>(values: Iterable<T>): ReadonlySet<T> { return new Set(values); }
 *     export const PERMITTED_ACTIONS = sealSet(["bypass"]);   // scanned as SEALED
 *     Set.prototype.add.call(PERMITTED_ACTIONS, "anything");  // and wide open
 *
 * A wrapper now counts only when the binding RESOLVES to one of the two files that
 * actually implement it (or when the declaring file IS one of them). Everything else —
 * a local function, a shadowed import, a same-named helper from another module — is
 * untrusted, and the declaration is judged unfrozen.
 */
const WRAPPER_IMPLEMENTATIONS = new Set([
  "src/modules/kernel/index.ts",
  "src/modules/kernel/workflows/sealed-collections.ts",
  // The neutral core's deliberate duplicate; `neutralFreeze` is re-exported by the index.
  "src/modules/lifecycle/index.ts",
  "src/modules/lifecycle/workflows/neutral-runtime-contracts.ts",
]);

/** Resolve a relative import specifier to a repo-relative `.ts` path, TEXTUALLY. */
function resolveSpecifier(fromRel: string, specifier: string): string | undefined {
  if (!specifier.startsWith(".")) return undefined;
  const joined = path.posix.normalize(
    path.posix.join(path.posix.dirname(fromRel), specifier.replace(/\.js$/, "")),
  );
  for (const candidate of [`${joined}.ts`, `${joined}/index.ts`, joined]) {
    if (WRAPPER_IMPLEMENTATIONS.has(candidate)) return candidate;
  }
  return joined;
}

function walkFiles(dir: string, out: string[] = []): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    const rel = path.relative(REPO, full).replace(/\\/g, "/") + (entry.isDirectory() ? "/" : "");
    if (SKIP.some((s) => rel.includes(s))) continue;
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) walkFiles(full, out);
    else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) out.push(full);
  }
  return out;
}

type CollectionKind = "array" | "set" | "map";

interface StaticCollection {
  /** Repo-relative path — half of the join identity. */
  file: string;
  /** Exported binding name — the other half. */
  name: string;
  kind: CollectionKind;
  /** `Object.freeze` / `deepFreeze` / `neutralFreeze` / `frozenList` at the site. */
  frozen: boolean;
  /** `sealSet` / `sealMap` at the site — the only thing that closes Set/Map membership. */
  sealed: boolean;
  /** `deepFreeze`-family: freezes the element graph, not just the container. */
  deep: boolean;
  /** An element is an object/array/regexp literal that a shallow freeze would miss. */
  ownsGraph: boolean;
  /**
   * `X = SOME_OTHER_BINDING` — this site DECLARES no collection, it re-points at one. The
   * freeze belongs at the target's declaration, so asserting it here would demand a
   * pointless second freeze. Tracked separately and joined to its target by name.
   */
  aliasOf?: string;
}

function calleeText(node: ts.Expression): string | undefined {
  if (!ts.isCallExpression(node)) return undefined;
  const target = node.expression;
  if (ts.isIdentifier(target)) return target.text;
  if (ts.isPropertyAccessExpression(target) && ts.isIdentifier(target.expression)) {
    return `${target.expression.text}.${target.name.text}`;
  }
  return undefined;
}

/** Strip `as const`, `satisfies`, parentheses and type assertions to reach the value. */
function unwrap(node: ts.Expression): ts.Expression {
  let current = node;
  for (;;) {
    if (ts.isParenthesizedExpression(current)) { current = current.expression; continue; }
    if (ts.isAsExpression(current) || ts.isSatisfiesExpression(current)) { current = current.expression; continue; }
    if (ts.isTypeAssertionExpression(current)) { current = current.expression; continue; }
    return current;
  }
}

/** The declared TYPE's collection kind — catches `readonly T[]` with no `as const`. */
function kindFromType(type: ts.TypeNode | undefined): CollectionKind | undefined {
  if (!type) return undefined;
  if (ts.isArrayTypeNode(type) || ts.isTupleTypeNode(type)) return "array";
  if (ts.isTypeOperatorNode(type) && type.operator === ts.SyntaxKind.ReadonlyKeyword) return kindFromType(type.type);
  if (ts.isTypeReferenceNode(type) && ts.isIdentifier(type.typeName)) {
    const name = type.typeName.text;
    if (name === "Set" || name === "ReadonlySet") return "set";
    if (name === "Map" || name === "ReadonlyMap") return "map";
    if (name === "Array" || name === "ReadonlyArray") return "array";
  }
  return undefined;
}

const ARRAY_PRODUCING_METHODS = new Set([
  "filter", "map", "concat", "slice", "flat", "flatMap", "sort", "reverse", "split", "from", "of",
]);

/** The VALUE's collection kind — catches computed arrays with no type annotation. */
function kindFromValue(node: ts.Expression): CollectionKind | undefined {
  if (ts.isArrayLiteralExpression(node)) return "array";
  if (ts.isNewExpression(node) && ts.isIdentifier(node.expression)) {
    if (node.expression.text === "Set") return "set";
    if (node.expression.text === "Map") return "map";
  }
  const callee = calleeText(node);
  if (callee === "sealSet") return "set";
  if (callee === "sealMap") return "map";
  if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
    const method = node.expression.name.text;
    if (method === "from" && ts.isIdentifier(node.expression.expression) && node.expression.expression.text === "Object") {
      return undefined; // Object.from is not an array producer; Object.entries etc. are handled by type
    }
    if (ARRAY_PRODUCING_METHODS.has(method)) return "array";
  }
  return undefined;
}

/**
 * Scan ONE source. Split out of the file walk so the scanner's own rules can be exercised
 * against adversarial sources (see "the scanner's blind spots" below). A rule with nothing
 * to feel it is not a rule: if every real file complies, a green sweep proves nothing about
 * whether the scanner would REJECT the attack it was written for.
 */
export function scanSource(rel: string, text: string): StaticCollection[] {
  const found: StaticCollection[] = [];
  const source = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

  // --- symbol resolution for wrapper trust (round-1 P2 #5) -------------------
  /** local binding name -> the repo-relative file it was imported from. */
  const importedFrom = new Map<string, string>();
  /** every top-level binding this file DECLARES itself — a decoy, or a shadow of `Object`. */
  const declaredHere = new Set<string>();
  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      const target = resolveSpecifier(rel, statement.moduleSpecifier.text);
      const clause = statement.importClause;
      if (!clause || target === undefined) continue;
      if (clause.name) importedFrom.set(clause.name.text, target);
      if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
        for (const element of clause.namedBindings.elements) importedFrom.set(element.name.text, target);
      }
    }
    if (ts.isFunctionDeclaration(statement) && statement.name) declaredHere.add(statement.name.text);
    if (ts.isClassDeclaration(statement) && statement.name) declaredHere.add(statement.name.text);
    if (ts.isVariableStatement(statement)) {
      for (const decl of statement.declarationList.declarations) {
        if (ts.isIdentifier(decl.name)) declaredHere.add(decl.name.text);
      }
    }
  }
  const fileIsAnImplementation = WRAPPER_IMPLEMENTATIONS.has(rel);

  /** Does this callee text name a wrapper that RESOLVES to a real implementation? */
  const trustedWrapper = (callee: string | undefined): boolean => {
    if (callee === undefined) return false;
    if (callee === "Object.freeze") {
      // `Object` is a global, so it is trusted UNLESS this file shadows it. A local
      // `const Object = { freeze: (x) => x }` would otherwise launder every declaration.
      return !declaredHere.has("Object");
    }
    if (!FREEZE_WRAPPERS.has(callee) && !SEAL_WRAPPERS.has(callee)) return false;
    const importSource = importedFrom.get(callee);
    if (importSource !== undefined) return WRAPPER_IMPLEMENTATIONS.has(importSource);
    // Not imported. Only the implementations themselves may use the bare name.
    return fileIsAnImplementation && declaredHere.has(callee);
  };

  const record = (name: string, type: ts.TypeNode | undefined, initializer: ts.Expression): void => {
    let value = unwrap(initializer);
    const outerCallee = calleeText(value);
    const trusted = trustedWrapper(outerCallee);
    // SPELLING alone no longer counts. An untrusted `sealSet(...)` leaves `sealed` false,
    // so the declaration lands in the unsealed list and the rail goes red BY NAME.
    const frozen = trusted && outerCallee !== undefined && FREEZE_WRAPPERS.has(outerCallee);
    const sealed = trusted && outerCallee !== undefined && SEAL_WRAPPERS.has(outerCallee);
    const deep =
      trusted && (outerCallee === "deepFreeze" || outerCallee === "neutralFreeze" || outerCallee === "frozenList");
    // The KIND has to be read from the OUTER call — `sealSet([...])` is a Set even
    // though its argument is an array literal. Reading it after unwrapping would
    // misfile every sealed Set as an unfrozen array. This uses the SPELLING on purpose:
    // an untrusted `sealSet(["bypass"])` still produces a Set at runtime, and calling it
    // an array would file it under the wrong (weaker) assertion.
    const kindFromWrapper = kindFromValue(value);
    if (outerCallee !== undefined && (FREEZE_WRAPPERS.has(outerCallee) || SEAL_WRAPPERS.has(outerCallee))) {
      const call = value as ts.CallExpression;
      if (call.arguments.length > 0) value = unwrap(call.arguments[0]);
    }
    const kind = kindFromWrapper ?? kindFromValue(value) ?? kindFromType(type);
    if (!kind) return;
    const ownsGraph =
      ts.isArrayLiteralExpression(value) &&
      value.elements.some((element) => {
        const el = unwrap(element as ts.Expression);
        const cal = calleeText(el);
        if (cal && trustedWrapper(cal)) return false;
        return (
          ts.isObjectLiteralExpression(el) ||
          ts.isArrayLiteralExpression(el) ||
          ts.isRegularExpressionLiteral(el)
        );
      });
    found.push({
      file: rel,
      name,
      kind,
      frozen,
      sealed,
      deep,
      ownsGraph,
      aliasOf: !frozen && !sealed && ts.isIdentifier(value) ? value.text : undefined,
    });
  };

  // --- export forms ---------------------------------------------------------
  // `export { X }` / `export { X as Y }` re-exports a binding declared WITHOUT the
  // `export` modifier. That form was invisible to the scan, so moving a declaration behind
  // a bare `const` plus an export clause removed it from coverage entirely (round-1 P2 #5).
  const exportedByClause = new Map<string, string>(); // local name -> exported name
  for (const statement of source.statements) {
    if (!ts.isExportDeclaration(statement) || statement.moduleSpecifier) continue;
    if (!statement.exportClause || !ts.isNamedExports(statement.exportClause)) continue;
    for (const element of statement.exportClause.elements) {
      exportedByClause.set((element.propertyName ?? element.name).text, element.name.text);
    }
  }

  const visit = (node: ts.Node): void => {
    if (ts.isVariableStatement(node)) {
      const directlyExported = node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;
      for (const decl of node.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name) || !decl.initializer) continue;
        const viaClause = exportedByClause.get(decl.name.text);
        if (!directlyExported && viaClause === undefined) continue;
        record(viaClause ?? decl.name.text, decl.type, decl.initializer);
      }
    }
    // `export class C { static readonly X = [...] }` — a static field is an exported
    // vocabulary reachable as `C.X`, and was never scanned.
    if (ts.isClassDeclaration(node) && node.name) {
      const exportedName = node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
        ? node.name.text
        : exportedByClause.get(node.name.text);
      if (exportedName !== undefined) {
        for (const member of node.members) {
          if (!ts.isPropertyDeclaration(member)) continue;
          if (!member.modifiers?.some((m) => m.kind === ts.SyntaxKind.StaticKeyword)) continue;
          if (!ts.isIdentifier(member.name) || !member.initializer) continue;
          record(`${exportedName}.${member.name.text}`, member.type, member.initializer);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

function scanStatic(): StaticCollection[] {
  const found: StaticCollection[] = [];
  for (const root of ["src", "scripts", "hooks"]) {
    for (const file of walkFiles(path.join(REPO, root))) {
      found.push(
        ...scanSource(path.relative(REPO, file).replace(/\\/g, "/"), fs.readFileSync(file, "utf8")),
      );
    }
  }
  return found;
}

/**
 * Can this file be `require`d by a test WITHOUT running anything?
 *
 * The runtime half was originally scoped to module public indexes because they are
 * import-safe by construction. That left the collections declared in `scripts/**`,
 * `hooks/**`, and module-internal files verified BY SPELLING ONLY — and the positive
 * control proved the gap is real, not theoretical: of 13 registries frozen by an earlier
 * lane, only 6 are reachable through a module index. `INJECTION_SUPPORT` and
 * `REQUIRED_HOOK_EVENTS` sit inside host-runtime and are simply not on its index.
 *
 * So instead of widening the blast radius blindly, this classifies a file as import-safe
 * when every top-level statement merely DECLARES. A bare expression statement, a loop, or
 * an unguarded `if` means importing it would execute something, and this repo genuinely
 * ships CLIs that write files. `if (require.main === module)` is the repo's own CLI guard
 * and is never true under `require()`, so it does not count against a file.
 */
function importSafety(file: string, text: string): { safe: true } | { safe: false; reason: string } {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  for (const statement of source.statements) {
    if (
      ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement) ||
      ts.isExportAssignment(statement) || ts.isVariableStatement(statement) ||
      ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) ||
      ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement) ||
      ts.isEnumDeclaration(statement) || ts.isModuleDeclaration(statement) ||
      ts.isEmptyStatement(statement)
    ) continue;
    if (ts.isIfStatement(statement)) {
      const test = statement.expression.getText(source);
      if (/require\.main\s*===\s*module/.test(test) || /import\.meta\.main/.test(test)) continue;
      return { safe: false, reason: `unguarded top-level if (${test.slice(0, 30).replace(/\s+/g, " ")}…)` };
    }
    return { safe: false, reason: `top-level ${ts.SyntaxKind[statement.kind]} runs on import` };
  }
  return { safe: true };
}

const statics = scanStatic();
const identity = (c: StaticCollection): string => `${c.file}::${c.name}`;

/**
 * Regeneration path for the pin, kept HERE so the pin can only ever be produced by the
 * scanner that checks it — a separate generator is how the two drift apart:
 *
 *     GUILD_PIN_CLOSED_COLLECTIONS=1 npx jest closed-collection-freeze
 *
 * Regenerating is a deliberate act with a diff to review. Doing it to silence a red rail
 * is how the shrinkage this pin exists to catch gets absorbed.
 */
if (process.env.GUILD_PIN_CLOSED_COLLECTIONS === "1") {
  // ROUND-1 P3 #8 — regeneration must not be able to ratify its own shrinkage.
  //
  // The superset assertion below correctly catches an identity disappearing. But the
  // sanctioned repair for a red pin is to regenerate it, and regeneration ran the SAME
  // (possibly weakened) scanner and rewrote the file wholesale — absorbing every
  // disappearance in one commit whose diff a reviewer reads as "the pin was refreshed".
  // Weakening `scanStatic()` and regenerating was therefore a complete, silent bypass of
  // the only assertion that guards coverage.
  //
  // Regeneration is now ADDITIVE BY DEFAULT: dropping a pinned identity requires a second,
  // separate opt-in and prints every name being dropped, so the shrinkage has to be stated
  // out loud in the commit rather than inferred from a 400-line diff.
  const present = new Set(statics.map(identity));
  const previous = fs.existsSync(PIN_PATH)
    ? (JSON.parse(fs.readFileSync(PIN_PATH, "utf8")) as { identities?: string[] }).identities ?? []
    : [];
  const dropped = previous.filter((id) => !present.has(id)).sort();
  if (dropped.length > 0 && process.env.GUILD_PIN_ALLOW_SHRINK !== "1") {
    throw new Error(
      `refusing to regenerate the closed-collection pin: it would DROP ${dropped.length} ` +
        `pinned identit${dropped.length === 1 ? "y" : "ies"} that the current scan no longer ` +
        `sees. Either the scanner regressed (fix it) or the declarations were genuinely ` +
        `removed (re-run with GUILD_PIN_ALLOW_SHRINK=1 and say why in the commit). ` +
        `Dropped:\n  ${dropped.join("\n  ")}`,
    );
  }
  fs.mkdirSync(path.dirname(PIN_PATH), { recursive: true });
  fs.writeFileSync(
    PIN_PATH,
    JSON.stringify(
      {
        note:
          "Pinned closed-collection identities (file::exportName). The rail asserts the live " +
          "scan is a SUPERSET of this list, so an identity disappearing fails BY NAME. " +
          "Regenerate with GUILD_PIN_CLOSED_COLLECTIONS=1 and review the diff. Regeneration " +
          "REFUSES to drop a pinned identity unless GUILD_PIN_ALLOW_SHRINK=1 is also set.",
        measured_at: "feature/deep-freeze-collections (task #22)",
        count: statics.length,
        identities: statics.map(identity).sort(),
      },
      null,
      2,
    ) + "\n",
  );
}

describe("closed collections — STATIC (TypeScript AST over every declaration site)", () => {
  it("ANTI-VACUITY: still covers every identity the pinned inventory names", () => {
    // A SUPERSET assertion, not a numeric floor. The predecessor's floor was 160 while
    // its own provenance recorded 168 and the scan found 167 — coverage shrank by one and
    // the rail stayed green, because 167 > 160. Naming the identities makes shrinkage
    // impossible to absorb: a collection that disappears fails HERE, by name, and the
    // only correct response is to delete it from the pin with a reason.
    const pin = JSON.parse(fs.readFileSync(PIN_PATH, "utf8")) as { identities: string[]; count?: number };
    // `count` used to be informational — a number nobody checked, sitting next to the list
    // it claims to describe. A hand-edited pin could then shrink the list while the count
    // still read like the original measurement (round-1 P3 #8). Make it load-bearing.
    expect(pin.count).toBe(pin.identities.length);
    expect(new Set(pin.identities).size).toBe(pin.identities.length);
    const present = new Set(statics.map(identity));
    const missing = pin.identities.filter((id) => !present.has(id)).sort();
    expect(missing).toEqual([]);
    // And the scan must reach all three roots — a glob that stops seeing a directory is
    // the other way this half goes quietly vacuous.
    for (const root of ["src/", "scripts/", "hooks/"]) {
      expect(statics.filter((c) => c.file.startsWith(root)).length).toBeGreaterThan(0);
    }
  });

  it("every exported ARRAY is frozen at its declaration site", () => {
    const unfrozen = statics
      .filter((c) => c.kind === "array" && !c.frozen && !c.aliasOf)
      .map(identity)
      .sort();
    // Each entry is a closed vocabulary any in-process caller can widen at runtime.
    expect(unfrozen).toEqual([]);
  });

  it("every exported SET/MAP is SEALED — freezing one closes nothing", () => {
    const unsealed = statics
      .filter((c) => (c.kind === "set" || c.kind === "map") && !c.sealed && !c.aliasOf)
      .map((c) => `${identity(c)} (frozen=${c.frozen})`)
      .sort();
    // `frozen=true` here would be the dangerous case: Object.freeze on a Set reports
    // isFrozen === true while add/delete/clear keep working.
    expect(unsealed).toEqual([]);
  });

  it("every ALIAS resolves to a target that IS frozen or sealed somewhere in the scan", () => {
    // An alias is exempt from the two assertions above only because the freeze belongs at
    // its target. That exemption is worth exactly as much as this check: an alias whose
    // target is nowhere protected is an unfrozen collection wearing a second name.
    const protectedNames = new Set(
      statics.filter((c) => c.frozen || c.sealed).map((c) => c.name),
    );
    const aliases = statics.filter((c) => c.aliasOf);
    const dangling = aliases
      .filter((c) => !protectedNames.has(c.aliasOf!))
      .map((c) => `${identity(c)} -> ${c.aliasOf}`)
      .sort();
    expect(dangling).toEqual([]);
    // Non-vacuous: there ARE aliases, so this assertion is doing work.
    expect(aliases.length).toBeGreaterThan(0);
  });

  it("an array that OWNS an element graph is deep-frozen, not shallow-frozen", () => {
    const shallow = statics
      .filter((c) => c.ownsGraph && !c.deep)
      .map(identity)
      .sort();
    // `NEUTRAL_EVENT_COMPATIBILITY_RULES` was exactly this shape: frozen array, mutable
    // rule objects, mutable `candidates` arrays — a normalization rule rewritable at
    // runtime behind a green isFrozen check.
    expect(shallow).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Runtime half — deep-walk the module export graph
// ---------------------------------------------------------------------------

type FindingKind = "unfrozen-array" | "unfrozen-object" | "unsealed-set" | "unsealed-map" | "mutable-regexp";

interface RuntimeFinding {
  path: string;
  kind: FindingKind;
}

interface WalkResult {
  findings: RuntimeFinding[];
  visited: number;
  /** Export names observed anywhere in the graph — the runtime side of the join. */
  names: Set<string>;
}

const SET_MUTATORS = ["add", "delete", "clear"] as const;
const MAP_MUTATORS = ["set", "delete", "clear"] as const;

function mutatorsSealed(target: object, methods: readonly string[]): boolean {
  return methods.every((method) => {
    const descriptor = Object.getOwnPropertyDescriptor(target, method);
    return descriptor !== undefined && descriptor.writable === false && descriptor.configurable === false;
  });
}

/**
 * Visitation state, SPLIT BY ENFORCEMENT CONTEXT (round-1 P2 #3).
 *
 * A single `WeakSet` keyed on object identity alone launders a mutable object: reached
 * first through a plain export (`insideCollection === false`) it is recorded as visited,
 * and the LATER, in-scope arrival through a frozen array returns at `seen.has(obj)` before
 * the element-graph check ever runs.
 *
 *     const shared = {};
 *     export const A = { shared };              // walked first, out of scope
 *     export const B = Object.freeze([shared]); // same object, now IN scope — never checked
 *
 * The in-scope visit is strictly stronger, so it subsumes an out-of-scope one but never
 * the reverse. Two sets express exactly that, and still terminate on cycles because the
 * object is recorded before the walk descends.
 */
interface Visited {
  outside: WeakSet<object>;
  inside: WeakSet<object>;
}

const newVisited = (): Visited => ({ outside: new WeakSet<object>(), inside: new WeakSet<object>() });

/**
 * Walk everything an export owns. `insideCollection` marks the moment the walk enters an
 * array, Set or Map: from there on, every object/regexp it reaches is part of a CLOSED
 * COLLECTION'S ELEMENT GRAPH and in scope. Plain exported objects that own no collection
 * are a different (larger) class and are deliberately out of scope here.
 */
function walkValue(
  node: unknown,
  label: string,
  seen: Visited,
  result: WalkResult,
  depth: number,
  insideCollection: boolean,
): void {
  if (node === null || typeof node !== "object" || depth > 12) return;
  const obj = node as object;
  // An out-of-scope visit must NOT suppress a later in-scope one; an in-scope visit DOES
  // suppress a later out-of-scope one, because it already enforced the stronger property.
  if (insideCollection ? seen.inside.has(obj) : seen.outside.has(obj) || seen.inside.has(obj)) return;
  const firstEverVisit = !seen.outside.has(obj) && !seen.inside.has(obj);
  seen.outside.add(obj);
  if (insideCollection) seen.inside.add(obj);
  // Counted once per object, so re-entering in scope cannot inflate the anti-vacuity floor.
  if (firstEverVisit) result.visited += 1;

  if (obj instanceof RegExp) {
    // A global/sticky pattern WRITES lastIndex during `.exec()`/`.test()`, and that write
    // throws on a frozen RegExp — so leaving one mutable is justified, mechanically, by
    // the flags rather than by an author's note. Any other pattern must be frozen.
    if (insideCollection && !Object.isFrozen(obj) && !obj.global && !obj.sticky) {
      result.findings.push({ path: label, kind: "mutable-regexp" });
    }
    return;
  }
  if (obj instanceof Date) return;

  if (obj instanceof Set || obj instanceof Map) {
    // ANY branded Set/Map reachable from an export is a finding, however "sealed" it
    // looks. Neutering the own mutators does NOT close membership: the intrinsics reach
    // the internal slot directly, and `Set.prototype.delete.call(x, k)` succeeded against
    // a frozen, fully-neutered instance (round-1 P1). Only the sealSet/sealMap FACADE —
    // which has no such slot — can be closed, so a real Set/Map here is by definition open.
    result.findings.push({ path: label, kind: obj instanceof Set ? "unsealed-set" : "unsealed-map" });
    // Read entries through the INTRINSIC, not `obj.values()`. `values` is inherited from
    // Set.prototype/Map.prototype, so it is not an own property of the instance and a
    // Proxy `get` trap may replace it with an empty generator — the round-1 P2 #4 shape,
    // which hid the whole element graph from the walk. The intrinsic reads the receiver's
    // internal slot, which no trap can intercept; against a Proxy it has no slot to read
    // and throws, and the finding pushed above has already made this red.
    const entries: unknown[] = [];
    try {
      const forEach = obj instanceof Set ? Set.prototype.forEach : Map.prototype.forEach;
      (forEach as unknown as (this: unknown, cb: (v: unknown) => void) => void).call(obj, (v) => {
        entries.push(v);
      });
    } catch {
      /* no internal slot (a Proxy): nothing to walk, and already reported above */
    }
    for (const value of entries) walkValue(value, `${label}{}`, seen, result, depth + 1, true);
    return;
  }

  const sealedValues = sealedCollectionValues(obj);
  if (sealedValues !== undefined) {
    for (const value of sealedValues) walkValue(value, `${label}{}`, seen, result, depth + 1, true);
    return;
  }

  if (Array.isArray(obj)) {
    if (!Object.isFrozen(obj)) result.findings.push({ path: label, kind: "unfrozen-array" });
    // Elements are read through OWN INDEX DESCRIPTORS, not `obj.forEach`. `forEach` is
    // inherited from Array.prototype — not an own property — so a Proxy `get` trap can
    // return a no-op and hide every element while `Array.isArray` and `Object.isFrozen`
    // both still answer `true` (round-1 P2 #4, reproduced on this Node). An own index of a
    // FROZEN array is a non-writable, non-configurable data property, and the ES proxy
    // invariant makes misreporting one a TypeError rather than a lie.
    const length = Object.getOwnPropertyDescriptor(obj, "length")?.value as number | undefined;
    for (let i = 0; i < (typeof length === "number" ? length : 0); i += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(obj, String(i));
      if (!descriptor || !("value" in descriptor)) continue;
      walkValue(descriptor.value, `${label}[${i}]`, seen, result, depth + 1, true);
    }
    return;
  }

  const proto = Object.getPrototypeOf(obj);
  // Class instances carry behaviour, not vocabulary; freezing them is a different call.
  if (proto !== Object.prototype && proto !== null) return;
  // An object that OWNS a closed collection must itself be frozen, even at the root.
  // `LEGAL_TRANSITIONS` is a `Record<State, readonly State[]>`: freezing every transition
  // list while leaving the RECORD writable let `LEGAL_TRANSITIONS.terminated = ["running"]`
  // reopen a terminal state with every rail green (round-1 P1). The container is as
  // load-bearing as its contents.
  const ownsCollection = Object.values(obj as Record<string, unknown>).some(
    (v) => Array.isArray(v) || v instanceof Set || v instanceof Map || isSealedCollection(v),
  );
  if ((insideCollection || ownsCollection) && !Object.isFrozen(obj)) {
    result.findings.push({ path: label, kind: "unfrozen-object" });
  }
  // Namespace objects (an exported object grouping several vocabularies) are traversed —
  // this is how `INVENTORY_CATEGORIES` becomes reachable at all. It is an export only
  // beneath `InventorySchema`, so a top-level-exports-only scan cannot see it.
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    walkValue(value, `${label}.${key}`, seen, result, depth + 1, insideCollection);
  }
}

/**
 * Modules with no `index.ts`, each with the reason. Previously a missing index was
 * SILENTLY SKIPPED with a bare `continue` — a rail that stops testing a module the moment
 * someone deletes its entrypoint. Anything not on this list now FAILS.
 */
const MODULES_WITHOUT_INDEX: Record<string, string> = {
  dashboard: "resource-only module (implementation_mode: resource-only); ships no workflow code.",
};

/**
 * Module indexes that do not import cleanly, with the EXACT error each must produce.
 * Previously ANY import error was accepted as long as the module name was listed, so an
 * unrelated new failure in the same module would have been waved through. The error text
 * is now part of the contract.
 */
const KNOWN_UNIMPORTABLE: Record<string, { match: RegExp; why: string }> = {
  "docs-sync": {
    match: /TS2308.*has already exported a member named 'main'/,
    why:
      "Three docs-sync workflows each export `main`, so the barrel re-export is ambiguous. " +
      "Pre-existing at bc3596d, verified before being listed. The MATCH is part of the " +
      "contract: any OTHER failure in docs-sync fails the rail instead of being waved " +
      "through under this module's name.",
  },
};

const moduleDirs = fs
  .readdirSync(path.join(REPO, "src", "modules"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

const runtimeByModule = new Map<string, WalkResult>();

describe("closed collections — RUNTIME (deep-walk of every module export graph)", () => {
  it("there are module indexes to walk (anti-vacuity for this half)", () => {
    expect(moduleDirs.length).toBeGreaterThan(25);
  });

  for (const mod of moduleDirs) {
    const indexPath = path.join(REPO, "src", "modules", mod, "index.ts");

    it(`module "${mod}" exports no unfrozen collection at any depth`, () => {
      if (!fs.existsSync(indexPath)) {
        // Documented-by-name, never silent.
        expect(MODULES_WITHOUT_INDEX[mod] ?? `UNDOCUMENTED missing index: ${mod}`).toBe(
          MODULES_WITHOUT_INDEX[mod],
        );
        return;
      }
      let exports: Record<string, unknown>;
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        exports = require(indexPath) as Record<string, unknown>;
      } catch (err) {
        const message = (err as Error).message.split("\n")[0];
        const known = KNOWN_UNIMPORTABLE[mod];
        // Both the module AND the specific failure must be documented.
        expect(known && known.match.test(message) ? "documented" : `${mod}: ${message}`).toBe("documented");
        return;
      }
      const result: WalkResult = { findings: [], visited: 0, names: new Set() };
      const seen = newVisited();
      for (const [key, value] of Object.entries(exports)) {
        if (typeof value === "function") continue;
        result.names.add(key);
        if (value !== null && typeof value === "object") {
          for (const nested of Object.keys(value as Record<string, unknown>)) result.names.add(nested);
        }
        walkValue(value, `${mod}/${key}`, seen, result, 0, false);
      }
      runtimeByModule.set(mod, result);
      expect(result.findings.map((f) => `${f.kind}: ${f.path}`).sort()).toEqual([]);
    });
  }

  it("ANTI-VACUITY: the walk actually traversed the export graph", () => {
    const visited = [...runtimeByModule.values()].reduce((n, r) => n + r.visited, 0);
    // Measured at 900+ on this branch. A collapse here means the walk stopped descending
    // (a changed export shape, an early return) while every property assertion above went
    // quietly vacuous.
    expect(visited).toBeGreaterThan(700);
    expect(runtimeByModule.size).toBeGreaterThan(25);
  });
});

// ---------------------------------------------------------------------------
// Runtime tier 2 — import the DECLARING FILE, joined on (file, name)
// ---------------------------------------------------------------------------

/**
 * The module-index walk is the strongest evidence, but it cannot see everything, and the
 * gap is not theoretical. A positive control — 13 registries an earlier lane froze — found
 * only 6 of them reachable through a module index. `INJECTION_SUPPORT` and
 * `REQUIRED_HOOK_EVENTS` are declared inside host-runtime and are simply not on its index;
 * the other five live under `scripts/lib/core/contracts/**` and never could be.
 *
 * So this tier imports the DECLARING FILE and reads the export by name — but only when the
 * file is import-safe by the AST test above, because this repo ships CLIs that write files
 * and importing one would run it. That gives the strongest join available: `(file, name)`,
 * the exact identity the pin uses, binding the walked VALUE to the declaration site
 * instead of matching a spelling within a module.
 */
const directFileResults = new Map<string, { verified: boolean; reason?: string }>();

describe("closed collections — RUNTIME tier 2 (the declaring file, joined on file+name)", () => {
  const byFile = new Map<string, StaticCollection[]>();
  for (const collection of statics) {
    const list = byFile.get(collection.file) ?? [];
    list.push(collection);
    byFile.set(collection.file, list);
  }

  it("ANTI-VACUITY: there are declaring files to import", () => {
    expect(byFile.size).toBeGreaterThan(50);
  });

  it("every collection in an import-safe declaring file is frozen or sealed AT RUNTIME", () => {
    const findings: string[] = [];
    let verified = 0;
    for (const [file, collections] of byFile) {
      const absolute = path.join(REPO, file);
      const safety = importSafety(absolute, fs.readFileSync(absolute, "utf8"));
      if (safety.safe === false) {
        const reason = `not import-safe (${safety.reason})`;
        for (const c of collections) directFileResults.set(identity(c), { verified: false, reason });
        continue;
      }
      let exports: Record<string, unknown>;
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        exports = require(absolute) as Record<string, unknown>;
      } catch (err) {
        const reason = `import failed: ${(err as Error).message.split("\n")[0].slice(0, 80)}`;
        for (const c of collections) directFileResults.set(identity(c), { verified: false, reason });
        continue;
      }
      for (const c of collections) {
        const value = exports[c.name];
        if (value === undefined) {
          directFileResults.set(identity(c), { verified: false, reason: "export absent at runtime" });
          continue;
        }
        const result: WalkResult = { findings: [], visited: 0, names: new Set() };
        walkValue(value, identity(c), newVisited(), result, 0, false);
        for (const f of result.findings) findings.push(`${f.kind}: ${f.path}`);
        directFileResults.set(identity(c), { verified: true });
        verified += 1;
      }
    }
    expect(findings.sort()).toEqual([]);
    // Non-vacuous: this tier must actually verify a large share of the population.
    expect(verified).toBeGreaterThan(150);
  });
});

// ---------------------------------------------------------------------------
// POSITIVE CONTROLS — every rule above, shown REJECTING the attack it exists for
// ---------------------------------------------------------------------------

/**
 * A rule that only ever runs over compliant input is untested. Each block below feeds the
 * real scanner or the real walker an adversarial input and asserts it is CAUGHT — and,
 * where the fix was a behaviour change rather than an addition, asserts the pre-fix
 * behaviour alongside it, so "this would have been green before" is demonstrated instead
 * of claimed.
 */
describe("closed collections — POSITIVE CONTROLS for the round-1 findings", () => {
  // --- P2 #5: the scanner trusted the wrapper's SPELLING ---------------------
  describe("P2 #5 — a wrapper name is not a wrapper", () => {
    const DECOY = `
      function sealSet<T>(values: Iterable<T>): ReadonlySet<T> { return new Set(values); }
      export const PERMITTED_ACTIONS = sealSet(["bypass"]);
    `;

    it("a LOCAL sealSet decoy does not seal — the exact round-1 reproduction", () => {
      const [found] = scanSource("scripts/lib/decoy.ts", DECOY);
      expect(found).toMatchObject({ name: "PERMITTED_ACTIONS", kind: "set", sealed: false });
      // ...and it therefore lands in the population the SET/MAP assertion fails on.
      const unsealed = scanSource("scripts/lib/decoy.ts", DECOY)
        .filter((c) => (c.kind === "set" || c.kind === "map") && !c.sealed && !c.aliasOf)
        .map(identity);
      expect(unsealed).toEqual(["scripts/lib/decoy.ts::PERMITTED_ACTIONS"]);
    });

    it("the SAME source with a real import from the kernel IS sealed", () => {
      // The contrast is the point: the rule keys on where the binding RESOLVES, not on
      // whether the file happens to contain the letters `sealSet`.
      const real = `
        import { sealSet } from "../../src/modules/kernel/workflows/sealed-collections";
        export const PERMITTED_ACTIONS = sealSet(["bypass"]);
      `;
      const [found] = scanSource("scripts/lib/real.ts", real);
      expect(found).toMatchObject({ name: "PERMITTED_ACTIONS", kind: "set", sealed: true });
    });

    it("an import of the same NAME from somewhere else is not trusted either", () => {
      const impostor = `
        import { sealSet } from "./my-helpers";
        export const PERMITTED_ACTIONS = sealSet(["bypass"]);
      `;
      expect(scanSource("scripts/lib/impostor.ts", impostor)[0]).toMatchObject({ sealed: false });
    });

    it("a file that SHADOWS Object cannot launder a declaration through Object.freeze", () => {
      const shadowed = `
        const Object = { freeze: <T>(v: T): T => v };
        export const VOCAB = Object.freeze(["a", "b"]);
      `;
      expect(scanSource("scripts/lib/shadow.ts", shadowed)[0]).toMatchObject({
        name: "VOCAB",
        kind: "array",
        frozen: false,
      });
      // Without the shadow, the very same expression IS trusted.
      expect(scanSource("scripts/lib/plain.ts", `export const VOCAB = Object.freeze(["a", "b"]);`)[0])
        .toMatchObject({ frozen: true });
    });
  });

  // --- P2 #5: export forms the scan could not see ---------------------------
  describe("P2 #5 — export forms that were invisible", () => {
    it("`export { X }` over a bare const is scanned (it found two real unfrozen arrays)", () => {
      const viaClause = `
        const VOCAB = ["a", "b"];
        export { VOCAB };
      `;
      const found = scanSource("scripts/lib/clause.ts", viaClause);
      expect(found).toHaveLength(1);
      expect(found[0]).toMatchObject({ name: "VOCAB", kind: "array", frozen: false });
      // This form is what surfaced `scripts/build-verify.ts::MCP_SERVERS` and
      // `scripts/lib/host-adapters/app-host.ts::APP_HOSTS` — both genuinely unfrozen,
      // both invisible to the previous scan, both now frozen at their declaration site.
      expect(statics.some((c) => c.file === "scripts/build-verify.ts" && c.name === "MCP_SERVERS")).toBe(true);
      expect(
        statics.some((c) => c.file === "scripts/lib/host-adapters/app-host.ts" && c.name === "APP_HOSTS"),
      ).toBe(true);
    });

    it("`export { X as Y }` is recorded under the EXPORTED name, which is the join key", () => {
      const renamed = `
        const internal = ["a"];
        export { internal as VOCAB };
      `;
      expect(scanSource("scripts/lib/renamed.ts", renamed)[0]).toMatchObject({ name: "VOCAB" });
    });

    it("a static field on an exported class is scanned as `Class.field`", () => {
      const klass = `
        export class Policy { static readonly ACTIONS = ["bypass"]; }
      `;
      expect(scanSource("scripts/lib/klass.ts", klass)[0]).toMatchObject({
        name: "Policy.ACTIONS",
        kind: "array",
        frozen: false,
      });
    });

    it("a NON-exported const is still ignored — the rule did not just widen to everything", () => {
      // A sweep that flags every local array would be a different (and much noisier) rail,
      // and would make the assertions above meaningless.
      expect(scanSource("scripts/lib/private.ts", `const VOCAB = ["a"];`)).toEqual([]);
    });
  });

  // --- P2 #3: the walker's `seen` set laundered an object -------------------
  it("P2 #3 — an object first seen OUT of collection scope is still checked in scope", () => {
    const shared = { permission: "closed" };
    const exports = {
      A: Object.freeze({ shared }), // walked first, insideCollection === false
      B: Object.freeze([shared]), // same object, now inside a closed collection
    };
    const result: WalkResult = { findings: [], visited: 0, names: new Set() };
    const seen = newVisited();
    for (const [key, value] of Object.entries(exports)) {
      walkValue(value, `probe/${key}`, seen, result, 0, false);
    }
    expect(result.findings.map((f) => f.kind)).toContain("unfrozen-object");
    expect(result.findings.some((f) => f.path.startsWith("probe/B"))).toBe(true);

    // And the PRE-FIX behaviour, so the improvement is demonstrated rather than asserted:
    // one identity-only visited set suppresses the in-scope arrival entirely.
    const oneSet = new WeakSet<object>();
    const legacy: WalkResult = { findings: [], visited: 0, names: new Set() };
    const legacyWalk = (node: unknown, label: string, inside: boolean): void => {
      if (node === null || typeof node !== "object") return;
      const obj = node as object;
      if (oneSet.has(obj)) return;
      oneSet.add(obj);
      if (Array.isArray(obj)) {
        obj.forEach((v, i) => legacyWalk(v, `${label}[${i}]`, true));
        return;
      }
      if (inside && !Object.isFrozen(obj)) legacy.findings.push({ path: label, kind: "unfrozen-object" });
      for (const [k, v] of Object.entries(obj as Record<string, unknown>)) legacyWalk(v, `${label}.${k}`, inside);
    };
    for (const [key, value] of Object.entries(exports)) legacyWalk(value, `probe/${key}`, false);
    expect(legacy.findings).toEqual([]); // <- green, with `shared` wide open
    expect(Object.isFrozen(shared)).toBe(false);
  });

  it("P2 #3 — the split visited-state still terminates on a cycle", () => {
    // The obvious way to break the fix is to re-visit unconditionally.
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const result: WalkResult = { findings: [], visited: 0, names: new Set() };
    expect(() => walkValue(Object.freeze([cyclic]), "probe/cycle", newVisited(), result, 0, false)).not.toThrow();
    expect(result.visited).toBeGreaterThan(0);
  });

  // --- P2 #4: a Proxy hid the element graph from the walk -------------------
  it("P2 #4 — the ORIGINAL reproduction (deepFreeze over a proxied Set) is refused", () => {
    // Round 1 ran this against `269d0b6`, where `deepFreeze` walked Sets: the Proxy made
    // `Symbol.iterator` and `values()` empty, so the primitive froze the container, walked
    // nothing, and reported success while `child` stayed mutable. `fb87540` then made
    // `deepFreeze` REFUSE every branded Set/Map, which closes this half as a side effect —
    // a Proxy over a Set still answers `true` to `instanceof Set`. Pinned so the coverage
    // is not lost if the refusal is ever relaxed.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { deepFreeze } = require(path.join(REPO, "src", "modules", "kernel", "index.ts")) as {
      deepFreeze: <T>(v: T) => T;
    };
    const child = { gate: "closed" };
    const proxied = new Proxy(new Set([child]), {
      get(t, key, receiver) {
        if (key === Symbol.iterator || key === "values") return function* (): Generator<never> { /* empty */ };
        return Reflect.get(t, key, receiver);
      },
    });
    expect(proxied instanceof Set).toBe(true); // the disguise does not survive the brand
    expect(() => deepFreeze({ names: proxied })).toThrow(/sealSet/);
  });

  it("P2 #4 — a Proxy cannot hide array elements behind a faked inherited forEach", () => {
    const child = { gate: "closed" };
    const target = Object.freeze([child]);
    const proxy = new Proxy(target, {
      get(t, key, receiver) {
        if (key === "forEach") return function noop(): void { /* hide everything */ };
        return Reflect.get(t, key, receiver);
      },
    });
    // The disguise is complete for every check that does not read own descriptors.
    expect(Array.isArray(proxy)).toBe(true);
    expect(Object.isFrozen(proxy)).toBe(true);
    let viaForEach = 0;
    (proxy as unknown as { forEach: (cb: () => void) => void }).forEach(() => { viaForEach += 1; });
    expect(viaForEach).toBe(0); // <- what the walk used to see

    const result: WalkResult = { findings: [], visited: 0, names: new Set() };
    walkValue(proxy, "probe/proxied", newVisited(), result, 0, false);
    // Own index descriptors reach the child, and the child is a mutable object inside a
    // closed collection — exactly the finding the disguise suppressed.
    expect(result.findings.map((f) => f.kind)).toContain("unfrozen-object");
  });

  it("P2 #4 — Set entries are read through the intrinsic, not a trappable `values()`", () => {
    const child = { gate: "closed" };
    const set = new Set([child]);
    const hidden = new Proxy(set, {
      get(t, key, receiver) {
        if (key === "values" || key === Symbol.iterator) return function* (): Generator<never> { /* empty */ };
        return Reflect.get(t, key, receiver);
      },
    });
    // A branded Set (or a Proxy over one) is a finding on sight, so this is red either way.
    const result: WalkResult = { findings: [], visited: 0, names: new Set() };
    walkValue(hidden, "probe/hiddenset", newVisited(), result, 0, false);
    expect(result.findings.map((f) => f.kind)).toContain("unsealed-set");
    // The real (untrapped) Set still yields its entries to the intrinsic read, so the
    // change did not silently stop traversing Set contents.
    const plain: WalkResult = { findings: [], visited: 0, names: new Set() };
    walkValue(new Set([{ mutable: true }]), "probe/plainset", newVisited(), plain, 0, false);
    expect(plain.findings.map((f) => f.kind).sort()).toEqual(["unfrozen-object", "unsealed-set"]);
  });

  it("P2 #4 — a frozen facade's iterator is protected by the ES proxy invariant", () => {
    // `sealedCollectionValues` spreads the facade, which goes through `Symbol.iterator`.
    // That is safe ONLY because the facade is FROZEN: for a non-writable, non-configurable
    // own data property a `get` trap must return the same value or throw. This pins the
    // property the spread depends on, so making the facade merely sealed (or leaving one
    // mutator configurable) fails here instead of silently reopening the hole.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { sealSet } = require(path.join(REPO, "src", "modules", "kernel", "index.ts")) as {
      sealSet: <T>(v: Iterable<T>, label?: string) => ReadonlySet<T>;
    };
    const facade = sealSet(["x"], "PROBE");
    expect(Object.isFrozen(facade)).toBe(true);
    // The mutators must be non-configurable too — a configurable one would leave the
    // facade non-frozen and take the invariant away with it.
    for (const method of SET_MUTATORS) {
      expect(Object.getOwnPropertyDescriptor(facade, method)?.configurable).toBe(false);
    }
    const lying = new Proxy(facade as object, {
      get(t, key, receiver) {
        if (key === Symbol.iterator) return function* (): Generator<never> { /* empty */ };
        return Reflect.get(t, key, receiver);
      },
    });
    expect(() => [...(lying as unknown as Iterable<unknown>)]).toThrow(TypeError);
  });

  // --- P3 #8: pin regeneration could ratify its own shrinkage ---------------
  it("P3 #8 — regeneration refuses to drop a pinned identity without the second opt-in", () => {
    // The guard's logic, exercised directly: regeneration is additive unless the operator
    // says otherwise. (The guard itself runs at module load under
    // GUILD_PIN_CLOSED_COLLECTIONS=1, which a test cannot re-enter.)
    const wouldRefuse = (previous: string[], scanned: string[], allowShrink: boolean): string[] | null => {
      const present = new Set(scanned);
      const dropped = previous.filter((id) => !present.has(id)).sort();
      return dropped.length > 0 && !allowShrink ? dropped : null;
    };
    expect(wouldRefuse(["a::X", "b::Y"], ["a::X"], false)).toEqual(["b::Y"]);
    expect(wouldRefuse(["a::X", "b::Y"], ["a::X"], true)).toBeNull(); // explicit opt-in
    expect(wouldRefuse(["a::X"], ["a::X", "b::Y"], false)).toBeNull(); // growth is fine
    // And the pin on disk satisfies the invariant the rail now asserts about it.
    const pin = JSON.parse(fs.readFileSync(PIN_PATH, "utf8")) as { identities: string[]; count: number };
    expect(pin.count).toBe(pin.identities.length);
  });
});

// ---------------------------------------------------------------------------
// The evidence split — computed by JOINING on identity, never by subtraction
// ---------------------------------------------------------------------------

describe("closed collections — evidence strength, joined on identity", () => {
  it("reports runtime-verified vs static-only with the join made explicit", () => {
    const moduleOf = (file: string): string | undefined => {
      const m = /^src\/modules\/([^/]+)\//.exec(file);
      return m ? m[1] : undefined;
    };
    const runtimeVerified: string[] = [];
    const staticOnly: { id: string; reason: string; detail: string }[] = [];
    // Which join produced each verification. The two are NOT equally strong and the log
    // must stop implying they are.
    let byIdentity = 0; // tier 2: (file, name) — binds the walked VALUE to the declaration
    let bySpelling = 0; // tier 1: (module, spelling) — a NAME seen somewhere in the module

    for (const collection of statics) {
      const id = identity(collection);

      // TIER 2 FIRST (round-1 P2 #7). Tier 2 imports the DECLARING FILE and reads the
      // export by name, so its join key is `(file, name)` — the pin's own identity, and
      // the only one that binds the object actually walked to the site being claimed.
      // Tier 1's key is `(module, spelling)`: `walked.names` holds every top-level export
      // name AND every immediate nested key anywhere in the module's graph, so an
      // unrelated namespace property named `POLICY` "verifies" a `POLICY` declared in a
      // different file of the same module. Running tier 1 first — as this did — left the
      // weaker join covering most of the population and sent tier 2 only the leftovers.
      // Inverted, the identity join claims everything it can and the spelling join is
      // demoted to the residue tier 2 genuinely cannot reach (a CLI that runs on import).
      const direct = directFileResults.get(id);
      if (direct?.verified) {
        runtimeVerified.push(id);
        byIdentity += 1;
        continue;
      }

      const mod = moduleOf(collection.file);
      if (!mod) {
        staticOnly.push({
          id,
          reason: direct?.reason ?? "outside src/modules — no module index reaches it",
          detail: collection.file,
        });
        continue;
      }
      const walked = runtimeByModule.get(mod);
      if (!walked) {
        staticOnly.push({ id, reason: direct?.reason ?? "module index was not walked", detail: mod });
        continue;
      }
      if (walked.names.has(collection.name)) {
        runtimeVerified.push(id);
        bySpelling += 1;
        continue;
      }
      staticOnly.push({
        id,
        reason: direct?.reason ?? "declared inside a module but not re-exported from its index",
        detail: mod,
      });
    }

    const reasons: Record<string, number> = {};
    for (const entry of staticOnly) reasons[entry.reason] = (reasons[entry.reason] ?? 0) + 1;

    // eslint-disable-next-line no-console
    console.log(
      `[closed-collection] ${statics.length} declaration sites scanned; ` +
        `${runtimeVerified.length} VERIFIED AT RUNTIME — ` +
        `${byIdentity} on the IDENTITY join (declaring file, file+name), ` +
        `${bySpelling} on the weaker (module, spelling) join; ` +
        `${staticOnly.length} verified by declaration site only — ` +
        Object.entries(reasons).map(([r, n]) => `${n} ${r}`).join("; "),
    );

    // The two populations must partition the scan exactly. This is the property the
    // predecessor's split lacked: its runtime and static numbers were never joined, so
    // "129 + 38" did not add up to a population anyone could enumerate.
    expect(runtimeVerified.length + staticOnly.length).toBe(statics.length);
    expect(new Set([...runtimeVerified, ...staticOnly.map((s) => s.id)]).size).toBe(statics.length);
    // Both halves must be non-empty, else the split proves nothing.
    expect(runtimeVerified.length).toBeGreaterThan(50);
    expect(staticOnly.length).toBeGreaterThan(0);
    expect(byIdentity + bySpelling).toBe(runtimeVerified.length);
    // THE POINT OF THE INVERSION, asserted rather than described: the identity join must
    // carry the overwhelming majority of the verified population. Before the tiers were
    // swapped this was the other way round — ~138 identities were claimed by the spelling
    // join simply because it ran first. If a future change re-orders the tiers, or breaks
    // the declaring-file import, this ratio collapses and says so.
    expect(byIdentity).toBeGreaterThan(runtimeVerified.length * 0.9);
    // ...and the residue left on the spelling join must stay small enough to audit by eye.
    expect(bySpelling).toBeLessThan(20);
  });
});

// ---------------------------------------------------------------------------
// The exploits this rail closes — a rail that never demonstrates its failure is a claim
// ---------------------------------------------------------------------------

describe("closed collections — the structural facts, re-verified on this Node", () => {
  it("Object.freeze does NOT close Set membership, and isFrozen lies about it", () => {
    const set = Object.freeze(new Set(["a"]));
    expect(Object.isFrozen(set)).toBe(true); // <- the false green
    set.delete("a");
    set.add("z");
    expect([...set]).toEqual(["z"]); // <- membership changed anyway
  });

  it("a frozen global RegExp throws on the lastIndex write — why 'safe' is the default", () => {
    const global = Object.freeze(/a/g);
    expect(() => {
      global.test("aaa");
      global.test("aaa");
    }).toThrow(TypeError);
    // A non-global pattern never writes lastIndex, so freezing it is always safe.
    const plain = Object.freeze(/a/);
    expect(plain.test("a")).toBe(true);
  });
});

describe("closed collections — the exploits, demonstrated against this branch", () => {
  it("REDACTABLE_FIELDS cannot be narrowed, and redaction still redacts", () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const security = require(path.join(REPO, "src", "modules", "security", "index.ts")) as {
      REDACTABLE_FIELDS: ReadonlySet<string>;
      redactEventFields: (event: Record<string, unknown>) => Record<string, unknown>;
    };
    for (const method of SET_MUTATORS) {
      // The obvious attack: call the method on the value.
      expect(() => {
        (security.REDACTABLE_FIELDS as unknown as Record<string, (v?: unknown) => void>)[method]("result");
      }).toThrow(TypeError);
      // The attack that DEFEATED the first implementation: reach the intrinsic directly.
      // Set's mutators act on the receiver's internal slot, so neutered own properties
      // stopped `x.delete(...)` and nothing else — `Set.prototype.delete.call(x, "result")`
      // succeeded against a frozen, fully-neutered Set and made an API token echo verbatim.
      expect(() => {
        (Set.prototype as unknown as Record<string, (this: unknown, v?: unknown) => void>)[method].call(
          security.REDACTABLE_FIELDS,
          "result",
        );
      }).toThrow(TypeError);
    }
    // A sealed vocabulary is NOT a Set. That is the whole fix: no internal slot, nothing
    // for the intrinsic to reach.
    expect(security.REDACTABLE_FIELDS instanceof Set).toBe(false);
    expect(security.REDACTABLE_FIELDS.has("result")).toBe(true);
    const redacted = security.redactEventFields({ result: "token ghp_0123456789012345678901234567890123456" });
    expect(String(redacted.result)).not.toContain("ghp_0123456789012345678901234567890123456");
  });

  it("a normalization rule cannot be rewritten in place (the frozen-array/mutable-element defect)", () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const lifecycle = require(path.join(REPO, "src", "modules", "lifecycle", "index.ts")) as {
      NEUTRAL_EVENT_COMPATIBILITY_RULES: readonly { from: string; to: string | null; candidates: readonly string[] }[];
    };
    const rules = lifecycle.NEUTRAL_EVENT_COMPATIBILITY_RULES;
    const rule = rules.find((r) => r.from === "tool.pre")!;
    expect(rule.to).toBe("tool.before");
    expect(() => {
      (rule as { to: string | null }).to = "attacker.controlled";
    }).toThrow(TypeError);
    expect(rule.to).toBe("tool.before");
    // The `candidates` arrays were mutable too — the second half of that defect.
    const ambiguous = rules.find((r) => r.from === "task.transition")!;
    expect(() => {
      (ambiguous.candidates as string[]).push("attacker.controlled");
    }).toThrow(TypeError);
  });

  it("the scaffold arrays share element identity, and the shared elements are frozen", () => {
    // Imported from the WORKFLOW file, not the module index: these three are lowercase
    // and absent from config/index.ts, which is exactly why the predecessor's
    // index-exports-only runtime half could not see them.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const config = require(
      path.join(REPO, "src", "modules", "config", "workflows", "init-scaffold-manifest.ts"),
    ) as {
      singleProject: readonly { path: string }[];
      repairRequired: readonly { path: string }[];
    };
    const shared = config.repairRequired[0];
    // Same OBJECT, not a copy — which is why freezing the three arrays was not enough.
    expect(config.singleProject.some((entry) => entry === shared)).toBe(true);
    const before = shared.path;
    expect(() => {
      (shared as { path: string }).path = "attacker/controlled";
    }).toThrow(TypeError);
    expect(shared.path).toBe(before);
  });

  it("a terminal task-cell state cannot be reopened", () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const dispatch = require(path.join(REPO, "src", "modules", "dispatch", "index.ts")) as {
      LEGAL_TRANSITIONS: Readonly<Record<string, readonly string[]>>;
    };
    expect(dispatch.LEGAL_TRANSITIONS.terminated).toEqual([]);
    // (a) the transition LIST cannot grow
    expect(() => {
      (dispatch.LEGAL_TRANSITIONS.terminated as string[]).push("running");
    }).toThrow(TypeError);
    // (b) and the RECORD cannot be re-pointed at a different list. Freezing every list
    // while leaving the record writable left `LEGAL_TRANSITIONS.terminated = ["running"]`
    // wide open, with the state machine reopened and every rail still green.
    expect(() => {
      (dispatch.LEGAL_TRANSITIONS as Record<string, readonly string[]>).terminated = Object.freeze(["running"]);
    }).toThrow(TypeError);
    expect(dispatch.LEGAL_TRANSITIONS.terminated).toEqual([]);
  });

  it("the shipped secrets policy cannot be emptied", () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const config = require(path.join(REPO, "src", "modules", "config", "index.ts")) as {
      DEFAULTS: { secrets_policy: { redaction_patterns: readonly string[]; env_allowlist: readonly string[] } };
    };
    for (const list of [
      config.DEFAULTS.secrets_policy.redaction_patterns,
      config.DEFAULTS.secrets_policy.env_allowlist,
    ]) {
      expect(() => {
        (list as string[]).length = 0;
      }).toThrow(TypeError);
    }
  });
});

// ---------------------------------------------------------------------------
// The facade's blast radius — `instanceof Set` is now a wrong answer, not an error
// ---------------------------------------------------------------------------

describe("closed collections — nothing branches on the REPRESENTATION of a vocabulary", () => {
  /**
   * A sealed vocabulary is a frozen facade, not a `Set`. That is deliberate and
   * unavoidable — a branded Set cannot be closed — but it makes `instanceof Set` a
   * SILENTLY WRONG ANSWER rather than a loud failure: the check returns false and the code
   * quietly takes the other branch.
   *
   * Landing the facade broke four assertions that tested the REPRESENTATION
   * (`toBeInstanceOf(Set)`, `toEqual(new Set(...))`) instead of the CONTRACT (has / size /
   * iterate), and each was found by a separate full-suite run, one at a time. This guard
   * turns that into one fast failure at the source: production code must not branch on the
   * constructor of something that may be a vocabulary.
   *
   * Telling a branded collection from a facade is precisely the primitives' job, so they
   * are exempted BY PATH, never by pattern — and every exemption is anti-vacuity-checked
   * below, so an exempted file that stops containing the use it was exempted for is a
   * failure rather than a quietly widened hole.
   */
  const PRIMITIVE = "src/modules/kernel/workflows/sealed-collections.ts";
  /**
   * The neutral core's deliberate, weaker duplicate of the primitive. It must REFUSE a
   * branded Set/Map rather than "freeze" one — it cannot build the facade — and refusing
   * requires recognizing one. Exempted for exactly the same reason as the primitive, and
   * for nothing else: this is the only `instanceof Set/Map` the file may contain.
   */
  const NEUTRAL_DUPLICATE = "src/modules/lifecycle/workflows/neutral-runtime-contracts.ts";
  const EXEMPT: Record<string, { minHits: number; why: string }> = {
    [PRIMITIVE]: { minHits: 3, why: "the kernel primitive — distinguishing brand from facade IS its job" },
    [NEUTRAL_DUPLICATE]: {
      minHits: 1,
      why: "the import-closed core's duplicate — it must recognize a branded Set/Map in order to refuse it",
    },
  };

  const instanceofSetHits = (rel: string, text: string): string[] => {
    const source = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const hits: string[] = [];
    const visit = (node: ts.Node): void => {
      if (
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind === ts.SyntaxKind.InstanceOfKeyword &&
        ts.isIdentifier(node.right) &&
        (node.right.text === "Set" || node.right.text === "Map")
      ) {
        const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
        hits.push(`${rel}:${line + 1}  ${node.getText(source).slice(0, 60)}`);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    return hits;
  };

  it("no production file outside the two primitives branches on instanceof Set/Map", () => {
    const offenders: string[] = [];
    for (const root of ["src", "scripts", "hooks"]) {
      for (const file of walkFiles(path.join(REPO, root))) {
        const rel = path.relative(REPO, file).replace(/\\/g, "/");
        if (EXEMPT[rel]) continue;
        offenders.push(...instanceofSetHits(rel, fs.readFileSync(file, "utf8")));
      }
    }
    expect(offenders.sort()).toEqual([]);
  });

  it("ANTI-VACUITY: the matcher DOES see each exempted file's legitimate uses", () => {
    // An exemption is a hole in the guard above. If the matcher stopped matching, or an
    // exempted file stopped containing the use it was exempted FOR, the guard would pass
    // happily over a repo full of `instanceof Set` — and the exemption would be pure cost.
    // Asserting a per-file floor makes both failures loud.
    for (const [rel, { minHits, why }] of Object.entries(EXEMPT)) {
      const text = fs.readFileSync(path.join(REPO, rel), "utf8");
      expect({ rel, why, atLeast: minHits, found: instanceofSetHits(rel, text).length >= minHits }).toEqual({
        rel,
        why,
        atLeast: minHits,
        found: true,
      });
    }
  });
});

// ---------------------------------------------------------------------------
// The mirror hazard the sweep walked into — pinned so it cannot come back
// ---------------------------------------------------------------------------

describe("closed collections — files LOADED THROUGH a resources mirror resolve from there", () => {
  /**
   * `src/modules/<id>/resources/**` is a GENERATED verbatim copy of a live `scripts/**` or
   * `hooks/**` file, sitting three directories deeper than the original. Most mirrors are
   * inert payload — 263 of 550 relative specifiers inside them already fail to resolve at
   * the base commit, and nothing loads them in place, so that is not a defect.
   *
   * The exception is a mirror that a LIVE module file re-exports. Those ARE loaded from
   * the mirror path, so every relative import in them must resolve from there. Adding
   * `import { deepFreeze } from "../../../../src/modules/kernel/..."` to
   * task-cell-backend.ts broke the entire dispatch module index exactly this way; the fix
   * was to drop the import and freeze by hand. This test is why the next person will not
   * spend an hour rediscovering it.
   */
  const reExportedMirrors: { importer: string; mirror: string }[] = [];
  const liveModuleFiles = walkFiles(path.join(REPO, "src", "modules"));
  for (const file of liveModuleFiles) {
    const text = fs.readFileSync(file, "utf8");
    for (const match of text.matchAll(/from "(\.\.?\/(?:[^"]*\/)?resources\/[^"]+)"/g)) {
      reExportedMirrors.push({
        importer: path.relative(REPO, file).replace(/\\/g, "/"),
        mirror: path.resolve(path.dirname(file), match[1]),
      });
    }
  }

  it("finds the mirror re-exports (anti-vacuity — this set is small and must not be empty)", () => {
    expect(reExportedMirrors.length).toBeGreaterThan(0);
  });

  it("every relative import inside a re-exported mirror resolves from the MIRROR path", () => {
    const broken: string[] = [];
    const resolves = (base: string, spec: string): boolean => {
      const target = path.resolve(base, spec);
      return [".ts", ".js", "", "/index.ts"].some((suffix) => fs.existsSync(target + suffix));
    };
    const seen = new Set<string>();
    const check = (mirrorPath: string): void => {
      const file = [".ts", ".js"].map((s) => mirrorPath + s).find((p) => fs.existsSync(p)) ?? mirrorPath;
      if (!fs.existsSync(file) || seen.has(file)) return;
      seen.add(file);
      const text = fs.readFileSync(file, "utf8");
      for (const match of text.matchAll(/from "(\.\.?\/[^"]+)"/g)) {
        const spec = match[1].replace(/\.js$/, "");
        if (!resolves(path.dirname(file), spec)) {
          broken.push(`${path.relative(REPO, file).replace(/\\/g, "/")} -> ${match[1]}`);
        }
      }
    };
    for (const entry of reExportedMirrors) check(entry.mirror);
    expect(broken.sort()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The deliberate duplicate — the import-closed neutral core carries its own copy
// ---------------------------------------------------------------------------

describe("closed collections — the neutral core's deliberate, WEAKER duplicate", () => {
  // `neutral-runtime-contracts.ts` is a declared member of the IMPORT-CLOSED neutral core:
  // zero imports, and no ambient binding outside NEUTRAL_PURE_INTRINSIC_ROOTS. That rules
  // out WeakSet, Reflect, Object.defineProperty and Object.getOwnPropertyDescriptor — so
  // its copy of the walk CANNOT seal a Set or Map, because sealing needs defineProperty.
  // The copy is therefore weaker BY CONTRACT, and this block pins exactly how, so neither
  // the divergence nor the copy can drift unnoticed.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { deepFreeze } = require(path.join(REPO, "src", "modules", "kernel", "index.ts")) as {
    deepFreeze: <T>(v: T) => T;
  };
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { neutralFreeze } = require(path.join(REPO, "src", "modules", "lifecycle", "index.ts")) as {
    neutralFreeze: <T>(v: T) => T;
  };
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { sealSet } = require(path.join(REPO, "src", "modules", "kernel", "index.ts")) as {
    sealSet: <T>(v: Iterable<T>, label?: string) => ReadonlySet<T>;
  };

  const describeFrozen = (root: unknown): string[] => {
    const out: string[] = [];
    const seen = new WeakSet<object>();
    const walk = (n: unknown, label: string): void => {
      if (n === null || typeof n !== "object") return;
      const o = n as object;
      if (seen.has(o)) return;
      seen.add(o);
      out.push(`${label}:frozen=${Object.isFrozen(o)}`);
      if (o instanceof RegExp) return;
      for (const [k, v] of Object.entries(o as Record<string, unknown>)) walk(v, `${label}.${k}`);
    };
    walk(root, "$");
    return out;
  };

  const SHARED_SHAPES = (): { name: string; make: () => unknown }[] => [
    { name: "nested arrays", make: () => [[1, 2], [3]] },
    { name: "array of objects with nested arrays", make: () => [{ a: { b: [1] } }] },
    { name: "global regexp stays mutable", make: () => [/a/g] },
    { name: "plain regexp gets frozen", make: () => [/a/] },
    { name: "shallow-frozen outer", make: () => Object.freeze([{ mutable: true }]) },
    { name: "cycle", make: () => { const c: Record<string, unknown> = {}; c.self = c; return [c]; } },
  ];

  it("agrees with the kernel primitive on every shape the core can express", () => {
    for (const shape of SHARED_SHAPES()) {
      const kernel = describeFrozen(deepFreeze(shape.make()));
      const neutral = describeFrozen(neutralFreeze(shape.make()));
      expect({ shape: shape.name, out: neutral }).toEqual({ shape: shape.name, out: kernel });
    }
  });

  it("both descend THROUGH an already-frozen node — the isFrozen-guard defect", () => {
    // Both helpers used to guard recursion with `Object.isFrozen(value)` and bail on the
    // first frozen node. A shallow-frozen array reports frozen === true, so the children —
    // the mutable half — were never reached.
    for (const freeze of [deepFreeze, neutralFreeze]) {
      const child = { mutable: true };
      freeze(Object.freeze([child]));
      expect(Object.isFrozen(child)).toBe(true);
    }
  });

  it("DOCUMENTS the divergence: the kernel primitive CLOSES a Set, the core REFUSES one", () => {
    // The kernel primitive replaces the Set with a frozen FACADE that has no [[SetData]]
    // slot, so neither the method nor the intrinsic can reach membership.
    const closed = deepFreeze({ names: sealSet(["x"], "TEST") }) as { names: ReadonlySet<string> };
    expect(closed.names instanceof Set).toBe(false);
    expect(() => (closed.names as Set<string>).add("y")).toThrow(TypeError);
    expect(() => Set.prototype.add.call(closed.names, "y")).toThrow(TypeError);
    expect(closed.names.has("y")).toBe(false);

    // ROUND-1 P2 #6. The core cannot build the facade — sealing needs `defineProperty`,
    // which `neutral-core-boundary.ts` rejects as a reflection call — so its copy USED to
    // fall through to `Object.freeze`, which closes nothing while `Object.isFrozen`
    // reports success. That false green was reachable, because `neutralOutcome` freezes
    // whatever `facts` it is handed and the caller keeps a live reference:
    //
    //     const allowed = new Set(["required"]);
    //     const outcome = neutralOutcome({ ..., facts: { allowed } });
    //     allowed.clear(); allowed.add("bypass");     // the "machine truth" changed
    //
    // It now REFUSES instead of pretending, which is the only honest option available
    // inside the closure.
    expect(() => neutralFreeze({ names: new Set(["x"]) })).toThrow(/sealSet|refusing/);
    expect(() => neutralFreeze({ pairs: new Map([["k", "v"]]) })).toThrow(/sealMap|refusing/);
  });

  it("and the refusal reaches neutralOutcome — a mutable Set cannot become machine truth", () => {
    // The static prohibition ("no Set reachable from a NEUTRAL_* export") only ever scanned
    // constants. This is the DYNAMIC path it could not constrain: a value handed in at
    // runtime and frozen into the returned outcome.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { neutralOutcome } = require(path.join(REPO, "src", "modules", "lifecycle", "index.ts")) as {
      neutralOutcome: (input: Record<string, unknown>) => unknown;
    };
    const allowed = new Set(["required"]);
    expect(() =>
      neutralOutcome({
        type: "guild.policy_outcome.v1",
        disposition: "succeeded",
        facts: { allowed },
      }),
    ).toThrow(TypeError);
    // The equivalent frozen-array fact is accepted, so the refusal is narrow rather than a
    // blanket rejection of `facts`.
    expect(() =>
      neutralOutcome({
        type: "guild.policy_outcome.v1",
        disposition: "succeeded",
        facts: { allowed: Object.freeze(["required"]) },
      }),
    ).not.toThrow();
  });

  it("PINS the residue the core cannot close: symbol-keyed and non-enumerable children", () => {
    // Reaching these needs `Object.getOwnPropertySymbols` / `getOwnPropertyNames` and
    // avoiding a getter invocation needs `getOwnPropertyDescriptor` — all three are in
    // `NEUTRAL_REFLECTION_METHOD_NAMES`, so using them turns the core's import closure RED.
    // The closure is the stronger property, so the gap stays. It is pinned HERE, with the
    // exact shape, so it is a stated limitation rather than a silent one — and so that a
    // future boundary change that DOES permit reflection makes this test fail and get
    // revisited, instead of leaving the weaker walk in place forever.
    const hidden = Symbol("hidden");
    const symbolChild = { gate: "closed" };
    neutralFreeze({ [hidden]: symbolChild });
    expect(Object.isFrozen(symbolChild)).toBe(false); // <- the documented residue

    const nonEnumChild = { gate: "closed" };
    const parent = {};
    Object.defineProperty(parent, "hiddenKey", { value: nonEnumChild, enumerable: false });
    neutralFreeze(parent);
    expect(Object.isFrozen(nonEnumChild)).toBe(false); // <- the documented residue

    // The kernel primitive, which is under no such closure, reaches BOTH. That contrast is
    // the reason the divergence is a boundary trade and not an oversight.
    const kernelSymbolChild = { gate: "closed" };
    deepFreeze({ [hidden]: kernelSymbolChild });
    expect(Object.isFrozen(kernelSymbolChild)).toBe(true);
    const kernelNonEnumChild = { gate: "closed" };
    const kernelParent = {};
    Object.defineProperty(kernelParent, "hiddenKey", { value: kernelNonEnumChild, enumerable: false });
    deepFreeze(kernelParent);
    expect(Object.isFrozen(kernelNonEnumChild)).toBe(true);
  });

  it("and the kernel primitive REFUSES to pretend it froze a branded Set", () => {
    // Silently "freezing" a Set is how the false green gets minted. deepFreeze throws
    // instead, naming the fix.
    expect(() => deepFreeze({ raw: new Set([1]) })).toThrow(/sealSet/);
  });

  it("so NO Set or Map may be reachable from a neutral-core export", () => {
    // The consequence above is only safe while it is unreachable. This is the property
    // that keeps it that way; the runtime deep-walk enforces it for the module at large,
    // and this states it for the core specifically.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const lifecycle = require(path.join(REPO, "src", "modules", "lifecycle", "index.ts")) as Record<string, unknown>;
    const offenders: string[] = [];
    const seen = new WeakSet<object>();
    const walk = (n: unknown, label: string, depth: number): void => {
      if (n === null || typeof n !== "object" || depth > 12) return;
      const o = n as object;
      if (seen.has(o)) return;
      seen.add(o);
      if (o instanceof Set || o instanceof Map) {
        offenders.push(label); // any branded Set/Map is open by construction
        return;
      }
      if (Array.isArray(o)) { o.forEach((v, i) => walk(v, `${label}[${i}]`, depth + 1)); return; }
      const proto = Object.getPrototypeOf(o);
      if (proto !== Object.prototype && proto !== null) return;
      for (const [k, v] of Object.entries(o as Record<string, unknown>)) walk(v, `${label}.${k}`, depth + 1);
    };
    for (const [k, v] of Object.entries(lifecycle)) {
      if (typeof v === "function") continue;
      if (k.startsWith("NEUTRAL_")) walk(v, k, 0);
    }
    expect(offenders.sort()).toEqual([]);
    // Non-vacuous: there ARE NEUTRAL_* exports being walked.
    expect(Object.keys(lifecycle).filter((k) => k.startsWith("NEUTRAL_")).length).toBeGreaterThan(10);
  });
});
