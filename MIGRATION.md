---
type: concept
owner: architect
confidence: high
source_refs: ["plugin/guild-plan.md §13.1"]
created_at: 2026-05-17
updated_at: 2026-05-17
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
will encounter. v2 is a full clean slate — the `:` colon namespace is gone,
the Operations verb is `ops`, and `--rigor=deep` auto-implies `--review=cross`.

---

## 1. TL;DR (the 60-second version)

- `/guild:x` → `/guild x` — the `:` colon namespace is **gone everywhere**.
- Flag soup → **`--rigor=quick|standard|deep`** + 5 global flags + a
  universal `--dry-run` + a handful of scoped per-command locals.
- New **phase subcommands**: `init ideate plan build qa ops`
  (the Operations verb is **`ops`**).
- `/guild:team` is **removed** — team-compose is folded into `/guild plan`.
- `/guild:diagnose` → **`/guild fix`**.
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
| `/guild [brief] [--loops --loop-cap --auto-approve --codex-review --codex-cap]` | `/guild [brief]` + phase subcommands `init/ideate/plan/build/qa/ops`; flags → `--rigor` + 5 globals | Phases now addressable; flag soup removed; surfaced phase auto-detect added | renamed / restructured (not removed) |
| `/guild:team [propose\|show\|edit] [--allow-larger]` | **removed.** `propose`→ inside `/guild plan`; `show`→ `/guild status` (team section); `edit`→ the `[edit]` response at the plan/team approval gate; `--allow-larger`→ `--team-size=N` on `/guild plan` | Team is no longer a standalone surface; it is a planning sub-step | **REMOVED** |
| `/guild:wiki [ingest\|query\|lint]` | `/guild wiki <ingest\|query\|lint>` | colon→space only; behavior identical | renamed |
| `/guild:evolve [skill] [--auto]` | `/guild evolve [skill] [--auto]` | colon→space only | renamed |
| `/guild:rollback <skill> [n]` | `/guild rollback <skill> [n]` | colon→space only | renamed |
| `/guild:stats` | `/guild stats` | colon→space only | renamed |
| `/guild:audit` | `/guild audit` | colon→space only | renamed |
| `/guild:diagnose [run-id\|text] [--codex-review]` | `/guild fix [run-id\|"symptom"] [--review=cross]` | colon→space; verb rename diagnose→fix; `--codex-review`→`--review=cross` | renamed + flag-migrated |

Designed-but-unshipped commands placed:

| Designed command | v2 placement |
|---|---|
| `/guild:init` | → `/guild init` (phase subcommand) |
| `/guild:initiative new\|status\|resume\|update\|close` | → `/guild initiative <…>` (opt-in) |
| quality entrypoint | → `/guild qa` |
| operations entrypoint | → `/guild ops` (the Operations verb is `ops`) |

### 2.2 Exact user-visible redirect messages (per row)

Every removed/renamed name prints one of the following, then **exits
non-zero and runs nothing**. This is the documented behavior, not a
functional shim.

**Generic renamed (colon→space)** — applies to `/guild:wiki`,
`/guild:evolve`, `/guild:rollback`, `/guild:stats`, `/guild:audit`. Example
for `/guild:wiki`:

```
/guild:wiki was removed in Guild v2.

  v2 equivalent:  /guild wiki <ingest|query|lint>

Guild v2 dropped the `:` namespace — every command is now /guild <subcommand>.
Full mapping: MIGRATION.md  (repo root or plugin docs/).
```

Substitute the verb for each of the other generically-renamed commands:

| Old | New | First line of redirect |
|---|---|---|
| `/guild:evolve` | `/guild evolve [skill] [--auto]` | `/guild:evolve was removed in Guild v2.` |
| `/guild:rollback` | `/guild rollback <skill> [n]` | `/guild:rollback was removed in Guild v2.` |
| `/guild:stats` | `/guild stats` | `/guild:stats was removed in Guild v2.` |
| `/guild:audit` | `/guild audit` | `/guild:audit was removed in Guild v2.` |

(Each prints the same body: `v2 equivalent: /guild <verb> …` + the
colon-dropped explanation + the `Full mapping: MIGRATION.md` line.)

**Removed-outright `/guild:team`:**

```
/guild:team was removed in Guild v2 (no direct replacement).

Team composition is now a step inside planning:
  • propose  → run /guild plan        (team is composed, then approved at the plan gate)
  • show     → /guild status          (shows the active team)
  • edit     → answer [edit] at the plan/team approval gate
  • --allow-larger → /guild plan --team-size=N   (prints the cap-6 warning)

Full mapping: MIGRATION.md §2.
```

**Verb-renamed `/guild:diagnose`:**

```
/guild:diagnose was renamed in Guild v2.

  v2 equivalent:  /guild fix [run-id | "symptom"] [--review=cross]

(`--codex-review` is now `--review=cross`.)
Full mapping: MIGRATION.md §2.
```

