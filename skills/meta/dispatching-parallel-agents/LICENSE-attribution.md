# License attribution

This skill is a Guild-native fork of `superpowers:dispatching-parallel-agents`
(the [superpowers](https://github.com/obra/superpowers) plugin for Claude Code)
at version 5.0.7, §5.

## Upstream

- Original skill name: `dispatching-parallel-agents`
- Plugin: `superpowers` v5.0.7 (§5)
- License: MIT
- Copyright: © 2025 Jesse Vincent

## Adaptation

This is a **Guild-native gap-fork** with **zero runtime dependency** on the
upstream plugin (one of "The 4 Superpowers Gap-Forks" — see
`factory/skills-and-self-evolution.md §"The 4 Superpowers Gap-Forks"` and
`IMPL-00-skeleton.md §6 GR-1`). Guild's adaptations:

- Reshaped around Guild's lane model: dispatch is driven by the approved
  lane plan's `depends-on:` graph and `guild:execute-plan` fan-out, not a
  generic parallel-agent pattern.
- Body rewritten Guild-native around the frozen
  `guild.handoff_receipt.v1` contract (by pointer), the recorded
  `task_run.autonomy_policy`, the subagent-default / agent-team-opt-in
  backend rule, and the unconditional always-ask hard set.
- Frontmatter `description` / `when_to_use` authored in Guild's style and
  tied into `guild:execute-plan` / `guild:review`.
- Self-evolvable under the same promotion gate + permission carve-out as any
  Guild skill — no special pipeline.

## MIT License (verbatim)

```
MIT License

Copyright (c) 2025 Jesse Vincent

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
