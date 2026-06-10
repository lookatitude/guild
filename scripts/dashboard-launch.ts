#!/usr/bin/env -S npx tsx
/**
 * scripts/dashboard-launch.ts
 *
 * Deterministic launcher for the local benchmark dashboard over THIS project's
 * runs + knowledge (v2-gap-closure G-16 / SC-11; initiative guild-dashboard
 * WI-3). Invoked by skills/meta/dashboard/SKILL.md (thin /guild:dashboard
 * command → guild:dashboard skill → this script).
 *
 * What it does, in order:
 *   1. Resolve the project root (--project-root, else the guild root of cwd —
 *      nearest ancestor containing `.guild/`).
 *   2. Resolve the benchmark checkout:
 *        (1) workspace sibling   <project-root>/../benchmark  (package.json
 *            name must match BENCHMARK_PACKAGE_NAME)
 *        (1b) in-repo            <project-root>/benchmark     (same name check;
 *            covers the guild self-repo where benchmark/ is a subdirectory)
 *        (2) cached clone        <project-root>/.guild/cache/benchmark
 *        (3) else                REQUIRED-INSTALL → exit 3
 *   3. If a durable PID record (<project-root>/.guild/cache/dashboard.json)
 *      points at a LIVE server (pid alive + port answering /api/runs), REUSE
 *      it — never spawn a second server; a stale/malformed record is removed.
 *   3b. Pick a free port (default 3055; next free if bound).
 *   4. Spawn `npm run benchmark -- serve --port <p> --project-root <root>`
 *      detached (the dashboard must outlive the launcher so the operator can
 *      browse) but MANAGED, never a fire-and-forget daemon (codex G-lane fix —
 *      printed-PID-only tracking violated the session-scoped/no-daemon
 *      posture): stdout/stderr go to .guild/cache/dashboard.log, and a durable
 *      PID record {pid, port, project_root, benchmark_dir, started_at} is
 *      written atomically (temp+rename) to .guild/cache/dashboard.json
 *      immediately after spawn. `--stop` gives the managed shutdown.
 *   5. Poll GET /api/runs until ready.
 *   6. Unless --no-import: POST each discovered run dir (those with
 *      logs/v1.4-events.jsonl) to POST /api/imports/lifecycle {run_dir}.
 *      Per-run failures are reported, never fatal.
 *   7. Print the dashboard URL.
 *
 * `--stop`: read the PID record, liveness-check (signal 0), SIGTERM the
 * server's process group (detached spawn ⇒ group leader), remove the record,
 * report. A stale record (dead pid) is just cleaned up + reported.
 *
 * NETWORK / INSTALL GATING (codex G-plan finding #2 — binding):
 *   This script performs NO network I/O and NO package installation by
 *   default. `git clone` and `npm ci` run ONLY under --install (the calling
 *   skill passes it after an explicit interactive confirmation — network is
 *   always-ask class). Without --install, when a clone or dependency install
 *   would be needed, the script prints the exact commands the operator should
 *   approve and exits 3 (EXIT_REQUIRED_INSTALL). The localhost readiness poll
 *   + import POSTs are loopback-only (127.0.0.1) and not gated.
 *
 * Telemetry split preserved: integration with the benchmark is process +
 * localhost-HTTP-by-format only. Zero code imports in either direction.
 *
 * Exit codes: 0 success · 1 arg/launch error · 2 readiness timeout ·
 *             3 REQUIRED-INSTALL (commands printed, nothing executed).
 *
 * Contract pointers (PINNED — .guild/spec/v2-gap-closure.md §"The cross-repo
 * dashboard contract"; never redefined here):
 *   - serve flag:  `serve [--port <n>] [--project-root <abs-path>]`
 *   - import:      existing `POST /api/imports/lifecycle {run_dir}` — once per
 *                  run dir (benchmark/src/server.ts).
 *   - security:    server binds 127.0.0.1; project routes read-only.
 *
 * All seams (fs/spawn/fetch/port/sleep) are injectable so tests run without
 * network or processes; `createRealEnv()` is the real adapter (same pattern as
 * scripts/lib/run-lifecycle.ts). Run-dir discovery additionally has a
 * real-path test on a temp fixture tree (injected-seam tests mask real-path
 * misses — this repo's #1 recurring defect class).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as net from "node:net";
import { spawn, spawnSync } from "node:child_process";

// ── Constants ────────────────────────────────────────────────────────────────

/** package.json `name` that identifies a benchmark checkout. */
export const BENCHMARK_PACKAGE_NAME = "@guild/benchmark";

