---
name: using-guild
description: Mandatory first-read gateway to Guild — the self-evolving specialist-team workflow engine installed in this repo. Consult BEFORE starting any non-trivial software task to decide whether Guild's lifecycle (plan → build → qa → ops), specialist agents, adversarial code review, structured debugging, or knowledge ingestion fits. TRIGGER on requests like "plan/scope/design this feature", "review this implementation plan or PR adversarially", "build/implement this with a team", "use specialists", "debug this failing system", "release/deploy/roll back this", "ingest these docs into the wiki", or any multi-step / multi-file / multi-agent job — even when the user never types a /guild command. It tells you WHEN to reach for a Guild skill and WHERE the command menu lives; it does NOT list every command. DO NOT TRIGGER when you are a narrow subagent handed one fully-scoped task with full context (single-file edit, typo fix, rename, value lookup): skip this and just do the work.
when_to_use: At the start of any session or non-trivial task in a repo where Guild is installed, and whenever a request smells like planning, team/specialist work, adversarial review, debugging, release/ops, or knowledge capture — regardless of whether the user typed a /guild command. Narrow subagents handed a fully-scoped task skip it.
type: meta
---

# using-guild

Read this first. Guild turns a one-shot request into a **specialist team** running a
plan → build → qa → ops lifecycle, with adversarial review, structured debugging,
and a project knowledge base. This skill is the gateway: it tells you **when** to
reach for Guild and **where** to find the full command surface. It deliberately does
**not** repeat the command menu.

## When to engage Guild

Engage when the task is non-trivial — even if the user never typed `/guild`:

- **Planning / scoping / design** — "plan this feature", "what are we building", "design X".
- **Multi-agent / specialist work** — "build this with a team", "use specialists", any job spanning several files or domains.
- **Adversarial review** — "review this plan/PR adversarially", "find the holes in this design".
- **Debugging a system** — a failing build, flaky test, or behavior you must root-cause (not a one-line fix).
- **Release / ops** — "deploy", "roll back", "cut a release", incident or monitoring work.
- **Knowledge ingestion / recall** — "ingest these docs", "what did we decide about X", wiki/decision capture.

When one of these fits, **invoke the matching Guild skill via the Skill tool** —
skills are model-invoked (you call them; the user does not type them), e.g.
`guild:brainstorm` to scope, `guild:plan` to break work into lanes,
`guild:execute-plan` to dispatch the team, `guild:review` / `guild:codex-review`
to review, `guild:systematic-debug` to root-cause.

## Where the full surface lives — don't memorize it

Guild has ~20 typed **commands** (`/guild:<verb>`, run by the user) and 100+
model-invoked **skills** (`guild:<name>`, called by you) — distinct surfaces that
share a stem (see `plugin/CLAUDE.md`). Do **not** enumerate or guess them. Orient
through these pointers instead:

- The lifecycle spine is **init → ideate → plan → build → qa → ops**; reach for the
  skill(s) of the phase you're actually in.
- When you're unsure which phase, the user-typed `/guild:guild [brief]` command runs
  phase detection and proposes the next step (it's an orchestrator behavior, **not**
  a skill); `/guild:status` reports current run state.
- The canonical phase → skill dispatch table is in `plugin/CLAUDE.md`; the full
  command map is in the docs (`MIGRATION.md` / the Guild docs site).

Reach for the specific phase skill the moment you know the phase — don't route
everything through the bare entry.

## Host tool-name map

Guild skills are written in Claude's tool vocabulary. When you run on another host,
**route by the host's capability row, not by its name** — read
`guild.host_capabilities.v1` (`plugin/scripts/lib/host-capabilities-schema.ts`) and
degrade through the minimum-loss chain (`native > wrapped > bridged > emulated >
degraded`), recording any loss. The Phase-1 map (Claude verified; Codex rows are
`INFERRED` until confirmed on a live Codex host):

| Guild capability | Claude (native) | Codex |
|---|---|---|
| Dispatch a specialist (`Agent` / `Task`) | `Agent` tool / agent-team `Task` | No native agent-team — run a separate `codex` process via the `guild-run` wrapper, or inline (`dispatch.independent_agents:false`, INFERRED). |
| Load a skill (`Skill`) | native skill autoload (`.claude/skills`) | No native skill dir — bootstrap rides an instruction file (AGENTS.md) / wrapper injection (`skills.native_skills:false`). |
| Run a command (`Bash`) | `Bash` (native shell) | native shell (`tools.shell:native`). |
| Read a file (`Read`) | `Read` (native) | native (`tools.read:native`). |
| Edit / write a file (`Edit` / `Write`) | `Edit` / `Write` (native) | native (`tools.edit/write:native`). |
| Ask the user (`AskUserQuestion`) | `AskUserQuestion` (native) | No native question UI — use a terminal prompt or the Guild file-bus (`interaction.native_questions:false`, INFERRED). |

If a capability is absent, do **not** claim it — degrade and record the loss. The
row is authoritative; the table above is a convenience index into it.

## Product-loop intake (the no-slash router)

A **vague product idea** ("I have an idea for X", "what if we built…", "I want to make a
tool that…") enters Guild's **product loop** — NOT the engineering lifecycle — and it does
so **with no `/guild` typed** (AC30). This is a **router on this existing entry**, not a new
gate and not an always-on interceptor: a non-product prompt falls straight through to the
normal lifecycle, unchanged.

**Route deterministically — never eyeball it.** Run the deterministic intake classifier on
the user's verbatim prompt and route on its `intake` field ONLY:

```
echo "<the user's verbatim prompt>" | npx tsx ${CLAUDE_PLUGIN_ROOT}/scripts/lib/classify-intake.ts
```

- `intake === "product_loop"` → route to the **product-loop intake**: invoke
  `guild:product-explore` (it scopes the idea into a `guild.explore.v1` artifact), then
  `guild:product-define` (the traceable PRD nucleus). No `/guild` is required.
- anything else (`intake === "other"`) → do **NOT** enter the product loop; continue with
  the normal "When to engage Guild" judgement above.

**Precision floor (R1) — do not hijack.** Decide on the classifier's `intake` value, never
on the raw `score` and never on your own re-reading of the prompt. The classifier is tuned
precision-over-recall (a single engineering veto sinks a product reading), so a build/review/
debug/ops prompt routes to `other` and is never pulled into the product loop. If the
classifier says `other`, the product loop does not fire — full stop.

## If you are a narrow subagent — skip this

If you were handed **one fully-scoped task with the context you need** (a single-file
edit, a typo fix, a rename, a value lookup), do **not** engage the lifecycle. Just do
the task. This gateway is for deciding whether to bring Guild's machinery to bear —
not a tax on every small action.
