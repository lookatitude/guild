/**
 * __tests__/dashboard-launch.test.ts
 *
 * Lane P4 (v2-gap-closure G-16 / SC-11). Covers:
 *   1. REQUIRED-INSTALL exit-3 path — the default path performs NO network
 *      commands (zero git/npm spawns through the exec/spawn seams) — codex
 *      G-plan finding #2, binding.
 *   2. Sibling-resolve happy path on a fixture workspace tree.
 *   3. Import loop — N run dirs → N POSTs with the pinned {run_dir} body;
 *      per-run failure non-fatal.
 *   4. Port-busy fallback (3055 bound → next free picked, threaded to spawn).
 *   5. REAL-PATH run-dir discovery on a temp fixture tree (2 valid + 1
 *      invalid) — seam-only tests mask real-path misses (repo pitfall).
 *   6. Managed server tracking (codex G-lane rework): durable PID record
 *      written atomically on launch; --stop kills + removes the record;
 *      stale-record cleanup; reuse-when-alive (no second spawn).
 *   7. REAL-PROCESS --stop (codex G-lane round 2): a real detached child
 *      (its own process-group leader) is actually terminated by the --stop
 *      path with the REAL env — no kill/liveness seams.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawn } from "node:child_process";

import {
  BENCHMARK_PACKAGE_NAME,
  DEFAULT_PORT,
  EXIT_OK,
  EXIT_REQUIRED_INSTALL,
  createRealEnv,
  dashboardRecordPath,
  discoverRunDirs,
  importRuns,
  launchDashboard,
  parseDashboardArgs,
  pickPort,
  resolveBenchmarkCheckout,
  resolveProjectRoot,
  stopDashboard,
  type DashboardArgs,
  type DashboardRecord,
  type ExecCall,
  type LaunchEnv,
} from "../dashboard-launch";

// ── Fake env ─────────────────────────────────────────────────────────────────

interface FetchCall {
  url: string;
  method: string;
  body?: string;
}

interface FakeEnv extends LaunchEnv {
  execCalls: ExecCall[];
  spawnCalls: ExecCall[];
  spawnLogPaths: string[];
  fetchCalls: FetchCall[];
  killCalls: number[];
  atomicWrites: Array<{ path: string; content: string }>;
  removedFiles: string[];
  logs: string[];
}

/**
 * Fake-fs map: dirs end with "/", files map path → content. All paths
 * absolute, POSIX-joined via node:path (tests run on darwin/linux).
 */
/** Normalize + strip trailing slashes so "/a/b/" and "/a/b" compare equal. */
function norm(p: string): string {
  const n = path.normalize(p).replace(/[\\/]+$/, "");
  return n === "" ? path.sep : n;
}

