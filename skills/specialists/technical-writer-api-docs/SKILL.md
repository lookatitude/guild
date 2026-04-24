---
name: technical-writer-api-docs
description: Documents an existing API contract — reference pages per endpoint, example requests/responses, error table, auth section, pagination rules, versioning notes. Reads the source spec (OpenAPI/SDL/code); never invents endpoints. Pulled by the `technical-writer` specialist. TRIGGER: "write the API docs for X", "document the /orders endpoints", "turn this OpenAPI spec into reference docs", "write the API reference page for X", "document the error codes returned by X", "write the developer docs for the Y API". DO NOT TRIGGER for: designing the API contract itself (use `backend-api-contract` — backend owns the contract, tech-writer documents it), writing a getting-started walkthrough (use `technical-writer-tutorial`), user-facing product manual (use `technical-writer-user-manual`), release notes / changelogs (use `technical-writer-release-notes`), marketing copy about the API (copywriter-long-form), SDK-sales outreach (sales group).
when_to_use: The parent `technical-writer` specialist pulls this skill when the task requires producing reference docs for an API that already has a contract. Also fires on explicit user request.
type: specialist
---

# technical-writer-api-docs

Implements `guild-plan.md §6.2` (technical-writer · api-docs) under `§6.4` writing principles: match the contract exactly, don't rewrite adjacent endpoints that weren't asked for, evidence = a reference page a developer can curl through without guessing.

## What you do

Produce reference documentation that mirrors the source spec line by line. Your job is fidelity, not creativity — the backend owns the contract; you make it readable.

- Read the source spec first: OpenAPI file, GraphQL SDL, proto, or the code itself. Cite which one.
- Document every endpoint requested: method, path, summary, auth, request schema, response schema, error codes.
- Include at least one runnable example per endpoint — real cURL or SDK call with realistic (but non-sensitive) values.
- Render the error table once, then reference it from each endpoint. Don't restate envelope fields per endpoint.
- Call out versioning (URL / header / schema evolution) and deprecations — annotate deprecated endpoints with replacement.
- If you spot drift between the spec and the docs-in-progress, stop and flag it — do not paper over it.

## Output shape

Markdown (or docs-site-flavored markdown) with:

1. **Overview** — what the API does, base URL, auth model, versioning.
2. **Authentication** — how to get credentials, how to pass them, scope/role table.
3. **Endpoints** — one section per endpoint: method + path header, summary, parameters, request body, responses (success + each error), example.
4. **Error codes** — canonical table (code · status · meaning · retry-safe?).
5. **Pagination, rate limits, idempotency** — where applicable.
6. **Changelog pointer** — link to release notes.

Store at `.guild/runs/<run-id>/docs/api-<slug>.md` if tracked.

## Anti-patterns

- Inventing endpoints or parameters that aren't in the spec.
- Drift from source: docs say `email`, spec says `emailAddress`. Always match the spec.
- Missing error docs — readers hit 4xx/5xx before they hit 200.
- Placeholder examples (`foo@bar.com`, `id: 123`) with no realistic structure.
- Copy-pasting the OpenAPI YAML into the docs page instead of rendering it for humans.
- Silently fixing a spec bug in docs — file it as a followup; backend owns the spec.

## Handoff

Return the docs path to the invoking `technical-writer` specialist. If the docs reveal gaps in the spec (missing error, undocumented field, breaking change), raise a followup for the `backend` specialist — do not fix the spec here. Chain into `technical-writer-tutorial` for a getting-started walkthrough and `technical-writer-release-notes` for the accompanying changelog. This skill does not dispatch.
