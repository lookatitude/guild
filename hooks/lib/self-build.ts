/**
 * hooks/lib/self-build.ts
 *
 * Single shared predicate for "is this session working on the Guild plugin
 * itself" (self-build context). Consumed by:
 *   - hooks/maybe-reflect.ts (FU-E codex-skip discipline guard)
 *   - hooks/bootstrap.sh (SELF-BUILD SessionStart banner) — bash cannot
 *     `import` this module, so bootstrap.sh re-implements the same check with
 *     the SAME marker string; hooks/__tests__/self-build.test.ts pins both
 *     sides against the real file so they cannot silently diverge again.
 *
 * History (why this file exists): the orientation banner used to live in
 * plugin/CLAUDE.md, and both maybe-reflect.ts and bootstrap.sh grepped that
 * file directly. On 2026-06-21 the banner moved to AGENTS.md (CLAUDE.md
 * became a thin `@AGENTS.md` shim) and neither detector was updated — the
 * FU-E codex-skip hard-fail and the SELF-BUILD SessionStart banner silently
 * went dead. This module is the fix: ONE marker constant, checked against the
 * file that actually carries it today, from either of the two roots a
 * self-build session can start from:
 *
 *   - the plugin repo root itself   → <root>/AGENTS.md
 *   - the umbrella workspace root   → <root>/plugin/AGENTS.md
 *
 * Never throws; a missing/unreadable file is simply "not armed".
 */

import * as fs from "fs";
import * as path from "path";

/**
 * The literal marker string that identifies the Guild plugin's own
 * orientation file. Keep this in sync with the FIRST HEADING of
 * plugin/AGENTS.md — hooks/__tests__/self-build.test.ts asserts the real file
 * on disk still contains it, so any future rename fails CI loudly instead of
 * silently killing self-build discipline again.
 */
export const SELF_BUILD_MARKER = "Guild — repo orientation";

export interface SelfBuildDetection {
  /** True iff a self-build orientation file was found from this root. */
  armed: boolean;
  /** The absolute path of the orientation file that matched, or null. */
  path: string | null;
}

function fileContainsMarker(p: string): boolean {
  try {
    if (!fs.existsSync(p)) return false;
    return fs.readFileSync(p, "utf8").includes(SELF_BUILD_MARKER);
  } catch {
    return false;
  }
}

/**
 * Detect self-build context from `root` (typically resolveGuildRoot(cwd)).
 * Checks, in order:
 *   1. <root>/AGENTS.md          (root IS the plugin repo)
 *   2. <root>/plugin/AGENTS.md   (root is the umbrella workspace)
 */
export function detectSelfBuild(root: string): SelfBuildDetection {
  const directPath = path.join(root, "AGENTS.md");
  if (fileContainsMarker(directPath)) return { armed: true, path: directPath };

  const nestedPath = path.join(root, "plugin", "AGENTS.md");
  if (fileContainsMarker(nestedPath)) return { armed: true, path: nestedPath };

  return { armed: false, path: null };
}
