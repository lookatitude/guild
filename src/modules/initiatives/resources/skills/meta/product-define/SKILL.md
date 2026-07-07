---
name: guild-product-define
description: Product-loop DEFINE producer — turns a validated explore artifact into a typed, fail-closed `guild.define.v1` PRD nucleus whose every acceptance criterion carries a STABLE, unique id for full downstream traceability (plan lane → build receipt → QA check → release gate, AC32). Emits acceptance_criteria[{id,text}] plus user_stories, non_goals, risks, affected_surfaces, test_implications, and self-validates with validateDefineV1. TRIGGER after guild:product-explore produces a valid explore artifact, or when a user asks to define / write the PRD / set acceptance criteria for an explored product idea. It produces the DEFINE artifact only; it does not plan lanes or build. DO NOT TRIGGER for engineering/maintenance prompts, for the initial idea exploration (that is guild:product-explore), for team composition, code edits, or micro-tasks.
when_to_use: Second product-loop step, after guild:product-explore writes a valid guild.explore.v1 artifact; or on an explicit "write the PRD / define acceptance criteria" request for an explored idea. Its stable AC ids are what the plan/build/QA/release stages later resolve.
type: meta
---

# guild:product-define

The **second step of the product loop**. Given a validated `guild.explore.v1` artifact, you
turn the explored idea into a **typed, fail-closed `guild.define.v1` PRD nucleus**. The
load-bearing requirement (AC32) is **traceability**: every acceptance criterion carries a
**stable, unique id** so it can be resolved from a plan lane, a build handoff receipt, a QA
check, AND a release gate. You freeze that contract here.

You produce the **define artifact only**. You do NOT plan lanes or build (that is the normal
lifecycle, downstream).

## When to use it
- `guild:product-explore` has written a valid explore artifact and the idea is worth defining.
- A user explicitly asks to write the PRD / set acceptance criteria for an explored idea.

## When NOT to use it
- The idea hasn't been explored yet → `guild:product-explore` first.
- Engineering/maintenance prompts (`intake = other`) — stay in the normal lifecycle.
- Planning lanes / composing a team / editing code.

## Required inputs
- The validated `.guild/explore/<slug>.json` (`guild.explore.v1`) from `guild:product-explore`.
- The canonical shape: `guild.define.v1` (`${GUILD_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT}}/scripts/lib/define-schema.ts`),
  whose `DEFINE_V1_EXAMPLE` is the golden shape to mirror.

## Output contract — `guild.define.v1`
Write a JSON artifact to **`.guild/define/<slug>.json`** (reuse the explore slug). It MUST
satisfy `validateDefineV1` — every required field present and **non-empty**, and every
`acceptance_criteria[].id` **stable and unique** (the validator fails closed on a
missing/empty field, a duplicate/empty AC id, or an unknown key):

```json
{
  "schema_version": "guild.define.v1",
  "acceptance_criteria": [
    { "id": "AC-1", "text": "a verifiable acceptance criterion (stable, unique id)" }
  ],
  "user_stories": ["As a <user>, I <goal> so that <benefit>."],
  "non_goals": ["explicit out-of-scope statement"],
  "risks": ["what could sink delivery"],
  "affected_surfaces": ["code/product surface this touches"],
  "test_implications": ["what must be tested as a result"]
}
```
Mirror `DEFINE_V1_EXAMPLE` for the exact shape. Emit ONLY the allowed keys (strict).

## Workflow steps
1. Read the validated explore artifact; derive `acceptance_criteria` from its
   `evidence_needs` + `recommended_next_step`, `risks` from its `risks`, etc.
2. Assign each acceptance criterion a **stable, unique id** (`AC-1`, `AC-2`, …). These ids
   are the traceability tokens — keep them stable across edits; never reuse an id for a
   different criterion.
3. Fill `user_stories`, `non_goals`, `risks`, `affected_surfaces`, `test_implications`
   (each ≥1, non-empty).
4. Write `.guild/define/<slug>.json` with the shape above.
5. **Self-validate (fail closed)** — run the real validator on the file you wrote:
   ```
   npx tsx -e 'const root=process.env.GUILD_PLUGIN_ROOT||process.env.CLAUDE_PLUGIN_ROOT;const {validateDefineV1}=require(root+"/scripts/lib/define-schema.ts");const fs=require("fs");console.log(JSON.stringify(validateDefineV1(JSON.parse(fs.readFileSync(process.argv[1],"utf8"))),null,2))' .guild/define/<slug>.json
   ```
   If `valid` is not `true`, fix the reported field(s) (a duplicate AC id is a common cause)
   and re-validate. Do NOT hand off an artifact that fails validation.
6. The validated artifact + its stable AC ids feed the normal lifecycle (plan → build → qa →
   release); each stage resolves the AC ids (LW1-5 traceability checker).

## Evidence requirements
- The written artifact validates: `validateDefineV1(...).valid === true` (step 5 output).
- Every AC id is unique and stable; every required field is non-empty and grounded.

## Escalation rules
- The explore artifact is missing/invalid → return to `guild:product-explore` rather than
  defining on top of an unvalidated idea.

## Safety constraints
- Additive: write only under `.guild/define/`. Never edit code or other lifecycle state.
- Deterministic artifact body — no timestamps/ids beyond the stable AC ids. Self-validation
  is real code (the validator), never a prose "looks valid".

## Eval cases
See `evals.json` (should-trigger define/PRD prompts; should-not-trigger engineering prompts).
