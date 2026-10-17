/**
 * native-config-parser.ts — the ONE shared parser for native-host configuration
 * identity (C-UPDATE: "owner: existing config domain via index.ts").
 *
 * Read-only over untrusted host files. Everything here fails CLOSED: malformed
 * documents, duplicate keys, unsafe keys (`__proto__`/`constructor`/`prototype`),
 * unknown refs, non-SHA revisions, and conflicting alias matches all REFUSE with
 * a typed code instead of guessing an identity or mutating host configuration.
 *
 * Dependency note (F01 selection check, recorded in the run evidence): the
 * C-UPDATE candidate smol-toml@1.9.1 passes registry integrity/license/engines
 * checks but FAILS the compiled-bundle compatibility check under this task's
 * write scope — hooks/dist bundles may only carry dependencies alias-pinned in
 * scripts/compile.ts and declared in hooks/package.json (bundle-determinism
 * rail, checks 1+2), both outside F01's permitted writes. Adoption is therefore
 * refused and the bounded grammar below (exactly the C-UPDATE fixture set) is
 * parsed in-domain with zero dependencies. Anything outside that grammar throws.
 */

export type NativeTomlValue =
  | string
  | number
  | boolean
  | NativeTomlValue[]
  | NativeTomlTable;

export interface NativeTomlTable {
  [key: string]: NativeTomlValue;
}

export type NativeConfigRefusalCode =
  | "toml-syntax"
  | "toml-duplicate-key"
  | "toml-unsafe-key";

export class NativeConfigParseError extends Error {
  readonly code: NativeConfigRefusalCode;
  constructor(code: NativeConfigRefusalCode, message: string) {
    super(`${code}: ${message}`);
    this.name = "NativeConfigParseError";
    this.code = code;
  }
}

/** Keys that could poison a prototype chain. unsafeKeyBehaviour = throw. */
const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

const BARE_KEY_RE = /^[A-Za-z0-9_-]+$/;
const SHA40_RE = /^[0-9a-f]{40}$/;
/** RFC3339-shaped date/datetime tokens are kept as verbatim strings. */
const DATETIME_RE =
  /^\d{4}-\d{2}-\d{2}([Tt ]\d{2}:\d{2}:\d{2}(\.\d+)?([Zz]|[+-]\d{2}:\d{2})?)?$/;

// Numeric forms with TOML underscore placement (between digits only) and no
// leading zeros. `1__0`, `_1`, `1_`, `01` are all syntax refusals, never numbers.
const INT_RE = /^[+-]?(0|[1-9]\d*(_\d+)*)$/;
const HEX_RE = /^0x[0-9A-Fa-f]+(_[0-9A-Fa-f]+)*$/;
const OCT_RE = /^0o[0-7]+(_[0-7]+)*$/;
const BIN_RE = /^0b[01]+(_[01]+)*$/;
const FLOAT_RE =
  /^[+-]?(0|[1-9]\d*(_\d+)*)(\.\d+(_\d+)*)?([eE][+-]?\d+(_\d+)*)?$/;

/**
 * Per-parse state.
 *  - `closedInline`: inline tables — CLOSED to every later extension, dotted
 *    keys and headers alike (TOML: an inline table is defined in full).
 *  - `closedToHeaders`: tables created by dotted keys in a key/value position
 *    and value arrays — later dotted keyvals may extend the tables, but a
 *    `[header]` / `[[header]]` may not reopen either.
 */
interface ParseCtx {
  closedInline: WeakSet<object>;
  closedToHeaders: WeakSet<object>;
}

class Cursor {
  pos = 0;
  constructor(readonly src: string) {}
  peek(offset = 0): string {
    return this.src[this.pos + offset] ?? "";
  }
  next(): string {
    return this.src[this.pos++] ?? "";
  }
  eof(): boolean {
    return this.pos >= this.src.length;
  }
  fail(why: string): never {
    const line = this.src.slice(0, this.pos).split("\n").length;
    throw new NativeConfigParseError("toml-syntax", `${why} (line ${line})`);
  }
}

function skipInlineWs(c: Cursor): void {
  while (c.peek() === " " || c.peek() === "\t") c.pos++;
}

