/**
 * src/modules/state/workflows/storage-fs.ts
 *
 * The only filesystem helpers that DELETE, and the containment rule they share.
 *
 * Three rounds of adversarial review landed on the same class of defect: a name
 * is not a directory. `lstat` proves only the last component; an ancestor of the
 * path — `<temp>/<root-id>/runs`, `<worktrees>/<root-id>` — can itself be a
 * symlink planted before Guild ever looked, and then a "delete my scratch" call
 * deletes somebody else's tree.
 *
 * So every removal in the storage domain goes through here, and every removal
 * obeys the same two rules:
 *
 *   1. RESOLVE, then verify the RESOLVED path is inside the root Guild owns.
 *      Containment is checked on the realpath, so no component of the path can
 *      be a link out.
 *   2. DELETE THE RESOLVED PATH, with nothing between the check and the call.
 *
 * KNOWN RESIDUAL, stated rather than hidden: Node exposes no fd-relative remove
 * (`unlinkat`/`openat`), so a directory swapped in the instant between `realpath`
 * and `rm` is not detectable from here. That race requires write access to
 * Guild's own state or temp root — an attacker who has it can already write
 * anything Guild reads. The rules above remove every window that does NOT
 * require that access.
 */

import * as fs from "node:fs";
import * as path from "node:path";

/** `lstat` that never throws. */
export function lstatSafe(p: string): fs.Stats | null {
  try { return fs.lstatSync(p); } catch { return null; }
}

/** `readdir` that never throws. */
export function readdirSafe(dir: string): string[] {
  try { return fs.readdirSync(dir); } catch { return []; }
}

/**
 * Resolve `abs` and return it only when it is a REAL directory (not a symlink)
 * whose realpath lies strictly inside `root`'s realpath. `null` otherwise.
 */
export function resolveContainedRealDir(abs: string, root: string): string | null {
  const st = lstatSafe(abs);
  if (!st || !st.isDirectory() || st.isSymbolicLink()) return null;
  let real: string;
  let realRoot: string;
  try {
    real = fs.realpathSync(abs);
    realRoot = fs.realpathSync(root);
  } catch {
    return null;
  }
  const rel = path.relative(realRoot, real);
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return real;
}

export function isContainedRealDir(abs: string, root: string): boolean {
  return resolveContainedRealDir(abs, root) !== null;
}

/**
 * Recursively remove `abs`, but only after proving it resolves inside `root`.
 * Returns the resolved path that was removed, or `null` when the check refused.
 */
export function removeContainedTree(abs: string, root: string): string | null {
  const real = resolveContainedRealDir(abs, root);
  if (!real) return null;
  fs.rmSync(real, { recursive: true, force: true });
  return real;
}

/**
 * Remove a directory ONLY if it is empty, and only inside `root`.
 *
 * `rmdir` rather than a recursive remove on purpose: it fails with ENOTEMPTY if
 * anything appeared since the caller looked, so an emptiness test cannot be raced
 * into deleting content.
 */
export function removeContainedEmptyDir(abs: string, root: string): boolean {
  const real = resolveContainedRealDir(abs, root);
  if (!real) return false;
  try {
    fs.rmdirSync(real);
    return true;
  } catch {
    return false;
  }
}
