/**
 * src/modules/teams/workflows/canonical-hash.ts
 *
 * T2b (dynamic-host-model-routing) — the runtime implementation of the
 * workspace-wide canonical-hash rule (team-contracts §1, the single normative
 * owner of artifact hashing for ALL Guild v2 contracts).
 *
 * REWORK ROUND 2 (G-lane finding T2B-R1-F1): the §1 serialization is now
 * implemented HERE, byte-for-byte, with no delegation to a third-party YAML
 * dumper. js-yaml's `sortKeys: true` sorts by UTF-16 code units (U+1F4A9
 * before U+E000) and falls back to SINGLE-quoted scalars — both violate the
 * frozen contract. This module owns:
 *
 *   - `codePointCompare`: mapping keys sorted in Unicode CODE-POINT order at
 *     EVERY nesting level (an astral key like U+1F4A9 sorts AFTER U+E000,
 *     which naive `<` string comparison gets backwards);
 *   - block style throughout (no flow style, except the only representable
 *     empty-collection forms `[]` / `{}`);
 *   - 2-space indentation; LF line endings; exactly one trailing newline;
 *   - plain scalars where legal, otherwise DOUBLE-quoted (never single-quoted,
 *     never block-literal — a multiline string is double-quoted with `\n`
 *     escapes);
 *   - no comments, anchors, aliases, tags, or document markers.
 *
 * Plain-scalar legality is decided by `isPlainSafe` below — a deterministic,
 * documented predicate. It is deliberately conservative: any string that a
 * YAML core/1.1 reader could parse as null/bool/number/timestamp, or whose
 * characters/positions could be misread as YAML structure, is double-quoted.
 * Two conforming implementations MUST produce byte-identical canonical output;
 * hand-authored golden-byte fixtures (tests/contracts/c12) pin these bytes
 * independently of this serializer.
 *
 * Self-referential hash (`proposal_hash` / `decision_hash` / …):
 *   <field>_hash = sha256( canonical_yaml( artifact WITH the <field>_hash key REMOVED ) )
 * The hash field is OMITTED from the hashed value (not blanked); verification
 * recomputes from the received artifact minus the hash field and fails closed
 * on any mismatch.
 */

import * as crypto from "crypto";

// ── Unicode code-point key ordering (§1) ─────────────────────────────────────

/**
 * Compare two strings by Unicode CODE POINT (not UTF-16 code unit). Differs
 * from `a < b` exactly when one side contains an astral character (a surrogate
 * pair): e.g. U+E000 (0xE000) must sort BEFORE U+1F4A9 (0x1F4A9), but their
 * UTF-16 lead units order 0xD83D < 0xE000 the other way around.
 */
export function codePointCompare(a: string, b: string): number {
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const ca = a.codePointAt(i) as number;
    const cb = b.codePointAt(j) as number;
    if (ca !== cb) return ca < cb ? -1 : 1;
    i += ca > 0xffff ? 2 : 1;
    j += cb > 0xffff ? 2 : 1;
  }
  if (i < a.length) return 1; // b is a strict prefix of a
  if (j < b.length) return -1; // a is a strict prefix of b
  return 0;
}

// ── Plain-scalar legality (documented, deterministic) ────────────────────────

/**
 * YAML-printable code point (the set that may appear raw): 0x20–0x7E,
 * 0xA0–0xD7FF, 0xE000–0xFFFD, 0x10000–0x10FFFF. Tab, newline, C0/C1 controls,
 * DEL, NEL, and unpaired surrogates are NOT printable and force double quotes.
 */
function isPrintableCodePoint(c: number): boolean {
  return (
    (c >= 0x20 && c <= 0x7e) ||
    (c >= 0xa0 && c <= 0xd7ff) ||
    (c >= 0xe000 && c <= 0xfffd) ||
    (c >= 0x10000 && c <= 0x10ffff)
  );
}

/**
 * Strings a YAML core/1.1 reader could resolve to a NON-string value — these
 * must be double-quoted so the canonical document round-trips the value:
 * null/bool spellings (incl. yes/no/on/off), decimal/hex/octal/binary numbers,
 * floats and .inf/.nan, sexagesimal forms, and date/timestamp shapes.
 */
