#!/usr/bin/env -S npx tsx
/**
 * scripts/analyze-runs.ts
 *
 * Cross-run evolution-signal aggregator (Track E1 — §3.E1 of the
 * reliability-and-evolution plan). Reads accumulated run artifacts and emits
 * PROPOSAL-ONLY evolution candidates — nothing is auto-promoted.
 *
 * Usage:
 *   scripts/analyze-runs.ts [--cwd <path>] [--min-runs <N>]
 *                            [--out <path>] [--format text|json]
 *
 * Options:
 *   --cwd <path>          Repo root (default: "."). Reads .guild/ from here.
 *   --min-runs <N>        Minimum run appearances to emit a proposal (default: 3).
 *   --out <path>          Also write output to this file (default path:
 *                         <cwd>/.guild/evolve/analyze-runs-latest.md).
 *   --format text|json    Output format for stdout (default: text).
 *
 * Reads (PROPOSAL signals only — never mutates):
 *   <cwd>/.guild/reflections/*.md                    — per-run reflection frontmatter
 *     proposals.skill_improvement[]                    → evolve-skill candidates
 *     proposals.missing_specialist[]                   → create-specialist candidates
 *   <cwd>/.guild/runs/<run-id>/handoffs/<spec>.md    — per-specialist handoff receipts
 *     status: escalate                                 → escalation-cluster candidates
 *
 * Writes:
 *   <cwd>/.guild/evolve/analyze-runs-latest.md  (always — even if 0 proposals)
 *   --out <path>  (if supplied)
 *   NEVER writes to .guild/wiki/
 *   NEVER modifies live skills or agents
 *
 * Stdout:  proposal report (text or JSON)
 * Stderr:  diagnostics only
 *
 * Exit codes:
 *   0  Success (0 proposals is valid)
 *   1  Bad input (--min-runs ≤ 0, non-integer, etc.)
 *   2  Internal error
 *
 * Integration with guild:reflect / maintenance verbs:
 *   guild:reflect writes per-run proposals to .guild/reflections/<run-id>.md.
 *   This script aggregates those proposals across ALL reflections so that
 *   guild:evolve (via the §11.1 automatic threshold) and guild:create-specialist
 *   (via the §11.2.1 extraction signals) can be invoked with concrete evidence
 *   rather than relying on in-context recall.
 *
 *   Suggested invocation points:
 *     - After each reflection (called by guild:reflect as a post-step)
 *     - On demand via /guild:evolve (reads this output to check thresholds)
 *     - As a maintenance verb: /guild evolve --analyze
 */

import * as fs from "fs";
import * as path from "path";

// ── Types ──────────────────────────────────────────────────────────────────

/** Minimal injectable filesystem abstraction for testability. */
export interface IFs {
  existsSync(p: string): boolean;
  readdirSync(p: string): string[];
  readFileSync(p: string, encoding: "utf8"): string;
  mkdirSync(p: string, opts: { recursive: boolean }): void;
  writeFileSync(p: string, data: string, encoding: "utf8"): void;
}

export interface ReflectionMeta {
  runId: string;
  date: string;
  skillImprovement: string[];   // proposals.skill_improvement
  missingSpecialist: string[];  // proposals.missing_specialist
}

export interface HandoffMeta {
  runId: string;
  specialist: string;           // inferred from filename <specialist>-<task>.md
  escalated: boolean;
}

export type ProposalKind = "evolve-skill" | "create-specialist" | "escalation-cluster";

export interface Proposal {
  kind: ProposalKind;
  target: string;       // skill slug, role name, or specialist name
  run_count: number;
  run_ids: string[];    // deduplicated, ordered chronologically
  action: string;       // human-readable next step
}

export interface AnalysisResult {
  generated_at: string;
  min_runs: number;
  reflections_read: number;
  handoffs_read: number;
  proposals: Proposal[];
}

// ── YAML frontmatter parser ────────────────────────────────────────────────

