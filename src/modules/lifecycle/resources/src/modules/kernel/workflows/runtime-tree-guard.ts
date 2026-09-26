/**
 * runtime-tree-guard.ts — the AC37 no-self-edit guard (KTD18 / U-RSI).
 *
 * ONE implementation of "this write must not land in a runtime surface". It was
 * born inside `scripts/instantiate-template.ts` for the product-loop producer; T11
 * needs the same question answered for every evolve writer, so the body moved here
 * and the producer re-exports it. Extending it — never forking it — is the point:
 * a second copy is a second place a new forbidden tree can be forgotten.
 *
 * Two questions, asked in this order:
 *
 *   1. POSITIVE plugin-root containment. A target INSIDE the plugin install root is
 *      allowed ONLY when it is the artifact tree. Everything else under the
 *      install root is refused, with no deny-list to keep in sync, so a tree that
 *      does not exist yet is denied too. This is what makes plugin RSI structurally
 *      candidate-only: an evolve writer aiming at `src/surfaces/**` cannot reach it,
 *      and the human commit is the only path (KTD63).
 *   2. CONSUMING-root deny-list. A target outside the plugin root that lands in a
 *      runtime sub-tree of the CONSUMING repo is refused. `src/` and `templates/`
 *      joined the original six for T11: a self-build cwd IS a consuming repo, so
 *      without them `--target=domain_ts` on the plugin's own checkout read as
 *      "outside the install root → allowed".
 *
 * SCOPE: this is a containment guard over a path the caller already decided to
 * write. It is not a sandbox and it does not sanitise content.
 */

import * as path from "node:path";

import { canonicalizeRealPath, isWithin } from "./path-containment";
import { sealSet } from "./sealed-collections";

/**
 * The one directory under a plugin root a producer or evolve writer may write. Named
 * as a const, not spelled into a template: `no-direct-guild-join` reads raw template
 * text, and a guard that merely NAMES the tree it protects is not a path construction.
 */
const ARTIFACT_DIR_NAME = ".guild";

/**
 * The host authoring dot-dir. Its `agents` child is a runtime surface; its siblings
 * (settings, for instance) are not, which is why it is a two-segment check rather than
 * another entry in the first-segment set below.
 */
const HOST_DIR_NAME = ".claude";

/**
 * Runtime surface sub-trees no producer or evolve writer may write into, anchored at
 * ANY repo root (the plugin tree OR a consuming repo). Deliberately first-segment
 * anchored and small.
 *
 * `src` and `templates` are the T11 additions (U-RSI: "extend `assertNotRuntimeTree`
 * so evolve cannot write surfaces or templates except via the human path").
 */
export const RUNTIME_SUBTREE_SEGMENTS: ReadonlySet<string> = sealSet(
  [
    "skills",
    "agents",
    "commands",
    "hooks",
    ".claude-plugin",
    "dist",
    "src",
    "templates",
  ],
  "RUNTIME_SUBTREE_SEGMENTS",
);

/**
 * Canonicalize a single path segment for the forbidden-subtree comparison, defeating
 * filesystem aliasing that resolves to the SAME directory as a forbidden name:
 *   - case-insensitivity (macOS/Windows): `Skills` → `skills`;
 *   - Win32 trailing-dot / trailing-space stripping: `skills.`, `skills `, `SKILLS. ` → `skills`.
 * A leading dot is meaningful and preserved (`.skills` is a distinct dir, NOT forbidden;
 * the host dot-dir must keep its leading dot).
 */
export function canonSegment(seg: string): string {
  return seg.toLowerCase().replace(/[. ]+$/, "");
}

/**
 * True iff `real` resolves INSIDE `root` and lands in a forbidden runtime sub-tree of
 * it. A target outside `root` is NOT this root's concern → false. A falsy `root`
 * short-circuits to false. Never creates anything.
 */
export function isForbiddenRuntimeSubtree(real: string, root: string | null | undefined): boolean {
  if (!root) return false;
  const realRoot = canonicalizeRealPath(root);
  const rel = path.relative(realRoot, real);
  if (!isWithin(real, realRoot)) return false; // outside this root
  const segs = rel === "" ? [] : rel.split(path.sep);
  const first = canonSegment(segs[0] ?? "");
  if (RUNTIME_SUBTREE_SEGMENTS.has(first)) return true;
  // The host authoring tree's agents dir, checked as two segments so an unrelated
  // settings write under the same dot-dir is not over-blocked.
  if (first === HOST_DIR_NAME && canonSegment(segs[1] ?? "") === "agents") return true;
  return false;
}

/**
 * AC37 guard — refuse to write into any runtime surface, at the plugin root AND the
 * consuming repo root. See the module header for the two questions.
 *
 * @throws Error if the (symlink-resolved) target is a runtime sub-tree of either root.
 */
export function assertNotRuntimeTree(
  targetDir: string,
  pluginRoot: string,
  consumingRoot?: string | null,
): void {
  const real = canonicalizeRealPath(targetDir);
  // Realpath the plugin root too — else a symlinked root component (e.g. macOS
  // /var → /private/var) makes the resolved target read as "outside" and bypasses the guard.
  const realRoot = canonicalizeRealPath(pluginRoot);
  const rel = path.relative(realRoot, real);
  // Genuinely OUTSIDE the plugin root: rel is "..", a "../…" traversal, or absolute (different
  // drive). NB: test the path SEGMENT, not `startsWith("..")` — a sibling dir literally named
  // "..guild" yields rel "..guild/…" which starts with ".." yet is INSIDE the root.
  const outsidePluginRoot = !isWithin(real, realRoot);
  if (!outsidePluginRoot) {
    const first = rel === "" ? "" : rel.split(path.sep)[0];
    if (first !== ARTIFACT_DIR_NAME) {
      const where = first === "" ? "the plugin root itself" : `the plugin tree "${first}/"`;
      throw new Error(
        `refusing to write into ${where} (AC37 no-self-edit; only the plugin root's own ` +
          ARTIFACT_DIR_NAME +
          ` artifact tree is writable): ${real}`,
      );
    }
  }
  if (isForbiddenRuntimeSubtree(real, consumingRoot)) {
    throw new Error(
      `refusing to write into a consuming-repo runtime tree (AC37 no-self-edit; ` +
        `${[...RUNTIME_SUBTREE_SEGMENTS].join("/")} and the host authoring agents dir ` +
        `are forbidden): ${real}`,
    );
  }
}
