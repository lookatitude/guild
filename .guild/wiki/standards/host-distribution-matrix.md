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
Added marketplace `guild` from https://github.com/lookatitude/guild.git#main.

$ codex plugin add guild@guild
Installed plugin root: …/plugins/cache/guild/guild/2.3.2

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
| An **installed** plugin moves to a newer version when its **branch** ref advances | **UNVERIFIED** — see blocker below |

Blocker on the last row: Codex accepts only `owner/repo` or a remote git URL as
a git source (a local path — even a bare repo or `file://` URL — is rejected
with `--ref is only supported for git marketplace sources` / `invalid
marketplace source format`), so a moving branch cannot be simulated offline.
Guild's own capability rows already encode the distinction: `claude-code-cli` is
`auto_capable: true`, `codex-cli` is `auto_capable: false`
(`host-capabilities-schema.ts`). **Do not assume upgrade propagation works.**

Concrete re-test trigger: when G6 lands the v2.3.2 sync-back, `origin/next`
advances 2.3.1 → 2.3.2. Install from `--ref next` *before* that merge, then run
`marketplace upgrade` and `plugin add` after it, and record whether the
installed version moves. That single observation closes this row and is a
required G4/G5 acceptance test.

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

A separate defect **does** span all hosts but `claude-code-cli`: none of them
has a staleness signal.

Guild's own Codex registration is the symptom:

