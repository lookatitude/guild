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

function isHexDigit(ch: string): boolean {
  return (ch >= "0" && ch <= "9") || (ch >= "a" && ch <= "f") || (ch >= "A" && ch <= "F");
}

/**
 * Read ONE `\uXXXX` or `\u{X..}` identifier escape at `start` (which must be the
 * backslash) and return the character it denotes.
 *
 * WHY THE LEXER MUST DECODE THESE (MH-02-R3-B01)
 *   ECMAScript identifiers may be written with Unicode escapes, and the escaped
 *   spelling is the SAME identifier: `require("fs")` binds and calls the
 *   very same `require`, and a direct Node control proves it returns a callable
 *   `fs.readFileSync`. The round-3 lexer had no case for `\`, so that source
 *   tokenized as ident(`requ`), punct(`\`), ident(`u0069re`) — no `require` token
 *   ever formed, zero edges were extracted, and the verdict was `succeeded`.
 *
 *   Decoding is therefore not a nicety: an exact-token recognizer that reads a
 *   different token stream than the engine does is not a recognizer at all. An
 *   escape that does NOT decode is reported rather than guessed, because a
 *   backslash the lexer cannot explain is precisely the position where the two
 *   readings could diverge again.
 */
function readIdentifierEscape(
  source: string,
  start: number
): { readonly char: string; readonly end: number } | undefined {
  if (source.charAt(start) !== "\\" || source.charAt(start + 1) !== "u") return undefined;
  if (source.charAt(start + 2) === "{") {
    let j = start + 3;
    let hex = "";
    while (j < source.length && isHexDigit(source.charAt(j))) {
      hex += source.charAt(j);
      j += 1;
    }
    if (hex.length === 0 || source.charAt(j) !== "}") return undefined;
    const code = parseInt(hex, 16);
    if (!Number.isFinite(code) || code > 0x10ffff) return undefined;
    return { char: String.fromCodePoint(code), end: j + 1 };
  }
  const hex = source.slice(start + 2, start + 6);
  if (hex.length < 4) return undefined;
  for (let k = 0; k < 4; k += 1) {
    if (!isHexDigit(hex.charAt(k))) return undefined;
  }
  return { char: String.fromCharCode(parseInt(hex, 16)), end: start + 6 };
}

function isSpace(ch: string): boolean {
  return ch === " " || ch === "\t" || ch === "\r" || ch === "\n" || ch === "\f" || ch === "\v";
}

/**
 * Decide whether a `/` at this point starts a regex literal rather than a
 * division, and say whether that decision is DECIDABLE without a parser.
 *
 * The standard lexical heuristic is "a regex may begin only where a value may
 * begin". Three positions defeat it, and all three are real (MH-02-R2-B02):
 *
 *   `)`     `if (x) /re/.test(s)` is a regex; `f(x) / 2` is division.
 *   `}`     `function f(){} /re/` is a regex; `obj.m() / 2` after a block is not.
 *   `++`/`--`  postfix (`x++ / y`, division) vs prefix (`++ /re/`, nonsense but
 *              lexically indistinguishable without knowing the operand).
 *
 * The round-2 extractor got the third one wrong in the unsafe direction: it read
 * `x++ / require("fs") / y` — valid code, plain division — as a regex literal
 * and swallowed the whole `require` call, then reported the core import-closed.
 * A sentinel that can be silenced by an increment proves nothing.
 *
 * So the choice at all three positions is DIVISION (which keeps ordinary
 * arithmetic working and keeps calls visible), and the position is reported as
 * `ambiguous` so the caller can fail closed when the counterfactual regex
 * reading would have hidden a dependency edge.
 */
type NeutralSlashReading = "regex" | "division" | "ambiguous_division";

function readSlashAs(
  previous: NeutralToken | undefined,
  beforePrevious: NeutralToken | undefined
): NeutralSlashReading {
  if (previous === undefined) return "regex";
  if (previous.kind === "string") return "division";
  if (previous.kind === "ident") {
    // Keywords may be followed by a regex; value-like identifiers may not.
    const keyword =
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
      previous.value === "await";
    return keyword ? "regex" : "division";
  }
  if (previous.value === ")" || previous.value === "}") return "ambiguous_division";
  if (previous.value === "]") return "division";
  // `++` and `--` reach here as two consecutive single-character punct tokens.
  const doubled =
    beforePrevious !== undefined &&
    beforePrevious.kind === "punct" &&
    beforePrevious.value === previous.value;
  if (doubled && (previous.value === "+" || previous.value === "-")) return "ambiguous_division";
  return "regex";
}

/**
 * The kinds of lexical position where what the scan reads could differ from what
 * an engine executes.
 *
 *   regex_or_division    a `/` whose reading is undecidable without a parser AND
 *                        whose discarded reading spans `import`/`require`
 *   escaped_identifier   an identifier written with a Unicode escape. It DOES
 *                        decode (so the edge below is still seen), but escaping
 *                        an identifier in a core member has no legitimate use and
 *                        exists only to defeat a token recognizer, so the file is
 *                        reported rather than quietly accepted
 *   undecodable_escape   a backslash the lexer cannot explain at all, i.e. the
 *                        exact position where the two readings could diverge again
 */
export type NeutralSourceAmbiguityKind =
  | "regex_or_division"
  | "escaped_identifier"
  | "undecodable_escape";

