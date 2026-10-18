#!/usr/bin/env -S npx tsx
/**
 * learn/learn-route.ts — CLI for the deterministic `/guild:learn` router.
 *
 * Usage: node runtime/scripts/learn-route.js --cwd <root> [-- <learn tokens...>]
 *
 * Reads the root facts (workspace-detect, .git/, .guild/, wiki, tracked-file
 * count) only when the tokens are bare, then prints the knowledge domain's
 * `routeLearn` result (guild.learn_route.v1) as JSON. A `--cwd` inside the
 * learn tokens overrides the root, resolved against the outer `--cwd`.
 *
 * Exit: 0 a route was printed (including `usage`); 1 bad input; 2 internal error.
 */

import * as fs from "fs";
import * as path from "path";
import { execFileSync } from "child_process";

import { parseLearnArgs, routeLearn, SPARSE_TRACKED_FILE_LIMIT, type LearnTargetFacts } from "../../src/domains/knowledge";
import { detect, durableGuildDir } from "../../src/domains/state";
import { resolveWorkspaceMode } from "../../src/domains/config";
import { readWorkspaceKnowledgeConfig } from "../../src/domains/lifecycle";

/** Count files outside .git/ and .guild/, stopping once past `limit`. */
function countFilesUpTo(root: string, limit: number): number {
  const skip = new Set([".git", path.basename(durableGuildDir(root))]);
  let n = 0;
  const stack = [root];
  while (stack.length > 0 && n <= limit) {
    const dir = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (dir === root && skip.has(e.name)) continue;
        stack.push(path.join(dir, e.name));
      } else if (e.isFile() && ++n > limit) {
        break;
      }
    }
  }
  return n;
}

function trackedFiles(root: string, hasGit: boolean): number {
  if (hasGit) {
    try {
      const out = execFileSync("git", ["-C", root, "ls-files", "-z"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        maxBuffer: 256 * 1024 * 1024,
      });
      return out.split("\0").filter((p) => p !== "").length;
    } catch {
      // not a usable work tree: fall back to the filesystem count
    }
  }
  return countFilesUpTo(root, SPARSE_TRACKED_FILE_LIMIT);
}

function hasMarkdown(dir: string): boolean {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isFile() && e.name.endsWith(".md")) return true;
    if (e.isDirectory() && hasMarkdown(p)) return true;
  }
  return false;
}

export function readLearnTargetFacts(root: string): LearnTargetFacts {
  const d = detect(root, undefined, resolveWorkspaceMode);
  const guildDir = durableGuildDir(root);
  let guild: LearnTargetFacts["guild_dir"] = "absent";
  if (fs.existsSync(guildDir)) guild = fs.readdirSync(guildDir).length === 0 ? "empty" : "populated";
  const hasGit = fs.existsSync(path.join(root, ".git"));
  return {
    detection: { kind: d.kind, sub_guilds: d.sub_guilds },
    has_git: hasGit,
    guild_dir: guild,
    wiki_populated: guild === "populated" && hasMarkdown(path.join(guildDir, "wiki")),
    tracked_files: trackedFiles(root, hasGit),
  };
}

export function runLearnRouteCli(argv: string[] = process.argv.slice(2)): number {
  const sep = argv.indexOf("--");
  const own = sep === -1 ? argv : argv.slice(0, sep);
  const tokens = sep === -1 ? [] : argv.slice(sep + 1);
  const cwdIdx = own.indexOf("--cwd");
  if (cwdIdx !== -1 && !own[cwdIdx + 1]) {
    process.stderr.write("[learn-route] ERROR: --cwd needs a path value\n");
    return 1;
  }
  const base = cwdIdx !== -1 ? own[cwdIdx + 1] : process.cwd();

  let parsed: ReturnType<typeof parseLearnArgs>;
  try {
    parsed = parseLearnArgs(tokens);
  } catch (e) {
    process.stderr.write(`[learn-route] ERROR: ${(e as Error).message}\n`);
    return 1;
  }
  const root = path.resolve(base, parsed.cwd_override ?? ".");
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    process.stderr.write(`[learn-route] ERROR: root "${root}" is not a directory\n`);
    return 1;
  }
  try {
    const bare = parsed.positional === -1;
    const result = routeLearn({
      argv: tokens,
      target: bare ? readLearnTargetFacts(root) : null,
      learnFanout: bare ? readWorkspaceKnowledgeConfig(root).learn_fanout : undefined,
    });
    process.stdout.write(JSON.stringify({ ...result, root }, null, 2) + "\n");
    return 0;
  } catch (e) {
    process.stderr.write(`[learn-route] ERROR: ${(e as Error).message}\n`);
    return 2;
  }
}

if (require.main === module) {
  process.exit(runLearnRouteCli());
}