const AMBIGUOUS_SCALAR_PATTERNS: readonly RegExp[] = [
  /^(?:null|Null|NULL|~)$/,
  /^(?:true|True|TRUE|false|False|FALSE|yes|Yes|YES|no|No|NO|on|On|ON|off|Off|OFF)$/,
  /^[-+]?(?:\d[\d_]*)$/, // decimal int (incl. leading zeros / underscores)
  /^[-+]?0[xX][0-9a-fA-F_]+$/, // hex
  /^[-+]?0[oO]?[0-7_]+$/, // octal (both 0o17 and legacy 017)
  /^[-+]?0[bB][01_]+$/, // binary
  /^[-+]?(?:\d[\d_]*\.[\d_]*|\.\d[\d_]*)(?:[eE][-+]?\d+)?$/, // float
  /^[-+]?\d[\d_]*(?:[eE][-+]?\d+)$/, // int-mantissa exponent float
  /^[-+]?\.(?:inf|Inf|INF)$/,
  /^\.(?:nan|NaN|NAN)$/,
  /^[-+]?\d[\d_]*(?::[0-5]?\d)+(?:\.[\d_]*)?$/, // sexagesimal
  /^\d{4}-\d{1,2}-\d{1,2}(?:[Tt\s].*)?$/, // date / timestamp
];

/** Characters that make a scalar structural when they LEAD it. */
const LEADING_INDICATORS = "-?:,[]{}#&*!|>'\"%@` ";

/**
 * True when `s` may be emitted as a PLAIN scalar. Deterministic and
 * conservative: anything ambiguous is quoted. Rules — non-empty; every code
 * point printable (no tab/newline/control); no leading/trailing space; no
 * leading YAML indicator character; no `: ` / trailing `:`; no ` #`; not a
 * value-ambiguous form per AMBIGUOUS_SCALAR_PATTERNS.
 */
export function isPlainSafe(s: string): boolean {
  if (s.length === 0) return false;
  for (const ch of s) {
    if (!isPrintableCodePoint(ch.codePointAt(0) as number)) return false;
  }
  if (s.startsWith(" ") || s.endsWith(" ")) return false;
  if (LEADING_INDICATORS.includes(s[0])) return false;
  if (s.includes(": ") || s.endsWith(":")) return false;
  if (s.includes(" #")) return false;
  for (const re of AMBIGUOUS_SCALAR_PATTERNS) {
    if (re.test(s)) return false;
  }
  return true;
}

// ── Double-quoted fallback style (§1: never single quotes, never literals) ───

const DQ_ESCAPES: Readonly<Record<number, string>> = {
  0x00: "\\0",
  0x07: "\\a",
  0x08: "\\b",
  0x09: "\\t",
  0x0a: "\\n",
  0x0b: "\\v",
  0x0c: "\\f",
  0x0d: "\\r",
  0x1b: "\\e",
  0x22: '\\"',
  0x5c: "\\\\",
};

function hex(n: number, width: number): string {
  return n.toString(16).toUpperCase().padStart(width, "0");
}

/** The §1 double-quoted rendering of a string (the only quoted fallback). */
export function doubleQuoted(s: string): string {
  let out = '"';
  for (const ch of s) {
    const c = ch.codePointAt(0) as number;
    const named = DQ_ESCAPES[c];
    if (named !== undefined) out += named;
    else if (isPrintableCodePoint(c)) out += ch;
    else if (c <= 0xff) out += `\\x${hex(c, 2)}`;
    else if (c <= 0xffff) out += `\\u${hex(c, 4)}`;
    else out += `\\U${hex(c, 8)}`;
  }
  return out + '"';
}

// ── The canonical serializer ─────────────────────────────────────────────────

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/** Single-line token for a scalar value; throws on anything unrepresentable. */
function scalarToken(v: unknown): string {
  if (v === null) return "null";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") {
    if (!Number.isFinite(v)) {
      throw new Error(`canonical-hash: refusing to serialize non-finite number ${String(v)} (§1 artifacts are plain data)`);
    }
    return String(v);
  }
  if (typeof v === "string") return isPlainSafe(v) ? v : doubleQuoted(v);
  throw new Error(
    `canonical-hash: refusing to serialize a ${typeof v} value — §1 artifacts carry only null/boolean/number/string/array/object`
  );
}

