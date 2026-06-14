# Specialist Roster

17 registered agents across 3 groups plus tiered-worker roles (doc-writer promoted to
first-class in v2.0; advisor and developer added as tiered-worker roles). See
`https://guildstack.dev/docs/specialist-roster` for the full roster with trigger examples
and DO NOT TRIGGER boundaries.

Every specialist inherits `guild-principles` (T1) as a mandatory first load: the
Karpathy 4 plus Guild's evidence rule. Per-specialist T5 skills live under
`skills/specialists/<specialist>-<slug>/`.

**Model tiers (cost-aware-tiering-and-lean-context ADR §1/§7).** Each agent's
frontmatter `model:` declares a **default tier** from the host-agnostic ladder
`cheap (haiku) | mid (sonnet) | powerful (opus)`. The auto-scorer (ADR §2) picks
the lowest viable tier per lane; a `powerful` need inside a cheap/mid lane is an
**escalation to the `advisor`** (ADR §3), never a self-promotion. See the
**Tiered-worker roster** section below.

## Engineering group (8 specialists · 30 authored T5 skills)

### architect — `agents/architect.md`

- **Triggers:** "design this system", "architecture review", "pick between X and Y",
  "tradeoff analysis", "write an ADR". Implied on any multi-component build.
- **DO NOT trigger for:** implementation coding (backend), test authoring (qa),
  deploy/CI (devops), security audits (security), pre-decision research (researcher).
- **Skills:** `architect-systems-design`, `architect-tradeoff-matrix`,
  `architect-adr-writer`.

### researcher — `agents/researcher.md`

- **Triggers:** "research", "compare", "state of the art", "paper digest",
  "vendor comparison".
- **DO NOT trigger for:** making the architectural call (architect), writing code
  (backend), writing content (copywriter / technical-writer).
- **Skills:** `researcher-deep-dive`, `researcher-paper-digest`,
  `researcher-comparison-table`.

### backend — `agents/backend.md`

- **Triggers:** API, endpoint, schema, DB, queue, worker, migration, integration.
- **DO NOT trigger for:** system-design decisions (architect), infra/pipeline
  (devops), mobile client code (mobile), test strategy (qa).
- **Skills:** `backend-api-contract`, `backend-data-layer`,
  `backend-migration-writer`, `backend-service-integration`.

### devops — `agents/devops.md`

- **Triggers:** deploy, pipeline, infra, SLO, release, IaC, observability,
  incident.
- **DO NOT trigger for:** app-level logic (backend), threat modeling (security),
  test authoring (qa).
- **Skills:** `devops-ci-cd-pipeline`, `devops-infrastructure-as-code`,
  `devops-observability-setup`, `devops-incident-runbook`.

### qa — `agents/qa.md`

- **Triggers:** tests, coverage, regression, flaky, property-based, snapshot.
  Implied whenever backend is present.
- **DO NOT trigger for:** writing the feature itself (backend / mobile),
  deployment (devops).
- **Skills:** `qa-test-strategy`, `qa-property-based-tests`, `qa-snapshot-tests`,
  `qa-flaky-test-hunter`.

### mobile — `agents/mobile.md`

- **Triggers:** iOS, Android, RN, Expo, TestFlight, Play Store, mobile perf.
- **DO NOT trigger for:** backend APIs (backend), release infra (devops).
- **Skills:** `mobile-ios-swift`, `mobile-android-kotlin`, `mobile-react-native`,
  `mobile-performance-tuning`.

### security — `agents/security.md`

- **Triggers:** threat, audit, OWASP, vuln, CVE, auth flow, secrets scan.
  Implied on anything touching auth, secrets, or external integrations.
- **DO NOT trigger for:** implementation of the fix (backend / devops),
  compliance copy (copywriter / technical-writer).
- **Skills:** `security-threat-modeling`, `security-dependency-audit`,
  `security-auth-flow-review`, `security-secrets-scan`.

### frontend — `agents/frontend.md`

- **Triggers:** React, Vue, Svelte, Solid, Vite config, Tailwind, a11y/accessibility,
  Lighthouse, Core Web Vitals, component authoring, state management, client-side
  routing, code splitting, frontend bundle size, design-system implementation.
- **DO NOT trigger for:** cross-system architecture (architect), API contracts / data
  layer (backend), test strategy and suite shape (qa), iOS/Android/RN (mobile),
  CI/CD and infra (devops), UI microcopy (copywriter), SEO technical audits (seo).
- **Skills:** `frontend-react`, `frontend-state-management`, `frontend-bundler-config`,
  `frontend-a11y` — all authored under `skills/specialists/`; the main session may
  also pull `guild:tdd` + `guild:systematic-debug` for methodology beyond them.

Engineering-group principles: TDD-first, surgical diffs, evidence = passing tests
plus diff trace.

## Content & communication group (5 specialists · 20 skills)

### copywriter — `agents/copywriter.md`

- **Triggers:** blog, email, microcopy, landing copy, voice-and-tone work.
- **DO NOT trigger for:** technical docs (technical-writer), platform-native
  social posts (social-media), keyword/meta work (seo), positioning / campaign /
  outbound (marketing / sales).
