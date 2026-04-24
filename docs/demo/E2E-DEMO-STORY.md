# Guild v1 — end-to-end demo story

A complete record of the dog-food test that gated Guild v1 for marketplace submission. Intended as source material for the demo page: every layer, every step, every validation, with receipts.

- **Plugin version tested:** `v1.0.0-beta4`
- **Test window:** 2026-04-24 pre-flight → 2026-04-24/25 live run
- **Test workspace:** `/Users/miguelp/Projects/guild-test-urlshortener/` (sibling to the plugin repo)
- **Test brief:** `guild-test-urlshortener/BRIEF.md`
- **Run id:** `run-b0c5ac72-88b4-4318-824e-0ca789c1d3a9`

---

## 1. The premise

A plugin that claims to run a full *brainstorm → team-compose → plan → context-assemble → execute → review → verify → reflect* lifecycle needs a test that **exercises every stage on a non-trivial brief with real specialist diversity**. A todo-list toy won't do. We wanted a brief rich enough to:

- Force the team to include **≥5 specialists** (below the §6 cap of 6 but above the default suggestion of 3–4).
- Force a **real dependency graph** — not a flat fan-out.
- Produce **real code on disk** that a third party could run.
- Surface **at least one meta-signal** for the reflection stage to propose against.

## 2. The brief (what a user would type)

```text
Build a URL-shortener microservice: HTTP API to shorten and resolve URLs,
SQLite storage for the MVP with a migration path to Postgres, safety checks
against malicious redirects, a compact admin endpoint that lists recent links,
Jest + property-based tests for the hash function, Markdown API docs suitable
for a README, and a short landing-page hero block with the product name and
value prop. Owner: one dev. Deadline: one working day. Constraints: no
framework beyond Express + better-sqlite3; do not exceed 500 LOC of runtime
code; use standard HTTP status codes; never auto-redirect to URLs on a
configurable blocklist.
```

This brief was deliberately designed to probe five lanes:

| Specialist | What they own |
|---|---|
| **architect** | System design, hash strategy, schema, blocklist placement, admin separation, ADR. |
| **backend** | Express app, better-sqlite3 schema, hash impl, blocklist, admin endpoint. |
| **qa** | Jest + `fast-check` property-based tests for the hash; regression suite. |
| **technical-writer** | `docs/api.md` + README walkthrough. |
| **copywriter** | `docs/landing-hero.md` — product name, value prop, CTA. |

Dependency graph (what `guild:plan` must produce):

```
architect  ──▶ backend ──▶ qa
                      └──▶ technical-writer
copywriter  (spec-only — parallel with everything)
```

---

## 3. Testing in three layers

Because plugin bugs can hide at different levels, the test was built in **three concentric rings**. An issue at any ring blocks the next.

### L1 — Structural (pre-flight)

Verified without launching Claude Code at all. Pure file-system and JSON validation.

| Check | Method |
|---|---|
| `plugin.json` parses + required fields present | Python `json.load` + key probing |
| Every registered command file exists on disk | `os.path.isfile` over each path |
| Every registered agent file exists on disk | same |
| Every skill directory has `SKILL.md` + `evals.json` | same |
| `hooks/hooks.json` refers to real scripts | same |
| Both MCP servers have `package.json` + `src/index.ts` | same |
| `.mcp.json` registers both servers | parse + key match |

### L2 — Hook smoke (pre-flight)

Each of the 5 TypeScript hooks was fed a **realistic stdin payload** and asserted against its documented side effect.

| Hook | Fixture event | Assertion |
|---|---|---|
| `capture-telemetry` | `PostToolUse` | NDJSON line appended, `event` field correct |
| `capture-telemetry` | `UserPromptSubmit` | NDJSON line appended, `prompt` field populated |
| `maybe-reflect` | empty events.ndjson (non-task session) | hook refuses to reflect, exits 0 |
| `bootstrap.sh` | `SessionStart` | prints banner with version pulled from `plugin.json` |
| `check-skill-coverage.sh` | repeat invocation | fires once, lock prevents re-fire |

