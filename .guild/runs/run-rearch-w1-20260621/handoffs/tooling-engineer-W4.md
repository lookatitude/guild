---
type: handoff
run: run-rearch-w1-20260621
lane: W4
specialist: tooling-engineer
phase: build
created_at: 2026-06-21
status: complete
---

# LANE W4 — Capability-layer hardening (M3 prime directive)

Three deliverables, all BEHAVIOR-NEUTRAL (M9). Branch: arch/plugin-rearchitecture.

---

## D1 — Identity-literal sweep (registry bridge)

Replaced every `=== "claude"` / `=== "codex"` / `paneHostKind === "claude"` literal
with registry-bridge predicates from `scripts/lib/capability/rank.ts`.

The linter refined `isClaudeHost` → `isClaudeCli` / `isCodexCli` (EXACT matching
the historical literal semantics: `hostKindToRegistryId(hk) === "claude-code-cli"`)
alongside the family-wide `isClaudeHost` / `isCodexHost`. All call sites were updated.

### Literals found and repointed

| File | Line | Old literal | New predicate |
|---|---|---|---|
| `scripts/lib/host/tmux-backend.ts` | ~56,74 | `paneHostKind === "claude"` ×2 | `isClaudeCli(paneHostKind)` |
| `scripts/write-host-capability.ts` | ~162,241 | `hostKind === "claude"` ×2 | `isClaudeCli(hostKind)` |
| `scripts/guild-run.ts` | ~221 | `plan.host === "claude"` | `isClaudeCli(plan.host as HostKind)` |
| `scripts/lib/guild-run-wrapper.ts` | ~288,296,348,354 | `host === "claude"`, `host === "codex"` ×2, `request.host === "codex"`, `request.host === "claude"` | `isClaudeCli/isCodexCli` |
| `scripts/agent-team-launcher.ts` | ~485,687,1078 | `paneHosts.includes("claude")`, `host === "claude"`, inline switch | `isClaudeCli(h)`, `isClaudeCli(host)`, `hostKindToRegistryId(orchestratorHostKind)` |

### New exports in rank.ts

- `isClaudeHost(hk)` — family-wide (`startsWith("claude-")`)
- `isCodexHost(hk)` — family-wide (`startsWith("codex-")`)
- `isClaudeCli(hk)` — exact CLI (`=== "claude-code-cli"`)
- `isCodexCli(hk)` — exact CLI (`=== "codex-cli"`)

---

## D2 — tierDefaults() runtime-from-registry (kills ×3 duplication)

Created `scripts/lib/capability/tier-defaults.ts` as the SINGLE SOURCE for
the tier→model map. Repointed all 3 former duplication sites.

### Files created/modified

- `scripts/lib/capability/tier-defaults.ts` — NEW (D2 single-source)
- `scripts/lib/capability/rank.ts` — `getDefaultModelTierMap()` delegates to `tierDefaultsForHost(host)`
- `scripts/write-host-capability.ts` — `DEFAULT_TIER_MODELS = defaultTierModels()`
- `scripts/score-tier.ts` — `DEFAULT_TIERS = defaultTiersMap()`

### Parity test: rearch-tier-defaults-parity.test.ts

```
npx jest --runInBand --watchman=false __tests__/rearch-tier-defaults-parity.test.ts
Tests: 28 passed, 28 total
```

All 9 hosts × 3 tiers verified. Anti-vacuity control: injected haiku-SYNTHETIC
row → detected (cheap=haiku-SYNTHETIC not "haiku"). Green with non-vacuous control.

---

## D3 — R-HOST add-a-host conformance rail

`tests/rearch/r-host.ts` — STRICT rail, already wired in `run-all.ts`.

Synthetic host: HostKind `"pi"` → registry id `"pi-cli"`. Injected descriptors
override the pi-cli row with `cheap=nano / mid=midi / powerful=maxi`.

Three checks:
1. IDENTITY: `isClaudeHost("pi")=false`, `isCodexHost("pi")=false`
2. TIER RESOLUTION: `tierDefaultsForHost("pi", injected) = {cheap:"nano", mid:"midi", powerful:"maxi"}`
3. M3 HARD GATE: `git diff --name-only HEAD -- scripts/lib/core/` is empty

