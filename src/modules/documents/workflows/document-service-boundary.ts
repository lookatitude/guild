/**
 * src/modules/documents/workflows/document-service-boundary.ts
 *
 * DC-08 — artifact/document/knowledge service boundaries.
 *
 * The documents service may depend only on public module entrypoints
 * (`src/modules/<id>/index.ts`) plus Node builtins. It may never reach into host
 * internals or import an external package directly.
 *
 * Review note F-01 observed that a regex evaluator recognising only quoted
 * literal `import` specifiers is not a standalone proof: the forms it cannot
 * see are exactly the forms a boundary violation would hide in. The rule this
 * evaluator holds to is therefore that every module edge must be *visible*,
 * and anything it cannot statically resolve is reported as unproven rather
 * than passed over:
 *
 *   - `import ... from "x"`, `import "x"`, `import("x")`, `require("x")`
 *     — resolved and classified against the allowlist;
 *   - `export ... from "x"` (including `export *`, `export * as ns` and
 *     `export type`) — a re-export is an import edge and is classified
 *     identically; the module's own public index is built from this form;
 *   - `import(expr)` / `require(expr)` with a non-literal argument
 *     — `indirect_specifier`;
 *   - `require` used as a value (`const load = require`) or a require built at
 *     runtime (`createRequire`) — `indirect_specifier`, and a call through a
 *     directly-bound alias is resolved so the report names the specifier the
 *     alias actually reaches.
 *
 * Comments and regex literals are blanked (offset-preserving) before scanning,
 * so prose mentioning `require(x)` — and this file's own detection patterns —
 * create no phantom violations while line numbers stay true. Identifier rules
 * additionally scan a view with string and template bodies blanked, so the
 * word `require` inside a message is not read as code.
 *
 * What this does not prove: it is a syntactic evaluator, not a resolver. A
 * module that reaches the filesystem through some other runtime capability is
 * outside what any import scan can see, which is why the shipped surface is
 * also kept to self-module, `node:`, and explicitly named parser-package edges.
 */

export const DOCUMENTS_MODULE_ID = "documents" as const;

/** Public module entrypoints this service is permitted to import. */
export const DOCUMENTS_ALLOWED_MODULE_DEPENDENCIES = Object.freeze([
  "kernel",
  "lifecycle",
  "telemetry",
]);

/** External packages are resolved behind public module seams, never directly. */
export const DOCUMENTS_ALLOWED_EXTERNAL_PACKAGES = Object.freeze([] as string[]);

export type BoundaryViolationReason =
  | "host_internal_import"
  | "private_module_import"
  | "undeclared_module_import"
  | "external_package_import"
  | "outside_module_tree_import"
  | "indirect_specifier";

export interface BoundarySourceFile {
  /** Repo-relative POSIX path, e.g. `src/modules/documents/workflows/x.ts`. */
  path: string;
  text: string;
}

export interface DocumentBoundaryViolation {
  path: string;
  line: number;
  specifier: string | null;
  reason: BoundaryViolationReason;
}

export interface DocumentBoundaryReport {
  ok: boolean;
  scanned: number;
  violations: DocumentBoundaryViolation[];
}

export interface BoundaryOptions {
  selfModule?: string;
  allowedModules?: readonly string[];
  allowedExternalPackages?: readonly string[];
}

/**
 * Literal specifiers: `import ... from "x"`, `export ... from "x"`,
 * `import "x"`, `import("x")`, `require("x")`.
 *
 * The clause between the keyword and `from` may contain whole quoted segments
 * — `import { "str name" as x } from "y"` is a real binding form — but never a
 * bare quote, backtick or `;`. Quoted segments are therefore atomic: a match
 * can neither start nor stop inside a string, so it cannot run out of its own
 * statement and pick up an unrelated specifier.
 */
const LITERAL_SPECIFIER =
  /(?:^|[^.\w$])(?:(?:import|export)\b(?:[^;"'`]|"[^"\n]*"|'[^'\n]*')*?\bfrom\s*|import\s*\(|require\s*\(|import\s+(?=["']))\s*["']([^"']+)["']/g;

