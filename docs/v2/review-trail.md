# v2 Review Trail

## First Adversarial Pass

Reviewer found three issues:

- The phase-team artifact was ambiguous: `team-composition.md` implied a new team per phase, while `lifecycle.md` said later phases do not reselect the team.
- The Guild self-build `agent-team` default was weakened by a peer-coordination condition.
- The lifecycle diagram did not fully show P8 reflection or the `/guild:diagnose` sidecar.

Resolution:

- `team-composition.md` now defines one phase-scoped `.guild/team/<slug>.yaml` with entries for every main phase that needs specialists.
- `lifecycle.md` now says later phases read their phase entry from that artifact and do not silently reselect teams.
- `team-composition.md` and `edge-cases.md` now preserve the self-build default: use `agent-team` whenever tmux preflight conditions hold.
- `02-lifecycle-gates.svg` now includes P8 reflection and the diagnose sidecar.
- `06-adversarial-loops.svg` now includes G-diagnose.

## Second Adversarial Pass

Result:

```text
No blocking or advisory findings remain.
```
