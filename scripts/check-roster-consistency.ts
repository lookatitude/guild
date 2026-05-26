#!/usr/bin/env -S npx tsx
/**
 * scripts/check-roster-consistency.ts
 *
 * Read-only validator for docs/specialist-roster.md ↔ agents/*.md frontmatter.
 * Compares the "Complete default-tier map" table in specialist-roster.md
 * against the actual `model:` frontmatter in every agents/*.md file.
 *
 * Reports three classes of drift:
 *   MODEL_MISMATCH  — roster `model:` differs from agent frontmatter `model:`
 *   MISSING_FILE    — roster row references an agent that has no agents/<name>.md
 *   NOT_IN_ROSTER   — agents/<name>.md exists but has no row in the tier map
 *
 * Usage:
 *   npx tsx scripts/check-roster-consistency.ts [--cwd <plugin-root>]
 *
 * Options:
 *   --cwd <path>   Plugin root (default: parent directory of this script).
 *                  Expects <cwd>/docs/specialist-roster.md and <cwd>/agents/.
 *
 * Exit codes:
 *   0  Consistent — no drift found.
 *   1  Drift found or input error; details written to stderr.
 *
 * Invariants:
 *   - Read-only. Never writes any file.
 *   - No network. All comparisons are local filesystem reads.
 *   - Deterministic given the same inputs.
 */

import * as fs from "fs";
import * as path from "path";

// ── Types ─────────────────────────────────────────────────────────────────

export interface RosterEntry {
  /** Role name as it appears in the tier map (backticks stripped). */
  role: string;
  /** Expected `model:` value per the roster (e.g. "opus", "sonnet"). */
  model: string;
}

export interface AgentFrontmatter {
  /** Agent name from frontmatter `name:` field. */
  name: string;
  /** Actual `model:` value from the agent file's YAML frontmatter. */
  model: string;
}

export interface ConsistencyResult {
  rosterEntries: Map<string, RosterEntry>;
  agentEntries: Map<string, AgentFrontmatter>;
  issues: DriftIssue[];
}

export type DriftKind = "MODEL_MISMATCH" | "MISSING_FILE" | "NOT_IN_ROSTER";

export interface DriftIssue {
  kind: DriftKind;
  message: string;
}

// ── Roster parsing ────────────────────────────────────────────────────────

/**
 * Parse the "Complete default-tier map" Markdown table from specialist-roster.md.
 *
 * Finds the section whose heading contains "Complete default-tier map" (case-
 * insensitive), then locates the first table in that section whose header row
 * contains both "Role" and "Group" columns plus a "`model:`" column. Reads
 * every data row until the table ends.
 *
 * This scoping prevents the earlier 5-column "Tiered-worker roster" table
 * (which also has a `model:` column) from being picked up accidentally.
 *
 * Returns a Map keyed by role name (backticks stripped).
 */
export function parseRosterTierMap(rosterContent: string): Map<string, RosterEntry> {
  const lines = rosterContent.split("\n");
  const map = new Map<string, RosterEntry>();

  let inTargetSection = false;
  let headerFound = false;
  let headerColModel = -1; // 0-based data-column index of the `model:` column

  for (const line of lines) {
    const trimmed = line.trim();

    // Enter the target section when we see a heading containing the marker text
    if (/^#{1,6}\s.*complete default-tier map/i.test(trimmed)) {
      inTargetSection = true;
      continue;
    }

    // Exit the target section when we encounter any new heading at the same or
    // higher level (i.e., another `#…` heading) after entering the section
    if (inTargetSection && !headerFound && /^#{1,6}\s/.test(trimmed)) {
      // Another section heading before we found our table — bail out
      break;
    }

    if (!inTargetSection) continue;

    // Detect table header row: must contain "Role", "Group", and "`model:`"
    if (!headerFound) {
      if (
        trimmed.startsWith("|") &&
        /\|\s*Role\s*\|/i.test(trimmed) &&
        /\|\s*Group\s*\|/i.test(trimmed) &&
        /`model:`/i.test(trimmed)
      ) {
        const cols = splitTableRow(trimmed);
        headerColModel = cols.findIndex(c => /^`?model:`?$/i.test(c.trim()));
        if (headerColModel === -1) continue;
        headerFound = true;
      }
      continue;
    }

    // Skip separator rows (|---|---|)
    if (/^\|\s*-+\s*\|/.test(trimmed)) continue;

    // End of table: blank line or non-pipe content after header was found
    if (!trimmed.startsWith("|")) break;

    // Data row
    const cols = splitTableRow(trimmed);
    if (cols.length <= headerColModel) continue;

    const role = stripBackticks(cols[0]);
    const model = stripBackticks(cols[headerColModel]);

    if (role && model) {
      map.set(role, { role, model });
    }
  }

  return map;
}

/** Split a Markdown table row `| a | b | c |` into `["a", "b", "c"]`. */
function splitTableRow(row: string): string[] {
  return row
    .split("|")
    .map(c => c.trim())
    .filter((_, i, arr) => i > 0 && i < arr.length - 1);
}

