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
 * installability:"target" (renderer exists, runtime install unproven). The wrapper
 * now DOES carry rows for them (G4b: DERIVED_HOST_CAPABILITY_ROWS, host-registry.ts),
 * so a dry-run PLAN would resolve — but planning is not proving; promoting these
 * hosts past contents-level verification is an operator-box decision. R1: a package
 * existing is not support.
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

/**
 * Byte-verify the full shipped template feedstock of one package against the
 * repo source (machinery-vs-template-library ADR, F4 integrity rail).
 * Presence alone is not honesty: a stale or diverged template in a package
 * would mint the WRONG instance on that host. Every templates/** file in the
 * source must exist in the package with identical bytes; extra template files
 * in the package (dropped from source) are flagged too.
 *
 * NOTE: templates are deliberately NOT a guild.inventory.v1 category — that
 * list is CLOSED for v1. This rail plus the capability-catalog directory pin
 * and check-roster-consistency are the template integrity story instead.
 */
function verifyTemplateTree(
  sourceRoot: string,
  distRoot: string,
  packageName: string,
  checks: string[],
  errors: string[]
): void {
  const walk = (dir: string, base: string): string[] => {
    if (!fs.existsSync(dir)) return [];
    const out: string[] = [];
    for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) out.push(...walk(abs, base));
      else if (e.isFile()) out.push(path.relative(base, abs).split(path.sep).join("/"));
    }
    return out;
  };
  const srcBase = path.join(sourceRoot, "templates");
  const pkgBase = path.join(distRoot, packageName, "templates");
  const srcFiles = walk(srcBase, srcBase);
  if (srcFiles.length === 0) {
    errors.push(`${packageName}: no source templates found under ${srcBase} — cannot verify`);
    return;
  }
  let mismatches = 0;
  for (const rel of srcFiles) {
    const pkgFile = path.join(pkgBase, rel);
    if (!existsFile(pkgFile)) {
      errors.push(`${packageName}: templates/${rel} missing from package`);
      mismatches++;
      continue;
    }
    if (!fs.readFileSync(path.join(srcBase, rel)).equals(fs.readFileSync(pkgFile))) {
      errors.push(`${packageName}: templates/${rel} differs from source (stale package render)`);
      mismatches++;
    }
  }
  const extras = walk(pkgBase, pkgBase).filter((rel) => !srcFiles.includes(rel));
  for (const rel of extras) {
    errors.push(`${packageName}: templates/${rel} present in package but absent from source`);
    mismatches++;
  }
  if (mismatches === 0) checks.push(`${packageName}:templates/** (${srcFiles.length} files byte-identical)`);
}

// ---------------------------------------------------------------------------
// Path-resolution gate (audit fix: presence/self-identity checks alone let
// dangling pointers ship silently — a command's source_path, a skills glob, or
// a prose bootstrap pointer can reference a file that plainly does not exist
// in the rendered package tree, and none of the checks above would catch it,
// e.g.: commands invoking hooks/dist/run-trace.js in a package that never
// copies it; AGENTS.md pointing at a using-guild SKILL.md that only ships as
// SKILL.src.md; Pi/Antigravity/wrapped-CLI manifests carrying Claude-shaped
// './commands/<id>.md' / './skills/<tier>/' paths that resolve to nothing in
// those trees. This pass resolves every such pointer against the ACTUAL
// rendered package tree and fails closed.
// ---------------------------------------------------------------------------

/** Require that `rel` (relative to `packageRoot`) resolves to a real file or directory. */
function requireResolvable(
  packageRoot: string,
  rel: string,
  label: string,
  checks: string[],
  errors: string[]
): void {
  const abs = path.join(packageRoot, rel);
  if (fs.existsSync(abs)) {
    checks.push(`${label} → ${rel}`);
  } else {
    errors.push(`${label}: reference to "${rel}" does not resolve in the package tree (${abs})`);
  }
}

/** Extract every distinct `hooks/dist/<file>.js` reference from free text. */
function extractHookDistRefs(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/hooks\/dist\/[A-Za-z0-9_.-]+\.js/g)) out.add(m[0]);
  return [...out];
}

