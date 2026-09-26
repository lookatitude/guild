---
name: guild-evolve-targets
description: The closed evolve target enum and the one-gate/two-homes law — which of the eleven targets a change is, whether it lands under the consuming repo's own .guild/ (project RSI) or as a candidate a human commits (plugin RSI), and which targets the automatic path may touch at all. Read BEFORE running the evolve pipeline on any target. TRIGGER for "maintain evolve <id> --target=<type>", "can the auto path change this", "where does this evolve land", "why did evolve refuse my target". DO NOT TRIGGER for: rolling a change back (references/rollback-skill.md), reverting a harvest wiki write (references/wiki-revert.md), auditing scripts (references/audit.md), or authoring a net-new skill (guild:create-skill).
when_to_use: First step of every `maintain evolve` run, before the §11.2 pipeline. Also whenever a refusal names a target and the operator needs to know what unblocks it.
type: meta
---

# Evolve targets — one gate, two homes

Every evolve names exactly one target from a closed set of eleven. The target decides
the home, and the home decides whether anything is written at all.

The enum is sealed in `src/modules/evolution/workflows/evolve-targets.ts`. A twelfth
target is a code change, not a config key.

## The eleven

| Home | Targets | What a run produces |
|---|---|---|
| **project** | `skill` `playbook` `profile` `glossary` | a span replace under THIS repo's own `.guild/` |
| **plugin** | `assembler` `command` `agent` | a candidate under the plugin's `.guild/evolve/candidates/` |
| **plugin (KTD63)** | `hook` `adapter` `learn_script` `domain_ts` | the same candidate, plus compile + D5 + adapter-matrix tests before a human commits it |

`permission` is deliberately absent. But the target token is not where D5 is enforced —
see **Permissions are a content class** below.

## Project RSI writes this repo and nothing else

A project target lands in the sub-tree that owns it — `.guild/skills/`,
`.guild/playbooks/`, `.guild/agents/`, the wiki glossary — reached through
`GuildStorage`, never a hand-built `.guild` path.

Two things it never touches:

- **the plugin install dir.** A consuming repo's live specialist body is the minted copy
  under its own `.guild/agents/`, never the starter recipe it was minted from (KTD20).
- **anything outside this root.** A `../` spelling or a symlinked file is REFUSED, not
  resolved (R67). One root never evolves another root's guidance.

## Plugin RSI writes a candidate, and stops

Machinery targets produce a `guild.evolve_candidate.v1` file carrying the delta verbatim
— the same span, the same `before_hash` the proposer read — plus the promotion checklist.
Nothing reaches `src/surfaces/**`, `src/`, `hooks/`, `skills/`, `commands/`, `agents/`,
or `templates/`: the AC37 guard (`assertNotRuntimeTree`) makes those unreachable from any
writer in the domain, so the human commit is not a policy that could be forgotten.

Report the candidate path and `next_need: operator`. Do not offer to promote it.

## Permissions are a content class, not a target (D5)

A delta is a permission edit because of what it SAYS, not because of the token it
carries. `--target=playbook --auto` rewriting a playbook's `## Permissions` span from
"require operator approval before shell execution" to "always allowed without operator
approval" is a permission edit that happens to live in a playbook.

Four signatures over the WHOLE span — both the current and the proposed bytes — any one
of which is enough:

- the span's own heading names permissions, approval, allowed-tools, allow, or deny;
- a NESTED heading at any level does (a `## Rule` span containing `### Permissions` is
  the same edit one level down);
- either side declares a `permissions:` / `allowed-tools:` frontmatter key;
- a sentence changes what is allowed. That needs a permission NOUN (approval, permission,
  allow, deny, block, gate, confirm, consent, authorize, operator click, …) in the SAME
  sentence as modality (must, never, always, no, without, skip, bypass, require, do not)
  — or a bare state declaration like `Shell execution: blocked.`

Two things that are NOT signals, each of which produced a false positive before it was
narrowed: bare modality ("return a response without a stack trace" is error handling), and
a bare requirement ("a request ID is required" requires a field, not a permission; only
"operator approval is required" requires a permission).

Sentences are read as SENTENCES, not lines. A paragraph's soft line breaks are unwrapped
first, so `Always require\noperator approval…` is one unit; a blank line, a heading, a
list marker, a table row, or a fence ends the paragraph. A list item is its own unit, and
a table row is read both whole and per cell, because `| approval | required |` carries its
noun and its modality in different cells.

