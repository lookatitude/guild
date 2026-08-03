# Goals — cross-host-release-distribution

> Opened 2026-07-25 from an operator report: the Codex app is running Guild
> **2.2.0** while stable shipped **2.3.2**. Root-cause mechanism verified
> on-machine before this initiative was opened (see §Evidence).

## The problem in one line

> **Revised 2026-07-25 after G1.** The opening thesis was *"a Guild release
> reaches exactly one host; every other host has no publish path."* **G1 refuted
> it.** Codex, pi, and antigravity all accept remote/git sources. Canonical
> statement of the corrected finding:
> [`.guild/wiki/standards/host-distribution-matrix.md`](../../../wiki/standards/host-distribution-matrix.md).

**Guild wires remote-capable hosts to local snapshots.** For the three hosts
whose plugin managers accept a remote source — `codex-cli`, `pi-cli`,
`antigravity-cli` — `install.sh` renders `dist/` and registers a **local
filesystem path** anyway, and the README documents that frozen path as official.
Hosts that could track a moving ref are pinned to a build directory instead.
Separately, and across *all* hosts except `claude-code-cli`, nothing tells the
user they are stale.

## Evidence (verified 2026-07-25; G1 corrections marked)

| Fact | Where |
|---|---|
| **Codex already installs from git today**: `codex plugin marketplace add lookatitude/guild --ref main` + `codex plugin add guild@guild` → **2.3.2**, no Guild change | isolated `CODEX_HOME` probe (G1) |
| Guild's registered Codex marketplace is `source_type = "local"` into a **gitignored** `dist/` | `~/.codex/config.toml [marketplaces.guild]` |
| `codex plugin marketplace upgrade` **refuses** a local source (git-only) | probe: ``marketplace `guild` is not configured as a Git marketplace`` |
| Codex pinned at 2.2.0 in a semver-directory cache | `~/.codex/plugins/cache/guild/guild/2.2.0/` |
| `pi` accepts `npm:` · `git:` · `https://` · `ssh://`; Guild passes a local path | `pi install --help` vs `install.sh:545` |
| `agy` accepts `plugin@marketplace` + `link`; Guild passes a local path | `agy plugin --help` vs `install.sh:561` |
| Stable is 2.3.2; tags v2.3.0/v2.3.1/v2.3.2 published **on the remote** | `git show origin/main:.claude-plugin/plugin.json`; `git ls-remote --tags origin` |
| Generated `hooks/codex-hooks.json` wires **only** `UserPromptSubmit` — no SessionStart counterpart to `hooks/update-check.ts` | codex package vs `hooks/hooks.json:16` |
| `~/.guild/receipts/` does not exist on the reporting machine ⇒ `install.sh --update` and `guild-run update` have nothing to act on | `install.sh:479` (receipts written by the installer only) |
| `plugin_version_from` reads the **Claude** manifest for every host's receipt | `install.sh:473` (defined), `:483` (called) |
| `install.sh` recognizes `codex-app` as REFUSE and exits 4 | `is_refuse_host` `install.sh:151`; refuse block `install.sh:320-336` |
| …yet the app runs Guild anyway. **Inferred, not proven**: from the operator's report (2.2.0 in the app) + the CLI-written `~/.codex/` state + the deep link install.sh prints for it. No app run was observed. | operator report; `install.sh:534`; see matrix `codex-app` row (marked **S**) |
| `origin/next` = **2.3.1** while `origin/main` = **2.3.2** ⇒ the rule-8 sync-back for v2.3.2 never landed | `git show origin/next:.claude-plugin/plugin.json` |

**Superseded by G1** — do not act on these: *"release.yml has no per-host publish
leg, therefore build one"* and *"dist/ is gitignored, therefore attach a
versioned host package to every Release."* Both were true observations feeding a
false conclusion; Codex needs no publish infrastructure. A Release artifact
remains **optional** and only for genuinely file-surface hosts.

## Scope decision

**All 16 registry hosts** (operator-confirmed), not Codex-only. But the hosts do
**not** share one defect — G1 established five distinct situations covering all
16:

