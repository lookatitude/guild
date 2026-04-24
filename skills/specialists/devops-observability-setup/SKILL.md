---
name: devops-observability-setup
description: Wires metrics, logs, traces, SLO dashboards, and alerts for a service. Output: dashboard-as-code (Grafana / Datadog / CloudWatch JSON), alert rules, and the SLO → alert mapping. Pulled by the `devops` specialist. TRIGGER: "add observability for X", "wire metrics and alerts for X", "set up the dashboard for X", "define SLOs and alerts for X", "instrument X with tracing", "what should we alert on for X". DO NOT TRIGGER for: CI/CD pipeline setup (use `devops-ci-cd-pipeline`), provisioning the underlying infra (use `devops-infrastructure-as-code`), writing the runbook the alert links to (use `devops-incident-runbook`), app-level logging code (backend group), security event monitoring as a compliance deliverable (security-threat-modeling), test flakiness telemetry (qa-flaky-test-hunter).
when_to_use: The parent `devops` specialist pulls this skill when the task requires making a service's health visible — metrics, traces, dashboards, alerts. Also fires on explicit user request.
type: specialist
---

# devops-observability-setup

Implements `guild-plan.md §6.1` (devops · observability-setup) under `§6.4` engineering principles: you cannot operate what you cannot see; every alert must map to a signal that maps to a user-visible symptom.

## What you do

Instrument a service so on-call can answer "is it healthy?" in under a minute and "why not?" in under five. Every alert must point to a user-visible symptom, a runbook, and an owner.

- Pick 3–5 SLIs per service (availability, latency, correctness) and turn them into SLOs with error budgets.
- Define alert rules from SLO burn rates, not from raw thresholds — no more "CPU > 80%" pages.
- Emit structured logs with a request-correlation field; unstructured log lines are telemetry debt.
- Wire distributed tracing at service boundaries; sample high enough to catch tail latency.
- Dashboard-as-code lives next to the service — no hand-tuned Grafana boards that nobody can recreate.
- Route alerts through a single pager and tag severity — paging for warnings trains on-call to ignore pages.

## Output shape

Files plus a short note:

1. **Dashboard JSON / YAML** — committed next to the service.
2. **Alert rules** — Prometheus / Datadog / CloudWatch, with severity, runbook URL, owner.
3. **SLO doc** — SLI definitions, SLO targets, error budget policy.
4. **Instrument checklist** — what the service must emit (metric names, log fields, trace spans).
5. **Ownership** — who gets paged for which alert.

## Anti-patterns

- Vanity metrics — dashboards full of graphs that don't drive a decision.
- No link from alert to SLO — the alert fires but nobody knows if the budget is actually burning.
- Noisy alerts — if it fires weekly and nobody acts, delete or re-scope it.
- Logging everything at `info` — costs explode, signal is lost.
- Dashboards built in the UI and never exported — unreproducible.
- Single severity — no way to triage mid-incident.

## Handoff

Return the dashboard, alert, and SLO paths to the invoking `devops` specialist. The runbook URLs that the alerts reference are authored by `devops-incident-runbook`; the devops agent typically chains there next. This skill does not dispatch.
