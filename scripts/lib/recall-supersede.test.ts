/**
 * G12 R6 — recall drops wiki pages that another page supersedes.
 *
 * A page is superseded when its own frontmatter says `status: superseded`, or
 * when another page names it in `supersedes:` (wiki path, path without `.md`,
 * or bare slug). Every wiki branch (A sqlite, B file-BM25, C fsScan) must drop
 * it; the superseding page stays recallable. Anti-vacuity: the same old page
 * IS recalled when nothing supersedes it.
 */

import { describe, it, expect, afterAll } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { recall } from "./recall";

const TEMP_DIRS: string[] = [];
afterAll(() => {
  for (const d of TEMP_DIRS) fs.rmSync(d, { recursive: true, force: true });
});

function mkRepo(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "guild-recall-supersede-"));
  TEMP_DIRS.push(d);
  return d;
}

function write(repo: string, rel: string, content: string): void {
  const abs = path.join(repo, ".guild", "wiki", rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, "utf8");
}

const OLD = "---\ntype: decision\n---\n# Old cache policy\n\nThe zebra cache policy uses redis eviction.\n";
const newPage = (supersedes: string): string =>
  `---\ntype: decision\nsupersedes: ${supersedes}\n---\n# New cache policy\n\nThe zebra cache policy uses lru eviction.\n`;

type Branch = "A" | "B" | "C";
const BRANCH_OPTS: Record<Branch, Record<string, unknown>> = {
  A: { _indexConfig: { enabled: true, wiki_file_threshold: 1 } },
  B: { _indexConfig: { enabled: false } },
  C: { _indexConfig: { enabled: false }, _bm25Disabled: true },
};
const EXPECTED_SOURCE: Record<Branch, string> = { A: "sqlite", B: "file-bm25", C: "fs-scan" };

function recalledPaths(repo: string, branch: Branch): { source: string; paths: string[] } {
  const r = recall("zebra cache policy", { cwd: repo, _kgDisabled: true, ...BRANCH_OPTS[branch] });
  return { source: r.source, paths: r.chunks.map((c) => c.source_path) };
}

const OLD_REL = path.join(".guild", "wiki", "decisions", "old-cache.md");
const NEW_REL = path.join(".guild", "wiki", "decisions", "new-cache.md");

describe("G12 R6 — superseded wiki pages are not recalled", () => {
  for (const branch of ["A", "B", "C"] as Branch[]) {
    it(`branch ${branch}: anti-vacuity — the old page IS recalled when nothing supersedes it`, () => {
      const repo = mkRepo();
      write(repo, "decisions/old-cache.md", OLD);
      write(repo, "decisions/other.md", "# Other\n\nThe zebra cache policy notes.\n");
      const { source, paths } = recalledPaths(repo, branch);
      expect(source).toBe(EXPECTED_SOURCE[branch]);
      expect(paths).toContain(OLD_REL);
    });

    for (const ref of ["decisions/old-cache.md", "decisions/old-cache", "old-cache", ".guild/wiki/decisions/old-cache.md"]) {
      it(`branch ${branch}: a page named by another page's supersedes: (${ref}) is dropped; the superseding page stays`, () => {
        const repo = mkRepo();
        write(repo, "decisions/old-cache.md", OLD);
        write(repo, "decisions/new-cache.md", newPage(ref));
        const { source, paths } = recalledPaths(repo, branch);
        expect(source).toBe(EXPECTED_SOURCE[branch]);
        expect(paths).toContain(NEW_REL);
        expect(paths).not.toContain(OLD_REL);
      });
    }

    it(`branch ${branch}: a page whose own frontmatter says status: superseded is dropped`, () => {
      const repo = mkRepo();
      write(repo, "decisions/old-cache.md", OLD.replace("type: decision", "type: decision\nstatus: superseded"));
      write(repo, "decisions/new-cache.md", newPage("null"));
      const { paths } = recalledPaths(repo, branch);
      expect(paths).toContain(NEW_REL);
      expect(paths).not.toContain(OLD_REL);
    });
  }

  it("supersedes: null and status: active never drop a page", () => {
    const repo = mkRepo();
    write(repo, "decisions/old-cache.md", OLD.replace("type: decision", "type: decision\nstatus: active"));
    write(repo, "decisions/new-cache.md", newPage("null"));
    const { paths } = recalledPaths(repo, "B");
    expect(paths).toContain(OLD_REL);
    expect(paths).toContain(NEW_REL);
  });

  it("a superseded page does not consume a limit slot (limit counts live pages)", () => {
    const repo = mkRepo();
    write(repo, "decisions/old-cache.md", OLD.replace("redis eviction", "zebra zebra zebra cache cache policy policy"));
    write(repo, "decisions/new-cache.md", newPage("old-cache"));
    const r = recall("zebra cache policy", { cwd: repo, _kgDisabled: true, limit: 1, _indexConfig: { enabled: false } });
    expect(r.chunks.map((c) => c.source_path)).toEqual([NEW_REL]);
  });
});