/**
 * A lexical position where the reading is undecidable AND the readings disagree
 * about the dependency graph.
 *
 * Only that conjunction is reported for `regex_or_division`. Ordinary arithmetic
 * after a call or a block is ambiguous too, but both readings agree there is no
 * edge, so it is silent.
 */
export interface NeutralSourceAmbiguity {
  readonly kind: NeutralSourceAmbiguityKind;
  /** The text the discarded reading would have consumed, trimmed for reporting. */
  readonly hidden_text: string;
}

const DEPENDENCY_WORD = new RegExp("(^|[^A-Za-z0-9_$])(import|require)([^A-Za-z0-9_$]|$)");

/**
 * Walk a would-be regex literal starting at the `/` at `start`. Used BOTH to
 * consume a real regex and to compute the counterfactual body at an ambiguous
 * position, so the two can never drift apart.
 */
function scanRegexLiteral(source: string, start: number): { closed: boolean; end: number } {
  let j = start + 1;
  let inClass = false;
  while (j < source.length) {
    const c = source.charAt(j);
    if (c === "\\") {
      j += 2;
      continue;
    }
    if (c === "\n") return { closed: false, end: j };
    if (c === "[") inClass = true;
    else if (c === "]") inClass = false;
    else if (c === "/" && !inClass) {
      j += 1;
      while (j < source.length && isIdentPart(source.charAt(j))) j += 1;
      return { closed: true, end: j };
    }
    j += 1;
  }
  return { closed: false, end: j };
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
  return tokenizeNeutralSourceWithDiagnostics(source).tokens;
}

/**
 * The same lexer, plus the ambiguity ledger. `tokenizeNeutralSource` is the
 * token-only view kept for callers that do not need to fail closed.
 */
