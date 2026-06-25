#!/usr/bin/env npx tsx
/**
 * docs-hygiene/scan.ts
 *
 * Deterministic hygiene scan over the docs-clean-up in-scope corpora.
 * Emits a flag list to .guild/initiatives/active/docs-clean-up/artifacts/scan-flag-list.md
 * which Lane C consumes as its worklist.
 *
 * Rules applied (per ADR docs/knowledge/decisions/knowledge-base-hygiene-and-grading.md):
 *   1. Drift markers  — v1/single-repo references: /guild-* v1 commands, pre-v2 paths
 *   2. Progress messaging — C.3 seed regex (RECALIBRATED — requires co-occurrence with date/sprint/TODO)
 *   3. Dangling related: slugs — slug doesn't map to any existing page
 *   4. Dangling source_refs: paths — file path doesn't exist on disk (excludes .guild/ paths per F-4)
 *   5. Missing importance: — canonical pages (not research/ideation/landing files) missing importance:
 *   6. Secrets grep — API keys, tokens, PEM blocks, password= lines
 *   7. Pending grade review — pages still carrying `importance_draft: true` (a
 *      v1→v2 migration drafted the grade; the operator has not accepted it via
 *      `migrate-guild.ts --accept-grades` yet — see plugin/MIGRATION.md)
 *
 * RECALIBRATION (2026-05-28, Lane D-validate, docs-clean-up initiative):
 *   Lane C revealed high false-positive rates in the original rules:
 *
 *   Rule 1 (Drift markers) — 88 flagged, 1 real fix, 87 false positives.
 *   The original scan over-matched `supersedes:` frontmatter and `source_refs:` bookkeeping
 *   lines that legitimately cite v1 paths as the superseded source. Fixed by:
 *   - Skipping any line that contains "supersedes" + a path (these are supersession bookkeeping).
 *   - Skipping frontmatter lines starting with `supersedes:` or `source_refs:`.
 *   - Keeping the scan only on body-prose lines (not frontmatter).
 *
 *   Rule 2 (Progress messaging) — 2073 flagged, 2 real fixes, ~2071 false positives (~99%).
 *   The original C.3 patterns over-matched Guild's own architectural vocabulary:
 *   - `G-spec`, `G-plan`, `G-quality`, `G-operations` are permanent design vocabulary (not progress).
 *   - `P0..P7C` pipeline stages are architectural concepts (not sprint refs).
 *   - `status: proposed/accepted/active` are system field names in ADRs, not session state.
 *   - "currently" / "for now" describing persistent system states or design rationale.
 *   Fixed by requiring ONE of these co-occurrence signals before flagging:
 *   - An explicit date stamp (YYYY-MM-DD or "YYYY-MM") adjacent.
 *   - A sprint/wave ordinal ("Wave-N", "Sprint N", "sprint N").
 *   - An explicit "TODO" or "WIP" marker.
 *   - Temporal verbs in a clearly past-tense narrative ("we then did", "previously we", "we did X then Y").
 *
 *   Rule 4 (Dangling source_refs) — F-4 exemption now explicit:
 *   Paths beginning with `.guild/` are self-build provenance refs (not drift).
 *   These were already skipped by the WORKSPACE check but are now documented as the F-4 exemption.
 *
 * Usage:
 *   npx tsx plugin/scripts/docs-hygiene/scan.ts [--workspace=/path/to/guild]
 *
 * The --workspace flag defaults to the git root (two levels above this script).
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { parseFrontmatter as parseSharedFrontmatter } from "../lib/frontmatter";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const workspaceArg = args.find((a) => a.startsWith("--workspace="));
// docs-hygiene/ → scripts/ → plugin/ → workspace root = three "..".
// Previous "../../../.." went one level too high and produced output paths
// like /Users/<NAME>/Projects/.guild/ (sibling of the actual workspace).
const WORKSPACE = workspaceArg
  ? workspaceArg.split("=")[1]
  : path.resolve(__dirname, "../../..");

const DOCS_KNOWLEDGE = path.join(WORKSPACE, "docs/knowledge");
const PLUGIN_WIKI = path.join(WORKSPACE, "plugin/.guild/wiki");
const PLUGIN_DOCS = path.join(WORKSPACE, "plugin/docs");
const MIGRATION_MD = path.join(WORKSPACE, "MIGRATION.md");
const AGENTS_MD = path.join(WORKSPACE, "AGENTS.md");
const ROOT_README = path.join(WORKSPACE, "README.md");
const PLUGIN_README = path.join(WORKSPACE, "plugin/README.md");
const PLUGIN_CLAUDE = path.join(WORKSPACE, "plugin/CLAUDE.md");

// Default output location is script-local + transient. Override via --output.
// Previously hardcoded to .guild/initiatives/active/docs-clean-up/artifacts/
// which broke once docs-clean-up was archived (D8 close re-spawned an orphan
// active/ dir on each scan).
const outputArg = args.find((a) => a.startsWith("--output="));
const OUTPUT_PATH = outputArg
  ? path.resolve(outputArg.split("=")[1])
  : path.resolve(__dirname, ".last-scan.md");
const OUTPUT_DIR = path.dirname(OUTPUT_PATH);

// Canonical page: under docs/knowledge, NOT under research/ or ideation/,
// NOT one of the landing file names (A.3 + A.4 from the ADR).
const LANDING_FILE_NAMES = new Set([
  "README.md",
  "index.md",
  "QUERY.md",
  "TRANSFER-MANIFEST.md",
  "MIGRATION.md",
]);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Flag {
  category: "drift" | "progress-msg" | "dangling-related" | "dangling-source-refs" | "missing-importance" | "secrets" | "pending-grade-review";
  file: string;   // relative to WORKSPACE
  lines: string;  // "L42" or "L42-45" or "all"
  pattern: string;
  match: string;
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function relPath(p: string): string {
  return p.startsWith(WORKSPACE) ? p.slice(WORKSPACE.length + 1) : p;
}

function walkFiles(dir: string, filter = /\.md$/): string[] {
  if (!fs.existsSync(dir)) return [];
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkFiles(full, filter));
    } else if (entry.isFile() && filter.test(entry.name)) {
      results.push(full);
    }
  }
  return results;
}

function readFile(p: string): string {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return "";
  }
}

function parseFrontmatter(content: string): Record<string, string> | null {
  // Shared js-yaml parser (OD-3). Consumers read only scalar fields
  // (importance, type, confidence, importance_draft, graded_by), so each value
  // is String()-coerced to preserve the old Record<string,string> shape.
  const obj = parseSharedFrontmatter(content);
  if (obj === null) return null;
  const fm: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    fm[k] = v === null || v === undefined ? "" : String(v);
  }
  return fm;
}

/** Extract the slug from a list item line: "  - some-slug   # comment" */
function extractListSlugs(value: string, lines: string[]): string[] {
  // value is the rest of the line after "related:"
  // If it's "[slug1, slug2]" or "[]"
  const slugs: string[] = [];
  const inlineMatch = value.match(/^\s*\[([^\]]*)\]/);
  if (inlineMatch) {
    for (const s of inlineMatch[1].split(",")) {
      const t = s.trim().replace(/#.*$/, "").trim();
      if (t) slugs.push(t);
    }
    return slugs;
  }
  // multiline list
  for (const line of lines) {
    if (!line.startsWith("  ")) break;
    const m = line.match(/^\s+-\s+(.+)/);
    if (m) {
      const t = m[1].trim().replace(/#.*$/, "").trim();
      if (t) slugs.push(t);
    }
  }
  return slugs;
}

function lineNumber(content: string, idx: number): number {
  return content.slice(0, idx).split("\n").length;
}

// ---------------------------------------------------------------------------
// Scan rules
// ---------------------------------------------------------------------------

const flags: Flag[] = [];

function addFlag(f: Flag) {
  flags.push(f);
}

// ---- 1. Drift markers -------------------------------------------------------
// Patterns that indicate v1/single-repo assumptions surviving into v2 docs.
//
// RECALIBRATED (2026-05-28): exclude supersession bookkeeping lines.
// `supersedes:` / `source_refs:` frontmatter and any line containing
// "supersedes <path>" are LEGITIMATE v2-cites-v1 references — not drift.
// Only body-prose lines that assume single-repo or v1 command forms are flagged.
//
// RECALIBRATED (2026-06-13): the `single-repo` pattern also exempts
// workspace-AWARE lines (those naming `is_workspace` / the `workspace` concept)
// via isWorkspaceAwareLine — prose describing the workspace-vs-non-workspace
// distinction is not a surviving v1 assumption. Scoped to the single-repo
// pattern only (covered by docs-hygiene-drift-workspace-aware.test.ts).
const DRIFT_PATTERNS: Array<[RegExp, string]> = [
  // v1 command prefix in user-visible text (not in quoted code that's documenting v1→v2 migration)
  [/\/guild-(?:wiki|init|ideate|plan|build|qa|ops|evolve|rollback|stats|audit|fix|status|resume|config|initiative|learn)\b/, "v1 /guild-* command reference"],
  // Single-repo assumption: assuming plugin/ IS the entire repo
  [/\bsingle.?repo\b/i, "single-repo assumption"],
  // Pre-v2 path assumptions (commands/guild-*.md references outside provenance docs)
  [/commands\/guild-(?:wiki|evolve|rollback|stats|audit|init|plan|ideate|build|ops|qa|fix|status|resume|config|initiative|learn)\.md/, "v1 commands/ file path"],
];

/**
 * Returns true if a line is supersession bookkeeping (not body-prose drift).
 * Lines like:
 *   supersedes: plugin/guild-plan.md
 *   source_refs:
 *     - plugin/docs/something.md
 *   "supersedes plugin/guild-plan.md" prose
 */
function isSupersessionBookkeeping(line: string): boolean {
  const t = line.trim();
  // Frontmatter supersedes: or source_refs: lines
  if (/^(?:supersedes):\s/.test(t)) return true;
  if (/^(?:source_refs):\s/.test(t)) return true;
  if (/^\s*-\s+/.test(t) && /supersedes|source_refs/.test(t)) return true;
  // Prose "supersedes <path>" — legitimate v2-cites-v1 reference in ADR body
  if (/\bsupersedes\b/.test(t)) return true;
  return false;
}

/**
 * Returns true if a line is WORKSPACE-AWARE — it references the v2 workspace
 * data model rather than assuming a lone repo. Recalibrated 2026-06-13.
 *
 * The `single-repo` drift pattern over-matches legitimate v2 prose that
 * DESCRIBES the workspace-vs-non-workspace distinction — e.g.
 *   "Always present; `is_workspace:false` for single-repo."
 *   "Human label, e.g. `guild (workspace root)` or a single repo name."
 *   "**Single-repo (`is_workspace: false`):** both keys are inert."
 * A line that names the `is_workspace` field or the `workspace` concept is by
 * construction workspace-aware (it handles both cases), not a surviving v1
 * single-repo assumption. Scoped to the "single-repo assumption" pattern only
 * (see the drift loop) — v1 command/path patterns are never exempted by this.
 */
function isWorkspaceAwareLine(line: string): boolean {
  const t = line.trim();
  if (/\bis_workspace\b/i.test(t)) return true;
  if (/\bworkspace\b/i.test(t)) return true;
  return false;
}

/**
 * Returns true if a line carries an explicit v1→v2 lineage marker.
 * Recalibrated 2026-05-28 (task-2-evolve follow-up): the prior pattern
 * over-matched lines that deliberately cite a v1 path inside a v2-authored
 * passage marking it as the frozen historical record (e.g. `plugin/guild-plan.md`
 * referenced as "the frozen v1 record" in command-surface.md). These are
 * LOAD-BEARING lineage callouts, not drift.
 *
 * The exemption is line-local — only lines that ALSO carry one of these
 * markers near the v1 reference are exempted. A bare `commands/guild-init.md`
 * with no lineage context still flags.
 */
const LINEAGE_MARKERS = [
  /\bfrozen v1\b/i,
  /\bv1 record\b/i,
  /\bv1 name:\s*/i,
  /\bv1 path\b/i,
  /\bv1 7-step\b/i,
  /\bv2 note:/i,
  /\bbanner only\b/i,
  /\bv1[→>-]v2\b/i,
  /\bsuperseded by\b/i,
  /\bfrozen as\b/i,
  /\b(?:is|are|stays?) frozen\b/i,
  /architecture-draft record/i,
];

function isExplicitLineageReference(line: string): boolean {
  const t = line.trim();
  return LINEAGE_MARKERS.some((m) => m.test(t));
}

/**
 * Scans the previous N lines for a lineage marker. Handles multi-line bullet
 * items where the marker is on line K and the v1 reference on line K+1..K+N.
 * Example (`v2x-command-surface-dispatch-and-internalization.md` L319-L321):
 *
 *   - `guild-plan.md §5` ... are superseded; `guild-plan.md` stays the
 *     frozen v1 record and gains conceptual `supersedes:` pointers
 *     (recorded in prose only — this ADR does not edit `plugin/guild-plan.md`).
 *
 * The first line carries "stays the frozen v1 record"; the second-and-third
 * lines carry the v1 reference but no marker. All three lines belong to the
 * same bullet — exempt all three.
 */
function hasLineagePrior(contentLines: string[], idx: number, lookback = 3): boolean {
  for (let k = Math.max(0, idx - lookback); k < idx; k++) {
    if (isExplicitLineageReference(contentLines[k])) return true;
  }
  return false;
}

/**
 * File-level exemption: returns true if the file's body opens with an explicit
 * "v2 note:" or "frozen v1 record" callout that puts the whole doc in
 * historical-provenance mode. Recalibrated 2026-05-28.
 *
 * The check scans the first 60 body lines (skipping frontmatter). A single
 * callout is enough — the doc has self-marked its provenance status.
 */
function isFrozenV1Doc(content: string): boolean {
  const lines = content.split("\n");
  let i = 0;
  // Skip frontmatter
  if (lines[0]?.slice(0, 3) === "---") {
    i = 1;
    while (i < lines.length && lines[i].trim() !== "---") i++;
    i++; // past closing ---
  }
  const head = lines.slice(i, i + 60).join("\n");
  if (/\bv2 note:/i.test(head)) return true;
  if (/\bfrozen v1 record\b/i.test(head)) return true;
  if (/\barchitecture-draft record\b/i.test(head)) return true;
  return false;
}

/**
 * Returns true if the file is a provenance/historical document where v1 references
 * are LEGITIMATE (not drift). Provenance docs include:
 *   - research/ and ideation/ directories (always exempt)
 *   - implementation/phases/ (phase docs document the v1→v2 migration step-by-step)
 *   - plugin/docs/superpowers/ and plugin/docs/phase-gates/ (historical self-build logs)
 *   - plugin/docs/audit/ (historical audit logs)
 *   - Any doc in docs/knowledge/decisions/ that has a `supersedes:` frontmatter key
 *     (those files are the v2 decisions that explicitly cite v1)
 */
function isProvenanceDoc(rel: string): boolean {
  if (rel.includes("/research/") || rel.includes("/ideation/")) return true;
  if (rel.includes("implementation/phases/")) return true;
  if (rel.includes("plugin/docs/superpowers/")) return true;
  if (rel.includes("plugin/docs/phase-gates/")) return true;
  if (rel.includes("plugin/docs/audit/")) return true;
  return false;
}

function scanDrift(corpus: string[], excludeResearch = true) {
  for (const fpath of corpus) {
    const rel = relPath(fpath);
    // Skip provenance/historical docs (references are historical/legitimate)
    if (isProvenanceDoc(rel)) continue;
    // Legacy excludeResearch flag (now subsumed by isProvenanceDoc but kept for compat)
    if (excludeResearch && (rel.includes("/research/") || rel.includes("/ideation/"))) continue;
    const content = readFile(fpath);
    // File-level exemption: docs self-marked as "frozen v1 record" / "v2 note:" callouts
    // are historical provenance; their v1 references are deliberate lineage citations.
    // Recalibrated 2026-05-28 (task-2-evolve follow-up).
    if (isFrozenV1Doc(content)) continue;
    const contentLines = content.split("\n");

    // Detect frontmatter boundary
    let inFrontmatter = false;
    let fmEnded = false;
    if (content.slice(0, 3) === "---") {
      inFrontmatter = true;
    }
    let fmEndLine = -1;
    for (let i = 1; i < contentLines.length; i++) {
      if (inFrontmatter && contentLines[i].trim() === "---") {
        fmEndLine = i;
        inFrontmatter = false;
        fmEnded = true;
        break;
      }
    }

    for (const [pattern, label] of DRIFT_PATTERNS) {
      for (let i = 0; i < contentLines.length; i++) {
        const lineIdx = i;
        // Skip frontmatter lines (they contain legitimate v1 paths in source_refs/supersedes)
        if (fmEnded && lineIdx <= fmEndLine) continue;
        if (!fmEnded && inFrontmatter) continue;

        const line = contentLines[i];
        if (!pattern.test(line)) continue;

        // Skip supersession bookkeeping lines in body (e.g. "supersedes plugin/guild-plan.md" prose)
        if (isSupersessionBookkeeping(line)) continue;

        // Skip lines with explicit v1→v2 lineage markers — these are deliberate
        // historical citations in v2 docs, not drift. Recalibrated 2026-05-28.
        if (isExplicitLineageReference(line)) continue;
        // Skip multi-line bullet continuations where the marker is on a prior
        // line of the same bullet (3-line lookback handles typical 2-3 line items).
        if (hasLineagePrior(contentLines, i, 3)) continue;

        // Skip "single-repo assumption" hits on workspace-AWARE lines — prose
        // that references the `is_workspace` field or the `workspace` concept is
        // documenting the workspace-vs-non-workspace distinction, not assuming a
        // lone repo. Scoped to this pattern only. Recalibrated 2026-06-13.
        if (label === "single-repo assumption" && isWorkspaceAwareLine(line)) continue;

        addFlag({
          category: "drift",
          file: rel,
          lines: `L${i + 1}`,
          pattern: label,
          match: line.trim().slice(0, 120),
        });
      }
    }
  }
}

// ---- 2. Progress messaging --------------------------------------------------
// RECALIBRATED (2026-05-28): require co-occurrence signals to avoid the ~99%
// false-positive rate seen against Guild's architectural vocabulary.
//
// The original C.3 patterns matched:
//   - G-spec/G-plan/G-quality/G-operations (permanent design vocab, NOT progress)
//   - P0..P7C pipeline stage names (architectural concepts, NOT sprint refs)
//   - status: proposed/accepted/active (ADR system field names, NOT session state)
//   - "currently describing persistent system states" / "for now (simplicity-first)"
//   - emoji used in architecture tables (checkmarks = permanent, not task boards)
//
// NEW APPROACH: only flag when a session/progress signal co-occurs with one of:
//   A. An explicit date-stamp adjacent (YYYY-MM-DD or YYYY-MM).
//   B. An explicit "TODO" or "WIP" inline marker.
//   C. Clearly past-tense narrative verbs: "we then", "previously we", "we did X then Y".
//   D. A sprint/wave ordinal used as status (Wave-N combined with session-start verb).
//
// Applied to canonical docs only (not research/ideation provenance).

/**
 * Returns true if a line has a co-occurrence signal that makes it genuine progress messaging.
 * Signals: adjacent date stamp, TODO/WIP marker, past-tense narrative verbs,
 * or a sprint/wave ordinal combined with session-start verbs.
 */
function hasProgressCoOccurrence(line: string): boolean {
  // A. Date stamp adjacent (YYYY-MM-DD or YYYY-MM)
  if (/\b20\d\d-\d\d(-\d\d)?\b/.test(line)) return true;
  // B. Explicit TODO or WIP
  if (/\b(TODO|WIP)\b/.test(line)) return true;
  // C. Past-tense narrative verbs (session changelog language)
  if (/\b(we then|previously we|we did|then we|after that|next batch|coming next)\b/i.test(line)) return true;
  // D. Sprint/wave ordinal + session verb (e.g. "Wave-3 is done", "in this sprint we")
  if (/\b(Wave-?\d+|Sprint\s+\d+)\b.{0,50}\b(done|complete|finished|started|in progress|blocked|shipped)\b/i.test(line)) return true;
  if (/\bin this (wave|sprint|session|initiative)\b/i.test(line)) return true;
  return false;
}

const PROGRESS_PATTERNS: Array<[RegExp, string]> = [
  // C.3-pattern-1: phase/session status narrative — only flagged with co-occurrence signal
  [/\b(as of|we then|previously we|coming next|next batch)\b/i, "C.3-pattern-1: session/changelog narrative (strong signal)"],
  // C.3-pattern-2: progress emoji — only flagged with co-occurrence (❌/✅/🚧 are used in architecture tables too)
  [/[✅🚧⬜]/, "C.3-pattern-2: progress emoji (verify: task-board vs architecture table)"],
  // C.3-pattern-3: wave/phase/gate — ONLY if accompanied by a session-status signal (not bare architectural vocab)
  [/\bWave-?\d+\b/, "C.3-pattern-3: wave ordinal — check if sprint-status or architectural reference"],
];

function scanProgressMsg(corpus: string[]) {
  for (const fpath of corpus) {
    const rel = relPath(fpath);
    // Only canonical pages (not research/ideation, not landing files, not phase/audit/superpowers provenance)
    if (rel.includes("/research/") || rel.includes("/ideation/")) continue;
    if (isProvenanceDoc(rel)) continue;
    const bname = path.basename(fpath);
    if (LANDING_FILE_NAMES.has(bname)) continue;

    const content = readFile(fpath);
    const contentLines = content.split("\n");

    // Detect frontmatter boundary (skip frontmatter for progress messaging)
    let fmEndLine = -1;
    if (content.slice(0, 3) === "---") {
      for (let i = 1; i < contentLines.length; i++) {
        if (contentLines[i].trim() === "---") { fmEndLine = i; break; }
      }
    }

    // File-level exemption: roadmap docs are state-tracking by purpose.
    // post-v2-roadmap.md (and any *roadmap*.md) carries milestone-completion
    // markers as load-bearing content. Recalibrated 2026-05-28.
    const bnameLower = bname.toLowerCase();
    if (bnameLower.includes("roadmap")) continue;

    for (const [pattern, label] of PROGRESS_PATTERNS) {
      for (let i = 0; i < contentLines.length; i++) {
        // Skip frontmatter
        if (fmEndLine >= 0 && i <= fmEndLine) continue;

        const line = contentLines[i];
        if (!pattern.test(line)) continue;

        // Skip if this is the hygiene ADR itself defining the patterns (meta-definition,
        // not an instance of the pattern). The ADR is the source of truth for what the
        // patterns mean — it will always contain the pattern strings as examples.
        const trimmed = line.trim();
        if (rel.includes("knowledge-base-hygiene-and-grading")) continue;

        // Skip lines inside code blocks (they may be showing examples of patterns)
        // Simple heuristic: skip if the line is indented 4+ spaces (code fence content)
        // or starts with ``` — better to leave those for human review than to over-flag
        if (trimmed.startsWith("```") || trimmed.startsWith("    ")) continue;

        // Skip ADR ratification / status-block markers — load-bearing decision
        // provenance, not progress messaging. Recalibrated 2026-05-28.
        // Examples: "Accepted (operator-ratified 2026-05-26)" "ratified 2026-05-26"
        if (/\bAccepted\s*\(/.test(line)) continue;
        if (/\boperator-ratified\b/i.test(line)) continue;
        if (/\bratified\s+20\d\d/i.test(line)) continue;

        // Skip evidence-table commit-provenance rows: a backticked short SHA
        // (7-12 hex chars) co-occurring with a wave/date tuple. Example:
        //   | `hooks/lib/foo.ts` | 1243 | yes | `9bef0c7` (2026-05-26, Wave-4 v2 commit) |
        // These rows cite specific commits for ADR provenance — not progress.
        if (/`[0-9a-f]{7,12}`\s*\([^)]*Wave-?\d+/.test(line)) continue;

        // For pattern-2 (emoji) and pattern-3 (Wave-N), require a co-occurrence signal
        const isWeakPattern = label.includes("C.3-pattern-2") || label.includes("C.3-pattern-3");
        if (isWeakPattern && !hasProgressCoOccurrence(line)) continue;

        // For pattern-1 strong signals (as of, we then, etc.) — flag directly
        // For pattern-1 weak signals (currently, for now, status:) — require co-occurrence
        if (label.includes("C.3-pattern-1")) {
          // The refined pattern-1 already only includes strong signals above
        }

        addFlag({
          category: "progress-msg",
          file: rel,
          lines: `L${i + 1}`,
          pattern: label,
          match: trimmed.slice(0, 120),
        });
      }
    }
  }
}

// ---- 3. Dangling related: slugs --------------------------------------------
// Extract all page slugs from docs/knowledge (full set), then check related: values
function buildSlugSet(): Set<string> {
  const slugs = new Set<string>();
  for (const fpath of walkFiles(DOCS_KNOWLEDGE)) {
    const slug = path.basename(fpath, ".md");
    slugs.add(slug);
  }
  return slugs;
}

function scanDanglingRelated(corpus: string[], slugSet: Set<string>) {
  for (const fpath of corpus) {
    const rel = relPath(fpath);
    // Skip provenance corpus (research/ ideation/ related: slugs will be cleaned up
    // when those pages are promoted to canonical — deferred per Lane C analysis)
    if (rel.includes("/research/") || rel.includes("/ideation/")) continue;
    const content = readFile(fpath);
    const contentLines = content.split("\n");

    // Only look in frontmatter
    if (content.slice(0, 3) !== "---") continue;
    const fmEnd = content.indexOf("---", 3);
    if (fmEnd < 0) continue;
    const fmLines = content.slice(3, fmEnd).split("\n");

    let inRelated = false;
    let startLineOffset = 1; // offset within full file (line 1 = first line after opening ---)
    let fmLineIdx = 0;

    for (const fmLine of fmLines) {
      fmLineIdx++;
      const fileLineNo = fmLineIdx + 1; // +1 for opening ---
      if (fmLine.startsWith("related:")) {
        inRelated = true;
        // inline: related: [slug1, slug2]
        const inlineMatch = fmLine.match(/:\s*\[([^\]]*)\]/);
        if (inlineMatch) {
          for (const s of inlineMatch[1].split(",")) {
            const t = s.trim().replace(/#.*$/, "").trim();
            if (t && t !== "<slugs>" && !slugSet.has(t)) {
              addFlag({
                category: "dangling-related",
                file: rel,
                lines: `L${fileLineNo}`,
                pattern: "related: slug not found as page",
                match: `related slug: ${t}`,
              });
            }
          }
          inRelated = false;
        }
        continue;
      }
      if (inRelated) {
        if (fmLine.startsWith("  ") || fmLine.startsWith("\t")) {
          const m = fmLine.match(/^\s+-\s+(.+)/);
          if (m) {
            const t = m[1].trim().replace(/#.*$/, "").trim();
            if (t && t !== "<slugs>" && !slugSet.has(t)) {
              addFlag({
                category: "dangling-related",
                file: rel,
                lines: `L${fileLineNo}`,
                pattern: "related: slug not found as page",
                match: `related slug: ${t}`,
              });
            }
          }
        } else {
          inRelated = false;
        }
      }
    }
  }
}

// ---- 4. Dangling source_refs: paths ----------------------------------------
// Only check refs that look like file paths (contain / or end with .md or .ts etc.)
// Research and ideation source_refs are provenance back-links (deferred cleanup — issue: oc-docs-sourcing)
function scanDanglingSourceRefs(corpus: string[]) {
  const pathLike = /^[./]|\/|\.(md|ts|js|json|yaml|yml)($|\s)/;

  for (const fpath of corpus) {
    const rel = relPath(fpath);
    // Skip provenance corpus for source_refs check (same rationale as dangling-related)
    if (rel.includes("/research/") || rel.includes("/ideation/")) continue;
    const content = readFile(fpath);

    if (content.slice(0, 3) !== "---") continue;
    const fmEnd = content.indexOf("---", 3);
    if (fmEnd < 0) continue;
    const fmText = content.slice(3, fmEnd);
    const fmLines = fmText.split("\n");

    let inSourceRefs = false;
    let fmLineIdx = 0;

    for (const fmLine of fmLines) {
      fmLineIdx++;
      const fileLineNo = fmLineIdx + 1;
      if (fmLine.startsWith("source_refs:")) {
        inSourceRefs = true;
        // check inline: source_refs: [path1]
        const inlineMatch = fmLine.match(/:\s*\[([^\]]*)\]/);
        if (inlineMatch) {
          for (const s of inlineMatch[1].split(",")) {
            const t = s.trim().replace(/"'/g, "").replace(/#.*$/, "").trim();
            checkSourceRef(t, rel, `L${fileLineNo}`);
          }
          inSourceRefs = false;
        }
        continue;
      }
      if (inSourceRefs) {
        if (fmLine.startsWith("  ") || fmLine.startsWith("\t")) {
          const m = fmLine.match(/^\s+-\s+"?([^"#\n]+)"?\s*(?:#.*)?$/);
          if (m) {
            const t = m[1].trim();
            if (pathLike.test(t)) {
              checkSourceRef(t, rel, `L${fileLineNo}`);
            }
          }
        } else if (!fmLine.match(/^\s*$/)) {
          inSourceRefs = false;
        }
      }
    }
  }
}

function checkSourceRef(ref: string, sourceFile: string, lineLabel: string) {
  if (!ref || ref === "[]" || ref === "null") return;
  // Normalize: strip inline comments
  const clean = ref.replace(/#.*$/, "").trim().replace(/^["']|["']$/g, "");
  if (!clean || !clean.includes("/")) return; // slug-only refs are handled by dangling-related check

  // F-4 EXEMPTION (explicit, 2026-05-28): paths starting with .guild/ or pointing INTO
  // a .guild/ directory (e.g. plugin/.guild/architecture-research-*/) are self-build
  // provenance refs — they point into gitignored .guild/ runtime state which is
  // legitimately absent from the committed tree. These are NOT drift.
  if (clean.startsWith(".guild/")) return;
  if (clean.includes("/.guild/")) return;

  // Resolve: if starts with . or /, treat as relative to workspace
  let checkPath: string;
  if (clean.startsWith("/")) {
    checkPath = clean;
  } else if (clean.startsWith("docs/") || clean.startsWith("plugin/") || clean.startsWith("benchmark/") || clean.startsWith("mcp-servers/") || clean.startsWith("website/") || clean.startsWith("scripts/") || clean.startsWith("hooks/")) {
    checkPath = path.join(WORKSPACE, clean);
  } else if (clean.startsWith("external-input/")) {
    // external-input/ refs are citations of external artifacts (npm packages, external repos)
    // that are never committed to disk — these are NOT dangling refs.
    return;
  } else {
    // relative to source file directory
    checkPath = path.join(WORKSPACE, path.dirname(sourceFile), clean);
  }

  // Remove section anchors like " §4.4"
  const withoutSection = checkPath.split(" ")[0];

  if (!fs.existsSync(withoutSection)) {
    addFlag({
      category: "dangling-source-refs",
      file: sourceFile,
      lines: lineLabel,
      pattern: "source_refs: path not found on disk",
      match: `source_ref: ${clean.slice(0, 100)}`,
    });
  }
}

// ---- 5. Missing importance: ------------------------------------------------
function isCanonicalPage(fpath: string): boolean {
  const rel = relPath(fpath);
  if (!rel.startsWith("docs/knowledge/")) return false;
  if (rel.includes("/research/")) return false;
  if (rel.includes("/ideation/")) return false;
  const bname = path.basename(fpath);
  if (LANDING_FILE_NAMES.has(bname)) return false;
  return true;
}

function scanMissingImportance(corpus: string[]) {
  for (const fpath of corpus) {
    if (!isCanonicalPage(fpath)) continue;
    const content = readFile(fpath);
    const fm = parseFrontmatter(content);
    if (!fm) {
      // No frontmatter at all — also flag but don't double-flag
      addFlag({
        category: "missing-importance",
        file: relPath(fpath),
        lines: "L1",
        pattern: "canonical page has no frontmatter",
        match: path.basename(fpath),
      });
      continue;
    }
    if (!fm["importance"]) {
      addFlag({
        category: "missing-importance",
        file: relPath(fpath),
        lines: "L1",
        pattern: "importance: field absent on canonical page",
        match: `type:${fm["type"] || "??"} confidence:${fm["confidence"] || "??"}`,
      });
    } else {
      const valid = ["critical", "high", "medium", "low"];
      if (!valid.includes(fm["importance"])) {
        addFlag({
          category: "missing-importance",
          file: relPath(fpath),
          lines: "L1",
          pattern: "importance: value not in enum (critical|high|medium|low)",
          match: `importance: ${fm["importance"]}`,
        });
      }
    }
  }
}

// ---- 7. Pending grade review (migration draft grades) -----------------------
// The v1→v2 migration (`/guild:migrate` — plugin/scripts/dot-guild/convert/
// wiki-importance.ts) drafts `importance:` grades onto ungraded wiki pages and
// marks them `importance_draft: true` + `graded_by: guild-migrate` behind a
// human review gate. Pages still carrying the draft marker have NOT been
// reviewed/accepted (`migrate-guild.ts --accept-grades`) — flag them as a
// pending-review item until the operator accepts. Deterministic frontmatter
// predicate; no exemptions (a draft marker is pending wherever it appears).
function scanPendingGradeReview(corpus: string[]) {
  for (const fpath of corpus) {
    const content = readFile(fpath);
    const fm = parseFrontmatter(content);
    if (!fm) continue;
    if (fm["importance_draft"] === "true") {
      addFlag({
        category: "pending-grade-review",
        file: relPath(fpath),
        lines: "L1",
        pattern: "importance_draft: true — migration-drafted grade awaiting operator review",
        match: `importance: ${fm["importance"] || "??"} graded_by: ${fm["graded_by"] || "??"}`,
      });
    }
  }
}

// ---- 6. Secrets grep -------------------------------------------------------
export const SECRET_PATTERNS: Array<[RegExp, string]> = [
  // NOTE: labels deliberately drop the `=` so the redaction replacement
  // (e.g. `<REDACTED:password-assignment>`) cannot itself re-match the pattern
  // on a subsequent scrub pass. Idempotency depends on this.
  [/password\s*=\s*["']?[^\s"']{6,}/, "password-assignment"],
  [/api_key\s*=\s*["']?[^\s"']{6,}/i, "api_key-assignment"],
  [/secret\s*=\s*["']?[^\s"']{8,}/i, "secret-assignment"],
  [/AKIA[0-9A-Z]{16}/, "AWS access key"],
  [/AIza[0-9A-Za-z_-]{35}/, "GCP API key"],
  [/ghp_[0-9A-Za-z]{36}/, "GitHub personal access token"],
  [/ghs_[0-9A-Za-z]{36}/, "GitHub server token"],
  [/-----BEGIN (?:RSA |EC )?PRIVATE KEY/, "PEM private key block"],
  // High-entropy string heuristic: 40+ hex chars (SHA-like)
  [/\b[0-9a-f]{40,}\b/, "high-entropy hex string (potential secret)"],
];

function scanSecrets(corpus: string[]) {
  for (const fpath of corpus) {
    const rel = relPath(fpath);
    const content = readFile(fpath);
    const contentLines = content.split("\n");
    for (const [pattern, label] of SECRET_PATTERNS) {
      for (let i = 0; i < contentLines.length; i++) {
        if (pattern.test(contentLines[i])) {
          // Suppress the high-entropy hex check for known-safe contexts (git SHAs in commit references)
          if (label === "high-entropy hex string (potential secret)") {
            const line = contentLines[i];
            // Skip lines that look like git commit SHAs in context (common in docs)
            if (/\b(commit|sha|HEAD|merge|tag|heads?)\b/i.test(line)) continue;
            // Skip code blocks showing example hashes
            if (line.trim().startsWith("```") || line.trim().startsWith("#")) continue;
          }
          addFlag({
            category: "secrets",
            file: rel,
            lines: `L${i + 1}`,
            pattern: label,
            match: contentLines[i].trim().slice(0, 80).replace(/[^\x20-\x7E]/g, "?"),
          });
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// FU-A: bail out when this module is imported (e.g. by scrub.ts which needs
// SECRET_PATTERNS only). Without this guard the entire scan runs every time
// scrub.ts does `require('scan.ts')`, producing stray scan-flag-list.md
// files in any cwd the scrub touches (observed: benchmark + website during
// the share-dot-guild commit).
// ---------------------------------------------------------------------------
if (require.main === module) {

// ---------------------------------------------------------------------------
// Collect corpora
// ---------------------------------------------------------------------------

const docsKnowledgeFiles = walkFiles(DOCS_KNOWLEDGE);
const pluginWikiFiles = walkFiles(PLUGIN_WIKI);
const pluginDocsFiles = walkFiles(PLUGIN_DOCS);
const rootFiles = [MIGRATION_MD, AGENTS_MD, ROOT_README, PLUGIN_README, PLUGIN_CLAUDE].filter(
  fs.existsSync
);

// Full in-scope corpus
const allCorpus = [
  ...docsKnowledgeFiles,
  ...pluginWikiFiles,
  ...pluginDocsFiles,
  ...rootFiles,
];

// Canonical corpus (for missing-importance)
const canonicalCorpus = docsKnowledgeFiles.filter((f) => isCanonicalPage(f));

// ---------------------------------------------------------------------------
// Run scans
// ---------------------------------------------------------------------------

console.error("Running drift scan...");
scanDrift(allCorpus, false); // excludeResearch=false: we flag everywhere, mark source in file rel path

console.error("Running progress-messaging scan...");
scanProgressMsg(allCorpus);

console.error("Building slug set...");
const slugSet = buildSlugSet();

console.error("Running dangling-related scan...");
scanDanglingRelated(allCorpus, slugSet);

console.error("Running dangling-source-refs scan...");
scanDanglingSourceRefs(allCorpus);

console.error("Running missing-importance scan...");
scanMissingImportance(docsKnowledgeFiles);

console.error("Running secrets scan...");
scanSecrets(allCorpus);

console.error("Running pending-grade-review scan...");
scanPendingGradeReview(allCorpus);

// ---------------------------------------------------------------------------
// Emit flag list
// ---------------------------------------------------------------------------

const counts: Record<Flag["category"], number> = {
  drift: 0,
  "progress-msg": 0,
  "dangling-related": 0,
  "dangling-source-refs": 0,
  "missing-importance": 0,
  secrets: 0,
  "pending-grade-review": 0,
};
for (const f of flags) counts[f.category]++;

const now = new Date().toISOString().slice(0, 10);

function renderSection(category: Flag["category"], title: string): string {
  const section = flags.filter((f) => f.category === category);
  if (section.length === 0) return `\n## ${title}\n\nNo findings.\n`;
  let out = `\n## ${title} (${section.length} flags)\n\n`;
  out += "| File | Lines | Pattern | Match |\n";
  out += "|---|---|---|---|\n";
  for (const f of section) {
    const matchSafe = f.match.replace(/\|/g, "\\|");
    out += `| \`${f.file}\` | ${f.lines} | ${f.pattern} | \`${matchSafe}\` |\n`;
  }
  return out;
}

const totalFlags = flags.length;

let output = `---
type: artifact
initiative: docs-clean-up
task: D-build
owner: eval-engineer
created_at: ${now}
---

# Scan flag list — docs-clean-up hygiene scan

Generated by \`plugin/scripts/docs-hygiene/scan.ts\` on ${now}.
Lane C consumes this as its worklist. **Flags are candidates, not auto-deletes** — Lane C reviews each against the ADR rules (see \`docs/knowledge/decisions/knowledge-base-hygiene-and-grading.md\`).

## Summary

| Category | Count |
|---|---|
| Drift markers (v1/single-repo) | ${counts["drift"]} |
| Progress messaging (C.3 patterns) | ${counts["progress-msg"]} |
| Dangling related: slugs | ${counts["dangling-related"]} |
| Dangling source_refs: paths | ${counts["dangling-source-refs"]} |
| Missing importance: on canonical page | ${counts["missing-importance"]} |
| Secrets grep | ${counts["secrets"]} |
| Pending grade review (importance_draft) | ${counts["pending-grade-review"]} |
| **Total** | **${totalFlags}** |

`;

output += renderSection("drift", "1. Drift markers (v1/single-repo)");
output += renderSection("progress-msg", "2. Progress messaging (C.3 patterns)");
output += renderSection("dangling-related", "3. Dangling related: slugs");
output += renderSection("dangling-source-refs", "4. Dangling source_refs: paths");
output += renderSection("missing-importance", "5. Missing importance: on canonical pages");
output += renderSection("secrets", "6. Secrets grep");
output += renderSection("pending-grade-review", "7. Pending grade review (migration draft grades)");

output += `
---

## How to use this list

1. For each **drift** flag: replace the v1 reference with its v2 equivalent per \`MIGRATION.md\`.
2. For each **progress-msg** flag: apply the C.2 keep-vs-delete test; DELETE outright if it is status/session narrative; KEEP if it is load-bearing rationale. **Escalate borderline cases to the gate.**
3. For each **dangling-related** flag: either correct the slug to match an existing page, or remove the stale entry.
4. For each **dangling-source-refs** flag: verify the path is still at the declared location; correct or remove.
5. For each **missing-importance** flag: apply the A.2 level definitions to assign \`importance: critical|high|medium|low\`. Marquee features default to \`critical\`.
6. For each **secrets** flag: investigate; if genuine secret, rotate + remove immediately.
7. For each **pending-grade-review** flag: the page carries a migration-drafted \`importance:\` grade (\`importance_draft: true\`). Review/edit the grade, then accept with \`npx tsx plugin/scripts/dot-guild/migrate-guild.ts --accept-grades --root=<repo>\` (see \`plugin/MIGRATION.md\`).

---

_Run: \`npx tsx plugin/scripts/docs-hygiene/scan.ts\` from the workspace root._
`;

fs.mkdirSync(OUTPUT_DIR, { recursive: true });
fs.writeFileSync(OUTPUT_PATH, output, "utf8");
console.log(OUTPUT_PATH);
console.error(`\nScan complete — ${totalFlags} total flags written to ${OUTPUT_PATH}`);
console.error(`  drift:             ${counts["drift"]}`);
console.error(`  progress-msg:      ${counts["progress-msg"]}`);
console.error(`  dangling-related:  ${counts["dangling-related"]}`);
console.error(`  dangling-source-refs: ${counts["dangling-source-refs"]}`);
console.error(`  missing-importance: ${counts["missing-importance"]}`);
console.error(`  secrets:           ${counts["secrets"]}`);
console.error(`  pending-grade-review: ${counts["pending-grade-review"]}`);

} // end if (require.main === module) — FU-A