/**
 * Clone source for the REQUIRED-INSTALL instructions. PLACEHOLDER — the
 * benchmark currently ships as a directory of the guild repo, not a standalone
 * remote; the printed command clones the umbrella repo. Override per-machine
 * with GUILD_BENCHMARK_REPO_URL.
 */
export const BENCHMARK_REPO_URL_DEFAULT =
  "https://github.com/lookatitude/guild.git";

export const DEFAULT_PORT = 3055;
/** How many sequential ports to try past the default before giving up. */
export const PORT_SCAN_SPAN = 20;
export const READINESS_TIMEOUT_MS = 30_000;
export const READINESS_POLL_INTERVAL_MS = 500;

export const EXIT_OK = 0;
export const EXIT_ERROR = 1;
export const EXIT_NOT_READY = 2;
export const EXIT_REQUIRED_INSTALL = 3;

// ── Injectable environment (seams) ──────────────────────────────────────────

export interface SpawnedProc {
  pid: number;
}

export interface ExecCall {
  cmd: string;
  args: string[];
  cwd?: string;
}

export interface LaunchEnv {
  /** True when `p` exists (file or dir). */
  exists(p: string): boolean;
  /** True when `p` exists and is a directory. */
  isDirectory(p: string): boolean;
  /** utf-8 file read; throws on missing. */
  readFile(p: string): string;
  /** Names in directory `p`; [] when missing/not-a-dir. */
  readDir(p: string): string[];
  /** mkdir -p. */
  mkdirp(p: string): void;
  /** Atomic write (temp + rename) — the durable PID record. */
  writeFileAtomic(p: string, content: string): void;
  /** rm -f (no error when missing). */
  removeFile(p: string): void;
  /** True when `pid` is a live process (signal 0 probe). */
  isProcessAlive(pid: number): boolean;
  /** SIGTERM the server's process group (detached spawn ⇒ group leader). */
  killProcess(pid: number): void;
  /**
   * Run a foreground command to completion (git clone / npm ci — --install
   * path ONLY). Returns the exit code.
   */
  execSync(cmd: string, args: string[], opts: { cwd?: string }): number;
  /**
   * Spawn the server: detached from this process's lifetime (so the launcher
   * can exit and the operator can browse) but MANAGED — stdout/stderr are
   * appended to `logPath`, and the caller records the PID durably so `--stop`
   * can terminate it.
   */
  spawnDetached(
    cmd: string,
    args: string[],
    opts: { cwd: string; logPath: string },
  ): SpawnedProc;
  /** Loopback-only HTTP (readiness poll + lifecycle imports). */
  fetchFn(
    url: string,
    init?: { method?: string; headers?: Record<string, string>; body?: string },
  ): Promise<{ status: number; text(): Promise<string> }>;
  /** True when 127.0.0.1:<port> is free to bind. */
  isPortFree(port: number): Promise<boolean>;
  sleep(ms: number): Promise<void>;
  log(line: string): void;
  /** Monotonic-enough clock for the readiness deadline. */
  now(): number;
}

/** Real adapter — node:fs / node:child_process / global fetch / node:net. */
export function createRealEnv(): LaunchEnv {
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
      // Detached spawn makes the child its process-group leader: -pid signals
      // the whole group (npm wrapper + tsx server). Fall back to the single
      // pid when group signaling is unavailable.
      try {
        process.kill(-pid, "SIGTERM");
      } catch {
        try {
          process.kill(pid, "SIGTERM");
        } catch {
          /* already gone */
        }
      }
    },
    execSync: (cmd, args, opts) => {
      const res = spawnSync(cmd, args, {
        cwd: opts.cwd,
        stdio: "inherit",
      });
      return res.status ?? 1;
    },
    spawnDetached: (cmd, args, opts) => {
      const fd = fs.openSync(opts.logPath, "a");
      const child = spawn(cmd, args, {
        cwd: opts.cwd,
        detached: true,
        stdio: ["ignore", fd, fd],
      });
      child.unref();
      fs.closeSync(fd);
      return { pid: child.pid ?? -1 };
    },
    fetchFn: async (url, init) => {
      const res = await fetch(url, init);
      return { status: res.status, text: () => res.text() };
    },
    isPortFree: (port) =>
      new Promise((resolvePromise) => {
        const srv = net.createServer();
        srv.once("error", () => resolvePromise(false));
        srv.once("listening", () => {
          srv.close(() => resolvePromise(true));
        });
        srv.listen(port, "127.0.0.1");
      }),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    log: (line) => process.stdout.write(`${line}\n`),
    now: () => Date.now(),
  };
}

