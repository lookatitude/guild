# HA-1 — eval-engineer: host-adapter golden + rename reconciliation

Run: run-host-adapter-reconcile-20260621 · self-build · codex G-lane always-on · NEVER git commit (pre-commit
guard blocks lane commits; the lead commits). Work in /Users/miguelp/Projects/guild/plugin.

## Context
A large host-adapter migration (the `host-adapter-migration` initiative, R0–R13) renamed the host roster to 9
canonical ids — `claude-code-cli, codex-cli, pi-cli, antigravity-cli, agents-file, claude-code-app,
claude-code-web, codex-app, claude-ai-connector` — replacing the old `claude`/`codex`/`gemini`/`antigravity`
keys. The source changes are landed in the working tree but several **frozen-golden + key-rename tests** were
never reconciled and are RED. Your job: make YOUR 4 suites green by reconciling them to the intended rename —
**verifying each golden delta is the intended host-id rename, NOT a behavior regression.** If a delta is NOT
explained by the rename (a real logic change/regression), STOP and write
`.guild/runs/run-host-adapter-reconcile-20260621/questions/HA-1.md` describing it — do not regenerate over it.

## Your suites (touch ONLY these test files + their fixtures + any SOURCE needed for tier-model)
1. `tests/universal-host/p1-sc4-routing-ab-golden.test.ts` (+ `tests/universal-host/fixtures/*routing*golden*.json`)
   — route() A/B golden drift from the host-id rename. Verify the route() output delta is purely the id rename,
   then regenerate the golden fixture from the real route() output.
2. `tests/universal-host/p1-sc8-adapter-ladder.test.ts` — references old ladder keys
   (`FALLBACK_LADDER_TABLE.browser.claude/codex/antigravity`, `isInferredRung(...,"claude")`). Update the test's
   expected keys to the canonical ids per the CURRENT `scripts/lib/` ladder source (read the source for the real
   key names + values; don't guess).
3. `tests/universal-host/p1-sc5-role-resolution.test.ts` — role-resolution against renamed host ids; update
   expectations to canonical ids per the current role-resolver source.
4. `tests/integration/tier-model-resolution.test.ts` — "cheap tier resolves to claude=haiku" → got undefined,
   because the tier map key is now `claude-code-cli`. DECIDE: is this a TEST-expectation update (assert the new
   key) OR a SOURCE alias gap (the resolver should accept the `claude` legacy alias)? Read the resolver
   (`read-guild-config.ts` resolveTierModel + normalizeHostId). If legacy aliases are SUPPOSED to resolve
   (normalizeHostId exists for that), the SOURCE should map `claude`→`claude-code-cli` and the test stays; if
   not, update the test to the canonical key. Fix the correct side; explain your call in the handoff.

## Discipline
- Anti-vacuity: a regenerated golden must be the intended-rename output, verified by reading the diff (old vs new)
  and confirming every changed line is an id rename or its direct consequence. Note the verification in evidence.
- Do NOT touch: `.claude-plugin/**`, `commands/**`, live `skills/**` (held-v2.0.0 byte-identical freeze), hooks/**,
  or the other team's suites (registry-parity, p1-sc9, p2-w1-sc9, no-v1-compat — those are HA-2's).
- Run ONLY your suites: `cd tests && npx jest --no-coverage --runInBand --watchman=false <your suites>`.
- When green, ping the lead-style codex review is run by the LEAD, not you.

## Output
Write your §8.2 handoff receipt to `.guild/runs/run-host-adapter-reconcile-20260621/handoffs/eval-engineer-HA-1.md`
(5 fields + embedded guild.handoff.v2; in evidence record per-suite green + the per-golden rename-verification +
your tier-model fix-side decision). Then print `LANE HA-1 DONE`.
