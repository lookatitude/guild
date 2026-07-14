/**
 * scripts/__tests__/remote-backend-loginshell.test.ts
 *
 * Cross-host login-shell wrapping (wires the item-41 PATH finding): a plain
 * `ssh host <cmd>` does not source the login shell, so an off-PATH brand (codex
 * under linuxbrew) is not found. RemoteHostTarget.loginShell makes the transport
 * wrap the spawn command `<shell> -lic '<cmd>'`. Unit-level (injected RunFn).
 */

import {
  SshRemoteTransport,
  wrapLoginShell,
  shellQuote,
  type RemoteHostTarget,
  type PaneSpec,
  type RunFn,
} from "../lib/team-backend";

function recordingRun(): { run: RunFn; calls: Array<{ cmd: string; args: string[] }> } {
  const calls: Array<{ cmd: string; args: string[] }> = [];
  const run: RunFn = (cmd, args) => { calls.push({ cmd, args }); return { status: 0, stdout: "", stderr: "" }; };
  return { run, calls };
}
const spec = { name: "researcher" } as PaneSpec;

describe("wrapLoginShell", () => {
  test("wraps as `<shell> -lic '<cmd>'`, shell-quoting the command", () => {
    expect(wrapLoginShell("codex exec 'go'", "zsh")).toBe(`zsh -lic ${shellQuote("codex exec 'go'")}`);
    expect(wrapLoginShell("claude -p hi", "bash")).toBe("bash -lic 'claude -p hi'");
  });
});

describe("SshRemoteTransport.spawn — login-shell wiring", () => {
  // spawn() ALWAYS wraps the command in a detached tmux session first (so the
  // pane outlives this ssh call); loginShell, when present, wraps THAT tmux
  // invocation (tmux itself may be off the non-interactive PATH too).
  test("host WITH loginShell → the tmux-wrapped command is ALSO login-shell wrapped over ssh", () => {
    const { run, calls } = recordingRun();
    const t = new SshRemoteTransport({ run });
    const host: RemoteHostTarget = { hostId: "gpu", hostKind: "codex", endpoint: "miguelp@box", loginShell: "zsh" };
    const handle = t.spawn(host, spec, "codex exec 'p'");
    const tmuxCmd = `tmux new-session -d -s ${shellQuote(handle.remoteId)} ${shellQuote("codex exec 'p'")}`;
    expect(calls[0].cmd).toBe("ssh");
    expect(calls[0].args).toEqual(["miguelp@box", wrapLoginShell(tmuxCmd, "zsh")]);
  });

  test("host WITHOUT loginShell → bare tmux-wrapped command (claude-on-PATH, unchanged)", () => {
    const { run, calls } = recordingRun();
    const t = new SshRemoteTransport({ run });
    const host: RemoteHostTarget = { hostId: "c", hostKind: "claude", endpoint: "miguelp@box" };
    const handle = t.spawn(host, spec, "claude -p 'p'");
    const tmuxCmd = `tmux new-session -d -s ${shellQuote(handle.remoteId)} ${shellQuote("claude -p 'p'")}`;
    expect(calls[0].args).toEqual(["miguelp@box", tmuxCmd]);
  });
});
