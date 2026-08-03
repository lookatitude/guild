/**
 * learn/lib/ignore.ts
 *
 * Zero-dependency .gitignore-syntax matcher. Forked Guild-native from the
 * Understand-Anything ignore-filter/ignore-generator (MIT — see
 * ../LICENSE-attribution.md). The `ignore` npm package is NOT used.
 *
 * Supports: # comments, blank lines, ! negation, trailing / (dir-only),
 * leading / (root-anchored), *, **, ? globs, basename matching when no slash.
 */

import * as fs from "fs";
import * as path from "path";

/** Forked default exclusions (Understand-Anything ignore-filter, MIT). */
export const DEFAULT_IGNORE_PATTERNS: readonly string[] = Object.freeze([
  "node_modules/", ".git/", "vendor/", "venv/", ".venv/", "__pycache__/",
  // Guild derived-index dir is never itself indexed (derived, rebuildable).
  // Any external/forked plugin's dotfolder is excluded by the user's
  // .guildignore, not hardcoded here (keeps the engine free of external refs).
  ".guild/",
  "dist/", "build/", "out/", "coverage/", ".next/", ".cache/", ".turbo/",
  "target/", "obj/",
  // Generated module-resource mirrors (src/modules/<id>/resources/**) are
  // byte-for-byte copies of first-party source (scripts/**, hooks/**) produced by
  // sync:module-resources for host packaging — exactly like dist/. Indexing them
  // duplicates every mirrored node (~31% of the graph) and makes each source file
  // look like it has an exact clone. Exclude the generated tree; the canonical
  // source is indexed from its real path.
  "src/modules/*/resources/",
  // Test directories and fixtures are not first-party knowledge — they must be
  // excluded from the cost-gate corpus AND from knowledge discovery so the two
  // share one policy (L13-fix BLOCKER 2 / L17 residual). Without `tests/` the
  // L12 re-run produced 43 nodes sourced from plugin tests/ (boundary, evolve,
  // shadow, wiki-lint READMEs + workspace/_fixtures.ts). These dir patterns use
  // trailing-slash (dirOnly) matching — same as fixtures/ — so they prune whole
  // subtrees, not just files with those names.
  "tests/", "test/", "__tests__/",
  "fixtures/", "testdata/", "__fixtures__/",
  "*.lock", "package-lock.json", "yarn.lock", "pnpm-lock.yaml",
  "*.png", "*.jpg", "*.jpeg", "*.gif", "*.svg", "*.ico", "*.woff", "*.woff2",
  "*.ttf", "*.eot", "*.mp3", "*.mp4", "*.pdf", "*.zip", "*.tar", "*.gz",
  "*.min.js", "*.min.css", "*.map", "*.generated.*",
  ".idea/", ".vscode/",
  "LICENSE", ".gitignore", ".editorconfig", ".prettierrc", ".eslintrc*", "*.log",
]);

interface Rule {
  re: RegExp;
  negated: boolean;
  dirOnly: boolean;
}

function globToRegExp(pattern: string): { source: string; dirOnly: boolean } {
  let p = pattern;
  const dirOnly = p.endsWith("/");
  if (dirOnly) p = p.slice(0, -1);

  const anchored = p.startsWith("/");
  if (anchored) p = p.slice(1);
  // No slash (after strip) → match by basename anywhere in the tree.
  const hasSlash = p.includes("/");

  let re = "";
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === "*") {
      if (p[i + 1] === "*") {
        // ** → any depth
        re += "(?:.*)";
        i++;
        if (p[i + 1] === "/") i++;
      } else {
        re += "[^/]*";
      }
    } else if (c === "?") {
      re += "[^/]";
    } else if ("\\^$.|+()[]{}".includes(c)) {
      re += "\\" + c;
    } else {
      re += c;
    }
  }

  let body: string;
  if (hasSlash || anchored) {
    body = "^" + re + (dirOnly ? "(?:/.*)?$" : "(?:/.*)?$");
  } else {
    // basename match at any directory level
    body = "(?:^|/)" + re + (dirOnly ? "(?:/.*)?$" : "(?:/.*)?$");
  }
  return { source: body, dirOnly };
}

export interface IgnoreFilter {
  isIgnored(relativePath: string): boolean;
}

function compile(patterns: string[]): Rule[] {
  const rules: Rule[] = [];
  for (const raw of patterns) {
    const line = raw.replace(/\r$/, "");
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    let body = trimmed;
    const negated = body.startsWith("!");
    if (negated) body = body.slice(1);
    const { source, dirOnly } = globToRegExp(body);
    rules.push({ re: new RegExp(source), negated, dirOnly });
  }
  return rules;
}

/**
 * Build a filter merging defaults + .guildignore (root) + .gitignore-derived.
 * Later patterns (and ! negation) override earlier ones.
 */
export function createIgnoreFilter(projectRoot: string): IgnoreFilter {
  const patterns: string[] = [...DEFAULT_IGNORE_PATTERNS];

  const rootIgnore = path.join(projectRoot, ".guildignore");
  if (fs.existsSync(rootIgnore)) {
    patterns.push(...fs.readFileSync(rootIgnore, "utf-8").split("\n"));
  }

  const rules = compile(patterns);

  return {
    isIgnored(relativePath: string): boolean {
      const rel = relativePath.replace(/\\/g, "/").replace(/^\.\//, "");
      let ignored = false;
      for (const rule of rules) {
        if (rule.re.test(rel)) ignored = !rule.negated;
      }
      return ignored;
    },
  };
}

const STARTER_HEADER = `# .guildignore — files/dirs excluded from the Guild understanding engine.
# Syntax: .gitignore-compatible (globs, # comments, ! negation, trailing / for dirs).
# Built-in defaults (always excluded unless ! negated):
#   node_modules/ .git/ dist/ build/ obj/ *.lock *.min.js binary assets, etc.
# Suggestions below are commented — uncomment to activate. One-time generation.
`;

const DETECTABLE_DIRS = [
  "__tests__/", "test/", "tests/", "fixtures/", "testdata/",
  "docs/", "examples/", "scripts/", "migrations/", ".storybook/",
];
const GENERIC_SUGGESTIONS = ["*.test.*", "*.spec.*", "*.snap"];

function isCoveredByDefaults(pattern: string): boolean {
  const norm = (s: string) => s.replace(/\/+$/, "");
  return DEFAULT_IGNORE_PATTERNS.some((d) => norm(d) === norm(pattern));
}

/** Forked starter-ignore generator (Understand-Anything ignore-generator, MIT). */
export function generateStarterIgnoreFile(projectRoot: string): string {
  const out: string[] = [STARTER_HEADER];

  const gitignorePath = path.join(projectRoot, ".gitignore");
  if (fs.existsSync(gitignorePath)) {
    const fromGit = fs
      .readFileSync(gitignorePath, "utf-8")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#") && !isCoveredByDefaults(l));
    if (fromGit.length) {
      out.push("\n# --- From .gitignore (uncomment to exclude) ---");
      for (const p of fromGit) out.push(`# ${p}`);
    }
  }

  const detected = DETECTABLE_DIRS.filter((d) =>
    fs.existsSync(path.join(projectRoot, d.replace(/\/$/, ""))),
  );
  if (detected.length) {
    out.push("\n# --- Detected directories (uncomment to exclude) ---");
    for (const d of detected) out.push(`# ${d}`);
  }

  out.push("\n# --- Test file patterns (uncomment to exclude) ---");
  for (const g of GENERIC_SUGGESTIONS) out.push(`# ${g}`);
  out.push("");

  return out.join("\n");
}
