# License attribution

This skill is a Guild-native fork of `superpowers:verification-before-completion`
(the [superpowers](https://github.com/obra/superpowers) plugin for Claude Code)
at version 5.0.7, §8.

## Upstream

- Original skill name: `verification-before-completion`
- Plugin: `superpowers` v5.0.7 (§8)
- License: MIT
- Copyright: © 2025 Jesse Vincent

## Adaptation

This is a **Guild-native gap-fork** with **zero runtime dependency** on the
upstream plugin (one of "The 4 Superpowers Gap-Forks" — see
`factory/skills-and-self-evolution.md §"The 4 Superpowers Gap-Forks"` and
`IMPL-00-skeleton.md §6 GR-1`). Guild's adaptations:

- Renamed to `guild-verify-claim` to align with Guild's skill-name convention
  and the v2 fork-naming reconciliation (`P0-skill-count-reconciliation.md`).
- Body rewritten Guild-native around an independent VCS-diff before any
  completion/success language and before a handoff receipt is trusted into
  `guild:review`; paired with `guild:verify-done` / `guild:review`.
- Frontmatter `description` authored in Guild's TRIGGER / DO NOT TRIGGER style
  and tied into the Guild lifecycle.
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
