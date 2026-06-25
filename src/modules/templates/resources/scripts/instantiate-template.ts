#!/usr/bin/env -S npx tsx
/**
 * scripts/instantiate-template.ts
 *
 * P2 Wave-3 / LW3-5 (SC-W3-1 producer) — the **product-loop template producer** CLI.
 *
 * Thin, deterministic delegation over the LW3-1 instantiator: it loads a
 * `guild.template.v1` (by stable id from `templates/products/<id>.template.json`, or by an
 * explicit path), instantiates it via `instantiateTemplate` (scripts/lib/template-schema.ts),
 * DEFENSIVELY re-validates the produced pair with the W1 validators (validateExploreV1 /
 * validateDefineV1 — SC-W3-1: "the produced skeleton must pass them"), and writes a valid
 * `guild.explore.v1` + `guild.define.v1` skeleton pair under `.guild/`.
 *
 * NO NEW CONTRACT: every shape is owned upstream (template-schema / explore-schema /
 * define-schema). This CLI adds only file resolution + read/write + fail-closed exit codes.
 *
 * AC37 no-self-edit property is preserved: instantiation NEVER writes/edits a runtime
 * permission, skill, or agent file — this CLI writes ONLY to the run's `.guild/explore/` +
 * `.guild/define/` artifact dirs (or stdout). The pure core (`instantiateTemplate`) does no IO.
 *
 * Usage:
 *   npx tsx scripts/instantiate-template.ts <template-id|path-to.json> \
 *     [--slug=<slug>] [--out-dir=<dir>] [--cwd=<dir>] [--stdout] [--plugin-root=<dir>]
 *
 *   <template-id>   a bare id (e.g. "cli-tool") → templates/products/<id>.template.json
 *   path-to.json    an explicit template file path (contains "/" or ends ".json")
 *   --slug          output basename (default: the template id)
 *   --out-dir       artifact root (default: <cwd>/.guild) → writes <out-dir>/{explore,define}/<slug>.json
 *   --stdout        print the {explore, define} pair as JSON to stdout; write nothing
 *
 * Import-pure: NO process IO at module scope (the main guard at the bottom is the only
 * entrypoint). Pure helpers are exported for the LW3-6 eval harness.
 *
 * Owned by skill-author (LW3-5).
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { instantiateTemplate, type InstantiateResult } from "./lib/template-schema";
import { validateExploreV1 } from "./lib/explore-schema";
import { validateDefineV1 } from "./lib/define-schema";

// ---------------------------------------------------------------------------
// Pure core (no IO — exported for tests / the eval harness)
// ---------------------------------------------------------------------------

/**
 * Resolve a template reference to an absolute file path. A reference containing a path
 * separator OR ending in `.json` is treated as a literal path (resolved against cwd);
 * otherwise it is a STABLE template id ⇒ `<pluginRoot>/templates/products/<id>.template.json`.
 */
export function resolveTemplatePath(ref: string, pluginRoot: string, cwd: string): string {
  const looksLikePath = ref.includes("/") || ref.includes(path.sep) || ref.endsWith(".json");
  if (looksLikePath) return path.resolve(cwd, ref);
  return path.join(pluginRoot, "templates", "products", `${ref}.template.json`);
}

/**
 * Deep-reject a SPARSE array anywhere in `value` (a hole — an index `i < length` with no
 * own property). The W1/template validators iterate with `forEach`, which SKIPS holes, so a
 * sparse `acceptance_criteria`/`specialists` could pass validation yet serialize a `null`
 * (codex G-lane FINDING-1/2). JSON.parse never produces holes, so a file-sourced template is
 * unaffected; this only fails-closed a programmatically hand-built sparse input. Never throws
 * on hostile getters (own-key reads only).
 */
function assertDenseArrays(value: unknown, pathLabel = "template"): void {
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      if (!Object.prototype.hasOwnProperty.call(value, i)) {
        throw new Error(`sparse array hole at ${pathLabel}[${i}] — fail-closed (would serialize to null)`);
      }
      assertDenseArrays(value[i], `${pathLabel}[${i}]`);
    }
    return;
  }
  if (value && typeof value === "object") {
    for (const k of Object.getOwnPropertyNames(value)) {
      assertDenseArrays((value as Record<string, unknown>)[k], `${pathLabel}.${k}`);
    }
  }
}

/**
 * Produce the validated skeleton pair from a PARSED template object. Rejects sparse arrays
 * (fail-closed), delegates to the LW3-1 `instantiateTemplate` (which fails closed on an
 * invalid template), then DEFENSIVELY re-validates with the W1 validators. Throws
 * (fail-closed) if either artifact does not pass its W1 validator — the SC-W3-1 producer
 * guarantee, enforced in code not prose.
 *
 * @throws Error if the template is invalid OR a produced artifact fails its W1 validator.
 */
