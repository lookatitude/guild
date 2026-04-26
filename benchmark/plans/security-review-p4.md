---
type: security-review
slug: p4-learning-loop-surfaces
phase: P4
status: accepted
owner: security
reviewed_at: 2026-04-26
upstream:
  - benchmark/plans/p4-learning-loop-architecture.md
  - benchmark/plans/adr-005-learning-loop-orchestrator.md
predecessor_review:
  - benchmark/plans/security-review.md  (P3 — surfaces M1–M16 carry forward unchanged; loop reuses runner)
---

# P4 Learning-Loop — Security Review

> **Scope.** Threat-models the three new surfaces architect named in
> `p4-learning-loop-architecture.md §6` plus the threshold-gaming
> concern flagged in §5.4. Phase-scoped: P4 only. P1/P2/P3 surfaces are
> already reviewed in `benchmark/plans/security-review.md`; that
> review's M1–M16 carry forward **unchanged** because the loop reuses
> `runner.ts` per ADR-005 §Decision (commitment 6) and `compare.ts`
> per `p4-learning-loop-architecture.md §3.3`. The runner's process
> isolation (ADR-003 fresh-fixture clone, ADR-004 process-group
> signaling) bounds the candidate-run threat model the same way it
> bounds the baseline-run threat model.

> **What this document does NOT do.** It does not modify any locked
> file (`p4-learning-loop-architecture.md`, `adr-005`, `p3-runner-architecture.md`,
> `security-review.md`, ADR-001/3/4, `01-architecture.md`,
> `p2-ui-architecture.md`). It does not write implementation code. It
> produces *requirements* + *acceptance criteria*; backend (T2) writes
> the code, qa (T4) pins the tests, technical-writer (T5) carries the
> runbook prose.

> **Architect's surfaces — index.**
> - §6.1 Reflection-apply file-write → **§1** below (F1.1–F1.6, six STRIDE categories).
> - §6.2 Manifest tampering → **§2** below (F2.1–F2.5).
> - §6.3 / §3.4 `auth_identity_hash` privacy boundary → **§3** below (F3.1–F3.3).
> - §5.4 Threshold-gaming concern → **§4** below (F4.1).

---

## 1. Reflection-apply file-write surface

The operator-driven apply step (between `loop --start` and `loop
--continue`) is the most consequential new surface in P4. The loop
itself never writes plugin source (ADR-005 §Decision commitment 5
locks the architectural boundary), but the *proposal body* the
operator follows is `claude` subprocess output — i.e., produced from
an untrusted model run against an operator-authored Case prompt — and
the operator hand-applies it to the host repo. STRIDE coverage on
this surface walks all six categories because the threat shapes are
genuinely different (Tampering ≠ Elevation ≠ Repudiation ≠
Info-disclosure ≠ DoS ≠ Race).

### F1.1 — Tampering: malicious proposal injects code into plugin source

