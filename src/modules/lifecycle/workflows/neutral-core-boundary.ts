/**
 * src/modules/lifecycle/workflows/neutral-core-boundary.ts
 *
 * The neutral core's self-check: is it still import-closed?
 *
 * MH-02 / W1 of `multi-host-runtime-convergence`. This file exists to make MH-02
 * acceptance 3 — "Core imports no host adapter, hook, wrapper, launcher,
 * PaneAdapter backend, benchmark, or website implementation" — a MECHANICAL
 * verdict instead of a claim in a receipt.
 *
 * WHY A MEMBERSHIP LIST, NOT A MODULE
 *   The `lifecycle` module as a whole is NOT host-neutral and cannot be: its
 *   existing `run-lifecycle.ts` legitimately imports `../../host-runtime` and
 *   `hooks/lib/security/scrubbed-write`. MH-02 therefore extracts a neutral core
 *   as an explicitly DECLARED file set inside the module rather than relabelling
 *   the module. `NEUTRAL_CORE_MEMBERS` is that declaration.
 *
 * WHY CLOSURE RATHER THAN A DENYLIST
 *   A denylist only proves the absence of the edges someone thought to forbid,
 *   and it proves nothing about TRANSITIVE reach. This evaluator instead requires
 *   that every specifier in every core file resolve to another declared core
 *   member. Since the core is closed under import, no direct OR transitive edge
 *   can leave it — including into a Node builtin, so the core cannot perform
 *   I/O, read a clock, or observe a host even accidentally. The forbidden-matcher
 *   list is kept as well, purely so a mistake fails with a NAMED boundary
 *   (`host_adapter`, `hook_implementation`, …) instead of a generic
 *   "unclassified".
 *
 * WHAT THIS IS NOT
 *   Repo-wide dependency-boundary enforcement across every module and consumer
 *   (MHRC-MOD-001..004) is W4/MH-07's dependency-graph tool. This evaluator is
 *   scoped to the MH-02 core and needs no graph of its own.
 *
 * PURITY
 *   `evaluateNeutralCoreBoundary` is a pure function of `{path, source}` records;
 *   it does not read the filesystem, which is what lets it be a core member and
 *   scan itself. The caller supplies the bytes.
 *
 * Pure library module; there is no CLI entrypoint.
 */

import { neutralFreeze, neutralOutcome } from "./neutral-runtime-contracts";
import type { NeutralOutcome } from "./neutral-runtime-contracts";

// ---------------------------------------------------------------------------
// Declared membership
// ---------------------------------------------------------------------------

/**
 * The host-neutral core, by file. Module-relative to
 * `src/modules/lifecycle/workflows/`. Adding a file here is the deliberate act
 * of putting it under the closure rule; the accompanying test fails if the
 * declaration and the supplied file set disagree in either direction.
 */
export const NEUTRAL_CORE_MEMBERS = [
  "neutral-runtime-contracts.ts",
  "neutral-gate-policy.ts",
  "neutral-lifecycle-machine.ts",
  "neutral-conformance-core.ts",
  "neutral-core-boundary.ts",
] as const;

export type NeutralCoreMember = (typeof NEUTRAL_CORE_MEMBERS)[number];

// ---------------------------------------------------------------------------
// Forbidden boundary classes
// ---------------------------------------------------------------------------

export interface NeutralForbiddenBoundaryMatcher {
  readonly id: string;
  readonly pattern: RegExp;
  readonly boundary: string;
}

/**
 * Named boundary classes the core must never reach. Patterns are built with
 * `new RegExp` from plain strings on purpose: a regex literal containing an
 * escaped slash would embed a `//` sequence in this file's own source, which is
 * needless noise in a file that gets read back as text by its own test.
 */