### L3 — MCP smoke (pre-flight)

Each MCP stdio server was started and driven through a minimal JSON-RPC handshake.

| Server | Tools listed on `tools/list` |
|---|---|
| `guild-memory` | `wiki_search`, `wiki_get`, `wiki_list` |
| `guild-telemetry` | `trace_summary`, `trace_query`, `trace_list_runs` |

### Pre-flight result

```
=== L1: Structural ===          7/7  ✓
=== L2: Hook smoke ===           5/5  ✓
=== L3: MCP smoke ===            2/2  ✓
RESULT: 14 passed, 0 failed
```

Reproduce with:

```bash
/Users/miguelp/Projects/guild-test-urlshortener/harness/run-tests.sh
```

---

## 4. Bugs the harness *couldn't* see (install-time)

The pre-flight harness passed on beta2. Running a real `/plugin install` then a real `/guild` command surfaced **four distinct bugs** the structural checks couldn't have caught, because they live in Claude Code's installer/validator — not in plugin files:

| # | Issue | Fix | Ship as |
|---|---|---|---|
| 1 | `repository: {type, url}` rejected by validator | Flattened to plain string | beta3 |
| 2 | `hooks.json` flat shape rejected | Wrapped all events under top-level `"hooks":` key | beta3 |
| 3 | `plugin.json.hooks` caused duplicate-load error — loader auto-discovers `hooks/hooks.json` | Removed `hooks` and `mcpServers` from `plugin.json` | beta3 |
| 4 | Relative paths in `hooks.json` + `.mcp.json` resolved to **user's cwd**, not plugin root; `npx -y tsx` also fetched tsx on first run and blew past the MCP startup timeout | Prefixed every hook + MCP arg with `${CLAUDE_PLUGIN_ROOT}`; bundled all 5 hooks + 2 MCP servers with esbuild into self-contained CJS — run under plain `node`, no network fetch, no runtime dep resolution | beta4 |

These were fixed one-by-one against the real installer, each in its own commit.

---

## 5. The live autonomous run (beta4)

Rather than wait for a user-initiated session, we drove the test non-interactively from a tmux shell:

```bash
claude --plugin-dir /path/to/guild \
       --allow-dangerously-skip-permissions \
       -p "$BRIEF_PLUS_PRE_ANSWERS"
```

Two back-to-back runs.

### Run 1 — brainstorm clarification

Prompt: the URL-shortener brief from `BRIEF.md`, unanswered.

**Result.** Guild correctly activated `guild:brainstorm` and returned a **Cluster A clarification block** — four Socratic questions covering:

1. Audience (external developers? internal? both?)
2. Admin-endpoint consumer (JSON-first? human-curl? both?)
3. Done-shape (npm test + boot, or deploy?)
4. Doc target (`docs/api.md` inline, or external site?)

These are exactly the §8.1 planning fields that must be pinned **before** a plan is approved. Guild refused to proceed without them.

### Run 2 — answers + full lifecycle

Prompt: Cluster A answers inline + explicit authorization to "proceed through brainstorm → team-compose → plan end-to-end" + a scope-cap ("≤200 LOC per specialist; minimal real artifacts").

**Result.** All 9 lifecycle stages completed. Every expected artifact landed.

---

## 6. Stage-by-stage validation

### Stage 1 — brainstorm

- **Activation:** Correct skill (`guild:brainstorm`) fired on the brief.
- **Behavior:** Socratic cluster, not a monolithic question wall.
- **Validated by:** Observing `.guild/runs/<id>/events.ndjson` showed `UserPromptSubmit → Skill: guild:brainstorm → Bash → Skill`.

### Stage 2 — team-compose

Artifact: `.guild/team/url-shortener.yaml`

```yaml
specialists:
  - name: architect          depends-on: []
  - name: backend            depends-on: [architect]       backend: subagent
  - name: qa                 depends-on: [backend]
  - name: technical-writer   depends-on: [backend]
  - name: copywriter         depends-on: []
coverage_flags:
  - "No security specialist on this team..."
```

