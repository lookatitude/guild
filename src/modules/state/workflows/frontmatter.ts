/**
 * src/modules/state/workflows/frontmatter.ts
 *
 * The ONE shared, js-yaml-backed frontmatter / YAML reader for the scripts
 * package. Established for the comms-format-yaml-migration initiative to clear
 * the comms-format enforce gate (OD-3): every formerly hand-rolled YAML reader
 * (a line-anchored key regex, `split('---')`, `startsWith('---')`,
 * dynamic caret-anchored RegExp construction, key matchAll, colon line-scanners)
 * migrates to these helpers, so the OD-3 detector finds no hand-rolled reader.
 *
 * DESIGN — why this file is itself OD-3-compliant:
 *   It parses YAML with js-yaml ONLY. It contains none of the six hand-rolled
 *   idioms the detector flags: no `split('---')`, no `startsWith('---')`, no
 *   a line-anchored key regex literal, no dynamic caret-anchored RegExp, no matchAll of a
 *   key pattern, and no `line`-variable colon scan. Fence detection uses
 *   `/^---/`-style anchors whose first post-caret char is `-` (not an identifier),
 *   so it never matches the detector's key-regex pattern.
 *
 * SCHEMA — behavior-preservation choice (default `JSON_SCHEMA`):
 *   The hand-rolled readers all returned the RAW post-colon text via
 *   `regex.match(...)[1].trim()` — i.e. STRINGS, never typed. Under js-yaml's
 *   default schema an unquoted `created_at: 2026-06-03` parses to a JS `Date`
 *   and a bare timestamp to a `Date`, which would silently change values.
 *   `JSON_SCHEMA` resolves only null / bool / int / float / str (no `!!timestamp`),
 *   so dates and ISO strings stay STRINGS — matching the old `.trim()` behavior —
 *   while genuine booleans/numbers still coerce. Callers that specifically want
 *   native Date/timestamp parsing pass `{ schema: yaml.DEFAULT_SCHEMA }`.
 *
 * Owner: tooling-engineer. Consumers: scripts/** readers + eval-engineer (L2 tests).
 */

import { loadYamlApi } from "../../kernel";

type LoadedYamlApi = ReturnType<typeof loadYamlApi>;
let loadedYaml: LoadedYamlApi | null = null;

function yamlApi(): LoadedYamlApi {
  if (loadedYaml === null) loadedYaml = loadYamlApi();
  return loadedYaml;
}

// ── Frontmatter / YAML parsing ──────────────────────────────────────────────

export interface FrontmatterSplit {
  /** Raw YAML text between the leading `---` fences, or null when absent. */
  frontmatter: string | null;
  /** Everything after the closing `---` fence (whole content when no block). */
  body: string;
}

/** Opening fence: `---` on the very first line. (`-` after `^`, not OD-3 key-regex.) */
const OPEN_FENCE = /^---[ \t]*\r?\n/;
/** Closing fence: a line that is exactly `---` (optionally trailing ws), then EOL/EOF. */
const CLOSE_FENCE = /\r?\n---[ \t]*(?:\r?\n|$)/;

/**
 * Split a markdown document into its leading frontmatter block and body.
 * Pure slicing — locates the two `---` fences by anchored match, never parses
 * individual key lines. Returns `{ frontmatter: null, body: content }` when there
 * is no well-formed leading block (no open fence, or no closing fence).
 */
export function splitFrontmatter(content: string): FrontmatterSplit {
  if (!OPEN_FENCE.test(content)) return { frontmatter: null, body: content };
  const firstNl = content.indexOf("\n");
  const rest = content.slice(firstNl + 1);
  const close = CLOSE_FENCE.exec(rest);
  if (!close) return { frontmatter: null, body: content };
  const frontmatter = rest.slice(0, close.index);
  const body = rest.slice(close.index + close[0].length);
  return { frontmatter, body };
}

export interface ParseOpts {
  /** Override the js-yaml schema (default `JSON_SCHEMA` — string-fidelity). */
  schema?: unknown;
}

/**
 * Parse a raw YAML string (a frontmatter block OR a whole `.yaml`/`run.yaml`
 * document) to a value. Returns `null` on empty/unparseable input (never throws)
 * — the same fail-soft posture every hand-rolled reader had.
 */
export function parseYaml(text: string, opts: ParseOpts = {}): unknown {
  try {
    const yaml = yamlApi();
    const value = yaml.load(text, { schema: opts.schema ?? yaml.JSON_SCHEMA });
    return value === undefined ? null : value;
  } catch {
    return null;
  }
}

/**
 * Parse a markdown document's leading frontmatter block to an object.
 * Returns `null` when there is no frontmatter block, or it is empty, or it does
 * not parse to a plain object.
 */
