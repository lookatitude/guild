/**
 * scripts/lib/skill-source-transform.ts
 *
 * LW2-1 — the deterministic source→host transformer for Guild skills
 * (`guild.skill_source.v1`). It renders a NEUTRAL skill source into the
 * host-native (Claude) `SKILL.md` shape so a skill can be authored once from a
 * source that lives OUTSIDE the live install surface and rendered into the
 * committed runtime artifact.
 *
 * Wave context (BY POINTER):
 *   .guild/spec/universal-host-p2-wave2.md  — SC-W2-1 / SC-W2-2 (ADR step 15)
 *   plugin/skills/meta/using-guild/SKILL.src.md — the P0 `SKILL.src.md` precedent
 *   plugin/scripts/lib/per-host-packaging.ts — the sibling pure-renderer convention
 *
 * HARD INVARIANTS (the spec's F-1/F-2/F-5; enforced here in code, not prose):
 *   - Neutral sources live under `plugin/skill-src/<skill>/` — OUTSIDE the live
 *     surface. They are NOT co-located `skills/<tier>/<skill>/SKILL.src.md` (which
 *     `build-inventory.ts` prefers as the runtime entry — F-1).
 *   - Render targets a TEMP/STAGING path ONLY. `renderSkillToStaging` REFUSES to
 *     write into `.claude-plugin/**`, `commands/**`, or live `skills/**`
 *     (`assertStagingPath` — defense in depth for R2).
 *   - BYTE-IDENTICAL only (F-2). The Claude renderer canonically re-serializes the
 *     parsed source; a source that cannot round-trip to its committed `SKILL.md`
 *     is a defect to escalate (autonomy=ask), never a silent diff.
 *
 * DETERMINISM: every exported function is PURE over its inputs — no filesystem
 * (except the explicit `*FromDir` / `*ToStaging` I/O wrappers, which take paths),
 * no network, no `Date.now()`, no `Math.random()`. Identical source → byte-identical
 * render, always.
 *
 * Owned by tooling-engineer (LW2-1). The neutral SOURCES are authored by
 * skill-author (LW2-2); the per-skill render-equivalence + drift gate are owned by
 * eval-engineer (LW2-6). `extractSkillSource` is the pure inverse — the bootstrap
 * LW2-2 can seed sources from, and the oracle the round-trip self-test uses.
 */

import * as fs from "node:fs";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// guild.skill_source.v1 — the neutral skill-source AST
// ---------------------------------------------------------------------------

/**
 * One frontmatter field of a neutral skill source. The neutral metadata is a
 * flat, ORDERED list of single-line `key: value` fields (the shape every Guild
 * skill uses today: name, description, when_to_use, type). Order is preserved so
 * the Claude render is byte-identical to the committed `SKILL.md`.
 */
export interface SkillSourceField {
  key: string;
  value: string;
}

/** The parsed neutral skill source (`guild.skill_source.v1`). */
export interface SkillSource {
  readonly schema_version: "guild.skill_source.v1";
  /** Ordered frontmatter fields (the host-neutral metadata). */
  frontmatter: SkillSourceField[];
  /**
   * The skill body, VERBATIM — every byte after the frontmatter's closing
   * `---\n` line (this INCLUDES the conventional blank line that separates the
   * frontmatter from the `# Title`). Stored verbatim so the body never needs to
   * round-trip through a lossy structural model — byte-identity is by construction.
   */
  body: string;
}

export const SKILL_SOURCE_SCHEMA_VERSION = "guild.skill_source.v1" as const;

/**
 * The frontmatter line grammar. A neutral-source frontmatter line MUST be a
 * single-line `key: value` pair: a key (`[A-Za-z_][A-Za-z0-9_-]*`), a colon, a
 * single space, then the (possibly empty) value running to end-of-line. This is
 * exactly the shape `readScalarField` (build-inventory's reader) consumes, and
 * the shape all five Wave-2 skills already use. A line that does not conform is
 * REJECTED at parse time (it would not round-trip byte-identically) — F-2: escalate,
 * never ship a silent diff.
 */
const FRONTMATTER_LINE = /^([A-Za-z_][A-Za-z0-9_-]*): (.*)$/;

/** Raised when a source cannot be parsed into a byte-identical-renderable AST. */
export class SkillSourceParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SkillSourceParseError";
  }
}

// ---------------------------------------------------------------------------
// Parse — neutral source text → AST
// ---------------------------------------------------------------------------

/**
 * Parse neutral skill-source TEXT (`guild.skill_source.v1`) into its AST.
 *
 * The source text is a frontmatter-plus-body document, byte-shaped like a
 * `SKILL.md`: an opening `---\n`, one or more `key: value` frontmatter lines, a
 * closing `---\n`, then the verbatim body. PURE: text in, AST out.
 *
 * Throws `SkillSourceParseError` on any shape the renderer could not reproduce
 * byte-identically (missing/empty frontmatter, a non-conforming frontmatter
 * line, no closing delimiter) — a fail-closed parser is what makes the
 * byte-identical guarantee real rather than best-effort.
 */
