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

// scripts/knowledge-links-traverse.ts
var knowledge_links_traverse_exports = {};
__export(knowledge_links_traverse_exports, {
  CLOSED_EDGE_TYPES: () => CLOSED_EDGE_TYPES,
  REQUIRED_KINDS: () => REQUIRED_KINDS,
  activeLinks: () => activeLinks,
  allEdgesClosed: () => allEdgesClosed,
  appendBatch: () => appendBatch,
  classifyNodeKind: () => classifyNodeKind,
  isFullyConnected: () => isFullyConnected,
  loadKnowledgeLinks: () => loadKnowledgeLinks,
  nonClosedEdgeTypes: () => nonClosedEdgeTypes,
  reachableKinds: () => reachableKinds,
  tombstoneLinks: () => tombstoneLinks
});
module.exports = __toCommonJS(knowledge_links_traverse_exports);
var fs4 = __toESM(require("node:fs"));

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

// scripts/knowledge-links-traverse.ts
var path5 = __toESM(require("node:path"));

// scripts/learn/lib/knowledge-links-io.ts
var fs = __toESM(require("fs"));
var path2 = __toESM(require("path"));
var KNOWLEDGE_LINKS_SCHEMA_VERSION = "guild.knowledge_links.v1";
function loadKnowledgeLinksDoc(file) {
  try {
    const raw = fs.readFileSync(file, "utf8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed["links"])) {
      const schemaVersion = typeof parsed["schema_version"] === "string" ? parsed["schema_version"] : typeof parsed["version"] === "string" ? parsed["version"] : KNOWLEDGE_LINKS_SCHEMA_VERSION;
      return { schema_version: schemaVersion, links: parsed["links"] };
    }
  } catch {
  }
  return { schema_version: KNOWLEDGE_LINKS_SCHEMA_VERSION, links: [] };
}
function writeKnowledgeLinksDoc(file, doc) {
  fs.mkdirSync(path2.dirname(file), { recursive: true });
  const out = {
    schema_version: doc.schema_version || KNOWLEDGE_LINKS_SCHEMA_VERSION,
    links: doc.links
  };
  fs.writeFileSync(file, JSON.stringify(out, null, 2) + "\n", "utf8");
}
function linkKey(l) {
  return `${l.from}|${l.to}|${l.type}`;
}
function appendKnowledgeLinksBatch(file, batch) {
  const doc = loadKnowledgeLinksDoc(file);
  const existing = new Set(doc.links.map(linkKey));
  let added = 0;
  for (const link of batch) {
    const key = linkKey(link);
    if (!existing.has(key)) {
      existing.add(key);
      doc.links.push(link);
      added++;
    }
  }
  writeKnowledgeLinksDoc(file, { schema_version: KNOWLEDGE_LINKS_SCHEMA_VERSION, links: doc.links });
  return { added, total: doc.links.length };
}

// scripts/lib/state/ensure-storage-layout.ts
var fs3 = __toESM(require("node:fs"));
var path4 = __toESM(require("node:path"));

// src/domains/state/guild-root.ts
var fs2 = __toESM(require("node:fs"));
var path3 = __toESM(require("node:path"));
function resolveGuildRoot(startDir) {
  const resolvedStart = path3.resolve(startDir);
  let current = resolvedStart;
  let nearestGuildDir = null;
  for (; ; ) {
    if (fs2.existsSync(path3.join(current, ".git"))) return current;
    if (nearestGuildDir === null) {
      const guildDir = path3.join(current, ".guild");
      try {
        if (fs2.existsSync(guildDir) && fs2.statSync(guildDir).isDirectory()) nearestGuildDir = current;
      } catch {
      }
    }
    const parent = path3.dirname(current);
    if (parent === current) return nearestGuildDir ?? resolvedStart;
    current = parent;
  }
}

