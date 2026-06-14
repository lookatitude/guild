#!/usr/bin/env -S npx tsx
/**
 * scripts/build-host-packages.ts  (npm run build:hosts)
 *
 * L2 — host package generator. Renders BOTH host packages from ONE
 * guild.inventory.v1 (SC-1) into `dist/`, then self-enforces the gates:
 *   - SC-2  Claude full-tree EQUIVALENCE (generated dist/claude-code == committed
 *           plugin tree, across all seven logical surfaces, with the
 *           inventory-derived ExpectedSurfaces floor so it cannot pass vacuously).
 *   - SC-7b SUBSET (no rendered package references an id/schema absent from the
 *           inventory).
 *
 * Output trees (the committed `.claude-plugin` is NEVER mutated — Phase 1 writes
 * ONLY under dist/):
 *   dist/claude-code/   .claude-plugin/plugin.json + commands/** + skills/** +
 *                       agents/** + hooks/{hooks.json,bootstrap.sh,*.sh,...} +
 *                       .mcp.json + scripts/** (the full installed tree).
 *   dist/codex/         .codex-plugin/plugin.json + .agents/skills/guild/**
 *                       (exposes the using-guild bootstrap skill).
 *
 * REUSE vs ADD (per L2 scope): the Codex renderer is REUSED from
 * per-host-packaging.ts (renderCodexPluginJson); the Claude renderer is the new
 * renderClaudePluginPackage ADDED in that same module (the file shipped
 * Codex/Gemini/Pi renderers but no Claude renderer).
 *
 * Contract authority (consumed, never redefined):
 *   scripts/lib/per-host-packaging.ts  — renderClaudePluginPackage + renderCodexPluginJson
 *   scripts/lib/equivalence-contract.ts — checkClaudeEquivalence (SC-2)
 *   scripts/lib/parity-contract.ts      — checkSubset (SC-7b)
 *   scripts/build-inventory.ts          — discoverSurfaces / buildInventory (L1)
 *
 * Usage:
 *   npm run build:hosts            (from plugin/scripts)
 *   npx tsx scripts/build-host-packages.ts [--root <pluginRoot>] [--out <distDir>]
 *       [--generated-at <iso>] [--no-gates]
 *
 * Exit: 0 ok · 2 gate failure (SC-2 / SC-7b) · 1 usage / IO error.
 *
 * Owned by tooling-engineer (L2); consumes L0 + L1; feeds L6.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import type { GuildInventoryV1 } from "./lib/inventory-schema";
import { validateInventoryV1 } from "./lib/inventory-schema";
import {
  PLUGIN_ROOT,
  buildInventory,
  serializeInventory,
  discoverSurfaces,
  UNSTAMPED_GENERATED_AT,
} from "./build-inventory";
import {
  renderClaudePluginPackage,
  renderCodexPluginJson,
  type GuildPluginManifest,
  type McpServerEntry as NeutralMcpServerEntry,
  type HookEntry as NeutralHookEntry,
} from "./lib/per-host-packaging";
import {
  checkClaudeEquivalence,
  type LogicalPackage,
  type ExpectedSurfaces,
} from "./lib/equivalence-contract";
import { checkSubset, type PackageReferences } from "./lib/parity-contract";
import { renderLauncherScript } from "./lib/guild-run-wrapper";

// ---------------------------------------------------------------------------
// IO helpers
// ---------------------------------------------------------------------------

function readText(abs: string): string {
  return fs.readFileSync(abs, "utf8");
}
function readJson(abs: string): Record<string, unknown> {
  try {
    return JSON.parse(readText(abs)) as Record<string, unknown>;
  } catch {
    return {};
  }
}
function writeFileEnsured(abs: string, content: string): void {
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}
/** Emit the per-host `guild-run` launcher (SC-5 wrapper path) into <dest>/bin/. */
function writeLauncher(dest: string, host: string): void {
  const abs = path.join(dest, "bin", "guild-run");
  writeFileEnsured(abs, renderLauncherScript(host));
  fs.chmodSync(abs, 0o755);
}
function copyFileEnsured(srcAbs: string, destAbs: string): boolean {
  if (!fs.existsSync(srcAbs)) return false;
  fs.mkdirSync(path.dirname(destAbs), { recursive: true });
  fs.copyFileSync(srcAbs, destAbs);
  return true;
}
function rmrf(abs: string): void {
  fs.rmSync(abs, { recursive: true, force: true });
}
/** Recursively copy a directory, skipping node_modules and ALL symlinks (incl. the
 *  root itself — never follow a symlinked dir: it could escape the source tree or
 *  cycle). Returns false if src is absent or is a symlink/non-directory. */
