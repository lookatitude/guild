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

// scripts/dashboard-launch.ts
var dashboard_launch_exports = {};
__export(dashboard_launch_exports, {
  BENCHMARK_PACKAGE_NAME: () => BENCHMARK_PACKAGE_NAME,
  BENCHMARK_REPO_URL_DEFAULT: () => BENCHMARK_REPO_URL_DEFAULT,
  DEFAULT_PORT: () => DEFAULT_PORT,
  EXIT_ERROR: () => EXIT_ERROR,
  EXIT_NOT_READY: () => EXIT_NOT_READY,
  EXIT_OK: () => EXIT_OK,
  EXIT_REQUIRED_INSTALL: () => EXIT_REQUIRED_INSTALL,
  PORT_SCAN_SPAN: () => PORT_SCAN_SPAN,
  READINESS_POLL_INTERVAL_MS: () => READINESS_POLL_INTERVAL_MS,
  READINESS_TIMEOUT_MS: () => READINESS_TIMEOUT_MS,
  createRealEnv: () => createRealEnv,
  dashboardLogPath: () => dashboardLogPath,
  dashboardRecordPath: () => dashboardRecordPath,
  discoverRunDirs: () => discoverRunDirs,
  importRuns: () => importRuns,
  launchDashboard: () => launchDashboard,
  parseDashboardArgs: () => parseDashboardArgs,
  pickPort: () => pickPort,
  readDashboardRecord: () => readDashboardRecord,
  requiredInstallCommands: () => requiredInstallCommands,
  resolveBenchmarkCheckout: () => resolveBenchmarkCheckout,
  resolveProjectRoot: () => resolveProjectRoot,
  stopDashboard: () => stopDashboard,
  updateBenchmarkCacheToLatest: () => updateBenchmarkCacheToLatest,
  waitForReady: () => waitForReady
});
module.exports = __toCommonJS(dashboard_launch_exports);
var fs = __toESM(require("node:fs"));
var path = __toESM(require("node:path"));
var net = __toESM(require("node:net"));
var import_node_child_process = require("node:child_process");
var BENCHMARK_PACKAGE_NAME = "@guild/benchmark";
var BENCHMARK_REPO_URL_DEFAULT = "https://github.com/lookatitude/guild-benchmark.git";
var DEFAULT_PORT = 3055;
var PORT_SCAN_SPAN = 20;
var READINESS_TIMEOUT_MS = 3e4;
var READINESS_POLL_INTERVAL_MS = 500;
var EXIT_OK = 0;
var EXIT_ERROR = 1;
var EXIT_NOT_READY = 2;
var EXIT_REQUIRED_INSTALL = 3;
function createRealEnv() {
  return {
    exists: (p) => fs.existsSync(p),
    isDirectory: (p) => {
      try {
        return fs.statSync(p).isDirectory();
      } catch {
        return false;
      }
    },
    readFile: (p) => fs.readFileSync(p, "utf-8"),
    readDir: (p) => {
      try {
        return fs.readdirSync(p);
      } catch {
        return [];
      }
    },
    mkdirp: (p) => {
      fs.mkdirSync(p, { recursive: true });
    },
    writeFileAtomic: (p, content) => {
      const tmp = `${p}.tmp-${process.pid}`;
      fs.writeFileSync(tmp, content);
      fs.renameSync(tmp, p);
    },
    removeFile: (p) => {
      fs.rmSync(p, { force: true });
    },
    isProcessAlive: (pid) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    },
    killProcess: (pid) => {
      try {
        process.kill(-pid, "SIGTERM");
      } catch {
        try {
          process.kill(pid, "SIGTERM");
        } catch {
        }
      }
    },
    execSync: (cmd, args, opts) => {
      const res = (0, import_node_child_process.spawnSync)(cmd, args, {
        cwd: opts.cwd,
        stdio: "inherit"
      });
      return res.status ?? 1;
    },
    execCapture: (cmd, args, opts) => {
      const res = (0, import_node_child_process.spawnSync)(cmd, args, { cwd: opts.cwd, encoding: "utf-8" });
      return { code: res.status ?? 1, stdout: res.stdout ?? "" };
    },
    spawnDetached: (cmd, args, opts) => {
      const fd = fs.openSync(opts.logPath, "a");
      const child = (0, import_node_child_process.spawn)(cmd, args, {
        cwd: opts.cwd,
        detached: true,
        stdio: ["ignore", fd, fd]
      });
      child.unref();
      fs.closeSync(fd);
      return { pid: child.pid ?? -1 };
    },
    fetchFn: async (url, init) => {
      const res = await fetch(url, init);
      return { status: res.status, text: () => res.text() };
    },
    isPortFree: (port) => new Promise((resolvePromise) => {
      const srv = net.createServer();
      srv.once("error", () => resolvePromise(false));
      srv.once("listening", () => {
        srv.close(() => resolvePromise(true));
      });
      srv.listen(port, "127.0.0.1");
    }),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    log: (line) => process.stdout.write(`${line}
`),
    now: () => Date.now()
  };
}
function parseDashboardArgs(argv) {
  const args = {
    port: DEFAULT_PORT,
    noImport: false,
    install: false,
    dryRun: false,
    stop: false
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--project-root" && argv[i + 1] !== void 0) {
      args.projectRoot = argv[++i];
    } else if (arg.startsWith("--project-root=")) {
      args.projectRoot = arg.slice("--project-root=".length);
    } else if (arg === "--port" && argv[i + 1] !== void 0) {
      args.port = Number(argv[++i]);
    } else if (arg.startsWith("--port=")) {
      args.port = Number(arg.slice("--port=".length));
    } else if (arg === "--no-import") {
      args.noImport = true;
    } else if (arg === "--install") {
      args.install = true;
    } else if (arg === "--dry-run") {
      args.dryRun = true;
    } else if (arg === "--stop") {
      args.stop = true;
    } else {
      return { error: `unknown argument: ${arg}` };
    }
  }
  if (!Number.isInteger(args.port) || args.port < 1 || args.port > 65535) {
    return { error: `--port must be a valid TCP port (1-65535)` };
  }
  if (args.projectRoot !== void 0 && !path.isAbsolute(args.projectRoot)) {
    return { error: `--project-root must be an absolute path` };
  }
  return args;
}
function resolveProjectRoot(cwd, env) {
  let dir = path.resolve(cwd);
  let nearestGuild = null;
  for (; ; ) {
    if (env.isDirectory(path.join(dir, ".guild"))) {
      nearestGuild ??= dir;
      if (isWorkspaceRoot(dir, env)) return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return nearestGuild;
    dir = parent;
  }
}
function isWorkspaceRoot(root, env) {
  const workspacePath = path.join(root, ".guild", "workspace.json");
  if (!env.exists(workspacePath)) return false;
  try {
    const parsed = JSON.parse(env.readFile(workspacePath));
    return parsed.is_workspace === true;
  } catch {
    return false;
  }
}
function dashboardRecordPath(projectRoot) {
  return path.join(projectRoot, ".guild", "cache", "dashboard.json");
}
function dashboardLogPath(projectRoot) {
  return path.join(projectRoot, ".guild", "cache", "dashboard.log");
}
function readDashboardRecord(projectRoot, env) {
  const p = dashboardRecordPath(projectRoot);
  if (!env.exists(p)) return null;
  try {
    const raw = JSON.parse(env.readFile(p));
    if (typeof raw.pid !== "number" || !Number.isInteger(raw.pid) || raw.pid <= 0 || typeof raw.port !== "number") {
      return null;
    }
    return {
      pid: raw.pid,
      port: raw.port,
      project_root: raw.project_root ?? projectRoot,
      benchmark_dir: raw.benchmark_dir ?? "",
      started_at: raw.started_at ?? ""
    };
  } catch {
    return null;
  }
}
function stopDashboard(projectRoot, env) {
  const recordPath = dashboardRecordPath(projectRoot);
  if (!env.exists(recordPath)) {
    env.log(
      `[dashboard-launch] --stop: no dashboard record at ${recordPath} \u2014 nothing to stop`
    );
    return { exitCode: EXIT_OK };
  }
  const record = readDashboardRecord(projectRoot, env);
  if (!record) {
    env.removeFile(recordPath);
    env.log(
      `[dashboard-launch] --stop: malformed record at ${recordPath} \u2014 removed; nothing to kill (check manually with \`ps\` if a server is still running)`
    );
    return { exitCode: EXIT_OK };
  }
  if (env.isProcessAlive(record.pid)) {
    env.killProcess(record.pid);
    env.removeFile(recordPath);
    env.log(
      `[dashboard-launch] stopped dashboard server (pid ${record.pid}, port ${record.port}); record removed`
    );
  } else {
    env.removeFile(recordPath);
    env.log(
      `[dashboard-launch] --stop: stale record \u2014 pid ${record.pid} is not running; record removed, nothing to kill`
    );
  }
  return { exitCode: EXIT_OK };
}
function isBenchmarkCheckout(dir, env) {
  const pkgPath = path.join(dir, "package.json");
  if (!env.exists(pkgPath)) return false;
  try {
    const pkg = JSON.parse(env.readFile(pkgPath));
    return pkg.name === BENCHMARK_PACKAGE_NAME;
  } catch {
    return false;
  }
}
function resolveBenchmarkCheckout(projectRoot, env) {
  const candidates = [
    { kind: "sibling", dir: path.join(path.dirname(projectRoot), "benchmark") },
    { kind: "in-repo", dir: path.join(projectRoot, "benchmark") },
    { kind: "cache", dir: path.join(projectRoot, ".guild", "cache", "benchmark") }
  ];
  for (const cand of candidates) {
    if (isBenchmarkCheckout(cand.dir, env)) {
      return {
        kind: cand.kind,
        dir: cand.dir,
        needsInstall: !env.isDirectory(path.join(cand.dir, "node_modules"))
      };
    }
  }
  return {
    kind: "required-install",
    cacheDir: path.join(projectRoot, ".guild", "cache", "benchmark")
  };
}
function requiredInstallCommands(resolution, repoUrl) {
  if (resolution.kind === "required-install") {
    return [
      `git clone ${repoUrl} ${resolution.cacheDir}`,
      `cd ${resolution.cacheDir} && npm ci`
    ];
  }
  return [`cd ${resolution.dir} && npm ci`];
}
function updateBenchmarkCacheToLatest(dir, env) {
  if (env.execSync("git", ["-C", dir, "fetch", "--tags", "--force", "--quiet", "origin"], {}) !== 0) {
    return { error: "git fetch failed" };
  }
  const tags = env.execCapture("git", ["-C", dir, "tag", "--list", "--sort=-version:refname"], {});
  const latestTag = tags.code === 0 ? tags.stdout.split("\n").map((s) => s.trim()).filter(Boolean)[0] ?? "" : "";
  if (latestTag) {
    if (env.execSync("git", ["-C", dir, "checkout", "--quiet", latestTag], {}) !== 0) {
      return { error: `git checkout ${latestTag} failed` };
    }
    return { ref: latestTag };
  }
  const head = env.execCapture("git", ["-C", dir, "rev-parse", "--abbrev-ref", "origin/HEAD"], {});
  const branch = head.stdout.trim().split("/").pop() || "main";
  if (env.execSync("git", ["-C", dir, "checkout", "--quiet", branch], {}) !== 0) {
    return { error: `git checkout ${branch} failed` };
  }
  if (env.execSync("git", ["-C", dir, "merge", "--ff-only", "--quiet", `origin/${branch}`], {}) !== 0) {
    return { error: `git fast-forward ${branch} failed` };
  }
  return { ref: `${branch} (latest)` };
}
async function pickPort(preferred, env) {
  for (let p = preferred; p < preferred + PORT_SCAN_SPAN && p <= 65535; p++) {
    if (await env.isPortFree(p)) return p;
  }
  return null;
}
function discoverRunDirs(projectRoot, env) {
  const roots = discoverRunRoots(projectRoot, env);
  const out = [];
  for (const root of roots) {
    const runsRoot = path.join(root, ".guild", "runs");
    for (const name of env.readDir(runsRoot)) {
      const runDir = path.join(runsRoot, name);
      if (!env.isDirectory(runDir)) continue;
      if (env.exists(path.join(runDir, "logs", "v1.4-events.jsonl"))) {
        out.push(runDir);
      }
    }
  }
  return out.sort();
}
function discoverRunRoots(projectRoot, env) {
  const root = path.resolve(projectRoot);
  const roots = [root];
  const workspacePath = path.join(root, ".guild", "workspace.json");
  if (!env.exists(workspacePath)) return roots;
  let parsed;
  try {
    parsed = JSON.parse(env.readFile(workspacePath));
  } catch {
    return roots;
  }
  const subGuilds = parsed !== null && typeof parsed === "object" && Array.isArray(parsed.sub_guilds) ? parsed.sub_guilds : [];
  for (const entry of subGuilds) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) continue;
    const childPath = entry.path;
    if (typeof childPath !== "string") continue;
    const childRoot = path.resolve(root, childPath);
    const rel = path.relative(root, childRoot);
    if (rel.startsWith("..") || path.isAbsolute(rel)) continue;
    roots.push(childRoot);
  }
  return roots;
}
async function waitForReady(port, env, timeoutMs = READINESS_TIMEOUT_MS) {
  const deadline = env.now() + timeoutMs;
  for (; ; ) {
    try {
      const res = await env.fetchFn(`http://127.0.0.1:${port}/api/runs`);
      if (res.status === 200) return true;
    } catch {
    }
    if (env.now() >= deadline) return false;
    await env.sleep(READINESS_POLL_INTERVAL_MS);
  }
}
async function importRuns(port, runDirs, env) {
  const results = [];
  for (const runDir of runDirs) {
    try {
      const res = await env.fetchFn(
        `http://127.0.0.1:${port}/api/imports/lifecycle`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ run_dir: runDir })
        }
      );
      const text = await res.text();
      if (res.status === 201) {
        let runId;
        try {
          runId = JSON.parse(text).run_id;
        } catch {
        }
        results.push({ runDir, ok: true, ...runId ? { runId } : {} });
      } else {
        let message = text;
        try {
          message = JSON.parse(text).error ?? text;
        } catch {
        }
        results.push({
          runDir,
          ok: false,
          error: `HTTP ${res.status}: ${message}`
        });
      }
    } catch (e) {
      results.push({ runDir, ok: false, error: e.message });
    }
  }
  return results;
}
async function launchDashboard(args, env, cwd = process.cwd(), repoUrl = process.env.GUILD_BENCHMARK_REPO_URL ?? BENCHMARK_REPO_URL_DEFAULT) {
  const projectRoot = args.projectRoot ?? resolveProjectRoot(cwd, env);
  if (!projectRoot) {
    env.log(
      `[dashboard-launch] ERROR: no .guild/ directory found at or above ${cwd}; pass --project-root <abs> or run /guild:init first`
    );
    return { exitCode: EXIT_ERROR };
  }
  if (!env.isDirectory(path.join(projectRoot, ".guild"))) {
    env.log(
      `[dashboard-launch] ERROR: ${projectRoot} has no .guild/ directory \u2014 the dashboard reads .guild/runs + .guild/wiki + .guild/indexes`
    );
    return { exitCode: EXIT_ERROR };
  }
  if (args.stop) {
    return stopDashboard(projectRoot, env);
  }
  const recordPath = dashboardRecordPath(projectRoot);
  if (!args.dryRun && env.exists(recordPath)) {
    const record2 = readDashboardRecord(projectRoot, env);
    const alive = record2 !== null && env.isProcessAlive(record2.pid) && await waitForReady(record2.port, env, 0);
    if (record2 && alive) {
      const url2 = `http://127.0.0.1:${record2.port}/`;
      env.log(
        `[dashboard-launch] reusing running dashboard (pid ${record2.pid}, port ${record2.port}, started ${record2.started_at})`
      );
      let importResults2 = [];
      if (!args.noImport) {
        const runDirs2 = discoverRunDirs(projectRoot, env);
        importResults2 = await importRuns(record2.port, runDirs2, env);
        const ok = importResults2.filter((r) => r.ok).length;
        env.log(
          `[dashboard-launch] imported ${ok}/${importResults2.length} run(s)`
        );
      }
      env.log(`[dashboard-launch] dashboard ready: ${url2}`);
      env.log(`[dashboard-launch] stop it with: dashboard-launch.ts --stop`);
      return {
        exitCode: EXIT_OK,
        url: url2,
        pid: record2.pid,
        port: record2.port,
        importResults: importResults2
      };
    }
    env.log(
      `[dashboard-launch] stale dashboard record at ${recordPath} (server not running) \u2014 cleaning up`
    );
    env.removeFile(recordPath);
  }
  let resolution = resolveBenchmarkCheckout(projectRoot, env);
  if (resolution.kind === "required-install" && args.install && !args.dryRun) {
    const cacheDir2 = resolution.cacheDir;
    env.mkdirp(path.dirname(cacheDir2));
    env.log(`[dashboard-launch] cloning benchmark \u2192 ${cacheDir2}`);
    const cloneCode = env.execSync("git", ["clone", repoUrl, cacheDir2], {});
    if (cloneCode !== 0) {
      env.log(`[dashboard-launch] ERROR: git clone failed (exit ${cloneCode})`);
      return { exitCode: EXIT_ERROR };
    }
    resolution = resolveBenchmarkCheckout(projectRoot, env);
    if (resolution.kind === "required-install") {
      env.log(
        `[dashboard-launch] ERROR: clone completed but ${cacheDir2} is not a benchmark checkout (package.json name !== ${BENCHMARK_PACKAGE_NAME}); if the benchmark lives in a subdirectory of the cloned repo, move it to ${cacheDir2} manually`
      );
      return { exitCode: EXIT_ERROR };
    }
  } else if (resolution.kind === "required-install") {
    const cmds = requiredInstallCommands(resolution, repoUrl);
    env.log(
      `[dashboard-launch] REQUIRED-INSTALL: no benchmark checkout found (looked: sibling ${path.join(path.dirname(projectRoot), "benchmark")}, in-repo ${path.join(projectRoot, "benchmark")}, cache ${resolution.cacheDir}).`
    );
    env.log(
      `[dashboard-launch] No network I/O is performed without --install. Run these commands (or re-run with --install after confirming):`
    );
    for (const cmd of cmds) env.log(`  ${cmd}`);
    return { exitCode: EXIT_REQUIRED_INSTALL };
  }
  let depsMayBeStale = false;
  if (resolution.kind === "cache" && !args.dryRun) {
    if (args.install) {
      env.log("[dashboard-launch] checking the benchmark repo for a newer version\u2026");
      const upd = updateBenchmarkCacheToLatest(resolution.dir, env);
      if ("error" in upd) {
        env.log(`[dashboard-launch] WARN: benchmark update skipped (${upd.error}); launching the cached version`);
      } else {
        env.log(`[dashboard-launch] benchmark cache is at the latest version: ${upd.ref}`);
        depsMayBeStale = true;
      }
    } else {
      env.log("[dashboard-launch] using the cached benchmark; re-run with --install to fetch the latest version");
    }
  }
  if ((resolution.needsInstall || depsMayBeStale) && !args.dryRun) {
    if (args.install) {
      env.log(`[dashboard-launch] installing dependencies in ${resolution.dir}`);
      const ciCode = env.execSync("npm", ["ci"], { cwd: resolution.dir });
      if (ciCode !== 0) {
        env.log(`[dashboard-launch] ERROR: npm ci failed (exit ${ciCode})`);
        return { exitCode: EXIT_ERROR };
      }
    } else {
      const cmds = requiredInstallCommands(resolution, repoUrl);
      env.log(
        `[dashboard-launch] REQUIRED-INSTALL: benchmark checkout at ${resolution.dir} has no node_modules. No network I/O is performed without --install. Run (or re-run with --install after confirming):`
      );
      for (const cmd of cmds) env.log(`  ${cmd}`);
      return { exitCode: EXIT_REQUIRED_INSTALL };
    }
  }
  const port = args.dryRun ? args.port : await pickPort(args.port, env);
  if (port === null) {
    env.log(
      `[dashboard-launch] ERROR: no free port in ${args.port}..${args.port + PORT_SCAN_SPAN - 1}`
    );
    return { exitCode: EXIT_ERROR };
  }
  if (!args.dryRun && port !== args.port) {
    env.log(
      `[dashboard-launch] port ${args.port} is busy \u2014 using ${port} instead`
    );
  }
  const runDirs = args.noImport ? [] : discoverRunDirs(projectRoot, env);
  if (args.dryRun) {
    env.log(`[dashboard-launch] DRY-RUN \u2014 nothing executed. Plan:`);
    env.log(`  project-root : ${projectRoot}`);
    env.log(`  benchmark    : ${resolution.dir} (${resolution.kind})`);
    if (resolution.needsInstall) {
      env.log(`  install      : node_modules missing \u2014 would need --install`);
    }
    env.log(
      `  serve        : npm run benchmark -- serve --port ${port} --project-root ${projectRoot}  (cwd: ${resolution.dir})`
    );
    env.log(
      args.noImport ? `  import       : skipped (--no-import)` : `  import       : ${runDirs.length} run dir(s) \u2192 POST /api/imports/lifecycle`
    );
    env.log(`  url          : http://127.0.0.1:${port}/`);
    if (env.exists(recordPath)) {
      env.log(
        `  record       : ${recordPath} exists \u2014 a live server would be reused`
      );
    }
    return { exitCode: EXIT_OK, port };
  }
  const cacheDir = path.join(projectRoot, ".guild", "cache");
  env.mkdirp(cacheDir);
  const logPath = dashboardLogPath(projectRoot);
  const proc = env.spawnDetached(
    "npm",
    [
      "run",
      "benchmark",
      "--",
      "serve",
      "--port",
      String(port),
      "--project-root",
      projectRoot
    ],
    { cwd: resolution.dir, logPath }
  );
  const record = {
    pid: proc.pid,
    port,
    project_root: projectRoot,
    benchmark_dir: resolution.dir,
    started_at: new Date(env.now()).toISOString()
  };
  env.writeFileAtomic(recordPath, `${JSON.stringify(record, null, 2)}
`);
  env.log(
    `[dashboard-launch] server starting (pid ${proc.pid}; log: ${logPath}; record: ${recordPath})`
  );
  env.log(
    `[dashboard-launch] stop with: dashboard-launch.ts --stop (or kill ${proc.pid})`
  );
  const ready = await waitForReady(port, env);
  if (!ready) {
    env.log(
      `[dashboard-launch] ERROR: server did not become ready within ${READINESS_TIMEOUT_MS / 1e3}s (GET http://127.0.0.1:${port}/api/runs). Inspect ${logPath}, then clean up with: dashboard-launch.ts --stop`
    );
    return { exitCode: EXIT_NOT_READY, pid: proc.pid, port };
  }
  let importResults = [];
  if (!args.noImport) {
    importResults = await importRuns(port, runDirs, env);
    const ok = importResults.filter((r) => r.ok).length;
    const failed = importResults.length - ok;
    env.log(
      `[dashboard-launch] imported ${ok}/${importResults.length} run(s)` + (failed > 0 ? ` (${failed} failed \u2014 non-fatal)` : ``)
    );
    for (const r of importResults) {
      env.log(
        r.ok ? `  ok   ${path.basename(r.runDir)}${r.runId ? ` \u2192 ${r.runId}` : ``}` : `  FAIL ${path.basename(r.runDir)} \u2014 ${r.error}`
      );
    }
  } else {
    env.log(`[dashboard-launch] import skipped (--no-import)`);
  }
  const url = `http://127.0.0.1:${port}/`;
  env.log(`[dashboard-launch] dashboard ready: ${url}`);
  env.log(
    `[dashboard-launch] stop the server with: dashboard-launch.ts --stop (or kill ${proc.pid})`
  );
  return { exitCode: EXIT_OK, url, pid: proc.pid, port, importResults };
}
async function main() {
  const parsed = parseDashboardArgs(process.argv.slice(2));
  if ("error" in parsed) {
    process.stderr.write(`[dashboard-launch] ${parsed.error}
`);
    process.stderr.write(
      `Usage: dashboard-launch.ts [--project-root <abs>] [--port <n>] [--no-import] [--install] [--dry-run] [--stop]
`
    );
    process.exit(EXIT_ERROR);
  }
  const outcome = await launchDashboard(parsed, createRealEnv());
  process.exit(outcome.exitCode);
}
if (require.main === module) {
  void main();
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  BENCHMARK_PACKAGE_NAME,
  BENCHMARK_REPO_URL_DEFAULT,
  DEFAULT_PORT,
  EXIT_ERROR,
  EXIT_NOT_READY,
  EXIT_OK,
  EXIT_REQUIRED_INSTALL,
  PORT_SCAN_SPAN,
  READINESS_POLL_INTERVAL_MS,
  READINESS_TIMEOUT_MS,
  createRealEnv,
  dashboardLogPath,
  dashboardRecordPath,
  discoverRunDirs,
  importRuns,
  launchDashboard,
  parseDashboardArgs,
  pickPort,
  readDashboardRecord,
  requiredInstallCommands,
  resolveBenchmarkCheckout,
  resolveProjectRoot,
  stopDashboard,
  updateBenchmarkCacheToLatest,
  waitForReady
});