// scripts/lib/state/ensure-storage-layout.ts
var CURRENT_LAYOUT_VERSION = 2;
function markerPath(root) {
  return path4.join(root, ".guild", "storage-layout.json");
}
function detect(cwd = process.cwd()) {
  const root = resolveGuildRoot(cwd);
  const marker = markerPath(root);
  if (!fs3.existsSync(path4.join(root, ".guild"))) {
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
      path4.join(__dirname, "upgrade-chain.js"),
      path4.join(__dirname, "lib", "state", "upgrade-chain"),
      path4.join(__dirname, "upgrade-chain")
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

// scripts/knowledge-links-traverse.ts
var CLOSED_EDGE_TYPES = sealSet([
  "decided_by",
  "used_for",
  "produced",
  "touches",
  "supersedes",
  "learned_from",
  "constrains",
  "opens_question",
  "resolves"
], "CLOSED_EDGE_TYPES");
var REQUIRED_KINDS = Object.freeze([
  "decision",
  "skill_agent",
  "feature_component",
  "wiki"
]);
function classifyNodeKind(id) {
  if (id.startsWith("decision:")) return "decision";
  if (id.startsWith("skill:") || id.startsWith("agent:")) return "skill_agent";
  if (id.startsWith("feature:") || id.startsWith("component:")) return "feature_component";
  if (id.startsWith("wiki:")) return "wiki";
  return "other";
}
function loadKnowledgeLinks(file) {
  const shared = loadKnowledgeLinksDoc(file);
  return { version: shared.schema_version, links: shared.links };
}
function appendBatch(file, batch) {
  return appendKnowledgeLinksBatch(file, batch);
}
function activeLinks(doc) {
  return doc.links.filter((l) => !l.tombstoned);
}
function tombstoneLinks(file, match, reason, tombstonedAt) {
  const doc = loadKnowledgeLinks(file);
  let n = 0;
  for (const l of doc.links) {
    if (l.tombstoned) continue;
    if (match.from !== void 0 && l.from !== match.from) continue;
    if (match.to !== void 0 && l.to !== match.to) continue;
    if (match.type !== void 0 && l.type !== match.type) continue;
    l.tombstoned = true;
    l.tombstoned_at = tombstonedAt;
    l.tombstoned_reason = reason;
    n++;
  }
  if (n > 0) {
    writeKnowledgeLinksDoc(file, { schema_version: KNOWLEDGE_LINKS_SCHEMA_VERSION, links: doc.links });
  }
  return { tombstoned: n };
}
function allEdgesClosed(doc) {
  return doc.links.every((l) => CLOSED_EDGE_TYPES.has(l.type));
}
function nonClosedEdgeTypes(doc) {
  return [...new Set(doc.links.filter((l) => !CLOSED_EDGE_TYPES.has(l.type)).map((l) => l.type))];
}
function reachableKinds(doc, start) {
  const adj = /* @__PURE__ */ new Map();
  const link = (a, b) => {
    if (!adj.has(a)) adj.set(a, /* @__PURE__ */ new Set());
    adj.get(a).add(b);
  };
  for (const l of activeLinks(doc)) {
    link(l.from, l.to);
    link(l.to, l.from);
  }
  const seen = /* @__PURE__ */ new Set([start]);
  const queue = [start];
  const kinds = /* @__PURE__ */ new Set();
  while (queue.length) {
    const cur = queue.shift();
    for (const next of adj.get(cur) ?? []) {
      if (seen.has(next)) continue;
      seen.add(next);
      const k = classifyNodeKind(next);
      if (k !== "other") kinds.add(k);
      queue.push(next);
    }
  }
  return kinds;
}
function isFullyConnected(doc, taskId) {
  const kinds = reachableKinds(doc, taskId);
  return REQUIRED_KINDS.every((k) => kinds.has(k));
}
function parseFlag(argv, flag) {
  const i = argv.indexOf(flag);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : void 0;
}
function main() {
  const argv = process.argv.slice(2);
  const cwd = parseFlag(argv, "--cwd") ?? process.cwd();
  ensureStorageLayout(cwd, { detectOnly: true });
  const taskId = parseFlag(argv, "--task-id");
  const asJson = argv.includes("--json");
  if (!taskId) {
    process.stderr.write("[knowledge-links-traverse] --task-id is required\n");
    process.stdout.write(JSON.stringify({ error: "missing --task-id" }) + "\n");
    return;
  }
  const klPath = path5.join(cwd, ".guild", "indexes", "knowledge-links.json");
  if (!fs4.existsSync(klPath)) {
    const result2 = { task_id: taskId, connected: false, reachable_kinds: [], required_kinds: REQUIRED_KINDS, missing_kinds: REQUIRED_KINDS, note: "no knowledge-links.json found" };
    process.stdout.write(JSON.stringify(result2, null, asJson ? 2 : 0) + "\n");
    return;
  }
  const doc = loadKnowledgeLinks(klPath);
  const kinds = reachableKinds(doc, taskId);
  const missing = REQUIRED_KINDS.filter((k) => !kinds.has(k));
  const result = {
    task_id: taskId,
    connected: missing.length === 0,
    reachable_kinds: [...kinds].sort(),
    required_kinds: REQUIRED_KINDS,
    missing_kinds: missing
  };
  process.stdout.write(JSON.stringify(result, null, asJson ? 2 : 0) + "\n");
}
if (require.main === module) {
  main();
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  CLOSED_EDGE_TYPES,
  REQUIRED_KINDS,
  activeLinks,
  allEdgesClosed,
  appendBatch,
  classifyNodeKind,
  isFullyConnected,
  loadKnowledgeLinks,
  nonClosedEdgeTypes,
  reachableKinds,
  tombstoneLinks
});
