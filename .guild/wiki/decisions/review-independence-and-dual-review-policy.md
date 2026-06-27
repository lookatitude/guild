---
type: decision
owner: architect
confidence: high
importance: high
source_refs:
  - .guild/wiki/_archive/v2-design/sources/20-review-independence-and-dual-review-policy.md      # independence gradient, risk-based policy, dual-review for critical, escalation
  - plugin/.guild/wiki/entities/cross-host-review-and-loop-control.md       # D-16 policy gate, FROZEN review_packet/result, AC-8 same-family guard, gate-pass rule
  - plugin/.guild/wiki/decisions/v2-review-broker-and-artifact-bus.md                 # D-BR-A reviewer selection (STRONG/WEAK stamp), D-BR-E cloud consent
  - plugin/.guild/wiki/decisions/v2-cross-host-orchestration.md                       # CR-4 review→cross-host affinity; CR-2/CH-4 security delegation
  - plugin/.guild/wiki/decisions/cost-aware-tiering-and-lean-context.md               # tier ladder; advisor escalation vs adversarial review
  - plugin/.guild/wiki/decisions/autonomy-locking-validity.md                         # immutable always-ask hard set (destructive / network / spend)
created_at: 2026-06-14
updated_at: 2026-06-14
expires_at: null
supersedes: null
sensitivity: internal
applies_to: [plugin]
related:
  - v2-review-broker-and-artifact-bus
  - v2-cross-host-orchestration
  - cost-aware-tiering-and-lean-context
  - autonomy-locking-validity
  - adversarial-review
---

# ADR: Review independence levels & the dual-review policy for high-risk work

## Status

**Accepted — design decision (architect ADR backlog item 38).**

Implementation status is **mixed and tagged inline** against current repo
reality (verified 2026-06-14 against `plugin/scripts/lib/host-router.ts`,
`plugin/scripts/lib/provider-detect.ts`, and
`plugin/skills/meta/review-broker/SKILL.md`):

- **[v2] shipped** — the single-reviewer independence model (STRONG vs WEAK,
  stamped), the policy gate (`risk≥high OR review=cross OR config`), the AC-8
  same-family guard, and human force-pass at the round cap. These are **already
  decided** in the related ADRs and the FROZEN cross-host contract; this ADR
  **references, does not re-decide them** (see "Already settled").
- **[v2.x] deferred** — the **dual-review requirement for `critical`-class
  work** (two independent reviewers, one of which is human, `force_pass`
  disallowed), the **named high-risk work classes** that select it, and the
  **disagreement-escalation rule**. These are the genuinely uncovered decisions
  this ADR makes (see "Decision").

## Context

Guild ships cross-family adversarial review: a host drafts an artifact and a
**different provider family** critiques it. The research brief
([`20-review-independence-and-dual-review-policy.md`](../../../../.guild/wiki/_archive/v2-design/sources/20-review-independence-and-dual-review-policy.md))
establishes four things that must hold for that review to be trustworthy and
records one consequence the shipped policy does not yet implement:

1. **Independence is a gradient, not a boolean** (brief Finding 1). A
   cross-provider reviewer is stronger than a same-provider one, but even
   cross-provider review shares blind spots if both reviewers consumed the same
   poisoned context.
2. **High-risk gates justify stronger review than normal tasks** (brief
   Finding 4): security-policy changes, sandbox changes, release automation,
   secret handling, persistent skill evolution, and destructive git operations.
3. **Human escalation is the final authority** (brief Finding 5) when reviewers
   disagree, when findings cycle without convergence, or when independence
   cannot be achieved at all.
4. The brief's `review_policy` table adds a **`critical` tier** above `high`
   with `reviewers: [cross_provider, human]` and `force_pass_allowed: false` —
   i.e. **dual review, no machine-only sign-off**.

The single-reviewer half of this is already built. What is **not** built is the
`critical` tier: today the shipped policy has exactly two states — review
required or not — and any required review can be cleared by **one** reviewer (or
a human `force_pass`). There is no work class for which Guild demands **two**
independent reviewers, and `force_pass` is **always** available. The brief's
own edge-case table flags the gap directly: *"High-risk artifact has only weak
review → Gate blocks or asks human."* Nothing in the shipped gate-pass rule
blocks on weak-only review.

This ADR's scope is therefore narrow: **consolidate the settled independence
rules by pointer, and decide the uncovered `critical`/dual-review tier, its
trigger set, and the disagreement-escalation rule.** It does not introduce a new
contract — it constrains the policy that drives the existing FROZEN
`guild.review_packet.v1` / `guild.review_result.v1`.

## Already settled (referenced, NOT re-decided here)

These come from the related ADRs and the FROZEN cross-host contract. This ADR
binds them by pointer; it does not restate or change them.

