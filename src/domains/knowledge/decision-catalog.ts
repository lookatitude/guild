/**
 * decision-catalog.ts — the `index.md` / `log.md` half of a harvest promotion (#220).
 *
 * The decisions chapter promises that harvest "writes the page and the index/log
 * entries". Harvest wrote the page and refreshed the BM25 index only, so a
 * promoted decision was never linked from `wiki/index.md`. These helpers keep the
 * human catalog in step: promotion links the page under `## Decisions` and appends
 * one `log.md` heading; a revert that deletes the page drops the link again.
 *
 * Every write goes through the branded scrubbing writer, the same as the page, and
 * each target must pass `assertTarget` (this cwd's wiki, no symlink escape) first.
 * Idempotent: a resumed or repeated op adds no second link and no second log line.
 * Returns `null` on success, or why a write did not land: the caller must not
 * report the op complete on a catalog that was not updated.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { sanitizeForInjection } from "../security";
import type { WikiWriter } from "./harvest";
import { containsRecallTag } from "./recall-protect";

const DECISIONS_HEADING = "## Decisions";

export interface CatalogWriteCtx {
  writer: WikiWriter;
  runDir: string;
  runId: string;
  /** Throws when the target is outside this cwd's wiki. */
  assertTarget: (absPath: string) => void;
}

function write(absPath: string, content: string, ctx: CatalogWriteCtx): string | null {
  try {
    ctx.assertTarget(absPath);
  } catch (err) {
    return (err as Error).message;
  }
  const wrote = ctx.writer(absPath, content, { runDir: ctx.runDir, runId: ctx.runId });
  if (wrote.written) return null;
  return wrote.blocked ? `the secret scrub blocked the write to ${absPath}` : `the write to ${absPath} did not land`;
}

function readOr(p: string, fallback: string): string {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return fallback;
  }
}

function linkTarget(slug: string): string {
  return `(decisions/${slug}.md)`;
}

/** Insert `line` at the end of the `## Decisions` section, creating it when absent. */
function insertUnderDecisions(index: string, line: string): string {
  const lines = index.replace(/\n+$/, "").split("\n");
  const at = lines.findIndex((l) => l.trim() === DECISIONS_HEADING);
  if (at === -1) return `${lines.join("\n")}\n\n${DECISIONS_HEADING}\n\n${line}\n`;
  let end = at + 1;
  for (let i = at + 1; i < lines.length; i++) {
    if (/^#{1,2}\s/.test(lines[i]!)) break;
    if (lines[i]!.trim() !== "") end = i + 1;
  }
  if (end === at + 1) {
    lines.splice(end, 0, "", line);
  } else {
    lines.splice(end, 0, line);
  }
  return `${lines.join("\n")}\n`;
}

function appendLog(wikiRoot: string, entry: string, ctx: CatalogWriteCtx): string | null {
  const logPath = path.join(wikiRoot, "log.md");
  try {
    ctx.assertTarget(logPath);
  } catch (err) {
    return (err as Error).message;
  }
  const log = readOr(logPath, "# Wiki log\n");
  if (log.split("\n").some((l) => l === entry)) return null;
  return write(logPath, `${log.replace(/\n+$/, "")}\n\n${entry}\n`, ctx);
}

/** One-line title for the index bullet; never lets a newline stamp a second entry. */
function oneLine(title: string): string {
  return title.replace(/[\r\n]+/g, " ").replace(/[[\]]/g, "").trim();
}

export function recordDecisionPromotion(
  wikiRoot: string,
  page: { slug: string; title: string; date: string },
  ctx: CatalogWriteCtx,
): string | null {
  const indexPath = path.join(wikiRoot, "index.md");
  try {
    ctx.assertTarget(indexPath);
  } catch (err) {
    return (err as Error).message;
  }
  const index = readOr(indexPath, "# Wiki index\n");
  if (!index.includes(linkTarget(page.slug))) {
    const line = `- [${oneLine(page.title) || page.slug}]${linkTarget(page.slug)}`;
    // Screen the line as rendered: `oneLine` can join a title the page probe passed
    // into a directive, and a resumed op never re-probes the title.
    const probe = sanitizeForInjection(line);
    if (probe.result === "flagged" || containsRecallTag(line)) {
      return `directive language in the index entry (${probe.matchedPatterns.join(", ") || "recall tag"})`;
    }
    const failed = write(indexPath, insertUnderDecisions(index, line), ctx);
    if (failed) return failed;
  }
  return appendLog(wikiRoot, `## [${page.date}] promoted decision ${page.slug}`, ctx);
}

export function recordDecisionRevert(
  wikiRoot: string,
  page: { slug: string; date: string },
  ctx: CatalogWriteCtx,
): string | null {
  const indexPath = path.join(wikiRoot, "index.md");
  if (fs.existsSync(indexPath)) {
    try {
      ctx.assertTarget(indexPath);
    } catch (err) {
      return (err as Error).message;
    }
    const index = readOr(indexPath, "");
    const kept = index.split("\n").filter((l) => !(/^\s*[-*]\s/.test(l) && l.includes(linkTarget(page.slug))));
    const next = kept.join("\n");
    if (next !== index) {
      const failed = write(indexPath, next, ctx);
      if (failed) return failed;
    }
  }
  return appendLog(wikiRoot, `## [${page.date}] reverted decision ${page.slug}`, ctx);
}
