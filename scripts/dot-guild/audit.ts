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

interface FileFlag { runId: string; file: string; kind: "operator-path" | "secret" | "payload-excluded" | "nested-guild"; detail: string; }

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
    repoResults.push({ repo: path.relative(WORKSPACE, repo) || path.basename(repo), flags: [...flags, ...nestedLeaks] });
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
