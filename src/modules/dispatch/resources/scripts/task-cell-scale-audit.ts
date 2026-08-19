#!/usr/bin/env -S npx tsx

import * as fs from "node:fs";
import * as path from "node:path";

import {
  auditTaskCellScaleRecords,
  type TaskCellScaleAuditInput,
} from "../src/modules/dispatch";

function fail(message: string): never {
  process.stderr.write(`[task-cell-scale-audit] ${message}\n`);
  process.exit(2);
}

function main(argv: string[]): void {
  let inputFile: string | null = null;
  for (let index = 0; index < argv.length; index++) {
    if (argv[index] === "--input" && index + 1 < argv.length) inputFile = argv[++index];
    else fail(`unknown or incomplete argument: ${argv[index]}`);
  }
  if (!inputFile) fail("--input <scale-audit.json> is required");
  let input: unknown;
  try { input = JSON.parse(fs.readFileSync(path.resolve(inputFile), "utf8")); }
  catch (error) { fail(`cannot read scale input: ${error instanceof Error ? error.message : String(error)}`); }
  if (!input || typeof input !== "object") fail("scale input must be an object");
  const result = auditTaskCellScaleRecords(input as TaskCellScaleAuditInput);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exit(result.ok ? 0 : 1);
}

main(process.argv.slice(2));