- **Skills:** `copywriter-long-form`, `copywriter-product-microcopy`,
  `copywriter-email-sequences`, `copywriter-voice-guide`.

### doc-writer — `agents/doc-writer.md`

- **Triggers:** "write a README", doc site, documentation page, product docs,
  feature docs, how-to guide, getting-started guide (narrative), onboarding
  documentation, wiki page, knowledge base, conceptual guide, contributor guide.
- **DO NOT trigger for:** API reference, user manuals, changelogs, release notes
  (technical-writer); blog posts, microcopy, email, voice guides (copywriter);
  social posts (social-media); SEO mechanics (seo).
- **Skills:** `doc-writer-readme`, `doc-writer-product-guide`,
  `doc-writer-doc-site`, `doc-writer-onboarding-doc`.
- **Default tier:** `cheap`→`mid` (sonnet).

### technical-writer — `agents/technical-writer.md`

- **Triggers:** API docs, user manual, changelog, release notes, migration guide,
  runbook prose.
- **DO NOT trigger for:** product READMEs, doc-site pages, feature docs, how-to
  guides, onboarding docs, wikis (doc-writer); marketing / persuasive copy
  (copywriter / marketing); short-form social posts (social-media).
- **Skills:** `technical-writer-api-docs`, `technical-writer-user-manual`,
  `technical-writer-tutorial`, `technical-writer-release-notes`.

### social-media — `agents/social-media.md`

- **Triggers:** tweet, LinkedIn post, thread, carousel, caption, content calendar,
  engagement template.
- **DO NOT trigger for:** long-form copy (copywriter), technical docs
  (technical-writer), paid/campaign strategy (marketing).
- **Skills:** `social-media-platform-post`, `social-media-thread`,
  `social-media-engagement-templates`, `social-media-content-calendar`.

### seo — `agents/seo.md`

- **Triggers:** keywords, meta/title, on-page optimization, crawl, structured
  data, internal linking, technical SEO audit.
- **DO NOT trigger for:** the content itself (copywriter / technical-writer),
  messaging / positioning (marketing).
- **Skills:** `seo-keyword-research`, `seo-on-page-optimization`,
  `seo-technical-audit`, `seo-internal-linking`.

Writing-group principles (copywriter, technical-writer, social-media): match
existing voice, don't rewrite adjacent prose, evidence = a sample the user can
scan. SEO follows commercial-group principles (hypothesis-first, measurable
outcome, data citation).

## Commercial group (2 specialists · 8 skills)

### marketing — `agents/marketing.md`

- **Triggers:** positioning, GTM, launch plan, campaign brief, messaging,
  A/B copy variants.
- **DO NOT trigger for:** platform-native social posts (social-media owns),
  SEO mechanics (seo owns), sales outreach sequences (sales owns), long-form
  content (copywriter owns).
- **Skills:** `marketing-positioning`, `marketing-launch-plan`,
  `marketing-campaign-brief`, `marketing-ab-copy-variants`.

### sales — `agents/sales.md`

- **Triggers:** cold email, outreach sequence, discovery framework, proposal,
  follow-up, objection handling.
- **DO NOT trigger for:** launch announcements (marketing), user manuals
  (technical-writer), social posts (social-media).
- **Skills:** `sales-cold-outreach`, `sales-discovery-framework`,
  `sales-proposal-writer`, `sales-follow-up-sequence`.

Commercial-group principles: hypothesis-first, success = measurable outcome,
evidence = data citation (search volume, A/B result, benchmark).

## Tiered-worker roster (cost-aware-tiering-and-lean-context ADR §7)

A thin **tiered-worker** layer **augments** the 14 product specialists and the
dev-team agents (it does not replace either). Each role carries a **default
tier**. Per the ADR's reconciliation rule, where an equivalent already ships, the
existing specialist is **retiered** rather than duplicated; only genuinely-new
types get a new file. Open Item **O-1 is resolved: no standalone reviewer type
ships** — review/critic work folds into the `advisor` escalation pass plus the
existing `guild:review` / `qa` lanes.

| Role | Default tier | `model:` | Placement | One-line scope |
|---|---|---|---|---|
| `researcher` (per-topic) | `cheap`→`mid` | `sonnet` | **retiered** `agents/researcher.md` | Gather + digest sources for one topic; read/summarize cheap, synthesize mid. Pre-decision only — does not decide. |
| `architect` | `powerful` | `opus` | **annotated** `agents/architect.md` (already powerful) | Shape systems, compare options, author ADRs (high-judgment, low frequency). |
| `advisor` | `powerful` | `opus` | **NEW** `agents/advisor.md` | Answer one escalated sub-question seeing draft + question only (§3); never raw context. |
| `developer` | `mid` | `sonnet` | **NEW** `agents/developer.md` | Implement a domain-*less* task lane (draft/reason/build); escalates to advisor when above tier. |
| `doc-writer` | `cheap`→`mid` | `sonnet` | **PROMOTED** `agents/doc-writer.md` (first-class v2.0) | READMEs, doc-site pages, feature guides, how-tos, onboarding docs, wikis; cheap for mechanical edits, mid for synthesis. |

