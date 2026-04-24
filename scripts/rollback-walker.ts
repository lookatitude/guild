#!/usr/bin/env -S npx tsx
/**
 * scripts/rollback-walker.ts
 *
 * Implements guild-plan.md §11.3 — versioning and rollback enumeration.
 * Reads .guild/skill-versions/<slug>/ — expects vN/ subdirs each with
 * SKILL.md + evals.json + meta.json ({created_at, source, delta_summary}).
 * Emits the version history to stdout as a markdown table.
 *
 * With --steps <n>: identifies the target version (current - n) and emits a
 * "proposed_rollback" action as YAML on stdout. The orchestrator performs the
 * actual snapshot. This script NEVER mutates skill-versions/ itself.
 *
 * Usage:
 *   scripts/rollback-walker.ts --skill <slug> [--steps <n>] [--cwd <path>]
 *
 * Options:
 *   --skill <slug>  (required) Skill slug.
 *   --steps <n>     (optional) Walk n versions back from live (default: 0,
 *                   which just enumerates the stack without picking a target).
 *   --cwd <path>    (optional, default ".") Repo root.
 *
 * Reads:  <cwd>/.guild/skill-versions/<slug>/vN/ (SKILL.md + meta.json)
 * Writes: NONE (non-mutating by contract; rollback itself is performed by the
 *          orchestrator as a new vN+1 snapshot per §11.3 non-destructive rule).
 *
 * Stdout: markdown version table, and (if --steps is given) a YAML
 *          proposed_rollback block.
 * Stderr: diagnostics.
 *
 * Exit codes:
 *   0  Success.
 *   1  Bad input (missing --skill, skill-versions dir missing, --steps past v1).
 *   2  Internal error.
 *
 * Invariant: never writes to .guild/wiki/. Never writes to skill-versions/.
 */

import * as fs from "fs";
import * as path from "path";

// ── Types ──────────────────────────────────────────────────────────────────

interface VersionMeta {
  created_at?: string;
  source?: string;
  delta_summary?: string;
}

interface VersionEntry {
  name: string; // "v1", "v2", …
  n: number; // parsed version number
  dir: string; // absolute path to the version directory
  meta: VersionMeta;
}

// ── CLI parsing ────────────────────────────────────────────────────────────

function parseArgs(argv: string[]): {
  skill: string | null;
  steps: number | null;
  cwd: string;
} {
  let skill: string | null = null;
  let steps: number | null = null;
  let cwd = ".";
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--skill" && i + 1 < argv.length) skill = argv[++i];
    else if (argv[i] === "--steps" && i + 1 < argv.length) {
      const parsed = parseInt(argv[++i], 10);
      if (!Number.isFinite(parsed) || parsed < 0) {
        process.stderr.write(
          `[rollback-walker] ERROR: --steps must be a non-negative integer\n`
        );
        process.exit(1);
      }
      steps = parsed;
    } else if (argv[i] === "--cwd" && i + 1 < argv.length) cwd = argv[++i];
  }
  return { skill, steps, cwd };
}

// ── Version enumeration ────────────────────────────────────────────────────

function enumerateVersions(versionsDir: string): VersionEntry[] {
  const entries = fs
    .readdirSync(versionsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^v\d+$/.test(d.name));

  const versions: VersionEntry[] = [];
  for (const d of entries) {
    const n = parseInt(d.name.slice(1), 10);
    const dir = path.join(versionsDir, d.name);
    let meta: VersionMeta = {};
    const metaPath = path.join(dir, "meta.json");
    if (fs.existsSync(metaPath)) {
      try {
        meta = JSON.parse(fs.readFileSync(metaPath, "utf8")) as VersionMeta;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        process.stderr.write(
          `[rollback-walker] WARN: failed to parse ${metaPath}: ${msg}\n`
        );
      }
    }
    versions.push({ name: d.name, n, dir, meta });
  }
  versions.sort((a, b) => a.n - b.n);
  return versions;
}

// ── Formatting ─────────────────────────────────────────────────────────────

function formatTable(versions: VersionEntry[]): string {
  if (versions.length === 0) return "_No versions._";
  const lines: string[] = [];
  lines.push("| version | created_at | source | delta_summary |");
  lines.push("|---|---|---|---|");
  for (const v of versions) {
    const createdAt = v.meta.created_at ?? "—";
    const source = v.meta.source ?? "—";
    const delta = v.meta.delta_summary ?? "—";
    lines.push(`| ${v.name} | ${createdAt} | ${source} | ${delta} |`);
  }
  return lines.join("\n");
}

function formatProposedRollback(
  skill: string,
  current: VersionEntry,
  target: VersionEntry,
  steps: number
): string {
  const lines: string[] = [];
  lines.push("proposed_rollback:");
  lines.push(`  skill: ${skill}`);
  lines.push(`  current_version: ${current.name}`);
  lines.push(`  target_version: ${target.name}`);
  lines.push(`  steps_back: ${steps}`);
  lines.push(`  target_source: ${target.meta.source ?? "unknown"}`);
  lines.push(
    `  target_delta_summary: ${target.meta.delta_summary ?? "(none)"}`
  );
  lines.push(
    `  note: Rollback is performed by the orchestrator as a new v${current.n + 1} snapshot per §11.3 (non-destructive).`
  );
  return lines.join("\n");
}

// ── Main ───────────────────────────────────────────────────────────────────

function main(): void {
  const { skill, steps, cwd: cwdArg } = parseArgs(process.argv.slice(2));

  if (!skill) {
    process.stderr.write("[rollback-walker] ERROR: --skill <slug> is required\n");
    process.exit(1);
  }

  const cwd = path.resolve(cwdArg);
  const versionsDir = path.join(cwd, ".guild", "skill-versions", skill);

  if (!fs.existsSync(versionsDir)) {
    process.stderr.write(
      `[rollback-walker] ERROR: version history not found at ${versionsDir}\n`
    );
    process.exit(1);
  }

  const versions = enumerateVersions(versionsDir);
  if (versions.length === 0) {
    process.stderr.write(
      `[rollback-walker] ERROR: no v<N> subdirs under ${versionsDir}\n`
    );
    process.exit(1);
  }

  // Emit version table to stdout.
  const table = formatTable(versions);
  process.stdout.write(`# Version history — ${skill}\n\n`);
  process.stdout.write(table + "\n");

  // --steps walk (if provided and > 0).
  if (steps !== null && steps > 0) {
    const current = versions[versions.length - 1];
    const targetIdx = versions.length - 1 - steps;
    if (targetIdx < 0) {
      process.stderr.write(
        `[rollback-walker] ERROR: --steps ${steps} would walk past v1 (only ${versions.length} versions available)\n`
      );
      process.exit(1);
    }
    const target = versions[targetIdx];
    process.stdout.write("\n");
    process.stdout.write(formatProposedRollback(skill, current, target, steps) + "\n");
  }

  process.stderr.write(
    `[rollback-walker] enumerated ${versions.length} version(s) for ${skill}\n`
  );
  process.exit(0);
}

main();
