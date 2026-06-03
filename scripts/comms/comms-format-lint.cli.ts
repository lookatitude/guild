/**
 * scripts/comms/comms-format-lint.cli.ts
 *
 * Usage: npx tsx scripts/comms/comms-format-lint.cli.ts [--paths <file,...>]
 *        [--diff-range <base>...<head>] [--runs-dir <path>] [--enforce]
 *
 * CLI entry point for the comms-format lint (U5a warn-mode).
 * This file is the ONLY place that calls process.exit() — keeping the core
 * module (comms-format-lint.ts) pure/import-safe for hook bundling.
 *
 * Separation of concerns:
 *   comms-format-lint.ts  — pure library: exports lintCommsFormat + helpers.
 *                           Zero run-on-import side effects. Safe to import
 *                           into hooks/agent bundles (esbuild will not trigger
 *                           the CLI runner).
 *   comms-format-lint.cli.ts (THIS FILE) — thin CLI wrapper. Parses argv,
 *                           calls the core, prints findings, exits 0.
 *
 * CI workflow: .github/workflows/comms-format.yml invokes this file.
 * Hook bundle: imports comms-format-lint.ts directly (not this file).
 *
 * Owner: tooling-engineer.
 * Policy ref: docs/knowledge/decisions/communication-format-policy.md
 */

import { lintCommsFormat, printFindings, parseArgs } from "./comms-format-lint";

const opts = parseArgs(process.argv.slice(2));
const findings = lintCommsFormat(opts);
printFindings(findings);

// U5a: always exit 0 (non-blocking). The enforce flag is accepted for U5b
// compatibility but does NOT change the exit code in this lane.
process.exit(0);
