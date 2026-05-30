#!/usr/bin/env npx tsx
/**
 * scripts/dot-guild/migrate-guild.ts — the `/guild:migrate` CLI wrapper around the
 * v1→v2 `.guild` converter pipeline (convert/index.ts → runMigration).
 *
 * The SessionStart hook (W1c) and an explicit `/guild:migrate` command both call
 * the SAME callable — `runMigration()` from ./convert. This file is the CLI face:
 * arg parsing + human-readable stdout. The library does the work.
 *
 * Usage:
 *   npx tsx plugin/scripts/dot-guild/migrate-guild.ts [--root=<path>] [--mode=migrate|dry-run|skip] [--workspace]
 *
 * Defaults: --root=cwd, --mode=dry-run (safe default — writes nothing).
 *   --mode=dry-run   detect + print the plan + write the report only; NO mutation.
 *   --mode=migrate   snapshot → convert → report (the in-place migration).
 *   --mode=skip      detect + report intent; no snapshot, no convert.
 *   --workspace      treat --root as a workspace; fan out per child .guild/ (SC-5).
 *
 * Exit codes: 0 normal; 1 on a snapshot-verify abort or a child error.
 */

import * as path from "path";
import { runMigration } from "./convert";
import type { Mode } from "./convert";

function main(): void {
  const args = process.argv.slice(2);
  const rootArg = args.find((a) => a.startsWith("--root="));
  const modeArg = args.find((a) => a.startsWith("--mode="));
  const workspace = args.includes("--workspace");

  const root = rootArg ? path.resolve(rootArg.split("=").slice(1).join("=")) : process.cwd();
  const rawMode = modeArg ? modeArg.split("=").slice(1).join("=") : "dry-run";
  if (rawMode !== "migrate" && rawMode !== "dry-run" && rawMode !== "skip") {
    process.stderr.write(`[migrate-guild] invalid --mode=${rawMode} (migrate|dry-run|skip)\n`);
    process.exit(1);
  }
  const mode = rawMode as Mode;

  const result = runMigration({ root, mode, workspace: workspace ? true : undefined });

  let exit = 0;
  for (const child of result.children) {
    const tag = result.workspace ? `[${child.root}] ` : "";
    process.stdout.write(`${tag}classification=${child.detect.classification} action=${child.action}\n`);
    if (child.snapshot) {
      process.stdout.write(
        `${tag}  snapshot: ${child.snapshot.destRel} (${child.snapshot.fileCount} file(s), ` +
          `${child.snapshot.verified ? "verified" : "VERIFY-FAILED"})\n`
      );
    }
    for (const a of child.artifacts) {
      process.stdout.write(`${tag}  ${a.disposition}: ${a.rel}${a.target ? ` → ${a.target}` : ""}\n`);
    }
    if (child.relocated.length)
      process.stdout.write(`${tag}  relocated ${child.relocated.length} key(s) → .unmigrated-v1.json\n`);
    if (child.conflicts.length)
      process.stdout.write(`${tag}  CONFLICTS (C4, kept LIVE): ${child.conflicts.map((c) => c.key).join(", ")}\n`);
    if (child.restoreCommand) process.stdout.write(`${tag}  restore: ${child.restoreCommand}\n`);
    if (child.action !== "none" && child.action !== "v2-noop")
      process.stdout.write(`${tag}  report: ${child.reportPath}\n`);
    if (child.error) {
      process.stderr.write(`${tag}  ERROR: ${child.error}\n`);
      exit = 1;
    }
  }

  if (result.children.every((c) => c.detect.classification === "none")) {
    process.stdout.write(`No .guild/ artifacts found — nothing to migrate.\n`);
  }
  process.exit(exit);
}

main();
