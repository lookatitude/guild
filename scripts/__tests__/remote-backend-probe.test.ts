/**
 * scripts/__tests__/remote-backend-probe.test.ts
 *
 * Pre-dispatch remote capability probe (Phase 1.5): before spawning, confirm each
 * remote host has the brand CLI(s) it needs; a missing tool fails fast with a
 * clear message and spawns nothing. SshRemoteTransport.probe builds the ssh
 * `command -v` check (login-shell-wrapped so off-PATH brands resolve).
 */

import {
  MockTransport,
  SshRemoteTransport,
  RemoteTeamBackend,
  binaryForHostKind,
  type RemoteHostTarget,
  type Specialist,
  type TeamLaunchRequest,
  type RunFn,
} from "../lib/team-backend";

const target = (hostId: string, hostKind: RemoteHostTarget["hostKind"], loginShell?: string): RemoteHostTarget =>
  ({ hostId, hostKind, endpoint: `u@${hostId}`, ...(loginShell ? { loginShell } : {}) });

function req(specialists: Specialist[]): TeamLaunchRequest {
  return { slug: "demo", runId: "run-1", cwd: "/tmp", specialists, targetName: "t", mode: "new-session", dryRun: false };
}
const sp = (name: string, host_kind: Specialist["host_kind"]): Specialist =>
  ({ name, scope: "x", dependsOn: [], host_kind } as Specialist);

describe("binaryForHostKind", () => {
  it("maps each brand to its CLI binary", () => {
    expect(binaryForHostKind("codex")).toBe("codex");
    expect(binaryForHostKind("pi")).toBe("pi");
    expect(binaryForHostKind("antigravity-2")).toBe("agy");
    expect(binaryForHostKind("claude")).toBe("claude");
  });
});

describe("RemoteTeamBackend launch — Phase 1.5 capability probe", () => {
  it("probes each host for its brand binary + tmux before spawning", () => {
    const mock = new MockTransport();
    const backend = new RemoteTeamBackend({ transport: mock, resolveHostTarget: () => target("box", "codex") });
    const res = backend.launch(req([sp("backend", "codex")]));
    expect(res.ok).toBe(true);
    expect(mock.probes).toHaveLength(1);
    expect(mock.probes[0].binaries.sort()).toEqual(["codex", "tmux"]);
    expect(mock.spawns).toHaveLength(1); // proceeded to spawn
  });

  it("fails fast (no spawn) when a required tool is missing on the remote", () => {
    const mock = new MockTransport({ missingBinaries: () => ["codex"] });
    const backend = new RemoteTeamBackend({ transport: mock, resolveHostTarget: () => target("box", "codex") });
    const res = backend.launch(req([sp("backend", "codex")]));
    expect(res.ok).toBe(false);
    expect(res.notes.join(" ")).toMatch(/missing required tool\(s\): codex/);
    expect(mock.spawns).toHaveLength(0); // nothing spawned
    expect(mock.teardowns).toBeGreaterThan(0);
  });

  it("missing tmux (the Rung-1 substrate) also fails fast", () => {
    const mock = new MockTransport({ missingBinaries: () => ["tmux"] });
    const backend = new RemoteTeamBackend({ transport: mock, resolveHostTarget: () => target("box", "claude") });
    const res = backend.launch(req([sp("backend", "claude")]));
    expect(res.ok).toBe(false);
    expect(res.notes.join(" ")).toMatch(/tmux/);
  });
});

describe("SshRemoteTransport.probe — ssh argv + parsing", () => {
  function recording(stdout: string): { run: RunFn; calls: Array<{ cmd: string; args: string[] }> } {
    const calls: Array<{ cmd: string; args: string[] }> = [];
    const run: RunFn = (cmd, args) => { calls.push({ cmd, args }); return { status: 0, stdout, stderr: "" }; };
    return { run, calls };
  }

  it("builds a single ssh `command -v` probe and parses PRESENT lines", () => {
    const { run, calls } = recording("PRESENT codex\nPRESENT tmux\n");
    const t = new SshRemoteTransport({ run });
    const r = t.probe(target("box", "codex"), ["codex", "tmux", "agy"]);
    expect(calls[0].cmd).toBe("ssh");
    expect(calls[0].args[0]).toBe("-o"); // BatchMode probe
    expect(calls[0].args.at(-1)).toMatch(/command -v "\$b"/);
    expect(r.present.sort()).toEqual(["codex", "tmux"]);
    expect(r.missing).toEqual(["agy"]);
  });

  it("login-shell-wraps the probe when the host carries a loginShell (off-PATH brands)", () => {
    const { run, calls } = recording("PRESENT codex\n");
    const t = new SshRemoteTransport({ run });
    t.probe(target("box", "codex", "zsh"), ["codex"]);
    expect(calls[0].args.at(-1)).toMatch(/^zsh -lic /);
  });

  it("empty binary set → no ssh call", () => {
    const { run, calls } = recording("");
    expect(new SshRemoteTransport({ run }).probe(target("box", "claude"), [])).toEqual({ present: [], missing: [] });
    expect(calls).toHaveLength(0);
  });
});
