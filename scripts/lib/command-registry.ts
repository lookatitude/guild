/**
 * scripts/lib/command-registry.ts
 *
 * P2-Wave-2 ADDITIVE CONTRACT — `guild.command.v1`: a NEUTRAL command registry +
 * fail-closed validator + a deterministic renderer that emits the host-native
 * (Claude) command-file shape (ADR step 16, spec SC-W2-3).
 *
 * Contract authority (SoT):
 *   docs/knowledge/decisions/universal-host-plugin-architecture.md §step 16
 *   .guild/spec/universal-host-p2-wave2.md   SC-W2-3 / SC-W2-5
 *   .guild/plan/universal-host-p2-wave2.md   lane LW2-3 (registry/renderer) / LW2-4 (sources)
 *
 * WHY: today every `/guild:<verb>` command is hand-authored as a Claude-shaped
 * markdown file under `plugin/commands/*.md` (YAML frontmatter — `name`,
 * `description`, `argument-hint`, `allowed-tools` — then a markdown body). Step 16
 * moves the SOURCE of truth to a host-NEUTRAL registry entry; a per-host renderer
 * projects each entry back into the host's native command shape. This wave ships
 * the Claude renderer and PROVES it: `render(entry) == committed commands/<id>.md`
 * BYTE-FOR-BYTE. The committed files stay the canonical, installed artifacts — the
 * renderer targets a temp/staging path ONLY (HARD INVARIANT: never the live tree).
 *
 * NEUTRAL vs HOST-NATIVE split:
 *   - Neutral (in the registry entry): `name`, `description`, `argument_hint`,
 *     `allowed_tools` (a string LIST, not a comma string), `body` (verbatim
 *     host-neutral markdown instructions).
 *   - Host-native (produced by THIS Claude renderer): the YAML frontmatter block
 *     with Claude's exact key order + quoting + the comma-joined `allowed-tools`
 *     scalar, fenced by `---`, then the verbatim body. A future Codex renderer
 *     consumes the SAME entry and emits a different host shape.
 *
 * BYTE-IDENTICAL discipline (F-2, no functional-equivalence fallback):
 *   The renderer reproduces the exact bytes the committed corpus uses — `name` and
 *   `allowed-tools` as plain scalars; `description` and `argument-hint` as
 *   double-quoted scalars escaping ONLY `\` → `\\` and `"` → `\"` (the only escape
 *   the corpus exercises). The validator FAILS CLOSED on any value that the simple
 *   escaper could not round-trip (control chars / newlines / unsafe plain `name`),
 *   so a "valid" entry is GUARANTEED to render to a byte-faithful frontmatter. A
 *   command that cannot be expressed in this shape is escalated (autonomy=ask) by
 *   the producer lane (LW2-4) — never shipped with a silent diff.
 *
 * PURITY: the schema, validators, renderer, and extractor are pure (no I/O, no
 * clock, no random, no process IO at module scope) and the validators NEVER throw
 * — mirroring define-schema.ts / parity-contract.ts. There is NO file writer here:
 * callers (tests / a future staging step) own the write. The ONE exception is the
 * `resolveStagingPath` guard, which reads the filesystem (`fs.realpathSync` over a
 * target's existing ancestors) to canonicalize away symlinks before refusing any
 * path under a live tree (`commands/`, `skills/`, `.claude-plugin/`) — the guard is
 * anchored to an INDEPENDENTLY-resolved plugin root, so a caller-supplied staging
 * dir (even a symlink into the live surface) cannot route a write past it (R2).
 *
 * Owned by tooling-engineer (LW2-3). The neutral sources are authored by
 * command-builder (LW2-4) to match; eval-engineer (LW2-6) owns the parity gate.
 */

import * as fs from "fs";
import * as path from "path";
import { splitFrontmatter, parseYaml } from "./frontmatter";

// ---------------------------------------------------------------------------
// Schema constants + result shape
// ---------------------------------------------------------------------------

