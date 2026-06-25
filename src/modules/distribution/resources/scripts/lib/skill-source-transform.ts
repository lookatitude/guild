/**
 * scripts/lib/skill-source-transform.ts
 *
 * LW2-1 — the NEUTRAL skill source registry (`guild.skill_src.v1`) + a fail-closed
 * validator + a deterministic transformer that RENDERS the host-native (Claude)
 * `SKILL.md` from a STRUCTURED registry entry (ADR step 15, spec SC-W2-1).
 *
 * Contract authority (SoT):
 *   docs/knowledge/decisions/universal-host-plugin-architecture.md §step 15
 *   .guild/spec/universal-host-p2-wave2.md   SC-W2-1 / SC-W2-5
 *   .guild/plan/universal-host-p2-wave2.md   lane LW2-1 (transformer) / LW2-2 (sources)
 *
 * WHY (and what the earlier round got wrong): the first cut authored each neutral
 * source as a VERBATIM byte-copy of the committed `SKILL.md`, which made the
 * transform an IDENTITY function — `render(src) == committed` proved nothing about
 * host-neutrality (it defeated ADR step 15). This module fixes that by modelling the
 * source EXACTLY on the (correct) command lane (`command-registry.ts` /
 * `command-src/command-registry.json`): the SOURCE OF TRUTH is a host-NEUTRAL
 * registry of STRUCTURED entries `{ name, description, when_to_use, type, body }`;
 * the renderer PROJECTS an entry back into Claude's exact `SKILL.md` shape. The
 * transform is therefore NON-trivial (a JSON entry → the YAML-frontmatter+body md),
 * and a future Codex renderer would consume the SAME entry to emit a different host
 * shape.
 *
 * NEUTRAL vs HOST-NATIVE split:
 *   - Neutral (registry entry): `id` (the skill dir stem), `name`/`description`/
 *     `when_to_use`/`type` (the frontmatter fields as discrete values), `body`
 *     (the host-neutral markdown instructions, verbatim).
 *   - Host-native (produced by THIS Claude renderer): the `---`-fenced YAML
 *     frontmatter block with Claude's exact key order (name, description,
 *     when_to_use, type) as single-line UNQUOTED scalars, then the verbatim body.
 *
 * BYTE-IDENTICAL discipline (F-2, no functional-equivalence fallback):
 *   The committed skill frontmatter uses UNQUOTED single-line scalars, so the
 *   renderer emits each value verbatim as `key: <value>`. The validator FAILS
 *   CLOSED on any value the single-line shape could not reproduce (a newline /
 *   control char in a scalar, a body without the canonical one-blank-line head /
 *   single trailing newline), so a "valid" entry is GUARANTEED to render
 *   byte-faithfully. A skill that cannot be expressed in this shape is escalated
 *   (autonomy=ask) by the producer lane (LW2-2) — never shipped with a silent diff.
 *
 * PURITY: every render/validate/extract function is pure (no I/O, no clock, no
 * random). The ONLY writer is `renderSkillToStaging`, which is guarded by
 * `assertStagingPath` (anchored to an INDEPENDENTLY-resolved plugin root + a CLOSED
 * live-surface set) so a render can only ever land in a temp/staging tree — never
 * `skills/**`, `.claude-plugin/**`, or `commands/**` (HARD INVARIANT, R2 / SC-W2-5).
 *
 * Owned by tooling-engineer (LW2-1). The neutral registry is authored by
 * skill-author (LW2-2); the parity/drift gate is eval-engineer's (LW2-6).
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { splitFrontmatter } from "./frontmatter";

// ---------------------------------------------------------------------------
// Schema constants + result shape
// ---------------------------------------------------------------------------

export const SKILL_SRC_SCHEMA_VERSION = "guild.skill_src.v1" as const;

/** Fail-closed validator result — `{ valid, errors }` (P1/P2 convention). */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

// ---------------------------------------------------------------------------
// Type — a single neutral skill entry (`guild.skill_src.v1`)
// ---------------------------------------------------------------------------

