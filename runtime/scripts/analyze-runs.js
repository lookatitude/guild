#!/usr/bin/env node
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
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
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// scripts/analyze-runs.ts
var analyze_runs_exports = {};
__export(analyze_runs_exports, {
  aggregateProposals: () => aggregateProposals,
  buildFrontmatter: () => buildFrontmatter,
  formatJson: () => formatJson,
  formatText: () => formatText,
  loadHandoffs: () => loadHandoffs,
  loadReflections: () => loadReflections,
  parseFrontmatter: () => parseFrontmatter,
  run: () => run
});
module.exports = __toCommonJS(analyze_runs_exports);
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

// scripts/analyze-runs.ts
function parseFrontmatter(content) {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return null;
  const block = match[1];
  const result = {};
  const lines = block.split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const topMatch = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*):\s*(.*)/);
    if (!topMatch) {
      i++;
      continue;
    }
    const key = topMatch[1];
    const rest = topMatch[2].trim();
    if (rest.startsWith("[")) {
      result[key] = parseInlineArray(rest);
      i++;
    } else if (rest === "" || rest === "|") {
      const nextLineIsIndented = i + 1 < lines.length && (lines[i + 1].startsWith("  ") || lines[i + 1].startsWith("	"));
      if (nextLineIsIndented) {
        const sub = {};
        let blockArr = null;
        i++;
        while (i < lines.length && (lines[i].startsWith("  ") || lines[i].startsWith("	"))) {
          const subLine = lines[i].replace(/^\s+/, "");
          if (subLine.startsWith("- ")) {
            if (blockArr === null) blockArr = [];
            blockArr.push(stripQuotes(subLine.slice(2).trim()));
          } else {
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
function parseInlineArray(str) {
  const inner = str.replace(/^\[/, "").replace(/\].*$/, "");
  if (!inner.trim()) return [];
  return inner.split(",").map((s) => stripQuotes(s.trim())).filter(Boolean);
}
function stripQuotes(s) {
  return s.replace(/^["']|["']$/g, "");
}
function loadReflections(guildRoot, ifs) {
  const reflectDir = path3.join(guildRoot, ".guild", "reflections");
  if (!ifs.existsSync(reflectDir)) return [];
  const entries = ifs.readdirSync(reflectDir).filter((f) => f.endsWith(".md"));
  const results = [];
  for (const entry of entries) {
    const filePath = path3.join(reflectDir, entry);
    let content;
    try {
      content = ifs.readFileSync(filePath, "utf8");
    } catch {
      process.stderr.write(`[analyze-runs] WARN: could not read ${filePath} \u2014 skipping
`);
      continue;
    }
    const fm = parseFrontmatter(content);
    if (!fm) {
      process.stderr.write(`[analyze-runs] WARN: no frontmatter in ${filePath} \u2014 skipping
`);
      continue;
    }
    const runId = String(fm["run_id"] ?? entry.replace(/\.md$/, ""));
    const date = String(fm["date"] ?? "");
    const proposals = fm["proposals"];
    const skillImprovement = extractStringArray(proposals?.["skill_improvement"]);
    const missingSpecialist = extractStringArray(proposals?.["missing_specialist"]);
    results.push({ runId, date, skillImprovement, missingSpecialist });
  }
  return results;
}
function extractStringArray(val) {
  if (!Array.isArray(val)) return [];
  return val.filter((v) => typeof v === "string" && v.trim().length > 0);
}
function loadHandoffs(guildRoot, ifs) {
  const runsDir = path3.join(guildRoot, ".guild", "runs");
  if (!ifs.existsSync(runsDir)) return [];
  const runDirs = ifs.readdirSync(runsDir);
  const results = [];
  for (const runDir of runDirs) {
    const handoffsDir = path3.join(runsDir, runDir, "handoffs");
    if (!ifs.existsSync(handoffsDir)) continue;
    let handoffFiles;
    try {
      handoffFiles = ifs.readdirSync(handoffsDir).filter((f) => f.endsWith(".md"));
    } catch {
      continue;
    }
    for (const hFile of handoffFiles) {
      const filePath = path3.join(handoffsDir, hFile);
      let content;
      try {
        content = ifs.readFileSync(filePath, "utf8");
      } catch {
        continue;
      }
      const fm = parseFrontmatter(content);
      if (!fm) continue;
      const status = String(fm["status"] ?? "");
      const escalated = status === "escalate";
      let specialist = "";
      const taskId = String(fm["task_id"] ?? "");
      if (taskId) {
        const basename2 = path3.basename(hFile, ".md");
        specialist = inferSpecialistFromTaskId(taskId) || inferSpecialistFromFilename(basename2);
      } else {
        specialist = inferSpecialistFromFilename(path3.basename(hFile, ".md"));
      }
      results.push({ runId: runDir, specialist, escalated });
    }
  }
  return results;
}
function inferSpecialistFromTaskId(taskId) {
  const parts = taskId.split("-");
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
function inferSpecialistFromFilename(basename2) {
  return inferSpecialistFromTaskId(basename2);
}
function aggregateProposals(reflections, handoffs, minRuns) {
  const skillCounts = /* @__PURE__ */ new Map();
  const specialistCounts = /* @__PURE__ */ new Map();
  const escalationCounts = /* @__PURE__ */ new Map();
  for (const ref of reflections) {
    for (const skill of ref.skillImprovement) {
      if (!skillCounts.has(skill)) skillCounts.set(skill, /* @__PURE__ */ new Set());
      skillCounts.get(skill).add(ref.runId);
    }
    for (const role of ref.missingSpecialist) {
      if (!specialistCounts.has(role)) specialistCounts.set(role, /* @__PURE__ */ new Set());
      specialistCounts.get(role).add(ref.runId);
    }
  }
  for (const h of handoffs) {
    if (!h.escalated) continue;
    const key = h.specialist || "(unknown)";
    if (!escalationCounts.has(key)) escalationCounts.set(key, /* @__PURE__ */ new Set());
    escalationCounts.get(key).add(h.runId);
  }
  const proposals = [];
  for (const [skill, runSet] of skillCounts) {
    if (runSet.size >= minRuns) {
      proposals.push({
        kind: "evolve-skill",
        target: skill,
        run_count: runSet.size,
        run_ids: Array.from(runSet).sort(),
        action: `Run: guild:evolve-skill ${skill}
Evidence: skill named in ${runSet.size} reflections.`
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
        action: `Run: guild:create-specialist (role: "${role}")
Evidence: role gap flagged in ${runSet.size} reflections.`
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
        action: `Review specialist capacity for "${specialist}".
Evidence: escalated in ${runSet.size} handoffs across distinct runs.`
      });
    }
  }
  proposals.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind.localeCompare(b.kind);
    return b.run_count - a.run_count;
  });
  return proposals;
}
function formatText(result) {
  const lines = [];
  lines.push(`# analyze-runs \u2014 evolution proposals`);
  lines.push(`Generated: ${result.generated_at}`);
  lines.push(
    `Sources: ${result.reflections_read} reflection(s), ${result.handoffs_read} handoff(s) read \xB7 min-runs=${result.min_runs}`
  );
  lines.push("");
  if (result.proposals.length === 0) {
    lines.push(`No proposals found (threshold not met for any signal).`);
    lines.push("");
    lines.push(
      `Run more tasks and let guild:reflect accumulate signals. Rerun this script when \u2265${result.min_runs} reflections name the same skill or role.`
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
function formatJson(result) {
  return JSON.stringify(result, null, 2);
}
function buildFrontmatter(result) {
  const kindCounts = {};
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
    `proposals:`
  ];
  for (const kind of ["evolve-skill", "create-specialist", "escalation-cluster"]) {
    const targets = kindCounts[kind] ?? [];
    lines.push(`  ${kind}: [${targets.map((t) => `"${t}"`).join(", ")}]`);
  }
  lines.push("---");
  return lines.join("\n") + "\n";
}
function parseArgs(argv) {
  let cwd = ".";
  let minRunsRaw = null;
  let out = null;
  let format = "text";
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
      format = fmt;
    }
  }
  let minRuns = 3;
  if (minRunsRaw !== null) {
    const parsed = Number(minRunsRaw);
    if (!Number.isInteger(parsed) || parsed < 1) {
      return {
        cwd,
        minRuns: null,
        out,
        format,
        error: `--min-runs must be a positive integer, got: ${minRunsRaw}`
      };
    }
    minRuns = parsed;
  }
  return { cwd, minRuns, out, format, error: null };
}
function run(argv, ifs = fs3) {
  const { cwd, minRuns, out, format, error } = parseArgs(argv);
  if (error || minRuns === null) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: `[analyze-runs] ERROR: ${error}
`
    };
  }
  const resolvedCwd = path3.resolve(cwd);
  const reflections = loadReflections(resolvedCwd, ifs);
  const handoffs = loadHandoffs(resolvedCwd, ifs);
  const proposals = aggregateProposals(reflections, handoffs, minRuns);
  const result = {
    generated_at: (/* @__PURE__ */ new Date()).toISOString(),
    min_runs: minRuns,
    reflections_read: reflections.length,
    handoffs_read: handoffs.length,
    proposals
  };
  const output = format === "json" ? formatJson(result) : formatText(result);
  const evolveDir = path3.join(resolvedCwd, ".guild", "evolve");
  try {
    ifs.mkdirSync(evolveDir, { recursive: true });
    const defaultPath = path3.join(evolveDir, "analyze-runs-latest.md");
    const fileContent = buildFrontmatter(result) + "\n" + formatText(result);
    ifs.writeFileSync(defaultPath, fileContent, "utf8");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    process.stderr.write(`[analyze-runs] WARN: could not write default output: ${msg}
`);
  }
  if (out) {
    const resolvedOut = path3.resolve(out);
    if (resolvedOut.includes(path3.join(".guild", "wiki"))) {
      return {
        exitCode: 1,
        stdout: "",
        stderr: `[analyze-runs] ERROR: --out path must not be inside .guild/wiki/
`
      };
    }
    try {
      const outDir = path3.dirname(resolvedOut);
      ifs.mkdirSync(outDir, { recursive: true });
      const fileContent = buildFrontmatter(result) + "\n" + formatText(result);
      ifs.writeFileSync(resolvedOut, fileContent, "utf8");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      process.stderr.write(`[analyze-runs] WARN: could not write --out file: ${msg}
`);
    }
  }
  return { exitCode: 0, stdout: output, stderr: "" };
}
function main() {
  ensureStorageLayout(process.cwd(), { detectOnly: true });
  const argv = process.argv.slice(2);
  const { exitCode, stdout, stderr } = run(argv);
  if (stdout) process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);
  process.exit(exitCode);
}
main();
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  aggregateProposals,
  buildFrontmatter,
  formatJson,
  formatText,
  loadHandoffs,
  loadReflections,
  parseFrontmatter,
  run
});
