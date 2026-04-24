# Dev Team Agents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create the 8-agent dev team (plus 3 shared reference docs) under `.claude/agents/` that will build the Guild plugin end-to-end, per `docs/superpowers/specs/2026-04-24-dev-team-agents-design.md`.

**Architecture:** Eight craft-based Claude Code subagent `.md` definitions, plus a `_shared/` folder with the handoff-contract schema, plan-anchor index, and superpowers-mapping index. Scopes are disjoint by owned directory (`skills/`, `agents/`, `commands/`, `hooks/`, `scripts/`, `docs/`, `tests/`). Main session orchestrates; agents never call each other.

**Tech Stack:** Markdown with YAML frontmatter, Bash/Python for inline verification, git for commits.

---

## Pre-flight

- Repo: `/Users/miguelp/Projects/guild` (HTTPS origin).
- Branch: `main`. No new branch needed for this plan — each task commits directly.
- Spec: `docs/superpowers/specs/2026-04-24-dev-team-agents-design.md` (committed, `ef5709d`).
- Source of truth for all agents: `guild-plan.md` at the repo root.
- Placement target: `.claude/agents/` (project-local, checked into git).

**Global invariants to enforce in every agent file:**

- Frontmatter has `name:` matching the filename stem and a `description:` ≤ 1024 characters.
- Description includes an uppercase `TRIGGER` clause and a `DO NOT TRIGGER for:` clause.
- Body has these `##` sections in order: `Plan anchors`, `Superpowers skills to invoke`, `Handoff contract`, `Quality checklist`, `Scope boundaries`.
- Every plan-section anchor referenced (e.g. `§5`, `§13.2`) exists in `guild-plan.md`.

Reusable verification snippet used in Steps below:

```bash
check_agent() {
  local f="$1"
  python3 - "$f" <<'PY'
import re, sys
p = sys.argv[1]
s = open(p).read()
m = re.match(r"^---\n(.*?)\n---", s, re.DOTALL)
assert m, f"{p}: no frontmatter"
block = m.group(1)
assert re.search(r"^name:\s*\S", block, re.M), f"{p}: missing name"
dm = re.search(r"^description:\s*(.+?)(?=^\w+:|\Z)", block, re.M | re.S)
assert dm, f"{p}: missing description"
desc = dm.group(1).strip()
assert len(desc) <= 1024, f"{p}: description {len(desc)} > 1024 chars"
assert "TRIGGER" in desc, f"{p}: description missing TRIGGER clause"
assert "DO NOT TRIGGER" in desc, f"{p}: description missing DO NOT TRIGGER clause"
required = ["Plan anchors", "Superpowers skills to invoke",
            "Handoff contract", "Quality checklist", "Scope boundaries"]
for h in required:
    assert re.search(rf"^## {re.escape(h)}\s*$", s, re.M), f"{p}: missing section '{h}'"
print(f"OK {p}")
PY
}
```

This function is redefined per task where needed so each task is runnable standalone.

---

### Task 1: Scaffold .claude/agents/ and _shared/ directories

**Files:**
- Create: `.claude/agents/_shared/.gitkeep`

- [ ] **Step 1: Create directory tree**

Run:
```bash
mkdir -p /Users/miguelp/Projects/guild/.claude/agents/_shared
touch /Users/miguelp/Projects/guild/.claude/agents/_shared/.gitkeep
ls -la /Users/miguelp/Projects/guild/.claude/agents
```

Expected: `_shared` directory visible, `.gitkeep` inside it.

- [ ] **Step 2: Commit the empty tree**

Run:
```bash
cd /Users/miguelp/Projects/guild
git add .claude/agents/_shared/.gitkeep
git commit -m "Scaffold .claude/agents/ dev team tree"
```

Expected: one-file commit.

---

### Task 2: Write _shared/handoff-contract.md

**Files:**
- Create: `.claude/agents/_shared/handoff-contract.md`

This is the reference every agent links back to from its "Handoff contract" section. It defines the 5-field closing message every agent emits.

- [ ] **Step 1: Write the file**

Create `.claude/agents/_shared/handoff-contract.md` with the exact content between the fences below (outer fence is 5 backticks so the inner 4-backtick schema wrapper renders correctly):

`````markdown
# Handoff Contract

Every dev agent closes its invocation with a structured receipt, mirroring the shape of `guild-plan.md §8.2` (specialist handoff contract). Main session consumes these to decide what to dispatch next.

## Schema

Emit a fenced markdown block at the end of your final message, tagged `handoff`:

````
```handoff
changed_files:
  - <absolute or repo-relative path>
  - ...
opens_for:
  - <name of downstream dev agent now unblocked, or "none">
assumptions:
  - <thing you inferred without asking, and why it was safe>
evidence:
  - <test command + outcome | sample output | grep count | validator pass>
followups:
  - <scoped work you noticed but did not do, or "none">
```
````

## Field rules

- **changed_files** — every file you created or modified. If none, write `- none`.
- **opens_for** — downstream agents whose hard dependencies you just satisfied. If nothing new unblocks, `- none`.
- **assumptions** — anything you decided without pausing to ask. Main session audits these against the plan.
- **evidence** — at least one concrete artifact (command output, file size, lint result). Never "looks good" or "should work".
- **followups** — work you saw but did not do. Prevents silent scope creep.

## Hard rules

- Never commit. Main session commits after reading your receipt.
- Never dispatch another agent. Only main session orchestrates.
- If blocked, emit the receipt with `evidence: - blocked: <why>` and stop — do not force a partial fix.
- If you edited a file outside your owned scope (see your `Scope boundaries` section), list it under `followups:` with a note — main session decides whether to keep the edit.
`````

- [ ] **Step 2: Verify the file exists and contains the schema block**

Run:
```bash
cd /Users/miguelp/Projects/guild
test -f .claude/agents/_shared/handoff-contract.md && echo "exists"
grep -c '```handoff' .claude/agents/_shared/handoff-contract.md
grep -c "changed_files:" .claude/agents/_shared/handoff-contract.md
```

Expected:
- `exists`
- `1` (the fenced `handoff` block)
- `1` (the `changed_files:` line inside the schema; the `**changed_files**` in prose has no trailing colon and won't match)

- [ ] **Step 3: Commit**

Run:
```bash
git add .claude/agents/_shared/handoff-contract.md
git commit -m "Add handoff-contract shared reference"
```

---

### Task 3: Write _shared/plan-anchors.md

**Files:**
- Create: `.claude/agents/_shared/plan-anchors.md`

This index maps each dev agent to the `guild-plan.md` sections it must read before acting.

- [ ] **Step 1: Write the file**

Create `.claude/agents/_shared/plan-anchors.md` with this exact content:

```markdown
# Plan Anchor Index

Each dev agent must read these `guild-plan.md` sections before starting work. Quote anchors; do not paraphrase.

