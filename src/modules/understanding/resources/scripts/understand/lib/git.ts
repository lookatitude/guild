/**
 * understand/lib/git.ts — deterministic git helpers (no runtime deps).
 */

import { execFileSync } from "child_process";
import * as path from "path";

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf-8" }).trim();
}

/**
 * True iff `absPath` is tracked by git (committed OR staged — including a file
 * force-added past `.gitignore` with `git add -f`). Probed with
 * `git ls-files --error-unmatch -- <repo-relative-path>` run from `repoRoot`:
 * exit 0 ⇒ tracked.
 *
 * Returns FALSE on ANY non-tracking outcome — the file is untracked, there is no
 * git repo, the path escapes the repo, or the probe errors for any reason — so a
 * legitimate non-git workspace is never hard-failed. Used (FIX-T4.1-r7) to refuse
 * REUSING a *shareable* (tracked) cache sidecar that `.gitignore` alone cannot
 * prevent: gitignore stops accidental commits, but a tracked file is the actual
 * enforcement signal that the local-only assumption has been broken.
 */
export function isTracked(repoRoot: string, absPath: string): boolean {
  const rel = path.relative(repoRoot, absPath);
  // A path outside the repo (or the repo root itself) is never a tracked repo file.
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) return false;
  try {
    git(repoRoot, ["ls-files", "--error-unmatch", "--", rel]);
    return true; // exit 0 ⇒ tracked
  } catch {
    return false; // non-zero (untracked / no repo / error) ⇒ treat as NOT tracked
  }
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
