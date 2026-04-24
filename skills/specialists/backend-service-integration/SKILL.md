---
name: backend-service-integration
description: Integrates a service with an external HTTP/gRPC/webhook API — client module, timeouts, retries with backoff, circuit breaker, idempotency, error mapping, and observability. Output: integration module + config + error-mapping table. Pulled by the `backend` specialist. TRIGGER: "integrate with Stripe", "wire up the SendGrid client", "add the Twilio webhook handler", "call the external X API from our service", "build the client for the partner API", "how do we handle retries and timeouts calling X". DO NOT TRIGGER for: designing *our own* API (use `backend-api-contract`), DB schema for storing integration state (use `backend-data-layer`), a migration landing integration tables (use `backend-migration-writer`), secrets management at infra level (devops group), auth-flow security review on the external protocol (security-auth-flow-review).
when_to_use: The parent `backend` specialist pulls this skill when the task requires calling into a third-party API or consuming a webhook, and the integration must be production-grade (retries, timeouts, observable). Also fires on explicit user request.
type: specialist
---

# backend-service-integration

Implements `guild-plan.md §6.1` (backend · service-integration) under `§6.4` engineering principles: evidence is a test matrix — happy path, timeout, 5xx retry, 4xx no-retry, circuit-open behavior — plus a sampled trace.

## What you do

Build the integration module as a small, testable seam. The caller gets a typed interface; the module owns transport, retries, and error translation. No silent fallbacks — if the external call fails past budget, the integration surfaces a typed error the caller can react to.

- Wrap the SDK or raw HTTP in a thin client with a typed interface (domain verbs, not `post()` / `get()`).
- Set explicit timeouts: connect, read, total. Never rely on a default of "forever".
- Retry only idempotent or idempotency-keyed calls. Use exponential backoff with jitter, cap attempts, cap total elapsed.
- Circuit breaker or at-minimum a concurrency cap: an upstream outage must not tip your service.
- Map external errors into your domain error taxonomy — the caller should not see `HTTPError 429` leaking up the stack.
- Emit structured logs with correlation ID, duration, attempt count, and outcome. Add metrics: request count, error rate, p95 latency per endpoint.
- Store secrets via env / secret manager. Never in code, never in the repo.

## Output shape

1. **Client module** — `<service>/<vendor>_client.{py,ts,go,…}` with a typed interface.
2. **Config** — env var names, default timeouts/retries/backoff, secret references.
3. **Error-mapping table** — markdown table: external status/code · domain error · retry policy · caller guidance.
4. **Observability spec** — log/metric/trace field names.
5. **Failure playbook** — 3–5 sentences on what an on-call sees when the vendor is down.

## Anti-patterns

- No retry / no backoff — a transient 503 becomes a permanent failure.
- Silent fallback — returning empty/default on upstream failure hides incidents.
- Unbounded timeouts — one slow call queues the entire worker pool.
- Secrets in code or committed config — rotate-and-leak waiting to happen.
- Retrying non-idempotent POSTs without an idempotency key — duplicate side effects in production.
- Leaking vendor errors to the caller — couples your code to their status codes forever.

## Handoff

Return the module path, config spec, and error table to the invoking `backend` specialist. If the integration needs persistent state (webhook dedup, delivery receipts), the backend agent chains into `backend-data-layer` and `backend-migration-writer`. This skill does not dispatch.
