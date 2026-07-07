/**
 * scripts/__tests__/remote-backend.test.ts
 *
 * RE-4 cross-host — the RemoteTeamBackend + RemoteTransport seam, and the
 * host-router-driven backend selection (CH-1 launcher wiring).
 *
 * Covers:
 *   - MockTransport records connect/spawn/send/teardown (the test double that
 *     makes the whole lifecycle exercisable without real hardware).
 *   - SshRemoteTransport builds the right ssh argv for connect/spawn/send/
 *     teardown via an injected RunFn (live network hop = documented residual).
 *   - RemoteTeamBackend.launch: connect each distinct host → spawn N panes →
 *     hand each its task brief; the orchestrator is NEVER spawned (stays local,
 *     §CH-4); dry-run plans without touching the transport.
 *   - fail-fast: an unreachable host tears down and returns ok:false with zero
 *     panes spawned (a remote team is never half-spawned).
 *   - no-transport / no-resolver guards throw with the RE-4 pointer.
 *   - planTeamRouting: each specialist routed to local tmux vs remote THROUGH
 *     the CR-1 routing function (host id == local ⇒ tmux, else remote).
 */

import {
  RemoteTeamBackend,
  MockTransport,
  SshRemoteTransport,
  buildPrompt,
  type RemoteHostTarget,
  type RemoteTransport,
  type RunFn,
  type RunResult,
  type Specialist,
  type TeamLaunchRequest,
} from "../lib/team-backend";
import { resolveAdapter } from "../lib/pane-adapter";
import { planTeamRouting, type RoutableHost } from "../lib/host-router";
import type { HostCapabilityManifest } from "../write-host-capability";

// ── shared fixtures ──────────────────────────────────────────────────────────

const SPECIALISTS: Specialist[] = [
  { name: "backend", scope: "api + data", dependsOn: ["architect"] },
  { name: "security", scope: "auth audit", dependsOn: [], host_kind: "codex" },
];

function req(overrides: Partial<TeamLaunchRequest> = {}): TeamLaunchRequest {
  return {
    slug: "demo",
    runId: "run-remote-001",
    cwd: "/tmp/repo",
    specialists: SPECIALISTS,
    targetName: "guild-demo",
    mode: "new-session",
    dryRun: false,
    ...overrides,
  };
}

// Every specialist lands on the same remote box here; the per-brand command is
// still chosen by the injected adapter resolver (claude vs codex).
function targetFor(spec: Specialist): RemoteHostTarget {
  return {
    hostId: spec.host_kind === "codex" ? "codex-remote" : "claude-remote",
    hostKind: spec.host_kind ?? "claude",
    endpoint: spec.host_kind === "codex" ? "gpu@codex-box" : "user@claude-box",
  };
}

function backend(transport: RemoteTransport): RemoteTeamBackend {
  return new RemoteTeamBackend({
    transport,
    resolveHostTarget: targetFor,
    resolveAdapter: resolveAdapter({ env: { OPENAI_API_KEY: "sk-x" } }),
  });
}

// ── MockTransport ──────────────────────────────────────────────────────────

describe("MockTransport — records the lifecycle", () => {
  it("connect succeeds by default and is recorded", () => {
    const t = new MockTransport();
    const r = t.connect({ hostId: "h", hostKind: "codex", endpoint: "e" });
    expect(r.ok).toBe(true);
    expect(t.connects).toHaveLength(1);
  });

  it("connect can be made to fail per host (outage sim)", () => {
    const t = new MockTransport({ failConnectFor: (h) => h.hostId === "down" });
    expect(t.connect({ hostId: "down", hostKind: "claude", endpoint: "e" }).ok).toBe(false);
    expect(t.connect({ hostId: "up", hostKind: "claude", endpoint: "e" }).ok).toBe(true);
  });

  it("spawn returns a unique handle and records the command", () => {
    const t = new MockTransport();
    const host = { hostId: "h", hostKind: "codex" as const, endpoint: "e" };
    const h1 = t.spawn(host, { name: "a", scope: "", runId: "r", slug: "s", prompt: "p", hostKind: "codex" }, "cmd-a");
    const h2 = t.spawn(host, { name: "b", scope: "", runId: "r", slug: "s", prompt: "p", hostKind: "codex" }, "cmd-b");
    expect(h1.remoteId).not.toBe(h2.remoteId);
    expect(t.spawns.map((s) => s.command)).toEqual(["cmd-a", "cmd-b"]);
  });
});

