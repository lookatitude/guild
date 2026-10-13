#!/usr/bin/env -S npx tsx
/**
 * wiki-revert.ts — the `maintain wiki revert <harvest_id>` handler (R54 / KTD39).
 *
 * Harvest is the only automatic wiki writer, so it is also the only thing that
 * needs an undo an operator can reach for without a git archaeology session. This
 * CLI replays the `guild.harvest_journal.v1` inverse for one op: the wiki page goes
 * back to the bytes it had before, the project playbook span goes back with it, and
 * the BM25 index is refreshed so the reverted page stops being recallable.
 *
 * It is deliberately NOT a git operation. Reverting a harvest must work on a dirty
 * tree, must not touch anything the operator has since edited by hand elsewhere,
 * and must never commit (R50: no auto-commit, in either direction).
 *
 *   npx tsx scripts/wiki-revert.ts <harvest_op_id> --run <run-id> [--cwd <dir>]
 *   npx tsx scripts/wiki-revert.ts --list --run <run-id>
 *
 * Exit 0 on a completed revert or a clean listing; exit 1 when the op is unknown,
 * has no recorded inverse, or the restore failed part-way (the output names which
 * files were already restored, so a retry is safe).
 */

import { revertHarvest } from "../src/domains/knowledge";
import { readHarvestJournal } from "../src/domains/knowledge";

interface Args {
  opId: string | null;
  runId: string | null;
  cwd: string | undefined;
  list: boolean;
}

export function parseArgs(argv: readonly string[]): Args {
  const out: Args = { opId: null, runId: null, cwd: undefined, list: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--list") out.list = true;
    else if (a === "--run") out.runId = argv[++i] ?? null;
    else if (a.startsWith("--run=")) out.runId = a.slice(6);
    else if (a === "--cwd") out.cwd = argv[++i];
    else if (a.startsWith("--cwd=")) out.cwd = a.slice(6);
    else if (!a.startsWith("-") && out.opId === null) out.opId = a;
  }
  return out;
}

const USAGE =
  "usage: wiki-revert <harvest_op_id> --run <run-id> [--cwd <dir>]\n" +
  "       wiki-revert --list --run <run-id>\n";

export function runWikiRevertCli(argv: string[] = process.argv.slice(2)): number {
  const args = parseArgs(argv);
  if (!args.runId) {
    process.stderr.write(`[wiki-revert] --run <run-id> is required\n${USAGE}`);
    return 1;
  }

  const opts = { cwd: args.cwd };

  if (args.list) {
    const journal = readHarvestJournal(args.runId, opts);
    if (journal.ops.length === 0) {
      process.stdout.write(`[wiki-revert] run ${args.runId} has no harvest ops\n`);
      return 0;
    }
    for (const op of journal.ops) {
      process.stdout.write(
        `${op.op_id}  ${op.status.padEnd(14)}  ${op.trigger.padEnd(20)}  ${op.wiki_path ?? "(no page)"}\n`,
      );
    }
    return 0;
  }

  if (!args.opId) {
    process.stderr.write(`[wiki-revert] a harvest op id is required\n${USAGE}`);
    return 1;
  }

  const result = revertHarvest(args.runId, args.opId, opts);
  if (!result.ok) {
    process.stderr.write(
      `[wiki-revert] could not revert ${args.opId}: ${result.detail ?? "unknown error"}\n` +
        (result.restored.length > 0
          ? `[wiki-revert] already restored: ${result.restored.join(", ")}\n`
          : ""),
    );
    return 1;
  }
  process.stdout.write(
    `[wiki-revert] reverted ${result.op_id}\n` +
      result.restored.map((p) => `  restored ${p}\n`).join(""),
  );
  return 0;
}

if (require.main === module) {
  process.exit(runWikiRevertCli());
}
