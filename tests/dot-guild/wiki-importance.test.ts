/**
 * tests/dot-guild/wiki-importance.test.ts
 *
 * Unit tests for the wiki importance backfill converter row + the human gate
 * (scripts/dot-guild/convert/wiki-importance.ts), following the convert.test.ts
 * fixture style: fully in-memory injectable Fs, fixedClock, deterministic.
 *
 * Contract under test:
 *  - ungraded page → drafted grade + importance_draft: true + graded_by: guild-migrate
 *  - heuristics: standards/** high · architecture-map high · decisions/** high ·
 *    type: decision high · everything else medium
 *  - already-graded page → NEVER touched (byte-identical)
 *  - provenance/exploratory page → skipped (confidence-graded only)
 *  - structural pages (index/README/log/lint-*) → skipped
 *  - frontmatter-less page → block created
 *  - dry-run → records computed, NOTHING written
 *  - acceptGrades → strips importance_draft + graded_by, KEEPS the grade
 *  - listDraftGrades → pending pages until accepted
 *  - report ends with the drafted-grades review table + accept instruction
 */

import * as path from "path";
import {
  runMigration,
  backfillWikiImportance,
  acceptGrades,
  listDraftGrades,
} from "../../scripts/dot-guild/convert/index";
import { fixedClock } from "../../scripts/dot-guild/convert/seams";
import type { Fs, Clock } from "../../scripts/dot-guild/convert/types";

// ── In-memory Fs (trimmed copy of the convert.test.ts helper) ────────────────

type FileMap = Record<string, string | Buffer>;

function buildFs(files: FileMap = {}): Fs {
  const store = new Map<string, Buffer>();
  for (const [p, v] of Object.entries(files)) {
    store.set(p, typeof v === "string" ? Buffer.from(v, "utf8") : v);
  }

  function getDirs(): Set<string> {
    const dirs = new Set<string>();
    for (const p of store.keys()) {
      let cur = path.dirname(p);
      while (cur !== path.dirname(cur)) {
        dirs.add(cur);
        cur = path.dirname(cur);
      }
    }
    return dirs;
  }

  const fs: Fs = {
    existsSync(p: string): boolean {
      return store.has(p) || getDirs().has(p);
    },
    readFileSync(p: string): string {
      const buf = store.get(p);
      if (!buf) throw new Error(`ENOENT: ${p}`);
      return buf.toString("utf8");
    },
    readBytes(p: string): Buffer {
      const buf = store.get(p);
      if (!buf) throw new Error(`ENOENT: ${p}`);
      return buf;
    },
    writeFileSync(p: string, data: string): void {
      store.set(p, Buffer.from(data, "utf8"));
    },
    writeBytes(p: string, data: Buffer): void {
      store.set(p, data);
    },
    mkdirSync(p: string, opts: { recursive: boolean }): void {
      if (!opts.recursive) {
        if (getDirs().has(p) || store.has(p)) {
          const err = new Error(`EEXIST: mkdir '${p}'`) as NodeJS.ErrnoException;
          err.code = "EEXIST";
          throw err;
        }
        store.set(p + "/__dir__", Buffer.alloc(0));
      }
    },
    rmFileSync(p: string): void {
      store.delete(p);
    },
    readdirSync(p: string): Array<{ name: string; isDirectory: boolean; isFile: boolean }> {
      const dirs = getDirs();
      if (!dirs.has(p) && !store.has(p + "/__dir__")) throw new Error(`ENOENT: ${p}`);
      const direct = new Map<string, { isDirectory: boolean; isFile: boolean }>();
      for (const k of store.keys()) {
        if (path.dirname(k) === p) {
          const name = path.basename(k);
          if (name === "__dir__") continue;
          direct.set(name, { isDirectory: false, isFile: true });
        }
      }
      for (const d of dirs) {
        if (path.dirname(d) === p && !direct.has(path.basename(d))) {
          direct.set(path.basename(d), { isDirectory: true, isFile: false });
        }
      }
      return Array.from(direct.entries()).map(([name, stat]) => ({ name, ...stat }));
    },
    isSymlink(): boolean {
      return false;
    },
    sha256(p: string): string {
      const { createHash } = require("crypto");
      const buf = store.get(p);
      if (!buf) throw new Error(`ENOENT: ${p}`);
      return createHash("sha256").update(buf).digest("hex");
    },
  };
  return fs;
}

