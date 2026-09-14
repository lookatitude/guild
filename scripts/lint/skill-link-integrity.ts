#!/usr/bin/env -S npx tsx
/**
 * scripts/lint/skill-link-integrity.ts — every relative link inside `skills/**`
 * must resolve to a file that exists.
 *
 * WHY this exists: the T03 fold moved 34 skill bodies into `references/` chapters
 * of a different parent directory, which silently re-based every relative link
 * they carried. A skill body is prompt text — a dead `../../guild-operations/
 * operations-contract.md` does not throw, it just makes the model read nothing and
 * continue, so nothing in CI would ever have noticed. Codex G-lane r1 found one by
 * hand; this is the check that finds the rest, and the one that keeps the next
 * move honest.
 *
 * Scope: a relative target that points INTO one of the plugin's own surface trees
 * (`skills/ scripts/ src/ commands/ agents/ hooks/ templates/ tests/`). Absolute
 * URLs, in-page anchors and `${VAR}`-templated shell paths are not file links.
 * Neither is a RUNTIME path: a skill body that says `.guild/wiki/standards/…` or
 * `standards/branding.md` is naming a file in the CONSUMING project, which by
 * definition does not exist here — checking those would report ~70 permanent
 * false positives and the check would be ignored within a week.
 *
 * Usage:
 *   skill-link-integrity.ts [--root <pluginRoot>] [--json]
 *
 * Exit 0 every relative link resolves · 1 at least one is broken · 2 the tree
 * could not be read.
 */

import * as fs from "node:fs";
import * as path from "node:path";

const DEFAULT_ROOT = path.resolve(__dirname, "..", "..");

export interface BrokenLink {
  /** Repo-relative file holding the link, with its 1-based line number. */
  from: string;
  /** The link target exactly as written. */
  target: string;
  /** Repo-relative path the target resolved to. */
  resolved: string;
}

/** Markdown inline links `[text](target)`. */
const MD_LINK = /\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g;

/**
 * A BARE path-shaped `.md` reference — in a backtick span or in plain prose.
 *
 * Skill bodies cite their siblings far more often as bare pointers ("by pointer to
 * `../../guild-operations/operations-contract.md §…`") than as markdown links, and
 * every one of those is a real instruction to go read a file. Codex G-lane r1 found
 * the ops chapters this way, and a link-syntax-only checker reports zero on them.
 * Requires a `/` so a prose mention of `AGENTS.md` or `README.md` is not a path.
 */
const BARE_PATH = /(?:^|[\s`("'\u2018\u201c])((?:\.{1,2}\/|[\w.@+-]+\/)[\w.@+\/-]*\.md)/g;

/** The trees this repo actually ships. */
const SURFACE_TREES = /^(skills|scripts|src|commands|agents|hooks|templates|tests)\//;

/**
 * Is this target a pointer at a file in THIS repo?
 *
 * Two shapes count: an explicitly relative path (`./x.md`, `../../y.md`) and one
 * rooted at a surface tree (`skills/…`). A bare `standards/branding.md`,
 * `decisions/…`, `docs/…` or `.guild/…` is a RUNTIME path in the consuming
 * project — it is supposed not to exist here, and flagging it would bury the real
 * findings under ~70 permanent false positives.
 */
function isRepoPointer(target: string): boolean {
  return (
    target.startsWith("./") ||
    target.startsWith("../") ||
    // A skill's own L3 chapter, written bare: `references/learn-map.md`. This is
    // the single most common pointer shape after the fold — the assemblers'
    // chapter tables are made of it — so it has to be in scope or the check is
    // blind to exactly the links T03 created.
    target.startsWith("references/") ||
    SURFACE_TREES.test(target)
  );
}

function isSkippable(target: string): boolean {
  return (
    target.length === 0 ||
    target.startsWith("#") ||
    target.startsWith("mailto:") ||
    /^[a-z][a-z0-9+.-]*:\/\//i.test(target) ||
    target.includes("${") ||
    target.includes("<") ||
    target.includes("*")
  );
}

function walk(root: string, rel = "", out: string[] = []): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) walk(root, r, out);
    else if (e.isFile() && r.endsWith(".md")) out.push(r);
  }
  return out;
}

export function findBrokenSkillLinks(root: string = DEFAULT_ROOT): BrokenLink[] {
  const broken: BrokenLink[] = [];
  const skillsRoot = path.join(root, "skills");
  for (const rel of walk(skillsRoot)) {
    const abs = path.join(skillsRoot, rel);
    const fromRel = `skills/${rel}`;
    const lines = fs.readFileSync(abs, "utf8").split("\n");
    // A path inside a fenced block is sample output or a shell command, not a
    // pointer the model is told to follow (e.g. the `./migrations/2.4.md` inside
    // the release-notes skill's EXAMPLE changelog).
    let fenced = false;
    lines.forEach((line, i) => {
      if (/^\s*(```|~~~)/.test(line)) { fenced = !fenced; return; }
      if (fenced) return;
      const seen = new Set<string>();
      for (const m of [...line.matchAll(MD_LINK), ...line.matchAll(BARE_PATH)]) {
        const raw = m[1];
        if (seen.has(raw)) continue;
        seen.add(raw);
        if (isSkippable(raw)) continue;
        const target = raw.split("#")[0];
        if (target.length === 0 || !target.endsWith(".md")) continue;
        if (!isRepoPointer(target)) continue;
        // A target that starts at a repo top-level directory is root-relative; a
        // `./`- or `../`-prefixed one (or a bare sibling name) is file-relative.
        // A bare pointer can be written relative to the FILE or relative to the
        // repo root; both shapes are in the corpus, so a target that resolves
        // either way is fine and only a target that resolves NEITHER way is broken.
        const fromFile = path.resolve(path.dirname(abs), target);
        const fromRoot = path.join(root, target);
        if (fs.existsSync(fromFile) || fs.existsSync(fromRoot)) continue;
        const resolvedAbs = SURFACE_TREES.test(target) ? fromRoot : fromFile;
        broken.push({
          from: `${fromRel}:${i + 1}`,
          target: raw,
          resolved: path.relative(root, resolvedAbs).split(path.sep).join("/"),
        });
      }
    });
  }
  return broken;
}

function main(argv: string[]): number {
  let root = DEFAULT_ROOT;
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--root" && argv[i + 1] !== undefined) root = path.resolve(argv[++i]);
    else if (a.startsWith("--root=")) root = path.resolve(a.slice("--root=".length));
    else if (a === "--json") json = true;
    else {
      process.stderr.write(`unknown argument: ${a}\n`);
      return 2;
    }
  }
  if (!fs.existsSync(path.join(root, "skills"))) {
    process.stderr.write(`skill-link-integrity: no skills/ tree under ${root}\n`);
    return 2;
  }

  const broken = findBrokenSkillLinks(root);
  const scanned = walk(path.join(root, "skills")).length;
  if (json) {
    process.stdout.write(JSON.stringify({ scanned, broken }, null, 2) + "\n");
  } else {
    process.stdout.write(`skill-link-integrity — ${scanned} markdown files under skills/\n`);
    for (const b of broken) {
      process.stdout.write(`  BROKEN  ${b.from}  ${b.target}  ->  ${b.resolved}\n`);
    }
    process.stdout.write(
      broken.length === 0
        ? "every relative markdown link under skills/ resolves\n"
        : `${broken.length} broken relative link(s)\n`
    );
  }
  return broken.length === 0 ? 0 : 1;
}

if (require.main === module) {
  process.exit(main(process.argv.slice(2)));
}