export function produceSkeletons(template: unknown): InstantiateResult {
  assertDenseArrays(template);
  const result = instantiateTemplate(template); // fail-closed on invalid template
  const ev = validateExploreV1(result.explore);
  const dv = validateDefineV1(result.define);
  if (!ev.valid || !dv.valid) {
    const parts: string[] = [];
    if (!ev.valid) parts.push(`explore: ${ev.errors.join("; ")}`);
    if (!dv.valid) parts.push(`define: ${dv.errors.join("; ")}`);
    throw new Error(`produced skeleton failed W1 validation — ${parts.join(" | ")}`);
  }
  return result;
}

/**
 * Read + parse a template file and produce the validated skeleton pair. `readFile` is
 * injectable for tests. Fails closed on a missing file or malformed JSON.
 *
 * @throws Error on read failure, malformed JSON, an invalid template, or a W1 validation miss.
 */
export function produceFromTemplateFile(
  templatePath: string,
  readFile: (p: string) => string = (p) => fs.readFileSync(p, "utf8")
): InstantiateResult {
  let raw: string;
  try {
    raw = readFile(templatePath);
  } catch (e) {
    throw new Error(`cannot read template file "${templatePath}": ${(e as Error).message}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`template file "${templatePath}" is not valid JSON: ${(e as Error).message}`);
  }
  return produceSkeletons(parsed);
}

// ---------------------------------------------------------------------------
// AC37 write-containment (the producer writes ONLY to .guild artifact dirs)
// ---------------------------------------------------------------------------

/**
 * A safe output basename: a single path segment, no separators, no `.`/`..`, no leading dot.
 * Kills slug-traversal (`--slug=../../skills/...`) and absolute-slug escapes (FINDING-3).
 *
 * @throws Error if `slug` is not a safe filename segment.
 */
export function safeSlug(slug: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(slug) || slug === "." || slug === "..") {
    throw new Error(`unsafe --slug "${slug}" — must be a single [A-Za-z0-9._-] filename segment`);
  }
  return slug;
}

/**
 * Resolve the real path of `targetDir` WITHOUT creating it — realpath the deepest existing
 * ancestor (so a symlinked ancestor is followed) then re-append the missing tail. Lets the
 * containment check see through a `.guild/explore -> ../skills/...` symlink BEFORE any mkdir
 * side effect (FINDING-3 symlink escape).
 */
function resolveRealTarget(targetDir: string): string {
  let cur = path.resolve(targetDir);
  const tail: string[] = [];
  while (!fs.existsSync(cur)) {
    tail.unshift(path.basename(cur));
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  const realBase = fs.existsSync(cur) ? fs.realpathSync(cur) : cur;
  return tail.length ? path.join(realBase, ...tail) : realBase;
}

/**
 * Runtime surface sub-trees the producer must NEVER write into, anchored at ANY repo root
 * (the plugin tree OR a consuming repo). These hold runtime permissions / skills / agents /
 * the live install surface — exactly what AC37 forbids the producer from self-editing. Kept
 * deliberately small + first-segment-anchored; `.claude/agents` is checked as a two-segment
 * special case below so an unrelated `.claude/settings` write is not over-blocked.
 */
const FORBIDDEN_FIRST_SEGMENTS = new Set([
  "skills",
  "agents",
  "commands",
  "hooks",
  ".claude-plugin",
  "dist",
]);

/**
 * Canonicalize a single path segment for the forbidden-subtree comparison, defeating
 * filesystem aliasing that resolves to the SAME directory as a forbidden name:
 *   - case-insensitivity (macOS/Windows): `Skills` → `skills`;
 *   - Win32 trailing-dot / trailing-space stripping: `skills.`, `skills `, `SKILLS. ` → `skills`
 *     (Windows ignores trailing `.`/space in a path component).
 * A leading dot is meaningful and preserved (`.skills` is a distinct dir, NOT forbidden;
 * `.claude` must stay `.claude`).
 */
function canonSegment(seg: string): string {
  return seg.toLowerCase().replace(/[. ]+$/, "");
}

/**
 * True iff `real` resolves INSIDE `root` and lands in a forbidden runtime sub-tree of it
 * (`skills/`, `agents/`, `commands/`, `hooks/`, `.claude-plugin/`, `dist/`, or `.claude/agents/`).
 * A target outside `root` (rel is "..", a "../…" traversal, or absolute) is NOT this root's
 * concern → false. A falsy `root` short-circuits to false. Never creates anything.
 */
function isForbiddenRuntimeSubtree(real: string, root: string | null | undefined): boolean {
  if (!root) return false;
  const realRoot = fs.existsSync(root) ? fs.realpathSync(root) : path.resolve(root);
  const rel = path.relative(realRoot, real);
  if (rel === ".." || rel.startsWith(".." + path.sep) || path.isAbsolute(rel)) return false; // outside this root
  const segs = rel === "" ? [] : rel.split(path.sep);
  const first = canonSegment(segs[0] ?? "");
  if (FORBIDDEN_FIRST_SEGMENTS.has(first)) return true;
  if (first === ".claude" && canonSegment(segs[1] ?? "") === "agents") return true; // .claude/agents/**
  return false;
}

/**
 * AC37 guard — refuse to write into any runtime surface, at the plugin root AND the consuming
 * repo root:
 *   1. POSITIVE plugin-root containment: a target INSIDE the plugin root is allowed ONLY when it
 *      is the `.guild` artifact tree (`<pluginRoot>/.guild/...`); everything else under the
 *      plugin root is refused (no list to keep in sync — a future runtime tree is denied too).
 *   2. CONSUMING-root deny-list (codex G-lane LW3-5 FINDING): a target outside the plugin root
 *      that lands in a forbidden runtime sub-tree of the **consuming repo** — `skills/`,
 *      `agents/`, `.claude/agents/`, `commands/`, `hooks/`, `.claude-plugin/`, `dist/` — is
 *      refused. This closes `--out-dir=skills` (which previously read as "outside pluginRoot →
 *      allowed" and wrote into the consuming repo's `skills/**`). The normal `.guild` target and
 *      arbitrary build dirs stay allowed.
 *
 * @throws Error if the (symlink-resolved) target is a runtime sub-tree of either root.
 */
export function assertNotRuntimeTree(
  targetDir: string,
  pluginRoot: string,
  consumingRoot?: string | null
): void {
  const real = resolveRealTarget(targetDir);
  // Realpath the plugin root too — else a symlinked root component (e.g. macOS
  // /var → /private/var) makes the resolved target read as "outside" and bypasses the guard.
  const realRoot = fs.existsSync(pluginRoot) ? fs.realpathSync(pluginRoot) : path.resolve(pluginRoot);
  const rel = path.relative(realRoot, real);
  // Genuinely OUTSIDE the plugin root: rel is "..", a "../…" traversal, or absolute (different
  // drive). NB: test the path SEGMENT, not `startsWith("..")` — a sibling dir literally named
  // "..guild" yields rel "..guild/…" which starts with ".." yet is INSIDE the root (must NOT escape).
  const outsidePluginRoot = rel === ".." || rel.startsWith(".." + path.sep) || path.isAbsolute(rel);
  if (!outsidePluginRoot) {
    // Inside the plugin root: ONLY the .guild artifact tree is a legitimate write target.
    const first = rel === "" ? "" : rel.split(path.sep)[0];
    if (first !== ".guild") {
      const where = first === "" ? "the plugin root itself" : `the plugin tree "${first}/"`;
      throw new Error(
        `refusing to write into ${where} (AC37 no-self-edit; only <pluginRoot>/.guild is writable): ${real}`
      );
    }
  }
  // Whether inside or outside the plugin root, refuse a forbidden runtime sub-tree of the
  // consuming repo (the AC37 self-edit surface the positive check above could not see).
  if (isForbiddenRuntimeSubtree(real, consumingRoot)) {
    throw new Error(
      `refusing to write into a consuming-repo runtime tree (AC37 no-self-edit; ` +
        `skills/agents/commands/hooks/.claude-plugin/dist/.claude/agents are forbidden): ${real}`
    );
  }
}

/**
 * Write the validated skeleton pair to `<outDir|.guild>/{explore,define}/<slug>.json`,
 * AC37-guarded against BOTH the plugin runtime tree and a consuming-repo runtime sub-tree.
 *
 * The guard runs BEFORE any `mkdir`/`writeFile`, so a forbidden target (e.g. `--out-dir=skills`)
 * throws with ZERO fs mutation — the property the LW3-6 / lane spy test asserts. The pair write
 * is near-atomic (temp + rename) and cleans up BOTH files on any failure (no partial pair).
 *
 * @throws Error (fail-closed) if the target is a runtime tree, the slug is unsafe, or a write fails.
 */
export function writeSkeletonPair(
  produced: InstantiateResult,
  opts: { cwd: string; pluginRoot: string; outDir?: string | null; slug: string }
): { explorePath: string; definePath: string } {
  const slug = safeSlug(opts.slug);
  const outRoot = path.resolve(opts.cwd, opts.outDir ?? ".guild");
  const exploreDir = path.join(outRoot, "explore");
  const defineDir = path.join(outRoot, "define");

  // AC37 containment — refuse a runtime-tree target (raw --out-dir, a consuming-repo
  // skills/agents subtree, or a symlink escape), BEFORE any mkdir side effect.
  assertNotRuntimeTree(exploreDir, opts.pluginRoot, opts.cwd);
  assertNotRuntimeTree(defineDir, opts.pluginRoot, opts.cwd);

  fs.mkdirSync(exploreDir, { recursive: true });
  fs.mkdirSync(defineDir, { recursive: true });
  // Re-check the realized dirs (a symlinked component created/encountered during mkdir).
  assertNotRuntimeTree(exploreDir, opts.pluginRoot, opts.cwd);
  assertNotRuntimeTree(defineDir, opts.pluginRoot, opts.cwd);

  const explorePath = path.join(exploreDir, `${slug}.json`);
  const definePath = path.join(defineDir, `${slug}.json`);

  // Near-atomic pair write: temp files + rename; clean up BOTH on any failure so a
  // partial pair never remains (FINDING-2 partial write).
  const exploreTmp = `${explorePath}.tmp`;
  const defineTmp = `${definePath}.tmp`;
  try {
    fs.writeFileSync(exploreTmp, JSON.stringify(produced.explore, null, 2) + "\n");
    fs.writeFileSync(defineTmp, JSON.stringify(produced.define, null, 2) + "\n");
    fs.renameSync(exploreTmp, explorePath);
    fs.renameSync(defineTmp, definePath);
  } catch (writeErr) {
    for (const p of [exploreTmp, defineTmp, explorePath, definePath]) {
      try {
        fs.rmSync(p, { force: true });
      } catch {
        /* best-effort cleanup */
      }
    }
    throw writeErr;
  }
  return { explorePath, definePath };
}

// ---------------------------------------------------------------------------
// Arg parsing (PURE — no process.env / process.cwd; main() resolves env defaults)
// ---------------------------------------------------------------------------

export interface ProducerArgs {
  ref: string | null;
  slug: string | null;
  outDir: string | null;
  /** Only set when `--cwd=` is passed; main() defaults it from the environment. */
  cwd: string | null;
  /** Only set when `--plugin-root=` is passed; main() defaults it from the environment. */
  pluginRoot: string | null;
  stdout: boolean;
}

/**
 * Parse `process.argv`-style tokens (everything after `node script.ts`). PURE: it reads NO
 * environment and NO cwd — identical argv ⇒ identical result (FINDING-4). `cwd`/`pluginRoot`
 * are null unless explicitly passed; `main()` applies the environment defaults. Never throws.
 */
export function parseProducerArgs(argv: string[]): ProducerArgs {
  const out: ProducerArgs = {
    ref: null,
    slug: null,
    outDir: null,
    cwd: null,
    pluginRoot: null,
    stdout: false,
  };
  for (const tok of argv) {
    if (tok === "--stdout") out.stdout = true;
    else if (tok.startsWith("--slug=")) out.slug = tok.slice("--slug=".length);
    else if (tok.startsWith("--out-dir=")) out.outDir = tok.slice("--out-dir=".length);
    else if (tok.startsWith("--cwd=")) out.cwd = tok.slice("--cwd=".length);
    else if (tok.startsWith("--plugin-root=")) out.pluginRoot = tok.slice("--plugin-root=".length);
    else if (!tok.startsWith("--") && out.ref === null) out.ref = tok;
  }
  return out;
}

// ---------------------------------------------------------------------------
// CLI entrypoint
// ---------------------------------------------------------------------------

function main(): void {
  const args = parseProducerArgs(process.argv.slice(2));
  if (!args.ref) {
    process.stderr.write(
      "usage: instantiate-template <template-id|path.json> [--slug=<s>] [--out-dir=<d>] [--cwd=<d>] [--stdout]\n"
    );
    process.exit(2);
  }

  // Environment defaults are resolved HERE (parseProducerArgs stays pure).
  const cwd = args.cwd ?? process.env.PWD ?? process.cwd();
  const pluginRoot = args.pluginRoot ?? process.env.CLAUDE_PLUGIN_ROOT ?? path.resolve(__dirname, "..");
  const templatePath = resolveTemplatePath(args.ref, pluginRoot, cwd);

  try {
    const produced = produceFromTemplateFile(templatePath);

    if (args.stdout) {
      process.stdout.write(JSON.stringify(produced, null, 2) + "\n");
      return;
    }

    // slug defaults to the template id (file basename minus `.template`); writeSkeletonPair
    // SAFE-checks it and AC37-guards the target before any fs mutation.
    const rawSlug =
      args.slug ?? path.basename(templatePath).replace(/\.template\.json$/, "").replace(/\.json$/, "");

    const { explorePath, definePath } = writeSkeletonPair(produced, {
      cwd,
      pluginRoot,
      outDir: args.outDir,
      slug: rawSlug,
    });
    process.stdout.write(`wrote ${explorePath}\nwrote ${definePath}\n`);
  } catch (e) {
    process.stderr.write(`error: ${(e as Error).message}\n`);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