const ROOT = "/repo";
const GUILD = path.join(ROOT, ".guild");
const WIKI = path.join(GUILD, "wiki");
const ISO = "2026-06-11T12:00:00.000Z";
const clock: Clock = fixedClock(ISO);

const FM = (extra = "") =>
  `---\ntype: standard\nowner: orchestrator\nconfidence: high\n${extra}created_at: 2026-01-01\nupdated_at: 2026-01-01\nsensitivity: internal\n---\n\n# Page\n\nBody text.\n`;

function rec(records: ReturnType<typeof backfillWikiImportance>, rel: string) {
  return records.find((r) => r.rel === rel);
}

// ─────────────────────────────────────────────────────────────────────────────

describe("wiki importance backfill — grading heuristics", () => {
  test("ungraded standards page → high + draft markers; body preserved", () => {
    const p = path.join(WIKI, "standards/release-discipline.md");
    const fs = buildFs({ [p]: FM() });
    const records = backfillWikiImportance(fs, GUILD, false);
    const r = rec(records, "wiki/standards/release-discipline.md");
    expect(r?.action).toBe("graded");
    expect(r?.grade).toBe("high");
    const out = fs.readFileSync(p);
    expect(out).toMatch(/^importance: high$/m);
    expect(out).toMatch(/^importance_draft: true$/m);
    expect(out).toMatch(/^graded_by: guild-migrate$/m);
    // Existing frontmatter keys + body survive intact.
    expect(out).toMatch(/^confidence: high$/m);
    expect(out).toContain("# Page\n\nBody text.");
  });

  test("decisions page and type: decision page → high", () => {
    const dec = path.join(WIKI, "decisions/some-call.md");
    const typed = path.join(WIKI, "context/typed-decision.md");
    const fs = buildFs({
      [dec]: FM(),
      [typed]: `---\ntype: decision\nconfidence: medium\n---\n\nbody\n`,
    });
    const records = backfillWikiImportance(fs, GUILD, false);
    expect(rec(records, "wiki/decisions/some-call.md")?.grade).toBe("high");
    expect(rec(records, "wiki/context/typed-decision.md")?.grade).toBe("high");
  });

  test("architecture-map → high; everything else → medium", () => {
    const arch = path.join(WIKI, "context/architecture-map.md");
    const other = path.join(WIKI, "context/team-norms.md");
    const fs = buildFs({ [arch]: FM(), [other]: FM() });
    const records = backfillWikiImportance(fs, GUILD, false);
    expect(rec(records, "wiki/context/architecture-map.md")?.grade).toBe("high");
    expect(rec(records, "wiki/context/team-norms.md")?.grade).toBe("medium");
  });

  test("already-graded page is NEVER touched (byte-identical)", () => {
    const p = path.join(WIKI, "standards/graded.md");
    const original = FM("importance: low\n");
    const fs = buildFs({ [p]: original });
    const records = backfillWikiImportance(fs, GUILD, false);
    expect(rec(records, "wiki/standards/graded.md")?.action).toBe("skipped-already-graded");
    expect(fs.readFileSync(p)).toBe(original); // byte-identical
    expect(fs.readFileSync(p)).not.toContain("importance_draft");
  });

  test("provenance/exploratory pages skipped — by frontmatter AND by directory", () => {
    const byFm = path.join(WIKI, "context/spike-notes.md");
    const byCat = path.join(WIKI, "context/exploration.md");
    const byDir = path.join(WIKI, "research/old-spike.md");
    const bySrc = path.join(WIKI, "sources/some-ingest.md");
    const fs = buildFs({
      [byFm]: `---\ntype: provenance\nconfidence: low\n---\nbody\n`,
      [byCat]: `---\ncategory: exploratory\nconfidence: low\n---\nbody\n`,
      [byDir]: FM(),
      [bySrc]: `---\ntype: source\nconfidence: medium\n---\nbody\n`,
    });
    const records = backfillWikiImportance(fs, GUILD, false);
    for (const r of [
      "wiki/context/spike-notes.md",
      "wiki/context/exploration.md",
      "wiki/research/old-spike.md",
      "wiki/sources/some-ingest.md",
    ]) {
      expect(rec(records, r)?.action).toBe("skipped-provenance");
      expect(fs.readFileSync(path.join(GUILD, r))).not.toContain("importance");
    }
  });

  test("structural pages (index.md / README.md / log.md / lint-*) skipped", () => {
    const files = {
      [path.join(WIKI, "index.md")]: "# index\n",
      [path.join(WIKI, "README.md")]: "# readme\n",
      [path.join(WIKI, "log.md")]: "# log\n",
      [path.join(WIKI, "lint-2026-01-01T00:00:00Z.md")]: "# lint report\n",
    };
    const fs = buildFs(files);
    const records = backfillWikiImportance(fs, GUILD, false);
    expect(records.every((r) => r.action === "skipped-structural")).toBe(true);
    for (const [p, original] of Object.entries(files)) {
      expect(fs.readFileSync(p)).toBe(original);
    }
  });

  test("frontmatter-less page gets a created block", () => {
    const p = path.join(WIKI, "concepts/bare-page.md");
    const fs = buildFs({ [p]: "# Bare page\n\nNo frontmatter here.\n" });
    const records = backfillWikiImportance(fs, GUILD, false);
    const r = rec(records, "wiki/concepts/bare-page.md");
    expect(r?.action).toBe("graded");
    expect(r?.createdFrontmatter).toBe(true);
    const out = fs.readFileSync(p);
    expect(out.startsWith("---\nimportance: medium\nimportance_draft: true\ngraded_by: guild-migrate\n---\n")).toBe(true);
    expect(out).toContain("# Bare page\n\nNo frontmatter here.\n");
  });

  test("dry-run computes every planned grade but writes NOTHING", () => {
    const p1 = path.join(WIKI, "standards/a.md");
    const p2 = path.join(WIKI, "context/b.md");
    const orig1 = FM();
    const orig2 = "# no fm\n";
    const fs = buildFs({ [p1]: orig1, [p2]: orig2 });
    const records = backfillWikiImportance(fs, GUILD, true);
    expect(rec(records, "wiki/standards/a.md")?.grade).toBe("high");
    expect(rec(records, "wiki/context/b.md")?.grade).toBe("medium");
    expect(fs.readFileSync(p1)).toBe(orig1);
    expect(fs.readFileSync(p2)).toBe(orig2);
  });

  test("no wiki dir → no records, no throw", () => {
    const fs = buildFs({ [path.join(GUILD, "settings.json")]: "{}" });
    expect(backfillWikiImportance(fs, GUILD, false)).toEqual([]);
  });

  test("idempotent: a second backfill run leaves drafted pages alone", () => {
    const p = path.join(WIKI, "context/page.md");
    const fs = buildFs({ [p]: FM() });
    backfillWikiImportance(fs, GUILD, false);
    const afterFirst = fs.readFileSync(p);
    const second = backfillWikiImportance(fs, GUILD, false);
    expect(rec(second, "wiki/context/page.md")?.action).toBe("skipped-already-graded");
    expect(fs.readFileSync(p)).toBe(afterFirst);
  });
});