/** Remove surrounding backticks from a string, e.g. `` `opus` `` → `opus`. */
function stripBackticks(s: string): string {
  return s.replace(/`/g, "").trim();
}

// ── Agent frontmatter parsing ──────────────────────────────────────────────

/**
 * Parse `name:` and `model:` from a YAML frontmatter block (between `---`
 * delimiters at the start of the file).
 *
 * Falls back to the filename stem for `name:` when the frontmatter lacks it.
 * Returns null if no frontmatter or no `model:` key is found.
 */
export function parseAgentFrontmatter(
  content: string,
  fileBasename: string
): AgentFrontmatter | null {
  // YAML frontmatter: starts at top, bounded by --- ... ---
  const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!fmMatch) return null;

  const yaml = fmMatch[1];

  const modelMatch = yaml.match(/^model:\s*(.+)$/m);
  if (!modelMatch) return null;

  const nameMatch = yaml.match(/^name:\s*(.+)$/m);
  const name = nameMatch
    ? nameMatch[1].trim()
    : path.basename(fileBasename, ".md");
  const model = modelMatch[1].trim();

  return { name, model };
}

// ── Core comparison ───────────────────────────────────────────────────────

/**
 * Compare rosterMap against agentMap and return all drift issues.
 *
 * Three issue kinds (in reporting order):
 *   1. MISSING_FILE    — roster has a role but no matching agents/<role>.md
 *   2. MODEL_MISMATCH  — agent file exists but `model:` differs from roster
 *   3. NOT_IN_ROSTER   — agents/<name>.md exists but has no roster row
 */
export function compareRosterToAgents(
  rosterMap: Map<string, RosterEntry>,
  agentMap: Map<string, AgentFrontmatter>
): DriftIssue[] {
  const issues: DriftIssue[] = [];

  // Pass 1: every roster entry must have a matching, consistent agent file
  for (const [role, entry] of rosterMap) {
    if (!agentMap.has(role)) {
      issues.push({
        kind: "MISSING_FILE",
        message:
          `MISSING_FILE  roster lists "${role}" (model: ${entry.model}) ` +
          `but agents/${role}.md does not exist`,
      });
    } else {
      const agent = agentMap.get(role)!;
      if (agent.model !== entry.model) {
        issues.push({
          kind: "MODEL_MISMATCH",
          message:
            `MODEL_MISMATCH  "${role}": roster says model="${entry.model}" ` +
            `but agents/${role}.md has model="${agent.model}"`,
        });
      }
    }
  }

  // Pass 2: every agent file must have a roster row
  for (const name of agentMap.keys()) {
    if (!rosterMap.has(name)) {
      issues.push({
        kind: "NOT_IN_ROSTER",
        message:
          `NOT_IN_ROSTER  agents/${name}.md exists but "${name}" is not ` +
          `listed in the specialist-roster.md tier map`,
      });
    }
  }

  return issues;
}

// ── Filesystem helpers ────────────────────────────────────────────────────

/**
 * Load roster + agent files from the given plugin root, parse both, and
 * return a ConsistencyResult.
 *
 * Throws (writes to stderr + exits 1) if required paths are missing.
 */
export function loadAndCompare(pluginRoot: string): ConsistencyResult {
  const rosterPath = path.join(pluginRoot, "docs", "specialist-roster.md");
  const agentsDir = path.join(pluginRoot, "agents");

  if (!fs.existsSync(rosterPath)) {
    process.stderr.write(`ERROR: roster file not found: ${rosterPath}\n`);
    process.exit(1);
  }
  if (!fs.existsSync(agentsDir)) {
    process.stderr.write(`ERROR: agents directory not found: ${agentsDir}\n`);
    process.exit(1);
  }

  // Parse roster tier map
  const rosterContent = fs.readFileSync(rosterPath, "utf8");
  const rosterEntries = parseRosterTierMap(rosterContent);

  if (rosterEntries.size === 0) {
    process.stderr.write(
      `ERROR: no entries parsed from the "Complete default-tier map" table in ` +
        `${rosterPath}. Verify the table header contains "Role" and "\`model:\`".\n`
    );
    process.exit(1);
  }

  // Parse agent frontmatters
  const agentFiles = fs
    .readdirSync(agentsDir)
    .filter(f => f.endsWith(".md"))
    .sort();

  const agentEntries = new Map<string, AgentFrontmatter>();
  for (const file of agentFiles) {
    const content = fs.readFileSync(path.join(agentsDir, file), "utf8");
    const fm = parseAgentFrontmatter(content, file);
    if (fm) {
      agentEntries.set(fm.name, fm);
    }
  }

  const issues = compareRosterToAgents(rosterEntries, agentEntries);
  return { rosterEntries, agentEntries, issues };
}

// ── CLI entry point ───────────────────────────────────────────────────────

function parseCwd(args: string[]): string {
  const idx = args.indexOf("--cwd");
  if (idx !== -1 && args[idx + 1]) {
    return path.resolve(args[idx + 1]);
  }
  // Default: one level up from scripts/ (the plugin root)
  return path.resolve(__dirname, "..");
}

if (require.main === module) {
  const pluginRoot = parseCwd(process.argv.slice(2));
  const { issues } = loadAndCompare(pluginRoot);

  if (issues.length === 0) {
    process.stdout.write(
      "✓ specialist-roster.md tier map is consistent with agents/ frontmatter\n"
    );
    process.exit(0);
  } else {
    process.stderr.write(`✗ ${issues.length} drift issue(s) detected:\n\n`);
    for (const issue of issues) {
      process.stderr.write(`  ${issue.message}\n`);
    }
    process.stderr.write("\n");
    process.exit(1);
  }
}