/**
 * Minimal YAML frontmatter extractor.
 * Handles the reflect skill's output shape:
 *
 *   skill_improvement: [a, b, c]     ← inline array
 *   skill_improvement:               ← block array
 *     - a
 *     - b
 *
 * Returns null if the file has no YAML block or parsing fails.
 */
export function parseFrontmatter(content: string): Record<string, unknown> | null {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return null;
  const block = match[1];
  const result: Record<string, unknown> = {};
  const lines = block.split("\n");

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    // Top-level key: value
    const topMatch = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*):\s*(.*)/);
    if (!topMatch) {
      i++;
      continue;
    }
    const key = topMatch[1];
    const rest = topMatch[2].trim();

    if (rest.startsWith("[")) {
      // Inline array: key: [a, b, c] or key: ["a", "b"]
      result[key] = parseInlineArray(rest);
      i++;
    } else if (rest === "" || rest === "|") {
      // Block: look ahead for indented sub-keys or list items
      const nextLineIsIndented =
        i + 1 < lines.length && (lines[i + 1].startsWith("  ") || lines[i + 1].startsWith("\t"));
      if (nextLineIsIndented) {
        // Sub-object or block array
        const sub: Record<string, unknown> = {};
        let blockArr: string[] | null = null;
        i++;
        while (i < lines.length && (lines[i].startsWith("  ") || lines[i].startsWith("\t"))) {
          const subLine = lines[i].replace(/^\s+/, "");
          if (subLine.startsWith("- ")) {
            // Block list item
            if (blockArr === null) blockArr = [];
            blockArr.push(stripQuotes(subLine.slice(2).trim()));
          } else {
            // Sub-key: value or sub-key: [inline]
            const subMatch = subLine.match(/^([a-zA-Z_][a-zA-Z0-9_]*):\s*(.*)/);
            if (subMatch) {
              const subKey = subMatch[1];
              const subVal = subMatch[2].trim();
              if (subVal.startsWith("[")) {
                sub[subKey] = parseInlineArray(subVal);
              } else if (subVal === "") {
                sub[subKey] = null;
              } else {
                sub[subKey] = stripQuotes(subVal);
              }
            }
          }
          i++;
        }
        result[key] = blockArr !== null ? blockArr : sub;
      } else {
        result[key] = null;
        i++;
      }
    } else {
      result[key] = stripQuotes(rest);
      i++;
    }
  }
  return result;
}

function parseInlineArray(str: string): string[] {
  // e.g. [a, b, "c"] or []
  const inner = str.replace(/^\[/, "").replace(/\].*$/, "");
  if (!inner.trim()) return [];
  return inner.split(",").map((s) => stripQuotes(s.trim())).filter(Boolean);
}