```toml
# ~/.codex/config.toml — the reporting machine
[marketplaces.guild]
last_updated = "2026-07-05T01:57:27Z"
source_type = "local"
source = "/Users/miguelp/Projects/guild/plugin/dist/codex-marketplace"
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
| **B — local path** | registers a filesystem path into a rendered `dist/` tree | **Not by the host's own refresh** — `marketplace upgrade` rejects a local source outright. Guild-side paths still exist for an INSTALLER-MANAGED install: `install.sh --update` re-renders and reinstalls from the receipt, and the registry declares `guild-run update` as the canonical command. A registration the installer did not create (hand-run `codex plugin marketplace add`) has no receipt and neither path sees it. |
| **C — rendered tree** | leaves a `dist/<host>/` tree. Wrapper-package hosts re-render via `guild-run update`; **file-surface** hosts (`agents-file`, `kiro`, `qoder`, `trae`) are refused it and told their real command instead — the AC-7 honesty guard in `self-update.ts:104-113` rejects any host whose capability row is not `apply: "self_update"` | Only on an explicit update command — and **which** command differs *within* the class |
| **D — refused** | recognized by `is_refuse_host` (install.sh:151); the refuse block at install.sh:320-336 collects them and `exit 4`s | n/a |

## The matrix

Evidence column: **V** = executed on this machine 2026-07-25. **S** = verified by
reading Guild's source (proves what Guild *intends to run*, not that the host
accepted it). **U** = unverified, blocker named.

Marking discipline: a row is **V** only where the host binary was present and
the path was actually exercised. `HOST_REGISTRY_ROWS.provenance` marks 12 of 16
rows `inferred` (`host-registry-schema.ts`); this table does not claim more than
the registry does.

| Host | Class | Host supports | Guild's install path | Version resolution | Publish mechanism | Update command | Staleness signal | Ev |
|---|---|---|---|---|---|---|---|---|
| `claude-code-cli` | A *(README)* / B *(install.sh)* | git ref **and** local path | README:108,121 → `claude plugin marketplace add lookatitude/guild[@next]`; **but** install.sh:504 registers `$RENDERED_DIST/claude-code`, a local path | git ref, or local snapshot via install.sh | git push to `main`/`next` | **`claude plugin marketplace update guild && claude plugin update guild@guild`** — the canonical pair per `UPDATE_COMMANDS.marketplace_cli` (`host-capabilities-schema.ts:94`, wired at `:282`, `auto_capable: true`). Refreshing the marketplace alone does NOT move the installed plugin; that second command is not optional, and this page records no live proof that the first alone suffices. | **Yes** — `hooks/hooks.json:16` `SessionStart` → `update-check.js` | V |
| `codex-cli` | B *(as wired)* — A *available today* | **git ref, verified working** (`--ref main` → 2.3.2) **and** local path | install.sh:526 registers `$RENDERED_DIST/codex-marketplace` (local); README:167 documents the same | pinned semver dir `plugins/cache/guild/guild/<v>/`; version from `.codex-plugin/plugin.json` (local) or `.claude-plugin/marketplace.json` (git) | git push — **already works, unused** | **git source:** `codex plugin marketplace upgrade` (propagation to an installed plugin UNVERIFIED — see the behavior table). **local source:** `marketplace upgrade` **fails** (not a Git marketplace); a re-`codex plugin add` re-resolves. **Guild-side, installer-managed only:** registry-canonical `guild-run update` (`UPDATE_COMMANDS.self_update`, `host-capabilities-schema.ts:95`, wired at `:378`, `auto_capable: false`), and `install.sh --update`, which reinstalls from the receipt (install.sh:212 consumes receipts, :529 writes the codex one). Its per-receipt-channel re-render applies to the **no-checkout/fetched** path only — run from a checkout, the working tree is the source and the channel is ignored (install.sh:428-430, note at :432). **A registration the installer did not create has no receipt and neither Guild-side path sees it** — which is the reporting machine's exact state. | **No** — generated `codex-hooks.json` wires only `UserPromptSubmit` | V |
| `pi-cli` | C *(provisional)* | **`npm:` · `git:` · `https://` · `ssh://` · local path** (`pi install --help`) | install.sh:545 → `pi install $RENDERED_DIST/pi` — the local-path option | render-time snapshot *(assumed — depends on what `pi install` copies/links)* | none used; git/npm sources available | `guild-run update` (guild-run.ts:74,300) | No | **capability V** (`--help` run) · **Guild path S** — install not executed, so B-vs-C is not forced |
| `antigravity-cli` | C *(provisional)* | `install <target>` incl. **`plugin@marketplace`**, plus `link <mp> <target>` (`agy plugin --help`) | install.sh:561 → `agy plugin install $RENDERED_DIST/antigravity` — local path | render-time snapshot *(assumed — same caveat)* | none used; marketplace mechanism available | `guild-run update` | No | **capability V** (`--help` run) · **Guild path S** — install not executed |
| `agents-file` | C | n/a — file surface | install.sh:576 writes the receipt; the copy instructions it prints are :578-581 — the installer renders only, the user copies `dist/agents/` | copy-time snapshot, no version marker in the copied tree | none | `install.sh --update` (**not** `guild-run update` — the AC-7 guard at self-update.ts:104-113 refuses any host whose capability row is not `apply: "self_update"`) | No | S |
| `cursor` | C | unknown | install.sh:591 sets `NEW_CLI_PATH`; the launcher it points at is :594/:607-608 — renders `dist/cursor/` + `bin/guild-run` | render-time snapshot | unknown | `guild-run update` | No | **U** — host not on PATH; registry `provenance: inferred` |
| `github-copilot` | C | unknown | install.sh:591 (+ :594/:607-608) renders `dist/github-copilot/` | render-time snapshot | unknown | `guild-run update` | No | **U** — host not on PATH; `inferred` |
| `opencode` | C | unknown | install.sh:591 (+ :594/:607-608) renders `dist/opencode/` | render-time snapshot | unknown | `guild-run update` | No | **U** — host not on PATH; `inferred` |
| `rovo-dev` | C | unknown | install.sh:591 (+ :594/:607-608) renders `dist/rovo-dev/` | render-time snapshot | unknown | `guild-run update` | No | **U** — host not on PATH; `inferred` |
| `kiro` | C | n/a — editor file surface (`adapter_binding: agents-file`) | install.sh:624 reuses `dist/agents/`; user copies to project root | copy-time snapshot | none | `install.sh --update` + re-copy | No | **U** — editor not exercised; `inferred` |
| `qoder` | C | same as `kiro` | install.sh:624 reuses `dist/agents/` | copy-time snapshot | none | `install.sh --update` + re-copy | No | **U** — `inferred` |
| `trae` | C | same as `kiro` | install.sh:624 reuses `dist/agents/` | copy-time snapshot | none | `install.sh --update` + re-copy | No | **U** — `inferred` |
| `claude-code-app` | D | n/a | refused — `is_refuse_host` install.sh:151; refuse block install.sh:320-336 (`exit 4` at :336) | n/a | n/a | n/a | n/a | S |
| `claude-code-web` | D | n/a | refused — `is_refuse_host` install.sh:151; refuse block install.sh:320-336 | n/a | n/a | n/a | n/a | S |
| `codex-app` | D *on paper* — reached via `codex-cli` in practice | inherits Codex CLI's marketplace | refused by `install.sh` (`is_refuse_host` :151, refuse block :320-336), **but** the app shares `~/.codex/` with the CLI and install.sh:534 prints a `codex://plugins/guild?marketplacePath=…` deep link for it | inherits `codex-cli`'s pinned semver cache | inherits | inherits — fix the CLI registration and the app follows | No | **S** — shared-`~/.codex/` inheritance is read from install.sh + the operator's report, not from an app run; registry `provenance: inferred` |
| `claude-ai-connector` | D | n/a | refused — `is_refuse_host` install.sh:151; refuse block install.sh:320-336 | n/a | n/a | n/a | n/a | S |

