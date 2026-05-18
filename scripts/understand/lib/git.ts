/**
 * understand/lib/git.ts — deterministic git helpers (no runtime deps).
 */

import { execFileSync } from "child_process";

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf-8" }).trim();
}

/** Current HEAD sha, or "unknown" if not a git repo. */
export function headSha(cwd: string): string {
  try {
    return git(cwd, ["rev-parse", "HEAD"]);
  } catch {
    return "unknown";
  }
}

/** Files changed between base..head (defaults head=HEAD). Empty on error. */
export function changedFiles(cwd: string, base: string, head = "HEAD"): string[] {
  try {
    const out = git(cwd, ["diff", `${base}..${head}`, "--name-only"]);
    return out
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
  } catch {
    return [];
  }
}

/** True if cwd is inside a linked worktree (not the main worktree). */
export function isLinkedWorktree(cwd: string): boolean {
  try {
    const gitDir = git(cwd, ["rev-parse", "--git-dir"]);
    const commonDir = git(cwd, ["rev-parse", "--git-common-dir"]);
    // In a linked worktree, --git-dir points into .git/worktrees/<name>
    // while --git-common-dir points at the shared .git.
    return gitDir !== commonDir;
  } catch {
    return false;
  }
}
