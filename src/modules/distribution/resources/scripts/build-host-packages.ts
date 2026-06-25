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
 * Output trees (default mode writes only under dist/; pass
 * `--sync-claude-install` to update the live `.claude-plugin` metadata from the
 * same generated Claude manifest):
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
 *       [--generated-at <iso>] [--sync-claude-install] [--check-claude-install] [--no-gates]
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
  renderClaudeMarketplacePackage,
  renderCodexPluginJson,
  renderPiManifest,
  renderAntigravityManifest,
  renderAgentsPackage,
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
import {
  buildModuleResourcePlan,
  syncModuleResources,
  type ModuleResourcePlan,
  type ModuleResourceEntry,
} from "./lib/module-resources";

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

type ResourceCategory = ModuleResourceEntry["category"];
type InventoryResourceEntry = { id: string; source_path: string };

class ModuleResourceResolver {
  private readonly byCategoryAndSource = new Map<string, ModuleResourceEntry & { module_id: string }>();

  constructor(private readonly root: string, plans: readonly ModuleResourcePlan[]) {
    for (const plan of plans) {
      for (const entry of plan.entries) {
        const key = this.key(entry.category, entry.source_path);
        if (!this.byCategoryAndSource.has(key)) {
          this.byCategoryAndSource.set(key, { ...entry, module_id: plan.module_id });
        }
      }
    }
  }

  private key(category: ResourceCategory, sourcePath: string): string {
    return `${category}:${sourcePath}`;
  }

  resolve(category: ResourceCategory, entry: InventoryResourceEntry): string {
    const resource = this.byCategoryAndSource.get(this.key(category, entry.source_path));
    if (!resource) {
      throw new Error(`missing module resource for ${category}:${entry.id} (${entry.source_path})`);
    }
    const abs = path.join(this.root, "src", "modules", resource.module_id, resource.resource_path);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
      throw new Error(`module resource file is missing for ${category}:${entry.id}: ${abs}`);
    }
    return abs;
  }

  copy(category: ResourceCategory, entry: InventoryResourceEntry, destAbs: string): void {
    if (!copyFileEnsured(this.resolve(category, entry), destAbs)) {
      throw new Error(`failed to copy module resource for ${category}:${entry.id}`);
    }
  }
}