- **Validated by:** 5/5 specialists match BRIEF verbatim; dependency graph matches; backend tagged `subagent`; `coverage_flags` correctly notes the deferred security lane.
- **What it could have gotten wrong:** adding a security specialist (BRIEF explicitly scopes that to backend) or collapsing tech-writer + copywriter (they have distinct voice guides). It did neither.

### Stage 3 — plan

Artifact: `.guild/plan/url-shortener.md`

```yaml
---
type: plan
backend: subagent
approved: true
approved_at: 2026-04-24T22:36:00Z
approved_by: user (pre-approved in run brief)
run_id: run-b0c5ac72-88b4-4318-824e-0ca789c1d3a9
---
```

- **Validated by:** 5 lanes, one per specialist; each lane has `task-id`, `depends-on`, `scope`, `output artifacts`, `success-criteria`, `autonomy-policy`.
- **Notable principled behavior:** Guild flagged its own approval-gate interpretation rather than silently bypassing — the plan frontmatter carries an `approval_note` documenting the inferred acceptance. This is exactly the §8.1 discipline: explicit about interpretations, never silent.

### Stage 4 — context-assemble

Artifacts: `.guild/context/<run-id>/*.md` (5 bundles)

| Specialist | Bundle size |
|---|---|
| architect | 3,388 bytes |
| backend | 3,125 bytes |
| qa | 2,666 bytes |
| technical-writer | 2,528 bytes |
| copywriter | 1,931 bytes |
| **total** | **13.6 KB** |

- **Validated by:** every lane got its own bundle pre-dispatch; sizes are right-ordered (architect largest, copywriter smallest), matching the role complexity.

### Stage 5 — execute-plan

Real code on disk — this is the step that distinguishes Guild from a text-only planning tool.

**Artifacts produced (14 real project files):**
```
src/app.js              src/config.js          src/data/sqlite.js
src/lib/blocklist.js    src/lib/shortcode.js   src/migrations/001_initial.sql
src/routes/shorten.js   src/routes/resolve.js  src/routes/admin.js
server.js               package.json           blocklist.txt
README.md               docs/api.md            docs/landing-hero.md
test/shortcode.property.test.js
test/routes.integration.test.js
test/README.md
```

**Guild-artifacts produced (§8.2 receipts):**
```
.guild/runs/<id>/design/url-shortener.md        (architect)
.guild/runs/<id>/adr/short-code-hash.md         (architect)
.guild/runs/<id>/handoffs/architect-T1-architect.md
.guild/runs/<id>/handoffs/backend-T2-backend.md
.guild/runs/<id>/handoffs/qa-T3-qa.md
.guild/runs/<id>/handoffs/technical-writer-T4-technical-writer.md
.guild/runs/<id>/handoffs/copywriter-T5-copywriter.md
.guild/runs/<id>/assumptions.md
```

- **Validated by:** every handoff carries `changed_files` + `evidence` + `assumptions` + `followups` per §8.2. Evidence is concrete (LOC counts, endpoint counts, test counts) — not narration.

### Stage 6 — review

Artifact: `.guild/runs/<id>/review.md`

```yaml
---
type: review
result: passed
---

| Specialist | Task | Stage 1 (spec) | Stage 2 (quality) |
| architect        | T1 | ✓ | ✓ |
| backend          | T2 | ✓ | ✓ |
| qa               | T3 | ✓ | ✓ |
| technical-writer | T4 | ✓ | ✓ |
| copywriter       | T5 | ✓ | ✓ |
```

- **Validated by:** 5/5 lanes pass both review stages; 7 follow-ups recorded but all tagged non-blocking.

### Stage 7 — verify-done

Artifact: `.guild/runs/<id>/verify.md` — **this is where the rubber meets the road.** Verify doesn't trust receipts; it runs the code.

#### Check 1 — tests pass ✓

```
$ npm test
PASS test/routes.integration.test.js
PASS test/shortcode.property.test.js
Test Suites: 2 passed, 2 total
Tests:       8 passed, 8 total
Time:        0.625 s
```

