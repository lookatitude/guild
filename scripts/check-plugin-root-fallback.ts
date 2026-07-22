#!/usr/bin/env -S npx tsx
/**
 * scripts/check-plugin-root-fallback.ts
 *
 * CI regression rail for issue #36 (G1). `${GUILD_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT}}`
 * is host-render-time only — `CLAUDE_PLUGIN_ROOT` is substituted when the host renders
 * command markdown, but it is NOT exported to the Bash tool's shell. A skill-directed CLI
 * invocation using this two-level fallback with no terminal `$HOME` default expands to a
 * nonexistent path (`/scripts/...`) whenever both env vars are unset. The fix (PR #61,
 * porting PR #35) replaced every occurrence with the triple fallback
 * `${GUILD_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-$HOME/.local/share/guild/dist/claude-code}}`.
 * This rail forbids the two-level pattern from being reintroduced anywhere a command/skill
 * doc could document a CLI invocation.
 *
 * Usage:
 *   npx tsx scripts/check-plugin-root-fallback.ts [--cwd <path>]
 *
 * Options:
 *   --cwd <path>   (optional, default ".") Repo root to scan.
 *
 * Scans (relative to --cwd):
 *   src/modules/<module>/resources/{commands,skills}/**   (per-module resources SoT —
 *                                        commands/skills docs only; deliberately excludes
 *                                        resources/scripts/** so this checker's own mirrored
 *                                        copy, which necessarily quotes the forbidden pattern
 *                                        in its documentation and regex source, can never
 *                                        trip itself)
 *   commands/**                         (generated command mirror)
 *   skills/**                           (generated skill mirror)
 *   command-src/**                      (command registry SoT)
 *   skill-src/**                        (skill registry SoT)
 *
 * Exit codes:
 *   0  No violations found.
 *   1  One or more violations found; details written to stderr.
 *
 * Invariants:
 *   - Read-only. Never writes any file.
 *   - No network. All comparisons are local filesystem reads.
 *   - Deterministic given the same inputs.
 */

import * as fs from "fs";
import * as path from "path";

// ── Types ─────────────────────────────────────────────────────────────────

export interface Violation {
  /** Path relative to the scanned root. */
  file: string;
  /** 1-indexed line number. */
  line: number;
  /** The full line text containing the violation. */
  text: string;
}

// The forbidden two-level fallback: CLAUDE_PLUGIN_ROOT with no terminal $HOME default.
// The fixed form always continues past this point with `:-$HOME`, so this exact
// literal substring only ever matches the unfixed pattern.
const BAD_PATTERN = /\$\{GUILD_PLUGIN_ROOT:-\$\{CLAUDE_PLUGIN_ROOT\}\}/g;

// Directories that are never source — runtime state, deps, build output.
const EXCLUDE_SEGMENTS = new Set(["node_modules", ".git", "dist", "build"]);

// ── Scanning ─────────────────────────────────────────────────────────────

/** Recursively list every file under `dir`, skipping EXCLUDE_SEGMENTS. Missing dirs → []. */
function walkFiles(dir: string): string[] {
  const out: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (EXCLUDE_SEGMENTS.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walkFiles(full));
    else if (e.isFile()) out.push(full);
  }
  return out;
}

/** Resolve the target roots to scan, relative to `root`. */
function targetRoots(root: string): string[] {
  const roots: string[] = [];
  const modulesDir = path.join(root, "src", "modules");
  try {
    for (const mod of fs.readdirSync(modulesDir, { withFileTypes: true })) {
      if (!mod.isDirectory()) continue;
      // commands/skills docs only — NOT resources/scripts/**, which would otherwise
      // include this checker's own mirrored copy (see the file header for why).
      roots.push(path.join(modulesDir, mod.name, "resources", "commands"));
      roots.push(path.join(modulesDir, mod.name, "resources", "skills"));
    }
  } catch {
    // src/modules/ absent — nothing to add from this leg.
  }
  for (const rel of ["commands", "skills", "command-src", "skill-src"]) {
    roots.push(path.join(root, rel));
  }
  return roots;
}

function scanFile(absPath: string, relPath: string): Violation[] {
  let content: string;
  try {
    content = fs.readFileSync(absPath, "utf8");
  } catch {
    return []; // unreadable (e.g. binary/permission) — not a text doc, skip.
  }
  // Binary heuristic: a NUL byte means this isn't a text resource doc.
  if (content.includes("\0")) return [];

  const violations: Violation[] = [];
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    BAD_PATTERN.lastIndex = 0;
    if (BAD_PATTERN.test(lines[i])) {
      violations.push({ file: relPath, line: i + 1, text: lines[i].trim() });
    }
  }
  return violations;
}

/** Scan every target root under `root` for the forbidden two-level fallback pattern. */
export function findViolations(root: string): Violation[] {
  const violations: Violation[] = [];
  for (const dir of targetRoots(root)) {
    for (const absPath of walkFiles(dir)) {
      const relPath = path.relative(root, absPath);
      violations.push(...scanFile(absPath, relPath));
    }
  }
  // Deterministic ordering for stable output/tests.
  violations.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  return violations;
}

// ── CLI ──────────────────────────────────────────────────────────────────

function parseArgs(argv: string[]): { cwd: string } {
  let cwd = ".";
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--cwd" && i + 1 < argv.length) cwd = argv[++i];
  }
  return { cwd };
}

function main(): void {
  const { cwd: cwdArg } = parseArgs(process.argv.slice(2));
  const root = path.resolve(cwdArg);

  const violations = findViolations(root);

  if (violations.length === 0) {
    process.stdout.write(
      "[check-plugin-root-fallback] PASS — no two-level GUILD_PLUGIN_ROOT/CLAUDE_PLUGIN_ROOT fallback found.\n"
    );
    process.exit(0);
  }

  process.stderr.write(
    `[check-plugin-root-fallback] FAIL — ${violations.length} occurrence(s) of the forbidden two-level fallback ` +
      `(no terminal $HOME default). Use the triple fallback instead:\n` +
      `  \${GUILD_PLUGIN_ROOT:-\${CLAUDE_PLUGIN_ROOT:-$HOME/.local/share/guild/dist/claude-code}}\n\n`
  );
  for (const v of violations) {
    process.stderr.write(`  ${v.file}:${v.line}: ${v.text}\n`);
  }
  process.exit(1);
}

if (require.main === module) {
  main();
}
