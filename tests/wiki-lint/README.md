# wiki-lint fixtures

Static fixtures that exercise the nine checks performed by
`guild:wiki-lint` (see `skills/knowledge/wiki-lint/SKILL.md`) plus the
hygiene-scan floor rules. The lint
runner itself is built in P6 by `tooling-engineer`; these fixtures are
authored ahead of the runner so the harness can be driven as a
fixture-walking assertion suite (TDD-first — the fixtures ARE the tests).

## Overview

Each fixture is a minimal `.guild/`-style tree laid out as:

```
tests/wiki-lint/fixtures/<fixture-name>/
├── FIXTURE.md              # what this fixture targets + expected outcome
├── wiki/                   # the .guild/wiki/ subtree under test
│   ├── index.md
│   ├── log.md
│   └── <canonical-dirs>/
└── raw/                    # the .guild/raw/ subtree (only when needed)
    └── sources/<slug>/
        ├── original.*
        └── metadata.json
```

Only the subdirectories a given fixture needs to exercise its target check
are populated — unused canonical dirs are omitted to keep each fixture
minimal. All content is obviously-fake ("Example Project", "Test Standard"
and so on) so no real-looking data can leak into a downstream ingest.

## Fixture index

Fourteen fixtures: one canonical pass + eight per-check failures (original) +
four hygiene-rule failures added by the `docs-clean-up` initiative (SC-9
floor, D-DOC-4) + one migration-gate failure (v2 wiki importance backfill).
Each failure fixture is tuned so that **only** its target
check fails; all other checks should pass against the same tree.

| Fixture path                                            | Target check                              | Expected outcome              |
|---------------------------------------------------------|-------------------------------------------|-------------------------------|
| `fixtures/pass/`                                        | all 8 (original)                          | lint passes (zero findings)   |
| `fixtures/fail-frontmatter-completeness/`               | #1 Frontmatter completeness (blocking)    | lint fails on #1 only         |
| `fixtures/fail-source-refs/`                            | #2 source_refs resolution (blocking)      | lint fails on #2 only         |
| `fixtures/fail-stale-claims/`                           | #3 Stale claims (important)               | lint fails on #3 only         |
| `fixtures/fail-contradictions/`                         | #4 Contradictions (important)             | lint fails on #4 only         |
| `fixtures/fail-orphan/`                                 | #5 Orphan pages (important)               | lint fails on #5 only         |
| `fixtures/fail-missing-concept/`                        | #6 Missing concept pages (nit)            | lint fails on #6 only         |
| `fixtures/fail-decision-shape/`                         | #7 Decision page shape (blocking)         | lint fails on #7 only         |
| `fixtures/fail-directory-hygiene/`                      | #8 Directory hygiene (nit)                | lint fails on #8 only         |
| `fixtures/fail-missing-importance/`                     | #9 Missing `importance:` (blocking)       | lint fails on #9 only         |
| `fixtures/fail-progress-messaging/`                     | #10 Progress-messaging patterns (important) | lint fails on #10 only       |
| `fixtures/fail-dangling-related/`                       | #11 Dangling `related:` slugs (important) | lint fails on #11 only        |
| `fixtures/fail-drift-markers/`                          | #12 v1/single-repo drift markers (important) | lint fails on #12 only     |
| `fixtures/fail-pending-grade-review/`                   | #13 Pending grade review — `importance_draft: true` (important) | lint fails on #13 only |

### New checks (#9–#12) — docs-clean-up initiative (SC-9 floor)

Added by Lane D-build (`docs-clean-up`, `eval-engineer`, 2026-05-28).
Rule source: the knowledge-base hygiene and grading ADR (internal).

- **#9 missing-importance** — every canonical page (under the wiki canonical dirs,
  excluding `research/`+`ideation/`, excluding landing files per ADR §A.3/§A.4)
  must carry `importance: critical|high|medium|low`. BLOCKS on missing or
  invalid value.
- **#10 progress-messaging** — body text matching ADR §C.3 seed patterns (phase/
  session/status narrative, progress emoji, wave/phase/gate name-drops in concept
  bodies). IMPORTANT — flags are candidates, not auto-deletes (Lane C applies
  the C.2 keep-vs-delete test).
- **#11 dangling-related** — a `related:` slug in frontmatter that does not map
  to any page filename in the wiki corpus. IMPORTANT — stale cross-links break SC-4.
- **#12 drift-markers** — body text referencing v1 command forms (`/guild-*`),
  v1 `commands/guild-*.md` paths, or explicit single-repo assumptions that
  survived the v1→v2 migration. IMPORTANT — SC-1 compliance.

### New check (#13) — v1→v2 migration gate (wiki importance backfill)

- **#13 pending-grade-review** — a page whose frontmatter still carries
  `importance_draft: true` was drafted an `importance:` grade by the v1→v2
  migration (`/guild:migrate`, `graded_by: guild-migrate`) and the operator has
  not yet reviewed/accepted it (`migrate-guild.ts --accept-grades`). IMPORTANT —
  the page sits at the human gate; the flag repeats every run until accepted.
  Implemented deterministically as `scan.ts` rule 7 AND as `guild:wiki-lint`
  check #9 (the `/guild:wiki lint` surface). Flow: `https://guildstack.dev/docs/migration-v1-to-v2`.

