---
name: guild-team
description: "REMOVED in Guild v2 (no direct replacement) — print-only redirect stub. Team composition folded into /guild:plan. Prints the v1→v2 redirect and exits non-zero, runs nothing. Sunset: deleted at v2.1.0 (MIGRATION.md §5)."
---

# /guild:guild-team — removed (print-only redirect stub)

This v1 command was **removed outright** in Guild v2 — team composition is no
longer a standalone surface; it is a step inside `/guild:plan`. This file is a
**print-only redirect stub** (`command-clean-slate.md #6`, `MIGRATION.md §2.2`):
it **PRINTS the redirect below verbatim, EXITS NON-ZERO, and runs nothing** —
documentation, not a behavioral shim. It does not silently re-route, does not
advance, does not grant autonomy. Sunset: this stub exists exactly v2.0.x and
is deleted at v2.1.0 (`MIGRATION.md §5`).

Print exactly the following block, then stop. Invoke no skill, write no file,
take no other action. Exit non-zero.

```
/guild:guild-team was removed in Guild v2 (no direct replacement).

Team composition is now a step inside planning:
  • propose  → run /guild:plan        (team is composed, then approved at the plan gate)
  • show     → /guild:status          (shows the active team)
  • edit     → answer [edit] at the plan/team approval gate
  • --allow-larger → /guild:plan --team-size=N   (prints the cap-6 warning)

Full mapping: MIGRATION.md §2.
```
