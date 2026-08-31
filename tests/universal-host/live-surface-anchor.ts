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
 *
 * Re-ratified 2026-07-23 (initiative v23x-deferred-followups, rf-wi-02) —
 * DELIBERATE skill-surface change, two files, wiring the dispatch-integrity
 * SINK CONSUMERS:
 *   (a) `skills/meta/verify-done/SKILL.md` gains check #6 "Dispatch integrity
 *       (sink audit)" — verify-done now gates on `scripts/audit-run-sinks.ts`
 *       (exit 1 on a run with a backend degradation or an un-tiered dispatch),
 *       so a downgraded/un-tiered run reads VISIBLY dirty instead of
 *       auditable-by-path only. "Five checks" → "Six checks".
 *   (b) `skills/meta/reflect/SKILL.md` §Input now names summary.md's new
 *       `## Sink audit` section + `backend_degradations`/`tier_violations`/
 *       `untiered_dispatches` frontmatter (produced by trace-summarize.ts via
 *       `scripts/lib/run-sinks.ts`) as a first-class reflection signal.
 * `skill-src/skill-registry.json` was re-extracted in the SAME commit
 * (extractSkillV1 → all 5 WAVE2 skills round-trip byte-identical; only the
 * verify-done `body` changed — reflect is not a registry skill). `commands/**`
 * UNTOUCHED — its pin is UNCHANGED (verified equal, not assumed).
 * `.claude-plugin/**` untouched. Pins recomputed AFTER the module-resource sync
 * (both `--check` modes clean); `check-surface-pins.ts` observed RED
 * (tree_pin_stale skills) against the prior pin before this bump.
 *
 * MERGE-TRAIN re-ratification 2026-07-23: this branch merged post-#86 `next`
 * (execute-plan surface change), so the skills tree is the UNION of #86 + #89
 * surface changes; recomputed hash EQUALS this branch's pre-merge pin (the
 * branch already carried #86's content — stacked) — verified, not assumed.
 *
 * Re-ratified 2026-08-02 (capability-localization integration, guild#129 /
 * feature/cap-loc-integrated) — DELIBERATE. All three anchors move. The full
 * enumeration follows; it is the enumeration, not the hash bump, that is the
 * ratification. Nothing was regenerated blindly: the pre-bump deltas were read
 * per-file out of `describeTreeDelta`, and every entry below was checked for
 * BOTH intent (a decision that asked for it) and REACHABILITY (something in the
 * shipped surface can actually invoke it).
 *
 * ADDED ENTRIES — exactly ONE across the whole pinned surface:
 *   (A1) `.claude-plugin/plugin.json` `agents[]` gains `./agents/context-manager.md`.
 *        INTENDED: decision cap-loc-D01 — the `mid`-tier installed machinery
 *        agent that executes Learn's semantic halves and per-lane context
 *        assembly, so a project-local role is never also the thing that
 *        assembles its own context.
 *        REACHABLE: registered in plugin.json `agents[]` (the host's dispatch
 *        surface), carried in `guild.inventory.json`, named as the executor by
 *        `skills/knowledge/learn-graph/SKILL.md`, and bound to
 *        `scripts/lib/capability/context-manager-contract.ts` by the F5 suite
 *        (`scripts/__tests__/context-manager-contract.test.ts` asserts the
 *        frontmatter `tools:`/`name:`/`model:` ARE the contract's values).
 *        `check-roster-consistency` green.
 *   The `.claude-plugin/**` FILE SET is UNCHANGED (still exactly the two
 *   manifests) — verified via claudePluginFileSet(), not assumed.
 *
 * MODIFIED ENTRIES — no additions, no deletions, in either tree:
 *   commands/ (2 files, both additive sections):
 *   (M1) `commands/status.md` — F7 candidate surfacing. Prints
 *        `scripts/capability-profile.ts candidates`. Load-bearing rather than
 *        cosmetic: cap-loc-D04 §Recommendation.5 makes this block a HARD
 *        precondition on shipping `capability.resolver_mode: observe` as the
 *        default. REACHABLE: the `candidates` sub-command exists
 *        (capability-profile.ts case "candidates") and is read-only.
 *   (M2) `commands/dashboard.md` — the same block as a terminal-output echo.
 *        Explicitly scoped to terminal output, not the (cross-repo) web UI.
 *   skills/ (6 files across 4 skills):
 *   (M3) `skills/knowledge/learn/SKILL.md` — new step 12b, the D1 report-only
 *        `guild.project_capability_profile.v1` emission, plus the step-1
 *        `--baseline` capture that makes the mutation window the whole run.
 *        REACHABLE: `emit` and `hash-tree` both exist in capability-profile.ts.
 *   (M4) `skills/knowledge/learn-map/SKILL.md` — states that the cheap-scan tier
 *        emits NO capability proposals (the sparse-project guard, cap-loc-D04).
 *   (M5) `skills/knowledge/learn-graph/SKILL.md` — names the EXECUTOR of the LLM
 *        halves as the installed learning machinery (the context-manager agent
 *        at `mid` tier) instead of roster roles, with session-runs-it fallback.
 *        This is the skill-side half of (A1); the two ship together or the agent
 *        is registered with nothing pointing at it.
 *   (M6) `skills/meta/create-skill/{SKILL.md,workflow.md,evals.json}` — the
 *        human-requested vs evolution-proposed creation-authority split (human
 *        authority waives extraction signals 1 and 4 ONLY; 2/3/5 and the paired
 *        eval gate stay mandatory on both). evals.json gains one
 *        `should_trigger` case for the human-requested phrasing.
 *   `command-src/command-registry.json` and `skill-src/skill-registry.json` are
 *   NOT stale on this tree — `check-surface-pins.ts` reports no `registry_stale`
 *   finding, so no re-extraction was needed and none was performed (checked, not
 *   assumed).
 *
 * VERSION FIELD: 2.4.0 → 2.5.0-beta.1 in both manifests. That part is EXEMPT by
 * construction (stripVersions), so it is not why RATIFIED_MANIFESTS moves. Both
 * manifest hashes move because of (A1) and the `description` string it forces —
 * "2 machinery agents" → "3 machinery agents" — which is exactly the class of
 * non-version manifest edit the per-file anchors exist to catch. It caught it.
 *
 * NOT IN THE PINNED SURFACE, recorded because the check found it: this work also
 * ships `scripts/capability-adopt.ts` (gap D6, self-described as "the user-facing
 * surface" over adoption-migrate). `scripts/**` is not anchored, so it does not
 * move a pin — but the reachability half of this re-ratification found NOTHING in
 * commands/, skills/, agents/ or the manifests that invokes or documents it. It
 * ships reachable only by hand-typed `npx tsx`. Filed rather than fixed here (a
 * command page is a surface addition, and inventing one inside a re-ratification
 * commit is precisely the blind widening this pin exists to prevent).
 *
 * Pins below were computed AFTER `sync-module-resources` with all four
 * module-SoT `--check` modes clean. ANTI-VACUITY: both guards were observed RED
 * against the OLD pins on this exact tree before the bump — SC-W2-5(1) naming
 * `M commands/dashboard.md` + `M commands/status.md`, SC-W3-6(B) naming the
 * `.claude-plugin` manifest hashes, and both naming the six skills files.
 *
 * ── 2026-08-04 re-ratification (skills only) ───────────────────────────────────
 * `skills` moves 74d8b37c → 66362ad2; `commands` does NOT move and neither
 * manifest hash does. The surface delta is exactly two files, both from the
 * codex-review evolve round (`a verdict-less round is not an unsatisfied round`):
 * `M skills/meta/codex-review/SKILL.md` and `A skills/meta/codex-review/scenarios.json`.
 *
 * Plus a third change found by `check-plugin-root-fallback.ts` while re-ratifying:
 * SKILL.md:315 shipped the FORBIDDEN two-level `${GUILD_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT}}`
 * with no terminal $HOME default, which resolves to an empty path on a host that sets
 * neither. Repaired to the required triple fallback in the same commit, so the pinned
 * tree is the CORRECTED surface rather than the authored one.
 *
 * The C5 mirror under `src/modules/review/resources/**` was already correct for the
 * evolve edit in the authoring commit — `sync-module-resources.ts` produced a ZERO
 * diff over 645 resources across 31 modules — and was re-synced after the fallback
 * repair, with `--check` clean both times.
 *
 * ANTI-VACUITY: both guards were observed RED against the OLD pin on this exact
 * tree before the bump, and RED for the right reason — SC-W2-5(1) and SC-W3-6(B)
 * each named those two skills files and NOTHING else, so the pin move is scoped to
 * the intended change rather than papering over unrelated drift.
 *
 * ── 2026-08-06 re-ratification (skills only, issue #91) ────────────────────────
 * `skills` moves a800ffa5 → e92d7dbb; `commands` does NOT move and neither
 * manifest hash does. The surface delta is exactly three files, all the skill half
 * of issue #91 (the D5 direct-subagent dispatch rung was the ONE dispatch class
 * PR #85's universal producer marker did not cover, because the launcher hands
 * that rung's whole `Agent()` construction back to the skill and there is no
 * launcher-side descriptor to stamp):
 *   `M skills/meta/execute-plan/SKILL.md`  — §"Capability-scope env injection"
 *      gains steps (2b)/(2c): the producer marker's env half
 *      (`GUILD_DISPATCH_PRODUCER=guild.dispatch.v1` + `GUILD_SPECIALIST`, plus
 *      `GUILD_TIER`/`GUILD_TIER_SCORE` where a tier/score actually resolves, plus
 *      `GUILD_AGENT_DEFINITION` for a project specialist) and its prompt half
 *      (the line-1 marker), plus the unconditional-on-this-rung invariant.
 *   `M skills/meta/execute-plan/dispatch.md` — new §"Producer marker (line-1 +
 *      env)" carrying the per-class stamping table and the parse rules, plus
 *      three pointer updates (structured-carrier list, handoff-injection row,
 *      prompt-cache exception).
 *   `M skills/meta/execute-plan/scenarios.json` — five added behavioral scenarios
 *      (S6 line-1 marker on the subagent rung, S7 omit-vs-fabricate GUILD_TIER,
 *      S8 the PROJECT-class dispatch shape, S9 the lane-owner→team-specialist
 *      join, S10 marker on every retry/re-dispatch) so the body change is
 *      eval-gated; S8-S10 close coverage gaps the adversarial review found. The trigger fixtures in `evals.json` are
 *      unchanged: no frontmatter `description`/`when_to_use` field moved, so the
 *      skill's trigger surface is byte-identical.
 * No command, agent, or manifest surface changed. The SAME commit also carries
 * the hook half of issue #91 — `hooks/lib/dispatch-attribution.ts` deletes the
 * class-gated legacy 300-char producer-head parse now that the marker covers
 * every dispatch class — but `hooks/**` is NOT part of either ratified tree, so
 * it moves no pin here; it is covered by the hooks suite + the module-resource
 * drift gates instead.
 *
 * Pins below were computed AFTER `hooks && npm run build` and
 * `sync-module-resources.ts`, with both `sync-module-resources.ts --check` and
 * `sync-live-resources.ts --check` clean (645 resources across 31 modules); the
 * C5 mirror `src/modules/lifecycle/resources/skills/meta/execute-plan/**` moved
 * with the live files as expected.
 *
 * ANTI-VACUITY: both guards were observed RED against the OLD pin on this exact
 * tree before the bump, and RED for the right reason — SC-W2-5(1), SC-W3-6(B)
 * and the check-surface-pins drift report each named the `skills/` tree and the
 * three `skills/meta/execute-plan/**` files above and NOTHING else, so the pin
 * move is scoped to the intended change rather than papering over unrelated
 * drift.
 *
 * ── 2026-08-06 re-ratification (skills only) — v1 regression repair (PR #136),
 *    rebased over the issue #91 pin move above ─────────────────────────────────
 * `skills` moves e92d7dbb → the pin below; `commands` does NOT move and neither
 * manifest hash does. The delta is exactly three files:
 * `M skills/meta/codex-review/SKILL.md`, `M skills/meta/codex-review/scenarios.json`,
 * `M skills/meta/review-broker/SKILL.md`.
 *
 * WHY: the evolve edit merged in PR #135 was authored as a whole-file copy from a
 * STALE snapshot, so landing it silently DELETED the `## Cap handling` §"two named
 * cap terminal states" section and the `cap_pushback` / `cap_verify` statuses from
 * the output union and the trail-format table (351 → 334 lines; `cap_pushback`
 * 4 → 0 occurrences). `main` never carried the loss; `next` did, and the tree-hash
 * guards could not see it because the pin was re-ratified in the same commit as the
 * deletion. This bump pins the REPAIRED surface: the `no_verdict` terminal is kept
 * and re-derived as an additive PATCH (334 → 418 lines), the cap terminal states
 * are restored verbatim from `main`, and `review-broker` gains the fail-closed
 * `no_verdict` mapping it was missing — an adapter `no_verdict` reaching the broker
 * had no defined handling on `next`.
 *
 * `skills/meta/review-broker/SKILL.md` is GENERATED: the edit was made in
 * `skill-src/skill-registry.json` and re-rendered via `renderSkillFromRegistry`, so
 * render-equivalence (p2-w2-sc1) still holds. The triple `${GUILD_PLUGIN_ROOT:-…}`
 * fallback repaired in the prior re-ratification is carried forward unchanged.
 *
 * Pins computed AFTER `sync-module-resources` (645 resources / 31 modules, `--check`
 * clean). ANTI-VACUITY: both guards were observed RED against the OLD pin on this
 * exact tree before the bump, and RED for the right reason — SC-W2-5(1) and
 * SC-W3-6(B) each named those three skills files and NOTHING else. (The
 * 310323f6 pin from the pre-rebase derivation was superseded by this rebase;
 * the repair content is identical, re-hashed over the #91 skill tree.)
 *
 * ── 2026-08-17 re-ratification (full-implementation-convergence landing,
 *    run-6f94bea1 FIC-51/A7) — all three moving anchors move DELIBERATELY ────────
 * `commands` moves c32076fa → b4695c3f; `skills` moves 1521571d → 2d3c295c;
 * `plugin.json` moves 969bb277 → ca3931c3. `marketplace.json` does NOT move
 * (verified equal, not assumed) and the `.claude-plugin/**` FILE SET is unchanged
 * (still exactly the two manifests). The enumeration below — checked per-file for
 * intent AND reachability against the A6C-accepted convergence delta — is the
 * ratification; the hash bump merely records it.
 *
 * ADDED ENTRIES — exactly ONE across the whole pinned surface:
 *   (A1) `commands/adopt.md` — the `/guild:adopt` command page (project capability
 *        localization: report | catalog | adopt | rollback | status | window | g5).
 *        INTENDED: closes the gap FILED in the 2026-08-02 re-ratification above —
 *        `scripts/capability-adopt.ts` shipped "reachable only by hand-typed
 *        `npx tsx`" with nothing in commands/ documenting it. This page is that
 *        missing surface, shipped through the reviewed convergence programme
 *        rather than invented inside a re-ratification commit.
 *        REACHABLE: registered in `.claude-plugin/plugin.json` `commands[]` in
 *        the SAME delta (see below), present in `command-src/command-registry.json`
 *        (re-extracted by the producer; the pre-bump RED run reported ZERO
 *        `registry_stale` findings — round-trip byte-identical), and carried in
 *        the regenerated `guild.inventory.json` (23 commands).
 *
 * MODIFIED ENTRIES — no deletions, no renames, in either tree:
 *   commands/ (1 file):
 *   (M1) `commands/initiative.md` — the D8 close-gate paragraph now states that
 *        `initiative-gate.ts close-check` also verifies every path under
 *        `close_gate.evidence` and every work-item `evidence_refs` entry exists —
 *        a cited-but-absent artifact cannot pass close. Prose matching the
 *        shipped gate behavior; no dispatch change.
 *   skills/ (6 files, the A6C-accepted convergence delta):
 *   (M2) `skills/meta/context-assemble/SKILL.md`, `skills/meta/execute-plan/SKILL.md`,
 *        `skills/meta/execute-plan/dispatch.md`, `skills/meta/initiative/SKILL.md`,
 *        `skills/meta/team-compose/SKILL.md`, `skills/meta/verify-done/SKILL.md` —
 *        the settled convergence implementation reviewed and accepted by
 *        FIC-50/A6C on direct settled-byte evidence (composite 550a7327…).
 *        `skill-src/skill-registry.json` was re-extracted by the producers in the
 *        same delta; the pre-bump RED run reported ZERO `registry_stale` findings.
 *
 * MANIFESTS: `plugin.json`'s full delta is exactly ONE inserted line —
 * `commands[]` gains `"./commands/adopt.md"`. NO version change (the version
 * tolerance is not why the hash moves), no agent/skill declaration change.
 * `marketplace.json` is byte-untouched; its anchor is carried forward unchanged.
 *
 * Pins were computed AFTER the full pre-pin stability gate and re-verified
 * identical afterwards (a moving tree is never ratified): scratch esbuild parity
 * 21/21 hook bundles byte-identical to committed dist; `sync-module-resources
 * --check` + `sync-live-resources --check` clean (886 resources / 31 modules);
 * `guild.inventory.json` regeneration byte-identical + `check:claude-install`
 * PASS (SC-2 + SC-7b).
 *
 * ANTI-VACUITY: all FOUR pin suites (p2-w1-sc9, p2-w2-sc5, p2-w3-sc6,
 * check-surface-pins) were observed RED against the OLD pins on this exact tree
 * before this bump — exactly 8 failures, whose tree-delta diagnostics named
 * exactly the files enumerated above and NOTHING else (log preserved at the
 * umbrella run `artifacts/FIC-51-LANDING-RATIFICATION-A7/logs/red-before.log`).
 *
 * ── 2026-08-19 re-ratification (PCL-FU-09 researcher-only network defaults) ──
 * `skills` moves 2d3c295c → c69658a9. Exactly three deliberate skill files
 * change: `audit/SKILL.md` corrects the researcher template path;
 * `team-compose/SKILL.md` makes researcher the only default native-web role,
 * binds any exception to a recorded operator decision, and states that the 15
 * canonical scopes are runtime-materialized rather than fail-open prose; and
 * `team-compose/gap-handling.md` removes the stale architect/security web-tool
 * grants from the worked example. Their module-resource mirrors were generated
 * from these source files and verified byte-identical. Commands and both
 * manifests are unchanged. ANTI-VACUITY: SC-W2-5, SC-W3-6, and
 * check-surface-pins were observed RED against the old skills pin and named only
 * these three files before this bump.
 *
 * Re-ratified 2026-08-19 (PCL-FU-09 direct-subagent fail-closed follow-up) —
 * `skills` moves c69658a9 → d84cd87d. Independent review found the D5 bare
 * `subagent` rung still interpreted an omitted scope from prose even though the
 * typed backends materialized canonical defaults. `execute-plan/SKILL.md` and
 * `execute-plan/dispatch.md` now require the shipped deterministic resolver,
 * while `team-compose/gap-handling.md` removes the last "absent means no
 * scoping" claim. Round 3 then required the launcher-emitted, approval-checked
 * team path + digest and approval-bound capability-scope equality. Round 4
 * additionally binds participant id to role_ref, refuses duplicate ids,
 * rejects a symlinked .guild/team root, and makes the direct Agent rung env-only
 * rather than claiming the shared pathname writer closes its documented
 * concurrent ancestor-swap race.
 * `skill-src/skill-registry.json` was re-extracted and all module-resource
 * mirrors were generated from source. ANTI-VACUITY: check-surface-pins was
 * observed RED before each re-ratification. The Round-4 check reported exactly
 * `tree_pin_stale skills/skills` at d84cd87d and computed 9ccfd177.
 *
 * Re-ratified 2026-08-20 (PCL-FU-09 Round-5 carriage enforcement) — `skills`
 * moves 9ccfd177 → 5914b654. Independent review proved the direct Agent host
 * contract does not declare child-env carriage and that launcher-owned scope
 * files remained vulnerable to same-user pathname races. The deliberate surface
 * delta is exactly `execute-plan/SKILL.md` + `execute-plan/dispatch.md`: scoped
 * `agent`/`subagent` production dispatch now refuses until a verified host
 * capability exists; scoped dry runs are labeled non-dispatchable previews; and
 * cmux/tmux/remote carry scope only in the spawned process environment, never a
 * pathname backstop. Registry and module-resource mirrors were regenerated from
 * those sources. ANTI-VACUITY: check-surface-pins was observed RED against the
 * Round-4 pin and named only `tree_pin_stale skills/skills`, computing 5914b654.
 *
 * Re-ratified 2026-08-20 (PCL-FU-09 Round-6 frozen/direct consumer gate) —
 * `skills` moves 5914b654 → c1040a8a. Independent review found that the legacy
 * frozen `agent`/`subagent` launcher branch did not apply Round-5's refusal and
 * that the model-driven skill did not consume the launcher's allow/preview
 * decision before `Agent()`. The launcher now evaluates explicit and frozen
 * direct selections identically, and execute-plan requires the exact
 * `dispatchAllowed:true` / `previewOnly:false` tuple before any lane work.
 * Registry and module-resource mirrors were regenerated. ANTI-VACUITY:
 * check-surface-pins was observed RED against the Round-5 pin and named only
 * `tree_pin_stale skills/skills`, computing c1040a8a.
 *
 * Re-ratified 2026-08-20 (PCL-FU-09 Round-7 universal preview refusal) —
 * `skills` moves c1040a8a → 3096e445. Independent review reproduced an
 * unscoped custom-role `--dry-run` carrying the production authorization tuple.
 * Execute-plan and dispatch.md now state the invariant across all roles: every
 * direct preview is `dispatchAllowed:false` / `previewOnly:true`; only an
 * unscoped production signal can be `true` / `false`. Registry and mirrors were
 * regenerated. ANTI-VACUITY: check-surface-pins was observed RED against the
 * Round-6 pin and named only `tree_pin_stale skills/skills`, computing 3096e445.
 *
 * Re-ratified 2026-08-20 (PCL-FU-08 pure launcher previews) — `skills` moves
 * 3096e445 → 28af180d. Execute-plan now states the launcher-wide invariant:
 * every dry run is write-free, consumes no approval override, and must
 * re-present approval for a real dispatch. `skill-src/skill-registry.json` and
 * module-resource mirrors were regenerated. ANTI-VACUITY: the full cross-
 * cutting suite was observed RED against the Round-7 pin and named both the
 * stale execute-plan registry and `tree_pin_stale skills/skills`, computing
 * 28af180d.
 *
 * Re-ratified 2026-08-21 (PCL-FU-06 evidence-bound migration windows) —
 * `commands` moves b4695c3f → 8d443082. `commands/adopt.md` now documents the
 * attested beta-boundary, package-bound observation, and machine-derived
 * advance-conformance contracts instead of caller-supplied releases, times,
 * and booleans. `command-src/command-registry.json` was re-extracted in the
 * same commit. ANTI-VACUITY: the full cross-cutting suite was observed RED
 * against the prior pin and named only `commands/adopt.md`, the stale registry,
 * and `tree_pin_stale commands/commands`, computing 8d443082.
 *
 * Re-ratified 2026-08-21 after exact-head defensive review. `commands` moves
 * 8d443082 → c100f261 because `adopt.md` now states the online fail-closed
 * provenance dependency and the beta-only v4 migration boundary. The registry
 * was re-extracted byte-for-byte. This accompanies executable repairs for the
 * review's fail-open producer, GitHub-host pinning, persisted soak validation,
 * and transition recovery findings; it does not weaken any guard predicate.
 *
 * Re-ratified 2026-08-22 (PCL-FU-06 lifecycle-bound evidence completion) —
 * `commands` moves c100f261 → 9f85a488 and `skills` moves 28af180d →
 * 3dce0439. These are the deliberate beta.7 surfaces: `/guild:adopt` documents
 * v2 observation sealing/restart and `guild:learn` publishes the immutable
 * lifecycle-owned run-start baseline before compatibility work. The adopt
 * registry was re-extracted byte-for-byte; module mirrors were regenerated.
 * The beta.8 CI repair also narrows the legacy bare-restart detector to the
 * closed `capability-adopt window restart` vocabulary and makes its legacy-close
 * fixture use a production-valid run id. ANTI-VACUITY: PR #166 CI was RED
 * against the prior pins and named exactly `commands/adopt.md` and
 * `skills/knowledge/learn/SKILL.md` before these values were ratified.
 */
export const RATIFIED_TREES: Readonly<Record<string, string>> = Object.freeze({
  commands: "9f85a4882d919db6195b7a93d4c4290510309ab4",
  skills: "3dce04393e1538edbd0b9bf7b6a1460cb272bc77",
});

/** Version-stripped content hashes for the two release-tolerant manifests. */
export const RATIFIED_MANIFESTS: Readonly<Record<string, string>> = Object.freeze({
  ".claude-plugin/plugin.json": "ca3931c342966d58472b83f72861786c119ec393df5f1748ddc0e33c7bced8ae",
  ".claude-plugin/marketplace.json": "ad288b80dee07f85a94eee8b9c3e92b18705a94f98e104277a92b4d2e770e2af",
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

export const VERSION_EXEMPT_MANIFESTS = Object.freeze([
  ".claude-plugin/plugin.json",
  ".claude-plugin/marketplace.json",
] as const);

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
 * Cross-worker mutual exclusion for LIVE-TREE windows (FIC-48).
 *
 * SC-W2-5 and SC-W3-6 run in PARALLEL jest workers but share ONE live plugin
 * tree. An anti-vacuity control that perturbs-and-restores a tracked file races
 * every sibling that hashes (or perturbs) the same tree in that window: the
 * sibling's `before` hash captures the probe, the restore-time assertion then
 * sees a "moved" hash, and the guard false-fails with no residue on disk.
 * Each suite therefore perturbs its OWN victim tree (W2-5: commands, W3-6:
 * skills/.claude-plugin), and — because the strict zero-delta readers still
 * hash EVERY pinned tree — both the perturbation windows and those readers
 * take this exclusive lock, making the interleaving impossible rather than
 * merely unlikely.
 *
 * Mechanics: `mkdirSync` of one lock dir (atomic on POSIX + win32), keyed on
 * the resolved PLUGIN_ROOT so unrelated checkouts never contend. The wait spin
 * uses `Atomics.wait` (synchronous sleep, no busy loop). Wall-clock appears
 * ONLY in lock plumbing (stale-steal + timeout), never in an assertion.
 */
const LIVE_SURFACE_LOCK_DIR = path.join(
  os.tmpdir(),
  `guild-live-surface-${crypto.createHash("sha256").update(PLUGIN_ROOT).digest("hex").slice(0, 12)}.lockdir`
);

export function withLiveSurfaceLock<T>(fn: () => T): T {
  const deadline = Date.now() + 120_000;
  for (;;) {
    try {
      fs.mkdirSync(LIVE_SURFACE_LOCK_DIR);
      break; // acquired
    } catch {
      // Stale-steal: a worker killed mid-window leaves the dir behind; a lock
      // older than 60s cannot be a live perturbation window (each is sub-second).
      try {
        if (Date.now() - fs.statSync(LIVE_SURFACE_LOCK_DIR).mtimeMs > 60_000) {
          fs.rmdirSync(LIVE_SURFACE_LOCK_DIR);
          continue;
        }
      } catch {
        continue; // vanished between mkdir and stat — retry immediately
      }
      if (Date.now() > deadline) {
        throw new Error(
          `live-surface lock: timed out waiting on ${LIVE_SURFACE_LOCK_DIR} — a sibling worker held its perturbation window > 120s`
        );
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    }
  }
  try {
    return fn();
  } finally {
    try {
      fs.rmdirSync(LIVE_SURFACE_LOCK_DIR);
    } catch {
      // already reclaimed by a stale-steal — nothing to release
    }
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
