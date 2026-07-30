---
type: standard
owner: plugin-engineer
confidence: high
importance: high
source_refs:
  - plugin/install.sh
  - plugin/scripts/build-host-packages.ts
  - plugin/scripts/guild-run.ts
  - plugin/scripts/lib/self-update.ts
  - plugin/src/modules/host-runtime/workflows/host-capabilities-schema.ts
  - plugin/src/modules/host-runtime/workflows/host-registry-schema.ts
  - plugin/.github/workflows/release.yml
  - plugin/hooks/hooks.json
  - plugin/README.md
created_at: 2026-07-25
updated_at: 2026-07-25
sensitivity: internal
---

# Host distribution matrix

How a released Guild version reaches each of the 16 registry hosts — what the
host *supports*, what Guild *currently does*, and the gap between them.

Produced by `xhrd-wi-01` (initiative `cross-host-release-distribution`, G1).
G2–G5 are designed against this page.

Companion: [release-discipline](release-discipline.md) — that page covers how a
change reaches a *channel branch*; this one covers how a channel branch reaches
a *host*.

## The finding

The original hypothesis — "only Claude Code has an update channel, the others
need publish infrastructure built" — is **wrong**, and was refuted empirically
during review.

**Codex already supports git-marketplace distribution, and Guild is not using
it.** Verified on 2026-07-25 in an isolated `CODEX_HOME`, against the public
repo, with no changes to Guild:

```console
$ codex plugin marketplace add lookatitude/guild --ref main
Added marketplace `guild` from https://github.<HIGH_ENTROPY_REDACTED>.git#main.

$ codex plugin add guild@guild
Installed plugin root: …<HIGH_ENTROPY_REDACTED>.3.2

$ codex plugin marketplace upgrade
Upgraded 1 marketplace(s).

$ codex plugin list
guild@guild  installed, enabled  2.3.2
```

Codex discovers the repo's existing `.claude-plugin/marketplace.json`, records
`source_type = "git"` + `ref = "main"`, and `marketplace upgrade` refreshes the
snapshot. That is structurally the model Claude Code uses.

**Parity is proven for fresh install, NOT for upgrade propagation.** What the
probes establish and what they do not:

| Behavior | Status |
|---|---|
| Fresh install from a git ref resolves the ref's version | **Verified** — `--ref main` → 2.3.2, `--ref v2.3.0` → 2.3.0 |
| `marketplace upgrade` succeeds on a git source | **Verified** — "Upgraded 1 marketplace(s)" |
| `marketplace upgrade` fails on a local source | **Verified** — ``marketplace `guild` is not configured as a Git marketplace`` |
| A pinned **tag** ref stays pinned across `upgrade` | **Verified** — 2.3.0 stayed 2.3.0 (correct behavior) |
| A marketplace's ref can be re-pointed in place | **Verified FALSE** — `Error: marketplace 'guild' is already added from a different source; remove it before adding this source`. Switching channel requires `marketplace remove` + `add`. |
| An **installed** plugin moves to a newer version when its **branch** ref advances | **Verified — YES** (probe run 2026-07-27, v2.4.0 cut). `marketplace upgrade` ALONE moved the reported installed version 2.3.2 → 2.4.0; `plugin list` read 2.4.0 *before* any `plugin add`. |

**Probe record (closes the row).** The durable probe at
`~/.guild/probes/codex-propagation` was installed from `--ref next` at 2.3.2
*before* the v2.4.0 cut, then exercised after it with the
list-BETWEEN-upgrade-and-add ordering:

1. `codex plugin marketplace upgrade guild` → "Upgraded … to the latest
   configured revision."
2. `codex plugin list` → **`guild@guild installed, enabled 2.4.0`** — the
   upgrade alone refreshed the marketplace checkout AND the reported version.
3. `codex plugin add guild@guild` → materialized the version-keyed cache payload
   `<HIGH_ENTROPY_REDACTED>.4.0/` (full tree incl. `.codex-plugin/`). Only
   the 2.4.0 version dir remained afterwards.
4. `codex plugin list` → still 2.4.0.

So the native git-source update recipe is the two-step
`codex plugin marketplace upgrade guild && codex plugin add guild@guild`:
`upgrade` moves the checkout + reported version, `add` materializes the
version-keyed cache. Guild's capability row for `codex-cli` stays
`auto_capable: false` and `apply: reinstall_command` (option A, operator
decision 2026-07-26) — the reason is now purely that Codex owns its manager
state, no longer any propagation uncertainty.

So the real defect is **not** missing infrastructure:

> `install.sh` renders `dist/` and registers a **local filesystem path** on the
> three hosts whose plugin managers would accept a **git or remote source** —
> `codex-cli`, `pi-cli`, `antigravity-cli`. It converts updatable channels into
> frozen snapshots, and the README documents the frozen path as the official one.

Scope that claim precisely — it does **not** apply to all 16 hosts:

- `claude-code-cli` already has a git-ref path documented as primary (README:108,121),
  though `install.sh:504` offers a local path too;
