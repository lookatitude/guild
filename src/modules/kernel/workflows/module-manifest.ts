/**
 * src/modules/kernel/workflows/module-manifest.ts
 *
 * Canonical module-manifest validator for the additive plugin reorganization.
 * The live install surfaces stay where they are; module manifests under
 * src/modules/* declare which existing inventory ids each module owns.
 */

import * as fs from "node:fs";
import * as path from "node:path";

export const MODULE_MANIFEST_SCHEMA_VERSION = "guild.module_manifest.v1" as const;

export type ModuleKind = "capability" | "substrate" | "operator" | "build";
export type ModuleImplementationMode = "workflow-backed" | "resource-only";

export type OwnedInventoryCategory =
  | "commands"
  | "skills"
  | "agents"
  | "hooks"
  | "mcp_servers"
  | "scripts";

export const OWNED_INVENTORY_CATEGORIES: readonly OwnedInventoryCategory[] = [
  "commands",
  "skills",
  "agents",
  "hooks",
  "mcp_servers",
  "scripts",
];

export interface ModuleOwns {
  commands?: string[];
  command_id_prefixes?: string[];
  skills?: string[];
  skill_id_prefixes?: string[];
  agents?: string[];
  agent_id_prefixes?: string[];
  hooks?: string[];
  hook_id_prefixes?: string[];
  mcp_servers?: string[];
  mcp_server_id_prefixes?: string[];
  scripts?: string[];
  script_id_prefixes?: string[];
}

export interface ModuleManifest {
  schema_version: typeof MODULE_MANIFEST_SCHEMA_VERSION;
  id: string;
  title: string;
  kind: ModuleKind;
  implementation_mode: ModuleImplementationMode;
  description: string;
  depends_on?: string[];
  lifecycle_slots?: string[];
  owns: ModuleOwns;
}

export interface ModuleValidationResult {
  ok: boolean;
  errors: string[];
}

export interface OwnershipFinding {
  category: OwnedInventoryCategory;
  id: string;
  source_path: string;
  owners: string[];
}

export interface OwnershipValidationResult {
  ok: boolean;
  missing: OwnershipFinding[];
  duplicate: OwnershipFinding[];
  errors: string[];
}

export interface ModuleInventoryEntry {
  id: string;
  source_path: string;
}

export type ModuleInventory = Record<OwnedInventoryCategory, ModuleInventoryEntry[]>;

export interface ModuleBoundaryViolation {
  importer: string;
  imported: string;
  from_module: string;
  to_module: string;
  specifier: string;
  reason: "undeclared_dependency" | "private_import" | "host_facing_import";
}

export interface ModuleBoundaryValidationResult {
  ok: boolean;
  violations: ModuleBoundaryViolation[];
  errors: string[];
}

export type ModuleHealthFindingReason =
  | "missing_module_directory"
  | "missing_resources_manifest"
  | "missing_resources_marker"
  | "workflow_module_missing_public_index"
  | "resource_only_module_has_workflows"
  | "workflow_backed_module_has_no_workflows";

export interface ModuleHealthFinding {
  module_id: string;
  reason: ModuleHealthFindingReason;
  path: string;
}

export interface ModuleHealthSummary {
  module_id: string;
  kind: ModuleKind;
  implementation_mode: ModuleImplementationMode;
  resources: number;
  workflows: number;
  has_public_index: boolean;
}

export interface ModuleHealthValidationResult {
  ok: boolean;
  modules: ModuleHealthSummary[];
  findings: ModuleHealthFinding[];
}

const CATEGORY_KEYS: Record<
  OwnedInventoryCategory,
  { ids: keyof ModuleOwns; prefixes: keyof ModuleOwns }
> = {
  commands: { ids: "commands", prefixes: "command_id_prefixes" },
  skills: { ids: "skills", prefixes: "skill_id_prefixes" },
  agents: { ids: "agents", prefixes: "agent_id_prefixes" },
  hooks: { ids: "hooks", prefixes: "hook_id_prefixes" },
  mcp_servers: { ids: "mcp_servers", prefixes: "mcp_server_id_prefixes" },
  scripts: { ids: "scripts", prefixes: "script_id_prefixes" },
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string" && item.length > 0);
}

