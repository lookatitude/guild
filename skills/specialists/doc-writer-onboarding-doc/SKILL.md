---
name: doc-writer-onboarding-doc
description: "Authors onboarding documentation and contributor guides — getting-started narrative pages, CONTRIBUTING.md, developer onboarding docs, new-user setup guides, CODE_OF_CONDUCT.md, GOVERNANCE.md. Pulled by the `doc-writer` specialist. TRIGGER: \"write a getting-started guide\", \"create a CONTRIBUTING.md\", \"onboarding guide for new developers\", \"write the contributor guide\", \"new-user setup documentation\", \"developer onboarding doc\", \"write the getting started page\", \"add a CODE_OF_CONDUCT\". DO NOT TRIGGER for: project README overview (use `doc-writer-readme`), onboarding email sequences for existing SaaS users (use `copywriter-email-sequences` — copywriter owns lifecycle nurture emails), API reference docs (use `technical-writer-api-docs`), formal step-by-step tutorials with prerequisite/verify blocks (use `technical-writer-tutorial`), changelogs or release notes (use `technical-writer-release-notes`), marketing copy about onboarding (use `copywriter-long-form`)."
when_to_use: The parent `doc-writer` specialist pulls this skill when the task is writing a getting-started page, contributor guide, developer onboarding doc, or governance document. Also fires on explicit user request.
type: specialist
---

# doc-writer-onboarding-doc

Implements `guild-plan.md §6.2` (doc-writer · onboarding-doc) under `§6.4` writing principles: match the existing repo conventions, calibrate to the target reader (end-user vs. contributor vs. developer), and produce a page the reader can follow to a working result without leaving it.

## What you do

Produce written documentation artifacts that help a new reader orient, set up, and start contributing or using the project. The key distinction: this skill owns the **written documentation artifact** (a file in the repo or doc site), not a lifecycle email sequence — onboarding emails sent to SaaS users are `copywriter-email-sequences`.

Target reader types:
- **New end-user** — getting-started page: install, configure, first meaningful action.
- **New contributor** — CONTRIBUTING.md: how to fork, branch, run tests, open a PR, what the review process looks like.
- **New developer on the team** — developer onboarding doc: repo structure, local dev setup, key conventions, where to ask questions.
- **Community governance** — CODE_OF_CONDUCT.md, GOVERNANCE.md: community norms and decision-making process.

## Standard sections by artifact type

### Getting-started page

1. **Prerequisites** — system requirements, accounts, API keys. Be explicit; don't assume.
2. **Installation** — exact commands. Test them if possible; never fabricate.
3. **First run** — the shortest path to a meaningful result. One code block, one expected output.
4. **Next steps** — 3–5 links to the most relevant follow-on docs. Not a full table of contents.

### CONTRIBUTING.md

1. **Welcome paragraph** — tone-setter; one short paragraph.
2. **How to report a bug / request a feature** — issue template pointers or direct instructions.
3. **Development setup** — fork, clone, install dependencies, run tests, start the dev server.
4. **Branch and commit conventions** — naming pattern, commit message style, squash vs. merge policy.
5. **Pull request process** — what reviewers look for, how long review takes, who merges.
6. **Code of conduct pointer** — one line linking to CODE_OF_CONDUCT.md. Don't reproduce it inline.
7. **License agreement** — CLA or DCO if applicable.

### Developer onboarding doc

1. **Repo map** — top-level directory structure with one-line descriptions.
2. **Local dev setup** — exact commands; include environment variable setup.
3. **Key conventions** — coding style, test patterns, naming, logging.
4. **Architecture pointer** — link to the ADR log or architecture doc; don't reproduce it.
5. **Where to get help** — Slack channel, mailing list, issue label for questions.

### CODE_OF_CONDUCT.md / GOVERNANCE.md

For CODE_OF_CONDUCT.md, use the Contributor Covenant as the base (cite version) unless the project has an existing policy. Add project-specific enforcement contacts and escalation steps.

For GOVERNANCE.md, document the actual decision-making process — who has merge rights, how RFCs work, how the project makes breaking-change decisions. Do not invent a governance model; derive it from the project's existing practice or ask the user.

## Output shape

One or more Markdown files at their conventional repo paths (`CONTRIBUTING.md`, `docs/getting-started.md`, `CODE_OF_CONDUCT.md`, `GOVERNANCE.md`, etc.). Use fenced code blocks with language specifiers. Keep cross-links relative within the repo.

If tracked, store at `.guild/runs/<run-id>/docs/onboarding-<slug>.md`.

## Anti-patterns

- Conflating onboarding docs with onboarding emails — lifecycle nurture email sequences belong to `copywriter-email-sequences`.
- Writing a CODE_OF_CONDUCT that omits the enforcement contacts — an unenforced CoC is worse than none.
- Fabricating setup commands — always read `package.json`, `Makefile`, `pyproject.toml`, or the CI config to verify commands work.
- Scope creep: a CONTRIBUTING.md request does not include rewriting the README or the full doc site.
- Using generic contributor guides not calibrated to the project's actual branch/PR conventions.

## Handoff

Return the list of files written. If the onboarding work reveals missing docs (e.g., no architecture doc to link to, no doc site to point new users to), raise each as a followup to the relevant specialist. This skill does not dispatch.