| Field | Value |
| --- | --- |
| **Surface** | `p4-learning-loop-architecture.md §6.1` (architect names this surface; pins "loop never writes plugin source" boundary). |
| **Threat** | **Tampering** (STRIDE T). A proposal body instructs the operator to add code that, when applied to a skill / agent / hook, exfiltrates env vars, edits arbitrary files on the host, or installs a backdoor that fires on the next plugin load (CWE-829 Inclusion of Functionality from Untrusted Control Sphere; CWE-94 Improper Control of Generation of Code — "Code Injection"). The proposal body is captured verbatim by `guild:reflect`; the loop displays it advisory-only via `loop --status`. |
| **Severity** | **High** — the operator-facing instruction is the attack vector; even attentive operators can miss a one-line shell escape inside a 200-line skill rewrite. The candidate run executes the modified plugin in a fresh-fixture clone (ADR-003) which scopes *runtime* damage, but the **applied commit is in the host repo's git history** — the operator pushes it, teammates pull it, and the backdoor lands in everyone's working tree. Fresh-fixture isolation does not undo the source-tree commit. |
| **Mitigation** | Three layers — defence-in-depth, none individually sufficient: <br>(a) **`loop --status` MUST print the proposal body in full** (no truncation, no rendered-markdown stripping that hides HTML comments / zero-width characters) so the operator reviews the literal bytes they are about to follow. Backend implements per `p4-learning-loop-architecture.md §3.1` `--status` ergonomic. <br>(b) **`loop --status --diff <proposal-id>`** (new flag — additive to architect's `--status`) prints a *suggested* unified diff if the proposal body contains one; otherwise prints a notice "this proposal is freeform — no machine-readable diff. Review the body before applying." This is advisory, not enforcement; backend implements. <br>(c) **Runbook caveat (R1)** — operator runbook explicitly tells the operator to (i) read the proposal body in full, (ii) apply it on a topic branch, (iii) request human review *before* running `loop --continue`, (iv) treat the apply step as if reviewing an untrusted PR. <br>**Architect's boundary stays:** the loop never auto-applies. v1 does not add automated AST-level diffing or CWE-aware static analysis on the proposal body — that is a v1.x concern (ADR-006 if it becomes warranted). |
| **Acceptance criterion** | (a) Backend test: `loop --status --baseline-run-id <id>` output contains the verbatim proposal body for each entry (byte-for-byte equality vs the source `.md` file). (b) Backend test: `loop --status --diff <proposal-id>` is reachable; output includes either a fenced diff block or the freeform-notice string. (c) Runbook test (T5): `06-learning-loop.md` contains an explicit "review the proposal as if it were an untrusted PR" paragraph (technical-writer T5 verifies on review). |
| **Owner** | `backend` (`--status` body printing + `--diff` flag), `technical-writer` (R1 runbook), `qa` (test pin). |
| **Classification** | **P4-required**. |

### F1.2 — Elevation of privilege: proposal modifies a high-trust file the operator did not expect

| Field | Value |
| --- | --- |
| **Surface** | `p4-learning-loop-architecture.md §6.1` ("`source_path` in the manifest is advisory … the loop does not enforce that the operator actually edited that file"). |
| **Threat** | **Elevation of Privilege** (STRIDE E). A proposal declares `source_path: agents/security.md` (advisory) but the body instructs the operator to *also* edit `hooks/hooks.json` (which runs at every Claude Code session start) or `commands/guild.md` (which runs whenever the operator types `/guild`). A casual operator scanning for "the file the proposal edits" sees only the advisory `source_path` and applies the broader edits without realising the privilege footprint. |
| **Severity** | **High** — high-trust files (`hooks/`, `commands/`, `.claude/settings.json`) execute on every session; a single applied proposal can establish persistence that survives reboots and outlives the loop. |
| **Mitigation** | (a) **High-trust path callout in `loop --status`** — backend computes a static allowlist of "high-trust" subtrees (`hooks/`, `commands/`, `.claude/settings*.json`, `.mcp.json`, `mcp-servers/`) and, when scanning a proposal body, *grep* for path strings matching those subtrees. If any match is found, `loop --status` prints a **WARNING** banner: "proposal references high-trust path `hooks/hooks.json` — review carefully before applying." Best-effort grep, not AST parsing; backend implements. <br>(b) **Manifest `source_path` is advisory, not enforced** — keep architect's pin as-is. Enforcement (diffing operator's commit against manifest's `source_path` and rejecting on mismatch) is **deferred to v1.x** because legitimate proposals routinely touch multiple files. <br>(c) **Runbook caveat (R2)** — operator runbook lists the high-trust subtrees explicitly and tells the operator to verify the *full* commit diff matches the proposal's intent, not just `source_path`. |
| **Acceptance criterion** | (a) Backend test: proposal body containing the literal string `hooks/hooks.json` triggers a `WARNING:` line in `loop --status` output. Property test: 50 random path strings sampled from the high-trust subtree allowlist all trigger the warning. (b) Backend test: proposal body with no high-trust path references produces no `WARNING:` line. (c) Runbook test: `06-learning-loop.md` contains the high-trust subtree list verbatim. |
| **Owner** | `backend` (grep-based scan + warning), `technical-writer` (R2 runbook). |
| **Classification** | **P4-required**. |

### F1.3 — Repudiation: weak audit trail of which proposal was applied

| Field | Value |
| --- | --- |
| **Surface** | `p4-learning-loop-architecture.md §3.4` (`reflection_applied` block on `comparison.json`), §4.2 (`LoopManifestApplied`). |
| **Threat** | **Repudiation** (STRIDE R). Without a structured audit field, the only post-mortem trail is git history (which the operator may amend/rebase/force-push) and the manifest (which operator-equivalent processes can edit per §2 below). An attacker (or careless operator) can claim "I applied proposal X" while the actual commit applied proposal Y, making forensic accountability impossible. The on-disk audit fields architect locked (`proposal_id`, `source_path`, `applied_at`, `plugin_ref_before`, `plugin_ref_after`) close most of this gap, but they are operator-supplied and unsigned. |
| **Severity** | **Medium** — single-operator threat model bounds the realistic exposure; the gap matters when the operator's machine is later forensically examined OR when the deferred website export is taken (audit trail leaves the operator's machine). The architect's `reflection_applied.applied_at` + `plugin_ref_before/after` already make most rewrites self-detectable. |
| **Mitigation** | (a) **`comparison.reflection_applied` MUST include `plugin_ref_before` AND `plugin_ref_after`** — already pinned by architect §3.4; this finding confirms the field set is sufficient for v1 audit. <br>(b) **`run.json.raw_command` of the candidate run includes the `--apply <proposal-id>` argv** — already covered by P3 F4.1's `redactRawCommand` (the proposal-id is a non-secret operator input; the redactor's allowlist passes it through). qa T4 pins this. <br>(c) **`loop --continue` MUST emit a `tool_error`-shaped audit event into `runs/<candidate-id>/events.ndjson`** with `type: "loop_apply"`, `proposal_id`, `plugin_ref_before`, `plugin_ref_after` — at the loop's first action before spawning the candidate runner. This makes the audit trail land in the candidate's `events.ndjson` as well as the manifest. (Architect's manifest fields are the canonical record; the events.ndjson echo is defence-in-depth for forensic re-discoverability.) <br>(d) **Cryptographic signing is deferred to v1.x** — single-operator scope (spec §Audience) does not justify the implementation cost. ADR-006 captures it if a multi-operator deployment ever happens. |
| **Acceptance criterion** | (a) Unit test: `loop --continue` writes a `loop_apply` event line to the candidate's `events.ndjson` containing all four fields. (b) Schema test: `comparison.reflection_applied.plugin_ref_before` and `...plugin_ref_after` are non-empty 7-or-40-char hex strings (matches `git rev-parse` output shape). (c) Manual review at qa-T4 phase-end confirms `events.ndjson` audit event survives end-to-end through capture. |
| **Owner** | `backend` (event emission), `qa` (test pin). |
| **Classification** | **P4-required**. |

### F1.4 — Information disclosure: proposal reads sensitive file and exfiltrates via candidate-run output

| Field | Value |
| --- | --- |
| **Surface** | `p4-learning-loop-architecture.md §6.1` (proposal body is operator-followed instructions; candidate run executes the *modified* plugin). |
| **Threat** | **Information Disclosure** (STRIDE I). A malicious proposal instructs the operator to add a skill body that, when executed in the candidate run, reads `~/.claude/credentials.json` (or `~/.aws/credentials`, `~/.ssh/id_rsa`) and writes the contents into a deliverable file (`report.md`, `events.ndjson` payload) — which is then captured into `runs/<candidate-id>/artifacts/.guild/`, served by `GET /api/runs/:id/artifacts/*`, and snapshotted to the deferred website export (CWE-200, CWE-538). The fresh-fixture clone (ADR-003) does not bound this — `claude` runs as the operator and inherits operator-readable filesystem reach. |
| **Severity** | **High** — direct exfiltration of operator credentials via the captured artifact tree, by way of a proposal the operator chose to apply. P3 F4.2 (stream Transform redactor) catches obvious token shapes in stdout/stderr/events.ndjson, but a proposal-injected skill body can format-encode credentials (base64, hex, line-broken) to evade pattern matching. |
| **Mitigation** | (a) **Apply P3 F4.2's stream Transform redactor verbatim** to the candidate-run capture — already locked; no additional mitigation needed at the redactor layer. <br>(b) **Defence-in-depth: env allowlist enforced for both runs** — P3 F1.3's default-deny env allowlist applies to every `runner.ts` invocation, including the candidate the loop spawns. The loop does NOT append additional env keys. Confirm via test (Q4 below). <br>(c) **`HOME` is forwarded to the subprocess** (P3 F1.3 allowlist) — this is the load-bearing leak surface for `~/.claude/credentials.json`. **Mitigation deferral**: stripping `HOME` would break `claude` CLI auth. Instead, runbook caveat (R3) tells the operator to use a sandbox `HOME` (`HOME=/tmp/sandbox-claude-home npm run benchmark -- loop ...`) for runs against untrusted proposals — same pattern P3 F4.3 documents. <br>(d) **Runbook caveat (R3)** — operator runbook tells the operator: "If you applied a proposal you did not author yourself, run the candidate with a sandbox `HOME`. The runner forwards `HOME` so `claude` can read its credentials; an applied proposal has the same FS reach as you do." |
| **Acceptance criterion** | (a) Q4: integration test sets `process.env.AWS_ACCESS_KEY_ID = "AKIA..."`; runs candidate-run leg of the loop; asserts the env key is **not** present in the candidate subprocess's env (P3 F1.3 allowlist enforcement carries forward). (b) Runbook test: `06-learning-loop.md` contains the sandbox-HOME paragraph verbatim. |
| **Owner** | `backend` (no new code — this finding confirms P3 mitigations carry forward + adds runbook), `qa` (test pin), `technical-writer` (R3). |
| **Classification** | **P4-required**. |

### F1.5 — Denial of service: applied proposal locks up plugin loading

| Field | Value |
| --- | --- |
| **Surface** | `p4-learning-loop-architecture.md §6.1` (proposal body is operator-followed; modifies plugin source). |
| **Threat** | **Denial of Service** (STRIDE D). A proposal instructs the operator to add an infinite loop into a hook script (`hooks/bootstrap.sh`) or a `commands/*.md` body that calls a recursive skill. After apply, every subsequent Claude Code session start (or every `/guild` invocation) hangs the operator's host plugin install — not just the candidate run but the operator's daily workflow (CWE-400 Uncontrolled Resource Consumption). |
| **Severity** | **Medium** — operator-recoverable (revert the commit, restart Claude Code), but the candidate run itself can detect the lockup via the existing 1h cap (P3 F3.1 process-group SIGKILL) so the *loop* is bounded; the host *plugin* is not. The lockup vector is the apply step in the host repo, not the loop itself. |
| **Mitigation** | (a) **Candidate run inherits the 1h cap from P3** — P3 F3.1 (process-group escalation) catches the lockup *inside the candidate run*; the run aborts with `status: "timeout"` and `comparison.json` either omits the `reflection_applied` annotation (per the comparator's mismatched-proposal handling §3.3) or annotates it with `kept: false` if the timeout still produces a comparable score. qa T4 pins both paths. <br>(b) **Host-plugin lockup recovery is operator-side** — runbook caveat (R4): "If `loop --continue` produces a candidate run that times out repeatedly OR your normal `/guild` invocations hang after applying a proposal, revert the commit (`git revert HEAD`) and restart your Claude Code session. The loop does not fix host-plugin lockups; you do." <br>(c) **Pre-apply sanity check is out of v1 scope** — would require shelling out to `bash -n hooks/bootstrap.sh` and similar; mostly heuristic; defer to v1.x. |
| **Acceptance criterion** | (a) Q5: integration test with a candidate-run case configured to spawn a 90-second `sleep` exceeds the case's timeout; assert candidate `run.json.status === "timeout"` and the run is reaped within the SIGKILL escalation window (P3 F3.1 carries forward). (b) Runbook test: `06-learning-loop.md` contains the revert-and-restart paragraph. |
| **Owner** | `backend` (no new code — P3 F3.1 inheritance), `qa` (test pin), `technical-writer` (R4). |
| **Classification** | **P4-required** (test pin), **runbook** (recovery guidance routes to T5). |

### F1.6 — Race: concurrent loop invocations against overlapping baselines

| Field | Value |
| --- | --- |
| **Surface** | `p4-learning-loop-architecture.md §6.1` ("Race conditions — the operator runs `loop --continue` while another `loop --start` is in flight on a different baseline"). |
| **Threat** | **Tampering / Race** (STRIDE T; CWE-362 Concurrent Execution using Shared Resource with Improper Synchronization). Two scenarios: <br>(a) **Same baseline, two concurrent `loop --continue` invocations** — both read the same `awaiting-apply` manifest, both run candidates, both attempt to overwrite `manifest.state = "completed"`. The second-writer-wins; the first candidate's run-id is orphaned. <br>(b) **Concurrent `loop --start` on baseline A while `loop --continue` runs on baseline B** — different baselines, but both invoke `runner.ts`. P3's runner already enforces single-flight via the server lock (`p3-runner-architecture.md §3` + the lockfile under `runs/`); the loop must respect it (architect's note in §6.1: "low-probability risk because each baseline is a fresh fixture"). |
| **Severity** | **Medium** — race window is small (manifest write + runner spawn); single-operator threat model bounds the attacker pool; the failure mode is data corruption (orphaned candidates, lost state transitions) rather than privilege escalation. |
| **Mitigation** | (a) **Per-manifest single-flight lock** — `loop --continue` MUST `fs.openSync(<manifest>, "r+")` and acquire an `fcntl`-style advisory lock (or a `<manifest>.lock` sentinel file written with `wx` flag) before reading `state`. If the lock is held, exit with a clear error: "another `loop --continue` is in flight against `<baseline-run-id>`." Backend chooses sentinel-file approach (portable) over `fcntl` (POSIX-specific). <br>(b) **Loop reuses runner's existing single-flight lock** — architect locks runner reuse; P3's lock under `runs/` (managed by `runner.ts`, not the loop) catches concurrent runner invocations across baselines. The loop does not introduce a second lock at the runner level. <br>(c) **State-transition is atomic** — `loop --continue` writes the new manifest to `<manifest>.tmp` then renames atomically (`fs.renameSync`) over the original. The intermediate state is never visible to a concurrent reader. |
| **Acceptance criterion** | (a) Q6: integration test invokes `loop --continue` twice in parallel against the same baseline (mocked runner stub blocks for 1s); assert exactly one invocation succeeds, the other exits non-zero with the lock-contention error string. (b) Q7: integration test corrupts the temp file write (force kill mid-write); assert the original manifest is intact (atomic rename invariant). |
| **Owner** | `backend` (sentinel-file lock + atomic rename), `qa` (test pin). |
| **Classification** | **P4-required**. |

---

## 2. Two-stage CLI manifest tampering

The manifest at `runs/<baseline-run-id>/loop-manifest.json` is the
on-disk seam between `loop --start` and `loop --continue`. It is
plain JSON; any operator-equivalent process can edit it. Architect's
five hard-reject runtime checks (§4.3 rules 1–5) catch the obvious
tampering shapes; this section pins what those checks must verify
operationally, the file-mode policy, and what is explicitly deferred.

### F2.1 — Tampering: edit between `--start` and `--continue`

| Field | Value |
| --- | --- |
| **Surface** | `p4-learning-loop-architecture.md §6.2` ("attacker with write access to `runs/<baseline-id>/loop-manifest.json` can: add a fake entry to `available_proposals[]` … flip `state` … edit `plugin_ref_before`"). |
| **Threat** | **Tampering** (STRIDE T; CWE-345 Insufficient Verification of Data Authenticity). Three concrete attack shapes: <br>(a) Add a fake `available_proposals[]` entry pointing at a malicious `.md` file the attacker also planted under `runs/<id>/artifacts/.guild/reflections/`. <br>(b) Edit `plugin_ref_before` to match the current `HEAD` so the architect's "ref must have changed" check (§4.3 rule 3) trivially passes — letting `--continue` run without an actual operator commit. <br>(c) Edit `case_slug` to coerce `--continue` to spawn a candidate against a different case than the baseline. |
| **Severity** | **Medium** — single-operator threat model means the attacker is operator-equivalent (not external); but the attacker can be a malicious `npm install` post-install script, a subprocess of a different tool the operator runs, etc. Not negligible. |
| **Mitigation** | Architect's §4.3 rules 1–5 are the runtime checks; this finding pins the **acceptance test set** for each rule + adds two additional checks: <br>(a) **Rule 1 (state) test** — `state == "awaiting-apply"`; reject `completed`, `aborted`, missing, garbage. <br>(b) **Rule 2 (proposal-id) test** — `--apply <id>` ∈ `available_proposals[]`; reject mismatch. **Additional check**: `proposal_id` MUST match `^[a-zA-Z0-9._-]{1,128}$` regex — defends against shell-metacharacter injection if a future code path ever interpolates the id. <br>(c) **Rule 3 (plugin_ref delta) test** — current `HEAD ≠ manifest.plugin_ref_before`; reject identity. **Additional check**: backend re-reads `git rev-parse HEAD` from the host repo (NOT from any field the manifest could lie about) — the comparison's truth source is git, not the manifest. <br>(d) **Rule 4 (case_slug) test** — candidate's loaded case_slug equals manifest's case_slug; reject mismatch. <br>(e) **Rule 5 (schema_version) test** — `schema_version === 1`; reject other values. <br>**Cryptographic signing (HMAC of manifest with a per-run nonce stored in `runs/<id>/run.json`) is DEFERRED-WITH-REASON** for v1: single-operator scope (spec §Audience), the operator owns the FS and can tamper with `runs/<id>/run.json` too. ADR-006 captures the upgrade if multi-operator scope ever lands. |
| **Acceptance criterion** | Five negative-path qa tests pin one rule each; one positive-path test confirms a clean manifest passes. Tests live in `benchmark/tests/loop-manifest-validation.test.ts` (qa T4 lane). Each negative path fixtures a hand-crafted manifest with the specified field tampered, runs `loop --continue --baseline-run-id <fixture-id> --apply <id>`, asserts non-zero exit + a clear error message naming the failed rule. |
| **Owner** | `backend` (rule 1–5 implementation + proposal_id regex + git-truth re-read), `qa` (5 negative-path tests + 1 positive-path test). |
| **Classification** | **P4-required**. Cryptographic signing **deferred-with-reason** (single-operator scope; revisit on multi-operator deployment via ADR-006). |

### F2.2 — Replay: old manifest reused against a different commit

| Field | Value |
| --- | --- |
| **Surface** | `p4-learning-loop-architecture.md §6.2` ("Replay — operator runs `loop --continue` against an old manifest from a different machine that has been moved into `runs/`"). |
| **Threat** | **Replay** (STRIDE — replay is not a STRIDE letter; map to **Tampering** for the integrity violation; CWE-294 Authentication Bypass by Capture-Replay). A manifest from a prior loop (or a different machine) is moved into `runs/<baseline-run-id>/loop-manifest.json` and `--continue` is invoked against the current host repo state. The proposals the manifest names may not exist in the current `runs/<baseline-run-id>/artifacts/.guild/reflections/`; the candidate run executes against an unrelated `plugin_ref` change. |
| **Severity** | **Medium** — coherent same-version replay defeats simple checks; but the architect's rule that `proposal_id` must exist in `available_proposals[]` AND that the proposal's `.md` file must exist under `runs/<id>/artifacts/.guild/reflections/` already catches the obvious case. |
| **Mitigation** | (a) **Existence check on proposal file** — at `--continue` time, before spawning the candidate, backend MUST `fs.statSync(runs/<baseline-id>/artifacts/.guild/reflections/<proposal-id>.md)` and reject if absent. This catches the moved-manifest replay where the `.md` files were not also moved. <br>(b) **`baseline_run_id` cross-check** — the manifest's `baseline_run_id` field MUST equal the directory name `<baseline-run-id>` it lives under. Backend reads the manifest, parses `baseline_run_id`, compares to `path.basename(path.dirname(manifestPath))`; reject mismatch. <br>(c) **Rule 3's `plugin_ref_before ≠ HEAD` check is the primary replay defence** — if the manifest is from a *different* prior loop on the same machine, the current `HEAD` may legitimately equal the manifest's `plugin_ref_before` (operator never actually advanced HEAD between replay attempts) → the architect's rule catches it. If the manifest is from a *different machine* with unrelated git history, `plugin_ref_before` is unlikely to match either way; the existence-check on the proposal `.md` files plus `case_slug` check covers the residual. <br>(d) **Cryptographic per-run nonce binding the manifest to the baseline's `run.json`** — DEFERRED-WITH-REASON; same rationale as F2.1. |
| **Acceptance criterion** | (a) Q8: negative-path test moves a valid manifest to a different baseline directory; assert `--continue` rejects with `baseline_run_id` mismatch. (b) Q9: negative-path test deletes a proposal `.md` file but keeps it in `available_proposals[]`; assert `--continue` rejects with the missing-file error. |
| **Owner** | `backend` (existence + baseline_run_id checks), `qa` (test pin). |
| **Classification** | **P4-required**. Per-run nonce **deferred-with-reason**. |

### F2.3 — Elevation: file mode allows non-owner read/write

| Field | Value |
| --- | --- |
| **Surface** | `p4-learning-loop-architecture.md §6.2` ("Whether the manifest should be made read-only after `loop --start` (filesystem `chmod 0444`) — useful but defeated by `chmod 0644` from any operator-equivalent process"). |
| **Threat** | **Elevation of Privilege / Information Disclosure** (STRIDE E/I; CWE-732 Incorrect Permission Assignment for Critical Resource). A multi-user host (shared dev box, jumpbox) with a default umask of `0022` writes the manifest world-readable. A second local user reads `available_proposals[]` (which leaks the case the operator is benchmarking) and, in a writable-`runs/` configuration, edits the manifest to inject a fake proposal. The single-operator threat model bounds the realistic exposure but the spec does not forbid multi-user hosts. |
| **Severity** | **Low** — defence-in-depth; primary protection is the single-operator NFR (spec §Audience). |
| **Mitigation** | (a) **`loop --start` writes the manifest with mode `0o600`** (owner-read/owner-write only) using `fs.writeFileSync(manifestPath, json, {mode: 0o600})` and a follow-up `fs.chmodSync(manifestPath, 0o600)` (defends against umask interference on platforms where the `mode` option is OR'd with umask). <br>(b) **`loop --continue` writes the updated manifest with the same mode** — backend re-applies `chmod 0o600` after every manifest write. <br>(c) **Manifest is NOT chmod'd to `0o400` after `--start`** — the operator's own `--continue` invocation must be able to write. Architect's note ("`chmod 0444` … defeated by `chmod 0644`") confirms read-only-after-start is not a useful boundary for this threat model. <br>(d) **Runbook caveat (R5)** — operator runbook documents the mode policy and recommends single-user host operation (consistent with spec §Audience). |
| **Acceptance criterion** | (a) Q10: backend test invokes `loop --start` against a fixture; asserts `fs.statSync(manifestPath).mode & 0o777 === 0o600` (or the platform-equivalent value — backend confirms exact mask in T2). (b) Q11: same assertion after `loop --continue`. (c) Runbook test: `06-learning-loop.md` documents the `0o600` policy and the single-user-host recommendation. |
| **Owner** | `backend` (mode application), `qa` (test pin), `technical-writer` (R5). |
| **Classification** | **P4-required**. |

### F2.4 — Information disclosure: `available_proposals[]` leaks operator workflow

| Field | Value |
| --- | --- |
| **Surface** | `p4-learning-loop-architecture.md §6.2` ("the manifest leaks the list of available proposals — fine; they're operator-visible"). |
| **Threat** | **Information Disclosure** (STRIDE I). The manifest `available_proposals[]` carries `summary` (first 160 chars of each proposal body). A reader with FS access to `runs/` learns which proposals the operator is considering, which Cases they are benchmarking, and the high-level reflection direction the plugin is taking. |
| **Severity** | **Low** — operator-visible data; the spec already classifies the entire `runs/` tree as operator-visible (`p3-runner-architecture.md §3.5` artifact tree is served via the API). The threat is no worse than reading `runs/<id>/artifacts/.guild/reflections/*.md` directly. F2.3's `0o600` mode bounds the exposure to the operator only on a properly-configured host. |
| **Mitigation** | F2.3's `0o600` mode is the only mitigation needed at this layer. **No additional redaction of `summary`** — the field's whole purpose is to give the operator a one-line preview. Sanitising it would defeat the ergonomic. |
| **Acceptance criterion** | F2.3's mode tests cover this finding's residual exposure. No separate test. |
| **Owner** | `backend` (no new code; covered by F2.3). |
| **Classification** | **deferred-with-reason** — covered by F2.3's mode policy; no incremental P4 work required. |

### F2.5 — Tampering: `state` field set to a non-canonical value

| Field | Value |
| --- | --- |
| **Surface** | `p4-learning-loop-architecture.md §4.3 rule 1` (state validation), §4.2 (`state` enum). |
| **Threat** | **Tampering** (STRIDE T; CWE-20 Improper Input Validation). An attacker (or careless operator) sets `state` to a value outside the `"awaiting-apply" \| "completed" \| "aborted"` enum (e.g., `"AWAITING-APPLY"` with mixed case, `"completed "` with trailing whitespace, the JSON literal `null`, an unknown string `"in-progress"`). Loose comparison (`!== "completed"`) treats all of these as `"awaiting-apply"`-like, allowing `--continue` to proceed. |
| **Severity** | **Medium** — direct bypass of architect's rule 1 check if the comparison is loose. |
| **Mitigation** | (a) **Backend uses strict enum validation** — TypeScript discriminated-union narrowing AND a runtime check via a `Set<LoopManifestState>` literal: `if (!STATE_SET.has(parsed.state)) throw new Error("invalid state");`. <br>(b) **Whitespace and case sensitivity** — the parser does NOT trim or lowercase the `state` value before comparison. Bytes must match exactly. <br>(c) **Schema validation** — backend uses a JSON-schema validator (Ajv or zod) with `strict: true` on the manifest read path; rejects unknown keys, type coercions, and out-of-enum values in one pass. |
| **Acceptance criterion** | Q12: parameterised test feeds in `"AWAITING-APPLY"`, `"awaiting-apply "`, `null`, `"in-progress"`, `"completed"` (when expecting awaiting-apply) — asserts each is rejected with a clear error. The literal `"awaiting-apply"` passes. |
| **Owner** | `backend` (strict-enum + schema validator), `qa` (parameterised test). |
| **Classification** | **P4-required**. |

---

## 3. `auth_identity_hash` privacy boundary

Architect's §3.4 + §6.3 pin the *interface* (optional string on
`RunJson`, sourced from `GUILD_BENCHMARK_AUTH_HINT`, runner stores
verbatim, no coupling to `claude` CLI auth state). This section pins
the *policy*: the JSON shape, the validation rule, the
behaviour-on-invalid-input, and the redaction-on-leakage policy. The
field design is concrete enough for backend to implement.

### F3.1 — Information disclosure: operator passes a raw credential as the env value

| Field | Value |
| --- | --- |
| **Surface** | `p4-learning-loop-architecture.md §6.3` (architect explicitly forward-references "input validation rule for the env var" to security). |
| **Threat** | **Information Disclosure** (STRIDE I; CWE-200 / CWE-532). The operator (or an automation script the operator runs) sets `GUILD_BENCHMARK_AUTH_HINT=sk-real_anthropic_token_value`. The runner stores it verbatim in `run.json.auth_identity_hash` (per architect's "stores verbatim" pin). `run.json` is then served by `GET /api/runs/:id`, snapshotted to the deferred website export, and routinely shared in bug reports — the credential leaks across all of these vectors. |
| **Severity** | **High** — operator-supplied content lands in a routinely-shared artifact. The single-operator threat model does not bound *exfiltration* threats once `run.json` leaves the machine. |
| **Mitigation** | **Field shape design (concrete, implementable):** <br>**Field name:** `auth_identity_hash` on `RunJson` (optional). <br>**Format:** SHA-256 hex digest, exactly 64 lowercase hexadecimal characters. <br>**Validation regex:** `^[a-f0-9]{64}$`. <br>**Source:** environment variable `GUILD_BENCHMARK_AUTH_HINT`. <br>**Behaviour on valid input:** `run.json.auth_identity_hash = process.env.GUILD_BENCHMARK_AUTH_HINT`. <br>**Behaviour on invalid input** (env var set but does NOT match the regex): <br>(i) `auth_identity_hash` is **omitted** from `run.json` (the field is optional; do not populate). <br>(ii) Runner emits a `tool_error` `EventLine` to `events.ndjson`: `{ts, type: "tool_error", tool: "auth_hint", exit_code: 1}`. The `EventLine` discriminated union does not currently carry a `reason:` field on `tool_error` — backend confirms whether to extend the union or piggy-back on `exit_code` semantics in T2; **either way, the event MUST NOT include the offending env value** (which may itself be a credential). <br>(iii) Runner emits a single line on its own stderr: `WARNING: GUILD_BENCHMARK_AUTH_HINT does not match expected sha256-hex format; auth_identity_hash unset`. The line MUST NOT include the value. <br>**Behaviour when env unset:** `auth_identity_hash` is omitted; no event, no warning. <br>**No coupling to `claude` CLI auth state:** runner does NOT call `claude auth status`, does NOT read `~/.claude/credentials.json`, does NOT inspect `ANTHROPIC_API_KEY`. The hash is fully operator-controlled and operator-supplied. <br>**Redaction-on-leakage policy:** if a future code path were to log `process.env.GUILD_BENCHMARK_AUTH_HINT` verbatim (it should not), P3 F4.2's stream Transform redactor is the backstop — the hash is non-secret per design (it's already a one-way digest) but the *raw* env value, if it slipped through validation, would match P3 F4.2's `sk-...` / `Bearer ...` patterns and get redacted. |
| **Acceptance criterion** | (a) Q13: positive test — `process.env.GUILD_BENCHMARK_AUTH_HINT = "a".repeat(64)` (valid sha256-hex shape); assert `run.json.auth_identity_hash === "aaaa...aa"` and no `tool_error` event. (b) Q14: negative test — env value is `"sk-test_anthropic_credential"`; assert `run.json` does NOT contain `auth_identity_hash`, a `tool_error` event with `tool: "auth_hint"` is present, and the env value does **not** appear in `run.json`, `events.ndjson`, or any captured log. (c) Q15: negative test — env value is `64` lowercase letters but contains a non-hex character (`a`...`a`+`g`); assert rejection same as (b). (d) Q16: negative test — env value is uppercase hex (`A`*64); assert rejection (regex enforces lowercase). (e) Q17: env unset — assert no `auth_identity_hash` field, no event, no warning. |
| **Owner** | `backend` (field + regex + warning + event), `qa` (test pin). |
| **Classification** | **P4-required**. |

### F3.2 — Repudiation / forensic-correlation: hash format determinism

| Field | Value |
| --- | --- |
| **Surface** | `p4-learning-loop-architecture.md §3.4` ("forensic correlation across runs that share an authenticated identity"). |
| **Threat** | **Repudiation** (STRIDE R, in the audit-trail sense). If the field's format is nondeterministic across runs (e.g., the operator hashes the same identity-token twice and gets different outputs because of a salting bug), forensic correlation across sessions breaks — the audit-trail purpose of the field is defeated. |
| **Severity** | **Low** — design pin, not a runtime threat. The validation regex `^[a-f0-9]{64}$` is itself the determinism enforcement; if the operator follows the documented `echo -n <identity-token> \| sha256sum` pattern, the output is bit-deterministic by SHA-256's definition. |
| **Mitigation** | (a) **Documentation (R6)** — operator runbook documents the exact computation: `echo -n "<my-identity-token>" \| sha256sum \| awk '{print $1}'`. The `-n` matters (no trailing newline). <br>(b) **Documentation operator caveat (R7)** — operator chooses what "identity-token" means (random per-developer UUID committed to a private notes file, hash of work email, etc.). The runner does not prescribe; the runner only stores. <br>(c) **No re-hashing by runner** — architect's "stores verbatim" pin is the policy; backend confirms by test (Q18 below). |
| **Acceptance criterion** | (a) Q18: positive test feeds the env value `"deadbeef" * 8` (a 64-char hex string); assert `run.json.auth_identity_hash` equals the env value byte-for-byte (no transformation, no re-hashing). (b) Runbook test: `06-learning-loop.md` (or a sibling section) contains the `echo -n ... \| sha256sum` recipe verbatim and the operator-chooses-meaning caveat. |
| **Owner** | `backend` (no transformation), `qa` (test pin), `technical-writer` (R6 + R7). |
| **Classification** | **P4-required** (test pin) + **runbook** (R6, R7 routed to T5). |

### F3.3 — Tampering: operator passes a wrong/different identity hash

| Field | Value |
| --- | --- |
| **Surface** | `p4-learning-loop-architecture.md §3.4` ("an attacker tampers with the env var to claim a different identity — out of scope for v1 (operator owns the env)"). |
| **Threat** | **Tampering** (STRIDE T). An attacker with operator-equivalent shell access exports a different `GUILD_BENCHMARK_AUTH_HINT` value to mis-attribute a run to a different identity. |
| **Severity** | **Low** — the attacker is operator-equivalent in this threat model (single-operator NFR per spec §Audience); they can also tamper with `~/.claude/credentials.json`, `runs/<id>/run.json` directly, or the host repo's git history. The hash field is no weaker than the surrounding artifacts. |
| **Mitigation** | (a) **Architectural acknowledgement** — the field is forensic-only; it does not authenticate, it does not authorise. Runbook documents this clearly (R8). <br>(b) **No cryptographic binding** — the hash is not signed, not linked to `claude` CLI's auth state, not verified against any external service. v1 scope. |
| **Acceptance criterion** | Runbook entry only. No automated test (the threat is operator-equivalent and out of v1 scope to mitigate). |
| **Owner** | `technical-writer` (R8). |
| **Classification** | **deferred-with-reason** — operator-equivalent threat; out of v1 single-operator scope. Document the boundary; do not pretend to enforce it. |

---

## 4. Keep/discard threshold gaming

Architect locked the rule (`delta >= 2.0 AND for all k:
per_component_delta[k].delta >= -1.0`) and forward-referenced
threshold gaming to security as a fourth concern. This is a single
finding because the threat shape is narrow.

### F4.1 — Tampering: malicious proposal designed to game the keep/discard rule

| Field | Value |
| --- | --- |
| **Surface** | `p4-learning-loop-architecture.md §5.4` ("a malicious proposal could be designed to game the threshold by exactly the keep_threshold while regressing on a metric Guild does not currently measure"). |
| **Threat** | **Tampering** (STRIDE T; CWE-693 Protection Mechanism Failure — the keep/discard rule is the protection mechanism the autoresearch loop relies on). A proposal is designed to: (a) clear `delta >= 2.0` by exactly the threshold; (b) hold all six tracked components within `>= -1.0`; while (c) regressing severely on something Guild's six components don't measure (e.g., user trust, latency under load, host-machine resource consumption). The aggregate `kept: true` looks benign, but the loop has accepted a regression the metric can't see. |
| **Severity** | **Low** — single-operator local tool; the operator is the human-in-loop reviewer, has the per-component delta in the UI (T3-frontend's lane already plans the per-component delta table), and has git-revert on the candidate commit if the result feels off. The threat is real but operator-attentiveness mitigates it without code support. |
| **Mitigation** | (a) **UI per-component delta surfacing is REQUIRED, not optional** — T3-frontend's plan already includes the per-component delta table on ComparePage. This finding pins it as a P4-required acceptance: the badge showing `kept` MUST be rendered alongside (not in place of) the per-component delta breakdown. **Routed to qa as Q19**: ComparePage rendering test asserts both elements are present whenever `comparison.reflection_applied` is set. <br>(b) **Operator runbook caveat (R9 — primary mitigation)** — runbook explicitly tells the operator: "Don't trust the aggregate; review per-component deltas, especially for proposals that suspiciously hit the keep_threshold exactly. A `kept: true` annotation is a hint, not a verdict — you remain the human-in-loop reviewer." This is the load-bearing mitigation; the rule is intentionally simple per architect §5.4. <br>(c) **No code-level mitigation** — adding per-case "untracked-metric guards" would be premature; the autoresearch pattern explicitly trusts the operator's review of the comparison. ADR-006 captures the addition if the threat ever materialises in practice (e.g., the operator notices a kept proposal that regresses a known untracked dimension). |
| **Acceptance criterion** | (a) Q19: ComparePage rendering test asserts the per-component delta table is present whenever `comparison.reflection_applied` is set; the table renders all six `COMPONENT_KEYS` rows; the `kept` badge is rendered adjacent to (not replacing) the table. (b) Runbook test: `06-learning-loop.md` contains the "kept is a hint, not a verdict" paragraph verbatim. |
| **Owner** | `qa` (test pin — frontend rendering of per-component delta), `technical-writer` (R9 runbook). |
| **Classification** | **P4-required** (UI rendering test) + **runbook-primary** (R9 routed to T5). |

---

## 5. Mitigation summary table

| #    | Surface (`§` of `p4-learning-loop-architecture.md` unless noted) | Threat (STRIDE)                                              | Sev    | Mitigation (one-line)                                                                                       | Owner                                | Class                                  |
| ---- | ----------------------------------------------------------------- | ------------------------------------------------------------ | ------ | ----------------------------------------------------------------------------------------------------------- | ------------------------------------ | -------------------------------------- |
| F1.1 | §6.1                                                              | T — proposal injects code into plugin source                 | High   | Full proposal body in `--status`; `--diff` flag; runbook (review as untrusted PR)                           | backend, technical-writer, qa        | P4-required                            |
| F1.2 | §6.1                                                              | E — proposal modifies high-trust file (`hooks/`, `commands/`) | High   | High-trust path grep + WARNING in `--status`; runbook lists subtree allowlist                              | backend, technical-writer            | P4-required                            |
| F1.3 | §3.4, §4.2                                                        | R — weak audit trail                                         | Medium | Pin `plugin_ref_before/after`; emit `loop_apply` event into candidate's `events.ndjson`                    | backend, qa                          | P4-required                            |
| F1.4 | §6.1                                                              | I — proposal exfiltrates credentials via candidate output    | High   | P3 F4.2 redactor + P3 F1.3 env allowlist carry forward; runbook (`HOME=` sandbox)                          | backend, technical-writer, qa        | P4-required                            |
| F1.5 | §6.1                                                              | D — proposal locks up plugin loading                         | Medium | P3 F3.1 (process-group SIGKILL) carries forward; runbook (revert + restart)                                | backend, qa, technical-writer        | P4-required                            |
| F1.6 | §6.1                                                              | T/Race — concurrent loop invocations                         | Medium | Per-manifest sentinel-file lock + atomic-rename writes; reuse runner's single-flight                       | backend, qa                          | P4-required                            |
| F2.1 | §6.2, §4.3                                                        | T — manifest edit between calls                              | Medium | Strict 5-rule validation + `proposal_id` regex; re-read git as truth source; HMAC deferred                | backend, qa                          | P4-required (HMAC deferred)            |
| F2.2 | §6.2                                                              | T/Replay — stale or moved manifest                           | Medium | Existence check on proposal `.md`; `baseline_run_id` ↔ dirname cross-check                                  | backend, qa                          | P4-required                            |
| F2.3 | §6.2                                                              | E/I — file mode allows non-owner read                        | Low    | `loop --start` and `--continue` write manifest with mode `0o600`                                            | backend, qa, technical-writer        | P4-required                            |
| F2.4 | §6.2                                                              | I — `available_proposals[]` summary leaks                    | Low    | Covered by F2.3's `0o600` mode; no incremental work                                                         | backend                              | deferred-with-reason                   |
| F2.5 | §4.3 rule 1, §4.2                                                 | T — non-canonical `state` value                              | Medium | Strict enum + schema validator (Ajv/zod); no trim/lowercase                                                 | backend, qa                          | P4-required                            |
| F3.1 | §6.3, §3.4                                                        | I — operator passes raw credential as env value              | High   | Validate `^[a-f0-9]{64}$`; on mismatch, emit `tool_error` + omit field; never log the value                | backend, qa                          | P4-required                            |
| F3.2 | §3.4                                                              | R — non-deterministic hash format                            | Low    | Doc `echo -n ... \| sha256sum`; assert no runner-side transformation                                        | backend, qa, technical-writer        | P4-required (test) + runbook           |
| F3.3 | §3.4                                                              | T — operator passes a wrong identity hash                    | Low    | Forensic-only field; runbook documents the boundary                                                         | technical-writer                     | deferred-with-reason                   |
| F4.1 | §5.4                                                              | T — proposal games the keep/discard rule                     | Low    | UI per-component delta table required; runbook ("kept is a hint, not a verdict")                            | qa, technical-writer                 | P4-required (UI test) + runbook        |

### Counts

- **Total findings:** 15
- **By severity:** **High = 4** · Medium = 6 · Low = 5
  - High: F1.1, F1.2, F1.4, F3.1.
  - Medium: F1.3, F1.5, F1.6, F2.1, F2.2, F2.5.
  - Low: F2.3, F2.4, F3.2, F3.3, F4.1.
- **By classification:** **P4-required = 12** · deferred-with-reason = 3
  - **High-severity deferred:** **0** — every High-severity finding is
    P4-required. Consistent with P3 T6 discipline; no sandbagging.
- **Carries forward unchanged from P3 (cited):** F1.4 leans on
  P3 F4.2 + P3 F1.3; F1.5 leans on P3 F3.1; F3.1's redaction-on-leakage
  backstop is P3 F4.2. No P3 mitigation is changed by this review.

### Architect's surfaces — closure

| Architect §                     | Finding(s)              | Verdict                                                                                            |
| ------------------------------- | ----------------------- | -------------------------------------------------------------------------------------------------- |
| §6.1 Reflection-apply file-write | F1.1–F1.6 (all 6 STRIDE) | All STRIDE categories pinned; T (F1.1) and E (F1.2) and I (F1.4) are High and **P4-required**. R (F1.3), D (F1.5), Race (F1.6) are Medium and **P4-required**. |
| §6.2 Manifest tampering          | F2.1–F2.5               | All five sub-shapes covered; cryptographic signing (architect's deferred question) **deferred-with-reason** for v1 single-operator scope. |
| §6.3 / §3.4 `auth_identity_hash` | F3.1–F3.3               | Field shape design pinned: `^[a-f0-9]{64}$`; validate-or-skip behaviour pinned; documentation pinned in R6/R7/R8. **No coupling to `claude` CLI auth state** — confirmed by Q18 test. |
| §5.4 Threshold gaming            | F4.1                    | Low severity; runbook-primary mitigation per architect's guidance; UI per-component delta is the load-bearing technical mitigation (qa pins). |

All four architect-named surfaces have explicit findings with
mitigations. None silently skipped. None sandbagged.

---

## References

### Internal (this repo)

- `benchmark/plans/p4-learning-loop-architecture.md §3.4 / §4 / §5 / §6` — primary upstream input; the surfaces named in §6 and §5.4 are the threat-modelling targets.
- `benchmark/plans/adr-005-learning-loop-orchestrator.md §Decision` — locks Option A (two-stage CLI); commitments 5 (loop never writes plugin source) and 6 (`loop.ts` is the only new source file; runner.ts + compare.ts reused unchanged) bound the threat surface this review covers.
- `benchmark/plans/security-review.md` (P3 — locked) — surfaces M1–M16 carry forward unchanged. Specifically cited: P3 F1.3 (env allowlist) → F1.4 here; P3 F3.1 (process groups) → F1.5 here; P3 F4.2 (stream Transform redactor) → F1.4 + F3.1 backstop here.
- `benchmark/plans/p3-runner-architecture.md` — runner contract reused by the loop; no change.
- `benchmark/plans/adr-003-host-repo-vs-fresh-fixture.md` — fresh-fixture cwd model bounds candidate-run runtime damage but NOT host-repo source-tree commits (F1.1, F1.4 acknowledge).
- `benchmark/plans/adr-004-runner-process-group-signaling.md` — process-group escalation carried forward to the loop's candidate run (F1.5 inherits).
- `benchmark/plans/adr-001-runner-ui-boundary.md §Decision (commitment 4)` — `127.0.0.1`-only server binding; **confirmed unchanged by P4** (the loop adds no HTTP routes per ADR-005 §Decision commitment 2).
- `benchmark/src/types.ts §RunJson` — extended by the `auth_identity_hash?` optional field per F3.1.
- `benchmark/src/types.ts §EventLine` — `tool_error` discriminated-union member referenced by F3.1's invalid-input behaviour; backend confirms whether to extend with `reason?` in T2.

### External standards

- **OWASP Top 10 (2021)**:
  - **A03:2021 Injection** — F1.1 (proposal-injected code), F2.5 (state field validation).
  - **A05:2021 Security Misconfiguration** — F2.3 (file mode), F3.1 (env-var-as-credential misuse).
  - **A08:2021 Software and Data Integrity Failures** — F2.1 (manifest tampering), F2.2 (replay).
  - **A09:2021 Security Logging and Monitoring Failures** — F1.3 (audit trail), F3.1 (logging the unredacted env value).
- **CWE references**:
  - **CWE-20** Improper Input Validation — F2.5.
  - **CWE-22** Path Traversal — covered by P3 F2.1 (carries forward; no P4 incremental).
  - **CWE-94** Improper Control of Generation of Code (Code Injection) — F1.1.
  - **CWE-200** Information Exposure — F1.4, F2.4, F3.1.
  - **CWE-294** Authentication Bypass by Capture-Replay — F2.2.
  - **CWE-345** Insufficient Verification of Data Authenticity — F2.1.
  - **CWE-362** Concurrent Execution using Shared Resource (Race Condition) — F1.6.
  - **CWE-400** Uncontrolled Resource Consumption — F1.5.
  - **CWE-532** Insertion of Sensitive Information into Log File — F3.1.
  - **CWE-538** Insertion of Sensitive Information into Externally-Accessible File — F1.4.
  - **CWE-693** Protection Mechanism Failure — F4.1.
  - **CWE-732** Incorrect Permission Assignment for Critical Resource — F2.3.
  - **CWE-829** Inclusion of Functionality from Untrusted Control Sphere — F1.1.

### Spec / process

- `.guild/spec/benchmark-factory.md §Audience` — single-operator NFR; bounds threat models for F1.6, F2.1, F2.3, F3.3.
- `.guild/spec/benchmark-factory.md §Constraints` — 1h cap (carries forward via P3 F3.1; F1.5 inherits).
- `.guild/plan/benchmark-factory-p4.md` — phase plan; this review is the T6 deliverable.
- `guild-plan.md §6.4` — engineering-group principles; evidence rule applied (every finding carries an acceptance criterion).
- `guild-plan.md §10.3` — decision-routing rule; cryptographic-signing deferral is a v1.x candidate for ADR-006 if multi-operator scope ever lands.