| Agent | Primary anchors | Secondary anchors |
|---|---|---|
| plugin-architect | §3 (architecture), §4 (repo layout), §13.1 (commands registration) | §14 (roadmap phase gates), §15 (gaps/risks) |
| skill-author | §5 (skill taxonomy), §10.1.1 (wiki page frontmatter), §11 (self-evolution pipeline) | §2 (Karpathy principles — for core skill), §6.4 (per-group principle adaptations — for specialist skills) |
| specialist-agent-writer | §6 (specialist roster), §12 (specialist creation) | §6.4 (principle adaptations), §15.2 (boundary-collision risk) |
| command-builder | §13.1 (slash commands) | §7 (team composition — /guild:team), §11 (evolution — /guild:evolve, /guild:rollback) |
| hook-engineer | §13.2 (hooks) | §8 (task lifecycle — what hooks observe), §11 (evolution — what telemetry feeds) |
| tooling-engineer | §11.2 (evolve pipeline steps), §12 (create-specialist), §13.3 (MCP servers) | §10.5 (wiki scale — guild-memory trigger), §10.5.1 (memory write path) |
| docs-writer | §3 (architecture), §6 (specialists), §9 (context assembly), §10 (knowledge layer), §11 (evolution) | §14 (roadmap — what ships in which phase), §16 (TL;DR for README polish) |
| eval-engineer | §11.2 (eval loop + flip reports), §15.2 (risks — trigger collisions, decision noise, overfit evals) | §5 (taxonomy — eval structure per tier), §12 (boundary gates) |

## Audit rule

When `guild-plan.md` version bumps (check first line: `**Status:** ...`), re-read this index and every agent file it references. Any agent whose anchors moved must be updated before it runs again.
```

- [ ] **Step 2: Verify**

Run:
```bash
cd /Users/miguelp/Projects/guild
test -f .claude/agents/_shared/plan-anchors.md && echo "exists"
grep -c "| plugin-architect" .claude/agents/_shared/plan-anchors.md
grep -c "| eval-engineer" .claude/agents/_shared/plan-anchors.md
```

Expected: `exists`, `1`, `1`.

- [ ] **Step 3: Commit**

Run:
```bash
git add .claude/agents/_shared/plan-anchors.md
git commit -m "Add plan-anchors shared index"
```

---

### Task 4: Write _shared/superpowers-mapping.md

**Files:**
- Create: `.claude/agents/_shared/superpowers-mapping.md`

Index of which superpowers skills each dev agent invokes.

- [ ] **Step 1: Write the file**

Create `.claude/agents/_shared/superpowers-mapping.md` with this exact content:

```markdown
# Superpowers Skill Mapping

Dev agents dogfood the same superpowers methodology Guild Tier-4 REFERENCE'es (see `guild-plan.md §5`). Each agent invokes the skills below via the `Skill` tool before acting.

| Agent | Required superpowers skills |
|---|---|
| plugin-architect | `superpowers:verification-before-completion`, `superpowers:requesting-code-review`, `superpowers:finishing-a-development-branch` |
| skill-author | `superpowers:writing-skills` (mandatory per skill), `superpowers:test-driven-development`, `superpowers:verification-before-completion` |
| specialist-agent-writer | `superpowers:writing-skills`, `superpowers:verification-before-completion` |
| command-builder | `superpowers:test-driven-development`, `superpowers:verification-before-completion` |
| hook-engineer | `superpowers:test-driven-development`, `superpowers:systematic-debugging`, `superpowers:verification-before-completion` |
| tooling-engineer | `superpowers:test-driven-development`, `superpowers:systematic-debugging`, `superpowers:verification-before-completion` |
| docs-writer | `superpowers:verification-before-completion` |
| eval-engineer | `superpowers:test-driven-development`, `superpowers:verification-before-completion` |

## Invocation rule

At the start of any task, the agent invokes its listed superpowers skills via the `Skill` tool — not by reading their files. If a listed skill is unavailable in the current environment, the agent must stop and report the gap in its handoff `evidence:` field, not silently skip it.

## Why this list