export function tokenizeNeutralSourceWithDiagnostics(source: string): {
  readonly tokens: NeutralToken[];
  readonly ambiguities: NeutralSourceAmbiguity[];
} {
  const tokens: NeutralToken[] = [];
  const ambiguities: NeutralSourceAmbiguity[] = [];
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

    // Regex literal, division, or the undecidable position between them.
    if (ch === "/") {
      const reading = readSlashAs(tokens[tokens.length - 1], tokens[tokens.length - 2]);
      if (reading === "regex") {
        const scan = scanRegexLiteral(source, i);
        if (scan.closed) {
          // Consumed and discarded: a regex literal can never be a specifier,
          // which is what keeps `/require\("fs"\)/` from inventing an edge.
          i = scan.end;
          continue;
        }
        // Unterminated: fall through and treat as punctuation.
      } else if (reading === "ambiguous_division") {
        // Read it as division (so the call stays visible), but record the
        // ambiguity when the discarded alternative would have hidden an edge.
        const scan = scanRegexLiteral(source, i);
        if (scan.closed) {
          const hidden = source.slice(i, scan.end);
          if (DEPENDENCY_WORD.test(hidden)) {
            ambiguities.push({
              kind: "regex_or_division",
              hidden_text: hidden.length > 120 ? `${hidden.slice(0, 117)}...` : hidden,
            });
          }
        }
      }
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

    // Identifier, possibly written with Unicode escapes. Decoding is what makes
    // the token stream the one the engine sees (MH-02-R3-B01).
    if (isIdentStart(ch) || (ch === "\\" && readIdentifierEscape(source, i) !== undefined)) {
      let j = i;
      let value = "";
      let escaped = false;
      while (j < source.length) {
        const c = source.charAt(j);
        if (c === "\\") {
          const decoded = readIdentifierEscape(source, j);
          if (decoded === undefined) break;
          value += decoded.char;
          escaped = true;
          j = decoded.end;
          continue;
        }
        if (!isIdentPart(c)) break;
        value += c;
        j += 1;
      }
      if (escaped) {
        ambiguities.push({
          kind: "escaped_identifier",
          hidden_text: `${source.slice(i, j)} decodes to ${value}`,
        });
      }
      tokens.push({ kind: "ident", value });
      i = j;
      continue;
    }

    // A backslash that is NOT a decodable identifier escape. The lexer cannot say
    // what an engine would do here, so it says so instead of dropping it.
    if (ch === "\\") {
      ambiguities.push({
        kind: "undecodable_escape",
        hidden_text: source.slice(i, Math.min(i + 12, source.length)),
      });
      tokens.push({ kind: "punct", value: ch });
      i += 1;
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

  return { tokens, ambiguities };
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
 * One dependency edge the scan found, resolved or not.
 *
 * WHY UNRESOLVED IS AN EDGE, NOT A NON-EVENT (MH-02-R2-B02)
 *   The round-2 extractor recorded a call's argument only when it was a string
 *   token, and silently dropped every other argument shape. So
 *   `const builtin = "fs"; require(builtin)` extracted nothing and the verdict
 *   was `succeeded` — the core could execute a Node builtin while the sentinel
 *   reported it import-closed. Closure is a claim about ALL edges, so an edge
 *   whose destination the scanner cannot resolve is not "no edge"; it is
 *   "closure unproven", and it must fail.
 */
export interface NeutralImportEdge {
  readonly kind: "resolved" | "unresolved";
  /** Present only when `kind === "resolved"`. */
  readonly specifier?: string;
  /** The syntactic form the edge was recognised in, for actionable reporting. */
  readonly form: string;
  /** Present only when `kind === "unresolved"`: why it could not be resolved. */
  readonly detail?: string;
}

const OPTIONAL_CALL = "optional_call";

/**
 * Collect the tokens of a call's FIRST argument, given the index of its `(`.
 * Returns `undefined` when the call never closes (truncated source).
 */
function firstArgumentTokens(
  tokens: readonly NeutralToken[],
  openIndex: number
): NeutralToken[] | undefined {
  const collected: NeutralToken[] = [];
  let depth = 1;
  for (let j = openIndex + 1; j < tokens.length; j += 1) {
    const token = tokens[j];
    const delta = bracketDelta(token);
    if (delta > 0) depth += 1;
    else if (delta < 0) {
      depth -= 1;
      if (depth === 0) return collected;
    }
    // A top-level comma ends the first argument (e.g. import attributes).
    if (depth === 1 && token.kind === "punct" && token.value === ",") return collected;
    collected.push(token);
  }
  return undefined;
}

function describeTokens(tokens: readonly NeutralToken[]): string {
  const rendered = tokens
    .map((token) => (token.kind === "string" ? `"${token.value}"` : token.value))
    .join(" ");
  return rendered.length > 80 ? `${rendered.slice(0, 77)}...` : rendered;
}

/**
 * Every dependency edge a source file declares, de-duplicated, first-seen order.
 * Recognised RESOLVED forms, all indentation- and comment-insensitive:
 *
 *   import x from "s"      import type {T} from "s"      import * as n from "s"
 *   import "s"             export {x} from "s"           export * from "s"
 *   import("s")            require("s")                  import /_ c _/ ("s")
 *
 * Everything else that reaches an `import`/`require` token is UNRESOLVED and
 * fails the verdict: a computed argument (`require(name)`), a concatenated or
 * interpolated one, a conditional one, an empty or absent one, an optional call
 * (`require?.("s")` — resolvable, but only once the form is recognised at all),
 * and any use of `require` as a value rather than as a callee.
 *
 * `import` used as `import.meta` is deliberately NOT an edge: it is a property
 * access on the module record, not a module reference. A STATIC import
 * specifier cannot be computed in the language, so a static form that yields no
 * `from "s"` is likewise not treated as unresolved — there is nothing to hide.
 */
export function extractNeutralImportEdges(source: string): NeutralImportEdge[] {
  const tokens = tokenizeNeutralSource(source);
  const edges: NeutralImportEdge[] = [];
  const seen: string[] = [];

  const push = (edge: NeutralImportEdge): void => {
    const key = `${edge.kind}|${edge.specifier ?? ""}|${edge.form}|${edge.detail ?? ""}`;
    if (seen.indexOf(key) !== -1) return;
    seen.push(key);
    edges.push(edge);
  };
  const add = (specifier: string, form: string): void => {
    if (specifier.length > 0) push({ kind: "resolved", specifier, form });
    else push({ kind: "unresolved", form, detail: "empty specifier" });
  };

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.kind !== "ident") continue;

    const isImport = token.value === "import";
    const isExport = token.value === "export";
    const isRequire = token.value === "require";
    if (!isImport && !isExport && !isRequire) continue;

    const next = tokens[index + 1];
    if (next === undefined) {
      if (isRequire) push({ kind: "unresolved", form: "require", detail: "require used as a value" });
      continue;
    }

    // Call form, plain or optional. Comments between the callee and the
    // parenthesis have already been dropped, so `import /* c */ ("fs")` reaches
    // here as the same tokens as `import("fs")`; `require?.("fs")` reaches here
    // as `require` `?` `.` `(` and is the same call.
    const optional =
      next.kind === "punct" &&
      next.value === "?" &&
      tokens[index + 2]?.kind === "punct" &&
      tokens[index + 2]?.value === "." &&
      tokens[index + 3]?.kind === "punct" &&
      tokens[index + 3]?.value === "(";
    const plainCall = next.kind === "punct" && next.value === "(";

    if ((isImport || isRequire) && (plainCall || optional)) {
      const callee = isImport ? "import" : "require";
      const form = optional ? `${callee}${OPTIONAL_CALL}` : `${callee}()`;
      const openIndex = optional ? index + 3 : index + 1;
      const argument = firstArgumentTokens(tokens, openIndex);
      if (argument === undefined) {
        push({ kind: "unresolved", form, detail: "unterminated call" });
      } else if (argument.length === 0) {
        push({ kind: "unresolved", form, detail: "no argument" });
      } else if (argument.length === 1 && argument[0].kind === "string") {
        add(argument[0].value, form);
      } else {
        // A computed, concatenated, interpolated, or conditional specifier. The
        // destination is decided at RUNTIME, so the scanner cannot prove it
        // stays inside the core, and must not pretend the edge is absent.
        push({
          kind: "unresolved",
          form,
          detail: `non-literal specifier: ${describeTokens(argument)}`,
        });
      }
      continue;
    }

    if (isRequire) {
      // `require` reached in any position that is not a call: aliased
      // (`const r = require`), member-invoked (`require.call(this, "fs")`), or
      // passed along. Each of those can perform a real import that no lexical
      // scan can follow, so the core declaring one is a closure failure.
      push({
        kind: "unresolved",
        form: "require",
        detail: `require used as a value (followed by ${describeTokens([next])})`,
      });
      continue;
    }

    // `import.meta` — a property access on the module record, not an edge.
    if (isImport && next.kind === "punct" && next.value === ".") continue;

    // Bare side-effect import: `import "s"`.
    if (isImport && next.kind === "string") {
      add(next.value, "import");
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
        if (specifier !== undefined && specifier.kind === "string") {
          add(specifier.value, isExport ? "export from" : "import from");
        }
        break;
      }
    }
  }

  return edges;
}

