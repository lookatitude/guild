/**
 * scripts/dot-guild/convert/report.ts — the mandatory per-artifact mapping report
 * (§2.0a / §4.2). Emitted on EVERY run incl. dry-run. One line per artifact with
 * its disposition, v1→v2 path, every relocated key, and any C4 conflict note.
 * Documents the §4.1 one-line restore command.
 */

import type { ChildResult, DetectResult } from "./types";
import { REPORT_PREFIX } from "./snapshot";

/** Build the `.guild/.migration-report-<stamp>.md` filename. */
export function reportFileName(stamp: string): string {
  return `${REPORT_PREFIX}${stamp}.md`;
}

function detectSummary(d: DetectResult): string {
  const m1 = d.evidence.filter((e) => e.contributes === "M1");
  const m2 = d.evidence.filter((e) => e.contributes === "M2");
  const lines: string[] = [];
  lines.push(`- **classification:** \`${d.classification}\` (M1=${d.m1}, M2=${d.m2})`);
  if (d.hasUnparseable) {
    lines.push(`- **corrupt:** an authoritative artifact failed to parse — ALL in-place writes blocked.`);
  }
  if (m1.length) {
    lines.push(`- **v1 evidence (M1):**`);
    for (const e of m1) lines.push(`  - \`${e.path}\` (${e.marker})${e.note ? ` — ${e.note}` : ""}`);
  }
  if (m2.length) {
    lines.push(`- **v2 evidence (M2):**`);
    for (const e of m2.slice(0, 24)) lines.push(`  - \`${e.path}\` (${e.marker})${e.note ? ` — ${e.note}` : ""}`);
    if (m2.length > 24) lines.push(`  - … and ${m2.length - 24} more`);
  }
  if (d.unparseable.length) {
    lines.push(`- **unparseable:**`);
    for (const u of d.unparseable)
      lines.push(`  - \`${u.path}\`${u.authoritative ? " (AUTHORITATIVE — forces corrupt)" : " (non-authoritative — preserved)"}`);
  }
  return lines.join("\n");
}

/** Render the full per-child report body. */
export function renderReport(child: ChildResult, mode: string, iso: string): string {
  const d = child.detect;
  let out = "";
  out += `---\ntype: artifact\nartifact: migration-report\ninitiative: cleanup-consolidation\n`;
  out += `mode: ${mode}\nclassification: ${d.classification}\ncreated_at: ${iso}\n---\n\n`;
  out += `# v1 → v2 \`.guild\` migration report\n\n`;
  out += `Root: \`${child.root}\`\n\nMode: **${mode}**${mode === "dry-run" ? " — NOTHING was written." : ""}\n\n`;

  out += `## Detection\n\n${detectSummary(d)}\n\n`;

  if (d.classification === "corrupt") {
    out += `## Action: BLOCKED (corrupt dominates)\n\n`;
    out += `No migration occurred. An authoritative artifact is unparseable, so the tree's\n`;
    out += `state is untrustworthy and ALL in-place writes are refused (§1.3 precedence).\n`;
    out += `Recommended: run \`--dry-run\`, repair/remove the corrupt file(s) above, re-open.\n`;
    if (child.snapshot) out += `\nA verified snapshot was still taken at \`${child.snapshot.destRel}\`.\n`;
    return out + "\n";
  }

  if (d.classification === "v2" || d.classification === "none") {
    out += `## Action: ${child.action}\n\n`;
    if (child.conflicts.length || child.artifacts.length) {
      out += `Advisory: a v2 tree carried a deprecated alias — flagged below (no mutation).\n\n`;
    } else {
      out += `No v1 markers — nothing to migrate.\n`;
      return out + "\n";
    }
  }

  if (child.snapshot) {
    out += `## Snapshot (SC-3)\n\n`;
    out += `- dest: \`${child.snapshot.destRel}\` (${child.snapshot.fileCount} file(s), `;
    out += child.snapshot.verified ? `sha256-verified)\n` : `**VERIFY FAILED** at \`${child.snapshot.mismatch}\` — conversion aborted)\n`;
    if (child.restoreCommand) out += `- restore: \`${child.restoreCommand}\`\n`;
    out += `\n`;
  }

  // Per-artifact table.
  out += `## Per-artifact disposition\n\n`;
  if (child.artifacts.length === 0) {
    out += `_No convert/preserve artifacts (carry-forward artifacts are left untouched and not listed)._\n\n`;
  } else {
    out += `| Artifact | Disposition | v2 target | Removed from live | Note |\n|---|---|---|---|---|\n`;
    for (const a of child.artifacts) {
      out += `| \`${a.rel}\` | ${a.disposition} | ${a.target ? `\`${a.target}\`` : "—"} | ${a.removed ? "yes" : "no"} | ${a.note ?? ""} |\n`;
    }
    out += `\n`;
    // Per-key detail for config surfaces.
    for (const a of child.artifacts) {
      if (a.keys && a.keys.length) {
        out += `### Keys — \`${a.rel}\`\n\n`;
        out += `| Key | Case | Detail |\n|---|---|---|\n`;
        for (const k of a.keys) out += `| \`${k.key}\` | ${k.case} | ${k.detail} |\n`;
        out += `\n`;
      }
    }
  }

  if (child.relocated.length) {
    out += `## Relocated to \`.unmigrated-v1.json\` (C2 — unmapped, preserved live + in snapshot)\n\n`;
    out += `| Source | Key | Value | Reason |\n|---|---|---|---|\n`;
    for (const r of child.relocated)
      out += `| \`${r.source}\` | \`${r.key}\` | \`${JSON.stringify(r.value)}\` | ${r.reason} |\n`;
    out += `\n`;
  }

  if (child.conflicts.length) {
    out += `## Conflicts — REVIEW (C4 — kept LIVE, re-surfaced every open until resolved)\n\n`;
    for (const c of child.conflicts) out += `- \`${c.key}\` — ${c.detail}\n`;
    out += `\nThe tree intentionally stays \`mixed\` until you resolve these. The converter\n`;
    out += `will NOT auto-pick a winner, clobber the v2 value, or remove the v1 source.\n\n`;
  }

  out += renderGradesSection(child, mode);

  return out + "\n";
}

