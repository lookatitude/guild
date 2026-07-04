/**
 * src/modules/distribution/workflows/verify-host-packages.ts
 *
 * Verifies generated host packages after build:hosts. This is a runtime smoke
 * rail for package contents, not a real external host install.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";

import { PLUGIN_ROOT } from "./build-inventory";
import { HOST_REGISTRY_ROWS } from "../../host-runtime";

/**
 * The 4 new-CLI installable hosts (verified-multi-host-support L0 §1.1/§2.3). They
 * are verified at the CONTENTS level: manifest present + self-identifying
 * schema_version (from the registry row's manifest_format) + installability "target"
 * + the Guild skill tree + the bin/guild-run launcher (AC-BOOT-1). They are NOT
 * driven through a `guild-run` runtime dry-run like the 5 proven hosts: these rows are
 * installability:"target" (renderer exists, runtime install unproven), and the
 * wrapper's HOST_CAPABILITY_ROWS is not yet wired for them (host-runtime followup) —
 * so a runtime dry-run would (correctly) fail. R1: a package existing is not support.
 */
const NEW_CLI_HOST_IDS = ["cursor", "github-copilot", "opencode", "rovo-dev"] as const;

export interface HostPackageVerification {
  ok: boolean;
  checks: string[];
  errors: string[];
}

interface VerifyOptions {
  root?: string;
  distRoot?: string;
}

function existsFile(abs: string): boolean {
  try {
    return fs.statSync(abs).isFile();
  } catch {
    return false;
  }
}

function readJson(abs: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(abs, "utf8")) as Record<string, unknown>;
}

function requireFile(root: string, rel: string, checks: string[], errors: string[]): void {
  const abs = path.join(root, rel);
  if (existsFile(abs)) checks.push(rel);
  else errors.push(`missing generated package file: ${rel}`);
}

function verifyJsonField(
  root: string,
  rel: string,
  field: string,
  expected: string,
  checks: string[],
  errors: string[]
): void {
  const abs = path.join(root, rel);
  if (!existsFile(abs)) return;
  try {
    const value = readJson(abs)[field];
    if (value === expected) checks.push(`${rel}:${field}`);
    else errors.push(`${rel}: expected ${field}=${JSON.stringify(expected)}, got ${JSON.stringify(value)}`);
  } catch (err) {
    errors.push(`${rel}: invalid JSON (${String(err)})`);
  }
}

function verifyWrapper(
  distRoot: string,
  packageName: "agents" | "codex" | "pi" | "antigravity",
  expected: { host: string; command: string; adapter: string },
  checks: string[],
  errors: string[]
): void {
  const packageDir = path.join(distRoot, packageName);
  const wrapper = path.join(packageDir, "bin", "guild-run");
  if (!existsFile(wrapper)) {
    errors.push(`${packageName}: missing bin/guild-run`);
    return;
  }
  const res = spawnSync(wrapper, ["--dry-run", "--host", expected.host, "--prompt", `verify ${packageName}`, "--cwd", packageDir], {
    cwd: packageDir,
    encoding: "utf8",
    env: { ...process.env, npm_config_cache: process.env["npm_config_cache"] ?? "/private/tmp/guild-npm-cache" },
    maxBuffer: 10 * 1024 * 1024,
  });
  if (res.status !== 0) {
    errors.push(`${packageName}: guild-run dry-run failed (${res.status}): ${res.stderr || res.stdout}`);
    return;
  }
  let plan: Record<string, unknown>;
  try {
    plan = JSON.parse(res.stdout) as Record<string, unknown>;
  } catch (err) {
    errors.push(`${packageName}: guild-run dry-run did not emit JSON (${String(err)})`);
    return;
  }
  const adapter = plan["host_adapter"] as Record<string, unknown> | undefined;
  if (plan["host"] !== expected.host) errors.push(`${packageName}: plan.host=${JSON.stringify(plan["host"])}`);
  if (plan["command"] !== expected.command) {
    errors.push(`${packageName}: command=${JSON.stringify(plan["command"])}, expected ${expected.command}`);
  }
  if (adapter?.["host_id"] !== expected.adapter) {
    errors.push(`${packageName}: adapter host_id=${JSON.stringify(adapter?.["host_id"])}, expected ${expected.adapter}`);
  }
  if (!JSON.stringify(plan).includes(`verify ${packageName}`)) {
    errors.push(`${packageName}: prompt not present in dry-run plan`);
  }
  if (errors.length === 0 || !errors.some((error) => error.startsWith(`${packageName}:`))) {
    checks.push(`${packageName}:bin/guild-run --dry-run`);
  }
}