function makeFakeEnv(files: Record<string, string | null>, opts?: {
  busyPorts?: number[];
  fetchImpl?: LaunchEnv["fetchFn"];
  /** PIDs reported alive by the isProcessAlive seam (default: none). */
  alivePids?: number[];
}): FakeEnv {
  const dirs = new Set<string>();
  const fileMap = new Map<string, string>();
  for (const [p, content] of Object.entries(files)) {
    if (content === null) {
      dirs.add(norm(p));
    } else {
      fileMap.set(norm(p), content);
    }
    // register all ancestor dirs
    let dir = path.dirname(norm(p));
    for (;;) {
      dirs.add(dir);
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  const busy = new Set(opts?.busyPorts ?? []);
  const alive = new Set(opts?.alivePids ?? []);
  const env: FakeEnv = {
    execCalls: [],
    spawnCalls: [],
    spawnLogPaths: [],
    fetchCalls: [],
    killCalls: [],
    atomicWrites: [],
    removedFiles: [],
    logs: [],
    exists: (p) => fileMap.has(norm(p)) || dirs.has(norm(p)),
    isDirectory: (p) => dirs.has(norm(p)),
    readFile: (p) => {
      const v = fileMap.get(norm(p));
      if (v === undefined) throw new Error(`ENOENT: ${p}`);
      return v;
    },
    readDir: (p) => {
      const parent = norm(p);
      if (!dirs.has(parent)) return [];
      const names = new Set<string>();
      for (const candidate of [...fileMap.keys(), ...dirs]) {
        if (candidate !== parent && path.dirname(candidate) === parent) {
          names.add(path.basename(candidate));
        }
      }
      return [...names];
    },
    mkdirp: (p) => {
      dirs.add(norm(p));
    },
    writeFileAtomic: (p, content) => {
      env.atomicWrites.push({ path: norm(p), content });
      fileMap.set(norm(p), content);
    },
    removeFile: (p) => {
      env.removedFiles.push(norm(p));
      fileMap.delete(norm(p));
    },
    isProcessAlive: (pid) => alive.has(pid),
    killProcess: (pid) => {
      env.killCalls.push(pid);
      alive.delete(pid);
    },
    execSync: (cmd, args, o) => {
      env.execCalls.push({ cmd, args, ...(o.cwd ? { cwd: o.cwd } : {}) });
      return 0;
    },
    spawnDetached: (cmd, args, o) => {
      env.spawnCalls.push({ cmd, args, cwd: o.cwd });
      env.spawnLogPaths.push(norm(o.logPath));
      return { pid: 4242 };
    },
    fetchFn:
      opts?.fetchImpl ??
      (async (url, init) => {
        env.fetchCalls.push({
          url,
          method: init?.method ?? "GET",
          ...(init?.body ? { body: init.body } : {}),
        });
        if (url.endsWith("/api/runs")) {
          return { status: 200, text: async () => `{"runs":[],"total":0}` };
        }
        return {
          status: 201,
          text: async () => `{"run_id":"imported-x"}`,
        };
      }),
    isPortFree: async (port) => !busy.has(port),
    sleep: async () => {},
    log: (line) => env.logs.push(line),
    now: () => Date.now(),
  };
  // Wrap fetchFn so custom impls still record calls.
  if (opts?.fetchImpl) {
    const inner = env.fetchFn;
    env.fetchFn = async (url, init) => {
      env.fetchCalls.push({
        url,
        method: init?.method ?? "GET",
        ...(init?.body ? { body: init.body } : {}),
      });
      return inner(url, init);
    };
  }
  return env;
}

const benchmarkPkg = JSON.stringify({ name: BENCHMARK_PACKAGE_NAME });

/** Fixture workspace tree: /ws/{myproject,benchmark} — sibling layout. */
function siblingTree(): Record<string, string | null> {
  return {
    "/ws/myproject/.guild/": null,
    "/ws/myproject/.guild/runs/": null,
    "/ws/benchmark/package.json": benchmarkPkg,
    "/ws/benchmark/node_modules/": null,
  };
}

function args(overrides: Partial<DashboardArgs> = {}): DashboardArgs {
  return {
    port: DEFAULT_PORT,
    noImport: false,
    install: false,
    dryRun: false,
    stop: false,
    ...overrides,
  };
}

function recordJson(overrides: Partial<DashboardRecord> = {}): string {
  return JSON.stringify({
    pid: 9999,
    port: 3070,
    project_root: "/ws/myproject",
    benchmark_dir: "/ws/benchmark",
    started_at: "2026-06-10T00:00:00.000Z",
    ...overrides,
  });
}

// ── 1. REQUIRED-INSTALL exit-3 — no network commands by default ─────────────

describe("REQUIRED-INSTALL (default path performs no clone/install)", () => {
  test("no benchmark anywhere → exit 3, exact commands printed, ZERO exec/spawn", async () => {
    const env = makeFakeEnv({ "/ws/myproject/.guild/": null });
    const outcome = await launchDashboard(
      args({ projectRoot: "/ws/myproject" }),
      env,
    );

    expect(outcome.exitCode).toBe(EXIT_REQUIRED_INSTALL);
    // Binding assertion (codex finding #2): the default path spawns NOTHING —
    // no git, no npm, no server.
    expect(env.execCalls).toHaveLength(0);
    expect(env.spawnCalls).toHaveLength(0);
    expect(env.fetchCalls).toHaveLength(0);

    const text = env.logs.join("\n");
    expect(text).toContain("git clone");
    expect(text).toContain("/ws/myproject/.guild/cache/benchmark");
    expect(text).toContain("npm ci");
  });

  test("checkout present but node_modules missing → exit 3 with npm ci command, no spawns", async () => {
    const tree = siblingTree();
    delete tree["/ws/benchmark/node_modules/"];
    const env = makeFakeEnv(tree);
    const outcome = await launchDashboard(
      args({ projectRoot: "/ws/myproject" }),
      env,
    );

    expect(outcome.exitCode).toBe(EXIT_REQUIRED_INSTALL);
    expect(env.execCalls).toHaveLength(0);
    expect(env.spawnCalls).toHaveLength(0);
    const text = env.logs.join("\n");
    expect(text).toContain("npm ci");
    expect(text).not.toContain("git clone"); // checkout exists; only deps missing
  });

  test("--install runs git clone + npm ci through the exec seam", async () => {
    const env = makeFakeEnv({ "/ws/myproject/.guild/": null });
    const cachePkg = "/ws/myproject/.guild/cache/benchmark/package.json";
    // After the fake `git clone` exec, the cache dir becomes a valid checkout
    // (package.json present, node_modules still absent → npm ci must follow).
    const origExec = env.execSync;
    const origExists = env.exists;
    const origReadFile = env.readFile;
    env.execSync = (cmd, cmdArgs, o) => {
      const code = origExec(cmd, cmdArgs, o);
      if (cmd === "git") {
        env.exists = (p) => norm(p) === norm(cachePkg) || origExists(p);
        env.readFile = (p) =>
          norm(p) === norm(cachePkg) ? benchmarkPkg : origReadFile(p);
      }
      return code;
    };

    const outcome = await launchDashboard(
      args({ projectRoot: "/ws/myproject", install: true, noImport: true }),
      env,
    );

    expect(outcome.exitCode).toBe(EXIT_OK);
    expect(env.execCalls.map((c) => c.cmd)).toEqual(["git", "npm"]);
    expect(env.execCalls[0].args[0]).toBe("clone");
    expect(env.execCalls[0].args[2]).toBe(
      path.join("/ws/myproject", ".guild", "cache", "benchmark"),
    );
    expect(env.execCalls[1].args).toEqual(["ci"]);
  });

  test("--dry-run executes nothing even when install would be required", async () => {
    const env = makeFakeEnv({ "/ws/myproject/.guild/": null });
    const outcome = await launchDashboard(
      args({ projectRoot: "/ws/myproject", dryRun: true }),
      env,
    );
    // Dry-run on a missing checkout still reports REQUIRED-INSTALL (exit 3),
    // and executes nothing.
    expect(outcome.exitCode).toBe(EXIT_REQUIRED_INSTALL);
    expect(env.execCalls).toHaveLength(0);
    expect(env.spawnCalls).toHaveLength(0);
    expect(env.fetchCalls).toHaveLength(0);
  });
});

// ── 2. Sibling-resolve happy path ────────────────────────────────────────────

describe("sibling-resolve happy path", () => {
  test("workspace sibling benchmark is used; serve spawned with pinned flags", async () => {
    const tree = siblingTree();
    tree["/ws/myproject/.guild/runs/run-a/logs/v1.4-events.jsonl"] = "{}";
    const env = makeFakeEnv(tree);

    const outcome = await launchDashboard(
      args({ projectRoot: "/ws/myproject" }),
      env,
    );

    expect(outcome.exitCode).toBe(EXIT_OK);
    expect(outcome.url).toBe(`http://127.0.0.1:${DEFAULT_PORT}/`);
    expect(outcome.pid).toBe(4242);

    expect(env.spawnCalls).toHaveLength(1);
    const spawn = env.spawnCalls[0];
    expect(spawn.cmd).toBe("npm");
    expect(spawn.args).toEqual([
      "run",
      "benchmark",
      "--",
      "serve",
      "--port",
      String(DEFAULT_PORT),
      "--project-root",
      "/ws/myproject",
    ]);
    expect(spawn.cwd).toBe(path.normalize("/ws/benchmark"));

    // PID + stop instructions printed (session-scoped, no daemon).
    expect(env.logs.join("\n")).toContain("kill 4242");
  });

  test("resolveBenchmarkCheckout prefers sibling over cache", () => {
    const tree = siblingTree();
    tree["/ws/myproject/.guild/cache/benchmark/package.json"] = benchmarkPkg;
    const env = makeFakeEnv(tree);
    const res = resolveBenchmarkCheckout("/ws/myproject", env);
    expect(res.kind).toBe("sibling");
    if (res.kind !== "required-install") {
      expect(res.dir).toBe(path.normalize("/ws/benchmark"));
      expect(res.needsInstall).toBe(false);
    }
  });

  test("sibling with wrong package name is skipped; cache clone used", () => {
    const env = makeFakeEnv({
      "/ws/myproject/.guild/": null,
      "/ws/benchmark/package.json": JSON.stringify({ name: "not-benchmark" }),
      "/ws/myproject/.guild/cache/benchmark/package.json": benchmarkPkg,
      "/ws/myproject/.guild/cache/benchmark/node_modules/": null,
    });
    const res = resolveBenchmarkCheckout("/ws/myproject", env);
    expect(res.kind).toBe("cache");
  });

  test("in-repo benchmark/ (guild umbrella layout) resolves", () => {
    const env = makeFakeEnv({
      "/repo/.guild/": null,
      "/repo/benchmark/package.json": benchmarkPkg,
      "/repo/benchmark/node_modules/": null,
    });
    const res = resolveBenchmarkCheckout("/repo", env);
    expect(res.kind).toBe("in-repo");
  });

  test("resolveProjectRoot walks up to the nearest .guild ancestor", () => {
    const env = makeFakeEnv({ "/ws/myproject/.guild/": null });
    expect(resolveProjectRoot("/ws/myproject/src/deep", env)).toBe(
      path.normalize("/ws/myproject"),
    );
    expect(resolveProjectRoot("/elsewhere", env)).toBeNull();
  });
});

// ── 3. Import loop ───────────────────────────────────────────────────────────

describe("lifecycle import loop", () => {
  test("N run dirs → N POSTs to /api/imports/lifecycle with {run_dir} body", async () => {
    const env = makeFakeEnv({});
    const runDirs = [
      "/p/.guild/runs/run-a",
      "/p/.guild/runs/run-b",
      "/p/.guild/runs/run-c",
    ];
    const results = await importRuns(3055, runDirs, env);

    expect(results).toHaveLength(3);
    expect(results.every((r) => r.ok)).toBe(true);
    const posts = env.fetchCalls.filter((c) => c.method === "POST");
    expect(posts).toHaveLength(3);
    for (let i = 0; i < 3; i++) {
      expect(posts[i].url).toBe("http://127.0.0.1:3055/api/imports/lifecycle");
      expect(JSON.parse(posts[i].body!)).toEqual({ run_dir: runDirs[i] });
    }
  });

  test("per-run failure is recorded, not thrown; remaining imports proceed", async () => {
    let call = 0;
    const env = makeFakeEnv(
      {},
      {
        fetchImpl: async () => {
          call++;
          if (call === 2) {
            return {
              status: 400,
              text: async () => `{"error":"lifecycle import failed: bad log"}`,
            };
          }
          return { status: 201, text: async () => `{"run_id":"r${call}"}` };
        },
      },
    );
    const results = await importRuns(3055, ["/a", "/b", "/c"], env);
    expect(results.map((r) => r.ok)).toEqual([true, false, true]);
    expect(results[1].error).toContain("HTTP 400");
    expect(results[1].error).toContain("bad log");
    expect(results[0].runId).toBe("r1");
  });

  test("launch with 2 run dirs imports both; --no-import skips fetch imports", async () => {
    const tree = siblingTree();
    tree["/ws/myproject/.guild/runs/run-a/logs/v1.4-events.jsonl"] = "{}";
    tree["/ws/myproject/.guild/runs/run-b/logs/v1.4-events.jsonl"] = "{}";

    const env = makeFakeEnv(tree);
    const outcome = await launchDashboard(
      args({ projectRoot: "/ws/myproject" }),
      env,
    );
    expect(outcome.exitCode).toBe(EXIT_OK);
    expect(outcome.importResults).toHaveLength(2);
    const posts = env.fetchCalls.filter((c) => c.method === "POST");
    expect(posts).toHaveLength(2);
    expect(posts.map((p) => JSON.parse(p.body!).run_dir).sort()).toEqual([
      path.normalize("/ws/myproject/.guild/runs/run-a"),
      path.normalize("/ws/myproject/.guild/runs/run-b"),
    ]);

    const env2 = makeFakeEnv(tree);
    const outcome2 = await launchDashboard(
      args({ projectRoot: "/ws/myproject", noImport: true }),
      env2,
    );
    expect(outcome2.exitCode).toBe(EXIT_OK);
    expect(env2.fetchCalls.filter((c) => c.method === "POST")).toHaveLength(0);
  });
});

// ── 4. Port-busy fallback ────────────────────────────────────────────────────

describe("port-busy fallback", () => {
  test("default port bound → next free port picked and threaded to spawn + URL", async () => {
    const env = makeFakeEnv(siblingTree(), {
      busyPorts: [DEFAULT_PORT, DEFAULT_PORT + 1],
    });
    const outcome = await launchDashboard(
      args({ projectRoot: "/ws/myproject" }),
      env,
    );

    expect(outcome.exitCode).toBe(EXIT_OK);
    expect(outcome.port).toBe(DEFAULT_PORT + 2);
    expect(outcome.url).toBe(`http://127.0.0.1:${DEFAULT_PORT + 2}/`);
    const spawn = env.spawnCalls[0];
    expect(spawn.args).toContain(String(DEFAULT_PORT + 2));
    expect(spawn.args).not.toContain(String(DEFAULT_PORT));
    expect(env.logs.join("\n")).toContain(
      `port ${DEFAULT_PORT} is busy — using ${DEFAULT_PORT + 2}`,
    );
  });

  test("pickPort returns null when the whole scan span is busy", async () => {
    const busy = Array.from({ length: 30 }, (_, i) => 4000 + i);
    const env = makeFakeEnv({}, { busyPorts: busy });
    expect(await pickPort(4000, env)).toBeNull();
  });
});

// ── 5. REAL-PATH run-dir discovery (temp fixture tree, no seams) ────────────

describe("run-dir discovery — real filesystem", () => {
  let tmpRoot: string;

  beforeAll(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dashboard-launch-"));
    // 2 valid runs (logs/v1.4-events.jsonl present), 1 invalid (no log file).
    for (const run of ["run-valid-a", "run-valid-b"]) {
      const logs = path.join(tmpRoot, ".guild", "runs", run, "logs");
      fs.mkdirSync(logs, { recursive: true });
      fs.writeFileSync(
        path.join(logs, "v1.4-events.jsonl"),
        `{"v":"1.4","event":"run_started"}\n`,
      );
    }
    const invalid = path.join(tmpRoot, ".guild", "runs", "run-invalid");
    fs.mkdirSync(path.join(invalid, "handoffs"), { recursive: true });
    fs.writeFileSync(path.join(invalid, "run.yaml"), "id: run-invalid\n");
    // A stray plain file in runs/ must not crash or match.
    fs.writeFileSync(
      path.join(tmpRoot, ".guild", "runs", "current-run-id"),
      "run-valid-a\n",
    );
  });

  afterAll(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  test("discovers exactly the run dirs with logs/v1.4-events.jsonl", () => {
    const found = discoverRunDirs(tmpRoot, createRealEnv());
    expect(found).toEqual([
      path.join(tmpRoot, ".guild", "runs", "run-valid-a"),
      path.join(tmpRoot, ".guild", "runs", "run-valid-b"),
    ]);
  });

  test("missing .guild/runs/ → empty list, no throw", () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "dashboard-empty-"));
    try {
      expect(discoverRunDirs(empty, createRealEnv())).toEqual([]);
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
  });

  test("resolveProjectRoot resolves the temp fixture root from a nested cwd", () => {
    const nested = path.join(tmpRoot, "src", "deep");
    fs.mkdirSync(nested, { recursive: true });
    expect(resolveProjectRoot(nested, createRealEnv())).toBe(tmpRoot);
  });
});