function isScalar(v: unknown): boolean {
  return v === null || ["boolean", "number", "string"].includes(typeof v);
}

function renderMap(obj: Record<string, unknown>, indent: string): string {
  const keys = Object.keys(obj).sort(codePointCompare);
  let out = "";
  for (const k of keys) {
    const v = obj[k];
    if (v === undefined) {
      throw new Error(`canonical-hash: refusing to serialize undefined at key ${JSON.stringify(k)} — omit the key instead`);
    }
    const keyTok = scalarToken(k);
    if (isScalar(v)) {
      out += `${indent}${keyTok}: ${scalarToken(v)}\n`;
    } else if (Array.isArray(v)) {
      out += v.length === 0 ? `${indent}${keyTok}: []\n` : `${indent}${keyTok}:\n${renderSeq(v, indent + "  ")}`;
    } else if (isPlainObject(v)) {
      out +=
        Object.keys(v).length === 0
          ? `${indent}${keyTok}: {}\n`
          : `${indent}${keyTok}:\n${renderMap(v, indent + "  ")}`;
    } else {
      throw new Error(`canonical-hash: unrepresentable value at key ${JSON.stringify(k)}`);
    }
  }
  return out;
}

/** Splice a nested block into a `- ` sequence entry ("- " replaces the 2-space child indent). */
function seqItemOf(childBlock: string, indent: string): string {
  return `${indent}- ${childBlock.slice(indent.length + 2)}`;
}

function renderSeq(arr: readonly unknown[], indent: string): string {
  let out = "";
  for (const item of arr) {
    if (item === undefined) {
      throw new Error("canonical-hash: refusing to serialize undefined inside an array");
    }
    if (isScalar(item)) {
      out += `${indent}- ${scalarToken(item)}\n`;
    } else if (Array.isArray(item)) {
      out += item.length === 0 ? `${indent}- []\n` : seqItemOf(renderSeq(item, indent + "  "), indent);
    } else if (isPlainObject(item)) {
      out +=
        Object.keys(item).length === 0
          ? `${indent}- {}\n`
          : seqItemOf(renderMap(item, indent + "  "), indent);
    } else {
      throw new Error("canonical-hash: unrepresentable value inside an array");
    }
  }
  return out;
}

/** team-contracts §1 canonical YAML serialization (byte-stable, LF, one trailing newline). */
export function canonicalYaml(value: unknown): string {
  if (value === undefined) {
    throw new Error("canonical-hash: refusing to serialize undefined as a document");
  }
  if (isScalar(value)) return `${scalarToken(value)}\n`;
  if (Array.isArray(value)) return value.length === 0 ? "[]\n" : renderSeq(value, "");
  if (isPlainObject(value)) return Object.keys(value).length === 0 ? "{}\n" : renderMap(value, "");
  throw new Error("canonical-hash: unrepresentable document value");
}

/** sha256 hex over a UTF-8 string. */
export function sha256Hex(text: string): string {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * §1 self-referential artifact hash: sha256 over the canonical YAML of the
 * artifact WITH `hashField` removed (not blanked, not placeholder-filled).
 */
export function selfReferentialHash(
  artifact: Record<string, unknown>,
  hashField: string
): string {
  const clone: Record<string, unknown> = { ...artifact };
  delete clone[hashField];
  return sha256Hex(canonicalYaml(clone));
}

/** A 64-hex-char sha256 string (the shape every §1 hash field must carry). */
export function isSha256Hex(v: unknown): v is string {
  return typeof v === "string" && /^[0-9a-f]{64}$/.test(v);
}

/**
 * Deep-clone a plain-data artifact (JSON-able by construction — every §1
 * artifact is). Used so record/restructure operations never alias caller bytes.
 */
export function cloneArtifact<T>(artifact: T): T {
  return JSON.parse(JSON.stringify(artifact)) as T;
}
