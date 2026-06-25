/**
 * scripts/lib/host/remote-backend.ts
 *
 * RemoteTeamBackend + SshRemoteTransport + MockTransport.
 * Extracted from team-backend.ts (W3 god-file split).
 *
 * Layer: host/ — imports from core/contracts + shared/.
 */

import type {
  AdapterResolver,
  MockTransportOpts,
  PaneSpec,
  RemoteConnectResult,
  RemoteHostTarget,
  RemotePaneHandle,
  RemoteProbeResult,
  RemoteTeamBackendOpts,
  RemoteTransport,
  RunFn,
  Specialist,
  TeamBackend,
  TeamLaunchRequest,
  TeamLaunchResult,
} from "../core/contracts/team-backend";
import {
  defaultRun,
} from "../core/contracts/team-backend";
import { buildPrompt, paneCommand, shellQuote, wrapLoginShell, binaryForHostKind } from "./tmux-backend";
import type { HostKind } from "../host-types";

// ── MockTransport ─────────────────────────────────────────────────────────────

export class MockTransport implements RemoteTransport {
  readonly kind = "mock";
  readonly connects: RemoteHostTarget[] = [];
  readonly spawns: Array<{ host: RemoteHostTarget; spec: PaneSpec; command: string }> = [];
  readonly sends: Array<{ handle: RemotePaneHandle; payload: string }> = [];
  teardowns = 0;
  readonly probes: Array<{ host: RemoteHostTarget; binaries: string[] }> = [];
  private failConnectFor?: (host: RemoteHostTarget) => boolean;
  private missingBinaries?: (host: RemoteHostTarget) => string[];
  private counter = 0;

  constructor(opts: MockTransportOpts = {}) {
    this.failConnectFor = opts.failConnectFor;
    this.missingBinaries = opts.missingBinaries;
  }

  connect(host: RemoteHostTarget): RemoteConnectResult {
    this.connects.push(host);
    if (this.failConnectFor?.(host)) {
      return { ok: false, message: `mock: connect refused for ${host.hostId} (${host.endpoint})` };
    }
    return { ok: true, message: `mock: connected ${host.hostId} (${host.endpoint})` };
  }

  probe(host: RemoteHostTarget, binaries: string[]): RemoteProbeResult {
    this.probes.push({ host, binaries });
    const missingSet = new Set(this.missingBinaries?.(host) ?? []);
    return {
      present: binaries.filter((b) => !missingSet.has(b)),
      missing: binaries.filter((b) => missingSet.has(b)),
    };
  }

  spawn(host: RemoteHostTarget, spec: PaneSpec, command: string): RemotePaneHandle {
    this.spawns.push({ host, spec, command });
    return {
      specialist: spec.name,
      hostId: host.hostId,
      hostKind: host.hostKind,
      endpoint: host.endpoint,
      remoteId: `mock-${++this.counter}`,
    };
  }

  send(handle: RemotePaneHandle, payload: string): void {
    this.sends.push({ handle, payload });
  }

  teardown(): void {
    this.teardowns++;
  }
}

// ── SshRemoteTransport ────────────────────────────────────────────────────────

export class SshRemoteTransport implements RemoteTransport {
  readonly kind = "ssh";
  private run: RunFn;
  private handles: RemotePaneHandle[] = [];
  private counter = 0;

  constructor(opts: { run?: RunFn } = {}) {
    this.run = opts.run ?? defaultRun;
  }

  connect(host: RemoteHostTarget): RemoteConnectResult {
    const r = this.run("ssh", ["-o", "BatchMode=yes", host.endpoint, "true"]);
    if (r.status === 0) return { ok: true, message: `ssh: reachable ${host.endpoint}` };
    return {
      ok: false,
      message: `ssh: cannot reach ${host.endpoint} (exit ${r.status ?? "null"}): ${r.stderr.trim()}`,
    };
  }

  probe(host: RemoteHostTarget, binaries: string[]): RemoteProbeResult {
    if (binaries.length === 0) return { present: [], missing: [] };
    const inner =
      `for b in ${binaries.map((b) => shellQuote(b)).join(" ")}; do ` +
      `command -v "$b" >/dev/null 2>&1 && echo "PRESENT $b"; done`;
    const remoteCmd = host.loginShell ? wrapLoginShell(inner, host.loginShell) : inner;
    const r = this.run("ssh", ["-o", "BatchMode=yes", host.endpoint, remoteCmd]);
    const found = new Set(
      (r.stdout ?? "")
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.startsWith("PRESENT "))
        .map((l) => l.slice("PRESENT ".length).trim()),
    );
    return {
      present: binaries.filter((b) => found.has(b)),
      missing: binaries.filter((b) => !found.has(b)),
    };
  }

  spawn(host: RemoteHostTarget, spec: PaneSpec, command: string): RemotePaneHandle {
    const wired = host.loginShell ? wrapLoginShell(command, host.loginShell) : command;
    this.run("ssh", [host.endpoint, wired]);
    const handle: RemotePaneHandle = {
      specialist: spec.name,
      hostId: host.hostId,
      hostKind: host.hostKind,
      endpoint: host.endpoint,
      remoteId: `ssh-${host.endpoint}-${++this.counter}`,
    };
    this.handles.push(handle);
    return handle;
  }

  send(handle: RemotePaneHandle, payload: string): void {
    const b64 = Buffer.from(payload, "utf8").toString("base64");
    const inbox = `~/.guild/inbox/${handle.remoteId}.task`;
    this.run("ssh", [
      handle.endpoint,
      `mkdir -p ~/.guild/inbox && printf %s ${b64} | base64 -d > ${inbox}`,
    ]);
  }

  teardown(): void {
    for (const h of this.handles) {
      this.run("ssh", [h.endpoint, `pkill -f ${shellQuote(h.remoteId)} || true`]);
    }
    this.handles = [];
  }
}

