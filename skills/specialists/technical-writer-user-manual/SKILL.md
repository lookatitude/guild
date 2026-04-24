---
name: technical-writer-user-manual
description: Writes user-facing product documentation — task-based pages organized around what a user is trying to do, with steps, screenshots, caveats, and a glossary. Pulled by the `technical-writer` specialist. TRIGGER: "write the user manual for X", "document how to use feature Y", "write the help-center article for Z", "create the product documentation for the admin console", "write the user guide section on settings", "document the workflow for onboarding new users". DO NOT TRIGGER for: API reference docs (use `technical-writer-api-docs`), step-by-step getting-started walkthrough (use `technical-writer-tutorial`), release notes (use `technical-writer-release-notes`), marketing or persuasive product copy (copywriter-long-form), in-product string/button copy (copywriter-product-microcopy), landing page (copywriter-long-form or marketing group).
when_to_use: The parent `technical-writer` specialist pulls this skill when the task is user-facing product docs organized around tasks the user performs. Also fires on explicit user request.
type: specialist
---

# technical-writer-user-manual

Implements `guild-plan.md §6.2` (technical-writer · user-manual) under `§6.4` writing principles: match the product's UI labels exactly, don't rewrite adjacent pages that weren't asked about, evidence = a page a user can complete the task from without opening support.

## What you do

Write task-based pages — each one answers "how do I do X?" in the product. You are not writing a feature brochure; you are writing the doc a user reaches when something blocks them.

- Start from tasks, not features. "Invite a teammate" is a task; "Teams" is a navigation tab.
- Each page: goal in one line, prerequisites, steps, expected result, caveats/limits, "what next".
- Screenshots where UI is ambiguous; annotate them. Skip them where they'll go stale inside a sprint.
- Match the product's UI strings exactly — if the button says `Send invite`, the doc says `Send invite`, not `Send invitation`.
- Assume the user knows their job, not your product. Link out to a glossary on jargon; don't define `webhook` inline eight times.
- Call out destructive actions, permissions, limits, and known issues in a consistent admonition style.

## Output shape

Markdown pages (one per task) with:

1. **Title** — the task phrased as the user would search it.
2. **Goal** — one sentence on what this page gets you.
3. **Prerequisites** — plan, permission, setup requirement.
4. **Steps** — numbered, each step one action.
5. **Result** — what success looks like.
6. **Caveats** — limits, permissions, gotchas.
7. **Next** — 2–3 linked follow-on tasks.

Glossary lives in a sibling `glossary.md`. Store pages at `.guild/runs/<run-id>/docs/manual-<slug>.md` if tracked.

## Anti-patterns

- Feature-list dumps — a page per feature with no task framing.
- Assumed expertise: "simply configure the webhook endpoint" when the user has never seen `Webhooks`.
- Screenshots everywhere — stale within weeks, painful to maintain.
- No glossary, so every page re-defines the same terms inconsistently.
- Mismatched UI strings — doc says `Settings > Team`, product says `Admin > Members`.
- Missing permissions note — the user follows every step and hits "Access denied" at the last one.

## Handoff

Return the manual path(s) to the invoking `technical-writer` specialist. If a page reveals UX issues (confusing labels, missing affordance), file them as followups — do not change the product. Chain into `technical-writer-tutorial` for a first-time-user walkthrough and `technical-writer-release-notes` when pages change with a version. This skill does not dispatch.
