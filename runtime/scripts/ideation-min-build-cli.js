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

// scripts/ideation-min-build-cli.ts
var fs3 = __toESM(require("fs"));
var path3 = __toESM(require("path"));

// scripts/lib/ideation-min-build.ts
var GROUNDED_IN_INIT_MINIMAL = "init_minimal";
var PLACEHOLDER_GOAL = "[PLACEHOLDER \u2014 no init wiki: describe what you want to build or improve]";
var PLACEHOLDER_AUDIENCE = "[PLACEHOLDER \u2014 no init wiki: describe the primary users or consumers]";
var GAP_NOTICE = "Missing init wiki: this spec was resolver-built and lacks real project knowledge. Run /guild:init to replace this baseline with grounded context.";
function needsMinBuild(initState) {
  return !initState.hasInitWiki;
}
function resolveMinBuildSpec(input, resolvedAt) {
  const facts = input.projectFacts ?? {};
  const goal = typeof facts.description === "string" && facts.description.trim().length > 0 ? facts.description.trim() : PLACEHOLDER_GOAL;
  const audience = Array.isArray(facts.owners) && facts.owners.length > 0 ? `Known owners/stakeholders: ${facts.owners.join(", ")}` : PLACEHOLDER_AUDIENCE;
  const knownConstraints = Array.isArray(facts.knownConstraints) && facts.knownConstraints.length > 0 ? [...facts.knownConstraints] : [];
  const constraints = [...knownConstraints, GAP_NOTICE];
  const projectName = typeof facts.name === "string" && facts.name.trim().length > 0 ? facts.name.trim() : "[unknown-project]";
  const primaryLanguage = typeof facts.primaryLanguage === "string" && facts.primaryLanguage.trim().length > 0 ? facts.primaryLanguage.trim() : "";
  const spec = {
    grounded_in: GROUNDED_IN_INIT_MINIMAL,
    goal,
    audience,
    constraints,
    gap: GAP_NOTICE,
    projectName,
    primaryLanguage
  };
  if (typeof resolvedAt === "string" && resolvedAt.length > 0) {
    spec.resolvedAt = resolvedAt;
  }
  return spec;
}
function validateMinBuildSpec(spec) {
  const errors = [];
  if (spec === null || typeof spec !== "object") {
    return { valid: false, errors: ["spec must be a non-null object"] };
  }
  const s = spec;
  if (s["grounded_in"] !== GROUNDED_IN_INIT_MINIMAL) {
    errors.push(`grounded_in must be "${GROUNDED_IN_INIT_MINIMAL}", got: ${String(s["grounded_in"])}`);
  }
  if (typeof s["goal"] !== "string" || s["goal"].trim().length === 0) {
    errors.push("goal must be a non-empty string");
  }
  if (typeof s["audience"] !== "string" || s["audience"].trim().length === 0) {
    errors.push("audience must be a non-empty string");
  }
  if (!Array.isArray(s["constraints"]) || s["constraints"].length === 0) {
    errors.push("constraints must be a non-empty array");
  } else {
    const gap = typeof s["gap"] === "string" ? s["gap"] : "";
    const constraintsArr = s["constraints"];
    const allStrings = constraintsArr.every((c) => typeof c === "string");
    if (!allStrings) {
      errors.push("all constraints entries must be strings");
    }
    if (gap.length > 0 && !constraintsArr.includes(gap)) {
      errors.push("gap must appear in constraints[]");
    }
  }
  if (typeof s["gap"] !== "string" || s["gap"].trim().length === 0) {
    errors.push("gap must be a non-empty string");
  }
  if (typeof s["projectName"] !== "string" || s["projectName"].trim().length === 0) {
    errors.push("projectName must be a non-empty string");
  }
  return { valid: errors.length === 0, errors };
}

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

// scripts/ideation-min-build-cli.ts
function parseArgs(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const key = argv[i].slice(2);
      const val = i + 1 < argv.length && !argv[i + 1].startsWith("--") ? argv[++i] : "true";
      flags[key] = val;
    }
  }
  return flags;
}
function observeInitState(cwd) {
  const wikiIndex = path3.join(cwd, ".guild", "wiki", "index.md");
  const guildYaml = path3.join(cwd, ".guild", "guild.yaml");
  return {
    hasInitWiki: fs3.existsSync(wikiIndex),
    hasGuildYaml: fs3.existsSync(guildYaml)
  };
}
function main() {
  const flags = parseArgs(process.argv.slice(2));
  const cwd = flags.cwd ?? process.cwd();
  ensureStorageLayout(cwd, { detectOnly: true });
  const initState = observeInitState(cwd);
  if (!needsMinBuild(initState)) {
    process.stdout.write(JSON.stringify({ needsMinBuild: false }) + "\n");
    return;
  }
  const facts = {
    name: flags.name ?? path3.basename(path3.resolve(cwd)),
    ...flags.description ? { description: flags.description } : {},
    ...flags.language ? { primaryLanguage: flags.language } : {}
  };
  const resolvedAt = flags.now ?? (/* @__PURE__ */ new Date()).toISOString();
  const spec = resolveMinBuildSpec({ hasInitWiki: false, projectFacts: facts }, resolvedAt);
  const validation = validateMinBuildSpec(spec);
  if (!validation.valid) {
    process.stderr.write(
      `ideation-min-build-cli: resolver produced an invalid baseline: ${validation.errors.join("; ")}
`
    );
    process.exit(1);
  }
  const frontmatter = {
    grounded_in: spec.grounded_in,
    resolver_built: true,
    gap: spec.gap,
    resolved_at: spec.resolvedAt ?? resolvedAt
  };
  process.stdout.write(JSON.stringify({ needsMinBuild: true, spec, frontmatter }) + "\n");
}
main();
