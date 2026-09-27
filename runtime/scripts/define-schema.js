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

// scripts/lib/define-schema.ts
var define_schema_exports = {};
__export(define_schema_exports, {
  DEFINE_SCHEMA_VERSION: () => DEFINE_SCHEMA_VERSION,
  DEFINE_V1_EXAMPLE: () => DEFINE_V1_EXAMPLE,
  acceptanceCriterionIds: () => acceptanceCriterionIds,
  isDefineV1: () => isDefineV1,
  runSelfCheck: () => runSelfCheck,
  validateDefineV1: () => validateDefineV1
});
module.exports = __toCommonJS(define_schema_exports);

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

// src/domains/evolve/define-schema.ts
var DEFINE_SCHEMA_VERSION = "guild.define.v1";
var ACCEPTANCE_CRITERION_ALLOWED_KEYS = ["id", "text"];
var DEFINE_ALLOWED_KEYS = [
  "schema_version",
  "acceptance_criteria",
  "user_stories",
  "non_goals",
  "risks",
  "affected_surfaces",
  "test_implications"
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
function validateDefineV1(value) {
  const errors = [];
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { valid: false, errors: ["define artifact must be a non-null object"] };
  }
  const o = value;
  rejectUnknownKeys(errors, o, DEFINE_ALLOWED_KEYS, "define artifact");
  if (typeof o["schema_version"] !== "string" || o["schema_version"] !== DEFINE_SCHEMA_VERSION) {
    errors.push(`schema_version must be "${DEFINE_SCHEMA_VERSION}"; got ${show(o["schema_version"])}`);
  }
  const ac = o["acceptance_criteria"];
  if (!Array.isArray(ac)) {
    errors.push(`"acceptance_criteria" must be an array of { id, text }`);
  } else if (ac.length === 0) {
    errors.push(`"acceptance_criteria" must not be empty (fail-closed required field)`);
  } else {
    const seen = /* @__PURE__ */ new Set();
    ac.forEach((el, i) => {
      if (typeof el !== "object" || el === null || Array.isArray(el)) {
        errors.push(`acceptance_criteria[${i}] must be an object { id, text }`);
        return;
      }
      const c = el;
      rejectUnknownKeys(errors, c, ACCEPTANCE_CRITERION_ALLOWED_KEYS, `acceptance_criteria[${i}]`);
      const id = c["id"];
      if (typeof id !== "string" || id.trim() === "") {
        errors.push(`acceptance_criteria[${i}].id must be a non-empty stable string`);
      } else if (seen.has(id)) {
        errors.push(`acceptance_criteria[${i}].id "${id}" is a duplicate; AC ids must be unique`);
      } else {
        seen.add(id);
      }
      if (typeof c["text"] !== "string" || c["text"].trim() === "") {
        errors.push(`acceptance_criteria[${i}].text must be a non-empty string`);
      }
    });
  }
  requireNonEmptyStringArray(errors, o, "user_stories");
  requireNonEmptyStringArray(errors, o, "non_goals");
  requireNonEmptyStringArray(errors, o, "risks");
  requireNonEmptyStringArray(errors, o, "affected_surfaces");
  requireNonEmptyStringArray(errors, o, "test_implications");
  return { valid: errors.length === 0, errors };
}
function isDefineV1(value) {
  return validateDefineV1(value).valid;
}
function acceptanceCriterionIds(value) {
  if (typeof value !== "object" || value === null) return [];
  const ac = value["acceptance_criteria"];
  if (!Array.isArray(ac)) return [];
  const ids = [];
  for (const el of ac) {
    if (el && typeof el === "object" && typeof el["id"] === "string") {
      ids.push(el["id"]);
    }
  }
  return ids;
}
var DEFINE_V1_EXAMPLE = deepFreeze({
  schema_version: DEFINE_SCHEMA_VERSION,
  acceptance_criteria: [
    { id: "AC-1", text: "A vague product prompt reaches product-loop intake with no slash command." },
    { id: "AC-2", text: "The intake classifier never hijacks a normal build/review prompt." }
  ],
  user_stories: ["As a builder, I describe an idea in plain words and Guild scopes it."],
  non_goals: ["No live-host install proof in this wave."],
  risks: ["intake classifier over-fires on non-product prompts"],
  affected_surfaces: ["scripts/lib/ intake classifier", "using-guild no-slash entry"],
  test_implications: ["precision \u22650.9 / recall \u22650.8 trigger-accuracy eval"]
});
function runSelfCheck() {
  const good = validateDefineV1(DEFINE_V1_EXAMPLE);
  const dup = {
    ...DEFINE_V1_EXAMPLE,
    acceptance_criteria: [
      { id: "AC-1", text: "first" },
      { id: "AC-1", text: "dup" }
    ]
  };
  const bad = validateDefineV1(dup);
  let exoticThrew = false;
  let exoticRejected = false;
  try {
    exoticRejected = !validateDefineV1({ ...DEFINE_V1_EXAMPLE, schema_version: 123 }).valid;
  } catch {
    exoticThrew = true;
  }
  const pass = good.valid && !bad.valid && exoticRejected && !exoticThrew;
  return {
    pass,
    details: `valid-sample=${good.valid} duplicate-id-rejected=${!bad.valid} bigint-rejected-no-throw=${exoticRejected && !exoticThrew}`
  };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  DEFINE_SCHEMA_VERSION,
  DEFINE_V1_EXAMPLE,
  acceptanceCriterionIds,
  isDefineV1,
  runSelfCheck,
  validateDefineV1
});
