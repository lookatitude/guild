#!/usr/bin/env -S npx tsx
// v1.4.0 — SC11 Codex review-trail completeness validator (qa-owned).
//
// Walks `.guild/runs/<run-id>/codex-review/*.md` (or the directory passed
// on the command line) and asserts every file's YAML frontmatter has
// `final_status:` set to one of the contract-allowed values:
//
//   - satisfied
//   - skipped-codex-unavailable
//
// Exit codes:
//   0 — every file's frontmatter has a recognised final_status; prints a
//       one-line summary to stdout.
//   1 — at least one file is missing the field, or the field has an
//       unrecognised value; prints the offending paths to stderr.
//   2 — usage error (missing/unreadable directory).
//
// USAGE
//
//   npx tsx scripts/verify-codex-review-trail.ts <codex-review-dir>
//
// EXAMPLE
//
//   npx tsx scripts/verify-codex-review-trail.ts \
//     .guild/runs/run-2026-04-27-v1.4.0-adversarial-loops/codex-review
//
// The validator is a small library too — `verifyCodexReviewTrail()`
// returns the structured result for callers that want to embed it in a
// larger pipeline (e.g., `verify-done`).

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/** Allowed final_status values per `.guild/wiki/standards/codex-adversarial-review.md`. */
export const ALLOWED_FINAL_STATUS = [
  "satisfied",
  "skipped-codex-unavailable",
] as const;

export type AllowedFinalStatus = (typeof ALLOWED_FINAL_STATUS)[number];

export interface FileResult {
  path: string;
  ok: boolean;
  finalStatus: string | null;
  reason: string | null;
}

export interface VerifyResult {
  ok: boolean;
  totalFiles: number;
  validFiles: number;
  invalidFiles: number;
  perFile: FileResult[];
}

/**
 * Extract the YAML frontmatter block from a markdown string.
 *
 * Frontmatter contract (per `guild-plan.md §8.2` + repo convention):
 * the file MUST start with a line equal to `---`, followed by KEY: VALUE
 * lines, terminated by another line equal to `---`. Anything between
 * the two `---` markers is the frontmatter.
 *
 * Returns `null` when no frontmatter delimiter is found.
 */
export function extractFrontmatter(text: string): string | null {
  const lines = text.split("\n");
  if (lines.length === 0) return null;
  if (lines[0].trim() !== "---") return null;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") {
      return lines.slice(1, i).join("\n");
    }
  }
  return null;
}

/**
 * Read the `final_status:` value from a frontmatter block. Returns
 * `null` when the key is absent. The value is trimmed but otherwise
 * returned verbatim (the validator decides whether it's allowed).
 *
 * Tolerant to whitespace around the colon (`final_status:satisfied`,
 * `final_status: satisfied`, `final_status:  satisfied  ` all return
 * `"satisfied"`). Quoted values are unquoted.
 */
export function readFinalStatus(frontmatter: string): string | null {
  for (const raw of frontmatter.split("\n")) {
    const line = raw.trimStart();
    if (!line.startsWith("final_status")) continue;
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    let value = line.slice(colonIdx + 1).trim();
    // Strip a single layer of single or double quotes if present.
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    return value;
  }
  return null;
}

/**
 * Validate a single codex-review markdown file. Returns a per-file
 * result; the caller aggregates across the directory.
 */
export function verifyOneFile(path: string): FileResult {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (err) {
    return {
      path,
      ok: false,
      finalStatus: null,
      reason: `read failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  const fm = extractFrontmatter(text);
  if (fm === null) {
    return {
      path,
      ok: false,
      finalStatus: null,
      reason: "no YAML frontmatter found (file must start with `---`)",
    };
  }
  const value = readFinalStatus(fm);
  if (value === null) {
    return {
      path,
      ok: false,
      finalStatus: null,
      reason: "frontmatter missing `final_status:` key",
    };
  }
  if (!(ALLOWED_FINAL_STATUS as readonly string[]).includes(value)) {
    return {
      path,
      ok: false,
      finalStatus: value,
      reason: `final_status: ${JSON.stringify(value)} not in allowed set ${JSON.stringify(ALLOWED_FINAL_STATUS)}`,
    };
  }
  return { path, ok: true, finalStatus: value, reason: null };
}

/**
 * Walk a codex-review directory and validate every `*.md` file's
 * frontmatter. Non-md files are ignored. Subdirectories are NOT
 * recursed (the contract is one-flat-directory per run).
 */
export function verifyCodexReviewTrail(dirPath: string): VerifyResult {
  if (!existsSync(dirPath) || !statSync(dirPath).isDirectory()) {
    return {
      ok: false,
      totalFiles: 0,
      validFiles: 0,
      invalidFiles: 0,
      perFile: [
        {
          path: dirPath,
          ok: false,
          finalStatus: null,
          reason: "directory does not exist or is not a directory",
        },
      ],
    };
  }
  const entries = readdirSync(dirPath).filter((n) => n.endsWith(".md"));
  // Stable order — alphabetical sort so `spec.md` and `plan.md` and
  // `lane-*` come out in a deterministic order across runs.
  entries.sort();
  const perFile: FileResult[] = [];
  let validFiles = 0;
  let invalidFiles = 0;
  for (const entry of entries) {
    const result = verifyOneFile(join(dirPath, entry));
    perFile.push(result);
    if (result.ok) validFiles += 1;
    else invalidFiles += 1;
  }
  return {
    ok: invalidFiles === 0,
    totalFiles: entries.length,
    validFiles,
    invalidFiles,
    perFile,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// CLI entrypoint — invoked via `npx tsx scripts/verify-codex-review-trail.ts`.
// ──────────────────────────────────────────────────────────────────────────

function isMainModule(): boolean {
  const arg1 = process.argv[1];
  if (!arg1) return false;
  return /verify-codex-review-trail\.[tj]s$/.test(arg1);
}

function cliMain(argv: string[]): number {
  const dirArg = argv[2];
  if (!dirArg) {
    process.stderr.write(
      "verify-codex-review-trail: usage: npx tsx scripts/verify-codex-review-trail.ts <codex-review-dir>\n",
    );
    return 2;
  }
  const result = verifyCodexReviewTrail(dirArg);
  if (result.totalFiles === 0 && !result.ok) {
    // Directory missing.
    for (const r of result.perFile) {
      process.stderr.write(`verify-codex-review-trail: ${r.path}: ${r.reason}\n`);
    }
    return 2;
  }
  if (result.ok) {
    process.stdout.write(
      `verify-codex-review-trail: OK (${result.validFiles}/${result.totalFiles} files have final_status in ${JSON.stringify(ALLOWED_FINAL_STATUS)})\n`,
    );
    return 0;
  }
  process.stderr.write(
    `verify-codex-review-trail: FAIL (${result.invalidFiles}/${result.totalFiles} files invalid)\n`,
  );
  for (const r of result.perFile) {
    if (r.ok) continue;
    process.stderr.write(`  ${r.path}: ${r.reason}\n`);
  }
  return 1;
}

if (isMainModule()) {
  process.exit(cliMain(process.argv));
}
