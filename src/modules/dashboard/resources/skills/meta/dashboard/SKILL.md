---
name: guild-dashboard
description: Launch the local benchmark web dashboard over THIS project's runs + knowledge — resolves the benchmark checkout (workspace sibling → in-repo → .guild/cache clone), starts `serve --project-root` on a free port (default 3055), bulk-imports the project's `.guild/runs/*/logs/v1.4-events.jsonl` via the lifecycle-import API, and prints the URL (runs table + Knowledge view + Wiki browser). All deterministic work lives in `scripts/dashboard-launch.ts`; NO network I/O (git clone / npm ci) ever happens without an explicit user confirmation → `--install`. TRIGGER for "open the dashboard", "visualize the runs", "show the knowledge graph", "launch the benchmark UI", "/guild:dashboard", "browse the wiki visually". DO NOT TRIGGER for the text-mode usage/telemetry dashboard (/guild:stats owns that — it prints, never serves), for developing or modifying the benchmark itself (that is benchmark-repo work, not a launch), or for importing a single run by hand (POST /api/imports/lifecycle directly).
when_to_use: Explicit /guild:dashboard, or when the user asks to SEE runs / knowledge graph / wiki in a browser UI rather than as text output.
type: meta
---

# guild:dashboard

Implements the dashboard leg of the guild-dashboard initiative (v2-gap-closure
G-16 / SC-11). Thin `/guild:dashboard` command → this skill → the deterministic
launcher `scripts/dashboard-launch.ts`. The skill's job is root resolution, the
install confirmation gate, running the script, and reporting — **never**
re-implementing the launcher's logic in prose.

The cross-repo API contract (serve flags, project routes, lifecycle import,
127.0.0.1 bind) is PINNED in `.guild/spec/v2-gap-closure.md §"The cross-repo
dashboard contract"` — consume it, never redefine it. Integration with the
separate guild-benchmark repo is process + localhost-HTTP only; zero code imports either direction
(telemetry split).

## Workflow

### 1. Resolve the project root

- Default: the guild root of the current directory (the launcher walks up to
  the nearest ancestor containing `.guild/`; you may pass `--project-root
  <abs>` explicitly).
- **Workspace note:** when working at a workspace root (a directory whose
  `.guild/workspace.json` is a `guild.workspace.v1` manifest), pass the
  **workspace root** as `--project-root` — the benchmark's live mode is
  workspace-aware per the spec contract: it federates wiki + knowledge-graph
  read-only across `sub_guilds`, tagging every page/node with `source_guild`.
  Do NOT point the dashboard at one child when the user asked about "the
  workspace".

### 2. Run the launcher (default = no network, no install)

```bash
npx tsx ${GUILD_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT}}/scripts/dashboard-launch.ts \
  --project-root <abs-root> [--port <n>] [--no-import] [--dry-run]
```

Flags (all optional): `--port <n>` (default 3055; auto-falls-forward to the
next free port when bound), `--no-import` (skip the lifecycle bulk import),
`--dry-run` (print the full plan — resolved checkout, port, run-dir count,
exact serve command — and execute nothing), `--stop` (managed shutdown, §2b).

The launcher is deterministic: it resolves the guild-benchmark checkout in order
(1) workspace sibling `<root>/../guild-benchmark`, (1b) cached clone `<root>/.guild/cache/benchmark`; starts
`npm run benchmark -- serve --port <p> --project-root <root>` detached (the
server must outlive the launcher so the user can browse) but **managed, never
a fire-and-forget daemon**: server stdout/stderr go to
`<root>/.guild/cache/dashboard.log`, and a durable PID record
`{pid, port, project_root, benchmark_dir, started_at}` is written atomically
to `<root>/.guild/cache/dashboard.json` immediately after spawn — `--stop`
consumes it. The launcher then polls `GET /api/runs` for readiness and POSTs
each discovered `.guild/runs/<id>` (those with `logs/v1.4-events.jsonl`) to
`POST /api/imports/lifecycle {run_dir}` — per-run failures are reported and
non-fatal.

