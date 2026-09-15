/**
 * src/modules/state/workflows/upgrade-glossary.ts
 *
 * `guild.glossary.v1` FEEDSTOCK (R80 / KTD70). Every Guild root has a glossary at
 * `.guild/wiki/glossary.md`; init and upgrade create it when it is missing and
 * NEVER overwrite one a project already has.
 *
 * Why the feedstock is a constant and not a file read from the install tree: the
 * upgrade runs from whichever package the host resolved, and a missing feedstock
 * path would turn "create the glossary" into a silent no-op. A constant cannot go
 * missing. T09 owns growing this text; the shape below is the contract.
 *
 * The terms here are GUILD-OPERATING terms only. Project terms are the project's
 * to add — which is exactly why an existing file is never replaced.
 */

export const GLOSSARY_FEEDSTOCK = `---
schema_version: guild.glossary.v1
title: Glossary
description: Guild operating terms. Add this project's own terms below; Guild never overwrites this file.
---

# Glossary

Terms the Guild machinery uses. The context-manager attaches matching entries to a
specialist bundle on demand — this file is never loaded whole into the always-on
prefix (KTD70).

## Guild terms

- **root** — a directory with a \`.guild/\` tree. Guild has exactly two levels: an
  umbrella workspace root and its immediate project roots.
- **durable** — content under \`.guild/\` that you would lose by deleting it. Caches,
  scratch and runtime state are NOT durable and live off the repo.
- **run** — one lifecycle execution, recorded under \`.guild/runs/<run-id>/\`.
- **lane** — one specialist's slice of a plan, dispatched as its own task cell.
- **handoff** — the compact envelope a specialist returns. The parent reads the
  envelope, never the specialist's transcript.
- **tier** — \`cheap\` | \`mid\` | \`powerful\`. A selector, never a model name; the
  host adapter maps a tier to a model at dispatch.
- **session binding** — the host and models resolved for ONE run. Session state,
  never durable config.
- **harvest** — the automatic capture of a decision into this root's wiki.
- **layout version** — the integer in \`.guild/storage-layout.json\` saying which
  storage layout this root is on. Guild upgrades a root on activation.

## Project terms

Add yours here. This file is yours once it exists.
`;
