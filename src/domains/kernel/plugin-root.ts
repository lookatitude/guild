/**
 * The plugin root for code that runs from either shape: the TypeScript source
 * tree (`scripts/`, `src/domains/<id>/`) or a compiled bundle
 * (`runtime/scripts/<id>.js`, `hooks/dist/`). A fixed `path.resolve(__dirname,
 * "..")` is right for one shape and wrong for the other, so the root is found by
 * its marker: the directory holding `runtime/guild-mcp.js` (KTD3/KTD7). Every
 * host package ships that file; only the Claude package ships
 * `.claude-plugin/plugin.json`, so that is not a usable marker.
 */

import * as fs from "node:fs";
import * as path from "node:path";

export const PLUGIN_ROOT_MARKER = path.join("runtime", "guild-mcp.js");

/** Walk up from `fromDir` to the nearest directory holding the marker; null when none. */
export function findPluginRoot(fromDir: string): string | null {
  let dir = path.resolve(fromDir);
  for (;;) {
    if (fs.existsSync(path.join(dir, PLUGIN_ROOT_MARKER))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * The plugin root a CLI should use: `GUILD_PLUGIN_ROOT`, then Claude's
 * `CLAUDE_PLUGIN_ROOT`, then the marker walk from `fromDir` (pass `__dirname`).
 * Throws when nothing resolves, so a caller never reads templates from a guessed
 * directory.
 */
export function resolvePluginRoot(fromDir: string, env: NodeJS.ProcessEnv = process.env): string {
  for (const key of ["GUILD_PLUGIN_ROOT", "CLAUDE_PLUGIN_ROOT"]) {
    const value = env[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  const found = findPluginRoot(fromDir);
  if (found === null) {
    throw new Error(`Guild plugin root not found above ${fromDir} (no ${PLUGIN_ROOT_MARKER}); set GUILD_PLUGIN_ROOT`);
  }
  return found;
}

/** The root of the package this code shipped in: the marker walk only, env ignored. */
export function ownPluginRoot(fromDir: string): string {
  const found = findPluginRoot(fromDir);
  if (found === null) throw new Error(`Guild plugin root not found above ${fromDir} (no ${PLUGIN_ROOT_MARKER})`);
  return found;
}

/** True when `dir` is a Guild plugin root: it ships the runtime marker or the Claude manifest. */
export function isPluginRoot(dir: string): boolean {
  return (
    fs.existsSync(path.join(dir, PLUGIN_ROOT_MARKER)) ||
    fs.existsSync(path.join(dir, ".claude-plugin", "plugin.json"))
  );
}

/**
 * Like `resolvePluginRoot`, but an env value is only accepted when it really is a
 * plugin root (a host or a stale shell can export the wrong ancestor), and it never
 * throws: an invalid env value falls through to the marker walk from `fromDir`
 * (pass `__dirname`), and null means no plugin root is known.
 */
export function resolveValidatedPluginRoot(
  fromDir: string,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  for (const key of ["GUILD_PLUGIN_ROOT", "CLAUDE_PLUGIN_ROOT"]) {
    const value = env[key];
    if (typeof value === "string" && value.length > 0 && isPluginRoot(value)) return path.resolve(value);
  }
  return findPluginRoot(fromDir);
}

/**
 * True when `absPath` lies inside a Guild-managed root: under `pluginRoot`, or under
 * a directory that holds a `.guild/` directory. Anything else (scratch dirs, home
 * config, unrelated repos) is outside Guild's scope.
 */
export function isUnderGuildManagedRoot(absPath: string, pluginRoot: string | null): boolean {
  const target = path.resolve(absPath);
  if (pluginRoot !== null) {
    const rel = path.relative(path.resolve(pluginRoot), target);
    if (rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))) return true;
  }
  let dir = path.dirname(target);
  for (;;) {
    try {
      if (fs.statSync(path.join(dir, ".guild")).isDirectory()) return true;
    } catch {
      // not present at this level
    }
    const parent = path.dirname(dir);
    if (parent === dir) return false;
    dir = parent;
  }
}