Anti-vacuity (--prove): without injection, pi falls back to haiku (injection
load-bearing). Existing claude/codex unbroken.

---

## Test runs (all in-band, no watchman)

### D1+D2 affected suites

```
npx jest --runInBand --watchman=false \
  __tests__/rearch-parity-host-router.test.ts \
  __tests__/host-registry-ab.test.ts \
  __tests__/write-host-capability.test.ts \
  __tests__/score-tier.test.ts \
  __tests__/team-backend.test.ts

Test Suites: 5 passed, 5 total
Tests:       164 passed, 164 total
```

### D2 parity

```
npx jest --runInBand --watchman=false __tests__/rearch-tier-defaults-parity.test.ts
Tests: 28 passed, 28 total
```

### Rearch rails

```
npx tsx tests/rearch/run-all.ts
R-DUP    GREEN  (0 finding(s))
R-DEP    GREEN  (0 finding(s))
R-VAC    GREEN  (66 finding(s))  [advisory — pre-existing]
R-DIST   GREEN  (0 finding(s))
R-HOST   GREEN  (0 finding(s))
R-SEC    GREEN  (0 finding(s))
R-PERF   GREEN  (0 finding(s))
R-TRACE  GREEN  (0 finding(s))
strict exit code: 0
```

---

## Zero live-surface delta

- No `.claude-plugin/`, `commands/`, `skills/`, `agents/`, or `hooks.json` changes.
- `scripts/lib/core/**` untouched (M3 gate satisfied).
- Hooks dist bundles `host-registry-schema` only (unchanged in W4) — no rebuild needed.
  R-DIST GREEN confirmed 15 bundle(s) byte-identical.

---

## changed_files

- `scripts/lib/capability/rank.ts` — added `isClaudeCli`, `isCodexCli`; `getDefaultModelTierMap()` → delegate
- `scripts/lib/capability/tier-defaults.ts` — NEW: `CLAUDE_TIER_FALLBACK`, `tierDefaults()`, `tierDefaultsForHost()`, `defaultTierModels()`, `defaultTiersMap()`
- `scripts/lib/host/tmux-backend.ts` — `isClaudeCli(paneHostKind)` ×2
- `scripts/write-host-capability.ts` — `isClaudeCli(hostKind)` ×2; `defaultTierModels()`
- `scripts/guild-run.ts` — `isClaudeCli(plan.host)`
- `scripts/lib/guild-run-wrapper.ts` — `isClaudeCli/isCodexCli` ×4
- `scripts/agent-team-launcher.ts` — `isClaudeCli` ×2; `hostKindToRegistryId()`
- `scripts/score-tier.ts` — `defaultTiersMap()`
- `scripts/__tests__/rearch-tier-defaults-parity.test.ts` — NEW (D2 parity + anti-vacuity)
- `tests/rearch/r-host.ts` — NEW (D3 R-HOST STRICT rail)
- `tests/rearch/run-all.ts` — wired R-HOST

## opens_for

None — all three deliverables complete, rails GREEN, tests GREEN.

## assumptions

- `gemini` HostKind maps to `null` in `HOSTKIND_TO_REGISTRY_ID` (D10 dropped);
  `tierDefaultsForHost("gemini")` falls back to `CLAUDE_TIER_FALLBACK` — same as prior behavior.
- `isClaudeCli` (exact) vs `isClaudeHost` (family): linter correctly updated call sites
  that gated on CLI-native capabilities to use the exact predicate.

## evidence

```
Tests: 164 passed (D1+D2 suites)
Tests: 28 passed (D2 parity)
Rails: strict exit code 0 (R-DUP R-DEP R-DIST R-HOST R-SEC R-PERF R-TRACE all GREEN)
```

## followups

None required for this wave.

```guild.handoff.v2
{
  "schema_version": "guild.handoff.v2",
  "task_id": "W4",
  "tier": "mid",
  "status": "done",
  "summary": "W4 Capability-layer hardening (M3 prime directive): three deliverables, all behavior-neutral (M9), on branch arch/plugin-rearchitecture. Not committed (lead commits).",
  "artifacts": [
    ".guild/runs/run-rearch-w1-20260621/handoffs/tooling-engineer-W4.md"
  ],
  "issues": []
}
```
