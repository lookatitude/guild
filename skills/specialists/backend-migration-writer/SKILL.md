---
name: backend-migration-writer
description: Authors a safe, reversible database migration — up and down files, data-backfill plan, lock-budget analysis, and rollback strategy. Pulled by the `backend` specialist. TRIGGER: "write the migration for X", "generate the up/down for X column", "add a reversible migration for X", "write the backfill for X", "how do we safely add this index on a hot table", "draft the schema change for X". DO NOT TRIGGER for: deciding *what* schema to land (use `backend-data-layer` first), external API shape (use `backend-api-contract`), deploying / running the migration in CI (devops-ci-cd-pipeline), infra-level DB provisioning (devops-infrastructure-as-code), application-level data transformations unrelated to schema (not this skill).
when_to_use: The parent `backend` specialist pulls this skill when a schema change needs to land in production safely — specifically: an up/down migration with a backfill plan and a rollback. Also fires on explicit user request.
type: specialist
---

# backend-migration-writer

Implements `guild-plan.md §6.1` (backend · migration-writer) under `§6.4` engineering principles: the evidence is a migration that runs green in staging, rolls back cleanly, and holds locks for less than the app's health-check budget.

## What you do

Author the migration as two artifacts — the schema change and the data backfill — plus the rollback path. The migration assumes the app is still serving traffic; it must be expand-then-contract, idempotent, and under the lock budget of the target table.

- Expand / migrate / contract: add new structures in one migration, migrate reads/writes in app deploys, drop old structures in a later migration. No big-bang column drops.
- Make every DDL step idempotent (`IF NOT EXISTS`, `IF EXISTS`) so a retry is safe.
- Size locks to the table: on hot tables, prefer `CREATE INDEX CONCURRENTLY`, `NOT VALID` constraints validated later, and avoid `ALTER TABLE` rewrites.
- Write the down migration alongside the up; test it. A non-reversible migration must be called out explicitly with justification.
- Plan backfills as batched, resumable jobs, not a single transaction. Include a progress-tracking strategy.
- State the app-deploy ordering: migration before app? after? Between two app deploys?

## Output shape

One or more migration files under the project's migrations dir, plus a markdown note at `.guild/runs/<run-id>/migrations/<slug>.md`:

1. **Summary** — what changes, why, which table(s).
2. **Up** — the forward DDL / data steps.
3. **Down** — the reverse, or an explicit "not reversible because…".
4. **Backfill plan** — batched-job spec: batch size, throttle, resume key, expected duration.
5. **Lock budget** — expected lock type and hold time on hot tables; mitigations used.
6. **Deploy order** — where in the app-deploy sequence this runs.
7. **Rollback strategy** — what to do if this fails mid-backfill.

## Anti-patterns

- Non-idempotent migrations — a retried step that errors on second run is a 3am page.
- No rollback path — "we'll figure it out" is not a rollback.
- Long-running locks on hot tables — `ALTER TABLE … ADD COLUMN … DEFAULT non-null` on a 100M-row table is an outage.
- Schema-before-app coupling — landing a schema change that the current app code doesn't tolerate. Expand first, then contract.
- Single-transaction backfills — a 4-hour transaction is a replication-lag catastrophe.

## Handoff

Return the migration paths and the plan note to the invoking `backend` specialist. The backend agent is responsible for sequencing the migration with the matching app deploy and for handing the CI/CD artifact to `devops-ci-cd-pipeline` if that coordination is needed. This skill does not dispatch.
