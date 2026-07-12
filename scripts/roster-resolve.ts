/**
 * scripts/roster-resolve.ts
 *
 * CLI over lib/roster.ts — the code-backed D4 roster enumeration.
 *
 *   npx tsx roster-resolve.ts --cwd <projectRoot> [--plugin-root <dir>]
 *                             [--write-registry] [--check] [--force] [--quiet]
 *
 * Default: print the guild.roster.v1 resolution as JSON on stdout
 * (guild:team-compose consumes this instead of hand-globbing directories).
 *
 * --write-registry  additionally derive .guild/agents/registry.yaml and
 *                   .guild/skills/registry.yaml as generated projections of
 *                   the *.md trees (never clobbers hand-authored registries
 *                   without --force).
 * --check           exit 1 if the derived registries are stale relative to
 *                   the *.md trees (writes nothing).
 *
 * Plugin root resolution: --plugin-root > GUILD_PLUGIN_ROOT > CLAUDE_PLUGIN_ROOT
 * > the parent of this script's directory (the plugin repo itself).
 */

import * as path from "path";
import {
  deriveAgentsRegistry,
  deriveSkillsRegistry,
  resolveRoster,
} from "./lib/roster";

function main(): void {
  const argv = process.argv.slice(2);
  let cwd = ".";
  let pluginRoot: string | null = null;
  let writeRegistry = false;
  let check = false;
  let force = false;
  let quiet = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--cwd" && i + 1 < argv.length) cwd = argv[++i];
    else if (a === "--plugin-root" && i + 1 < argv.length) pluginRoot = argv[++i];
    else if (a === "--write-registry") writeRegistry = true;
    else if (a === "--check") check = true;
    else if (a === "--force") force = true;
    else if (a === "--quiet") quiet = true;
    else {
      process.stderr.write(`[roster-resolve] unknown argument: ${a}\n`);
      process.exit(1);
    }
  }

  const resolvedPluginRoot =
    pluginRoot ??
    process.env["GUILD_PLUGIN_ROOT"] ??
    process.env["CLAUDE_PLUGIN_ROOT"] ??
    path.resolve(__dirname, "..");

  const resolution = resolveRoster({
    projectRoot: path.resolve(cwd),
    pluginRoot: resolvedPluginRoot,
  });

  for (const w of resolution.warnings) {
    process.stderr.write(`[roster-resolve] WARN: ${w}\n`);
  }

  if (check) {
    const results = [
      deriveAgentsRegistry(resolution, { dryRun: true }),
      deriveSkillsRegistry(resolution, { dryRun: true }),
    ];
    const stale = results.filter((r) => r.action !== "unchanged");
    for (const r of stale) {
      process.stderr.write(
        `[roster-resolve] STALE: ${r.path} (${r.action}${r.reason ? `: ${r.reason}` : ""})\n`
      );
    }
    process.exit(stale.length === 0 ? 0 : 1);
  }

  if (writeRegistry) {
    const results = [
      deriveAgentsRegistry(resolution, { force }),
      deriveSkillsRegistry(resolution, { force }),
    ];
    let refused = false;
    for (const r of results) {
      if (r.action === "refused") refused = true;
      process.stderr.write(
        `[roster-resolve] ${r.action}: ${r.path}${r.reason ? ` — ${r.reason}` : ""}\n`
      );
    }
    if (refused) process.exit(2);
  }

  if (!quiet) {
    process.stdout.write(`${JSON.stringify(resolution, null, 2)}\n`);
  }
}

main();
