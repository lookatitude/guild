---
name: security-dependency-audit
description: Audits dependencies for CVEs, license risk, and transitive exposure; writes a remediation plan with ownership. Output: audit report (per package: CVE / license / fix status) plus a patch plan. Pulled by the `security` specialist. TRIGGER: "audit dependencies for CVEs in X", "dependency security review of X", "check package vulnerabilities in X", "license audit of X", "SCA scan for X", "find vulnerable libraries in X". DO NOT TRIGGER for: threat modeling the application (use `security-threat-modeling`), auth-flow review (use `security-auth-flow-review`), secret scanning (use `security-secrets-scan`), picking dependencies during architecture (architect-tradeoff-matrix), general upgrade work (backend / mobile group), observability of runtime risk (devops-observability-setup).
when_to_use: The parent `security` specialist pulls this skill when the task requires surveying dependencies for known vulnerabilities, license exposure, or transitive risk and producing a patch plan. Also fires on explicit user request.
type: specialist
---

# security-dependency-audit

The lockfile is the attack surface; an audit is only worth it if it ends in patches.

## What you do

Run the relevant SCA tooling (`npm audit`, `pip-audit`, `cargo audit`, `go mod audit`, `osv-scanner`, `Trivy`, `Snyk`, `GitHub Dependabot` data), cross-reference the lockfile for transitive depth, and deliver a plan — not a raw JSON dump.

- Scan both direct and transitive dependencies; depth matters because transitives ship the bulk of CVEs.
- Triage CVEs by exploitability in this codebase, not CVSS alone — some are unreachable code.
- Check license obligations: GPL/AGPL in a closed-source product, field-of-use restrictions, attribution.
- Prefer patching over pinning — pinned vulnerable versions are temporary debt with an expiry.
- Propose a continuous policy: PR-time checks, nightly re-scan, renovate/Dependabot rules.
- Test the patch: upgrading a transitive can break the app silently.

## Output shape

An `audit-report.md` plus a patch plan:

1. **Summary** — total packages, direct vs transitive, count by severity, license exceptions.
2. **Findings table** — package · version · CVE · CVSS · reachable? · fix version · notes.
3. **License review** — packages with policy-sensitive licenses.
4. **Patch plan** — ordered list: package · from → to · risk · test scope · owner.
5. **Ongoing policy** — CI check, auto-PR cadence, allowlist rules.

## Anti-patterns

- Only top-level scan — transitives hold most of the risk.
- Snapshot-in-time report with no ongoing scan — stale within a week.
- Auto-upgrading everything without running tests — swaps CVEs for breakage.
- Ignoring CVSS context — patching all 7.5s equally, missing a reachable 5.0.
- Noise-heavy output without triage — devs tune out.
- License audit skipped — legal surprises ship with the next release.

## Handoff

Return the report and patch-plan paths to the invoking `security` specialist. Patch PRs typically hand off to the owning service specialist (backend / mobile) for test and merge; continuous policy changes chain into `devops-ci-cd-pipeline`. This skill does not dispatch.
