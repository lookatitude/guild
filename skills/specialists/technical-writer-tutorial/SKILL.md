---
name: technical-writer-tutorial
description: Writes a walk-through tutorial — getting-started, first-project, end-to-end integration — with numbered steps, expected output per step, and a troubleshooting section. Pulled by the `technical-writer` specialist. TRIGGER: "write a getting-started tutorial for X", "write the quickstart guide", "walk a new developer through integrating Y", "write the first-project tutorial", "create a step-by-step how-to for Z", "write a hands-on walkthrough". DO NOT TRIGGER for: reference docs for every endpoint (use `technical-writer-api-docs`), task-based user manual pages (use `technical-writer-user-manual`), release notes (use `technical-writer-release-notes`), designing the onboarding UX (product/design scope, not this skill), marketing content explaining why to use the product (copywriter-long-form).
when_to_use: The parent `technical-writer` specialist pulls this skill when the task needs a linear, hands-on walkthrough a reader completes front-to-back. Also fires on explicit user request.
type: specialist
---

# technical-writer-tutorial

Implements `guild-plan.md §6.2` (technical-writer · tutorial) under `§6.4` writing principles: match the product's actual install/run steps (verify them), don't rewrite adjacent docs, evidence = a reader who follows the tutorial reaches the working end-state without detours.

## What you do

Write one tutorial that takes a reader from zero to a working outcome in one sitting. A tutorial is not reference — it is a guided, linear path with one happy path and explicit escape hatches.

- State the outcome up front. The reader should know exactly what they'll have at the end (and roughly how long it takes).
- List prerequisites concretely: OS, versions, accounts, CLIs. "A recent Node" is not a prereq; "Node ≥ 20" is.
- Verify every command yourself or with the owning specialist before shipping. A broken step zero kills the tutorial.
- Each step: one action, the command/code, the expected output. If the output varies, show the anchor line.
- Include a "what could go wrong" per risky step with the recovery command.
- End with "where to go next" — 2–3 concrete follow-up paths.

## Output shape

A single markdown file with:

1. **Outcome** — one paragraph on what you'll build + estimated time.
2. **Prerequisites** — versioned list.
3. **Steps** — numbered. Per step: action, code block, expected output, common pitfall.
4. **Verify** — final check the reader runs to confirm success.
5. **Troubleshooting** — 3–6 known failure modes with fixes.
6. **Next** — linked reference docs, manual pages, deeper tutorials.

Store at `.guild/runs/<run-id>/docs/tutorial-<slug>.md` if tracked.

## Anti-patterns

- Skipping setup — "assuming you have the CLI installed" is not a tutorial; it's a trap.
- Assuming tools installed that aren't default (`jq`, `gh`, specific SDK versions).
- No expected output — the reader can't tell pass from fail without running six more commands.
- No troubleshooting section — the first error sends them to support.
- Multiple happy paths in one tutorial (mac/linux/windows all fully inline) — fork into variants instead.
- Reference-doc creep — linking out is better than inlining the full schema.

## Handoff

Return the tutorial path to the invoking `technical-writer` specialist. If the tutorial surfaces a broken step or missing feature, raise a followup for the owning engineering specialist. Chain into `technical-writer-api-docs` for reference depth and `technical-writer-user-manual` for task-based follow-ups. This skill does not dispatch.
