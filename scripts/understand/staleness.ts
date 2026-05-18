#!/usr/bin/env -S npx tsx
/**
 * understand/staleness.ts — incremental fingerprint + staleness classifier.
 *
 * Default: classify the delta between the stored fingerprint baseline and the
 * working tree → SKIP | PARTIAL | ARCHITECTURE | FULL
 * (codebase-understanding.md §"Refresh/staleness"). Gated, never an always-on
 * auto-rebuild — this script only REPORTS the verdict; the skill (#24) /
 * reflection decides whether to act. Worktree-redirect safe: the baseline is
 * always read/written under the MAIN repo root (guildPaths).
 *
 * Modes:
 *   --baseline   write the fingerprint store from the current tree
 *   (default)    classify the change since the stored baseline
 * Usage: npx tsx staleness.ts [--cwd <path>] [--baseline] [--print]
 * Exit:  0 always (advisory). stdout = classifier state (or JSON with --print).
 */

import * as fs from "fs";
import * as path from "path";
import { guildPaths, parseCwd, hasFlag, writeJson, readJson } from "./lib/paths";
import { headSha } from "./lib/git";
import { walkRepo } from "./lib/walk";
import { isCodeLanguage, detectLanguage } from "./lib/languages";
import { buildStore, analyzeChanges, classify, type FingerprintStore } from "./lib/fingerprint";

function readTree(repoRoot: string): Record<string, string> {
  const { files } = walkRepo(repoRoot);
  const out: Record<string, string> = {};
  for (const rel of files) {
    if (!isCodeLanguage(detectLanguage(rel))) continue;
    try {
      out[rel] = fs.readFileSync(path.join(repoRoot, rel), "utf8");
    } catch { /* skip */ }
  }
  return out;
}

function main(): void {
  const argv = process.argv.slice(2);
  const cwd = parseCwd(argv);
  const gp = guildPaths(cwd);
  const commit = headSha(gp.repoRoot);
  const tree = readTree(gp.repoRoot);

  if (hasFlag(argv, "baseline")) {
    const store = buildStore(tree, commit);
    writeJson(gp.fingerprint, store);
    process.stderr.write(
      `[staleness] baseline written: ${Object.keys(store.files).length} files @ ${commit.slice(0, 8)} → ${path.relative(gp.repoRoot, gp.fingerprint)}\n`,
    );
    process.stdout.write("BASELINE\n");
    return;
  }

  const store = readJson<FingerprintStore>(gp.fingerprint);
  if (!store) {
    process.stderr.write("[staleness] no baseline — treat as FULL (run --baseline after a build)\n");
    const out = { state: "FULL", reason: "no fingerprint baseline", filesToReanalyze: Object.keys(tree), rerunArchitecture: true };
    if (hasFlag(argv, "print")) process.stdout.write(JSON.stringify(out, null, 2) + "\n");
    else process.stdout.write("FULL\n");
    return;
  }

  const analysis = analyzeChanges(store, tree);
  const knownFiles = Object.keys(store.files);
  const decision = classify(analysis, knownFiles.length, knownFiles);
  const staleVsHead = store.generated_from_commit !== commit;

  const out = {
    ...decision,
    baseline_commit: store.generated_from_commit,
    head_commit: commit,
    stale: staleVsHead,
    analysis: {
      new: analysis.newFiles.length,
      deleted: analysis.deletedFiles.length,
      structural: analysis.structural.length,
      cosmetic: analysis.cosmetic.length,
      unchanged: analysis.unchanged.length,
    },
  };
  process.stderr.write(
    `[staleness] ${decision.state} — ${decision.reason} (stale-vs-HEAD=${staleVsHead})\n`,
  );
  if (hasFlag(argv, "print")) process.stdout.write(JSON.stringify(out, null, 2) + "\n");
  else process.stdout.write(decision.state + "\n");
}

main();
