#!/usr/bin/env -S npx tsx
/**
 * scripts/shadow-mode.ts
 *
 * Implements guild-plan.md §11.2 step 7 — shadow mode.
 * Runs the proposed skill against historical run traces under each run's
 * event log — canonical logs/v1.4-events.jsonl first, legacy events.ndjson
 * fallback (see scripts/lib/run-events.ts) — WITHOUT changing live routing.
 * For each historical trace, replays the proposed skill's TRIGGER check
 * against the prompts recorded and records whether the proposed description
 * would have triggered differently than current behavior implied by the
 * trace.
 *
 * Usage:
 *   scripts/shadow-mode.ts --skill <slug> --proposed-edit <path> \
 *          [--run-id <id>] [--cwd <path>]
 *
 * Options:
 *   --skill <slug>         (required) Skill slug (for header labeling).
 *   --proposed-edit <path> (required) Path to the proposed SKILL.md (or a file
 *                          containing YAML frontmatter with `description:`).
 *   --run-id <id>          (optional, default "shadow-latest") Identifier for
 *                          the evolve run; output goes to
 *                          .guild/evolve/<run-id>/shadow-report.md.
 *   --cwd <path>           (optional, default ".") Repo root.
 *
 * Reads (per historical run, canonical-first / legacy-fallback — see
 * scripts/lib/run-events.ts):
 *   <cwd>/.guild/runs/&lt;id&gt;/logs/v1.4-events.jsonl  — canonical trace log.
 *   <cwd>/.guild/runs/&lt;id&gt;/events.ndjson            — legacy mirror fallback.
 *   <proposed-edit>                                — proposed skill file.
 * Writes:
 *   <cwd>/.guild/evolve/<run-id>/shadow-report.md
 *
 * Stdout: (none; structured report is on disk)
 * Stderr: diagnostics.
 *
 * Exit codes:
 *   0  Always — shadow mode is diagnostic and never blocks.
 *   1  Bad input (missing --skill or --proposed-edit, proposed file missing).
 *   2  Internal error.
 *
 * Invariant: never writes to .guild/wiki/. Never changes live routing (skills
 *             directory is untouched).
 */

import * as fs from "fs";
import * as path from "path";
import { loadRunEvents, RunEvent } from "./lib/run-events";

// ── Types ──────────────────────────────────────────────────────────────────

/** Alias kept for local readability; see scripts/lib/run-events.ts for the
 *  full (superset, all-optional) event shape this module reads defensively. */
type TraceEvent = RunEvent;

interface ShadowOutcome {
  runId: string;
  prompts: number;
  wouldTrigger: number;
  wouldSkip: number;
  historicalSpecialist: string; // observed from trace, for collision heuristic
  divergences: number; // cases where trigger would differ from historical behavior
}

// ── CLI parsing ────────────────────────────────────────────────────────────

function parseArgs(argv: string[]): {
  skill: string | null;
  proposedEdit: string | null;
  runId: string;
  cwd: string;
} {
  let skill: string | null = null;
  let proposedEdit: string | null = null;
  let runId = "shadow-latest";
  let cwd = ".";
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--skill" && i + 1 < argv.length) skill = argv[++i];
    else if (argv[i] === "--proposed-edit" && i + 1 < argv.length)
      proposedEdit = argv[++i];
    else if (argv[i] === "--run-id" && i + 1 < argv.length) runId = argv[++i];
    else if (argv[i] === "--cwd" && i + 1 < argv.length) cwd = argv[++i];
  }
  return { skill, proposedEdit, runId, cwd };
}

// ── Frontmatter parsing (minimal YAML subset) ──────────────────────────────

interface ProposedSpec {
  name: string;
  description: string;
  triggerTokens: string[];
  doNotTriggerTokens: string[];
}