**The mega-verb `/guild [brief]`** is renamed/restructured, not removed — it
still works. The only behavioral change a user sees on first run is the
**surfaced phase-detection prompt** and the **deleted tuning flags** (see §4).

---

## 3. Config migration (`.guild/config.yml`)

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

v2 adds an **optional** top-level `defaults:` block to `.guild/config.yml`
— a closed-key set of project-wide behavior defaults (agent-team, adversarial,
team size/always-include, review workflow, skill policy, soft-gate
auto-approve, wiki share-mode, reporting verbosity). The exact key set and
the extended precedence ladder are specified in
[architecture/command-surface.md](../docs/knowledge/architecture/command-surface.md) §4.4 (the
canonical schema — not re-spelled here).

What a v1 user needs to know for migration:

- **Absent `defaults:` ⇒ byte-identical to today.** It is purely additive;
  zero-config behavior is unchanged. There is **nothing to migrate** — you
  only add it if you want project-wide defaults.
- **It is not a new file.** It lives inside the existing
  `.guild/config.yml`. No new config file is introduced.
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
| `--restart` (first word of `$ARGUMENTS`) | `/guild resume --restart` |
| `--allow-larger` (on `/guild:team`) | `/guild plan --team-size=N` |

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
  bare `/guild` proposes a phase and asks before proceeding (never silent).
  See [lifecycle/phase-entrypoints.md](../docs/knowledge/lifecycle/phase-entrypoints.md).
- **Initiatives (opt-in durable work)** — `/guild initiative …`. One-off
  runs remain first-class; an initiative attaches only on explicit request,
  `--initiative=`, or a durable-goal signal that *asks* first.
- **Cross-host review (`--review=cross`) + host adapter (`--host`)** — the
  Claude↔Codex reciprocal review broker.
- **Brownfield knowledge-graph from `/guild init`** — repo onboarding now
  builds a derived knowledge-graph index over the wiki + repo.
- **`--rigor` profile** — one three-valued knob ("how careful should I be?")
  replaces five tuning flags.
- **Quality + Operations are full `[v2]` skills.** `/guild qa` was a
  gap-report-only `verify-done`-extension; it is now the full `guild:quality`
  skill that **auto-selects and executes** E2E/smoke/a11y/perf/integration
  from `CodebaseMap` + plan signals (surfaced + overridable, never silent)
  behind a producer/challenger pair and an interactive release/blocker gate.
  `/guild ops` was a reserved notice; it is now the full `guild:operations`
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
- **`.guild/` ownership boundary + `/guild audit` boundary check.** v2
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
  auto-managed SQLite cache may accelerate `/guild status`, `/guild resume`,
  `/guild initiative status`, and `/guild stats` rollups. It is **gitignored,
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
| `/guild:audit` | `/guild audit` |
| `/guild:stats` | `/guild stats` |
| `/guild:wiki ` | `/guild wiki ` |
| `/guild:evolve` | `/guild evolve` |
| `/guild:rollback` | `/guild rollback` |
| `/guild:diagnose` | `/guild fix` |
| `/guild:team propose` | `/guild plan` (team is a plan sub-step) |
| `/guild:team show` | `/guild status` |
| `--codex-review` | `--review=cross` |
| `--auto-approve=spec-and-plan` | `--auto-approve=spec,plan` |
| `--allow-larger` | `--team-size=N` (on `/guild plan`) |

**SessionStart bootstrap:** the injected command list must be updated to the
3-daily tier (`/guild [brief]`, `/guild status`,
`/guild wiki <ingest|query|lint>`) and should note the colon→space break
once. (Stated here as the required change; this design doc does not edit the
bootstrap or `plugin/CLAUDE.md`.)

**CI ergonomics note:** CI should name phases explicitly
(`/guild build --auto-approve=…`) rather than rely on bare-`/guild`
detection — detection is interactive by design. A bare `/guild` reaching a
gate in a non-interactive context is expected to hard-fail with a clear
message rather than implicitly grant autonomy.

---

## 8. FAQ

**Why no shims?** v2 is a full clean slate — no shims that execute. A
print-only redirect stub is documentation, not a behavioral shim: it runs
nothing and advances nothing. The one-version sunset (§5) caps the support
tail.

**Where did `/guild:team` go?** Team composition is now a step *inside*
`/guild plan` with its own approval gate. Inspect the active team via
`/guild status`; edit it via the `[edit]` response at the plan/team gate;
raise the cap with `/guild plan --team-size=N` (which prints the cap-6
warning).

**How do I get the old always-loop behavior?** Use `--rigor=deep` per
invocation, or set `rigor: deep` in `.guild/config.yml`. `deep` =
loops=all + cap=16 + `--review=cross` (auto-implied, profile printed
before the first gate).

**Did `/guild:diagnose` just disappear?** No — it was *renamed* to
`/guild fix`. The diagnose skill is retained internally; the command verb
changed because a user wants the thing fixed, not merely diagnosed.

**Is `/guild` itself breaking?** The verb still works. You will see two
visible changes: a surfaced phase-detection prompt on bare `/guild`, and the
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
