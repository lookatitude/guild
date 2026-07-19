#!/usr/bin/env -S npx tsx
/**
 * scripts/stamp-recall-importance.ts
 *
 * The WRITE-TIME importance-at-ingest implementer (docs/v2/knowledge-memory.html §Importance-at-ingest).
 * Scans `<guildDir>/wiki/**.md` and stamps each page with its 1–5 `recall_importance:`
 * frontmatter score (category-derived via `ingestImportanceScore`), so recall reads a
 * STABLE persisted weight instead of re-deriving it at every query.
 *
 * This is the deterministic implementer the spec named as missing ("no write-time
 * scorer assigns the 1–5 grade … in wiki-ingest or the learn pipeline"). It is CODE
 * (not skill prose): the wiki-ingest skill + the learn pipeline invoke this CLI; the
 * model never computes the grade itself. Idempotent + write-once: an already-stamped
 * or `recall_importance_pinned: true` page is left untouched unless `--force`.
 *
 * Gated by `models.importanceAtIngest` (default true) — `--respect-config` (the default
 * when invoked by tooling) makes it a no-op when the flag is off.
 *
 * Usage:
 *   npx tsx scripts/stamp-recall-importance.ts --cwd <repo> [--dry-run] [--force] [--no-config-gate]
 *   stdout: { scanned, stamped, skipped, dryRun, gated } JSON summary. Exit 0.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { ingestImportanceScore, stampRecallImportance } from "./lib/ingest-importance";

export interface StampTreeResult {
  scanned: number;
  stamped: number;
  skipped: number;
  changedPaths: string[];
  dryRun: boolean;
}

/** First path segment under wikiBase = the wiki category (`<wikiBase>/<category>/…`). */
function categoryFromWikiPath(absPath: string, wikiBase: string): string | undefined {
  const segs = path.relative(wikiBase, absPath).split(path.sep);
  return segs.length > 1 ? segs[0] : undefined;
}

/** Recursively collect `*.md` files under dir. */
function walkMd(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop()!;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(cur, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const p = path.join(cur, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.isFile() && e.name.endsWith(".md")) out.push(p);
    }
  }
  return out.sort();
}

/**
 * Stamp every wiki page under `wikiDir` with its category-derived 1–5
 * `recall_importance:` score. Idempotent (write-once unless `force`); skips
 * pinned pages. `dryRun` computes everything and writes nothing. Pure w.r.t.
 * inputs except the gated file writes.
 */
export function stampWikiTree(
  wikiDir: string,
  opts: { dryRun?: boolean; force?: boolean } = {},
): StampTreeResult {
  const dryRun = opts.dryRun ?? false;
  const files = walkMd(wikiDir);
  const result: StampTreeResult = { scanned: 0, stamped: 0, skipped: 0, changedPaths: [], dryRun };
  for (const file of files) {
    result.scanned++;
    let content: string;
    try { content = fs.readFileSync(file, "utf8"); } catch { result.skipped++; continue; }
    const score = ingestImportanceScore(categoryFromWikiPath(file, wikiDir));
    const stamped = stampRecallImportance(content, score, { force: opts.force ?? false });
    if (!stamped.changed) { result.skipped++; continue; }
    result.stamped++;
    result.changedPaths.push(path.relative(wikiDir, file));
    if (!dryRun) {
      try { fs.writeFileSync(file, stamped.content); }
      catch { result.stamped--; result.skipped++; result.changedPaths.pop(); }
    }
  }
  return result;
}

/** Read models.importanceAtIngest (default true) for the gate. Unreadable → true. */
function importanceAtIngestEnabled(cwd: string): boolean {
  try {
    const { resolveSettings } = require("./lib/settings-resolver") as typeof import("./lib/settings-resolver");
    const models = (resolveSettings({ cwd }).config as { models?: { importanceAtIngest?: boolean } }).models;
    return models?.importanceAtIngest !== false;
  } catch { return true; }
}

function main(): void {
  const argv = process.argv.slice(2);
  const get = (flag: string): string | undefined => {
    const hit = argv.find((a) => a === flag || a.startsWith(`${flag}=`));
    if (!hit) return undefined;
    return hit.includes("=") ? hit.slice(hit.indexOf("=") + 1) : "true";
  };
  const cwd = get("--cwd") ?? process.env["PWD"] ?? process.cwd();
  const dryRun = !!get("--dry-run");
  const force = !!get("--force");
  const configGate = !get("--no-config-gate"); // default: respect models.importanceAtIngest

  const gated = configGate && !importanceAtIngestEnabled(cwd);
  if (gated) {
    process.stdout.write(JSON.stringify({ scanned: 0, stamped: 0, skipped: 0, dryRun, gated: true }) + "\n");
    return;
  }

  const wikiDir = path.join(cwd, ".guild", "wiki");
  const r = stampWikiTree(wikiDir, { dryRun, force });
  process.stdout.write(JSON.stringify({ ...r, gated: false }) + "\n");
}

if (require.main === module) {
  main();
}
