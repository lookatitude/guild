/**
 * CLI entry hygiene (#269 #270 #274), asserted on the SHIPPED bundles a consumer
 * runs (`node <plugin>/runtime/scripts/<id>.js`), not only on the TypeScript.
 */
import { describe, it, expect } from "bun:test";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { buildOptionsForTarget, mainGuardViolations, targets, unguardedMainBlocks } from "./compile";

const REPO = path.resolve(__dirname, "..");
const RUNTIME = path.join(REPO, "runtime", "scripts");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const esbuild = require(path.join(REPO, "scripts", "node_modules", "esbuild")) as typeof import("esbuild");

function tempRoot(prefix: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  spawnSync("git", ["init", "-q"], { cwd: root });
  fs.mkdirSync(path.join(root, ".guild"));
  fs.writeFileSync(path.join(root, ".guild", "guild.yaml"), "schema: guild.root.v1\n");
  return root;
}

/** Every file (and directory) under `dir` with its bytes, `.git` excluded. */
function snapshot(dir: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (abs: string): void => {
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
      if (e.name === ".git") continue;
      const p = path.join(abs, e.name);
      if (e.isDirectory()) {
        out.set(`${p}/`, "");
        walk(p);
      } else out.set(p, fs.readFileSync(p).toString("base64"));
    }
  };
  walk(dir);
  return out;
}

function runBundle(id: string, args: string[], cwd: string, home: string) {
  return spawnSync(process.execPath, [path.join(RUNTIME, `${id}.js`), ...args], {
    cwd,
    env: { PATH: process.env.PATH ?? "", HOME: home, TMPDIR: os.tmpdir() },
    encoding: "utf8",
    input: "",
    timeout: 30_000,
  });
}

describe("#274 — a bundled library main block runs only from its own entry", () => {
  it("flags an unguarded block and accepts both guard spellings", () => {
    // @control: anti-vacuity-control — planted unguarded blocks must be flagged, so the
    // target sweep below cannot pass on a detector that flags nothing.
    expect(unguardedMainBlocks("if (require.main === module) {\n  main();\n}\n", "lib")).toEqual([1]);
    expect(unguardedMainBlocks("const x = 1;\nif (require.main === module) main();\n", "lib")).toEqual([2]);
    expect(
      unguardedMainBlocks(
        'if (\n  require.main === module &&\n  /^lib\\.[cm]?[jt]s$/.test((process.argv[1] ?? "").split(/[\\\\/]/).pop() ?? "")\n) {}\n',
        "lib",
      ),
    ).toEqual([]);
    expect(
      unguardedMainBlocks(
        'if (require.main === module && new RegExp("[\\\\\\\\/]lib\\\\.[cm]?[jt]s$").test(process.argv[1] ?? "")) {}\n',
        "lib",
      ),
    ).toEqual([]);
    // Comments never count; a guard on ANOTHER basename is not a guard.
    expect(unguardedMainBlocks("// if (require.main === module)\n} // end if (require.main === module)\n", "lib")).toEqual([]);
    expect(
      unguardedMainBlocks('if (require.main === module && /^other\\.[cm]?[jt]s$/.test(process.argv[1] ?? "")) {}\n', "lib"),
    ).toEqual([1]);
    // Reversed operands still count; an OR-ed basename test is no gate.
    expect(unguardedMainBlocks("if (module === require.main) { main(); }\n", "lib")).toEqual([1]);
    expect(
      unguardedMainBlocks('if (require.main === module || /^lib\\.[cm]?[jt]s$/.test(process.argv[1] ?? "")) {}\n', "lib"),
    ).toEqual([1]);
    // Code after a block comment on the same line still runs; a negated test is no gate.
    expect(unguardedMainBlocks("/* diagnostic */ if (require.main === module) { main(); }\n", "lib")).toEqual([1]);
    expect(
      unguardedMainBlocks('if (require.main === module && !/^lib\\.[cm]?[jt]s$/.test(process.argv[1] ?? "")) {}\n', "lib"),
    ).toEqual([1]);
    // A regex that also accepts other basenames is no gate.
    expect(unguardedMainBlocks('if (require.main === module && /lib/.test(process.argv[1] ?? "")) {}\n', "lib")).toEqual([1]);
    // A TypeScript-only gate is not an entry-basename gate.
    expect(unguardedMainBlocks('if (require.main === module && /\\.[cm]?ts$/.test(process.argv[1] ?? "")) {}\n', "lib")).toEqual([1]);
  });

  it("no compile target bundles an unguarded non-entry main block", () => {
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "guild-main-guard-"));
    const bad: string[] = [];
    for (const t of targets()) {
      const options = buildOptionsForTarget(t, path.join(scratch, t.out));
      const r = esbuild.buildSync({ ...options, metafile: true, write: false });
      bad.push(...mainGuardViolations(t, options.absWorkingDir as string, Object.keys(r.metafile?.inputs ?? {})));
    }
    expect([...new Set(bad)].sort()).toEqual([]);
  }, 600_000);

  it("trace-summarize --run-id <id> reads logs/v1.4-events.jsonl and counts its tool events", () => {
    const root = tempRoot("guild-trace-summarize-");
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "guild-home-"));
    const logs = path.join(root, ".guild", "runs", "r1", "logs");
    fs.mkdirSync(logs, { recursive: true });
    const line = (ts: string, tool: string) =>
      JSON.stringify({ ts, event: "tool_call", run_id: "r1", tool, status: "ok", latency_ms: 5 });
    fs.writeFileSync(
      path.join(logs, "v1.4-events.jsonl"),
      [line("2026-10-25T10:00:00Z", "Bash"), line("2026-10-25T10:00:01Z", "Read"), line("2026-10-25T10:00:02Z", "Bash")].join("\n") + "\n",
    );
    const out = path.join(root, "summary.md");
    const r = runBundle("trace-summarize", ["--run-id", "r1", "--cwd", root, "--out", out], root, home);
    expect(r.stderr).not.toContain("--run-id/logs");
    expect(r.status).toBe(0);
    const summary = fs.readFileSync(out, "utf8");
    expect(summary).toContain("- Tool calls: 3");
    expect(summary).toMatch(/Bash\D+2/);
  });
});

