#!/usr/bin/env npx tsx
/**
 * scripts/dot-guild/audit.ts — share-dot-guild dry-run audit (SC-7, SC-11).
 *
 * Runs scrub.ts --dry-run over each repo's .guild/runs/ and emits a markdown report.
 * Exit 0 = no actionable flags; exit 1 = operator-path or secret flags found (CI fail).
 *
 * Usage:
 *   npx tsx plugin/scripts/dot-guild/audit.ts [--workspace=<path>] [--repos=<csv>] [--output=<path>]
 */

import * as fs from "fs";
import * as path from "path";
import { spawnSync } from "child_process";

const args = process.argv.slice(2);
const wsArg   = args.find(a => a.startsWith("--workspace="));
const reposArg = args.find(a => a.startsWith("--repos="));
const outArg  = args.find(a => a.startsWith("--output="));

// dot-guild/ → scripts/ → plugin/ → workspace = three "..".
const WORKSPACE = wsArg ? wsArg.split("=")[1] : path.resolve(__dirname, "../../..");
const repoList: string[] = reposArg
  ? reposArg.split("=").slice(1).join("=").split(",").map(p => p.trim()).filter(Boolean)
  : [WORKSPACE];
const outputPath = outArg ? outArg.split("=")[1] : undefined;

interface FileFlag { runId: string; file: string; kind: "operator-path" | "secret" | "payload-excluded" | "nested-guild" | "scrub-uncovered"; detail: string; }

// SC-7 blind-spot guard: scrub.ts's share-set (mirror of scrub.ts — keep in
// sync with SHARED_SCRUBBED_NAMES + isHandoffFile + isPayloadFile). audit.ts
// only parses scrub's per-file dry-run lines, so any run-dir file that is
// git-trackable (would be committed/shared) but OUTSIDE this set never reaches
// a redaction pass and silently escapes the SC-7 leak gate. The check below
// flags exactly those files.
const SCRUB_SHARED_NAMES = new Set(["verify.md", "review.md", "provenance.json", "summary.md", "run.yaml"]);
// Control/meta files that are intentionally git-trackable but NOT redacted by
// scrub (they carry no operator content). share-payloads.flag is the per-run
// opt-in sentinel; .gitignore itself is allow-list config. Exempt so they do
// not false-positive as "uncovered".
const SCRUB_COVERAGE_EXEMPT_NAMES = new Set(["share-payloads.flag", ".gitignore"]);

// Mirror of scrub.ts inShareSet (sans the payload-flag branch, which scrub
// handles via share-payloads.flag — payloads are covered when the flag is set).
function inScrubShareSet(rel: string, hasFlag: boolean): boolean {
  const base = path.basename(rel);
  if (SCRUB_SHARED_NAMES.has(base)) return true;
  if (rel.startsWith("handoffs" + path.sep) && rel.endsWith(".md")) return true;
  const isPayload = base === "events.ndjson" || rel.startsWith("logs" + path.sep + "payloads" + path.sep);
  if (isPayload) return hasFlag;
  return false;
}

// SC-7 blind-spot guard: walk each run dir; for every file that git would track
// (NOT ignored = would be shared), flag it if scrub.ts has no coverage for it.
// Uses `git check-ignore` against the repo's allow-list — a non-zero exit means
// the path is NOT ignored, i.e. it WOULD be committed/shared.
function findScrubCoverageGaps(repoPath: string): FileFlag[] {
  const flags: FileFlag[] = [];
  const runsDir = path.join(repoPath, ".guild", "runs");
  if (!fs.existsSync(runsDir)) return flags;

  let runEntries: fs.Dirent[];
  try { runEntries = fs.readdirSync(runsDir, { withFileTypes: true }); } catch { return flags; }

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

    // Batch-query git for trackability: stdin = NUL-separated paths; stdout
    // lists the IGNORED ones. Anything absent from stdout is git-trackable.
    const rel = (p: string) => path.relative(repoPath, p);
    const checked = spawnSync(
      "git", ["-C", repoPath, "check-ignore", "--stdin", "-z"],
      { input: files.map(rel).join("\0"), encoding: "utf8" },
    );
    // git check-ignore exits 0 (some ignored), 1 (none ignored), or 128 (error
    // e.g. not a git repo). On 128 we cannot determine trackability — skip
    // (the nested-guild + dry-run checks still run; this guard is additive).
    if (checked.status === 128) continue;
    const ignored = new Set((checked.stdout ?? "").split("\0").filter(Boolean));

    for (const abs of files) {
      const relToRepo = rel(abs);
      if (ignored.has(relToRepo)) continue;           // ignored ⇒ not shared
      const base = path.basename(abs);
      if (SCRUB_COVERAGE_EXEMPT_NAMES.has(base)) continue;
      const relToRun = path.relative(runDir, abs);
      if (inScrubShareSet(relToRun, hasFlag)) continue; // scrub covers it
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

// FU-F: declared fixture exemptions (mirror plugin/.gitignore — keep in sync).
// Any .guild/ under one of these glob roots is a test fixture, not a leak.
// `(?:[^/]+/)*` matches zero or more intermediate directory segments — the
// fixture .guild/ can live directly under fixtures/ OR nested below it.
const FIXTURE_EXEMPT_PATTERNS = [
  /\/benchmark\/fixtures\/(?:[^/]+\/)*\.guild(\/|$)/,
  /\/mcp-servers\/guild-telemetry\/fixtures(?:-v14)?\/(?:[^/]+\/)*\.guild(\/|$)/,
  /\/plugin\/tests\/dot-guild\/fixtures\/(?:[^/]+\/)*\.guild(\/|$)/,
  /\/plugin\/tests\/wiki-lint\/fixtures\/(?:[^/]+\/)*\.guild(\/|$)/,
];

// FU-F: ONE .guild/ per project (= git repo) root. Walk the workspace, classify
// every .guild/ directory as repo-root / fixture-exempt / leak. Surface leaks
// to the audit report so the SC-7 risk gate (and CI) catches them.
function findNestedGuildLeaks(repoPath: string): FileFlag[] {
  const flags: FileFlag[] = [];
  const skipDirs = new Set(["node_modules", ".git", "dist", "build", ".next", ".cache"]);
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
        // Leak.
        flags.push({
          runId: "(workspace)",
          file: path.relative(repoPath, full) || full,
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
    const nestedLeaks = findNestedGuildLeaks(repo);
    // SC-7 blind-spot guard: flag git-trackable run files scrub doesn't cover.
    const coverageGaps = findScrubCoverageGaps(repo);
    repoResults.push({ repo: path.relative(WORKSPACE, repo) || path.basename(repo), flags: [...flags, ...nestedLeaks, ...coverageGaps] });
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

main();