export interface SkillSrcV1 {
  /** Stable skill id == the committed skill DIR stem (`skills/meta/tdd` → `tdd`). Plain scalar. */
  id: string;
  /** Frontmatter `name:` — the namespaced skill name (e.g. `guild-tdd`); rendered unquoted. */
  name: string;
  /** Frontmatter `description:` — rendered as a single-line UNQUOTED scalar. */
  description: string;
  /** Frontmatter `when_to_use:` — rendered as a single-line UNQUOTED scalar. */
  when_to_use: string;
  /** Frontmatter `type:` — e.g. `meta`; rendered as an unquoted scalar. */
  type: string;
  /**
   * The verbatim markdown body — EVERYTHING after the closing `---` frontmatter
   * fence (exactly what `splitFrontmatter` returns as `body`, including the leading
   * blank line). Carried byte-for-byte; the renderer never reflows it.
   */
  body: string;
}

const SKILL_ALLOWED_KEYS = ["id", "name", "description", "when_to_use", "type", "body"];

// ---------------------------------------------------------------------------
// Type — the registry (the single neutral source for the skill set)
// ---------------------------------------------------------------------------

export interface SkillSrcRegistryV1 {
  schema_version: typeof SKILL_SRC_SCHEMA_VERSION;
  skills: SkillSrcV1[];
}

const REGISTRY_ALLOWED_KEYS = ["schema_version", "skills"];

// ---------------------------------------------------------------------------
// Render-safety predicates (WHAT the validator enforces fail-closed)
// ---------------------------------------------------------------------------

/** The skill dir-stem shape: lowercase alnum + hyphen, leading letter (matches all 5). */
const SKILL_ID = /^[a-z][a-z0-9-]*$/;

/** The frontmatter `name:` shape — a plain unquoted scalar (`guild-review-broker`, …). */
const SKILL_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

/** The `type:` shape — a plain unquoted scalar (`meta`). */
const SKILL_TYPE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

/**
 * Reject control characters (incl. newlines / tabs / CR) in a single-line scalar.
 * The committed frontmatter scalars are one line each; a newline would split the
 * value across lines and the verbatim emit would NOT round-trip — fail closed.
 */
// eslint-disable-next-line no-control-regex
const HAS_CONTROL_CHAR = /[\x00-\x1F\x7F]/;

// ---------------------------------------------------------------------------
// Validator — single entry (fail-closed, never throws)
// ---------------------------------------------------------------------------

/**
 * Validate ONE `guild.skill_src.v1` entry. Fails closed on any missing/empty
 * required field, wrong type, unknown key, or a value the byte-faithful renderer
 * could not reproduce. NEVER throws on exotic input.
 */
export function validateSkillSrcV1(value: unknown): ValidationResult {
  // Fail-CLOSED on ANY throw — a throwing getter or a Proxy trap on arbitrary input
  // must NEVER escape as an exception (codex re-gate); it returns {valid:false}. The
  // checks live in the inner function; this wrapper is the only public entry.
  try {
    return validateSkillSrcV1Inner(value);
  } catch (err) {
    // NB: never `String(err)` here — an unstringifiable thrown object (a toString
    // that itself throws) would escape this very catch. `err.message` is already a
    // string for an Error; anything else collapses to a fixed label.
    return {
      valid: false,
      errors: [`skill entry: validation threw on exotic input: ${err instanceof Error ? err.message : "(unknown error)"}`],
    };
  }
}