export const COMMAND_SCHEMA_VERSION = "guild.command.v1" as const;

/** Fail-closed validator result — `{ valid, errors }` (P1/P2 convention). */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

// ---------------------------------------------------------------------------
// Type — a single neutral command entry (`guild.command.v1`)
// ---------------------------------------------------------------------------

export interface CommandV1 {
  /** Stable command id == the committed filename stem (`status.md` → `status`). Plain scalar. */
  id: string;
  /** Frontmatter `name:` — equals `id` for the current corpus, but carried explicitly. Plain scalar. */
  name: string;
  /** Frontmatter `description:` — rendered as a double-quoted scalar. */
  description: string;
  /** Frontmatter `argument-hint:` — may be empty (`""`); rendered double-quoted. */
  argument_hint: string;
  /** Frontmatter `allowed-tools:` as a NEUTRAL list; rendered comma-space-joined. */
  allowed_tools: string[];
  /**
   * The verbatim markdown body — EVERYTHING after the closing `---` frontmatter
   * fence (this is what `splitFrontmatter` returns as `body`, including the
   * leading blank line). Carried byte-for-byte; the renderer never reflows it.
   */
  body: string;
}

const COMMAND_ALLOWED_KEYS = [
  "id",
  "name",
  "description",
  "argument_hint",
  "allowed_tools",
  "body",
];

// ---------------------------------------------------------------------------
// Type — the registry (the single neutral source for the whole command set)
// ---------------------------------------------------------------------------

export interface CommandRegistryV1 {
  schema_version: typeof COMMAND_SCHEMA_VERSION;
  commands: CommandV1[];
}

const REGISTRY_ALLOWED_KEYS = ["schema_version", "commands"];

// ---------------------------------------------------------------------------
// Render-safety predicates (these are WHAT the validator enforces fail-closed)
// ---------------------------------------------------------------------------

/** A plain (unquoted) YAML scalar that needs no quoting (path-traversal-safe id check). */
const PLAIN_SCALAR = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

/**
 * The command id / `name:` shape: lowercase alnum + hyphen, leading letter. This
 * is the committed filename-stem pattern — every one of the 20 oracle stems
 * (`status`, `config`, `learn`, …) is lowercase with no underscore. Enforcing it
 * stops an entry like `id: "Status"` from staging/rendering `Status.md` (which on
 * a case-insensitive fs would not match the lowercase oracle).
 */
const COMMAND_ID = /^[a-z][a-z0-9-]*$/;

/**
 * Reject control characters (incl. newlines / tabs) in a double-quoted value.
 * The corpus never uses them; allowing them would force YAML escapes (`\n`, `\t`,
 * …) the simple escaper does NOT emit — i.e. a silent non-round-trip. Fail closed.
 */
// eslint-disable-next-line no-control-regex
const HAS_CONTROL_CHAR = /[\x00-\x1F\x7F]/;

/**
 * A single tool token, rendered into the comma-joined `allowed-tools:` scalar.
 * Must be a plain identifier — NO whitespace (incl. newlines/tabs), NO comma, NO
 * control chars — so the join can never break the one-line frontmatter value.
 * Every real tool name (`Read`, `Bash`, `AskUserQuestion`, `TaskCreate`, …) matches.
 */
const TOOL_TOKEN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
function isCleanToolToken(t: unknown): t is string {
  return typeof t === "string" && TOOL_TOKEN.test(t);
}

// ---------------------------------------------------------------------------
// Validator — single entry (fail-closed)
// ---------------------------------------------------------------------------

/**
 * Inner validation logic for ONE entry. May, in principle, touch caller-supplied
 * objects (Object.keys / property reads) that throw (throwing getters, Proxies);
 * the EXPORTED `validateCommandV1` wraps this in try/catch so the public surface
 * NEVER throws — see below.
 */