/** Consume a `# …` comment, refusing control characters inside it. A CR ends it only as part of CRLF. */
function skipComment(c: Cursor): void {
  c.pos++; // the '#'
  while (!c.eof() && c.peek() !== "\n") {
    const ch = c.peek();
    if (ch === "\r") {
      if (c.peek(1) === "\n") return; // the CRLF terminator; left for the line-end handler
      c.fail("lone carriage return in comment");
    }
    if (isForbiddenStringChar(ch)) c.fail("control character in comment");
    c.pos++;
  }
}

/** Skip spaces, tabs, comments, and (when allowed) newlines. CRLF only; a lone CR refuses. */
function skipTrivia(c: Cursor, acrossNewlines: boolean): void {
  for (;;) {
    skipInlineWs(c);
    if (c.peek() === "#") {
      skipComment(c);
      continue;
    }
    if (acrossNewlines && c.peek() === "\r" && c.peek(1) === "\n") {
      c.pos += 2;
      continue;
    }
    if (acrossNewlines && c.peek() === "\n") {
      c.pos++;
      continue;
    }
    return;
  }
}

function expectLineEnd(c: Cursor): void {
  skipInlineWs(c);
  if (c.peek() === "#") skipComment(c);
  if (c.eof()) return;
  if (c.peek() === "\r") c.pos++;
  if (c.peek() === "\n") {
    c.pos++;
    return;
  }
  c.fail("expected end of line");
}

/** TOML forbids raw control characters in strings (tab excepted). */
function isForbiddenStringChar(ch: string): boolean {
  const code = ch.charCodeAt(0);
  return (code < 0x20 && ch !== "\t") || code === 0x7f;
}

function parseBasicString(c: Cursor): string {
  // Opening '"' consumed by caller.
  if (c.peek() === '"' && c.peek(1) === '"') c.fail("multi-line strings are outside the supported grammar");
  let out = "";
  for (;;) {
    if (c.eof()) c.fail("unterminated string");
    const ch = c.next();
    if (ch === '"') return out;
    if (ch === "\n") c.fail("newline in single-line string");
    if (isForbiddenStringChar(ch)) c.fail("control character in string");
    if (ch !== "\\") {
      out += ch;
      continue;
    }
    const esc = c.next();
    switch (esc) {
      case "b": out += "\b"; break;
      case "t": out += "\t"; break;
      case "n": out += "\n"; break;
      case "f": out += "\f"; break;
      case "r": out += "\r"; break;
      case '"': out += '"'; break;
      case "\\": out += "\\"; break;
      case "u":
      case "U": {
        const len = esc === "u" ? 4 : 8;
        const hex = c.src.slice(c.pos, c.pos + len);
        if (!new RegExp(`^[0-9A-Fa-f]{${len}}$`).test(hex)) c.fail(`invalid \\${esc} escape`);
        c.pos += len;
        const cp = parseInt(hex, 16);
        // Only Unicode SCALAR values: no lone surrogates, nothing past 0x10FFFF.
        if ((cp >= 0xd800 && cp <= 0xdfff) || cp > 0x10ffff) c.fail(`non-scalar \\${esc} escape`);
        out += String.fromCodePoint(cp);
        break;
      }
      default:
        c.fail(`unknown escape \\${esc}`);
    }
  }
}

function parseLiteralString(c: Cursor): string {
  // Opening "'" consumed by caller.
  if (c.peek() === "'" && c.peek(1) === "'") c.fail("multi-line strings are outside the supported grammar");
  let out = "";
  for (;;) {
    if (c.eof()) c.fail("unterminated literal string");
    const ch = c.next();
    if (ch === "'") return out;
    if (ch === "\n") c.fail("newline in single-line string");
    if (isForbiddenStringChar(ch)) c.fail("control character in string");
    out += ch;
  }
}