function stripQuotes(s: string): string {
  return s.replace(/^["']|["']$/g, "");
}

// ── Reflection reader ──────────────────────────────────────────────────────

export function loadReflections(guildRoot: string, ifs: IFs): ReflectionMeta[] {
  const reflectDir = path.join(guildRoot, ".guild", "reflections");
  if (!ifs.existsSync(reflectDir)) return [];

  const entries = ifs.readdirSync(reflectDir).filter((f) => f.endsWith(".md"));
  const results: ReflectionMeta[] = [];

  for (const entry of entries) {
    const filePath = path.join(reflectDir, entry);
    let content: string;
    try {
      content = ifs.readFileSync(filePath, "utf8");
    } catch {
      process.stderr.write(`[analyze-runs] WARN: could not read ${filePath} — skipping\n`);
      continue;
    }

    const fm = parseFrontmatter(content);
    if (!fm) {
      process.stderr.write(`[analyze-runs] WARN: no frontmatter in ${filePath} — skipping\n`);
      continue;
    }

    const runId = String(fm["run_id"] ?? entry.replace(/\.md$/, ""));
    const date = String(fm["date"] ?? "");

    // proposals may be a nested sub-object
    const proposals = fm["proposals"] as Record<string, unknown> | undefined;
    const skillImprovement = extractStringArray(proposals?.["skill_improvement"]);
    const missingSpecialist = extractStringArray(proposals?.["missing_specialist"]);

    results.push({ runId, date, skillImprovement, missingSpecialist });
  }

  return results;
}

function extractStringArray(val: unknown): string[] {
  if (!Array.isArray(val)) return [];
  return val.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
}

// ── Handoff reader ─────────────────────────────────────────────────────────

export function loadHandoffs(guildRoot: string, ifs: IFs): HandoffMeta[] {
  const runsDir = path.join(guildRoot, ".guild", "runs");
  if (!ifs.existsSync(runsDir)) return [];

  const runDirs = ifs.readdirSync(runsDir);
  const results: HandoffMeta[] = [];

  for (const runDir of runDirs) {
    const handoffsDir = path.join(runsDir, runDir, "handoffs");
    if (!ifs.existsSync(handoffsDir)) continue;

    let handoffFiles: string[];
    try {
      handoffFiles = ifs.readdirSync(handoffsDir).filter((f) => f.endsWith(".md"));
    } catch {
      continue;
    }

    for (const hFile of handoffFiles) {
      const filePath = path.join(handoffsDir, hFile);
      let content: string;
      try {
        content = ifs.readFileSync(filePath, "utf8");
      } catch {
        continue;
      }

      const fm = parseFrontmatter(content);
      if (!fm) continue;

      const status = String(fm["status"] ?? "");
      const escalated = status === "escalate";

      // Infer specialist name from task_id or filename
      // task_id pattern: <specialist>-task-N or <specialist>-<slug>
      let specialist = "";
      const taskId = String(fm["task_id"] ?? "");
      if (taskId) {
        // Extract specialist prefix from task_id (first hyphen-segment group that
        // doesn't look like a UUID or pure number)
        const basename = path.basename(hFile, ".md");
        specialist = inferSpecialistFromTaskId(taskId) || inferSpecialistFromFilename(basename);
      } else {
        specialist = inferSpecialistFromFilename(path.basename(hFile, ".md"));
      }

      results.push({ runId: runDir, specialist, escalated });
    }
  }

  return results;
}

function inferSpecialistFromTaskId(taskId: string): string {
  // e.g. "guild-security-task-1" → "guild-security"
  //      "backend-001"           → "backend"
  const parts = taskId.split("-");
  // Drop trailing numeric or "task" segments
  let end = parts.length;
  while (end > 1) {
    const last = parts[end - 1];
    if (/^\d+$/.test(last) || last === "task") {
      end--;
    } else {
      break;
    }
  }
  return parts.slice(0, end).join("-");
}

function inferSpecialistFromFilename(basename: string): string {
  // e.g. "guild-security-task-1" → strip numeric suffix
  return inferSpecialistFromTaskId(basename);
}

// ── Aggregation ────────────────────────────────────────────────────────────

export function aggregateProposals(
  reflections: ReflectionMeta[],
  handoffs: HandoffMeta[],
  minRuns: number
): Proposal[] {
  // Count mentions by skill / role / specialist, tracking which run_ids appear
  const skillCounts = new Map<string, Set<string>>();     // skill → run_ids
  const specialistCounts = new Map<string, Set<string>>(); // role → run_ids
  const escalationCounts = new Map<string, Set<string>>(); // specialist → run_ids

  for (const ref of reflections) {
    for (const skill of ref.skillImprovement) {
      if (!skillCounts.has(skill)) skillCounts.set(skill, new Set());
      skillCounts.get(skill)!.add(ref.runId);
    }
    for (const role of ref.missingSpecialist) {
      if (!specialistCounts.has(role)) specialistCounts.set(role, new Set());
      specialistCounts.get(role)!.add(ref.runId);
    }
  }

  for (const h of handoffs) {
    if (!h.escalated) continue;
    const key = h.specialist || "(unknown)";
    if (!escalationCounts.has(key)) escalationCounts.set(key, new Set());
    escalationCounts.get(key)!.add(h.runId);
  }

  const proposals: Proposal[] = [];

  for (const [skill, runSet] of skillCounts) {
    if (runSet.size >= minRuns) {
      proposals.push({
        kind: "evolve-skill",
        target: skill,
        run_count: runSet.size,
        run_ids: Array.from(runSet).sort(),
        action: `Run: guild:evolve-skill ${skill}\nEvidence: skill named in ${runSet.size} reflections.`,
      });
    }
  }

  for (const [role, runSet] of specialistCounts) {
    if (runSet.size >= minRuns) {
      proposals.push({
        kind: "create-specialist",
        target: role,
        run_count: runSet.size,
        run_ids: Array.from(runSet).sort(),
        action: `Run: guild:create-specialist (role: "${role}")\nEvidence: role gap flagged in ${runSet.size} reflections.`,
      });
    }
  }

  for (const [specialist, runSet] of escalationCounts) {
    if (runSet.size >= minRuns) {
      proposals.push({
        kind: "escalation-cluster",
        target: specialist,
        run_count: runSet.size,
        run_ids: Array.from(runSet).sort(),
        action: `Review specialist capacity for "${specialist}".\nEvidence: escalated in ${runSet.size} handoffs across distinct runs.`,
      });
    }
  }

  // Sort: by kind then by run_count desc (most frequent first)
  proposals.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind.localeCompare(b.kind);
    return b.run_count - a.run_count;
  });

  return proposals;
}

