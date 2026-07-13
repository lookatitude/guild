#!/usr/bin/env npx tsx
/**
 * scripts/dot-guild/audit.ts — share-dot-guild dry-run audit (SC-7, SC-11).
 *
 * Runs scrub.ts --dry-run over each repo's .guild/runs/ and emits a markdown report.
 * Exit 0 = no actionable flags; exit 1 = operator-path or secret flags found (CI fail).
 *
 * Usage:
 *   npx tsx plugin/scripts/dot-guild/audit.ts [--workspace=<path>] [--repos=<csv>] [--output=<path>] [--tracked-only]
 *
 * --tracked-only restricts every scan to `git ls-files`-tracked paths (skips the
 * untracked-file scanning legs) — a cheaper, noise-free gate for an
 * already-checked-out CI tree; the default (no flag) additionally scans
 * untracked-but-shareable files, which is the more thorough posture wanted for a
 * local pre-commit / build:verify run.
 */

import * as fs from "fs";
import * as path from "path";
import { spawnSync } from "child_process";
// Canonical single-source share-set membership (re-arch WAVE 1) — the former
// "keep in sync" mirror of scrub.ts (SCRUB_SHARED_NAMES + inScrubShareSet) is gone.
import { inShareSet } from "../lib/shared/share-set";
// Canonical single-source redaction applier (verified-multi-host-support L0 §6.4).
// The package/receipt leak scan (§7.2) runs the SAME `redact` the write path runs,
// in-memory, so the scan and the scrub can never drift.
import { redact } from "../lib/shared/scrub-redact";

const args = process.argv.slice(2);
const wsArg   = args.find(a => a.startsWith("--workspace="));
const reposArg = args.find(a => a.startsWith("--repos="));
const outArg  = args.find(a => a.startsWith("--output="));
// --tracked-only: skip the untracked-file scanning legs (findScrubCoverageGaps'
// disk walk, findNestedGuildLeaks' disk walk, findPackageReceiptLeaks' disk walk)
// and restrict every scan to `git ls-files`-tracked paths only. A raw filesystem
// walk over a local dev tree picks up untracked-but-not-yet-ignored scratch/build
// cruft that was never going to be committed (see the plugin-audit-remediation
// hygiene pass), which is noise for a gate that's supposed to answer "would this
// be shared" for an ALREADY-CHECKED-OUT tree (CI) rather than "could this
// accidentally be added" (the fuller local pre-commit posture, the default).
const trackedOnly = args.includes("--tracked-only");

// dot-guild/ → scripts/ → plugin/ → workspace = three "..".
const WORKSPACE = wsArg ? wsArg.split("=")[1] : path.resolve(__dirname, "../../..");
const repoList: string[] = reposArg
  ? reposArg.split("=").slice(1).join("=").split(",").map(p => p.trim()).filter(Boolean)
  : [WORKSPACE];
const outputPath = outArg ? outArg.split("=")[1] : undefined;

export interface FileFlag { runId: string; file: string; kind: "operator-path" | "secret" | "payload-excluded" | "nested-guild" | "scrub-uncovered" | "receipt-operator-path" | "receipt-secret"; detail: string; }

// SC-7 blind-spot guard: scrub.ts's share-set is now the canonical single-source
// module (scripts/lib/shared/share-set.ts, imported as inShareSet). audit.ts only
// parses scrub's per-file dry-run lines, so any run-dir file that is git-trackable
// (would be committed/shared) but OUTSIDE the share-set never reaches a redaction
// pass and silently escapes the SC-7 leak gate. The check below flags exactly
// those files — using the SAME share-set scrub uses (no drift possible).
// Control/meta files that are intentionally git-trackable but NOT redacted by
// scrub (they carry no operator content). share-payloads.flag is the per-run
// opt-in sentinel; .gitignore itself is allow-list config. Exempt so they do
// not false-positive as "uncovered".
const SCRUB_COVERAGE_EXEMPT_NAMES = new Set(["share-payloads.flag", ".gitignore"]);

/** `git -C repoPath ls-files -z` → the set of repo-relative paths git actually tracks. */
function trackedFileSet(repoPath: string): Set<string> {
  const res = spawnSync("git", ["-C", repoPath, "ls-files", "-z"], { encoding: "utf8" });
  if (res.status !== 0) return new Set();
  return new Set((res.stdout ?? "").split("\0").filter(Boolean));
}