describe("the human gate — acceptGrades + listDraftGrades", () => {
  test("acceptGrades strips importance_draft + graded_by, keeps the grade", () => {
    const p = path.join(WIKI, "standards/a.md");
    const fs = buildFs({ [p]: FM() });
    backfillWikiImportance(fs, GUILD, false);
    expect(listDraftGrades(fs, GUILD)).toEqual([{ rel: "wiki/standards/a.md", grade: "high" }]);

    const accepted = acceptGrades(fs, GUILD);
    expect(accepted).toEqual([{ rel: "wiki/standards/a.md", grade: "high" }]);
    const out = fs.readFileSync(p);
    expect(out).toMatch(/^importance: high$/m);
    expect(out).not.toContain("importance_draft");
    expect(out).not.toContain("graded_by");
    // Original frontmatter + body intact.
    expect(out).toMatch(/^confidence: high$/m);
    expect(out).toContain("# Page\n\nBody text.");
    // Gate cleared: nothing pending, second accept is a no-op.
    expect(listDraftGrades(fs, GUILD)).toEqual([]);
    expect(acceptGrades(fs, GUILD)).toEqual([]);
  });

  test("acceptGrades keeps an operator-EDITED grade (the review step)", () => {
    const p = path.join(WIKI, "context/page.md");
    const fs = buildFs({ [p]: FM() });
    backfillWikiImportance(fs, GUILD, false);
    // Operator reviews and bumps medium → critical before accepting.
    fs.writeFileSync(p, fs.readFileSync(p).replace("importance: medium", "importance: critical"));
    const accepted = acceptGrades(fs, GUILD);
    expect(accepted).toEqual([{ rel: "wiki/context/page.md", grade: "critical" }]);
    expect(fs.readFileSync(p)).toMatch(/^importance: critical$/m);
  });

  test("acceptGrades never touches pages without the draft marker", () => {
    const graded = path.join(WIKI, "standards/graded.md");
    const original = FM("importance: low\n");
    const fs = buildFs({ [graded]: original });
    expect(acceptGrades(fs, GUILD)).toEqual([]);
    expect(fs.readFileSync(graded)).toBe(original);
  });
});