- **Independence levels & stamping** — cross-family reviewer = **STRONG**;
  same-family fresh-context subagent = **WEAK**, marked `independence: weak` and
  recorded in the trail. Codex/other host unavailable ⇒ **degrade to WEAK, never
  hard-block**. Reviewer is **read-only**, sees the packet + artifact only.
  Source: [`cross-host-review-and-loop-control.md`](../entities/cross-host-review-and-loop-control.md)
  §"Independence rules" + §"Sentinel Hardening"; realized by D-BR-A in
  [`v2-review-broker-and-artifact-bus.md`](v2-review-broker-and-artifact-bus.md).
  Shipped in `host-router.ts` (`independence: "strong" | "weak"`) and the
  review-broker skill.
- **The policy gate** — review engages when **`risk≥high` OR `--review=cross` /
  `review:cross` OR project config** requires it; otherwise `review_required ==
  false` and the gate passes with `status: skipped`. v2.0 caveat: there is **no
  automatic risk-scoring** — `risk≥high` fires only when a risk signal is
  explicitly supplied (SK-11). Source: same FROZEN doc §"Broker Placement And
  Policy"; broker skill §0.
- **AC-8 same-family hard guard** — `selectReviewer()` never returns a
  cross-family `selected` result when the reviewer family equals the author
  family, and an `unknown` author host returns `degraded-local`/`skipped` with a
  reason. **Never a false sign-off.** Source: FROZEN doc §"AC-8".
- **The checksum-bound 5-condition gate-pass** and the **loop cap → force-pass /
  extend-cap / rework** escalation. Source: FROZEN doc §"Gate-Pass Rule" +
  §"Loop Termination".
- **Cloud-reviewer consent** is a hard always-ask packet-egress checkpoint
  (D-BR-E). Source: [`v2-review-broker-and-artifact-bus.md`](v2-review-broker-and-artifact-bus.md).
- **Advisory ≠ adversarial.** The `powerful`-tier **advisor** escalation (one
  sub-answer for a stuck low-tier agent) is *not* a reviewer and never satisfies
  a gate. Source: [`cost-aware-tiering-and-lean-context.md`](cost-aware-tiering-and-lean-context.md)
  + FROZEN doc §"Advisory Versus Adversarial".

## Decision

A **four-level review policy keyed on work risk class.** Levels `low | medium |
high` are the already-shipped single-reviewer policy (restated as the policy's
lower three rungs, unchanged). This ADR **adds the `critical` rung** and the
rules that select and govern it.

### D-RI-1 — Independence is the existing STRONG / WEAK / human gradient

No new independence vocabulary. A required review resolves to exactly one of:
**STRONG** (different provider family), **WEAK** (same-family fallback, stamped
`independence: weak`), or **human** (force-pass / explicit human verdict). The
mapping and stamping are the shipped behavior (referenced above), used verbatim.

### D-RI-2 — Four-level risk-based policy; `critical` is the only new rung

| Risk class | Required? | Independence | Fallback | `force_pass` |
|---|---|---|---|---|
| `low` | no | — | — | n/a |
| `medium` | yes | prefer STRONG | WEAK (stamped) | allowed (human) |
| `high` | yes | prefer STRONG | **WEAK blocks → ask human** | allowed (human) |
| **`critical` (NEW)** | yes | **STRONG required** | **no machine fallback → human** | **disallowed** |

Rows `low`/`medium`/`high` are the shipped policy made explicit (no behavior
change; `high`'s "WEAK blocks → ask human" formalizes the brief's edge case).
The **`critical` row is the new decision**: a `critical`-class artifact requires
**dual review — one STRONG cross-family machine reviewer AND a human reviewer —
and `force_pass` is not offered.** If a STRONG machine reviewer cannot be
obtained (no different-family host available, AC-8 same-family, or `unknown`
author), the gate **does not degrade to WEAK**: it **blocks and escalates to a
human**, who is the second required reviewer regardless. There is no
machine-only path to clearing a `critical` gate.

### D-RI-3 — The `critical` work-class trigger set

A gate is `critical` when the work falls in any class the brief names as
high-risk (Finding 4), intersected with Guild's immutable always-ask hard set
([`autonomy-locking-validity.md`](autonomy-locking-validity.md)):

- security-policy or sandbox/permission changes;
- release automation and destructive git operations (force-push, history
  rewrite, tag/release publish);
- secret handling / credential-touching changes;
- persistent skill evolution that auto-promotes a skill body
  (`guild:evolve-skill` landing out of shadow mode).

This is a **named, closed enumeration**, not an auto-scorer — consistent with
the v2.0 SK-11 posture that Guild does not yet compute risk automatically. The
class is asserted by the lifecycle step that owns the operation (it already
knows it is touching the hard set) or by an explicit operator signal. Automatic
classification is a separate follow-up (see "Consequences").

### D-RI-4 — Disagreement & no-independence escalation rule

Human escalation (the existing force-pass surface) is **extended to three
additional triggers**, distinct from the shipped round-cap escalation:

1. **Reviewer disagreement** — in a dual review (`critical`), if the machine
   reviewer and the human reach opposite verdicts, the **human verdict wins**
   and is recorded; the gate never auto-resolves the conflict.
2. **Independence unattainable** — `high` or `critical` work with no available
   STRONG reviewer blocks and asks a human (D-RI-2); it does **not** silently
   proceed on WEAK.