function parseProposedEdit(filePath: string): ProposedSpec {
  const content = fs.readFileSync(filePath, "utf8");
  const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
  const fm = fmMatch ? fmMatch[1] : "";

  let name = "";
  let description = "";
  for (const line of fm.split("\n")) {
    const m = line.match(/^(\w+):\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    const value = m[2].trim();
    if (key === "name") name = value;
    else if (key === "description") description = value;
  }

  // Extract TRIGGER / DO NOT TRIGGER clauses from the description.
  // Strategy: find DO NOT TRIGGER clause first (up to next sentence), then
  // search the remainder for TRIGGER (excluding the DO NOT TRIGGER span).
  const { triggerTokens, doNotTriggerTokens } = extractClauses(description);

  return {
    name: name || "(unnamed)",
    description,
    triggerTokens,
    doNotTriggerTokens,
  };
}

function extractClauses(text: string): {
  triggerTokens: string[];
  doNotTriggerTokens: string[];
} {
  // Split description into sentence-like chunks.
  const sentences = text.split(/(?<=[.!?])\s+/);
  let triggerTokens: string[] = [];
  let doNotTriggerTokens: string[] = [];

  for (const s of sentences) {
    if (/DO\s+NOT\s+TRIGGER/i.test(s)) {
      doNotTriggerTokens = tokenizeClause(
        s.replace(/.*DO\s+NOT\s+TRIGGER[^\w]*/i, "")
      );
    } else if (/TRIGGER/i.test(s)) {
      triggerTokens = tokenizeClause(s.replace(/.*TRIGGER[^\w]*/i, ""));
    }
  }
  return { triggerTokens, doNotTriggerTokens };
}

function tokenizeClause(text: string): string[] {
  const STOP = new Set([
    "trigger",
    "not",
    "for",
    "and",
    "the",
    "a",
    "an",
    "or",
    "on",
    "of",
    "to",
    "in",
    "with",
    "from",
    "requests",
    "request",
  ]);
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !STOP.has(t));
}

// ── Historical trace loading ───────────────────────────────────────────────

function listHistoricalRuns(cwd: string): string[] {
  const runsDir = path.join(cwd, ".guild", "runs");
  if (!fs.existsSync(runsDir)) return [];
  return fs
    .readdirSync(runsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
}

// ── Replay logic ───────────────────────────────────────────────────────────

/**
 * Does the proposed skill's description trigger on `prompt`?
 *
 * Heuristic (deterministic):
 *  - If any DO NOT TRIGGER token appears in prompt → false.
 *  - Else if any TRIGGER token appears → true.
 *  - Else → false (no signal).
 */
function wouldTrigger(prompt: string, spec: ProposedSpec): boolean {
  const lower = prompt.toLowerCase();
  for (const t of spec.doNotTriggerTokens) {
    if (t && lower.includes(t)) return false;
  }
  for (const t of spec.triggerTokens) {
    if (t && lower.includes(t)) return true;
  }
  return false;
}

function evaluateRun(
  runId: string,
  events: TraceEvent[],
  spec: ProposedSpec,
  skillSlug: string
): ShadowOutcome {
  // User prompts are captured as UserPromptSubmit events with a `prompt` field.
  const prompts = events
    .filter((e) => (e.event ?? "") === "UserPromptSubmit" && typeof e.prompt === "string")
    .map((e) => e.prompt as string);

  // Historical specialist: the most-frequently-appearing non-empty specialist
  // value across PostToolUse/SubagentStop events.
  const specialistCounts = new Map<string, number>();
  for (const e of events) {
    if (!e.specialist) continue;
    specialistCounts.set(e.specialist, (specialistCounts.get(e.specialist) ?? 0) + 1);
  }
  let historicalSpecialist = "(none)";
  if (specialistCounts.size > 0) {
    historicalSpecialist = Array.from(specialistCounts.entries()).sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0])
    )[0][0];
  }

  let wouldTriggerCount = 0;
  let wouldSkipCount = 0;
  let divergences = 0;

  // Derive the "historical triggered this skill?" signal from the specialist:
  // if the trace involves a specialist whose name contains the full skill
  // identity (namespace-stripped, e.g. "create-skill" from "guild:create-skill"),
  // we say historical "triggered".
  //
  // §F3 fix: use the full non-namespace identity, NOT the last path segment.
  // Splitting on [-:] and taking the last token (e.g. "skill" from
  // "guild:create-skill") is too generic — it spuriously matches any specialist
  // whose name happens to end in that fragment (e.g. "wiki-query-skill-helper"),
  // making divergence a false upper-bound. Stripping only the "namespace:"
  // prefix preserves the full identity ("create-skill") for an accurate match.
  const slugIdentity = skillSlug.replace(/^[^:]+:/, "").toLowerCase();

  for (const p of prompts) {
    const wt = wouldTrigger(p, spec);
    if (wt) wouldTriggerCount++;
    else wouldSkipCount++;

    const historicalTriggered = historicalSpecialist.toLowerCase().includes(slugIdentity);
    if (wt !== historicalTriggered) divergences++;
  }

  return {
    runId,
    prompts: prompts.length,
    wouldTrigger: wouldTriggerCount,
    wouldSkip: wouldSkipCount,
    historicalSpecialist,
    divergences,
  };
}

