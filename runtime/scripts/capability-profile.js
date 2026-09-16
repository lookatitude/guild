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

// scripts/capability-profile.ts
var capability_profile_exports = {};
__export(capability_profile_exports, {
  layoutRow: () => layoutRow,
  renderLayoutRow: () => renderLayoutRow
});
module.exports = __toCommonJS(capability_profile_exports);
var fs10 = __toESM(require("fs"));
var path11 = __toESM(require("path"));

// scripts/lib/capability/candidate-surface.ts
var fs = __toESM(require("fs"));
var path = __toESM(require("path"));
var import_util3 = require("util");

// scripts/lib/core/contracts/project-capability-profile.ts
var import_util2 = require("util");

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
function layerAgreesWithPath(layer, path12) {
  const segments = path12.split("/");
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

// scripts/lib/core/contracts/project-capability-profile.ts
var PROJECT_CAPABILITY_PROFILE_SCHEMA = "guild.project_capability_profile.v1";
var DEFAULT_SUGGESTION_BUDGET = 4;
var RESOLVER_MODES = Object.freeze(["legacy", "observe", "shadow", "project-local", "strict"]);
var RESOLVER_MODE_SET = new Set(RESOLVER_MODES);
var CONFIDENCE_GRADES = Object.freeze(["high", "medium", "low"]);
var CONFIDENCE_SET = new Set(CONFIDENCE_GRADES);
var CANDIDATE_ACTIONS = Object.freeze(["propose", "observe", "defer"]);
var CANDIDATE_ACTION_SET = new Set(CANDIDATE_ACTIONS);
var CANDIDATE_KINDS = Object.freeze(["agent", "skill"]);
var CANDIDATE_KIND_SET = new Set(CANDIDATE_KINDS);
var EVIDENCE_SOURCES = Object.freeze([
  "codebase_map",
  "knowledge_graph",
  "run",
  "reflection",
  "roster"
]);
var EVIDENCE_SOURCE_SET = new Set(EVIDENCE_SOURCES);
var MUTATION_WINDOWS = Object.freeze(["run", "emission"]);
var MUTATION_WINDOW_SET = new Set(MUTATION_WINDOWS);
var HISTORICAL_EVIDENCE_SOURCES = Object.freeze(["run", "reflection"]);
var HISTORICAL_SOURCE_SET = new Set(HISTORICAL_EVIDENCE_SOURCES);
function isPlainDataObject2(v) {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return false;
  if (import_util2.types.isProxy(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}
function ownDataProp2(o, key) {
  const desc = Object.getOwnPropertyDescriptor(o, key);
  if (!desc) return { kind: "absent" };
  if (!("value" in desc)) return { kind: "accessor" };
  return { kind: "data", value: desc.value };
}
var MAX_SLUG_LEN = 64;
var MAX_ID_LEN = 128;
var MAX_LABEL_LEN = 200;
var MAX_PROSE_LEN = 500;
var MAX_LOCATOR_LEN = 512;
var MAX_ANCHOR_LEN = 64;
var MAX_REF_LEN = 640;
var MAX_TIMESTAMP_LEN = 64;
var MAX_FACTS = 200;
var MAX_EVIDENCE_REFS = 64;
var MAX_COVERAGE_ENTRIES = 500;
var MAX_JUSTIFIED_BY = 32;
var MAX_ABSENT = 16;
var MAX_PROFILE_BYTES = 256 * 1024;
function measuredBytes(value, depth = 0) {
  if (depth > 8) return Number.POSITIVE_INFINITY;
  if (typeof value === "string") return value.length;
  if (value === null || typeof value !== "object") return 8;
  let total = 0;
  if (Array.isArray(value)) {
    for (const entry of value) total += measuredBytes(entry, depth + 1);
    return total;
  }
  for (const k of Object.getOwnPropertyNames(value)) {
    total += k.length + measuredBytes(value[k], depth + 1);
  }
  return total;
}
var CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/;
var SLUG_SHAPE = /^[a-z0-9][a-z0-9._-]*$/;
function isBoundedSlug(v) {
  return typeof v === "string" && v.length > 0 && v.length <= MAX_SLUG_LEN && !CONTROL_CHARS.test(v) && SLUG_SHAPE.test(v);
}
function isBoundedNamespacedId(v) {
  if (typeof v !== "string" || v.length === 0 || v.length > MAX_ID_LEN) return false;
  if (CONTROL_CHARS.test(v)) return false;
  if (v.includes("\\")) return false;
  for (const seg of v.split("/")) {
    if (!SLUG_SHAPE.test(seg)) return false;
  }
  return true;
}
function isBoundedText(v, max) {
  return typeof v === "string" && v.length > 0 && v.length <= max && !CONTROL_CHARS.test(v);
}
var COMMITISH_RE = /^[0-9a-f]{7,64}$/;
var RFC3339_RE = /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(\.\d{1,9})?([Zz]|[+-]\d{2}:\d{2})$/;
function isRfc3339(v) {
  if (typeof v !== "string" || v.length === 0 || v.length > MAX_TIMESTAMP_LEN) return false;
  const m = RFC3339_RE.exec(v);
  if (m === null) return false;
  const [mo, d, h, mi, sec] = [+m[2], +m[3], +m[4], +m[5], +m[6]];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return false;
  if (h > 23 || mi > 59 || sec > 60) return false;
  const offset = m[8];
  if (offset.length > 1) {
    const [oh, om] = [+offset.slice(1, 3), +offset.slice(4, 6)];
    if (oh > 23 || om > 59) return false;
  }
  return true;
}
var isNonEmptyStr = (v) => typeof v === "string" && v.length > 0;
function hasExactKeys2(o, keys) {
  if (Object.getOwnPropertySymbols(o).length > 0) return false;
  const own = Object.getOwnPropertyNames(o);
  if (own.length !== keys.length) return false;
  for (const k of keys) if (!own.includes(k)) return false;
  return true;
}
function readDataArray(v, maxItems) {
  if (!Array.isArray(v)) return null;
  if (import_util2.types.isProxy(v)) return null;
  if (Object.getOwnPropertySymbols(v).length > 0) return null;
  if (Object.getPrototypeOf(v) !== Array.prototype) return null;
  const lenDesc = Object.getOwnPropertyDescriptor(v, "length");
  if (!lenDesc || !("value" in lenDesc) || typeof lenDesc.value !== "number" || !Number.isInteger(lenDesc.value) || lenDesc.value < 0) {
    return null;
  }
  if (maxItems !== void 0 && lenDesc.value > maxItems) return null;
  for (const k of Object.getOwnPropertyNames(v)) {
    if (k === "length") continue;
    const n = Number(k);
    if (!Number.isInteger(n) || n < 0 || String(n) !== k) return null;
    if (n >= lenDesc.value) return null;
  }
  const out = [];
  for (let i = 0; i < lenDesc.value; i++) {
    const desc = Object.getOwnPropertyDescriptor(v, i);
    if (!desc || !("value" in desc)) return null;
    out.push(desc.value);
  }
  return out;
}
function readStrArray(v, opts) {
  const raw = readDataArray(v, opts.maxItems);
  if (raw === null) return null;
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  for (const entry of raw) {
    if (opts.idKind === "slug") {
      if (!isBoundedSlug(entry)) return null;
    } else if (opts.idKind === "namespaced") {
      if (!isBoundedNamespacedId(entry)) return null;
    } else if (!isBoundedText(entry, opts.maxLen)) {
      return null;
    }
    if (opts.unique) {
      if (seen.has(entry)) return null;
      seen.add(entry);
    }
    out.push(entry);
  }
  return out;
}
var TREE_HASH_RE = /^[0-9a-f]{64}$/;
var PREFIXED_HASH_RE = /^sha256:[0-9a-f]{64}$/;
function isFeedstockHash(v) {
  return typeof v === "string" && (TREE_HASH_RE.test(v) || PREFIXED_HASH_RE.test(v));
}
function isTreeHash(v) {
  return typeof v === "string" && TREE_HASH_RE.test(v);
}
function parseEvidenceRef(v) {
  if (!isNonEmptyStr(v)) return null;
  if (v.length > MAX_REF_LEN) return null;
  if (CONTROL_CHARS.test(v)) return null;
  const colon = v.indexOf(":");
  if (colon <= 0) return null;
  const source = v.slice(0, colon);
  if (!EVIDENCE_SOURCE_SET.has(source)) return null;
  let rest = v.slice(colon + 1);
  if (rest.length === 0) return null;
  let anchor = null;
  const hash = rest.lastIndexOf("#");
  if (hash !== -1) {
    anchor = rest.slice(hash + 1);
    rest = rest.slice(0, hash);
    if (anchor.length === 0) return null;
  }
  if (rest.length === 0 || rest.length > MAX_LOCATOR_LEN) return null;
  if (anchor !== null && anchor.length > MAX_ANCHOR_LEN) return null;
  if (!isCanonicalLocator(rest)) return null;
  return { source, locator: rest, anchor };
}
function isCanonicalLocator(v) {
  if (typeof v !== "string" || v.length === 0) return false;
  if (v.includes("\\")) return false;
  for (const seg of v.split("/")) {
    if (seg.length === 0) return false;
    if (seg === ".") return false;
    if (seg === "..") return false;
  }
  return true;
}
function readEvidenceRefArray(v, opts = {}) {
  const raw = readStrArray(v, { unique: true, maxItems: MAX_EVIDENCE_REFS, maxLen: MAX_REF_LEN });
  if (raw === null) return null;
  for (const entry of raw) {
    const parsed = parseEvidenceRef(entry);
    if (parsed === null) return null;
    if (opts.historicalOnly && !HISTORICAL_SOURCE_SET.has(parsed.source)) return null;
  }
  return raw;
}
var MUTATION_EVIDENCE_KEYS = [
  "agents_tree_hash_before",
  "agents_tree_hash_after",
  "skills_tree_hash_before",
  "skills_tree_hash_after",
  "registry_hash_before",
  "registry_hash_after"
];
function validateMutationEvidenceInner(obj) {
  if (!isPlainDataObject2(obj)) return null;
  if (!hasExactKeys2(obj, MUTATION_EVIDENCE_KEYS)) return null;
  const values = {};
  for (const key of MUTATION_EVIDENCE_KEYS) {
    const prop = ownDataProp2(obj, key);
    if (prop.kind !== "data") return null;
    if (!isTreeHash(prop.value)) return null;
    values[key] = prop.value;
  }
  if (values.agents_tree_hash_before !== values.agents_tree_hash_after) return null;
  if (values.skills_tree_hash_before !== values.skills_tree_hash_after) return null;
  if (values.registry_hash_before !== values.registry_hash_after) return null;
  return {
    agents_tree_hash_before: values.agents_tree_hash_before,
    agents_tree_hash_after: values.agents_tree_hash_after,
    skills_tree_hash_before: values.skills_tree_hash_before,
    skills_tree_hash_after: values.skills_tree_hash_after,
    registry_hash_before: values.registry_hash_before,
    registry_hash_after: values.registry_hash_after
  };
}
var FEEDSTOCK_KEYS = [
  "codebase_map_hash",
  "knowledge_graph_hash",
  "roster_hash",
  "absent"
];
function validateFeedstockInner(obj) {
  if (!isPlainDataObject2(obj)) return null;
  if (!hasExactKeys2(obj, FEEDSTOCK_KEYS)) return null;
  const cm = ownDataProp2(obj, "codebase_map_hash");
  const kg = ownDataProp2(obj, "knowledge_graph_hash");
  const roster = ownDataProp2(obj, "roster_hash");
  const absentProp = ownDataProp2(obj, "absent");
  if (cm.kind !== "data" || kg.kind !== "data") return null;
  if (roster.kind !== "data" || absentProp.kind !== "data") return null;
  if (cm.value !== null && !isFeedstockHash(cm.value)) return null;
  if (kg.value !== null && !isFeedstockHash(kg.value)) return null;
  if (roster.value !== null && !isFeedstockHash(roster.value)) return null;
  const absent = readStrArray(absentProp.value, {
    unique: true,
    maxItems: MAX_ABSENT,
    maxLen: MAX_ID_LEN,
    idKind: "slug"
  });
  if (absent === null) return null;
  const declared = [
    ["codebase_map", cm.value],
    ["knowledge_graph", kg.value],
    ["roster", roster.value]
  ];
  const names = new Set(declared.map(([n]) => n));
  for (const name of absent) if (!names.has(name)) return null;
  const absentSet = new Set(absent);
  for (const [name, hash] of declared) {
    if (hash === null !== absentSet.has(name)) return null;
  }
  return {
    codebase_map_hash: cm.value,
    knowledge_graph_hash: kg.value,
    roster_hash: roster.value,
    absent
  };
}
var DOMAIN_KEYS = ["id", "label", "evidence_refs", "confidence"];
var BOUNDARY_KEYS = ["id", "label", "rationale", "evidence_refs", "confidence"];
var METHOD_KEYS = ["id", "label", "occurrence_count", "evidence_refs", "confidence"];
function validateDomainFactInner(obj) {
  if (!isPlainDataObject2(obj)) return null;
  if (!hasExactKeys2(obj, DOMAIN_KEYS)) return null;
  const id = ownDataProp2(obj, "id");
  const label = ownDataProp2(obj, "label");
  const refs = ownDataProp2(obj, "evidence_refs");
  const conf = ownDataProp2(obj, "confidence");
  if (id.kind !== "data" || label.kind !== "data") return null;
  if (refs.kind !== "data" || conf.kind !== "data") return null;
  if (!isBoundedNamespacedId(id.value) || !isBoundedText(label.value, MAX_LABEL_LEN)) return null;
  if (typeof conf.value !== "string" || !CONFIDENCE_SET.has(conf.value)) return null;
  const evidence2 = readEvidenceRefArray(refs.value);
  if (evidence2 === null || evidence2.length === 0) return null;
  return {
    id: id.value,
    label: label.value,
    evidence_refs: evidence2,
    confidence: conf.value
  };
}
function validateBoundaryFactInner(obj) {
  if (!isPlainDataObject2(obj)) return null;
  if (!hasExactKeys2(obj, BOUNDARY_KEYS)) return null;
  const id = ownDataProp2(obj, "id");
  const label = ownDataProp2(obj, "label");
  const rationale = ownDataProp2(obj, "rationale");
  const refs = ownDataProp2(obj, "evidence_refs");
  const conf = ownDataProp2(obj, "confidence");
  if (id.kind !== "data" || label.kind !== "data" || rationale.kind !== "data") return null;
  if (refs.kind !== "data" || conf.kind !== "data") return null;
  if (!isBoundedNamespacedId(id.value) || !isBoundedText(label.value, MAX_LABEL_LEN)) return null;
  if (!isBoundedText(rationale.value, MAX_PROSE_LEN)) return null;
  if (typeof conf.value !== "string" || !CONFIDENCE_SET.has(conf.value)) return null;
  const evidence2 = readEvidenceRefArray(refs.value);
  if (evidence2 === null || evidence2.length === 0) return null;
  return {
    id: id.value,
    label: label.value,
    rationale: rationale.value,
    evidence_refs: evidence2,
    confidence: conf.value
  };
}
function validateMethodFactInner(obj) {
  if (!isPlainDataObject2(obj)) return null;
  if (!hasExactKeys2(obj, METHOD_KEYS)) return null;
  const id = ownDataProp2(obj, "id");
  const label = ownDataProp2(obj, "label");
  const count = ownDataProp2(obj, "occurrence_count");
  const refs = ownDataProp2(obj, "evidence_refs");
  const conf = ownDataProp2(obj, "confidence");
  if (id.kind !== "data" || label.kind !== "data" || count.kind !== "data") return null;
  if (refs.kind !== "data" || conf.kind !== "data") return null;
  if (!isBoundedNamespacedId(id.value) || !isBoundedText(label.value, MAX_LABEL_LEN)) return null;
  if (typeof count.value !== "number" || !Number.isInteger(count.value) || count.value < 1) {
    return null;
  }
  if (count.value > MAX_EVIDENCE_REFS) return null;
  if (typeof conf.value !== "string" || !CONFIDENCE_SET.has(conf.value)) return null;
  const evidence2 = readEvidenceRefArray(refs.value, { historicalOnly: true });
  if (evidence2 === null) return null;
  if (evidence2.length !== count.value) return null;
  return {
    id: id.value,
    label: label.value,
    occurrence_count: count.value,
    evidence_refs: evidence2,
    confidence: conf.value
  };
}
var COVERED_ENTRY_KEYS = ["fact_id", "covered_by"];
function validateCoveredEntryInner(obj) {
  if (!isPlainDataObject2(obj)) return null;
  if (!hasExactKeys2(obj, COVERED_ENTRY_KEYS)) return null;
  const factId = ownDataProp2(obj, "fact_id");
  const coveredBy = ownDataProp2(obj, "covered_by");
  if (factId.kind !== "data" || coveredBy.kind !== "data") return null;
  if (!isBoundedNamespacedId(factId.value)) return null;
  const ref = validateProjectDefinitionRefV1(coveredBy.value);
  if (ref === null) return null;
  return { fact_id: factId.value, covered_by: ref };
}
var COVERAGE_KEYS = ["covered", "uncovered", "unmatched_roles"];
function validateCoverageInner(obj) {
  if (!isPlainDataObject2(obj)) return null;
  if (!hasExactKeys2(obj, COVERAGE_KEYS)) return null;
  const coveredProp = ownDataProp2(obj, "covered");
  const uncoveredProp = ownDataProp2(obj, "uncovered");
  const unmatchedProp = ownDataProp2(obj, "unmatched_roles");
  if (coveredProp.kind !== "data") return null;
  if (uncoveredProp.kind !== "data" || unmatchedProp.kind !== "data") return null;
  const rawCovered = readDataArray(coveredProp.value, MAX_COVERAGE_ENTRIES);
  if (rawCovered === null) return null;
  const covered = [];
  const seenFacts = /* @__PURE__ */ new Set();
  for (const entry of rawCovered) {
    const parsed = validateCoveredEntryInner(entry);
    if (parsed === null) return null;
    if (seenFacts.has(parsed.fact_id)) return null;
    seenFacts.add(parsed.fact_id);
    covered.push(parsed);
  }
  const uncovered = readStrArray(uncoveredProp.value, {
    unique: true,
    maxItems: MAX_COVERAGE_ENTRIES,
    maxLen: MAX_ID_LEN,
    idKind: "namespaced"
    // fact ids
  });
  if (uncovered === null) return null;
  const unmatchedRoles = readStrArray(unmatchedProp.value, {
    unique: true,
    maxItems: MAX_COVERAGE_ENTRIES,
    maxLen: MAX_ID_LEN,
    idKind: "slug"
    // role names become files
  });
  if (unmatchedRoles === null) return null;
  for (const factId of uncovered) if (seenFacts.has(factId)) return null;
  return { covered, uncovered, unmatched_roles: unmatchedRoles };
}
var CANDIDATE_KEYS = [
  "id",
  "kind",
  "proposed_id",
  "justified_by",
  "action",
  "defer_reason",
  "confidence",
  "owning_layer"
];
function validateCandidateInner(obj) {
  if (!isPlainDataObject2(obj)) return null;
  if (!hasExactKeys2(obj, CANDIDATE_KEYS)) return null;
  const id = ownDataProp2(obj, "id");
  const kind = ownDataProp2(obj, "kind");
  const proposedId = ownDataProp2(obj, "proposed_id");
  const justifiedBy = ownDataProp2(obj, "justified_by");
  const action = ownDataProp2(obj, "action");
  const deferReason = ownDataProp2(obj, "defer_reason");
  const conf = ownDataProp2(obj, "confidence");
  const owningLayer = ownDataProp2(obj, "owning_layer");
  if (id.kind !== "data" || kind.kind !== "data" || proposedId.kind !== "data") return null;
  if (justifiedBy.kind !== "data" || action.kind !== "data") return null;
  if (deferReason.kind !== "data" || conf.kind !== "data" || owningLayer.kind !== "data") {
    return null;
  }
  if (!isBoundedNamespacedId(id.value) || !isBoundedSlug(proposedId.value)) return null;
  if (!isBoundedSlug(owningLayer.value)) return null;
  if (typeof kind.value !== "string" || !CANDIDATE_KIND_SET.has(kind.value)) return null;
  if (typeof action.value !== "string" || !CANDIDATE_ACTION_SET.has(action.value)) return null;
  if (typeof conf.value !== "string" || !CONFIDENCE_SET.has(conf.value)) return null;
  const actionValue = action.value;
  const confidence = conf.value;
  const justified = readStrArray(justifiedBy.value, {
    unique: true,
    maxItems: MAX_JUSTIFIED_BY,
    maxLen: MAX_ID_LEN,
    idKind: "namespaced"
    // cites fact ids
  });
  if (justified === null || justified.length === 0) return null;
  if (confidence === "low" && actionValue === "propose") return null;
  if (actionValue === "propose") {
    if (deferReason.value !== null) return null;
  } else {
    if (!isBoundedText(deferReason.value, MAX_PROSE_LEN)) return null;
  }
  return {
    id: id.value,
    kind: kind.value,
    proposed_id: proposedId.value,
    justified_by: justified,
    action: actionValue,
    defer_reason: actionValue === "propose" ? null : deferReason.value,
    confidence,
    owning_layer: owningLayer.value
  };
}
var PROFILE_KEYS = [
  "schema_version",
  "project_id",
  "run_id",
  "generated_at",
  "source_commit",
  "feedstock",
  "domains",
  "boundaries",
  "repeated_methods",
  "coverage",
  "candidates",
  "resolver_mode",
  "mutation_performed",
  "mutation_evidence",
  "mutation_window"
];
var PROFILE_OPTS_KEYS = ["suggestionBudget"];
function resolveSuggestionBudget(opts) {
  if (opts === void 0) return DEFAULT_SUGGESTION_BUDGET;
  if (!isPlainDataObject2(opts)) return null;
  if (Object.getOwnPropertySymbols(opts).length > 0) return null;
  if (Object.getOwnPropertyNames(opts).some((k) => !PROFILE_OPTS_KEYS.includes(k))) {
    return null;
  }
  const prop = ownDataProp2(opts, "suggestionBudget");
  if (prop.kind === "accessor") return null;
  if (prop.kind === "absent") return DEFAULT_SUGGESTION_BUDGET;
  if (prop.value === void 0) return DEFAULT_SUGGESTION_BUDGET;
  if (typeof prop.value !== "number") return null;
  if (!Number.isInteger(prop.value) || prop.value < 0) return null;
  return prop.value;
}
function validateProjectCapabilityProfileV1Inner(obj, opts) {
  const budget = resolveSuggestionBudget(opts);
  if (budget === null) return null;
  if (!isPlainDataObject2(obj)) return null;
  if (!hasExactKeys2(obj, PROFILE_KEYS)) return null;
  const schema = ownDataProp2(obj, "schema_version");
  if (schema.kind !== "data" || schema.value !== PROJECT_CAPABILITY_PROFILE_SCHEMA) return null;
  const projectId = ownDataProp2(obj, "project_id");
  const runId = ownDataProp2(obj, "run_id");
  const generatedAt = ownDataProp2(obj, "generated_at");
  const sourceCommit = ownDataProp2(obj, "source_commit");
  const feedstockProp = ownDataProp2(obj, "feedstock");
  const domainsProp = ownDataProp2(obj, "domains");
  const boundariesProp = ownDataProp2(obj, "boundaries");
  const methodsProp = ownDataProp2(obj, "repeated_methods");
  const coverageProp = ownDataProp2(obj, "coverage");
  const candidatesProp = ownDataProp2(obj, "candidates");
  const resolverModeProp = ownDataProp2(obj, "resolver_mode");
  const mutationPerformedProp = ownDataProp2(obj, "mutation_performed");
  const mutationEvidenceProp = ownDataProp2(obj, "mutation_evidence");
  const mutationWindowProp = ownDataProp2(obj, "mutation_window");
  if (projectId.kind !== "data" || runId.kind !== "data") return null;
  if (generatedAt.kind !== "data" || sourceCommit.kind !== "data") return null;
  if (feedstockProp.kind !== "data" || domainsProp.kind !== "data") return null;
  if (boundariesProp.kind !== "data" || methodsProp.kind !== "data") return null;
  if (coverageProp.kind !== "data" || candidatesProp.kind !== "data") return null;
  if (resolverModeProp.kind !== "data") return null;
  if (mutationPerformedProp.kind !== "data" || mutationEvidenceProp.kind !== "data") return null;
  if (mutationWindowProp.kind !== "data") return null;
  if (typeof mutationWindowProp.value !== "string" || !MUTATION_WINDOW_SET.has(mutationWindowProp.value)) {
    return null;
  }
  if (!isBoundedSlug(projectId.value)) return null;
  if (!isBoundedSlug(runId.value)) return null;
  if (!isRfc3339(generatedAt.value)) return null;
  if (sourceCommit.value !== null) {
    if (typeof sourceCommit.value !== "string") return null;
    if (!COMMITISH_RE.test(sourceCommit.value)) return null;
  }
  if (typeof resolverModeProp.value !== "string" || !RESOLVER_MODE_SET.has(resolverModeProp.value)) {
    return null;
  }
  if (mutationPerformedProp.value !== false) return null;
  const feedstock = validateFeedstockInner(feedstockProp.value);
  if (feedstock === null) return null;
  const mutationEvidence = validateMutationEvidenceInner(mutationEvidenceProp.value);
  if (mutationEvidence === null) return null;
  const rawDomains = readDataArray(domainsProp.value, MAX_FACTS);
  if (rawDomains === null) return null;
  const domains = [];
  const domainIds = /* @__PURE__ */ new Set();
  for (const entry of rawDomains) {
    const parsed = validateDomainFactInner(entry);
    if (parsed === null) return null;
    if (domainIds.has(parsed.id)) return null;
    domainIds.add(parsed.id);
    domains.push(parsed);
  }
  const rawBoundaries = readDataArray(boundariesProp.value, MAX_FACTS);
  if (rawBoundaries === null) return null;
  const boundaries = [];
  const boundaryIds = /* @__PURE__ */ new Set();
  for (const entry of rawBoundaries) {
    const parsed = validateBoundaryFactInner(entry);
    if (parsed === null) return null;
    if (boundaryIds.has(parsed.id)) return null;
    boundaryIds.add(parsed.id);
    boundaries.push(parsed);
  }
  const rawMethods = readDataArray(methodsProp.value, MAX_FACTS);
  if (rawMethods === null) return null;
  const repeatedMethods = [];
  const methodIds = /* @__PURE__ */ new Set();
  for (const entry of rawMethods) {
    const parsed = validateMethodFactInner(entry);
    if (parsed === null) return null;
    if (methodIds.has(parsed.id)) return null;
    methodIds.add(parsed.id);
    repeatedMethods.push(parsed);
  }
  const coverage = validateCoverageInner(coverageProp.value);
  if (coverage === null) return null;
  const rawCandidates = readDataArray(candidatesProp.value, budget);
  if (rawCandidates === null) return null;
  if (rawCandidates.length > budget) return null;
  const candidates = [];
  const candidateIds = /* @__PURE__ */ new Set();
  for (const entry of rawCandidates) {
    const parsed = validateCandidateInner(entry);
    if (parsed === null) return null;
    if (candidateIds.has(parsed.id)) return null;
    candidateIds.add(parsed.id);
    candidates.push(parsed);
  }
  const knownFactIds = /* @__PURE__ */ new Set([...domainIds, ...boundaryIds, ...methodIds]);
  for (const candidate of candidates) {
    for (const factId of candidate.justified_by) {
      if (!knownFactIds.has(factId)) return null;
    }
  }
  for (const entry of coverage.covered) {
    if (!knownFactIds.has(entry.fact_id)) return null;
  }
  for (const factId of coverage.uncovered) {
    if (!knownFactIds.has(factId)) return null;
  }
  const result = {
    schema_version: PROJECT_CAPABILITY_PROFILE_SCHEMA,
    project_id: projectId.value,
    run_id: runId.value,
    generated_at: generatedAt.value,
    source_commit: sourceCommit.value,
    feedstock,
    domains,
    boundaries,
    repeated_methods: repeatedMethods,
    coverage,
    candidates,
    resolver_mode: resolverModeProp.value,
    mutation_performed: false,
    mutation_evidence: mutationEvidence,
    mutation_window: mutationWindowProp.value
  };
  if (measuredBytes(result) > MAX_PROFILE_BYTES) return null;
  return result;
}
function validateProjectCapabilityProfileV1(obj, opts = {}) {
  try {
    return validateProjectCapabilityProfileV1Inner(obj, opts);
  } catch {
    return null;
  }
}

// scripts/lib/capability/candidate-surface.ts
var RUNS_DIR = ".guild/runs";
var PROFILE_LEAF = path.join("capability", "profile.json");
var RUN_DIR_RE = /^run-([0-9]{8})-([0-9]{6})-[a-z0-9][a-z0-9._-]*$/;
function isRealRunDir(name) {
  const m = RUN_DIR_RE.exec(name);
  if (m === null) return false;
  const [y, mo, d] = [+m[1].slice(0, 4), +m[1].slice(4, 6), +m[1].slice(6, 8)];
  const [h, mi, sec] = [+m[2].slice(0, 2), +m[2].slice(2, 4), +m[2].slice(4, 6)];
  if (y < 2e3 || y > 2999 || mo < 1 || mo > 12 || d < 1 || d > 31) return false;
  if (h > 23 || mi > 59 || sec > 60) return false;
  return true;
}
var PROFILE_MAX_BYTES = 256 * 1024;
var RENDER_FIELD_MAX_LEN = 120;
var CANDIDATE_SCAN_LIMIT = 50;
var EMPTY_REASONS = Object.freeze([
  "no_runs_directory",
  "no_profile_found",
  "profile_invalid",
  "profile_too_large",
  "invalid_options",
  "profile_has_no_candidates",
  "all_candidates_satisfied"
]);
function safeReadDir(abs) {
  try {
    return fs.readdirSync(abs, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}
function readLiveRosterIds(projectRoot) {
  const agents = /* @__PURE__ */ new Set();
  const skills = /* @__PURE__ */ new Set();
  try {
    for (const e of fs.readdirSync(path.join(projectRoot, ".guild/agents"), {
      withFileTypes: true
    })) {
      if (e.isFile() && e.name.endsWith(".md")) agents.add(e.name.slice(0, -3));
    }
  } catch {
  }
  for (const name of safeReadDir(path.join(projectRoot, ".guild/skills"))) {
    if (fs.existsSync(path.join(projectRoot, ".guild/skills", name, "SKILL.md"))) skills.add(name);
  }
  return { agents, skills };
}
function listProfileRunIds(projectRoot) {
  const dirs = safeReadDir(path.join(projectRoot, RUNS_DIR)).filter(isRealRunDir).sort().reverse();
  const out = [];
  for (const d of dirs) {
    if (out.length >= CANDIDATE_SCAN_LIMIT) break;
    if (fs.existsSync(path.join(projectRoot, RUNS_DIR, d, PROFILE_LEAF))) out.push(d);
  }
  return out;
}
function resolveSurfaceBudget(opts) {
  if (opts === void 0) return DEFAULT_SUGGESTION_BUDGET;
  if (opts === null || typeof opts !== "object" || Array.isArray(opts)) return null;
  if (import_util3.types.isProxy(opts)) return null;
  const proto = Object.getPrototypeOf(opts);
  if (proto !== Object.prototype && proto !== null) return null;
  if (Object.getOwnPropertySymbols(opts).length > 0) return null;
  for (const k of Object.getOwnPropertyNames(opts)) {
    if (k !== "suggestionBudget") return null;
  }
  const d = Object.getOwnPropertyDescriptor(opts, "suggestionBudget");
  if (!d) return DEFAULT_SUGGESTION_BUDGET;
  if (!("value" in d)) return null;
  if (d.value === void 0) return DEFAULT_SUGGESTION_BUDGET;
  if (typeof d.value !== "number" || !Number.isInteger(d.value) || d.value < 0) return null;
  return d.value;
}
function surfaceCapabilityCandidates(projectRoot, opts = {}) {
  const empty = (empty_reason, source_run_id = null) => ({
    source_run_id,
    pending: [],
    satisfied: [],
    empty_reason
  });
  try {
    const budget = resolveSurfaceBudget(opts);
    if (budget === null) return empty("invalid_options");
    if (!fs.existsSync(path.join(projectRoot, RUNS_DIR))) return empty("no_runs_directory");
    const runIds = listProfileRunIds(projectRoot);
    if (runIds.length === 0) return empty("no_profile_found");
    const runId = runIds[0];
    const profileAbs = path.join(projectRoot, RUNS_DIR, runId, PROFILE_LEAF);
    let bytes;
    try {
      bytes = fs.statSync(profileAbs).size;
    } catch {
      return empty("no_profile_found");
    }
    if (bytes > PROFILE_MAX_BYTES) return empty("profile_too_large", runId);
    let profile = null;
    try {
      const raw = JSON.parse(fs.readFileSync(profileAbs, "utf8"));
      profile = validateProjectCapabilityProfileV1(raw, { suggestionBudget: budget });
    } catch {
      profile = null;
    }
    if (profile === null) return empty("profile_invalid", runId);
    if (profile.candidates.length === 0) return empty("profile_has_no_candidates", runId);
    const roster = readLiveRosterIds(projectRoot);
    const pending = [];
    const satisfied = [];
    for (const candidate of profile.candidates) {
      const have = candidate.kind === "agent" ? roster.agents.has(candidate.proposed_id) : roster.skills.has(candidate.proposed_id);
      (have ? satisfied : pending).push({ run_id: runId, candidate });
    }
    if (pending.length === 0) {
      return { source_run_id: runId, pending, satisfied, empty_reason: "all_candidates_satisfied" };
    }
    return { source_run_id: runId, pending, satisfied, empty_reason: null };
  } catch {
    return empty("no_profile_found");
  }
}
var EMPTY_TEXT = Object.freeze({
  no_runs_directory: "no runs yet \u2014 capability profiling has not run",
  no_profile_found: "no capability profile emitted yet (run /guild:learn)",
  profile_invalid: "the newest capability profile FAILED validation \u2014 treat it as absent",
  profile_too_large: "the newest capability profile exceeds the size bound \u2014 not read",
  invalid_options: "the surfacing options were malformed \u2014 nothing was read",
  profile_has_no_candidates: "profiled, no candidates proposed",
  all_candidates_satisfied: "all proposed candidates already exist in the roster"
});
var RENDERABLE_ID = /^[A-Za-z0-9 ._,:/@+#=?!'\-]*$/;
var LINE_BREAKING = /[\u0000-\u001f\u007f-\u009f\u061c\u200b-\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/;
function renderId(value, field) {
  if (value.length > RENDER_FIELD_MAX_LEN) return `<${field}: over ${RENDER_FIELD_MAX_LEN} chars>`;
  if (!RENDERABLE_ID.test(value)) return `<${field}: unrenderable characters>`;
  return value;
}
function renderProse(value, field) {
  if (LINE_BREAKING.test(value)) return `<${field}: unrenderable characters>`;
  if (value.length > RENDER_FIELD_MAX_LEN) {
    return `${value.slice(0, RENDER_FIELD_MAX_LEN)}\u2026 (truncated)`;
  }
  return value;
}
function renderCandidateSection(surface) {
  const lines = ["Capability candidates (report-only \u2014 nothing is created without approval):"];
  if (surface.empty_reason !== null) {
    lines.push(`  ${EMPTY_TEXT[surface.empty_reason]}`);
    if (surface.satisfied.length > 0) {
      lines.push(`  (${surface.satisfied.length} already in the roster)`);
    }
    return lines.join("\n");
  }
  lines.push(`  from run ${surface.source_run_id ?? "(unknown)"}`);
  for (const { candidate } of surface.pending) {
    const why = candidate.defer_reason === null ? "" : ` \u2014 ${renderProse(candidate.defer_reason, "defer_reason")}`;
    lines.push(
      `  \u2022 [${candidate.action}] ${candidate.kind} "${renderId(candidate.proposed_id, "proposed_id")}" (confidence ${candidate.confidence}, owner ${renderId(candidate.owning_layer, "owning_layer")})${why}`
    );
  }
  if (surface.satisfied.length > 0) {
    lines.push(`  (${surface.satisfied.length} already in the roster)`);
  }
  lines.push("  Review with /guild:learn, or approve one via /guild:plan \u2014 never automatic.");
  return lines.join("\n");
}

// scripts/lib/state/ensure-storage-layout.ts
var fs3 = __toESM(require("node:fs"));
var path3 = __toESM(require("node:path"));

// src/modules/state/workflows/guild-root.ts
var fs2 = __toESM(require("node:fs"));
var path2 = __toESM(require("node:path"));
function resolveGuildRoot(startDir) {
  const resolvedStart = path2.resolve(startDir);
  let current = resolvedStart;
  let nearestGuildDir = null;
  for (; ; ) {
    if (fs2.existsSync(path2.join(current, ".git"))) return current;
    if (nearestGuildDir === null) {
      const guildDir = path2.join(current, ".guild");
      try {
        if (fs2.existsSync(guildDir) && fs2.statSync(guildDir).isDirectory()) nearestGuildDir = current;
      } catch {
      }
    }
    const parent = path2.dirname(current);
    if (parent === current) return nearestGuildDir ?? resolvedStart;
    current = parent;
  }
}

// scripts/lib/state/ensure-storage-layout.ts
var CURRENT_LAYOUT_VERSION = 2;
function markerPath(root) {
  return path3.join(root, ".guild", "storage-layout.json");
}
function detect(cwd = process.cwd()) {
  const root = resolveGuildRoot(cwd);
  const marker = markerPath(root);
  if (!fs3.existsSync(path3.join(root, ".guild"))) {
    return { state: "absent", version: null, root, marker };
  }
  let version = null;
  try {
    const parsed = JSON.parse(fs3.readFileSync(marker, "utf8"));
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
      path3.join(__dirname, "upgrade-chain.js"),
      path3.join(__dirname, "lib", "state", "upgrade-chain"),
      path3.join(__dirname, "upgrade-chain")
    ];
    const spec = candidates.find((c) => fs3.existsSync(c) || fs3.existsSync(`${c}.ts`)) ?? candidates[2];
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

// src/modules/state/workflows/storage-layout.ts
var fs7 = __toESM(require("node:fs"));
var path9 = __toESM(require("node:path"));

// src/modules/state/workflows/guild-discovery.ts
var fs4 = __toESM(require("node:fs"));
var path4 = __toESM(require("node:path"));
function readJson(file) {
  try {
    return JSON.parse(fs4.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}
function resolveRepoRootPreferGit(startCwd) {
  let current = path4.resolve(startCwd);
  let firstGuildRoot = null;
  for (; ; ) {
    if (fs4.existsSync(path4.join(current, ".git"))) return current;
    const guildDir = path4.join(current, ".guild");
    if (firstGuildRoot === null && fs4.existsSync(guildDir)) {
      try {
        if (fs4.statSync(guildDir).isDirectory()) firstGuildRoot = current;
      } catch {
      }
    }
    const parent = path4.dirname(current);
    if (parent === current) return firstGuildRoot ?? resolveGuildRoot(startCwd);
    current = parent;
  }
}
function readWorkspaceMode(root) {
  const raw = readJson(path4.join(root, ".guild", "settings.json"));
  if (!raw || typeof raw !== "object") return "auto";
  const workspace = raw["workspace"];
  if (!workspace || typeof workspace !== "object") return "auto";
  const mode = workspace["mode"];
  return mode === "on" || mode === "off" || mode === "auto" ? mode : "auto";
}
function readWorkspaceManifest(root) {
  const raw = readJson(path4.join(root, ".guild", "workspace.json"));
  if (!raw || typeof raw !== "object") return null;
  const obj = raw;
  if (obj["schema_version"] !== "guild.workspace.v1") return null;
  return raw;
}
function immediateMarkedChildren(root) {
  let entries = [];
  try {
    entries = fs4.readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const children = [];
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const childRoot = path4.join(root, ent.name);
    const hasGit = fs4.existsSync(path4.join(childRoot, ".git"));
    const hasGuild = fs4.existsSync(path4.join(childRoot, ".guild"));
    if (!hasGit && !hasGuild) continue;
    children.push({
      name: ent.name,
      path: ent.name,
      kind: hasGuild ? "sub-guild" : "sub-project",
      has_wiki: fs4.existsSync(path4.join(childRoot, ".guild", "wiki")),
      has_indexes: fs4.existsSync(path4.join(childRoot, ".guild", "indexes"))
    });
  }
  return children;
}
function workspaceEntries(root) {
  const manifest = readWorkspaceManifest(root);
  if (manifest?.is_workspace && Array.isArray(manifest.sub_guilds)) {
    return manifest.sub_guilds.filter((sg) => typeof sg.name === "string" && typeof sg.path === "string");
  }
  return immediateMarkedChildren(root);
}
function isRegisteredChildOfParentWorkspace(root) {
  return findParentWorkspace(root) !== null;
}
function isWorkspaceRoot(root) {
  const mode = readWorkspaceMode(root);
  if (mode === "on") return true;
  if (mode === "off") return false;
  const manifest = readWorkspaceManifest(root);
  if (manifest?.is_workspace === true) return true;
  if (isRegisteredChildOfParentWorkspace(root)) return false;
  return immediateMarkedChildren(root).length > 0;
}
function findParentWorkspace(activeRoot) {
  const parent = path4.dirname(activeRoot);
  if (parent === activeRoot) return null;
  const activeResolved = path4.resolve(activeRoot);
  for (const entry of workspaceEntries(parent)) {
    const childRoot = path4.resolve(parent, entry.path);
    if (childRoot === activeResolved) return { root: parent, entry };
  }
  return null;
}
function canonicalMemory(activeRoot) {
  return {
    wiki: path4.join(activeRoot, ".guild", "wiki"),
    raw: path4.join(activeRoot, ".guild", "raw"),
    indexes: path4.join(activeRoot, ".guild", "indexes"),
    indexSqlite: path4.join(activeRoot, ".guild", "index.sqlite")
  };
}
function discoverGuild(startCwd) {
  const activeRoot = resolveRepoRootPreferGit(startCwd);
  const parentWorkspace = findParentWorkspace(activeRoot);
  const level = isWorkspaceRoot(activeRoot) ? "workspace" : "project";
  return {
    startCwd: path4.resolve(startCwd),
    activeRoot,
    guildDir: path4.join(activeRoot, ".guild"),
    level,
    workspaceRoot: level === "workspace" ? activeRoot : parentWorkspace?.root ?? null,
    registeredName: parentWorkspace?.entry.name ?? null,
    federationDepth: level === "workspace" ? 0 : parentWorkspace ? 1 : 0,
    canonicalMemory: canonicalMemory(activeRoot)
  };
}

// src/modules/state/workflows/storage-fs.ts
var fs5 = __toESM(require("node:fs"));
var path5 = __toESM(require("node:path"));
function lstatSafe(p) {
  try {
    return fs5.lstatSync(p);
  } catch {
    return null;
  }
}
function readdirSafe(dir) {
  try {
    return fs5.readdirSync(dir);
  } catch {
    return [];
  }
}
function resolveContainedRealDir(abs, root) {
  const st = lstatSafe(abs);
  if (!st || !st.isDirectory() || st.isSymbolicLink()) return null;
  let real;
  let realRoot;
  try {
    real = fs5.realpathSync(abs);
    realRoot = fs5.realpathSync(root);
  } catch {
    return null;
  }
  const rel = path5.relative(realRoot, real);
  if (rel === "" || rel.startsWith("..") || path5.isAbsolute(rel)) return null;
  return real;
}
function isContainedRealDir(abs, root) {
  return resolveContainedRealDir(abs, root) !== null;
}
function removeContainedTree(abs, root) {
  const real = resolveContainedRealDir(abs, root);
  if (!real) return null;
  fs5.rmSync(real, { recursive: true, force: true });
  return real;
}
function removeContainedEmptyDir(abs, root) {
  const real = resolveContainedRealDir(abs, root);
  if (!real) return false;
  try {
    fs5.rmdirSync(real);
    return true;
  } catch {
    return false;
  }
}

// src/modules/state/workflows/storage-policy.ts
var path7 = __toESM(require("node:path"));

// src/modules/kernel/workflows/module-manifest.ts
var OWNED_INVENTORY_CATEGORIES = Object.freeze([
  "commands",
  "skills",
  "agents",
  "hooks",
  "mcp_servers",
  "scripts"
]);

// src/modules/kernel/workflows/sealed-collections.ts
function regExpWritesLastIndex(re) {
  return re.global || re.sticky;
}
function freezeRegExpSafely(re) {
  if (regExpWritesLastIndex(re)) return false;
  Object.freeze(re);
  return true;
}
var SEALED_BRAND = /* @__PURE__ */ Symbol.for("guild.sealed_collection.v1");
function refuseMutator(label, method) {
  return () => {
    throw new TypeError(
      `${label} is a sealed collection: ${method}() would silently change a closed vocabulary`
    );
  };
}
function sealSet(values, label = "this Set") {
  const inner = new Set(values);
  const facade = {
    [SEALED_BRAND]: "set",
    // A data property, not a getter: `inner` is unreachable from outside these closures,
    // so the size is constant for the life of the value.
    size: inner.size,
    has: (value) => inner.has(value),
    keys: () => inner.keys(),
    values: () => inner.values(),
    entries: () => inner.entries(),
    forEach: (callback, thisArg) => {
      inner.forEach((value, value2) => callback.call(thisArg, value, value2, facade));
    },
    [Symbol.iterator]: () => inner[Symbol.iterator](),
    add: refuseMutator(label, "add"),
    delete: refuseMutator(label, "delete"),
    clear: refuseMutator(label, "clear")
  };
  return Object.freeze(facade);
}
function isSealedCollection(value) {
  if (value === null || typeof value !== "object") return false;
  if (value instanceof Set || value instanceof Map) return false;
  const brand = value[SEALED_BRAND];
  return (brand === "set" || brand === "map") && Object.isFrozen(value);
}
function sealedCollectionValues(value) {
  if (!isSealedCollection(value)) return void 0;
  return [...value];
}
function deepFreeze(value, options = {}) {
  const policy = options.regexps ?? "safe";
  const seen = /* @__PURE__ */ new WeakSet();
  const walk = (node) => {
    if (node === null || typeof node !== "object") return;
    const obj = node;
    if (seen.has(obj)) return;
    seen.add(obj);
    if (obj instanceof RegExp) {
      if (policy === "freeze") Object.freeze(obj);
      else if (policy === "safe") freezeRegExpSafely(obj);
      return;
    }
    if (obj instanceof Date) {
      return;
    }
    if (obj instanceof Set || obj instanceof Map) {
      throw new TypeError(
        "deepFreeze: refusing to 'freeze' a Set/Map \u2014 freeze does not close membership and the intrinsics reach past neutered own methods. Declare it with sealSet()/sealMap()."
      );
    }
    const sealedValues = sealedCollectionValues(obj);
    if (sealedValues !== void 0) {
      for (const entry of sealedValues) walk(entry);
      return;
    }
    Object.freeze(obj);
    for (const key of Reflect.ownKeys(obj)) {
      const descriptor = Object.getOwnPropertyDescriptor(obj, key);
      if (!descriptor || !("value" in descriptor)) continue;
      walk(descriptor.value);
    }
  };
  walk(value);
  return value;
}
function frozenList(items, options = {}) {
  return deepFreeze(items.slice(), options);
}

// src/modules/kernel/workflows/path-containment.ts
var fs6 = __toESM(require("node:fs"));
var path6 = __toESM(require("node:path"));
var CONTAINMENT_REFUSAL_CODES = Object.freeze([
  "root-unresolvable",
  "no-existing-ancestor",
  "dangling-symlink",
  "physical-symlink",
  "outside-root",
  "leaf-not-regular-file",
  "mkdir-failed",
  "parent-traversal",
  "destination-moved"
]);
function isRefused(r) {
  return "code" in r;
}
function escapes(rel) {
  return rel === ".." || rel.startsWith(`..${path6.sep}`) || path6.isAbsolute(rel);
}
function refuse(code, detail) {
  return Object.freeze({ contained: false, code, detail });
}
function hasParentSegment(p) {
  return p.split(/[\\/]/).includes("..");
}
function lstatOrNull(p) {
  try {
    return fs6.lstatSync(p);
  } catch {
    return null;
  }
}
function checkContained(root, target, options = {}) {
  const policy = options.policy ?? "resolve";
  let realRoot;
  try {
    realRoot = fs6.realpathSync(path6.resolve(root));
  } catch {
    return refuse("root-unresolvable", `project root ${root} does not resolve`);
  }
  if (hasParentSegment(target)) {
    return refuse(
      "parent-traversal",
      `refusing a path spelled with a ".." segment (${target}) \u2014 parent traversal cannot be resolved before symlinks`
    );
  }
  const abs = path6.isAbsolute(target) ? path6.resolve(target) : path6.resolve(realRoot, target);
  let probe = abs;
  let probeStat = null;
  for (; ; ) {
    probeStat = lstatOrNull(probe);
    if (probeStat !== null) break;
    const parent = path6.dirname(probe);
    if (parent === probe) {
      return refuse("no-existing-ancestor", `no existing ancestor of ${abs}`);
    }
    probe = parent;
  }
  if (options.requireRegularFileLeaf && probe === abs && !probeStat.isFile()) {
    const what = probeStat.isSymbolicLink() ? "symlink" : probeStat.isDirectory() ? "directory" : "special file";
    return refuse(
      "leaf-not-regular-file",
      `${abs} exists and is not a regular file (${what}); refusing to write through it`
    );
  }
  let realProbe;
  try {
    realProbe = fs6.realpathSync(probe);
  } catch {
    return refuse(
      "dangling-symlink",
      `${probe} is a symlink that does not resolve; refusing to write through it`
    );
  }
  const rel = path6.relative(realRoot, realProbe);
  if (rel !== "" && escapes(rel)) {
    return refuse("outside-root", `${abs} resolves outside the project root (${realProbe})`);
  }
  if (policy === "physical") {
    const parsed = path6.parse(abs);
    let walk = parsed.root;
    for (const seg of abs.slice(parsed.root.length).split(path6.sep)) {
      if (seg === "" || seg === ".") continue;
      walk = path6.join(walk, seg);
      const st = lstatOrNull(walk);
      if (st === null || !st.isSymbolicLink()) continue;
      let segReal;
      try {
        segReal = fs6.realpathSync(walk);
      } catch {
        return refuse("dangling-symlink", `${walk} is a symlink that does not resolve`);
      }
      const segRel = path6.relative(realRoot, segReal);
      const strictlyInside = segRel !== "" && !escapes(segRel);
      if (strictlyInside) {
        return refuse("physical-symlink", `refusing \u2014 symlinked path segment: ${walk}`);
      }
    }
  }
  const tail = path6.relative(probe, abs);
  const realPath = tail === "" ? realProbe : path6.join(realProbe, tail);
  return Object.freeze({ contained: true, realRoot, realPath });
}

// src/modules/kernel/workflows/tier-bus.ts
var BUS_TIERS = frozenList(["T0", "T1", "T2"]);
var LEAD_ROLE_IDS = frozenList(["team-lead", "lead", "orchestrator"]);
var TIER_BUS_CONTRACT = deepFreeze({
  tiers: BUS_TIERS,
  upward_envelopes: { T2: "guild.handoff.v2", T1: "guild.goal_status.v1" },
  lead_roles: LEAD_ROLE_IDS,
  tier_source: "the attempt record on disk, or the run's minted binding_ref \u2014 never the payload"
});

// src/modules/state/workflows/storage-policy.ts
var NON_DURABLE_CLASSES = sealSet(
  ["runtime", "cache", "managed-resource", "temporary"],
  "NON_DURABLE_CLASSES"
);
var DURABLE_CLASSES = sealSet(
  ["canonical", "durable-record"],
  "DURABLE_CLASSES"
);
var KTD16_FROZEN_PREFIXES = deepFreeze([
  "runs",
  "analysis",
  "recommendations"
]);
function isUnderDurable(abs, guildDir) {
  const rel = path7.relative(path7.resolve(guildDir), path7.resolve(abs));
  return rel === "" || !rel.startsWith("..") && !path7.isAbsolute(rel);
}
var StoragePlacementError = class extends Error {
  constructor(storageClass, resolvedPath, detail) {
    super(detail);
    this.storageClass = storageClass;
    this.resolvedPath = resolvedPath;
    this.name = "StoragePlacementError";
  }
  storageClass;
  resolvedPath;
};
function assertClassPlacement(storageClass, absPath, guildDir) {
  const under = isUnderDurable(absPath, guildDir);
  if (NON_DURABLE_CLASSES.has(storageClass)) {
    if (!under) return;
    throw new StoragePlacementError(
      storageClass,
      absPath,
      `guild storage: a '${storageClass}' artifact may not resolve beneath .guild/ (${absPath}). Rebuildable state belongs in the cache/state/temp root (KTD15).`
    );
  }
  if (!under) {
    throw new StoragePlacementError(
      storageClass,
      absPath,
      `guild storage: a '${storageClass}' artifact must resolve beneath .guild/ (${absPath}). Truth is never written outside the repo (KTD15).`
    );
  }
}
function assertSafeSegments(segments) {
  for (const raw of segments) {
    if (typeof raw !== "string" || raw.trim() === "") {
      throw new Error("guild storage: empty path segment");
    }
    if (path7.isAbsolute(raw) || /^[A-Za-z]:/.test(raw) || raw.startsWith("\\\\")) {
      throw new Error(`guild storage: absolute path segment is refused: ${raw}`);
    }
    if (raw.includes("\0")) {
      throw new Error("guild storage: NUL byte in a path segment");
    }
    for (const part of raw.split(/[\\/]/)) {
      if (part === "..") throw new Error(`guild storage: traversal segment is refused: ${raw}`);
      if (part === ".") throw new Error(`guild storage: dot segment is refused: ${raw}`);
    }
  }
}
var DURABLE_SUBTREES = deepFreeze({
  /** Canonical knowledge (KTD35/KTD70). */
  knowledge: "wiki",
  /**
   * The definition tree root is `.guild/` itself: `agents/`, `skills/` and `teams/`
   * already sit there (KTD20).
   */
  definitionsRoot: "",
  /**
   * `definition("sources", id)` — the one logical name that maps elsewhere, onto
   * the durable sources tree that already exists, so R59 does not invent a third home.
   */
  sources: path7.join("knowledge", "sources"),
  initiatives: "initiatives",
  /** KTD16 freeze. */
  runs: "runs",
  artifacts: "artifacts"
});

// src/modules/state/workflows/storage-roots.ts
var crypto = __toESM(require("node:crypto"));
var os = __toESM(require("node:os"));
var path8 = __toESM(require("node:path"));
var OVERRIDE_KEYS = {
  state: "GUILD_STATE_HOME",
  cache: "GUILD_CACHE_HOME",
  worktrees: "GUILD_WORKTREE_HOME",
  temp: "GUILD_TEMP_HOME"
};
var GUILD_NAMESPACE = "guild";
function platformStateRoot(platform, env, home) {
  if (platform === "win32") {
    const local = env.LOCALAPPDATA;
    return local ? path8.join(local, "Guild", "state") : path8.join(home, "AppData", "Local", "Guild", "state");
  }
  if (platform === "darwin") {
    return path8.join(home, "Library", "Application Support", "Guild", "state");
  }
  const xdg = env.XDG_STATE_HOME;
  return xdg ? path8.join(xdg, GUILD_NAMESPACE) : path8.join(home, ".local", "state", GUILD_NAMESPACE);
}
function platformCacheRoot(platform, env, home) {
  if (platform === "win32") {
    const local = env.LOCALAPPDATA;
    return local ? path8.join(local, "Guild", "cache") : path8.join(home, "AppData", "Local", "Guild", "cache");
  }
  if (platform === "darwin") {
    return path8.join(home, "Library", "Caches", "Guild");
  }
  const xdg = env.XDG_CACHE_HOME;
  return xdg ? path8.join(xdg, GUILD_NAMESPACE) : path8.join(home, ".cache", GUILD_NAMESPACE);
}
function guildRootId(activeRoot) {
  const abs = path8.resolve(activeRoot);
  const digest = crypto.createHash("sha256").update(abs).digest("hex").slice(0, 12);
  const base = path8.basename(abs).replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "root";
  return `${base}-${digest}`;
}
function resolveStorageRoots(opts) {
  const env = opts.env ?? process.env;
  const platform = opts.platform ?? process.platform;
  const home = opts.homedir ?? os.homedir();
  const tmp = opts.tmpdir ?? os.tmpdir();
  const activeRoot = path8.resolve(opts.activeRoot);
  const override = (key) => {
    const raw = env[OVERRIDE_KEYS[key]];
    return raw && raw.trim() ? path8.resolve(raw.trim()) : null;
  };
  const state = override("state") ?? platformStateRoot(platform, env, home);
  const cache = override("cache") ?? platformCacheRoot(platform, env, home);
  return {
    durable: path8.join(activeRoot, ".guild"),
    state,
    cache,
    worktrees: override("worktrees") ?? path8.join(cache, "worktrees"),
    temp: override("temp") ?? path8.join(tmp, GUILD_NAMESPACE)
  };
}

// src/modules/state/workflows/storage-layout.ts
var POLICY_CONFIG_FILES = Object.freeze({
  project: "config/project.json",
  workspace: "config/workspace.json"
});
function scopedPaths(guildDir, _scope, configFile) {
  const durable = (cls, ...segments) => {
    const parts = segments.filter((s) => s !== "");
    assertSafeSegments(parts);
    const abs = path9.join(guildDir, ...parts);
    assertClassPlacement(cls, abs, guildDir);
    return abs;
  };
  return {
    config: () => durable("canonical", configFile),
    knowledge: (...segments) => durable("canonical", DURABLE_SUBTREES.knowledge, ...segments),
    definitions: (...segments) => {
      assertSafeSegments(segments);
      const parts = segments.flatMap((seg) => seg.split(/[\\/]+/)).filter((p) => p !== "");
      const [head, ...rest] = parts;
      if (head === "sources") return durable("durable-record", DURABLE_SUBTREES.sources, ...rest);
      return durable("canonical", DURABLE_SUBTREES.definitionsRoot, ...parts);
    },
    initiative: (status, id) => durable("durable-record", DURABLE_SUBTREES.initiatives, status, id),
    runRecord: (runId, ...segments) => durable("durable-record", DURABLE_SUBTREES.runs, runId, ...segments),
    artifact: (...segments) => durable("durable-record", DURABLE_SUBTREES.artifacts, ...segments)
  };
}
function detectProfile(cwd, activeRoot) {
  const d = discoverGuild(cwd);
  if (d.level === "workspace") {
    const own = path9.join(activeRoot, ".guild", DURABLE_SUBTREES.knowledge);
    return fs7.existsSync(own) ? "hybrid" : "workspace-only";
  }
  return d.workspaceRoot ? "child" : "standalone";
}
function createGuildStorage(cwd = process.cwd(), opts = {}) {
  const activeRoot = path9.resolve(opts.activeRoot ?? discoverGuild(cwd).activeRoot);
  const roots = resolveStorageRoots({
    activeRoot,
    platform: opts.platform,
    env: opts.env,
    homedir: opts.homedir,
    tmpdir: opts.tmpdir
  });
  const guildDir = roots.durable;
  const rootId = guildRootId(activeRoot);
  const profile = opts.profile ?? detectProfile(cwd, activeRoot);
  const external = (cls, base, ...segments) => {
    assertSafeSegments(segments);
    const abs = path9.join(base, ...segments);
    assertClassPlacement(cls, abs, guildDir);
    return abs;
  };
  const project = profile === "workspace-only" ? void 0 : scopedPaths(guildDir, "project", POLICY_CONFIG_FILES.project);
  const workspace = profile === "workspace-only" || profile === "hybrid" ? scopedPaths(guildDir, "workspace", POLICY_CONFIG_FILES.workspace) : void 0;
  const activeScope = project ?? workspace;
  const runtimeBase = path9.join(roots.state, "roots", rootId);
  const cacheBase = path9.join(roots.cache, "roots", rootId);
  const tempBase = path9.join(roots.temp, rootId);
  const storage = {
    activeRoot,
    rootId,
    profile,
    root: roots,
    project,
    workspace,
    definition: (...segments) => activeScope.definitions(...segments),
    runtime: (...segments) => external("runtime", runtimeBase, ...segments),
    cache: (...segments) => external("cache", cacheBase, ...segments),
    worktree: (runId, laneId) => {
      assertSafeSegments([runId, laneId]);
      return external("managed-resource", roots.worktrees, rootId, runId, laneId);
    },
    temporary: (runId, ...segments) => {
      if (runId === void 0) return external("temporary", tempBase, "session", ...segments);
      assertSafeSegments([runId]);
      return external("temporary", tempBase, "runs", runId, ...segments);
    },
    ensureDir(absPath) {
      fs7.mkdirSync(absPath, { recursive: true });
      return absPath;
    },
    closeRun(runId) {
      assertSafeSegments([runId]);
      const removed = [];
      const preserved = [];
      for (const [dir, owningRoot] of [
        [storage.temporary(runId), tempBase],
        [external("runtime", runtimeBase, "runs", runId), runtimeBase]
      ]) {
        const gone = removeContainedTree(dir, owningRoot);
        if (gone) removed.push(dir);
      }
      const worktreeRoot = path9.join(roots.worktrees, rootId);
      const runWorktrees = path9.join(worktreeRoot, runId);
      if (isContainedRealDir(runWorktrees, worktreeRoot)) {
        for (const lane of readdirSafe(runWorktrees)) {
          const laneDir = path9.join(runWorktrees, lane);
          if (!isContainedRealDir(laneDir, runWorktrees)) {
            preserved.push({ path: laneDir, reason: "not a real directory Guild owns (symlink or special file)" });
            continue;
          }
          if (readdirSafe(laneDir).length > 0) {
            preserved.push({
              path: laneDir,
              reason: "non-empty managed worktree \u2014 reclaimed by the resource reaper, never by close"
            });
            continue;
          }
          if (removeContainedEmptyDir(laneDir, runWorktrees)) removed.push(laneDir);
          else preserved.push({ path: laneDir, reason: "became non-empty during close" });
        }
        removeContainedEmptyDir(runWorktrees, worktreeRoot);
      }
      return { runId, removed, preserved };
    }
  };
  return storage;
}

// src/modules/state/workflows/upgrade-journal.ts
var fs8 = __toESM(require("node:fs"));
var UPGRADE_JOURNAL_SCHEMA = "guild.upgrade_journal.v1";
function upgradeJournalPath(runtime) {
  return runtime("journal", "upgrade", "layout.json");
}
function loadJournal(file) {
  let text;
  try {
    text = fs8.readFileSync(file, "utf8");
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(text);
    if (parsed?.schema_version !== UPGRADE_JOURNAL_SCHEMA) return null;
    if (!Array.isArray(parsed.entries)) return null;
    return parsed;
  } catch {
    return null;
  }
}
var LOCK_STALE_MS = 15 * 60 * 1e3;

// scripts/lib/capability/profile-emit.ts
var import_crypto = require("crypto");
var fs9 = __toESM(require("fs"));
var path10 = __toESM(require("path"));
var import_util4 = require("util");

// scripts/lib/capability/context-manager-contract.ts
var CONTEXT_MANAGER_TOOLS = Object.freeze([
  "Read",
  "Grep",
  "Glob",
  "Write",
  "Edit"
]);
var CONTEXT_MANAGER_WITHHELD_TOOLS = Object.freeze([
  "Bash",
  // a shell is a universal write primitive — it would void the path allowlist
  "Task",
  // spawning lanes is orchestration; this role assembles, it does not dispatch
  "WebFetch",
  // context comes from the project, not the internet
  "WebSearch"
]);
var CONTEXT_MANAGER_CAPABILITY_SCOPE = Object.freeze([
  "assemble_context_bundle",
  "summarize_for_bundle",
  "resolve_recall_query",
  "record_context_receipt",
  "emit_capability_profile"
]);
var CAPABILITY_SCOPE_SET = new Set(
  CONTEXT_MANAGER_CAPABILITY_SCOPE
);
var CONTEXT_MANAGER_FORBIDDEN_OPERATIONS = Object.freeze([
  "write_agent_definition",
  "write_skill_definition",
  "promote_knowledge",
  "register_capability",
  "approve_candidate",
  "decide_project_question",
  "advance_resolver_mode"
]);
var FORBIDDEN_OPERATION_SET = new Set(
  CONTEXT_MANAGER_FORBIDDEN_OPERATIONS
);
var CONTEXT_MANAGER_WRITE_ROOTS = Object.freeze([
  ".guild/context",
  ".guild/artifacts",
  ".guild/runs"
]);
var CONTEXT_MANAGER_FORBIDDEN_WRITE_ROOTS = Object.freeze([
  ".guild/agents",
  // may NOT write agent definitions
  ".guild/skills",
  // may NOT write skill definitions
  ".guild/wiki",
  // may NOT promote knowledge
  ".guild/knowledge",
  ".guild/memory",
  ".guild/teams",
  ".guild/initiatives",
  ".guild/settings.json",
  ".guild/guild.yaml",
  ".guild/workspace.json"
]);
var CONTEXT_MANAGER_READ_ROOTS = Object.freeze([
  ".guild",
  "docs",
  "src",
  "scripts"
]);
var CONTEXT_MANAGER_PATH_MAX_LEN = 512;
var CONTROL_CHARS2 = /[\u0000-\u001f\u007f]/;
function isCanonicalRelPath(v) {
  if (typeof v !== "string") return false;
  if (v.length === 0 || v.length > CONTEXT_MANAGER_PATH_MAX_LEN) return false;
  if (CONTROL_CHARS2.test(v)) return false;
  if (v.includes("\\")) return false;
  if (v.startsWith("/")) return false;
  if (/^[A-Za-z]:/.test(v)) return false;
  for (const seg of v.split("/")) {
    if (seg.length === 0) return false;
    if (seg === "." || seg === "..") return false;
    const stripped = seg.replace(/[. ]+$/, "");
    if (stripped === "." || stripped === "..") return false;
    if (stripped.length === 0) return false;
  }
  return true;
}
function isUnderRoot(path12, root) {
  if (path12 === root) return true;
  const p = path12.split("/");
  const r = root.split("/");
  if (p.length <= r.length) return false;
  for (let i = 0; i < r.length; i++) if (p[i] !== r[i]) return false;
  return true;
}
var CONTEXT_MANAGER_DENY_REASONS = Object.freeze([
  "malformed_path",
  "forbidden_root",
  "outside_write_roots"
]);
function classifyContextManagerWrite(relPath) {
  try {
    if (!isCanonicalRelPath(relPath)) return { allowed: false, reason: "malformed_path" };
    for (const forbidden of CONTEXT_MANAGER_FORBIDDEN_WRITE_ROOTS) {
      if (isUnderRoot(relPath, forbidden)) return { allowed: false, reason: "forbidden_root" };
    }
    for (const root of CONTEXT_MANAGER_WRITE_ROOTS) {
      if (relPath !== root && isUnderRoot(relPath, root)) return { allowed: true, root };
    }
    return { allowed: false, reason: "outside_write_roots" };
  } catch {
    return { allowed: false, reason: "malformed_path" };
  }
}

// scripts/lib/capability/profile-emit.ts
var TREE_HASH_RECIPE = 'sha256( concat( sorted( "<relpath>\\0" + (file ? sha256(bytes) : kind) + "\\n" ) ) )';
var HASHED_TREES = Object.freeze([
  ".guild/agents",
  ".guild/skills"
]);
var HASHED_REGISTRIES = Object.freeze([
  ".guild/agents/registry.yaml",
  ".guild/skills/registry.yaml"
]);
var TREE_HASH_RE2 = /^[0-9a-f]{64}$/;
var EMPTY_TREE_HASH = (0, import_crypto.createHash)("sha256").update("").digest("hex");
function sha256File(abs) {
  try {
    return (0, import_crypto.createHash)("sha256").update(fs9.readFileSync(abs)).digest("hex");
  } catch {
    return null;
  }
}
var MAX_TREE_DEPTH = 32;
function listTree(absRoot, rel = "", depth = 0) {
  if (depth > MAX_TREE_DEPTH) return null;
  let entries;
  try {
    entries = fs9.readdirSync(absRoot, { withFileTypes: true });
  } catch (e) {
    if (e?.code === "ENOENT") return [];
    return null;
  }
  const out = [];
  for (const e of entries) {
    const childRel = rel ? `${rel}/${e.name}` : e.name;
    if (e.isSymbolicLink()) {
      out.push({ rel: childRel, kind: "symlink" });
    } else if (e.isDirectory()) {
      out.push({ rel: childRel, kind: "dir" });
      const child = listTree(path10.join(absRoot, e.name), childRel, depth + 1);
      if (child === null) return null;
      out.push(...child);
    } else if (e.isFile()) {
      out.push({ rel: childRel, kind: "file" });
    } else {
      out.push({ rel: childRel, kind: "symlink" });
    }
  }
  return out.sort((a, b) => a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0);
}
function hashTree(projectRoot, relRoot) {
  const abs = path10.join(projectRoot, relRoot);
  try {
    const st = fs9.lstatSync(abs);
    if (st.isSymbolicLink()) return null;
    if (!st.isDirectory()) return null;
  } catch (e) {
    if (e?.code !== "ENOENT") return null;
    return EMPTY_TREE_HASH;
  }
  const entries = listTree(abs);
  if (entries === null) return null;
  if (entries.length === 0) return EMPTY_TREE_HASH;
  const h = (0, import_crypto.createHash)("sha256");
  for (const e of entries) {
    if (e.kind !== "file") {
      h.update(`${e.rel}\0${e.kind}
`);
      continue;
    }
    const fileHash = sha256File(path10.join(abs, e.rel));
    if (fileHash === null) return null;
    h.update(`${e.rel}\0${fileHash}
`);
  }
  return h.digest("hex");
}
function hashFileSet(projectRoot, relPaths) {
  const h = (0, import_crypto.createHash)("sha256");
  let any = false;
  for (const rel of [...relPaths].sort()) {
    const abs = path10.join(projectRoot, rel);
    let exists;
    try {
      const st = fs9.lstatSync(abs);
      if (st.isSymbolicLink()) return null;
      exists = st.isFile();
    } catch (e) {
      if (e?.code !== "ENOENT") return null;
      exists = false;
    }
    if (!exists) continue;
    const fileHash = sha256File(abs);
    if (fileHash === null) return null;
    any = true;
    h.update(`${rel}\0${fileHash}
`);
  }
  return any ? h.digest("hex") : EMPTY_TREE_HASH;
}
function baselineBinding(projectRoot) {
  try {
    return (0, import_crypto.createHash)("sha256").update(fs9.realpathSync(projectRoot)).digest("hex");
  } catch {
    return null;
  }
}
function snapshotTreeHashes(projectRoot) {
  const agents = hashTree(projectRoot, HASHED_TREES[0]);
  const skills = hashTree(projectRoot, HASHED_TREES[1]);
  const registries = hashFileSet(projectRoot, HASHED_REGISTRIES);
  if (agents === null || skills === null || registries === null) return null;
  return { agents, skills, registries };
}
function sameHashes(a, b) {
  return a.agents === b.agents && a.skills === b.skills && a.registries === b.registries;
}
var FEEDSTOCK_INPUTS = Object.freeze([
  Object.freeze({ name: "codebase_map", rel: ".guild/indexes/codebase-map.json" }),
  Object.freeze({ name: "knowledge_graph", rel: ".guild/indexes/knowledge-graph.json" }),
  Object.freeze({ name: "roster", rel: ".guild/agents/registry.yaml" })
]);
function snapshotFeedstock(projectRoot) {
  const absent = [];
  const hashes = {};
  for (const input of FEEDSTOCK_INPUTS) {
    const h = sha256File(path10.join(projectRoot, input.rel));
    if (h === null) absent.push(input.name);
    hashes[input.name] = h;
  }
  return {
    codebase_map_hash: hashes.codebase_map ?? null,
    knowledge_graph_hash: hashes.knowledge_graph ?? null,
    roster_hash: hashes.roster ?? null,
    absent
  };
}
function profileRelPath(runId) {
  return `.guild/runs/${runId}/capability/profile.json`;
}
var EMIT_REFUSAL_CODES = Object.freeze([
  "resolver_mode_disabled",
  "invalid_run_id",
  "invalid_project_id",
  "invalid_generated_at",
  "invalid_options",
  "invalid_baseline",
  "hash_incomplete",
  "escapes_project_root",
  "mutation_detected",
  "profile_invalid",
  "write_forbidden",
  "write_failed",
  "post_write_mutation"
]);
var RFC3339_RE2 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/;
var EMIT_OPTION_KEYS = [
  "projectRoot",
  "runId",
  "projectId",
  "generatedAt",
  "sourceCommit",
  "resolverMode",
  "suggestionBudget",
  "facts",
  "baselineHashes"
];
function captureEmitOptions(opts) {
  if (opts === null || typeof opts !== "object" || Array.isArray(opts)) return null;
  if (import_util4.types.isProxy(opts)) return null;
  const proto = Object.getPrototypeOf(opts);
  if (proto !== Object.prototype && proto !== null) return null;
  if (Object.getOwnPropertySymbols(opts).length > 0) return null;
  for (const k of Object.getOwnPropertyNames(opts)) {
    if (!EMIT_OPTION_KEYS.includes(k)) return null;
  }
  const read = (k) => {
    const d = Object.getOwnPropertyDescriptor(opts, k);
    if (!d) return { present: false, value: void 0 };
    if (!("value" in d)) return null;
    return { present: true, value: d.value };
  };
  const fields = {};
  for (const k of EMIT_OPTION_KEYS) {
    const r = read(k);
    if (r === null) return null;
    fields[k] = r;
  }
  const projectRoot = fields.projectRoot.value;
  const runId = fields.runId.value;
  const projectId = fields.projectId.value;
  const generatedAt = fields.generatedAt.value;
  const sourceCommit = fields.sourceCommit.value;
  const resolverMode = fields.resolverMode.value;
  if (typeof projectRoot !== "string" || projectRoot.length === 0) return null;
  if (typeof runId !== "string" || typeof projectId !== "string") return null;
  if (typeof generatedAt !== "string") return null;
  if (sourceCommit !== null && sourceCommit !== void 0 && typeof sourceCommit !== "string") {
    return null;
  }
  if (typeof resolverMode !== "string") return null;
  let budget = DEFAULT_SUGGESTION_BUDGET;
  if (fields.suggestionBudget.present && fields.suggestionBudget.value !== void 0) {
    const b = fields.suggestionBudget.value;
    if (typeof b !== "number" || !Number.isInteger(b) || b < 0) return null;
    budget = b;
  }
  return Object.freeze({
    projectRoot,
    runId,
    projectId,
    generatedAt,
    sourceCommit: sourceCommit ?? null,
    resolverMode,
    suggestionBudget: budget,
    facts: fields.facts.value,
    baselineHashes: fields.baselineHashes.value
  });
}
function isContainedRealPath(projectRoot, abs) {
  return !isRefused(checkContained(projectRoot, abs));
}
var MAX_PRIOR_PROFILE_BYTES = 256 * 1024;
function readPriorProfile(abs) {
  let st;
  try {
    st = fs9.lstatSync(abs);
  } catch (e) {
    if (e?.code === "ENOENT") return { kind: "absent" };
    return { kind: "unreadable", why: "could not stat the existing profile" };
  }
  if (!st.isFile()) return { kind: "unreadable", why: "existing profile is not a regular file" };
  if (st.size > MAX_PRIOR_PROFILE_BYTES) {
    return { kind: "unreadable", why: "existing profile exceeds the size bound" };
  }
  try {
    return { kind: "bytes", bytes: fs9.readFileSync(abs) };
  } catch {
    return { kind: "unreadable", why: "existing profile could not be read" };
  }
}
function writeFileAtomicNoFollow(abs, bytes) {
  const tmp = `${abs}.tmp-${process.pid}`;
  let fd = null;
  let created = false;
  try {
    fd = fs9.openSync(
      tmp,
      fs9.constants.O_WRONLY | fs9.constants.O_CREAT | fs9.constants.O_EXCL | fs9.constants.O_NOFOLLOW,
      384
    );
    created = true;
    let off = 0;
    while (off < bytes.length) {
      const n = fs9.writeSync(fd, bytes, off, bytes.length - off);
      if (n <= 0) return false;
      off += n;
    }
    fs9.fsyncSync(fd);
    fs9.closeSync(fd);
    fd = null;
    fs9.renameSync(tmp, abs);
    created = false;
    return true;
  } catch {
    return false;
  } finally {
    try {
      if (fd !== null) fs9.closeSync(fd);
      if (created) fs9.rmSync(tmp, { force: true });
    } catch {
    }
  }
}
function resolveBaselineHashes(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  if (import_util4.types.isProxy(value)) return null;
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return null;
  if (Object.getOwnPropertySymbols(value).length > 0) return null;
  const keys = ["agents", "skills", "registries", "bound_root", "bound_run_id"];
  const own = Object.getOwnPropertyNames(value);
  if (own.length !== keys.length) return null;
  for (const k of own) if (!keys.includes(k)) return null;
  const out = {};
  for (const k of keys) {
    const desc = Object.getOwnPropertyDescriptor(value, k);
    if (!desc || !("value" in desc)) return null;
    if (typeof desc.value !== "string") return null;
    if (k === "bound_run_id") {
      if (!isRealRunDir(desc.value)) return null;
    } else if (!TREE_HASH_RE2.test(desc.value)) {
      return null;
    }
    out[k] = desc.value;
  }
  return {
    agents: out.agents,
    skills: out.skills,
    registries: out.registries,
    bound_root: out.bound_root,
    bound_run_id: out.bound_run_id
  };
}
var PROFILE_EMITTING_MODES = Object.freeze([
  "observe",
  "shadow",
  "project-local",
  "strict"
]);
var EMITTING_MODE_SET = new Set(PROFILE_EMITTING_MODES);
var RUN_ID_RE = /^[a-z0-9][a-z0-9._-]*$/;
var ID_MAX_LEN = 128;
function isSafeId(v) {
  return typeof v === "string" && v.length > 0 && v.length <= ID_MAX_LEN && RUN_ID_RE.test(v);
}
function isSafeRunId(v) {
  return isSafeId(v) && isRealRunDir(v);
}
function emitCapabilityProfile(opts) {
  try {
    const o = captureEmitOptions(opts);
    if (o === null) {
      return {
        status: "refused",
        code: "invalid_options",
        detail: "options object is hostile or malformed (Proxy / accessor / unknown key / bad type)"
      };
    }
    if (!EMITTING_MODE_SET.has(o.resolverMode)) {
      return {
        status: "refused",
        code: "resolver_mode_disabled",
        detail: `resolver_mode "${o.resolverMode}" does not emit capability profiles`
      };
    }
    if (!isSafeRunId(o.runId)) {
      return {
        status: "refused",
        code: "invalid_run_id",
        detail: "run id is not a discoverable run-YYYYMMDD-HHMMSS-<slug>"
      };
    }
    if (!isSafeId(o.projectId)) {
      return {
        status: "refused",
        code: "invalid_project_id",
        detail: "project id is not a safe slug"
      };
    }
    if (o.generatedAt.length > 64 || !RFC3339_RE2.test(o.generatedAt)) {
      return {
        status: "refused",
        code: "invalid_generated_at",
        detail: "generated_at is not an RFC3339 timestamp"
      };
    }
    let baseline = null;
    if (o.baselineHashes !== void 0) {
      baseline = resolveBaselineHashes(o.baselineHashes);
      if (baseline === null) {
        return {
          status: "refused",
          code: "invalid_baseline",
          detail: "baselineHashes is not a bound baseline (3 tree hashes + bound_root + bound_run_id)"
        };
      }
      const binding = baselineBinding(o.projectRoot);
      if (binding === null || baseline.bound_root !== binding) {
        return {
          status: "refused",
          code: "invalid_baseline",
          detail: "baseline was captured against a different project root"
        };
      }
      if (baseline.bound_run_id !== o.runId) {
        return {
          status: "refused",
          code: "invalid_baseline",
          detail: `baseline was captured for run "${baseline.bound_run_id}", not "${o.runId}"`
        };
      }
    }
    const window = baseline === null ? "emission" : "run";
    const root = o.projectRoot;
    const before = baseline ?? snapshotTreeHashes(root);
    if (before === null) {
      return {
        status: "refused",
        code: "hash_incomplete",
        detail: "the agents/skills/registry trees could not be hashed completely"
      };
    }
    const feedstock = snapshotFeedstock(root);
    const after = snapshotTreeHashes(root);
    if (after === null) {
      return {
        status: "refused",
        code: "hash_incomplete",
        detail: "the agents/skills/registry trees could not be re-hashed completely"
      };
    }
    if (!sameHashes(before, after)) {
      return {
        status: "refused",
        code: "mutation_detected",
        detail: "agents/skills/registry tree changed during Learn \u2014 no profile emitted"
      };
    }
    const profile = {
      schema_version: PROJECT_CAPABILITY_PROFILE_SCHEMA,
      project_id: o.projectId,
      run_id: o.runId,
      generated_at: o.generatedAt,
      source_commit: o.sourceCommit,
      feedstock,
      domains: o.facts?.domains,
      boundaries: o.facts?.boundaries,
      repeated_methods: o.facts?.repeated_methods,
      coverage: o.facts?.coverage,
      candidates: o.facts?.candidates,
      resolver_mode: o.resolverMode,
      mutation_performed: false,
      mutation_window: window,
      mutation_evidence: {
        agents_tree_hash_before: before.agents,
        agents_tree_hash_after: after.agents,
        skills_tree_hash_before: before.skills,
        skills_tree_hash_after: after.skills,
        registry_hash_before: before.registries,
        registry_hash_after: after.registries
      }
    };
    const validated = validateProjectCapabilityProfileV1(profile, {
      suggestionBudget: o.suggestionBudget
    });
    if (validated === null) {
      return {
        status: "refused",
        code: "profile_invalid",
        detail: "assembled profile failed guild.project_capability_profile.v1 validation"
      };
    }
    const rel = profileRelPath(o.runId);
    const verdict = classifyContextManagerWrite(rel);
    if (verdict.allowed !== true) {
      return {
        status: "refused",
        code: "write_forbidden",
        detail: `context-manager contract refused "${rel}": ${verdict.reason}`
      };
    }
    const abs = path10.join(root, rel);
    let prior = { kind: "absent" };
    try {
      if (!isContainedRealPath(root, path10.dirname(abs))) {
        return {
          status: "refused",
          code: "escapes_project_root",
          detail: `"${rel}" has an ancestor that resolves outside the project root`
        };
      }
      fs9.mkdirSync(path10.dirname(abs), { recursive: true });
      if (!isContainedRealPath(root, abs)) {
        return {
          status: "refused",
          code: "escapes_project_root",
          detail: `"${rel}" resolves outside the project root once symlinks are followed`
        };
      }
      prior = readPriorProfile(abs);
      if (prior.kind === "unreadable") {
        return {
          status: "refused",
          code: "write_failed",
          detail: `${prior.why} \u2014 refusing to overwrite what cannot be restored`
        };
      }
      if (!writeFileAtomicNoFollow(abs, Buffer.from(`${JSON.stringify(validated, null, 2)}
`, "utf8"))) {
        return { status: "refused", code: "write_failed", detail: `could not write "${rel}"` };
      }
    } catch (e) {
      return { status: "refused", code: "write_failed", detail: String(e) };
    }
    const post = snapshotTreeHashes(root);
    if (post === null || !sameHashes(after, post)) {
      let rolledBack = false;
      if (isContainedRealPath(root, abs)) {
        try {
          if (prior.kind === "absent") {
            fs9.rmSync(abs, { force: true });
            rolledBack = true;
          } else if (prior.kind === "bytes") {
            rolledBack = writeFileAtomicNoFollow(abs, prior.bytes);
          }
        } catch {
          rolledBack = false;
        }
      }
      return {
        status: "refused",
        code: post === null ? "hash_incomplete" : "post_write_mutation",
        detail: `${post === null ? "post-write hashing was incomplete" : "profile emission itself changed a hashed tree"}${rolledBack ? " \u2014 profile rolled back" : " \u2014 ROLLBACK FAILED, the profile on disk may be stale"}`
      };
    }
    return { status: "emitted", rel_path: rel, profile: validated, hashes: after, window };
  } catch (e) {
    return { status: "refused", code: "write_failed", detail: String(e) };
  }
}

// src/modules/config/workflows/config-defaults.ts
var DEFAULT_ESCALATION_MARKERS = Object.freeze([
  "I'm not sure",
  "unclear",
  "cannot determine",
  "I don't know",
  "ambiguous",
  "uncertain",
  "not enough information"
]);
var NON_INHERITABLE_KEYS = sealSet([
  "initiative_default",
  // OD-1: attach-to-wrong-initiative risk
  "workspace"
  // workspace.mode is root-detection-only
], "NON_INHERITABLE_KEYS");
var LOG_ROTATION_THRESHOLD_BYTES = 10 * 1024 * 1024;
var SIDECAR_MAX_BYTES = 1024 * 1024;
var CAPABILITY_RESOLVER_MODES = Object.freeze([
  "legacy",
  "observe",
  "shadow",
  "project-local",
  "strict"
]);
var CAPABILITY_AUTO_CREATE_POLICIES = Object.freeze(["never", "on_approval"]);
var CAPABILITY_RESOLVER_MODE_AFTER_F7 = "observe";
var CAPABILITY_RESOLVER_MODE_DEFAULT = CAPABILITY_RESOLVER_MODE_AFTER_F7;
var DEFAULTS = deepFreeze({
  rigor: "standard",
  auto_approve: [],
  review: "local",
  host: "auto",
  /**
   * rf-wi-01 (v23x-deferred-followups G1) — the sanctioned P1-L10 host-autonomy
   * override (host_mode × guild_gates orthogonality invariant, permission-policy-schema.ts).
   * null (default) = no override; the host's own default ("ask", lifted to "bypass_all" for
   * unattended team panes per issue #54) applies. NOT under `security.` — the #54 lane
   * explicitly reverted an ad-hoc `security.host_mode` key because it bypassed this schema;
   * this top-level placement (sibling of the `host` dispatch selector) is the registered
   * replacement. One of only three keys ever legitimately null-typed at the top level.
   */
  host_mode: null,
  roles: { host: null, advisory: null, adversarial: null },
  host_profiles: {},
  initiative_default: null,
  index: "auto",
  record_status_runs: true,
  codex_skip_enforcement: "warn",
  agent_mode: "auto",
  workspace: { mode: "auto" },
  models: {
    enabled: true,
    // G4b (host-reachability): every host in the registry's HOST_IDS gets an
    // explicit tier slot — NOT generated by importing HOST_IDS here (this file's
    // own contract, stated in the module doc comment above, is to stay free of
    // internal runtime imports so core settings code can load it before the
    // host-runtime layer). The literal key set below IS the full 16-id HOST_IDS
    // roster (host-registry-schema.ts) enumerated by hand; a jest test
    // (scripts/__tests__/config-defaults-tiers-host-ids.test.ts) asserts the two
    // stay in sync so this can never silently drift again the way it had (7 of
    // 16 hosts were missing a slot before this fix). Only claude-code-cli has a
    // non-null model — every other host's registry row carries `models.<tier>.model:
    // null` (no Guild-mapped model), so `null` here is the HONEST default, not a
    // gap (see tier-defaults.ts's `tierDefaults()` for the runtime-computed
    // equivalent this static scaffold mirrors).
    tiers: {
      cheap: { "claude-code-cli": "haiku", "codex-cli": null, "pi-cli": null, "antigravity-cli": null, "agents-file": null, "claude-code-app": null, "claude-code-web": null, "codex-app": null, "claude-ai-connector": null, cursor: null, "github-copilot": null, opencode: null, "rovo-dev": null, kiro: null, qoder: null, trae: null },
      mid: { "claude-code-cli": "sonnet", "codex-cli": null, "pi-cli": null, "antigravity-cli": null, "agents-file": null, "claude-code-app": null, "claude-code-web": null, "codex-app": null, "claude-ai-connector": null, cursor: null, "github-copilot": null, opencode: null, "rovo-dev": null, kiro: null, qoder: null, trae: null },
      powerful: { "claude-code-cli": "opus", "codex-cli": null, "pi-cli": null, "antigravity-cli": null, "agents-file": null, "claude-code-app": null, "claude-code-web": null, "codex-app": null, "claude-ai-connector": null, cursor: null, "github-copilot": null, opencode: null, "rovo-dev": null, kiro: null, qoder: null, trae: null }
    },
    scoreWeights: {
      workType: 0,
      blastRadius: 1,
      dependsOn: 1,
      security: 1,
      priorEscalation: 1
    },
    thresholds: { mid: 1, powerful: 3 },
    advisorRounds: 2,
    escalationMarkers: DEFAULT_ESCALATION_MARKERS,
    recallBeforeRead: true,
    recallScoreThreshold: 0.4,
    structuredOutputRequired: true,
    cacheTTL: { coordinator: "1h", leaf: "5m" },
    importanceGate: 3,
    compositeRecall: true,
    importanceAtIngest: true,
    ingestSimilarityGate: 0.8,
    shortOutputThreshold: {},
    knowledge: {
      maxDepth: 8,
      maxBranching: 12,
      minTopicImportance: 0.4,
      relMinConf: 0.5,
      maxFiles: 3e3,
      maxTokens: 1e6,
      batchSize: 20
    }
  },
  security: {
    bypass_permissions_policy: "audit"
  },
  secrets_policy: {
    env_allowlist: [],
    redaction_patterns: [],
    fail_mode_durable: "closed",
    fail_mode_telemetry: "open"
  },
  mcp: {
    tool_description_hashes: {},
    stdio_available: true,
    http_available: false,
    bridge_package: null
  },
  /**
   * Project-capability localization (spec S5; decisions cap-loc-D04 new-install
   * policy, cap-loc-D03 migration window). Closes audit gaps D12 (no config keys
   * existed), F3 (resolver-mode ownership undefined) and F10 (budget "3–4").
   *
   * These keys select WHICH DEFINITIONS RESOLVE — they are deliberately NOT
   * security-sensitive (`isSecuritySensitiveKey` matches none of them, correctly).
   * What a lane may DO stays with `capability_scope` and the permission keys.
   *
   * Scope is `project` for all four, which is what the CONFIG_SCHEMA generator
   * already emits unconditionally — capability ownership is per project by
   * definition (the umbrella and each child answer "what roles do I need"
   * independently, and D03 has the four repos migrating at different rates). Per
   * S5 spec-call #2, per-key `scope` is NOT introduced here: the right values fall
   * out with zero generator change, and adding it would touch every existing key.
   */
  capability: {
    /**
     * Which resolver mode this project is in on D03's migration ladder. Config
     * records WHERE WE ARE, never WHETHER WE MAY MOVE — advance conditions are
     * gate criteria the initiative evaluates, and a mode change is a deliberate
     * write.
     *
     * DEFAULT IS `observe` (D04), unlocked by F7 landing — see
     * CAPABILITY_RESOLVER_MODE_DEFAULT above for what would revert it. Never
     * silently defaulted: an unset value resolves with provenance `default`, so
     * `config show --sources` shows it was never chosen.
     */
    resolver_mode: CAPABILITY_RESOLVER_MODE_DEFAULT,
    /**
     * Max capability proposals surfaced per project (D04/F10: fixed at 4, not
     * "3–4"). Range [0, 4] — the same ceiling S1's profile validator enforces, so
     * the two cannot disagree. 0 is legal: "profile but never propose".
     */
    suggestion_budget: 4,
    /**
     * Roles a new install starts with. EMPTY BY DESIGN — a non-empty default would
     * ship a roster, which is precisely what localization exists to stop. Empty ⇒
     * Learn proposes.
     */
    starter_roles: [],
    /** Whether an approved proposal may auto-advance the resolver mode (D04). */
    auto_create_policy: "on_approval"
  },
  statusline: false,
  adversarial_review_provider: "auto",
  loops: null,
  loop_cap: 16,
  codex_cap: 5,
  // guild.model_policy.v2 (dynamic-host-model-routing T5): durable operator model
  // routing intent. null = not configured — v2 routing stays off and the legacy
  // tier maps drive generic preferences for the §6 migration window. When set, the
  // object must pass the §5 closed-key validator (config-cli validateModelPolicy).
  model_policy: null,
  defaults: {
    auto_learn: false,
    adversarial: "on",
    team: { size: null, always_include: [] },
    review_workflow: "standard",
    skill_policy: "standard",
    gates: { auto_approve: [] },
    wiki: { share_mode: "team", autopromote: false },
    quality: { budget: { per_class_minutes: 10, total_minutes: 30 } },
    reporting: "standard",
    index: {
      enabled: true,
      kg_node_threshold: 2e3,
      kg_size_threshold_mb: 1,
      links_edge_threshold: 2e3,
      runs_threshold: 20,
      wiki_file_threshold: 500
    },
    cross_host: { enabled: false, hosts: {}, fallback_to_claude: true },
    retry: { max_attempts: 1, backoff: "exponential" },
    resume: { enabled: true },
    heartbeat_timeout_ms: 6e5,
    capability_manifest_ttl_s: 3600,
    // plugin-update-lifecycle G1 AC-6: update-signal behavior. `notify` prints
    // the SessionStart signal; `auto` additionally stages the host apply path;
    // `off` silences everything. cadence_hours bounds the ls-remote cache TTL.
    update: { mode: "notify", cadence_hours: 24 },
    allowed_tools: [],
    /**
     * rf-wi-01 (G1) — registers the guard hooks/lib/lean-lead-guard.ts already reads
     * tolerantly. enabled: advisory master toggle. hands_on_edit_threshold: direct lead
     * Edit/Write ops before the inline-shortcut-expired advisory fires (SKILL.md
     * "Inline shortcut under high autonomy").
     */
    lean_lead: { enabled: true, hands_on_edit_threshold: 8 },
    /**
     * rf-wi-01 (G1) — registers the guard hooks/lib/lifecycle-gate.ts already reads
     * tolerantly. enabled: master toggle. adhoc_activity_threshold: ad-hoc (non-skill)
     * activity count before the lifecycle gate advisory fires.
     */
    lifecycle_gate: { enabled: true, adhoc_activity_threshold: 20 },
    /**
     * Issue #93 — dispatch-safety knobs for the #56 backend-degradation guard
     * (hooks/lib/backend-degradation.ts).
     *
     * `block_unmarked_lanes` engages STRICT mode: a Guild lane dispatch carrying
     * NO structured producer marker (`prompt_only` evidence — the hand-rolled
     * `Agent()` drift shape) becomes BLOCKABLE instead of merely recorded.
     *
     * DEFAULT IS `false` ON PURPOSE, and that is load-bearing rather than
     * timidity. `classifyLaneEvidence` grades a fully-substituted lane brief that
     * was merely QUOTED in a prompt as `prompt_only` too — by text it is
     * indistinguishable from the real dispatch (backend-degradation.ts's
     * lane-brief signature note, adversarial review round 3). So strict mode
     * trades the no-false-positive-on-a-quoted-brief invariant for tighter drift
     * coverage, which is an operator's call to make, never a shipped default.
     *
     * PR #85 (G3) shipped this rung as the env flag `GUILD_BLOCK_UNMARKED_LANES`
     * only, deliberately deferring schema registration to avoid colliding with
     * rf-wi-01's closed-schema work. That work landed (PR #87), so this is the
     * promised followup: the key is now discoverable and validated, and the env
     * var survives as a per-session OVERRIDE (both directions) on top of it.
     */
    dispatch: { block_unmarked_lanes: false }
  }
});

// scripts/capability-profile.ts
var evidenceChunk = null;
function evidence() {
  if (evidenceChunk === null) {
    const candidates = [
      path11.join(__dirname, "capability-profile-evidence.js"),
      path11.join(__dirname, "lib", "capability", "capability-profile-evidence")
    ];
    const spec = candidates.find((c) => fs10.existsSync(c) || fs10.existsSync(`${c}.ts`)) ?? candidates[1];
    evidenceChunk = require(spec);
  }
  return evidenceChunk;
}
function readFlag(argv, name) {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return { state: "absent" };
  if (i + 1 >= argv.length) return { state: "missing_value" };
  const value = argv[i + 1];
  if (value.startsWith("--")) return { state: "missing_value" };
  return { state: "value", value };
}
function flag(argv, name) {
  const r = readFlag(argv, name);
  if (r.state === "missing_value") fail("missing_value", `--${name} was given without a value`);
  return r.state === "value" ? r.value : null;
}
function parseCount(raw) {
  if (!/^(0|[1-9][0-9]{0,4})$/.test(raw)) return null;
  return Number(raw);
}
function has(argv, name) {
  return argv.includes(`--${name}`);
}
function fail(code, detail) {
  process.stderr.write(`capability-profile: ${code}: ${detail}
`);
  process.exit(1);
}
var EMPTY_FACTS = {
  domains: [],
  boundaries: [],
  repeated_methods: [],
  coverage: { covered: [], uncovered: [], unmatched_roles: [] },
  candidates: []
};
function readFacts(file) {
  if (file === null) return EMPTY_FACTS;
  let parsed;
  try {
    parsed = JSON.parse(fs10.readFileSync(file, "utf8"));
  } catch (e) {
    fail("bad_facts_file", `${file}: ${String(e)}`);
  }
  return parsed;
}
function cmdHashTree(argv) {
  const root = path11.resolve(flag(argv, "cwd") ?? process.cwd());
  const h = snapshotTreeHashes(root);
  if (h === null) fail("hash_incomplete", "the agents/skills/registry trees could not be hashed");
  if (has(argv, "json")) {
    const forRun = flag(argv, "for-run");
    const binding = baselineBinding(root);
    const payload = forRun === null || binding === null ? h : { ...h, bound_root: binding, bound_run_id: forRun };
    process.stdout.write(`${JSON.stringify(payload, null, 2)}
`);
    return;
  }
  process.stdout.write(`recipe: ${TREE_HASH_RECIPE}
`);
  process.stdout.write(`${HASHED_TREES[0]}  ${h.agents}
`);
  process.stdout.write(`${HASHED_TREES[1]}  ${h.skills}
`);
  process.stdout.write(`${HASHED_REGISTRIES.join(" + ")}  ${h.registries}
`);
}
function cmdBaseline(argv) {
  if (has(argv, "captured-at")) fail("unknown_option", "--captured-at is forbidden; baseline capture time belongs to the lifecycle start transaction");
  const root = path11.resolve(flag(argv, "cwd") ?? process.cwd());
  const runId = flag(argv, "run-id");
  if (runId === null) fail("missing_arg", "--run-id is required");
  try {
    const baseline = evidence().captureMigrationRunBaseline({ projectRoot: root, runId });
    process.stdout.write(`${JSON.stringify({ status: "written", rel_path: `.guild/runs/${runId}/capability/run-start-baseline.json`, baseline }, null, 2)}
`);
  } catch (error) {
    fail("baseline_refused", error instanceof Error ? error.message : String(error));
  }
}
function cmdEmit(argv) {
  if (has(argv, "generated-at")) fail("unknown_option", "--generated-at is forbidden; profile emission time comes from the tool clock");
  const root = path11.resolve(flag(argv, "cwd") ?? process.cwd());
  const runId = flag(argv, "run-id");
  const projectId = flag(argv, "project-id");
  const generatedAt = (/* @__PURE__ */ new Date()).toISOString();
  if (runId === null) fail("missing_arg", "--run-id is required");
  if (projectId === null) fail("missing_arg", "--project-id is required");
  const modeRaw = flag(argv, "resolver-mode") ?? "observe";
  if (!CAPABILITY_RESOLVER_MODES.includes(modeRaw)) {
    fail("bad_resolver_mode", `"${modeRaw}" is not one of ${CAPABILITY_RESOLVER_MODES.join("|")}`);
  }
  const budgetRaw = flag(argv, "budget");
  const budget = budgetRaw === null ? DEFAULT_SUGGESTION_BUDGET : parseCount(budgetRaw);
  if (budget === null) fail("bad_budget", `"${budgetRaw}" is not a count`);
  const baselineFile = flag(argv, "baseline");
  let baselineHashes;
  if (baselineFile !== null) {
    try {
      const parsed = JSON.parse(fs10.readFileSync(baselineFile, "utf8"));
      const retained = evidence().validateMigrationRunBaseline(parsed);
      baselineHashes = retained ? evidence().profileBaselineFromMigrationRunBaseline(retained) : parsed;
    } catch (e) {
      fail("bad_baseline_file", `${baselineFile}: ${String(e)}`);
    }
  }
  const result = emitCapabilityProfile({
    projectRoot: root,
    runId,
    projectId,
    generatedAt,
    sourceCommit: flag(argv, "source-commit"),
    resolverMode: modeRaw,
    suggestionBudget: budget,
    facts: readFacts(flag(argv, "facts")),
    ...baselineFile === null ? {} : { baselineHashes }
  });
  if (result.status === "refused") {
    fail(result.code, result.detail);
  }
  process.stdout.write(
    `${JSON.stringify(
      {
        status: "emitted",
        rel_path: result.rel_path,
        mutation_performed: result.profile.mutation_performed,
        mutation_window: result.profile.mutation_window,
        hashes: result.hashes,
        candidates: result.profile.candidates.length,
        feedstock_absent: result.profile.feedstock.absent
      },
      null,
      2
    )}
`
  );
}
function cmdCandidates(argv) {
  const root = path11.resolve(flag(argv, "cwd") ?? process.cwd());
  const budgetRaw = flag(argv, "budget");
  const budget = budgetRaw === null ? void 0 : parseCount(budgetRaw);
  if (budgetRaw !== null && budget === null) fail("bad_budget", `"${budgetRaw}" is not a count`);
  const surface = surfaceCapabilityCandidates(root, { suggestionBudget: budget ?? void 0 });
  const layout = layoutRow(root);
  if (has(argv, "json")) {
    process.stdout.write(`${JSON.stringify({ ...surface, storage_layout: layout }, null, 2)}
`);
    return;
  }
  process.stdout.write(`${renderLayoutRow(layout)}
`);
  process.stdout.write(`${renderCandidateSection(surface)}
`);
}
function layoutRow(root) {
  const status = detect(root);
  const row = {
    layout_version: status.version,
    layout_state: status.state,
    current_version: CURRENT_LAYOUT_VERSION,
    upgrade_state: null,
    blocked: false,
    dirty_paths: [],
    question: null
  };
  if (status.state === "absent") return row;
  try {
    const storage = createGuildStorage(root);
    const journal = loadJournal(upgradeJournalPath((...s) => storage.runtime(...s)));
    if (!journal) return row;
    row.upgrade_state = journal.state;
    row.blocked = journal.state === "blocked_dirty_durable" || journal.state === "blocked_confirm";
    row.dirty_paths = journal.dirty_paths;
    row.question = journal.entries.find((e) => e.question)?.question ?? null;
  } catch {
  }
  return row;
}
function renderLayoutRow(row) {
  const version = row.layout_version === null ? "unmarked" : String(row.layout_version);
  const head = `Storage layout: ${version} (this build: ${row.current_version}) \u2014 ${row.layout_state}`;
  if (!row.blocked) {
    return row.upgrade_state && row.upgrade_state !== "committed" ? `${head}; last upgrade ${row.upgrade_state}` : head;
  }
  const lines = [`${head}; upgrade ${row.upgrade_state} \u2014 this root is reading v1 content`];
  for (const p of row.dirty_paths) lines.push(`  dirty: ${p}`);
  if (row.question) lines.push(`  confirm: ${row.question}`);
  lines.push("  retry: guild config migrate --mode=migrate");
  return lines.join("\n");
}
function main() {
  const [, , sub, ...argv] = process.argv;
  switch (sub) {
    case "hash-tree":
      return cmdHashTree(argv);
    case "baseline":
      return cmdBaseline(argv);
    case "emit":
      return cmdEmit(argv);
    case "candidates":
      return cmdCandidates(argv);
    default:
      fail("unknown_subcommand", `expected hash-tree|baseline|emit|candidates, got "${sub ?? ""}"`);
  }
}
if (require.main === module) main();
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  layoutRow,
  renderLayoutRow
});
