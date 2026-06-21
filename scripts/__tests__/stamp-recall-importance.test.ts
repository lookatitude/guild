/**
 * __tests__/stamp-recall-importance.test.ts — the write-time stamper CLI's tree walker
 * (the deterministic importance-at-ingest implementer).
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { stampWikiTree } from "../stamp-recall-importance";
import { parseRecallImportance } from "../lib/ingest-importance";

function mkWiki(pages: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "guild-stamp-"));
  const wiki = path.join(root, ".guild", "wiki");
  for (const [rel, content] of Object.entries(pages)) {
    const abs = path.join(wiki, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return wiki;
}
const FM = (extra = ""): string => `---\ntype: x\nowner: y${extra ? "\n" + extra : ""}\n---\n\nbody\n`;
const roots: string[] = [];
afterAll(() => roots.forEach((w) => fs.rmSync(path.dirname(path.dirname(w)), { recursive: true, force: true })));
const wiki = (p: Record<string, string>): string => { const w = mkWiki(p); roots.push(w); return w; };

describe("stampWikiTree — write-time persistence by category", () => {
  it("stamps each page with its category-derived 1–5 score", () => {
    const w = wiki({
      "decisions/d1.md": FM(),
      "standards/s1.md": FM(),
      "context/c1.md": FM(),
    });
    const r = stampWikiTree(w);
    expect(r.scanned).toBe(3);
    expect(r.stamped).toBe(3);
    expect(parseRecallImportance(fs.readFileSync(path.join(w, "decisions/d1.md"), "utf8"))).toBe(5);
    expect(parseRecallImportance(fs.readFileSync(path.join(w, "standards/s1.md"), "utf8"))).toBe(4);
    expect(parseRecallImportance(fs.readFileSync(path.join(w, "context/c1.md"), "utf8"))).toBe(2);
  });

  it("is idempotent — a second run stamps nothing new", () => {
    const w = wiki({ "decisions/d1.md": FM() });
    expect(stampWikiTree(w).stamped).toBe(1);
    const second = stampWikiTree(w);
    expect(second.stamped).toBe(0);
    expect(second.skipped).toBe(1);
  });

  it("dry-run writes NOTHING (anti-vacuity: a real run then DOES write)", () => {
    const w = wiki({ "decisions/d1.md": FM() });
    const dry = stampWikiTree(w, { dryRun: true });
    expect(dry.stamped).toBe(1);            // would stamp 1
    expect(dry.changedPaths).toEqual(["decisions/d1.md"]);
    // but the file on disk is untouched
    expect(parseRecallImportance(fs.readFileSync(path.join(w, "decisions/d1.md"), "utf8"))).toBeUndefined();
    // control: a real run actually persists
    stampWikiTree(w);
    expect(parseRecallImportance(fs.readFileSync(path.join(w, "decisions/d1.md"), "utf8"))).toBe(5);
  });

  it("skips a pinned page", () => {
    const w = wiki({ "decisions/d1.md": FM("recall_importance_pinned: true") });
    const r = stampWikiTree(w);
    expect(r.stamped).toBe(0);
    expect(r.skipped).toBe(1);
    expect(parseRecallImportance(fs.readFileSync(path.join(w, "decisions/d1.md"), "utf8"))).toBeUndefined();
  });

  it("empty / missing wiki → zero, no throw", () => {
    expect(stampWikiTree(path.join(os.tmpdir(), "does-not-exist-xyz"))).toMatchObject({ scanned: 0, stamped: 0 });
  });
});
