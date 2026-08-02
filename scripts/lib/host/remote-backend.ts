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
  dispatchModelForSpecialist,
  dispatchModelParamsForSpecialist,
} from "../core/contracts/team-backend";
import {
  buildPrompt,
  paneCommand,
  shellQuote,
  wrapLoginShell,
  binaryForHostKind,
} from "./tmux-backend";
import type { HostKind } from "../host-types";

// ── MockTransport ─────────────────────────────────────────────────────────────

export class MockTransport implements RemoteTransport {
  readonly kind = "mock";
  readonly connects: RemoteHostTarget[] = [];
  readonly spawns: Array<{ host: RemoteHostTarget; spec: PaneSpec; command: string }> = [];
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
      loginShell: host.loginShell,
    };
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
    // The session name IS the remoteId — that's what makes teardown's
    // `tmux kill-session -t <remoteId>` an exact, guaranteed match (a bare
    // `pkill -f <remoteId>` can never match anything: remoteId is generated
    // client-side and never appears in the remote process's argv/cmdline).
    // Uniqueness: a per-instance counter alone collides across transport
    // INSTANCES (the launcher builds a fresh transport per dispatch, so every
    // first pane for an endpoint would be `...-1` and `tmux new-session -s`
    // refuses duplicate session names). process.pid disambiguates concurrent
    // and successive dispatches. tmux session names may not contain '.' or
    // ':' — sanitize the endpoint portion.
    const sessionEndpoint = host.endpoint.replace(/[.:]/g, "-");
    const remoteId = `ssh-${sessionEndpoint}-${process.pid}-${++this.counter}`;
    // Wrap in a DETACHED tmux session so the pane outlives this ssh call.
    // A bare `ssh host '<long-running command>'` blocks this spawnSync call
    // forever (or until the lane process exits) — that can never work for a
    // real dispatched lane, only for the short synchronous probes this
    // transport also runs (connect/probe).
    const tmuxCmd = `tmux new-session -d -s ${shellQuote(remoteId)} ${shellQuote(command)}`;
    const wired = host.loginShell ? wrapLoginShell(tmuxCmd, host.loginShell) : tmuxCmd;
    const r = this.run("ssh", [host.endpoint, wired]);
    if (r.status !== 0) {
      // Surface the failure — silently returning a handle would let the
      // backend report ok:true for a pane that never existed.
      throw new Error(
        `remote spawn failed on ${host.endpoint} (ssh/tmux exit ${r.status ?? "null"}): ` +
          `${(r.stderr ?? "").trim().slice(0, 400) || "no stderr"}`,
      );
    }
    const handle: RemotePaneHandle = {
      specialist: spec.name,
      hostId: host.hostId,
      hostKind: host.hostKind,
      endpoint: host.endpoint,
      remoteId,
      loginShell: host.loginShell,
    };
    this.handles.push(handle);
    return handle;
  }

  teardown(): void {
    for (const h of this.handles) {
      const killCmd = `tmux kill-session -t ${shellQuote(h.remoteId)} 2>/dev/null || true`;
      const wired = h.loginShell ? wrapLoginShell(killCmd, h.loginShell) : killCmd;
      this.run("ssh", [h.endpoint, wired]);
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
    // T6-R2-F5: a remote lane spawns at the same evidenced-M2 selection a local
    // pane would — one consumption rule, every backend (absent ⇒ legacy bytes).
    const model = dispatchModelForSpecialist(spec) ?? undefined;
    const modelParams = dispatchModelParamsForSpecialist(spec);
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
      ...(model !== undefined ? { model } : {}),
      ...(modelParams !== undefined ? { modelParams } : {}),
    };
    const command = this.resolveAdapter
      ? this.resolveAdapter(hostKind).command(paneSpec)
      : paneCommand(
          prompt,
          req.runId,
          spec.capability_scope,
          spec.taskId,
          spec.name,
          undefined, // keep paneCommand's own GUILD_PANE_DEBUG default
          model,
        );
    return { paneSpec, command };
  }

  teardown(): void {
    this.transport?.teardown();
  }

  launch(req: TeamLaunchRequest): TeamLaunchResult {
    if (!this.transport) {
      throw new Error(
        "RemoteTeamBackend has no RemoteTransport — cross-host dispatch has no " +
          "wire without one (RE-4 seam; see .guild/wiki/decisions/" +
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

    // Phase 2 — spawn each pane. The task brief needs no separate delivery: the
    // full prompt is already the pane command's argv (`p.command`, built by
    // commandFor/paneCommand), and GUILD_TASK_ASSIGNMENT is already exported
    // into that same command's env (docs/v2 §08 `guild.task_assignment.v1`).
    const teammatePaneIds: Record<string, string> = {};
    for (const p of planned) {
      let handle: RemotePaneHandle;
      try {
        handle = transport.spawn(p.target, p.paneSpec, p.command);
      } catch (err) {
        // A failed spawn must not report ok:true. Tear down any panes we did
        // spawn so a partial dispatch doesn't leak detached remote sessions.
        try {
          transport.teardown();
        } catch {
          /* best-effort cleanup */
        }
        return {
          kind: this.kind,
          ok: false,
          plannedCommands,
          orchestratorPaneId: null,
          teammatePaneIds: {},
          notes: [
            `remote spawn failed for lane "${p.spec.name}" on ${p.target.endpoint}: ` +
              `${err instanceof Error ? err.message : String(err)}. ` +
              `Previously spawned pane(s) were torn down; no partial team left running.`,
          ],
        };
      }
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