function validateManifest(value: unknown, relPath: string): ModuleValidationResult {
  const errors: string[] = [];
  if (!isPlainObject(value)) {
    return { ok: false, errors: [`${relPath}: manifest must be an object`] };
  }

  if (value.schema_version !== MODULE_MANIFEST_SCHEMA_VERSION) {
    errors.push(`${relPath}: schema_version must be ${MODULE_MANIFEST_SCHEMA_VERSION}`);
  }
  if (typeof value.id !== "string" || value.id.trim() === "") {
    errors.push(`${relPath}: id must be a non-empty string`);
  }
  if (typeof value.title !== "string" || value.title.trim() === "") {
    errors.push(`${relPath}: title must be a non-empty string`);
  }
  if (!["capability", "substrate", "operator", "build"].includes(String(value.kind))) {
    errors.push(`${relPath}: kind must be capability|substrate|operator|build`);
  }
  if (!["workflow-backed", "resource-only"].includes(String(value.implementation_mode))) {
    errors.push(`${relPath}: implementation_mode must be workflow-backed|resource-only`);
  }
  if (typeof value.description !== "string" || value.description.trim() === "") {
    errors.push(`${relPath}: description must be a non-empty string`);
  }
  if (value.depends_on !== undefined && !isStringArray(value.depends_on)) {
    errors.push(`${relPath}: depends_on must be a string array when present`);
  }
  if (value.lifecycle_slots !== undefined && !isStringArray(value.lifecycle_slots)) {
    errors.push(`${relPath}: lifecycle_slots must be a string array when present`);
  }
  if (!isPlainObject(value.owns)) {
    errors.push(`${relPath}: owns must be an object`);
  } else {
    const allowed = new Set(Object.values(CATEGORY_KEYS).flatMap((keys) => [keys.ids, keys.prefixes]));
    for (const key of Object.keys(value.owns)) {
      if (!allowed.has(key as keyof ModuleOwns)) {
        errors.push(`${relPath}: owns.${key} is not a supported ownership selector`);
      } else if (!isStringArray((value.owns as Record<string, unknown>)[key])) {
        errors.push(`${relPath}: owns.${key} must be a string array`);
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

export function loadModuleManifests(root: string): ModuleManifest[] {
  const modulesDir = path.join(root, "src", "modules");
  const manifests: ModuleManifest[] = [];
  if (!fs.existsSync(modulesDir)) return manifests;

  for (const name of fs.readdirSync(modulesDir).sort()) {
    const manifestPath = path.join(modulesDir, name, "module.manifest.json");
    if (!fs.existsSync(manifestPath)) continue;
    const relPath = path.relative(root, manifestPath).split(path.sep).join("/");
    let parsed: unknown;
    try {
      parsed = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    } catch (err) {
      throw new Error(`${relPath}: cannot parse JSON: ${String(err)}`);
    }
    const validation = validateManifest(parsed, relPath);
    if (!validation.ok) {
      throw new Error(validation.errors.join("\n"));
    }
    manifests.push(parsed as ModuleManifest);
  }
  return manifests;
}

function ownsId(manifest: ModuleManifest, category: OwnedInventoryCategory, id: string): boolean {
  const keys = CATEGORY_KEYS[category];
  const exact = manifest.owns[keys.ids] ?? [];
  const prefixes = manifest.owns[keys.prefixes] ?? [];
  return exact.includes(id) || prefixes.some((prefix) => id.startsWith(prefix));
}

export function ownersFor(
  manifests: readonly ModuleManifest[],
  category: OwnedInventoryCategory,
  id: string
): string[] {
  return manifests.filter((manifest) => ownsId(manifest, category, id)).map((manifest) => manifest.id);
}

function entriesFor(
  inventory: ModuleInventory,
  category: OwnedInventoryCategory
): Array<{ id: string; source_path: string }> {
  return inventory[category] as Array<{ id: string; source_path: string }>;
}

export function validateModuleOwnership(
  inventory: ModuleInventory,
  manifests: readonly ModuleManifest[]
): OwnershipValidationResult {
  const errors: string[] = [];
  const missing: OwnershipFinding[] = [];
  const duplicate: OwnershipFinding[] = [];
  const ids = new Set<string>();

  for (const manifest of manifests) {
    if (ids.has(manifest.id)) errors.push(`duplicate module id ${JSON.stringify(manifest.id)}`);
    ids.add(manifest.id);
    for (const dep of manifest.depends_on ?? []) {
      if (!ids.has(dep) && !manifests.some((candidate) => candidate.id === dep)) {
        errors.push(`module ${manifest.id} depends on unknown module ${dep}`);
      }
    }
  }

  for (const category of OWNED_INVENTORY_CATEGORIES) {
    for (const entry of entriesFor(inventory, category)) {
      const owners = ownersFor(manifests, category, entry.id);
      const finding: OwnershipFinding = {
        category,
        id: entry.id,
        source_path: entry.source_path,
        owners,
      };
      if (owners.length === 0) missing.push(finding);
      if (owners.length > 1) duplicate.push(finding);
    }
  }

  return {
    ok: errors.length === 0 && missing.length === 0 && duplicate.length === 0,
    missing,
    duplicate,
    errors,
  };
}

function walkTsFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const files: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walkTsFiles(fullPath));
    else if (entry.isFile() && entry.name.endsWith(".ts")) files.push(fullPath);
  }
  return files.sort();
}

function countWorkflowFiles(moduleDir: string): number {
  const workflowsDir = path.join(moduleDir, "workflows");
  return walkTsFiles(workflowsDir).length;
}

function countModuleResources(root: string, moduleId: string): number {
  const manifestAbs = path.join(root, "src", "modules", moduleId, "resources", "module-resources.json");
  if (!fs.existsSync(manifestAbs)) return 0;
  try {
    const parsed = JSON.parse(fs.readFileSync(manifestAbs, "utf8")) as { entries?: unknown };
    return Array.isArray(parsed.entries) ? parsed.entries.length : 0;
  } catch {
    return 0;
  }
}

export function validateModuleHealth(
  root: string,
  manifests: readonly ModuleManifest[]
): ModuleHealthValidationResult {
  const findings: ModuleHealthFinding[] = [];
  const modules: ModuleHealthSummary[] = [];
  const modulesDir = path.join(root, "src", "modules");

  for (const manifest of manifests) {
    const moduleDir = path.join(modulesDir, manifest.id);
    const relModuleDir = `src/modules/${manifest.id}`;
    if (!fs.existsSync(moduleDir) || !fs.statSync(moduleDir).isDirectory()) {
      findings.push({ module_id: manifest.id, reason: "missing_module_directory", path: relModuleDir });
      modules.push({
        module_id: manifest.id,
        kind: manifest.kind,
        implementation_mode: manifest.implementation_mode,
        resources: 0,
        workflows: 0,
        has_public_index: false,
      });
      continue;
    }

    const resourcesManifest = path.join(moduleDir, "resources", "module-resources.json");
    const resourcesMarker = path.join(moduleDir, "resources", ".generated-by-guild-module-resources");
    const indexPath = path.join(moduleDir, "index.ts");
    const workflows = countWorkflowFiles(moduleDir);
    const hasPublicIndex = fs.existsSync(indexPath) && fs.statSync(indexPath).isFile();

    if (!fs.existsSync(resourcesManifest) || !fs.statSync(resourcesManifest).isFile()) {
      findings.push({
        module_id: manifest.id,
        reason: "missing_resources_manifest",
        path: `${relModuleDir}/resources/module-resources.json`,
      });
    }
    if (!fs.existsSync(resourcesMarker) || !fs.statSync(resourcesMarker).isFile()) {
      findings.push({
        module_id: manifest.id,
        reason: "missing_resources_marker",
        path: `${relModuleDir}/resources/.generated-by-guild-module-resources`,
      });
    }
    if (workflows > 0 && !hasPublicIndex) {
      findings.push({
        module_id: manifest.id,
        reason: "workflow_module_missing_public_index",
        path: `${relModuleDir}/index.ts`,
      });
    }
    if (manifest.implementation_mode === "resource-only" && workflows > 0) {
      findings.push({
        module_id: manifest.id,
        reason: "resource_only_module_has_workflows",
        path: `${relModuleDir}/workflows`,
      });
    }
    if (manifest.implementation_mode === "workflow-backed" && workflows === 0) {
      findings.push({
        module_id: manifest.id,
        reason: "workflow_backed_module_has_no_workflows",
        path: `${relModuleDir}/workflows`,
      });
    }

    modules.push({
      module_id: manifest.id,
      kind: manifest.kind,
      implementation_mode: manifest.implementation_mode,
      resources: countModuleResources(root, manifest.id),
      workflows,
      has_public_index: hasPublicIndex,
    });
  }

  return { ok: findings.length === 0, modules, findings };
}

function resolveTsImport(importer: string, specifier: string): string | null {
  if (!specifier.startsWith(".")) return null;
  const base = path.resolve(path.dirname(importer), specifier);
  const candidates = [
    base,
    `${base}.ts`,
    path.join(base, "index.ts"),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile()) ?? base;
}

function moduleIdForPath(modulesDir: string, filePath: string, moduleIds: ReadonlySet<string>): string | null {
  const rel = path.relative(modulesDir, filePath);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
  const [moduleId] = rel.split(path.sep);
  return moduleIds.has(moduleId) ? moduleId : null;
}

interface DependencyToken {
  kind: "word" | "number" | "string" | "punctuation";
  value: string;
  lineBreakBefore: boolean;
}

/**
 * Tokenize only the JavaScript/TypeScript surface needed by the boundary rail.
 * Comments, regex literals, and template raw text are discarded; template
 * interpolations remain live code. Ordinary strings stay distinguishable from
 * words and punctuation so recognition cannot span unrelated statements.
 */
function dependencyTokens(source: string): DependencyToken[] {
  const tokens: DependencyToken[] = [];
  let index = 0;
  let lineBreakBefore = false;
  const push = (kind: DependencyToken["kind"], value: string): void => {
    tokens.push({ kind, value, lineBreakBefore });
    lineBreakBefore = false;
  };
  const regexMayStart = (): boolean => {
    const previous = tokens[tokens.length - 1];
    if (!previous) return true;
    if (previous.kind === "number" || previous.kind === "string") return false;
    if (previous.kind === "word") {
      return ["case", "delete", "else", "in", "instanceof", "new", "return", "throw", "typeof", "void", "yield"].includes(
        previous.value
      );
    }
    return ![")", "]", "}"].includes(previous.value);
  };

  const scanCode = (stopAtInterpolationEnd: boolean): void => {
    let braceDepth = 0;
    while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];

    if (/\s/.test(char)) {
      if (char === "\n" || char === "\r") lineBreakBefore = true;
      index += 1;
      continue;
    }
    if (char === "/" && next === "/") {
      index += 2;
      while (index < source.length && source[index] !== "\n") index += 1;
      continue;
    }
    if (char === "/" && next === "*") {
      index += 2;
      while (index < source.length && !(source[index] === "*" && source[index + 1] === "/")) {
        index += 1;
      }
      index = Math.min(source.length, index + 2);
      continue;
    }
    if (char === "/" && regexMayStart()) {
      index += 1;
      let inCharacterClass = false;
      while (index < source.length) {
        if (source[index] === "\\") {
          index += 2;
        } else if (source[index] === "[") {
          inCharacterClass = true;
          index += 1;
        } else if (source[index] === "]") {
          inCharacterClass = false;
          index += 1;
        } else if (source[index] === "/" && !inCharacterClass) {
          index += 1;
          while (index < source.length && /[A-Za-z]/.test(source[index])) index += 1;
          break;
        } else {
          index += 1;
        }
      }
      continue;
    }
    if (char === "`") {
      index += 1;
      while (index < source.length) {
        if (source[index] === "\\") {
          index += 2;
        } else if (source[index] === "$" && source[index + 1] === "{") {
          index += 2;
          scanCode(true);
        } else if (source[index] === "`") {
          index += 1;
          break;
        } else {
          index += 1;
        }
      }
      continue;
    }
    if (stopAtInterpolationEnd && char === "}" && braceDepth === 0) {
      index += 1;
      return;
    }
    if (char === '"' || char === "'") {
      const quote = char;
      let value = "";
      index += 1;
      while (index < source.length) {
        if (source[index] === "\\") {
          value += source[index];
          if (index + 1 < source.length) value += source[index + 1];
          index += 2;
        } else if (source[index] === quote) {
          index += 1;
          break;
        } else {
          value += source[index];
          index += 1;
        }
      }
      push("string", value);
      continue;
    }
    if (/[A-Za-z_$]/.test(char)) {
      const start = index;
      index += 1;
      while (index < source.length && /[A-Za-z0-9_$]/.test(source[index])) index += 1;
      push("word", source.slice(start, index));
      continue;
    }
    if (/[0-9]/.test(char)) {
      const numeric = source.slice(index).match(
        /^(?:0[xX][0-9A-Fa-f_]+|0[bB][01_]+|0[oO][0-7_]+|(?:[0-9][0-9_]*(?:\.[0-9_]*)?)(?:[eE][+-]?[0-9_]+)?)[n]?/
      );
      if (numeric) {
        push("number", numeric[0]);
        index += numeric[0].length;
        continue;
      }
    }

    if (stopAtInterpolationEnd && char === "{") braceDepth += 1;
    if (stopAtInterpolationEnd && char === "}" && braceDepth > 0) braceDepth -= 1;
    push("punctuation", char);
    index += 1;
    }
  };

  scanCode(false);

  return tokens;
}