// ── SshRemoteTransport (command construction; live hop = residual) ───────────

describe("SshRemoteTransport — ssh argv construction", () => {
  const OK: RunResult = { status: 0, stdout: "", stderr: "" };
  function recordingRun(): { run: RunFn; calls: Array<{ cmd: string; args: string[] }> } {
    const calls: Array<{ cmd: string; args: string[] }> = [];
    const run: RunFn = (cmd, args) => {
      calls.push({ cmd, args });
      return OK;
    };
    return { run, calls };
  }
  const host: RemoteHostTarget = { hostId: "codex-remote", hostKind: "codex", endpoint: "gpu@box" };
  const paneSpec = { name: "security", scope: "audit", runId: "r", slug: "s", prompt: "p", hostKind: "codex" as const };

  it("connect uses a non-interactive BatchMode probe", () => {
    const { run, calls } = recordingRun();
    const ok = new SshRemoteTransport({ run }).connect(host).ok;
    expect(ok).toBe(true);
    expect(calls[0]).toEqual({ cmd: "ssh", args: ["-o", "BatchMode=yes", "gpu@box", "true"] });
  });

  it("connect reports failure when ssh exits non-zero", () => {
    const run: RunFn = () => ({ status: 255, stdout: "", stderr: "Connection refused" });
    const r = new SshRemoteTransport({ run }).connect(host);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/gpu@box/);
  });

  it("spawn runs `ssh <endpoint> <command>` and returns an endpoint-tagged handle", () => {
    const { run, calls } = recordingRun();
    const handle = new SshRemoteTransport({ run }).spawn(host, paneSpec, "codex exec 'p'; exec $SHELL");
    expect(calls[0]).toEqual({ cmd: "ssh", args: ["gpu@box", "codex exec 'p'; exec $SHELL"] });
    expect(handle.endpoint).toBe("gpu@box");
    expect(handle.remoteId).toMatch(/^ssh-gpu@box-/);
  });

  it("send base64-encodes the payload into a remote inbox (no shell-quoting hazard)", () => {
    const { run, calls } = recordingRun();
    const ssh = new SshRemoteTransport({ run });
    const handle = ssh.spawn(host, paneSpec, "cmd");
    ssh.send(handle, 'a payload with "quotes" & $vars');
    const sendCall = calls[calls.length - 1];
    expect(sendCall.cmd).toBe("ssh");
    expect(sendCall.args[0]).toBe("gpu@box");
    expect(sendCall.args[1]).toMatch(/base64 -d > ~\/\.guild\/inbox\//);
  });

  it("teardown best-effort kills each spawned pane", () => {
    const { run, calls } = recordingRun();
    const ssh = new SshRemoteTransport({ run });
    ssh.spawn(host, paneSpec, "cmd");
    ssh.teardown();
    expect(calls.some((c) => c.args.join(" ").includes("pkill"))).toBe(true);
  });
});

// ── RemoteTeamBackend lifecycle ──────────────────────────────────────────────

describe("RemoteTeamBackend — guards", () => {
  it("isAvailable is false without a transport; true with one", () => {
    expect(new RemoteTeamBackend().isAvailable()).toBe(false);
    expect(new RemoteTeamBackend({ transport: new MockTransport() }).isAvailable()).toBe(true);
  });

  it("launch throws without a transport (RE-4 pointer)", () => {
    expect(() => new RemoteTeamBackend().launch(req())).toThrow(/transport|RE-4/i);
  });

  it("launch throws without a host-target resolver", () => {
    const b = new RemoteTeamBackend({ transport: new MockTransport() });
    expect(() => b.launch(req())).toThrow(/host-target resolver|residual/i);
  });
});

