---
name: using-guild
description: Mandatory first-read gateway to Guild — the specialist-team workflow engine installed in this repo. Read BEFORE any non-trivial software task to decide whether Guild's lifecycle (plan → build → qa → ops), specialist teams, review gate, structured debugging, or knowledge recall fits. It also carries Guild's five operating principles, which every specialist follows. TRIGGER on "plan/scope/design this feature", "review this plan or PR", "build this with a team", "use specialists", "debug this failing system", "release/deploy/roll back this", "ingest these docs into the wiki", "what are Guild's principles", or any multi-step / multi-file / multi-agent job — even when the user never types a /guild command. It says WHEN to reach for Guild and WHERE the surface lives; it does NOT list every command. DO NOT TRIGGER when you are a narrow subagent handed one fully-scoped task with full context (single-file edit, typo fix, rename, value lookup) — just do the work.
when_to_use: At the start of any session or non-trivial task in a repo where Guild is installed, and whenever a request smells like planning, team/specialist work, review, debugging, release/ops, knowledge capture, or Guild's operating principles — regardless of whether the user typed a /guild command. Narrow subagents handed a fully-scoped task skip it.
type: meta
---

# using-guild

Read this first. Guild turns a one-shot request into a **specialist team** running a
lifecycle, with a review gate, structured debugging, and a project knowledge base.
This is the only always-on Guild file. It tells you **when** to reach for Guild and
**where** the surface lives; it deliberately does not repeat the command menu.

This file is **latest-only**: it states current behaviour and carries no changelog
and no dated "Update (…)" appendix.

## Operating principles

Five lines. They are the prelude for every Guild specialist — engineering, writing,
and commercial alike. The first four are Karpathy's; the fifth is Guild's.

1. **Think before doing.** State assumptions, surface ambiguity, present tradeoffs
   before acting. Two plausible readings of a request means ask, not guess.
2. **Simplicity first.** Ship the minimum artifact that meets the goal. No
   speculative scope, no scaffolding for a use case nobody asked for.
3. **Surgical changes.** Every line and every word traces to the request. Match the
   existing style. No drive-by refactors, no rewriting adjacent prose.
4. **Goal-driven execution.** Success criteria are verifiable and defined up front;
   loop until they are met. In code that is the failing test first. "Done" is
   measurable, not a vibe.
5. **Evidence over claims.** Back every assertion with an artifact: a test, a diff,
   a metric, a transcript, a citation. "I checked" is not evidence and is rejected
   at the review gate, which reads your handoff receipt's `evidence:` field.

Read through your own idiom: engineering evidence is a green suite plus a followable
diff; writing evidence is the draft itself, scannable in a minute; commercial
evidence is a data citation (A/B result, funnel metric, search-volume benchmark),
with one variable changed at a time so attribution stays clean.

## When to engage Guild

Engage when the task is non-trivial — even if the user never typed `/guild`:

- **Planning / scoping / design** — "plan this feature", "what are we building".
- **Multi-agent / specialist work** — "build this with a team", "use specialists",
  any job spanning several files or domains.
- **Review** — "review this plan/PR", "find the holes in this design".
- **Debugging a system** — a failing build, flaky test, or behaviour you must
  root-cause (not a one-line fix).
- **Release / ops** — "deploy", "roll back", "cut a release", incident work.
- **Knowledge / recall** — "ingest these docs", "what did we decide about X".

When one fits, **invoke the matching Guild skill via the Skill tool** — skills are
model-invoked (you call them; the user does not type them).

## Project terms

In any Guild root, project terms live in `.guild/wiki/glossary.md`; recall on miss. Never paste the
glossary here — the context manager attaches only the terms an assignment actually
hits, capped, as part of the lane bundle.

## Where the full surface lives — don't memorize it

Guild has typed **commands** (`/guild:<verb>`, run by the user) and model-invoked
**skills** (`guild:<name>`, called by you) — distinct surfaces sharing a stem. Do
not enumerate or guess them. Orient through these pointers instead:

