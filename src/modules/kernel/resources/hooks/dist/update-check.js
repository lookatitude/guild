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

// update-check.ts
var fs2 = __toESM(require("fs"));
var os2 = __toESM(require("os"));
var path2 = __toESM(require("path"));
var import_child_process2 = require("child_process");

// ../scripts/lib/update-check.ts
var fs = __toESM(require("fs"));
var os = __toESM(require("os"));
var path = __toESM(require("path"));
var import_child_process = require("child_process");
var SOURCE_REPO_DEFAULT = "https://github.com/lookatitude/guild.git";
var CACHE_SCHEMA = "guild.update_check_cache.v1";
var RECEIPT_SCHEMA = "guild.install_receipt.v1";
var RECEIPT_BASENAME = "guild-install-receipt.json";
function parseSemver(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(v.trim());
  if (!m) return null;
  return [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10)];
}
function semverLt(a, b) {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) return false;
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] < pb[i];
  }
  return false;
}
function latestStableTag(tags) {
  let best = null;
  for (const t of tags) {
    if (!parseSemver(t)) continue;
    if (best === null || semverLt(best, t)) best = t;
  }
  return best;
}
function parseLsRemote(raw) {
  const tags = [];
  let next = null;
  let main2 = null;
  for (const line of raw.split("\n")) {
    const m = /^([0-9a-f]{40})\s+(\S+)$/.exec(line.trim());
    if (!m) continue;
    const [, sha, ref] = m;
    if (ref === "refs/heads/next") next = sha;
    else if (ref === "refs/heads/main") main2 = sha;
    else if (ref.startsWith("refs/tags/v") && !ref.endsWith("^{}")) {
      tags.push(ref.slice("refs/tags/".length));
    }
  }
  return { latest_tag: latestStableTag(tags), next_head_sha: next, main_head_sha: main2 };
}
function readGitHead(gitDir, fsi = fs) {
  const headPath = path.join(gitDir, "HEAD");
  if (!fsi.existsSync(headPath)) return { branch: null, sha: null };
  const head = fsi.readFileSync(headPath, "utf8").trim();
  const refMatch = /^ref:\s*refs\/heads\/(\S+)$/.exec(head);
  if (!refMatch) {
    return { branch: null, sha: /^[0-9a-f]{40}$/.test(head) ? head : null };
  }
  const branch = refMatch[1];
  const looseRef = path.join(gitDir, "refs", "heads", branch);
  if (fsi.existsSync(looseRef)) {
    const sha = fsi.readFileSync(looseRef, "utf8").trim();
    return { branch, sha: /^[0-9a-f]{40}$/.test(sha) ? sha : null };
  }
  const packed = path.join(gitDir, "packed-refs");
  if (fsi.existsSync(packed)) {
    for (const line of fsi.readFileSync(packed, "utf8").split("\n")) {
      const m = /^([0-9a-f]{40})\s+refs\/heads\/(\S+)$/.exec(line.trim());
      if (m && m[2] === branch) return { branch, sha: m[1] };
    }
  }
  return { branch, sha: null };
}
function branchToChannel(branch) {
  if (branch === "next") return "beta";
  return "stable";
}
function resolveInstallState(pluginRoot, opts = {}) {
  const fsi = opts.fsi ?? fs;
  const home = opts.homedir ?? os.homedir();
  const real = (() => {
    try {
      return fsi.realpathSync(pluginRoot);
    } catch {
      return pluginRoot;
    }
  })();
  const version = readInstalledVersion(pluginRoot, fsi);
  const managedRoots = [
    path.join(home, ".claude", "plugins"),
    path.join(home, ".config", "claude", "plugins")
  ].map((m) => {
    try {
      return fsi.realpathSync(m);
    } catch {
      return m;
    }
  });
  const isManaged = managedRoots.some(
    (m) => real === m || real.startsWith(m + path.sep)
  );
  const gitDir = path.join(real, ".git");
  if (fsi.existsSync(gitDir)) {
    if (!isManaged) {
      const { branch: branch2, sha: sha2 } = readGitHead(gitDir, fsi);
      return { channel: "dev", version, commit: sha2, source: "dev-checkout" };
    }
    const { branch, sha } = readGitHead(gitDir, fsi);
    return {
      channel: branchToChannel(branch),
      version,
      commit: sha,
      source: "marketplace-clone"
    };
  }
  const receiptPath = path.join(real, RECEIPT_BASENAME);
  if (fsi.existsSync(receiptPath)) {
    try {
      const r = JSON.parse(fsi.readFileSync(receiptPath, "utf8"));
      if (r.schema_version === RECEIPT_SCHEMA) {
        return {
          channel: r.channel === "beta" ? "beta" : "stable",
          version: r.version ?? version,
          commit: r.commit ?? null,
          source: "receipt"
        };
      }
    } catch {
    }
  }
  return { channel: "stable", version, commit: null, source: "default" };
}
function readInstalledVersion(pluginRoot, fsi = fs) {
  try {
    const manifest = JSON.parse(
      fsi.readFileSync(path.join(pluginRoot, ".claude-plugin", "plugin.json"), "utf8")
    );
    return typeof manifest.version === "string" ? manifest.version : null;
  } catch {
    return null;
  }
}
function cachePath(homedir3 = os.homedir()) {
  return path.join(homedir3, ".guild", "update-check.json");
}
function readCache(file, fsi = fs) {
  try {
    const c = JSON.parse(fsi.readFileSync(file, "utf8"));
    return c.schema_version === CACHE_SCHEMA ? c : null;
  } catch {
    return null;
  }
}
function cacheIsFresh(cache, ttlHours, now) {
  if (!cache) return false;
  const age = now.getTime() - Date.parse(cache.checked_at);
  return Number.isFinite(age) && age >= 0 && age < ttlHours * 36e5;
}
function refreshCache(opts) {
  const repo = opts.repo ?? SOURCE_REPO_DEFAULT;
  const file = opts.file ?? cachePath();
  const fsi = opts.fsi ?? fs;
  const run = opts.runner ?? ((cmd, args) => (0, import_child_process.execFileSync)(cmd, args, { encoding: "utf8", timeout: 15e3 }));
  try {
    const raw = run("git", ["ls-remote", "--tags", "--heads", repo]);
    const cache = {
      schema_version: CACHE_SCHEMA,
      checked_at: (opts.now ?? /* @__PURE__ */ new Date()).toISOString(),
      source_repo: repo,
      remote: parseLsRemote(raw)
    };
    fsi.mkdirSync(path.dirname(file), { recursive: true });
    fsi.writeFileSync(file, JSON.stringify(cache, null, 2) + "\n", "utf8");
    return cache;
  } catch {
    return null;
  }
}
function computeSignal(opts) {
  const { state, cache } = opts;
  const short = (sha) => sha ? sha.slice(0, 7) : "unknown";
  const installedLabel = state.channel === "beta" ? short(state.commit) : state.version ?? "unknown";
  const base = {
    channel: state.channel,
    installed: installedLabel,
    available: null,
    command: null
  };
  if (state.channel === "dev") {
    return { ...base, update_available: false, reason: "dev-install" };
  }
  if (!cache) {
    return { ...base, update_available: false, reason: "no-cache" };
  }
  const command = opts.hostKind === "wrapper" ? "guild-run update" : opts.hostKind === "agents-file" ? "curl -fsSL https://guildstack.dev/install.sh | bash -s -- --update" : "claude plugin marketplace update guild && claude plugin update guild@guild";
  if (state.channel === "beta") {
    const remoteSha = cache.remote.next_head_sha;
    if (remoteSha && state.commit && remoteSha !== state.commit) {
      return {
        ...base,
        update_available: true,
        available: short(remoteSha),
        command,
        reason: "beta-new-commit"
      };
    }
    return { ...base, update_available: false, reason: "up-to-date" };
  }
  const latest = cache.remote.latest_tag;
  if (latest && state.version && semverLt(state.version, latest)) {
    return {
      ...base,
      update_available: true,
      available: latest,
      command,
      reason: "stable-newer-tag"
    };
  }
  return { ...base, update_available: false, reason: "up-to-date" };
}
function renderSignalLine(sig) {
  if (!sig.update_available || !sig.available) return null;
  const channelLabel = sig.channel === "beta" ? "beta (next)" : "stable";
  return `Guild update available on ${channelLabel}: ${sig.installed} \u2192 ${sig.available}` + (sig.command ? ` \u2014 run: ${sig.command}` : "");
}

