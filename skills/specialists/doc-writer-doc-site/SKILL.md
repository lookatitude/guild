---
name: doc-writer-doc-site
description: "Authors documentation-site pages and designs information architecture — navigation, sidebar taxonomy, page hierarchy, cross-linking strategy, doc-site generator conventions (Docusaurus, MkDocs, Nextra, VitePress, etc.). Pulled by the `doc-writer` specialist. TRIGGER: \"build out the docs site\", \"write the documentation site pages\", \"design the doc site navigation\", \"add a sidebar section for feature X\", \"write the docs for Y in our Docusaurus site\", \"set up the doc-site IA\", \"create a new section in MkDocs for Z\", \"update the doc-site nav\". DO NOT TRIGGER for: API reference tables or endpoint docs (use `technical-writer-api-docs`), changelogs or release notes pages (use `technical-writer-release-notes`), a project README (use `doc-writer-readme`), onboarding or CONTRIBUTING.md (use `doc-writer-onboarding-doc`), deploying or configuring the doc-site hosting infra (use devops specialist), marketing landing pages (use `copywriter-long-form`)."
when_to_use: The parent `doc-writer` specialist pulls this skill when the task involves doc-site page content, information architecture, navigation design, or doc-site generator configuration. Also fires on explicit user request.
type: specialist
---

# doc-writer-doc-site

Match the existing doc-site generator, theme, and editorial conventions; don't restructure pages the user didn't scope; evidence = a navigable page the reader can skim in one pass.

## What you do

Produce documentation-site page content and information architecture artifacts. This covers both writing page content and designing or updating the nav/sidebar structure that makes pages discoverable.

- **Identify the doc-site generator first.** Read `docusaurus.config.js`, `mkdocs.yml`, `next.config.js` (Nextra), `vitepress.config.ts`, or equivalent. Understand the sidebar / nav config format before proposing changes.
- **Match the existing IA.** Read the current nav structure and at least two existing pages before proposing additions. Preserve the established taxonomy. Don't rename existing sections without explicit ask.
- **Scope strictly.** Adding one new section to the sidebar ≠ redesigning the whole nav. New pages go where they belong in the existing taxonomy; only propose a broader restructure if the existing IA is demonstrably broken for the stated goal.
- **Write for the format.** Docusaurus uses MDX and has category files; MkDocs uses `nav:` YAML; Nextra uses `_meta.json`. Produce the right format for the generator in use.

## Deliverable types

### Page content

Follows `doc-writer-product-guide` principles: explanation-first, one H1 per page, fenced code blocks with language specifiers, relative internal links, no persuasive language.

### Information architecture

When asked to design or update the nav/sidebar:

1. **Audit** — list the current top-level sections and identify the gap the new content fills.
2. **Propose** — a named section with a rationale sentence. Show where in the existing taxonomy it lands.
3. **Sidebar config patch** — the minimal diff or full replacement of the sidebar/nav config file. Use the generator-native format (e.g., Docusaurus `sidebars.js`, MkDocs `nav:` block, Nextra `_meta.json`).
4. **Redirect map** — if existing pages are being moved or renamed, list `source → destination` pairs for the generator's redirect plugin.
5. **Cross-link audit** — list pages that should link to the new section, with the link text and anchor point.

### Doc-site generator conventions

| Generator | Sidebar format | Frontmatter key | Ordering |
|---|---|---|---|
| Docusaurus | `sidebars.js` (JS or JSON) | `sidebar_position`, `sidebar_label` | numeric position |
| MkDocs (Material) | `mkdocs.yml nav:` block | none needed | YAML order |
| Nextra | `_meta.json` per dir | `title` in `_meta.json` | key order |
| VitePress | `.vitepress/config.ts sidebar:` | `title` in frontmatter | array order |

When the generator is not one of the above, read its config format before proposing changes.

## Output shape

- New pages: markdown/MDX files at the correct path for the generator.
- IA changes: updated sidebar/nav config file (full file, not a diff, unless the file is large — then a clearly-marked patch block).
- Redirect map: a fenced code block listing `old → new` pairs.
- Cross-link candidates: a bulleted list.

If tracked, store artifacts under `.guild/runs/<run-id>/docs/doc-site-<slug>/`.

## Anti-patterns

- Proposing a full IA restructure when asked to add one page.
- Using the wrong sidebar format for the generator in use.
- Creating broken internal links — verify relative paths against the existing file tree.
- Embedding raw HTML in MDX that breaks the doc-site build.
- Moving existing pages without providing a redirect map.
- Writing the deployment / hosting config — that's devops territory; note as followup.

## Handoff

Return the list of files written or modified, the sidebar config change, and the redirect map if applicable. If the IA work reveals missing content areas, raise each as a followup with the appropriate specialist (`doc-writer-product-guide`, `technical-writer-api-docs`, etc.). This skill does not dispatch.
