---
type: concept
owner: architect
confidence: high
source_refs: ["plugin/guild-plan.md §13.1"]
created_at: 2026-05-17
updated_at: 2026-05-26
expires_at: null
supersedes: "plugin/guild-plan.md §13.1"
sensitivity: public
applies_to: [plugin]
related: [command-surface, v2-index, phase-entrypoints]
---

# Guild v1 → v2 Migration

> **Status: design documentation.** This document *describes* the v1 → v2
> migration and the exact user-visible behavior of every removed/renamed
> command. It does not execute the migration and does not edit anything under
> `plugin/`. The canonical, authoritative copy lives **here at
> `docs/knowledge/MIGRATION.md`**; all cross-reference links in this file are
> relative to this location (`architecture/…`, `lifecycle/…`) and resolve
> from it. When v2 ships, any additional discoverable copies (e.g. a repo-root
> or `plugin/docs/` copy) are *generated from this file with their links
> rewritten for that location* — this file is the source of truth and its
> own links are correct as-is.

This is the definitive v2 migration guide: it documents every removed/renamed
command, the config and flag changes, and the new-in-v2 surfaces a v1 user
will encounter. v2 is a full clean slate — Guild **keeps** the `:` plugin
namespace (a Claude Code requirement) but **drops the redundant `guild-`
command prefix** (v1 `/guild:guild-wiki` → v2 `/guild:wiki`), the Operations
verb is `ops`, and `--rigor=deep` auto-implies `--review=cross`.

---

## 1. TL;DR (the 60-second version)

- `/guild:guild-x` → `/guild:x` — the `:` plugin namespace **stays** (Claude
  Code requires it); v2 drops the **redundant `guild-` command prefix** and
  changes the verb set. The bare entry is **`/guild:guild`** (there is no
  bare `/guild`).
- Flag soup → **`--rigor=quick|standard|deep`** + 5 global flags + a
  universal `--dry-run` + a handful of scoped per-command locals.
- New **phase subcommands**: `init ideate plan build qa ops`
  (the Operations verb is **`ops`**).
- `/guild:guild-team` is **removed** — team-compose is folded into `/guild:plan`.
- `/guild:guild-diagnose` → **`/guild:fix`**.
- **Initiatives are NEW and OPT-IN** — one-off runs stay first-class.
- **No shims that execute.** Every removed name prints a redirect and exits
  non-zero (documentation, not a behavioral shim). Redirect stubs live
  exactly one minor version (v2.0.x) and are deleted at v2.1.0.

Full design spec: [architecture/command-surface.md](../docs/knowledge/architecture/command-surface.md).

---

## 2. Command-by-command mapping

The eight shipped v1 commands and their v2 fate, with the **exact
user-visible redirect message** each removed/renamed name prints.

### 2.1 The mapping table

| v1 command | v2 replacement | Behavior delta | Fate |
|---|---|---|---|
| `/guild:guild [brief] [--loops --loop-cap --auto-approve --codex-review --codex-cap]` | `/guild:guild [brief]` + phase subcommands `init/ideate/plan/build/qa/ops`; flags → `--rigor` + 5 globals | Phases now addressable; flag soup removed; surfaced phase auto-detect added | renamed / restructured (not removed) |
| `/guild:guild-team [propose\|show\|edit] [--allow-larger]` | **removed.** `propose`→ inside `/guild:plan`; `show`→ `/guild:status` (team section); `edit`→ the `[edit]` response at the plan/team approval gate; `--allow-larger`→ `--team-size=N` on `/guild:plan` | Team is no longer a standalone surface; it is a planning sub-step | **REMOVED** |
| `/guild:guild-wiki [ingest\|query\|lint]` | `/guild:wiki <ingest\|query\|lint>` | prefix drop only; behavior identical | renamed |
| `/guild:guild-evolve [skill] [--auto]` | `/guild:evolve [skill] [--auto]` | prefix drop only | renamed |
| `/guild:guild-rollback <skill> [n]` | `/guild:rollback <skill> [n]` | prefix drop only | renamed |
| `/guild:guild-stats` | `/guild:stats` | prefix drop only | renamed |
| `/guild:guild-audit` | `/guild:audit` | prefix drop only | renamed |
| `/guild:guild-diagnose [run-id\|text] [--codex-review]` | `/guild:fix [run-id\|"symptom"] [--review=cross]` | prefix drop + verb rename diagnose→fix; `--codex-review`→`--review=cross` | renamed + flag-migrated |