/**
 * Literal specifiers only, de-duplicated, first-seen order.
 *
 * Kept as the narrow view for callers that want the resolved destinations. It
 * is NOT the closure check: an unresolved edge is invisible here by
 * construction, which is exactly why `evaluateNeutralCoreBoundary` reads
 * `extractNeutralImportEdges` instead.
 */
export function extractNeutralImportSpecifiers(source: string): string[] {
  const found: string[] = [];
  for (const edge of extractNeutralImportEdges(source)) {
    if (edge.kind !== "resolved" || edge.specifier === undefined) continue;
    if (found.indexOf(edge.specifier) === -1) found.push(edge.specifier);
  }
  return found;
}

// ---------------------------------------------------------------------------
// Capability closure (MH-02-R3-B01)
// ---------------------------------------------------------------------------

/**
 * WHY MODULE EDGES ARE NOT ENOUGH
 *
 * Rounds 1–3 hardened the recognizer that finds `import`/`require` TOKENS. Round
 * 3 then defeated it four ways WITHOUT writing either token, and every one of
 * them executes:
 *
 *     module["require"]("fs")                 the name lives in a STRING token
 *     eval("require")("fs")                   ditto, then the result is called
 *     Function("return require")()("fs")      ditto, via the evaluator intrinsic
 *     require("fs")                      the token never lexed at all
 *
 * A direct Node control confirms `module["require"]("fs")`, `eval("require")("fs")`,
 * the escaped identifier, and `Function("return globalThis.process.binding")()("fs")`
 * all hand back real Node I/O.
 *
 * Chasing those four spellings would be whack-a-mole: `globalThis["require"]`,
 * `process.binding`, `Reflect.get(module, "require")`, `new Function(...)`,
 * `(0, eval)(...)`, and `[]["constructor"]["constructor"](...)` are all further
 * spellings of the same two mechanisms. So the closure argument is widened from
 * MODULE closure to CAPABILITY closure, which subsumes it:
 *
 *   THE INVARIANT
 *     A core member may only CALL what it declares itself, imports from another
 *     declared core member, or draws from a fixed allowlist of pure ECMAScript
 *     intrinsics that can yield neither I/O nor code evaluation. Any callee the
 *     scan cannot reduce to such a named root, and any reference to an ambient
 *     binding the core neither declares nor imports, fails closed.
 *
 *   WHY IT IS SOUND RATHER THAN A LONGER DENYLIST
 *     Reaching Node I/O or an external package requires OBTAINING a capability
 *     and then CALLING it. Every call site is checked, and the check is an
 *     ALLOWLIST, so a spelling nobody anticipated fails by default instead of
 *     passing by default. `eval`, `Function`, `module`, `require`, `process`,
 *     `global`, `globalThis`, `Reflect`, `console`, `Date`, and the timers are
 *     not on the allowlist — not because they are enumerated as forbidden, but
 *     because nothing is permitted that is not enumerated as pure.
 *
 *   WHY A LOCAL FUNCTION NEED NOT BE FOLLOWED
 *     `helper().m("fs")` is allowed to the extent that `helper` is itself a
 *     declared name, because whatever `helper` returns had to be built from the
 *     same closed set of literals, imports, and pure intrinsics. The recursion
 *     bottoms out: to smuggle a capability into `helper`, the file must contain
 *     an ambient reference or an indirect callee somewhere, and both fail here.
 *
 *   HONEST LIMIT
 *     This is a lexical analysis, not a type-checked dataflow proof. It is sound
 *     for the mechanisms above because both of them are syntactically visible at
 *     the call site. Constructs the binding collector does not model — classes,
 *     object-literal methods, accessors — are not silently permitted: their
 *     callees resolve to no collected binding and therefore FAIL, which is the
 *     right direction for an analyzer that has not been taught a construct. The
 *     five current core members use none of them. Repo-wide graph enforcement
 *     (MHRC-MOD-001..004) remains W4/MH-07's job; this stays the MH-02 core's
 *     scoped self-check.
 */

/**
 * Roots a core member may reference without declaring or importing them: pure
 * ECMAScript intrinsics that hold no host handle, perform no I/O, read no clock,
 * and evaluate no code.
 *
 * The exclusions are the point. `Function` and `eval` evaluate code. `Date` and
 * `performance` read a clock. `console`, `process`, `Buffer`, and the timers are
 * host surface. `module`, `exports`, `require`, `global`, and `globalThis` are
 * the CommonJS/ambient escape hatches. `Reflect` and `Proxy` reach any property
 * of any object by computed name, including a loader. None of them is listed, so
 * all of them fail — as would any future intrinsic nobody has thought of yet.
 */
export const NEUTRAL_PURE_INTRINSIC_ROOTS: readonly string[] = neutralFreeze([
  "Object",
  "Array",
  "String",
  "Number",
  "Boolean",
  "Math",
  "JSON",
  "RegExp",
  "Error",
  "TypeError",
  "RangeError",
  "SyntaxError",
  "Map",
  "Set",
  "Symbol",
  "isNaN",
  "isFinite",
  "parseInt",
  "parseFloat",
  "NaN",
  "Infinity",
  "undefined",
]);