/**
 * Every `commands/*.md` body in the CLAUDE package that shells out to a
 * `hooks/dist/*.js` bundle must find that bundle in the SAME package
 * (plugin-implementation-audit-2026-07-12: run-trace.js was invoked by every
 * phase command but never copied — see build-inventory.ts's
 * discoverHookCliBundles for the fix that closes this).
 */
function verifyCommandHookReferences(
  distRoot: string,
  packageName: string,
  checks: string[],
  errors: string[]
): void {
  const dir = path.join(distRoot, packageName, "commands");
  if (!fs.existsSync(dir)) return;
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".md"))) {
    const text = fs.readFileSync(path.join(dir, file), "utf8");
    for (const ref of extractHookDistRefs(text)) {
      requireResolvable(path.join(distRoot, packageName), ref, `${packageName}/commands/${file}`, checks, errors);
    }
  }
}

/** Extract every distinct backtick-quoted `.agents/...` path reference from free text. */
function extractBacktickedAgentsPaths(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/`(\.agents\/[^`]+)`/g)) out.add(m[1]);
  return [...out];
}

/**
 * The universal AGENTS.md package's bootstrap prose points at specific files
 * under the bundled skill tree (e.g. the using-guild gateway). Every such
 * pointer must resolve in the rendered package (plugin-implementation-audit-
 * 2026-07-12: the bootstrap text pointed at a SKILL.md that never ships —
 * only SKILL.src.md does).
 */
function verifyAgentsBootstrapReferences(
  distRoot: string,
  packageName: string,
  checks: string[],
  errors: string[]
): void {
  const agentsMd = path.join(distRoot, packageName, "AGENTS.md");
  if (!fs.existsSync(agentsMd)) return;
  const text = fs.readFileSync(agentsMd, "utf8");
  const packageRoot = path.join(distRoot, packageName);
  for (const ref of extractBacktickedAgentsPaths(text)) {
    // A trailing `/**` is prose shorthand for "everything under this directory",
    // not a literal path — resolve the directory it globs, not the glob string.
    const resolvable = ref.endsWith("/**") ? ref.slice(0, -3) : ref;
    if (resolvable.includes("*")) continue; // other wildcard shapes aren't literal paths — skip
    requireResolvable(packageRoot, resolvable, `${packageName}/AGENTS.md`, checks, errors);
  }
}

/**
 * A rendered Pi/Antigravity/wrapped-CLI manifest's `commands[].source_path`
 * (when present) and `skills[]` globs must resolve against the package tree
 * they ship in — NOT the Claude-shaped paths the neutral manifest carries
 * before per-host remapping (plugin-implementation-audit-2026-07-12: Pi and
 * Antigravity manifests shipped './commands/<id>.md' + './skills/<tier>/'
 * that resolved to nothing since the real content lives under
 * .agents/skills/guild/**). A `skills` glob must resolve to a NON-EMPTY
 * directory — an empty dir would pass a bare existsSync check while still
 * shipping nothing useful.
 */
