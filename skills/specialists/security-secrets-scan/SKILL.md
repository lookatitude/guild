---
name: security-secrets-scan
description: Scans repo and build artifacts for leaked secrets (keys, tokens, certs) and proposes a prevention policy — pre-commit hooks, CI check, rotation plan. Output: findings report, remediation steps (rotate / revoke / invalidate), and hook/CI proposals. Pulled by the `security` specialist. TRIGGER: "scan the repo for leaked secrets", "check for exposed API keys in X", "secret-scan the X artifact", "audit git history for credentials", "find leaked tokens in X", "set up leak-prevention hooks for X". DO NOT TRIGGER for: dependency CVE audit (use `security-dependency-audit`), threat modeling (use `security-threat-modeling`), auth-flow audit (use `security-auth-flow-review`), vault / KMS provisioning (use `devops-infrastructure-as-code`), general infra hardening (devops group), CI pipeline structure (devops-ci-cd-pipeline).
when_to_use: The parent `security` specialist pulls this skill when the task requires finding leaked credentials and preventing recurrence. Also fires on explicit user request.
type: specialist
---

# security-secrets-scan

Implements `guild-plan.md §6.1` (security · secrets-scan) under `§6.4` engineering principles: a leaked secret in git history is live until rotated — scanning without rotating is theater.

## What you do

Scan the working tree, full git history, and build artifacts with a real scanner (gitleaks, trufflehog, detect-secrets, or GitHub secret-scanning data). Verify findings (false positives are common), rotate what's real, and land prevention — so the next leak doesn't happen.

- Scan history, not only `HEAD` — a removed secret is still in `git log`.
- Verify each finding: trigger the credential to confirm it's live vs. already revoked.
- Rotate and revoke — a scanner report is not a fix; the secret has to stop working.
- Land prevention: pre-commit hook + CI check that blocks on new findings.
- Triage false positives once, in an allowlist with a reason — not repeatedly.
- Wire an escalation path for "confirmed live secret" — rotation happens in minutes, not days.

## Output shape

A findings report + remediation:

1. **Findings** — per match: path · commit · type · verified? · severity · exposure (public vs private repo / artifact).
2. **Remediation** — per finding: rotate / revoke / invalidate · owner · status · timestamp.
3. **Allowlist** — false positives with justification.
4. **Prevention** — pre-commit hook config, CI job definition, PR-template reminder.
5. **Rotation policy** — named secret types with standard rotation SLA.
6. **Incident link** — if the leak crosses a reporting threshold, link the incident doc.

## Anti-patterns

- Scan-only, no rotation — the secret still works; you merely have a report.
- Whitelist noise — marking everything as "test key" without checking.
- False-positive fatigue — alerts fire daily, devs ignore the real one.
- Deleting the commit but not rotating — the secret is still reachable in forks / caches.
- One-time scan with no CI gate — the next PR re-commits a new key.
- Committing the scanner config itself with secrets in the test fixtures.

## Handoff

Return the report and remediation paths to the invoking `security` specialist. Hook installation chains to `devops-ci-cd-pipeline`; rotation of cloud credentials chains to `devops-infrastructure-as-code`. Major leaks may require `devops-incident-runbook`. This skill does not dispatch.
