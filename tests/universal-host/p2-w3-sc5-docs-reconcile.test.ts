/**
 * tests/universal-host/p2-w3-sc5-docs-reconcile.test.ts
 *
 * AUTHORITATIVE acceptance test for SC-W3-5 (ADR step 19 — docs reconcile). The CONTENT is
 * LW3-8's deliverable; this is the binding oracle. It AUTO-ACTIVATES once LW3-8 lands:
 *   - the docs-hygiene scan (`scripts/docs-hygiene/scan.ts`) exits clean (0 findings), AND
 *   - the required Wave-3 assertions exist in the named files.
 *
 * Until LW3-8 lands the gate is PENDING (the required files/sections are absent and the
 * hygiene scan still reports findings) — the real assertions are SKIPPED, and a single
 * always-on probe records the pending status so the lead can enable it (it does NOT
 * silently pass as if the docs were reconciled).
 */

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

const PLUGIN_ROOT = path.resolve(__dirname, "../..");
const REPO_ROOT = path.resolve(PLUGIN_ROOT, ".."); // umbrella root (docs/ + .guild/ live here)

// The files + required Wave-3 assertions (spec SC-W3-5).
const BUILD_FLOW = path.join(REPO_ROOT, "docs/knowledge/architecture/universal-host-build-flow.md");
const ADR = path.join(REPO_ROOT, "docs/knowledge/decisions/universal-host-plugin-architecture.md");
const ROADMAP = path.join(
  REPO_ROOT,
  ".guild/initiatives/active/universal-host-plugin-architecture/roadmap.md"
);
const WEBSITE_FOLLOWUP = path.join(
  REPO_ROOT,
  ".guild/initiatives/active/universal-host-plugin-architecture/release/website-docs-followup.md"
);

function readIf(p: string): string | null {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return null;
  }
}

const LAST_SCAN = path.join(PLUGIN_ROOT, "scripts/docs-hygiene/.last-scan.md");

// The scanner writes its authoritative result to `.last-scan.md` (summary table + per-flag rows).
// We parse THAT — NOT stdout/stderr (the per-category counts print to stderr; capturing only stdout
// silently yields empty counts → every hard category defaults to 0 → vacuous. codex G-lane LW3-8).

// HARD categories = real drift/leak problems → must be ZERO. Keyed by the summary-table label.
const HARD_CATEGORY_LABELS = [
  "Drift markers (v1/single-repo)",
  "Dangling related: slugs",
  "Missing importance: on canonical page",
  "Secrets grep",
  "Pending grade review (importance_draft)",
];

// Dispositioned SOFT flags — every remaining flag is individually pinned by {file + a STABLE
// match-SUBSTRING} (not the full line), so a NEW flag, a CHANGED flag-text, or a flag in a different
// file breaks the gate (a count-only baseline would let real drift hide in the same bucket — codex
// G-lane LW3-8). The substring is chosen to be the stable, identifying part of each match. All 11
// live in the committed ADR and are benign: the 🟨 status of the genuinely cutover-DEFERRED steps
// 15 & 19, four wave-ordinal architectural references, and two external-URL `source_ref:` entries
// the path-scanner misreads as missing local files. (Steps 12–14 were RECONCILED to ✅ this round —
// their stale 🟨/"In-flight" markers were real drift and are now removed.)
const ADR_REL = "docs/knowledge/decisions/universal-host-plugin-architecture.md";
const DISPOSITIONED_FLAGS: Array<{ file: string; includes: string }> = [
  { file: ADR_REL, includes: "Steps 12–14 (P2-Wave-1)" },
  { file: ADR_REL, includes: "(P2-Wave-3) SHIPPED; step 19" },
  { file: ADR_REL, includes: "P2-Wave-1 (steps 12–14)" },
  { file: ADR_REL, includes: "gated in the Wave-1 closeout" }, // Wave-1-complete status block (pattern-3)
  { file: ADR_REL, includes: "P2-Wave-3 (steps 18–19)" },
  { file: ADR_REL, includes: "15. 🟨 **P2-Wave-2" }, // pattern-2 (emoji)
  { file: ADR_REL, includes: "15. 🟨 **P2-Wave-2" }, // pattern-3 (wave ordinal) — same line, 2 patterns
  { file: ADR_REL, includes: "19. 🟨 **P2-Wave-3" }, // pattern-2 (emoji)
  { file: ADR_REL, includes: "19. 🟨 **P2-Wave-3" }, // pattern-3 (wave ordinal)
  { file: ADR_REL, includes: "github.com/pbakaus/impeccable" },
  { file: ADR_REL, includes: "github.com/obra/superpowers" },
];