Designed-but-unshipped commands placed:

| Designed command | v2 placement |
|---|---|
| `/guild:guild-init` | → `/guild:init` (phase subcommand) |
| `/guild:guild-initiative new\|status\|resume\|update\|close` | → `/guild:initiative <…>` (opt-in) |
| quality entrypoint | → `/guild:qa` |
| operations entrypoint | → `/guild:ops` (the Operations verb is `ops`) |

### 2.2 Exact user-visible redirect messages (per row)

Every removed/renamed name prints one of the following, then **exits
non-zero and runs nothing**. This is the documented behavior, not a
functional shim.

**Generic renamed (prefix drop)** — applies to `/guild:guild-wiki`,
`/guild:guild-evolve`, `/guild:guild-rollback`, `/guild:guild-stats`,
`/guild:guild-audit`. Example for `/guild:guild-wiki`:

```
/guild:guild-wiki was renamed in Guild v2.

  v2 equivalent:  /guild:wiki <ingest|query|lint>

Guild v2 keeps the `:` namespace; it drops the redundant `guild` prefix — every command is /guild:<verb>.
Full mapping: MIGRATION.md  (repo root or plugin docs/).
```

Substitute the verb for each of the other generically-renamed commands:

| Old | New | First line of redirect |
|---|---|---|
| `/guild:guild-evolve` | `/guild:evolve [skill] [--auto]` | `/guild:guild-evolve was renamed in Guild v2.` |
| `/guild:guild-rollback` | `/guild:rollback <skill> [n]` | `/guild:guild-rollback was renamed in Guild v2.` |
| `/guild:guild-stats` | `/guild:stats` | `/guild:guild-stats was renamed in Guild v2.` |
| `/guild:guild-audit` | `/guild:audit` | `/guild:guild-audit was renamed in Guild v2.` |

(Each prints the same body: `v2 equivalent: /guild:<verb> …` + the
prefix-drop explanation + the `Full mapping: MIGRATION.md` line.)

**Removed-outright `/guild:guild-team`:**

```
/guild:guild-team was removed in Guild v2 (no direct replacement).

Team composition is now a step inside planning:
  • propose  → run /guild:plan        (team is composed, then approved at the plan gate)
  • show     → /guild:status          (shows the active team)
  • edit     → answer [edit] at the plan/team approval gate
  • --allow-larger → /guild:plan --team-size=N   (prints the cap-6 warning)

Full mapping: MIGRATION.md §2.
```

**Verb-renamed `/guild:guild-diagnose`:**

```
/guild:guild-diagnose was renamed in Guild v2.

  v2 equivalent:  /guild:fix [run-id | "symptom"] [--review=cross]

(`--codex-review` is now `--review=cross`.)
Full mapping: MIGRATION.md §2.
```

**The mega-verb `/guild:guild [brief]`** is renamed/restructured, not removed — it
still works. The only behavioral change a user sees on first run is the
**surfaced phase-detection prompt** and the **deleted tuning flags** (see §4).

---

## 3. Config migration (`.guild/settings.json`)

> **v2 config surface: `.guild/settings.json` (JSON) replaces `.guild/config.yml` (YAML).**
> It is the single config file and holds every option (Tier-1 keys + the
> closed-key `defaults:` block). Scaffold it fully-documented with
> `/guild:config init`; inspect the resolved config with `/guild:config show`;
> check it with `/guild:config validate`. A **back-compat shim** in
> `read-guild-config.ts` still reads an existing `.guild/config.yml` (mapping
> the v1 keys below) and **warns once**; the moment `settings.json` exists it
> is authoritative and `config.yml` is ignored. The key mapping and precedence
> ladder are unchanged — only the file + format changed (YAML → JSON).

### 3.1 Key mapping

