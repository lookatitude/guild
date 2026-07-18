/**
 * tests/universal-host/live-surface-anchor.ts
 *
 * The SQUASH-PROOF anchor shared by the two live-surface guards (SC-W2-5, SC-W3-6).
 *
 * ── Why this exists ────────────────────────────────────────────────────────────
 * Both guards used to anchor on a PINNED COMMIT SHA and assert
 * `isAncestor(PINNED_BASELINE, HEAD)`. That is fundamentally incompatible with
 * squash-merging: a squash rewrites the commit SHA, so the pin is ORPHANED the
 * moment the PR that set it lands. The guard then throws
 * "pinned baseline is not an ancestor of HEAD" — it goes DARK on the channel
 * branch, and because nothing re-runs the guard on `next` itself, nobody notices
 * until an unrelated PR trips over it.
 *
 * That is not theoretical: it happened THREE times in a row — #37, #38, #39 —
 * each squash-merge orphaning the pin the previous PR had just re-ratified. The
 * old design put the repo on a re-pinning treadmill whose failure mode is a
 * silently disabled safety gate.
 *
 * ── The fix ────────────────────────────────────────────────────────────────────
 * Anchor on git TREE hashes instead of a commit SHA. A tree hash is the identity
 * of CONTENT, so a squash-merge — which preserves the tree while rewriting the
 * commit — leaves it untouched. Empirically verified on this repo: `commands` is
 * tree `0ab2b64bdc87` at BOTH the pre-squash feature tip (0f965e1) and the
 * squashed merge on next (4c4156f).
 *
 * This also DELETES an entire attack surface. A commit pin is a movable ref, so
 * the old guard needed `resolveBaseline()` with an ancestry check, a not-HEAD
 * check, and a `GUILD_W*_BASELINE_REF` env-bypass rejector (plus forward-ref
 * anti-vacuity for all of it). A hardcoded tree hash has no ref to move: there is
 * nothing to point at HEAD, nothing to move forward, nothing to override. The
 * anchor is strictly stronger AND strictly simpler.
 *
 * ── Why `.claude-plugin` is not a tree hash ────────────────────────────────────
 * A release legitimately bumps `version` inside plugin.json + marketplace.json,
 * which changes their tree. The pre-existing release tolerance (a PURE version
 * bump is exempt; any other manifest edit is not) must be preserved, so those two
 * manifests anchor on a VERSION-STRIPPED content hash instead. The file SET under
 * `.claude-plugin/` is asserted separately, so a NEW file there cannot slip in
 * unchecked — the one hole a per-file hash would otherwise leave open.
 *
 * Owner: eval-engineer.
 */

import { execFileSync } from "node:child_process";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export const PLUGIN_ROOT = path.resolve(__dirname, "../..");

/**
 * THE RATIFIED SURFACE — the squash-proof anchor both guards assert against.
 *
 * RE-RATIFICATION RULE (read before touching these): on a DELIBERATE surface
 * change, re-run `worktreeTreeHash()` / `manifestStrippedHash()` on the new
 * surface and paste the values here, in the SAME commit as the change, with a note
 * saying what was ratified and why. There is no ancestry to satisfy and no
 * "must not be HEAD" subtlety — a tree hash is content identity, so the anchor is
 * simply "the bytes we ratified". Do NOT auto-derive these at runtime from HEAD: a
 * self-deriving anchor would let a committed surface mutation ratify itself, which
 * is the entire reason the surface is pinned at all.
 *
 * Ratified 2026-07-17 — the post-de-numbering surface on `next` (the docs
 * retirement + docs/v2 citation sweep, guild#39). commands/*.md and
 * skills/knowledge/wiki-ingest/SKILL.md changed there ONLY because they cited
 * `docs/v2/<NN>-<name>.md` paths; no command or skill behaviour changed.
 *
 * Re-ratified 2026-07-18 — the three codex-gated Guild-on-Guild skill
 * evolutions (guild#42 learn-onboard workspace-root fallback, guild#43
 * execute-plan dispatch hardening, guild#44 evolve-skill method codification)
 * plus their scenarios.json sidecars. DELIBERATE surface change: each shipped
 * through the full evolve promotion gate (live paired evals, flip/shadow
 * reports, adversarial review — gate trails on the umbrella main). commands/
 * tree unchanged.
 */
export const RATIFIED_TREES: Readonly<Record<string, string>> = Object.freeze({
  commands: "1ff955f6b393387aac2c2003b38b49b9076db80b",
  skills: "f348cceeb92173a053da31e936685c02bdf6e0d1",
});

/** Version-stripped content hashes for the two release-tolerant manifests. */
export const RATIFIED_MANIFESTS: Readonly<Record<string, string>> = Object.freeze({
  ".claude-plugin/plugin.json": "d5ff5f898e6122f64fe2cc2af3810ff5f8e7a471131c97c720ee6092c6ff38de",
  ".claude-plugin/marketplace.json": "0668d0fe064775e3a0b754474a9ca8a44d327e4132d298e65737183bf06bcdb4",
});

/**
 * The EXACT tracked file set under `.claude-plugin/`. Asserted because the two
 * manifests are anchored per-file (they need the version tolerance) rather than by
 * tree hash — without this, a NEW file under `.claude-plugin/` would be anchored by
 * nothing and could slip in unchecked.
 */