function loadModuleResourceResolver(root: string): ModuleResourceResolver {
  const check = syncModuleResources({ root, check: true });
  if (!check.ok) {
    throw new Error("module resources are stale:\n  " + check.errors.join("\n  "));
  }
  return new ModuleResourceResolver(root, buildModuleResourcePlan(root));
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

/** Module-owned implementations live under src/. Script shims import them, so
 * every generated package that bundles scripts must also bundle src/. */
function copyModuleRuntime(root: string, dest: string): void {
  copyDirExcludingNodeModules(path.join(root, "src"), path.join(dest, "src"));
}

const SCRIPT_RUNTIME_DEPENDENCIES = ["js-yaml", "argparse", "esprima", "sprintf-js"] as const;

/** Scripts are shipped as runnable TypeScript. Bundle their small production
 * runtime dependency closure so generated packages do not depend on ambient
 * node_modules from the source checkout. */
function copyScriptRuntime(root: string, dest: string): void {
  copyFileEnsured(path.join(root, "scripts", "package.json"), path.join(dest, "scripts", "package.json"));
  const lock = path.join(root, "scripts", "package-lock.json");
  if (fs.existsSync(lock)) {
    copyFileEnsured(lock, path.join(dest, "scripts", "package-lock.json"));
  }
  for (const name of SCRIPT_RUNTIME_DEPENDENCIES) {
    copyDirExcludingNodeModules(
      path.join(root, "scripts", "node_modules", name),
      path.join(dest, "scripts", "node_modules", name)
    );
  }
  // Some script modules reuse hook-side runtime libraries, notably
  // result-contracts -> hooks/lib/handoff-v2. Packages that bundle scripts must
  // carry those libraries or guild-run fails before its dry-run path can load.
  copyDirExcludingNodeModules(path.join(root, "hooks", "lib"), path.join(dest, "hooks", "lib"));
}

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
function copyClaudeHooks(root: string, dest: string, inv: GuildInventoryV1, resources: ModuleResourceResolver): void {
  copyFileEnsured(path.join(root, "hooks", "hooks.json"), path.join(dest, "hooks", "hooks.json"));
  copyFileEnsured(path.join(root, "hooks", "bootstrap.sh"), path.join(dest, "hooks", "bootstrap.sh"));
  for (const h of inv.hooks) {
    resources.copy("hooks", h, path.join(dest, h.source_path));
  }
}

export function writeClaudeTree(
  root: string,
  inv: GuildInventoryV1,
  distRoot: string,
  generatedAt: string,
  resourceResolver?: ModuleResourceResolver
): string {
  const dest = path.join(distRoot, "claude-code");
  rmrf(dest);
  const resources = resourceResolver ?? loadModuleResourceResolver(root);

  const manifest = renderClaudePluginPackage(toNeutralManifest(inv), { renderedAt: generatedAt });
  writeFileEnsured(path.join(dest, ".claude-plugin", "plugin.json"), stableJson(manifest));
  writeFileEnsured(
    path.join(dest, ".claude-plugin", "marketplace.json"),
    stableJson(renderClaudeMarketplacePackage(toNeutralManifest(inv), { renderedAt: generatedAt }))
  );

  // Full-tree body copy from module-owned resources, preserving host-facing paths.
  for (const e of inv.commands) resources.copy("commands", e, path.join(dest, e.source_path));
  for (const e of inv.skills) resources.copy("skills", e, path.join(dest, e.source_path));
  for (const e of inv.agents) resources.copy("agents", e, path.join(dest, e.source_path));
  for (const e of inv.scripts) resources.copy("scripts", e, path.join(dest, e.source_path));
  copyClaudeHooks(root, dest, inv, resources);
  if (inv.mcp_servers.length > 0) {
    resources.copy("mcp_servers", inv.mcp_servers[0], path.join(dest, ".mcp.json"));
  } else {
    copyFileEnsured(path.join(root, ".mcp.json"), path.join(dest, ".mcp.json"));
  }
  copyFileEnsured(path.join(root, "AGENTS.md"), path.join(dest, "AGENTS.md"));
  copyFileEnsured(path.join(root, "CLAUDE.md"), path.join(dest, "CLAUDE.md"));
  copyModuleRuntime(root, dest);
  copyScriptRuntime(root, dest);
  // MCP server runtime referenced by .mcp.json (so the package is self-contained).
  copyDirExcludingNodeModules(path.join(root, "mcp-servers"), path.join(dest, "mcp-servers"));
  writeLauncher(dest, "claude");
  return dest;
}

const CLAUDE_INSTALL_SURFACE_FILES = [
  ".claude-plugin/plugin.json",
  ".claude-plugin/marketplace.json",
] as const;

type ClaudeInstallSurfacePath = (typeof CLAUDE_INSTALL_SURFACE_FILES)[number];

export interface ClaudeInstallSurfaceCheck {
  ok: boolean;
  stale: Array<{ path: ClaudeInstallSurfacePath; reason: string }>;
}

function renderClaudeInstallSurface(inv: GuildInventoryV1, generatedAt: string): Record<ClaudeInstallSurfacePath, string> {
  const neutral = toNeutralManifest(inv);
  return {
    ".claude-plugin/plugin.json": stableJson(renderClaudePluginPackage(neutral, { renderedAt: generatedAt })),
    ".claude-plugin/marketplace.json": stableJson(renderClaudeMarketplacePackage(neutral, { renderedAt: generatedAt })),
  };
}

export function checkClaudeInstallSurface(
  root: string,
  inv: GuildInventoryV1,
  generatedAt: string
): ClaudeInstallSurfaceCheck {
  const expected = renderClaudeInstallSurface(inv, generatedAt);
  const stale: ClaudeInstallSurfaceCheck["stale"] = [];
  for (const rel of CLAUDE_INSTALL_SURFACE_FILES) {
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs)) {
      stale.push({ path: rel, reason: "missing" });
      continue;
    }
    const actual = readText(abs);
    if (actual !== expected[rel]) {
      stale.push({ path: rel, reason: "content differs from generated module/inventory render" });
    }
  }
  return { ok: stale.length === 0, stale };
}

export function syncClaudeInstallSurface(root: string, inv: GuildInventoryV1, generatedAt: string): void {
  const check = syncModuleResources({ root, check: true });
  if (!check.ok) {
    throw new Error("module resources are stale:\n  " + check.errors.join("\n  "));
  }
  const expected = renderClaudeInstallSurface(inv, generatedAt);
  for (const rel of CLAUDE_INSTALL_SURFACE_FILES) {
    writeFileEnsured(path.join(root, rel), expected[rel]);
  }
}

