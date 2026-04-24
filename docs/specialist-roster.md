# Specialist Roster

Implements `guild-plan.md §6`. 13 shipping specialists across 3 groups, 50 T5 skills.

Every specialist inherits `guild-principles` (T1) as a mandatory first load: the
Karpathy 4 plus Guild's evidence rule. Per-specialist T5 skills live under
`skills/specialists/<specialist>-<slug>/`.

## Engineering group (7 specialists · 26 skills)

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

Engineering-group principles: TDD-first, surgical diffs, evidence = passing tests
plus diff trace.

## Content & communication group (4 specialists · 16 skills)

### copywriter — `agents/copywriter.md`

- **Triggers:** blog, email, microcopy, landing copy, voice-and-tone work.
- **DO NOT trigger for:** technical docs (technical-writer), platform-native
  social posts (social-media), keyword/meta work (seo), positioning / campaign /
  outbound (marketing / sales).
- **Skills:** `copywriter-long-form`, `copywriter-product-microcopy`,
  `copywriter-email-sequences`, `copywriter-voice-guide`.

### technical-writer — `agents/technical-writer.md`

- **Triggers:** API docs, user manual, tutorial, how-to, changelog, release notes.
- **DO NOT trigger for:** marketing / persuasive copy (copywriter / marketing),
  short-form social posts (social-media).
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

## Team composition rules

From `guild-plan.md §7.2`:

- **Recommended default: 3–4 specialists.** Hard cap of 6. Context fragmentation
  kills coherence above that. `/guild:team edit --allow-larger` lifts the cap.
- **Implied specialists:** architect on any multi-component build; security on
  anything touching auth, secrets, or external integrations; qa whenever backend
  is present.
- **Orchestrator is implicit** — the top-level session plays coordinator, not a
  separate specialist slot.
- **Gap handling:** when team-compose surfaces a role with no matching specialist,
  the user picks auto-create (`guild-create-specialist`), skip, substitute, or
  compose-from-scratch. New specialists must pass the evolve gate before joining
  the live team — see `self-evolution.md`.

## See also

- `guild-plan.md §6` — full roster rationale and trigger examples.
- `guild-plan.md §7` — team composition flow.
- `architecture.md` — where specialists sit in the layered system.
- `agents/*.md` — the live trigger / DO-NOT-TRIGGER blocks and skill pulls.