// ── Report formatting ──────────────────────────────────────────────────────

function formatReport(
  skillSlug: string,
  spec: ProposedSpec,
  outcomes: ShadowOutcome[]
): string {
  const totalPrompts = outcomes.reduce((a, o) => a + o.prompts, 0);
  const totalDivergences = outcomes.reduce((a, o) => a + o.divergences, 0);
  const divergenceRate =
    totalPrompts > 0 ? totalDivergences / totalPrompts : 0;

  const lines: string[] = [];
  lines.push("---");
  lines.push(`skill: ${skillSlug}`);
  lines.push(`proposed_name: ${spec.name}`);
  lines.push(`historical_runs: ${outcomes.length}`);
  lines.push(`total_prompts: ${totalPrompts}`);
  lines.push(`total_divergences: ${totalDivergences}`);
  lines.push(`divergence_rate: ${divergenceRate.toFixed(3)}`);
  lines.push("---");
  lines.push("");
  lines.push(`# Shadow-mode report — ${skillSlug}`);
  lines.push("");
  lines.push("## Proposed spec");
  lines.push("");
  lines.push(`- name: \`${spec.name}\``);
  lines.push(`- description: ${spec.description || "_(none)_"}`);
  lines.push(`- trigger tokens (derived): ${spec.triggerTokens.join(", ") || "_(none)_"}`);
  lines.push(
    `- do-not-trigger tokens (derived): ${spec.doNotTriggerTokens.join(", ") || "_(none)_"}`
  );
  lines.push("");
  lines.push("## Per-historical-run outcomes");
  lines.push("");
  if (outcomes.length === 0) {
    lines.push("_No historical runs found under .guild/runs/._");
  } else {
    lines.push(
      "| run | prompts | would_trigger | would_skip | historical_specialist | divergences |"
    );
    lines.push("|---|---|---|---|---|---|");
    for (const o of outcomes) {
      lines.push(
        `| ${o.runId} | ${o.prompts} | ${o.wouldTrigger} | ${o.wouldSkip} | ${o.historicalSpecialist} | ${o.divergences} |`
      );
    }
  }
  lines.push("");
  lines.push("## Aggregate");
  lines.push("");
  lines.push(`- total prompts replayed: **${totalPrompts}**`);
  lines.push(`- total divergences: **${totalDivergences}**`);
  lines.push(`- divergence rate: **${(divergenceRate * 100).toFixed(1)}%**`);
  lines.push("");
  lines.push(
    "_Shadow mode is diagnostic only. Live routing was not changed. Exit code is always 0._"
  );
  lines.push("");

  return lines.join("\n");
}

// ── Main ───────────────────────────────────────────────────────────────────

function main(): void {
  const { skill, proposedEdit, runId, cwd: cwdArg } = parseArgs(
    process.argv.slice(2)
  );

  if (!skill) {
    process.stderr.write("[shadow-mode] ERROR: --skill <slug> is required\n");
    process.exit(1);
  }
  if (!proposedEdit) {
    process.stderr.write(
      "[shadow-mode] ERROR: --proposed-edit <path> is required\n"
    );
    process.exit(1);
  }
  if (!fs.existsSync(proposedEdit!)) {
    process.stderr.write(
      `[shadow-mode] ERROR: proposed-edit file not found: ${proposedEdit}\n`
    );
    process.exit(1);
  }

  const cwd = path.resolve(cwdArg);
  const spec = parseProposedEdit(proposedEdit!);

  const runs = listHistoricalRuns(cwd);
  const outcomes: ShadowOutcome[] = [];
  for (const r of runs) {
    const runDir = path.join(cwd, ".guild", "runs", r);
    const { events } = loadRunEvents(runDir);
    if (events.length === 0) continue;
    outcomes.push(evaluateRun(r, events, spec, skill!));
  }

  const report = formatReport(skill!, spec, outcomes);
  const outFile = path.join(
    cwd,
    ".guild",
    "evolve",
    runId,
    "shadow-report.md"
  );
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, report, "utf8");

  process.stderr.write(
    `[shadow-mode] evaluated ${outcomes.length} historical run(s) for ${skill} → ${outFile}\n`
  );
  process.exit(0);
}

main();