// ── Arg parsing ──────────────────────────────────────────────────────────────

describe("parseDashboardArgs", () => {
  test("defaults", () => {
    const parsed = parseDashboardArgs([]);
    expect(parsed).toEqual({
      port: DEFAULT_PORT,
      noImport: false,
      install: false,
      dryRun: false,
      stop: false,
    });
  });

  test("all flags, both --flag value and --flag= forms", () => {
    const parsed = parseDashboardArgs([
      "--project-root",
      "/abs/p",
      "--port=4100",
      "--no-import",
      "--install",
      "--dry-run",
      "--stop",
    ]);
    expect(parsed).toEqual({
      projectRoot: "/abs/p",
      port: 4100,
      noImport: true,
      install: true,
      dryRun: true,
      stop: true,
    });
  });

  test("rejects unknown flags, bad ports, relative roots", () => {
    expect(parseDashboardArgs(["--nope"])).toHaveProperty("error");
    expect(parseDashboardArgs(["--port", "0"])).toHaveProperty("error");
    expect(parseDashboardArgs(["--port", "abc"])).toHaveProperty("error");
    expect(parseDashboardArgs(["--project-root", "rel/path"])).toHaveProperty(
      "error",
    );
  });
});

// ── 6. Managed server tracking — PID record / --stop / reuse (G-lane fix) ───

