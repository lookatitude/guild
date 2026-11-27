/**
 * learn/lib/walk.ts — deterministic, ignore-aware file discovery.
 */

import * as fs from "fs";
import * as path from "path";
import { createIgnoreFilter, type IgnoreFilter } from "./ignore";
import { durableGuildDir } from "../../lib/state/ensure-storage-layout";

export interface WalkResult {
  files: string[]; // repo-relative, POSIX-separated, sorted
  filter: IgnoreFilter;
  /** True when a file was left out because `maxFiles` was reached. */
  truncated: boolean;
  /** Repo-relative directories whose listing failed ("" = root): their files are missing. */
  unreadable: string[];
  /** Entries whose name cannot be spelled as a repo path (a literal "\\" on POSIX, non-UTF-8 bytes). */
  unsupported: string[];
}

/**
 * Depth-1 paths of the sub_guilds workspace-detect registered in the root's
 * .guild/workspace.json (#273). Each one owns its own index, so the root walk
 * skips it. No manifest, is_workspace:false, or no sub_guilds yields none.
 */
export function registeredSubGuildPaths(repoRoot: string): Set<string> {
  const out = new Set<string>();
  let manifest: { is_workspace?: unknown; sub_guilds?: unknown } | null;
  try {
    manifest = JSON.parse(fs.readFileSync(path.join(durableGuildDir(repoRoot), "workspace.json"), "utf8"));
  } catch {
    return out;
  }
  if (manifest === null || typeof manifest !== "object" || manifest.is_workspace !== true || !Array.isArray(manifest.sub_guilds)) return out;
  for (const sg of manifest.sub_guilds) {
    const p = (sg as { path?: unknown } | null)?.path;
    // Depth-1 names only (D-OQ1); anything else is not a registered sub_guild.
    if (typeof p === "string" && p !== "" && p !== "." && p !== ".." && !/[\\/]/.test(p)) out.add(p);
  }
  return out;
}

/** Recursively list non-ignored files under repoRoot (sorted, deterministic). */
export function walkRepo(repoRoot: string, maxFiles = 20000): WalkResult {
  const filter = createIgnoreFilter(repoRoot);
  const subGuilds = registeredSubGuildPaths(repoRoot);
  const out: string[] = [];
  let truncated = false;
  const unreadable: string[] = [];
  const unsupported: string[] = [];

  const visit = (absDir: string) => {
    if (truncated) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(absDir, { withFileTypes: true });
    } catch {
      unreadable.push(path.relative(repoRoot, absDir).replace(/\\/g, "/"));
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      const abs = path.join(absDir, e.name);
      // On POSIX "\\" is a filename byte; mapping it to "/" would name another path.
      // U+FFFD: the name was not valid UTF-8 and cannot be addressed by this string.
      if ((path.sep === "/" && e.name.includes("\\")) || e.name.includes("\uFFFD")) {
        unsupported.push(path.relative(repoRoot, abs));
        continue;
      }
      const rel = path.relative(repoRoot, abs).replace(/\\/g, "/");
      if (e.isDirectory()) {
        if (subGuilds.has(rel)) continue;
        if (filter.isIgnored(rel) || filter.isIgnored(rel + "/")) continue;
        visit(abs);
      } else if (e.isFile()) {
        if (filter.isIgnored(rel)) continue;
        if (out.length >= maxFiles) {
          truncated = true;
          return;
        }
        out.push(rel);
      }
    }
  };
  visit(repoRoot);
  out.sort();
  return { files: out, filter, truncated, unreadable: unreadable.sort(), unsupported: unsupported.sort() };
}
