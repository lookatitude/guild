/**
 * understand/lib/paths.ts
 *
 * Repo-root resolution with worktree-redirect safety.
 *
 * Per codebase-understanding.md §"Refresh/staleness":
 *   "Worktree-redirect safety: always write to the main repo root, never an
 *    ephemeral worktree."
 *
 * The 4 frozen artifacts live under .guild/ ONLY — never the external
 * plugin's dotfolder (which would re-introduce a runtime dependency).
 */

import * as fs from "fs";
import * as path from "path";
import { execFileSync } from "child_process";

export const SCHEMA = {
  codebaseMap: "guild.codebase_map.v1",
  knowledgeGraph: "guild.knowledge_graph.v1",
  diffUnderstanding: "guild.diff_understanding.v1",
  knowledgeLinks: "guild.knowledge_links.v1",
} as const;

/** Parse a leading/anywhere `--cwd <path>` flag, else $GUILD_CWD, else process.cwd(). */
export function parseCwd(argv: string[]): string {
  const idx = argv.indexOf("--cwd");
  if (idx !== -1 && argv[idx + 1]) return argv[idx + 1];
  return process.env["GUILD_CWD"] ?? process.cwd();
}

export function parseFlag(argv: string[], name: string): string | undefined {
  const eq = `--${name}=`;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === `--${name}` && argv[i + 1]) return argv[i + 1];
    if (argv[i].startsWith(eq)) return argv[i].slice(eq.length);
  }
  return undefined;
}

export function hasFlag(argv: string[], name: string): boolean {
  return argv.includes(`--${name}`);
}

/**
 * Resolve the canonical MAIN repo root for a given cwd.
 *
 * If cwd is inside a git worktree, `git rev-parse --git-common-dir` points at
 * the main repo's .git; its parent is the main worktree. We always anchor
 * .guild/ writes there so a brownfield scan run from an ephemeral worktree
 * never strands artifacts that vanish on worktree cleanup.
 */
export function resolveMainRepoRoot(cwd: string): string {
  try {
    const commonDir = execFileSync("git", ["rev-parse", "--git-common-dir"], {
      cwd,
      encoding: "utf-8",
    }).trim();
    const abs = path.isAbsolute(commonDir) ? commonDir : path.resolve(cwd, commonDir);
    // commonDir is ".../<main>/.git" → main repo root is its parent.
    const root = path.dirname(abs);
    if (fs.existsSync(root)) return root;
  } catch {
    /* not a git repo or git unavailable — fall back to cwd */
  }
  return path.resolve(cwd);
}

export interface GuildPaths {
  repoRoot: string;
  guildDir: string;
  indexesDir: string;
  runsDir: string;
  codebaseMap: string;
  knowledgeGraph: string;
  knowledgeLinks: string;
  fingerprint: string;
  partialGraph: string;
}

export function guildPaths(cwd: string): GuildPaths {
  const repoRoot = resolveMainRepoRoot(cwd);
  const guildDir = path.join(repoRoot, ".guild");
  const indexesDir = path.join(guildDir, "indexes");
  const runsDir = path.join(guildDir, "runs");
  return {
    repoRoot,
    guildDir,
    indexesDir,
    runsDir,
    codebaseMap: path.join(indexesDir, "codebase-map.json"),
    knowledgeGraph: path.join(indexesDir, "knowledge-graph.json"),
    knowledgeLinks: path.join(indexesDir, "knowledge-links.json"),
    fingerprint: path.join(indexesDir, "understand-fingerprint.json"),
    partialGraph: path.join(indexesDir, "understand-partial-graph.json"),
  };
}

/** Deterministic JSON write (stable key order via replacer-free 2-space). */
export function writeJson(filePath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf8");
}

export function readJson<T = unknown>(filePath: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}