/** One dotted key: bare / "basic" / 'literal' segments separated by '.'. */
function parseKeyPath(c: Cursor): string[] {
  const segments: string[] = [];
  for (;;) {
    skipInlineWs(c);
    let seg: string;
    if (c.peek() === '"') {
      c.pos++;
      seg = parseBasicString(c);
    } else if (c.peek() === "'") {
      c.pos++;
      seg = parseLiteralString(c);
    } else {
      let bare = "";
      while (BARE_KEY_RE.test(c.peek())) bare += c.next();
      if (bare === "") c.fail("expected a key");
      seg = bare;
    }
    if (UNSAFE_KEYS.has(seg)) {
      throw new NativeConfigParseError("toml-unsafe-key", `refusing unsafe key "${seg}"`);
    }
    segments.push(seg);
    skipInlineWs(c);
    if (c.peek() === ".") {
      c.pos++;
      continue;
    }
    return segments;
  }
}

function parseScalarToken(c: Cursor): NativeTomlValue {
  let tok = "";
  while (!c.eof() && !/[\s,\]}#]/.test(c.peek())) tok += c.next();
  if (tok === "true") return true;
  if (tok === "false") return false;
  const dt = DATETIME_RE.exec(tok);
  if (dt) {
    // Component ranges must be REAL calendar values (codex G-lane R4/R5):
    // month-specific day limits incl. leap years, 24h clock, offset ranges.
    const [y, mo, d] = tok.slice(0, 10).split("-").map(Number);
    const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
    const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    const dateOk = mo >= 1 && mo <= 12 && d >= 1 && d <= daysInMonth[mo - 1];
    const time = dt[1] ? tok.slice(11, 19).split(":").map(Number) : null;
    const timeOk = !time || (time[0] < 24 && time[1] < 60 && time[2] <= 60);
    const offset = /[+-](\d{2}):(\d{2})$/.exec(tok.slice(10));
    const offsetOk = !offset || (Number(offset[1]) < 24 && Number(offset[2]) < 60);
    if (dateOk && timeOk && offsetOk) return tok; // verbatim; identity fields never accept it
    c.fail(`invalid date/time "${tok}"`);
  }
  if (/^[+-]?(inf|nan)$/.test(tok)) {
    return tok.endsWith("nan") ? NaN : tok.startsWith("-") ? -Infinity : Infinity;
  }
  if (HEX_RE.test(tok) || OCT_RE.test(tok) || BIN_RE.test(tok)) {
    return Number(tok.replace(/_/g, ""));
  }
  if (INT_RE.test(tok) || FLOAT_RE.test(tok)) {
    return Number(tok.replace(/_/g, ""));
  }
  c.fail(`unrecognized value token "${tok}"`);
}

function parseValue(c: Cursor, ctx: ParseCtx): NativeTomlValue {
  skipInlineWs(c);
  const ch = c.peek();
  if (ch === '"') {
    c.pos++;
    return parseBasicString(c);
  }
  if (ch === "'") {
    c.pos++;
    return parseLiteralString(c);
  }
  if (ch === "[") {
    c.pos++;
    const arr: NativeTomlValue[] = [];
    // A value-position array is CLOSED: a later [[header]] may not append to it.
    ctx.closedToHeaders.add(arr);
    for (;;) {
      skipTrivia(c, true);
      if (c.peek() === "]") {
        c.pos++;
        return arr;
      }
      arr.push(parseValue(c, ctx));
      skipTrivia(c, true);
      if (c.peek() === ",") {
        c.pos++;
        continue;
      }
      if (c.peek() === "]") {
        c.pos++;
        return arr;
      }
      c.fail("expected ',' or ']' in array");
    }
  }
  if (ch === "{") {
    c.pos++;
    const table = newTable();
    // Inline tables are CLOSED (TOML): no later header or dotted key may extend them.
    ctx.closedInline.add(table);
    skipInlineWs(c);
    if (c.peek() === "}") {
      c.pos++;
      return table;
    }
    for (;;) {
      const keyPath = parseKeyPath(c);
      skipInlineWs(c);
      if (c.next() !== "=") c.fail("expected '=' in inline table");
      const value = parseValue(c, ctx);
      assignKey(table, keyPath, value, ctx, { insideClosed: true });
      skipInlineWs(c);
      const sep = c.next();
      if (sep === ",") {
        skipInlineWs(c);
        continue;
      }
      if (sep === "}") return table;
      c.fail("expected ',' or '}' in inline table");
    }
  }
  return parseScalarToken(c);
}

