/**
 * scripts/lib/guild-discovery.ts
 *
 * R6 host-neutral discovery for the two Guild state levels:
 *   1. workspace/root umbrella project
 *   2. immediate sub-project
 *
 * This is intentionally filesystem-only. Hosts call the same helper whether
 * they start in Claude, Codex, Pi, Antigravity, or an app wrapper.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { resolveGuildRoot } from "./guild-root";

export type GuildLevel = "workspace" | "project";
type WorkspaceMode = "auto" | "on" | "off";

export interface WorkspaceSubGuild {
  name: string;
  path: string;
  kind?: string;
  has_wiki?: boolean;
  has_indexes?: boolean;
}

export interface WorkspaceManifest {
  schema_version: string;
  is_workspace?: boolean;
  sub_guilds?: WorkspaceSubGuild[];
}

export interface GuildDiscovery {
  startCwd: string;
  activeRoot: string;
  guildDir: string;
  level: GuildLevel;
  workspaceRoot: string | null;
  registeredName: string | null;
  federationDepth: 0 | 1;
  canonicalMemory: {
    wiki: string;
    raw: string;
    indexes: string;
    indexSqlite: string;
  };
}

export interface ReadThroughSource {
  name: string;
  childRoot: string;
  agentsPath: string | null;
  guildDir: string | null;
  wikiDir: string | null;
  indexesDir: string | null;
  sourceTag: string;
}

function readJson(file: string): unknown | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function resolveRepoRootPreferGit(startCwd: string): string {
  let current = path.resolve(startCwd);
  let firstGuildRoot: string | null = null;

  for (;;) {
    if (fs.existsSync(path.join(current, ".git"))) return current;

    const guildDir = path.join(current, ".guild");
    if (firstGuildRoot === null && fs.existsSync(guildDir)) {
      try {
        if (fs.statSync(guildDir).isDirectory()) firstGuildRoot = current;
      } catch {
        // keep walking
      }
    }

    const parent = path.dirname(current);
    if (parent === current) return firstGuildRoot ?? resolveGuildRoot(startCwd);
    current = parent;
  }
}

function readWorkspaceMode(root: string): WorkspaceMode {
  const raw = readJson(path.join(root, ".guild", "settings.json"));
  if (!raw || typeof raw !== "object") return "auto";
  const workspace = (raw as Record<string, unknown>)["workspace"];
  if (!workspace || typeof workspace !== "object") return "auto";
  const mode = (workspace as Record<string, unknown>)["mode"];
  return mode === "on" || mode === "off" || mode === "auto" ? mode : "auto";
}

export function readWorkspaceManifest(root: string): WorkspaceManifest | null {
  const raw = readJson(path.join(root, ".guild", "workspace.json"));
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  if (obj["schema_version"] !== "guild.workspace.v1") return null;
  return raw as WorkspaceManifest;
}

function immediateMarkedChildren(root: string): WorkspaceSubGuild[] {
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const children: WorkspaceSubGuild[] = [];
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const childRoot = path.join(root, ent.name);
    const hasGit = fs.existsSync(path.join(childRoot, ".git"));
    const hasGuild = fs.existsSync(path.join(childRoot, ".guild"));
    if (!hasGit && !hasGuild) continue;
    children.push({
      name: ent.name,
      path: ent.name,
      kind: hasGuild ? "sub-guild" : "sub-project",
      has_wiki: fs.existsSync(path.join(childRoot, ".guild", "wiki")),
      has_indexes: fs.existsSync(path.join(childRoot, ".guild", "indexes")),
    });
  }
  return children;
}

function workspaceEntries(root: string): WorkspaceSubGuild[] {
  const manifest = readWorkspaceManifest(root);
  if (manifest?.is_workspace && Array.isArray(manifest.sub_guilds)) {
    return manifest.sub_guilds.filter((sg) => typeof sg.name === "string" && typeof sg.path === "string");
  }
  return immediateMarkedChildren(root);
}

function isRegisteredChildOfParentWorkspace(root: string): boolean {
  return findParentWorkspace(root) !== null;
}

function isWorkspaceRoot(root: string): boolean {
  const mode = readWorkspaceMode(root);
  if (mode === "on") return true;
  if (mode === "off") return false;
  const manifest = readWorkspaceManifest(root);
  if (manifest?.is_workspace === true) return true;
  if (isRegisteredChildOfParentWorkspace(root)) return false;
  return immediateMarkedChildren(root).length > 0;
}

function findParentWorkspace(activeRoot: string): { root: string; entry: WorkspaceSubGuild } | null {
  const parent = path.dirname(activeRoot);
  if (parent === activeRoot) return null;
  const activeResolved = path.resolve(activeRoot);
  for (const entry of workspaceEntries(parent)) {
    const childRoot = path.resolve(parent, entry.path);
    if (childRoot === activeResolved) return { root: parent, entry };
  }
  return null;
}

function canonicalMemory(activeRoot: string): GuildDiscovery["canonicalMemory"] {
  return {
    wiki: path.join(activeRoot, ".guild", "wiki"),
    raw: path.join(activeRoot, ".guild", "raw"),
    indexes: path.join(activeRoot, ".guild", "indexes"),
    indexSqlite: path.join(activeRoot, ".guild", "index.sqlite"),
  };
}

export function discoverGuild(startCwd: string): GuildDiscovery {
  const activeRoot = resolveRepoRootPreferGit(startCwd);
  const parentWorkspace = findParentWorkspace(activeRoot);
  const level: GuildLevel = isWorkspaceRoot(activeRoot) ? "workspace" : "project";
  return {
    startCwd: path.resolve(startCwd),
    activeRoot,
    guildDir: path.join(activeRoot, ".guild"),
    level,
    workspaceRoot: level === "workspace" ? activeRoot : parentWorkspace?.root ?? null,
    registeredName: parentWorkspace?.entry.name ?? null,
    federationDepth: level === "workspace" ? 0 : parentWorkspace ? 1 : 0,
    canonicalMemory: canonicalMemory(activeRoot),
  };
}

/**
 * Return read-through sources for immediate children only. It never opens or
 * copies child content; consumers decide which listed paths to read.
 */
