# Guild plugin description and example use cases

## Plugin description

Guild turns Claude Code into a self-evolving team of specialist agents for larger software tasks. It plans before execution, selects the right specialists, assembles focused context, preserves durable project memory, and improves its skills over time through evidence-based reflection.

Instead of treating every request as a single long prompt, Guild breaks work into a governed workflow: clarify the goal, compose the right agent team, execute with scoped context, review the results, capture decisions, and only evolve specialists or skills when repeated evidence shows they are useful. When native agent teams are available, Guild coordinates them directly; when they are not, it falls back to sub-agents with the same planning and memory discipline.

Guild is designed for projects where context, quality, and continuity matter: feature work, refactors, documentation, QA, release preparation, research-heavy implementation, and recurring workflows that benefit from reusable specialist knowledge.

## Short description

Self-evolving specialist agent teams for Claude Code: plan carefully, execute with scoped context, preserve project memory, and improve through evidence.

## Example use cases

### Build a feature end to end

```text
/guild Add usage-based billing, update tests, document the flow, and prepare release notes.
```

Guild clarifies requirements, composes backend/frontend/docs/testing specialists as needed, executes the work, and records decisions for future tasks.

### Refactor safely

```text
/guild Refactor the authentication flow without changing user-visible behavior.
```

Guild plans the migration, identifies risk areas, uses focused specialists, and keeps review grounded in tests and evidence.

### Turn vague goals into an approved plan

```text
/guild Improve onboarding for new workspace users.
```

Guild asks planning questions first, captures constraints and acceptance criteria, then waits for approval before autonomous execution.

### Preserve project memory

```text
/guild Document the decisions from this implementation and update the project wiki.
```

Guild separates raw source material from synthesized memory so future agents can reuse reliable project knowledge.

### Use specialists only when useful

```text
/guild Audit this release for security, docs, tests, and user-facing regressions.
```

Guild selects only the specialists needed for the task instead of loading every possible role.

### Evolve skills responsibly

```text
/guild We keep repeating this workflow. Propose a reusable specialist or skill for it.
```

Guild can suggest new specialists or skills, but gates them through review, shadow evaluation, and evidence before making them part of the live roster.
