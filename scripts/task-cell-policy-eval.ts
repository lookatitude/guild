#!/usr/bin/env -S npx tsx

import * as fs from "node:fs";
import * as path from "node:path";

import {
  evaluateTaskCellPolicyPromotion,
  type TaskCellPolicyPromotionInput,
} from "../src/modules/evals";

function fail(message: string): never {
  process.stderr.write(`[task-cell-policy-eval] ${message}\n`);
  process.exit(2);
}

function main(argv: string[]): void {
  let inputFile: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--input" && i + 1 < argv.length) inputFile = argv[++i];
    else fail(`unknown or incomplete argument: ${argv[i]}`);
  }
  if (!inputFile) fail("--input <evaluation.json> is required");
  let input: unknown;
  try { input = JSON.parse(fs.readFileSync(path.resolve(inputFile), "utf8")); }
  catch (error) { fail(`cannot read evaluation input: ${error instanceof Error ? error.message : String(error)}`); }
  if (!input || typeof input !== "object") fail("evaluation input must be an object");
  const result = evaluateTaskCellPolicyPromotion(input as TaskCellPolicyPromotionInput);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exit(result.promote ? 0 : 1);
}

main(process.argv.slice(2));