/**
 * The wiki importance-backfill review table — ALWAYS the LAST section of the
 * report (the human gate's review surface). Lists every drafted grade + the
 * accept instruction; skipped pages are summarized by reason.
 */
function renderGradesSection(child: ChildResult, mode: string): string {
  const graded = child.grades.filter((g) => g.action === "graded");
  if (graded.length === 0) return "";
  const skipped = child.grades.filter((g) => g.action !== "graded");
  const count = (a: string) => skipped.filter((g) => g.action === a).length;

  let out = `## Drafted wiki importance grades — REVIEW REQUIRED (human gate)\n\n`;
  out +=
    mode === "dry-run"
      ? `${graded.length} wiki page(s) WOULD be drafted a v2 \`importance:\` grade (dry-run — nothing was written):\n\n`
      : `${graded.length} wiki page(s) were drafted a v2 \`importance:\` grade by deterministic heuristics.\n` +
        `Each is marked \`importance_draft: true\` + \`graded_by: guild-migrate\` until you accept it:\n\n`;
  out += `| Page | Drafted grade | Rule |\n|---|---|---|\n`;
  for (const g of graded) {
    out += `| \`${g.rel}\` | ${g.grade}${g.createdFrontmatter ? " (frontmatter created)" : ""} | ${g.rule} |\n`;
  }
  out += `\nSkipped: ${count("skipped-already-graded")} already graded (never touched), `;
  out += `${count("skipped-provenance")} provenance/exploratory (confidence-graded only, never importance), `;
  out += `${count("skipped-structural")} structural (index/README/log/lint).\n\n`;
  out += `**Next step (the gate):** review each drafted grade — edit the \`importance:\` value\n`;
  out += `in place where the heuristic is wrong — then accept:\n\n`;
  out += `\`\`\`bash\nnpx tsx plugin/scripts/dot-guild/migrate-guild.ts --accept-grades --root=${child.root}\n\`\`\`\n\n`;
  out += `\`--accept-grades\` strips the \`importance_draft\`/\`graded_by\` markers and keeps the\n`;
  out += `grade. Until accepted, wiki lint flags these pages as a pending-review item.\n`;
  return out;
}
