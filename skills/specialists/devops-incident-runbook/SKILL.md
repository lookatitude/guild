---
name: devops-incident-runbook
description: Writes a concrete on-call runbook for a specific failure mode — symptoms, diagnose steps, mitigate, rollback, and postmortem link. Output: markdown runbook keyed off the alert name. Pulled by the `devops` specialist. TRIGGER: "write the runbook for X alert", "draft on-call steps for X outage", "document how to respond to X failure", "create the playbook for X incident", "what should on-call do when X", "author the incident response doc for X". DO NOT TRIGGER for: alert rule / SLO definition (use `devops-observability-setup`), CI/CD workflow authoring (use `devops-ci-cd-pipeline`), provisioning infra the runbook touches (use `devops-infrastructure-as-code`), security incident playbook for attack response (security-threat-modeling), QA triage of flaky tests (qa-flaky-test-hunter), architectural retrospective.
when_to_use: The parent `devops` specialist pulls this skill when the task requires documenting the on-call response to a named failure mode. Also fires on explicit user request.
type: specialist
---

# devops-incident-runbook

Implements `guild-plan.md §6.1` (devops · incident-runbook) under `§6.4` engineering principles: the runbook is the evidence that operational knowledge is transferable; a new on-call should be able to follow it at 3am without context.

## What you do

Write a tight, actionable runbook for one named failure mode — not a general troubleshooting guide. The on-call engineer copies commands from it while half-asleep.

- Lead with symptoms: what does the alert look like, what does the user see, what metric/log confirms.
- Provide diagnose steps as copy-pasteable commands with expected output.
- Separate mitigate (stop the bleeding) from fix (address root cause) — mitigate first.
- Include a rollback command or link to the revert workflow.
- Name an owner and an escalation path (next tier, which team / channel, when).
- Link to the postmortem template and the last few incidents of the same class.

## Output shape

A markdown file `runbooks/<alert-slug>.md` with sections:

1. **Alert** — name, severity, what it fires on.
2. **Symptoms** — user-visible and metric-visible.
3. **Diagnose** — commands + expected output, in order.
4. **Mitigate** — immediate containment action(s).
5. **Rollback** — exact command or pipeline step.
6. **Fix** — follow-up to prevent recurrence (may link to a ticket).
7. **Escalation** — who to page, when, how.
8. **Postmortem** — link to template + recent related incidents.

## Anti-patterns

- Vague steps: "check the logs" is not a command.
- Missing ownership — "someone should" = nobody does.
- No escalation — on-call hits a wall and freezes.
- Running diagnosis before mitigation when the site is down.
- Copy of every dashboard with no narrative — on-call drowns.
- Stale runbook — one untouched for a year lies about current topology.

## Handoff

Return the runbook path to the invoking `devops` specialist. The alert rule that links here is owned by `devops-observability-setup`; if the runbook surfaces a gap (missing alert, missing rollback), the devops agent chains back there or into `devops-ci-cd-pipeline`. This skill does not dispatch.