export const NEUTRAL_FORBIDDEN_BOUNDARY_MATCHERS: readonly NeutralForbiddenBoundaryMatcher[] =
  neutralFreeze([
    {
      id: "host_adapter",
      boundary: "host-adapters",
      pattern: new RegExp("(^|/)(host-runtime|host-adapter|host-adapters|[a-z0-9-]+-host-adapter)(/|$)"),
    },
    {
      id: "hook_implementation",
      boundary: "compatibility-shims",
      pattern: new RegExp("(^|/)hooks(/|$)"),
    },
    {
      id: "wrapper_or_launcher",
      boundary: "execution-transports",
      pattern: new RegExp("(launcher|wrapper|guild-run|agent-team|agent-bus)"),
    },
    {
      id: "execution_transport",
      boundary: "execution-transports",
      pattern: new RegExp("(pane-adapter|pane|tmux|remote-exec|process-exec|transport|dispatch)"),
    },
    {
      id: "benchmark_internals",
      boundary: "benchmark-internals",
      pattern: new RegExp("(^|/)(benchmark|benchmarks|evals)(/|$)"),
    },
    {
      id: "website_internals",
      boundary: "website-internals",
      pattern: new RegExp("(^|/)(website|site|docs-site)(/|$)"),
    },
    {
      id: "generated_mirror",
      boundary: "generated-projections",
      pattern: new RegExp("(^|/)(resources|dist)(/|$)"),
    },
    {
      id: "compatibility_shim",
      boundary: "compatibility-shims",
      pattern: new RegExp("(^|/)(scripts|shim|shims|compat)(/|$)"),
    },
    {
      id: "node_io_builtin",
      boundary: "node-runtime",
      pattern: new RegExp(
        "^(node:)?(fs|path|os|child_process|crypto|net|http|https|process|worker_threads|readline|tty|zlib|stream|url|util|module|vm|dns|cluster)$"
      ),
    },
  ]);

// ---------------------------------------------------------------------------
// Specifier extraction
// ---------------------------------------------------------------------------

/**
 * WHY A LEXER AND NOT A REGEX (MH-02-R1-B03)
 *
 * The previous extractor anchored static forms at column zero and allowed only
 * whitespace between `import`/`require` and `(`. Three concrete bypasses
 * followed, all of them valid TypeScript:
 *
 *     '  import * as fs from "fs";'    indented   → no specifier, verdict succeeded
 *     'import /_ core _/ ("fs")'       commented  → no specifier, verdict succeeded
 *     '// require("fs")'               commented-OUT → falsely reported forbidden
 *
 * A boundary sentinel that can be defeated by an indent proves nothing, so the
 * scan below is lexical: the source is tokenized once, with comments and string
 * bodies removed from the token stream, and edges are recognised over TOKENS.
 * Indentation, line breaks, and interleaved comments then cannot matter — they
 * are not tokens — and text inside a comment or a string can never be mistaken
 * for a dependency edge, because it never becomes an `import` token.
 *
 * This is also what makes the file safe to scan ITSELF: the prose above contains
 * the word `import` many times and the examples above contain whole import
 * statements, and none of them is an edge, because all of them are comment text.
 */

type NeutralTokenKind = "ident" | "string" | "punct";

interface NeutralToken {
  readonly kind: NeutralTokenKind;
  readonly value: string;
}

