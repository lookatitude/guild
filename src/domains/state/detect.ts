#!/usr/bin/env -S npx tsx
/**
 * scripts/workspace/detect.ts
 *
 * Classifies a repo root as `regular` | `workspace`.
 *
 * Rule (D-OQ1 — depth fixed at 1, never recurse):
 *   workspace iff ≥1 IMMEDIATE child dir contains .git/ OR .guild/.
 *   Plain dirs (e.g. docs/) match neither → ignored.
 *
 * workspace.mode in .guild/settings.json:
 *   auto (default) — apply the rule
 *   on             — force workspace regardless of children
 *   off            — force regular regardless of children
 *
 * CLI --mode flag overrides settings.json.
 *
 * Usage:
 *   npx tsx scripts/workspace/detect.ts --cwd <root> [--mode auto|on|off]
 *
 * Stdout: JSON object with detection + sub_guilds[] (guild.workspace.v1 detection shape)
 * Stderr: diagnostics only.
 * Exit:
 *   0  Success.
 *   1  Bad input (--cwd missing or not a directory).
 *   2  Internal error.
 *
 * sub_guilds[] entry shape (per guild.workspace.v1):
 *   name            — child directory name
 *   path            — relative to root
 *   kind            — "sub-guild" (has .guild/) | "sub-project" (has .git, no .guild/)
 *   remote          — best-effort from <child>/.git/config; null if absent
 *   has_wiki        — <child>/.guild/wiki/ exists
 *   has_indexes     — <child>/.guild/indexes/ exists
 *   last_seen_commit — best-effort HEAD of the sub-repo; null if not a git repo or not determinable
 *
 * Invariant: read-only — never writes into any sub-guild's .guild/.
 */

import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import { durableGuildDir } from "./storage-roots";

// ── Types ────────────────────────────────────────────────────────────────────

export type WorkspaceMode = "auto" | "on" | "off";
export type RepoKind = "regular" | "workspace";
export type SubGuildKind = "sub-guild" | "sub-project";

export interface SubGuild {
  name: string;
  path: string;           // relative to root
  kind: SubGuildKind;
  remote: string | null;
  has_wiki: boolean;
  has_indexes: boolean;
  last_seen_commit: string | null;
}

