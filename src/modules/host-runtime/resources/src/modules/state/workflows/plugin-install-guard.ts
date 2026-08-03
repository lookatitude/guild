/**
 * src/modules/state/workflows/plugin-install-guard.ts
 *
 * R6 boundary check with a DELIBERATELY tiny import surface (fs + path only).
 * atomicWrite calls this on every write; keeping it dependency-free keeps every
 * writer CLI's compile graph small (the previous home, guild-artifact-paths,
 * drags in guild-discovery — measurable tsx cold-start cost per spawned CLI).
 *
 * Semantics: throws iff `absPath` resolves under a plugin install root (explicit
 * `pluginInstallRoot`, else GUILD_PLUGIN_ROOT / CLAUDE_PLUGIN_ROOT /
 * CODEX_PLUGIN_ROOT). SELF-BUILD exemption: a SOURCE CHECKOUT (root has .git)
 * writing its own `.guild/` is the legitimate project-state path — R6 forbids
 * writes into an INSTALLED plugin dir, which never carries .git.
 */

import * as fs from "node:fs";
import * as path from "node:path";

export function assertNotUnderPluginInstall(absPath: string, pluginInstallRoot: string | undefined): void {
  const root = pluginInstallRoot
    ?? process.env["GUILD_PLUGIN_ROOT"]
    ?? process.env["CLAUDE_PLUGIN_ROOT"]
    ?? process.env["CODEX_PLUGIN_ROOT"];
  if (!root) return;
  const resolvedRoot = path.resolve(root);
  const rel = path.relative(resolvedRoot, path.resolve(absPath));
  if (rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))) {
    const underOwnDotGuild = rel === ".guild" || rel.startsWith(`.guild${path.sep}`);
    if (underOwnDotGuild && fs.existsSync(path.join(resolvedRoot, ".git"))) return;
    throw new Error(`project-created Guild artifact would be written under plugin install dir: ${absPath}`);
  }
}