describe("RemoteTeamBackend.launch — dry-run", () => {
  it("plans every pane without touching the transport", () => {
    const t = new MockTransport();
    const result = backend(t).launch(req({ dryRun: true }));
    expect(result.ok).toBe(true);
    expect(result.kind).toBe("remote");
    expect(result.plannedCommands).toHaveLength(2);
    // codex specialist's planned command goes through the codex adapter.
    expect(result.plannedCommands.join("\n")).toMatch(/codex exec/);
    expect(t.connects).toHaveLength(0);
    expect(t.spawns).toHaveLength(0);
  });
});

describe("RemoteTeamBackend.launch — real (MockTransport)", () => {
  it("connects each distinct host, spawns one pane per specialist, hands the brief", () => {
    const t = new MockTransport();
    const result = backend(t).launch(req());
    expect(result.ok).toBe(true);
    // Two specialists on two distinct hosts → two connects, two spawns, two sends.
    expect(t.connects.map((h) => h.hostId).sort()).toEqual(["claude-remote", "codex-remote"]);
    expect(t.spawns).toHaveLength(2);
    expect(t.sends).toHaveLength(2);
    // teammate pane ids map specialist → the transport handle id.
    expect(Object.keys(result.teammatePaneIds).sort()).toEqual(["backend", "security"]);
    // The orchestrator is NEVER spawned remotely (stays local, §CH-4).
    expect(result.orchestratorPaneId).toBeNull();
    expect(t.spawns.some((s) => s.spec.name === "orchestrator")).toBe(false);
  });

  it("connects a shared host only once even with multiple specialists on it", () => {
    const t = new MockTransport();
    const sameHost: RemoteHostTarget = { hostId: "one-box", hostKind: "claude", endpoint: "u@one" };
    const b = new RemoteTeamBackend({ transport: t, resolveHostTarget: () => sameHost });
    b.launch(req({ specialists: [
      { name: "a", scope: "", dependsOn: [] },
      { name: "b", scope: "", dependsOn: [] },
    ] }));
    expect(t.connects).toHaveLength(1); // de-duped by hostId
    expect(t.spawns).toHaveLength(2);
  });

  it("hands each pane its own staging prompt as the task brief", () => {
    const t = new MockTransport();
    backend(t).launch(req());
    const securityBrief = t.sends.find((s) => s.handle.specialist === "security")!.payload;
    expect(securityBrief).toBe(buildPrompt("demo", "run-remote-001", SPECIALISTS[1], undefined, "codex"));
  });

  it("a claude-only remote team works without an injected adapter resolver", () => {
    const t = new MockTransport();
    const b = new RemoteTeamBackend({
      transport: t,
      resolveHostTarget: () => ({ hostId: "claude-remote", hostKind: "claude", endpoint: "u@box" }),
    });
    const result = b.launch(req({ specialists: [{ name: "backend", scope: "api", dependsOn: [] }] }));
    expect(result.ok).toBe(true);
    expect(t.spawns[0].command).toMatch(/CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1/);
  });
});

describe("RemoteTeamBackend.launch — fail-fast on unreachable host", () => {
  it("tears down and returns ok:false with ZERO panes spawned", () => {
    const t = new MockTransport({ failConnectFor: (h) => h.hostId === "codex-remote" });
    const result = backend(t).launch(req());
    expect(result.ok).toBe(false);
    expect(result.notes.join(" ")).toMatch(/connect failed: codex-remote/);
    // Nothing spawned — a remote team is never half-spawned.
    expect(t.spawns).toHaveLength(0);
    expect(t.sends).toHaveLength(0);
    expect(t.teardowns).toBe(1);
    expect(result.teammatePaneIds).toEqual({});
  });
});

describe("RemoteTeamBackend.teardown — delegates to the transport", () => {
  it("calls transport.teardown(); safe to call with no transport", () => {
    const t = new MockTransport();
    backend(t).teardown();
    expect(t.teardowns).toBe(1);
    expect(() => new RemoteTeamBackend().teardown()).not.toThrow();
  });
});