**CQ-3 deferred:** lifecycle-gate/hook wiring is a flagged followup for a
future initiative. These checks are a pure lint floor runnable on demand.

Every fixture directory has a `FIXTURE.md` at its root spelling out:

- which check(s) it targets,
- the expected lint outcome,
- the minimum page count needed to exercise the check,
- why the other checks are not also triggered (i.e. how the fixture keeps
  the failure scoped to a single check).

## Invoking the standing hygiene check (SC-9 floor)

The hygiene scan is the standing check. Run it from the workspace root:

```bash
npx tsx plugin/scripts/docs-hygiene/scan.ts --workspace=/path/to/guild
```

This emits a flag list to `.guild/initiatives/active/docs-clean-up/artifacts/scan-flag-list.md`.

### What each rule catches

| Rule # | Category | What it catches | False-positive exemptions |
|---|---|---|---|
| 1 | **Drift markers** | v1 `/guild-*` command refs, single-repo assumptions, v1 `commands/guild-*.md` paths in body prose | frontmatter (source_refs/supersedes), research/ideation corpus, implementation/phases/ docs, lines containing "supersedes" (v2-cites-v1 bookkeeping) |
| 2 | **Progress messaging** | Session/changelog narrative requiring date-stamp co-occurrence, progress emoji with sprint signals, Wave-N ordinals with status verbs | research/ideation corpus, implementation/phases/ docs, the hygiene ADR itself (meta-definition) |
| 3 | **Dangling related: slugs** | `related:` slug in frontmatter not matching any page in the wiki corpus | research/ideation corpus (deferred to v2.1 when those pages are promoted) |
| 4 | **Dangling source_refs** | `source_refs:` path not found on disk | `.guild/**` paths (F-4: gitignored runtime state), `plugin/.guild/**` paths, `external-input/**` refs, research/ideation corpus |
| 5 | **Missing importance:** | Canonical page (under wiki canonical dirs, not research/ideation, not landing files) missing `importance: critical\|high\|medium\|low` | research/ + ideation/ + landing files (README.md, index.md, QUERY.md, TRANSFER-MANIFEST.md) |
| 6 | **Secrets grep** | API keys, tokens, PEM blocks, password= assignments | git SHA commit refs in context, code-block example hashes |
| 7 | **Pending grade review** | `importance_draft: true` frontmatter — a migration-drafted `importance:` grade awaiting operator acceptance (`migrate-guild.ts --accept-grades`) | none (a draft marker is pending wherever it appears) |

### Recalibration history (2026-05-28)

The original scan (D-build, 2026-05-28) had 2437 total flags with ~99% false-positive rate in
progress-messaging (2073 flags, 2 real) and ~98% false-positive rate in drift (88 flags, 1 real).

D-validate recalibrated the scan by:
- **Rule 1 (Drift):** skipping provenance/phase docs and supersession bookkeeping lines.
- **Rule 2 (Progress):** requiring date-stamp/TODO/WIP/temporal co-occurrence; exempting the hygiene ADR and phase docs.
- **Rule 3 (Dangling related:):** exempting research/ and ideation/ corpus (v2.1 deferred).
- **Rule 4 (Dangling source_refs:):** F-4 exemption extended to `plugin/.guild/` paths; `external-input/` refs; research/ideation corpus exempt.

Post-recalibration counts: drift 14, progress-msg 6, dangling-related 0, source_refs 13, missing-importance 0, secrets 0 — total 33 actionable flags.

## How to use the fixture harness

When the lint runner lands in P6, a harness will walk each fixture:

1. Point `guild:wiki-lint` at `fixtures/<name>/wiki/` as the wiki root and
   `fixtures/<name>/raw/sources/` as the raw root.
2. Freeze the reference "now" to `2026-04-24` (the fixture creation date)
   so `expires_at: 2025-01-01` in `fail-stale-claims/` is deterministically
   in the past.
3. Assert the fixture's expected outcome:
   - For `pass/`: every one of the nine sections in the generated report
     contains the literal `No findings.` line.
   - For `fail-<check>/`: exactly the target check section contains at
     least one finding; every other section contains `No findings.`

Fixtures are deterministic — no wall-clock, no network, no randomness.
A fixture-driven test is stable across runs and machines.

## Authoring rules

- Use only fake names (`Example Project`, `Test Standard`, `example-*`).
- Keep each fixture minimal — only the pages needed to exercise the target
  check.
- Every page under a category directory must carry complete §10.1.1
  frontmatter unless the fixture's entire purpose is to fail check #1.
- The `pass/` fixture is the reference for "what a clean wiki looks like" —
  update it together with `§10.1.1`, `§10.3`, and the lint skill if any of
  them change.
- Do not add a fixture without also updating the fixture-index table above
  and authoring a `FIXTURE.md` at the fixture root.
