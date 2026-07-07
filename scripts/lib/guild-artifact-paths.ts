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

function assertNotUnderPluginInstall(absPath: string, pluginInstallRoot: string | undefined): void {
  const root = pluginInstallRoot
    ?? process.env["GUILD_PLUGIN_ROOT"]
    ?? process.env["CLAUDE_PLUGIN_ROOT"]
    ?? process.env["CODEX_PLUGIN_ROOT"];
  if (!root) return;
  const rel = path.relative(path.resolve(root), path.resolve(absPath));
  if (rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))) {
    throw new Error(`project-created Guild artifact would be written under plugin install dir: ${absPath}`);
  }
}

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
