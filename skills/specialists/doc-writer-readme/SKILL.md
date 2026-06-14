---
name: doc-writer-readme
description: "Authors or updates a project README — overview, quick-start, installation, usage, badges, contributing pointer, license section. Reads existing README conventions and repo type before writing. Pulled by the `doc-writer` specialist. TRIGGER: \"write a README for this project\", \"update the README\", \"add a quick-start section to the README\", \"the README is outdated, fix it\", \"create a README for my CLI tool\", \"add badges and installation instructions to the README\". DO NOT TRIGGER for: API reference docs or endpoint tables (use `technical-writer-api-docs`), formal user manuals (use `technical-writer-user-manual`), changelog entries or release notes (use `technical-writer-release-notes`), blog post announcing the project (use `copywriter-long-form`), onboarding documentation or CONTRIBUTING.md (use `doc-writer-onboarding-doc`), doc-site pages beyond the README (use `doc-writer-doc-site`)."
when_to_use: The parent `doc-writer` specialist pulls this skill when the task is authoring or updating a project README. Also fires on explicit user request.
type: specialist
---

# doc-writer-readme

Match existing README style and repo conventions before imposing a new structure, calibrate depth to the project type (library, CLI, SaaS, monorepo), and produce a page the reader can skim in one pass.

## What you do

Author or update the root `README.md` (or `README.rst`, etc.) for a project. Your job is orientation and first-contact success — a reader should be able to understand what the project does and get it running without leaving the README.

- **Read before writing.** If a README already exists, read it fully. Preserve conventions, heading style, badge placement, and tone unless asked to overhaul.
- **Match repo type.** A library README differs from a CLI tool README, a SaaS product README, and a monorepo README. Calibrate the sections accordingly.
- **Start from the project's own code.** Read the main source entry point, `package.json` / `Cargo.toml` / `pyproject.toml`, or whatever is present — do not invent capabilities the project does not have.
- **Scope strictly.** Write what was asked. Adding a quick-start section ≠ rewriting the whole README. Don't rewrite sections the user didn't mention.

## Standard README sections

Adapt to the project type — not every section is required for every project:

1. **Project title + one-line description** — what it is and who it is for.
2. **Badges** (optional but conventional) — CI status, npm/PyPI version, license. Use shields.io or the host's badge API; don't fabricate badge URLs.
3. **Overview / Why** — 2–4 sentences on the problem and why this project solves it. Not a sales pitch — this is doc-writer, not copywriter.
4. **Quick-start** — the shortest path from `git clone` to a working result. Code blocks with realistic, runnable commands.
5. **Installation** — explicit steps (package manager installs, system dependencies, environment variables required).
6. **Usage** — the most important commands or API calls. Link to deeper docs if they exist.
7. **Configuration** — key config options with defaults. Keep brief; link to full config docs.
8. **Contributing** — one paragraph + link to `CONTRIBUTING.md`. Don't expand inline; `doc-writer-onboarding-doc` owns CONTRIBUTING.md.
9. **License** — one line stating the license and linking to `LICENSE`.

## Output shape

A single `README.md` (or named as the project uses). Use fenced code blocks with language specifiers. Links are relative unless the target is external. If the README is being updated, return the full updated file (not a diff) unless the change is purely additive.

Store at the repo root, or at the path the user specifies. If run-tracked, note the path under `.guild/runs/<run-id>/docs/readme-<slug>.md`.

## Anti-patterns

- Inventing features the codebase doesn't have — always read the source first.
- Using placeholder commands (`npm install <package-name>`) instead of the actual package name.
- Rewriting the entire README when asked to update one section.
- Adding a "Features" bullet list that restates the description — if it doesn't add information, cut it.
- Fabricating badge URLs — only add badges with real endpoints.
- Writing persuasive/marketing language — the README informs; it does not sell. (`copywriter` handles that.)

## Handoff

Return the README path. If the README reveals missing documentation (e.g., no CONTRIBUTING.md, no doc site, no API reference), raise each as a followup to the relevant specialist (`doc-writer-onboarding-doc`, `doc-writer-doc-site`, `technical-writer-api-docs`). This skill does not dispatch.
