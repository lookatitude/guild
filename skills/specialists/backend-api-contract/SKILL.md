---
name: backend-api-contract
description: Designs REST / GraphQL / RPC endpoints — routes, methods, request/response schemas, error envelope, auth, versioning, pagination. Output: OpenAPI/GraphQL SDL fragment or a markdown spec the backend can implement against. Pulled by the `backend` specialist. TRIGGER: "design the API for X", "define the endpoints for X", "what should the request/response look like for X", "draft the OpenAPI spec for X", "specify the GraphQL schema for X", "how should the client call X". DO NOT TRIGGER for: DB schema / tables / indexes (use `backend-data-layer`), writing a migration (use `backend-migration-writer`), calling an external third-party API (use `backend-service-integration`), deciding between two API styles at architecture level (architect-tradeoff-matrix), high-level multi-service system design (architect-systems-design), auth-flow security review (security-auth-flow-review).
when_to_use: The parent `backend` specialist pulls this skill when the task requires specifying the external contract of a service — what clients see, not what the DB holds. Also fires on explicit user request.
type: specialist
---

# backend-api-contract

Implements `guild-plan.md §6.1` (backend · api-contract) under `§6.4` engineering principles: the contract is the test; the implementation is green when a generated client can exercise every endpoint.

## What you do

Produce a precise, implementable contract for one service or one resource boundary — nothing more. The spec names every route, request shape, response shape, error envelope, auth expectation, and the versioning/pagination rules. A backend engineer should be able to start coding from it without asking a follow-up.

- Use nouns in URLs; verbs are the HTTP method. `POST /orders`, not `POST /createOrder`.
- Define the error envelope once (e.g. `{ error: { code, message, details } }`) and reuse it.
- State auth per endpoint (public / bearer / service-token) and the required scope/role.
- Pick a versioning strategy (URL `/v1/`, header `Accept: application/vnd.x.v1+json`, or GraphQL schema evolution) and apply it consistently.
- Specify pagination shape (`cursor` + `limit` preferred for lists), sorting, and filtering grammar.
- Call out idempotency: which endpoints are safe to retry and which need an `Idempotency-Key`.

## Output shape

Either an OpenAPI YAML fragment, a GraphQL SDL block, or a markdown spec with these sections:

1. **Scope** — resource(s) in scope; explicitly what's out.
2. **Endpoints** — method · path · summary · auth · request · response · errors.
3. **Schemas** — typed models for every request/response body.
4. **Errors** — error envelope + code table.
5. **Auth & versioning** — how clients authenticate, how versions evolve.
6. **Pagination & idempotency rules**.

Store at `.guild/runs/<run-id>/api/<slug>.{yaml|md}` if the run is tracked.

## Anti-patterns

- Verbs in URLs (`/createOrder`, `/getUser`) — use HTTP methods.
- Missing error schema — errors are part of the contract, not an afterthought.
- Implicit auth — "obviously logged in" is not a spec.
- Breaking changes without versioning — renaming a field in v1 is a regression.
- Unbounded list endpoints — every list must cap `limit` and require pagination past it.
- String-typed everything — if a field is an enum, declare the enum.

## Handoff

Return the spec path (or inline fragment) to the invoking `backend` specialist. If the contract implies DB work, the backend agent chains into `backend-data-layer` and `backend-migration-writer`; if it calls out to an external service, into `backend-service-integration`. This skill does not dispatch.