function copyDirExcludingNodeModules(srcDir: string, destDir: string): boolean {
  let rootStat: fs.Stats;
  try {
    rootStat = fs.lstatSync(srcDir);
  } catch {
    return false;
  }
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) return false;
  for (const name of fs.readdirSync(srcDir)) {
    if (name === "node_modules") continue;
    const s = path.join(srcDir, name);
    const d = path.join(destDir, name);
    // lstat (not stat): never FOLLOW a symlink — skip it. A symlinked dir could
    // escape the source tree or introduce a copy cycle.
    const st = fs.lstatSync(s);
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) copyDirExcludingNodeModules(s, d);
    else {
      fs.mkdirSync(path.dirname(d), { recursive: true });
      fs.copyFileSync(s, d);
    }
  }
  return true;
}
const stableJson = (v: unknown): string => JSON.stringify(v, null, 2) + "\n";

// ---------------------------------------------------------------------------
// inventory → neutral manifest
// ---------------------------------------------------------------------------

/**
 * Map guild.inventory.v1 to the neutral GuildPluginManifest both renderers
 * consume. Skills become Claude-shaped tier-directory globs; commands/agents
 * become file-path lists; mcp/hooks pass through.
 */
export function toNeutralManifest(inv: GuildInventoryV1): GuildPluginManifest {
  const skillDirs = [
    ...new Set(
      inv.skills.map((s) => {
        const tier = s.tier ?? s.source_path.split("/")[1];
        return `./skills/${tier}/`;
      })
    ),
  ].sort();

  const m: GuildPluginManifest = {
    name: inv.manifest.name,
    version: inv.manifest.version,
    description: inv.manifest.description,
    skills: skillDirs,
    ...(inv.manifest.homepage !== undefined ? { homepage: inv.manifest.homepage } : {}),
    ...(inv.manifest.repository !== undefined ? { repository: inv.manifest.repository } : {}),
    ...(inv.manifest.author !== undefined ? { author: inv.manifest.author } : {}),
    ...(inv.manifest.license !== undefined ? { license: inv.manifest.license } : {}),
    ...(inv.manifest.keywords !== undefined ? { keywords: inv.manifest.keywords } : {}),
    commands: inv.commands.map((c) => `./${c.source_path}`).sort(),
    agents: inv.agents.map((a) => `./${a.source_path}`).sort(),
    mcpServers: inv.mcp_servers.map((s) => {
      const e: NeutralMcpServerEntry = { id: s.id, transport: s.transport };
      if (s.command !== undefined) e.command = s.command;
      if (s.args !== undefined) e.args = s.args;
      if (s.url !== undefined) e.url = s.url;
      if (s.description !== undefined) e.description = s.description;
      return e;
    }),
    hooks: inv.hooks.map((h) => {
      const e: NeutralHookEntry = { event: h.event, script: h.source_path };
      if (h.matcher !== undefined) e.matcher = h.matcher;
      return e;
    }),
  };
  return m;
}

// ---------------------------------------------------------------------------
// LogicalPackage loader (committed plugin tree OR generated dist/claude-code)
// ---------------------------------------------------------------------------

/**
 * Read a Claude tree at `root` into the layout-independent LogicalPackage shape
 * the SC-2 equivalence check compares. Enumeration reuses discoverSurfaces() so
 * the committed and generated sides apply identical id-derivation — equivalence
 * compares like-for-like, never a divergent scan.
 */
export function loadLogicalPackage(root: string): LogicalPackage {
  const d = discoverSurfaces(root);
  const idMap = (list: Array<{ id: string; source_path: string }>): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const e of list) out[e.id] = readText(path.join(root, e.source_path));
    return out;
  };
  const hooksJsonPath = path.join(root, "hooks", "hooks.json");
  const bootstrapPath = path.join(root, "hooks", "bootstrap.sh");
  const mcpPath = path.join(root, ".mcp.json");
  return {
    manifest: readJson(path.join(root, ".claude-plugin", "plugin.json")),
    commands: idMap(d.commands),
    skills: idMap(d.skills),
    agents: idMap(d.agents),
    hooks_json: fs.existsSync(hooksJsonPath) ? readJson(hooksJsonPath) : {},
    bootstrap_sh: fs.existsSync(bootstrapPath) ? readText(bootstrapPath) : "",
    mcp_json: fs.existsSync(mcpPath) ? readJson(mcpPath) : {},
    script_refs: d.scripts.map((s) => s.id),
  };
}

function expectedSurfaces(inv: GuildInventoryV1): ExpectedSurfaces {
  return {
    commands: inv.commands.map((c) => c.id),
    skills: inv.skills.map((s) => s.id),
    agents: inv.agents.map((a) => a.id),
    script_refs: inv.scripts.map((s) => s.id),
  };
}

