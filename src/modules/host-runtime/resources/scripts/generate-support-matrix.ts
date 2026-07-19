/**
 * scripts/generate-support-matrix.ts
 *
 * verified-multi-host-support L5 (AC-RUN-3, ADR §8 step 7) — the CI matrix step.
 * Reads the COMMITTED smoke receipts (never re-runs smoke, ADR §6.5), generates the
 * support matrix stamped with the two-field honesty model, runs the AC-RUN-3
 * host-support gate via `validateSupportMatrix`, and writes or drift-checks the
 * generated markdown. Exits non-zero iff validation/gate or drift checking fails.
 * L6 wires this as build/verify step 7.
 *
 * Staleness is receipt-age-only against `--generated-at` (default: today). NO host
 * binary is shelled here.
 *
 * Usage:
 *   npx tsx generate-support-matrix.ts [--generated-at <stamp>] [--out <path>] [--check]
 *
 * `--generated-at` accepts a deliberately RESTRICTED subset of ISO-8601, not the full grammar:
 *     YYYY-MM-DD
 *     YYYY-MM-DDThh:mm:ss[.sss](Z|±hh:mm)
 * Calendar components are validated, so rollover inputs (2026-02-29, 2026-04-31) are REJECTED
 * rather than silently normalized to a different day — the stamp feeds receipt-age staleness.
 * Forms outside this subset (leap seconds `23:59:60`, basic offsets `+0130`, reduced precision
 * `T01:30`) are rejected on purpose: they are ambiguous to round-trip, and the only producer of
 * this field is this CLI. The invariant that matters: every value this CLI ACCEPTS must survive
 * generate -> --check at exit 0.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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

function parseGeneratedAt(): string {
  const provided = arg("--generated-at");
  const value = provided ?? new Date().toISOString();
  const isoDateOrTimestamp = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-](\d{2}):(\d{2})))?$/;
  const match = value.match(isoDateOrTimestamp);
  const parsed = new Date(value);
  const validDate = !Number.isNaN(parsed.valueOf());
  let validComponents = false;
  if (match && validDate) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const hour = Number(match[4] ?? 0);
    const minute = Number(match[5] ?? 0);
    const second = Number(match[6] ?? 0);
    const millisecond = Number((match[7] ?? "0").padEnd(3, "0"));
    const offsetSign = match[8]?.startsWith("-") ? -1 : 1;
    const offsetMinutes = offsetSign * (Number(match[9] ?? 0) * 60 + Number(match[10] ?? 0));

    const local = new Date(0);
    local.setUTCFullYear(year, month - 1, day);
    local.setUTCHours(hour, minute, second, millisecond);
    const componentsRoundTrip =
      local.getUTCFullYear() === year &&
      local.getUTCMonth() === month - 1 &&
      local.getUTCDate() === day &&
      local.getUTCHours() === hour &&
      local.getUTCMinutes() === minute &&
      local.getUTCSeconds() === second &&
      local.getUTCMilliseconds() === millisecond;
    validComponents = componentsRoundTrip && parsed.valueOf() === local.valueOf() - offsetMinutes * 60_000;
  }
  if (
    (process.argv.includes("--generated-at") && (!provided || provided.startsWith("--"))) ||
    !match ||
    !validDate ||
    !validComponents
  ) {
    throw new Error(
      `--generated-at must be an ISO-8601 date or timestamp with valid calendar and time components (no rollover); ` +
        `found ${JSON.stringify(provided)}`,
    );
  }
  return parsed.toISOString();
}

function normalizeGeneratedAt(markdown: string, label: string): string {
  const lines = markdown.split(/\r?\n/);
  const generatedLines = lines.filter((line) => line.startsWith("Generated:"));
  if (generatedLines.length !== 1) {
    throw new Error(`${label} must contain exactly one Generated: line; found ${generatedLines.length}`);
  }

  const generatedLine = generatedLines[0];
  const match = generatedLine.match(
    /^Generated: (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)$/,
  );
  const timestamp = match?.[1];
  const parsed = timestamp ? new Date(timestamp) : undefined;
  if (!timestamp || !parsed || Number.isNaN(parsed.valueOf()) || parsed.toISOString() !== timestamp) {
    throw new Error(
      `${label} Generated: line must be exactly one canonical ISO-8601 timestamp with no trailing content; ` +
        `found ${JSON.stringify(generatedLine)}`,
    );
  }

  return lines
    .map((line) => (line === generatedLine ? "Generated: <normalized>" : line))
    .join("\n");
}

function main(): void {
  let generatedAt: string;
  try {
    generatedAt = parseGeneratedAt();
  } catch (error) {
    console.error(`generate-support-matrix: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
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

  const rendered = renderSupportMatrixMarkdown(matrix);
  const displayOut = out.replace(process.cwd(), ".");
  if (!check) {
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, rendered);
    console.log(`generate-support-matrix: wrote ${displayOut}`);
  } else {
    if (!existsSync(out)) {
      console.error(`host-support matrix drift: committed matrix is missing at ${displayOut}`);
      console.error("  regenerate: cd scripts && npx tsx generate-support-matrix.ts");
      process.exit(1);
    }
    const committed = readFileSync(out, "utf8");
    let normalizedCommitted: string;
    let normalizedRendered: string;
    try {
      normalizedCommitted = normalizeGeneratedAt(committed, "committed matrix");
      normalizedRendered = normalizeGeneratedAt(rendered, "fresh render");
    } catch (error) {
      console.error(`host-support matrix metadata invalid: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
    if (normalizedCommitted !== normalizedRendered) {
      console.error(`host-support matrix drift detected: ${displayOut} differs from the fresh render`);
      console.error("  regenerate: cd scripts && npx tsx generate-support-matrix.ts");
      process.exit(1);
    }
    console.log("generate-support-matrix: gate PASS (--check, committed content matches; Generated timestamp ignored)");
  }
}

if (require.main === module) main();
