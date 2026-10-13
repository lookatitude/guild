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

// scripts/lint-context-bundle.ts
var lint_context_bundle_exports = {};
__export(lint_context_bundle_exports, {
  BUNDLE_TOKEN_CAP: () => BUNDLE_TOKEN_CAP,
  GRAPH_SECTION_TOKEN_CAP: () => GRAPH_SECTION_TOKEN_CAP,
  absoluteDefinitionCarriers: () => absoluteDefinitionCarriers,
  estimateTokens: () => estimateTokens,
  extractGraphSections: () => extractGraphSections,
  hasDroppedForBudgetLine: () => hasDroppedForBudgetLine,
  lintBundle: () => lintBundle,
  readDefinitionRef: () => readDefinitionRef,
  readFrontmatterTokenEstimate: () => readFrontmatterTokenEstimate
});
module.exports = __toCommonJS(lint_context_bundle_exports);
var fs3 = __toESM(require("node:fs"));

// scripts/lib/core/contracts/project-definition-ref.ts
var import_util = require("util");
var PROJECT_DEFINITION_REF_SCHEMA = "guild.project_definition_ref.v1";
var DEFINITION_KINDS = Object.freeze(["agent", "skill"]);
var DEFINITION_KIND_SET = new Set(DEFINITION_KINDS);
var DEFINITION_LAYERS = Object.freeze([
  "plugin-shipped",
  "dot-claude-agents",
  "project-guild",
  "umbrella-guild"
]);
var DEFINITION_LAYER_SET = new Set(DEFINITION_LAYERS);
function layerAgreesWithPath(layer, path3) {
  const segments = path3.split("/");
  const hasClaude = segments.includes(".claude");
  const hasGuild = segments.includes(".guild");
  if (hasClaude && hasGuild) return false;
  if (hasClaude) return layer === "dot-claude-agents";
  if (hasGuild) return layer === "project-guild" || layer === "umbrella-guild";
  return true;
}
function isPlainDataObject(v) {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return false;
  if (import_util.types.isProxy(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}
function ownDataProp(o, key) {
  const desc = Object.getOwnPropertyDescriptor(o, key);
  if (!desc) return { kind: "absent" };
  if (!("value" in desc)) return { kind: "accessor" };
  return { kind: "data", value: desc.value };
}
function hasExactKeys(o, keys) {
  if (Object.getOwnPropertySymbols(o).length > 0) return false;
  const own = Object.getOwnPropertyNames(o);
  if (own.length !== keys.length) return false;
  for (const k of keys) if (!own.includes(k)) return false;
  return true;
}
var MAX_SKILLS = 256;
var MAX_PROJECT_ID = 128;
var MAX_DEFINITION_ID = 128;
var MAX_RELATIVE_PATH = 1024;
var SOURCE_COMMIT_RE = /^[0-9a-f]{7,64}$/;
var CONTROL_RE = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;
function isBoundedScalar(v, max) {
  if (typeof v !== "string" || v.length === 0) return false;
  if (CONTROL_RE.test(v)) return false;
  return Buffer.byteLength(v, "utf8") <= max;
}
var IDENTITY_TOKEN_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
function isIdentityToken(v, max) {
  return isBoundedScalar(v, max) && IDENTITY_TOKEN_RE.test(v);
}
var SKILL_BODY_FILENAME = "SKILL.md";
var CONTENT_HASH_RE = /^sha256:[0-9a-f]{64}$/;
function isValidContentHash(v) {
  return typeof v === "string" && CONTENT_HASH_RE.test(v);
}
function isProjectRelativePath(v) {
  if (!isBoundedScalar(v, MAX_RELATIVE_PATH)) return false;
  if (v.includes("\\")) return false;
  if (v.startsWith("/")) return false;
  if (/^[A-Za-z]:/.test(v)) return false;
  if (v.endsWith("/")) return false;
  const segments = v.split("/");
  for (const seg of segments) {
    if (seg.length === 0) return false;
    if (seg === ".") return false;
    if (seg === "..") return false;
  }
  return true;
}
var PINNED_SKILL_KEYS = ["id", "relative_path", "content_hash"];
var REF_KEYS = [
  "schema_version",
  "project_id",
  "layer",
  "kind",
  "id",
  "relative_path",
  "content_hash",
  "source_commit",
  "specialist_profile_hash",
  "specialist_type_hash",
  "skills"
];
function validatePinnedSkillRefInner(obj) {
  if (!isPlainDataObject(obj)) return null;
  if (!hasExactKeys(obj, PINNED_SKILL_KEYS)) return null;
  const idProp = ownDataProp(obj, "id");
  const pathProp = ownDataProp(obj, "relative_path");
  const hashProp = ownDataProp(obj, "content_hash");
  if (idProp.kind !== "data" || pathProp.kind !== "data" || hashProp.kind !== "data") return null;
  if (!isIdentityToken(idProp.value, MAX_DEFINITION_ID)) return null;
  if (!isProjectRelativePath(pathProp.value)) return null;
  if (!isValidContentHash(hashProp.value)) return null;
  const segments = pathProp.value.split("/");
  if (segments.length < 2) return null;
  if (segments[segments.length - 1] !== SKILL_BODY_FILENAME) return null;
  if (segments[segments.length - 2] !== idProp.value) return null;
  const underProjectSkills = segments[0] === ".guild" && segments[1] === "skills";
  const underPluginSkills = segments[0] === "skills";
  if (!underProjectSkills && !underPluginSkills) return null;
  return {
    id: idProp.value,
    relative_path: pathProp.value,
    content_hash: hashProp.value
  };
}
function sanitizeSkillArr(v) {
  if (!Array.isArray(v)) return null;
  if (import_util.types.isProxy(v)) return null;
  if (Object.getPrototypeOf(v) !== Array.prototype) return null;
  const lenDesc = Object.getOwnPropertyDescriptor(v, "length");
  if (!lenDesc || !("value" in lenDesc) || typeof lenDesc.value !== "number" || !Number.isInteger(lenDesc.value) || lenDesc.value < 0) {
    return null;
  }
  if (lenDesc.value > MAX_SKILLS) return null;
  if (Object.getOwnPropertySymbols(v).length > 0) return null;
  const ownNames = Object.getOwnPropertyNames(v);
  if (ownNames.length > MAX_SKILLS + 1) return null;
  for (const k of ownNames) {
    if (k === "length") continue;
    const n = Number(k);
    if (!Number.isInteger(n) || n < 0 || String(n) !== k) return null;
    if (n >= lenDesc.value) return null;
  }
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  for (let i = 0; i < lenDesc.value; i++) {
    const desc = Object.getOwnPropertyDescriptor(v, i);
    if (!desc || !("value" in desc)) return null;
    const skill = validatePinnedSkillRefInner(desc.value);
    if (skill === null) return null;
    if (seen.has(skill.id)) return null;
    seen.add(skill.id);
    out.push(skill);
  }
  return out;
}
function validateProjectDefinitionRefV1Inner(obj) {
  if (!isPlainDataObject(obj)) return null;
  if (!hasExactKeys(obj, REF_KEYS)) return null;
  const schemaProp = ownDataProp(obj, "schema_version");
  if (schemaProp.kind !== "data" || schemaProp.value !== PROJECT_DEFINITION_REF_SCHEMA) return null;
  const projectProp = ownDataProp(obj, "project_id");
  const layerProp = ownDataProp(obj, "layer");
  const kindProp = ownDataProp(obj, "kind");
  const idProp = ownDataProp(obj, "id");
  const pathProp = ownDataProp(obj, "relative_path");
  const hashProp = ownDataProp(obj, "content_hash");
  const commitProp = ownDataProp(obj, "source_commit");
  const profileHashProp = ownDataProp(obj, "specialist_profile_hash");
  const typeHashProp = ownDataProp(obj, "specialist_type_hash");
  const skillsProp = ownDataProp(obj, "skills");
  if (projectProp.kind !== "data") return null;
  if (layerProp.kind !== "data") return null;
  if (kindProp.kind !== "data") return null;
  if (idProp.kind !== "data") return null;
  if (pathProp.kind !== "data") return null;
  if (hashProp.kind !== "data") return null;
  if (commitProp.kind !== "data") return null;
  if (profileHashProp.kind !== "data") return null;
  if (typeHashProp.kind !== "data") return null;
  if (skillsProp.kind !== "data") return null;
  if (!isIdentityToken(projectProp.value, MAX_PROJECT_ID)) return null;
  if (typeof layerProp.value !== "string" || !DEFINITION_LAYER_SET.has(layerProp.value)) {
    return null;
  }
  if (typeof kindProp.value !== "string" || !DEFINITION_KIND_SET.has(kindProp.value)) return null;
  const kind = kindProp.value;
  if (!isIdentityToken(idProp.value, MAX_DEFINITION_ID)) return null;
  if (!isProjectRelativePath(pathProp.value)) return null;
  if (!isValidContentHash(hashProp.value)) return null;
  if (commitProp.value !== null) {
    if (typeof commitProp.value !== "string") return null;
    if (!SOURCE_COMMIT_RE.test(commitProp.value)) return null;
  }
  const isIdentityHash = (x) => typeof x === "string" && /^[0-9a-f]{64}$/.test(x);
  if (kind === "agent") {
    if (!isIdentityHash(profileHashProp.value)) return null;
    if (!isIdentityHash(typeHashProp.value)) return null;
  } else {
    if (profileHashProp.value !== null) return null;
    if (typeHashProp.value !== null) return null;
  }
  if (!layerAgreesWithPath(layerProp.value, pathProp.value)) return null;
  const skills = sanitizeSkillArr(skillsProp.value);
  if (skills === null) return null;
  return {
    schema_version: PROJECT_DEFINITION_REF_SCHEMA,
    project_id: projectProp.value,
    layer: layerProp.value,
    kind,
    id: idProp.value,
    relative_path: pathProp.value,
    content_hash: hashProp.value,
    source_commit: commitProp.value,
    specialist_profile_hash: kind === "agent" ? profileHashProp.value : null,
    specialist_type_hash: kind === "agent" ? typeHashProp.value : null,
    skills
  };
}
function validateProjectDefinitionRefV1(obj) {
  try {
    return validateProjectDefinitionRefV1Inner(obj);
  } catch {
    return null;
  }
}
var REF_VERIFICATION_FAILURES = Object.freeze([
  /** The ref itself is malformed → transport `invalid_request`. */
  "invalid_ref",
  /** Bytes were supplied but their hash does not match → transport `invalid_request`. */
  "hash_mismatch",
  /** The definition could not be read at `relative_path` → transport `capability_absent`. */
  "bytes_absent"
]);

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

// scripts/lint-context-bundle.ts
var BUNDLE_TOKEN_CAP = 6e3;
var GRAPH_SECTION_TOKEN_CAP = 1200;
function frontmatterBlock(content) {
  const lines = content.split("\n");
  if (lines[0]?.trim() !== "---") return null;
  const end = lines.slice(1).findIndex((line) => line.trim() === "---");
  return end < 0 ? null : lines.slice(1, end + 1).join("\n");
}
function readDefinitionRef(content) {
  const block = frontmatterBlock(content);
  if (block === null) return { ref: null, count: 0 };
  const matches = [...block.matchAll(/^\s*definition_ref:\s*(\{.*\})\s*$/gm)];
  if (matches.length !== 1) return { ref: null, count: matches.length };
  try {
    return { ref: validateProjectDefinitionRefV1(JSON.parse(matches[0][1])), count: 1 };
  } catch {
    return { ref: null, count: 1 };
  }
}
function absoluteDefinitionCarriers(content) {
  return content.split("\n").filter((line) => {
    const value = /^\s*(?:definition\s*:\s*|GUILD_AGENT_DEFINITION\s*=\s*)["']?(\/[^"'\s]*)/.exec(line)?.[1];
    return !!value && /\/(?:\.guild|\.claude)\/agents\/[^/]+\.md$/.test(value);
  });
}
function estimateTokens(text) {
  return Math.ceil(text.length / 4);
}
function readFrontmatterTokenEstimate(content) {
  const lines = content.split("\n");
  if (lines[0]?.trim() !== "---") return null;
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") {
      end = i;
      break;
    }
  }
  if (end === -1) return null;
  const block = lines.slice(1, end).join("\n");
  const m = /^\s*token_estimate:\s*([0-9]+)\s*$/m.exec(block);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}
function extractGraphSections(content) {
  const lines = content.split("\n");
  const sections = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^(#{1,6})\s+(.*)$/.exec(lines[i]);
    if (!m || !/knowledge.?graph/i.test(m[2])) continue;
    const level = m[1].length;
    const body = [];
    let j = i + 1;
    for (; j < lines.length; j++) {
      const hm = /^(#{1,6})\s+/.exec(lines[j]);
      if (hm && hm[1].length <= level) break;
      body.push(lines[j]);
    }
    sections.push(body.join("\n"));
    i = j - 1;
  }
  return sections;
}
function hasDroppedForBudgetLine(content) {
  return content.split("\n").some((l) => l.includes("dropped_for_budget:"));
}
function lintBundle(content) {
  const reasons = [];
  const estTokens = estimateTokens(content);
  const fmEstimate = readFrontmatterTokenEstimate(content);
  const graphSections = extractGraphSections(content);
  const graphEstTokens = graphSections.reduce(
    (sum, s) => sum + estimateTokens(s),
    0
  );
  const hasDropped = hasDroppedForBudgetLine(content);
  const definition = readDefinitionRef(content);
  const absoluteCarriers = absoluteDefinitionCarriers(content);
  if (definition.count !== 1) reasons.push(`bundle must carry exactly one definition_ref frontmatter line; found ${definition.count}`);
  else if (definition.ref === null) reasons.push("bundle definition_ref is malformed or violates guild.project_definition_ref.v1");
  if (absoluteCarriers.length > 0) reasons.push("bundle carries an absolute agent-definition locator; use definition_ref instead");
  if (estTokens > BUNDLE_TOKEN_CAP) {
    reasons.push(
      `bundle estimate ${estTokens} tokens exceeds the ${BUNDLE_TOKEN_CAP}-token hard cap (ceil(chars/4)) \u2014 trim per the size-budget summarization rules and re-lint`
    );
  }
  if (fmEstimate !== null && fmEstimate > BUNDLE_TOKEN_CAP && estTokens <= BUNDLE_TOKEN_CAP) {
    reasons.push(
      `frontmatter token_estimate (${fmEstimate}) exceeds the cap while the deterministic estimate (${estTokens}) does not \u2014 frontmatter may be stale (not a FAIL)`
    );
  }
  if (graphEstTokens > GRAPH_SECTION_TOKEN_CAP && !hasDropped) {
    reasons.push(
      `knowledge-graph section estimate ${graphEstTokens} tokens exceeds the ${GRAPH_SECTION_TOKEN_CAP}-token sub-cap with no dropped_for_budget: line \u2014 drop lowest-weight graph nodes first and record the drop`
    );
  }
  const pass = estTokens <= BUNDLE_TOKEN_CAP && !(graphEstTokens > GRAPH_SECTION_TOKEN_CAP && !hasDropped) && definition.count === 1 && definition.ref !== null && absoluteCarriers.length === 0;
  return {
    pass,
    est_tokens: estTokens,
    graph_est_tokens: graphEstTokens,
    has_dropped_for_budget: hasDropped,
    frontmatter_token_estimate: fmEstimate,
    definition_ref: definition.ref,
    reasons
  };
}
var USAGE = "usage: lint-context-bundle.ts --bundle <file>";
function main() {
  ensureStorageLayout(process.cwd(), { detectOnly: true });
  const argv = process.argv.slice(2);
  let bundlePath;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--bundle" && argv[i + 1] !== void 0) {
      bundlePath = argv[++i];
    } else if (arg.startsWith("--bundle=")) {
      bundlePath = arg.slice("--bundle=".length);
    } else {
      process.stderr.write(`unknown argument: ${arg}
${USAGE}
`);
      return 1;
    }
  }
  if (!bundlePath) {
    process.stderr.write(USAGE + "\n");
    return 1;
  }
  let content;
  try {
    content = fs3.readFileSync(bundlePath, "utf8");
  } catch {
    process.stderr.write(
      `lint-context-bundle: cannot read bundle: ${bundlePath}
`
    );
    return 1;
  }
  const verdict = lintBundle(content);
  process.stdout.write(JSON.stringify(verdict, null, 2) + "\n");
  return verdict.pass ? 0 : 2;
}
if (require.main === module) {
  process.exit(main());
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  BUNDLE_TOKEN_CAP,
  GRAPH_SECTION_TOKEN_CAP,
  absoluteDefinitionCarriers,
  estimateTokens,
  extractGraphSections,
  hasDroppedForBudgetLine,
  lintBundle,
  readDefinitionRef,
  readFrontmatterTokenEstimate
});
