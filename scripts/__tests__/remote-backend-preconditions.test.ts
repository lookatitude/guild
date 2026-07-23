/**
 * scripts/__tests__/remote-backend-preconditions.test.ts
 *
 * rf-wi-04 (G4) — the guardrail PRECONDITIONS that must hold before a remote
 * Claude pane can be trusted to launch under a resolved permission-mode bypass
 * flag. Order matters and is enforced here:
 *
 *   (1) HOOK-INSTALL PREFLIGHT — RemoteTeamBackend probes each far host for a
 *       Guild-hooks install BEFORE spawning. No hooks ⇒ the condition is
 *       detected + recorded (remoteHookProbes) AND the pane launches BARE (no
 *       bypass flag) — the current correct-but-bare behavior, now proven.
 *   (2) TEARDOWN VERDICT — teardown() returns a killed/orphaned verdict; a
 *       spawn-fail + teardown-fail surfaces an ORPHANED remote lane instead of
 *       leaking it silently.
 *   (3) FLAGS EXTENSION (gated on 1) — the resolved --permission-mode flags are
 *       spliced onto a remote Claude pane ONLY when its host's hook-install
 *       preflight verified. Codex panes are never touched.
 */

import {
  RemoteTeamBackend,
  MockTransport,
  SshRemoteTransport,
  type RemoteHostTarget,
  type RemoteTransport,
  type RunFn,
  type RunResult,
  type Specialist,
  type TeamLaunchRequest,
} from "../lib/team-backend";
import { resolveAdapter } from "../lib/pane-adapter";

const target = (hostId: string, hostKind: RemoteHostTarget["hostKind"], loginShell?: string): RemoteHostTarget =>
  ({ hostId, hostKind, endpoint: `u@${hostId}`, ...(loginShell ? { loginShell } : {}) });

function req(specialists: Specialist[]): TeamLaunchRequest {
  return { slug: "demo", runId: "run-1", cwd: "/tmp", specialists, targetName: "t", mode: "new-session", dryRun: false };
}
const sp = (name: string, host_kind: Specialist["host_kind"] = "claude"): Specialist =>
  ({ name, scope: "x", dependsOn: [], host_kind } as Specialist);

function backend(
  t: RemoteTransport,
  resolveHostTarget: (s: Specialist) => RemoteHostTarget,
  claudeLaunchArgs?: string[],
): RemoteTeamBackend {
  return new RemoteTeamBackend({
    transport: t,
    resolveHostTarget,
    resolveAdapter: resolveAdapter({ env: { OPENAI_API_KEY: "sk-x" } }),
    ...(claudeLaunchArgs ? { claudeLaunchArgs } : {}),
  });
}
const BYPASS = ["--permission-mode", "bypassPermissions"];

// ── (1) hook-install preflight — detection ───────────────────────────────────

describe("RemoteTeamBackend — Phase 1.6 hook-install preflight (rf-wi-04 item 1)", () => {
  it("probes each distinct host for a Guild-hooks install before spawning", () => {
    const t = new MockTransport();
    const res = backend(t, () => target("box", "claude")).launch(req([sp("backend")]));
    expect(res.ok).toBe(true);
    expect(t.hookProbes.map((h) => h.hostId)).toContain("box");
    expect(res.remoteHookProbes?.some((p) => p.hostId === "box")).toBe(true);
  });

  it("DETECTS a remote host with no hooks installed and records it (not silent)", () => {
    const t = new MockTransport({ hooksInstalledFor: () => false });
    const res = backend(t, () => target("box", "claude")).launch(req([sp("backend")]));
    expect(res.ok).toBe(true); // bare is safe — we degrade, not fail
    const probe = res.remoteHookProbes?.find((p) => p.hostId === "box");
    expect(probe?.installed).toBe(false);
    expect(res.notes.join(" ")).toMatch(/hook/i);
  });

  it("a claude remote pane launches BARE (no bypass flag) when hooks are NOT verified", () => {
    const t = new MockTransport({ hooksInstalledFor: () => false });
    backend(t, () => target("box", "claude")).launch(req([sp("backend")]));
    const spawn = t.spawns.find((s) => s.spec.name === "backend")!;
    expect(spawn.command).not.toMatch(/--permission-mode/);
    expect(spawn.command).not.toMatch(/bypassPermissions/);
  });
});

