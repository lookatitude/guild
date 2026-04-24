---
name: copywriter-product-microcopy
description: Writes in-product strings — button labels, empty states, error messages, tooltips, form labels, confirmation dialogs, toast copy. Output is a string table keyed by component/key so engineering can drop it straight into i18n files. Pulled by the `copywriter` specialist. TRIGGER: "write the button label for X", "write the empty state for X", "rewrite this error message", "write tooltip copy for X", "draft the toast/confirmation copy", "name the CTA on the X screen". DO NOT TRIGGER for: marketing blog posts or landing long-form (use `copywriter-long-form`), email sequences (use `copywriter-email-sequences`), voice guide itself (use `copywriter-voice-guide`), user manual pages (technical-writer-user-manual), getting-started tutorials (technical-writer-tutorial), social captions (social-media-platform-post), SEO meta titles and descriptions (seo-on-page-optimization).
when_to_use: The parent `copywriter` specialist pulls this skill when the task is in-product UI text — any string bound to a component rather than a standalone page. Also fires on explicit user request.
type: specialist
---

# copywriter-product-microcopy

Implements `guild-plan.md §6.2` (copywriter · product-microcopy) under `§6.4` writing principles: match the existing product voice, never rewrite adjacent strings the brief didn't ask about, evidence = the string table a PM can scan and approve in one pass.

## What you do

Produce every in-product string requested, keyed by component and state, consistent in tone, unambiguous in action. Microcopy is the one place where being concise and being clear can't both win — if they fight, clarity wins.

- Match the existing product voice; pull samples from the app and from `standards/writing-voice.md` before writing.
- CTAs use verbs that name the action (`Save changes`, `Delete account`) — not `OK` / `Submit` / `Click here`.
- Error messages name what happened, why, and what the user can do — in that order, in one sentence where possible.
- Empty states do three jobs: explain the zero state, give one next action, set expectation for the filled state.
- Tooltips supplement; they never carry load-bearing info a user must read to succeed.
- Respect character limits — mobile buttons, table headers, toast widths. Ask if you don't know them.

## Output shape

A table (markdown or YAML) keyed by `component.state.key`:

```
| key                          | string                              | notes            |
|------------------------------|-------------------------------------|------------------|
| inbox.empty.title            | No messages yet                     | ≤32 chars       |
| inbox.empty.body             | New threads will land here.         |                  |
| inbox.empty.cta              | Start a conversation                |                  |
| order.delete.confirm.title   | Delete this order?                  | destructive     |
| order.delete.confirm.body    | This can't be undone.               |                  |
```

Store at `.guild/runs/<run-id>/copy/microcopy-<slug>.md` if tracked.

## Anti-patterns

- Inconsistent tone across states (`Whoops!` next to `An error has occurred`).
- Ambiguous CTAs: `OK`, `Submit`, `Continue` with no object.
- Verbose errors: three sentences where the user needs one verb.
- Cutesy copy on destructive actions — "Byeeee!" on account deletion is hostile.
- Technical jargon leaking into user-facing strings (`null reference exception`, `HTTP 500`).
- Drifting into marketing voice on utilitarian surfaces (settings, admin panels).

## Handoff

Return the string table to the invoking `copywriter` specialist. If the strings reveal a voice inconsistency across the product, chain into `copywriter-voice-guide`. Engineering picks up the strings for i18n wiring — this skill does not dispatch.
