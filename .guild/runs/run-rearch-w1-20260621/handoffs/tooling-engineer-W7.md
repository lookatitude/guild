# tooling-engineer Wave 7 — 12-target learning-signatures classifier

## Deliverable summary

Wave 7 implements the 12-target signature classifier (metrics 1-3 centerpiece) as a
pure deterministic module, wires it as the GUILD_CHECKPOINT_VERDICT producer in the
emit hook, and repoints the dangling contract reference.

```guild.handoff.v2
{
  "schema_version": "guild.handoff.v2",
  "task_id": "learning-harness-no-loss-classifier",
  "tier": "mid",
  "status": "done",
  "summary": "Implemented <HIGH_ENTROPY_REDACTED>-signatures.ts: 12 individually-exported pure predicate functions + classifyPhase(). Wired into hooks/emit-learning-checkpoint.ts via GUILD_CHECKPOINT_ARTIFACTS_JSON env var (the GUILD_CHECKPOINT_VERDICT producer path). Repointed dangling contract ref in <HIGH_ENTROPY_REDACTED>-checkpoint/SKILL.md from active/ to archived/. Rebuilt dist/. All strict rearch rails GREEN (strict exit code 0). 42 hooks test suites PASS (734 tests).",
  "artifacts": [
    "<HIGH_ENTROPY_REDACTED>-signatures.ts",
    "hooks/emit-learning-checkpoint.ts",
    "<HIGH_ENTROPY_REDACTED>-checkpoint/SKILL.md"
  ],
  "issues": [],
  "learnings": [
    "R-DIST requires cd hooks && npm run build BEFORE running run-all.ts; the rail does a fresh esbuild comparison against committed dist — stale dist => RED.",
    "The emit hook's main() has a natural extension point for GUILD_CHECKPOINT_ARTIFACTS_JSON as a fallback after the verdictPath block — behavior-neutral when env var absent."
  ],
  "notes": "The eval-engineer lane builds the 12x3 fixtures + mutation tests against the phase-signatures classifier. Export API: 12 named predicates + classifyPhase(). NEVER committed (lead commits)."
}
```

---

## Predicate inventory (12 targets)

| Target | Predicate | Artifact inputs | Verdict form |
|---|---|---|---|
| memory | `classifyMemory` | provenance.touched.decisions[], handoff learnings (durable-fact keywords) | `candidate:<ref>` |
| wiki | `classifyWiki` | provenance.touched.wiki[], handoff followups (wiki-ingest/decisions refs) | `candidate:<ref>` |
| knowledge_graph | `<HIGH_ENTROPY_REDACTED>` | provenance.touched.initiatives[], changedFiles matching .guild/wiki/ .guild/raw/ .guild/initiatives/ .guild/reflections/ | `re-derive` |
| domain_model | `classifyDomainModel` | changedFiles matching src/ app/ lib/ services/ *.ts/*.js (non-test) | `refresh:stale` |
| agent_def | `classifyAgentDef` | handoff learnings/followups referencing an agent name pattern | `proposal:<agent>` |
| skill_def | `classifySkillDef` | handoff learnings/followups referencing a skill name pattern | `proposal:<skill>` |
| agent_template | `<HIGH_ENTROPY_REDACTED>` | <HIGH_ENTROPY_REDACTED> with target=agent → classifyProposal() → "systemic" | `systemic-proposal` |
| skill_template | `<HIGH_ENTROPY_REDACTED>` | <HIGH_ENTROPY_REDACTED> with target=skill → classifyProposal() → "systemic" | `systemic-proposal` |
| config | `classifyConfig` | provenance.touched.config_keys[], changedFiles matching settings.json/.claude-plugin/ | `proposal:<key>` |
| task_tracking | `<HIGH_ENTROPY_REDACTED>` | provenance.touched.tasks[] + handoff status=done/shipped | `update:<work-item>` |
| workflow_rules | `<HIGH_ENTROPY_REDACTED>` | handoff learnings/followups matching agents.md/workflow rule patterns, changedFiles AGENTS.md | `proposal:<rule>` |
| review_policy | `<HIGH_ENTROPY_REDACTED>` | handoff issues/notes matching <HIGH_ENTROPY_REDACTED>-override patterns | `proposal:<gate>` |

## Wiring point

`hooks/emit-learning-checkpoint.ts` main() — after the `verdictPath` block (~line 491).
New env var: `GUILD_CHECKPOINT_ARTIFACTS_JSON` → path to a serialized ArtifactSet JSON.
When verdictPath is absent but GUILD_CHECKPOINT_ARTIFACTS_JSON is present:
- reads the ArtifactSet from the file
- calls `classifyPhase(artifacts)` in-process
- uses the result as the `decisions` map
- logs non-none targets to stderr
Behavior-neutral: both env vars absent → decisions stays undefined → ALL_NONE_DECISIONS.

## Contract repoint

`<HIGH_ENTROPY_REDACTED>-checkpoint/SKILL.md` line 13:
- Before: `.<HIGH_ENTROPY_REDACTED>-<HIGH_ENTROPY_REDACTED>-checkpoint.v1.md`
- After: `.<HIGH_ENTROPY_REDACTED>-<HIGH_ENTROPY_REDACTED>-checkpoint.v1.md`

Also updated the same dangling pointer in `hooks/emit-learning-checkpoint.ts` header comment.

## Dist rebuild required

After modifying `hooks/emit-learning-checkpoint.ts` (which is bundled by esbuild),
ran `cd hooks && npm run build` — rebuilt 15 bundles. R-DIST confirmed GREEN after rebuild.

## Evidence

```
npx tsx tests/rearch/run-all.ts
──────── RAIL SUMMARY ────────
  R-DUP    GREEN  (0 finding(s))
  R-DEP    GREEN  (0 finding(s))
  R-VAC    GREEN  (66 finding(s))
  R-DIST   GREEN  (0 finding(s))
  R-HOST   GREEN  (0 finding(s))
  R-SEC    GREEN  (0 finding(s))
  R-PERF   GREEN  (0 finding(s))
  R-TRACE  GREEN  (0 finding(s))
  R-DECL   GREEN  (0 finding(s))
strict exit code: 0 (no strict rail red)

cd hooks && npx jest --no-coverage --watchman=false
Test Suites: 42 passed, 42 total
Tests:       734 passed, 734 total
```

Smoke test (6 cases):
- All-none case (no signals): PASS
- Memory signal (provenance.touched.decisions): PASS candidate:decision:my-arch-choice
- Wiki signal (provenance.touched.wiki): PASS candidate:wiki-page-about-hooks
- KG signal (provenance.touched.initiatives): PASS re-derive
- Agent template systemic (3 instances, same_signature, user_approved): PASS systemic-proposal
- Skill template NOT systemic (1 instance): PASS none
- 12 keys always present: PASS
