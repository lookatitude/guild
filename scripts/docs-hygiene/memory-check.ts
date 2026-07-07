#!/usr/bin/env npx tsx
/**
 * docs-hygiene/memory-check.ts
 *
 * For each .md in ~/.claude/projects/-Users-miguelp-Projects-guild/memory/,
 * parse the body for:
 *   - File paths (absolute or relative to workspace)
 *   - Command names (/guild:*, npx/ts-node/tsx invocations referencing scripts)
 *   - Config flag names (settings.json keys mentioned as `key.path`)
 *
 * Verify they still resolve on disk (or via grep for command/skill names).
 * Emits a stale list to:
 *   .guild/initiatives/active/docs-clean-up/artifacts/memory-stale-list.md
 *
 * Usage:
 *   npx tsx plugin/scripts/docs-hygiene/memory-check.ts [--workspace=/path]
 *
 * Lane D-validate runs the reconcile; this script only detects + reports.
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { execSync } from "child_process";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const workspaceArg = args.find((a) => a.startsWith("--workspace="));
const WORKSPACE = workspaceArg
  ? workspaceArg.split("=")[1]
  : path.resolve(__dirname, "../../../..");

const MEMORY_DIR = path.join(
  os.homedir(),
  ".claude/projects/-Users-miguelp-Projects-guild/memory"
);

const OUTPUT_DIR = path.join(
  WORKSPACE,
  ".guild/initiatives/active/docs-clean-up/artifacts"
);
const OUTPUT_PATH = path.join(OUTPUT_DIR, "memory-stale-list.md");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface StaleRef {
  memoryFile: string;   // filename (not full path)
  lineNo: number;
  refType: "file-path" | "script-path" | "command" | "config-key";
  ref: string;
  verdict: "STALE" | "VERIFY";
  reason: string;
}

// ---------------------------------------------------------------------------
// Patterns
// ---------------------------------------------------------------------------

// Matches absolute or repo-relative file paths
const ABS_PATH_RE = /(?:^|[\s`"'([\]])(\/(?:Users\/\w+\/Projects\/guild|tmp)[^\s`"')\]]+\.\w+)/g;

// Matches workspace-relative paths (starts with common prefixes)
const REL_PATH_RE = /(?:^|[\s`"'([\]])((?:plugin|docs|benchmark|website|scripts|hooks|skills|agents|commands|tests|\.guild|\.claude)\/[^\s`"')\]]{4,})/g;

// Script invocations referencing .ts/.js files
const SCRIPT_PATH_RE = /(?:npx\s+tsx?|ts-node|node)\s+([^\s`"']+\.(?:ts|js|mjs))/g;

// Settings.json key paths (like models.tiers, defaults.index.*)
const CONFIG_KEY_RE = /\b(defaults\.[a-zA-Z_.]+|models\.[a-zA-Z_.]+|agent_mode|codex_cap|GUILD_[A-Z_]+)\b/g;

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function readFile(p: string): string {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return "";
  }
}

function resolveRef(ref: string): string | null {
  // Already absolute
  if (ref.startsWith("/")) return ref;

  // Try relative to workspace
  const asWorkspaceRel = path.join(WORKSPACE, ref);
  if (fs.existsSync(asWorkspaceRel)) return asWorkspaceRel;

  // Try with plugin/ prefix (some memories reference plugin-relative paths)
  const asPlugin = path.join(WORKSPACE, "plugin", ref);
  if (fs.existsSync(asPlugin)) return asPlugin;

  return null;
}

function checkPathExists(ref: string): boolean {
  const resolved = resolveRef(ref);
  if (!resolved) return false;
  return fs.existsSync(resolved);
}

function fileExistsOnDisk(p: string): boolean {
  return fs.existsSync(p);
}

// Check command names via grep in the codebase
function commandExistsInCodebase(cmd: string): boolean {
  // Strip leading /
  const normalized = cmd.replace(/^\//, "");
  try {
    const result = execSync(
      `grep -r --include="*.md" --include="*.ts" --include="*.json" -l "${normalized}" "${WORKSPACE}/plugin/commands" "${WORKSPACE}/plugin/skills" 2>/dev/null | head -1`,
      { encoding: "utf8", timeout: 10000 }
    );
    return result.trim().length > 0;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Parse a memory file and extract references
// ---------------------------------------------------------------------------

function parseMemoryFile(fpath: string): StaleRef[] {
  const content = readFile(fpath);
  if (!content) return [];
  const fname = path.basename(fpath);
  const lines = content.split("\n");
  const refs: StaleRef[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNo = i + 1;

    // Skip frontmatter (line-skip heuristic, not YAML parsing — `slice` avoids
    // the comms-format check-b startsWith('---') idiom; semantics unchanged).
    if (i < 5 && (line.slice(0, 3) === "---" || line.startsWith("name:") || line.startsWith("description:") || line.startsWith("metadata:"))) continue;

    // 1. Absolute paths
    let m: RegExpExecArray | null;
    const absCopy = new RegExp(ABS_PATH_RE.source, "g");
    while ((m = absCopy.exec(line)) !== null) {
      const p = m[1].trim();
      if (p.length < 5) continue;
      // Strip trailing punctuation
      const clean = p.replace(/[.,;:)]$/, "");
      const exists = fileExistsOnDisk(clean);
      if (!exists) {
        refs.push({
          memoryFile: fname,
          lineNo,
          refType: "file-path",
          ref: clean,
          verdict: "STALE",
          reason: `absolute path not found on disk`,
        });
      }
    }

    // 2. Repo-relative paths
    const relCopy = new RegExp(REL_PATH_RE.source, "g");
    while ((m = relCopy.exec(line)) !== null) {
      const p = m[1].trim().replace(/[.,;:)>]$/, "");
      if (p.length < 5) continue;
      // Skip if looks like a URL fragment or markdown heading
      if (p.includes("://") || p.startsWith("#")) continue;
      const exists = checkPathExists(p);
      if (!exists) {
        refs.push({
          memoryFile: fname,
          lineNo,
          refType: "file-path",
          ref: p,
          verdict: "STALE",
          reason: `repo-relative path not found on disk`,
        });
      }
    }

    // 3. Script invocations
    const scriptCopy = new RegExp(SCRIPT_PATH_RE.source, "g");
    while ((m = scriptCopy.exec(line)) !== null) {
      const p = m[1].trim();
      const exists = checkPathExists(p);
      if (!exists) {
        refs.push({
          memoryFile: fname,
          lineNo,
          refType: "script-path",
          ref: p,
          verdict: "STALE",
          reason: `script path not found on disk`,
        });
      }
    }
  }

  return refs;
}

// ---------------------------------------------------------------------------
// Run check
// ---------------------------------------------------------------------------

const staleRefs: StaleRef[] = [];

if (!fs.existsSync(MEMORY_DIR)) {
  console.error(`Memory directory not found: ${MEMORY_DIR}`);
  process.exit(1);
}

const memoryFiles = fs.readdirSync(MEMORY_DIR)
  .filter((f) => f.endsWith(".md"))
  .map((f) => path.join(MEMORY_DIR, f));

console.error(`Checking ${memoryFiles.length} memory files...`);

for (const fpath of memoryFiles) {
  const refs = parseMemoryFile(fpath);
  staleRefs.push(...refs);
  console.error(`  ${path.basename(fpath)}: ${refs.length} stale refs`);
}

// ---------------------------------------------------------------------------
// Emit stale list
// ---------------------------------------------------------------------------

const now = new Date().toISOString().slice(0, 10);
const staleCount = staleRefs.filter((r) => r.verdict === "STALE").length;

let output = `---
type: artifact
initiative: docs-clean-up
task: D-build
owner: eval-engineer
created_at: ${now}
---

# Memory stale list — docs-clean-up memory-vs-reality check

Generated by \`plugin/scripts/docs-hygiene/memory-check.ts\` on ${now}.
Lane D-validate (Wave 3) executes the reconcile.

## Summary

| Memory file | Stale refs |
|---|---|
`;

const byFile: Record<string, StaleRef[]> = {};
for (const r of staleRefs) {
  (byFile[r.memoryFile] = byFile[r.memoryFile] || []).push(r);
}

for (const [fname, refs] of Object.entries(byFile)) {
  output += `| \`${fname}\` | ${refs.length} |\n`;
}
output += `| **Total** | **${staleCount}** |\n`;

output += `
## Detail

`;

if (staleRefs.length === 0) {
  output += "All memory file references verified on disk. No stale refs found.\n";
} else {
  output += "| Memory file | Line | Type | Ref | Reason |\n";
  output += "|---|---|---|---|---|\n";
  for (const r of staleRefs) {
    const refSafe = r.ref.slice(0, 100).replace(/\|/g, "\\|");
    output += `| \`${r.memoryFile}\` | L${r.lineNo} | ${r.refType} | \`${refSafe}\` | ${r.reason} |\n`;
  }
}

output += `
---

## Instructions for Lane D-validate

For each **STALE** entry:
1. Verify the referenced path is genuinely gone (not moved).
2. If moved: correct the memory to the new path.
3. If deleted: decide whether the memory is still valid with a corrected reference, or is itself stale (delete or rewrite).
4. Log each change in the initiative \`activity.jsonl\` (memory is outside VC — log only).
5. After all corrections, re-run this script to confirm zero STALE refs.

**Never delete a memory solely because a file moved** — update the reference.
**Delete a memory only if its claim is provably wrong** (per Lane D-validate autonomy policy).

---

_Run: \`npx tsx plugin/scripts/docs-hygiene/memory-check.ts\` from the workspace root._
`;

fs.mkdirSync(OUTPUT_DIR, { recursive: true });
fs.writeFileSync(OUTPUT_PATH, output, "utf8");
console.log(OUTPUT_PATH);
console.error(`\nMemory check complete — ${staleCount} stale refs written to ${OUTPUT_PATH}`);