function verifyManifestPathResolution(
  distRoot: string,
  packageName: string,
  manifestRel: string,
  checks: string[],
  errors: string[]
): void {
  const abs = path.join(distRoot, packageName, manifestRel);
  if (!fs.existsSync(abs)) return;
  let manifest: { commands?: Array<{ source_path?: string }>; skills?: string[] };
  try {
    manifest = readJson(abs) as typeof manifest;
  } catch {
    return; // invalid JSON is caught elsewhere (verifyJsonField / presence checks)
  }
  const packageRoot = path.join(distRoot, packageName);
  const label = `${packageName}/${manifestRel}`;

  for (const cmd of manifest.commands ?? []) {
    if (!cmd.source_path) continue; // name-only commands are honest — nothing to resolve
    requireResolvable(packageRoot, cmd.source_path.replace(/^\.\//, ""), `${label}#commands`, checks, errors);
  }

  for (const skillDir of manifest.skills ?? []) {
    const rel = skillDir.replace(/^\.\//, "").replace(/\/$/, "");
    const skillAbs = path.join(packageRoot, rel);
    if (fs.existsSync(skillAbs) && fs.statSync(skillAbs).isDirectory() && fs.readdirSync(skillAbs).length > 0) {
      checks.push(`${label}#skills → ${rel}`);
    } else {
      errors.push(`${label}: skills glob "${skillDir}" does not resolve to a non-empty directory (${skillAbs})`);
    }
  }
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
    // The run-trace CLI every shipped phase command's intake invokes
    // (`node .../hooks/dist/run-trace.js start|phase|status`) — closes the
    // plugin-implementation-audit-2026-07-12 finding that this bundle was
    // never copied into generated packages.
    "claude-code/hooks/dist/run-trace.js",
    "codex/.codex-plugin/plugin.json",
    "codex/hooks/codex-hooks.json",
    "codex/hooks/codex-guild-prompt-bridge.js",
    "codex/command-src/command-registry.json",
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
    // Template feedstock ships in EVERY installable package (machinery-vs-
    // template-library ADR): mint (roster-resolve mint <name>) is host-neutral.
    "claude-code/templates/specialists/architect.md",
    "codex/templates/specialists/architect.md",
    "agents/templates/specialists/architect.md",
    "pi/templates/specialists/architect.md",
    "antigravity/templates/specialists/architect.md",
    "claude-code/templates/agents/AGENT.template.md",
  ]) {
    requireFile(distRoot, rel, checks, errors);
  }

  verifyJsonField(distRoot, "claude-code/.claude-plugin/plugin.json", "name", "guild", checks, errors);
  verifyJsonField(distRoot, "codex/.codex-plugin/plugin.json", "name", "guild", checks, errors);
  verifyJsonField(distRoot, "codex/.codex-plugin/plugin.json", "hooks", "./hooks/codex-hooks.json", checks, errors);
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

  // F4 template-integrity rail: byte-verify the full templates/** tree in
  // every installable package against the repo source — including the nested
  // codex-marketplace copy (`codex plugin marketplace add` installs from it).
  for (const pkg of [
    "claude-code",
    "codex",
    path.join("codex-marketplace", "plugins", "guild"),
    "agents",
    "pi",
    "antigravity",
    ...NEW_CLI_HOST_IDS,
  ]) {
    verifyTemplateTree(root, distRoot, pkg, checks, errors);
  }

  verifyWrapper(distRoot, "agents", { host: "agents-file", command: "agents-file", adapter: "agents-file" }, checks, errors);
  verifyWrapper(distRoot, "codex", { host: "codex", command: "codex", adapter: "codex-cli" }, checks, errors);
  verifyWrapper(distRoot, "pi", { host: "pi", command: "pi", adapter: "pi-cli" }, checks, errors);
  verifyWrapper(distRoot, "antigravity", { host: "antigravity", command: "agy", adapter: "antigravity-cli" }, checks, errors);

  // Path-resolution gate (audit fix — see the section comment above
  // verifyManifestPathResolution): presence/self-identity checks miss dangling
  // pointers, so every source_path / skills glob / bootstrap pointer inside a
  // rendered manifest or AGENTS.md is resolved against the real package tree.
  verifyCommandHookReferences(distRoot, "claude-code", checks, errors);
  verifyAgentsBootstrapReferences(distRoot, "agents", checks, errors);
  verifyManifestPathResolution(distRoot, "pi", "pi-manifest.json", checks, errors);
  verifyManifestPathResolution(distRoot, "antigravity", "antigravity-manifest.json", checks, errors);
  for (const hostId of NEW_CLI_HOST_IDS) {
    verifyManifestPathResolution(distRoot, hostId, `${hostId}-manifest.json`, checks, errors);
  }

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
    // Template feedstock (machinery-vs-template-library ADR) — mint is host-neutral.
    requireFile(distRoot, `${hostId}/templates/specialists/architect.md`, checks, errors);
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
