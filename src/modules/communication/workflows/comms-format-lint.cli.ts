/**
 * src/modules/communication/workflows/comms-format-lint.cli.ts
 *
 * Usage: npx tsx scripts/comms/comms-format-lint.cli.ts [--paths <file,...>]
 *        [--diff-range <base>...<head>] [--runs-dir <path>] [--enforce]
 *
 * CLI entry point for the comms-format lint.
 * This file is the ONLY place that calls process.exit() — keeping the core
 * module (comms-format-lint.ts) pure/import-safe for hook bundling.
 *
 * Separation of concerns:
 *   comms-format-lint.ts  — pure library: exports lintCommsFormat + helpers.
 *                           Zero run-on-import side effects. Safe to import
 *                           into hooks/agent bundles (esbuild will not trigger
 *                           the CLI runner).
 *   comms-format-lint.cli.ts (THIS FILE) — thin CLI wrapper. Parses argv,
 *                           calls the core, prints findings, exits with the
 *                           appropriate code (0 = clean or warn-only;
 *                           1 = enforce mode with ≥1 finding).
 *
 * Exit-code policy (U5b):
 *   --enforce absent  → always exit 0 (warn-only, non-blocking; U5a behaviour)
 *   --enforce present → exit 1 if ≥1 finding; exit 0 if no findings
 *
 * The enforce exit decision is owned entirely by this CLI file. The core
 * (comms-format-lint.ts) remains a pure library: it returns findings and
 * never calls process.exit(). This preserves hook-bundle import safety.
 *
 * CI workflow: .github/workflows/comms-format.yml invokes this file.
 * Hook bundle: imports comms-format-lint.ts directly (not this file).
 *
 * Owner: tooling-engineer.
 * Policy ref: docs/knowledge/decisions/communication-format-policy.md
 */

import { lintCommsFormat, printFindings, parseArgs } from "./comms-format-lint";

export function main(args: string[] = process.argv.slice(2)): void {
  const opts = parseArgs(args);
  const findings = lintCommsFormat(opts);
  printFindings(findings);

  // U5b enforce gate: exit non-zero when --enforce is set AND findings exist.
  // Without --enforce, always exit 0 (warn-only; U5a behaviour preserved).
  if (opts.enforce && findings.length > 0) {
    console.error(
      `[comms-format-lint] ENFORCE: ${findings.length} violation(s) — blocking (U5b enforce mode, OD-4 scoped)`
    );
    process.exit(1);
  }

  process.exit(0);
}

if (require.main === module) {
  main();
}
