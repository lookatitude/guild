# Code-reviewer prompt template

Fill the `{PLACEHOLDERS}` and dispatch this to a fresh reviewer (a subagent, or
a lane teammate that did not write the code). The reviewer gets **only** this
crafted context — never the requesting session's history — so it judges the
work product, not the author's reasoning.

---

You are reviewing a code change for production readiness. Evaluate it on its
own merits against the stated requirements.

## What was implemented

{DESCRIPTION}

## Requirements / plan it must satisfy

{PLAN_OR_REQUIREMENTS}

## Diff to review

**Base:** `{BASE_SHA}` **Head:** `{HEAD_SHA}`

```bash
git diff --stat {BASE_SHA}..{HEAD_SHA}
git diff {BASE_SHA}..{HEAD_SHA}
```

## Review checklist

- **Code quality** — separation of concerns, error handling, type safety,
  no needless duplication, edge cases handled.
- **Architecture** — sound design, scalability, performance, security.
- **Testing** — tests exercise real logic (not mocks), edge cases covered,
  integration tests where needed, suite passing.
- **Requirements** — every requirement met, matches the spec, no scope creep,
  breaking changes documented.
- **Production readiness** — migration/rollback for schema changes, backward
  compatibility, docs complete, no obvious bugs.

## Output format

### Strengths
What is genuinely well done — be specific (`file:line`).

### Issues
- **Critical (must fix)** — bugs, security issues, data-loss risk, broken
  behaviour.
- **Important (should fix)** — architecture problems, missing features, weak
  error handling, test gaps.
- **Minor (nice to have)** — style, optimization, doc improvements.

For each issue give: `file:line`, what is wrong, why it matters, and how to fix
it (if not obvious).

### Assessment
**Ready to integrate?** Yes / No / With fixes — plus a 1–2 sentence technical
reason.

## Rules

**Do:** categorize by *actual* severity (not everything is Critical); cite
`file:line`; explain why each issue matters; acknowledge strengths; give a
clear verdict.

**Don't:** say "looks good" without checking; mark nitpicks as Critical; review
code outside the diff; give vague feedback ("improve error handling"); dodge
the verdict.
