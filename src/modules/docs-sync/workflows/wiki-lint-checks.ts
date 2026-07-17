#!/usr/bin/env npx tsx
/**
 * src/modules/docs-sync/workflows/wiki-lint-checks.ts — the deterministic core of `/guild:wiki lint`.
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
 *   M3  invalid-type — a page's `type:` frontmatter is PRESENT but not one of
 *       the §10.1.1 closed enum values (context|standard|product|entity|
 *       concept|decision|source — see wiki-frontmatter-contract.ts, the
 *       single source of truth this check imports rather than re-spelling
 *       the enum). Absent `type:` is NOT flagged here (a separate,
 *       broader-scope "missing required field" decision, not this check's
 *       job) — only a PRESENT-but-wrong value is a mechanical, unambiguous
 *       defect. Structural/provenance pages are exempt, same predicate as M2.
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
} from "../../../../scripts/dot-guild/convert/wiki-importance";
import { lintKnowledgeNodes } from "../../../../scripts/learn/wiki-lint-knowledge";
import type { GraphNode } from "../../../../scripts/learn/lib/schema";
import { loadYamlApi } from "../../kernel";
import { WIKI_PAGE_TYPES, isWikiPageType } from "../../knowledge";

const yaml = loadYamlApi();

interface Finding {
  check:
    | "pending-grade-review"
    | "missing-importance"
    | "invalid-category"
    | "invalid-type"
    | "label-coverage"
    | "label-unknown";
  file: string;
  detail: string;
}

// ── Wiki label taxonomy (docs/v2/knowledge-memory.md §Label Schema, item 5) ──
//
// The closed label sets live in `.guild/project.yaml → label_taxonomy:` (authored
// at Init, evolvable only via the human-gated promotion path). The label-coverage
// check is INERT until that block exists — so a repo that has not opted into the
// taxonomy gets zero new findings. The canonical 9-value `concern` enum is the
// default scaffold below; `domain` + `status` sets are repo-authored.
export const DEFAULT_CONCERN_ENUM = [
  "architecture", "security", "performance", "reliability", "data",
  "api", "ux", "build", "ops",
] as const;

export interface LabelTaxonomy {
  domain: Set<string>;
  concern: Set<string>;
  status: Set<string>;
}

/** Read `.guild/project.yaml → label_taxonomy`. Returns null when absent/empty. */
export function readLabelTaxonomy(root: string): LabelTaxonomy | null {
  const p = path.join(root, ".guild", "project.yaml");
  if (!fs.existsSync(p)) return null;
  let parsed: unknown;
  try { parsed = yaml.load(fs.readFileSync(p, "utf8")); } catch { return null; }
  const lt = (parsed as { label_taxonomy?: Record<string, unknown> } | null)?.label_taxonomy;
  if (!lt || typeof lt !== "object") return null;
  const toSet = (v: unknown): Set<string> =>
    new Set((Array.isArray(v) ? v : []).map((x) => String(x).toLowerCase()));
  const tax: LabelTaxonomy = {
    domain: toSet(lt["domain"]),
    concern: toSet(lt["concern"]),
    status: toSet(lt["status"]),
  };
  // A taxonomy with no closed sets at all is treated as absent (inert).
  if (tax.domain.size === 0 && tax.concern.size === 0 && tax.status.size === 0) return null;
  return tax;
}

/** Normalize a frontmatter label value (scalar | list) to a lowercased string[]. */
function labelValues(v: unknown): string[] {
  if (v === undefined || v === null) return [];
  return (Array.isArray(v) ? v : [v]).map((x) => String(x).toLowerCase()).filter(Boolean);
}

/**
 * Label-coverage + resolution findings for one durable page, against the taxonomy.
 * Mechanical only: coverage (labels block present with non-empty domain + concern
 * + status) and resolution (every value ∈ the closed set). "Stale label after a
 * feature change" is semantic and stays with the wiki-lint skill (model).
 */