// SC-7 blind-spot guard: walk each run dir; for every file that git would track
// (NOT ignored = would be shared), flag it if scrub.ts has no coverage for it.
// Uses `git check-ignore` against the repo's allow-list — a non-zero exit means
// the path is NOT ignored, i.e. it WOULD be committed/shared.
function findScrubCoverageGaps(repoPath: string, trackedOnlyMode = false): FileFlag[] {
  const flags: FileFlag[] = [];
  const runsDir = path.join(repoPath, ".guild", "runs");
  if (!fs.existsSync(runsDir)) return flags;

  let runEntries: fs.Dirent[];
  try { runEntries = fs.readdirSync(runsDir, { withFileTypes: true }); } catch { return flags; }

  // --tracked-only: restrict to git ls-files output — a checked-out CI tree has
  // no untracked files anyway, so this is just a cheaper, noise-free equivalent
  // there; for a local dev tree it skips untracked scratch/build cruft entirely.
  const tracked = trackedOnlyMode ? trackedFileSet(repoPath) : null;

  for (const runEnt of runEntries) {
    if (!runEnt.isDirectory()) continue;
    const runDir = path.join(runsDir, runEnt.name);
    const hasFlag = fs.existsSync(path.join(runDir, "share-payloads.flag"));

    // Collect every file under this run dir.
    const files: string[] = [];
    (function walk(dir: string): void {
      let entries: fs.Dirent[];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full);
        else if (e.isFile()) files.push(full);
      }
    })(runDir);
    if (files.length === 0) continue;

    const rel = (p: string) => path.relative(repoPath, p);
    let shareable: (relToRepo: string) => boolean;
    if (tracked) {
      // tracked-only: "would be shared" ⇔ already tracked (no ignore-status guessing).
      shareable = (relToRepo) => tracked.has(relToRepo);
    } else {
      // Batch-query git for trackability: stdin = NUL-separated paths; stdout
      // lists the IGNORED ones. Anything absent from stdout is git-trackable.
      const checked = spawnSync(
        "git", ["-C", repoPath, "check-ignore", "--stdin", "-z"],
        { input: files.map(rel).join("\0"), encoding: "utf8" },
      );
      // git check-ignore exits 0 (some ignored), 1 (none ignored), or 128 (error
      // e.g. not a git repo). On 128 we cannot determine trackability — skip
      // (the nested-guild + dry-run checks still run; this guard is additive).
      if (checked.status === 128) continue;
      const ignored = new Set((checked.stdout ?? "").split("\0").filter(Boolean));
      shareable = (relToRepo) => !ignored.has(relToRepo);
    }

    for (const abs of files) {
      const relToRepo = rel(abs);
      if (!shareable(relToRepo)) continue;           // not ignored/tracked ⇒ not shared
      const base = path.basename(abs);
      if (SCRUB_COVERAGE_EXEMPT_NAMES.has(base)) continue;
      const relToRun = path.relative(runDir, abs);
      if (inShareSet(relToRun, hasFlag)) continue; // scrub covers it
      flags.push({
        runId: runEnt.name,
        file: relToRun,
        kind: "scrub-uncovered",
        detail: "git-trackable (would be shared) but outside scrub.ts's share-set — no redaction pass; SC-7 blind spot",
      });
    }
  }
  return flags;
}

// verified-multi-host-support L0 §7.2 — the REAL AC-SEC-1 package/receipt-tree leak
// scan. SEPARATE, PATH-ANCHORED from scrub.ts's `.guild/runs`-scoped share-set: this
// scan is anchored to the committed evidence stores (`evidence/host-smoke`, ADR §6.1,
// plus desktop app command-smoke receipts under `evidence/desktop-app-smoke`)
// — it does NOT widen share-set.ts's SHARED_SCRUBBED_NAMES (that basename set is one
// function on two call sites; widening it would leak these basenames into the runs
// share-set — security round-3 F2). The narrow-allowlisted paths here are DISJOINT
// from /dist/ (fully .gitignore-ignored, regenerated) so the runs scan and this scan
// neither overlap nor gap.
const PACKAGE_RECEIPT_SCAN_ROOTS = ["evidence/host-smoke", "evidence/desktop-app-smoke"];

