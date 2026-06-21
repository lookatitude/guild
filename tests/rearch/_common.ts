/**
 * tests/rearch/_common.ts — shared helpers for the re-architecture enforcement rails.
 *
 * These rails are runnable tsx scripts (NOT jest tests) so they can shell out to
 * git / esbuild and walk the whole plugin tree without ts-jest module mapping.
 * Each rail is self-contained and "anti-vacuous": it carries a `--prove` mode that
 * runs its detector against a known-bad synthetic input and asserts the detector
 * TRIPS. A rail whose `--prove` fails is itself broken (vacuous) and must not be
 * trusted green.
 *
 * Run a single rail:   cd tests && npx tsx rearch/r-dup.ts
 * Prove a single rail: cd tests && npx tsx rearch/r-dup.ts --prove
 * Run every rail:      cd tests && npx tsx rearch/run-all.ts
 */
import * as fs from "fs";
import * as path from "path";

/** Plugin repo root (tests/rearch/_common.ts → ../../ = plugin/). */
export const REPO = path.resolve(__dirname, "..", "..");

/** Directories that are never source — runtime state, deps, build output, the rails themselves. */
const EXCLUDE_SEGMENTS = new Set([
  "node_modules",
  ".guild",
  ".git",
  "dist",
  "build",
  ".next",
  ".cache",
  "fixtures",
]);

export interface RailResult {
  rail: string;
  /** true = rail is GREEN (no blocking violation). */
  pass: boolean;
  /** Advisory rails report but never block CI; strict rails block when pass=false. */
  advisory: boolean;
  violations: string[];
  notes: string[];
}

/** Recursively list files under `dir` whose name matches `match`, skipping EXCLUDE_SEGMENTS. */
export function walk(dir: string, match: (f: string) => boolean): string[] {
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
    // never descend into the rails' own dir — its source contains the dup signatures verbatim
    if (full === path.join(REPO, "tests", "rearch")) continue;
    if (e.isDirectory()) out.push(...walk(full, match));
    else if (match(e.name)) out.push(full);
  }
  return out;
}

/** Read a file, returning "" if it cannot be read. */
export function read(file: string): string {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

/** Relative-to-REPO path for stable reporting. */
export function rel(file: string): string {
  return path.relative(REPO, file);
}

/** Pretty-print a rail result and return its process exit code (0 green / 1 blocked). */
export function report(r: RailResult): number {
  const tag = r.advisory ? "ADVISORY" : "STRICT";
  const status = r.pass ? "GREEN ✓" : r.advisory ? "VIOLATIONS (advisory)" : "RED ✗";
  console.log(`\n[${r.rail}] (${tag}) — ${status}`);
  for (const n of r.notes) console.log(`  · ${n}`);
  for (const v of r.violations) console.log(`  ✗ ${v}`);
  // advisory rails never set a failing exit code; strict rails do when not green
  return !r.advisory && !r.pass ? 1 : 0;
}

/** Assertion used by `--prove` self-tests. Throws (non-zero exit) when the rail is vacuous. */
export function proveAssert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`  ✗ ANTI-VACUITY FAILURE: ${msg}`);
    throw new Error(`anti-vacuity proof failed: ${msg}`);
  }
  console.log(`  ✓ proven: ${msg}`);
}
