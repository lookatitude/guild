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

// scripts/lib/explore-schema.ts
var explore_schema_exports = {};
__export(explore_schema_exports, {
  EXPLORE_SCHEMA_VERSION: () => EXPLORE_SCHEMA_VERSION,
  EXPLORE_V1_EXAMPLE: () => EXPLORE_V1_EXAMPLE,
  isExploreV1: () => isExploreV1,
  runSelfCheck: () => runSelfCheck,
  validateExploreV1: () => validateExploreV1
});
module.exports = __toCommonJS(explore_schema_exports);

// src/domains/kernel/module-manifest.ts
var OWNED_INVENTORY_CATEGORIES = Object.freeze([
  "commands",
  "skills",
  "agents",
  "hooks",
  "mcp_servers",
  "scripts"
]);

// src/domains/kernel/plugin-root.ts
var path = __toESM(require("node:path"));
var PLUGIN_ROOT_MARKER = path.join("runtime", "guild-mcp.js");

// src/domains/kernel/sealed-collections.ts
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

// src/domains/kernel/path-containment.ts
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

// src/domains/kernel/runtime-tree-guard.ts
var RUNTIME_SUBTREE_SEGMENTS = sealSet(
  [
    "skills",
    "agents",
    "commands",
    "hooks",
    ".claude-plugin",
    "dist",
    "src",
    "templates"
  ],
  "RUNTIME_SUBTREE_SEGMENTS"
);

// src/domains/kernel/tier-bus.ts
var BUS_TIERS = frozenList(["T0", "T1", "T2"]);
var LEAD_ROLE_IDS = frozenList(["team-lead", "lead", "orchestrator"]);
var TIER_BUS_CONTRACT = deepFreeze({
  tiers: BUS_TIERS,
  upward_envelopes: { T2: "guild.handoff.v2", T1: "guild.goal_status.v1" },
  lead_roles: LEAD_ROLE_IDS,
  tier_source: "the attempt record on disk, or the run's minted binding_ref \u2014 never the payload"
});

// src/domains/evolve/explore-schema.ts
var EXPLORE_SCHEMA_VERSION = "guild.explore.v1";
var EXPLORE_ALLOWED_KEYS = [
  "schema_version",
  "assumptions",
  "evidence_needs",
  "comparables",
  "risks",
  "recommended_next_step"
];
function show(v) {
  if (typeof v === "bigint") return `${v.toString()}n`;
  try {
    const s = JSON.stringify(v);
    return s === void 0 ? String(v) : s;
  } catch {
    return String(v);
  }
}
function rejectUnknownKeys(errors, obj, allowed, label) {
  for (const k of Object.keys(obj)) {
    if (!allowed.includes(k)) {
      errors.push(`${label} has unknown key "${k}" (strict: only ${allowed.join(", ")} allowed)`);
    }
  }
}
function requireNonEmptyStringArray(errors, obj, field) {
  const v = obj[field];
  if (!Array.isArray(v)) {
    errors.push(`"${field}" must be an array of non-empty strings`);
    return;
  }
  if (v.length === 0) {
    errors.push(`"${field}" must not be empty (fail-closed required field)`);
    return;
  }
  v.forEach((el, i) => {
    if (typeof el !== "string" || el.trim() === "") {
      errors.push(`"${field}[${i}]" must be a non-empty string`);
    }
  });
}
function validateExploreV1(value) {
  const errors = [];
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { valid: false, errors: ["explore artifact must be a non-null object"] };
  }
  const o = value;
  rejectUnknownKeys(errors, o, EXPLORE_ALLOWED_KEYS, "explore artifact");
  if (typeof o["schema_version"] !== "string" || o["schema_version"] !== EXPLORE_SCHEMA_VERSION) {
    errors.push(`schema_version must be "${EXPLORE_SCHEMA_VERSION}"; got ${show(o["schema_version"])}`);
  }
  requireNonEmptyStringArray(errors, o, "assumptions");
  requireNonEmptyStringArray(errors, o, "evidence_needs");
  requireNonEmptyStringArray(errors, o, "comparables");
  requireNonEmptyStringArray(errors, o, "risks");
  if (typeof o["recommended_next_step"] !== "string" || o["recommended_next_step"].trim() === "") {
    errors.push(`"recommended_next_step" must be a non-empty string`);
  }
  return { valid: errors.length === 0, errors };
}
function isExploreV1(value) {
  return validateExploreV1(value).valid;
}
var EXPLORE_V1_EXAMPLE = deepFreeze({
  schema_version: EXPLORE_SCHEMA_VERSION,
  assumptions: ["users will accept a CLI-first workflow", "teams already use git"],
  evidence_needs: ["how many target users live in the terminal vs an IDE"],
  comparables: ["GitHub Copilot CLI", "Aider"],
  risks: ["host fragmentation increases support surface"],
  recommended_next_step: "run a 5-user concierge test on the no-slash product intake"
});
function runSelfCheck() {
  const good = validateExploreV1(EXPLORE_V1_EXAMPLE);
  const { assumptions: _drop, ...missing } = EXPLORE_V1_EXAMPLE;
  const bad = validateExploreV1(missing);
  let exoticThrew = false;
  let exoticRejected = false;
  try {
    exoticRejected = !validateExploreV1({ ...EXPLORE_V1_EXAMPLE, schema_version: 123 }).valid;
  } catch {
    exoticThrew = true;
  }
  const pass = good.valid && !bad.valid && exoticRejected && !exoticThrew;
  return {
    pass,
    details: `valid-sample=${good.valid} missing-field-rejected=${!bad.valid} bigint-rejected-no-throw=${exoticRejected && !exoticThrew}`
  };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  EXPLORE_SCHEMA_VERSION,
  EXPLORE_V1_EXAMPLE,
  isExploreV1,
  runSelfCheck,
  validateExploreV1
});
