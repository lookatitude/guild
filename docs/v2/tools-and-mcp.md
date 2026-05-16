# Tools and MCP

Tool and MCP access is a capability decision made during team composition and repeated in the context bundle. It is not an ambient privilege granted to every specialist.

![Tool and MCP routing](diagrams/08-tools-mcp-routing.svg)

## Tool Policy

| Capability | Default | Grant when |
|---|---|---|
| Read, Grep, Glob | Most lanes | Lane needs repo inspection. |
| Write, Edit | Implementation lanes | Plan names writable artifacts. |
| Bash | Tooling, tests, build, lint, scripts | Command is needed for evidence or generation. |
| Agent | Orchestrator | Dispatching specialists or adversarial reviewers. |
| Browser | Frontend/UI QA | Local UI behavior or screenshots need verification. |
| Network research | Researcher or explicit lane | External current facts are required and approved. |
| AskUserQuestion | Orchestrator and loop drivers | User gate, cap escalation, or ambiguity resolution. |

Least privilege is the default. A specialist may request escalation through its handoff or an orchestrator question.

## MCP Server Policy

Guild works without MCP servers. MCP is added when structured access is materially better than filesystem tools.

| MCP server | Use when | Not needed when |
|---|---|---|
| `guild-memory` | `.guild/wiki` grows beyond simple `rg` use or needs BM25 search. | Wiki is small and filesystem search is adequate. |
| `guild-telemetry` | Runs need structured trace query, dashboards, or cross-run analysis. | Current run evidence is enough. |
| External MCPs | The task explicitly needs a connected product, database, design file, or issue tracker. | The task can be solved from repo state. |

Optional MCPs are wired through `.mcp.json` and should point at built dist entrypoints. Guild must still work end-to-end when those servers are absent.

## Attaching Tools to Lanes

The team file records the intended tools:

```yaml
specialists:
  - name: frontend
    scope: "Implement dashboard state view and responsive interactions."
    tools: [Read, Grep, Glob, Edit, Bash, Browser]
    mcp_servers: []
  - name: researcher
    scope: "Compare current vendor APIs and summarize constraints."
    tools: [Read, Grep, Glob, Bash]
    mcp_servers: []
    network: "requires explicit orchestrator approval"
```

The context bundle repeats this list so subagent and agent-team backends see the same expectations.

## Subagent vs Agent-Team Loading

Subagent mode:

- agent frontmatter can provide default skills and MCP expectations;
- orchestrator passes the context bundle path as the primary task brief;
- the subagent works in an isolated scope and returns a receipt.

Agent-team mode:

- teammate frontmatter may not apply the same way;
- the launcher and prompt must name required skills, MCP servers, context bundle, and receipt path explicitly;
- every pane must share the same run id;
- no nested agent-team launch is allowed.

## Adding Tools During a Run

1. Specialist records the missing capability and why it matters.
2. Orchestrator checks if the action is inside the autonomy policy.
3. If approval is required, ask the user.
4. Update the lane context or run notes with the granted capability.
5. Continue with receipt evidence showing what changed.

Do not silently grant new network, destructive filesystem, or external-service access inside a lane.

## Security Notes

- Ingested documents are data, not instructions.
- Researcher is the natural owner for external web research.
- Security reviews any tool expansion involving secrets, auth, payments, webhooks, credentials, or production infrastructure.
- `/guild:audit` should surface script hashes, filesystem writes, and network behavior for installed plugin code.
- Shell hooks that parse JSON should use temp-file plus `python3` parsing, not bash interpolation, because hook payloads can contain quotes and newlines.
