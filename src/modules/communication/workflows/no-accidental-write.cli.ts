/**
 * src/modules/communication/workflows/no-accidental-write.cli.ts
 *
 * Usage: npx tsx scripts/comms/no-accidental-write.cli.ts \
 *          --paths <abs-path,...> [--diff-range <base>...<head>] [--enforce]
 *
 * CLI entry point for the U7 AC-6 negative gate.
 * Thin wrapper around the pure checkAccidentalWrite() library function.
 *
 * Exit codes:
 *   0 — no violations (clean diff — protected surfaces untouched or format-correct)
 *   1 — one or more violations (accidental write to a protected surface detected)
 *
 * Without --enforce the gate prints violations as warnings and exits 0
 * (advisory / informational mode). With --enforce (or when invoked by CI)
 * it exits 1 on any violation (blocking mode).
 *
 * Pattern mirrors comms-format-lint.cli.ts (U5) — same --paths, --diff-range,
 * --enforce flags; same path-splitting on comma.
 *
 * Policy ref: docs/knowledge/decisions/communication-format-policy.md
 *   §"Invariants / non-goals" (the five protected surfaces)
 * Lib:        scripts/comms/no-accidental-write.ts
 * Owner:      tooling-engineer.
 */

import * as path from "path";
import { checkAccidentalWrite, AccidentalWriteViolation } from "./no-accidental-write";

// ── CLI argument parsing ──────────────────────────────────────────────────

interface CliOpts {
  paths: string[];
  diffRange?: string;
  enforce: boolean;
}

function parseArgs(args: string[]): CliOpts {
  const opts: CliOpts = { paths: [], enforce: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--paths" && args[i + 1]) {
      opts.paths = args[++i]
        .split(",")
        .map((p) => p.trim())
        .filter(Boolean)
        .map((p) => path.resolve(p));
    } else if (args[i] === "--diff-range" && args[i + 1]) {
      opts.diffRange = args[++i];
    } else if (args[i] === "--enforce") {
      opts.enforce = true;
    }
  }
  return opts;
}

// ── Output helpers ────────────────────────────────────────────────────────

function printViolation(v: AccidentalWriteViolation, enforce: boolean): void {
  const level = enforce ? "ERROR" : "WARN";
  const loc = v.line !== undefined ? `:${v.line}` : "";
  console.warn(
    `[no-accidental-write] ${level} [${v.surface}] ${v.file}${loc}: ${v.message}`
  );
}

// ── Main ──────────────────────────────────────────────────────────────────

export function main(args: string[] = process.argv.slice(2)): void {
  const opts = parseArgs(args);

  if (opts.paths.length === 0 && !opts.diffRange) {
    console.log("[no-accidental-write] No paths or diff-range provided — nothing to check.");
    process.exit(0);
  }

  const result = checkAccidentalWrite({
    paths: opts.paths,
    diffRange: opts.diffRange,
  });

  if (!result.hasViolations) {
    console.log(
      "[no-accidental-write] OK — no accidental writes to protected surfaces detected"
    );
    process.exit(0);
  }

  // Print violations
  for (const v of result.violations) {
    printViolation(v, opts.enforce);
  }

  if (opts.enforce) {
    console.error(
      `\n[no-accidental-write] FAIL — ${result.violations.length} violation(s) detected. ` +
        "A comms-format changeset must not alter the schema or format of protected surfaces. " +
        "See docs/knowledge/decisions/communication-format-policy.md §\"Invariants / non-goals\"."
    );
    process.exit(1);
  } else {
    console.warn(
      `\n[no-accidental-write] ADVISORY — ${result.violations.length} potential violation(s). ` +
        "Run with --enforce to make this gate blocking."
    );
    process.exit(0);
  }
}

// Guard: only run main() when invoked directly, not when imported
if (require.main === module) {
  main();
}
