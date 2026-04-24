#!/usr/bin/env -S npx tsx
/**
 * scripts/evolve-loop.ts
 *
 * Top-level orchestration wrapper for the §11.2 10-step evolve pipeline.
 * Snapshots the current skill to .guild/skill-versions/<slug>/v<N>/, prepares
 * paired-subagent invocation scaffolding (emits command lines rather than
 * dispatching — actual dispatch is the orchestrator's job via the Agent tool),
 * and plans calls to flip-report.ts, shadow-mode.ts, and description-optimizer.ts.
 * Stops BEFORE promoting — the promotion gate is a human decision gated by the
 * orchestrator.
 *
 * Usage:
 *   scripts/evolve-loop.ts --skill <slug> --run-id <id> \
 *          [--proposed-edit <path>] [--cwd <path>]
 *
 * Options:
 *   --skill <slug>         (required) Skill slug (e.g. "guild-brainstorm").
 *   --run-id <id>          (required) Identifier for this evolve run.
 *   --proposed-edit <path> (optional) Path to proposed SKILL.md — recorded in
 *                          pipeline.md as the handoff to step 3.
 *   --cwd <path>           (optional, default ".") Repo root.
 *
 * Reads:
 *   <cwd>/skills/{core,meta,specialists}/<slug>/ — live skill directory to snap.
 * Writes:
 *   <cwd>/.guild/skill-versions/<slug>/v<N>/     — pre-edit snapshot.
 *   <cwd>/.guild/evolve/<run-id>/pipeline.md     — 10-step plan + next actions.
 *
 * Stdout: status messages only.
 * Stderr: diagnostics.
 *
 * Exit codes:
 *   0  Success (snapshot taken + pipeline.md written).
 *   1  Bad input (missing --skill or --run-id, skill dir missing).
 *   2  Internal error.
 *
 * Invariants:
 *   - NEVER promotes (does not touch skills/<tier>/<slug>/).
 *   - NEVER writes to .guild/wiki/.
 *   - Snapshot is non-destructive: only appends a new v<N>.
 */

import * as fs from "fs";
import * as path from "path";

// ── CLI parsing ────────────────────────────────────────────────────────────

function parseArgs(argv: string[]): {
  skill: string | null;
  runId: string | null;
  proposedEdit: string | null;
  cwd: string;
} {
  let skill: string | null = null;
  let runId: string | null = null;
  let proposedEdit: string | null = null;
  let cwd = ".";
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--skill" && i + 1 < argv.length) skill = argv[++i];
    else if (argv[i] === "--run-id" && i + 1 < argv.length) runId = argv[++i];
    else if (argv[i] === "--proposed-edit" && i + 1 < argv.length)
      proposedEdit = argv[++i];
    else if (argv[i] === "--cwd" && i + 1 < argv.length) cwd = argv[++i];
  }
  return { skill, runId, proposedEdit, cwd };
}

// ── Skill path resolution ──────────────────────────────────────────────────

const KNOWN_TIERS = ["core", "meta", "specialists"];

function findLiveSkillDir(cwd: string, slug: string): { tier: string; dir: string } | null {
  for (const tier of KNOWN_TIERS) {
    const dir = path.join(cwd, "skills", tier, slug);
    if (fs.existsSync(path.join(dir, "SKILL.md"))) return { tier, dir };
  }
  return null;
}

// ── Snapshot ───────────────────────────────────────────────────────────────

function nextVersion(versionsDir: string): number {
  if (!fs.existsSync(versionsDir)) return 1;
  const existing = fs
    .readdirSync(versionsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^v\d+$/.test(d.name))
    .map((d) => parseInt(d.name.slice(1), 10))
    .filter((n) => Number.isFinite(n));
  return existing.length === 0 ? 1 : Math.max(...existing) + 1;
}

function copyDirRecursive(src: string, dst: string): void {
  fs.mkdirSync(dst, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const e of entries) {
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isDirectory()) {
      copyDirRecursive(s, d);
    } else if (e.isFile()) {
      fs.copyFileSync(s, d);
    }
  }
}

function writeSnapshotMeta(
  snapshotDir: string,
  slug: string,
  runId: string,
  proposedEdit: string | null
): void {
  const meta = {
    created_at: new Date().toISOString(),
    source: "evolve-loop-snapshot",
    skill: slug,
    run_id: runId,
    proposed_edit: proposedEdit ?? null,
    delta_summary: "pre-evolve snapshot",
  };
  fs.writeFileSync(
    path.join(snapshotDir, "meta.json"),
    JSON.stringify(meta, null, 2),
    "utf8"
  );
}

// ── Pipeline plan ──────────────────────────────────────────────────────────

