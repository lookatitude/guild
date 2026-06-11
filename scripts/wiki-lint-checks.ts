#!/usr/bin/env npx tsx
/**
 * wiki-lint-checks.ts — the deterministic core of `/guild:wiki lint`.
 *
 * The guild:wiki-lint SKILL runs this FIRST and folds its findings into the
 * lint report; semantic checks (contradictions, stale claims, ADR shape) stay
 * with the model. This script owns the MECHANICAL checks so they can never be
 * skipped or hallucinated (deterministic-code-not-prose rule):
 *
 *   The skip predicate for M2 is IMPORTED from the migration grader
 *   (dot-guild/convert/wiki-importance.ts) — structural basenames and
 *   provenance/exploratory pages (by path segment or type:/category:
 *   frontmatter) are exempt, identically in both tools.
 *
 *   M1  pending-grade-review — `importance_draft: true` frontmatter (migration-
 *       drafted grade awaiting operator review; clear via
 *       `migrate-guild.ts --accept-grades`). Same predicate as
 *       docs-hygiene/scan.ts rule 7.
 *   M2  missing-importance — consumable page without `importance:` frontmatter
 *       (provenance/exploratory pages and structural files are exempt).
 *
 * Usage: npx tsx scripts/wiki-lint-checks.ts [--root <repo-root>] [--json]
 * Exit: 0 = clean · 2 = findings (never blocks; lint is advisory).
 */
import * as fs from "fs";
import * as path from "path";
import {
  STRUCTURAL_BASENAMES,
  splitFrontmatter,
  fmValue,
  isProvenance,
} from "./dot-guild/convert/wiki-importance";

interface Finding { check: "pending-grade-review" | "missing-importance"; file: string; detail: string }

function parseArgs(argv: string[]): { root: string; json: boolean } {
  let root = process.cwd();
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--root" && argv[i + 1]) root = path.resolve(argv[++i]);
    else if (argv[i] === "--json") json = true;
  }
  return { root, json };
}


export function lintWiki(root: string): Finding[] {
  const wiki = path.join(root, ".guild", "wiki");
  const findings: Finding[] = [];
  if (!fs.existsSync(wiki)) return findings;
  const walk = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = path.join(dir, e.name);
      return e.isDirectory() ? walk(p) : e.name.endsWith(".md") ? [p] : [];
    });
  for (const f of walk(wiki)) {
    const rel = path.relative(root, f);
    const relInWiki = path.relative(wiki, f);
    const base = path.basename(f).toLowerCase();
    if (base.startsWith("lint-")) continue; // prior lint reports
    const { fmLines } = splitFrontmatter(fs.readFileSync(f, "utf8"));
    const importance = fmValue(fmLines, "importance");
    if (fmValue(fmLines, "importance_draft") === "true") {
      findings.push({
        check: "pending-grade-review",
        file: rel,
        detail: `importance: ${importance || "??"} (graded_by: ${fmValue(fmLines, "graded_by") || "??"}) — review, edit if needed, then run migrate-guild.ts --accept-grades`,
      });
    } else if (!importance && !STRUCTURAL_BASENAMES.has(base) && !isProvenance(relInWiki, fmLines)) {
      // EXACT same skip predicate as the migration grader (wiki-importance.ts):
      // structural basenames + provenance/exploratory by path segment or
      // type:/category: frontmatter — imported, so the two can never drift.
      findings.push({ check: "missing-importance", file: rel, detail: "consumable page without importance: frontmatter" });
    }
  }
  return findings;
}

if (require.main === module) {
  const { root, json } = parseArgs(process.argv.slice(2));
  const findings = lintWiki(root);
  if (json) {
    console.log(JSON.stringify({ root, findings }, null, 2));
  } else if (findings.length === 0) {
    console.log("wiki-lint-checks: clean (0 mechanical findings)");
  } else {
    console.log(`wiki-lint-checks: ${findings.length} mechanical finding(s)\n`);
    for (const f of findings) console.log(`  [${f.check}] ${f.file} — ${f.detail}`);
  }
  process.exit(findings.length ? 2 : 0);
}
