#!/usr/bin/env -S npx tsx
/**
 * scripts/check-handoff-receipts.ts
 *
 * The receipt gate `guild:review` and `guild:verify-done` run before trusting
 * any lane receipt (#235). Every `*.md` under `.guild/runs/<run-id>/handoffs/`
 * must carry the five §8.2 `## <name>` sections and exactly one fenced
 * guild.handoff.v2 block that passes the strict validator
 * (execute-plan dispatch.md §"Handoff protocol"). No receipts is a refusal,
 * never a vacuous pass.
 *
 * Usage:
 *   node runtime/scripts/check-handoff-receipts.js [--cwd <root>] --run-id <id>
 *   node runtime/scripts/check-handoff-receipts.js --dir <handoffs-dir>
 *   node runtime/scripts/check-handoff-receipts.js --receipt <file>   (one lane's receipt)
 *
 * Stdout: one guild.handoff_receipt_check.v1 JSON object.
 * Exit:   0 — every receipt meets the contract; 1 — a receipt is refused or
 *         none exist; 2 — usage error.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { laneReceiptContractDefects } from "./lib/run-record-validate";
import { durableGuildDir } from "./lib/state/storage";

export const HANDOFF_RECEIPT_CHECK_SCHEMA = "guild.handoff_receipt_check.v1" as const;

export interface ReceiptCheck {
  file: string;
  ok: boolean;
  defects: string[];
}

export interface HandoffReceiptCheck {
  schema_version: typeof HANDOFF_RECEIPT_CHECK_SCHEMA;
  target: string;
  ok: boolean;
  receipts: ReceiptCheck[];
  error?: string;
}

export function checkHandoffReceipts(handoffsDir: string): HandoffReceiptCheck {
  const base = { schema_version: HANDOFF_RECEIPT_CHECK_SCHEMA, target: handoffsDir };
  let names: string[];
  try {
    names = fs.readdirSync(handoffsDir, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith(".md"))
      .map((e) => e.name)
      .sort();
  } catch {
    return { ...base, ok: false, receipts: [], error: "handoffs directory is missing or unreadable" };
  }
  if (names.length === 0) {
    return { ...base, ok: false, receipts: [], error: "no lane receipts in the handoffs directory" };
  }
  const receipts = names.map((file): ReceiptCheck => {
    let defects: string[];
    try {
      defects = laneReceiptContractDefects(fs.readFileSync(path.join(handoffsDir, file), "utf8"));
    } catch {
      defects = ["unreadable"];
    }
    return { file, ok: defects.length === 0, defects };
  });
  return { ...base, ok: receipts.every((r) => r.ok), receipts };
}

/** Gate one lane's receipt (execute-plan's per-lane step) without judging sibling lanes. */
export function checkHandoffReceipt(file: string): HandoffReceiptCheck {
  const base = { schema_version: HANDOFF_RECEIPT_CHECK_SCHEMA, target: file };
  let content: string;
  try {
    content = fs.readFileSync(file, "utf8");
  } catch {
    return { ...base, ok: false, receipts: [], error: "receipt is missing or unreadable" };
  }
  const defects = laneReceiptContractDefects(content);
  return { ...base, ok: defects.length === 0, receipts: [{ file: path.basename(file), ok: defects.length === 0, defects }] };
}

function main(argv: string[]): number {
  let cwd = process.cwd();
  let runId: string | null = null;
  let dir: string | null = null;
  let receipt: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--cwd") cwd = argv[++i] ?? cwd;
    else if (arg === "--run-id") runId = argv[++i] ?? null;
    else if (arg === "--dir") dir = argv[++i] ?? null;
    else if (arg === "--receipt") receipt = argv[++i] ?? null;
    else {
      process.stdout.write(JSON.stringify({ schema_version: HANDOFF_RECEIPT_CHECK_SCHEMA, target: "(usage)", ok: false, receipts: [], error: `unknown argument: ${arg}` }) + "\n");
      return 2;
    }
  }
  if ([runId, dir, receipt].filter((v) => v !== null).length !== 1) {
    process.stdout.write(JSON.stringify({ schema_version: HANDOFF_RECEIPT_CHECK_SCHEMA, target: "(usage)", ok: false, receipts: [], error: "exactly one of --run-id <id>, --dir <path>, --receipt <file> is required" }) + "\n");
    return 2;
  }
  if (runId !== null && (!/^[A-Za-z0-9._-]+$/.test(runId) || runId === "." || runId === "..")) {
    process.stdout.write(JSON.stringify({ schema_version: HANDOFF_RECEIPT_CHECK_SCHEMA, target: "(usage)", ok: false, receipts: [], error: "invalid --run-id" }) + "\n");
    return 2;
  }
  const result = receipt !== null
    ? checkHandoffReceipt(path.resolve(cwd, receipt))
    : checkHandoffReceipts(dir !== null
      ? path.resolve(cwd, dir)
      : path.join(durableGuildDir(path.resolve(cwd)), "runs", runId as string, "handoffs"));
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  return result.ok ? 0 : 1;
}

if (require.main === module) {
  process.exit(main(process.argv.slice(2)));
}