function validateSkillSrcV1Inner(value: unknown): ValidationResult {
  const errors: string[] = [];
  const where = (k: string) => `skill entry: ${k}`;

  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { valid: false, errors: ["skill entry: not an object"] };
  }
  const e = value as Record<string, unknown>;

  for (const k of Object.keys(e)) {
    if (!SKILL_ALLOWED_KEYS.includes(k)) errors.push(`${where(k)}: unknown key`);
  }

  // id — the committed dir-stem shape (lowercase alnum+hyphen), non-empty
  if (typeof e.id !== "string" || e.id.length === 0) {
    errors.push(`${where("id")}: missing or empty`);
  } else if (!SKILL_ID.test(e.id)) {
    errors.push(`${where("id")}: not a skill-dir stem (must match ${SKILL_ID})`);
  }

  // name — a plain unquoted scalar (namespaced skill name); non-empty
  if (typeof e.name !== "string" || e.name.length === 0) {
    errors.push(`${where("name")}: missing or empty`);
  } else if (!SKILL_NAME.test(e.name)) {
    errors.push(`${where("name")}: not a plain scalar name (must match ${SKILL_NAME})`);
  }

  // description — non-empty single-line scalar (renders unquoted)
  if (typeof e.description !== "string" || e.description.length === 0) {
    errors.push(`${where("description")}: missing or empty`);
  } else if (HAS_CONTROL_CHAR.test(e.description)) {
    errors.push(`${where("description")}: contains a control/newline char (not single-line renderable)`);
  }

  // when_to_use — non-empty single-line scalar (renders unquoted)
  if (typeof e.when_to_use !== "string" || e.when_to_use.length === 0) {
    errors.push(`${where("when_to_use")}: missing or empty`);
  } else if (HAS_CONTROL_CHAR.test(e.when_to_use)) {
    errors.push(`${where("when_to_use")}: contains a control/newline char (not single-line renderable)`);
  }

  // type — non-empty plain scalar (renders unquoted)
  if (typeof e.type !== "string" || e.type.length === 0) {
    errors.push(`${where("type")}: missing or empty`);
  } else if (!SKILL_TYPE.test(e.type)) {
    errors.push(`${where("type")}: not a plain scalar type (must match ${SKILL_TYPE})`);
  }

  // body — verbatim, but must be CANONICAL skill-file shape so a valid entry renders
  // the corpus structure: a non-empty string that begins with EXACTLY ONE blank line
  // then content (`\n` + a non-newline) and ends with EXACTLY ONE trailing newline
  // (a non-newline then a final `\n`). All 5 committed files satisfy this.
  if (typeof e.body !== "string") {
    errors.push(`${where("body")}: missing (must be a non-empty string)`);
  } else if (e.body.length === 0) {
    errors.push(`${where("body")}: empty (a skill file always has a body)`);
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

// ---------------------------------------------------------------------------
// Validator — the whole registry (fail-closed, never throws)
// ---------------------------------------------------------------------------

/**
 * Validate a `guild.skill_src.v1` registry: the version tag, the skills array,
 * each entry, and global uniqueness of `id`. Fails closed; never throws.
 */
export function validateSkillSrcRegistryV1(value: unknown): ValidationResult {
  // Fail-CLOSED on ANY throw — same guard as the per-entry validator (the registry's
  // own member access / iteration could trip a throwing getter or Proxy trap on
  // arbitrary input). Returns {valid:false} rather than propagating an exception.
  try {
    return validateSkillSrcRegistryV1Inner(value);
  } catch (err) {
    // Never `String(err)` — see validateSkillSrcV1's catch (an unstringifiable
    // thrown object would escape this catch).
    return {
      valid: false,
      errors: [`registry: validation threw on exotic input: ${err instanceof Error ? err.message : "(unknown error)"}`],
    };
  }
}

function validateSkillSrcRegistryV1Inner(value: unknown): ValidationResult {
  const errors: string[] = [];

  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { valid: false, errors: ["registry: not an object"] };
  }
  const r = value as Record<string, unknown>;

  for (const k of Object.keys(r)) {
    if (!REGISTRY_ALLOWED_KEYS.includes(k)) errors.push(`registry: unknown key: ${k}`);
  }

  if (r.schema_version !== SKILL_SRC_SCHEMA_VERSION) {
    errors.push(`registry: schema_version must be "${SKILL_SRC_SCHEMA_VERSION}"`);
  }

  if (!Array.isArray(r.skills) || r.skills.length === 0) {
    errors.push("registry: skills must be a non-empty array");
    return { valid: errors.length === 0, errors };
  }

  const seen = new Set<string>();
  r.skills.forEach((s, i) => {
    const res = validateSkillSrcV1(s);
    if (!res.valid) errors.push(...res.errors.map((m) => `skills[${i}]: ${m}`));
    const id = (s as Record<string, unknown> | null)?.id;
    if (typeof id === "string") {
      if (seen.has(id)) errors.push(`registry: duplicate skill id: ${id}`);
      seen.add(id);
    }
  });

  return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Renderer — neutral entry → host-native (Claude) SKILL.md STRING (pure)
// ---------------------------------------------------------------------------

/**
 * Render a neutral `guild.skill_src.v1` entry into the Claude `SKILL.md` shape,
 * BYTE-IDENTICAL to the committed `skills/<tier>/<id>/SKILL.md` for a faithful entry.
 *
 * Layout (exactly the corpus shape — single-line UNQUOTED scalars in this order):
 *   ---\n
 *   name: <name>\n
 *   description: <description>\n
 *   when_to_use: <when_to_use>\n
 *   type: <type>\n
 *   ---\n<body>
 *
 * `body` is appended verbatim — it begins with the blank line between the closing
 * fence and the first body line, and ends with exactly one trailing newline.
 *
 * PURE: validates first and THROWS on an invalid entry (a renderer must never emit
 * a non-faithful artifact); deterministic; no I/O.
 */
export function renderSkillV1(entry: SkillSrcV1): string {
  const res = validateSkillSrcV1(entry);
  if (!res.valid) {
    throw new Error(`renderSkillV1: refusing to render an invalid entry:\n  ${res.errors.join("\n  ")}`);
  }

  const fm = [
    `name: ${entry.name}`,
    `description: ${entry.description}`,
    `when_to_use: ${entry.when_to_use}`,
    `type: ${entry.type}`,
  ].join("\n");

  // "---\n" + frontmatter + "\n---\n" + body  (the closing fence's trailing newline
  // is restored here; `body` is the post-fence remainder verbatim).
  return `---\n${fm}\n---\n${entry.body}`;
}

/** Find an entry by id in a registry and render it (throws if absent or invalid). */
export function renderSkillFromRegistry(registry: SkillSrcRegistryV1, id: string): string {
  const entry = registry.skills.find((s) => s.id === id);
  if (!entry) {
    throw new Error(`renderSkillFromRegistry: no skill entry with id "${id}"`);
  }
  return renderSkillV1(entry);
}

// ---------------------------------------------------------------------------
// Extractor — committed SKILL.md → neutral entry (the byte-identical ORACLE)
// ---------------------------------------------------------------------------

/** A single frontmatter line: `key: value` (single space). value is the raw rest-of-line. */
const FRONTMATTER_LINE = /^([A-Za-z_][A-Za-z0-9_-]*): (.*)$/;

/**
 * Parse a committed Claude `SKILL.md` into a neutral `guild.skill_src.v1` entry —
 * the inverse of `renderSkillV1` and the BOOTSTRAP/ORACLE helper that lets LW2-2
 * seed the registry from the current corpus and lets the parity test assert
 * `render(extract(file)) === file`.
 *
 * The frontmatter values are read as the RAW rest-of-line (NOT through a semantic
 * YAML parse), so the round-trip is byte-exact for the committed unquoted single-
 * line scalars. The body is `splitFrontmatter`'s verbatim remainder.
 *
 * `id` is supplied by the caller (the skill dir stem). Returns null on a
 * structurally-invalid file (no frontmatter, or a non-conforming frontmatter line).
 */
export function extractSkillV1(id: string, content: string): SkillSrcV1 | null {
  const { frontmatter, body } = splitFrontmatter(content);
  if (frontmatter === null) return null;

  const fields: Record<string, string> = {};
  for (const line of frontmatter.split("\n")) {
    if (line === "") continue;
    const m = FRONTMATTER_LINE.exec(line);
    if (!m) return null; // non-conforming frontmatter → cannot source losslessly
    fields[m[1]] = m[2];
  }

  if (
    typeof fields.name !== "string" ||
    typeof fields.description !== "string" ||
    typeof fields.when_to_use !== "string" ||
    typeof fields.type !== "string"
  ) {
    return null;
  }

  return {
    id,
    name: fields.name,
    description: fields.description,
    when_to_use: fields.when_to_use,
    type: fields.type,
    body,
  };
}

// ---------------------------------------------------------------------------
// Registry loader (opt-in I/O) — read + validate the neutral registry file
// ---------------------------------------------------------------------------

/** Default neutral registry location — OUTSIDE the live surface (`plugin/skill-src/`). */
export const DEFAULT_REGISTRY_PATH = path.join(
  path.resolve(__dirname, "..", ".."),
  "skill-src",
  "skill-registry.json",
);

/** Parse + fail-closed-validate registry JSON text into a typed registry (throws on invalid). */
export function parseSkillRegistry(jsonText: string): SkillSrcRegistryV1 {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    throw new Error(`parseSkillRegistry: not valid JSON: ${String(err)}`);
  }
  const res = validateSkillSrcRegistryV1(parsed);
  if (!res.valid) {
    throw new Error(`parseSkillRegistry: invalid guild.skill_src.v1 registry:\n  ${res.errors.join("\n  ")}`);
  }
  return parsed as SkillSrcRegistryV1;
}

