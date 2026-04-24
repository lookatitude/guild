---
name: security-auth-flow-review
description: Reviews an authentication / authorization flow (OAuth2 / OIDC / session / token / SAML) — threat-maps the flow, finds weaknesses, lists fixes. Output: `auth-review.md` with step-by-step flow, threat map, and remediation. Pulled by the `security` specialist. TRIGGER: "review the auth flow for X", "audit the OAuth implementation in X", "security review of the login flow", "check the session handling in X", "audit the token lifecycle of X", "review the OIDC integration with X". DO NOT TRIGGER for: writing the auth flow from scratch (backend group owns), general threat modeling across a service (use `security-threat-modeling`), dependency CVE audit (use `security-dependency-audit`), secret scanning (use `security-secrets-scan`), UX of the sign-in screen (frontend-design / mobile group), compliance attestation only.
when_to_use: The parent `security` specialist pulls this skill when the task requires auditing an existing or proposed auth flow end-to-end. Also fires on explicit user request.
type: specialist
---

# security-auth-flow-review

Implements `guild-plan.md §6.1` (security · auth-flow-review) under `§6.4` engineering principles: the auth flow is the door; step through it like an attacker, not like a user.

## What you do

Walk the flow step by step, from client initiation to revocation, annotating each step with the secret material, the redirect, the state carried, and the failure path. Then threat-map it — misused redirects, token replay, fixation, scope escalation — and write remediations.

- Reconstruct the flow diagram end-to-end: client → IdP → callback → session → refresh → logout → revocation.
- Check redirect URI allowlists, state / PKCE, nonce, ID token validation, audience / issuer.
- Validate session storage (HttpOnly, Secure, SameSite, idle / absolute timeout, rotation on privilege change).
- Inspect token lifecycle: access / refresh TTL, rotation, revocation server-side, clock skew tolerance.
- Cover the negative paths: stolen refresh token, leaked authorization code, CSRF on login, logout on shared device.
- Map each finding to a concrete fix (code or config), a severity, and an owner.

## Output shape

A markdown file `auth-review.md`:

1. **Flow diagram** — step-by-step with data flowing.
2. **Components** — IdP, authz server, resource server, client, session store.
3. **Threat map** — per step: threat · control · status · finding.
4. **Findings** — severity · description · repro · fix · owner.
5. **Token lifecycle** — issuance · storage · rotation · revocation rules.
6. **Test plan** — cases to add (happy, CSRF, replay, revocation).

## Anti-patterns

- Rubber-stamp review — "looks fine" with no step-by-step walk.
- Testing only the happy path — the attacker lives in the negative paths.
- Ignoring token lifecycle — long-lived refresh tokens with no rotation are a classic breach fuel.
- Missing redirect URI exact-match check — open redirect enables auth code theft.
- No revocation plan — "rotate secrets" works until you need to kick a specific user.
- Skipping IdP configuration audit — client-side hardening is wasted if the IdP is mis-set.

## Handoff

Return the review doc path to the invoking `security` specialist. Fixes typically chain to the owning service specialist (backend / mobile); new test cases chain to `qa-test-strategy`. If the flow needs redesign, escalate to `architect-systems-design`. This skill does not dispatch.
