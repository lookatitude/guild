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

// scripts/audit-run-sinks.ts
var path4 = __toESM(require("path"));

// scripts/lib/run-sinks.ts
var fs = __toESM(require("fs"));
var path = __toESM(require("path"));
var BACKEND_DEGRADATION_SINK = "logs/backend-degradation.jsonl";
var TIER_DISPATCH_SINK = "logs/tier-dispatch.jsonl";
var BACKEND_DEGRADATION_SCHEMA = "guild.backend_degradation.v1";
var TIER_DISPATCH_SCHEMA = "guild.tier_dispatch.v1";
var UNTIERED_REASON = "missing_model";
function readSinkRaw(runDir, relPath, expectedSchema) {
  let content;
  try {
    content = fs.readFileSync(path.join(runDir, relPath), "utf8");
  } catch (err) {
    if (err?.code === "ENOENT") return { rows: [], anomalies: 0 };
    return { rows: [], anomalies: 1 };
  }
  const rows = [];
  let anomalies = 0;
  for (const line of content.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    let v;
    try {
      v = JSON.parse(t);
    } catch {
      anomalies++;
      continue;
    }
    if (!v || typeof v !== "object" || Array.isArray(v)) {
      anomalies++;
      continue;
    }
    if (expectedSchema !== void 0 && v.schema_version !== expectedSchema) {
      anomalies++;
      continue;
    }
    rows.push(v);
  }
  return { rows, anomalies };
}
function tally(values) {
  const m = /* @__PURE__ */ new Map();
  for (const v of values) m.set(v, (m.get(v) ?? 0) + 1);
  return Array.from(m.entries()).map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}
function summarizeBackendDegradations(rows) {
  const receipts = rows.filter((r) => r.schema_version === BACKEND_DEGRADATION_SCHEMA);
  return {
    count: receipts.length,
    byReason: tally(receipts.map((r) => String(r.reason ?? "unknown"))).map((t) => ({
      reason: t.value,
      count: t.count
    })),
    byDecision: tally(receipts.map((r) => String(r.decision ?? "unknown"))).map((t) => ({
      decision: t.value,
      count: t.count
    })),
    receipts
  };
}
function summarizeTierDispatch(rows) {
  const receipts = rows.filter((r) => r.schema_version === TIER_DISPATCH_SCHEMA);
  const violations = receipts.filter((r) => String(r.decision) !== "pass");
  const untieredCount = receipts.filter((r) => String(r.reason) === UNTIERED_REASON).length;
  return {
    total: receipts.length,
    violationCount: violations.length,
    untieredCount,
    violations,
    byReason: tally(violations.map((r) => String(r.reason ?? "unknown"))).map((t) => ({
      reason: t.value,
      count: t.count
    })),
    byDecision: tally(violations.map((r) => String(r.decision ?? "unknown"))).map((t) => ({
      decision: t.value,
      count: t.count
    }))
  };
}
function loadRunSinks(runDir) {
  const deg = readSinkRaw(runDir, BACKEND_DEGRADATION_SINK, BACKEND_DEGRADATION_SCHEMA);
  const tier = readSinkRaw(runDir, TIER_DISPATCH_SINK, TIER_DISPATCH_SCHEMA);
  return {
    runDir,
    degradations: summarizeBackendDegradations(deg.rows),
    tier: summarizeTierDispatch(tier.rows),
    parseErrors: deg.anomalies + tier.anomalies
  };
}
function isRunSinkDirty(a) {
  return a.degradations.count > 0 || a.tier.violationCount > 0 || a.parseErrors > 0;
}
function renderSinkAuditSection(a) {
  const { degradations: d, tier: t } = a;
  const body = [];
  if (!isRunSinkDirty(a)) {
    body.push(
      `Clean \u2014 no backend degradations, no tier-contract violations` + (t.total > 0 ? ` (${t.total} dispatch receipt(s), all compliant).` : ".")
    );
    return ["## Sink audit", "", body.join("\n")].join("\n");
  }
  if (d.count > 0) {
    body.push(`- **backend degradations: ${d.count}** \u2014 a lane ran on a downgraded backend.`);
    for (const r of d.byReason) body.push(`  - reason \`${r.reason}\`: ${r.count}`);
    for (const r of d.byDecision) body.push(`  - decision \`${r.decision}\`: ${r.count}`);
  }
  if (t.violationCount > 0) {
    body.push(
      `- **tier-contract violations: ${t.violationCount}** of ${t.total} dispatch receipt(s) \u2014 ${t.untieredCount} un-tiered (\`${UNTIERED_REASON}\`).`
    );
    for (const r of t.byReason) body.push(`  - reason \`${r.reason}\`: ${r.count}`);
    for (const r of t.byDecision) body.push(`  - decision \`${r.decision}\`: ${r.count}`);
  }
  if (a.parseErrors > 0) {
    body.push(
      `- **unverifiable sink records: ${a.parseErrors}** \u2014 treated as DIRTY (fail-closed): a corrupt/truncated line, a wrong-schema record, or an unreadable sink may hide a real degradation or tier violation. Inspect the raw jsonl.`
    );
  }
  return ["## Sink audit", "", body.join("\n")].join("\n");
}

// scripts/lib/state/ensure-storage-layout.ts
var fs3 = __toESM(require("node:fs"));
var path3 = __toESM(require("node:path"));

// src/domains/state/guild-root.ts
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

// scripts/audit-run-sinks.ts
function parseArgs(argv) {
  let runId = null;
  let cwd = ".";
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--run-id" && i + 1 < argv.length) runId = argv[++i];
    else if (argv[i] === "--cwd" && i + 1 < argv.length) cwd = argv[++i];
  }
  return { runId, cwd };
}
function main() {
  ensureStorageLayout(process.cwd(), { detectOnly: true });
  const { runId, cwd } = parseArgs(process.argv.slice(2));
  if (!runId) {
    process.stderr.write("[audit-run-sinks] ERROR: --run-id <id> is required\n");
    process.exit(2);
  }
  const runDir = path4.join(path4.resolve(cwd), ".guild", "runs", runId);
  const audit = loadRunSinks(runDir);
  process.stdout.write(renderSinkAuditSection(audit) + "\n");
  if (isRunSinkDirty(audit)) {
    process.stderr.write(
      `[audit-run-sinks] DIRTY: run ${runId} has ${audit.degradations.count} backend degradation(s), ${audit.tier.violationCount} tier-contract violation(s) (${audit.tier.untieredCount} un-tiered), ${audit.parseErrors} unparseable sink line(s). verify-done check #6 FAILS.
`
    );
    process.exit(1);
  }
  process.exit(0);
}
main();
