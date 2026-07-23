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
 *
 * Re-ratified 2026-07-18 (integration fan-out 1) — three further codex-gated
 * skill evolutions merged on `evolve/integration-fanout-1`: guild:plan
 * (spine-lane declaration + non-waivable checkpoint,
 * evolve/plan-spine-declaration), guild:context-assemble (confirmation
 * provenance for ask-gated lanes, evolve/context-assemble-ask-provenance),
 * guild:learn (workspace-root learn contract, evolve/learn-workspace-contract)
 * — each shipped through its own full evolve promotion gate (live paired
 * evals, flip/shadow reports, multi-round adversarial review) on an isolated
 * worktree/branch before this merge. commands/ tree unchanged (verified equal
 * to the prior pin).
 *
 * Re-ratified 2026-07-19 (escalations CE-9 + CE-2, one deliberate pin change) —
 * a DOCS-ONLY surface change; NO command or skill behaviour changed.
 *   (a) CE-9: 19 dangling `docs/v2/<page>.md` citations retargeted to `.html`
 *       across 9 command pages + 4 skill pages. The umbrella docs set
 *       was converted Markdown→HTML, so every cited page now exists ONLY as
 *       `.html` — each edit is extension-only (the escalation ledger said 18;
 *       the true count is 19 — `skills/meta/brainstorm/SKILL.md:113` carries two
 *       occurrences on one line).
 *   (b) CE-2: `commands/config.md` 5-host-world staleness corrected to the real
 *       registry — 16 `HOST_IDS`, of which 12 are `CLI_NATIVE_HOSTS` and 4 are
 *       app/connector refuse hosts (the doc claimed 5 of each, with obsolete id
 *       spellings). Prose only. NOTE: the escalation cited only lines 132-136 +
 *       249-254, but adversarial review found the same stale host-world in THREE
 *       further places — the `description:` frontmatter ("5 host-native config
 *       shapes"), the `--host` flag note ("the 9 registry hosts"), and the
 *       app/connector paragraph, which listed only the original 5 as CLI-native
 *       and thereby falsely marked cursor / github-copilot / opencode / rovo-dev /
 *       kiro / qoder / trae as having no native config surface. All five sites are
 *       corrected here; ratifying the ledger's narrower scope would have blessed
 *       the exact claims CE-2 exists to remove. Review round 2 found a sixth site:
 *       the `role` section called the legacy short names (`claude`, `codex`,
 *       `.agents`, `pi`, `antigravity`) "registry host ids". They are INPUT
 *       ALIASES that normalize to canonical ids via LEGACY_HOST_ALIASES, and they
 *       cover only 5 of the 16 — the line both contradicted the corrected text
 *       above it and implied the other 11 hosts could not be pinned.
 * `command-src/command-registry.json` was re-extracted in the SAME commit so the
 * `render(entry) === commands/<id>.md` byte-parity invariant holds (SC-W2-3 +
 * the authored-source suite, both green). `.claude-plugin/**` is untouched, so
 * RATIFIED_MANIFESTS and RATIFIED_CLAUDE_PLUGIN_FILES below are UNCHANGED —
 * verified, not assumed. Both guards were observed RED against the old pin
 * before this bump, which is the anti-vacuity evidence that the pin is live.
 *
 * Re-ratified 2026-07-21 (issue #36 shell-fallback sweep, guild#61) — a
 * DELIBERATE, purely mechanical text substitution across every command/skill
 * resource doc: `${GUILD_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT}}` →
 * `${GUILD_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-$HOME/.local/share/guild/dist/claude-code}}`
 * (the two host env vars are render-time only and unset in the Bash tool's
 * shell, so documented CLI invocations expanded to `/scripts/...`). No command
 * or skill BEHAVIOUR changed — only the fallback tail of the documented plugin
 * root. 270 occurrences / 111 files, mirrors + registries re-synced in the same
 * commit (both module-resource sync directions checked clean).
 * `.claude-plugin/**` untouched — RATIFIED_MANIFESTS unchanged. Both guards
 * observed RED against the old pin on guild#61 CI (jest (tests) job of run
 * 29794297180) before this bump — anti-vacuity evidence the pin is live.
 *
 * Re-ratified 2026-07-21 (issue #58 type-erasure detectability, guild#66) —
 * DELIBERATE skill-surface change: `skills/meta/execute-plan/{SKILL.md,dispatch.md}`
 * now state the ENFORCED project-lane dispatch contract (GUILD_AGENT_DEFINITION
 * line-1 marker + adoption prefix are guaranteed and hook-verified, replacing the
 * "env not guaranteed on the subagent path" caveat). `skill-src/skill-registry.json`
 * was re-extracted in the SAME commit so `render(entry) === skills/meta/execute-plan/
 * SKILL.md` byte-parity holds (SC-W2-1 + skill-source-transform suites green).
 * `commands/**` untouched — its pin is UNCHANGED (verified). `.claude-plugin/**`
 * untouched — RATIFIED_MANIFESTS unchanged. Both guards observed RED against the
 * old skills pin on guild#66 CI (run 29800612956) — anti-vacuity evidence.
 *
 * Re-ratified 2026-07-22 (merge of guild#61 sweep + guild#66 onto next) —
 * mechanical MERGE re-ratification: the merged tree carries BOTH the #61
 * fallback sweep and the #66 execute-plan contract text, so both prior pins
 * are stale by construction. skill-src/skill-registry.json re-based on next's
 * (sweep-consistent) copy with the execute-plan entry re-extracted from the
 * merged SKILL.md (all 5 wave-2 skills round-trip byte-identical). commands
 * pin recomputed on the merged tree.
 *
 * Re-ratified 2026-07-21 (issue #56 backend-degradation detector, guild#67) —
 * DELIBERATE: `skills/meta/execute-plan/dispatch.md` additionally documents the
 * now-enforced refuse-don't-fallback backend contract + degradation receipts.
 * SKILL.md unchanged vs guild#66, so skill-src/skill-registry.json needed no
 * further re-extraction (round-trip verified). commands + .claude-plugin pins
 * unchanged. Guard observed RED on guild#67 CI (run 29805091863) — anti-vacuity.
 *
 * Re-ratified 2026-07-21 (issue #57 lean-lead expiry, guild#68) — DELIBERATE:
 * `skills/meta/execute-plan/SKILL.md` gains the §Expiry contract for the
 * inline shortcut (lapse after N lead edits or any compaction boundary).
 * `skill-src/skill-registry.json` re-extracted in the SAME commit (all 5
 * wave-2 skills round-trip byte-identical). commands + .claude-plugin pins
 * unchanged. The stale pin was observed RED locally against this tree before
 * the bump — anti-vacuity.
 *
 * Re-ratified 2026-07-21 (issue #60 tier guard, guild#69) — DELIBERATE:
 * `skills/meta/execute-plan/dispatch.md` additionally documents the enforced
 * tier contract + the guild.tier_dispatch.v1 receipt sink. SKILL.md unchanged
 * vs guild#67 (registry round-trip re-verified, no re-extraction needed).
 * commands + .claude-plugin pins unchanged. Stale pin observed RED locally
 * against this tree before the bump — anti-vacuity.
 *
 * Re-ratified 2026-07-22 (merge-train integration, guild#69) — mechanical
 * MERGE re-ratification on the tree carrying #61+#66+#67+#69 content
 * (dispatch.md now documents backend-degradation AND tier contracts).
 * Registry round-trip verified against the merged SKILL.md set; commands pin
 * = the post-sweep value.
 *
 * Re-ratified 2026-07-22 (final merge-train integration, guild#69) — the
 * merged tree now also carries guild#68 (§Expiry + lean-lead). Registry
 * re-extracted for the fully merged SKILL.md; pins recomputed.
 *
 * Re-ratified 2026-07-22 (issue #59 lifecycle adherence, oir-wi-59) —
 * DELIBERATE: `skills/meta/execute-plan/SKILL.md` §"Resuming dead lanes" gains
 * the §"Close requires review + verify-done" contract — a build run must pass
 * guild:review + guild:verify-done before close, resuming is not a shortcut
 * past a skipped gate — plus the code-not-prose enforcement pointer at the new
 * `hooks/lib/lifecycle-gate.ts` (the active UserPromptSubmit gate and the
 * close-time Stop backstop), their override/threshold semantics, and the two
 * honestly-stated known gaps. `skill-src/skill-registry.json` re-extracted in
 * the SAME commit (all 5 wave-2 skills round-trip byte-identical).
 * commands + .claude-plugin pins unchanged (verified, not assumed). Both
 * guards were observed RED locally against the old skills pin before the bump
 * (SC-W2-5(1) and SC-W3-6(B), each naming
 * `M skills/meta/execute-plan/SKILL.md`) — anti-vacuity.
 *
 * Re-ratified 2026-07-22 (merge-train integration, guild#70) — mechanical
 * MERGE re-ratification on the tree carrying #61+#66+#68+#70 content
 * (SKILL.md: §Expiry + #66 contract + §Close-requires-review+verify).
 * Registry re-extracted for the merged SKILL.md (5/5 round-trip). commands
 * pin = post-sweep value.
 *
 * Re-ratified 2026-07-22 (final merge-train integration, guild#70) — the
 * merged tree carries ALL wave content (#61+#66+#67+#68+#69+#70:
 * dispatch.md backend+tier contracts, SKILL.md §Expiry + #66 contract +
 * §Close-requires-review+verify). Registry re-extracted for the fully
 * merged SKILL.md; pins recomputed on this tree.
 *
 * Re-ratified 2026-07-23 (initiative v23x-deferred-followups, rf-wi-06) —
 * DELIBERATE skill-surface change, two files:
 *   (a) `skills/meta/execute-plan/SKILL.md` §"Backend + routing (summary)" cmux
 *       obligation (a) now WIRES the cmux dispatch-receipt CLI
 *       (`scripts/lib/host/pane-dispatch-trace.ts`) as the executable form of
 *       "the dispatch records the launcher would have" — removing the
 *       manual-lead-invocation limitation (G6a).
 *   (d) `skills/meta/codex-review/SKILL.md` §"Cap handling"/"Trail format"/
 *       "Output shape" now name the two codex-review cap TERMINAL states —
 *       `cap-pushback-recorded` ("cap + reasoned pushback recorded") and
 *       `cap-verification-only` ("verification-only round beyond cap") — matching
 *       the two new clean terminals in `scripts/verify-codex-review-trail.ts`
 *       (G6d).
 * `skill-src/skill-registry.json` was re-extracted in the SAME commit
 * (extractSkillV1 → all 5 WAVE2 skills round-trip byte-identical via
 * renderSkillFromRegistry; only the execute-plan `body` changed —
 * codex-review is not a registry skill). `commands/**` UNTOUCHED — its pin is
 * UNCHANGED (verified equal, not assumed). `.claude-plugin/**` untouched —
 * RATIFIED_MANIFESTS unchanged. The pins below were recomputed AFTER the hooks
 * rebuild + module-resource sync (both `--check` modes clean). The
 * `check-surface-pins.ts` checklist-as-code (G6b) was observed RED against the
 * old skills pin before this bump (registry_stale execute-plan + tree_pin_stale
 * skills) — anti-vacuity evidence the pin is live.
 */
export const RATIFIED_TREES: Readonly<Record<string, string>> = Object.freeze({
  commands: "6f5889958e8fee52efbb5944fa80afad5e316470",
  skills: "90bb59e5113dafa408d85e023a93f0a60d8b3598",
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