// ---------------------------------------------------------------------------
// Tree writers
// ---------------------------------------------------------------------------

/** Files under hooks/ to copy into the Claude tree (every existing hook script + the two equivalence surfaces). */
function copyClaudeHooks(root: string, dest: string, inv: GuildInventoryV1): void {
  copyFileEnsured(path.join(root, "hooks", "hooks.json"), path.join(dest, "hooks", "hooks.json"));
  copyFileEnsured(path.join(root, "hooks", "bootstrap.sh"), path.join(dest, "hooks", "bootstrap.sh"));
  for (const h of inv.hooks) {
    copyFileEnsured(path.join(root, h.source_path), path.join(dest, h.source_path));
  }
}

export function writeClaudeTree(
  root: string,
  inv: GuildInventoryV1,
  distRoot: string,
  generatedAt: string
): string {
  const dest = path.join(distRoot, "claude-code");
  rmrf(dest);

  const manifest = renderClaudePluginPackage(toNeutralManifest(inv), { renderedAt: generatedAt });
  writeFileEnsured(path.join(dest, ".claude-plugin", "plugin.json"), stableJson(manifest));

  // Full-tree body copy (commands, skills, agents, scripts) from source paths.
  for (const e of [...inv.commands, ...inv.skills, ...inv.agents, ...inv.scripts]) {
    copyFileEnsured(path.join(root, e.source_path), path.join(dest, e.source_path));
  }
  copyClaudeHooks(root, dest, inv);
  copyFileEnsured(path.join(root, ".mcp.json"), path.join(dest, ".mcp.json"));
  // MCP server runtime referenced by .mcp.json (so the package is self-contained).
  copyDirExcludingNodeModules(path.join(root, "mcp-servers"), path.join(dest, "mcp-servers"));
  writeLauncher(dest, "claude");
  return dest;
}