| Situation | Hosts | Count | What G2–G5 owe it |
|---|---|---|---|
| **Already remote-capable and correctly wired** | `claude-code-cli` | 1 | nothing on registration (README path is already a git ref); note that `install.sh:504` *also* offers a local path |
| **Remote-capable, wired local** | `codex-cli`, `pi-cli`, `antigravity-cli` | 3 | fix the registration; no new infrastructure |
| **File-surface, genuinely snapshot-only** | `agents-file`, `kiro`, `qoder`, `trae` | 4 | `install.sh --update` + re-copy is the honest contract; a Release artifact is optional here and only here |
| **Unknown contract** | `cursor`, `github-copilot`, `opencode`, `rovo-dev` | 4 | resolve or explicitly carve out — `install.sh:586`'s "no native plugin manager" is a source comment, not host evidence |
| **Refused surfaces** | `claude-code-app`, `claude-code-web`, `codex-app`, `claude-ai-connector` | 4 | stay refused (`install.sh:320-336`); but `codex-app` inherits `codex-cli`'s registration in practice, so fixing the CLI fixes it |

---

## G1 — Host distribution contract discovery *(gating)*

Determine, **empirically**, per host class:

- how Guild is installed (git-ref marketplace · pinned-semver plugin cache ·
  installer snapshot copy · agents-file bind),
- how it resolves a version,
- **who publishes** a new version and through what mechanism,
- the update command,
- whether a staleness signal can reach it.

Codex is the proof case. **RESOLVED by G1:** 2.2.0 was never published —
`install.sh` registered a `local` marketplace into a gitignored `dist/`.
Publishing 2.3.2 requires no publish step at all: the repo already works as a
git Codex marketplace (`xhrd-def-openq-1` closed).

**Deliverable:** a checked-in host distribution matrix. Every row is either
empirically verified or explicitly `UNVERIFIED` with its blocker named. G3 and
G5 are written against this matrix.

## G2 — Single version source-of-truth

Today the version is hand-bumped in `.claude-plugin/plugin.json` **and**
`marketplace.json`, then re-derived into `guild.inventory.json`,
`dist/codex/.codex-plugin/plugin.json`, and each `dist/<host>/<host>-manifest.json`.
Four+ places, one hand edit.

Collapse to **one** canonical version field with every host manifest generated
from it, plus a **CI drift gate** that fails a release whose host manifests
disagree with the SoT. Red-first with a deliberately skewed manifest fixture.

**Serialize this lane** — it touches the two `.claude-plugin` manifests, the
inventory, and the generated per-host manifests at once, against the live-surface
guards (`p2-w2-sc5`/`p2-w3-sc6`) and the SC-2 byte-equivalence gate.

## G3 — Remote-registration switch *(REVISED 2026-07-25 after G1)*

