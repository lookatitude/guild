#!/usr/bin/env -S npx tsx
/**
 * src/modules/distribution/workflows/build-inventory.ts
 *
 * L1 — deterministic generator for the neutral core inventory
 * (`guild.inventory.v1`). Reads the LIVE Claude surface of the plugin repo and
 * emits `plugin/guild.inventory.json`, then self-enforces SC-7(a) COVERAGE
 * (`discovery == inventory`) so a surface that is silently dropped from the
 * inventory makes this generator FAIL (non-zero exit), never warn.
 *
 * Contract authority (consumed, never redefined):
 *   inventory-schema.ts   — guild.inventory.v1 type + validator
 *   parity-contract.ts    — DISCOVERY_RULES + checkCoverage (SC-7a)
 *   result-contracts.ts   — RESULT_CONTRACTS (curated schemas[])
 *   ADR: guild-inventory-and-parity-contracts (workspace wiki) (L0 ADR)
 *
 * DETERMINISM (L1 success criterion): identical inputs → byte-identical output.
 *   - Every category list is SORTED by id before emission (filesystem readdir
 *     order is not stable across platforms).
 *   - The generator never reads the clock. `generated_at` is supplied via
 *     `--generated-at` / `GUILD_INVENTORY_GENERATED_AT`, defaulting to an epoch
 *     sentinel. It is render-provenance (stripped by the SC-2 equivalence check),
 *     so an unstamped default keeps regeneration deterministic.
 *
 * IDENTITY (L0 followup — load-bearing): the id-derivation here MUST match the
 * discovery scan L6 runs, or coverage reports false mismatches. To GUARANTEE that,
 * `discoverSurfaces()` is exported and L6 imports it — there is one implementation
 * of the DISCOVERY_RULES, not two.
 *
 * Usage:
 *   npx tsx scripts/build-inventory.ts [--out <path>] [--root <pluginRoot>] \
 *       [--generated-at <iso>] [--check]
 *
 *   --out           Output path (default: <root>/guild.inventory.json).
 *   --root          Plugin root (default: the repo this script lives in).
 *   --generated-at  Provenance stamp (default: env or epoch sentinel).
 *   --check         Verify-only: build + validate + coverage, write nothing,
 *                   and additionally fail if the on-disk inventory is stale.
 *
 * Exit: 0 ok · 2 validation/coverage failure · 1 usage / IO error.
 *
 * Owned by tooling-engineer (L1); consumes L0; feeds L2 + L6.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import type {
  GuildInventoryV1,
  CommandEntry,
  SkillEntry,
  AgentEntry,
  HookEntry,
  McpServerEntry,
  ScriptEntry,
  SchemaEntry,
  DocEntry,
  InventoryManifest,
} from "./inventory-schema";
import { validateInventoryV1 } from "./inventory-schema";
import { readScalarField } from "../../state";
import {
  COVERAGE_ENFORCED_CATEGORIES,
  checkCoverage,
  type DiscoveredSurfaces,
} from "./parity-contract";
import { RESULT_CONTRACTS } from "./result-contracts";

/** Default plugin root. */
export const PLUGIN_ROOT = path.resolve(__dirname, "../../../..");

/** Epoch sentinel: an unstamped, deterministic provenance default. */
export const UNSTAMPED_GENERATED_AT = "1970-01-01T00:00:00.000Z";

// ---------------------------------------------------------------------------
// Filesystem helpers (no external glob dependency — deterministic, sorted)
// ---------------------------------------------------------------------------

/** POSIX-normalize a path (forward slashes), so ids/paths are platform-stable. */
function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}