export function parseSkillSource(text: string): SkillSource {
  if (!text.startsWith("---\n")) {
    throw new SkillSourceParseError(
      "skill source must begin with a `---\\n` frontmatter delimiter",
    );
  }
  // Everything after the opening delimiter.
  const afterOpen = text.slice("---\n".length);

  // Find the closing delimiter: a line that is exactly `---`. We scan line by
  // line so the body (which itself may contain `---` horizontal rules) is never
  // mistaken for the close — only the FIRST standalone `---` line closes.
  const closeIdx = findClosingDelimiter(afterOpen);
  if (closeIdx === null) {
    throw new SkillSourceParseError(
      "skill source frontmatter has no closing `---` delimiter line",
    );
  }

  const frontmatterBlock = afterOpen.slice(0, closeIdx.blockEnd);
  const body = afterOpen.slice(closeIdx.bodyStart);

  const frontmatter = parseFrontmatterBlock(frontmatterBlock);
  if (frontmatter.length === 0) {
    throw new SkillSourceParseError("skill source frontmatter is empty");
  }

  return { schema_version: SKILL_SOURCE_SCHEMA_VERSION, frontmatter, body };
}

/**
 * Locate the first standalone `---` line in the post-open text. Returns the
 * byte offset where the frontmatter block ends (`blockEnd`, exclusive of the
 * delimiter line) and where the body starts (`bodyStart`, just after the
 * delimiter line's trailing `\n`), or null if none is found.
 */
function findClosingDelimiter(
  afterOpen: string,
): { blockEnd: number; bodyStart: number } | null {
  let cursor = 0;
  while (cursor <= afterOpen.length) {
    const nl = afterOpen.indexOf("\n", cursor);
    const lineEnd = nl === -1 ? afterOpen.length : nl;
    const line = afterOpen.slice(cursor, lineEnd);
    if (line === "---") {
      // bodyStart is past the delimiter line's newline (if any).
      const bodyStart = nl === -1 ? afterOpen.length : nl + 1;
      return { blockEnd: cursor, bodyStart };
    }
    if (nl === -1) break;
    cursor = nl + 1;
  }
  return null;
}

/** Parse the raw frontmatter block (between delimiters) into ordered fields. */
function parseFrontmatterBlock(block: string): SkillSourceField[] {
  const fields: SkillSourceField[] = [];
  // The block is the text up to (not including) the closing `---` line. Split on
  // `\n`; the final element is the empty string before the delimiter line and is
  // dropped. Any genuinely blank frontmatter line is a non-conforming line → reject.
  const lines = block.split("\n");
  // Drop the trailing empty segment produced by the block's final `\n`.
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  for (const line of lines) {
    const m = FRONTMATTER_LINE.exec(line);
    if (!m) {
      throw new SkillSourceParseError(
        `non-conforming frontmatter line (must be \`key: value\`): ${JSON.stringify(line)}`,
      );
    }
    fields.push({ key: m[1], value: m[2] });
  }
  return fields;
}

// ---------------------------------------------------------------------------
// Render — AST → host-native (Claude) SKILL.md bytes
// ---------------------------------------------------------------------------

/**
 * Render a neutral skill source into the host-native (Claude) `SKILL.md` bytes.
 *
 * The Claude shape is: `---\n`, each frontmatter field as `key: value\n` in
 * source order, `---\n`, then the verbatim body. This is a CANONICAL
 * re-serialization (not a file copy) — the frontmatter is re-emitted from the
 * parsed AST, so a source whose frontmatter does not match Claude's exact
 * single-space `key: value` serialization will NOT round-trip, which is the
 * byte-identity guarantee working as intended (F-2).
 *
 * PURE: AST in, string out. No clock, no randomness, no I/O.
 */
export function renderClaudeSkill(src: SkillSource): string {
  const fm = src.frontmatter.map((f) => `${f.key}: ${f.value}\n`).join("");
  return `---\n${fm}---\n${src.body}`;
}

/** Convenience: parse neutral source text and render it to Claude bytes in one call. */
export function renderClaudeSkillFromSource(sourceText: string): string {
  return renderClaudeSkill(parseSkillSource(sourceText));
}

// ---------------------------------------------------------------------------
// Extract — committed SKILL.md → neutral source AST (the pure inverse)
// ---------------------------------------------------------------------------

/**
 * Extract a neutral skill source FROM a committed Claude `SKILL.md`'s text — the
 * pure inverse of `renderClaudeSkill`. This is the bootstrap LW2-2 (skill-author)
 * can seed `plugin/skill-src/<skill>/` sources from, and the oracle the
 * round-trip self-test uses: by construction `renderClaudeSkill(extractSkillSource(x))`
 * reproduces `x` byte-for-byte for any conforming `SKILL.md`.
 *
 * It is `parseSkillSource` with the same fail-closed contract — a committed
 * `SKILL.md` whose frontmatter is non-conforming cannot be sourced losslessly and
 * is surfaced as a parse error (escalate), never silently coerced.
 */