// ── Output formatting ──────────────────────────────────────────────────────

export function formatText(result: AnalysisResult): string {
  const lines: string[] = [];
  lines.push(`# analyze-runs — evolution proposals`);
  lines.push(`Generated: ${result.generated_at}`);
  lines.push(
    `Sources: ${result.reflections_read} reflection(s), ${result.handoffs_read} handoff(s) read · min-runs=${result.min_runs}`
  );
  lines.push("");

  if (result.proposals.length === 0) {
    lines.push(`No proposals found (threshold not met for any signal).`);
    lines.push("");
    lines.push(
      `Run more tasks and let guild:reflect accumulate signals. ` +
      `Rerun this script when ≥${result.min_runs} reflections name the same skill or role.`
    );
    return lines.join("\n") + "\n";
  }

  lines.push(`## Proposals (${result.proposals.length})`);
  lines.push("");

  for (const p of result.proposals) {
    lines.push(`### [${p.kind}] ${p.target}`);
    lines.push(`- **Appearances:** ${p.run_count} run(s)`);
    lines.push(`- **Run IDs:** ${p.run_ids.join(", ")}`);
    lines.push(`- **Next action:** ${p.action}`);
    lines.push("");
  }

  return lines.join("\n");
}

export function formatJson(result: AnalysisResult): string {
  return JSON.stringify(result, null, 2);
}

export function buildFrontmatter(result: AnalysisResult): string {
  const kindCounts: Record<string, string[]> = {};
  for (const p of result.proposals) {
    if (!kindCounts[p.kind]) kindCounts[p.kind] = [];
    kindCounts[p.kind].push(p.target);
  }
  const lines = [
    "---",
    `generated_at: "${result.generated_at}"`,
    `min_runs: ${result.min_runs}`,
    `reflections_read: ${result.reflections_read}`,
    `handoffs_read: ${result.handoffs_read}`,
    `proposals:`,
  ];
  for (const kind of ["evolve-skill", "create-specialist", "escalation-cluster"]) {
    const targets = kindCounts[kind] ?? [];
    lines.push(`  ${kind}: [${targets.map((t) => `"${t}"`).join(", ")}]`);
  }
  lines.push("---");
  return lines.join("\n") + "\n";
}

// ── CLI ────────────────────────────────────────────────────────────────────

