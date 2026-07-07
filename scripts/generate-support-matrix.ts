/**
 * scripts/generate-support-matrix.ts
 *
 * verified-multi-host-support L5 (AC-RUN-3, ADR §8 step 7) — the CI matrix step.
 * Reads the COMMITTED smoke receipts (never re-runs smoke, ADR §6.5), generates the
 * support matrix stamped with the two-field honesty model, runs the AC-RUN-3
 * host-support gate via `validateSupportMatrix`, and writes the generated markdown.
 * Exits non-zero iff validation/gate fails. L6 wires this as build/verify step 7.
 *
 * Staleness is receipt-age-only against `--generated-at` (default: today). NO host
 * binary is shelled here.
 *
 * Usage:
 *   npx tsx generate-support-matrix.ts [--generated-at YYYY-MM-DD] [--out <path>] [--check]
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  generateSupportMatrix,
  renderSupportMatrixMarkdown,
  validateSupportMatrix,
} from "./lib/support-matrix";
import { loadCommittedReceipts } from "./lib/host-smoke-store";

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function main(): void {
  const generatedAt = arg("--generated-at") ?? new Date().toISOString();
  const out = arg("--out") ?? join(__dirname, "..", "docs", "generated", "host-support-matrix.md");
  const check = process.argv.includes("--check");

  const receipts = loadCommittedReceipts(undefined, (w) => console.warn(`generate-support-matrix: ${w}`));
  const matrix = generateSupportMatrix(generatedAt, receipts);
  const validation = validateSupportMatrix(matrix);

  const promoted = matrix.rows.filter((r) => r.has_valid_receipt).map((r) => `${r.host_id}=${r.current_public_state}`);
  console.log(`generate-support-matrix: ${matrix.rows.length} hosts · promoted: ${promoted.length ? promoted.join(", ") : "(none)"}`);

  if (!validation.valid) {
    console.error("host-support gate FAILED:");
    for (const e of validation.errors) console.error(`  - ${e}`);
    process.exit(1);
  }

  if (!check) {
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, renderSupportMatrixMarkdown(matrix));
    console.log(`generate-support-matrix: wrote ${out.replace(process.cwd(), ".")}`);
  } else {
    console.log("generate-support-matrix: gate PASS (--check, no file written)");
  }
}

if (require.main === module) main();
