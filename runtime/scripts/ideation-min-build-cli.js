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
var fs = __toESM(require("fs"));
var path = __toESM(require("path"));

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
  const wikiIndex = path.join(cwd, ".guild", "wiki", "index.md");
  const guildYaml = path.join(cwd, ".guild", "guild.yaml");
  return {
    hasInitWiki: fs.existsSync(wikiIndex),
    hasGuildYaml: fs.existsSync(guildYaml)
  };
}
function main() {
  const flags = parseArgs(process.argv.slice(2));
  const cwd = flags.cwd ?? process.cwd();
  const initState = observeInitState(cwd);
  if (!needsMinBuild(initState)) {
    process.stdout.write(JSON.stringify({ needsMinBuild: false }) + "\n");
    return;
  }
  const facts = {
    name: flags.name ?? path.basename(path.resolve(cwd)),
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
