# Handoff Receipt — eval-engineer · lane HA-1

Run: run-host-adapter-reconcile-20260621 · lane HA-1 (host-adapter golden + rename reconciliation)
Status: **DONE — all 4 assigned suites GREEN**

## 1. Summary

Reconciled my 4 assigned suites to the landed host-adapter-migration source (canonical
9-host-id roster + the `modelParams` routing upgrade). Every golden/expectation delta was
read diff-by-diff and confirmed to be an intended migration consequence — NOT a behavior
regression. No live surface (`.claude-plugin/**`, `commands/**`, live `skills/**`), no
hooks, and no other-lane (HA-2) suite was touched. No source files changed — only test
expectations + the one regenerated golden fixture. NEVER committed (lead commits).

Final: `cd tests && npx jest --no-coverage --runInBand --watchman=false
universal-host/p1-sc8-adapter-ladder universal-host/p1-sc5-role-resolution
universal-host/p1-sc4-routing-ab-golden integration/tier-model-resolution`
→ **4 suites passed, 67 tests passed, 0 failed.**

## 2. Changed files (mine only)

- `tests/universal-host/fixtures/sc4-routing-ab-golden.json` — regenerated golden.
- `tests/universal-host/p1-sc8-adapter-ladder.test.ts` — canonical-id keys/values.
- `tests/universal-host/p1-sc5-role-resolution.test.ts` — canonical substrate ids + advisory enum.
- `<HIGH_ENTROPY_REDACTED>-model-resolution.test.ts` — canonical tier-map keys; gemini→pi-cli.

(Other `M` files in the working tree — `sc5-wrapper-path-parity.test.ts`, the HA-2 suites
`no-v1-compat` / `p1-sc1-2-registry-parity` / `p1-sc9` / `p2-w1-sc9`, and `hooks/**` — are
pre-existing / other-lane changes; I did not edit them.)

## 3. Verification / evidence (per-suite GREEN + per-golden rename-verification)

### Suite 1 — `p1-sc4-routing-ab-golden.test.ts` (regenerated golden) ✅
- **Delta is NOT a host-id rename** — it is the additive `modelParams:{model:<m>}` field on
  the decision core AND on each fallback-chain target. `route()`'s `host`/`hostKind` stay
  the short HostKind names `claude`/`codex` (intentionally — they are NOT the registry 9-ids).
- **Anti-vacuity proof:** generated the new golden from the REAL `route()` over the shared
  `routingAbCases()` matrix (same path the test asserts), then `diff`ed old-vs-new. The
  ONLY changed lines are inserted `modelParams` blocks whose `.model` byte-mirrors the
  pre-existing `model` field in the same object. Zero value drift, zero id change, zero
  logic change across all 4 cases (+ 1 fallback entry).
- **Intent corroborated (intended upgrade, not regression):** `route()` source emits it
  (`host-router.ts:197,572,609,637`); sibling tests already assert it
  (`scripts/__tests__/host-router.test.ts:665,688-690`); sibling golden already carries it
  (`scripts/__tests__/fixtures/routing-expanded-golden.json`); landed in commit f6f6152
  ("routing upgrades"); R13 verification evidence documents "modelParams route output".
- `sc4-select-reviewer-golden.json` needed NO change (it has no modelParams; it was green).

### Suite 2 — `p1-sc8-adapter-ladder.test.ts` (canonical-id keys/values) ✅
- Updated the verbatim 4×N rung-table oracle, the `INFERRED_HOSTS` set, the notable-
  non-defaults, and all `resolveRung`/`isInferredRung` literals to the canonical ids per
  the CURRENT `scripts/lib/adapter-fallback-ladders.ts` (read from source, not guessed).
- **Rename-verification:** for the original 5 hosts the rung VALUES are byte-identical to
  the pre-rename pin — pure key rename (`claude→claude-code-cli`, `codex→codex-cli`,
  `.agents→agents-file`, `pi→pi-cli`, `antigravity→antigravity-cli`). The 4 added
  app/connector rows (`claude-code-app`, `claude-code-web`, `codex-app`,
  `claude-ai-connector`) are all `degraded` on every surface — the intended canonical-
  roster expansion, matching source exactly via whole-table `toEqual` + cell-by-cell.
