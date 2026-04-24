---
name: devops-ci-cd-pipeline
description: Designs a CI/CD workflow — build/test/deploy stages, artifact promotion between envs, manual/auto gates, rollback hooks. Output: pipeline YAML (GitHub Actions / GitLab / CircleCI / Buildkite) plus a gate matrix showing which env needs which approval. Pulled by the `devops` specialist. TRIGGER: "design the CI/CD pipeline for X", "set up the GitHub Actions workflow for X", "write the deploy pipeline for X", "wire build-test-deploy for X", "what stages should the pipeline have", "draft the release workflow". DO NOT TRIGGER for: provisioning cloud resources / Terraform (use `devops-infrastructure-as-code`), metrics/logs/alerts wiring (use `devops-observability-setup`), writing an on-call runbook (use `devops-incident-runbook`), API contract design (backend-api-contract), test shape selection (qa-test-strategy), secret scanning (security-secrets-scan).
when_to_use: The parent `devops` specialist pulls this skill when the task requires defining or reshaping the build/test/deploy automation for a service. Also fires on explicit user request.
type: specialist
---

# devops-ci-cd-pipeline

Implements `guild-plan.md §6.1` (devops · ci-cd-pipeline) under `§6.4` engineering principles: the pipeline is the test harness for release, and every merge is evidence the gates work.

## What you do

Produce a concrete pipeline definition plus a gate matrix that makes the promotion path between environments unambiguous. A reviewer should be able to trace a commit from PR → staging → production without reading code.

- Name every stage (lint, unit, build, integration, package, deploy-staging, smoke, deploy-prod) with its trigger and its success criterion.
- Define artifact promotion: the same built image or bundle flows forward — never rebuild per env.
- State gates explicitly: which stage needs green tests, which needs human approval, which auto-promotes on tag.
- Wire a rollback path — a one-click (or one-command) revert for the last known good artifact.
- Keep secrets out of logs: use masked variables / OIDC federation, never echo them.

## Output shape

A pipeline file (e.g. `.github/workflows/deploy.yml`, `.gitlab-ci.yml`) plus a `gate-matrix.md` with:

1. **Stages** — ordered list with trigger (push / tag / manual) and duration budget.
2. **Artifacts** — what is built once and promoted (image digest, bundle checksum).
3. **Gates** — table of env · gate type (auto / approval / green-tests) · owner.
4. **Rollback** — command or workflow to revert to the previous artifact.
5. **Secrets** — where they live (vault / OIDC), never inline.

## Anti-patterns

- No rollback gate — "we'll figure it out if it breaks" is not a strategy.
- Long-running builds that nobody monitors — cap stage duration and fail fast.
- Secrets echoed to logs or stored in the repo as plaintext.
- Rebuilding artifacts per environment — staging and prod must ship bit-identical binaries.
- Gate-free auto-deploy to prod from every commit on `main`.
- Sprawling matrix jobs that run 40 combinations when 4 matter.

## Handoff

Return the pipeline file path and gate-matrix path to the invoking `devops` specialist. If the pipeline needs new infra (runners, secrets vault), the devops agent chains into `devops-infrastructure-as-code`; if it needs alerting on failed deploys, into `devops-observability-setup`. This skill does not dispatch.