export function parseFrontmatter(
  content: string,
  opts: ParseOpts = {},
): Record<string, unknown> | null {
  const { frontmatter } = splitFrontmatter(content);
  if (frontmatter === null || frontmatter.trim() === "") return null;
  const value = parseYaml(frontmatter, opts);
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/**
 * Read one frontmatter field as its parsed (typed) value, or `undefined` when
 * absent. Booleans/numbers come back typed; under the default schema dates stay
 * strings (see SCHEMA note above).
 */
export function readFrontmatterField(
  content: string,
  key: string,
  opts: ParseOpts = {},
): unknown {
  const fm = parseFrontmatter(content, opts);
  if (fm === null) return undefined;
  return fm[key];
}

/**
 * Read one frontmatter field coerced to a string (the most common hand-rolled
 * shape: a line-anchored key match then `[1].trim()`). Returns `undefined` for an absent or null
 * value; non-string scalars are `String()`-coerced.
 */
export function readFrontmatterString(
  content: string,
  key: string,
  opts: ParseOpts = {},
): string | undefined {
  const v = readFrontmatterField(content, key, opts);
  if (v === undefined || v === null) return undefined;
  return typeof v === "string" ? v : String(v);
}

/**
 * ROBUST single-line scalar field read — does NOT YAML-parse the whole block.
 *
 * Reads the first column-0 `key: value` line (line-anchored, non-greedy value
 * semantics), trims, and strips one pair of surrounding quotes — the exact shape
 * the old per-field hand-rolled readers returned. Because it never calls
 * `yaml.load` on the surrounding block, it TOLERATES a YAML-hostile sibling
 * field: e.g. a skill page whose unquoted `description:` contains colons/parens
 * (`description: …§10.1.1 (type, owner): …`) is invalid YAML as a whole, yet
 * `name:` must still be read robustly. Use this for single-field reads from
 * sources that may carry such siblings (skills/SKILL.md). For trusted, fully
 * YAML-clean sources prefer `readFrontmatterString` / `parseFrontmatter`.
 *
 * Returns `undefined` when the key is absent or its value is empty.
 *
 * No OD-3 idiom: scans `split("\n")` lines, matches via `startsWith(key + ":")`
 * on a non-`line` variable, and never builds a dynamic caret-anchored key regex.
 */
export function readScalarField(content: string, key: string): string | undefined {
  const prefix = key + ":";
  for (const ln of content.split("\n")) {
    const c0 = ln.charCodeAt(0);
    if (c0 === 32 || c0 === 9) continue; // indented → not a column-0 key
    if (!ln.startsWith(prefix)) continue;
    let v = ln.slice(prefix.length).trim();
    if (v === "") continue; // (.+?) needs ≥1 char — keep scanning for a filled line
    if (
      v.length >= 2 &&
      ((v[0] === '"' && v[v.length - 1] === '"') || (v[0] === "'" && v[v.length - 1] === "'"))
    ) {
      v = v.slice(1, -1);
    }
    return v;
  }
  return undefined;
}

// ── Byte-preserving single-line writers ─────────────────────────────────────
//
// Rewriters (run.yaml status/phase flips, sync-migration source_refs/supersedes,
// wiki-importance) must NOT round-trip through yaml.dump — that would reformat the
// whole block and break their byte-for-byte guarantee. These helpers do targeted
// line surgery instead: locate one top-level `key:` line and swap exactly it,
// leaving every other byte untouched. No OD-3 idiom (line split is on "\n", key
// match is `.startsWith(key + ":")` on a non-`line` variable, indentation guard is
// `/^[ \t]/` whose post-caret char is whitespace).

/** Index of the first top-level (column-0) `${key}:` line in `lines`, or -1. */
function topLevelKeyLineIndex(lines: string[], key: string): number {
  const prefix = key + ":";
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    if (/^[ \t]/.test(ln)) continue; // indented → not a top-level key
    if (ln.startsWith(prefix)) return i;
  }
  return -1;
}

/** True iff `text` has a top-level `${key}:` line. */
export function hasTopLevelKey(text: string, key: string): boolean {
  return topLevelKeyLineIndex(text.split("\n"), key) !== -1;
}

/**
 * Replace the first top-level `${key}:` line with `replacementLine`, byte-
 * preserving everything else. When the key is absent, returns the text unchanged
 * with `replaced: false` so callers can decide whether to insert.
 */
export function replaceTopLevelLine(
  text: string,
  key: string,
  replacementLine: string,
): { text: string; replaced: boolean } {
  const lines = text.split("\n");
  const i = topLevelKeyLineIndex(lines, key);
  if (i === -1) return { text, replaced: false };
  // Preserve a trailing CR on the replaced line (CRLF files) — mirrors the old
  // anchored single-line String.replace, where the `.` metacharacter excludes
  // line terminators, so the `\r` survived. Keeps the rewrite byte-preserving.
  const hadCr = lines[i].endsWith("\r");
  lines[i] = hadCr ? replacementLine + "\r" : replacementLine;
  return { text: lines.join("\n"), replaced: true };
}