function isIdentStart(ch: string): boolean {
  return (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_" || ch === "$";
}

function isIdentPart(ch: string): boolean {
  return isIdentStart(ch) || (ch >= "0" && ch <= "9");
}

function isSpace(ch: string): boolean {
  return ch === " " || ch === "\t" || ch === "\r" || ch === "\n" || ch === "\f" || ch === "\v";
}

/**
 * Decide whether a `/` at this point starts a regex literal rather than a
 * division. The standard lexical heuristic: a regex may begin only where a value
 * may begin, i.e. NOT directly after something that ends a value. Getting this
 * right matters because a regex literal can otherwise hide a whole call —
 * a literal containing `require("fs")` must not be read as an edge.
 */
function regexMayStart(previous: NeutralToken | undefined): boolean {
  if (previous === undefined) return true;
  if (previous.kind === "string") return false;
  if (previous.kind === "ident") {
    // Keywords may be followed by a regex; value-like identifiers may not.
    return (
      previous.value === "return" ||
      previous.value === "typeof" ||
      previous.value === "instanceof" ||
      previous.value === "in" ||
      previous.value === "of" ||
      previous.value === "new" ||
      previous.value === "delete" ||
      previous.value === "void" ||
      previous.value === "case" ||
      previous.value === "do" ||
      previous.value === "else" ||
      previous.value === "yield" ||
      previous.value === "await"
    );
  }
  return previous.value !== ")" && previous.value !== "]" && previous.value !== "}";
}

/**
 * Tokenize enough TypeScript to find module specifiers exactly. Comments are
 * dropped entirely; strings become a single `string` token carrying their
 * decoded-enough body; everything else is an identifier, a number-ish run, or a
 * single punctuation character. Template literals are treated as opaque strings
 * except for their `${...}` holes, whose contents are tokenized normally so an
 * edge cannot hide inside an interpolation.
 */
export function tokenizeNeutralSource(source: string): NeutralToken[] {
  const tokens: NeutralToken[] = [];
  const templateDepths: number[] = [];
  let braceDepth = 0;
  let i = 0;

  while (i < source.length) {
    const ch = source.charAt(i);

    if (isSpace(ch)) {
      i += 1;
      continue;
    }

    // Comments — dropped, never tokens.
    if (ch === "/" && source.charAt(i + 1) === "/") {
      while (i < source.length && source.charAt(i) !== "\n") i += 1;
      continue;
    }
    if (ch === "/" && source.charAt(i + 1) === "*") {
      i += 2;
      while (i < source.length && !(source.charAt(i) === "*" && source.charAt(i + 1) === "/")) i += 1;
      i += 2;
      continue;
    }

    // Regex literal — consumed and discarded (it can never be a specifier).
    if (ch === "/" && regexMayStart(tokens[tokens.length - 1])) {
      let j = i + 1;
      let inClass = false;
      let closed = false;
      while (j < source.length) {
        const c = source.charAt(j);
        if (c === "\\") {
          j += 2;
          continue;
        }
        if (c === "\n") break;
        if (c === "[") inClass = true;
        else if (c === "]") inClass = false;
        else if (c === "/" && !inClass) {
          closed = true;
          j += 1;
          break;
        }
        j += 1;
      }
      if (closed) {
        while (j < source.length && isIdentPart(source.charAt(j))) j += 1;
        i = j;
        continue;
      }
      // Unterminated: fall through and treat as punctuation.
    }

    // Quoted strings.
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      let body = "";
      while (j < source.length) {
        const c = source.charAt(j);
        if (c === "\\") {
          body += source.charAt(j + 1);
          j += 2;
          continue;
        }
        if (c === ch || c === "\n") break;
        body += c;
        j += 1;
      }
      tokens.push({ kind: "string", value: body });
      i = j + 1;
      continue;
    }

    // Template literal — opaque, except that `${` opens normal tokenization.
    if (ch === "`") {
      let j = i + 1;
      let body = "";
      let opened = false;
      while (j < source.length) {
        const c = source.charAt(j);
        if (c === "\\") {
          body += source.charAt(j + 1);
          j += 2;
          continue;
        }
        if (c === "$" && source.charAt(j + 1) === "{") {
          opened = true;
          break;
        }
        if (c === "`") break;
        body += c;
        j += 1;
      }
      tokens.push({ kind: "string", value: body });
      if (opened) {
        templateDepths.push(braceDepth);
        braceDepth += 1;
        tokens.push({ kind: "punct", value: "{" });
        i = j + 2;
      } else {
        i = j + 1;
      }
      continue;
    }

    if (isIdentStart(ch)) {
      let j = i;
      while (j < source.length && isIdentPart(source.charAt(j))) j += 1;
      tokens.push({ kind: "ident", value: source.slice(i, j) });
      i = j;
      continue;
    }

    if (ch >= "0" && ch <= "9") {
      let j = i;
      while (j < source.length && (isIdentPart(source.charAt(j)) || source.charAt(j) === ".")) j += 1;
      // Numbers are emitted as a value-like `ident` (never the literal text, so
      // they can never match `from`/`import`). Value-like matters: it is what
      // makes `regexMayStart` read the `/` in `10 / 2` as division.
      tokens.push({ kind: "ident", value: "0" });
      i = j;
      continue;
    }

    if (ch === "{") braceDepth += 1;
    if (ch === "}") {
      braceDepth -= 1;
      if (templateDepths.length > 0 && templateDepths[templateDepths.length - 1] === braceDepth) {
        // Closing a `${...}` hole: resume the enclosing template literal.
        templateDepths.pop();
        tokens.push({ kind: "punct", value: "}" });
        let j = i + 1;
        let body = "";
        let reopened = false;
        while (j < source.length) {
          const c = source.charAt(j);
          if (c === "\\") {
            body += source.charAt(j + 1);
            j += 2;
            continue;
          }
          if (c === "$" && source.charAt(j + 1) === "{") {
            reopened = true;
            break;
          }
          if (c === "`") break;
          body += c;
          j += 1;
        }
        tokens.push({ kind: "string", value: body });
        if (reopened) {
          templateDepths.push(braceDepth);
          braceDepth += 1;
          tokens.push({ kind: "punct", value: "{" });
          i = j + 2;
        } else {
          i = j + 1;
        }
        continue;
      }
    }

    tokens.push({ kind: "punct", value: ch });
    i += 1;
  }

  return tokens;
}

