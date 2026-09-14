---
name: wiki
description: "Wiki operations — ingest a source, query the wiki, or run the health lint. An unknown sub-verb prints usage and invokes nothing. Dispatches to guild:wiki."
argument-hint: "ingest <path> | query \"<text>\" [--category|--owner|--confidence|--updated-since|--tag] | lint"
allowed-tools: Read, Write, Edit, Grep, Glob, Bash, Agent, Skill, AskUserQuestion
---

# /guild:wiki — project knowledge

Ingest stays human-gated: a source becomes a candidate, and only the gate lands it

## Sub-verbs

| Token | Scope |
|---|---|
| `ingest <path>` | ingest a URL or local file as a sourced candidate |
| `query "<text>"` | BM25 search with the optional filter flags |
| `lint` | wiki health linter |

## Dispatch

```
Skill: guild:wiki
args: $ARGUMENTS
```

The first token selects the chapter; the rest forwards as `args`. Every wiki
write is the assembler's, behind its own gate.
