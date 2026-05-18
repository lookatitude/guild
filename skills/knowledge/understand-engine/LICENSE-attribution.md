# Third-party attribution — Guild Codebase-Understanding Engine (skill half)

The `guild:understand-engine` skill is the **Guild-owned LLM + orchestration
half** of a codebase-understanding engine. Its design (the two-phase
script→LLM pipeline, the 7-stage lane contract, the universal
knowledge-graph schema, the tolerant validate/repair ladder, the node/edge
alias tables, the layer-pattern table, the incremental fingerprint +
change-classifier) is internalized from the **Understand-Anything** project
and re-implemented as Guild-owned skills + scripts.

## Zero runtime dependency statement

This skill has **zero runtime dependency** on the `understand-anything`
package. It does not `import` from it, does not invoke any
`understand-anything:` skill, MCP server, or binary, and does not read or
write `.understand-anything/` paths. All artifacts are written under
`.guild/`. It orchestrates only the Guild-owned deterministic scripts under
`plugin/scripts/understand/` (Node builtins + `tsx`, no `zod`/`tree-sitter`/
`fuse.js`/`ignore`).

Verify: `grep -rn "understand-anything" plugin/skills/knowledge/understand-engine/`
returns only this attribution file.

## Forked material (design, MIT-attributed)

The 7-stage pipeline shape, the ~80-entry node/edge alias tables, the
sanitize→normalize→auto-fix→validate ladder logic, the default ignore-pattern
set, the layer-pattern table, and the fingerprint/change-classifier
thresholds are derived from the Understand-Anything source and are governed by
its MIT license, reproduced verbatim below.

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
