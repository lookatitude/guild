/**
 * scripts/__tests__/remote-backend-live.test.ts
 *
 * LIVE cross-host integration test for SshRemoteTransport (deferred item 41 —
 * "live remote-team ssh validation"). The unit test (remote-backend.test.ts)
 * proves ssh COMMAND CONSTRUCTION via an injected RunFn; THIS test exercises the
 * REAL wire against a reachable host, closing the documented residual.
 *
 * GATED: runs only when GUILD_SSH_LIVE_TARGET is set to an ssh destination
 * (`user@host` or a ~/.ssh/config alias) that accepts key-based BatchMode auth.
 * Skips silently otherwise, so normal CI is unaffected. To run:
 *
 *   GUILD_SSH_LIVE_TARGET=miguelp@192.168.10.21 \
 *     npx jest __tests__/remote-backend-live.test.ts
 *
 * Validated against a real Linux host (claude CLI, tmux): connect probe, remote
 * spawn execution (now tmux-detached — the pane's session name IS the
 * transport-generated remoteId, so `tmux kill-session -t <remoteId>` is an exact
 * match), survival across the ssh disconnect, and teardown — all green over the
 * wire. There is no separate send()/inbox channel any more (deleted — it had no
 * reader; the command argv + GUILD_TASK_ASSIGNMENT already carry the brief).
 * All remote artifacts are confined to ~/Projects/tests and cleaned up afterwards.
 */

import { execFileSync } from "child_process";
import { SshRemoteTransport, type RemoteHostTarget, type PaneSpec } from "../lib/team-backend";

const TARGET = process.env["GUILD_SSH_LIVE_TARGET"];
const d = TARGET ? describe : describe.skip;

/** Run a command on the remote over key-based BatchMode ssh; return stdout. */
function remote(cmd: string): string {
  return execFileSync("ssh", ["-o", "BatchMode=yes", "-o", "ConnectTimeout=8", TARGET!, cmd], {
    encoding: "utf8",
  }).trim();
}

d("SshRemoteTransport — LIVE cross-host (item 41)", () => {
  const nonce = `jest-${Date.now()}`;
  const host: RemoteHostTarget = { hostId: "live", hostKind: "claude", endpoint: TARGET! };
  const t = new SshRemoteTransport(); // real defaultRun

  afterAll(() => {
    try {
      // Kill any tmux sessions this run created (named `ssh-<endpoint>-<n>` by
      // the transport) plus the scratch marker files.
      remote(
        `rm -f ~/Projects/tests/${nonce}.* 2>/dev/null; ` +
          `tmux ls 2>/dev/null | cut -d: -f1 | grep '^ssh-' | ` +
          `xargs -r -n1 tmux kill-session -t 2>/dev/null || true`
      );
    } catch { /* best-effort cleanup */ }
  });

  test("connect — real BatchMode reachability probe succeeds", () => {
    const r = t.connect(host);
    expect(r.ok).toBe(true);
  });

  test("spawn — the constructed command actually executes on the remote (tmux-detached, so poll)", () => {
    const marker = `~/Projects/tests/${nonce}.spawn`;
    const handle = t.spawn(host, { name: "tester" } as PaneSpec, `mkdir -p ~/Projects/tests && echo ok-${nonce} > ${marker}`);
    expect(handle.remoteId).toContain("ssh-");
    // spawn() returns as soon as `tmux new-session -d` daemonizes — the inner
    // command runs asynchronously inside that session, so give it a beat.
    remote("sleep 1");
    expect(remote(`cat ${marker}`)).toBe(`ok-${nonce}`);
  });

  test("spawn's own tmux wrap detaches — the pane survives the ssh disconnect", () => {
    // Production pattern (now built into SshRemoteTransport.spawn itself, not
    // hand-rolled): a remote tmux pane must outlive the ssh call. There is no
    // separate send()/inbox channel any more — the command argv IS the brief.
    const marker = `~/Projects/tests/${nonce}.pane`;
    const handle = t.spawn(host, { name: "detached" } as PaneSpec, `sleep 4; echo lived > ${marker}`);
    // ssh has returned — the session must still be alive on the remote.
    expect(remote(`tmux ls 2>/dev/null | grep -c ${handle.remoteId} || true`)).toBe("1");
    // and it completes its work after we're gone.
    remote("sleep 5");
    expect(remote(`cat ${marker}`)).toBe("lived");
    t.teardown();
    expect(remote(`tmux ls 2>/dev/null | grep -c ${handle.remoteId} || true`)).toBe("0");
  }, 30000);

  test("login-shell wrap resolves an off-PATH brand (codex) where bare ssh cannot", () => {
    // Skip gracefully if codex isn't installed on the target at all.
    const hasCodex = remote(`zsh -lic 'command -v codex' >/dev/null 2>&1 && echo yes || echo no`);
    if (hasCodex !== "yes") {
      console.warn("[live] codex not on target — skipping login-shell brand check");
      return;
    }
    // Bare non-interactive ssh does NOT find codex (off-PATH, e.g. linuxbrew)...
    const bare = remote("command -v codex >/dev/null 2>&1 && echo found || echo missing");
    expect(bare).toBe("missing");

    // ...but a login-shell-wrapped spawn DOES — wire it via host.loginShell.
    const shellHost: RemoteHostTarget = { ...host, hostKind: "codex", loginShell: "zsh" };
    const marker = `~/Projects/tests/${nonce}.codex`;
    t.spawn(shellHost, { name: "codex-agent" } as PaneSpec, `mkdir -p ~/Projects/tests && codex --version > ${marker} 2>&1`);
    remote("sleep 1"); // tmux-detached — give the inner command a beat to finish
    expect(remote(`cat ~/Projects/tests/${nonce}.codex`)).toMatch(/codex/i);
  });

  test("capability probe reports the host's real installed tools over ssh", () => {
    // The box has claude + codex + tmux; agy + pi are NOT installed there.
    const r = t.probe(host, ["claude", "tmux", "codex", "agy", "pi"]);
    expect(r.present).toContain("claude");
    expect(r.present).toContain("tmux");
    expect(r.missing).toContain("agy");
    expect(r.missing).toContain("pi");
  });

  test("codex resolves in the probe ONLY with a login shell (off non-interactive PATH)", () => {
    // Bare probe: codex (linuxbrew) is off the non-interactive PATH → missing.
    expect(t.probe(host, ["codex"]).missing).toContain("codex");
    // Login-shell probe: codex resolves → present.
    expect(t.probe({ ...host, loginShell: "zsh" }, ["codex"]).present).toContain("codex");
  });

  test("teardown — runs cleanly over the wire", () => {
    expect(() => t.teardown()).not.toThrow();
  });
});