**Reuse, never double-spawn:** when the PID record points at a live server
(pid alive + port answering), the launcher reuses it — re-running the import
step (unless `--no-import`) and printing the existing URL. A stale record
(dead pid / unresponsive port) is cleaned up automatically, then a fresh
launch proceeds.

### 2b. Stopping the dashboard — `--stop`

```bash
npx tsx ${GUILD_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT}}/scripts/dashboard-launch.ts \
  --project-root <abs-root> --stop
```

Reads the PID record, liveness-checks the pid, SIGTERMs the server's process
group, and removes the record. A stale record (dead pid) is cleaned up and
reported; no record means nothing to stop — both exit 0. When the user is
done with the dashboard (or asks to stop/close it), run `--stop` — never
hand-kill PIDs.

### 3. Exit 3 = REQUIRED-INSTALL — confirm before any network

Exit code 3 means no usable checkout (or its `node_modules`) exists and the
launcher refused to fetch anything — it printed the **exact** commands instead
(`git clone … .guild/cache/benchmark` and/or `cd … && npm ci`).

**Network + package install are always-ask class. Never pass `--install`
without an explicit user confirmation in this session.** Surface the printed
commands and ask:

```
The dashboard needs a benchmark checkout (none found as a sibling or cache).
This requires network: <printed commands>
Approve clone + install? [yes — re-run with --install / no — stop]
```

- **yes** → re-run the same launcher invocation with `--install` appended.
- **no** → stop; tell the user they can run the printed commands themselves
  and re-invoke `/guild:dashboard`.

### 4. Report

On exit 0, report compactly:

- the dashboard URL (e.g. `http://127.0.0.1:3055/`),
- imported-run count (`N/M imported`, list any per-run failures),
- whether an already-running server was reused,
- how to stop it: `/guild:dashboard --stop` (PID record at
  `.guild/cache/dashboard.json`; server log at `.guild/cache/dashboard.log`).

## Troubleshooting

| Symptom | Meaning / action |
|---|---|
| `port 3055 is busy — using 3056` | Normal — the launcher picks the next free port; pin one with `--port`. |
| User wants the dashboard gone | Run the launcher with `--stop` (managed: SIGTERMs the recorded process group + removes the record). |
| `reusing running dashboard` | A live server from a previous launch was found via the PID record — no second server is spawned; imports re-ran against it. |
| `stale dashboard record … cleaning up` | A previous server died without `--stop`; the record was removed and a fresh launch proceeded. Harmless. |
| Exit 3 (REQUIRED-INSTALL) | No checkout / no deps; see §3 — confirm, then `--install`. Never run clone/install silently. |
| Exit 2 (readiness timeout) | Server spawned but `GET /api/runs` never answered in 30s. Inspect `.guild/cache/dashboard.log`, clean up with `--stop`, and retry; a stale checkout often needs `npm ci` (→ §3 flow). |
| `imported 0/0 run(s)` | No `.guild/runs/*/logs/v1.4-events.jsonl` yet — the runs table is empty but the Knowledge view + Wiki browser still work off `--project-root`. Run a `/guild` lifecycle to produce runs. |
| `no .guild/ directory found` | cwd is not inside a Guild project — pass `--project-root` or run `/guild:init` first. |
| Knowledge/Wiki views empty | The project has no `.guild/indexes/knowledge-graph.json` / `.guild/wiki/` yet — `/guild:learn` (graph) and `/guild:init` (wiki) produce them. |

## Boundaries

- Read-only over `.guild/` data (the server's project routes are read-only and
  bind 127.0.0.1). The launcher writes only under `.guild/cache/`: the
  `dashboard.json` PID record + `dashboard.log` on every launch, and
  `benchmark/` only under a confirmed `--install`.
- This skill never edits benchmark code, never re-implements the import logic,
  and never re-derives the API contract — script + pinned spec own those.
