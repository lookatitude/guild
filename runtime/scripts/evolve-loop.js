#!/usr/bin/env node
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// scripts/evolve-loop.ts
var crypto = __toESM(require("crypto"));
var fs = __toESM(require("fs"));
var path = __toESM(require("path"));
function parseArgs(argv) {
  let skill = null;
  let runId = null;
  let proposedEdit = null;
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
function listSkillTierDirs(root) {
  const skillsRoot = path.join(root, "skills");
  try {
    return fs.readdirSync(skillsRoot, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
  } catch {
    return [];
  }
}
function findSkillUnderSkillsRoot(root, slug) {
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
function findLiveSkillDir(cwd, slug) {
  const projectDir = path.join(cwd, ".guild", "skills", slug);
  if (fs.existsSync(path.join(projectDir, "SKILL.md"))) {
    return { tier: "project", dir: projectDir };
  }
  const selfBuild = findSkillUnderSkillsRoot(cwd, slug);
  if (selfBuild) return selfBuild;
  const pluginRoot = process.env["GUILD_PLUGIN_ROOT"] ?? process.env["CLAUDE_PLUGIN_ROOT"];
  if (pluginRoot && path.resolve(pluginRoot) !== path.resolve(cwd)) {
    const shipped = findSkillUnderSkillsRoot(pluginRoot, slug);
    if (shipped) return shipped;
  }
  return null;
}
function baselineHash(liveDir) {
  const body = path.join(liveDir, "SKILL.md");
  return crypto.createHash("sha256").update(fs.readFileSync(body, "utf8"), "utf8").digest("hex");
}
function buildPipelineMd(params) {
  const {
    slug,
    runId,
    tier,
    liveDir,
    baseline,
    proposedEdit,
    cwd
  } = params;
  const lines = [];
  lines.push("---");
  lines.push(`run_id: ${runId}`);
  lines.push(`skill: ${slug}`);
  lines.push(`tier: ${tier}`);
  lines.push(`live_skill_path: ${liveDir}`);
  lines.push(`baseline_sha256: ${baseline}`);
  lines.push(`proposed_edit: ${proposedEdit ?? "(to be supplied by step 3)"}`);
  lines.push(`generated_at: ${(/* @__PURE__ */ new Date()).toISOString()}`);
  lines.push("---");
  lines.push("");
  lines.push(`# Evolve pipeline \u2014 ${slug} (run ${runId})`);
  lines.push("");
  lines.push(
    "Implements `guild-plan.md \xA711.2` 10-step self-evolution pipeline. This file is the run plan \u2014 the orchestrator dispatches subagents + script calls in the order below. The promotion gate (step 8) is a human decision and MUST NOT be auto-applied by this wrapper."
  );
  lines.push("");
  lines.push("## Steps");
  lines.push("");
  lines.push(
    `1. **Record the pre-edit baseline.** Done by evolve-loop: \`baseline_sha256: ${baseline}\`. No version tree is written (KTD48) \u2014 the inverse span lands in compact history when the delta is applied.`
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
      `7. **Shadow mode.** (Deferred \u2014 requires --proposed-edit.) Call: \`npx tsx scripts/shadow-mode.ts --skill ${slug} --proposed-edit <path> --run-id ${runId} --cwd ${cwd}\`.`
    );
  }
  lines.push(
    "8. **Promotion gate.** HUMAN DECISION. Promote if ANY of the four conditions holds: (a) 0 regressions AND \u2265 1 fix, (b) no flip change AND tokens \u2193 \u2265 10%, (c) regressions present AND user approves via review viewer, (d) doc-only fast-path \u2014 the proposed edit is doc-only (no trigger-phrasing, body-algorithm, or eval-case change; prose/description/comments only, so paired evals show no delta) AND the user approves (a blanket session directive or a run-time prompt qualifies); recorded as `condition: doc-only-fast-path` (+ `user_approved_at`) in `gate.json`. The doc-only path is NOT a fallback for behavior-change edits. Gate result goes to `gate.json`. This wrapper stops here \u2014 it does NOT auto-promote."
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
function main() {
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
  const live = findLiveSkillDir(cwd, skill);
  if (!live) {
    process.stderr.write(
      `[evolve-loop] ERROR: live skill not found at ${cwd}/.guild/skills/${skill}/SKILL.md, ${cwd}/skills/<tier>/${skill}/SKILL.md, or the plugin install (GUILD_PLUGIN_ROOT/CLAUDE_PLUGIN_ROOT)
`
    );
    process.exit(1);
  }
  const baseline = baselineHash(live.dir);
  const evolveDir = path.join(cwd, ".guild", "evolve", runId);
  fs.mkdirSync(evolveDir, { recursive: true });
  const pipelineMd = buildPipelineMd({
    slug: skill,
    runId,
    tier: live.tier,
    liveDir: live.dir,
    baseline,
    proposedEdit,
    cwd
  });
  fs.writeFileSync(path.join(evolveDir, "pipeline.md"), pipelineMd, "utf8");
  process.stderr.write(
    `[evolve-loop] baseline ${baseline.slice(0, 12)}\u2026
[evolve-loop] pipeline.md \u2192 ${evolveDir}/pipeline.md
[evolve-loop] STOPPED before promotion gate (step 8) \u2014 orchestrator takes over
`
  );
  process.exit(0);
}
main();