describe("#269 — every runtime CLI treats --help / -h as usage-and-exit-0 with no writes", () => {
  const bundles = fs.readdirSync(RUNTIME).filter((f) => f.endsWith(".js")).map((f) => f.slice(0, -3)).sort();

  it("covers the whole shipped runtime/scripts set", () => {
    const shipped = targets().filter((t) => t.out.startsWith("runtime/scripts/")).map((t) => path.basename(t.out, ".js")).sort();
    expect(bundles).toEqual(shipped);
    expect(bundles.length).toBeGreaterThan(50);
  });

  for (const flag of ["--help", "-h"]) {
    it(`${flag}: exit 0, usage on stdout, no file written in the repo or HOME`, () => {
      const failures: string[] = [];
      for (const id of bundles) {
        const root = tempRoot("guild-help-");
        const home = fs.mkdtempSync(path.join(os.tmpdir(), "guild-help-home-"));
        const before = [snapshot(root), snapshot(home)];
        const r = runBundle(id, [flag], root, home);
        const after = [snapshot(root), snapshot(home)];
        const wrote = JSON.stringify(before.map((m) => [...m])) !== JSON.stringify(after.map((m) => [...m]));
        if (r.status !== 0 || wrote || !/usage/i.test(r.stdout ?? "")) {
          failures.push(`${id}: exit=${r.status} wrote=${wrote} stdout=${JSON.stringify((r.stdout ?? "").slice(0, 80))}`);
        }
        fs.rmSync(root, { recursive: true, force: true });
        fs.rmSync(home, { recursive: true, force: true });
      }
      expect(failures).toEqual([]);
    }, 600_000);
  }

  it("a --help after `--` is an operand, not a help request", () => {
    const root = tempRoot("guild-help-value-");
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "guild-help-home-"));
    const r = runBundle("score-tier", ["--", "--help"], root, home);
    expect(r.stdout).not.toMatch(/usage/i);
  });
});

describe("#270 — --cwd <path> and --cwd=<path> both work; a valueless flag fails loudly", () => {
  function wikiRoot(): string {
    const root = tempRoot("guild-stamp-");
    const dir = path.join(root, ".guild", "wiki", "concepts");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "a.md"), "---\ntitle: A\ncategory: concepts\n---\n\nBody text.\n");
    return root;
  }

  for (const shape of ["space", "equals"] as const) {
    it(`stamp-recall-importance --cwd (${shape}) scans the named repo`, () => {
      const root = wikiRoot();
      const elsewhere = tempRoot("guild-stamp-elsewhere-");
      const home = fs.mkdtempSync(path.join(os.tmpdir(), "guild-home-"));
      const args = shape === "space" ? ["--cwd", root, "--dry-run"] : [`--cwd=${root}`, "--dry-run"];
      const r = runBundle("stamp-recall-importance", args, elsewhere, home);
      expect(r.status).toBe(0);
      expect(JSON.parse(r.stdout).scanned).toBe(1);
    });
  }

  it("stamp-recall-importance --cwd with no value exits non-zero and says why", () => {
    const root = wikiRoot();
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "guild-home-"));
    for (const args of [["--cwd"], ["--cwd", "--dry-run"], ["--cwd="]]) {
      const r = runBundle("stamp-recall-importance", args, root, home);
      expect(r.status).not.toBe(0);
      expect(r.stderr).toContain("--cwd");
      expect(r.stdout).toBe("");
    }
  });

  it("learn CLIs accept --cwd=<path> and refuse a valueless --cwd", () => {
    const root = tempRoot("guild-learn-cwd-");
    fs.writeFileSync(path.join(root, "a.ts"), "export const a = 1;\n");
    spawnSync("git", ["add", "-A"], { cwd: root });
    spawnSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "x"], { cwd: root });
    const elsewhere = tempRoot("guild-learn-elsewhere-");
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "guild-home-"));
    const ok = runBundle("learn-scan", [`--cwd=${root}`], elsewhere, home);
    expect(ok.status).toBe(0);
    expect(fs.existsSync(path.join(root, ".guild", "indexes", "codebase-map.json"))).toBe(true);
    expect(fs.existsSync(path.join(elsewhere, ".guild", "indexes"))).toBe(false);
    const bad = runBundle("learn-scan", ["--cwd"], elsewhere, home);
    expect(bad.status).not.toBe(0);
    expect(bad.stderr).toContain("--cwd");
  });

  it("ideation-min-build-cli refuses a valueless --cwd instead of using the string \"true\"", () => {
    const root = tempRoot("guild-ideation-");
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "guild-home-"));
    const r = runBundle("ideation-min-build-cli", ["--cwd"], root, home);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("--cwd");
  });
});