function lintLabels(rel: string, fmText: string, tax: LabelTaxonomy): Finding[] {
  const out: Finding[] = [];
  let fm: Record<string, unknown> = {};
  try { fm = (yaml.load(fmText) as Record<string, unknown>) ?? {}; } catch { /* malformed → treated as no labels */ }
  const labels = (fm["labels"] as Record<string, unknown> | undefined) ?? undefined;
  const axes: Array<keyof LabelTaxonomy> = ["domain", "concern", "status"];
  const missing: string[] = [];
  for (const axis of axes) {
    const vals = labelValues(labels?.[axis]);
    if (vals.length === 0) { missing.push(axis); continue; }
    const closed = tax[axis];
    if (closed.size > 0) {
      for (const v of vals) {
        if (!closed.has(v)) {
          out.push({ check: "label-unknown", file: rel, detail: `labels.${axis} value "${v}" not in project.yaml label_taxonomy.${axis}` });
        }
      }
    }
  }
  if (missing.length > 0) {
    out.push({ check: "label-coverage", file: rel, detail: `durable page missing non-empty labels: ${missing.join(", ")}` });
  }
  return out;
}

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
  // Label taxonomy: null ⇒ the label-coverage check is inert (item 5 opt-in).
  const taxonomy = readLabelTaxonomy(root);

  // ── Wiki file lint (M1 pending-grade-review · M2 missing-importance) ─────
  // Guarded: only runs when .guild/wiki exists. These are the markdown-file
  // level checks (frontmatter importance / importance_draft).
  if (fs.existsSync(wiki)) {
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
      const durable = !STRUCTURAL_BASENAMES.has(base) && !isProvenance(relInWiki, fmLines);
      if (fmValue(fmLines, "importance_draft") === "true") {
        findings.push({
          check: "pending-grade-review",
          file: rel,
          detail: `importance: ${importance || "??"} (graded_by: ${fmValue(fmLines, "graded_by") || "??"}) — review, edit if needed, then run migrate-guild.ts --accept-grades`,
        });
      } else if (!importance && durable) {
        // EXACT same skip predicate as the migration grader (wiki-importance.ts):
        // structural basenames + provenance/exploratory by path segment or
        // type:/category: frontmatter — imported, so the two can never drift.
        findings.push({ check: "missing-importance", file: rel, detail: "consumable page without importance: frontmatter" });
      }
      // M3 invalid-type: PRESENT-but-wrong `type:` only (see file header) —
      // same durable/structural/provenance exemption as M2, so a legitimately
      // free-form exploratory or structural page never trips this check.
      const typeValue = fmValue(fmLines, "type");
      if (durable && typeValue !== null && !isWikiPageType(typeValue)) {
        findings.push({
          check: "invalid-type",
          file: rel,
          detail: `type: "${typeValue}" is not one of ${WIKI_PAGE_TYPES.join("|")} (§10.1.1)`,
        });
      }
      // Label coverage (item 5): durable pages only, and only when a taxonomy
      // is authored (inert otherwise → no findings on un-opted-in repos).
      if (taxonomy && durable) {
        findings.push(...lintLabels(rel, fmLines.join("\n"), taxonomy));
      }
    }
  }

  // ── Knowledge graph lint (SC-6: knowledge-node missing importance / invalid-category) ──
  // Independent of the wiki directory — the knowledge graph is a separate artifact
  // at .guild/indexes/knowledge-graph.json (produced by K-stages; absent before K2 runs).
  // Folds lintKnowledgeNodes() findings into the wiki-lint report so that
  // `/guild:wiki lint` → lintWiki() surfaces them even when .guild/wiki is absent.
  const kgPath = path.join(root, ".guild", "indexes", "knowledge-graph.json");
  if (fs.existsSync(kgPath)) {
    try {
      const kg = JSON.parse(fs.readFileSync(kgPath, "utf8")) as { nodes?: unknown[] };
      const nodes = Array.isArray(kg.nodes) ? (kg.nodes as GraphNode[]) : [];
      for (const kf of lintKnowledgeNodes(nodes)) {
        findings.push({
          check: kf.check,    // "missing-importance" | "invalid-category"
          file: kf.nodeId,    // node id acts as the "file" locator in this context
          detail: kf.reason,
        });
      }
    } catch {
      // Malformed knowledge-graph.json — skip silently (advisory lint, not hard gate)
    }
  }

  return findings;
}

export function main(argv: string[] = process.argv.slice(2)): void {
  const { root, json } = parseArgs(argv);
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

if (require.main === module) {
  main();
}