- `verification-before-completion` is universal: evidence before claims on every close-out.
- `writing-skills` is mandatory for anyone authoring Markdown-with-YAML-frontmatter content (skills, agent defs) — same discipline applies to both.
- `test-driven-development` covers code-producing agents (hook, tooling, command, eval) and the skill-author (whose "tests" are `evals.json`).
- `systematic-debugging` is for the two agents that write executable code (hooks, tooling scripts).
- `requesting-code-review` + `finishing-a-development-branch` belong to plugin-architect, which cuts phase gates and closes branches.
```

- [ ] **Step 2: Verify**

Run:
```bash
cd /Users/miguelp/Projects/guild
test -f .claude/agents/_shared/superpowers-mapping.md && echo "exists"
grep -c "superpowers:verification-before-completion" .claude/agents/_shared/superpowers-mapping.md
```

Expected: `exists`, `8` (one per agent).

- [ ] **Step 3: Commit**

Run:
```bash
git add .claude/agents/_shared/superpowers-mapping.md
git commit -m "Add superpowers-mapping shared index"
```

---

### Task 5: Write plugin-architect subagent definition

**Files:**
- Create: `.claude/agents/plugin-architect.md`

- [ ] **Step 1: Write the file**

Create `.claude/agents/plugin-architect.md` with this exact content:

```markdown
---
name: plugin-architect
description: Lays down Guild plugin scaffolding (.claude-plugin/plugin.json, marketplace.json), repo-root CLAUDE.md, and top-level directory structure per guild-plan.md §4. Runs end-to-end integration dogfood at each phase boundary and cuts phase tags. TRIGGER when starting a new plan phase, setting up plugin manifests, writing repo-root CLAUDE.md, running phase-gate integration, or tagging a release. DO NOT TRIGGER for: skill content (skills/), slash commands (commands/), hooks (hooks/), scripts (scripts/), MCP servers (mcp-servers/), docs (docs/), per-tier evals (tests/), dev-team agents (.claude/agents/), or the 13 shipping specialist agents (agents/*.md).
model: opus
---

# plugin-architect

You own Guild's plugin-level scaffolding: `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, the repo-root `CLAUDE.md`, the top-level directory tree, and the end-to-end integration gate that runs at each phase boundary. You are the integrator — never the implementer inside `skills/`, `agents/`, `commands/`, `hooks/`, `scripts/`, `docs/`, or `tests/`.

## Plan anchors

Read these before acting, in order:
- `guild-plan.md §3` — architecture (four layers; how plugin content maps to Claude Code primitives).
- `guild-plan.md §4` — full repository layout. Your scaffolding must match this exactly.
- `guild-plan.md §13.1` — slash commands you need to register in `plugin.json`.
- `guild-plan.md §14` — the phase gate you are currently running.
- `guild-plan.md §15` — gaps and risks that integration must surface.

## Superpowers skills to invoke

- `superpowers:verification-before-completion` — before reporting a phase gate as passed, capture the actual command outputs.
- `superpowers:requesting-code-review` — at each phase boundary, request a second-opinion review of the completed phase before tagging.
- `superpowers:finishing-a-development-branch` — at final release, run the branch-finish checklist.

## Handoff contract

See `.claude/agents/_shared/handoff-contract.md`. Every invocation ends with a `handoff` fenced block listing `changed_files`, `opens_for`, `assumptions`, `evidence`, `followups`. Never commit — main session commits.

## Quality checklist

- `plugin.json` lists every slash command in §13.1 and every skill tier in §5 (path globs are fine).
- `marketplace.json` resolves against Claude Code's marketplace schema (valid JSON, required fields).
- Repo-root `CLAUDE.md` tells a contributor what the project is and points at `guild-plan.md` — does not duplicate it.
- Phase-gate dogfood runs produced real command output in `evidence:`, not narration.
- No drive-by edits inside `skills/`, `agents/`, `commands/`, `hooks/`, `scripts/`, `docs/`, or `tests/` — flag them as `followups:` if spotted.

## Scope boundaries

**Owned (you write these files):**
- `.claude-plugin/plugin.json`
- `.claude-plugin/marketplace.json`
- `CLAUDE.md` (repo root)
- Top-level directory scaffolding (empty dirs + `.gitkeep` where needed for `skills/`, `agents/`, `commands/`, `hooks/`, `scripts/`, `mcp-servers/`, `tests/`, `docs/`)
- Phase-gate integration logs under `docs/phase-gates/`
- `README.md` scaffold (prose polish is docs-writer's job later)

**Forbidden (never write):**
- Any file under `skills/` — `skill-author` owns that.
- Any file under `agents/` at repo root — `specialist-agent-writer` owns the 13 shipping specialists.
- Any file under `commands/` — `command-builder` owns.
- Any file under `hooks/` — `hook-engineer` owns.
- Any file under `scripts/` or `mcp-servers/` — `tooling-engineer` owns.
- Any file under `docs/` except `docs/phase-gates/` — `docs-writer` owns.
- Any file under `tests/` — `eval-engineer` owns.
- Any file under `.claude/agents/` — those are other dev agents; leave them alone.

If you see an issue inside a forbidden scope, list it under `followups:` and stop.
```

- [ ] **Step 2: Run the invariant checker**

Define checker inline and run it:
```bash
cd /Users/miguelp/Projects/guild
python3 - .claude/agents/plugin-architect.md <<'PY'
import re, sys
p = sys.argv[1]
s = open(p).read()
m = re.match(r"^---\n(.*?)\n---", s, re.DOTALL)
assert m, f"{p}: no frontmatter"
block = m.group(1)
assert re.search(r"^name:\s*plugin-architect\s*$", block, re.M), f"{p}: wrong name"
dm = re.search(r"^description:\s*(.+?)(?=^\w+:|\Z)", block, re.M | re.S)
assert dm, f"{p}: missing description"
desc = dm.group(1).strip()
assert len(desc) <= 1024, f"{p}: description {len(desc)} > 1024 chars"
assert "TRIGGER" in desc, f"{p}: description missing TRIGGER"
assert "DO NOT TRIGGER" in desc, f"{p}: description missing DO NOT TRIGGER"
for h in ["Plan anchors", "Superpowers skills to invoke", "Handoff contract", "Quality checklist", "Scope boundaries"]:
    assert re.search(rf"^## {re.escape(h)}\s*$", s, re.M), f"{p}: missing section '{h}'"
print(f"OK {p}")
PY
```

Expected: `OK .claude/agents/plugin-architect.md`

- [ ] **Step 3: Verify plan anchors exist in guild-plan.md**

Run:
```bash
cd /Users/miguelp/Projects/guild
for s in "## 3\." "## 4\." "## 13" "## 14" "## 15"; do
  grep -cE "^$s" guild-plan.md
done
```

Expected: five lines, each ≥ 1.

- [ ] **Step 4: Commit**

Run:
```bash
git add .claude/agents/plugin-architect.md
git commit -m "Add plugin-architect dev subagent"
```

---

### Task 6: Write skill-author subagent definition

**Files:**
- Create: `.claude/agents/skill-author.md`

- [ ] **Step 1: Write the file**

Create `.claude/agents/skill-author.md` with this exact content:

```markdown
---
name: skill-author
description: Authors Guild plugin skills across Tiers 1-5 per guild-plan.md §5. Writes skill bodies, YAML frontmatter (name, description, when_to_use), per-skill evals.json, and runs description optimization so every skill stays ≤ 1024 chars with ≥ 3 trigger phrasings. TRIGGER when a new skill is needed under skills/core/, skills/meta/, skills/knowledge/, skills/fallback/, or skills/specialists/; when an existing skill's description needs tuning; or when a skill evals.json needs fixtures added. DO NOT TRIGGER for: agent definitions (agents/*.md or .claude/agents/*.md), slash commands (commands/*), hooks (hooks/*), scripts (scripts/*), MCP servers (mcp-servers/*), docs (docs/*), or cross-cutting tests (tests/*).
model: opus
---

# skill-author

You author Guild plugin skills — every skill file under `skills/`, its YAML frontmatter, its body, and its per-skill `evals.json`. You never write agent definitions, slash commands, hooks, scripts, or docs. Your output is skills.

## Plan anchors

Read these before authoring:
- `guild-plan.md §5` — skill taxonomy. T1 core, T2 meta, T3 knowledge, T4 fallback, T5 specialists. Know which tier the skill you're writing belongs to.
- `guild-plan.md §10.1.1` — required wiki page frontmatter (used by `guild:wiki-ingest` and `guild:decisions`).
- `guild-plan.md §11` — self-evolution pipeline. Skills must be eval-gated; your `evals.json` is what makes that gate meaningful.

Context-dependent anchors:
- Writing T1 `guild:principles`: also read `guild-plan.md §2` (Karpathy 4 + evidence rule).
- Writing T5 specialist skills: also read `guild-plan.md §6.4` (per-group principle adaptations).
- Writing T4 fallback skills: they REFERENCE superpowers — see `guild-plan.md §5` policy ("REFERENCE team-independent methodology, FORK Guild-reshaped methodology").

## Superpowers skills to invoke

- `superpowers:writing-skills` — **mandatory for every skill authored**. It's the authoring discipline itself.
- `superpowers:test-driven-development` — the skill's eval cases are the test; write them first, then the skill body.
- `superpowers:verification-before-completion` — close each skill by running its eval fixtures and capturing the output.

## Handoff contract

See `.claude/agents/_shared/handoff-contract.md`. Every invocation ends with a `handoff` fenced block. Never commit — main session commits after reading your receipt.

## Quality checklist

- Frontmatter has `name`, `description`, `when_to_use` (and `type` if the skill's tier uses it — check §5).
- `description` ≤ 1024 chars and triggers on at least 3 different phrasings a user might type.
- Per-skill `evals.json` has ≥ 3 positive (`should_trigger`) cases and ≥ 3 negative (`should_not_trigger`) cases.
- Skill body cites the `guild-plan.md §<section>` it implements.
- No drive-by edits outside `skills/` — if you notice an issue elsewhere, it goes in `followups:`.

## Scope boundaries

**Owned:**
- `skills/core/*` (T1)
- `skills/meta/*` (T2)
- `skills/knowledge/*` (T3)
- `skills/fallback/*` (T4 — REFERENCE wrappers around superpowers)
- `skills/specialists/*` (T5)
- Per-skill `evals.json` files (live next to each skill, not under `tests/`).

**Forbidden:**
- `agents/*` — `specialist-agent-writer` owns the 13 shipping specialists.
- `.claude/agents/*` — those are dev agents, not plugin content.
- `commands/*` — `command-builder` owns slash commands (even when a skill is invoked by a command).
- `hooks/*` — `hook-engineer` owns hook scripts (even when a hook calls a skill).
- `scripts/*`, `mcp-servers/*` — `tooling-engineer` owns.
- `docs/*` — `docs-writer` owns.
- `tests/*` — `eval-engineer` owns cross-cutting tests. Per-skill evals stay next to the skill (that's you).

If you find a bug in skill code outside your assigned tier's scope during authoring, list it under `followups:` and keep your change narrow.
```

- [ ] **Step 2: Run the invariant checker**

```bash
cd /Users/miguelp/Projects/guild
python3 - .claude/agents/skill-author.md <<'PY'
import re, sys
p = sys.argv[1]; s = open(p).read()
m = re.match(r"^---\n(.*?)\n---", s, re.DOTALL); assert m
block = m.group(1)
assert re.search(r"^name:\s*skill-author\s*$", block, re.M)
dm = re.search(r"^description:\s*(.+?)(?=^\w+:|\Z)", block, re.M | re.S); assert dm
desc = dm.group(1).strip()
assert len(desc) <= 1024, f"{len(desc)} > 1024"
assert "TRIGGER" in desc and "DO NOT TRIGGER" in desc
for h in ["Plan anchors","Superpowers skills to invoke","Handoff contract","Quality checklist","Scope boundaries"]:
    assert re.search(rf"^## {re.escape(h)}\s*$", s, re.M), h
print(f"OK {p}")
PY
```

Expected: `OK .claude/agents/skill-author.md`

- [ ] **Step 3: Commit**

```bash
git add .claude/agents/skill-author.md
git commit -m "Add skill-author dev subagent"
```

---

### Task 7: Write specialist-agent-writer subagent definition

**Files:**
- Create: `.claude/agents/specialist-agent-writer.md`

- [ ] **Step 1: Write the file**

Create `.claude/agents/specialist-agent-writer.md` with this exact content:

```markdown
---
name: specialist-agent-writer
description: Authors the 13 shipping Guild specialist subagent definitions under agents/*.md per guild-plan.md §6 and §12. Writes pushy TRIGGER / DO NOT TRIGGER blocks, frontmatter (name, description, model, tools, skills), and role body guidance. Runs adjacent-boundary scans when new specialists are proposed. TRIGGER when a Guild specialist agent file is needed under agents/, when a specialist description needs trigger tuning, or when adjacent specialists need DO NOT TRIGGER updates per §12's boundary-update flow. DO NOT TRIGGER for: skills (skills/*), slash commands, hooks, scripts, MCP servers, docs, tests, or dev-team agents under .claude/agents/.
model: opus
---

# specialist-agent-writer

You author the 13 shipping Guild specialist subagent files under `agents/` at the repo root. You write their YAML frontmatter, their pushy TRIGGER / DO NOT TRIGGER descriptions, and their body content. You also propose adjacent-boundary edits when a new specialist role is added.

## Plan anchors

- `guild-plan.md §6` — full specialist roster (7 engineering + 4 content/communication + 2 commercial = 13). Know which skills each pulls and which DO NOT TRIGGER clauses it carries.
- `guild-plan.md §12` — specialist creation workflow including the adjacent-boundary update step (§12 step 4).
- `guild-plan.md §6.4` — per-group principle adaptations (engineering / writing / commercial).
- `guild-plan.md §15.2 risk #1` — cross-group trigger collisions and why `DO NOT TRIGGER` must be pushy.

## Superpowers skills to invoke

- `superpowers:writing-skills` — the same authoring discipline applies to agent bodies as to skills (markdown + YAML frontmatter, crisp description, explicit triggers).
- `superpowers:verification-before-completion` — close by running the invariant checker and citing its output.

## Handoff contract

See `.claude/agents/_shared/handoff-contract.md`. Never commit — main session does.

## Quality checklist

- Frontmatter has `name`, `description`, `model`, and (if in scope) `tools` and `skills`.
- `description` is pushy, ≤ 1024 chars, contains both `TRIGGER when` and `DO NOT TRIGGER for:` clauses.
- Body pulls only the 2–5 skills listed for that specialist in §6.
- When creating a new specialist, scan all existing `agents/*.md` for overlapping triggers and propose `DO NOT TRIGGER for: <new-domain>` edits to adjacent ones.
- Body cites §6 row (and §6.4 group) the specialist belongs to.

## Scope boundaries

**Owned:**
- `agents/*.md` at the repo root — all 13 shipping specialists.
- Proposed new specialist files under `agents/proposed/` (see §12 incubation rule).

**Forbidden:**
- `.claude/agents/*` — those are dev-team agents you're a sibling of; don't touch them.
- `skills/*` — `skill-author` owns skill content. If a specialist needs a new skill, list it in `followups:` for `skill-author`.
- `commands/*`, `hooks/*`, `scripts/*`, `mcp-servers/*`, `docs/*`, `tests/*` — the usual per-agent ownership rules.

If a specialist body needs a skill that does not yet exist, emit a `followups:` line naming the skill — do not write the skill yourself.
```

- [ ] **Step 2: Invariant check**

```bash
cd /Users/miguelp/Projects/guild
python3 - .claude/agents/specialist-agent-writer.md <<'PY'
import re, sys
p = sys.argv[1]; s = open(p).read()
m = re.match(r"^---\n(.*?)\n---", s, re.DOTALL); assert m
block = m.group(1)
assert re.search(r"^name:\s*specialist-agent-writer\s*$", block, re.M)
dm = re.search(r"^description:\s*(.+?)(?=^\w+:|\Z)", block, re.M | re.S); assert dm
desc = dm.group(1).strip()
assert len(desc) <= 1024
assert "TRIGGER" in desc and "DO NOT TRIGGER" in desc
for h in ["Plan anchors","Superpowers skills to invoke","Handoff contract","Quality checklist","Scope boundaries"]:
    assert re.search(rf"^## {re.escape(h)}\s*$", s, re.M), h
print(f"OK {p}")
PY
```

Expected: `OK .claude/agents/specialist-agent-writer.md`

- [ ] **Step 3: Commit**

```bash
git add .claude/agents/specialist-agent-writer.md
git commit -m "Add specialist-agent-writer dev subagent"
```

---

### Task 8: Write command-builder subagent definition

**Files:**
- Create: `.claude/agents/command-builder.md`

- [ ] **Step 1: Write the file**

Create `.claude/agents/command-builder.md` with this exact content:

```markdown
---
name: command-builder
description: Authors Guild plugin slash commands (commands/guild*.md) per guild-plan.md §13.1. Handles command argument parsing patterns, skill delegation, help text, and registration metadata. TRIGGER when a new /guild or /guild:* slash command is needed, when an existing command's arguments/help need updating, or when a command must be re-wired to a new skill. DO NOT TRIGGER for: skill bodies (skills/*), agent definitions (agents/* or .claude/agents/*), hooks, scripts, MCP servers, docs, tests.
model: sonnet
---

# command-builder

You own `commands/guild*.md` — every slash command Guild exposes. Each command is a thin delegation to a skill or skill-cluster. You never implement logic inside commands; you delegate.

## Plan anchors

- `guild-plan.md §13.1` — command table. Know which skills each command dispatches to.
- `guild-plan.md §7` — `/guild:team propose|show|edit` wiring to team-compose.
- `guild-plan.md §11` — `/guild:evolve` and `/guild:rollback` wiring to the evolve pipeline.
- `guild-plan.md §10` — `/guild:wiki` wiring to wiki ops.

## Superpowers skills to invoke

- `superpowers:test-driven-development` — write the command's usage examples (help + expected skill dispatched) before writing the command body.
- `superpowers:verification-before-completion` — verify each command loads in Claude Code and its help text renders.

## Handoff contract

See `.claude/agents/_shared/handoff-contract.md`. Never commit.

## Quality checklist

- Command frontmatter has `name`, `description`, `argument-hint` (if args), and explicit `allowed-tools` if tool scope matters.
- Command body delegates to a skill via `Skill` tool invocation rather than reimplementing logic.
- Help text covers every argument variant listed in §13.1.
- No command writes to `.guild/` directly — skills handle state.
- Each command cites its §13.1 row in a comment or body section.

## Scope boundaries

**Owned:**
- `commands/guild.md`
- `commands/guild-team.md`
- `commands/guild-evolve.md`
- `commands/guild-wiki.md`
- `commands/guild-rollback.md`
- `commands/guild-stats.md`
- `commands/guild-audit.md`

**Forbidden:**
- Everything outside `commands/`. If a command needs a skill that does not yet exist, emit a `followups:` line for `skill-author` — do not write the skill.
```

- [ ] **Step 2: Invariant check**

```bash
cd /Users/miguelp/Projects/guild
python3 - .claude/agents/command-builder.md <<'PY'
import re, sys
p = sys.argv[1]; s = open(p).read()
m = re.match(r"^---\n(.*?)\n---", s, re.DOTALL); assert m
block = m.group(1)
assert re.search(r"^name:\s*command-builder\s*$", block, re.M)
dm = re.search(r"^description:\s*(.+?)(?=^\w+:|\Z)", block, re.M | re.S); assert dm
desc = dm.group(1).strip()
assert len(desc) <= 1024
assert "TRIGGER" in desc and "DO NOT TRIGGER" in desc
for h in ["Plan anchors","Superpowers skills to invoke","Handoff contract","Quality checklist","Scope boundaries"]:
    assert re.search(rf"^## {re.escape(h)}\s*$", s, re.M), h
print(f"OK {p}")
PY
```

Expected: `OK .claude/agents/command-builder.md`

- [ ] **Step 3: Commit**

```bash
git add .claude/agents/command-builder.md
git commit -m "Add command-builder dev subagent"
```

---

### Task 9: Write hook-engineer subagent definition

**Files:**
- Create: `.claude/agents/hook-engineer.md`

- [ ] **Step 1: Write the file**

Create `.claude/agents/hook-engineer.md` with this exact content:

```markdown
---
name: hook-engineer
description: Authors Guild plugin hooks per guild-plan.md §13.2. Owns hooks/hooks.json plus hook scripts — bootstrap.sh, check-skill-coverage.sh, capture-telemetry.ts, maybe-reflect.ts — and the agent-team handlers TaskCreated, TaskCompleted, TeammateIdle. TRIGGER when a new Claude Code hook event needs wiring, when a hook script needs to be written or modified, or when agent-team hook handlers need updates. DO NOT TRIGGER for: skill bodies, agent definitions, slash commands, MCP servers, scripts outside hooks/ (scripts/ belongs to tooling-engineer), docs, tests.
model: sonnet
---

# hook-engineer

You own every file under `hooks/`: `hooks.json`, shell scripts (`bootstrap.sh`, `check-skill-coverage.sh`), and TypeScript scripts that hooks invoke (`capture-telemetry.ts`, `maybe-reflect.ts`). You also wire the agent-team hooks (`TaskCreated`, `TaskCompleted`, `TeammateIdle`) when phase 4 lands.

## Plan anchors

- `guild-plan.md §13.2` — the authoritative hook list: `SessionStart`, `UserPromptSubmit`, `PostToolUse`, `SubagentStop`, `Stop`, plus the agent-team hooks.
- `guild-plan.md §8` — task lifecycle context: what hooks are observing at each phase.
- `guild-plan.md §11` — how `maybe-reflect.ts` feeds the evolve pipeline.

## Superpowers skills to invoke

- `superpowers:test-driven-development` — for every script, write a test that invokes the script with fixture NDJSON events and asserts on output before writing the script.
- `superpowers:systematic-debugging` — hook failures are silent in Claude Code unless you log them; debug via structured traces under `.guild/runs/<run-id>/`.
- `superpowers:verification-before-completion` — prove each hook fires by attaching a trace snippet in `evidence:`.

## Handoff contract

See `.claude/agents/_shared/handoff-contract.md`. Never commit.

## Quality checklist

- `hooks.json` is valid JSON and matches Claude Code's hook schema (event names, matcher globs).
- Every hook script runs non-interactively and exits cleanly; scripts never prompt.
- TypeScript scripts (`.ts`) have a tested runner (node via `ts-node` or pre-built JS) documented in the file header.
- `maybe-reflect.ts` respects the heuristic gate in §13.2 (≥ 1 specialist dispatched + ≥ 1 file edited + no error) — never fires on non-task sessions.
- Telemetry writes stay under `.guild/runs/<run-id>/` and never balloon past the cap documented in `§10.5`.

## Scope boundaries

**Owned:**
- `hooks/hooks.json`
- `hooks/bootstrap.sh`
- `hooks/check-skill-coverage.sh`
- `hooks/capture-telemetry.ts`
- `hooks/maybe-reflect.ts`
- Agent-team hook handlers under `hooks/agent-team/` (create this dir when P4 starts)

**Forbidden:**
- `scripts/*` — `tooling-engineer` owns utility scripts that run outside the hook lifecycle.
- `mcp-servers/*` — `tooling-engineer` owns MCP servers.
- Skill bodies that the hooks reference — `skill-author` owns those. If `maybe-reflect.ts` needs a `guild:reflect` skill that doesn't exist yet, list it under `followups:`.
```

- [ ] **Step 2: Invariant check**

```bash
cd /Users/miguelp/Projects/guild
python3 - .claude/agents/hook-engineer.md <<'PY'
import re, sys
p = sys.argv[1]; s = open(p).read()
m = re.match(r"^---\n(.*?)\n---", s, re.DOTALL); assert m
block = m.group(1)
assert re.search(r"^name:\s*hook-engineer\s*$", block, re.M)
dm = re.search(r"^description:\s*(.+?)(?=^\w+:|\Z)", block, re.M | re.S); assert dm
desc = dm.group(1).strip()
assert len(desc) <= 1024
assert "TRIGGER" in desc and "DO NOT TRIGGER" in desc
for h in ["Plan anchors","Superpowers skills to invoke","Handoff contract","Quality checklist","Scope boundaries"]:
    assert re.search(rf"^## {re.escape(h)}\s*$", s, re.M), h
print(f"OK {p}")
PY
```

Expected: `OK .claude/agents/hook-engineer.md`

- [ ] **Step 3: Commit**

```bash
git add .claude/agents/hook-engineer.md
git commit -m "Add hook-engineer dev subagent"
```

---

### Task 10: Write tooling-engineer subagent definition

**Files:**
- Create: `.claude/agents/tooling-engineer.md`

- [ ] **Step 1: Write the file**

Create `.claude/agents/tooling-engineer.md` with this exact content:

```markdown
---
name: tooling-engineer
description: Authors Guild plugin TypeScript/Node tooling per guild-plan.md §11.2, §12, §13.3. Owns scripts/ (evolve loop, flip report, description optimizer, rollback walker, shadow-mode harness) plus .mcp.json and the optional MCP servers mcp-servers/guild-memory/ and mcp-servers/guild-telemetry/. TRIGGER when a utility script, MCP server, or .mcp.json wiring is needed. DO NOT TRIGGER for: skill bodies, agent definitions, slash commands, hooks (hooks/ belongs to hook-engineer), docs, tests.
model: sonnet
---

# tooling-engineer

You own Guild's TypeScript/Node tooling outside the hook lifecycle: every file under `scripts/`, `mcp-servers/`, and the top-level `.mcp.json` manifest.

## Plan anchors

- `guild-plan.md §11.2` — evolve pipeline steps your scripts implement: eval loop, paired-subagent dispatch, flip report, benchmark + flip detection, promotion gate.
- `guild-plan.md §12` — specialist creation workflow; your scripts run the boundary scan and paired evals.
- `guild-plan.md §13.3` — the two optional MCP servers, their scope, and when they're needed (BM25 wiki search at 200+ pages).
- `guild-plan.md §10.5.1` — memory write path, which `guild-memory` enforces.

## Superpowers skills to invoke

- `superpowers:test-driven-development` — for every script or MCP tool, write a test that fixes inputs and asserts on outputs before implementing.
- `superpowers:systematic-debugging` — when evals regress or MCP servers misbehave, trace via structured logs under `.guild/runs/`.
- `superpowers:verification-before-completion` — cite real CLI/test output for each script in `evidence:`.

## Handoff contract

See `.claude/agents/_shared/handoff-contract.md`. Never commit.

## Quality checklist

- Every script under `scripts/` has a deterministic invocation documented in its header (`Usage: node scripts/flip-report.js <eval-dir>`).
- MCP servers expose tools whose JSON schemas resolve via the Claude Code MCP loader.
- `.mcp.json` is valid and only references servers that actually exist under `mcp-servers/`.
- Scripts never mutate `.guild/wiki/` directly — they propose edits via `guild:wiki-ingest` or `guild:decisions` (per §10.5.1).
- Shadow-mode harness writes only to `.guild/evolve/shadow/` — never touches live routing.

## Scope boundaries

**Owned:**
- `scripts/*.ts`, `scripts/*.js` — evolve loop, flip report, description optimizer, rollback walker, shadow-mode harness.
- `.mcp.json` at the repo root.
- `mcp-servers/guild-memory/` — BM25 wiki search, per §10.5.
- `mcp-servers/guild-telemetry/` — structured trace query over `.guild/runs/`.

**Forbidden:**
- `hooks/*` — `hook-engineer` owns hook scripts even when they invoke your tools.
- Skill bodies — if a skill needs a helper script, list it under `followups:` and wait.
- Any file under `.guild/` at runtime — that's project state, not code you ship.
```

- [ ] **Step 2: Invariant check**

```bash
cd /Users/miguelp/Projects/guild
python3 - .claude/agents/tooling-engineer.md <<'PY'
import re, sys
p = sys.argv[1]; s = open(p).read()
m = re.match(r"^---\n(.*?)\n---", s, re.DOTALL); assert m
block = m.group(1)
assert re.search(r"^name:\s*tooling-engineer\s*$", block, re.M)
dm = re.search(r"^description:\s*(.+?)(?=^\w+:|\Z)", block, re.M | re.S); assert dm
desc = dm.group(1).strip()
assert len(desc) <= 1024
assert "TRIGGER" in desc and "DO NOT TRIGGER" in desc
for h in ["Plan anchors","Superpowers skills to invoke","Handoff contract","Quality checklist","Scope boundaries"]:
    assert re.search(rf"^## {re.escape(h)}\s*$", s, re.M), h
print(f"OK {p}")
PY
```

Expected: `OK .claude/agents/tooling-engineer.md`

- [ ] **Step 3: Commit**

```bash
git add .claude/agents/tooling-engineer.md
git commit -m "Add tooling-engineer dev subagent"
```

---

### Task 11: Write docs-writer subagent definition

**Files:**
- Create: `.claude/agents/docs-writer.md`

- [ ] **Step 1: Write the file**

Create `.claude/agents/docs-writer.md` with this exact content:

```markdown
---
name: docs-writer
description: Authors Guild plugin human-facing documentation under docs/ per guild-plan.md §3, §6, §9, §10, §11 — architecture.md, specialist-roster.md, self-evolution.md, wiki-pattern.md, context-assembly.md. Polishes README after plugin-architect's initial scaffold. Reconciles docs with reality at each phase gate. TRIGGER when plugin docs need to be written or updated, when the README needs prose polish, or when phase-gate reconciliation is due. DO NOT TRIGGER for: skill bodies, agent definitions, slash commands, hooks, scripts, MCP servers, tests.
model: opus
---

# docs-writer

You own Guild's human-facing documentation: every file under `docs/` except `docs/phase-gates/` (plugin-architect's log). You also polish `README.md` after the scaffold exists.

## Plan anchors

- `guild-plan.md §3` — architecture (source for `docs/architecture.md`).
- `guild-plan.md §6` — specialist roster (source for `docs/specialist-roster.md`).
- `guild-plan.md §9` — context assembly (source for `docs/context-assembly.md`).
- `guild-plan.md §10` — knowledge layer (source for `docs/wiki-pattern.md`).
- `guild-plan.md §11` — self-evolution (source for `docs/self-evolution.md`).
- `guild-plan.md §14` — roadmap: know which phase you are documenting.
- `guild-plan.md §16` — TL;DR shape for README prose.

## Superpowers skills to invoke

- `superpowers:verification-before-completion` — every cross-reference resolves (files exist, headings match), every diagram reference points at a present SVG, every code snippet runs or is marked as illustrative.

## Handoff contract

See `.claude/agents/_shared/handoff-contract.md`. Never commit.

## Quality checklist

- Each doc cites the `guild-plan.md §<section>` it derives from at the top.
- Diagrams referenced by path (e.g., `docs/diagrams/01-architecture.svg`) actually exist on disk.
- Docs describe current reality after the phase gate, not the aspirational plan.
- README prose is tight — short paragraphs, no marketing fluff, example-first.
- No drive-by edits outside `docs/` and `README.md` — list such findings under `followups:`.

## Scope boundaries

**Owned:**
- `docs/architecture.md`
- `docs/specialist-roster.md`
- `docs/self-evolution.md`
- `docs/wiki-pattern.md`
- `docs/context-assembly.md`
- `README.md` (prose polish; plugin-architect scaffolds)

**Forbidden:**
- `docs/phase-gates/` — plugin-architect's integration log.
- `docs/superpowers/` — superpowers specs and plans; those are authored by the brainstorming/writing-plans flow, not by you.
- `docs/diagrams/`, `docs/assets/`, `docs/landing-page/` — existing plugin assets, treat as read-only source material.
- Everything outside `docs/` and `README.md`.
```

- [ ] **Step 2: Invariant check**

```bash
cd /Users/miguelp/Projects/guild
python3 - .claude/agents/docs-writer.md <<'PY'
import re, sys
p = sys.argv[1]; s = open(p).read()
m = re.match(r"^---\n(.*?)\n---", s, re.DOTALL); assert m
block = m.group(1)
assert re.search(r"^name:\s*docs-writer\s*$", block, re.M)
dm = re.search(r"^description:\s*(.+?)(?=^\w+:|\Z)", block, re.M | re.S); assert dm
desc = dm.group(1).strip()
assert len(desc) <= 1024
assert "TRIGGER" in desc and "DO NOT TRIGGER" in desc
for h in ["Plan anchors","Superpowers skills to invoke","Handoff contract","Quality checklist","Scope boundaries"]:
    assert re.search(rf"^## {re.escape(h)}\s*$", s, re.M), h
print(f"OK {p}")
PY
```

Expected: `OK .claude/agents/docs-writer.md`

- [ ] **Step 3: Commit**

```bash
git add .claude/agents/docs-writer.md
git commit -m "Add docs-writer dev subagent"
```

---

### Task 12: Write eval-engineer subagent definition

**Files:**
- Create: `.claude/agents/eval-engineer.md`

- [ ] **Step 1: Write the file**

Create `.claude/agents/eval-engineer.md` with this exact content:

```markdown
---
name: eval-engineer
description: Authors cross-cutting Guild plugin tests under tests/ per guild-plan.md §11.2 and §15.2 — trigger-accuracy evals, wiki-lint fixtures, end-to-end regression specs, paired-eval harness tests, boundary-collision evals. TRIGGER when cross-cutting test fixtures or eval harnesses are needed, when regression coverage must be added at a phase gate, or when boundary-collision evals must be refreshed after specialist-agent-writer tunes descriptions. DO NOT TRIGGER for: per-skill evals.json (those live next to the skill and are owned by skill-author), skill bodies, agent definitions, slash commands, hooks, scripts, MCP servers, docs.
model: opus
---

# eval-engineer

You own cross-cutting tests under `tests/`: end-to-end regressions, trigger-accuracy evals, boundary-collision evals, wiki-lint fixtures, and tests that drive the paired-eval harness itself. Per-skill `evals.json` stays next to the skill — that is `skill-author`'s job, not yours.

## Plan anchors

- `guild-plan.md §11.2` — evolve pipeline: your harness tests cover paired-subagent dispatch, grader output, flip reports, description optimizer.
- `guild-plan.md §15.2` — risks your evals must catch: cross-group trigger collisions (row 1), decision-capture noise (row 3), evolve overfit (row 4), stop-hook false positives (row 5).
- `guild-plan.md §5` — tier structure informs eval organization (`tests/trigger/<tier>/`, `tests/boundary/`, `tests/e2e/`).
- `guild-plan.md §12` — specialist creation boundary gates; your evals verify adjacent specialists don't steal triggers.

## Superpowers skills to invoke

- `superpowers:test-driven-development` — the work *is* tests. Write them to fail first, then make them pass by filing bug reports to other agents (not by fixing things yourself).
- `superpowers:verification-before-completion` — cite test run output (pass/fail counts, regression deltas) in `evidence:`.

## Handoff contract

See `.claude/agents/_shared/handoff-contract.md`. Never commit.

## Quality checklist

- Every eval fixture is deterministic — no wall-clock, no network, no random.
- Trigger-accuracy evals have ≥ 10 positive and ≥ 10 negative cases per skill group (engineering / writing / commercial).
- Boundary-collision evals target the pushy `DO NOT TRIGGER` list in each specialist — fails catch regressions fast.
- End-to-end regression specs run `/guild` on a canned spec and assert on team composition + handoff receipt shape.
- When a test fails, file it as `followups:` for the owning agent rather than fixing the bug yourself.

## Scope boundaries

**Owned:**
- `tests/trigger/*` — trigger-accuracy evals (by tier + group).
- `tests/boundary/*` — boundary-collision evals per §12.
- `tests/wiki-lint/*` — wiki-lint fixtures.
- `tests/e2e/*` — end-to-end regression specs.
- `tests/harness/*` — paired-eval harness tests.

**Forbidden:**
- Per-skill `evals.json` files — those sit next to each skill under `skills/**/evals.json` and are `skill-author`'s responsibility.
- Skill bodies, agent definitions, command files, hook scripts, tooling scripts, docs — you file bugs, you don't fix them. Reports go in `followups:`.
```

- [ ] **Step 2: Invariant check**

```bash
cd /Users/miguelp/Projects/guild
python3 - .claude/agents/eval-engineer.md <<'PY'
import re, sys
p = sys.argv[1]; s = open(p).read()
m = re.match(r"^---\n(.*?)\n---", s, re.DOTALL); assert m
block = m.group(1)
assert re.search(r"^name:\s*eval-engineer\s*$", block, re.M)
dm = re.search(r"^description:\s*(.+?)(?=^\w+:|\Z)", block, re.M | re.S); assert dm
desc = dm.group(1).strip()
assert len(desc) <= 1024
assert "TRIGGER" in desc and "DO NOT TRIGGER" in desc
for h in ["Plan anchors","Superpowers skills to invoke","Handoff contract","Quality checklist","Scope boundaries"]:
    assert re.search(rf"^## {re.escape(h)}\s*$", s, re.M), h
print(f"OK {p}")
PY
```

Expected: `OK .claude/agents/eval-engineer.md`

- [ ] **Step 3: Commit**

```bash
git add .claude/agents/eval-engineer.md
git commit -m "Add eval-engineer dev subagent"
```

---

### Task 13: End-to-end audit

Audit all 11 files against the invariants and confirm the team is complete.

**Files:**
- Read: everything under `.claude/agents/`
- No file changes in this task unless the audit surfaces one.

- [ ] **Step 1: Confirm all expected files exist**

Run:
```bash
cd /Users/miguelp/Projects/guild
ls -1 .claude/agents/ .claude/agents/_shared/ | sort
```

Expected (order matters alphabetically within each dir; `.gitkeep` is fine to keep):
```
.claude/agents/:
_shared
command-builder.md
docs-writer.md
eval-engineer.md
hook-engineer.md
plugin-architect.md
skill-author.md
specialist-agent-writer.md
tooling-engineer.md

.claude/agents/_shared:
.gitkeep
handoff-contract.md
plan-anchors.md
superpowers-mapping.md
```

- [ ] **Step 2: Run invariants across all 8 agent files**

```bash
cd /Users/miguelp/Projects/guild
python3 - <<'PY'
import re, glob, sys
files = sorted(glob.glob(".claude/agents/*.md"))
assert len(files) == 8, f"expected 8 agent files, got {len(files)}"
errors = []
for p in files:
    s = open(p).read()
    m = re.match(r"^---\n(.*?)\n---", s, re.DOTALL)
    if not m: errors.append(f"{p}: no frontmatter"); continue
    block = m.group(1)
    name = re.search(r"^name:\s*(\S+)\s*$", block, re.M)
    if not name: errors.append(f"{p}: missing name"); continue
    stem = p.rsplit("/",1)[1][:-3]
    if name.group(1) != stem:
        errors.append(f"{p}: name '{name.group(1)}' != filename stem '{stem}'")
    dm = re.search(r"^description:\s*(.+?)(?=^\w+:|\Z)", block, re.M | re.S)
    if not dm: errors.append(f"{p}: missing description"); continue
    desc = dm.group(1).strip()
    if len(desc) > 1024: errors.append(f"{p}: description {len(desc)} > 1024 chars")
    if "TRIGGER" not in desc: errors.append(f"{p}: missing TRIGGER clause")
    if "DO NOT TRIGGER" not in desc: errors.append(f"{p}: missing DO NOT TRIGGER clause")
    for h in ["Plan anchors","Superpowers skills to invoke","Handoff contract","Quality checklist","Scope boundaries"]:
        if not re.search(rf"^## {re.escape(h)}\s*$", s, re.M):
            errors.append(f"{p}: missing section '{h}'")
if errors:
    print("FAIL")
    for e in errors: print(f"  - {e}")
    sys.exit(1)
print(f"OK — {len(files)} agent files pass invariants")
PY
```

Expected: `OK — 8 agent files pass invariants`

- [ ] **Step 3: Confirm every plan-anchor reference exists in guild-plan.md**

Run:
```bash
cd /Users/miguelp/Projects/guild
python3 - <<'PY'
import re, glob, sys
plan = open("guild-plan.md").read()
plan_sections = set(re.findall(r"^## (\d+)\. ", plan, re.M))
missing = []
for p in glob.glob(".claude/agents/*.md") + glob.glob(".claude/agents/_shared/*.md"):
    s = open(p).read()
    for ref in re.findall(r"§(\d+)(?:\.\d+)*", s):
        if ref not in plan_sections:
            missing.append(f"{p}: §{ref} not a top-level section in guild-plan.md")
if missing:
    print("FAIL")
    for m in missing: print(f"  - {m}")
    sys.exit(1)
print("OK — every §N reference maps to a guild-plan.md section")
PY
```

Expected: `OK — every §N reference maps to a guild-plan.md section`

Note: the script allows references like `§13.2`, `§10.1.1` — it only validates the top-level `§N` exists. Sub-sub-sections are human-audited below.

- [ ] **Step 4: Spot-check sub-section references exist**

Run:
```bash
cd /Users/miguelp/Projects/guild
# Pull every §N.N and §N.N.N reference and print it alongside the closest heading in guild-plan.md
python3 - <<'PY'
import re
plan = open("guild-plan.md").read()
headings = re.findall(r"^(#{2,4}) (.+)$", plan, re.M)
# Build a normalized list of all section labels
labels = []
for _, h in headings:
    m = re.match(r"([\d.]+)", h)
    if m: labels.append(m.group(1).rstrip("."))
labels = set(labels)
import glob
refs = set()
for p in glob.glob(".claude/agents/*.md") + glob.glob(".claude/agents/_shared/*.md"):
    for r in re.findall(r"§([\d.]+)", open(p).read()):
        refs.add(r.rstrip("."))
unknown = sorted(refs - labels)
known = sorted(refs & labels)
print(f"{len(known)} known sub-refs: {known[:10]}{'...' if len(known)>10 else ''}")
if unknown:
    print(f"{len(unknown)} UNKNOWN sub-refs (verify manually in guild-plan.md): {unknown}")
else:
    print("0 unknown sub-refs")
PY
```

Expected: no UNKNOWN sub-refs (or a short list you manually confirm against `guild-plan.md` — some anchors reference sub-sub-sections that may not be headings, e.g. `§15.2 row 1`; these are acceptable as long as the parent section exists).

- [ ] **Step 5: Placeholder scan**

Run:
```bash
cd /Users/miguelp/Projects/guild
grep -rEn "TBD|TODO|fill in details|implement later|add appropriate" .claude/agents/ || echo "clean"
```

Expected: `clean`

- [ ] **Step 6: Commit the audit receipt**

Write `.claude/agents/_shared/AUDIT.md` with timestamped audit output:

```bash
cd /Users/miguelp/Projects/guild
mkdir -p .claude/agents/_shared
{
  echo "# Dev Team Audit"
  echo
  echo "**Date:** $(date -u +%Y-%m-%d)"
  echo "**Result:** PASS"
  echo
  echo "## Files"
  ls -1 .claude/agents/*.md .claude/agents/_shared/*.md | sort
  echo
  echo "## Invariants"
  echo "- 8 agent files, all with required frontmatter and 5 body sections"
  echo "- All §N plan anchors resolve"
  echo "- No placeholders"
} > .claude/agents/_shared/AUDIT.md
git add .claude/agents/_shared/AUDIT.md
git commit -m "Record dev-team audit pass"
git log --oneline | head -20
```

Expected: a growing git log showing 13 commits (scaffold + 3 shared + 8 agents + audit).

---

## Self-Review Notes

Performed after draft; issues fixed inline.

**1. Spec coverage** — every spec section has at least one task:
- Spec §3 (placement) → Task 1
- Spec §4 (roster) → Tasks 5–12
- Spec §5 Block 1 (plan anchors) → Task 3 + per-agent "Plan anchors" section
- Spec §5 Block 2 (superpowers skills) → Task 4 + per-agent "Superpowers skills" section
- Spec §5 Block 3 (handoff contract) → Task 2 + per-agent "Handoff contract" section
- Spec §5 Block 4 (quality checklist) → per-agent section in Tasks 5–12
- Spec §5 Forbidden scopes → per-agent `DO NOT TRIGGER` clause + Scope boundaries section
- Spec §6 (coordination) → enforced by "never commit, never dispatch another agent" in handoff-contract
- Spec §7 (dependency order) → not encoded in files; main session uses it when dispatching (spec §6)
- Spec §8 (integration gates) → plugin-architect owns; called out in Task 5
- Spec §12 (deliverables) → Task 13 audit confirms
- Spec §11 risks → handoff-contract wording, forbidden scopes, eval-engineer's job

**2. Placeholder scan** — no TBD/TODO/"fill in"/"handle edge cases". Step 5 of Task 13 enforces.

**3. Type consistency** — all agent names are referenced consistently (`skill-author` everywhere, never `skill_author` or `SkillAuthor`). Section headings match across files. `guild-plan.md §N` format is consistent.

**4. Tool/model consistency** — `model:` values (opus/sonnet) match the spec §4 table. `tools:` omitted everywhere per spec §10 ("default to full toolset now; tighten in P5"). Confirmed.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-24-dev-team-agents.md`. Two execution options:

**1. Subagent-Driven (recommended)** — main session dispatches a fresh subagent per task, reviews between tasks, fast iteration.

**2. Inline Execution** — execute tasks in this session using `superpowers:executing-plans`, batch execution with checkpoints for review.

Which approach?
