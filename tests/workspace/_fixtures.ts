/**
 * tests/workspace/_fixtures.ts
 *
 * Shared synthetic-fixture + CLI-runner helpers for the cross-cutting
 * workspace-aware-Init / federated-`.guild/` integration suites (Lane E, SC-8).
 *
 * These tests drive the Wave-1 scripts AS SUBPROCESSES (`npx tsx <script>`) over
 * mkdtemp fixture trees — a distinct layer from Lane B's in-process unit tests
 * (`scripts/__tests__/workspace-*.test.ts`). The contract under test is the CLI
 * invocation surface itself, end-to-end.
 *
 * Determinism: every fixture is built under os.tmpdir() via mkdtempSync, no
 * network, no wall-clock assertions, no randomness in assertions. Real `git`
 * is only used where the script's contract depends on it (remote / HEAD), and
 * always with pinned committer identity + --allow-empty so the tree is stable.
 *
 * The real workspace repo is NEVER mutated.
 */

import { spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

// ── Script locations (resolved from this file, not cwd) ──────────────────────

export const SCRIPTS_DIR = path.resolve(__dirname, "../../scripts/workspace");
export const DETECT = path.join(SCRIPTS_DIR, "detect.ts");
export const WRITE_MANIFEST = path.join(SCRIPTS_DIR, "write-manifest.ts");
export const FEDERATED_QUERY = path.join(SCRIPTS_DIR, "federated-query.ts");

// ── CLI runner ────────────────────────────────────────────────────────────────

export interface CliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * Run a workspace script as a subprocess via `npx tsx`, mirroring the
 * documented invocation (`npx tsx scripts/workspace/<script>.ts ...`).
 * No `timeout(1)` binary dependency (macOS has none) — spawnSync's own
 * timeout option guards against hangs.
 *
 * FIC-48 — inherited-run-telemetry isolation. When these tests themselves run
 * inside a dispatched Guild lane, the jest process carries the orchestrator's
 * run envelope (GUILD_RUN_ID, GUILD_RUN_BINDING_REF, GUILD_TASK_ID, …) and
 * jest's env scrub does NOT reach spawnSync children. Production telemetry in
 * the spawned script then legitimately journals into
 * `<fixture>/.guild/runs/<orchestrator-run-id>/`, and the fixture tree acquires
 * files this suite never planted — matrix3 reproduced exactly that
 * (`runs/run-6f94bea1-…/logs/v1.4-events.jsonl` inside the temp workspace).
 * These fixtures assert on what the SCRIPT does to the tree, not on the
 * orchestrator's active run, so the child env drops the whole GUILD_* envelope
 * (+ TMUX). A test that needs a GUILD_ var sets it explicitly via `env`.
 */
export function runScript(
  script: string,
  args: string[],
  env?: Record<string, string>
): CliResult {
  const childEnv: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined) continue;
    if (k.startsWith("GUILD_") || k === "TMUX") continue;
    childEnv[k] = v;
  }
  Object.assign(childEnv, env ?? {});
  const result = spawnSync("npx", ["tsx", script, ...args], {
    encoding: "utf8",
    timeout: 30000,
    env: childEnv,
  });
  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

/** Parse the JSON document a script writes to stdout. Throws with context on failure. */
export function parseJsonStdout<T = unknown>(res: CliResult, label: string): T {
  try {
    return JSON.parse(res.stdout) as T;
  } catch (e) {
    throw new Error(
      `${label}: stdout was not valid JSON (exit=${res.exitCode}).\n` +
        `STDOUT:\n${res.stdout}\nSTDERR:\n${res.stderr}\n${(e as Error).message}`
    );
  }
}

// ── Fixture-tree builders ──────────────────────────────────────────────────────

/** Make an isolated temp workspace root. Caller is responsible for cleanup() in afterEach. */
export function makeTempRoot(prefix = "guild-ws-xc-"): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function rmTree(root: string): void {
  fs.rmSync(root, { recursive: true, force: true });
}

/**
 * Plant a child that looks like a SUB-PROJECT: has `.git/` (as a plain dir
 * marker — detection keys on existence, not a real repo) but no `.guild/`.
 */
export function plantSubProject(root: string, name: string): string {
  const child = path.join(root, name);
  fs.mkdirSync(path.join(child, ".git"), { recursive: true });
  return child;
}

