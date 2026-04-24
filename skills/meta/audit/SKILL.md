---
name: guild-audit
description: Security audit of Guild plugin scripts — SHA256 hashes, source, network + filesystem flags. Produces a static report listing every hook script, tooling script, and MCP server with (a) file hash, (b) declared tool access / allowed-tools frontmatter, (c) any network/egress calls (fetch, http, WebFetch, WebSearch), (d) any filesystem writes outside .guild/. Per §15.1 #12, meta-skills are filesystem-restricted; only agents/researcher.md has web access by default. Per §15.2 "Arbitrary code in installed skills", the plugin is only as safe as its installed-from source — echo Anthropic's "only install from trusted sources" guidance. TRIGGER for "audit Guild scripts", "what does <script>.ts do", "show all network calls from hooks", "list SHA256 hashes for the plugin scripts", "run /guild:audit". DO NOT TRIGGER for: wiki lint (guild:wiki-lint), reviewing a run (guild:review), a security-specialist audit of the user's own application code (agents/security owns), or rolling back a skill (guild:rollback-skill).
when_to_use: Explicit /guild:audit OR periodic (weekly recommended) OR after installing a new skill/hook/MCP from an untrusted source.
type: meta
---

# guild:audit

Implements `guild-plan.md §15.1 #12` (privacy + egress — meta-skills restricted to filesystem; only researcher has web access by default; `/guild:audit` surfaces script hashes) and the `§15.2` "Arbitrary code in installed skills" risk (the plugin is only as safe as its installed-from source — install from trusted sources per Anthropic's guidance).

The audit is **static** — it reads source files, computes hashes, greps for egress and filesystem patterns, and writes a dated report. It does not execute any script under audit.

## Scope

Audits every executable artifact that ships in the plugin:

- `hooks/*.ts` and `hooks/*.sh` — SessionStart, UserPromptSubmit, PostToolUse, SubagentStop, Stop hooks per `§13.2`.
- `hooks/agent-team/*.ts` — `TaskCreated`, `TaskCompleted`, `TeammateIdle` hooks per `§13.2`.
- `scripts/*.ts` — tooling scripts (trace-summarize, flip-report, shadow-mode, description-optimizer, rollback-walker, and any others added in P6).
- `mcp-servers/*` — optional MCP servers per `§13.3` (`guild-memory`, `guild-telemetry`), audited if present.

Does **not** audit:

- `skills/**/SKILL.md` — markdown, no executable code. Skill bodies are instructions to the model, not programs; they are audited by the `guild:evolve-skill` gate and the `guild:wiki-lint` skill for content, not by this skill for egress.
- `agents/*.md` — same rationale.
- `commands/*.md` — same.
- user application code — that's `agents/security` (the shipping specialist), not this skill.

## Per-script report shape

One row per audited script, with the following fields:

- `path` — absolute repo-relative path.
- `sha256` — hex digest of the file bytes.
- `loc` — line count.
- `allowed_tools` — from frontmatter when present (e.g. the hook has `allowed-tools:` declared), else `n/a`.
- `network_evidence` — list of matched lines for `fetch(`, `http.request`, `https.request`, `WebFetch`, `WebSearch`, `axios`, `undici`, `node-fetch`, `got`, `curl` (in `.sh`). Each match records the file:line and the surrounding 1-line context. Empty list ⇒ no evidence of egress.
- `filesystem_write_evidence` — list of matched lines for `writeFile`, `appendFile`, `createWriteStream`, `mkdir`, `rm`, `spawn(`, `exec(`, `execSync`, `>` / `>>` / `tee` in `.sh`. Each match records the file:line + the path argument literal when present.
- `writes_outside_guild` — sub-list of the above where the path literal is NOT under `.guild/runs/`, `.guild/evolve/`, `.guild/skill-versions/`, `.guild/reflections/`, `.guild/wiki/`, `.guild/team/`, `.guild/audit/`, or a temp dir (`os.tmpdir()`, `/tmp`). Any non-empty value here is a red flag surfaced in the summary.
- `notes` — free-form remarks (e.g. "uses child_process to shell out to git", "reads env var GUILD_TOKEN").

## Trust boundary (§15.1 #12, §15.2)

State plainly in the generated report:

- **Meta-skills are filesystem-restricted by convention.** The 13 meta-skills under `skills/meta/` operate on `.guild/` and repo files only. None of them should have network-capable tools declared. Any network-evidence match in a script called by a meta-skill's hook/tooling is a red flag.
- **Only `agents/researcher.md` has web access by default.** It's the only specialist whose frontmatter declares `WebFetch` / `WebSearch`. Any new specialist requesting network access must be surfaced in this audit, and must be user-approved before it ships. The audit lists every `agents/*.md` whose frontmatter declares a network tool (by parsing the `tools:` frontmatter field if present) and flags any that are not `researcher.md`.
- **Plugin is only as safe as its installed-from source (§15.2).** Echo Anthropic's guidance: *only install Claude Code plugins from trusted sources.* The report includes a one-paragraph trust-reminder section at the top, above the per-script table, so the user re-reads it every audit.

## Output

Write the report to `.guild/audit/<YYYY-MM-DD>.md` using today's date. If the file already exists (repeat audit on the same day), append a new section rather than overwrite — audits are append-only so drift across the day is visible.

Structure:

1. **Trust reminder** — one paragraph, per the Trust boundary section above.
2. **Summary table** — one row per script, with `path`, `sha256` (short, first 12 chars), `network: yes/no`, `writes_outside_guild: yes/no`, `loc`.
3. **Per-script detail** — the full fields from the Per-script report shape, one section per script.
4. **Specialists with network access** — a short list of `agents/*.md` files whose frontmatter declares `WebFetch` or `WebSearch`. Expected: only `researcher.md`. Any other entry is flagged.
5. **Drift against previous audit** — compare the sha256s against the most recent prior audit in `.guild/audit/`. Any changed hash is surfaced with the old/new values and the script's path. New scripts are flagged as `NEW since last audit`. Deleted scripts are flagged as `REMOVED since last audit`.

## Handoff

Emit a `handoff` block with the audit-run metadata and a pointer to `/guild:stats` for drift surfacing.

Payload fields:

- `audit_path` — the written `.guild/audit/<YYYY-MM-DD>.md`.
- `script_count` — total scripts audited.
- `network_flag_count` — scripts with non-empty `network_evidence`.
- `write_outside_guild_count` — scripts with non-empty `writes_outside_guild`.
- `nonresearcher_web_agents` — list of `agents/*.md` files with web access other than `researcher.md` (expected: empty list).
- `hashes_changed_since_last_audit` — list of `{path, old_sha256, new_sha256}` entries; empty on the first audit.
- `prior_audit_path` — the prior audit file compared against, or `null` on the first audit.

`/guild:stats` reads the audit handoff to surface any CHANGED hashes on the next stats view so the user sees drift without re-running the audit. Hash drift is not inherently bad — edits happen — but it should never be invisible.
