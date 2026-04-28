# Status-line

Guild v1.4 ships an optional status-line script that surfaces the active run's phase, current loop round, cap, loops mode, and restart count as a single line beneath your Claude Code prompt. The script is opt-in; with default flags it never runs.

This page documents how to wire `scripts/statusline-guild.sh` into Claude Code's `statusLine` configuration and what its output means.

## When to enable it

Enable the status-line when you want at-a-glance visibility into:

- Which lifecycle phase the orchestrator is in.
- How many loop rounds the active lane has consumed against the cap.
- Whether a restart fired.

Keep it disabled if you do not run with `--loops=...` or do not need the per-lane visibility.

## Wire-up

Claude Code reads its status-line config from `~/.claude/settings.json`. Add a `statusLine` block pointing at the script:

```json
{
  "statusLine": {
    "type": "command",
    "command": "${CLAUDE_PLUGIN_ROOT}/scripts/statusline-guild.sh"
  }
}
```

The `${CLAUDE_PLUGIN_ROOT}` placeholder resolves to the Guild plugin directory at runtime. If you prefer an absolute path, substitute the path to your Guild checkout.

Then export the two operator-side environment variables before invoking `/guild`:

```bash
export GUILD_STATUSLINE=1
export GUILD_RUN_ID=<run-id>
```

`GUILD_STATUSLINE=1` opts you into the status-line surface. `GUILD_RUN_ID` tells the script which run to read — the orchestrator exports it before each lifecycle phase, but exporting it manually in your shell ensures the status-line reads the correct run from the moment Claude Code spawns.

You can also opt in via the CLI flag `--statusline` on the `/guild` invocation; either path is equivalent.

## Output modes

The script emits a single line to stdout, exit `0` always. There are three modes; which one fires depends on environment state at the moment the script runs.

| Mode | Triggered when | Output |
|---|---|---|
| A | `GUILD_RUN_ID` is set AND `<run-dir>/counters.json` exists | `phase: <p> \| round: <r> \| cap: <c> \| loops: <m> \| restarts: <n>` |
| B | `GUILD_RUN_ID` is unset or empty | `phase: unknown` |
| C | `GUILD_RUN_ID` is set but `<run-dir>/counters.json` is missing | `phase: <run-id> (initialising)` |

Mode A is the steady-state output during a live run. Mode B is what you see when the variable was never exported — the script does not guess which run is live. Mode C is the transient state between run-init and the first counter write.

### Field meanings (Mode A)

| Field | Source | Notes |
|---|---|---|
| `phase` | `GUILD_PHASE` env var | One of the lifecycle phases (`brainstorm`, `team-compose`, `plan`, `context-assemble`, `execute-plan`, `review`, `verify-done`). When unset, the script reports `unknown`. |
| `round` | counters in `<run-dir>/counters.json` | When `GUILD_LANE_ID` is set, the script reports the lane's per-lane round (`max(L3_round, L4_round, security_round)`); otherwise the orchestrator-level round (`max(l1_round, l2_round)`). |
| `cap` | `GUILD_LOOP_CAP` env var | Defaults to `16` when unset. |
| `loops` | `GUILD_LOOPS` env var | Defaults to `none` when unset. The active loops-mode keyword or comma-list. |
| `restarts` | counters in `<run-dir>/counters.json` | Per-lane `restart_count`; `0` when no lane is active. |

## Verify the wiring

Before relying on the status-line, validate one of the modes fires. The smoke test below is portable across macOS and Linux.

### Mode B (no run id)

```bash
unset GUILD_RUN_ID
bash scripts/statusline-guild.sh </dev/null
```

Expected output:

```
phase: unknown
```

### Mode C (run id set, run dir empty)

```bash
export GUILD_RUN_ID=run-smoke-test
mkdir -p .guild/runs/run-smoke-test
bash scripts/statusline-guild.sh </dev/null
```

Expected output:

```
phase: run-smoke-test (initialising)
```

### Mode A (run id set, counters present)

```bash
export GUILD_RUN_ID=run-smoke-test
mkdir -p .guild/runs/run-smoke-test
cat > .guild/runs/run-smoke-test/counters.json <<'JSON'
{
  "schema_version": 1,
  "run_id": "run-smoke-test",
  "counters": {
    "l1_round": 2,
    "l2_round": 0
  }
}
JSON
bash scripts/statusline-guild.sh </dev/null
```

Expected output:

```
phase: unknown | round: 2 | cap: 16 | loops: none | restarts: 0
```

The leading `phase: unknown` is correct — `GUILD_PHASE` was not exported in the smoke. In a live run, the orchestrator exports `GUILD_PHASE` before each lifecycle phase.

Clean up after the smoke test:

```bash
rm -rf .guild/runs/run-smoke-test
```

## Operator setup paths

There are two supported ways to make `GUILD_RUN_ID` available to the status-line process.

1. **Manual export.** Before invoking `/guild`:

   ```bash
   export GUILD_RUN_ID="run-$(date -u +%Y-%m-%d)-mybrief"
   /guild --statusline "<brief>"
   ```

   The orchestrator picks up the exported value and uses it as the run dir name.

2. **Auto-export from the orchestrator.** When `GUILD_RUN_ID` is unset at invocation, the orchestrator generates a run-id and writes it to `.guild/runs/.current-run-id` for operator convenience. Subsequent shells can `cat` that file and `export GUILD_RUN_ID=<value>` to pick up the same run.

The script reads `GUILD_RUN_ID` from the environment only — it does not consult `.guild/runs/.current-run-id` itself. The env var is the single source of truth.

## Stdin handling

Claude Code passes a JSON `input_json` blob on stdin per its status-line convention. The script drains up to 32 KB of stdin (`head -c 32768`) but does not depend on the contents — env vars are the primary input. Reading stdin prevents Claude Code from blocking on a closed pipe.

## What you do NOT need to install

The script is self-contained. It does not require `jq`. JSON parsing for `counters.json` runs through an inline `node -e` block — Node is already a Guild dependency because the hook handlers run on it. No additional installs.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Status-line is blank or shows the Claude Code default | `GUILD_STATUSLINE=1` not exported, or `~/.claude/settings.json` `statusLine` block missing | Set the env var and add the JSON block above. |
| Status-line shows `phase: unknown` during a run | `GUILD_RUN_ID` not exported in the shell Claude Code spawned in | Export it manually before launching, or open a new shell after `/guild` writes `.guild/runs/.current-run-id`. |
| Status-line shows `phase: <run-id> (initialising)` and never advances | `counters.json` not yet written by the run | Wait for the first lifecycle phase to start; if the run is stuck, check `.guild/runs/<run-id>/logs/v1.4-events.jsonl` for errors. |
| Status-line script errors in Claude Code | Permission bit missing on `scripts/statusline-guild.sh` | `chmod +x scripts/statusline-guild.sh`. |