function buildPipelineMd(params: {
  slug: string;
  runId: string;
  tier: string;
  liveDir: string;
  snapshotDir: string;
  versionN: number;
  proposedEdit: string | null;
  cwd: string;
}): string {
  const {
    slug,
    runId,
    tier,
    liveDir,
    snapshotDir,
    versionN,
    proposedEdit,
    cwd,
  } = params;

  const lines: string[] = [];
  lines.push("---");
  lines.push(`run_id: ${runId}`);
  lines.push(`skill: ${slug}`);
  lines.push(`tier: ${tier}`);
  lines.push(`live_skill_path: ${liveDir}`);
  lines.push(`snapshot_path: ${snapshotDir}`);
  lines.push(`snapshot_version: v${versionN}`);
  lines.push(`proposed_edit: ${proposedEdit ?? "(to be supplied by step 3)"}`);
  lines.push(`generated_at: ${new Date().toISOString()}`);
  lines.push("---");
  lines.push("");
  lines.push(`# Evolve pipeline — ${slug} (run ${runId})`);
  lines.push("");
  lines.push(
    "Implements `guild-plan.md §11.2` 10-step self-evolution pipeline. This file is the run plan — the orchestrator dispatches subagents + script calls in the order below. The promotion gate (step 8) is a human decision and MUST NOT be auto-applied by this wrapper."
  );
  lines.push("");
  lines.push("## Steps");
  lines.push("");
  lines.push(
    `1. **Snapshot current skill.** Done by evolve-loop. Snapshot: \`${snapshotDir}\` (v${versionN}).`
  );
  lines.push(
    `2. **Load evals.** Read \`${liveDir}/evals.json\`; if < 3 positives + 3 negatives, bootstrap from \`.guild/reflections/*.md\`.`
  );
  lines.push(
    "3. **Dispatch paired subagents.** Orchestrator spawns A (current skill from the snapshot) and B (proposed edit) in the same turn. Feed each the merged eval working set. Output: `runs/{A,B}/` trajectories."
  );
  lines.push(
    "4. **Drafter writes assertions.** Runs in parallel with step 3. Output: `assertions.json`."
  );
  lines.push(
    "5. **Grader evaluates.** Reads `runs/{A,B}/` + `assertions.json`. Output: `grading.json`."
  );
  lines.push(
    `6. **Benchmark + flip report.** Call: \`npx tsx scripts/flip-report.ts --run-id ${runId} --cwd ${cwd}\`. Output: \`.guild/evolve/${runId}/flip-report.md\`.`
  );
  if (proposedEdit) {
    lines.push(
      `7. **Shadow mode.** Call: \`npx tsx scripts/shadow-mode.ts --skill ${slug} --proposed-edit ${proposedEdit} --run-id ${runId} --cwd ${cwd}\`. Output: \`.guild/evolve/${runId}/shadow-report.md\`.`
    );
  } else {
    lines.push(
      `7. **Shadow mode.** (Deferred — requires --proposed-edit.) Call: \`npx tsx scripts/shadow-mode.ts --skill ${slug} --proposed-edit <path> --run-id ${runId} --cwd ${cwd}\`.`
    );
  }
  lines.push(
    "8. **Promotion gate.** HUMAN DECISION. Promote if ANY of: (a) 0 regressions AND ≥ 1 fix, (b) no flip change AND tokens ↓ ≥ 10%, (c) regressions present AND user approves via review viewer. Gate result goes to `gate.json`. This wrapper stops here — it does NOT auto-promote."
  );
  lines.push(
    `9. **On promote: description optimizer + commit.** Call: \`npx tsx scripts/description-optimizer.ts --skill ${slug} --cwd ${cwd}\`. Orchestrator applies the emitted \`description:\` YAML to the live skill, bumps the version folder, and updates \`evals.json\` if new cases were bootstrapped in step 2.`
  );
  lines.push(
    `10. **On reject: archive attempt.** Move proposed edit + flip report + shadow-mode output + gate verdict to \`.guild/evolve/${runId}/archived/\`. Live skill untouched.`
  );
  lines.push("");
  lines.push("## Next action for orchestrator");
  lines.push("");
  lines.push(
    "Dispatch paired subagents (step 3) and drafter (step 4). Once `grading.json` is written, run `flip-report.ts` (step 6), then `shadow-mode.ts` (step 7), then surface both reports at the gate (step 8)."
  );
  lines.push("");
  lines.push("## Invariants");
  lines.push("");
  lines.push("- This wrapper NEVER mutates the live skill directory.");
  lines.push("- This wrapper NEVER writes to .guild/wiki/.");
  lines.push("- Snapshots are non-destructive — history only grows.");
  lines.push("");

  return lines.join("\n");
}

// ── Main ───────────────────────────────────────────────────────────────────

function main(): void {
  const { skill, runId, proposedEdit, cwd: cwdArg } = parseArgs(
    process.argv.slice(2)
  );

  if (!skill) {
    process.stderr.write("[evolve-loop] ERROR: --skill <slug> is required\n");
    process.exit(1);
  }
  if (!runId) {
    process.stderr.write("[evolve-loop] ERROR: --run-id <id> is required\n");
    process.exit(1);
  }

  const cwd = path.resolve(cwdArg);
  const live = findLiveSkillDir(cwd, skill!);
  if (!live) {
    process.stderr.write(
      `[evolve-loop] ERROR: live skill not found at ${cwd}/skills/{core,meta,specialists}/${skill}/SKILL.md\n`
    );
    process.exit(1);
  }

  // 1. Snapshot the live skill.
  const versionsDir = path.join(cwd, ".guild", "skill-versions", skill!);
  const n = nextVersion(versionsDir);
  const snapshotDir = path.join(versionsDir, `v${n}`);
  copyDirRecursive(live!.dir, snapshotDir);
  writeSnapshotMeta(snapshotDir, skill!, runId!, proposedEdit);

  // 2. Write pipeline.md.
  const evolveDir = path.join(cwd, ".guild", "evolve", runId!);
  fs.mkdirSync(evolveDir, { recursive: true });
  const pipelineMd = buildPipelineMd({
    slug: skill!,
    runId: runId!,
    tier: live!.tier,
    liveDir: live!.dir,
    snapshotDir,
    versionN: n,
    proposedEdit,
    cwd,
  });
  fs.writeFileSync(path.join(evolveDir, "pipeline.md"), pipelineMd, "utf8");

  process.stderr.write(
    `[evolve-loop] snapshot v${n} → ${snapshotDir}\n[evolve-loop] pipeline.md → ${evolveDir}/pipeline.md\n[evolve-loop] STOPPED before promotion gate (step 8) — orchestrator takes over\n`
  );
  process.exit(0);
}

main();
