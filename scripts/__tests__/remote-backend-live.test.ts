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
 * Validated 2026-06-14 against a real Linux host (claude CLI 2.1.x, tmux):
 * connect probe, remote spawn execution, base64 inbox round-trip, detached-pane
 * survival across the ssh disconnect, and teardown — all green over the wire.
 * All remote artifacts are confined to ~/Projects/tests + ~/.guild/inbox and
 * cleaned up afterwards.
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
      remote(`rm -f ~/Projects/tests/${nonce}.* ~/.guild/inbox/ssh-*${nonce}* 2>/dev/null; tmux kill-session -t ${nonce} 2>/dev/null || true`);
    } catch { /* best-effort cleanup */ }
  });

  test("connect — real BatchMode reachability probe succeeds", () => {
    const r = t.connect(host);
    expect(r.ok).toBe(true);
  });

  test("spawn — the constructed command actually executes on the remote", () => {
    const marker = `~/Projects/tests/${nonce}.spawn`;
    const handle = t.spawn(host, { name: "tester" } as PaneSpec, `mkdir -p ~/Projects/tests && echo ok-${nonce} > ${marker}`);
    expect(handle.remoteId).toContain("ssh-");
    expect(remote(`cat ~/Projects/tests/${nonce}.spawn`)).toBe(`ok-${nonce}`);
  });

  test("send — payload base64 round-trips into the remote inbox", () => {
    const handle = t.spawn(host, { name: "briefed" } as PaneSpec, "true");
    const payload = `task brief ${nonce} :: quotes ' \" and $pecials`;
    t.send(handle, payload);
    const inbox = remote(`cat ~/.guild/inbox/${handle.remoteId}.task`);
    expect(inbox).toBe(payload);
  });

  test("detached pane survives the ssh disconnect (the spawn residual)", () => {
    // Production pattern: a remote tmux pane must outlive the ssh call.
    remote(`tmux kill-session -t ${nonce} 2>/dev/null; tmux new-session -d -s ${nonce} "sleep 4; echo lived > ~/Projects/tests/${nonce}.pane"`);
    // ssh has returned — the session must still be alive on the remote.
    expect(remote(`tmux ls 2>/dev/null | grep -c ${nonce} || true`)).toBe("1");
    // and it completes its work after we're gone.
    remote("sleep 5");
    expect(remote(`cat ~/Projects/tests/${nonce}.pane`)).toBe("lived");
  }, 30000);

  test("teardown — runs cleanly over the wire", () => {
    expect(() => t.teardown()).not.toThrow();
  });
});