> **This goal was rewritten.** The original text ("build a per-host publish leg;
> attach a versioned artifact per host; fail loud on any unpublished host") rested
> on the thesis that non-Claude hosts *cannot* pull a released version. G1 refuted
> that: `codex plugin marketplace add lookatitude/guild --ref main` +
> `codex plugin add guild@guild` installs **2.3.2 today**, from the public repo,
> with no Guild change. The original text is preserved in git history; do not
> implement it.

The real defect is that `install.sh` and the README steer the three
**remote-capable** hosts (`codex-cli`, `pi-cli`, `antigravity-cli`) to a local
rendered path anyway. File-surface hosts are legitimately snapshot-based; this
goal does not apply to them.

1. Switch Codex registration to the repo's git marketplace
   (`--ref main` = stable, `--ref next` = beta). Channel changes require
   `marketplace remove` + `add` — an in-place re-add is rejected.
2. Evaluate the same switch for `pi` (`git:`/`npm:` sources) and `antigravity`
   (`plugin@marketplace`); adopt, or record why not.
3. **Preserve the development path.** `install.sh:428` deliberately treats a
   checkout's working tree as the source. The remote switch applies to *fetched*
   stable/beta installs only, proven with a checkout-path regression.
4. A versioned per-host GitHub Release artifact is **optional**, justified per
   host, and warranted only for genuinely file-surface hosts (`agents-file`,
   `kiro`, `qoder`, `trae`). It is not forced by the evidence.

`dist/` stays gitignored (`xhrd-def-nongoal-2`). Any publish credential is a
repo secret, reviewed by security-auditor before merge.

## G4 — Host-neutral staleness signal

The semantics in `hooks/update-check.ts` + `scripts/lib/update-check.ts`
(installed-semver vs latest-tag for stable, SHA staleness for beta, cached at
`~/.guild/update-check.json`) currently reach **only** Claude Code's
SessionStart.

Port them to every host: hook-capable hosts get a SessionStart-equivalent
wiring (Codex's generated hook manifest wires only `UserPromptSubmit` today);
hook-less hosts get an agents-file/preamble fallback.

The signal must name **installed version · latest version · channel · the exact
update command for that host**. Honor the existing cache TTL, degrade silently
offline, never block a session (`xhrd-def-risk-3`).

**Verification is live**: a stale Codex session must actually show the signal —
inference does not count.

## G5 — Update-path parity

- Every install path writes a `guild.install_receipt.v1` receipt — including
  host-native plugin installs the installer never ran (the reporting machine
  has Guild on Codex and **zero** receipts).
- `install.sh --update` either discovers and refreshes non-installer-managed
  hosts, or refuses with a **host-specific** instruction — never a bare "no
  receipts found".
- Each of the 16 registry hosts has a documented, tested update command.

Constraint: the four REFUSE app/connector surfaces stay refused. Making a
host-native install path *updatable* is in scope; making `install.sh` write into
an app surface it deliberately refuses is not (`xhrd-def-nongoal-3`).

## G6 — Channel-integrity enforcement

Mechanize release-discipline **rule 8**'s sync-back clause (rule 4 in the
standard is documentation completeness): a release is not complete until `next`
has been advanced to the release point — by **fast-forward** when ancestry
allows, otherwise by a **delta-copy sync-back PR**. Add a CI check that fails when
`origin/next`'s version trails `origin/main`'s, and **backfill the missing
v2.3.2 sync-back** so beta stops trailing stable.

Two findings from the lane, both verified: the divergence was caused by
**squash-merging** release PR #96 (single-parent commit ⇒ ancestry destroyed),
not by `next` moving — and **Rebase-and-merge rewrites SHAs too**, so only a
MERGE COMMIT keeps the fast-forward sync-back possible. The gate also only
**detects**; `release.yml` publishes on the merged-PR event, so putting the
check on the release path is a followup.

---

## Sequencing

```
G1 (gating, alone) ─┬─> G3 (needs G1 + G2)
                    ├─> G4 (needs G1 + G2)  ──> G5 (needs G1 + G4)
G2 (serialized) ────┘
G6 (independent, parallel from day 1)
```

- **G1** runs first and alone — G3's publish step and G5's receipt design both
  depend on its findings.
- **G2** and **G6** are independent starters, parallel with G1.
- **G3**/**G4** open once G1's matrix is drafted and G2's SoT is trustworthy.
- **G5** last — the signal must be able to name a real update command.
- **Close on a validation release**, not on code review: cut a version and
  observe it reaching every host in the matrix. `release_status` must reach
  `released_in` (`xhrd-def-acceptance-5`).

## Carried-forward unknowns from G1

G1 closed with two explicit UNVERIFIED items. Neither blocks G2 or the
shared/verified-host work; **both block final G3/G4/G5 acceptance and the
validation release**:

1. **Four host contracts unknown** — `cursor`, `github-copilot`, `opencode`,
   `rovo-dev` were not available. `install.sh:586`'s "no native plugin manager"
   comment is a source assertion, not host evidence. Install and exercise them,
   or close with a documented per-host carve-out + filed followup.
2. **Codex upgrade propagation unverified** — fresh-install parity is proven;
   an *installed* plugin moving when its branch ref advances is not, and
   `host-capabilities-schema.ts` marks `codex-cli` `auto_capable: false`.
   Re-test trigger: install from `--ref next` before G6's v2.3.2 sync-back, then
   `marketplace upgrade` + `plugin add` after, and record whether it moves.

## Close-gate (D8) notes

- **Exec leg:** all six work items done.
- **Release leg:** validation release cut and observed per-host.
- **Docs leg:** `docs/v2` distribution/release pages,
  `.guild/wiki/standards/release-discipline.md`, and the README/install docs
  reconciled to shipped reality in the same rollout.