| v1 key | v2 key | Note |
|---|---|---|
| `loops:` | `loops:` (still present, but `null` = derive from `rigor`) | Prefer `rigor:`; `loops:` is now a power-user override only |
| `loop_cap:` | `loop_cap:` | Config-only; no CLI equivalent |
| `codex_cap:` | `codex_cap:` | Config-only; no CLI equivalent |
| `codex_review: true\|false` | `review: local \| cross \| off` | `true`→`cross`, `false`→`local` |
| `auto_approve: none\|spec-and-plan\|implementation\|all` | `auto_approve: []` csv | `none`→`[]`, `spec-and-plan`→`[spec,plan]`, `implementation`→`[build]`, `all`→`[all]` |
| *(new)* | `rigor: standard` | New profile knob; the primary control |
| *(new)* | `host: auto` | New host-adapter selection |
| *(new)* | `initiative_default: null` | New; still opt-in |
| `defaults.agent_team: true\|false` | `agent_mode: team\|agent\|subagent\|auto` (Tier-1) | **Replaced by the dispatch ladder (D5).** `true`→`team`, `false`→`subagent`, absent→`auto`. `defaults.agent_team` is read as a **warn-once deprecated alias** for one minor, then removed at v2.1.0. |
| *(new)* | `defaults.auto_learn: false` | When `true`, `/guild:init` runs the full `learn-*` pipeline at bootstrap (D3). Precedence: `--learn` flag > `settings.json` > built-in(`false`). |

### 3.2 Back-compat shim

`read-guild-config.ts` is intended to ship a **back-compat shim** that maps
the old keys onto the new schema and **warns once per run**:

```
warn: .guild/config.yml uses v1 keys (codex_review, auto_approve=spec-and-plan).
      Mapped to v2 (review=cross, auto_approve=[spec,plan]). Update the file to
      silence this — see MIGRATION.md §3.
```

The shim is mapping-and-warn only; it does not rewrite the file. (This is a
design statement of intended behavior; no code is authored here.)

### 3.3 Worked example

v1 `.guild/config.yml`:

```yaml
loops: all
loop_cap: 16
codex_review: true
codex_cap: 5
auto_approve: spec-and-plan
```

v2 equivalent:

```yaml
rigor: deep            # loops=all + review=cross + cap=16, all in one knob
auto_approve: [spec,plan]
# (omit `review:` — `rigor: deep` already implies `review=cross`)
host: auto
initiative_default: null

# Only if you truly need to pin exact knobs independent of rigor:
loops: null            # null = derive from rigor (recommended)
loop_cap: 16
codex_cap: 5
```

### 3.4 New optional `defaults:` block (nothing to migrate)

v2 adds an **optional** top-level `defaults:` block to `.guild/settings.json`
— a closed-key set of project-wide behavior defaults (adversarial,
team size/always-include, review workflow, skill policy, soft-gate
auto-approve, wiki share-mode, reporting verbosity, **`auto_learn`**). The exact
key set and the extended precedence ladder are specified in
[architecture/command-surface.md](../docs/knowledge/architecture/command-surface.md) §4.4 (the
canonical schema — not re-spelled here).

> **v2.x amendment (D5 dispatch ladder).** The v2.0 `defaults.agent_team`
> boolean is **superseded** by a new Tier-1 key
> `agent_mode: team|agent|subagent|auto` (default `auto`). On `auto` the run
> resolves the backend: inside tmux → team in-session; tmux installed → team in
> a detached session; host supports independent agents → agent; else →
> subagent (the documented fallback). `defaults.agent_team` is read as a
> warn-once alias (`true→team`, `false→subagent`) for one minor, then removed at
> v2.1.0. The new `defaults.auto_learn` bool (default `false`) gates whether
> `/guild:init` runs the full `learn-*` pipeline at bootstrap. Both are
> closed-key additions; the reject rules are unchanged. See
> [decisions/v2x-command-surface-dispatch-and-internalization.md](../docs/knowledge/decisions/v2x-command-surface-dispatch-and-internalization.md).

What a v1 user needs to know for migration:

- **Absent `defaults:` ⇒ byte-identical to today.** It is purely additive;
  zero-config behavior is unchanged. There is **nothing to migrate** — you
  only add it if you want project-wide defaults.
- **It lives in `.guild/settings.json`** (the single v2 config file, which
  replaces `.guild/config.yml`). Generate it with `/guild:config init`; the
  `defaults:` block is one section of it. An existing `config.yml` is read via
  the back-compat shim until you migrate.
- **Precedence:** a CLI flag still wins, then the `--rigor` profile, then
  your `defaults:` block, then the built-in default. Each folded key is
  printed in the pre-first-gate profile line, so a default is never silent.
