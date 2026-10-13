/**
 * scripts/lint/packaged-install-smoke.ts — does an INSTALLED package actually run?
 *
 * codex G-lane r1 found the gap this closes: every host manifest points MCP startup
 * at `${CLAUDE_PLUGIN_ROOT}/runtime/guild-mcp.js`, but `build-host-packages.ts`
 * copied only `mcp-servers/`. A package therefore shipped manifests referencing a
 * binary it did not contain. Nothing caught it, because every other test runs in a
 * CHECKOUT, where `runtime/` is always present.
 *
 * The rule this asserts: every host package ships the compile graph, and the
 * binary in THAT DIRECTORY must start under plain node with Bun absent from PATH
 * (KTD7/KTD10).
 *
 * Usage:
 *   packaged-install-smoke.ts                 build packages into a temp dir, check all
 *   packaged-install-smoke.ts --dir <path>    check an already-built package tree
 *
 * KTD28: a package is a projection. It ships compiled Node and markdown, never
 * authoring TypeScript: its src/ holds only src/surfaces/** (runtime data) and
 * the module manifests (<tree>/modules/<id>.manifest.json, JSON the conformance
 * worker reads), with NO src/domains/** TypeScript at all; no scripts/**.ts, hooks/**.ts or mcp-servers/
 * ship; and every `runtime/scripts/*.js` / `hooks/dist/*.js` a shipped markdown
 * surface spawns is present in the package.
 *
 * Exit 0 all good · 1 a package is incomplete or its binary will not start · 2 the
 * packages could not be built (the reason is printed; not a pass).
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";

import { checkPackageAgainstMap } from "../../src/adapters";

const ROOT = path.resolve(__dirname, "..", "..");

/** Files every package MUST carry. */
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
    .filter((d) => fs.existsSync(path.join(d, "runtime")))
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

function walkFiles(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkFiles(p, out);
    else out.push(p);
  }
  return out;
}

const TS_SOURCE = /\.(ts|tsx|mts|cts)$/;

/**
 * KTD28: no authoring TypeScript outside src/surfaces, and no src/domains copy
 * beyond the module manifests. A package is surfaces + adapter map + compiled output.
 */
const MODULE_MANIFEST = /^src\/(domains\/[a-z0-9-]+|adapters)\/modules\/[a-z0-9-]+\.manifest\.json$/;

export function checkPackagedSource(pkgDir: string): string[] {
  const name = path.basename(pkgDir);
  const problems: string[] = [];
  for (const abs of walkFiles(pkgDir)) {
    const rel = path.relative(pkgDir, abs).split(path.sep).join("/");
    if (rel.split("/").includes("node_modules")) continue;
    if (MODULE_MANIFEST.test(rel)) continue;
    if (rel.startsWith("src/domains/") || rel.startsWith("src/adapters/") || rel.startsWith("src/runtime/")) {
      problems.push(`${name}: ships ${rel} — a package never copies a domain (KTD28)`);
      continue;
    }
    if (!TS_SOURCE.test(rel) || rel.startsWith("src/surfaces/")) continue;
    // A skill may carry a TypeScript EXAMPLE as reference data; what may not ship
    // is runnable authoring code, or anything that reaches for a domain.
    const runnable = /^(scripts|hooks|mcp-servers|src)\//.test(rel);
    if (runnable || fs.readFileSync(abs, "utf8").includes("src/domains")) {
      problems.push(`${name}: ships authoring TypeScript ${rel} — the user path is compiled Node (KTD11)`);
    }
  }
  if (fs.existsSync(path.join(pkgDir, "mcp-servers"))) {
    problems.push(`${name}: ships mcp-servers/ — the MCP binary is runtime/guild-mcp.js (KTD3)`);
  }
  return problems;
}

/** Every compiled CLI a shipped markdown surface spawns must be in the package. */
export function checkSpawnedBundles(pkgDir: string): string[] {
  const name = path.basename(pkgDir);
  const problems: string[] = [];
  const spawn = /(runtime\/scripts\/[a-z0-9-]+\.js|hooks\/dist\/[a-z0-9-]+\.js)/g;
  const tsxSpawn = /\btsx\s+"?\$\{GUILD_PLUGIN_ROOT[^\s"]*\/(?:scripts|hooks)\/[A-Za-z0-9_/.-]+\.ts/;
  // A bare `stage.ts --flag` tells the model to run TypeScript the package does not ship.
  const bareTsCall = /`(?:npx tsx |[a-z0-9-]+\.ts --)/;
  for (const abs of walkFiles(pkgDir)) {
    if (!abs.endsWith(".md")) continue;
    const rel = path.relative(pkgDir, abs).split(path.sep).join("/");
    const body = fs.readFileSync(abs, "utf8");
    if (tsxSpawn.test(body)) problems.push(`${name}: ${rel} still spawns a .ts script through tsx`);
    if (bareTsCall.test(body)) problems.push(`${name}: ${rel} tells the model to run a .ts script the package does not ship`);
    for (const m of body.matchAll(spawn)) {
      if (!fs.existsSync(path.join(pkgDir, m[1]))) problems.push(`${name}: ${rel} spawns ${m[1]}, which the package lacks`);
    }
  }
  return [...new Set(problems)];
}

const FAMILY_FOR_TREE: Readonly<Record<string, string>> = {
  "claude-code": "claude",
  codex: "codex",
  agents: "agents",
  pi: "pi",
  antigravity: "antigravity",
  cursor: "cursor",
  "github-copilot": "copilot",
  opencode: "opencode",
  "rovo-dev": "rovo",
};

function checkPackage(pkgDir: string): string[] {
  const problems: string[] = [...checkPackagedSource(pkgDir), ...checkSpawnedBundles(pkgDir)];
  const family = FAMILY_FOR_TREE[path.basename(pkgDir)];
  if (family) problems.push(...checkPackageAgainstMap(path.dirname(pkgDir), family));
  for (const rel of REQUIRED_RUNTIME) {
    if (!fs.existsSync(path.join(pkgDir, rel))) {
      problems.push(`${path.basename(pkgDir)}: does not ship ${rel}`);
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
      process.stdout.write(`packaged-install-smoke: no package under ${outRoot} ships runtime/\n`);
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
