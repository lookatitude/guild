---
name: guild-audit
description: "REMOVED in Guild v2 — print-only redirect stub. Prints the v1→v2 redirect and exits non-zero, runs nothing. Sunset: deleted at v2.1.0 (MIGRATION.md §5)."
---

# /guild:audit — removed (print-only redirect stub)

This v1 command name was removed in Guild v2. This file is a **print-only
redirect stub** (`command-clean-slate.md #6`, `MIGRATION.md §2.2`): it
**PRINTS the redirect below verbatim, EXITS NON-ZERO, and runs nothing** —
documentation, not a behavioral shim. It does not silently re-route, does
not advance, does not grant autonomy. Sunset: this stub exists exactly
v2.0.x and is deleted at v2.1.0 (`MIGRATION.md §5`).

Print exactly the following block, then stop. Invoke no skill, write no
file, take no other action. Exit non-zero.

```
/guild:audit was removed in Guild v2.

  v2 equivalent:  /guild audit

Guild v2 dropped the `:` namespace — every command is now /guild <subcommand>.
Full mapping: MIGRATION.md  (repo root or plugin docs/).
```
