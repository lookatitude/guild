# Definition ledger — cross-host-release-distribution

```yaml
items:
  - id: xhrd-def-goal
    initiative_id: cross-host-release-distribution
    category: goal
    statement: "REVISED after G1 — make a Guild release reach every host in the 16-host registry, not just Claude Code: one version source-of-truth with a drift gate, REMOTE registration for the hosts that support it (codex-cli/pi-cli/antigravity-cli, currently wired to local paths), a host-neutral staleness signal, a working per-host update command, and channel-integrity enforcement. NOT a per-host publish matrix — G1 verified Codex installs 2.3.2 from the repo today."
    status: defined
    blocking: true
    evidence_refs:
      - "~/.codex/plugins/cache/guild/guild/2.2.0/.codex-plugin/plugin.json (pinned 2.2.0)"
      - "origin/main .claude-plugin/plugin.json = 2.3.2; tags v2.3.0/v2.3.1/v2.3.2"
    updated_at: "2026-07-25T20:11:58Z"

  - id: xhrd-def-outcome
    initiative_id: cross-host-release-distribution
    category: outcome
    statement: "REVISED after G1 — after a release lands: every host manifest carries the released version (generated, drift-gated); the remote-capable hosts are registered against a moving ref rather than a rendered local path; every host surfaces a staleness signal naming installed/latest/channel + its own update command; and a validation release is observed reaching each host in the matrix (or an explicit per-host carve-out + filed followup is recorded)."
    status: defined
    blocking: true
    updated_at: "2026-07-25T20:11:58Z"

  - id: xhrd-def-scope
    initiative_id: cross-host-release-distribution
    category: scope
    statement: "Plugin repo: .github/workflows/release.yml + branch-policy.yml, install.sh (receipts, --update, host classification), scripts/build-host-packages.ts + build-inventory.ts, scripts/lib/update-check.ts + self-update.ts + host-registry rows, hooks/update-check.ts + the generated per-host hook manifests (codex-hooks.json et al), .claude-plugin/{plugin,marketplace}.json, scripts/release-changelog.ts. Umbrella: docs/v2 distribution/release pages + .guild/wiki/standards/release-discipline.md (D8 docs leg). All 16 registry hosts are in scope."
    status: defined
    blocking: true
    updated_at: "2026-07-25T20:11:58Z"

  - id: xhrd-def-nongoal-1
    initiative_id: cross-host-release-distribution
    category: non_goal
    statement: "NOT changing the two-channel model (main=stable, next=beta) or the release-PR shape — release-discipline rules 1-7 stand; only rule 8's SYNC-BACK clause gains enforcement (G6), plus the merge-commit-only clause for release PRs the lane's forensics justified: squash AND Rebase-and-merge both rewrite SHAs, so either destroys the ancestry the fast-forward sync-back depends on."
    status: defined
    blocking: false
    updated_at: "2026-07-25T20:11:58Z"

  - id: xhrd-def-nongoal-2
    initiative_id: cross-host-release-distribution
    category: non_goal
    statement: "NOT committing dist/ — it stays gitignored and CI-regenerated. If any versioned host package ships, it attaches as a GitHub Release ASSET, never tracked in git. After G1 such assets are OPTIONAL and only for genuinely file-surface hosts."
    status: defined
    blocking: false
    updated_at: "2026-07-25T20:11:58Z"

  - id: xhrd-def-nongoal-3
    initiative_id: cross-host-release-distribution
    category: non_goal
    statement: "NOT reclassifying the four REFUSE app/connector surfaces (claude-code-app, claude-code-web, codex-app, claude-ai-connector) into installer targets. G1 may find the Codex plugin surface belongs to a host-native install path — the fix is to make that path updatable, not to make install.sh write into an app surface it deliberately refuses (AC-INS-5 / security S-M3 stand)."
    status: defined
    blocking: false
    updated_at: "2026-07-25T20:11:58Z"

  - id: xhrd-def-nongoal-4
    initiative_id: cross-host-release-distribution
    category: non_goal
    statement: "NOT auto-updating any host without consent. The staleness signal INFORMS; the update stays operator-invoked. Silent multi-host writes remain prohibited."
    status: defined
    blocking: false
    updated_at: "2026-07-25T20:11:58Z"

  - id: xhrd-def-acceptance-1
    initiative_id: cross-host-release-distribution
    category: acceptance
    statement: "A host distribution matrix exists, is checked in, and states for each of the 16 registry hosts: install path, version-resolution mechanism, who publishes a new version, the update command, and whether a staleness signal is reachable. Every row is empirically verified or explicitly marked UNVERIFIED with the blocker."
    status: defined
    blocking: true
    updated_at: "2026-07-25T20:11:58Z"

  - id: xhrd-def-acceptance-2
    initiative_id: cross-host-release-distribution
    category: acceptance
    statement: "A CI gate fails any release whose generated host manifests disagree with the single version SoT — proven red-first with a deliberately skewed manifest fixture."
    status: defined
    blocking: true
    updated_at: "2026-07-25T20:11:58Z"

  - id: xhrd-def-acceptance-3
    initiative_id: cross-host-release-distribution
    category: acceptance
    statement: "REVISED after G1 — install.sh + README register the remote-capable hosts (codex-cli verified; pi-cli/antigravity-cli evaluated) against a remote/git source rather than a rendered local path, WITHOUT breaking install.sh:428's checkout-is-source development path. Proven with a checkout-path regression. No per-host publish leg is built: G1 verified Codex installs 2.3.2 from the repo today."
    status: defined
    blocking: true
    updated_at: "2026-07-25T20:11:58Z"

  - id: xhrd-def-acceptance-4
    initiative_id: cross-host-release-distribution
    category: acceptance
    statement: "A Codex session on a stale install surfaces a staleness signal naming installed version, latest version, channel, and the exact Codex update command — verified on a live Codex host, not inferred."
    status: defined
    blocking: true
    updated_at: "2026-07-25T20:11:58Z"

  - id: xhrd-def-acceptance-5
    initiative_id: cross-host-release-distribution
    category: acceptance
    statement: "A validation release is cut and observed reaching every host in the matrix (or the un-reached hosts are documented with a filed followup issue naming the external blocker). The initiative does NOT close on code review alone — release_status must be released_in."
    status: defined
    blocking: true
    updated_at: "2026-07-25T20:11:58Z"

  - id: xhrd-def-acceptance-6
    initiative_id: cross-host-release-distribution
    category: acceptance
    statement: "A CI check fails when origin/next's version trails origin/main's, and the missing v2.3.2 sync-back is backfilled so next is no longer behind stable."
    status: defined
    blocking: true
    updated_at: "2026-07-25T20:11:58Z"

  - id: xhrd-def-constraint-1
    initiative_id: cross-host-release-distribution
    category: constraint
    statement: "REVISED after G1 — no verified host requires an external registry submission (Codex reads the repo directly; pi/antigravity accept git/npm sources). This constraint now applies only IF one of the four UNVERIFIED hosts (cursor/github-copilot/opencode/rovo-dev) turns out to need one: then the deliverable is an explicit documented manual step + a release-checklist gate, never a silently-skipped leg."
    status: defined
    blocking: true
    updated_at: "2026-07-25T20:11:58Z"

  - id: xhrd-def-constraint-2
    initiative_id: cross-host-release-distribution
    category: constraint
    statement: "Self-build rules apply: PRs target next; codex adversarial review per lane; red-test-first for every defect-class item; hooks edits require `cd hooks && npm run build` with the rebuilt dist committed; skills/commands edits require in-commit registry re-extraction + live-surface pin re-ratification."
    status: defined
    blocking: true
    updated_at: "2026-07-25T20:11:58Z"

  - id: xhrd-def-constraint-3
    initiative_id: cross-host-release-distribution
    category: constraint
    statement: "Any publish credential (registry token, submission key) is a repo SECRET — never inlined in a workflow, never written into a receipt, never echoed into a release log. security-auditor reviews the publish leg before it merges."
    status: defined
    blocking: true
    updated_at: "2026-07-25T20:11:58Z"

  - id: xhrd-def-risk-1
    initiative_id: cross-host-release-distribution
    category: risk
    statement: "REVISED after G1 — the original risk (an external publish queue blocking releases) is largely moot: no external registry submission is required for any verified host. The live risk is now that switching install.sh to remote registration breaks the CHECKOUT development path (install.sh:428 treats a working tree as the source) or strands users whose channel cannot be re-pointed in place (`marketplace remove` + `add` is required). Mitigation: checkout-path regression test + an explicit documented channel-switch procedure."
    status: defined
    blocking: false
    updated_at: "2026-07-25T20:11:58Z"

  - id: xhrd-def-risk-2
    initiative_id: cross-host-release-distribution
    category: risk
    statement: "Collapsing to a single version SoT touches guild.inventory.json, the two .claude-plugin manifests, and the generated per-host manifests simultaneously — high blast radius against existing live-surface guards (p2-w2-sc5 / p2-w3-sc6) and the byte-equivalence gates (SC-2). Mitigation: land G2 as its own serialized lane with the drift gate red-first, and re-run the full determinism/equivalence suites before merge."
    status: defined
    blocking: false
    updated_at: "2026-07-25T20:11:58Z"

  - id: xhrd-def-risk-3
    initiative_id: cross-host-release-distribution
    category: risk
    statement: "A staleness signal wired into every host's session surface is a per-session network/cache cost on 16 hosts. Mitigation: honor the existing ~/.guild/update-check.json cache TTL, degrade silently offline, and never block a session on the check."
    status: defined
    blocking: false
    updated_at: "2026-07-25T20:11:58Z"

  - id: xhrd-def-assumption-1
    initiative_id: cross-host-release-distribution
    category: assumption
    statement: "CONFIRMED and extended by G1: Codex caches by semver under ~/.codex/plugins/cache/<pkg>/<name>/<semver>/, resolving the version from the marketplace it is registered against. A GIT marketplace is supported and refreshable (`marketplace upgrade`); a LOCAL one is not. A tag ref correctly stays pinned. UNVERIFIED residue: whether an INSTALLED plugin moves when a BRANCH ref advances (untestable offline — Codex rejects local/bare/file:// git sources)."
    status: defined
    blocking: false
    updated_at: "2026-07-25T20:11:58Z"

  - id: xhrd-def-openq-1
    initiative_id: cross-host-release-distribution
    category: open_question
    statement: "RESOLVED by G1 (2026-07-25): it was NEVER published. install.sh registered a `local` Codex marketplace pointing into a gitignored dist/codex-marketplace; `marketplace upgrade` refuses a local source. Publishing 2.3.2 requires NO publish step — `codex plugin marketplace add lookatitude/guild --ref main` + `codex plugin add guild@guild` installs it today."
    status: defined
    blocking: false
    owner: wi-01
    updated_at: "2026-07-25T20:11:58Z"

  - id: xhrd-def-openq-3
    initiative_id: cross-host-release-distribution
    category: open_question
    statement: "Does an INSTALLED Codex plugin move to a newer version when its branch ref advances? G1 proved fresh-install parity and that `marketplace upgrade` refreshes a git snapshot, but never observed an installed plugin changing version; host-capabilities-schema.ts marks codex-cli auto_capable: false. Untestable offline (Codex rejects local/bare/file:// git sources). Re-test trigger: install from --ref next BEFORE G6's v2.3.2 sync-back, then `marketplace upgrade` + `plugin add` after. Blocks final G4/G5 acceptance."
    status: needs_definition
    blocking: false
    owner: wi-05
    evidence_refs: [".guild/wiki/standards/host-distribution-matrix.md §The finding"]
    updated_at: "2026-07-25T21:10:00Z"

  - id: xhrd-def-openq-2
    initiative_id: cross-host-release-distribution
    category: open_question
    statement: "PARTIALLY RESOLVED by G1 (2026-07-25). pi accepts npm:/git:/https/ssh sources; antigravity accepts plugin@marketplace + link — both unused by Guild. kiro/qoder/trae are agents-file file surfaces (question n/a). STILL OPEN for cursor/github-copilot/opencode/rovo-dev — not installable on the G1 machine; install.sh:586's \"no native plugin manager\" is a source comment, not host evidence. Blocks final G3/G4/G5 acceptance and the validation release."
    status: needs_definition
    blocking: false
    owner: wi-01
    updated_at: "2026-07-25T20:11:58Z"
```

## G1 reconciliation (2026-07-25)

`xhrd-def-openq-1` **closed**, `xhrd-def-assumption-1` **confirmed + extended**,
`xhrd-def-acceptance-3` and `xhrd-def-risk-1` **rewritten** — all four had
encoded the thesis G1 refuted. `xhrd-def-openq-2` narrowed to four hosts;
`xhrd-def-openq-3` added for the Codex upgrade-propagation residue. The two
remaining `needs_definition` rows stay **non-blocking for execution** but block
final G3/G4/G5 acceptance and the validation release.

## Definition-ready gate

`blockingUnresolved(items)` is **empty** — every `blocking: true` item is
`defined`. The two `open_question` rows are `needs_definition` but
**non-blocking by design**: they are the deliverable of `wi-01`, not a
precondition for starting it. `definition_status: complete`, `status: ready`.

Operator answers folded in at `new` (2026-07-25):

- **Host scope** → all 16 registry hosts (not Codex-only). The defect is
  structural; Codex is the first proof case.
- **Codex publish path** → unconfirmed ("I think it was via github but not
  sure") ⇒ recorded as `xhrd-def-openq-1` + `xhrd-def-assumption-1` and made
  work-item #1, rather than assumed into the design.