- the four file-surface hosts (`agents-file`, `kiro`, `qoder`, `trae`) are
  legitimately snapshot-based — there is no remote source to lose;
- the four refused surfaces get no payload at all (install.sh:320-336);
- the four unknown hosts (`cursor`, `github-copilot`, `opencode`, `rovo-dev`)
  may or may not have a remote source — untested, so unclaimed.

A separate defect spanned all hosts but `claude-code-cli` at the time of this
page's G1 snapshot: none had a staleness signal. **CLOSED since:** Codex gained
a SessionStart signal (#102), wrapper hosts always had the `guild-run` launch
notice, and the file-surface trees now ship `update-check.js` with an AGENTS.md
session-start preamble (wi-04 close-out). The per-row "Staleness signal"
columns below describe the G1 snapshot; see the wi-04/wi-05 close-out for
current state.

Guild's own Codex registration is the symptom:

```toml
# ~/.codex/[REDACTED] — the reporting machine
[marketplaces.guild]
last_updated = "2026-07-05T01:57:27Z"
source_type = "local"
source = "<HIGH_ENTROPY_REDACTED>-marketplace"
```

`dist/` is gitignored, so that root is a build artifact on one machine. A
`local` source is not refreshed by `codex plugin marketplace upgrade` (it errors
with ``marketplace `guild` is not configured as a Git marketplace``). Hence
2.2.0 in July while stable shipped 2.3.2.

### Immediate operator fix (no code change required)

```bash
codex plugin marketplace remove guild
codex plugin marketplace add lookatitude/guild --ref main   # or --ref next for beta
codex plugin add guild@guild
```

## Two questions per host, not one

The taxonomy that matters is the **gap** between host capability and Guild's
current wiring. Classes below describe *what Guild does today*; the
"host supports" column describes *what is available*.

| Class | What Guild does today | Updatable? |
|---|---|---|
| **A — remote ref** | registers a git ref; host's `marketplace update`/`upgrade` re-fetches the snapshot | **Explicitly updatable** — an operator command refreshes it. Whether an *installed* plugin then moves to the new version is host-dependent and **unverified for Codex** (see the behavior table above). Not "automatic". |
| **B — local path** | registers a filesystem path into a rendered `dist/` tree | **Not by the host's own refresh** — `marketplace upgrade` rejects a local source outright. Guild-side paths still exist for an INSTALLER-MANAGED install: `install.sh --update` re-renders and reinstalls from the receipt, and the registry-canonical command is `install.sh --update` (option A, 2026-07-26: codex-cli is `reinstall_command`, never `self_update` — Codex owns its installed cache). A registration the installer did not create (hand-run `codex plugin marketplace add`) has no machine receipt; `--update` DETECTS it and advises, and the session-start check mints an identification-only package receipt. |
| **C — rendered tree** | leaves a `dist/<host>/` tree. Wrapper-package hosts re-render via `guild-run update`; **file-surface** hosts (`agents-file`, `kiro`, `qoder`, `trae`) are refused it and told their real command instead — the AC-7 honesty guard in `self-update.ts:104-113` rejects any host whose capability row is not `apply: "self_update"` | Only on an explicit update command — and **which** command differs *within* the class |
| **D — refused** | recognized by `is_refuse_host` (install.sh:151); the refuse block at install.sh:320-336 collects them and `exit 4`s | n/a |

## The matrix

Evidence column: **V** = executed on this machine 2026-07-25. **S** = verified by
reading Guild's source (proves what Guild *intends to run*, not that the host
accepted it). **U** = unverified, blocker named.