// The Wave-3 deliverable docs that ARE inside the scanner corpus (drift caught at its source).
// NB: only files under docs/** are scanned — the scanner corpus EXCLUDES root `.guild/initiatives/**`,
// so the roadmap + website-docs-followup are NOT scanner-covered (codex G-lane LW3-8); their
// correctness is asserted by the content tests below, not by a (vacuous) zero-flag claim.
const WAVE_DOCS_IN_CORPUS = ["docs/knowledge/architecture/universal-host-build-flow.md"];

type ScanFlag = { file: string; line: string; pattern: string; match: string };

/** Parse `.last-scan.md`: the summary-table counts AND the per-flag rows. */
function parseLastScan(md: string): { counts: Record<string, number>; flags: ScanFlag[] } {
  const counts: Record<string, number> = {};
  for (const m of md.matchAll(/^\|\s*(.+?)\s*\|\s*\**(\d+)\**\s*\|$/gim)) {
    counts[m[1].replace(/\*/g, "").trim()] = Number(m[2]);
  }
  const flags: ScanFlag[] = [];
  // flag rows: | `<file>` | L<n> | <pattern> | `<match>` |
  for (const m of md.matchAll(/^\|\s*`([^`]+)`\s*\|\s*(L\d+)\s*\|\s*([^|]+?)\s*\|\s*`?(.+?)`?\s*\|$/gim)) {
    flags.push({ file: m[1].trim(), line: m[2].trim(), pattern: m[3].trim(), match: m[4].trim() });
  }
  return { counts, flags };
}

/** Run the scanner (refreshes `.last-scan.md`); exitOk=true iff it exited 0. */
function runHygieneScan(): { exitOk: boolean } {
  const tsx = path.join(PLUGIN_ROOT, "scripts", "node_modules", ".bin", "tsx");
  try {
    execFileSync(tsx, [path.join(PLUGIN_ROOT, "scripts/docs-hygiene/scan.ts")], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      timeout: 120000,
      stdio: "ignore",
    });
    return { exitOk: true };
  } catch {
    return { exitOk: false };
  }
}

/** Refresh + load the authoritative scan report. Throws if the scanner failed or wrote nothing. */
function freshScan(): { counts: Record<string, number>; flags: ScanFlag[]; exitOk: boolean } {
  const { exitOk } = runHygieneScan();
  const md = fs.existsSync(LAST_SCAN) ? fs.readFileSync(LAST_SCAN, "utf8") : "";
  return { ...parseLastScan(md), exitOk };
}

const buildFlow = readIf(BUILD_FLOW);
const adr = readIf(ADR);
const roadmap = readIf(ROADMAP);
const followup = readIf(WEBSITE_FOLLOWUP);

// LW3-8 is considered "landed" when all four artifacts exist and carry their Wave-3 markers.
const lw38Landed =
  !!buildFlow && /Wave[\s-]?3/i.test(buildFlow) &&
  !!adr && /step\s*18/i.test(adr) && /step\s*19/i.test(adr) &&
  !!roadmap &&
  !!followup;

describe("SC-W3-5 — docs reconcile (status probe, always on)", () => {
  it(lw38Landed ? "LW3-8 has landed — the binding assertions below are ACTIVE" : "PENDING — LW3-8 not yet landed (gate is skipped, not passed)", () => {
    if (!lw38Landed) {
      // eslint-disable-next-line no-console
      console.warn(
        "[SC-W3-5] PENDING — LW3-8 docs reconcile not yet landed. Missing/incomplete:" +
          `\n  build-flow Wave-3 section: ${!!buildFlow && /Wave[\s-]?3/i.test(buildFlow)}` +
          `\n  ADR steps 18+19 stamped:   ${!!adr && /step\s*18/i.test(adr || "") && /step\s*19/i.test(adr || "")}` +
          `\n  roadmap present:           ${!!roadmap}` +
          `\n  website-docs-followup:     ${!!followup}` +
          "\n  Re-run after LW3-8 lands to activate the binding assertions."
      );
    }
    expect(typeof lw38Landed).toBe("boolean");
  });
});

(lw38Landed ? describe : describe.skip)("SC-W3-5 — BINDING (active once LW3-8 lands)", () => {
  it("the docs-hygiene scan exits 0 and reports ZERO hard-category findings (drift/dangling-related/missing-importance/secrets/pending-grade-review)", () => {
    const { exitOk, counts, flags } = freshScan();
    expect(exitOk).toBe(true);
    expect(flags.length).toBeGreaterThan(0); // report parsed real rows (parser not silently empty)
    for (const label of HARD_CATEGORY_LABELS) {
      // the summary table MUST carry the label (guards a parser/label drift that would skip the check)
      expect(counts).toHaveProperty(label);
      expect([label, counts[label]]).toEqual([label, 0]);
    }
  });

  it("every remaining flag is a stable-substring-pinned dispositioned false-positive (a new/changed/moved flag fails)", () => {
    const { flags } = freshScan();
    // Each actual flag must match a pinned disposition (same file + stable match-substring); and the
    // pinned set must be fully consumed — so a removed-then-different flag can't sneak in under count.
    const remaining = [...DISPOSITIONED_FLAGS];
    const unexplained: ScanFlag[] = [];
    for (const f of flags) {
      const i = remaining.findIndex((d) => f.file === d.file && f.match.includes(d.includes));
      if (i === -1) unexplained.push(f);
      else remaining.splice(i, 1);
    }
    // No flag outside the dispositioned set (catches NEW drift in any bucket, incl. a regressed step 12–14).
    expect(unexplained).toEqual([]);
    // Every pinned disposition was actually present (catches a flag silently changing its text).
    expect(remaining).toEqual([]);
  });

  it("the in-corpus Wave-3 deliverable doc (build-flow) contributes ZERO scanner flags", () => {
    const { flags } = freshScan();
    for (const doc of WAVE_DOCS_IN_CORPUS) {
      expect(flags.filter((f) => f.file === doc)).toEqual([]);
    }
  });

  it("anti-vacuity: the .last-scan.md parser extracts REAL counts + flag rows (not hard-wired to 0/empty)", () => {
    const synthetic = [
      "## Summary",
      "| Category | Count |",
      "|---|---|",
      "| Drift markers (v1/single-repo) | 3 |",
      "| Secrets grep | 0 |",
      "",
      "| `docs/x.md` | L10 | C.3-pattern-2: progress emoji | `🟨 thing` |",
    ].join("\n");
    const { counts, flags } = parseLastScan(synthetic);
    expect(counts["Drift markers (v1/single-repo)"]).toBe(3); // real nonzero parsed
    expect(counts["Secrets grep"]).toBe(0);
    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatchObject({ file: "docs/x.md", line: "L10", match: "🟨 thing" });
  });

  it("build-flow has a Wave-3 section naming templates/presets/dashboard/installer-contract + deferred-cutover", () => {
    expect(buildFlow).toMatch(/Wave[\s-]?3/i);
    for (const tok of [/template/i, /preset/i, /dashboard/i, /installer/i, /defer/i]) {
      expect(buildFlow).toMatch(tok);
    }
  });

  it("the ADR stamps steps 18 and 19", () => {
    expect(adr).toMatch(/step\s*18/i);
    expect(adr).toMatch(/step\s*19/i);
  });

  it("the website-docs-followup artifact exists (post-cutover revisit recorded)", () => {
    expect(followup).toBeTruthy();
  });
});
