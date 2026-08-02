/**
 * scripts/dot-guild/convert/wiki-importance.ts — the "wiki importance backfill"
 * converter row (v1→v2 knowledge migration).
 *
 * v1 wiki pages carry no v2 `importance:` frontmatter, which makes migrated
 * knowledge second-class in v2 recall ranking and coverage reporting. This row
 * scans every `.md` page under `<guildDir>/wiki/` and DRAFTS a grade by
 * deterministic heuristics (taxonomy: docs/knowledge/decisions/
 * knowledge-base-hygiene-and-grading.md §A + docs/v2/knowledge-memory.html):
 *
 *   - standards/** and architecture-map pages          → high
 *   - decisions/** (or `type: decision` frontmatter)   → high
 *   - provenance / exploratory pages                   → SKIP (confidence-graded
 *     only, NEVER importance — §A.3: research/ ideation/ sources/ dirs, or
 *     frontmatter type/category marking provenance|exploratory|source)
 *   - structural pages (index.md / README.md / log.md / lint-*.md) → SKIP
 *   - everything else                                  → medium
 *
 * A drafted grade is written as THREE frontmatter keys (frontmatter block is
 * created when absent):
 *
 *   importance: <grade>
 *   importance_draft: true
 *   graded_by: guild-migrate
 *
 * THE HUMAN GATE: drafts are never authoritative. A page that ALREADY has
 * `importance:` is NEVER touched. The migration report ends with the drafted-
 * grades review table; the operator reviews/edits the grades, then runs
 * `migrate-guild.ts --accept-grades` (acceptGrades below) which strips the
 * `importance_draft` + `graded_by` markers and keeps the grade. Until accepted,
 * the wiki lint surface flags the page as a pending-review item
 * (docs-hygiene/scan.ts rule 7 + wiki-lint check #9, listDraftGrades below).
 *
 * dryRun=true: compute every planned grade, write NOTHING.
 */

import * as path from "path";
import { sealSet } from "../../../src/modules/kernel/workflows/sealed-collections";
import type { Fs, WikiGradeRecord, ImportanceGrade } from "./types";
import { parseYaml } from "../../lib/frontmatter";

/** Marker value stamped into `graded_by:` so accepts/audits can attribute drafts. */
export const GRADED_BY_STAMP = "guild-migrate";

/** Structural (non-knowledge) basenames — never graded. (Shared with wiki-lint-checks.ts.) */
export const STRUCTURAL_BASENAMES = sealSet(["index.md", "readme.md", "log.md", "query.md", "transfer-manifest.md"], "STRUCTURAL_BASENAMES");

/** Path segments that mark a provenance / exploratory (confidence-only) page. */
const PROVENANCE_SEGMENTS = new Set(["research", "ideation", "sources"]);

/** Frontmatter type/category values that mark provenance / exploratory pages. */
const PROVENANCE_FM_VALUES = new Set(["provenance", "exploratory", "research", "ideation", "source"]);

// ── Frontmatter helpers (line-preserving; only the 3 draft keys are touched) ──

export interface FmSplit {
  /** Frontmatter lines BETWEEN the two `---` fences (no fences). Null = no block. */
  fmLines: string[] | null;
  /** Everything after the closing fence (including its leading newline content). */
  body: string;
}

export function splitFrontmatter(content: string): FmSplit {
  if (content.slice(0, 3) !== "---") return { fmLines: null, body: content };
  const lines = content.split("\n");
  if (lines[0].trim() !== "---") return { fmLines: null, body: content };
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") {
      return { fmLines: lines.slice(1, i), body: lines.slice(i + 1).join("\n") };
    }
  }
  return { fmLines: null, body: content }; // unterminated fence — treat as body
}

export function fmValue(fmLines: string[] | null, key: string): string | null {
  if (!fmLines) return null;
  // Parse the (fence-stripped) frontmatter block via the shared js-yaml parser
  // (OD-3); js-yaml handles quote-stripping. String()-coerced; null = absent.
  const doc = parseYaml(fmLines.join("\n"));
  if (doc === null || typeof doc !== "object" || Array.isArray(doc)) return null;
  const v = (doc as Record<string, unknown>)[key];
  return v === undefined || v === null ? null : String(v);
}

// ── Classification ─────────────────────────────────────────────────────────

export function isProvenance(relInWiki: string, fmLines: string[] | null): boolean {
  const segments = relInWiki.split(path.sep).slice(0, -1).map((s) => s.toLowerCase());
  if (segments.some((s) => PROVENANCE_SEGMENTS.has(s))) return true;
  for (const key of ["type", "category"]) {
    const v = fmValue(fmLines, key)?.toLowerCase();
    if (v && PROVENANCE_FM_VALUES.has(v)) return true;
  }
  return false;
}

function draftGrade(relInWiki: string, fmLines: string[] | null): { grade: ImportanceGrade; rule: string } {
  const first = relInWiki.split(path.sep)[0].toLowerCase();
  const base = path.basename(relInWiki).toLowerCase();
  if (first === "standards") return { grade: "high", rule: "standards/** → high" };
  if (base === "architecture-map.md" || relInWiki.toLowerCase().includes("architecture-map"))
    return { grade: "high", rule: "architecture-map → high" };
  if (first === "decisions") return { grade: "high", rule: "decisions/** → high" };
  if (fmValue(fmLines, "type")?.toLowerCase() === "decision")
    return { grade: "high", rule: "type: decision → high" };
  return { grade: "medium", rule: "default → medium" };
}