// §7.2 exact file selection — mirrors the existing `.guild/runs` coverage guard
// (findScrubCoverageGaps): walk the anchored root on disk (local build:verify sees
// tracked+staged+untracked; CI's checkout has only tracked files, so the SAME code
// naturally sees only tracked), then batch-query `git check-ignore --stdin -z` and
// scan ONLY the files git would track (would be shared). Per non-ignored file run the
// SHARED `redact` in-memory and flag an operator-path finding iff `opPaths > 0` and a
// secret finding iff `secrets.length > 0` (round-2 minor: the two counters are
// INDEPENDENT — never conflated; `out === content` is L8's separate no-op assertion,
// NOT used here). On git status 128 (not a git repo) SKIP (additive, like the guard).
export function findPackageReceiptLeaks(repoPath: string, trackedOnlyMode = false): FileFlag[] {
  const flags: FileFlag[] = [];
  const tracked = trackedOnlyMode ? trackedFileSet(repoPath) : null;
  for (const rootRel of PACKAGE_RECEIPT_SCAN_ROOTS) {
    const scanRoot = path.join(repoPath, rootRel);
    if (!fs.existsSync(scanRoot)) continue;

    const files: string[] = [];
    (function walk(dir: string): void {
      let entries: fs.Dirent[];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full);
        else if (e.isFile()) files.push(full);
      }
    })(scanRoot);
    if (files.length === 0) continue;

    const rel = (p: string) => path.relative(repoPath, p);
    let shareable: (relToRepo: string) => boolean;
    if (tracked) {
      shareable = (relToRepo) => tracked.has(relToRepo);
    } else {
      const checked = spawnSync(
        "git", ["-C", repoPath, "check-ignore", "--stdin", "-z"],
        { input: files.map(rel).join("\0"), encoding: "utf8" },
      );
      // 0 (some ignored), 1 (none ignored), 128 (error e.g. not a git repo).
      if (checked.status === 128) continue;
      const ignored = new Set((checked.stdout ?? "").split("\0").filter(Boolean));
      shareable = (relToRepo) => !ignored.has(relToRepo);
    }

    for (const abs of files) {
      const relToRepo = rel(abs);
      if (!shareable(relToRepo)) continue; // not ignored/tracked ⇒ not shared ⇒ skip
      let content: string;
      try { content = fs.readFileSync(abs, "utf8"); } catch { continue; }
      const { opPaths, secrets } = redact(content);
      if (opPaths > 0) {
        flags.push({
          runId: "(evidence)",
          file: relToRepo,
          kind: "receipt-operator-path",
          detail: `${opPaths} operator path(s) present in a committed/shareable receipt — would leak on commit`,
        });
      }
      if (secrets.length > 0) {
        flags.push({
          runId: "(evidence)",
          file: relToRepo,
          kind: "receipt-secret",
          detail: `${secrets.length} secret pattern(s) present in a committed/shareable receipt — [${secrets.map(s => s.category).join(", ")}]`,
        });
      }
    }
  }
  return flags;
}

// FU-F: declared fixture exemptions (mirror plugin/.gitignore — keep in sync).
// Any .guild/ under one of these glob roots is a test fixture, not a leak.
// `(?:[^/]+/)*` matches zero or more intermediate directory segments — the
// fixture .guild/ can live directly under fixtures/ OR nested below it.
// Exported so the exemption-parity test (scripts/dot-guild/__tests__/exemption-parity.test.ts)
// can assert directly against the SAME array — no hand-copied mirror to drift.
export const FIXTURE_EXEMPT_PATTERNS = [
  /\/benchmark\/fixtures\/(?:[^/]+\/)*\.guild(\/|$)/,
  /\/mcp-servers\/guild-memory\/fixtures\/(?:[^/]+\/)*\.guild(\/|$)/,
  /\/mcp-servers\/guild-telemetry\/fixtures(?:-v14|-alt-cwd)?\/(?:[^/]+\/)*\.guild(\/|$)/,
  // `/plugin` is OPTIONAL: matches both the workspace layout (.../plugin/tests/...)
  // and the plugin-repo-root CI checkout (.../tests/..., no /plugin/ segment) — the
  // exemptions must hold regardless of where the plugin tree is rooted.
  /(?:\/plugin)?\/tests\/dot-guild\/fixtures\/(?:[^/]+\/)*\.guild(\/|$)/,
  /(?:\/plugin)?\/tests\/wiki-lint\/fixtures\/(?:[^/]+\/)*\.guild(\/|$)/,
  // G-7 (SC-3) learning-backstop golden fixture — a single named fixture dir, not a
  // glob of many, but the same optional-`/plugin` shape as the tests/ patterns above
  // (workspace layout has a `/plugin` segment; the plugin-repo-root CI checkout does not).
  /(?:\/plugin)?\/hooks\/__tests__\/fixtures\/golden-full-learn-run\/(?:[^/]+\/)*\.guild(\/|$)/,
];

