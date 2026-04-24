---
name: devops-infrastructure-as-code
description: Authors Terraform / Pulumi / CDK for a cloud component — compute, networking, storage, IAM — with state backend, drift detection, and module boundaries. Output: IaC source files plus backend/state configuration and a module-tree note. Pulled by the `devops` specialist. TRIGGER: "write Terraform for X", "provision the infra for X", "author the CDK stack for X", "Pulumi program to set up X", "create the IaC module for X", "stand up the cloud resources for X". DO NOT TRIGGER for: CI/CD workflow / pipeline YAML (use `devops-ci-cd-pipeline`), monitoring / dashboards / alerts (use `devops-observability-setup`), runbook authoring (use `devops-incident-runbook`), high-level architecture across services (architect-systems-design), app-level config inside a service (backend group), secret rotation policy (security-secrets-scan).
when_to_use: The parent `devops` specialist pulls this skill when the task requires creating or modifying declarative infra for a cloud component. Also fires on explicit user request.
type: specialist
---

# devops-infrastructure-as-code

Implements `guild-plan.md §6.1` (devops · infrastructure-as-code) under `§6.4` engineering principles: the code is the source of truth, `plan` is the review, drift is a bug.

## What you do

Produce declarative IaC for one component — compute, network, data store, queue, or IAM boundary — with clean module seams, remote state, and a workflow to detect drift. Hand-crafted console changes are never the target; regenerating from code must recreate the environment.

- Parameterize region, size, and environment — never hardcode `us-east-1` or account IDs.
- Pin provider and module versions; reproducibility matters more than novelty.
- Use remote state with locking (S3 + DynamoDB, Terraform Cloud, Pulumi Service) and document the backend.
- Split modules by lifecycle: network / data / compute / iam live at different cadences.
- Treat every resource as immutable where the platform allows — replace rather than mutate.
- Emit outputs consumers need (URLs, ARNs, connection strings) so downstream stacks compose cleanly.

## Output shape

A directory of IaC source (`*.tf` / `*.ts` / `*.py`) plus a short `README.md` describing:

1. **Scope** — what resources this stack owns; what's delegated to other stacks.
2. **Backend** — where state lives, locking, encryption.
3. **Inputs / outputs** — variables consumed, outputs emitted.
4. **Drift policy** — how and how often `plan` is run against the real cloud.
5. **Apply workflow** — who can apply, from where (ideally from CI with OIDC).

## Anti-patterns

- Mutable resources managed click-by-click after IaC creation — state diverges silently.
- No drift detection — the repo lies and nobody notices until outage.
- Hardcoded region, credentials, or account IDs — blocks cloning the stack for another env.
- Monolithic 2000-line root module — split by lifecycle.
- Outputs used across stacks by copy-paste instead of remote-state / data sources.
- `terraform apply` from laptops without locking or audit.

## Handoff

Return the IaC directory path and backend config to the invoking `devops` specialist. If the new infra needs a pipeline to apply it, the devops agent chains into `devops-ci-cd-pipeline`; if it needs monitoring, into `devops-observability-setup`. This skill does not dispatch.