function literalRelativeDependencySpecifiers(source: string): string[] {
  const tokens = dependencyTokens(source);
  const specifiers: string[] = [];
  const addString = (token: DependencyToken | undefined): void => {
    if (token?.kind === "string" && token.value.startsWith(".")) specifiers.push(token.value);
  };

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.kind !== "word") continue;
    const previous = tokens[index - 1];
    const isMember = previous?.value === "." || previous?.value === "?.";

    if (token.value === "require" && !isMember && tokens[index + 1]?.value === "(") {
      addString(tokens[index + 2]);
      continue;
    }
    if (token.value !== "import" && token.value !== "export") continue;

    if (token.value === "import" && !isMember && tokens[index + 1]?.value === "(") {
      addString(tokens[index + 2]);
      continue;
    }
    if (token.value === "import" && tokens[index + 1]?.kind === "string") {
      addString(tokens[index + 1]);
      continue;
    }

    for (let cursor = index + 1; cursor < tokens.length; cursor += 1) {
      const candidate = tokens[cursor];
      if (candidate.value === ";") break;
      if (
        candidate.lineBreakBefore &&
        candidate.kind === "word" &&
        ["const", "let", "var", "function", "class", "return", "throw"].includes(candidate.value)
      ) {
        break;
      }
      if (candidate.kind === "word" && (candidate.value === "import" || candidate.value === "export")) {
        break;
      }
      if (candidate.kind === "word" && candidate.value === "from") {
        addString(tokens[cursor + 1]);
        break;
      }
    }
  }

  return specifiers;
}