export function verifyGeneratedHostPackages(options: VerifyOptions = {}): HostPackageVerification {
  const root = options.root ?? PLUGIN_ROOT;
  const distRoot = options.distRoot ?? path.join(root, "dist");
  const checks: string[] = [];
  const errors: string[] = [];

  for (const rel of [
    "claude-code/.claude-plugin/plugin.json",
    "claude-code/.claude-plugin/marketplace.json",
    "claude-code/bin/guild-run",
    "codex/.codex-plugin/plugin.json",
    "codex/bin/guild-run",
    "codex/hooks/lib/handoff-v2.ts",
    "codex/scripts/guild-run.ts",
    "codex-marketplace/.agents/plugins/marketplace.json",
    "codex-marketplace/plugins/guild/.codex-plugin/plugin.json",
    "agents/AGENTS.md",
    "agents/.agents/skills/guild/meta/using-guild/SKILL.src.md",
    "agents/bin/guild-run",
    "pi/pi-manifest.json",
    "pi/bin/guild-run",
    "antigravity/antigravity-manifest.json",
    "antigravity/plugin.json",
    "antigravity/bin/guild-run",
  ]) {
    requireFile(distRoot, rel, checks, errors);
  }

  verifyJsonField(distRoot, "claude-code/.claude-plugin/plugin.json", "name", "guild", checks, errors);
  verifyJsonField(distRoot, "codex/.codex-plugin/plugin.json", "name", "guild", checks, errors);
  verifyJsonField(distRoot, "pi/pi-manifest.json", "schema_version", "pi-manifest.v1", checks, errors);
  verifyJsonField(
    distRoot,
    "antigravity/antigravity-manifest.json",
    "schema_version",
    "antigravity-manifest.v1",
    checks,
    errors
  );
  verifyJsonField(
    distRoot,
    "antigravity/plugin.json",
    "schema_version",
    "antigravity-manifest.v1",
    checks,
    errors
  );

  verifyWrapper(distRoot, "agents", { host: "agents-file", command: "agents-file", adapter: "agents-file" }, checks, errors);
  verifyWrapper(distRoot, "codex", { host: "codex", command: "codex", adapter: "codex-cli" }, checks, errors);
  verifyWrapper(distRoot, "pi", { host: "pi", command: "pi", adapter: "pi-cli" }, checks, errors);
  verifyWrapper(distRoot, "antigravity", { host: "antigravity", command: "agy", adapter: "antigravity-cli" }, checks, errors);

  // verified-multi-host-support — contents-level coverage per new-CLI installable host.
  for (const hostId of NEW_CLI_HOST_IDS) {
    const manifestRel = `${hostId}/${hostId}-manifest.json`;
    requireFile(distRoot, manifestRel, checks, errors);
    requireFile(distRoot, `${hostId}/bin/guild-run`, checks, errors);
    // The Guild skill tree (incl. the using-guild bootstrap) is exposed under
    // .agents/skills/guild/** — the L2 packaging contract's agents_skill_root.
    requireFile(distRoot, `${hostId}/.agents/skills/guild/meta/using-guild/SKILL.src.md`, checks, errors);
    // The bundled guild-run CLI the launcher forwards to (the 11th concern).
    requireFile(distRoot, `${hostId}/scripts/guild-run.ts`, checks, errors);
    // The manifest is self-identifying from the registry row's manifest_format, and
    // honestly declares installability:"target" (renderer ≠ support, R1).
    verifyJsonField(distRoot, manifestRel, "schema_version", HOST_REGISTRY_ROWS[hostId].capabilities.package.manifest_format, checks, errors);
    verifyJsonField(distRoot, manifestRel, "host_id", hostId, checks, errors);
    verifyJsonField(distRoot, manifestRel, "installability", "target", checks, errors);
    verifyJsonField(distRoot, manifestRel, "launcher", "bin/guild-run", checks, errors);
  }

  return { ok: errors.length === 0, checks, errors };
}

export function parseVerifyHostPackagesArgs(argv: string[]): VerifyOptions | { error: string } {
  let root = PLUGIN_ROOT;
  let distRoot = "";
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--root" && argv[i + 1] !== undefined) root = path.resolve(argv[++i]);
    else if (arg.startsWith("--root=")) root = path.resolve(arg.slice("--root=".length));
    else if (arg === "--dist" && argv[i + 1] !== undefined) distRoot = path.resolve(argv[++i]);
    else if (arg.startsWith("--dist=")) distRoot = path.resolve(arg.slice("--dist=".length));
    else return { error: `unknown argument: ${arg}` };
  }
  return { root, ...(distRoot ? { distRoot } : {}) };
}

export function runVerifyHostPackagesCli(argv: string[] = process.argv.slice(2)): number {
  const parsed = parseVerifyHostPackagesArgs(argv);
  if ("error" in parsed) {
    process.stderr.write(`${parsed.error}\nusage: verify-host-packages.ts [--root <pluginRoot>] [--dist <distDir>]\n`);
    return 1;
  }
  const result = verifyGeneratedHostPackages(parsed);
  if (!result.ok) {
    process.stderr.write("verify-host-packages: FAIL\n  " + result.errors.join("\n  ") + "\n");
    return 2;
  }
  process.stdout.write(`verify-host-packages: PASS (${result.checks.length} checks).\n`);
  return 0;
}