3. **Non-converging findings** — when new blocking-finding *categories* keep
   appearing across rounds without convergence, the broker summarizes the
   conflict and escalates rather than burning rounds to the cap.

Every escalation is **loud and traceable** — recorded in the review trail with
the reason — per the brief's "Open Risks" ("Human force-pass may be necessary
but should be loud and traceable"). This reuses the existing trail and the
force-pass surface; it adds *triggers*, not a new mechanism.

### What ships when

- **[v2] (already shipped, referenced):** D-RI-1 in full; the `low`/`medium`
  rungs of D-RI-2; the round-cap arm of D-RI-4.
- **[v2.x] (this ADR's new work, deferred):** the `critical` rung of D-RI-2
  (dual review, no force-pass), the `high`-rung "WEAK blocks → ask human"
  formalization, the D-RI-3 trigger set, and the D-RI-4 disagreement /
  no-independence triggers. None of these is wired in the current broker; they
  are policy decisions awaiting an implementation lane.

## Options considered

**A. Do nothing — single reviewer + always-available force-pass is enough.**
Rejected. It leaves the brief's explicit gap open: a `critical` artifact
(secret handling, sandbox change, auto-promoted skill) can be cleared by one
machine reviewer or one human force-pass. The brief and Guild's own always-ask
hard set both argue some classes warrant a higher bar.

**B. Make ALL required review dual / cross-provider + human.** Rejected on
simplicity-first and cost. The brief's "Open Risks" warns strong review "costs
more and can slow small tasks." Forcing a human into every `medium`/`high` gate
destroys the autonomy the tiering ADR is built to preserve. Dual review must be
reserved for the narrow `critical` class.

**C. Add a `critical` rung with named triggers (CHOSEN).** Matches the brief's
own four-tier table, reuses every shipped mechanism (independence stamp, trail,
force-pass surface), and adds cost only where the always-ask hard set already
says the stakes justify it. The one real cost — a mandatory human in the
`critical` loop — is exactly the stake the class is defined by.

**D. Build an automatic risk-scorer to classify `critical` work.** Rejected for
*this* ADR (deferred, not dismissed). It contradicts the v2.0 SK-11 posture (no
auto risk-scoring) and is a larger, separable effort. A **named closed
enumeration** (D-RI-3) is the simplicity-first slice that delivers the policy
now; auto-classification is a follow-up.

## Consequences

- **One coherent four-level policy.** `low`/`medium`/`high` are unchanged
  shipped behavior; `critical` is the single new rung. No new contract — the
  policy drives the existing FROZEN `guild.review_packet.v1` /
  `guild.review_result.v1` (the `critical` constraint lives in the broker's
  policy layer, not the wire schema).
- **A real human-in-the-loop floor for the highest-stakes work.** Secret
  handling, sandbox changes, release automation, and auto-promoted skill bodies
  cannot be cleared by a machine alone. This aligns the review policy with the
  immutable always-ask hard set.
- **No silent degradation on `high`/`critical`.** Inability to obtain STRONG
  independence becomes a visible human-escalation, not a quiet WEAK pass —
  closing the brief's flagged edge case.
- **New work for downstream lanes (flagged, not authored here):**
  - `skill-author` — the `critical` rung + dual-review loop + the three new
    escalation triggers in `guild:review-broker`; the `high`-WEAK-blocks
    formalization.
  - `tooling-engineer` / `hook-engineer` — surfacing the `critical` work-class
    assertion at the lifecycle steps that touch the always-ask hard set, and the
    trail records for the new escalations.
  - `security` lane — owns confirming the D-RI-3 trigger enumeration stays in
    sync with the always-ask hard set and the cross-host trust model; this ADR
    names the classes, security owns their enforcement boundary.
- **Deferred follow-up:** an automatic risk-scorer (Option D / SK-11) that would
  let `critical` self-classify instead of being asserted. Out of scope here.
- **Confined blast radius.** Because `critical` is a closed, named class, the
  added human-in-the-loop cost lands only on the work that already trips
  always-ask — autonomy on everyday `medium`/`high` work is untouched.

## Validation criteria (for the [v2.x] implementation lane)

- **VC-RI-1 (critical needs two):** a `critical`-class gate with a single STRONG
  machine `satisfied` result does **not** pass until a human verdict is also
  recorded; `force_pass` is not offered at this gate.
- **VC-RI-2 (no degrade on critical):** a `critical` gate with no available
  different-family host blocks and escalates to a human — it never stamps
  `independence: weak` and proceeds.
- **VC-RI-3 (high blocks on weak):** a `high` gate that can only obtain a WEAK
  reviewer asks a human rather than passing on WEAK alone.
- **VC-RI-4 (disagreement → human wins):** in a dual review, opposing machine
  and human verdicts resolve to the human verdict, recorded in the trail.
- **VC-RI-5 (loud trail):** every D-RI-4 escalation writes a reason to the
  review trail; none is silent.
- **VC-RI-6 (lower rungs unchanged):** `low`/`medium` gates behave byte-identically
  to the shipped single-reviewer policy.
