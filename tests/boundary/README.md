# Boundary-collision evals

## Overview

These fixtures target `guild-plan.md §15.2 risk #1` — **cross-group trigger collisions**, the primary risk the Guild plan calls out around specialist descriptions:

> Cross-group triggers collide (e.g., "content" fires both copywriter and marketing) — mitigated by pushy DO NOT TRIGGER blocks in every description; description optimizer catches overlap via eval flips.

The boundary tier is the fixture set the description-optimizer and `guild:create-specialist` boundary gates (`§12`) run against to verify that:

1. Each specialist triggers on prompts squarely inside its TRIGGER clause.
2. Adjacent specialists **do not steal** triggers that belong to their neighbour, per the DO NOT TRIGGER clause.
3. Prompts that are too generic to route to any single specialist return `null` and fall through to `/guild:team-compose` / `/guild` brainstorm instead of being captured by the loudest description.

These are specification fixtures only right now — the paired-eval harness that runs them is P6 tooling-engineer scope. Tests follow the same schema as `tests/trigger/<tier>/evals.json` so the same runner can consume both.

## Schema

```json
{
  "tier": "boundary",
  "cases": [
    {
      "id": "boundary-<specialist-a>-vs-<specialist-b>-<N>",
      "prompt": "<user utterance>",
      "expected_specialist": "<specialist name> | null",
      "rationale": "<one sentence: why this specialist, why not the other>"
    }
  ]
}
```

- `id` must start with `boundary-`. The convention is `boundary-<a>-vs-<b>-<N>` for collision pairs and `boundary-null-<N>` for too-generic cases.
- `expected_specialist` is either the `name:` field of an `agents/<specialist>.md` or `null`.
- `rationale` is a single sentence referencing the TRIGGER / DO NOT TRIGGER clause that settles the case — short enough to paste into a flip report.

## Collision axes covered

| # | Axis | Example collision prompt | Owner | Why |
|---|---|---|---|---|
| 1 | architect vs backend | "Design the API for X" | backend | API contract is backend; architect owns cross-component design |
| 2 | backend vs devops | "Deploy this service" | devops | Deploy/canary/IaC are devops; backend implements the app |
| 3 | backend vs qa | "Set coverage target for billing" | qa | Coverage gates + suite strategy are qa; backend writes pinning tests |
| 4 | backend vs security | "Review this auth endpoint" | security | Auth-flow review is security; backend writes the auth code |
| 5 | devops vs qa | "Set up CI coverage gates" | qa picks, devops wires | Gate selection is qa; CI plumbing is devops |
| 6 | mobile vs backend | "iOS app API client is flaky" | mobile | Swift networking code is mobile; server-side issues are backend |
| 7 | copywriter vs marketing | "Write launch copy" | marketing commissions, copywriter drafts | Launch plans are marketing; execution drafts are copywriter |
| 8 | copywriter vs technical-writer | "Document the pricing page" | technical-writer if functional, copywriter if persuasive | User-manual content is technical-writer; conversion copy is copywriter |
| 9 | copywriter vs sales | "Write a follow-up email" | sales if post-meeting, copywriter if lifecycle | Cold/post-meeting is sales; lifecycle to existing users is copywriter |
| 10 | social-media vs copywriter | "Write a thread about our feature" | social-media | Platform-native (threads/carousels/captions) is social-media |
| 11 | seo vs marketing | "Optimize our landing page" | seo for on-page, marketing for positioning | Meta/on-page/keywords are seo; messaging is marketing |
| 12 | marketing vs sales | "Email prospects about our launch" | sales if cold, marketing if broadcast | Cold outreach to a list is sales; broadcast to audience is marketing |
| 13 | researcher vs architect | "Compare Kafka vs NATS" | researcher supplies, architect decides | Surveys/comparisons are researcher; scoring + ADR is architect |
| 14 | security vs qa | "Dependency audit" vs "regression suite" | security (audit) / qa (suite) | CVE/secrets/threat model are security; suite shape/flaky/property are qa |
| 15 | mobile vs devops | "EAS + TestFlight" vs "backend K8s deploy" | mobile (mobile pipelines) / devops (server pipelines) | Mobile owns EAS/Fastlane/Xcode Cloud; devops owns everything else |

Plus a `boundary-null-*` group of at-least-3 prompts that are too generic to route to any single specialist and must fall through to `/guild:team-compose`.

## How to use

The paired-eval harness (P6, `tooling-engineer` scope) will:

1. Load `tests/boundary/evals.json`.
2. For each case, dispatch the prompt through the current description set.
3. Compare the routed specialist against `expected_specialist`.
4. Emit a flip report when a case that previously passed now fails (or vice versa). Flips are how `guild:evolve-skill` and the description optimizer gate description edits per `§12.1` step 5.

Until the harness lands, these fixtures are consumed manually:

- `specialist-agent-writer` runs a new specialist's description against the fixture set before promotion.
- `skill-author` uses them as regression coverage when a specialist's description is tuned.
- Boundary failures are filed as `followups:` against the owning specialist's description, not fixed in this file.

Adding a case: pick the tightest TRIGGER / DO NOT TRIGGER clause from the two specialists' `agents/<name>.md` frontmatter, write a one-sentence rationale that cites it, and keep the `id` prefix conventions above so the invariant check in the task brief keeps passing.
