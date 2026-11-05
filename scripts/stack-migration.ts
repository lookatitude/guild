#!/usr/bin/env -S npx tsx
/**
 * scripts/stack-migration.ts — Guild Stack v1→v2 migration tooling (package A03).
 *
 * Usage: bun scripts/stack-migration.ts <inventory|plan|apply|verify|activate-readers|
 *        activate-writers|rollback|admit> --root <guild-root> [options]   (--help for all)
 *
 * inventory/plan write nothing. Every other write stays under
 * <root>/migrations/guild-stack-v2/. Author-plane only: not in the compiled
 * runtime/scripts list, so no user session can reach it before V01/D01/Z01.
 *
 * Exit codes: 0 ok · 1 usage · 2 refused.
 */

import { runCli } from "./lib/stack-migration";

process.exitCode = runCli(process.argv.slice(2), {
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
});