// ── (3) flags extension — GATED on the hook preflight ────────────────────────

describe("RemoteTeamBackend — resolved permission-mode flags on remote Claude panes (rf-wi-04 item 3)", () => {
  it("DEFAULT is bare even on a hooks-verified host — remote bypass is opt-in (codex-review Q1 safety fix)", () => {
    // presence≠loaded: file-presence alone must NOT auto-grant bypass, so the
    // default (no explicit claudeLaunchArgs) launches bare.
    const t = new MockTransport({ hooksInstalledFor: () => true });
    backend(t, () => target("box", "claude")).launch(req([sp("backend")]));
    expect(t.spawns[0].command).not.toMatch(/--permission-mode/);
  });

  it("splices the resolved flags when the operator opted in AND hooks are verified", () => {
    const t = new MockTransport({ hooksInstalledFor: () => true });
    backend(t, () => target("box", "claude"), BYPASS).launch(req([sp("backend")]));
    expect(t.spawns[0].command).toMatch(/--permission-mode bypassPermissions/);
  });

  it("WITHHOLDS opted-in flags when the host FAILS the hook preflight (the gate holds)", () => {
    const t = new MockTransport({ hooksInstalledFor: () => false });
    backend(t, () => target("box", "claude"), BYPASS).launch(req([sp("backend")]));
    expect(t.spawns[0].command).not.toMatch(/--permission-mode/);
  });

  it("NEVER touches a codex remote pane, even with opt-in flags AND hooks installed", () => {
    const t = new MockTransport({ hooksInstalledFor: () => true });
    backend(
      t,
      (s) => target(s.host_kind === "codex" ? "cbox" : "box", s.host_kind ?? "claude"),
      BYPASS,
    ).launch(req([sp("security", "codex")]));
    const spawn = t.spawns.find((s) => s.spec.name === "security")!;
    expect(spawn.command).toMatch(/codex exec/);
    expect(spawn.command).not.toMatch(/--permission-mode/);
  });

  it("round-2 Medium: the success note does NOT claim flags applied when they were not (bare default)", () => {
    const t = new MockTransport({ hooksInstalledFor: () => true });
    const res = backend(t, () => target("box", "claude")).launch(req([sp("backend")]));
    expect(res.notes.join(" ")).not.toMatch(/flags applied/i);
  });

  it("round-2 Medium: the success note DOES name the host when flags were actually applied", () => {
    const t = new MockTransport({ hooksInstalledFor: () => true });
    const res = backend(t, () => target("box", "claude"), BYPASS).launch(req([sp("backend")]));
    expect(res.notes.join(" ")).toMatch(/flags applied to Claude pane\(s\) on hooks-verified host\(s\): box/);
  });
});

// ── (2) teardown verdict + orphan surfacing ──────────────────────────────────

describe("RemoteTeamBackend — teardown verdict + orphan detection (rf-wi-04 item 2)", () => {
  it("a clean teardown reports outcome:clean", () => {
    const t = new MockTransport();
    const verdict = backend(t, () => target("box", "claude")).teardown();
    expect(verdict?.outcome).toBe("clean");
  });

  it("spawn-fail + teardown-fail SURFACES the orphaned lane (not silent)", () => {
    const t = new MockTransport({ failSpawnFor: () => true, orphanOnTeardown: true });
    // The first pane spawns OK, the second throws → triggers the rollback
    // teardown of the first; that teardown itself fails ⇒ the first pane is a
    // live orphan no receipt would otherwise describe.
    const t2 = new MockTransport({
      failSpawnFor: (h) => h.hostId === "b",
      orphanOnTeardown: true,
    });
    const res = backend(t2, (s) => target(s.name === "a" ? "a" : "b", "claude")).launch(
      req([sp("a"), sp("b")]),
    );
    expect(res.ok).toBe(false);
    expect(res.remoteTeardown?.outcome).toBe("orphaned");
    expect(res.remoteTeardown?.orphaned.length ?? 0).toBeGreaterThan(0);
    expect(res.notes.join(" ")).toMatch(/orphan/i);
    void t;
  });

  it("round-2 Q2a: an orphan is emitted to the durable warn sink at detection time (survives retry result-swallowing)", () => {
    const warnings: string[] = [];
    const t = new MockTransport({ failSpawnFor: (h) => h.hostId === "b", orphanOnTeardown: true });
    const b = new RemoteTeamBackend({
      transport: t,
      resolveHostTarget: (s) => target(s.name === "a" ? "a" : "b", "claude"),
      resolveAdapter: resolveAdapter({ env: { OPENAI_API_KEY: "sk-x" } }),
      warn: (m) => warnings.push(m),
    });
    b.launch(req([sp("a"), sp("b")]));
    // Even if a caller discards the returned envelope, the orphan is on the sink.
    expect(warnings.join("\n")).toMatch(/\[guild\]\[remote-orphan\]/);
  });
});

