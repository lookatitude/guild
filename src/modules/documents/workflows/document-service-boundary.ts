/**
 * src/modules/documents/workflows/document-service-boundary.ts
 *
 * DC-08 — artifact/document/knowledge service boundaries.
 *
 * The documents service may depend only on public module entrypoints
 * (`src/modules/<id>/index.ts`) of an explicit allowlist, plus Node builtins.
 * It may never reach into host internals.
 *
 * Review note F-01 against the previous attempt observed that a regex
 * evaluator recognising only quoted literal specifiers is not a standalone
 * proof, because `const s = "../../host-runtime"; import(s)` slips past it.
 * This evaluator therefore reports a *constructed* `import(...)`/`require(...)`
 * argument as its own `indirect_specifier` violation: an import it cannot
 * statically resolve is treated as unproven, not as absent.
 *
 * Comments are blanked (offset-preserving) before scanning so prose mentioning
 * `require(x)` does not create phantom violations while line numbers stay true.
 */

export const DOCUMENTS_MODULE_ID = "documents" as const;

/** Public module entrypoints this service is permitted to import. */
export const DOCUMENTS_ALLOWED_MODULE_DEPENDENCIES = Object.freeze([
  "lifecycle",
  "telemetry",
]);

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
}

/** Literal specifiers: `import ... from "x"`, `import "x"`, `import("x")`, `require("x")`. */
const LITERAL_SPECIFIER =
  /(?:import(?:\s+type)?[\s\S]*?from\s*|import\s*\(|require\s*\(|import\s+(?=["']))\s*["']([^"']+)["']/g;

/** A dynamic `import(`/`require(` whose first argument is not a string literal. */
const INDIRECT_SPECIFIER = /(?:^|[^.\w$])(?:import|require)\s*\(\s*(?!["'])/g;

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
 * newline.
 *
 * Regex literals must be blanked too: this very file contains patterns like
 * `import\s*\(` inside a regex, and scanning them as code would make the
 * evaluator report itself as containing a dynamic import.
 */
function blankComments(text: string): string {
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
    // Inside a string/template: copy verbatim, honouring escapes.
    if (char === "\\") {
      out += char + next;
      index += 2;
      continue;
    }
    if (
      (state === "single" && char === "'") ||
      (state === "double" && char === '"') ||
      (state === "template" && char === "`")
    ) {
      state = "code";
    }
    out += char;
    index += 1;
  }
  return out;
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
  allowed: readonly string[]
): BoundaryViolationReason | null {
  if (specifier.startsWith("node:")) return null;
  if (!specifier.startsWith(".")) return "external_package_import";

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
  const violations: DocumentBoundaryViolation[] = [];

  for (const file of files) {
    const scannable = blankComments(file.text);

    LITERAL_SPECIFIER.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = LITERAL_SPECIFIER.exec(scannable)) !== null) {
      const specifier = match[1] ?? "";
      const reason = classify(file.path, specifier, selfModule, allowed);
      if (reason !== null) {
        violations.push({
          path: file.path,
          line: lineOf(scannable, match.index),
          specifier,
          reason,
        });
      }
    }

    INDIRECT_SPECIFIER.lastIndex = 0;
    let indirect: RegExpExecArray | null;
    while ((indirect = INDIRECT_SPECIFIER.exec(scannable)) !== null) {
      violations.push({
        path: file.path,
        line: lineOf(scannable, indirect.index),
        specifier: null,
        reason: "indirect_specifier",
      });
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
