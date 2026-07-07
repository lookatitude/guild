---
name: doc-writer-product-guide
description: "Authors product feature documentation and conceptual guides — what-is-X explanations, feature overview pages, conceptual architecture docs, how-it-works narratives, system-explanation guides. Pulled by the `doc-writer` specialist. TRIGGER: \"write a feature guide for X\", \"explain how Y works in the docs\", \"conceptual overview of the API\", \"add a guide explaining our architecture\", \"write a product documentation page for feature X\", \"write a how-to doc for configuring Y\", \"add a what-is page for Z\". DO NOT TRIGGER for: API endpoint reference tables or parameter docs (use `technical-writer-api-docs`), formal step-by-step tutorials with prerequisite/verify blocks (use `technical-writer-tutorial`), formal user manuals with task hierarchy (use `technical-writer-user-manual`), landing-page prose or marketing copy (use `copywriter-long-form`), blog posts about the feature (use `copywriter-long-form`), doc-site navigation and IA design (use `doc-writer-doc-site`)."
when_to_use: The parent `doc-writer` specialist pulls this skill when the task requires a narrative, explanation-first product documentation page or conceptual guide. Also fires on explicit user request.
type: specialist
---

# doc-writer-product-guide

Match existing doc-site conventions and tone, write to inform not to persuade, produce a page the reader can skim in one pass.

## What you do

Produce narrative, explanation-first documentation pages that tell a reader *what* a feature is, *why* it exists, and *how* it fits the system. This is Diátaxis "explanation" and "how-to" territory — not reference, not tutorial.

- **Read the existing docs first.** If there is a doc site or existing pages, sample at least two pages for heading style, tone, code-block conventions, and cross-link patterns. Calibrate before writing.
- **Anchor to the actual code.** Read the relevant source module or spec before writing about it. Don't describe a feature you haven't seen implemented.
- **Scope strictly.** A request for a feature guide covers that feature, not the whole product. Add a "See also" pointer to adjacent docs rather than rewriting them.
- **Explain, don't sell.** This is documentation, not marketing. No superlatives, no "powerful", no "seamlessly".

## Standard product guide sections

Adapt to the subject — not all sections are required:

1. **What is X** — one paragraph: the thing, the problem it solves, who uses it.
2. **How it works** — the conceptual model. Diagrams in Mermaid or ASCII if it helps. Avoid implementation details unless the reader needs them to use the feature correctly.
3. **Key concepts / Terminology** — define domain terms that appear in the UI or API. One definition per term; avoid nested definitions.
4. **Prerequisites** — what the reader needs before using this feature (a plan tier, a config flag, another feature).
5. **How to X** (how-to sections) — one named section per goal. Steps are numbered; each step is one action. Commands in fenced code blocks.
6. **Configuration reference pointer** — if there is a detailed config table, link to it rather than reproducing it inline. (`technical-writer-api-docs` or an existing reference page owns the table.)
7. **Limitations and known issues** — honest, factual. If there are known edge cases or caveats, say so.
8. **See also** — cross-links to related guides, the API reference, the changelog.

## Output shape

Markdown (or the doc-site generator's flavored markdown) with a clear H1 title, structured H2/H3 sections, and fenced code blocks with language specifiers. Internal links are relative. Images/diagrams are referenced, not embedded as base64.

If tracked, store at `.guild/runs/<run-id>/docs/product-guide-<slug>.md`.

## Anti-patterns

- Writing about behavior not yet shipped or not in the source — always ground descriptions in the code.
- Conflating explanation with reference — if a section is becoming a parameter table, that's a followup for `technical-writer-api-docs`.
- Persuasive framing ("powerful new feature", "seamlessly integrates") — that belongs in copywriter's hands.
- Copying code comments verbatim as documentation — rephrase for the reader's mental model.
- Scope creep — adding new sections the user didn't ask for without flagging them as followups.

## Handoff

Return the guide path. If writing the guide reveals that a formal API reference, a tutorial, or a user manual is also needed, raise each as a followup to the relevant specialist. This skill does not dispatch.
