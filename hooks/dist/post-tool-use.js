#!/usr/bin/env -S npx tsx
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

// post-tool-use.ts
var post_tool_use_exports = {};
__export(post_tool_use_exports, {
  main: () => main
});
module.exports = __toCommonJS(post_tool_use_exports);
var fs10 = __toESM(require("node:fs"));
var path12 = __toESM(require("node:path"));

// lib/guild-root.ts
var fs = __toESM(require("node:fs"));
var path = __toESM(require("node:path"));
function resolveGuildRoot(startCwd) {
  const resolvedStart = path.resolve(startCwd);
  let current = resolvedStart;
  let nearestGuildDir = null;
  for (; ; ) {
    if (fs.existsSync(path.join(current, ".git"))) {
      return current;
    }
    if (nearestGuildDir === null) {
      const guildDir = path.join(current, ".guild");
      if (fs.existsSync(guildDir)) {
        try {
          if (fs.statSync(guildDir).isDirectory()) {
            nearestGuildDir = current;
          }
        } catch {
        }
      }
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return nearestGuildDir ?? resolvedStart;
    }
    current = parent;
  }
}

// ../src/modules/kernel/workflows/module-manifest.ts
var OWNED_INVENTORY_CATEGORIES = Object.freeze([
  "commands",
  "skills",
  "agents",
  "hooks",
  "mcp_servers",
  "scripts"
]);

// ../src/modules/kernel/workflows/sealed-collections.ts
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

// ../src/modules/kernel/workflows/path-containment.ts
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

// ../src/modules/lifecycle/workflows/event-log-schema.ts
var TOOL_CALL_TOOL_VALUES = Object.freeze([
  "Read",
  "Write",
  "Edit",
  "Grep",
  "Glob",
  "Bash",
  "Agent",
  "Skill",
  "AskUserQuestion",
  "TaskCreate",
  "TaskUpdate",
  "TaskList",
  "WebFetch",
  "WebSearch",
  "NotebookEdit",
  "BashOutput",
  "KillShell"
]);
var HOOK_EVENT_NAMES = Object.freeze([
  "SessionStart",
  "SessionEnd",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "Notification",
  "Stop",
  "SubagentStop",
  "PreCompact",
  "TaskCreated",
  "TaskCompleted",
  "TeammateIdle"
]);
var EVENT_TYPES = sealSet([
  "phase_start",
  "phase_end",
  "specialist_dispatch",
  "specialist_receipt",
  "loop_round_start",
  "loop_round_end",
  "tool_call",
  "hook_event",
  "gate_decision",
  "assumption_logged",
  "escalation",
  "codex_review_round"
], "EVENT_TYPES");
var RUN_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
var LANE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
function isSafeRunId(id) {
  return RUN_ID_RE.test(id) && id !== "." && id !== "..";
}
function isSafeLaneId(id) {
  return LANE_ID_RE.test(id) && id !== "." && id !== "..";
}
function assertSafeRunId(id) {
  if (!isSafeRunId(id)) {
    throw new Error(`log-jsonl: invalid run_id ${JSON.stringify(id)}`);
  }
}
function assertSafeLaneId(id) {
  if (!isSafeLaneId(id)) {
    throw new Error(`log-jsonl: invalid lane_id ${JSON.stringify(id)}`);
  }
}
function validateEventIds(event) {
  assertSafeRunId(event.run_id);
  if ("lane_id" in event && event.lane_id !== void 0) {
    assertSafeLaneId(event.lane_id);
  }
}

// ../src/modules/lifecycle/workflows/event-log-writer.ts
var import_node_fs2 = require("node:fs");
var import_node_path2 = require("node:path");
var import_node_zlib = require("node:zlib");

// ../src/modules/security/workflows/safe-object.ts
var PROTO_POISON_KEYS = sealSet(["__proto__", "prototype", "constructor"], "PROTO_POISON_KEYS");

// ../src/modules/security/workflows/scrubbed-write.ts
var fs6 = __toESM(require("node:fs"));
var path6 = __toESM(require("node:path"));
var crypto = __toESM(require("node:crypto"));