/**
 * Tokens this lexer emits as identifiers that are not value references at all:
 * ECMAScript/TypeScript keywords, and the type-level names TypeScript erases.
 * A type annotation cannot obtain a capability, because it does not exist at
 * runtime — so allowlisting the type vocabulary costs nothing.
 */
const NEUTRAL_LANGUAGE_WORDS: readonly string[] = neutralFreeze([
  // statement + expression keywords
  "import", "export", "from", "as", "default", "const", "let", "var", "function",
  "class", "extends", "implements", "return", "if", "else", "for", "while", "do",
  "switch", "case", "break", "continue", "new", "delete", "typeof", "instanceof",
  "in", "of", "void", "null", "true", "false", "this", "super", "throw", "try",
  "catch", "finally", "yield", "await", "async", "static", "public", "private",
  "protected", "readonly", "abstract", "declare", "namespace", "enum", "module",
  "get", "set", "with", "debugger", "label",
  // type-level vocabulary (erased at runtime)
  "type", "interface", "keyof", "infer", "is", "asserts", "satisfies", "unique",
  "out", "override", "accessor", "using", "string", "number", "boolean",
  "unknown", "any", "never", "object", "symbol", "bigint",
  "Record", "Readonly", "Partial", "Required", "Pick", "Omit", "Exclude",
  "Extract", "ReturnType", "Parameters", "NonNullable", "Awaited",
]);

function isNeutralLanguageWord(name: string): boolean {
  return NEUTRAL_LANGUAGE_WORDS.indexOf(name) !== -1;
}

/**
 * The lexer emits a numeric literal as the value-like `ident` token `0` (so that
 * `10 / 2` reads as division rather than a regex start). A real identifier can
 * never begin with a digit, so that is an unambiguous marker — and a number is
 * not a reference to anything.
 */
function isNumericToken(token: NeutralToken): boolean {
  const first = token.value.charAt(0);
  return first >= "0" && first <= "9";
}

/**
 * `module` deserves a note: it is in the language-word list because TypeScript
 * uses `module` as a declaration keyword (`declare module "x"`), so the bare
 * token cannot be treated as an ambient reference without false-positiving on
 * type declarations. That is exactly why `module["require"](...)` is caught by
 * the INDIRECT-CALLEE rule instead — a computed-member callee is unresolvable
 * whatever its base is named, so the base never needs to be recognised.
 */

/** Punctuation positions after which a `(` opens a group, not a call. */
const NEUTRAL_VALUE_START_PUNCT = "=,([:;{}|&?>!+-*/%<~^";

/** Keywords that may be followed by `(` without that `(` being a call. */
const NEUTRAL_NON_CALLEE_WORDS: readonly string[] = [
  "if", "while", "for", "switch", "catch", "do", "with", "return", "typeof",
  "instanceof", "in", "of", "void", "delete", "new", "yield", "await", "case",
  "else", "throw", "function", "import", "export", "as", "satisfies",
];

function matchingCloseIndex(tokens: readonly NeutralToken[], openIndex: number): number {
  let depth = 0;
  for (let j = openIndex; j < tokens.length; j += 1) {
    const delta = bracketDelta(tokens[j]);
    if (delta > 0) depth += 1;
    else if (delta < 0) {
      depth -= 1;
      if (depth === 0) return j;
    }
  }
  return -1;
}

function isPunct(token: NeutralToken | undefined, value: string): boolean {
  return token !== undefined && token.kind === "punct" && token.value === value;
}

/**
 * Does the `(` at `openIndex` introduce a PARAMETER list rather than a call or a
 * grouping? Parameters are bindings, so getting this wrong in the permissive
 * direction would let an ambient name masquerade as a local one — which is why
 * control-flow parentheses (`if (x)`, `for (…)`) are excluded explicitly rather
 * than by hoping their shape differs.
 */
function isParameterList(tokens: readonly NeutralToken[], openIndex: number): boolean {
  const close = matchingCloseIndex(tokens, openIndex);
  if (close === -1) return false;
  const previous = tokens[openIndex - 1];
  const beforePrevious = tokens[openIndex - 2];

  // `function (…)` and `function name(…)`
  if (previous !== undefined && previous.kind === "ident" && previous.value === "function") return true;
  if (
    previous !== undefined &&
    previous.kind === "ident" &&
    beforePrevious !== undefined &&
    beforePrevious.kind === "ident" &&
    beforePrevious.value === "function"
  ) {
    return true;
  }

  // An arrow (or a return-type-annotated arrow) parameter list may only appear
  // where a value may begin, which is what keeps `if (cond) {` out.
  const atValueStart =
    previous === undefined ||
    (previous.kind === "punct" && NEUTRAL_VALUE_START_PUNCT.indexOf(previous.value) !== -1);
  if (!atValueStart) return false;
  const arrow = isPunct(tokens[close + 1], "=") && isPunct(tokens[close + 2], ">");
  const annotated = isPunct(tokens[close + 1], ":");
  return arrow || annotated;
}

function pushUnique(list: string[], value: string): void {
  if (value.length > 0 && list.indexOf(value) === -1) list.push(value);
}

