---
name: adopt
description: "Project capability localization — report shipped role/skill dependencies, freeze the deprecated compatibility catalog, apply or roll back an approved adoption manifest, operate the D03 migration window, and evaluate the journal-derived G5 removal gate. This is distinct from /guild:migrate, which remains the v1-to-v2 layout converter."
argument-hint: "<report|catalog|adopt|rollback|status|window|g5> [options]"
allowed-tools: Read, Write, Bash
---

# /guild:adopt — project capability adoption

This command localizes shipped specialist templates and domain skills into the
current project's `.guild/` state. It is deliberately separate from
`/guild:migrate`, which only converts the v1 filesystem layout to v2.

Safe discovery comes first:

```bash
npx tsx ${GUILD_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-$HOME/.local/share/guild/dist/claude-code}}/scripts/capability-adopt.ts report --project-id <id> --project-root "$(pwd)"
npx tsx ${GUILD_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-$HOME/.local/share/guild/dist/claude-code}}/scripts/capability-adopt.ts catalog --project-root "$(pwd)" --freeze
```

`report`, `status`, and an unfrozen `catalog` are read-only. `catalog --freeze`,
`adopt`, `rollback`, and `window` mutate project-owned `.guild/` state and require
operator confirmation before invocation. `adopt` requires a reviewed decisions
JSON file plus explicit run, authority, and RFC3339 timestamp. `rollback` appends
reversal entries and preserves history.

The D03 window is machine-enforced:

```bash
npx tsx $GUILD_PLUGIN_ROOT/scripts/capability-adopt.ts window start --project-root "$(pwd)" --release 2.6.0 --at <rfc3339> --to observe
npx tsx $GUILD_PLUGIN_ROOT/scripts/capability-adopt.ts window record --project-root "$(pwd)" --release 2.6.1 --at <rfc3339>
npx tsx $GUILD_PLUGIN_ROOT/scripts/capability-adopt.ts window advance --project-root "$(pwd)" --release 2.7.0 --at <rfc3339> --to shadow --conformance-pass
npx tsx $GUILD_PLUGIN_ROOT/scripts/capability-adopt.ts g5 --project-root "$(pwd)" --windows <release-windows.json> --project-local-default <semver> --current-version <semver>
```

The `g5` verdict is the removal verdict, not telemetry alone: it also enforces
the two-minor rollback floor and refuses legacy removal throughout v2.

Advance requires at least three distinct releases, fourteen days, and passed
conformance. `g5 --windows <file>` rebuilds its verdict only from hash-bound
compatibility payloads referenced by intact MH-06 receipt journals. Missing
payloads, damaged journals, uninstrumented assets, fewer than two clean release
windows, or any dependence read block removal.

Always show the CLI result verbatim. Exit `0` means the requested operation
completed; `1` is invalid usage; `2` is a fail-closed refusal.
