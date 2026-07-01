/**
 * src/modules/distribution/workflows/module-resources.ts
 *
 * Materializes and validates module-owned resources under
 * src/modules/<module>/resources.
 *
 * Module resources are the source-of-truth body files for generated packages.
 * Top-level host-facing files remain as generated compatibility mirrors because
 * host package formats still expect those paths.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import { buildInventory, PLUGIN_ROOT } from "./build-inventory";
import {
  OWNED_INVENTORY_CATEGORIES,
  ownersFor,
  loadModuleManifests,
  validateModuleOwnership,
  type ModuleManifest,
  type OwnedInventoryCategory,
} from "../../kernel";

export const MODULE_RESOURCES_SCHEMA_VERSION = "guild.module_resources.v1" as const;
const GENERATED_MARKER = ".generated-by-guild-module-resources";

export interface ModuleResourceEntry {
  category: OwnedInventoryCategory;
  id: string;
  source_path: string;
  resource_path: string;
  sha256: string;
}

export interface ModuleResourceManifest {
  schema_version: typeof MODULE_RESOURCES_SCHEMA_VERSION;
  module_id: string;
  generated_from: "guild.inventory.v1";
  entries: ModuleResourceEntry[];
}

export interface ModuleResourcePlan {
  module_id: string;
  manifest_path: string;
  entries: ModuleResourceEntry[];
}

export interface ModuleResourceSyncResult {
  ok: boolean;
  checked: boolean;
  written: boolean;
  modules: number;
  resources: number;
  errors: string[];
}

export interface ModuleLiveResourceSyncResult {
  ok: boolean;
  checked: boolean;
  written: boolean;
  modules: number;
  resources: number;
  errors: string[];
}

interface SyncOptions {
  root?: string;
  check?: boolean;
}

function toPosix(value: string): string {
  return value.split(path.sep).join("/");
}

function sha256(content: Buffer): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function categoryEntries(
  inventory: ReturnType<typeof buildInventory>,
  category: OwnedInventoryCategory
): Array<{ id: string; source_path: string }> {
  return inventory[category] as Array<{ id: string; source_path: string }>;
}

function stripSurfacePrefix(category: OwnedInventoryCategory, sourcePath: string): string {
  const prefixes: Record<OwnedInventoryCategory, string> = {
    commands: "commands/",
    skills: "skills/",
    agents: "agents/",
    hooks: "hooks/",
    mcp_servers: "",
    scripts: "scripts/",
  };
  const prefix = prefixes[category];
  return prefix && sourcePath.startsWith(prefix) ? sourcePath.slice(prefix.length) : sourcePath;
}

function resourcePathFor(category: OwnedInventoryCategory, sourcePath: string): string {
  return toPosix(path.posix.join("resources", category, stripSurfacePrefix(category, sourcePath)));
}

function assertSafeRelativePath(value: string, label: string): void {
  if (path.isAbsolute(value)) {
    throw new Error(`${label} must be relative: ${value}`);
  }
  const parts = value.split(/[\\/]+/).filter(Boolean);
  if (parts.includes("..")) {
    throw new Error(`${label} must not traverse outside the plugin root: ${value}`);
  }
}

function stableManifest(moduleId: string, entries: ModuleResourceEntry[]): ModuleResourceManifest {
  return {
    schema_version: MODULE_RESOURCES_SCHEMA_VERSION,
    module_id: moduleId,
    generated_from: "guild.inventory.v1",
    entries: entries
      .slice()
      .sort((a, b) => `${a.category}:${a.id}`.localeCompare(`${b.category}:${b.id}`)),
  };
}

function serializeManifest(manifest: ModuleResourceManifest): string {
  return JSON.stringify(manifest, null, 2) + "\n";
}

export function buildModuleResourcePlan(root: string = PLUGIN_ROOT): ModuleResourcePlan[] {
  const inventory = buildInventory(root);
  const manifests = loadModuleManifests(root);
  const ownership = validateModuleOwnership(inventory, manifests);
  if (!ownership.ok) {
    throw new Error("module resource sync requires valid module ownership");
  }

  const plans = new Map<string, ModuleResourcePlan>();
  const manifestById = new Map<string, ModuleManifest>(manifests.map((manifest) => [manifest.id, manifest]));
  for (const manifest of manifests) {
    plans.set(manifest.id, {
      module_id: manifest.id,
      manifest_path: `src/modules/${manifest.id}/resources/module-resources.json`,
      entries: [],
    });
  }

  const seen = new Set<string>();
  for (const category of OWNED_INVENTORY_CATEGORIES) {
    for (const entry of categoryEntries(inventory, category)) {
      const owners = ownersFor(manifests, category, entry.id);
      if (owners.length !== 1) {
        throw new Error(`expected exactly one owner for ${category}:${entry.id}; got ${owners.join(",")}`);
      }
      const owner = owners[0];
      if (!manifestById.has(owner)) {
        throw new Error(`unknown owner ${owner} for ${category}:${entry.id}`);
      }
      const sourceAbs = path.join(root, entry.source_path);
      if (!fs.existsSync(sourceAbs) || !fs.statSync(sourceAbs).isFile()) {
        throw new Error(`source for ${category}:${entry.id} is missing or not a file: ${entry.source_path}`);
      }
      const content = fs.readFileSync(sourceAbs);
      const resourcePath = resourcePathFor(category, entry.source_path);
      const key = `${owner}:${resourcePath}`;
      if (seen.has(key)) continue;
      seen.add(key);
      plans.get(owner)!.entries.push({
        category,
        id: entry.id,
        source_path: entry.source_path,
        resource_path: resourcePath,
        sha256: sha256(content),
      });

      // RV-1/RV-2: a skill's SKILL.md is its only inventory entry, but the skill
      // directory also holds progressive-disclosure companion files (e.g.
      // quality-mechanics.md, loop-mechanics.md, io-contract.md) plus evals.json
      // that SKILL.md references and the host must therefore ship. Enumerate the
      // immediate sibling files (everything but SKILL.md / SKILL.src.md) so they
      // are tracked, SHA-pinned, mirrored into resources/, and rendered into host
      // packages alongside the skill. Same owner as the parent skill.
      if (category === "skills") {
        const skillDir = path.dirname(sourceAbs);
        for (const sib of fs.readdirSync(skillDir).sort()) {
          // SKILL.md/.src.md are the inventory entry itself; evals.json is a
          // dev-time eval fixture (NOT a runtime/progressive-disclosure reference)
          // and must NOT ship in host packages (PA ruling, lane TE).
          if (sib === "SKILL.md" || sib === "SKILL.src.md" || sib === "evals.json") continue;
          const sibAbs = path.join(skillDir, sib);
          if (!fs.statSync(sibAbs).isFile()) continue; // immediate files only
          const sibSourcePath = toPosix(path.relative(root, sibAbs));
          const sibResourcePath = resourcePathFor("skills", sibSourcePath);
          const sibKey = `${owner}:${sibResourcePath}`;
          if (seen.has(sibKey)) continue;
          seen.add(sibKey);
          plans.get(owner)!.entries.push({
            category: "skills",
            id: `${entry.id}/${sib}`,
            source_path: sibSourcePath,
            resource_path: sibResourcePath,
            sha256: sha256(fs.readFileSync(sibAbs)),
          });
        }
      }
    }
  }

  return [...plans.values()].sort((a, b) => a.module_id.localeCompare(b.module_id));
}

function assertGeneratedDirSafe(resourcesDir: string): void {
  if (!fs.existsSync(resourcesDir)) return;
  const marker = path.join(resourcesDir, GENERATED_MARKER);
  if (!fs.existsSync(marker)) {
    throw new Error(`${toPosix(resourcesDir)} exists without ${GENERATED_MARKER}; refusing to overwrite`);
  }
}

function writePlan(root: string, plan: ModuleResourcePlan): void {
  const resourcesDir = path.join(root, "src", "modules", plan.module_id, "resources");
  assertGeneratedDirSafe(resourcesDir);
  fs.rmSync(resourcesDir, { recursive: true, force: true });
  fs.mkdirSync(resourcesDir, { recursive: true });
  fs.writeFileSync(path.join(resourcesDir, GENERATED_MARKER), "generated by scripts/sync-module-resources.ts\n");

  for (const entry of plan.entries) {
    const sourceAbs = path.join(root, entry.source_path);
    const destAbs = path.join(root, "src", "modules", plan.module_id, entry.resource_path);
    fs.mkdirSync(path.dirname(destAbs), { recursive: true });
    fs.copyFileSync(sourceAbs, destAbs);
  }

  const manifest = stableManifest(plan.module_id, plan.entries);
  fs.writeFileSync(path.join(root, plan.manifest_path), serializeManifest(manifest));
}

function checkPlan(root: string, plan: ModuleResourcePlan): string[] {
  const errors: string[] = [];
  const resourcesDir = path.join(root, "src", "modules", plan.module_id, "resources");
  const marker = path.join(resourcesDir, GENERATED_MARKER);
  if (!fs.existsSync(marker)) {
    errors.push(`${plan.module_id}: missing generated resources marker`);
  }

  for (const entry of plan.entries) {
    const sourceAbs = path.join(root, entry.source_path);
    const resourceAbs = path.join(root, "src", "modules", plan.module_id, entry.resource_path);
    if (!fs.existsSync(resourceAbs)) {
      errors.push(`${plan.module_id}: missing resource ${entry.resource_path}`);
      continue;
    }
    const sourceHash = sha256(fs.readFileSync(sourceAbs));
    const resourceHash = sha256(fs.readFileSync(resourceAbs));
    if (sourceHash !== resourceHash || resourceHash !== entry.sha256) {
      errors.push(`${plan.module_id}: resource drift ${entry.resource_path}`);
    }
  }

  const expectedManifest = serializeManifest(stableManifest(plan.module_id, plan.entries));
  const manifestAbs = path.join(root, plan.manifest_path);
  const actualManifest = fs.existsSync(manifestAbs) ? fs.readFileSync(manifestAbs, "utf8") : null;
  if (actualManifest !== expectedManifest) {
    errors.push(`${plan.module_id}: module-resources.json is stale or missing`);
  }
  return errors;
}

function readModuleResourceManifest(root: string, moduleId: string): ModuleResourceManifest {
  const manifestAbs = path.join(root, "src", "modules", moduleId, "resources", "module-resources.json");
  if (!fs.existsSync(manifestAbs)) {
    throw new Error(`${moduleId}: missing resources/module-resources.json`);
  }
  const parsed = JSON.parse(fs.readFileSync(manifestAbs, "utf8")) as ModuleResourceManifest;
  if (parsed.schema_version !== MODULE_RESOURCES_SCHEMA_VERSION) {
    throw new Error(`${moduleId}: unsupported module resources schema ${String(parsed.schema_version)}`);
  }
  if (parsed.module_id !== moduleId) {
    throw new Error(`${moduleId}: module-resources.json module_id mismatch (${parsed.module_id})`);
  }
  if (!Array.isArray(parsed.entries)) {
    throw new Error(`${moduleId}: module-resources.json entries must be an array`);
  }
  for (const entry of parsed.entries) {
    if (!OWNED_INVENTORY_CATEGORIES.includes(entry.category)) {
      throw new Error(`${moduleId}: unsupported resource category ${String(entry.category)}`);
    }
    if (typeof entry.id !== "string" || entry.id.trim() === "") {
      throw new Error(`${moduleId}: resource id must be a non-empty string`);
    }
    assertSafeRelativePath(entry.source_path, `${moduleId}:${entry.id} source_path`);
    assertSafeRelativePath(entry.resource_path, `${moduleId}:${entry.id} resource_path`);
    if (!entry.resource_path.startsWith("resources/")) {
      throw new Error(`${moduleId}:${entry.id} resource_path must stay under resources/: ${entry.resource_path}`);
    }
    if (!/^[a-f0-9]{64}$/.test(entry.sha256)) {
      throw new Error(`${moduleId}:${entry.id} sha256 must be a lowercase SHA-256 hex digest`);
    }
  }
  return parsed;
}

function loadModuleResourceManifests(root: string): ModuleResourceManifest[] {
  const manifests = loadModuleManifests(root);
  return manifests
    .map((manifest) => readModuleResourceManifest(root, manifest.id))
    .sort((a, b) => a.module_id.localeCompare(b.module_id));
}

function validateResourceBytes(root: string, manifest: ModuleResourceManifest): string[] {
  const errors: string[] = [];
  const marker = path.join(root, "src", "modules", manifest.module_id, "resources", GENERATED_MARKER);
  if (!fs.existsSync(marker)) {
    errors.push(`${manifest.module_id}: missing generated resources marker`);
  }
  for (const entry of manifest.entries) {
    const resourceAbs = path.join(root, "src", "modules", manifest.module_id, entry.resource_path);
    if (!fs.existsSync(resourceAbs) || !fs.statSync(resourceAbs).isFile()) {
      errors.push(`${manifest.module_id}: missing module resource ${entry.resource_path}`);
      continue;
    }
    const resourceHash = sha256(fs.readFileSync(resourceAbs));
    if (resourceHash !== entry.sha256) {
      errors.push(`${manifest.module_id}: module resource hash drift ${entry.resource_path}`);
    }
  }
  return errors;
}

export function syncLiveResourcesFromModules(options: SyncOptions = {}): ModuleLiveResourceSyncResult {
  const root = options.root ?? PLUGIN_ROOT;
  const check = options.check ?? false;
  const errors: string[] = [];
  let manifests: ModuleResourceManifest[];
  try {
    manifests = loadModuleResourceManifests(root);
  } catch (err) {
    return {
      ok: false,
      checked: check,
      written: false,
      modules: 0,
      resources: 0,
      errors: [String(err instanceof Error ? err.message : err)],
    };
  }

  const ownerByTarget = new Map<string, { module_id: string; sha256: string }>();
  for (const manifest of manifests) {
    errors.push(...validateResourceBytes(root, manifest));
    for (const entry of manifest.entries) {
      const key = `${entry.category}:${entry.source_path}`;
      const previous = ownerByTarget.get(key);
      if (previous !== undefined && previous.sha256 !== entry.sha256) {
        errors.push(
          `${manifest.module_id}: conflicting live resource target ${key} already owned by ${previous.module_id}`
        );
      } else {
        ownerByTarget.set(key, { module_id: manifest.module_id, sha256: entry.sha256 });
      }
    }
  }
  if (errors.length > 0) {
    return {
      ok: false,
      checked: check,
      written: false,
      modules: manifests.length,
      resources: manifests.reduce((sum, manifest) => sum + manifest.entries.length, 0),
      errors,
    };
  }

  for (const manifest of manifests) {
    for (const entry of manifest.entries) {
      const resourceAbs = path.join(root, "src", "modules", manifest.module_id, entry.resource_path);
      const liveAbs = path.join(root, entry.source_path);
      if (check) {
        if (!fs.existsSync(liveAbs) || !fs.statSync(liveAbs).isFile()) {
          errors.push(`${manifest.module_id}: missing live resource ${entry.source_path}`);
          continue;
        }
        const liveHash = sha256(fs.readFileSync(liveAbs));
        if (liveHash !== entry.sha256) {
          errors.push(`${manifest.module_id}: live resource drift ${entry.source_path}`);
        }
      } else {
        try {
          fs.mkdirSync(path.dirname(liveAbs), { recursive: true });
          fs.copyFileSync(resourceAbs, liveAbs);
        } catch (err) {
          errors.push(`${manifest.module_id}: failed to write live resource ${entry.source_path}: ${String(err)}`);
        }
      }
    }
  }

  return {
    ok: errors.length === 0,
    checked: check,
    written: !check && errors.length === 0,
    modules: manifests.length,
    resources: manifests.reduce((sum, manifest) => sum + manifest.entries.length, 0),
    errors,
  };
}

export function syncModuleResources(options: SyncOptions = {}): ModuleResourceSyncResult {
  const root = options.root ?? PLUGIN_ROOT;
  const check = options.check ?? false;
  const errors: string[] = [];
  let plans: ModuleResourcePlan[];
  try {
    plans = buildModuleResourcePlan(root);
  } catch (err) {
    return {
      ok: false,
      checked: check,
      written: false,
      modules: 0,
      resources: 0,
      errors: [String(err instanceof Error ? err.message : err)],
    };
  }

  if (check) {
    for (const plan of plans) errors.push(...checkPlan(root, plan));
  } else {
    for (const plan of plans) {
      try {
        writePlan(root, plan);
      } catch (err) {
        errors.push(String(err instanceof Error ? err.message : err));
      }
    }
  }

  return {
    ok: errors.length === 0,
    checked: check,
    written: !check && errors.length === 0,
    modules: plans.length,
    resources: plans.reduce((sum, plan) => sum + plan.entries.length, 0),
    errors,
  };
}

export function parseModuleResourceArgs(argv: string[]): SyncOptions | { error: string } {
  let root = PLUGIN_ROOT;
  let check = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--root" && argv[i + 1] !== undefined) root = path.resolve(argv[++i]);
    else if (arg.startsWith("--root=")) root = path.resolve(arg.slice("--root=".length));
    else if (arg === "--check") check = true;
    else return { error: `unknown argument: ${arg}` };
  }
  return { root, check };
}

export function runModuleResourcesCli(argv: string[] = process.argv.slice(2)): number {
  const parsed = parseModuleResourceArgs(argv);
  if ("error" in parsed) {
    process.stderr.write(`${parsed.error}\nusage: sync-module-resources.ts [--root <pluginRoot>] [--check]\n`);
    return 1;
  }
  const result = syncModuleResources(parsed);
  if (!result.ok) {
    process.stderr.write(result.errors.join("\n") + "\n");
    return 2;
  }
  process.stdout.write(
    `sync-module-resources: ${result.checked ? "checked" : "wrote"} ` +
      `${result.resources} resources across ${result.modules} modules.\n`
  );
  return 0;
}

export function runModuleLiveResourcesCli(argv: string[] = process.argv.slice(2)): number {
  const parsed = parseModuleResourceArgs(argv);
  if ("error" in parsed) {
    process.stderr.write(`${parsed.error}\nusage: sync-live-resources.ts [--root <pluginRoot>] [--check]\n`);
    return 1;
  }
  const result = syncLiveResourcesFromModules(parsed);
  if (!result.ok) {
    process.stderr.write(result.errors.join("\n") + "\n");
    return 2;
  }
  process.stdout.write(
    `sync-live-resources: ${result.checked ? "checked" : "wrote"} ` +
      `${result.resources} resources across ${result.modules} modules.\n`
  );
  return 0;
}
