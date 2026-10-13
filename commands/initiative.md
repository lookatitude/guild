---
name: initiative
description: "Durable work — opt-in noun with sub-verbs new|status|list|resume|update|archive|restore|close. A one-off /guild run never creates an initiative; attachment is explicit only. Dispatches to guild:initiative."
argument-hint: "new|status|list|resume|update|archive|restore|close [id] [--add-goal \"…\"] [--archived]"
allowed-tools: Read, Write, Edit, Grep, Glob, Bash, Agent, Skill, AskUserQuestion
---

# /guild:initiative — durable work

The first token is the sub-verb; the assembler implements all eight, applies each
one's default gate, and owns every `.guild/initiatives/**` read and write. An
unknown sub-verb prints usage and invokes nothing.

`close` runs the deterministic D8 close gate and refuses to close on a non-zero
exit — including any cited `close_gate.evidence` or work-item `evidence_refs`
path that does not exist.

## Dispatch

```
Skill: guild:initiative
args: $ARGUMENTS
```