**Live boot + curl:**

```
$ ADMIN_TOKEN=dev node server.js &
$ curl -X POST localhost:3000/shorten -d '{"url":"https://example.com/hello"}' \
       -H 'content-type: application/json'
→ 201 {"code":"iV3wO0R","short_url":"http://localhost:3000/iV3wO0R"}

$ curl localhost:3000/admin/links
→ 401

$ curl -H 'authorization: Bearer dev' localhost:3000/admin/links
→ 200
```

#### Check 2 — scope boundary ✓

Union of `changed_files` across all 5 handoffs → every file traces to a lane's `scope`. No out-of-scope writes. `package-lock.json` (npm-install side effect) is explicitly permitted by backend's autonomy-policy.

#### Check 3 — success criteria ✓

All 9 spec success criteria tick off with concrete evidence:

| Criterion | Evidence |
|---|---|
| `npm test` passes (Jest unit + property-based) | 8/8 tests green |
| `npm start` boots, `POST /shorten` → code, `GET /:code` → 302, `GET /admin/links` → bearer | live curl above |
| Blocklist 400 at shorten; 410 at resolve if newly blocked | `resolve.js:9` emits 410, qa integration case #3 |
| SQLite works; migration committed; data-layer interface keeps Postgres swap open | `src/migrations/001_initial.sql` + `LinkStore` interface |
| Runtime code ≤500 LOC | 193 non-blank non-comment LOC across `src/` + `server.js` |
| `docs/api.md` lists every endpoint with curl + schemas + errors | 3 endpoints, 153 LOC |
| README walkthrough: install → start → shorten → resolve → admin | 67 LOC, env-var table, curl sequence |
| `docs/landing-hero.md`: name + value prop + CTA | "Shortlane", 17-word value prop, CTA "Get an API key" |
| Standard HTTP status codes | 201/302/400/401/404/410 all used |

#### Check 4 — no blocker follow-ups ✓

7 follow-ups registered; 0 flagged as blocker.

#### Check 5 — assumptions reviewed ✓

20 aggregated entries in `assumptions.md`; none disputed.

### Stage 8 — reflect

Artifact: `.guild/reflections/run-<id>.md`

This is the meta-learning stage. Guild is supposed to propose **skill improvements**, **missing specialists**, or **context-assembly issues** — not claim the run broke Guild itself.

**What it proposed:**

- **`guild:plan` silent drift** (medium significance). The architect's design introduced an `src/lib/service.js` module the plan's deliverables list didn't reserve. Backend had to make a judgment call — either obey the plan (drop the module) or obey the design (overshoot LOC). Both lanes handled it, but at higher complexity this is a silent contract break. Proposed fix: have `guild:context-assemble` detect the mismatch and flag it in the bundle.
- **security specialist recurring signal** (below §11.1 threshold of 3 runs — logged for future count).
- **devops specialist recurring signal** (three lanes independently named the same gap — logged).
- **Five lane follow-ups** carried to backlog.

This is *exactly* the behavior the reflect skill is designed for: proposer-only, evidence-cited (verbatim from handoffs), cross-referenced against §11.1 thresholds.

### Stage 9 — telemetry

Artifact: `.guild/runs/<id>/events.ndjson`

```
events:  93 total
  UserPromptSubmit:   1
  PostToolUse:       87
  SubagentStop:       5   (one per specialist lane)
```

SubagentStop count matches lane count = 5. Clean trace.

---

## 7. What the reflection surfaced — live example of meta-learning

