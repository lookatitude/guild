---
name: dashboard
description: "Launch the local benchmark web dashboard over this project's runs + knowledge (runs table, knowledge-graph explorer, wiki browser). Resolves the benchmark checkout, serves on a free local port, bulk-imports the project's run logs, prints the URL. No network I/O without explicit confirmation (--install). Dispatches to guild:dashboard."
argument-hint: "[--port N] [--no-import] [--install] [--dry-run] [--stop]"
allowed-tools: Read, Bash, Skill, AskUserQuestion
---

# /guild:dashboard — visual dashboard over this project

Launches the benchmark factory's web UI **against the live project**
(`--project-root`): imported runs, the knowledge-graph explorer, and the wiki
browser. Server binds 127.0.0.1 only; project routes are read-only.

Initiative: guild-dashboard (WI-3). Contract pinned in
`.guild/spec/v2-gap-closure.md §"The cross-repo dashboard contract"`.

## Args & local flags

- Args: — (no positional)
- `--port N` — preferred port (default 3055; next free port used when bound).
- `--no-import` — skip the bulk lifecycle import of `.guild/runs/*`.
- `--install` — pre-approve the network leg (git clone / npm ci) when no
  benchmark checkout exists. Without it the launcher prints the exact
  commands and exits (REQUIRED-INSTALL) — it never touches the network.
- `--dry-run` — print the resolved plan (checkout, port, run dirs, serve
  command); execute nothing.
- `--stop` — managed shutdown: read the PID record
  (`.guild/cache/dashboard.json`), SIGTERM the server's process group, remove
  the record. Stale records (dead pid) are cleaned up and reported.

## Gates

- **I** (interactive) on REQUIRED-INSTALL: clone/install is network +
  always-ask class — the skill surfaces the exact commands and asks before
  re-running with `--install`. Everything else is localhost-only and ungated.

## Output

Prints the dashboard URL (`http://127.0.0.1:<port>/`), the imported-run
summary (per-run failures non-fatal), and how to stop the server:
`/guild:dashboard --stop` (managed — the spawn is tracked by a durable PID
record at `.guild/cache/dashboard.json` with server output in
`.guild/cache/dashboard.log`; never a fire-and-forget daemon). Re-invoking
while the server is alive reuses it (no second server). No `.guild/` data
writes (only `.guild/cache/`: PID record + log always; `benchmark/` under a
confirmed `--install`).

## Run recording

Before launch, start a lightweight run (SC-B, §435):

```bash
node ${CLAUDE_PLUGIN_ROOT}/hooks/dist/run-trace.js start \
  --command=/guild:dashboard \
  --run-class=lightweight \
  --cwd "$(pwd)"
```

`run-class=lightweight`: dashboard is a read/serve diagnostic, analogous to
stats. No `--initiative` flag (NN#5).

## Dispatch

Thin entrypoint — no business logic here. Invoke the `guild:dashboard` skill
with `$ARGUMENTS` forwarded. The skill resolves the project root (workspace
root when `.guild/workspace.json` is present), runs
`scripts/dashboard-launch.ts`, handles the REQUIRED-INSTALL confirm gate, and
reports URL + import count. All deterministic work (checkout resolution, port
pick, serve spawn, readiness poll, lifecycle imports) lives in the script.