- **Identity vs behavior split.** `project.yaml` is now identity-only
  (name, slug, label taxonomy, initiative identity); all *behavior* lives in
  `config.yml`. In particular `wiki.share_mode` moved from `project.yaml`
  into `config.yml`'s `defaults.wiki.share_mode`. If you previously set
  `share_mode` in `project.yaml`, move it under
  `defaults: { wiki: { share_mode: … } }` in `config.yml`.
- **Unknown keys are rejected** (config is human-authored, not
  lenient-read); `defaults.wiki.autopromote: true` is rejected always and
  `defaults.adversarial: off` is rejected for Guild self-build.

---

## 4. Flag migration cheat-sheet

| v1 flag | v2 |
|---|---|
| `--loops=<…>` | **gone** — use `--rigor=quick\|standard\|deep` or `.guild/config.yml` `loops:` |
| `--loop-cap=N` | **gone** — config-only (`loop_cap:`) |
| `--codex-cap=N` | **gone** — config-only (`codex_cap:`) |
| `--codex-review` | `--review=cross` |
| `--auto-approve=spec-and-plan` | `--auto-approve=spec,plan` |
| `--auto-approve=implementation` | `--auto-approve=build` |
| `--auto-approve=all` | `--auto-approve=all` (or bare `--auto-approve`) |
| `--restart` (first word of `$ARGUMENTS`) | `/guild:resume --restart` |
| `--allow-larger` (on `/guild:guild-team`) | `/guild:plan --team-size=N` |
| `--deep-scan` (on `/guild:init`) | `--learn` (one trigger name going forward; `init --learn` runs the same `learn-*` pipeline as `/guild:learn`, or set `defaults.auto_learn: true`) |

"Give me the old always-loop behavior" → `--rigor=deep` (or set
`rigor: deep` in `.guild/config.yml`). Note `--rigor=deep` also auto-implies
`--review=cross`; the expanded profile is printed before the first gate so
this is never a hidden mode.

---

## 5. Deprecation timeline

| Version | Removed-command behavior |
|---|---|
| **v2.0.x** | Removed/renamed names print a redirect stub (exit non-zero, runs nothing). |
| **v2.1.0** | Redirect stubs deleted. A bare unknown subcommand prints usage help only. |

The one-version sunset is what caps the support tail. Documenting the stub
removal here is deliberate so v2.1.0 is not itself a surprise.

---

## 6. New in v2 (not a migration, but you'll want these)

- **Phase entrypoints + surfaced smart detection** — start at any phase;
  bare `/guild:guild` proposes a phase and asks before proceeding (never silent).
  See [lifecycle/phase-entrypoints.md](../docs/knowledge/lifecycle/phase-entrypoints.md).
- **Flat-token command surface + de-listed skills (D1/D2).** Beyond the
  prefix-drop (§1), v2.x normalizes the surface to Claude Code's real mechanics:
  commands are **flat** `/guild:<verb>` (colon-namespaced — the `:` stays) and
  sub-verbs (`wiki <ingest|query|lint>`,
  `config <init|show|validate>`, `learn <map|graph|onboard|diff|explain>`,
  `initiative <…>`) are **positional arguments**, never separate command files
  or nested namespaces — **filenames are the source of truth**, and any
  leftover `name: guild <verb>` frontmatter with a space is dead metadata.
  Guild **skills** (`brainstorm`, `plan`, `review`, …) are **model-invoked,
  never `/`-typed**; the command `/guild:<token>` and the skill `guild:<token>`
  are distinct surfaces that share a stem, so the `plan` / `init` / `audit`
  name overlaps are intentional, not collisions to fix. No user action — this
  is a surface clarification, not a behavior change.
- **Full skill internalization — zero dependency (D4).** Guild's borrowed
  methodology and understand-everything skills are now **clean-room
  re-authored** and Guild-native in name and behavior, with no runtime or
  conceptual dependency on the `superpowers` or `understand-anything` plugins.
  The per-skill `LICENSE-attribution.md` files and "forked from" blockquotes
  are removed; the redundant superpowers review forks
  (`request-review` / `receive-review` / `verify-claim`) are **folded into**
  Guild-native `review` / `verify-done`; and the methodology skills (`tdd`,
  `systematic-debug`, `worktrees`, `finish-branch`) are promoted out of the
  `fallback` "fork" tier into first-class skills. **No user-facing behavior
  change** — same capabilities, now owned outright.
