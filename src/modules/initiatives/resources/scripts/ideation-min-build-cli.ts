#!/usr/bin/env -S npx tsx
/**
 * scripts/ideation-min-build-cli.ts
 *
 * The deterministic, skill-invocable surface for ideation knowledge-binding
 * (docs/v2 03-lifecycle §"A min-build spec"). `guild:brainstorm` runs this at the
 * top of the Ideation flow: it observes the init state on disk (the I/O the pure
 * `ideation-min-build.ts` library deliberately omits), and when no init wiki is
 * present it returns a resolver-built minimal baseline stamped
 * `grounded_in: init_minimal` plus the gap notice the skill must surface — instead
 * of the old behavior where the resolver only surfaced the missing init and asked.
 *
 * Usage (run from the consuming repo root):
 *   ideation-min-build-cli [--cwd <root>] [--name <n>] [--description <d>] [--language <l>] [--now <iso>]
 *
 * Output is JSON on stdout:
 *   { "needsMinBuild": false }                              # init wiki present — normal path
 *   { "needsMinBuild": true, "spec": <MinBuildSpec>, "frontmatter": {...} }  # resolver baseline
 *
 * Exit 0 always (the absence of an init wiki is a normal, expected branch).
 */

import * as fs from "fs";
import * as path from "path";

import {
  needsMinBuild,
  resolveMinBuildSpec,
  validateMinBuildSpec,
  type InitState,
  type ProjectFacts,
} from "./lib/ideation-min-build";

function parseArgs(argv: string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const key = argv[i].slice(2);
      const val = i + 1 < argv.length && !argv[i + 1].startsWith("--") ? argv[++i] : "true";
      flags[key] = val;
    }
  }
  return flags;
}

/** Observe init state on disk — the canonical baseline is `.guild/wiki/index.md`. */
function observeInitState(cwd: string): InitState {
  const wikiIndex = path.join(cwd, ".guild", "wiki", "index.md");
  const guildYaml = path.join(cwd, ".guild", "guild.yaml");
  return {
    hasInitWiki: fs.existsSync(wikiIndex),
    hasGuildYaml: fs.existsSync(guildYaml),
  };
}

function main(): void {
  const flags = parseArgs(process.argv.slice(2));
  const cwd = flags.cwd ?? process.cwd();
  const initState = observeInitState(cwd);

  if (!needsMinBuild(initState)) {
    process.stdout.write(JSON.stringify({ needsMinBuild: false }) + "\n");
    return;
  }

  const facts: ProjectFacts = {
    name: flags.name ?? path.basename(path.resolve(cwd)),
    ...(flags.description ? { description: flags.description } : {}),
    ...(flags.language ? { primaryLanguage: flags.language } : {}),
  };
  // `--now` lets the caller stamp a deterministic timestamp; default to wall-clock
  // (the CLI is the I/O boundary, so a real timestamp here is correct).
  const resolvedAt = flags.now ?? new Date().toISOString();
  const spec = resolveMinBuildSpec({ hasInitWiki: false, projectFacts: facts }, resolvedAt);

  const validation = validateMinBuildSpec(spec);
  if (!validation.valid) {
    process.stderr.write(
      `ideation-min-build-cli: resolver produced an invalid baseline: ${validation.errors.join("; ")}\n`,
    );
    process.exit(1);
  }

  // The frontmatter block the brainstorm skill stamps onto .guild/spec/<slug>.md so
  // the grounded_in discriminator + gap are machine-recorded, not just prose.
  const frontmatter = {
    grounded_in: spec.grounded_in,
    resolver_built: true,
    gap: spec.gap,
    resolved_at: spec.resolvedAt ?? resolvedAt,
  };

  process.stdout.write(JSON.stringify({ needsMinBuild: true, spec, frontmatter }) + "\n");
}

main();