export function extractSkillSource(skillMdText: string): SkillSource {
  return parseSkillSource(skillMdText);
}

/**
 * Serialize a neutral skill source AST back to its on-disk `SKILL.src.md` text.
 * The neutral source's on-disk shape is identical to Claude's render for these
 * skills (frontmatter + body), so this is `renderClaudeSkill` — kept as a named
 * export so callers seeding sources read intent, not a coincidental alias.
 */
export function serializeSkillSource(src: SkillSource): string {
  return renderClaudeSkill(src);
}

// ---------------------------------------------------------------------------
// Staging I/O — render to a TEMP/STAGING path ONLY (never the live surface)
// ---------------------------------------------------------------------------

/**
 * The plugin repo root resolved INDEPENDENTLY of any caller — `scripts/lib` sits
 * two levels under the plugin root. The live-surface guard anchors to THIS, never
 * to a caller-supplied root (codex G-lane LW2-1-B: a caller could otherwise pass a
 * mismatched `pluginRoot` to slip a write into the live tree past the guard).
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
 * EXISTING ancestor (the target file itself may not exist yet). This defeats a
 * symlink-based bypass — e.g. a `stagingRoot` that is itself a symlink into the
 * live `skills/` tree resolves to the real live path and is rejected.
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
 *
 * A staging dir that merely contains a `skills`/`commands` segment outside the
 * real plugin tree (e.g. `/tmp/x/skills/…`) is fine — only the actual live roots
 * under `REAL_PLUGIN_ROOT` are forbidden.
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
 * Read a neutral skill source from `<srcRoot>/<skillId>/SKILL.src.md`, render it
 * to Claude bytes, and write the result to `<stagingRoot>/<skillId>/SKILL.md`.
 *
 * The staging target is guarded by `assertStagingPath` BEFORE any write — this is
 * the only function in this module that writes, and it can only ever write into a
 * staging/temp tree. The guard is anchored to an INDEPENDENTLY-resolved plugin
 * root, so even a caller passing the live `skills/` tree as `stagingRoot` (with any
 * `pluginRoot`) is rejected before `fs.writeFileSync` (LW2-1-B). Returns the
 * rendered bytes and the path written.
 *
 * `pluginRoot` is RETAINED for signature compatibility only — it is NOT trusted by
 * the guard (the live-surface decision uses the module's own resolved root).
 */
export function renderSkillToStaging(
  srcRoot: string,
  skillId: string,
  stagingRoot: string,
  pluginRoot: string = path.resolve(__dirname, "..", ".."),
): { outPath: string; bytes: string } {
  const srcPath = path.join(srcRoot, skillId, "SKILL.src.md");
  const sourceText = fs.readFileSync(srcPath, "utf8");
  const bytes = renderClaudeSkillFromSource(sourceText);

  const outDir = path.join(stagingRoot, skillId);
  const outPath = path.join(outDir, "SKILL.md");
  assertStagingPath(outPath, pluginRoot);

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outPath, bytes);
  return { outPath, bytes };
}

// ---------------------------------------------------------------------------
// CLI — render a source dir to a staging path (never the live surface)
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
  srcRoot: string;
  stagingRoot: string;
  skills: string[];
  pluginRoot: string;
}

export function parseCliArgs(
  argv: string[],
  defaults: { pluginRoot: string },
): CliArgs | { error: string } {
  let srcRoot: string | undefined;
  let stagingRoot: string | undefined;
  let skills: string[] = [...WAVE2_SKILL_IDS];
  const pluginRoot = defaults.pluginRoot;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--src" && argv[i + 1] !== undefined) srcRoot = argv[++i];
    else if (a.startsWith("--src=")) srcRoot = a.slice("--src=".length);
    else if (a === "--staging" && argv[i + 1] !== undefined) stagingRoot = argv[++i];
    else if (a.startsWith("--staging=")) stagingRoot = a.slice("--staging=".length);
    else if (a === "--skills" && argv[i + 1] !== undefined) skills = argv[++i].split(",").filter(Boolean);
    else if (a.startsWith("--skills=")) skills = a.slice("--skills=".length).split(",").filter(Boolean);
    else return { error: `unknown argument: ${a}` };
  }
  if (!srcRoot) return { error: "missing required --src <skill-src root>" };
  if (!stagingRoot) return { error: "missing required --staging <staging/temp root>" };
  return { srcRoot, stagingRoot, skills, pluginRoot };
}

function main(): number {
  const pluginRoot = path.resolve(__dirname, "..", "..");
  const parsed = parseCliArgs(process.argv.slice(2), { pluginRoot });
  if ("error" in parsed) {
    process.stderr.write(
      parsed.error +
        "\nusage: skill-source-transform.ts --src <skill-src root> --staging <temp root> [--skills a,b,c]\n" +
        "Renders neutral sources to a STAGING path only (never the live surface).\n",
    );
    return 1;
  }
  for (const skillId of parsed.skills) {
    try {
      const { outPath } = renderSkillToStaging(
        parsed.srcRoot,
        skillId,
        parsed.stagingRoot,
        parsed.pluginRoot,
      );
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