// ── SshRemoteTransport — the real remote checks (live hop = residual) ─────────

describe("SshRemoteTransport.probeHooks — ssh argv + parsing", () => {
  function recording(result: RunResult): { run: RunFn; calls: Array<{ cmd: string; args: string[] }> } {
    const calls: Array<{ cmd: string; args: string[] }> = [];
    const run: RunFn = (cmd, args) => {
      calls.push({ cmd, args });
      return result;
    };
    return { run, calls };
  }

  it("checks the remote GUILD_PLUGIN_ROOT hooks bundle and parses the positive signal", () => {
    const { run, calls } = recording({ status: 0, stdout: "GUILD_HOOKS_INSTALLED\n", stderr: "" });
    const r = new SshRemoteTransport({ run }).probeHooks(target("box", "claude"));
    expect(calls[0].cmd).toBe("ssh");
    expect(calls[0].args.at(-1)).toMatch(/hooks\.json/);
    expect(r.installed).toBe(true);
  });

  it("reports NOT installed when the marker is absent", () => {
    const { run } = recording({ status: 0, stdout: "", stderr: "" });
    expect(new SshRemoteTransport({ run }).probeHooks(target("box", "claude")).installed).toBe(false);
  });

  it("login-shell-wraps the hook probe when the host carries a loginShell", () => {
    const { run, calls } = recording({ status: 0, stdout: "GUILD_HOOKS_INSTALLED\n", stderr: "" });
    new SshRemoteTransport({ run }).probeHooks(target("box", "claude", "zsh"));
    expect(calls[0].args.at(-1)).toMatch(/^zsh -lic /);
  });
});

