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

function scanStatic(): StaticCollection[] {
  const found: StaticCollection[] = [];
  for (const root of ["src", "scripts", "hooks"]) {
    for (const file of walkFiles(path.join(REPO, root))) {
      const text = fs.readFileSync(file, "utf8");
      const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
      const visit = (node: ts.Node): void => {
        if (ts.isVariableStatement(node) && node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) {
          for (const decl of node.declarationList.declarations) {
            if (!ts.isIdentifier(decl.name) || !decl.initializer) continue;
            let value = unwrap(decl.initializer);
            const outerCallee = calleeText(value);
            const frozen = outerCallee !== undefined && FREEZE_WRAPPERS.has(outerCallee);
            const sealed = outerCallee !== undefined && SEAL_WRAPPERS.has(outerCallee);
            const deep = outerCallee === "deepFreeze" || outerCallee === "neutralFreeze" || outerCallee === "frozenList";
            // The KIND has to be read from the OUTER call — `sealSet([...])` is a Set even
            // though its argument is an array literal. Reading it after unwrapping would
            // misfile every sealed Set as an unfrozen array.
            const kindFromWrapper = kindFromValue(value);
            if (frozen || sealed) {
              const call = value as ts.CallExpression;
              if (call.arguments.length > 0) value = unwrap(call.arguments[0]);
            }
            const kind = kindFromWrapper ?? kindFromValue(value) ?? kindFromType(decl.type);
            if (!kind) continue;
            const ownsGraph =
              ts.isArrayLiteralExpression(value) &&
              value.elements.some((element) => {
                const el = unwrap(element as ts.Expression);
                const cal = calleeText(el);
                if (cal && (FREEZE_WRAPPERS.has(cal) || SEAL_WRAPPERS.has(cal))) return false;
                return (
                  ts.isObjectLiteralExpression(el) ||
                  ts.isArrayLiteralExpression(el) ||
                  ts.isRegularExpressionLiteral(el)
                );
              });
            found.push({
              file: path.relative(REPO, file).replace(/\\/g, "/"),
              name: decl.name.text,
              kind,
              frozen,
              sealed,
              deep,
              ownsGraph,
              aliasOf: !frozen && !sealed && ts.isIdentifier(value) ? value.text : undefined,
            });
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
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
  fs.mkdirSync(path.dirname(PIN_PATH), { recursive: true });
  fs.writeFileSync(
    PIN_PATH,
    JSON.stringify(
      {
        note:
          "Pinned closed-collection identities (file::exportName). The rail asserts the live " +
          "scan is a SUPERSET of this list, so an identity disappearing fails BY NAME. " +
          "Regenerate with GUILD_PIN_CLOSED_COLLECTIONS=1 and review the diff.",
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
    const pin = JSON.parse(fs.readFileSync(PIN_PATH, "utf8")) as { identities: string[] };
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
 * Walk everything an export owns. `insideCollection` marks the moment the walk enters an
 * array, Set or Map: from there on, every object/regexp it reaches is part of a CLOSED
 * COLLECTION'S ELEMENT GRAPH and in scope. Plain exported objects that own no collection
 * are a different (larger) class and are deliberately out of scope here.
 */
function walkValue(
  node: unknown,
  label: string,
  seen: WeakSet<object>,
  result: WalkResult,
  depth: number,
  insideCollection: boolean,
): void {
  if (node === null || typeof node !== "object" || depth > 12) return;
  const obj = node as object;
  if (seen.has(obj)) return;
  seen.add(obj);
  result.visited += 1;

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
    const values = obj instanceof Set ? obj.values() : (obj as Map<unknown, unknown>).values();
    for (const value of values) walkValue(value, `${label}{}`, seen, result, depth + 1, true);
    return;
  }

  const sealedValues = sealedCollectionValues(obj);
  if (sealedValues !== undefined) {
    for (const value of sealedValues) walkValue(value, `${label}{}`, seen, result, depth + 1, true);
    return;
  }

  if (Array.isArray(obj)) {
    if (!Object.isFrozen(obj)) result.findings.push({ path: label, kind: "unfrozen-array" });
    obj.forEach((value, i) => walkValue(value, `${label}[${i}]`, seen, result, depth + 1, true));
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
      const seen = new WeakSet<object>();
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
        walkValue(value, identity(c), new WeakSet(), result, 0, false);
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

    for (const collection of statics) {
      const id = identity(collection);
      const mod = moduleOf(collection.file);
      if (!mod) {
        staticOnly.push({ id, reason: "outside src/modules — no module index reaches it", detail: collection.file });
        continue;
      }
      const walked = runtimeByModule.get(mod);
      if (!walked) {
        staticOnly.push({ id, reason: "module index was not walked", detail: mod });
        continue;
      }
      // The join key: this exact binding name, observed in THIS module's export graph.
      if (walked.names.has(collection.name)) runtimeVerified.push(id);
      else staticOnly.push({ id, reason: "declared inside a module but not re-exported from its index", detail: mod });
    }

    // Tier 2 re-classifies anything the index walk could not reach but the declaring-file
    // import COULD — a strictly stronger join (file+name, the pin's own identity).
    const stillStatic: typeof staticOnly = [];
    for (const entry of staticOnly) {
      const direct = directFileResults.get(entry.id);
      if (direct?.verified) runtimeVerified.push(entry.id);
      else stillStatic.push(direct?.reason ? { ...entry, reason: direct.reason } : entry);
    }
    staticOnly.length = 0;
    staticOnly.push(...stillStatic);

    const reasons: Record<string, number> = {};
    for (const entry of staticOnly) reasons[entry.reason] = (reasons[entry.reason] ?? 0) + 1;

    // eslint-disable-next-line no-console
    console.log(
      `[closed-collection] ${statics.length} declaration sites scanned; ` +
        `${runtimeVerified.length} VERIFIED AT RUNTIME (module index, or the declaring file joined on file+name); ` +
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
   * The primitive is the ONE legitimate user — telling a branded collection from a facade
   * is precisely its job — so it is exempted by path, not by pattern.
   */
  const PRIMITIVE = "src/modules/kernel/workflows/sealed-collections.ts";

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

  it("no production file outside the primitive branches on instanceof Set/Map", () => {
    const offenders: string[] = [];
    for (const root of ["src", "scripts", "hooks"]) {
      for (const file of walkFiles(path.join(REPO, root))) {
        const rel = path.relative(REPO, file).replace(/\\/g, "/");
        if (rel === PRIMITIVE) continue;
        offenders.push(...instanceofSetHits(rel, fs.readFileSync(file, "utf8")));
      }
    }
    expect(offenders.sort()).toEqual([]);
  });

  it("ANTI-VACUITY: the matcher DOES see the primitive's own legitimate uses", () => {
    // If this drops to zero the AST matcher stopped matching, and the guard above would
    // pass happily over a repo full of `instanceof Set`.
    const text = fs.readFileSync(path.join(REPO, PRIMITIVE), "utf8");
    expect(instanceofSetHits(PRIMITIVE, text).length).toBeGreaterThan(2);
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

  it("DOCUMENTS the divergence: only the kernel primitive can CLOSE a Set", () => {
    // The kernel primitive replaces the Set with a frozen FACADE that has no [[SetData]]
    // slot, so neither the method nor the intrinsic can reach membership.
    const closed = deepFreeze({ names: sealSet(["x"], "TEST") }) as { names: ReadonlySet<string> };
    expect(closed.names instanceof Set).toBe(false);
    expect(() => (closed.names as Set<string>).add("y")).toThrow(TypeError);
    expect(() => Set.prototype.add.call(closed.names, "y")).toThrow(TypeError);
    expect(closed.names.has("y")).toBe(false);

    // The neutral core cannot call `defineProperty` and cannot build the facade either
    // (both need bindings outside NEUTRAL_PURE_INTRINSIC_ROOTS), so its copy can only
    // FREEZE a Set — which closes nothing while `Object.isFrozen` reports success. That is
    // precisely the false green this rail exists to catch, so the next test makes the
    // situation unreachable rather than tolerable.
    const notClosed = neutralFreeze({ names: new Set(["x"]) }) as { names: Set<string> };
    expect(Object.isFrozen(notClosed.names)).toBe(true);
    notClosed.names.add("y");
    expect(notClosed.names.has("y")).toBe(true);
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