- `INFERRED_HOSTS` now {agents-file, pi-cli, antigravity-cli + 4 app/connector} (7), with
  `claude-code-cli`/`codex-cli` the only concrete rows — matches source. The unknown-host
  RED discriminator (`gemini`/`totally-made-up` → degraded) is preserved unchanged.

### Suite 3 — `p1-sc5-role-resolution.test.ts` (canonical substrate ids) ✅
- `resolveRoles()` now returns `host_id` as substrate, so expectations move to canonical
  ids: host/advisory `claude-code-cli`, adversarial `codex-cli`. Registry-row lookups use
  `HOST_REGISTRY_ROWS["claude-code-cli"|"codex-cli"]`. Synthetic same-family reviewers
  retargeted from bare `claude` to the valid claude-family canonical id `claude-code-app`
  (keeps the same-family-independence-lost semantics; substrate stays in the closed HostId
  set). The gemini fail-fixture (unknown substrate rejected) is preserved.
- Advisory substrate enum updated to the exact landed value: the 9 canonical ids + 5
  retained legacy aliases (`claude/codex/.<HIGH_ENTROPY_REDACTED>`), default
  `claude-code-cli`. The legacy aliases are an INTENDED back-compat affordance (source
  comment: "Legacy substrate labels accepted for older records") — not a regression; the
  test asserts the exact array (anti-vacuity). Supplied-substrate case moved `codex`→
  `codex-cli` (canonical form); every-enum-value-validates loop unchanged (covers all 14).

### Suite 4 — `tier-model-resolution.test.ts` (tier-map keys) ✅ — fix-side DECISION below.

## 4. Decisions

**Tier-model fix-side decision (suite 4): TEST-expectation update, NOT a source alias gap.**
The failing assertions read the RESOLVED config OUTPUT object directly
(`j.models.tiers.cheap.claude`). The resolved output is keyed by the canonical 9 host ids
by design (verified live: `read-guild-config --cwd` and `--scaffold` both emit exactly the
9 canonical keys, `claude-code-cli` carrying the model, the other 8 null). I read
`read-guild-config.ts` (`resolveTierModel` + the closed `VALID_TIER_HOST_KEYS` set +
duplicate-key rejection) and `host-id-namespace.ts` (`normalizeHostId`):
- `normalizeHostId` exists to normalize INPUT / lookup keys at the seam —
  `resolveTierModel(tiers, tier, host)` normalizes the *lookup host arg*, so a consumer CAN
  still look up by legacy `"claude"`. It is deliberately NOT used to inject legacy alias
  keys into the resolved output map; doing so would reintroduce the removed keys and
  violate the closed canonical key-set + the duplicate-normalization reject.
- `gemini` is intentionally DROPPED (D10): `normalizeHostId("gemini") === null`, no
  registry row. There is no canonical target to alias it to, and a `gemini` INPUT key now
  correctly fails `--validate`. So the former gemini null-slot assertions were retargeted
  to a real canonical non-primary host, `pi-cli`.
Therefore the SOURCE is correct as-is; I updated the TEST to canonical keys (and switched
settings.json INPUT fixtures to canonical keys so `--validate` stays green). This aligns
with the R13-era migration of the sibling lane-C `read-guild-config.test.ts`.

## 5. Followups

none — all 4 assigned suites green; no source change required; no unexplained delta (no
`questions/HA-1.md` written). Lead to commit; codex G-lane review is the lead's, not mine.

---

```guild.handoff.v2
{
  "schema_version": "guild.handoff.v2",
  "task_id": "HA-1",
  "tier": "mid",
  "status": "done",
  "summary": "Reconciled 4 assigned suites to the landed canonical-9-host-id roster + modelParams routing upgrade; every golden/expectation delta verified as intended migration, not regression. No source, live-surface, or other-lane changes. 4 suites passed, 67 tests.",
  "artifacts": [
    "tests/universal-host/fixtures/sc4-routing-ab-golden.json",
    "tests/universal-host/p1-sc8-adapter-ladder.test.ts",
    "tests/universal-host/p1-sc5-role-resolution.test.ts",
    "tests/integration/tier-model-resolution.test.ts"
  ],
  "issues": [],
  "notes": "sc4 golden regenerated from real route() — additive modelParams only, no id/value/logic drift. sc8 rung values byte-identical for renamed hosts. TEST-expectation update; source canonical-keyed."
}
```
