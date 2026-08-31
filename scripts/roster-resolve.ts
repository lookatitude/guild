/**
 * scripts/roster-resolve.ts
 *
 * CLI over lib/roster.ts — the code-backed D4 roster enumeration.
 *
 *   npx tsx roster-resolve.ts --cwd <projectRoot> [--plugin-root <dir>]
 *                             [--write-registry] [--check] [--force] [--quiet]
 *   npx tsx roster-resolve.ts mint <name> [--host-native] --cwd <projectRoot> [--plugin-root <dir>]
 *   npx tsx roster-resolve.ts migrate-team-roster --cwd <projectRoot> [--plugin-root <dir>] [--dry-run]
 *   npx tsx roster-resolve.ts --check-workspace-scopes --cwd <workspaceRoot>
 *
 * Default: print the guild.roster.v1 resolution as JSON on stdout
 * (guild:team-compose consumes this instead of hand-globbing directories).
 * The resolution includes `templates` — the shipped specialist TYPE templates
 * under <pluginRoot>/templates/specialists/*.md (mint candidates, not
 * dispatchable roster entries).
 *
 * mint <name>       instantiate templates/specialists/<name>.md into
 *                   <projectRoot>/.guild/agents/<name>.md (the deterministic
 *                   team-compose fast-mint; refuses if the instance exists —
 *                   reuse, never re-create) and refresh the derived agents
 *                   registry. Exit 0 written, 3 already-exists, 2 refused.
 *   --host-native   OPT-IN: additionally project the instance into the
 *                   project's .claude/agents/<name>.md (marker-stamped copy;
 *                   never clobbers a hand-authored file) so a Claude host can
 *                   auto-route to it natively. Applies on mint exit 0 AND 3.
 * migrate-team-roster
 *                   one-shot v2.1→v2.2 fixer: rewrite team-file entries whose
 *                   `definition_source: shipped` names a DOMAIN role (the host
 *                   no longer registers those agents) — mints the instance
 *                   (idempotent) and re-points the entry at
 *                   .guild/agents/<role>.md. Machinery agents stay shipped.
 *                   Exit 0 clean (incl. nothing to do), 2 if any file refused.
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
  checkWorkspaceRosterScopes,
  deriveAgentsRegistry,
  deriveSkillsRegistry,
  migrateTeamRoster,
  mintFromTemplate,
  projectInstanceToHostNative,
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
  let mintName: string | null = null;
  let hostNative = false;
  let migrateTeams = false;
  let dryRun = false;
  let checkWorkspaceScopes = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "mint" && mintName === null && i + 1 < argv.length && !argv[i + 1].startsWith("--")) {
      mintName = argv[++i];
    } else if (a === "migrate-team-roster") migrateTeams = true;
    else if (a === "--check-workspace-scopes") checkWorkspaceScopes = true;
    else if (a === "--host-native") hostNative = true;
    else if (a === "--dry-run") dryRun = true;
    else if (a === "--cwd" && i + 1 < argv.length) cwd = argv[++i];
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

  if (checkWorkspaceScopes) {
    if (mintName !== null || migrateTeams || writeRegistry || check || force || hostNative || dryRun) {
      process.stderr.write("[roster-resolve] --check-workspace-scopes cannot be combined with mutation modes\n");
      process.exit(1);
    }
    const result = checkWorkspaceRosterScopes(path.resolve(cwd));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exit(result.pass ? 0 : 2);
  }

  if (migrateTeams) {
    const results = migrateTeamRoster({
      pluginRoot: resolvedPluginRoot,
      projectRoot: path.resolve(cwd),
      dryRun,
    });
    // Any file-level refusal OR any per-role mint failure fails the command —
    // a lane left broken must never look like success.
    let refused = false;
    for (const r of results) {
      if (r.action === "refused" || r.failed.length > 0) refused = true;
      process.stderr.write(
        `[roster-resolve] migrate-team-roster ${r.action}${dryRun ? " (dry-run)" : ""}: ${r.path}` +
          `${r.migrated.length ? ` — migrated: ${r.migrated.join(", ")}` : ""}` +
          `${r.minted.length ? `; minted: ${r.minted.join(", ")}` : ""}` +
          `${r.reason ? ` — ${r.reason}` : ""}\n`
      );
    }
    if (results.length === 0) {
      process.stderr.write("[roster-resolve] migrate-team-roster: no team files found — nothing to do\n");
    }
    if (!dryRun && results.some((r) => r.minted.length > 0)) {
      const resolution = resolveRoster({
        projectRoot: path.resolve(cwd),
        pluginRoot: resolvedPluginRoot,
      });
      const r = deriveAgentsRegistry(resolution, { force });
      process.stderr.write(`[roster-resolve] ${r.action}: ${r.path}${r.reason ? ` — ${r.reason}` : ""}\n`);
      // A stale registry after a real migration is a failure too.
      if (r.action === "refused") refused = true;
    }
    process.exit(refused ? 2 : 0);
  }

  if (mintName !== null) {
    const result = mintFromTemplate({
      pluginRoot: resolvedPluginRoot,
      projectRoot: path.resolve(cwd),
      name: mintName,
    });
    process.stderr.write(
      `[roster-resolve] mint ${mintName}: ${result.action}${result.reason ? ` — ${result.reason}` : ""} (${result.path})\n`
    );
    if (result.action === "refused") process.exit(2);
    // written OR exists: optionally project into .claude/agents (opt-in).
    if (hostNative) {
      const proj = projectInstanceToHostNative({ projectRoot: path.resolve(cwd), name: mintName });
      process.stderr.write(
        `[roster-resolve] host-native ${mintName}: ${proj.action}${proj.reason ? ` — ${proj.reason}` : ""} (${proj.path})\n`
      );
      if (proj.action === "refused") process.exit(2);
    }
    if (result.action === "written") {
      // Keep the derived registry projection in step with the new instance.
      const resolution = resolveRoster({
        projectRoot: path.resolve(cwd),
        pluginRoot: resolvedPluginRoot,
      });
      const r = deriveAgentsRegistry(resolution, { force });
      process.stderr.write(`[roster-resolve] ${r.action}: ${r.path}${r.reason ? ` — ${r.reason}` : ""}\n`);
      process.stdout.write(`${result.path}\n`);
      process.exit(0);
    }
    process.exit(3);
  }

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