// ── planTeamRouting (CH-1 backend selection via host-router) ─────────────────

const NOW = Date.parse("2026-05-26T12:00:00Z");
const FRESH = "2026-05-26T11:59:00Z";

function host(overrides: Partial<RoutableHost> = {}): RoutableHost {
  const base: HostCapabilityManifest = {
    schema_version: "guild.host_capability.v1",
    host_id: "claude",
    host_kind: "claude",
    // TE-07: canonical field names
    advertised_at: FRESH,
    source: "test",
    tier_models: { cheap: "haiku", mid: "sonnet", powerful: "opus" },
    supported_tiers: ["cheap", "mid", "powerful"],
    models: ["haiku", "sonnet", "opus"],
    tool_support: { subagent: true, agent_team: true, independent_agents: true, tmux: true, mcp: true, pre_tool_use_ask: true },
  };
  return { ...base, ...overrides } as RoutableHost;
}

function codexRemote(overrides: Partial<RoutableHost> = {}): RoutableHost {
  return host({
    host_id: "codex-remote",
    host_kind: "codex",
    // TE-07: canonical field names
    tier_models: { cheap: "gpt-4o-mini", mid: "gpt-4o", powerful: "o3" },
    supported_tiers: ["cheap", "mid", "powerful"],
    models: ["gpt-4o-mini", "gpt-4o", "o3"],
    tool_support: { subagent: true, agent_team: false, independent_agents: false, tmux: false, mcp: true, pre_tool_use_ask: false },
    ...overrides,
  });
}

describe("planTeamRouting — local tmux vs remote, via host-router", () => {
  const opts = { localHostId: "claude", crossHostEnabled: true, now: NOW };

  it("a specialist resolving to the local host → tmux backend", () => {
    const routes = planTeamRouting([{ name: "architect", scope: "x", dependsOn: [] }], [host(), codexRemote()], opts);
    expect(routes[0].backend).toBe("tmux");
    expect(routes[0].decision.host).toBe("claude");
  });

  it("a codex-preferring specialist resolving to a remote host → remote backend", () => {
    const routes = planTeamRouting(
      [{ name: "security", scope: "audit", dependsOn: [], host_kind: "codex" }],
      [host(), codexRemote()],
      opts
    );
    expect(routes[0].backend).toBe("remote");
    expect(routes[0].decision.host).toBe("codex-remote");
    expect(routes[0].hostKind).toBe("codex");
  });

  it("partitions a mixed team into local + remote lanes", () => {
    const routes = planTeamRouting(
      [
        { name: "architect", scope: "x", dependsOn: [] },
        { name: "security", scope: "audit", dependsOn: [], host_kind: "codex" },
      ],
      [host(), codexRemote()],
      opts
    );
    const byName = Object.fromEntries(routes.map((r) => [r.specialist, r.backend]));
    expect(byName).toEqual({ architect: "tmux", security: "remote" });
  });

  it("cross-host disabled ⇒ everything resolves to the local host (tmux)", () => {
    const routes = planTeamRouting(
      [{ name: "security", scope: "audit", dependsOn: [], host_kind: "codex" }],
      [host(), codexRemote()],
      { localHostId: "claude", crossHostEnabled: false, now: NOW }
    );
    // codex host filtered out; the lane falls back to local claude.
    expect(routes[0].backend).toBe("tmux");
  });

  it("TE-02: returns degraded decision when a lane cannot be fully satisfied", () => {
    // team mode needs agent_team; only codex (no agent_team) present → degrade-not-throw.
    const routes = planTeamRouting(
      [{ name: "x", scope: "", dependsOn: [] }],
      [codexRemote()],
      { localHostId: "claude", crossHostEnabled: true, mode: "team", now: NOW }
    );
    expect(routes).toHaveLength(1);
    expect(routes[0].decision.degraded).toBe(true);
    expect(routes[0].decision.independence).toBe("weak");
    expect(routes[0].decision.rejected.length).toBeGreaterThan(0);
  });
});