describe("managed server tracking (durable PID record)", () => {
  const RECORD = path.normalize(
    dashboardRecordPath("/ws/myproject"),
  );

  test("launch writes the PID record atomically + spawns with a log path", async () => {
    const env = makeFakeEnv(siblingTree());
    const outcome = await launchDashboard(
      args({ projectRoot: "/ws/myproject", noImport: true }),
      env,
    );

    expect(outcome.exitCode).toBe(EXIT_OK);
    // Atomic-write seam used exactly once, at the record path.
    expect(env.atomicWrites).toHaveLength(1);
    expect(env.atomicWrites[0].path).toBe(RECORD);
    const record = JSON.parse(env.atomicWrites[0].content) as DashboardRecord;
    expect(record.pid).toBe(4242);
    expect(record.port).toBe(DEFAULT_PORT);
    expect(record.project_root).toBe("/ws/myproject");
    expect(record.benchmark_dir).toBe(path.normalize("/ws/benchmark"));
    expect(typeof record.started_at).toBe("string");
    expect(record.started_at.length).toBeGreaterThan(0);
    // Child output goes to the log file, not "ignore"; path is printed.
    expect(env.spawnLogPaths).toEqual([
      path.normalize("/ws/myproject/.guild/cache/dashboard.log"),
    ]);
    expect(env.logs.join("\n")).toContain(".guild/cache/dashboard.log");
    expect(env.logs.join("\n")).toContain("--stop");
  });

  test("--stop with a live pid → kill + record removed", async () => {
    const tree = siblingTree();
    tree[RECORD] = recordJson();
    const env = makeFakeEnv(tree, { alivePids: [9999] });

    const outcome = await launchDashboard(
      args({ projectRoot: "/ws/myproject", stop: true }),
      env,
    );

    expect(outcome.exitCode).toBe(EXIT_OK);
    expect(env.killCalls).toEqual([9999]);
    expect(env.removedFiles).toEqual([RECORD]);
    expect(env.exists(RECORD)).toBe(false);
    // --stop never spawns/execs/fetches anything.
    expect(env.spawnCalls).toHaveLength(0);
    expect(env.execCalls).toHaveLength(0);
    expect(env.fetchCalls).toHaveLength(0);
    expect(env.logs.join("\n")).toContain("stopped dashboard server (pid 9999");
  });

  test("--stop with a stale record (dead pid) → no kill, record cleaned up", async () => {
    const tree = siblingTree();
    tree[RECORD] = recordJson();
    const env = makeFakeEnv(tree); // 9999 NOT alive

    const outcome = await launchDashboard(
      args({ projectRoot: "/ws/myproject", stop: true }),
      env,
    );

    expect(outcome.exitCode).toBe(EXIT_OK);
    expect(env.killCalls).toHaveLength(0);
    expect(env.removedFiles).toEqual([RECORD]);
    expect(env.logs.join("\n")).toContain("stale record");
  });

  test("--stop with no record → no-op success", async () => {
    const env = makeFakeEnv(siblingTree());
    const outcome = await launchDashboard(
      args({ projectRoot: "/ws/myproject", stop: true }),
      env,
    );
    expect(outcome.exitCode).toBe(EXIT_OK);
    expect(env.killCalls).toHaveLength(0);
    expect(env.removedFiles).toHaveLength(0);
    expect(env.logs.join("\n")).toContain("nothing to stop");
  });

  test("stopDashboard removes a malformed record without killing", () => {
    const tree = siblingTree();
    tree[RECORD] = `{"not":"a-record"}`;
    const env = makeFakeEnv(tree, { alivePids: [9999] });
    const outcome = stopDashboard("/ws/myproject", env);
    expect(outcome.exitCode).toBe(EXIT_OK);
    expect(env.killCalls).toHaveLength(0);
    expect(env.removedFiles).toEqual([RECORD]);
  });

  test("reuse-when-alive: live record → NO second spawn; imports run against it", async () => {
    const tree = siblingTree();
    tree["/ws/myproject/.guild/runs/run-a/logs/v1.4-events.jsonl"] = "{}";
    tree[RECORD] = recordJson(); // pid 9999, port 3070
    const env = makeFakeEnv(tree, { alivePids: [9999] });

    const outcome = await launchDashboard(
      args({ projectRoot: "/ws/myproject" }),
      env,
    );

    expect(outcome.exitCode).toBe(EXIT_OK);
    expect(env.spawnCalls).toHaveLength(0); // never a second server
    expect(env.execCalls).toHaveLength(0);
    expect(outcome.pid).toBe(9999);
    expect(outcome.port).toBe(3070);
    expect(outcome.url).toBe("http://127.0.0.1:3070/");
    // Liveness probe hit the recorded port, and the import went there too.
    const posts = env.fetchCalls.filter((c) => c.method === "POST");
    expect(posts).toHaveLength(1);
    expect(posts[0].url).toBe("http://127.0.0.1:3070/api/imports/lifecycle");
    expect(env.logs.join("\n")).toContain("reusing running dashboard");
  });

  test("stale record on launch (dead pid) → cleaned up, fresh spawn + new record", async () => {
    const tree = siblingTree();
    tree[RECORD] = recordJson(); // pid 9999 dead
    const env = makeFakeEnv(tree);

    const outcome = await launchDashboard(
      args({ projectRoot: "/ws/myproject", noImport: true }),
      env,
    );

    expect(outcome.exitCode).toBe(EXIT_OK);
    expect(env.removedFiles).toEqual([RECORD]); // stale cleanup
    expect(env.spawnCalls).toHaveLength(1); // fresh launch proceeded
    expect(outcome.pid).toBe(4242);
    // New record written for the fresh server.
    expect(env.atomicWrites).toHaveLength(1);
    expect(
      (JSON.parse(env.atomicWrites[0].content) as DashboardRecord).pid,
    ).toBe(4242);
    expect(env.logs.join("\n")).toContain("stale dashboard record");
  });
});