function parseArgs(argv: string[]): {
  cwd: string;
  minRuns: number | null;
  out: string | null;
  format: "text" | "json";
  error: string | null;
} {
  let cwd = ".";
  let minRunsRaw: string | null = null;
  let out: string | null = null;
  let format: "text" | "json" = "text";

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--cwd" && i + 1 < argv.length) {
      cwd = argv[++i];
    } else if (argv[i] === "--min-runs" && i + 1 < argv.length) {
      minRunsRaw = argv[++i];
    } else if (argv[i] === "--out" && i + 1 < argv.length) {
      out = argv[++i];
    } else if (argv[i] === "--format" && i + 1 < argv.length) {
      const fmt = argv[++i];
      if (fmt !== "text" && fmt !== "json") {
        return { cwd, minRuns: null, out, format, error: `--format must be text or json, got: ${fmt}` };
      }
      format = fmt as "text" | "json";
    }
  }

  // Validate --min-runs
  let minRuns = 3;
  if (minRunsRaw !== null) {
    const parsed = Number(minRunsRaw);
    if (!Number.isInteger(parsed) || parsed < 1) {
      return {
        cwd, minRuns: null, out, format,
        error: `--min-runs must be a positive integer, got: ${minRunsRaw}`,
      };
    }
    minRuns = parsed;
  }

  return { cwd, minRuns, out, format, error: null };
}

// ── Main ───────────────────────────────────────────────────────────────────

export function run(
  argv: string[],
  ifs: IFs = fs as unknown as IFs
): { exitCode: number; stdout: string; stderr: string } {
  const { cwd, minRuns, out, format, error } = parseArgs(argv);
  if (error || minRuns === null) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: `[analyze-runs] ERROR: ${error}\n`,
    };
  }

  const resolvedCwd = path.resolve(cwd);

  // Read signals
  const reflections = loadReflections(resolvedCwd, ifs);
  const handoffs = loadHandoffs(resolvedCwd, ifs);

  // Aggregate
  const proposals = aggregateProposals(reflections, handoffs, minRuns);

  const result: AnalysisResult = {
    generated_at: new Date().toISOString(),
    min_runs: minRuns,
    reflections_read: reflections.length,
    handoffs_read: handoffs.length,
    proposals,
  };

  // Format stdout
  const output = format === "json" ? formatJson(result) : formatText(result);

  // Write to default path (.guild/evolve/analyze-runs-latest.md) — always
  const evolveDir = path.join(resolvedCwd, ".guild", "evolve");
  try {
    ifs.mkdirSync(evolveDir, { recursive: true });
    const defaultPath = path.join(evolveDir, "analyze-runs-latest.md");
    const fileContent = buildFrontmatter(result) + "\n" + formatText(result);
    ifs.writeFileSync(defaultPath, fileContent, "utf8");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    process.stderr.write(`[analyze-runs] WARN: could not write default output: ${msg}\n`);
  }

  // Write to --out path if specified
  if (out) {
    const resolvedOut = path.resolve(out);
    // Safety guard: never write to .guild/wiki/
    if (resolvedOut.includes(path.join(".guild", "wiki"))) {
      return {
        exitCode: 1,
        stdout: "",
        stderr: `[analyze-runs] ERROR: --out path must not be inside .guild/wiki/\n`,
      };
    }
    try {
      const outDir = path.dirname(resolvedOut);
      ifs.mkdirSync(outDir, { recursive: true });
      const fileContent = buildFrontmatter(result) + "\n" + formatText(result);
      ifs.writeFileSync(resolvedOut, fileContent, "utf8");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      process.stderr.write(`[analyze-runs] WARN: could not write --out file: ${msg}\n`);
    }
  }

  return { exitCode: 0, stdout: output, stderr: "" };
}

// ── CLI entry point ────────────────────────────────────────────────────────

function main(): void {
  const argv = process.argv.slice(2);
  const { exitCode, stdout, stderr } = run(argv);
  if (stdout) process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);
  process.exit(exitCode);
}

main();