// ── Arg parsing (pure) ───────────────────────────────────────────────────────

export interface DashboardArgs {
  projectRoot?: string;
  port: number;
  noImport: boolean;
  install: boolean;
  dryRun: boolean;
  stop: boolean;
}

export function parseDashboardArgs(
  argv: string[],
): DashboardArgs | { error: string } {
  const args: DashboardArgs = {
    port: DEFAULT_PORT,
    noImport: false,
    install: false,
    dryRun: false,
    stop: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--project-root" && argv[i + 1] !== undefined) {
      args.projectRoot = argv[++i];
    } else if (arg.startsWith("--project-root=")) {
      args.projectRoot = arg.slice("--project-root=".length);
    } else if (arg === "--port" && argv[i + 1] !== undefined) {
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
  if (args.projectRoot !== undefined && !path.isAbsolute(args.projectRoot)) {
    return { error: `--project-root must be an absolute path` };
  }
  return args;
}

// ── Project-root resolution ──────────────────────────────────────────────────

/**
 * Nearest ancestor of `cwd` (inclusive) containing a `.guild/` directory;
 * `null` when none — the caller errors out (the dashboard is meaningless
 * without a `.guild/` tree to read).
 */
export function resolveProjectRoot(cwd: string, env: LaunchEnv): string | null {
  let dir = path.resolve(cwd);
  for (;;) {
    if (env.isDirectory(path.join(dir, ".guild"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

// ── Durable PID record (managed server tracking — codex G-lane fix) ─────────

export interface DashboardRecord {
  pid: number;
  port: number;
  project_root: string;
  benchmark_dir: string;
  started_at: string;
}

export function dashboardRecordPath(projectRoot: string): string {
  return path.join(projectRoot, ".guild", "cache", "dashboard.json");
}

export function dashboardLogPath(projectRoot: string): string {
  return path.join(projectRoot, ".guild", "cache", "dashboard.log");
}

/** Parse the PID record; `null` when missing or malformed. */
export function readDashboardRecord(
  projectRoot: string,
  env: LaunchEnv,
): DashboardRecord | null {
  const p = dashboardRecordPath(projectRoot);
  if (!env.exists(p)) return null;
  try {
    const raw = JSON.parse(env.readFile(p)) as Partial<DashboardRecord>;
    if (
      typeof raw.pid !== "number" ||
      !Number.isInteger(raw.pid) ||
      raw.pid <= 0 ||
      typeof raw.port !== "number"
    ) {
      return null;
    }
    return {
      pid: raw.pid,
      port: raw.port,
      project_root: raw.project_root ?? projectRoot,
      benchmark_dir: raw.benchmark_dir ?? "",
      started_at: raw.started_at ?? "",
    };
  } catch {
    return null;
  }
}

/**
 * `--stop`: managed shutdown. Reads the record, liveness-checks the pid,
 * SIGTERMs the process group when alive, removes the record either way.
 * Always exits 0 (a clean stop and a stale-record cleanup are both success).
 */
export function stopDashboard(
  projectRoot: string,
  env: LaunchEnv,
): LaunchOutcome {
  const recordPath = dashboardRecordPath(projectRoot);
  if (!env.exists(recordPath)) {
    env.log(
      `[dashboard-launch] --stop: no dashboard record at ${recordPath} — nothing to stop`,
    );
    return { exitCode: EXIT_OK };
  }
  const record = readDashboardRecord(projectRoot, env);
  if (!record) {
    env.removeFile(recordPath);
    env.log(
      `[dashboard-launch] --stop: malformed record at ${recordPath} — removed; ` +
        `nothing to kill (check manually with \`ps\` if a server is still running)`,
    );
    return { exitCode: EXIT_OK };
  }
  if (env.isProcessAlive(record.pid)) {
    env.killProcess(record.pid);
    env.removeFile(recordPath);
    env.log(
      `[dashboard-launch] stopped dashboard server (pid ${record.pid}, ` +
        `port ${record.port}); record removed`,
    );
  } else {
    env.removeFile(recordPath);
    env.log(
      `[dashboard-launch] --stop: stale record — pid ${record.pid} is not ` +
        `running; record removed, nothing to kill`,
    );
  }
  return { exitCode: EXIT_OK };
}

// ── Benchmark-checkout resolution ────────────────────────────────────────────

export type CheckoutResolution =
  | { kind: "sibling" | "in-repo" | "cache"; dir: string; needsInstall: boolean }
  | { kind: "required-install"; cacheDir: string };

function isBenchmarkCheckout(dir: string, env: LaunchEnv): boolean {
  const pkgPath = path.join(dir, "package.json");
  if (!env.exists(pkgPath)) return false;
  try {
    const pkg = JSON.parse(env.readFile(pkgPath)) as { name?: string };
    return pkg.name === BENCHMARK_PACKAGE_NAME;
  } catch {
    return false;
  }
}

/**
 * Resolution order (lane contract): (1) workspace sibling
 * `<project-root>/../benchmark`; (1b) in-repo `<project-root>/benchmark`
 * (the guild umbrella repo carries benchmark/ as a subdirectory); (2) cached
 * clone `<project-root>/.guild/cache/benchmark`; (3) REQUIRED-INSTALL.
 * Every candidate must have package.json name === BENCHMARK_PACKAGE_NAME.
 */
export function resolveBenchmarkCheckout(
  projectRoot: string,
  env: LaunchEnv,
): CheckoutResolution {
  const candidates: Array<{ kind: "sibling" | "in-repo" | "cache"; dir: string }> = [
    { kind: "sibling", dir: path.join(path.dirname(projectRoot), "benchmark") },
    { kind: "in-repo", dir: path.join(projectRoot, "benchmark") },
    { kind: "cache", dir: path.join(projectRoot, ".guild", "cache", "benchmark") },
  ];
  for (const cand of candidates) {
    if (isBenchmarkCheckout(cand.dir, env)) {
      return {
        kind: cand.kind,
        dir: cand.dir,
        needsInstall: !env.isDirectory(path.join(cand.dir, "node_modules")),
      };
    }
  }
  return {
    kind: "required-install",
    cacheDir: path.join(projectRoot, ".guild", "cache", "benchmark"),
  };
}

/** The exact operator-approvable commands for the REQUIRED-INSTALL states. */
export function requiredInstallCommands(
  resolution: CheckoutResolution,
  repoUrl: string,
): string[] {
  if (resolution.kind === "required-install") {
    return [
      `git clone ${repoUrl} ${resolution.cacheDir}`,
      `cd ${resolution.cacheDir} && npm ci`,
    ];
  }
  // Checkout present but dependencies missing — install only.
  return [`cd ${resolution.dir} && npm ci`];
}

// ── Port selection ───────────────────────────────────────────────────────────

/** `preferred` if free, else the next free port within PORT_SCAN_SPAN. */
export async function pickPort(
  preferred: number,
  env: LaunchEnv,
): Promise<number | null> {
  for (let p = preferred; p < preferred + PORT_SCAN_SPAN && p <= 65535; p++) {
    if (await env.isPortFree(p)) return p;
  }
  return null;
}

// ── Run-dir discovery ────────────────────────────────────────────────────────

/**
 * Absolute paths of `<project-root>/.guild/runs/<id>` dirs that contain
 * `logs/v1.4-events.jsonl` (the lifecycle-import contract input). Sorted for
 * deterministic output. Real-path covered by a temp-fixture test.
 */
export function discoverRunDirs(projectRoot: string, env: LaunchEnv): string[] {
  const runsRoot = path.join(projectRoot, ".guild", "runs");
  const out: string[] = [];
  for (const name of env.readDir(runsRoot)) {
    const runDir = path.join(runsRoot, name);
    if (!env.isDirectory(runDir)) continue;
    if (env.exists(path.join(runDir, "logs", "v1.4-events.jsonl"))) {
      out.push(runDir);
    }
  }
  return out.sort();
}

// ── Readiness poll ───────────────────────────────────────────────────────────

/** Poll GET /api/runs (cheapest always-on route) until 200 or deadline. */
export async function waitForReady(
  port: number,
  env: LaunchEnv,
  timeoutMs: number = READINESS_TIMEOUT_MS,
): Promise<boolean> {
  const deadline = env.now() + timeoutMs;
  for (;;) {
    try {
      const res = await env.fetchFn(`http://127.0.0.1:${port}/api/runs`);
      if (res.status === 200) return true;
    } catch {
      // server not up yet — keep polling
    }
    if (env.now() >= deadline) return false;
    await env.sleep(READINESS_POLL_INTERVAL_MS);
  }
}

// ── Lifecycle import loop ────────────────────────────────────────────────────

export interface ImportResult {
  runDir: string;
  ok: boolean;
  /** run_id from the 201 body, when ok. */
  runId?: string;
  error?: string;
}

/**
 * POST each run dir to /api/imports/lifecycle {run_dir} (pinned contract —
 * benchmark/src/server.ts). Per-run failures are recorded, never thrown.
 */
export async function importRuns(
  port: number,
  runDirs: string[],
  env: LaunchEnv,
): Promise<ImportResult[]> {
  const results: ImportResult[] = [];
  for (const runDir of runDirs) {
    try {
      const res = await env.fetchFn(
        `http://127.0.0.1:${port}/api/imports/lifecycle`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ run_dir: runDir }),
        },
      );
      const text = await res.text();
      if (res.status === 201) {
        let runId: string | undefined;
        try {
          runId = (JSON.parse(text) as { run_id?: string }).run_id;
        } catch {
          /* tolerate non-JSON 201 bodies */
        }
        results.push({ runDir, ok: true, ...(runId ? { runId } : {}) });
      } else {
        let message = text;
        try {
          message = (JSON.parse(text) as { error?: string }).error ?? text;
        } catch {
          /* keep raw text */
        }
        results.push({
          runDir,
          ok: false,
          error: `HTTP ${res.status}: ${message}`,
        });
      }
    } catch (e) {
      results.push({ runDir, ok: false, error: (e as Error).message });
    }
  }
  return results;
}

// ── Orchestration ────────────────────────────────────────────────────────────

export interface LaunchOutcome {
  exitCode: number;
  url?: string;
  pid?: number;
  port?: number;
  importResults?: ImportResult[];
}

export async function launchDashboard(
  args: DashboardArgs,
  env: LaunchEnv,
  cwd: string = process.cwd(),
  repoUrl: string = process.env.GUILD_BENCHMARK_REPO_URL ??
    BENCHMARK_REPO_URL_DEFAULT,
): Promise<LaunchOutcome> {
  // 1. Project root.
  const projectRoot = args.projectRoot ?? resolveProjectRoot(cwd, env);
  if (!projectRoot) {
    env.log(
      `[dashboard-launch] ERROR: no .guild/ directory found at or above ${cwd}; ` +
        `pass --project-root <abs> or run /guild:init first`,
    );
    return { exitCode: EXIT_ERROR };
  }
  if (!env.isDirectory(path.join(projectRoot, ".guild"))) {
    env.log(
      `[dashboard-launch] ERROR: ${projectRoot} has no .guild/ directory — ` +
        `the dashboard reads .guild/runs + .guild/wiki + .guild/indexes`,
    );
    return { exitCode: EXIT_ERROR };
  }

  // 1b. --stop: managed shutdown via the durable PID record.
  if (args.stop) {
    return stopDashboard(projectRoot, env);
  }

  // 1c. Reuse a live managed server instead of spawning a second one. A
  // record whose pid is dead or whose port no longer answers is stale —
  // removed, then launch proceeds normally. (Skipped under --dry-run: no I/O.)
  const recordPath = dashboardRecordPath(projectRoot);
  if (!args.dryRun && env.exists(recordPath)) {
    const record = readDashboardRecord(projectRoot, env);
    const alive =
      record !== null &&
      env.isProcessAlive(record.pid) &&
      (await waitForReady(record.port, env, 0));
    if (record && alive) {
      const url = `http://127.0.0.1:${record.port}/`;
      env.log(
        `[dashboard-launch] reusing running dashboard (pid ${record.pid}, ` +
          `port ${record.port}, started ${record.started_at})`,
      );
      let importResults: ImportResult[] = [];
      if (!args.noImport) {
        const runDirs = discoverRunDirs(projectRoot, env);
        importResults = await importRuns(record.port, runDirs, env);
        const ok = importResults.filter((r) => r.ok).length;
        env.log(
          `[dashboard-launch] imported ${ok}/${importResults.length} run(s)`,
        );
      }
      env.log(`[dashboard-launch] dashboard ready: ${url}`);
      env.log(`[dashboard-launch] stop it with: dashboard-launch.ts --stop`);
      return {
        exitCode: EXIT_OK,
        url,
        pid: record.pid,
        port: record.port,
        importResults,
      };
    }
    env.log(
      `[dashboard-launch] stale dashboard record at ${recordPath} ` +
        `(server not running) — cleaning up`,
    );
    env.removeFile(recordPath);
  }

  // 2. Benchmark checkout — NO network by default.
  let resolution = resolveBenchmarkCheckout(projectRoot, env);
  if (resolution.kind === "required-install" && args.install && !args.dryRun) {
    // --install: the calling skill confirmed interactively. Clone + install.
    const cacheDir = resolution.cacheDir;
    env.mkdirp(path.dirname(cacheDir));
    env.log(`[dashboard-launch] cloning benchmark → ${cacheDir}`);
    const cloneCode = env.execSync("git", ["clone", repoUrl, cacheDir], {});
    if (cloneCode !== 0) {
      env.log(`[dashboard-launch] ERROR: git clone failed (exit ${cloneCode})`);
      return { exitCode: EXIT_ERROR };
    }
    resolution = resolveBenchmarkCheckout(projectRoot, env);
    if (resolution.kind === "required-install") {
      env.log(
        `[dashboard-launch] ERROR: clone completed but ${cacheDir} is not a ` +
          `benchmark checkout (package.json name !== ${BENCHMARK_PACKAGE_NAME}); ` +
          `if the benchmark lives in a subdirectory of the cloned repo, move it ` +
          `to ${cacheDir} manually`,
      );
      return { exitCode: EXIT_ERROR };
    }
  } else if (resolution.kind === "required-install") {
    const cmds = requiredInstallCommands(resolution, repoUrl);
    env.log(
      `[dashboard-launch] REQUIRED-INSTALL: no benchmark checkout found ` +
        `(looked: sibling ${path.join(path.dirname(projectRoot), "benchmark")}, ` +
        `in-repo ${path.join(projectRoot, "benchmark")}, cache ${resolution.cacheDir}).`,
    );
    env.log(
      `[dashboard-launch] No network I/O is performed without --install. ` +
        `Run these commands (or re-run with --install after confirming):`,
    );
    for (const cmd of cmds) env.log(`  ${cmd}`);
    return { exitCode: EXIT_REQUIRED_INSTALL };
  }

  // 2b. Dependencies — npm ci is also install-gated (no network by default).
  if (resolution.needsInstall && !args.dryRun) {
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
        `[dashboard-launch] REQUIRED-INSTALL: benchmark checkout at ` +
          `${resolution.dir} has no node_modules. No network I/O is performed ` +
          `without --install. Run (or re-run with --install after confirming):`,
      );
      for (const cmd of cmds) env.log(`  ${cmd}`);
      return { exitCode: EXIT_REQUIRED_INSTALL };
    }
  }

  // 3. Port.
  const port = args.dryRun ? args.port : await pickPort(args.port, env);
  if (port === null) {
    env.log(
      `[dashboard-launch] ERROR: no free port in ${args.port}..${
        args.port + PORT_SCAN_SPAN - 1
      }`,
    );
    return { exitCode: EXIT_ERROR };
  }
  if (!args.dryRun && port !== args.port) {
    env.log(
      `[dashboard-launch] port ${args.port} is busy — using ${port} instead`,
    );
  }

  // 3b. Dry-run: print the plan, execute nothing.
  const runDirs = args.noImport ? [] : discoverRunDirs(projectRoot, env);
  if (args.dryRun) {
    env.log(`[dashboard-launch] DRY-RUN — nothing executed. Plan:`);
    env.log(`  project-root : ${projectRoot}`);
    env.log(`  benchmark    : ${resolution.dir} (${resolution.kind})`);
    if (resolution.needsInstall) {
      env.log(`  install      : node_modules missing — would need --install`);
    }
    env.log(
      `  serve        : npm run benchmark -- serve --port ${port} ` +
        `--project-root ${projectRoot}  (cwd: ${resolution.dir})`,
    );
    env.log(
      args.noImport
        ? `  import       : skipped (--no-import)`
        : `  import       : ${runDirs.length} run dir(s) → POST /api/imports/lifecycle`,
    );
    env.log(`  url          : http://127.0.0.1:${port}/`);
    if (env.exists(recordPath)) {
      env.log(
        `  record       : ${recordPath} exists — a live server would be reused`,
      );
    }
    return { exitCode: EXIT_OK, port };
  }

  // 4. Spawn the server — detached but MANAGED: output to a log file, PID
  // recorded durably (atomic temp+rename) so --stop can terminate it.
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
      projectRoot,
    ],
    { cwd: resolution.dir, logPath },
  );
  const record: DashboardRecord = {
    pid: proc.pid,
    port,
    project_root: projectRoot,
    benchmark_dir: resolution.dir,
    started_at: new Date(env.now()).toISOString(),
  };
  env.writeFileAtomic(recordPath, `${JSON.stringify(record, null, 2)}\n`);
  env.log(
    `[dashboard-launch] server starting (pid ${proc.pid}; log: ${logPath}; ` +
      `record: ${recordPath})`,
  );
  env.log(
    `[dashboard-launch] stop with: dashboard-launch.ts --stop (or kill ${proc.pid})`,
  );

  // 5. Readiness.
  const ready = await waitForReady(port, env);
  if (!ready) {
    env.log(
      `[dashboard-launch] ERROR: server did not become ready within ` +
        `${READINESS_TIMEOUT_MS / 1000}s (GET http://127.0.0.1:${port}/api/runs). ` +
        `Inspect ${logPath}, then clean up with: dashboard-launch.ts --stop`,
    );
    return { exitCode: EXIT_NOT_READY, pid: proc.pid, port };
  }

  // 6. Lifecycle imports (unless --no-import). Non-fatal per-run.
  let importResults: ImportResult[] = [];
  if (!args.noImport) {
    importResults = await importRuns(port, runDirs, env);
    const ok = importResults.filter((r) => r.ok).length;
    const failed = importResults.length - ok;
    env.log(
      `[dashboard-launch] imported ${ok}/${importResults.length} run(s)` +
        (failed > 0 ? ` (${failed} failed — non-fatal)` : ``),
    );
    for (const r of importResults) {
      env.log(
        r.ok
          ? `  ok   ${path.basename(r.runDir)}${r.runId ? ` → ${r.runId}` : ``}`
          : `  FAIL ${path.basename(r.runDir)} — ${r.error}`,
      );
    }
  } else {
    env.log(`[dashboard-launch] import skipped (--no-import)`);
  }

  // 7. URL.
  const url = `http://127.0.0.1:${port}/`;
  env.log(`[dashboard-launch] dashboard ready: ${url}`);
  env.log(
    `[dashboard-launch] stop the server with: dashboard-launch.ts --stop ` +
      `(or kill ${proc.pid})`,
  );
  return { exitCode: EXIT_OK, url, pid: proc.pid, port, importResults };
}

// ── CLI entrypoint ───────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const parsed = parseDashboardArgs(process.argv.slice(2));
  if ("error" in parsed) {
    process.stderr.write(`[dashboard-launch] ${parsed.error}\n`);
    process.stderr.write(
      `Usage: dashboard-launch.ts [--project-root <abs>] [--port <n>] ` +
        `[--no-import] [--install] [--dry-run] [--stop]\n`,
    );
    process.exit(EXIT_ERROR);
  }
  const outcome = await launchDashboard(parsed, createRealEnv());
  process.exit(outcome.exitCode);
}

if (require.main === module) {
  void main();
}