- **Bare `/guild` is T0** — the orchestrator session. With no verb it runs intake
  and classifies the work; `--class=` or a typed sub-verb binds the class directly.
  A verb is an option, not a requirement.
- The lifecycle spine is **init → ideate → plan → build → qa → ops**; reach for the
  skill(s) of the phase you are actually in.
- `/guild:status` reports current run state.
- The canonical phase → skill dispatch table is in `plugin/CLAUDE.md`; the full
  command map is on the Guild docs site.

Reach for the specific phase skill the moment you know the phase — don't route
everything through the bare entry.

## Host tool-name map

Guild skills are written in Claude's tool vocabulary. On another host, **route by
the host's capability row, not by its name** — read `guild.host_capabilities.v1`
(`plugin/scripts/lib/host-capabilities-schema.ts`) and degrade through the
minimum-loss chain (`native > wrapped > bridged > emulated > degraded`), recording
any loss. Claude rows are verified; Codex rows are `INFERRED` until confirmed on a
live Codex host.

| Guild capability | Claude (native) | Codex |
|---|---|---|
| Dispatch a specialist (`Agent` / `Task`) | `Agent` tool / agent-team `Task` | No native agent-team — run a separate `codex` process via the `guild-run` wrapper, or inline (`dispatch.independent_agents:false`, INFERRED). |
| Load a skill (`Skill`) | native skill autoload (`.claude/skills`) | No native skill dir — bootstrap rides an instruction file (AGENTS.md) / wrapper injection (`skills.native_skills:false`). |
| Run a command (`Bash`) | `Bash` (native shell) | native shell (`tools.shell:native`). |
| Read a file (`Read`) | `Read` (native) | native (`tools.read:native`). |
| Edit / write a file (`Edit` / `Write`) | `Edit` / `Write` (native) | native (`tools.edit/write:native`). |
| Ask the user (`AskUserQuestion`) | `AskUserQuestion` (native) | No native question UI — use a terminal prompt or the Guild file-bus (`interaction.native_questions:false`, INFERRED). |

If a capability is absent, do **not** claim it — degrade and record the loss. The
capability row is authoritative; this table is a convenience index into it.

## Product-loop intake (the no-slash router)

A **vague product idea** ("I have an idea for X", "what if we built…") enters
Guild's **product loop** with no `/guild` typed. This is a router on this entry,
not a new gate and not an always-on interceptor: a non-product prompt falls
straight through to the normal lifecycle, unchanged.

**Route deterministically — never eyeball it.** Run the intake classifier on the
user's verbatim prompt and route on its `intake` field ONLY:

```
echo "<the user's verbatim prompt>" | npx tsx ${GUILD_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-$HOME/.local/share/guild/dist/claude-code}}/scripts/lib/classify-intake.ts
```

- `intake === "product_loop"` → route to the product-loop intake: `guild:product-explore`
  (scopes the idea into a `guild.explore.v1` artifact), then `guild:product-define`
  (the traceable PRD nucleus).
- anything else (`intake === "other"`) → do **NOT** enter the product loop; continue
  with the "When to engage Guild" judgement above.

**Precision floor — do not hijack.** Decide on the classifier's `intake` value,
never on the raw `score` and never on your own re-reading of the prompt. It is
tuned precision-over-recall, so a build/review/debug/ops prompt routes to `other`
and is never pulled into the product loop.

## Instruction rank

When two instructions conflict, the higher rank wins and the conflict is recorded
on the run: hooks > assignment `done_when` oracles > project `AGENTS.md` /
`CLAUDE.md` > playbook > skill body > this file. A repo can constrain Guild; Guild
does not constrain the repo.

## If you are a narrow subagent — skip this

If you were handed **one fully-scoped task with the context you need** (a
single-file edit, a typo fix, a rename, a value lookup), do **not** engage the
lifecycle. Just do the task. This gateway decides whether to bring Guild's
machinery to bear — it is not a tax on every small action.