/**
 * Plant a child that looks like a SUB-GUILD: has `.guild/`, optionally with
 * `wiki/` (has_wiki) and `indexes/` (has_indexes). Seeds a wiki page so the
 * no-duplication regression can detect any copy-up.
 */
export function plantSubGuild(
  root: string,
  name: string,
  opts: { wiki?: boolean; indexes?: boolean; pageBody?: string } = {}
): string {
  const child = path.join(root, name);
  const guildDir = path.join(child, ".guild");
  fs.mkdirSync(guildDir, { recursive: true });
  if (opts.wiki !== false) {
    const wikiDir = path.join(guildDir, "wiki");
    fs.mkdirSync(wikiDir, { recursive: true });
    const body =
      opts.pageBody ??
      `# ${name} private page\n\nSUBGUILD-SENTINEL-${name.toUpperCase()}\n`;
    fs.writeFileSync(path.join(wikiDir, "page.md"), body, "utf8");
  }
  if (opts.indexes) {
    fs.mkdirSync(path.join(guildDir, "indexes"), { recursive: true });
  }
  return child;
}

/** Plant a plain directory that matches NEITHER rule (e.g. docs/) — must be ignored. */
export function plantPlainDir(root: string, name: string): string {
  const child = path.join(root, name);
  fs.mkdirSync(child, { recursive: true });
  fs.writeFileSync(path.join(child, "README.md"), `# ${name}\n`, "utf8");
  return child;
}

/**
 * Plant a depth-2 nested repo: <root>/<outer>/.git AND
 * <root>/<outer>/<inner>/.git. The inner repo MUST NOT be detected (depth-1
 * hard, D-OQ1). Returns { outer, inner } names.
 */
export function plantNestedDepth2(
  root: string,
  outer = "outer",
  inner = "inner"
): { outer: string; inner: string } {
  fs.mkdirSync(path.join(root, outer, ".git"), { recursive: true });
  fs.mkdirSync(path.join(root, outer, inner, ".git"), { recursive: true });
  return { outer, inner };
}

/** Write a .guild/settings.json carrying workspace.mode (or arbitrary extra keys). */
export function writeSettings(
  root: string,
  settings: Record<string, unknown>
): void {
  const guildDir = path.join(root, ".guild");
  fs.mkdirSync(guildDir, { recursive: true });
  fs.writeFileSync(
    path.join(guildDir, "settings.json"),
    JSON.stringify(settings, null, 2),
    "utf8"
  );
}

/** Drop a top-level code file at the root (drives root_wiki=true per D-OQ2). */
export function plantTopLevelCode(root: string, file = "main.ts"): void {
  fs.writeFileSync(path.join(root, file), "export const x = 1;\n", "utf8");
}

// ── Real-git helper (only where remote/HEAD contract is under test) ─────────────

/** True iff `git` is on PATH. */
export function gitAvailable(): boolean {
  const r = spawnSync("git", ["--version"], { encoding: "utf8" });
  return r.status === 0;
}

/**
 * Plant a child that is a REAL git repo with a pinned remote + one empty
 * commit, optionally a `.guild/wiki/`. Used only to exercise remote/HEAD
 * extraction deterministically.
 */
export function plantRealGitSubGuild(
  root: string,
  name: string,
  remoteUrl: string,
  withWiki = true
): string {
  const child = path.join(root, name);
  fs.mkdirSync(child, { recursive: true });
  const git = (args: string[]) =>
    spawnSync("git", ["-C", child, ...args], { encoding: "utf8" });
  git(["init", "-q"]);
  git(["remote", "add", "origin", remoteUrl]);
  git([
    "-c",
    "user.email=test@guild.local",
    "-c",
    "user.name=Guild Test",
    "commit",
    "-q",
    "--allow-empty",
    "-m",
    "fixture",
  ]);
  if (withWiki) {
    fs.mkdirSync(path.join(child, ".guild", "wiki"), { recursive: true });
  }
  return child;
}

// ── Filesystem assertion helpers ────────────────────────────────────────────────

/** Recursively list every file path (relative to base) under a directory. */
export function walkFiles(base: string): string[] {
  const out: string[] = [];
  const stack: string[] = [base];
  while (stack.length) {
    const dir = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) stack.push(full);
      else out.push(path.relative(base, full));
    }
  }
  return out.sort();
}
