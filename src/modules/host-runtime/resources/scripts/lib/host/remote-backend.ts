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
  RemoteHookProbeResult,
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
  TeardownVerdict,
} from "../core/contracts/team-backend";
import {
  defaultRun,
  dispatchModelForSpecialist,
  dispatchModelParamsForSpecialist,
  specialistDispatchKey,
} from "../core/contracts/team-backend";
import {
  buildPrompt,
  paneCommand,
  shellQuote,
  wrapLoginShell,
  binaryForHostKind,
} from "./tmux-backend";
import type { HostKind } from "../host-types";

/**
 * ISSUE #94 (secondary) — the synthetic PreToolUse event the remote probe feeds
 * to the far host's own enforcement binary. Single-quoted into the ssh command,
 * so it must contain NO single quotes.
 */
const HOOK_PROBE_EVENT =
  '{"session_id":"guild-remote-enforcement-probe","transcript_path":"",' +
  '"hook_event_name":"PreToolUse","tool_name":"Bash",' +
  '"tool_input":{"command":"guild-remote-enforcement-probe"},"tool_use_id":"guild-probe"}';

/**
 * ISSUE #94 (secondary) — TIGHTENED from presence to REGISTRATION + EXECUTION.
 *
 * WAS (rf-wi-04): `[ -f "$root/hooks/hooks.json" ]`. That proved the bundle was
 * on disk, NOT that anything would enforce — a stale or partial checkout at
 * GUILD_PLUGIN_ROOT passed happily. The gap was documented, and compensated for
 * by keeping the remote bypass opt-in.
 *
 * NOW, two conjuncts, both required:
 *   1. REGISTRATION — `hooks/hooks.json` must bind the gate to the `PreToolUse`
 *      EVENT specifically, parsed rather than grepped: a manifest naming the
 *      same binary under a different event passed a whole-file substring match
 *      while gating no tool call at all.
 *      Executing a binary the host never wired proves the binary works and
 *      nothing about the host: a tree carrying the script but no manifest
 *      passed the execution-only draft of this probe.
 *   2. EXECUTION — run the far host's OWN `hooks/dist/pre-tool-use.js` against a
 *      synthetic PreToolUse event under a capability scope that excludes the
 *      probed tool, and require BOTH a zero exit from node itself and a real
 *      gating decision (`"permissionDecision":"ask"` or `"deny"`). The node
 *      status is captured into a variable rather than left inside a pipeline,
 *      where `grep`'s status would have masked a crashing hook.
 * Accepting `ask` is right HERE and not on codex: a remote Claude host has a
 * native ask primitive, so `ask` is a real gate there.
 *
 * The codex half of issue #94 is why this is worth the extra hop: it confirmed
 * on real hardware that a registered, present hook can silently never run
 * (codex hook trust) — with no warning at all. Presence is not enforcement.
 *
 * WHAT THIS STILL DOES NOT PROVE — stated, not implied. The followup asked to
 * "query the live remote Claude for its LOADED hook set". Claude Code exposes no
 * such query: `claude doctor` (2.1.223) reports install health, settings
 * validity and MCP wiring, and does NOT enumerate loaded hooks. So this proves
 * the gate is WIRED AND EXECUTABLE on the far host, not that the far host's live
 * session has that hook table loaded. Strictly stronger than presence, strictly
 * weaker than introspection — which is exactly why the remote bypass flag
 * REMAINS opt-in on top of this proof (see RemoteTeamBackend.claudeLaunchArgs).
 *
 * Residual (unchanged, matching connect/probe/spawn): the far host's
 * non-interactive shell must export GUILD_PLUGIN_ROOT (or reach it via the
 * host's login_shell wrap), and must have `node` on PATH.
 */