export function writeCodexTree(
  root: string,
  inv: GuildInventoryV1,
  distRoot: string,
  generatedAt: string,
  resourceResolver?: ModuleResourceResolver
): string {
  const dest = path.join(distRoot, "codex");
  rmrf(dest);
  const resources = resourceResolver ?? loadModuleResourceResolver(root);

  const codexJson = renderCodexPluginJson(toNeutralManifest(inv), { renderedAt: generatedAt });
  writeFileEnsured(path.join(dest, ".codex-plugin", "plugin.json"), stableJson(codexJson));

  // Expose skills (incl. the using-guild bootstrap) under Codex's skill dir.
  for (const s of inv.skills) {
    const underSkills = s.source_path.replace(/^skills\//, "");
    resources.copy("skills", s, path.join(dest, ".agents", "skills", "guild", underSkills));
  }
  // Bundle the guild-run CLI (scripts/) so the Codex launcher is self-contained,
  // plus the stdio MCP server runtime Codex can bundle.
  for (const s of inv.scripts) {
    resources.copy("scripts", s, path.join(dest, s.source_path));
  }
  copyModuleRuntime(root, dest);
  copyScriptRuntime(root, dest);
  copyDirExcludingNodeModules(path.join(root, "mcp-servers"), path.join(dest, "mcp-servers"));
  writeLauncher(dest, "codex");
  return dest;
}

/** Emit a Codex marketplace root so `codex plugin marketplace add <dir>` can list/install Guild. */
export function writeCodexMarketplaceTree(codexDir: string, distRoot: string): string {
  const dest = path.join(distRoot, "codex-marketplace");
  rmrf(dest);
  const pluginDest = path.join(dest, "plugins", "guild");
  copyDirExcludingNodeModules(codexDir, pluginDest);
  for (const name of SCRIPT_RUNTIME_DEPENDENCIES) {
    copyDirExcludingNodeModules(
      path.join(codexDir, "scripts", "node_modules", name),
      path.join(pluginDest, "scripts", "node_modules", name)
    );
  }
  writeFileEnsured(
    path.join(dest, ".agents", "plugins", "marketplace.json"),
    stableJson({
      name: "guild",
      interface: { displayName: "Guild Stack" },
      plugins: [
        {
          name: "guild",
          source: { source: "local", path: "./plugins/guild" },
          policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
          category: "Developer Tools",
        },
      ],
    })
  );
  return dest;
}

// ---------------------------------------------------------------------------
// P1-L6 — new-host trees (.agents universal, Pi, Antigravity)
// ---------------------------------------------------------------------------

/**
 * Shared exposure for the AGENTS.md-family hosts: the Guild skill tree under
 * `.agents/skills/guild/**` (incl. the using-guild bootstrap) + the bundled guild-run
 * CLI (scripts/) + the stdio MCP runtime. Identical to the Codex skill/script exposure.
 */
function exposeGuildSkillTree(root: string, inv: GuildInventoryV1, dest: string, resources: ModuleResourceResolver): void {
  for (const s of inv.skills) {
    const underSkills = s.source_path.replace(/^skills\//, "");
    resources.copy("skills", s, path.join(dest, ".agents", "skills", "guild", underSkills));
  }
  for (const s of inv.scripts) {
    resources.copy("scripts", s, path.join(dest, s.source_path));
  }
  copyModuleRuntime(root, dest);
  copyScriptRuntime(root, dest);
  copyDirExcludingNodeModules(path.join(root, "mcp-servers"), path.join(dest, "mcp-servers"));
}

/** Emit the universal `.agents` package: AGENTS.md + skill tree + CLI + launcher. */
export function writeAgentsTree(
  root: string,
  inv: GuildInventoryV1,
  distRoot: string,
  generatedAt: string,
  resourceResolver?: ModuleResourceResolver
): string {
  const dest = path.join(distRoot, "agents");
  rmrf(dest);
  const resources = resourceResolver ?? loadModuleResourceResolver(root);
  const pkg = renderAgentsPackage(toNeutralManifest(inv), { renderedAt: generatedAt });
  writeFileEnsured(path.join(dest, "AGENTS.md"), pkg.agents_md);
  exposeGuildSkillTree(root, inv, dest, resources);
  writeLauncher(dest, "agents");
  return dest;
}

/** Emit the Pi package: pi manifest + skill tree + CLI + launcher. */
export function writePiTree(
  root: string,
  inv: GuildInventoryV1,
  distRoot: string,
  generatedAt: string,
  resourceResolver?: ModuleResourceResolver
): string {
  const dest = path.join(distRoot, "pi");
  rmrf(dest);
  const resources = resourceResolver ?? loadModuleResourceResolver(root);
  const manifest = renderPiManifest(toNeutralManifest(inv), { renderedAt: generatedAt });
  writeFileEnsured(path.join(dest, "pi-manifest.json"), stableJson(manifest));
  exposeGuildSkillTree(root, inv, dest, resources);
  writeLauncher(dest, "pi");
  return dest;
}

/** Emit the Antigravity package: antigravity manifest + skill tree + CLI + launcher. */
export function writeAntigravityTree(
  root: string,
  inv: GuildInventoryV1,
  distRoot: string,
  generatedAt: string,
  resourceResolver?: ModuleResourceResolver
): string {
  const dest = path.join(distRoot, "antigravity");
  rmrf(dest);
  const resources = resourceResolver ?? loadModuleResourceResolver(root);
  const manifest = renderAntigravityManifest(toNeutralManifest(inv), { renderedAt: generatedAt });
  writeFileEnsured(path.join(dest, "antigravity-manifest.json"), stableJson(manifest));
  writeFileEnsured(path.join(dest, "plugin.json"), stableJson(manifest));
  exposeGuildSkillTree(root, inv, dest, resources);
  writeLauncher(dest, "antigravity");
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
  void codexJson;
  return {
    host: "codex",
    command_ids: [],
    skill_ids: inv.skills.map((s) => s.id), // exposed under .agents/skills/guild/**
    agent_ids: [], // Codex flags agents unsupported (render-or-degrade) — none referenced.
    mcp_server_ids: [],
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
  codexMarketplaceDir: string;
  /** P1-L6: the new-host trees (.agents universal, Pi, Antigravity). */
  agentsDir: string;
  piDir: string;
  antigravityDir: string;
  gateOk: boolean;
  reasons: string[];
  claudeInstallSurface?: ClaudeInstallSurfaceCheck;
}

/**
 * P1-L6: subset-gate references for an AGENTS.md-family host. Refs are derived from the
 * RENDERED package (the command NAMES the renderer emitted via commandNameFromPath, same
 * as codexPackageRefs), NOT from raw inventory ids — so the subset check verifies what is
 * actually rendered (codex G-lane fix). Skills are exposed under .agents/skills/guild/**
 * (every inventory skill); agents/hooks/mcp are degraded (render-or-degrade), none
 * referenced. checkSubset asserts every rendered reference exists in the inventory (SC-2
 * parity per new host).
 */
function newHostPackageRefs(
  host: string,
  inv: GuildInventoryV1,
  renderedCommandNames: string[]
): PackageReferences {
  return {
    host,
    command_ids: renderedCommandNames,
    skill_ids: inv.skills.map((s) => s.id),
    agent_ids: [],
    mcp_server_ids: [],
    // The new-host trees bundle the full scripts/ tree via exposeGuildSkillTree (incl.
    // the `guild-run` CLI the launcher invokes), so declare every bundled script id —
    // matching claudePackageRefs (the other all-scripts-copier). This makes the subset
    // gate verify the launcher's `guild-run` dependency exists in the inventory rather
    // than silently omitting it (codex G-lane R2 fix).
    script_ids: inv.scripts.map((s) => s.id),
    hook_ids: [],
    schema_versions: [],
  };
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
  syncClaudeInstall: boolean;
  checkClaudeInstall: boolean;
}): BuildResult {
  const inv = loadInventory(opts.root, opts.generatedAt);
  const resources = loadModuleResourceResolver(opts.root);

  const claudeDir = writeClaudeTree(opts.root, inv, opts.distRoot, opts.generatedAt, resources);
  const codexDir = writeCodexTree(opts.root, inv, opts.distRoot, opts.generatedAt, resources);
  const codexMarketplaceDir = writeCodexMarketplaceTree(codexDir, opts.distRoot);
  // P1-L6: new-host trees (INFERRED capability rows, installability: target).
  const agentsDir = writeAgentsTree(opts.root, inv, opts.distRoot, opts.generatedAt, resources);
  const piDir = writePiTree(opts.root, inv, opts.distRoot, opts.generatedAt, resources);
  const antigravityDir = writeAntigravityTree(opts.root, inv, opts.distRoot, opts.generatedAt, resources);

  const reasons: string[] = [];
  if (opts.syncClaudeInstall) {
    syncClaudeInstallSurface(opts.root, inv, opts.generatedAt);
  }
  const claudeInstallSurface = opts.checkClaudeInstall
    ? checkClaudeInstallSurface(opts.root, inv, opts.generatedAt)
    : undefined;
  if (claudeInstallSurface && !claudeInstallSurface.ok) {
    reasons.push(
      ...claudeInstallSurface.stale.map(
        (s) => `Claude install surface stale: ${s.path} (${s.reason})`
      )
    );
  }
  if (opts.gates) {
    // SC-2 — Claude full-tree equivalence with the anti-vacuity floor.
    const committed = loadLogicalPackage(opts.root);
    const generated = loadLogicalPackage(claudeDir);
    const eq = checkClaudeEquivalence(committed, generated, expectedSurfaces(inv));
    if (!eq.ok) reasons.push(...eq.reasons);

    // SC-7b / SC-2-per-new-host — subset: every rendered reference exists in the inventory.
    // New-host refs are derived from the RENDERED package output (command names), matching
    // codexPackageRefs (codex G-lane fix) — not from raw inventory ids.
    const neutral = toNeutralManifest(inv);
    const codexJson = renderCodexPluginJson(neutral, { renderedAt: opts.generatedAt });
    const agentsPkg = renderAgentsPackage(neutral, { renderedAt: opts.generatedAt });
    const piManifest = renderPiManifest(neutral, { renderedAt: opts.generatedAt });
    const antigravityManifest = renderAntigravityManifest(neutral, { renderedAt: opts.generatedAt });
    const subsets = [
      checkSubset(claudePackageRefs(inv), inv),
      checkSubset(codexPackageRefs(inv, codexJson), inv),
      checkSubset(newHostPackageRefs("agents", inv, agentsPkg.commands), inv),
      checkSubset(newHostPackageRefs("pi", inv, (piManifest.commands ?? []).map((c) => c.name)), inv),
      checkSubset(newHostPackageRefs("antigravity", inv, (antigravityManifest.commands ?? []).map((c) => c.name)), inv),
    ];
    for (const s of subsets) if (!s.ok) reasons.push(...s.reasons);
  }

  return {
    claudeDir,
    codexDir,
    codexMarketplaceDir,
    agentsDir,
    piDir,
    antigravityDir,
    gateOk: reasons.length === 0,
    reasons,
    claudeInstallSurface,
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

interface CliArgs {
  root: string;
  distRoot: string;
  generatedAt: string;
  gates: boolean;
  syncClaudeInstall: boolean;
  checkClaudeInstall: boolean;
}

export function parseArgs(argv: string[]): CliArgs | { error: string } {
  let root = PLUGIN_ROOT;
  let distRoot = "";
  let generatedAt = process.env["GUILD_INVENTORY_GENERATED_AT"] || UNSTAMPED_GENERATED_AT;
  let gates = true;
  let syncClaudeInstall = false;
  let checkClaudeInstall = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--root" && argv[i + 1] !== undefined) root = path.resolve(argv[++i]);
    else if (a.startsWith("--root=")) root = path.resolve(a.slice("--root=".length));
    else if (a === "--out" && argv[i + 1] !== undefined) distRoot = path.resolve(argv[++i]);
    else if (a.startsWith("--out=")) distRoot = path.resolve(a.slice("--out=".length));
    else if (a === "--generated-at" && argv[i + 1] !== undefined) generatedAt = argv[++i];
    else if (a.startsWith("--generated-at=")) generatedAt = a.slice("--generated-at=".length);
    else if (a === "--sync-claude-install") syncClaudeInstall = true;
    else if (a === "--check-claude-install") checkClaudeInstall = true;
    else if (a === "--no-gates") gates = false;
    else return { error: `unknown argument: ${a}` };
  }
  if (syncClaudeInstall) checkClaudeInstall = true;
  if (!distRoot) distRoot = path.join(root, "dist");
  return { root, distRoot, generatedAt, gates, syncClaudeInstall, checkClaudeInstall };
}

function main(): number {
  const parsed = parseArgs(process.argv.slice(2));
  if ("error" in parsed) {
    process.stderr.write(
      parsed.error +
        "\nusage: build-host-packages.ts [--root <pluginRoot>] [--out <distDir>] [--generated-at <iso>] [--sync-claude-install] [--check-claude-install] [--no-gates]\n"
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

  for (const d of [
    result.claudeDir,
    result.codexDir,
    result.codexMarketplaceDir,
    result.agentsDir,
    result.piDir,
    result.antigravityDir,
  ]) {
    process.stdout.write(`build:hosts: wrote ${d}\n`);
  }
  if (!result.gateOk) {
    process.stderr.write(
      "build:hosts: GATE FAILURE (SC-2 equivalence / SC-7b subset):\n  " +
        result.reasons.join("\n  ") +
        "\n"
    );
    return 2;
  }
  if (result.claudeInstallSurface) {
    process.stdout.write("build:hosts: Claude install surface matches generated module/inventory render.\n");
  }
  process.stdout.write("build:hosts: gates PASS (SC-2 equivalence + SC-7b subset).\n");
  return 0;
}

if (require.main === module) {
  process.exit(main());
}