/** Read + validate the registry from disk. */
export function loadSkillRegistry(registryPath: string = DEFAULT_REGISTRY_PATH): SkillSrcRegistryV1 {
  return parseSkillRegistry(fs.readFileSync(registryPath, "utf8"));
}

// ---------------------------------------------------------------------------
// Staging guard — render to a TEMP/STAGING path ONLY (never the live surface)
// ---------------------------------------------------------------------------

/**
 * The plugin repo root resolved INDEPENDENTLY of any caller — `scripts/lib` sits
 * two levels under the plugin root. The live-surface guard anchors to THIS, never
 * to a caller-supplied root (codex G-lane LW2-1-B): a caller could otherwise pass a
 * mismatched root to slip a write into the live tree past the guard.
 */
const REAL_PLUGIN_ROOT = path.resolve(__dirname, "..", "..");

/**
 * The CLOSED set of live-surface roots a render must NEVER write into (R2 /
 * SC-W2-5): the live `skills/` tree, `.claude-plugin/`, and `commands/`. Absolute,
 * anchored to the independently-resolved plugin root — not configurable by a caller.
 * The neutral source tree `plugin/skill-src/` is deliberately NOT in this set
 * (`skill-src` ≠ `skills` segment-wise), so it stays a legal non-live path.
 */