// FU-F: ONE .guild/ per project (= git repo) root. Walk the workspace, classify
// every .guild/ directory as repo-root / fixture-exempt / leak. Surface leaks
// to the audit report so the SC-7 risk gate (and CI) catches them.
function findNestedGuildLeaks(repoPath: string, trackedOnlyMode = false): FileFlag[] {
  const flags: FileFlag[] = [];
  const skipDirs = new Set(["node_modules", ".git", "dist", "build", ".next", ".cache"]);
  // --tracked-only: a nested .guild/ with NO tracked files inside it is untracked
  // local cruft (e.g. a leftover ephemeral smoke-test dir) rather than a real leak
  // into the shared tree — skip it. Computed lazily, once, only when needed.
  let tracked: Set<string> | null = null;
  const hasTrackedFileUnder = (relDir: string): boolean => {
    if (!tracked) tracked = trackedFileSet(repoPath);
    const prefix = relDir.endsWith(path.sep) ? relDir : relDir + path.sep;
    for (const f of tracked) if (f === relDir || f.startsWith(prefix)) return true;
    return false;
  };
  function walk(dir: string): void {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (skipDirs.has(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.name === ".guild") {
        // Repo root? Parent has .git (file or dir).
        const parent = path.dirname(full);
        const hasGit = fs.existsSync(path.join(parent, ".git"));
        if (hasGit) continue; // legitimate per-repo .guild/
        // Fixture-exempt? Resolve to absolute so the leading-slash regexes match
        // regardless of whether the walk started from a relative or absolute path.
        const absFull = path.resolve(full);
        if (FIXTURE_EXEMPT_PATTERNS.some(p => p.test(absFull))) continue;
        const relToRepo = path.relative(repoPath, full) || full;
        if (trackedOnlyMode && !hasTrackedFileUnder(relToRepo)) continue; // untracked-only ⇒ not a leak
        // Leak.
        flags.push({
          runId: "(workspace)",
          file: relToRepo,
          kind: "nested-guild",
          detail: "non-repo-root .guild/ outside declared fixtures — violates the one-.guild-per-repo invariant",
        });
        // Do NOT descend further into a nested .guild/ — its contents inherit the same status.
        continue;
      }
      walk(full);
    }
  }
  walk(repoPath);
  return flags;
}

function auditRepo(repoPath: string): { flags: FileFlag[]; } {
  const scrubScript = path.resolve(__dirname, "scrub.ts");
  const result = spawnSync("npx", ["tsx", scrubScript, "--dry-run", `--workspace=${repoPath}`], { encoding: "utf8" });
  const raw = (result.stdout ?? "") + (result.stderr ?? "");
  const flags: FileFlag[] = [];

  for (const line of raw.split("\n")) {
    // "[dry-run] <runId>/<file>: paths=N secrets=M ..."
    const m = line.match(/\[dry-run\]\s+([^/\s]+)\/(.+?):\s+paths=(\d+)\s+secrets=(\d+)/);
    if (m) {
      const [, runId, file, pStr, sStr] = m;
      if (parseInt(pStr) > 0) flags.push({ runId, file, kind: "operator-path", detail: `${pStr} operator path(s) would be redacted` });
      if (parseInt(sStr) > 0) flags.push({ runId, file, kind: "secret", detail: `${sStr} secret pattern(s) found` });
    }
    // summary excluded count
    const ex = line.match(/(\d+) payload\(s\) excluded/);
    if (ex && parseInt(ex[1]) > 0)
      flags.push({ runId: "(summary)", file: "events.ndjson / logs/payloads/**", kind: "payload-excluded", detail: `${ex[1]} payload file(s) excluded (no share-payloads.flag)` });
  }
  return { flags };
}

