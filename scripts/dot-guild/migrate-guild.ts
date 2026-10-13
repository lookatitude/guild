#!/usr/bin/env npx tsx
/**
 * scripts/dot-guild/migrate-guild.ts — the `config migrate` CLI over the LAYOUT
 * UPGRADE CHAIN (U-UPG, R39).
 *
 * What changed under this name: the v1→v2 converter is no longer the thing this
 * CLI drives. It is now step `v1-content` inside a versioned, idempotent, resumable
 * chain that `ensureStorageLayout(cwd)` runs on activation of a root. So the honest
 * job left for a CLI is INSPECT and RETRY:
 *
 *   --mode=dry-run   (default) plan the chain, write NOTHING, print the report
 *   --mode=migrate   run or RESUME the chain — the retry entry after a block
 *   --mode=skip      report the layout state only; load no step
 *   --workspace      the ONE explicit child fan-out (the updater never scans disk)
 *   --accept-grades  unchanged: the human gate for the v1 wiki importance backfill
 *
 * Nothing here upgrades a root the operator did not name. Nothing here commits.
 *
 * Usage:
 *   npx tsx plugin/scripts/dot-guild/migrate-guild.ts [--root=<path>] [--mode=migrate|dry-run|skip] [--workspace]
 *   npx tsx plugin/scripts/dot-guild/migrate-guild.ts --accept-grades [--root=<path>]
 *
 * Exit codes: 0 when every named root reached `committed` or was already current;
 *             1 when any root is blocked or failed (so CI and the hook can see it).
 */

import * as fs from "fs";
import * as path from "path";

import { acceptGrades, realFs } from "./convert";
import { CURRENT_LAYOUT_VERSION, detect, ensureStorageLayout } from "../lib/state/ensure-storage-layout";

type Mode = "migrate" | "dry-run" | "skip";

/**
 * Immediate children of `root` that are Guild roots. Depth 1, on a root the
 * operator typed — this is the explicit fan-out, NOT a disk scan (§21.1).
 */
function childGuildRoots(root: string): string[] {
  let names: string[] = [];
  try {
    names = fs.readdirSync(root);
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const name of names) {
    if (name.startsWith(".")) continue;
    const child = path.join(root, name);
    try {
      if (!fs.lstatSync(child).isDirectory()) continue;
      if (fs.existsSync(path.join(child, ".guild"))) out.push(child);
    } catch {
      /* unreadable child: not ours to fix */
    }
  }
  return out;
}

function upgradeOne(root: string, mode: Mode, prefix: string): number {
  const before = detect(root);
  if (before.state === "absent") {
    process.stdout.write(`${prefix}no .guild/ at ${root} — nothing to migrate.\n`);
    return 0;
  }
  if (before.state === "current") {
    process.stdout.write(`${prefix}layout ${before.version} — already current (${CURRENT_LAYOUT_VERSION}).\n`);
    return 0;
  }
  if (mode === "skip") {
    process.stdout.write(`${prefix}layout ${before.version ?? "unmarked"} (${before.state}); chain not loaded.\n`);
    return 0;
  }

  let status;
  try {
    status = ensureStorageLayout(root, { dryRun: mode === "dry-run" });
  } catch (e) {
    // The `future` refusal lands here: a root ahead of this build is never
    // down-migrated, and saying so is the whole point of the exit code.
    process.stderr.write(`${prefix}${(e as Error).message}\n`);
    return 1;
  }

  const up = status.upgrade;
  if (!up) {
    process.stdout.write(`${prefix}layout ${status.version ?? "unmarked"} (${status.state}); no upgrade ran.\n`);
    return 0;
  }
  process.stdout.write(
    up.report
      .split("\n")
      .map((l) => prefix + l)
      .join("\n") + "\n",
  );
  if (mode === "dry-run") {
    process.stdout.write(`${prefix}dry run — nothing was written. Apply with: --mode=migrate\n`);
    return 0;
  }
  return up.state === "committed" ? 0 : 1;
}

function main(): void {
  const args = process.argv.slice(2);
  const rootArg = args.find((a) => a.startsWith("--root="));
  const modeArg = args.find((a) => a.startsWith("--mode="));
  const workspace = args.includes("--workspace");

  const root = rootArg ? path.resolve(rootArg.split("=").slice(1).join("=")) : process.cwd();

  // ── The gate accept verb (wiki-only, idempotent; no chain runs). ──
  if (args.includes("--accept-grades")) {
    const accepted = acceptGrades(realFs, path.join(root, ".guild"));
    if (accepted.length === 0) {
      process.stdout.write(`No drafted wiki importance grades pending — nothing to accept.\n`);
    } else {
      for (const a of accepted) {
        process.stdout.write(`accepted: ${a.rel} (importance: ${a.grade})\n`);
      }
      process.stdout.write(`Accepted ${accepted.length} drafted grade(s) — importance_draft/graded_by stripped, grades kept.\n`);
    }
    process.exit(0);
  }

  const rawMode = modeArg ? modeArg.split("=").slice(1).join("=") : "dry-run";
  if (rawMode !== "migrate" && rawMode !== "dry-run" && rawMode !== "skip") {
    process.stderr.write(`[migrate-guild] invalid --mode=${rawMode} (migrate|dry-run|skip)\n`);
    process.exit(1);
  }
  const mode = rawMode as Mode;

  const roots = workspace ? [root, ...childGuildRoots(root)] : [root];
  let exit = 0;
  for (const target of roots) {
    const prefix = roots.length > 1 ? `[${target}] ` : "";
    // A child failure must not abort its siblings.
    try {
      exit = upgradeOne(target, mode, prefix) === 0 ? exit : 1;
    } catch (e) {
      process.stderr.write(`${prefix}ERROR: ${(e as Error).message}\n`);
      exit = 1;
    }
  }
  process.exit(exit);
}

main();