// update-check.ts
function readUpdateConfig(cwd) {
  const defaults = { mode: "notify", cadenceHours: 24 };
  try {
    const raw = fs2.readFileSync(path2.join(cwd, ".guild", "settings.json"), "utf8");
    const parsed = JSON.parse(raw);
    const u = parsed.defaults?.update ?? {};
    const mode = u.mode === "auto" || u.mode === "notify" || u.mode === "off" ? u.mode : defaults.mode;
    const cadenceHours = typeof u.cadence_hours === "number" && u.cadence_hours > 0 ? u.cadence_hours : defaults.cadenceHours;
    return { mode, cadenceHours };
  } catch {
    return defaults;
  }
}
function stagedMarkerPath() {
  return path2.join(os2.homedir(), ".guild", "update-staged.json");
}
function alreadyStaged(target) {
  try {
    const m = JSON.parse(fs2.readFileSync(stagedMarkerPath(), "utf8"));
    return m.target === target;
  } catch {
    return false;
  }
}
function markStaged(target) {
  try {
    fs2.mkdirSync(path2.dirname(stagedMarkerPath()), { recursive: true });
    fs2.writeFileSync(
      stagedMarkerPath(),
      JSON.stringify({ target, staged_at: (/* @__PURE__ */ new Date()).toISOString() }) + "\n",
      "utf8"
    );
  } catch {
  }
}
function spawnDetached(cmd, args) {
  try {
    const child = (0, import_child_process2.spawn)(cmd, args, {
      detached: true,
      stdio: "ignore"
    });
    child.unref();
  } catch {
  }
}
function main() {
  if (process.argv.includes("--refresh")) {
    refreshCache({});
    return;
  }
  const pluginRoot = process.env["GUILD_PLUGIN_ROOT"] ?? process.env["CLAUDE_PLUGIN_ROOT"];
  if (!pluginRoot) return;
  const { mode, cadenceHours } = readUpdateConfig(process.cwd());
  if (mode === "off") return;
  const state = resolveInstallState(pluginRoot);
  if (state.channel === "dev") return;
  const cacheFile = cachePath();
  const cache = readCache(cacheFile);
  if (!cacheIsFresh(cache, cadenceHours, /* @__PURE__ */ new Date())) {
    spawnDetached(process.execPath, [__filename, "--refresh"]);
  }
  const signal = computeSignal({ state, cache, hostKind: "claude" });
  const line = renderSignalLine(signal);
  if (!line) return;
  if (mode === "auto") {
    const target = signal.available ?? "";
    if (!alreadyStaged(target)) {
      spawnDetached("/bin/sh", [
        "-c",
        "claude plugin marketplace update guild && claude plugin update guild@guild"
      ]);
      markStaged(target);
      process.stdout.write(
        `${line}
[guild-update] auto mode: update staged \u2014 it takes effect next session.
`
      );
      return;
    }
    process.stdout.write(
      `${line}
[guild-update] auto mode: already staged \u2014 restart to apply.
`
    );
    return;
  }
  process.stdout.write(`${line}
`);
}
try {
  main();
} catch {
}
process.exit(0);
