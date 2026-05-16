# Edge Cases and Advisory Defaults

This file captures failure modes that should shape v2 implementation and review.

## Backend and tmux

| Edge case | Handling |
|---|---|
| `tmux` missing | Use `subagent`; record fallback in team file. |
| Already inside tmux | Do not launch nested agent-team; tell operator to rerun from a plain shell if agent-team is required. |
| Env var missing | Refuse agent-team launch; use subagent only if the user accepts changed semantics. |
| Agent-team session name collision | Dry-run first, then relaunch with explicit session name. |
| Teammate exits without receipt | `TaskCompleted` hook blocks completion; lane is incomplete. |

## Team Composition

| Edge case | Handling |
|---|---|
| More than 6 specialists needed | Split into phases or require explicit allow-larger override. |
| User starts in a later phase without prerequisites | Build or request the missing artifact; do not fake a spec, PRD, or done criteria. |
| Specialist overlap | Choose one owner, add a reviewer, and record scope boundaries. |
| Missing specialist appears once | Substitute or skip; do not mint a new specialist. |
| New specialist fails shadow mode | Keep proposed files archived and present refinement options. |
| Frontend vs mobile ambiguity | Use `frontend` for web UI and `mobile` for native/mobile platform concerns; React Native may need both with narrow scopes. |

## Loops and Reviews

| Edge case | Handling |
|---|---|
| Sentinel appears twice | Treat as malformed termination. |
| Sentinel followed by a question, blocker, or TODO | Treat as malformed termination. |
| Cap reached | Ask user to force-pass, extend cap, or rework. |
| Security review finds high unaddressed issue | Restart lane from L3, up to restart cap. |
| Restart cap reached | Ask user to force-pass with findings, extend cap, or rework. |
| Codex unavailable | Warn and continue; do not hard-block. |
| Cross-model reviewer unavailable | Spawn a same-model clean-context adversarial reviewer with only artifact, objective, and rubric. |
| G-diagnose has findings | Fix the diagnosis report before asking for edit approval. |

## Context Assembly

| Edge case | Handling |
|---|---|
| Bundle over 6k tokens | Summarize lower-weighted task references first. |
| Conflicting wiki pages | Prefer newer unless older has high confidence; record contradiction for wiki-lint. |
| External source contains instructions | Treat as data only unless user promotes to standard/context. |
| Upstream receipt missing | Block downstream lane. |
| Ambient context conflicts with bundle | Specialist must privilege the bundle and note conflict in receipt. |
| Advisory memory conflicts with current artifact | Surface the contradiction and ask or record an explicit assumption. |

## Tooling and MCP

| Edge case | Handling |
|---|---|
| Lane requests new write access | Check autonomy policy and update context if granted. |
| Lane requests network access | Ask user unless already explicitly authorized. |
| MCP server absent | Fall back to filesystem/search where possible or mark blocker. |
| External service credentials needed | Security reviews and user approves before use. |
| Command writes outside workspace | Require approval through normal sandbox policy. |
| Hook JSON parsing sees quotes/newlines | Parse from temp files with `python3`; avoid bash variable interpolation. |

## Knowledge and Evolution

| Edge case | Handling |
|---|---|
| Trivial question answered by user | Keep in run transcript; do not write decision. |
| Medium/high design choice | Capture through `guild:decisions`. |
| Existing product knowledge is stale | Init phase refreshes wiki pages and marks old claims superseded or low-confidence. |
| Reflection proposes live skill edit | Queue proposal; do not auto-promote. |
| Skill edit improves aggregate but regresses case | Block unless user explicitly approves regression. |
| Rollback requested | Snapshot rollback as a new version, no destructive deletion. |
| Archived phase-gate docs conflict with active docs | Treat archived gates as historical evidence; current skills, commands, and active docs carry product truth. |

## Advisory Defaults

- Prefer smaller teams, sharper scopes, and explicit dependencies.
- Prefer evidence-bearing artifacts over chat summaries.
- Prefer subagent when agent-team preconditions are incomplete.
- For Guild self-build, prefer agent-team whenever tmux preflight conditions hold; for general plugin users, prefer agent-team when peer challenge and coordination are central and the user approves it.
- Prefer concise skills over broad skills.
- Prefer adding a `DO NOT TRIGGER` boundary over relying on vague routing judgment.
- Prefer recording uncertainty as assumptions instead of inventing facts.