const OPENERS = "([{";
const CLOSERS = ")]}";

function bracketDelta(token: NeutralToken): number {
  if (token.kind !== "punct") return 0;
  if (OPENERS.indexOf(token.value) !== -1) return 1;
  if (CLOSERS.indexOf(token.value) !== -1) return -1;
  return 0;
}

/**
 * Every module specifier a source file references, de-duplicated, first-seen
 * order. Recognised forms, all indentation- and comment-insensitive:
 *
 *   import x from "s"      import type {T} from "s"      import * as n from "s"
 *   import "s"             export {x} from "s"           export * from "s"
 *   import("s")            require("s")                  import /_ c _/ ("s")
 */
export function extractNeutralImportSpecifiers(source: string): string[] {
  const tokens = tokenizeNeutralSource(source);
  const found: string[] = [];
  const add = (specifier: string): void => {
    if (specifier.length > 0 && found.indexOf(specifier) === -1) found.push(specifier);
  };

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.kind !== "ident") continue;

    const isImport = token.value === "import";
    const isExport = token.value === "export";
    const isRequire = token.value === "require";
    if (!isImport && !isExport && !isRequire) continue;

    const next = tokens[index + 1];
    if (next === undefined) continue;

    // Call form: `import(...)` / `require(...)`. Comments between the callee and
    // the parenthesis have already been dropped, so `import /* c */ ("fs")`
    // reaches here as the same three tokens as `import("fs")`.
    if ((isImport || isRequire) && next.kind === "punct" && next.value === "(") {
      const argument = tokens[index + 2];
      if (argument !== undefined && argument.kind === "string") add(argument.value);
      continue;
    }

    if (isRequire) continue;

    // Bare side-effect import: `import "s"`.
    if (isImport && next.kind === "string") {
      add(next.value);
      continue;
    }

    // Static form: scan forward for `from "s"` at bracket depth 0, bounded by
    // the statement. Depth tracking is what lets `import { a, b } from "s"`
    // work while a `from` used as a parameter name stays invisible.
    let depth = 0;
    for (let j = index + 1; j < tokens.length; j += 1) {
      const candidate = tokens[j];
      const delta = bracketDelta(candidate);
      if (delta < 0 && depth === 0) break; // closed out of the enclosing block
      depth += delta;
      if (depth > 0) continue;
      if (candidate.kind === "punct" && candidate.value === ";") break;
      if (candidate.kind === "ident" && (candidate.value === "import" || candidate.value === "export")) {
        break;
      }
      if (candidate.kind === "ident" && candidate.value === "from") {
        const specifier = tokens[j + 1];
        if (specifier !== undefined && specifier.kind === "string") add(specifier.value);
        break;
      }
    }
  }

  return found;
}

// ---------------------------------------------------------------------------
// Verdict
// ---------------------------------------------------------------------------

export interface NeutralCoreSourceFile {
  /** Module-relative filename, e.g. `neutral-lifecycle-machine.ts`. */
  readonly path: string;
  readonly source: string;
}