Notes:

- **`developer` vs domain implementers.** `developer` is the *generic* mid-tier
  worker for lanes with no domain home. Any API/data-layer work is `backend`'s,
  any web UI is `frontend`'s, any iOS/Android/RN is `mobile`'s — even when a lane
  is phrased generically ("build this", "implement that"). Each domain agent's
  boundary block now states this reciprocally so the `developer` trigger does not
  poach (adjacent-boundary scan, SC-9).
- **`advisor` vs `architect`.** Both are `powerful`, distinct roles: `architect`
  is dispatched to *own a design/decision*; `advisor` answers a single in-flight
  *escalation* on a draft. The architect boundary block now defers escalated
  one-off critique to `advisor`.
- **`doc-writer` promoted to first-class specialist (v2.0).** A standalone
  `agents/doc-writer.md` ships — it is cleanly separated from `technical-writer`
  (which keeps API reference / manuals / changelogs / release notes) by the boundary
  in `doc-writer.md §Scope boundaries`. The §7 tiered-worker row is updated from
  "reconciled onto technical-writer" to "PROMOTED `agents/doc-writer.md`".
- **All 17 registered agents are now tiered** — every agent file carries an
  explicit `model:` plus a `**Default tier:**` note, not just the §7 roster rows.
  `architect` and `security` are `powerful` (`opus`); every other engineering /
  content / commercial specialist defaults to `mid` (`sonnet`), with `researcher`
  and `technical-writer` running a `cheap` sub-pass for pure read/summarize and
  mechanical-edit work. The complete map is below.

### Complete default-tier map (all 17 registered agents)

Every role the orchestrator can dispatch, with its default tier and frontmatter
`model:`. The auto-scorer (ADR §2) may drop a routine single-item lane below the
default to `cheap`, or escalate one sub-question to the `powerful` `advisor`
(ADR §3) — neither changes the agent's printed default.

| Role | Group | Default tier | `model:` |
|---|---|---|---|
| `architect` | engineering | `powerful` | `opus` |
| `security` | engineering | `powerful` | `opus` |
| `advisor` | tiered-worker (NEW) | `powerful` | `opus` |
| `researcher` | engineering | `cheap`→`mid` | `sonnet` |
| `backend` | engineering | `mid` | `sonnet` |
| `frontend` | engineering | `mid` | `sonnet` |
| `mobile` | engineering | `mid` | `sonnet` |
| `devops` | engineering | `mid` | `sonnet` |
| `qa` | engineering | `mid` | `sonnet` |
| `developer` | tiered-worker (NEW) | `mid` | `sonnet` |
| `copywriter` | content & comms | `mid` | `sonnet` |
| `doc-writer` | content & comms | `cheap`→`mid` | `sonnet` |
| `technical-writer` | content & comms | `cheap`→`mid` | `sonnet` |
| `social-media` | content & comms | `mid` | `sonnet` |
| `seo` | content & comms | `mid` | `sonnet` |
| `marketing` | commercial | `mid` | `sonnet` |
| `sales` | commercial | `mid` | `sonnet` |

14 product specialists + the 3 tiered-worker roles (`advisor`, `developer`, `doc-writer`)
= 17. `powerful` is reserved for the three high-stakes / low-frequency roles
(`architect`, `security`, `advisor`); no implementer or content/commercial role
defaults to `powerful`.

**No agent defaults to `cheap`.** The `cheap` tier (haiku) is still live and
reachable two ways: (a) the auto-scorer drops a score-0 lane — a pure file read,
summarize, classify, tag, or a single mechanical doc/microcopy edit — to `cheap`
regardless of the owning agent's default; (b) `researcher` and `technical-writer`
(both `cheap`→`mid`) run their read/summarize and mechanical-edit sub-passes at
`cheap` before synthesizing at `mid`. The default-biases-cheap rule (ADR §10,
zero-config) keeps a routine run trending cheap even though no agent's `model:`
is `haiku`.

## Team composition rules

- **Recommended default: 3–4 specialists.** Hard cap of 6. Context fragmentation
  kills coherence above that. `/guild plan --team-size=N` lifts the cap.
- **Implied specialists:** architect on any multi-component build; security on
  anything touching auth, secrets, or external integrations; qa whenever backend
  is present.
- **Orchestrator is implicit** — the top-level session plays coordinator, not a
  separate specialist slot.
- **Gap handling:** when team-compose surfaces a role with no matching specialist,
  the user picks auto-create (`guild:create-specialist`), skip, substitute, or
  compose-from-scratch. New specialists must pass the evolve gate before joining
  the live team.

## See also

- `https://guildstack.dev/docs/specialist-roster` — full roster rationale and trigger examples.
- `https://guildstack.dev/docs/architecture` — where specialists sit in the layered system.
- `agents/*.md` — the live trigger / DO-NOT-TRIGGER blocks and skill pulls.