On a hit the delta is **proposal-only on every target, auto or not**: the result is
`applied: false`, `next_need: operator`, a candidate on disk, and the live file byte-for-
byte unchanged. Report the candidate path. Do not offer to apply it.

This is a heuristic, not a parser. A permissions change phrased without any of these
shapes will pass it; that is a known limit, not a guarantee.

## The file class beats the token

`.guild/skills/script.ts` is inside the project's own skills tree, and a markdown heading
inside a `//` comment is a locatable span — so directory containment alone let a
`--target=skill` delta write executable TypeScript.

The evolve writer writes **prose definitions only**: `*.md`, `SKILL.md`, playbooks, the
glossary. A `.ts` `.js` `.mjs` `.cjs` `.sh` `.json` target — or a file whose first bytes
are not text — is `domain_ts` or `learn_script` class whatever the token said, so it is
KTD63 human-only and becomes a candidate.

## What `--auto` may carry

The automatic (KTD33) path is the cheap curator: **lint + `before_hash`, no model.** The
replacement text comes from the redirect ledger's deterministic template, never from an
LLM rewriting the file.

| Target | `--auto` |
|---|---|
| `playbook`, `skill` | allowed — a third operator redirect span-replaces with no human click |
| everything else | refused, `next_need: operator` |

The curator contract is four conditions, checked by `assertCheapCurator` at the write
boundary: the target is on the auto path; the op is `replace` (an automatic `add` is new
guidance, which is a human's call); `before_hash` is present; and the replacement is
**template-rendered** by `renderCuratorSpan` — `Do not X. Do Y.` plus the decision id.
Free prose in a curator span is a model re-authoring someone's playbook, and it is
refused.

`profile` and `glossary` are project-home yet still human: a minted profile is an agent's
own definition, and a glossary term is a durable contract. A harvest DECISION may name a
`glossary_term:` (KTD70) — that is harvest's write, not the curator's.

The refusal happens BEFORE the home split, so an unattended run targeting `domain_ts`
does not even queue a candidate. An auto-filled human queue is how a gate becomes a
rubber stamp.

## The delta

`guild.evolve_delta.v1`: `replace` (default) | `add` (a genuinely new heading) | `remove`,
over a NAMED span (a markdown heading), carrying `before_hash`.

- `before_hash` is REQUIRED on every apply. Missing refuses; an optional integrity check
  is not a check. For `add` it pins the whole file, since the region does not exist yet.
- A `before_hash` mismatch REFUSES. It never re-bases onto the current text — a re-based
  replace silently discards the change it lands on top of.
- A span that is not in the file REFUSES. A replace never appends.
- `add` on a heading that already exists REFUSES. That is a `replace`; stacking a second
  copy is the R49 violation this whole rule exists to prevent.

## Latest-only (R49)

A replacement carrying a dated `Update (…)` appendix or a `Changelog` heading is refused
by the curator's lint before it can create the violation. Context files are the current
iteration only. The decision and the reasoning belong on a `guild.decision.v1` wiki page,
recalled on demand — never pasted into the live file.

## Checkpoint verdicts map onto targets

| Verdict (KTD57) | Route |
|---|---|
| `decision` | harvest — the only automatic wiki writer. NOT an evolve target |
| `playbook_span` | cheap curator, target `playbook` |
| `skill_def` | cheap curator, target `skill` |
| `reflect` | the human-gated `.guild/reflections/` queue |
| `none` | no-op |

An unrecognized verdict routes to the human queue, never to a write.

## Rollback

Every applied delta records its inverse span, both hashes, and the region's **byte
offset** with head/tail hashes in compact history (KTD48). `maintain rollback <key> [n]`
restores them — see `references/rollback-skill.md`. No durable per-version tree is
written.

Rollback verifies the SPAN, not the file. It locates the region by its anchor and restores
it when the region still hashes to `after_hash` — edits ANYWHERE ELSE in the file are
preserved and do not block the undo. A removal, which deleted its own anchor, is placed by
the text that surrounded it, narrowing from both sides to one side if an edit moved the
other.

**Ambiguity always blocks, and there is no tie-break.** An anchor that matches more than
once anywhere in the file blocks. A removal whose surrounding text matches more than once
blocks. The recorded offset is NOT consulted to choose between them: a shifted file is
exactly what invalidates a recorded offset, so preferring the hit that sits on it let a
duplicated file body capture the restore.

Four things block: an unparseable history file (it is never read as an empty stack, which
would let the next record overwrite every inverse), a missing anchor or missing context, an
ambiguous anchor or context, and a span whose own bytes changed after the delta landed.