Marking discipline: a row is **V** only where the host binary was present and
the path was actually exercised. `HOST_REGISTRY_ROWS.provenance` marks 10 of 16
rows `inferred` (`host-registry-schema.ts` — issue #110 flipped github-copilot
+ opencode to `verified` after the on-box #104 pass); this table does not claim
more than the registry does.

| Host | Class | Host supports | Guild's install path | Version resolution | Publish mechanism | Update command | Staleness signal | Ev |
|---|---|---|---|---|---|---|---|---|
| `claude-code-cli` | A *(README)* / B *(install.sh)* | git ref **and** local path | README:108,121 → `claude plugin marketplace add lookatitude/guild[@next]`; **but** install.sh:504 registers `$RENDERED_DIST/claude-code`, a local path | git ref, or local snapshot via install.sh | git push to `main`/`next` | **`claude plugin marketplace update guild && claude plugin update guild@guild`** — the canonical pair per `UPDATE_COMMANDS.marketplace_cli` (`host-capabilities-schema.ts:94`, wired at `:282`, `auto_capable: true`). Refreshing the marketplace alone does NOT move the installed plugin; that second command is not optional, and this page records no live proof that the first alone suffices. | **Yes** — `hooks/hooks.json:16` `SessionStart` → `update-check.js` | V |
| `codex-cli` | B *(as wired)* — A *available today* | **git ref, verified working** (`--ref main` → 2.3.2) **and** local path | install.sh:526 registers `$RENDERED_DIST/codex-marketplace` (local); README:167 documents the same | pinned semver dir `<HIGH_ENTROPY_REDACTED><v>/`; version from `.codex-plugin/plugin.json` (local) or `.claude-plugin/marketplace.json` (git) | git push — **already works, unused** | **git source:** `codex plugin marketplace upgrade && codex plugin add guild@guild` (propagation VERIFIED 2026-07-27 — see the probe record in the behavior table: `upgrade` alone moves the reported version, `add` materializes the version-keyed cache). **local source:** `marketplace upgrade` **fails** (not a Git marketplace); a re-`codex plugin add` re-resolves. **Guild-side (option A, operator decision 2026-07-26):** `install.sh --update` — the registry-canonical command (`UPDATE_COMMANDS.reinstall_command`; codex-cli is deliberately NOT `self_update`, because Codex owns the installed cache and a Guild-side swap would mutate manager state behind `codex plugin list`'s back). It reinstalls from the receipt (install.sh:212 consumes receipts, :529 writes the codex one). Its per-receipt-channel re-render applies to the **no-checkout/fetched** path only — run from a checkout, the working tree is the source and the channel is ignored (install.sh:428-430, note at :432). **A registration the installer did not create has no receipt and neither Guild-side path sees it** — which is the reporting machine's exact state. | **G1 snapshot: No** (then wired only `UserPromptSubmit`). **Current: Yes** — SessionStart carries update-check (#102), live-verified in a real codex session (wi-04). | V |
| `pi-cli` | C *(provisional)* | **`npm:` · `git:` · `https://` · `ssh://` · local path** (`pi install --help`) | install.sh:545 → `pi install $RENDERED_DIST/pi` — the local-path option | render-time snapshot *(assumed — depends on what `pi install` copies/links)* | none used; git/npm sources available | `guild-run update` (guild-run.ts:74,300) | No | **capability V** (`--help` run) · **Guild path S** — install not executed, so B-vs-C is not forced |
| `antigravity-cli` | C *(provisional)* | `install <target>` incl. **`plugin@marketplace`**, plus `link <mp> <target>` (`agy plugin --help`) | install.sh:561 → `agy plugin install $RENDERED_DIST/antigravity` — local path | render-time snapshot *(assumed — same caveat)* | none used; marketplace mechanism available | `guild-run update` | No | **capability V** (`--help` run) · **Guild path S** — install not executed |
| `agents-file` | C | n/a — file surface | install.sh:576 writes the receipt; the copy instructions it prints are :578-581 — the installer renders only, the user copies `dist/agents/` | copy-time snapshot, no version marker in the copied tree | none | `install.sh --update` (**not** `guild-run update` — the AC-7 guard at self-update.ts:104-113 refuses any host whose capability row is not `apply: "self_update"`) | No | S |
| `cursor` | C | unknown — CLI has no plugin manager (confirmed: `cursor-agent --help` shows none) | install.sh:591 sets `NEW_CLI_PATH`; the launcher it points at is :594/:607-608 — renders `dist/cursor/` + `bin/guild-run` | render-time snapshot | n/a | `guild-run update` — **live-verified 2026-07-30** (receipted swap → 2.4.0) | **Yes** — launch notice live-verified | **V (partial)** — package/receipt/notice/update all verified on-box; `cursor-agent -p` flag shape confirmed real, but the model run itself is auth-gated (not logged in). See §issue-104 verification |
| `github-copilot` | C | unknown — reached as `gh copilot` passthrough to the standalone Copilot CLI (auto-download needs a TTY; `npm i -g @github/copilot` sidesteps) | install.sh:591 (+ :594/:607-608) renders `dist/github-copilot/` | render-time snapshot | n/a | `guild-run update` — **live-verified 2026-07-30** (receipted swap → 2.4.0) | **Yes** — launch notice live-verified | **V** — FULL end-to-end 2026-07-30: `bin/guild-run --host github-copilot --prompt …` spawned `gh copilot -p`, a real completion ran, wrapper record emitted, exit 0. See §issue-104 verification |
| `opencode` | C | unknown — CLI has no plugin manager | install.sh:591 (+ :594/:607-608) renders `dist/opencode/` | render-time snapshot | n/a | `guild-run update` — **live-verified 2026-07-30** (receipted swap → 2.4.0) | **Yes** — launch notice live-verified | **V** — FULL 2026-07-30, WITH A CONTRACT DEFECT FOUND: the inferred `-p` form is silently ignored (TUI opens — a hung pane); the real non-interactive form `opencode run "<prompt>"` completed a live model turn. Both argv sites fixed in PR #109. See §issue-104 verification |
| `rovo-dev` | C | unknown — `acli rovodev` is AUTH-WALLED before even `--help` (unauthenticated probe errors), so install.sh detection cannot see it either | install.sh:591 (+ :594/:607-608) renders `dist/rovo-dev/` | render-time snapshot | n/a | `guild-run update` — **live-verified 2026-07-30** (receipted swap → 2.4.0) | **Yes** — launch notice live-verified | **U (narrowed)** — Guild's side fully verified; the HOST leg needs Atlassian auth. The CLI's own error names `acli rovodev run`, so the inferred `-p` shape is SUSPECT — documented in guild-run-wrapper.ts. See §issue-104 verification |
| `kiro` | C | n/a — editor file surface (`adapter_binding: agents-file`) | install.sh:624 reuses `dist/agents/`; user copies to project root | copy-time snapshot | none | `install.sh --update` + re-copy | No | **U** — editor not exercised; `inferred` |
| `qoder` | C | same as `kiro` | install.sh:624 reuses `dist/agents/` | copy-time snapshot | none | `install.sh --update` + re-copy | No | **U** — `inferred` |
| `trae` | C | same as `kiro` | install.sh:624 reuses `dist/agents/` | copy-time snapshot | none | `install.sh --update` + re-copy | No | **U** — `inferred` |
| `claude-code-app` | D | n/a | refused — `is_refuse_host` install.sh:151; refuse block install.sh:320-336 (`exit 4` at :336) | n/a | n/a | n/a | n/a | S |
| `claude-code-web` | D | n/a | refused — `is_refuse_host` install.sh:151; refuse block install.sh:320-336 | n/a | n/a | n/a | n/a | S |
| `codex-app` | D *on paper* — reached via `codex-cli` in practice | inherits Codex CLI's marketplace | refused by `install.sh` (`is_refuse_host` :151, refuse block :320-336), **but** the app shares `~/.codex/[REDACTED] with the CLI and install.sh:534 prints a `codex://plugins/guild?marketplacePath=…` deep link for it | inherits `codex-cli`'s pinned semver cache | inherits | inherits — fix the CLI registration and the app follows | No | **S** — shared-`~/.codex/[REDACTED] inheritance is read from install.sh + the operator's report, not from an app run; registry `provenance: inferred` |
| `claude-ai-connector` | D | n/a | refused — `is_refuse_host` install.sh:151; refuse block install.sh:320-336 | n/a | n/a | n/a | n/a | S |

**Registry cross-check** (16/16 rows): `installability` — `native` ×1
(`claude-code-cli`), `target` ×11, `none` ×4. `adapter_binding` — `self` ×13,
`agents-file` ×3 (`kiro`, `qoder`, `trae`). `provenance` — `verified` ×6
(`claude-code-cli`, `codex-cli`, `pi-cli`, `antigravity-cli`, and — since
issue #110, PR #112 — `github-copilot`, `opencode`), `inferred` ×10.

## Open items this page does NOT close

Acceptance criterion "which non-Claude/non-Codex hosts have native registries vs
agents-file-only" is **partially resolved**:

- **Resolved:** `pi-cli` (npm/git/https/ssh sources) and `antigravity-cli`
  (`plugin@marketplace` + `link`) both have remote-source mechanisms Guild is
  not using.
- **Unresolved:** `cursor`, `github-copilot`, `opencode`, `rovo-dev` — none on
  PATH here. `install.sh:586` asserts they have "no native plugin manager", but
  that is a **source comment, not host evidence**. Treat as unknown.
- **N/A by binding:** `kiro`, `qoder`, `trae` are `adapter_binding: agents-file`
  file surfaces; a registry question does not apply.

Closing the four unknowns needs those hosts installed. **They do not block G1's
own close** (its acceptance criterion permits `UNVERIFIED` + a named blocker),
and they do not block G2 or the shared/verified-host work in G3–G5. **They do
block final acceptance:**

- **G5** requires "a documented, tested update command" for *every* one of the
  16 hosts — unreachable while four contracts are unknown.
- **G3/G4** may start on the verified hosts but cannot close their all-host
  contracts.
- The **initiative close gate** requires observing a validation release reach
  every host in this matrix.

**CARVE-OUT RECORDED (2026-07-26, xhrd-wi-05 close-out).** The four hosts were
not installable on the executing machine after three sessions of initiative
work; the carve-out below is the explicit close-gate path, with the followup
issue filed on `lookatitude/guild` naming per-host verification steps:

| Host | What verification needs | Until then |
|---|---|---|
| `cursor` | install the CLI; run the rendered `dist/cursor` package's `bin/guild-run`; confirm the launch staleness notice and `guild-run update` | class C row stays `U`; update command documented as `guild-run update` per the capability row |
| `github-copilot` | same, against `dist/github-copilot` | same |
| `opencode` | same, against `dist/opencode` | same |
| `rovo-dev` | same, against `dist/rovo-dev` | same |

All four receive the wrapper-package machinery this initiative fixed — per-host
receipt version, the `bin/guild-run` launch staleness notice, and the
`guild-run update` chain whose dependency bootstrap was live-verified end to
end (clone → npm ci → render → staged swap, against the public repo) after the
round-1 gate caught it failing under the wrapper's own nested-npm environment.
What remains untested is each HOST's side: whether the host accepts the
package, and the same chain run on that host's machine.

The upgrade-propagation row above was a second such gate — a required G4/G5
acceptance test with a concrete trigger. It is now CLOSED: the v2.4.0 cut
provided the trigger and the probe verified propagation (see the probe record
above).

## The remote switch is BLOCKED on payload parity (xhrd-wi-03 / G3)

G1 concluded "Codex needs no publish infrastructure — only the registration is
wrong." **G3 attempted the switch and that conclusion is REFUTED.**

`codex plugin marketplace add lookatitude/guild --ref <branch>` succeeds and
resolves the right version — but the repo-root marketplace entry is
`"source": "./"`, so Codex installs **the repository root**, which is not the
Codex package. Measured on a real install (isolated `CODEX_HOME`, `--ref next`):

| Artifact the rendered package provides | Present in a remote install? |
|---|---|
| `.codex-plugin/plugin.json` | **✓ present since PR #114** (generated repo-root manifest — see §Codex git-install MCP declaration) |
| `.<HIGH_ENTROPY_REDACTED>` | **✗ missing** |
| `hooks/codex-hooks.json` | **✗ missing** |
| `hooks/codex-guild-prompt-bridge.js` | **✗ missing** |
| `bin/guild-run` | **✗ missing** |
| `.claude-plugin/plugin.json`, `skills/`, `agents/`, `commands/` | ✓ (Claude-shaped) |

The prompt bridge is not optional — Codex has no Claude slash-command format,
which is the whole reason it is rendered. So the remote switch trades **frozen
but functional** for **current but missing the adapter layer**: a net
regression. The registration change was reverted.

⇒ **The operator fix earlier in this page carries the same defect.** Removing a
working local registration in favour of `--ref main` yields a *newer, more
broken* install. Do not run it until payload parity exists.

### The mechanism that makes G3 solvable (measured)

Codex reads **`.<HIGH_ENTROPY_REDACTED>.json` in preference to
`.claude-plugin/marketplace.json`**, and its plugin `source` may be a
**subdirectory**. Verified with a fixture carrying both manifests pointing at
different payloads — the `.agents/plugins` subdirectory entry won:

```console
$ codex plugin marketplace add <fixture>   # both manifests present
$ codex plugin add prec@prec
Installed plugin root: …<HIGH_ENTROPY_REDACTED>.0.0-SUBDIR   # the subdir, not "./"
```

That resolves the hard part: Guild can point Codex at a rendered Codex tree
**without disturbing `.claude-plugin/marketplace.json`**, which Claude needs at
`source: "./"`. No build-artifact branch and no separate published package are
required.

**The remaining decision is architectural, not technical.** Codex clones the
repo and uses only the named subdirectory, so that subdirectory must be
*committed* — i.e. the rendered Codex package becomes a tracked artifact. That
cuts against the standing "`dist/` is generated, never committed" rule
(`xhrd-def-nongoal-2`). Two mitigations already exist: the SC-2 equivalence gate
and the module-resource drift gates (xhrd-wi-02) would keep a committed tree
honest, exactly as they do for `.claude-plugin/*`.

⇒ G3 is **unblocked technically and pending a decision** on committing a
rendered payload (repo size vs. a working remote install). It is NOT the
open-ended publishing problem the previous revision assumed.

**Lesson.** G1 verified that a remote install produced *a version*. It never
verified *what was installed*. "It installs" and "it installs the right thing"
are different claims and need different probes.

### pi and antigravity — the earlier rationale was also wrong

An earlier draft claimed neither could consume this repo because
`pi-manifest.json` / `antigravity-manifest.json` are rendered-only. Refuted:
pi identifies a package by `package.json#pi` or conventional directories
(`skills/`, `extensions/`), not `pi-manifest.json`, and a probe **successfully
installed** `git:github.com/lookatitude/guild@main`. Antigravity's required
marker is a root `plugin.json`, not `antigravity-manifest.json`.

So their remote support may well be reachable — but, exactly as with Codex,
*installing* is not the same as *installing a working payload*. Functional
parity is unmeasured for both. Treat them as OPEN, not as ruled out.

## Secondary findings

- **`install.sh` cannot render a beta package from a checkout.** When
  `build-host-packages.ts` sits next to the script, the working tree *is* the
  source (install.sh:428 detects the checkout, :429-430 states it) and `--channel`
  is ignored with the note printed at :432. The channel
  selector governs only the no-checkout clone fallback, so `--channel beta` from
  a clone silently installs whatever branch is checked out.
- **Receipts are written by `install.sh` only.** `write_receipt` (install.sh:479)
  runs inside each `install_*` function. A host-native install — including the
  *documented primary* Claude path and the working Codex git path — produces no
  receipt, so `install.sh --update` and `guild-run update` cannot see it. This is
  why the reporting machine had Guild on Codex and an empty `~/.guild/receipts/`.
- **Receipt version is read from the Claude tree for every host.**
  `plugin_version_from` (defined install.sh:473, called :483) reads
  `$SCRIPT_DIR/.claude-plugin/plugin.json`,
  falling back to `$RENDERED_DIST/claude-code`, then the literal `unknown`. Every
  host's receipt records the Claude package's version. Harmless while all hosts
  render from one tree; wrong the moment they do not.
- **`codex-app` is refused but reachable.** Class D describes what `install.sh`
  *writes*, not what ends up *running Guild*. G5 must not read "refused" as
  "unreachable".

## What this implies for G2–G5

Restricted to what the evidence forces:

| Goal | What follows |
|---|---|
| **G2** version SoT | Two manifests are load-bearing for install: `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json` (Codex reads the latter over git). `.codex-plugin/plugin.json` is load-bearing for BOTH the local path and — since PR #114 — the repo-root git-install path. **CORRECTED 2026-07-30:** the earlier conclusion that a version field in the Codex manifest is *not* required is FALSE for the repo-root manifest. Measured: a git install whose `.codex-plugin/plugin.json` omits `version` makes `codex plugin list` report the plugin as `local` instead of its real version (control install on a ref without the manifest reported correctly). So the repo-root Codex manifest carries the canonical version and is part of the generated + drift-gated install surface. Three files now: the two `.claude-plugin` manifests and `.codex-plugin/plugin.json`. |
| **G3** publish matrix | **Scope shrinks substantially.** Codex needs no new publish infrastructure — the repo is already a working git marketplace. The deliverable is switching Guild's *default registration* from local to remote (install.sh + README) for codex, and evaluating the same for pi (`git:`) and antigravity (`plugin@marketplace`). A GitHub Release artifact per host is **not** forced by the evidence; it is one option for genuinely file-surface hosts. **Constraint:** the switch must apply to *fetched* stable/beta installs only — install.sh:428-430 deliberately treats a checkout's working tree as the source, and making every invocation remote would break the development install path. **Channel switching requires `marketplace remove` + `add`**, not a re-`add`. |
| **G4** staleness signal | AT THE G1 SNAPSHOT Codex's hook manifest carried only `UserPromptSubmit` — that gap was real and is CLOSED (#102 wired SessionStart; live-verified in a real codex session at the wi-04 close-out). Wrapper hosts carry the `guild-run` launch notice; file surfaces the AGENTS.md preamble + shipped bundle. |
| **G5** update parity | Three defects are evidenced. (1) Receipts are written ONLY by `install.sh` — a host-native install (including the documented primary Claude path and the working Codex git path) leaves `install.sh --update` and `guild-run update` blind, which is the reporting machine's exact state. (2) `plugin_version_from` reads the Claude tree for every host's receipt. (3) The documented Guild-side Codex update paths assume an INSTALLER-MANAGED install. README:144-151 already matches the registry (the Claude two-command pair; `guild-run update` for the wrapper hosts incl. codex) — so the gap is NOT a docs-vs-registry mismatch. It is that the two **Guild-side** paths — `guild-run update` (`self-update.ts:95-99`) and `install.sh --update` (`install.sh:220-224`) — are both receipt-dependent, and a host-native install writes no receipt. The Claude marketplace pair is host-native and needs no receipt, so this does NOT affect a native Claude install; it bit Codex specifically at the G1 snapshot, whose then-documented command (`guild-run update`) was receipt-dependent. CURRENT (option A): codex-cli's command is `install.sh --update`, which handles the no-receipt case by detection+advice, and the session-start check mints an identification-only package receipt. The reporting machine had Guild on Codex, no receipt, and therefore no working documented update path. G5 owes that case a real answer, not a third mapping. |

## Verification method

Executed on this machine, 2026-07-25:

- **Isolated `CODEX_HOME` probes** (created, exercised, deleted):
  (a) `marketplace add lookatitude/guild --ref main` → `plugin add guild@guild`
  → `marketplace upgrade` → `plugin list` (→ 2.3.2);
  (b) the same at `--ref v2.3.0` (→ 2.3.0), then `marketplace upgrade` (stayed
  2.3.0), then an attempted re-point to `--ref main` (rejected);
  (c) a local git-repo marketplace fixture, to test branch-advance propagation —
  **rejected** by Codex as a git source in all three forms (bare path,
  `file://`, plain path), which is why that row stays UNVERIFIED.
- `codex plugin --help`, `codex plugin marketplace --help`, `pi install --help`,
  `agy plugin --help`.
- Host presence probe: `pi`, `agy`, `claude`, `codex` present; `cursor`,
  `opencode`, `acli` absent.
- `~/.codex/[REDACTED] `[marketplaces.*]`, `~/.codex/[REDACTED]
- `install.sh` (line numbers cited inline, re-checked against the file),
  `scripts/guild-run.ts`, `scripts/lib/self-update.ts`.
- `HOST_REGISTRY_ROWS` dumped from `scripts/lib/host-registry.ts`.
- `git show origin/{main,next}:.claude-plugin/plugin.json` → 2.3.2 / 2.3.1.

Isolated-probe hygiene: every probe ran under a scratch `CODEX_HOME`, was
exercised, and was deleted. The operator's `~/.codex/[REDACTED] was read but
never modified — it still carries the stale `local` registration, so the
reported defect remains reproducible until the operator applies the fix above.

**Review provenance.** This page survived SIX rounds of Codex adversarial review and was materially
wrong before each of the first five.

- **Round 1** refuted the central thesis. The first draft claimed Codex had no
  working update path and marked all 16 rows empirically verified. Codex
  demonstrated the git-marketplace install working against the public repo, and
  showed the blanket `V` contradicted `HOST_REGISTRY_ROWS.provenance`. Both
  refutations were independently reproduced before the rewrite. The whole
  thesis, the `V`/`S`/`U` split, and the shrunken G3 scope are consequences.
- **Round 2** caught the over-correction. "Full Claude-parity distribution" was
  still an overclaim: the probes proved *fresh-install* parity, never *upgrade
  propagation*, and `host-capabilities-schema.ts` marks `codex-cli`
  `auto_capable: false`. It also caught two stale line citations, `V` markings
  on `pi-cli`/`antigravity-cli`/`codex-app` whose install paths were never
  executed, an internally inconsistent Class C definition, and the false claim
  that the four unknown hosts block nothing downstream. All corrected above; the
  upgrade-propagation row is now an explicit UNVERIFIED with a named blocker and
  a concrete re-test trigger.

- **Round 6** (cap extended by the operator, because round 5's fix landed
  unreviewed) confirmed the round-5 scoping fix and then caught three more: the
  update-path rows understated reality (`install.sh --update` and the
  registry-canonical `guild-run update` both reach an installer-managed local
  Codex install — "none that works" was wrong), the Claude row listed half of a
  two-command chain, and four `install.sh` citations pointed at adjacent lines
  rather than the ones carrying the claim.

The lesson worth carrying: *"the host cannot do X"* is the claim most likely to
be wrong, because it is the one nobody tests. Rounds 1, 3 and 6 all turned on
some version of it.

## v2.4.0 validation pass (2026-07-27) — the release leg, observed live

v2.4.0 was the initiative's validation release: cut from `next` via
`release/v2.4.0`, merged to `main` with a MERGE COMMIT (the squash divergence
was healed in the same PR — #106), auto-tagged and published by `release.yml`,
then synced back by fast-forwarding `next` to `main`'s exact tip (`1eb30e3`).
`check-channel-integrity` reports both channels at 2.4.0 — the first time the
channels have shared a commit since v2.3.1. Observed per host class:

| # | Class / host | Observation | Result |
|---|---|---|---|
| 1 | git-ref marketplace (`claude-code-cli`) | `origin/main:.claude-plugin/plugin.json` carries 2.4.0 — the ref-advance IS the distribution | PASS |
| 2 | codex native git install | fresh isolated `CODEX_HOME`, `marketplace add lookatitude/guild --ref main` + `plugin add` → `installed, enabled 2.4.0`, cache dir `plugins/cache/guild/guild/2.4.0` | PASS |
| 3 | staleness signal, REAL + unseeded | the reporting machine's actual 2.2.0 codex cache, `~/.guild/update-check.json` absent: run 1 silently spawned the detached refresh (by design), run 2 emitted `Guild update available on stable: 2.2.0 → v2.4.0 — run: curl … install.sh \| bash -s -- --update` — the option-A reinstall command, never `guild-run update` | PASS (cosmetic residual: tag renders with its `v` prefix) |
| 4 | wrapper live update (`guild-run update`) | a freshly rendered 2.4.0 `pi` package receipted at 2.3.2: full live run — real clone, all-host render, `gates PASS`, staged swap, `updated to 1eb30e3 (v2.4.0)`, receipt refreshed | PASS |
| 5 | codex upgrade propagation | the pre-cut probe (see probe record above) | PASS — row closed |

**Finding: the ≤2.3.2 wrapper bootstrap gap.** `guild-run update` executes the
*installed* package's own updater, and packages rendered at ≤2.3.2 carry the
pre-#105 updater (nested-npm env poison + `npm ci --prefix`), which fails —
observed live against a genuine pre-#105 2.3.2 package. The #105 fix therefore
only benefits packages rendered at ≥2.4.0. Remedy for existing wrapper installs
at ≤2.3.2: run the reinstall path once
(`curl -fsSL https://guildstack.dev/install.sh | bash -s -- --update`); from
2.4.0 onward `guild-run update` self-heals. Recorded in the v2.4.0 release
notes.

Out of scope by prior decision: the four unverified-contract hosts (carve-out
issue #104) and the codex remote-source switch (#101 revert — local-marketplace
class validated via the install.sh render instead).


## Issue #104 verification (2026-07-30) — the four then-inferred hosts, on-box

All four CLIs were installed on the operator machine (cursor-agent 2026.07.23,
gh + standalone Copilot CLI 1.0.75, opencode 1.18.5, acli 1.3.22) and the
carve-out recipe executed from a checkout: `install.sh --hosts
cursor,github-copilot,opencode,rovo-dev --yes`.

| Check | cursor | github-copilot | opencode | rovo-dev |
|---|---|---|---|---|
| Package rendered + receipt (per-host version 2.4.0) | PASS | PASS | PASS | PASS |
| `guild-run --host <h> --dry-run` plan builds | PASS | PASS | PASS | PASS |
| Launch staleness notice (seeded isolated HOME, 2.4.0 → 9.9.9, stripped rendering) | PASS | PASS | PASS | PASS |
| `guild-run update` live swap (receipt backdated to 2.3.2 → swapped to v2.4.0) | PASS | PASS | PASS | PASS |
| Host accepts the invocation | flag shape real (`-p` exists); model run auth-gated | **FULL** — real completion through `guild-run` end to end | **FULL** — after fixing the invocation (`run` positional, not `-p`; PR #109) | auth-walled (`acli rovodev` errors before `--help` without an Atlassian token) |

Findings:

1. **opencode contract defect (fixed).** The G4b `-p` convention is silently
   ignored by opencode — the TUI opens, which for a wrapper is a hung pane, not
   an error. Non-interactive form is `opencode run "<prompt>"`. Fixed in both
   argv sites (wrapper plan + pane adapter) in PR #109, red-first test
   `scripts/__tests__/opencode-invocation.test.ts`.
2. **rovo-dev is auth-walled pre-help**, which also breaks install.sh's
   detection probe (`acli rovodev --help` fails unauthenticated → the host is
   never auto-detected on a machine that has acli but no Atlassian token).
   Its own error text names `acli rovodev run`, so the inferred `-p` shape is
   suspect; kept INFERRED with the suspicion documented in code.
3. **gh copilot auto-download needs a TTY** — non-interactive `gh copilot …`
   on a machine without the standalone CLI prints "Copilot CLI not installed"
   instead of downloading. `npm i -g @github/copilot` sidesteps.
4. **Registry provenance flips — DONE (issue #110, PR #112)**: github-copilot
   and opencode flipped to `provenance: verified`; cursor stays inferred
   (partial — no authenticated completion), rovo-dev stays inferred
   (auth-walled). Both flipped hosts remain in `INFERRED_HOSTS`
   (adapter-fallback-ladders) — capability RUNGS are a separate, stricter bar.


## Codex git-install MCP declaration (issue #114, PR #114 — 2026-07-30)

Re-registering the operator machine from the stale local marketplace to the git
source (the fix this initiative shipped) surfaced a defect the validation pass had
missed: **every Codex session opened with two failed MCP servers.**

```
⚠ MCP client for `guild-memory` failed to start: … connection closed
⚠ MCP client for `guild-telemetry` failed to start: … connection closed
```

**Mechanism.** A git-ref install materializes THE REPO as the payload. With no
Codex manifest at the repo root, Codex fell back to Claude's `.mcp.json`, whose
args are `${CLAUDE_PLUGIN_ROOT}`-prefixed — a placeholder Codex expands for
**hooks** but NOT for MCP server args. It spawned `node '${CLAUDE_PLUGIN_ROOT}/…'`,
node exited on the nonexistent path, and the client reported a closed connection.
The servers themselves were never broken (they handshake fine when spawned
directly); only the declaration was.

**What Codex actually resolves** — measured on codex 0.146.0, functional oracle
(ask Codex to call `wiki_list` and see whether the tool answers):

| declaration | server starts? |
|---|---|
| args `${CLAUDE_PLUGIN_ROOT}/mcp-servers/…` | NO |
| args `mcp-servers/…` (no cwd) | NO |
| args `./mcp-servers/…` (no cwd) | NO |
| args absolute | YES — but unpublishable (version-keyed cache root) |
| **args `mcp-servers/…` + `cwd: "."`** | **YES** |

Codex resolves a **relative plugin MCP `cwd` beneath the plugin root**, so
`cwd: "."` plus plugin-relative args is the one form that is both resolvable and
publishable. Setting `CLAUDE_PLUGIN_ROOT` in Codex's environment does nothing —
`codex mcp list` shows the placeholder stored and passed literally.

**Fix.** A generated repo-root `.codex-plugin/plugin.json` declaring both servers
in that form (`renderCodexGitInstallManifest`, part of the drift-gated install
surface). Codex git installs now get **working** wiki-search and telemetry MCP
servers — a capability no prior install path delivered.

**Two traps recorded for future host work:**

1. *Omission ≠ empty.* The rendered Codex package omits `mcpServers` and is silent
   only because that tree ships no `.mcp.json` to fall back to. For a payload that
   carries one, omitting the field re-enables the broken fallback. A first attempt
   at this fix shipped `mcpServers: {}` (suppression) and the adversarial gate
   correctly rejected it for disabling working functionality — the experiment had
   varied only `args`, never `cwd`.
2. *Declare only what the layout supports.* The repo-root manifest must NOT declare
   `skills`/`hooks`: the rendered package points `skills` at `./.agents/skills/`,
   which does not exist in the repo. Omitted, Codex uses its own defaults
   (`skills/` + `commands/` migration, root `hooks/hooks.json`) — verified 110
   native skills + 3 migrated command skills still discovered.
