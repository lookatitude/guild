---
name: audit
description: "Self-maintenance — static security audit of installed Guild scripts (SHA-256 hashes, network/filesystem flags) + the static boundary-check section. Read-only static analysis. Dispatches to guild:audit."
argument-hint: ""
allowed-tools: Read, Grep, Glob, Bash, Skill
---

# /guild:audit — self-maintenance (Guild-on-Guild)

Static security audit of installed Guild scripts. Maps to skill
`guild:audit`. **R** static analysis — includes the static
**boundary-check** section.


## Gates

None — **R** (static analysis only).

## Output

`.guild/audit/<date>.md`, including the **boundary-check** section: it scans
for any Guild-owned-file signature (frontmatter `type:`, a
`schema_version: guild.*` marker, or a `task_run`-declared artifact kind)
written **outside** the consuming repo's `.guild/` (including any runtime
write into the plugin install dir) and flags each as a boundary violation.
This is the static belt to the PreToolUse guard's runtime suspenders; both
reuse existing surfaces and add **no new gate**.

## Run-start preflight (settings-control-and-tmux U3/U6)

Before the static audit begins — and before run-trace start — run the
preflight (`scripts/lib/runstart-preflight.ts`; canonical contract in
`guild.md §Run-start preflight`):

1. Call `runStartPreflight({ cwd, flags? })` — resolves the 7-source
   inheritance chain + validates + probes tmux + detects providers
   (full chain: see `/guild:guild §Run-start preflight`).
2. If `needsTmuxPrompt`: show `tmuxPrompt.question`; on YES run
   `npx tsx ${GUILD_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT}}/scripts/config-cmd.ts <...tmuxPrompt.persistCommand> --cwd <cwd>` (U2 HARD-SET);
   on NO continue with the resolved backend.
3. Pass `result.snapshot` to `startRun` — U6 writes
   `.guild/runs/<id>/resolved-settings.json` + `settings_ref` in `run.yaml`.
4. Proceed to run-trace start.

## Run recording

Before the audit skill is invoked, start a run (SC-B, §435):

```bash
node ${GUILD_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT}}/hooks/dist/run-trace.js start \
  --command=/guild:audit \
  --cwd "$(pwd)"
```

`run-class` default (`full`). Records the run before the SHA-256 hash scan
so the complete session — boundary-check and static analysis — is replayable
from the entrypoint. Audit writes to `.guild/audit/` — not
`.guild/initiatives/` (NN#5 unaffected). No `--initiative` flag.

## Dispatch

```
Skill: guild:audit
args: $ARGUMENTS
```

SHA-256 hashes every hook/tooling/MCP file, flags network/egress calls and
filesystem writes outside `.guild/`, runs the static boundary-check, and
writes the dated report. Audit logic and `.guild/` writes live in the
`guild:audit` skill.