function existsDir(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** List immediate *.md files in a directory (sorted). Returns [] if absent. */
function listMdFiles(dir: string): string[] {
  if (!existsDir(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .sort();
}

/**
 * Recursively collect files under `dir` matching `pred` (relpath, name). Skips
 * node_modules and __tests__ unconditionally. Returns repo-relative POSIX paths.
 */
function walkFiles(
  root: string,
  rel: string,
  pred: (relPath: string, name: string) => boolean,
  out: string[]
): void {
  const abs = path.join(root, rel);
  if (!existsDir(abs)) return;
  for (const name of fs.readdirSync(abs).sort()) {
    if (name === "node_modules" || name === "__tests__") continue;
    const childRel = rel ? `${rel}/${name}` : name;
    const childAbs = path.join(abs, name);
    let st: fs.Stats;
    try {
      st = fs.statSync(childAbs);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      walkFiles(root, childRel, pred, out);
    } else if (pred(toPosix(childRel), name)) {
      out.push(toPosix(childRel));
    }
  }
}

// ---------------------------------------------------------------------------
// Minimal frontmatter reader (single-line `key: value` only — all we need)
// ---------------------------------------------------------------------------

function readFile(abs: string): string {
  return fs.readFileSync(abs, "utf8");
}

/**
 * Read a single-line YAML frontmatter scalar field, or undefined.
 * Uses the shared ROBUST single-line reader (OD-3) rather than a whole-block
 * YAML parse: skill pages routinely carry a YAML-hostile unquoted `description:`
 * (colons/parens), which would make a whole-block `yaml.load` throw and hide a
 * perfectly readable `name:`. `readScalarField` reads the field line directly
 * (quote-stripped), tolerating such siblings. Empty/absent → undefined.
 */
function frontmatterField(content: string, field: string): string | undefined {
  return readScalarField(content, field);
}

// ---------------------------------------------------------------------------
// Per-category discovery (applies DISCOVERY_RULES from parity-contract.ts)
// ---------------------------------------------------------------------------

function discoverCommands(root: string): CommandEntry[] {
  const dir = path.join(root, "commands");
  return listMdFiles(dir)
    .map((file): CommandEntry => {
      const id = file.replace(/\.md$/i, "");
      const description = frontmatterField(readFile(path.join(dir, file)), "description");
      const e: CommandEntry = { id, source_path: `commands/${file}` };
      if (description) e.description = description;
      return e;
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

function discoverAgents(root: string): AgentEntry[] {
  const dir = path.join(root, "agents");
  return listMdFiles(dir)
    .map((file): AgentEntry => {
      const id = file.replace(/\.md$/i, "");
      const description = frontmatterField(readFile(path.join(dir, file)), "description");
      const e: AgentEntry = { id, source_path: `agents/${file}` };
      if (description) e.description = description;
      return e;
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Skills: glob skills/​**​/SKILL.md + SKILL.src.md; id = the literal `name:`
 * frontmatter value. A SKILL.src.md is the AUTHORED source — if both it and a
 * generated SKILL.md share a `name:` they collapse to ONE id (dedupe by name,
 * preferring the .src.md as source_path). Verified: no skill `name:` uses a
 * colon today (they are hyphenated, e.g. "guild-review", "ops-monitoring") — the
 * id is whatever the frontmatter literally says.
 */
function discoverSkills(root: string): SkillEntry[] {
  const files: string[] = [];
  walkFiles(root, "skills", (_rel, name) => name === "SKILL.md" || name === "SKILL.src.md", files);

  // name -> entry, with .src.md winning the source_path slot when both exist.
  const byName = new Map<string, { entry: SkillEntry; isSrc: boolean }>();
  for (const rel of files) {
    const content = readFile(path.join(root, rel));
    const id = frontmatterField(content, "name");
    if (!id) {
      throw new Error(`build-inventory: skill at ${rel} has no \`name:\` frontmatter (cannot derive id)`);
    }
    const isSrc = rel.endsWith("SKILL.src.md");
    // tier = first path segment after "skills/"
    const segs = rel.split("/");
    const tier = segs.length >= 3 ? segs[1] : undefined;
    const description = frontmatterField(content, "description");
    const entry: SkillEntry = { id, source_path: rel };
    if (tier) entry.tier = tier;
    if (description) entry.description = description;

    const prior = byName.get(id);
    if (!prior) {
      byName.set(id, { entry, isSrc });
    } else if (isSrc && !prior.isSrc) {
      // .src.md is the authored source — it wins the source_path.
      byName.set(id, { entry, isSrc });
    }
    // else: keep prior (prior is src, or both md — first sorted wins, deterministic).
  }
  return [...byName.values()].map((v) => v.entry).sort((a, b) => a.id.localeCompare(b.id));
}

/** Strip a host plugin-root variable and runner from a hook command → repo-relative script path. */
function hookScriptPath(command: string): string | null {
  // commands look like: "bash ${GUILD_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT}}/hooks/bootstrap.sh"
  //                     "node ${GUILD_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT}}/hooks/dist/x.js"
  const m = /\$\{(?:GUILD_PLUGIN_ROOT(?::-\$\{CLAUDE_PLUGIN_ROOT\})?|CLAUDE_PLUGIN_ROOT)\}\/([^\s"']+)/.exec(command);
  if (m) return m[1];
  // fallback: last whitespace-separated token that looks like a path
  const tokens = command.trim().split(/\s+/);
  const last = tokens[tokens.length - 1];
  return last && last.includes("/") ? last.replace(/^\.\//, "") : null;
}

/**
 * Hooks: parse hooks/hooks.json; ONE entry per (event, script) binding;
 * id = "<event>:<script-basename>". The binding is the surface, not the script.
 */
function discoverHooks(root: string): HookEntry[] {
  const file = path.join(root, "hooks", "hooks.json");
  if (!fs.existsSync(file)) return [];
  const parsed = JSON.parse(readFile(file)) as { hooks?: Record<string, unknown> };
  const hooksObj = parsed.hooks ?? {};
  const entries: HookEntry[] = [];
  for (const event of Object.keys(hooksObj)) {
    const blocks = hooksObj[event];
    if (!Array.isArray(blocks)) continue;
    for (const block of blocks) {
      const matcher = (block as { matcher?: string }).matcher;
      const inner = (block as { hooks?: Array<{ command?: string }> }).hooks ?? [];
      for (const h of inner) {
        if (!h.command) continue;
        const sp = hookScriptPath(h.command);
        if (!sp) continue;
        const base = sp.split("/").pop()!;
        const e: HookEntry = { id: `${event}:${base}`, source_path: sp, event };
        if (matcher) e.matcher = matcher;
        entries.push(e);
      }
    }
  }
  return entries.sort((a, b) => a.id.localeCompare(b.id));
}

/** MCP servers: parse .mcp.json `mcpServers`; id = each key. */
function discoverMcpServers(root: string): McpServerEntry[] {
  const file = path.join(root, ".mcp.json");
  if (!fs.existsSync(file)) return [];
  const parsed = JSON.parse(readFile(file)) as {
    mcpServers?: Record<string, Record<string, unknown>>;
  };
  const servers = parsed.mcpServers ?? {};
  const entries: McpServerEntry[] = [];
  for (const id of Object.keys(servers)) {
    const s = servers[id];
    // .mcp.json uses "type" for transport.
    const transport = s["type"] === "http" ? "http" : "stdio";
    const e: McpServerEntry = { id, source_path: ".mcp.json", transport };
    if (typeof s["command"] === "string") e.command = s["command"] as string;
    if (Array.isArray(s["args"])) e.args = (s["args"] as unknown[]).map(String);
    if (typeof s["url"] === "string") e.url = s["url"] as string;
    const cap = s["mcp_capability"] as { read_only?: boolean; description?: string } | undefined;
    if (cap && typeof cap.read_only === "boolean") e.read_only = cap.read_only;
    if (cap && typeof cap.description === "string") e.description = cap.description;
    entries.push(e);
  }
  return entries.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Scripts: scripts/​**​/*.ts excluding node_modules, __tests__, *.test.ts.
 * id = repo path under scripts/ without .ts (scripts/lib/x.ts → "lib/x").
 */
function discoverScripts(root: string): ScriptEntry[] {
  const files: string[] = [];
  walkFiles(
    root,
    "scripts",
    (rel, name) => name.endsWith(".ts") && !name.endsWith(".test.ts"),
    files
  );
  return files
    .map((rel): ScriptEntry => {
      const underScripts = rel.replace(/^scripts\//, "");
      const id = underScripts.replace(/\.ts$/, "");
      return { id, source_path: rel, kind: id.startsWith("lib/") ? "lib" : "cli" };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Hook-adjacent CLI bundles: hooks/dist/*.js files invoked DIRECTLY by shipped
 * command bodies (`node .../hooks/dist/<file>.js <subcommand>`) that carry NO
 * Claude Code hook-event binding in hooks/hooks.json. `run-trace.js` (the
 * `start|phase|status` CLI every phase command's intake step shells out to) is
 * the canonical example — distinct from the EVENT-bound `run-trace-start.js` /
 * `run-trace-close.js` hook handlers, which discoverHooks already covers.
 *
 * These don't belong in the "hooks" category — HookEntry.event models a real
 * (event, script) binding, and asserting a fake one would mislead any host
 * adapter that translates the GuildHookEvent taxonomy into native hook config.
 * They ARE modeled as `scripts` (kind "cli") so the existing per-host
 * scripts-copy loop already present in every tree writer (writeClaudeTree,
 * writeCodexTree, exposeGuildSkillTree) ships them for free — closing exactly
 * the packaging gap plugin-implementation-audit-2026-07-12 flagged ("Generated
 * packages omit hooks/dist/run-trace.js while every shipped phase command
 * invokes it").
 *
 * Discovery is closed over ALL such bundles, not just run-trace.js: any
 * `hooks/dist/*.js` referenced by a top-level `commands/*.md` body that is not
 * already a hooks.json event binding is picked up automatically, so a future
 * command that shells out to a new hook-adjacent CLI is covered without a
 * follow-up edit here.
 */
function discoverHookCliBundles(root: string, boundBasenames: ReadonlySet<string>): ScriptEntry[] {
  const distDir = path.join(root, "hooks", "dist");
  if (!existsDir(distDir)) return [];

  const referenced = new Set<string>();
  for (const file of listMdFiles(path.join(root, "commands"))) {
    const content = readFile(path.join(root, "commands", file));
    for (const m of content.matchAll(/hooks\/dist\/([A-Za-z0-9_.-]+\.js)/g)) {
      referenced.add(m[1]);
    }
  }

  return [...referenced]
    .filter((basename) => !boundBasenames.has(basename))
    .filter((basename) => fs.existsSync(path.join(distDir, basename)))
    .map(
      (basename): ScriptEntry => ({
        id: `hooks/dist/${basename.replace(/\.js$/, "")}`,
        source_path: `hooks/dist/${basename}`,
        kind: "cli",
      })
    )
    .sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Docs: the FULL docs/ tree (docs/​**​/*.md), recursive. id = repo-relative path
 * minus the .md extension (unique across the tree; basename alone would collide
 * across subdirs). Absent docs/ dir → []. Still non-enforced (no SC-7 fail-fixture)
 * — docs are a coverage/curation surface, not a load-bearing package input, so a
 * missing doc must not hard-fail the build. (FU-5: broadened from the Phase-1
 * decisions-only surface to the full docs/ tree.)
 */
function discoverDocs(root: string): DocEntry[] {
  const files: string[] = [];
  walkFiles(root, "docs", (_rel, name) => name.endsWith(".md"), files);
  return files
    .map((rel): DocEntry => {
      const id = rel.replace(/\.md$/i, "");
      const title = frontmatterField(readFile(path.join(root, rel)), "title");
      const e: DocEntry = { id, source_path: rel };
      if (title) e.title = title;
      return e;
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Schemas: NOT glob-discovered — emitted verbatim from the curated
 * RESULT_CONTRACTS registry (id = wire_schema_version). Deferred rows carry an
 * empty source_path (allowed only for status:"deferred"). Not consumed by any
 * renderer (no source-copy), so the registry's source_path values are passed
 * through as-registered.
 */
function discoverSchemas(): SchemaEntry[] {
  return RESULT_CONTRACTS.map(
    (c): SchemaEntry => ({
      id: c.wire_schema_version,
      source_path: c.source_path,
      status: c.status,
      validator_kind: c.validator_kind,
    })
  ).sort((a, b) => a.id.localeCompare(b.id));
}

// ---------------------------------------------------------------------------
// Discovery + inventory assembly (exported — L6 imports discoverSurfaces)
// ---------------------------------------------------------------------------

export interface DiscoveryOutput {
  commands: CommandEntry[];
  skills: SkillEntry[];
  agents: AgentEntry[];
  hooks: HookEntry[];
  mcp_servers: McpServerEntry[];
  scripts: ScriptEntry[];
  schemas: SchemaEntry[];
  docs: DocEntry[];
  /**
   * Per-category id sets for the SC-7(a) coverage check. Contains EXACTLY the
   * enforced categories (commands, agents, skills, hooks, mcp_servers, scripts)
   * so a coverage caller satisfies the anti-vacuity guard. schemas/docs are
   * non-enforced (registry/curated) and intentionally absent here.
   */
  discovered: DiscoveredSurfaces;
}

/**
 * THE single discovery implementation. L1 builds the inventory from it; L6
 * imports it to scan the live repo for the coverage fixture — guaranteeing both
 * sides apply identical id-derivation (L0 followup).
 */
export function discoverSurfaces(root: string = PLUGIN_ROOT): DiscoveryOutput {
  const commands = discoverCommands(root);
  const skills = discoverSkills(root);
  const agents = discoverAgents(root);
  const hooks = discoverHooks(root);
  const mcp_servers = discoverMcpServers(root);
  const boundHookBasenames = new Set(hooks.map((h) => h.source_path.split("/").pop()!));
  const scripts = [...discoverScripts(root), ...discoverHookCliBundles(root, boundHookBasenames)].sort(
    (a, b) => a.id.localeCompare(b.id)
  );
  const schemas = discoverSchemas();
  const docs = discoverDocs(root);

  const idSet = (list: Array<{ id: string }>): Set<string> => new Set(list.map((e) => e.id));
  const discovered: DiscoveredSurfaces = {
    commands: idSet(commands),
    agents: idSet(agents),
    skills: idSet(skills),
    hooks: idSet(hooks),
    mcp_servers: idSet(mcp_servers),
    scripts: idSet(scripts),
  };

  return { commands, skills, agents, hooks, mcp_servers, scripts, schemas, docs, discovered };
}

function readManifest(root: string): { manifest: InventoryManifest; version: string } {
  const file = path.join(root, ".claude-plugin", "plugin.json");
  const raw = JSON.parse(readFile(file)) as Record<string, unknown>;
  const manifest: InventoryManifest = {
    name: String(raw["name"] ?? ""),
    version: String(raw["version"] ?? ""),
    description: String(raw["description"] ?? ""),
  };
  if (typeof raw["homepage"] === "string") manifest.homepage = raw["homepage"] as string;
  if (typeof raw["repository"] === "string") manifest.repository = raw["repository"] as string;
  if (raw["author"] && typeof raw["author"] === "object") {
    manifest.author = raw["author"] as { name: string; email?: string };
  }
  if (typeof raw["license"] === "string") manifest.license = raw["license"] as string;
  if (Array.isArray(raw["keywords"])) manifest.keywords = (raw["keywords"] as unknown[]).map(String);
  return { manifest, version: manifest.version };
}

/**
 * Build a complete, validated `guild.inventory.v1` from the live surface.
 * Throws on validation failure or coverage mismatch (the generator FAILS, never
 * warns, on a silent drop — L1 success criterion).
 */
export function buildInventory(
  root: string = PLUGIN_ROOT,
  generatedAt: string = UNSTAMPED_GENERATED_AT
): GuildInventoryV1 {
  const d = discoverSurfaces(root);
  const { manifest, version } = readManifest(root);

  const inventory: GuildInventoryV1 = {
    schema_version: "guild.inventory.v1",
    generated_at: generatedAt,
    plugin_version: version,
    manifest,
    commands: d.commands,
    skills: d.skills,
    agents: d.agents,
    hooks: d.hooks,
    mcp_servers: d.mcp_servers,
    scripts: d.scripts,
    schemas: d.schemas,
    docs: d.docs,
  };

  const validation = validateInventoryV1(inventory);
  if (!validation.valid) {
    throw new Error(
      "build-inventory: generated inventory FAILED validation:\n  " +
        validation.errors.join("\n  ")
    );
  }

  // SC-7(a) self-check: discovery == inventory. Since the inventory is built FROM
  // `d`, this proves the wiring is consistent and that every enforced category was
  // scanned (the anti-vacuity guard). A mismatch is a generator bug → FAIL.
  const coverage = checkCoverage(d.discovered, inventory);
  if (!coverage.ok) {
    throw new Error(
      "build-inventory: SC-7(a) coverage self-check FAILED (discovery != inventory):\n  " +
        coverage.reasons.join("\n  ")
    );
  }
  // Defensive: every enforced category must have been supplied to the check.
  for (const cat of COVERAGE_ENFORCED_CATEGORIES) {
    if (d.discovered[cat] === undefined) {
      throw new Error(`build-inventory: enforced category "${cat}" was not scanned (internal error)`);
    }
  }

  return inventory;
}

/** Canonical JSON serialization (2-space, trailing newline) — stable on disk. */
export function serializeInventory(inventory: GuildInventoryV1): string {
  return JSON.stringify(inventory, null, 2) + "\n";
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

interface BuildArgs {
  out?: string;
  root: string;
  generatedAt: string;
  check: boolean;
}

export function parseArgs(argv: string[]): BuildArgs | { error: string } {
  let out: string | undefined;
  let root = PLUGIN_ROOT;
  let generatedAt = process.env["GUILD_INVENTORY_GENERATED_AT"] || UNSTAMPED_GENERATED_AT;
  let check = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--out" && argv[i + 1] !== undefined) out = argv[++i];
    else if (a.startsWith("--out=")) out = a.slice("--out=".length);
    else if (a === "--root" && argv[i + 1] !== undefined) root = path.resolve(argv[++i]);
    else if (a.startsWith("--root=")) root = path.resolve(a.slice("--root=".length));
    else if (a === "--generated-at" && argv[i + 1] !== undefined) generatedAt = argv[++i];
    else if (a.startsWith("--generated-at=")) generatedAt = a.slice("--generated-at=".length);
    else if (a === "--check") check = true;
    else return { error: `unknown argument: ${a}` };
  }
  return { out, root, generatedAt, check };
}

export function main(): number {
  const parsed = parseArgs(process.argv.slice(2));
  if ("error" in parsed) {
    process.stderr.write(
      parsed.error +
        "\nusage: build-inventory.ts [--out <path>] [--root <pluginRoot>] [--generated-at <iso>] [--check]\n"
    );
    return 1;
  }
  const outPath = parsed.out ?? path.join(parsed.root, "guild.inventory.json");

  let inventory: GuildInventoryV1;
  try {
    inventory = buildInventory(parsed.root, parsed.generatedAt);
  } catch (err) {
    process.stderr.write(String(err instanceof Error ? err.message : err) + "\n");
    return 2;
  }
  const serialized = serializeInventory(inventory);

  if (parsed.check) {
    let onDisk: string | null = null;
    try {
      onDisk = fs.readFileSync(outPath, "utf8");
    } catch {
      onDisk = null;
    }
    if (onDisk === null) {
      process.stderr.write(`build-inventory --check: ${outPath} does not exist (run without --check to generate)\n`);
      return 2;
    }
    if (onDisk !== serialized) {
      process.stderr.write(
        `build-inventory --check: ${outPath} is STALE — regenerate with \`npx tsx scripts/build-inventory.ts\`\n`
      );
      return 2;
    }
    process.stdout.write(`build-inventory: ${outPath} is up to date.\n`);
    return 0;
  }

  try {
    fs.writeFileSync(outPath, serialized);
  } catch (err) {
    process.stderr.write(`build-inventory: cannot write ${outPath}: ${String(err)}\n`);
    return 1;
  }
  process.stdout.write(
    `build-inventory: wrote ${outPath} (` +
      `${inventory.commands.length} commands, ${inventory.skills.length} skills, ` +
      `${inventory.agents.length} agents, ${inventory.hooks.length} hooks, ` +
      `${inventory.mcp_servers.length} mcp, ${inventory.scripts.length} scripts, ` +
      `${inventory.schemas.length} schemas, ${inventory.docs.length} docs)\n`
  );
  return 0;
}

if (require.main === module) {
  process.exit(main());
}
