#!/usr/bin/env npx tsx
/**
 * scripts/dot-guild/scrub.ts — share-dot-guild scrubber (Decision H).
 *
 * Per-run: exclude events.ndjson + logs/payloads/** UNLESS share-payloads.flag present.
 * Surviving files: (1) operator-path redaction → <workspace-root>; (2) secrets-grep
 * from SECRET_PATTERNS (imported from docs-hygiene/scan.ts — not re-spelled here).
 * Idempotent + deterministic.
 *
 * Usage:
 *   npx tsx plugin/scripts/dot-guild/scrub.ts [--glob=<pattern>] [--dry-run] [--workspace=<path>]
 */

import * as fs from "fs";
import * as path from "path";

// Import canonical secret patterns — do NOT re-spell the regexes (Decision H.3).
// tsx handles .ts cross-imports at runtime.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { SECRET_PATTERNS } = require(
  path.resolve(__dirname, "../docs-hygiene/scan.ts")
) as { SECRET_PATTERNS: Array<[RegExp, string]> };

// Operator-path patterns (Decision H.2 + Decision M relative-paths-policy).
// Placeholders are idempotent — they won't re-match.
const OPERATOR_PATH_RE = /\/Users\/[^/\s]+\/Projects\/[^/\s]+/g;
const WORKSPACE_ROOT_MARKER = "<workspace-root>";
// Decision M: tilde-prefixed Claude project paths leak the workspace via the
// URL-encoded slug `~/.claude/projects/-Users-<NAME>-Projects-<WS>/...`.
const TILDE_CLAUDE_PROJECT_RE = /~\/\.claude\/projects\/-Users-[^/\s]+-Projects-[^/\s]+/g;
const OPERATOR_MEMORY_ROOT_MARKER = "<operator-memory-root>";

const SHARED_SCRUBBED_NAMES = new Set(["verify.md", "review.md", "provenance.json", "summary.md", "run.yaml", "run-state.json"]);

function isHandoffFile(rel: string): boolean {
  return rel.startsWith("handoffs" + path.sep) && rel.endsWith(".md");
}
function isPayloadFile(rel: string): boolean {
  return path.basename(rel) === "events.ndjson" || rel.startsWith("logs" + path.sep + "payloads" + path.sep);
}
function inShareSet(rel: string, hasFlag: boolean): boolean {
  if (SHARED_SCRUBBED_NAMES.has(path.basename(rel)) || isHandoffFile(rel)) return true;
  if (isPayloadFile(rel)) return hasFlag;
  return false;
}

interface SecretHit { category: string; line: number; }

function redact(content: string): { out: string; opPaths: number; secrets: SecretHit[] } {
  let opPaths = 0;
  let out = content.replace(OPERATOR_PATH_RE, () => { opPaths++; return WORKSPACE_ROOT_MARKER; });
  // Decision M: also redact tilde-prefixed Claude project paths.
  out = out.replace(TILDE_CLAUDE_PROJECT_RE, () => { opPaths++; return OPERATOR_MEMORY_ROOT_MARKER; });
  const secrets: SecretHit[] = [];
  const lines = out.split("\n");
  out = lines.map((line, i) => {
    let l = line;
    for (const [re, label] of SECRET_PATTERNS) {
      const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
      if (g.test(l)) {
        secrets.push({ category: label, line: i + 1 });
        l = l.replace(new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g"),
          `<SECRET-REDACTED:${label}>`);
      }
    }
    return l;
  }).join("\n");
  return { out, opPaths, secrets };
}

function walkDir(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const results: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) results.push(...walkDir(full));
    else if (e.isFile()) results.push(full);
  }
  return results;
}

function findRunDirs(workspace: string, globHint?: string): string[] {
  if (globHint) {
    const normalized = globHint.replace(/\/$/, "");
    const parent = path.dirname(normalized);
    const leaf = path.basename(normalized);
    const abs = path.isAbsolute(normalized) ? parent : path.join(workspace, parent);
    if (!fs.existsSync(abs)) return [];
    return fs.readdirSync(abs, { withFileTypes: true })
      .filter(e => e.isDirectory() && (leaf === "*" || e.name === leaf))
      .map(e => path.join(abs, e.name));
  }
  const runsDir = path.join(workspace, ".guild", "runs");
  if (!fs.existsSync(runsDir)) return [];
  return fs.readdirSync(runsDir, { withFileTypes: true })
    .filter(e => e.isDirectory()).map(e => path.join(runsDir, e.name));
}

function processRun(runDir: string, dryRun: boolean): { files: number; changed: number; excluded: number; secrets: number } {
  const hasFlag = fs.existsSync(path.join(runDir, "share-payloads.flag"));
  let files = 0, changed = 0, excluded = 0, secretCount = 0;

  for (const absPath of walkDir(runDir)) {
    const rel = path.relative(runDir, absPath);
    if (!inShareSet(rel, hasFlag)) {
      if (isPayloadFile(rel) && !hasFlag) excluded++;
      continue;
    }
    let content: string;
    try { content = fs.readFileSync(absPath, "utf8"); } catch { continue; }
    const { out, opPaths, secrets } = redact(content);
    const didChange = out !== content;
    files++;
    if (didChange) changed++;
    secretCount += secrets.length;
    if (secrets.length > 0) {
      process.stderr.write(`[scrub] WARNING: ${path.basename(runDir)}/${rel}: ${secrets.length} secret(s) redacted — [${secrets.map(s => s.category).join(", ")}]. Rotate credentials.\n`);
    }
    if (dryRun && (didChange || secrets.length > 0)) {
      process.stdout.write(`  [dry-run] ${path.basename(runDir)}/${rel}: paths=${opPaths} secrets=${secrets.length}${didChange ? " [WOULD CHANGE]" : ""}\n`);
    }
    if (!dryRun && didChange) fs.writeFileSync(absPath, out, "utf8");
  }
  return { files, changed, excluded, secrets: secretCount };
}

function main(): void {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const wsArg = args.find(a => a.startsWith("--workspace="));
  const globArg = args.find(a => a.startsWith("--glob="));
  const workspace = wsArg ? wsArg.split("=")[1] : path.resolve(__dirname, "../../../..");
  const globHint = globArg ? globArg.split("=")[1] : undefined;
  const runDirs = findRunDirs(workspace, globHint);

  if (runDirs.length === 0) {
    process.stderr.write(`[scrub] No run dirs found under ${workspace}/.guild/runs/\n`);
    return;
  }

  let totalFiles = 0, totalChanged = 0, totalExcluded = 0, totalSecrets = 0;
  for (const runDir of runDirs) {
    const r = processRun(runDir, dryRun);
    totalFiles += r.files; totalChanged += r.changed; totalExcluded += r.excluded; totalSecrets += r.secrets;
  }
  const mode = dryRun ? "[dry-run]" : "[scrub]";
  process.stdout.write(`${mode} ${runDirs.length} run(s), ${totalFiles} file(s) in scope, ${totalExcluded} payload(s) excluded, ${totalChanged} changed, ${totalSecrets} secret(s) found.\n`);
}

main();