export interface DetectionResult {
  kind: RepoKind;
  detection: {
    depth: 1;
    rule: string;
    mode: WorkspaceMode;
  };
  sub_guilds: SubGuild[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Reads workspace.mode for a repo root. The settings resolver lives in config,
 * which sits above state, so the caller injects it (config's
 * `resolveWorkspaceMode`), the same way upgrade-steps takes `ctx.policy`.
 */
export type WorkspaceModeReader = (root: string) => WorkspaceMode;

/** Best-effort: parse remote URL from <childPath>/.git/config */
function readRemote(childPath: string): string | null {
  const gitConfig = path.join(childPath, ".git", "config");
  if (!fs.existsSync(gitConfig)) return null;
  try {
    const content = fs.readFileSync(gitConfig, "utf8");
    const match = content.match(/url\s*=\s*(.+)/);
    if (!match) return null;
    const url = match[1].trim();
    // Normalize to host/path form, stripping git@ / https:// / .git suffix
    return url
      .replace(/^git@/, "")
      .replace(/^https?:\/\//, "")
      .replace(/\.git$/, "")
      .replace(/:/, "/");
  } catch {
    return null;
  }
}

/** Best-effort: read HEAD commit of the child repo. */
function readHead(childPath: string): string | null {
  try {
    const result = execSync("git rev-parse HEAD", {
      cwd: childPath,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 3000,
    }).trim();
    return result.length > 0 ? result : null;
  } catch {
    return null;
  }
}

/** Classify a single immediate child directory. Returns null if it should be ignored. */
function classifyChild(root: string, name: string): SubGuild | null {
  const childPath = path.join(root, name);
  // Must be a directory (not a file or symlink-to-non-dir)
  let stat: fs.Stats;
  try {
    stat = fs.statSync(childPath);
  } catch {
    return null;
  }
  if (!stat.isDirectory()) return null;

  const hasGit = fs.existsSync(path.join(childPath, ".git"));
  const hasGuild = fs.existsSync(durableGuildDir(childPath));

  // Neither → plain dir → ignore
  if (!hasGit && !hasGuild) return null;

  const kind: SubGuildKind = hasGuild ? "sub-guild" : "sub-project";
  const has_wiki = fs.existsSync(path.join(durableGuildDir(childPath), "wiki"));
  const has_indexes = fs.existsSync(path.join(durableGuildDir(childPath), "indexes"));
  const remote = hasGit ? readRemote(childPath) : null;
  const last_seen_commit = hasGit ? readHead(childPath) : null;

  return {
    name,
    path: name, // relative to root (depth-1 means path === name)
    kind,
    remote,
    has_wiki,
    has_indexes,
    last_seen_commit,
  };
}

// ── Core detection ────────────────────────────────────────────────────────────

export function detect(
  root: string,
  modeOverride: WorkspaceMode | undefined,
  readMode: WorkspaceModeReader,
): DetectionResult {
  const mode: WorkspaceMode = modeOverride ?? readMode(root);

  const RULE = "immediate child has .git/ OR .guild/";

  // Collect sub_guilds via depth-1 scan (always collected for the output shape,
  // but only influences kind when mode=auto)
  let subGuilds: SubGuild[] = [];
  try {
    const entries = fs.readdirSync(root);
    for (const name of entries) {
      const sg = classifyChild(root, name);
      if (sg !== null) subGuilds.push(sg);
    }
  } catch {
    // unreadable root → empty, handled by caller
  }

  // Determine kind
  let kind: RepoKind;
  if (mode === "on") {
    kind = "workspace";
  } else if (mode === "off") {
    kind = "regular";
    subGuilds = []; // force-regular: suppress sub_guilds
  } else {
    // auto: apply the rule
    kind = subGuilds.length > 0 ? "workspace" : "regular";
  }

  return {
    kind,
    detection: { depth: 1, rule: RULE, mode },
    sub_guilds: subGuilds,
  };
}

// ── CLI entry point ───────────────────────────────────────────────────────────

function parseArgs(argv: string[]): { cwd?: string; mode?: WorkspaceMode } {
  let cwd: string | undefined;
  let mode: WorkspaceMode | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--cwd" && argv[i + 1]) {
      cwd = argv[++i];
    } else if (arg === "--mode" && argv[i + 1]) {
      const v = argv[++i];
      if (v === "auto" || v === "on" || v === "off") mode = v;
    }
  }
  return { cwd, mode };
}

export function runWorkspaceDetectCli(readMode: WorkspaceModeReader, argv: string[] = process.argv.slice(2)): void {
  const { cwd: cwdArg, mode } = parseArgs(argv);
  const cwd = cwdArg ?? process.env["GUILD_CWD"] ?? process.cwd();

  if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) {
    process.stderr.write(`[workspace/detect] ERROR: --cwd "${cwd}" is not a directory\n`);
    process.exit(1);
  }

  try {
    const result = detect(cwd, mode, readMode);
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } catch (e) {
    process.stderr.write(`[workspace/detect] ERROR: ${(e as Error).message}\n`);
    process.exit(2);
  }
}

// esbuild inlines this module into other bundles, where `require.main === module`
// is true for EVERY inlined module — gate on the exact argv basename so only a direct
// `detect` invocation runs the CLI, never a bundle that merely imports this file.
if (
  typeof module !== "undefined" &&
  require.main === module &&
  /^detect\.[cm]?[jt]s$/.test((process.argv[1] ?? "").split(/[\\/]/).pop() ?? "")
) {
  runWorkspaceDetectCli();
}