export function workspaceReadThroughSources(workspaceRoot: string): ReadThroughSource[] {
  const manifest = readWorkspaceManifest(workspaceRoot);
  if (!manifest?.is_workspace && isRegisteredChildOfParentWorkspace(workspaceRoot)) return [];
  return workspaceEntries(workspaceRoot).map((entry) => {
    const childRoot = path.resolve(workspaceRoot, entry.path);
    const agentsPath = path.join(childRoot, "AGENTS.md");
    const guildDir = path.join(childRoot, ".guild");
    const wikiDir = path.join(guildDir, "wiki");
    const indexesDir = path.join(guildDir, "indexes");
    return {
      name: entry.name,
      childRoot,
      agentsPath: fs.existsSync(agentsPath) ? agentsPath : null,
      guildDir: fs.existsSync(guildDir) ? guildDir : null,
      wikiDir: fs.existsSync(wikiDir) ? wikiDir : null,
      indexesDir: fs.existsSync(indexesDir) ? indexesDir : null,
      sourceTag: `sub_guild:${entry.name}`,
    };
  });
}

export function isCanonicalGuildMemoryPath(absPath: string, guildRoot: string): boolean {
  const resolved = path.resolve(absPath);
  const memory = canonicalMemory(guildRoot);
  const canonicalDirs = [memory.wiki, memory.raw, memory.indexes].map((p) => path.resolve(p));
  if (resolved === path.resolve(memory.indexSqlite)) return true;
  return canonicalDirs.some((dir) => resolved === dir || resolved.startsWith(dir + path.sep));
}

export function classifyMemoryPath(absPath: string, guildRoot: string): "canonical" | "host-global" | "outside-guild" {
  if (isCanonicalGuildMemoryPath(absPath, guildRoot)) return "canonical";
  const base = path.basename(absPath);
  if (base === "MEMORY.md" || absPath.includes(`${path.sep}.codex${path.sep}`) || absPath.includes(`${path.sep}.claude${path.sep}`)) {
    return "host-global";
  }
  return "outside-guild";
}
