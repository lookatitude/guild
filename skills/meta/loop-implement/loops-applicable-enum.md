# `loops_applicable` enum — layer selection (loop-implement detail)

Detail for SKILL.md §"`loops_applicable` enum". The plan-block `loops_applicable`
field selects which layers run for a lane.

## Five valid values (fixed order)

Plan-validate (T3a-backend-config) accepts ONLY these five values, in this
fixed order in `LOOPS_APPLICABLE_VALUES` (`guild-benchmark/src/loop-applicable.ts`):

```
none, l3-only, l4-only, both, full
```

Any other value is rejected at plan-validate time with exit 2 and the literal
stderr line:

```
loops_applicable must be one of: none, l3-only, l4-only, both, full
```

### Layer-set per value

| Order | Value | L3 runs? | L4 runs? | security-review runs? |
|---|---|---|---|---|
| 1 | `none` | no | no | no |
| 2 | `l3-only` | yes | no | no |
| 3 | `l4-only` | no | yes | no |
| 4 | `both` | yes | yes | no |
| 5 | `full` | yes | yes | yes |

`activeLayersFor(loops_applicable)` returns the ordered layer list (`["L3"]`,
`["L4"]`, `["L3","L4"]`, or `["L3","L4","security-review"]`).

## Default per lane type (when `loops_applicable` is unset)

| Lane owner | Default `loops_applicable` |
|---|---|
| `backend`, `frontend`, `mobile`, `devops` | `full` |
| `qa` (when primary implementer of test fixtures) | `l4-only` |
| `technical-writer` / `copywriter` / `social-media` (user-facing deliverable) | `l4-only` |
| `researcher` / `architect-as-pure-design` / `marketing` / `sales` / `seo` / non-user-facing copy | `none` |
| `security` (rare — owning an implementation lane) | **plan must explicitly set**; no default. |

## Why security-owned lanes must explicitly set `loops_applicable`

A security-owned implementation lane cannot also run security-review against
itself (self-review defeats the adversarial contract). The plan-validate
decision tree is the binding contract — `validatePlanLane(...)` in
`guild-benchmark/src/loop-applicable.ts` implements all 4 cases; qa pins each in
`loop-implement.test.ts`:

1. **Security-owned lane omits `loops_applicable`** → reject exit 2 with literal
   error `security-owned lane <lane_id> must set loops_applicable explicitly`.
2. **Security-owned lane sets `loops_applicable: none` WITH** the literal
   end-of-line comment marker `# review lane; loops_applicable=none per T6 carve-out`
   on the same plan-block line → ACCEPT (T6 exemption).
3. **Security-owned lane sets `loops_applicable: none` WITHOUT** the marker →
   reject exit 2 with literal error `security-owned lane <lane_id> sets
   loops_applicable=none without the T6 exemption marker`.
4. **Security-owned lane sets `l3-only`, `l4-only`, `both`, or `full`** → ACCEPT
   (normal path; security-review must be routed to a different specialist via
   plan-level override when `loops_applicable: full`).