const HOOK_INSTALL_PROBE =
  'root="${GUILD_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-}}"; ' +
  '[ -n "$root" ] && [ -f "$root/hooks/hooks.json" ] && ' +
  '[ -f "$root/hooks/dist/pre-tool-use.js" ] && ' +
  // PARSED, not grepped. A manifest that registers the binary under some OTHER
  // event (SessionStart, say) satisfies a whole-file substring match while
  // nothing gates a tool call — verified against the real snippet. `node` is
  // already a hard requirement two lines down, so parsing costs nothing extra.
  'node -e \'const m=require(process.argv[1]);' +
  'const g=(m.hooks&&m.hooks.PreToolUse)||[];' +
  'const hit=g.some(e=>(e.hooks||[]).some(h=>String(h.command||"").includes("pre-tool-use")));' +
  'process.exit(hit?0:1)\' "$root/hooks/hooks.json" && ' +
  `out=$(printf '%s' '${HOOK_PROBE_EVENT}' | ` +
  'GUILD_CAPABILITY_SCOPE=\'["Read"]\' ' +
  'node "$root/hooks/dist/pre-tool-use.js" 2>/dev/null) && ' +
  'printf \'%s\' "$out" | grep -q \'"hookEventName":"PreToolUse"\' && ' +
  'printf \'%s\' "$out" | grep -qE \'"permissionDecision":"(ask|deny)"\' && ' +
  'echo GUILD_HOOKS_ENFORCING || true';
const HOOK_INSTALL_SIGNAL = "GUILD_HOOKS_ENFORCING";

// ── MockTransport ─────────────────────────────────────────────────────────────

export class MockTransport implements RemoteTransport {
  readonly kind = "mock";
  readonly connects: RemoteHostTarget[] = [];
  readonly spawns: Array<{ host: RemoteHostTarget; spec: PaneSpec; command: string }> = [];
  teardowns = 0;
  readonly probes: Array<{ host: RemoteHostTarget; binaries: string[] }> = [];
  readonly hookProbes: RemoteHostTarget[] = [];
  private handles: RemotePaneHandle[] = [];
  private failConnectFor?: (host: RemoteHostTarget) => boolean;
  private missingBinaries?: (host: RemoteHostTarget) => string[];
  private hooksInstalledFor?: (host: RemoteHostTarget) => boolean;
  private failSpawnFor?: (host: RemoteHostTarget) => boolean;
  private orphanOnTeardown: boolean;
  private counter = 0;

  constructor(opts: MockTransportOpts = {}) {
    this.failConnectFor = opts.failConnectFor;
    this.missingBinaries = opts.missingBinaries;
    this.hooksInstalledFor = opts.hooksInstalledFor;
    this.failSpawnFor = opts.failSpawnFor;
    this.orphanOnTeardown = opts.orphanOnTeardown ?? false;
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

  probeHooks(host: RemoteHostTarget): RemoteHookProbeResult {
    this.hookProbes.push(host);
    // Default: NOT installed — so a caller that doesn't opt in sees the safe
    // bare-launch path (bypass flag withheld), matching real unproven hosts.
    const installed = this.hooksInstalledFor?.(host) ?? false;
    return {
      installed,
      detail: installed
        ? `mock: hooks verified on ${host.hostId}`
        : `mock: hooks NOT verified on ${host.hostId}`,
    };
  }

  spawn(host: RemoteHostTarget, spec: PaneSpec, command: string): RemotePaneHandle {
    if (this.failSpawnFor?.(host)) {
      throw new Error(`mock: spawn refused for ${spec.name} on ${host.hostId} (${host.endpoint})`);
    }
    this.spawns.push({ host, spec, command });
    const handle: RemotePaneHandle = {
      specialist: spec.name,
      ...(spec.definition_ref ? { definition_ref: spec.definition_ref } : {}),
      hostId: host.hostId,
      hostKind: host.hostKind,
      endpoint: host.endpoint,
      remoteId: `mock-${++this.counter}`,
      loginShell: host.loginShell,
    };
    this.handles.push(handle);
    return handle;
  }

  teardown(): TeardownVerdict {
    this.teardowns++;
    const handles = this.handles;
    this.handles = [];
    if (this.orphanOnTeardown && handles.length > 0) {
      return {
        outcome: "orphaned",
        killed: [],
        orphaned: handles,
        detail: `mock: teardown hop failed — ${handles.length} pane(s) may still be live`,
      };
    }
    return {
      outcome: "clean",
      killed: handles.map((h) => h.remoteId),
      orphaned: [],
      detail: `mock: ${handles.length} pane(s) torn down`,
    };
  }
}

// ── SshRemoteTransport ────────────────────────────────────────────────────────

export class SshRemoteTransport implements RemoteTransport {
  readonly kind = "ssh";
  private run: RunFn;
  private handles: RemotePaneHandle[] = [];
  /**
   * rf-wi-04 item 2 (codex review Q2a) — panes whose `tmux new-session` MAY have
   * been created remotely but whose spawn ssh hop failed before we could confirm
   * (e.g. the connection dropped after the session started). The remoteId is
   * deterministic and computed BEFORE the hop, so teardown can still target them:
   * without this, such a pane would be untracked and thus invisible to teardown —
   * a silent live orphan exactly the item-2 gate exists to prevent.
   */
  private suspected: RemotePaneHandle[] = [];
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