- **Initiatives (opt-in durable work)** — `/guild:initiative …`. One-off
  runs remain first-class; an initiative attaches only on explicit request,
  `--initiative=`, or a durable-goal signal that *asks* first.
- **Cross-host review (`--review=cross`) + host adapter (`--host`)** — the
  Claude↔Codex reciprocal review broker.
- **`/guild:learn` (NEW) + cheap-by-default `/guild:init` (D3).** `/guild:init`
  stays cheap — wiki + a brownfield cheap-scan CodebaseMap + architecture-map
  stub. The full understand-everything pipeline (deep knowledge-graph,
  onboarding, diff, explain) is owned by the NEW
  `/guild:learn <map|graph|onboard|diff|explain>` command (one command file;
  the first positional selects the sub-verb). Init runs that full pipeline
  **only** when `defaults.auto_learn: true` or a `--learn` flag is passed —
  `--learn` folds in the old `--deep-scan` (one trigger name; one
  implementation, two triggers). See
  [decisions/v2x-command-surface-dispatch-and-internalization.md](../docs/knowledge/decisions/v2x-command-surface-dispatch-and-internalization.md).
- **`--rigor` profile** — one three-valued knob ("how careful should I be?")
  replaces five tuning flags.
- **Quality + Operations are full `[v2]` skills.** `/guild:qa` was a
  gap-report-only `verify-done`-extension; it is now the full `guild:quality`
  skill that **auto-selects and executes** E2E/smoke/a11y/perf/integration
  from `CodebaseMap` + plan signals (surfaced + overridable, never silent)
  behind a producer/challenger pair and an interactive release/blocker gate.
  `/guild:ops` was a reserved notice; it is now the full `guild:operations`
  skill that **executes** release/monitoring/incident/rollback/maintenance
  runbooks under a split autonomy posture with four non-negotiable safety
  rails. **This is not a breaking rename** — the command verbs `qa`/`ops`,
  their artifact paths (`quality/<run-id>.md`, `ops/<run-id>.md`), and the
  gate markers are unchanged; only the behavior behind them is promoted from
  deferred to shipped. Nothing in an existing v1 invocation changes.
- **`--auto-approve` BLOCK-override asymmetry (printed, never hidden).**
  `--auto-approve` collapses *soft* gates only. The frozen `--auto-approve`
  token set is `[spec,plan,build,all]` — there is **no `qa` or `ops`
  token**; Quality/Operations behavior is auto-passed **only under
  `--auto-approve=all`**, never via a `qa`/`ops` flag value (those do not
  exist). A Quality **BLOCK→release override is NOT a soft gate** (it
  overrides failing evidence) — it **stays human-gated even under
  `--auto-approve=all`**, exactly like the always-ask
  destructive/network/spend hard set. A RELEASE-READY recommendation *is*
  auto-passed under `--auto-approve=all`. The same asymmetry applies in
  Operations: a `release`, destructive, `incident`, or `rollback` action
  always prompts even under `--auto-approve=all` and even inside an
  `approved:true` autonomous runbook. If you set `--auto-approve=all`
  expecting it to mean *all*, this one printed line is the documented
  exception, not a hidden mode.
- **`.guild/` ownership boundary + `/guild:audit` boundary check.** v2
  formalizes the rule that every Guild-owned operational file (project
  config, the wiki, derived indexes, **project-authored or evolved agent and
  skill instances/overrides**, run records, learning/evolution records) is
  written under the consuming repo's `.guild/`. The plugin install directory
  is **static read-only base state** (canonical templates + base library),
  never runtime-written. The single normative ownership map and the
  enforcement model (one PreToolUse approval guard reusing the existing
  always-ask sandbox prompt — no new gate) are specified in
  [architecture/architecture-overview.md](../docs/knowledge/architecture/architecture-overview.md)
  and the boundary ADR it points to; the canonical config/boundary contract
  is in [architecture/command-surface.md](../docs/knowledge/architecture/command-surface.md)
  §4.4/§3.5. **Migration impact for v1 users:** project-authored or evolved
  agents and skills now live at `.guild/agents/` and `.guild/skills/` (with a
  `derived_from_template:` stamp) rather than anywhere under the plugin
  install dir; `create-specialist`, the factory, and `evolve-skill` write
  there. If a prior workflow wrote instances into plugin state, that is a v2
  defect and those instances should be relocated under `.guild/`. **`/guild
  audit` gains a static boundary-check section** that flags any Guild-owned
  file written outside `.guild/`. Nothing else changes for a standard user —
  the default zero-config layout already satisfies the boundary.
