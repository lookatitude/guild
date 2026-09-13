/**
 * scripts/lint/packaged-install-smoke.ts — does an INSTALLED package actually run?
 *
 * codex G-lane r1 found the gap this closes: every host manifest points MCP startup
 * at `${CLAUDE_PLUGIN_ROOT}/runtime/guild-mcp.js`, but `build-host-packages.ts`
 * copied only `mcp-servers/`. A package therefore shipped manifests referencing a
 * binary it did not contain. Nothing caught it, because every other test runs in a
 * CHECKOUT, where `runtime/` is always present.
 *
 * The rule this asserts: any host package that ships `mcp-servers/` must also ship
 * the compile graph, and the binary in THAT DIRECTORY must start under plain node
 * with Bun absent from PATH (KTD7/KTD10).
 *
 * Usage:
 *   packaged-install-smoke.ts                 build packages into a temp dir, check all
 *   packaged-install-smoke.ts --dir <path>    check an already-built package tree
 *
 * Exit 0 all good · 1 a package is incomplete or its binary will not start · 2 the
 * packages could not be built (the reason is printed; not a pass).
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = path.resolve(__dirname, "..", "..");

/** Files a package MUST carry once it carries `mcp-servers/`. */
const REQUIRED_RUNTIME = [
  "runtime/guild-mcp.js",
  "runtime/mcp-descriptions.pins.json",
  "runtime/scripts/write-host-capability.js",
  "runtime/scripts/ensure-storage-layout.js",
];

/** The D-MCP ids the single binary serves (KTD3). */
const MCP_IDS = ["wiki", "trace"];

function packageDirs(outRoot: string): string[] {
  if (!fs.existsSync(outRoot)) return [];
  return fs
    .readdirSync(outRoot, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => path.join(outRoot, e.name))
    .filter((d) => fs.existsSync(path.join(d, "mcp-servers")))
    .sort();
}

/**
 * Start the packaged binary the way an installed host does: plain `node`, from the
 * package directory, with Bun stripped from PATH. Success is the server's own ready
 * line on stderr — proof it reached `connect`, not merely that the file parses.
 */
function startsUnderPlainNode(pkgDir: string, id: string): { ok: boolean; detail: string } {
  const binary = path.join(pkgDir, "runtime", "guild-mcp.js");
  const cleanPath = (process.env.PATH ?? "")
    .split(path.delimiter)
    .filter((p) => !/[\\/](\.bun|bun)[\\/]?/.test(p))
    .join(path.delimiter);
  const r = spawnSync(process.execPath, [binary, id], {
    cwd: pkgDir,
    input: "",
    encoding: "utf8",
    timeout: 20000,
    env: { ...process.env, PATH: cleanPath, BUN_INSTALL: "" },
  });
  const err = (r.stderr ?? "").trim();
  if (r.error) return { ok: false, detail: `spawn failed: ${r.error.message}` };
  if (!/\bready\b/.test(err)) return { ok: false, detail: err.split("\n")[0] || "no ready line" };
  return { ok: true, detail: err.split("\n")[0] };
}

function checkPackage(pkgDir: string): string[] {
  const problems: string[] = [];
  for (const rel of REQUIRED_RUNTIME) {
    if (!fs.existsSync(path.join(pkgDir, rel))) {
      problems.push(`${path.basename(pkgDir)}: ships mcp-servers/ but not ${rel}`);
    }
  }
  if (problems.length > 0) return problems; // no point starting a binary that is absent
  for (const id of MCP_IDS) {
    const r = startsUnderPlainNode(pkgDir, id);
    if (!r.ok) problems.push(`${path.basename(pkgDir)}: guild-mcp ${id} did not start — ${r.detail}`);
  }
  return problems;
}

function buildPackages(outRoot: string): { ok: boolean; reason?: string } {
  const r = spawnSync(
    process.execPath,
    [path.join(ROOT, "scripts", "node_modules", "tsx", "dist", "cli.mjs"),
     path.join(ROOT, "scripts", "build-host-packages.ts"), "--root", ROOT, "--out", outRoot],
    { cwd: path.join(ROOT, "scripts"), encoding: "utf8", timeout: 300000 },
  );
  if (r.status === 0) return { ok: true };
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim().split("\n").slice(0, 3).join(" | ");
  return { ok: false, reason: out || `exit ${r.status}` };
}

function main(argv: string[]): number {
  const dirArg = argv.indexOf("--dir");
  let outRoot: string;
  let temp: string | undefined;

  if (dirArg >= 0) {
    outRoot = path.resolve(argv[dirArg + 1] ?? "");
  } else {
    temp = fs.mkdtempSync(path.join(os.tmpdir(), "guild-pkg-smoke-"));
    outRoot = temp;
    const built = buildPackages(outRoot);
    if (!built.ok) {
      process.stdout.write(`packaged-install-smoke: CANNOT BUILD — ${built.reason}\n`);
      fs.rmSync(temp, { recursive: true, force: true });
      return 2;
    }
  }

  try {
    const dirs = packageDirs(outRoot);
    if (dirs.length === 0) {
      process.stdout.write(`packaged-install-smoke: no package under ${outRoot} ships mcp-servers/\n`);
      return 1;
    }
    const problems: string[] = [];
    process.stdout.write(`packaged-install-smoke — ${dirs.length} package(s) under ${outRoot}\n`);
    for (const d of dirs) {
      const p = checkPackage(d);
      process.stdout.write(`  ${p.length === 0 ? "OK  " : "FAIL"}  ${path.basename(d)}\n`);
      for (const line of p) process.stdout.write(`          ${line}\n`);
      problems.push(...p);
    }
    return problems.length === 0 ? 0 : 1;
  } finally {
    if (temp) fs.rmSync(temp, { recursive: true, force: true });
  }
}

if (require.main === module) process.exit(main(process.argv.slice(2)));