function collectParameterNames(
  tokens: readonly NeutralToken[],
  openIndex: number,
  close: number,
  into: string[]
): void {
  let expectBinding = true;
  for (let j = openIndex + 1; j < close; j += 1) {
    const token = tokens[j];
    if (token.kind === "punct") {
      if (token.value === ",") expectBinding = true;
      else if (token.value === ":" || token.value === "=" || token.value === ".") expectBinding = false;
      continue;
    }
    if (token.kind === "string") {
      expectBinding = false;
      continue;
    }
    if (expectBinding && !isNeutralLanguageWord(token.value)) {
      pushUnique(into, token.value);
      expectBinding = false;
    }
  }
}

/** Type parameters (`<T, U extends V>`) are bindings too, and erase at runtime. */
function collectTypeParameterNames(
  tokens: readonly NeutralToken[],
  openIndex: number,
  into: string[]
): void {
  let depth = 0;
  let expectBinding = true;
  for (let j = openIndex; j < tokens.length; j += 1) {
    const token = tokens[j];
    if (token.kind === "punct") {
      if (token.value === "<") depth += 1;
      else if (token.value === ">") {
        depth -= 1;
        if (depth === 0) return;
      } else if (token.value === "," && depth === 1) expectBinding = true;
      else if (token.value === "(" || token.value === "{" || token.value === ";") return;
      continue;
    }
    if (token.kind !== "ident") continue;
    if (expectBinding && !isNeutralLanguageWord(token.value)) {
      pushUnique(into, token.value);
      expectBinding = false;
    }
  }
}

function collectImportBindings(
  tokens: readonly NeutralToken[],
  importIndex: number,
  into: string[]
): void {
  for (let j = importIndex + 1; j < tokens.length; j += 1) {
    const token = tokens[j];
    if (token.kind === "string") return;
    if (token.kind === "punct" && (token.value === ";" || token.value === "(")) return;
    if (token.kind !== "ident") continue;
    if (token.value === "from") return;
    if (!isNeutralLanguageWord(token.value)) pushUnique(into, token.value);
  }
}

function collectDeclaratorNames(
  tokens: readonly NeutralToken[],
  keywordIndex: number,
  into: string[]
): void {
  let depth = 0;
  let annotating = false;
  for (let j = keywordIndex + 1; j < tokens.length; j += 1) {
    const token = tokens[j];
    const delta = bracketDelta(token);
    if (delta < 0 && depth === 0) return; // closed out of the enclosing group
    if (token.kind === "punct") {
      if (depth === 0 && (token.value === ";" || token.value === "=")) return;
      if (depth === 0 && token.value === ":") annotating = true;
      if (depth === 0 && token.value === ",") annotating = false;
      depth += delta;
      continue;
    }
    if (token.kind === "string") continue;
    // A `for (… of|in …)` head ends the binding list.
    if (token.value === "of" || token.value === "in") return;
    if (!annotating && !isNeutralLanguageWord(token.value)) pushUnique(into, token.value);
  }
}

/**
 * Every name a source file binds locally: imports, declarations, destructuring
 * patterns, parameters, type parameters, and catch bindings.
 *
 * Collection is deliberately keyword-anchored. A bare USE such as
 * `module["require"]` contributes nothing, so a capability name can never enter
 * this set merely by appearing in the file.
 */
export function collectNeutralBoundNames(tokens: readonly NeutralToken[]): string[] {
  const bound: string[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];

    if (token.kind === "punct") {
      if (token.value === "(" && isParameterList(tokens, i)) {
        collectParameterNames(tokens, i, matchingCloseIndex(tokens, i), bound);
      }
      continue;
    }
    if (token.kind !== "ident") continue;

    // `x => …`: a single parameter without parentheses.
    if (
      isPunct(tokens[i + 1], "=") &&
      isPunct(tokens[i + 2], ">") &&
      !isNeutralLanguageWord(token.value)
    ) {
      pushUnique(bound, token.value);
    }

    if (token.value === "import") {
      collectImportBindings(tokens, i, bound);
      continue;
    }
    if (
      token.value === "function" ||
      token.value === "class" ||
      token.value === "interface" ||
      token.value === "type" ||
      token.value === "enum" ||
      token.value === "namespace"
    ) {
      const name = tokens[i + 1];
      if (name !== undefined && name.kind === "ident") {
        pushUnique(bound, name.value);
        if (isPunct(tokens[i + 2], "<")) collectTypeParameterNames(tokens, i + 2, bound);
      }
      continue;
    }
    if (token.value === "catch" && isPunct(tokens[i + 1], "(")) {
      const binding = tokens[i + 2];
      if (binding !== undefined && binding.kind === "ident") pushUnique(bound, binding.value);
      continue;
    }
    if (token.value === "const" || token.value === "let" || token.value === "var") {
      collectDeclaratorNames(tokens, i, bound);
      continue;
    }
  }
  return bound;
}

/** A call whose callee the scan cannot reduce to a named destination. */
export interface NeutralIndirectCallee {
  readonly form: string;
  readonly detail: string;
}

/** A reference to a binding the file neither declares nor imports. */
export interface NeutralAmbientCapability {
  readonly name: string;
  readonly usage: string;
}

function describeCallee(tokens: readonly NeutralToken[], openIndex: number): string {
  const from = openIndex - 6 < 0 ? 0 : openIndex - 6;
  return describeTokens(tokens.slice(from, openIndex + 1));
}