// ── 7. REAL-PROCESS --stop (no seams — codex G-lane round 2) ─────────────────
//
// The seam tests above prove --stop CALLS the kill seam; this proves the real
// env actually TERMINATES the process group. The child is spawned with
// detached:true, making it the leader of its own NEW process group
// (pid == pgid on POSIX/macOS) — so killProcess(-pid) targets exactly that
// group and can never touch the jest runner's group.

describe("--stop terminates the real process group (real env, no seams)", () => {
  let tmpRoot: string;
  let childPid: number | null = null;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dashboard-realstop-"));
    fs.mkdirSync(path.join(tmpRoot, ".guild", "cache"), { recursive: true });
  });

  afterEach(() => {
    // Guard cleanup: if the test failed before/at the kill, reap the child so
    // no orphan outlives the suite.
    if (childPid !== null) {
      try {
        process.kill(-childPid, "SIGKILL");
      } catch {
        /* group already gone */
      }
      try {
        process.kill(childPid, "SIGKILL");
      } catch {
        /* already gone */
      }
      childPid = null;
    }
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  test("real detached child is dead and the record is gone after --stop", async () => {
    // A real long-lived child: keeps an interval alive until signaled.
    const child = spawn(
      process.execPath,
      ["-e", "setInterval(() => {}, 1000)"],
      { detached: true, stdio: "ignore" },
    );
    child.unref();
    expect(child.pid).toBeDefined();
    childPid = child.pid!;
    expect(childPid).toBeGreaterThan(0);
    // detached:true ⇒ the child leads its own NEW process group, distinct
    // from the test runner's — the group SIGTERM cannot hit jest itself.
    expect(childPid).not.toBe(process.pid);

    // Sanity: alive before --stop.
    expect(() => process.kill(childPid!, 0)).not.toThrow();

    // Real record pointing at the real pid, in a real temp project root.
    const recordPath = dashboardRecordPath(tmpRoot);
    fs.writeFileSync(
      recordPath,
      JSON.stringify(
        {
          pid: childPid,
          port: 3071,
          project_root: tmpRoot,
          benchmark_dir: path.join(tmpRoot, "benchmark"),
          started_at: new Date().toISOString(),
        },
        null,
        2,
      ),
    );

    // The REAL env — real signal-0 liveness probe, real group SIGTERM.
    const outcome = stopDashboard(tmpRoot, createRealEnv());
    expect(outcome.exitCode).toBe(EXIT_OK);
    expect(fs.existsSync(recordPath)).toBe(false);

    // Poll up to ~2s for the process to actually die (SIGTERM delivery +
    // libuv reaping are async).
    const deadline = Date.now() + 2000;
    let dead = false;
    while (Date.now() < deadline) {
      try {
        process.kill(childPid!, 0);
      } catch (e) {
        // ESRCH ⇒ no such process — actually terminated and reaped.
        expect((e as NodeJS.ErrnoException).code).toBe("ESRCH");
        dead = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(dead).toBe(true);
    childPid = null; // killed + verified — afterEach guard not needed

    // The test runner's own process (and group) survived the group SIGTERM.
    expect(() => process.kill(process.pid, 0)).not.toThrow();
  });
});
