# HA-2 — plugin-architect: host-adapter registry-parity + A/B guards + scan exclusion

Run: run-host-adapter-reconcile-20260621 · self-build · codex G-lane always-on · NEVER git commit (pre-commit
guard blocks lane commits; the lead commits). Work in /Users/miguelp/Projects/guild/plugin.

## Context
The host-adapter migration (R0–R13) renamed the host roster to 9 canonical ids (`claude-code-cli, codex-cli,
pi-cli, antigravity-cli, agents-file, claude-code-app, claude-code-web, codex-app, claude-ai-connector`),
replacing old `claude`/`codex`/`gemini`/`antigravity` keys, and changed entry-path files (hooks/**, possibly
package manifests). Source is landed; several verification tests were never reconciled and are RED. Make YOUR 4
suites green by reconciling to the intended rename + the intended entry-path changes — **verifying each delta is
intended, not a regression.** If a delta is NOT explained by the migration (a real regression), STOP and write
`.guild/runs/run-host-adapter-reconcile-20260621/questions/HA-2.md` — do not paper over it.

## Your suites (touch ONLY these + their helpers)
1. `tests/universal-host/p1-sc1-2-registry-parity.test.ts` — "failed to run" (TS) + parity assertions over the
   renamed `HOST_REGISTRY_ROWS`. Update old-key references (`HOST_REGISTRY_ROWS.claude/.codex`) to canonical ids
   per the current `scripts/lib/host-registry-schema.ts`; reconcile parity expectations to the 9-row registry.
2. `tests/universal-host/p1-sc9-no-regression.test.ts` — TS errors (`HOST_REGISTRY_ROWS.claude`) + an
   A/B-vs-HEAD entry-path guard. Update the renamed-key refs. For the A/B-vs-HEAD guard: it flags entry-path files
   (commands/hooks/package) that differ from HEAD outside its allowlist — the host-adapter migration legitimately
   changed hooks/** entry paths. Reconcile by updating the guard's ALLOWLIST (or its pinned baseline) to admit the
   intended host-adapter entry-path changes — NOT by deleting the guard. The guard must still FAIL on an
   unintended/out-of-allowlist change (keep it anti-vacuous). Document which entry-path files you allowlisted +why.
3. `tests/universal-host/p2-w1-sc9-no-regression.test.ts` — same A/B-vs-HEAD entry-path guard pattern; same
   treatment (allowlist the intended host-adapter entry-path deltas; keep it anti-vacuous).
4. `tests/dot-guild/no-v1-compat.test.ts` — the v1-marker scan is matching `agent_team` inside
   `.guild/runs/**/logs/payloads/*.json` (gitignored RUNTIME run-trace payloads that merely captured test-file
   text). That's a SCAN-SCOPE bug: the scan must EXCLUDE `.guild/runs/**` (and other gitignored runtime state) —
   it should scan tracked source, not run logs. Fix the scan's path exclusion so runtime payloads don't trip it;
   keep it anti-vacuous (a real `agent_team` v1 marker in tracked source must still fail).

## Discipline
- Do NOT touch: `.claude-plugin/**`, `commands/**`, live `skills/**` (held-v2.0.0 freeze), or HA-1's suites
  (routing-ab, adapter-ladder, role-resolution, tier-model).
- A/B guards: re-baseline/allowlist to the INTENDED migration surface, never weaken to vacuous. Prove still-fails
  on an out-of-allowlist change (add/keep a control if the test has one).
- Run ONLY your suites: `cd tests && npx jest --no-coverage --runInBand --watchman=false <your suites>`.

## Output
Write your §8.2 handoff receipt to `.guild/runs/run-host-adapter-reconcile-20260621/handoffs/plugin-architect-HA-2.md`
(5 fields + embedded guild.handoff.v2; evidence = per-suite green + per-guard allowlist justification + the
scan-exclusion fix + anti-vacuity confirmation). Then print `LANE HA-2 DONE`.
