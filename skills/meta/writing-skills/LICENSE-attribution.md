# License attribution

This skill is a Guild-native fork of `superpowers:writing-skills`
(the [superpowers](https://github.com/obra/superpowers) plugin for Claude Code)
at version 5.0.7, §13.

## Upstream

- Original skill name: `writing-skills`
- Plugin: `superpowers` v5.0.7 (§13)
- License: MIT
- Copyright: © 2025 Jesse Vincent

## Adaptation

This is a **Guild-native gap-fork** with **zero runtime dependency** on the
upstream plugin (one of "The 4 Superpowers Gap-Forks" — see
`factory/skills-and-self-evolution.md §"The 4 Superpowers Gap-Forks"` and
`IMPL-00-skeleton.md §6 GR-1`). Guild's adaptations:

- Reshaped into the authoring **method that fills** Guild's canonical
  `plugin/templates/skills/SKILL.template.md` skeleton (the DH-3 boundary),
  rather than a standalone skill-writing playbook.
- Body rewritten Guild-native around the 9 required heading labels, the
  mandatory `derived_from_template: guild.skill_template.v1` stamp, and the
  `.guild/skills/` instance write location (never plugin install state).
- Frontmatter `description` / `when_to_use` authored in Guild's style and
  tied into `guild:create-specialist` / `guild:evolve-skill`.
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