/**
 * Top-level trees that host-face: they mirror module logic for one host rather
 * than owning it. A module reaching into one of these is depending on a mirror
 * instead of a public module API, so the destination lands outside
 * `src/modules` and every module-ownership rule stops applying to it.
 */
const HOST_FACING_ROOTS: readonly string[] = ["hooks", "scripts"];

/**
 * The host-facing root a resolved import lands in, or `null` when it stays
 * inside the repository's module tree (or leaves the repository entirely).
 */
function hostFacingRootFor(root: string, filePath: string): string | null {
  const rel = path.relative(root, filePath);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
  const [top] = rel.split(path.sep);
  return HOST_FACING_ROOTS.includes(top) ? top : null;
}

export function validateModuleBoundaries(
  root: string,
  manifests: readonly ModuleManifest[]
): ModuleBoundaryValidationResult {
  const errors: string[] = [];
  const violations: ModuleBoundaryViolation[] = [];
  const modulesDir = path.join(root, "src", "modules");
  const moduleIds = new Set(manifests.map((manifest) => manifest.id));
  const manifestById = new Map(manifests.map((manifest) => [manifest.id, manifest]));
  const seenImporterSpecifiers = new Set<string>();

  for (const manifest of manifests) {
    const moduleDir = path.join(modulesDir, manifest.id);
    if (!fs.existsSync(moduleDir)) {
      errors.push(`module ${manifest.id} has no src/modules/${manifest.id} directory`);
    }
  }

  for (const importer of walkTsFiles(modulesDir)) {
    const fromModule = moduleIdForPath(modulesDir, importer, moduleIds);
    if (!fromModule) continue;
    const text = fs.readFileSync(importer, "utf8");
    for (const specifier of literalRelativeDependencySpecifiers(text)) {
      const importerSpecifier = `${importer}\0${specifier}`;
      if (seenImporterSpecifiers.has(importerSpecifier)) continue;
      seenImporterSpecifiers.add(importerSpecifier);
      const importedPath = resolveTsImport(importer, specifier);
      if (!importedPath) continue;
      const toModule = moduleIdForPath(modulesDir, importedPath, moduleIds);
      if (!toModule) {
        const hostRoot = hostFacingRootFor(root, importedPath);
        if (hostRoot) {
          violations.push({
            importer: path.relative(root, importer).split(path.sep).join("/"),
            imported: path.relative(root, importedPath).split(path.sep).join("/"),
            from_module: fromModule,
            to_module: hostRoot,
            specifier,
            reason: "host_facing_import",
          });
        }
        continue;
      }
      if (toModule === fromModule) continue;
      const dependsOn = manifestById.get(fromModule)?.depends_on ?? [];
      if (!dependsOn.includes(toModule)) {
        violations.push({
          importer: path.relative(root, importer).split(path.sep).join("/"),
          imported: path.relative(root, importedPath).split(path.sep).join("/"),
          from_module: fromModule,
          to_module: toModule,
          specifier,
          reason: "undeclared_dependency",
        });
        continue;
      }
      const publicEntrypoint = path.join(modulesDir, toModule, "index.ts");
      if (path.resolve(importedPath) !== path.resolve(publicEntrypoint)) {
        violations.push({
          importer: path.relative(root, importer).split(path.sep).join("/"),
          imported: path.relative(root, importedPath).split(path.sep).join("/"),
          from_module: fromModule,
          to_module: toModule,
          specifier,
          reason: "private_import",
        });
      }
    }
  }

  return {
    ok: errors.length === 0 && violations.length === 0,
    violations,
    errors,
  };
}

