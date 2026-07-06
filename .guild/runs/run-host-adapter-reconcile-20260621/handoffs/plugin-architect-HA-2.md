---
type: handoff_receipt
artifact_category: 7
task_id: HA-2
owner: plugin-architect
---

# HA-2 — host-adapter registry-parity + A/B guards + scan exclusion

```guild.handoff.v2
{
  "schema_version": "guild.handoff.v2",
  "task_id": "HA-2",
  "tier": "powerful",
  "status": "done",
  "summary": "Reconciled all 4 assigned suites to the landed host-adapter migration (9 canonical host ids); every delta verified as intended rename/migration, none a regression. Suites: p1-sc1-2 registry-parity (canonical ids + rename assertions + honesty invariant), p1-sc9 no-regression (renamed-key refs + 3 unmasked behavioral expectations), p2-w1-sc9 entry-path guard (re-baselined ENTRY_ALLOWLIST to the 10 verified hooks/** deltas + tightness control), dot-guild/no-v1-compat (walk skips nested .guild runtime subtrees). 4 passed, 53 tests. Not committed (lead commits).",
  "artifacts": [
    "tests/universal-host/p1-sc1-2-registry-parity.test.ts",
    "tests/universal-host/p1-sc9-no-regression.test.ts",
    "tests/universal-host/p2-w1-sc9-no-regression.test.ts",
    "tests/dot-guild/no-v1-compat.test.ts",
    ".guild/runs/run-host-adapter-reconcile-<HIGH_ENTROPY_REDACTED>-architect-HA-2.md"
  ],
  "issues": [
    "NONE blocking. No unexplained delta found ⇒ no questions/HA-2.md. The only flagged entry-path deltas NOT strictly the host-id rename are intended sibling release work, verified additive (no behavior deletion/corruption): hooks/lib/run-state.ts R5 host-native model params (LaneModelParams); and the using-guild golden + bootstrap test which regenerate the golden from current source (product-loop intake section) — the test re-asserts golden===source so the delta is pinned, not silent. Both corroborated by the live SessionStart output this session.",
    "SCOPE NOTE: other modified tests/ files (p1-sc5-role-resolution, p1-sc8-adapter-ladder, sc4-routing-ab-golden, tier-model-resolution, config-init-baseline, sc5-wrapper-path-parity) are HA-1's suites / pre-existing working-tree state — NOT touched by me (git status --porcelain confirms only my 4 files modified).",
    "NEVER committed (pre-commit guard blocks lane commits) — lead commits."
  ],
  "learnings": [
    "The bundle framed all entry-path deltas as 'host-adapter migration', but a release working tree mixes initiatives (host rename R0-R13 + R5 model params + product-loop intake). The A/B-vs-HEAD guard is initiative-blind — it flags every working-tree hooks/** change. Correct reconcile = admit each VERIFIED-intended file via an EXPLICIT named allowlist, never a wildcard; the diff empties on the lead's commit so entries become harmless no-ops.",
    "Fixing a TS-compile failure can UNMASK behavioral assertions (p1-sc9 had 3 dormant fails behind the HOST_REGISTRY_ROWS.claude type error). Always re-run after a compile fix and treat newly-surfaced fails as in-scope.",
    "A renamed enum can falsify a previously-true invariant: 'every inferred host ships installability:target' broke once app/web/connector surfaces (inferred + installability:none) joined. Reconcile to the weaker-but-still-true contract ('no inferred host claims native') rather than deleting the check."
  ],
  "notes": "Anti-vacuity proven: allowlist == 9 tracked + 1 untracked exactly; planted v1-marker probe FAILED then removed; fail-closed + gemini rejections still pass. Touched only the 4 assigned test files."
}
```

## Verification (final)
- `cd tests && npx jest --no-coverage --runInBand --watchman=false universal-host/p1-sc1-2-registry-parity.test.ts universal-host/p1-sc9-no-regression.test.ts universal-host/p2-w1-sc9-no-regression.test.ts dot-guild/no-v1-compat.test.ts` → **4 passed, 53 tests passed**.
- Migration intent verified by git: HEAD carries the 5-id schema; the working tree carries the 9-id canonical schema (claude→claude-code-cli, codex→codex-cli, .agents→agents-file, pi→pi-cli, antigravity→antigravity-cli + claude-code-app/claude-code-web/codex-app/claude-ai-connector). Corroborated by `scripts/lib/host-id-namespace.ts` (legacy→canonical map) and the expanded host-router matrix.
- Per-guard allowlist justification + scan-exclusion rationale documented inline in each test file's comments.

### Per-suite green
| Suite | Result | Reconcile |
|---|---|---|
| p1-sc1-2-registry-parity | PASS | 9-id namespace + rename assertions; 9-row column oracle; provenance split; honesty invariant; fail-closed fixtures retargeted |
| p1-sc9-no-regression | PASS | renamed-key refs; 9 ids; 3 unmasked behavioral expectations (<HIGH_ENTROPY_REDACTED> default) — all verified intended renames |
| p2-w1-sc9-no-regression | PASS | ENTRY_ALLOWLIST re-baselined to 10 verified host-adapter hooks/** deltas + tightness control; comparator anti-vacuity kept |
| dot-guild/no-v1-compat | PASS | walk() skips nested .guild/ runtime subtrees; tracked source still scanned (anti-vacuity proven by planted-marker FAIL) |
