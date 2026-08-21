#!/usr/bin/env npx tsx
/**
 * scripts/dot-guild/scrub.ts — share-dot-guild scrubber (Decision H).
 *
 * Per-run: exclude events.ndjson + logs/payloads/** UNLESS share-payloads.flag present.
 * Surviving files: (1) operator-path redaction → <workspace-root>; (2) secrets-grep
 * from SECRET_PATTERNS (imported from docs-hygiene/scan.ts — not re-spelled here).
 * Idempotent + deterministic.
 *
 * Usage:
 *   npx tsx plugin/scripts/dot-guild/scrub.ts [--glob=<pattern>] [--dry-run] [--workspace=<path>]
 */

import * as fs from "fs";
import * as path from "path";
// Canonical single-source share-set membership (re-arch WAVE 1). audit.ts imports
// the same module — no "keep in sync" duplicate.
import { inShareSet, isPayloadFile } from "../lib/shared/share-set";
// Canonical single-source redaction applier (verified-multi-host-support L0 §6.4,
// security F1). The operator-path + tilde-Claude-path + secret-pattern logic lives
// in ONE module; audit.ts's package/receipt leak scan imports the SAME `redact` so
// the write path and the scan can never drift.
import { redactShareableFile } from "../lib/shared/scrub-redact";
// T4 dynamic-host-model-routing: the model-catalog discovery cache
// (.guild/indexes/model-catalog/ — guild.model_catalog.v1 §7) is runtime-local
// machine state (target-fingerprint-keyed snapshots + the fingerprint salt).
// It is NEVER in the git-shared set; this leg verifies the exclusion holds so
// a cache entry can never reach a shared tree unredacted. audit.ts carries the
// matching CI-gating coverage leg (both scrub-policy legs updated together).
import { spawnSync } from "child_process";
import {
  MODEL_CATALOG_CACHE_REL,
  modelCatalogCacheDir,
} from "../../src/modules/capability/workflows/catalog-cache";

function walkDir(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const results: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) results.push(...walkDir(full));
    else if (e.isFile()) results.push(full);
  }
  return results;
}

function findRunDirs(workspace: string, globHint?: string): string[] {
  if (globHint) {
    const normalized = globHint.replace(/\/$/, "");
    const parent = path.dirname(normalized);
    const leaf = path.basename(normalized);
    const abs = path.isAbsolute(normalized) ? parent : path.join(workspace, parent);
    if (!fs.existsSync(abs)) return [];
    return fs.readdirSync(abs, { withFileTypes: true })
      .filter(e => e.isDirectory() && (leaf === "*" || e.name === leaf))
      .map(e => path.join(abs, e.name));
  }
  const runsDir = path.join(workspace, ".guild", "runs");
  if (!fs.existsSync(runsDir)) return [];
  return fs.readdirSync(runsDir, { withFileTypes: true })
    .filter(e => e.isDirectory()).map(e => path.join(runsDir, e.name));
}

function processRun(runDir: string, dryRun: boolean): { files: number; changed: number; excluded: number; secrets: number } {
  const hasFlag = fs.existsSync(path.join(runDir, "share-payloads.flag"));
  let files = 0, changed = 0, excluded = 0, secretCount = 0;

  for (const absPath of walkDir(runDir)) {
    const rel = path.relative(runDir, absPath);
    if (!inShareSet(rel, hasFlag)) {
      if (isPayloadFile(rel) && !hasFlag) excluded++;
      continue;
    }
    let content: string;
    try { content = fs.readFileSync(absPath, "utf8"); } catch { continue; }
    const { out, opPaths, secrets } = redactShareableFile(content, rel);
    const didChange = out !== content;
    files++;
    if (didChange) changed++;
    secretCount += secrets.length;
    if (secrets.length > 0) {
      process.stderr.write(`[scrub] WARNING: ${path.basename(runDir)}/${rel}: ${secrets.length} secret(s) redacted — [${secrets.map(s => s.category).join(", ")}]. Rotate credentials.\n`);
    }
    if (dryRun && (didChange || secrets.length > 0)) {
      process.stdout.write(`  [dry-run] ${path.basename(runDir)}/${rel}: paths=${opPaths} secrets=${secrets.length}${didChange ? " [WOULD CHANGE]" : ""}\n`);
    }
    if (!dryRun && didChange) fs.writeFileSync(absPath, out, "utf8");
  }
  return { files, changed, excluded, secrets: secretCount };
}

/**
 * Model-catalog cache exclusion guard: warn loudly when any file under
 * .guild/indexes/model-catalog/ is git-trackable (i.e. would be shared).
 * The cache must stay runtime-local; the fix is the .gitignore deny line,
 * never redaction (cache entries are rebuildable and carry fingerprints).
 * Returns the number of trackable (leaking) cache files found.
 */
function warnTrackableModelCatalogCache(workspace: string): number {
  const cacheDir = modelCatalogCacheDir(workspace);
  const files = walkDir(cacheDir);
  if (files.length === 0) return 0;
  const rels = files.map((f) => path.relative(workspace, f));
  const checked = spawnSync("git", ["-C", workspace, "check-ignore", "--stdin", "-z"], {
    input: rels.join("\0"),
    encoding: "utf8",
  });
  if (checked.status === 128) return 0; // not a git repo — nothing can be shared
  const ignored = new Set((checked.stdout ?? "").split("\0").filter(Boolean));
  const leaking = rels.filter((r) => !ignored.has(r));
  for (const rel of leaking) {
    process.stderr.write(
      `[scrub] WARNING: ${rel}: model-catalog cache file is git-trackable — ` +
        `${MODEL_CATALOG_CACHE_REL}/ must stay runtime-local (restore the .gitignore deny).\n`
    );
  }
  return leaking.length;
}

function main(): void {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const wsArg = args.find(a => a.startsWith("--workspace="));
  const globArg = args.find(a => a.startsWith("--glob="));
  const workspace = wsArg ? wsArg.split("=")[1] : path.resolve(__dirname, "../../../..");
  const globHint = globArg ? globArg.split("=")[1] : undefined;
  const runDirs = findRunDirs(workspace, globHint);

  // T4: model-catalog cache exclusion guard (runs regardless of run dirs).
  warnTrackableModelCatalogCache(workspace);

  if (runDirs.length === 0) {
    process.stderr.write(`[scrub] No run dirs found under ${workspace}/.guild/runs/\n`);
    return;
  }

  let totalFiles = 0, totalChanged = 0, totalExcluded = 0, totalSecrets = 0;
  for (const runDir of runDirs) {
    const r = processRun(runDir, dryRun);
    totalFiles += r.files; totalChanged += r.changed; totalExcluded += r.excluded; totalSecrets += r.secrets;
  }
  const mode = dryRun ? "[dry-run]" : "[scrub]";
  process.stdout.write(`${mode} ${runDirs.length} run(s), ${totalFiles} file(s) in scope, ${totalExcluded} payload(s) excluded, ${totalChanged} changed, ${totalSecrets} secret(s) found.\n`);
}

main();
