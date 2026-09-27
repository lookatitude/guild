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

// scripts/lib/retention.ts
var retention_exports = {};
__export(retention_exports, {
  DEFAULT_RETENTION_DAYS: () => DEFAULT_RETENTION_DAYS,
  findExpiredRuns: () => findExpiredRuns,
  isExpired: () => isExpired,
  sweepExpiredRuns: () => sweepExpiredRuns
});
module.exports = __toCommonJS(retention_exports);
var fs2 = __toESM(require("fs"));
var path2 = __toESM(require("path"));

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

// scripts/lib/retention.ts
var DEFAULT_RETENTION_DAYS = 90;
function isExpired(info, nowMs, days = DEFAULT_RETENTION_DAYS) {
  if (info.retention_class !== "one-off-90d") return false;
  if (!info.closed_at) return false;
  const closedMs = Date.parse(info.closed_at);
  if (Number.isNaN(closedMs)) return false;
  return nowMs - closedMs > days * 864e5;
}
function findExpiredRuns(guildDir, nowMs, days = DEFAULT_RETENTION_DAYS) {
  const runsDir = path2.join(guildDir, "runs");
  let entries;
  try {
    entries = fs2.readdirSync(runsDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const dir = path2.join(runsDir, e.name);
    const prov = path2.join(dir, "provenance.json");
    if (!fs2.existsSync(prov)) continue;
    let p;
    try {
      p = JSON.parse(fs2.readFileSync(prov, "utf8"));
    } catch {
      continue;
    }
    const info = { run_id: p.run_id ?? e.name, retention_class: p.retention_class ?? "until-archive", closed_at: p.closed_at, dir };
    if (isExpired(info, nowMs, days)) out.push(info);
  }
  return out.sort((a, b) => a.run_id.localeCompare(b.run_id));
}
function sweepExpiredRuns(guildDir, nowMs, opts = {}) {
  const days = opts.days ?? DEFAULT_RETENTION_DAYS;
  const dryRun = opts.dryRun !== false;
  const expired = findExpiredRuns(guildDir, nowMs, days);
  if (!dryRun) {
    for (const r of expired) fs2.rmSync(r.dir, { recursive: true, force: true });
  }
  return { removed: expired, dryRun };
}
if (require.main === module) {
  const argv = process.argv.slice(2);
  let guildDir = path2.join(resolveGuildRoot(process.cwd()), ".guild");
  let apply = false;
  let nowMs = Date.now();
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--guild-dir" && argv[i + 1]) guildDir = path2.resolve(argv[++i]);
    else if (argv[i] === "--apply") apply = true;
    else if (argv[i] === "--now" && argv[i + 1]) nowMs = Date.parse(argv[++i]) || nowMs;
  }
  const { removed, dryRun } = sweepExpiredRuns(guildDir, nowMs, { dryRun: !apply });
  process.stdout.write(
    `[retention] ${dryRun ? "DRY-RUN" : "APPLIED"}: ${removed.length} expired one-off run(s)` + (removed.length ? `:
${removed.map((r) => `  ${r.run_id} (closed ${r.closed_at})`).join("\n")}
` : "\n")
  );
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  DEFAULT_RETENTION_DAYS,
  findExpiredRuns,
  isExpired,
  sweepExpiredRuns
});
