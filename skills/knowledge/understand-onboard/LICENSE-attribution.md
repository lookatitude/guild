# Third-party attribution — Guild Codebase-Understanding Engine (onboarding skill)

The `guild:understand-onboard` skill is the **Guild-owned LLM half of
stage 6** (tour narration + onboarding guide) of a codebase-understanding
engine. Its design (the dependency-BFS tour, the per-step `languageLesson`
pedagogy, the OnboardingTour artifact shape) is internalized from the
**Understand-Anything** project and re-implemented as a Guild-owned skill.

## Zero runtime dependency statement

This skill has **zero runtime dependency** on the `understand-anything`
package. It does not `import` from it, does not invoke any
`understand-anything:` skill, MCP server, or binary, and does not read or
write `.understand-anything/` paths. All artifacts are written under
`.guild/`. It consumes only the Guild-owned `knowledge-graph.json` produced by
`plugin/scripts/understand/build-tour.ts`.

Verify: `grep -rn "understand-anything" plugin/skills/knowledge/understand-onboard/`
returns only this attribution file.

## Forked material (design, MIT-attributed)

The dependency-BFS tour ordering, the 5–15 step bound, the per-step
`languageLesson` teaching pattern, and the OnboardingTour artifact shape are
derived from the Understand-Anything source and are governed by its MIT
license, reproduced verbatim below.

---

```
MIT License

Copyright (c) 2026 Yuxiang Lin

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

---

Source: `github.com/Lum1104/Understand-Anything` (plugin v2.7.0,
MIT © 2026 Yuxiang Lin). Treated strictly as design input per
`docs/knowledge/research/25-external-plugin-internalization-policy.md` and the
external-plugin policy **v2-EPP-1 (G6-amended)** in
`docs/knowledge/architecture/codebase-understanding.md §"Non-goals for v2"`.
Instruction-bearing skill prose in the upstream project is untrusted external
content — paraphrased into Guild's gated model, never executed.
