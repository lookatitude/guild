/**
 * scripts/lib/guild-artifact-paths.ts
 *
 * R6 write-location helper for project-created Guild artifacts. Runtime writes
 * go under the consuming repo's active `.guild/`, never the plugin install dir
 * or host-global memory.
 */

import * as path from "node:path";
import { discoverGuild } from "./guild-discovery";

export type GuildArtifactKind = "wiki-ingest" | "decision" | "agent" | "skill" | "tool";

export interface ArtifactPathRequest {
  cwd: string;
  kind: GuildArtifactKind;
  slug: string;
  category?: string;
  pluginInstallRoot?: string;
}

function safeSlug(raw: string): string {
  const slug = raw.trim().replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!slug) throw new Error("artifact slug is required");
  if (slug.includes("..") || slug.includes("/") || slug.includes("\\")) {
    throw new Error(`unsafe artifact slug: ${raw}`);
  }
  return slug;
}

/**
 * R6 boundary check, exported standalone (no `cwd`/`discoverGuild` needed): throws
 * iff `absPath` resolves under a plugin install root (an explicit
 * `pluginInstallRoot`, else `GUILD_PLUGIN_ROOT`/`CLAUDE_PLUGIN_ROOT`/`CODEX_PLUGIN_ROOT`).
 * This is the one check every write path can call cheaply — no discovery, no cwd
 * threading — which is why `atomicWrite` (src/modules/state/workflows/atomic-write.ts)
 * calls it on every write: R6 stops being prose-only the moment the shared write
 * choke-point enforces it.
 */
import { assertNotUnderPluginInstall } from "../../src/modules/state/workflows/plugin-install-guard";
export { assertNotUnderPluginInstall };

export function resolveGuildArtifactPath(req: ArtifactPathRequest): string {
  const discovery = discoverGuild(req.cwd);
  const slug = safeSlug(req.slug);
  let rel: string;
  switch (req.kind) {
    case "wiki-ingest": {
      const category = safeSlug(req.category ?? "concepts");
      rel = path.join("wiki", category, `${slug}.md`);
      break;
    }
    case "decision":
      rel = path.join("wiki", "decisions", `${slug}.md`);
      break;
    case "agent":
      rel = path.join("agents", `${slug}.md`);
      break;
    case "skill":
      rel = path.join("skills", slug, "SKILL.md");
      break;
    case "tool":
      rel = path.join("tools", `${slug}.json`);
      break;
  }
  const abs = path.join(discovery.guildDir, rel);
  assertNotUnderPluginInstall(abs, req.pluginInstallRoot);
  return abs;
}

export function assertProjectCreatedArtifactPath(absPath: string, cwd: string, pluginInstallRoot?: string): void {
  const discovery = discoverGuild(cwd);
  const guildRel = path.relative(discovery.guildDir, path.resolve(absPath));
  if (guildRel === "" || guildRel.startsWith("..") || path.isAbsolute(guildRel)) {
    throw new Error(`project-created Guild artifact must be under active .guild/: ${absPath}`);
  }
  assertNotUnderPluginInstall(absPath, pluginInstallRoot);
}