export const RATIFIED_CLAUDE_PLUGIN_FILES: readonly string[] = Object.freeze([
  ".claude-plugin/marketplace.json",
  ".claude-plugin/plugin.json",
]);

/** The `version` sentinel used to mask version fields before hashing a manifest. */
const VERSION_SENTINEL = "\u0000VERSION\u0000";

export const VERSION_EXEMPT_MANIFESTS = [
  ".claude-plugin/plugin.json",
  ".claude-plugin/marketplace.json",
] as const;

export function git(args: string[], env?: NodeJS.ProcessEnv): string {
  return execFileSync("git", args, {
    cwd: PLUGIN_ROOT,
    encoding: "utf8",
    env: env ? { ...process.env, ...env } : process.env,
    maxBuffer: 64 * 1024 * 1024,
  }).trim();
}

/**
 * The git TREE hash of `p` AS IT EXISTS IN THE WORKING TREE (not HEAD).
 *
 * The guard must catch an UNCOMMITTED mutation, so hashing `HEAD:<p>` would be
 * vacuous. This stages the path into a THROWAWAY index (never the real one — the
 * caller's staging area is untouched) and writes the resulting subtree.
 */
export function worktreeTreeHash(p: string): string {
  const tmpIndex = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "guild-anchor-")), "index");
  try {
    const env = { GIT_INDEX_FILE: tmpIndex };
    git(["read-tree", "HEAD"], env);
    // -A picks up modifications, additions AND deletions under p.
    git(["add", "-A", "--", p], env);
    return git(["write-tree", `--prefix=${p}`], env);
  } finally {
    fs.rmSync(path.dirname(tmpIndex), { recursive: true, force: true });
  }
}

/**
 * Mask EVERY `version` key (plugin.json's top-level; marketplace.json's
 * `plugins[].version`) and NOTHING else, so a PURE version bump hashes equal while
 * any other manifest change — a command/skill/agent declaration, name, source,
 * description — still differs and stays a violation.
 */
export function stripVersions(jsonText: string): string {
  const walk = (o: unknown): unknown => {
    if (Array.isArray(o)) return o.map(walk);
    if (o && typeof o === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
        out[k] = k === "version" ? VERSION_SENTINEL : walk(v);
      }
      return out;
    }
    return o;
  };
  return JSON.stringify(walk(JSON.parse(jsonText)));
}

/**
 * The version-stripped content hash of a manifest, read from the WORKING TREE.
 * Fail-closed: an unreadable or unparseable manifest yields a sentinel that can
 * never equal a real anchor, so it stays a violation rather than passing silently.
 */
export function manifestStrippedHash(p: string): string {
  let text: string;
  try {
    text = fs.readFileSync(path.join(PLUGIN_ROOT, p), "utf8");
  } catch {
    return "UNREADABLE";
  }
  try {
    return crypto.createHash("sha256").update(stripVersions(text)).digest("hex");
  } catch {
    return "UNPARSEABLE";
  }
}

/**
 * Synthesize a real git tree object containing ONLY the ratified frozen paths, each at
 * its ratified subtree. `git archive` accepts any tree-ish, so this gives the SC-W2-5
 * A/B resolver a baseline tree to extract — without anchoring on a commit that a
 * squash-merge would orphan.
 *
 * The returned tree is content-derived: it exists iff the ratified subtrees exist, so it
 * cannot silently resolve to something else.
 */
export function ratifiedSurfaceTree(): string {
  const spec = Object.entries(RATIFIED_TREES)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([p, tree]) => `040000 tree ${tree}\t${p}`)
    .join("\n");
  return execFileSync("git", ["mktree"], {
    cwd: PLUGIN_ROOT,
    encoding: "utf8",
    input: `${spec}\n`,
  }).trim();
}

/**
 * Files under `.claude-plugin/` in the WORKING TREE — tracked AND untracked — asserted so
 * a NEW manifest cannot slip in.
 *
 * `--others --exclude-standard` is load-bearing: a bare `git ls-files` reports only TRACKED
 * files, so a brand-new untracked manifest would be "anchored by nothing" until someone
 * staged it — precisely the drift this guard exists to catch, and weaker than the
 * commands/skills path (whose `git add -A` already picks up untracked additions). Ignored
 * files stay excluded: they are not part of the shipped surface.
 */
export function claudePluginFileSet(): string[] {
  return git(["ls-files", "--cached", "--others", "--exclude-standard", "--", ".claude-plugin"])
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .sort();
}

/**
 * Human-readable per-file diff between the ratified subtree and the worktree
 * subtree, for DIAGNOSTICS when an anchor mismatches. Both sides are subtrees of
 * the same path, so git reports paths relative to it — re-prefixed here.
 */
export function describeTreeDelta(p: string, expectedTree: string, actualTree: string): string[] {
  try {
    return git(["diff", "--name-status", expectedTree, actualTree])
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const [status, ...rest] = l.split(/\s+/);
        return `${status}\t${p}/${rest.join(" ")}`;
      });
  } catch {
    return ["(tree diff unavailable — the ratified tree object is not present locally)"];
  }
}
