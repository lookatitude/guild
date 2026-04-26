---
type: security-review
slug: p3-runner-surface
phase: P3
status: accepted
owner: security
reviewed_at: 2026-04-26
upstream:
  - benchmark/plans/p3-runner-architecture.md
  - benchmark/plans/adr-003-host-repo-vs-fresh-fixture.md
  - benchmark/plans/adr-001-runner-ui-boundary.md
  - benchmark/plans/01-architecture.md
  - benchmark/src/types.ts
---

# P3 Runner — Security Review

> **Scope.** Threat models the live-runner surface architect locked in
> `p3-runner-architecture.md` and `adr-003-host-repo-vs-fresh-fixture.md`.
> Phase-scoped: P3 runner only. Out of scope: P1 importer/comparator/
> scorer surfaces, P2 server endpoints (already locked at
> `127.0.0.1`-only by ADR-001 §Decision — confirmed unchanged), P4
> reflection. Each finding has 7 columns (Surface · Threat · Severity ·
> Mitigation · Acceptance · Owner · Classification) and STRIDE
> categorisation where it fits. Mitigations are concrete and
> implementable; backend's T2 implements every `P3-required` row before
> the runner ships.

> **What this document does NOT do.** It does not modify any locked
> file (`p3-runner-architecture.md`, `adr-001`, `adr-003`,
> `01-architecture.md`, `p2-ui-architecture.md`). It does not write
> implementation code. It produces *requirements* + *acceptance
> criteria*; backend (T2) writes the code, qa (T4) pins the tests,
> technical-writer (T5) carries the runbook prose.

> **Architect's 6 forward-reference points** from
> `p3-runner-architecture.md §5` are addressed inline below; index for
> reviewer convenience:
> - FR1 (env allowlist, `§2.4`) → **F1.3**.
> - FR2 (log filenames, `§2.5` + `§3.4`) → **F2.6**.
> - FR3 (orphaned grandchildren, `§2.6`) → **F3.1**.
> - FR4 (path-resolution policy, `§3.4`) → **F2.1**.
> - FR5 (symlink refusal timing, `§3.4`) → **F2.2**.
> - FR6 (prompt-content sanitisation, `§4.5`) → **F4.5** (and **F4.2**
>   for the structured-output side).

---

## 1. Subprocess invocation

The `child_process.spawn` invocation contract locked in
`p3-runner-architecture.md §2` is sound at the primitive level
(`shell: false`, allowlisted env, fresh-fixture cwd). This section
formalises the surrounding guards so a future refactor cannot regress
into command injection, shell interpolation, or credential leakage.

### F1.1 — `shell: true` regression (defense-in-depth)

| Field | Value |
| --- | --- |
| **Surface** | `p3-runner-architecture.md §2.1` (rejected `exec` on shell-injection grounds), `§2.2` (`shell: false` non-negotiable). |
| **Threat** | **Tampering / Elevation of Privilege** (STRIDE T/E). A future refactor could accidentally enable `shell: true`; combined with the verbatim-prompt-capture invariant (`§4.5`), operator-supplied prompt content would be interpreted as shell metacharacters (CWE-78 OS Command Injection). |
| **Severity** | **High** — the prompt is untrusted free text, the cwd is a fresh fixture, the env carries `ANTHROPIC_API_KEY`; a single regression turns the runner into an arbitrary-shell-execution surface. |
| **Mitigation** | Two layers: (a) **runtime assertion** in the spawn wrapper — `if (opts.shell) throw new Error("shell:true forbidden");` immediately before `child_process.spawn`. (b) **lint rule** banning `shell:true` literal in `runner.ts`; an ESLint custom rule (or a grep-based pre-commit check) tied to the file path. |
| **Acceptance criterion** | Unit test asserts the wrapper throws when called with `shell: true`. Integration test inspects the spawn call's options object via a stub and asserts `shell === false` explicitly. Lint rule fires CI on any `shell:\s*true` literal under `benchmark/src/runner.ts`. |
| **Owner** | `backend` (assertion + wrapper), `qa` (test pin), `devops` (lint rule — out of P3 if no CI yet; backstop with grep test). |
| **Classification** | **P3-required**. |

### F1.2 — Argument injection via string-built argv