- **Optional `.guild/index.sqlite` read-through cache.** An optional,
  auto-managed SQLite cache may accelerate `/guild:status`, `/guild:resume`,
  `/guild:initiative status`, and `/guild:stats` rollups. It is **gitignored,
  fully deletable anytime with zero data loss, and never required** — the
  filesystem stays canonical (absence = identical filesystem-scan result). It
  is lazy-built only when scanning is measurably slow; set `index: off` in
  `.guild/config.yml` for zero hidden state. It is explicitly outside the
  plugin↔benchmark telemetry boundary (the benchmark imports only the
  canonical JSONL). Nothing to migrate; `rm .guild/index.sqlite` is always
  safe.

---

## 7. Self-build / CI callers

Internal scripts, the self-build pipeline, and any CI that invoked `/guild:*`
must be updated in the same break (these are ours to fix; not a user support
cost). Find/replace table:

| Find (v1) | Replace (v2) |
|---|---|
| `/guild:guild-audit` | `/guild:audit` |
| `/guild:guild-stats` | `/guild:stats` |
| `/guild:guild-wiki ` | `/guild:wiki ` |
| `/guild:guild-evolve` | `/guild:evolve` |
| `/guild:guild-rollback` | `/guild:rollback` |
| `/guild:guild-diagnose` | `/guild:fix` |
| `/guild:guild-team propose` | `/guild:plan` (team is a plan sub-step) |
| `/guild:guild-team show` | `/guild:status` |
| `--codex-review` | `--review=cross` |
| `--auto-approve=spec-and-plan` | `--auto-approve=spec,plan` |
| `--allow-larger` | `--team-size=N` (on `/guild:plan`) |

**SessionStart bootstrap:** the injected command list must be updated to the
3-daily tier (`/guild:guild [brief]`, `/guild:status`,
`/guild:wiki <ingest|query|lint>`) and should note the prefix-drop break
once. (Stated here as the required change; this design doc does not edit the
bootstrap or `plugin/CLAUDE.md`.)

**CI ergonomics note:** CI should name phases explicitly
(`/guild:build --auto-approve=…`) rather than rely on bare-`/guild:guild`
detection — detection is interactive by design. A bare `/guild:guild` reaching a
gate in a non-interactive context is expected to hard-fail with a clear
message rather than implicitly grant autonomy.

---

## 8. FAQ

**Why no shims?** v2 is a full clean slate — no shims that execute. A
print-only redirect stub is documentation, not a behavioral shim: it runs
nothing and advances nothing. The one-version sunset (§5) caps the support
tail.

**Where did `/guild:guild-team` go?** Team composition is now a step *inside*
`/guild:plan` with its own approval gate. Inspect the active team via
`/guild:status`; edit it via the `[edit]` response at the plan/team gate;
raise the cap with `/guild:plan --team-size=N` (which prints the cap-6
warning).

**How do I get the old always-loop behavior?** Use `--rigor=deep` per
invocation, or set `rigor: deep` in `.guild/config.yml`. `deep` =
loops=all + cap=16 + `--review=cross` (auto-implied, profile printed
before the first gate).

**Did `/guild:guild-diagnose` just disappear?** No — it was *renamed* to
`/guild:fix`. The diagnose skill is retained internally; the command verb
changed because a user wants the thing fixed, not merely diagnosed.

**Is `/guild:guild` itself breaking?** The verb still works. You will see two
visible changes: a surfaced phase-detection prompt on bare `/guild:guild`, and the
removal of `--loops/--loop-cap/--codex-cap` from the CLI (now `--rigor` +
config).

---

## Cross-references

- [architecture/command-surface.md](../docs/knowledge/architecture/command-surface.md) — the
  full clean-slate v2 command spec (the design source for this migration).
- [architecture/v2-index.md](../docs/knowledge/architecture/v2-index.md) — v2 architecture
  index; links this guide from the command-surface reading-order entry.
- [lifecycle/phase-entrypoints.md](../docs/knowledge/lifecycle/phase-entrypoints.md) — binds
  each phase concept to its v2 command verb.