  probeHooks(host: RemoteHostTarget): RemoteHookProbeResult {
    // rf-wi-04 item 1, TIGHTENED by issue #94 — do not merely stat the remote
    // bundle: EXECUTE its enforcement binary and require a gating decision.
    // See HOOK_INSTALL_PROBE for the exact snippet, the signal, and the
    // precise residual this still does not cover.
    const remoteCmd = host.loginShell ? wrapLoginShell(HOOK_INSTALL_PROBE, host.loginShell) : HOOK_INSTALL_PROBE;
    const r = this.run("ssh", ["-o", "BatchMode=yes", host.endpoint, remoteCmd]);
    const installed =
      r.status === 0 && (r.stdout ?? "").split("\n").some((l) => l.trim() === HOOK_INSTALL_SIGNAL);
    return {
      installed,
      detail: installed
        ? `ssh: Guild hook ENFORCEMENT verified on ${host.endpoint} — ` +
          `$GUILD_PLUGIN_ROOT/hooks/dist/pre-tool-use.js returned a gating decision for a ` +
          `synthetic out-of-scope PreToolUse event. (Proves the gate is executable on the far ` +
          `host; NOT that its live session has the hook table loaded — Claude exposes no such ` +
          `query, which is why the bypass flag stays opt-in on top of this proof.)`
        : `ssh: Guild hook enforcement NOT proven on ${host.endpoint} (ssh exit ${r.status ?? "null"}) — ` +
          `remote Claude panes launch BARE (bypass flag withheld). Either the bundle is absent, the ` +
          `checkout is stale/partial (a hooks.json alone no longer passes — issue #94), or ` +
          `\`node\`/GUILD_PLUGIN_ROOT is not on the non-interactive shell (set ` +
          `defaults.cross_host.hosts.${host.hostId}.login_shell).`,
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
    const handle: RemotePaneHandle = {
      specialist: spec.name,
      hostId: host.hostId,
      hostKind: host.hostKind,
      endpoint: host.endpoint,
      remoteId,
      loginShell: host.loginShell,
    };
    const tmuxCmd = `tmux new-session -d -s ${shellQuote(remoteId)} ${shellQuote(command)}`;
    const wired = host.loginShell ? wrapLoginShell(tmuxCmd, host.loginShell) : tmuxCmd;
    const r = this.run("ssh", [host.endpoint, wired]);
    if (r.status !== 0) {
      // rf-wi-04 item 2 (Q2a): a non-zero ssh exit does NOT prove the remote
      // `tmux new-session` never ran — the hop can fail AFTER the session was
      // created (connection dropped mid-flight). Record the handle as SUSPECTED
      // so teardown still targets it; otherwise it would be an untracked, silent
      // live orphan. Then surface the failure (a spawn that can't be confirmed
      // must not report ok:true).
      this.suspected.push(handle);
      throw new Error(
        `remote spawn failed on ${host.endpoint} (ssh/tmux exit ${r.status ?? "null"}): ` +
          `${(r.stderr ?? "").trim().slice(0, 400) || "no stderr"}. ` +
          `Session "${remoteId}" MAY have been created and is tracked for teardown.`,
      );
    }
    this.handles.push(handle);
    return handle;
  }

  teardown(): TeardownVerdict {
    const killed: string[] = [];
    const orphaned: RemotePaneHandle[] = [];
    // Sweep confirmed AND suspected panes (Q2a) — a suspected session that was
    // never actually created simply reports GONE and costs nothing.
    const targets = [...this.handles, ...this.suspected];
    for (const h of targets) {
      // rf-wi-04 item 2 (codex review Q2b, rounds 1+2): the old
      // `kill-session ... || true` swallowed a real kill FAILURE, so any healthy
      // ssh hop reported "killed" even when the pane survived. Kill, then VERIFY
      // with has-session — BUT `has-session` exits non-zero for MANY reasons
      // (session absent, server down, `tmux` not found, socket/permission
      // error). A bare `then ALIVE else GONE` would misclassify every non-absent
      // failure as GONE (round-2 counterexample). So we only emit GONE when the
      // failure message is a RECOGNISED "session absent"/"server down" signal
      // (server down is genuine absence here: ssh already succeeded, so tmux ran
      // on the host — after our kill an empty server exiting means our session is
      // gone). Any other/unrecognised failure → UNKNOWN. Verdict per pane:
      //   ssh hop failed   → orphaned (host unreachable, fate unknown)
      //   ALIVE            → orphaned (kill failed, pane still live)
      //   UNKNOWN          → orphaned (couldn't verify — never assume dead)
      //   GONE             → killed (verified absent)
      const q = shellQuote(h.remoteId);
      const verifyCmd =
        `tmux kill-session -t ${q} 2>/dev/null; ` +
        `out=$(tmux has-session -t ${q} 2>&1); rc=$?; ` +
        `if [ "$rc" -eq 0 ]; then echo ALIVE; ` +
        `elif printf '%s' "$out" | grep -qiE "can.t find|no server running|no such session|session not found"; then echo GONE; ` +
        `else echo UNKNOWN; fi`;
      const wired = h.loginShell ? wrapLoginShell(verifyCmd, h.loginShell) : verifyCmd;
      const r = this.run("ssh", [h.endpoint, wired]);
      const out = (r.stdout ?? "").split("\n").map((l) => l.trim());
      // Require a POSITIVE GONE token AND no ALIVE/UNKNOWN — conservative: any
      // ambiguity leaves the pane recorded as an orphan.
      if (r.status === 0 && out.includes("GONE") && !out.includes("ALIVE") && !out.includes("UNKNOWN")) {
        killed.push(h.remoteId);
      } else {
        orphaned.push(h);
      }
    }
    this.handles = [];
    this.suspected = [];
    return orphaned.length > 0
      ? {
          outcome: "orphaned",
          killed,
          orphaned,
          detail:
            `remote teardown could not confirm ${orphaned.length} pane(s) killed: ` +
            orphaned.map((h) => `${h.remoteId}@${h.endpoint}`).join(", ") +
            ` — ssh kill hop failed OR the session was still ALIVE after kill; these ` +
            `may still be LIVE. Verify manually with ` +
            `\`ssh <endpoint> tmux kill-session -t <remoteId>\`.`,
        }
      : {
          outcome: "clean",
          killed,
          orphaned: [],
          detail: `remote teardown verified ${killed.length} pane(s) gone`,
        };
  }
}

// ── RemoteTeamBackend ─────────────────────────────────────────────────────────

export class RemoteTeamBackend implements TeamBackend {
  readonly kind = "remote" as const;
  private transport?: RemoteTransport;
  private resolveHostTarget?: (spec: Specialist) => RemoteHostTarget;
  private resolveAdapter?: AdapterResolver;
  /**
   * rf-wi-04 item 3 — resolved `--permission-mode …` argv for a remote CLAUDE
   * pane. Applied ONLY when BOTH (a) the caller EXPLICITLY opted in by passing
   * these args, and (b) the pane's far host cleared the hook-install preflight
   * (item 1). DEFAULT is `[]` (BARE) — deliberately NOT the local tmux path's
   * default bypass. This is the safety fix from the rf-wi-04 codex review:
   * probeHooks proves the hook bundle is PRESENT, not that Claude loaded/enabled
   * it, so file-presence alone must not auto-grant bypass (a stale/partial remote
   * checkout would be a false positive). Bypass on a remote pane therefore
   * requires deliberate operator intent on top of the presence proof — never a
   * silent default. Withholding the flag only ever launches bare, which is safe.
   */
  private claudeLaunchArgs: string[];
  /** rf-wi-04 item 2 (Q2a) — durable orphan-warning sink; see RemoteTeamBackendOpts.warn. */
  private warn: (message: string) => void;