function newTable(): NativeTomlTable {
  return Object.create(null) as NativeTomlTable;
}

function isTable(v: NativeTomlValue | undefined): v is NativeTomlTable {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Walk/create intermediate tables for a dotted path; refuse type conflicts.
 * An INLINE table refuses every traversal — dotted key and header alike — once
 * its defining statement ends (codex G-lane rounds 1+2: extending one is how
 * invalid TOML was shown to establish identity). A dotted-keyval table refuses
 * only `mode: "header"`; later dotted keyvals may extend it, per TOML.
 */
function descend(
  table: NativeTomlTable,
  segments: string[],
  ctx: ParseCtx,
  mode: "header" | "keyval"
): NativeTomlTable {
  let current = table;
  for (const seg of segments) {
    const existing = current[seg];
    if (existing === undefined) {
      const child = newTable();
      if (mode === "keyval") ctx.closedToHeaders.add(child);
      current[seg] = child;
      current = child;
    } else if (isTable(existing)) {
      if (ctx.closedInline.has(existing)) {
        throw new NativeConfigParseError(
          "toml-duplicate-key",
          `inline table "${seg}" is closed and cannot be extended`
        );
      }
      if (mode === "header" && ctx.closedToHeaders.has(existing)) {
        throw new NativeConfigParseError(
          "toml-duplicate-key",
          `key "${seg}" was defined in a key/value position and cannot be reopened by a table header`
        );
      }
      current = existing;
    } else if (Array.isArray(existing)) {
      if (ctx.closedToHeaders.has(existing)) {
        throw new NativeConfigParseError("toml-duplicate-key", `key "${seg}" already holds a value array`);
      }
      const last = existing[existing.length - 1];
      if (!isTable(last)) {
        throw new NativeConfigParseError("toml-duplicate-key", `key "${seg}" is not a table`);
      }
      current = last;
    } else {
      throw new NativeConfigParseError("toml-duplicate-key", `key "${seg}" already holds a value`);
    }
  }
  return current;
}

function assignKey(
  table: NativeTomlTable,
  keyPath: string[],
  value: NativeTomlValue,
  ctx: ParseCtx,
  opts: { insideClosed?: boolean } = {}
): void {
  const parent = descend(table, keyPath.slice(0, -1), ctx, "keyval");
  const leaf = keyPath[keyPath.length - 1];
  if (leaf in parent) {
    throw new NativeConfigParseError("toml-duplicate-key", `duplicate key "${leaf}"`);
  }
  if (opts.insideClosed && isTable(value)) ctx.closedInline.add(value);
  parent[leaf] = value;
}

/**
 * Parse the supported TOML subset into null-prototype tables. Throws
 * NativeConfigParseError (typed refusal code) on anything outside the grammar,
 * on duplicate keys, and on unsafe keys. Never mutates anything on disk.
 */
export function parseNativeToml(raw: string): NativeTomlTable {
  const root = newTable();
  const ctx: ParseCtx = { closedInline: new WeakSet(), closedToHeaders: new WeakSet() };
  const c = new Cursor(raw);
  let currentTable = root;
  const explicitHeaders = new Set<string>();

  for (;;) {
    skipTrivia(c, true);
    if (c.eof()) return root;

    if (c.peek() === "[") {
      c.pos++;
      const isArrayOfTables = c.peek() === "[";
      if (isArrayOfTables) c.pos++;
      const keyPath = parseKeyPath(c);
      skipInlineWs(c);
      if (c.next() !== "]") c.fail("expected ']' closing table header");
      if (isArrayOfTables && c.next() !== "]") c.fail("expected ']]' closing array-of-tables header");
      expectLineEnd(c);

      if (isArrayOfTables) {
        const parent = descend(root, keyPath.slice(0, -1), ctx, "header");
        const leaf = keyPath[keyPath.length - 1];
        const existing = parent[leaf];
        if (existing === undefined) {
          const arr: NativeTomlValue[] = [];
          parent[leaf] = arr;
          const t = newTable();
          arr.push(t);
          currentTable = t;
        } else if (Array.isArray(existing) && !ctx.closedToHeaders.has(existing)) {
          const t = newTable();
          existing.push(t);
          currentTable = t;
        } else {
          throw new NativeConfigParseError("toml-duplicate-key", `key "${leaf}" already holds a value`);
        }
      } else {
        const headerId = keyPath.join("\u0000");
        if (explicitHeaders.has(headerId)) {
          throw new NativeConfigParseError("toml-duplicate-key", `table [${keyPath.join(".")}] defined twice`);
        }
        explicitHeaders.add(headerId);
        // The FINAL segment must name a (new or reopenable) TABLE: `[a]` after
        // `[[a]]` or after `a = <value>` is a redefinition, not navigation.
        const parent = descend(root, keyPath.slice(0, -1), ctx, "header");
        const leaf = keyPath[keyPath.length - 1];
        const existing = parent[leaf];
        if (existing === undefined) {
          const t = newTable();
          parent[leaf] = t;
          currentTable = t;
        } else if (isTable(existing)) {
          if (ctx.closedInline.has(existing) || ctx.closedToHeaders.has(existing)) {
            throw new NativeConfigParseError(
              "toml-duplicate-key",
              `key "${leaf}" cannot be reopened by a table header`
            );
          }
          currentTable = existing;
        } else {
          throw new NativeConfigParseError("toml-duplicate-key", `key "${leaf}" already holds a value`);
        }
      }
      continue;
    }

    const keyPath = parseKeyPath(c);
    skipInlineWs(c);
    if (c.next() !== "=") c.fail("expected '=' after key");
    const value = parseValue(c, ctx);
    assignKey(currentTable, keyPath, value, ctx);
    expectLineEnd(c);
  }
}

// ── Root precedence (C-UPDATE identity: overrides honored, roots never guessed) ──

/**
 * Claude config roots in precedence order: an EXPLICITLY-set CLAUDE_CONFIG_DIR
 * first, then the two documented defaults. Empty/whitespace overrides are
 * ignored, never treated as a root.
 */
export function claudeConfigRoots(opts: {
  homedir: string;
  claudeConfigDir?: string | undefined;
  joiner?: (...parts: string[]) => string;
}): string[] {
  const join = opts.joiner ?? ((...parts: string[]) => parts.join("/"));
  const roots: string[] = [];
  const override = opts.claudeConfigDir?.trim();
  if (override) roots.push(override);
  roots.push(join(opts.homedir, ".claude"), join(opts.homedir, ".config", "claude"));
  return roots;
}

/** Codex home: an EXPLICITLY-set CODEX_HOME wins; otherwise ~/.codex. */
export function codexConfigHome(opts: {
  homedir: string;
  codexHome?: string | undefined;
  joiner?: (...parts: string[]) => string;
}): string {
  const join = opts.joiner ?? ((...parts: string[]) => parts.join("/"));
  const override = opts.codexHome?.trim();
  return override ? override : join(opts.homedir, ".codex");
}

// ── Codex marketplace identity selection ─────────────────────────────────────

export interface NativeChannelIdentity {
  channel: "stable" | "beta";
  commit: string;
}

export type CodexIdentitySelection =
  | {
      status: "selected";
      identity: NativeChannelIdentity;
      /** First agreeing alias (back-compat convenience). */
      alias: string;
      /** EVERY agreeing alias, so physical binding is order-independent. */
      aliases: string[];
    }
  | { status: "absent" }
  | {
      status: "refused";
      reason: "parse-error" | "invalid-identity" | "conflicting-aliases";
      code?: NativeConfigRefusalCode;
      detail: string;
    };

/**
 * The ONLY source spellings that identify the Guild marketplace: the canonical
 * GitHub origin. A path suffix on a foreign host ("https://evil.example/
 * lookatitude/guild") must never match (codex G-lane F2).
 */
const GUILD_SOURCE_RE =
  /^(?:https?:\/\/(?:www\.)?github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)lookatitude\/guild(?:\.git)?\/?$/;

/** The URL-bearing fields a marketplace entry may carry. `source_type` is a kind tag, not a source. */
const SOURCE_FIELDS = ["url", "repo", "repository"] as const;

type EntryClass =
  | { kind: "match" }
  | { kind: "no" }
  | { kind: "refuse"; detail: string };

/**
 * EXPLICIT sources win over the alias name, and they must be consistent: every
 * present source field is a string naming the canonical origin, or the entry
 * is not Guild's. A guild-identified entry (by name or by one matching source)
 * carrying a malformed or contradicting source field REFUSES — mixed metadata
 * is ambiguity, never a fallback (codex G-lane round 2).
 */
function classifyEntry(alias: string, entry: NativeTomlTable): EntryClass {
  let present = 0;
  let matching = 0;
  let foreign = 0;
  let malformed = 0;
  for (const field of SOURCE_FIELDS) {
    if (!(field in entry)) continue;
    present++;
    const v = entry[field];
    if (typeof v !== "string") malformed++;
    else if (GUILD_SOURCE_RE.test(v.trim())) matching++;
    else foreign++;
  }
  const namesGuild = alias === "guild" || matching > 0;
  if (!namesGuild) return { kind: "no" };
  if (malformed > 0) {
    return { kind: "refuse", detail: `alias "${alias}": a source field is not a string` };
  }
  if (matching > 0 && foreign > 0) {
    return { kind: "refuse", detail: `alias "${alias}": source fields disagree about the origin` };
  }
  // Alias "guild" with ONLY foreign sources is simply a different marketplace.
  if (matching === 0 && foreign > 0) return { kind: "no" };
  void present;
  return { kind: "match" };
}

/**
 * Enumerate every `[marketplaces.<alias>]` entry in a Codex config.toml,
 * select the Guild marketplace identity, and REFUSE on conflicts: multiple
 * Guild-naming aliases must agree on (ref, last_revision), the ref must be a
 * known channel branch (main | next), and the revision a full 40-hex SHA.
 * Version shape never participates (C-UPDATE: no channel from version shape).
 */
export function selectCodexMarketplaceIdentity(raw: string): CodexIdentitySelection {
  let parsed: NativeTomlTable;
  try {
    parsed = parseNativeToml(raw);
  } catch (err) {
    if (err instanceof NativeConfigParseError) {
      return { status: "refused", reason: "parse-error", code: err.code, detail: err.message };
    }
    return { status: "refused", reason: "parse-error", detail: String(err) };
  }

  const marketplaces = parsed["marketplaces"];
  if (!isTable(marketplaces)) return { status: "absent" };

  const matches: Array<{ alias: string; identity: NativeChannelIdentity }> = [];
  for (const alias of Object.keys(marketplaces)) {
    const entry = marketplaces[alias];
    if (!isTable(entry)) continue;
    const cls = classifyEntry(alias, entry);
    if (cls.kind === "refuse") {
      return { status: "refused", reason: "invalid-identity", detail: cls.detail };
    }
    if (cls.kind === "no") continue;

    const ref = entry["ref"];
    const commit = entry["last_revision"];
    if (ref !== "main" && ref !== "next") {
      return {
        status: "refused",
        reason: "invalid-identity",
        detail: `alias "${alias}": ref ${JSON.stringify(ref ?? null)} is not a known channel branch`,
      };
    }
    if (typeof commit !== "string" || !SHA40_RE.test(commit)) {
      return {
        status: "refused",
        reason: "invalid-identity",
        detail: `alias "${alias}": last_revision is not a 40-hex SHA`,
      };
    }
    matches.push({
      alias,
      identity: { channel: ref === "next" ? "beta" : "stable", commit },
    });
  }

  if (matches.length === 0) return { status: "absent" };
  const first = matches[0];
  for (const m of matches.slice(1)) {
    if (m.identity.channel !== first.identity.channel || m.identity.commit !== first.identity.commit) {
      return {
        status: "refused",
        reason: "conflicting-aliases",
        detail: `aliases "${first.alias}" and "${m.alias}" disagree on the installed identity`,
      };
    }
  }
  return {
    status: "selected",
    identity: first.identity,
    alias: first.alias,
    aliases: matches.map((m) => m.alias),
  };
}
