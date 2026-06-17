---
name: guild-product-explore
description: Product-loop EXPLORE producer — turns a vague product idea into a typed, fail-closed `guild.explore.v1` artifact before any engineering scoping. Emits the five required fields (assumptions, evidence_needs, comparables, risks, recommended_next_step) and self-validates with validateExploreV1. TRIGGER when the no-slash `using-guild` intake router classifies a prompt as `intake=product_loop` ("I have an idea for X", "what if we built…", "I want to make a tool that…", "I wish there was an app that…"), or when a user explicitly asks to explore / pressure-test / scope a product idea before building. It produces the EXPLORE artifact only; it does not write a PRD (that is guild:product-define) and does not plan or build. DO NOT TRIGGER for engineering/maintenance prompts (bug fix, "plan this feature", review a PR, refactor, deploy) — those route to the normal lifecycle, never the product loop; nor for team composition, code edits, or micro-tasks.
when_to_use: Immediately after the no-slash product-loop router (using-guild) resolves `intake=product_loop`, as the FIRST product-loop step; or on an explicit "let's explore/scope this idea" request. Hands off to guild:product-define once the explore artifact validates.
type: meta
---

# guild:product-explore

The **first step of the product loop**. A vague product idea arrives (via the no-slash
intake router in `using-guild`, or an explicit ask). Your job is to scope it into a single
**typed, fail-closed `guild.explore.v1` artifact** — what the idea assumes, what must be
learned, what already exists, what could sink it, and the one concrete next step — so the
downstream PRD (`guild:product-define`) and the rest of the lifecycle work from a real
contract instead of a hunch.

You produce the **explore artifact only**. You do NOT write the PRD (that is
`guild:product-define`), and you do NOT plan or build.

## When to use it
- The `using-guild` router classified the prompt as `intake = product_loop` (no `/guild` typed).
- A user explicitly asks to explore, pressure-test, or scope a product idea before committing.

## When NOT to use it
- Any engineering/maintenance prompt (bug fix, plan-this-feature, PR review, refactor,
  deploy) — those are `intake = other`; stay in the normal lifecycle.
- Writing the PRD / acceptance criteria → `guild:product-define`.
- Planning lanes, composing a team, or editing code.

## Required inputs
- The user's product idea (verbatim prompt + any clarifying answers).
- The canonical shape: `guild.explore.v1` (`${CLAUDE_PLUGIN_ROOT}/scripts/lib/explore-schema.ts`),
  whose `EXPLORE_V1_EXAMPLE` is the golden shape to mirror.

## Output contract — `guild.explore.v1`
Write a JSON artifact to **`.guild/explore/<slug>.json`** (slug = a short kebab-case name for
the idea). It MUST satisfy `validateExploreV1` — every required field present and **non-empty**
(the validator fails closed on any missing/empty field or unknown key):

```json
{
  "schema_version": "guild.explore.v1",
  "assumptions": ["what the idea takes for granted (≥1, non-empty)"],
  "evidence_needs": ["what must be learned/validated before committing (≥1)"],
  "comparables": ["existing products / analogs to study (≥1)"],
  "risks": ["what could sink the idea (≥1)"],
  "recommended_next_step": "the single concrete next action (non-empty)"
}
```
Mirror `EXPLORE_V1_EXAMPLE` for the exact shape. Emit ONLY the allowed keys (strict).

## Workflow steps
1. If the idea is too thin to fill any required field, ask 1–3 tight clarifying questions
   first (do not invent assumptions to pad a field).
2. Draft each field from the idea: real `assumptions`, the `evidence_needs` that would
   confirm/kill it, `comparables` (existing analogs), the `risks`, and ONE
   `recommended_next_step`.
3. Choose a slug and write `.guild/explore/<slug>.json` with the shape above.
4. **Self-validate (fail closed)** — run the real validator on the file you wrote:
   ```
   npx tsx -e 'const {validateExploreV1}=require(process.env.CLAUDE_PLUGIN_ROOT+"/scripts/lib/explore-schema.ts");const fs=require("fs");console.log(JSON.stringify(validateExploreV1(JSON.parse(fs.readFileSync(process.argv[1],"utf8"))),null,2))' .guild/explore/<slug>.json
   ```
   If `valid` is not `true`, fix the reported field(s) and re-validate. Do NOT hand off an
   artifact that fails validation.
5. Hand off to `guild:product-define` with the validated artifact path.

## Evidence requirements
- The written artifact validates: `validateExploreV1(...).valid === true` (step 4 output).
- Every required field is non-empty and grounded in the idea, not filler.

## Escalation rules
- Idea too vague to fill the required fields even after clarifying questions → surface that to
  the user (state which fields cannot be grounded) rather than fabricating content.

## Safety constraints
- Additive: write only under `.guild/explore/`. Never edit code or other lifecycle state.
- Deterministic artifact body — no timestamps/ids invented inside the artifact; the schema
  carries none. Self-validation is real code (the validator), never a prose "looks valid".

## Eval cases
See `evals.json` (should-trigger product-idea prompts; should-not-trigger engineering prompts).