**Registry cross-check** (16/16 rows): `installability` — `native` ×1
(`claude-code-cli`), `target` ×11, `none` ×4. `adapter_binding` — `self` ×13,
`agents-file` ×3 (`kiro`, `qoder`, `trae`). `provenance` — `verified` ×4
(`claude-code-cli`, `codex-cli`, `pi-cli`, `antigravity-cli`), `inferred` ×12.

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

Either those four hosts get installed and exercised, or the initiative closes
with an explicit documented carve-out per host plus a filed followup issue —
which the close gate already permits, but only if it is stated, not assumed.

The upgrade-propagation row above is a second such gate: it is a required
G4/G5 acceptance test with a concrete trigger, not an open curiosity.

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
| **G2** version SoT | Two manifests are load-bearing for install: `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json` (Codex reads the latter over git). `.codex-plugin/plugin.json` is load-bearing for the local path. A version field in the *generated Codex marketplace manifest* is **not** required — both install paths already resolve a version without it. The SoT requirement is that these agree; the drift gate is still justified. |
| **G3** publish matrix | **Scope shrinks substantially.** Codex needs no new publish infrastructure — the repo is already a working git marketplace. The deliverable is switching Guild's *default registration* from local to remote (install.sh + README) for codex, and evaluating the same for pi (`git:`) and antigravity (`plugin@marketplace`). A GitHub Release artifact per host is **not** forced by the evidence; it is one option for genuinely file-surface hosts. **Constraint:** the switch must apply to *fetched* stable/beta installs only — install.sh:428-430 deliberately treats a checkout's working tree as the source, and making every invocation remote would break the development install path. **Channel switching requires `marketplace remove` + `add`**, not a re-`add`. |
| **G4** staleness signal | Codex's generated hook manifest carries only `UserPromptSubmit`, so Codex has no session-start signal — that gap is real. But distribution class does not determine hook availability, and wrapper hosts already have `guild-run update`. The requirement is *a* reachable signal per host, not specifically a SessionStart port. |
| **G5** update parity | Three defects are evidenced. (1) Receipts are written ONLY by `install.sh` — a host-native install (including the documented primary Claude path and the working Codex git path) leaves `install.sh --update` and `guild-run update` blind, which is the reporting machine's exact state. (2) `plugin_version_from` reads the Claude tree for every host's receipt. (3) The documented Guild-side Codex update paths assume an INSTALLER-MANAGED install. README:144-151 already matches the registry (the Claude two-command pair; `guild-run update` for the wrapper hosts incl. codex) — so the gap is NOT a docs-vs-registry mismatch. It is that the two **Guild-side** paths — `guild-run update` (`self-update.ts:95-99`) and `install.sh --update` (`install.sh:220-224`) — are both receipt-dependent, and a host-native install writes no receipt. The Claude marketplace pair is host-native and needs no receipt, so this does NOT affect a native Claude install; it bites Codex specifically, whose only documented command is the receipt-dependent `guild-run update`. The reporting machine had Guild on Codex, no receipt, and therefore no working documented update path. G5 owes that case a real answer, not a third mapping. |

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
- `~/.codex/config.toml` `[marketplaces.*]`, `~/.codex/plugins/cache/guild/**`.
- `install.sh` (line numbers cited inline, re-checked against the file),
  `scripts/guild-run.ts`, `scripts/lib/self-update.ts`.
- `HOST_REGISTRY_ROWS` dumped from `scripts/lib/host-registry.ts`.
- `git show origin/{main,next}:.claude-plugin/plugin.json` → 2.3.2 / 2.3.1.

Isolated-probe hygiene: every probe ran under a scratch `CODEX_HOME`, was
exercised, and was deleted. The operator's `~/.codex/config.toml` was read but
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