  constructor(opts: RemoteTeamBackendOpts = {}) {
    this.transport = opts.transport;
    this.resolveHostTarget = opts.resolveHostTarget;
    this.resolveAdapter = opts.resolveAdapter;
    // Default BARE (safe). resolveClaudeTeamLaunchArgs is intentionally NOT the
    // fallback here — see the field doc: presence-not-load means remote bypass
    // must be opt-in, not the local-parity default.
    this.claudeLaunchArgs = opts.claudeLaunchArgs ?? [];
    this.warn = opts.warn ?? ((m) => process.stderr.write(`${m}\n`));
  }

  isAvailable(): boolean {
    return !!this.transport;
  }

  private paneSpecFor(spec: Specialist, req: TeamLaunchRequest): PaneSpec {
    const hostKind: HostKind = spec.host_kind ?? req.orchestratorHostKind ?? "claude";
    const prompt = buildPrompt(req.slug, req.runId, spec, req.teamPath, hostKind);
    // T6-R2-F5: a remote lane spawns at the same evidenced-M2 selection a local
    // pane would — one consumption rule, every backend (absent ⇒ legacy bytes).
    const model = dispatchModelForSpecialist(spec) ?? undefined;
    const modelParams = dispatchModelParamsForSpecialist(spec);
    return {
      name: specialistDispatchKey(spec),
      scope: spec.scope,
      runId: req.runId,
      slug: req.slug,
      prompt,
      hostKind,
      taskId: spec.taskId,
      capability_scope: spec.capability_scope,
      specialist: spec.name,
      assignmentPath: spec.task_cell_assignment_path,
      taskCellInstanceId: spec.task_cell_instance_id,
      ...(model !== undefined ? { model } : {}),
      ...(modelParams !== undefined ? { modelParams } : {}),
    };
  }