describe("SshRemoteTransport.teardown — verdict (rf-wi-04 item 2)", () => {
  it("returns outcome:clean when the ssh kill hop succeeds and the session is verified GONE", () => {
    const ok: RunResult = { status: 0, stdout: "GONE\n", stderr: "" };
    const run: RunFn = () => ok;
    const ssh = new SshRemoteTransport({ run });
    ssh.spawn(target("box", "claude"), { name: "a", scope: "", runId: "r", slug: "s", prompt: "p", hostKind: "claude" }, "cmd");
    const verdict = ssh.teardown();
    expect(verdict.outcome).toBe("clean");
    expect(verdict.killed).toHaveLength(1);
  });

  it("returns outcome:orphaned when the ssh kill hop itself fails (pane fate unknown)", () => {
    let n = 0;
    const run: RunFn = () => (n++ === 0 ? { status: 0, stdout: "", stderr: "" } : { status: 255, stdout: "", stderr: "ssh: connect timeout" });
    const ssh = new SshRemoteTransport({ run });
    ssh.spawn(target("box", "claude"), { name: "a", scope: "", runId: "r", slug: "s", prompt: "p", hostKind: "claude" }, "cmd");
    const verdict = ssh.teardown();
    expect(verdict.outcome).toBe("orphaned");
    expect(verdict.orphaned).toHaveLength(1);
    expect(verdict.orphaned[0].remoteId).toMatch(/^ssh-u@box-/);
  });

  it("Q2b: a kill hop that succeeds but leaves the session ALIVE is an orphan, NOT killed", () => {
    // ssh exits 0 but has-session reports the pane survived the kill.
    let n = 0;
    const run: RunFn = () => (n++ === 0 ? { status: 0, stdout: "", stderr: "" } : { status: 0, stdout: "ALIVE\n", stderr: "" });
    const ssh = new SshRemoteTransport({ run });
    ssh.spawn(target("box", "claude"), { name: "a", scope: "", runId: "r", slug: "s", prompt: "p", hostKind: "claude" }, "cmd");
    const verdict = ssh.teardown();
    expect(verdict.outcome).toBe("orphaned");
    expect(verdict.killed).toHaveLength(0);
    // the teardown command must actually VERIFY (has-session), not just kill.
    // (the last recorded run is the teardown hop)
  });

  it("round-2 Q2b: an UNKNOWN verification (tmux failed for a non-absent reason) is orphaned, NOT killed", () => {
    // ssh exits 0 but has-session failed for an unrecognised reason → UNKNOWN.
    let n = 0;
    const run: RunFn = () => (n++ === 0 ? { status: 0, stdout: "", stderr: "" } : { status: 0, stdout: "UNKNOWN\n", stderr: "" });
    const ssh = new SshRemoteTransport({ run });
    ssh.spawn(target("box", "claude"), { name: "a", scope: "", runId: "r", slug: "s", prompt: "p", hostKind: "claude" }, "cmd");
    const verdict = ssh.teardown();
    expect(verdict.outcome).toBe("orphaned");
    expect(verdict.killed).toHaveLength(0);
  });

  it("Q2b: verified GONE counts as killed", () => {
    let n = 0;
    const run: RunFn = () => (n++ === 0 ? { status: 0, stdout: "", stderr: "" } : { status: 0, stdout: "GONE\n", stderr: "" });
    const ssh = new SshRemoteTransport({ run });
    ssh.spawn(target("box", "claude"), { name: "a", scope: "", runId: "r", slug: "s", prompt: "p", hostKind: "claude" }, "cmd");
    const verdict = ssh.teardown();
    expect(verdict.outcome).toBe("clean");
    expect(verdict.killed).toHaveLength(1);
  });

  it("Q2b: the teardown ssh command kills THEN verifies with has-session", () => {
    const calls: Array<{ cmd: string; args: string[] }> = [];
    const run: RunFn = (cmd, args) => { calls.push({ cmd, args }); return { status: 0, stdout: "GONE\n", stderr: "" }; };
    const ssh = new SshRemoteTransport({ run });
    ssh.spawn(target("box", "claude"), { name: "a", scope: "", runId: "r", slug: "s", prompt: "p", hostKind: "claude" }, "cmd");
    ssh.teardown();
    const teardownArg = calls[calls.length - 1].args.at(-1)!;
    expect(teardownArg).toMatch(/tmux kill-session/);
    expect(teardownArg).toMatch(/tmux has-session/);
  });
});

describe("SshRemoteTransport — untracked-spawn orphan (rf-wi-04 item 2 / codex-review Q2a)", () => {
  it("a spawn whose ssh hop fails is still tracked so teardown targets it (no silent orphan)", () => {
    // The remote `tmux new-session` MAY have run before the hop dropped; the
    // session must not vanish from teardown just because spawn threw.
    let call = 0;
    const run: RunFn = () => {
      call++;
      if (call === 1) return { status: 255, stdout: "", stderr: "ssh: connection reset" }; // spawn hop fails
      return { status: 0, stdout: "ALIVE\n", stderr: "" }; // teardown finds it still live
    };
    const ssh = new SshRemoteTransport({ run });
    expect(() =>
      ssh.spawn(target("box", "claude"), { name: "a", scope: "", runId: "r", slug: "s", prompt: "p", hostKind: "claude" }, "cmd"),
    ).toThrow(/spawn failed/);
    const verdict = ssh.teardown();
    // The suspected pane was swept — surfaced as an orphan, not silently lost.
    expect(verdict.orphaned).toHaveLength(1);
    expect(verdict.outcome).toBe("orphaned");
  });
});