// ../src/modules/security/workflows/redact-log.ts
var TOKEN_REDACTED = "[REDACTED_TOKEN]";
var PATH_REDACTED = "[REDACTED]";
var KV_REDACTED = "[REDACTED]";
var HIGH_ENTROPY_REDACTED = "<HIGH_ENTROPY_REDACTED>";
var TRUNCATION_SUFFIX = "... [TRUNCATED]";
var FIELD_SIZE_CAP_BYTES = 4 * 1024;
var TOKEN_SHAPE_PATTERNS = Object.freeze([
  Object.freeze(/Authorization:\s*Bearer\s+[A-Za-z0-9._\-+/=]+/g),
  Object.freeze(/\bBearer\s+[A-Za-z0-9._\-+/=]{16,}/g),
  Object.freeze(/\bsk-(ant-)?[A-Za-z0-9_-]{20,}/g),
  Object.freeze(/\bghp_[A-Za-z0-9]{36}\b/g),
  Object.freeze(/\bgh[suor]_[A-Za-z0-9]{36}\b/g),
  Object.freeze(/\bgithub_pat_[A-Za-z0-9_]{82}\b/g),
  Object.freeze(/\bxox[bp]-[A-Za-z0-9-]{10,}/g),
  Object.freeze(/\bAKIA[0-9A-Z]{16}\b/g),
  Object.freeze(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g)
]);
function redactTokenShapes(input) {
  let out = input;
  for (const re of TOKEN_SHAPE_PATTERNS) {
    out = out.replace(new RegExp(re.source, re.flags), TOKEN_REDACTED);
  }
  return out;
}
var SENSITIVE_HOME_DIRS = Object.freeze([
  ".claude",
  ".codex",
  ".ssh",
  ".aws",
  ".gnupg"
]);
var HOME_DIR_PATTERN = /(~|\/Users\/[^/\s]+|\/home\/[^/\s]+)\/(\.claude|\.codex|\.ssh|\.aws|\.gnupg)\/[^\s'"]+/g;
function redactHomeDirPaths(input) {
  return input.replace(HOME_DIR_PATTERN, (_match, root, dir) => {
    return `${root}/${dir}/${PATH_REDACTED}`;
  });
}
var KV_SECRET_PATTERN = /\b(password|token|api[_-]?key|secret|authorization|bearer)(\s*[:=]\s*)(\S+)/gi;
function redactKeyValueSecrets(input) {
  return input.replace(
    KV_SECRET_PATTERN,
    (_match, key, sep2) => `${key}${sep2}${KV_REDACTED}`
  );
}
var PATH_TOKEN_CHAR = /[A-Za-z0-9._/-]/;
var PATH_SHAPE = /^(?:\.{1,2}\/)?[A-Za-z0-9_][A-Za-z0-9._-]*(?:\/[A-Za-z0-9._-]+)+$/;
var DOT_GUILD_PATH_SHAPE = /^(?:\.{1,2}\/)?\.guild(?:\/[A-Za-z0-9._-]+)+$/;
var DOT_GUILD_ROOTS = /* @__PURE__ */ new Set([
  "agents",
  "artifacts",
  "context",
  "evolve",
  "indexes",
  "init",
  "initiatives",
  "knowledge",
  "loops",
  "memory",
  "plan",
  "prd",
  "raw",
  "reflections",
  "runs",
  "skills",
  "spec",
  "team",
  "teams",
  "wiki",
  "workflows",
  "workspace",
  "workspace-knowledge"
]);
var PATH_EXTENSION = /\.[A-Za-z0-9]{1,8}$/;
var MAX_PATH_TOKEN_LEN = 512;
function allWordsWordish(words) {
  let opaqueBudget = 1;
  for (const word of words) {
    if (word.length === 0 || word.length >= 20) return false;
    let upper = 0;
    let lower = 0;
    let digits = 0;
    for (const ch of word) {
      if (ch >= "a" && ch <= "z") lower++;
      else if (ch >= "A" && ch <= "Z") upper++;
      else digits++;
    }
    if (lower === 0) {
      if (word.length > 8) return false;
      if (word.length > 2 && --opaqueBudget < 0) return false;
    } else if (upper > 3 || digits > 4) {
      return false;
    }
  }
  return true;
}
function isSafeDotGuildToken(token) {
  const normalized = token.replace(/^(?:\.{1,2}\/)?\.guild\//, "");
  const root = normalized.split("/", 1)[0] ?? "";
  if (!DOT_GUILD_ROOTS.has(root)) return false;
  const runNormalized = normalized.replace(
    /(^|\/)run-\d{8}-\d{6}-/g,
    "$1run-"
  );
  const words = runNormalized.split(/[/._-]+/).filter(Boolean);
  let opaqueBudget = 1;
  let numericWords = 0;
  for (const word of words) {
    if (word.length === 0 || word.length >= 20) return false;
    if (/^[a-z][a-z0-9]*$/.test(word)) continue;
    if (/^\d+$/.test(word)) {
      numericWords += 1;
      if (numericWords > 3) return false;
      if (word.length > 2 && --opaqueBudget < 0) return false;
      continue;
    }
    if (/^[A-Z][A-Z0-9]{0,7}$/.test(word)) {
      if (word.length > 2 && --opaqueBudget < 0) return false;
      continue;
    }
    return false;
  }
  return true;
}
function isRelativePathToken(candidate, fullInput, matchIndex) {
  if (candidate.includes("+") || candidate.includes("=")) return false;
  let start = matchIndex;
  const startFloor = Math.max(0, matchIndex - MAX_PATH_TOKEN_LEN);
  while (start > startFloor && PATH_TOKEN_CHAR.test(fullInput[start - 1])) start--;
  if (start === startFloor && start > 0 && PATH_TOKEN_CHAR.test(fullInput[start - 1])) {
    return false;
  }
  let end = matchIndex + candidate.length;
  const endCeil = Math.min(fullInput.length, end + MAX_PATH_TOKEN_LEN);
  while (end < endCeil && PATH_TOKEN_CHAR.test(fullInput[end])) end++;
  if (end === endCeil && end < fullInput.length && PATH_TOKEN_CHAR.test(fullInput[end])) {
    return false;
  }
  const token = fullInput.slice(start, end);
  if (token.length > MAX_PATH_TOKEN_LEN) return false;
  const isDotGuildPath = DOT_GUILD_PATH_SHAPE.test(token);
  if (!PATH_SHAPE.test(token) && !isDotGuildPath) return false;
  const slashCount = token.split("/").length - 1;
  if (slashCount < 2 && !PATH_EXTENSION.test(token)) return false;
  if (isDotGuildPath) return isSafeDotGuildToken(token);
  return allWordsWordish(token.split(/[/._-]+/).filter(Boolean));
}
function isWhitelistedHighEntropy(candidate, fullInput, matchIndex) {
  if (matchIndex >= 4 && fullInput.slice(matchIndex - 4, matchIndex) === "run-") {
    return true;
  }
  const lookBackStart = Math.max(0, matchIndex - 16);
  const before = fullInput.slice(lookBackStart, matchIndex).toLowerCase();
  if (/\b(commit|sha|tree|parent|head|merge|object|branch)\s*[:=]?\s*$/.test(before)) {
    return true;
  }
  if (/^[0-9a-f]{40}$/.test(candidate) || /^[0-9a-f]{64}$/.test(candidate)) {
    return true;
  }
  if (isRelativePathToken(candidate, fullInput, matchIndex)) {
    return true;
  }
  return false;
}
var HIGH_ENTROPY_PATTERN = /[A-Za-z0-9+/=]{20,}/g;
function redactHighEntropy(input) {
  return input.replace(HIGH_ENTROPY_PATTERN, (match, offset) => {
    if (isWhitelistedHighEntropy(match, input, offset)) {
      return match;
    }
    return HIGH_ENTROPY_REDACTED;
  });
}
function truncateToCap(input, cap = FIELD_SIZE_CAP_BYTES) {
  const byteLen = Buffer.byteLength(input, "utf8");
  if (byteLen <= cap) return input;
  const buf = Buffer.from(input, "utf8");
  const truncated = buf.slice(0, cap).toString("utf8");
  const cleaned = truncated.replace(/\uFFFD+$/u, "");
  return cleaned + TRUNCATION_SUFFIX;
}
function redactField(input, cap = FIELD_SIZE_CAP_BYTES) {
  if (typeof input !== "string") return input;
  let out = redactTokenShapes(input);
  out = redactHomeDirPaths(out);
  out = redactKeyValueSecrets(out);
  out = redactHighEntropy(out);
  out = truncateToCap(out, cap);
  return out;
}
var REDACTABLE_FIELD_NAMES = Object.freeze([
  "command_redacted",
  "result_excerpt_redacted",
  "payload_excerpt_redacted",
  "prompt_excerpt",
  "assumption_text",
  "result"
]);
var REDACTABLE_FIELDS = sealSet(REDACTABLE_FIELD_NAMES, "REDACTABLE_FIELDS");
function redactEventFields(event, cap = FIELD_SIZE_CAP_BYTES) {
  const out = { ...event };
  for (const [k, v] of Object.entries(out)) {
    if (REDACTABLE_FIELDS.has(k) && typeof v === "string") {
      out[k] = redactField(v, cap);
    }
  }
  return out;
}

// ../src/modules/security/workflows/secrets.ts
function applySecretsPolicy(value, policy, opts) {
  if (typeof value !== "string") {
    return { value: typeof value === "string" ? value : String(value ?? ""), ok: true, failures: [] };
  }
  let out = redactField(value, opts?.noTruncate ? Number.POSITIVE_INFINITY : void 0);
  const failures = [];
  for (const pat of policy.redaction_patterns) {
    let re;
    try {
      re = new RegExp(pat, "g");
    } catch (err) {
      failures.push(`${pat}: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    try {
      out = out.replace(re, "[REDACTED]");
    } catch (err) {
      failures.push(`${pat}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { value: out, ok: failures.length === 0, failures };
}
function resolveTelemetryField(scrub, policy) {
  if (scrub.ok) return { value: scrub.value, warn: false };
  if (policy.fail_mode_telemetry === "closed") return { value: void 0, warn: true };
  return { value: scrub.value, warn: true };
}

// ../src/modules/security/workflows/config.ts
var fs4 = __toESM(require("node:fs"));
var path4 = __toESM(require("node:path"));

// ../src/modules/state/workflows/dependency-graph-schema.ts
var DEPENDENCY_GRAPH_SCHEMA_VERSION = "guild.dependency_graph.v1";
var DEPENDENCY_GRAPH_V1_EXAMPLE = deepFreeze({
  schema_version: DEPENDENCY_GRAPH_SCHEMA_VERSION,
  nodes: [
    { id: "guild-plugin", path: "plugin" },
    { id: "guild-website", path: "website" },
    { id: "guild-benchmark", path: "benchmark" }
  ],
  edges: [
    { from: "guild-website", to: "guild-plugin", reason: "docs the plugin surface" },
    { from: "guild-benchmark", to: "guild-plugin", reason: "evals the plugin behavior" }
  ]
});

// ../src/modules/state/workflows/guild-root.ts
var fs2 = __toESM(require("node:fs"));
var path2 = __toESM(require("node:path"));
function resolveGuildRoot2(startDir) {
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

// ../src/modules/migrations/workflows/index-migrate.ts
var import_node_child_process = require("node:child_process");
var fs3 = __toESM(require("node:fs"));
var path3 = __toESM(require("node:path"));
function openDatabase(dbPath) {
  const { DatabaseSync } = require("node:sqlite");
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA busy_timeout = 5000");
  return db;
}
var CURRENT_SCHEMA_VERSION = 3;
function resolveGuildRoot3(cwd) {
  try {
    const raw = (0, import_node_child_process.execFileSync)("git", ["rev-parse", "--git-common-dir"], {
      cwd,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
    const abs = path3.isAbsolute(raw) ? raw : path3.resolve(cwd, raw);
    const root = path3.dirname(abs);
    if (fs3.existsSync(root)) return root;
  } catch {
  }
  return path3.resolve(cwd);
}
var MIGRATIONS = [
  // ── v1: core tables ───────────────────────────────────────────────────────
  {
    version: 1,
    tables: ["kg_nodes", "kg_edges", "kl_edges", "run_provenance", "wiki_fts", "_fingerprints"],
    up(db) {
      db.exec(`
        DROP TABLE IF EXISTS kg_nodes;
        DROP TABLE IF EXISTS kg_edges;
        DROP TABLE IF EXISTS kl_edges;
        DROP TABLE IF EXISTS run_provenance;
        DROP TABLE IF EXISTS wiki_fts;
        DROP TABLE IF EXISTS _fingerprints;
      `);
      db.exec(`
        CREATE TABLE kg_nodes (
          id         TEXT NOT NULL PRIMARY KEY,
          type       TEXT,
          name       TEXT,
          source_refs TEXT,
          confidence TEXT,
          layer      TEXT,
          data       TEXT
        );

        CREATE TABLE kg_edges (
          id        INTEGER PRIMARY KEY,
          source    TEXT NOT NULL,
          target    TEXT NOT NULL,
          type      TEXT,
          direction TEXT,
          weight    REAL,
          data      TEXT
        );

        CREATE TABLE kl_edges (
          id        INTEGER PRIMARY KEY,
          from_node TEXT NOT NULL,
          to_node   TEXT NOT NULL,
          type      TEXT,
          run_id    TEXT,
          data      TEXT
        );

        CREATE TABLE run_provenance (
          run_id TEXT NOT NULL PRIMARY KEY,
          ts     TEXT,
          data   TEXT
        );

        CREATE TABLE _fingerprints (
          table_name   TEXT NOT NULL PRIMARY KEY,
          source_path  TEXT NOT NULL,
          sha256       TEXT NOT NULL,
          populated_at TEXT NOT NULL
        );
      `);
      try {
        db.exec(`
          CREATE VIRTUAL TABLE wiki_fts USING fts5(
            path      UNINDEXED,
            title,
            content,
            tokenize='porter ascii'
          );
        `);
      } catch {
        db.exec(`
          CREATE TABLE wiki_fts (
            path    TEXT,
            title   TEXT,
            content TEXT
          );
        `);
      }
    }
  },
  // ── v2: federation_wiki_cache (TE-14) ────────────────────────────────────
  //
  // Stores a flat BM25-ready snapshot of each federated sub-guild's wiki.
  // Primary key is (sub_guild_root, path) — one row per page per sub-guild.
  // Fingerprint key in _fingerprints: "federation_wiki_cache:<sub_guild_root>".
  //
  // BOUNDARY: this table ONLY lives in the workspace-root index.sqlite; no
  // production code writes to sub_guild_root/.guild/. NOTE: the populate/
  // invalidate function (ensureFederationWikiCache) was removed in
  // plugin-audit-remediation G5a (2026-07) as zero-consumer dead code — this
  // schema migration is retained (harmless empty table) since altering the
  // migration ladder is a separate, out-of-scope decision.
  {
    version: 2,
    tables: ["federation_wiki_cache"],
    up(db) {
      db.exec(`DROP TABLE IF EXISTS federation_wiki_cache;`);
      db.exec(`
        CREATE TABLE federation_wiki_cache (
          sub_guild_root TEXT NOT NULL,
          path           TEXT NOT NULL,
          title          TEXT,
          snippet        TEXT,
          PRIMARY KEY (sub_guild_root, path)
        );
      `);
    }
  },
  // ── v3: optional structural projection (T5.1 / G5) ───────────────────────
  //
  // Two OPTIONAL acceleration tables projected from the canonical, file-first
  // knowledge-graph.json (goals.md §G5). Both are pure, threshold-gated,
  // fingerprinted, fully-rebuildable caches: deleting index.sqlite loses
  // nothing, and `index: off` (in-process JSON BFS via lib/graph-query.ts)
  // remains the source of truth that returns IDENTICAL answers.
  //
  //   kg_calls       — denormalized `calls` edges (source, target, confidence),
  //                    indexed on source AND target so the call-graph BFS
  //                    (kgTrace / kgDeadCode) is fetched without parsing the
  //                    whole JSON graph.
  //   kg_symbols_fts — FTS5 over the camel/snake-split tokens of each named
  //                    node, so identifier search (`process_order` →
  //                    `processOrder`) is an index lookup, not a full node scan.
  //                    Tokens are PRE-SPLIT with the shared identifier-aware
  //                    tokenizer (bm25.ts:tokenizeIdentifierAware) on BOTH the
  //                    document and query side, so the FTS built-in tokenizer
  //                    only has to whitespace-split — the camel/snake behaviour
  //                    lives in the (deterministic, model-free) projection feed.
  {
    version: 3,
    tables: ["kg_calls", "kg_symbols_fts"],
    up(db) {
      db.exec(`
        DROP TABLE IF EXISTS kg_calls;
        DROP TABLE IF EXISTS kg_symbols_fts;
      `);
      db.exec(`
        CREATE TABLE kg_calls (
          id         INTEGER PRIMARY KEY,
          source     TEXT NOT NULL,
          target     TEXT NOT NULL,
          confidence TEXT
        );
        CREATE INDEX kg_calls_source ON kg_calls (source);
        CREATE INDEX kg_calls_target ON kg_calls (target);
      `);
      try {
        db.exec(`
          CREATE VIRTUAL TABLE kg_symbols_fts USING fts5(
            node_id UNINDEXED,
            name_tokens,
            tokenize='ascii'
          );
        `);
      } catch {
        db.exec(`
          CREATE TABLE kg_symbols_fts (
            node_id     TEXT,
            name_tokens TEXT
          );
        `);
      }
    }
  }
];
function runMigrations(dbPath) {
  let db;
  let fromVersion = 0;
  try {
    fs3.mkdirSync(path3.dirname(dbPath), { recursive: true });
    db = openDatabase(dbPath);
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA synchronous = NORMAL");
    fromVersion = db.prepare("PRAGMA user_version").get().user_version;
    for (const mig of MIGRATIONS) {
      if (mig.version <= fromVersion) continue;
      try {
        db.exec("BEGIN IMMEDIATE");
        mig.up(db);
        db.exec(`PRAGMA user_version = ${mig.version}`);
        db.exec("COMMIT");
        fromVersion = mig.version;
      } catch (err) {
        try {
          db.exec("ROLLBACK");
        } catch {
        }
        for (const tbl of mig.tables) {
          try {
            db.exec(`DROP TABLE IF EXISTS ${tbl}`);
          } catch {
          }
        }
        db.close();
        return {
          ok: false,
          fromVersion,
          toVersion: fromVersion,
          dbPath,
          message: `migration to v${mig.version} failed: ${err.message}`
        };
      }
    }
    db.close();
    return {
      ok: true,
      fromVersion,
      toVersion: CURRENT_SCHEMA_VERSION,
      dbPath
    };
  } catch (err) {
    try {
      db?.close();
    } catch {
    }
    return {
      ok: false,
      fromVersion,
      toVersion: fromVersion,
      dbPath,
      message: `migration runner error: ${err.message}`
    };
  }
}
function runIndexMigrateCli() {
  const argv = process.argv.slice(2);
  let cwd = process.env["GUILD_CWD"] ?? process.cwd();
  let dbPath;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--cwd" && argv[i + 1]) cwd = argv[++i];
    if (argv[i] === "--db-path" && argv[i + 1]) dbPath = argv[++i];
  }
  if (!dbPath) {
    const guildRoot = resolveGuildRoot3(cwd);
    dbPath = path3.join(guildRoot, ".guild", "index.sqlite");
  }
  const result = runMigrations(dbPath);
  if (result.ok) {
    process.stdout.write(
      `[index-migrate] OK: schema v${result.fromVersion}\u2192v${result.toVersion} at ${result.dbPath}
`
    );
  } else {
    process.stderr.write(`[index-migrate] WARN: ${result.message}
`);
    process.exit(1);
  }
}
if (typeof module !== "undefined" && require.main === module && /^index-migrate\.[cm]?[jt]s$/.test((process.argv[1] ?? "").split(/[\\/]/).pop() ?? "")) {
  runIndexMigrateCli();
}

// ../src/modules/migrations/workflows/wiki-importance.ts
var STRUCTURAL_BASENAMES = sealSet([
  "index.md",
  "readme.md",
  "log.md",
  "query.md",
  "transfer-manifest.md"
], "STRUCTURAL_BASENAMES");

// ../src/modules/security/workflows/config.ts
function securityDefaults() {
  return {
    bypass_permissions_policy: "audit",
    secrets_policy: {
      env_allowlist: [],
      redaction_patterns: [],
      fail_mode_durable: "closed",
      fail_mode_telemetry: "open"
    },
    tool_description_hashes: {},
    mcp_availability: {
      stdio_available: true,
      http_available: false,
      bridge_package: null
    },
    allowed_tools: []
  };
}
function isPlainObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function isStringArray(v) {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}
function parseSecurityConfig(parsed) {
  const out = securityDefaults();
  if (!isPlainObject(parsed)) return out;
  if (isPlainObject(parsed["security"])) {
    const bpp = parsed["security"]["bypass_permissions_policy"];
    if (bpp === "deny" || bpp === "audit" || bpp === "allow") {
      out.bypass_permissions_policy = bpp;
    }
  }
  if (isPlainObject(parsed["secrets_policy"])) {
    const sp = parsed["secrets_policy"];
    if (isStringArray(sp["env_allowlist"])) out.secrets_policy.env_allowlist = sp["env_allowlist"];
    if (isStringArray(sp["redaction_patterns"])) {
      out.secrets_policy.redaction_patterns = sp["redaction_patterns"];
    }
    if (sp["fail_mode_durable"] === "closed" || sp["fail_mode_durable"] === "open") {
      out.secrets_policy.fail_mode_durable = sp["fail_mode_durable"];
    }
    if (sp["fail_mode_telemetry"] === "open" || sp["fail_mode_telemetry"] === "closed") {
      out.secrets_policy.fail_mode_telemetry = sp["fail_mode_telemetry"];
    }
  }
  if (isPlainObject(parsed["defaults"])) {
    const defs = parsed["defaults"];
    if (isStringArray(defs["allowed_tools"])) {
      out.allowed_tools = defs["allowed_tools"];
    }
  }
  if (isPlainObject(parsed["mcp"])) {
    const mcp = parsed["mcp"];
    if (isPlainObject(mcp["tool_description_hashes"])) {
      const hashes = {};
      for (const [k, v] of Object.entries(mcp["tool_description_hashes"])) {
        if (typeof v === "string") hashes[k] = v;
      }
      out.tool_description_hashes = hashes;
    }
    if (typeof mcp["stdio_available"] === "boolean") {
      out.mcp_availability.stdio_available = mcp["stdio_available"];
    }
    if (typeof mcp["http_available"] === "boolean") {
      out.mcp_availability.http_available = mcp["http_available"];
    }
    if (mcp["bridge_package"] === null || typeof mcp["bridge_package"] === "string") {
      out.mcp_availability.bridge_package = mcp["bridge_package"];
    }
  }
  return out;
}
function readSecurityConfig(cwd) {
  const settingsPath = path4.join(resolveGuildRoot2(cwd), ".guild", "settings.json");
  let raw;
  try {
    raw = fs4.readFileSync(settingsPath, "utf8");
  } catch {
    return securityDefaults();
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return securityDefaults();
  }
  return parseSecurityConfig(parsed);
}

// ../src/modules/security/workflows/events.ts
var fs5 = __toESM(require("node:fs"));
var path5 = __toESM(require("node:path"));
var SECURITY_EVENT_SCHEMA_VERSION = "guild.security_event.v1";
var KNOWN_GUILD_HOST_KINDS = Object.freeze([
  "claude-code-cli",
  "codex-cli",
  "pi-cli",
  "antigravity-cli",
  "agents-file",
  "claude-code-app",
  "claude-code-web",
  "codex-app",
  "claude-ai-connector"
]);
var KNOWN_GUILD_HOST_ID_SET = new Set(KNOWN_GUILD_HOST_KINDS);
var LEGACY_HOST_ALIASES = {
  claude: "claude-code-cli",
  "claude-code-desktop": "claude-code-app",
  codex: "codex-cli",
  "codex-plugin": "codex-cli",
  agents: "agents-file",
  ".agents": "agents-file",
  pi: "pi-cli",
  antigravity: "antigravity-cli",
  "antigravity-2": "antigravity-cli"
};
function normalizeSecurityHostId(value) {
  const s = value.trim();
  if (KNOWN_GUILD_HOST_ID_SET.has(s)) return s;
  return LEGACY_HOST_ALIASES[s] ?? null;
}
function resolveHostResolution(env) {
  const explicit = (env["GUILD_HOST_ID"] ?? "").trim();
  if (explicit.length > 0) return { id: explicit, degraded: false, rawUnknown: "" };
  const rawHost = (env["GUILD_HOST"] ?? "").trim().toLowerCase();
  if (rawHost.length === 0) return { id: "claude-code-cli", degraded: false, rawUnknown: "" };
  const normalized = normalizeSecurityHostId(rawHost);
  if (normalized) return { id: normalized, degraded: false, rawUnknown: "" };
  return { id: rawHost, degraded: true, rawUnknown: rawHost };
}
function resolveHostId() {
  return resolveHostResolution(process.env).id;
}
function buildSecurityEvent(input) {
  const rec = {
    schema_version: SECURITY_EVENT_SCHEMA_VERSION,
    ts: (/* @__PURE__ */ new Date()).toISOString(),
    run_id: input.run_id,
    event_type: input.event_type,
    decision: input.decision,
    tool: input.tool,
    detail: redactField(input.detail ?? ""),
    host: typeof input.host === "string" && input.host.length > 0 ? input.host : resolveHostId()
  };
  if (typeof input.lane_id === "string" && input.lane_id.length > 0) rec.lane_id = input.lane_id;
  if (input.policy !== void 0) rec.policy = input.policy;
  if (typeof input.permission_mode === "string" && input.permission_mode.length > 0) {
    rec.permission_mode = input.permission_mode;
  }
  if (typeof input.dispatch_rung === "string" && input.dispatch_rung.length > 0) {
    rec.dispatch_rung = input.dispatch_rung;
  }
  return rec;
}
function appendSecurityEvent(runDir2, record) {
  try {
    const logsDir = path5.join(runDir2, "logs");
    fs5.mkdirSync(logsDir, { recursive: true });
    fs5.appendFileSync(path5.join(logsDir, "security-events.jsonl"), JSON.stringify(record) + "\n", "utf8");
    return true;
  } catch (err) {
    process.stderr.write(
      `warn: [security-events] write failed: ${err instanceof Error ? err.message : String(err)}
`
    );
    return false;
  }
}

// ../src/modules/security/workflows/scrubbed-write.ts
function guildRootFromRunDir(runDir2) {
  return path6.resolve(runDir2, "../../..");
}
function writeScrubApprovalRequest(runDir2, runId, surface, outPath, laneId2) {
  try {
    const approvalDir = path6.join(runDir2, "agent-bus", "approvals");
    fs6.mkdirSync(approvalDir, { recursive: true });
    const ts = (/* @__PURE__ */ new Date()).toISOString();
    const safeTs = ts.replace(/[:.]/g, "-");
    const fileName = `${safeTs}-scrub-blocked.json`;
    const record = {
      schema_version: "guild.approval_request.v1",
      ts,
      run_id: runId,
      tool: "scrubbedWrite",
      reason: `Secret scrub failed for durable surface "${surface}" \u2014 write blocked. Human review required. Path: ${path6.basename(outPath)}`,
      permission_mode: "blocked",
      surface
    };
    if (laneId2) record["lane_id"] = laneId2;
    const rawContent = JSON.stringify(record, null, 2) + "\n";
    let content = rawContent;
    try {
      const secConfig = readSecurityConfig(guildRootFromRunDir(runDir2));
      const scrubResult = applySecretsPolicy(rawContent, secConfig.secrets_policy, { noTruncate: true });
      content = scrubResult.value;
    } catch {
    }
    fs6.writeFileSync(path6.join(approvalDir, fileName), content, "utf8");
  } catch {
  }
}
function scrubbedWrite(outPath, content, opts) {
  const guildRoot = guildRootFromRunDir(opts.runDir);
  let policy;
  try {
    const secConfig = readSecurityConfig(guildRoot);
    policy = secConfig.secrets_policy;
  } catch {
    policy = {
      env_allowlist: [],
      redaction_patterns: [],
      fail_mode_durable: "closed",
      fail_mode_telemetry: "open"
    };
  }
  const scrubResult = applySecretsPolicy(content, policy, { noTruncate: true });
  const failMode = opts.surface === "telemetry" ? policy.fail_mode_telemetry : policy.fail_mode_durable;
  if (scrubResult.ok) {
    try {
      fs6.mkdirSync(path6.dirname(outPath), { recursive: true });
      fs6.writeFileSync(outPath, scrubResult.value, "utf8");
    } catch (err) {
      process.stderr.write(
        `[scrubbed-write] ERROR: write failed for surface "${opts.surface}" at ${outPath}: ${err instanceof Error ? err.message : String(err)}
`
      );
      return { written: false, blocked: false };
    }
    const result = { written: true, blocked: false };
    if (opts.surface === "bus") {
      result.sha256 = crypto.createHash("sha256").update(scrubResult.value, "utf8").digest("hex");
    }
    return result;
  }
  if (failMode === "open") {
    process.stderr.write(
      `[scrubbed-write] WARN: secret scrub custom-pattern failure for surface "${opts.surface}" at ${path6.basename(outPath)} \u2014 writing built-in-redacted content (fail-open). Failures: ${scrubResult.failures.join("; ")}
`
    );
    try {
      fs6.mkdirSync(path6.dirname(outPath), { recursive: true });
      fs6.writeFileSync(outPath, scrubResult.value, "utf8");
    } catch (err) {
      process.stderr.write(
        `[scrubbed-write] ERROR: fail-open write failed: ${err instanceof Error ? err.message : String(err)}
`
      );
      return { written: false, blocked: false };
    }
    try {
      const evt = buildSecurityEvent({
        run_id: opts.runId,
        lane_id: opts.laneId,
        event_type: "secret_scrub_blocked",
        decision: "degraded",
        tool: "scrubbedWrite",
        detail: `Secret scrub custom-pattern failure (fail-open) for surface "${opts.surface}" at ${path6.basename(outPath)}. Built-in-redacted content written.`,
        permission_mode: "degraded"
      });
      appendSecurityEvent(opts.runDir, evt);
    } catch {
    }
    const result = { written: true, blocked: false };
    if (opts.surface === "bus") {
      result.sha256 = crypto.createHash("sha256").update(scrubResult.value, "utf8").digest("hex");
    }
    return result;
  }
  process.stderr.write(
    `[scrubbed-write] BLOCKED: secret scrub failed for durable surface "${opts.surface}" at ${outPath} \u2014 file NOT written. Failures: ${scrubResult.failures.join("; ")}
`
  );
  try {
    const evt = buildSecurityEvent({
      run_id: opts.runId,
      lane_id: opts.laneId,
      event_type: "secret_scrub_blocked",
      decision: "blocked",
      tool: "scrubbedWrite",
      detail: `Secret scrub failed for durable surface "${opts.surface}" at ${path6.basename(outPath)} \u2014 write blocked (fail-closed).`,
      permission_mode: "blocked"
    });
    appendSecurityEvent(opts.runDir, evt);
  } catch {
  }
  writeScrubApprovalRequest(opts.runDir, opts.runId, opts.surface, outPath, opts.laneId);
  return { written: false, blocked: true };
}

// ../src/modules/security/workflows/share-set.ts
var SHARED_SCRUBBED_NAMES = sealSet([
  "verify.md",
  "review.md",
  "provenance.json",
  "summary.md",
  "run.yaml",
  "run-state.json"
], "SHARED_SCRUBBED_NAMES");

// ../src/modules/security/workflows/secret-patterns.ts
var SECRET_PATTERNS = Object.freeze([
  // NOTE: labels deliberately drop the `=` so the redaction replacement
  // (e.g. `<REDACTED:password-assignment>`) cannot itself re-match the pattern
  // on a subsequent scrub pass. Idempotency depends on this — every label below
  // is checked against every pattern above it, and none re-matches.
  Object.freeze([Object.freeze(/password\s*=\s*["']?[^\s"']{6,}/), "password-assignment"]),
  Object.freeze([Object.freeze(/api_key\s*=\s*["']?[^\s"']{6,}/i), "api_key-assignment"]),
  Object.freeze([Object.freeze(/secret\s*=\s*["']?[^\s"']{8,}/i), "secret-assignment"]),
  Object.freeze([Object.freeze(/AKIA[0-9A-Z]{16}/), "AWS access key"]),
  Object.freeze([Object.freeze(/AIza[0-9A-Za-z_-]{35}/), "GCP API key"]),
  Object.freeze([Object.freeze(/ghp_[0-9A-Za-z]{36}/), "GitHub personal access token"]),
  Object.freeze([Object.freeze(/ghs_[0-9A-Za-z]{36}/), "GitHub server token"]),
  Object.freeze([Object.freeze(/-----BEGIN (?:RSA |EC )?PRIVATE KEY/), "PEM private key block"]),
  // ── Provider credential / bearer-token forms (T6B-R1-B1) ─────────────────
  // Round-1 review proved the list above blind to the shapes an inspection
  // surface is most likely to echo out of a persisted artifact: an
  // `Authorization: Bearer …` header, a `sk-…` provider key, and the
  // `<something>_token = …` assignment family. A display surface that renders
  // a persisted evidence string verbatim leaked all three past the applier.
  //
  // Every pattern is anchored on the CREDENTIAL PREFIX (not on entropy) so it
  // stays specific, and each replacement label is inert against every pattern
  // in this list (no whitespace/`:`/`=` follows the trigger word in a label),
  // which is what keeps `redact` idempotent.
  Object.freeze([Object.freeze(/\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/i), "bearer-token"]),
  Object.freeze([Object.freeze(/\bauthorization\s*:\s*["']?[A-Za-z0-9._~+/=-]{12,}/i), "authorization-header"]),
  Object.freeze([Object.freeze(/\b(?:auth|access|refresh|id|api|bearer|session)[-_]?token\s*[:=]\s*["']?[^\s"',]{8,}/i), "token-assignment"]),
  // OpenAI/Anthropic-style provider keys: sk-…, sk-proj-…, sk-ant-….
  Object.freeze([Object.freeze(/\bsk-[A-Za-z0-9_-]{12,}/), "provider-api-key"]),
  Object.freeze([Object.freeze(/\bxox[abprs]-[A-Za-z0-9-]{10,}/), "Slack token"]),
  Object.freeze([Object.freeze(/\bgh[uor]_[0-9A-Za-z]{36}/), "GitHub token"]),
  Object.freeze([Object.freeze(/\bglpat-[0-9A-Za-z_-]{20}/), "GitLab personal access token"]),
  Object.freeze([Object.freeze(/\bnpm_[0-9A-Za-z]{36}/), "npm token"]),
  Object.freeze([Object.freeze(/\bhf_[0-9A-Za-z]{34}/), "HuggingFace token"]),
  // High-entropy string heuristic: 40+ hex chars (SHA-like)
  Object.freeze([Object.freeze(/\b[0-9a-f]{40,}\b/), "high-entropy hex string (potential secret)"])
]);

// ../src/modules/lifecycle/workflows/stable-lock.ts
var import_node_fs = require("node:fs");
var import_node_path = require("node:path");
function stableLockPath(runDir2) {
  return (0, import_node_path.join)(runDir2, "logs", ".lock");
}
function exclusionSentinelPath(runDir2) {
  return (0, import_node_path.join)(runDir2, "logs", ".lock.exclusion");
}
function initStableLockfile(runDir2) {
  const path13 = stableLockPath(runDir2);
  (0, import_node_fs.mkdirSync)((0, import_node_path.dirname)(path13), { recursive: true });
  if ((0, import_node_fs.existsSync)(path13)) return;
  try {
    const fd = (0, import_node_fs.openSync)(path13, "wx");
    (0, import_node_fs.closeSync)(fd);
  } catch (err) {
    if (err?.code !== "EEXIST") throw err;
  }
}
var DEFAULT_BACKOFF_MS = [2, 5, 10, 25, 50, 100, 200];
var DEFAULT_TIMEOUT_MS = 5e3;
function sleepSyncMs(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
  }
}
function withStableLock(runDir2, fn, opts = {}) {
  initStableLockfile(runDir2);
  const sentinel = exclusionSentinelPath(runDir2);
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const backoff = opts.backoffMs ?? DEFAULT_BACKOFF_MS;
  const start = Date.now();
  let attempt = 0;
  for (; ; ) {
    try {
      const fd = (0, import_node_fs.openSync)(sentinel, "wx");
      try {
        (0, import_node_fs.writeSync)(fd, `${process.pid}
`);
      } catch {
      }
      (0, import_node_fs.closeSync)(fd);
      try {
        return fn();
      } finally {
        try {
          (0, import_node_fs.unlinkSync)(sentinel);
        } catch {
        }
      }
    } catch (err) {
      const code = err?.code;
      if (code !== "EEXIST") throw err;
      if (Date.now() - start > timeoutMs) {
        throw new Error(
          `v1.4-lock: timed out waiting for ${sentinel} (${timeoutMs}ms). Stale lock? Remove the file if you are sure no other process holds it.`
        );
      }
      const idx = Math.min(attempt, backoff.length - 1);
      sleepSyncMs(backoff[idx]);
      attempt += 1;
    }
  }
}

// ../src/modules/lifecycle/workflows/trace-v2.ts
var crypto2 = __toESM(require("crypto"));
var SIDECAR_MAX_BYTES = 16 * 1024;
function genSpanId(runId, eventType, ts, actorId) {
  const material = `${runId}|${eventType}|${ts}|${actorId || "main"}`;
  return crypto2.createHash("sha256").update(material).digest("hex").slice(0, 16);
}
function num(v) {
  return typeof v === "number" && Number.isFinite(v) ? v : void 0;
}
function normalizeTokens(raw) {
  if (raw === null || typeof raw !== "object") return void 0;
  const r = raw;
  const out = {};
  const input = num(r["input"]) ?? num(r["input_tokens"]);
  const output = num(r["output"]) ?? num(r["output_tokens"]);
  const cached = num(r["cached"]) ?? num(r["cache_read_input_tokens"]) ?? num(r["cached_tokens"]);
  const cost = num(r["cost_usd"]) ?? num(r["cost"]);
  if (input !== void 0) out.input = input;
  if (output !== void 0) out.output = output;
  if (cached !== void 0) out.cached = cached;
  if (cost !== void 0) out.cost_usd = cost;
  return Object.keys(out).length > 0 ? out : void 0;
}
function envStr(env, key) {
  const v = env[key];
  return typeof v === "string" && v.length > 0 ? v : void 0;
}
function resolveTraceV2Fields(opts) {
  const env = opts.env ?? process.env;
  const out = {
    span_id: genSpanId(opts.runId, opts.eventType, opts.ts, opts.actorId)
  };
  const parent = envStr(env, "GUILD_PARENT_SPAN_ID");
  if (parent !== void 0) out.parent_span_id = parent;
  const tier = envStr(env, "GUILD_TIER");
  if (tier !== void 0) out.tier = tier;
  const model = envStr(env, "GUILD_MODEL") ?? opts.payloadModel;
  if (typeof model === "string" && model.length > 0) out.model = model;
  if (opts.tokens !== void 0) out.tokens = opts.tokens;
  const taskCellInstance = envStr(env, "GUILD_TASK_CELL_INSTANCE_ID");
  if (taskCellInstance !== void 0) out.task_cell_instance_id = taskCellInstance;
  if (typeof opts.payloadRef === "string" && opts.payloadRef.length > 0) {
    out.payload_ref = opts.payloadRef;
  }
  return out;
}
function pruneUndefined(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== void 0) out[k] = v;
  }
  return out;
}

// ../src/modules/lifecycle/workflows/event-log-writer.ts
function liveLogPath(runDir2) {
  return (0, import_node_path2.join)(runDir2, "logs", "v1.4-events.jsonl");
}
function archiveDir(runDir2) {
  return (0, import_node_path2.join)(runDir2, "logs", "archive");
}
function archivePath(runDir2, n) {
  return (0, import_node_path2.join)(archiveDir(runDir2), `v1.4-events.${n}.jsonl.gz`);
}
function sidecarPath(runDir2) {
  return (0, import_node_path2.join)(runDir2, "logs", "tool-call-pre.jsonl");
}
function laneFallbackPath(runDir2, laneId2) {
  if (!isSafeLaneId(laneId2)) {
    throw new Error(`log-jsonl: invalid lane_id ${JSON.stringify(laneId2)}`);
  }
  return (0, import_node_path2.join)(runDir2, "logs", `lane-${laneId2}-events.jsonl`);
}
var ROTATION_THRESHOLD_BYTES = 10 * 1024 * 1024;
function appendEvent(runDir2, event, opts = {}) {
  validateEventIds(event);
  const cap = opts.fieldCap;
  const redacted = redactEventFields(event, cap);
  const withV2 = opts.traceV2 !== void 0 ? { ...redacted, ...pruneUndefined(opts.traceV2) } : redacted;
  const line = JSON.stringify(withV2) + "\n";
  if (opts.forceFallback || process.platform === "win32") {
    const laneId2 = opts.laneId ?? "global";
    const path13 = laneFallbackPath(runDir2, laneId2);
    (0, import_node_fs2.mkdirSync)((0, import_node_path2.dirname)(path13), { recursive: true });
    const fd = (0, import_node_fs2.openSync)(path13, "a");
    try {
      (0, import_node_fs2.writeSync)(fd, line);
    } finally {
      (0, import_node_fs2.closeSync)(fd);
    }
    return;
  }
  const live = liveLogPath(runDir2);
  (0, import_node_fs2.mkdirSync)((0, import_node_path2.dirname)(live), { recursive: true });
  withStableLock(runDir2, () => {
    const fd = (0, import_node_fs2.openSync)(live, "a");
    try {
      (0, import_node_fs2.writeSync)(fd, line);
    } finally {
      (0, import_node_fs2.closeSync)(fd);
    }
    maybeRotateLocked(runDir2, opts.rotationThresholdBytes ?? ROTATION_THRESHOLD_BYTES);
  });
}
function nextRotationIndex(runDir2) {
  const dir = archiveDir(runDir2);
  if (!(0, import_node_fs2.existsSync)(dir)) return 1;
  let max = 0;
  for (const entry of (0, import_node_fs2.readdirSync)(dir)) {
    const m = /^v1\.4-events\.(\d+)\.jsonl\.gz$/.exec(entry);
    if (m && m[1] !== void 0) {
      const n = Number.parseInt(m[1], 10);
      if (Number.isFinite(n) && n > max) max = n;
    }
  }
  return max + 1;
}
function maybeRotateLocked(runDir2, thresholdBytes) {
  const live = liveLogPath(runDir2);
  if (!(0, import_node_fs2.existsSync)(live)) return;
  const size = (0, import_node_fs2.statSync)(live).size;
  if (size < thresholdBytes) return;
  rotateLocked(runDir2);
}
function rotateLocked(runDir2) {
  const live = liveLogPath(runDir2);
  const archive = archiveDir(runDir2);
  (0, import_node_fs2.mkdirSync)(archive, { recursive: true });
  const n = nextRotationIndex(runDir2);
  const stagingPath = (0, import_node_path2.join)(archive, `v1.4-events.${n}.jsonl`);
  const finalArchive = archivePath(runDir2, n);
  (0, import_node_fs2.renameSync)(live, stagingPath);
  const raw = (0, import_node_fs2.readFileSync)(stagingPath);
  const gzipped = (0, import_node_zlib.gzipSync)(raw);
  (0, import_node_fs2.writeFileSync)(finalArchive, gzipped);
  (0, import_node_fs2.unlinkSync)(stagingPath);
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const fd = (0, import_node_fs2.openSync)(live, "wx");
      (0, import_node_fs2.closeSync)(fd);
      return;
    } catch (err) {
      const code = err?.code;
      if (code !== "EEXIST") throw err;
      try {
        (0, import_node_fs2.unlinkSync)(live);
      } catch {
      }
    }
  }
  throw new Error(
    `log-jsonl: failed to recreate live log at ${live} with O_EXCL after 5 retries`
  );
}

// ../src/modules/lifecycle/workflows/event-log-sidecar.ts
var import_node_fs3 = require("node:fs");
var SIDECAR_MAX_BYTES2 = 1024 * 1024;
function sidecarKeyMatches(entry, key) {
  if (entry.run_id !== key.run_id) return false;
  if (entry.tool !== key.tool) return false;
  if ((entry.lane_id ?? void 0) !== (key.lane_id ?? void 0)) return false;
  if (key.post_ts !== void 0) {
    const preMs = Date.parse(entry.ts_pre);
    const postMs = Date.parse(key.post_ts);
    if (Number.isFinite(preMs) && Number.isFinite(postMs) && preMs >= postMs) {
      return false;
    }
  }
  return true;
}
function consumeSidecarPre(runDir2, matchOrCallId) {
  const path13 = sidecarPath(runDir2);
  if (!(0, import_node_fs3.existsSync)(path13)) return null;
  const apply = (text) => {
    const lines = text.split("\n");
    const parsedLines = [];
    for (const raw of lines) {
      if (raw.length === 0) continue;
      try {
        parsedLines.push({ raw, parsed: JSON.parse(raw) });
      } catch {
        parsedLines.push({ raw, parsed: null });
      }
    }
    let pickIdx = -1;
    let pickTs = Number.POSITIVE_INFINITY;
    for (let i = 0; i < parsedLines.length; i++) {
      const p = parsedLines[i];
      if (!p || p.parsed === null) continue;
      const eligible = typeof matchOrCallId === "string" ? p.parsed.call_id === matchOrCallId : sidecarKeyMatches(p.parsed, matchOrCallId);
      if (!eligible) continue;
      const ts = Date.parse(p.parsed.ts_pre);
      const tsForSort = Number.isFinite(ts) ? ts : Number.POSITIVE_INFINITY;
      if (tsForSort < pickTs) {
        pickTs = tsForSort;
        pickIdx = i;
      }
    }
    let match = null;
    const remainingLines = [];
    for (let i = 0; i < parsedLines.length; i++) {
      const p = parsedLines[i];
      if (!p) continue;
      if (i === pickIdx && p.parsed !== null) {
        match = p.parsed;
        continue;
      }
      remainingLines.push(p.raw);
    }
    const rest = remainingLines.length === 0 ? "" : remainingLines.join("\n") + "\n";
    return { match, rest };
  };
  if (process.platform === "win32") {
    const text = (0, import_node_fs3.readFileSync)(path13, "utf8");
    const { match, rest } = apply(text);
    (0, import_node_fs3.writeFileSync)(path13, rest);
    return match;
  }
  return withStableLock(runDir2, () => {
    const text = (0, import_node_fs3.readFileSync)(path13, "utf8");
    const { match, rest } = apply(text);
    (0, import_node_fs3.writeFileSync)(path13, rest);
    return match;
  });
}
function buildToolCallFromPair(pre, post) {
  const tsPostMs = Date.parse(post.ts_post);
  const tsPreMs = Date.parse(pre.ts_pre);
  const latency = Number.isFinite(tsPostMs) && Number.isFinite(tsPreMs) ? Math.max(0, tsPostMs - tsPreMs) : 0;
  const out = {
    ts: post.ts_post,
    event: "tool_call",
    run_id: post.run_id,
    tool: pre.tool,
    command_redacted: pre.command_redacted,
    status: post.status,
    latency_ms: latency,
    result_excerpt_redacted: post.result_excerpt_redacted
  };
  if (pre.lane_id !== void 0) out.lane_id = pre.lane_id;
  if (post.tokens_in !== void 0) out.tokens_in = post.tokens_in;
  if (post.tokens_out !== void 0) out.tokens_out = post.tokens_out;
  return out;
}
var ORPHAN_RESULT_EXCERPT = "<orphaned \u2014 pre/post pairing failed>";
var ORPHAN_LATENCY_MS = -1;
function buildOrphanedToolCall(pre) {
  const out = {
    ts: pre.ts_pre,
    event: "tool_call",
    run_id: pre.run_id,
    tool: pre.tool,
    command_redacted: pre.command_redacted,
    status: "err",
    latency_ms: ORPHAN_LATENCY_MS,
    result_excerpt_redacted: ORPHAN_RESULT_EXCERPT
  };
  if (pre.lane_id !== void 0) out.lane_id = pre.lane_id;
  return out;
}
function buildToolCallFromPostOnly(opts) {
  const out = {
    ts: opts.ts_post,
    event: "tool_call",
    run_id: opts.run_id,
    tool: opts.tool,
    command_redacted: "",
    status: "ok",
    latency_ms: typeof opts.latency_ms_override === "number" ? opts.latency_ms_override : 0,
    result_excerpt_redacted: opts.result_excerpt_redacted
  };
  if (opts.lane_id !== void 0) out.lane_id = opts.lane_id;
  if (opts.tokens_in !== void 0) out.tokens_in = opts.tokens_in;
  if (opts.tokens_out !== void 0) out.tokens_out = opts.tokens_out;
  return out;
}
function sweepOrphanedSidecarFull(runDir2, nowMs = Date.now(), maxAgeMs = 5 * 60 * 1e3) {
  const path13 = sidecarPath(runDir2);
  if (!(0, import_node_fs3.existsSync)(path13)) return { orphans: [], events: [] };
  const apply = (text) => {
    const lines = text.split("\n");
    const orphans2 = [];
    const kept = [];
    for (const raw of lines) {
      if (raw.length === 0) continue;
      try {
        const parsed = JSON.parse(raw);
        const tsMs = Date.parse(parsed.ts_pre);
        if (Number.isFinite(tsMs) && nowMs - tsMs > maxAgeMs) {
          orphans2.push(parsed);
          continue;
        }
        kept.push(raw);
      } catch {
        continue;
      }
    }
    const rest = kept.length === 0 ? "" : kept.join("\n") + "\n";
    return { orphans: orphans2, rest };
  };
  let orphans;
  if (process.platform === "win32") {
    const text = (0, import_node_fs3.readFileSync)(path13, "utf8");
    const out = apply(text);
    (0, import_node_fs3.writeFileSync)(path13, out.rest);
    orphans = out.orphans;
  } else {
    orphans = withStableLock(runDir2, () => {
      const text = (0, import_node_fs3.readFileSync)(path13, "utf8");
      const out = apply(text);
      (0, import_node_fs3.writeFileSync)(path13, out.rest);
      return out.orphans;
    });
  }
  const events = orphans.map(buildOrphanedToolCall);
  return { orphans, events };
}

// lib/dispatch-attribution.ts
var GENERIC_SUBAGENT_TYPE = "general-purpose";
var DEF_PATH_RE = /^\.guild\/agents\/([A-Za-z0-9._-]+)\.md$/;
var SAFE_ROLE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
var DEFINITION_MARKER_RE = /^GUILD_AGENT_DEFINITION=(\S+)$/;
var PRODUCER_MARKER_HEAD = "GUILD_DISPATCH_PRODUCER=";
var PRODUCER_MARKER_VALUE_RE = /^guild\.dispatch\.v\d+$/;
var PRODUCER_MARKER_TOKEN_RE = /^[A-Za-z][A-Za-z0-9_]*=[^\s]+$/;
function producerMarkerRole(firstLine) {
  if (!firstLine.startsWith(PRODUCER_MARKER_HEAD)) return void 0;
  const tokens = firstLine.split(/\s+/).filter((t) => t.length > 0);
  if (tokens.length === 0) return void 0;
  const value = tokens[0].slice(PRODUCER_MARKER_HEAD.length);
  if (!PRODUCER_MARKER_VALUE_RE.test(value)) return void 0;
  let role;
  for (let i = 1; i < tokens.length; i++) {
    const t = tokens[i];
    if (!PRODUCER_MARKER_TOKEN_RE.test(t)) return void 0;
    const eq = t.indexOf("=");
    const k = t.slice(0, eq);
    if (k === "role") {
      if (role !== void 0) return void 0;
      role = t.slice(eq + 1);
    }
  }
  return safeRole(role);
}
var LANE_SIGNATURE_HEAD_CHARS = 300;
function safeRole(v) {
  return v !== void 0 && SAFE_ROLE_RE.test(v) ? v : void 0;
}
function envStr2(env, key) {
  const v = env[key];
  return typeof v === "string" && v.length > 0 ? v : void 0;
}
function resolveDispatchAttribution(toolInput) {
  if (toolInput === null || typeof toolInput !== "object") return null;
  const ti = toolInput;
  if (!("subagent_type" in ti) && !("prompt" in ti)) return null;
  const subagentType = typeof ti.subagent_type === "string" ? ti.subagent_type : "";
  const prompt = typeof ti.prompt === "string" ? ti.prompt : "";
  const env = ti.env !== null && typeof ti.env === "object" ? ti.env : {};
  const definitionPathRaw = envStr2(env, "GUILD_AGENT_DEFINITION");
  const definitionPath = definitionPathRaw?.trim();
  const taskId = envStr2(env, "GUILD_TASK_ID");
  const specialistEnv = safeRole(envStr2(env, "GUILD_SPECIALIST"));
  const firstLine = (prompt.split("\n", 1)[0] ?? "").trim();
  const markerPath = DEFINITION_MARKER_RE.exec(firstLine)?.[1];
  const markerRole = safeRole(
    markerPath !== void 0 ? DEF_PATH_RE.exec(markerPath)?.[1] : void 0
  );
  const producerMarkerRoleValue = producerMarkerRole(firstLine);
  const head = prompt.slice(0, LANE_SIGNATURE_HEAD_CHARS);
  const hasAdoptionPrompt = markerRole !== void 0;
  const defMatch = definitionPath !== void 0 && definitionPath.length > 0 ? DEF_PATH_RE.exec(definitionPath) : null;
  const defRole = safeRole(defMatch?.[1]);
  const hasValidDefinition = defMatch !== null && defRole !== void 0 && (specialistEnv === void 0 || defRole === specialistEnv);
  const roles = [specialistEnv, defRole, markerRole, producerMarkerRoleValue].filter(
    (r) => r !== void 0
  );
  const hasConsistentIdentity = roles.every((r) => r === roles[0]);
  const specialist = specialistEnv ?? defRole ?? markerRole ?? producerMarkerRoleValue;
  const promptTeammate = /teammate for run-id/i.test(head);
  const isComposedLane = taskId !== void 0 && specialistEnv !== void 0;
  const isMisclassedGenericMarker = subagentType === GENERIC_SUBAGENT_TYPE && producerMarkerRoleValue !== void 0;
  const isSpecialistLane = hasAdoptionPrompt || isComposedLane || isMisclassedGenericMarker;
  const hasLaneSignature = isSpecialistLane || promptTeammate || taskId !== void 0 || specialistEnv !== void 0 || // G3 — the universal producer marker is a lane signature (not adoption proof,
  // so it stays out of isSpecialistLane / the #58 persona-strip predicate).
  producerMarkerRoleValue !== void 0;
  const out = {
    subagentType,
    isGeneric: subagentType === GENERIC_SUBAGENT_TYPE,
    isSpecialistLane,
    hasAdoptionPrompt,
    hasValidDefinition,
    hasConsistentIdentity,
    hasLaneSignature
  };
  if (specialist !== void 0) out.specialist = specialist;
  if (definitionPath !== void 0) out.definitionPath = definitionPath;
  if (taskId !== void 0) out.taskId = taskId;
  return out;
}

// lib/lane-attribution.ts
var UNATTRIBUTED_WORKER_LANE_ID = "unattributed-worker";
function isWorkerInvocation(env = process.env) {
  const laneId2 = env["GUILD_LANE_ID"];
  const taskId = env["GUILD_TASK_ID"];
  return typeof laneId2 === "string" && laneId2.length > 0 || typeof taskId === "string" && taskId.length > 0;
}
function resolveLaneAttribution(env = process.env) {
  for (const candidate of [env["GUILD_LANE_ID"], env["GUILD_TASK_ID"]]) {
    if (typeof candidate === "string" && candidate.length > 0 && isSafeLaneId(candidate)) {
      return candidate;
    }
  }
  return isWorkerInvocation(env) ? UNATTRIBUTED_WORKER_LANE_ID : void 0;
}

// lib/heartbeat-write.ts
var fs8 = __toESM(require("node:fs"));
var path10 = __toESM(require("node:path"));

// lib/heartbeat.ts
var path8 = __toESM(require("node:path"));

// ../src/modules/lifecycle/workflows/run-state.ts
var fs7 = __toESM(require("node:fs"));
var path7 = __toESM(require("node:path"));
var RUN_STATE_SCHEMA_VERSION = "guild.run_state.v1";
function runStatePath(runDir2) {
  return path7.join(runDir2, "run-state.json");
}
function loadRunState(runDir2) {
  let raw;
  try {
    raw = fs7.readFileSync(runStatePath(runDir2), "utf8");
  } catch {
    return null;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed) || parsed["schema_version"] !== RUN_STATE_SCHEMA_VERSION) {
    return null;
  }
  return parsed;
}
function writeRunStateAtomic(runDir2, state) {
  fs7.mkdirSync(runDir2, { recursive: true });
  const finalPath = runStatePath(runDir2);
  const tmpPath = `${finalPath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  fs7.writeFileSync(tmpPath, JSON.stringify(state, null, 2) + "\n", "utf8");
  try {
    fs7.renameSync(tmpPath, finalPath);
  } catch (err) {
    try {
      fs7.unlinkSync(tmpPath);
    } catch {
    }
    throw err;
  }
}
function newCheckpoint(init2, now) {
  return {
    schema_version: RUN_STATE_SCHEMA_VERSION,
    run_id: init2.runId,
    plan_slug: init2.planSlug ?? init2.runId,
    program_id: init2.programId ?? null,
    wave_index: init2.waveIndex ?? 0,
    lanes: {},
    last_checkpoint_at: now
  };
}
function upsertLane(runDir, init, laneId, patch) {
  if (patch.host?.independence === "strong") {
    const capability = eval("require")("../../capability");
    capability.assertPersistableIndependence(
      runDir,
      patch.host?.independence,
      `run-state lane "${laneId}"`,
      {
        lane_id: laneId,
        producer_ref: patch.host?.independence_ref?.producer_ref,
        reviewer_ref: patch.host?.independence_ref?.reviewer_ref
      }
    );
  }
  return withStableLock(runDir, () => {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const state = loadRunState(runDir) ?? newCheckpoint(init, now);
    const prev = state.lanes[laneId];
    const merged = {
      status: patch.status ?? prev?.status ?? "pending",
      attempt: patch.attempt ?? prev?.attempt ?? 1,
      depends_on: patch.depends_on ?? prev?.depends_on ?? [],
      receipt_ref: patch.receipt_ref !== void 0 ? patch.receipt_ref : prev?.receipt_ref ?? null,
      updated_at: now
    };
    const tier = patch.tier ?? prev?.tier;
    if (tier !== void 0) merged.tier = tier;
    const host = patch.host ?? prev?.host;
    if (host !== void 0) merged.host = host;
    state.lanes[laneId] = merged;
    state.last_checkpoint_at = now;
    writeRunStateAtomic(runDir, state);
    return state;
  });
}
function markLaneInProgress(runDir2, init2, laneId2, opts = {}) {
  return upsertLane(runDir2, init2, laneId2, {
    status: "in_progress",
    tier: opts.tier,
    attempt: opts.attempt,
    depends_on: opts.depends_on
  });
}
var LANE_RESUME_SCHEMA_VERSION = "guild.lane_resume.v1";
function laneResumeCheckpointPath(runDir2, laneId2) {
  return path7.join(runDir2, "lanes", laneId2, "resume.json");
}
function readResumeEnabled(cwd) {
  const settingsPath = path7.join(resolveGuildRoot2(cwd), ".guild", "settings.json");
  try {
    const raw = fs7.readFileSync(settingsPath, "utf8");
    const parsed = JSON.parse(raw);
    const defs = parsed["defaults"];
    if (typeof defs === "object" && defs !== null && !Array.isArray(defs)) {
      const resume = defs["resume"];
      if (typeof resume === "object" && resume !== null && !Array.isArray(resume)) {
        const enabled = resume["enabled"];
        if (typeof enabled === "boolean") return enabled;
      }
    }
  } catch {
  }
  return true;
}
function loadLaneResumeCheckpoint(runDir2, laneId2) {
  try {
    const raw = fs7.readFileSync(laneResumeCheckpointPath(runDir2, laneId2), "utf8");
    const parsed = JSON.parse(raw);
    if (parsed?.schema_version !== LANE_RESUME_SCHEMA_VERSION) return null;
    return parsed;
  } catch {
    return null;
  }
}
function markLaneDead(runDir2, init2, laneId2, signal, cwd) {
  const state = upsertLane(runDir2, init2, laneId2, {
    status: "dead",
    attempt: signal.attempts
  });
  if (readResumeEnabled(cwd)) {
    const checkpoint = {
      schema_version: LANE_RESUME_SCHEMA_VERSION,
      lane_id: laneId2,
      run_id: init2.runId,
      attempts: signal.attempts,
      last_attempt_at: signal.lastAttemptAt,
      resumable_at: (/* @__PURE__ */ new Date()).toISOString(),
      ...typeof signal.lastError === "string" ? { last_error: signal.lastError } : {}
    };
    const checkpointPath = laneResumeCheckpointPath(runDir2, laneId2);
    fs7.mkdirSync(path7.dirname(checkpointPath), { recursive: true });
    fs7.writeFileSync(checkpointPath, JSON.stringify(checkpoint, null, 2) + "\n", "utf8");
  }
  return state;
}

// lib/heartbeat.ts
var DEFAULT_HEARTBEAT_TIMEOUT_MS = 10 * 60 * 1e3;
function heartbeatPath(runDir2, specialist) {
  return path8.join(runDir2, "in-progress", `${specialist}.json`);
}

// ../src/modules/lifecycle/workflows/run-binding.ts
var fsReal = __toESM(require("fs"));
var path9 = __toESM(require("path"));
function realBindingFs() {
  return {
    mkdirp: (p) => fsReal.mkdirSync(p, { recursive: true }),
    writeFile: (p, c) => fsReal.writeFileSync(p, c, "utf8"),
    readFile: (p) => fsReal.existsSync(p) ? fsReal.readFileSync(p, "utf8") : null,
    exists: (p) => fsReal.existsSync(p)
  };
}
function runBindingPath(root, runId) {
  return path9.join(root, ".guild", "runs", runId, "binding.json");
}
function validateRunBindingRecord(parsed, expectedRunId) {
  if (parsed === null || typeof parsed !== "object") return null;
  const o = parsed;
  if (o["schema_version"] !== "guild.run_binding.v1") return null;
  if (typeof o["run_id"] !== "string" || o["run_id"] !== expectedRunId) return null;
  const ref = o["binding_ref"];
  if (typeof ref !== "string" || !/^rb-[A-Za-z0-9_-]+$/.test(ref)) return null;
  if (o["state"] !== "open" && o["state"] !== "closed") return null;
  return {
    schema_version: "guild.run_binding.v1",
    run_id: o["run_id"],
    binding_ref: ref,
    state: o["state"]
  };
}
function readRunBindingRecord(opts) {
  const fs11 = opts.fs ?? realBindingFs();
  const raw = fs11.readFile(runBindingPath(opts.root, opts.run_id));
  if (raw === null) return { status: "absent" };
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { status: "malformed" };
  }
  const record = validateRunBindingRecord(parsed, opts.run_id);
  if (record === null) return { status: "malformed" };
  return { status: "ok", record };
}
function verifyRunBinding(input) {
  const reject2 = (reason) => ({
    ok: false,
    diagnostic: "binding_rejected",
    reason
  });
  if (!input.run_id || !input.binding_ref) return reject2("binding_absent");
  if (!input.root) return reject2("binding_unverifiable");
  const read = readRunBindingRecord({ root: input.root, run_id: input.run_id, fs: input.fs });
  if (read.status === "absent") return reject2("binding_not_minted");
  if (read.status === "malformed") return reject2("binding_malformed");
  const record = read.record;
  if (record.state === "closed") return reject2("binding_closed");
  if (record.binding_ref !== input.binding_ref || record.run_id !== input.run_id) {
    return reject2("binding_mismatch");
  }
  return { ok: true, binding: record };
}
var HOOK_BINDING_ENV_RUN_ID = "GUILD_RUN_ID";
var HOOK_BINDING_ENV_BINDING_REF = "GUILD_RUN_BINDING_REF";
function readHookBindingEnvelope(env) {
  const run_id = env[HOOK_BINDING_ENV_RUN_ID]?.trim();
  const binding_ref = env[HOOK_BINDING_ENV_BINDING_REF]?.trim();
  if (!run_id || !binding_ref) return null;
  return { run_id, binding_ref };
}

// lib/hook-binding.ts
function reject(reason, run_id) {
  return { ok: false, diagnostic: "binding_rejected", reason, run_id };
}
function authorizeHookWrite(root, opts = {}) {
  const env = opts.env ?? process.env;
  const envelope = readHookBindingEnvelope(env);
  const envRunId = env["GUILD_RUN_ID"]?.trim();
  const runId = opts.runId ?? envelope?.run_id ?? (envRunId || void 0);
  if (!runId) return reject("binding_absent", null);
  const ref = opts.bindingRef ?? (envelope && envelope.run_id === runId ? envelope.binding_ref : void 0);
  if (ref === void 0 || ref.trim().length === 0) {
    return reject("binding_absent", runId);
  }
  const verdict = verifyRunBinding({ root, run_id: runId, binding_ref: ref });
  if (verdict.ok === false) return reject(verdict.reason, runId);
  return { ok: true, run_id: runId, binding_ref: verdict.binding.binding_ref };
}

// lib/heartbeat-write.ts
var SAFE_PATH_COMPONENT_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
function isSafePathComponent(id) {
  return SAFE_PATH_COMPONENT_RE.test(id) && id !== "." && id !== "..";
}
function writeHeartbeat(auth, runDir2, specialist, record) {
  if (auth.ok !== true) {
    throw new Error(
      `binding_rejected (${auth.reason}): heartbeat write refused for run ${auth.run_id ?? "<unresolved>"} \u2014 no verified binding envelope.`
    );
  }
  const finalPath = heartbeatPath(runDir2, specialist);
  fs8.mkdirSync(path10.dirname(finalPath), { recursive: true });
  const tmpPath = `${finalPath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  fs8.writeFileSync(tmpPath, JSON.stringify(record, null, 2) + "\n", "utf8");
  try {
    fs8.renameSync(tmpPath, finalPath);
  } catch (err) {
    try {
      fs8.unlinkSync(tmpPath);
    } catch {
    }
    throw err;
  }
  return finalPath;
}
function writeHeartbeatFromEnv(opts = {}) {
  try {
    const env = opts.env ?? process.env;
    const runId = env["GUILD_RUN_ID"];
    const specialist = env["GUILD_SPECIALIST"];
    if (typeof runId !== "string" || runId.length === 0) {
      return { written: false, path: null, reason: "env-absent" };
    }
    if (typeof specialist !== "string" || specialist.length === 0) {
      return { written: false, path: null, reason: "env-absent" };
    }
    if (!isSafePathComponent(runId) || !isSafePathComponent(specialist)) {
      return { written: false, path: null, reason: "unsafe-id" };
    }
    const root = resolveGuildRoot(opts.cwd ?? process.cwd());
    const auth = authorizeHookWrite(root, {
      runId,
      env
    });
    if (auth.ok !== true) {
      return { written: false, path: null, reason: `binding_rejected:${auth.reason}` };
    }
    const envRunDir = env["GUILD_RUN_DIR"];
    const runDir2 = typeof envRunDir === "string" && envRunDir.length > 0 ? envRunDir : path10.join(root, ".guild", "runs", runId);
    const step = env["GUILD_STEP"];
    const record = {
      timestamp: opts.now ? opts.now() : (/* @__PURE__ */ new Date()).toISOString(),
      step: typeof step === "string" && step.length > 0 ? step : null,
      last_action: typeof opts.toolName === "string" && opts.toolName.length > 0 ? opts.toolName : null
    };
    const finalPath = writeHeartbeat(auth, runDir2, specialist, record);
    return { written: true, path: finalPath, reason: null };
  } catch (err) {
    return {
      written: false,
      path: null,
      reason: `write-failed: ${err instanceof Error ? err.message : String(err)}`
    };
  }
}

// lib/guild-hook-event.ts
async function readHookStdin() {
  return new Promise((resolve6) => {
    const chunks = [];
    process.stdin.on("data", (c) => chunks.push(c));
    process.stdin.on("end", () => resolve6(Buffer.concat(chunks).toString("utf8")));
    process.stdin.on("error", () => resolve6(""));
  });
}
function emitClaudeHookEvent(raw) {
  const parsed = JSON.parse(raw.trim());
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return parsed;
  }
  return { ...parsed, host: "claude" };
}

// ../src/modules/telemetry/workflows/guild-trace-emit.ts
var fs9 = __toESM(require("node:fs"));
var path11 = __toESM(require("node:path"));

// ../src/modules/telemetry/workflows/guild-trace-events.ts
var ANALYSIS_EVENT_CLASSES = Object.freeze([
  "run_started",
  "run_closed",
  "run_attachment_resolved",
  "config_snapshot_written",
  "prompt_received",
  "prompt_normalized",
  "clarifying_question_asked",
  "implementation_authorized",
  "agent_dispatched",
  "agent_prompt_sent",
  "agent_response_received",
  "agent_handoff_written",
  "knowledge_lookup_started",
  "knowledge_lookup_result",
  "memory_lookup_started",
  "memory_lookup_result",
  "tool_call_started",
  "tool_call_finished",
  "tool_call_denied",
  "tool_call_failed",
  "loop_entered",
  "loop_iteration",
  "loop_exited",
  "loop_cap_hit",
  "phase_entered",
  "phase_concluded",
  "gate_started",
  "gate_concluded",
  "instruction_violation_detected",
  "user_steering_received",
  "correction_applied",
  "repeated_failure_detected",
  "recommendation_created",
  "recommendation_routed",
  "bug_report_prompted"
]);
var GUILD_TRACE_SCHEMA_VERSIONS = Object.freeze([
  "guild.trace.dispatch.v1",
  "guild.trace.recall.v1",
  "guild.trace.recall_decision.v1",
  "guild.trace.config_resolution.v1",
  "guild.trace.security_decision.v1",
  "guild.trace.degradation.v1",
  "guild.trace.model_inspection.v1",
  "guild.trace.analysis.v2"
]);
function validateBase(ev) {
  if (typeof ev !== "object" || ev === null) {
    return { ok: false, reason: "event must be a non-null object" };
  }
  const e = ev;
  if (typeof e["schema_version"] !== "string" || e["schema_version"] === "") {
    return { ok: false, reason: "schema_version must be a non-empty string" };
  }
  if (!GUILD_TRACE_SCHEMA_VERSIONS.includes(e["schema_version"])) {
    return { ok: false, reason: `unknown schema_version: ${e["schema_version"]}` };
  }
  if (typeof e["ts"] !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(e["ts"])) {
    return { ok: false, reason: "ts must be an ISO-8601 timestamp string" };
  }
  if (typeof e["run_id"] !== "string" || e["run_id"] === "") {
    return { ok: false, reason: "run_id must be a non-empty string" };
  }
  if (typeof e["lane_id"] !== "string") {
    return { ok: false, reason: "lane_id must be a string (empty string for lead session)" };
  }
  return { ok: true };
}
var DISPATCH_BACKENDS = ["agent", "cmux", "tmux", "remote", "unknown"];
var RECALL_BRANCHES = ["sqlite", "file-bm25", "fs-scan", "kg-query", "structural", "combined", "empty"];
var SECURITY_OUTCOMES = ["allow", "ask", "deny", "audit", "pass-through"];
var DEGRADATION_SURFACES = ["dispatch", "recall", "config", "hook", "host-capability", "other"];
function validateDispatchEvent(ev) {
  const base = validateBase(ev);
  if (!base.ok) return base;
  const e = ev;
  if (e["schema_version"] !== "guild.trace.dispatch.v1") {
    return { ok: false, reason: `wrong schema_version for dispatch: ${e["schema_version"]}` };
  }
  if (typeof e["specialist"] !== "string" || e["specialist"] === "") {
    return { ok: false, reason: "specialist must be a non-empty string" };
  }
  if (typeof e["phase"] !== "string" || e["phase"] === "") {
    return { ok: false, reason: "phase must be a non-empty string" };
  }
  if (typeof e["task_id"] !== "string" || e["task_id"] === "") {
    return { ok: false, reason: "task_id must be a non-empty string" };
  }
  if (!DISPATCH_BACKENDS.includes(e["backend"])) {
    return { ok: false, reason: `backend must be one of: ${DISPATCH_BACKENDS.join(", ")}` };
  }
  if (typeof e["backend_rung"] !== "number" || e["backend_rung"] < 0 || e["backend_rung"] > 4) {
    return { ok: false, reason: "backend_rung must be a number 0-4" };
  }
  if (typeof e["dispatched_at"] !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(e["dispatched_at"])) {
    return { ok: false, reason: "dispatched_at must be an ISO-8601 timestamp string" };
  }
  for (const optKey of ["attribution_specialist", "pane_id", "pane_target", "pane_backend"]) {
    if (e[optKey] === void 0) continue;
    if (typeof e[optKey] !== "string" || e[optKey] === "") {
      return { ok: false, reason: `${optKey}, when present, must be a non-empty string` };
    }
  }
  if (e["pane_backend"] !== void 0) {
    if (e["backend"] !== "unknown") {
      return {
        ok: false,
        reason: `pane_backend is only for a surface the backend enum cannot name; it must not accompany backend "${e["backend"]}"`
      };
    }
    if (e["backend_rung"] < 1) {
      return {
        ok: false,
        reason: "pane_backend marks a CONFIRMED dispatch, so backend_rung must be >= 1"
      };
    }
  }
  return { ok: true };
}
function validateRecallEvent(ev) {
  const base = validateBase(ev);
  if (!base.ok) return base;
  const e = ev;
  if (e["schema_version"] !== "guild.trace.recall.v1") {
    return { ok: false, reason: `wrong schema_version for recall: ${e["schema_version"]}` };
  }
  if (typeof e["query"] !== "string" || e["query"] === "") {
    return { ok: false, reason: "query must be a non-empty string" };
  }
  if (!RECALL_BRANCHES.includes(e["branch"])) {
    return { ok: false, reason: `branch must be one of: ${RECALL_BRANCHES.join(", ")}` };
  }
  if (typeof e["chunk_count"] !== "number" || e["chunk_count"] < 0) {
    return { ok: false, reason: "chunk_count must be a non-negative number" };
  }
  if (typeof e["duration_ms"] !== "number" || e["duration_ms"] < 0) {
    return { ok: false, reason: "duration_ms must be a non-negative number" };
  }
  if (typeof e["had_quarantine"] !== "boolean") {
    return { ok: false, reason: "had_quarantine must be a boolean" };
  }
  if (typeof e["cwd_redacted"] !== "string") {
    return { ok: false, reason: "cwd_redacted must be a string" };
  }
  return { ok: true };
}
var LANE_OUTCOMES = ["success", "failure", "unknown"];
function validateRecallDecisionEvent(ev) {
  const base = validateBase(ev);
  if (!base.ok) return base;
  const e = ev;
  if (e["schema_version"] !== "guild.trace.recall_decision.v1") {
    return { ok: false, reason: `wrong schema_version for recall_decision: ${e["schema_version"]}` };
  }
  if (typeof e["query_hash"] !== "string" || !/^[0-9a-f]{16}$/.test(e["query_hash"])) {
    return { ok: false, reason: "query_hash must be exactly 16 lowercase hex chars (sha256[:16])" };
  }
  if (typeof e["query_preview"] !== "string") {
    return { ok: false, reason: "query_preview must be a string (may be empty)" };
  }
  if (e["query_preview"].length > 60) {
    return { ok: false, reason: "query_preview must be <= 60 chars (no raw-query leak)" };
  }
  if (!RECALL_BRANCHES.includes(e["branch"])) {
    return { ok: false, reason: `branch must be one of: ${RECALL_BRANCHES.join(", ")}` };
  }
  if (typeof e["top_score"] !== "number" || e["top_score"] < 0 || !isFinite(e["top_score"])) {
    return { ok: false, reason: "top_score must be a finite number >= 0" };
  }
  if (typeof e["threshold"] !== "number" || e["threshold"] < 0 || !isFinite(e["threshold"])) {
    return { ok: false, reason: "threshold must be a finite number >= 0" };
  }
  if (typeof e["read_skip_fired"] !== "boolean") {
    return { ok: false, reason: "read_skip_fired must be a boolean" };
  }
  if (typeof e["chunk_count"] !== "number" || e["chunk_count"] < 0) {
    return { ok: false, reason: "chunk_count must be a non-negative number" };
  }
  if (typeof e["scored"] !== "boolean") {
    return { ok: false, reason: "scored must be a boolean" };
  }
  if (!LANE_OUTCOMES.includes(e["lane_outcome"])) {
    return { ok: false, reason: `lane_outcome must be one of: ${LANE_OUTCOMES.join(", ")}` };
  }
  return { ok: true };
}
function validateConfigResolutionEvent(ev) {
  const base = validateBase(ev);
  if (!base.ok) return base;
  const e = ev;
  if (e["schema_version"] !== "guild.trace.config_resolution.v1") {
    return { ok: false, reason: `wrong schema_version for config_resolution: ${e["schema_version"]}` };
  }
  if (typeof e["rigor"] !== "string" || e["rigor"] === "") {
    return { ok: false, reason: "rigor must be a non-empty string" };
  }
  if (typeof e["agent_mode"] !== "string" || e["agent_mode"] === "") {
    return { ok: false, reason: "agent_mode must be a non-empty string" };
  }
  if (typeof e["layers"] !== "object" || e["layers"] === null) {
    return { ok: false, reason: "layers must be an object" };
  }
  const layers = e["layers"];
  for (const boolKey of ["workspace", "workspace_local", "project", "project_local", "cli"]) {
    if (typeof layers[boolKey] !== "boolean") {
      return { ok: false, reason: `layers.${boolKey} must be a boolean` };
    }
  }
  if (layers["rigor"] !== null && typeof layers["rigor"] !== "string") {
    return { ok: false, reason: "layers.rigor must be a string or null" };
  }
  if (typeof e["duration_ms"] !== "number" || e["duration_ms"] < 0) {
    return { ok: false, reason: "duration_ms must be a non-negative number" };
  }
  if (typeof e["config_fingerprint"] !== "string" || e["config_fingerprint"] === "") {
    return { ok: false, reason: "config_fingerprint must be a non-empty string" };
  }
  return { ok: true };
}
function validateSecurityDecisionEvent(ev) {
  const base = validateBase(ev);
  if (!base.ok) return base;
  const e = ev;
  if (e["schema_version"] !== "guild.trace.security_decision.v1") {
    return { ok: false, reason: `wrong schema_version for security_decision: ${e["schema_version"]}` };
  }
  if (typeof e["tool_name"] !== "string" || e["tool_name"] === "") {
    return { ok: false, reason: "tool_name must be a non-empty string" };
  }
  if (!SECURITY_OUTCOMES.includes(e["decision"])) {
    return { ok: false, reason: `decision must be one of: ${SECURITY_OUTCOMES.join(", ")}` };
  }
  if (typeof e["bypass_mode"] !== "boolean") {
    return { ok: false, reason: "bypass_mode must be a boolean" };
  }
  if (typeof e["policy_forced"] !== "boolean") {
    return { ok: false, reason: "policy_forced must be a boolean" };
  }
  if (typeof e["autonomy_mode"] !== "string" || e["autonomy_mode"] === "") {
    return { ok: false, reason: "autonomy_mode must be a non-empty string" };
  }
  if (!["env", "file", "none"].includes(e["scope_source"])) {
    return { ok: false, reason: "scope_source must be 'env', 'file', or 'none'" };
  }
  return { ok: true };
}
function validateDegradationEvent(ev) {
  const base = validateBase(ev);
  if (!base.ok) return base;
  const e = ev;
  if (e["schema_version"] !== "guild.trace.degradation.v1") {
    return { ok: false, reason: `wrong schema_version for degradation: ${e["schema_version"]}` };
  }
  if (!DEGRADATION_SURFACES.includes(e["surface"])) {
    return { ok: false, reason: `surface must be one of: ${DEGRADATION_SURFACES.join(", ")}` };
  }
  if (typeof e["reason"] !== "string" || e["reason"] === "") {
    return { ok: false, reason: "reason must be a non-empty string" };
  }
  if (typeof e["attempted"] !== "string" || e["attempted"] === "") {
    return { ok: false, reason: "attempted must be a non-empty string" };
  }
  if (typeof e["fallback"] !== "string" || e["fallback"] === "") {
    return { ok: false, reason: "fallback must be a non-empty string" };
  }
  if (!["warn", "error"].includes(e["severity"])) {
    return { ok: false, reason: "severity must be 'warn' or 'error'" };
  }
  return { ok: true };
}
function validateModelInspectionEvent(ev) {
  const base = validateBase(ev);
  if (!base.ok) return base;
  const e = ev;
  if (e["schema_version"] !== "guild.trace.model_inspection.v1") {
    return { ok: false, reason: `wrong schema_version for model_inspection: ${e["schema_version"]}` };
  }
  for (const key of ["host_family", "host_surface", "identity_trust", "catalog_state", "actual_model", "independence"]) {
    if (typeof e[key] !== "string" || e[key] === "") {
      return { ok: false, reason: `${key} must be a non-empty string` };
    }
  }
  if (e["selection_model"] !== null && (typeof e["selection_model"] !== "string" || e["selection_model"] === "")) {
    return { ok: false, reason: "selection_model must be a non-empty string or null" };
  }
  if (typeof e["unknowns_count"] !== "number" || e["unknowns_count"] < 0 || !Number.isInteger(e["unknowns_count"])) {
    return { ok: false, reason: "unknowns_count must be a non-negative integer" };
  }
  return { ok: true };
}
function validateAnalysisTraceEvent(ev) {
  const base = validateBase(ev);
  if (!base.ok) return base;
  const e = ev;
  if (e["schema_version"] !== "guild.trace.analysis.v2") {
    return { ok: false, reason: `wrong schema_version for analysis trace: ${e["schema_version"]}` };
  }
  if (!ANALYSIS_EVENT_CLASSES.includes(e["event_class"])) {
    return { ok: false, reason: `unknown analysis event_class: ${e["event_class"]}` };
  }
  if (!["lead", "agent", "user", "tool", "system"].includes(e["actor_type"])) {
    return { ok: false, reason: "actor_type must be lead|agent|user|tool|system" };
  }
  if (typeof e["actor_id"] !== "string" || e["actor_id"] === "") {
    return { ok: false, reason: "actor_id must be a non-empty string" };
  }
  if (!["ok", "error", "denied", "incomplete", "unknown"].includes(e["status"])) {
    return { ok: false, reason: "status must be ok|error|denied|incomplete|unknown" };
  }
  const allowedKeys = /* @__PURE__ */ new Set([
    "schema_version",
    "ts",
    "run_id",
    "lane_id",
    "event_class",
    "actor_type",
    "actor_id",
    "status",
    "span_id",
    "parent_span_id",
    "phase",
    "task_id",
    "initiative_id",
    "run_scope",
    "prompt_hash",
    "payload_ref",
    "redaction",
    "duration_ms",
    "tokens",
    "config_snapshot_ref",
    "signature"
  ]);
  for (const key of Object.keys(e)) {
    if (!allowedKeys.has(key)) return { ok: false, reason: `unknown analysis field: ${key}` };
  }
  if (e["run_scope"] !== void 0 && !["initiative", "independent"].includes(e["run_scope"])) {
    return { ok: false, reason: "run_scope must be initiative|independent when present" };
  }
  if (e["duration_ms"] !== void 0 && (typeof e["duration_ms"] !== "number" || e["duration_ms"] < 0)) {
    return { ok: false, reason: "duration_ms must be a non-negative number when present" };
  }
  for (const key of ["span_id", "parent_span_id", "phase", "task_id", "initiative_id", "prompt_hash", "payload_ref", "config_snapshot_ref", "signature"]) {
    if (e[key] !== void 0 && (typeof e[key] !== "string" || e[key] === "")) {
      return { ok: false, reason: `${key} must be a non-empty string when present` };
    }
  }
  if (e["redaction"] !== void 0 && !["none", "redacted", "omitted"].includes(e["redaction"])) {
    return { ok: false, reason: "redaction must be none|redacted|omitted when present" };
  }
  if (e["tokens"] !== void 0) {
    if (typeof e["tokens"] !== "object" || e["tokens"] === null || Array.isArray(e["tokens"])) {
      return { ok: false, reason: "tokens must be an object when present" };
    }
    for (const [key, value] of Object.entries(e["tokens"])) {
      if (!["input", "output", "cached", "cost_usd"].includes(key) || typeof value !== "number" || !Number.isFinite(value) || value < 0) {
        return { ok: false, reason: `tokens.${key} must be a non-negative finite number` };
      }
    }
  }
  const eventClass = e["event_class"];
  if (eventClass === "run_started" && e["run_scope"] === void 0) {
    return { ok: false, reason: "run_started requires run_scope" };
  }
  if (eventClass === "run_attachment_resolved" && (e["run_scope"] === void 0 || e["signature"] === void 0)) {
    return { ok: false, reason: "run_attachment_resolved requires run_scope and signature" };
  }
  if (eventClass === "config_snapshot_written" && e["config_snapshot_ref"] === void 0 && e["payload_ref"] === void 0) {
    return { ok: false, reason: "config_snapshot_written requires config_snapshot_ref or payload_ref" };
  }
  const promptClasses = ["prompt_received", "prompt_normalized", "clarifying_question_asked", "agent_prompt_sent"];
  if (promptClasses.includes(eventClass) && (e["prompt_hash"] === void 0 || e["redaction"] === void 0 || e["span_id"] === void 0)) {
    return { ok: false, reason: `${eventClass} requires prompt_hash, redaction, and span_id` };
  }
  if ((eventClass.startsWith("knowledge_lookup_") || eventClass.startsWith("memory_lookup_")) && (e["span_id"] === void 0 || e["prompt_hash"] === void 0)) {
    return { ok: false, reason: `${eventClass} requires span_id and prompt_hash` };
  }
  if (eventClass.startsWith("tool_call_") && e["span_id"] === void 0) {
    return { ok: false, reason: `${eventClass} requires span_id` };
  }
  if (["tool_call_finished", "tool_call_failed"].includes(eventClass) && e["duration_ms"] === void 0) {
    return { ok: false, reason: `${eventClass} requires duration_ms` };
  }
  if (["agent_dispatched", "agent_prompt_sent", "agent_handoff_written"].includes(eventClass) && (e["task_id"] === void 0 || e["span_id"] === void 0)) {
    return { ok: false, reason: `${eventClass} requires task_id and span_id` };
  }
  if (eventClass === "agent_handoff_written" && e["payload_ref"] === void 0) {
    return { ok: false, reason: "agent_handoff_written requires payload_ref" };
  }
  if (eventClass === "agent_response_received" && e["span_id"] === void 0) {
    return { ok: false, reason: "agent_response_received requires span_id" };
  }
  if (eventClass.startsWith("loop_") && (e["span_id"] === void 0 || e["signature"] === void 0)) {
    return { ok: false, reason: `${eventClass} requires span_id and signature` };
  }
  if (eventClass.startsWith("phase_") && (e["span_id"] === void 0 || e["phase"] === void 0)) {
    return { ok: false, reason: `${eventClass} requires span_id and phase` };
  }
  if (eventClass.startsWith("gate_") && (e["span_id"] === void 0 || e["signature"] === void 0)) {
    return { ok: false, reason: `${eventClass} requires span_id and signature` };
  }
  const evidenceClasses = [
    "instruction_violation_detected",
    "user_steering_received",
    "correction_applied",
    "repeated_failure_detected",
    "recommendation_created",
    "recommendation_routed",
    "bug_report_prompted"
  ];
  if (evidenceClasses.includes(eventClass) && (e["span_id"] === void 0 || e["signature"] === void 0)) {
    return { ok: false, reason: `${eventClass} requires span_id and signature` };
  }
  return { ok: true };
}
function validateGuildTraceEvent(ev) {
  if (typeof ev !== "object" || ev === null) {
    return { ok: false, reason: "event must be a non-null object" };
  }
  const sv = ev["schema_version"];
  switch (sv) {
    case "guild.trace.analysis.v2":
      return validateAnalysisTraceEvent(ev);
    case "guild.trace.model_inspection.v1":
      return validateModelInspectionEvent(ev);
    case "guild.trace.dispatch.v1":
      return validateDispatchEvent(ev);
    case "guild.trace.recall.v1":
      return validateRecallEvent(ev);
    case "guild.trace.recall_decision.v1":
      return validateRecallDecisionEvent(ev);
    case "guild.trace.config_resolution.v1":
      return validateConfigResolutionEvent(ev);
    case "guild.trace.security_decision.v1":
      return validateSecurityDecisionEvent(ev);
    case "guild.trace.degradation.v1":
      return validateDegradationEvent(ev);
    default:
      return { ok: false, reason: `unknown schema_version: ${sv}` };
  }
}
function makeAnalysisTraceEvent(fields) {
  return { schema_version: "guild.trace.analysis.v2", ...fields };
}

// ../src/modules/telemetry/workflows/guild-trace-emit.ts
function liveLogPath2(runDir2) {
  return path11.join(runDir2, "logs", "v1.4-events.jsonl");
}
function emitTraceEvent(event, runDir2) {
  if (!runDir2) return false;
  const validationResult = validateGuildTraceEvent(event);
  if (!validationResult.ok) {
    const schemaVersion = event["schema_version"];
    const failResult = validationResult;
    process.stderr.write(
      `[guild-trace-emit] WARN: dropping invalid trace event (${schemaVersion}): ${failResult.reason}
`
    );
    return false;
  }
  try {
    const live = liveLogPath2(runDir2);
    const dir = path11.dirname(live);
    fs9.mkdirSync(dir, { recursive: true });
    const line = JSON.stringify(event) + "\n";
    fs9.appendFileSync(live, line, "utf8");
    return true;
  } catch (err) {
    process.stderr.write(
      `[guild-trace-emit] WARN: could not write trace event to ${runDir2}/logs/v1.4-events.jsonl: ${err instanceof Error ? err.message : String(err)}
`
    );
    return false;
  }
}

// ../src/modules/telemetry/workflows/run-analysis.ts
var REQUIRED_COVERAGE = Object.freeze(["prompt", "agent", "tool", "phase", "loop", "gate", "close"]);
var COMPLETENESS_REQUIREMENTS = Object.freeze(["run identity", "plugin-config-snapshot.json", "trace parseability", "trace validity", ...REQUIRED_COVERAGE]);
var EVENT_CLASS_CATEGORY = Object.freeze({
  run_started: null,
  run_closed: "close",
  run_attachment_resolved: null,
  config_snapshot_written: null,
  prompt_received: "prompt",
  prompt_normalized: "prompt",
  clarifying_question_asked: "prompt",
  implementation_authorized: "gate",
  agent_dispatched: "agent",
  agent_prompt_sent: "agent",
  agent_response_received: "agent",
  agent_handoff_written: "agent",
  knowledge_lookup_started: "knowledge",
  knowledge_lookup_result: "knowledge",
  memory_lookup_started: "memory",
  memory_lookup_result: "memory",
  tool_call_started: "tool",
  tool_call_finished: "tool",
  tool_call_denied: "tool",
  tool_call_failed: "tool",
  loop_entered: "loop",
  loop_iteration: "loop",
  loop_exited: "loop",
  loop_cap_hit: "loop",
  phase_entered: "phase",
  phase_concluded: "phase",
  gate_started: "gate",
  gate_concluded: "gate",
  instruction_violation_detected: "steering",
  user_steering_received: "steering",
  correction_applied: "correction",
  repeated_failure_detected: "correction",
  recommendation_created: null,
  recommendation_routed: null,
  bug_report_prompted: null
});

// ../src/modules/telemetry/workflows/receipt-journal.ts
var RECEIPT_DISPOSITIONS = Object.freeze([
  "succeeded",
  "refused",
  "unsupported",
  "failed",
  "degraded"
]);
var OBSERVATION_STATES = Object.freeze([
  "checked_clean",
  "not_applicable",
  "not_observed",
  "observation_failed"
]);
var RECEIPT_EVENT_NAMES = Object.freeze([
  "session.start",
  "prompt.submit",
  "tool.before",
  "tool.after",
  "context.compact",
  "task.dispatch",
  "task.collect",
  "run.resume",
  "run.stop",
  "package.render",
  "package.install",
  "package.activate",
  "package.update",
  "runtime.verify",
  "receipt.append",
  "receipt.reconcile",
  "migration.shadow",
  "migration.cutover",
  "migration.rollback"
]);
var RECEIPT_OUTCOME_TYPES = Object.freeze([
  "guild.lifecycle_outcome.v1",
  "guild.normalized_event_outcome.v1",
  "guild.support_transition_outcome.v1",
  "guild.capability_outcome.v1",
  "guild.policy_outcome.v1",
  "guild.receipt_outcome.v1",
  "guild.reconciliation_outcome.v1",
  "guild.boundary_outcome.v1",
  "guild.migration_outcome.v1",
  "guild.version_compatibility_outcome.v1"
]);

// ../src/modules/telemetry/workflows/debug-bundle.ts
var DEBUG_BUNDLE_SECTION_KINDS = Object.freeze([
  "capability_snapshot",
  "normalized_event",
  "policy_decision",
  "transport_attempt",
  "artifact",
  "conformance"
]);

// ../src/modules/telemetry/workflows/task-cell-telemetry.ts
var TASK_CELL_LIFECYCLE_EVENTS = Object.freeze([
  "spawn_started",
  "spawned",
  "ready",
  "assignment_delivered",
  "assignment_acknowledged",
  "running",
  "handoff_submitted",
  "handoff_validated",
  "handoff_accepted",
  "termination_started",
  "terminated",
  "failed",
  "cancelled",
  "timed_out",
  "rejected",
  "orphaned",
  "reaped"
]);
var EVENT_NAMES = new Set(TASK_CELL_LIFECYCLE_EVENTS);

// post-tool-use.ts
function isKnownTool(name) {
  if (typeof name !== "string") return false;
  return TOOL_CALL_TOOL_VALUES.includes(name);
}
function isOk(payload) {
  const resp = payload.tool_response;
  if (resp === null || resp === void 0) return "ok";
  if (typeof resp === "object") {
    const r = resp;
    if (r["success"] === false) return "err";
    if (typeof r["error"] === "string" && r["error"].length > 0) return "err";
  }
  return "ok";
}
function resultExcerpt(payload, policy) {
  const resp = payload.tool_response;
  if (resp === null || resp === void 0) return "";
  let raw;
  if (typeof resp === "string") raw = resp;
  else {
    try {
      raw = JSON.stringify(resp);
    } catch {
      return "";
    }
  }
  const scrub = applySecretsPolicy(raw, policy);
  const resolved = resolveTelemetryField(scrub, policy);
  if (resolved.warn) {
    process.stderr.write(
      `warn: [post-tool-use] result excerpt scrub degraded (fail_mode_telemetry=${policy.fail_mode_telemetry}).
`
    );
  }
  return resolved.value ?? "";
}
function classifyGuildScrubSurface(absPath, guildRoot) {
  const rel = path12.relative(guildRoot, absPath);
  const parts = rel.split(path12.sep);
  if (parts[0] === ".guild" && parts[1] === "wiki") return "wiki";
  if (parts[0] === ".guild" && parts[1] === "runs" && parts.length >= 4) {
    if (parts[3] === "review") return "review";
    if (parts[3] === "handoffs") return "handoff";
    if (parts[3] === "provenance.json" && parts.length === 4) return "provenance";
  }
  return null;
}
function runGuildArtifactScrub(payload, guildRoot, runDir2, runId, laneId2) {
  const effectiveRunId = typeof runId === "string" && runId.length > 0 ? runId : "no-active-run";
  const effectiveRunDir = typeof runDir2 === "string" && runDir2.length > 0 ? runDir2 : path12.join(guildRoot, ".guild", "runs", effectiveRunId);
  const toolName = payload.tool_name;
  if (toolName !== "Write" && toolName !== "Edit") return;
  const ti = payload.tool_input;
  if (!ti || typeof ti !== "object") return;
  const rawFilePath = ti["file_path"];
  if (typeof rawFilePath !== "string" || rawFilePath.length === 0) return;
  const absPath = path12.isAbsolute(rawFilePath) ? rawFilePath : path12.resolve(guildRoot, rawFilePath);
  const surface = classifyGuildScrubSurface(absPath, guildRoot);
  if (surface === null) return;
  let diskContent;
  try {
    diskContent = fs10.readFileSync(absPath, "utf8");
  } catch {
    return;
  }
  const result = scrubbedWrite(absPath, diskContent, {
    surface,
    runDir: effectiveRunDir,
    runId: effectiveRunId,
    laneId: laneId2
  });
  if (result.blocked) {
    let quarantineDone = false;
    try {
      fs10.renameSync(absPath, absPath + ".quarantined");
      quarantineDone = true;
    } catch {
    }
    if (!quarantineDone) {
      let canonicalRemoved = false;
      try {
        fs10.writeFileSync(
          absPath,
          `[SCRUB-BLOCKED: ${surface} file content removed by Guild HK-06 secret scrub \u2014 quarantine rename failed, raw destroyed at canonical path]
`,
          "utf8"
        );
        canonicalRemoved = true;
      } catch {
        try {
          fs10.unlinkSync(absPath);
          canonicalRemoved = true;
        } catch {
        }
      }
      if (!canonicalRemoved) {
        process.stderr.write(
          `[CRITICAL] [post-tool-use] HK-06: CANNOT remove raw secret from canonical path "${path12.basename(absPath)}" \u2014 quarantine AND canonical-removal (overwrite+unlink) both failed. Exiting non-zero. Manual remediation required.
`
        );
        try {
          const evt = buildSecurityEvent({
            run_id: effectiveRunId,
            lane_id: laneId2,
            event_type: "secret_scrub_blocked",
            decision: "blocked",
            tool: "post-tool-use/hk06-scrub",
            detail: `CRITICAL: Cannot remove raw ${surface} write from canonical path "${path12.basename(absPath)}" \u2014 quarantine AND canonical-removal both failed. Raw secret may persist. Manual remediation required.`,
            permission_mode: "blocked"
          });
          appendSecurityEvent(effectiveRunDir, evt);
        } catch {
        }
        process.exit(1);
      }
      process.stderr.write(
        `warn: [post-tool-use] HK-06: quarantine rename failed but canonical path overwritten/unlinked for ${path12.basename(absPath)}.
`
      );
    }
    process.stderr.write(
      `warn: [post-tool-use] HK-06: ${surface} write BLOCKED by secret scrub at ${path12.basename(absPath)} \u2014 quarantined/removed. secret_scrub_blocked event emitted.
`
    );
  } else if (result.written) {
    process.stderr.write(
      `info: [post-tool-use] HK-06: ${surface} file scrubbed in place: ${path12.basename(absPath)}.
`
    );
  }
}
function readCurrentRunId(guildRoot) {
  const sentinelPath = path12.join(guildRoot, ".guild", "runs", "current-run-id");
  try {
    const value = fs10.readFileSync(sentinelPath, "utf8").trim();
    return value.length > 0 ? value : void 0;
  } catch {
    return void 0;
  }
}
function resolveRunId(guildRoot) {
  const envRunId = process.env["GUILD_RUN_ID"];
  if (typeof envRunId === "string" && envRunId.length > 0) return envRunId;
  return readCurrentRunId(guildRoot);
}
async function main() {
  const raw = await readHookStdin();
  let payload = {};
  try {
    payload = emitClaudeHookEvent(raw);
  } catch {
    process.stderr.write("warn: [post-tool-use] invalid JSON on stdin; skipping pairing.\n");
    return;
  }
  const toolName = payload.tool_name ?? "";
  const cwd = process.env["GUILD_CWD"] ?? payload.cwd ?? process.cwd();
  const guildRoot = resolveGuildRoot(cwd);
  {
    const hb = writeHeartbeatFromEnv({ toolName: payload.tool_name, cwd });
    if (!hb.written && hb.reason !== null && hb.reason !== "env-absent") {
      process.stderr.write(
        `warn: [post-tool-use] heartbeat write skipped (non-fatal): ${hb.reason}
`
      );
    }
  }
  {
    const earlyRunId = resolveRunId(guildRoot);
    const earlyRunIdSafe = typeof earlyRunId === "string" && earlyRunId.length > 0 && isSafeRunId(earlyRunId) ? earlyRunId : void 0;
    const earlyRunDir = earlyRunIdSafe ? process.env["GUILD_RUN_DIR"] ?? path12.join(guildRoot, ".guild", "runs", earlyRunIdSafe) : void 0;
    const earlyLaneId = resolveLaneAttribution();
    try {
      runGuildArtifactScrub(payload, guildRoot, earlyRunDir, earlyRunIdSafe, earlyLaneId);
    } catch (err) {
      process.stderr.write(
        `warn: [post-tool-use] HK-06 scrub threw (non-fatal): ${err instanceof Error ? err.message : String(err)}
`
      );
    }
  }
  const runId = resolveRunId(guildRoot);
  if (typeof runId !== "string" || runId.length === 0) {
    process.stderr.write(
      "warn: [post-tool-use] GUILD_RUN_ID unset and current-run-id missing \u2014 falling through (no tool_call emit).\n"
    );
    return;
  }
  if (!isSafeRunId(runId)) {
    process.stderr.write(
      "warn: [post-tool-use] invalid GUILD_RUN_ID/current-run-id \u2014 falling through (no tool_call emit).\n"
    );
    return;
  }
  const runDir2 = process.env["GUILD_RUN_DIR"] ?? path12.join(guildRoot, ".guild", "runs", runId);
  const rawLaneId = process.env["GUILD_LANE_ID"];
  const laneId2 = typeof rawLaneId === "string" && rawLaneId.length > 0 && isSafeLaneId(rawLaneId) ? rawLaneId : void 0;
  if (typeof rawLaneId === "string" && rawLaneId.length > 0 && laneId2 === void 0) {
    process.stderr.write(
      "warn: [post-tool-use] invalid GUILD_LANE_ID \u2014 omitting lane_id.\n"
    );
  }
  const attributionLaneId = resolveLaneAttribution();
  const tsPost = (/* @__PURE__ */ new Date()).toISOString();
  const secretsPolicy = readSecurityConfig(cwd).secrets_policy;
  try {
    const sweep = sweepOrphanedSidecarFull(runDir2);
    for (const ev of sweep.events) {
      try {
        appendEvent(runDir2, ev);
      } catch (err) {
        process.stderr.write(
          `warn: [post-tool-use] orphan emit failed: ${err instanceof Error ? err.message : String(err)}
`
        );
      }
    }
  } catch (err) {
    process.stderr.write(
      `warn: [post-tool-use] sweep failed: ${err instanceof Error ? err.message : String(err)}
`
    );
  }
  if (!isKnownTool(toolName)) {
    return;
  }
  const matchKey = {
    run_id: runId,
    tool: toolName,
    post_ts: tsPost
  };
  if (laneId2 !== void 0) {
    matchKey.lane_id = laneId2;
  }
  let event;
  try {
    const pre = consumeSidecarPre(runDir2, matchKey);
    if (pre === null) {
      event = buildToolCallFromPostOnly({
        ts_post: tsPost,
        run_id: runId,
        tool: toolName,
        result_excerpt_redacted: resultExcerpt(payload, secretsPolicy),
        ...attributionLaneId !== void 0 ? { lane_id: attributionLaneId } : {},
        ...typeof payload.duration_ms === "number" ? { latency_ms_override: payload.duration_ms } : {}
      });
    } else {
      event = buildToolCallFromPair(pre, {
        ts_post: tsPost,
        run_id: runId,
        status: isOk(payload),
        result_excerpt_redacted: resultExcerpt(payload, secretsPolicy)
      });
      if (attributionLaneId !== void 0) {
        event.lane_id = attributionLaneId;
      }
    }
    const isLlmCallTool = toolName === "Agent" || toolName === "Skill";
    const tokens = isLlmCallTool ? normalizeTokens(payload.tokens ?? payload.usage) : void 0;
    const traceV2 = resolveTraceV2Fields({
      runId,
      eventType: "tool_call",
      ts: tsPost,
      actorId: attributionLaneId ?? "main",
      tokens
    });
    if (toolName === "Agent") {
      const attr = resolveDispatchAttribution(payload.tool_input);
      if (attr?.isSpecialistLane === true && attr.specialist !== void 0) {
        traceV2.attribution_specialist = attr.specialist;
      }
    }
    appendEvent(runDir2, event, { traceV2 });
    const common = {
      run_id: runId,
      lane_id: attributionLaneId ?? "",
      actor_type: "tool",
      actor_id: toolName,
      span_id: traceV2.span_id,
      parent_span_id: traceV2.parent_span_id,
      phase: process.env["GUILD_PHASE"] || void 0,
      task_id: process.env["GUILD_TASK_ID"] || void 0,
      config_snapshot_ref: fs10.existsSync(path12.join(runDir2, "plugin-config-snapshot.json")) ? "plugin-config-snapshot.json" : void 0
    };
    const startedMs = Math.max(0, Date.parse(tsPost) - event.latency_ms);
    emitTraceEvent(
      makeAnalysisTraceEvent({
        ...common,
        ts: new Date(startedMs).toISOString(),
        event_class: "tool_call_started",
        status: "ok"
      }),
      runDir2
    );
    emitTraceEvent(
      makeAnalysisTraceEvent({
        ...common,
        ts: tsPost,
        event_class: event.status === "err" ? "tool_call_failed" : "tool_call_finished",
        status: event.status === "err" ? "error" : event.status === "n/a" ? "unknown" : "ok",
        duration_ms: event.latency_ms,
        tokens
      }),
      runDir2
    );
  } catch (err) {
    process.stderr.write(
      `warn: [post-tool-use] tool_call emit failed: ${err instanceof Error ? err.message : String(err)}
`
    );
  }
}
if (process.argv[1] !== void 0 && (process.argv[1].endsWith("post-tool-use.ts") || process.argv[1].endsWith("post-tool-use.js"))) {
  main().catch((err) => {
    process.stderr.write(
      `fatal: [post-tool-use] ${err instanceof Error ? err.message : String(err)}
`
    );
    process.exit(0);
  });
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  main
});