/** A dynamic `import(`/`require(` whose first argument is not a string literal. */
const INDIRECT_SPECIFIER = /(?:^|[^.\w$])(?:import|require)\s*\(\s*(?!["'])/g;

/**
 * `require` in a value position — aliased, passed, stored, re-exported. The
 * import it eventually performs cannot be attributed to any specifier, so the
 * aliasing itself is the violation.
 */
const ESCAPING_REQUIRE = /(?:^|[^.\w$])require\b\s*(?![(.])/g;

/** A require constructed at runtime is equally unresolvable statically. */
const CONSTRUCTED_REQUIRE = /(?:^|[^.\w$])createRequire\b/g;

/** `const load = require` — a binding whose calls are require calls. */
const REQUIRE_ALIAS_BINDING =
  /(?:^|[^.\w$])(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*require\b\s*(?![(.])/g;

/** Characters after which a `/` begins a regex literal rather than division. */
const REGEX_PRECEDING = new Set("=(,:[!&|?{};+-*%~^<>".split(""));
/** Keywords after which a `/` begins a regex literal. */
const REGEX_KEYWORDS = new Set([
  "return", "typeof", "case", "in", "of", "new", "delete", "void", "do", "else",
  "yield", "await", "instanceof",
]);

function startsRegex(out: string): boolean {
  const trimmed = out.replace(/\s+$/, "");
  if (trimmed === "") return true;
  const last = trimmed[trimmed.length - 1] ?? "";
  if (REGEX_PRECEDING.has(last)) return true;
  const word = /([A-Za-z_$][A-Za-z0-9_$]*)$/.exec(trimmed);
  return word !== null && REGEX_KEYWORDS.has(word[1] ?? "");
}

/**
 * Blank out comments AND regex literals while preserving every byte offset and
 * newline. With `blankStringBodies`, string and template bodies are blanked
 * too — the view identifier rules scan, so that the word `require` inside a
 * message is never read as code.
 *
 * Regex literals must be blanked too: this very file contains patterns like
 * `import\s*\(` inside a regex, and scanning them as code would make the
 * evaluator report itself as containing a dynamic import.
 */
function blankNonCode(text: string, blankStringBodies: boolean): string {
  let out = "";
  let index = 0;
  let state: "code" | "line" | "block" | "single" | "double" | "template" | "regex" = "code";
  let regexClass = false;
  while (index < text.length) {
    const char = text[index] ?? "";
    const next = text[index + 1] ?? "";
    if (state === "code") {
      if (char === "/" && next === "/") {
        state = "line";
        out += "  ";
        index += 2;
        continue;
      }
      if (char === "/" && next === "*") {
        state = "block";
        out += "  ";
        index += 2;
        continue;
      }
      if (char === "/" && startsRegex(out)) {
        state = "regex";
        regexClass = false;
        out += " ";
        index += 1;
        continue;
      }
      if (char === "'") state = "single";
      else if (char === '"') state = "double";
      else if (char === "`") state = "template";
      out += char;
      index += 1;
      continue;
    }
    if (state === "regex") {
      if (char === "\\") {
        out += "  ";
        index += 2;
        continue;
      }
      if (char === "\n") {
        // Unterminated regex — bail back to code rather than swallowing the file.
        state = "code";
        out += "\n";
        index += 1;
        continue;
      }
      if (char === "[") regexClass = true;
      else if (char === "]") regexClass = false;
      else if (char === "/" && !regexClass) state = "code";
      out += " ";
      index += 1;
      continue;
    }
    if (state === "line") {
      if (char === "\n") {
        state = "code";
        out += char;
      } else {
        out += " ";
      }
      index += 1;
      continue;
    }
    if (state === "block") {
      if (char === "*" && next === "/") {
        state = "code";
        out += "  ";
        index += 2;
        continue;
      }
      out += char === "\n" ? "\n" : " ";
      index += 1;
      continue;
    }
    // Inside a string/template: copy verbatim (or blank the body), honouring
    // escapes. A `\` before a newline still emits the newline, so blanking can
    // never shift a line number.
    if (char === "\\") {
      if (blankStringBodies) out += next === "\n" ? " \n" : "  ";
      else out += char + next;
      index += 2;
      continue;
    }
    const closes =
      (state === "single" && char === "'") ||
      (state === "double" && char === '"') ||
      (state === "template" && char === "`");
    if (closes) state = "code";
    if (closes || !blankStringBodies) out += char;
    else out += char === "\n" ? "\n" : " ";
    index += 1;
  }
  return out;
}

/**
 * Offset of the keyword a match is about. Every pattern here opens with a
 * `(?:^|[^.\w$])` guard that consumes at most one non-identifier character, so
 * a match beginning with an identifier character starts at the keyword and any
 * other match starts one character before it. Reporting the keyword offset is
 * what keeps a statement's violation on the statement's own line.
 */
function keywordOffset(match: RegExpExecArray): number {
  return match.index + (/^[A-Za-z_$]/.test(match[0] ?? "") ? 0 : 1);
}

function lineOf(text: string, offset: number): number {
  let line = 1;
  for (let index = 0; index < offset && index < text.length; index += 1) {
    if (text[index] === "\n") line += 1;
  }
  return line;
}

/** Pure POSIX resolution of a relative specifier against a file path. */
function resolveRelative(fromFile: string, specifier: string): string {
  const parts = fromFile.split("/").slice(0, -1);
  for (const segment of specifier.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") parts.pop();
    else parts.push(segment);
  }
  return parts.join("/");
}

function classify(
  fromFile: string,
  specifier: string,
  selfModule: string,
  allowed: readonly string[],
  allowedExternalPackages: readonly string[]
): BoundaryViolationReason | null {
  if (specifier.startsWith("node:")) return null;
  if (!specifier.startsWith(".")) {
    return allowedExternalPackages.includes(specifier) ? null : "external_package_import";
  }

  const resolved = resolveRelative(fromFile, specifier);
  const selfPrefix = `src/modules/${selfModule}/`;
  if (resolved.startsWith(selfPrefix)) return null;

  const moduleMatch = /^src\/modules\/([^/]+)(?:\/(.*))?$/.exec(resolved);
  if (moduleMatch === null) {
    if (/(?:^|\/)hooks(?:\/|$)/.test(resolved) || resolved.includes("host")) {
      return "host_internal_import";
    }
    return "outside_module_tree_import";
  }

  const targetModule = moduleMatch[1] ?? "";
  const remainder = moduleMatch[2] ?? "";
  if (targetModule === selfModule) return null;
  if (targetModule.startsWith("host")) return "host_internal_import";
  if (!allowed.includes(targetModule)) return "undeclared_module_import";
  if (remainder !== "" && remainder !== "index" && remainder !== "index.ts") {
    return "private_module_import";
  }
  return null;
}

/**
 * Evaluate a set of source files against the documents service boundary.
 * Pure: takes file texts, touches no filesystem, and is deterministic.
 */
export function evaluateDocumentServiceBoundary(
  files: readonly BoundarySourceFile[],
  options: BoundaryOptions = {}
): DocumentBoundaryReport {
  const selfModule = options.selfModule ?? DOCUMENTS_MODULE_ID;
  const allowed = options.allowedModules ?? DOCUMENTS_ALLOWED_MODULE_DEPENDENCIES;
  const allowedExternalPackages =
    options.allowedExternalPackages ?? DOCUMENTS_ALLOWED_EXTERNAL_PACKAGES;
  const violations: DocumentBoundaryViolation[] = [];

  for (const file of files) {
    // Two views of the same offsets: `scannable` keeps string bodies (that is
    // where specifiers live), `codeOnly` blanks them (that is where a bare
    // identifier means what it says).
    const scannable = blankNonCode(file.text, false);
    const codeOnly = blankNonCode(file.text, true);

    const report = (
      offset: number,
      specifier: string | null,
      reason: BoundaryViolationReason
    ): void => {
      violations.push({ path: file.path, line: lineOf(scannable, offset), specifier, reason });
    };

    LITERAL_SPECIFIER.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = LITERAL_SPECIFIER.exec(scannable)) !== null) {
      // The specifier lives in a string, but the keyword introducing it must
      // be code. Offsets are shared between the two views, so a keyword whose
      // first character is blanked in `codeOnly` is prose inside some other
      // string — resume just past it rather than letting a sentence like
      // "import x from " swallow the real statement that follows.
      const keyword = keywordOffset(match);
      if (codeOnly[keyword] !== scannable[keyword]) {
        LITERAL_SPECIFIER.lastIndex = keyword + 1;
        continue;
      }
      const specifier = match[1] ?? "";
      const reason = classify(
        file.path,
        specifier,
        selfModule,
        allowed,
        allowedExternalPackages
      );
      if (reason !== null) report(keyword, specifier, reason);
    }

    INDIRECT_SPECIFIER.lastIndex = 0;
    let indirect: RegExpExecArray | null;
    while ((indirect = INDIRECT_SPECIFIER.exec(scannable)) !== null) {
      report(keywordOffset(indirect), null, "indirect_specifier");
    }

    for (const pattern of [ESCAPING_REQUIRE, CONSTRUCTED_REQUIRE]) {
      pattern.lastIndex = 0;
      let escaping: RegExpExecArray | null;
      while ((escaping = pattern.exec(codeOnly)) !== null) {
        report(keywordOffset(escaping), null, "indirect_specifier");
      }
    }

    // Calls through an identifier bound directly to `require` are resolved as
    // require calls, so the report names the specifier the alias reaches
    // rather than only the site where the alias was made.
    REQUIRE_ALIAS_BINDING.lastIndex = 0;
    let binding: RegExpExecArray | null;
    while ((binding = REQUIRE_ALIAS_BINDING.exec(codeOnly)) !== null) {
      const alias = binding[1] ?? "";
      if (alias === "") continue;
      // `alias` matched [A-Za-z_$][\w$]*, so it carries no regex metacharacter.
      const aliasCall = new RegExp(`(?:^|[^.\\w$])${alias}\\s*\\(\\s*["']([^"']+)["']`, "g");
      let call: RegExpExecArray | null;
      while ((call = aliasCall.exec(scannable)) !== null) {
        const site = keywordOffset(call);
        if (codeOnly[site] !== scannable[site]) {
          aliasCall.lastIndex = site + 1;
          continue;
        }
        const specifier = call[1] ?? "";
        const reason = classify(
          file.path,
          specifier,
          selfModule,
          allowed,
          allowedExternalPackages
        );
        // The aliasing is already reported; only the edge it reaches is added.
        if (reason !== null) report(site, specifier, reason);
      }
    }
  }

  violations.sort(
    (a, b) =>
      (a.path < b.path ? -1 : a.path > b.path ? 1 : 0) ||
      a.line - b.line ||
      (a.reason < b.reason ? -1 : a.reason > b.reason ? 1 : 0)
  );

  return { ok: violations.length === 0, scanned: files.length, violations };
}

/**
 * The documents module's own source files, listed explicitly so a boundary
 * test can assert over the real shipped surface without directory scanning.
 */
export const DOCUMENTS_MODULE_SOURCE_FILES: readonly string[] = Object.freeze([
  "src/modules/documents/index.ts",
  "src/modules/documents/workflows/document-safe.ts",
  "src/modules/documents/workflows/document-records.ts",
  "src/modules/documents/workflows/document-hash.ts",
  "src/modules/documents/workflows/document-projection.ts",
  "src/modules/documents/workflows/document-html.ts",
  "src/modules/documents/workflows/document-legacy-import.ts",
  "src/modules/documents/workflows/document-versioning.ts",
  "src/modules/documents/workflows/document-decisions.ts",
  "src/modules/documents/workflows/document-receipts.ts",
  "src/modules/documents/workflows/document-service-boundary.ts",
]);
