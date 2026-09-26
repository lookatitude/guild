#!/usr/bin/env -S npx tsx
/**
 * scripts/evolve-loop.ts
 *
 * Top-level orchestration wrapper for the §11.2 10-step evolve pipeline.
 * Records the live skill's pre-edit BASELINE HASH, prepares paired-subagent
 * invocation scaffolding (emits command lines rather than dispatching — actual
 * dispatch is the orchestrator's job via the Agent tool), and plans calls to
 * flip-report.ts, shadow-mode.ts, and description-optimizer.ts. Stops BEFORE
 * promoting — the promotion gate is a human decision gated by the orchestrator.
 *
 * KTD48: there is NO version-snapshot tree. The pre-edit record is the baseline
 * hash here plus the inverse span compact history records at apply time
 * (`src/domains/evolve/compact-history.ts`). A full copy of the old
 * body bought nothing rollback needs and put derived data in durable `.guild/`.
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
 *   <cwd>/skills/{core,meta,specialists}/<slug>/ — live skill directory.
 * Writes:
 *   <cwd>/.guild/evolve/<run-id>/pipeline.md     — 10-step plan + next actions.
 *
 * Stdout: status messages only.
 * Stderr: diagnostics.
 *
 * Exit codes:
 *   0  Success (baseline recorded + pipeline.md written).
 *   1  Bad input (missing --skill or --run-id, skill dir missing).
 *   2  Internal error.
 *
 * Invariants:
 *   - NEVER promotes (does not touch skills/<tier>/<slug>/).
 *   - NEVER writes to .guild/wiki/.
 *   - NEVER copies the live body anywhere: the baseline is a hash (KTD48).
 */

import * as crypto from "crypto";
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

/**
 * Enumerate the tier directories directly under <root>/skills/ — dynamic
 * replacement for a hardcoded tier list. Picks up any tier (core, meta,
 * knowledge, specialists, guild-operations, guild-quality, or a future
 * addition) without a code change. Returns [] when skills/ does not exist.
 */