const LIVE_SURFACE_DIRS = ["skills", ".claude-plugin", "commands"] as const;

/**
 * Canonicalize a path to an absolute real path, resolving symlinks on the longest
 * EXISTING ancestor (the target file itself may not exist yet). Defeats a symlink
 * bypass — e.g. a `stagingRoot` that is itself a symlink into the live `skills/`
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
 * Guard: assert `target` is a staging/temp path, NOT the live install surface.
 *
 * HARDENED (codex G-lane LW2-1-B): the rejection is anchored to the
 * INDEPENDENTLY-resolved plugin root (`REAL_PLUGIN_ROOT`) and a CLOSED live-root
 * set (`LIVE_SURFACE_DIRS`). The optional `pluginRoot` argument is RETAINED for
 * signature compatibility but is **NOT trusted** for the security decision — no
 * caller-supplied root can route a write into the live surface. The target is
 * canonicalized (symlinks resolved) before the containment test, so neither a
 * mismatched root nor a symlink can bypass the guard.
 */
export function assertStagingPath(target: string, _pluginRoot?: string): void {
  const absTarget = canonicalAbs(target);
  for (const dir of LIVE_SURFACE_DIRS) {
    const liveRoot = canonicalAbs(path.join(REAL_PLUGIN_ROOT, dir));
    if (isUnderOrEqual(absTarget, liveRoot)) {
      throw new Error(
        `refusing to render into the live surface: ${target} resolves to ` +
          `${absTarget}, under the live root ${liveRoot} ` +
          `(renders to temp/staging only; guard anchored independently — SC-W2-5)`,
      );
    }
  }
}

