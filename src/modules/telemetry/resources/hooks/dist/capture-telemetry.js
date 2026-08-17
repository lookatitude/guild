#!/usr/bin/env -S npx tsx
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

// capture-telemetry.ts
var fs8 = __toESM(require("fs"));
var path9 = __toESM(require("path"));
var crypto2 = __toESM(require("crypto"));

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

// lib/guild-hook-event.ts
async function readHookStdin() {
  return new Promise((resolve4) => {
    const chunks = [];
    process.stdin.on("data", (c) => chunks.push(c));
    process.stdin.on("end", () => resolve4(Buffer.concat(chunks).toString("utf8")));
    process.stdin.on("error", () => resolve4(""));
  });
}
function emitClaudeHookEvent(raw) {
  const parsed = JSON.parse(raw.trim());
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return parsed;
  }
  return { ...parsed, host: "claude" };
}

// ../src/modules/lifecycle/workflows/run-binding.ts
var fsReal = __toESM(require("fs"));
var path2 = __toESM(require("path"));
function realBindingFs() {
  return {
    mkdirp: (p) => fsReal.mkdirSync(p, { recursive: true }),
    writeFile: (p, c) => fsReal.writeFileSync(p, c, "utf8"),
    readFile: (p) => fsReal.existsSync(p) ? fsReal.readFileSync(p, "utf8") : null,
    exists: (p) => fsReal.existsSync(p)
  };
}
function runBindingPath(root, runId) {
  return path2.join(root, ".guild", "runs", runId, "binding.json");
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
  const fs9 = opts.fs ?? realBindingFs();
  const raw = fs9.readFile(runBindingPath(opts.root, opts.run_id));
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
function formatBindingRejected(hook, auth) {
  if (auth.ok !== false) return "";
  return `[${hook}] binding_rejected (${auth.reason}) for run ${auth.run_id ?? "<unresolved>"} \u2014 no write performed (session_context \xA75: writers fail closed; sentinels are intake-only).
`;
}

// ../src/modules/security/workflows/config.ts
var fs4 = __toESM(require("node:fs"));
var path5 = __toESM(require("node:path"));

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
var path3 = __toESM(require("node:path"));
function resolveGuildRoot2(startDir) {
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

// ../src/modules/migrations/workflows/index-migrate.ts
var import_node_child_process = require("node:child_process");
var fs3 = __toESM(require("node:fs"));
var path4 = __toESM(require("node:path"));
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
    const abs = path4.isAbsolute(raw) ? raw : path4.resolve(cwd, raw);
    const root = path4.dirname(abs);
    if (fs3.existsSync(root)) return root;
  } catch {
  }
  return path4.resolve(cwd);
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
    fs3.mkdirSync(path4.dirname(dbPath), { recursive: true });
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
    dbPath = path4.join(guildRoot, ".guild", "index.sqlite");
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
  const settingsPath = path5.join(resolveGuildRoot2(cwd), ".guild", "settings.json");
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
    (_match, key, sep) => `${key}${sep}${KV_REDACTED}`
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

// ../src/modules/security/workflows/events.ts
var fs5 = __toESM(require("node:fs"));
var path6 = __toESM(require("node:path"));
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
function appendSecurityEvent(runDir, record) {
  try {
    const logsDir = path6.join(runDir, "logs");
    fs5.mkdirSync(logsDir, { recursive: true });
    fs5.appendFileSync(path6.join(logsDir, "security-events.jsonl"), JSON.stringify(record) + "\n", "utf8");
    return true;
  } catch (err) {
    process.stderr.write(
      `warn: [security-events] write failed: ${err instanceof Error ? err.message : String(err)}
`
    );
    return false;
  }
}
function resolveRunDir(cwd, runId, explicitRunDir) {
  if (typeof explicitRunDir === "string" && explicitRunDir.length > 0) return explicitRunDir;
  return path6.join(resolveGuildRoot2(cwd), ".guild", "runs", runId);
}

// ../src/modules/telemetry/workflows/guild-trace-emit.ts
var fs6 = __toESM(require("node:fs"));
var path7 = __toESM(require("node:path"));

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
function liveLogPath(runDir) {
  return path7.join(runDir, "logs", "v1.4-events.jsonl");
}
function emitTraceEvent(event, runDir) {
  if (!runDir) return false;
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
    const live = liveLogPath(runDir);
    const dir = path7.dirname(live);
    fs6.mkdirSync(dir, { recursive: true });
    const line = JSON.stringify(event) + "\n";
    fs6.appendFileSync(live, line, "utf8");
    return true;
  } catch (err) {
    process.stderr.write(
      `[guild-trace-emit] WARN: could not write trace event to ${runDir}/logs/v1.4-events.jsonl: ${err instanceof Error ? err.message : String(err)}
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

// ../src/modules/lifecycle/workflows/trace-v2.ts
var fs7 = __toESM(require("fs"));
var path8 = __toESM(require("path"));
var crypto = __toESM(require("crypto"));
var TRACE_PAYLOAD_SCHEMA = "guild.trace_payload.v1";
var SIDECAR_MAX_BYTES = 16 * 1024;
function genSpanId(runId, eventType, ts, actorId) {
  const material = `${runId}|${eventType}|${ts}|${actorId || "main"}`;
  return crypto.createHash("sha256").update(material).digest("hex").slice(0, 16);
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
var LLM_CALL_EVENTS = /* @__PURE__ */ new Set([
  "SubagentStop",
  "loop_round_start",
  "loop_round_end",
  "codex_review_round",
  "specialist_dispatch",
  "specialist_receipt"
]);
function isLlmCallEvent(eventType) {
  return LLM_CALL_EVENTS.has(eventType);
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
function payloadSidecarPath(runDir, evtId) {
  return path8.join(runDir, "logs", "payloads", `${evtId}.json`);
}
function payloadRef(evtId) {
  return `logs/payloads/${evtId}.json`;
}
function redactDeep(value, redact) {
  if (typeof value === "string") return redact(value);
  if (Array.isArray(value)) return value.map((v) => redactDeep(v, redact));
  if (value !== null && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = redactDeep(v, redact);
    }
    return out;
  }
  return value;
}
function writePayloadSidecar(runDir, evtId, input, redact) {
  try {
    const record = {
      schema_version: TRACE_PAYLOAD_SCHEMA,
      evt_id: evtId,
      span_id: input.spanId,
      run_id: input.runId,
      event: input.eventType,
      ts: input.ts,
      actor_id: input.actorId || "main",
      body: redactDeep(input.body, redact)
    };
    if (input.parentSpanId !== void 0) record["parent_span_id"] = input.parentSpanId;
    let serialized = JSON.stringify(record);
    if (Buffer.byteLength(serialized, "utf8") > SIDECAR_MAX_BYTES) {
      record["body"] = { truncated: true, reason: "sidecar exceeded SIDECAR_MAX_BYTES" };
      serialized = JSON.stringify(record);
    }
    const file = payloadSidecarPath(runDir, evtId);
    fs7.mkdirSync(path8.dirname(file), { recursive: true });
    fs7.writeFileSync(file, serialized + "\n", "utf8");
    return payloadRef(evtId);
  } catch {
    return void 0;
  }
}

// capture-telemetry.ts
function digest(value) {
  const str = typeof value === "string" ? value : JSON.stringify(value ?? "");
  return crypto2.createHash("sha256").update(str).digest("hex").slice(0, 12);
}
function isOk(payload) {
  const resp = payload.tool_response;
  if (resp === null || resp === void 0) return true;
  if (typeof resp === "object") {
    const r = resp;
    if (r["success"] === false) return false;
    if (typeof r["error"] === "string" && r["error"].length > 0) return false;
  }
  return true;
}
function resolveBoundRunId(cwd) {
  const auth = authorizeHookWrite(resolveGuildRoot(cwd));
  if (auth.ok === false) {
    process.stderr.write(formatBindingRejected("capture-telemetry", auth));
    return null;
  }
  return auth.run_id;
}
async function main() {
  const raw = await readHookStdin();
  let payload = {};
  try {
    payload = emitClaudeHookEvent(raw);
  } catch {
    process.stderr.write("[capture-telemetry] WARN: invalid JSON on stdin; skipping.\n");
    process.exit(0);
  }
  const cwd = process.env["GUILD_CWD"] ?? payload.cwd ?? process.cwd();
  const runId = resolveBoundRunId(cwd);
  if (runId === null) process.exit(0);
  const eventName = payload.hook_event_name ?? "PostToolUse";
  const tool = eventName === "SubagentStop" || eventName === "UserPromptSubmit" ? "" : payload.tool_name ?? "";
  const specialist = payload.agent_name ?? "";
  const payloadDigest = digest(
    payload.tool_input ?? payload.stop_reason ?? payload.prompt ?? ""
  );
  const ok = isOk(payload);
  const ms = typeof payload.duration_ms === "number" ? payload.duration_ms : 0;
  const ts = (/* @__PURE__ */ new Date()).toISOString();
  const actorId = specialist || "main";
  const event = {
    ts,
    event: eventName,
    tool,
    specialist,
    payload_digest: payloadDigest,
    ok,
    ms
  };
  const secPolicy = readSecurityConfig(cwd).secrets_policy;
  if (eventName === "UserPromptSubmit" && typeof payload.prompt === "string") {
    const scrub = applySecretsPolicy(payload.prompt, secPolicy);
    const resolved = resolveTelemetryField(scrub, secPolicy);
    if (resolved.value !== void 0) event.prompt = resolved.value;
    if (resolved.warn) {
      process.stderr.write(
        `[capture-telemetry] WARN: secrets_policy redaction_patterns failure on prompt (fail_mode_telemetry=${secPolicy.fail_mode_telemetry}): ${scrub.failures.join("; ")}
`
      );
      try {
        const evRunDir = process.env["GUILD_RUN_DIR"] ?? resolveRunDir(cwd, runId);
        appendSecurityEvent(
          evRunDir,
          buildSecurityEvent({
            run_id: runId,
            event_type: "secret_scrub_failure",
            decision: secPolicy.fail_mode_telemetry === "closed" ? "deny" : "allow",
            tool: "",
            detail: `secrets_policy redaction_patterns failed on telemetry prompt: ${scrub.failures.join("; ")}`
          })
        );
      } catch {
      }
    }
  }
  if (eventName === "loop_round_start" || eventName === "loop_round_end" || eventName === "codex_review_round") {
    if (typeof payload.loop_layer === "string") event.loop_layer = payload.loop_layer;
    if (typeof payload.loop_round === "number") event.loop_round = payload.loop_round;
    if (typeof payload.loop_gate === "string") event.loop_gate = payload.loop_gate;
    if (typeof payload.loop_terminated === "boolean") event.loop_terminated = payload.loop_terminated;
  }
  const runsDir = path9.join(resolveGuildRoot(cwd), ".guild", "runs", runId);
  const redact = (s) => applySecretsPolicy(s, secPolicy).value;
  const spanId = genSpanId(runId, eventName, ts, actorId);
  const body = {};
  if (tool) body["tool"] = tool;
  if (payload.tool_input !== void 0) body["tool_input"] = payload.tool_input;
  if (payload.tool_response !== void 0) body["tool_response"] = payload.tool_response;
  if (typeof payload.stop_reason === "string") body["stop_reason"] = payload.stop_reason;
  if (specialist) body["agent_name"] = specialist;
  if (typeof event.prompt === "string") body["prompt"] = event.prompt;
  if (typeof event.loop_layer === "string") body["loop_layer"] = event.loop_layer;
  if (typeof event.loop_gate === "string") body["loop_gate"] = event.loop_gate;
  let payloadRef2;
  if (Object.keys(body).length > 0) {
    payloadRef2 = writePayloadSidecar(
      runsDir,
      spanId,
      {
        runId,
        spanId,
        eventType: eventName,
        ts,
        actorId,
        parentSpanId: process.env["GUILD_PARENT_SPAN_ID"] || void 0,
        body
      },
      redact
    );
  }
  const tokens = isLlmCallEvent(eventName) ? normalizeTokens(payload.tokens ?? payload.usage) : void 0;
  Object.assign(
    event,
    pruneUndefined(
      resolveTraceV2Fields({
        runId,
        eventType: eventName,
        ts,
        actorId,
        payloadModel: payload.model,
        tokens,
        payloadRef: payloadRef2
      })
    )
  );
  const eventLine = JSON.stringify(event) + "\n";
  const logsDir = path9.join(runsDir, "logs");
  const canonicalFile = path9.join(logsDir, "v1.4-events.jsonl");
  const legacyFile = path9.join(runsDir, "events.ndjson");
  if (eventName !== "PostToolUse") {
    try {
      fs8.mkdirSync(logsDir, { recursive: true });
      fs8.appendFileSync(canonicalFile, eventLine, "utf8");
    } catch (err) {
      process.stderr.write(
        `[capture-telemetry] ERROR: failed to write to canonical log (${canonicalFile}): ${err instanceof Error ? err.message : String(err)}
`
      );
    }
  }
  const semanticClass = eventName === "UserPromptSubmit" ? "prompt_received" : eventName === "SubagentStop" ? "agent_response_received" : eventName === "loop_round_start" ? "loop_entered" : eventName === "loop_round_end" ? "loop_exited" : eventName === "codex_review_round" ? "gate_concluded" : null;
  if (semanticClass) {
    emitTraceEvent(
      makeAnalysisTraceEvent({
        ts,
        run_id: runId,
        lane_id: process.env["GUILD_LANE_ID"] ?? "",
        event_class: semanticClass,
        actor_type: eventName === "UserPromptSubmit" ? "user" : eventName === "SubagentStop" ? "agent" : "system",
        actor_id: actorId,
        span_id: spanId,
        parent_span_id: process.env["GUILD_PARENT_SPAN_ID"] || void 0,
        phase: process.env["GUILD_PHASE"] || void 0,
        task_id: process.env["GUILD_TASK_ID"] || void 0,
        prompt_hash: eventName === "UserPromptSubmit" ? payloadDigest : void 0,
        payload_ref: payloadRef2,
        redaction: payloadRef2 ? "redacted" : "omitted",
        status: ok ? "ok" : "error",
        duration_ms: ms,
        tokens,
        config_snapshot_ref: fs8.existsSync(path9.join(runsDir, "plugin-config-snapshot.json")) ? "plugin-config-snapshot.json" : void 0,
        signature: eventName.startsWith("loop_") ? `${event.loop_layer ?? "unknown"}:${event.loop_round ?? 0}` : eventName === "codex_review_round" ? `${event.loop_gate ?? "review"}:${event.loop_round ?? 0}` : void 0
      }),
      runsDir
    );
  }
  try {
    fs8.mkdirSync(runsDir, { recursive: true });
    fs8.appendFileSync(legacyFile, eventLine, "utf8");
  } catch (err) {
    process.stderr.write(
      `[capture-telemetry] WARN: mirror write to events.ndjson failed: ${err instanceof Error ? err.message : String(err)}
`
    );
  }
}
main().catch((err) => {
  process.stderr.write(
    `[capture-telemetry] FATAL: ${err instanceof Error ? err.message : String(err)}
`
  );
  process.exit(0);
});