describe("report gate surface (runMigration end-to-end, in-memory)", () => {
  test("migrate report ENDS with the drafted-grades review table + accept instruction", () => {
    const fs = buildFs({
      [path.join(GUILD, "config.yml")]: "codex_review: false\n",
      [path.join(WIKI, "standards/a.md")]: FM(),
      [path.join(WIKI, "research/spike.md")]: FM(),
      [path.join(WIKI, "standards/graded.md")]: FM("importance: low\n"),
    });
    const res = runMigration({ root: ROOT, mode: "migrate", fs, clock });
    const child = res.children[0];
    expect(child.action).toBe("migrate");
    const body = child.reportBody;
    const gateIdx = body.indexOf("## Drafted wiki importance grades — REVIEW REQUIRED (human gate)");
    expect(gateIdx).toBeGreaterThan(-1);
    // It is the LAST section of the report.
    expect(body.slice(gateIdx)).not.toMatch(/\n## (?!Drafted)/);
    expect(body).toContain("| `wiki/standards/a.md` | high | standards/** → high |");
    expect(body).toContain("--accept-grades");
    expect(body).toContain("1 provenance/exploratory");
    expect(body).toContain("1 already graded");
  });

  test("dry-run lists planned grades and writes nothing to the wiki", () => {
    const wikiPage = path.join(WIKI, "context/page.md");
    const original = FM();
    const fs = buildFs({
      [path.join(GUILD, "config.yml")]: "codex_review: false\n",
      [wikiPage]: original,
    });
    const res = runMigration({ root: ROOT, mode: "dry-run", fs, clock });
    const child = res.children[0];
    expect(child.grades.filter((g) => g.action === "graded")).toHaveLength(1);
    expect(child.reportBody).toContain("WOULD be drafted");
    expect(fs.readFileSync(wikiPage)).toBe(original);
    expect(fs.existsSync(path.join(GUILD, "settings.json"))).toBe(false);
  });
});