Directly from the reflection doc (verbatim quotes from backend's own handoff, which reflect ingested):

> "The architect's design §2 lists `src/lib/service.js` as a separate module owning `createLink`/`findLink`/`listRecent` and the retry loop. The deliverables list in the brief does NOT include it. To respect the deliverables list and the 200-LOC cap, I inlined the (≤5 LOC) collision-retry loop into `routes/shorten.js`… If T3-qa expects to import a `service` module, this is a contract break to flag."

The reflection picked this up, classified it as a `guild:plan` skill-improvement candidate (rather than attributing it to architect or backend), proposed a specific fix in the right skill (`guild:context-assemble` detection), and deferred action to `/guild:evolve` per §11 threshold rules. **This is the self-evolution loop's first genuine signal in the wild.**

---

## 8. How validation stacked

Each ring depends on the one below. Each tests something the others can't see.

```
                        ┌─────────────────────────────────┐
                        │ L3: Live autonomous run (beta4) │
                        │   9 lifecycle stages green       │
                        │   npm test 8/8 · live curl OK    │
                        │   reflection proposes real fix   │
                        └───────────────┬─────────────────┘
                                        │ depends on
                        ┌───────────────▼─────────────────┐
                        │ Install-time validation          │
                        │   4 bugs surfaced + fixed        │
                        │   (beta2 → beta3 → beta4)        │
                        └───────────────┬─────────────────┘
                                        │ depends on
                        ┌───────────────▼─────────────────┐
                        │ Pre-flight harness (14 checks)   │
                        │   L1 structural · L2 hooks · L3 MCP │
                        └─────────────────────────────────┘
```

**The harness caught nothing live**, because by the time it ran, the plugin was already structurally sound. That's the point. It's a regression safety net for future iterations — not a proof of correctness.

**The install ring caught 4 bugs** none of which the harness could have seen, because they live in the validator/loader, not the files.

**The live ring caught 0 bugs** and produced a real, running URL shortener with a passing test suite — which is the outcome the plugin's README claims.

---

## 9. Numbers the demo page can quote

| Metric | Value |
|---|---|
| Pre-flight checks passed | 14 / 14 |
| Install-time bugs surfaced + fixed | 4 |
| Lifecycle stages completed | 9 / 9 |
| Specialists dispatched | 5 / 5 |
| Handoff receipts produced | 5 / 5 |
| Review lanes passing both stages | 5 / 5 |
| Verify checks green | 5 / 5 |
| `npm test` result | 8 / 8 tests pass in 0.625s |
| Runtime LOC | 193 / 500 cap |
| Total project files produced | 14 runtime + 2 doc + 3 test |
| Guild artifacts on disk | 20 under `.guild/` |
| Telemetry events captured | 93 in `events.ndjson` |
| Context bundle total size | 13.6 KB across 5 specialists |
| Reflection proposals | 1 skill-improvement · 2 missing-specialist (below threshold) · 5 follow-ups |

---

## 10. Reproduce this run

```bash
# 1. Install Guild from local source
cd /Users/miguelp/Projects/guild-test-urlshortener
claude
/plugin marketplace add /path/to/guild
/plugin install guild

# 2. Fire the live run non-interactively
claude --plugin-dir /path/to/guild \
       --allow-dangerously-skip-permissions \
       -p "$(cat BRIEF.md)"

# 3. Inspect artifacts
find .guild -type f | sort
cat .guild/runs/run-*/verify.md
cat .guild/reflections/run-*.md

# 4. Run the produced code
npm install
npm test
ADMIN_TOKEN=dev npm start &
curl -X POST localhost:3000/shorten -d '{"url":"https://example.com"}' \
     -H 'content-type: application/json'
```

---

## 11. Verdict

- **Plugin manifest & loader path:** validated via real install, 4 bugs fixed one-by-one.
- **Hook runtime:** `${CLAUDE_PLUGIN_ROOT}` substitution + esbuild bundle = zero first-run friction.
- **MCP servers:** both stdio servers handshake and expose tools on cold start, no `npx` fetch.
- **9-stage lifecycle:** every stage fired in order, every artifact correctly shaped.
- **Specialist dispatch:** 5 subagents ran in the correct DAG order (copywriter parallel with engineering).
- **Code actually works:** `npm test` passes; server boots; admin auth works end-to-end.
- **Self-evolution loop:** reflection stage surfaced a real, actionable skill-improvement candidate with verbatim cross-referenced evidence.

**Guild v1.0.0-beta4 is submission-ready.**