  /**
   * Build the pane's launch command. The resolved permission-mode flags are
   * spliced onto a Claude pane ONLY when BOTH gates pass (rf-wi-04 items 1+3):
   *   - `hooksVerified` — the far host cleared the hook-install preflight, AND
   *   - `this.claudeLaunchArgs.length > 0` — the caller explicitly opted in.
   * Default (no explicit args) ⇒ bare, even on a hooks-verified host.
   *
   * Codex and every other host_kind are untouched — the flags are hard-scoped to
   * `hostKind === "claude"`. NOTE the resolveAdapter fallback is a TRUSTED
   * internal seam (ClaudePaneAdapter/CodexPaneAdapter, always bare); it is not a
   * threat-model boundary. A caller wiring a hostile resolveAdapter could return
   * any command — but that caller already controls the whole dispatch and could
   * bypass this class entirely, so gating it here would be security theatre. The
   * invariant this method guarantees is narrower and real: THIS backend never
   * ADDS a bypass flag to a remote Claude pane without both gates above.
   */
  private commandFor(spec: Specialist, paneSpec: PaneSpec, hooksVerified: boolean): string {
    const hostKind = paneSpec.hostKind;
    if (hostKind === "claude" && hooksVerified && this.claudeLaunchArgs.length > 0) {
      // Same shape the local tmux path uses (composeTmuxCommands) — call
      // paneCommand directly so the resolved flags reach the argv; the
      // ClaudePaneAdapter (shared with untrusted-remote dispatch) stays bare.
      return paneCommand(
        paneSpec.prompt,
        paneSpec.runId,
        spec.capability_scope,
        spec.taskId,
        spec.name,
        undefined,
        this.claudeLaunchArgs,
        undefined,
        spec.task_cell_assignment_path,
        spec.task_cell_instance_id,
      );
    }
    return this.resolveAdapter
      ? this.resolveAdapter(hostKind).command(paneSpec)
      : paneCommand(
          paneSpec.prompt,
          paneSpec.runId,
          spec.capability_scope,
          spec.taskId,
          spec.name,
          undefined,
          [],
          undefined,
          spec.task_cell_assignment_path,
          spec.task_cell_instance_id,
        );
  }

