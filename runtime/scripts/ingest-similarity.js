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

// scripts/lib/ingest-similarity.ts
var ingest_similarity_exports = {};
__export(ingest_similarity_exports, {
  bm25Score: () => bm25Score,
  ingestSimilarity: () => ingestSimilarity,
  normalizeCategory: () => normalizeCategory,
  readIngestGate: () => readIngestGate,
  tokenize: () => tokenize
});
module.exports = __toCommonJS(ingest_similarity_exports);
var fs = __toESM(require("node:fs"));
var path2 = __toESM(require("node:path"));

// hooks/lib/security/injection-guard.ts
var DIRECTIVE_PATTERNS = [
  // ── Classic "ignore previous / all / above" ───────────────────────────────
  // Broad form: "ignore [optional modifiers] instructions/prompt/context/directives"
  // Handles: "ignore instructions", "ignore previous instructions",
  //          "ignore above instructions", "ignore all previous directives", etc.
  {
    name: "ignore-previous-instructions",
    re: /\bignore\b(?:\s+\w+){0,3}\s+\b(instructions?|prompt|context|directives?)\b/i
  },
  {
    name: "disregard-previous-instructions",
    re: /\bdisregard\b(?:\s+\w+){0,3}\s+\b(instructions?|prompt|context)\b/i
  },
  // "forget [your/my/all] [previous/prior/past] instructions/context"
  {
    name: "forget-previous-instructions",
    re: /\bforget\b(?:\s+(?:your|my|all|previous|prior|past|earlier)){1,3}\s+\b(instructions?|prompt|context|rules?)\b/i
  },
  {
    name: "override-previous-instructions",
    re: /\boverride\b(?:\s+\w+){0,3}\s+\b(instructions?|context|prompt)\b/i
  },
  // ── Role-reassignment: "you are now / act as / pretend" ──────────────────
  {
    name: "you-are-now",
    re: /you\s+are\s+now\s+(a|an|the|going|able|authorized|required)/i
  },
  {
    name: "act-as-if",
    re: /act\s+as\s+(if|though|a|an|the)\b/i
  },
  {
    name: "pretend-you-are",
    re: /pretend\s+(you\s+are|to\s+be)\b/i
  },
  {
    name: "your-new-instructions",
    re: /your\s+(new|updated|actual|real|true)\s+(instructions?|persona|role|identity|task)/i
  },
  // ── System / context injection ────────────────────────────────────────────
  {
    name: "system-prompt",
    re: /system\s+prompt/i
  },
  {
    name: "markdown-system-block",
    re: /```\s*system\b/i
  },
  // Anthropic conversation-format injection (\n\nHuman: / \n\nAssistant:)
  {
    name: "anthropic-format-human",
    re: /\n\s*human\s*:/i
  },
  {
    name: "anthropic-format-assistant",
    re: /\n\s*assistant\s*:/i
  },
  // HTML comment injection
  {
    name: "html-comment-injection",
    re: /<!--\s*(ignore|override|instruction|system|disregard)/i
  },
  // ── Jailbreak keywords ────────────────────────────────────────────────────
  {
    name: "jailbreak",
    re: /\bjailbreak\b/i
  }
];
function sanitizeForInjection(text) {
  const matchedPatterns = [];
  for (const { name, re } of DIRECTIVE_PATTERNS) {
    if (re.test(text)) {
      matchedPatterns.push(name);
    }
  }
  return {
    result: matchedPatterns.length > 0 ? "flagged" : "clean",
    sanitized: text,
    matchedPatterns
  };
}

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

// src/domains/kernel/identifier-tokenize.ts
var TOKEN_RE = /[A-Za-z0-9]+/g;

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

// src/domains/knowledge/bm25.ts
function tokenize(s) {
  const out = [];
  const m = s.toLowerCase().match(TOKEN_RE);
  if (!m) return out;
  for (const tok of m) if (tok.length > 1) out.push(tok);
  return out;
}
function bm25Score(queryTokens, docs) {
  const k1 = 1.5;
  const b = 0.75;
  const N = docs.length;
  if (N === 0) return [];
  const avgdl = docs.reduce((s, d) => s + d.tokens.length, 0) / N;
  const df = /* @__PURE__ */ new Map();
  for (const q of new Set(queryTokens)) {
    let count = 0;
    for (const d of docs) {
      if (d.tokens.includes(q)) count++;
    }
    df.set(q, count);
  }
  const scores = new Array(N).fill(0);
  for (let i = 0; i < N; i++) {
    const doc = docs[i];
    const dl = doc.tokens.length || 1;
    const tf = /* @__PURE__ */ new Map();
    for (const t of doc.tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
    let s = 0;
    for (const q of queryTokens) {
      const f = tf.get(q) ?? 0;
      if (f === 0) continue;
      const n = df.get(q) ?? 0;
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
      const num = f * (k1 + 1);
      const den = f + k1 * (1 - b + b * (dl / avgdl));
      s += idf * (num / den);
    }
    scores[i] = s;
  }
  return scores;
}

// scripts/lib/ingest-similarity.ts
var DEFAULT_GATE = 0.8;
function readIngestGate(cwd) {
  try {
    const settingsPath = path2.join(cwd, ".guild", "settings.json");
    if (!fs.existsSync(settingsPath)) return DEFAULT_GATE;
    const raw = fs.readFileSync(settingsPath, "utf8");
    const settings = JSON.parse(raw);
    const models = settings["models"];
    if (models && typeof models === "object") {
      const gate = models["ingestSimilarityGate"];
      if (typeof gate === "number" && gate >= 0 && gate <= 1) return gate;
    }
    return DEFAULT_GATE;
  } catch {
    return DEFAULT_GATE;
  }
}
var CATEGORY_SINGULAR_TO_PLURAL = {
  standard: "standards",
  product: "products",
  entity: "entities",
  concept: "concepts",
  source: "sources"
};
function normalizeCategory(category) {
  return CATEGORY_SINGULAR_TO_PLURAL[category.toLowerCase()] ?? category;
}
function scanCategoryPages(cwd, category) {
  const canonicalCategory = normalizeCategory(category);
  const catDir = path2.join(cwd, ".guild", "wiki", canonicalCategory);
  let names;
  try {
    names = fs.readdirSync(catDir).filter((n) => n.endsWith(".md"));
  } catch {
    return [];
  }
  const pages = [];
  for (const name of names) {
    try {
      const abs = path2.join(catDir, name);
      const content = fs.readFileSync(abs, "utf8");
      const title = name.replace(/\.md$/, "").replace(/[-_]/g, " ");
      const tokens = tokenize(title + "\n" + title + "\n" + content);
      pages.push({
        relPath: path2.join(".guild", "wiki", canonicalCategory, name),
        tokens
      });
    } catch {
    }
  }
  return pages;
}
function ingestSimilarity(cwd, candidate, category = "") {
  const gate = readIngestGate(cwd);
  const probe = sanitizeForInjection(candidate.title + "\n" + candidate.content);
  const probeHit = probe.result === "flagged";
  const probePatterns = probe.matchedPatterns;
  const compose = (topScore2, topPath2) => {
    const similarityPause = topScore2 >= gate;
    const shouldPause = similarityPause || probeHit;
    const pauseReason = !shouldPause ? null : similarityPause && probeHit ? "both" : similarityPause ? "similarity" : "directive_probe";
    return {
      top_score: topScore2,
      top_path: topPath2,
      gate,
      should_pause: shouldPause,
      probe_hit: probeHit,
      probe_patterns: probePatterns,
      pause_reason: pauseReason
    };
  };
  const candidateTokens = tokenize(
    candidate.title + "\n" + candidate.title + "\n" + candidate.content
  );
  if (candidateTokens.length === 0) {
    return compose(0, null);
  }
  const pages = scanCategoryPages(cwd, category);
  if (pages.length === 0) {
    return compose(0, null);
  }
  const scores = bm25Score(candidateTokens, pages.map((p) => ({ tokens: p.tokens })));
  let topScore = 0;
  let topPath = null;
  for (let i = 0; i < scores.length; i++) {
    if (scores[i] > topScore) {
      topScore = scores[i];
      topPath = pages[i].relPath;
    }
  }
  return compose(topScore, topPath);
}
if (require.main === module) {
  const argv = process.argv.slice(2);
  let cwd = process.env["GUILD_CWD"] ?? process.cwd();
  let category = "";
  let title = "";
  let contentFile = "";
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--cwd" && argv[i + 1]) {
      cwd = argv[++i];
    } else if (arg === "--category" && argv[i + 1]) {
      category = argv[++i];
    } else if (arg === "--title" && argv[i + 1]) {
      title = argv[++i];
    } else if (arg === "--content-file" && argv[i + 1]) {
      contentFile = argv[++i];
    } else if (arg.startsWith("--cwd=")) {
      cwd = arg.slice("--cwd=".length);
    } else if (arg.startsWith("--category=")) {
      category = arg.slice("--category=".length);
    } else if (arg.startsWith("--title=")) {
      title = arg.slice("--title=".length);
    } else if (arg.startsWith("--content-file=")) {
      contentFile = arg.slice("--content-file=".length);
    }
  }
  if (!category) {
    process.stderr.write("[ingest-similarity] ERROR: --category <category> is required\n");
    process.exit(1);
  }
  let content = "";
  if (contentFile) {
    try {
      content = fs.readFileSync(contentFile, "utf8");
    } catch (e) {
      process.stderr.write(
        `[ingest-similarity] ERROR: cannot read --content-file "${contentFile}": ${String(e)}
`
      );
      process.exit(1);
    }
  }
  const result = ingestSimilarity(cwd, { title, content }, category);
  process.stdout.write(JSON.stringify(result) + "\n");
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  bm25Score,
  ingestSimilarity,
  normalizeCategory,
  readIngestGate,
  tokenize
});