export function formatOwnershipValidation(result: OwnershipValidationResult): string {
  const lines: string[] = [];
  for (const error of result.errors) lines.push(`ERROR ${error}`);
  for (const item of result.missing) {
    lines.push(`MISSING ${item.category}:${item.id} (${item.source_path})`);
  }
  for (const item of result.duplicate) {
    lines.push(`DUPLICATE ${item.category}:${item.id} owners=${item.owners.join(",")}`);
  }
  return lines.join("\n");
}

export function formatBoundaryValidation(result: ModuleBoundaryValidationResult): string {
  const lines: string[] = [];
  for (const error of result.errors) lines.push(`ERROR ${error}`);
  for (const item of result.violations) {
    if (item.reason === "undeclared_dependency") {
      lines.push(
        `BOUNDARY ${item.importer} imports ${item.to_module} via ${JSON.stringify(item.specifier)} ` +
          `without ${item.from_module}.depends_on including ${item.to_module}`
      );
    } else if (item.reason === "host_facing_import") {
      lines.push(
        `BOUNDARY ${item.importer} imports host-facing ${item.imported} via ${JSON.stringify(item.specifier)}; ` +
          `module ${item.from_module} must not depend on the ${item.to_module}/ mirror`
      );
    } else {
      lines.push(
        `BOUNDARY ${item.importer} imports private ${item.imported} via ${JSON.stringify(item.specifier)}; ` +
          `cross-module imports must target src/modules/${item.to_module}/index.ts`
      );
    }
  }
  return lines.join("\n");
}

export function formatModuleHealthValidation(result: ModuleHealthValidationResult): string {
  const lines: string[] = [];
  for (const finding of result.findings) {
    if (finding.reason === "workflow_module_missing_public_index") {
      lines.push(`HEALTH ${finding.module_id}: workflow module must expose public ${finding.path}`);
    } else if (finding.reason === "resource_only_module_has_workflows") {
      lines.push(`HEALTH ${finding.module_id}: resource-only module must not define workflows at ${finding.path}`);
    } else if (finding.reason === "workflow_backed_module_has_no_workflows") {
      lines.push(`HEALTH ${finding.module_id}: workflow-backed module must define workflows at ${finding.path}`);
    } else if (finding.reason === "missing_resources_manifest") {
      lines.push(`HEALTH ${finding.module_id}: missing generated resource manifest ${finding.path}`);
    } else if (finding.reason === "missing_resources_marker") {
      lines.push(`HEALTH ${finding.module_id}: missing generated resource marker ${finding.path}`);
    } else {
      lines.push(`HEALTH ${finding.module_id}: missing module directory ${finding.path}`);
    }
  }
  return lines.join("\n");
}

export type ModuleInventoryCategory = OwnedInventoryCategory;