/**
 * Callee closure + ambient-reference closure over one source file.
 *
 * INDIRECT CALLEES are calls whose callee is a computed member access, another
 * call's result, or a literal — `module["require"](…)`, `eval("require")(…)`,
 * `[]["constructor"]["constructor"](…)`, `(0, eval)(…)`. The callee's DESTINATION
 * is decided at runtime, so the scan cannot prove it stays inside the core, and
 * must not pretend the call is absent.
 *
 * A method call on an expression result (`tokens.map(fn).join(" ")`) is NOT
 * indirect: the callee is a NAMED property, and the expression it hangs off is
 * separately checked by these same rules. That distinction is what keeps
 * ordinary chained code readable while `x[k](…)` still fails.
 *
 * AMBIENT REFERENCES are identifiers used as a value that the file neither
 * declares nor imports and that are not pure intrinsics.
 */
export function analyzeNeutralCapabilityUse(source: string): {
  readonly indirect: NeutralIndirectCallee[];
  readonly ambient: NeutralAmbientCapability[];
} {
  const tokens = tokenizeNeutralSource(source);
  const bound = collectNeutralBoundNames(tokens);
  const indirect: NeutralIndirectCallee[] = [];
  const ambient: NeutralAmbientCapability[] = [];
  const seenIndirect: string[] = [];
  const seenAmbient: string[] = [];

  const addIndirect = (form: string, detail: string): void => {
    const key = `${form}|${detail}`;
    if (seenIndirect.indexOf(key) !== -1) return;
    seenIndirect.push(key);
    indirect.push({ form, detail });
  };

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];

    // ---- indirect callees -------------------------------------------------
    if (token.kind === "punct" && token.value === "(" && !isParameterList(tokens, i)) {
      // `x?.(…)` reaches here as `?` `.` `(`, so step back over it.
      const optional = isPunct(tokens[i - 1], ".") && isPunct(tokens[i - 2], "?");
      const previous = optional ? tokens[i - 3] : tokens[i - 1];
      if (previous !== undefined) {
        if (previous.kind === "punct" && previous.value === "]") {
          addIndirect("computed_member_call", describeCallee(tokens, i));
        } else if (previous.kind === "punct" && previous.value === ")") {
          addIndirect("call_result_call", describeCallee(tokens, i));
        } else if (previous.kind === "string") {
          addIndirect("literal_call", describeCallee(tokens, i));
        }
      }
    }

    // ---- ambient references ----------------------------------------------
    if (token.kind !== "ident") continue;
    if (isPunct(tokens[i - 1], ".")) continue; // a property name, not a reference
    // `key:` (object literal / label) and `key?:` (optional member) are names,
    // not references.
    if (isPunct(tokens[i + 1], ":")) continue;
    if (isPunct(tokens[i + 1], "?") && isPunct(tokens[i + 2], ":")) continue;
    if (isNumericToken(token)) continue;
    if (isNeutralLanguageWord(token.value)) continue;
    if (NEUTRAL_PURE_INTRINSIC_ROOTS.indexOf(token.value) !== -1) continue;
    if (bound.indexOf(token.value) !== -1) continue;

    const next = tokens[i + 1];
    const usage =
      next === undefined
        ? "reference"
        : next.kind === "punct" && next.value === "("
          ? "call"
          : next.kind === "punct" && next.value === "."
            ? "member"
            : next.kind === "punct" && next.value === "["
              ? "computed_member"
              : "reference";
    const key = `${token.value}|${usage}`;
    if (seenAmbient.indexOf(key) !== -1) continue;
    seenAmbient.push(key);
    ambient.push({ name: token.value, usage });
  }

  return { indirect, ambient };
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

/** An edge that exists but whose destination the scan could not determine. */
export interface NeutralCoreUnresolvedEdge {
  readonly importer: string;
  readonly form: string;
  readonly detail: string;
}

/** A lexing ambiguity that could conceal an edge in the importer's source. */
export interface NeutralCoreSourceAmbiguity {
  readonly importer: string;
  readonly kind: string;
  readonly hidden_text: string;
}

/** A call in a core member whose callee has no scan-resolvable destination. */
export interface NeutralCoreIndirectCallee {
  readonly importer: string;
  readonly form: string;
  readonly detail: string;
}

/** An ambient binding a core member reaches without declaring or importing it. */
export interface NeutralCoreAmbientCapability {
  readonly importer: string;
  readonly name: string;
  readonly usage: string;
}