function validateCommandV1Inner(value: unknown): ValidationResult {
  const errors: string[] = [];
  const where = (k: string) => `command entry: ${k}`;

  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { valid: false, errors: ["command entry: not an object"] };
  }
  const e = value as Record<string, unknown>;

  // strict: no unknown keys
  for (const k of Object.keys(e)) {
    if (!COMMAND_ALLOWED_KEYS.includes(k)) errors.push(`${where(k)}: unknown key`);
  }

  // id — the committed filename-stem shape (lowercase alnum+hyphen), non-empty
  if (typeof e.id !== "string" || e.id.length === 0) {
    errors.push(`${where("id")}: missing or empty`);
  } else if (!COMMAND_ID.test(e.id)) {
    errors.push(`${where("id")}: not a command-id stem (must match ${COMMAND_ID})`);
  }

  // name — same shape (renders unquoted, and must equal id; see coupling below)
  if (typeof e.name !== "string" || e.name.length === 0) {
    errors.push(`${where("name")}: missing or empty`);
  } else if (!COMMAND_ID.test(e.name)) {
    errors.push(`${where("name")}: not a command-id stem (must match ${COMMAND_ID})`);
  }

  // corpus invariant: the frontmatter `name` equals the command id (== filename
  // stem). resolveStagingPath derives `<id>.md` while the renderer emits
  // `name: <name>` — if they diverge the rendered file's name field would not
  // match its own filename, so this is a fail-closed coupling, not a soft note.
  if (
    typeof e.id === "string" &&
    typeof e.name === "string" &&
    e.id.length > 0 &&
    e.name.length > 0 &&
    e.id !== e.name
  ) {
    errors.push(`${where("name")}: must equal id ("${e.name}" !== "${e.id}")`);
  }

  // description — non-empty string, no control chars (renders double-quoted)
  if (typeof e.description !== "string" || e.description.length === 0) {
    errors.push(`${where("description")}: missing or empty`);
  } else if (HAS_CONTROL_CHAR.test(e.description)) {
    errors.push(`${where("description")}: contains a control/newline char (not byte-renderable)`);
  }

  // argument_hint — string (MAY be empty ""), no control chars (renders double-quoted)
  if (typeof e.argument_hint !== "string") {
    errors.push(`${where("argument_hint")}: missing (use "" for none)`);
  } else if (HAS_CONTROL_CHAR.test(e.argument_hint)) {
    errors.push(`${where("argument_hint")}: contains a control/newline char (not byte-renderable)`);
  }

  // allowed_tools — non-empty array of clean tokens
  if (!Array.isArray(e.allowed_tools) || e.allowed_tools.length === 0) {
    errors.push(`${where("allowed_tools")}: missing or empty array`);
  } else {
    e.allowed_tools.forEach((t, i) => {
      if (!isCleanToolToken(t)) {
        errors.push(`${where("allowed_tools")}[${i}]: not a clean tool token (non-empty, no comma, trimmed)`);
      }
    });
  }

  // body — carried verbatim, but must be CANONICAL command-file shape so a valid
  // entry renders the corpus structure (not just *some* byte-faithful output).
  // The renderer emits `…---\n${body}`, so `body` must:
  //   • be a non-empty string,
  //   • begin with EXACTLY ONE blank line then content — `\n` + a non-newline
  //     (this is the single blank line every committed file has after the fence),
  //   • end with EXACTLY ONE trailing newline — a non-newline then a final `\n`.
  // (Internal spacing is unconstrained.) All 20 committed files satisfy this; a
  // body with zero/extra leading-blank-lines or zero/multiple trailing newlines
  // is rejected fail-closed (F-2) rather than rendered into a non-corpus shape.
  if (typeof e.body !== "string") {
    errors.push(`${where("body")}: missing (must be a non-empty string)`);
  } else if (e.body.length === 0) {
    errors.push(`${where("body")}: empty (a command file always has a body)`);
  } else {
    if (!/^\n[^\n]/.test(e.body)) {
      errors.push(`${where("body")}: must begin with exactly one blank line then content`);
    }
    if (!/[^\n]\n$/.test(e.body)) {
      errors.push(`${where("body")}: must end with exactly one trailing newline`);
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate ONE `guild.command.v1` entry. Fails closed on any missing/empty
 * required field, wrong type, unknown key, or a value the byte-faithful renderer
 * could not reproduce. **NEVER throws** on exotic input — a caller-supplied object
 * whose property access throws (throwing getter / Proxy trap) is caught here and
 * reported as a fail-closed validation error, not propagated.
 */
export function validateCommandV1(value: unknown): ValidationResult {
  try {
    return validateCommandV1Inner(value);
  } catch (err) {
    // NB: do NOT use String(err) — a thrown object with a throwing toString()
    // would re-throw here and escape the catch (fail-OPEN). Read err.message only
    // when err is a genuine Error; otherwise a fixed string. (codex G-lane FIX-1.)
    const msg = err instanceof Error ? err.message : "(unknown error)";
    return { valid: false, errors: [`command entry: validation threw (${msg})`] };
  }
}

// ---------------------------------------------------------------------------
// Validator — the whole registry (fail-closed)
// ---------------------------------------------------------------------------

/** Inner registry validation logic — wrapped by the exported never-throws version. */
function validateCommandRegistryV1Inner(value: unknown): ValidationResult {
  const errors: string[] = [];

  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { valid: false, errors: ["registry: not an object"] };
  }
  const r = value as Record<string, unknown>;

  for (const k of Object.keys(r)) {
    if (!REGISTRY_ALLOWED_KEYS.includes(k)) errors.push(`registry: unknown key: ${k}`);
  }

  if (r.schema_version !== COMMAND_SCHEMA_VERSION) {
    errors.push(`registry: schema_version must be "${COMMAND_SCHEMA_VERSION}"`);
  }

  if (!Array.isArray(r.commands) || r.commands.length === 0) {
    errors.push("registry: commands must be a non-empty array");
    return { valid: errors.length === 0, errors };
  }

  const seen = new Set<string>();
  r.commands.forEach((c, i) => {
    const res = validateCommandV1(c);
    if (!res.valid) errors.push(...res.errors.map((m) => `commands[${i}]: ${m}`));
    const id = (c as Record<string, unknown> | null)?.id;
    if (typeof id === "string") {
      if (seen.has(id)) errors.push(`registry: duplicate command id: ${id}`);
      seen.add(id);
    }
  });

  return { valid: errors.length === 0, errors };
}

/**
 * Validate a `guild.command.v1` registry: the version tag, the commands array,
 * each entry, and global uniqueness of `id`. Fails closed; **NEVER throws** —
 * any throw from accessing a hostile top-level object (throwing getter / Proxy)
 * is caught and reported as a fail-closed error.
 */
export function validateCommandRegistryV1(value: unknown): ValidationResult {
  try {
    return validateCommandRegistryV1Inner(value);
  } catch (err) {
    // Same fail-closed message extraction as validateCommandV1 (codex G-lane FIX-1):
    // never call a user-controlled toString() in the catch.
    const msg = err instanceof Error ? err.message : "(unknown error)";
    return { valid: false, errors: [`registry: validation threw (${msg})`] };
  }
}

// ---------------------------------------------------------------------------
// Renderer — neutral entry → host-native (Claude) command-file STRING (pure)
// ---------------------------------------------------------------------------

/**
 * Escape a value for a YAML DOUBLE-QUOTED scalar, matching the committed corpus:
 * backslash → `\\`, then double-quote → `\"`. (The validator guarantees no
 * control chars are present, so no other escape is ever required.)
 */
function escapeDoubleQuoted(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * Render a neutral `guild.command.v1` entry into the Claude command-file shape,
 * BYTE-IDENTICAL to the committed `commands/<id>.md` for a faithful entry.
 *
 * Layout (exactly the corpus shape):
 *   ---\n
 *   name: <name>\n
 *   description: "<esc description>"\n
 *   argument-hint: "<esc argument_hint>"\n
 *   allowed-tools: <t1>, <t2>, …\n
 *   ---\n<body>
 *
 * `body` is appended verbatim — it is exactly what `splitFrontmatter` returns
 * (the closing fence `\n---\n` is stripped), so it begins with the blank line
 * between the fence and the first body line. The canonical shape requires a
 * newline after the closing fence; every committed command file conforms (a
 * file with no trailing newline after `---` would fail the parity round-trip and
 * is escalated under F-2, never silently rendered).
 *
 * PURE: validates first and THROWS on an invalid entry (a renderer must never
 * emit a non-faithful artifact); deterministic; no I/O.
 */
export function renderCommandV1(entry: CommandV1): string {
  const res = validateCommandV1(entry);
  if (!res.valid) {
    throw new Error(`renderCommandV1: refusing to render an invalid entry:\n  ${res.errors.join("\n  ")}`);
  }

  const fm = [
    `name: ${entry.name}`,
    `description: "${escapeDoubleQuoted(entry.description)}"`,
    `argument-hint: "${escapeDoubleQuoted(entry.argument_hint)}"`,
    `allowed-tools: ${entry.allowed_tools.join(", ")}`,
  ].join("\n");

  // "---\n" + frontmatter + "\n---\n" + body  (the closing fence's trailing
  // newline is restored here; `body` is the post-fence remainder verbatim).
  return `---\n${fm}\n---\n${entry.body}`;
}

// ---------------------------------------------------------------------------
// Extractor — committed command file → neutral entry (the byte-identical ORACLE)
// ---------------------------------------------------------------------------

/**
 * Parse a committed Claude command file into a neutral `guild.command.v1` entry.
 *
 * This is the inverse of `renderCommandV1` and the BOOTSTRAP/ORACLE helper: it
 * lets LW2-4 seed the neutral registry from the current corpus and lets the
 * parity test assert `render(extract(file)) === file` for every command. It reads
 * the frontmatter through the shared js-yaml helpers (OD-3-compliant — no
 * hand-rolled YAML reader) and carries the body verbatim.
 *
 * `id` is supplied by the caller (the filename stem) so extraction does not have
 * to know the path. Returns null on a structurally-invalid file (no frontmatter).
 */
export function extractCommandV1(id: string, content: string): CommandV1 | null {
  const { frontmatter, body } = splitFrontmatter(content);
  if (frontmatter === null) return null;

  const fm = parseYaml(frontmatter);
  if (fm === null || typeof fm !== "object" || Array.isArray(fm)) return null;
  const f = fm as Record<string, unknown>;

  const name = typeof f.name === "string" ? f.name : "";
  const description = typeof f.description === "string" ? f.description : "";
  // `argument-hint` may be absent; the corpus always carries it (often "")
  const argHintRaw = f["argument-hint"];
  const argument_hint = typeof argHintRaw === "string" ? argHintRaw : "";
  // `allowed-tools` is a bare comma-separated scalar → split into the neutral list
  const toolsRaw = f["allowed-tools"];
  const allowed_tools =
    typeof toolsRaw === "string"
      ? toolsRaw.split(",").map((t) => t.trim()).filter((t) => t.length > 0)
      : Array.isArray(toolsRaw)
        ? toolsRaw.map((t) => String(t).trim()).filter((t) => t.length > 0)
        : [];

  return { id, name, description, argument_hint, allowed_tools, body };
}

// ---------------------------------------------------------------------------
// I/O helper (opt-in) — render to a STAGING path only (R2 live-surface guard)
// ---------------------------------------------------------------------------

/**
 * The plugin root, resolved INDEPENDENTLY from this module's own location
 * (`scripts/lib/` → two levels up). The live-surface guard anchors to THIS, never
 * to a caller-supplied root: a caller could otherwise pass a mismatched root to
 * slip a write into the live tree past the guard (codex G-lane parity with
 * skill-source-transform.ts `assertStagingPath`).
 */
const REAL_PLUGIN_ROOT = path.resolve(__dirname, "..", "..");

/**
 * The CLOSED set of live-surface roots a render must NEVER write into (R2 /
 * SC-W2-5): the live `commands/` tree (this lane's direct target), `skills/`, and
 * `.claude-plugin/`. Absolute, anchored to the independently-resolved plugin root
 * — not configurable by a caller. The neutral command-registry source file lives
 * OUTSIDE these trees, so it stays a legal non-live path.
 */
const LIVE_SURFACE_DIRS = ["commands", "skills", ".claude-plugin"] as const;

/**
 * Canonicalize a path to an absolute real path, resolving symlinks on the longest
 * EXISTING ancestor (the target file itself may not exist yet). Defeats a symlink
 * bypass — e.g. a `stagingDir` that is itself a symlink into the live `commands/`
 * tree resolves to the real live path and is rejected.
 */
function canonicalAbs(p: string): string {
  const abs = path.resolve(p);
  let existing = abs;
  const tail: string[] = [];
  while (!fs.existsSync(existing)) {
    tail.unshift(path.basename(existing));
    const parent = path.dirname(existing);
    if (parent === existing) return abs; // hit filesystem root without existence
    existing = parent;
  }
  try {
    const realExisting = fs.realpathSync(existing);
    return tail.length ? path.join(realExisting, ...tail) : realExisting;
  } catch {
    return abs;
  }
}

/** Segment-aware containment: is `child` the same as, or nested under, `parent`? */
function isUnderOrEqual(child: string, parent: string): boolean {
  const rel = path.relative(parent, child);
  return (
    rel === "" ||
    (rel !== ".." && !rel.startsWith(".." + path.sep) && !path.isAbsolute(rel))
  );
}

/**
 * Build the absolute staging file path for a rendered command and REFUSE if it
 * would land inside ANY live plugin tree. Pure w.r.t. its return value (no write);
 * does READ the filesystem (realpath of existing ancestors) to defeat symlinks —
 * the guard the writer relies on, exported so callers/tests can assert it.
 *
 * HARDENED to the `skill-source-transform.ts assertStagingPath` standard:
 *   • the id must be a plain scalar (no path traversal via the filename);
 *   • the target is canonicalized with `fs.realpathSync` over its existing
 *     ancestors (symlinks resolved) BEFORE the containment test;
 *   • rejection anchors to the INDEPENDENTLY-resolved `REAL_PLUGIN_ROOT` + a CLOSED
 *     live-root set — a caller-supplied `stagingDir` is NOT trusted, so neither a
 *     mismatched root nor a symlink can route a write into live `commands/` /
 *     `skills/` / `.claude-plugin/`.
 * THROWS on an unsafe id or any target resolving under a live root.
 */
export function resolveStagingPath(stagingDir: string, id: string): string {
  if (!PLAIN_SCALAR.test(id)) {
    throw new Error(`resolveStagingPath: unsafe command id "${id}" (must be a plain scalar)`);
  }
  const abs = path.resolve(stagingDir, `${id}.md`);
  const absTarget = canonicalAbs(abs);
  for (const dir of LIVE_SURFACE_DIRS) {
    const liveRoot = canonicalAbs(path.join(REAL_PLUGIN_ROOT, dir));
    if (isUnderOrEqual(absTarget, liveRoot)) {
      throw new Error(
        `resolveStagingPath: refusing to target the live surface — live "${dir}/" tree: ` +
          `${abs} resolves to ${absTarget}, under the live root ${liveRoot} ` +
          `(renders to temp/staging only; guard anchored independently — SC-W2-5)`,
      );
    }
  }
  return abs;
}