| Field | Value |
| --- | --- |
| **Surface** | `p3-runner-architecture.md §2.3` (argv shape — backend's call in T2). |
| **Threat** | **Tampering** (STRIDE T). If backend builds argv as `${binary} ${flags} ${promptPath}` and splits on whitespace, a path with spaces or quote characters splits/escapes into adjacent argv slots (CWE-88 Argument Injection). |
| **Severity** | **High** — directly turns `--prompt-file <path>` into arbitrary `claude` flags chosen by the path string. |
| **Mitigation** | Argv is `string[]`, never built by string concatenation. Type signature: `function buildArgv(case: Case, ctx: RunCtx): string[];`. Runtime invariant: `assert(Array.isArray(argv) && argv.every(a => typeof a === "string" && !a.includes("\0")));`. NUL-byte rejection is required because Node's `spawn` on POSIX silently truncates argv strings at the first `\0` (CWE-158). |
| **Acceptance criterion** | Type-level test pins the return type as `string[]`. Unit test passes a Case with a fixture path containing a space, a quote, and a NUL byte; asserts the path lands in exactly one argv slot and the NUL-byte case throws before spawn. |
| **Owner** | `backend`, `qa` (test pin). |
| **Classification** | **P3-required**. |

### F1.3 — Environment-variable leakage to subprocess (FR1)

| Field | Value |
| --- | --- |
| **Surface** | `p3-runner-architecture.md §2.4` (architect drops a few known leaks; security formalises default-deny). |
| **Threat** | **Information Disclosure** (STRIDE I). `claude` runs operator-supplied case prompts; the subprocess inherits whatever env the parent forwards. With an inherit-by-default model, prompts can read or exfiltrate `AWS_ACCESS_KEY_ID`, `STRIPE_API_KEY`, `DATABASE_URL`, `GITHUB_TOKEN`, etc., either by the model echoing them back into the captured stdout/stderr or by the model invoking a tool that uses them (CWE-200, CWE-538). |
| **Severity** | **High** — direct exploit path that reveals operator credentials to the captured artifact tree (which is then served by the P2 pass-through endpoint and snapshotted by the deferred website export). |
| **Mitigation** | **Default-deny allowlist.** Backend builds the subprocess env from an explicit allowlist; nothing is forwarded by default. Minimum allow set (P3): `PATH`, `HOME`, `USER`, `LOGNAME`, `LANG`, `LC_ALL`, `LC_CTYPE`, `LC_MESSAGES`, `TZ`, `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, `XDG_CACHE_HOME`, `ANTHROPIC_API_KEY`, plus any env key matching `/^(ANTHROPIC|CLAUDE)_[A-Z0-9_]+$/` (configuration vars `claude` reads). **Explicitly excluded** even if matched by glob: `*_PASSWORD`, `*_SECRET` (anything matching). The allowlist is encoded as a constant array in `runner.ts`; modifications are PR-reviewed. `PATH` is a leak surface in its own right — see F1.4. |
| **Acceptance criterion** | Unit test stubs `child_process.spawn`, captures the `env` argument, sets `process.env.FAKE_TOKEN = "leak-me"` + `process.env.AWS_ACCESS_KEY_ID = "AKIA..."` + `process.env.GITHUB_TOKEN = "ghp_..."`, asserts none of those keys are present in the subprocess env. Asserts `ANTHROPIC_API_KEY` and `CLAUDE_*` are present when set. Asserts the env Map's size equals the allowlist size + matched `CLAUDE_*` keys, no more. |
| **Owner** | `backend` (allowlist + wrapper), `qa` (negative test), `technical-writer` (runbook section enumerating the list). |
| **Classification** | **P3-required**. |

### F1.4 — `PATH` manipulation / untrusted search path

| Field | Value |
| --- | --- |
| **Surface** | `p3-runner-architecture.md §2.2` (`claude` resolved from `$PATH`, not absolute path), `§2.4` (`PATH` forwarded). |
| **Threat** | **Tampering / Elevation of Privilege** (STRIDE T/E). If the operator's `$PATH` includes a writable or attacker-controlled directory (`/tmp/bin`, `.`, a stale `node_modules/.bin` from a malicious package), a binary named `claude` placed there resolves first (CWE-426 Untrusted Search Path). The runner happily executes it as the operator. |
| **Severity** | **Medium** — operator-misconfiguration-dependent, but real and catastrophic when it fires (arbitrary code as the operator with the operator's auth env). |
| **Mitigation** | At runner start: (a) resolve `claude` once via a `which`-equivalent that walks `$PATH` and returns the absolute path of the first match; (b) record the resolved absolute path as the spawn binary AND in `run.json.raw_command` (matches `§3.5` audit field); (c) **refuse to start** if the resolved path is under `/tmp`, `runs/<id>/_workspace/`, or any directory containing `..` after normalisation. Document a runbook caveat that operators verify `which claude` matches their expected install root (`/usr/local/bin`, `~/.bun/bin`, `/opt/homebrew/bin`). The "refuse to start" heuristic fires only on obvious tampering shapes; a comprehensive PATH lockdown is out of P3 scope (operator-env concern). |
| **Acceptance criterion** | Integration test sets `PATH=./fake-bin:$PATH` with `./fake-bin/claude` as a shim; asserts the runner refuses with a clear error mentioning the resolved path. Unit test asserts the resolved absolute path is what gets passed to `child_process.spawn` (not the bare string `"claude"`). |
| **Owner** | `backend` (resolution + assertion), `technical-writer` (runbook caveat). |
| **Classification** | **P3-required** for the resolution + audit-log step. The "refuse on suspicious PATH" heuristic is **deferred-with-reason** (operator-environment concern; runbook caveat is the P3 scope). |

### F1.5 — Prompt content visible in process listings

| Field | Value |
| --- | --- |
| **Surface** | `p3-runner-architecture.md §2.3` ("Prompt is passed by file or stdin, not as a positional argument"). |
| **Threat** | **Information Disclosure** (STRIDE I). If backend regresses and passes the prompt as positional argv, the prompt — which may contain operator-supplied free text including embedded secrets per F4.5 — appears in `/proc/<pid>/cmdline` and `ps -ef` for any local user (CWE-200). |
| **Severity** | **Medium** — primary spec audience is single-operator workstations; multi-user hosts (shared dev box, jumpbox) elevate the impact. |
| **Mitigation** | Runtime assertion in the spawn wrapper: no argv element exceeds `2048` bytes (prompts are typically larger; this is a heuristic backstop), AND no argv element contains the literal case prompt's first 64 bytes. If either fires, throw before spawn. The primary control is the contract in `§2.3` — pass via `--prompt-file <path>` or stdin; the assertion catches regression. |
| **Acceptance criterion** | Unit test: build argv with a 4KB Case prompt; assert no argv element contains the prompt prefix; assert prompt path was written to a file under `_workspace/` and that file is what's referenced in argv. |
| **Owner** | `backend`, `qa` (test pin). |
| **Classification** | **P3-required**. |

---

## 2. Artifact capture

Architect's `§3.4` locks the *interface* (compute → `path.relative`
verify → refuse → log) and `§3.3` locks the *capture mode* (`fs.cp`
of the post-run `_workspace/.guild/` tree). This section locks the
*policy*: the concrete checklist backend implements at every write
site, the symlink-handling timing, and the cross-platform escape
shapes.

### F2.1 — Path traversal in destination resolution (FR4)

| Field | Value |
| --- | --- |
| **Surface** | `p3-runner-architecture.md §3.4` (verify-before-write pattern; security formalises the checklist). |
| **Threat** | **Tampering** (STRIDE T). A subprocess-emitted file path containing `..` segments resolves outside `runs/<id>/artifacts/`, allowing the captured tree to overwrite arbitrary files the runner has write access to (CWE-22 Path Traversal). |
| **Severity** | **High** — without the mitigation. Architect's design already mitigates; this finding pins the checklist + acceptance test set so the mitigation cannot drift. |
| **Mitigation** | **Five-rule checklist applied at every `fs.cp` / `fs.write` site** in `runner.ts` for paths derived from subprocess output: <br>1. Normalise input via `path.normalize`; strip leading `/`, `\\`, `\\?\`, and any drive-letter prefix (`[A-Za-z]:`) before joining. <br>2. Compute target via `path.resolve(artifactsRoot, ...rel)`. <br>3. Verify `const r = path.relative(artifactsRoot, target)` does **not** start with `..` (segment-aware, not string-prefix-aware) and is **not** absolute. <br>4. **Backstop check**: assert `target === artifactsRoot || target.startsWith(artifactsRoot + path.sep)` — covers case-insensitive APFS edge cases where `path.relative` returns empty for resolved-equal paths in different casings. <br>5. On any rule failure, refuse the write and emit a `tool_error` `EventLine` with the original relative path (matches `§3.4 rule 4`). <br>The five rules apply to **destination paths** only (where the runner writes); the source side (`_workspace/`) is the subprocess's writable surface and is bounded by ADR-003's fresh-fixture model. |
| **Acceptance criterion** | (a) Unit-test fixtures: relative paths `../escape`, `foo/../../bar`, `foo/bar/../../../escape`, absolute `/etc/passwd`, Windows `C:\Windows`, UNC `\\\\evil\\share`, drive-letter `C:foo`, `\\?\C:\foo` — every input is refused with a `tool_error` event. (b) Property test (qa `guild:qa-property-based-tests`): generate 100 random relpath strings biased toward `..` segments; assert all are either accepted (target under `artifactsRoot`) or refused, never silently writing outside. |
| **Owner** | `backend`, `qa` (property-based pin). |
| **Classification** | **P3-required**. |

### F2.2 — Symlink escape (FR5)

| Field | Value |
| --- | --- |
| **Surface** | `p3-runner-architecture.md §3.3` (`fs.cp({dereference: false})`), `§3.4 rule 3` ("symlink policy locks the *interface* here; security locks the *policy*"). |
| **Threat** | **Tampering / Information Disclosure** (STRIDE T/I). `fs.cp(..., {dereference: false})` preserves a symlink as a symlink at copy time, so the *capture step* doesn't escape. **But** any consumer that follows the symlink — the P2 pass-through endpoint `GET /api/runs/:id/artifacts/*`, a future archival tool, an operator's `cat artifacts/foo`, the deferred website export — does follow it and reads outside `artifacts/` (CWE-59 Link Resolution Before File Access). |
| **Severity** | **High** — operator-readable filesystem exfiltration via the UI/API; a malicious case can plant `_workspace/.guild/runs/X/peek -> /etc/passwd` and subsequent reads expose host content. |
| **Mitigation** | **Refuse symlinks at capture time, not at server time.** Walk `_workspace/.guild/` recursively before `fs.cp` and `fs.lstat` each entry; if `lstatResult.isSymbolicLink()`, log a `tool_error` `EventLine` with the link target (read via `fs.readlink`) and **skip the entry**. Do not preserve, do not follow. The walk runs after the subprocess has exited (per §3.3), so there is no concurrent writer; lstat-then-skip is race-free in this window. **Defense in depth:** the `safeJoinUnder` helper in `benchmark/src/server.ts` (the existing P2 server-side guard) remains as a backstop for any consumer that bypasses the API. The architect's `dereference: false` setting is *kept* in case a future policy change permits selectively allowed symlinks; security's policy as of P3 is *refuse all*. <br><br>**Why lstat-pre-walk over `O_NOFOLLOW`:** Node's `fs.cp` recursive copy does not surface `O_NOFOLLOW` per-entry; the explicit pre-walk is the portable path and gives us the `tool_error` event for free. |
| **Acceptance criterion** | (a) Unit test: fixture contains `_workspace/.guild/runs/abc/peek -> /etc/passwd`; runner refuses, emits `tool_error{tool:"capture", reason:"symlink-refused", path:"runs/abc/peek", target:"/etc/passwd"}`, and **no symlink appears under `runs/<id>/artifacts/`**. (b) Edge test: dangling symlink (`peek -> /nonexistent`) is also refused with the same event shape. (c) Edge test: directory symlink (`runs -> /var/log`) is refused, no recursion through it. |
| **Owner** | `backend`, `qa` (test pin). |
| **Classification** | **P3-required**. |

### F2.3 — TOCTOU between path verify and write

| Field | Value |
| --- | --- |
| **Surface** | `p3-runner-architecture.md §3.4` (verify-then-write window). |
| **Threat** | **Tampering** (STRIDE T). Between `path.relative` verification and the `fs.cp` write call, a concurrent writer could swap a file for a symlink (CWE-367 TOCTOU). |
| **Severity** | **Low** — the only post-exit writer in scope is the runner itself (`§3.2`: "no during-run capture" + subprocess has exited before capture begins). The race window has no attacker present in the single-operator threat model. |
| **Mitigation** | (a) Capture is single-pass; once §3.3 begins, the runner does not re-verify and re-write. (b) `fs.cp` is invoked with `errorOnExist: true` (already locked in §3.3) so unexpected pre-existing entries error out rather than silently overwrite. (c) Code-review checklist: any future expansion of capture (e.g., a streaming watcher) MUST re-evaluate this finding. |
| **Acceptance criterion** | Code-review checklist; no separate test (race window not reachable in the threat model). |
| **Owner** | `backend` (code review). |
| **Classification** | **deferred-with-reason** — race window not reachable post-subprocess-exit in the single-operator threat model; revisit if a streaming-capture mode is ever added. |

### F2.4 — Dest-root escape via absolute paths

| Field | Value |
| --- | --- |
| **Surface** | `p3-runner-architecture.md §3.4 rule 1` (input normalisation). |
| **Threat** | **Tampering** (STRIDE T). A subprocess emits an absolute path (`/etc/passwd`); when joined with `artifactsRoot`, `path.resolve` discards the prior path components and uses the absolute as-is, escaping the root (CWE-22). |
| **Severity** | **High** — without the input normalisation step. Architect's rule 1 mitigates; security pins the acceptance test set covering POSIX absolute, Windows drive prefixes, and UNC paths. |
| **Mitigation** | Architect's rule 1 (strip leading `/` and `\\`) is augmented to: strip leading `/`, `\\`, `\\?\`, `\\\\`, AND any drive-letter prefix (`[A-Za-z]:`) before `path.resolve`. Apply to every relpath that crosses the subprocess→runner trust boundary. |
| **Acceptance criterion** | Unit-test fixtures (in addition to F2.1's traversal set): `/etc/passwd`, `\\evil\share\foo`, `C:\Windows\System32\config\SAM`, `\\?\C:\foo`, `C:foo` (drive-relative), `//server/share` — all refused. Empty string, `.`, `./` — accepted as no-op (no traversal). |
| **Owner** | `backend`, `qa` (test pin). |
| **Classification** | **P3-required**. |

### F2.5 — Windows drive-prefix / UNC escape (cross-platform)

| Field | Value |
| --- | --- |
| **Surface** | `p3-runner-architecture.md §3.4` (architect's rules use `path.resolve` and `path.relative` which behave differently on Windows). |
| **Threat** | **Tampering** (STRIDE T). Node's `path.resolve` on Windows treats `C:foo` as drive-relative; `path.normalize` does not fully canonicalise UNC paths (CWE-22, Windows variant). |
| **Severity** | **Low** — the spec's primary platforms are macOS/Linux; Windows is unverified. F2.4's normalisation extension handles the obvious shapes; full Windows hardening would require extensive cross-platform fuzz testing. |
| **Mitigation** | Backend uses `path.posix` for the relative-from-subprocess input normalisation pipeline (treats `\` as a literal, not a separator), then `path.resolve` for the final join. Document a runbook caveat: Windows is unverified in P3; operators on Windows should treat results as best-effort. A future ADR (ADR-005, *Cross-platform runner support*) would lift the deferral. |
| **Acceptance criterion** | Runbook caveat in `benchmark/README.md` operator section (technical-writer T5). No automated test in P3. |
| **Owner** | `backend` (use `path.posix`), `technical-writer` (runbook caveat). |
| **Classification** | **deferred-with-reason** — Windows is out of P3 confirmed test surface; F2.4's normalisation covers the cross-platform escape shapes that matter for the spec's primary platforms. |

### F2.6 — Capture filename collision (FR2)

| Field | Value |
| --- | --- |
| **Surface** | `p3-runner-architecture.md §2.5` (`_subprocess.{stdout,stderr}.log` naming) + `§3.4` (capture). |
| **Threat** | **Tampering** (STRIDE T). A malicious case crafts the subprocess to write `_workspace/.guild/_subprocess.stdout.log` (or any name colliding with the runner's own log files); post-run capture might overwrite the parent's authentic log with the subprocess's forged content, corrupting the forensic trail (CWE-73 External Control of File Name or Path; also relates to CWE-269 Improper Privilege Management for the audit-trail invariant). |
| **Severity** | **Medium** — corrupts forensic integrity, no privilege escalation; the log is the post-mortem evidence so corruption matters. |
| **Mitigation** | The chosen architecture already prevents collision: `_subprocess.{stdout,stderr}.log` are written by the runner directly under `runs/<id>/artifacts/` (parent directory), while the subprocess's `.guild/` tree is captured under `runs/<id>/artifacts/.guild/` (sibling subdirectory). Different paths; no collision. **Confirm in code:** (a) the runner's log writers open files under `runs/<id>/artifacts/` (not under `.guild/`); (b) the capture step (`§3.3 step 2`) uses `errorOnExist: true` and refuses on any pre-existing file under the destination — if the runner's log writer races the capture, the capture errors loudly rather than silently overwriting. (c) **Filename namespace:** all runner-authored files under `runs/<id>/artifacts/` use the `_` prefix convention (`_subprocess.*.log`, future `_runner.log`); subprocess-authored captured tree lives strictly under `runs/<id>/artifacts/.guild/`. |
| **Acceptance criterion** | Unit test: fixture ships a benign `_workspace/.guild/_subprocess.stdout.log` containing `FAKE`; runner runs; assert (a) `runs/<id>/artifacts/_subprocess.stdout.log` contains the *real* subprocess stdout (not `FAKE`); (b) `runs/<id>/artifacts/.guild/_subprocess.stdout.log` contains `FAKE` (preserved verbatim, different path); (c) no file is overwritten — both files coexist. |
| **Owner** | `backend`, `qa` (test pin). |
| **Classification** | **P3-required** (cheap pin; FR2 closure). |

---

## 3. Resource control

The 1h cap from spec §Constraints is enforced by the parent runner per
`§2.6`. This section threat-models the escape paths around that cap —
orphaned grandchildren, signal-escalation correctness, zombie reaping,
OOM, FD exhaustion.

### F3.1 — Orphaned grandchildren outliving SIGKILL (FR3)

| Field | Value |
| --- | --- |
| **Surface** | `p3-runner-architecture.md §2.6` (architect explicitly forward-references this to security: "Out of scope … orphaned grandchildren … Security-review (T6) decides whether to use process groups"). `§2.2` currently locks `detached: false`. |
| **Threat** | **Denial of Service / Resource Consumption** (STRIDE D, in the runtime sense — the spec's 1h cap is bypassable). `claude` may spawn child processes (sub-tools, MCP servers, helper scripts); SIGTERM/SIGKILL to the `claude` PID does not propagate to its children. After SIGKILL of `claude`, grandchildren are reparented to init (`launchd` on macOS, `init`/`systemd` on Linux) and continue executing for arbitrary wall-clock — **escaping the spec's hard 1h cap** (CWE-400 Uncontrolled Resource Consumption; CWE-672 Operation on a Resource after Expiration). Parallel runs compound the issue. |
| **Severity** | **High** — direct violation of the spec's 1h cap invariant. Even one runaway grandchild per run, accumulated over a 50-run trial set, can saturate operator-machine resources. |
| **Mitigation** | **Use process groups; signal the entire group on escalation.** This requires changing `§2.2` from `detached: false` to `detached: true` so Node calls `setsid()` and the subprocess becomes the leader of a new process group. The escalation in `§2.6` then becomes: `process.kill(-child.pid, "SIGTERM")` (negative PID signals the whole group), followed by `process.kill(-child.pid, "SIGKILL")` after the 5s grace. This propagates to all grandchildren regardless of how `claude` spawned them. <br><br>**Required follow-up actions:** <br>(a) **Architect amendment / ADR-004 needed.** Changing `detached: false` → `detached: true` in `§2.2` is a locked architectural decision. Per security autonomy policy, this requires `requires confirmation` from the team lead before backend implements. The amendment is mechanical (one line + signal change in §2.6); the cleanest form is **ADR-004 — Process-group isolation for runner subprocesses** that explicitly supersedes `§2.2`'s `detached: false` line (architect owns; security recommends). <br>(b) **Parent reaping invariant preserved.** With `detached: true`, the OS no longer auto-reparents the subprocess to the parent's lifetime — the parent must explicitly `child.kill(...)` on its own exit (SIGINT, uncaught exception, normal completion). Add a `process.on("exit")` and `process.on("SIGINT")` handler that `process.kill(-child.pid, "SIGKILL")`. Do **not** call `child.unref()` (we DO want the parent to wait on the subprocess). <br>(c) **Windows.** `process.kill(-pid, …)` is POSIX-only. On Windows, fall back to `taskkill /T /F /PID <pid>` (same tree-kill semantics). Out of P3 if Windows is deferred (per F2.5); document. |
| **Acceptance criterion** | Integration test using a shell-script `claude` stub: <br>```bash<br>#!/usr/bin/env bash<br>(sleep 5400) &  # 90-minute grandchild<br>echo "$!" > "$WORKSPACE/.guild/grandchild.pid"<br>exit 0<br>```<br>Runner runs with `T_budget = 1000ms`; asserts (a) on SIGKILL, the grandchild PID from `grandchild.pid` is no longer alive (`process.kill(grandchildPid, 0)` throws `ESRCH`) within 6s of T_budget; (b) `run.json.status === "timeout"`; (c) no leftover `sleep` processes when running `pgrep -f sleep` after the test. |
| **Owner** | `backend` (implementer, after architect amendment), `architect` (ADR-004 amendment), `qa` (integration test pin). |
| **Classification** | **P3-required, REQUIRES CONFIRMATION** — the mitigation contradicts a locked architectural decision (`§2.2 detached: false`). Per security autonomy policy: "may act → requires confirmation: mitigations that change … any locked architectural decision." Team lead routes to architect for ADR-004 amendment before backend implements. **Severity is High and is NOT downgraded** to fit schedule — the spec's 1h cap is unreachable without this fix. |

### F3.2 — SIGTERM→SIGKILL escalation correctness

| Field | Value |
| --- | --- |
| **Surface** | `p3-runner-architecture.md §2.6` (escalation timeline). |
| **Threat** | **Denial of Service / availability** (STRIDE D). Off-by-one in escalation logic — SIGTERM never fires (timer leak), SIGKILL fires too early (overlap), or the second timer is cleared on subprocess exit but not on SIGTERM completion — causes either runs that escape the cap or runs killed prematurely (no CWE; correctness pin). |
| **Severity** | **Medium** — affects every run that hits the cap; pin test is cheap and high-leverage. |
| **Mitigation** | Two `setTimeout` timers (no `setInterval` polling). Pseudocode invariant: <br>```ts<br>const t1 = setTimeout(() => child.kill("SIGTERM"), T_budget);<br>const t2 = setTimeout(() => {<br>  if (child.exitCode === null) child.kill("SIGKILL");<br>}, T_budget + 5_000);<br>child.on("exit", () => { clearTimeout(t1); clearTimeout(t2); });<br>```<br>Both timers cleared on `exit`. SIGKILL is gated on liveness check (`exitCode === null`) so a clean SIGTERM-induced exit within the 5s grace does not double-signal a dead PID. |
| **Acceptance criterion** | Jest fake-timers pin: `T_budget = 1000`; subprocess stub ignores SIGTERM (e.g., a Node child that traps it); advance to `1000ms` → assert SIGTERM observed; advance to `6000ms` → assert SIGKILL observed; assert `run.json.status === "timeout"`. Second pin: subprocess exits cleanly at `999ms`; assert no SIGTERM, no SIGKILL, both timers cleared. |
| **Owner** | `qa` (primary — pin test owner), `backend` (implementer). |
| **Classification** | **P3-required**. |

### F3.3 — Zombie processes if `child.on("exit")` not awaited

| Field | Value |
| --- | --- |
| **Surface** | `p3-runner-architecture.md §2.5` (drained-and-closed-before-run.json invariant), `§2.6` (signal escalation). |
| **Threat** | **Denial of Service / resource leak** (STRIDE D). If backend forgets to `await once(child, "exit")` on a capture-error path (e.g., `errorOnExist: true` throws and the runner returns early), the subprocess becomes a zombie until the parent process exits (CWE-404 Improper Resource Shutdown). Across many runs this consumes process-table slots. |
| **Severity** | **Low** — visible only in long-running benchmark sessions; cleared on parent exit. |
| **Mitigation** | Wrap the spawn lifetime in a `try/finally` that awaits `child.exit` on every return path. Helper: `async function withSubprocess<T>(spawnOpts, body)` that owns `await once(child, "exit")` in `finally`. Code-review checklist: every code path in `runner.ts` returns through this helper or explicitly awaits exit. |
| **Acceptance criterion** | Code-review checklist; integration test that triggers a capture-failure path (e.g., pre-existing `runs/<id>/artifacts/.guild/` to provoke `errorOnExist: true`) and asserts the subprocess PID is gone within 100ms of the runner returning (`process.kill(pid, 0)` throws `ESRCH`). |
| **Owner** | `backend`, `qa` (test pin). |
| **Classification** | **P3-required** (cheap pin; pairs with F3.1 lifecycle work). |

### F3.4 — OOM via subprocess memory balloon

| Field | Value |
| --- | --- |
| **Surface** | `p3-runner-architecture.md §2.5` (stdio capture). |
| **Threat** | **Denial of Service / availability** (STRIDE D). `claude` subprocess balloons RSS; the OS OOM-killer may select the parent runner first, losing run state mid-capture (CWE-770 Allocation of Resources Without Limits). |
| **Severity** | **Low** — operator's machine, single-user, OS-level concern. Robustness issue, not a security boundary failure. |
| **Mitigation** | Document operator runbook: "On Linux, run with `ulimit -v 8388608` (8GB virtual address space) to bound subprocess RSS; on macOS, equivalent via `launchctl limit maxproc` or per-process `setrlimit` is unsupported by Node directly (no native API). The runner does not enforce this; operator-environment concern." `process.spawn`'s `options.maxBuffer` does not apply to streamed (piped) stdio, so it is not a usable bound here. |
| **Acceptance criterion** | Runbook entry only. |
| **Owner** | `technical-writer` (runbook). |
| **Classification** | **deferred-with-reason** — operator-environment concern; no Node-portable enforcement available; runbook caveat is the P3 scope. |

### F3.5 — File-descriptor exhaustion via leaked stdio pipes

| Field | Value |
| --- | --- |
| **Surface** | `p3-runner-architecture.md §2.5` ("drained and closed before writing run.json"). |
| **Threat** | **Denial of Service / resource leak** (STRIDE D). If backend opens stdout/stderr pipe streams but does not close them on every exit path (parallels F3.3 but for FD specifically), after N runs the parent process exhausts FDs (CWE-400, CWE-775). |
| **Severity** | **Low** — same shape as F3.3; cheap to pin. |
| **Mitigation** | Same `try/finally` pattern as F3.3, plus the explicit invariant in `§2.5`. Stream destinations opened with `fs.createWriteStream(... , {flags: "a"})` are closed in `finally` regardless of subprocess outcome. The drain-then-close ordering matters: drain first (so all bytes land), then close (so the FD is released). |
| **Acceptance criterion** | Integration test (skipped in CI by default; runbook test): record `lsof -p <runner-pid> | wc -l` baseline; run 100 sequential subprocess invocations; record post-run count; assert `Δ ≤ 2` (allowing for log rotation and other unrelated FDs). |
| **Owner** | `qa` (test pin), `backend` (implementer). |
| **Classification** | **P3-required** (cheap pin; bundles with F3.3). |

---

## 4. Serialisation

Architect's `§3.5` defines the `run.json` annotation contract; `§4.5`
captures untrusted prompt content verbatim and explicitly defers
sanitisation policy to security. This section locks: redaction at
write time for stdout/stderr/events; redaction of `raw_command`;
operator-auth-context audit trail; the operator-content sanitisation
boundary (don't sanitise operator-authored deliverables, do redact
mechanical output streams).

### F4.1 — Secret leakage via `run.json.raw_command`

| Field | Value |
| --- | --- |
| **Surface** | `p3-runner-architecture.md §3.5` (`raw_command` field), `§2.3` (argv shape). |
| **Threat** | **Information Disclosure** (STRIDE I). `raw_command` is "argv joined with shell-safe quoting" (audit field). If argv ever contains `--api-key sk-...` (a future `claude` flag, an accidental refactor, an experimental flag during development), the secret lands in `run.json` — committed to disk, served by `GET /api/runs/:id`, snapshotted to `website/data/benchmarks/` by the deferred export (CWE-200, CWE-532 Insertion of Sensitive Information into Log File). |
| **Severity** | **High** — `run.json` is the most-shared artifact (UI, API, future website export, bug-report attachments). |
| **Mitigation** | (a) **Argv invariant:** auth flows through env (`ANTHROPIC_API_KEY`) or `~/.claude/` config — never through argv. Document and enforce by F1.3's allowlist + an argv lint that warns on flag names matching `/^--?(api-key|token|secret|password|auth|key)$/i`. (b) **Defensive redaction.** Backend implements `redactRawCommand(argv: string[]): string`: <br>1. **Value redaction** — argv elements matching known token shapes (see F4.2 patterns) are replaced with `<REDACTED:shape>`. <br>2. **Flag-context redaction** — argv element following a flag matching `/^--?(api[-_]?key|token|secret|password|auth|key|bearer)$/i` is replaced with `<REDACTED:flag-context>`. <br>3. **Allowlist passthrough** — `--print`, `--prompt-file`, `--output-format`, `--output-format=*` and their values pass through unchanged (these are known-safe). <br>4. The redaction pass also applies F4.4's path redaction. <br>(c) Document the redaction pattern list in operator runbook so it can be extended as `claude` adds flags. |
| **Acceptance criterion** | Unit tests: <br>(a) argv `["claude", "--api-key", "sk-real_secret"]` → redacted output contains `<REDACTED:flag-context>`, never `sk-real_secret`. <br>(b) argv `["claude", "--print", "--prompt-file", "/path/to/prompt.txt"]` → passes through (allowlist hits). <br>(c) argv `["claude", "--header", "Authorization: Bearer abc123"]` → value redaction fires on `abc123` shape. <br>(d) Property test: 100 random argv arrays with embedded `sk-...`, `ghp_...`, `Bearer ...` substrings; assert no redacted output contains the originals. |
| **Owner** | `backend` (implementer), `qa` (test pin), `technical-writer` (runbook on redaction list). |
| **Classification** | **P3-required**. |

### F4.2 — Token / Authorization leakage in captured stdout/stderr (FR6 — mechanical streams)

| Field | Value |
| --- | --- |
| **Surface** | `p3-runner-architecture.md §2.5` (stdio tee'd to `_subprocess.{stdout,stderr}.log`), `§4.5` (untrusted-content forward reference). |
| **Threat** | **Information Disclosure** (STRIDE I). `claude` CLI output may print: <br>- HTTP traces with `Authorization: Bearer <token>` headers (verbose / debug modes). <br>- API error responses echoing keys (`401 Unauthorized: invalid key sk-...`). <br>- Session IDs that grant resumption privileges. <br>- Full operator paths leaking username + FS layout. <br>The captured logs are served by `GET /api/runs/:id/artifacts/_subprocess.stderr.log`, snapshotted to the deferred website, and routinely shared in bug reports — the disclosure vector is wide (CWE-200, CWE-532). |
| **Severity** | **High** — Authorization tokens land on disk in plaintext under operator workflows that explicitly share artifacts. |
| **Mitigation** | **Output-side redaction at write time.** Wrap the stdout/stderr → file tee with a `Transform` stream that scrubs known-token shapes line-by-line before bytes hit disk. <br><br>**Pattern set (P3 baseline; extensible per runbook):** <br>- `sk-[A-Za-z0-9_-]{20,}` → `<REDACTED:anthropic-key>` <br>- `Authorization:\s*Bearer\s+[A-Za-z0-9._\-+/=]+` → `Authorization: Bearer <REDACTED>` <br>- `ghp_[A-Za-z0-9]{36}` → `<REDACTED:github-pat>` (defensive — `claude` shouldn't see them, F1.3 drops `GITHUB_TOKEN`, but defense in depth) <br>- `xox[bp]-[A-Za-z0-9-]+` → `<REDACTED:slack-token>` <br>- `AKIA[0-9A-Z]{16}` → `<REDACTED:aws-access-key>` <br>- `eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+` (JWT shape, three base64url segments) → `<REDACTED:jwt>` <br>- Generic high-entropy hex / base64 strings ≥ 32 chars in contexts following `password|secret|token|key` (case-insensitive, within preceding 32 bytes) → `<REDACTED:high-entropy>` <br><br>**Idempotency:** redaction is at write time so the on-disk bytes are *only* the redacted form; the runner never holds an un-redacted in-memory copy beyond the Transform's per-chunk window. <br><br>**Tagged hash for forensic re-identification:** the marker carries the first 4 hex chars of the SHA-256 of the original token: `<REDACTED:anthropic-key:hash=ab12>`. Allows duplicate-token correlation without recovering the secret. <br><br>**Apply to `events.ndjson` too:** if §2.3's structured-output flag is taken, parse the event, redact each field of the parsed object recursively, then serialise. Identical pattern set. |
| **Acceptance criterion** | Unit tests: <br>(a) Stream `Authorization: Bearer abc123def\nGET /v1/...\n` through the Transform; assert on-disk bytes contain `Authorization: Bearer <REDACTED>` and never `abc123def`. <br>(b) Synthetic stderr containing `error: invalid key sk-test_real_value_12345` → `<REDACTED:anthropic-key:hash=...>`. <br>(c) Multi-chunk: pattern straddles a chunk boundary (Transform's buffer must hold partial-line state); assert redaction still fires. <br>(d) `events.ndjson` line `{"type":"tool_call","args":{"Authorization":"Bearer xyz"}}` → on-disk line has the value redacted. <br>(e) Negative test: benign content (model output, prose) passes through byte-for-byte. <br>(f) Hash determinism: same input token across runs produces same `hash=` suffix. |
| **Owner** | `backend` (Transform stream implementer), `qa` (test pin), `technical-writer` (runbook documents the pattern list and how to extend). |
| **Classification** | **P3-required**. |

### F4.3 — `claude` CLI auth-context audit-trail gap

| Field | Value |
| --- | --- |
| **Surface** | `p3-runner-architecture.md §2.4` (env allowlist forwards `HOME`), `§3.5` (`run.json` fields). |
| **Threat** | **Information Disclosure (audit) / Repudiation** (STRIDE I/R). `claude` reads auth from `$HOME/.claude/credentials.json` (backend confirms exact path in T2) and from `ANTHROPIC_API_KEY` in env. The subprocess inherits `HOME` per `§2.4`, so the subprocess uses the *operator's* auth context. Two consequences: <br>1. **Benchmark runs are billed to the operator's Anthropic account** — acceptable per spec (single-operator), but unstated. <br>2. **`run.json` does not record which auth identity ran the run.** If the operator rotates keys, prior `run.json` artifacts cannot be retroactively attributed to a specific identity (audit gap). |
| **Severity** | **Medium** — no immediate exploit; audit-trail and billing-attribution gap. |
| **Mitigation** | (a) **Runbook documentation** — operator runbook explicitly states: "Benchmark runs use the operator's `~/.claude/` auth context. Charge attribution flows to the operator's Anthropic account. Rotate keys per normal practice; rotation does not invalidate prior `run.json` artifacts but they cannot be retroactively re-attributed." Document the env-var precedence: `ANTHROPIC_API_KEY` > `~/.claude/credentials.json` (backend confirms in T2). <br>(b) **(Deferred-to-P4) Optional `auth_identity_hash: string` field in `run.json`** — first 8 hex chars of SHA-256 of the auth token used (env var or credentials-file content). Allows attribution without revealing the token. P4 because it requires touching the locked `RunJson` shape in `benchmark/src/types.ts §RunJson` (which is a P1-locked contract); a deliberate ADR captures the schema bump. <br>(c) **(Operator-side) sandbox auth** — for operators who want benchmarks to use a separate account: invoke with `HOME=/path/to/sandbox/home npm run benchmark`. Out of P3; runbook caveat. |
| **Acceptance criterion** | Runbook entry. No code change in P3. P4 ADR-005 (or similar) captures the `auth_identity_hash` schema addition. |
| **Owner** | `technical-writer` (runbook), `backend` (P4 schema addition; not P3). |
| **Classification** | **deferred-with-reason** — no immediate exploit; audit-trail concern only. P3 ships the runbook; P4 lifts the schema bump. |

### F4.4 — Path leak via `raw_command` revealing local FS layout

| Field | Value |
| --- | --- |
| **Surface** | `p3-runner-architecture.md §3.5` (`raw_command`), `§2.3` (`--prompt-file <path>`). |
| **Threat** | **Information Disclosure** (STRIDE I). `raw_command` includes absolute paths like `/Users/miguelp/Projects/guild/benchmark/runs/<id>/_workspace/.benchmark-prompt.txt`, which leaks the operator's username + filesystem layout when the artifact is shared (bug report, deferred website export, GitHub issue) — cosmetic info disclosure (CWE-200). |
| **Severity** | **Low** — operator username + path; no secret material. |
| **Mitigation** | F4.1's `redactRawCommand` also replaces absolute paths with placeholders: <br>- Paths under `runs/<id>/` → `${RUN_DIR}/...` <br>- Paths under `$HOME` → `${HOME}/...` <br>- Paths under the benchmark repo root → `${BENCHMARK_ROOT}/...` <br>Preserves structural information (which kind of path) while hiding the operator's username and absolute layout. Cosmetic; pair with F4.1 implementation since they share the same redaction pass. |
| **Acceptance criterion** | Unit test: `redactRawCommand(["claude", "--prompt-file", "/Users/foo/Projects/guild/benchmark/runs/abc123/_workspace/prompt.txt"])` → output contains `${RUN_DIR}/_workspace/prompt.txt`, no `/Users/foo`. |
| **Owner** | `backend` (paired with F4.1), `qa`. |
| **Classification** | **deferred-with-reason** — cosmetic info disclosure; pair with F4.1's implementation if backend chooses, otherwise defer to a follow-up PR. The threat is too narrow to gate P3 ship on. |

### F4.5 — Untrusted prompt content propagation (FR6 — operator-authored content)

| Field | Value |
| --- | --- |
| **Surface** | `p3-runner-architecture.md §4.5` (architect captures verbatim, defers sanitisation policy to security). |
| **Threat** | **Information Disclosure** (STRIDE I), via two sub-paths: <br>(a) **Operator-authored Case prompts reach downstream consumers verbatim.** If a Case prompt embeds a real secret (e.g., `"here is my AWS key, do something with it: AKIA..."`), the secret is captured in `events.ndjson` as model-context input and re-served by the API and the deferred website. <br>(b) **Model-emitted output may echo operator-supplied content back** — covered by F4.2's mechanical-stream redaction when it appears in stdout/stderr/structured-events. |
| **Severity** | **Low** — operator-controlled input; the operator wrote what they wrote, and the architect's capture-fidelity invariant requires we preserve it. The runbook caveat shifts the responsibility correctly. |
| **Mitigation** | Layered policy: <br>1. **Apply F4.2's redaction to `events.ndjson`** — already specified in F4.2; covers the structured-event payload that includes prompt context. **This part is P3-required**. <br>2. **Do NOT sanitise operator-authored deliverables** — `report.md`, `assumptions.md`, `decisions.md`, etc. These are intentional operator outputs; sanitising them would mask deliberate writes and violate `§4.5`'s capture-fidelity invariant. <br>3. **Do NOT sanitise the Case prompt itself** before passing it to `claude`. The whole point of the run is to record what `claude` actually saw; pre-sanitisation makes runs non-replayable and breaks the determinism gate (`01-architecture.md §R2`). <br>4. **Runbook caveat (technical-writer):** "Case prompts SHOULD NOT contain real secrets. The benchmark factory captures prompts verbatim into the run's audit trail; if a Case is meant to test secret-handling behaviour, use synthetic markers (`SECRET_PLACEHOLDER_42`)." |
| **Acceptance criterion** | F4.2's tests cover the `events.ndjson` structured-payload redaction path. Runbook entry covers operator-content guidance (technical-writer T5 verifies on review). No automated test for "operator wrote a secret in a Case YAML" — that is operator workflow. |
| **Owner** | `backend` (apply F4.2 redactor to events stream), `technical-writer` (runbook caveat). |
| **Classification** | **P3-required** for the events.ndjson redaction; **runbook caveat** routed to T5. |

---

## 5. Mitigation summary table

| #     | Surface (`§` of p3-runner-architecture.md unless noted) | Threat (STRIDE)                                      | Sev    | Mitigation (one-line)                                                                  | Owner                          | Class                              |
| ----- | ------------------------------------------------------- | ---------------------------------------------------- | ------ | -------------------------------------------------------------------------------------- | ------------------------------ | ---------------------------------- |
| F1.1  | §2.1, §2.2                                              | T/E — `shell:true` regression                        | High   | Runtime assert + lint rule banning `shell:true`                                       | backend, qa, devops            | P3-required                        |
| F1.2  | §2.3                                                    | T — string-built argv → injection                    | High   | argv is `string[]`; runtime `Array.isArray` + NUL-byte rejection                      | backend, qa                    | P3-required                        |
| F1.3  | §2.4 (FR1)                                              | I — env-var leakage to subprocess                    | High   | Default-deny env allowlist; minimum allow set + explicit drop list                    | backend, qa, technical-writer  | P3-required                        |
| F1.4  | §2.2, §2.4                                              | T/E — `PATH` manipulation (CWE-426)                  | Medium | Resolve `claude` once, record absolute path in `raw_command`, refuse on suspicious   | backend, technical-writer      | P3-required (resolve+log) / deferred (refuse-heuristic) |
| F1.5  | §2.3                                                    | I — prompt visible in `ps`/cmdline                   | Medium | Assertion: prompt via file/stdin; argv-element-size + content-prefix guard           | backend, qa                    | P3-required                        |
| F2.1  | §3.4 (FR4)                                              | T — path traversal (CWE-22)                          | High   | 5-rule checklist: normalise-strip-resolve-relative-backstop-refuse-log                | backend, qa                    | P3-required                        |
| F2.2  | §3.3, §3.4 (FR5)                                        | T/I — symlink escape (CWE-59)                        | High   | lstat pre-walk; refuse-and-skip; emit `tool_error` event                              | backend, qa                    | P3-required                        |
| F2.3  | §3.4                                                    | T — TOCTOU verify→write (CWE-367)                    | Low    | Single-pass capture; `errorOnExist: true`; revisit on streaming-mode addition        | backend                        | deferred-with-reason               |
| F2.4  | §3.4 rule 1                                             | T — absolute-path / drive-prefix escape              | High   | Strip leading `/`, `\\`, `\\?\`, `[A-Za-z]:`, `\\\\` before resolve                  | backend, qa                    | P3-required                        |
| F2.5  | §3.4                                                    | T — Windows drive-prefix / UNC                       | Low    | Use `path.posix` for relpath input pipeline; runbook caveat (Windows unverified)     | backend, technical-writer      | deferred-with-reason               |
| F2.6  | §2.5, §3.4 (FR2)                                        | T — capture filename collision (CWE-73)              | Medium | Different parent dirs (no collision); `errorOnExist: true`; `_`-prefix namespace     | backend, qa                    | P3-required                        |
| F3.1  | §2.6 (FR3)                                              | D — orphaned grandchildren escape 1h cap (CWE-400)   | High   | Process groups: `detached: true` + `process.kill(-pid, …)` — **needs ADR-004**       | backend, architect, qa         | **P3-required, REQUIRES CONFIRM**  |
| F3.2  | §2.6                                                    | D — escalation-timer correctness                     | Medium | Two `setTimeout`s; clear on `exit`; gate SIGKILL on liveness check                   | qa, backend                    | P3-required                        |
| F3.3  | §2.5, §2.6                                              | D — zombie processes (CWE-404)                       | Low    | `try/finally` `await once(child, "exit")`; helper-wrapped lifetime                   | backend, qa                    | P3-required                        |
| F3.4  | §2.5                                                    | D — OOM via subprocess RSS balloon (CWE-770)         | Low    | Runbook: `ulimit -v` on Linux; no Node-portable enforcement                           | technical-writer               | deferred-with-reason               |
| F3.5  | §2.5                                                    | D — FD exhaustion (CWE-400)                          | Low    | Drain-then-close every stream in `finally`; FD-baseline pin test                      | qa, backend                    | P3-required                        |
| F4.1  | §3.5, §2.3                                              | I — secret leakage via `raw_command`                 | High   | `redactRawCommand`: value + flag-context + path redaction; allowlist passthrough     | backend, qa, technical-writer  | P3-required                        |
| F4.2  | §2.5, §4.5 (FR6)                                        | I — token leakage in captured stdout/stderr/events  | High   | Stream Transform redacts at write time; pattern set + tagged hash; idempotent-on-disk | backend, qa, technical-writer  | P3-required                        |
| F4.3  | §2.4, §3.5                                              | I/R — auth-context audit-trail gap                  | Medium | Runbook documents auth model; P4 adds `auth_identity_hash` field                     | technical-writer, backend (P4) | deferred-with-reason               |
| F4.4  | §3.5                                                    | I — path leak via `raw_command`                      | Low    | Path redaction in `redactRawCommand`: `${HOME}`, `${RUN_DIR}`, `${BENCHMARK_ROOT}`   | backend, qa                    | deferred-with-reason               |
| F4.5  | §4.5 (FR6)                                              | I — operator-content propagation                     | Low    | Apply F4.2 redactor to `events.ndjson`; runbook caveat; do NOT sanitise deliverables | backend, technical-writer      | P3-required (events) / runbook (T5)|

### Counts

- **Total findings:** 21
- **By severity:** **High = 9** · Medium = 5 · Low = 7
- **By classification:** **P3-required = 16** · deferred-with-reason = 5
- **Requires confirmation:** **1** (F3.1 — touches `§2.2`'s locked
  `detached: false`; needs architect amendment / ADR-004 before backend
  implements; severity is High and is **not** sandbagged to P3-required-no-confirmation).

### Architect's 6 forward-references — closure

| FR  | Architect's question                     | Section | Finding | Verdict                                                                                                      |
| --- | ---------------------------------------- | ------- | ------- | ------------------------------------------------------------------------------------------------------------ |
| FR1 | Env allowlist                            | §2.4    | F1.3    | Default-deny + minimum-allow set + drop list. P3-required.                                                    |
| FR2 | Log filenames + collision risk           | §2.5/§3.4 | F2.6  | No collision (different parent dirs); confirm via test; `errorOnExist: true` is the backstop. P3-required.    |
| FR3 | Orphan handling — process groups?        | §2.6    | F3.1    | **Yes, required.** Process groups (`detached: true` + `kill(-pid)`); needs ADR-004. P3-required + confirm.    |
| FR4 | Path-resolution policy                   | §3.4    | F2.1    | 5-rule checklist (normalise-strip-resolve-relative-backstop-refuse-log). P3-required.                         |
| FR5 | Symlink refusal — timing (lstat vs O_NOFOLLOW) | §3.4 | F2.2   | Pre-walk lstat-and-skip; `O_NOFOLLOW` not portably surfaced by `fs.cp`. P3-required.                          |
| FR6 | Prompt-content sanitisation              | §4.5    | F4.5 + F4.2 | Redact mechanical streams (stdout/stderr/events.ndjson); do NOT sanitise operator-authored deliverables. Mixed: F4.2 + events part of F4.5 are P3-required; runbook part is T5. |

All six FRs have an explicit finding with mitigation. None silently skipped.

---

## References

### Internal (this repo)

- `benchmark/plans/p3-runner-architecture.md §2/§3/§4` — anchored
  surfaces; primary upstream input.
- `benchmark/plans/adr-003-host-repo-vs-fresh-fixture.md` — locks
  fresh-fixture cwd model; the `_workspace/` writable surface scoped
  here.
- `benchmark/plans/adr-001-runner-ui-boundary.md §Decision (commitment 4)`
  — server binds `127.0.0.1` only; **confirmed unchanged by this
  review** (no proposal alters the binding; the no-network constraint
  remains spec-bound).
- `benchmark/plans/01-architecture.md §3` — artifact data-flow
  contract this runner satisfies.
- `benchmark/plans/01-architecture.md §"Cross-cutting: missing /
  partial artifact"` — partial-capture handling tied to F2.1, F2.2,
  F2.4, F3.1, F3.2.
- `benchmark/src/types.ts §RunJson` — `raw_command`, `model_ref`,
  `plugin_ref` fields covered by F4.1, F4.3.

### External standards

- **OWASP Top 10 (2021)** — `A03:2021 Injection` (F1.1, F1.2),
  `A05:2021 Security Misconfiguration` (F1.3, F1.4),
  `A09:2021 Security Logging and Monitoring Failures` (F4.1, F4.2,
  F4.3).
- **CWE references** —
  CWE-22 Path Traversal (F2.1, F2.4, F2.5),
  CWE-59 Link Resolution Before File Access (F2.2),
  CWE-73 External Control of File Name (F2.6),
  CWE-78 OS Command Injection (F1.1),
  CWE-88 Argument Injection (F1.2),
  CWE-158 Improper Neutralization of Null Byte (F1.2),
  CWE-200 Information Exposure (F1.3, F1.5, F4.1, F4.2, F4.4),
  CWE-269 Improper Privilege Management (F2.6 — audit-trail invariant),
  CWE-367 TOCTOU (F2.3),
  CWE-400 Uncontrolled Resource Consumption (F3.1, F3.5),
  CWE-404 Improper Resource Shutdown (F3.3),
  CWE-426 Untrusted Search Path (F1.4),
  CWE-532 Insertion of Sensitive Information into Log File (F4.1, F4.2),
  CWE-538 Insertion of Sensitive Information into Externally-Accessible File (F1.3),
  CWE-672 Operation on a Resource after Expiration (F3.1),
  CWE-770 Allocation of Resources Without Limits (F3.4),
  CWE-775 Missing Release of File Descriptor (F3.5).

### Spec / process

- `.guild/spec/benchmark-factory.md §Constraints` — 1h cap (F3.1, F3.2),
  no-network NFR (`127.0.0.1` binding confirmed via ADR-001).
- `guild-plan.md §6.4` — engineering-group principles; evidence rule
  applied (every finding carries a reproduction or pin acceptance).
- `guild-plan.md §10.3` — decision-routing rule; F3.1 routed to
  architect for ADR-004 amendment.
