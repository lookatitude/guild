# wiki-lint fixtures

Static fixtures that exercise the eight checks performed by
`guild:wiki-lint` (see `skills/knowledge/wiki-lint/SKILL.md`). The lint
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

Nine fixtures: one canonical pass + eight per-check failures. Each failure
fixture is tuned so that **only** its target check fails; all other checks
should pass against the same tree.

| Fixture path                                            | Target check                            | Expected outcome              |
|---------------------------------------------------------|-----------------------------------------|-------------------------------|
| `fixtures/pass/`                                        | all 8                                   | lint passes (zero findings)   |
| `fixtures/fail-frontmatter-completeness/`               | #1 Frontmatter completeness (blocking)  | lint fails on #1 only         |
| `fixtures/fail-source-refs/`                            | #2 source_refs resolution (blocking)    | lint fails on #2 only         |
| `fixtures/fail-stale-claims/`                           | #3 Stale claims (important)             | lint fails on #3 only         |
| `fixtures/fail-contradictions/`                         | #4 Contradictions (important)           | lint fails on #4 only         |
| `fixtures/fail-orphan/`                                 | #5 Orphan pages (important)             | lint fails on #5 only         |
| `fixtures/fail-missing-concept/`                        | #6 Missing concept pages (nit)          | lint fails on #6 only         |
| `fixtures/fail-decision-shape/`                         | #7 Decision page shape (blocking)       | lint fails on #7 only         |
| `fixtures/fail-directory-hygiene/`                      | #8 Directory hygiene (nit)              | lint fails on #8 only         |

Every fixture directory has a `FIXTURE.md` at its root spelling out:

- which check(s) it targets,
- the expected lint outcome,
- the minimum page count needed to exercise the check,
- why the other checks are not also triggered (i.e. how the fixture keeps
  the failure scoped to a single check).

## How to use

When the lint runner lands in P6, a harness will walk each fixture:

1. Point `guild:wiki-lint` at `fixtures/<name>/wiki/` as the wiki root and
   `fixtures/<name>/raw/sources/` as the raw root.
2. Freeze the reference "now" to `2026-04-24` (the fixture creation date)
   so `expires_at: 2025-01-01` in `fail-stale-claims/` is deterministically
   in the past.
3. Assert the fixture's expected outcome:
   - For `pass/`: every one of the eight sections in the generated report
     contains the literal `No findings.` line.
   - For `fail-<check>/`: exactly the target check section contains at
     least one finding; the other seven sections contain `No findings.`

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