function listSkillTierDirs(root: string): string[] {
  const skillsRoot = path.join(root, "skills");
  try {
    return fs
      .readdirSync(skillsRoot, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
  } catch {
    return [];
  }
}

/**
 * Resolve a live skill dir under <root>/skills/: either a dir-level skill
 * (SKILL.md directly at skills/<slug>/, e.g. guild-quality, guild-operations)
 * or a tier-nested skill (skills/<tier>/<slug>/), where tiers are enumerated
 * from disk rather than a hardcoded list.
 */
function findSkillUnderSkillsRoot(root: string, slug: string): { tier: string; dir: string } | null {
  const directDir = path.join(root, "skills", slug);
  if (fs.existsSync(path.join(directDir, "SKILL.md"))) {
    return { tier: "skills", dir: directDir };
  }
  for (const tier of listSkillTierDirs(root)) {
    const dir = path.join(root, "skills", tier, slug);
    if (fs.existsSync(path.join(dir, "SKILL.md"))) return { tier, dir };
  }
  return null;
}

function findLiveSkillDir(cwd: string, slug: string): { tier: string; dir: string } | null {
  // DH-3: the consuming repo's project instance wins over the plugin library —
  // an evolved/minted skill at .guild/skills/<slug>/ is the live version, so a
  // later evolve round baselines and edits THAT, not the shipped library copy.
  const projectDir = path.join(cwd, ".guild", "skills", slug);
  if (fs.existsSync(path.join(projectDir, "SKILL.md"))) {
    return { tier: "project", dir: projectDir };
  }
  // Self-build layout: skills/<tier>/ (or dir-level skills/<slug>/) under cwd
  // (the plugin repo itself).
  const selfBuild = findSkillUnderSkillsRoot(cwd, slug);
  if (selfBuild) return selfBuild;
  // Consuming repo without a project instance yet: resolve the shipped
  // baseline from the plugin install so the first evolve of a plugin skill
  // works outside the plugin repo.
  const pluginRoot =
    process.env["GUILD_PLUGIN_ROOT"] ?? process.env["CLAUDE_PLUGIN_ROOT"];
  if (pluginRoot && path.resolve(pluginRoot) !== path.resolve(cwd)) {
    const shipped = findSkillUnderSkillsRoot(pluginRoot, slug);
    if (shipped) return shipped;
  }
  return null;
}

// ── Baseline ───────────────────────────────────────────────────────────────

/**
 * The pre-edit baseline: the sha256 of the live `SKILL.md`, and nothing else.
 *
 * This replaced the `v<N>` snapshot tree (KTD48/R60). The hash is what the gate's
 * B-reproducibility check compares against, and the inverse span compact history
 * writes at apply time is what rollback restores. Copying the whole body served
 * neither, and it grew a tree of stale prompt text inside durable `.guild/`.
 */
function baselineHash(liveDir: string): string {
  const body = path.join(liveDir, "SKILL.md");
  return crypto.createHash("sha256").update(fs.readFileSync(body, "utf8"), "utf8").digest("hex");
}

// ── Pipeline plan ──────────────────────────────────────────────────────────

function buildPipelineMd(params: {
  slug: string;
  runId: string;
  tier: string;
  liveDir: string;
  baseline: string;
  proposedEdit: string | null;
  cwd: string;
}): string {
  const {
    slug,
    runId,
    tier,
    liveDir,
    baseline,
    proposedEdit,
    cwd,
  } = params;

  const lines: string[] = [];
  lines.push("---");
  lines.push(`run_id: ${runId}`);
  lines.push(`skill: ${slug}`);
  lines.push(`tier: ${tier}`);
  lines.push(`live_skill_path: ${liveDir}`);
  lines.push(`baseline_sha256: ${baseline}`);
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
    `1. **Record the pre-edit baseline.** Done by evolve-loop: \`baseline_sha256: ${baseline}\`. No version tree is written (KTD48) — the inverse span lands in compact history when the delta is applied.`
  );
  lines.push(
    `2. **Load evals.** Read \`${liveDir}/evals.json\`; if < 3 positives + 3 negatives, bootstrap from \`.guild/reflections/*.md\`.`
  );
  lines.push(
    "3. **Dispatch paired subagents.** Orchestrator spawns A (the live skill at the baseline hash) and B (proposed edit) in the same turn. Feed each the merged eval working set. Output: `runs/{A,B}/` trajectories."
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
    "8. **Promotion gate.** HUMAN DECISION. Promote if ANY of the four conditions holds: (a) 0 regressions AND ≥ 1 fix, (b) no flip change AND tokens ↓ ≥ 10%, (c) regressions present AND user approves via review viewer, (d) doc-only fast-path — the proposed edit is doc-only (no trigger-phrasing, body-algorithm, or eval-case change; prose/description/comments only, so paired evals show no delta) AND the user approves (a blanket session directive or a run-time prompt qualifies); recorded as `condition: doc-only-fast-path` (+ `user_approved_at`) in `gate.json`. The doc-only path is NOT a fallback for behavior-change edits. Gate result goes to `gate.json`. This wrapper stops here — it does NOT auto-promote."
  );
  lines.push(
    `9. **On promote: description optimizer + commit.** Call: \`npx tsx scripts/description-optimizer.ts --skill ${slug} --cwd ${cwd}\`. Orchestrator applies the emitted \`description:\` YAML to the live skill as a \`guild.evolve_delta.v1\` span replace (which records the inverse in compact history), and updates \`evals.json\` if new cases were bootstrapped in step 2.`
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
  lines.push("- Compact history is the only pre-edit record; rollback is the inverse span.");
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
      `[evolve-loop] ERROR: live skill not found at ${cwd}/.guild/skills/${skill}/SKILL.md, ` +
        `${cwd}/skills/<tier>/${skill}/SKILL.md, or the plugin install ` +
        `(GUILD_PLUGIN_ROOT/CLAUDE_PLUGIN_ROOT)\n`
    );
    process.exit(1);
  }

  // 1. Record the pre-edit baseline hash (KTD48 — no version tree).
  const baseline = baselineHash(live!.dir);

  // 2. Write pipeline.md.
  const evolveDir = path.join(cwd, ".guild", "evolve", runId!);
  fs.mkdirSync(evolveDir, { recursive: true });
  const pipelineMd = buildPipelineMd({
    slug: skill!,
    runId: runId!,
    tier: live!.tier,
    liveDir: live!.dir,
    baseline,
    proposedEdit,
    cwd,
  });
  fs.writeFileSync(path.join(evolveDir, "pipeline.md"), pipelineMd, "utf8");

  process.stderr.write(
    `[evolve-loop] baseline ${baseline.slice(0, 12)}…\n[evolve-loop] pipeline.md → ${evolveDir}/pipeline.md\n[evolve-loop] STOPPED before promotion gate (step 8) — orchestrator takes over\n`
  );
  process.exit(0);
}

main();