function renderReport(repoResults: Array<{ repo: string; flags: FileFlag[] }>, now: string): string {
  const total = repoResults.reduce((n, r) => n + r.flags.length, 0);
  let out = `---\ntype: artifact\ninitiative: share-dot-guild\ntask: B-tooling\ncreated_at: ${now}\n---\n\n`;
  out += `# .guild/ audit report — share-dot-guild\n\nGenerated by \`audit.ts\` on ${now}. SC-7 risk-gate artifact (Decision J).\n\n## Summary\n\n| Repo | Flags |\n|---|---|\n`;
  for (const r of repoResults) out += `| \`${r.repo}\` | ${r.flags.length} |\n`;
  out += `| **Total** | **${total}** |\n\n`;
  out += total === 0
    ? `No actionable flags — safe to proceed with SC-10 commits.\n`
    : `**Action required before SC-10 commits.** Resolve each flag (scrub-adjust / exclude / accept).\n`;

  for (const r of repoResults) {
    out += `\n## Repo: \`${r.repo}\`\n\n`;
    if (r.flags.length === 0) { out += `No flags.\n`; continue; }
    out += `| Run ID | File | Kind | Detail | Suggested action |\n|---|---|---|---|---|\n`;
    for (const f of r.flags) {
      const action = f.kind === "operator-path" ? "Run scrub.ts before commit"
        : f.kind === "secret" ? "Rotate credential; scrub.ts will redact"
        : f.kind === "receipt-operator-path" ? "Scrub the receipt at write time via the shared redact() (L5), OR remove it from the committed evidence receipt allow-list so it is not shared"
        : f.kind === "receipt-secret" ? "Rotate the credential; the receipt MUST be redacted (shared redact()) before it is staged — evidence receipts are shared-scrubbed"
        : f.kind === "nested-guild" ? "DELETE the nested .guild/ — it's a leftover; resolver enforces one-.guild-per-repo. If legitimate fixture, add its path to FIXTURE_EXEMPT_PATTERNS"
        : f.kind === "scrub-uncovered" ? "Add the file's basename to scrub.ts SHARED_SCRUBBED_NAMES (so it gets a redaction pass), OR exempt it in SCRUB_COVERAGE_EXEMPT_NAMES if it carries no operator content, OR remove it from the .gitignore allow-list so it is not shared"
        : "Informational — add share-payloads.flag to opt in";
      out += `| \`${f.runId}\` | \`${f.file}\` | ${f.kind} | ${f.detail} | ${action} |\n`;
    }
  }
  out += `\n---\n\nRe-run: \`npx tsx plugin/scripts/dot-guild/audit.ts\`\n`;
  return out;
}

function main(): void {
  const now = new Date().toISOString().slice(0, 10);
  const repoResults: Array<{ repo: string; flags: FileFlag[] }> = [];

  for (const repo of repoList) {
    process.stderr.write(`[audit] Scanning ${repo} ...\n`);
    const { flags } = auditRepo(repo);
    // FU-F: also walk for nested-.guild leaks at any depth.
    const nestedLeaks = findNestedGuildLeaks(repo, trackedOnly);
    // SC-7 blind-spot guard: flag git-trackable run files scrub doesn't cover.
    const coverageGaps = findScrubCoverageGaps(repo, trackedOnly);
    // AC-SEC-1 (verified-multi-host-support §7.2): the REAL package/receipt-tree leak
    // scan — a planted operator-path/secret in a committed evidence receipt is flagged
    // non-vacuously. Path-anchored + independent of the runs share-set.
    const receiptLeaks = findPackageReceiptLeaks(repo, trackedOnly);
    repoResults.push({ repo: path.relative(WORKSPACE, repo) || path.basename(repo), flags: [...flags, ...nestedLeaks, ...coverageGaps, ...receiptLeaks] });
  }

  const report = renderReport(repoResults, now);
  process.stdout.write(report);

  if (outputPath) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, report, "utf8");
    process.stderr.write(`[audit] Report written to ${outputPath}\n`);
  }

  const actionable = repoResults.reduce((n, r) => n + r.flags.filter(f => f.kind !== "payload-excluded").length, 0);
  if (actionable > 0) {
    process.stderr.write(`[audit] ${actionable} actionable flag(s) — CI/gate should fail.\n`);
    process.exit(1);
  }
  process.stderr.write(`[audit] No actionable flags. OK.\n`);
}

// Guarded so importing this module (e.g. build-verify.ts reusing the single-source
// `findPackageReceiptLeaks` scan — verified-multi-host-support L6, ADR §8 step 6) does
// NOT run the full audit. As a direct script (`npx tsx audit.ts`) it still runs main().
if (require.main === module) main();
