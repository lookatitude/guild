#!/usr/bin/env -S npx tsx
/**
 * scripts/rollback-walker.ts
 *
 * `maintain rollback <skill> [n]` — the compact-history walker (KTD48 / R60).
 *
 * The retired implementation read a per-version snapshot tree under durable `.guild/`
 * and proposed restoring a whole file. Compact history replaced that tree: what is
 * recorded now is the INVERSE SPAN of each applied `guild.evolve_delta.v1` plus the
 * before/after hashes, so a rollback is span-scoped by construction and cannot
 * silently revert edits that landed after the delta.
 *
 * Two modes, and the default is the safe one:
 *
 *   (no --apply)  enumerate the stack and, with `--steps n`, print the
 *                 `proposed_rollback` block. Writes NOTHING.
 *   --apply       restore `n` inverse spans, newest first, through
 *                 `rollbackEvolve`. A span that drifted since the delta landed is
 *                 `blocked_confirm` — the walk stops there and nothing older is
 *                 touched, because restoring past a blocked entry would leave the
 *                 file in a state no entry describes.
 *
 * Usage:
 *   scripts/rollback-walker.ts --skill <slug> [--steps <n>] [--apply] [--cwd <path>]
 *
 * Reads:  the compact history for <slug> (runtime storage class, off the repo).
 * Writes: NOTHING without --apply; with it, only the named spans.
 *
 * Exit codes:
 *   0  Success.
 *   1  Bad input (missing --skill, no history, unreadable history, --steps past the oldest).
 *   2  A blocked_confirm step — a human must look at the drifted span.
 *
 * Invariant: never writes `.guild/wiki/`, never creates a durable version tree.
 */

import * as path from "path";

import { readCompactHistory, rollbackEvolve, type EvolveHistoryEntry } from "../src/domains/evolve";
import { ensureStorageLayout } from "./lib/state/ensure-storage-layout";

// ── CLI parsing ────────────────────────────────────────────────────────────

function parseArgs(argv: string[]): {
  skill: string | null;
  steps: number | null;
  apply: boolean;
  cwd: string;
} {
  let skill: string | null = null;
  let steps: number | null = null;
  let apply = false;
  let cwd = ".";
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--skill" && i + 1 < argv.length) skill = argv[++i];
    else if (argv[i] === "--apply") apply = true;
    else if (argv[i] === "--steps" && i + 1 < argv.length) {
      const parsed = parseInt(argv[++i], 10);
      if (!Number.isFinite(parsed) || parsed < 0) {
        process.stderr.write(`[rollback-walker] ERROR: --steps must be a non-negative integer\n`);
        process.exit(1);
      }
      steps = parsed;
    } else if (argv[i] === "--cwd" && i + 1 < argv.length) cwd = argv[++i];
  }
  return { skill, steps, apply, cwd };
}

// ── Formatting ─────────────────────────────────────────────────────────────

function formatTable(entries: readonly EvolveHistoryEntry[]): string {
  if (entries.length === 0) return "_No recorded deltas._";
  const lines: string[] = [];
  lines.push("| entry | at | target | span | proposer |");
  lines.push("|---|---|---|---|---|");
  // Newest first: that is the order a rollback walks.
  for (const e of [...entries].reverse()) {
    lines.push(`| ${e.entry_id} | ${e.at} | ${e.target} | ${e.span} | ${e.proposer} |`);
  }
  return lines.join("\n");
}

function formatProposedRollback(
  skill: string,
  entries: readonly EvolveHistoryEntry[],
  steps: number,
): string {
  const targets = [...entries].reverse().slice(0, steps);
  const lines: string[] = [];
  lines.push("proposed_rollback:");
  lines.push(`  skill: ${skill}`);
  lines.push(`  steps_back: ${steps}`);
  lines.push("  spans:");
  for (const t of targets) {
    lines.push(`    - entry_id: ${t.entry_id}`);
    lines.push(`      path: ${t.path}`);
    lines.push(`      span: ${t.span}`);
    lines.push(`      after_hash: ${t.after_hash}`);
  }
  lines.push("  note: re-run with --apply to restore these inverse spans (KTD48).");
  return lines.join("\n");
}

// ── Main ───────────────────────────────────────────────────────────────────

function main(): void {
  ensureStorageLayout(process.cwd(), { detectOnly: true });
  const { skill, steps, apply, cwd: cwdArg } = parseArgs(process.argv.slice(2));

  if (!skill) {
    process.stderr.write("[rollback-walker] ERROR: --skill <slug> is required\n");
    process.exit(1);
  }

  const cwd = path.resolve(cwdArg);
  // A history file that exists but will not parse now THROWS (fail-closed, KTD48):
  // treating it as an empty stack is what let the next record overwrite every
  // inverse. Surface it as a bad-input exit, never as "nothing to roll back".
  let history;
  try {
    history = readCompactHistory(skill, { cwd });
  } catch (err) {
    process.stderr.write(`[rollback-walker] ERROR: ${(err as Error).message}\n`);
    process.exit(1);
    return;
  }

  if (history.entries.length === 0) {
    process.stderr.write(`[rollback-walker] ERROR: no compact history for '${skill}' under ${cwd}\n`);
    process.exit(1);
  }

  process.stdout.write(`# Compact history — ${skill}\n\n`);
  process.stdout.write(formatTable(history.entries) + "\n");

  if (steps === null || steps === 0) {
    process.stderr.write(
      `[rollback-walker] ${history.entries.length} recorded delta(s) for ${skill}\n`,
    );
    process.exit(0);
  }
  if (steps > history.entries.length) {
    process.stderr.write(
      `[rollback-walker] ERROR: --steps ${steps} walks past the oldest entry ` +
        `(only ${history.entries.length} recorded)\n`,
    );
    process.exit(1);
  }

  if (!apply) {
    process.stdout.write("\n" + formatProposedRollback(skill, history.entries, steps) + "\n");
    process.exit(0);
  }

  let result;
  try {
    result = rollbackEvolve(skill, steps, { cwd });
  } catch (err) {
    process.stderr.write(`[rollback-walker] ERROR: ${(err as Error).message}\n`);
    process.exit(1);
    return;
  }
  process.stdout.write("\nrollback:\n");
  process.stdout.write(`  status: ${result.status}\n`);
  process.stdout.write("  steps:\n");
  for (const s of result.steps) {
    process.stdout.write(`    - entry_id: ${s.entry_id}\n`);
    process.stdout.write(`      status: ${s.status}\n`);
    process.stdout.write(`      detail: ${s.detail}\n`);
    if (s.question) process.stdout.write(`      question: ${s.question}\n`);
  }
  if (result.status === "blocked_confirm") {
    process.stderr.write(
      `[rollback-walker] blocked: a span drifted since the delta landed — review it, then re-run\n`,
    );
    process.exit(2);
  }
  process.stderr.write(`[rollback-walker] restored ${result.restored.length} span(s) for ${skill}\n`);
  process.exit(0);
}

main();