// ── Walk ───────────────────────────────────────────────────────────────────

/** All .md files under `<guildDir>/wiki/`, sorted for deterministic reports. */
function walkWiki(fs: Fs, wikiDir: string): string[] {
  const out: string[] = [];
  const recur = (dir: string): void => {
    let entries;
    try {
      entries = fs.readdirSync(dir);
    } catch {
      return;
    }
    for (const e of [...entries].sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, e.name);
      if (e.isDirectory) recur(full);
      else if (e.isFile && e.name.endsWith(".md")) out.push(full);
    }
  };
  recur(wikiDir);
  return out.sort();
}

function isStructural(basename: string): boolean {
  const b = basename.toLowerCase();
  return STRUCTURAL_BASENAMES.has(b) || b.startsWith("lint-");
}

// ── The converter row ──────────────────────────────────────────────────────

/**
 * Scan `<guildDir>/wiki/**` and draft an `importance:` grade onto every
 * ungraded, non-provenance, non-structural page. Pages that already carry
 * `importance:` are NEVER touched. dryRun computes records, writes nothing.
 */
export function backfillWikiImportance(fs: Fs, guildDir: string, dryRun: boolean): WikiGradeRecord[] {
  const wikiDir = path.join(guildDir, "wiki");
  const records: WikiGradeRecord[] = [];
  if (!fs.existsSync(wikiDir)) return records;

  for (const p of walkWiki(fs, wikiDir)) {
    const rel = path.relative(guildDir, p); // "wiki/standards/foo.md"
    const relInWiki = path.relative(wikiDir, p); // "standards/foo.md"

    if (isStructural(path.basename(p))) {
      records.push({ rel, action: "skipped-structural", rule: "index/README/log/lint-* → skip" });
      continue;
    }

    const content = fs.readFileSync(p);
    const { fmLines } = splitFrontmatter(content);

    if (fmValue(fmLines, "importance") !== null) {
      records.push({ rel, action: "skipped-already-graded", rule: "importance: present → never touch" });
      continue;
    }
    if (isProvenance(relInWiki, fmLines)) {
      records.push({
        rel,
        action: "skipped-provenance",
        rule: "provenance/exploratory → confidence-graded only, never importance",
      });
      continue;
    }

    const { grade, rule } = draftGrade(relInWiki, fmLines);
    const draftLines = [`importance: ${grade}`, `importance_draft: true`, `graded_by: ${GRADED_BY_STAMP}`];
    if (!dryRun) {
      let next: string;
      if (fmLines === null) {
        // No frontmatter — create the block (P-shape: fences + the 3 draft keys).
        next = `---\n${draftLines.join("\n")}\n---\n${content}`;
      } else {
        // Insert the 3 keys just before the closing fence, preserving every
        // existing frontmatter line and the body byte-for-byte.
        const { body } = splitFrontmatter(content);
        next = `---\n${[...fmLines, ...draftLines].join("\n")}\n---\n${body}`;
      }
      fs.writeFileSync(p, next);
    }
    records.push({ rel, action: "graded", grade, rule, createdFrontmatter: fmLines === null });
  }
  return records;
}

// ── The gate verbs ─────────────────────────────────────────────────────────

export interface AcceptedGrade {
  rel: string;
  grade: string;
}

/**
 * THE GATE ACCEPT — `migrate-guild.ts --accept-grades`. For every wiki page
 * whose frontmatter carries `importance_draft: true`, strip the
 * `importance_draft:` and `graded_by:` marker lines, KEEPING the (possibly
 * operator-edited) `importance:` grade. Returns the accepted pages.
 */
export function acceptGrades(fs: Fs, guildDir: string): AcceptedGrade[] {
  const wikiDir = path.join(guildDir, "wiki");
  const accepted: AcceptedGrade[] = [];
  if (!fs.existsSync(wikiDir)) return accepted;

  for (const p of walkWiki(fs, wikiDir)) {
    const content = fs.readFileSync(p);
    const { fmLines, body } = splitFrontmatter(content);
    if (fmLines === null) continue;
    if (fmValue(fmLines, "importance_draft") !== "true") continue;

    const kept = fmLines.filter(
      (l) => !/^importance_draft\s*:/.test(l) && !/^graded_by\s*:/.test(l)
    );
    fs.writeFileSync(p, `---\n${kept.join("\n")}\n---\n${body}`);
    accepted.push({
      rel: path.relative(guildDir, p),
      grade: fmValue(fmLines, "importance") ?? "(none)",
    });
  }
  return accepted;
}

/**
 * THE GATE LINT FEED — pages still carrying `importance_draft: true`
 * (pending operator review). Read-only; consumed by the lint surface.
 */
export function listDraftGrades(fs: Fs, guildDir: string): AcceptedGrade[] {
  const wikiDir = path.join(guildDir, "wiki");
  const pending: AcceptedGrade[] = [];
  if (!fs.existsSync(wikiDir)) return pending;
  for (const p of walkWiki(fs, wikiDir)) {
    const { fmLines } = splitFrontmatter(fs.readFileSync(p));
    if (fmLines !== null && fmValue(fmLines, "importance_draft") === "true") {
      pending.push({ rel: path.relative(guildDir, p), grade: fmValue(fmLines, "importance") ?? "(none)" });
    }
  }
  return pending;
}