/**
 * Render the skill with id `skillId` FROM the neutral registry and write the
 * result to `<stagingRoot>/<skillId>/SKILL.md`.
 *
 * The staging target is guarded by `assertStagingPath` BEFORE any write — this is
 * the ONLY writer in this module, and (the guard being anchored to an
 * independently-resolved plugin root) even a caller passing the live `skills/` tree
 * as `stagingRoot` with any `pluginRoot` is rejected before `fs.writeFileSync`
 * (LW2-1-B). Returns the rendered bytes and the path written.
 *
 * `pluginRoot` is RETAINED for signature compatibility only — it is NOT trusted by
 * the guard (the live-surface decision uses the module's own resolved root).
 */
export function renderSkillToStaging(
  registry: SkillSrcRegistryV1,
  skillId: string,
  stagingRoot: string,
  pluginRoot?: string,
): { outPath: string; bytes: string } {
  const bytes = renderSkillFromRegistry(registry, skillId);

  const outDir = path.join(stagingRoot, skillId);
  const outPath = path.join(outDir, "SKILL.md");
  assertStagingPath(outPath, pluginRoot);

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outPath, bytes);
  return { outPath, bytes };
}

// ---------------------------------------------------------------------------
// CLI — render the registry to a staging path (never the live surface)
// ---------------------------------------------------------------------------

/** The five invocation-driving skills with a committed SKILL.md (F-5: using-guild excluded). */
export const WAVE2_SKILL_IDS = [
  "review-broker",
  "execute-plan",
  "systematic-debug",
  "tdd",
  "verify-done",
] as const;

interface CliArgs {
  registryPath: string;
  stagingRoot: string;
  skills: string[];
}

export function parseCliArgs(argv: string[]): CliArgs | { error: string } {
  let registryPath: string = DEFAULT_REGISTRY_PATH;
  let stagingRoot: string | undefined;
  let skills: string[] = [...WAVE2_SKILL_IDS];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--registry" && argv[i + 1] !== undefined) registryPath = argv[++i];
    else if (a.startsWith("--registry=")) registryPath = a.slice("--registry=".length);
    else if (a === "--staging" && argv[i + 1] !== undefined) stagingRoot = argv[++i];
    else if (a.startsWith("--staging=")) stagingRoot = a.slice("--staging=".length);
    else if (a === "--skills" && argv[i + 1] !== undefined) skills = argv[++i].split(",").filter(Boolean);
    else if (a.startsWith("--skills=")) skills = a.slice("--skills=".length).split(",").filter(Boolean);
    else return { error: `unknown argument: ${a}` };
  }
  if (!stagingRoot) return { error: "missing required --staging <staging/temp root>" };
  return { registryPath, stagingRoot, skills };
}

function main(): number {
  const parsed = parseCliArgs(process.argv.slice(2));
  if ("error" in parsed) {
    process.stderr.write(
      parsed.error +
        "\nusage: skill-source-transform.ts --staging <temp root> [--registry <path>] [--skills a,b,c]\n" +
        "Renders the neutral registry to a STAGING path only (never the live surface).\n",
    );
    return 1;
  }
  let registry: SkillSrcRegistryV1;
  try {
    registry = loadSkillRegistry(parsed.registryPath);
  } catch (err) {
    process.stderr.write(`skill-source-transform: ${String(err instanceof Error ? err.message : err)}\n`);
    return 2;
  }
  for (const skillId of parsed.skills) {
    try {
      const { outPath } = renderSkillToStaging(registry, skillId, parsed.stagingRoot);
      process.stdout.write(`rendered ${skillId} → ${outPath}\n`);
    } catch (err) {
      process.stderr.write(
        `skill-source-transform: ${skillId}: ${String(err instanceof Error ? err.message : err)}\n`,
      );
      return 2;
    }
  }
  return 0;
}

if (require.main === module) {
  process.exit(main());
}