export function writeCodexTree(
  root: string,
  inv: GuildInventoryV1,
  distRoot: string,
  generatedAt: string
): string {
  const dest = path.join(distRoot, "codex");
  rmrf(dest);

  const codexJson = renderCodexPluginJson(toNeutralManifest(inv), { renderedAt: generatedAt });
  writeFileEnsured(path.join(dest, ".codex-plugin", "plugin.json"), stableJson(codexJson));

  // Expose skills (incl. the using-guild bootstrap) under Codex's skill dir.
  for (const s of inv.skills) {
    const underSkills = s.source_path.replace(/^skills\//, "");
    copyFileEnsured(
      path.join(root, s.source_path),
      path.join(dest, ".agents", "skills", "guild", underSkills)
    );
  }
  // Bundle the guild-run CLI (scripts/) so the Codex launcher is self-contained,
  // plus the stdio MCP server runtime Codex can bundle.
  for (const s of inv.scripts) {
    copyFileEnsured(path.join(root, s.source_path), path.join(dest, s.source_path));
  }
  copyDirExcludingNodeModules(path.join(root, "mcp-servers"), path.join(dest, "mcp-servers"));
  writeLauncher(dest, "codex");
  return dest;
}

// ---------------------------------------------------------------------------
// Gate references
// ---------------------------------------------------------------------------

function claudePackageRefs(inv: GuildInventoryV1): PackageReferences {
  return {
    host: "claude",
    command_ids: inv.commands.map((c) => c.id),
    skill_ids: inv.skills.map((s) => s.id),
    agent_ids: inv.agents.map((a) => a.id),
    mcp_server_ids: inv.mcp_servers.map((m) => m.id),
    script_ids: inv.scripts.map((s) => s.id),
    hook_ids: inv.hooks.map((h) => h.id),
    schema_versions: [],
  };
}

function codexPackageRefs(
  inv: GuildInventoryV1,
  codexJson: ReturnType<typeof renderCodexPluginJson>
): PackageReferences {
  return {
    host: "codex",
    command_ids: (codexJson.commands ?? []).map((c) => c.name),
    skill_ids: inv.skills.map((s) => s.id), // exposed under .agents/skills/guild/**
    agent_ids: [], // Codex flags agents unsupported (render-or-degrade) — none referenced.
    mcp_server_ids: (codexJson.mcpServers ?? []).map((m) => m.id),
    script_ids: [],
    hook_ids: [],
    schema_versions: [],
  };
}

// ---------------------------------------------------------------------------
// Build driver
// ---------------------------------------------------------------------------

export interface BuildResult {
  claudeDir: string;
  codexDir: string;
  gateOk: boolean;
  reasons: string[];
}

/**
 * Resolve the inventory to render from. Rebuilt FRESH from the live surface on
 * every run (SC-1: "build from one inventory" must reflect the current tree, not
 * a stale snapshot) and persisted to guild.inventory.json so the on-disk artifact
 * stays in sync. buildInventory() already validates + self-checks SC-7a coverage
 * and throws on any failure, so a re-validate here would be redundant.
 */
function loadInventory(root: string, generatedAt: string): GuildInventoryV1 {
  const file = path.join(root, "guild.inventory.json");
  const inv = buildInventory(root, generatedAt);
  // Defensive belt-and-suspenders (buildInventory already validated).
  const v = validateInventoryV1(inv);
  if (!v.valid) {
    throw new Error("freshly built inventory failed validation:\n  " + v.errors.join("\n  "));
  }
  writeFileEnsured(file, serializeInventory(inv));
  return inv;
}

export function buildHostPackages(opts: {
  root: string;
  distRoot: string;
  generatedAt: string;
  gates: boolean;
}): BuildResult {
  const inv = loadInventory(opts.root, opts.generatedAt);

  const claudeDir = writeClaudeTree(opts.root, inv, opts.distRoot, opts.generatedAt);
  const codexDir = writeCodexTree(opts.root, inv, opts.distRoot, opts.generatedAt);

  const reasons: string[] = [];
  if (opts.gates) {
    // SC-2 — Claude full-tree equivalence with the anti-vacuity floor.
    const committed = loadLogicalPackage(opts.root);
    const generated = loadLogicalPackage(claudeDir);
    const eq = checkClaudeEquivalence(committed, generated, expectedSurfaces(inv));
    if (!eq.ok) reasons.push(...eq.reasons);

    // SC-7b — subset: every rendered reference exists in the inventory.
    const codexJson = renderCodexPluginJson(toNeutralManifest(inv), { renderedAt: opts.generatedAt });
    const claudeSubset = checkSubset(claudePackageRefs(inv), inv);
    const codexSubset = checkSubset(codexPackageRefs(inv, codexJson), inv);
    if (!claudeSubset.ok) reasons.push(...claudeSubset.reasons);
    if (!codexSubset.ok) reasons.push(...codexSubset.reasons);
  }

  return { claudeDir, codexDir, gateOk: reasons.length === 0, reasons };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

interface CliArgs {
  root: string;
  distRoot: string;
  generatedAt: string;
  gates: boolean;
}

export function parseArgs(argv: string[]): CliArgs | { error: string } {
  let root = PLUGIN_ROOT;
  let distRoot = "";
  let generatedAt = process.env["GUILD_INVENTORY_GENERATED_AT"] || UNSTAMPED_GENERATED_AT;
  let gates = true;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--root" && argv[i + 1] !== undefined) root = path.resolve(argv[++i]);
    else if (a.startsWith("--root=")) root = path.resolve(a.slice("--root=".length));
    else if (a === "--out" && argv[i + 1] !== undefined) distRoot = path.resolve(argv[++i]);
    else if (a.startsWith("--out=")) distRoot = path.resolve(a.slice("--out=".length));
    else if (a === "--generated-at" && argv[i + 1] !== undefined) generatedAt = argv[++i];
    else if (a.startsWith("--generated-at=")) generatedAt = a.slice("--generated-at=".length);
    else if (a === "--no-gates") gates = false;
    else return { error: `unknown argument: ${a}` };
  }
  if (!distRoot) distRoot = path.join(root, "dist");
  return { root, distRoot, generatedAt, gates };
}

function main(): number {
  const parsed = parseArgs(process.argv.slice(2));
  if ("error" in parsed) {
    process.stderr.write(
      parsed.error +
        "\nusage: build-host-packages.ts [--root <pluginRoot>] [--out <distDir>] [--generated-at <iso>] [--no-gates]\n"
    );
    return 1;
  }

  let result: BuildResult;
  try {
    result = buildHostPackages(parsed);
  } catch (err) {
    process.stderr.write("build:hosts: " + String(err instanceof Error ? err.message : err) + "\n");
    return 1;
  }

  process.stdout.write(`build:hosts: wrote ${result.claudeDir}\nbuild:hosts: wrote ${result.codexDir}\n`);
  if (!result.gateOk) {
    process.stderr.write(
      "build:hosts: GATE FAILURE (SC-2 equivalence / SC-7b subset):\n  " +
        result.reasons.join("\n  ") +
        "\n"
    );
    return 2;
  }
  process.stdout.write("build:hosts: gates PASS (SC-2 equivalence + SC-7b subset).\n");
  return 0;
}

if (require.main === module) {
  process.exit(main());
}
