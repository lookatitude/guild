#!/usr/bin/env -S npx tsx
/**
 * scripts/validate-run-record.ts
 *
 * W5 (run-identity-and-dispatch): the REAL machine-readable CLI over the
 * shareable-run enforcement rail (lib/run-record-validate).
 *
 * Usage:
 *   npx tsx scripts/validate-run-record.ts [--cwd <root>] --run-id <id>
 *   npx tsx scripts/validate-run-record.ts [--cwd <root>] --dir <path>
 *   npx tsx scripts/validate-run-record.ts [--cwd <root>] --scan
 *
 * Stdout: ALWAYS one `guild.run_record_validation.v1` JSON object.
 * Exit:   0 — the target is share-eligible / the scan found nothing;
 *         1 — findings exist (invalid candidate or dumps present);
 *         2 — usage error (still machine-readable JSON on stdout).
 */

import * as path from "path";

import {
  RUN_RECORD_VALIDATION_SCHEMA,
  scanRunsRoot,
  validateRunRecordDir,
  type RunRecordValidation,
} from "./lib/run-record-validate";

function usageError(detail: string): RunRecordValidation {
  return {
    schema_version: RUN_RECORD_VALIDATION_SCHEMA,
    target: "(usage)",
    ok: false,
    findings: [{ code: "usage", path: "(argv)", detail }],
  };
}

function main(argv: string[]): number {
  let cwd = process.cwd();
  let runId: string | null = null;
  let dir: string | null = null;
  let scan = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--cwd") cwd = argv[++i] ?? cwd;
    else if (arg === "--run-id") runId = argv[++i] ?? null;
    else if (arg === "--dir") dir = argv[++i] ?? null;
    else if (arg === "--scan") scan = true;
    else {
      process.stdout.write(JSON.stringify(usageError(`unknown argument: ${arg}`)) + "\n");
      return 2;
    }
  }

  const targets = [runId !== null, dir !== null, scan].filter(Boolean).length;
  if (targets !== 1) {
    process.stdout.write(
      JSON.stringify(
        usageError("exactly one of --run-id <id>, --dir <path>, --scan is required")
      ) + "\n"
    );
    return 2;
  }

  const result: RunRecordValidation = scan
    ? scanRunsRoot(path.resolve(cwd))
    : validateRunRecordDir(
        dir !== null
          ? path.resolve(cwd, dir)
          : path.join(path.resolve(cwd), ".guild", "runs", runId as string)
      );

  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  return result.ok ? 0 : 1;
}

if (require.main === module) {
  process.exit(main(process.argv.slice(2)));
}