function isIntraCoreSpecifier(specifier: string): boolean {
  if (specifier.charAt(0) !== ".") return false;
  const tail = specifier.replace(/^\.\//, "");
  if (tail.indexOf("/") !== -1) return false;
  const withExtension = tail.endsWith(".ts") ? tail : `${tail}.ts`;
  return (NEUTRAL_CORE_MEMBERS as readonly string[]).indexOf(withExtension) !== -1;
}

/**
 * Verdict on the core's import AND capability closure. Reason-code priority is
 *
 *   membership → forbidden → unresolved → ambient → indirect → ambiguous
 *              → unclassified
 *
 * A membership disagreement comes first because the scan was then not looking at
 * the declared core at all, so reporting edge findings from it would mislead. A
 * PROVEN breach (`forbidden`) outranks an UNPROVABLE one, so the most actionable
 * named boundary is what a reader sees when both are present. Among the
 * unprovable ones, naming the ambient binding (`eval`, `process`, `globalThis`)
 * is more actionable than naming the call shape, so it is reported first.
 *
 * Every one of the seven is a FAILURE. Five of them exist because an earlier
 * scan answered "succeeded" in cases where it had simply not looked:
 *
 *   unresolved    an edge whose destination is computed at runtime
 *                 (`require(name)`, `import(\`${m}\`)`, `require?.()` unread)
 *   ambient       a reference to a binding the core neither declares nor imports
 *                 and that is not a pure intrinsic (`eval`, `process`, `Date`)
 *   indirect      a call whose callee is a computed member access, another call's
 *                 result, or a literal (`module["require"](…)`, `eval("…")(…)`)
 *   ambiguous     a `/` the lexer cannot classify without a parser where the
 *                 discarded reading would have swallowed an import/require, an
 *                 identifier written with a Unicode escape, or a backslash the
 *                 lexer cannot explain
 *   unclassified  a destination outside the core that matches no named boundary
 *                 (MHRC-MOD-001: "unclassified destinations fail the verdict")
 *
 * Closure is a universal claim. A scan that silently ignores what it cannot
 * resolve is not evidence of closure; it is absence of evidence, and BR-07
 * already says absence is never success.
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
  const unresolved: NeutralCoreUnresolvedEdge[] = [];
  const ambiguous: NeutralCoreSourceAmbiguity[] = [];
  const indirectCallees: NeutralCoreIndirectCallee[] = [];
  const ambientCapabilities: NeutralCoreAmbientCapability[] = [];

  for (const file of files) {
    for (const ambiguity of tokenizeNeutralSourceWithDiagnostics(file.source).ambiguities) {
      ambiguous.push({
        importer: file.path,
        kind: ambiguity.kind,
        hidden_text: ambiguity.hidden_text,
      });
    }
    const capability = analyzeNeutralCapabilityUse(file.source);
    for (const callee of capability.indirect) {
      indirectCallees.push({ importer: file.path, form: callee.form, detail: callee.detail });
    }
    for (const reference of capability.ambient) {
      ambientCapabilities.push({
        importer: file.path,
        name: reference.name,
        usage: reference.usage,
      });
    }
    for (const edge of extractNeutralImportEdges(file.source)) {
      if (edge.kind === "unresolved" || edge.specifier === undefined) {
        unresolved.push({
          importer: file.path,
          form: edge.form,
          detail: edge.detail ?? "unresolved specifier",
        });
        continue;
      }
      const specifier = edge.specifier;
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

  const edgeCount = forbidden.length + unclassified.length + intraCore.length + unresolved.length;
  const facts = {
    declared_members: [...declared],
    missing_members: missingMembers,
    undeclared_files: undeclaredFiles,
    node_count: suppliedPaths.length,
    edge_count: edgeCount,
    intra_core_edges: intraCore,
    forbidden_edges: forbidden,
    unclassified_edges: unclassified,
    unresolved_edges: unresolved,
    source_ambiguities: ambiguous,
    indirect_callees: indirectCallees,
    ambient_capabilities: ambientCapabilities,
    pure_intrinsic_roots: [...NEUTRAL_PURE_INTRINSIC_ROOTS],
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

  if (unresolved.length > 0) {
    return neutralOutcome({
      type: "guild.boundary_outcome.v1",
      disposition: "failed",
      reason_code: "boundary_unresolved_edge",
      assertions: [
        "every dependency edge must resolve to a destination the scan can classify",
        "a runtime-computed specifier cannot be proven to stay inside the core",
        "an unresolvable edge is closure unproven, never closure proven",
      ],
      facts,
    });
  }

  if (ambientCapabilities.length > 0) {
    return neutralOutcome({
      type: "guild.boundary_outcome.v1",
      disposition: "failed",
      reason_code: "boundary_ambient_capability",
      assertions: [
        "a core member may reference only what it declares, imports, or draws from the pure-intrinsic allowlist",
        "an ambient binding is a capability the closure argument never covered",
        "the allowlist is closed, so an unanticipated intrinsic fails rather than passes",
      ],
      facts,
    });
  }

  if (indirectCallees.length > 0) {
    return neutralOutcome({
      type: "guild.boundary_outcome.v1",
      disposition: "failed",
      reason_code: "boundary_indirect_callee",
      assertions: [
        "every call must have a callee the scan can reduce to a named destination",
        "a computed-member, call-result, or literal callee is decided at runtime and cannot be proven to stay inside the core",
        "an unresolvable callee is closure unproven, never closure proven",
      ],
      facts,
    });
  }

  if (ambiguous.length > 0) {
    return neutralOutcome({
      type: "guild.boundary_outcome.v1",
      disposition: "failed",
      reason_code: "boundary_ambiguous_source",
      assertions: [
        "the source must lex unambiguously wherever the reading could hide an edge",
        "a regex-versus-division ambiguity spanning an import or require is not resolved by guess",
        "an escaped identifier decodes, and is still reported: escaping a name in a core member exists only to defeat a recognizer",
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
      "every edge resolved to a declared core member",
      "no lexical ambiguity could have hidden an edge",
      "every callee reduced to a declared, imported, or pure-intrinsic root",
      "no ambient binding is reached, so no host handle, clock, or evaluator is available",
      "the core is closed under import AND capability, so no transitive escape exists",
    ],
    facts,
  });
}
