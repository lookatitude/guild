---
name: models
description: "Routing inspection — `models inspect` prints this run's model-routing evidence: identity trust, target evidence, catalog age + per-model evidence_state, policy rule path, selected model/effort, frozen fallbacks, actual model, review independence, and degradation. READ-ONLY (writes nothing) with honest unknowns: an unbindable field prints as `unknown`, never a guess. Delegates every judgement to the canonical inspection service; the rendered output is scrubbed through Guild's canonical redaction applier and the command fails closed rather than print a secret."
argument-hint: "inspect [--run-id <id>] [--json] [--cwd <repo-root>]"
allowed-tools: Read, Bash
---

# /guild:models — model-routing inspection (read-only)

One sub-verb: **`inspect`**. It answers "which model is this run actually
using, on what evidence?" without changing anything. **No phase** — it acts on
a run that already exists. Read-only **R**: it writes no file, creates no
directory, and starts no run.

## Args & local flags

- Args: `inspect` (required; the only public sub-verb — adding another is a
  requires-confirmation change)
- `--run-id <id>` — inspect this run. Without it the command uses the
  intake-only candidate run id and **labels** that in the output, so you can
  see which run you are reading.
- `--json` — emit the same view model as JSON. Text and JSON render from ONE
  view model, so no host surface can show different labels than another.
- `--cwd <repo-root>` — the repo that owns `.guild/` (default: current dir).

## Gates

None — **R** (read-only). No run-start preflight and no run recording: this
command deliberately does not open, touch, or close a run.

## Output

Prints the report (no file written).

## Dispatch

Run the command CLI and show its output verbatim:

```bash
npx tsx ${GUILD_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT}}/scripts/models-cmd.ts inspect \
  --cwd "$(pwd)"
# add --run-id <id> to pin a run; add --json for the machine view
```

Exit codes: `0` report emitted · `1` usage error · `2` no run could be
resolved (pass `--run-id`) · `3` **failed closed** — either the per-field
display validator refused a field (it printed `<REJECTED:<category>:<12-hex>>`
in its place, in text and in JSON) or the fully rendered report tripped the
canonical redaction applier. On `3`, report the failure and the field name;
never reconstruct the rejected value, and never re-read the artifact to
"show what it really said" — the refusal is the point.

**Every row is REBUILT, never echoed.** A persisted inspection report under
`.guild/runs/<id>/inspection/` is a plain writable file, so it is treated as an
UNTRUSTED POINTER: it supplies the label only, and every claim is rebuilt
through the canonical inspection service from artifacts that verify themselves
(the run's frozen `guild.session_context.v1`, the content-addressed catalog
snapshot). If the persisted file asserts something those artifacts do not
support, the output prints `UNTRUSTED CLAIM(S) NOT SUPPORTED BY VERIFIED
ARTIFACTS` and NAMES the fields — present that line verbatim; it means someone
or something wrote a claim the evidence does not back.

What the report shows, per inspection entry:

| Block | Meaning |
| --- | --- |
| `host` / `identity` | host family + surface; identity source, trust, confidence, evidence |
| `target` | target id, provider kind, auth mode |
| `catalog` | catalog state, discovery age, TTL, staleness, generation, and every model row with its own `evidence_state` |
| `policy` | whether a policy was bound, its short hash, and the rule path taken |
| `selection` | selected model + effort with the evidence state that backs it |
| `fallbacks` | frozen fallback chain length + short hash |
| `outcome` | finalized?, status, **actual** model (never inferred from the requested one) |
| `independence` | only from a written, hash-bound adjudication — otherwise `unknown` |
| `degradation` | recorded degradation kind + note |
| `UNKNOWNS` | every field the report could not bind, verbatim |

Reading rules — state these when you present the output:

- **`unknown` is a finding, not a formatting artifact.** It means the field was
  not bindable from evidence. Do not fill one in from context, from the
  requested model, or from a previous run.
- **`asserted` ≠ `verified`.** An asserted identity or an unknown actual
  reviewer model can never satisfy a strong-independence claim.
- **Nothing here is a secret.** Every displayed field is validated before it is
  formatted: identifier fields must be short canonical tokens and must not be
  reversible endpoint/account identities, free-text fields must survive the
  canonical redaction applier untouched, and hashes print as 12-char prefixes.
  A `<REJECTED:...>` marker means the value was refused, not shortened — if you
  need a full hash, read the artifact under `.guild/runs/<run-id>/`.

Thin entrypoint: the report is built by the canonical inspection service
(`buildModelInspection`) over artifacts other phases already wrote. This
command never discovers models, never resolves a policy, and never composes a
team — it only reads, renders, and refuses to leak.