export interface NeutralCoreBoundaryEdge {
  readonly importer: string;
  readonly specifier: string;
  readonly matcher_id?: string;
  readonly boundary?: string;
}

function isIntraCoreSpecifier(specifier: string): boolean {
  if (specifier.charAt(0) !== ".") return false;
  const tail = specifier.replace(/^\.\//, "");
  if (tail.indexOf("/") !== -1) return false;
  const withExtension = tail.endsWith(".ts") ? tail : `${tail}.ts`;
  return (NEUTRAL_CORE_MEMBERS as readonly string[]).indexOf(withExtension) !== -1;
}

/**
 * Verdict on the core's import closure. Reason-code priority is
 * membership → forbidden → unclassified: a membership disagreement means the
 * scan was not looking at the declared core at all, so reporting edge findings
 * from it would be misleading.
 *
 * An UNCLASSIFIED destination fails rather than passes, mirroring the
 * MHRC-MOD-001 rule "unclassified destinations fail the verdict". A boundary
 * scan that silently ignores what it does not recognise proves nothing.
 */
export function evaluateNeutralCoreBoundary(
  files: readonly NeutralCoreSourceFile[]
): NeutralOutcome {
  const declared = NEUTRAL_CORE_MEMBERS as readonly string[];
  const suppliedPaths = files.map((file) => file.path);
  const missingMembers = declared.filter((member) => suppliedPaths.indexOf(member) === -1);
  const undeclaredFiles = suppliedPaths.filter((supplied) => declared.indexOf(supplied) === -1);

  const forbidden: NeutralCoreBoundaryEdge[] = [];
  const unclassified: NeutralCoreBoundaryEdge[] = [];
  const intraCore: NeutralCoreBoundaryEdge[] = [];

  for (const file of files) {
    for (const specifier of extractNeutralImportSpecifiers(file.source)) {
      const matcher = NEUTRAL_FORBIDDEN_BOUNDARY_MATCHERS.find((candidate) =>
        candidate.pattern.test(specifier)
      );
      if (matcher !== undefined) {
        forbidden.push({
          importer: file.path,
          specifier,
          matcher_id: matcher.id,
          boundary: matcher.boundary,
        });
        continue;
      }
      if (isIntraCoreSpecifier(specifier)) {
        intraCore.push({ importer: file.path, specifier });
        continue;
      }
      unclassified.push({ importer: file.path, specifier });
    }
  }

  const edgeCount = forbidden.length + unclassified.length + intraCore.length;
  const facts = {
    declared_members: [...declared],
    missing_members: missingMembers,
    undeclared_files: undeclaredFiles,
    node_count: suppliedPaths.length,
    edge_count: edgeCount,
    intra_core_edges: intraCore,
    forbidden_edges: forbidden,
    unclassified_edges: unclassified,
  };

  if (missingMembers.length > 0 || undeclaredFiles.length > 0) {
    return neutralOutcome({
      type: "guild.boundary_outcome.v1",
      disposition: "failed",
      reason_code: "boundary_membership_mismatch",
      assertions: [
        "the scanned file set must equal the declared core membership",
        "a partial scan cannot prove closure",
      ],
      facts,
    });
  }

  if (forbidden.length > 0) {
    return neutralOutcome({
      type: "guild.boundary_outcome.v1",
      disposition: "failed",
      reason_code: "boundary_forbidden_edge",
      assertions: [
        "no core-to-concrete dependency edge exists",
        "dynamic and re-export edges are included",
      ],
      facts,
    });
  }

  if (unclassified.length > 0) {
    return neutralOutcome({
      type: "guild.boundary_outcome.v1",
      disposition: "failed",
      reason_code: "boundary_unclassified_edge",
      assertions: [
        "unclassified destinations fail the verdict",
        "the core is closed under import: only declared members are reachable",
      ],
      facts,
    });
  }

  return neutralOutcome({
    type: "guild.boundary_outcome.v1",
    disposition: "succeeded",
    assertions: [
      "no core-to-concrete dependency edge exists",
      "dynamic and re-export edges are included",
      "the core is closed under import, so no transitive escape exists",
    ],
    facts,
  });
}
