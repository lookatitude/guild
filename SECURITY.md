# Security policy

Guild ships scripts and hooks that run inside your Claude Code session.
This document explains the trust model and how we handle security.

## Trust model

### What Guild executes

- **Hook scripts** under `hooks/` run on every Claude Code
  `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`,
  `PreCompact`, `SubagentStop`, `Stop`, `TaskCreated`, `TaskCompleted`,
  and `TeammateIdle` event.
  See [hooks/hooks.json](hooks/hooks.json) for the full wiring and
  the Guild docs site → `https://guildstack.dev/docs/architecture` for each event's purpose.
- **Tooling scripts** under `scripts/` run only when invoked by a skill
  or by `/guild evolve`, `/guild rollback`, etc. They are not auto-run.
- **MCP servers** under `mcp-servers/` run as long-lived stdio subprocesses
  when Claude Code loads the plugin. Both are **read-only** — verified
  mechanically (no `writeFile` / `appendFile` calls in `src/`).
- **Skills** are Markdown with YAML frontmatter. They contain no
  executable code; they are interpreted by Claude, not by the shell.
- **Agents** are similarly Markdown definitions, not executable code.

### What Guild does NOT do

- No host-native web tool is granted by default outside the `researcher` role.
  Only the `researcher` shipping
  specialist template (`templates/specialists/researcher.md`) declares
  `WebFetch` / `WebSearch`
  in its `tools:` frontmatter. All meta-skills are filesystem-only by
  policy. A different specialist can receive a network-capable tool only
  through an explicit, task-scoped operator approval recorded before dispatch;
  any default-policy change must be flagged and justified in a PR. This claim
  is deliberately limited to `WebFetch` / `WebSearch`: build roles may receive
  `Bash`, whose commands remain governed by the approved task autonomy and
  network policy rather than being classified as network-free by tool name.
- No credentials are read, stored, or transmitted.
- No data is sent to telemetry endpoints. `.guild/runs/` and
  `.guild/wiki/` are **project-local** and never leave your machine.
- No auto-updates. Version changes flow through the standard
  `/plugin update guild@guild` path under your explicit control.

### The `/guild audit` command

Guild ships a built-in security audit at
[commands/audit.md](commands/audit.md) that delegates to
[skills/meta/audit/SKILL.md](skills/meta/audit/SKILL.md). Run it
whenever you install or update a Guild fork:

```text
/guild audit
```

It produces a static report at `.guild/audit/<YYYY-MM-DD>.md`
enumerating every hook, script, and MCP server with:

- SHA-256 hash (changes flag upstream drift)
- Lines of code
- Any network-call evidence (`fetch`, `http`, `WebFetch`)
- Any filesystem write outside `.guild/runs/` / `.guild/evolve/`
- Declared `tools:` / `allowed-tools:` scope

### Release-attestation signing custody

The external `scripts/sign-release-attestation.ts` tool is not invoked by hooks
or ordinary Guild sessions. In production mode it requires an explicit
`--custody-root-path` with these enforced properties:

- the custody root and every participating directory are owned by the current
  OS user, are real directories rather than symlinks, and use mode `0700`;
- signing material, the used-key registry, output, and both lock positions stay
  strictly beneath that root;
- signing material is a direct child of the root, and production accepts only
  `<custody-root>/used-one-time-keys.json` as its registry, preventing callers
  from partitioning custody or one-time-key history across alternate roots and
  registries;
- a custody-wide exclusive lock spans material admission, one-time-key
  reservation, and output publication; and
- the held root descriptor is revalidated for protection and matched by
  device/inode to the named custody root before the operation returns.

This is a trusted single-user custody boundary, not protection from arbitrary
concurrent mutation by another process running as the same OS user. The lock
serializes cooperating signer processes only. A production custodian must use a
dedicated account or otherwise guarantee that no uncooperative same-user process
can mutate the custody tree during signing. Private key material remains external
to the repository and must never be committed.

FU04 root rotation uses the same signer through two explicit subcommands. An
operator first prepares a public `guild.journal_attestor_root_candidate.v1`
manifest containing one fresh replacement root for each of the three source-owned
attestor identities. Each independent custodian then runs
`root-admission-prove` against that same manifest and its own external material;
the command consumes one key in that custodian's existing durable registry and
emits only a domain-separated `nra1:` possession proof. After all three public
proofs are collected, `root-admission-verify` assembles them into a public
`guild.journal_attestor_root_admission.v1` record.

The admission record proves only that valid one-time signing material existed
for all three proposed roots over the exact same candidate manifest. The tool
rejects incomplete or duplicate proof sets, any currently pinned fixture-era
root, a stale predecessor-root digest, and any proof rooted in a different
manifest. Every manifest, proof, and bundle states
`external_custody_verified: false` and `authorizes_rotation: false`. Independent
custody review and the actual source trust-root change remain separate required
gates; this tool cannot perform or approve either one.

## Install only from trusted sources

Echoing Anthropic's standard guidance: **install Guild only from
sources you trust.** Forks from third parties may have modified
hooks, skills, or MCP servers that behave differently from the
upstream release. Before installing a non-canonical Guild:

1. Clone it locally.
2. Run `/guild audit` against the cloned copy.
3. Compare its hashes to the upstream release tags at
   [github.com/lookatitude/guild](https://github.com/lookatitude/guild).
4. Look for any hook script that writes outside `.guild/` or any
   specialist declaring `WebFetch` / `WebSearch` beyond `researcher`.

Unknown network access from a non-researcher specialist is a red flag;
it is not present in the upstream release.

## Reporting a vulnerability

If you find a security-relevant issue in Guild, please do **not** open
a public GitHub issue. Instead:

- Email: `security@lookatitude.com` with `[Guild security]` in the
  subject.
- Include: the affected file, a minimal reproducer, Claude Code version,
  and the output of `/guild audit` at the affected commit if possible.

We'll acknowledge receipt within 3 business days and aim to ship a fix
or mitigation within 14 days of confirmation.

## Known risk categories

These are mitigations that ship in v2. Any future contribution that
weakens one of them should be explicitly called out in its PR.

| Risk | Mitigation |
|---|---|
| Cross-group trigger collisions | Pushy `TRIGGER` / `DO NOT TRIGGER` blocks + boundary evals under `tests/boundary/` |
| Stop hook fires on non-task sessions → spurious reflections | Heuristic gate in `hooks/maybe-reflect.ts` (≥1 specialist + ≥1 edit + no error) |
| Evolution loop overfits to its own evals | Versioned skill snapshots + held-out evals + shadow-mode |
| Arbitrary code in installed skills | `/guild audit` (this command) + the trust-source guidance above |
| Meta-skills gaining network access | Meta-skills are filesystem-restricted by convention; any change must be flagged and justified in a PR |

## Version support

We support the current major release (`2.x`). Security fixes are
backported one minor version. Pre-release tags (`-beta<N>`) receive
fixes only through the next pre-release; we do not backport to older
pre-releases.
