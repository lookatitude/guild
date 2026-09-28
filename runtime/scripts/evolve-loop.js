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
var fs3 = __toESM(require("fs"));
var path3 = __toESM(require("path"));

// scripts/lib/state/ensure-storage-layout.ts
var fs2 = __toESM(require("node:fs"));
var path2 = __toESM(require("node:path"));

// src/domains/state/guild-root.ts
var fs = __toESM(require("node:fs"));
var path = __toESM(require("node:path"));
function resolveGuildRoot(startDir) {
  const resolvedStart = path.resolve(startDir);
  let current = resolvedStart;
  let nearestGuildDir = null;
  for (; ; ) {
    if (fs.existsSync(path.join(current, ".git"))) return current;
    if (nearestGuildDir === null) {
      const guildDir = path.join(current, ".guild");
      try {
        if (fs.existsSync(guildDir) && fs.statSync(guildDir).isDirectory()) nearestGuildDir = current;
      } catch {
      }
    }
    const parent = path.dirname(current);
    if (parent === current) return nearestGuildDir ?? resolvedStart;
    current = parent;
  }
}

// scripts/lib/state/ensure-storage-layout.ts
var CURRENT_LAYOUT_VERSION = 2;
function markerPath(root) {
  return path2.join(root, ".guild", "storage-layout.json");
}
function detect(cwd = process.cwd()) {
  const root = resolveGuildRoot(cwd);
  const marker = markerPath(root);
  if (!fs2.existsSync(path2.join(root, ".guild"))) {
    return { state: "absent", version: null, root, marker };
  }
  let version = null;
  try {
    const parsed = JSON.parse(fs2.readFileSync(marker, "utf8"));
    if (typeof parsed.storage_layout_version === "number") version = parsed.storage_layout_version;
  } catch {
    version = null;
  }
  if (version === null) return { state: "unmarked", version, root, marker };
  if (version === CURRENT_LAYOUT_VERSION) return { state: "current", version, root, marker };
  return { state: version > CURRENT_LAYOUT_VERSION ? "future" : "stale", version, root, marker };
}
var upgradeChunk = null;
function upgradeChain() {
  if (upgradeChunk === null) {
    const candidates = [
      path2.join(__dirname, "upgrade-chain.js"),
      path2.join(__dirname, "lib", "state", "upgrade-chain"),
      path2.join(__dirname, "upgrade-chain")
    ];
    const spec = candidates.find((c) => fs2.existsSync(c) || fs2.existsSync(`${c}.ts`)) ?? candidates[2];
    upgradeChunk = require(spec);
  }
  return upgradeChunk;
}
function ensureStorageLayout(cwd = process.cwd(), opts = {}) {
  const status = detect(cwd);
  if (status.state === "current") return status;
  if (status.state === "future") {
    throw new Error(
      `guild: .guild/ is layout ${status.version}, this build understands ${CURRENT_LAYOUT_VERSION}. Upgrade Guild; a newer layout is never down-migrated (${status.marker}).`
    );
  }
  if (status.state === "absent" || opts.detectOnly === true) return status;
  const chain = upgradeChain();
  const result = chain.runLayoutUpgrade({
    root: status.root,
    fromVersion: status.version,
    toVersion: CURRENT_LAYOUT_VERSION,
    dryRun: opts.dryRun === true
  });
  const after = detect(cwd);
  return { ...after, upgrade: result };
}
function isProcessEntry() {
  const entry = process.argv[1];
  if (typeof entry !== "string" || entry === "") return false;
  return /(^|[\\/])ensure-storage-layout(\.[cm]?[jt]s)?$/.test(entry);
}
if (isProcessEntry()) {
  const cwdArg = process.argv.find((a) => a.startsWith("--cwd="));
  const cwd = cwdArg ? cwdArg.slice("--cwd=".length) : process.cwd();
  try {
    const status = ensureStorageLayout(cwd, {
      dryRun: process.argv.includes("--dry-run"),
      detectOnly: process.argv.includes("--detect-only")
    });
    if (process.argv.includes("--print")) {
      process.stdout.write(JSON.stringify(status) + "\n");
    } else if (status.upgrade && status.upgrade.state !== "committed") {
      process.stderr.write(`${status.upgrade.report}
`);
    }
    process.exit(0);
  } catch (e) {
    process.stderr.write(`${e.message}
`);
    process.exit(1);
  }
}

// scripts/evolve-loop.ts
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
  const skillsRoot = path3.join(root, "skills");
  try {
    return fs3.readdirSync(skillsRoot, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
  } catch {
    return [];
  }
}
function findSkillUnderSkillsRoot(root, slug) {
  const directDir = path3.join(root, "skills", slug);
  if (fs3.existsSync(path3.join(directDir, "SKILL.md"))) {
    return { tier: "skills", dir: directDir };
  }
  for (const tier of listSkillTierDirs(root)) {
    const dir = path3.join(root, "skills", tier, slug);
    if (fs3.existsSync(path3.join(dir, "SKILL.md"))) return { tier, dir };
  }
  return null;
}
function findLiveSkillDir(cwd, slug) {
  const projectDir = path3.join(cwd, ".guild", "skills", slug);
  if (fs3.existsSync(path3.join(projectDir, "SKILL.md"))) {
    return { tier: "project", dir: projectDir };
  }
  const selfBuild = findSkillUnderSkillsRoot(cwd, slug);
  if (selfBuild) return selfBuild;
  const pluginRoot = process.env["GUILD_PLUGIN_ROOT"] ?? process.env["CLAUDE_PLUGIN_ROOT"];
  if (pluginRoot && path3.resolve(pluginRoot) !== path3.resolve(cwd)) {
    const shipped = findSkillUnderSkillsRoot(pluginRoot, slug);
    if (shipped) return shipped;
  }
  return null;
}
function baselineHash(liveDir) {
  const body = path3.join(liveDir, "SKILL.md");
  return crypto.createHash("sha256").update(fs3.readFileSync(body, "utf8"), "utf8").digest("hex");
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
  ensureStorageLayout(process.cwd(), { detectOnly: true });
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
  const cwd = path3.resolve(cwdArg);
  const live = findLiveSkillDir(cwd, skill);
  if (!live) {
    process.stderr.write(
      `[evolve-loop] ERROR: live skill not found at ${cwd}/.guild/skills/${skill}/SKILL.md, ${cwd}/skills/<tier>/${skill}/SKILL.md, or the plugin install (GUILD_PLUGIN_ROOT/CLAUDE_PLUGIN_ROOT)
`
    );
    process.exit(1);
  }
  const baseline = baselineHash(live.dir);
  const evolveDir = path3.join(cwd, ".guild", "evolve", runId);
  fs3.mkdirSync(evolveDir, { recursive: true });
  const pipelineMd = buildPipelineMd({
    slug: skill,
    runId,
    tier: live.tier,
    liveDir: live.dir,
    baseline,
    proposedEdit,
    cwd
  });
  fs3.writeFileSync(path3.join(evolveDir, "pipeline.md"), pipelineMd, "utf8");
  process.stderr.write(
    `[evolve-loop] baseline ${baseline.slice(0, 12)}\u2026
[evolve-loop] pipeline.md \u2192 ${evolveDir}/pipeline.md
[evolve-loop] STOPPED before promotion gate (step 8) \u2014 orchestrator takes over
`
  );
  process.exit(0);
}
main();