// ── RemoteTeamBackend ─────────────────────────────────────────────────────────

export class RemoteTeamBackend implements TeamBackend {
  readonly kind = "remote" as const;
  private transport?: RemoteTransport;
  private resolveHostTarget?: (spec: Specialist) => RemoteHostTarget;
  private resolveAdapter?: AdapterResolver;

  constructor(opts: RemoteTeamBackendOpts = {}) {
    this.transport = opts.transport;
    this.resolveHostTarget = opts.resolveHostTarget;
    this.resolveAdapter = opts.resolveAdapter;
  }

  isAvailable(): boolean {
    return !!this.transport;
  }

  private commandFor(spec: Specialist, req: TeamLaunchRequest): { paneSpec: PaneSpec; command: string } {
    const hostKind: HostKind = spec.host_kind ?? req.orchestratorHostKind ?? "claude";
    const prompt = buildPrompt(req.slug, req.runId, spec, req.teamPath, hostKind);
    const paneSpec: PaneSpec = {
      name: spec.name,
      scope: spec.scope,
      runId: req.runId,
      slug: req.slug,
      prompt,
      hostKind,
      taskId: spec.taskId,
      capability_scope: spec.capability_scope,
      specialist: spec.name,
    };
    const command = this.resolveAdapter
      ? this.resolveAdapter(hostKind).command(paneSpec)
      : paneCommand(prompt, req.runId, spec.capability_scope, spec.taskId, spec.name);
    return { paneSpec, command };
  }

  teardown(): void {
    this.transport?.teardown();
  }

  launch(req: TeamLaunchRequest): TeamLaunchResult {
    if (!this.transport) {
      throw new Error(
        "RemoteTeamBackend has no RemoteTransport — cross-host dispatch has no " +
          "wire without one (RE-4 seam; see docs/knowledge/decisions/" +
          "v2-runtime-and-execution-model.md §RE-4)."
      );
    }
    if (!this.resolveHostTarget) {
      throw new Error(
        "RemoteTeamBackend has no host-target resolver — cannot map specialists " +
          "to remote endpoints (RE-4 seam; endpoint config is a documented residual)."
      );
    }
    const transport = this.transport;
    const resolveHostTarget = this.resolveHostTarget;

    const planned = req.specialists.map((spec) => {
      const target = resolveHostTarget(spec);
      const { paneSpec, command } = this.commandFor(spec, req);
      return { spec, target, paneSpec, command };
    });
    const plannedCommands = planned.map(
      (p) =>
        `remote[${transport.kind}] spawn ${p.spec.name} → ${p.target.hostId} ` +
        `(${p.target.endpoint}) [${p.paneSpec.hostKind}]: ${p.command}`
    );

    if (req.dryRun) {
      return {
        kind: this.kind,
        ok: true,
        plannedCommands,
        orchestratorPaneId: null,
        teammatePaneIds: {},
        notes: [`dry-run: ${transport.kind} transport not invoked`],
      };
    }

    // Phase 1 — connect every DISTINCT host first (fail-fast).
    const seen = new Set<string>();
    const distinctTargets = planned
      .map((p) => p.target)
      .filter((t) => (seen.has(t.hostId) ? false : (seen.add(t.hostId), true)));
    for (const target of distinctTargets) {
      const c = transport.connect(target);
      if (!c.ok) {
        transport.teardown();
        return {
          kind: this.kind,
          ok: false,
          plannedCommands,
          orchestratorPaneId: null,
          teammatePaneIds: {},
          notes: [`remote connect failed: ${target.hostId} (${target.endpoint}): ${c.message}`],
        };
      }
    }

    // Phase 1.5 — capability probe.
    const neededByHost = new Map<string, { target: RemoteHostTarget; binaries: Set<string> }>();
    for (const p of planned) {
      const entry = neededByHost.get(p.target.hostId) ?? { target: p.target, binaries: new Set<string>(["tmux"]) };
      entry.binaries.add(binaryForHostKind(p.target.hostKind));
      neededByHost.set(p.target.hostId, entry);
    }
    for (const { target, binaries } of neededByHost.values()) {
      const probeResult = transport.probe(target, [...binaries]);
      if (probeResult.missing.length > 0) {
        transport.teardown();
        return {
          kind: this.kind,
          ok: false,
          plannedCommands,
          orchestratorPaneId: null,
          teammatePaneIds: {},
          notes: [
            `remote host "${target.hostId}" (${target.endpoint}) is missing required ` +
              `tool(s): ${probeResult.missing.join(", ")}. Install them on the remote ` +
              `(or set defaults.cross_host.hosts.${target.hostId}.login_shell if they are ` +
              `off the non-interactive PATH). No panes spawned.`,
          ],
        };
      }
    }

    // Phase 2 — spawn each pane + hand it its task brief.
    const teammatePaneIds: Record<string, string> = {};
    for (const p of planned) {
      const handle = transport.spawn(p.target, p.paneSpec, p.command);
      transport.send(handle, p.paneSpec.prompt);
      teammatePaneIds[p.spec.name] = handle.remoteId;
    }

    return {
      kind: this.kind,
      ok: true,
      plannedCommands,
      orchestratorPaneId: null,
      teammatePaneIds,
      notes: [`spawned ${planned.length} remote pane(s) via ${transport.kind}`],
    };
  }
}