  teardown(): TeardownVerdict {
    return (
      this.transport?.teardown() ?? {
        outcome: "clean",
        killed: [],
        orphaned: [],
        detail: "no transport — nothing to tear down",
      }
    );
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
      const paneSpec = this.paneSpecFor(spec, req);
      return { spec, target, paneSpec };
    });
    // The plan preview shows the BARE command: hooks are not probed until the
    // real launch (dry-run touches no transport), so the resolved permission-mode
    // flags cannot be shown here without over-claiming a precondition we have not
    // verified. The actual spawn command upgrades per-host once hooks are proven.
    const plannedCommands = planned.map(
      (p) =>
        `remote[${transport.kind}] spawn ${p.spec.name} → ${p.target.hostId} ` +
        `(${p.target.endpoint}) [${p.paneSpec.hostKind}]: ${this.commandFor(p.spec, p.paneSpec, false)}`
    );

    if (req.dryRun) {
      return {
        kind: this.kind,
        ok: true,
        plannedCommands,
        orchestratorPaneId: null,
        teammatePaneIds: {},
        notes: [
          `dry-run: ${transport.kind} transport not invoked`,
          `dry-run: hook-install preflight not run — panes planned BARE (permission-mode flags withheld until hooks are verified at launch)`,
        ],
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

    // Phase 1.6 — hook-install preflight (rf-wi-04 item 1). BEFORE trusting a
    // remote Claude pane with a resolved permission-mode bypass flag, verify
    // Guild's hook bundle is present on the far host. A host that lacks it is
    // NOT failed (bare launch is safe) — the bypass flag is simply WITHHELD from
    // its Claude panes and the condition is recorded. An honest partial beats an
    // unsafe bypass that strips the host's native guardrail with nothing behind.
    const hooksByHost = new Map<string, boolean>();
    const remoteHookProbes: NonNullable<TeamLaunchResult["remoteHookProbes"]> = [];
    const hookNotes: string[] = [];
    for (const target of distinctTargets) {
      const hp = transport.probeHooks(target);
      hooksByHost.set(target.hostId, hp.installed);
      remoteHookProbes.push({
        hostId: target.hostId,
        endpoint: target.endpoint,
        installed: hp.installed,
        detail: hp.detail,
      });
      if (!hp.installed) {
        hookNotes.push(
          `hook-install preflight: "${target.hostId}" (${target.endpoint}) has NO verified Guild ` +
            `hooks — Claude panes there launch BARE (permission-mode bypass flag withheld). ${hp.detail}`,
        );
      }
    }

    // Phase 2 — spawn each pane. The task brief needs no separate delivery: the
    // full prompt is already the pane command's argv (built by commandFor/
    // paneCommand), and GUILD_TASK_ASSIGNMENT is already exported into that same
    // command's env (docs/v2 §08 `guild.task_assignment.v1`). The command is
    // resolved per-pane HERE so the hooks-gated permission-mode flags are applied
    // only to Claude panes whose host cleared Phase 1.6.
    const teammatePaneIds: Record<string, string> = {};
    // Track the hosts where a Claude pane ACTUALLY received the resolved flags —
    // not merely where hooks were verified. Both gates (hooks + explicit opt-in
    // args + a claude pane) must hold, else the success note would over-claim
    // (codex review Q1/round-2 Medium: "flags applied" on a bare default host).
    const flaggedHosts = new Set<string>();
    const flagsOptedIn = this.claudeLaunchArgs.length > 0;
    for (const p of planned) {
      const hooksVerified = hooksByHost.get(p.target.hostId) ?? false;
      const command = this.commandFor(p.spec, p.paneSpec, hooksVerified);
      if (p.paneSpec.hostKind === "claude" && hooksVerified && flagsOptedIn) {
        flaggedHosts.add(p.target.hostId);
      }
      let handle: RemotePaneHandle;
      try {
        handle = transport.spawn(p.target, p.paneSpec, command);
      } catch (err) {
        // A failed spawn must not report ok:true. Tear down any panes we did
        // spawn so a partial dispatch doesn't leak detached remote sessions —
        // and CAPTURE the teardown verdict (rf-wi-04 item 2): a teardown hop
        // that fails leaves a LIVE remote lane, which must be surfaced as an
        // orphan rather than silently swallowed.
        let teardownVerdict: TeardownVerdict;
        try {
          teardownVerdict = transport.teardown();
        } catch (teardownErr) {
          teardownVerdict = {
            outcome: "orphaned",
            killed: [],
            orphaned: [],
            detail:
              `teardown threw during rollback (${teardownErr instanceof Error ? teardownErr.message : String(teardownErr)}) — ` +
              `previously spawned remote pane(s) may still be LIVE and could not be enumerated.`,
          };
        }
        const orphanNote =
          teardownVerdict.outcome === "orphaned"
            ? `ORPHANED remote lane(s) after rollback: ${teardownVerdict.detail}`
            : `Previously spawned pane(s) were torn down; no partial team left running.`;
        // rf-wi-04 item 2 (Q2a, round 2): emit the orphan to a DURABLE channel at
        // detection time. The production caller retries launch() and a later
        // success discards this failed result — so relying on the returned
        // envelope alone would drop the orphan record. This warn() fires
        // regardless of what the caller does with the return value.
        if (teardownVerdict.outcome === "orphaned") {
          this.warn(
            `[guild][remote-orphan] spawn-fail rollback left an unconfirmed remote lane ` +
              `(run ${req.runId}, lane "${p.spec.name}", ${p.target.endpoint}): ${teardownVerdict.detail}`,
          );
        }
        return {
          kind: this.kind,
          ok: false,
          plannedCommands,
          orchestratorPaneId: null,
          teammatePaneIds: {},
          remoteHookProbes,
          remoteTeardown: teardownVerdict,
          notes: [
            ...hookNotes,
            `remote spawn failed for lane "${p.spec.name}" on ${p.target.endpoint}: ` +
              `${err instanceof Error ? err.message : String(err)}. ` +
              orphanNote,
          ],
        };
      }
      teammatePaneIds[specialistDispatchKey(p.spec)] = handle.remoteId;
    }

    return {
      kind: this.kind,
      ok: true,
      plannedCommands,
      orchestratorPaneId: null,
      teammatePaneIds,
      remoteHookProbes,
      notes: [
        `spawned ${planned.length} remote pane(s) via ${transport.kind}`,
        ...hookNotes,
        ...(flaggedHosts.size > 0
          ? [`permission-mode flags applied to Claude pane(s) on hooks-verified host(s): ${[...flaggedHosts].join(", ")}`]
          : []),
      ],
    };
  }
}
